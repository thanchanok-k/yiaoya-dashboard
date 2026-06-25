// _ported/equipment.js — FULL native port of HR Announcement equipment_loans.html (หน้า "ยืม-คืนอุปกรณ์")
// ลอกทั้งดุ้น: stats(5) + tabs(active/awaiting_hr/returned/all) + filters(search/employee)
//   + data-table + 2 modals (issue/confirm) + help
//   CSS เดิม (_shared_styles + <style> หน้า equipment) prefix #eq ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ EQ_RUN_PAGE_JS() · google.script.run = shim → EQ_BACKEND (Supabase)
//
// ใช้ global sb (index.html module scope) — ห้าม redeclare · helper (esc/$/ICONS/showToast/showHelp) inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน EQ_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=equipment.updated → {items}) :
//   list   → derive loans/stats/employees client-side จาก payload ล่าสุดต่อ loan
//            (ตอนนี้ list อาจว่าง = 0 loan → render ได้ ไม่ error · empty state สวย)
//   issue/confirm/sendReturn/remove → เขียนกลับ/ส่ง LINE ไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   EQ_BACKEND — map google.script.run → Supabase edge fn hr_list (type=equipment.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     equipmentLoanList(opts)       → { items, stats, employees }
     equipmentLoanIssue/Confirm/SendReturn/Remove → { ok / error } stub + toast
   ============================================================ */
var EQ_FN = 'hr_list';
var EQ_TYPE = 'equipment.updated';

function eq2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function eq2Num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
function eq2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function eq2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

var EQ_STATUSES = ['active', 'awaiting_hr', 'returned', 'written_off'];

// map payload event ดิบ → loan row shape ที่ JS เดิมใช้
function eq2MapLoan(p) {
  p = p || {};
  var status = String(p.status || 'active').toLowerCase();
  if (EQ_STATUSES.indexOf(status) < 0) status = 'active';
  var lineId = p.line_user_id || p.line_uid || '';
  var lineLinked = lineId ? true : eq2Bool(p.line_linked);
  var expected = eq2Date(p.expected_return);
  var overdue = false;
  if (status === 'active' && expected) {
    var d0 = new Date(expected); var today = new Date(); today.setHours(0, 0, 0, 0);
    if (!isNaN(d0.getTime()) && d0 < today) overdue = true;
  }
  return {
    loan_id: p.loan_id || p.entity_id || p.id || '',
    employee_id: p.employee_id || '',
    employee_name: p.employee_name || p.name || '—',
    item_type: p.item_type || 'other',
    item_name: p.item_name || '—',
    serial: p.serial || p.asset_tag || '',
    lent_at: eq2Date(p.lent_at || p.created_at),
    lent_by_name: p.lent_by_name || '',
    expected_return: expected,
    overdue: overdue,
    status: status,
    return_request_at: eq2Date(p.return_request_at),
    condition: p.condition || '',
    deduction_amount: eq2Num(p.deduction_amount),
    received_by_name: p.received_by_name || '',
    returned_at: eq2Date(p.returned_at),
    evidence_url: p.evidence_url || '',
    line_linked: lineLinked,
    line_user_id: lineId,
    notes: p.notes || '',
    _raw: p,
  };
}

// cache payload ดิบล่าสุดต่อ loan
var _eq2Loans = [];
var _eq2Raw = {};

function eq2FetchLoans() {
  return sb.functions.invoke(EQ_FN + '?type=' + encodeURIComponent(EQ_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = eq2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.loan_id || p.entity_id || p.id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      _eq2Raw[id] = p;
      rows.push(eq2MapLoan(p));
    });
    _eq2Loans = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[EQ_BACKEND] list fetch failed', e);
    _eq2Loans = [];
    return [];
  });
}

var EQ_BACKEND = {
  // list — { items, stats, employees }
  equipmentLoanList: function (opts) {
    opts = opts || {};
    return eq2FetchLoans().then(function (all) {
      var tab = opts.tab || 'active';
      var filtered = all.slice();
      if (tab === 'active') filtered = filtered.filter(function (l) { return l.status === 'active'; });
      else if (tab === 'awaiting_hr') filtered = filtered.filter(function (l) { return l.status === 'awaiting_hr'; });
      else if (tab === 'returned') filtered = filtered.filter(function (l) { return l.status === 'returned' || l.status === 'written_off'; });
      // tab === 'all' → ไม่กรอง

      if (opts.employee_id) filtered = filtered.filter(function (l) { return l.employee_id === opts.employee_id; });
      if (opts.search) {
        var q = String(opts.search).toLowerCase();
        filtered = filtered.filter(function (l) {
          return (l.employee_name || '').toLowerCase().indexOf(q) >= 0 ||
            (l.item_name || '').toLowerCase().indexOf(q) >= 0 ||
            (l.serial || '').toLowerCase().indexOf(q) >= 0;
        });
      }

      // sort: overdue ก่อน → awaiting → active → ล่าสุด lent
      var statusRank = { awaiting_hr: 0, active: 1, returned: 2, written_off: 3 };
      filtered.sort(function (a, b) {
        if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
        var ar = statusRank[a.status] == null ? 99 : statusRank[a.status];
        var br = statusRank[b.status] == null ? 99 : statusRank[b.status];
        if (ar !== br) return ar - br;
        return (b.lent_at || '').localeCompare(a.lent_at || '');
      });

      // returned 90d window สำหรับ stat
      var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
      var cutoffStr = eq2Date(cutoff);
      var stats = {
        total: all.length,
        active: all.filter(function (l) { return l.status === 'active'; }).length,
        awaiting_hr: all.filter(function (l) { return l.status === 'awaiting_hr'; }).length,
        overdue: all.filter(function (l) { return l.overdue; }).length,
        returned: all.filter(function (l) {
          return (l.status === 'returned' || l.status === 'written_off') &&
            (!l.returned_at || l.returned_at >= cutoffStr);
        }).length,
      };

      // employees จาก loans ที่มี (backend ไม่มี master list บน dashboard)
      var eSeen = {}, employees = [];
      all.forEach(function (l) {
        if (l.employee_id && !eSeen[l.employee_id]) {
          eSeen[l.employee_id] = true;
          employees.push({ employee_id: l.employee_id, name: l.employee_name || l.employee_id });
        }
      });
      employees.sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });

      return { items: filtered, stats: stats, employees: employees };
    });
  },

  // ---- mutations: เขียนกลับ/ส่ง LINE ไม่ได้บน dashboard → stub + toast ----
  equipmentLoanIssue: function () {
    eq2NotReady('ออกของ (issue loan)');
    return Promise.resolve({ error: 'ออกของยังไม่พร้อมบน dashboard (read-only)' });
  },
  equipmentLoanConfirm: function () {
    eq2NotReady('ยืนยันรับคืน');
    return Promise.resolve({ error: 'ยืนยันคืนยังไม่พร้อมบน dashboard (read-only)' });
  },
  equipmentLoanSendReturn: function () {
    eq2NotReady('ส่ง LINE ขอคืน');
    return Promise.resolve({ error: 'ส่ง LINE ยังไม่พร้อมบน dashboard' });
  },
  equipmentLoanRemove: function () {
    eq2NotReady('ลบรายการยืม');
    return Promise.resolve({ error: 'ลบยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _eq2NotReadyShown = {};
function eq2NotReady(feature) {
  if (_eq2NotReadyShown[feature]) return;
  _eq2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.eq2Toast) window.eq2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountEquipment — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountEquipment() {
  if (!document.getElementById('wrap-equipment')) return;
  var wrap = document.getElementById('wrap-equipment');
  wrap.innerHTML = '<style>' + EQ_CSS() + '</style><div id="eq">' + EQ_MARKUP() + '</div>';
  EQ_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> equipment_loans) · prefix ทุก selector ด้วย #eq =====
   ตัด .app-shell/sidebar/main-area/topbar shell ออก (dashboard มี shell แล้ว) */
function EQ_CSS() {
  return [
    // tokens (มาจาก _shared_styles)
    '#eq{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEE2E2;--success:#047857;--warning:#B45309;--info:#1E40AF;color:var(--text);font-size:13px;line-height:1.5}',
    '#eq *{box-sizing:border-box}',
    // buttons (จาก _shared_styles)
    '#eq .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#eq .btn:hover{border-color:var(--navy)}',
    '#eq .btn svg{width:14px;height:14px}',
    '#eq .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#eq .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#eq .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#eq .btn-sm{padding:5px 10px;font-size:12px}',
    '#eq .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:8px;background:#fff;color:var(--text-muted);cursor:pointer}',
    '#eq .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#eq .btn-help svg{width:14px;height:14px}',
    // page head (native บน dashboard · ไม่มี shell page-head เดิม)
    '#eq .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#eq .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#eq .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#eq .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#eq .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // stat cards (5 col)
    '#eq .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:900px){#eq .stats{grid-template-columns:repeat(2,1fr)}}',
    '#eq .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#eq .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#eq .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#eq .stat-card .v{font-size:22px;font-weight:600;line-height:1;margin-top:4px}',
    '#eq .stat-card.awaiting .v{color:var(--warning)}',
    '#eq .stat-card.overdue .v{color:var(--danger)}',
    '#eq .stat-card.active .v{color:var(--info)}',
    '#eq .stat-card.returned .v{color:var(--success)}',
    // tabs
    '#eq .tabs{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}',
    '#eq .tab{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '#eq .tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#eq .tab svg{width:13px;height:13px}',
    '#eq .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#eq .tab.active .cnt{background:var(--navy)}',
    '#eq .tab.tab-awaiting.active .cnt{background:var(--warning)}',
    // filters
    '#eq .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#eq .filter{display:flex;flex-direction:column;gap:2px}',
    '#eq .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#eq .filter input,#eq .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#eq .filter input:focus,#eq .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // data table
    '#eq .data-table{width:100%;border-collapse:collapse;font-size:12px}',
    '#eq .data-table thead th{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);text-align:left;padding:8px;border-bottom:.5px solid var(--border);font-weight:600}',
    '#eq .data-table tbody td{padding:8px;border-bottom:.5px solid var(--border);vertical-align:top}',
    '#eq .data-table tbody tr:hover{background:#F8FAFC}',
    '#eq .data-table .row-overdue{background:#FEF2F2}',
    '#eq .data-table .row-awaiting{background:#FFFBEB}',
    // pills
    '#eq .pill{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;display:inline-block}',
    '#eq .pill-active{background:#DBEAFE;color:#1E40AF}',
    '#eq .pill-awaiting_hr{background:#FEF3C7;color:#92400E}',
    '#eq .pill-returned{background:#DCFCE7;color:#166534}',
    '#eq .pill-written_off{background:#F1F5F9;color:var(--text-muted)}',
    '#eq .pill-good{background:#DCFCE7;color:#166534}',
    '#eq .pill-damaged{background:#FEF3C7;color:#92400E}',
    '#eq .pill-lost{background:#FEE2E2;color:#991B1B}',
    '#eq .pill-overdue{background:var(--danger-bg);color:var(--danger);margin-left:4px}',
    '#eq .pill-line{background:#DCFCE7;color:#15803D;font-size:9px}',
    // empty / loading
    '#eq .empty-tab{padding:30px 20px;text-align:center;color:var(--text-muted);font-size:12px}',
    '#eq .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
  ].join('\n') + EQ_CSS2();
}

/* CSS part 2 — modal / field / returns-list */
function EQ_CSS2() {
  return '\n' + [
    // modal
    '#eq .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#eq .modal-bg.active{display:flex}',
    '#eq .modal{background:#fff;border-radius:12px;max-width:560px;width:92%;max-height:90vh;overflow-y:auto}',
    '#eq .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#eq .modal-header h2{font-size:16px;margin:0}',
    '#eq .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#eq .modal-body{padding:16px 20px}',
    '#eq .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:flex-end;gap:8px}',
    // field
    '#eq .field{margin-bottom:12px}',
    '#eq .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#eq .field input,#eq .field select,#eq .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#eq .field input:focus,#eq .field select:focus,#eq .field textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#eq .field-help{font-size:10px;color:var(--text-faint);margin-top:3px}',
    // returns-list (offboarding context — คงไว้ครบ)
    '#eq .returns-list{background:#FFFBEB;border:1px dashed var(--warning);border-radius:8px;padding:12px;margin-bottom:12px}',
    '#eq .returns-list h4{font-size:12px;margin:0 0 8px;color:var(--warning);text-transform:uppercase;letter-spacing:.05em}',
    '#eq .returns-list .return-item{display:flex;justify-content:space-between;padding:6px 0;border-bottom:.5px solid #FDE68A;font-size:12px}',
    '#eq .returns-list .return-item:last-child{border-bottom:none}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + stats + tabs + filters + content + 2 modals =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function EQ_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>',
    '      Equipment loans',
    '    </h1>',
    '    <div class="subtitle">45 — track ของยืม + LINE workflow ให้พนักงานคืนเอง</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn" data-tip="คู่มือการใช้หน้านี้"></button>',
    '    <button class="btn btn-sm" onclick="loadList()" id="refresh-btn"></button>',
    '    <button class="btn btn-primary" onclick="openIssue()" id="new-btn"></button>',
    '  </div>',
    '</header>',
    '<div class="stats" id="stats"></div>',
    // tabs
    '<div class="tabs">',
    '  <button class="tab" id="tab-active" onclick="setTab(\'active\')"></button>',
    '  <button class="tab tab-awaiting" id="tab-awaiting_hr" onclick="setTab(\'awaiting_hr\')"></button>',
    '  <button class="tab" id="tab-returned" onclick="setTab(\'returned\')"></button>',
    '  <button class="tab" id="tab-all" onclick="setTab(\'all\')"></button>',
    '</div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ค้นหา</label>',
    '    <input type="search" id="filter-search" placeholder="ชื่อ / item / serial" oninput="loadDebounced()">',
    '  </div>',
    '  <div class="filter">',
    '    <label>พนักงาน</label>',
    '    <select id="filter-emp" onchange="loadList()">',
    '      <option value="">ทุกคน</option>',
    '    </select>',
    '  </div>',
    '</div>',
    '<div id="content" class="loading">กำลังโหลด...</div>',
    EQ_MODALS(),
  ].join('\n');
}

/* 2 modals · คง element id เดิม */
function EQ_MODALS() {
  return [
    // Issue loan modal
    '<div class="modal-bg" id="issue-bg" onclick="if(event.target===this)closeIssue()">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2>ออกของให้พนักงาน</h2>',
    '      <p>บันทึกตอนยืม → ตอนคืนพนักงานกด LINE หรือ HR confirm ได้</p>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="field">',
    '        <label>พนักงาน *</label>',
    '        <select id="i-emp"></select>',
    '      </div>',
    '      <div class="field">',
    '        <label>ประเภท *</label>',
    '        <select id="i-type">',
    '          <option value="laptop">laptop</option>',
    '          <option value="badge">badge</option>',
    '          <option value="key">key (ตู้ล็อกเกอร์, ห้อง)</option>',
    '          <option value="uniform">uniform</option>',
    '          <option value="phone">phone</option>',
    '          <option value="other">other</option>',
    '        </select>',
    '      </div>',
    '      <div class="field">',
    '        <label>ชื่อ item *</label>',
    '        <input id="i-name" placeholder="เช่น \'Macbook Pro 14 silver\' หรือ \'Locker key #B12\'">',
    '      </div>',
    '      <div class="field">',
    '        <label>Serial / asset tag</label>',
    '        <input id="i-serial" placeholder="optional">',
    '      </div>',
    '      <div class="field">',
    '        <label>วันคาดว่าจะคืน</label>',
    '        <input id="i-expected" type="date">',
    '        <div class="field-help">ว่างได้ — ระบบจะตั้ง overdue ถ้าเกิน</div>',
    '      </div>',
    '      <div class="field">',
    '        <label>หมายเหตุ</label>',
    '        <textarea id="i-notes" rows="2"></textarea>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeIssue()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveIssue()" id="i-save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
    // Confirm return modal
    '<div class="modal-bg" id="confirm-bg" onclick="if(event.target===this)closeConfirm()">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2>ยืนยันรับคืน</h2>',
    '      <p id="cf-sub">—</p>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="field">',
    '        <label>สภาพของ *</label>',
    '        <select id="cf-cond">',
    '          <option value="good">good — ของอยู่ในสภาพปกติ</option>',
    '          <option value="damaged">damaged — เสียหาย</option>',
    '          <option value="lost">lost — สูญหาย</option>',
    '        </select>',
    '      </div>',
    '      <div class="field">',
    '        <label>หักจาก final pay (฿)</label>',
    '        <input id="cf-deduct" type="number" min="0" value="0">',
    '        <div class="field-help">ตั้งเฉพาะ damaged/lost</div>',
    '      </div>',
    '      <div class="field">',
    '        <label>รูปถ่ายหลักฐาน (Drive URL)</label>',
    '        <input id="cf-evidence" type="url" placeholder="https://drive.google.com/...">',
    '      </div>',
    '      <div class="field">',
    '        <label>หมายเหตุ</label>',
    '        <textarea id="cf-notes" rows="2"></textarea>',
    '      </div>',
    '      <div class="field-help" style="background:#F0FDFA;border:1px solid #99F6E4;border-radius:6px;padding:8px;color:#0F766E">',
    '        ผู้รับคืน: ระบบบันทึกเป็นคุณ (จาก email login) อัตโนมัติ',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeConfirm()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveConfirm()" id="cf-save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   EQ_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → EQ_BACKEND
   helper (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function EQ_RUN_PAGE_JS() {

  // ---- google.script.run shim → EQ_BACKEND (async, คืน shape เดิม) ----
  function _eq2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (EQ_BACKEND[prop]) {
            Promise.resolve().then(function () { return EQ_BACKEND[prop].apply(EQ_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[EQ_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[EQ_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _eq2MakeChain(); } });

  // ---- helpers (inline · prefix eq ใน id เพื่อกันชน) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('eq2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'eq2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.eq2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('eq-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'eq-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const tip = s.type === 'tip';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (tip ? '#F0FDFA' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (tip ? '#3DC5B7' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (tip ? '#0F766E' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'eq-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'eq-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม equipment_loans.html (ลอกทั้งดุ้น) =====
     ใช้ $ scope ใต้ #eq กันชน id (helper)
     ==================================================================== */
  const _eqRoot = document.getElementById('eq');
  function $id(id) { return _eqRoot ? _eqRoot.querySelector('#' + id) : document.getElementById(id); }
  // alias เพื่อให้โค้ดเดิม document.getElementById(...) ยังทำงาน → ใช้ getById ใน scope
  function getById(id) { return $id(id); }

  let currentTab = 'active';
  let allData = null;
  let currentLoanId = null;
  let _searchDebounce = null;

  const HELP = {
    title: 'Equipment loans',
    subtitle: 'Sheet 45 — ของยืม/คืน + LINE workflow',
    intro: 'บันทึกของที่พนักงานยืม (laptop, key, badge, uniform ฯลฯ) ตั้งแต่ตอนยืม · ตอนคืน พนักงานกดผ่าน LINE หรือ HR confirm ได้',
    sections: [
      { title: 'Workflow', items: [
        '<strong>1. ออกของ</strong> — HR กด "ออกของ" เลือกพนักงาน + ประเภท + ชื่อ + serial → status = active',
        '<strong>2. ขอคืน (option A)</strong> — HR กด "ส่ง LINE ขอคืน" บนแถวของพนักงาน → ระบบส่ง flex carousel ให้พนักงานเลือกของที่จะคืน',
        '<strong>3. พนักงานกด</strong> "คืนแล้ว" ใน LINE → status = awaiting_hr → ระบบแจ้ง HR ผ่าน LINE',
        '<strong>4. HR confirm</strong> — เปิด tab "Awaiting HR" → confirm condition + แนบรูป → ระบบบันทึก received_by อัตโนมัติ',
        '<strong>option B</strong> — HR ติ๊ก confirm ตรงๆ ได้เลยจาก tab Active โดยไม่ต้องส่ง LINE (เผื่อพนักงานยื่นคืนต่อหน้า)',
      ]},
      { title: '4 tabs', items: [
        '<strong>Active</strong> — ของที่ยังยืม (เด่น overdue สีแดง)',
        '<strong>Awaiting HR</strong> — พนักงานกด LINE คืนแล้ว · รอ HR ยืนยัน',
        '<strong>Returned</strong> — คืนเรียบร้อย (90 วันล่าสุด)',
        '<strong>ทั้งหมด</strong> — รวมทุก status',
      ]},
      { title: 'เชื่อมกับ Offboarding', items: [
        'หน้า Offboarding tab "Returns" จะดึงรายการ active ของพนักงานคนนั้นมาแสดงด้วย',
        'มีปุ่ม "ส่ง LINE ขอคืน" ตรงนั้นเลย — ส่งทุกรายการที่ค้างพร้อมกัน',
        'ของที่ damaged/lost จะ deduct จาก Final Payout อัตโนมัติ (ดูใน Payout sub-tab)',
      ]},
      { type: 'tip', title: 'เคล็ดลับ', items: [
        'ออกของหลายชิ้นพร้อมกัน: open modal เลือก พนง. → save → modal เปิดใหม่อัตโนมัติ (ใส่ของชิ้นต่อไป)',
        'ลบ loan ได้เฉพาะก่อนคืน (ถ้าใส่ผิด)',
        'ถ้าของหายไม่ทันคืนตอนลาออก → mark "lost" + deduction จะหักจาก final pay',
        'หมายเหตุ: บน dashboard นี้เป็น read-only — การส่ง LINE / ออกของ / confirm ยังไม่พร้อม',
      ]},
    ],
  };

  // ===== header / tab labels =====
  getById('refresh-btn').innerHTML = ICONS.refresh;
  getById('help-btn').innerHTML = ICONS.help;
  getById('new-btn').innerHTML = ICONS.plus + ' ออกของ';
  getById('i-save-btn').innerHTML = ICONS.save + ' บันทึก';
  getById('cf-save-btn').innerHTML = ICONS.check + ' ยืนยันคืน';

  getById('tab-active').innerHTML = ICONS.briefcase + ' Active <span class="cnt" id="cnt-active">—</span>';
  getById('tab-awaiting_hr').innerHTML = ICONS.bell + ' Awaiting HR <span class="cnt" id="cnt-awaiting">—</span>';
  getById('tab-returned').innerHTML = ICONS.check + ' Returned <span class="cnt" id="cnt-returned">—</span>';
  getById('tab-all').innerHTML = ICONS.list + ' ทั้งหมด';

  function loadDebounced() { clearTimeout(_searchDebounce); _searchDebounce = setTimeout(loadList, 300); }

  function setTab(tab) {
    currentTab = tab;
    _eqRoot.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
    getById('tab-' + tab).classList.add('active');
    loadList();
  }

  function loadList() {
    const opts = {
      tab: currentTab,
      search: getById('filter-search').value || '',
      employee_id: getById('filter-emp').value || '',
    };
    getById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(renderList)
      .withFailureHandler(err => {
        getById('content').innerHTML = '<div class="empty-tab">โหลดล้มเหลว: ' + escapeHtml(err.message) + '</div>';
      })
      .equipmentLoanList(opts);
  }

  function renderList(res) {
    if (!res || res.error) {
      getById('content').innerHTML = '<div class="empty-tab">ผิดพลาด: ' + escapeHtml((res && res.error) || 'unknown') + '</div>';
      return;
    }
    allData = res;
    populateEmpFilter(res.employees || []);
    populateIssueDropdown(res.employees || []);
    renderStats(res.stats || {});

    const items = res.items || [];
    if (!items.length) {
      getById('content').innerHTML = '<div class="empty-tab">ไม่มีรายการ — กดปุ่ม "ออกของ" เพื่อบันทึกการยืม</div>';
      return;
    }
    getById('content').innerHTML = renderTable(items);
  }

  function renderStats(s) {
    getById('stats').innerHTML = [
      statCard('total', 'ทั้งหมด', s.total || 0, ''),
      statCard('active', 'Active', s.active || 0, 'active'),
      statCard('awaiting', 'Awaiting HR', s.awaiting_hr || 0, 'awaiting'),
      statCard('overdue', 'Overdue', s.overdue || 0, 'overdue'),
      statCard('returned', 'Returned (90d)', s.returned || 0, 'returned'),
    ].join('');
    getById('cnt-active').textContent = s.active || 0;
    getById('cnt-awaiting').textContent = s.awaiting_hr || 0;
    getById('cnt-returned').textContent = s.returned || 0;
  }

  function statCard(id, label, val, cls) {
    return '<div class="stat-card ' + cls + '"><div class="l">' + escapeHtml(label) + '</div><div class="v">' + val + '</div></div>';
  }

  function populateEmpFilter(emps) {
    const sel = getById('filter-emp');
    if (sel.options.length > 1) return;
    emps.forEach(e => {
      const o = document.createElement('option');
      o.value = e.employee_id; o.textContent = e.name;
      sel.appendChild(o);
    });
  }

  function populateIssueDropdown(emps) {
    const sel = getById('i-emp');
    if (sel.options.length > 1) return;
    sel.innerHTML = '<option value="">— เลือกพนักงาน —</option>' +
      emps.map(e => '<option value="' + escapeAttr(e.employee_id) + '">' + escapeHtml(e.name) + '</option>').join('');
  }

  function renderTable(items) {
    let html = '<table class="data-table"><thead><tr>';
    html += '<th>พนักงาน</th><th>Item</th><th>Serial</th><th>ยืมเมื่อ</th><th>คาดคืน</th>';
    html += '<th>Status</th><th>Condition</th><th>คนรับคืน</th><th>Action</th>';
    html += '</tr></thead><tbody>';
    items.forEach(l => {
      const rowCls = l.overdue ? 'row-overdue' : (l.status === 'awaiting_hr' ? 'row-awaiting' : '');
      html += '<tr class="' + rowCls + '">';
      html += '<td><strong>' + escapeHtml(l.employee_name) + '</strong>' +
        (l.line_linked ? ' <span class="pill pill-line">LINE</span>' : '') + '</td>';
      html += '<td><strong>' + escapeHtml(l.item_name) + '</strong><div style="font-size:10px;color:var(--text-faint)">' + escapeHtml(l.item_type) + '</div></td>';
      html += '<td>' + escapeHtml(l.serial || '-') + '</td>';
      html += '<td>' + escapeHtml(l.lent_at) + '<div style="font-size:10px;color:var(--text-faint)">โดย ' + escapeHtml(l.lent_by_name || '-') + '</div></td>';
      html += '<td>' + escapeHtml(l.expected_return || '-') + (l.overdue ? '<span class="pill pill-overdue" data-tip="เลย deadline · ต้องเร่ง">overdue</span>' : '') + '</td>';
      html += '<td><span class="pill pill-' + escapeAttr(l.status) + '">' + escapeHtml(l.status) + '</span>' +
        (l.return_request_at ? '<div style="font-size:10px;color:var(--text-faint);margin-top:2px">พนง.กด ' + escapeHtml(l.return_request_at) + '</div>' : '') + '</td>';
      html += '<td>' + (l.condition ? '<span class="pill pill-' + escapeAttr(l.condition) + '">' + escapeHtml(l.condition) + '</span>' : '-') +
        (l.deduction_amount > 0 ? '<div style="font-size:10px;color:var(--danger);margin-top:2px">หัก ' + l.deduction_amount.toLocaleString() + ' ฿</div>' : '') + '</td>';
      html += '<td>' + escapeHtml(l.received_by_name || '-') + '<div style="font-size:10px;color:var(--text-faint)">' + escapeHtml(l.returned_at || '') + '</div></td>';
      html += '<td>' + renderActions(l) + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function renderActions(l) {
    if (l.status === 'returned' || l.status === 'written_off') {
      return l.evidence_url ? '<a href="' + escapeAttr(l.evidence_url) + '" target="_blank" class="btn btn-sm">รูป</a>' : '-';
    }
    let actions = '';
    if (l.status === 'active') {
      actions += '<button class="btn btn-sm" onclick="sendLineReturn(\'' + escapeAttr(l.employee_id) + '\', [\'' + escapeAttr(l.loan_id) + '\'])" ' +
        (l.line_linked ? '' : 'disabled title="พนักงานยังไม่ link LINE"') + '>' + ICONS.bell + ' LINE</button> ';
    }
    actions += '<button class="btn btn-sm btn-primary" onclick="openConfirm(\'' + escapeAttr(l.loan_id) + '\', \'' + escapeAttr(l.item_name) + '\')">Confirm</button> ';
    if (l.status === 'active') {
      actions += '<button class="btn btn-sm" onclick="removeLoan(\'' + escapeAttr(l.loan_id) + '\')">' + ICONS.trash + '</button>';
    }
    return actions;
  }

  // ====== Issue ======
  function openIssue() {
    getById('issue-bg').classList.add('active');
    ['i-name', 'i-serial', 'i-expected', 'i-notes'].forEach(id => getById(id).value = '');
    getById('i-emp').value = '';
    getById('i-type').value = 'laptop';
  }
  function closeIssue() { getById('issue-bg').classList.remove('active'); }
  function saveIssue() {
    const empId = getById('i-emp').value;
    const opts = {
      item_type: getById('i-type').value,
      item_name: getById('i-name').value || '',
      serial: getById('i-serial').value || '',
      expected_return: getById('i-expected').value || '',
      notes: getById('i-notes').value || '',
    };
    if (!empId) return showToast('เลือกพนักงานก่อน', 'error');
    if (!opts.item_name) return showToast('ใส่ชื่อ item ก่อน', 'error');
    getById('i-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        getById('i-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('บันทึกแล้ว', 'success');
        closeIssue();
        loadList();
      })
      .withFailureHandler(err => {
        getById('i-save-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .equipmentLoanIssue(empId, opts);
  }

  // ====== Send LINE ======
  function sendLineReturn(empId, loanIds) {
    if (!confirm('ส่ง LINE flex ให้พนักงานกดคืน?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ส่ง LINE แล้ว · พนักงานจะได้รับ flex ' + (res.loans_sent || 0) + ' รายการ', 'success');
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .equipmentLoanSendReturn(empId, loanIds);
  }

  // ====== Confirm return ======
  function openConfirm(loanId, itemName) {
    currentLoanId = loanId;
    getById('confirm-bg').classList.add('active');
    getById('cf-sub').textContent = itemName;
    getById('cf-cond').value = 'good';
    getById('cf-deduct').value = '0';
    getById('cf-evidence').value = '';
    getById('cf-notes').value = '';
  }
  function closeConfirm() { getById('confirm-bg').classList.remove('active'); currentLoanId = null; }
  function saveConfirm() {
    if (!currentLoanId) return;
    const opts = {
      condition: getById('cf-cond').value,
      deduction_amount: getById('cf-deduct').value || 0,
      evidence_url: getById('cf-evidence').value || '',
      notes: getById('cf-notes').value || '',
      returned_at: new Date().toISOString(),
    };
    getById('cf-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        getById('cf-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ยืนยันคืนแล้ว', 'success');
        closeConfirm();
        loadList();
      })
      .withFailureHandler(err => {
        getById('cf-save-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .equipmentLoanConfirm(currentLoanId, opts);
  }

  // ====== Remove ======
  function removeLoan(loanId) {
    if (!confirm('ลบรายการนี้? (ใช้เฉพาะกรณีใส่ผิด)')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ลบแล้ว', 'success');
        loadList();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .equipmentLoanRemove(loanId);
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList, loadDebounced, setTab,
    openIssue, closeIssue, saveIssue,
    sendLineReturn,
    openConfirm, closeConfirm, saveConfirm,
    removeLoan,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  setTab('active');
}
