// _ported/adexplore.js — "โฆษณา · เจาะลึก (Explorer)" · interactive multi-platform ad analytics
// ดึง ad_daily ผ่าน meta_sync mode=explore (ทุก platform: meta/google/tiktok โผล่เองเมื่อมีข้อมูล)
// เลือกช่วงเวลา + กรอง platform/แบรนด์/เพจ + เปลี่ยนมุมมอง (group by) + metrics ครบ (CTR/CPC/CPM)
// pattern: mountAdexplore render เข้า #wrap-adexplore · ใช้ window.sb · ห้าม redeclare global

(function () {
  var ST = { days: 90, platform: '', account: '', page: '', groupBy: 'campaign', rows: [], loading: false, err: '' };
  var RANGES = [['7', '7 วัน'], ['30', '30 วัน'], ['90', '90 วัน'], ['365', '1 ปี'], ['1200', 'ทั้งหมด']];
  var GROUPS = [['platform', 'แพลตฟอร์ม'], ['account', 'แบรนด์/บัญชี'], ['campaign', 'แคมเปญ'], ['page', 'เพจ'], ['month', 'รายเดือน']];
  var PLAT_NAME = { meta: 'Meta (FB/IG)', google: 'Google Ads', tiktok: 'TikTok Ads' };

  function $w() { return document.getElementById('wrap-adexplore'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function baht(n) { return '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 }); }
  function intf(n) { return Number(n || 0).toLocaleString('th-TH'); }
  function pct(n) { return (Number(n || 0)).toFixed(2) + '%'; }
  function getSb() { return (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null); }

  function load() {
    var sb = getSb(); if (!sb || !sb.functions) { ST.err = 'ไม่พบการเชื่อมต่อ'; return render(); }
    ST.loading = true; render();
    sb.functions.invoke('meta_sync', { body: { mode: 'explore', days: Number(ST.days) } }).then(function (res) {
      var d = (res && res.data) || {};
      ST.rows = (d.ok && Array.isArray(d.rows)) ? d.rows : [];
      ST.err = d.ok ? '' : (d.error || (res && res.error && res.error.message) || 'โหลดไม่ได้');
      ST.loading = false; render();
    }).catch(function (e) { ST.loading = false; ST.err = String(e && e.message || e); render(); });
  }

  function filtered() {
    return ST.rows.filter(function (r) {
      if (ST.platform && r.platform !== ST.platform) return false;
      if (ST.account && r.account !== ST.account) return false;
      if (ST.page && (r.page || '') !== ST.page) return false;
      return true;
    });
  }

  function keyOf(r) {
    if (ST.groupBy === 'platform') return PLAT_NAME[r.platform] || r.platform || '—';
    if (ST.groupBy === 'account') return r.account || '—';
    if (ST.groupBy === 'page') return r.page || '(ไม่ระบุเพจ)';
    if (ST.groupBy === 'month') return String(r.date || '').slice(0, 7) || '—';
    return r.campaign || '—';
  }

  function aggregate(rows) {
    var m = {};
    rows.forEach(function (r) {
      var k = keyOf(r);
      var o = m[k] || (m[k] = { key: k, spend: 0, impr: 0, clicks: 0, conv: 0, val: 0 });
      o.spend += Number(r.spend) || 0; o.impr += Number(r.impressions) || 0;
      o.clicks += Number(r.clicks) || 0; o.conv += Number(r.conversions) || 0; o.val += Number(r.conversion_value) || 0;
    });
    var arr = Object.keys(m).map(function (k) { return m[k]; });
    arr.forEach(function (o) {
      o.ctr = o.impr ? (o.clicks / o.impr * 100) : 0;
      o.cpc = o.clicks ? (o.spend / o.clicks) : 0;
      o.cpm = o.impr ? (o.spend / o.impr * 1000) : 0;
    });
    arr.sort(function (a, b) { return b.spend - a.spend; });
    return arr;
  }

  function uniq(field) {
    var s = {}; var out = [];
    ST.rows.forEach(function (r) { var v = field === 'page' ? (r.page || '') : r[field]; if (v && !s[v]) { s[v] = 1; out.push(v); } });
    out.sort(); return out;
  }

  function btn(active, label, attr) {
    return '<button ' + attr + ' style="padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;border:1px solid ' + (active ? '#3DC5B7' : 'var(--border,#E2E8F0)') + ';background:' + (active ? '#3DC5B7' : '#fff') + ';color:' + (active ? '#04342C' : 'var(--navy,#0D2F4F)') + '">' + esc(label) + '</button>';
  }
  function sel(id, cur, opts, ph) {
    var o = '<option value="">' + esc(ph) + '</option>' + opts.map(function (v) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(PLAT_NAME[v] || v) + '</option>'; }).join('');
    return '<select id="' + id + '" style="padding:7px 10px;border:1px solid var(--border,#E2E8F0);border-radius:8px;font-size:12px;font-family:inherit;background:#fff;color:var(--navy,#0D2F4F);max-width:200px">' + o + '</select>';
  }

  function render() {
    var w = $w(); if (!w) return;
    if (ST.loading) { w.innerHTML = '<div class="empty-card"><i class="ti ti-loader"></i><span>กำลังโหลดข้อมูลโฆษณา…</span></div>'; return; }
    if (ST.err) { w.innerHTML = '<div class="empty-card"><i class="ti ti-alert-triangle"></i><span>' + esc(ST.err) + '</span></div>'; return; }

    var rows = filtered();
    var agg = aggregate(rows);
    var tot = agg.reduce(function (a, o) { return { spend: a.spend + o.spend, impr: a.impr + o.impr, clicks: a.clicks + o.clicks, conv: a.conv + o.conv }; }, { spend: 0, impr: 0, clicks: 0, conv: 0 });
    var tctr = tot.impr ? (tot.clicks / tot.impr * 100) : 0;
    var tcpc = tot.clicks ? (tot.spend / tot.clicks) : 0;
    var tcpm = tot.impr ? (tot.spend / tot.impr * 1000) : 0;

    var h = '';
    // แถบควบคุม
    h += '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:6px">';
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap">' + RANGES.map(function (r) { return btn(ST.days == r[0], r[1], 'data-rng="' + r[0] + '"'); }).join('') + '</div>';
    h += '</div>';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px">'
      + sel('axPlat', ST.platform, uniq('platform'), 'ทุกแพลตฟอร์ม')
      + sel('axAcc', ST.account, uniq('account'), 'ทุกแบรนด์')
      + sel('axPage', ST.page, uniq('page'), 'ทุกเพจ')
      + '</div>';
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:14px"><span style="font-size:12px;color:var(--text-muted,#64748B)">มุมมอง:</span>'
      + GROUPS.map(function (g) { return btn(ST.groupBy === g[0], g[1], 'data-grp="' + g[0] + '"'); }).join('') + '</div>';

    // การ์ดสรุป
    var card = function (l, v, sub) { return '<div style="background:var(--surface,#fff);border:1px solid var(--border,#E2E8F0);border-radius:12px;padding:11px 14px;flex:1;min-width:120px"><div style="font-size:10.5px;color:var(--text-muted,#64748B);font-weight:600;text-transform:uppercase">' + l + '</div><div style="font-size:20px;font-weight:800;color:var(--navy,#0D2F4F)">' + v + '</div><div style="font-size:10.5px;color:var(--text-muted,#64748B)">' + (sub || '') + '</div></div>'; };
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">'
      + card('ค่าโฆษณา', baht(tot.spend), ST.days == '1200' ? 'ทั้งหมด' : ST.days + ' วัน')
      + card('Impressions', intf(tot.impr), 'CTR ' + pct(tctr))
      + card('คลิก', intf(tot.clicks), 'CPC ' + baht(tcpc))
      + card('CPM', baht(tcpm), 'ต่อ 1,000 impr')
      + card('Conversions', intf(tot.conv), 'จากแอด')
      + '</div>';

    // ตาราง
    var gname = (GROUPS.filter(function (g) { return g[0] === ST.groupBy; })[0] || ['', 'รายการ'])[1];
    var body = agg.map(function (o) {
      return '<tr>'
        + '<td class="name-cell" title="' + esc(o.key) + '">' + esc(o.key.length > 60 ? o.key.slice(0, 60) + '…' : o.key) + '</td>'
        + '<td class="num">' + baht(o.spend) + '</td>'
        + '<td class="num">' + intf(o.impr) + '</td>'
        + '<td class="num">' + intf(o.clicks) + '</td>'
        + '<td class="num">' + pct(o.ctr) + '</td>'
        + '<td class="num">' + baht(o.cpc) + '</td>'
        + '<td class="num">' + baht(o.cpm) + '</td>'
        + '<td class="num">' + intf(o.conv) + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted,#64748B);padding:18px">ไม่มีข้อมูลในช่วง/ตัวกรองนี้</td></tr>';
    h += '<div class="sec-title">' + esc(gname) + ' · ' + agg.length + ' รายการ (เรียงตามค่าแอด)</div>';
    h += '<div class="table-wrap"><table class="data-table"><thead><tr>'
      + '<th>' + esc(gname) + '</th><th class="num">ค่าแอด</th><th class="num">Impr</th><th class="num">คลิก</th><th class="num">CTR</th><th class="num">CPC</th><th class="num">CPM</th><th class="num">Conv</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table></div>';

    w.innerHTML = h;

    // bind
    w.querySelectorAll('[data-rng]').forEach(function (b) { b.onclick = function () { ST.days = b.getAttribute('data-rng'); load(); }; });
    w.querySelectorAll('[data-grp]').forEach(function (b) { b.onclick = function () { ST.groupBy = b.getAttribute('data-grp'); render(); }; });
    var ap = document.getElementById('axPlat'); if (ap) ap.onchange = function () { ST.platform = ap.value; render(); };
    var aa = document.getElementById('axAcc'); if (aa) aa.onchange = function () { ST.account = aa.value; render(); };
    var ag = document.getElementById('axPage'); if (ag) ag.onchange = function () { ST.page = ag.value; render(); };
  }

  window.mountAdexplore = function () { if ($w()) { if (!ST.rows.length && !ST.loading) load(); else render(); } };
})();
