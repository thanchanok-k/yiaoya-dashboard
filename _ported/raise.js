// _ported/raise.js — native port of desktop raise_manager.html (HR Announcement admin · หน้า "ปรับ/ขึ้นเงินเดือน")
// ลอกทั้งดุ้น: conf-banner + stats(4) + tabs(pending/pending_owner/approved/rejected/all) + table + approve/reject
//   CSS เดิม (_shared_styles ที่ใช้ + <style> หน้า manager) prefix #rs ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ RS_RUN_PAGE_JS() · google.script.run = shim → RS_BACKEND (Supabase)
//
// ใช้ global sb / esc / $ (index.html module scope) — ห้าม redeclare · helper inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน RS_RUN_PAGE_JS
//
// ** CONFIDENTIAL / PDPA ** หน้าปรับเงินเดือน sensitive — เป็นแค่ port หน้าจอ ไม่เพิ่ม logic ใหม่
//   ไม่มี/ไม่โชว์ ตัวเลข พรบ./severance ใด ๆ (หน้าเดิมก็ไม่มี) · banner CONFIDENTIAL คงไว้
//
// backend (edge fn hr_list?type=raise.updated → {items}) :
//   raiseAdminList(opts) → derive rows/counts client-side จาก payload ล่าสุดต่อ raise_id
//            (ตอนนี้ list อาจว่าง = 0 รายการ → render ได้ ไม่ error · empty state สวย)
//   raiseAdminApprove/raiseAdminReject → เขียนกลับไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   RS_BACKEND — map google.script.run → Supabase edge fn hr_list (type=raise.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     raiseAdminList(opts)          → { ok, rows, counts }
     raiseAdminApprove(id, opts)   → { ok / error } stub + toast
     raiseAdminReject(id, opts)    → { ok / error } stub + toast
   ============================================================ */
var RS_FN = 'hr_list';
var RS_TYPE = 'raise.updated';

function rs2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function rs2Num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function rs2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

var RS_STATUSES = ['pending_hr', 'pending_owner', 'approved', 'rejected'];
var RS_STATUS_LABEL = {
  pending_hr: 'รอ HR review',
  pending_owner: 'รอ Owner approve',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
};
var RS_TYPE_LABEL = {
  merit_raise: 'ขึ้นเงินเดือน (merit)',
  promotion: 'เลื่อนตำแหน่ง',
  adjustment: 'ปรับฐาน',
  cola: 'ปรับค่าครองชีพ',
};

// map payload event ดิบ → raise row shape ที่ JS เดิมใช้
function rs2MapRow(p) {
  p = p || {};
  var status = String(p.status || 'pending_hr').toLowerCase();
  if (RS_STATUSES.indexOf(status) < 0) status = 'pending_hr';
  var cur = rs2Num(p.current_salary);
  var prop = rs2Num(p.proposed_salary);
  var pct = p.percent_change != null ? rs2Num(p.percent_change)
    : (cur > 0 ? Math.round((prop - cur) / cur * 1000) / 10 : 0);
  var type = String(p.request_type || p.type || 'merit_raise').toLowerCase();
  return {
    raise_id: p.raise_id || p.entity_id || p.id || '',
    employee_id: p.employee_id || '',
    employee_name: p.employee_name || p.full_name || p.nickname || '—',
    position: p.position || p.position_name || '—',
    request_type: type,
    type_label: p.type_label || RS_TYPE_LABEL[type] || type,
    new_position_id: p.new_position_id || '',
    current_salary: cur,
    proposed_salary: prop,
    percent_change: pct,
    manager_name: p.manager_name || p.proposed_by_name || p.proposed_by || '—',
    proposed_at: rs2Date(p.proposed_at || p.created_at),
    status: status,
    status_label: p.status_label || RS_STATUS_LABEL[status] || status,
    _raw: p,
  };
}

// cache rows ล่าสุดต่อ raise_id (backend ไม่มี endpoint แยก)
var _rs2Rows = [];

function rs2FetchRows() {
  return sb.functions.invoke(RS_FN + '?type=' + encodeURIComponent(RS_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = rs2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.raise_id || p.entity_id || p.id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      rows.push(rs2MapRow(p));
    });
    _rs2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[RS_BACKEND] list fetch failed', e);
    _rs2Rows = [];
    return [];
  });
}

var RS_BACKEND = {
  // list — { ok, rows, counts } · กรองตาม tab
  raiseAdminList: function (opts) {
    opts = opts || {};
    return rs2FetchRows().then(function (all) {
      var tab = opts.tab || 'pending';
      var filtered = all.slice();
      if (tab === 'pending') filtered = filtered.filter(function (r) { return r.status === 'pending_hr' || r.status === 'pending_owner'; });
      else if (tab === 'pending_owner') filtered = filtered.filter(function (r) { return r.status === 'pending_owner'; });
      else if (tab === 'approved') filtered = filtered.filter(function (r) { return r.status === 'approved'; });
      else if (tab === 'rejected') filtered = filtered.filter(function (r) { return r.status === 'rejected'; });
      // tab === 'all' → ไม่กรอง

      filtered.sort(function (a, b) {
        return (b.proposed_at || '').localeCompare(a.proposed_at || '');
      });

      var byStatus = function (s) { return all.filter(function (r) { return r.status === s; }).length; };
      var counts = {
        pending_hr: byStatus('pending_hr'),
        pending_owner: byStatus('pending_owner'),
        approved: byStatus('approved'),
        rejected: byStatus('rejected'),
        all: all.length,
      };

      return { ok: true, rows: filtered, counts: counts };
    });
  },

  // ---- mutations: เขียนกลับ/อนุมัติไม่ได้บน dashboard → stub + toast ----
  raiseAdminApprove: function () {
    rs2NotReady('อนุมัติ raise/promotion');
    return Promise.resolve({ error: 'อนุมัติยังไม่พร้อมบน dashboard (read-only)' });
  },
  raiseAdminReject: function () {
    rs2NotReady('ไม่อนุมัติ raise/promotion');
    return Promise.resolve({ error: 'ไม่อนุมัติยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _rs2NotReadyShown = {};
function rs2NotReady(feature) {
  if (_rs2NotReadyShown[feature]) return;
  _rs2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.rs2Toast) window.rs2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountRaise — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountRaise() {
  if (!document.getElementById('wrap-raise')) return;
  var wrap = document.getElementById('wrap-raise');
  wrap.innerHTML = '<style>' + RS_CSS() + '</style><div id="rs">' + RS_MARKUP() + '</div>';
  RS_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #rs =====
   ตัด .app-shell/sidebar/main-area/.top shell ออก (dashboard มี shell แล้ว) */
function RS_CSS() {
  return [
    // tokens (มาจาก _shared_styles + alias เก่าของหน้าเดิม)
    '#rs{--navy:#0D2F4F;--teal:#3DC5B7;--teal-dark:#2BA89B;--teal-light:#E6F7F5;--surface:#fff;--bg:#F8F9FA;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--muted:#6B7280;--text-muted:#64748B;--danger:#DC2626;--error:#DC2626;--warn:#F59E0B;--warning:#F59E0B;--success:#16A34A;color:var(--navy);font-size:14px;line-height:1.5}',
    '#rs *,#rs *::before,#rs *::after{box-sizing:border-box}',
    // page head (native บน dashboard · ไม่มี shell page-head เดิม)
    '#rs .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:0;padding:0 0 14px;border-bottom:1px solid var(--border)}',
    '#rs .page-head h1{font-size:20px;font-weight:600;color:var(--navy);margin:0;display:flex;align-items:center;gap:8px}',
    '#rs .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#rs .page-head .subtitle{font-size:12px;color:var(--muted);margin-top:4px}',
    '#rs .page-actions{display:flex;gap:8px;align-items:center}',
    '#rs .page-badge{background:#7C3AED;color:#fff;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600}',
    // confidential banner
    '#rs .conf-banner{background:#FEF3C7;border-left:3px solid var(--warn);padding:9px 14px;font-size:11px;color:#92400E;border-radius:6px;margin:14px 0}',
    '#rs .conf-banner b{color:#92400E}',
    // stat cards
    '#rs .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:0 0 16px}',
    '@media (max-width:768px){#rs .stats{grid-template-columns:repeat(2,1fr)}}',
    '#rs .st{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;border-left-width:3px}',
    '#rs .st.h{border-left-color:var(--warn)}',
    '#rs .st.o{border-left-color:#7C3AED}',
    '#rs .st.a{border-left-color:var(--success)}',
    '#rs .st.r{border-left-color:var(--error)}',
    '#rs .st-n{font-size:24px;font-weight:600}',
    '#rs .st-l{font-size:11px;color:var(--muted);margin-top:3px}',
    // tabs
    '#rs .tabs{display:flex;gap:2px;padding:0;border-bottom:1px solid var(--border);background:#fff;flex-wrap:wrap}',
    '#rs .tab{padding:11px 16px;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;font-weight:500}',
    '#rs .tab.act{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    '#rs .tab-c{background:var(--bg);padding:1px 7px;border-radius:99px;font-size:10px;margin-left:4px}',
    // body / table
    '#rs .body{padding:14px 0}',
    '#rs table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)}',
    '#rs th{background:var(--navy);color:#fff;padding:11px 12px;font-size:11px;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:.3px}',
    '#rs td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border)}',
    '#rs tr:hover td{background:var(--teal-light)}',
    // pills
    '#rs .pill{display:inline-flex;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600}',
    '#rs .pill.pending_hr{background:#FEF3C7;color:#B45309}',
    '#rs .pill.pending_owner{background:#EDE9FE;color:#5B21B6}',
    '#rs .pill.approved{background:#D1FAE5;color:#047857}',
    '#rs .pill.rejected{background:#FEE2E2;color:#B91C1C}',
    // percent
    '#rs .pct{font-weight:600}',
    '#rs .pct.high{color:var(--error)}',
    '#rs .pct.med{color:var(--warn)}',
    '#rs .pct.low{color:var(--success)}',
    // row action buttons
    '#rs .rb{padding:5px 10px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:#fff;color:var(--navy)}',
    '#rs .rb.app{background:var(--success);color:#fff;border-color:var(--success)}',
    '#rs .rb.rej{background:var(--error);color:#fff;border-color:var(--error)}',
    // empty
    '#rs .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + conf-banner + stats + tabs + body =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell/.top ออก */
function RS_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    '      Raise / Promotion Manager',
    '    </h1>',
    '    <div class="subtitle">ขอขึ้นเงินเดือน / เลื่อนตำแหน่ง · HR + Owner approval workflow</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <span class="page-badge">CONFIDENTIAL</span>',
    '  </div>',
    '</header>',
    // confidential banner
    '<div class="conf-banner">',
    '  <b>CONFIDENTIAL</b> · ข้อมูลเงินเดือนเปิดดูเฉพาะ HR Manager + Owner · ส่งให้ HR_MANAGER_EMAIL เท่านั้น',
    '</div>',
    // stats
    '<div class="stats">',
    '  <div class="st h"><div><div class="st-n" id="stH">–</div><div class="st-l">รอ HR review</div></div></div>',
    '  <div class="st o"><div><div class="st-n" id="stO">–</div><div class="st-l">รอ Owner approve</div></div></div>',
    '  <div class="st a"><div><div class="st-n" id="stA">–</div><div class="st-l">อนุมัติแล้ว</div></div></div>',
    '  <div class="st r"><div><div class="st-n" id="stR">–</div><div class="st-l">ไม่อนุมัติ</div></div></div>',
    '</div>',
    // tabs + body
    '<div class="tabs" id="tabs"></div>',
    '<div class="body" id="bodyWrap"><div class="empty">กำลังโหลด...</div></div>',
  ].join('\n');
}

/* ============================================================
   RS_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → RS_BACKEND
   helper (showToast/esc) inline · document.getElementById → scope ใต้ #rs
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function RS_RUN_PAGE_JS() {

  // ---- google.script.run shim → RS_BACKEND (async, คืน shape เดิม) ----
  function _rs2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (RS_BACKEND[prop]) {
            Promise.resolve().then(function () { return RS_BACKEND[prop].apply(RS_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[RS_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[RS_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _rs2MakeChain(); } });

  // ---- helpers (inline) ----
  var _rsRoot = document.getElementById('rs');
  function $id(id) { return _rsRoot ? _rsRoot.querySelector('#' + id) : document.getElementById(id); }
  // alias เพื่อให้โค้ดเดิม document.getElementById(...) ยังทำงาน → ใช้ getById ใน scope
  function getById(id) { return $id(id); }

  function showToast(msg, type) {
    var t = document.getElementById('rs2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'rs2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.rs2Toast = showToast;

  /* ====================================================================
     ===== JS หน้าเดิม raise_manager.html (ลอกทั้งดุ้น) =====
     prompt()/alert() ของหน้าเดิม → แทนด้วย showToast แจ้ง read-only (stub)
     ==================================================================== */
  var _state = { tab: 'pending', rows: [], counts: {} };

  function init() { reload(); }

  function reload() {
    getById('bodyWrap').innerHTML = '<div class="empty">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(onLoaded).raiseAdminList({ tab: _state.tab });
  }

  function onLoaded(r) {
    if (!r || !r.ok) {
      getById('bodyWrap').innerHTML = '<div class="empty">โหลดล้มเหลว</div>';
      return;
    }
    _state.rows = r.rows || [];
    _state.counts = r.counts || {};
    getById('stH').textContent = _state.counts.pending_hr || 0;
    getById('stO').textContent = _state.counts.pending_owner || 0;
    getById('stA').textContent = _state.counts.approved || 0;
    getById('stR').textContent = _state.counts.rejected || 0;
    renderTabs(); renderTable();
  }

  function renderTabs() {
    var c = _state.counts;
    var tabs = [
      { k: 'pending', l: 'รอ review', n: (c.pending_hr || 0) + (c.pending_owner || 0) },
      { k: 'pending_owner', l: 'รอ Owner', n: c.pending_owner || 0 },
      { k: 'approved', l: 'อนุมัติ', n: c.approved || 0 },
      { k: 'rejected', l: 'ไม่อนุมัติ', n: c.rejected || 0 },
      { k: 'all', l: 'ทั้งหมด', n: c.all || 0 },
    ];
    getById('tabs').innerHTML = tabs.map(function (t) {
      return '<div class="tab ' + (_state.tab === t.k ? 'act' : '') + '" onclick="setTab(\'' + t.k + '\')">' + t.l + '<span class="tab-c">' + t.n + '</span></div>';
    }).join('');
  }

  function setTab(k) { _state.tab = k; reload(); }

  function renderTable() {
    if (!_state.rows.length) { getById('bodyWrap').innerHTML = '<div class="empty">ไม่มีรายการ</div>'; return; }
    var html = '<table><thead><tr>' +
      '<th>พนักงาน</th><th>ประเภท</th><th>การเปลี่ยนแปลง</th><th>เสนอโดย</th><th>วันที่</th><th>สถานะ</th><th>Actions</th>' +
      '</tr></thead><tbody>';
    html += _state.rows.map(function (r) {
      var pctCls = r.percent_change >= 15 ? 'high' : r.percent_change >= 10 ? 'med' : 'low';
      return '<tr>' +
        '<td><b>' + esc(r.employee_name) + '</b><div style="font-size:10px;color:var(--muted);">' + esc(r.position) + '</div></td>' +
        '<td>' + esc(r.type_label) + (r.new_position_id ? '<div style="font-size:10px;color:var(--muted);">→ ' + esc(r.new_position_id) + '</div>' : '') + '</td>' +
        '<td>' + r.current_salary.toLocaleString() + ' → ' + r.proposed_salary.toLocaleString() + ' ฿<div class="pct ' + pctCls + '">+' + r.percent_change + '%</div></td>' +
        '<td>' + esc(r.manager_name) + '</td>' +
        '<td>' + esc(r.proposed_at) + '</td>' +
        '<td><span class="pill ' + esc(r.status) + '">' + esc(r.status_label) + '</span></td>' +
        '<td>' + (r.status === 'pending_hr' || r.status === 'pending_owner' ?
          '<button class="rb app" onclick=\'approveR(' + JSON.stringify(r.raise_id) + ')\'>อนุมัติ</button> ' +
          '<button class="rb rej" onclick=\'rejectR(' + JSON.stringify(r.raise_id) + ')\'>ไม่อนุมัติ</button>'
          : '') + '</td>' +
        '</tr>';
    }).join('');
    html += '</tbody></table>';
    getById('bodyWrap').innerHTML = html;
  }

  function approveR(id) {
    // dashboard read-only → stub + toast (เดิม: prompt notes → raiseAdminApprove)
    google.script.run.withSuccessHandler(function (r) {
      if (r && r.ok) { showToast('Approved · new status: ' + r.new_status, 'success'); reload(); }
      else showToast((r && r.error) || 'Approve ล้มเหลว', 'error');
    }).raiseAdminApprove(id, { notes: '' });
  }

  function rejectR(id) {
    // dashboard read-only → stub + toast (เดิม: prompt reason → raiseAdminReject)
    google.script.run.withSuccessHandler(function (r) {
      if (r && r.ok) reload();
      else showToast((r && r.error) || 'Reject ล้มเหลว', 'error');
    }).raiseAdminReject(id, { notes: '' });
  }

  // esc — ใช้ global window.esc ถ้ามี · ไม่งั้น fallback inline (ห้าม redeclare global)
  var esc = (typeof window !== 'undefined' && window.esc) ? window.esc : function (s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ===== expose fn ที่ inline onclick ต้องเรียก ไปยัง window ===== */
  var _exp = { setTab: setTab, approveR: approveR, rejectR: rejectR };
  Object.keys(_exp).forEach(function (k) { window[k] = _exp[k]; });

  /* ===== Init ===== */
  init();
}

/* ===== expose mount ไปยัง window (เรียกจาก index.html router) ===== */
if (typeof window !== 'undefined') window.mountRaise = mountRaise;
