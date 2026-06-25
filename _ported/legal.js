// _ported/legal.js — Native read-only page "แฟ้มคดี/กฎหมาย (Legal Cases)" สำหรับ Supabase dashboard
// **ลับสุด · HQ / ผู้บริหารเท่านั้น** · อ่านอย่างเดียว (ไม่มี write — action ทุกตัว = stub + toast)
//
// ลอกจาก source GAS: HR Announcement/AppsScript/legal_case.html (49a Legal Case Manager)
//   - แต่หน้านี้เป็น read-only projection viewer (ไม่มี recompile/export/AI/timeline-edit)
//   - field คดี (จาก projection payload) defensive: case_id, case_title|title, case_type, status,
//     employee_name|employee_id, opened_at, court?, plaintiff?, defendant?, next_hearing?, summary|note
//
// ทำตาม pattern เดียวกับ _ported/scorecard.js + _ported/recruit.js:
//   - mountLegal render เข้า #wrap-legal
//   - ใช้ global window.sb (index.html module scope) — ห้าม redeclare sb/esc/$
//   - CSS scope ใต้ #lg · fn ที่ inline onclick ผูกกับ window (prefix lg*) กันชน
//   - helper (escapeHtml/showToast) inline ใน closure
//
// backend (edge fn hr_list_hq?type=legal.updated → {items}) :
//   **เรียก hr_list_hq (ไม่ใช่ hr_list!)** — มี role-gate ฝั่ง server
//   ถ้าไม่ใช่ HQ → คืน 403 → แสดงหน้า "เฉพาะผู้บริหาร/HQ" สวย ๆ (ไม่ throw / ไม่ error แดง)

/* ============================================================
   LG_BACKEND — ดึงข้อมูลจาก Supabase edge fn hr_list_hq (type=legal.updated)
   คืน rows ที่ normalize แล้ว + flag forbidden (403) เพื่อให้หน้าแสดง gate
   ============================================================ */
var LG_FN = 'hr_list_hq';
var LG_TYPE = 'legal.updated';
var LG_LIMIT = 2000;

function lg2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function lg2Str(v) {
  if (v == null) return '';
  return String(v).trim();
}
// คืน 'YYYY-MM-DD' จากค่าวันที่ ถ้า parse ได้ ; ไม่ใช่วันที่ → คืนสตริงดิบ (ตัด time ถ้ามี)
function lg2Date(v) {
  if (v == null || v === '') return '';
  var s = String(v).trim();
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  var d = new Date(s);
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  return s;
}

// map status code → label ไทย (รองรับทั้งของเดิม + คำทั่วไป)
var LG_STATUS_LABEL = {
  open: 'เปิด', compiling: 'กำลังรวบรวม', ready_for_lawyer: 'พร้อมส่งทนาย',
  closed: 'ปิด', pending: 'รอดำเนินการ', active: 'ดำเนินอยู่',
  won: 'ชนะคดี', lost: 'แพ้คดี', settled: 'ยอมความ', dismissed: 'ยกฟ้อง',
  appeal: 'อุทธรณ์', filed: 'ยื่นฟ้องแล้ว',
};
function lg2StatusLabel(s) {
  var k = String(s == null ? '' : s).toLowerCase();
  return LG_STATUS_LABEL[k] || (s ? String(s) : '—');
}
// จัดกลุ่มสถานะ → bucket สำหรับ pill สี + การ์ดสรุป
function lg2StatusBucket(s) {
  var k = String(s == null ? '' : s).toLowerCase();
  if (k === 'closed' || k === 'won' || k === 'settled' || k === 'dismissed' || k === 'lost') return 'closed';
  if (k === 'ready_for_lawyer' || k === 'filed' || k === 'appeal') return 'ready';
  if (k === 'compiling' || k === 'pending') return 'compiling';
  return 'open'; // open / active / unknown
}

// map payload event ดิบ → row shape (defensive — เก็บ _raw ไว้ให้ detail reuse)
function lg2MapRow(p) {
  p = p || {};
  var caseId = lg2Str(p.case_id || p.id || p.entity_id);
  var title = lg2Str(p.case_title || p.title || p.subject || p.summary);
  var empName = lg2Str(p.employee_name || p.name);
  var empId = lg2Str(p.employee_id);
  if (!title) title = empName ? ('คดี · ' + empName) : (caseId || '—');
  return {
    id: caseId,
    title: title,
    case_type: lg2Str(p.case_type || p.type),
    status: lg2Str(p.status),
    employee_name: empName,
    employee_id: empId,
    opened_at: lg2Date(p.opened_at || p.created_at || p.opened_date || p.date),
    next_hearing: lg2Date(p.next_hearing || p.hearing_date || p.next_date),
    court: lg2Str(p.court || p.court_name),
    plaintiff: lg2Str(p.plaintiff),
    defendant: lg2Str(p.defendant),
    summary: lg2Str(p.summary || p.note || p.notes || p.detail),
    branch_id: lg2Str(p.branch_id || p.branch),
    _raw: p,
  };
}

var _lg2Rows = [];
var _lg2Forbidden = false; // true ถ้า backend คืน 403 (ไม่ใช่ HQ)

// ตรวจว่า error จาก functions.invoke เป็น 403 หรือไม่ (FunctionsHttpError มี .context = Response)
function lg2IsForbidden(err) {
  if (!err) return false;
  try {
    var ctx = err.context;
    if (ctx && typeof ctx.status === 'number' && (ctx.status === 403 || ctx.status === 401)) return true;
  } catch (e) { /* noop */ }
  var msg = String((err && err.message) || err || '').toLowerCase();
  return /\b(403|401)\b/.test(msg) || /forbidden|unauthorized|not\s*hq|permission/.test(msg);
}

function lg2FetchRows() {
  _lg2Forbidden = false;
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) {
    _lg2Rows = [];
    return Promise.resolve([]);
  }
  var q = LG_FN + '?type=' + encodeURIComponent(LG_TYPE) + '&limit=' + LG_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    // supabase-js: non-2xx มาที่ res.error (ไม่ throw) — ตรวจ 403 ที่นี่ด้วย
    if (res && res.error) {
      if (lg2IsForbidden(res.error)) { _lg2Forbidden = true; _lg2Rows = []; return []; }
      throw res.error;
    }
    var data = (res && res.data) || {};
    // เผื่อ backend ส่ง {ok:false, error:'...'} ใน body แทน HTTP 403
    if (data && data.ok === false) {
      var be = String(data.error || '').toLowerCase();
      if (/forbidden|hq|permission|unauthorized|403|401/.test(be)) { _lg2Forbidden = true; _lg2Rows = []; return []; }
    }
    var items = lg2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var row = lg2MapRow(p);
      var key = row.id || (row.title + '|' + row.opened_at);
      if (!key || seen[key]) return;
      seen[key] = true;
      if (!row.id) row.id = key;
      rows.push(row);
    });
    _lg2Rows = rows;
    return rows;
  }).catch(function (e) {
    if (lg2IsForbidden(e)) { _lg2Forbidden = true; _lg2Rows = []; return []; }
    console.warn('[LG_BACKEND] list fetch failed', e);
    _lg2Rows = [];
    throw e; // ให้ loadData แยกแยะ error จริง vs forbidden
  });
}

var LG_BACKEND = {
  // list — { rows, statuses, types, forbidden } (ฝั่ง client กรองเอง)
  lgList: function () {
    return lg2FetchRows().then(function (all) {
      var sSeen = {}, statuses = [];
      var tSeen = {}, types = [];
      all.forEach(function (r) {
        if (r.status && !sSeen[r.status]) { sSeen[r.status] = true; statuses.push(r.status); }
        if (r.case_type && !tSeen[r.case_type]) { tSeen[r.case_type] = true; types.push(r.case_type); }
      });
      statuses.sort();
      types.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });
      return { rows: all, statuses: statuses, types: types, forbidden: _lg2Forbidden };
    }).catch(function (e) {
      if (_lg2Forbidden) return { rows: [], statuses: [], types: [], forbidden: true };
      throw e;
    });
  },
  // detail — reuse row ดิบที่ cache ไว้ตอน list (backend ไม่มี endpoint แยก)
  lgDetail: function (id) {
    var r = null;
    for (var i = 0; i < _lg2Rows.length; i++) { if (_lg2Rows[i].id === id) { r = _lg2Rows[i]; break; } }
    return Promise.resolve(r);
  },
};

/* ============================================================
   mountLegal — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountLegal() {
  if (!document.getElementById('wrap-legal')) return;
  var wrap = document.getElementById('wrap-legal');
  wrap.innerHTML = '<style>' + LG_CSS() + '</style><div id="lg">' + LG_MARKUP() + '</div>';
  LG_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #lg (brand tokens เดียวกับหน้าอื่น) ===== */
function LG_CSS() {
  return [
    '#lg{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#lg *{box-sizing:border-box}',
    // page head
    '#lg .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#lg .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#lg .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#lg .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#lg .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // buttons
    '#lg .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#lg .btn:hover{border-color:var(--navy)}',
    '#lg .btn svg{width:14px;height:14px}',
    '#lg .btn-sm{padding:5px 10px;font-size:12px}',
    // confidential banner (สีน้ำเงินเข้ม + จุดแดง)
    '#lg .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:10px;display:flex;align-items:center;gap:8px}',
    '#lg .ro-banner strong{font-weight:600}',
    '#lg .disclaimer{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;border-radius:6px;padding:8px 14px;font-size:11.5px;margin-bottom:14px;line-height:1.5}',
    // stat cards
    '#lg .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#lg .stats{grid-template-columns:repeat(2,1fr)}}',
    '@media (max-width:600px){#lg .stats{grid-template-columns:repeat(2,1fr)}}',
    '#lg .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#lg .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#lg .stat-card.total::before{background:#1E40AF}',
    '#lg .stat-card.open::before{background:#2563EB}',
    '#lg .stat-card.ready::before{background:#B45309}',
    '#lg .stat-card.closed::before{background:#166534}',
    '#lg .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#lg .stat-card .v{font-size:22px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#lg .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#lg .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#lg .filter{display:flex;flex-direction:column;gap:2px}',
    '#lg .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#lg .filter select,#lg .filter input{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#lg .filter select:focus,#lg .filter input:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section title
    '#lg .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px}',
    // pills
    '#lg .pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}',
    '#lg .pill-open{background:#DBEAFE;color:#1E40AF}',
    '#lg .pill-compiling{background:#FEF3C7;color:#92400E}',
    '#lg .pill-ready{background:#FEF3C7;color:#92400E}',
    '#lg .pill-closed{background:#DCFCE7;color:#166534}',
    '#lg .pill-na{background:#E5E7EB;color:#6B7280}',
    // data table
    '#lg .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#lg .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);white-space:nowrap}',
    '#lg .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top}',
    '#lg .data-table tr:last-child td{border-bottom:0}',
    '#lg .data-table tbody tr{cursor:pointer}',
    '#lg .data-table tbody tr:hover td{background:#F0FBF9}',
    '#lg .case-cell{font-weight:600;color:var(--navy)}',
    '#lg .mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text-muted)}',
    '#lg .table-wrap{overflow-x:auto}',
    // modal (detail)
    '#lg .modal-bg{position:fixed;inset:0;background:rgba(13,47,79,.45);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#lg .modal-bg.active{display:flex}',
    '#lg .modal{background:#fff;border-radius:12px;max-width:560px;width:94%;max-height:92vh;overflow-y:auto}',
    '#lg .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:12px}',
    '#lg .modal-header h2{font-size:16px;margin:0;color:var(--navy)}',
    '#lg .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#lg .modal-x{cursor:pointer;border:none;background:none;font-size:20px;color:var(--text-faint);line-height:1}',
    '#lg .modal-body{padding:16px 20px}',
    '#lg .kv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
    '#lg .kv{background:#F9FAFB;border:1px solid var(--border);border-radius:8px;padding:9px 11px}',
    '#lg .kv .k{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}',
    '#lg .kv .v{font-size:14px;font-weight:600;color:var(--navy);margin-top:2px;word-break:break-word}',
    '#lg .kv.full{grid-column:1/-1}',
    '#lg .kv.full .v{font-weight:400;font-size:13px;color:var(--text);white-space:pre-wrap}',
    // empty / loading / gate
    '#lg .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#lg .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#lg .empty-icon svg{width:24px;height:24px}',
    '#lg .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#lg .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#lg .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // gate (403)
    '#lg .gate{text-align:center;padding:64px 24px;background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);border-radius:14px;color:#fff}',
    '#lg .gate-icon{width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;margin:0 auto 16px}',
    '#lg .gate-icon svg{width:30px;height:30px;color:#fff}',
    '#lg .gate-title{font-size:17px;font-weight:700;margin-bottom:6px}',
    '#lg .gate-sub{font-size:13px;color:#CBD5E1;max-width:380px;margin:0 auto;line-height:1.6}',
  ].join('\n');
}

/* ===== markup ===== */
function LG_MARKUP() {
  return [
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7l-3 6h6z"/><path d="M19 7l-3 6h6z"/><path d="M5 7h14"/><path d="M7 21h10"/></svg>',
    '      แฟ้มคดี/กฎหมาย',
    '    </h1>',
    '    <div class="subtitle" id="lg-subtitle">รายการคดี/ข้อพิพาท ของพนักงาน (Legal Cases) · ลับสุด</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-sm" onclick="lgReload()" id="lg-refresh-btn"></button>',
    '  </div>',
    '</header>',
    '<div class="ro-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#EF4444;display:inline-block"></span>',
    '  <span><strong>ลับสุด · เฉพาะผู้บริหาร/HQ:</strong> ข้อมูลคดีและข้อพิพาท · อ่านอย่างเดียว (read-only)</span>',
    '</div>',
    '<div class="disclaimer">',
    '  &#9888; ข้อมูลนี้รวบรวมเพื่อประกอบการพิจารณา ต้องให้ทนายความตรวจสอบก่อนใช้จริง — ไม่ใช่คำปรึกษาทางกฎหมาย',
    '</div>',
    '<div class="stats" id="lg-stats"></div>',
    '<div class="filters" id="lg-filters">',
    '  <div class="filter">',
    '    <label>สถานะ</label>',
    '    <select id="lg-filter-status" onchange="lgRender()"><option value="">ทุกสถานะ</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>ประเภทคดี</label>',
    '    <select id="lg-filter-type" onchange="lgRender()"><option value="">ทุกประเภท</option></select>',
    '  </div>',
    '  <div class="filter" style="flex:1;min-width:180px">',
    '    <label>ค้นหา (ชื่อคดี/พนักงาน)</label>',
    '    <input id="lg-filter-q" type="text" placeholder="พิมพ์เพื่อค้นหา..." oninput="lgRender()" style="width:100%">',
    '  </div>',
    '</div>',
    '<div id="lg-content" class="loading">กำลังโหลด...</div>',
    // detail modal
    '<div class="modal-bg" id="lg-detail-bg" onclick="if(event.target===this)lgCloseDetail()">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <div><h2 id="lg-d-title">กำลังโหลด...</h2><p id="lg-d-sub">—</p></div>',
    '      <button class="modal-x" onclick="lgCloseDetail()">&times;</button>',
    '    </div>',
    '    <div class="modal-body" id="lg-d-body"></div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   LG_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function LG_RUN_PAGE_JS() {
  var _lgRoot = document.getElementById('lg');
  function $id(id) { return _lgRoot ? _lgRoot.querySelector('#' + id) : document.getElementById(id); }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function showToast(msg, type) {
    var t = document.getElementById('lg2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'lg2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var ICON_SCALE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M5 7l-3 6h6z"/><path d="M19 7l-3 6h6z"/><path d="M5 7h14"/><path d="M7 21h10"/></svg>';
  var ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  var _lgData = null; // { rows, statuses, types, forbidden }

  function statusPill(s) {
    var bucket = lg2StatusBucket(s);
    var cls = { open: 'pill-open', compiling: 'pill-compiling', ready: 'pill-ready', closed: 'pill-closed' }[bucket] || 'pill-na';
    return '<span class="pill ' + cls + '">' + escapeHtml(lg2StatusLabel(s)) + '</span>';
  }

  function fmtInt(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try { return n.toLocaleString('th-TH'); } catch (e) { return String(Math.round(n)); }
  }

  // ---- load ----
  function loadData() {
    var c = $id('lg-content');
    c.className = 'loading'; c.innerHTML = 'กำลังโหลด...';
    LG_BACKEND.lgList().then(function (res) {
      _lgData = res || { rows: [], statuses: [], types: [], forbidden: false };
      if (_lgData.forbidden) { renderGate(); return; }
      populateFilters();
      renderAll();
    }).catch(function (e) {
      console.error('[legal] load failed', e);
      _lgData = { rows: [], statuses: [], types: [], forbidden: false };
      c.className = '';
      c.innerHTML = '<div class="empty"><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml((e && e.message) || 'unknown') + '</div></div>';
      renderStats([]);
    });
  }

  // ---- 403 / non-HQ gate ----
  function renderGate() {
    // ซ่อน stat/filter ที่ไม่ควรโชว์ + แสดงการ์ดสวย ๆ
    var st = $id('lg-stats'); if (st) st.innerHTML = '';
    var fl = $id('lg-filters'); if (fl) fl.style.display = 'none';
    var sub = $id('lg-subtitle'); if (sub) sub.textContent = 'เฉพาะผู้บริหาร/HQ';
    var c = $id('lg-content');
    c.className = '';
    c.innerHTML = [
      '<div class="gate">',
      '  <div class="gate-icon">' + ICON_LOCK + '</div>',
      '  <div class="gate-title">หน้านี้เฉพาะผู้บริหาร / HQ</div>',
      '  <div class="gate-sub">ข้อมูลแฟ้มคดีและข้อพิพาทเป็นข้อมูลลับสุด เปิดให้เฉพาะผู้บริหารระดับสูง (HQ) เท่านั้น หากต้องการสิทธิ์เข้าถึง กรุณาติดต่อ HR Manager</div>',
      '</div>',
    ].join('');
  }

  function populateFilters() {
    var sSel = $id('lg-filter-status');
    if (sSel && sSel.options.length <= 1) {
      (_lgData.statuses || []).forEach(function (s) {
        var o = document.createElement('option');
        o.value = s; o.textContent = lg2StatusLabel(s);
        sSel.appendChild(o);
      });
    }
    var tSel = $id('lg-filter-type');
    if (tSel && tSel.options.length <= 1) {
      (_lgData.types || []).forEach(function (t) {
        var o = document.createElement('option');
        o.value = t; o.textContent = t;
        tSel.appendChild(o);
      });
    }
  }

  function filteredRows() {
    var rows = (_lgData && _lgData.rows) ? _lgData.rows.slice() : [];
    var s = ($id('lg-filter-status') || {}).value || '';
    var t = ($id('lg-filter-type') || {}).value || '';
    var q = (($id('lg-filter-q') || {}).value || '').trim().toLowerCase();
    if (s) rows = rows.filter(function (r) { return r.status === s; });
    if (t) rows = rows.filter(function (r) { return r.case_type === t; });
    if (q) {
      rows = rows.filter(function (r) {
        return (r.title + ' ' + r.employee_name + ' ' + r.employee_id + ' ' + r.id + ' ' + r.court).toLowerCase().indexOf(q) >= 0;
      });
    }
    // เรียง: เปิดเมื่อล่าสุดก่อน
    rows.sort(function (a, b) { return String(b.opened_at || '').localeCompare(String(a.opened_at || '')); });
    return rows;
  }

  function renderAll() {
    var all = (_lgData && _lgData.rows) ? _lgData.rows : [];
    renderStats(all);
    var content = $id('lg-content');
    content.className = '';
    if (!all.length) { content.innerHTML = emptyState(); return; }
    var rows = filteredRows();
    if (!rows.length) {
      content.innerHTML = '<div class="empty"><div class="empty-title">ไม่มีคดีตามตัวกรอง</div><div class="empty-sub">ลองเปลี่ยนสถานะ/ประเภท หรือล้างคำค้น</div></div>';
      return;
    }
    content.innerHTML = renderTable(rows);
  }

  function renderStats(all) {
    all = all || [];
    var bucket = { open: 0, compiling: 0, ready: 0, closed: 0 };
    all.forEach(function (r) { var b = lg2StatusBucket(r.status); bucket[b] = (bucket[b] || 0) + 1; });
    var activeN = bucket.open + bucket.compiling + bucket.ready;
    var cards = [
      statCard('total', 'คดีทั้งหมด', fmtInt(all.length), (_lgData.types || []).length + ' ประเภท'),
      statCard('open', 'กำลังดำเนินอยู่', fmtInt(activeN), 'ยังไม่ปิด'),
      statCard('ready', 'พร้อมส่งทนาย/ยื่นฟ้อง', fmtInt(bucket.ready), 'รอดำเนินการ'),
      statCard('closed', 'ปิดคดีแล้ว', fmtInt(bucket.closed), 'เสร็จสิ้น'),
    ];
    $id('lg-stats').innerHTML = cards.join('');
    var sub = $id('lg-subtitle');
    if (sub) sub.textContent = 'รายการคดี/ข้อพิพาท ของพนักงาน (Legal Cases) · ลับสุด · ' + all.length + ' คดี';
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

  // เลือกคอลัมน์ตามที่มีข้อมูลจริง (defensive) — court/next_hearing โชว์เฉพาะถ้ามีบางแถว
  function activeCols(rows) {
    var hasCourt = rows.some(function (r) { return r.court; });
    var hasHearing = rows.some(function (r) { return r.next_hearing; });
    return { court: hasCourt, hearing: hasHearing };
  }

  function renderTable(rows) {
    var cols = activeCols(rows);
    var th = ['<th>คดี</th>', '<th>พนักงาน</th>', '<th>ประเภท</th>'];
    if (cols.court) th.push('<th>ศาล</th>');
    if (cols.hearing) th.push('<th>นัดถัดไป</th>');
    th.push('<th>สถานะ</th>', '<th>เปิดเมื่อ</th>');

    var body = rows.map(function (r) {
      var tds = [
        '<td class="case-cell">' + escapeHtml(r.title) + (r.id && r.id !== r.title ? '<br><span class="mono">' + escapeHtml(r.id) + '</span>' : '') + '</td>',
        '<td>' + escapeHtml(r.employee_name || '—') + (r.employee_id ? ' <span class="mono">' + escapeHtml(r.employee_id) + '</span>' : '') + '</td>',
        '<td>' + escapeHtml(r.case_type || '—') + '</td>',
      ];
      if (cols.court) tds.push('<td>' + escapeHtml(r.court || '—') + '</td>');
      if (cols.hearing) tds.push('<td><span class="mono">' + escapeHtml(r.next_hearing || '—') + '</span></td>');
      tds.push('<td>' + statusPill(r.status) + '</td>');
      tds.push('<td><span class="mono">' + escapeHtml(r.opened_at || '—') + '</span></td>');
      return '<tr onclick="lgOpenDetail(\'' + escapeHtml(r.id).replace(/'/g, '&#39;') + '\')">' + tds.join('') + '</tr>';
    }).join('');

    return [
      '<div class="sec-title">รายการคดี · เรียงเปิดล่าสุดก่อน (' + rows.length + ' คดี) · คลิกเพื่อดูรายละเอียด</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>' + th.join('') + '</tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '</table>',
      '</div>',
    ].join('');
  }

  function emptyState() {
    return [
      '<div class="empty">',
      '  <div class="empty-icon">' + ICON_SCALE + '</div>',
      '  <div class="empty-title">ยังไม่มีแฟ้มคดี</div>',
      '  <div class="empty-sub">เมื่อมีการเปิดคดี/ข้อพิพาท (legal.updated) ข้อมูลจะแสดงที่นี่</div>',
      '</div>',
    ].join('');
  }

  // ---- detail (read-only) ----
  function kv(label, val, full) {
    var v = (val == null || val === '') ? '—' : val;
    return '<div class="kv' + (full ? ' full' : '') + '"><div class="k">' + escapeHtml(label) + '</div><div class="v">' + escapeHtml(v) + '</div></div>';
  }
  function openDetail(id) {
    LG_BACKEND.lgDetail(id).then(function (r) {
      if (!r) { showToast('ไม่พบข้อมูลคดี', 'error'); return; }
      $id('lg-d-title').textContent = r.title || r.id || '—';
      $id('lg-d-sub').textContent = (r.id || '') + (r.case_type ? ' · ' + r.case_type : '');
      var parts = [
        '<div class="kv-grid">',
        kv('รหัสคดี', r.id),
        kv('ประเภทคดี', r.case_type),
        kv('สถานะ', lg2StatusLabel(r.status)),
        kv('พนักงาน', r.employee_name),
        kv('รหัสพนักงาน', r.employee_id),
        kv('สาขา', r.branch_id),
        kv('เปิดเมื่อ', r.opened_at),
        kv('นัดถัดไป', r.next_hearing),
        kv('ศาล', r.court),
        kv('โจทก์', r.plaintiff),
        kv('จำเลย', r.defendant),
      ];
      if (r.summary) parts.push(kv('สรุป/บันทึก', r.summary, true));
      parts.push('</div>');
      // หมายเหตุ read-only
      parts.push('<div class="disclaimer" style="margin:14px 0 0">หน้านี้อ่านอย่างเดียว · การแก้ไขแฟ้มคดีทำได้ที่ระบบ HR (Legal Case Manager) เท่านั้น</div>');
      $id('lg-d-body').innerHTML = parts.join('');
      $id('lg-detail-bg').classList.add('active');
    });
  }
  function closeDetail() { $id('lg-detail-bg').classList.remove('active'); }

  // ---- read-only write stub (ถ้ามี action เขียนในอนาคต ให้เด้ง toast) ----
  function lgWriteStub() { showToast('หน้านี้อ่านอย่างเดียว · แก้ไขที่ระบบ HR', 'error'); }

  function lgReload() { loadData(); }
  function lgRender() { renderAll(); }

  // init labels
  $id('lg-refresh-btn').innerHTML = ICON_REFRESH + ' รีเฟรช';

  // expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix lg* กันชน)
  window.lgReload = lgReload;
  window.lgRender = lgRender;
  window.lgOpenDetail = openDetail;
  window.lgCloseDetail = closeDetail;
  window.lgWriteStub = lgWriteStub;

  // init
  loadData();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountLegal) */
if (typeof window !== 'undefined') {
  window.mountLegal = mountLegal;
  window.LG_BACKEND = LG_BACKEND;
}
