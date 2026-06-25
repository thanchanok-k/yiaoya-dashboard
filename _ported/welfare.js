// _ported/welfare.js — Native read-only page "สวัสดิการพนักงาน (Welfare/Benefits)" สำหรับ Supabase dashboard
// HR/ผู้บริหารดู — ทะเบียนสวัสดิการพนักงาน แยกตามประเภท/พนักงาน · อ่านอย่างเดียว (ไม่มี write)
//
// ทำตาม pattern เดียวกับ _ported/scorecard.js + _ported/fosales.js :
//   - mountWelfare render เข้า #wrap-welfare
//   - ใช้ global window.sb (index.html module scope) — ห้าม redeclare
//   - CSS scope ใต้ #wf · markup คง element id เดิม
//   - fn ที่ inline onclick ต้องใช้ → ผูกกับ window (prefix wf*) กันชน
//   - helper (esc/showToast) inline ใน scope
//
// backend (edge fn hr_list?type=welfare.updated → {items}) :
//   READ  wfList() → items แต่ละตัว = 1 รายการสวัสดิการ
//         **ไม่รู้ field แน่นอน** → defensive:
//           - ระบุ "พนักงาน" จาก full_name | employee_name | name | employee_id
//           - ระบุ "ประเภท" จาก benefit_type | welfare_type | type | category
//           - สถานะ จาก status | state
//           - ช่วงวัน จาก start_date / end_date
//           - หมายเหตุ จาก note | remark | description
//           - **ตัวเลขเงินถูกตัดออกที่ฝั่ง sync แล้ว → ไม่มี amount → ไม่โชว์เงิน**
//         field ที่เหลือ (ที่ไม่ใช่ meta/internal) → แสดงเป็นคอลัมน์เสริมอัตโนมัติ
//         ข้อมูลจริงมาทีหลัง — ตอนนี้อาจว่าง → empty state สวย ไม่ error

/* ============================================================
   WF_BACKEND — ดึงข้อมูลจาก Supabase edge fn hr_list (type=welfare.updated)
   คืน rows ที่ normalize แล้ว + รายชื่อ extra field ที่เจอจริง · กรอง/group ฝั่ง client
   ============================================================ */
var WF_FN = 'hr_list';
var WF_TYPE = 'welfare.updated';
var WF_LIMIT = 2000;

function wf2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function wf2Str(v) {
  if (v == null) return '';
  return String(v).trim();
}
// คืน 'YYYY-MM-DD' จากค่าวันที่ ถ้าแปลงได้ ; แปลงไม่ได้ → คืนสตริงดิบ (ตัดให้สั้น)
function wf2Date(v) {
  if (v == null || v === '') return '';
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  return s.slice(0, 20);
}

// field ที่ถือว่าเป็น "ตัวระบุ/meta/เงิน" → ไม่เอามาเป็นคอลัมน์เสริม
// (เงินทุกชนิดถูกตัดที่ sync แล้ว แต่กันไว้เผื่อหลุดมา จะไม่โชว์)
var WF_META_KEYS = {
  id: 1, welfare_id: 1, benefit_id: 1, entity_id: 1, record_id: 1,
  employee_id: 1, emp_id: 1, staff_id: 1,
  full_name: 1, employee_name: 1, emp_name: 1, name: 1, staff_name: 1,
  benefit_type: 1, welfare_type: 1, type: 1, category: 1, benefit: 1, welfare: 1,
  status: 1, state: 1,
  start_date: 1, end_date: 1, effective_date: 1, expiry_date: 1, date: 1,
  note: 1, notes: 1, remark: 1, remarks: 1, description: 1, desc: 1, detail: 1,
  branch_id: 1, branch: 1, branch_name: 1, dept: 1, department: 1,
  event_type: 1, created_at: 1, updated_at: 1, ts: 1, timestamp: 1,
  _raw: 1,
  // เงิน — กันโชว์เด็ดขาด (เผื่อ sync หลุด)
  amount: 1, total: 1, total_amount: 1, value: 1, baht: 1, cost: 1, price: 1,
  limit: 1, balance: 1, used: 1, remaining: 1, quota_amount: 1, claim_amount: 1,
};

// คีย์ที่บ่งว่าเป็นเงิน → ไม่โชว์แน่นอน (กันชื่อแปลก ๆ)
function wf2IsMoneyKey(key) {
  var k = String(key).toLowerCase();
  return /amount|baht|money|cost|price|salary|wage|฿|total_paid|paid|claim|reimburse/.test(k);
}

// label ไทยของ field ที่รู้จัก (ที่เหลือ humanize อัตโนมัติ)
var WF_LABELS = {
  benefit_type: 'ประเภทสวัสดิการ', welfare_type: 'ประเภทสวัสดิการ', type: 'ประเภท', category: 'ประเภท',
  status: 'สถานะ', state: 'สถานะ',
  start_date: 'เริ่ม', end_date: 'สิ้นสุด', effective_date: 'มีผล', expiry_date: 'หมดอายุ',
  note: 'หมายเหตุ', remark: 'หมายเหตุ', description: 'รายละเอียด',
  full_name: 'พนักงาน', employee_name: 'พนักงาน',
  branch: 'สาขา', branch_id: 'สาขา', dept: 'แผนก', department: 'แผนก',
  quota: 'โควตา', count: 'จำนวน', days: 'จำนวนวัน',
};

function wf2Humanize(key) {
  var k = String(key);
  if (WF_LABELS[k.toLowerCase()]) return WF_LABELS[k.toLowerCase()];
  return k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

// map payload event ดิบ → row shape (defensive)
function wf2MapRow(p) {
  p = p || {};
  var empId = wf2Str(p.employee_id || p.emp_id || p.staff_id);
  var emp = wf2Str(p.full_name || p.employee_name || p.emp_name || p.name || p.staff_name);
  if (!emp) emp = empId || '—';
  var type = wf2Str(p.benefit_type || p.welfare_type || p.type || p.category || p.benefit || p.welfare) || '—';
  var status = wf2Str(p.status || p.state);
  var startDate = wf2Date(p.start_date || p.effective_date || p.date);
  var endDate = wf2Date(p.end_date || p.expiry_date);
  var note = wf2Str(p.note || p.notes || p.remark || p.remarks || p.description || p.desc || p.detail);

  // extra: field อื่น ๆ ที่ไม่ใช่ meta และไม่ใช่เงิน → เก็บเป็นสตริงโชว์
  var extra = {};
  Object.keys(p).forEach(function (k) {
    if (WF_META_KEYS[k]) return;
    if (k.charAt(0) === '_') return;
    if (wf2IsMoneyKey(k)) return; // ห้ามโชว์เงิน
    var s = wf2Str(p[k]);
    if (s !== '') extra[k] = s;
  });

  return {
    id: wf2Str(p.welfare_id || p.benefit_id || p.id || p.entity_id || p.record_id),
    employee: emp,
    employee_id: empId,
    type: type,
    status: status,
    start_date: startDate,
    end_date: endDate,
    note: note,
    extra: extra,
    _raw: p,
  };
}

// cache row ล่าสุด (backend ไม่มี endpoint แยก)
var _wf2Rows = [];

function wf2FetchRows() {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) {
    _wf2Rows = [];
    return Promise.resolve([]);
  }
  var q = WF_FN + '?type=' + encodeURIComponent(WF_TYPE) + '&limit=' + WF_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    var data = (res && res.data) || {};
    var items = wf2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p, i) {
      var row = wf2MapRow(p);
      var key = row.id || (row.employee_id + '|' + row.type + '|' + row.start_date) || ('idx' + i);
      if (seen[key]) return;
      seen[key] = true;
      if (!row.id) row.id = key;
      rows.push(row);
    });
    _wf2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[WF_BACKEND] list fetch failed', e);
    _wf2Rows = [];
    return [];
  });
}

var WF_BACKEND = {
  // list — { rows, types, employees, statuses, extraKeys } (ฝั่ง client กรองเอง)
  wfList: function () {
    return wf2FetchRows().then(function (all) {
      var tSeen = {}, types = [];
      var eSeen = {}, employees = [];
      var sSeen = {}, statuses = [];
      var xSeen = {}, extraKeys = [];
      all.forEach(function (r) {
        if (r.type && !tSeen[r.type]) { tSeen[r.type] = true; types.push(r.type); }
        if (r.employee && !eSeen[r.employee]) { eSeen[r.employee] = true; employees.push(r.employee); }
        if (r.status && !sSeen[r.status]) { sSeen[r.status] = true; statuses.push(r.status); }
        Object.keys(r.extra || {}).forEach(function (k) {
          if (!xSeen[k]) { xSeen[k] = true; extraKeys.push(k); }
        });
      });
      types.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });
      employees.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });
      statuses.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });
      extraKeys.sort(function (a, b) { return a.localeCompare(b); });
      return { rows: all, types: types, employees: employees, statuses: statuses, extraKeys: extraKeys };
    });
  },
};

/* ============================================================
   mountWelfare — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountWelfare() {
  if (!document.getElementById('wrap-welfare')) return;
  var wrap = document.getElementById('wrap-welfare');
  wrap.innerHTML = '<style>' + WF_CSS() + '</style><div id="wf">' + WF_MARKUP() + '</div>';
  WF_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #wf (brand tokens เดียวกับหน้าอื่น) ===== */
function WF_CSS() {
  return [
    '#wf{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#wf *{box-sizing:border-box}',
    // page head
    '#wf .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#wf .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#wf .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#wf .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#wf .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // buttons
    '#wf .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#wf .btn:hover{border-color:var(--navy)}',
    '#wf .btn svg{width:14px;height:14px}',
    '#wf .btn-sm{padding:5px 10px;font-size:12px}',
    // read-only banner
    '#wf .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#wf .ro-banner strong{font-weight:600}',
    // stat cards
    '#wf .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#wf .stats{grid-template-columns:repeat(2,1fr)}}',
    '@media (max-width:600px){#wf .stats{grid-template-columns:repeat(2,1fr)}}',
    '#wf .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#wf .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#wf .stat-card.rows::before{background:#1E40AF}',
    '#wf .stat-card.type::before{background:#6D28D9}',
    '#wf .stat-card.emp::before{background:#4338CA}',
    '#wf .stat-card.active::before{background:#166534}',
    '#wf .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#wf .stat-card .v{font-size:22px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#wf .stat-card.active .v{color:#166534}',
    '#wf .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#wf .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#wf .filter{display:flex;flex-direction:column;gap:2px}',
    '#wf .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#wf .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#wf .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section title
    '#wf .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px}',
    // type summary cards
    '#wf .type-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-bottom:14px}',
    '#wf .type-card{background:#fff;border:1px solid var(--border);border-left:3px solid var(--teal);border-radius:8px;padding:12px 14px}',
    '#wf .type-card .tname{font-size:13px;font-weight:700;color:var(--navy)}',
    '#wf .type-card .tcount{font-size:20px;font-weight:600;color:var(--navy-2);margin-top:4px;letter-spacing:-.02em}',
    '#wf .type-card .tmeta{font-size:11px;color:var(--text-muted);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap}',
    // data table
    '#wf .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#wf .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);white-space:nowrap}',
    '#wf .data-table th.num,#wf .data-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '#wf .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top}',
    '#wf .data-table tr:last-child td{border-bottom:0}',
    '#wf .data-table tr:hover td{background:#FAFBFC}',
    '#wf .emp-cell{font-weight:600;color:var(--navy)}',
    '#wf .id-mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text-muted)}',
    '#wf .date-mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text-muted);white-space:nowrap}',
    '#wf .note-cell{color:var(--text-muted);max-width:280px}',
    '#wf .table-wrap{overflow-x:auto}',
    // status badge
    '#wf .badge{display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;white-space:nowrap;background:#F1F5F9;color:#475569}',
    '#wf .badge.ok{background:#DCFCE7;color:#166534}',
    '#wf .badge.warn{background:#FEF3C7;color:#92400E}',
    '#wf .badge.off{background:#FEE2E2;color:#991B1B}',
    // empty / loading
    '#wf .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#wf .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#wf .empty-icon svg{width:24px;height:24px}',
    '#wf .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#wf .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#wf .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    '@media (max-width:768px){#wf .stats{grid-template-columns:repeat(2,1fr)}}',
  ].join('\n');
}

/* ===== markup · คง element id เดิม ===== */
function WF_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    '      สวัสดิการพนักงาน',
    '    </h1>',
    '    <div class="subtitle" id="wf-subtitle">ทะเบียนสวัสดิการ แยกตามประเภท/พนักงาน (Welfare/Benefits)</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-sm" onclick="wfReload()" id="wf-refresh-btn"></button>',
    '  </div>',
    '</header>',
    // read-only banner
    '<div class="ro-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#3DC5B7;display:inline-block"></span>',
    '  <span><strong>มุมมอง HR:</strong> ทะเบียนสวัสดิการของพนักงานแต่ละท่าน · อ่านอย่างเดียว (ไม่แสดงข้อมูลจำนวนเงิน)</span>',
    '</div>',
    '<div class="stats" id="wf-stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ประเภทสวัสดิการ</label>',
    '    <select id="wf-filter-type" onchange="wfRender()"><option value="">ทุกประเภท</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>พนักงาน</label>',
    '    <select id="wf-filter-emp" onchange="wfRender()"><option value="">ทุกคน</option></select>',
    '  </div>',
    '</div>',
    '<div id="wf-content" class="loading">กำลังโหลด...</div>',
  ].join('\n');
}

/* ============================================================
   WF_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function WF_RUN_PAGE_JS() {
  var _wfRoot = document.getElementById('wf');
  function $id(id) { return _wfRoot ? _wfRoot.querySelector('#' + id) : document.getElementById(id); }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function showToast(msg, type) {
    var t = document.getElementById('wf2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'wf2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var ICON_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

  var _wfData = null; // { rows, types, employees, statuses, extraKeys }

  function fmtInt(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try { return n.toLocaleString('th-TH'); } catch (e) { return String(Math.round(n)); }
  }

  function dateLabel(d) {
    if (!d) return '';
    var parts = String(d).split('-');
    if (parts.length === 3 && /^\d{4}$/.test(parts[0])) {
      var names = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      var mi = parseInt(parts[1], 10);
      var yr = parseInt(parts[0], 10) + 543; // พ.ศ.
      return parseInt(parts[2], 10) + ' ' + (names[mi] || parts[1]) + ' ' + String(yr).slice(-2);
    }
    return String(d);
  }

  // เดาคลาส badge จากสตริงสถานะ (defensive — รองรับไทย/อังกฤษ)
  function statusClass(st) {
    var s = String(st || '').toLowerCase();
    if (!s) return '';
    if (/active|approved|อนุมัติ|ใช้งาน|ปกติ|enrolled|enroll|ลงทะเบียน|มีผล|valid|paid/.test(s)) return 'ok';
    if (/pending|รอ|review|กำลัง|draft|ร่าง/.test(s)) return 'warn';
    if (/expire|หมดอายุ|ยกเลิก|cancel|reject|ปฏิเสธ|inactive|ไม่ใช้|สิ้นสุด|terminat|ended/.test(s)) return 'off';
    return '';
  }

  // ---- load ----
  function loadData() {
    $id('wf-content').className = 'loading';
    $id('wf-content').innerHTML = 'กำลังโหลด...';
    WF_BACKEND.wfList().then(function (res) {
      _wfData = res || { rows: [], types: [], employees: [], statuses: [], extraKeys: [] };
      populateFilters();
      renderAll();
    }).catch(function (e) {
      console.error('[welfare] load failed', e);
      _wfData = { rows: [], types: [], employees: [], statuses: [], extraKeys: [] };
      $id('wf-content').className = '';
      $id('wf-content').innerHTML = '<div class="empty"><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml((e && e.message) || 'unknown') + '</div></div>';
      renderStats([]);
    });
  }

  function populateFilters() {
    var tSel = $id('wf-filter-type');
    if (tSel && tSel.options.length <= 1) {
      (_wfData.types || []).forEach(function (t) {
        var o = document.createElement('option');
        o.value = t; o.textContent = t;
        tSel.appendChild(o);
      });
    }
    var eSel = $id('wf-filter-emp');
    if (eSel && eSel.options.length <= 1) {
      (_wfData.employees || []).forEach(function (e) {
        var o = document.createElement('option');
        o.value = e; o.textContent = e;
        eSel.appendChild(o);
      });
    }
  }

  // ---- filtered rows ----
  function filteredRows() {
    var rows = (_wfData && _wfData.rows) ? _wfData.rows.slice() : [];
    var tSel = $id('wf-filter-type');
    var eSel = $id('wf-filter-emp');
    var t = tSel ? tSel.value : '';
    var e = eSel ? eSel.value : '';
    if (t) rows = rows.filter(function (r) { return r.type === t; });
    if (e) rows = rows.filter(function (r) { return r.employee === e; });
    // เรียง: พนักงาน แล้วประเภท แล้ววันเริ่ม (ใหม่→เก่า)
    rows.sort(function (a, b) {
      var ec = String(a.employee || '').localeCompare(String(b.employee || ''), 'th');
      if (ec !== 0) return ec;
      var tc = String(a.type || '').localeCompare(String(b.type || ''), 'th');
      if (tc !== 0) return tc;
      return String(b.start_date || '').localeCompare(String(a.start_date || ''));
    });
    return rows;
  }

  // ---- render ----
  function renderAll() {
    var all = (_wfData && _wfData.rows) ? _wfData.rows : [];
    renderStats(all);

    var content = $id('wf-content');
    content.className = '';

    if (!all.length) {
      content.innerHTML = emptyState();
      return;
    }

    var rows = filteredRows();
    if (!rows.length) {
      content.innerHTML = '<div class="empty"><div class="empty-title">ไม่มีข้อมูลตามตัวกรอง</div><div class="empty-sub">ลองเปลี่ยนประเภท/พนักงาน</div></div>';
      return;
    }
    content.innerHTML = renderTypeSummary(rows) + renderTable(rows);
  }

  function renderStats(all) {
    all = all || [];
    var tSeen = {}, eSeen = {}, activeN = 0;
    all.forEach(function (r) {
      if (r.type) tSeen[r.type] = true;
      if (r.employee) eSeen[r.employee] = true;
      if (statusClass(r.status) === 'ok') activeN++;
    });
    var typeN = Object.keys(tSeen).length;
    var empN = Object.keys(eSeen).length;
    var hasStatus = (_wfData && _wfData.statuses && _wfData.statuses.length) ? true : false;

    var cards = [
      statCard('rows', 'รายการสวัสดิการ', fmtInt(all.length), typeN + ' ประเภท'),
      statCard('type', 'ประเภทสวัสดิการ', fmtInt(typeN), 'ที่ใช้งาน'),
      statCard('emp', 'พนักงานที่มีสวัสดิการ', fmtInt(empN), 'คน'),
    ];
    if (hasStatus) {
      cards.push(statCard('active', 'รายการที่ใช้งานอยู่', fmtInt(activeN), 'จาก ' + all.length + ' รายการ'));
    } else {
      cards.push(statCard('active', 'เฉลี่ยต่อคน', empN ? (Math.round((all.length / empN) * 10) / 10) : '—', 'รายการ/คน'));
    }

    $id('wf-stats').innerHTML = cards.join('');

    var sub = $id('wf-subtitle');
    if (sub) sub.textContent = 'ทะเบียนสวัสดิการ แยกตามประเภท/พนักงาน (Welfare/Benefits) · ' + all.length + ' รายการ';
  }

  function statCard(cls, label, val, sub) {
    return [
      '<div class="stat-card ' + cls + '">',
      '  <div class="l">' + escapeHtml(label) + '</div>',
      '  <div class="v">' + val + '</div>',
      '  <div class="sub">' + escapeHtml(sub) + '</div>',
      '</div>',
    ].join('');
  }

  function renderTypeSummary(rows) {
    var grouped = {};
    rows.forEach(function (r) {
      var t = r.type || '—';
      if (!grouped[t]) grouped[t] = { name: t, count: 0, emps: {} };
      grouped[t].count++;
      if (r.employee) grouped[t].emps[r.employee] = true;
    });
    var list = Object.keys(grouped).map(function (k) {
      var g = grouped[k];
      g.empN = Object.keys(g.emps).length;
      return g;
    });
    list.sort(function (a, b) { return b.count - a.count; });
    if (!list.length) return '';
    var cards = list.map(function (g) {
      return [
        '<div class="type-card">',
        '  <div class="tname">' + escapeHtml(g.name) + '</div>',
        '  <div class="tcount">' + fmtInt(g.count) + ' รายการ</div>',
        '  <div class="tmeta">',
        '    <span>' + fmtInt(g.empN) + ' คน</span>',
        '  </div>',
        '</div>',
      ].join('');
    }).join('');
    return '<div class="sec-title">สรุปตามประเภท · เรียงจำนวนมากสุด</div><div class="type-grid">' + cards + '</div>';
  }

  function renderTable(rows) {
    var extraKeys = (_wfData && _wfData.extraKeys) || [];
    var hasStatus = rows.some(function (r) { return r.status; });
    var hasNote = rows.some(function (r) { return r.note; });
    var hasDate = rows.some(function (r) { return r.start_date || r.end_date; });

    // header
    var th = ['<th>พนักงาน</th>', '<th>ประเภทสวัสดิการ</th>'];
    if (hasStatus) th.push('<th>สถานะ</th>');
    if (hasDate) th.push('<th>ช่วงวัน</th>');
    extraKeys.forEach(function (k) { th.push('<th>' + escapeHtml(wf2Humanize(k)) + '</th>'); });
    if (hasNote) th.push('<th>หมายเหตุ</th>');

    var body = rows.map(function (r) {
      var tds = [
        '<td class="emp-cell">' + escapeHtml(r.employee || '—') + (r.employee_id && r.employee_id !== r.employee ? ' <span class="id-mono">' + escapeHtml(r.employee_id) + '</span>' : '') + '</td>',
        '<td>' + escapeHtml(r.type || '—') + '</td>',
      ];
      if (hasStatus) {
        var sc = statusClass(r.status);
        tds.push('<td>' + (r.status ? '<span class="badge ' + sc + '">' + escapeHtml(r.status) + '</span>' : '<span class="id-mono">—</span>') + '</td>');
      }
      if (hasDate) {
        var dr = '';
        if (r.start_date && r.end_date) dr = dateLabel(r.start_date) + ' – ' + dateLabel(r.end_date);
        else if (r.start_date) dr = dateLabel(r.start_date);
        else if (r.end_date) dr = 'ถึง ' + dateLabel(r.end_date);
        tds.push('<td><span class="date-mono">' + (dr ? escapeHtml(dr) : '—') + '</span></td>');
      }
      extraKeys.forEach(function (k) {
        var v = (r.extra && r.extra[k] != null) ? r.extra[k] : '';
        tds.push('<td>' + (v !== '' ? escapeHtml(v) : '<span class="id-mono">—</span>') + '</td>');
      });
      if (hasNote) {
        tds.push('<td class="note-cell">' + (r.note ? escapeHtml(r.note) : '—') + '</td>');
      }
      return '<tr>' + tds.join('') + '</tr>';
    }).join('');

    var colCount = th.length;
    return [
      '<div class="sec-title">รายการสวัสดิการ (' + rows.length + ' รายการ)</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>' + th.join('') + '</tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '  <tfoot><tr><td colspan="' + colCount + '">รวม ' + rows.length + ' รายการ</td></tr></tfoot>',
      '</table>',
      '</div>',
    ].join('');
  }

  function emptyState() {
    return [
      '<div class="empty">',
      '  <div class="empty-icon">' + ICON_HEART + '</div>',
      '  <div class="empty-title">ยังไม่มีข้อมูลสวัสดิการพนักงาน</div>',
      '  <div class="empty-sub">เมื่อระบบส่งข้อมูลสวัสดิการเข้ามา (welfare.updated) ข้อมูลจะแสดงที่นี่</div>',
      '</div>',
    ].join('');
  }

  function wfReload() { loadData(); }
  function wfRender() { renderAll(); }

  // init labels
  $id('wf-refresh-btn').innerHTML = ICON_REFRESH + ' รีเฟรช';

  // expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix wf* กันชน)
  window.wfReload = wfReload;
  window.wfRender = wfRender;

  // init
  loadData();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountWelfare) */
if (typeof window !== 'undefined') {
  window.mountWelfare = mountWelfare;
  window.WF_BACKEND = WF_BACKEND;
}
