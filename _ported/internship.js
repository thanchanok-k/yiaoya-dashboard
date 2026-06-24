// _ported/internship.js — FULL native port of desktop internship_manager.html (HR Internship admin · หน้า "ฝึกงาน")
// ลอกทั้งดุ้น: kpi(4) + view-switcher(list/apps/eval/cert) + filter-bar + 2 modals (approve/walk-in) + toast
//   CSS เดิม (_shared_styles ที่ใช้ + <style> หน้า manager) prefix #is ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ IS_RUN_PAGE_JS() · google.script.run = shim → IS_BACKEND (Supabase)
//
// ใช้ global sb (index.html module scope) — ห้าม redeclare global sb/esc/$
//   หน้าเดิมมี esc()/fmtDate()/toast() เป็นของตัวเอง → คงไว้ใน closure (shadow ภายใน · ไม่แตะ global)
// top-level fn = mountInternship() ผูก window · fn ที่ inline onclick ต้องใช้ → ผูก window ภายใน closure
//
// backend (edge fn hr_list?type=internship.updated → {items}) :
//   list   → derive interns / applications / evals / certs / counts client-side จาก payload ล่าสุดต่อ entity
//            (ตอนนี้ list อาจว่าง = 0 รายการ → render ได้ ไม่ error · empty state สวย)
//   whoami → dashboard user = admin เต็มสิทธิ์ (ไม่มี gate ในหน้าเดิม)
//   approve/reject/walkIn/remindMentor/issueCert → เขียนกลับ/ส่ง LINE ไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   IS_BACKEND — map google.script.run → Supabase edge fn hr_list (type=internship.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     internshipAdminDashboard()           → {ok, counts:{active,pending_evals,ending_this_month,
                                              certs_this_year,pending_apps}}
     internshipAdminListInterns({})       → {ok, rows:[...]}
     internshipAdminListPendingApps({})   → {ok, rows:[...]}
     internshipAdminListPendingEvals({})  → {ok, rows:[...]}
     internshipAdminListCertReady()       → {ok, ready:[...], issued:[...]}
     mutations                            → {ok:false,error} stub + toast
   ============================================================ */
var IS_FN = 'hr_list';
var IS_TYPE = 'internship.updated';

function is2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function is2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function is2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// แต่ละ payload event ดิบ มี record_kind บอกว่าเป็น intern / application / eval / cert
// (ถ้า backend ยังไม่ใส่ → เดาจาก field ที่มี) → derive 4 dataset แยก
function is2Kind(p) {
  p = p || {};
  var k = String(p.record_kind || p.kind || '').toLowerCase();
  if (k) return k;
  if (p.cert_no || p.certificate_no) return 'cert';
  if (p.application_id || p.preferred_dept) return 'application';
  if (p.eval_id || p.period_label || p.period_type) return 'eval';
  return 'intern';
}

function is2MapIntern(p) {
  p = p || {};
  return {
    employee_id: p.employee_id || p.entity_id || p.id || '',
    full_name_th: p.full_name_th || p.full_name || p.name || '—',
    nickname: p.nickname || '',
    university: p.university || '',
    faculty: p.faculty || '',
    year_of_study: p.year_of_study || p.year || '',
    internship_dept: p.internship_dept || p.preferred_dept || p.dept || '',
    mentor_id: p.mentor_id || '',
    start_date: is2Date(p.start_date),
    end_date: is2Date(p.end_date),
    overall_score: (p.overall_score != null ? p.overall_score : ''),
    evals_submitted: (p.evals_submitted != null ? p.evals_submitted : 0),
    evals_total: (p.evals_total != null ? p.evals_total : 0),
    profile_status: String(p.profile_status || p.status || 'active').toLowerCase(),
    days: p.days || '',
    cert_no: p.cert_no || p.certificate_no || '',
    issued_at: is2Date(p.issued_at),
    file_url: p.file_url || p.cert_url || '',
    _raw: p,
  };
}

function is2MapApp(p) {
  p = p || {};
  return {
    application_id: p.application_id || p.entity_id || p.id || '',
    candidate_id: p.candidate_id || '',
    full_name_th: p.full_name_th || p.full_name || p.name || '—',
    nickname: p.nickname || '',
    year_of_study: p.year_of_study || p.year || '',
    gpa: (p.gpa != null ? p.gpa : ''),
    university: p.university || '',
    faculty: p.faculty || '',
    major: p.major || '',
    preferred_dept: p.preferred_dept || '',
    preferred_branch_id: p.preferred_branch_id || '',
    desired_start_date: is2Date(p.desired_start_date),
    desired_end_date: is2Date(p.desired_end_date),
    attached: is2ToArr(p.attached),
    submitted_at: is2Date(p.submitted_at || p.created_at),
    _raw: p,
  };
}

function is2MapEval(p) {
  p = p || {};
  return {
    eval_id: p.eval_id || p.entity_id || p.id || '',
    intern_name: p.intern_name || p.full_name_th || p.name || '—',
    employee_id: p.employee_id || '',
    period_label: p.period_label || '',
    period_type: p.period_type || '',
    period_start: is2Date(p.period_start),
    period_end: is2Date(p.period_end),
    mentor_name: p.mentor_name || p.mentor_id || '',
    due_date: is2Date(p.due_date),
    overall_score: (p.overall_score != null ? p.overall_score : ''),
    status: String(p.status || 'pending').toLowerCase(),
    _raw: p,
  };
}

// cache dataset ล่าสุด (ให้ mutation/derive reuse)
var _is2 = { interns: [], apps: [], evals: [], certsReady: [], certsIssued: [] };

function is2FetchAll() {
  return sb.functions.invoke(IS_FN + '?type=' + encodeURIComponent(IS_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = is2ToArr(data.items);
    var seen = {};
    var interns = [], apps = [], evals = [], certsReady = [], certsIssued = [];
    items.forEach(function (p) {
      var kind = is2Kind(p);
      var id = (p.entity_id || p.id || p.application_id || p.eval_id || p.employee_id || '') + ':' + kind;
      if (id && seen[id]) return;
      if (id) seen[id] = true;
      if (kind === 'application') apps.push(is2MapApp(p));
      else if (kind === 'eval') evals.push(is2MapEval(p));
      else if (kind === 'cert') {
        var c = is2MapIntern(p);
        if (c.cert_no) certsIssued.push(c); else certsReady.push(c);
      } else {
        var iv = is2MapIntern(p);
        if (iv.cert_no) certsIssued.push(iv);
        else if (String(iv.profile_status).indexOf('complete') === 0 && iv.overall_score !== '') certsReady.push(iv);
        interns.push(iv);
      }
    });
    _is2 = { interns: interns, apps: apps, evals: evals, certsReady: certsReady, certsIssued: certsIssued };
    return _is2;
  }).catch(function (e) {
    console.warn('[IS_BACKEND] list fetch failed', e);
    _is2 = { interns: [], apps: [], evals: [], certsReady: [], certsIssued: [] };
    return _is2;
  });
}

var IS_BACKEND = {
  internshipAdminDashboard: function () {
    return is2FetchAll().then(function (d) {
      var now = new Date();
      var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      var endingThisMonth = d.interns.filter(function (r) {
        return r.end_date && r.end_date.slice(0, 7) === ym && r.profile_status === 'active';
      }).length;
      var certsThisYear = d.certsIssued.filter(function (r) {
        return r.issued_at && r.issued_at.slice(0, 4) === String(now.getFullYear());
      }).length;
      return {
        ok: true,
        counts: {
          active: d.interns.filter(function (r) { return r.profile_status === 'active'; }).length,
          pending_evals: d.evals.filter(function (r) { return r.status !== 'submitted'; }).length,
          ending_this_month: endingThisMonth,
          certs_this_year: certsThisYear,
          pending_apps: d.apps.length,
        },
      };
    });
  },
  internshipAdminListInterns: function () {
    return is2FetchAll().then(function (d) { return { ok: true, rows: d.interns }; });
  },
  internshipAdminListPendingApps: function () {
    return is2FetchAll().then(function (d) { return { ok: true, rows: d.apps }; });
  },
  internshipAdminListPendingEvals: function () {
    return is2FetchAll().then(function (d) {
      return { ok: true, rows: d.evals.filter(function (r) { return r.status !== 'submitted'; }) };
    });
  },
  internshipAdminListCertReady: function () {
    return is2FetchAll().then(function (d) { return { ok: true, ready: d.certsReady, issued: d.certsIssued }; });
  },

  // ---- mutations: เขียนกลับ/ส่ง LINE ไม่ได้บน dashboard → stub + toast ----
  internshipAdminApprove: function () {
    is2NotReady('อนุมัติ Intern (สร้าง record + LINE flex)');
    return Promise.resolve({ ok: false, error: 'อนุมัติยังไม่พร้อมบน dashboard (read-only)' });
  },
  internshipAdminReject: function () {
    is2NotReady('Reject ใบสมัคร');
    return Promise.resolve({ ok: false, error: 'Reject ยังไม่พร้อมบน dashboard (read-only)' });
  },
  internshipAdminWalkIn: function () {
    is2NotReady('เพิ่ม Intern เอง (walk-in) + LINE flex');
    return Promise.resolve({ ok: false, error: 'เพิ่ม intern ยังไม่พร้อมบน dashboard (read-only)' });
  },
  internshipAdminRemindMentor: function () {
    is2NotReady('ส่ง LINE เตือน mentor ประเมิน');
    return Promise.resolve({ ok: false, error: 'ส่งเตือน mentor ยังไม่พร้อมบน dashboard' });
  },
  internshipAdminIssueCert: function () {
    is2NotReady('ออกหนังสือรับรองการฝึกงาน');
    return Promise.resolve({ ok: false, error: 'ออกใบรับรองยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _is2NotReadyShown = {};
function is2NotReady(feature) {
  if (_is2NotReadyShown[feature]) return;
  _is2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.is2Toast) window.is2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountInternship — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountInternship() {
  if (!document.getElementById('wrap-internship')) return;
  var wrap = document.getElementById('wrap-internship');
  wrap.innerHTML = '<style>' + IS_CSS() + '</style><div id="is">' + IS_MARKUP() + '</div>';
  IS_RUN_PAGE_JS();
}

/* ===== CSS เดิม (<style> หน้า manager) · prefix ทุก selector ด้วย #is =====
   ตัด app-shell/sidebar/main-area/main-head shell ออก (dashboard มี shell แล้ว) */
function IS_CSS() {
  return [
    // tokens (จาก :root หน้าเดิม)
    '#is{--navy:#0D2F4F;--teal:#3DC5B7;--teal-bg:#E6F7F5;--teal-dark:#0F766E;--accent:#3DC5B7;--accent-2:#2BAA9D;--accent-bg:#E6F7F5;--accent-dark:#0F766E;--text:#1E293B;--text-muted:#64748B;--text-faint:#94A3B8;--border:#E2E8F0;--border-soft:#F1F5F9;--bg:#F7F9FB;--surface:#FFFFFF;--success:#16A34A;--success-bg:#DCFCE7;--warning:#D97706;--warning-bg:#FEF3C7;--danger:#DC2626;--danger-bg:#FEE2E2;color:var(--text);font-size:13px;line-height:1.5}',
    '#is *{box-sizing:border-box}',
    // page head (native บน dashboard · ไม่มี shell main-head เดิม)
    '#is .main-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;gap:16px}',
    '#is .main-head h1{font-size:22px;font-weight:600;color:var(--navy);margin:0;display:flex;align-items:center;gap:10px;letter-spacing:-0.02em}',
    '#is .main-head h1 .badge-version{font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;background:var(--accent);color:#fff;letter-spacing:0.04em}',
    '#is .main-head .sub{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#is .head-actions{display:flex;gap:8px;flex-wrap:wrap}',
    // buttons
    '#is .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;border:1px solid transparent;font-family:inherit}',
    '#is .btn-ghost{background:#fff;border-color:var(--border);color:var(--text-muted)}',
    '#is .btn-ghost:hover{background:#F8FAFC}',
    '#is .btn-primary{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}',
    '#is .btn-primary:hover{background:var(--accent-2)}',
    '#is .btn-sm{padding:5px 10px;font-size:11px}',
    '#is .btn[disabled]{opacity:0.5;cursor:not-allowed}',
    // view switcher
    '#is .view-switcher{display:inline-flex;padding:4px;background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:14px;flex-wrap:wrap}',
    '#is .vs-tab{padding:7px 14px;border:0;background:transparent;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '#is .vs-tab:hover{color:var(--navy)}',
    '#is .vs-tab.active{background:var(--navy);color:#fff;box-shadow:0 1px 3px rgba(13,47,79,0.2)}',
    '#is .vs-tab .count{background:rgba(255,255,255,0.18);color:#fff;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:600}',
    '#is .vs-tab:not(.active) .count{background:var(--border-soft);color:var(--text-muted)}',
    // kpi
    '#is .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}',
    '@media (max-width:700px){#is .kpi-row{grid-template-columns:repeat(2,1fr)}}',
    '#is .kpi-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px}',
    '#is .kpi-label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;font-weight:600}',
    '#is .kpi-value{font-size:22px;font-weight:600;color:var(--navy);margin-top:4px}',
    // card
    '#is .card{background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:14px}',
    '#is .card-head{padding:14px 18px;border-bottom:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center}',
    '#is .card-title{font-size:14px;font-weight:600;color:var(--navy);display:flex;align-items:center;gap:8px}',
    '#is .card-actions{display:flex;gap:8px}',
    '#is .card-body{padding:14px 18px}',
    // callout
    '#is .callout{padding:10px 14px;background:var(--accent-bg);border-left:3px solid var(--accent);border-radius:6px;font-size:12px;color:var(--accent-dark);margin-bottom:12px}',
    // filter bar
    '#is .filter-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}',
    '#is .search-input{flex:1;min-width:200px;padding:7px 12px;border:1px solid var(--border);border-radius:7px;font-size:12px;font-family:inherit;background:#fff}',
    '#is .filter-select{padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px;font-family:inherit;background:#fff}',
    // table
    '#is .tbl{width:100%;border-collapse:collapse;font-size:12px}',
    '#is .tbl th{text-align:left;padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);font-weight:600;background:#F8FAFC;border-bottom:1px solid var(--border)}',
    '#is .tbl td{padding:11px 12px;border-bottom:1px solid var(--border-soft);vertical-align:middle}',
    '#is .tbl tr:hover td{background:#F8FAFC}',
    // emp cell
    '#is .emp-cell{display:flex;align-items:center;gap:10px}',
    '#is .emp-avatar{width:32px;height:32px;border-radius:50%;background:var(--accent-bg);color:var(--accent-dark);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}',
    '#is .emp-name{font-weight:600;color:var(--navy)}',
    '#is .emp-meta{font-size:11px;color:var(--text-muted);margin-top:1px}',
    // pills
    '#is .pill{display:inline-flex;align-items:center;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;text-transform:uppercase}',
    '#is .pill-active{background:var(--success-bg);color:var(--success)}',
    '#is .pill-pending{background:var(--warning-bg);color:var(--warning)}',
    '#is .pill-done{background:var(--accent-bg);color:var(--accent-dark)}',
    '#is .pill-late{background:var(--danger-bg);color:var(--danger)}',
    '#is .pill-submitted{background:var(--success-bg);color:var(--success)}',
    '#is .pill-completed{background:var(--accent-bg);color:var(--accent-dark)}',
    '#is .pill-terminated_early{background:var(--danger-bg);color:var(--danger)}',
    // cert card
    '#is .cert-card{display:grid;grid-template-columns:48px 1fr auto;gap:14px;align-items:center;padding:14px;border:1px solid var(--border);border-radius:10px;margin-bottom:10px;background:#fff}',
    '#is .cert-icon{width:48px;height:48px;background:var(--accent-bg);color:var(--accent-dark);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700}',
    '#is .cert-meta{font-size:11px;color:var(--text-muted);display:flex;gap:12px;margin-top:3px;flex-wrap:wrap}',
    // misc
    '#is .hidden{display:none}',
    '#is .loading{padding:30px;text-align:center;color:var(--text-muted);font-size:12px}',
    '#is .empty{padding:40px 20px;text-align:center;color:var(--text-muted);font-size:12px}',
    '#is .error{background:#FEE2E2;color:#991B1B;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:12px}',
    '#is code{background:#F3F4F6;padding:1px 5px;border-radius:3px;font-size:11px;color:var(--accent-dark);font-family:Inter,monospace}',
  ].join('\n') + IS_CSS2();
}

/* CSS part 2 — toast / modal (toast/modal เป็น fixed ลอยนอก #is แต่คงไว้ scope #is สำหรับ markup ภายใน) */
function IS_CSS2() {
  return '\n' + [
    // toast (markup ฝัง element id="is-toast" ใต้ #is)
    '#is .toast{position:fixed;top:20px;right:20px;background:var(--navy);color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.2);z-index:9999;opacity:0;transition:opacity 0.2s}',
    '#is .toast.show{opacity:1}',
    '#is .toast.error{background:var(--danger)}',
    '#is .toast.success{background:var(--success)}',
    // modal
    '#is .modal{position:fixed;inset:0;background:rgba(13,47,79,0.5);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#is .modal.show{display:flex}',
    '#is .modal-content{background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;padding:20px}',
    '#is .modal-title{font-size:16px;font-weight:600;color:var(--navy);margin:0 0 10px}',
    '#is .modal-field{margin-bottom:10px}',
    '#is .modal-field label{display:block;font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:4px;text-transform:uppercase}',
    '#is .modal-field input,#is .modal-field select,#is .modal-field textarea{width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit}',
    '#is .modal-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
    '#is .modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border-soft)}',
  ].join('\n');
}

/* ===== markup เดิม ครบ head + kpi + view-switcher + callout + 4 views + 2 modals + toast =====
   คง element id เดิมทั้งหมด · ตัด sidebar/app-shell/shared_scripts/brand_footer ออก */
function IS_MARKUP() {
  return [
    // head
    '<div class="main-head">',
    '  <div>',
    '    <h1>นักศึกษาฝึกงาน <span class="badge-version" id="badgeVer">v1.11.0</span></h1>',
    '    <div class="sub">จัดการ intake · ประเมินผล · ออกหนังสือรับรองการฝึกงาน</div>',
    '  </div>',
    '  <div class="head-actions">',
    '    <button class="btn btn-ghost" onclick="switchTab(\'apps\')">',
    '      ใบสมัครรอ (<span id="badgePending">-</span>)',
    '    </button>',
    '    <button class="btn btn-primary" onclick="openWalkInModal()">เพิ่ม Intern เอง (walk-in)</button>',
    '  </div>',
    '</div>',
    // kpi
    '<div class="kpi-row" id="kpiRow">',
    '  <div class="kpi-card"><div class="kpi-label">ฝึกอยู่</div><div class="kpi-value" id="kpi-active">-</div></div>',
    '  <div class="kpi-card"><div class="kpi-label">รอประเมิน</div><div class="kpi-value" id="kpi-evals">-</div></div>',
    '  <div class="kpi-card"><div class="kpi-label">จบเดือนนี้</div><div class="kpi-value" id="kpi-ending">-</div></div>',
    '  <div class="kpi-card"><div class="kpi-label">ใบรับรอง (ปีนี้)</div><div class="kpi-value" id="kpi-certs">-</div></div>',
    '</div>',
    // view switcher
    '<div class="view-switcher">',
    '  <button class="vs-tab active" onclick="switchTab(\'list\')" id="tab-list">รายชื่อ <span class="count" id="cnt-list">-</span></button>',
    '  <button class="vs-tab" onclick="switchTab(\'apps\')" id="tab-apps">ใบสมัครจาก LINE <span class="count" id="cnt-apps">-</span></button>',
    '  <button class="vs-tab" onclick="switchTab(\'eval\')" id="tab-eval">การประเมิน <span class="count" id="cnt-eval">-</span></button>',
    '  <button class="vs-tab" onclick="switchTab(\'cert\')" id="tab-cert">ใบรับรอง <span class="count" id="cnt-cert">-</span></button>',
    '</div>',
    // callout flow
    '<div class="callout" style="background:#FEF3C7;border-left-color:#D97706;color:#92400E">',
    '  <strong>Flow:</strong> นักศึกษาสมัครผ่าน Recruit OA → ใบสมัครเข้า <code>30_Candidates</code> + <code>01c_Internship_Applications</code> → HR รีวิวที่นี่หรือ Recruit Workspace → กด <em>อนุมัติเป็น Intern</em> ระบบสร้าง record อัตโนมัติ',
    '</div>',
    // Tab: List
    '<div id="view-list">',
    '  <div class="card">',
    '    <div class="card-head"><div class="card-title">รายชื่อนักศึกษาฝึกงาน</div></div>',
    '    <div class="card-body">',
    '      <div class="filter-bar">',
    '        <input class="search-input" placeholder="ค้นหา ชื่อ / รหัส / มหาวิทยาลัย" oninput="filterList(this.value)">',
    '        <select class="filter-select" onchange="filterListStatus(this.value)">',
    '          <option value="">ทุกสถานะ</option><option value="active">กำลังฝึก</option>',
    '          <option value="completed">จบแล้ว</option><option value="terminated_early">ยุติก่อนกำหนด</option>',
    '        </select>',
    '      </div>',
    '      <div id="listBody"><div class="loading">กำลังโหลด...</div></div>',
    '    </div>',
    '  </div>',
    '</div>',
    // Tab: Applications
    '<div id="view-apps" class="hidden">',
    '  <div class="card">',
    '    <div class="card-head">',
    '      <div class="card-title">ใบสมัครจาก LINE OA</div>',
    '      <div class="card-actions"><button class="btn btn-ghost btn-sm" onclick="reloadAll()">รีเฟรช</button></div>',
    '    </div>',
    '    <div class="card-body">',
    '      <div class="callout">ใบสมัครเข้าผ่าน Recruit OA · เลขใบสมัครขึ้นต้น <code>INA-</code> · candidate row อยู่ใน <code>30_Candidates</code></div>',
    '      <div id="appsBody"><div class="loading">กำลังโหลด...</div></div>',
    '    </div>',
    '  </div>',
    '</div>',
    // Tab: Eval
    '<div id="view-eval" class="hidden">',
    '  <div class="card">',
    '    <div class="card-head"><div class="card-title">การประเมินที่รอ + ที่ส่งแล้ว</div></div>',
    '    <div class="card-body">',
    '      <div class="callout">ระบบส่ง LINE flex แจ้ง Mentor ทุกเช้าวันจันทร์ + ก่อนครบ due date 3 วัน</div>',
    '      <div id="evalBody"><div class="loading">กำลังโหลด...</div></div>',
    '    </div>',
    '  </div>',
    '</div>',
    // Tab: Cert
    '<div id="view-cert" class="hidden">',
    '  <div class="card">',
    '    <div class="card-head"><div class="card-title">หนังสือรับรองการฝึกงาน</div></div>',
    '    <div class="card-body" id="certBody"><div class="loading">กำลังโหลด...</div></div>',
    '  </div>',
    '</div>',
    IS_MODALS(),
    '<div class="toast" id="toast"></div>',
  ].join('\n');
}

/* 2 modals (approve / walk-in) · คง element id เดิม */
function IS_MODALS() {
  return [
    // Approve modal
    '<div class="modal" id="approveModal">',
    '  <div class="modal-content">',
    '    <h3 class="modal-title" id="approveTitle">อนุมัติ Intern</h3>',
    '    <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px" id="approveSubtitle">-</div>',
    '    <div class="modal-field"><label>Mentor (พนักงานพี่เลี้ยง) *</label>',
    '      <input id="ap_mentor_id" placeholder="employee_id เช่น YY-007"></div>',
    '    <div class="modal-field"><label>Supervisor (หัวหน้าแผนก)</label>',
    '      <input id="ap_supervisor_id" placeholder="employee_id (optional)"></div>',
    '    <div class="modal-row">',
    '      <div class="modal-field"><label>วันเริ่ม *</label><input id="ap_start" type="date"></div>',
    '      <div class="modal-field"><label>วันจบ *</label><input id="ap_end" type="date"></div>',
    '    </div>',
    '    <div class="modal-row">',
    '      <div class="modal-field"><label>Position ID</label>',
    '        <input id="ap_position_id" placeholder="intern_pt / intern_marketing / ..."></div>',
    '      <div class="modal-field"><label>Stipend (บาท/เดือน)</label>',
    '        <input id="ap_stipend" type="number" value="0"></div>',
    '    </div>',
    '    <div class="modal-field"><label>หัวข้อโปรเจกต์</label><textarea id="ap_project_topic" rows="2"></textarea></div>',
    '    <div class="modal-field"><label>ความถี่ประเมิน</label>',
    '      <select id="ap_eval_freq">',
    '        <option value="monthly_plus_final" selected>รายเดือน + สรุปจบ</option>',
    '        <option value="weekly_plus_monthly_plus_final">รายสัปดาห์+เดือน+จบ</option>',
    '        <option value="start_mid_end">เริ่ม-กลาง-จบ</option>',
    '      </select>',
    '    </div>',
    '    <div class="modal-actions">',
    '      <button class="btn btn-ghost" onclick="closeApprove()">ยกเลิก</button>',
    '      <button class="btn btn-primary" id="apConfirmBtn" onclick="confirmApprove()">อนุมัติ + สร้าง intern</button>',
    '    </div>',
    '  </div>',
    '</div>',
    // Walk-in modal
    '<div class="modal" id="walkInModal">',
    '  <div class="modal-content">',
    '    <h3 class="modal-title">เพิ่ม Intern เอง (walk-in / referral)</h3>',
    '    <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">สำหรับนักศึกษาที่ไม่ได้สมัครผ่าน LINE · กรอกครบแล้วระบบ skip Recruit pipeline</div>',
    '    <div class="modal-field"><label>ชื่อ-นามสกุล (ภาษาไทย) *</label><input id="wi_full_name_th"></div>',
    '    <div class="modal-row">',
    '      <div class="modal-field"><label>ชื่อเล่น</label><input id="wi_nickname"></div>',
    '      <div class="modal-field"><label>Email</label><input id="wi_email" type="email"></div>',
    '    </div>',
    '    <div class="modal-field"><label>เบอร์โทรศัพท์ *</label><input id="wi_phone"></div>',
    '    <div class="modal-field"><label>มหาวิทยาลัย *</label><input id="wi_university"></div>',
    '    <div class="modal-row">',
    '      <div class="modal-field"><label>คณะ *</label><input id="wi_faculty"></div>',
    '      <div class="modal-field"><label>ชั้นปี *</label>',
    '        <select id="wi_year"><option>1</option><option>2</option><option>3</option><option selected>4</option></select>',
    '      </div>',
    '    </div>',
    '    <div class="modal-row">',
    '      <div class="modal-field"><label>แผนกที่ฝึก *</label>',
    '        <select id="wi_dept">',
    '          <option>PT</option><option>Marketing</option><option>HR</option>',
    '          <option>Accounting</option><option>IT</option><option>Front Office</option>',
    '        </select>',
    '      </div>',
    '      <div class="modal-field"><label>สาขา</label>',
    '        <select id="wi_branch"><option value="BR00">BR00 · HQ</option><option value="BR01">BR01</option><option value="BR02">BR02</option></select>',
    '      </div>',
    '    </div>',
    '    <div class="modal-row">',
    '      <div class="modal-field"><label>วันเริ่ม *</label><input id="wi_start" type="date"></div>',
    '      <div class="modal-field"><label>วันจบ *</label><input id="wi_end" type="date"></div>',
    '    </div>',
    '    <div class="modal-field"><label>Mentor (employee_id)</label><input id="wi_mentor"></div>',
    '    <div class="modal-actions">',
    '      <button class="btn btn-ghost" onclick="closeWalkIn()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="confirmWalkIn()">สร้าง intern + LINE flex แจ้ง mentor</button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   IS_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → IS_BACKEND
   helper (esc/fmtDate/toast) คงของหน้าเดิม (shadow ภายใน closure · ไม่แตะ global)
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function IS_RUN_PAGE_JS() {

  // ---- google.script.run shim → IS_BACKEND (async, คืน shape เดิม) ----
  function _is2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (IS_BACKEND[prop]) {
            Promise.resolve().then(function () { return IS_BACKEND[prop].apply(IS_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[IS_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[IS_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _is2MakeChain(); } });

  // scope ใต้ #is กันชน id · alias document.getElementById → getById
  const _isRoot = document.getElementById('is');
  function getById(id) { return _isRoot ? _isRoot.querySelector('#' + id) : document.getElementById(id); }
  const document_ = { getElementById: getById };

  /* ====================================================================
     ===== JS หน้าเดิม internship_manager.html (ลอกทั้งดุ้น) =====
     แก้เฉพาะ document.getElementById → document_.getElementById (scope #is)
     ==================================================================== */
  let _interns = [];
  let _apps = [];
  let _evals = [];
  let _certs = { ready: [], issued: [] };
  let _approveContext = null;

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  }
  function toast(msg, type) {
    const el = document_.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    setTimeout(() => el.classList.remove('show'), 3000);
  }
  window.is2Toast = toast;

  function switchTab(name) {
    ['list', 'apps', 'eval', 'cert'].forEach(n => {
      const v = document_.getElementById('view-' + n);
      const t = document_.getElementById('tab-' + n);
      if (v) v.classList.add('hidden');
      if (t) t.classList.remove('active');
    });
    const vv = document_.getElementById('view-' + name);
    const tt = document_.getElementById('tab-' + name);
    if (vv) vv.classList.remove('hidden');
    if (tt) tt.classList.add('active');
  }

  function reloadAll() {
    // KPI counts
    google.script.run.withSuccessHandler(res => {
      if (!res || !res.ok) return;
      document_.getElementById('kpi-active').textContent = res.counts.active;
      document_.getElementById('kpi-evals').textContent = res.counts.pending_evals;
      document_.getElementById('kpi-ending').textContent = res.counts.ending_this_month;
      document_.getElementById('kpi-certs').textContent = res.counts.certs_this_year;
      document_.getElementById('badgePending').textContent = res.counts.pending_apps;
      document_.getElementById('cnt-apps').textContent = res.counts.pending_apps;
      document_.getElementById('cnt-eval').textContent = res.counts.pending_evals;
    }).internshipAdminDashboard();

    // Interns list
    google.script.run.withSuccessHandler(res => {
      if (!res || !res.ok) return;
      _interns = res.rows || [];
      document_.getElementById('cnt-list').textContent = _interns.length;
      renderInterns(_interns);
    }).internshipAdminListInterns({});

    // Applications
    google.script.run.withSuccessHandler(res => {
      if (!res || !res.ok) return;
      _apps = res.rows || [];
      renderApps(_apps);
    }).internshipAdminListPendingApps({});

    // Evaluations
    google.script.run.withSuccessHandler(res => {
      if (!res || !res.ok) return;
      _evals = res.rows || [];
      renderEvals(_evals);
    }).internshipAdminListPendingEvals({});

    // Certs
    google.script.run.withSuccessHandler(res => {
      if (!res || !res.ok) return;
      _certs = { ready: res.ready || [], issued: res.issued || [] };
      document_.getElementById('cnt-cert').textContent = _certs.ready.length;
      renderCerts(_certs);
    }).internshipAdminListCertReady();
  }

  function renderInterns(rows) {
    const body = document_.getElementById('listBody');
    if (rows.length === 0) {
      body.innerHTML = '<div class="empty">ยังไม่มีนักศึกษาฝึกงาน</div>';
      return;
    }
    let html = '<table class="tbl"><thead><tr>' +
      '<th>นักศึกษา</th><th>มหาวิทยาลัย</th><th>แผนก / Mentor</th><th>ช่วงเวลา</th>' +
      '<th>ประเมิน</th><th>สถานะ</th><th></th></tr></thead><tbody>';
    rows.forEach(r => {
      const initial = (r.nickname || r.full_name_th || '?').charAt(0);
      html += `<tr>
        <td><div class="emp-cell"><div class="emp-avatar">${esc(initial)}</div>
          <div><div class="emp-name">${esc(r.nickname || r.full_name_th)}</div>
          <div class="emp-meta">${esc(r.employee_id)} · ชั้นปี ${esc(r.year_of_study)}</div></div></div></td>
        <td><div>${esc(r.university)}</div><div class="emp-meta">${esc(r.faculty)}</div></td>
        <td><div>${esc(r.internship_dept)}</div><div class="emp-meta">${esc(r.mentor_id || '-')}</div></td>
        <td><div>${fmtDate(r.start_date)} — ${fmtDate(r.end_date)}</div></td>
        <td><div>${esc(r.overall_score || '-')} / 5.0</div><div class="emp-meta">${esc(r.evals_submitted)}/${esc(r.evals_total)} ส่ง</div></td>
        <td><span class="pill pill-${esc(r.profile_status || 'active')}">${esc(r.profile_status || 'active')}</span></td>
        <td><button class="btn btn-ghost btn-sm" onclick="viewIntern('${esc(r.employee_id)}')">ดู</button></td>
      </tr>`;
    });
    html += '</tbody></table>';
    body.innerHTML = html;
  }

  function renderApps(rows) {
    const body = document_.getElementById('appsBody');
    if (rows.length === 0) {
      body.innerHTML = '<div class="empty">ไม่มีใบสมัครรอรีวิว</div>';
      return;
    }
    let html = '<table class="tbl"><thead><tr>' +
      '<th>ผู้สมัคร</th><th>มหาวิทยาลัย / สาขา</th><th>แผนก / ช่วง</th>' +
      '<th>เอกสาร</th><th>ส่งเมื่อ</th><th></th></tr></thead><tbody>';
    rows.forEach(r => {
      const initial = (r.nickname || r.full_name_th || '?').charAt(0);
      const docs = (r.attached || []).map(d => `<span class="pill pill-done">${esc(d)}</span>`).join(' ');
      html += `<tr>
        <td><div class="emp-cell"><div class="emp-avatar">${esc(initial)}</div>
          <div><div class="emp-name">${esc(r.full_name_th)}</div>
          <div class="emp-meta">${esc(r.application_id)} · ชั้นปี ${esc(r.year_of_study)} · GPA ${esc(r.gpa || '-')}</div></div></div></td>
        <td><div>${esc(r.university)}</div><div class="emp-meta">${esc(r.faculty)} · ${esc(r.major)}</div></td>
        <td><div>${esc(r.preferred_dept)} — ${esc(r.preferred_branch_id)}</div>
          <div class="emp-meta">${fmtDate(r.desired_start_date)} — ${fmtDate(r.desired_end_date)}</div></td>
        <td>${docs || '-'}</td>
        <td>${fmtDate(r.submitted_at)}</td>
        <td><div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" onclick="rejectApp('${esc(r.application_id)}')">Reject</button>
          <button class="btn btn-primary btn-sm" onclick="openApprove('${esc(r.candidate_id)}', '${esc(r.application_id)}')">อนุมัติ</button>
        </div></td>
      </tr>`;
    });
    html += '</tbody></table>';
    body.innerHTML = html;
  }

  function renderEvals(rows) {
    const body = document_.getElementById('evalBody');
    if (rows.length === 0) {
      body.innerHTML = '<div class="empty">ไม่มีรอบประเมิน</div>';
      return;
    }
    let html = '<table class="tbl"><thead><tr>' +
      '<th>นักศึกษา</th><th>รอบ</th><th>ช่วง</th><th>Mentor</th>' +
      '<th>กำหนดส่ง</th><th>คะแนน</th><th>สถานะ</th><th></th></tr></thead><tbody>';
    rows.forEach(ev => {
      const isDone = ev.status === 'submitted';
      html += `<tr style="${isDone ? 'opacity:0.7' : ''}">
        <td>${esc(ev.intern_name)}<div class="emp-meta">${esc(ev.employee_id)}</div></td>
        <td>${esc(ev.period_label)} · ${esc(ev.period_type)}</td>
        <td>${fmtDate(ev.period_start)} — ${fmtDate(ev.period_end)}</td>
        <td>${esc(ev.mentor_name)}</td>
        <td>${fmtDate(ev.due_date)}</td>
        <td>${esc(ev.overall_score || '-')}</td>
        <td><span class="pill pill-${esc(ev.status)}">${esc(ev.status)}</span></td>
        <td>${isDone ? '' : `<button class="btn btn-ghost btn-sm" onclick="remindMentor('${esc(ev.eval_id)}')">ส่งเตือน</button>`}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    body.innerHTML = html;
  }

  function renderCerts(data) {
    const body = document_.getElementById('certBody');
    let html = '';
    html += '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600;margin-bottom:8px">รอออก (' + data.ready.length + ')</div>';
    if (data.ready.length === 0) {
      html += '<div class="empty">ไม่มี intern ที่รอออกใบรับรอง</div>';
    } else {
      data.ready.forEach(r => {
        const initial = (r.nickname || r.full_name_th || '?').charAt(0);
        html += `<div class="cert-card">
          <div class="cert-icon">${esc(initial)}</div>
          <div>
            <div class="emp-name">${esc(r.nickname || r.full_name_th)} (${esc(r.employee_id)}) — ${esc(r.internship_dept)}</div>
            <div class="cert-meta">
              <span>${esc(r.university)}</span><span>·</span>
              <span>${fmtDate(r.start_date)} — ${fmtDate(r.end_date)} (${esc(r.days)} วัน)</span><span>·</span>
              <span>คะแนนเฉลี่ย ${esc(r.overall_score)} / 5.0</span>
            </div>
          </div>
          <div><button class="btn btn-primary btn-sm" onclick="issueCert('${esc(r.employee_id)}')">ออกใบรับรอง</button></div>
        </div>`;
      });
    }
    html += '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600;margin:18px 0 8px">ออกแล้ว (' + data.issued.length + ' รายการล่าสุด)</div>';
    data.issued.slice(0, 10).forEach(r => {
      const initial = (r.nickname || r.full_name_th || '?').charAt(0);
      html += `<div class="cert-card" style="background:#FAFBFC">
        <div class="cert-icon" style="background:var(--success-bg);color:var(--success)">${esc(initial)}</div>
        <div>
          <div class="emp-name">${esc(r.nickname || r.full_name_th)} (${esc(r.employee_id)}) — ${esc(r.internship_dept)}</div>
          <div class="cert-meta">
            <span>เลขที่ ${esc(r.cert_no)}</span><span>·</span>
            <span>${fmtDate(r.issued_at)}</span>
          </div>
        </div>
        <div>${r.file_url ? `<a class="btn btn-ghost btn-sm" href="${esc(r.file_url)}" target="_blank">ดู PDF</a>` : ''}</div>
      </div>`;
    });
    body.innerHTML = html;
  }

  function filterList(q) {
    const search = String(q || '').toLowerCase();
    const filtered = _interns.filter(r =>
      (r.full_name_th || '').toLowerCase().includes(search) ||
      (r.nickname || '').toLowerCase().includes(search) ||
      (r.university || '').toLowerCase().includes(search) ||
      (r.employee_id || '').toLowerCase().includes(search)
    );
    renderInterns(filtered);
  }
  function filterListStatus(s) {
    const filtered = s ? _interns.filter(r => r.profile_status === s) : _interns;
    renderInterns(filtered);
  }

  function openApprove(candidateId, applicationId) {
    const app = _apps.find(a => a.application_id === applicationId);
    _approveContext = { candidate_id: candidateId, application_id: applicationId, app: app };
    if (!app) return;
    document_.getElementById('approveTitle').textContent = 'อนุมัติ: ' + (app.full_name_th || '-');
    document_.getElementById('approveSubtitle').textContent =
      `${app.university} · ${app.faculty} · ชั้นปี ${app.year_of_study} · แผนก ${app.preferred_dept}`;
    document_.getElementById('ap_start').value = app.desired_start_date || '';
    document_.getElementById('ap_end').value = app.desired_end_date || '';
    document_.getElementById('ap_position_id').value = 'intern_' + (app.preferred_dept || 'general').toLowerCase().replace(/\s+/g, '_');
    document_.getElementById('approveModal').classList.add('show');
  }
  function closeApprove() {
    document_.getElementById('approveModal').classList.remove('show');
    _approveContext = null;
  }
  function confirmApprove() {
    if (!_approveContext) return;
    const overrides = {
      mentor_id: document_.getElementById('ap_mentor_id').value,
      supervisor_id: document_.getElementById('ap_supervisor_id').value,
      start_date: document_.getElementById('ap_start').value,
      end_date: document_.getElementById('ap_end').value,
      position_id: document_.getElementById('ap_position_id').value,
      stipend_amount: document_.getElementById('ap_stipend').value,
      project_topic: document_.getElementById('ap_project_topic').value,
      eval_frequency: document_.getElementById('ap_eval_freq').value,
    };
    const btn = document_.getElementById('apConfirmBtn');
    btn.disabled = true; btn.textContent = 'กำลังสร้าง...';
    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false; btn.textContent = 'อนุมัติ + สร้าง intern';
        if (res && res.ok) {
          toast('สร้าง intern ' + res.employee_id + ' สำเร็จ · ส่ง LINE flex แล้ว', 'success');
          closeApprove();
          reloadAll();
        } else {
          toast((res && res.error) || 'ผิดพลาด', 'error');
        }
      })
      .withFailureHandler(err => {
        btn.disabled = false; btn.textContent = 'อนุมัติ + สร้าง intern';
        toast('ผิดพลาด: ' + (err && err.message), 'error');
      })
      .internshipAdminApprove(_approveContext.candidate_id, overrides);
  }

  function rejectApp(applicationId) {
    const reason = prompt('เหตุผลที่ไม่ผ่าน (ใส่ก็ได้ ไม่ใส่ก็ได้ — ใช้ใน internal audit เท่านั้น):');
    if (reason === null) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.ok) { toast('Reject แล้ว', 'success'); reloadAll(); }
        else toast((res && res.error) || 'ผิดพลาด', 'error');
      })
      .withFailureHandler(err => toast('ผิดพลาด: ' + (err && err.message), 'error'))
      .internshipAdminReject(applicationId, reason);
  }

  function openWalkInModal() { document_.getElementById('walkInModal').classList.add('show'); }
  function closeWalkIn() { document_.getElementById('walkInModal').classList.remove('show'); }
  function confirmWalkIn() {
    const payload = {
      full_name_th: document_.getElementById('wi_full_name_th').value,
      nickname: document_.getElementById('wi_nickname').value,
      email: document_.getElementById('wi_email').value,
      phone: document_.getElementById('wi_phone').value,
      university: document_.getElementById('wi_university').value,
      faculty: document_.getElementById('wi_faculty').value,
      year_of_study: document_.getElementById('wi_year').value,
      preferred_dept: document_.getElementById('wi_dept').value,
      preferred_branch_id: document_.getElementById('wi_branch').value,
      desired_start_date: document_.getElementById('wi_start').value,
      desired_end_date: document_.getElementById('wi_end').value,
      mentor_id: document_.getElementById('wi_mentor').value,
      auto_approve: true,
    };
    if (!payload.full_name_th || !payload.university || !payload.preferred_dept) {
      toast('กรอกข้อมูลที่จำเป็นให้ครบ', 'error'); return;
    }
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.ok) {
          toast('สร้าง intern ' + (res.employee_id || '') + ' สำเร็จ', 'success');
          closeWalkIn(); reloadAll();
        } else toast('ผิดพลาด: ' + ((res && res.error) || ''), 'error');
      })
      .withFailureHandler(err => toast('ผิดพลาด: ' + (err && err.message), 'error'))
      .internshipAdminWalkIn(payload);
  }

  function viewIntern(empId) {
    if (typeof window.navTo === 'function') window.navTo('employee360', { id: empId });
    else if (typeof navTo === 'function') navTo('employee360', { id: empId });
    else window.location = '?page=employee360&id=' + encodeURIComponent(empId);
  }
  function remindMentor(evalId) {
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.ok) toast('ส่ง LINE flex แจ้ง mentor แล้ว', 'success');
        else toast((res && res.error) || 'ผิดพลาด', 'error');
      })
      .withFailureHandler(err => toast('ผิดพลาด: ' + (err && err.message), 'error'))
      .internshipAdminRemindMentor(evalId);
  }
  function issueCert(employeeId) {
    if (!confirm('ออกหนังสือรับรองสำหรับ ' + employeeId + '?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.ok) { toast('ออกหนังสือ ' + res.cert_no + ' สำเร็จ', 'success'); reloadAll(); }
        else toast('ผิดพลาด: ' + ((res && res.error) || ''), 'error');
      })
      .withFailureHandler(err => toast('ผิดพลาด: ' + (err && err.message), 'error'))
      .internshipAdminIssueCert(employeeId, {});
  }

  /* ===== expose fn ที่ inline onclick ต้องเรียก ไปยัง window ===== */
  const _exp = {
    switchTab, reloadAll, filterList, filterListStatus,
    openApprove, closeApprove, confirmApprove, rejectApp,
    openWalkInModal, closeWalkIn, confirmWalkIn,
    viewIntern, remindMentor, issueCert,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  reloadAll();
}

/* ===== expose mount ไปยัง window (index.html PORTED_FN เรียก) ===== */
if (typeof window !== 'undefined') window.mountInternship = mountInternship;
