// _ported/pulse.js — FULL native port of pulse_manager.html (HR Announcement admin · หน้า "Pulse Survey")
// ลอกทั้งดุ้น: survey cards (scards) + create modal + aggregate modal (agg/eNPS/avg/comments/segments)
//   CSS เดิม (<style> หน้า manager) prefix ทุก selector ด้วย #pl · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ PL_RUN_PAGE_JS() · google.script.run = shim → PL_BACKEND (Supabase)
//
// ใช้ global window.sb / window.esc / window.$ (index.html module scope) — ห้าม redeclare
// helper (esc/showToast) inline ใน scope · fn ที่ inline onclick ต้องใช้ = ผูกกับ window (prefix กันชน)
//
// backend (edge fn hr_list?type=pulse.updated&limit=2000 → {items}) :
//   pulseAdminList()        → { surveys:[...] } derive client-side จาก payload ล่าสุดต่อ survey
//                             (ตอนนี้ list อาจว่าง = 0 survey → render ได้ ไม่ error · empty state)
//   pulseAdminAggregate(id) → { ok, summary:{count,response_rate_pct,enps,avg,comments,segments} }
//                             derive จาก responses ที่ embed มาใน payload survey
//   pulseAdminCreate / Open / Close / Remind → เขียนกลับ/ส่ง LINE ไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   PL_BACKEND — map google.script.run → Supabase edge fn hr_list (type=pulse.updated)
   ============================================================ */
var PL_FN = 'hr_list';
var PL_TYPE = 'pulse.updated';
var PL_LIMIT = 2000;

function pl2ToArr(v) { return Array.isArray(v) ? v : []; }
function pl2Num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function pl2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

var PL_STATUSES = ['draft', 'open', 'closed', 'archived'];

// map payload event ดิบ → survey row shape ที่ JS เดิมใช้
function pl2MapSurvey(p) {
  p = p || {};
  var status = String(p.status || 'draft').toLowerCase();
  if (PL_STATUSES.indexOf(status) < 0) status = 'draft';
  var responses = pl2ToArr(p.responses);
  var received = (p.received != null) ? pl2Num(p.received) : responses.length;
  var expected = pl2Num(p.expected != null ? p.expected : p.target_count);
  return {
    survey_id: p.survey_id || p.entity_id || p.id || '',
    title: p.title || p.name || 'Pulse Survey',
    period_quarter: p.period_quarter || p.quarter || p.period || '—',
    status: status,
    expected: expected,
    received: received,
    open_date: pl2Date(p.open_date),
    close_date: pl2Date(p.close_date),
    description: p.description || '',
    responses: responses,
    _raw: p,
  };
}

// cache payload ดิบล่าสุดต่อ survey (ให้ aggregate reuse · backend ไม่มี endpoint แยก)
var _pl2Surveys = [];
var _pl2Raw = {};

function pl2FetchSurveys() {
  return sb.functions.invoke(PL_FN + '?type=' + encodeURIComponent(PL_TYPE) + '&limit=' + PL_LIMIT).then(function (res) {
    var data = (res && res.data) || {};
    var items = pl2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.survey_id || p.entity_id || p.id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      _pl2Raw[id] = p;
      rows.push(pl2MapSurvey(p));
    });
    _pl2Surveys = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[PL_BACKEND] list fetch failed', e);
    _pl2Surveys = [];
    return [];
  });
}

// derive aggregate summary client-side จาก responses ที่ embed ใน payload
function pl2BuildSummary(s) {
  s = s || {};
  var responses = pl2ToArr(s.responses);
  var count = responses.length;
  var expected = pl2Num(s.expected);
  var responseRate = expected > 0 ? Math.round(count / expected * 100) : 0;

  // avg ต่อคำถาม (เก็บ enps แยก) · response.answers = { qKey: ratingNum, ... }
  var sum = {}, n = {};
  var enpsScores = [];
  var comments = [];
  var segMap = {};
  responses.forEach(function (r) {
    r = r || {};
    var answers = r.answers || r.scores || {};
    Object.keys(answers).forEach(function (k) {
      var v = Number(answers[k]);
      if (isNaN(v)) return;
      if (k === 'enps' || k === 'nps') { enpsScores.push(v); return; }
      sum[k] = (sum[k] || 0) + v;
      n[k] = (n[k] || 0) + 1;
    });
    if (r.enps != null && !isNaN(Number(r.enps))) enpsScores.push(Number(r.enps));
    var cmt = r.comment || r.feedback || '';
    if (cmt) comments.push({ comment: cmt, branch_id: r.branch_id || r.branch || '' });
    var b = r.branch_id || r.branch || '';
    if (b) segMap[b] = (segMap[b] || 0) + 1;
  });

  var avg = {};
  Object.keys(sum).forEach(function (k) { avg[k] = Math.round(sum[k] / n[k] * 10) / 10; });

  // eNPS = %promoters(9-10) - %detractors(0-6)
  var enps = null;
  if (enpsScores.length) {
    var prom = enpsScores.filter(function (v) { return v >= 9; }).length;
    var det = enpsScores.filter(function (v) { return v <= 6; }).length;
    enps = Math.round((prom - det) / enpsScores.length * 100);
  }

  var segments = Object.keys(segMap).map(function (b) { return { branch_id: b, count: segMap[b] }; });

  return {
    count: count,
    response_rate_pct: responseRate,
    enps: enps,
    avg: avg,
    comments: comments,
    segments: segments,
  };
}

var PL_BACKEND = {
  // list — { surveys:[...] } เรียงตาม open_date ใหม่สุดก่อน
  pulseAdminList: function () {
    return pl2FetchSurveys().then(function (all) {
      var statusRank = {}; PL_STATUSES.forEach(function (s, i) { statusRank[s] = i; });
      var rows = all.slice().sort(function (a, b) {
        var d = (b.open_date || '').localeCompare(a.open_date || '');
        if (d !== 0) return d;
        return (statusRank[a.status] || 0) - (statusRank[b.status] || 0);
      });
      return { surveys: rows };
    });
  },

  // aggregate — { ok, summary } (reuse cache · derive client-side)
  pulseAdminAggregate: function (surveyId) {
    var build = function () {
      var p = _pl2Raw[surveyId];
      var s = p ? pl2MapSurvey(p) : _pl2Surveys.find(function (x) { return x.survey_id === surveyId; });
      if (!s) return { ok: false, error: 'ไม่พบ survey' };
      return { ok: true, summary: pl2BuildSummary(s) };
    };
    if (_pl2Surveys.length || Object.keys(_pl2Raw).length) return Promise.resolve(build());
    return pl2FetchSurveys().then(build);
  },

  // ---- mutations: เขียนกลับ/ส่ง LINE ไม่ได้บน dashboard → stub + toast ----
  pulseAdminCreate: function () {
    pl2NotReady('สร้าง survey');
    return Promise.resolve({ ok: false, error: 'สร้าง survey ยังไม่พร้อมบน dashboard (read-only)' });
  },
  pulseAdminOpen: function () {
    pl2NotReady('เปิด survey + push noti');
    return Promise.resolve({ ok: false, error: 'เปิด survey ยังไม่พร้อมบน dashboard' });
  },
  pulseAdminClose: function () {
    pl2NotReady('ปิด survey');
    return Promise.resolve({ ok: false, error: 'ปิด survey ยังไม่พร้อมบน dashboard' });
  },
  pulseAdminRemind: function () {
    pl2NotReady('เตือนซ้ำ (push LINE)');
    return Promise.resolve({ ok: false, error: 'เตือนซ้ำ ยังไม่พร้อมบน dashboard' });
  },
};

var _pl2NotReadyShown = {};
function pl2NotReady(feature) {
  if (_pl2NotReadyShown[feature]) return;
  _pl2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.pl2Toast) window.pl2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountPulse — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม → #wrap-pulse
   ============================================================ */
function mountPulse() {
  if (!document.getElementById('wrap-pulse')) return;
  var wrap = document.getElementById('wrap-pulse');
  wrap.innerHTML = '<style>' + PL_CSS() + '</style><div id="pl">' + PL_MARKUP() + '</div>';
  PL_RUN_PAGE_JS();
}

/* ===== CSS เดิม (<style> pulse_manager) · prefix ทุก selector ด้วย #pl =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell + body override ออก (dashboard มี shell แล้ว) */
function PL_CSS() {
  return [
    // tokens (จาก :root เดิม) → ผูกกับ #pl
    '#pl{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--teal-dark:#0F766E;--bg:#F8F9FA;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--warn:#F59E0B;--success:#16A34A;color:var(--navy);font-size:14px}',
    '#pl,#pl *,#pl *::before,#pl *::after{box-sizing:border-box}',
    // buttons
    '#pl .btn-p{background:var(--teal);color:white;padding:8px 14px;border-radius:7px;font-size:12px;font-weight:500;border:none;cursor:pointer}',
    // page head (native บน dashboard · ไม่มี shell page-head เดิม)
    '#pl .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#pl .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#pl .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#pl .page-head .subtitle{font-size:12px;color:var(--muted);margin-top:4px}',
    '#pl .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}',
    // body / cards
    '#pl .body{padding:0}',
    '#pl .scards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:11px}',
    '#pl .scard{background:white;border:1px solid var(--border);border-radius:11px;padding:14px}',
    '#pl .scard-h{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}',
    '#pl .scard-t{font-size:14px;font-weight:600}',
    '#pl .scard-q{font-size:11px;color:var(--muted);margin-top:2px}',
    '#pl .stag{font-size:9px;padding:2px 8px;border-radius:99px;font-weight:600}',
    '#pl .stag.draft{background:#F3F4F6;color:#4B5563}',
    '#pl .stag.open{background:#D1FAE5;color:#047857}',
    '#pl .stag.closed{background:#DBEAFE;color:#1E40AF}',
    '#pl .smetric{background:var(--bg);border-radius:7px;padding:9px 11px;margin-top:9px}',
    '#pl .smetric-r{display:flex;justify-content:space-between;font-size:11px;padding:3px 0}',
    '#pl .smetric-l{color:var(--muted)}',
    '#pl .smetric-v{color:var(--navy);font-weight:500}',
    '#pl .sactions{display:flex;gap:6px;margin-top:10px}',
    '#pl .rb{padding:6px 10px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:white;color:var(--navy)}',
    '#pl .rb.p{background:var(--teal);color:white;border-color:var(--teal)}',
    '#pl .rb.warn{background:var(--warn);color:white;border-color:var(--warn)}',
    '#pl .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    // modal
    '#pl .modal-bg{display:none;position:fixed;inset:0;background:rgba(13,47,79,.6);z-index:9000;align-items:center;justify-content:center;padding:20px}',
    '#pl .modal-bg.open{display:flex}',
    '#pl .modal{background:white;border-radius:14px;max-width:600px;width:100%;max-height:90vh;overflow-y:auto}',
    '#pl .modal-h{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
    '#pl .modal-x{background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer}',
    '#pl .modal-b{padding:16px 20px}',
    // field
    '#pl .field{margin-bottom:11px}',
    '#pl .field-l{display:block;font-size:11px;font-weight:600;margin-bottom:5px}',
    '#pl .field-i{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit}',
    '#pl .field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    // aggregate
    '#pl .agg{padding:14px;background:white;border:1px solid var(--border);border-radius:11px}',
    '#pl .agg-h{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}',
    '#pl .agg-c{text-align:center;padding:10px;background:var(--bg);border-radius:7px}',
    '#pl .agg-n{font-size:24px;font-weight:600}',
    '#pl .agg-l{font-size:10px;color:var(--muted);margin-top:3px}',
    '#pl .agg-q{padding:8px 11px;background:var(--bg);border-radius:7px;margin-top:5px;font-size:12px}',
    '#pl .agg-q-r{display:flex;justify-content:space-between;align-items:center}',
    '#pl .agg-q-bar{flex:1;height:6px;background:white;border-radius:3px;margin:0 11px;overflow:hidden}',
    '#pl .agg-q-fill{height:100%;background:var(--teal)}',
    '#pl .agg-q-v{font-weight:600}',
    '#pl .agg-cmts{margin-top:12px}',
    '#pl .agg-cmt{background:var(--bg);border-radius:6px;padding:8px 11px;margin-bottom:5px;font-size:11px;line-height:1.5}',
    '#pl .agg-cmt-m{color:var(--muted);font-size:9px;margin-top:3px}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + body + create/aggregate modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function PL_MARKUP() {
  return [
    // header (จาก .page-head เดิม)
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    '      Pulse Survey Manager',
    '    </h1>',
    '    <div class="subtitle">รายไตรมาส · anonymous engagement · dedup ผ่าน hash · trend ระยะยาว</div>',
    '  </div>',
    '  <div class="page-actions" id="yh-page-actions"><button class="btn-p" onclick="plOpenCreate()">+ สร้าง survey</button></div>',
    '</header>',
    // body
    '<div class="body" id="bodyWrap"><div class="empty">กำลังโหลด...</div></div>',
    // modal
    '<div class="modal-bg" id="modalBg" onclick="if(event.target===this)plCloseModal()">',
    '  <div class="modal">',
    '    <div class="modal-h"><div style="font-size:15px; font-weight:600;" id="mt"></div><button class="modal-x" onclick="plCloseModal()">×</button></div>',
    '    <div class="modal-b" id="mb"></div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   PL_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → PL_BACKEND
   helper (esc/showToast) inline เข้ามา · fn ที่ inline onclick ต้องใช้ → ผูกกับ window
   ============================================================ */
function PL_RUN_PAGE_JS() {

  // ---- google.script.run shim → PL_BACKEND (async, คืน shape เดิม) ----
  function _pl2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (PL_BACKEND[prop]) {
            Promise.resolve().then(function () { return PL_BACKEND[prop].apply(PL_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[PL_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[PL_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _pl2MakeChain(); } });

  // ---- alert/confirm/prompt ของหน้าเดิม → ใช้ native (mutations เป็น stub อยู่แล้ว) ----
  // ---- helpers (inline · scope #pl กันชน) ----
  const _plRoot = document.getElementById('pl');
  function $id(id) { return _plRoot ? _plRoot.querySelector('#' + id) : document.getElementById(id); }
  function getById(id) { return $id(id); }

  // esc เดิม (เหมือน pulse_manager.html เป๊ะ)
  function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  function showToast(msg, type) {
    let t = document.getElementById('pl2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pl2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#DC2626' : type === 'success' ? '#16A34A' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.pl2Toast = showToast;

  /* ====================================================================
     ===== JS หน้าเดิม pulse_manager.html (ลอกทั้งดุ้น) =====
     แทน document.getElementById(...) → getById(...) (scope ใต้ #pl)
     ==================================================================== */
  let _state = { surveys: [] };

  function init() { reload(); }
  function reload() {
    getById('bodyWrap').innerHTML = '<div class="empty">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(onLoaded).pulseAdminList();
  }
  function onLoaded(r) {
    _state.surveys = (r && r.surveys) || [];
    if (!_state.surveys.length) {
      getById('bodyWrap').innerHTML = '<div class="empty">ยังไม่มี survey · สร้างใหม่ได้</div>';
      return;
    }
    getById('bodyWrap').innerHTML = '<div class="scards">' +
      _state.surveys.map(s => renderCard(s)).join('') + '</div>';
  }
  function renderCard(s) {
    const responseRate = s.expected > 0 ? Math.round(s.received / s.expected * 100) : 0;
    return `<div class="scard">
      <div class="scard-h">
        <div><div class="scard-t">${esc(s.title)}</div><div class="scard-q">รอบ ${esc(s.period_quarter)}</div></div>
        <span class="stag ${esc(s.status)}">${statusLabel(s.status)}</span>
      </div>
      <div class="smetric">
        <div class="smetric-r"><span class="smetric-l">เป้าหมาย</span><span class="smetric-v">${s.expected} คน</span></div>
        <div class="smetric-r"><span class="smetric-l">ตอบแล้ว</span><span class="smetric-v">${s.received} (${responseRate}%)</span></div>
      </div>
      <div class="sactions">
        ${s.status === 'draft' ? `<button class="rb p" onclick="plOpenSurvey('${esc(s.survey_id)}')">เปิด survey</button>` : ''}
        ${s.status === 'open' ? `<button class="rb" onclick="plRemindSurvey('${esc(s.survey_id)}')">เตือนซ้ำ</button>` : ''}
        ${s.status === 'open' ? `<button class="rb warn" onclick="plCloseSurvey('${esc(s.survey_id)}')">ปิด survey</button>` : ''}
        <button class="rb" onclick="plViewAgg('${esc(s.survey_id)}')">ดูผล</button>
      </div>
    </div>`;
  }

  // v1.10.60 — Reminder button
  function plRemindSurvey(id) {
    if (!confirm('ส่งเตือนซ้ำให้ทุกคนที่ targeted? · คนที่ตอบแล้วจะเห็น "ตอบแล้ว" · ไม่กระทบ anonymity')) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) alert('ส่งเตือนแล้ว · push ' + r.pushed + ' คน · response rate ' + r.response_rate_pct + '%');
      else alert('ส่งเตือนล้มเหลว · ' + (r && r.error));
    }).pulseAdminRemind(id);
  }
  function statusLabel(s) { return ({ draft: 'ร่าง', open: 'เปิดรับ', closed: 'ปิดแล้ว', archived: 'archived' })[s] || s; }

  function plOpenCreate() {
    getById('mt').textContent = 'สร้าง Pulse Survey';
    const q = (new Date()).getMonth() < 3 ? 1 : (new Date()).getMonth() < 6 ? 2 : (new Date()).getMonth() < 9 ? 3 : 4;
    const yr = (new Date()).getFullYear() + 543;
    getById('mb').innerHTML = `
      <div class="field"><label class="field-l">ชื่อ survey</label>
        <input class="field-i" id="fTitle" value="Pulse Survey Q${q} ${yr}"></div>
      <div class="field"><label class="field-l">รอบ (Q1-Q4)</label>
        <input class="field-i" id="fQuarter" value="${yr}-Q${q}"></div>
      <div class="field-row">
        <div class="field"><label class="field-l">วันเปิดรับ</label>
          <input class="field-i" type="date" id="fOpen" value="${(new Date()).toISOString().slice(0, 10)}"></div>
        <div class="field"><label class="field-l">วันปิดรับ</label>
          <input class="field-i" type="date" id="fClose" value="${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)}"></div>
      </div>
      <div class="field"><label class="field-l">คำอธิบาย</label>
        <textarea class="field-i" id="fDesc" rows="2">ขอความคิดเห็นจากทีมเพื่อปรับปรุงสภาพแวดล้อมการทำงาน</textarea></div>
      <div style="font-size:11px; color:var(--muted); margin-bottom:10px;">คำถามจะใช้ default 6 ข้อ · แก้ไขใน Sheet ได้</div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="rb" onclick="plCloseModal()">ยกเลิก</button>
        <button class="rb p" onclick="plSaveSurvey()">บันทึก</button>
      </div>`;
    getById('modalBg').classList.add('open');
  }

  function plSaveSurvey() {
    const payload = {
      title: getById('fTitle').value.trim(),
      period_quarter: getById('fQuarter').value.trim(),
      open_date: getById('fOpen').value,
      close_date: getById('fClose').value,
      description: getById('fDesc').value,
    };
    if (!payload.title || !payload.period_quarter) { alert('กรอกชื่อและรอบ'); return; }
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) { plCloseModal(); reload(); }
      else alert('สร้างไม่สำเร็จ · ' + (r && r.error));
    }).pulseAdminCreate(payload);
  }

  function plOpenSurvey(id) {
    if (!confirm('เปิด survey + push noti ไปทุกคนตอนนี้?')) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) reload();
      else alert('เปิดล้มเหลว · ' + (r && r.error));
    }).pulseAdminOpen(id);
  }
  function plCloseSurvey(id) {
    if (!confirm('ปิด survey ตอนนี้?')) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) reload();
      else alert('ปิดล้มเหลว · ' + (r && r.error));
    }).pulseAdminClose(id);
  }

  function plViewAgg(id) {
    google.script.run.withSuccessHandler(onAgg).pulseAdminAggregate(id);
  }
  function onAgg(r) {
    if (!r || !r.ok) { alert('โหลดผลล้มเหลว · ' + (r && r.error)); return; }
    const s = r.summary;
    getById('mt').textContent = 'ผลรวม survey';
    let html = `<div class="agg">
      <div class="agg-h">
        <div class="agg-c"><div class="agg-n">${s.count}</div><div class="agg-l">ตอบแล้ว</div></div>
        <div class="agg-c"><div class="agg-n">${s.response_rate_pct}%</div><div class="agg-l">response rate</div></div>
        <div class="agg-c"><div class="agg-n">${s.enps !== null ? s.enps : '–'}</div><div class="agg-l">eNPS</div></div>
      </div>`;
    if (Object.keys(s.avg).length) {
      html += '<div style="font-size:11px; font-weight:600; margin:14px 0 8px;">คะแนนเฉลี่ยต่อคำถาม</div>';
      Object.keys(s.avg).forEach(k => {
        if (k === 'enps') return;
        const v = s.avg[k];
        const pct = v / 5 * 100;
        html += `<div class="agg-q"><div class="agg-q-r">
          <span style="font-size:10px;">${esc(k)}</span>
          <div class="agg-q-bar"><div class="agg-q-fill" style="width:${pct}%;"></div></div>
          <span class="agg-q-v">${v}/5</span>
        </div></div>`;
      });
    }
    if (s.comments && s.comments.length) {
      html += '<div class="agg-cmts"><div style="font-size:11px; font-weight:600; margin:14px 0 8px;">ความคิดเห็น (anonymous · ' + s.comments.length + ')</div>';
      s.comments.forEach(c => {
        html += `<div class="agg-cmt">${esc(c.comment)}<div class="agg-cmt-m">${esc(c.branch_id || 'ไม่ระบุสาขา')}</div></div>`;
      });
      html += '</div>';
    }
    if (s.segments && s.segments.length) {
      html += '<div style="font-size:11px; font-weight:600; margin:14px 0 8px;">แยกตามสาขา</div>';
      s.segments.forEach(seg => {
        html += `<div class="smetric-r" style="padding:5px 11px; background:var(--bg); border-radius:5px; margin-bottom:4px;">
          <span class="smetric-l">${esc(seg.branch_id || 'ไม่ระบุ')}</span><span class="smetric-v">${seg.count} คน</span></div>`;
      });
    }
    html += '</div>';
    getById('mb').innerHTML = html;
    getById('modalBg').classList.add('open');
  }

  function plCloseModal() { getById('modalBg').classList.remove('open'); }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window (prefix กันชน) ===== */
  const _exp = {
    plOpenCreate, plSaveSurvey, plOpenSurvey, plCloseSurvey, plRemindSurvey, plViewAgg, plCloseModal,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  init();
}

/* expose mount → window (dashboard เรียก window.mountPulse) */
if (typeof window !== 'undefined') window.mountPulse = mountPulse;
