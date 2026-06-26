// _ported/foops.js — Native page "FO · ปฏิบัติการ" — อ่าน reporting views ที่ derive จาก granular
// EOD อัตโนมัติ · คอร์สใกล้จบ · Lead funnel · Ticket อาคาร
// pattern เดียวกับ fooverview.js: mountFoops → #wrap-foops · window.sb.schema('fo') · ไม่มี write · ไม่มี emoji
// prefix fops_ กันชนกับ fov_ (fooverview)

function fops_num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function fops_fmt(v) { return fops_num(v).toLocaleString('th-TH'); }
function fops_baht(v) { return '฿' + fops_num(v).toLocaleString('th-TH', { maximumFractionDigits: 0 }); }
function fops_esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
function fops_dateTH(s) {
  if (!s) return '-';
  var d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  try { return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); }
  catch (e) { return String(s).slice(0, 10); }
}
function fops_sb() { return (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null); }

function mountFoops() {
  var wrap = document.getElementById('wrap-foops');
  if (!wrap) return;
  var sb = fops_sb();

  wrap.innerHTML =
    '<style>' +
    '#fops{font-family:inherit}' +
    '#fops .fp-sec{font-size:14px;font-weight:600;color:#0D2F4F;margin:20px 0 10px;display:flex;align-items:center;gap:7px}' +
    '#fops .fp-sec i{color:#3DC5B7;font-size:17px}' +
    '#fops .fp-tw{background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden}' +
    '#fops table{width:100%;border-collapse:collapse;font-size:13px}' +
    '#fops thead tr{background:#0D2F4F;color:#fff;text-align:left}' +
    '#fops th,#fops td{padding:8px 14px}' +
    '#fops td.r,#fops th.r{text-align:right}' +
    '#fops tbody tr{border-bottom:1px solid #eef0f2}' +
    '#fops tbody tr:hover{background:#E6F7F580}' +
    '#fops .fp-empty{padding:18px;text-align:center;color:#6B7280;font-size:13px}' +
    '#fops .fp-bar{height:7px;background:#E6F7F5;border-radius:4px;overflow:hidden}' +
    '#fops .fp-bar>i{display:block;height:7px;background:#3DC5B7;border-radius:4px}' +
    '#fops .fp-chip{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;background:#F8F9FA;border:1px solid #E5E7EB;border-radius:8px;padding:5px 11px;margin:0 6px 6px 0}' +
    '#fops .fp-chip b{color:#0D2F4F}' +
    '</style>' +
    '<div id="fops">' +
    '<div class="fp-sec"><i class="ti ti-clipboard-check"></i>EOD อัตโนมัติ · 14 วันล่าสุด (คำนวณจาก visit + receipt)</div>' +
    '<div class="fp-tw" id="fpEod"><div class="fp-empty">กำลังโหลด…</div></div>' +
    '<div class="fp-sec"><i class="ti ti-hourglass-low"></i>คอร์สใกล้จบ (เหลือ ≤2 ครั้ง) → เสนอขายต่อ</div>' +
    '<div class="fp-tw" id="fpUpsell"><div class="fp-empty">กำลังโหลด…</div></div>' +
    '<div class="fp-sec"><i class="ti ti-filter"></i>Lead funnel · conversion ต่อช่องทาง</div>' +
    '<div class="fp-tw" id="fpFunnel"><div class="fp-empty">กำลังโหลด…</div></div>' +
    '<div class="fp-sec"><i class="ti ti-alert-triangle"></i>Ticket อาคารที่ยังเปิด</div>' +
    '<div id="fpFacility"><div class="fp-empty">กำลังโหลด…</div></div>' +
    '</div>';

  if (!sb || !sb.schema) {
    document.getElementById('fpEod').innerHTML = '<div class="fp-empty">เชื่อมต่อฐานข้อมูลไม่ได้ — ลองล็อกอินใหม่</div>';
    return;
  }
  var S = function () { return sb.schema('fo'); };

  // ===== EOD auto =====
  S().from('v_eod_auto').select('report_date,total_patients,new_patients,returning_patients,total_sales,receipts')
    .order('report_date', { ascending: false }).limit(14)
    .then(function (res) {
      var box = document.getElementById('fpEod'); if (!box) return;
      if (res.error) { box.innerHTML = '<div class="fp-empty">โหลดไม่ได้: ' + fops_esc(res.error.message) + '</div>'; return; }
      var rows = res.data || [];
      if (!rows.length) { box.innerHTML = '<div class="fp-empty">ยังไม่มีข้อมูล (รอ ETL เติม visit/receipt)</div>'; return; }
      var h = '<table><thead><tr><th>วันที่</th><th class="r">คนไข้</th><th class="r">ใหม่</th><th class="r">เก่า</th><th class="r">ยอดขาย</th><th class="r">บิล</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        h += '<tr><td>' + fops_dateTH(r.report_date) + '</td><td class="r">' + fops_fmt(r.total_patients) +
          '</td><td class="r">' + fops_fmt(r.new_patients) + '</td><td class="r">' + fops_fmt(r.returning_patients) +
          '</td><td class="r">' + fops_baht(r.total_sales) + '</td><td class="r">' + fops_fmt(r.receipts) + '</td></tr>';
      });
      box.innerHTML = h + '</tbody></table>';
    }).catch(function (e) { var b = document.getElementById('fpEod'); if (b) b.innerHTML = '<div class="fp-empty">โหลดไม่ได้: ' + fops_esc(e && e.message) + '</div>'; });

  // ===== คอร์สใกล้จบ =====
  S().from('v_course_upsell').select('product_name,sessions_used,sessions_total,sessions_remaining,pct_used')
    .order('pct_used', { ascending: false }).limit(50)
    .then(function (res) {
      var box = document.getElementById('fpUpsell'); if (!box) return;
      if (res.error) { box.innerHTML = '<div class="fp-empty">โหลดไม่ได้: ' + fops_esc(res.error.message) + '</div>'; return; }
      var rows = res.data || [];
      if (!rows.length) { box.innerHTML = '<div class="fp-empty">ยังไม่มีคอร์สใกล้จบ</div>'; return; }
      var h = '<table><thead><tr><th>คอร์ส</th><th class="r">ใช้/ทั้งหมด</th><th class="r">เหลือ</th><th class="r">%</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        h += '<tr><td>' + fops_esc(r.product_name || '-') + '</td><td class="r">' + fops_fmt(r.sessions_used) + '/' + fops_fmt(r.sessions_total) +
          '</td><td class="r">' + fops_fmt(r.sessions_remaining) + '</td><td class="r">' + fops_fmt(r.pct_used) + '%</td></tr>';
      });
      box.innerHTML = h + '</tbody></table>';
    }).catch(function (e) { var b = document.getElementById('fpUpsell'); if (b) b.innerHTML = '<div class="fp-empty">โหลดไม่ได้: ' + fops_esc(e && e.message) + '</div>'; });

  // ===== Lead funnel =====
  S().from('v_lead_funnel').select('channel,leads,booked,converted,lost,conversion_pct')
    .order('leads', { ascending: false })
    .then(function (res) {
      var box = document.getElementById('fpFunnel'); if (!box) return;
      if (res.error) { box.innerHTML = '<div class="fp-empty">โหลดไม่ได้: ' + fops_esc(res.error.message) + '</div>'; return; }
      var rows = res.data || [];
      if (!rows.length) { box.innerHTML = '<div class="fp-empty">ยังไม่มีข้อมูล lead</div>'; return; }
      var h = '<table><thead><tr><th>ช่องทาง</th><th class="r">ทัก</th><th class="r">นัด</th><th class="r">ปิด</th><th class="r">conversion</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var pct = fops_num(r.conversion_pct);
        h += '<tr><td>' + fops_esc(r.channel || '-') + '</td><td class="r">' + fops_fmt(r.leads) + '</td><td class="r">' + fops_fmt(r.booked) +
          '</td><td class="r">' + fops_fmt(r.converted) + '</td><td class="r" style="min-width:90px"><div class="fp-bar"><i style="width:' + Math.min(pct, 100) + '%"></i></div>' + pct + '%</td></tr>';
      });
      box.innerHTML = h + '</tbody></table>';
    }).catch(function (e) { var b = document.getElementById('fpFunnel'); if (b) b.innerHTML = '<div class="fp-empty">โหลดไม่ได้: ' + fops_esc(e && e.message) + '</div>'; });

  // ===== Facility open tickets =====
  S().from('v_facility_open').select('severity,open_tickets')
    .then(function (res) {
      var box = document.getElementById('fpFacility'); if (!box) return;
      if (res.error) { box.innerHTML = '<div class="fp-empty">โหลดไม่ได้: ' + fops_esc(res.error.message) + '</div>'; return; }
      var rows = res.data || [];
      if (!rows.length) { box.innerHTML = '<div class="fp-empty">ไม่มี ticket ค้าง</div>'; return; }
      var label = { high: 'สูง', med: 'กลาง', low: 'ต่ำ' };
      box.innerHTML = rows.map(function (r) {
        return '<span class="fp-chip"><i class="ti ti-point-filled" style="color:' + (r.severity === 'high' ? '#DC2626' : r.severity === 'med' ? '#D97706' : '#6B7280') + '"></i>' +
          fops_esc(label[r.severity] || r.severity || '-') + ' <b>' + fops_fmt(r.open_tickets) + '</b></span>';
      }).join('');
    }).catch(function (e) { var b = document.getElementById('fpFacility'); if (b) b.innerHTML = '<div class="fp-empty">โหลดไม่ได้: ' + fops_esc(e && e.message) + '</div>'; });
}

if (typeof window !== 'undefined') window.mountFoops = mountFoops;
