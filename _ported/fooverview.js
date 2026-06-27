// _ported/fooverview.js — Native page "FO · ภาพรวม" — อ่าน schema fo ตรงๆ จาก Supabase
// ผู้บริหาร/HQ ดู · read-only · ข้อมูลจริงจาก fo.patients / fo.fo_daily_patients ฯลฯ
//
// pattern เดียวกับ _ported/fosales.js:
//   - mountFooverview render เข้า #wrap-fooverview
//   - ใช้ global window.sb · เรียก sb.schema('fo') (authenticated → RLS owner เห็นหมด)
//   - CSS scope ใต้ #fov · ไม่มี write · ไม่มี emoji (line-art ti-* เท่านั้น)

function fov_num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function fov_fmt(v) { return fov_num(v).toLocaleString('th-TH'); }
function fov_esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
function fov_dateTH(s) {
  if (!s) return '-';
  var d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  try { return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); }
  catch (e) { return String(s).slice(0, 10); }
}

function fov_sb() {
  return (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
}
function fov_count(tbl) {
  var sb = fov_sb();
  if (!sb || !sb.schema) return Promise.resolve(0);
  return sb.schema('fo').from(tbl).select('*', { count: 'exact', head: true })
    .then(function (r) { return r && r.count != null ? r.count : 0; })
    .catch(function () { return 0; });
}

function mountFooverview() {
  var wrap = document.getElementById('wrap-fooverview');
  if (!wrap) return;
  var sb = fov_sb();

  wrap.innerHTML =
    '<style>' +
    '#fov{font-family:inherit}' +
    '#fov .fov-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:4px 0 22px}' +
    '#fov .fov-card{background:#E6F7F5;border-radius:12px;padding:14px 16px}' +
    '#fov .fov-lab{display:flex;align-items:center;gap:6px;color:#6B7280;font-size:13px}' +
    '#fov .fov-lab i{color:#3DC5B7;font-size:16px}' +
    '#fov .fov-val{color:#0D2F4F;font-size:24px;font-weight:600;margin-top:4px}' +
    '#fov .fov-tw{background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden}' +
    '#fov .fov-th{display:flex;align-items:center;gap:8px;padding:11px 18px;border-bottom:1px solid #E5E7EB;color:#0D2F4F;font-weight:600;font-size:14px}' +
    '#fov table{width:100%;border-collapse:collapse;font-size:13px}' +
    '#fov thead tr{background:#0D2F4F;color:#fff;text-align:left}' +
    '#fov th,#fov td{padding:8px 14px}' +
    '#fov td.r,#fov th.r{text-align:right}' +
    '#fov tbody tr{border-bottom:1px solid #eef0f2}' +
    '#fov tbody tr:hover{background:#E6F7F580}' +
    '#fov .fov-empty{padding:22px;text-align:center;color:#6B7280;font-size:13px}' +
    '</style>' +
    '<div id="fov">' +
    '<div class="fov-grid" id="fovKpi">' +
    '<div class="fov-card"><div class="fov-lab"><i class="ti ti-users"></i>คนไข้ในระบบ</div><div class="fov-val" id="fovK_pat">…</div></div>' +
    '<div class="fov-card"><div class="fov-lab"><i class="ti ti-calendar"></i>บันทึกรายวัน</div><div class="fov-val" id="fovK_dp">…</div></div>' +
    '<div class="fov-card"><div class="fov-lab"><i class="ti ti-phone"></i>ติดตามการโทร</div><div class="fov-val" id="fovK_cf">…</div></div>' +
    '<div class="fov-card"><div class="fov-lab"><i class="ti ti-activity-heartbeat"></i>FSWT sessions</div><div class="fov-val" id="fovK_fs">…</div></div>' +
    '<div class="fov-card"><div class="fov-lab"><i class="ti ti-alert-triangle"></i>รายงานปัญหา</div><div class="fov-val" id="fovK_iss">…</div></div>' +
    '<div class="fov-card"><div class="fov-lab"><i class="ti ti-clock-hour-8"></i>คำขอ OT</div><div class="fov-val" id="fovK_ot">…</div></div>' +
    '</div>' +
    '<div id="fovBar"></div>' +
    '<div id="fovCharts" style="margin:0 0 16px"></div>' +
    '<div class="fov-tw">' +
    '<div class="fov-th"><i class="ti ti-calendar-stats"></i>กิจกรรมหน้าบ้าน 14 วันล่าสุด</div>' +
    '<div id="fovRecent"><div class="fov-empty">กำลังโหลด…</div></div>' +
    '</div>' +
    '</div>';

  if (!sb || !sb.schema) {
    document.getElementById('fovRecent').innerHTML = '<div class="fov-empty">เชื่อมต่อฐานข้อมูลไม่ได้ — ลองล็อกอินใหม่</div>';
    return;
  }

  // KPI counts
  var map = { fovK_pat: 'patients', fovK_dp: 'fo_daily_patients', fovK_cf: 'fo_call_followup', fovK_fs: 'fo_fswt_shots', fovK_iss: 'fo_issues', fovK_ot: 'fo_ot_requests' };
  Object.keys(map).forEach(function (id) {
    fov_count(map[id]).then(function (n) {
      var el = document.getElementById(id);
      if (el) el.textContent = fov_fmt(n);
    });
  });

  // filter bar : ช่วงด่วน (pills) + เลือกช่วงวันที่เอง (date range)
  fov_renderBar();
  fov_loadRange(fov_d1, fov_d2);
  fov_fetchRevenue();   // ยอดขายรายวัน (fo.branch_daily) → overlay ในกราฟรวม
}

// ยอดขายรวมรายวัน (sum ทุกสาขา) เก็บเป็น map date(YYYY-MM-DD) → บาท · ใช้ในกราฟรวม (แกนขวา)
var fov_revByDate = {};
function fov_fetchRevenue() {
  var sb = fov_sb(); if (!sb || !sb.functions) return;
  sb.functions.invoke('hr_list?type=fo.branch_daily.updated&limit=2000').then(function (res) {
    var items = ((res && res.data) || {}).items || [];
    var m = {};
    items.forEach(function (p) {
      var d = String(p.date || p.branch_day_date || p.day || '').slice(0, 10);
      if (!d) return;
      m[d] = (m[d] || 0) + fov_num(p.revenue_total);
    });
    fov_revByDate = m;
    if (fov_lastRows.length) fov_renderCharts(fov_lastRows); // มียอดขายแล้ว → วาดกราฟรวมใหม่
  }).catch(function () { /* ไม่มียอดขาย → กราฟรวมแสดงเฉพาะจำนวนผู้ป่วย */ });
}

// ยอดขายแยกแผนกรายวัน (fo.fo_daily_sales) → map date → {total,pt,ortho,pilates} · ใช้ในกราฟรวม (แกนขวา)
var fov_salesByDate = {};
function fov_fetchSales(d1, d2) {
  var sb = fov_sb(); if (!sb || !sb.schema) return;
  sb.schema('fo').from('fo_daily_sales')
    .select('record_date,submitted_at,amount_total,amount_pt,amount_ortho,amount_pilates,amount_new,amount_returning,is_test')
    .gte('record_date', d1).lte('record_date', d2).limit(2000)
    .then(function (res) {
      if (res.error) { fov_salesByDate = {}; return; } // ตารางยังไม่มี/ไม่มีสิทธิ์ → เงียบ ใช้ branch_daily แทน
      var m = {};
      (res.data || []).forEach(function (p) {
        if (p.is_test) return;
        var d = String(p.record_date || p.submitted_at || '').slice(0, 10); if (!d) return;
        var o = m[d] || (m[d] = { total: 0, pt: 0, ortho: 0, pilates: 0, foNew: 0, foOld: 0 });
        o.total += fov_num(p.amount_total); o.pt += fov_num(p.amount_pt);
        o.ortho += fov_num(p.amount_ortho); o.pilates += fov_num(p.amount_pilates);
        o.foNew += fov_num(p.amount_new); o.foOld += fov_num(p.amount_returning);
      });
      fov_salesByDate = m;
      if (fov_lastRows.length) fov_renderCharts(fov_lastRows);
    }).catch(function () { fov_salesByDate = {}; });
}

// segment รายวัน จาก JERA (fo.fo_sales_segment_daily): แยก ผู้ป่วยใหม่/เก่า + ช่องทาง
//   map date → { saleNew, saleOld, chanNew:{ch:cnt}, chanOld:{ch:cnt} } · ถ้าตารางยังไม่มีก็เงียบ
var fov_segByDate = {};
var fov_segChannels = []; // ช่องทางที่พบ (เรียงตามจำนวนรวม)
function fov_fetchSegment(d1, d2) {
  var sb = fov_sb(); if (!sb || !sb.schema) return;
  sb.schema('fo').from('fo_sales_segment_daily')
    .select('record_date,is_new_patient,channel,amount,cnt')
    .gte('record_date', d1).lte('record_date', d2).limit(5000)
    .then(function (res) {
      if (res.error) { fov_segByDate = {}; fov_segChannels = []; return; } // ยังไม่ deploy → เงียบ
      var m = {}, chanTot = {};
      (res.data || []).forEach(function (p) {
        var d = String(p.record_date || '').slice(0, 10); if (!d) return;
        var o = m[d] || (m[d] = { saleNew: 0, saleOld: 0, chanNew: {}, chanOld: {} });
        var amt = fov_num(p.amount), cnt = fov_num(p.cnt), ch = p.channel || 'ไม่ระบุ';
        if (p.is_new_patient) { o.saleNew += amt; o.chanNew[ch] = (o.chanNew[ch] || 0) + cnt; }
        else { o.saleOld += amt; o.chanOld[ch] = (o.chanOld[ch] || 0) + cnt; }
        chanTot[ch] = (chanTot[ch] || 0) + cnt;
      });
      fov_segByDate = m;
      fov_segChannels = Object.keys(chanTot).sort(function (a, b) { return chanTot[b] - chanTot[a]; }).slice(0, 3);
      if (fov_lastRows.length) fov_renderCharts(fov_lastRows);
    }).catch(function () { fov_segByDate = {}; fov_segChannels = []; });
}

// ---- state ช่วงวันที่ ----
function fov_pad(n) { return String(n).padStart(2, '0'); }
function fov_isoDay(d) { return d.getFullYear() + '-' + fov_pad(d.getMonth() + 1) + '-' + fov_pad(d.getDate()); }
function fov_daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return fov_isoDay(d); }
var fov_period = 30;                 // preset ที่ active (null = ช่วงกำหนดเอง)
var fov_d2 = fov_isoDay(new Date()); // ถึงวันที่ (วันนี้)
var fov_d1 = fov_daysAgo(29);        // จากวันที่ (ย้อน 30 วัน)
var fov_lastRows = [];

function fov_perLabel() { return fov_period != null ? (fov_period + ' วัน') : (fov_dateTH(fov_d1) + ' – ' + fov_dateTH(fov_d2)); }

function fov_renderBar() {
  var bar = document.getElementById('fovBar'); if (!bar || !window.YChart) return;
  var lab = 'font-size:10.5px;color:#94A3B8;font-weight:700;text-transform:uppercase;letter-spacing:.04em';
  var inp = 'padding:7px 10px;border:1px solid #E2E8F0;border-radius:8px;font:inherit;font-size:13px;color:#0F172A';
  bar.innerHTML =
    '<div style="display:flex;align-items:flex-end;gap:14px;margin-bottom:14px;flex-wrap:wrap">' +
      '<div style="display:flex;flex-direction:column;gap:5px"><span style="' + lab + '">ช่วงด่วน</span>' +
        window.YChart.pills({ items: [{ v: '14', label: '14 วัน' }, { v: '30', label: '30 วัน' }, { v: '90', label: '90 วัน' }], active: (fov_period != null ? String(fov_period) : ''), onPick: 'fov_setPeriod' }) + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:5px"><span style="' + lab + '">จากวันที่</span><input id="fov_d1" type="date" value="' + fov_d1 + '" max="' + fov_isoDay(new Date()) + '" style="' + inp + '"></div>' +
      '<div style="display:flex;flex-direction:column;gap:5px"><span style="' + lab + '">ถึงวันที่</span><input id="fov_d2" type="date" value="' + fov_d2 + '" max="' + fov_isoDay(new Date()) + '" style="' + inp + '"></div>' +
      '<button onclick="fov_applyRange()" style="background:#3DC5B7;color:#fff;border:none;border-radius:8px;padding:8px 18px;font:inherit;font-weight:700;font-size:13px;cursor:pointer"><i class="ti ti-search" style="vertical-align:-2px"></i> ค้นหา</button>' +
    '</div>';
}

// preset ด่วน → set ช่วงวันที่ตาม แล้วโหลด
function fov_setPeriod(v) {
  var n = Number(v) || 30;
  fov_period = n; fov_d2 = fov_isoDay(new Date()); fov_d1 = fov_daysAgo(n - 1);
  fov_renderBar();
  fov_loadRange(fov_d1, fov_d2);
}

// ช่วงวันที่กำหนดเอง (ปุ่มค้นหา)
function fov_applyRange() {
  var i1 = document.getElementById('fov_d1'), i2 = document.getElementById('fov_d2');
  var d1 = i1 && i1.value, d2 = i2 && i2.value;
  if (!d1 || !d2) return;
  if (d1 > d2) { var t = d1; d1 = d2; d2 = t; }
  fov_d1 = d1; fov_d2 = d2; fov_period = null;  // เลิก preset
  var bar = document.getElementById('fovBar');
  if (bar) bar.querySelectorAll('.yc-pills button').forEach(function (b) { b.classList.remove('on'); });
  fov_loadRange(d1, d2);
}

function fov_loadRange(d1, d2) {
  var sb = fov_sb(); if (!sb || !sb.schema) return;
  fov_fetchSales(d1, d2);    // ยอดขายแยกแผนกตามช่วงวันที่
  fov_fetchSegment(d1, d2);  // ยอดขาย/ช่องทาง แยกผู้ป่วยใหม่/เก่า (JERA)
  var box = document.getElementById('fovRecent');
  if (box) box.innerHTML = '<div class="fov-empty">กำลังโหลด…</div>';
  var chartsBox = document.getElementById('fovCharts');
  if (chartsBox && window.YChart) chartsBox.innerHTML = window.YChart.empty('กำลังโหลด…', 'ti-loader');
  sb.schema('fo').from('fo_daily_patients')
    .select('submitted_at,count_new,count_returning,count_pt,count_pilates,count_ortho')
    .gte('submitted_at', d1).lte('submitted_at', d2 + 'T23:59:59')
    .order('submitted_at', { ascending: false }).limit(400)
    .then(function (res) {
      if (box) {
        if (res.error) { box.innerHTML = '<div class="fov-empty">โหลดไม่ได้: ' + fov_esc(res.error.message) + '</div>'; }
        else {
          var rows = res.data || [];
          if (!rows.length) { box.innerHTML = '<div class="fov-empty">ไม่มีข้อมูลในช่วงวันที่นี้</div>'; }
          else {
            var html = '<table><thead><tr><th>วันที่</th><th class="r">ใหม่</th><th class="r">เก่า</th><th class="r">กายภาพ</th><th class="r">Pilates</th><th class="r">ออร์โธ</th></tr></thead><tbody>';
            rows.forEach(function (r) {
              html += '<tr><td>' + fov_dateTH(r.submitted_at) + '</td>' +
                '<td class="r">' + fov_fmt(r.count_new) + '</td>' +
                '<td class="r">' + fov_fmt(r.count_returning) + '</td>' +
                '<td class="r">' + fov_fmt(r.count_pt) + '</td>' +
                '<td class="r">' + fov_fmt(r.count_pilates) + '</td>' +
                '<td class="r">' + fov_fmt(r.count_ortho) + '</td></tr>';
            });
            html += '</tbody></table>';
            box.innerHTML = html;
          }
        }
      }
      fov_lastRows = (res.data || []);
      fov_renderCharts(fov_lastRows);
    })
    .catch(function (e) {
      if (box) box.innerHTML = '<div class="fov-empty">โหลดไม่ได้: ' + fov_esc(e && e.message) + '</div>';
    });
}

// ดาวน์โหลดข้อมูลรายวันเป็น CSV (ปุ่มในหัวการ์ด — เหมือนไอคอนดาวน์โหลดของ JERA)
function fov_dlDaily() {
  if (!window.YChart || !fov_lastRows.length) return;
  var csv = window.YChart.toCSV(fov_lastRows, [
    { k: 'submitted_at', h: 'วันที่' }, { k: 'count_new', h: 'ผู้ป่วยใหม่' }, { k: 'count_returning', h: 'ผู้ป่วยเก่า' },
    { k: 'count_pt', h: 'กายภาพบำบัด' }, { k: 'count_pilates', h: 'Pilates' }, { k: 'count_ortho', h: 'ออร์โธ' }
  ]);
  var tag = fov_period != null ? (fov_period + 'วัน') : (fov_d1 + '_ถึง_' + fov_d2);
  window.YChart.download('fo_ภาพรวม_' + tag + '.csv', csv);
}

// palette 16 สีแยกจากกันชัด (นำด้วย teal/navy แบรนด์) — กันสีซ้ำในกราฟรวม
var FOV_COMBO_COLORS = ['#3DC5B7', '#3E6FB0', '#E8995A', '#8E72E0', '#E06FA8', '#43A86A', '#5BB6D6', '#D45F5F', '#A88A3A', '#6FA0D0', '#B05FB0', '#7AA86A', '#D0843E', '#5FA39B', '#9B7BD0', '#C9683E', '#2F8F87', '#A84F6F', '#8FA63E', '#B5651D'];

// แดชบอร์ดกราฟ (JERA-style) — ใช้ YChart กลาง · ถ้า kit ยังไม่โหลดก็ข้าม (ไม่ error)
function fov_renderCharts(rows) {
  var box = document.getElementById('fovCharts');
  if (!box || typeof window === 'undefined' || !window.YChart) return;
  var Y = window.YChart;
  if (!rows.length) { box.innerHTML = Y.empty('ยังไม่มีข้อมูลในช่วงเวลานี้', 'ti-calendar-off'); return; }
  var asc = rows.slice().reverse(); // เก่า→ใหม่ (ซ้าย→ขวา)
  var labels = asc.map(function (r) { return fov_dateTH(r.submitted_at); });
  var perLab = fov_perLabel();
  var dlBtn = Y.iconBtn('ti-download', 'fov_dlDaily()', 'ดาวน์โหลด CSV');
  var sum = function (k) { return rows.reduce(function (a, r) { return a + fov_num(r[k]); }, 0); };
  var totNew = sum('count_new'), totRet = sum('count_returning');

  // KPI สรุปช่วงเวลา (รวม · % ใหม่)
  var totVisit = totNew + totRet;
  var kpis = Y.kpiRow([
    { label: 'ผู้ป่วยรวม', value: Y.full(totVisit), unit: 'คน', sub: 'ในช่วง ' + perLab, icon: 'ti-users-group' },
    { label: 'ผู้ป่วยใหม่', value: Y.full(totNew), unit: 'คน', sub: totVisit ? Math.round(totNew / totVisit * 100) + '% ของทั้งหมด' : '', icon: 'ti-user-plus' },
    { label: 'ผู้ป่วยเก่า', value: Y.full(totRet), unit: 'คน', sub: totVisit ? Math.round(totRet / totVisit * 100) + '% ของทั้งหมด' : '', icon: 'ti-user-check' },
    { label: 'เฉลี่ย/วัน', value: Y.full(Math.round(totVisit / asc.length)), unit: 'คน', sub: asc.length + ' วันที่มีข้อมูล', icon: 'ti-chart-bar' }
  ]);

  var svcTotals = [
    { label: 'กายภาพบำบัด', value: sum('count_pt'), color: Y.C.tealSoft },
    { label: 'Pilates', value: sum('count_pilates'), color: Y.C.navySoft },
    { label: 'ออร์โธ', value: sum('count_ortho'), color: Y.C.amberSoft }
  ];

  // กราฟรวม · เลือกดูได้ (toggle) — ผู้ป่วยใหม่/เก่า + แยกแผนก + ยอดขายรวม (แกนขวา)
  var isoKeys = asc.map(function (r) { return String(r.submitted_at).slice(0, 10); });
  var sBy = function (d) { return fov_salesByDate[d]; };
  var hasDeptSales = isoKeys.some(function (d) { return sBy(d); });
  var hasRev = isoKeys.some(function (d) { return fov_revByDate[d]; });
  // จำนวนผู้ป่วย (แกนซ้าย = คน) · group = แถวของ chip
  var comboSeries = [
    { key: 'new', name: 'ผู้ป่วยใหม่', group: 'จำนวนคนไข้', vals: asc.map(function (r) { return fov_num(r.count_new); }) },
    { key: 'old', name: 'ผู้ป่วยเก่า', group: 'จำนวนคนไข้', vals: asc.map(function (r) { return fov_num(r.count_returning); }) },
    { key: 'pt', name: 'คนไข้กายภาพ', group: 'จำนวนคนไข้', vals: asc.map(function (r) { return fov_num(r.count_pt); }) },
    { key: 'pil', name: 'คนไข้ Pilates', group: 'จำนวนคนไข้', vals: asc.map(function (r) { return fov_num(r.count_pilates); }) },
    { key: 'ortho', name: 'คนไข้ออร์โธ', group: 'จำนวนคนไข้', vals: asc.map(function (r) { return fov_num(r.count_ortho); }) }
  ];
  // ยอดขายแยกแผนก (แกนขวา = บาท) — จาก fo_daily_sales · ไม่งั้น fallback ยอดรวม branch_daily
  if (hasDeptSales) {
    comboSeries.push({ key: 'sale_total', name: 'ยอดขายรวม', group: 'ยอดขายแยกแผนก', vals: isoKeys.map(function (d) { var s = sBy(d); return s ? s.total : 0; }), axis: 'right' });
    comboSeries.push({ key: 'sale_pt', name: 'ยอดขายกายภาพ', group: 'ยอดขายแยกแผนก', vals: isoKeys.map(function (d) { var s = sBy(d); return s ? s.pt : 0; }), axis: 'right' });
    comboSeries.push({ key: 'sale_ortho', name: 'ยอดขายออร์โธ', group: 'ยอดขายแยกแผนก', vals: isoKeys.map(function (d) { var s = sBy(d); return s ? s.ortho : 0; }), axis: 'right' });
    comboSeries.push({ key: 'sale_pil', name: 'ยอดขาย Pilates', group: 'ยอดขายแยกแผนก', vals: isoKeys.map(function (d) { var s = sBy(d); return s ? s.pilates : 0; }), axis: 'right' });
  } else if (hasRev) {
    comboSeries.push({ key: 'rev', name: 'ยอดขายรวม', group: 'ยอดขาย', vals: isoKeys.map(function (d) { return fov_revByDate[d] || 0; }), axis: 'right' });
  }
  // ยอดขายแยกผู้ป่วยใหม่/เก่า + ช่องทาง×ใหม่/เก่า (จาก JERA segment)
  var gBy = function (d) { return fov_segByDate[d]; };
  if (isoKeys.some(function (d) { return gBy(d); })) {
    comboSeries.push({ key: 'sale_new', name: 'ยอดขายผู้ป่วยใหม่', group: 'ยอดขายใหม่/เก่า', vals: isoKeys.map(function (d) { var s = gBy(d); return s ? s.saleNew : 0; }), axis: 'right' });
    comboSeries.push({ key: 'sale_old', name: 'ยอดขายผู้ป่วยเก่า', group: 'ยอดขายใหม่/เก่า', vals: isoKeys.map(function (d) { var s = gBy(d); return s ? s.saleOld : 0; }), axis: 'right' });
    fov_segChannels.forEach(function (ch, ci) {
      comboSeries.push({ key: 'chN_' + ci, name: 'ใหม่ · ' + ch, group: 'ช่องทาง', vals: isoKeys.map(function (d) { var s = gBy(d); return s ? (s.chanNew[ch] || 0) : 0; }) });
      comboSeries.push({ key: 'chO_' + ci, name: 'เก่า · ' + ch, group: 'ช่องทาง', vals: isoKeys.map(function (d) { var s = gBy(d); return s ? (s.chanOld[ch] || 0) : 0; }) });
    });
  }
  // ยอดขายใหม่/เก่า ที่พนักงาน "กรอกหน้าร้าน" (fo_daily_sales) — cross-check กับ JERA
  if (isoKeys.some(function (d) { var s = sBy(d); return s && (s.foNew || s.foOld); })) {
    comboSeries.push({ key: 'foNew', name: 'ยอดใหม่ (FO กรอก)', group: 'FO กรอก (cross-check)', vals: isoKeys.map(function (d) { var s = sBy(d); return s ? s.foNew : 0; }), axis: 'right' });
    comboSeries.push({ key: 'foOld', name: 'ยอดเก่า (FO กรอก)', group: 'FO กรอก (cross-check)', vals: isoKeys.map(function (d) { var s = sBy(d); return s ? s.foOld : 0; }), axis: 'right' });
  }
  // แจกสีไม่ซ้ำตามลำดับ (palette 16 สีแยกจากกันชัด)
  comboSeries.forEach(function (s, i) { s.color = FOV_COMBO_COLORS[i % FOV_COMBO_COLORS.length]; });
  var comboCard = Y.card({
    title: 'กราฟรวม · เลือกดูได้', icon: 'ti-chart-dots-2', sub: 'กด chip เลือกเส้นที่จะแสดงพร้อมกัน · ' + perLab, action: dlBtn,
    body: Y.toggleChart({ id: 'fovCombo', labels: labels, height: 290, active: ['new', 'old'], series: comboSeries })
  });

  // line : แนวโน้มผู้ป่วยรายวัน (ใหม่ vs เก่า — 2 เส้น)
  var lineCard = Y.card({
    title: 'แนวโน้มผู้ป่วยรายวัน', icon: 'ti-chart-line', sub: 'ใหม่ / เก่า · ' + perLab, action: dlBtn,
    body: Y.line({
      labels: labels, height: 260,
      series: [
        { name: 'ผู้ป่วยใหม่', vals: asc.map(function (r) { return fov_num(r.count_new); }), color: Y.C.tealSoft },
        { name: 'ผู้ป่วยเก่า', vals: asc.map(function (r) { return fov_num(r.count_returning); }), color: Y.C.navySoft }
      ]
    })
  });

  // stacked bar : ผู้ป่วยใหม่ vs เก่า รายวัน
  var barCard = Y.card({
    title: 'ผู้ป่วยใหม่ / เก่า', icon: 'ti-users', sub: 'รายวัน · ' + perLab, action: dlBtn,
    body: Y.bars({
      labels: labels, stacked: true, height: 260,
      series: [
        { name: 'ผู้ป่วยใหม่', vals: asc.map(function (r) { return fov_num(r.count_new); }), color: Y.C.tealSoft },
        { name: 'ผู้ป่วยเก่า', vals: asc.map(function (r) { return fov_num(r.count_returning); }), color: Y.C.navySoft }
      ]
    })
  });

  // stacked bar : บริการรายวัน (กายภาพ/Pilates/ออร์โธ)
  var svcCard = Y.card({
    title: 'บริการรายวัน', icon: 'ti-stethoscope', sub: 'แยกประเภท · ' + perLab, action: dlBtn,
    body: Y.bars({
      labels: labels, stacked: true, height: 260,
      series: [
        { name: 'กายภาพบำบัด', vals: asc.map(function (r) { return fov_num(r.count_pt); }), color: Y.C.tealSoft },
        { name: 'Pilates', vals: asc.map(function (r) { return fov_num(r.count_pilates); }), color: Y.C.navySoft },
        { name: 'ออร์โธ', vals: asc.map(function (r) { return fov_num(r.count_ortho); }), color: Y.C.amberSoft }
      ]
    })
  });

  // donut : สัดส่วนบริการ (รวมช่วงเวลา)
  var donutCard = Y.card({
    title: 'สัดส่วนบริการ', icon: 'ti-chart-donut', sub: 'รวม ' + perLab,
    body: Y.donut(svcTotals, { size: 190, centerLabel: 'รวม', valueFmt: Y.full })
  });

  // gauge : สัดส่วนผู้ป่วยใหม่
  var gaugeCard = Y.card({
    title: 'สัดส่วนผู้ป่วยใหม่', icon: 'ti-user-plus', sub: 'ในช่วง ' + perLab,
    body: '<div style="padding:12px 0 8px">' + Y.gauge({ value: totNew, max: totVisit || 1, label: 'ใหม่ ' + Y.full(totNew) + ' / รวม ' + Y.full(totVisit), color: Y.C.tealSoft }) + '</div>'
  });

  // barList : อันดับบริการยอดนิยม
  var rankCard = Y.card({
    title: 'บริการยอดนิยม', icon: 'ti-list-numbers', sub: 'รวม ' + perLab,
    body: Y.barList(svcTotals.slice().sort(function (a, b) { return b.value - a.value; }), { valueFmt: Y.full })
  });

  // กราฟรวม (เต็มกว้าง) ด้านบน + 2 คอลัมน์ + แถวสรุป 3 ช่อง
  box.innerHTML = kpis + '<div style="display:flex;flex-direction:column;gap:14px">' +
    comboCard +
    Y.grid([lineCard, barCard], { min: 440 }) +
    Y.grid([svcCard, donutCard], { min: 440 }) +
    Y.grid([gaugeCard, rankCard], { min: 320 }) +
    '</div>';
}

if (typeof window !== 'undefined') {
  window.mountFooverview = mountFooverview;
  window.fov_setPeriod = fov_setPeriod;   // pills ช่วงด่วน (inline onclick)
  window.fov_applyRange = fov_applyRange;  // ปุ่มค้นหาช่วงวันที่ (inline onclick)
  window.fov_dlDaily = fov_dlDaily;        // ปุ่มดาวน์โหลด CSV (inline onclick)
}
