// _ported/tag.js — FULL native port of desktop tag_manager.html (HR Announcement admin · หน้า "ป้ายกำกับ (Tag)")
// ลอกทั้งดุ้น: stats(5) + filters(search/category/usage) + orphan banner + data-table (ID/แท็ก/หมวด/คำอธิบาย/พนง./ประกาศ/action)
//   + add/edit modal + help · CSS เดิม (_shared_styles ที่ใช้ + <style> manager) prefix #tg ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ TG_RUN_PAGE_JS() · google.script.run = shim → TG_BACKEND (Supabase)
//
// ใช้ global sb/esc/$ (index.html module scope) — ห้าม redeclare · helper inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน TG_RUN_PAGE_JS (prefix กันชน)
//
// backend (edge fn hr_list?type=tag.updated&limit=2000 → {items}) :
//   list (tagAdminList) → derive tags/stats/categories client-side จาก payload ล่าสุดต่อ tag_id
//            (ตอนนี้ list อาจว่าง = 0 tag → render ได้ ไม่ error · empty state สวย)
//   write (tagAdminAdd/tagAdminUpdate/tagAdminRemove/tagAdminAdoptOrphan)
//          → เขียนกลับไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   TG_BACKEND — map google.script.run → Supabase edge fn hr_list (type=tag.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     tagAdminList()              → { tags:[...], stats:{}, categories:{} }
     tagAdminAdd/Update/Remove/AdoptOrphan → { ok / error } stub + toast
   ============================================================ */
var TG_FN = 'hr_list';
var TG_TYPE = 'tag.updated';

function tg2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function tg2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function tg2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

// map payload event ดิบ → tag row shape ที่ JS เดิมใช้
function tg2MapTag(p) {
  p = p || {};
  var empCount = tg2Num(p.employee_count != null ? p.employee_count : p.emp_count);
  var annCount = tg2Num(p.announcement_count != null ? p.announcement_count : p.ann_count);
  return {
    tag_id:             p.tag_id || p.entity_id || p.id || '',
    tag_name:           p.tag_name || p.name || '',
    category:           p.category || '',
    description:        p.description || p.desc || '',
    employee_count:     empCount,
    announcement_count: annCount,
    is_orphan:          tg2Bool(p.is_orphan),
    _raw:               p,
  };
}

// cache แถวล่าสุดต่อ tag_id
var _tg2Tags = [];

function tg2FetchTags() {
  return sb.functions.invoke(TG_FN + '?type=' + encodeURIComponent(TG_TYPE) + '&limit=2000').then(function (res) {
    var data = (res && res.data) || {};
    var items = tg2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.tag_id || p.entity_id || p.id || '';
      var nm = p.tag_name || p.name || '';
      var key = id || nm;
      if (!key || seen[key]) return;
      seen[key] = true;
      rows.push(tg2MapTag(p));
    });
    _tg2Tags = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[TG_BACKEND] list fetch failed', e);
    _tg2Tags = [];
    return [];
  });
}

var TG_BACKEND = {
  // list — { tags, stats, categories }
  tagAdminList: function () {
    return tg2FetchTags().then(function (all) {
      var used = 0, unused = 0, orphans = 0;
      var categories = {};
      all.forEach(function (t) {
        if (t.is_orphan) {
          orphans++;
          var ok = '(orphan)';
          categories[ok] = (categories[ok] || 0) + 1;
        } else {
          if (t.employee_count > 0 || t.announcement_count > 0) used++; else unused++;
          var c = t.category || '(uncategorized)';
          categories[c] = (categories[c] || 0) + 1;
        }
      });
      // นับเฉพาะหมวดจริง (ไม่รวม orphan/uncategorized) เป็น "หมวดหมู่"
      var catCount = Object.keys(categories).filter(function (c) {
        return c !== '(orphan)' && c !== '(uncategorized)';
      }).length;
      var stats = {
        total:      all.length,
        used:       used,
        unused:     unused,
        orphans:    orphans,
        categories: catCount,
      };
      return { tags: all, stats: stats, categories: categories };
    });
  },

  // ---- write: เขียนกลับไม่ได้บน dashboard → stub + toast ----
  tagAdminAdd: function () {
    tg2NotReady('เพิ่มแท็ก');
    return Promise.resolve({ error: 'เพิ่มแท็ก ยังไม่พร้อมบน dashboard (read-only)' });
  },
  tagAdminUpdate: function () {
    tg2NotReady('แก้ไขแท็ก');
    return Promise.resolve({ error: 'แก้ไขแท็ก ยังไม่พร้อมบน dashboard (read-only)' });
  },
  tagAdminRemove: function () {
    tg2NotReady('ลบแท็ก');
    return Promise.resolve({ error: 'ลบแท็ก ยังไม่พร้อมบน dashboard (read-only)' });
  },
  tagAdminAdoptOrphan: function () {
    tg2NotReady('รับ orphan เข้าระบบ');
    return Promise.resolve({ error: 'รับ orphan เข้าระบบ ยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _tg2NotReadyShown = {};
function tg2NotReady(feature) {
  if (_tg2NotReadyShown[feature]) return;
  _tg2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.tg2Toast) window.tg2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountTag — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountTag() {
  if (!document.getElementById('wrap-tag')) return;
  var wrap = document.getElementById('wrap-tag');
  wrap.innerHTML = '<style>' + TG_CSS() + '</style><div id="tg">' + TG_MARKUP() + '</div>';
  TG_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #tg =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว) */
function TG_CSS() {
  return [
    // tokens (มาจาก _shared_styles)
    '#tg{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#tg *{box-sizing:border-box}',
    // buttons (จาก _shared_styles)
    '#tg .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#tg .btn:hover{border-color:var(--navy)}',
    '#tg .btn svg{width:14px;height:14px}',
    '#tg .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#tg .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#tg .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#tg .btn-sm{padding:5px 10px;font-size:12px}',
    '#tg .btn-icon{width:30px;height:30px;padding:0;justify-content:center}',
    '#tg .btn-icon svg{width:14px;height:14px}',
    '#tg .btn-icon-danger:hover{border-color:var(--danger);color:var(--danger)}',
    '#tg .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:8px;background:#fff;color:var(--text-muted);cursor:pointer}',
    '#tg .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#tg .btn-help svg{width:14px;height:14px}',
    // page head (native บน dashboard · ไม่มี shell page-head เดิม)
    '#tg .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#tg .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#tg .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#tg .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#tg .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;align-items:center}',
    // stat cards (จาก _shared_styles · .stats / .stat)
    '#tg .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#tg .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#tg .stats{grid-template-columns:repeat(2,1fr)}}',
    '#tg .stat{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#tg .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#tg .stat-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#tg .stat-value{font-size:22px;font-weight:600;line-height:1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#tg .stat-sub{font-size:10px;color:var(--text-faint);margin-top:3px}',
    // filters
    '#tg .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}',
    '#tg .filter{display:flex;flex-direction:column;gap:2px}',
    '#tg .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#tg .filter input,#tg .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#tg .filter input:focus,#tg .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section
    '#tg .section{background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden}',
    '#tg .section-header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border)}',
    '#tg .section-icon{width:32px;height:32px;border-radius:8px;background:#F0FDFA;color:var(--teal-dark);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}',
    '#tg .section-icon svg{width:16px;height:16px}',
    '#tg .section-title{font-size:13px;font-weight:600;color:var(--text)}',
    '#tg .section-sub{font-size:11px;color:var(--text-muted);margin-top:1px}',
    // data table (จาก <style> manager)
    '#tg .data-table{width:100%;border-collapse:collapse;font-size:13px}',
    '#tg .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#tg .data-table tbody td{padding:10px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}',
    '#tg .data-table tbody tr{border-left:3px solid transparent;transition:background .15s}',
    '#tg .data-table tbody tr:hover{background:#FAFBFC}',
    '#tg .data-table tbody tr.is-orphan{border-left-color:var(--warning);background:#FFFBEB}',
    '#tg .data-table tbody tr.is-unused{opacity:.6}',
    // tag pill
    '#tg .tag-pill{display:inline-block;padding:3px 10px;border-radius:14px;font-size:12px;font-weight:500;background:var(--info-bg);color:var(--info);font-family:"SF Mono",Consolas,monospace}',
    // cat badge
    '#tg .cat-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:500}',
    '#tg .cat-skill{background:#E0E7FF;color:#4338CA}',
    '#tg .cat-cert{background:#DCFCE7;color:#15803D}',
    '#tg .cat-special{background:#FFE4E6;color:#BE185D}',
    '#tg .cat-misc{background:#F1F5F9;color:var(--text-muted)}',
    '#tg .cat-orphan{background:var(--warning-bg);color:var(--warning)}',
    // count cell
    '#tg .count-cell{text-align:center;font-weight:600;font-size:13px;color:var(--text)}',
    '#tg .count-cell.zero{color:var(--text-faint);font-weight:400}',
    // orphan banner
    '#tg .orphan-banner{background:var(--warning-bg);border-left:3px solid var(--warning);border-radius:6px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:10px}',
    '#tg .orphan-banner svg{width:18px;height:18px;color:var(--warning);flex-shrink:0}',
    '#tg .orphan-text{font-size:12px;color:var(--warning)}',
    '#tg .orphan-text strong{font-weight:600}',
  ].join('\n') + TG_CSS2();
}

/* CSS part 2 — modal / field / empty / loading / misc */
function TG_CSS2() {
  return '\n' + [
    // modal
    '#tg .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#tg .modal-bg.active{display:flex}',
    '#tg .modal{background:#fff;border-radius:12px;max-width:560px;width:92%;max-height:92vh;overflow-y:auto}',
    '#tg .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#tg .modal-header h2{font-size:16px;margin:0}',
    '#tg .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#tg .modal-body{padding:16px 20px}',
    '#tg .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
    // field
    '#tg .field{margin-bottom:12px}',
    '#tg .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#tg .field input,#tg .field select,#tg .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#tg .field input:focus,#tg .field select:focus,#tg .field textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#tg .field input[disabled]{background:#F1F5F9;color:var(--text-muted)}',
    '#tg .field textarea{min-height:70px;resize:vertical}',
    '#tg .field-help{font-size:10px;color:var(--text-faint);margin-top:3px}',
    '#tg .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media (max-width:600px){#tg .field-grid{grid-template-columns:1fr}}',
    // empty / loading
    '#tg .empty{padding:40px 20px;text-align:center;color:var(--text-muted)}',
    '#tg .empty-icon{width:40px;height:40px;margin:0 auto 10px;color:var(--text-faint)}',
    '#tg .empty-icon svg{width:40px;height:40px}',
    '#tg .empty-title{font-size:13px;font-weight:500}',
    '#tg .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + stats + filters + orphan banner + section/content + modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell/legacy-topbar ออก */
function TG_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    '      แท็ก',
    '    </h1>',
    '    <div class="subtitle">04 · แท็กสำหรับ category พนักงาน · ใช้เป็น target ในประกาศ</div>',
    '  </div>',
    '  <div class="page-actions">',
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
    '    <input type="search" id="filter-search" placeholder="ID / ชื่อแท็ก / category" oninput="renderList()">',
    '  </div>',
    '  <div class="filter">',
    '    <label>หมวดหมู่</label>',
    '    <select id="filter-category" onchange="renderList()">',
    '      <option value="">ทุกหมวด</option>',
    '    </select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>สถานะการใช้</label>',
    '    <select id="filter-usage" onchange="renderList()">',
    '      <option value="">ทั้งหมด</option>',
    '      <option value="used">ใช้อยู่</option>',
    '      <option value="unused">ไม่ได้ใช้</option>',
    '      <option value="orphan">orphan (ไม่มีในตาราง)</option>',
    '    </select>',
    '  </div>',
    '</div>',
    // orphan banner wrap
    '<div id="orphan-banner-wrap"></div>',
    // section
    '<div class="section">',
    '  <div class="section-header">',
    '    <div class="section-icon" id="section-icon"></div>',
    '    <div style="flex:1">',
    '      <div class="section-title">รายการแท็ก</div>',
    '      <div class="section-sub">กดที่แถวเพื่อแก้ไข — แท็กที่ orphan สามารถ adopt เข้าตารางได้</div>',
    '    </div>',
    '  </div>',
    '  <div id="content" class="loading">กำลังโหลด...</div>',
    '</div>',
    TG_MODAL(),
  ].join('\n');
}

/* Add/Edit modal · คง element id เดิม */
function TG_MODAL() {
  return [
    '<div class="modal-bg" id="modal-bg" onclick="if(event.target===this)closeModal()">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2 id="modal-title">เพิ่มแท็ก</h2>',
    '      <p id="modal-sub">กรอก ID + ชื่อ + หมวดหมู่</p>',
    '    </div>',
    '    <div class="modal-body">',
    '      <input type="hidden" id="m-id-existing">',
    '      <div class="field-grid">',
    '        <div class="field">',
    '          <label>Tag ID *</label>',
    '          <input type="text" id="m-tag-id" placeholder="TAG001" style="font-family:monospace;text-transform:uppercase">',
    '          <div class="field-help">เช่น TAG001 — แก้ไม่ได้หลังสร้าง</div>',
    '        </div>',
    '        <div class="field">',
    '          <label>หมวดหมู่</label>',
    '          <input type="text" id="m-category" list="cat-list" placeholder="skill / cert / special / misc">',
    '          <datalist id="cat-list"></datalist>',
    '        </div>',
    '      </div>',
    '      <div class="field">',
    '        <label>ชื่อแท็ก *</label>',
    '        <input type="text" id="m-tag-name" placeholder="lead_doctor" style="font-family:monospace">',
    '        <div class="field-help">ใช้ snake_case — code อ้างอิงจาก name นี้</div>',
    '      </div>',
    '      <div class="field">',
    '        <label>คำอธิบาย</label>',
    '        <textarea id="m-description" placeholder="ความหมาย + เกณฑ์การได้รับแท็ก"></textarea>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeModal()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveTag()" id="save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   TG_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → TG_BACKEND
   helper (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย (prefix กันชน)
   ============================================================ */
function TG_RUN_PAGE_JS() {

  // ---- google.script.run shim → TG_BACKEND (async, คืน shape เดิม) ----
  function _tg2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (TG_BACKEND[prop]) {
            Promise.resolve().then(function () { return TG_BACKEND[prop].apply(TG_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[TG_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[TG_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _tg2MakeChain(); } });

  // ---- helpers (inline · prefix tg ใน id เพื่อกันชน) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('tg2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'tg2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.tg2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('tg-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'tg-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'tg-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'tg-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม tag_manager.html (ลอกทั้งดุ้น) =====
     ใช้ getById scope ใต้ #tg กันชน id (helper)
     ==================================================================== */
  const _tgRoot = document.getElementById('tg');
  function $id(id) { return _tgRoot ? _tgRoot.querySelector('#' + id) : document.getElementById(id); }
  // alias เพื่อให้โค้ดเดิม document.getElementById(...) ยังทำงาน → ใช้ getById ใน scope
  function getById(id) { return $id(id); }

  let allTags = [];

  const HELP = {
    title: 'Tag Manager — แท็กพนักงาน',
    subtitle: 'Sheet: 04_Tags',
    intro: 'แท็ก = label ที่ติดให้พนักงาน เช่น lead_doctor, ฉีดวัคซีนแล้ว, ผ่านอบรม CPR ใช้สำหรับ targeting ประกาศ + กรองรายชื่อ',
    sections: [
      {
        title: 'การใช้งาน',
        items: [
          'เพิ่มแท็กใหม่ → กรอก ID (TAG001) + ชื่อ (snake_case) + หมวด',
          'หมวดมาตรฐาน: skill / cert / special / misc',
          'แก้ไข/ลบ → ใช้ปุ่ม icon ทางขวา หรือคลิกแถวเพื่อแก้',
          'ใช้ filter "ใช้อยู่/ไม่ได้ใช้" เพื่อ cleanup แท็กที่ไม่ใช้',
        ],
      },
      {
        title: 'Smart features',
        items: [
          'นับการใช้งานทั้ง employee + announcement ให้อัตโนมัติ',
          'Orphan detection — แท็กที่ใช้ใน employee/ประกาศแต่ไม่มีในตาราง',
          'Adopt orphan → กดปุ่ม "รับเข้าระบบ" จะสร้าง row ใหม่ให้ทันที',
        ],
      },
      {
        type: 'warn',
        title: 'ระวัง',
        items: [
          'tag_name ใช้ snake_case เท่านั้น — code ใน Apps Script อ้างชื่อนี้',
          'หลังสร้างแล้ว Tag ID แก้ไม่ได้ (ถ้าผิดต้องลบสร้างใหม่)',
          'ลบแท็กที่มีคนใช้อยู่ → ระบบจะ block (ต้องลบจาก employee ก่อน)',
          'หมายเหตุ: บน dashboard นี้เป็น read-only — การเพิ่ม/แก้/ลบ/adopt ยังไม่พร้อม',
        ],
      },
    ],
  };

  getById('refresh-btn').innerHTML = ICONS.refresh;
  getById('add-btn').innerHTML = ICONS.plus + ' เพิ่มแท็ก';
  getById('save-btn').innerHTML = ICONS.save + ' บันทึก';
  getById('section-icon').innerHTML = ICONS.briefcase;
  getById('help-btn').innerHTML = ICONS.help;

  function loadList() {
    getById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(d => {
        allTags = (d && d.tags) || [];
        renderStats((d && d.stats) || {});
        populateCategories((d && d.categories) || {});
        renderList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tagAdminList();
  }

  function populateCategories(cats) {
    const sel = getById('filter-category');
    const dl = getById('cat-list');
    sel.innerHTML = '<option value="">ทุกหมวด</option>';
    dl.innerHTML = '';
    Object.keys(cats).sort().forEach(c => {
      sel.innerHTML += `<option value="${escapeAttr(c)}">${escapeHtml(c)} (${cats[c]})</option>`;
      if (c !== '(uncategorized)' && c !== '(orphan)') {
        dl.innerHTML += `<option value="${escapeAttr(c)}">`;
      }
    });
  }

  function renderStats(s) {
    getById('stats').innerHTML = [
      statCard('รวม', s.total, 'แท็กทั้งหมด', 'var(--navy)'),
      statCard('ใช้อยู่', s.used, 'มีพนักงาน/ประกาศ', 'var(--success)'),
      statCard('ไม่ใช้', s.unused, 'ลบทิ้งได้', s.unused > 0 ? 'var(--text-faint)' : 'var(--success)'),
      statCard('Orphan', s.orphans, 'ไม่มีใน Tab 04', s.orphans > 0 ? 'var(--warning)' : 'var(--success)'),
      statCard('หมวดหมู่', s.categories, 'categories', 'var(--info)'),
    ].join('');
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  function renderList() {
    const q = (getById('filter-search').value || '').toLowerCase().trim();
    const cat = getById('filter-category').value;
    const usage = getById('filter-usage').value;

    let filtered = allTags;
    if (cat) filtered = filtered.filter(t => (t.category || '(uncategorized)') === cat);
    if (q) filtered = filtered.filter(t =>
      t.tag_id.toLowerCase().includes(q) ||
      t.tag_name.toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q));
    if (usage === 'used') filtered = filtered.filter(t => !t.is_orphan && (t.employee_count > 0 || t.announcement_count > 0));
    if (usage === 'unused') filtered = filtered.filter(t => !t.is_orphan && t.employee_count === 0 && t.announcement_count === 0);
    if (usage === 'orphan') filtered = filtered.filter(t => t.is_orphan);

    // Orphan banner
    const orphans = allTags.filter(t => t.is_orphan);
    const banner = getById('orphan-banner-wrap');
    if (orphans.length > 0 && !usage) {
      banner.innerHTML = [
        '<div class="orphan-banner">',
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
          '<div class="orphan-text">',
            '<strong>' + orphans.length + ' orphan tags</strong> — ใช้ใน employee/announcement แต่ไม่มี row ใน Tab 04 ',
            '<a onclick="document.getElementById(\'filter-usage\') ; tgSetUsage(\'orphan\')" style="color:var(--warning);text-decoration:underline;cursor:pointer;font-weight:500">ดูทั้งหมด</a>',
          '</div>',
        '</div>',
      ].join('');
    } else {
      banner.innerHTML = '';
    }

    if (filtered.length === 0) {
      getById('content').innerHTML = '<div class="empty"><div class="empty-icon">' + ICONS.briefcase + '</div><div class="empty-title">ไม่พบแท็ก</div></div>';
      return;
    }

    const rows = filtered.map(t => {
      const total = t.employee_count + t.announcement_count;
      const trClass = t.is_orphan ? 'is-orphan' : (total === 0 ? 'is-unused' : '');
      const catClass = t.is_orphan ? 'cat-orphan' :
        (t.category || '').toLowerCase().includes('skill') ? 'cat-skill' :
        (t.category || '').toLowerCase().includes('cert') ? 'cat-cert' :
        (t.category || '').toLowerCase().includes('special') ? 'cat-special' : 'cat-misc';

      let actionsCell;
      if (t.is_orphan) {
        actionsCell = '<button class="btn btn-sm btn-primary" onclick="adoptOrphan(\'' + escapeAttr(t.tag_name) + '\')">รับเข้าระบบ</button>';
      } else {
        actionsCell = [
          '<button class="btn btn-icon" onclick="openEdit(\'' + escapeAttr(t.tag_id) + '\')" title="แก้">' + ICONS.edit + '</button>',
          '<button class="btn btn-icon btn-icon-danger" onclick="removeTag(\'' + escapeAttr(t.tag_id) + '\', \'' + escapeAttr(t.tag_name) + '\')" title="ลบ">' + ICONS.trash + '</button>',
        ].join('');
      }

      return [
        '<tr class="' + trClass + '" ' + (t.is_orphan ? '' : 'onclick="openEdit(\'' + escapeAttr(t.tag_id) + '\')" style="cursor:pointer"') + '>',
          '<td>',
            t.is_orphan ? '<span style="font-family:monospace;font-size:11px;color:var(--text-faint)">' + escapeHtml(t.tag_id) + '</span>' :
              '<span style="font-family:\'SF Mono\',Consolas,monospace;font-size:12px;font-weight:600;color:var(--text)">' + escapeHtml(t.tag_id) + '</span>',
          '</td>',
          '<td><span class="tag-pill">' + escapeHtml(t.tag_name) + '</span></td>',
          '<td><span class="cat-badge ' + catClass + '">' + escapeHtml(t.category || 'uncategorized') + '</span></td>',
          '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(t.description || '—') + '</td>',
          '<td><div class="count-cell ' + (t.employee_count === 0 ? 'zero' : '') + '">' + t.employee_count + '</div></td>',
          '<td><div class="count-cell ' + (t.announcement_count === 0 ? 'zero' : '') + '">' + t.announcement_count + '</div></td>',
          '<td onclick="event.stopPropagation()" style="text-align:right">',
            '<div style="display:flex;gap:4px;justify-content:flex-end">' + actionsCell + '</div>',
          '</td>',
        '</tr>',
      ].join('');
    }).join('');

    getById('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th style="width:90px">ID</th>',
          '<th>แท็ก</th>',
          '<th style="width:130px">หมวดหมู่</th>',
          '<th>คำอธิบาย</th>',
          '<th style="width:70px;text-align:center">พนง.</th>',
          '<th style="width:70px;text-align:center">ประกาศ</th>',
          '<th style="width:140px"></th>',
        '</tr></thead>',
        '<tbody>' + rows + '</tbody>',
      '</table>',
    ].join('');
  }

  // helper สำหรับลิงก์ "ดูทั้งหมด" ใน orphan banner (scope-safe แทน inline document.getElementById เดิม)
  function tgSetUsage(v) {
    const sel = getById('filter-usage');
    if (sel) sel.value = v;
    renderList();
  }

  function openAdd() {
    getById('modal-title').textContent = 'เพิ่มแท็ก';
    getById('modal-sub').textContent = 'กรอก ID + ชื่อ + หมวดหมู่';
    getById('m-id-existing').value = '';
    getById('m-tag-id').value = '';
    getById('m-tag-id').disabled = false;
    getById('m-tag-name').value = '';
    getById('m-category').value = '';
    getById('m-description').value = '';
    getById('modal-bg').classList.add('active');
  }

  function openEdit(tagId) {
    const t = allTags.find(x => x.tag_id === tagId);
    if (!t || t.is_orphan) return;
    getById('modal-title').textContent = 'แก้ไข ' + t.tag_id;
    getById('modal-sub').textContent =
      'ใช้อยู่ ' + t.employee_count + ' พนักงาน · ' + t.announcement_count + ' ประกาศ';
    getById('m-id-existing').value = t.tag_id;
    getById('m-tag-id').value = t.tag_id;
    getById('m-tag-id').disabled = true;
    getById('m-tag-name').value = t.tag_name;
    getById('m-category').value = t.category;
    getById('m-description').value = t.description;
    getById('modal-bg').classList.add('active');
  }

  function closeModal() { getById('modal-bg').classList.remove('active'); }

  function saveTag() {
    const isEdit = !!getById('m-id-existing').value;
    const id = isEdit ? getById('m-id-existing').value
                      : (getById('m-tag-id').value || '').trim().toUpperCase();
    const payload = {
      tag_id: id,
      tag_name: getById('m-tag-name').value.trim(),
      category: getById('m-category').value.trim(),
      description: getById('m-description').value.trim(),
    };
    if (!payload.tag_id || !payload.tag_name) {
      showToast('กรอก ID + ชื่อแท็ก', 'error'); return;
    }
    getById('save-btn').disabled = true;

    if (isEdit) {
      google.script.run
        .withSuccessHandler(r => onSaveDone(r, 'แก้ไขแล้ว'))
        .withFailureHandler(onSaveErr)
        .tagAdminUpdate(id, payload);
    } else {
      google.script.run
        .withSuccessHandler(r => onSaveDone(r, 'เพิ่มแล้ว'))
        .withFailureHandler(onSaveErr)
        .tagAdminAdd(payload);
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

  function removeTag(id, name) {
    if (!confirm('ลบแท็ก "' + name + '" (' + id + ') ?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('ลบแล้ว', 'success'); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tagAdminRemove(id);
  }

  function adoptOrphan(tagName) {
    const cat = prompt('รับ tag "' + tagName + '" เข้าระบบ\nกรอกหมวดหมู่ (skill / cert / special / misc):', 'auto-adopted');
    if (cat === null) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('Adopted: ' + tagName + ' → ' + r.id, 'success');
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tagAdminAdoptOrphan(tagName, cat);
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList, renderList, tgSetUsage,
    openAdd, openEdit, closeModal, saveTag, removeTag, adoptOrphan,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadList();
}
