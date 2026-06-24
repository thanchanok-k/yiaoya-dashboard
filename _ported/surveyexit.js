// _ported/surveyexit.js — native port ของ survey_exit_manager.html (HR Announcement · "แบบสอบถามลาออก" / Exit Interview Manager)
// exit interview = SENSITIVE → port หน้าจออย่างเดียว (read-only) · ไม่ส่ง LINE / ไม่เขียนกลับ
// ลอก markup + CSS เดิม (form sections: emp-card / topic-prompts / 5 sections / yesno / cta) prefix ทุก selector ด้วย #se
//   คง element id เดิม (hMeta/formBody/ctaBtn/ctaText/ctaH ...) + element id ของ section เดิม
//   หน้าเดิมเป็น LIFF form ของ candidate เดียว → บน dashboard เพิ่ม list ด้านบน (derive จาก events) แล้วเลือกเข้า form (read-only)
//
// ใช้ global window.sb / window.esc / window.$ (index.html module scope) — ห้าม redeclare
// fn ที่ inline onclick เรียก → ผูกกับ window (prefix se* กันชน)
//
// backend (edge fn hr_list?type=survey_exit.updated&limit=2000 → {items}) :
//   READ  → derive รายการ exit interview ต่อ entity client-side (payload ล่าสุดต่อ target) · ว่าง → empty state สวย
//   WRITE → stub + showToast('ยังไม่พร้อมบน dashboard')

/* ============================================================
   SE_BACKEND — map data → Supabase edge fn hr_list (type=survey_exit.updated)
   ============================================================ */
var SE_FN = 'hr_list';
var SE_TYPE = 'survey_exit.updated';
var SE_LIMIT = 2000;

function se2ToArr(v) { return Array.isArray(v) ? v : []; }
function se2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// map payload ดิบ → exit-review row shape ที่ JS หน้านี้ใช้
function se2MapRow(p) {
  p = p || {};
  var emp = p.employee || {};
  var id = p.target_id || p.entity_id || p.id || p.employee_id || emp.employee_id || '';
  var name = p.name || p.employee_name || emp.name || p.full_name || '—';
  var nickname = p.nickname || emp.nickname || '';
  var initial = (p.initial || emp.initial || (name && name !== '—' ? name.charAt(0) : '?'));
  return {
    target_id: id,
    employee: {
      employee_id: emp.employee_id || p.employee_id || id,
      name: name,
      nickname: nickname,
      initial: initial,
      position: p.position || emp.position || '',
      tenure: p.tenure || emp.tenure || '',
    },
    last_day: se2Date(p.last_day || p.last_working_day || emp.last_day),
    // exit-review fields
    leadership_feedback: p.leadership_feedback || '',
    culture_feedback: p.culture_feedback || '',
    team_feedback: p.team_feedback || '',
    rehire_recommendation: String(p.rehire_recommendation || '').toLowerCase(),
    comment: p.comment || '',
    submitted_at: se2Date(p.submitted_at || p.created_at || p.updated_at),
    status: (p.leadership_feedback || p.rehire_recommendation) ? 'done' : 'pending',
    // PDPA: ไม่แนบ payload ดิบ (_raw) — เก็บเฉพาะ field ที่ whitelist ไว้ข้างบน
  };
}

var _se2Rows = [];
// PDPA: cache เฉพาะ row ที่ map/whitelist แล้ว (ไม่ใช่ payload ดิบ) ต่อ target — กัน PII ที่ไม่ได้ render ค้าง heap
var _se2ById = {};

function se2Fetch() {
  return sb.functions.invoke(SE_FN + '?type=' + encodeURIComponent(SE_TYPE) + '&limit=' + SE_LIMIT).then(function (res) {
    var data = (res && res.data) || {};
    var items = se2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.target_id || p.entity_id || p.id || p.employee_id || '';
      if (!id || seen[id]) return;   // payload ล่าสุดต่อ target (items มาเรียงใหม่→เก่า)
      seen[id] = true;
      var row = se2MapRow(p);
      _se2ById[id] = row;
      rows.push(row);
    });
    _se2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[SE_BACKEND] list fetch failed', e);
    _se2Rows = [];
    return [];
  });
}

var SE_BACKEND = {
  // role gate — dashboard user = admin
  surveyWebAppWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },

  // list — รายการ exit interview ทั้งหมด (derive client-side)
  surveyExitAdminList: function () {
    return se2Fetch().then(function (all) {
      var done = all.filter(function (r) { return r.status === 'done'; }).length;
      return {
        items: all.slice().sort(function (a, b) { return (b.submitted_at || '').localeCompare(a.submitted_at || ''); }),
        stats: { total: all.length, done: done, pending: all.length - done },
      };
    });
  },

  // detail — reuse cache (form data ของ target เดียว · shape เดียวกับหน้าเดิมคาด)
  surveyWebAppGetFormData: function (formKey, opts) {
    opts = opts || {};
    var id = opts.target_id || '';
    var build = function () {
      var p = _se2Raw[id];
      if (p) return se2MapRow(p);
      var r0 = _se2Rows.find(function (x) { return x.target_id === id; });
      if (r0) return r0;
      return { error: 'ไม่พบข้อมูล exit interview' };
    };
    if (_se2Rows.length || Object.keys(_se2Raw).length) return Promise.resolve(build());
    return se2Fetch().then(build);
  },

  // ---- write: exit interview sensitive + read-only บน dashboard → stub + toast ----
  surveyWebAppSubmit: function () {
    se2NotReady('บันทึก exit interview');
    return Promise.resolve({ error: 'บันทึก exit interview ยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _se2NotReadyShown = {};
function se2NotReady(feature) {
  if (_se2NotReadyShown[feature]) return;
  _se2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.se2Toast) window.se2Toast('ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountSurveyexit — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountSurveyexit() {
  if (!document.getElementById('wrap-surveyexit')) return;
  var wrap = document.getElementById('wrap-surveyexit');
  wrap.innerHTML = '<style>' + SE_CSS() + '</style><div id="se">' + SE_MARKUP() + '</div>';
  SE_RUN_PAGE_JS();
}

/* ===== CSS เดิม (จาก <style> survey_exit_manager.html) · prefix ทุก selector ด้วย #se =====
   tokens เดิม + .header/.emp-card/.section/.yesno/.topic-prompts/.cta/.loading/.error
   + list/stats/pill (ของ dashboard wrapper) */
function SE_CSS() {
  return [
    // tokens (เดิม :root)
    '#se{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--teal-dark:#0F766E;--bg:#F8F9FA;--text:#0D2F4F;--muted:#6B7280;--border:#E5E7EB;--success:#16A34A;--warn:#D97706;--error:#DC2626;color:var(--text);font-size:14px;line-height:1.5}',
    '#se *,#se *::before,#se *::after{box-sizing:border-box}',
    // dashboard wrapper head (native · ไม่มี shell)
    '#se .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border)}',
    '#se .page-head h1{font-size:20px;font-weight:600;color:var(--navy);margin:0;display:flex;align-items:center;gap:8px}',
    '#se .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#se .page-head .subtitle{font-size:12px;color:var(--muted);margin-top:4px}',
    '#se .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    '#se .btn{padding:7px 14px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:#fff;color:var(--text);display:inline-flex;align-items:center;gap:6px}',
    '#se .btn:hover{border-color:var(--navy)}',
    '#se .btn svg{width:14px;height:14px}',
    '#se .btn-sm{padding:5px 10px;font-size:12px}',
    '#se .btn-help{width:34px;height:34px;padding:0;justify-content:center;color:var(--muted)}',
    '#se .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    // sensitive banner
    '#se .sens-banner{background:#FEF3C7;border:1px solid #FDE68A;color:#92400E;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px;line-height:1.5}',
    '#se .sens-banner strong{font-weight:600}',
    // stats
    '#se .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:600px){#se .stats{grid-template-columns:1fr}}',
    '#se .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#se .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#8B5CF6}',
    '#se .stat-card.done::before{background:var(--success)}',
    '#se .stat-card.pending::before{background:var(--warn)}',
    '#se .stat-card .l{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#se .stat-card .v{font-size:22px;font-weight:600;line-height:1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    // list table
    '#se .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#se .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#se .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#se .data-table tr:last-child td{border-bottom:0}',
    '#se .data-table tr:hover td{background:#FAFBFC}',
    '#se .pill{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;display:inline-block}',
    '#se .pill-done{background:#DCFCE7;color:#166534}',
    '#se .pill-pending{background:#FEF3C7;color:#92400E}',
    '#se .empty-tab{padding:40px 20px;text-align:center;color:var(--muted);font-size:12px;background:#fff;border:1px solid var(--border);border-radius:10px}',
    '#se .loading{text-align:center;padding:50px;color:var(--muted);font-size:13px}',
    // ===== form (เดิม) =====
    '#se .header{background:var(--navy);color:#fff;padding:14px 16px;position:relative;overflow:hidden;border-radius:10px 10px 0 0}',
    '#se .header::before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:var(--teal)}',
    '#se .header::after{content:"";position:absolute;top:-30px;right:-30px;width:90px;height:90px;border-radius:50%;background:var(--teal);opacity:.18}',
    '#se .header>*{position:relative}',
    '#se .h-back{font-size:13px;color:rgba(255,255,255,.7);margin-bottom:4px;cursor:pointer;display:inline-flex;align-items:center;gap:4px}',
    '#se .h-title{font-size:18px;font-weight:500}',
    '#se .h-meta{font-size:12px;color:rgba(255,255,255,.75);margin-top:4px}',
    '#se .form-wrap{background:var(--bg);border:1px solid var(--border);border-top:0;border-radius:0 0 10px 10px;padding:12px 14px}',
    '#se .emp-card{background:#EDE9FE;border-radius:10px;padding:12px;display:flex;gap:12px;align-items:center;margin-bottom:12px}',
    '#se .emp-av{width:44px;height:44px;border-radius:50%;background:#8B5CF6;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:500;font-size:16px;flex-shrink:0;box-shadow:0 0 0 3px rgba(139,92,246,.18)}',
    '#se .emp-name{font-size:14px;font-weight:500;color:var(--navy)}',
    '#se .emp-meta{font-size:12px;color:#6D28D9;margin-top:2px}',
    '#se .section{background:#fff;border-radius:10px;padding:14px;margin-bottom:10px;border:1px solid var(--border)}',
    '#se .section-title{font-size:13px;font-weight:600;color:var(--navy);margin-bottom:8px;letter-spacing:.3px}',
    '#se .section-num{display:inline-block;width:18px;height:18px;border-radius:50%;background:#8B5CF6;color:#fff;font-size:11px;font-weight:600;text-align:center;line-height:18px;margin-right:6px;vertical-align:1px}',
    '#se .q-help{font-size:11px;color:var(--muted);margin-bottom:6px}',
    '#se .q-help code{background:#F3F4F6;padding:1px 5px;border-radius:3px;font-size:10px;font-family:ui-monospace,monospace}',
    '#se .req::after{content:"*";color:var(--error);margin-left:3px}',
    '#se .textarea{width:100%;min-height:80px;padding:9px 11px;border:1px solid var(--border);border-radius:7px;font-family:inherit;font-size:13px;color:var(--navy);resize:vertical;box-sizing:border-box;background:#fff}',
    '#se .textarea[readonly]{background:#F8FAFC;color:var(--text)}',
    '#se .yesno{display:flex;gap:6px}',
    '#se .yesno>div{flex:1;padding:10px;text-align:center;border-radius:7px;border:1px solid var(--border);background:#fff;font-size:12px;font-weight:500;color:var(--navy)}',
    '#se .yesno>div.active.yes{background:var(--success);color:#fff;border-color:var(--success)}',
    '#se .yesno>div.active.maybe{background:var(--warn);color:#fff;border-color:var(--warn)}',
    '#se .yesno>div.active.no{background:var(--error);color:#fff;border-color:var(--error)}',
    '#se .topic-prompts{background:#F9FAFB;border-radius:8px;padding:10px;margin-bottom:10px}',
    '#se .topic-prompts .label{font-size:11px;font-weight:600;color:var(--navy);margin-bottom:6px}',
    '#se .topic-prompts .items{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:var(--muted)}',
    '#se .topic-prompts .items div{padding:5px 8px;background:#fff;border-radius:5px}',
    '#se .cta{background:#9CA3AF;color:#fff;padding:12px;border-radius:9px;text-align:center;font-size:14px;font-weight:500;cursor:not-allowed;box-shadow:none}',
    '#se .cta-help{font-size:11px;color:var(--muted);text-align:center;margin-top:5px}',
    '#se .error{background:#FEE2E2;color:var(--error);border-radius:7px;margin:12px 0;padding:12px}',
  ].join('\n');
}

/* ===== markup ===== dashboard head + sensitive banner + stats + list + form view (เดิม) ===== */
function SE_MARKUP() {
  return [
    // dashboard head
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.66 0 3.22.45 4.56 1.24"/></svg>',
    '      แบบสอบถามลาออก (Exit Interview · Manager)',
    '    </h1>',
    '    <div class="subtitle">บันทึก/ประเมินหลังพนักงานลาออก · feedback ภาวะผู้นำ/วัฒนธรรม/ทีม + rehire</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-help" onclick="seShowHelp(SE_HELP)" title="ช่วยเหลือ" id="help-btn" data-tip="คู่มือ"></button>',
    '    <button class="btn btn-sm" onclick="seLoadList()" id="refresh-btn"></button>',
    '  </div>',
    '</header>',
    // sensitive banner
    '<div class="sens-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#92400E;display:inline-block;flex-shrink:0"></span>',
    '  <span><strong>ข้อมูลอ่อนไหว (confidential):</strong> exit interview เปิดดูได้เฉพาะ HR + Owner · บน dashboard นี้เป็น read-only (ไม่บันทึก/แก้ไข)</span>',
    '</div>',
    '<div class="stats" id="stats"></div>',
    // list
    '<div id="content" class="loading">กำลังโหลด...</div>',
    // form view (เดิม) — ซ่อนไว้ก่อน เปิดเมื่อเลือก row
    '<div id="formView" style="display:none">',
    '  <div class="header">',
    '    <div class="h-back" id="hBack" onclick="seBackToList()">',
    '      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    '      กลับรายการ',
    '    </div>',
    '    <div class="h-title" id="hTitle">Exit Interview (Manager)</div>',
    '    <div class="h-meta" id="hMeta">สำหรับ Manager บันทึกหลัง exit</div>',
    '  </div>',
    '  <div class="form-wrap">',
    '    <div id="formBody"><div style="padding:40px 20px;text-align:center;color:#9CA3AF">กำลังโหลด...</div></div>',
    '    <div class="cta" id="ctaBtn"><span id="ctaText">ส่งบันทึก</span></div>',
    '    <div class="cta-help" id="ctaH">read-only บน dashboard · ดูข้อมูลที่บันทึกไว้เท่านั้น</div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   SE_RUN_PAGE_JS — รัน JS หน้าเดิม (closure) · google = shim → SE_BACKEND
   helper (esc/showToast/showHelp) inline · fn inline onclick → ผูก window (prefix se*)
   ============================================================ */
function SE_RUN_PAGE_JS() {

  // ---- google.script.run shim → SE_BACKEND ----
  function _se2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (SE_BACKEND[prop]) {
            Promise.resolve().then(function () { return SE_BACKEND[prop].apply(SE_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[SE_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[SE_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _se2MakeChain(); } });

  // ---- helpers (inline · prefix se ใน id กันชน) ----
  function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function showToast(msg, type) {
    var t = document.getElementById('se2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'se2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#DC2626' : type === 'success' ? '#16A34A' : '#0D2F4F';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.se2Toast = showToast;
  function showHelp(content) {
    var bg = document.getElementById('se-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'se-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = function (e) { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    var sections = (content.sections || []).map(function (s) {
      var warn = s.type === 'warn';
      var items = (s.items || []).map(function (it) { return '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>'; }).join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + esc(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + esc(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + esc(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'se-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B;font-size:20px">&times;</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + esc(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn" style="background:var(--teal,#3DC5B7);color:#fff;border-color:var(--teal,#3DC5B7)" onclick="document.getElementById(\'se-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม survey_exit_manager.html (ลอก + ปรับ read-only) =====
     ใช้ scope ใต้ #se กันชน id
     ==================================================================== */
  var _seRoot = document.getElementById('se');
  function getById(id) { return _seRoot ? _seRoot.querySelector('#' + id) : document.getElementById(id); }

  var _formData = null;          // form data ของ target ที่เลือก
  var _state = {                 // เดิม: input state · บน dashboard = ข้อมูลที่ดึงมาแสดง read-only
    leadership_feedback: '',
    culture_feedback: '',
    team_feedback: '',
    rehire_recommendation: '',
    comment: '',
  };

  var SE_HELP = {
    title: 'Exit Interview (Manager)',
    subtitle: 'แบบสอบถามลาออก · บันทึกหลังพนักงานลาออก',
    intro: 'Manager บันทึก feedback หลังพนักงานออก: ภาวะผู้นำ · วัฒนธรรมองค์กร · ทีม + คำแนะนำ rehire · HR + Owner ได้รับสำเนา',
    sections: [
      { title: '5 ส่วน', items: [
        '<strong>1. Feedback ภาวะผู้นำ</strong> — หัวหน้า/ผู้บริหาร · พื้นที่ทำงาน',
        '<strong>2. Feedback วัฒนธรรม</strong> — บรรยากาศทีม · core values',
        '<strong>3. Feedback ทีม</strong> — process · structure · สิ่งที่อยากให้ปรับ',
        '<strong>4. แนะนำ Rehire</strong> — ใช่ / บางตำแหน่ง / ไม่',
        '<strong>5. ความคิดเห็น</strong> — เพิ่มเติม (เลือกใส่)',
      ]},
      { type: 'warn', title: 'ระวัง', items: [
        'ข้อมูล exit interview = confidential · เปิดเฉพาะ HR + Owner',
        'บน dashboard นี้เป็น read-only — ดูข้อมูลที่บันทึกไว้เท่านั้น · ยังบันทึก/แก้ไขไม่ได้',
      ]},
    ],
  };

  // ===== icons inline =====
  getById('refresh-btn').innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg> รีเฟรช';
  getById('help-btn').innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>';

  // ===== list =====
  function loadList() {
    getById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(renderList)
      .withFailureHandler(function (err) {
        getById('content').innerHTML = '<div class="empty-tab">โหลดล้มเหลว: ' + esc(err && err.message) + '</div>';
      })
      .surveyExitAdminList();
  }

  function renderList(res) {
    if (!res || res.error) {
      getById('content').innerHTML = '<div class="empty-tab">ผิดพลาด: ' + esc((res && res.error) || 'unknown') + '</div>';
      return;
    }
    renderStats(res.stats || {});
    var items = res.items || [];
    if (!items.length) {
      getById('content').innerHTML = '<div class="empty-tab">ยังไม่มีข้อมูล exit interview<br><span style="font-size:11px">เมื่อ Manager บันทึกแบบสอบถามลาออก จะแสดงที่นี่</span></div>';
      return;
    }
    var html = '<table class="data-table"><thead><tr>';
    html += '<th>พนักงาน</th><th>ตำแหน่ง</th><th>วันสุดท้าย</th><th>Rehire</th><th>สถานะ</th><th>บันทึกเมื่อ</th><th></th>';
    html += '</tr></thead><tbody>';
    items.forEach(function (r) {
      var emp = r.employee || {};
      var rehireTxt = r.rehire_recommendation === 'yes' ? 'ใช่' : r.rehire_recommendation === 'maybe' ? 'บางตำแหน่ง' : r.rehire_recommendation === 'no' ? 'ไม่' : '-';
      html += '<tr>';
      html += '<td><strong>' + esc(emp.name || '-') + '</strong>' + (emp.employee_id ? ' <span style="color:var(--muted);font-size:11px">(' + esc(emp.employee_id) + ')</span>' : '') + '</td>';
      html += '<td>' + esc(emp.position || '-') + '</td>';
      html += '<td>' + esc(r.last_day || '-') + '</td>';
      html += '<td>' + esc(rehireTxt) + '</td>';
      html += '<td><span class="pill pill-' + esc(r.status) + '">' + (r.status === 'done' ? 'บันทึกแล้ว' : 'รอบันทึก') + '</span></td>';
      html += '<td>' + esc(r.submitted_at || '-') + '</td>';
      html += '<td><button class="btn btn-sm" onclick="seOpenForm(\'' + esc(r.target_id).replace(/'/g, '\\\'') + '\')">ดู</button></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    getById('content').innerHTML = html;
  }

  function renderStats(s) {
    getById('stats').innerHTML = [
      '<div class="stat-card"><div class="l">ทั้งหมด</div><div class="v">' + (s.total || 0) + '</div></div>',
      '<div class="stat-card done"><div class="l">บันทึกแล้ว</div><div class="v">' + (s.done || 0) + '</div></div>',
      '<div class="stat-card pending"><div class="l">รอบันทึก</div><div class="v">' + (s.pending || 0) + '</div></div>',
    ].join('');
  }

  // ===== form view (เดิม) =====
  function openForm(targetId) {
    getById('content').style.display = 'none';
    _seRoot.querySelector('.stats').style.display = 'none';
    getById('formView').style.display = 'block';
    getById('formBody').innerHTML = '<div style="padding:40px 20px;text-align:center;color:#9CA3AF">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(onLoaded).withFailureHandler(onError)
      .surveyWebAppGetFormData('exit_manager', { target_id: targetId || '', line_uid: '' });
  }
  function backToList() {
    getById('formView').style.display = 'none';
    getById('content').style.display = '';
    _seRoot.querySelector('.stats').style.display = '';
  }
  function onError(e) {
    getById('formBody').innerHTML = '<div class="error">' + esc((e && e.message) || e) + '</div>';
  }
  function onLoaded(res) {
    if (!res || res.error) { onError(new Error((res && res.error) || 'unknown')); return; }
    _formData = res;
    _state = {
      leadership_feedback: res.leadership_feedback || '',
      culture_feedback: res.culture_feedback || '',
      team_feedback: res.team_feedback || '',
      rehire_recommendation: res.rehire_recommendation || '',
      comment: res.comment || '',
    };
    render();
  }
  function render() {
    var d = _formData;
    var emp = d.employee || {};
    getById('hMeta').textContent = 'รีวิวพนักงาน: ' + (emp.nickname || emp.name || '');
    var html = '';
    html += '<div class="emp-card"><div class="emp-av">' + esc(emp.initial || '?') + '</div><div>' +
      '<div class="emp-name">รีวิว: ' + esc(emp.name || '') + ' (' + esc(emp.employee_id || '') + ')</div>' +
      '<div class="emp-meta">' + esc(emp.position || '') + ' · ' + esc(emp.tenure || '') + ' ปี · ลา ' + esc(d.last_day || '') + '</div>' +
      '</div></div>';
    html += '<div class="topic-prompts">' +
      '<div class="label">Topics ที่ควรคุย (จาก flex v1):</div>' +
      '<div class="items">' +
      '<div>Leadership feedback</div><div>ทีมและวัฒนธรรม</div>' +
      '<div>สิ่งที่อยากเห็นปรับปรุง</div><div>โอกาสกลับมาในอนาคต</div>' +
      '</div></div>';
    html += '<div class="section">' +
      '<div class="section-title"><span class="section-num">1</span><span class="req">Feedback ภาวะผู้นำ</span></div>' +
      '<div class="q-help"><code>leadership_feedback</code> · Leadership feedback</div>' +
      '<textarea class="textarea" readonly placeholder="(ยังไม่มีข้อมูล)">' + esc(_state.leadership_feedback) + '</textarea>' +
      '</div>';
    html += '<div class="section">' +
      '<div class="section-title"><span class="section-num">2</span><span class="req">Feedback วัฒนธรรม</span></div>' +
      '<div class="q-help"><code>culture_feedback</code> · ทีมและวัฒนธรรมองค์กร</div>' +
      '<textarea class="textarea" readonly placeholder="(ยังไม่มีข้อมูล)">' + esc(_state.culture_feedback) + '</textarea>' +
      '</div>';
    html += '<div class="section">' +
      '<div class="section-title"><span class="section-num">3</span><span class="req">Feedback ทีม</span></div>' +
      '<div class="q-help"><code>team_feedback</code> · สิ่งที่อยากเห็นปรับปรุง</div>' +
      '<textarea class="textarea" readonly placeholder="(ยังไม่มีข้อมูล)">' + esc(_state.team_feedback) + '</textarea>' +
      '</div>';
    html += '<div class="section">' +
      '<div class="section-title"><span class="section-num">4</span><span class="req">แนะนำ Rehire</span></div>' +
      '<div class="q-help"><code>rehire_recommendation</code> · โอกาสกลับมาในอนาคต</div>' +
      '<div class="yesno">' +
      '<div class="' + (_state.rehire_recommendation === 'yes' ? 'active yes' : '') + '">ใช่</div>' +
      '<div class="' + (_state.rehire_recommendation === 'maybe' ? 'active maybe' : '') + '">บางตำแหน่ง</div>' +
      '<div class="' + (_state.rehire_recommendation === 'no' ? 'active no' : '') + '">ไม่</div>' +
      '</div></div>';
    html += '<div class="section">' +
      '<div class="section-title"><span class="section-num">5</span>ความคิดเห็น</div>' +
      '<textarea class="textarea" readonly placeholder="(ไม่มี)">' + esc(_state.comment) + '</textarea>' +
      '</div>';
    getById('formBody').innerHTML = html;
  }

  // submit เดิม → read-only stub
  function submitForm() {
    se2NotReady('บันทึก exit interview');
  }

  /* ===== expose fn ที่ inline onclick เรียก ไปยัง window (prefix se กันชน) ===== */
  var _exp = {
    seShowHelp: showHelp,
    SE_HELP: SE_HELP,
    seLoadList: loadList,
    seOpenForm: openForm,
    seBackToList: backToList,
    seSubmitForm: submitForm,
  };
  Object.keys(_exp).forEach(function (k) { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadList();
}

/* expose mount fn */
if (typeof window !== 'undefined') window.mountSurveyexit = mountSurveyexit;
