// _ported/insurance.js — FULL native port of desktop insurance_manager.html (HR Announcement admin)
// ลอกทั้งดุ้น: page-head + alert + actions + ตาราง policy/fund (6 col) + create modal (record_type/policy/...)
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix #ins ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ INS_RUN_PAGE_JS() · google.script.run = shim → INS_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare · prefix ins/INS_/ins2
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน INS_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=insurance.updated → {items}) :
//   insuranceManagerList → map payload → 6 col rows (Type/Policy/Insurer/Premium/Expires/Status)
//                          (list อาจว่าง = 0 row → render empty state สวย ไม่ error)
//   insuranceCreate      → เขียนกลับไม่ได้บน dashboard → stub + toast แจ้งยังไม่พร้อม
//   whoami               → {ok:true, is_owner:true} (dashboard user = admin เต็มสิทธิ์)

/* ============================================================
   INS_BACKEND — map google.script.run → Supabase edge fn hr_list (type=insurance.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (onLoaded → res.rows[] · render → Object.values().slice(0,6))
   ============================================================ */
var INS_FN = 'hr_list';
var INS_TYPE = 'insurance.updated';

function ins2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function ins2Num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function ins2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

var INS_RECORD_LABELS = {
  professional_insurance: 'ประกันวิชาชีพ',
  malpractice: 'ประกันความผิดพลาด',
  group_health: 'ประกันกลุ่ม',
  welfare_fund: 'กองทุนสงเคราะห์',
};
function ins2RecordLabel(t) { return INS_RECORD_LABELS[String(t || '')] || (t || '—'); }

function ins2Status(p) {
  if (p.status) return String(p.status);
  var exp = p.expiry_date ? new Date(p.expiry_date) : null;
  if (exp && !isNaN(exp.getTime())) {
    var now = new Date(); now.setHours(0, 0, 0, 0);
    var days = Math.floor((exp - now) / 86400000);
    if (days < 0) return 'expired';
    if (days <= 30) return 'expiring';
    return 'active';
  }
  return 'active';
}

function ins2Premium(p) {
  var amt = ins2Num(p.premium_amount);
  if (!amt) return '—';
  var freq = String(p.premium_frequency || '');
  var fl = freq === 'monthly' ? '/เดือน' : freq === 'quarterly' ? '/ไตรมาส' : freq === 'annual' ? '/ปี' : '';
  return '฿' + amt.toLocaleString() + fl;
}

// map payload event ดิบ → row shape ที่ JS เดิมใช้ (6 col ตามลำดับ COLUMNS)
//   COLUMNS = ["Type","Policy","Insurer","Premium","Expires","Status"]
//   render เดิมใช้ Object.values(r).slice(0, COLUMNS.length) → ลำดับ key สำคัญ
function ins2MapRow(p) {
  p = p || {};
  return {
    Type: ins2RecordLabel(p.record_type),
    Policy: p.policy_number || '—',
    Insurer: p.insurer_name || '—',
    Premium: ins2Premium(p),
    Expires: ins2Date(p.expiry_date) || '—',
    Status: ins2Status(p),
  };
}

var INS_BACKEND = {
  // role gate — dashboard user = admin เต็มสิทธิ์
  insuranceManagerWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },

  // list — { rows:[...] } (JS เดิมรับ res.rows || res.records || res.items)
  insuranceManagerList: function () {
    return sb.functions.invoke(INS_FN + '?type=' + encodeURIComponent(INS_TYPE)).then(function (res) {
      var data = (res && res.data) || {};
      var items = ins2ToArr(data.items);
      // dedupe ต่อ policy/entity (เก็บ payload ล่าสุด)
      var seen = {}; var rows = [];
      items.forEach(function (p) {
        var id = p.entity_id || p.policy_number || p.record_id || '';
        if (id) { if (seen[id]) return; seen[id] = true; }
        rows.push(ins2MapRow(p));
      });
      return { rows: rows };
    }).catch(function (e) {
      console.warn('[INS_BACKEND] list fetch failed', e);
      return { rows: [] };
    });
  },

  // create — เขียนกลับไม่ได้บน dashboard → stub + toast
  insuranceCreate: function () {
    ins2NotReady('เพิ่ม policy / fund');
    return Promise.resolve({ ok: false, error: 'เพิ่ม policy ยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _ins2NotReadyShown = {};
function ins2NotReady(feature) {
  if (_ins2NotReadyShown[feature]) return;
  _ins2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ins2Toast) window.ins2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountInsurance — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountInsurance() {
  var wrap = document.getElementById('wrap-insurance');
  if (!wrap) return;
  wrap.innerHTML = '<style>' + INS_CSS() + '</style><div id="ins">' + INS_MARKUP() + '</div>';
  INS_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles base + <style> manager) · prefix ทุก selector ด้วย #ins =====
   ตัด app-shell/topbar/sidebar/main shell ออก (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด */
function INS_CSS() {
  return [
    // tokens (scope #ins)
    '#ins{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--teal-light:#E6F7F5;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--muted:#6B7280;--danger:#B91C1C;--danger-bg:#FEF2F2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:14px;line-height:1.5}',
    '#ins *,#ins *::before,#ins *::after{box-sizing:border-box}',

    // page-head (dashboard shell แล้ว · คง class เดิม)
    '#ins .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#ins .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ins .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#ins .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ins .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center;flex-wrap:wrap}',

    // top banner (จากหน้าเดิม .top)
    '#ins .top{background:var(--navy);color:#fff;padding:18px 20px;position:relative;overflow:hidden;border-radius:10px;margin-bottom:14px}',
    '#ins .top::after{content:"";position:absolute;top:-30px;right:-30px;width:90px;height:90px;border-radius:50%;background:var(--teal);opacity:.18}',
    '#ins .top>*{position:relative;z-index:1}',
    '#ins .top-eyebrow{font-size:11px;color:rgba(255,255,255,.7);letter-spacing:1.5px}',
    '#ins .top-title{font-size:18px;font-weight:500;margin-top:2px}',
    '#ins .top-sub{font-size:11px;color:rgba(255,255,255,.7);margin-top:6px}',

    // alert + actions
    '#ins .alert{padding:11px 14px;border-radius:8px;margin-bottom:14px;font-size:12px;background:#FEF3C7;color:#B45309;border-left:3px solid #F59E0B}',
    '#ins .actions{display:flex;gap:10px;margin-bottom:14px}',

    // buttons
    '#ins .btn{padding:9px 14px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:#fff;color:var(--navy);display:inline-flex;align-items:center;gap:6px;line-height:1.4}',
    '#ins .btn:hover{border-color:var(--navy)}',
    '#ins .btn svg{width:13px;height:13px}',
    '#ins .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#ins .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#ins .btn-sm{padding:7px 12px;font-size:12px}',
    '#ins .btn[disabled]{opacity:.5;cursor:not-allowed}',

    // table
    '#ins table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)}',
    '#ins th{background:var(--bg);padding:10px 12px;font-size:10px;font-weight:600;text-align:left;letter-spacing:.5px;color:var(--muted);text-transform:uppercase}',
    '#ins td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border)}',
    '#ins tr:hover td{background:var(--teal-light);cursor:pointer}',
    '#ins .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    '#ins .loading{padding:40px 20px;text-align:center;color:var(--muted)}',

    // modal
    '#ins .modal-backdrop{position:fixed;inset:0;background:rgba(13,47,79,.6);display:none;align-items:flex-start;justify-content:center;z-index:9000;padding:40px 16px;overflow-y:auto;backdrop-filter:blur(4px)}',
    '#ins .modal-backdrop.show{display:flex}',
    '#ins .modal{background:#fff;border-radius:14px;padding:24px;max-width:520px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.2)}',
    '#ins .modal-eyebrow{font-size:11px;color:var(--muted);letter-spacing:1.2px}',
    '#ins .modal-title{font-size:17px;font-weight:500;color:var(--navy);margin:2px 0 16px}',
    '#ins .modal-field{margin-bottom:12px}',
    '#ins .modal-label{display:block;font-size:11px;font-weight:500;color:var(--navy);margin-bottom:5px;letter-spacing:.3px}',
    '#ins .modal-input,#ins .modal-select,#ins .modal-textarea{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:inherit;color:var(--navy);background:#fff}',
    '#ins .modal-input:focus,#ins .modal-select:focus,#ins .modal-textarea:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-light)}',
    '#ins .modal-textarea{resize:vertical;min-height:60px}',
    '#ins .modal-row{display:flex;gap:10px}',
    '#ins .modal-row>.modal-field{flex:1}',
    '#ins .modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}',
    '#ins .modal-err{padding:9px 12px;border-radius:7px;font-size:11px;background:#FEE2E2;color:#DC2626;border-left:3px solid #DC2626;margin-bottom:10px;display:none}',
    '#ins .modal-err.show{display:block}',
  ].join('\n');
}

/* ===== markup เดิม ครบ (page-head / top / alert / actions / table / create modal) · คง element id เดิม =====
   ตัด app-shell / _sidebar / _sheet_link / _brand_footer / _shared_scripts inline */
function INS_MARKUP() {
  return [
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
    '      Insurance + สวัสดิการ',
    '    </h1>',
    '    <div class="subtitle">Professional insurance + กองทุนสงเคราะห์ + group health · track premium + claim</div>',
    '  </div>',
    '  <div class="page-actions" id="yh-page-actions">',
    '    <button class="btn btn-sm" onclick="loadData()" title="Refresh" id="ins-refresh-btn"></button>',
    '  </div>',
    '</header>',
    '',
    '<div class="top">',
    '  <div class="top-eyebrow">G3 · TRELLO #151 #278</div>',
    '  <div class="top-title">Insurance &amp; Welfare Fund</div>',
    '  <div class="top-sub">ประกันวิชาชีพ · กองทุนสงเคราะห์ลูกจ้าง · renewal tracking</div>',
    '</div>',
    '',
    '<div class="alert">Phase 2 Wave 2 · admin UI · ข้อมูลจาก Supabase (insurance.updated) · เพิ่ม/แก้บน dashboard ยังไม่พร้อม (read-only)</div>',
    '',
    '<div class="actions"><button class="btn btn-primary" onclick="openCreate()">เพิ่ม policy</button><button class="btn" onclick="loadData()">รีเฟรช</button></div>',
    '',
    '<div class="body"><div id="tableWrap" class="loading">กำลังโหลด...</div></div>',
    '',
    // Create modal
    '<div class="modal-backdrop" id="createModal" onclick="if(event.target===this)closeCreate()">',
    '  <div class="modal">',
    '    <div class="modal-eyebrow">G3 · INSURANCE / WELFARE</div>',
    '    <div class="modal-title">เพิ่ม policy / fund ใหม่</div>',
    '    <div class="modal-err" id="modalErr"></div>',
    '    <div class="modal-row">',
    '      <div class="modal-field">',
    '        <label class="modal-label">Record type *</label>',
    '        <select class="modal-select" id="f_record_type">',
    '          <option value="professional_insurance">Professional Insurance · ประกันวิชาชีพ</option>',
    '          <option value="malpractice">Malpractice · ประกันความผิดพลาด</option>',
    '          <option value="group_health">Group Health · ประกันกลุ่ม</option>',
    '          <option value="welfare_fund">Welfare Fund · กองทุนสงเคราะห์</option>',
    '        </select>',
    '      </div>',
    '      <div class="modal-field">',
    '        <label class="modal-label">Employee ID</label>',
    '        <input type="text" class="modal-input" id="f_employee_id" value="ALL" placeholder="ALL หรือ EMP-XXX">',
    '      </div>',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">Policy number *</label>',
    '      <input type="text" class="modal-input" id="f_policy_number" placeholder="POL-12345/2026">',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">Insurer name (บริษัทประกัน/ผู้รับฝาก)</label>',
    '      <input type="text" class="modal-input" id="f_insurer_name" placeholder="ไทยประกันชีวิต · กรุงเทพประกันภัย ...">',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">ขอบเขตความคุ้มครอง (ไทย)</label>',
    '      <textarea class="modal-textarea" id="f_coverage_th"></textarea>',
    '    </div>',
    '    <div class="modal-row">',
    '      <div class="modal-field">',
    '        <label class="modal-label">Coverage amount (฿)</label>',
    '        <input type="number" class="modal-input" id="f_coverage_amount" min="0" step="1000">',
    '      </div>',
    '      <div class="modal-field">',
    '        <label class="modal-label">Premium amount (฿)</label>',
    '        <input type="number" class="modal-input" id="f_premium_amount" min="0" step="100">',
    '      </div>',
    '      <div class="modal-field">',
    '        <label class="modal-label">Frequency</label>',
    '        <select class="modal-select" id="f_premium_frequency">',
    '          <option value="annual">Annual · รายปี</option>',
    '          <option value="quarterly">Quarterly · รายไตรมาส</option>',
    '          <option value="monthly">Monthly · รายเดือน</option>',
    '        </select>',
    '      </div>',
    '    </div>',
    '    <div class="modal-row">',
    '      <div class="modal-field">',
    '        <label class="modal-label">Effective date</label>',
    '        <input type="date" class="modal-input" id="f_effective_date">',
    '      </div>',
    '      <div class="modal-field">',
    '        <label class="modal-label">Expiry date</label>',
    '        <input type="date" class="modal-input" id="f_expiry_date">',
    '      </div>',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">Beneficiary (ผู้รับผลประโยชน์)</label>',
    '      <input type="text" class="modal-input" id="f_beneficiary">',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">Document URL (Drive)</label>',
    '      <input type="url" class="modal-input" id="f_doc_url">',
    '    </div>',
    '    <div class="modal-actions">',
    '      <button class="btn" onclick="closeCreate()">ยกเลิก</button>',
    '      <button class="btn btn-primary" id="saveBtn" onclick="doCreate()">บันทึก</button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   INS_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → INS_BACKEND
   helper จาก _shared_scripts (ICONS/showToast) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function INS_RUN_PAGE_JS() {

  // ---- google.script.run shim → INS_BACKEND (async, คืน shape เดิม) ----
  function _ins2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (INS_BACKEND[prop]) {
            Promise.resolve().then(function () { return INS_BACKEND[prop].apply(INS_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[INS_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[INS_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ins2MakeChain(); } });

  // ---- helpers จาก _shared_scripts (inline · prefix ins ใน id เพื่อกันชน) ----
  const ICONS = {
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
  };
  function showToast(msg, type) {
    let t = document.getElementById('ins2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ins2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ins2Toast = showToast;

  // local esc (กันชน global · ใช้เฉพาะใน scope นี้)
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  /* ===================== JS หน้าเดิม (insurance_manager.html) — ลอกทั้งดุ้น ===================== */
  document.getElementById('ins-refresh-btn').innerHTML = ICONS.refresh + ' Refresh';

  const COLUMNS = ["Type", "Policy", "Insurer", "Premium", "Expires", "Status"];
  let _rows = [];

  function loadData() {
    document.getElementById('tableWrap').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(onLoaded).withFailureHandler(function (e) {
      document.getElementById('tableWrap').innerHTML = '<div class="empty">โหลดล้มเหลว · ' + esc(e && e.message ? e.message : e) + '</div>';
    }).insuranceManagerList({});
  }

  function onLoaded(res) {
    if (!res || res.error) {
      document.getElementById('tableWrap').innerHTML = '<div class="empty">' + esc(res ? res.error : 'no_data') + '</div>';
      return;
    }
    _rows = res.rows || res.records || res.items || res.by_channel || [];
    render();
  }

  function render() {
    if (!_rows.length || !COLUMNS.length) {
      document.getElementById('tableWrap').innerHTML = '<div class="empty">ยังไม่มีรายการ</div>';
      return;
    }
    var h = '<table><thead><tr>';
    COLUMNS.forEach(function (c) { h += '<th>' + c + '</th>'; });
    h += '</tr></thead><tbody>';
    _rows.forEach(function (r, i) {
      h += '<tr onclick="openItem(' + i + ')">';
      Object.values(r).slice(0, COLUMNS.length).forEach(function (v) {
        h += '<td>' + esc(String(v == null ? '-' : v)) + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table>';
    document.getElementById('tableWrap').innerHTML = h;
  }

  function openItem(idx) { alert(JSON.stringify(_rows[idx], null, 2)); }

  // Create modal handlers
  function openCreate() {
    document.getElementById('modalErr').classList.remove('show');
    document.getElementById('createModal').classList.add('show');
  }
  function closeCreate() { document.getElementById('createModal').classList.remove('show'); }
  function modalErr(msg) {
    var e = document.getElementById('modalErr'); e.textContent = msg; e.classList.add('show');
  }
  function doCreate() {
    var pol = document.getElementById('f_policy_number').value.trim();
    if (!pol) { modalErr('กรุณากรอก policy number'); return; }
    var payload = {
      record_type: document.getElementById('f_record_type').value,
      employee_id: document.getElementById('f_employee_id').value.trim() || 'ALL',
      policy_number: pol,
      insurer_name: document.getElementById('f_insurer_name').value.trim(),
      coverage_th: document.getElementById('f_coverage_th').value.trim(),
      coverage_amount: Number(document.getElementById('f_coverage_amount').value || 0),
      premium_amount: Number(document.getElementById('f_premium_amount').value || 0),
      premium_frequency: document.getElementById('f_premium_frequency').value,
      effective_date: document.getElementById('f_effective_date').value || null,
      expiry_date: document.getElementById('f_expiry_date').value || null,
      beneficiary: document.getElementById('f_beneficiary').value.trim(),
      doc_url: document.getElementById('f_doc_url').value.trim(),
    };
    var btn = document.getElementById('saveBtn');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
    google.script.run
      .withSuccessHandler(function (res) {
        btn.disabled = false; btn.textContent = 'บันทึก';
        if (res && res.ok) {
          closeCreate();
          document.getElementById('f_policy_number').value = '';
          document.getElementById('f_insurer_name').value = '';
          document.getElementById('f_coverage_th').value = '';
          loadData();
        } else { modalErr('บันทึกล้มเหลว · ' + (res ? res.error : 'unknown')); }
      })
      .withFailureHandler(function (e) {
        btn.disabled = false; btn.textContent = 'บันทึก';
        modalErr('ระบบขัดข้อง · ' + (e.message || e));
      })
      .insuranceCreate(payload);
  }

  /* ===== expose fn ที่ inline onclick ต้องเรียก ไปยัง window ===== */
  const _exp = { loadData, openItem, openCreate, closeCreate, doCreate };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadData();
}

// expose top-level mount → window (ให้ index.html lazy-loader เรียก)
if (typeof window !== 'undefined') window.mountInsurance = mountInsurance;
