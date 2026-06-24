// _ported/recruittpl.js — FULL native port of recruit_templates_manager.html
//   (HR Announcement admin · หน้า "Communication Templates" / เทมเพลตสรรหา)
// ลอกทั้งดุ้น: filter-row (search/category/channel/show-inactive) + grid การ์ด template
//   + edit modal (สร้าง/แก้/ลบ) + seed defaults + copy
//   CSS เดิม (_shared_styles ที่ใช้ + <style> manager) prefix #rt ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ RT_RUN_PAGE_JS() · google.script.run = shim → RT_BACKEND (Supabase)
//
// ใช้ global window.sb/window.esc/window.$ (index.html module scope) — ห้าม redeclare
//   helper (escapeHtml/escapeAttr/showToast) inline ใน scope · fn ที่ inline onclick ต้องใช้ → ผูกกับ window
//
// backend (edge fn hr_list?type=recruit_template.updated&limit=2000 → {items}) :
//   list   → derive templates client-side จาก payload ล่าสุดต่อ template (ว่าง → empty state สวย)
//   create/update/remove/seedDefaults → เขียนกลับไม่ได้ → stub + toast('ยังไม่พร้อมบน dashboard')
//   render ได้แม้ว่าง

/* ============================================================
   RT_BACKEND — map google.script.run → Supabase edge fn hr_list
     recruitTemplateList(opts)        → { items }
     recruitTemplateCreate/Update/Remove/SeedDefaults → stub + toast
   ============================================================ */
var RT_FN = 'hr_list';
var RT_TYPE = 'recruit_template.updated';
var RT_LIMIT = 2000;

function rt2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function rt2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function rt2Bool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function rt2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

var RT_CATEGORIES = ['thank_you', 'interview_invite', 'rejection', 'offer_extend', 'reminder', 'custom'];
var RT_CHANNELS = ['line', 'email', 'both'];

// map payload event ดิบ → template row shape ที่ JS เดิมใช้
function rt2MapTpl(p) {
  p = p || {};
  var category = String(p.category || 'custom').toLowerCase();
  if (RT_CATEGORIES.indexOf(category) < 0) category = 'custom';
  var channel = String(p.channel || 'line').toLowerCase();
  if (RT_CHANNELS.indexOf(channel) < 0) channel = 'line';
  var bodyTh = p.body_th || p.body || p.content || '';
  var preview = p.body_preview;
  if (preview == null) {
    preview = String(bodyTh).replace(/\s+/g, ' ').trim().slice(0, 160);
  }
  return {
    template_id: p.template_id || p.entity_id || p.id || '',
    name: p.name || p.title || '—',
    category: category,
    channel: channel,
    subject: p.subject || '',
    body_th: bodyTh,
    body_preview: preview,
    is_default: rt2Bool(p.is_default),
    active: (p.active == null) ? true : rt2Bool(p.active),
    usage_count: rt2Num(p.usage_count),
    last_used_at: rt2Date(p.last_used_at),
    _raw: p,
  };
}

// cache template ล่าสุดต่อ template_id
var _rt2Tpls = [];

function rt2FetchTpls() {
  var url = RT_FN + '?type=' + encodeURIComponent(RT_TYPE) + '&limit=' + RT_LIMIT;
  return window.sb.functions.invoke(url).then(function (res) {
    var data = (res && res.data) || {};
    var items = rt2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.template_id || p.entity_id || p.id || '';
      if (!id) { rows.push(rt2MapTpl(p)); return; }
      if (seen[id]) return;          // payload เรียงใหม่→เก่า · เอา event ล่าสุดต่อ id
      seen[id] = true;
      rows.push(rt2MapTpl(p));
    });
    _rt2Tpls = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[RT_BACKEND] list fetch failed', e);
    _rt2Tpls = [];
    return [];
  });
}

var RT_BACKEND = {
  // list — { items } (เดิม recruitTemplateList รับ {active:false} = เอาทั้งหมด รวม inactive)
  recruitTemplateList: function () {
    return rt2FetchTpls().then(function (all) {
      return { items: all };
    });
  },

  // ---- mutations: เขียนกลับไม่ได้บน dashboard → stub + toast ----
  recruitTemplateCreate: function () {
    rt2NotReady('สร้าง template');
    return Promise.resolve({ error: 'สร้าง template ยังไม่พร้อมบน dashboard (read-only)' });
  },
  recruitTemplateUpdate: function () {
    rt2NotReady('แก้ไข template');
    return Promise.resolve({ error: 'แก้ไข template ยังไม่พร้อมบน dashboard (read-only)' });
  },
  recruitTemplateRemove: function () {
    rt2NotReady('ลบ template');
    return Promise.resolve({ error: 'ลบ template ยังไม่พร้อมบน dashboard (read-only)' });
  },
  recruitTemplateSeedDefaults: function () {
    rt2NotReady('Seed defaults');
    return Promise.resolve({ error: 'Seed defaults ยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _rt2NotReadyShown = {};
function rt2NotReady(feature) {
  if (_rt2NotReadyShown[feature]) return;
  _rt2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.rt2Toast) {
    window.rt2Toast('ยังไม่พร้อมบน dashboard', 'error');
  }
}

/* ============================================================
   mountRecruittpl — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountRecruittpl() {
  if (!document.getElementById('wrap-recruittpl')) return;
  var wrap = document.getElementById('wrap-recruittpl');
  wrap.innerHTML = '<style>' + RT_CSS() + '</style><div id="rt">' + RT_MARKUP() + '</div>';
  RT_RUN_PAGE_JS();
}
window.mountRecruittpl = mountRecruittpl;

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #rt =====
   ตัด .app-shell/sidebar/main-area/topbar shell ออก (dashboard มี shell แล้ว) */
function RT_CSS() {
  return [
    // tokens (มาจาก _shared_styles)
    '#rt{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--teal-bg:#E6F7F5;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEE2E2;--success:#047857;--success-bg:#DCFCE7;--warning:#B45309;--warning-bg:#FEF3C7;--info:#1D4ED8;--info-bg:#DBEAFE;color:var(--text);font-size:13px;line-height:1.5}',
    '#rt *{box-sizing:border-box}',
    // main head (native บน dashboard · ไม่มี shell)
    '#rt .main-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;gap:16px;flex-wrap:wrap}',
    '#rt .main-head h1{font-size:22px;font-weight:600;color:var(--navy);margin:0;display:flex;align-items:center;gap:10px;letter-spacing:-0.02em}',
    '#rt .main-head h1 svg{width:22px;height:22px;color:var(--teal)}',
    '#rt .main-head .sub{font-size:12px;color:var(--text-muted);margin-top:4px}',
    // buttons (จาก _shared_styles + manager)
    '#rt .btn{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:5px;font-size:11px;font-weight:500;cursor:pointer;border:1px solid transparent;font-family:inherit}',
    '#rt .btn svg{width:11px;height:11px}',
    '#rt .btn-primary{background:var(--teal);color:white;border-color:var(--teal)}',
    '#rt .btn-primary:hover{background:var(--teal-dark)}',
    '#rt .btn-ghost{background:white;border-color:var(--border);color:var(--text-muted)}',
    '#rt .btn-ghost:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#rt .btn-danger{background:white;border-color:var(--danger);color:var(--danger)}',
    '#rt .btn-danger:hover{background:var(--danger-bg)}',
    // filter row
    '#rt .filter-row{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center}',
    '#rt .filter-row select,#rt .filter-row input{padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:12px;background:white;color:var(--text)}',
    // grid + cards
    '#rt .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}',
    '#rt .tpl-card{background:white;border:1px solid var(--border);border-radius:10px;padding:14px;cursor:pointer;transition:all 0.15s;display:flex;flex-direction:column;gap:6px}',
    '#rt .tpl-card:hover{border-color:var(--teal);box-shadow:0 2px 8px rgba(13,47,79,0.06)}',
    '#rt .tpl-card.inactive{opacity:0.5}',
    '#rt .tpl-head{display:flex;justify-content:space-between;align-items:flex-start;gap:6px}',
    '#rt .tpl-name{font-size:13px;font-weight:600;color:var(--navy)}',
    '#rt .tpl-meta{font-size:10px;color:var(--text-muted);margin-top:2px;display:flex;gap:6px;flex-wrap:wrap}',
    '#rt .meta-pill{padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600}',
    '#rt .pill-thank_you{background:var(--success-bg);color:var(--success)}',
    '#rt .pill-interview_invite{background:var(--warning-bg);color:var(--warning)}',
    '#rt .pill-rejection{background:var(--danger-bg);color:var(--danger)}',
    '#rt .pill-offer_extend{background:#EDE9FE;color:#6D28D9}',
    '#rt .pill-reminder{background:var(--info-bg);color:var(--info)}',
    '#rt .pill-custom{background:var(--border);color:var(--text-muted)}',
    '#rt .pill-line{background:#E0F2FE;color:#0369A1}',
    '#rt .pill-email{background:var(--info-bg);color:var(--info)}',
    '#rt .pill-both{background:var(--teal-bg);color:var(--teal-dark)}',
    '#rt .pill-default{background:var(--teal);color:white}',
    '#rt .tpl-body{font-size:12px;color:var(--text-muted);line-height:1.6;max-height:100px;overflow:hidden;white-space:pre-wrap}',
    '#rt .tpl-vars{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}',
    '#rt .tpl-var{font-size:9px;padding:1px 5px;background:#F1F5F9;color:var(--text-muted);border-radius:3px;font-family:monospace}',
    '#rt .tpl-foot{display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:0.5px solid var(--border);margin-top:auto}',
    '#rt .tpl-usage{font-size:10px;color:var(--text-muted)}',
    '#rt .tpl-actions{display:flex;gap:4px}',
    // empty
    '#rt .empty{padding:60px 20px;text-align:center;background:white;border:1px dashed var(--border);border-radius:10px}',
    '#rt .empty-title{font-size:14px;font-weight:600;color:var(--text-muted)}',
  ].join('\n') + RT_CSS2();
}

/* CSS part 2 — modal / field / row */
function RT_CSS2() {
  return '\n' + [
    '#rt .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.4);display:none;align-items:center;justify-content:center;z-index:9000}',
    '#rt .modal-bg.active{display:flex}',
    '#rt .modal{background:white;border-radius:12px;max-width:600px;width:92%;max-height:92vh;overflow-y:auto}',
    '#rt .modal-header{padding:16px 20px;border-bottom:0.5px solid var(--border)}',
    '#rt .modal-header h2{font-size:16px;margin:0;color:var(--navy)}',
    '#rt .modal-body{padding:16px 20px}',
    '#rt .modal-footer{padding:12px 20px;border-top:0.5px solid var(--border);display:flex;justify-content:space-between;gap:8px}',
    '#rt .field{margin-bottom:12px}',
    '#rt .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#rt .field input,#rt .field select,#rt .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:0.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#rt .field textarea{min-height:140px;resize:vertical;line-height:1.6}',
    '#rt .var-hint{font-size:10px;color:var(--text-faint);margin-top:3px;font-family:monospace}',
    '#rt .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
  ].join('\n');
}

/* ===== markup เดิม ครบ main-head + filter-row + grid + edit modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function RT_MARKUP() {
  return [
    '<div class="main-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    '      Communication Templates',
    '    </h1>',
    '    <div class="sub">30d · LINE/email template ที่ใช้ซ้ำ ๆ · ปุ่มเดียวส่งหา candidate · ตัวแปร auto-fill</div>',
    '  </div>',
    '  <div style="display:flex;gap:6px">',
    '    <button class="btn btn-ghost" onclick="seedDefaults()">Seed defaults</button>',
    '    <button class="btn btn-primary" onclick="openEditModal(null)">+ Template ใหม่</button>',
    '  </div>',
    '</div>',
    '<div class="filter-row">',
    '  <input type="search" id="f-search" placeholder="ค้นหาชื่อ/เนื้อหา" oninput="render()">',
    '  <select id="f-category" onchange="render()">',
    '    <option value="">ทุกหมวด</option>',
    '    <option value="thank_you">ขอบคุณที่สมัคร</option>',
    '    <option value="interview_invite">นัดสัมภาษณ์</option>',
    '    <option value="rejection">ปฏิเสธ</option>',
    '    <option value="offer_extend">ขยายเวลา offer</option>',
    '    <option value="reminder">เตือน</option>',
    '    <option value="custom">Custom</option>',
    '  </select>',
    '  <select id="f-channel" onchange="render()">',
    '    <option value="">ทุก channel</option>',
    '    <option value="line">LINE</option>',
    '    <option value="email">Email</option>',
    '    <option value="both">Both</option>',
    '  </select>',
    '  <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted)">',
    '    <input type="checkbox" id="f-show-inactive" onchange="render()" style="width:auto"> แสดง inactive',
    '  </label>',
    '</div>',
    '<div id="grid" class="grid">',
    '  <div class="empty"><div class="empty-title">กำลังโหลด...</div></div>',
    '</div>',
    RT_MODAL(),
  ].join('\n');
}

/* Edit modal · คง element id เดิม */
function RT_MODAL() {
  return [
    '<div class="modal-bg" id="edit-bg" onclick="if(event.target===this)closeEditModal()">',
    '  <div class="modal">',
    '    <div class="modal-header"><h2 id="ed-title">Template ใหม่</h2></div>',
    '    <div class="modal-body">',
    '      <input type="hidden" id="ed-id">',
    '      <div class="row">',
    '        <div class="field"><label>ชื่อ *</label><input id="ed-name" placeholder="เช่น \'ขอบคุณที่สมัคร\'"></div>',
    '        <div class="field"><label>หมวด *</label><select id="ed-category">',
    '          <option value="thank_you">ขอบคุณที่สมัคร</option>',
    '          <option value="interview_invite">นัดสัมภาษณ์</option>',
    '          <option value="rejection">ปฏิเสธ</option>',
    '          <option value="offer_extend">ขยายเวลา offer</option>',
    '          <option value="reminder">เตือน</option>',
    '          <option value="custom" selected>Custom</option>',
    '        </select></div>',
    '      </div>',
    '      <div class="row">',
    '        <div class="field"><label>Channel *</label><select id="ed-channel">',
    '          <option value="line">LINE</option>',
    '          <option value="email">Email</option>',
    '          <option value="both">Both</option>',
    '        </select></div>',
    '        <div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-top:18px">',
    '          <input type="checkbox" id="ed-active" checked style="width:auto"> Active',
    '        </label></div>',
    '      </div>',
    '      <div class="field" id="ed-subject-wrap"><label>Subject (email)</label><input id="ed-subject" placeholder="email subject"></div>',
    '      <div class="field">',
    '        <label>เนื้อหา (ภาษาไทย) *</label>',
    '        <textarea id="ed-body-th" placeholder="พิมพ์ template ที่นี่...&#10;ใช้ตัวแปร {{candidate_name}} {{position}} {{interview_date}}"></textarea>',
    '        <div class="var-hint">ตัวแปร auto-fill: {{candidate_name}} · {{position}} · {{interview_date}} · {{interview_time}} · {{interview_location}}</div>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn btn-danger" id="ed-remove" onclick="removeTemplate()" style="display:none">ลบ</button>',
    '      <div style="display:flex;gap:6px">',
    '        <button class="btn btn-ghost" onclick="closeEditModal()">ยกเลิก</button>',
    '        <button class="btn btn-primary" onclick="saveTemplate()">บันทึก</button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   RT_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → RT_BACKEND
   helper inline · fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function RT_RUN_PAGE_JS() {

  // ---- google.script.run shim → RT_BACKEND (async, คืน shape เดิม) ----
  function _rt2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (RT_BACKEND[prop]) {
            Promise.resolve().then(function () { return RT_BACKEND[prop].apply(RT_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[RT_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[RT_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _rt2MakeChain(); } });

  // ---- helpers (inline · prefix rt ใน id เพื่อกันชน) ----
  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('rt2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'rt2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.rt2Toast = showToast;

  /* ====================================================================
     ===== JS หน้าเดิม recruit_templates_manager.html (ลอกทั้งดุ้น) =====
     ใช้ scope ใต้ #rt กันชน id (helper getById)
     ==================================================================== */
  const _rtRoot = document.getElementById('rt');
  function $id(id) { return _rtRoot ? _rtRoot.querySelector('#' + id) : document.getElementById(id); }
  function getById(id) { return $id(id); }

  let allData = null;

  const CATEGORY_LABELS = {
    thank_you: 'ขอบคุณ', interview_invite: 'นัดสัมภาษณ์',
    rejection: 'ปฏิเสธ', offer_extend: 'ขยาย offer', reminder: 'เตือน', custom: 'Custom',
  };

  function loadData() {
    google.script.run
      .withSuccessHandler(d => {
        if (d && d.error) { getById('grid').innerHTML = '<div class="empty"><div class="empty-title">' + escapeHtml(d.error) + '</div></div>'; return; }
        allData = d || { items: [] };
        render();
      })
      .withFailureHandler(e => { getById('grid').innerHTML = '<div class="empty"><div class="empty-title">โหลดไม่สำเร็จ: ' + escapeHtml(e.message) + '</div></div>'; })
      .recruitTemplateList({ active: false });
  }

  function render() {
    if (!allData) return;
    const showInactive = getById('f-show-inactive').checked;
    const q = (getById('f-search').value || '').toLowerCase();
    const cat = getById('f-category').value;
    const ch = getById('f-channel').value;
    let items = allData.items || [];
    if (!showInactive) items = items.filter(t => t.active);
    if (cat) items = items.filter(t => t.category === cat);
    if (ch) items = items.filter(t => t.channel === ch || t.channel === 'both');
    if (q) items = items.filter(t => (t.name || '').toLowerCase().includes(q) || (t.body_th || '').toLowerCase().includes(q));

    if (!items.length) {
      getById('grid').innerHTML = '<div class="empty"><div class="empty-title">ยังไม่มี template</div><div style="font-size:12px;color:var(--text-faint);margin-top:6px">กด "Seed defaults" เพื่อสร้าง template ตัวอย่าง 5 แบบ</div></div>';
      return;
    }
    getById('grid').innerHTML = items.map(t => {
      const catLabel = CATEGORY_LABELS[t.category] || t.category;
      const vars = (t.body_th || '').match(/\{\{(\w+)\}\}/g) || [];
      const uniqVars = Array.from(new Set(vars));
      return '<div class="tpl-card ' + (t.active ? '' : 'inactive') + '" onclick="openEditModal(\'' + escapeAttr(t.template_id) + '\')">' +
        '<div class="tpl-head"><div>' +
          '<div class="tpl-name">' + escapeHtml(t.name) + '</div>' +
          '<div class="tpl-meta">' +
            '<span class="meta-pill pill-' + t.category + '">' + escapeHtml(catLabel) + '</span>' +
            '<span class="meta-pill pill-' + t.channel + '">' + escapeHtml(t.channel) + '</span>' +
            (t.is_default ? '<span class="meta-pill pill-default">default</span>' : '') +
          '</div>' +
        '</div></div>' +
        '<div class="tpl-body">' + escapeHtml(t.body_preview) + '</div>' +
        (uniqVars.length ? '<div class="tpl-vars">' + uniqVars.map(v => '<span class="tpl-var">' + escapeHtml(v) + '</span>').join('') + '</div>' : '') +
        '<div class="tpl-foot">' +
          '<span class="tpl-usage">ใช้แล้ว ' + t.usage_count + ' ครั้ง' + (t.last_used_at ? ' · ล่าสุด ' + escapeHtml(t.last_used_at) : '') + '</span>' +
          '<div class="tpl-actions">' +
            '<button class="btn btn-ghost" onclick="event.stopPropagation();copyTpl(\'' + escapeAttr(t.template_id) + '\')">Copy</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function openEditModal(id) {
    getById('ed-id').value = id || '';
    getById('ed-remove').style.display = id ? '' : 'none';
    if (id) {
      const t = (allData.items || []).find(x => x.template_id === id);
      if (!t) return;
      getById('ed-title').textContent = 'แก้ไข ' + t.name;
      getById('ed-name').value = t.name;
      getById('ed-category').value = t.category;
      getById('ed-channel').value = t.channel;
      getById('ed-subject').value = t.subject || '';
      getById('ed-body-th').value = t.body_th || '';
      getById('ed-active').checked = t.active;
    } else {
      getById('ed-title').textContent = 'Template ใหม่';
      getById('ed-name').value = '';
      getById('ed-category').value = 'custom';
      getById('ed-channel').value = 'line';
      getById('ed-subject').value = '';
      getById('ed-body-th').value = '';
      getById('ed-active').checked = true;
    }
    getById('edit-bg').classList.add('active');
  }
  function closeEditModal() { getById('edit-bg').classList.remove('active'); }

  function saveTemplate() {
    const id = getById('ed-id').value;
    const payload = {
      name: getById('ed-name').value.trim(),
      category: getById('ed-category').value,
      channel: getById('ed-channel').value,
      subject: getById('ed-subject').value,
      body_th: getById('ed-body-th').value,
      active: getById('ed-active').checked,
    };
    if (!payload.name) { showToast('ระบุชื่อ', 'error'); return; }
    if (!payload.body_th) { showToast('ระบุเนื้อหา', 'error'); return; }
    const callback = r => {
      if (r && r.error) { showToast(r.error, 'error'); return; }
      showToast(id ? 'บันทึกแล้ว' : 'สร้างแล้ว', 'success');
      closeEditModal(); loadData();
    };
    if (id) {
      google.script.run.withSuccessHandler(callback)
        .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
        .recruitTemplateUpdate(id, payload);
    } else {
      google.script.run.withSuccessHandler(callback)
        .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
        .recruitTemplateCreate(payload);
    }
  }

  function removeTemplate() {
    const id = getById('ed-id').value;
    if (!id) return;
    if (!confirm('ลบ template นี้? (soft-delete · ยังเก็บ usage history)')) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.error) { showToast(r.error, 'error'); return; }
      showToast('ลบแล้ว', 'success'); closeEditModal(); loadData();
    }).recruitTemplateRemove(id);
  }

  function copyTpl(id) {
    const t = (allData.items || []).find(x => x.template_id === id);
    if (!t) return;
    try { navigator.clipboard.writeText(t.body_th || ''); } catch (e) {}
    showToast('Copy ไป clipboard แล้ว', 'success');
  }

  function seedDefaults() {
    if (!confirm('สร้าง template ตัวอย่าง 5 แบบ? (skip ถ้ามีอยู่แล้ว)')) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.error) { showToast(r.error, 'error'); return; }
      if (r.skipped) showToast(r.skipped, 'info');
      else showToast('สร้าง ' + r.created + ' templates', 'success');
      loadData();
    }).recruitTemplateSeedDefaults();
  }

  /* ===== expose fn ที่ inline onclick ต้องเรียก ไปยัง window ===== */
  const _exp = {
    render, openEditModal, closeEditModal, saveTemplate, removeTemplate, copyTpl, seedDefaults,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadData();
}
