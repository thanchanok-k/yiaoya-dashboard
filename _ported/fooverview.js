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

  // Recent daily activity
  sb.schema('fo').from('fo_daily_patients')
    .select('submitted_at,count_new,count_returning,count_pt,count_pilates,count_ortho')
    .order('submitted_at', { ascending: false }).limit(14)
    .then(function (res) {
      var box = document.getElementById('fovRecent');
      if (!box) return;
      if (res.error) { box.innerHTML = '<div class="fov-empty">โหลดไม่ได้: ' + fov_esc(res.error.message) + '</div>'; return; }
      var rows = res.data || [];
      if (!rows.length) { box.innerHTML = '<div class="fov-empty">ยังไม่มีข้อมูล</div>'; return; }
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
    })
    .catch(function (e) {
      var box = document.getElementById('fovRecent');
      if (box) box.innerHTML = '<div class="fov-empty">โหลดไม่ได้: ' + fov_esc(e && e.message) + '</div>';
    });
}

if (typeof window !== 'undefined') window.mountFooverview = mountFooverview;
