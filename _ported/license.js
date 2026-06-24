// _ported/license.js — FULL native port of desktop license_manager.html (HR Announcement admin)
// ลอกทั้งดุ้น (gold template = _ported/announce.js):
//   CSS เดิม (:root tokens + <style> license_manager) prefix ทุก selector ด้วย #lc
//   markup เดิม คง element id เดิม (stExpired/stNext7/stNext30/stActive · tabs · search · filterCategory ·
//     rowCount · tableWrap · modalBg/modalTitle/modalBody · fEmp/fType/fNum/fAuth/fIssue/fExpiry/fUrl/fNotes)
//   JS หน้าเดิม รันใน closure scope ของ mountLicense() · google.script.run = shim → LC_BACKEND (Supabase)
//
// ใช้ global sb (supabase client) + esc + $ จาก index.html module scope — ห้าม redeclare
// fn/var ที่ inline onclick ต้องใช้ → ผูกกับ window ภายใน LC_RUN_PAGE_JS · prefix lc/LC_/lc2
//
// backend (edge fn hr_list?type=license.updated → {items}) ตามกฎ:
//   list   → sb.functions.invoke('hr_list?type=license.updated') → { items:[...] }
//            payload ต่อ license: license_id/employee_id/type/expiry/status/...
//            หน้าเดิมคาด { ok, rows, counts, license_types } → shim derive band/days/counts ฝั่ง client
//            ว่าง = 0 รายการ → render empty state ได้ ไม่ error
//   whoami → { ok:true, is_owner:true } (dashboard user = admin เต็มสิทธิ์)
//   add/renew/upsert · send reminder · bulk remind · today summary →
//            backend เขียนกลับ/LINE ยังไม่พร้อม → stub + toast (คืน ok ให้ modal ปิด/flow ทำงานต่อได้)

/* ============================================================
   LC_BACKEND — map google.script.run → Supabase edge fn hr_list (type=license.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     licenseAdminList(opts)        → { ok, rows:[...], counts:{...}, license_types:[...] }
     licenseAdminTodaySummary()    → { ok, expired, next7, next30 }
     licenseAdminSendReminder(id)  → { ok, stage }            (stub)
     licenseAdminBulkRemind(ids)   → { ok, sent, failed }     (stub)
     licenseAdminUpsert(payload)   → { ok }                   (stub)
   ============================================================ */
var LC_FN = 'hr_list';
var LC_TYPE = 'license.updated';

// license type catalog (mirror หน้าเดิม license_types · key/th/en/category)
var LC_TYPES = [
  { key: 'medical_license', th: 'ใบประกอบวิชาชีพเวชกรรม', en: 'Medical License', category: 'professional' },
  { key: 'nursing_license', th: 'ใบประกอบวิชาชีพการพยาบาล', en: 'Nursing License', category: 'professional' },
  { key: 'pt_license', th: 'ใบประกอบวิชาชีพกายภาพบำบัด', en: 'Physical Therapy License', category: 'professional' },
  { key: 'pharmacy_license', th: 'ใบประกอบวิชาชีพเภสัชกรรม', en: 'Pharmacy License', category: 'professional' },
  { key: 'clinical_cert', th: 'ใบรับรองคลินิก', en: 'Clinical Certificate', category: 'clinical' },
  { key: 'bls_acls', th: 'BLS / ACLS', en: 'BLS / ACLS', category: 'clinical' },
  { key: 'compliance_training', th: 'อบรม Compliance', en: 'Compliance Training', category: 'compliance' },
  { key: 'fire_safety', th: 'อบรมดับเพลิง / ความปลอดภัย', en: 'Fire & Safety', category: 'compliance' },
  { key: 'id_card', th: 'บัตรประชาชน', en: 'ID Card', category: 'personal' },
  { key: 'work_permit', th: 'ใบอนุญาตทำงาน', en: 'Work Permit', category: 'personal' },
  { key: 'driving_license', th: 'ใบขับขี่', en: 'Driving License', category: 'operational' },
  { key: 'other', th: 'อื่น ๆ', en: 'Other', category: 'operational' },
];
function lc2TypeMeta(key) {
  for (var i = 0; i < LC_TYPES.length; i++) if (LC_TYPES[i].key === key) return LC_TYPES[i];
  return { key: key || '', th: key || '—', en: key || '', category: 'operational' };
}

function lc2ToBool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
// parse date (YYYY-MM-DD หรือ ISO) → Date ที่เที่ยงคืน local · null ถ้าไม่ valid
function lc2ParseDate(v) {
  if (!v) return null;
  var s = String(v).slice(0, 10);
  var d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}
function lc2DaysTo(expiry) {
  var d = lc2ParseDate(expiry);
  if (!d) return null;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}
// derive status/band จาก expiry + status เดิม (active/expiring_soon/expired/archived/suspended)
function lc2DeriveStatus(p, days) {
  var raw = String(p.status || '').toLowerCase().trim();
  if (raw === 'archived' || raw === 'suspended') return raw;
  if (days == null) return raw || 'active';
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring_soon';
  return 'active';
}
function lc2Band(status, days) {
  if (status === 'archived' || status === 'suspended') return 'gray';
  if (status === 'expired') return 'red';
  if (days != null && days <= 7) return 'orange';
  if (status === 'expiring_soon') return 'amber';
  return 'green';
}

// normalize payload (จาก hr_list items) → row shape ที่ JS เดิมใช้
function lc2MapRow(p) {
  p = p || {};
  var typeKey = p.license_type || p.type || '';
  var meta = lc2TypeMeta(typeKey);
  var expiry = p.expiry_date || p.expiry || '';
  if (expiry) expiry = String(expiry).slice(0, 10);
  var issue = p.issue_date || p.issued_date || '';
  if (issue) issue = String(issue).slice(0, 10);
  var days = lc2DaysTo(expiry);
  var status = lc2DeriveStatus(p, days);
  var band = lc2Band(status, days);
  return {
    license_id: p.license_id || p.id || '',
    employee_id: p.employee_id || '',
    employee_name: p.employee_name || p.emp_name || p.employee_id || '—',
    employee_position: p.employee_position || p.position_name || p.position || '',
    license_type: typeKey,
    license_type_label: p.license_type_label || meta.th,
    license_type_en: p.license_type_en || meta.en,
    category: p.category || meta.category,
    license_number: p.license_number || p.number || '',
    issuing_authority: p.issuing_authority || p.authority || '',
    issue_date: issue,
    expiry_date: expiry,
    days_to_expiry: days,
    status: status,
    band: band,
    attachment_url: p.attachment_url || p.cert_url || '',
    notes: p.notes || '',
    last_reminded_at: p.last_reminded_at || '',
    last_reminded_stage: p.last_reminded_stage || '',
  };
}

// filter ตาม tab/search/category (mirror LicenseAdmin.list ของเดิม) → rows ที่จะ render
function lc2Filter(rows, opts) {
  opts = opts || {};
  var tab = opts.tab || 'all';
  var search = String(opts.search || '').toLowerCase().trim();
  var cat = opts.category || '';
  return rows.filter(function (r) {
    if (tab === 'expired' && r.status !== 'expired') return false;
    else if (tab === 'expiring_soon' && r.status !== 'expiring_soon') return false;
    else if (tab === 'active' && r.status !== 'active') return false;
    else if (tab === 'archived' && r.status !== 'archived') return false;
    // tab === 'all' → ไม่กรองสถานะ
    if (cat && r.category !== cat) return false;
    if (search) {
      var hay = (r.employee_name + ' ' + r.license_number + ' ' + r.license_type_label + ' ' +
        r.license_type_en + ' ' + r.issuing_authority).toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  });
}
// counts ต่อ tab จาก rows ทั้งหมด (ไม่กรอง search/category — ให้ตัวเลข tab นิ่ง)
function lc2Counts(rows) {
  return {
    expired: rows.filter(function (r) { return r.status === 'expired'; }).length,
    expiring_soon: rows.filter(function (r) { return r.status === 'expiring_soon'; }).length,
    active: rows.filter(function (r) { return r.status === 'active'; }).length,
    archived: rows.filter(function (r) { return r.status === 'archived'; }).length,
    all: rows.length,
  };
}

// ดึง items ล่าสุดจาก hr_list → map เป็น rows (cache ต่อ mount เพื่อ filter ฝั่ง client เร็ว)
var _lc2RowsCache = null;
function lc2FetchRows() {
  return sb.functions.invoke(LC_FN + '?type=' + encodeURIComponent(LC_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = data.items || data.rows || [];
    var rows = items.map(lc2MapRow);
    _lc2RowsCache = rows;
    return rows;
  });
}

var LC_BACKEND = {
  // role gate — dashboard user = admin/owner เต็มสิทธิ์
  licenseAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },
  // list — { ok, rows, counts, license_types }
  licenseAdminList: function (opts) {
    return lc2FetchRows().then(function (rows) {
      return {
        ok: true,
        rows: lc2Filter(rows, opts),
        counts: lc2Counts(rows),
        license_types: LC_TYPES,
      };
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    });
  },
  // today summary stat cards (expired / next7 / next30)
  licenseAdminTodaySummary: function () {
    var p = _lc2RowsCache ? Promise.resolve(_lc2RowsCache) : lc2FetchRows();
    return p.then(function (rows) {
      var expired = 0, next7 = 0, next30 = 0;
      rows.forEach(function (r) {
        if (r.status === 'archived' || r.status === 'suspended') return;
        var d = r.days_to_expiry;
        if (d == null) return;
        if (d < 0) expired++;
        else if (d <= 7) next7++;
        else if (d <= 30) next30++;
      });
      return { ok: true, expired: expired, next7: next7, next30: next30 };
    }).catch(function () { return { ok: false, expired: 0, next7: 0, next30: 0 }; });
  },
  // send single reminder — stub (ไม่มี LINE multicast บน dashboard)
  licenseAdminSendReminder: function () {
    lc2NotReady('ส่ง LINE reminder');
    return Promise.resolve({ ok: false, error: 'ส่ง LINE reminder ยังไม่พร้อมบน dashboard' });
  },
  // bulk remind — stub
  licenseAdminBulkRemind: function (ids) {
    lc2NotReady('ส่ง LINE reminder (bulk)');
    return Promise.resolve({ ok: false, sent: 0, failed: (ids || []).length, error: 'ส่ง LINE reminder ยังไม่พร้อมบน dashboard' });
  },
  // upsert (add/edit) — stub (backend เขียนกลับยังไม่พร้อม)
  licenseAdminUpsert: function () {
    lc2NotReady('บันทึกใบรับรอง');
    return Promise.resolve({ ok: false, error: 'บันทึก/เพิ่มใบรับรองยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _lc2NotReadyShown = {};
function lc2NotReady(feature) {
  if (_lc2NotReadyShown[feature]) return;
  _lc2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.lc2Toast) window.lc2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountLicense — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountLicense() {
  if (!document.getElementById('wrap-license')) return;
  var wrap = document.getElementById('wrap-license');
  wrap.innerHTML = '<style>' + LC_CSS() + '</style><div id="lc">' + LC_MARKUP() + '</div>';
  LC_RUN_PAGE_JS();
}

/* ===== CSS เดิม (:root tokens + <style> license_manager) · prefix ทุก selector ด้วย #lc =====
   ตัด .app-shell/.main-area/.page-head/.topbar shell + body rules (dashboard มี shell แล้ว) · คง class เดิม */
function LC_CSS() {
  return [
    // tokens (จาก :root หน้า manager)
    '#lc{--navy:#0D2F4F;--navy-soft:#1E40AF;--teal:#3DC5B7;--teal-light:#E6F7F5;--teal-dark:#0F766E;--bg:#F8F9FA;--text:#333;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--warn:#F59E0B;--orange:#EA580C;--success:#16A34A;color:var(--text);font-size:14px;line-height:1.5}',
    '#lc *,#lc *::before,#lc *::after{box-sizing:border-box}',
    // top toolbar
    '#lc .top{background:var(--navy);color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-radius:10px 10px 0 0}',
    '#lc .top-left{display:flex;align-items:center;gap:12px}',
    '#lc .top-title{font-size:16px;font-weight:600}',
    '#lc .top-badge{background:var(--teal);color:#fff;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600;letter-spacing:.5px}',
    '#lc .top-actions{display:flex;gap:8px}',
    '#lc .btn{padding:8px 14px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;border:none;font-family:inherit}',
    '#lc .btn-primary{background:var(--teal);color:#fff}',
    '#lc .btn-primary:hover{background:var(--teal-dark)}',
    '#lc .btn-secondary{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2)}',
    '#lc .btn-secondary:hover{background:rgba(255,255,255,.2)}',
    // stats row
    '#lc .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 20px;background:var(--bg)}',
    '#lc .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;display:flex;gap:12px;align-items:center;position:relative;overflow:hidden}',
    '#lc .stat-card.expired{border-left:3px solid var(--error)}',
    '#lc .stat-card.next7{border-left:3px solid var(--orange)}',
    '#lc .stat-card.next30{border-left:3px solid var(--warn)}',
    '#lc .stat-card.active{border-left:3px solid var(--success)}',
    '#lc .stat-num{font-size:28px;font-weight:600;color:var(--navy);line-height:1}',
    '#lc .stat-label{font-size:11px;color:var(--muted);margin-top:2px}',
    // tabs
    '#lc .tabs{display:flex;gap:2px;padding:0 20px;border-bottom:1px solid var(--border);background:#fff;overflow-x:auto}',
    '#lc .tab{padding:11px 16px;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;font-weight:500;white-space:nowrap}',
    '#lc .tab:hover{color:var(--navy)}',
    '#lc .tab.active{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    '#lc .tab-count{background:var(--bg);color:var(--muted);padding:1px 7px;border-radius:99px;font-size:10px;margin-left:5px;font-weight:600}',
    '#lc .tab.active .tab-count{background:var(--teal-light);color:var(--teal-dark)}',
    // filters
    '#lc .filters{padding:14px 20px;background:#fff;border-bottom:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
    '#lc .input,#lc .select{padding:7px 11px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;color:var(--navy);background:#fff}',
    '#lc .input:focus,#lc .select:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#lc .filter-spacer{flex:1}',
    // table
    '#lc .table-wrap{padding:14px 20px}',
    '#lc table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)}',
    '#lc th{background:var(--navy);color:#fff;text-align:left;padding:11px 12px;font-size:11px;font-weight:600;letter-spacing:.3px;text-transform:uppercase}',
    '#lc td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border);color:var(--navy);vertical-align:middle}',
    '#lc tr:hover td{background:var(--teal-light)}',
    '#lc .emp{display:flex;gap:9px;align-items:center}',
    '#lc .emp-av{width:30px;height:30px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}',
    '#lc .emp-name{font-weight:500}',
    '#lc .emp-pos{font-size:10px;color:var(--muted)}',
    '#lc .lic-type{display:flex;flex-direction:column}',
    '#lc .lic-type-th{font-weight:500}',
    '#lc .lic-type-en{font-size:10px;color:var(--muted)}',
    '#lc .lic-num{font-family:ui-monospace,monospace;font-size:11px;color:var(--muted)}',
    '#lc .pill{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10px;font-weight:600}',
    '#lc .pill-dot{width:6px;height:6px;border-radius:50%}',
    '#lc .pill.green{background:#D1FAE5;color:#047857}#lc .pill.green .pill-dot{background:#10B981}',
    '#lc .pill.amber{background:#FEF3C7;color:#B45309}#lc .pill.amber .pill-dot{background:#F59E0B}',
    '#lc .pill.orange{background:#FED7AA;color:#9A3412}#lc .pill.orange .pill-dot{background:#EA580C}',
    '#lc .pill.red{background:#FEE2E2;color:#B91C1C}#lc .pill.red .pill-dot{background:#DC2626}',
    '#lc .pill.gray{background:#F3F4F6;color:#4B5563}#lc .pill.gray .pill-dot{background:#9CA3AF}',
    '#lc .days{font-size:11px;color:var(--muted)}',
    '#lc .row-actions{display:flex;gap:6px}',
    '#lc .btn-row{padding:5px 10px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:#fff;color:var(--navy);font-family:inherit;text-decoration:none;display:inline-flex;align-items:center}',
    '#lc .btn-row:hover{background:var(--teal-light);border-color:var(--teal);color:var(--teal-dark)}',
    '#lc .btn-row.send{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#lc .btn-row.send:hover{background:var(--teal-dark)}',
    // modal (scope ใต้ #lc · z-index สูง · fixed)
    '#lc .modal-bg{display:none;position:fixed;inset:0;background:rgba(13,47,79,.6);z-index:9000;align-items:center;justify-content:center;padding:20px}',
    '#lc .modal-bg.open{display:flex}',
    '#lc .modal{background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto}',
    '#lc .modal-header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
    '#lc .modal-title{font-size:15px;font-weight:600;color:var(--navy)}',
    '#lc .modal-close{background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer;line-height:1}',
    '#lc .modal-body{padding:16px 20px}',
    '#lc .field{margin-bottom:12px}',
    '#lc .field-label{display:block;font-size:11px;font-weight:600;color:var(--navy);margin-bottom:5px;letter-spacing:.3px}',
    '#lc .field-label .req{color:var(--error)}',
    '#lc .field-input{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;color:var(--navy)}',
    '#lc .field-input:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#lc .modal-footer{padding:14px 20px;border-top:1px solid var(--border);display:flex;gap:9px;justify-content:flex-end}',
    // empty / loading
    '#lc .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    '#lc .empty-icon{width:60px;height:60px;border-radius:50%;background:var(--teal-light);color:var(--teal-dark);display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 14px}',
    '#lc .loading{padding:40px 20px;text-align:center;color:var(--muted)}',
    '@media (max-width:768px){#lc .stats{grid-template-columns:repeat(2,1fr)}}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก section + modal · คง element id เดิม =====
   ตัด sidebar/sheet_link/brand_footer/page-head/yh-page-actions shell */
function LC_MARKUP() {
  return ''
    + '<div class="top">'
    + '  <div class="top-left">'
    + '    <div class="top-title">License Manager</div>'
    + '    <div class="top-badge">LIC</div>'
    + '  </div>'
    + '  <div class="top-actions">'
    + '    <button class="btn btn-secondary" onclick="bulkRemind()" id="bulkBtn">ส่ง reminder ทั้งหมด (visible)</button>'
    + '    <button class="btn btn-primary" onclick="openAddModal()">+ เพิ่มใบรับรอง</button>'
    + '  </div>'
    + '</div>'
    + '<div class="stats" id="stats">'
    + '  <div class="stat-card expired"><div><div class="stat-num" id="stExpired">–</div><div class="stat-label">หมดอายุแล้ว</div></div></div>'
    + '  <div class="stat-card next7"><div><div class="stat-num" id="stNext7">–</div><div class="stat-label">หมดใน 7 วัน</div></div></div>'
    + '  <div class="stat-card next30"><div><div class="stat-num" id="stNext30">–</div><div class="stat-label">หมดใน 30 วัน</div></div></div>'
    + '  <div class="stat-card active"><div><div class="stat-num" id="stActive">–</div><div class="stat-label">ใช้งานปกติ</div></div></div>'
    + '</div>'
    + '<div class="tabs" id="tabs"></div>'
    + '<div class="filters">'
    + '  <input type="search" class="input" id="search" placeholder="ค้นหา · ชื่อพนักงาน / เลขที่ / ประเภท" oninput="reload()" style="min-width:240px;">'
    + '  <select class="select" id="filterCategory" onchange="reload()">'
    + '    <option value="">ทุกประเภท</option>'
    + '    <option value="professional">Professional license</option>'
    + '    <option value="clinical">Clinical cert</option>'
    + '    <option value="compliance">Compliance training</option>'
    + '    <option value="personal">Personal doc</option>'
    + '    <option value="operational">Operational</option>'
    + '  </select>'
    + '  <div class="filter-spacer"></div>'
    + '  <span style="font-size:11px; color:var(--muted);" id="rowCount">–</span>'
    + '</div>'
    + '<div class="table-wrap" id="tableWrap"><div class="loading">กำลังโหลด...</div></div>'
    // Add/Edit modal
    + '<div class="modal-bg" id="modalBg" onclick="if(event.target===this)closeModal()">'
    + '  <div class="modal">'
    + '    <div class="modal-header">'
    + '      <div class="modal-title" id="modalTitle">เพิ่มใบรับรอง</div>'
    + '      <button class="modal-close" onclick="closeModal()">×</button>'
    + '    </div>'
    + '    <div class="modal-body" id="modalBody"></div>'
    + '    <div class="modal-footer">'
    + '      <button class="btn btn-secondary" style="background:var(--bg); color:var(--navy); border:1px solid var(--border);" onclick="closeModal()">ยกเลิก</button>'
    + '      <button class="btn btn-primary" onclick="saveLicense()">บันทึก</button>'
    + '    </div>'
    + '  </div>'
    + '</div>';
}

/* ============================================================
   LC_RUN_PAGE_JS — รัน JS หน้าเดิม (license_manager) ลอกทั้งดุ้น
   closure scope · google.script.run = shim → LC_BACKEND · ผูก fn inline ลง window
   ============================================================ */
function LC_RUN_PAGE_JS() {

  // ---- google.script.run shim → LC_BACKEND (async · คืน shape เดิม) ----
  function _lc2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (LC_BACKEND[prop]) {
            Promise.resolve().then(function () { return LC_BACKEND[prop].apply(LC_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[LC_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[LC_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _lc2MakeChain(); } });

  // ---- toast (แทน alert ของหน้าเดิมบางจุด · ใช้สำหรับ stub backend) ----
  function showToast(msg, type) {
    var t = document.getElementById('lc2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'lc2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#DC2626' : type === 'success' ? '#16A34A' : '#0D2F4F';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.lc2Toast = showToast;

  /* ====================== JS หน้าเดิม (license_manager) — ลอกทั้งดุ้น ====================== */
  var _state = { tab: 'expired', rows: [], counts: {}, types: [], editing: null };

  function init() {
    reload();
    google.script.run.withSuccessHandler(function (s) {
      if (!s || !s.ok) return;
      document.getElementById('stExpired').textContent = s.expired || 0;
      document.getElementById('stNext7').textContent = s.next7 || 0;
      document.getElementById('stNext30').textContent = s.next30 || 0;
    }).licenseAdminTodaySummary();
  }

  function reload() {
    var opts = {
      tab: _state.tab,
      search: document.getElementById('search').value,
      category: document.getElementById('filterCategory').value,
    };
    document.getElementById('tableWrap').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(onLoaded).withFailureHandler(onError).licenseAdminList(opts);
  }
  function onError(e) {
    document.getElementById('tableWrap').innerHTML =
      '<div class="empty">โหลดข้อมูลล้มเหลว · ' + esc((e && e.message) || e) + '</div>';
  }
  function onLoaded(res) {
    if (!res || !res.ok) return onError(new Error((res && res.error) || 'unknown'));
    _state.rows = res.rows || [];
    _state.counts = res.counts || {};
    _state.types = res.license_types || [];
    document.getElementById('stActive').textContent = _state.counts.active || 0;
    renderTabs();
    renderTable();
  }

  function renderTabs() {
    var c = _state.counts;
    var tabs = [
      { k: 'expired', label: 'หมดอายุ', count: c.expired || 0 },
      { k: 'expiring_soon', label: 'ใกล้หมดอายุ', count: c.expiring_soon || 0 },
      { k: 'active', label: 'ใช้งานปกติ', count: c.active || 0 },
      { k: 'archived', label: 'เก็บถาวร', count: c.archived || 0 },
      { k: 'all', label: 'ทั้งหมด', count: c.all || 0 },
    ];
    document.getElementById('tabs').innerHTML = tabs.map(function (t) {
      return '<div class="tab ' + (_state.tab === t.k ? 'active' : '') + '" onclick="setTab(\'' + t.k + '\')">' + esc(t.label) + ' <span class="tab-count">' + t.count + '</span></div>';
    }).join('');
  }
  function setTab(k) { _state.tab = k; reload(); }

  function renderTable() {
    document.getElementById('rowCount').textContent = _state.rows.length + ' รายการ';
    if (!_state.rows.length) {
      document.getElementById('tableWrap').innerHTML =
        '<div class="empty"><div class="empty-icon">✓</div><div>ไม่มีใบรับรองที่ตรงเงื่อนไข</div></div>';
      return;
    }
    var html = '<table><thead><tr>'
      + '<th>พนักงาน</th><th>ประเภท</th><th>เลขที่</th>'
      + '<th>วันหมดอายุ</th><th>สถานะ</th><th>เตือนล่าสุด</th><th>Actions</th>'
      + '</tr></thead><tbody>';
    html += _state.rows.map(function (r) {
      return '<tr>'
        + '<td><div class="emp">'
        + '<div class="emp-av">' + esc((r.employee_name || '?').charAt(0)) + '</div>'
        + '<div><div class="emp-name">' + esc(r.employee_name) + '</div>'
        + '<div class="emp-pos">' + esc(r.employee_position) + '</div></div>'
        + '</div></td>'
        + '<td><div class="lic-type">'
        + '<div class="lic-type-th">' + esc(r.license_type_label) + '</div>'
        + '<div class="lic-type-en">' + esc(r.category) + ' · ' + esc(r.license_type_en) + '</div>'
        + '</div></td>'
        + '<td><div class="lic-num">' + esc(r.license_number || '—') + '</div>'
        + '<div style="font-size:10px; color:var(--muted);">' + esc(r.issuing_authority || '') + '</div></td>'
        + '<td>' + esc(r.expiry_date || '—')
        + (r.days_to_expiry != null ? '<div class="days">' + (r.days_to_expiry >= 0 ? 'อีก ' + r.days_to_expiry + ' วัน' : 'เลย ' + Math.abs(r.days_to_expiry) + ' วัน') + '</div>' : '')
        + '</td>'
        + '<td><span class="pill ' + esc(r.band) + '"><span class="pill-dot"></span>' + esc(statusLabel(r.status)) + '</span></td>'
        + '<td>' + esc(r.last_reminded_at || '—') + '<div style="font-size:10px;color:var(--muted);">' + esc(r.last_reminded_stage) + '</div></td>'
        + '<td><div class="row-actions">'
        + (r.status !== 'archived' ? '<button class="btn-row send" onclick="sendReminder(\'' + esc(r.license_id) + '\')">เตือน</button>' : '')
        + '<button class="btn-row" onclick="openEdit(\'' + esc(r.license_id) + '\')">แก้ไข</button>'
        + (r.attachment_url ? '<a class="btn-row" href="' + esc(r.attachment_url) + '" target="_blank">ดู cert</a>' : '')
        + '</div></td>'
        + '</tr>';
    }).join('');
    html += '</tbody></table>';
    document.getElementById('tableWrap').innerHTML = html;
  }

  function statusLabel(s) {
    return s === 'active' ? 'ใช้งานปกติ' : s === 'expiring_soon' ? 'ใกล้หมด' :
      s === 'expired' ? 'หมดอายุ' : s === 'archived' ? 'เก็บถาวร' :
      s === 'suspended' ? 'ระงับ' : s;
  }

  function sendReminder(id) {
    if (!confirm('ส่ง LINE reminder ให้พนักงานคนนี้?')) return;
    google.script.run.withSuccessHandler(function (r) {
      showToast(r && r.ok ? 'ส่งแล้ว · stage ' + r.stage : ('ส่งล้มเหลว' + (r && r.error ? ' · ' + r.error : '')), r && r.ok ? 'success' : 'error');
      reload();
    }).licenseAdminSendReminder(id);
  }

  function bulkRemind() {
    var ids = _state.rows.filter(function (r) { return r.status === 'expired' || r.status === 'expiring_soon'; })
      .map(function (r) { return r.license_id; });
    if (!ids.length) { showToast('ไม่มีใบที่ต้องเตือนใน view นี้', 'error'); return; }
    if (!confirm('ส่ง LINE reminder ให้ ' + ids.length + ' คน?')) return;
    document.getElementById('bulkBtn').textContent = 'กำลังส่ง...';
    google.script.run.withSuccessHandler(function (r) {
      document.getElementById('bulkBtn').textContent = 'ส่ง reminder ทั้งหมด (visible)';
      showToast(r && r.ok ? ('ส่งสำเร็จ ' + r.sent + ' · ล้มเหลว ' + r.failed) : ('ส่งล้มเหลว' + (r && r.error ? ' · ' + r.error : '')), r && r.ok ? 'success' : 'error');
      reload();
    }).licenseAdminBulkRemind(ids);
  }

  function openAddModal() { _state.editing = null; document.getElementById('modalTitle').textContent = 'เพิ่มใบรับรอง'; renderModal({}); document.getElementById('modalBg').classList.add('open'); }
  function openEdit(id) {
    var row = _state.rows.find(function (r) { return r.license_id === id; });
    if (!row) return;
    _state.editing = row;
    document.getElementById('modalTitle').textContent = 'แก้ไข · ' + row.license_type_label;
    renderModal(row);
    document.getElementById('modalBg').classList.add('open');
  }
  function closeModal() { document.getElementById('modalBg').classList.remove('open'); _state.editing = null; }

  function renderModal(row) {
    var types = _state.types.map(function (t) {
      return '<option value="' + esc(t.key) + '" ' + (row.license_type === t.key ? 'selected' : '') + '>' + esc(t.th) + ' (' + esc(t.category) + ')</option>';
    }).join('');
    document.getElementById('modalBody').innerHTML = ''
      + '<div class="field"><label class="field-label">พนักงาน (employee_id) <span class="req">*</span></label>'
      + '<input class="field-input" id="fEmp" value="' + esc(row.employee_id || '') + '" placeholder="EMP001"></div>'
      + '<div class="field"><label class="field-label">ประเภทใบรับรอง <span class="req">*</span></label>'
      + '<select class="field-input" id="fType">' + types + '</select></div>'
      + '<div class="field"><label class="field-label">เลขที่ใบรับรอง</label>'
      + '<input class="field-input" id="fNum" value="' + esc(row.license_number || '') + '" placeholder="เลขที่หรือรหัส"></div>'
      + '<div class="field"><label class="field-label">หน่วยงานที่ออก</label>'
      + '<input class="field-input" id="fAuth" value="' + esc(row.issuing_authority || '') + '" placeholder="เช่น สภากายภาพบำบัด"></div>'
      + '<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">'
      + '<div class="field"><label class="field-label">วันที่ออก</label>'
      + '<input type="date" class="field-input" id="fIssue" value="' + esc(row.issue_date || '') + '"></div>'
      + '<div class="field"><label class="field-label">วันหมดอายุ</label>'
      + '<input type="date" class="field-input" id="fExpiry" value="' + esc(row.expiry_date || '') + '"></div>'
      + '</div>'
      + '<div class="field"><label class="field-label">URL สำเนา cert (Drive link)</label>'
      + '<input class="field-input" id="fUrl" value="' + esc(row.attachment_url || '') + '" placeholder="https://drive.google.com/..."></div>'
      + '<div class="field"><label class="field-label">หมายเหตุ</label>'
      + '<textarea class="field-input" id="fNotes" rows="2">' + esc(row.notes || '') + '</textarea></div>';
  }

  function saveLicense() {
    var payload = {
      license_id: _state.editing ? _state.editing.license_id : null,
      employee_id: document.getElementById('fEmp').value.trim(),
      license_type: document.getElementById('fType').value,
      license_number: document.getElementById('fNum').value.trim(),
      issuing_authority: document.getElementById('fAuth').value.trim(),
      issue_date: document.getElementById('fIssue').value,
      expiry_date: document.getElementById('fExpiry').value,
      attachment_url: document.getElementById('fUrl').value.trim(),
      notes: document.getElementById('fNotes').value,
    };
    if (!payload.employee_id || !payload.license_type) { showToast('กรอก employee_id และเลือกประเภท', 'error'); return; }
    google.script.run.withSuccessHandler(function (r) {
      if (r && r.ok) { closeModal(); reload(); }
      else showToast('บันทึกล้มเหลว · ' + (r && r.error ? r.error : ''), 'error');
    }).licenseAdminUpsert(payload);
  }

  // ---- expose fn ที่ inline onclick ใน markup ต้องเรียก ไปยัง window ----
  var _exp = { reload: reload, setTab: setTab, sendReminder: sendReminder, bulkRemind: bulkRemind, openAddModal: openAddModal, openEdit: openEdit, closeModal: closeModal, saveLicense: saveLicense };
  Object.keys(_exp).forEach(function (k) { window[k] = _exp[k]; });

  // ---- start ----
  init();
}

// ---- top-level fn ผูก window (ให้ index.html mount registry เรียกได้) ----
if (typeof window !== 'undefined') window.mountLicense = mountLicense;
