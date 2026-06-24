// _ported/internaljob.js — FULL native port of desktop internal_job_manager.html (HR Announcement admin · หน้า "ประกาศงานภายใน")
// ลอกทั้งดุ้น: quick-stats(4) + top bar + tabs(postings/applications) + postings grid (pcard)
//   + applications table + create posting modal · CSS เดิม prefix #ij ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ IJ_RUN_PAGE_JS() · google.script.run = shim → IJ_BACKEND (Supabase)
//
// ใช้ global sb (index.html module scope) — ห้าม redeclare · helper inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน IJ_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=internal_job.updated&limit=2000 → {items}) :
//   list   → derive postings/applications/stats client-side จาก payload ล่าสุดต่อ entity
//            (ตอนนี้ list อาจว่าง = 0 posting → render ได้ ไม่ error · empty state สวย)
//   write (create/close/updateApp) → เขียนกลับไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   IJ_BACKEND — map google.script.run → Supabase edge fn hr_list (type=internal_job.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     internalJobAdminListPostings(opts) → { postings:[...] }
     internalJobAdminListApps(postingId) → { applications:[...] }
     mutations                          → { ok / error } stub + toast
   ============================================================ */
var IJ_FN = 'hr_list';
var IJ_TYPE = 'internal_job.updated';

function ij2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function ij2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function ij2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function ij2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// payload event ดิบ → posting row shape ที่ JS เดิมใช้
function ij2MapPosting(p) {
  p = p || {};
  var status = String(p.status || 'open').toLowerCase();
  return {
    posting_id: p.posting_id || p.entity_id || p.id || '',
    title: p.title || p.position_name || '—',
    position_id: p.position_id || '',
    branch_id: p.branch_id || '',
    description: p.description || '',
    responsibilities: p.responsibilities || '',
    requirements: p.requirements || '',
    compensation_range: p.compensation_range || p.compensation || '',
    open_date: ij2Date(p.open_date || p.created_at || p.posted_at),
    close_date: ij2Date(p.close_date),
    status: status,
    application_count: ij2Num(p.application_count),
    _raw: p,
  };
}

// payload event ดิบ → application row shape ที่ JS เดิมใช้
function ij2MapApp(a) {
  a = a || {};
  return {
    application_id: a.application_id || a.entity_id || a.id || '',
    posting_id: a.posting_id || '',
    employee_name: a.employee_name || a.name || '—',
    current_position: a.current_position || a.position_name || '—',
    current_branch: a.current_branch || a.branch_name || a.branch_id || '—',
    applied_at: ij2Date(a.applied_at || a.created_at),
    resume_url: a.resume_url || '',
    manager_notified: ij2Bool(a.manager_notified),
    status: String(a.status || 'submitted').toLowerCase(),
    _raw: a,
  };
}

// cache payload ดิบล่าสุด (postings + applications แยกจาก event ตัวเดียวกัน)
var _ij2Postings = [];
var _ij2Apps = [];
var _ij2Loaded = false;

// event อาจเป็น posting หรือ application — แยกด้วย kind/record_type หรือ field ที่มี
function ij2ClassifyKind(p) {
  var k = String(p.kind || p.record_type || p.type || '').toLowerCase();
  if (k.indexOf('application') >= 0 || k === 'app') return 'application';
  if (k.indexOf('posting') >= 0 || k === 'post') return 'posting';
  if (p.application_id || p.employee_name) return 'application';
  if (p.posting_id && (p.title || p.position_id) && !p.employee_name) return 'posting';
  // ถ้ามี title ถือเป็น posting, มิฉะนั้นเป็น application
  return (p.title || p.compensation_range) ? 'posting' : 'application';
}

function ij2FetchAll() {
  return sb.functions.invoke(IJ_FN + '?type=' + encodeURIComponent(IJ_TYPE) + '&limit=2000').then(function (res) {
    var data = (res && res.data) || {};
    var items = ij2ToArr(data.items);
    var pSeen = {}, postings = [];
    var aSeen = {}, apps = [];
    items.forEach(function (p) {
      var kind = ij2ClassifyKind(p);
      if (kind === 'application') {
        var aid = p.application_id || p.entity_id || p.id || '';
        if (!aid || aSeen[aid]) return;
        aSeen[aid] = true;
        apps.push(ij2MapApp(p));
      } else {
        var pid = p.posting_id || p.entity_id || p.id || '';
        if (!pid || pSeen[pid]) return;
        pSeen[pid] = true;
        postings.push(ij2MapPosting(p));
      }
    });
    // derive application_count ต่อ posting ถ้า backend ไม่ได้ส่งมา
    postings.forEach(function (po) {
      if (!po.application_count) {
        po.application_count = apps.filter(function (a) { return a.posting_id === po.posting_id; }).length;
      }
    });
    _ij2Postings = postings;
    _ij2Apps = apps;
    _ij2Loaded = true;
    return { postings: postings, applications: apps };
  }).catch(function (e) {
    console.warn('[IJ_BACKEND] list fetch failed', e);
    _ij2Postings = [];
    _ij2Apps = [];
    _ij2Loaded = true;
    return { postings: [], applications: [] };
  });
}

var IJ_BACKEND = {
  // list postings — { postings:[...] }
  internalJobAdminListPostings: function (opts) {
    return ij2FetchAll().then(function (all) {
      return { postings: all.postings.slice() };
    });
  },

  // list applications — { applications:[...] } · กรองตาม postingId ถ้าส่งมา
  internalJobAdminListApps: function (postingId) {
    var run = function (all) {
      var apps = all.applications.slice();
      if (postingId) apps = apps.filter(function (a) { return a.posting_id === postingId; });
      return { applications: apps };
    };
    if (_ij2Loaded) return Promise.resolve(run({ postings: _ij2Postings, applications: _ij2Apps }));
    return ij2FetchAll().then(run);
  },

  // ---- mutations: เขียนกลับไม่ได้บน dashboard → stub + toast ----
  internalJobAdminCreate: function () {
    ij2NotReady('Post ตำแหน่งภายใน');
    return Promise.resolve({ ok: false, error: 'Post ตำแหน่งยังไม่พร้อมบน dashboard (read-only)' });
  },
  internalJobAdminClose: function () {
    ij2NotReady('ปิด posting');
    return Promise.resolve({ ok: false, error: 'ปิด posting ยังไม่พร้อมบน dashboard (read-only)' });
  },
  internalJobAdminUpdateApp: function () {
    ij2NotReady('ปรับสถานะใบสมัคร');
    return Promise.resolve({ ok: false, error: 'ปรับสถานะยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _ij2NotReadyShown = {};
function ij2NotReady(feature) {
  if (_ij2NotReadyShown[feature]) return;
  _ij2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ij2Toast) window.ij2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountInternaljob — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountInternaljob() {
  if (!document.getElementById('wrap-internaljob')) return;
  var wrap = document.getElementById('wrap-internaljob');
  wrap.innerHTML = '<style>' + IJ_CSS() + '</style><div id="ij">' + IJ_MARKUP() + '</div>';
  IJ_RUN_PAGE_JS();
}

/* ===== CSS เดิม (<style> manager + quick-stats + page-head) · prefix ทุก selector ด้วย #ij =====
   ตัด .app-shell/sidebar/main-area/topbar shell ออก (dashboard มี shell แล้ว) */
function IJ_CSS() {
  return [
    // tokens
    '#ij{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--bg:#F8F9FA;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--warn:#F59E0B;--success:#16A34A;color:var(--navy);font-size:14px}',
    '#ij *,#ij *::before,#ij *::after{box-sizing:border-box}',
    // page head (native บน dashboard)
    '#ij .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #E2E8F0}',
    '#ij .page-head h1{font-size:20px;font-weight:600;color:#0D2F4F;letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ij .page-head h1 svg{width:18px;height:18px;color:#3DC5B7}',
    '#ij .page-head .subtitle{font-size:12px;color:#64748B;margin-top:4px}',
    '#ij .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}',
    // quick stats
    '#ij .yh-quick-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}',
    '@media (max-width:900px){#ij .yh-quick-stats{grid-template-columns:repeat(2,1fr)}}',
    '#ij .yh-qs-card{background:white;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;position:relative;overflow:hidden;cursor:help}',
    '#ij .yh-qs-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#ij .yh-qs-card.warn::before{background:#F59E0B}',
    '#ij .yh-qs-card.danger::before{background:#EF4444}',
    '#ij .yh-qs-card.info::before{background:#185FA5}',
    '#ij .yh-qs-card.success::before{background:#10B981}',
    '#ij .yh-qs-lbl{font-size:10px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:4px}',
    '#ij .yh-qs-lbl svg{width:11px;height:11px;color:#94A3B8}',
    '#ij .yh-qs-val{font-size:22px;font-weight:700;color:#0D2F4F;line-height:1;margin-top:6px;letter-spacing:-.02em}',
    '#ij .yh-qs-sub{font-size:10px;color:#94A3B8;margin-top:3px}',
    // top bar
    '#ij .top{background:var(--navy);color:white;padding:14px 20px;display:flex;align-items:center;gap:12px;border-radius:11px 11px 0 0}',
    '#ij .top-t{font-size:16px;font-weight:600}',
    '#ij .top-b{background:var(--teal);padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600}',
    '#ij .top-spacer{flex:1}',
    '#ij .btn-p{background:var(--teal);color:white;padding:8px 14px;border-radius:7px;font-size:12px;font-weight:500;border:none;cursor:pointer}',
    // tabs
    '#ij .tabs{display:flex;gap:2px;padding:0 20px;border-bottom:1px solid var(--border);background:white}',
    '#ij .tab{padding:11px 16px;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;font-weight:500}',
    '#ij .tab.act{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    // body / cards
    '#ij .body{padding:14px 20px;background:white;border-radius:0 0 11px 11px}',
    '#ij .pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:11px}',
    '#ij .pcard{background:white;border:1px solid var(--border);border-radius:11px;padding:14px}',
    '#ij .pcard-t{font-size:14px;font-weight:600;margin-bottom:3px}',
    '#ij .pcard-m{font-size:11px;color:var(--muted);margin-bottom:9px}',
    '#ij .pcard-meta{display:flex;justify-content:space-between;padding:5px 0;font-size:11px}',
    '#ij .ml{color:var(--muted)}',
    '#ij .mv{font-weight:500}',
    '#ij .pcard-actions{display:flex;gap:6px;margin-top:9px}',
    '#ij .rb{padding:5px 10px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:white;color:var(--navy)}',
    '#ij .rb.p{background:var(--teal);color:white;border-color:var(--teal)}',
    // pills
    '#ij .pill{display:inline-flex;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600}',
    '#ij .pill.open{background:#D1FAE5;color:#047857}',
    '#ij .pill.closed{background:#F3F4F6;color:#4B5563}',
    '#ij .pill.filled{background:#DBEAFE;color:#1E40AF}',
    '#ij .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    // modal
    '#ij .modal-bg{display:none;position:fixed;inset:0;background:rgba(13,47,79,0.6);z-index:9000;align-items:center;justify-content:center;padding:20px}',
    '#ij .modal-bg.open{display:flex}',
    '#ij .modal{background:white;border-radius:14px;max-width:600px;width:100%;max-height:90vh;overflow-y:auto}',
    '#ij .modal-h{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
    '#ij .modal-x{background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer}',
    '#ij .modal-b{padding:16px 20px}',
    // field
    '#ij .field{margin-bottom:11px}',
    '#ij .field-l{display:block;font-size:11px;font-weight:600;margin-bottom:5px}',
    '#ij .field-i{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit}',
    '#ij .field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    // table
    '#ij table{width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden}',
    '#ij th{background:var(--navy);color:white;padding:9px 11px;font-size:11px;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:0.3px}',
    '#ij td{padding:9px 11px;font-size:12px;border-top:1px solid var(--border)}',
    '#ij a{color:var(--teal);}',
  ].join('\n');
}

/* ===== markup เดิม ครบ page-head + quick-stats + top bar + tabs + body + modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function IJ_MARKUP() {
  return [
    // page head
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>',
    '      Internal Job Board',
    '    </h1>',
    '    <div class="subtitle">ตำแหน่งภายในเปิดรับ · พนักงานสมัครจาก LIFF · transfer/promote within org</div>',
    '  </div>',
    '  <div class="page-actions" id="yh-page-actions"></div>',
    '</header>',
    // quick stats
    '<div class="yh-quick-stats">',
    '  <div class="yh-qs-card info" data-tip="Internal posting ที่ active · พนักงานสมัครได้จาก LIFF">',
    '    <div class="yh-qs-lbl">ตำแหน่งเปิด</div>',
    '    <div class="yh-qs-val" id="yh-qs-open">—</div>',
    '    <div class="yh-qs-sub">รับสมัครภายใน</div>',
    '  </div>',
    '  <div class="yh-qs-card" data-tip="จำนวนพนักงานที่สมัครภายใน · รวมทุก posting">',
    '    <div class="yh-qs-lbl">คนสมัคร</div>',
    '    <div class="yh-qs-val" id="yh-qs-applied">—</div>',
    '    <div class="yh-qs-sub">รวมทุกตำแหน่ง</div>',
    '  </div>',
    '  <div class="yh-qs-card warn" data-tip="การสมัครที่ยัง pending review จาก hiring manager">',
    '    <div class="yh-qs-lbl">รอ review</div>',
    '    <div class="yh-qs-val" id="yh-qs-pending">—</div>',
    '    <div class="yh-qs-sub">พนักงานสมัครรอ</div>',
    '  </div>',
    '  <div class="yh-qs-card success" data-tip="การโอนย้ายภายในที่สำเร็จในเดือนนี้ · เก็บ history">',
    '    <div class="yh-qs-lbl">Transferred</div>',
    '    <div class="yh-qs-val" id="yh-qs-transferred">—</div>',
    '    <div class="yh-qs-sub">สำเร็จเดือนนี้</div>',
    '  </div>',
    '</div>',
    // top bar
    '<div class="top">',
    '  <div class="top-t">Internal Job Manager</div>',
    '  <div class="top-b">IJB</div>',
    '  <div class="top-spacer"></div>',
    '  <button class="btn-p" onclick="ijOpenCreate()">+ Post ตำแหน่ง</button>',
    '</div>',
    // tabs
    '<div class="tabs">',
    '  <div class="tab act" onclick="ijSetTab(\'postings\')">Postings</div>',
    '  <div class="tab" onclick="ijSetTab(\'applications\')">Applications</div>',
    '</div>',
    // body
    '<div class="body" id="bodyWrap"><div class="empty">กำลังโหลด...</div></div>',
    // modal
    '<div class="modal-bg" id="modalBg" onclick="if(event.target===this)ijCloseModal()">',
    '  <div class="modal">',
    '    <div class="modal-h"><div style="font-size:15px; font-weight:600;" id="mt"></div><button class="modal-x" onclick="ijCloseModal()">×</button></div>',
    '    <div class="modal-b" id="mb"></div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   IJ_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → IJ_BACKEND
   helper (esc/showToast) inline · fn ที่ inline onclick ต้องใช้ → ผูกกับ window
   ============================================================ */
function IJ_RUN_PAGE_JS() {

  // ---- google.script.run shim → IJ_BACKEND (async, คืน shape เดิม) ----
  function _ij2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (IJ_BACKEND[prop]) {
            Promise.resolve().then(function () { return IJ_BACKEND[prop].apply(IJ_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[IJ_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[IJ_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ij2MakeChain(); } });

  // ---- helpers (inline · prefix ij ใน id เพื่อกันชน) ----
  function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function showToast(msg, type) {
    var t = document.getElementById('ij2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ij2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ij2Toast = showToast;

  /* ====================================================================
     ===== JS หน้าเดิม internal_job_manager.html (ลอกทั้งดุ้น) =====
     ใช้ getById scope ใต้ #ij กันชน id
     ==================================================================== */
  var _ijRoot = document.getElementById('ij');
  function getById(id) { return _ijRoot ? _ijRoot.querySelector('#' + id) : document.getElementById(id); }

  var _state = { tab: 'postings', postings: [], applications: [] };

  function init() { reload(); }

  function setTab(t) {
    _state.tab = t;
    _ijRoot.querySelectorAll('.tab').forEach(function (el, i) {
      el.classList.toggle('act', (t === 'postings' && i === 0) || (t === 'applications' && i === 1));
    });
    reload();
  }

  function reload() {
    getById('bodyWrap').innerHTML = '<div class="empty">กำลังโหลด...</div>';
    if (_state.tab === 'postings') {
      google.script.run.withSuccessHandler(function (r) { _state.postings = (r && r.postings) || []; renderPostings(); updateStats(); }).internalJobAdminListPostings({});
    } else {
      google.script.run.withSuccessHandler(function (r) { _state.applications = (r && r.applications) || []; renderApplications(); updateStats(); }).internalJobAdminListApps(null);
    }
  }

  // update quick stats — ดึงทั้ง postings + applications แล้วคำนวณ client-side
  function updateStats() {
    google.script.run.withSuccessHandler(function (rp) {
      var postings = (rp && rp.postings) || [];
      google.script.run.withSuccessHandler(function (ra) {
        var apps = (ra && ra.applications) || [];
        var open = postings.filter(function (p) { return p.status === 'open'; }).length;
        var pending = apps.filter(function (a) { return a.status === 'submitted' || a.status === 'shortlisted'; }).length;
        var transferred = apps.filter(function (a) { return a.status === 'selected'; }).length;
        getById('yh-qs-open').textContent = open;
        getById('yh-qs-applied').textContent = apps.length;
        getById('yh-qs-pending').textContent = pending;
        getById('yh-qs-transferred').textContent = transferred;
      }).internalJobAdminListApps(null);
    }).internalJobAdminListPostings({});
  }

  function renderPostings() {
    if (!_state.postings.length) { getById('bodyWrap').innerHTML = '<div class="empty">ยังไม่มี posting · กดปุ่ม "+ Post"</div>'; return; }
    getById('bodyWrap').innerHTML = '<div class="pgrid">' + _state.postings.map(function (p) {
      return '<div class="pcard">' +
        '<div class="pcard-t">' + esc(p.title) + '</div>' +
        '<div class="pcard-m">' + esc(p.position_id) + ' · ' + esc(p.branch_id) + '</div>' +
        '<div class="pcard-meta"><span class="ml">เงินเดือน</span><span class="mv">' + esc(p.compensation_range) + '</span></div>' +
        '<div class="pcard-meta"><span class="ml">เปิดรับ</span><span class="mv">' + esc(p.open_date) + ' → ' + esc(p.close_date) + '</span></div>' +
        '<div class="pcard-meta"><span class="ml">ผู้สมัคร</span><span class="mv">' + p.application_count + ' คน</span></div>' +
        '<div class="pcard-meta"><span class="ml">สถานะ</span><span class="pill ' + esc(p.status) + '">' + statusLabel(p.status) + '</span></div>' +
        '<div class="pcard-actions">' +
          (p.status === 'open' ? '<button class="rb" onclick="ijCloseP(\'' + esc(p.posting_id) + '\')">ปิด posting</button>' : '') +
          '<button class="rb p" onclick="ijViewApps(\'' + esc(p.posting_id) + '\')">ดูใบสมัคร</button>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderApplications() {
    if (!_state.applications.length) { getById('bodyWrap').innerHTML = '<div class="empty">ยังไม่มีใบสมัคร</div>'; return; }
    var html = '<table><thead><tr><th>พนักงาน</th><th>ตำแหน่งปัจจุบัน</th><th>สมัครเมื่อ</th><th>Resume</th><th>แจ้ง mgr</th><th>สถานะ</th><th>Actions</th></tr></thead><tbody>';
    html += _state.applications.map(function (a) {
      return '<tr>' +
        '<td><b>' + esc(a.employee_name) + '</b></td>' +
        '<td>' + esc(a.current_position) + ' · ' + esc(a.current_branch) + '</td>' +
        '<td>' + esc(a.applied_at) + '</td>' +
        '<td>' + (a.resume_url ? '<a href="' + esc(a.resume_url) + '" target="_blank">ดู</a>' : '-') + '</td>' +
        '<td>' + (a.manager_notified ? 'ใช่' : 'ไม่') + '</td>' +
        '<td><b>' + appLabel(a.status) + '</b></td>' +
        '<td>' +
          '<select class="field-i" style="font-size:11px;" onchange="ijUpdateApp(\'' + esc(a.application_id) + '\', this.value)">' +
            '<option value="">— ปรับสถานะ —</option>' +
            '<option value="shortlisted">Shortlist</option>' +
            '<option value="interview">Interview</option>' +
            '<option value="selected">Select</option>' +
            '<option value="rejected">Reject</option>' +
          '</select>' +
        '</td>' +
      '</tr>';
    }).join('');
    html += '</tbody></table>';
    getById('bodyWrap').innerHTML = html;
  }

  function statusLabel(s) { return ({ open: 'เปิดรับ', closed: 'ปิดแล้ว', filled: 'รับแล้ว' })[s] || s; }
  function appLabel(s) { return ({ submitted: 'ส่งแล้ว', shortlisted: 'shortlist', interview: 'สัมภาษณ์', selected: 'รับ', rejected: 'ปฏิเสธ' })[s] || s; }

  function openCreate() {
    getById('mt').textContent = 'Post ตำแหน่งภายใน';
    getById('mb').innerHTML =
      '<div class="field"><label class="field-l">ชื่อตำแหน่ง</label>' +
        '<input class="field-i" id="fTitle" placeholder="Senior PT - HQ"></div>' +
      '<div class="field-row">' +
        '<div class="field"><label class="field-l">Position ID</label>' +
          '<input class="field-i" id="fPos" placeholder="POS01"></div>' +
        '<div class="field"><label class="field-l">Branch ID</label>' +
          '<input class="field-i" id="fBr" placeholder="BR00"></div>' +
      '</div>' +
      '<div class="field"><label class="field-l">รายละเอียดงาน</label>' +
        '<textarea class="field-i" id="fDesc" rows="3"></textarea></div>' +
      '<div class="field"><label class="field-l">ความรับผิดชอบ</label>' +
        '<textarea class="field-i" id="fResp" rows="3"></textarea></div>' +
      '<div class="field"><label class="field-l">คุณสมบัติ</label>' +
        '<textarea class="field-i" id="fReq" rows="2"></textarea></div>' +
      '<div class="field-row">' +
        '<div class="field"><label class="field-l">ช่วงเงินเดือน</label>' +
          '<input class="field-i" id="fComp" placeholder="commensurate" value="commensurate"></div>' +
        '<div class="field"><label class="field-l">ปิดรับวันที่</label>' +
          '<input class="field-i" type="date" id="fClose"></div>' +
      '</div>' +
      '<div style="display:flex; gap:8px; justify-content:flex-end;">' +
        '<button class="rb" onclick="ijCloseModal()">ยกเลิก</button>' +
        '<button class="rb p" onclick="ijSavePost()">บันทึก + Push</button>' +
      '</div>';
    getById('modalBg').classList.add('open');
  }

  function savePost() {
    var payload = {
      title: getById('fTitle').value.trim(),
      position_id: getById('fPos').value.trim(),
      branch_id: getById('fBr').value.trim(),
      description: getById('fDesc').value,
      responsibilities: getById('fResp').value,
      requirements: getById('fReq').value,
      compensation_range: getById('fComp').value,
      close_date: getById('fClose').value,
    };
    if (!payload.title || !payload.position_id) { showToast('กรอกชื่อ + position_id', 'error'); return; }
    google.script.run.withSuccessHandler(function (r) {
      if (r && r.ok) { closeModal(); reload(); }
      else showToast('สร้างไม่สำเร็จ · ' + (r && r.error), 'error');
    }).internalJobAdminCreate(payload);
  }

  function closeP(id) {
    if (!confirm('ปิด posting นี้?')) return;
    google.script.run.withSuccessHandler(function (r) { if (r && r.ok) reload(); else showToast((r && r.error) || 'ปิดไม่สำเร็จ', 'error'); }).internalJobAdminClose(id);
  }

  function viewApps(postingId) {
    google.script.run.withSuccessHandler(function (r) {
      _state.applications = (r && r.applications) || [];
      setTab('applications');
    }).internalJobAdminListApps(postingId);
  }

  function updateApp(id, status) {
    if (!status) return;
    google.script.run.withSuccessHandler(function (r) { if (r && r.ok) reload(); else showToast((r && r.error) || 'ปรับสถานะไม่สำเร็จ', 'error'); }).internalJobAdminUpdateApp(id, { status: status });
  }

  function closeModal() { getById('modalBg').classList.remove('open'); }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window (prefix ij กันชน global) ===== */
  var _exp = {
    ijSetTab: setTab,
    ijOpenCreate: openCreate,
    ijSavePost: savePost,
    ijCloseP: closeP,
    ijViewApps: viewApps,
    ijUpdateApp: updateApp,
    ijCloseModal: closeModal,
  };
  Object.keys(_exp).forEach(function (k) { window[k] = _exp[k]; });

  /* ===== Init ===== */
  init();
}

/* expose mount fn ไปยัง window (index.html เรียก window.mountInternaljob) */
if (typeof window !== 'undefined') window.mountInternaljob = mountInternaljob;
