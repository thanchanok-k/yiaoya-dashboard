// _ported/sop.js — FULL native port of desktop sop_manager.html (HR Announcement admin · หน้า "SOP/คู่มือ")
// ลอกทั้งดุ้น: top banner + alert + actions(create/refresh) + SOP table (Title/Scope/Version/Status/Effective/Acks)
//   + create modal · CSS เดิม (<style> manager) prefix #sop ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ SOP_RUN_PAGE_JS() · google.script.run = shim → SOP_BACKEND (Supabase)
//
// ใช้ global sb/esc/$ (index.html module scope) — ห้าม redeclare · helper inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน SOP_RUN_PAGE_JS (prefix กันชน)
//
// backend (edge fn hr_list?type=sop.updated&limit=2000 → {items}) :
//   list (sopManagerList) → derive sop rows client-side จาก payload ล่าสุดต่อ sop_id
//            (ตอนนี้ list อาจว่าง = 0 SOP → render ได้ ไม่ error · empty state สวย)
//   write (sopCreate) → เขียนกลับไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   SOP_BACKEND — map google.script.run → Supabase edge fn hr_list (type=sop.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     sopManagerList(opts) → { rows:[...] }   (rows = array ของ object ตาม COLUMNS)
     sopCreate(payload)   → { ok / error } stub + toast
   ============================================================ */
var SOP_FN = 'hr_list';
var SOP_WRITE_FN = 'hr_write';   // edge fn กลาง CRUD (add/edit/soft-delete)
var SOP_TYPE = 'sop.updated';

function sop2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function sop2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function sop2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// map payload event ดิบ → sop row (flat) — เก็บ field ครบเพื่อ openItem แสดง raw
function sop2MapSop(p) {
  p = p || {};
  return {
    sop_id:               p.sop_id || p.entity_id || p.id || '',
    title_th:             p.title_th || p.title || '—',
    title_en:             p.title_en || '',
    scope:                p.scope || 'ALL',
    category:             p.category || 'process',
    version:              p.version || '1.0.0',
    status:               String(p.status || 'draft').toLowerCase(),
    doc_url:              p.doc_url || '',
    summary_md:           p.summary_md || '',
    effective_date:       sop2Date(p.effective_date),
    review_cycle_months:  sop2Num(p.review_cycle_months) || 12,
    requires_ack:         p.requires_ack !== false,
    requires_quiz:        !!p.requires_quiz,
    tags:                 p.tags || '',
    ack_count:            sop2Num(p.ack_count),
    ack_total:            sop2Num(p.ack_total),
    _raw:                 p,
  };
}

// soft-delete? (latest event = deleted)
function sop2IsDeleted(p) {
  return !!(p && (p._status === 'deleted' || p._deleted === true ||
    String(p._deleted == null ? '' : p._deleted).toLowerCase() === 'true' || p.deleted === true));
}

function sop2GetSb() {
  return (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
}

// unwrap error จาก functions.invoke (FunctionsHttpError → body จริงอยู่ใน context) → คืน Promise<string>
function sop2ErrMsg(err, data) {
  if (data && data.ok === false && data.error) return Promise.resolve(String(data.error));
  if (!err) return Promise.resolve('unknown');
  if (err.context && typeof err.context.json === 'function') {
    return err.context.json().then(function (b) {
      return (b && (b.error || b.message)) ? String(b.error || b.message) : (err.message || String(err));
    }).catch(function () { return err.message || String(err); });
  }
  return Promise.resolve(err.message || String(err));
}

// ตรวจ 403/401
function sop2Is403(err) {
  if (!err) return false;
  if (err.context && typeof err.context.status === 'number' && (err.context.status === 403 || err.context.status === 401)) return true;
  if (typeof err.status === 'number' && (err.status === 403 || err.status === 401)) return true;
  var msg = String(err.message || err.error || err).toLowerCase();
  return msg.indexOf('403') >= 0 || msg.indexOf('forbidden') >= 0 ||
    msg.indexOf('401') >= 0 || msg.indexOf('unauthor') >= 0 || msg.indexOf('not allowed') >= 0;
}

// เขียนกลับผ่าน hr_write — body: { event_type, entity_id?, deleted?, payload } · คืน { ok } หรือ { error }
function sop2Write(opts) {
  opts = opts || {};
  var sb = sop2GetSb();
  if (!sb || !sb.functions) return Promise.resolve({ error: 'no sb' });
  var body = { event_type: SOP_TYPE, payload: opts.payload || {} };
  if (opts.entity_id) body.entity_id = opts.entity_id;
  if (opts.deleted) body.deleted = true;
  return sb.functions.invoke(SOP_WRITE_FN, { body: body }).then(function (res) {
    var data = (res && res.data) || null;
    var err = res && res.error;
    if (err || (data && data.ok === false)) {
      if (sop2Is403(err)) return { error: 'ต้องเป็น HR / ล็อกอินก่อน (403)' };
      return sop2ErrMsg(err, data).then(function (m) { return { error: m }; });
    }
    return { ok: true, entity_id: (data && data.entity_id) || opts.entity_id || '' };
  }).catch(function (e) {
    if (sop2Is403(e)) return { error: 'ต้องเป็น HR / ล็อกอินก่อน (403)' };
    return sop2ErrMsg(e, null).then(function (m) { return { error: m }; });
  });
}

// cache แถวล่าสุดต่อ sop_id
var _sop2Rows = [];

function sop2FetchRows() {
  return sb.functions.invoke(SOP_FN + '?type=' + encodeURIComponent(SOP_TYPE) + '&limit=2000').then(function (res) {
    var data = (res && res.data) || {};
    var items = sop2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.sop_id || p.entity_id || p.id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      if (sop2IsDeleted(p)) return;   // กรองรายการที่ลบ (soft delete) ทิ้ง
      rows.push(sop2MapSop(p));
    });
    _sop2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[SOP_BACKEND] list fetch failed', e);
    _sop2Rows = [];
    return [];
  });
}

var SOP_BACKEND = {
  // list — คืน { rows } ใน shape ที่ JS เดิมใช้ (Title/Scope/Version/Status/Effective/Acks)
  sopManagerList: function (opts) {
    opts = opts || {};
    return sop2FetchRows().then(function (all) {
      var rows = all.map(function (s) {
        var acks = (s.ack_total ? (s.ack_count + '/' + s.ack_total) : (s.ack_count ? String(s.ack_count) : '—'));
        return {
          Title:     s.title_th || s.title_en || '—',
          Scope:     s.scope || 'ALL',
          Version:   s.version || '—',
          Status:    s.status || 'draft',
          Effective: s.effective_date || '—',
          Acks:      acks,
          _full:     s,    // เก็บ object เต็มไว้ให้ openItem
        };
      });
      return { rows: rows };
    });
  },

  // ---- write: เขียนกลับจริงผ่าน hr_write ----
  // create/upsert — ไม่ส่ง entity_id = สร้างใหม่ · ส่ง entity_id = แก้ของเดิม
  sopCreate: function (payload) {
    payload = payload || {};
    var entity = payload.sop_id || payload.id || '';
    var p = {
      title_th: payload.title_th || '',
      title_en: payload.title_en || '',
      scope: payload.scope || 'ALL',
      category: payload.category || 'process',
      doc_url: payload.doc_url || '',
      summary_md: payload.summary_md || '',
      review_cycle_months: payload.review_cycle_months || 12,
      tags: payload.tags || '',
      requires_ack: payload.requires_ack !== false,
      requires_quiz: !!payload.requires_quiz,
      status: payload.status || 'draft',
    };
    if (entity) p.sop_id = entity;
    return sop2Write({ entity_id: entity || null, payload: p });
  },
  // soft delete — เขียน event ใหม่ deleted:true ทับ entity เดิม
  sopRemove: function (id) {
    if (!id) return Promise.resolve({ error: 'ไม่มี sop_id' });
    return sop2Write({ entity_id: id, deleted: true, payload: { sop_id: id } });
  },
};

/* ============================================================
   mountSop — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountSop() {
  if (!document.getElementById('wrap-sop')) return;
  var wrap = document.getElementById('wrap-sop');
  wrap.innerHTML = '<style>' + SOP_CSS() + '</style><div id="sop">' + SOP_MARKUP() + '</div>';
  SOP_RUN_PAGE_JS();
}

/* ===== CSS เดิม (<style> ใน sop_manager.html) · prefix ทุก selector ด้วย #sop =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว) */
function SOP_CSS() {
  return [
    // tokens
    '#sop{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--bg:#F8F9FA;--muted:#6B7280;--border:#E5E7EB;color:var(--navy);font-size:14px}',
    '#sop *,#sop *::before,#sop *::after{box-sizing:border-box}',
    // page head (native บน dashboard)
    '#sop .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#sop .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#sop .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#sop .page-head .subtitle{font-size:12px;color:#64748B;margin-top:4px}',
    '#sop .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}',
    // top banner
    '#sop .top{background:var(--navy);color:#fff;padding:18px 20px;position:relative;overflow:hidden;border-radius:10px}',
    '#sop .top::after{content:"";position:absolute;top:-30px;right:-30px;width:90px;height:90px;border-radius:50%;background:var(--teal);opacity:.18}',
    '#sop .top>*{position:relative;z-index:1}',
    '#sop .top-eyebrow{font-size:11px;color:rgba(255,255,255,.7);letter-spacing:1.5px}',
    '#sop .top-title{font-size:18px;font-weight:500;margin-top:2px}',
    '#sop .top-sub{font-size:11px;color:rgba(255,255,255,.7);margin-top:6px}',
    // actions / btn
    '#sop .actions{padding:14px 0;display:flex;gap:10px}',
    '#sop .btn{padding:9px 14px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:#fff;color:var(--navy)}',
    '#sop .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    // body / table
    '#sop .body{padding:0 0 20px}',
    '#sop table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)}',
    '#sop th{background:var(--bg);padding:10px 12px;font-size:10px;font-weight:600;text-align:left;letter-spacing:.5px;color:var(--muted);text-transform:uppercase}',
    '#sop td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border)}',
    '#sop tr:hover td{background:var(--teal-light);cursor:pointer}',
    '#sop .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    '#sop .loading{padding:40px 20px;text-align:center;color:var(--muted)}',
    '#sop .alert{padding:11px 14px;border-radius:8px;margin:14px 0 0;font-size:12px;background:#FEF3C7;color:#B45309;border-left:3px solid #F59E0B}',
    // modal
    '#sop .modal-backdrop{position:fixed;inset:0;background:rgba(13,47,79,.6);display:none;align-items:flex-start;justify-content:center;z-index:9100;padding:40px 16px;overflow-y:auto}',
    '#sop .modal-backdrop.show{display:flex}',
    '#sop .modal{background:#fff;border-radius:14px;padding:24px;max-width:480px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.2)}',
    '#sop .modal-eyebrow{font-size:11px;color:var(--muted);letter-spacing:1.2px}',
    '#sop .modal-title{font-size:17px;font-weight:500;color:var(--navy);margin:2px 0 16px}',
    '#sop .modal-field{margin-bottom:12px}',
    '#sop .modal-label{display:block;font-size:11px;font-weight:500;color:var(--navy);margin-bottom:5px;letter-spacing:.3px}',
    '#sop .modal-input,#sop .modal-select,#sop .modal-textarea{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:inherit;color:var(--navy);background:#fff}',
    '#sop .modal-input:focus,#sop .modal-select:focus,#sop .modal-textarea:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-light)}',
    '#sop .modal-textarea{resize:vertical;min-height:60px}',
    '#sop .modal-row{display:flex;gap:10px}',
    '#sop .modal-row>.modal-field{flex:1}',
    '#sop .modal-check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--navy);padding:6px 0}',
    '#sop .modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}',
    '#sop .modal-err{padding:9px 12px;border-radius:7px;font-size:11px;background:#FEE2E2;color:#DC2626;border-left:3px solid #DC2626;margin-bottom:10px;display:none}',
    '#sop .modal-err.show{display:block}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + top + alert + actions + table + create modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function SOP_MARKUP() {
  return [
    // header (native บน dashboard)
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="14" x2="15" y2="14"/><line x1="9" y1="18" x2="15" y2="18"/></svg>',
    '      SOP Manager',
    '    </h1>',
    '    <div class="subtitle">คู่มืองาน + ack tracking · versioned · เผยแพร่ผ่าน LINE · บังคับ ack</div>',
    '  </div>',
    '  <div class="page-actions"><button class="btn" onclick="sopLoadData()" title="Refresh">รีเฟรช</button></div>',
    '</header>',
    // top banner
    '<div class="top">',
    '  <div class="top-eyebrow">G2 · TRELLO CARDS #154 #175 #176</div>',
    '  <div class="top-title">SOP Catalog</div>',
    '  <div class="top-sub">จัดการ SOP · authoring · version · distribute · acknowledge</div>',
    '</div>',
    // alert
    '<div class="alert">Phase 2 Wave 2 · admin UI scaffolding · backend logic ใน module .gs · เปิด Google Sheet ดูข้อมูลดิบได้</div>',
    // actions
    '<div class="actions"><button class="btn btn-primary" onclick="sopOpenCreate()">สร้าง SOP ใหม่</button><button class="btn" onclick="sopLoadData()">รีเฟรช</button></div>',
    // body
    '<div class="body"><div id="tableWrap" class="loading">กำลังโหลด...</div></div>',
    // Create modal
    '<div class="modal-backdrop" id="createModal">',
    '  <div class="modal">',
    '    <div class="modal-eyebrow">G2 · SOP CATALOG</div>',
    '    <div class="modal-title">สร้าง SOP ใหม่</div>',
    '    <div class="modal-err" id="modalErr"></div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">ชื่อ SOP (ไทย) *</label>',
    '      <input type="text" class="modal-input" id="f_title_th" placeholder="เช่น · ขั้นตอนรับคนไข้ใหม่">',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">ชื่อ SOP (อังกฤษ)</label>',
    '      <input type="text" class="modal-input" id="f_title_en" placeholder="New Patient Intake SOP">',
    '    </div>',
    '    <div class="modal-row">',
    '      <div class="modal-field">',
    '        <label class="modal-label">Scope</label>',
    '        <select class="modal-select" id="f_scope">',
    '          <option value="ALL">ALL · ทุกแผนก</option>',
    '          <option value="HR">HR</option>',
    '          <option value="Marketing">Marketing</option>',
    '          <option value="Manager">Manager</option>',
    '          <option value="PT">PT</option>',
    '          <option value="Doctor">Doctor</option>',
    '          <option value="Reception">Reception</option>',
    '        </select>',
    '      </div>',
    '      <div class="modal-field">',
    '        <label class="modal-label">Category</label>',
    '        <select class="modal-select" id="f_category">',
    '          <option value="process">Process</option>',
    '          <option value="safety">Safety</option>',
    '          <option value="clinical">Clinical</option>',
    '          <option value="admin">Admin</option>',
    '          <option value="compliance">Compliance</option>',
    '        </select>',
    '      </div>',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">Google Doc URL</label>',
    '      <input type="url" class="modal-input" id="f_doc_url" placeholder="https://docs.google.com/...">',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">สรุปย่อ (200 ตัวอักษร)</label>',
    '      <textarea class="modal-textarea" id="f_summary_md" maxlength="500"></textarea>',
    '    </div>',
    '    <div class="modal-row">',
    '      <div class="modal-field">',
    '        <label class="modal-label">Review cycle (เดือน)</label>',
    '        <input type="number" class="modal-input" id="f_review_cycle_months" value="12" min="1" max="60">',
    '      </div>',
    '      <div class="modal-field">',
    '        <label class="modal-label">Tags (คั่นด้วย ,)</label>',
    '        <input type="text" class="modal-input" id="f_tags" placeholder="onboarding,clinical">',
    '      </div>',
    '    </div>',
    '    <label class="modal-check"><input type="checkbox" id="f_requires_ack" checked> ต้อง acknowledge หลังอ่าน</label>',
    '    <label class="modal-check"><input type="checkbox" id="f_requires_quiz"> มี quiz ทดสอบความเข้าใจ</label>',
    '    <div class="modal-actions">',
    '      <button class="btn" onclick="sopCloseCreate()">ยกเลิก</button>',
    '      <button class="btn btn-primary" id="saveBtn" onclick="sopDoCreate()">บันทึก draft</button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   SOP_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → SOP_BACKEND
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window (prefix sop กันชน) ตอนท้าย
   ============================================================ */
function SOP_RUN_PAGE_JS() {

  // ---- google.script.run shim → SOP_BACKEND (async, คืน shape เดิม) ----
  function _sop2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (SOP_BACKEND[prop]) {
            Promise.resolve().then(function () { return SOP_BACKEND[prop].apply(SOP_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[SOP_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[SOP_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _sop2MakeChain(); } });

  // ---- helpers (inline · ใช้ global esc ถ้ามี, fallback ใน scope) ----
  function escapeHtml(s) {
    if (typeof window !== 'undefined' && typeof window.esc === 'function') return window.esc(String(s == null ? '' : s));
    var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML;
  }
  function showToast(msg) {
    var t = document.getElementById('sop2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'sop2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;background:#0F172A;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.sop2Toast = showToast;

  /* ====================================================================
     ===== JS หน้าเดิม sop_manager.html (ลอกทั้งดุ้น) =====
     ใช้ scope ใต้ #sop กันชน id (helper getById)
     ==================================================================== */
  var _sopRoot = document.getElementById('sop');
  function getById(id) { return _sopRoot ? _sopRoot.querySelector('#' + id) : document.getElementById(id); }

  var COLUMNS = ["Title", "Scope", "Version", "Status", "Effective", "Acks"];
  var _rows = [];
  var _sopEditId = null; // null = สร้างใหม่ · มีค่า = แก้

  function loadData() {
    getById('tableWrap').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(onLoaded).withFailureHandler(function (e) {
      getById('tableWrap').innerHTML = '<div class="empty">โหลดล้มเหลว · ' + escapeHtml(e && (e.message || e)) + '</div>';
    }).sopManagerList({});
  }

  function onLoaded(res) {
    if (!res || res.error) {
      getById('tableWrap').innerHTML = '<div class="empty">' + escapeHtml(res ? res.error : 'no_data') + '</div>';
      return;
    }
    _rows = res.rows || res.records || res.items || res.by_channel || [];
    render();
  }

  function render() {
    if (!_rows.length || !COLUMNS.length) {
      getById('tableWrap').innerHTML = '<div class="empty">ยังไม่มีรายการ</div>';
      return;
    }
    var h = '<table><thead><tr>';
    COLUMNS.forEach(function (c) { h += '<th>' + escapeHtml(c) + '</th>'; });
    h += '<th style="text-align:right">จัดการ</th>';
    h += '</tr></thead><tbody>';
    _rows.forEach(function (r, i) {
      h += '<tr>';
      COLUMNS.forEach(function (c) {
        var v = r[c];
        h += '<td onclick="sopOpenItem(' + i + ')" style="cursor:pointer">' + escapeHtml(String(v == null ? '-' : v)) + '</td>';
      });
      h += '<td style="text-align:right;white-space:nowrap">' +
        '<button class="btn" style="padding:4px 9px;font-size:11px" onclick="sopOpenEdit(' + i + ')">แก้</button> ' +
        '<button class="btn" style="padding:4px 9px;font-size:11px;color:#DC2626;border-color:#FECACA" onclick="sopRemove(' + i + ')">ลบ</button>' +
        '</td>';
      h += '</tr>';
    });
    h += '</tbody></table>';
    getById('tableWrap').innerHTML = h;
  }

  function openItem(idx) {
    var r = _rows[idx];
    if (!r) return;
    var full = r._full || r;
    alert(JSON.stringify(full, null, 2));
  }

  // ===== Create / Edit modal handlers =====
  function resetForm() {
    getById('f_title_th').value = '';
    getById('f_title_en').value = '';
    getById('f_scope').value = 'ALL';
    getById('f_category').value = 'process';
    getById('f_doc_url').value = '';
    getById('f_summary_md').value = '';
    getById('f_review_cycle_months').value = '12';
    getById('f_tags').value = '';
    getById('f_requires_ack').checked = true;
    getById('f_requires_quiz').checked = false;
  }
  function openCreate() {
    _sopEditId = null;
    resetForm();
    var t = getById('createModal').querySelector('.modal-title');
    if (t) t.textContent = 'สร้าง SOP ใหม่';
    getById('saveBtn').textContent = 'บันทึก draft';
    getById('modalErr').classList.remove('show');
    getById('createModal').classList.add('show');
  }
  function openEdit(idx) {
    var r = _rows[idx];
    if (!r) { showToast('ไม่พบรายการ'); return; }
    var s = r._full || r;
    _sopEditId = s.sop_id || '';
    resetForm();
    getById('f_title_th').value = s.title_th || '';
    getById('f_title_en').value = s.title_en || '';
    getById('f_scope').value = s.scope || 'ALL';
    getById('f_category').value = s.category || 'process';
    getById('f_doc_url').value = s.doc_url || '';
    getById('f_summary_md').value = s.summary_md || '';
    getById('f_review_cycle_months').value = s.review_cycle_months || 12;
    getById('f_tags').value = s.tags || '';
    getById('f_requires_ack').checked = s.requires_ack !== false;
    getById('f_requires_quiz').checked = !!s.requires_quiz;
    var t = getById('createModal').querySelector('.modal-title');
    if (t) t.textContent = 'แก้ไข SOP';
    getById('saveBtn').textContent = 'บันทึก';
    getById('modalErr').classList.remove('show');
    getById('createModal').classList.add('show');
  }
  function removeSop(idx) {
    var r = _rows[idx];
    if (!r) return;
    var s = r._full || r;
    var id = s.sop_id || '';
    if (!id) { showToast('ไม่มี sop_id'); return; }
    if (!confirm('ลบ SOP นี้?\n' + (s.title_th || s.title_en || id) + '\n(ลบแบบ soft — กู้คืนได้)')) return;
    google.script.run
      .withSuccessHandler(function (res) {
        if (res && res.error) { showToast('ลบล้มเหลว · ' + res.error); return; }
        showToast('ลบ SOP แล้ว');
        loadData();
      })
      .withFailureHandler(function (e) { showToast('ลบล้มเหลว · ' + (e.message || e)); })
      .sopRemove(id);
  }
  function closeCreate() {
    getById('createModal').classList.remove('show');
    _sopEditId = null;
  }
  function modalErr(msg) {
    var e = getById('modalErr');
    e.textContent = msg;
    e.classList.add('show');
  }
  function doCreate() {
    var title = getById('f_title_th').value.trim();
    if (!title) { modalErr('กรุณากรอกชื่อ SOP (ไทย)'); return; }
    var payload = {
      title_th:             title,
      title_en:             getById('f_title_en').value.trim(),
      scope:                getById('f_scope').value,
      category:             getById('f_category').value,
      doc_url:              getById('f_doc_url').value.trim(),
      summary_md:           getById('f_summary_md').value.trim(),
      review_cycle_months:  Number(getById('f_review_cycle_months').value || 12),
      tags:                 getById('f_tags').value.trim(),
      requires_ack:         getById('f_requires_ack').checked,
      requires_quiz:        getById('f_requires_quiz').checked,
    };
    if (_sopEditId) payload.sop_id = _sopEditId;
    var isEdit = !!_sopEditId;
    var btn = getById('saveBtn');
    var btnLabel = isEdit ? 'บันทึก' : 'บันทึก draft';
    btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
    google.script.run
      .withSuccessHandler(function (res) {
        btn.disabled = false; btn.textContent = btnLabel;
        if (res && res.ok) {
          closeCreate();
          resetForm();
          showToast(isEdit ? 'แก้ไข SOP แล้ว' : 'เพิ่ม SOP แล้ว');
          loadData();
        } else { modalErr('บันทึกล้มเหลว · ' + (res ? res.error : 'unknown')); }
      })
      .withFailureHandler(function (e) {
        btn.disabled = false; btn.textContent = btnLabel;
        modalErr('ระบบขัดข้อง · ' + (e.message || e));
      })
      .sopCreate(payload);
  }

  /* ===== expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix sop กันชน) ===== */
  window.sopLoadData = loadData;
  window.sopOpenItem = openItem;
  window.sopOpenCreate = openCreate;
  window.sopOpenEdit = openEdit;
  window.sopRemove = removeSop;
  window.sopCloseCreate = closeCreate;
  window.sopDoCreate = doCreate;

  /* ===== Init ===== */
  loadData();
}

/* ===== expose mount ===== */
if (typeof window !== 'undefined') window.mountSop = mountSop;
