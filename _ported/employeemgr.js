// _ported/employeemgr.js — FULL native port of desktop employee_manager.html (HR Employee admin)
// ลอกทั้งดุ้น: 4 view (รายชื่อ/ตามสาขา/ตามตำแหน่ง/ผังองค์กร) + Detail/Edit modal (= 360 รายคน)
//   CSS เดิม (_shared_styles tokens + <style> หน้า manager) prefix #em ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ mountEmployeemgr() · google.script.run = shim → EM_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
// fn/var ที่ต้อง expose ให้ inline onclick = ผูกกับ window ภายใน EM2_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=employee.updated): list พนักงาน → map → shape ที่ JS เดิมคาด
//   feature ที่ทำ backend จริงไม่ได้ (เขียนกลับ Sheet: add/update/assignment) → stub แจ้ง "ยังไม่พร้อม"

/* ============================================================
   EM_BACKEND — map google.script.run → Supabase edge fn hr_list (type=employee.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     empAdminList → { employees:[...], lookups:{branches,positions,departments,supervisors}, stats, branchStats }
     empAdminGetDetail → flat employee detail + assignments[]
   ============================================================ */
var EM_FN = 'hr_list';
var EM_TYPE = 'employee.updated';

function em2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(function (s) { return typeof s === 'string' ? s.trim() : s; }).filter(function (s) { return s !== '' && s != null; });
  return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
function em2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function em2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// management positions / role heuristic
var EM2_MGMT_RE = /(manager|head|lead|director|chief|supervisor|regional|หัวหน้า|ผู้จัดการ|ผู้อำนวยการ)/i;

// map payload event ดิบ → employee row shape ที่ JS เดิมใช้ (~30 fields)
function em2MapEmp(p) {
  p = p || {};
  var first = p.first_name || '';
  var last = p.last_name || '';
  // ถ้ามาเป็น full_name อย่างเดียว → แตกเป็น first/last แบบหยาบ
  if (!first && p.full_name) {
    var parts = String(p.full_name).trim().split(/\s+/);
    first = parts.shift() || '';
    last = parts.join(' ');
  }
  var position_id = p.position_id || '';
  var position_name = p.position_name || p.position || '';
  var department_id = p.department_id || '';
  var department_name = p.department_name || p.department_th || p.department || '';
  var branch_role = p.branch_role || p.role || 'staff';
  var assignments = em2MapAssignments(p);
  var isMulti = (p.is_multi_branch != null) ? em2Bool(p.is_multi_branch)
    : (assignments.filter(function (a) { return a.is_active !== false; }).length > 1);
  var isMgmt = (p.is_management != null) ? em2Bool(p.is_management)
    : EM2_MGMT_RE.test(position_name + ' ' + branch_role);
  return {
    employee_id: p.employee_id || p.entity_id || '',
    first_name: first,
    last_name: last,
    nickname: p.nickname || '',
    full_name: p.full_name || (first + ' ' + last).trim(),
    position_id: position_id,
    position_name: position_name,
    department_id: department_id,
    department_name: department_name,
    primary_branch_id: p.primary_branch_id || '',
    primary_branch_name: p.primary_branch_name || p.branch_name || '',
    branch_role: branch_role,
    supervisor_id: p.supervisor_id || '',
    supervisor_name: p.supervisor_name || '',
    email: p.email || '',
    phone: p.phone || '',
    line_user_id: p.line_user_id || '',
    start_date: em2Date(p.start_date),
    end_date: em2Date(p.end_date),
    status: String(p.status || 'active').toLowerCase(),
    tags: Array.isArray(p.tags) ? p.tags.join(',') : (p.tags || ''),
    birth_date: em2Date(p.birth_date),
    cake_type: p.cake_type || '',
    delegate_to: p.delegate_to || '',
    delegate_until: em2Date(p.delegate_until),
    hr_notes: p.hr_notes || '',
    is_multi_branch: isMulti,
    is_management: isMgmt,
    hang_tags: em2ToArr(p.hang_tags),
    assignments: assignments,
    _raw: p,
  };
}

// แปลง assignments (01a) ถ้ามี · ไม่มี → fallback สาขาหลัก 100% (ทำใน empAssignmentsOf อยู่แล้ว แต่กันไว้)
function em2MapAssignments(p) {
  var arr = p.assignments || p.branch_assignments;
  if (!Array.isArray(arr)) return [];
  return arr.map(function (a) {
    a = a || {};
    return {
      assignment_id: a.assignment_id || a.id || '',
      branch_id: a.branch_id || '',
      branch_name: a.branch_name || a.branch_id || '',
      allocation_pct: (a.allocation_pct != null) ? parseInt(a.allocation_pct, 10) || 0 : 0,
      role: a.role || 'staff',
      is_primary: em2Bool(a.is_primary),
      is_active: (a.is_active != null) ? em2Bool(a.is_active) : true,
      start_date: em2Date(a.start_date),
      end_date: em2Date(a.end_date),
    };
  });
}

// cache payload ดิบล่าสุดต่อ employee (getDetail reuse จาก list · backend ไม่มี endpoint แยก)
var _em2Emps = [];
var _em2ById = {};

function em2FetchEmployees() {
  return sb.functions.invoke(EM_FN + '?type=' + encodeURIComponent(EM_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = em2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.employee_id || p.entity_id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      var row = em2MapEmp(p);
      _em2ById[id] = row;
      rows.push(row);
    });
    _em2Emps = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[EM_BACKEND] list fetch failed', e);
    _em2Emps = []; return [];
  });
}

// สร้าง lookups (branches/positions/departments/supervisors) จากชุดพนักงานที่ดึงมา
function em2BuildLookups(rows) {
  var brMap = {}, posMap = {}, depMap = {}, supMap = {};
  rows.forEach(function (e) {
    if (e.primary_branch_id) brMap[e.primary_branch_id] = e.primary_branch_name || e.primary_branch_id;
    (e.assignments || []).forEach(function (a) { if (a.branch_id) brMap[a.branch_id] = a.branch_name || a.branch_id; });
    if (e.position_id) posMap[e.position_id] = { name: e.position_name || e.position_id, department_id: e.department_id || '', level: e.is_management ? 'mgmt' : 'staff' };
    if (e.department_id) depMap[e.department_id] = e.department_name || e.department_id;
    // supervisors = ทุกคน (เลือกหัวหน้าได้ทุกคน)
    supMap[e.employee_id] = e.nickname || e.full_name || e.employee_id;
  });
  return {
    branches: Object.keys(brMap).sort().map(function (id) { return { id: id, name: brMap[id] }; }),
    positions: Object.keys(posMap).sort().map(function (id) { return { id: id, name: posMap[id].name, department_id: posMap[id].department_id, level: posMap[id].level }; }),
    departments: Object.keys(depMap).sort().map(function (id) { return { id: id, name: depMap[id] }; }),
    supervisors: Object.keys(supMap).sort().map(function (id) { return { id: id, name: supMap[id] }; }),
  };
}

function em2BuildStats(rows) {
  return {
    total: rows.length,
    active: rows.filter(function (e) { return e.status === 'active'; }).length,
    probation: rows.filter(function (e) { return e.status === 'probation'; }).length,
    management: rows.filter(function (e) { return e.is_management; }).length,
    multi_branch: rows.filter(function (e) { return e.is_multi_branch; }).length,
  };
}

var _em2NotReadyShown = {};
function em2NotReady(feature) {
  if (_em2NotReadyShown[feature]) return;
  _em2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.em2Toast) window.em2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

var EM_BACKEND = {
  // role gate — user dashboard = admin/owner เต็มสิทธิ์
  empAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },
  // list — { employees, lookups, stats, branchStats }
  empAdminList: function () {
    return em2FetchEmployees().then(function (rows) {
      return {
        employees: rows,
        lookups: em2BuildLookups(rows),
        stats: em2BuildStats(rows),
        branchStats: {},   // backend ไม่มี turnover 12m → ว่าง (branch card ไม่โชว์ turnover)
      };
    });
  },
  // detail 360 — หา employee จาก cache ตาม employee_id (flat + assignments)
  empAdminGetDetail: function (empId) {
    var find = function () {
      var e = _em2ById[empId];
      if (!e) return { error: 'ไม่พบพนักงาน ' + empId };
      // shape ที่ openEdit() คาด: flat fields + assignments[]
      return {
        employee_id: e.employee_id,
        first_name: e.first_name, last_name: e.last_name, nickname: e.nickname,
        position_id: e.position_id, position_name: e.position_name,
        department_id: e.department_id, department_name: e.department_name,
        primary_branch_id: e.primary_branch_id, primary_branch_name: e.primary_branch_name,
        branch_role: e.branch_role, supervisor_id: e.supervisor_id,
        email: e.email, phone: e.phone, line_user_id: e.line_user_id,
        start_date: e.start_date, end_date: e.end_date, status: e.status,
        tags: e.tags, birth_date: e.birth_date, cake_type: e.cake_type,
        delegate_to: e.delegate_to, delegate_until: e.delegate_until, hr_notes: e.hr_notes,
        assignments: e.assignments || [],
      };
    };
    if (_em2Emps.length) return Promise.resolve(find());
    return em2FetchEmployees().then(find);
  },
  // add — stub (เขียน Sheet ไม่ได้บน dashboard)
  empAdminAdd: function () {
    em2NotReady('เพิ่มพนักงาน');
    return Promise.resolve({ error: 'การเพิ่มพนักงานยังไม่พร้อมบน dashboard (เขียนกลับ Google Sheet)' });
  },
  // update — stub
  empAdminUpdate: function () {
    em2NotReady('แก้ไข/บันทึกพนักงาน');
    return Promise.resolve({ error: 'การบันทึกแก้ไขยังไม่พร้อมบน dashboard (เขียนกลับ Google Sheet)' });
  },
  // add multi-branch assignment — stub
  empAdminAddAssignment: function () {
    em2NotReady('เพิ่ม assignment สาขา');
    return Promise.resolve({ error: 'การจัดการ multi-branch ยังไม่พร้อมบน dashboard' });
  },
  // end assignment — stub
  empAdminEndAssignment: function () {
    em2NotReady('ปิด assignment สาขา');
    return Promise.resolve({ error: 'การจัดการ multi-branch ยังไม่พร้อมบน dashboard' });
  },
};

/* ============================================================
   mountEmployeemgr — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountEmployeemgr() {
  var wrap = document.getElementById('wrap-employeemgr');
  if (!wrap) return;
  wrap.innerHTML = '<style>' + EM2_CSS() + '</style><div id="em">' + EM2_MARKUP() + '</div>';
  EM2_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles tokens + <style> หน้า manager) · prefix ทุก selector ด้วย #em
   ตัด .app-shell/.main-area/.topbar shell (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด ===== */
function EM2_CSS() {
  return [
    // tokens
    '#em{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;--c-public:#047857;--c-public-bg:#ECFDF5;--c-company:#6D28D9;--c-company-bg:#F5F3FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#em *{box-sizing:border-box}',

    // ===== shared buttons / field / pills / modal / empty / loading =====
    '#em .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#em .btn:hover{border-color:var(--navy)}',
    '#em .btn svg{width:14px;height:14px}',
    '#em .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#em .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#em .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#em .btn-sm{padding:5px 10px;font-size:12px}',
    '#em .btn-icon{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;color:#475569}',
    '#em .btn-icon-danger{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}',
    '#em .btn-icon-danger:hover{border-color:var(--danger)}',
    '#em .btn-help{width:34px;height:34px;border-radius:8px;background:#fff;border:1px solid var(--border);color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
    '#em .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#em .btn-help svg{width:15px;height:15px}',
    '#em .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}',
    '#em .field label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#em .field input[type=text],#em .field input[type=date],#em .field input[type=email],#em .field input[type=search],#em .field input[type=number],#em .field select,#em .field textarea{padding:9px 12px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);transition:border .15s;width:100%}',
    '#em .field textarea{min-height:64px;resize:vertical}',
    '#em .field input:focus,#em .field select:focus,#em .field textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',
    '#em .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '#em .pill{padding:2px 9px;border-radius:12px;font-size:10px;font-weight:600;display:inline-block}',
    '#em .pill-info{background:var(--info-bg);color:var(--info)}',
    '#em .mono{font-family:monospace}',
    // modal
    '#em .modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;z-index:9000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}',
    '#em .modal-bg.active{display:flex}',
    '#em .modal{background:var(--surface);border-radius:12px;padding:0;max-width:540px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);display:flex;flex-direction:column}',
    '#em .modal.large{max-width:760px}',
    '#em .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}',
    '#em .modal-header h2{font-size:16px;font-weight:600;color:var(--text);letter-spacing:-.01em}',
    '#em .modal-header p{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#em .modal-body{padding:20px 24px;flex:1;overflow-y:auto}',
    '#em .modal-footer{padding:14px 24px;border-top:1px solid var(--border);background:#F8FAFC;display:flex;gap:8px;justify-content:flex-end}',
    '#em .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px dashed var(--border);border-radius:10px}',
    '#em .empty-icon svg{width:40px;height:40px;color:var(--text-faint);margin-bottom:10px}',
    '#em .empty-title{font-size:14px;font-weight:600;color:var(--text-muted)}',
    '#em .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
  ].join('\n') + EM2_CSS_PAGE();
}

/* ===== <style> เฉพาะหน้า manager (data-table / chips / branch cards / org tree / modal sections)
   prefix #em ทุก selector ===== */
function EM2_CSS_PAGE() {
  return '\n' + [
    // page-head
    '#em .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #E2E8F0}',
    '#em .page-head h1{font-size:20px;font-weight:600;color:#0D2F4F;letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#em .page-head h1 svg{width:18px;height:18px;color:#3DC5B7}',
    '#em .page-head .subtitle{font-size:12px;color:#64748B;margin-top:4px}',
    '#em .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}',
    // stats
    '#em .stats{display:grid;gap:12px;margin-bottom:16px}',
    '#em .stats.cols-5{grid-template-columns:repeat(5,1fr)}',
    '@media (max-width:1100px){#em .stats.cols-5{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#em .stats.cols-5{grid-template-columns:repeat(2,1fr)}}',
    '#em .stat{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;position:relative;overflow:hidden}',
    '#em .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#em .stat-label{font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#em .stat-value{font-size:26px;font-weight:700;color:var(--navy);line-height:1;margin-top:6px;letter-spacing:-.02em}',
    '#em .stat-sub{font-size:11px;color:var(--text-muted);margin-top:4px}',
    // filters
    '#em .filters{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;align-items:flex-end}',
    '#em .filter{display:flex;flex-direction:column;gap:4px}',
    '#em .filter label{font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#em .filter input[type=search],#em .filter select{height:34px;box-sizing:border-box;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:#fff}',
    '#em .filter input:focus,#em .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section + header
    '#em .section{background:#fff;border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px}',
    '#em .section-header{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border)}',
    '#em .section-icon{width:34px;height:34px;border-radius:8px;background:#E6F7F5;color:var(--teal-dark);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}',
    '#em .section-icon svg{width:17px;height:17px}',
    '#em .section-title{font-size:14px;font-weight:600;color:var(--navy)}',
    '#em .section-sub{font-size:11px;color:var(--text-muted);margin-top:2px}',
    // data-table
    '#em .data-table{width:100%;border-collapse:collapse;font-size:13px}',
    '#em .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#em .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}',
    '#em .data-table tbody tr{border-left:3px solid transparent;transition:background .15s;cursor:pointer}',
    '#em .data-table tbody tr:hover{background:#FAFBFC}',
    '#em .data-table tbody tr.is-management{border-left-color:var(--c-company)}',
    '#em .emp-name{font-weight:500;color:var(--text)}',
    '#em .emp-id{font-size:10px;color:var(--text-faint);font-family:monospace;margin-top:1px}',
    '#em .emp-avatar{width:32px;height:32px;border-radius:50%;color:#fff;background:var(--av,#0D2F4F);display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;flex-shrink:0}',
    '#em .emp-cell{display:flex;align-items:center;gap:10px}',
    '#em .pos-cell,#em .br-cell{font-size:12px}',
    '#em .pos-cell .id,#em .br-cell .id{color:var(--text-faint);font-family:monospace;font-size:11px}',
    '#em .multi-badge{display:inline-block;padding:1px 7px;background:var(--c-public-bg);color:var(--c-public);border-radius:10px;font-size:10px;font-weight:600;margin-left:4px}',
    '#em .hang-badge{display:inline-block;padding:1px 7px;background:#E6F7F5;color:#0F766E;border-radius:10px;font-size:10px;font-weight:600;margin-left:4px}',
    '#em .status-active{background:var(--success-bg);color:var(--success)}',
    '#em .status-probation{background:var(--warning-bg);color:var(--warning)}',
    '#em .status-resigned{background:var(--danger-bg);color:var(--danger)}',
    '#em .status-inactive{background:#F1F5F9;color:var(--text-muted)}',
    // branch chips
    '#em .br-chips{display:flex;flex-wrap:wrap;gap:5px;align-items:center}',
    '#em .br-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:500;background:#F8FAFC;border:1px solid var(--border);color:var(--text-muted)}',
    '#em .br-chip.primary{background:rgba(61,197,183,.14);border-color:rgba(61,197,183,.4);color:var(--teal-dark);font-weight:600}',
    '#em .br-chip .bdot{width:7px;height:7px;border-radius:50%;flex-shrink:0}',
    '#em .br-chip .pct{font-family:monospace;font-size:10px;opacity:.75}',
    // view toggle
    '#em .view-toggle{display:inline-flex;background:#fff;border:1px solid var(--border-strong);border-radius:9px;padding:3px;gap:2px;flex-shrink:0}',
    '#em .view-toggle button{border:none;background:transparent;padding:7px 12px;border-radius:7px;font-size:12px;font-weight:600;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-family:inherit}',
    '#em .view-toggle button svg{width:14px;height:14px}',
    '#em .view-toggle button.on{background:var(--teal);color:#fff}',
    // branch / position grid + cards
    '#em .branch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}',
    '#em .branch-card{border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#fff}',
    '#em .bc-head{padding:13px 15px;color:#fff;display:flex;align-items:center;gap:10px}',
    '#em .bc-head svg{width:17px;height:17px;flex-shrink:0}',
    '#em .bc-head .bc-name{font-weight:600;font-size:14px}',
    '#em .bc-head .bc-code{font-size:11px;opacity:.82;font-family:monospace}',
    '#em .bc-meta{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:4px}',
    '#em .bc-count{background:rgba(255,255,255,.22);padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}',
    '#em .bc-turn{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:rgba(255,255,255,.85)}',
    '#em .bc-turn .tdot{width:7px;height:7px;border-radius:50%}',
    '#em .bc-turn .tval{font-family:monospace;font-weight:700;color:#fff}',
    '#em .bc-body{padding:7px}',
    '#em .bc-mini{display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:8px;cursor:pointer}',
    '#em .bc-mini:hover{background:rgba(61,197,183,.10)}',
    '#em .bc-mini .emp-avatar{width:32px;height:32px;font-size:12px}',
    '#em .bc-mini .m-nm{font-weight:500;font-size:13px;color:var(--text)}',
    '#em .bc-mini .m-ro{font-size:11px;color:var(--text-faint)}',
    '#em .bc-mini .m-pct{margin-left:auto;font-family:monospace;font-size:11px;font-weight:600;color:var(--navy);background:rgba(61,197,183,.14);padding:2px 8px;border-radius:14px}',
    '#em .bc-mini .float-tag{margin-left:6px;font-size:9px;font-weight:700;text-transform:uppercase;background:var(--info-bg);color:var(--info);padding:1px 6px;border-radius:5px}',
    '#em .bc-empty{padding:13px;text-align:center;color:var(--text-faint);font-size:12px}',
    // mobile cards
    '#em .emp-cards{display:none;flex-direction:column;gap:10px}',
    '#em .emp-card{border:1px solid var(--border);border-radius:12px;padding:13px 14px;background:#fff;border-left:3px solid transparent;cursor:pointer}',
    '#em .emp-card.is-management{border-left-color:var(--c-company)}',
    '#em .emp-card .ec-top{display:flex;align-items:center;gap:11px;margin-bottom:9px}',
    '#em .emp-card .ec-top .ec-meta{flex:1;min-width:0}',
    '#em .emp-card .ec-row{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0}',
    '#em .emp-card .ec-row .k{color:var(--text-faint)}',
    '@media (max-width:820px){#em .data-table{display:none}#em .emp-cards{display:flex}#em .branch-grid{grid-template-columns:1fr}}',
    // org chart
    '#em .org-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 16px 0}',
    '#em .org-mode-title{font-size:13px;font-weight:600;color:var(--navy)}',
    '#em .org-mode-title .hint{font-weight:400;color:var(--text-faint);font-size:12px;margin-left:6px}',
    '#em .org-sub-toggle{display:inline-flex;background:#F1F5F9;border-radius:9px;padding:3px;gap:2px}',
    '#em .org-sub-toggle button{border:none;background:transparent;padding:7px 13px;border-radius:7px;font-size:12px;font-weight:600;color:var(--text-muted);cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px}',
    '#em .org-sub-toggle button svg{width:13px;height:13px}',
    '#em .org-sub-toggle button.on{background:#fff;color:var(--navy);box-shadow:0 1px 2px rgba(0,0,0,.08)}',
    '#em .org-scroll{overflow-x:auto;padding:12px 16px 22px}',
    '#em .org-tree,#em .org-tree ul{display:flex;list-style:none;margin:0;padding:0}',
    '#em .org-tree{justify-content:center;min-width:max-content}',
    '#em .org-tree ul{padding-top:26px;position:relative}',
    '#em .org-tree li{position:relative;padding:26px 12px 0;text-align:center}',
    '#em .org-tree li::before,#em .org-tree li::after{content:"";position:absolute;top:0;right:50%;width:50%;height:26px;border-top:2px solid var(--border-strong)}',
    '#em .org-tree li::after{right:auto;left:50%;border-left:2px solid var(--border-strong)}',
    '#em .org-tree li:only-child::before,#em .org-tree li:only-child::after{display:none}',
    '#em .org-tree li:first-child::before,#em .org-tree li:last-child::after{border:0}',
    '#em .org-tree li:last-child::before{border-right:2px solid var(--border-strong);border-radius:0 6px 0 0}',
    '#em .org-tree li:first-child::after{border-radius:6px 0 0 0}',
    '#em .org-tree>li{padding-top:0}',
    '#em .org-tree>li::before,#em .org-tree>li::after{display:none}',
    '#em .org-tree ul::before{content:"";position:absolute;top:0;left:50%;height:26px;border-left:2px solid var(--border-strong)}',
    '#em .org-node{display:inline-flex;flex-direction:column;align-items:center;gap:7px;background:#fff;border:1px solid var(--border);border-radius:12px;padding:13px 15px 12px;min-width:168px;cursor:pointer;position:relative;transition:border-color .15s,box-shadow .15s,transform .1s}',
    '#em .org-node:hover{border-color:rgba(61,197,183,.6);box-shadow:0 6px 18px rgba(13,47,79,.08);transform:translateY(-1px)}',
    '#em .org-node .av{width:44px;height:44px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:15px}',
    '#em .org-node .nm{font-weight:600;font-size:13.5px;color:var(--navy);line-height:1.25}',
    '#em .org-node .id{font-size:10px;color:var(--text-faint);font-family:monospace}',
    '#em .org-node .ro{font-size:11.5px;color:var(--text-muted);line-height:1.3}',
    '#em .org-node .br-chip{margin-left:0}',
    '#em .org-node .dr-count{position:absolute;top:-8px;right:-8px;background:var(--teal);color:#fff;font-size:10px;font-weight:700;min-width:20px;height:20px;padding:0 5px;border-radius:11px;display:flex;align-items:center;justify-content:center;border:2px solid #fff}',
    '#em .org-node.is-mgmt{border-color:rgba(61,197,183,.55)}',
    '#em .org-node.is-top{border:2px solid var(--navy)}',
    '#em .org-orphan-note{margin:4px 16px 0;font-size:11px;color:var(--text-faint)}',
    '@media (max-width:820px){#em .org-node{min-width:140px}}',
    // modal sections + multi-branch sub-table
    '#em .modal-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:16px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}',
    '#em .modal-section-title:first-child{margin-top:0}',
    '#em .modal-section-title svg{width:14px;height:14px;color:var(--text-faint)}',
    '#em .assignments-block{background:#F8FAFC;border-radius:8px;padding:10px;margin-bottom:14px}',
    '#em .assignments-table{width:100%;border-collapse:collapse;font-size:12px;background:#fff;border-radius:6px;overflow:hidden}',
    '#em .assignments-table th{background:#F1F5F9;padding:6px 10px;text-align:left;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#em .assignments-table td{padding:8px 10px;border-top:1px solid #F1F5F9;font-size:12px}',
    '#em .assignments-table tr.inactive{opacity:.5}',
    '#em .pct-badge{padding:1px 7px;border-radius:10px;background:var(--info-bg);color:var(--info);font-size:11px;font-weight:600;font-family:monospace}',
    '#em .alloc-warning{padding:8px 10px;background:var(--warning-bg);color:var(--warning);border-radius:6px;font-size:11px;font-weight:500;margin-top:8px}',
    '#em .alloc-ok{padding:8px 10px;background:var(--success-bg);color:var(--success);border-radius:6px;font-size:11px;font-weight:500;margin-top:8px}',
    '#em .assign-add{background:#fff;border-radius:6px;padding:10px;margin-top:8px;border:1px dashed var(--border-strong);display:grid;grid-template-columns:1fr 80px 1fr auto;gap:8px;align-items:end}',
    '#em .assign-add .field{margin-bottom:0}',
    '@media (max-width:768px){#em .assign-add{grid-template-columns:1fr 1fr}}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก view/section + Detail/Edit modal · คง element id เดิม
   ตัด topbar/sidebar/sheet_link/brand_footer/app-shell · header เป็น page-head เดียว (sidebar-unification) ===== */
function EM2_MARKUP() {
  return [
    // page header (sidebar-unification block) — actions ภายในนี้ (loadList/openAdd/help เดิม)
    '<header class="page-head">',
      '<div>',
        '<h1>',
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
          'รายชื่อพนักงาน',
        '</h1>',
        '<div class="subtitle">01 + 01a · พนักงาน · multi-branch (primary + secondary)</div>',
      '</div>',
      '<div class="page-actions">',
        '<button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn"></button>',
        '<button class="btn btn-sm" onclick="loadList()" id="refresh-btn"></button>',
        '<button class="btn btn-primary" onclick="openAdd()" id="add-btn"></button>',
      '</div>',
    '</header>',

    // stats
    '<div class="stats cols-5" id="stats"></div>',

    // filters
    '<div class="filters">',
      '<div class="filter">',
        '<label>ค้นหา</label>',
        '<input type="search" id="filter-search" placeholder="ID / ชื่อ / nickname / email / ตำแหน่ง / แผนก" oninput="renderList()" style="min-width:230px">',
      '</div>',
      '<div class="filter">',
        '<label>สถานะ</label>',
        '<select id="filter-status" onchange="renderList()">',
          '<option value="">ทั้งหมด</option>',
          '<option value="active" selected>active</option>',
          '<option value="probation">probation</option>',
          '<option value="resigned">resigned</option>',
          '<option value="inactive">inactive</option>',
        '</select>',
      '</div>',
      '<div class="filter">',
        '<label>สาขา (หลัก/รอง)</label>',
        '<select id="filter-branch" onchange="renderList()"><option value="">ทุกสาขา</option></select>',
      '</div>',
      '<div class="filter">',
        '<label>แผนก</label>',
        '<select id="filter-department" onchange="renderList()"><option value="">ทุกแผนก</option></select>',
      '</div>',
      '<div class="filter">',
        '<label>ตำแหน่ง</label>',
        '<select id="filter-position" onchange="renderList()"><option value="">ทุกตำแหน่ง</option></select>',
      '</div>',
      '<div class="filter">',
        '<label>ระดับ</label>',
        '<select id="filter-level" onchange="renderList()"><option value="">ทุกระดับ</option></select>',
      '</div>',
      '<div class="filter">',
        '<label>หัวหน้า (supervisor)</label>',
        '<select id="filter-supervisor" onchange="renderList()"><option value="">ทุกหัวหน้า</option></select>',
      '</div>',
      '<div class="filter">',
        '<label>การทำงาน</label>',
        '<select id="filter-work" onchange="renderList()">',
          '<option value="">ทั้งหมด</option>',
          '<option value="multi">หลายสาขา</option>',
          '<option value="single">สาขาเดียว</option>',
          '<option value="mgmt">หัวหน้า/บริหาร</option>',
          '<option value="staff">ไม่ใช่บริหาร</option>',
        '</select>',
      '</div>',
      '<div class="filter">',
        '<label>เรียงตาม</label>',
        '<select id="filter-sort" onchange="renderList()">',
          '<option value="">— เริ่มต้น —</option>',
          '<option value="name">ชื่อเล่น (ก-ฮ)</option>',
          '<option value="id">รหัสพนักงาน</option>',
          '<option value="position">ตำแหน่ง</option>',
          '<option value="department">แผนก</option>',
          '<option value="branch">สาขาหลัก</option>',
          '<option value="start">วันเริ่มงาน (ใหม่→เก่า)</option>',
        '</select>',
      '</div>',
      '<div class="filter" style="flex-direction:row;align-items:center;gap:10px;margin-left:auto">',
        '<span id="filter-count" style="font-size:12px;font-weight:600;color:var(--text-muted);white-space:nowrap"></span>',
        '<button type="button" class="btn" id="filter-clear" onclick="clearFilters()" style="height:34px;white-space:nowrap">ล้างตัวกรอง</button>',
      '</div>',
    '</div>',

    // list section
    '<div class="section" id="list-section">',
      '<div class="section-header">',
        '<div class="section-icon" id="section-icon"></div>',
        '<div style="flex:1">',
          '<div class="section-title">รายชื่อพนักงาน</div>',
          '<div class="section-sub">กดที่แถวเพื่อดูรายละเอียด 360 (ทุกฟิลด์ + multi-branch)</div>',
        '</div>',
        '<div class="view-toggle">',
          '<button data-view="list" class="on" onclick="setView(\'list\')"></button>',
          '<button data-view="branch" onclick="setView(\'branch\')"></button>',
          '<button data-view="position" onclick="setView(\'position\')"></button>',
          '<button data-view="org" onclick="setView(\'org\')"></button>',
        '</div>',
      '</div>',
      '<div id="content" class="loading">กำลังโหลด...</div>',
    '</div>',

    // branch section
    '<div class="section" id="branch-section" style="display:none">',
      '<div class="section-header">',
        '<div class="section-icon" id="branch-section-icon"></div>',
        '<div style="flex:1">',
          '<div class="section-title">จัดกลุ่มตามสาขา</div>',
          '<div class="section-sub">เห็นว่าแต่ละสาขามีใครบ้าง — คนที่ทำหลายสาขาจะปรากฏในทุกสาขาที่ทำ</div>',
        '</div>',
        '<div class="view-toggle">',
          '<button data-view="list" onclick="setView(\'list\')"></button>',
          '<button data-view="branch" class="on" onclick="setView(\'branch\')"></button>',
          '<button data-view="position" onclick="setView(\'position\')"></button>',
          '<button data-view="org" onclick="setView(\'org\')"></button>',
        '</div>',
      '</div>',
      '<div id="branch-content" style="padding:16px"><div class="branch-grid" id="branch-grid"></div></div>',
    '</div>',

    // position section
    '<div class="section" id="position-section" style="display:none">',
      '<div class="section-header">',
        '<div class="section-icon" id="position-section-icon"></div>',
        '<div style="flex:1">',
          '<div class="section-title">จัดกลุ่มตามตำแหน่ง</div>',
          '<div class="section-sub">เห็นว่าแต่ละตำแหน่งมีใครบ้าง — แสดงสาขาหลักของแต่ละคนข้างชื่อ</div>',
        '</div>',
        '<div class="view-toggle">',
          '<button data-view="list" onclick="setView(\'list\')"></button>',
          '<button data-view="branch" onclick="setView(\'branch\')"></button>',
          '<button data-view="position" class="on" onclick="setView(\'position\')"></button>',
          '<button data-view="org" onclick="setView(\'org\')"></button>',
        '</div>',
      '</div>',
      '<div id="position-content" style="padding:16px"><div class="branch-grid" id="position-grid"></div></div>',
    '</div>',

    // org section
    '<div class="section" id="org-section" style="display:none">',
      '<div class="section-header">',
        '<div class="section-icon" id="org-section-icon"></div>',
        '<div style="flex:1">',
          '<div class="section-title">ผังองค์กร</div>',
          '<div class="section-sub">สร้างจาก supervisor_id ของพนักงาน — สลับดูได้ทั้งสายบังคับบัญชาและตามสาขา · กดที่การ์ดเพื่อดู</div>',
        '</div>',
        '<div class="view-toggle">',
          '<button data-view="list" onclick="setView(\'list\')"></button>',
          '<button data-view="branch" onclick="setView(\'branch\')"></button>',
          '<button data-view="position" onclick="setView(\'position\')"></button>',
          '<button data-view="org" class="on" onclick="setView(\'org\')"></button>',
        '</div>',
      '</div>',
      '<div class="org-bar">',
        '<div class="org-mode-title" id="org-mode-title">สายบังคับบัญชา <span class="hint">— ใครรายงานใคร (reporting line)</span></div>',
        '<div class="org-sub-toggle">',
          '<button id="org-btn-report" class="on" onclick="setOrgMode(\'report\')"></button>',
          '<button id="org-btn-branch" onclick="setOrgMode(\'branch\')"></button>',
        '</div>',
      '</div>',
      '<div id="org-orphan-note" class="org-orphan-note" style="display:none"></div>',
      '<div id="org-content"><div class="org-scroll"><ul class="org-tree" id="org-tree-root"></ul></div></div>',
    '</div>',

    EM2_MODAL(),
  ].join('');
}

/* ===== Detail/Edit Modal (= 360 รายคน) · คง element id เดิม ===== */
function EM2_MODAL() {
  return [
    '<div class="modal-bg" id="modal-bg" onclick="if(event.target===this)closeModal()">',
      '<div class="modal large">',
        '<div class="modal-header">',
          '<h2 id="modal-title">เพิ่มพนักงาน</h2>',
          '<p id="modal-sub">กรอกข้อมูลให้ครบ — multi-branch ตั้งค่าได้ใน section ล่าง</p>',
        '</div>',
        '<div class="modal-body">',
          '<input type="hidden" id="m-id-existing">',
          // Basic
          '<div class="modal-section-title" id="ss-basic"></div>',
          '<div class="field-grid">',
            '<div class="field"><label>Employee ID *</label><input type="text" id="m-emp-id" placeholder="EMP016" style="font-family:monospace;text-transform:uppercase"></div>',
            '<div class="field"><label>Status</label><select id="m-status"><option value="active">active</option><option value="probation">probation</option><option value="resigned">resigned</option><option value="inactive">inactive</option></select></div>',
          '</div>',
          '<div class="field-grid">',
            '<div class="field"><label>ชื่อ (first_name) *</label><input type="text" id="m-first-name"></div>',
            '<div class="field"><label>นามสกุล</label><input type="text" id="m-last-name"></div>',
          '</div>',
          '<div class="field-grid">',
            '<div class="field"><label>ชื่อเล่น (nickname)</label><input type="text" id="m-nickname"></div>',
            '<div class="field"><label>Tags (comma-list)</label><input type="text" id="m-tags" placeholder="lead_doctor,certified_pilates"></div>',
          '</div>',
          // Position + Branch
          '<div class="modal-section-title" id="ss-org"></div>',
          '<div class="field-grid">',
            '<div class="field"><label>ตำแหน่ง</label><select id="m-position-id" onchange="onPositionChange()"><option value="">— เลือก —</option></select></div>',
            '<div class="field"><label>แผนก</label><select id="m-department-id"><option value="">— เลือก —</option></select></div>',
          '</div>',
          '<div class="field-grid">',
            '<div class="field"><label>สาขาหลัก (primary)</label><select id="m-primary-branch"><option value="">— เลือก —</option></select></div>',
            '<div class="field"><label>บทบาทในสาขา</label><select id="m-branch-role"><option value="staff">staff</option><option value="manager">manager</option><option value="doctor">doctor</option><option value="regional">regional</option><option value="float">float</option></select></div>',
          '</div>',
          '<div class="field"><label>หัวหน้า (supervisor)</label><select id="m-supervisor-id"><option value="">— ไม่มี —</option></select></div>',
          // Multi-branch (edit mode only)
          '<div id="multi-branch-block" style="display:none">',
            '<div class="modal-section-title" id="ss-multi"></div>',
            '<div class="assignments-block">',
              '<div id="assignments-list"></div>',
              '<div class="assign-add">',
                '<div class="field"><label>เพิ่มสาขา</label><select id="ma-branch"><option value="">— สาขา —</option></select></div>',
                '<div class="field"><label>%</label><input type="number" id="ma-pct" min="0" max="100" placeholder="50"></div>',
                '<div class="field"><label>บทบาท</label><select id="ma-role"><option value="staff">staff</option><option value="manager">manager</option><option value="doctor">doctor</option><option value="float">float</option></select></div>',
                '<div><button class="btn btn-sm btn-primary" type="button" onclick="addAssignment()">เพิ่ม</button></div>',
              '</div>',
              '<div id="alloc-status"></div>',
            '</div>',
          '</div>',
          // Contact
          '<div class="modal-section-title" id="ss-contact"></div>',
          '<div class="field-grid">',
            '<div class="field"><label>Email</label><input type="email" id="m-email"></div>',
            '<div class="field"><label>โทรศัพท์</label><input type="text" id="m-phone"></div>',
          '</div>',
          '<div class="field"><label>LINE User ID</label><input type="text" id="m-line-user-id" placeholder="U... (รับจาก webhook ครั้งแรก)" style="font-family:monospace"></div>',
          // Dates + Personal
          '<div class="modal-section-title" id="ss-dates"></div>',
          '<div class="field-grid">',
            '<div class="field"><label>วันเริ่มงาน</label><input type="date" id="m-start-date"></div>',
            '<div class="field"><label>วันสุดท้าย (resign only)</label><input type="date" id="m-end-date"></div>',
          '</div>',
          '<div class="field-grid">',
            '<div class="field"><label>วันเกิด</label><input type="date" id="m-birth-date"></div>',
            '<div class="field"><label>ประเภทเค้กที่ชอบ</label><select id="m-cake-type"><option value="">— default —</option><option value="chocolate">chocolate</option><option value="vanilla">vanilla</option><option value="strawberry">strawberry</option><option value="green_tea">green tea</option></select></div>',
          '</div>',
          // Delegation
          '<div class="modal-section-title" id="ss-delegate"></div>',
          '<div class="field-grid">',
            '<div class="field"><label>มอบอำนาจให้ (delegate_to)</label><select id="m-delegate-to"><option value="">— ไม่มี —</option></select></div>',
            '<div class="field"><label>มอบจนถึงวันที่</label><input type="date" id="m-delegate-until"></div>',
          '</div>',
          // HR notes
          '<div class="field"><label>HR Notes (private)</label><textarea id="m-hr-notes" placeholder="หมายเหตุภายใน (ดูได้เฉพาะ HR Manager+)"></textarea></div>',
        '</div>',
        '<div class="modal-footer">',
          '<button class="btn" onclick="closeModal()">ปิด</button>',
          '<button class="btn btn-primary" onclick="saveEmployee()" id="save-btn"></button>',
        '</div>',
      '</div>',
    '</div>',
  ].join('');
}

/* ============================================================
   EM2_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → EM_BACKEND
   helper จาก _shared_scripts (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function EM2_RUN_PAGE_JS() {

  // ---- google.script.run shim → EM_BACKEND (async, คืน shape เดิม) ----
  function _em2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (EM_BACKEND[prop]) {
            Promise.resolve().then(function () { return EM_BACKEND[prop].apply(EM_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[EM_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[EM_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _em2MakeChain(); } });

  // ---- helpers จาก _shared_scripts (inline) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('em2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'em2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.em2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('em-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'em-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const items = (s.items || []).map(it => '<li>' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (s.type === 'warn' ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (s.type === 'warn' ? '#B45309' : '#64748B') + ';text-transform:uppercase;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'em-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'em-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ===== STATE (ลอกจากหน้าเดิม) ===== */
  let allEmployees = [];
  let allLookups = null;
  let editingId = null;
  let editingDetail = null;
  let branchStats = {};           // turnover 12m per branch (backend ว่าง)
  let currentView = 'list';       // 'list' | 'branch' | 'position' | 'org'
  let orgMode = 'report';         // org chart: 'report' (สายบังคับบัญชา) | 'branch' (ตามสาขา)

  // org-chart icon
  const ORG_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="9" y="15" width="6" height="6" rx="1"/><path d="M6 9v3a3 3 0 003 3h6a3 3 0 003-3V9"/><path d="M12 15v-3"/></svg>';

  // สีประจำสาขา (วนตามลำดับสาขา) + สี avatar (hash จาก id)
  const BR_PALETTE = ['#0D2F4F', '#3DC5B7', '#0284C7', '#7C3AED', '#D97706', '#16A34A', '#0F766E', '#DC2626'];
  function branchColor(id) {
    if (!allLookups || !allLookups.branches) return '#0D2F4F';
    const i = allLookups.branches.findIndex(b => b.id === id);
    return BR_PALETTE[(i < 0 ? 0 : i) % BR_PALETTE.length];
  }
  function avColor(s) {
    let h = 0; s = s || '';
    for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
    return BR_PALETTE[Math.abs(h) % BR_PALETTE.length];
  }
  function turnColor(t) { return t < 8 ? '#16A34A' : (t <= 12 ? '#D97706' : '#DC2626'); }
  const ROLE_LBL = { staff: 'พนักงาน', manager: 'หัวหน้า', doctor: 'แพทย์', regional: 'ดูแลหลายสาขา', float: 'ทำหลายสาขา' };
  function roleLabel(r) { return ROLE_LBL[r] || r || 'staff'; }

  // chips สาขาต่อพนักงาน — fallback เป็นสาขาหลักถ้ายังไม่มี assignment ใน 01a
  function empAssignmentsOf(e) {
    if (e.assignments && e.assignments.length) return e.assignments;
    if (e.primary_branch_id) return [{
      branch_id: e.primary_branch_id, branch_name: e.primary_branch_name || e.primary_branch_id,
      allocation_pct: 100, role: e.branch_role || 'staff', is_primary: true,
    }];
    return [];
  }
  function hangBadge(e) {
    if (!e.hang_tags || !e.hang_tags.length) return '';
    const tip = e.hang_tags.map(function (h) {
      if (typeof h === 'string') return h;
      return (h.role === 'doctor' ? 'หมอ' : 'นักกาย') + ' · ' + (h.branch_name || h.branch_id) + (h.fee ? ' · ' + h.fee : '');
    }).join(' | ');
    return ' <span class="hang-badge" title="' + escapeAttr(tip) + '">แขวนป้าย</span>';
  }
  function empChips(e) {
    const asg = empAssignmentsOf(e);
    if (!asg.length) return '<span style="color:var(--text-faint);font-size:12px">—</span>';
    return '<div class="br-chips">' + asg.map(a =>
      '<span class="br-chip ' + (a.is_primary ? 'primary' : '') + '">' +
        '<span class="bdot" style="background:' + branchColor(a.branch_id) + '"></span>' +
        escapeHtml(a.branch_name || a.branch_id) +
        (a.allocation_pct ? '<span class="pct">' + a.allocation_pct + '%</span>' : '') +
      '</span>').join('') + '</div>';
  }

  const HELP = {
    title: 'Employee Manager — จัดการพนักงาน',
    subtitle: '01_Employees + 01a_Branch_Assignments · multi-branch ready',
    intro: 'ดูข้อมูลพนักงานทั้งหมด — รองรับ 1 พนักงานทำหลายสาขา (Pattern B)',
    sections: [
      { title: 'การใช้งาน', items: [
        'ฟิลเตอร์: ค้นหา (ID/ชื่อ/email/ตำแหน่ง/แผนก) · สถานะ · สาขา (หลัก+รอง) · แผนก · ตำแหน่ง · ระดับ · หัวหน้า · การทำงาน (หลายสาขา/บริหาร) · เรียงลำดับ — มีตัวนับผลลัพธ์ + ปุ่มล้างตัวกรอง',
        '4 มุมมอง: รายชื่อ · ตามสาขา · ตามตำแหน่ง · ผังองค์กร — filter เดียวกัน sync ทุก view',
        'ผังองค์กร: สลับสายบังคับบัญชา (จาก supervisor_id) ↔ ตามสาขา · คลิกการ์ดเปิดดูรายคน (360)',
        'คลิก row → ดูรายละเอียดครบ 6 sections (basic + position + multi-branch + contact + dates + delegation)',
      ] },
      { title: 'Multi-branch sub-table', items: [
        'แต่ละพนักงานมี assignment หลายสาขาได้ (allocation_pct)',
        'รวม % ทุก assignment ควร = 100% (ระบบเตือน)',
        'is_primary = true → sync กับ Tab 01.primary_branch_id',
      ] },
      { type: 'warn', title: 'ระวัง', items: [
        'การเพิ่ม/แก้ไข/บันทึก (เขียนกลับ Google Sheet) ยังไม่พร้อมบน dashboard — กดได้แต่จะแจ้งว่ายังไม่พร้อม',
        'ดูข้อมูล (read-only) ได้เต็มทุกฟิลด์',
      ] },
    ],
  };

  /* ===== STATIC ICONS / LABELS ===== */
  document.getElementById('refresh-btn').innerHTML = ICONS.refresh;
  document.getElementById('add-btn').innerHTML = ICONS.plus + ' เพิ่มพนักงาน';
  document.getElementById('help-btn').innerHTML = ICONS.help;
  document.getElementById('section-icon').innerHTML = ICONS.users;
  document.getElementById('branch-section-icon').innerHTML = ICONS.building;
  document.getElementById('position-section-icon').innerHTML = ICONS.briefcase;
  document.getElementById('org-section-icon').innerHTML = ORG_ICON;
  document.querySelectorAll('#em .view-toggle button[data-view="list"]').forEach(b => b.innerHTML = ICONS.list + ' รายชื่อ');
  document.querySelectorAll('#em .view-toggle button[data-view="branch"]').forEach(b => b.innerHTML = ICONS.building + ' ตามสาขา');
  document.querySelectorAll('#em .view-toggle button[data-view="position"]').forEach(b => b.innerHTML = ICONS.briefcase + ' ตามตำแหน่ง');
  document.querySelectorAll('#em .view-toggle button[data-view="org"]').forEach(b => b.innerHTML = ORG_ICON + ' ผังองค์กร');
  document.getElementById('org-btn-report').innerHTML = ICONS.users + ' สายบังคับบัญชา';
  document.getElementById('org-btn-branch').innerHTML = ICONS.building + ' ตามสาขา';
  document.getElementById('ss-basic').innerHTML = ICONS.user + ' ข้อมูลพื้นฐาน';
  document.getElementById('ss-org').innerHTML = ICONS.briefcase + ' ตำแหน่ง + สาขา';
  document.getElementById('ss-multi').innerHTML = ICONS.building + ' Multi-branch (สาขาที่ทำงาน)';
  document.getElementById('ss-contact').innerHTML = ICONS.bell + ' การติดต่อ';
  document.getElementById('ss-dates').innerHTML = ICONS.cal + ' วันสำคัญ';
  document.getElementById('ss-delegate').innerHTML = ICONS.shield + ' การมอบอำนาจ';

  function loadList() {
    document.getElementById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(d => {
        allEmployees = d.employees || [];
        allLookups = d.lookups || {};
        branchStats = d.branchStats || {};
        populateDropdowns();
        renderStats(d.stats);
        renderList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .empAdminList();
  }

  function populateDropdowns() {
    const fb = document.getElementById('filter-branch');
    const fp = document.getElementById('filter-position');
    const fd = document.getElementById('filter-department');
    const fl = document.getElementById('filter-level');
    const fs = document.getElementById('filter-supervisor');
    // option label: ชื่อนำหน้า code วงเล็บ — ถ้าไม่มีชื่อหรือชื่อซ้ำ code โชว์ code อย่างเดียว
    function emOpt(id, name) {
      const code = (id == null ? '' : String(id)).trim();
      const nm = (name == null ? '' : String(name)).trim();
      const txt = (!nm || nm === code) ? code : `${nm} (${code})`;
      return `<option value="${escapeAttr(code)}">${escapeHtml(txt)}</option>`;
    }
    const EM_LV_LABEL = { mgmt: 'บริหาร', staff: 'ปฏิบัติการ' };
    fb.innerHTML = '<option value="">ทุกสาขา</option>';
    fp.innerHTML = '<option value="">ทุกตำแหน่ง</option>';
    fd.innerHTML = '<option value="">ทุกแผนก</option>';
    fl.innerHTML = '<option value="">ทุกระดับ</option>';
    fs.innerHTML = '<option value="">ทุกหัวหน้า</option>';
    (allLookups.branches || []).forEach(b => { fb.innerHTML += emOpt(b.id, b.name); });
    (allLookups.positions || []).forEach(p => { fp.innerHTML += emOpt(p.id, p.name); });
    (allLookups.departments || []).forEach(d => { fd.innerHTML += emOpt(d.id, d.name); });
    (allLookups.supervisors || []).forEach(s => { fs.innerHTML += emOpt(s.id, s.name); });
    // ระดับ (level) — distinct จาก positions lookup
    const _levels = [];
    (allLookups.positions || []).forEach(p => { if (p.level && _levels.indexOf(p.level) < 0) _levels.push(p.level); });
    _levels.sort((a, b) => String(a).localeCompare(String(b), 'th'));
    _levels.forEach(lv => { const t = EM_LV_LABEL[lv] ? `${EM_LV_LABEL[lv]} (${lv})` : lv; fl.innerHTML += `<option value="${escapeAttr(lv)}">${escapeHtml(t)}</option>`; });
    const mp = document.getElementById('m-position-id');
    const md = document.getElementById('m-department-id');
    const mb = document.getElementById('m-primary-branch');
    const ms = document.getElementById('m-supervisor-id');
    const mdel = document.getElementById('m-delegate-to');
    const mab = document.getElementById('ma-branch');
    mp.innerHTML = '<option value="">— เลือก —</option>';
    md.innerHTML = '<option value="">— เลือก —</option>';
    mb.innerHTML = '<option value="">— เลือก —</option>';
    ms.innerHTML = '<option value="">— ไม่มี —</option>';
    mdel.innerHTML = '<option value="">— ไม่มี —</option>';
    mab.innerHTML = '<option value="">— สาขา —</option>';
    (allLookups.positions || []).forEach(p => {
      const lv = EM_LV_LABEL[p.level] ? `${EM_LV_LABEL[p.level]} (${p.level})` : (p.level || '');
      const nm = (p.name == null ? '' : String(p.name)).trim();
      const base = (!nm || nm === String(p.id)) ? String(p.id) : `${nm} (${p.id})`;
      mp.innerHTML += `<option value="${escapeAttr(String(p.id))}">${escapeHtml(lv ? `${base} · ${lv}` : base)}</option>`;
    });
    (allLookups.departments || []).forEach(d => { md.innerHTML += emOpt(d.id, d.name); });
    (allLookups.branches || []).forEach(b => {
      const o = emOpt(b.id, b.name);
      mb.innerHTML += o;
      mab.innerHTML += o;
    });
    (allLookups.supervisors || []).forEach(s => {
      const o = emOpt(s.id, s.name);
      ms.innerHTML += o;
      mdel.innerHTML += o;
    });
  }

  function renderStats(s) {
    s = s || {};
    document.getElementById('stats').innerHTML = [
      statCard('รวม', s.total, 'พนักงานทั้งหมด', 'var(--navy)'),
      statCard('Active', s.active, 'ทำงานอยู่', 'var(--success)'),
      statCard('Probation', s.probation, 'อยู่ระหว่างทดลอง', 'var(--warning)'),
      statCard('Mgmt', s.management, 'ตำแหน่งหัวหน้า', 'var(--c-company)'),
      statCard('Multi-branch', s.multi_branch, 'ทำหลายสาขา', 'var(--c-public)'),
    ].join('');
  }
  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  function renderList() {
    const $v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const q = ($v('filter-search') || '').toLowerCase().trim();
    const status = $v('filter-status');
    const branch = $v('filter-branch');
    const dept = $v('filter-department');
    const pos = $v('filter-position');
    const level = $v('filter-level');
    const sup = $v('filter-supervisor');
    const work = $v('filter-work');
    const sort = $v('filter-sort');

    // position_id → level (จาก lookup) สำหรับ filter ระดับ
    const posLevel = {};
    ((allLookups && allLookups.positions) || []).forEach(p => { posLevel[p.id] = p.level; });

    let filtered = allEmployees;
    if (status) filtered = filtered.filter(e => e.status === status);
    if (branch) filtered = filtered.filter(e =>
      e.primary_branch_id === branch ||
      (e.assignments || []).some(a => a.branch_id === branch));
    if (dept) filtered = filtered.filter(e => e.department_id === dept);
    if (pos) filtered = filtered.filter(e => e.position_id === pos);
    if (level) filtered = filtered.filter(e => posLevel[e.position_id] === level);
    if (sup) filtered = filtered.filter(e => e.supervisor_id === sup);
    if (work === 'multi') filtered = filtered.filter(e => e.is_multi_branch);
    else if (work === 'single') filtered = filtered.filter(e => !e.is_multi_branch);
    else if (work === 'mgmt') filtered = filtered.filter(e => e.is_management);
    else if (work === 'staff') filtered = filtered.filter(e => !e.is_management);
    if (q) {
      filtered = filtered.filter(e =>
        e.employee_id.toLowerCase().includes(q) ||
        (e.first_name || '').toLowerCase().includes(q) ||
        (e.last_name || '').toLowerCase().includes(q) ||
        (e.nickname || '').toLowerCase().includes(q) ||
        (e.email || '').toLowerCase().includes(q) ||
        (e.position_name || '').toLowerCase().includes(q) ||
        (e.department_name || '').toLowerCase().includes(q));
    }

    // sort (copy ก่อน — ห้าม mutate allEmployees)
    if (sort) {
      filtered = filtered.slice();
      const cmp = (a, b, k) => String(a[k] == null ? '' : a[k]).localeCompare(String(b[k] == null ? '' : b[k]), 'th');
      if (sort === 'name') filtered.sort((a, b) => cmp(a, b, 'nickname') || cmp(a, b, 'first_name'));
      else if (sort === 'id') filtered.sort((a, b) => cmp(a, b, 'employee_id'));
      else if (sort === 'position') filtered.sort((a, b) => cmp(a, b, 'position_name'));
      else if (sort === 'department') filtered.sort((a, b) => cmp(a, b, 'department_name'));
      else if (sort === 'branch') filtered.sort((a, b) => cmp(a, b, 'primary_branch_id'));
      else if (sort === 'start') filtered.sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
    }

    const cntEl = document.getElementById('filter-count');
    if (cntEl) {
      const total = (allEmployees || []).length;
      cntEl.textContent = filtered.length === total ? (total + ' คน') : ('พบ ' + filtered.length + ' / ' + total + ' คน');
    }

    renderBranchView(filtered);
    renderPositionView(filtered);
    renderOrgChart(filtered);

    if (filtered.length === 0) {
      document.getElementById('content').innerHTML = '<div class="empty"><div class="empty-icon">' + ICONS.users + '</div><div class="empty-title">ไม่พบพนักงาน</div></div>';
      return;
    }

    const rows = filtered.map(e => {
      const initials = (e.nickname || e.first_name || e.employee_id).substring(0, 2).toUpperCase();
      const fullName = (e.first_name || '') + ' ' + (e.last_name || '');
      const multiBadge = e.is_multi_branch ? '<span class="multi-badge">multi</span>' : '';
      const hangB = hangBadge(e);
      return [
        '<tr class="' + (e.is_management ? 'is-management' : '') + '" onclick="openEdit(\'' + escapeAttr(e.employee_id) + '\')">',
          '<td>',
            '<div class="emp-cell">',
              '<div class="emp-avatar" style="--av:' + avColor(e.employee_id) + '">' + escapeHtml(initials) + '</div>',
              '<div>',
                '<div class="emp-name">' + escapeHtml(e.nickname || e.first_name || '—') + ' ' + multiBadge + hangB + '</div>',
                '<div class="emp-id">' + escapeHtml(e.employee_id) + ' · ' + escapeHtml(fullName.trim()) + '</div>',
              '</div>',
            '</div>',
          '</td>',
          '<td>',
            '<div class="pos-cell">' + escapeHtml(e.position_name || '—') + '</div>',
            '<div class="pos-cell"><span class="id">' + escapeHtml(e.position_id) + '</span> · ' + escapeHtml(e.department_name || '—') + '</div>',
          '</td>',
          '<td>' + empChips(e) + '</td>',
          '<td><span class="pill status-' + e.status + '">' + e.status + '</span></td>',
          '<td onclick="event.stopPropagation()">',
            '<div style="display:flex;gap:4px;justify-content:flex-end">',
              '<button class="btn btn-icon" onclick="window.openEmpAccess&&window.openEmpAccess(\'' + escapeAttr(e.employee_id) + '\')" title="ตั้งสิทธิ์เข้าระบบ"><i class="ti ti-shield-lock"></i></button>',
              '<button class="btn btn-icon" onclick="openEdit(\'' + escapeAttr(e.employee_id) + '\')" title="ดูรายละเอียด 360">' + ICONS.edit + '</button>',
            '</div>',
          '</td>',
        '</tr>',
      ].join('');
    }).join('');

    const cards = filtered.map(e => {
      const initials = (e.nickname || e.first_name || e.employee_id).substring(0, 2).toUpperCase();
      const multiBadge = e.is_multi_branch ? ' <span class="multi-badge">multi</span>' : '';
      const hangB = hangBadge(e);
      return [
        '<div class="emp-card ' + (e.is_management ? 'is-management' : '') + '" onclick="openEdit(\'' + escapeAttr(e.employee_id) + '\')">',
          '<div class="ec-top">',
            '<div class="emp-avatar" style="--av:' + avColor(e.employee_id) + '">' + escapeHtml(initials) + '</div>',
            '<div class="ec-meta">',
              '<div class="emp-name">' + escapeHtml(e.nickname || e.first_name || '—') + multiBadge + hangB + '</div>',
              '<div class="emp-id">' + escapeHtml(e.employee_id) + '</div>',
            '</div>',
            '<span class="pill status-' + e.status + '">' + e.status + '</span>',
          '</div>',
          '<div class="ec-row"><span class="k">ตำแหน่ง</span><span>' + escapeHtml(e.position_name || '—') + '</span></div>',
          '<div class="ec-row"><span class="k">สาขา</span><span>' + empChips(e) + '</span></div>',
        '</div>',
      ].join('');
    }).join('');

    document.getElementById('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th>พนักงาน</th><th>ตำแหน่ง / แผนก</th><th style="min-width:230px">สาขาที่ทำงาน</th>',
          '<th style="width:100px">สถานะ</th><th style="width:60px"></th>',
        '</tr></thead>',
        '<tbody>' + rows + '</tbody>',
      '</table>',
      '<div class="emp-cards">' + cards + '</div>',
    ].join('');
  }

  // Branch view: จัดกลุ่มพนักงานตามสาขา + turnover 12m
  function renderBranchView(list) {
    const grid = document.getElementById('branch-grid');
    if (!grid) return;
    if (!allLookups || !allLookups.branches || !allLookups.branches.length) {
      grid.innerHTML = '<div class="bc-empty">ยังไม่มีข้อมูลสาขา</div>';
      return;
    }
    grid.innerHTML = allLookups.branches.map(b => {
      const color = branchColor(b.id);
      const members = list
        .map(e => { const a = empAssignmentsOf(e).find(x => x.branch_id === b.id); return a ? { e: e, a: a } : null; })
        .filter(Boolean)
        .sort((x, y) => (x.a.is_primary ? 0 : 1) - (y.a.is_primary ? 0 : 1) || (y.a.allocation_pct || 0) - (x.a.allocation_pct || 0));
      const ts = branchStats[b.id];
      const turnHtml = (ts && typeof ts.turnover_rate === 'number')
        ? '<span class="bc-turn" title="อัตราลาออก 12 เดือนย้อนหลัง">ลาออก 12ด. <span class="tdot" style="background:' + turnColor(ts.turnover_rate) + '"></span><span class="tval">' + ts.turnover_rate + '%</span></span>'
        : '';
      const body = members.length ? members.map(m => {
        const initials = (m.e.nickname || m.e.first_name || m.e.employee_id).substring(0, 2).toUpperCase();
        const floatTag = (m.a.role === 'float' || m.a.role === 'regional') ? ' <span class="float-tag">float</span>' : '';
        return [
          '<div class="bc-mini" onclick="openEdit(\'' + escapeAttr(m.e.employee_id) + '\')">',
            '<div class="emp-avatar" style="--av:' + avColor(m.e.employee_id) + '">' + escapeHtml(initials) + '</div>',
            '<div>',
              '<div class="m-nm">' + escapeHtml(m.e.nickname || m.e.first_name || '—') + floatTag + '</div>',
              '<div class="m-ro">' + escapeHtml(m.e.position_name || '—') + ' · ' + escapeHtml(roleLabel(m.a.role)) + '</div>',
            '</div>',
            '<span class="m-pct">' + (m.a.allocation_pct || 0) + '%</span>',
          '</div>',
        ].join('');
      }).join('') : '<div class="bc-empty">ไม่มีพนักงานในสาขานี้</div>';
      return [
        '<div class="branch-card">',
          '<div class="bc-head" style="background:' + color + '">',
            ICONS.building,
            '<div><div class="bc-name">' + escapeHtml(b.name) + '</div><div class="bc-code">' + escapeHtml(b.id) + '</div></div>',
            '<div class="bc-meta"><span class="bc-count">' + members.length + ' คน</span>' + turnHtml + '</div>',
          '</div>',
          '<div class="bc-body">' + body + '</div>',
        '</div>',
      ].join('');
    }).join('');
  }

  // Position view: จัดกลุ่มพนักงานตามตำแหน่ง + chip สาขาหลัก
  function renderPositionView(list) {
    const grid = document.getElementById('position-grid');
    if (!grid) return;
    const groups = {};
    list.forEach(e => { const key = e.position_id || '__none__'; (groups[key] = groups[key] || []).push(e); });
    const order = (allLookups && allLookups.positions) ? allLookups.positions.map(p => p.id) : [];
    const keys = Object.keys(groups).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
    });
    if (!keys.length) { grid.innerHTML = '<div class="bc-empty">ไม่พบพนักงาน</div>'; return; }
    grid.innerHTML = keys.map((key, idx) => {
      const pos = (allLookups.positions || []).find(p => p.id === key);
      const title = (key === '__none__') ? 'ไม่ระบุตำแหน่ง' : (pos ? pos.name : key);
      const code = (key === '__none__') ? '—' : (key + (pos && pos.level ? ' · ' + pos.level : ''));
      const color = BR_PALETTE[idx % BR_PALETTE.length];
      const members = groups[key].slice().sort((x, y) =>
        (x.is_management ? 0 : 1) - (y.is_management ? 0 : 1) ||
        (x.nickname || x.first_name || '').localeCompare(y.nickname || y.first_name || '', 'th'));
      const body = members.map(e => {
        const initials = (e.nickname || e.first_name || e.employee_id).substring(0, 2).toUpperCase();
        const asg = empAssignmentsOf(e);
        const primary = asg.find(a => a.is_primary) || asg[0];
        const brChip = primary
          ? '<span class="br-chip" style="margin-left:auto"><span class="bdot" style="background:' + branchColor(primary.branch_id) + '"></span>' + escapeHtml(primary.branch_name || primary.branch_id) + '</span>'
          : '';
        const mgmtTag = e.is_management ? ' <span class="float-tag">หัวหน้า</span>' : '';
        return [
          '<div class="bc-mini" onclick="openEdit(\'' + escapeAttr(e.employee_id) + '\')">',
            '<div class="emp-avatar" style="--av:' + avColor(e.employee_id) + '">' + escapeHtml(initials) + '</div>',
            '<div>',
              '<div class="m-nm">' + escapeHtml(e.nickname || e.first_name || '—') + mgmtTag + '</div>',
              '<div class="m-ro">' + escapeHtml(e.employee_id) + ' · ' + escapeHtml(e.department_name || '—') + '</div>',
            '</div>',
            brChip,
          '</div>',
        ].join('');
      }).join('');
      return [
        '<div class="branch-card">',
          '<div class="bc-head" style="background:' + color + '">',
            ICONS.briefcase,
            '<div><div class="bc-name">' + escapeHtml(title) + '</div><div class="bc-code">' + escapeHtml(code) + '</div></div>',
            '<div class="bc-meta"><span class="bc-count">' + members.length + ' คน</span></div>',
          '</div>',
          '<div class="bc-body">' + body + '</div>',
        '</div>',
      ].join('');
    }).join('');
  }

  // Org chart view: reporting tree (สายบังคับบัญชา) + branch mode (ตามสาขา)
  function orgSort(a, b) {
    return (a.is_management ? 0 : 1) - (b.is_management ? 0 : 1) ||
      (a.nickname || a.first_name || '').localeCompare(b.nickname || b.first_name || '', 'th');
  }
  function orgNodeHTML(e, childCount) {
    const initials = (e.nickname || e.first_name || e.employee_id).substring(0, 2).toUpperCase();
    const cls = ['org-node', e.is_management ? 'is-mgmt' : '', !e.supervisor_id ? 'is-top' : ''].join(' ').trim();
    const brName = e.primary_branch_name || e.primary_branch_id || '';
    const brChip = brName
      ? '<span class="br-chip"><span class="bdot" style="background:' + branchColor(e.primary_branch_id) + '"></span>' + escapeHtml(brName) + '</span>'
      : '';
    const fullName = ((e.first_name || '') + ' ' + (e.last_name || '')).trim();
    return [
      '<div class="' + cls + '" onclick="openEdit(\'' + escapeAttr(e.employee_id) + '\')" title="' + escapeAttr(fullName) + '">',
        childCount ? '<span class="dr-count" title="ลูกทีมโดยตรง ' + childCount + ' คน">' + childCount + '</span>' : '',
        '<div class="av" style="background:' + avColor(e.employee_id) + '">' + escapeHtml(initials) + '</div>',
        '<div class="nm">' + escapeHtml(e.nickname || e.first_name || '—') + '</div>',
        '<div class="id">' + escapeHtml(e.employee_id) + '</div>',
        '<div class="ro">' + escapeHtml(e.position_name || '—') + '</div>',
        brChip,
      '</div>',
    ].join('');
  }
  function orgBuildTree(e, childrenMap, seen) {
    seen = seen || {};
    if (seen[e.employee_id]) return '';
    seen[e.employee_id] = true;
    const kids = childrenMap[e.employee_id] || [];
    let html = '<li>' + orgNodeHTML(e, kids.length);
    if (kids.length) html += '<ul>' + kids.map(k => orgBuildTree(k, childrenMap, seen)).join('') + '</ul>';
    return html + '</li>';
  }
  function orgIndex(members) {
    const ids = {};
    members.forEach(e => { ids[e.employee_id] = true; });
    const childrenMap = {};
    members.forEach(e => {
      if (e.supervisor_id && ids[e.supervisor_id]) {
        (childrenMap[e.supervisor_id] = childrenMap[e.supervisor_id] || []).push(e);
      }
    });
    Object.keys(childrenMap).forEach(k => childrenMap[k].sort(orgSort));
    const roots = members.filter(e => !e.supervisor_id || !ids[e.supervisor_id]).sort(orgSort);
    const orphans = members.filter(e => e.supervisor_id && !ids[e.supervisor_id]).length;
    return { childrenMap, roots, orphans };
  }
  function orgRenderForest(members, ix) {
    const seen = {};
    let html = ix.roots.map(r => orgBuildTree(r, ix.childrenMap, seen)).join('');
    const left = members.filter(e => !seen[e.employee_id]);
    if (left.length) html += left.sort(orgSort).map(e => orgBuildTree(e, ix.childrenMap, seen)).join('');
    return { html: html, unreached: left.length };
  }
  function renderOrgChart(list) {
    const content = document.getElementById('org-content');
    const note = document.getElementById('org-orphan-note');
    if (!content) return;
    if (!list.length) {
      content.innerHTML = '<div class="bc-empty" style="padding:24px">ไม่พบพนักงาน</div>';
      if (note) note.style.display = 'none';
      return;
    }
    if (orgMode === 'branch') {
      if (note) note.style.display = 'none';
      if (!allLookups || !allLookups.branches || !allLookups.branches.length) {
        content.innerHTML = '<div class="bc-empty" style="padding:24px">ยังไม่มีข้อมูลสาขา</div>';
        return;
      }
      const cards = allLookups.branches.map(b => {
        const members = list.filter(e => e.primary_branch_id === b.id);
        if (!members.length) return '';
        const ix = orgIndex(members);
        const tree = '<ul class="org-tree" style="justify-content:flex-start">' + orgRenderForest(members, ix).html + '</ul>';
        return [
          '<div class="branch-card" style="min-width:0">',
            '<div class="bc-head" style="background:' + branchColor(b.id) + '">',
              ICONS.building,
              '<div><div class="bc-name">' + escapeHtml(b.name) + '</div><div class="bc-code">' + escapeHtml(b.id) + '</div></div>',
              '<div class="bc-meta"><span class="bc-count">' + members.length + ' คน</span></div>',
            '</div>',
            '<div class="org-scroll" style="padding:12px">' + tree + '</div>',
          '</div>',
        ].join('');
      }).join('');
      content.innerHTML = '<div style="padding:16px;display:flex;flex-direction:column;gap:16px">' +
        (cards || '<div class="bc-empty">ไม่พบพนักงานที่มีสาขาหลัก</div>') + '</div>';
      return;
    }
    // report mode
    const ix = orgIndex(list);
    const forest = orgRenderForest(list, ix);
    content.innerHTML = '<div class="org-scroll"><ul class="org-tree">' + forest.html + '</ul></div>';
    if (note) {
      const msgs = [];
      if (ix.orphans) msgs.push('มี ' + ix.orphans + ' คนที่หัวหน้าไม่อยู่ในผลการกรองปัจจุบัน จึงแสดงเป็นหัวสายชั่วคราว');
      if (forest.unreached) msgs.push('มี ' + forest.unreached + ' คนที่สาย supervisor วนกลับ (ข้อมูลผิดปกติ) — แสดงเป็นหัวสายเพื่อไม่ให้ตกหล่น');
      if (msgs.length) { note.style.display = ''; note.textContent = 'หมายเหตุ: ' + msgs.join(' · '); }
      else note.style.display = 'none';
    }
  }

  function setOrgMode(m) {
    orgMode = m;
    const rep = m === 'report';
    document.getElementById('org-btn-report').classList.toggle('on', rep);
    document.getElementById('org-btn-branch').classList.toggle('on', !rep);
    document.getElementById('org-mode-title').innerHTML = rep
      ? 'สายบังคับบัญชา <span class="hint">— ใครรายงานใคร (reporting line)</span>'
      : 'ตามสาขา <span class="hint">— จัดกลุ่มตามสาขาหลัก แล้วโยงสายในสาขา</span>';
    renderList();
  }

  function setView(v) {
    currentView = v;
    document.getElementById('list-section').style.display = (v === 'list') ? '' : 'none';
    document.getElementById('branch-section').style.display = (v === 'branch') ? '' : 'none';
    document.getElementById('position-section').style.display = (v === 'position') ? '' : 'none';
    document.getElementById('org-section').style.display = (v === 'org') ? '' : 'none';
    document.querySelectorAll('#em .view-toggle button').forEach(b => {
      b.classList.toggle('on', b.getAttribute('data-view') === v);
    });
  }

  /* === Modal (= 360 รายคน) === */
  function openAdd() {
    editingId = null; editingDetail = null;
    document.getElementById('modal-title').textContent = 'เพิ่มพนักงาน';
    document.getElementById('modal-sub').textContent = 'กรอก ID + ชื่อ + ตำแหน่ง + สาขา';
    resetForm();
    document.getElementById('m-emp-id').disabled = false;
    document.getElementById('m-status').value = 'active';
    document.getElementById('multi-branch-block').style.display = 'none';
    document.getElementById('modal-bg').classList.add('active');
  }

  function openEdit(empId) {
    google.script.run
      .withSuccessHandler(d => {
        if (d && d.error) { showToast(d.error, 'error'); return; }
        editingId = empId; editingDetail = d;
        document.getElementById('modal-title').textContent = 'รายละเอียด ' + (d.nickname || d.first_name || empId);
        document.getElementById('modal-sub').textContent = empId + ' · ' + (d.assignments || []).length + ' branch assignments';
        document.getElementById('m-id-existing').value = empId;
        document.getElementById('m-emp-id').value = empId;
        document.getElementById('m-emp-id').disabled = true;
        document.getElementById('m-first-name').value = d.first_name || '';
        document.getElementById('m-last-name').value = d.last_name || '';
        document.getElementById('m-nickname').value = d.nickname || '';
        document.getElementById('m-position-id').value = d.position_id || '';
        document.getElementById('m-department-id').value = d.department_id || '';
        document.getElementById('m-primary-branch').value = d.primary_branch_id || '';
        document.getElementById('m-branch-role').value = d.branch_role || 'staff';
        document.getElementById('m-supervisor-id').value = d.supervisor_id || '';
        document.getElementById('m-email').value = d.email || '';
        document.getElementById('m-phone').value = d.phone || '';
        document.getElementById('m-line-user-id').value = d.line_user_id || '';
        document.getElementById('m-start-date').value = d.start_date || '';
        document.getElementById('m-end-date').value = d.end_date || '';
        document.getElementById('m-status').value = d.status || 'active';
        document.getElementById('m-tags').value = d.tags || '';
        document.getElementById('m-birth-date').value = d.birth_date || '';
        document.getElementById('m-cake-type').value = d.cake_type || '';
        document.getElementById('m-delegate-to').value = d.delegate_to || '';
        document.getElementById('m-delegate-until').value = d.delegate_until || '';
        document.getElementById('m-hr-notes').value = d.hr_notes || '';
        document.getElementById('multi-branch-block').style.display = '';
        renderAssignments(d.assignments);
        document.getElementById('modal-bg').classList.add('active');
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .empAdminGetDetail(empId);
  }

  function resetForm() {
    document.getElementById('m-id-existing').value = '';
    ['m-emp-id', 'm-first-name', 'm-last-name', 'm-nickname', 'm-position-id',
     'm-department-id', 'm-primary-branch', 'm-supervisor-id', 'm-email', 'm-phone',
     'm-line-user-id', 'm-start-date', 'm-end-date', 'm-tags', 'm-birth-date',
     'm-cake-type', 'm-delegate-to', 'm-delegate-until', 'm-hr-notes'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('m-branch-role').value = 'staff';
    document.getElementById('m-start-date').value = new Date().toISOString().split('T')[0];
  }

  function onPositionChange() {
    const posId = document.getElementById('m-position-id').value;
    if (!posId || !allLookups) return;
    const pos = (allLookups.positions || []).find(p => p.id === posId);
    if (pos && pos.department_id) document.getElementById('m-department-id').value = pos.department_id;
  }

  function renderAssignments(assignments) {
    const cont = document.getElementById('assignments-list');
    if (!assignments || assignments.length === 0) {
      cont.innerHTML = '<div style="text-align:center;padding:14px;color:var(--text-muted);font-size:12px">ยังไม่มี assignment</div>';
    } else {
      const rows = assignments.map(a => {
        const inactive = (a.is_active === false) ? 'inactive' : '';
        const primaryBadge = a.is_primary ? '<span class="pill pill-info" style="margin-left:4px">primary</span>' : '';
        return [
          '<tr class="' + inactive + '">',
            '<td><span class="mono" style="font-weight:600">' + escapeHtml(a.branch_id) + '</span>' + primaryBadge + '</td>',
            '<td><span class="pct-badge">' + (a.allocation_pct || 0) + '%</span></td>',
            '<td>' + escapeHtml(a.role || 'staff') + '</td>',
            '<td style="font-size:11px;color:var(--text-muted)">' + (a.start_date || '—') + ' – ' + (a.end_date || 'ongoing') + '</td>',
            '<td style="text-align:right">',
              ((a.is_active !== false) ?
                '<button class="btn btn-icon btn-icon-danger" onclick="endAssign(\'' + escapeAttr(a.assignment_id) + '\')" title="ปิด assignment">' + ICONS.trash + '</button>'
                : '<span style="font-size:11px;color:var(--text-faint)">closed</span>'),
            '</td>',
          '</tr>',
        ].join('');
      }).join('');
      cont.innerHTML = [
        '<table class="assignments-table">',
          '<thead><tr><th>สาขา</th><th>%</th><th>บทบาท</th><th>ช่วงเวลา</th><th></th></tr></thead>',
          '<tbody>' + rows + '</tbody>',
        '</table>',
      ].join('');
    }
    const totalActive = (assignments || []).filter(a => a.is_active !== false).reduce((s, a) => s + (a.allocation_pct || 0), 0);
    const status = document.getElementById('alloc-status');
    if (totalActive === 100) status.innerHTML = '<div class="alloc-ok">รวม allocation = 100% (ครบ)</div>';
    else if (totalActive === 0) status.innerHTML = '';
    else status.innerHTML = '<div class="alloc-warning">รวม allocation = ' + totalActive + '% (ควรครบ 100%)</div>';
  }

  function addAssignment() {
    const branch = document.getElementById('ma-branch').value;
    const pct = parseInt(document.getElementById('ma-pct').value) || 0;
    const role = document.getElementById('ma-role').value;
    if (!branch || !pct) { showToast('เลือกสาขา + กรอก %', 'error'); return; }
    if (!editingId) { showToast('save พนักงานก่อน', 'error'); return; }
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('เพิ่มแล้ว', 'success');
        document.getElementById('ma-branch').value = '';
        document.getElementById('ma-pct').value = '';
        google.script.run.withSuccessHandler(d => { editingDetail = d; renderAssignments(d.assignments); }).empAdminGetDetail(editingId);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .empAdminAddAssignment({
        employee_id: editingId, branch_id: branch, allocation_pct: pct, role: role,
        start_date: new Date().toISOString().split('T')[0], is_primary: false,
      });
  }

  function endAssign(assignmentId) {
    if (!confirm('ปิด assignment นี้ (set end_date = วันนี้)?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('ปิดแล้ว', 'success');
        google.script.run.withSuccessHandler(d => { editingDetail = d; renderAssignments(d.assignments); }).empAdminGetDetail(editingId);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .empAdminEndAssignment(assignmentId, new Date().toISOString().split('T')[0]);
  }

  function closeModal() { document.getElementById('modal-bg').classList.remove('active'); }

  function saveEmployee() {
    const isEdit = !!editingId;
    const id = isEdit ? editingId : (document.getElementById('m-emp-id').value || '').trim().toUpperCase();
    const payload = {
      employee_id: id,
      first_name: document.getElementById('m-first-name').value.trim(),
      last_name: document.getElementById('m-last-name').value.trim(),
      nickname: document.getElementById('m-nickname').value.trim(),
      position_id: document.getElementById('m-position-id').value,
      department_id: document.getElementById('m-department-id').value,
      primary_branch_id: document.getElementById('m-primary-branch').value,
      branch_role: document.getElementById('m-branch-role').value,
      email: document.getElementById('m-email').value.trim(),
      phone: document.getElementById('m-phone').value.trim(),
      line_user_id: document.getElementById('m-line-user-id').value.trim(),
      start_date: document.getElementById('m-start-date').value,
      end_date: document.getElementById('m-end-date').value,
      status: document.getElementById('m-status').value,
      tags: document.getElementById('m-tags').value.trim(),
      supervisor_id: document.getElementById('m-supervisor-id').value,
      birth_date: document.getElementById('m-birth-date').value,
      cake_type: document.getElementById('m-cake-type').value,
      delegate_to: document.getElementById('m-delegate-to').value,
      delegate_until: document.getElementById('m-delegate-until').value,
      hr_notes: document.getElementById('m-hr-notes').value.trim(),
    };
    if (!payload.employee_id || !payload.first_name) { showToast('กรอก ID + ชื่อ', 'error'); return; }
    document.getElementById('save-btn').disabled = true;
    if (isEdit) {
      google.script.run.withSuccessHandler(r => onSaveDone(r, 'แก้ไขแล้ว')).withFailureHandler(onSaveErr).empAdminUpdate(id, payload);
    } else {
      google.script.run.withSuccessHandler(r => onSaveDone(r, 'เพิ่มแล้ว')).withFailureHandler(onSaveErr).empAdminAdd(payload);
    }
  }
  function onSaveDone(r, msg) {
    document.getElementById('save-btn').disabled = false;
    if (r && r.error) { showToast(r.error, 'error'); return; }
    closeModal(); showToast(msg, 'success'); loadList();
  }
  function onSaveErr(e) {
    document.getElementById('save-btn').disabled = false;
    showToast('Error: ' + e.message, 'error');
  }

  document.getElementById('save-btn').innerHTML = ICONS.save + ' บันทึก';

  function clearFilters() {
    const ids = ['filter-search', 'filter-status', 'filter-branch', 'filter-department',
      'filter-position', 'filter-level', 'filter-supervisor', 'filter-work', 'filter-sort'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    renderList();
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList, openAdd, openEdit, setView, setOrgMode,
    onPositionChange, addAssignment, endAssign, closeModal, saveEmployee,
    renderList, clearFilters,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadList();
}

/* ผูก mount เข้า window ตอนโหลด classic script (เหมือน payrollmgr.js) */
if (typeof window !== 'undefined') window.mountEmployeemgr = mountEmployeemgr;
