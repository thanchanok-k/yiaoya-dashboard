// _ported/emp360.js — FULL native port of desktop employee_360.html (HR · หน้า "โปรไฟล์ 360°")
// ลอกทั้งดุ้น: picker (search/filter chips/group/sort + keyboard nav) + per-employee profile
//   (sticky identity bar + metric strip + tabs: overview/kpi/time/engage/comp/docs/people/profile/contract)
//   CSS เดิม (<style> หน้า e360) prefix ทุก selector ด้วย #e3 · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ E3_RUN_PAGE_JS() · google.script.run = shim → E3_BACKEND (Supabase)
//
// ใช้ global window.sb / window.esc / window.$ (index.html module scope) — ห้าม redeclare
// fn/var ที่ inline onclick/markup ต้องใช้ → ผูกกับ window (prefix e3 กันชน) ภายใน E3_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=employee.updated → {items}) :
//   list (picker) → derive รายชื่อ/branches/types/positions/statuses client-side จาก payload ล่าสุดต่อ employee
//                   (มีข้อมูลจริง 68 คน · render ได้แม้ list ว่าง → empty state สวย)
//   profile รายคน → ใช้ field จาก employee.updated (profile/org/leave-quota ถ้ามี) · derive ภาพรวมเท่าที่ได้
//   KPI / attendance / salary / docs / contract / training ฯลฯ → ไม่มี endpoint บน dashboard
//                   → แสดง empty state เดิม (ลอก markup) · ไม่ error
//   PII sensitive (เงินเดือน/ปกส./เอกสาร) — แค่ port หน้าจอ · ไม่มี backend ดึงมาแสดง
//   WRITE ทั้งหมด (saveProfile/savePreferences/saveNotes/saveLeaveQuota/badge/payslip/upload/archive …)
//                   → stub + showToast('ยังไม่พร้อมบน dashboard')

/* ============================================================
   E3_BACKEND — map google.script.run → Supabase edge fn hr_list (type=employee.updated)
   ============================================================ */
var E3_FN = 'hr_list';
var E3_TYPE = 'employee.updated';

function e3ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function e3Num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function e3Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function e3Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// map payload event ดิบ → employee row shape ที่ JS เดิม (picker + profile) ใช้
function e3MapEmp(p) {
  p = p || {};
  var first = p.first_name || '';
  var last = p.last_name || '';
  if (!first && p.full_name) {
    var parts = String(p.full_name).trim().split(/\s+/);
    first = parts.shift() || '';
    last = parts.join(' ');
  }
  var fullName = p.full_name || (first + ' ' + last).trim();
  return {
    employee_id: p.employee_id || p.entity_id || '',
    first_name: first,
    last_name: last,
    nickname: p.nickname || '',
    full_name: fullName,
    position_id: p.position_id || '',
    position: p.position_name || p.position || '',
    position_name: p.position_name || p.position || '',
    branch: p.primary_branch_name || p.branch_name || p.branch || p.primary_branch_id || '',
    primary_branch_id: p.primary_branch_id || '',
    department_id: p.department_id || '',
    department_name: p.department_name || p.department_th || p.department || '',
    supervisor_id: p.supervisor_id || '',
    supervisor_name: p.supervisor_name || '',
    employee_type: p.employee_type || p.emp_type || '',
    email: p.email || '',
    phone: p.phone || '',
    line_user_id: p.line_user_id || '',
    start_date: e3Date(p.start_date),
    end_date: e3Date(p.end_date),
    status: String(p.status || 'active').toLowerCase(),
    tags: Array.isArray(p.tags) ? p.tags.join(',') : (p.tags || ''),
    birth_date: e3Date(p.birth_date),
    favorite_color: p.favorite_color || '',
    cake_type: p.cake_type || '',
    food_like: p.food_like || '',
    food_allergy: p.food_allergy || '',
    favorite_things: p.favorite_things || '',
    // PDPA: ไม่เก็บ payload ดิบ (_raw) ใน heap — เก็บเฉพาะ field ที่ whitelist ไว้ข้างบน
    // (national_id/salary/bank_account/free-text ที่ไม่ได้ render จะไม่ค้างในหน่วยความจำ)
  };
}

// cache payload ล่าสุดต่อ employee (profile reuse จาก list · backend ไม่มี endpoint แยก)
var _e3Emps = [];
var _e3ById = {};

function e3FetchEmployees() {
  return sb.functions.invoke(E3_FN + '?type=' + encodeURIComponent(E3_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = e3ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.employee_id || p.entity_id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      var row = e3MapEmp(p);
      _e3ById[id] = row;
      rows.push(row);
    });
    _e3Emps = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[E3_BACKEND] list fetch failed', e);
    _e3Emps = []; return [];
  });
}

// อายุงาน (ปี) จาก start_date
function e3TenureYears(startDate) {
  if (!startDate) return 0;
  var d = new Date(startDate); if (isNaN(d.getTime())) return 0;
  var ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / (365.25 * 86400000)));
}
function e3TenureLabel(startDate) {
  if (!startDate) return '';
  var d = new Date(startDate); if (isNaN(d.getTime())) return '';
  var now = new Date();
  var months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (months < 0) months = 0;
  var y = Math.floor(months / 12), m = months % 12;
  if (y <= 0) return m + ' เดือน';
  return m > 0 ? (y + ' ปี ' + m + ' เดือน') : (y + ' ปี');
}

var E3_BACKEND = {
  // role gate — dashboard user = admin/owner เต็มสิทธิ์ (ดูได้ · เขียนยังไม่พร้อม)
  emp360WhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },

  // picker list — คืน array employee row (มี field ที่ picker ใช้)
  emp360PickList: function () {
    return e3FetchEmployees().then(function (rows) { return rows.slice(); });
  },

  // profile รายคน — reuse cache · derive ภาพรวมเท่าที่ field มี
  emp360Profile: function (employeeId) {
    var build = function () {
      var e = _e3ById[employeeId];
      if (!e) {
        var e0 = _e3Emps.find(function (x) { return x.employee_id === employeeId; });
        if (e0) e = e0;
      }
      if (!e) return { error: 'ไม่พบพนักงาน', employee: null };
      // supervisor / subordinates / department จากชุดที่ดึงมา
      var supervisor = e.supervisor_id ? _e3ById[e.supervisor_id] : null;
      var subordinates = _e3Emps.filter(function (x) { return x.supervisor_id && x.supervisor_id === e.employee_id; });
      return {
        employee: e,
        supervisor: supervisor ? { nickname: supervisor.nickname || supervisor.full_name, position_id: supervisor.position_id || supervisor.position } : null,
        subordinates: subordinates.map(function (s) { return { nickname: s.nickname || s.full_name }; }),
        department: e.department_name ? { department_name: e.department_name, department_id: e.department_id } : null,
        tenureYears: e3TenureYears(e.start_date),
        tenureLabel: e3TenureLabel(e.start_date),
      };
    };
    if (_e3Emps.length || Object.keys(_e3ById).length) return Promise.resolve(build());
    return e3FetchEmployees().then(build);
  },

  // ---- WRITE: เขียนกลับ Sheet / ส่ง LINE / upload ไม่ได้บน dashboard → stub + toast ----
  updateEmployeeProfile: function () { e3NotReady('บันทึก Profile'); return Promise.resolve({ error: 'บันทึกยังไม่พร้อมบน dashboard (read-only)' }); },
  updateEmployeePreferences: function () { e3NotReady('บันทึกความชอบ'); return Promise.resolve({ error: 'บันทึกยังไม่พร้อมบน dashboard (read-only)' }); },
  updateEmployeeNotes: function () { e3NotReady('บันทึก HR Notes'); return Promise.resolve({ error: 'บันทึกยังไม่พร้อมบน dashboard (read-only)' }); },
  updateEmployeeLeaveQuota: function () { e3NotReady('บันทึกโควต้าลา'); return Promise.resolve({ error: 'บันทึกโควต้ายังไม่พร้อมบน dashboard (read-only)' }); },
  getEmployeeSheetUrl: function () { e3NotReady('เปิดใน Google Sheet'); return Promise.resolve(''); },
  sendBadgeToEmployee: function () { e3NotReady('ส่ง Digital Badge ทาง LINE'); return Promise.resolve({ error: 'ส่ง Badge ยังไม่พร้อมบน dashboard' }); },
  getLatestPayslipUrl: function () { e3NotReady('เปิด Payslip'); return Promise.resolve(''); },
  // docs (PII) — ไม่มี endpoint บน dashboard
  empDocsListAdmin: function () { e3NotReady('โหลดเอกสาร (PDPA)'); return Promise.resolve({ ok: false, error: 'เอกสารยังไม่พร้อมบน dashboard' }); },
  empDocsUploadAdmin: function () { e3NotReady('อัพโหลดเอกสาร'); return Promise.resolve({ ok: false, error: 'อัพโหลดยังไม่พร้อมบน dashboard' }); },
  empDocsDownloadAdmin: function () { e3NotReady('ดาวน์โหลดเอกสาร'); return Promise.resolve({ ok: false, error: 'ดาวน์โหลดยังไม่พร้อมบน dashboard' }); },
  empDocsArchiveAdmin: function () { e3NotReady('ลบเอกสาร'); return Promise.resolve({ ok: false, error: 'ลบเอกสารยังไม่พร้อมบน dashboard' }); },
  // leave / contract detail
  leaveAdminGetDetail: function () { e3NotReady('รายละเอียดคำขอลา'); return Promise.resolve({ error: 'รายละเอียดคำขอลายังไม่พร้อมบน dashboard' }); },
  leaveCertView: function () { e3NotReady('ดูใบรับรองแพทย์'); return Promise.resolve({ error: 'ดูใบรับรองยังไม่พร้อมบน dashboard' }); },
  contractAdminFor360: function () { return Promise.resolve({ ok: true, contracts: [], detail: null }); },
};

var _e3NotReadyShown = {};
function e3NotReady(feature) {
  if (_e3NotReadyShown[feature]) return;
  _e3NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.e3Toast) window.e3Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   window.mountEmp360 — render เข้า #wrap-emp360
   ============================================================ */
window.mountEmp360 = function mountEmp360() {
  var wrap = document.getElementById('wrap-emp360');
  if (!wrap) return;
  wrap.innerHTML = '<style>' + E3_CSS() + '</style><div id="e3"><div class="loading" style="padding:40px;text-align:center;color:#64748B;font-size:13px;">กำลังโหลด…</div></div>';
  // โหลดรายชื่อก่อน → แสดง picker (ค่าเริ่มต้น) · เลือกคนแล้วค่อย render profile
  E3_BACKEND.emp360PickList().then(function (rows) {
    E3_RENDER_PICKER(rows);
  }).catch(function (e) {
    var root = document.getElementById('e3');
    if (root) root.innerHTML = '<div class="empty-v2"><div class="et">โหลดรายชื่อพนักงานไม่ได้</div><div class="es">' + (window.esc ? window.esc(e && e.message) : '') + '</div></div>';
  });
};

/* ===== CSS เดิม (<style> หน้า e360) · prefix ทุก selector ด้วย #e3 =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว) */
function E3_CSS() {
  return [
    '#e3{--navy:#0D2F4F;--teal:#3DC5B7;--teal-hover:#2BA89B;--teal-light:#E6F7F5;--bg:#F5F6F8;--card:#FFFFFF;--border:#E5E7EB;--text-1:#111827;--text-2:#6B7280;--text-3:#9CA3AF;--success:#16A34A;--warning:#F59E0B;--error:#DC2626;--info:#3B82F6;--radius-sm:6px;--radius-md:8px;--radius-lg:12px;--radius-xl:16px;color:var(--text-1);line-height:1.5;}',
    '#e3 *{box-sizing:border-box;}',
    '#e3 .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;}',
    '#e3 .container{padding:0;}',
    '#e3 .alert-zone{margin-bottom:16px;min-height:0;}',
    '#e3 .alert{padding:14px 18px;border-radius:var(--radius-md);font-size:14px;margin-bottom:12px;display:flex;align-items:center;gap:10px;}',
    '#e3 .alert::before{content:"";width:8px;height:8px;border-radius:50%;flex-shrink:0;}',
    '#e3 .alert-success{background:#DCFCE7;color:#14532D;border-left:4px solid var(--success);}',
    '#e3 .alert-success::before{background:var(--success);}',
    '#e3 .alert-error{background:#FEE2E2;color:#7F1D1D;border-left:4px solid var(--error);}',
    '#e3 .alert-error::before{background:var(--error);}',
    '#e3 .grid-2{display:grid;grid-template-columns:2fr 1fr;gap:20px;}',
    '#e3 .grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}',
    '@media (max-width:1000px){#e3 .grid-2{grid-template-columns:1fr;}}',
    '@media (max-width:600px){#e3 .grid-3{grid-template-columns:repeat(2,1fr);}}',
    '#e3 .card{background:var(--card);border-radius:var(--radius-lg);padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.04);border:1px solid var(--border);}',
    '#e3 .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border);}',
    '#e3 .card-title{font-size:15px;font-weight:600;color:var(--navy);display:flex;align-items:center;gap:10px;}',
    '#e3 .card-title::before{content:"";width:4px;height:16px;background:var(--teal);border-radius:2px;}',
    '#e3 .card-action{font-size:12px;color:var(--teal);font-weight:500;}',
    '#e3 .card-meta{font-size:11px;color:var(--text-3);}',
    '#e3 .stats-3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}',
    '#e3 .stat-box{background:var(--teal-light);padding:14px 10px;border-radius:var(--radius-md);text-align:center;}',
    '#e3 .stat-box-v{font-size:24px;font-weight:700;color:var(--navy);line-height:1;}',
    '#e3 .stat-box-l{font-size:11px;color:var(--text-2);margin-top:6px;font-weight:500;}',
    '#e3 .leave-list{display:flex;flex-direction:column;gap:6px;margin-bottom:4px;}',
    '#e3 .leave-row{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;padding:10px 12px;background:#F8FAFC;border:1px solid #EEF2F6;border-radius:var(--radius-md);}',
    '#e3 .leave-row.row-zero{background:#FAFBFC;border-color:#F1F3F5;}',
    '#e3 .leave-row.row-zero .lv-label{color:var(--text-3);}',
    '#e3 .leave-row .lv-label{font-size:13px;color:var(--navy);font-weight:500;}',
    '#e3 .leave-row .lv-nums{display:flex;align-items:baseline;gap:8px;font-size:12px;color:var(--text-2);}',
    '#e3 .leave-row .lv-used{color:var(--text-2);}',
    '#e3 .leave-row .lv-sep{color:var(--text-3);}',
    '#e3 .leave-row .lv-rem{color:var(--navy);font-weight:600;font-size:13px;}',
    '#e3 .leave-row .lv-rem.rem-low{color:var(--warning);}',
    '#e3 .leave-row .lv-rem.rem-zero{color:var(--error);}',
    '#e3 .leave-row .lv-rem.rem-inf{color:#0F766E;font-weight:600;}',
    '#e3 .leave-row .lv-unit{font-size:11px;color:var(--text-3);font-weight:400;margin-left:2px;}',
    '#e3 .info-row{display:flex;justify-content:space-between;padding:8px 0;font-size:13px;border-bottom:1px solid #F3F4F6;gap:8px;}',
    '#e3 .info-row:last-child{border-bottom:none;}',
    '#e3 .info-row .label{color:var(--text-2);flex-shrink:0;}',
    '#e3 .info-row .value{color:var(--text-1);font-weight:500;text-align:right;}',
    '#e3 .form-group{margin-bottom:14px;}',
    '#e3 .form-group label{display:block;font-size:12px;color:var(--text-2);margin-bottom:6px;font-weight:500;}',
    '#e3 .form-group input,#e3 .form-group select,#e3 .form-group textarea{width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-md);font-size:14px;font-family:inherit;color:var(--text-1);transition:all 0.15s;min-height:38px;}',
    '#e3 .form-group input:focus,#e3 .form-group select:focus,#e3 .form-group textarea:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,0.15);}',
    '#e3 .form-group textarea{resize:vertical;min-height:90px;}',
    '#e3 .btn{padding:10px 16px;border-radius:var(--radius-md);font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all 0.15s;display:inline-flex;align-items:center;gap:8px;min-height:38px;justify-content:center;font-family:inherit;}',
    '#e3 .btn:disabled{opacity:0.5;cursor:wait;}',
    '#e3 .btn-primary{background:var(--teal);color:white;}',
    '#e3 .btn-primary:hover:not(:disabled){background:var(--teal-hover);}',
    '#e3 .btn-secondary{background:white;color:var(--navy);border:1px solid var(--border);}',
    '#e3 .btn-secondary:hover:not(:disabled){background:var(--bg);}',
    '#e3 .btn-sm{padding:6px 12px;font-size:12px;min-height:30px;}',
    '#e3 .ico{width:16px;height:16px;flex-shrink:0;}',
    '#e3 .kpi-hero{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:linear-gradient(135deg,var(--teal-light),white);border-radius:var(--radius-md);margin-bottom:12px;flex-wrap:wrap;gap:12px;}',
    '#e3 .kpi-grade{font-size:36px;font-weight:700;color:var(--success);line-height:1;}',
    '#e3 .kpi-score{font-size:26px;font-weight:700;color:var(--navy);}',
    '#e3 .kpi-trend{font-size:12px;color:var(--success);margin-top:4px;font-weight:500;}',
    '#e3 .kpi-period{font-size:11px;color:var(--text-2);margin-top:4px;}',
    '#e3 .chart-wrap{position:relative;height:180px;margin-top:12px;}',
    '#e3 .leave-item,#e3 .timeline-item{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #F3F4F6;gap:8px;}',
    '#e3 .leave-item:last-child,#e3 .timeline-item:last-child{border-bottom:none;}',
    '#e3 .item-left{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0;}',
    '#e3 .item-date{font-size:13px;font-weight:500;color:var(--text-1);}',
    '#e3 .item-meta{font-size:11px;color:var(--text-2);}',
    '#e3 .badge{display:inline-block;padding:3px 10px;border-radius:var(--radius-xl);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;flex-shrink:0;}',
    '#e3 .badge-ok{background:#DCFCE7;color:#14532D;}',
    '#e3 .badge-warn{background:#FEF3C7;color:#78350F;}',
    '#e3 .badge-fail{background:#FEE2E2;color:#7F1D1D;}',
    '#e3 .badge-info{background:var(--teal-light);color:var(--navy);}',
    '#e3 .badge-neutral{background:#F3F4F6;color:var(--text-2);}',
    '#e3 .empty{text-align:center;padding:24px 12px;color:var(--text-2);font-size:12px;}',
    '#e3 .empty-icon{display:flex;width:40px;height:40px;margin:0 auto 10px;background:var(--teal-light);border-radius:50%;align-items:center;justify-content:center;color:var(--teal);}',
    '#e3 .progress-bar{height:8px;background:var(--border);border-radius:4px;overflow:hidden;margin-top:8px;}',
    '#e3 .progress-fill{height:100%;background:var(--teal);transition:width 0.3s;}',
    '#e3 .quick-actions{display:flex;gap:8px;flex-wrap:wrap;}',
    '#e3 .quick-actions .btn{flex:1;justify-content:center;min-width:130px;}',
    '#e3 .locked-notice{font-size:11px;color:var(--text-2);padding:12px;background:var(--bg);border-radius:var(--radius-sm);text-align:center;}',
    '#e3 .org-card{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--bg);border-radius:var(--radius-sm);margin-bottom:6px;font-size:13px;}',
    '#e3 .org-card .label{color:var(--text-2);font-size:11px;}',
    '#e3 .org-card .value{color:var(--text-1);font-weight:500;}',
    '#e3 .milestone-card{background:linear-gradient(135deg,#FEF3C7,white);border:1px solid var(--warning);border-radius:var(--radius-md);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;}',
    '#e3 .milestone-card .label{font-size:12px;color:#78350F;font-weight:600;}',
    '#e3 .milestone-card .value{font-size:14px;color:var(--navy);font-weight:700;}',
    '#e3 .pref-sw{width:30px;height:30px;border-radius:8px;cursor:pointer;border:2px solid transparent;position:relative;transition:all 0.15s;}',
    '#e3 .pref-sw:hover{transform:scale(1.08);}',
    '#e3 .pref-sw.sel{border-color:var(--navy);}',
    '#e3 .pref-sw.sel::after{content:"\\2713";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.35);}',
    // metric strip / tabs / engagement / timeline (e360 v2)
    '#e3 .e360-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}',
    '@media (max-width:880px){#e3 .e360-strip{grid-template-columns:repeat(2,1fr);}}',
    '#e3 .e360-metric{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px;position:relative;overflow:hidden;}',
    '#e3 .e360-metric::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal);}',
    '#e3 .e360-metric .ml{font-size:11px;color:var(--text-2);}',
    '#e3 .e360-metric .mv{font-size:24px;font-weight:700;color:var(--navy);margin-top:6px;line-height:1;}',
    '#e3 .e360-metric .mt{font-size:11px;margin-top:6px;color:var(--text-2);}',
    '#e3 .e360-metric .mt.up{color:var(--success);}',
    '#e3 .e360-metric .mt.down{color:var(--error);}',
    '#e3 .e360-spark{height:28px;margin-top:8px;}',
    '#e3 .emp-sticky-bar{position:sticky;top:0;z-index:7;display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:16px 18px;background:#FFFFFF;border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:0 2px 4px rgba(13,47,79,0.04);margin:0 0 16px;}',
    '#e3 .emp-sticky-bar .esb-av{width:56px;height:56px;border-radius:50%;background:var(--teal);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;flex-shrink:0;}',
    '#e3 .emp-sticky-bar .esb-body{flex:1;min-width:200px;}',
    '#e3 .emp-sticky-bar .esb-name{font-size:20px;font-weight:700;color:var(--navy);}',
    '#e3 .emp-sticky-bar .esb-name .esb-fullname{font-weight:400;font-size:14px;color:var(--text-2);margin-left:4px;}',
    '#e3 .emp-sticky-bar .esb-meta{font-size:13px;color:var(--text-2);margin-top:4px;}',
    '#e3 .emp-sticky-bar .esb-status{flex-shrink:0;font-size:12px;padding:5px 12px;}',
    '#e3 .emp-sticky-bar .esb-back{flex-shrink:0;border:1px solid var(--border);background:#fff;color:var(--navy);border-radius:8px;padding:7px 12px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px;}',
    '#e3 .emp-sticky-bar .esb-back:hover{background:var(--bg);}',
    '@media (max-width:640px){#e3 .emp-sticky-bar{padding:12px 14px;gap:12px;}#e3 .emp-sticky-bar .esb-av{width:44px;height:44px;font-size:18px;}#e3 .emp-sticky-bar .esb-name{font-size:17px;}#e3 .emp-sticky-bar .esb-name .esb-fullname{display:block;margin-left:0;margin-top:2px;}#e3 .emp-sticky-bar .esb-meta{font-size:12px;}}',
    '#e3 .e360-tabs{display:flex;gap:2px;margin:6px 0 18px;border-bottom:1px solid var(--border);overflow-x:auto;position:sticky;top:52px;background:#FAFBFC;z-index:6;}',
    '#e3 .nav-tab{font-size:13px;font-weight:500;color:var(--text-2);padding:11px 15px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;display:flex;align-items:center;gap:7px;}',
    '#e3 .nav-tab:hover{color:var(--navy);}',
    '#e3 .nav-tab.active{color:var(--navy);font-weight:600;border-bottom-color:var(--teal);}',
    '#e3 .nav-tab .adot{width:6px;height:6px;border-radius:50%;background:var(--error);}',
    '#e3 .e360-pane{display:none;}',
    '#e3 .e360-pane.active{display:block;}',
    '#e3 .gauge-box{position:relative;width:110px;height:110px;flex-shrink:0;}',
    '#e3 .gauge-box .gv{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}',
    '#e3 .gauge-box .gv .n{font-size:28px;font-weight:700;color:var(--navy);line-height:1;}',
    '#e3 .gauge-box .gv .l{font-size:10px;color:var(--text-2);margin-top:2px;}',
    '#e3 .eng-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid #F3F4F6;font-size:13px;}',
    '#e3 .eng-row:last-child{border-bottom:none;}',
    '#e3 .eng-row .en{flex:0 0 140px;color:var(--text-1);font-weight:500;}',
    '#e3 .eng-track{flex:1;height:8px;background:#F3F4F6;border-radius:4px;overflow:hidden;}',
    '#e3 .eng-fill{height:100%;border-radius:4px;background:var(--teal);}',
    '#e3 .eng-row .ev{flex:0 0 46px;text-align:right;font-weight:600;color:var(--navy);}',
    '#e3 .empty-v2{text-align:center;padding:26px 18px;border:1px dashed var(--border);border-radius:var(--radius-md);background:#FCFCFD;}',
    '#e3 .empty-v2 .ei{width:46px;height:46px;margin:0 auto 12px;background:var(--teal-light);border-radius:14px;display:flex;align-items:center;justify-content:center;color:#0F766E;}',
    '#e3 .empty-v2 .et{font-size:14px;font-weight:600;color:var(--navy);}',
    '#e3 .empty-v2 .es{font-size:12px;color:var(--text-2);margin-top:5px;max-width:360px;margin-left:auto;margin-right:auto;}',
    '#e3 .empty-v2 .ea{margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;}',
    '#e3 .grid-2e{display:grid;grid-template-columns:1fr 1fr;gap:16px;}',
    '@media (max-width:1000px){#e3 .grid-2e{grid-template-columns:1fr;}}',
    '#e3 .sens-note{display:flex;align-items:center;gap:11px;padding:11px 15px;border-radius:var(--radius-md);font-size:13px;margin-bottom:14px;background:#FBEAF0;color:#9D174D;border-left:4px solid #DB2777;}',
    // picker (lifted จาก inline style เดิม · scope #e3)
    '#e3 .e3-pick-card{background:#fff;border:1px solid var(--border);border-radius:var(--radius-lg);padding:20px;}',
  ].join('\n');
}

/* ============================================================
   E3_RENDER_PICKER — หน้าเลือกพนักงาน (ลอก markup+JS picker เดิมทั้งดุ้น)
   ============================================================ */
function E3_RENDER_PICKER(rows) {
  var root = document.getElementById('e3');
  if (!root) return;
  var esc = window.esc || function (s) { return String(s == null ? '' : s); };

  root.innerHTML = [
    '<div class="container">',
    '  <div class="e3-pick-card">',
    '    <div style="margin-bottom:14px;">',
    '      <div style="font-size:14px;font-weight:600;color:#0D2F4F;">เลือกพนักงานที่ต้องการดู</div>',
    '      <div style="font-size:12px;color:#6B7280;margin-top:2px;">พิมพ์ชื่อเล่น ชื่อจริง รหัส ตำแหน่ง หรือสาขา · ใช้ลูกศร ↑↓ แล้ว Enter เพื่อเปิด</div>',
    '    </div>',
    '    <input id="emp360Search" type="text" placeholder="ค้นหาพนักงาน..." autocomplete="off" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #E2E8F0;border-radius:8px;font-size:14px;font-family:inherit;margin-bottom:10px;" />',
    '    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:7px;"><span style="font-size:11px;color:#64748B;width:48px;flex-shrink:0;">สาขา</span><div id="emp360Branch" style="display:flex;flex-wrap:wrap;gap:5px;"></div></div>',
    '    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:7px;"><span style="font-size:11px;color:#64748B;width:48px;flex-shrink:0;">ประเภท</span><div id="emp360Type" style="display:flex;flex-wrap:wrap;gap:5px;"></div></div>',
    '    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:7px;"><span style="font-size:11px;color:#64748B;width:48px;flex-shrink:0;">ตำแหน่ง</span><select id="emp360Position" style="height:28px;max-width:280px;border:1px solid #E2E8F0;border-radius:6px;font-size:11px;font-family:inherit;background:#fff;padding:0 8px;cursor:pointer;"></select></div>',
    '    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px;"><span style="font-size:11px;color:#64748B;width:48px;flex-shrink:0;">สถานะ</span><div id="emp360Status" style="display:flex;flex-wrap:wrap;gap:5px;"></div>',
    '      <div style="margin-left:auto;display:flex;align-items:center;gap:10px;">',
    '        <select id="emp360GroupBy" style="height:28px;border:1px solid #E2E8F0;border-radius:6px;font-size:11px;font-family:inherit;background:#fff;padding:0 6px;cursor:pointer;"><option value="none">ไม่จัดกลุ่ม</option><option value="branch">จัดกลุ่ม: สาขา</option><option value="position">จัดกลุ่ม: ตำแหน่ง</option></select>',
    '        <select id="emp360Sort" style="height:28px;border:1px solid #E2E8F0;border-radius:6px;font-size:11px;font-family:inherit;background:#fff;padding:0 6px;cursor:pointer;"><option value="status">เรียง: สถานะ</option><option value="name">เรียง: ชื่อ</option><option value="branch">เรียง: สาขา</option><option value="type">เรียง: ประเภท</option><option value="position">เรียง: ตำแหน่ง</option></select>',
    '      </div>',
    '    </div>',
    '    <div id="emp360Count" style="font-size:12px;color:#9CA3AF;margin-bottom:8px;"></div>',
    '    <div id="emp360List" style="display:flex;flex-direction:column;gap:6px;max-height:62vh;overflow:auto;"></div>',
    '    <div id="emp360Empty" style="display:none;text-align:center;color:#9CA3AF;font-size:13px;padding:24px;">ไม่พบพนักงานที่ตรงกับเงื่อนไข</div>',
    '  </div>',
    '</div>',
  ].join('\n');

  // ===== picker JS (ลอกจากหน้าเดิม · เปลี่ยน <a href> → onclick window.e3OpenProfile กันชน hash) =====
  var EMP360_LIST = rows || [];
  var listEl = document.getElementById('emp360List');
  var emptyEl = document.getElementById('emp360Empty');
  var countEl = document.getElementById('emp360Count');
  var searchEl = document.getElementById('emp360Search');
  var branchWrap = document.getElementById('emp360Branch');
  var typeWrap = document.getElementById('emp360Type');
  var positionSel = document.getElementById('emp360Position');
  var statusWrap = document.getElementById('emp360Status');
  var sortEl = document.getElementById('emp360Sort');
  var groupByEl = document.getElementById('emp360GroupBy');

  var AV_PAL = [['#0D2F4F', '#E2E8F0'], ['#0F766E', '#E1F5EE'], ['#3C3489', '#EEEDFE'], ['#993C1D', '#FAECE7'], ['#185FA5', '#E6F1FB'], ['#993556', '#FBEAF0']];
  function hashStr(s) { var h = 0; s = String(s || ''); for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h; }
  function avColor(branch) { return branch ? AV_PAL[hashStr(branch) % AV_PAL.length] : ['#64748B', '#F1F5F9']; }
  function posColor(p) { return p ? AV_PAL[hashStr('p:' + p) % AV_PAL.length] : ['#64748B', '#F1F5F9']; }
  function initial(e) { var s = String(e.nickname || e.full_name || e.employee_id || '?').trim(); return s.charAt(0).toUpperCase() || '?'; }

  function typeKey(raw) {
    var t = String(raw || '').toLowerCase();
    if (/ฝึกงาน|intern/.test(t)) return 'intern';
    if (/พาร์ท|part/.test(t)) return 'part';
    if (/สัญญา|contract|freelance|ฟรีแลนซ์/.test(t)) return 'contract';
    if (/ประจำ|full/.test(t)) return 'full';
    return raw ? 'other' : 'none';
  }
  var TYPE_STYLE = { full: ['#475569', '#F1F5F9'], part: ['#185FA5', '#E6F1FB'], contract: ['#534AB7', '#EEEDFE'], intern: ['#854F0B', '#FAEEDA'], other: ['#475569', '#F1F5F9'], none: ['#94A3B8', '#F8FAFC'] };
  var TYPE_RANK = { full: 0, part: 1, contract: 2, intern: 3, other: 4, none: 5 };
  function typeLabel(raw, key) { return key === 'none' ? 'ไม่ระบุ' : (raw || key); }

  var STATUS_INFO = { active: ['#E6F7F5', '#0F766E', 'ทำงาน', 0], probation: ['#FEF3C7', '#92400E', 'ทดลองงาน', 1], resigned: ['#F3F4F6', '#6B7280', 'ลาออก', 2], terminated: ['#F3F4F6', '#6B7280', 'พ้นสภาพ', 3] };
  function statusInfo(st) { return STATUS_INFO[st] || ['#F3F4F6', '#6B7280', (st || '-'), 9]; }

  var branches = [], types = [], positions = [], statuses = [];
  (function () {
    var bSeen = {}, tSeen = {}, pSeen = {}, sSeen = {};
    EMP360_LIST.forEach(function (e) {
      var b = e.branch || ''; if (!(b in bSeen)) { bSeen[b] = true; branches.push(b); }
      var tk = typeKey(e.employee_type); if (!(tk in tSeen)) { tSeen[tk] = { key: tk, raw: e.employee_type || '' }; }
      var p = e.position || ''; if (!(p in pSeen)) { pSeen[p] = true; positions.push(p); }
      var s = e.status || ''; if (!(s in sSeen)) { sSeen[s] = true; statuses.push(s); }
    });
    types = Object.keys(tSeen).map(function (k) { return tSeen[k]; }).sort(function (a, b) { return (TYPE_RANK[a.key] || 9) - (TYPE_RANK[b.key] || 9); });
    branches.sort(function (a, b) { if (!a) return 1; if (!b) return -1; return a.localeCompare(b, 'th'); });
    positions.sort(function (a, b) { if (!a) return 1; if (!b) return -1; return a.localeCompare(b, 'th'); });
    statuses.sort(function (a, b) { return statusInfo(a)[3] - statusInfo(b)[3]; });
  })();

  var brSel = {}; branches.forEach(function (b) { brSel[b] = true; }); var brAll = true;
  var tySel = 'all', poSel = 'all', stSel = 'all', active = -1, flat = [];

  function chipStyle(on, border, txt, bg) { return 'display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:13px;font-size:11px;cursor:pointer;user-select:none;border:1px solid ' + (on ? border : '#E2E8F0') + ';background:' + (on ? bg : '#fff') + ';color:' + (on ? txt : '#0F172A') + ';'; }
  function bindChips(wrap, sel, fn) { var els = wrap.querySelectorAll(sel); for (var i = 0; i < els.length; i++) { (function (el) { el.onclick = function () { fn(el); }; })(els[i]); } }

  function renderBranchChips() {
    var html = '<span class="e3-bc" data-b="__ALL__" style="' + chipStyle(brAll, '#0D2F4F', '#fff', '#0D2F4F') + '">ทุกสาขา</span>';
    branches.forEach(function (b) {
      var on = !brAll && brSel[b]; var col = avColor(b); var cnt = EMP360_LIST.filter(function (e) { return (e.branch || '') === b; }).length;
      html += '<span class="e3-bc" data-b="' + esc(b) + '" style="' + chipStyle(on, col[0], col[0], col[1]) + '">' + esc(b || 'ไม่ระบุสาขา') + ' <span style="opacity:.6;">' + cnt + '</span></span>';
    });
    branchWrap.innerHTML = html;
    bindChips(branchWrap, '.e3-bc', function (el) {
      var b = el.getAttribute('data-b');
      if (b === '__ALL__') { brAll = true; branches.forEach(function (x) { brSel[x] = true; }); }
      else if (brAll) { brAll = false; branches.forEach(function (x) { brSel[x] = (x === b); }); }
      else {
        brSel[b] = !brSel[b];
        var none = branches.every(function (x) { return !brSel[x]; });
        var all = branches.every(function (x) { return brSel[x]; });
        if (none || all) { brAll = true; branches.forEach(function (x) { brSel[x] = true; }); }
      }
      active = -1; render();
    });
  }
  function renderTypeChips() {
    var html = '<span class="e3-tc" data-t="all" style="' + chipStyle(tySel === 'all', '#0D2F4F', '#fff', '#0D2F4F') + '">ทั้งหมด</span>';
    types.forEach(function (t) {
      var on = tySel === t.key; var st = TYPE_STYLE[t.key] || TYPE_STYLE.other; var cnt = EMP360_LIST.filter(function (e) { return typeKey(e.employee_type) === t.key; }).length;
      html += '<span class="e3-tc" data-t="' + esc(t.key) + '" style="' + chipStyle(on, st[0], st[0], st[1]) + '">' + esc(typeLabel(t.raw, t.key)) + ' <span style="opacity:.6;">' + cnt + '</span></span>';
    });
    typeWrap.innerHTML = html;
    bindChips(typeWrap, '.e3-tc', function (el) { tySel = el.getAttribute('data-t'); active = -1; render(); });
  }
  function buildPositionOptions() {
    var html = '<option value="all">ทั้งหมด</option>';
    positions.forEach(function (p) {
      var cnt = EMP360_LIST.filter(function (e) { return (e.position || '') === p; }).length;
      html += '<option value="' + esc(p) + '">' + esc(p || 'ไม่ระบุตำแหน่ง') + ' (' + cnt + ')</option>';
    });
    positionSel.innerHTML = html;
    positionSel.value = poSel;
  }
  function renderStatusChips() {
    var html = '<span class="e3-sc" data-s="all" style="' + chipStyle(stSel === 'all', '#0D2F4F', '#fff', '#0D2F4F') + '">ทั้งหมด</span>';
    statuses.forEach(function (s) {
      var on = stSel === s; var inf = statusInfo(s);
      html += '<span class="e3-sc" data-s="' + esc(s) + '" style="' + chipStyle(on, inf[1], inf[1], inf[0]) + '">' + esc(inf[2]) + '</span>';
    });
    statusWrap.innerHTML = html;
    bindChips(statusWrap, '.e3-sc', function (el) { stSel = el.getAttribute('data-s'); active = -1; render(); });
  }

  function rowHtml(e, idx) {
    var av = avColor(e.branch); var inf = statusInfo(e.status); var tk = typeKey(e.employee_type); var ts = TYPE_STYLE[tk] || TYPE_STYLE.other;
    var title = esc(e.nickname || e.full_name || e.employee_id);
    var posLine = e.position ? '<span style="display:block;font-size:12px;font-weight:600;color:#0F766E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(e.position) + '</span>' : '';
    var meta = [e.full_name, e.branch].filter(Boolean).map(esc).join(' · ');
    var metaLine = meta ? '<span style="display:block;font-size:12px;color:#6B7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + meta + '</span>' : '';
    var internTag = (tk === 'intern') ? ' <span style="font-size:10px;padding:1px 7px;border-radius:999px;background:' + ts[1] + ';color:' + ts[0] + ';vertical-align:1px;">' + esc(typeLabel(e.employee_type, tk)) + '</span>' : '';
    var typeTag = (tk !== 'intern' && tk !== 'none') ? '<span style="font-size:10px;padding:1px 7px;border-radius:999px;background:' + ts[1] + ';color:' + ts[0] + ';white-space:nowrap;">' + esc(typeLabel(e.employee_type, tk)) + '</span>' : '';
    return '<a href="javascript:void(0)" onclick="window.e3OpenProfile(\'' + esc(e.employee_id).replace(/'/g, "\\'") + '\')" class="e3-row" data-idx="' + idx + '" ' +
      'style="display:flex;align-items:center;gap:11px;padding:9px 11px;border:1px solid ' + (idx === active ? '#3DC5B7' : '#EEF2F6') + ';border-radius:8px;text-decoration:none;color:inherit;background:' + (idx === active ? '#E6F7F5' : '#fff') + ';">' +
      '<span style="width:34px;height:34px;border-radius:50%;background:' + av[1] + ';color:' + av[0] + ';display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0;">' + esc(initial(e)) + '</span>' +
      '<span style="min-width:0;flex:1;">' +
      '<span style="display:block;font-size:14px;font-weight:600;color:#0D2F4F;">' + title + ' <span style="font-weight:400;color:#9CA3AF;font-size:12px;">' + esc(e.employee_id) + '</span>' + internTag + '</span>' +
      posLine + metaLine +
      '</span>' +
      '<span style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;">' +
      '<span style="font-size:11px;padding:2px 9px;border-radius:999px;background:' + inf[0] + ';color:' + inf[1] + ';white-space:nowrap;">' + esc(inf[2]) + '</span>' +
      typeTag +
      '</span></a>';
  }

  function currentItems() {
    var q = (searchEl.value || '').trim().toLowerCase();
    var items = EMP360_LIST.filter(function (e) {
      if (!brAll && !brSel[e.branch || '']) return false;
      if (tySel !== 'all' && typeKey(e.employee_type) !== tySel) return false;
      if (poSel !== 'all' && (e.position || '') !== poSel) return false;
      if (stSel !== 'all' && (e.status || '') !== stSel) return false;
      if (q && [e.nickname, e.full_name, e.employee_id, e.position, e.branch, e.employee_type].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var sortBy = sortEl.value;
    items.sort(function (a, b) {
      var an = a.nickname || a.full_name || '', bn = b.nickname || b.full_name || '';
      if (sortBy === 'name') return an.localeCompare(bn, 'th');
      if (sortBy === 'branch') return String(a.branch || '~').localeCompare(String(b.branch || '~'), 'th') || an.localeCompare(bn, 'th');
      if (sortBy === 'type') return (TYPE_RANK[typeKey(a.employee_type)] || 9) - (TYPE_RANK[typeKey(b.employee_type)] || 9) || an.localeCompare(bn, 'th');
      if (sortBy === 'position') return String(a.position || '~').localeCompare(String(b.position || '~'), 'th') || an.localeCompare(bn, 'th');
      return statusInfo(a.status)[3] - statusInfo(b.status)[3] || an.localeCompare(bn, 'th');
    });
    return items;
  }

  function render() {
    renderBranchChips(); renderTypeChips(); renderStatusChips();
    var items = currentItems();
    var groupBy = groupByEl.value;
    var ordered = [], sections = [];
    if (groupBy === 'branch' || groupBy === 'position') {
      var keyOf = function (e) { return (groupBy === 'branch' ? (e.branch || '') : (e.position || '')); };
      var emptyLabel = (groupBy === 'branch' ? 'ไม่ระบุสาขา' : 'ไม่ระบุตำแหน่ง');
      var colOf = function (k) { return groupBy === 'branch' ? avColor(k) : posColor(k); };
      var order;
      if (groupBy === 'branch') { order = brAll ? branches.slice() : branches.filter(function (b) { return brSel[b]; }); }
      else { order = positions.slice(); }
      order.forEach(function (k) {
        var g = items.filter(function (e) { return keyOf(e) === k; });
        if (!g.length) return;
        sections.push({ key: k, label: (k || emptyLabel), col: colOf(k), start: ordered.length, items: g });
        g.forEach(function (e) { ordered.push(e); });
      });
    } else {
      items.forEach(function (e) { ordered.push(e); });
    }
    flat = ordered;
    if (active >= flat.length) active = flat.length - 1;

    countEl.textContent = items.length ? ('แสดง ' + items.length + ' คน' + (items.length < EMP360_LIST.length ? (' จาก ' + EMP360_LIST.length) : '')) : '';
    if (!items.length) { listEl.innerHTML = ''; emptyEl.style.display = 'block'; return; }
    emptyEl.style.display = 'none';

    var html = '';
    if (sections.length) {
      sections.forEach(function (sec) {
        var col = sec.col;
        html += '<div style="font-size:11px;font-weight:600;color:' + col[0] + ';padding:8px 2px 2px;display:flex;align-items:center;gap:6px;"><span style="width:7px;height:7px;border-radius:50%;background:' + col[0] + ';"></span>' + esc(sec.label) + ' · ' + sec.items.length + ' คน</div>';
        sec.items.forEach(function (e, j) { html += rowHtml(e, sec.start + j); });
      });
    } else {
      flat.forEach(function (e, i) { html += rowHtml(e, i); });
    }
    listEl.innerHTML = html;
  }

  function scrollActive() { var el = listEl.querySelector('.e3-row[data-idx="' + active + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }

  searchEl.addEventListener('input', function () { active = -1; render(); });
  sortEl.addEventListener('change', render);
  groupByEl.addEventListener('change', render);
  positionSel.addEventListener('change', function () { poSel = positionSel.value; active = -1; render(); });
  searchEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(active + 1, flat.length - 1); render(); scrollActive(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(active - 1, 0); render(); scrollActive(); }
    else if (ev.key === 'Enter' && active >= 0 && flat[active]) { ev.preventDefault(); window.e3OpenProfile(flat[active].employee_id); }
  });

  buildPositionOptions();
  render();
  try { searchEl.focus(); } catch (e) { }
}

// expose: เปิดโปรไฟล์ของพนักงานคนหนึ่ง (เรียกจาก picker row)
window.e3OpenProfile = function (employeeId) {
  var root = document.getElementById('e3');
  if (root) root.innerHTML = '<div class="loading" style="padding:40px;text-align:center;color:#64748B;font-size:13px;">กำลังโหลดโปรไฟล์…</div>';
  E3_BACKEND.emp360Profile(employeeId).then(function (data) {
    if (!data || !data.employee) {
      if (root) root.innerHTML = '<div class="empty-v2"><div class="et">ไม่พบข้อมูลพนักงาน</div><div class="es">กรุณาตรวจสอบ employee_id อีกครั้ง</div><div class="ea"><button class="btn btn-secondary btn-sm" onclick="window.e3BackToPicker()">← กลับไปเลือกพนักงาน</button></div></div>';
      return;
    }
    E3_RENDER_PROFILE(data);
  });
};
// กลับไปหน้าเลือก
window.e3BackToPicker = function () { E3_RENDER_PICKER(_e3Emps.slice()); };

/* ============================================================
   E3_RENDER_PROFILE — หน้าโปรไฟล์รายคน (ลอก markup เดิม · เติม data เท่าที่มี)
   แล้วรัน E3_RUN_PAGE_JS (tab switching + write-stubs + google shim)
   ============================================================ */
function E3_RENDER_PROFILE(data) {
  var root = document.getElementById('e3');
  if (!root) return;
  var esc = window.esc || function (s) { return String(s == null ? '' : s); };
  var emp = data.employee;
  var supervisor = data.supervisor;
  var subordinates = data.subordinates || [];
  var department = data.department;
  var tenureLabel = data.tenureLabel || (data.tenureYears + ' ปี');

  var statusBadgeCls = emp.status === 'active' ? 'badge-ok' : (emp.status === 'probation' ? 'badge-warn' : 'badge-neutral');
  var statusLabel = emp.status === 'active' ? 'ทำงานอยู่' : (emp.status === 'probation' ? 'ทดลองงาน' : (emp.status === 'resigned' ? 'ลาออก' : emp.status));

  var avChar = (emp.nickname || emp.first_name || '?').charAt(0);
  var stickyMeta = [emp.employee_id, (emp.position || emp.position_id || '-'), (emp.branch || emp.primary_branch_id || '-')]
    .concat(department ? [(department.department_name || '')] : [])
    .concat(['อายุงาน ' + (tenureLabel || '-')]).join(' · ');

  // empty-state helper (ลอก .empty-v2 เดิม)
  function emptyV2(title, sub, iconPath) {
    return '<div class="empty-v2"><div class="ei"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + iconPath + '</svg></div><div class="et">' + esc(title) + '</div>' + (sub ? '<div class="es">' + esc(sub) + '</div>' : '') + '</div>';
  }
  var ICON_CLOCK = '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>';
  var ICON_CHART = '<line x1="3" y1="20" x2="21" y2="20"/><rect x="6" y="10" width="3" height="10"/><rect x="11" y="6" width="3" height="14"/><rect x="16" y="13" width="3" height="7"/>';
  var ICON_CAL = '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>';
  var ICON_DOC = '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>';
  var ICON_BOOK = '<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>';

  var note = '<div class="card"><div class="empty">ฟีเจอร์นี้ดึงข้อมูลจากระบบหลังบ้าน (Sheet/GAS) ยังไม่พร้อมบน dashboard</div></div>';

  root.innerHTML = [
    '<div class="container">',
    '  <div id="alertBox" class="alert-zone" role="status" aria-live="polite"></div>',

    // sticky identity bar (เพิ่มปุ่มกลับ)
    '  <div class="emp-sticky-bar">',
    '    <button class="esb-back" onclick="window.e3BackToPicker()" title="กลับไปเลือกพนักงาน">‹ รายชื่อ</button>',
    '    <div class="esb-av">' + esc(avChar) + '</div>',
    '    <div class="esb-body">',
    '      <div class="esb-name">' + esc(emp.nickname || emp.first_name || '') + '<span class="esb-fullname">(' + esc(emp.first_name || '') + ' ' + esc(emp.last_name || '') + ')</span></div>',
    '      <div class="esb-meta">' + esc(stickyMeta) + '</div>',
    '    </div>',
    '    <span class="badge esb-status ' + statusBadgeCls + '">' + esc(statusLabel) + '</span>',
    '  </div>',

    // METRIC STRIP (ไม่มี KPI/attendance/leave backend → empty state)
    '  <div class="e360-strip">',
    '    <div class="e360-metric"><div class="ml">KPI ล่าสุด</div><div class="mv">—</div><div class="mt">ยังไม่มี KPI บน dashboard</div></div>',
    '    <div class="e360-metric"><div class="ml">มาทำงาน · เดือนนี้</div><div class="mv">—</div><div class="mt">ยังไม่มีข้อมูลลงเวลา</div></div>',
    '    <div class="e360-metric"><div class="ml">อ่านประกาศ</div><div class="mv">—</div><div class="mt">ยังไม่มีข้อมูลประกาศ</div></div>',
    '    <div class="e360-metric"><div class="ml">วันลา (ใช้ · เหลือ)</div><div class="mv">—</div><div class="mt">ยังไม่มีโควต้าลา</div></div>',
    '  </div>',

    // TABS
    '  <nav class="e360-tabs" id="e360Tabs">',
    '    <div class="nav-tab active" data-pane="overview">ภาพรวม</div>',
    '    <div class="nav-tab" data-pane="kpi">KPI &amp; ผลงาน</div>',
    '    <div class="nav-tab" data-pane="time">เวลา + ลา</div>',
    '    <div class="nav-tab" data-pane="engage">การมีส่วนร่วม</div>',
    '    <div class="nav-tab" data-pane="comp">ค่าตอบแทน</div>',
    '    <div class="nav-tab" data-pane="docs">เอกสาร</div>',
    '    <div class="nav-tab" data-pane="people">คน + พัฒนา</div>',
    '    <div class="nav-tab" data-pane="profile">โปรไฟล์ + HR</div>',
    '    <div class="nav-tab" data-pane="contract">สัญญา &amp; กฎ</div>',
    '  </nav>',

    // OVERVIEW
    '  <section class="e360-pane active" data-pane="overview">',
    '    <div class="grid-2">',
    '      <div>',
    '        <div class="card"><div class="card-header"><div class="card-title">Activity Timeline</div><span class="card-meta">รวมทุกระบบ · ล่าสุด</span></div>',
    '          ' + emptyV2('ยังไม่มีกิจกรรมที่บันทึกไว้', 'เมื่อพนักงานเริ่มลา / ขอ OT / อ่านประกาศ / ยืมอุปกรณ์ / มี 1:1 รายการจะมาแสดงที่นี่ตามลำดับเวลา (ยังไม่พร้อมบน dashboard)', ICON_CLOCK),
    '        </div>',
    '      </div>',
    '      <div>',
    '        <div class="card"><div class="card-header"><div class="card-title">Leave Balance</div></div>',
    '          <div class="empty">ยังไม่มีโควต้าลาบน dashboard</div>',
    '        </div>',
    '        <div class="card"><div class="card-header"><div class="card-title">Org Context</div></div>',
    (supervisor ? '          <div class="org-card"><span style="width:32px;height:32px;border-radius:50%;background:var(--teal);color:white;display:inline-flex;align-items:center;justify-content:center;font-weight:600;">' + esc((supervisor.nickname || '?').charAt(0)) + '</span><div style="flex:1;min-width:0;"><div class="label">หัวหน้า</div><div class="value">' + esc(supervisor.nickname) + ' · ' + esc(supervisor.position_id || '') + '</div></div></div>' : ''),
    (subordinates.length ? '          <div class="org-card"><span style="width:32px;height:32px;border-radius:50%;background:var(--info);color:white;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:13px;">' + subordinates.length + '</span><div style="flex:1;min-width:0;"><div class="label">ลูกน้อง</div><div class="value">' + subordinates.map(function (s) { return esc(s.nickname); }).slice(0, 3).join(', ') + (subordinates.length > 3 ? ' +' + (subordinates.length - 3) : '') + '</div></div></div>' : ''),
    (department ? '          <div class="org-card"><span style="width:32px;height:32px;border-radius:50%;background:var(--navy);color:white;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:11px;">D</span><div style="flex:1;min-width:0;"><div class="label">แผนก</div><div class="value">' + esc(department.department_name || department.department_id) + '</div></div></div>' : ''),
    (!supervisor && !subordinates.length && !department ? '          <div class="empty">ยังไม่มีข้อมูลสายงาน</div>' : ''),
    '        </div>',
    '      </div>',
    '    </div>',
    '  </section>',

    // KPI
    '  <section class="e360-pane" data-pane="kpi"><div class="card"><div class="card-header"><div class="card-title">KPI Performance</div></div>' + emptyV2('ยังไม่มีคะแนน KPI บน dashboard', 'KPI คำนวณจากระบบหลังบ้าน · ดูได้ที่ KPI Manager', ICON_CHART) + '</div></section>',

    // TIME + LEAVE
    '  <section class="e360-pane" data-pane="time"><div class="card"><div class="card-header"><div class="card-title">Attendance &amp; OT</div></div>' + emptyV2('ยังไม่มีข้อมูลลงเวลา', 'ข้อมูล clock in/out + OT ดึงจากระบบหลังบ้าน ยังไม่พร้อมบน dashboard', ICON_CAL) + '</div></section>',

    // ENGAGEMENT
    '  <section class="e360-pane" data-pane="engage"><div class="card"><div class="card-header"><div class="card-title">ประกาศ &amp; การมีส่วนร่วม</div></div>' + emptyV2('ยังไม่มีข้อมูลการมีส่วนร่วม', 'อัตราอ่านประกาศ / ack / quiz ดึงจากระบบหลังบ้าน ยังไม่พร้อมบน dashboard', ICON_BOOK) + '</div></section>',

    // COMP (PII sensitive — port หน้าจอ · ไม่มี backend)
    '  <section class="e360-pane" data-pane="comp">',
    '    <div class="sens-note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg><span>ข้อมูลค่าตอบแทน/ประกันสังคมเป็นความลับ (PII) — บน dashboard นี้ยังไม่ดึงข้อมูลมาแสดง</span></div>',
    '    <div class="card"><div class="card-header"><div class="card-title">Compensation</div><span class="card-meta">Sensitive</span></div><div class="locked-notice">ข้อมูลเงินเดือน / ปกส. ยังไม่พร้อมบน dashboard (read-only)</div></div>',
    '  </section>',

    // DOCS (PII)
    '  <section class="e360-pane" data-pane="docs">',
    '    <div class="sens-note" style="background:#FEF3C7;color:#78350F;border-left-color:var(--warning);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg><span>เอกสารพนักงานเป็นข้อมูลส่วนบุคคล (PDPA) · บน dashboard นี้ยังไม่เปิดให้ดาวน์โหลด/อัพโหลด</span></div>',
    '    <div class="card"><div class="empty">ยังไม่มีเอกสารบน dashboard (read-only)</div></div>',
    '  </section>',

    // PEOPLE
    '  <section class="e360-pane" data-pane="people"><div class="card"><div class="card-header"><div class="card-title">1:1 · พัฒนา · วินัย</div></div>' + emptyV2('ยังไม่มีบันทึก 1:1 / training / วินัย', 'รายการเหล่านี้ดึงจากระบบหลังบ้าน ยังไม่พร้อมบน dashboard', ICON_DOC) + '</div></section>',

    // PROFILE + HR
    '  <section class="e360-pane" data-pane="profile">',
    '    <div class="grid-2e">',
    '      <div class="card"><div class="card-header"><div class="card-title">Profile</div></div>',
    '        <form id="profileForm" onsubmit="event.preventDefault(); window.e3SaveProfile(this)">',
    '          <div class="form-group"><label for="e3_email">Email</label><input type="email" id="e3_email" value="' + esc(emp.email || '') + '" placeholder="email@altmedical.info"></div>',
    '          <div class="form-group"><label for="e3_phone">Phone</label><input type="text" id="e3_phone" value="' + esc(emp.phone || '') + '" placeholder="08X-XXX-XXXX"></div>',
    '          <div class="form-group"><label for="e3_tags">Tags <span style="color:var(--text-3);font-weight:400">(comma-separated)</span></label><input type="text" id="e3_tags" value="' + esc(emp.tags || '') + '" placeholder="fulltime,clinical"></div>',
    '          <div class="form-group"><label for="e3_status">Status</label><select id="e3_status">' +
    ['active', 'probation', 'resigned', 'terminated'].map(function (s) { return '<option value="' + s + '"' + (emp.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>',
    '          <button type="submit" class="btn btn-primary">บันทึก Profile</button>',
    '        </form>',
    '      </div>',
    '      <div class="card"><div class="card-header"><div class="card-title">เรื่องส่วนตัว / ความชอบ</div><span class="card-meta">personal touch</span></div>',
    '        <form id="prefForm" onsubmit="event.preventDefault(); window.e3SavePreferences(this)">',
    '          <div class="form-group"><label for="e3_favColor">สีที่ชอบ</label>',
    '            <div id="e3_favColorSwatches" style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:8px;">' +
    ['#0D2F4F', '#3DC5B7', '#F4A6B8', '#9B7EDE', '#F0B452', '#5BA8E0', '#7ECB8F', '#E08A6A'].map(function (c) { return '<span class="pref-sw" data-color="' + c + '" style="background:' + c + '"></span>'; }).join('') + '</div>',
    '            <input type="text" id="e3_favColor" value="' + esc(emp.favorite_color || '') + '" placeholder="เช่น เขียวมิ้นต์ หรือ #3DC5B7"></div>',
    '          <div class="form-group"><label for="e3_cakeType">เค้กวันเกิด</label><input type="text" id="e3_cakeType" value="' + esc(emp.cake_type || '') + '" placeholder="เช่น ช็อกโกแลต, ชาเขียว"></div>',
    '          <div class="form-group"><label for="e3_foodLike">ของกินที่ชอบ</label><input type="text" id="e3_foodLike" value="' + esc(emp.food_like || '') + '" placeholder="เช่น ส้มตำ, ชานมไข่มุก"></div>',
    '          <div class="form-group"><label for="e3_foodAllergy" style="color:var(--warning);font-weight:600;">อาหารที่แพ้ <span style="font-weight:400;">(สำคัญ — ใช้แจ้งเตือนตอนจัดเลี้ยง/อบรม)</span></label><input type="text" id="e3_foodAllergy" value="' + esc(emp.food_allergy || '') + '" placeholder="เช่น กุ้ง, ถั่ว — เว้นว่างถ้าไม่มี" style="border-color:#F4D9B0;background:#FFFBF5;"></div>',
    '          <div class="form-group"><label for="e3_favThings">งานอดิเรก / ความสนใจ</label><textarea id="e3_favThings" placeholder="เช่น วิ่ง, อ่านหนังสือ, ดูซีรีส์" style="min-height:60px;">' + esc(emp.favorite_things || '') + '</textarea></div>',
    '          <button type="submit" class="btn btn-primary">บันทึกความชอบ</button>',
    '        </form>',
    '      </div>',
    '    </div>',
    '    <div class="card"><div class="card-header"><div class="card-title">Quick Actions</div></div><div class="quick-actions">',
    '      <button class="btn btn-secondary" onclick="window.e3OpenSheet(this)" aria-label="เปิดข้อมูลใน Google Sheet"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>เปิดใน Sheet</button>',
    '      <button class="btn btn-secondary" onclick="window.e3GenerateBadge(this)" aria-label="ส่ง Digital Badge ไปทาง LINE"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>ส่ง Digital Badge</button>',
    '      <button class="btn btn-secondary" onclick="window.e3DownloadPayslip(this)" aria-label="เปิด Payslip ล่าสุด"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Payslip ล่าสุด</button>',
    '    </div></div>',
    '  </section>',

    // CONTRACT (lazy)
    '  <section class="e360-pane" data-pane="contract"><div id="contractPaneBody"><div class="card"><div style="padding:18px;color:var(--text-2);font-size:13px;">กำลังโหลดสัญญา…</div></div></div></section>',

    '</div>',
  ].join('\n');

  E3_RUN_PAGE_JS(emp);
}

/* ============================================================
   E3_RUN_PAGE_JS — JS หน้าโปรไฟล์ (tab switching + swatch + write-stubs)
   google.script.run = shim → E3_BACKEND · fn ที่ inline onclick ต้องใช้ → window prefix e3
   ============================================================ */
function E3_RUN_PAGE_JS(emp) {
  var empId = emp.employee_id;

  // ---- google.script.run shim → E3_BACKEND ----
  function _e3MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () { }, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (E3_BACKEND[prop]) {
            Promise.resolve().then(function () { return E3_BACKEND[prop].apply(E3_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[E3_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[E3_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _e3MakeChain(); } });

  // ---- helpers (inline · prefix e3 กันชน) ----
  function showToast(msg, type) {
    var t = document.getElementById('e3-toast');
    if (!t) { t = document.createElement('div'); t.id = 'e3-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.e3Toast = showToast;

  var root = document.getElementById('e3');
  function $id(id) { return root ? root.querySelector('#' + id) : document.getElementById(id); }

  function showAlert(msg, type) {
    var box = $id('alertBox');
    if (!box) return;
    box.innerHTML = '<div class="alert alert-' + type + '">' + (window.esc ? window.esc(msg) : msg) + '</div>';
    setTimeout(function () { if (box) box.innerHTML = ''; }, 4000);
  }
  function lockBtn(btn) { if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'กำลังบันทึก...'; } }
  function unlockBtn(btn) { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; } }

  // ===== write handlers (stub via shim → toast "ยังไม่พร้อมบน dashboard") =====
  window.e3SaveProfile = function (form) {
    var btn = form.querySelector('button[type=submit]');
    var updates = { email: $id('e3_email').value, phone: $id('e3_phone').value, tags: $id('e3_tags').value, status: $id('e3_status').value };
    lockBtn(btn);
    google.script.run
      .withSuccessHandler(function (r) { unlockBtn(btn); if (r && r.error) { showAlert(r.error, 'error'); } else { showAlert('บันทึก Profile สำเร็จ', 'success'); } })
      .withFailureHandler(function (e) { unlockBtn(btn); showAlert('Error: ' + e.message, 'error'); })
      .updateEmployeeProfile(empId, updates);
  };
  window.e3SavePreferences = function (form) {
    var btn = form.querySelector('button[type=submit]');
    var prefs = { favorite_color: $id('e3_favColor').value, cake_type: $id('e3_cakeType').value, food_like: $id('e3_foodLike').value, food_allergy: $id('e3_foodAllergy').value, favorite_things: $id('e3_favThings').value };
    lockBtn(btn);
    google.script.run
      .withSuccessHandler(function (r) { unlockBtn(btn); if (r && r.error) { showAlert(r.error, 'error'); } else { showAlert('บันทึกความชอบสำเร็จ', 'success'); } })
      .withFailureHandler(function (e) { unlockBtn(btn); showAlert('Error: ' + e.message, 'error'); })
      .updateEmployeePreferences(empId, prefs);
  };
  window.e3OpenSheet = function (btn) {
    lockBtn(btn);
    google.script.run
      .withSuccessHandler(function (url) { unlockBtn(btn); if (url) window.open(url, '_blank'); })
      .withFailureHandler(function (e) { unlockBtn(btn); showAlert('Error: ' + e.message, 'error'); })
      .getEmployeeSheetUrl(empId);
  };
  window.e3GenerateBadge = function (btn) {
    if (!confirm('ส่ง Digital Badge ไปทาง LINE?')) return;
    lockBtn(btn);
    google.script.run
      .withSuccessHandler(function (r) { unlockBtn(btn); if (r && r.error) { showAlert(r.error, 'error'); } else { showAlert('ส่ง Badge สำเร็จ', 'success'); } })
      .withFailureHandler(function (e) { unlockBtn(btn); showAlert('Error: ' + e.message, 'error'); })
      .sendBadgeToEmployee(empId);
  };
  window.e3DownloadPayslip = function (btn) {
    lockBtn(btn);
    google.script.run
      .withSuccessHandler(function (url) { unlockBtn(btn); url ? window.open(url, '_blank') : showAlert('ยังไม่มี payslip', 'error'); })
      .withFailureHandler(function (e) { unlockBtn(btn); showAlert('Error: ' + e.message, 'error'); })
      .getLatestPayslipUrl(empId);
  };

  // ===== swatch picker (ลอกจากเดิม · prefix e3_) =====
  (function initSwatches() {
    var wrap = $id('e3_favColorSwatches');
    var input = $id('e3_favColor');
    if (!wrap || !input) return;
    var swatches = wrap.querySelectorAll('.pref-sw');
    function syncSelected() {
      var v = (input.value || '').trim().toLowerCase();
      swatches.forEach(function (s) { s.classList.toggle('sel', (s.dataset.color || '').toLowerCase() === v); });
    }
    swatches.forEach(function (s) { s.addEventListener('click', function () { input.value = s.dataset.color; syncSelected(); }); });
    input.addEventListener('input', syncSelected);
    syncSelected();
  })();

  // ===== Contract pane (lazy · ลอก render เดิม) =====
  var _contractLoaded = false;
  function loadContractPane() {
    if (_contractLoaded) return; _contractLoaded = true;
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    function render(res) {
      var el = $id('contractPaneBody');
      if (!el) return;
      if (!res || res.ok === false) { el.innerHTML = '<div class="card"><div style="padding:18px;color:var(--text-2);font-size:13px;">' + esc((res && res.error) || 'โหลดข้อมูลสัญญาไม่ได้') + '</div></div>'; return; }
      var contracts = res.contracts || [];
      if (!contracts.length) {
        el.innerHTML = '<div class="card"><div style="padding:18px;color:var(--text-2);font-size:13px;">ยังไม่มีสัญญาในระบบสำหรับพนักงานคนนี้ (ข้อมูลสัญญาดึงจากระบบหลังบ้าน ยังไม่พร้อมบน dashboard)</div></div>';
        return;
      }
      // (มี contracts จริงเมื่อ backend พร้อม — ตอนนี้คืน [] เสมอ)
      el.innerHTML = '<div class="card"><div style="padding:18px;color:var(--text-2);font-size:13px;">มีสัญญา ' + contracts.length + ' ฉบับ</div></div>';
    }
    google.script.run
      .withSuccessHandler(render)
      .withFailureHandler(function (e) { render({ ok: false, error: (e && e.message) || String(e) }); })
      .contractAdminFor360(empId);
  }

  // ===== Tab switching =====
  (function () {
    var inited = {};
    function initPane(p) {
      if (inited[p]) return; inited[p] = true;
      try { if (p === 'contract') loadContractPane(); } catch (e) { console.warn('initPane ' + p + ': ' + e.message); }
    }
    var nav = $id('e360Tabs');
    if (!nav) return;
    nav.addEventListener('click', function (e) {
      var t = e.target.closest('.nav-tab'); if (!t) return;
      var pane = t.getAttribute('data-pane');
      var tabs = nav.querySelectorAll('.nav-tab');
      for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
      var panes = root.querySelectorAll('.e360-pane');
      for (var j = 0; j < panes.length; j++) panes[j].classList.remove('active');
      t.classList.add('active');
      var el = root.querySelector('.e360-pane[data-pane="' + pane + '"]');
      if (el) { el.classList.add('active'); initPane(pane); }
    });
  })();
}
