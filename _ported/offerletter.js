// _ported/offerletter.js — FULL native port of desktop offer_letter_manager.html (HR Announcement admin · หน้า "จดหมายเสนองาน")
// ลอกทั้งดุ้น (verbatim): page-head + yh-quick-stats(4) + top bar + stats(5) + tabs + table + create/detail modal
//   CSS เดิม (<style> หน้า manager · ทั้ง 2 บล็อก) prefix #ol ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ OL_RUN_PAGE_JS() · google.script.run = shim → OL_BACKEND (Supabase)
//
// ใช้ global window.sb/window.esc/window.$ (index.html) — ห้าม redeclare · helper inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน OL_RUN_PAGE_JS
//
// ⚠️ ข้อมูลเงินเดือนใน offer = sensitive (PDPA) — แค่ port หน้าจอ ไม่เพิ่ม logic ใหม่
//
// backend (edge fn hr_list?type=offer.updated&limit=2000 → {items}) :
//   offerAdminList(opts) → derive rows/counts client-side จาก payload ล่าสุดต่อ offer
//                          (ตอนนี้ list อาจว่าง = 0 offer → render ได้ ไม่ error · empty state)
//   offerAdminCreate/Send/Withdraw/RemindPaperwork → เขียนกลับ/ส่ง LINE/gen PDF ไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   OL_BACKEND — map google.script.run → Supabase edge fn hr_list (type=offer.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     offerAdminList(opts) → { ok, rows, counts }
     mutations            → { ok / error } stub + toast
   ============================================================ */
var OL_FN = 'hr_list';
var OL_TYPE = 'offer.updated';
var OL_LIMIT = 2000;

function ol2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function ol2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function ol2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function ol2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

var OL_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'];

// map payload event ดิบ → offer row shape ที่ JS เดิมใช้
function ol2MapOffer(p) {
  p = p || {};
  var status = String(p.status || 'draft').toLowerCase();
  if (OL_STATUSES.indexOf(status) < 0) status = 'draft';
  return {
    offer_id: p.offer_id || p.entity_id || p.id || '',
    candidate_id: p.candidate_id || '',
    candidate_name: p.candidate_name || p.name || p.full_name || '—',
    position_id: p.position_id || '',
    branch_id: p.branch_id || '',
    offered_salary: ol2Num(p.offered_salary != null ? p.offered_salary : p.salary),
    offered_start_date: ol2Date(p.offered_start_date || p.offer_start_date || p.start_date),
    status: status,
    expires_at: ol2Date(p.expires_at),
    paperwork_complete: ol2Bool(p.paperwork_complete),
    _raw: p,
  };
}

// cache payload ดิบล่าสุดต่อ offer
var _ol2Rows = [];

function ol2FetchOffers() {
  return sb.functions
    .invoke(OL_FN + '?type=' + encodeURIComponent(OL_TYPE) + '&limit=' + OL_LIMIT)
    .then(function (res) {
      var data = (res && res.data) || {};
      var items = ol2ToArr(data.items);
      var seen = {}; var rows = [];
      items.forEach(function (p) {
        var id = p.offer_id || p.entity_id || p.id || '';
        if (!id || seen[id]) return;
        seen[id] = true;
        rows.push(ol2MapOffer(p));
      });
      _ol2Rows = rows;
      return rows;
    })
    .catch(function (e) {
      console.warn('[OL_BACKEND] list fetch failed', e);
      _ol2Rows = [];
      return [];
    });
}

var OL_BACKEND = {
  // list — { ok, rows, counts } (กรองตาม tab client-side)
  offerAdminList: function (opts) {
    opts = opts || {};
    return ol2FetchOffers().then(function (all) {
      var tab = opts.tab || 'all';
      var rows = (tab && tab !== 'all')
        ? all.filter(function (r) { return r.status === tab; })
        : all.slice();

      // sort: ใหม่สุด (expires/start) ก่อน
      rows.sort(function (a, b) {
        return (b.offered_start_date || '').localeCompare(a.offered_start_date || '');
      });

      var counts = {
        all: all.length,
        draft: all.filter(function (r) { return r.status === 'draft'; }).length,
        sent: all.filter(function (r) { return r.status === 'sent'; }).length,
        accepted: all.filter(function (r) { return r.status === 'accepted'; }).length,
        declined: all.filter(function (r) { return r.status === 'declined'; }).length,
        expired: all.filter(function (r) { return r.status === 'expired'; }).length,
      };

      return { ok: true, rows: rows, counts: counts };
    });
  },

  // ---- mutations: เขียนกลับ/ส่ง LINE/gen PDF ไม่ได้บน dashboard → stub + toast ----
  offerAdminCreate: function () {
    ol2NotReady('สร้าง offer letter (gen PDF)');
    return Promise.resolve({ error: 'สร้าง offer ยังไม่พร้อมบน dashboard (read-only)' });
  },
  offerAdminSend: function () {
    ol2NotReady('ส่ง offer letter ทาง LINE');
    return Promise.resolve({ error: 'ส่ง offer ยังไม่พร้อมบน dashboard' });
  },
  offerAdminWithdraw: function () {
    ol2NotReady('ถอน offer');
    return Promise.resolve({ error: 'ถอน offer ยังไม่พร้อมบน dashboard (read-only)' });
  },
  offerAdminRemindPaperwork: function () {
    ol2NotReady('ส่งเตือนเอกสารทาง LINE');
    return Promise.resolve({ error: 'ส่งเตือนยังไม่พร้อมบน dashboard' });
  },
};

var _ol2NotReadyShown = {};
function ol2NotReady(feature) {
  if (_ol2NotReadyShown[feature]) return;
  _ol2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ol2Toast) window.ol2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountOfferletter — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountOfferletter() {
  if (!document.getElementById('wrap-offerletter')) return;
  var wrap = document.getElementById('wrap-offerletter');
  wrap.innerHTML = '<style>' + OL_CSS() + '</style><div id="ol">' + OL_MARKUP() + '</div>';
  OL_RUN_PAGE_JS();
}

/* ===== CSS เดิม (ทั้ง 2 <style> ของ manager) · prefix ทุก selector ด้วย #ol =====
   ตัด .app-shell/sidebar/main-area/topbar shell ออก (dashboard มี shell แล้ว) */
function OL_CSS() {
  return [
    // tokens (จาก :root เดิม → scope #ol)
    '#ol{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--bg:#F8F9FA;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--warn:#F59E0B;--success:#16A34A;color:var(--navy);font-size:14px}',
    '#ol,#ol *,#ol *::before,#ol *::after{box-sizing:border-box}',
    // top bar
    '#ol .top{background:var(--navy);color:white;padding:14px 20px;display:flex;align-items:center;gap:12px;border-radius:8px}',
    '#ol .top-t{font-size:16px;font-weight:600}',
    '#ol .top-b{background:var(--teal);padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600}',
    '#ol .top-spacer{flex:1}',
    '#ol .btn-p{background:var(--teal);color:white;padding:8px 14px;border-radius:7px;font-size:12px;font-weight:500;border:none;cursor:pointer}',
    // stats (5 cards)
    '#ol .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:16px 0}',
    '@media (max-width:700px){#ol .stats{grid-template-columns:repeat(2,1fr)}}',
    '#ol .st{background:white;border:1px solid var(--border);border-radius:10px;padding:12px;border-left-width:3px}',
    '#ol .st-n{font-size:22px;font-weight:600}',
    '#ol .st-l{font-size:10px;color:var(--muted);margin-top:3px}',
    '#ol .st.d{border-left-color:#9CA3AF}',
    '#ol .st.s{border-left-color:var(--warn)}',
    '#ol .st.a{border-left-color:var(--success)}',
    '#ol .st.dc{border-left-color:var(--error)}',
    '#ol .st.e{border-left-color:#7C3AED}',
    // tabs
    '#ol .tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);background:white;border-radius:8px 8px 0 0;flex-wrap:wrap}',
    '#ol .tab{padding:11px 16px;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;font-weight:500}',
    '#ol .tab.act{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    '#ol .tab-c{background:var(--bg);padding:1px 7px;border-radius:99px;font-size:10px;margin-left:4px}',
    // body / table
    '#ol .body{padding:14px 0}',
    '#ol table{width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;border:1px solid var(--border)}',
    '#ol th{background:var(--navy);color:white;padding:11px 12px;font-size:11px;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:0.3px}',
    '#ol td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border)}',
    '#ol tr:hover td{background:var(--teal-light)}',
    // pills
    '#ol .pill{display:inline-flex;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600}',
    '#ol .pill.draft{background:#F3F4F6;color:#4B5563}',
    '#ol .pill.sent{background:#FEF3C7;color:#B45309}',
    '#ol .pill.accepted{background:#D1FAE5;color:#047857}',
    '#ol .pill.declined{background:#FEE2E2;color:#B91C1C}',
    '#ol .pill.expired{background:#EDE9FE;color:#5B21B6}',
    // row buttons
    '#ol .rb{padding:5px 10px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:white;color:var(--navy)}',
    '#ol .rb.p{background:var(--teal);color:white;border-color:var(--teal)}',
    '#ol .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    // modal
    '#ol .modal-bg{display:none;position:fixed;inset:0;background:rgba(13,47,79,0.6);z-index:9000;align-items:center;justify-content:center;padding:20px}',
    '#ol .modal-bg.open{display:flex}',
    '#ol .modal{background:white;border-radius:14px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto}',
    '#ol .modal-h{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
    '#ol .modal-x{background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer}',
    '#ol .modal-b{padding:16px 20px}',
    '#ol .field{margin-bottom:11px}',
    '#ol .field-l{display:block;font-size:11px;font-weight:600;margin-bottom:5px}',
    '#ol .field-i{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit}',
    '#ol .field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    // page-head (native บน dashboard)
    '#ol .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #E2E8F0}',
    '#ol .page-head h1{font-size:20px;font-weight:600;color:#0D2F4F;letter-spacing:-0.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ol .page-head h1 svg{width:18px;height:18px;color:#3DC5B7}',
    '#ol .page-head .subtitle{font-size:12px;color:#64748B;margin-top:4px}',
    '#ol .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}',
    // yh-quick-stats (4 cards · จาก <style> ท้ายไฟล์)
    '#ol .yh-quick-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}',
    '@media (max-width:900px){#ol .yh-quick-stats{grid-template-columns:repeat(2,1fr)}}',
    '#ol .yh-qs-card{background:white;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;position:relative;overflow:hidden;cursor:help}',
    '#ol .yh-qs-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#ol .yh-qs-card.warn::before{background:#F59E0B}',
    '#ol .yh-qs-card.danger::before{background:#EF4444}',
    '#ol .yh-qs-card.info::before{background:#185FA5}',
    '#ol .yh-qs-card.success::before{background:#10B981}',
    '#ol .yh-qs-lbl{font-size:10px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:0.05em;display:flex;align-items:center;gap:4px}',
    '#ol .yh-qs-lbl svg{width:11px;height:11px;color:#94A3B8}',
    '#ol .yh-qs-val{font-size:22px;font-weight:700;color:#0D2F4F;line-height:1;margin-top:6px;letter-spacing:-0.02em}',
    '#ol .yh-qs-sub{font-size:10px;color:#94A3B8;margin-top:3px}',
  ].join('\n');
}

/* ===== markup เดิม ครบ page-head + quick-stats + top + stats + tabs + body + modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก
   refresh ใช้ loadList() แทน location.reload() (อยู่ใน SPA shell) */
function OL_MARKUP() {
  return [
    // page-head
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/></svg>',
    '      Offer Letter Manager',
    '    </h1>',
    '    <div class="subtitle">สร้าง offer letter PDF + ส่งให้ candidate e-sign · auto-trigger onboarding</div>',
    '  </div>',
    '  <div class="page-actions" id="yh-page-actions"><button class="rb" onclick="reload()" title="Refresh">↻ Refresh</button></div>',
    '</header>',
    // quick stats (4)
    '<div class="yh-quick-stats">',
    '  <div class="yh-qs-card info" data-tip="จำนวน offer letter ที่ส่งให้ candidate ในเดือนนี้">',
    '    <div class="yh-qs-lbl">Offer เดือนนี้</div>',
    '    <div class="yh-qs-val" id="yh-qs-sent">—</div>',
    '    <div class="yh-qs-sub">ที่ส่งไป</div>',
    '  </div>',
    '  <div class="yh-qs-card warn" data-tip="Offer ที่ยังไม่ได้ตอบรับ/ปฏิเสธ · มี deadline 7 วัน">',
    '    <div class="yh-qs-lbl">รอตอบ</div>',
    '    <div class="yh-qs-val" id="yh-qs-pending">—</div>',
    '    <div class="yh-qs-sub">รอ candidate</div>',
    '  </div>',
    '  <div class="yh-qs-card success" data-tip="Offer ที่ตอบรับ · auto-create employee + onboarding case">',
    '    <div class="yh-qs-lbl">รับงาน</div>',
    '    <div class="yh-qs-val" id="yh-qs-accepted">—</div>',
    '    <div class="yh-qs-sub">เดือนนี้</div>',
    '  </div>',
    '  <div class="yh-qs-card" data-tip="Offer ที่ปฏิเสธ · มีเหตุผลให้ดูใน notes · ใช้วิเคราะห์ trend">',
    '    <div class="yh-qs-lbl">ปฏิเสธ</div>',
    '    <div class="yh-qs-val" id="yh-qs-declined">—</div>',
    '    <div class="yh-qs-sub">เดือนนี้</div>',
    '  </div>',
    '</div>',
    // top bar
    '<div class="top">',
    '  <div class="top-t">Offer Letter Manager</div>',
    '  <div class="top-b">OFR</div>',
    '  <div class="top-spacer"></div>',
    '  <button class="btn-p" onclick="openCreate()">+ สร้าง offer</button>',
    '</div>',
    // stats (5)
    '<div class="stats">',
    '  <div class="st d"><div class="st-n" id="stD">–</div><div class="st-l">Draft</div></div>',
    '  <div class="st s"><div class="st-n" id="stS">–</div><div class="st-l">รอตอบรับ</div></div>',
    '  <div class="st a"><div class="st-n" id="stA">–</div><div class="st-l">ตอบรับแล้ว</div></div>',
    '  <div class="st dc"><div class="st-n" id="stDC">–</div><div class="st-l">ปฏิเสธ</div></div>',
    '  <div class="st e"><div class="st-n" id="stE">–</div><div class="st-l">หมดอายุ</div></div>',
    '</div>',
    // tabs + body
    '<div class="tabs" id="tabs"></div>',
    '<div class="body" id="bodyWrap"><div class="empty">กำลังโหลด...</div></div>',
    // modal
    '<div class="modal-bg" id="modalBg" onclick="if(event.target===this)closeModal()">',
    '  <div class="modal">',
    '    <div class="modal-h"><div style="font-size:15px; font-weight:600;" id="mt"></div><button class="modal-x" onclick="closeModal()">×</button></div>',
    '    <div class="modal-b" id="mb"></div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   OL_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → OL_BACKEND
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function OL_RUN_PAGE_JS() {

  // ---- google.script.run shim → OL_BACKEND (async, คืน shape เดิม) ----
  function _ol2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (OL_BACKEND[prop]) {
            Promise.resolve().then(function () { return OL_BACKEND[prop].apply(OL_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[OL_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[OL_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ol2MakeChain(); } });

  // ---- helper (scope ใต้ #ol กันชน id) ----
  const _olRoot = document.getElementById('ol');
  function getById(id) { return _olRoot ? _olRoot.querySelector('#' + id) : document.getElementById(id); }
  // shim alert/confirm/prompt ไม่ทับ global · ใช้ native ได้ปกติ

  // toast (สำหรับ stub mutations)
  function showToast(msg, type) {
    let t = document.getElementById('ol2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ol2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ol2Toast = showToast;

  /* ====================================================================
     ===== JS หน้าเดิม offer_letter_manager.html (ลอกทั้งดุ้น) =====
     document.getElementById(...) → getById(...) (scope #ol)
     ==================================================================== */
  let _state = { tab: 'all', rows: [], counts: {} };
  function init() { reload(); }
  function reload() {
    getById('bodyWrap').innerHTML = '<div class="empty">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(onLoaded).offerAdminList({ tab: _state.tab });
  }
  function onLoaded(r) {
    if (!r || !r.ok) return;
    _state.rows = r.rows || [];
    _state.counts = r.counts || {};
    ['D', 'S', 'A', 'DC', 'E'].forEach((k, i) => {
      const map = ['draft', 'sent', 'accepted', 'declined', 'expired'];
      getById('st' + k).textContent = _state.counts[map[i]] || 0;
    });
    // quick-stats (4) — derive จาก counts (port หน้าจอ · ไม่กรองตามเดือนเพิ่ม)
    const qs = {
      'yh-qs-sent': _state.counts.sent || 0,
      'yh-qs-pending': _state.counts.sent || 0,
      'yh-qs-accepted': _state.counts.accepted || 0,
      'yh-qs-declined': _state.counts.declined || 0,
    };
    Object.keys(qs).forEach(id => { const el = getById(id); if (el) el.textContent = qs[id]; });
    renderTabs(); renderTable();
  }
  function renderTabs() {
    const c = _state.counts;
    const tabs = [
      { k: 'all', l: 'ทั้งหมด', n: c.all || 0 },
      { k: 'draft', l: 'Draft', n: c.draft || 0 },
      { k: 'sent', l: 'รอตอบรับ', n: c.sent || 0 },
      { k: 'accepted', l: 'ตอบรับ', n: c.accepted || 0 },
      { k: 'declined', l: 'ปฏิเสธ', n: c.declined || 0 },
      { k: 'expired', l: 'หมดอายุ', n: c.expired || 0 },
    ];
    getById('tabs').innerHTML = tabs.map(t =>
      `<div class="tab ${_state.tab === t.k ? 'act' : ''}" onclick="setTab('${t.k}')">${t.l}<span class="tab-c">${t.n}</span></div>`
    ).join('');
  }
  function setTab(k) { _state.tab = k; reload(); }
  function renderTable() {
    if (!_state.rows.length) { getById('bodyWrap').innerHTML = '<div class="empty">ไม่มี offer</div>'; return; }
    let html = `<table><thead><tr>
      <th>Candidate</th><th>Position · Branch</th><th>เงินเดือน</th><th>เริ่มงาน</th><th>Status</th><th>หมดอายุ</th><th>Actions</th>
    </tr></thead><tbody>`;
    html += _state.rows.map(r => `<tr>
      <td><b>${esc(r.candidate_name)}</b><div style="font-size:10px;color:var(--muted);">${esc(r.candidate_id)}</div></td>
      <td>${esc(r.position_id)} · ${esc(r.branch_id)}</td>
      <td>${(r.offered_salary || 0).toLocaleString()} ฿</td>
      <td>${esc(r.offered_start_date)}</td>
      <td><span class="pill ${esc(r.status)}">${statusLabel(r.status)}</span>
        ${r.paperwork_complete ? '<div style="font-size:9px;color:var(--success);margin-top:3px;">paperwork done</div>' : ''}
      </td>
      <td>${esc(r.expires_at)}</td>
      <td style="white-space:nowrap;">
        ${r.status === 'draft' ? `<button class="rb p" onclick="sendOffer('${esc(r.offer_id)}')">ส่ง</button>` : ''}
        ${(r.status === 'draft' || r.status === 'sent') ? `<button class="rb" onclick="withdrawOffer('${esc(r.offer_id)}')">ถอน</button>` : ''}
        ${r.status === 'accepted' && !r.paperwork_complete ? `<button class="rb" onclick="remindPaperwork('${esc(r.offer_id)}')">เตือนเอกสาร</button>` : ''}
      </td>
    </tr>`).join('');
    html += '</tbody></table>';
    getById('bodyWrap').innerHTML = html;
  }
  function statusLabel(s) { return ({ draft: 'ร่าง', sent: 'รอตอบรับ', accepted: 'ตอบรับ', declined: 'ปฏิเสธ', expired: 'หมดอายุ' })[s] || s; }

  function openCreate() {
    getById('mt').textContent = 'สร้าง Offer Letter';
    getById('mb').innerHTML = `
      <div class="field"><label class="field-l">Candidate ID</label>
        <input class="field-i" id="fCid" placeholder="CAND-..."></div>
      <div class="field-row">
        <div class="field"><label class="field-l">Position ID</label>
          <input class="field-i" id="fPos" placeholder="POS01"></div>
        <div class="field"><label class="field-l">Branch ID</label>
          <input class="field-i" id="fBr" placeholder="BR00"></div>
      </div>
      <div class="field-row">
        <div class="field"><label class="field-l">เงินเดือนเสนอ (฿)</label>
          <input class="field-i" type="number" id="fSal"></div>
        <div class="field"><label class="field-l">probation (เดือน)</label>
          <input class="field-i" type="number" id="fProb" value="3"></div>
      </div>
      <div class="field"><label class="field-l">วันเริ่มงาน</label>
        <input class="field-i" type="date" id="fStart"></div>
      <div class="field"><label class="field-l">benefits summary</label>
        <textarea class="field-i" id="fBen" rows="2"></textarea></div>
      <div class="field"><label class="field-l">special terms (optional)</label>
        <textarea class="field-i" id="fSpec" rows="2"></textarea></div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="rb" onclick="closeModal()">ยกเลิก</button>
        <button class="rb p" onclick="saveOffer()">บันทึก</button>
      </div>`;
    getById('modalBg').classList.add('open');
  }

  function saveOffer() {
    const payload = {
      candidate_id: getById('fCid').value.trim(),
      position_id: getById('fPos').value.trim(),
      branch_id: getById('fBr').value.trim(),
      offered_salary: getById('fSal').value,
      offered_start_date: getById('fStart').value,
      probation_months: getById('fProb').value,
      benefits_summary: getById('fBen').value,
      special_terms: getById('fSpec').value,
    };
    if (!payload.candidate_id) { alert('Candidate ID required'); return; }
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) { closeModal(); reload(); }
      else alert('สร้างไม่สำเร็จ · ' + (r && r.error));
    }).offerAdminCreate(payload);
  }

  function sendOffer(id) {
    if (!confirm('ส่ง offer letter ไปหา candidate ตอนนี้?')) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) reload();
      else alert('ส่งล้มเหลว · ' + (r && r.error));
    }).offerAdminSend(id);
  }

  // v1.10.60 — withdraw + paperwork reminder
  function withdrawOffer(id) {
    const reason = prompt('เหตุผลที่ถอน offer (อย่างน้อย 3 ตัวอักษร) ·\n· เช่น "ตำแหน่งถูกระงับ" / "เปลี่ยน strategy"');
    if (!reason || reason.trim().length < 3) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) { alert('ถอน offer แล้ว'); reload(); }
      else alert('ถอนไม่สำเร็จ · ' + (r && r.error));
    }).offerAdminWithdraw(id, reason.trim());
  }

  function remindPaperwork(id) {
    if (!confirm('ส่ง flex เตือน candidate ให้อัปโหลดเอกสารที่ขาด?')) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) alert('ส่งเตือนแล้ว · ขาด ' + r.missing + ' รายการ');
      else alert('ส่งไม่สำเร็จ · ' + (r && r.error));
    }).offerAdminRemindPaperwork(id);
  }

  function closeModal() { getById('modalBg').classList.remove('open'); }
  // esc(): ใช้ global window.esc · fallback inline ถ้าไม่มี
  function esc(s) {
    if (typeof window !== 'undefined' && typeof window.esc === 'function') return window.esc(s);
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ===== expose fn ที่ inline onclick ต้องเรียก ไปยัง window ===== */
  const _exp = {
    reload, setTab, openCreate, saveOffer, sendOffer,
    withdrawOffer, remindPaperwork, closeModal, esc,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  init();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountOfferletter) */
if (typeof window !== 'undefined') {
  window.mountOfferletter = mountOfferletter;
  window.OL_BACKEND = OL_BACKEND;
}
