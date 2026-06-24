// _ported/openpos.js — FULL native port of desktop open_position_manager.html (HR Announcement admin · หน้า "ตำแหน่งเปิดรับ")
// ลอกทั้งดุ้น: stats(5) + tabs(active/pending/draft/filled/closed) + requisition list cards
//   + create modal (position/branch/headcount/type/salary/reason/jd/req/target) + workflow buttons
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix #op ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ OP_RUN_PAGE_JS() · google.script.run = shim → OP_BACKEND (Supabase)
//
// ใช้ global window.sb (index.html module scope) — ห้าม redeclare · helper (esc/$/showToast) inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน OP_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=open_position.updated → {items}) :
//   READ  → derive requisitions/stats/lookups client-side จาก payload ล่าสุดต่อ req
//           (ตอนนี้ list อาจว่าง = 0 requisition → render ได้ ไม่ error · empty state สวย)
//   WRITE → openPositionCreate/Submit/Approve/Reject/Close → เขียนกลับไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   OP_BACKEND — map google.script.run → Supabase edge fn hr_list (type=open_position.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     openPositionList(opts)   → { items, stats, lookups }
     mutations                → { error } stub + toast
   ============================================================ */
var OP_FN = 'hr_list';
var OP_TYPE = 'open_position.updated';

function op2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function op2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function op2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// map payload event ดิบ → requisition row shape ที่ JS เดิมใช้
function op2MapReq(p) {
  p = p || {};
  var status = String(p.status || 'draft').toLowerCase();
  var approvalStatus = String(p.approval_status || '').toLowerCase();
  if (!approvalStatus) {
    if (status === 'draft') approvalStatus = 'draft';
    else if (status === 'pending' || status === 'pending_owner') approvalStatus = 'pending_owner';
    else approvalStatus = 'approved';
  }
  var openedAt = op2Date(p.opened_at || p.approved_at || p.created_at);
  var daysOpen = null;
  if (status === 'open' && openedAt) {
    var d0 = new Date(openedAt); var today = new Date(); today.setHours(0, 0, 0, 0);
    if (!isNaN(d0.getTime())) daysOpen = Math.max(0, Math.floor((today - d0) / 86400000));
  } else if (p.days_open != null) {
    daysOpen = op2Num(p.days_open);
  }
  return {
    req_id: p.req_id || p.entity_id || p.id || '',
    position_id: p.position_id || '',
    position_name: p.position_name || p.position || '—',
    branch_id: p.branch_id || '',
    branch_name: p.branch_name || p.branch || '—',
    headcount: p.headcount != null ? op2Num(p.headcount) || p.headcount : 1,
    employment_type: p.employment_type || p.emp_type || 'full_time',
    salary_min: p.salary_min != null && p.salary_min !== '' ? op2Num(p.salary_min) : '',
    salary_max: p.salary_max != null && p.salary_max !== '' ? op2Num(p.salary_max) : '',
    reason: p.reason || '',
    job_description: p.job_description || p.jd || '',
    requirements: p.requirements || '',
    status: status,
    approval_status: approvalStatus,
    requested_by: p.requested_by || p.created_by || '—',
    approved_by: p.approved_by || '',
    candidate_count: op2Num(p.candidate_count),
    target_close_date: op2Date(p.target_close_date),
    days_open: daysOpen,
    _raw: p,
  };
}

// cache payload ดิบล่าสุดต่อ req (backend ไม่มี endpoint แยก)
var _op2Reqs = [];
var _op2Raw = {};

function op2FetchReqs() {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) {
    _op2Reqs = [];
    return Promise.resolve([]);
  }
  return sb.functions.invoke(OP_FN + '?type=' + encodeURIComponent(OP_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = op2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.req_id || p.entity_id || p.id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      _op2Raw[id] = p;
      rows.push(op2MapReq(p));
    });
    _op2Reqs = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[OP_BACKEND] list fetch failed', e);
    _op2Reqs = [];
    return [];
  });
}

var OP_BACKEND = {
  // list — { items, stats, lookups } (หน้าเดิมเรียกด้วย { tab: 'all' } แล้วกรอง client-side)
  openPositionList: function (opts) {
    opts = opts || {};
    return op2FetchReqs().then(function (all) {
      var stats = {
        total: all.length,
        draft: all.filter(function (r) { return r.approval_status === 'draft'; }).length,
        pending: all.filter(function (r) { return r.approval_status === 'pending_owner'; }).length,
        open: all.filter(function (r) { return r.status === 'open'; }).length,
        avg_days_open: 0,
      };
      var openRows = all.filter(function (r) { return r.status === 'open' && r.days_open != null; });
      if (openRows.length) {
        var sum = openRows.reduce(function (a, r) { return a + (r.days_open || 0); }, 0);
        stats.avg_days_open = Math.round(sum / openRows.length);
      }

      // lookups (positions / branches) จาก requisitions ที่มี (backend ไม่มี master list บน dashboard)
      var pSeen = {}, positions = [];
      var bSeen = {}, branches = [];
      all.forEach(function (r) {
        if (r.position_id && !pSeen[r.position_id]) { pSeen[r.position_id] = true; positions.push({ id: r.position_id, name: r.position_name || r.position_id }); }
        if (r.branch_id && !bSeen[r.branch_id]) { bSeen[r.branch_id] = true; branches.push({ id: r.branch_id, name: r.branch_name || r.branch_id }); }
      });

      return { items: all, stats: stats, lookups: { positions: positions, branches: branches } };
    });
  },

  // ---- mutations: เขียนกลับไม่ได้บน dashboard → stub + toast ----
  openPositionCreate: function () {
    op2NotReady('ขอเปิดตำแหน่งใหม่');
    return Promise.resolve({ error: 'ขอเปิดตำแหน่งยังไม่พร้อมบน dashboard (read-only)' });
  },
  openPositionSubmit: function () {
    op2NotReady('ส่งให้ Owner approve');
    return Promise.resolve({ error: 'ส่ง approve ยังไม่พร้อมบน dashboard (read-only)' });
  },
  openPositionApprove: function () {
    op2NotReady('Approve requisition');
    return Promise.resolve({ error: 'Approve ยังไม่พร้อมบน dashboard (read-only)' });
  },
  openPositionReject: function () {
    op2NotReady('Reject requisition');
    return Promise.resolve({ error: 'Reject ยังไม่พร้อมบน dashboard (read-only)' });
  },
  openPositionClose: function () {
    op2NotReady('ปิดตำแหน่ง');
    return Promise.resolve({ error: 'ปิดตำแหน่งยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _op2NotReadyShown = {};
function op2NotReady(feature) {
  if (_op2NotReadyShown[feature]) return;
  _op2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.op2Toast) window.op2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountOpenpos — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountOpenpos() {
  if (!document.getElementById('wrap-openpos')) return;
  var wrap = document.getElementById('wrap-openpos');
  wrap.innerHTML = '<style>' + OP_CSS() + '</style><div id="op">' + OP_MARKUP() + '</div>';
  OP_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #op =====
   ตัด .app-shell/sidebar/main-area/topbar shell ออก (dashboard มี shell แล้ว) */
function OP_CSS() {
  return [
    // tokens (มาจาก _shared_styles)
    '#op{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEE2E2;--success:#047857;--success-bg:#DCFCE7;--warning:#B45309;--warning-bg:#FEF3C7;--info:#1D4ED8;--info-bg:#DBEAFE;color:var(--text);font-size:13px;line-height:1.5}',
    '#op *{box-sizing:border-box}',
    // main-head (native บน dashboard · ไม่มี shell)
    '#op .main-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;gap:16px;flex-wrap:wrap}',
    '#op .main-head h1{font-size:22px;font-weight:600;color:var(--navy);margin:0;display:flex;align-items:center;gap:10px;letter-spacing:-.02em}',
    '#op .main-head h1 svg{width:22px;height:22px;color:var(--teal)}',
    '#op .main-head .sub{font-size:12px;color:var(--text-muted);margin-top:4px}',
    // stat grid
    '#op .stat-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:800px){#op .stat-grid{grid-template-columns:repeat(2,1fr)}}',
    '#op .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px}',
    '#op .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700}',
    '#op .stat-card .v{font-size:22px;font-weight:700;color:var(--navy);line-height:1;margin-top:4px}',
    // tabs
    '#op .tabs{display:inline-flex;gap:4px;padding:4px;background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:14px;flex-wrap:wrap}',
    '#op .tab{padding:7px 12px;border:0;background:transparent;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '#op .tab.active{background:#E6F7F5;color:var(--teal-dark);font-weight:600}',
    '#op .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--border);color:var(--text-muted);font-weight:700}',
    '#op .tab.active .cnt{background:var(--teal);color:#fff}',
    // requisition card
    '#op .req-card{background:#fff;border:1px solid var(--border);border-left:3px solid var(--text-muted);border-radius:10px;padding:14px 16px;margin-bottom:8px}',
    '#op .req-card.draft{border-left-color:#94A3B8}',
    '#op .req-card.pending{border-left-color:var(--warning)}',
    '#op .req-card.open{border-left-color:var(--success)}',
    '#op .req-card.filled{border-left-color:var(--info);opacity:.8}',
    '#op .req-card.cancelled,#op .req-card.auto_closed{border-left-color:var(--text-faint);opacity:.6}',
    '#op .req-head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;align-items:flex-start}',
    '#op .req-title{font-size:14px;font-weight:600;color:var(--navy)}',
    '#op .req-meta{font-size:11px;color:var(--text-muted);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap}',
    '#op .req-actions{display:flex;gap:6px;flex-wrap:wrap}',
    '#op .meta-pill{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600}',
    '#op .pill-draft{background:var(--info-bg);color:var(--info)}',
    '#op .pill-pending{background:var(--warning-bg);color:var(--warning)}',
    '#op .pill-open{background:var(--success-bg);color:var(--success)}',
    '#op .pill-filled{background:#EDE9FE;color:#6D28D9}',
    '#op .pill-cancelled,#op .pill-auto_closed{background:var(--border);color:var(--text-muted)}',
    '#op .req-body{font-size:12px;color:var(--text-muted);margin-top:8px;line-height:1.5}',
    '#op .req-stats{display:flex;gap:14px;margin-top:10px;font-size:11px;color:var(--text-muted);flex-wrap:wrap}',
    '#op .req-stats strong{color:var(--navy);font-weight:700}',
    // buttons
    '#op .btn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:500;cursor:pointer;border:1px solid transparent;font-family:inherit}',
    '#op .btn svg{width:12px;height:12px}',
    '#op .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#op .btn-primary:hover{background:var(--teal-dark)}',
    '#op .btn-ghost{background:#fff;border-color:var(--border);color:var(--text-muted)}',
    '#op .btn-ghost:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#op .btn-danger{background:#fff;border-color:var(--danger);color:var(--danger)}',
    '#op .btn-danger:hover{background:var(--danger-bg)}',
    // empty
    '#op .empty{padding:60px 20px;text-align:center;background:#fff;border:1px dashed var(--border);border-radius:10px}',
    '#op .empty svg{width:40px;height:40px;color:var(--text-faint);margin-bottom:10px}',
    '#op .empty-title{font-size:14px;font-weight:600;color:var(--text-muted)}',
    // modal
    '#op .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000}',
    '#op .modal-bg.active{display:flex}',
    '#op .modal{background:#fff;border-radius:12px;max-width:560px;width:92%;max-height:92vh;overflow-y:auto}',
    '#op .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#op .modal-header h2{font-size:16px;margin:0;color:var(--navy)}',
    '#op .modal-body{padding:16px 20px}',
    '#op .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:flex-end;gap:8px}',
    // field
    '#op .field{margin-bottom:12px}',
    '#op .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#op .field input,#op .field select,#op .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#op .field textarea{min-height:70px;resize:vertical}',
    '#op .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
  ].join('\n');
}

/* ===== markup เดิม ครบ main-head + stats + tabs + list + create modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function OP_MARKUP() {
  return [
    // main-head
    '<div class="main-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    '      Open Position',
    '    </h1>',
    '    <div class="sub">30c · requisition workflow · Owner approve · auto-close stale</div>',
    '  </div>',
    '  <button class="btn btn-primary" onclick="openCreateModal()">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    '    ขอเปิดตำแหน่งใหม่',
    '  </button>',
    '</div>',
    // stat grid
    '<div class="stat-grid">',
    '  <div class="stat-card"><div class="l">ทั้งหมด</div><div class="v" id="s-total">—</div></div>',
    '  <div class="stat-card"><div class="l">Draft</div><div class="v" id="s-draft">—</div></div>',
    '  <div class="stat-card"><div class="l">รอ Owner approve</div><div class="v" id="s-pending" style="color:var(--warning)">—</div></div>',
    '  <div class="stat-card"><div class="l">Open (recruiting)</div><div class="v" id="s-open" style="color:var(--success)">—</div></div>',
    '  <div class="stat-card"><div class="l">Avg days open</div><div class="v" id="s-days">—</div></div>',
    '</div>',
    // tabs
    '<div class="tabs">',
    '  <button class="tab active" data-tab="active" onclick="setTab(\'active\')">Open <span class="cnt" id="cnt-active">—</span></button>',
    '  <button class="tab" data-tab="pending" onclick="setTab(\'pending\')">รอ approve <span class="cnt" id="cnt-pending">—</span></button>',
    '  <button class="tab" data-tab="draft" onclick="setTab(\'draft\')">Draft <span class="cnt" id="cnt-draft">—</span></button>',
    '  <button class="tab" data-tab="filled" onclick="setTab(\'filled\')">Filled <span class="cnt" id="cnt-filled">—</span></button>',
    '  <button class="tab" data-tab="closed" onclick="setTab(\'closed\')">Closed <span class="cnt" id="cnt-closed">—</span></button>',
    '</div>',
    // list
    '<div id="list">',
    '  <div class="empty"><div class="empty-title">กำลังโหลด...</div></div>',
    '</div>',
    OP_MODAL(),
  ].join('\n');
}

/* Create modal · คง element id เดิม */
function OP_MODAL() {
  return [
    '<div class="modal-bg" id="create-bg" onclick="if(event.target===this)closeCreateModal()">',
    '  <div class="modal">',
    '    <div class="modal-header"><h2>ขอเปิดตำแหน่งใหม่</h2></div>',
    '    <div class="modal-body">',
    '      <div class="row">',
    '        <div class="field"><label>ตำแหน่ง *</label><select id="f-position"></select></div>',
    '        <div class="field"><label>สาขา *</label><select id="f-branch"></select></div>',
    '      </div>',
    '      <div class="row">',
    '        <div class="field"><label>จำนวน (headcount)</label><input id="f-headcount" type="number" min="1" value="1"></div>',
    '        <div class="field"><label>ประเภท</label><select id="f-emp-type">',
    '          <option value="full_time">Full-time</option>',
    '          <option value="part_time">Part-time</option>',
    '          <option value="contract">Contract</option>',
    '          <option value="temp">Temp</option>',
    '        </select></div>',
    '      </div>',
    '      <div class="row">',
    '        <div class="field"><label>เงินเดือนต่ำสุด (฿)</label><input id="f-salary-min" type="number" min="0"></div>',
    '        <div class="field"><label>เงินเดือนสูงสุด (฿)</label><input id="f-salary-max" type="number" min="0"></div>',
    '      </div>',
    '      <div class="field"><label>เหตุผล</label><select id="f-reason">',
    '        <option value="new_role">ตำแหน่งใหม่</option>',
    '        <option value="replacement">ทดแทนคนออก</option>',
    '        <option value="expansion">ขยาย</option>',
    '        <option value="project">โปรเจกต์</option>',
    '      </select></div>',
    '      <div class="field"><label>Job description (markdown)</label><textarea id="f-jd" placeholder="• หน้าที่หลัก...&#10;• ความรับผิดชอบ..."></textarea></div>',
    '      <div class="field"><label>Requirements</label><textarea id="f-req" placeholder="• การศึกษา...&#10;• ประสบการณ์..."></textarea></div>',
    '      <div class="field"><label>เป้าหมายปิดภายใน</label><input id="f-target-date" type="date"></div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn btn-ghost" onclick="closeCreateModal()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="submitCreate()">บันทึก draft</button>',
    '      <button class="btn btn-primary" onclick="submitCreate(true)" style="background:var(--success);border-color:var(--success)">ส่งให้ Owner approve</button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   OP_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → OP_BACKEND
   helper (escapeHtml/escapeAttr/showToast) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function OP_RUN_PAGE_JS() {

  // ---- google.script.run shim → OP_BACKEND (async, คืน shape เดิม) ----
  function _op2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (OP_BACKEND[prop]) {
            Promise.resolve().then(function () { return OP_BACKEND[prop].apply(OP_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[OP_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[OP_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _op2MakeChain(); } });

  // ---- helpers (inline · prefix op ใน id เพื่อกันชน) ----
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('op2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'op2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.op2Toast = showToast;

  /* ====================================================================
     ===== JS หน้าเดิม open_position_manager.html (ลอกทั้งดุ้น) =====
     ใช้ $id scope ใต้ #op กันชน id (helper)
     ==================================================================== */
  const _opRoot = document.getElementById('op');
  function $id(id) { return _opRoot ? _opRoot.querySelector('#' + id) : document.getElementById(id); }
  function getById(id) { return $id(id); }

  let currentTab = 'active';
  let allData = null;
  let lookups = { positions: [], branches: [] };

  function setTab(t) {
    currentTab = t;
    _opRoot.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    render();
  }

  function loadData() {
    // v1.10.169 — perf · เรียก server รอบเดียว · openPositionList ส่ง lookups มาด้วยแล้ว
    google.script.run
      .withSuccessHandler(d => {
        if (d && d.error) { getById('list').innerHTML = '<div class="empty"><div class="empty-title">' + escapeHtml(d.error) + '</div></div>'; return; }
        allData = d;
        const stats = (d && d.stats) || {};
        setText('s-total', stats.total);
        setText('s-draft', stats.draft);
        setText('s-pending', stats.pending);
        setText('s-open', stats.open);
        setText('s-days', (stats.avg_days_open != null ? stats.avg_days_open : 0) + ' วัน');
        if (d && d.lookups) {
          lookups.positions = d.lookups.positions || [];
          lookups.branches = d.lookups.branches || [];
        }
        render();
      })
      .withFailureHandler(e => { getById('list').innerHTML = '<div class="empty"><div class="empty-title">โหลดไม่สำเร็จ: ' + escapeHtml(e.message) + '</div></div>'; })
      .openPositionList({ tab: 'all' });
  }

  function render() {
    if (!allData) return;
    const items = (allData.items || []).filter(r => {
      if (currentTab === 'active') return r.status === 'open';
      if (currentTab === 'pending') return r.approval_status === 'pending_owner';
      if (currentTab === 'draft') return r.approval_status === 'draft';
      if (currentTab === 'filled') return r.status === 'filled';
      if (currentTab === 'closed') return r.status === 'cancelled' || r.status === 'auto_closed';
      return true;
    });
    // tab counts
    const all = allData.items || [];
    setText('cnt-active', all.filter(r => r.status === 'open').length);
    setText('cnt-pending', all.filter(r => r.approval_status === 'pending_owner').length);
    setText('cnt-draft', all.filter(r => r.approval_status === 'draft').length);
    setText('cnt-filled', all.filter(r => r.status === 'filled').length);
    setText('cnt-closed', all.filter(r => r.status === 'cancelled' || r.status === 'auto_closed').length);

    if (!items.length) {
      getById('list').innerHTML = '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg><div class="empty-title">ไม่มี requisition ใน tab นี้</div></div>';
      return;
    }
    getById('list').innerHTML = items.map(r => {
      const statusKey = r.approval_status === 'pending_owner' ? 'pending' :
                         r.approval_status === 'draft' ? 'draft' : r.status;
      const salaryRange = r.salary_min || r.salary_max
        ? '฿' + Number(r.salary_min || 0).toLocaleString() + '-' + Number(r.salary_max || 0).toLocaleString() : '—';
      const actions = [];
      if (r.approval_status === 'draft') {
        actions.push('<button class="btn btn-primary" onclick="submitForApproval(\'' + escapeAttr(r.req_id) + '\')">ส่งให้ Owner</button>');
      }
      if (r.approval_status === 'pending_owner') {
        actions.push('<button class="btn btn-primary" style="background:var(--success);border-color:var(--success)" onclick="approveReq(\'' + escapeAttr(r.req_id) + '\')">Approve</button>');
        actions.push('<button class="btn btn-danger" onclick="rejectReq(\'' + escapeAttr(r.req_id) + '\')">Reject</button>');
      }
      if (r.status === 'open') {
        // v1.10.169 — UX · ปุ่มเดิมเป็น alert() placeholder · เปลี่ยนเป็นเปิด pipeline จริง
        actions.push('<button class="btn btn-ghost" onclick="viewCandidates(\'' + escapeAttr(r.req_id) + '\')">' +
          (r.candidate_count > 0 ? r.candidate_count + ' ผู้สมัคร →' : 'ดูผู้สมัคร →') + '</button>');
        actions.push('<button class="btn btn-danger" onclick="closeReq(\'' + escapeAttr(r.req_id) + '\')">ปิดตำแหน่ง</button>');
      }
      return '<div class="req-card ' + statusKey + '">' +
        '<div class="req-head"><div>' +
          '<div class="req-title">' + escapeHtml(r.position_name) + ' — ' + escapeHtml(r.branch_name) + '</div>' +
          '<div class="req-meta">' +
            '<span class="meta-pill pill-' + statusKey + '">' + escapeHtml(statusKey) + '</span>' +
            '<span>' + escapeHtml(r.req_id) + '</span>' +
            '<span>' + escapeHtml(r.headcount) + ' คน · ' + escapeHtml(r.employment_type) + '</span>' +
            '<span>' + salaryRange + '/เดือน</span>' +
            (r.days_open != null ? '<span style="color:' + (r.days_open > 30 ? 'var(--danger)' : 'var(--text-muted)') + '">เปิด ' + r.days_open + ' วัน</span>' : '') +
          '</div>' +
        '</div><div class="req-actions">' + actions.join('') + '</div></div>' +
        (r.job_description ? '<div class="req-body">' + escapeHtml(String(r.job_description).substring(0, 200)) + (r.job_description.length > 200 ? '...' : '') + '</div>' : '') +
        '<div class="req-stats">' +
          '<span>ขอโดย: <strong>' + escapeHtml(r.requested_by) + '</strong></span>' +
          (r.approved_by ? '<span>Approved: <strong>' + escapeHtml(r.approved_by) + '</strong></span>' : '') +
          '<span>Candidates: <strong>' + escapeHtml(r.candidate_count) + '</strong></span>' +
          (r.target_close_date ? '<span>Target close: <strong>' + escapeHtml(r.target_close_date) + '</strong></span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function openCreateModal() {
    // Populate dropdowns
    const posSel = getById('f-position');
    const brSel = getById('f-branch');
    posSel.innerHTML = (lookups.positions || []).map(p => '<option value="' + escapeAttr(p.id) + '">' + escapeHtml(p.name) + '</option>').join('');
    brSel.innerHTML = (lookups.branches || []).map(b => '<option value="' + escapeAttr(b.id) + '">' + escapeHtml(b.name) + '</option>').join('');
    getById('create-bg').classList.add('active');
  }
  function closeCreateModal() { getById('create-bg').classList.remove('active'); }

  function submitCreate(thenSubmit) {
    const payload = {
      position_id: getById('f-position').value,
      branch_id: getById('f-branch').value,
      headcount: getById('f-headcount').value,
      employment_type: getById('f-emp-type').value,
      salary_min: getById('f-salary-min').value,
      salary_max: getById('f-salary-max').value,
      reason: getById('f-reason').value,
      job_description: getById('f-jd').value,
      requirements: getById('f-req').value,
      target_close_date: getById('f-target-date').value,
    };
    if (!payload.position_id) { showToast('เลือกตำแหน่ง', 'error'); return; }
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (thenSubmit) {
          google.script.run.withSuccessHandler(rr => {
            if (rr && rr.error) { showToast(rr.error, 'error'); return; }
            showToast(rr.auto_approved ? 'เปิดเลย (auto-approve)' : 'ส่งให้ Owner แล้ว', 'success');
            closeCreateModal(); loadData();
          }).openPositionSubmit(r.req_id);
        } else {
          showToast('บันทึก draft', 'success');
          closeCreateModal(); loadData();
        }
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .openPositionCreate(payload);
  }

  function submitForApproval(id) {
    if (!confirm('ส่ง requisition นี้ให้ Owner approve?')) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.error) { showToast(r.error, 'error'); return; }
      showToast(r.auto_approved ? 'เปิดเลย (auto-approve)' : 'ส่งให้ Owner แล้ว', 'success'); loadData();
    }).openPositionSubmit(id);
  }
  function approveReq(id) {
    if (!confirm('Approve requisition นี้? · ตำแหน่งจะ open ให้ recruit')) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.error) { showToast(r.error, 'error'); return; }
      showToast('Approved', 'success'); loadData();
    }).openPositionApprove(id);
  }
  function rejectReq(id) {
    const reason = prompt('เหตุผลที่ปฏิเสธ:');
    if (!reason) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.error) { showToast(r.error, 'error'); return; }
      showToast('Rejected', 'success'); loadData();
    }).openPositionReject(id, reason);
  }
  function closeReq(id) {
    const reason = prompt('เหตุผลที่ปิดตำแหน่ง:');
    if (!reason) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.error) { showToast(r.error, 'error'); return; }
      showToast('Closed', 'success'); loadData();
    }).openPositionClose(id, reason);
  }

  function viewCandidates(reqId) {
    // เปิดหน้า Recruit pipeline เต็ม (ส่ง req ไปด้วย · เผื่อรองรับ prefilter ในอนาคต)
    if (typeof window.navTo === 'function') window.navTo('recruit', 'req=' + encodeURIComponent(reqId));
    else showToast('เปิด pipeline ไม่ได้', 'error');
  }

  function setText(id, val) { const el = getById(id); if (el) el.textContent = val != null ? val : 0; }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    setTab, openCreateModal, closeCreateModal, submitCreate,
    submitForApproval, approveReq, rejectReq, closeReq, viewCandidates,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadData();
}

if (typeof window !== 'undefined') window.mountOpenpos = mountOpenpos;
