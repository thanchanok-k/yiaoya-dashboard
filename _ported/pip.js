// _ported/pip.js — FULL native port of desktop pip_manager.html (HR Announcement admin · หน้า "แผนพัฒนาผลงาน (PIP)")
// ลอกทั้งดุ้น: top bar(+PIP ใหม่) + quick-stats(4) + legacy stats(3) + tabs(active/improved/terminated/closed/all)
//   + PIP cards (trigger badge · 30/60/90 day checkpoints · concern/criteria · actions) + empty state
//   CSS เดิม (<style> หน้า manager + quick-stats skeleton) prefix #pp ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ PP_RUN_PAGE_JS() · google.script.run = shim → PP_BACKEND (Supabase)
//
// ใช้ global window.sb (index.html module scope) — ห้าม redeclare · helper (esc/showToast/showHelp) inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window แบบ prefix (pp*) กันชน ภายใน PP_RUN_PAGE_JS
//
// PIP = sensitive (ผลงาน/วินัย) → port หน้าจอเท่านั้น · ไม่เพิ่ม logic ใหม่ · read-only บน dashboard
//
// backend (edge fn hr_list?type=pip.updated&limit=2000 → {items}) :
//   list   → derive rows/counts/checkpoints client-side จาก payload ล่าสุดต่อ pip (data ว่าง→empty state สวย)
//   mutations (checkpoint/close)  → เขียนกลับไม่ได้ → stub + toast 'ยังไม่พร้อมบน dashboard'

/* ============================================================
   PP_BACKEND — map google.script.run → Supabase edge fn hr_list (type=pip.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     pipAdminList(opts)        → { ok, rows, counts }
     pipAdminCheckpoint(...)   → { ok / error } stub + toast
     pipAdminClose(...)        → { ok / error } stub + toast
   ============================================================ */
var PP_FN = 'hr_list';
var PP_TYPE = 'pip.updated';
var PP_LIMIT = 2000;

function pp2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function pp2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function pp2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function pp2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

var PP_STATUSES = ['active', 'extended', 'improved', 'terminated', 'cancelled'];

// map payload event ดิบ → pip row shape ที่ JS เดิมใช้
function pp2MapRow(p) {
  p = p || {};
  var status = String(p.status || 'active').toLowerCase();
  if (PP_STATUSES.indexOf(status) < 0) status = 'active';

  var startDate = pp2Date(p.start_date || p.started_at || p.created_at);
  var endDate = pp2Date(p.end_date || p.due_date);
  var daysRemaining = null;
  if (endDate) {
    var d1 = new Date(endDate); var today = new Date(); today.setHours(0, 0, 0, 0);
    if (!isNaN(d1.getTime())) daysRemaining = Math.floor((d1 - today) / 86400000);
  }
  if (p.days_remaining != null && p.days_remaining !== '') {
    var dr = parseInt(p.days_remaining, 10);
    if (!isNaN(dr)) daysRemaining = dr;
  }

  // checkpoints — accept array หรือ derive จาก start_date (30/60/90)
  var checkpoints = pp2ToArr(p.checkpoints).map(function (ck) {
    ck = ck || {};
    return {
      checkpoint_id: ck.checkpoint_id || ck.id || '',
      day_marker: ck.day_marker != null ? ck.day_marker : (ck.day != null ? ck.day : ''),
      completed_date: pp2Date(ck.completed_date || ck.completed_at),
      manager_assessment: ck.manager_assessment || '',
      action_items: ck.action_items || '',
    };
  });

  return {
    pip_id: p.pip_id || p.entity_id || p.id || '',
    employee_name: p.employee_name || p.name || p.full_name || '—',
    position: p.position || p.position_name || '—',
    manager_name: p.manager_name || p.manager || '—',
    triggered_by: String(p.triggered_by || p.trigger || 'kpi_low').toLowerCase(),
    start_date: startDate,
    end_date: endDate,
    days_remaining: daysRemaining,
    concern_areas: p.concern_areas || p.concerns || '',
    success_criteria: p.success_criteria || p.criteria || '',
    checkpoints: checkpoints,
    status: status,
    outcome_summary: p.outcome_summary || p.outcome || '',
    closed_at: pp2Date(p.closed_at),
    _raw: p,
  };
}

// cache payload ดิบล่าสุดต่อ pip (backend ไม่มี endpoint แยก)
var _pp2Rows = [];
var _pp2Raw = {};

function pp2FetchRows() {
  return window.sb.functions
    .invoke(PP_FN + '?type=' + encodeURIComponent(PP_TYPE) + '&limit=' + PP_LIMIT)
    .then(function (res) {
      var data = (res && res.data) || {};
      var items = pp2ToArr(data.items);
      var seen = {}; var rows = [];
      items.forEach(function (p) {
        var id = p.pip_id || p.entity_id || p.id || '';
        if (!id || seen[id]) return;
        seen[id] = true;
        _pp2Raw[id] = p;
        rows.push(pp2MapRow(p));
      });
      _pp2Rows = rows;
      return rows;
    }).catch(function (e) {
      console.warn('[PP_BACKEND] list fetch failed', e);
      _pp2Rows = [];
      return [];
    });
}

var PP_BACKEND = {
  // list — { ok, rows, counts }
  pipAdminList: function (opts) {
    opts = opts || {};
    return pp2FetchRows().then(function (all) {
      var tab = opts.tab || 'active';
      var isClosed = function (r) { return r.status === 'improved' || r.status === 'terminated' || r.status === 'cancelled'; };
      var filtered = all.slice();
      if (tab === 'active') filtered = filtered.filter(function (r) { return r.status === 'active' || r.status === 'extended'; });
      else if (tab === 'improved') filtered = filtered.filter(function (r) { return r.status === 'improved'; });
      else if (tab === 'terminated') filtered = filtered.filter(function (r) { return r.status === 'terminated'; });
      else if (tab === 'closed') filtered = filtered.filter(isClosed);
      // tab === 'all' → ไม่กรอง

      // sort: active ก่อน (เรียงตาม days_remaining น้อยสุด/urgent ก่อน) แล้วค่อยปิด
      filtered.sort(function (a, b) {
        var ar = a.days_remaining == null ? 99999 : a.days_remaining;
        var br = b.days_remaining == null ? 99999 : b.days_remaining;
        if (ar !== br) return ar - br;
        return (b.start_date || '').localeCompare(a.start_date || '');
      });

      var byStatus = function (s) { return all.filter(function (r) { return r.status === s; }).length; };
      var activeN = all.filter(function (r) { return r.status === 'active' || r.status === 'extended'; }).length;
      var improvedN = byStatus('improved');
      var terminatedN = byStatus('terminated');
      var counts = {
        active: activeN,
        improved: improvedN,
        terminated: terminatedN,
        all: all.length,
      };

      return { ok: true, rows: filtered, counts: counts };
    });
  },

  // ---- mutations: เขียนกลับไม่ได้บน dashboard → stub + toast ----
  pipAdminCheckpoint: function () {
    pp2NotReady('บันทึก checkpoint');
    return Promise.resolve({ error: 'บันทึก checkpoint ยังไม่พร้อมบน dashboard (read-only)' });
  },
  pipAdminClose: function () {
    pp2NotReady('ปิด PIP (improved / terminated)');
    return Promise.resolve({ error: 'ปิด PIP ยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _pp2NotReadyShown = {};
function pp2NotReady(feature) {
  if (_pp2NotReadyShown[feature]) return;
  _pp2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.pp2Toast) window.pp2Toast('ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountPip — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountPip() {
  if (!document.getElementById('wrap-pip')) return;
  var wrap = document.getElementById('wrap-pip');
  wrap.innerHTML = '<style>' + PP_CSS() + '</style><div id="pp">' + PP_MARKUP() + '</div>';
  PP_RUN_PAGE_JS();
}

/* ===== CSS เดิม (<style> manager + quick-stats skeleton) · prefix ทุก selector ด้วย #pp =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว)
   token --navy/--teal ฯลฯ คงค่าเดิมเป๊ะ */
function PP_CSS() {
  return [
    '#pp{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--bg:#F8F9FA;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--warn:#F59E0B;--success:#16A34A;--purple:#8B5CF6;color:var(--navy);font-size:14px}',
    '#pp *,#pp *::before,#pp *::after{box-sizing:border-box}',
    // page-head (native บน dashboard)
    '#pp .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#pp .page-head h1{font-size:20px;font-weight:600;color:#0D2F4F;letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#pp .page-head h1 svg{width:18px;height:18px;color:#3DC5B7}',
    '#pp .page-head .subtitle{font-size:12px;color:#64748B;margin-top:4px}',
    '#pp .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}',
    // quick-stats skeleton (yh-*)
    '#pp .yh-quick-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}',
    '@media (max-width:900px){#pp .yh-quick-stats{grid-template-columns:repeat(2,1fr)}}',
    '#pp .yh-qs-card{background:white;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;position:relative;overflow:hidden;cursor:help}',
    '#pp .yh-qs-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#pp .yh-qs-card.warn::before{background:#F59E0B}',
    '#pp .yh-qs-card.danger::before{background:#EF4444}',
    '#pp .yh-qs-card.info::before{background:#185FA5}',
    '#pp .yh-qs-card.success::before{background:#10B981}',
    '#pp .yh-qs-lbl{font-size:10px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:4px}',
    '#pp .yh-qs-lbl svg{width:11px;height:11px;color:#94A3B8}',
    '#pp .yh-qs-val{font-size:22px;font-weight:700;color:#0D2F4F;line-height:1;margin-top:6px;letter-spacing:-.02em}',
    '#pp .yh-qs-sub{font-size:10px;color:#94A3B8;margin-top:3px}',
    // top bar
    '#pp .top{background:var(--navy);color:white;padding:14px 20px;display:flex;align-items:center;gap:12px;border-radius:10px}',
    '#pp .top-t{font-size:16px;font-weight:600}',
    '#pp .top-b{background:var(--purple);padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600}',
    '#pp .top-spacer{flex:1}',
    '#pp .btn-p{background:var(--teal);color:white;padding:8px 14px;border-radius:7px;font-size:12px;font-weight:500;border:none;cursor:pointer}',
    // legacy stats (3)
    '#pp .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:16px 0}',
    '#pp .st{background:white;border:1px solid var(--border);border-radius:10px;padding:14px;border-left-width:3px}',
    '#pp .st.a{border-left-color:var(--warn)}',
    '#pp .st.i{border-left-color:var(--success)}',
    '#pp .st.t{border-left-color:var(--error)}',
    '#pp .st-n{font-size:24px;font-weight:600}',
    '#pp .st-l{font-size:11px;color:var(--muted);margin-top:3px}',
    // tabs
    '#pp .tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);background:white;border-radius:8px 8px 0 0}',
    '#pp .tab{padding:11px 16px;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;font-weight:500}',
    '#pp .tab.act{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    // body
    '#pp .body{padding:14px 0}',
    '#pp .pcard{background:white;border:1px solid var(--border);border-radius:11px;padding:14px;margin-bottom:11px}',
    '#pp .pcard.urgent{border-left:3px solid var(--error)}',
    '#pp .pcard.expiring{border-left:3px solid var(--warn)}',
    '#pp .ph{display:flex;gap:11px;align-items:center;margin-bottom:9px}',
    '#pp .pav{width:38px;height:38px;border-radius:50%;background:var(--navy);color:white;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:500}',
    '#pp .pn{font-size:13px;font-weight:500}',
    '#pp .pp{font-size:10px;color:var(--muted)}',
    '#pp .ptrigger{font-size:9px;padding:2px 7px;border-radius:99px;font-weight:500}',
    '#pp .ptrigger.disciplinary{background:#FEE2E2;color:#B91C1C}',
    '#pp .ptrigger.kpi_low{background:#FEF3C7;color:#B45309}',
    '#pp .ptrigger.manager_request{background:#DBEAFE;color:#1E40AF}',
    '#pp .pdates{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:9px 0;padding:9px;background:var(--bg);border-radius:7px}',
    '#pp .pdate{text-align:center}',
    '#pp .pdate-l{font-size:9px;color:var(--muted);letter-spacing:.3px}',
    '#pp .pdate-v{font-size:13px;font-weight:600;margin-top:2px}',
    '#pp .pdate-v.danger{color:var(--error)}',
    '#pp .pdate-v.warn{color:var(--warn)}',
    '#pp .ptext{font-size:11px;color:var(--muted);margin-top:6px;line-height:1.5}',
    '#pp .ptext b{color:var(--navy)}',
    '#pp .pcheck{display:flex;gap:5px;margin-top:9px}',
    '#pp .pck{flex:1;padding:6px;border-radius:6px;text-align:center;font-size:10px}',
    '#pp .pck.done{background:#D1FAE5;color:#047857}',
    '#pp .pck.scheduled{background:#FEF3C7;color:#B45309}',
    '#pp .pck.pending{background:var(--bg);color:var(--muted)}',
    '#pp .pactions{display:flex;gap:6px;margin-top:9px}',
    '#pp .rb{padding:6px 11px;border-radius:6px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:white;color:var(--navy)}',
    '#pp .rb.p{background:var(--teal);color:white;border-color:var(--teal)}',
    '#pp .rb.improve{background:var(--success);color:white;border-color:var(--success)}',
    '#pp .rb.terminate{background:var(--error);color:white;border-color:var(--error)}',
    '#pp .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    // refresh btn (page-actions)
    '#pp .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:6px;border:1px solid #E2E8F0;background:white;color:#475569;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit}',
    '#pp .btn:hover{border-color:#3DC5B7}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + quick-stats + top + legacy stats + tabs + body =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function PP_MARKUP() {
  return [
    // header (page-head เดิม)
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    '      PIP Manager',
    '    </h1>',
    '    <div class="subtitle">Performance Improvement Plan · 30/60/90 day checkpoints · ลิงค์กับ disciplinary</div>',
    '  </div>',
    '  <div class="page-actions" id="yh-page-actions"><button class="btn" onclick="ppReload()" title="Refresh" data-tip="โหลดข้อมูลใหม่"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-9-9c2.5 0 4.85.99 6.6 2.6L21 8"/><path d="M21 3v5h-5"/></svg>Refresh</button></div>',
    '</header>',
    // quick-stats (yh)
    '<div class="yh-quick-stats">',
    '  <div class="yh-qs-card warn" data-tip="Performance Improvement Plan ที่ active · 30/60/90 day checkpoints">',
    '    <div class="yh-qs-lbl">PIP active <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div>',
    '    <div class="yh-qs-val" id="yh-qs-active">—</div>',
    '    <div class="yh-qs-sub">กำลัง improve</div>',
    '  </div>',
    '  <div class="yh-qs-card" data-tip="PIP ที่ใกล้ครบ 30 วัน · ต้อง review checkpoint แรก">',
    '    <div class="yh-qs-lbl">30-day <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div>',
    '    <div class="yh-qs-val" id="yh-qs-day30">—</div>',
    '    <div class="yh-qs-sub">checkpoint นี้</div>',
    '  </div>',
    '  <div class="yh-qs-card" data-tip="PIP ที่ใกล้ครบ 60 วัน · mid-checkpoint · ปรับ plan ได้">',
    '    <div class="yh-qs-lbl">60-day <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div>',
    '    <div class="yh-qs-val" id="yh-qs-day60">—</div>',
    '    <div class="yh-qs-sub">mid review</div>',
    '  </div>',
    '  <div class="yh-qs-card success" data-tip="สัดส่วน PIP ที่ผ่าน (ไม่ disciplinary ต่อ) ในปีนี้">',
    '    <div class="yh-qs-lbl">Success rate <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg></div>',
    '    <div class="yh-qs-val" id="yh-qs-success">—</div>',
    '    <div class="yh-qs-sub">%</div>',
    '  </div>',
    '</div>',
    // top bar
    '<div class="top">',
    '  <div class="top-t">Performance Improvement Plan</div>',
    '  <div class="top-b">PIP</div>',
    '  <div class="top-spacer"></div>',
    '  <button class="btn-p" onclick="ppNewPip()">+ PIP ใหม่</button>',
    '</div>',
    // legacy stats (3)
    '<div class="stats">',
    '  <div class="st a"><div><div class="st-n" id="stA">–</div><div class="st-l">Active PIP</div></div></div>',
    '  <div class="st i"><div><div class="st-n" id="stI">–</div><div class="st-l">Improved · ผ่าน</div></div></div>',
    '  <div class="st t"><div><div class="st-n" id="stT">–</div><div class="st-l">Terminated</div></div></div>',
    '</div>',
    // tabs + body
    '<div class="tabs" id="tabs"></div>',
    '<div class="body" id="bodyWrap"><div class="empty">กำลังโหลด...</div></div>',
  ].join('\n');
}

/* ============================================================
   PP_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → PP_BACKEND
   helper (showToast/showHelp/esc) inline · fn inline onclick ผูก window แบบ prefix pp*
   ============================================================ */
function PP_RUN_PAGE_JS() {

  // ---- google.script.run shim → PP_BACKEND (async, คืน shape เดิม) ----
  function _pp2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (PP_BACKEND[prop]) {
            Promise.resolve().then(function () { return PP_BACKEND[prop].apply(PP_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[PP_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[PP_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _pp2MakeChain(); } });

  // ---- helpers (inline · ใช้ของ JS หน้าเดิม) ----
  var _ppRoot = document.getElementById('pp');
  function getById(id) { return _ppRoot ? _ppRoot.querySelector('#' + id) : document.getElementById(id); }

  function esc(s) {
    if (typeof window !== 'undefined' && window.esc) return window.esc(s);
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showToast(msg, type) {
    var t = document.getElementById('pp2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pp2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.pp2Toast = showToast;

  /* ====================================================================
     ===== JS หน้าเดิม pip_manager.html (ลอกทั้งดุ้น) =====
     ปรับเฉพาะ: alert/prompt mutation → toast 'ยังไม่พร้อมบน dashboard' (sensitive · read-only)
     ==================================================================== */
  var _state = { tab: 'active', rows: [], counts: {} };

  function init() { reload(); }

  function reload() {
    getById('bodyWrap').innerHTML = '<div class="empty">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(onLoaded).pipAdminList({ tab: _state.tab });
  }

  function onLoaded(res) {
    if (!res || !res.ok) {
      getById('bodyWrap').innerHTML = '<div class="empty">โหลดข้อมูลไม่สำเร็จ</div>';
      return;
    }
    _state.rows = res.rows || [];
    _state.counts = res.counts || {};
    getById('stA').textContent = _state.counts.active || 0;
    getById('stI').textContent = _state.counts.improved || 0;
    getById('stT').textContent = _state.counts.terminated || 0;
    renderQuickStats();
    renderTabs(); renderCards();
  }

  // quick-stats (yh) derive client-side จาก rows ทั้งหมดที่ดึงมา (_pp2Rows)
  function renderQuickStats() {
    var all = _pp2Rows || [];
    var active = all.filter(function (r) { return r.status === 'active' || r.status === 'extended'; });
    getById('yh-qs-active').textContent = active.length;
    var day30 = active.filter(function (r) { return r.days_remaining != null && r.days_remaining >= 0 && r.days_remaining <= 30; }).length;
    var day60 = active.filter(function (r) { return r.days_remaining != null && r.days_remaining > 30 && r.days_remaining <= 60; }).length;
    getById('yh-qs-day30').textContent = day30;
    getById('yh-qs-day60').textContent = day60;
    var closed = all.filter(function (r) { return r.status === 'improved' || r.status === 'terminated'; });
    var improved = all.filter(function (r) { return r.status === 'improved'; });
    var rate = closed.length ? Math.round((improved.length / closed.length) * 100) : 0;
    getById('yh-qs-success').textContent = closed.length ? rate : '—';
  }

  function renderTabs() {
    var c = _state.counts;
    var tabs = [
      { k: 'active', l: 'Active', n: c.active || 0 },
      { k: 'improved', l: 'Improved', n: c.improved || 0 },
      { k: 'terminated', l: 'Terminated', n: c.terminated || 0 },
      { k: 'closed', l: 'Closed', n: (c.improved || 0) + (c.terminated || 0) },
      { k: 'all', l: 'ทั้งหมด', n: c.all || 0 },
    ];
    getById('tabs').innerHTML = tabs.map(function (t) {
      return '<div class="tab ' + (_state.tab === t.k ? 'act' : '') + '" onclick="ppSetTab(\'' + t.k + '\')">' + t.l + ' <span style="font-size:10px; color:var(--muted);">(' + t.n + ')</span></div>';
    }).join('');
  }

  function setTab(k) { _state.tab = k; reload(); }

  function renderCards() {
    if (!_state.rows.length) {
      getById('bodyWrap').innerHTML = '<div class="empty">ไม่มี PIP ในหมวดนี้</div>';
      return;
    }
    getById('bodyWrap').innerHTML = _state.rows.map(function (r) {
      var urgent = r.days_remaining != null && r.days_remaining <= 7;
      var expiring = r.days_remaining != null && r.days_remaining > 7 && r.days_remaining <= 30;
      var cls = urgent ? 'urgent' : expiring ? 'expiring' : '';
      var daysCls = r.days_remaining < 0 ? 'danger' : urgent ? 'danger' : expiring ? 'warn' : '';
      return '<div class="pcard ' + cls + '">' +
        '<div class="ph">' +
          '<div class="pav">' + esc((r.employee_name || '?').charAt(0)) + '</div>' +
          '<div style="flex:1;">' +
            '<div class="pn">' + esc(r.employee_name) + ' · ' + esc(r.pip_id) + '</div>' +
            '<div class="pp">' + esc(r.position) + ' · manager: ' + esc(r.manager_name) + '</div>' +
          '</div>' +
          '<span class="ptrigger ' + esc(r.triggered_by) + '">' + triggerLabel(r.triggered_by) + '</span>' +
        '</div>' +
        '<div class="pdates">' +
          '<div class="pdate"><div class="pdate-l">เริ่ม</div><div class="pdate-v">' + esc(r.start_date) + '</div></div>' +
          '<div class="pdate"><div class="pdate-l">ครบ</div><div class="pdate-v">' + esc(r.end_date) + '</div></div>' +
          '<div class="pdate"><div class="pdate-l">เหลือ</div><div class="pdate-v ' + daysCls + '">' + (r.days_remaining != null ? (r.days_remaining < 0 ? 'เกิน ' + Math.abs(r.days_remaining) : r.days_remaining + ' วัน') : '-') + '</div></div>' +
        '</div>' +
        '<div class="ptext"><b>จุดที่ต้องปรับ:</b> ' + esc(r.concern_areas || '-') + '</div>' +
        '<div class="ptext"><b>success criteria:</b> ' + esc(r.success_criteria || '-') + '</div>' +
        '<div class="pcheck">' +
          (r.checkpoints || []).map(function (ck) { return '<div class="pck ' + (ck.completed_date ? 'done' : 'scheduled') + '">Day ' + esc(ck.day_marker) + (ck.completed_date ? ' ✓' : '') + '</div>'; }).join('') +
        '</div>' +
        (r.status === 'active' || r.status === 'extended' ? '<div class="pactions">' +
          '<button class="rb p" onclick="ppRecordCheckpoint(\'' + esc(r.pip_id) + '\')">บันทึก checkpoint</button>' +
          '<button class="rb improve" onclick="ppCloseCase(\'' + esc(r.pip_id) + '\', \'improved\')">Improved · ปิด</button>' +
          '<button class="rb terminate" onclick="ppCloseCase(\'' + esc(r.pip_id) + '\', \'terminated\')">Terminate</button>' +
        '</div>' : '<div class="ptext"><b>outcome:</b> ' + esc(r.outcome_summary || statusLabel(r.status)) + ' · ปิดเมื่อ ' + esc(r.closed_at) + '</div>') +
      '</div>';
    }).join('');
  }

  function triggerLabel(t) { return ({ disciplinary: 'จาก disciplinary', kpi_low: 'KPI ต่ำ', manager_request: 'manager request' })[t] || t; }
  function statusLabel(s) { return ({ active: 'active', extended: 'extended', improved: 'improved · ผ่าน', terminated: 'terminated', cancelled: 'cancelled' })[s] || s; }

  // ---- mutations: read-only บน dashboard → toast แจ้งยังไม่พร้อม (ไม่เปิด prompt) ----
  function recordCheckpoint() {
    showToast('ยังไม่พร้อมบน dashboard', 'error');
  }

  function closeCase() {
    showToast('ยังไม่พร้อมบน dashboard', 'error');
  }

  function newPip() {
    showToast('ยังไม่พร้อมบน dashboard', 'error');
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window (prefix pp* กันชน) ===== */
  window.ppReload = reload;
  window.ppSetTab = setTab;
  window.ppRecordCheckpoint = recordCheckpoint;
  window.ppCloseCase = closeCase;
  window.ppNewPip = newPip;

  /* ===== Init ===== */
  init();
}

// expose mount (index.html เรียกผ่าน PORTED_FN: mountPip)
if (typeof window !== 'undefined') window.mountPip = mountPip;
