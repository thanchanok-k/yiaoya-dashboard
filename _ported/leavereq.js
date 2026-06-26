// _ported/leavereq.js — FULL native port of desktop leave_manager.html (HR Announcement admin)
// เทคนิคเดียวกับ announce.js: ลอก markup+CSS verbatim (scoped #lv · คง element id เดิม)
//   CSS เดิม (_shared_styles + <style> หน้า leave_manager) prefix #lv ทั้งหมด
//   JS หน้าเดิมรันใน scope ของ mountLeavereq() · google.script.run = shim → LV_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
// fn/var ที่ inline onclick ต้องใช้ → ผูกกับ window ภายใน LV_RUN_PAGE_JS
//
// backend (edge fn hr_leave_request list → {items} · hr_approve {request_id,decision}):
//   leaveAdminListPending / leaveAdminListHistory → split items client-side + คำนวณ stats/branches
//   leaveAdminGetDetail → หา item จาก list (map shape เดิม)
//   leaveAdminApprove / leaveAdminReject → hr_approve decision approved/rejected
//   feature ที่ทำ backend จริงไม่ได้ (balance รายคน, ใบรับรองแพทย์ PDPA) → stub แจ้ง "ยังไม่พร้อม"

/* ============================================================
   LV_BACKEND — map google.script.run → Supabase (hr_leave_request / hr_approve)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (อ่านจาก renderPending/renderHistory/renderBalance/showDetail)
   ============================================================ */

// แปลง raw item จาก backend → row shape ที่ JS เดิมใช้ (เติม field ที่อาจขาด)
function lv2MapRow(r) {
  r = r || {};
  var status = String(r.status || 'pending').toLowerCase();
  var leave_type = String(r.leave_type || 'other').toLowerCase();
  var start_date = r.start_date || '';
  var end_date = r.end_date || start_date;
  var warnings = lv2Warnings(r);
  return {
    request_id: r.request_id || r.id || '',
    employee_id: r.employee_id || '',
    employee_name: r.employee_name || r.employee_id || '',
    employee_position: r.employee_position || r.position || '',
    branch_id: r.branch_id || '',
    leave_type: leave_type,
    start_date: start_date,
    end_date: end_date,
    days: (r.days != null) ? r.days : '',
    reason: r.reason || '',
    note: r.note || '',
    status: status,
    submitted_at: r.submitted_at || r.created_at || '',
    approved_at: r.approved_at || '',
    half_day: lv2ToBool(r.half_day),
    backdated: lv2ToBool(r.backdated),
    attachment_url: r.attachment_url || '',
    replacement_name: r.replacement_name || '',
    replacement_employee_id: r.replacement_employee_id || '',
    approver_name: r.approver_name || '',
    approver_id: r.approver_id || '',
    approval_chain: r.approval_chain || '',
    sso_status: r.sso_status || '',
    override_warnings: r.override_warnings || warnings,
    warnings_count: r.warnings_count != null ? r.warnings_count : (warnings ? warnings.split('|').filter(Boolean).length : 0),
    balance_remaining_for_type: (r.balance_remaining_for_type != null) ? r.balance_remaining_for_type : '',
  };
}
function lv2Warnings(r) {
  if (r && r.override_warnings) return String(r.override_warnings);
  return '';
}
function lv2ToBool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

// cache รายการ items 1 รอบ ใช้ร่วม pending/history/detail · ลด round-trip
var _lv2Cache = null;
function lv2FetchAll() {
  if (_lv2Cache) return Promise.resolve(_lv2Cache);
  return sb.functions.invoke('hr_leave_request').then(function (res) {
    var data = (res && res.data) || {};
    var items = (data.items || data.requests || []).map(lv2MapRow);
    _lv2Cache = items;
    return items;
  });
}
function lv2InvalidateCache() { _lv2Cache = null; }

// branches list จาก items (id + name) — backend ไม่มี lookup เต็ม → derive จากที่มี
function lv2Branches(items) {
  var seen = {}, out = [];
  (items || []).forEach(function (r) {
    var b = (r.branch_id || '').trim();
    if (b && !seen[b]) { seen[b] = true; out.push({ id: b, name: b }); }
  });
  out.sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
  return out;
}

// apply filter (search/branch/leave_type) — mirror filter ที่ JS เดิมส่งมา
function lv2ApplyFilter(rows, filter) {
  filter = filter || {};
  var q = String(filter.search || '').trim().toLowerCase();
  return rows.filter(function (r) {
    if (filter.branch_id && (r.branch_id || '') !== filter.branch_id) return false;
    if (filter.leave_type && (r.leave_type || '') !== filter.leave_type) return false;
    if (q) {
      var hay = (String(r.request_id || '') + ' ' + String(r.employee_id || '') + ' ' +
                 String(r.employee_name || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function lv2IsPending(r) {
  var s = String(r.status || '').toLowerCase();
  return s === 'pending' || s === '';
}

// stats สำหรับ pending / history tab
function lv2RequestStats(rows) {
  var by = function (k) { return rows.filter(function (r) { return (r.leave_type || '') === k; }).length; };
  return {
    total: rows.length,
    sick: by('sick'),
    annual: by('annual'),
    personal: by('personal'),
    other: rows.length - by('sick') - by('annual') - by('personal'),
    with_warnings: rows.filter(function (r) { return (r.warnings_count || 0) > 0; }).length,
  };
}

// write-back จริง → window.sb.functions.invoke('hr_approve', {request_id, decision, note})
// คืน { ok:true } เมื่อ data.ok · { error, status } เมื่อพลาด (status 403 → caller บอก "ต้องเป็น HR")
function lv2Approve(requestId, decision, failMsg, note) {
  var sbc = (typeof window !== 'undefined' && window.sb) ? window.sb : sb;
  var body = { request_id: requestId, decision: decision };
  if (note != null && note !== '') body.note = note;
  return sbc.functions.invoke('hr_approve', { body: body }).then(function (res) {
    var err = res && res.error, data = (res && res.data) || {};
    var status = (err && (err.status || (err.context && err.context.status))) || (data && data.status) || 0;
    if (err || data.error || !data.ok) {
      return { error: (data && data.error) || (err && err.message) || failMsg, status: status };
    }
    lv2InvalidateCache();
    return { ok: true };
  });
}

var LV_BACKEND = {
  // list pending — { requests, stats, branches }
  leaveAdminListPending: function (filter) {
    return lv2FetchAll().then(function (items) {
      var pending = items.filter(lv2IsPending);
      var rows = lv2ApplyFilter(pending, filter);
      return { requests: rows, stats: lv2RequestStats(rows), branches: lv2Branches(items) };
    });
  },
  // list history (90 วัน — backend คืน items ทั้งหมด · ใช้ที่ไม่ pending) — { requests, stats, branches }
  leaveAdminListHistory: function (filter) {
    return lv2FetchAll().then(function (items) {
      var hist = items.filter(function (r) { return !lv2IsPending(r); });
      var rows = lv2ApplyFilter(hist, filter);
      return { requests: rows, stats: lv2RequestStats(rows), branches: lv2Branches(items) };
    });
  },
  // list balance — backend ไม่มี per-employee balance → stub ว่าง + แจ้ง "ยังไม่พร้อม"
  leaveAdminListBalance: function (filter) {
    filter = filter || {};
    var year = filter.year || new Date().getFullYear();
    lv2NotReady('ยอดลาคงเหลือรายคน');
    return lv2FetchAll().then(function (items) {
      return {
        balances: [],
        stats: { total_employees: 0, active: 0, low_sick: 0, low_annual: 0, year: year },
        branches: lv2Branches(items),
      };
    });
  },
  // detail — หา request จาก list (มี field ครบจาก lv2MapRow)
  leaveAdminGetDetail: function (requestId) {
    return lv2FetchAll().then(function (items) {
      var d = items.find(function (x) { return String(x.request_id) === String(requestId); });
      if (!d) return { error: 'ไม่พบคำขอลา' };
      return d;
    });
  },
  // approve → hr_approve decision=approved (write-back จริง)
  leaveAdminApprove: function (requestId) {
    return lv2Approve(requestId, 'approved', 'อนุมัติไม่สำเร็จ');
  },
  // reject → hr_approve decision=rejected (write-back จริง)
  leaveAdminReject: function (requestId, note) {
    return lv2Approve(requestId, 'rejected', 'ปฏิเสธไม่สำเร็จ', note);
  },
  // view medical cert (PDPA proxy) — backend ไม่มี proxy → stub
  leaveCertView: function () {
    lv2NotReady('ดูใบรับรองแพทย์ (PDPA)');
    return Promise.resolve({ ok: false, error: 'ดูใบรับรองแพทย์ยังไม่พร้อมบน dashboard' });
  },
  // EmpCache / nav helpers — stub (ไม่ใช้ใน dashboard scope)
  empCacheList: function () { return Promise.resolve([]); },
  navGetExecUrl: function () { return Promise.resolve(''); },
};

var _lv2NotReadyShown = {};
function lv2NotReady(feature) {
  if (_lv2NotReadyShown[feature]) return;
  _lv2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.lv2Toast) window.lv2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountLeavereq — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountLeavereq() {
  var wrap = document.getElementById('wrap-leavereq');
  if (!wrap) return;

  _lv2Cache = null; // remount = โหลดใหม่

  wrap.innerHTML = '<style>' + LV2_CSS() + '</style><div id="lv">' + LV2_MARKUP() + '</div>';

  // รัน JS หน้าเดิม (closure scope · google = shim → LV_BACKEND) → ผูก fn ที่ inline onclick ใช้ ลง window
  LV2_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles + <style> leave_manager) · prefix ทุก selector ด้วย #lv =====
   ตัด topbar/sidebar/main shell (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด */
function LV2_CSS() {
  return [
    // ---- tokens (จาก _shared_styles :root) ----
    '#lv{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;--c-public:#047857;--c-public-bg:#ECFDF5;--c-company:#6D28D9;--c-company-bg:#F5F3FF;--c-branch:#C2410C;--c-branch-bg:#FFF7ED;--c-religious:#1D4ED8;--c-religious-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#lv *{box-sizing:border-box}',

    // ---- stat cards (_shared_styles .stats/.stat) ----
    '#lv .stats{display:grid;gap:10px;margin-bottom:18px}',
    '#lv .stats.cols-2{grid-template-columns:repeat(2,1fr)}',
    '#lv .stats.cols-3{grid-template-columns:repeat(3,1fr)}',
    '#lv .stats.cols-4{grid-template-columns:repeat(4,1fr)}',
    '#lv .stats.cols-5{grid-template-columns:repeat(5,1fr)}',
    '#lv .stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;position:relative;overflow:hidden;transition:border .15s}',
    '#lv .stat:hover{border-color:var(--border-strong)}',
    '#lv .stat-stripe{position:absolute;top:0;left:0;right:0;height:2px}',
    '#lv .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}',
    '#lv .stat-value{font-size:26px;font-weight:600;color:var(--text);margin-top:4px;letter-spacing:-.03em;line-height:1}',
    '#lv .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}',

    // ---- filters (_shared_styles .filters/.filter) ----
    '#lv .filters{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:14px}',
    '#lv .filter{display:flex;flex-direction:column;gap:4px}',
    '#lv .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#lv .filter select,#lv .filter input[type=text],#lv .filter input[type=search],#lv .filter input[type=number]{height:32px;box-sizing:border-box;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);min-width:140px}',
    '#lv .filter select{padding-right:28px;cursor:pointer;appearance:none;background:var(--surface) url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2364748B\' stroke-width=\'2\'><polyline points=\'6,9 12,15 18,9\'/></svg>") no-repeat right 8px center;background-size:14px}',
    '#lv .filter select:focus,#lv .filter input:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',

    // ---- buttons (_shared_styles .btn) ----
    '#lv .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#lv .btn:hover{border-color:var(--navy)}',
    '#lv .btn svg{width:14px;height:14px}',
    '#lv .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#lv .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#lv .btn-navy{background:var(--navy);color:#fff;border-color:var(--navy)}',
    '#lv .btn-navy:hover{background:#0a2540}',
    '#lv .btn-success{background:var(--success);color:#fff;border-color:var(--success)}',
    '#lv .btn-success:hover{background:#15803D;border-color:#15803D}',
    '#lv .btn-danger{background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border)}',
    '#lv .btn-danger:hover{border-color:var(--danger)}',
    '#lv .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#lv .btn-sm{padding:5px 10px;font-size:12px}',
    '#lv .btn-icon{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;color:#475569}',

    // ---- section card (_shared_styles .section) ----
    '#lv .section{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03);margin-bottom:12px}',
    '#lv .section-header{padding:12px 18px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}',
    '#lv .section-icon{width:30px;height:30px;border-radius:6px;background:var(--info-bg);color:var(--info);display:flex;align-items:center;justify-content:center}',
    '#lv .section-icon svg{width:16px;height:16px}',
    '#lv .section-title{font-size:13px;font-weight:600;color:var(--text)}',
    '#lv .section-sub{font-size:11px;color:var(--text-muted)}',

    // ---- pills / badges (_shared_styles) ----
    '#lv .pill{padding:2px 9px;border-radius:12px;font-size:10px;font-weight:600}',
    '#lv .pill-closed,#lv .pill-danger{background:var(--danger-bg);color:var(--danger)}',
    '#lv .pill-open,#lv .pill-success{background:var(--success-bg);color:var(--success)}',
    '#lv .pill-warning{background:var(--warning-bg);color:var(--warning)}',
    '#lv .pill-info{background:var(--info-bg);color:var(--info)}',
    '#lv .pill-muted{background:#F1F5F9;color:var(--text-muted)}',
    '#lv .mono{font-family:"SF Mono",Consolas,monospace;font-size:11px}',

    // ---- modal (_shared_styles .modal) ----
    '#lv .modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;z-index:9000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}',
    '#lv .modal-bg.active{display:flex}',
    '#lv .modal{background:var(--surface);border-radius:12px;padding:0;max-width:540px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);display:flex;flex-direction:column}',
    '#lv .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}',
    '#lv .modal-header h2{font-size:16px;font-weight:600;color:var(--text);letter-spacing:-.01em}',
    '#lv .modal-header p{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#lv .modal-body{padding:20px 24px;flex:1;overflow-y:auto}',
    '#lv .modal-footer{padding:14px 24px;border-top:1px solid var(--border);background:#F8FAFC;display:flex;gap:8px;justify-content:flex-end}',

    // ---- empty / loading (_shared_styles) ----
    '#lv .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#lv .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#lv .empty-icon svg{width:24px;height:24px}',
    '#lv .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#lv .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#lv .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',

    // ---- help modal (_shared_styles · ใช้ตอน showHelp) ----
    '#lv .help-intro{padding:12px 14px;background:var(--info-bg);color:var(--info);border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px}',
    '#lv .help-section{background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid var(--border-strong)}',
    '#lv .help-section.help-section-warn{background:var(--warning-bg);border-left-color:var(--warning)}',
    '#lv .help-section.help-section-tip{background:var(--success-bg);border-left-color:var(--success)}',
    '#lv .help-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}',
    '#lv .help-section-warn .help-section-title{color:var(--warning)}',
    '#lv .help-section-tip .help-section-title{color:var(--success)}',
    '#lv .help-section-items{margin-left:18px;font-size:13px;line-height:1.7}',
    '#lv .help-section-items li{margin-bottom:4px}',

    // ============================================================
    // <style> เฉพาะหน้า leave_manager.html (prefix #lv · verbatim)
    // ============================================================
    '#lv .data-table{width:100%;border-collapse:collapse;font-size:13px}',
    '#lv .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#lv .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}',
    '#lv .data-table tbody tr{border-left:3px solid transparent;transition:background .15s}',
    '#lv .data-table tbody tr:hover{background:#FAFBFC}',
    '#lv .data-table tbody tr.has-warnings{border-left-color:var(--warning)}',
    '#lv .data-table tbody tr.backdated{border-left-color:var(--danger)}',
    '#lv .leave-type-pill{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}',
    '#lv .lt-sick{background:var(--danger-bg);color:var(--danger)}',
    '#lv .lt-annual{background:var(--c-public-bg);color:var(--c-public)}',
    '#lv .lt-personal{background:var(--c-religious-bg);color:var(--c-religious)}',
    '#lv .lt-maternity,#lv .lt-paternity{background:#FCE7F3;color:#BE185D}',
    '#lv .lt-ordination,#lv .lt-military{background:var(--c-branch-bg);color:var(--c-branch)}',
    '#lv .days-badge{display:inline-block;padding:2px 8px;border-radius:10px;background:var(--info-bg);color:var(--info);font-size:12px;font-weight:600;font-family:monospace}',
    '#lv .warn-badge{display:inline-block;padding:1px 7px;border-radius:10px;background:var(--warning-bg);color:var(--warning);font-size:10px;font-weight:600;margin-left:4px}',
    '#lv .flag-pill{padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px}',
    '#lv .flag-half{background:#DBEAFE;color:#1E40AF}',
    '#lv .flag-back{background:var(--danger-bg);color:var(--danger)}',
    '#lv .bal-bar-bg{background:#F1F5F9;border-radius:4px;height:6px;overflow:hidden;margin-top:4px}',
    '#lv .bal-bar-fill{height:100%;background:var(--success);border-radius:4px;transition:width .3s}',
    '#lv .bal-bar-fill.low{background:var(--warning)}',
    '#lv .bal-bar-fill.empty{background:var(--danger)}',
    '#lv .balance-cell{font-size:11px;color:var(--text-muted)}',
    '#lv .balance-num{font-size:14px;font-weight:600;color:var(--text);font-family:monospace}',
    '#lv .tab-row{display:flex;gap:6px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;width:fit-content}',
    '#lv .tab-btn{padding:7px 14px;border:none;background:transparent;border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}',
    '#lv .tab-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#lv .tab-btn svg{width:14px;height:14px}',
    '#lv .tab-btn .count{font-size:10px;padding:1px 7px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#lv .tab-btn.active .count{background:var(--navy)}',
    '#lv .detail-grid{display:grid;grid-template-columns:120px 1fr;gap:8px 14px;margin-bottom:16px;font-size:13px}',
    '#lv .detail-label{color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#lv .detail-value{color:var(--text)}',
    '#lv .warning-list{background:var(--warning-bg);padding:10px 12px;border-radius:6px;margin-bottom:14px}',
    '#lv .warning-list li{font-size:12px;color:var(--warning);margin-left:16px;margin-top:2px}',
    '#lv .warning-title{font-size:11px;font-weight:600;color:var(--warning);text-transform:uppercase;letter-spacing:.05em}',
    // skeleton loader (v1.10.245)
    '@keyframes lv-skeleton-shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}',
    '#lv .skel-row{height:48px;border-radius:6px;margin-bottom:8px;background:linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%);background-size:200% 100%;animation:lv-skeleton-shimmer 1.4s ease-in-out infinite}',
    '#lv .skel-block{height:14px;border-radius:4px;margin:6px 0;background:linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 50%,#F1F5F9 75%);background-size:200% 100%;animation:lv-skeleton-shimmer 1.4s ease-in-out infinite}',
    '#lv .skel-table{padding:12px}',
    '#lv .stale-badge{display:inline-block;padding:2px 8px;border-radius:99px;background:#FEF3C7;color:#92400E;font-size:10px;font-weight:600;margin-left:8px;letter-spacing:.3px}',
    // ============================================================
    // Calendar (ปฏิทิน) tab — team month grid + per-person timesheet
    // ============================================================
    '#lv .lv-cal-toolbar{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:12px}',
    '#lv .lv-cal-modes{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px}',
    '#lv .lv-cal-mode{padding:6px 14px;border:none;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;transition:all .15s}',
    '#lv .lv-cal-mode.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#lv .lv-cal-person-pick{display:flex;flex-direction:column;gap:4px}',
    '#lv .lv-cal-person-pick label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#lv .lv-cal-person-pick select{height:32px;box-sizing:border-box;padding:0 28px 0 10px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);min-width:200px;cursor:pointer}',
    '#lv .lv-cal-nav{display:flex;align-items:center;gap:8px;margin-left:auto}',
    '#lv .lv-cal-navbtn{border:1px solid var(--border-strong);border-radius:6px;background:var(--surface);font-size:18px;line-height:1;color:var(--text)}',
    '#lv .lv-cal-navbtn:hover{border-color:var(--navy)}',
    '#lv .lv-cal-monthlabel{font-size:14px;font-weight:600;color:var(--text);min-width:150px;text-align:center}',
    '#lv .lv-cal-legend{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;font-size:11px;color:var(--text-muted)}',
    '#lv .lv-cal-legend .lv-cal-leg{display:inline-flex;align-items:center;gap:5px}',
    '#lv .lv-cal-legend .lv-cal-leg .sw{width:11px;height:11px;border-radius:3px;display:inline-block}',
    '#lv .lv-cal-grid-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}',
    '#lv .lv-cal-grid{width:100%;border-collapse:separate;border-spacing:0;min-width:640px;table-layout:fixed}',
    '#lv .lv-cal-grid th{padding:6px 4px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;text-align:center;border-bottom:1px solid var(--border)}',
    '#lv .lv-cal-grid td{vertical-align:top;border:1px solid var(--border);height:96px;width:14.28%;padding:4px;background:var(--surface);position:relative}',
    '#lv .lv-cal-grid td.weekend{background:#F8FAFC}',
    '#lv .lv-cal-grid td.other-month{background:#FBFCFD}',
    '#lv .lv-cal-grid td.today{box-shadow:inset 0 0 0 2px var(--teal)}',
    '#lv .lv-cal-daynum{font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:3px}',
    '#lv .lv-cal-grid td.other-month .lv-cal-daynum{color:var(--text-faint)}',
    '#lv .lv-cal-chip{display:block;font-size:10px;font-weight:500;padding:1px 6px;border-radius:4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid transparent}',
    '#lv .lv-cal-chip.pending{opacity:.6;border-style:dashed}',
    '#lv .lv-cal-chip.more{background:#F1F5F9;color:var(--text-muted);font-weight:600}',
    '#lv .lv-cal-block{display:block;font-size:11px;font-weight:600;padding:4px 6px;border-radius:5px;border:1px solid transparent;text-align:center}',
    '#lv .lv-cal-block.pending{opacity:.6;border-style:dashed}',
    '#lv .lv-cal-dot{position:absolute;bottom:4px;right:4px;width:8px;height:8px;border-radius:50%}',
    '#lv .lv-cal-dot.present{background:var(--success)}',
    '#lv .lv-cal-dot.late{background:var(--warning)}',
    '#lv .lv-cal-dot.absent{background:var(--danger)}',
    '#lv .lv-cal-note{margin-top:10px;font-size:11px;color:var(--text-faint);font-style:italic}',
    // responsive — ตารางเลื่อนแนวนอนบนมือถือ (จาก _shared_styles @media)
    '@media (max-width:900px){#lv .stats.cols-3,#lv .stats.cols-4,#lv .stats.cols-5{grid-template-columns:repeat(2,1fr)}#lv .field-grid{grid-template-columns:1fr}#lv table{display:block;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch}#lv .lv-cal-grid{display:table;white-space:normal}#lv .lv-cal-nav{margin-left:0}#lv .lv-cal-grid td{height:80px}}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก section + detail modal · คง element id เดิม =====
   ตัด topbar / sidebar / sheet_link / brand_footer · header.page-head ก็ตัด (dashboard มี header แล้ว) */
function LV2_MARKUP() {
  return [
    '<div class="tab-row">',
    '  <button class="tab-btn active" id="tab-pending" onclick="lvSetTab(\'pending\')"></button>',
    '  <button class="tab-btn" id="tab-history" onclick="lvSetTab(\'history\')"></button>',
    '  <button class="tab-btn" id="tab-balance" onclick="lvSetTab(\'balance\')"></button>',
    '  <button class="tab-btn" id="tab-calendar" onclick="lvSetTab(\'calendar\')"></button>',
    '</div>',
    '',
    '<div class="stats cols-5" id="stats"></div>',
    '',
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ค้นหา</label>',
    '    <input type="search" id="filter-search" placeholder="ID / ชื่อพนักงาน" oninput="loadCurrent()">',
    '  </div>',
    '  <div class="filter">',
    '    <label>สาขา</label>',
    '    <select id="filter-branch" onchange="loadCurrent()"><option value="">ทุกสาขา</option></select>',
    '  </div>',
    '  <div class="filter" id="filter-type-wrap">',
    '    <label>ประเภทลา</label>',
    '    <select id="filter-type" onchange="loadCurrent()">',
    '      <option value="">ทุกประเภท</option>',
    '      <option value="sick">sick — ลาป่วย</option>',
    '      <option value="personal">personal — ลากิจ</option>',
    '      <option value="annual">annual — ลาพักร้อน</option>',
    '      <option value="maternity">maternity — ลาคลอด</option>',
    '      <option value="paternity">paternity — ลาคลอดพ่อ</option>',
    '      <option value="ordination">ordination — ลาบวช</option>',
    '      <option value="military">military — ลาทหาร</option>',
    '    </select>',
    '  </div>',
    '  <div class="filter" id="filter-year-wrap" style="display:none">',
    '    <label>ปี</label>',
    '    <select id="filter-year" onchange="loadCurrent()"></select>',
    '  </div>',
    '</div>',
    '',
    '<div class="section">',
    '  <div class="section-header">',
    '    <div class="section-icon" id="section-icon"></div>',
    '    <div style="flex:1">',
    '      <div class="section-title" id="section-title">รออนุมัติ</div>',
    '      <div class="section-sub" id="section-sub">คำขอลาที่รอการอนุมัติจากหัวหน้า</div>',
    '    </div>',
    '    <button class="btn btn-sm" onclick="_cacheInvalidate(); loadCurrent(true)" id="refresh-btn" title="โหลดสด"></button>',
    '    <button class="btn-icon" onclick="lvShowHelp(HELP)" title="ช่วยเหลือ" id="help-btn" style="border:1px solid var(--border-strong);border-radius:50%"></button>',
    '  </div>',
    '  <div id="content" class="loading">กำลังโหลด...</div>',
    '</div>',
    '',
    '<!-- Calendar (ปฏิทิน) — แยก container · แสดงเฉพาะ tab calendar -->',
    '<div id="lv-cal-wrap" style="display:none">',
    '  <div class="lv-cal-toolbar">',
    '    <div class="lv-cal-modes">',
    '      <button class="lv-cal-mode active" id="lv-cal-mode-team" onclick="lvCalSetMode(\'team\')">ทั้งทีม</button>',
    '      <button class="lv-cal-mode" id="lv-cal-mode-person" onclick="lvCalSetMode(\'person\')">รายคน</button>',
    '    </div>',
    '    <div class="lv-cal-person-pick" id="lv-cal-person-pick" style="display:none">',
    '      <label>พนักงาน</label>',
    '      <select id="lv-cal-person-sel" onchange="lvCalRender()"></select>',
    '    </div>',
    '    <div class="lv-cal-nav">',
    '      <button class="btn-icon lv-cal-navbtn" onclick="lvCalShiftMonth(-1)" title="เดือนก่อน">‹</button>',
    '      <div class="lv-cal-monthlabel" id="lv-cal-monthlabel"></div>',
    '      <button class="btn-icon lv-cal-navbtn" onclick="lvCalShiftMonth(1)" title="เดือนถัดไป">›</button>',
    '    </div>',
    '  </div>',
    '  <div class="lv-cal-legend" id="lv-cal-legend"></div>',
    '  <div class="lv-cal-grid-scroll"><div id="lv-cal-body"></div></div>',
    '  <div class="lv-cal-note" id="lv-cal-note" style="display:none">สถานะเข้าสาย/ตรงเวลา — กำลังเชื่อมต่อข้อมูลลงเวลา</div>',
    '</div>',
    '',
    '<!-- Detail Modal -->',
    '<div class="modal-bg" id="modal-bg" onclick="if(event.target===this)lvCloseModal()">',
    '  <div class="modal" style="max-width:600px">',
    '    <div class="modal-header">',
    '      <h2 id="modal-title">รายละเอียดคำขอลา</h2>',
    '      <p id="modal-sub"></p>',
    '    </div>',
    '    <div class="modal-body" id="modal-body"></div>',
    '    <div class="modal-footer" id="modal-footer">',
    '      <button class="btn" onclick="lvCloseModal()">ปิด</button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   LV2_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → LV_BACKEND
   helper จาก _shared_scripts (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function LV2_RUN_PAGE_JS() {

  // ---- google.script.run shim → LV_BACKEND (async, คืน shape เดิม) ----
  function _lv2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (LV_BACKEND[prop]) {
            Promise.resolve().then(function () { return LV_BACKEND[prop].apply(LV_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[LV_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[LV_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _lv2MakeChain(); } });

  // ---- helpers จาก _shared_scripts (inline) ----
  const ICONS = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('lv2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'lv2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.lv2Toast = showToast;
  function lvShowHelp(content) {
    let bg = document.getElementById('lv-help-modal-bg');
    if (!bg) {
      bg = document.createElement('div'); bg.id = 'lv-help-modal-bg'; bg.className = 'modal-bg';
      bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none;backdrop-filter:blur(4px)';
      bg.onclick = (e) => { if (e.target === bg) lvCloseHelp(); };
      // ใช้ token + class ของ #lv ผ่าน wrapper id=lv ที่ครอบ (append เข้าใน #lv เพื่อให้ scoped CSS ทำงาน)
      const host = document.getElementById('lv') || document.body;
      host.appendChild(bg);
    }
    bg.innerHTML = renderHelpModal(content);
    bg.style.display = 'flex';
    bg.classList.add('active');
  }
  function lvCloseHelp() {
    const bg = document.getElementById('lv-help-modal-bg');
    if (bg) { bg.classList.remove('active'); bg.style.display = 'none'; }
  }
  window.lvShowHelp = lvShowHelp;
  window.lvCloseHelp = lvCloseHelp;
  function renderHelpModal(c) {
    const sections = (c.sections || []).map(s => {
      const cls = s.type === 'warn' ? 'help-section-warn' : s.type === 'tip' ? 'help-section-tip' : '';
      const items = (s.items || []).map(it => '<li>' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div class="help-section ' + cls + '"><div class="help-section-title">' + escapeHtml(s.title) + '</div><ul class="help-section-items">' + items + '</ul></div>';
    }).join('');
    return [
      '<div class="modal" style="max-width:600px">',
        '<div class="modal-header"><div style="display:flex;align-items:center;justify-content:space-between">',
          '<div><h2>' + escapeHtml(c.title || 'Help') + '</h2>',
          c.subtitle ? '<p style="font-size:12px;color:var(--text-muted);margin-top:4px">' + escapeHtml(c.subtitle) + '</p>' : '',
          '</div>',
          '<button class="btn btn-icon" onclick="lvCloseHelp()" title="ปิด" style="border:none;background:transparent">' + ICONS.close + '</button>',
        '</div></div>',
        '<div class="modal-body">',
          c.intro ? '<div class="help-intro">' + escapeHtml(c.intro) + '</div>' : '',
          sections,
        '</div>',
        '<div class="modal-footer"><button class="btn btn-primary" onclick="lvCloseHelp()">เข้าใจแล้ว</button></div>',
      '</div>',
    ].join('');
  }

  // ============================================================
  // ===== JS เดิมจาก leave_manager.html (verbatim · ไม่ตัด section) =====
  // ============================================================
  let currentTab = 'pending';
  let currentData = null;

  // v1.10.245 · client-side cache · เก็บ result ต่อ tab+filter signature
  const _CACHE_TTL_MS = 90 * 1000;
  const _resultCache = Object.create(null);

  function _cacheKey(tab, filter) {
    return tab + '|' + (filter.search || '') + '|' + (filter.branch_id || '') +
           '|' + (filter.leave_type || '') + '|' + (filter.year || '');
  }
  function _cacheGet(key) {
    const hit = _resultCache[key];
    if (!hit) return null;
    if (Date.now() - hit.t > _CACHE_TTL_MS) { delete _resultCache[key]; return null; }
    return hit;
  }
  function _cachePut(key, data) { _resultCache[key] = { t: Date.now(), data }; }
  function _cacheInvalidate(tab) {
    Object.keys(_resultCache).forEach(k => { if (!tab || k.indexOf(tab + '|') === 0) delete _resultCache[k]; });
    lv2InvalidateCache(); // เคลียร์ raw item cache ของ shim ด้วย
  }
  window._cacheInvalidate = _cacheInvalidate;

  function _skeletonHTML(rows) {
    rows = rows || 6;
    let html = '<div class="skel-table">';
    for (let i = 0; i < rows; i++) html += '<div class="skel-row"></div>';
    return html + '</div>';
  }

  const HELP = {
    title: 'Leave Manager — จัดการการลา',
    subtitle: '20_Leave_Requests + 21_Leave_Balance · pending + history + balance',
    intro: 'หน้านี้รวมทุกอย่างเกี่ยวกับการลา: รออนุมัติ, ประวัติ, ยอดคงเหลือ',
    sections: [
      { title: '3 Tabs', items: [
        '<strong>รออนุมัติ</strong> — คำขอลาที่รอ approve/reject',
        '<strong>ประวัติ</strong> — 90 วันที่ผ่านมา (approved/rejected/auto)',
        '<strong>ยอดลาคงเหลือ</strong> — ยอดต่อพนักงานต่อปี (มี progress bar)',
      ]},
      { title: 'Detail modal', items: [
        'แสดงข้อมูลครบ + warning list (ถ้ามี)',
        'Balance pill เขียว/แดง บอก balance พอ/ไม่พอ',
        'Approve/Reject ใน modal — ใช้ logic เดียวกับ LINE Flex (reduce balance + update Time Attendance + แจ้ง branch lead)',
      ]},
      { title: 'Visual cues', items: [
        'Yellow stripe — request มี warning',
        'Red stripe — backdated request',
        'Pills: half-day, backdated, cert (มีเอกสารแนบ)',
      ]},
      { type: 'warn', title: 'ระวัง', items: [
        'Approve แล้ว reverse ยาก — เช็ค balance + warnings ก่อนกด',
        'Maternity leave จะสร้าง SSO follow-up task อัตโนมัติ',
      ]},
    ],
  };

  document.getElementById('section-icon').innerHTML = ICONS.cal;
  document.getElementById('refresh-btn').innerHTML = ICONS.refresh;
  document.getElementById('help-btn').innerHTML = ICONS.help;
  document.getElementById('tab-pending').innerHTML = ICONS.bell + ' รออนุมัติ <span class="count" id="cnt-pending">—</span>';
  document.getElementById('tab-history').innerHTML = ICONS.list + ' ประวัติ <span class="count" id="cnt-history">—</span>';
  document.getElementById('tab-balance').innerHTML = ICONS.chart + ' ยอดลาคงเหลือ <span class="count" id="cnt-balance">—</span>';
  document.getElementById('tab-calendar').innerHTML = ICONS.cal + ' ปฏิทิน';

  // ============================================================
  // ===== ปฏิทิน (Calendar) tab — team grid + per-person timesheet =====
  // ใช้ leave data จาก lv2FetchAll() (cache _lv2Cache) · ไม่มี network call ใหม่
  // นอกจาก lvFetchAttendanceRange (stub รอ backend)
  // ============================================================
  var _lvCalMode = 'team';                 // 'team' | 'person'
  var _lvCalRef = new Date();              // เดือนที่กำลังแสดง (ตั้งต้น = วันนี้)
  _lvCalRef = new Date(_lvCalRef.getFullYear(), _lvCalRef.getMonth(), 1);

  const LV_TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const LV_TH_DOW = ['อา','จ','อ','พ','พฤ','ศ','ส'];

  // ป้ายไทย + token สี ต่อ leave_type (default/other = neutral grey)
  const LV_CAL_TYPES = {
    public:    { label: 'หยุดนักขัตฤกษ์', c: 'var(--c-public)',    bg: 'var(--c-public-bg)' },
    company:   { label: 'หยุดบริษัท',     c: 'var(--c-company)',   bg: 'var(--c-company-bg)' },
    branch:    { label: 'หยุดสาขา',       c: 'var(--c-branch)',    bg: 'var(--c-branch-bg)' },
    religious: { label: 'ลาศาสนา',        c: 'var(--c-religious)', bg: 'var(--c-religious-bg)' },
    personal:  { label: 'ลากิจ',          c: 'var(--c-religious)', bg: 'var(--c-religious-bg)' },
    sick:      { label: 'ลาป่วย',         c: 'var(--danger)',      bg: 'var(--danger-bg)' },
    vacation:  { label: 'ลาพักร้อน',      c: 'var(--c-public)',    bg: 'var(--c-public-bg)' },
    annual:    { label: 'ลาพักร้อน',      c: 'var(--c-public)',    bg: 'var(--c-public-bg)' },
    other:     { label: 'อื่นๆ',          c: '#475569',            bg: '#F1F5F9' },
  };
  function lvCalType(t) { return LV_CAL_TYPES[t] || LV_CAL_TYPES.other; }

  function lvCalPad2(n) { return (n < 10 ? '0' : '') + n; }
  function lvCalYmd(d) { return d.getFullYear() + '-' + lvCalPad2(d.getMonth() + 1) + '-' + lvCalPad2(d.getDate()); }
  function lvCalTodayYmd() { return lvCalYmd(new Date()); }

  // นับเฉพาะ leave ที่ approved/pending (ตัด rejected/cancelled) — pending = render จาง
  function lvCalVisible(r) {
    var s = String(r.status || '').toLowerCase();
    return s === 'approved' || s === 'pending';
  }
  // leave ครอบคลุมวัน ymd หรือไม่ (start..end inclusive · เทียบ string YYYY-MM-DD ปลอดภัย)
  function lvCalCovers(r, ymd) {
    var s = r.start_date || '', e = r.end_date || s;
    if (!s) return false;
    return ymd >= s && ymd <= e;
  }

  // STUB: team-wide attendance endpoint ยังไม่มี → คืน {} เปล่า (ไม่เรียก backend)
  // map: 'YYYY-MM-DD' → { status:'present'|'late'|'absent' }
  // เมื่อ backend พร้อม wiring โดยเปลี่ยน body เป็น:
  //   return sb.functions.invoke('hr_attendance', {body:{action:'range', employee_id:employeeId, from:fromYmd, to:toYmd}})
  //     .then(function(res){ return (res && res.data && res.data.attendance) || {}; });
  function lvFetchAttendanceRange(employeeId, fromYmd, toYmd) {
    return Promise.resolve({});
  }

  // สร้าง array ของ 42 วัน (6 สัปดาห์) เริ่มวันอาทิตย์ ครอบคลุมเดือน _lvCalRef
  function lvCalGridDays() {
    var first = new Date(_lvCalRef.getFullYear(), _lvCalRef.getMonth(), 1);
    var startDow = first.getDay(); // 0 = Sun
    var start = new Date(first);
    start.setDate(1 - startDow);
    var days = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      days.push(d);
    }
    return days;
  }

  function lvCalMonthLabel() {
    return LV_TH_MONTHS[_lvCalRef.getMonth()] + ' ' + (_lvCalRef.getFullYear() + 543);
  }

  function lvCalSetMode(mode) {
    _lvCalMode = mode;
    document.getElementById('lv-cal-mode-team').classList.toggle('active', mode === 'team');
    document.getElementById('lv-cal-mode-person').classList.toggle('active', mode === 'person');
    lvCalRender();
  }
  window.lvCalSetMode = lvCalSetMode;

  function lvCalShiftMonth(delta) {
    _lvCalRef = new Date(_lvCalRef.getFullYear(), _lvCalRef.getMonth() + delta, 1);
    lvCalRender();
  }
  window.lvCalShiftMonth = lvCalShiftMonth;

  // entry point — โหลด leave จาก cache แล้ว render ตาม mode
  function lvCalRender() {
    document.getElementById('lv-cal-monthlabel').textContent = lvCalMonthLabel();
    var personPick = document.getElementById('lv-cal-person-pick');
    var noteEl = document.getElementById('lv-cal-note');
    personPick.style.display = (_lvCalMode === 'person') ? '' : 'none';
    noteEl.style.display = (_lvCalMode === 'person') ? '' : 'none';

    document.getElementById('lv-cal-body').innerHTML = _skeletonHTML(4);
    lv2FetchAll().then(function (items) {
      var leaves = (items || []).filter(lvCalVisible);
      if (_lvCalMode === 'person') lvCalRenderPerson(leaves);
      else lvCalRenderTeam(leaves);
    }).catch(onErr);
  }
  window.lvCalRender = lvCalRender;

  // legend สั้นๆ ของ leave-type ที่ใช้บ่อย
  function lvCalRenderLegend(types) {
    var html = (types || []).map(function (t) {
      var info = lvCalType(t);
      return '<span class="lv-cal-leg"><span class="sw" style="background:' + info.bg + ';border:1px solid ' + info.c + '"></span>' + escapeHtml(info.label) + '</span>';
    }).join('');
    document.getElementById('lv-cal-legend').innerHTML = html;
  }

  // ---- Mode A: ทั้งทีม (month grid + chips) ----
  function lvCalRenderTeam(leaves) {
    lvCalRenderLegend(['sick', 'personal', 'vacation', 'public', 'company', 'religious', 'other']);

    var days = lvCalGridDays();
    var todayYmd = lvCalTodayYmd();
    var curMonth = _lvCalRef.getMonth();

    var head = '<tr>' + LV_TH_DOW.map(function (d) { return '<th>' + d + '</th>'; }).join('') + '</tr>';

    var rowsHtml = '';
    for (var w = 0; w < 6; w++) {
      var cells = '';
      for (var c = 0; c < 7; c++) {
        var d = days[w * 7 + c];
        var ymd = lvCalYmd(d);
        var dow = d.getDay();
        var clsArr = [];
        if (d.getMonth() !== curMonth) clsArr.push('other-month');
        if (dow === 0 || dow === 6) clsArr.push('weekend');
        if (ymd === todayYmd) clsArr.push('today');

        // คนที่ลาในวันนี้
        var onLeave = leaves.filter(function (r) { return lvCalCovers(r, ymd); });
        var chips = '';
        var shown = onLeave.slice(0, 3);
        shown.forEach(function (r) {
          var info = lvCalType(r.leave_type);
          var pendCls = (String(r.status).toLowerCase() === 'pending') ? ' pending' : '';
          var name = r.employee_name || r.employee_id || '';
          chips += '<span class="lv-cal-chip' + pendCls + '" style="background:' + info.bg + ';color:' + info.c + ';border-color:' + info.c + '" title="' + escapeAttr(name + ' · ' + info.label) + '">' + escapeHtml(name) + '</span>';
        });
        if (onLeave.length > 3) {
          chips += '<span class="lv-cal-chip more">+' + (onLeave.length - 3) + '</span>';
        }

        cells += '<td class="' + clsArr.join(' ') + '"><div class="lv-cal-daynum">' + d.getDate() + '</div>' + chips + '</td>';
      }
      rowsHtml += '<tr>' + cells + '</tr>';
    }

    document.getElementById('lv-cal-body').innerHTML =
      '<table class="lv-cal-grid"><thead>' + head + '</thead><tbody>' + rowsHtml + '</tbody></table>';
  }

  // ---- Mode B: รายคน (timesheet) ----
  function lvCalRenderPerson(leaves) {
    lvCalRenderLegend(['sick', 'personal', 'vacation', 'public', 'company', 'religious', 'other']);

    // build/refresh employee dropdown (unique จาก leave items · sort by name)
    // rebuild เฉพาะเมื่อชุดพนักงานเปลี่ยน (เช่น cache refresh มีคนใหม่) · คงค่าที่เลือกไว้
    var sel = document.getElementById('lv-cal-person-sel');
    var seen = {}, emps = [];
    (leaves || []).forEach(function (r) {
      var id = r.employee_id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      emps.push({ id: id, name: r.employee_name || id });
    });
    emps.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    var sig = emps.map(function (e) { return e.id; }).join('|');
    if (sel.dataset.sig !== sig) {
      var prev = sel.value;
      if (emps.length === 0) {
        sel.innerHTML = '<option value="">— ไม่มีข้อมูลพนักงาน —</option>';
      } else {
        sel.innerHTML = emps.map(function (e) {
          return '<option value="' + escapeAttr(e.id) + '">' + escapeHtml(e.name) + '</option>';
        }).join('');
      }
      sel.dataset.sig = sig;
      if (prev && emps.some(function (e) { return e.id === prev; })) sel.value = prev;
    }

    var empId = sel.value;
    var mine = (leaves || []).filter(function (r) { return (r.employee_id || '') === empId; });

    var days = lvCalGridDays();
    var fromYmd = lvCalYmd(days[0]);
    var toYmd = lvCalYmd(days[days.length - 1]);
    var todayYmd = lvCalTodayYmd();
    var curMonth = _lvCalRef.getMonth();

    // ดึง attendance (stub → {}) แล้ว render grid (เพื่อให้ dot พร้อมต่อ backend ภายหลัง)
    lvFetchAttendanceRange(empId, fromYmd, toYmd).then(function (att) {
      att = att || {};
      var head = '<tr>' + LV_TH_DOW.map(function (d) { return '<th>' + d + '</th>'; }).join('') + '</tr>';
      var rowsHtml = '';
      for (var w = 0; w < 6; w++) {
        var cells = '';
        for (var c = 0; c < 7; c++) {
          var d = days[w * 7 + c];
          var ymd = lvCalYmd(d);
          var dow = d.getDay();
          var clsArr = [];
          if (d.getMonth() !== curMonth) clsArr.push('other-month');
          if (dow === 0 || dow === 6) clsArr.push('weekend');
          if (ymd === todayYmd) clsArr.push('today');

          var block = '';
          var lv = mine.find(function (r) { return lvCalCovers(r, ymd); });
          if (lv) {
            var info = lvCalType(lv.leave_type);
            var pendCls = (String(lv.status).toLowerCase() === 'pending') ? ' pending' : '';
            block = '<span class="lv-cal-block' + pendCls + '" style="background:' + info.bg + ';color:' + info.c + ';border-color:' + info.c + '">' + escapeHtml(info.label) + '</span>';
          }

          // attendance dot (ถ้า map มี entry สำหรับวันนี้) — ตอนนี้ stub คืน {} → ไม่ render
          var dot = '';
          var a = att[ymd];
          if (a && a.status) {
            dot = '<span class="lv-cal-dot ' + escapeAttr(a.status) + '" title="' + escapeAttr(a.status) + '"></span>';
          }

          cells += '<td class="' + clsArr.join(' ') + '"><div class="lv-cal-daynum">' + d.getDate() + '</div>' + block + dot + '</td>';
        }
        rowsHtml += '<tr>' + cells + '</tr>';
      }
      document.getElementById('lv-cal-body').innerHTML =
        '<table class="lv-cal-grid"><thead>' + head + '</thead><tbody>' + rowsHtml + '</tbody></table>';
    }).catch(onErr);
  }

  function lvSetTab(tab) {
    currentTab = tab;
    ['pending', 'history', 'balance', 'calendar'].forEach(t => {
      document.getElementById('tab-' + t).classList.toggle('active', t === tab);
    });

    // calendar tab = ปฏิทินเต็มจอ → ซ่อน stats/filters/content card · โชว์ #lv-cal-wrap
    const isCal = (tab === 'calendar');
    document.getElementById('stats').style.display = isCal ? 'none' : '';
    var filtersEl = document.querySelector('#lv .filters');
    if (filtersEl) filtersEl.style.display = isCal ? 'none' : '';
    var sectionEl = document.querySelector('#lv .section');
    if (sectionEl) sectionEl.style.display = isCal ? 'none' : '';
    document.getElementById('lv-cal-wrap').style.display = isCal ? '' : 'none';
    if (isCal) { lvCalRender(); return; }

    document.getElementById('filter-type-wrap').style.display = (tab === 'balance') ? 'none' : '';
    document.getElementById('filter-year-wrap').style.display = (tab === 'balance') ? '' : 'none';

    const titles = {
      pending: ['รออนุมัติ', 'คำขอลาที่รอการอนุมัติจากหัวหน้า'],
      history: ['ประวัติการลา', '90 วันที่ผ่านมา — approved / rejected / auto'],
      balance: ['ยอดลาคงเหลือ', 'แสดงยอดคงเหลือ ปี ' + (document.getElementById('filter-year').value || new Date().getFullYear())],
    };
    document.getElementById('section-title').textContent = titles[tab][0];
    document.getElementById('section-sub').textContent = titles[tab][1];

    if (tab === 'balance' && document.getElementById('filter-year').children.length === 0) {
      const sel = document.getElementById('filter-year');
      const ty = new Date().getFullYear();
      [ty - 1, ty, ty + 1].forEach(y => {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        if (y === ty) o.selected = true;
        sel.appendChild(o);
      });
    }
    loadCurrent();
  }
  window.lvSetTab = lvSetTab;

  function loadCurrent(forceReload) {
    const filter = {
      search: document.getElementById('filter-search').value,
      branch_id: document.getElementById('filter-branch').value || undefined,
      leave_type: document.getElementById('filter-type').value || undefined,
      year: document.getElementById('filter-year').value || undefined,
    };
    const renderFor = { pending: renderPending, history: renderHistory, balance: renderBalance };
    const apiFor = {
      pending: 'leaveAdminListPending',
      history: 'leaveAdminListHistory',
      balance: 'leaveAdminListBalance',
    };

    const key = _cacheKey(currentTab, filter);
    const cached = forceReload ? null : _cacheGet(key);
    if (cached) {
      currentData = cached.data;
      renderFor[currentTab](cached.data);
      const ageS = Math.round((Date.now() - cached.t) / 1000);
      if (ageS > 30) {
        google.script.run
          .withSuccessHandler(d => { _cachePut(key, d); currentData = d; renderFor[currentTab](d); })
          .withFailureHandler(() => {})
          [apiFor[currentTab]](filter);
      }
      return;
    }

    document.getElementById('content').innerHTML = _skeletonHTML(6);
    google.script.run
      .withSuccessHandler(d => { _cachePut(key, d); currentData = d; renderFor[currentTab](d); })
      .withFailureHandler(onErr)
      [apiFor[currentTab]](filter);
  }
  window.loadCurrent = loadCurrent;

  function onErr(e) { showToast('Error: ' + (e && e.message ? e.message : e), 'error'); }

  function populateBranches(branches) {
    const sel = document.getElementById('filter-branch');
    if (sel.children.length > 1) return;
    branches.forEach(b => {
      const o = document.createElement('option');
      o.value = b.id; o.textContent = b.id + ' — ' + b.name;
      sel.appendChild(o);
    });
  }

  function renderPending(d) {
    populateBranches(d.branches || []);
    const s = d.stats || {};
    document.getElementById('cnt-pending').textContent = s.total || 0;
    // sidebar badge = จำนวน pending
    const ct = document.getElementById('ct-leavereq');
    if (ct) ct.textContent = (s.total || 0) || '';
    document.getElementById('stats').innerHTML = [
      statCard('รวม', s.total, 'รออนุมัติ', 'var(--navy)'),
      statCard('Sick', s.sick, 'ป่วย', 'var(--danger)'),
      statCard('Annual', s.annual, 'พักร้อน', 'var(--c-public)'),
      statCard('Personal', s.personal, 'กิจ', 'var(--c-religious)'),
      statCard('มี warning', s.with_warnings, 'ต้องตรวจ', s.with_warnings > 0 ? 'var(--warning)' : 'var(--text-faint)'),
    ].join('');
    renderRequestTable(d.requests, true);
  }

  function renderHistory(d) {
    populateBranches(d.branches || []);
    const s = d.stats || {};
    document.getElementById('cnt-history').textContent = s.total || 0;
    document.getElementById('stats').innerHTML = [
      statCard('รวม', s.total, '90 วัน', 'var(--navy)'),
      statCard('Sick', s.sick, 'ป่วย', 'var(--danger)'),
      statCard('Annual', s.annual, 'พักร้อน', 'var(--c-public)'),
      statCard('Personal', s.personal, 'กิจ', 'var(--c-religious)'),
      statCard('Other', s.other, 'maternity etc.', 'var(--c-branch)'),
    ].join('');
    renderRequestTable(d.requests, false);
  }

  function renderBalance(d) {
    populateBranches(d.branches || []);
    const s = d.stats || {};
    document.getElementById('cnt-balance').textContent = s.total_employees || 0;
    document.getElementById('stats').innerHTML = [
      statCard('Employees', s.total_employees, 'ปี ' + s.year, 'var(--navy)'),
      statCard('Active', s.active, 'ทำงานอยู่', 'var(--success)'),
      statCard('Low Sick', s.low_sick, '< 5 วัน', s.low_sick > 0 ? 'var(--warning)' : 'var(--text-faint)'),
      statCard('Low Annual', s.low_annual, '< 1 วัน', s.low_annual > 0 ? 'var(--danger) ' : 'var(--text-faint)'),
      statCard('ปี', s.year, '', 'var(--info)'),
    ].join('');
    renderBalanceTable(d.balances);
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  function renderRequestTable(rows, showActions) {
    if (!rows || rows.length === 0) {
      document.getElementById('content').innerHTML = '<div class="empty"><div class="empty-icon">' + ICONS.cal + '</div><div class="empty-title">ไม่มีคำขอ</div></div>';
      return;
    }

    const trs = rows.map(r => {
      const flagsHtml = [
        r.half_day ? '<span class="flag-pill flag-half">½</span>' : '',
        r.backdated ? '<span class="flag-pill flag-back">y/back</span>' : '',
        r.attachment_url ? '<span class="flag-pill" style="background:var(--info-bg);color:var(--info)">cert</span>' : '',
      ].join('');
      const warn = r.warnings_count > 0 ? '<span class="warn-badge">' + r.warnings_count + ' warn</span>' : '';
      const trClass = r.warnings_count > 0 ? 'has-warnings' : (r.backdated ? 'backdated' : '');

      let actions = '';
      if (showActions && r.status === 'pending') {
        actions = '<button class="btn btn-sm" onclick="lvViewDetail(\'' + escapeAttr(r.request_id) + '\')">ดู</button>';
      } else {
        const statusPill = r.status === 'approved' ? '<span class="pill pill-success">approved</span>' :
          r.status === 'auto_approved' ? '<span class="pill pill-success">auto</span>' :
          r.status === 'rejected' ? '<span class="pill pill-danger">rejected</span>' :
          '<span class="pill pill-warning">' + r.status + '</span>';
        actions = statusPill;
      }

      return [
        '<tr class="' + trClass + '" onclick="lvViewDetail(\'' + escapeAttr(r.request_id) + '\')" style="cursor:pointer">',
          '<td>',
            '<div style="font-weight:500">' + escapeHtml(r.employee_name) + warn + '</div>',
            '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + escapeHtml(r.employee_id) + ' · ' + escapeHtml(r.branch_id) + '</div>',
          '</td>',
          '<td>',
            '<span class="leave-type-pill lt-' + r.leave_type + '">' + r.leave_type + '</span>',
            flagsHtml,
          '</td>',
          '<td>',
            '<div style="font-weight:500">' + r.start_date + (r.start_date !== r.end_date ? ' – ' + r.end_date : '') + '</div>',
            '<div style="font-size:10px;color:var(--text-muted)">submit: ' + (r.submitted_at || '—') + '</div>',
          '</td>',
          '<td><span class="days-badge">' + r.days + '</span></td>',
          '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(r.reason || '—') + '</td>',
          '<td onclick="event.stopPropagation()" style="text-align:right">' + actions + '</td>',
        '</tr>',
      ].join('');
    }).join('');

    document.getElementById('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th>พนักงาน</th><th>ประเภท</th><th>วันที่</th>',
          '<th style="width:70px">วัน</th><th>เหตุผล</th>',
          '<th style="width:100px;text-align:right">' + (showActions ? 'Action' : 'Status') + '</th>',
        '</tr></thead>',
        '<tbody>' + trs + '</tbody>',
      '</table>',
    ].join('');
  }

  function renderBalanceTable(rows) {
    if (!rows || rows.length === 0) {
      document.getElementById('content').innerHTML = '<div class="empty"><div class="empty-icon">' + ICONS.chart + '</div><div class="empty-title">ไม่มีข้อมูล balance</div><div class="empty-sub">HR ตั้งยอดต้นปีใน Tab 21_Leave_Balance</div></div>';
      return;
    }

    const trs = rows.map(b => {
      const sickPct = b.sick_total > 0 ? (b.sick_remaining / b.sick_total) * 100 : 0;
      const annualPct = b.annual_total > 0 ? (b.annual_remaining / b.annual_total) * 100 : 0;
      const personalPct = b.personal_total > 0 ? (b.personal_remaining / b.personal_total) * 100 : 0;

      return [
        '<tr>',
          '<td>',
            '<div style="font-weight:500">' + escapeHtml(b.employee_name) + '</div>',
            '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + escapeHtml(b.employee_id) + ' · ' + escapeHtml(b.primary_branch_id) + '</div>',
          '</td>',
          '<td>' + balCell(b.sick_remaining, b.sick_total, sickPct) + '</td>',
          '<td>' + balCell(b.personal_remaining, b.personal_total, personalPct) + '</td>',
          '<td>' + balCell(b.annual_remaining, b.annual_total, annualPct) + '</td>',
          '<td><span class="balance-num">' + b.maternity_remaining + '</span><span class="balance-cell"> / ' + b.maternity_total + '</span></td>',
          '<td><span class="balance-num">' + b.paternity_total + '</span></td>',
        '</tr>',
      ].join('');
    }).join('');

    document.getElementById('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th>พนักงาน</th>',
          '<th style="width:130px">Sick (ป่วย)</th>',
          '<th style="width:130px">Personal (กิจ)</th>',
          '<th style="width:130px">Annual (พักร้อน)</th>',
          '<th style="width:90px">Maternity</th>',
          '<th style="width:80px">Paternity</th>',
        '</tr></thead>',
        '<tbody>' + trs + '</tbody>',
      '</table>',
    ].join('');
  }

  function balCell(remaining, total, pct) {
    const cls = pct === 0 ? 'empty' : (pct < 30 ? 'low' : '');
    return [
      '<div><span class="balance-num">' + remaining + '</span><span class="balance-cell"> / ' + total + '</span></div>',
      '<div class="bal-bar-bg"><div class="bal-bar-fill ' + cls + '" style="width:' + Math.max(0, Math.min(100, pct)) + '%"></div></div>',
    ].join('');
  }

  // v1.11.20 — ดูใบรับรองแพทย์ PDPA ผ่าน proxy → เปิด blob ในแท็บใหม่ (ไม่มี public link)
  function viewLeaveCert(requestId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังโหลด...'; }
    google.script.run
      .withSuccessHandler(function (res) {
        if (btn) { btn.disabled = false; btn.textContent = 'ดูใบรับรองแพทย์ (PDPA)'; }
        if (!res || !res.ok) { alert((res && res.error) || 'เปิดไฟล์ไม่ได้'); return; }
        try {
          const bin = atob(res.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const blob = new Blob([bytes], { type: res.mime || 'application/octet-stream' });
          window.open(URL.createObjectURL(blob), '_blank');
        } catch (e) { alert('แปลงไฟล์ไม่สำเร็จ: ' + e.message); }
      })
      .withFailureHandler(function (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'ดูใบรับรองแพทย์ (PDPA)'; }
        alert('เปิดไฟล์ไม่ได้: ' + (e && e.message ? e.message : e));
      })
      .leaveCertView(requestId);
  }
  window.viewLeaveCert = viewLeaveCert;

  function lvViewDetail(requestId) {
    google.script.run
      .withSuccessHandler(lvShowDetail)
      .withFailureHandler(onErr)
      .leaveAdminGetDetail(requestId);
  }
  window.lvViewDetail = lvViewDetail;

  function lvShowDetail(d) {
    if (!d || d.error) { showToast(d ? d.error : 'error', 'error'); return; }

    document.getElementById('modal-title').textContent = 'คำขอลา · ' + d.employee_name;
    document.getElementById('modal-sub').textContent =
      d.request_id + ' · ส่งเมื่อ ' + d.submitted_at;

    const flags = [
      d.half_day ? '<span class="flag-pill flag-half">half-day</span>' : '',
      d.backdated ? '<span class="flag-pill flag-back">backdated</span>' : '',
    ].join(' ');

    let warningsHtml = '';
    if (d.override_warnings) {
      const warnings = d.override_warnings.split('|').filter(Boolean);
      if (warnings.length > 0) {
        warningsHtml = [
          '<div class="warning-list">',
            '<div class="warning-title">คำเตือน (' + warnings.length + ')</div>',
            '<ul>',
              warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join(''),
            '</ul>',
          '</div>',
        ].join('');
      }
    }

    let attachmentHtml = '';
    if (d.attachment_url) {
      // v1.11.20 — ใบรับรองแบบ PDPA (pdpa://<fileId>) ต้องดูผ่าน proxy · ลิงก์ปกติเปิดตรงได้
      if (String(d.attachment_url).indexOf('pdpa://') === 0) {
        attachmentHtml = '<button class="btn btn-sm" onclick="viewLeaveCert(\'' + escapeAttr(d.request_id) + '\', this)">ดูใบรับรองแพทย์ (PDPA)</button>';
      } else {
        attachmentHtml = '<a href="' + escapeAttr(d.attachment_url) + '" target="_blank" class="btn btn-sm">ดูเอกสารแนบ</a>';
      }
    }

    const balPill = d.balance_remaining_for_type < d.days
      ? '<span class="pill pill-danger">balance ไม่พอ</span>'
      : '<span class="pill pill-success">balance พอ</span>';

    document.getElementById('modal-body').innerHTML = [
      warningsHtml,
      '<div class="detail-grid">',
        '<div class="detail-label">พนักงาน</div><div class="detail-value">' + escapeHtml(d.employee_name) + ' (' + escapeHtml(d.employee_id) + ')</div>',
        '<div class="detail-label">ตำแหน่ง</div><div class="detail-value">' + escapeHtml(d.employee_position || '—') + '</div>',
        '<div class="detail-label">สาขา</div><div class="detail-value">' + escapeHtml(d.branch_id || '—') + '</div>',
        '<div class="detail-label">ประเภทลา</div><div class="detail-value"><span class="leave-type-pill lt-' + d.leave_type + '">' + d.leave_type + '</span> ' + flags + '</div>',
        '<div class="detail-label">ช่วงเวลา</div><div class="detail-value">' + d.start_date + (d.start_date !== d.end_date ? ' ถึง ' + d.end_date : '') + '</div>',
        '<div class="detail-label">จำนวน</div><div class="detail-value"><span class="days-badge">' + d.days + ' วัน</span> ' + balPill + ' (เหลือ ' + d.balance_remaining_for_type + ')</div>',
        '<div class="detail-label">เหตุผล</div><div class="detail-value">' + escapeHtml(d.reason || '—') + '</div>',
        d.note ? ('<div class="detail-label">หมายเหตุ</div><div class="detail-value" style="white-space:pre-wrap;color:var(--text-2);font-style:italic;">' + escapeHtml(d.note) + '</div>') : '',
        '<div class="detail-label">ผู้รับมอบงาน</div><div class="detail-value">' + (d.replacement_name ? escapeHtml(d.replacement_name) + ' (' + escapeHtml(d.replacement_employee_id) + ')' : '—') + '</div>',
        '<div class="detail-label">ผู้อนุมัติ</div><div class="detail-value">' + (d.approver_name ? escapeHtml(d.approver_name) + ' (' + escapeHtml(d.approver_id) + ')' : '—') + '</div>',
        d.approval_chain ? '<div class="detail-label">Approval chain</div><div class="detail-value" style="font-family:monospace;font-size:11px">' + escapeHtml(d.approval_chain) + '</div>' : '',
        d.attachment_url ? ('<div class="detail-label">เอกสารแนบ</div><div class="detail-value">' + attachmentHtml + '</div>') : '',
        d.sso_status ? ('<div class="detail-label">SSO Status</div><div class="detail-value"><span class="pill pill-info">' + d.sso_status + '</span></div>') : '',
        d.approved_at ? ('<div class="detail-label">อนุมัติเมื่อ</div><div class="detail-value">' + d.approved_at + '</div>') : '',
      '</div>',
    ].join('');

    // Action buttons
    if (d.status === 'pending') {
      document.getElementById('modal-footer').innerHTML = [
        '<button class="btn" onclick="lvCloseModal()">ปิด</button>',
        '<button class="btn btn-danger" style="background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border)" onclick="rejectReq(\'' + escapeAttr(d.request_id) + '\')">Reject</button>',
        '<button class="btn btn-primary" onclick="approveReq(\'' + escapeAttr(d.request_id) + '\')">Approve</button>',
      ].join('');
    } else {
      document.getElementById('modal-footer').innerHTML = '<button class="btn" onclick="lvCloseModal()">ปิด</button>';
    }

    document.getElementById('modal-bg').classList.add('active');
  }
  window.lvShowDetail = lvShowDetail;

  function lvCloseModal() { document.getElementById('modal-bg').classList.remove('active'); }
  window.lvCloseModal = lvCloseModal;

  function approveReq(id) {
    if (!confirm('Approve คำขอลานี้? (จะ update balance + time attendance + แจ้ง branch lead)')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(Number(r.status) === 403 ? 'ต้องเป็น HR' : r.error, 'error'); return; }
        showToast('อนุมัติแล้ว', 'success');
        lvCloseModal();
        _cacheInvalidate(); // v1.10.245 · mutation → invalidate ทุก tab
        loadCurrent(true);
      })
      .withFailureHandler(onErr)
      .leaveAdminApprove(id);
  }
  window.approveReq = approveReq;

  function rejectReq(id) {
    var note = prompt('Reject คำขอลานี้? — ใส่เหตุผล (ถ้ามี)', '');
    if (note === null) return; // กดยกเลิก
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(Number(r.status) === 403 ? 'ต้องเป็น HR' : r.error, 'error'); return; }
        showToast('ปฏิเสธแล้ว', 'success');
        lvCloseModal();
        _cacheInvalidate(); // v1.10.245 · mutation → invalidate ทุก tab
        loadCurrent(true);
      })
      .withFailureHandler(onErr)
      .leaveAdminReject(id, note);
  }
  window.rejectReq = rejectReq;

  lvSetTab('pending');
}
