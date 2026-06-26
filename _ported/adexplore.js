// _ported/adexplore.js — "โฆษณา · เจาะลึก (Explorer)" · interactive multi-platform ad analytics
// ดึง ad_daily ผ่าน meta_sync mode=explore (ทุก platform: meta/google/tiktok โผล่เองเมื่อมีข้อมูล)
// เลือกช่วงเวลา (preset หรือ custom วันเอง) + กรอง แผนก/platform/แบรนด์/เพจ + group by + metrics ครบ
// แผนก 4: KneeCare(Ortho)/Yiaoya/Resto Pilates/Massage (แมปจาก PAGE tag ในชื่อแคมเปญ + ชื่อบัญชี)
// pattern: window.mountAdexplore render เข้า #wrap-adexplore · ใช้ window.sb · ห้าม redeclare global

(function () {
  var ST = { days: 90, since: '', until: '', dept: '', platform: '', account: '', page: '', groupBy: 'dept', custType: 'new', rows: [], ads: [], roas: null, sales: [], expanded: {}, loading: false, err: '' };
  function isExec() { var r = (typeof window !== 'undefined' && window.currentRole) || ''; return ['director', 'hq', 'admin', 'owner'].indexOf(r) >= 0; }
  // แมป "แผนกบริการ" (จาก JERA dept_sales ภาษาไทย) → "แผนกโฆษณา" (4 แผนก) เพื่อจับคู่รายได้↔ค่าแอด
  var SALE2AD = { 'กระดูกและข้อ': 'KneeCare (Ortho)', 'พิลาทิส': 'Resto Pilates', 'นวด': 'Massage', 'กายภาพ': 'Yiaoya', 'ผสม': 'Yiaoya', 'อื่นๆ': 'Yiaoya' };
  var RANGES = [['7', '7 วัน'], ['30', '30 วัน'], ['90', '90 วัน'], ['365', '1 ปี'], ['1200', 'ทั้งหมด']];
  var GROUPS = [['dept', 'แผนก'], ['platform', 'แพลตฟอร์ม'], ['account', 'แบรนด์/บัญชี'], ['campaign', 'แคมเปญ'], ['page', 'เพจ'], ['month', 'รายเดือน']];
  var PLAT_NAME = { meta: 'Meta (FB/IG)', google: 'Google Ads', tiktok: 'TikTok Ads' };

  // ── แมป 4 แผนก: PAGE tag ในชื่อแคมเปญก่อน → ชื่อบัญชี fallback ──
  function deptOf(r) {
    var p = String(r.page || '').toUpperCase();
    if (p.indexOf('KNEE') >= 0 || p.indexOf('ORTHO') >= 0) return 'KneeCare (Ortho)';
    if (p.indexOf('PILATES') >= 0 || p.indexOf('RESTO') >= 0) return 'Resto Pilates';
    if (p.indexOf('MASSAGE') >= 0 || p.indexOf('NUAD') >= 0 || p.indexOf('SPA') >= 0) return 'Massage';
    if (p.indexOf('YIAOYA') >= 0) return 'Yiaoya';
    var a = String(r.account || '').toLowerCase();
    if (a.indexOf('knee') >= 0 || a.indexOf('ortho') >= 0) return 'KneeCare (Ortho)';
    if (a.indexOf('resto') >= 0 || a.indexOf('pilates') >= 0) return 'Resto Pilates';
    if (a.indexOf('massage') >= 0) return 'Massage';
    if (a.indexOf('yiaoya') >= 0) return 'Yiaoya';
    return 'อื่นๆ / ไม่ระบุ';
  }

  // ── ถอดรหัสชื่อแคมเปญ (tag |CO:..|CL:..|PG:..|BGT:..|PAGE:..|) → อ่านออกว่า "ยิงอะไร" ──
  var CO_MAP = { SALE: 'ขายของ', SALES: 'ขายของ', ENGAGEMENT: 'มีส่วนร่วม', ENGAGE: 'มีส่วนร่วม', LEADS: 'เก็บลีด', LEAD: 'เก็บลีด', TRAFFIC: 'ดึงคนเข้าชม', AWARENESS: 'สร้างการรับรู้', REACH: 'เข้าถึงคนเยอะ', MESSAGES: 'ทักแชท', MESSAGE: 'ทักแชท' };
  var CL_MAP = { INBOX: 'ทักแชท (Inbox)', LEAD: 'ฟอร์มเก็บลีด', TRAFFIC: 'เข้าเว็บ/เพจ', CALL: 'โทรหา', WHATSAPP: 'WhatsApp', MESSENGER: 'Messenger' };
  function tag(name, key) { var m = new RegExp('(?:^|\\|)\\s*' + key + ':([^|]+)', 'i').exec(name || ''); return m ? m[1].trim().toUpperCase() : ''; }
  function decodeCampaign(name) {
    var co = tag(name, 'CO'), cl = tag(name, 'CL'), pg = tag(name, 'PG'), bgt = tag(name, 'BGT'), pageT = tag(name, 'PAGE');
    var parts = [];
    if (co) parts.push('ยิงเพื่อ: ' + (CO_MAP[co] || co));
    if (cl) parts.push('วิธี: ' + (CL_MAP[cl] || cl));
    if (pg) parts.push('เน้น: ' + pg.replace(/\./g, ' '));
    if (bgt) parts.push('งบ: ' + (bgt === 'DAILY' ? 'รายวัน' : bgt === 'LIFETIME' ? 'ตลอดแคมเปญ' : bgt));
    if (pageT) parts.push('เพจ: ' + pageT);
    return parts;
  }

  function $w() { return document.getElementById('wrap-adexplore'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function baht(n) { return '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 }); }
  function intf(n) { return Number(n || 0).toLocaleString('th-TH'); }
  function pct(n) { return (Number(n || 0)).toFixed(2) + '%'; }
  function getSb() { return (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null); }

  function load() {
    var sb = getSb(); if (!sb || !sb.functions) { ST.err = 'ไม่พบการเชื่อมต่อ'; return render(); }
    ST.loading = true; render();
    var body = (ST.since && ST.until) ? { mode: 'explore', since: ST.since, until: ST.until } : { mode: 'explore', days: Number(ST.days) };
    Promise.all([
      sb.functions.invoke('meta_sync', { body: body }),
      sb.functions.invoke('ad_creative').catch(function () { return { data: {} }; }),
      sb.functions.invoke('ad_roas', { body: { days: Number(ST.days) || 90 } }).catch(function () { return { data: {} }; }),  // ROAS รวม (org) จาก JERA
      sb.functions.invoke('dept_sales', { body: { action: 'get' } }).catch(function () { return { data: {} }; })  // รายได้รายแผนก (JERA service/course)
    ]).then(function (arr) {
      var d = (arr[0] && arr[0].data) || {};
      ST.rows = (d.ok && Array.isArray(d.rows)) ? d.rows : [];
      ST.ads = (((arr[1] && arr[1].data) || {}).rows) || [];
      ST.roas = (arr[2] && arr[2].data) || null;
      ST.sales = (((arr[3] && arr[3].data) || {}).rows) || [];
      ST.err = d.ok ? '' : (d.error || (arr[0] && arr[0].error && arr[0].error.message) || 'โหลดไม่ได้');
      ST.loading = false; render();
    }).catch(function (e) { ST.loading = false; ST.err = String(e && e.message || e); render(); });
  }

  function filtered() {
    return ST.rows.filter(function (r) {
      if (ST.dept && deptOf(r) !== ST.dept) return false;
      if (ST.platform && r.platform !== ST.platform) return false;
      if (ST.account && r.account !== ST.account) return false;
      if (ST.page && (r.page || '') !== ST.page) return false;
      return true;
    });
  }

  function keyOf(r) {
    if (ST.groupBy === 'dept') return deptOf(r);
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

  function adsFor(camp) {
    return ST.ads.filter(function (r) { return (r.campaign || '') === camp; }).map(function (r) {
      var impr = Number(r.impressions) || 0, clk = Number(r.clicks) || 0, vv = Number(r.video_views) || 0;
      return { ad: r.ad_name || r.creative_id || '(ไม่มีชื่อ)', spend: Number(r.spend) || 0, impr: impr, reach: Number(r.reach) || 0, ctr: impr ? clk / impr * 100 : 0, watch: vv ? (Number(r.v_p100) || 0) / vv * 100 : 0, msg: Number(r.messages) || 0 };
    }).sort(function (a, b) { return b.spend - a.spend; });
  }

  // ค่าที่ใช้เติม dropdown — รองรับ dept (คำนวณ) ด้วย
  function uniq(field) {
    var s = {}, out = [];
    ST.rows.forEach(function (r) {
      var v = field === 'dept' ? deptOf(r) : (field === 'page' ? (r.page || '') : r[field]);
      if (v && !s[v]) { s[v] = 1; out.push(v); }
    });
    out.sort(); return out;
  }

  function btn(active, label, attr) {
    return '<button ' + attr + ' style="padding:6px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;border:1px solid ' + (active ? '#3DC5B7' : 'var(--border,#E2E8F0)') + ';background:' + (active ? '#3DC5B7' : '#fff') + ';color:' + (active ? '#04342C' : 'var(--navy,#0D2F4F)') + '">' + esc(label) + '</button>';
  }
  function sel(id, cur, opts, ph) {
    var o = '<option value="">' + esc(ph) + '</option>' + opts.map(function (v) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(PLAT_NAME[v] || v) + '</option>'; }).join('');
    return '<select id="' + id + '" style="padding:7px 10px;border:1px solid var(--border,#E2E8F0);border-radius:8px;font-size:12px;font-family:inherit;background:#fff;color:var(--navy,#0D2F4F);max-width:200px">' + o + '</select>';
  }
  function dinput(id, val) {
    return '<input type="date" id="' + id + '" value="' + esc(val) + '" style="padding:6px 8px;border:1px solid var(--border,#E2E8F0);border-radius:8px;font-size:12px;font-family:inherit;color:var(--navy,#0D2F4F)">';
  }

  // เดือน (YYYY-MM) ที่อยู่ในช่วงเวลาปัจจุบัน — เพื่อ align รายได้รายเดือนกับค่าแอด
  function monthsInRange() {
    var from, to;
    if (ST.since && ST.until) { from = ST.since.slice(0, 7); to = ST.until.slice(0, 7); }
    else { to = new Date().toISOString().slice(0, 7); from = new Date(Date.now() - (Number(ST.days) || 90) * 86400000).toISOString().slice(0, 7); }
    var set = {}, y = +from.slice(0, 4), m = +from.slice(5, 7), ey = +to.slice(0, 4), em = +to.slice(5, 7), guard = 0;
    while ((y < ey || (y === ey && m <= em)) && guard++ < 60) { set[y + '-' + ('0' + m).slice(-2)] = 1; m++; if (m > 12) { m = 1; y++; } }
    return set;
  }
  // รายได้รายแผนก (จาก dept_sales · JERA service/course) แมปเป็น 4 แผนกโฆษณา · เฉพาะเดือนในช่วง
  function revByDept() {
    var mset = monthsInRange(), m = {}, newOnly = (ST.custType !== 'all');
    ST.sales.forEach(function (s) { if (!mset[s.month]) return; if (newOnly && !s.new_patient) return; var ad = SALE2AD[s.dept] || 'อื่นๆ / ไม่ระบุ'; m[ad] = (m[ad] || 0) + (Number(s.amount) || 0); });
    return m;
  }

  // ── Performance รายแผนก (ค่าแอด/conv/engagement/CPA + รายได้/ROAS) — กราฟ + ranking ──
  function perfByDept() {
    var rows = ST.rows.filter(function (r) { if (ST.platform && r.platform !== ST.platform) return false; if (ST.account && r.account !== ST.account) return false; if (ST.page && (r.page || '') !== ST.page) return false; return true; });
    var m = {};
    rows.forEach(function (r) { var d = deptOf(r); var o = m[d] || (m[d] = { dept: d, spend: 0, conv: 0, impr: 0, clicks: 0, eng: 0 }); o.spend += Number(r.spend) || 0; o.conv += Number(r.conversions) || 0; o.impr += Number(r.impressions) || 0; o.clicks += Number(r.clicks) || 0; });
    ST.ads.forEach(function (a) { var d = deptOf({ page: tag(a.campaign || '', 'PAGE'), account: a.adset_name }); if (m[d]) m[d].eng += (Number(a.post_engagement) || ((Number(a.reactions) || 0) + (Number(a.comments) || 0))); });
    var arr = Object.keys(m).map(function (k) { return m[k]; });
    var rev = revByDept();
    arr.forEach(function (o) { o.cpa = o.conv ? o.spend / o.conv : null; o.ctr = o.impr ? o.clicks / o.impr * 100 : 0; o.rev = rev[o.dept] || 0; o.roas = (o.spend > 0 && o.rev > 0) ? o.rev / o.spend : null; });
    arr.sort(function (a, b) { return b.spend - a.spend; });
    return arr;
  }
  function renderPerf() {
    var p = perfByDept(); if (!p.length) return '';
    var maxSp = Math.max.apply(null, p.map(function (o) { return o.spend; }).concat([1]));
    // best = ROAS สูงสุด (คุ้มสุดจริง) ในกลุ่มที่มีรายได้
    var withRoas = p.filter(function (o) { return o.roas != null; });
    var best = withRoas.length ? withRoas.reduce(function (a, b) { return a.roas >= b.roas ? a : b; }).dept : '';
    var roasC = function (r) { return r == null ? 'var(--text-muted,#64748B)' : r >= 3 ? '#047857' : r >= 1 ? '#B45309' : '#B91C1C'; };
    var bars = p.map(function (o) {
      var wd = Math.round(o.spend / maxSp * 100), isBest = o.dept === best;
      var roasTxt = o.roas != null ? 'ROAS ' + o.roas.toFixed(2) + 'x' : (o.spend > 0 ? 'ยังไม่มีรายได้จับคู่' : '');
      return '<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="font-weight:700;color:var(--navy,#0D2F4F)">' + esc(o.dept) + (isBest ? ' <span style="font-size:10px;color:#047857;background:#D1FAE5;border-radius:6px;padding:1px 6px">คุ้มสุด ROAS สูง</span>' : '') + '</span><span style="color:var(--text-muted,#64748B)">แอด ' + baht(o.spend) + ' → รายได้ ' + baht(o.rev) + ' · <b style="color:' + roasC(o.roas) + '">' + roasTxt + '</b></span></div><div style="height:10px;background:#EEF2F6;border-radius:5px;overflow:hidden"><div style="width:' + Math.max(wd, 2) + '%;height:100%;background:' + (isBest ? 'linear-gradient(90deg,#3DC5B7,#047857)' : '#185FA5') + '"></div></div></div>';
    }).join('');
    var rankBody = p.map(function (o) { return '<tr><td class="name-cell">' + esc(o.dept) + '</td><td class="num">' + baht(o.spend) + '</td><td class="num rev-cell">' + baht(o.rev) + '</td><td class="num"><b style="color:' + roasC(o.roas) + '">' + (o.roas != null ? o.roas.toFixed(2) + 'x' : '—') + '</b></td><td class="num">' + intf(o.conv) + '</td><td class="num">' + (o.cpa != null ? baht(o.cpa) : '—') + '</td><td class="num">' + intf(o.eng) + '</td></tr>'; }).join('');
    return '<div class="sec-title">Performance รายแผนก · ใครคุ้มสุด (ค่าแอด → รายได้ → ROAS)</div>'
      + '<div class="card" style="padding:14px;margin-bottom:14px">' + bars + '</div>'
      + '<div class="table-wrap"><table class="data-table"><thead><tr><th>แผนก</th><th class="num">ค่าแอด</th><th class="num">รายได้</th><th class="num">ROAS</th><th class="num">Conv</th><th class="num">฿/Conv</th><th class="num">Engagement</th></tr></thead><tbody>' + rankBody + '</tbody></table></div>'
      + '<div style="font-size:11px;color:var(--text-muted,#64748B);margin:-6px 0 14px">ฐานรายได้: <b>' + (ST.custType === 'all' ? 'ลูกค้าใหม่ + เก่า (รวม)' : 'ลูกค้าใหม่เท่านั้น (แอดพามาจริง)') + '</b> · จาก JERA (บริการ/คอร์ส) แมปเข้าแผนก เทียบเดือนเดียวกับค่าแอด · กระดูกและข้อ→KneeCare · พิลาทิส→Resto · นวด→Massage · กายภาพ/ผสม→Yiaoya</div>';
  }

  function render() {
    var w = $w(); if (!w) return;
    if (ST.loading) { w.innerHTML = '<div class="empty-card"><i class="ti ti-loader"></i><span>กำลังโหลดข้อมูลโฆษณา…</span></div>'; return; }
    if (ST.err) { w.innerHTML = '<div class="empty-card"><i class="ti ti-alert-triangle"></i><span>' + esc(ST.err) + '</span></div>'; return; }

    var custom = !!(ST.since && ST.until);
    var rows = filtered();
    var agg = aggregate(rows);
    var tot = agg.reduce(function (a, o) { return { spend: a.spend + o.spend, impr: a.impr + o.impr, clicks: a.clicks + o.clicks, conv: a.conv + o.conv }; }, { spend: 0, impr: 0, clicks: 0, conv: 0 });
    var tctr = tot.impr ? (tot.clicks / tot.impr * 100) : 0, tcpc = tot.clicks ? (tot.spend / tot.clicks) : 0, tcpm = tot.impr ? (tot.spend / tot.impr * 1000) : 0;

    var h = '';
    // ช่วงเวลา: preset + custom เลือกวันเอง
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">'
      + RANGES.map(function (r) { return btn(!custom && ST.days == r[0], r[1], 'data-rng="' + r[0] + '"'); }).join('')
      + '<span style="color:var(--text-muted,#64748B);font-size:12px;margin:0 4px">|</span>'
      + dinput('axFrom', ST.since) + '<span style="font-size:12px;color:var(--text-muted,#64748B)">ถึง</span>' + dinput('axTo', ST.until)
      + btn(custom, 'ใช้ช่วงนี้', 'id="axApply"') + '</div>';
    // ตัวกรอง
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px">'
      + sel('axDept', ST.dept, uniq('dept'), 'ทุกแผนก')
      + sel('axPlat', ST.platform, uniq('platform'), 'ทุกแพลตฟอร์ม')
      + sel('axAcc', ST.account, uniq('account'), 'ทุกแบรนด์/บัญชี')
      + sel('axPage', ST.page, uniq('page'), 'ทุกเพจ') + '</div>';
    // มุมมอง
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><span style="font-size:12px;color:var(--text-muted,#64748B)">มุมมอง:</span>'
      + GROUPS.map(function (g) { return btn(ST.groupBy === g[0], g[1], 'data-grp="' + g[0] + '"'); }).join('') + '</div>';
    // ฐานรายได้/ROAS: ลูกค้าใหม่ (แอดพามา · honest) vs รวมเก่า (เฉพาะผู้บริหาร)
    var exec = isExec(); if (!exec) ST.custType = 'new';
    h += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:14px;flex-wrap:wrap"><span style="font-size:12px;color:var(--text-muted,#64748B)">ฐานรายได้/ROAS:</span>'
      + btn(ST.custType === 'new', 'ลูกค้าใหม่ (แอดพามา)', 'data-cust="new"')
      + (exec ? btn(ST.custType === 'all', 'ใหม่+เก่า (รวม)', 'data-cust="all"') : '<span style="font-size:11px;color:var(--text-muted,#64748B)">· รวมคนไข้เก่า = เฉพาะผู้บริหาร</span>')
      + '</div>';

    var card = function (l, v, sub) { return '<div style="background:var(--surface,#fff);border:1px solid var(--border,#E2E8F0);border-radius:12px;padding:11px 14px;flex:1;min-width:120px"><div style="font-size:10.5px;color:var(--text-muted,#64748B);font-weight:600;text-transform:uppercase">' + l + '</div><div style="font-size:20px;font-weight:800;color:var(--navy,#0D2F4F)">' + v + '</div><div style="font-size:10.5px;color:var(--text-muted,#64748B)">' + (sub || '') + '</div></div>'; };
    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">'
      + card('ค่าโฆษณา', baht(tot.spend), custom ? (ST.since + ' → ' + ST.until) : (ST.days == '1200' ? 'ทั้งหมด' : ST.days + ' วัน'))
      + card('Impressions', intf(tot.impr), 'CTR ' + pct(tctr))
      + card('คลิก', intf(tot.clicks), 'CPC ' + baht(tcpc))
      + card('CPM', baht(tcpm), 'ต่อ 1,000 impr')
      + card('Conversions', intf(tot.conv), 'จากแอด')
      + (ST.roas && ST.roas.roas != null ? card('ROAS รวม', ST.roas.roas + 'x', 'ยอดขาย ' + baht(ST.roas.total_sales) + ' · ทั้งองค์กร') : '')
      + '</div>';

    // กราฟ performance รายแผนก (ใครคุ้มสุด)
    h += renderPerf();

    var gname = (GROUPS.filter(function (g) { return g[0] === ST.groupBy; })[0] || ['', 'รายการ'])[1];
    var isCamp = ST.groupBy === 'campaign';
    var body = agg.map(function (o) {
      var caret = isCamp ? '<span style="color:#3DC5B7;font-weight:700">' + (ST.expanded[o.key] ? '▾ ' : '▸ ') + '</span>' : '';
      var tr = '<tr ' + (isCamp ? 'data-camp="' + esc(o.key) + '" style="cursor:pointer"' : '') + '>'
        + '<td class="name-cell" title="' + esc(o.key) + '">' + caret + esc(o.key.length > 60 ? o.key.slice(0, 60) + '…' : o.key) + '</td>'
        + '<td class="num">' + baht(o.spend) + '</td><td class="num">' + intf(o.impr) + '</td><td class="num">' + intf(o.clicks) + '</td>'
        + '<td class="num">' + pct(o.ctr) + '</td><td class="num">' + baht(o.cpc) + '</td><td class="num">' + baht(o.cpm) + '</td><td class="num">' + intf(o.conv) + '</td></tr>';
      if (isCamp && ST.expanded[o.key]) {
        var dc = decodeCampaign(o.key);
        var decoded = dc.length ? '<div style="padding:7px 10px 2px 26px;font-size:11.5px;color:#0F766E">' + dc.map(function (x) { return '<span style="background:#E1F5EE;border-radius:6px;padding:2px 8px;margin-right:5px;display:inline-block;margin-bottom:4px">' + esc(x) + '</span>'; }).join('') + '</div>' : '';
        var ads = adsFor(o.key);
        var adRows = ads.length ? ads.map(function (a) { return '<tr style="font-size:11.5px"><td style="padding:4px 8px;color:var(--navy,#0D2F4F)">' + esc(a.ad.length > 50 ? a.ad.slice(0, 50) + '…' : a.ad) + '</td><td style="text-align:right;padding:4px 8px">' + baht(a.spend) + '</td><td style="text-align:right;padding:4px 8px">' + intf(a.impr) + '</td><td style="text-align:right;padding:4px 8px">' + intf(a.reach) + '</td><td style="text-align:right;padding:4px 8px">' + pct(a.ctr) + '</td><td style="text-align:right;padding:4px 8px">' + pct(a.watch) + '</td><td style="text-align:right;padding:4px 8px;font-weight:700">' + intf(a.msg) + '</td></tr>'; }).join('') : '<tr><td colspan="7" style="padding:6px 8px;font-size:11px;color:var(--text-muted,#64748B)">ไม่มีข้อมูลรายโฆษณา (ad_creative) ของแคมเปญนี้ในช่วงที่เก็บ</td></tr>';
        tr += '<tr style="background:#F1F8F7"><td colspan="8" style="padding:0 0 6px">' + decoded + '<table style="width:100%;border-collapse:collapse"><thead><tr style="color:var(--text-muted,#64748B);font-size:10.5px"><th style="text-align:left;padding:4px 8px 4px 26px">↳ รายโฆษณา</th><th style="text-align:right;padding:4px 8px">ค่าแอด</th><th style="text-align:right;padding:4px 8px">Impr</th><th style="text-align:right;padding:4px 8px">Reach</th><th style="text-align:right;padding:4px 8px">CTR</th><th style="text-align:right;padding:4px 8px">ดูจบ</th><th style="text-align:right;padding:4px 8px">แชท</th></tr></thead><tbody>' + adRows + '</tbody></table></td></tr>';
      }
      return tr;
    }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted,#64748B);padding:18px">ไม่มีข้อมูลในช่วง/ตัวกรองนี้</td></tr>';
    h += '<div class="sec-title">' + esc(gname) + ' · ' + agg.length + ' รายการ (เรียงตามค่าแอด)' + (isCamp ? ' <span style="font-size:11px;font-weight:400;color:var(--text-muted,#64748B)">— กดแถวเพื่อดูว่ายิงอะไร + รายโฆษณา</span>' : '') + '</div>';
    h += '<div class="table-wrap"><table class="data-table"><thead><tr><th>' + esc(gname) + '</th><th class="num">ค่าแอด</th><th class="num">Impr</th><th class="num">คลิก</th><th class="num">CTR</th><th class="num">CPC</th><th class="num">CPM</th><th class="num">Conv</th></tr></thead><tbody>' + body + '</tbody></table></div>';

    w.innerHTML = h;

    w.querySelectorAll('[data-rng]').forEach(function (b) { b.onclick = function () { ST.days = b.getAttribute('data-rng'); ST.since = ''; ST.until = ''; load(); }; });
    w.querySelectorAll('[data-grp]').forEach(function (b) { b.onclick = function () { ST.groupBy = b.getAttribute('data-grp'); render(); }; });
    w.querySelectorAll('[data-cust]').forEach(function (b) { b.onclick = function () { if (!isExec()) return; ST.custType = b.getAttribute('data-cust'); render(); }; });
    w.querySelectorAll('[data-camp]').forEach(function (tr) { tr.onclick = function () { var c = tr.getAttribute('data-camp'); ST.expanded[c] = !ST.expanded[c]; render(); }; });
    var ax = document.getElementById('axApply'); if (ax) ax.onclick = function () { var f = document.getElementById('axFrom'), t = document.getElementById('axTo'); if (f && t && f.value && t.value) { ST.since = f.value; ST.until = t.value; load(); } };
    var bindSel = function (id, k) { var el = document.getElementById(id); if (el) el.onchange = function () { ST[k] = el.value; render(); }; };
    bindSel('axDept', 'dept'); bindSel('axPlat', 'platform'); bindSel('axAcc', 'account'); bindSel('axPage', 'page');
  }

  window.mountAdexplore = function () { if ($w()) { if (!ST.rows.length && !ST.loading) load(); else render(); } };
})();
