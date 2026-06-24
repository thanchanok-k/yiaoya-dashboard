// _ported/fosales.js — Native read-only page "ยอดขายหน้าร้าน (Front Office)" สำหรับ Supabase dashboard
// ผู้บริหารดู — รายได้รายวัน/สาขา · อ่านอย่างเดียว (ไม่มี write)
//
// ทำตาม pattern เดียวกับ _ported/recruit.js + _ported/holiday.js:
//   - mountFosales render เข้า #wrap-fosales
//   - ใช้ global window.sb (index.html module scope) — ห้าม redeclare
//   - CSS scope ใต้ #fo · markup คง element id เดิม
//   - fn ที่ inline onclick ต้องใช้ → ผูกกับ window (prefix fo*) กันชน
//   - helper (esc/showToast) inline ใน scope
//
// backend (edge fn hr_list?type=fo.branch_daily.updated → {items}) :
//   READ  foList() → items แต่ละตัว = 1 วัน×สาขา
//         field: branch_day_id, date (YYYY-MM-DD), branch_id, revenue_total (บาท),
//                patients, new_patients, returning_patients, rebook_count
//   ข้อมูลจริงมาทีหลัง — ตอนนี้อาจว่าง → empty state สวย ไม่ error

/* ============================================================
   FO_BACKEND — ดึงข้อมูลจาก Supabase edge fn hr_list (type=fo.branch_daily.updated)
   คืน rows ที่ normalize แล้ว · กรอง/group ฝั่ง client
   ============================================================ */
var FO_FN = 'hr_list';
var FO_TYPE = 'fo.branch_daily.updated';
var FO_LIMIT = 2000;

function fo2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function fo2Num(v) {
  if (v == null || v === '') return 0;
  var n = Number(v);
  return isFinite(n) ? n : 0;
}
function fo2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// map payload event ดิบ → row shape ที่หน้านี้ใช้
function fo2MapRow(p) {
  p = p || {};
  var date = fo2Date(p.date || p.branch_day_date || p.day);
  var patients = fo2Num(p.patients);
  var newP = fo2Num(p.new_patients);
  var retP = fo2Num(p.returning_patients);
  // ถ้าไม่มี patients แต่มี new/returning → derive
  if (!patients && (newP || retP)) patients = newP + retP;
  return {
    branch_day_id: p.branch_day_id || p.entity_id || p.id || '',
    date: date,
    branch_id: p.branch_id || p.branch || 'BR01',
    branch_name: p.branch_name || p.branch || '',
    revenue_total: fo2Num(p.revenue_total),
    patients: patients,
    new_patients: newP,
    returning_patients: retP,
    rebook_count: fo2Num(p.rebook_count),
    _raw: p,
  };
}

// cache row ล่าสุดต่อ branch×day (backend ไม่มี endpoint แยก)
var _fo2Rows = [];

function fo2FetchRows() {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) {
    _fo2Rows = [];
    return Promise.resolve([]);
  }
  var q = FO_FN + '?type=' + encodeURIComponent(FO_TYPE) + '&limit=' + FO_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    var data = (res && res.data) || {};
    var items = fo2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var row = fo2MapRow(p);
      if (!row.date) return; // ไม่มีวันที่ → render ไม่ได้
      var key = row.branch_day_id || (row.date + '|' + row.branch_id);
      if (!key || seen[key]) return;
      seen[key] = true;
      if (!row.branch_day_id) row.branch_day_id = key;
      rows.push(row);
    });
    _fo2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[FO_BACKEND] list fetch failed', e);
    _fo2Rows = [];
    return [];
  });
}

var FO_BACKEND = {
  // list — { rows, months, branches } (ฝั่ง client กรองเอง)
  foList: function () {
    return fo2FetchRows().then(function (all) {
      // เดือนที่มีข้อมูล (YYYY-MM) เรียงใหม่→เก่า
      var mSeen = {}, months = [];
      var bSeen = {}, branches = [];
      all.forEach(function (r) {
        var mk = (r.date || '').slice(0, 7);
        if (mk && !mSeen[mk]) { mSeen[mk] = true; months.push(mk); }
        if (r.branch_id && !bSeen[r.branch_id]) {
          bSeen[r.branch_id] = true;
          branches.push({ id: r.branch_id, name: r.branch_name || r.branch_id });
        }
      });
      months.sort(function (a, b) { return b.localeCompare(a); });
      branches.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
      return { rows: all, months: months, branches: branches };
    });
  },
};

/* ============================================================
   mountFosales — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountFosales() {
  if (!document.getElementById('wrap-fosales')) return;
  var wrap = document.getElementById('wrap-fosales');
  wrap.innerHTML = '<style>' + FO_CSS() + '</style><div id="fo">' + FO_MARKUP() + '</div>';
  FO_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #fo (brand tokens เดียวกับหน้าอื่น) ===== */
function FO_CSS() {
  return [
    '#fo{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#fo *{box-sizing:border-box}',
    // page head
    '#fo .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#fo .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#fo .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#fo .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#fo .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // buttons
    '#fo .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#fo .btn:hover{border-color:var(--navy)}',
    '#fo .btn svg{width:14px;height:14px}',
    '#fo .btn-sm{padding:5px 10px;font-size:12px}',
    // read-only banner
    '#fo .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#fo .ro-banner strong{font-weight:600}',
    // stat cards
    '#fo .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#fo .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#fo .stats{grid-template-columns:repeat(2,1fr)}}',
    '#fo .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#fo .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#fo .stat-card.rev::before{background:#166534}',
    '#fo .stat-card.month::before{background:#1E40AF}',
    '#fo .stat-card.pt::before{background:#4338CA}',
    '#fo .stat-card.newp::before{background:#B45309}',
    '#fo .stat-card.rebook::before{background:#2BA89B}',
    '#fo .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#fo .stat-card .v{font-size:22px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#fo .stat-card.rev .v{color:#166534}',
    '#fo .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#fo .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#fo .filter{display:flex;flex-direction:column;gap:2px}',
    '#fo .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#fo .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#fo .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section title
    '#fo .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px}',
    // branch summary cards
    '#fo .branch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-bottom:14px}',
    '#fo .branch-card{background:#fff;border:1px solid var(--border);border-left:3px solid var(--teal);border-radius:8px;padding:12px 14px}',
    '#fo .branch-card .bid{font-size:12px;font-weight:700;color:var(--navy);font-family:"SF Mono",Consolas,monospace}',
    '#fo .branch-card .brev{font-size:18px;font-weight:600;color:#166534;margin-top:4px;letter-spacing:-.02em}',
    '#fo .branch-card .bmeta{font-size:11px;color:var(--text-muted);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap}',
    // data table
    '#fo .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#fo .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#fo .data-table th.num,#fo .data-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '#fo .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#fo .data-table tr:last-child td{border-bottom:0}',
    '#fo .data-table tr:hover td{background:#FAFBFC}',
    '#fo .data-table tfoot td{font-weight:700;background:#F8FAFC;border-top:2px solid var(--border-strong);color:var(--navy)}',
    '#fo .rev-cell{font-weight:600;color:#166534}',
    '#fo .bid-mono{font-family:"SF Mono",Consolas,monospace;font-size:11px}',
    '#fo .tag-new{display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;background:#FEF3C7;color:#92400E;font-weight:600;margin-left:4px}',
    '#fo .table-wrap{overflow-x:auto}',
    // empty / loading
    '#fo .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#fo .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#fo .empty-icon svg{width:24px;height:24px}',
    '#fo .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#fo .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#fo .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    '@media (max-width:768px){#fo .stats{grid-template-columns:repeat(2,1fr)}}',
  ].join('\n');
}

/* ===== markup · คง element id เดิม ===== */
function FO_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>',
    '      ยอดขายหน้าร้าน',
    '    </h1>',
    '    <div class="subtitle" id="fo-subtitle">รายได้รายวัน · แยกสาขา (Front Office)</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-sm" onclick="foReload()" id="fo-refresh-btn"></button>',
    '  </div>',
    '</header>',
    // read-only banner
    '<div class="ro-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#3DC5B7;display:inline-block"></span>',
    '  <span><strong>มุมมองผู้บริหาร:</strong> ข้อมูลรายได้/คนไข้รายวันต่อสาขา จากระบบหน้าร้าน · อ่านอย่างเดียว</span>',
    '</div>',
    '<div class="stats" id="fo-stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>เดือน</label>',
    '    <select id="fo-filter-month" onchange="foRender()"><option value="">ทุกเดือน</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>สาขา</label>',
    '    <select id="fo-filter-branch" onchange="foRender()"><option value="">ทุกสาขา</option></select>',
    '  </div>',
    '</div>',
    '<div id="fo-content" class="loading">กำลังโหลด...</div>',
  ].join('\n');
}

/* ============================================================
   FO_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function FO_RUN_PAGE_JS() {
  var _foRoot = document.getElementById('fo');
  function $id(id) { return _foRoot ? _foRoot.querySelector('#' + id) : document.getElementById(id); }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function showToast(msg, type) {
    var t = document.getElementById('fo2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'fo2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var ICON_CHART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>';

  var _foData = null; // { rows, months, branches }

  // ---- format helpers (กัน throw ถ้า null) ----
  function fmtBaht(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try {
      return '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    } catch (e) {
      return '฿' + String(Math.round(n));
    }
  }
  function fmtBahtFull(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try {
      return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' บาท';
    } catch (e) {
      return String(Math.round(n)) + ' บาท';
    }
  }
  function fmtInt(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try { return n.toLocaleString('th-TH'); } catch (e) { return String(Math.round(n)); }
  }
  function fmtPct(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    return (Math.round(n * 10) / 10) + '%';
  }
  function curMonthKey() {
    var d = new Date(); var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1);
  }

  // ---- load ----
  function loadData() {
    $id('fo-content').className = 'loading';
    $id('fo-content').innerHTML = 'กำลังโหลด...';
    FO_BACKEND.foList().then(function (res) {
      _foData = res || { rows: [], months: [], branches: [] };
      populateFilters();
      renderAll();
    }).catch(function (e) {
      console.error('[fosales] load failed', e);
      _foData = { rows: [], months: [], branches: [] };
      $id('fo-content').className = '';
      $id('fo-content').innerHTML = '<div class="empty"><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml((e && e.message) || 'unknown') + '</div></div>';
      renderStats([]);
    });
  }

  function populateFilters() {
    var mSel = $id('fo-filter-month');
    if (mSel && mSel.options.length <= 1) {
      (_foData.months || []).forEach(function (m) {
        var o = document.createElement('option');
        o.value = m; o.textContent = monthLabel(m);
        mSel.appendChild(o);
      });
    }
    var bSel = $id('fo-filter-branch');
    if (bSel && bSel.options.length <= 1) {
      (_foData.branches || []).forEach(function (b) {
        var o = document.createElement('option');
        o.value = b.id; o.textContent = b.id + (b.name && b.name !== b.id ? ' — ' + b.name : '');
        bSel.appendChild(o);
      });
    }
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

  // ---- filtered rows ----
  function filteredRows() {
    var rows = (_foData && _foData.rows) ? _foData.rows.slice() : [];
    var mSel = $id('fo-filter-month');
    var bSel = $id('fo-filter-branch');
    var m = mSel ? mSel.value : '';
    var b = bSel ? bSel.value : '';
    if (m) rows = rows.filter(function (r) { return (r.date || '').slice(0, 7) === m; });
    if (b) rows = rows.filter(function (r) { return r.branch_id === b; });
    rows.sort(function (a, b2) { return (b2.date || '').localeCompare(a.date || ''); }); // ล่าสุดก่อน
    return rows;
  }

  // ---- render ----
  function renderAll() {
    var all = (_foData && _foData.rows) ? _foData.rows : [];
    // stats ใช้ "ทั้งหมด" (ไม่ขึ้นกับ filter) เพื่อภาพรวมผู้บริหาร
    renderStats(all);

    var content = $id('fo-content');
    content.className = '';

    if (!all.length) {
      content.innerHTML = emptyState();
      return;
    }

    var rows = filteredRows();
    if (!rows.length) {
      content.innerHTML = '<div class="empty"><div class="empty-title">ไม่มีข้อมูลตามตัวกรอง</div><div class="empty-sub">ลองเปลี่ยนเดือน/สาขา</div></div>';
      return;
    }
    content.innerHTML = renderBranchSummary(rows) + renderTable(rows);
  }

  function renderStats(all) {
    all = all || [];
    var totalRev = 0, totalPt = 0, totalNew = 0, totalRebook = 0;
    var monthKey = curMonthKey();
    var monthRev = 0;
    all.forEach(function (r) {
      totalRev += Number(r.revenue_total) || 0;
      totalPt += Number(r.patients) || 0;
      totalNew += Number(r.new_patients) || 0;
      totalRebook += Number(r.rebook_count) || 0;
      if ((r.date || '').slice(0, 7) === monthKey) monthRev += Number(r.revenue_total) || 0;
    });
    var rebookPct = totalPt > 0 ? (totalRebook / totalPt) * 100 : 0;

    $id('fo-stats').innerHTML = [
      statCard('rev', 'รายได้รวมทั้งหมด', fmtBaht(totalRev), all.length + ' วัน×สาขา'),
      statCard('month', 'รายได้เดือนนี้', fmtBaht(monthRev), monthLabel(monthKey)),
      statCard('pt', 'จำนวนคนไข้รวม', fmtInt(totalPt), 'ทุกสาขา'),
      statCard('newp', 'คนไข้ใหม่', fmtInt(totalNew), 'สะสม'),
      statCard('rebook', '% Rebook', fmtPct(rebookPct), fmtInt(totalRebook) + ' rebook'),
    ].join('');

    var sub = $id('fo-subtitle');
    if (sub) sub.textContent = 'รายได้รายวัน · แยกสาขา (Front Office) · ' + all.length + ' รายการ';
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

  function renderBranchSummary(rows) {
    var grouped = {};
    rows.forEach(function (r) {
      var b = r.branch_id || '—';
      if (!grouped[b]) grouped[b] = { id: b, name: r.branch_name || b, rev: 0, pt: 0, days: 0, rebook: 0 };
      grouped[b].rev += Number(r.revenue_total) || 0;
      grouped[b].pt += Number(r.patients) || 0;
      grouped[b].rebook += Number(r.rebook_count) || 0;
      grouped[b].days += 1;
    });
    var list = Object.keys(grouped).map(function (k) { return grouped[k]; });
    list.sort(function (a, b) { return b.rev - a.rev; });
    if (!list.length) return '';
    var cards = list.map(function (g) {
      return [
        '<div class="branch-card">',
        '  <div class="bid">' + escapeHtml(g.id) + (g.name && g.name !== g.id ? ' · ' + escapeHtml(g.name) : '') + '</div>',
        '  <div class="brev">' + fmtBahtFull(g.rev) + '</div>',
        '  <div class="bmeta">',
        '    <span>คนไข้ ' + fmtInt(g.pt) + '</span>',
        '    <span>rebook ' + fmtInt(g.rebook) + '</span>',
        '    <span>' + g.days + ' วัน</span>',
        '  </div>',
        '</div>',
      ].join('');
    }).join('');
    return '<div class="sec-title">สรุปต่อสาขา</div><div class="branch-grid">' + cards + '</div>';
  }

  function renderTable(rows) {
    var totRev = 0, totPt = 0, totNew = 0, totRet = 0, totRebook = 0;
    var body = rows.map(function (r) {
      var rev = Number(r.revenue_total) || 0;
      var pt = Number(r.patients) || 0;
      var np = Number(r.new_patients) || 0;
      var rp = Number(r.returning_patients) || 0;
      var rb = Number(r.rebook_count) || 0;
      totRev += rev; totPt += pt; totNew += np; totRet += rp; totRebook += rb;
      return [
        '<tr>',
        '  <td>' + escapeHtml(r.date || '—') + '</td>',
        '  <td><span class="bid-mono">' + escapeHtml(r.branch_id || '—') + '</span></td>',
        '  <td class="num rev-cell">' + fmtInt(rev) + '</td>',
        '  <td class="num">' + fmtInt(pt) + '</td>',
        '  <td class="num">' + fmtInt(np) + (np ? '<span class="tag-new">ใหม่</span>' : '') + ' / ' + fmtInt(rp) + '</td>',
        '  <td class="num">' + fmtInt(rb) + '</td>',
        '</tr>',
      ].join('');
    }).join('');

    return [
      '<div class="sec-title">รายวัน · เรียงวันล่าสุดก่อน (' + rows.length + ' รายการ)</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>',
      '    <th>วันที่</th>',
      '    <th>สาขา</th>',
      '    <th class="num">รายได้ (฿)</th>',
      '    <th class="num">คนไข้</th>',
      '    <th class="num">ใหม่ / เก่า</th>',
      '    <th class="num">Rebook</th>',
      '  </tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '  <tfoot><tr>',
      '    <td colspan="2">รวม</td>',
      '    <td class="num">' + fmtInt(totRev) + '</td>',
      '    <td class="num">' + fmtInt(totPt) + '</td>',
      '    <td class="num">' + fmtInt(totNew) + ' / ' + fmtInt(totRet) + '</td>',
      '    <td class="num">' + fmtInt(totRebook) + '</td>',
      '  </tr></tfoot>',
      '</table>',
      '</div>',
    ].join('');
  }

  function emptyState() {
    return [
      '<div class="empty">',
      '  <div class="empty-icon">' + ICON_CHART + '</div>',
      '  <div class="empty-title">ยังไม่มีข้อมูลยอดขายหน้าร้าน</div>',
      '  <div class="empty-sub">เมื่อระบบหน้าร้านส่งยอดรายวันเข้ามา (fo.branch_daily.updated) ข้อมูลจะแสดงที่นี่</div>',
      '</div>',
    ].join('');
  }

  function foReload() { loadData(); }
  function foRender() { renderAll(); }

  // init labels
  $id('fo-refresh-btn').innerHTML = ICON_REFRESH + ' รีเฟรช';

  // expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix fo* กันชน)
  window.foReload = foReload;
  window.foRender = foRender;

  // init
  loadData();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountFosales) */
if (typeof window !== 'undefined') {
  window.mountFosales = mountFosales;
  window.FO_BACKEND = FO_BACKEND;
}
