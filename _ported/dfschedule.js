// _ported/dfschedule.js — Native read-only page "ตาราง DF หมอ (DF Schedule)" สำหรับ Supabase dashboard
// HR/ผู้บริหารดู — ตารางเวรหมอ (วัน/กะ/สาขา) · อ่านอย่างเดียว (ไม่มี write)
//
// ทำตาม pattern เดียวกับ _ported/scorecard.js + _ported/fosales.js:
//   - mountDfschedule render เข้า #wrap-dfschedule
//   - ใช้ global window.sb (index.html module scope) — ห้าม redeclare
//   - CSS scope ใต้ #df · markup คง element id เดิม
//   - fn ที่ inline onclick ต้องใช้ → ผูกกับ window (prefix df*) กันชน
//   - helper (esc/showToast) inline ใน scope
//
// backend (edge fn hr_list?type=df_schedule.updated → {items}) :
//   READ  dfList() → items แต่ละตัว = 1 รายการตารางเวร DF
//         **ไม่รู้ field แน่นอน** → defensive:
//           - ระบุ "หมอ" จาก doctor_name | doctor | employee_name | employee_id | name
//           - ระบุ "วันที่" จาก date | day | shift_date | work_date (YYYY-MM-DD)
//           - กะ จาก shift | day | period | slot
//           - สาขา จาก branch_id | branch | branch_name
//           - สถานะ จาก status | state
//         **อัตรา DF/เงิน ถูกตัดออกที่ sync แล้ว** → เน้นตารางเวร ไม่ใช่เงิน
//         ข้อมูลจริงมาทีหลัง — ตอนนี้อาจว่าง → empty state สวย ไม่ error

/* ============================================================
   DF_BACKEND — ดึงข้อมูลจาก Supabase edge fn hr_list (type=df_schedule.updated)
   คืน rows ที่ normalize แล้ว · กรอง/group ฝั่ง client
   ============================================================ */
var DF_FN = 'hr_list';
var DF_TYPE = 'df_schedule.updated';
var DF_LIMIT = 2000;

function df2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function df2Str(v) {
  if (v == null) return '';
  return String(v).trim();
}
function df2Date(v) {
  if (!v) return '';
  var s = String(v).trim();
  // already YYYY-MM-DD-ish
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  return s.slice(0, 10);
}

// map payload event ดิบ → row shape (defensive — เก็บเฉพาะ field ตารางเวร, ไม่มีเงิน)
function df2MapRow(p) {
  p = p || {};
  var doctor = df2Str(p.doctor_name || p.doctor || p.employee_name || p.name);
  var docId = df2Str(p.doctor_id || p.employee_id || p.id);
  if (!doctor) doctor = docId || '—';
  var date = df2Date(p.date || p.shift_date || p.work_date || p.day);
  // กะ/ช่วงเวลา: ระวัง p.day อาจถูกใช้เป็นวันที่ไปแล้ว — เลือก shift/period/slot ก่อน
  var shift = df2Str(p.shift || p.period || p.slot || p.shift_name || p.session);
  // ถ้า day ไม่ได้เป็นวันที่ (ไม่มี date จากที่อื่น) ให้ใช้ day เป็นกะ
  if (!shift && p.day && !df2Date(p.day).match(/^\d{4}-\d{2}-\d{2}$/)) shift = df2Str(p.day);
  return {
    id: df2Str(p.schedule_id || p.df_id || p.id || p.entity_id),
    doctor: doctor,
    doctor_id: docId,
    date: date,
    shift: shift,
    branch_id: df2Str(p.branch_id || p.branch),
    branch_name: df2Str(p.branch_name || p.branch),
    status: df2Str(p.status || p.state),
    _raw: p,
  };
}

// cache row ล่าสุด (backend ไม่มี endpoint แยก)
var _df2Rows = [];

function df2FetchRows() {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) {
    _df2Rows = [];
    return Promise.resolve([]);
  }
  var q = DF_FN + '?type=' + encodeURIComponent(DF_TYPE) + '&limit=' + DF_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    var data = (res && res.data) || {};
    var items = df2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var row = df2MapRow(p);
      var key = row.id || (row.doctor + '|' + row.date + '|' + row.shift + '|' + row.branch_id);
      if (!key || seen[key]) return;
      seen[key] = true;
      if (!row.id) row.id = key;
      rows.push(row);
    });
    _df2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[DF_BACKEND] list fetch failed', e);
    _df2Rows = [];
    return [];
  });
}

var DF_BACKEND = {
  // list — { rows, months, doctors, branches } (ฝั่ง client กรองเอง)
  dfList: function () {
    return df2FetchRows().then(function (all) {
      var mSeen = {}, months = [];
      var dSeen = {}, doctors = [];
      var bSeen = {}, branches = [];
      all.forEach(function (r) {
        var mk = (r.date || '').slice(0, 7);
        if (mk && !mSeen[mk]) { mSeen[mk] = true; months.push(mk); }
        if (r.doctor && !dSeen[r.doctor]) { dSeen[r.doctor] = true; doctors.push(r.doctor); }
        if (r.branch_id && !bSeen[r.branch_id]) {
          bSeen[r.branch_id] = true;
          branches.push({ id: r.branch_id, name: r.branch_name || r.branch_id });
        }
      });
      months.sort(function (a, b) { return String(b).localeCompare(String(a)); }); // ใหม่→เก่า
      doctors.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });
      branches.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
      return { rows: all, months: months, doctors: doctors, branches: branches };
    });
  },
};

/* ============================================================
   mountDfschedule — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountDfschedule() {
  if (!document.getElementById('wrap-dfschedule')) return;
  var wrap = document.getElementById('wrap-dfschedule');
  wrap.innerHTML = '<style>' + DF_CSS() + '</style><div id="df">' + DF_MARKUP() + '</div>';
  DF_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #df (brand tokens เดียวกับหน้าอื่น) ===== */
function DF_CSS() {
  return [
    '#df{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#df *{box-sizing:border-box}',
    // page head
    '#df .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#df .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#df .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#df .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#df .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // buttons
    '#df .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#df .btn:hover{border-color:var(--navy)}',
    '#df .btn svg{width:14px;height:14px}',
    '#df .btn-sm{padding:5px 10px;font-size:12px}',
    // read-only banner
    '#df .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#df .ro-banner strong{font-weight:600}',
    // stat cards
    '#df .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#df .stats{grid-template-columns:repeat(2,1fr)}}',
    '@media (max-width:600px){#df .stats{grid-template-columns:repeat(2,1fr)}}',
    '#df .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#df .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#df .stat-card.shifts::before{background:#4338CA}',
    '#df .stat-card.doc::before{background:#1E40AF}',
    '#df .stat-card.branch::before{background:#6D28D9}',
    '#df .stat-card.month::before{background:#166534}',
    '#df .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#df .stat-card .v{font-size:22px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#df .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#df .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#df .filter{display:flex;flex-direction:column;gap:2px}',
    '#df .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#df .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#df .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section title
    '#df .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px}',
    // summary cards
    '#df .sum-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:14px}',
    '#df .sum-card{background:#fff;border:1px solid var(--border);border-left:3px solid var(--teal);border-radius:8px;padding:12px 14px}',
    '#df .sum-card .sname{font-size:13px;font-weight:700;color:var(--navy)}',
    '#df .sum-card .scount{font-size:20px;font-weight:600;color:var(--navy-2);margin-top:4px;letter-spacing:-.02em}',
    '#df .sum-card .smeta{font-size:11px;color:var(--text-muted);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap}',
    // data table
    '#df .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#df .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);white-space:nowrap}',
    '#df .data-table th.num,#df .data-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '#df .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#df .data-table tr:last-child td{border-bottom:0}',
    '#df .data-table tr:hover td{background:#FAFBFC}',
    '#df .data-table tfoot td{font-weight:700;background:#F8FAFC;border-top:2px solid var(--border-strong);color:var(--navy)}',
    '#df .doc-cell{font-weight:600;color:var(--navy)}',
    '#df .mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text-muted)}',
    '#df .bid-mono{font-family:"SF Mono",Consolas,monospace;font-size:11px}',
    '#df .badge{display:inline-block;font-size:10px;padding:1px 8px;border-radius:8px;background:#E2E8F0;color:#334155;font-weight:600}',
    '#df .badge.st-ok{background:#D1FAE5;color:#065F46}',
    '#df .badge.st-warn{background:#FEF3C7;color:#92400E}',
    '#df .badge.st-cancel{background:#FEE2E2;color:#991B1B}',
    '#df .table-wrap{overflow-x:auto}',
    // empty / loading
    '#df .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#df .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#df .empty-icon svg{width:24px;height:24px}',
    '#df .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#df .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#df .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    '@media (max-width:768px){#df .stats{grid-template-columns:repeat(2,1fr)}}',
  ].join('\n');
}

/* ===== markup · คง element id เดิม ===== */
function DF_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',
    '      ตาราง DF หมอ',
    '    </h1>',
    '    <div class="subtitle" id="df-subtitle">ตารางเวรหมอ · วัน/กะ/สาขา (DF Schedule)</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-sm" onclick="dfReload()" id="df-refresh-btn"></button>',
    '  </div>',
    '</header>',
    // read-only banner
    '<div class="ro-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#3DC5B7;display:inline-block"></span>',
    '  <span><strong>มุมมอง HR/ผู้บริหาร:</strong> ตารางเวรหมอ แยกตามวัน/กะ/สาขา · อ่านอย่างเดียว (ไม่แสดงอัตรา DF/เงิน)</span>',
    '</div>',
    '<div class="stats" id="df-stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>เดือน</label>',
    '    <select id="df-filter-month" onchange="dfRender()"><option value="">ทุกเดือน</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>หมอ</label>',
    '    <select id="df-filter-doctor" onchange="dfRender()"><option value="">ทุกคน</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>สาขา</label>',
    '    <select id="df-filter-branch" onchange="dfRender()"><option value="">ทุกสาขา</option></select>',
    '  </div>',
    '</div>',
    '<div id="df-content" class="loading">กำลังโหลด...</div>',
  ].join('\n');
}

/* ============================================================
   DF_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function DF_RUN_PAGE_JS() {
  var _dfRoot = document.getElementById('df');
  function $id(id) { return _dfRoot ? _dfRoot.querySelector('#' + id) : document.getElementById(id); }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function showToast(msg, type) {
    var t = document.getElementById('df2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'df2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>';

  var _dfData = null; // { rows, months, doctors, branches }

  // ---- format helpers (กัน throw ถ้า null) ----
  function fmtInt(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try { return n.toLocaleString('th-TH'); } catch (e) { return String(Math.round(n)); }
  }
  function monthLabel(mk) {
    if (!mk) return '';
    var parts = String(mk).split('-');
    if (parts.length < 2) return mk;
    var names = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    var mi = parseInt(parts[1], 10);
    var yr = parseInt(parts[0], 10) + 543; // พ.ศ.
    return (names[mi] || parts[1]) + ' ' + yr;
  }
  function curMonthKey() {
    var d = new Date(); var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1);
  }
  // class ของ badge สถานะ (เดาแบบ defensive จากคำในสถานะ)
  function statusClass(s) {
    var k = String(s || '').toLowerCase();
    if (!k) return 'badge';
    if (/cancel|ยกเลิก|off|ลา|absent/.test(k)) return 'badge st-cancel';
    if (/pending|รอ|tentative|draft|ร่าง/.test(k)) return 'badge st-warn';
    if (/confirm|ยืนยัน|active|ok|approved|อนุมัติ|scheduled|เวร/.test(k)) return 'badge st-ok';
    return 'badge';
  }

  // ---- load ----
  function loadData() {
    $id('df-content').className = 'loading';
    $id('df-content').innerHTML = 'กำลังโหลด...';
    DF_BACKEND.dfList().then(function (res) {
      _dfData = res || { rows: [], months: [], doctors: [], branches: [] };
      populateFilters();
      renderAll();
    }).catch(function (e) {
      console.error('[dfschedule] load failed', e);
      _dfData = { rows: [], months: [], doctors: [], branches: [] };
      $id('df-content').className = '';
      $id('df-content').innerHTML = '<div class="empty"><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml((e && e.message) || 'unknown') + '</div></div>';
      renderStats([]);
    });
  }

  function populateFilters() {
    var mSel = $id('df-filter-month');
    if (mSel && mSel.options.length <= 1) {
      (_dfData.months || []).forEach(function (m) {
        var o = document.createElement('option');
        o.value = m; o.textContent = monthLabel(m);
        mSel.appendChild(o);
      });
    }
    var dSel = $id('df-filter-doctor');
    if (dSel && dSel.options.length <= 1) {
      (_dfData.doctors || []).forEach(function (d) {
        var o = document.createElement('option');
        o.value = d; o.textContent = d;
        dSel.appendChild(o);
      });
    }
    var bSel = $id('df-filter-branch');
    if (bSel && bSel.options.length <= 1) {
      (_dfData.branches || []).forEach(function (b) {
        var o = document.createElement('option');
        o.value = b.id; o.textContent = b.id + (b.name && b.name !== b.id ? ' — ' + b.name : '');
        bSel.appendChild(o);
      });
    }
  }

  // ---- filtered rows ----
  function filteredRows() {
    var rows = (_dfData && _dfData.rows) ? _dfData.rows.slice() : [];
    var mSel = $id('df-filter-month');
    var dSel = $id('df-filter-doctor');
    var bSel = $id('df-filter-branch');
    var m = mSel ? mSel.value : '';
    var d = dSel ? dSel.value : '';
    var b = bSel ? bSel.value : '';
    if (m) rows = rows.filter(function (r) { return (r.date || '').slice(0, 7) === m; });
    if (d) rows = rows.filter(function (r) { return r.doctor === d; });
    if (b) rows = rows.filter(function (r) { return r.branch_id === b; });
    // เรียง: วันล่าสุดก่อน, แล้วชื่อหมอ
    rows.sort(function (a, b2) {
      var dc = String(b2.date || '').localeCompare(String(a.date || ''));
      if (dc !== 0) return dc;
      return String(a.doctor || '').localeCompare(String(b2.doctor || ''), 'th');
    });
    return rows;
  }

  // ---- render ----
  function renderAll() {
    var all = (_dfData && _dfData.rows) ? _dfData.rows : [];
    renderStats(all);

    var content = $id('df-content');
    content.className = '';

    if (!all.length) {
      content.innerHTML = emptyState();
      return;
    }

    var rows = filteredRows();
    if (!rows.length) {
      content.innerHTML = '<div class="empty"><div class="empty-title">ไม่มีข้อมูลตามตัวกรอง</div><div class="empty-sub">ลองเปลี่ยนเดือน/หมอ/สาขา</div></div>';
      return;
    }
    content.innerHTML = renderDoctorSummary(rows) + renderBranchSummary(rows) + renderTable(rows);
  }

  function renderStats(all) {
    all = all || [];
    var dSeen = {}, bSeen = {}, mSeen = {};
    var monthKey = curMonthKey();
    var monthShifts = 0;
    all.forEach(function (r) {
      if (r.doctor) dSeen[r.doctor] = true;
      if (r.branch_id) bSeen[r.branch_id] = true;
      var mk = (r.date || '').slice(0, 7);
      if (mk) mSeen[mk] = true;
      if (mk === monthKey) monthShifts++;
    });
    var docN = Object.keys(dSeen).length;
    var brN = Object.keys(bSeen).length;
    var moN = Object.keys(mSeen).length;

    $id('df-stats').innerHTML = [
      statCard('shifts', 'เวรทั้งหมด', fmtInt(all.length), moN + ' เดือน'),
      statCard('doc', 'จำนวนหมอ', fmtInt(docN), 'มีตารางเวร'),
      statCard('branch', 'จำนวนสาขา', fmtInt(brN), 'มีเวร'),
      statCard('month', 'เวรเดือนนี้', fmtInt(monthShifts), monthLabel(monthKey)),
    ].join('');

    var sub = $id('df-subtitle');
    if (sub) sub.textContent = 'ตารางเวรหมอ · วัน/กะ/สาขา (DF Schedule) · ' + all.length + ' รายการ';
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

  function renderDoctorSummary(rows) {
    var grouped = {};
    rows.forEach(function (r) {
      var d = r.doctor || '—';
      if (!grouped[d]) grouped[d] = { name: d, cnt: 0, days: {}, branches: {} };
      grouped[d].cnt++;
      if (r.date) grouped[d].days[r.date] = true;
      if (r.branch_id) grouped[d].branches[r.branch_id] = true;
    });
    var list = Object.keys(grouped).map(function (k) {
      var g = grouped[k];
      g.dayN = Object.keys(g.days).length;
      g.brN = Object.keys(g.branches).length;
      return g;
    });
    list.sort(function (a, b) { return b.cnt - a.cnt; });
    if (!list.length) return '';
    var cards = list.map(function (g) {
      return [
        '<div class="sum-card">',
        '  <div class="sname">' + escapeHtml(g.name) + '</div>',
        '  <div class="scount">' + fmtInt(g.cnt) + ' เวร</div>',
        '  <div class="smeta">',
        '    <span>' + fmtInt(g.dayN) + ' วัน</span>',
        '    <span>' + fmtInt(g.brN) + ' สาขา</span>',
        '  </div>',
        '</div>',
      ].join('');
    }).join('');
    return '<div class="sec-title">สรุปต่อหมอ · เรียงจำนวนเวรมากสุด</div><div class="sum-grid">' + cards + '</div>';
  }

  function renderBranchSummary(rows) {
    var grouped = {};
    rows.forEach(function (r) {
      var b = r.branch_id || '—';
      if (!grouped[b]) grouped[b] = { id: b, name: r.branch_name || b, cnt: 0, doctors: {} };
      grouped[b].cnt++;
      if (r.doctor) grouped[b].doctors[r.doctor] = true;
    });
    var list = Object.keys(grouped).map(function (k) {
      var g = grouped[k];
      g.docN = Object.keys(g.doctors).length;
      return g;
    });
    // ถ้ามีสาขาเดียว ข้ามการ์ดสรุปสาขา (ไม่มีประโยชน์)
    if (list.length <= 1) return '';
    list.sort(function (a, b) { return b.cnt - a.cnt; });
    var cards = list.map(function (g) {
      return [
        '<div class="sum-card">',
        '  <div class="sname"><span class="bid-mono">' + escapeHtml(g.id) + '</span>' + (g.name && g.name !== g.id ? ' · ' + escapeHtml(g.name) : '') + '</div>',
        '  <div class="scount">' + fmtInt(g.cnt) + ' เวร</div>',
        '  <div class="smeta">',
        '    <span>' + fmtInt(g.docN) + ' หมอ</span>',
        '  </div>',
        '</div>',
      ].join('');
    }).join('');
    return '<div class="sec-title">สรุปต่อสาขา</div><div class="sum-grid">' + cards + '</div>';
  }

  function renderTable(rows) {
    // ตรวจว่ามี field กะ/สถานะจริงไหม → แสดงคอลัมน์เฉพาะที่มีข้อมูล
    var hasShift = rows.some(function (r) { return r.shift; });
    var hasStatus = rows.some(function (r) { return r.status; });
    var hasBranch = rows.some(function (r) { return r.branch_id; });

    var th = ['<th>วันที่</th>', '<th>หมอ</th>'];
    if (hasBranch) th.push('<th>สาขา</th>');
    if (hasShift) th.push('<th>กะ/ช่วง</th>');
    if (hasStatus) th.push('<th>สถานะ</th>');

    var body = rows.map(function (r) {
      var tds = [
        '<td><span class="mono">' + escapeHtml(r.date || '—') + '</span></td>',
        '<td class="doc-cell">' + escapeHtml(r.doctor || '—') + (r.doctor_id && r.doctor_id !== r.doctor ? ' <span class="mono">' + escapeHtml(r.doctor_id) + '</span>' : '') + '</td>',
      ];
      if (hasBranch) tds.push('<td><span class="bid-mono">' + escapeHtml(r.branch_id || '—') + '</span></td>');
      if (hasShift) tds.push('<td>' + (r.shift ? escapeHtml(r.shift) : '—') + '</td>');
      if (hasStatus) tds.push('<td>' + (r.status ? '<span class="' + statusClass(r.status) + '">' + escapeHtml(r.status) + '</span>' : '—') + '</td>');
      return '<tr>' + tds.join('') + '</tr>';
    }).join('');

    return [
      '<div class="sec-title">รายการเวร · เรียงวันล่าสุดก่อน (' + rows.length + ' รายการ)</div>',
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
      '  <div class="empty-icon">' + ICON_CAL + '</div>',
      '  <div class="empty-title">ยังไม่มีข้อมูลตาราง DF หมอ</div>',
      '  <div class="empty-sub">เมื่อระบบส่งตารางเวรหมอเข้ามา (df_schedule.updated) ข้อมูลจะแสดงที่นี่</div>',
      '</div>',
    ].join('');
  }

  function dfReload() { loadData(); }
  function dfRender() { renderAll(); }

  // init labels
  $id('df-refresh-btn').innerHTML = ICON_REFRESH + ' รีเฟรช';

  // expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix df* กันชน)
  window.dfReload = dfReload;
  window.dfRender = dfRender;

  // init
  loadData();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountDfschedule) */
if (typeof window !== 'undefined') {
  window.mountDfschedule = mountDfschedule;
  window.DF_BACKEND = DF_BACKEND;
}
