// _ported/payrollmgr.js — FULL native port of payroll_manager.html (HR Payroll Manager · sensitive)
// ลอกทั้งดุ้น: 5 tab (Overview/Payslips/Compensation/Accounting/History) + 3 modal (Compensation/Detail/Help)
//   CSS เดิม (<style> หน้า payroll_manager) prefix #pm2 ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ mountPayrollmgr() · google.script.run = shim → PM_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
//   หน้าเดิมมี esc()/fmtBaht() ของตัวเองใน closure → ไม่ชน global
// fn/var ที่ inline onclick ใช้ = ผูกกับ window ภายใน mountPayrollmgr (ผ่าน eval ใน closure)
// prefix pm2/PM_ กันชน pm เดิม (acc_payroll inline ใน index.html)
//
// ⚠️ SENSITIVE (เงินเดือน) — แสดงเฉพาะตัวเลขที่มีจริงใน payload · ไม่เดา/ไม่ประมาณ
//
// backend (เงินเดือนเข้า hub ทาง accountant แล้ว):
//   list payroll → sb.functions.invoke('hr_list?type=payroll.calculated') → {items} (+ employee.payroll_set, bankfile.generated)
//   whoami       → {ok:true,is_owner:true}
//   mutation (คำนวณ/gen payslip/อนุมัติจ่าย/accounting) เขียนกลับไม่ได้ → stub + toast

/* ============================================================
   PM_BACKEND — map google.script.run.payroll* → Supabase (hr_list events)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (อ่านจาก renderOverview/renderPayslips/renderDetail/...)
   ============================================================ */
function pm2Num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function pm2Str(v) { return (v == null) ? '' : String(v); }
function pm2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

// map payload (จาก events.payload ของ payroll.calculated) → salary row shape ที่ JS เดิมใช้
function pm2MapRow(p) {
  p = p || {};
  var base = pm2Num(p.base_salary != null ? p.base_salary : p.base);
  var ot = pm2Num(p.ot != null ? p.ot : p.ot_amount);
  var commission = pm2Num(p.commission);
  var allowances = pm2Num(p.allowances != null ? p.allowances : p.allowance);
  var tax = pm2Num(p.tax != null ? p.tax : p.pit);
  var sps_e = pm2Num(p.sps_employee != null ? p.sps_employee : p.sps);
  var sps_r = pm2Num(p.sps_employer);
  var deductions = pm2Num(p.deductions != null ? p.deductions : p.deduction);
  var gross = (p.gross != null) ? pm2Num(p.gross) : (base + ot + commission + allowances);
  var net = (p.net_pay != null) ? pm2Num(p.net_pay) : (p.net != null ? pm2Num(p.net) : (gross - tax - sps_e - deductions));
  return {
    salary_id: pm2Str(p.salary_id || p.id || p.event_id || ''),
    employee_id: pm2Str(p.employee_id || p.emp_id || ''),
    employee_name: pm2Str(p.employee_name || p.name || ''),
    nickname: pm2Str(p.nickname || ''),
    position_name: pm2Str(p.position_name || p.position || ''),
    branch_name: pm2Str(p.branch_name || p.branch || ''),
    year_month: pm2Str(p.year_month || p.period || p.ym || ''),
    base_salary: base, ot: ot, commission: commission, allowances: allowances,
    gross: gross, tax: tax, sps_employee: sps_e, sps_employer: sps_r,
    deductions: deductions, net_pay: net,
    payslip_url: pm2Str(p.payslip_url || ''),
    paid_at: pm2Str(p.paid_at || ''),
    line_linked: (p.line_linked != null) ? pm2Bool(p.line_linked) : true,
    cost_center_split: pm2Str(p.cost_center_split || ''),
  };
}

// ดึง events payroll.calculated จาก hub → array ของ row (กรองตาม period ถ้ามี)
function pm2FetchCalculated(ym) {
  return sb.functions.invoke('hr_list?type=payroll.calculated').then(function (res) {
    if (res && res.error) throw res.error;
    var data = (res && res.data) || {};
    var items = (data.items || data.events || []).map(function (ev) {
      return pm2MapRow(ev.payload || ev);
    });
    if (ym) items = items.filter(function (x) { return !x.year_month || x.year_month === ym; });
    return items;
  });
}

// breakdown by key (position / branch) จาก net_pay
function pm2Breakdown(items, key) {
  var m = {};
  items.forEach(function (x) {
    var name = x[key] || '-';
    m[name] = (m[name] || 0) + pm2Num(x.net_pay);
  });
  return Object.keys(m).map(function (name) { return { name: name, value: m[name] }; })
    .sort(function (a, b) { return b.value - a.value; });
}

var _pm2NotReadyShown = {};
function pm2NotReady(feature) {
  if (typeof window !== 'undefined' && window.pm2Toast) window.pm2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (อ่านอย่างเดียว)', 'error');
  _pm2NotReadyShown[feature] = true;
}

var PM_BACKEND = {
  // ---- READ: period summary (totals + items + breakdown + counts) ----
  payrollGetPeriodSummary: function (ym) {
    return pm2FetchCalculated(ym).then(function (items) {
      if (!items.length) return { error: 'period ' + ym + ' ยังไม่มีข้อมูล payroll.calculated ใน hub' };
      var t = { gross: 0, net: 0, tax: 0, sps_employee: 0, sps_employer: 0 };
      var generated_count = 0, paid_count = 0;
      items.forEach(function (x) {
        t.gross += pm2Num(x.gross); t.net += pm2Num(x.net_pay); t.tax += pm2Num(x.tax);
        t.sps_employee += pm2Num(x.sps_employee); t.sps_employer += pm2Num(x.sps_employer);
        if (x.payslip_url) generated_count++;
        if (x.paid_at) paid_count++;
      });
      return {
        totals: t, items: items,
        generated_count: generated_count, paid_count: paid_count,
        breakdown: { by_position: pm2Breakdown(items, 'position_name'), by_branch: pm2Breakdown(items, 'branch_name') },
      };
    }).catch(function (e) { return { error: 'โหลด payroll ล้มเหลว: ' + (e && e.message ? e.message : e) }; });
  },

  // ---- READ: salary detail (จาก row ใน hub · ไม่มี per-row OT/comp events แยก → ว่าง) ----
  payrollGetSalaryDetail: function (salaryId) {
    return pm2FetchCalculated('').then(function (items) {
      var s = items.find(function (x) { return x.salary_id === salaryId; });
      if (!s) return { error: 'ไม่พบรายการเงินเดือน' };
      return {
        salary: s,
        employee: { name: s.employee_name || s.employee_id, position_name: s.position_name, branch_name: s.branch_name },
        compensation_entries: [],   // hub ไม่เก็บ entry แยกต่อ salary → ว่าง
        ot_records: [],             // hub ไม่เก็บ OT record แยก → ว่าง
      };
    }).catch(function (e) { return { error: 'โหลด detail ล้มเหลว: ' + (e && e.message ? e.message : e) }; });
  },

  // ---- READ: history (list periods · group ตาม year_month) ----
  payrollListPeriods: function () {
    return pm2FetchCalculated('').then(function (items) {
      var byYm = {};
      items.forEach(function (x) {
        var ym = x.year_month || '—';
        var p = byYm[ym] || (byYm[ym] = { year_month: ym, employee_count: 0, total_gross: 0, total_net: 0, total_tax: 0, total_sps: 0, generated_count: 0, paid_count: 0 });
        p.employee_count++;
        p.total_gross += pm2Num(x.gross); p.total_net += pm2Num(x.net_pay);
        p.total_tax += pm2Num(x.tax); p.total_sps += pm2Num(x.sps_employee);
        if (x.payslip_url) p.generated_count++;
        if (x.paid_at) p.paid_count++;
      });
      var arr = Object.keys(byYm).map(function (k) { return byYm[k]; })
        .sort(function (a, b) { return String(b.year_month).localeCompare(String(a.year_month)); });
      return { items: arr };
    }).catch(function (e) { return { error: 'โหลด history ล้มเหลว: ' + (e && e.message ? e.message : e) }; });
  },

  // ---- READ: compensation list (hub ไม่มี compensation event แยก → ว่าง · ไม่ error) ----
  payrollListCompensation: function (ym, filterType) {
    return Promise.resolve({ items: [] });
  },

  // ---- WRITE (เขียนกลับ hub ไม่ได้) → stub + toast ----
  payrollPreview: function () { pm2NotReady('Preview Calculation'); return Promise.resolve({ error: 'การคำนวณ payroll ทำบน dashboard ไม่ได้ — เงินเดือนถูกคำนวณ/finalize ฝั่งบัญชี (acc_payroll) แล้ว' }); },
  payrollRunCalculation: function () { pm2NotReady('Run Calculation (finalize)'); return Promise.resolve({ error: 'finalize payroll ทำบน dashboard ไม่ได้ — ทำฝั่งบัญชี (acc_payroll)' }); },
  payrollRecalcEmp: function () { pm2NotReady('Recalc Employee'); return Promise.resolve({ error: 'recalc ทำบน dashboard ไม่ได้' }); },
  payrollGeneratePayslips: function () { pm2NotReady('Generate Payslips PDF'); return Promise.resolve({ error: 'สร้าง payslip PDF ทำบน dashboard ไม่ได้ — ใช้เมนูบัญชี (acc_pdf)' }); },
  payrollSendPayslipsLINE: function () { pm2NotReady('Send Payslips LINE'); return Promise.resolve({ error: 'ส่ง payslip ทาง LINE ยังไม่พร้อมบน dashboard' }); },
  payrollMarkPaid: function () { pm2NotReady('Mark Paid'); return Promise.resolve({ error: 'mark paid ทำบน dashboard ไม่ได้ — ทำฝั่งบัญชี' }); },
  payrollAddCompensation: function () { pm2NotReady('เพิ่ม Compensation'); return Promise.resolve({ error: 'เพิ่ม compensation entry ยังไม่พร้อมบน dashboard' }); },
  payrollUpdateCompensation: function () { pm2NotReady('แก้ Compensation'); return Promise.resolve({ error: 'แก้ compensation entry ยังไม่พร้อมบน dashboard' }); },
  payrollRemoveCompensation: function () { pm2NotReady('ลบ Compensation'); return Promise.resolve({ error: 'ลบ compensation entry ยังไม่พร้อมบน dashboard' }); },
  payrollGenerateAccounting: function () { pm2NotReady('Generate Accounting CSV'); return Promise.resolve({ error: 'สร้าง Accounting Package ยังไม่พร้อมบน dashboard' }); },
  payrollReviewPartTime: function () { pm2NotReady('Part-Time Review'); return Promise.resolve({ error: 'Part-Time Review ยังไม่พร้อมบน dashboard' }); },

  // ---- whoami (dashboard user = owner เต็มสิทธิ์) ----
  payrollWhoAmI: function () { return Promise.resolve({ ok: true, is_owner: true, role: 'owner' }); },
};

/* ============================================================
   mountPayrollmgr — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountPayrollmgr() {
  var wrap = document.getElementById('wrap-payrollmgr');
  if (!wrap) return;

  var CSS = PM2_CSS();
  var MARKUP = PM2_MARKUP();
  wrap.innerHTML = '<style>' + CSS + '</style><div id="pm2">' + MARKUP + '</div>';

  // รัน JS ของหน้าเดิม (closure scope · google = shim → PM_BACKEND) → ผูก fn ที่ inline onclick ใช้ ลง window
  PM2_RUN_PAGE_JS();
}

/* ===== CSS เดิม (<style> payroll_manager) · prefix ทุก selector ด้วย #pm2 =====
   ตัด .app-shell/.main-area/.topbar/sidebar shell ออก (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด */
function PM2_CSS() {
  return [
    // tokens (จาก :root เดิม)
    '#pm2{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--bg:#F8F9FA;--text:#333;--muted:#6B7280;--border:#E5E7EB;--card:#FFF;--success:#16A34A;--warn:#D97706;--error:#DC2626;color:var(--text);font-size:14px;line-height:1.5}',
    '#pm2 *{box-sizing:border-box}',
    // page wrapper (เดิม .page max-width 1280 · ใน dashboard ไม่ต้อง center → full width)
    '#pm2 .page{max-width:100%;margin:0;padding:0}',
    '#pm2 h1{color:var(--navy);margin:0 0 4px 0;font-size:24px;font-weight:700}',
    '#pm2 .subtitle{color:var(--muted);font-size:13px;margin-bottom:20px}',
    // period bar
    '#pm2 .period-bar{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
    '#pm2 .period-bar label{color:var(--muted);font-size:12px;font-weight:500}',
    '#pm2 .period-bar input[type="month"],#pm2 .period-bar select{border:1px solid var(--border);border-radius:8px;padding:8px 12px;font-size:14px;background:white;color:var(--text)}',
    '#pm2 .period-bar input:focus,#pm2 .period-bar select:focus{outline:2px solid var(--teal);border-color:var(--teal)}',
    // tabs
    '#pm2 .tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap}',
    '#pm2 .tab{background:none;border:none;border-bottom:3px solid transparent;padding:10px 16px;font-size:14px;font-weight:500;color:var(--muted);cursor:pointer;transition:0.15s;font-family:inherit}',
    '#pm2 .tab:hover{color:var(--navy);background:var(--teal-light)}',
    '#pm2 .tab.active{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    '#pm2 .panel{display:none}',
    '#pm2 .panel.active{display:block}',
    // stat cards
    '#pm2 .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px}',
    '#pm2 .stat{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}',
    '#pm2 .stat .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px}',
    '#pm2 .stat .value{color:var(--navy);font-size:22px;font-weight:700}',
    '#pm2 .stat .sub{color:var(--muted);font-size:12px;margin-top:2px}',
    '#pm2 .stat.teal{background:var(--teal-light);border-color:var(--teal)}',
    '#pm2 .stat.teal .value{color:var(--teal)}',
    // buttons
    '#pm2 .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:500;border:1px solid var(--border);background:white;color:var(--navy);cursor:pointer;font-family:inherit;transition:0.15s}',
    '#pm2 .btn:hover{background:var(--teal-light);border-color:var(--teal)}',
    '#pm2 .btn-primary{background:var(--teal);color:white;border-color:var(--teal)}',
    '#pm2 .btn-primary:hover{background:var(--navy);border-color:var(--navy)}',
    '#pm2 .btn-danger{background:white;color:var(--error);border-color:var(--error)}',
    '#pm2 .btn-danger:hover{background:var(--error);color:white}',
    '#pm2 .btn-sm{padding:4px 10px;font-size:12px}',
    '#pm2 .btn:disabled{opacity:0.5;cursor:not-allowed}',
    '#pm2 .btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}',
    // card / table
    '#pm2 .card{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px}',
    '#pm2 .card-header{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}',
    '#pm2 .card-title{font-weight:600;color:var(--navy);font-size:14px}',
    '#pm2 .card-body{padding:0}',
    '#pm2 table{width:100%;border-collapse:collapse;font-size:13px}',
    '#pm2 thead{background:var(--navy)}',
    '#pm2 thead th{color:white;padding:10px 12px;text-align:left;font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:0.3px}',
    '#pm2 tbody td{padding:10px 12px;border-top:1px solid var(--border)}',
    '#pm2 tbody tr:hover{background:var(--teal-light)}',
    '#pm2 td.right,#pm2 th.right{text-align:right}',
    '#pm2 td.center,#pm2 th.center{text-align:center}',
    // pills
    '#pm2 .pill{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500}',
    '#pm2 .pill-paid{background:#DCFCE7;color:var(--success)}',
    '#pm2 .pill-unpaid{background:#FEF3C7;color:var(--warn)}',
    '#pm2 .pill-no-line{background:#FEE2E2;color:var(--error)}',
    '#pm2 .pill-generated{background:var(--teal-light);color:var(--teal)}',
    '#pm2 .pill-commission{background:#DBEAFE;color:#2563EB}',
    '#pm2 .pill-allowance{background:var(--teal-light);color:var(--teal)}',
    '#pm2 .pill-deduction{background:#FEE2E2;color:var(--error)}',
    '#pm2 .pill-other{background:#F3F4F6;color:var(--muted)}',
    // modal (scope ใต้ #pm2 · fixed · z สูง)
    '#pm2 .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9000;justify-content:center;align-items:flex-start;padding-top:40px;overflow-y:auto}',
    '#pm2 .modal-overlay.show{display:flex}',
    '#pm2 .modal{background:white;border-radius:12px;max-width:640px;width:92%;padding:24px;box-shadow:0 20px 40px rgba(0,0,0,0.2)}',
    '#pm2 .modal h3{color:var(--navy);margin:0 0 16px 0;font-size:18px}',
    '#pm2 .form-row{margin-bottom:12px}',
    '#pm2 .form-row label{display:block;color:var(--muted);font-size:12px;font-weight:500;margin-bottom:4px}',
    '#pm2 .form-row input,#pm2 .form-row select,#pm2 .form-row textarea{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit}',
    '#pm2 .modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}',
    // misc
    '#pm2 .empty{padding:40px;text-align:center;color:var(--muted)}',
    '#pm2 .loading{padding:40px;text-align:center;color:var(--muted)}',
    '#pm2 .warn-banner{background:#FEF3C7;border:1px solid var(--warn);color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:12px;font-size:13px}',
    '#pm2 .info-banner{background:var(--teal-light);border:1px solid var(--teal);color:var(--navy);padding:12px 16px;border-radius:8px;margin-bottom:12px;font-size:13px}',
    '#pm2 .filter-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center}',
    '#pm2 .filter-row input,#pm2 .filter-row select{border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px;background:white}',
    '#pm2 .help-btn{background:var(--navy);color:white;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-weight:700}',
    '#pm2 .help-btn:hover{background:var(--teal)}',
    '#pm2 .breakdown-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '#pm2 .breakdown-card{background:var(--bg);padding:12px;border-radius:8px}',
    '#pm2 .breakdown-card h4{margin:0 0 8px 0;color:var(--navy);font-size:13px}',
    '#pm2 .breakdown-card .row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:var(--text);border-bottom:1px solid var(--border)}',
    '#pm2 .breakdown-card .row:last-child{border-bottom:none}',
    // page-head (จาก auto-injected refactor)
    '#pm2 .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #E2E8F0}',
    '#pm2 .page-head h1{font-size:20px;font-weight:600;color:#0D2F4F;letter-spacing:-0.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#pm2 .page-head h1 svg{width:18px;height:18px;color:#3DC5B7}',
    '#pm2 .page-head .subtitle{font-size:12px;color:#64748B;margin-top:4px}',
    '#pm2 .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}',
    // responsive
    '@media (max-width:768px){#pm2 .breakdown-grid{grid-template-columns:1fr}#pm2 table{font-size:12px}#pm2 thead th,#pm2 tbody td{padding:8px 6px}}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก tab/panel + 3 modal · คง element id เดิม =====
   ตัด app-shell/sidebar/sheet_link/brand_footer/page-actions-refresh(location.reload) · header เดิมคงไว้ */
function PM2_MARKUP() {
  return [
    // header เดิม (page-head) — ตัดปุ่ม Refresh (location.reload) เพราะ dashboard reload เองไม่ได้ · ใช้ปุ่มโหลด period แทน
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
    '      Payroll Manager',
    '    </h1>',
    '    <div class="subtitle">เงินเดือน + OT + ลา · gen payslip + 50ทวิ · sensitive (Owner + HR Manager)</div>',
    '  </div>',
    '  <div class="page-actions" id="yh-page-actions"></div>',
    '</header>',

    '<div class="page">',
    '  <div style="display:flex;justify-content:flex-end;align-items:start;margin-bottom:8px;">',
    '    <button class="help-btn" onclick="pmShowHelp()" title="คู่มือ">?</button>',
    '  </div>',

    '  <div class="period-bar">',
    '    <label>เดือน:</label>',
    '    <input type="month" id="periodInput" />',
    '    <button class="btn" onclick="loadPeriod()">โหลด</button>',
    '    <span style="flex:1"></span>',
    '    <span id="periodStatus" style="color:var(--muted);font-size:12px;"></span>',
    '  </div>',

    '  <div class="tabs">',
    '    <button class="tab active" data-tab="overview" onclick="pmSwitchTab(\'overview\')">Overview</button>',
    '    <button class="tab" data-tab="payslips" onclick="pmSwitchTab(\'payslips\')">Payslips</button>',
    '    <button class="tab" data-tab="compensation" onclick="pmSwitchTab(\'compensation\')">Compensation</button>',
    '    <button class="tab" data-tab="accounting" onclick="pmSwitchTab(\'accounting\')">Accounting</button>',
    '    <button class="tab" data-tab="history" onclick="pmSwitchTab(\'history\')">History</button>',
    '  </div>',

    '  <div class="panel active" id="panel-overview">',
    '    <div id="overviewContent" class="loading">เลือก period แล้วกดโหลด</div>',
    '  </div>',

    '  <div class="panel" id="panel-payslips">',
    '    <div id="payslipsContent" class="loading">เลือก period แล้วกดโหลด</div>',
    '  </div>',

    '  <div class="panel" id="panel-compensation">',
    '    <div class="btn-row">',
    '      <button class="btn btn-primary" onclick="openCompModal()">+ เพิ่ม entry</button>',
    '      <select id="compTypeFilter" onchange="loadCompensation()">',
    '        <option value="">ทุก type</option>',
    '        <option value="commission">commission</option>',
    '        <option value="allowance">allowance</option>',
    '        <option value="deduction">deduction</option>',
    '        <option value="other">other</option>',
    '      </select>',
    '    </div>',
    '    <div id="compContent" class="loading">เลือก period แล้วกดโหลด</div>',
    '  </div>',

    '  <div class="panel" id="panel-accounting">',
    '    <div class="info-banner">',
    '      <strong>Accounting Package</strong> — สร้าง CSV รวม OT + KPI scores + เวรหมอ + ใบลา ส่งให้บัญชี (Drive folder: YY_เงินเดือน_&lt;YYYY-MM&gt;)',
    '    </div>',
    '    <div class="btn-row">',
    '      <button class="btn btn-primary" onclick="generateAccounting()">Generate Accounting CSV</button>',
    '      <button class="btn" onclick="reviewPartTime()">Part-Time Review</button>',
    '    </div>',
    '    <div id="accountingResult"></div>',
    '    <div id="ptReviewResult" style="margin-top:16px;"></div>',
    '  </div>',

    '  <div class="panel" id="panel-history">',
    '    <div id="historyContent" class="loading">กำลังโหลด...</div>',
    '  </div>',
    '</div>',

    // Compensation Modal
    '<div class="modal-overlay" id="compModal">',
    '  <div class="modal">',
    '    <h3 id="compModalTitle">เพิ่ม Compensation Entry</h3>',
    '    <input type="hidden" id="compEntryId" value="" />',
    '    <div class="form-row"><label>พนักงาน (employee_id)</label><input type="text" id="compEmpId" placeholder="EMP001" /></div>',
    '    <div class="form-row"><label>เดือน (YYYY-MM)</label><input type="month" id="compYearMonth" /></div>',
    '    <div class="form-row"><label>Type</label>',
    '      <select id="compType">',
    '        <option value="commission">commission — ค่าคอมมิชชัน</option>',
    '        <option value="allowance">allowance — ค่าตอบแทน</option>',
    '        <option value="deduction">deduction — หัก ณ ที่จ่าย</option>',
    '        <option value="other">other — อื่นๆ</option>',
    '      </select>',
    '    </div>',
    '    <div class="form-row"><label>จำนวนเงิน (บาท)</label><input type="number" id="compAmount" step="0.01" min="0" /></div>',
    '    <div class="form-row"><label>หมายเหตุ</label><textarea id="compNotes" rows="2"></textarea></div>',
    '    <div class="modal-actions">',
    '      <button class="btn" onclick="closeCompModal()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveCompEntry()">บันทึก</button>',
    '    </div>',
    '  </div>',
    '</div>',

    // Salary Detail Modal
    '<div class="modal-overlay" id="detailModal">',
    '  <div class="modal" style="max-width:720px;">',
    '    <div id="detailContent">กำลังโหลด...</div>',
    '    <div class="modal-actions"><button class="btn" onclick="pmCloseDetailModal()">ปิด</button></div>',
    '  </div>',
    '</div>',

    // Help Modal
    '<div class="modal-overlay" id="helpModal">',
    '  <div class="modal" style="max-width:720px;">',
    '    <h3>คู่มือ Payroll Manager</h3>',
    '    <div style="font-size:13px;color:var(--text);line-height:1.7;">',
    '      <p><strong>Cycle ปกติ:</strong></p>',
    '      <ol>',
    '        <li><strong>1-20 ของเดือน:</strong> HR ใส่ entries ใน <code>Compensation</code> tab (commission/allowance/deduction)</li>',
    '        <li><strong>วันที่ 21:</strong> Generate Accounting Package — ส่งให้บัญชี</li>',
    '        <li><strong>วันที่ 25 (cutoff):</strong> Preview payroll ใน <code>Overview</code> tab</li>',
    '        <li><strong>วันที่ 28:</strong> Run Calculation → finalize SALARY_MONTHLY</li>',
    '        <li><strong>วันที่ 28-29:</strong> Generate Payslips PDF</li>',
    '        <li><strong>วันที่ 30 (pay day):</strong> Send LINE + Mark Paid</li>',
    '      </ol>',
    '      <p><strong>Permission:</strong></p>',
    '      <ul>',
    '        <li><strong>HR Officer+:</strong> ดู, เพิ่ม/แก้ Compensation entries, preview, ดู accounting</li>',
    '        <li><strong>HR Manager+:</strong> Run Calculation (finalize), Generate Payslips, Send LINE, Mark Paid, Generate Accounting</li>',
    '      </ul>',
    '      <p><strong>Note:</strong> หลัง finalize period แล้ว — ห้ามแก้ entries · ต้องเรียก <code>Recalc Employee</code> หากต้องการ</p>',
    '      <p style="background:#FEF3C7;border:1px solid #D97706;color:#92400E;padding:10px 12px;border-radius:8px;margin-top:8px;">หมายเหตุ (Dashboard): หน้านี้บน dashboard <strong>อ่านอย่างเดียว</strong> — แสดงข้อมูลเงินเดือนที่ถูกคำนวณ/finalize ฝั่งบัญชีแล้ว · ปุ่มคำนวณ/สร้าง payslip/อนุมัติจ่าย จะแจ้งว่ายังไม่พร้อม</p>',
    '    </div>',
    '    <div class="modal-actions"><button class="btn btn-primary" onclick="pmCloseHelp()">เข้าใจแล้ว</button></div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   PM2_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → PM_BACKEND
   JS หน้าเดิม verbatim (มี esc/fmtBaht ของตัวเอง) · fn ที่ inline onclick ใช้ → ผูก window
   ============================================================ */
function PM2_RUN_PAGE_JS() {

  // ---- google.script.run shim → PM_BACKEND (async, คืน shape เดิม) ----
  function _pm2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (PM_BACKEND[prop]) {
            Promise.resolve().then(function () { return PM_BACKEND[prop].apply(PM_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[PM_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[PM_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _pm2MakeChain(); } });

  // ---- toast helper (หน้าเดิมใช้ alert · เพิ่ม pm2Toast ให้ stub แจ้งได้ไม่รบกวน) ----
  function pm2ShowToast(msg, type) {
    var t = document.getElementById('pm2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pm2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#DC2626' : type === 'success' ? '#16A34A' : '#0D2F4F';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 3000);
  }
  window.pm2Toast = pm2ShowToast;

  // ============================================================
  //   JS หน้าเดิม payroll_manager.html (verbatim · scope ใน closure)
  //   - google = shim ด้านบน · esc()/fmtBaht() เป็นของหน้าเดิม (ไม่ชน global esc)
  //   - id ทั้งหมดอยู่ใต้ #pm2 · document.getElementById ใช้ได้ปกติ (id unique ในหน้า)
  //   - ตัด document.addEventListener('DOMContentLoaded', init) → เรียก init() ตรงๆ ตอนท้าย
  // ============================================================

  let _currentPeriod = '';
  let _currentSummary = null;
  let _currentPayslipFilter = '';

  function fmtBaht(n) {
    return '฿' + Math.round(Number(n || 0)).toLocaleString();
  }

  function init() {
    // Default to last month
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
    const ym = d.toISOString().slice(0, 7);
    document.getElementById('periodInput').value = ym;
    document.getElementById('compYearMonth').value = ym;
    loadHistory();
  }

  function pmSwitchTab(name) {
    document.querySelectorAll('#pm2 .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    document.querySelectorAll('#pm2 .panel').forEach(p => {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
    // Lazy load
    if (!_currentPeriod && name !== 'history') {
      document.getElementById(name === 'overview' ? 'overviewContent'
        : name === 'payslips' ? 'payslipsContent'
        : name === 'compensation' ? 'compContent' : 'accountingResult'
      ).innerHTML = '<div class="empty">เลือก period แล้วกด <strong>โหลด</strong> ก่อน</div>';
    }
  }

  function loadPeriod() {
    const ym = document.getElementById('periodInput').value;
    if (!ym) { alert('เลือกเดือนก่อน'); return; }
    _currentPeriod = ym;
    document.getElementById('periodStatus').textContent = 'กำลังโหลด ' + ym + '...';
    google.script.run
      .withSuccessHandler(onPeriodLoaded)
      .withFailureHandler(onError)
      .payrollGetPeriodSummary(ym);
  }

  function onPeriodLoaded(res) {
    document.getElementById('periodStatus').textContent = '';
    if (!res || res.error) {
      document.getElementById('overviewContent').innerHTML =
        '<div class="warn-banner">' + (res && res.error || 'โหลดล้มเหลว') + '</div>' +
        '<div class="info-banner">period นี้ยังไม่มีข้อมูล — กด <strong>Preview Calculation</strong> เพื่อ dry-run · กด <strong>Run Calculation</strong> เพื่อ finalize</div>' +
        '<div class="btn-row">' +
        '  <button class="btn btn-primary" onclick="previewCalc()">Preview Calculation (dry-run)</button>' +
        '  <button class="btn btn-danger" onclick="runCalc()">Run Calculation (finalize)</button>' +
        '</div>';
      return;
    }
    _currentSummary = res;
    renderOverview(res);
    // Auto-load payslips + comp ด้วย
    renderPayslips(res);
    loadCompensation();
  }

  function renderOverview(res) {
    const t = res.totals;
    const html = `
      <div class="stat-grid">
        <div class="stat teal">
          <div class="label">Net รวม</div>
          <div class="value">${fmtBaht(t.net)}</div>
          <div class="sub">${res.items.length} คน</div>
        </div>
        <div class="stat">
          <div class="label">Gross รวม</div>
          <div class="value">${fmtBaht(t.gross)}</div>
          <div class="sub">base + ot + comm + allow</div>
        </div>
        <div class="stat">
          <div class="label">ภาษีรวม</div>
          <div class="value">${fmtBaht(t.tax)}</div>
          <div class="sub">PIT รายเดือน</div>
        </div>
        <div class="stat">
          <div class="label">SPS Employee</div>
          <div class="value">${fmtBaht(t.sps_employee)}</div>
          <div class="sub">นายจ้างจ่ายเพิ่ม ${fmtBaht(t.sps_employer)}</div>
        </div>
        <div class="stat">
          <div class="label">Payslips Generated</div>
          <div class="value">${res.generated_count}/${res.items.length}</div>
        </div>
        <div class="stat">
          <div class="label">Paid</div>
          <div class="value">${res.paid_count}/${res.items.length}</div>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" onclick="generatePayslips()">Generate Payslips PDF</button>
        <button class="btn btn-primary" onclick="sendPayslipsLINE()">Send Payslips LINE</button>
        <button class="btn btn-danger" onclick="markPaid()">Mark Paid (All)</button>
        <button class="btn" onclick="previewCalc()">Re-preview</button>
      </div>

      <div class="breakdown-grid">
        <div class="card">
          <div class="card-header"><div class="card-title">Net ตาม Position</div></div>
          <div class="card-body" style="padding: 12px;">
            ${res.breakdown.by_position.slice(0, 10).map(x =>
              `<div class="row" style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 12px;">
                <span>${esc(x.name)}</span><strong>${fmtBaht(x.value)}</strong>
              </div>`
            ).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Net ตาม Branch</div></div>
          <div class="card-body" style="padding: 12px;">
            ${res.breakdown.by_branch.slice(0, 10).map(x =>
              `<div class="row" style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--border); font-size: 12px;">
                <span>${esc(x.name)}</span><strong>${fmtBaht(x.value)}</strong>
              </div>`
            ).join('')}
          </div>
        </div>
      </div>
    `;
    document.getElementById('overviewContent').innerHTML = html;
  }

  function renderPayslips(res) {
    const items = res.items;
    const html = `
      <div class="filter-row">
        <input type="search" placeholder="ค้นหาชื่อ / employee_id" oninput="filterPayslips(this.value)" />
        <span style="color: var(--muted); font-size: 12px;">${items.length} คน</span>
      </div>
      <div class="card">
        <table id="payslipsTable">
          <thead>
            <tr>
              <th>พนักงาน</th>
              <th>ตำแหน่ง</th>
              <th>สาขา</th>
              <th class="right">Base</th>
              <th class="right">OT</th>
              <th class="right">Comm</th>
              <th class="right">Allow</th>
              <th class="right">Gross</th>
              <th class="right">Tax</th>
              <th class="right">SPS</th>
              <th class="right">Deduct</th>
              <th class="right"><strong>Net</strong></th>
              <th class="center">Status</th>
              <th class="center">Action</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(x => renderPayslipRow(x)).join('')}
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('payslipsContent').innerHTML = html;
  }

  function renderPayslipRow(x) {
    const empLabel = esc((x.nickname || x.employee_name || x.employee_id));
    const statusPills = [];
    if (x.payslip_url) statusPills.push('<span class="pill pill-generated">PDF</span>');
    if (x.paid_at) statusPills.push('<span class="pill pill-paid">paid</span>');
    else statusPills.push('<span class="pill pill-unpaid">unpaid</span>');
    if (!x.line_linked) statusPills.push('<span class="pill pill-no-line">no LINE</span>');
    return `
      <tr data-name="${empLabel.toLowerCase()}" data-empid="${(x.employee_id || '').toLowerCase()}">
        <td>${empLabel}<br><span style="color: var(--muted); font-size: 11px;">${esc(x.employee_id)}</span></td>
        <td>${esc(x.position_name || '-')}</td>
        <td>${esc(x.branch_name || '-')}</td>
        <td class="right">${fmtBaht(x.base_salary)}</td>
        <td class="right">${fmtBaht(x.ot)}</td>
        <td class="right">${fmtBaht(x.commission)}</td>
        <td class="right">${fmtBaht(x.allowances)}</td>
        <td class="right">${fmtBaht(x.gross)}</td>
        <td class="right">${fmtBaht(x.tax)}</td>
        <td class="right">${fmtBaht(x.sps_employee)}</td>
        <td class="right">${fmtBaht(x.deductions)}</td>
        <td class="right"><strong>${fmtBaht(x.net_pay)}</strong></td>
        <td class="center">${statusPills.join(' ')}</td>
        <td class="center">
          <button class="btn btn-sm" onclick="pmViewDetail('${x.salary_id}')">View</button>
          <button class="btn btn-sm" onclick="recalcEmp('${x.employee_id}')">Recalc</button>
        </td>
      </tr>
    `;
  }

  function filterPayslips(q) {
    q = q.toLowerCase().trim();
    document.querySelectorAll('#payslipsTable tbody tr').forEach(tr => {
      const match = !q || tr.dataset.name.includes(q) || tr.dataset.empid.includes(q);
      tr.style.display = match ? '' : 'none';
    });
  }

  function pmViewDetail(salaryId) {
    document.getElementById('detailContent').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    document.getElementById('detailModal').classList.add('show');
    google.script.run
      .withSuccessHandler(renderDetail)
      .withFailureHandler(onError)
      .payrollGetSalaryDetail(salaryId);
  }

  function renderDetail(res) {
    if (!res || res.error) {
      document.getElementById('detailContent').innerHTML = '<div class="warn-banner">' + (res && res.error || 'โหลดล้มเหลว') + '</div>';
      return;
    }
    const s = res.salary;
    const e = res.employee;
    const html = `
      <h3 style="color: var(--navy);">${esc(e ? e.name : s.employee_id)} <span style="color: var(--muted); font-size: 14px;">${esc(s.year_month)}</span></h3>
      <div style="color: var(--muted); font-size: 12px;">${esc(e ? e.position_name : '')} · ${esc(e ? e.branch_name : '')}</div>
      <div class="breakdown-grid" style="margin-top: 16px;">
        <div class="breakdown-card">
          <h4>Earnings</h4>
          <div class="row"><span>Base salary</span><strong>${fmtBaht(s.base_salary)}</strong></div>
          <div class="row"><span>OT</span><strong>${fmtBaht(s.ot)}</strong></div>
          <div class="row"><span>Commission</span><strong>${fmtBaht(s.commission)}</strong></div>
          <div class="row"><span>Allowances</span><strong>${fmtBaht(s.allowances)}</strong></div>
          <div class="row" style="border-top: 2px solid var(--navy); margin-top: 4px; padding-top: 8px;"><span><strong>Gross</strong></span><strong>${fmtBaht(s.gross)}</strong></div>
        </div>
        <div class="breakdown-card">
          <h4>Deductions</h4>
          <div class="row"><span>ภาษี (PIT)</span><strong>${fmtBaht(s.tax)}</strong></div>
          <div class="row"><span>ประกันสังคม</span><strong>${fmtBaht(s.sps_employee)}</strong></div>
          <div class="row"><span>Other deductions</span><strong>${fmtBaht(s.deductions)}</strong></div>
          <div class="row" style="border-top: 2px solid var(--teal); margin-top: 4px; padding-top: 8px;"><span><strong>Net</strong></span><strong style="color: var(--teal);">${fmtBaht(s.net_pay)}</strong></div>
        </div>
      </div>
      ${res.compensation_entries.length ? `
        <h4 style="margin-top: 16px; color: var(--navy);">Compensation Entries</h4>
        <table style="font-size: 12px;">
          <thead><tr><th>Type</th><th class="right">Amount</th><th>Notes</th></tr></thead>
          <tbody>
            ${res.compensation_entries.map(c => `
              <tr><td><span class="pill pill-${c.type}">${esc(c.type)}</span></td>
                <td class="right">${fmtBaht(c.amount)}</td><td>${esc(c.notes || '-')}</td></tr>
            `).join('')}
          </tbody>
        </table>` : ''}
      ${res.ot_records.length ? `
        <h4 style="margin-top: 16px; color: var(--navy);">OT Records (${res.ot_records.length})</h4>
        <table style="font-size: 12px;">
          <thead><tr><th>วันที่</th><th class="right">ชม.</th><th>Day type</th><th>Status</th></tr></thead>
          <tbody>
            ${res.ot_records.map(o => `
              <tr><td>${esc(String(o.date).slice(0,10))}</td><td class="right">${o.hours}</td>
                <td>${esc(o.day_type)}</td><td>${esc(o.status)}</td></tr>
            `).join('')}
          </tbody>
        </table>` : ''}
      ${s.paid_at ? `<div class="info-banner" style="margin-top: 16px;">จ่ายแล้วเมื่อ <strong>${esc(s.paid_at)}</strong></div>` : ''}
      ${s.payslip_url ? `<a href="${esc(s.payslip_url)}" target="_blank" class="btn btn-primary" style="margin-top: 12px; text-decoration: none;">เปิด Payslip PDF</a>` : ''}
      ${s.cost_center_split ? `<div style="margin-top: 12px; font-size: 11px; color: var(--muted);">Cost center split: ${esc(s.cost_center_split)}</div>` : ''}
    `;
    document.getElementById('detailContent').innerHTML = html;
  }

  function pmCloseDetailModal() {
    document.getElementById('detailModal').classList.remove('show');
  }

  // ====== Compensation ======
  function loadCompensation() {
    if (!_currentPeriod) return;
    const filterType = document.getElementById('compTypeFilter').value;
    document.getElementById('compContent').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(renderCompensation)
      .withFailureHandler(onError)
      .payrollListCompensation(_currentPeriod, filterType);
  }

  function renderCompensation(res) {
    if (!res || res.error) {
      document.getElementById('compContent').innerHTML = '<div class="warn-banner">' + (res && res.error || 'โหลดล้มเหลว') + '</div>';
      return;
    }
    if (!res.items.length) {
      document.getElementById('compContent').innerHTML = '<div class="empty">ยังไม่มี entries สำหรับ period นี้</div>';
      return;
    }
    const total = res.items.reduce((s, x) => s + (x.amount || 0), 0);
    const byType = {};
    res.items.forEach(x => { byType[x.type] = (byType[x.type] || 0) + (x.amount || 0); });
    const html = `
      <div class="stat-grid">
        <div class="stat teal"><div class="label">ทั้งหมด</div><div class="value">${fmtBaht(total)}</div><div class="sub">${res.items.length} entries</div></div>
        ${Object.entries(byType).map(([k, v]) => `
          <div class="stat"><div class="label">${esc(k)}</div><div class="value">${fmtBaht(v)}</div></div>
        `).join('')}
      </div>
      <div class="card">
        <table>
          <thead>
            <tr><th>พนักงาน</th><th>Period</th><th>Type</th><th class="right">Amount</th><th>Notes</th><th>By</th><th></th></tr>
          </thead>
          <tbody>
            ${res.items.map(x => `
              <tr>
                <td>${esc(x.nickname || x.employee_name || x.employee_id)}<br><span style="color: var(--muted); font-size: 11px;">${esc(x.employee_id)}</span></td>
                <td>${esc(x.year_month)}</td>
                <td><span class="pill pill-${x.type}">${esc(x.type)}</span></td>
                <td class="right">${fmtBaht(x.amount)}</td>
                <td>${esc(x.notes || '-')}</td>
                <td style="color: var(--muted); font-size: 11px;">${esc(x.created_by || '')}<br>${esc(x.created_at || '')}</td>
                <td>
                  <button class="btn btn-sm" onclick='editCompEntry(${JSON.stringify(x).replace(/'/g, "\\'")})'>แก้</button>
                  <button class="btn btn-sm btn-danger" onclick="removeCompEntry('${x.entry_id}')">ลบ</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('compContent').innerHTML = html;
  }

  function openCompModal() {
    document.getElementById('compModalTitle').textContent = 'เพิ่ม Compensation Entry';
    document.getElementById('compEntryId').value = '';
    document.getElementById('compEmpId').value = '';
    document.getElementById('compYearMonth').value = _currentPeriod || document.getElementById('periodInput').value;
    document.getElementById('compType').value = 'commission';
    document.getElementById('compAmount').value = '';
    document.getElementById('compNotes').value = '';
    document.getElementById('compModal').classList.add('show');
  }

  function editCompEntry(x) {
    document.getElementById('compModalTitle').textContent = 'แก้ Compensation Entry';
    document.getElementById('compEntryId').value = x.entry_id;
    document.getElementById('compEmpId').value = x.employee_id;
    document.getElementById('compEmpId').readOnly = true;
    document.getElementById('compYearMonth').value = x.year_month;
    document.getElementById('compYearMonth').readOnly = true;
    document.getElementById('compType').value = x.type;
    document.getElementById('compAmount').value = x.amount;
    document.getElementById('compNotes').value = x.notes || '';
    document.getElementById('compModal').classList.add('show');
  }

  function closeCompModal() {
    document.getElementById('compModal').classList.remove('show');
    document.getElementById('compEmpId').readOnly = false;
    document.getElementById('compYearMonth').readOnly = false;
  }

  function saveCompEntry() {
    const entryId = document.getElementById('compEntryId').value;
    const payload = {
      employee_id: document.getElementById('compEmpId').value.trim(),
      year_month: document.getElementById('compYearMonth').value,
      type: document.getElementById('compType').value,
      amount: Number(document.getElementById('compAmount').value),
      notes: document.getElementById('compNotes').value.trim(),
    };
    if (!payload.employee_id || !payload.year_month || !(payload.amount > 0)) {
      alert('ใส่ employee_id + เดือน + amount ให้ครบ');
      return;
    }
    const handler = entryId
      ? () => google.script.run.withSuccessHandler(onCompSaved).withFailureHandler(onError)
          .payrollUpdateCompensation(entryId, payload)
      : () => google.script.run.withSuccessHandler(onCompSaved).withFailureHandler(onError)
          .payrollAddCompensation(payload);
    handler();
  }

  function onCompSaved(res) {
    if (!res || res.error) { alert((res && res.error) || 'บันทึกล้มเหลว'); return; }
    closeCompModal();
    loadCompensation();
  }

  function removeCompEntry(id) {
    if (!confirm('ลบรายการนี้?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (!r || r.error) { alert((r && r.error) || 'ลบล้มเหลว'); return; }
        loadCompensation();
      })
      .withFailureHandler(onError)
      .payrollRemoveCompensation(id);
  }

  // ====== Mutations ======
  function previewCalc() {
    if (!_currentPeriod) { alert('เลือก period ก่อน'); return; }
    document.getElementById('overviewContent').innerHTML = '<div class="loading">กำลัง preview...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) {
          document.getElementById('overviewContent').innerHTML =
            '<div class="warn-banner">' + (res && res.error || 'preview ล้มเหลว') + '</div>';
          return;
        }
        const t = res.totals;
        const html = `
          ${res.warning ? '<div class="warn-banner">' + esc(res.warning) + '</div>' : ''}
          <div class="info-banner">PREVIEW (dry-run) · ${res.employee_count} คน · ยังไม่ insert</div>
          <div class="stat-grid">
            <div class="stat teal"><div class="label">Net รวม (preview)</div><div class="value">${fmtBaht(t.net)}</div></div>
            <div class="stat"><div class="label">Gross</div><div class="value">${fmtBaht(t.gross)}</div></div>
            <div class="stat"><div class="label">Tax</div><div class="value">${fmtBaht(t.tax)}</div></div>
            <div class="stat"><div class="label">SPS</div><div class="value">${fmtBaht(t.sps)}</div></div>
          </div>
          <div class="btn-row">
            <button class="btn btn-danger" onclick="runCalc()">Confirm — Finalize Period</button>
            <button class="btn" onclick="loadPeriod()">ยกเลิก</button>
          </div>
          <div class="card"><table>
            <thead><tr><th>พนักงาน</th><th>ตำแหน่ง</th><th class="right">Base</th><th class="right">OT ชม.</th><th class="right">Gross</th><th class="right">Tax</th><th class="right">Net</th></tr></thead>
            <tbody>
              ${res.previews.map(p => `
                <tr>
                  <td>${esc(p.nickname || p.name)}<br><span style="color: var(--muted); font-size: 11px;">${esc(p.employee_id)}</span></td>
                  <td>${esc(p.position_name || '')}</td>
                  <td class="right">${fmtBaht(p.base_salary)}</td>
                  <td class="right">${p.ot_hours}</td>
                  <td class="right">${fmtBaht(p.gross)}</td>
                  <td class="right">${fmtBaht(p.tax)}</td>
                  <td class="right"><strong>${fmtBaht(p.net)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table></div>
        `;
        document.getElementById('overviewContent').innerHTML = html;
      })
      .withFailureHandler(onError)
      .payrollPreview(_currentPeriod);
  }

  function runCalc() {
    if (!_currentPeriod) { alert('เลือก period ก่อน'); return; }
    if (!confirm('Finalize payroll สำหรับ ' + _currentPeriod + '? จะ insert SALARY_MONTHLY rows + ส่ง audit log\n(หลังจากนี้แก้ Compensation ไม่ได้)')) return;
    document.getElementById('overviewContent').innerHTML = '<div class="loading">กำลัง finalize...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) { alert((res && res.error) || 'finalize ล้มเหลว'); loadPeriod(); return; }
        alert('Finalize สำเร็จ ' + res.employee_count + ' คน');
        loadPeriod();
      })
      .withFailureHandler(onError)
      .payrollRunCalculation(_currentPeriod);
  }

  function generatePayslips() {
    if (!confirm('Generate payslip PDF สำหรับ ' + _currentPeriod + '? (ใช้ Google Doc template)')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) { alert((res && res.error) || 'generate ล้มเหลว'); return; }
        alert('Generated ' + res.generated_count + '/' + res.total);
        loadPeriod();
      })
      .withFailureHandler(onError)
      .payrollGeneratePayslips(_currentPeriod);
  }

  function sendPayslipsLINE() {
    if (!confirm('ส่ง payslip flex หาพนักงานทุกคนผ่าน LINE สำหรับ ' + _currentPeriod + '?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) { alert((res && res.error) || 'ส่งล้มเหลว'); return; }
        alert('ส่งสำเร็จ ' + res.sent + ' · skipped ' + res.skipped + ' · failed ' + res.failed);
      })
      .withFailureHandler(onError)
      .payrollSendPayslipsLINE(_currentPeriod);
  }

  function markPaid() {
    if (!confirm('ยืนยันว่าจ่ายเงินเดือน ' + _currentPeriod + ' แล้ว?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) { alert((res && res.error) || 'mark paid ล้มเหลว'); return; }
        alert('Mark paid ' + res.marked_count + ' รายการ');
        loadPeriod();
      })
      .withFailureHandler(onError)
      .payrollMarkPaid(_currentPeriod);
  }

  function recalcEmp(employeeId) {
    if (!confirm('Re-calculate สำหรับ ' + employeeId + '? (ลบ row เก่าใน ' + _currentPeriod + ' แล้วรันใหม่)')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) { alert((res && res.error) || 'recalc ล้มเหลว'); return; }
        alert('Recalc สำเร็จ · Net ' + fmtBaht(res.net));
        loadPeriod();
      })
      .withFailureHandler(onError)
      .payrollRecalcEmp(_currentPeriod, employeeId);
  }

  function generateAccounting() {
    if (!_currentPeriod) { alert('เลือก period ก่อน'); return; }
    if (!confirm('Generate Accounting Package สำหรับ ' + _currentPeriod + '?\n(จะสร้าง CSV ใน Drive folder YY_เงินเดือน_' + _currentPeriod + ')')) return;
    document.getElementById('accountingResult').innerHTML = '<div class="loading">กำลังสร้าง...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) {
          document.getElementById('accountingResult').innerHTML =
            '<div class="warn-banner">' + (res && res.error || 'สร้างล้มเหลว') + '</div>';
          return;
        }
        document.getElementById('accountingResult').innerHTML = `
          <div class="info-banner">
            <strong>Accounting Package พร้อมแล้ว</strong><br>
            Period: ${esc(res.period)} · Employees: ${res.employees}<br>
            <a href="${esc(res.file_url)}" target="_blank" class="btn btn-primary" style="margin-top: 8px; text-decoration: none; display: inline-block;">เปิด CSV ใน Drive</a>
          </div>
        `;
      })
      .withFailureHandler(onError)
      .payrollGenerateAccounting(_currentPeriod);
  }

  function reviewPartTime() {
    if (!_currentPeriod) { alert('เลือก period ก่อน'); return; }
    document.getElementById('ptReviewResult').innerHTML = '<div class="loading">กำลังคำนวณ...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) {
          document.getElementById('ptReviewResult').innerHTML =
            '<div class="warn-banner">' + (res && res.error || 'review ล้มเหลว') + '</div>';
          return;
        }
        const byType = res.by_type || {};
        const html = `
          <div class="card">
            <div class="card-header"><div class="card-title">Part-Time Review · ${esc(_currentPeriod)}</div></div>
            <div class="card-body" style="padding: 16px;">
              <p>Total entries: <strong>${res.total_entries}</strong> · Total amount: <strong>${fmtBaht(res.total_amount)}</strong></p>
              <table>
                <thead><tr><th>Type</th><th class="right">Amount</th></tr></thead>
                <tbody>
                  ${Object.entries(byType).map(([k, v]) =>
                    `<tr><td><span class="pill pill-${k}">${esc(k)}</span></td><td class="right">${fmtBaht(v)}</td></tr>`
                  ).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        document.getElementById('ptReviewResult').innerHTML = html;
      })
      .withFailureHandler(onError)
      .payrollReviewPartTime(_currentPeriod);
  }

  function loadHistory() {
    document.getElementById('historyContent').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) {
          document.getElementById('historyContent').innerHTML =
            '<div class="warn-banner">' + (res && res.error || 'โหลดล้มเหลว') + '</div>';
          return;
        }
        if (!res.items || !res.items.length) {
          document.getElementById('historyContent').innerHTML = '<div class="empty">ยังไม่มี period ที่ run แล้ว</div>';
          return;
        }
        const html = `
          <div class="card">
            <table>
              <thead>
                <tr><th>Period</th><th class="right">Employees</th><th class="right">Gross</th>
                  <th class="right">Net</th><th class="right">Tax</th><th class="right">SPS</th>
                  <th class="center">PDF</th><th class="center">Paid</th><th></th></tr>
              </thead>
              <tbody>
                ${res.items.map(p => `
                  <tr>
                    <td><strong>${esc(p.year_month)}</strong></td>
                    <td class="right">${p.employee_count}</td>
                    <td class="right">${fmtBaht(p.total_gross)}</td>
                    <td class="right"><strong>${fmtBaht(p.total_net)}</strong></td>
                    <td class="right">${fmtBaht(p.total_tax)}</td>
                    <td class="right">${fmtBaht(p.total_sps)}</td>
                    <td class="center">${p.generated_count}/${p.employee_count}</td>
                    <td class="center">${p.paid_count}/${p.employee_count}</td>
                    <td><button class="btn btn-sm" onclick="jumpToPeriod('${p.year_month}')">เปิด</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
        document.getElementById('historyContent').innerHTML = html;
      })
      .withFailureHandler(onError)
      .payrollListPeriods();
  }

  function jumpToPeriod(ym) {
    document.getElementById('periodInput').value = ym;
    pmSwitchTab('overview');
    loadPeriod();
  }

  function pmShowHelp() { document.getElementById('helpModal').classList.add('show'); }
  function pmCloseHelp() { document.getElementById('helpModal').classList.remove('show'); }

  function onError(e) {
    alert('Error: ' + (e && e.message ? e.message : e));
  }

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---- ผูก fn ที่ inline onclick ใช้ ลง window (closure scope ไม่ถึง global onclick) ----
  window.pmSwitchTab = pmSwitchTab;
  window.loadPeriod = loadPeriod;
  window.previewCalc = previewCalc;
  window.runCalc = runCalc;
  window.generatePayslips = generatePayslips;
  window.sendPayslipsLINE = sendPayslipsLINE;
  window.markPaid = markPaid;
  window.recalcEmp = recalcEmp;
  window.pmViewDetail = pmViewDetail;
  window.pmCloseDetailModal = pmCloseDetailModal;
  window.filterPayslips = filterPayslips;
  window.loadCompensation = loadCompensation;
  window.openCompModal = openCompModal;
  window.editCompEntry = editCompEntry;
  window.closeCompModal = closeCompModal;
  window.saveCompEntry = saveCompEntry;
  window.removeCompEntry = removeCompEntry;
  window.generateAccounting = generateAccounting;
  window.reviewPartTime = reviewPartTime;
  window.jumpToPeriod = jumpToPeriod;
  window.pmShowHelp = pmShowHelp;
  window.pmCloseHelp = pmCloseHelp;

  // ---- init (แทน DOMContentLoaded ของหน้าเดิม) ----
  init();
}

// expose mount ให้ index.html lazy-loader เรียก (top-level)
if (typeof window !== 'undefined') window.mountPayrollmgr = mountPayrollmgr;
