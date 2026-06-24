// _ported/reward.js — FULL native port of desktop reward_manager.html (HR Announcement admin · หน้า "รางวัล/ชมเชย")
// ลอกทั้งดุ้น: stats(4) + filters(status/type) + data-table(8 col) + grant modal (1) + revoke (prompt)
//   CSS เดิม (_shared_styles ที่ใช้ + <style> หน้า manager) prefix #rw ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ RW_RUN_PAGE_JS() · google.script.run = shim → RW_BACKEND (Supabase)
//
// ใช้ global sb (index.html module scope) — ห้าม redeclare · helper (esc/showToast) inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน RW_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=reward.updated → {items}) :
//   rewardsList(filter)         → derive items/stats client-side จาก payload ล่าสุดต่อ reward
//                                 (ตอนนี้ list ยังว่าง = 0 รางวัล → render ได้ ไม่ error · empty state สวย)
//   rewardsGetGrantContext()    → { employees, rewardTypes, kpiPeriods } derive จาก payload (อาจว่าง)
//   rewardsGrant / rewardsRevoke→ เขียนกลับ/ส่ง LINE ไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   RW_BACKEND — map google.script.run → Supabase edge fn hr_list (type=reward.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     rewardsGetGrantContext()  → { employees, rewardTypes, kpiPeriods }
     rewardsList(filter)       → { items, stats }
     rewardsGrant(input)       → { ok / error } stub + toast
     rewardsRevoke(id, reason) → { ok / error } stub + toast
   ============================================================ */
var RW_FN = 'hr_list';
var RW_TYPE = 'reward.updated';

function rw2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function rw2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function rw2Num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function rw2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// default reward types (จากหน้าเดิม · ถ้า payload ไม่มี master list บน dashboard ใช้ค่านี้ render filter/modal ได้)
var RW_DEFAULT_TYPES = [
  { key: 'day_off',  label: 'วันหยุดแถม',        unit: 'วัน', accent: '#3DC5B7', affects_leave_balance: true },
  { key: 'bonus',    label: 'โบนัส / เงินรางวัล', unit: 'บาท', accent: '#B45309', affects_leave_balance: false },
  { key: 'voucher',  label: 'Voucher / ของรางวัล', unit: '',  accent: '#4338CA', affects_leave_balance: false },
  { key: 'kudos',    label: 'ชมเชย / Kudos',     unit: '',     accent: '#166534', affects_leave_balance: false },
];

// map payload event ดิบ → reward row shape ที่ JS เดิมใช้ (render())
function rw2MapReward(p) {
  p = p || {};
  var status = String(p.status || (rw2Bool(p.revoked) ? 'revoked' : 'active')).toLowerCase();
  if (status !== 'revoked' && status !== 'active') status = 'active';
  var typeKey = p.reward_type || p.type || '';
  var typeDef = RW_DEFAULT_TYPES.find(function (t) { return t.key === typeKey; }) || {};
  return {
    reward_id: p.reward_id || p.entity_id || p.id || '',
    employee_id: p.employee_id || '',
    employee_name: p.employee_name || p.name || '—',
    reward_type: typeKey,
    reward_type_label: p.reward_type_label || typeDef.label || (typeKey || '—'),
    accent: p.accent || typeDef.accent || '#3DC5B7',
    unit: (p.unit != null && p.unit !== '') ? p.unit : (typeDef.unit || ''),
    title: p.title || '—',
    reason: p.reason || '',
    value: (p.value != null) ? p.value : '',
    kpi_period_id: p.kpi_period_id || '',
    granted_at: rw2Date(p.granted_at || p.created_at || p.posted_at),
    notified: rw2Bool(p.notified),
    status: status,
    _raw: p,
  };
}

// cache payload ดิบล่าสุดต่อ reward + derive context (backend ไม่มี endpoint แยก)
var _rw2Rows = [];
var _rw2Ctx = null;

function rw2FetchRows() {
  return sb.functions.invoke(RW_FN + '?type=' + encodeURIComponent(RW_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = rw2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.reward_id || p.entity_id || p.id || '';
      if (id && seen[id]) return;
      if (id) seen[id] = true;
      rows.push(rw2MapReward(p));
    });
    _rw2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[RW_BACKEND] list fetch failed', e);
    _rw2Rows = [];
    return [];
  });
}

var RW_BACKEND = {
  // grant context — { employees, rewardTypes, kpiPeriods } derive จาก rewards ที่มี (backend ไม่มี master list บน dashboard)
  rewardsGetGrantContext: function () {
    return rw2FetchRows().then(function (rows) {
      var eSeen = {}, employees = [];
      var kSeen = {}, kpiPeriods = [];
      rows.forEach(function (r) {
        if (r.employee_id && !eSeen[r.employee_id]) { eSeen[r.employee_id] = true; employees.push({ id: r.employee_id, name: r.employee_name || r.employee_id }); }
        if (r.kpi_period_id && !kSeen[r.kpi_period_id]) { kSeen[r.kpi_period_id] = true; kpiPeriods.push({ id: r.kpi_period_id, label: r.kpi_period_id }); }
      });
      _rw2Ctx = { employees: employees, rewardTypes: RW_DEFAULT_TYPES.slice(), kpiPeriods: kpiPeriods };
      return _rw2Ctx;
    });
  },

  // list — { items, stats }
  rewardsList: function (filter) {
    filter = filter || {};
    var apply = function (all) {
      var filtered = all.slice();
      if (filter.status) filtered = filtered.filter(function (r) { return r.status === filter.status; });
      if (filter.reward_type) filtered = filtered.filter(function (r) { return r.reward_type === filter.reward_type; });

      filtered.sort(function (a, b) { return (b.granted_at || '').localeCompare(a.granted_at || ''); });

      var dayOffDays = 0;
      all.forEach(function (r) {
        if (r.status === 'active' && r.reward_type === 'day_off') dayOffDays += rw2Num(r.value);
      });
      var stats = {
        total: all.length,
        active: all.filter(function (r) { return r.status === 'active'; }).length,
        revoked: all.filter(function (r) { return r.status === 'revoked'; }).length,
        day_off_days: dayOffDays,
      };
      return { items: filtered, stats: stats };
    };
    if (_rw2Rows.length) return Promise.resolve(apply(_rw2Rows));
    return rw2FetchRows().then(apply);
  },

  // ---- mutations: เขียนกลับ/ส่ง LINE ไม่ได้บน dashboard → stub + toast ----
  rewardsGrant: function () {
    rw2NotReady('ให้รางวัล + แจ้งพนักงานทาง LINE');
    return Promise.resolve({ error: 'ให้รางวัลยังไม่พร้อมบน dashboard (read-only)' });
  },
  rewardsRevoke: function () {
    rw2NotReady('เพิกถอนรางวัล');
    return Promise.resolve({ error: 'เพิกถอนยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _rw2NotReadyShown = {};
function rw2NotReady(feature) {
  if (_rw2NotReadyShown[feature]) return;
  _rw2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.rw2Toast) window.rw2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountReward — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountReward() {
  if (!document.getElementById('wrap-reward')) return;
  var wrap = document.getElementById('wrap-reward');
  wrap.innerHTML = '<style>' + RW_CSS() + '</style><div id="rw">' + RW_MARKUP() + '</div>';
  RW_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #rw =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว) */
function RW_CSS() {
  return [
    // tokens (มาจาก _shared_styles + :root หน้าเดิม)
    '#rw{--navy:#0D2F4F;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--success:#047857;color:var(--text);font-size:13px;line-height:1.5}',
    '#rw *{box-sizing:border-box}',
    // buttons (จาก _shared_styles)
    '#rw .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#rw .btn:hover{border-color:var(--navy)}',
    '#rw .btn svg{width:14px;height:14px}',
    '#rw .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#rw .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#rw .btn[disabled]{opacity:.5;cursor:not-allowed}',
    // page head (native บน dashboard · ไม่มี shell page-head เดิม)
    '#rw .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#rw .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#rw .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#rw .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#rw .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // stats
    '#rw .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}',
    '@media (max-width:700px){#rw .stats{grid-template-columns:repeat(2,1fr)}}',
    '#rw .stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;position:relative;overflow:hidden}',
    '#rw .stat-stripe{position:absolute;top:0;left:0;right:0;height:2px;background:var(--teal)}',
    '#rw .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}',
    '#rw .stat-value{font-size:26px;font-weight:600;color:var(--text);margin-top:4px;line-height:1}',
    '#rw .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#rw .filters{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:14px}',
    '#rw .filter{display:flex;flex-direction:column;gap:4px}',
    '#rw .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#rw .filter select{padding:7px 10px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;background:var(--surface);min-width:150px;color:var(--text)}',
    '#rw .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // data table
    '#rw .data-table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden;font-size:13px}',
    '#rw .data-table thead th{background:#F1F5F9;text-align:left;padding:10px 12px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;position:sticky;top:0}',
    '#rw .data-table tbody td{padding:10px 12px;border-top:1px solid #F1F5F9;vertical-align:top}',
    '#rw .data-table tbody tr:hover{background:#E6F7F5}',
    '#rw .num{text-align:right;font-variant-numeric:tabular-nums}',
    // pills / chips / misc
    '#rw .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;line-height:1.6}',
    '#rw .pill-active{background:#ECFDF5;color:#047857}',
    '#rw .pill-revoked{background:#FEF2F2;color:#B91C1C}',
    '#rw .type-chip{display:inline-flex;align-items:center;gap:6px;font-weight:500}',
    '#rw .type-dot{width:9px;height:9px;border-radius:3px;flex:none}',
    '#rw .link-btn{background:none;border:none;color:var(--danger);cursor:pointer;font-family:inherit;font-size:12px;padding:0}',
    '#rw .empty{text-align:center;color:var(--text-faint);padding:40px}',
    '#rw .field-hint{font-size:11px;color:var(--text-faint);margin-top:4px}',
    '#rw .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // modal (จาก _shared_styles)
    '#rw .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#rw .modal-bg.active{display:flex}',
    '#rw .modal{background:#fff;border-radius:12px;max-width:560px;width:92%;max-height:92vh;overflow-y:auto}',
    '#rw .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#rw .modal-header h2{font-size:16px;margin:0}',
    '#rw .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#rw .modal-body{padding:16px 20px}',
    '#rw .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    // field
    '#rw .field{margin-bottom:12px}',
    '#rw .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#rw .field input,#rw .field select,#rw .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#rw .field input:focus,#rw .field select:focus,#rw .field textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#rw .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media (max-width:600px){#rw .field-grid{grid-template-columns:1fr}}',
    // toast (จาก _shared_styles · scope rw)
    '#rw-toast{position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s;opacity:0;transform:translateY(100px)}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + stats + filters + content + grant modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function RW_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>',
    '      รางวัล / สิทธิพิเศษ',
    '    </h1>',
    '    <div class="subtitle">ให้รางวัลรายคน · KPI ถึง / กรณีพิเศษ · เด้งแจ้งพนักงานผ่าน LINE · "วันหยุดแถม" ใช้ลาได้จริง</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-primary" onclick="openGrant()">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    '      ให้รางวัล',
    '    </button>',
    '  </div>',
    '</header>',
    '<div class="stats" id="stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>สถานะ</label>',
    '    <select id="filter-status" onchange="loadList()">',
    '      <option value="active" selected>ใช้งานอยู่</option>',
    '      <option value="">ทั้งหมด</option>',
    '      <option value="revoked">เพิกถอนแล้ว</option>',
    '    </select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>ประเภทรางวัล</label>',
    '    <select id="filter-type" onchange="loadList()">',
    '      <option value="">ทั้งหมด</option>',
    '    </select>',
    '  </div>',
    '</div>',
    '<div id="content" class="loading">กำลังโหลด...</div>',
    // grant modal
    '<div class="modal-bg" id="grant-bg" onclick="if(event.target===this)closeGrant()">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <h2>ให้รางวัล / สิทธิพิเศษ</h2>',
    '      <p>เลือกพนักงาน + ประเภทรางวัล — ระบบจะเด้งแจ้งทาง LINE ให้อัตโนมัติ</p>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="field">',
    '        <label>พนักงาน *</label>',
    '        <select id="g-employee"></select>',
    '      </div>',
    '      <div class="field-grid">',
    '        <div class="field">',
    '          <label>ประเภทรางวัล *</label>',
    '          <select id="g-type" onchange="onTypeChange()"></select>',
    '        </div>',
    '        <div class="field">',
    '          <label id="g-value-label">มูลค่า / จำนวน</label>',
    '          <input type="text" id="g-value" placeholder="">',
    '          <div class="field-hint" id="g-value-hint"></div>',
    '        </div>',
    '      </div>',
    '      <div class="field">',
    '        <label>ชื่อรางวัล (โชว์ให้พนักงาน) *</label>',
    '        <input type="text" id="g-title" placeholder="เช่น วันหยุดพิเศษ · KPI ทะลุเป้า Q2">',
    '      </div>',
    '      <div class="field">',
    '        <label>เหตุผล / เกณฑ์</label>',
    '        <input type="text" id="g-reason" placeholder="เช่น ยอดบริการเกินเป้า 120% + รีวิว 5 ดาว">',
    '      </div>',
    '      <div class="field">',
    '        <label>ผูกรอบ KPI (ถ้ามี)</label>',
    '        <select id="g-kpi"><option value="">— ไม่ผูก —</option></select>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeGrant()">ยกเลิก</button>',
    '      <button class="btn btn-primary" id="g-save" onclick="saveGrant()">',
    '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    '        บันทึก + แจ้งพนักงาน',
    '      </button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   RW_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → RW_BACKEND
   helper (showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function RW_RUN_PAGE_JS() {

  // ---- google.script.run shim → RW_BACKEND (async, คืน shape เดิม) ----
  function _rw2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (RW_BACKEND[prop]) {
            Promise.resolve().then(function () { return RW_BACKEND[prop].apply(RW_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[RW_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[RW_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _rw2MakeChain(); } });

  // ---- helpers (inline · scope #rw) ----
  // ใช้ global window.esc ถ้ามี · ไม่งั้น fallback inline (ห้าม redeclare global)
  var _esc = (typeof window !== 'undefined' && typeof window.esc === 'function')
    ? window.esc
    : function (s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; };
  function escapeHtml(s) { return _esc(s); }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    var t = document.getElementById('rw-toast');
    if (!t) { t = document.createElement('div'); t.id = 'rw-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.rw2Toast = showToast;

  // ---- $ scope ใต้ #rw กันชน id ----
  var _rwRoot = document.getElementById('rw');
  function getById(id) { return _rwRoot ? _rwRoot.querySelector('#' + id) : document.getElementById(id); }

  /* ====================================================================
     ===== JS หน้าเดิม reward_manager.html (ลอกทั้งดุ้น) =====
     document.getElementById(...) → getById(...) (scope ใต้ #rw)
     ==================================================================== */
  var CTX = { employees: [], rewardTypes: [], kpiPeriods: [] };

  function init() {
    google.script.run
      .withSuccessHandler(function (ctx) {
        if (ctx && !ctx.error) {
          CTX = ctx;
          fillContext();
        }
        loadList();
      })
      .withFailureHandler(function (e) { showToast(String(e.message || e), 'error'); loadList(); })
      .rewardsGetGrantContext();
  }

  function fillContext() {
    var emp = getById('g-employee');
    emp.innerHTML = (CTX.employees || []).map(function (e) {
      return '<option value="' + escapeAttr(e.id) + '">' + escapeHtml(e.name) + '</option>';
    }).join('');

    var typeOpts = (CTX.rewardTypes || []).map(function (t) {
      return '<option value="' + escapeAttr(t.key) + '">' + escapeHtml(t.label) + '</option>';
    }).join('');
    getById('g-type').innerHTML = typeOpts;

    var ftype = getById('filter-type');
    ftype.innerHTML = '<option value="">ทั้งหมด</option>' + typeOpts;

    getById('g-kpi').innerHTML = '<option value="">— ไม่ผูก —</option>' +
      (CTX.kpiPeriods || []).map(function (p) {
        return '<option value="' + escapeAttr(p.id) + '">' + escapeHtml(p.label) + '</option>';
      }).join('');

    onTypeChange();
  }

  function currentType() {
    var key = getById('g-type').value;
    return (CTX.rewardTypes || []).find(function (t) { return t.key === key; }) || {};
  }

  function onTypeChange() {
    var t = currentType();
    var label = getById('g-value-label');
    var hint = getById('g-value-hint');
    var input = getById('g-value');
    if (t.affects_leave_balance) {
      label.textContent = 'จำนวนวัน *';
      input.placeholder = 'เช่น 1';
      hint.textContent = 'จะเพิ่มเข้าสิทธิ์ "วันหยุดแถม" ของพนักงาน · ลาได้จริง ไม่กินโควต้าปกติ';
    } else {
      label.textContent = 'มูลค่า / จำนวน' + (t.unit ? ' (' + t.unit + ')' : '');
      input.placeholder = t.unit === 'บาท' ? 'เช่น 2000' : 'เช่น Starbucks ฿500';
      hint.textContent = 'บันทึก + แจ้งพนักงาน (ไม่ผูกสิทธิ์ลา)';
    }
  }

  function openGrant() {
    getById('g-value').value = '';
    getById('g-title').value = '';
    getById('g-reason').value = '';
    getById('g-kpi').value = '';
    if (CTX.rewardTypes && CTX.rewardTypes.length) onTypeChange();
    getById('grant-bg').classList.add('active');
  }
  function closeGrant() { getById('grant-bg').classList.remove('active'); }

  function saveGrant() {
    var input = {
      employee_id: getById('g-employee').value,
      reward_type: getById('g-type').value,
      title: getById('g-title').value.trim(),
      value: getById('g-value').value.trim(),
      reason: getById('g-reason').value.trim(),
      kpi_period_id: getById('g-kpi').value
    };
    if (!input.employee_id) { showToast('เลือกพนักงานก่อน', 'error'); return; }
    if (!input.title) { showToast('กรอกชื่อรางวัล', 'error'); return; }
    var t = currentType();
    if (t.affects_leave_balance && !(Number(input.value) > 0)) {
      showToast('วันหยุดแถมต้องระบุจำนวนวัน > 0', 'error'); return;
    }
    var btn = getById('g-save');
    btn.disabled = true;
    showToast('กำลังบันทึก...', '');
    google.script.run
      .withSuccessHandler(function (r) {
        btn.disabled = false;
        if (r && r.error) { showToast(r.error, 'error'); return; }
        closeGrant();
        showToast('ให้รางวัลแล้ว · แจ้งพนักงานทาง LINE', 'success');
        loadList();
      })
      .withFailureHandler(function (e) { btn.disabled = false; showToast(String(e.message || e), 'error'); })
      .rewardsGrant(input);
  }

  function loadList() {
    var filter = {
      status: getById('filter-status').value,
      reward_type: getById('filter-type').value
    };
    getById('content').className = 'loading';
    getById('content').textContent = 'กำลังโหลด...';
    google.script.run
      .withSuccessHandler(render)
      .withFailureHandler(function (e) {
        getById('content').className = '';
        getById('content').innerHTML =
          '<div class="empty">โหลดไม่สำเร็จ: ' + escapeHtml(String(e.message || e)) + '</div>';
      })
      .rewardsList(filter);
  }

  function render(res) {
    if (!res || res.error) {
      getById('content').className = '';
      getById('content').innerHTML =
        '<div class="empty">' + escapeHtml((res && res.error) || 'error') + '</div>';
      return;
    }
    var s = res.stats || {};
    getById('stats').innerHTML = [
      statCard('ทั้งหมด', s.total || 0, ''),
      statCard('ใช้งานอยู่', s.active || 0, ''),
      statCard('วันหยุดแถม (รวม)', s.day_off_days || 0, 'วัน · active'),
      statCard('เพิกถอน', s.revoked || 0, '')
    ].join('');

    var items = res.items || [];
    if (!items.length) {
      getById('content').className = '';
      getById('content').innerHTML = '<div class="empty">ยังไม่มีรางวัลในเงื่อนไขนี้</div>';
      return;
    }
    var rows = items.map(function (i) {
      var valueText = (i.value !== '' && i.value !== null && i.value !== undefined)
        ? (escapeHtml(String(i.value)) + (i.unit ? ' ' + escapeHtml(i.unit) : '')) : '-';
      var statusPill = i.status === 'revoked'
        ? '<span class="pill pill-revoked">เพิกถอน</span>'
        : '<span class="pill pill-active">active</span>';
      var action = i.status === 'revoked' ? '' :
        '<button class="link-btn" onclick="revokeReward(\'' + escapeAttr(i.reward_id) + '\')">เพิกถอน</button>';
      return '<tr>' +
        '<td>' + escapeHtml(i.employee_name) + '<div class="stat-sub">' + escapeHtml(i.employee_id) + '</div></td>' +
        '<td><span class="type-chip"><span class="type-dot" style="background:' + escapeAttr(i.accent) + '"></span>' +
          escapeHtml(i.reward_type_label) + '</span></td>' +
        '<td>' + escapeHtml(i.title) + (i.reason ? '<div class="stat-sub">' + escapeHtml(i.reason) + '</div>' : '') + '</td>' +
        '<td class="num">' + valueText + '</td>' +
        '<td>' + (i.kpi_period_id ? escapeHtml(i.kpi_period_id) : '-') + '</td>' +
        '<td>' + escapeHtml(i.granted_at) + '<div class="stat-sub">' + (i.notified ? 'แจ้งแล้ว' : 'ยังไม่แจ้ง') + '</div></td>' +
        '<td>' + statusPill + '</td>' +
        '<td>' + action + '</td>' +
        '</tr>';
    }).join('');

    getById('content').className = '';
    getById('content').innerHTML =
      '<table class="data-table"><thead><tr>' +
        '<th>พนักงาน</th><th>ประเภท</th><th>รางวัล</th><th class="num">มูลค่า/จำนวน</th>' +
        '<th>KPI</th><th>ให้เมื่อ</th><th>สถานะ</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function statCard(label, value, sub) {
    return '<div class="stat"><div class="stat-stripe"></div>' +
      '<div class="stat-label">' + escapeHtml(label) + '</div>' +
      '<div class="stat-value">' + escapeHtml(String(value)) + '</div>' +
      (sub ? '<div class="stat-sub">' + escapeHtml(sub) + '</div>' : '') + '</div>';
  }

  function revokeReward(id) {
    var reason = prompt('เหตุผลในการเพิกถอนรางวัลนี้ (ถ้าเป็นวันหยุดแถม ระบบจะคืนสิทธิ์ออก):', '');
    if (reason === null) return;
    google.script.run
      .withSuccessHandler(function (r) {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('เพิกถอนแล้ว', 'success');
        loadList();
      })
      .withFailureHandler(function (e) { showToast(String(e.message || e), 'error'); })
      .rewardsRevoke(id, reason);
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  var _exp = {
    openGrant: openGrant, closeGrant: closeGrant, saveGrant: saveGrant,
    onTypeChange: onTypeChange, loadList: loadList, revokeReward: revokeReward,
  };
  Object.keys(_exp).forEach(function (k) { window[k] = _exp[k]; });

  /* ===== Init ===== */
  init();
}

if (typeof window !== 'undefined') window.mountReward = mountReward;
