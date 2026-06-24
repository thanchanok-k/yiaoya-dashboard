// _ported/probcriteria.js — FULL native port of desktop probation_criteria_manager.html (HR Announcement admin · "เกณฑ์ทดลองงาน")
// ลอกทั้งดุ้น: stats(4) + position groups (criteria per ตำแหน่ง · ALL=default fallback) + modal add/edit + help
//   CSS เดิม (_shared_styles ที่ใช้ + <style> หน้า manager) prefix #pc ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ PC_RUN_PAGE_JS() · google.script.run = shim → PC_BACKEND (Supabase)
//
// ใช้ global window.sb/window.esc/window.$ — ห้าม redeclare · helper (esc/$/ICONS/showToast/showHelp) inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window (prefix กันชน) ภายใน PC_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=probation_criteria.updated → {items}) :
//   list   → derive groups/stats/positions client-side จาก payload ล่าสุดต่อ criterion
//            (ตอนนี้ list อาจว่าง = 0 criterion → render empty state ได้ ไม่ error)
//   whoami → admin เต็มสิทธิ์ (dashboard user)
//   add/update/remove/seedDefaults → เขียนกลับไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   PC_BACKEND — map google.script.run → Supabase edge fn hr_list (type=probation_criteria.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     critAdminList()        → { stats, groups, availablePositions }
     critAdminAdd/Update/Remove/SeedDefaults → { ok / error } stub + toast
   ============================================================ */
var PC_FN = 'hr_list';
var PC_TYPE = 'probation_criteria.updated';

function pc2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function pc2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function pc2Bool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  if (s === '') return true; // default active เมื่อไม่ระบุ
  return s === 'true' || s === 'yes' || s === '1' || s === 'y' || s === 'active';
}

// map payload event ดิบ → criterion row shape ที่ JS เดิมใช้
function pc2MapCrit(p) {
  p = p || {};
  var posId = String(p.position_id || p.position || 'ALL') || 'ALL';
  return {
    criteria_id: p.criteria_id || p.criterion_id || p.entity_id || p.id || '',
    position_id: posId,
    position_name: p.position_name || p.position_label || '',
    criterion_key: p.criterion_key || p.key || '',
    criterion_name: p.criterion_name || p.name || p.label || '',
    description: p.description || p.desc || p.hint || '',
    weight: (p.weight != null) ? pc2Num(p.weight) : 0,
    order_no: (p.order_no != null) ? pc2Num(p.order_no) : (p.order != null ? pc2Num(p.order) : 999),
    active: (p.active != null) ? pc2Bool(p.active) : pc2Bool(p.is_active),
    _raw: p,
  };
}

// cache row ที่ derive ล่าสุด (ให้ openEdit reuse — เหมือน allData หน้าเดิม)
var _pc2Crits = [];

function pc2FetchCrits() {
  return window.sb.functions.invoke(PC_FN + '?type=' + encodeURIComponent(PC_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = pc2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.criteria_id || p.criterion_id || p.entity_id || p.id || '';
      // เก็บล่าสุดต่อ id (payload เรียงเก่า→ใหม่ — ตัวหลังทับตัวก่อน)
      if (id && seen[id] != null) { rows[seen[id]] = pc2MapCrit(p); return; }
      if (id) seen[id] = rows.length;
      rows.push(pc2MapCrit(p));
    });
    _pc2Crits = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[PC_BACKEND] list fetch failed', e);
    _pc2Crits = [];
    return [];
  });
}

// สร้าง groups (per position · ALL=default) + stats จาก rows
function pc2BuildPayload(rows) {
  var byPos = {};
  rows.forEach(function (c) {
    var pid = c.position_id || 'ALL';
    if (!byPos[pid]) byPos[pid] = [];
    byPos[pid].push(c);
  });

  // ให้ ALL group มาก่อน (default) แม้ไม่มี criterion
  if (!byPos.ALL) byPos.ALL = [];

  var posIds = Object.keys(byPos).sort(function (a, b) {
    if (a === 'ALL') return -1;
    if (b === 'ALL') return 1;
    return a.localeCompare(b);
  });

  var groups = posIds.map(function (pid) {
    var items = byPos[pid].slice().sort(function (a, b) {
      if (a.order_no !== b.order_no) return a.order_no - b.order_no;
      return (a.criterion_name || '').localeCompare(b.criterion_name || '');
    });
    var posName = '';
    items.some(function (c) { if (c.position_name) { posName = c.position_name; return true; } return false; });
    var isDefault = (pid === 'ALL');
    if (!posName) posName = isDefault ? 'ALL — Default (ทุกตำแหน่ง)' : pid;
    var weightTotal = items.reduce(function (s, c) { return s + (c.active ? pc2Num(c.weight) : 0); }, 0);
    return {
      position_id: pid,
      position_name: posName,
      is_default: isDefault,
      weight_total: weightTotal,
      items: items,
    };
  });

  // availablePositions = positions ที่มี config แล้ว (ยกเว้น ALL) — backend ไม่มี master list บน dashboard
  var availablePositions = groups
    .filter(function (g) { return !g.is_default; })
    .map(function (g) { return { id: g.position_id, name: g.position_name }; });

  var posWithConfig = groups.filter(function (g) { return !g.is_default && g.items.length > 0; }).length;
  var allPositions = Math.max(posWithConfig, availablePositions.length);
  var weightIssues = groups.filter(function (g) {
    return g.items.length > 0 && g.weight_total !== 100;
  }).length;

  var stats = {
    total_criteria: rows.length,
    positions_with_config: posWithConfig,
    all_positions: allPositions,
    weight_issues: weightIssues,
  };

  return { stats: stats, groups: groups, availablePositions: availablePositions };
}

var PC_BACKEND = {
  // role gate — dashboard user = admin เต็มสิทธิ์
  critAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },

  // list — { stats, groups, availablePositions }
  critAdminList: function () {
    return pc2FetchCrits().then(function (rows) {
      return pc2BuildPayload(rows);
    });
  },

  // ---- mutations: เขียนกลับไม่ได้บน dashboard → stub + toast ----
  critAdminAdd: function () {
    pc2NotReady('เพิ่ม criterion');
    return Promise.resolve({ error: 'เพิ่ม criterion ยังไม่พร้อมบน dashboard (read-only)' });
  },
  critAdminUpdate: function () {
    pc2NotReady('แก้ไข criterion');
    return Promise.resolve({ error: 'แก้ไข criterion ยังไม่พร้อมบน dashboard (read-only)' });
  },
  critAdminRemove: function () {
    pc2NotReady('ลบ criterion');
    return Promise.resolve({ error: 'ลบ criterion ยังไม่พร้อมบน dashboard (read-only)' });
  },
  critAdminSeedDefaults: function () {
    pc2NotReady('Seed defaults');
    return Promise.resolve({ error: 'Seed defaults ยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _pc2NotReadyShown = {};
function pc2NotReady(feature) {
  if (_pc2NotReadyShown[feature]) return;
  _pc2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.pc2Toast) window.pc2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountProbcriteria — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountProbcriteria() {
  if (!document.getElementById('wrap-probcriteria')) return;
  var wrap = document.getElementById('wrap-probcriteria');
  wrap.innerHTML = '<style>' + PC_CSS() + '</style><div id="pc">' + PC_MARKUP() + '</div>';
  PC_RUN_PAGE_JS();
}
window.mountProbcriteria = mountProbcriteria;

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #pc =====
   ตัด .app-shell/sidebar/main-area/topbar shell ออก (dashboard มี shell แล้ว) */
function PC_CSS() {
  return [
    // tokens (มาจาก _shared_styles)
    '#pc{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#pc *{box-sizing:border-box}',
    // buttons (จาก _shared_styles)
    '#pc .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#pc .btn:hover{border-color:var(--navy)}',
    '#pc .btn svg{width:14px;height:14px}',
    '#pc .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#pc .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#pc .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#pc .btn-sm{padding:5px 10px;font-size:12px}',
    '#pc .btn-icon{padding:5px;width:30px;height:30px;justify-content:center}',
    '#pc .btn-icon-danger{color:var(--danger)}',
    '#pc .btn-icon-danger:hover{border-color:var(--danger);background:#FEF2F2}',
    '#pc .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:8px;background:#fff;color:var(--text-muted);cursor:pointer}',
    '#pc .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#pc .btn-help svg{width:14px;height:14px}',
    // page head (native บน dashboard)
    '#pc .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#pc .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#pc .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#pc .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#pc .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;align-items:center}',
    // stat cards (จาก _shared_styles · .stats/.stat)
    '#pc .stats{display:grid;gap:10px;margin-bottom:14px}',
    '#pc .stats.cols-4{grid-template-columns:repeat(4,1fr)}',
    '@media (max-width:900px){#pc .stats.cols-4{grid-template-columns:repeat(2,1fr)}}',
    '@media (max-width:520px){#pc .stats.cols-4{grid-template-columns:1fr}}',
    '#pc .stat{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#pc .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px}',
    '#pc .stat-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#pc .stat-value{font-size:22px;font-weight:600;line-height:1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#pc .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // loading / empty
    '#pc .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    '#pc .empty{text-align:center;padding:50px 20px;color:var(--text-muted)}',
    '#pc .empty-icon{width:48px;height:48px;margin:0 auto 12px;color:var(--text-faint)}',
    '#pc .empty-icon svg{width:48px;height:48px}',
    '#pc .empty-title{font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px}',
    '#pc .empty-sub{font-size:12px;color:var(--text-muted);line-height:1.5;max-width:420px;margin:0 auto}',
    // ===== <style> manager เดิม · pos-group / crit-row =====
    '#pc .pos-group{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.03)}',
    '#pc .pos-group.is-default{border-color:var(--info)}',
    '#pc .pos-group-header{padding:12px 18px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;justify-content:space-between}',
    '#pc .pos-group.is-default .pos-group-header{background:var(--info-bg)}',
    '#pc .pos-group-title{font-size:14px;font-weight:600;color:var(--text)}',
    '#pc .pos-group-sub{font-size:11px;color:var(--text-muted);margin-top:2px}',
    '#pc .weight-total{padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;font-family:monospace}',
    '#pc .weight-ok{background:var(--success-bg);color:var(--success)}',
    '#pc .weight-warn{background:var(--warning-bg);color:var(--warning)}',
    '#pc .crit-row{display:grid;grid-template-columns:30px 1fr 1fr 90px 90px;gap:12px;align-items:center;padding:10px 18px;border-bottom:1px solid #F1F5F9}',
    '#pc .crit-row:last-child{border-bottom:none}',
    '#pc .crit-row:hover{background:#FAFBFC}',
    '#pc .crit-row.inactive{opacity:.5}',
    '#pc .crit-order{width:24px;height:24px;border-radius:50%;background:#F1F5F9;color:var(--text-muted);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;font-family:monospace}',
    '#pc .crit-info .name{font-weight:500;font-size:13px}',
    '#pc .crit-info .key{font-family:monospace;font-size:10px;color:var(--text-faint);margin-top:2px}',
    '#pc .crit-desc{font-size:11px;color:var(--text-muted)}',
    '#pc .crit-weight{padding:4px 10px;border-radius:6px;background:var(--info-bg);color:var(--info);font-size:13px;font-weight:600;font-family:monospace;text-align:center}',
    '#pc .crit-actions{display:flex;gap:4px;justify-content:flex-end}',
    '#pc .pos-group-empty{padding:20px;text-align:center;color:var(--text-muted);font-size:12px}',
  ].join('\n') + PC_CSS2();
}

/* CSS part 2 — modal / field */
function PC_CSS2() {
  return '\n' + [
    '#pc .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#pc .modal-bg.active{display:flex}',
    '#pc .modal{background:#fff;border-radius:12px;max-width:600px;width:92%;max-height:92vh;overflow-y:auto}',
    '#pc .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#pc .modal-header h2{font-size:16px;margin:0}',
    '#pc .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#pc .modal-body{padding:16px 20px}',
    '#pc .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
    '#pc .field{margin-bottom:12px}',
    '#pc .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#pc .field input,#pc .field select,#pc .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#pc .field input:focus,#pc .field select:focus,#pc .field textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#pc .field textarea{min-height:64px;resize:vertical}',
    '#pc .field-help{font-size:10px;color:var(--text-faint);margin-top:3px}',
    '#pc .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media (max-width:520px){#pc .field-grid{grid-template-columns:1fr}}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + stats + content + modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell/topbar ออก
   (topbar เดิมถูก JS เดิมย้าย action เข้า page-head อยู่แล้ว → port วาง action ใน page-head ตรง ๆ) */
function PC_MARKUP() {
  return [
    // header (native)
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
    '      Probation Criteria',
    '    </h1>',
    '    <div class="subtitle">33a · เกณฑ์ทดลองงานแยกตำแหน่ง · weight + threshold + auto-question</div>',
    '  </div>',
    '  <div class="page-actions" id="yh-page-actions">',
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn"></button>',
    '    <button class="btn btn-sm" onclick="loadList()" id="refresh-btn"></button>',
    '    <button class="btn btn-sm" onclick="seedDefaults()">Seed defaults</button>',
    '    <button class="btn btn-primary" onclick="openAdd()" id="add-btn"></button>',
    '  </div>',
    '</header>',
    // stats
    '<div class="stats cols-4" id="stats"></div>',
    // content
    '<div id="content" class="loading">กำลังโหลด...</div>',
    // Modal
    '<div class="modal-bg" id="modal-bg" onclick="if(event.target===this)closeModal()">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2 id="modal-title">เพิ่ม Criterion</h2>',
    '      <p id="modal-sub">เลือก position + กรอก criterion + weight</p>',
    '    </div>',
    '    <div class="modal-body">',
    '      <input type="hidden" id="m-id-existing">',
    '      <div class="field-grid">',
    '        <div class="field">',
    '          <label>Position</label>',
    '          <select id="m-position">',
    '            <option value="ALL">ALL — Default (ทุกตำแหน่ง)</option>',
    '          </select>',
    '        </div>',
    '        <div class="field">',
    '          <label>Weight (%)</label>',
    '          <input type="number" id="m-weight" min="0" max="100" value="25">',
    '          <div class="field-help">รวมทุก criterion per position ควร = 100%</div>',
    '        </div>',
    '      </div>',
    '      <div class="field">',
    '        <label>Criterion key (snake_case) *</label>',
    '        <input type="text" id="m-key" placeholder="clinical_skill" style="font-family:monospace">',
    '        <div class="field-help">key ที่เก็บใน scores_json — ห้ามมีช่องว่างหรือไทย</div>',
    '      </div>',
    '      <div class="field">',
    '        <label>Criterion name (label) *</label>',
    '        <input type="text" id="m-name" placeholder="Clinical Skill">',
    '      </div>',
    '      <div class="field">',
    '        <label>คำอธิบาย</label>',
    '        <textarea id="m-description" placeholder="hint ที่แสดงให้ reviewer ดู"></textarea>',
    '      </div>',
    '      <div class="field" style="display:flex;align-items:center;gap:8px">',
    '        <input type="checkbox" id="m-active" checked style="width:16px;height:16px;accent-color:var(--navy)">',
    '        <label for="m-active" style="margin-bottom:0;cursor:pointer">Active (ใช้งาน)</label>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeModal()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveCrit()" id="save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   PC_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → PC_BACKEND
   helper (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function PC_RUN_PAGE_JS() {

  // ---- google.script.run shim → PC_BACKEND (async, คืน shape เดิม) ----
  function _pc2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (PC_BACKEND[prop]) {
            Promise.resolve().then(function () { return PC_BACKEND[prop].apply(PC_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[PC_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[PC_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _pc2MakeChain(); } });

  // ---- helpers (inline · prefix pc ใน id เพื่อกันชน) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('pc2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pc2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.pc2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('pc-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'pc-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'pc-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'pc-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม probation_criteria_manager.html (ลอกทั้งดุ้น) =====
     ใช้ $ scope ใต้ #pc กันชน id (helper)
     ==================================================================== */
  const _pcRoot = document.getElementById('pc');
  function $id(id) { return _pcRoot ? _pcRoot.querySelector('#' + id) : document.getElementById(id); }
  // alias เพื่อให้โค้ดเดิม document.getElementById(...) ยังทำงาน → ใช้ getById ใน scope
  function getById(id) { return $id(id); }

  let allData = null;

  const HELP = {
    title: 'Probation Criteria — เกณฑ์รีวิวต่อตำแหน่ง',
    subtitle: 'Sheet: 33a_Probation_Criteria',
    intro: 'ตั้งหัวข้อรีวิวสำหรับพนักงานทดลองงานแยกตามตำแหน่ง — แต่ละตำแหน่งประเมินไม่เหมือนกัน เช่น หมอประเมิน "ทักษะคลินิก" แต่ admin ประเมิน "การจัดการเอกสาร"',
    sections: [
      {
        title: 'การใช้งาน',
        items: [
          'เลือกตำแหน่ง → เพิ่มหัวข้อรีวิว (label, weight, type)',
          'จัดลำดับ + ตั้ง weight (รวมแล้วควร = 100)',
          'Seed defaults — สร้างเกณฑ์มาตรฐาน 4 ข้อให้ตำแหน่งที่ยังไม่มี',
        ],
      },
      {
        title: 'Type',
        items: [
          'score_1_5 — คะแนน 1-5 (default)',
          'score_1_10 — คะแนน 1-10 ละเอียดกว่า',
          'pass_fail — ผ่าน/ไม่ผ่าน เท่านั้น',
          'comment — กรอก text เท่านั้น (ไม่คิดคะแนน)',
        ],
      },
      {
        type: 'warn',
        title: 'ระวัง',
        items: [
          'ตำแหน่งที่ไม่มี criteria — Probation Manager จะ fallback ใช้เกณฑ์มาตรฐาน 4 ข้อ',
          'แก้ criterion ระหว่างรอบรีวิว → รีวิวเก่ายังเก็บ schema เก่า, รีวิวใหม่ใช้ schema ใหม่',
          'weight รวมไม่ครบ 100 — ระบบจะ normalize ให้อัตโนมัติแต่ผลรวมอาจคลาดเคลื่อน',
          'หมายเหตุ: บน dashboard นี้เป็น read-only — การเพิ่ม/แก้/ลบ/seed ยังไม่พร้อม',
        ],
      },
    ],
  };

  // ===== header / button labels =====
  getById('refresh-btn').innerHTML = ICONS.refresh;
  getById('add-btn').innerHTML = ICONS.plus + ' เพิ่ม Criterion';
  getById('save-btn').innerHTML = ICONS.save + ' บันทึก';
  getById('help-btn').innerHTML = ICONS.help;

  function loadList() {
    getById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(d => {
        allData = d;
        populatePositions(d);
        renderStats(d.stats || {});
        renderGroups(d.groups || []);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .critAdminList();
  }

  function populatePositions(d) {
    const sel = getById('m-position');
    if (sel.children.length > 1) return;
    // Position-specific groups already used + available positions
    d.groups.filter(g => !g.is_default).forEach(g => {
      sel.innerHTML += `<option value="${escapeAttr(g.position_id)}">${escapeHtml(g.position_name)}</option>`;
    });
    (d.availablePositions || []).forEach(p => {
      sel.innerHTML += `<option value="${escapeAttr(p.id)}">${escapeHtml(p.id)} — ${escapeHtml(p.name)}</option>`;
    });
  }

  function renderStats(s) {
    getById('stats').innerHTML = [
      statCard('รวม criteria', s.total_criteria, 'ทุกตำแหน่ง', 'var(--navy)'),
      statCard('Position config', (s.positions_with_config || 0) + '/' + (s.all_positions || 0), 'ตั้งเฉพาะ', 'var(--success)'),
      statCard('Default (ALL)', '1', 'fallback ใช้กับที่เหลือ', 'var(--info)'),
      statCard('Weight ผิดพลาด', s.weight_issues, 'ไม่รวม 100%', s.weight_issues > 0 ? 'var(--warning)' : 'var(--text-faint)'),
    ].join('');
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  function renderGroups(groups) {
    if (!groups || groups.length === 0) {
      getById('content').innerHTML = [
        '<div class="empty">',
          '<div class="empty-icon">' + ICONS.shield + '</div>',
          '<div class="empty-title">ยังไม่มี criteria</div>',
          '<div class="empty-sub">กด "Seed defaults" เพื่อสร้างตัวอย่าง 16 criteria สำหรับ ALL + POS06 + POS01 + POS04</div>',
        '</div>',
      ].join('');
      return;
    }

    getById('content').innerHTML = groups.map(g => {
      const wClass = g.weight_total === 100 ? 'weight-ok' :
        (g.items.length === 0 ? 'weight-ok' : 'weight-warn');
      const wText = g.items.length === 0 ? '— empty —' :
        'รวม ' + g.weight_total + '%';

      const items = g.items.length === 0
        ? '<div class="pos-group-empty">ยังไม่มี criterion ในกลุ่มนี้</div>'
        : g.items.map((c, idx) => {
            const inactive = !c.active ? 'inactive' : '';
            return [
              '<div class="crit-row ' + inactive + '">',
                '<div class="crit-order">' + (idx + 1) + '</div>',
                '<div class="crit-info">',
                  '<div class="name">' + escapeHtml(c.criterion_name) + '</div>',
                  '<div class="key">' + escapeHtml(c.criterion_key) + '</div>',
                '</div>',
                '<div class="crit-desc">' + escapeHtml(c.description || '—') + '</div>',
                '<div class="crit-weight">' + c.weight + '%</div>',
                '<div class="crit-actions">',
                  '<button class="btn btn-icon" onclick="openEdit(\'' + escapeAttr(c.criteria_id) + '\')" title="แก้">' + ICONS.edit + '</button>',
                  '<button class="btn btn-icon btn-icon-danger" onclick="removeCrit(\'' + escapeAttr(c.criteria_id) + '\', \'' + escapeAttr(c.criterion_name) + '\')" title="ลบ">' + ICONS.trash + '</button>',
                '</div>',
              '</div>',
            ].join('');
          }).join('');

      return [
        '<div class="pos-group ' + (g.is_default ? 'is-default' : '') + '">',
          '<div class="pos-group-header">',
            '<div>',
              '<div class="pos-group-title">' + escapeHtml(g.position_name) + '</div>',
              '<div class="pos-group-sub">' + g.items.length + ' criteria · ' +
                (g.is_default ? 'ใช้กับตำแหน่งที่ไม่มี config เฉพาะ' : 'config เฉพาะตำแหน่งนี้') + '</div>',
            '</div>',
            '<span class="weight-total ' + wClass + '">' + wText + '</span>',
          '</div>',
          items,
        '</div>',
      ].join('');
    }).join('');
  }

  function openAdd() {
    getById('modal-title').textContent = 'เพิ่ม Criterion';
    getById('modal-sub').textContent = 'เลือก position + กรอก criterion + weight';
    getById('m-id-existing').value = '';
    getById('m-position').value = 'ALL';
    getById('m-key').value = '';
    getById('m-name').value = '';
    getById('m-description').value = '';
    getById('m-weight').value = 25;
    getById('m-active').checked = true;
    getById('modal-bg').classList.add('active');
  }

  function openEdit(critId) {
    // Find in allData
    let found = null;
    if (allData) {
      allData.groups.forEach(g => {
        const c = g.items.find(x => x.criteria_id === critId);
        if (c) { found = c; }
      });
    }
    if (!found) { showToast('ไม่พบ', 'error'); return; }

    getById('modal-title').textContent = 'แก้ไข ' + found.criterion_name;
    getById('modal-sub').textContent = 'position: ' + found.position_id;
    getById('m-id-existing').value = found.criteria_id;
    getById('m-position').value = found.position_id;
    getById('m-key').value = found.criterion_key;
    getById('m-name').value = found.criterion_name;
    getById('m-description').value = found.description;
    getById('m-weight').value = found.weight;
    getById('m-active').checked = found.active;
    getById('modal-bg').classList.add('active');
  }

  function closeModal() { getById('modal-bg').classList.remove('active'); }

  function saveCrit() {
    const isEdit = !!getById('m-id-existing').value;
    const id = getById('m-id-existing').value;
    const payload = {
      position_id: getById('m-position').value,
      criterion_key: getById('m-key').value.trim(),
      criterion_name: getById('m-name').value.trim(),
      description: getById('m-description').value.trim(),
      weight: Number(getById('m-weight').value || 0),
      active: getById('m-active').checked,
    };
    if (!payload.criterion_key || !payload.criterion_name) {
      showToast('กรอก key + name', 'error'); return;
    }
    getById('save-btn').disabled = true;

    if (isEdit) {
      google.script.run
        .withSuccessHandler(r => onSaveDone(r, 'แก้ไขแล้ว'))
        .withFailureHandler(onSaveErr)
        .critAdminUpdate(id, payload);
    } else {
      google.script.run
        .withSuccessHandler(r => onSaveDone(r, 'เพิ่มแล้ว'))
        .withFailureHandler(onSaveErr)
        .critAdminAdd(payload);
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

  function removeCrit(id, name) {
    if (!confirm('ลบ "' + name + '"?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('ลบแล้ว', 'success'); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .critAdminRemove(id);
  }

  function seedDefaults() {
    if (!confirm('Seed defaults — สร้าง 16 criteria สำหรับ ALL + POS06 (Doctor) + POS01 (Front Office) + POS04 (Nurse)?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('Seed: ' + r.added + ' criteria', 'success');
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .critAdminSeedDefaults();
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList,
    openAdd, openEdit, closeModal, saveCrit, removeCrit, seedDefaults,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadList();
}
