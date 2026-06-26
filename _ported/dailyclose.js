// _ported/dailyclose.js — Native read-only page "ยอดปิดจบวัน (Daily Close — รายวัน)" สำหรับ Supabase dashboard
// กลุ่มผู้บริหาร/บัญชี ดู — drill-down รายวัน/สาขา · อ่านอย่างเดียว (ไม่มี write)
//
// ทำตาม pattern เดียวกับ _ported/fosales.js (data source เดียวกัน):
//   - mountDailyclose render เข้า #wrap-dailyclose
//   - ใช้ global window.sb (index.html module scope) — ห้าม redeclare
//   - CSS scope ใต้ #dc · prefix dc* · helper (esc/$) inline ใน scope
//   - fn ที่ inline onclick ต้องใช้ → ผูกกับ window (prefix dc*) กันชน
//
// backend (edge fn hr_list?type=fo.branch_daily.updated → {items}) :
//   READ  dcList() → items แต่ละตัว = 1 วัน×สาขา
//         field จริง: date (YYYY-MM-DD), branch_id, revenue_total (บาท),
//                     patients, new_patients, rebook_count, branch_day_id, synced_at
//   ข้อมูลจริงมาทีหลัง — ตอนนี้อาจว่าง → empty state สวย ไม่ error

/* ============================================================
   DC_BACKEND — ดึงข้อมูลจาก Supabase edge fn hr_list (type=fo.branch_daily.updated)
   คืน rows ที่ normalize แล้ว · กรอง/group ฝั่ง client
   ============================================================ */
var DC_FN = 'hr_list';
var DC_TYPE = 'fo.branch_daily.updated';
var DC_LIMIT = 2000;

// map ชื่อสาขา (ถ้า payload ไม่ส่ง branch_name มา)
var DC_BRANCH_NAMES = { BR01: 'ศาลายา' };

function dc2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function dc2Num(v) {
  if (v == null || v === '') return 0;
  var n = Number(v);
  return isFinite(n) ? n : 0;
}
function dc2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// map payload event ดิบ → row shape ที่หน้านี้ใช้
function dc2MapRow(p) {
  p = p || {};
  var date = dc2Date(p.date || p.branch_day_date || p.day);
  var patients = dc2Num(p.patients);
  var newP = dc2Num(p.new_patients);
  if (!patients && newP) patients = newP; // กันกรณีมีแต่ใหม่
  var bid = p.branch_id || p.branch || 'BR01';
  return {
    branch_day_id: p.branch_day_id || p.entity_id || p.id || '',
    date: date,
    branch_id: bid,
    branch_name: p.branch_name || DC_BRANCH_NAMES[bid] || '',
    revenue_total: dc2Num(p.revenue_total),
    patients: patients,
    new_patients: newP,
    rebook_count: dc2Num(p.rebook_count),
    synced_at: p.synced_at || '',
    _raw: p,
  };
}

var _dc2Rows = [];

function dc2FetchRows() {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) {
    _dc2Rows = [];
    return Promise.resolve([]);
  }
  var q = DC_FN + '?type=' + encodeURIComponent(DC_TYPE) + '&limit=' + DC_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    var data = (res && res.data) || {};
    var items = dc2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var row = dc2MapRow(p);
      if (!row.date) return; // ไม่มีวันที่ → render ไม่ได้
      var key = row.branch_day_id || (row.date + '|' + row.branch_id);
      if (!key || seen[key]) return;
      seen[key] = true;
      if (!row.branch_day_id) row.branch_day_id = key;
      rows.push(row);
    });
    _dc2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[DC_BACKEND] list fetch failed', e);
    _dc2Rows = [];
    return [];
  });
}

var DC_BACKEND = {
  // list — { rows, branches } (ฝั่ง client กรองเอง)
  dcList: function () {
    return dc2FetchRows().then(function (all) {
      var bSeen = {}, branches = [];
      all.forEach(function (r) {
        if (r.branch_id && !bSeen[r.branch_id]) {
          bSeen[r.branch_id] = true;
          branches.push({ id: r.branch_id, name: r.branch_name || r.branch_id });
        }
      });
      branches.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
      return { rows: all, branches: branches };
    });
  },
};

/* ============================================================
   mountDailyclose — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountDailyclose() {
  if (!document.getElementById('wrap-dailyclose')) return;
  var wrap = document.getElementById('wrap-dailyclose');
  wrap.innerHTML = '<style>' + DC_CSS() + '</style><div id="dc">' + DC_MARKUP() + '</div>';
  DC_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #dc (brand tokens เดียวกับหน้าอื่น) ===== */
function DC_CSS() {
  return [
    '#dc{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#dc *{box-sizing:border-box}',
    // page head
    '#dc .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#dc .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#dc .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#dc .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#dc .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // buttons
    '#dc .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#dc .btn:hover{border-color:var(--navy)}',
    '#dc .btn svg{width:14px;height:14px}',
    '#dc .btn-sm{padding:5px 10px;font-size:12px}',
    // read-only banner
    '#dc .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#dc .ro-banner strong{font-weight:600}',
    // stat cards
    '#dc .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#dc .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#dc .stats{grid-template-columns:repeat(2,1fr)}}',
    '#dc .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#dc .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#dc .stat-card.rev::before{background:#166534}',
    '#dc .stat-card.days::before{background:#1E40AF}',
    '#dc .stat-card.avg::before{background:#0E7490}',
    '#dc .stat-card.pt::before{background:#4338CA}',
    '#dc .stat-card.newp::before{background:#B45309}',
    '#dc .stat-card.rebook::before{background:#2BA89B}',
    '#dc .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#dc .stat-card .v{font-size:21px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#dc .stat-card.rev .v{color:#166534}',
    '#dc .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#dc .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#dc .filter{display:flex;flex-direction:column;gap:2px}',
    '#dc .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#dc .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#dc .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section title
    '#dc .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px}',
    // bar chart (pure div)
    '#dc .chart{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 14px 8px;margin-bottom:14px}',
    '#dc .chart-bars{display:flex;align-items:flex-end;gap:3px;height:150px;overflow-x:auto;padding-bottom:4px}',
    '#dc .chart-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;flex:1 0 18px;min-width:18px;height:100%}',
    '#dc .chart-bar{width:100%;max-width:28px;background:linear-gradient(180deg,#3DC5B7 0%,#2BA89B 100%);border-radius:3px 3px 0 0;min-height:2px;transition:opacity .15s;cursor:default}',
    '#dc .chart-bar:hover{opacity:.78}',
    '#dc .chart-xlabel{font-size:9px;color:var(--text-faint);margin-top:4px;white-space:nowrap;transform:rotate(-45deg);transform-origin:center;height:22px;line-height:1}',
    '#dc .chart-cap{font-size:10px;color:var(--text-muted);margin-top:8px;text-align:right}',
    // data table
    '#dc .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#dc .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#dc .data-table th.num,#dc .data-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '#dc .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#dc .data-table tr:last-child td{border-bottom:0}',
    '#dc .data-table tr:hover td{background:#FAFBFC}',
    '#dc .data-table tfoot td{font-weight:700;background:#F8FAFC;border-top:2px solid var(--border-strong);color:var(--navy)}',
    '#dc .rev-cell{font-weight:600;color:#166534}',
    '#dc .bid-mono{font-family:"SF Mono",Consolas,monospace;font-size:11px}',
    '#dc .tag-new{display:inline-block;font-size:10px;padding:1px 6px;border-radius:8px;background:#FEF3C7;color:#92400E;font-weight:600;margin-left:4px}',
    '#dc .table-wrap{overflow-x:auto}',
    // empty / loading
    '#dc .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#dc .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#dc .empty-icon svg{width:24px;height:24px}',
    '#dc .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#dc .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#dc .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
  ].join('\n');
}

/* ===== markup ===== */
function DC_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7"/><rect x="12" y="6" width="3" height="11"/><rect x="17" y="13" width="3" height="4"/></svg>',
    '      ยอดปิดจบวัน',
    '    </h1>',
    '    <div class="subtitle" id="dc-subtitle">drill-down รายวัน · แยกสาขา (Daily Close)</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-sm" onclick="dcReload()" id="dc-refresh-btn"></button>',
    '  </div>',
    '</header>',
    // read-only banner
    '<div class="ro-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#3DC5B7;display:inline-block"></span>',
    '  <span><strong>ผู้บริหาร/บัญชี:</strong> ยอดปิดจบรายวันต่อสาขา · drill-down · อ่านอย่างเดียว</span>',
    '</div>',
    '<div class="stats" id="dc-stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ช่วงวันที่</label>',
    '    <select id="dc-filter-range" onchange="dcRender()">',
    '      <option value="month">เดือนนี้</option>',
    '      <option value="30">30 วันล่าสุด</option>',
    '      <option value="all">ทั้งหมด</option>',
    '    </select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>สาขา</label>',
    '    <select id="dc-filter-branch" onchange="dcRender()"><option value="">ทุกสาขา</option></select>',
    '  </div>',
    '</div>',
    '<div id="dc-content" class="loading">กำลังโหลด...</div>',
  ].join('\n');
}

/* ============================================================
   DC_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function DC_RUN_PAGE_JS() {
  var _dcRoot = document.getElementById('dc');
  function $id(id) { return _dcRoot ? _dcRoot.querySelector('#' + id) : document.getElementById(id); }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var ICON_CHART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7"/><rect x="12" y="6" width="3" height="11"/><rect x="17" y="13" width="3" height="4"/></svg>';

  var _dcData = null; // { rows, branches }

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
  function curMonthKey() {
    var d = new Date(); var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1);
  }
  function todayMinus(days) {
    var d = new Date(); d.setDate(d.getDate() - days);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function shortDate(ds) {
    // YYYY-MM-DD → DD/MM
    var parts = String(ds || '').split('-');
    if (parts.length < 3) return ds || '';
    return parts[2] + '/' + parts[1];
  }

  // ---- load ----
  function loadData() {
    $id('dc-content').className = 'loading';
    $id('dc-content').innerHTML = 'กำลังโหลด...';
    DC_BACKEND.dcList().then(function (res) {
      _dcData = res || { rows: [], branches: [] };
      populateFilters();
      renderAll();
    }).catch(function (e) {
      console.error('[dailyclose] load failed', e);
      _dcData = { rows: [], branches: [] };
      $id('dc-content').className = '';
      $id('dc-content').innerHTML = '<div class="empty"><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml((e && e.message) || 'unknown') + '</div></div>';
      renderStats([]);
    });
  }

  function populateFilters() {
    var bSel = $id('dc-filter-branch');
    if (bSel && bSel.options.length <= 1) {
      (_dcData.branches || []).forEach(function (b) {
        var o = document.createElement('option');
        o.value = b.id; o.textContent = b.id + (b.name && b.name !== b.id ? ' — ' + b.name : '');
        bSel.appendChild(o);
      });
    }
  }

  // ---- filtered rows ----
  function filteredRows() {
    var rows = (_dcData && _dcData.rows) ? _dcData.rows.slice() : [];
    var rSel = $id('dc-filter-range');
    var bSel = $id('dc-filter-branch');
    var range = rSel ? rSel.value : 'month';
    var b = bSel ? bSel.value : '';
    if (range === 'month') {
      var mk = curMonthKey();
      rows = rows.filter(function (r) { return (r.date || '').slice(0, 7) === mk; });
    } else if (range === '30') {
      var cutoff = todayMinus(30);
      rows = rows.filter(function (r) { return (r.date || '') >= cutoff; });
    } // 'all' → ไม่กรอง
    if (b) rows = rows.filter(function (r) { return r.branch_id === b; });
    rows.sort(function (a, b2) { return (b2.date || '').localeCompare(a.date || ''); }); // ล่าสุดก่อน
    return rows;
  }

  function rangeLabel() {
    var rSel = $id('dc-filter-range');
    var range = rSel ? rSel.value : 'month';
    if (range === 'month') return 'เดือนนี้';
    if (range === '30') return '30 วันล่าสุด';
    return 'ทั้งหมด';
  }

  // ---- render ----
  function renderAll() {
    var content = $id('dc-content');
    content.className = '';

    var rows = filteredRows();
    renderStats(rows); // การ์ดสรุป = ตาม "ช่วงที่เลือก"

    var allRows = (_dcData && _dcData.rows) ? _dcData.rows : [];
    if (!allRows.length) {
      content.innerHTML = emptyState();
      return;
    }
    if (!rows.length) {
      content.innerHTML = '<div class="empty"><div class="empty-title">ไม่มีข้อมูลตามตัวกรอง</div><div class="empty-sub">ลองเปลี่ยนช่วงวันที่/สาขา</div></div>';
      return;
    }
    content.innerHTML = renderChart(rows) + renderTable(rows);
  }

  function renderStats(rows) {
    rows = rows || [];
    var totalRev = 0, totalPt = 0, totalNew = 0, totalRebook = 0;
    var dateSet = {};
    rows.forEach(function (r) {
      totalRev += Number(r.revenue_total) || 0;
      totalPt += Number(r.patients) || 0;
      totalNew += Number(r.new_patients) || 0;
      totalRebook += Number(r.rebook_count) || 0;
      if (r.date) dateSet[r.date] = true;
    });
    var numDays = Object.keys(dateSet).length;
    var avgPerDay = numDays > 0 ? totalRev / numDays : 0;

    $id('dc-stats').innerHTML = [
      statCard('rev', 'ยอดรวมช่วงที่เลือก', fmtBaht(totalRev), rangeLabel()),
      statCard('days', 'จำนวนวัน', fmtInt(numDays), 'วันที่มีข้อมูล'),
      statCard('avg', 'เฉลี่ย/วัน', fmtBaht(avgPerDay), 'รายได้ต่อวัน'),
      statCard('pt', 'คนไข้รวม', fmtInt(totalPt), 'ในช่วง'),
      statCard('newp', 'คนไข้ใหม่รวม', fmtInt(totalNew), 'ในช่วง'),
      statCard('rebook', 'Rebook รวม', fmtInt(totalRebook), 'ในช่วง'),
    ].join('');

    var sub = $id('dc-subtitle');
    if (sub) sub.textContent = 'drill-down รายวัน · แยกสาขา (Daily Close) · ' + rows.length + ' รายการ';
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

  // กราฟแท่ง: ยอดต่อวัน (รวมทุกสาขาในช่วง) · div bars · เรียงเก่า→ใหม่ (ซ้าย→ขวา)
  function renderChart(rows) {
    var byDay = {};
    rows.forEach(function (r) {
      var d = r.date || '';
      if (!d) return;
      byDay[d] = (byDay[d] || 0) + (Number(r.revenue_total) || 0);
    });
    var days = Object.keys(byDay).sort(); // เก่า→ใหม่
    if (!days.length) return '';
    var maxRev = 0;
    days.forEach(function (d) { if (byDay[d] > maxRev) maxRev = byDay[d]; });
    if (maxRev <= 0) maxRev = 1;

    // จำกัดจำนวนแท่งกันยาวเกิน (เอา 60 วันล่าสุด)
    if (days.length > 60) days = days.slice(days.length - 60);

    var bars = days.map(function (d) {
      var rev = byDay[d];
      var hPct = Math.max(2, Math.round((rev / maxRev) * 100));
      var title = shortDate(d) + ' · ' + fmtBahtFull(rev);
      return [
        '<div class="chart-col">',
        '  <div class="chart-bar" style="height:' + hPct + '%" title="' + escapeHtml(title) + '"></div>',
        '  <div class="chart-xlabel">' + escapeHtml(shortDate(d)) + '</div>',
        '</div>',
      ].join('');
    }).join('');

    return [
      '<div class="sec-title">ยอดขายต่อวัน</div>',
      '<div class="chart">',
      '  <div class="chart-bars">' + bars + '</div>',
      '  <div class="chart-cap">สูงสุด ' + fmtBahtFull(maxRev) + ' · ' + days.length + ' วัน</div>',
      '</div>',
    ].join('');
  }

  function renderTable(rows) {
    var totRev = 0, totPt = 0, totNew = 0, totRebook = 0;
    var body = rows.map(function (r) {
      var rev = Number(r.revenue_total) || 0;
      var pt = Number(r.patients) || 0;
      var np = Number(r.new_patients) || 0;
      var rb = Number(r.rebook_count) || 0;
      var avgPer = pt > 0 ? rev / pt : 0;
      totRev += rev; totPt += pt; totNew += np; totRebook += rb;
      var bname = r.branch_name && r.branch_name !== r.branch_id ? ' · ' + escapeHtml(r.branch_name) : '';
      return [
        '<tr>',
        '  <td>' + escapeHtml(r.date || '—') + '</td>',
        '  <td><span class="bid-mono">' + escapeHtml(r.branch_id || '—') + '</span>' + bname + '</td>',
        '  <td class="num rev-cell">' + fmtInt(rev) + '</td>',
        '  <td class="num">' + fmtInt(pt) + '</td>',
        '  <td class="num">' + fmtInt(np) + (np ? '<span class="tag-new">ใหม่</span>' : '') + '</td>',
        '  <td class="num">' + fmtInt(rb) + '</td>',
        '  <td class="num">' + fmtInt(Math.round(avgPer)) + '</td>',
        '</tr>',
      ].join('');
    }).join('');

    var totAvgPer = totPt > 0 ? totRev / totPt : 0;

    return [
      '<div class="sec-title">รายวัน · เรียงวันล่าสุดก่อน (' + rows.length + ' รายการ)</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>',
      '    <th>วันที่</th>',
      '    <th>สาขา</th>',
      '    <th class="num">ยอดขาย (฿)</th>',
      '    <th class="num">คนไข้</th>',
      '    <th class="num">ใหม่</th>',
      '    <th class="num">Rebook</th>',
      '    <th class="num">เฉลี่ย/คน (฿)</th>',
      '  </tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '  <tfoot><tr>',
      '    <td colspan="2">รวม</td>',
      '    <td class="num">' + fmtInt(totRev) + '</td>',
      '    <td class="num">' + fmtInt(totPt) + '</td>',
      '    <td class="num">' + fmtInt(totNew) + '</td>',
      '    <td class="num">' + fmtInt(totRebook) + '</td>',
      '    <td class="num">' + fmtInt(Math.round(totAvgPer)) + '</td>',
      '  </tr></tfoot>',
      '</table>',
      '</div>',
    ].join('');
  }

  function emptyState() {
    return [
      '<div class="empty">',
      '  <div class="empty-icon">' + ICON_CHART + '</div>',
      '  <div class="empty-title">ยังไม่มีข้อมูลยอดปิดจบวัน</div>',
      '  <div class="empty-sub">เมื่อระบบหน้าร้านส่งยอดปิดจบรายวันเข้ามา (fo.branch_daily.updated) ข้อมูลจะแสดงที่นี่</div>',
      '</div>',
    ].join('');
  }

  function dcReload() { loadData(); }
  function dcRender() { renderAll(); }

  // init labels
  $id('dc-refresh-btn').innerHTML = ICON_REFRESH + ' รีเฟรช';

  // expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix dc* กันชน)
  window.dcReload = dcReload;
  window.dcRender = dcRender;

  // init
  loadData();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountDailyclose) */
if (typeof window !== 'undefined') {
  window.mountDailyclose = mountDailyclose;
  window.DC_BACKEND = DC_BACKEND;
}
