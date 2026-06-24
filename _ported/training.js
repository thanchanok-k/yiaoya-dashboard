// _ported/training.js — native port of training_manager.html (HR Training Catalog admin)
// ลอกทั้งดุ้น: 4 stat cards + 2 tab (คอร์ส / Enrollments) + course editor modal
//   CSS เดิม (<style> ในหน้า manager) prefix #tr ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ mountTraining() · google.script.run = shim → TR_BACKEND (Supabase)
//
// ใช้ global sb (index.html module scope) — ห้าม redeclare global sb/esc/$
//   หน้าเดิมมี esc() เป็นของตัวเอง → คงไว้ใน closure (shadow ภายใน · ไม่แตะ global)
// top-level fn = mountTraining() ผูก window
//
// backend (edge fn hr_list?type=training.updated → {items}) :
//   list   → items = enrollment payloads (enrollment_id/employee_id/course/status...)
//            derive enrollments + courses (จัดกลุ่มจาก enrollment) + compliance stats client-side
//            ว่าง = 0 รายการ → render empty state ได้ ไม่ error
//   whoami → {ok:true, is_owner:true} (dashboard user = admin เต็มสิทธิ์)
//   upsert course / auto-enroll → stub + toast "ยังไม่พร้อม" (เขียนกลับยังไม่รองรับบน dashboard)

/* ============================================================
   TR_BACKEND — map google.script.run → Supabase edge fn hr_list (type=training.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     trainingAdminCompliance()            → {ok,active,overdue,completed}
     trainingAdminListCourses({})         → {courses:[{course_id,title,category,provider,
                                              duration_hours,ce_credits,renewal_required,
                                              renewal_cycle_months,required_for_positions,
                                              linked_license_type,cost_per_seat,attachment_url,
                                              description,stats:{total_enrolled,active,overdue}}]}
     trainingAdminListEnrollments({})     → {enrollments:[{employee_name,course_title,category,
                                              enrolled_at,due_date,status,certificate_url,...}]}
     trainingAdminUpsertCourse(payload)   → {ok:false,...} stub
     trainingAdminAutoEnroll(id,{})       → {ok:false,...} stub
   ============================================================ */
var TR_FN = 'hr_list';
var TR_TYPE = 'training.updated';

function tr2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function tr2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function tr2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// map payload event ดิบ (1 enrollment) → enrollment row shape ที่ JS เดิมใช้
function tr2MapEnrollment(p) {
  p = p || {};
  return {
    enrollment_id: p.enrollment_id || p.entity_id || '',
    employee_id: p.employee_id || '',
    employee_name: p.employee_name || p.employee_id || '—',
    course_id: p.course_id || '',
    course_title: p.course_title || p.course || p.title || '—',
    category: String(p.category || 'elective').toLowerCase(),
    enrolled_at: tr2Date(p.enrolled_at || p.created_at),
    due_date: tr2Date(p.due_date),
    status: String(p.status || 'enrolled').toLowerCase(),
    certificate_url: p.certificate_url || p.cert_url || '',
    // course meta อาจติดมากับ enrollment payload (ใช้ derive course)
    provider: p.provider || '',
    duration_hours: tr2Num(p.duration_hours),
    ce_credits: tr2Num(p.ce_credits),
    renewal_required: !!p.renewal_required,
    renewal_cycle_months: tr2Num(p.renewal_cycle_months),
    required_for_positions: p.required_for_positions || '',
    linked_license_type: p.linked_license_type || '',
    cost_per_seat: tr2Num(p.cost_per_seat),
    attachment_url: p.attachment_url || '',
    description: p.description || '',
    _raw: p,
  };
}

// cache enrollments ล่าสุด (dedupe ต่อ enrollment_id)
var _tr2Enr = [];

function tr2FetchEnrollments() {
  return sb.functions.invoke(TR_FN + '?type=' + encodeURIComponent(TR_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = tr2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.enrollment_id || p.entity_id || '';
      var key = id || (p.employee_id + '|' + (p.course_id || p.course || ''));
      if (seen[key]) return;
      seen[key] = true;
      rows.push(tr2MapEnrollment(p));
    });
    _tr2Enr = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[TR_BACKEND] list fetch failed', e);
    _tr2Enr = [];
    return [];
  });
}

// derive courses จาก enrollments (จัดกลุ่มตาม course_id/course_title) + คำนวณ stats
function tr2DeriveCourses(enr) {
  var byCourse = {};
  enr.forEach(function (e) {
    var cid = e.course_id || e.course_title || '';
    if (!cid) return;
    if (!byCourse[cid]) {
      byCourse[cid] = {
        course_id: e.course_id || cid,
        title: e.course_title || cid,
        category: e.category || 'elective',
        provider: e.provider || '',
        duration_hours: e.duration_hours || 0,
        ce_credits: e.ce_credits || 0,
        renewal_required: !!e.renewal_required,
        renewal_cycle_months: e.renewal_cycle_months || 0,
        required_for_positions: e.required_for_positions || '',
        linked_license_type: e.linked_license_type || '',
        cost_per_seat: e.cost_per_seat || 0,
        attachment_url: e.attachment_url || '',
        description: e.description || '',
        stats: { total_enrolled: 0, active: 0, overdue: 0 },
      };
    }
    var c = byCourse[cid];
    c.stats.total_enrolled++;
    if (e.status === 'overdue') c.stats.overdue++;
    if (e.status === 'enrolled' || e.status === 'in_progress') c.stats.active++;
  });
  return Object.keys(byCourse).map(function (k) { return byCourse[k]; });
}

function tr2Compliance(enr) {
  var active = 0, overdue = 0, completed = 0;
  enr.forEach(function (e) {
    if (e.status === 'completed') completed++;
    else if (e.status === 'overdue') overdue++;
    else if (e.status === 'enrolled' || e.status === 'in_progress') active++;
  });
  return { ok: true, active: active, overdue: overdue, completed: completed };
}

var TR_BACKEND = {
  // role gate — dashboard user = admin เต็มสิทธิ์
  trainingAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },
  // compliance stats (active/overdue/completed)
  trainingAdminCompliance: function () {
    return tr2FetchEnrollments().then(function (enr) { return tr2Compliance(enr); });
  },
  // list courses — derive จาก enrollments
  trainingAdminListCourses: function () {
    return tr2FetchEnrollments().then(function (enr) {
      return { courses: tr2DeriveCourses(enr) };
    });
  },
  // list enrollments
  trainingAdminListEnrollments: function () {
    return tr2FetchEnrollments().then(function (enr) {
      return { enrollments: enr };
    });
  },
  // upsert course — stub (เขียนกลับยังไม่รองรับบน dashboard)
  trainingAdminUpsertCourse: function () {
    tr2NotReady('บันทึก/แก้ไขคอร์ส');
    return Promise.resolve({ ok: false, error: 'การบันทึกคอร์สยังไม่พร้อมบน dashboard' });
  },
  // auto-enroll — stub
  trainingAdminAutoEnroll: function () {
    tr2NotReady('Auto-enroll');
    return Promise.resolve({ ok: false, error: 'Auto-enroll ยังไม่พร้อมบน dashboard', enrolled: 0, skipped: 0 });
  },
};

var _tr2NotReadyShown = {};
function tr2NotReady(feature) {
  if (_tr2NotReadyShown[feature]) return;
  _tr2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.tr2Toast) window.tr2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountTraining — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountTraining() {
  if (!document.getElementById('wrap-training')) return;
  var wrap = document.getElementById('wrap-training');

  var CSS = TR_CSS();
  var MARKUP = TR_MARKUP();
  wrap.innerHTML = '<style>' + CSS + '</style><div id="tr">' + MARKUP + '</div>';

  // รัน JS ของหน้าเดิม (closure scope · google = shim) → ผูก fn ที่ inline onclick ต้องใช้ ลง window
  TR_RUN_PAGE_JS();
}

/* ===== CSS เดิม (<style> manager) · prefix ทุก selector ด้วย #tr =====
   ตัด .top wrapper / app-shell / page-head shell ออก (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด */
function TR_CSS() {
  return [
    // tokens (scope ใต้ #tr)
    '#tr{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--teal-dark:#0F766E;--bg:#F8F9FA;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--warn:#F59E0B;--success:#16A34A;color:var(--navy);font-size:14px}',
    '#tr *,#tr *::before,#tr *::after{box-sizing:border-box}',
    // top bar (mini header เดิม)
    '#tr .top{background:var(--navy);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;border-radius:10px 10px 0 0}',
    '#tr .top-t{font-size:16px;font-weight:600}',
    '#tr .top-b{background:var(--teal);padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600}',
    '#tr .top-spacer{flex:1}',
    '#tr .btn{padding:8px 14px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;border:none;font-family:inherit}',
    '#tr .btn-p{background:var(--teal);color:#fff}',
    // stats
    '#tr .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 0}',
    '@media (max-width:700px){#tr .stats{grid-template-columns:repeat(2,1fr)}}',
    '#tr .st{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;border-left-width:3px}',
    '#tr .st.ac{border-left-color:var(--teal)}',
    '#tr .st.ov{border-left-color:var(--error)}',
    '#tr .st.cp{border-left-color:var(--success)}',
    '#tr .st.tt{border-left-color:var(--navy)}',
    '#tr .st-n{font-size:24px;font-weight:600}',
    '#tr .st-l{font-size:11px;color:var(--muted);margin-top:3px}',
    // tabs
    '#tr .tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);background:#fff;border-radius:8px 8px 0 0}',
    '#tr .tab{padding:11px 16px;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;font-weight:500}',
    '#tr .tab.act{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    '#tr .body{padding:14px 0}',
    // table
    '#tr table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)}',
    '#tr th{background:var(--navy);color:#fff;padding:11px 12px;font-size:11px;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:.3px}',
    '#tr td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border);vertical-align:middle}',
    '#tr tr:hover td{background:var(--teal-light)}',
    '#tr td a{color:var(--teal-dark)}',
    // pills
    '#tr .pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600}',
    '#tr .pill.man{background:#FEE2E2;color:#B91C1C}',
    '#tr .pill.reg{background:#DBEAFE;color:#1E40AF}',
    '#tr .pill.cli{background:#FEF3C7;color:#B45309}',
    '#tr .pill.saf{background:#FED7AA;color:#9A3412}',
    '#tr .pill.ele{background:#F3F4F6;color:#4B5563}',
    '#tr .pill.soft{background:#EDE9FE;color:#5B21B6}',
    '#tr .pill.ac{background:#DBEAFE;color:#1E40AF}',
    '#tr .pill.pr{background:#FEF3C7;color:#B45309}',
    '#tr .pill.ov{background:#FEE2E2;color:#B91C1C}',
    '#tr .pill.cp{background:#D1FAE5;color:#047857}',
    // row actions
    '#tr .row-act{display:flex;gap:5px}',
    '#tr .rb{padding:5px 10px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:#fff;color:var(--navy);font-family:inherit}',
    '#tr .rb.p{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#tr .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    // modal (scope ใต้ #tr · z-index สูง · fixed)
    '#tr .modal-bg{display:none;position:fixed;inset:0;background:rgba(13,47,79,.6);z-index:9000;align-items:center;justify-content:center;padding:20px}',
    '#tr .modal-bg.open{display:flex}',
    '#tr .modal{background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto}',
    '#tr .modal-h{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
    '#tr .modal-t{font-size:15px;font-weight:600}',
    '#tr .modal-x{background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer}',
    '#tr .modal-b{padding:16px 20px}',
    '#tr .field{margin-bottom:11px}',
    '#tr .field-l{display:block;font-size:11px;font-weight:600;margin-bottom:5px;letter-spacing:.3px}',
    '#tr .req{color:var(--error)}',
    '#tr .field-i{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;color:var(--navy)}',
    '#tr .field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '#tr .modal-f{padding:14px 20px;border-top:1px solid var(--border);display:flex;gap:9px;justify-content:flex-end}',
  ].join('\n');
}

/* ===== markup เดิม ครบ · คง element id เดิม =====
   ตัด app-shell/sidebar/page-head/brand_footer · คงทุก id ที่ JS เดิมใช้ */
function TR_MARKUP() {
  return [
    '<div class="top">',
    '  <div class="top-t">Training Catalog</div>',
    '  <div class="top-b">TRC</div>',
    '  <div class="top-spacer"></div>',
    '  <button class="btn btn-p" onclick="openCourseModal()">+ คอร์สใหม่</button>',
    '</div>',
    '<div class="stats" id="stats">',
    '  <div class="st tt"><div class="st-n" id="stT">–</div><div class="st-l">คอร์สทั้งหมด</div></div>',
    '  <div class="st ac"><div class="st-n" id="stA">–</div><div class="st-l">กำลังเรียน</div></div>',
    '  <div class="st ov"><div class="st-n" id="stO">–</div><div class="st-l">เลยกำหนด</div></div>',
    '  <div class="st cp"><div class="st-n" id="stC">–</div><div class="st-l">เสร็จแล้ว</div></div>',
    '</div>',
    '<div class="tabs" id="tabs">',
    '  <div class="tab act" onclick="trSetTab(\'courses\')">คอร์ส <span style="font-size:10px;color:var(--muted)" id="tcCourses"></span></div>',
    '  <div class="tab" onclick="trSetTab(\'enrollments\')">Enrollments <span style="font-size:10px;color:var(--muted)" id="tcEnr"></span></div>',
    '</div>',
    '<div class="body" id="tableWrap"><div class="empty">กำลังโหลด...</div></div>',
    '<div class="modal-bg" id="modalBg" onclick="if(event.target===this)trCloseModal()">',
    '  <div class="modal">',
    '    <div class="modal-h"><div class="modal-t" id="mt">คอร์สใหม่</div><button class="modal-x" onclick="trCloseModal()">×</button></div>',
    '    <div class="modal-b" id="mb"></div>',
    '    <div class="modal-f" id="mf"></div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   TR_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → TR_BACKEND
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   id ทุกตัวที่หน้าเดิมอ้าง = อยู่ใต้ #tr อยู่แล้ว (getElementById ใช้ได้ตรง ๆ)
   ============================================================ */
function TR_RUN_PAGE_JS() {

  // ---- google.script.run shim → TR_BACKEND (async, คืน shape เดิม) ----
  function _tr2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (TR_BACKEND[prop]) {
            Promise.resolve().then(function () { return TR_BACKEND[prop].apply(TR_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[TR_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[TR_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _tr2MakeChain(); } });

  // ---- toast (แทน alert ของหน้าเดิม + ใช้กับ stub) ----
  function showToast(msg, type) {
    var t = document.getElementById('tr2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'tr2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.tr2Toast = showToast;

  /* =========================================================
     ↓↓↓ JS หน้าเดิม (training_manager.html) ทั้งดุ้น ↓↓↓
     - คง esc() ของหน้าเดิม (closure scope · ไม่แตะ global esc)
     - alert() → showToast (dashboard ไม่ block UI), confirm() คงไว้
     ========================================================= */
  var _state = { tab: 'courses', courses: [], enrollments: [], editing: null };

  function init() { loadCourses(); loadCompliance(); }

  function loadCompliance() {
    google.script.run.withSuccessHandler(function (r) {
      if (!r || !r.ok) return;
      document.getElementById('stT').textContent = _state.courses.length || '0';
      document.getElementById('stA').textContent = r.active || 0;
      document.getElementById('stO').textContent = r.overdue || 0;
      document.getElementById('stC').textContent = r.completed || 0;
    }).trainingAdminCompliance();
  }

  function loadCourses() {
    document.getElementById('tableWrap').innerHTML = '<div class="empty">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(function (r) {
      _state.courses = (r && r.courses) || [];
      document.getElementById('tcCourses').textContent = '(' + _state.courses.length + ')';
      document.getElementById('stT').textContent = _state.courses.length;
      if (_state.tab === 'courses') renderCourses();
    }).trainingAdminListCourses({});
  }

  function loadEnrollments() {
    document.getElementById('tableWrap').innerHTML = '<div class="empty">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(function (r) {
      _state.enrollments = (r && r.enrollments) || [];
      document.getElementById('tcEnr').textContent = '(' + _state.enrollments.length + ')';
      if (_state.tab === 'enrollments') renderEnrollments();
    }).trainingAdminListEnrollments({});
  }

  function trSetTab(t) {
    _state.tab = t;
    document.querySelectorAll('#tr .tab').forEach(function (el, i) {
      el.classList.toggle('act', (i === 0 && t === 'courses') || (i === 1 && t === 'enrollments'));
    });
    if (t === 'courses') { renderCourses(); }
    else { if (!_state.enrollments.length) loadEnrollments(); else renderEnrollments(); }
  }

  function renderCourses() {
    var c = _state.courses;
    if (!c.length) {
      document.getElementById('tableWrap').innerHTML = '<div class="empty">ยังไม่มีคอร์ส · กดปุ่ม "+ คอร์สใหม่" เพื่อเริ่ม</div>';
      return;
    }
    var html = '<table><thead><tr>' +
      '<th>คอร์ส</th><th>หมวด</th><th>ผู้สอน</th><th>เวลา</th><th>Renewal</th><th>Enrolled</th><th>Actions</th>' +
      '</tr></thead><tbody>';
    html += c.map(function (x) {
      return '<tr>' +
        '<td><div style="font-weight:500">' + esc(x.title) + '</div><div style="font-size:10px;color:var(--muted)">' + esc(x.required_for_positions || 'ทุกตำแหน่ง') + '</div></td>' +
        '<td><span class="pill ' + catCls(x.category) + '">' + esc(catLabel(x.category)) + '</span></td>' +
        '<td>' + esc(x.provider) + '</td>' +
        '<td>' + x.duration_hours + ' ชม.' + (x.ce_credits ? ' · ' + x.ce_credits + ' CE' : '') + '</td>' +
        '<td>' + (x.renewal_required ? 'ทุก ' + x.renewal_cycle_months + ' เดือน' : '—') + '</td>' +
        '<td>' + x.stats.total_enrolled + ' · ' + x.stats.active + ' active · ' + x.stats.overdue + ' overdue</td>' +
        '<td><div class="row-act">' +
        '<button class="rb" onclick=\'editCourse(' + JSON.stringify(x.course_id) + ')\'>แก้ไข</button>' +
        '<button class="rb p" onclick=\'autoEnroll(' + JSON.stringify(x.course_id) + ')\'>Auto-enroll</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');
    html += '</tbody></table>';
    document.getElementById('tableWrap').innerHTML = html;
  }

  function renderEnrollments() {
    var e = _state.enrollments;
    if (!e.length) { document.getElementById('tableWrap').innerHTML = '<div class="empty">ยังไม่มี enrollment</div>'; return; }
    var html = '<table><thead><tr>' +
      '<th>พนักงาน</th><th>คอร์ส</th><th>Enrolled</th><th>กำหนด</th><th>สถานะ</th><th>Cert</th>' +
      '</tr></thead><tbody>';
    html += e.map(function (x) {
      return '<tr>' +
        '<td>' + esc(x.employee_name) + '</td>' +
        '<td>' + esc(x.course_title) + '<div style="font-size:10px;color:var(--muted)"><span class="pill ' + catCls(x.category) + '">' + esc(catLabel(x.category)) + '</span></div></td>' +
        '<td>' + esc(x.enrolled_at) + '</td>' +
        '<td>' + esc(x.due_date) + '</td>' +
        '<td><span class="pill ' + (x.status === 'completed' ? 'cp' : x.status === 'overdue' ? 'ov' : 'pr') + '">' + statusLabel(x.status) + '</span></td>' +
        '<td>' + (x.certificate_url ? '<a href="' + esc(x.certificate_url) + '" target="_blank"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>ดู</a>' : '—') + '</td>' +
        '</tr>';
    }).join('');
    html += '</tbody></table>';
    document.getElementById('tableWrap').innerHTML = html;
  }

  function catCls(c) { return ({ mandatory: 'man', regulatory: 'reg', clinical: 'cli', safety: 'saf', elective: 'ele', soft_skill: 'soft' })[c] || 'ele'; }
  function catLabel(c) { return ({ mandatory: 'mandatory', regulatory: 'regulatory', clinical: 'clinical', safety: 'safety', elective: 'elective', soft_skill: 'soft skill' })[c] || c; }
  function statusLabel(s) { return ({ enrolled: 'รอเริ่ม', in_progress: 'กำลังเรียน', completed: 'เสร็จ', overdue: 'เลยกำหนด', waived: 'ยกเว้น' })[s] || s; }

  function openCourseModal() { _state.editing = null; document.getElementById('mt').textContent = 'คอร์สใหม่'; renderModal({}); document.getElementById('modalBg').classList.add('open'); }
  function editCourse(id) {
    var c = _state.courses.find(function (x) { return x.course_id === id; });
    if (!c) return;
    _state.editing = c;
    document.getElementById('mt').textContent = 'แก้ไข · ' + c.title;
    renderModal(c);
    document.getElementById('modalBg').classList.add('open');
  }
  function renderModal(c) {
    var cats = ['mandatory', 'regulatory', 'clinical', 'safety', 'elective', 'soft_skill'];
    document.getElementById('mb').innerHTML =
      '<div class="field"><label class="field-l">ชื่อคอร์ส <span class="req">*</span></label>' +
      '<input class="field-i" id="fTitle" value="' + esc(c.title || '') + '"></div>' +
      '<div class="field"><label class="field-l">คำอธิบาย</label>' +
      '<textarea class="field-i" id="fDesc" rows="2">' + esc(c.description || '') + '</textarea></div>' +
      '<div class="field-row">' +
      '<div class="field"><label class="field-l">หมวด</label>' +
      '<select class="field-i" id="fCat">' + cats.map(function (x) { return '<option value="' + x + '" ' + (c.category === x ? 'selected' : '') + '>' + catLabel(x) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label class="field-l">ผู้สอน</label>' +
      '<input class="field-i" id="fProvider" value="' + esc(c.provider || '') + '"></div>' +
      '</div>' +
      '<div class="field-row">' +
      '<div class="field"><label class="field-l">เวลา (ชม.)</label>' +
      '<input class="field-i" type="number" id="fDur" value="' + (c.duration_hours || 0) + '"></div>' +
      '<div class="field"><label class="field-l">CE credits</label>' +
      '<input class="field-i" type="number" id="fCE" value="' + (c.ce_credits || 0) + '"></div>' +
      '</div>' +
      '<div class="field-row">' +
      '<div class="field"><label class="field-l">required_for_positions</label>' +
      '<input class="field-i" id="fPos" value="' + esc(c.required_for_positions || '') + '" placeholder="POS01,POS08 หรือ ALL"></div>' +
      '<div class="field"><label class="field-l">linked_license_type</label>' +
      '<input class="field-i" id="fLic" value="' + esc(c.linked_license_type || '') + '" placeholder="BLS / ACLS / PDPA"></div>' +
      '</div>' +
      '<div class="field-row">' +
      '<div class="field"><label class="field-l">Renewal cycle (เดือน)</label>' +
      '<input class="field-i" type="number" id="fCycle" value="' + (c.renewal_cycle_months || 0) + '"></div>' +
      '<div class="field"><label class="field-l">ราคา/seat (฿)</label>' +
      '<input class="field-i" type="number" id="fCost" value="' + (c.cost_per_seat || 0) + '"></div>' +
      '</div>' +
      '<div class="field"><label class="field-l">URL syllabus / material</label>' +
      '<input class="field-i" type="url" id="fAtt" value="' + esc(c.attachment_url || '') + '"></div>';
    document.getElementById('mf').innerHTML = '<button class="rb" onclick="trCloseModal()">ยกเลิก</button>' +
      '<button class="rb p" onclick="saveCourse()">บันทึก</button>';
  }

  function saveCourse() {
    var payload = {
      course_id: _state.editing ? _state.editing.course_id : null,
      title: document.getElementById('fTitle').value.trim(),
      description: document.getElementById('fDesc').value,
      category: document.getElementById('fCat').value,
      provider: document.getElementById('fProvider').value,
      duration_hours: document.getElementById('fDur').value,
      ce_credits: document.getElementById('fCE').value,
      required_for_positions: document.getElementById('fPos').value,
      linked_license_type: document.getElementById('fLic').value,
      renewal_cycle_months: document.getElementById('fCycle').value,
      cost_per_seat: document.getElementById('fCost').value,
      attachment_url: document.getElementById('fAtt').value,
      renewal_required: Number(document.getElementById('fCycle').value) > 0,
    };
    if (!payload.title) { showToast('กรอกชื่อคอร์ส', 'error'); return; }
    google.script.run.withSuccessHandler(function (r) {
      if (r && r.ok) { trCloseModal(); loadCourses(); }
      else showToast('บันทึกล้มเหลว · ' + (r && r.error), 'error');
    }).trainingAdminUpsertCourse(payload);
  }

  function autoEnroll(courseId) {
    if (!confirm('Auto-enroll พนง.ทุกคนตาม required_for_positions?')) return;
    google.script.run.withSuccessHandler(function (r) {
      if (r && r.ok) showToast('Enrolled ' + r.enrolled + ' · Skipped ' + r.skipped + ' (มี active enrollment อยู่)', 'success');
      else showToast('Failed · ' + (r && r.error), 'error');
      loadCourses(); loadEnrollments();
    }).trainingAdminAutoEnroll(courseId, {});
  }

  function trCloseModal() { document.getElementById('modalBg').classList.remove('open'); }
  function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  // ---- ผูก fn ที่ inline onclick ต้องใช้ ลง window ----
  window.openCourseModal = openCourseModal;
  window.editCourse = editCourse;
  window.autoEnroll = autoEnroll;
  window.saveCourse = saveCourse;
  window.trCloseModal = trCloseModal;
  window.trSetTab = trSetTab;

  // ---- start (แทน DOMContentLoaded ของหน้าเดิม · DOM พร้อมแล้วตอน mount) ----
  init();
}

// ---- top-level expose ----
try { window.mountTraining = mountTraining; } catch (e) {}
