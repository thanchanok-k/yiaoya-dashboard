// _ported/position.js — FULL native port of desktop position_manager.html (HR Announcement admin · หน้า "จัดการตำแหน่ง")
// ลอกทั้งดุ้น: view toggle (Positions/Departments) + stats(5) + filters(search/level/dept)
//   + ตาราง positions + ตาราง departments + modal (position fields เต็ม recruit-block / department fields) + help
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix #ps ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ PS_RUN_PAGE_JS() · google.script.run = shim → PS_BACKEND (Supabase)
//
// ใช้ global window.sb (index.html module scope) — ห้าม redeclare · helper (esc/$/ICONS/showToast/showHelp) inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน PS_RUN_PAGE_JS (prefix กันชน)
//
// backend (edge fn hr_list?type=position.updated → {items}) :
//   positionAdminList() → derive { positions, departments, stats } client-side จาก payload ล่าสุดต่อ entity
//                          (ตอนนี้ list อาจว่าง = 0 row → render ได้ ไม่ error · empty state สวย)
//   mutations (add/update/remove position/department) → เขียนกลับไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   PS_BACKEND — map google.script.run → Supabase edge fn hr_list (type=position.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     positionAdminList() → { positions, departments, stats }
     mutations           → { ok / error } stub + toast
   ============================================================ */
var PS_FN = 'hr_list';
var PS_TYPE = 'position.updated';

function ps2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function ps2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function ps2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

// map payload event ดิบ → position row shape ที่ JS เดิมใช้
function ps2MapPos(p) {
  p = p || {};
  var lvl = String(p.level || 'L1').toUpperCase();
  if (['L1', 'L2', 'L3', 'L4', 'L5'].indexOf(lvl) < 0) lvl = 'L1';
  return {
    position_id: p.position_id || p.entity_id || p.id || '',
    name: p.name || p.position_name || p.title || '—',
    department_id: p.department_id || '',
    department_name: p.department_name || '',
    level: lvl,
    is_management: ps2Bool(p.is_management),
    description: p.description || '',
    employee_count: ps2Num(p.employee_count),
    is_hq: ps2Bool(p.is_hq),
    required_documents: p.required_documents || '',
    salary_range: p.salary_range || '',
    hourly_rate: p.hourly_rate || '',
    df_range: p.df_range || '',
    monthly_case_target: p.monthly_case_target || '',
    requires_mbti: ps2Bool(p.requires_mbti),
    benefits_list: p.benefits_list || '',
    hero_image_url: p.hero_image_url || '',
    _raw: p,
  };
}

// map payload event ดิบ → department row shape ที่ JS เดิมใช้
function ps2MapDept(d) {
  d = d || {};
  return {
    department_id: d.department_id || d.entity_id || d.id || '',
    department_name: d.department_name || d.name || '—',
    description: d.description || '',
    position_count: ps2Num(d.position_count),
    employee_count: ps2Num(d.employee_count),
    _raw: d,
  };
}

// cache derived ล่าสุด (ให้ mutation toast reuse · backend ไม่มี endpoint แยก)
var _ps2Positions = [];
var _ps2Departments = [];

function ps2FetchAll() {
  return window.sb.functions.invoke(PS_FN + '?type=' + encodeURIComponent(PS_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = ps2ToArr(data.items);
    var pSeen = {}, dSeen = {};
    var positions = [], departments = [];
    // derive client-side: แยก row ตาม kind / มี department_name เด่ว → department, ที่เหลือ → position
    items.forEach(function (p) {
      var kind = String(p.kind || p.entity_kind || p.type || '').toLowerCase();
      var isDept = kind.indexOf('department') >= 0 || kind.indexOf('dept') >= 0 ||
        (!p.position_id && (p.department_id || p.department_name) && !p.name && !p.level);
      if (isDept) {
        var did = p.department_id || p.entity_id || p.id || '';
        if (!did || dSeen[did]) return;
        dSeen[did] = true;
        departments.push(ps2MapDept(p));
      } else {
        var pid = p.position_id || p.entity_id || p.id || '';
        if (!pid || pSeen[pid]) return;
        pSeen[pid] = true;
        positions.push(ps2MapPos(p));
      }
    });
    // เติม department_name ใน position จาก department list (lookup)
    var dMap = {};
    departments.forEach(function (d) { dMap[d.department_id] = d.department_name; });
    positions.forEach(function (p) {
      if (p.department_id && !p.department_name && dMap[p.department_id]) p.department_name = dMap[p.department_id];
    });
    _ps2Positions = positions;
    _ps2Departments = departments;
    return { positions: positions, departments: departments };
  }).catch(function (e) {
    console.warn('[PS_BACKEND] list fetch failed', e);
    _ps2Positions = [];
    _ps2Departments = [];
    return { positions: [], departments: [] };
  });
}

var PS_BACKEND = {
  // list — { positions, departments, stats }
  positionAdminList: function () {
    return ps2FetchAll().then(function (all) {
      var positions = all.positions || [];
      var departments = all.departments || [];
      var stats = {
        total_positions: positions.length,
        total_departments: departments.length,
        management_positions: positions.filter(function (p) { return p.is_management; }).length,
        unused_positions: positions.filter(function (p) { return p.employee_count === 0; }).length,
        unused_departments: departments.filter(function (d) { return d.employee_count === 0; }).length,
      };
      return { positions: positions, departments: departments, stats: stats };
    });
  },

  // ---- mutations: เขียนกลับไม่ได้บน dashboard → stub + toast ----
  positionAdminAddPosition: function () {
    ps2NotReady('เพิ่มตำแหน่ง');
    return Promise.resolve({ error: 'เพิ่มตำแหน่ง ยังไม่พร้อมบน dashboard (read-only)' });
  },
  positionAdminUpdatePosition: function () {
    ps2NotReady('แก้ไขตำแหน่ง');
    return Promise.resolve({ error: 'แก้ไขตำแหน่ง ยังไม่พร้อมบน dashboard (read-only)' });
  },
  positionAdminRemovePosition: function () {
    ps2NotReady('ลบตำแหน่ง');
    return Promise.resolve({ error: 'ลบตำแหน่ง ยังไม่พร้อมบน dashboard (read-only)' });
  },
  positionAdminAddDepartment: function () {
    ps2NotReady('เพิ่มแผนก');
    return Promise.resolve({ error: 'เพิ่มแผนก ยังไม่พร้อมบน dashboard (read-only)' });
  },
  positionAdminUpdateDepartment: function () {
    ps2NotReady('แก้ไขแผนก');
    return Promise.resolve({ error: 'แก้ไขแผนก ยังไม่พร้อมบน dashboard (read-only)' });
  },
  positionAdminRemoveDepartment: function () {
    ps2NotReady('ลบแผนก');
    return Promise.resolve({ error: 'ลบแผนก ยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _ps2NotReadyShown = {};
function ps2NotReady(feature) {
  if (_ps2NotReadyShown[feature]) return;
  _ps2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ps2Toast) window.ps2Toast('ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountPosition — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountPosition() {
  if (!document.getElementById('wrap-position')) return;
  var wrap = document.getElementById('wrap-position');
  wrap.innerHTML = '<style>' + PS_CSS() + '</style><div id="ps">' + PS_MARKUP() + '</div>';
  PS_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #ps =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว) */
function PS_CSS() {
  return [
    // tokens (มาจาก _shared_styles)
    '#ps{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;--c-company:#7C3AED;--c-company-bg:#F3E8FF;--c-public:#1E40AF;color:var(--text);font-size:13px;line-height:1.5}',
    '#ps *{box-sizing:border-box}',
    // buttons (จาก _shared_styles)
    '#ps .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#ps .btn:hover{border-color:var(--navy)}',
    '#ps .btn svg{width:14px;height:14px}',
    '#ps .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#ps .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#ps .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#ps .btn-sm{padding:5px 10px;font-size:12px}',
    '#ps .btn-icon{width:30px;height:30px;padding:0;justify-content:center}',
    '#ps .btn-icon svg{width:14px;height:14px}',
    '#ps .btn-icon-danger:hover{border-color:var(--danger);color:var(--danger)}',
    '#ps .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:8px;background:#fff;color:var(--text-muted);cursor:pointer}',
    '#ps .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#ps .btn-help svg{width:14px;height:14px}',
    // page head (native บน dashboard)
    '#ps .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#ps .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ps .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#ps .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ps .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;align-items:center}',
    // toggle group (view switch)
    '#ps .toggle-group{display:inline-flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px}',
    '#ps .toggle-btn{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '#ps .toggle-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#ps .toggle-btn svg{width:13px;height:13px}',
    // stat cards
    '#ps .stats{display:grid;gap:10px;margin-bottom:14px}',
    '#ps .stats.cols-5{grid-template-columns:repeat(5,1fr)}',
    '@media (max-width:1100px){#ps .stats.cols-5{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#ps .stats.cols-5{grid-template-columns:repeat(2,1fr)}}',
    '#ps .stat{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#ps .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#ps .stat-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#ps .stat-value{font-size:22px;font-weight:600;line-height:1;margin-top:4px;color:#0D2F4F;letter-spacing:-.02em}',
    '#ps .stat-sub{font-size:10px;color:var(--text-faint);margin-top:3px}',
    // filters
    '#ps .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}',
    '#ps .filter{display:flex;flex-direction:column;gap:2px}',
    '#ps .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#ps .filter input,#ps .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#ps .filter input:focus,#ps .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section card
    '#ps .section{background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden}',
    '#ps .section-header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border)}',
    '#ps .section-icon{width:30px;height:30px;border-radius:8px;background:var(--bg);display:inline-flex;align-items:center;justify-content:center;color:var(--navy)}',
    '#ps .section-icon svg{width:16px;height:16px}',
    '#ps .section-title{font-size:14px;font-weight:600;color:var(--text)}',
    '#ps .section-sub{font-size:11px;color:var(--text-muted);margin-top:2px}',
    '#ps .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // data table
    '#ps .data-table{width:100%;border-collapse:collapse;font-size:13px}',
    '#ps .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#ps .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;color:var(--text);vertical-align:middle}',
    '#ps .data-table tbody tr{border-left:3px solid transparent;transition:background .15s}',
    '#ps .data-table tbody tr:hover{background:#FAFBFC}',
    '#ps .data-table tbody tr.is-management{border-left-color:var(--c-company)}',
    '#ps .data-table tbody tr.no-employees{opacity:.7}',
    '#ps .id-mono{font-family:"SF Mono",Consolas,monospace;font-size:12px;font-weight:600;color:var(--text)}',
    '#ps .row-name{font-weight:500;color:var(--text)}',
    '#ps .row-desc{font-size:11px;color:var(--text-muted);margin-top:2px}',
    // level badge
    '#ps .level-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;font-family:"SF Mono",Consolas,monospace}',
    '#ps .level-L1{background:#F1F5F9;color:var(--text-muted)}',
    '#ps .level-L2{background:#DBEAFE;color:#1E40AF}',
    '#ps .level-L3{background:#DCFCE7;color:#15803D}',
    '#ps .level-L4{background:#FEF3C7;color:#B45309}',
    '#ps .level-L5{background:#FCE7F3;color:#BE185D}',
    '#ps .mgmt-pill{padding:2px 8px;border-radius:12px;background:var(--c-company-bg);color:var(--c-company);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}',
    '#ps .count-cell{text-align:center;font-weight:600;font-size:14px;color:var(--text)}',
    '#ps .count-cell.zero{color:var(--text-faint);font-weight:400}',
    '#ps .count-cell-sub{font-size:9px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    // empty state
    '#ps .empty{padding:40px 20px;text-align:center;color:var(--text-muted)}',
    '#ps .empty-icon{display:inline-flex;color:var(--text-faint);margin-bottom:8px}',
    '#ps .empty-icon svg{width:36px;height:36px}',
    '#ps .empty-title{font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px}',
    '#ps .empty-sub{font-size:12px;color:var(--text-muted)}',
  ].join('\n') + PS_CSS2();
}

/* CSS part 2 — modal / field / misc */
function PS_CSS2() {
  return '\n' + [
    // modal
    '#ps .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#ps .modal-bg.active{display:flex}',
    '#ps .modal{background:#fff;border-radius:12px;max-width:720px;width:92%;max-height:92vh;overflow-y:auto}',
    '#ps .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#ps .modal-header h2{font-size:16px;margin:0}',
    '#ps .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#ps .modal-body{padding:16px 20px}',
    '#ps .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
    // field
    '#ps .field{margin-bottom:12px}',
    '#ps .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#ps .field input,#ps .field select,#ps .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#ps .field input:focus,#ps .field select:focus,#ps .field textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#ps .field input:disabled{background:#F8FAFC;color:var(--text-muted)}',
    '#ps .field textarea{min-height:64px;resize:vertical}',
    '#ps .field-help{font-size:10px;color:var(--text-faint);margin-top:3px}',
    '#ps .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media (max-width:600px){#ps .field-grid{grid-template-columns:1fr}}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + toggle + stats + filters + section + modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell/topbar ออก */
function PS_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>',
    '      ตำแหน่ง + แผนก',
    '    </h1>',
    '    <div class="subtitle">02 + 03 · CRUD ตำแหน่ง + แผนก · role_code · is_hq · required_documents</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <div class="toggle-group">',
    '      <button class="toggle-btn active" id="view-pos" onclick="setView(\'pos\')"></button>',
    '      <button class="toggle-btn" id="view-dept" onclick="setView(\'dept\')"></button>',
    '    </div>',
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn"></button>',
    '    <button class="btn btn-sm" onclick="loadList()" id="refresh-btn"></button>',
    '    <button class="btn btn-primary" onclick="openAdd()" id="add-btn"></button>',
    '  </div>',
    '</header>',
    // stats
    '<div class="stats cols-5" id="stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ค้นหา</label>',
    '    <input type="search" id="filter-search" placeholder="ID หรือชื่อ..." oninput="renderList()">',
    '  </div>',
    '  <div class="filter" id="filter-level-wrap">',
    '    <label>ระดับ</label>',
    '    <select id="filter-level" onchange="renderList()">',
    '      <option value="">ทุกระดับ</option>',
    '      <option value="L1">L1 — Junior</option>',
    '      <option value="L2">L2 — Senior</option>',
    '      <option value="L3">L3 — Manager</option>',
    '      <option value="L4">L4 — Director</option>',
    '      <option value="L5">L5 — Owner</option>',
    '    </select>',
    '  </div>',
    '  <div class="filter" id="filter-dept-wrap">',
    '    <label>แผนก</label>',
    '    <select id="filter-dept" onchange="renderList()">',
    '      <option value="">ทุกแผนก</option>',
    '    </select>',
    '  </div>',
    '</div>',
    // section
    '<div class="section">',
    '  <div class="section-header">',
    '    <div class="section-icon" id="section-icon"></div>',
    '    <div style="flex:1">',
    '      <div class="section-title" id="section-title">ตำแหน่ง</div>',
    '      <div class="section-sub" id="section-sub">รายการตำแหน่งทั้งหมด — กดที่แถวเพื่อแก้ไข</div>',
    '    </div>',
    '  </div>',
    '  <div id="content" class="loading">กำลังโหลด...</div>',
    '</div>',
    PS_MODAL(),
  ].join('\n');
}

/* modal เดียว สลับ body pos/dept · คง element id เดิม */
function PS_MODAL() {
  return [
    '<div class="modal-bg" id="modal-bg" onclick="if(event.target===this)closeModal()">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2 id="modal-title">เพิ่มตำแหน่ง</h2>',
    '      <p id="modal-sub">กรอก ID + ชื่อ + แผนก ให้ครบ</p>',
    '    </div>',
    '    <div class="modal-body" id="modal-body-pos">',
    '      <input type="hidden" id="m-pos-id-existing">',
    '      <div class="field-grid">',
    '        <div class="field">',
    '          <label>Position ID *</label>',
    '          <input type="text" id="m-pos-id" placeholder="POS16" style="font-family:monospace;text-transform:uppercase">',
    '          <div class="field-help">เช่น POS16 — แก้ไม่ได้หลังสร้าง</div>',
    '        </div>',
    '        <div class="field">',
    '          <label>ระดับ</label>',
    '          <select id="m-pos-level">',
    '            <option value="L1">L1 — Junior staff</option>',
    '            <option value="L2">L2 — Senior staff</option>',
    '            <option value="L3">L3 — Manager</option>',
    '            <option value="L4">L4 — Director</option>',
    '            <option value="L5">L5 — Owner</option>',
    '          </select>',
    '        </div>',
    '      </div>',
    '      <div class="field">',
    '        <label>ชื่อตำแหน่ง *</label>',
    '        <input type="text" id="m-pos-name" placeholder="เช่น Senior Pharmacist">',
    '      </div>',
    '      <div class="field-grid">',
    '        <div class="field">',
    '          <label>แผนก</label>',
    '          <select id="m-pos-dept">',
    '            <option value="">— เลือกแผนก —</option>',
    '          </select>',
    '        </div>',
    '        <div class="field" style="display:flex;align-items:end;gap:8px;padding-bottom:6px">',
    '          <input type="checkbox" id="m-pos-mgmt" style="width:16px;height:16px;accent-color:var(--navy);cursor:pointer">',
    '          <label for="m-pos-mgmt" style="margin-bottom:0;cursor:pointer">เป็นตำแหน่งหัวหน้า/ผู้จัดการ</label>',
    '        </div>',
    '      </div>',
    '      <div class="field">',
    '        <label>คำอธิบาย</label>',
    '        <textarea id="m-pos-desc" placeholder="หน้าที่ความรับผิดชอบ"></textarea>',
    '      </div>',
    '      <div style="background:#F8FAFC;border-left:3px solid #00B900;padding:10px 12px;border-radius:6px;margin-top:10px">',
    '        <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">สำหรับ Recruit</div>',
    '        <div class="field-grid">',
    '          <div class="field" style="display:flex;align-items:end;gap:8px;padding-bottom:6px">',
    '            <input type="checkbox" id="m-pos-hq" style="width:16px;height:16px;accent-color:#00B900;cursor:pointer">',
    '            <label for="m-pos-hq" style="margin-bottom:0;cursor:pointer">ตำแหน่ง HQ (สำนักงานใหญ่ ไม่ใช่สาขา)</label>',
    '          </div>',
    '          <div></div>',
    '        </div>',
    '        <div class="field">',
    '          <label>เอกสารที่ต้องเตรียม (recruit) — comma-separated</label>',
    '          <textarea id="m-pos-docs" placeholder="บัตรประชาชน, ทะเบียนบ้าน, วุฒิการศึกษา, รูปถ่าย 1 นิ้ว, ใบรับรองการทำงาน" rows="3"></textarea>',
    '          <div class="field-help">candidate จะได้รับ flex แสดงรายการนี้หลังกดสมัครผ่าน LINE · ใช้ "—" คั่นระหว่างชื่อกับ sub-text เช่น "บัตรประชาชน — สำเนาหน้า+หลัง"</div>',
    '        </div>',
    '        <div class="field-grid">',
    '          <div class="field">',
    '            <label>เงินเดือน (salary range)</label>',
    '            <input id="m-pos-salary" placeholder="35,000-45,000">',
    '          </div>',
    '          <div class="field">',
    '            <label>Hourly rate (สำหรับ on-call)</label>',
    '            <input id="m-pos-hourly" placeholder="750 ฿/ชม">',
    '          </div>',
    '        </div>',
    '        <div class="field-grid">',
    '          <div class="field">',
    '            <label>DF range</label>',
    '            <input id="m-pos-df" placeholder="300-1,000">',
    '          </div>',
    '          <div class="field">',
    '            <label>เป้าดูแลคนไข้/เดือน</label>',
    '            <input id="m-pos-case-target" type="number" min="0" placeholder="เช่น 150">',
    '            <div class="field-help" style="font-size:11px;color:var(--text-muted)">เป้าของผู้ให้บริการตำแหน่งนี้ · ใช้ในสกอร์บอร์ดผู้ให้บริการ</div>',
    '          </div>',
    '          <div class="field" style="display:flex;align-items:end;gap:8px;padding-bottom:6px">',
    '            <input type="checkbox" id="m-pos-mbti" style="width:16px;height:16px;accent-color:#7C3AED;cursor:pointer">',
    '            <label for="m-pos-mbti" style="margin-bottom:0;cursor:pointer">ส่ง MBTI หลังสมัคร (พนักงานปกติ)</label>',
    '          </div>',
    '        </div>',
    '        <div class="field">',
    '          <label>สวัสดิการ (1 บรรทัดต่อ 1 รายการ — แสดง 4 รายการแรก)</label>',
    '          <textarea id="m-pos-benefits" placeholder="ประกันสังคม&#10;Provident fund&#10;ตรวจสุขภาพประจำปี&#10;วันลาพักร้อน 10 วัน" rows="4"></textarea>',
    '        </div>',
    '        <div class="field">',
    '          <label>Hero image URL (override)</label>',
    '          <input id="m-pos-hero" type="url" placeholder="https://drive.google.com/uc?id=...">',
    '          <div class="field-help">ถ้าไม่ใส่จะใช้ template จาก Setting RECRUIT_HERO_BASE_URL</div>',
    '        </div>',
    '      </div>',
    '    </div>',
    '    <div class="modal-body" id="modal-body-dept" style="display:none">',
    '      <input type="hidden" id="m-dept-id-existing">',
    '      <div class="field">',
    '        <label>Department ID *</label>',
    '        <input type="text" id="m-dept-id" placeholder="DEP07" style="font-family:monospace;text-transform:uppercase">',
    '        <div class="field-help">เช่น DEP07 — แก้ไม่ได้หลังสร้าง</div>',
    '      </div>',
    '      <div class="field">',
    '        <label>ชื่อแผนก *</label>',
    '        <input type="text" id="m-dept-name" placeholder="เช่น IT / Tech">',
    '      </div>',
    '      <div class="field">',
    '        <label>คำอธิบาย</label>',
    '        <textarea id="m-dept-desc" placeholder="ขอบเขตของแผนก"></textarea>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeModal()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveItem()" id="save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   PS_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → PS_BACKEND
   helper (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function PS_RUN_PAGE_JS() {

  // ---- google.script.run shim → PS_BACKEND (async, คืน shape เดิม) ----
  function _ps2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (PS_BACKEND[prop]) {
            Promise.resolve().then(function () { return PS_BACKEND[prop].apply(PS_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[PS_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[PS_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ps2MakeChain(); } });

  // ---- helpers (inline · prefix ps ใน id เพื่อกันชน) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('ps2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ps2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ps2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('ps-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'ps-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'ps-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'ps-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม position_manager.html (ลอกทั้งดุ้น) =====
     ใช้ $id scope ใต้ #ps กันชน id (helper) · alias getById → document.getElementById เดิม
     ==================================================================== */
  const _psRoot = document.getElementById('ps');
  function $id(id) { return _psRoot ? _psRoot.querySelector('#' + id) : document.getElementById(id); }
  function getById(id) { return $id(id); }

  let allData = null;
  let currentView = 'pos';

  const HELP = {
    title: 'Position + Department Manager',
    subtitle: '02_Departments + 03_Positions · โครงสร้างองค์กร',
    intro: 'จัดการตำแหน่งและแผนก — ใช้เป็น lookup ในทุกระบบ (employees, KPI, payroll, etc.)',
    sections: [
      { title: 'View toggle', items: [
        '<strong>Positions</strong> — รายการตำแหน่ง (POS01-POSnn) + level + management flag',
        '<strong>Departments</strong> — รายการแผนก (DEP01-DEPnn)',
      ]},
      { title: 'Level system', items: [
        '<code>L1</code> Junior · <code>L2</code> Senior · <code>L3</code> Manager',
        '<code>L4</code> Director · <code>L5</code> Owner',
        'Mgmt flag — ตำแหน่งที่เป็นหัวหน้า (ใช้ใน supervisor lookup)',
      ]},
      { type: 'warn', title: 'ระวัง', items: [
        'ลบ position ไม่ได้ถ้ามีพนักงานใช้ (FK)',
        'ลบ department ไม่ได้ถ้ามี position หรือ employee อ้าง',
        'ID เปลี่ยนไม่ได้หลังสร้าง',
        'หมายเหตุ: บน dashboard นี้เป็น read-only — การเพิ่ม/แก้/ลบ ยังไม่พร้อม',
      ]},
    ],
  };

  // ===== header / labels =====
  getById('refresh-btn').innerHTML = ICONS.refresh;
  getById('add-btn').innerHTML = ICONS.plus + ' เพิ่ม';
  getById('save-btn').innerHTML = ICONS.save + ' บันทึก';
  getById('help-btn').innerHTML = ICONS.help;
  getById('view-pos').innerHTML = ICONS.briefcase + ' Positions';
  getById('view-dept').innerHTML = ICONS.users + ' Departments';
  getById('section-icon').innerHTML = ICONS.briefcase;

  function setView(v) {
    currentView = v;
    getById('view-pos').classList.toggle('active', v === 'pos');
    getById('view-dept').classList.toggle('active', v === 'dept');
    getById('filter-level-wrap').style.display = v === 'pos' ? '' : 'none';
    getById('filter-dept-wrap').style.display = v === 'pos' ? '' : 'none';
    getById('section-title').textContent = v === 'pos' ? 'ตำแหน่ง (Positions)' : 'แผนก (Departments)';
    getById('section-sub').textContent = v === 'pos'
      ? 'รายการตำแหน่งทั้งหมด — กดที่แถวเพื่อแก้ไข'
      : 'รายการแผนกทั้งหมด — กดที่แถวเพื่อแก้ไข';
    getById('section-icon').innerHTML = v === 'pos' ? ICONS.briefcase : ICONS.users;
    getById('add-btn').innerHTML = ICONS.plus + (v === 'pos' ? ' เพิ่มตำแหน่ง' : ' เพิ่มแผนก');
    if (allData) renderList();
  }

  function loadList() {
    getById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(d => {
        allData = d;
        // Populate dept dropdown
        const fd = getById('filter-dept');
        const md = getById('m-pos-dept');
        fd.innerHTML = '<option value="">ทุกแผนก</option>';
        md.innerHTML = '<option value="">— เลือกแผนก —</option>';
        (d.departments || []).forEach(dept => {
          const o = document.createElement('option');
          o.value = dept.department_id;
          o.textContent = dept.department_id + ' — ' + dept.department_name;
          fd.appendChild(o);
          md.appendChild(o.cloneNode(true));
        });
        renderStats(d.stats || {});
        renderList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .positionAdminList();
  }

  function renderStats(s) {
    getById('stats').innerHTML = [
      statCard('Positions', s.total_positions, 'ตำแหน่งทั้งหมด', 'var(--navy)'),
      statCard('Departments', s.total_departments, 'แผนกทั้งหมด', 'var(--c-public)'),
      statCard('Mgmt', s.management_positions, 'ตำแหน่งหัวหน้า', 'var(--c-company)'),
      statCard('Unused Pos', s.unused_positions, 'ไม่มีพนักงาน', s.unused_positions > 0 ? 'var(--warning)' : 'var(--text-faint)'),
      statCard('Unused Dept', s.unused_departments, 'ไม่มีพนักงาน', s.unused_departments > 0 ? 'var(--warning)' : 'var(--text-faint)'),
    ].join('');
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  function renderList() {
    if (!allData) return;
    if (currentView === 'pos') renderPositions();
    else renderDepartments();
  }

  function renderPositions() {
    const q = (getById('filter-search').value || '').toLowerCase().trim();
    const lvl = getById('filter-level').value;
    const dept = getById('filter-dept').value;

    let filtered = allData.positions || [];
    if (q) filtered = filtered.filter(p =>
      p.position_id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    if (lvl) filtered = filtered.filter(p => p.level === lvl);
    if (dept) filtered = filtered.filter(p => p.department_id === dept);

    if (filtered.length === 0) {
      getById('content').innerHTML = emptyState();
      return;
    }

    const rows = filtered.map(p => {
      const mgmtPill = p.is_management ? '<span class="mgmt-pill">Mgmt</span>' : '';
      const noEmp = p.employee_count === 0 ? 'no-employees' : '';
      return [
        '<tr class="' + (p.is_management ? 'is-management' : '') + ' ' + noEmp + '" onclick="openEditPos(\'' + escapeAttr(p.position_id) + '\')" style="cursor:pointer">',
          '<td><span class="id-mono">' + escapeHtml(p.position_id) + '</span></td>',
          '<td>',
            '<div class="row-name">' + escapeHtml(p.name) + ' ' + mgmtPill + '</div>',
            p.description ? '<div class="row-desc">' + escapeHtml(p.description) + '</div>' : '',
          '</td>',
          '<td>',
            p.department_id ? ('<span class="id-mono">' + escapeHtml(p.department_id) + '</span>' +
            (p.department_name ? '<div class="row-desc">' + escapeHtml(p.department_name) + '</div>' : '')) : '<span style="color:var(--text-faint)">—</span>',
          '</td>',
          '<td><span class="level-badge level-' + (p.level || 'L1') + '">' + (p.level || 'L1') + '</span></td>',
          '<td>',
            '<div class="count-cell ' + (p.employee_count === 0 ? 'zero' : '') + '">' + p.employee_count + '</div>',
            '<div class="count-cell-sub" style="text-align:center">พนักงาน</div>',
          '</td>',
          '<td onclick="event.stopPropagation()">',
            '<div style="display:flex;gap:4px;justify-content:flex-end">',
              '<button class="btn btn-icon" onclick="openEditPos(\'' + escapeAttr(p.position_id) + '\')" title="แก้">' + ICONS.edit + '</button>',
              '<button class="btn btn-icon btn-icon-danger" onclick="removePos(\'' + escapeAttr(p.position_id) + '\', \'' + escapeAttr(p.name) + '\')" title="ลบ">' + ICONS.trash + '</button>',
            '</div>',
          '</td>',
        '</tr>',
      ].join('');
    }).join('');

    getById('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th>ID</th><th>ตำแหน่ง</th><th>แผนก</th><th style="width:80px">ระดับ</th>',
          '<th style="width:90px;text-align:center">พนักงาน</th><th style="width:90px"></th>',
        '</tr></thead>',
        '<tbody>' + rows + '</tbody>',
      '</table>',
    ].join('');
  }

  function renderDepartments() {
    const q = (getById('filter-search').value || '').toLowerCase().trim();
    let filtered = allData.departments || [];
    if (q) filtered = filtered.filter(d =>
      d.department_id.toLowerCase().includes(q) || d.department_name.toLowerCase().includes(q));

    if (filtered.length === 0) {
      getById('content').innerHTML = emptyState();
      return;
    }

    const rows = filtered.map(d => {
      const noEmp = d.employee_count === 0 ? 'no-employees' : '';
      return [
        '<tr class="' + noEmp + '" onclick="openEditDept(\'' + escapeAttr(d.department_id) + '\')" style="cursor:pointer">',
          '<td><span class="id-mono">' + escapeHtml(d.department_id) + '</span></td>',
          '<td>',
            '<div class="row-name">' + escapeHtml(d.department_name) + '</div>',
            d.description ? '<div class="row-desc">' + escapeHtml(d.description) + '</div>' : '',
          '</td>',
          '<td>',
            '<div class="count-cell ' + (d.position_count === 0 ? 'zero' : '') + '">' + d.position_count + '</div>',
            '<div class="count-cell-sub" style="text-align:center">ตำแหน่ง</div>',
          '</td>',
          '<td>',
            '<div class="count-cell ' + (d.employee_count === 0 ? 'zero' : '') + '">' + d.employee_count + '</div>',
            '<div class="count-cell-sub" style="text-align:center">พนักงาน</div>',
          '</td>',
          '<td onclick="event.stopPropagation()">',
            '<div style="display:flex;gap:4px;justify-content:flex-end">',
              '<button class="btn btn-icon" onclick="openEditDept(\'' + escapeAttr(d.department_id) + '\')" title="แก้">' + ICONS.edit + '</button>',
              '<button class="btn btn-icon btn-icon-danger" onclick="removeDept(\'' + escapeAttr(d.department_id) + '\', \'' + escapeAttr(d.department_name) + '\')" title="ลบ">' + ICONS.trash + '</button>',
            '</div>',
          '</td>',
        '</tr>',
      ].join('');
    }).join('');

    getById('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th>ID</th><th>แผนก</th>',
          '<th style="width:100px;text-align:center">ตำแหน่ง</th>',
          '<th style="width:100px;text-align:center">พนักงาน</th>',
          '<th style="width:90px"></th>',
        '</tr></thead>',
        '<tbody>' + rows + '</tbody>',
      '</table>',
    ].join('');
  }

  function emptyState() {
    return '<div class="empty"><div class="empty-icon">' + ICONS.briefcase + '</div><div class="empty-title">ไม่พบรายการ</div><div class="empty-sub">เพิ่มใหม่ด้วยปุ่ม + ด้านบน</div></div>';
  }

  // === Modal switching by view ===
  function openAdd() {
    getById('modal-bg').classList.add('active');
    getById('modal-body-pos').style.display = currentView === 'pos' ? '' : 'none';
    getById('modal-body-dept').style.display = currentView === 'dept' ? '' : 'none';

    if (currentView === 'pos') {
      getById('modal-title').textContent = 'เพิ่มตำแหน่ง';
      getById('modal-sub').textContent = 'กรอก ID + ชื่อ + แผนก ให้ครบ';
      getById('m-pos-id-existing').value = '';
      getById('m-pos-id').value = '';
      getById('m-pos-id').disabled = false;
      getById('m-pos-name').value = '';
      getById('m-pos-dept').value = '';
      getById('m-pos-level').value = 'L1';
      getById('m-pos-mgmt').checked = false;
      getById('m-pos-desc').value = '';
      getById('m-pos-hq').checked = false;
      getById('m-pos-docs').value = '';
      getById('m-pos-salary').value = '';
      getById('m-pos-hourly').value = '';
      getById('m-pos-df').value = '';
      getById('m-pos-case-target').value = '';
      getById('m-pos-mbti').checked = false;
      getById('m-pos-benefits').value = '';
      getById('m-pos-hero').value = '';
    } else {
      getById('modal-title').textContent = 'เพิ่มแผนก';
      getById('modal-sub').textContent = 'กรอก Department ID + ชื่อ';
      getById('m-dept-id-existing').value = '';
      getById('m-dept-id').value = '';
      getById('m-dept-id').disabled = false;
      getById('m-dept-name').value = '';
      getById('m-dept-desc').value = '';
    }
  }

  function openEditPos(id) {
    const p = (allData.positions || []).find(x => x.position_id === id);
    if (!p) { showToast('ไม่พบ', 'error'); return; }
    setView('pos');
    getById('modal-bg').classList.add('active');
    getById('modal-body-pos').style.display = '';
    getById('modal-body-dept').style.display = 'none';
    getById('modal-title').textContent = 'แก้ไข ' + p.position_id;
    getById('modal-sub').textContent = p.employee_count + ' พนักงานใช้ตำแหน่งนี้อยู่';
    getById('m-pos-id-existing').value = p.position_id;
    getById('m-pos-id').value = p.position_id;
    getById('m-pos-id').disabled = true;
    getById('m-pos-name').value = p.name;
    getById('m-pos-dept').value = p.department_id;
    getById('m-pos-level').value = p.level;
    getById('m-pos-mgmt').checked = p.is_management;
    getById('m-pos-desc').value = p.description;
    getById('m-pos-hq').checked = !!p.is_hq;
    getById('m-pos-docs').value = p.required_documents || '';
    getById('m-pos-salary').value = p.salary_range || '';
    getById('m-pos-hourly').value = p.hourly_rate || '';
    getById('m-pos-df').value = p.df_range || '';
    getById('m-pos-case-target').value = p.monthly_case_target || '';
    getById('m-pos-mbti').checked = !!p.requires_mbti;
    getById('m-pos-benefits').value = p.benefits_list || '';
    getById('m-pos-hero').value = p.hero_image_url || '';
  }

  function openEditDept(id) {
    const d = (allData.departments || []).find(x => x.department_id === id);
    if (!d) { showToast('ไม่พบ', 'error'); return; }
    setView('dept');
    getById('modal-bg').classList.add('active');
    getById('modal-body-pos').style.display = 'none';
    getById('modal-body-dept').style.display = '';
    getById('modal-title').textContent = 'แก้ไข ' + d.department_id;
    getById('modal-sub').textContent = d.position_count + ' ตำแหน่ง · ' + d.employee_count + ' พนักงาน';
    getById('m-dept-id-existing').value = d.department_id;
    getById('m-dept-id').value = d.department_id;
    getById('m-dept-id').disabled = true;
    getById('m-dept-name').value = d.department_name;
    getById('m-dept-desc').value = d.description;
  }

  function closeModal() { getById('modal-bg').classList.remove('active'); }

  function saveItem() {
    getById('save-btn').disabled = true;
    if (currentView === 'pos') {
      const isEdit = !!getById('m-pos-id-existing').value;
      const id = isEdit ? getById('m-pos-id-existing').value
                        : (getById('m-pos-id').value || '').trim().toUpperCase();
      const payload = {
        position_id: id,
        name: getById('m-pos-name').value.trim(),
        department_id: getById('m-pos-dept').value,
        level: getById('m-pos-level').value,
        is_management: getById('m-pos-mgmt').checked,
        description: getById('m-pos-desc').value.trim(),
        is_hq: getById('m-pos-hq').checked,
        required_documents: getById('m-pos-docs').value.trim(),
        salary_range: getById('m-pos-salary').value.trim(),
        hourly_rate: getById('m-pos-hourly').value.trim(),
        df_range: getById('m-pos-df').value.trim(),
        monthly_case_target: getById('m-pos-case-target').value.trim(),
        requires_mbti: getById('m-pos-mbti').checked,
        benefits_list: getById('m-pos-benefits').value.trim(),
        hero_image_url: getById('m-pos-hero').value.trim(),
      };
      if (!payload.position_id || !payload.name) { onSaveErr({message: 'กรอก ID + ชื่อ'}); return; }
      const fn = isEdit ? 'positionAdminUpdatePosition' : 'positionAdminAddPosition';
      google.script.run
        .withSuccessHandler(r => onSaveDone(r, isEdit ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว'))
        .withFailureHandler(onSaveErr)
        [fn](isEdit ? id : payload, isEdit ? payload : undefined);
    } else {
      const isEdit = !!getById('m-dept-id-existing').value;
      const id = isEdit ? getById('m-dept-id-existing').value
                        : (getById('m-dept-id').value || '').trim().toUpperCase();
      const payload = {
        department_id: id,
        department_name: getById('m-dept-name').value.trim(),
        description: getById('m-dept-desc').value.trim(),
      };
      if (!payload.department_id || !payload.department_name) { onSaveErr({message: 'กรอก ID + ชื่อ'}); return; }
      const fn = isEdit ? 'positionAdminUpdateDepartment' : 'positionAdminAddDepartment';
      google.script.run
        .withSuccessHandler(r => onSaveDone(r, isEdit ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว'))
        .withFailureHandler(onSaveErr)
        [fn](isEdit ? id : payload, isEdit ? payload : undefined);
    }
  }

  function onSaveDone(r, msg) {
    getById('save-btn').disabled = false;
    if (r && r.error) { showToast(r.error, 'error'); return; }
    closeModal();
    showToast(msg, 'success');
    loadList();
  }
  function onSaveErr(e) {
    getById('save-btn').disabled = false;
    showToast('Error: ' + e.message, 'error');
  }

  function removePos(id, name) {
    if (!confirm('ลบตำแหน่ง "' + name + '" (' + id + ') ?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('ลบแล้ว', 'success'); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .positionAdminRemovePosition(id);
  }

  function removeDept(id, name) {
    if (!confirm('ลบแผนก "' + name + '" (' + id + ') ?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('ลบแล้ว', 'success'); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .positionAdminRemoveDepartment(id);
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList, setView, openAdd,
    openEditPos, openEditDept, closeModal, saveItem,
    removePos, removeDept, renderList,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadList();
}

/* expose mount */
if (typeof window !== 'undefined') window.mountPosition = mountPosition;
