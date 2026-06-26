// _ported/leadmkt.js — Native read-only page "Lead & การตลาด (Lead & Marketing analytics)" สำหรับ Supabase dashboard
// ผู้บริหาร/การตลาด ดู — ROI/ROAS/CPA แยกตามช่องทาง·แคมเปญ·รายเดือน · อ่านอย่างเดียว (aggregate ไม่มี PII)
//
// ทำตาม pattern เดียวกับ _ported/fosales.js + _ported/scorecard.js:
//   - mountLeadmkt render เข้า #wrap-leadmkt
//   - ใช้ global window.sb (index.html module scope) — ห้าม redeclare
//   - CSS scope ใต้ #lm · markup คง element id เดิม
//   - fn ที่ inline onclick ต้องใช้ → ผูกกับ window (prefix lm*) กันชน
//   - helper (esc/showToast) inline ใน scope
//
// backend — เรียก 3 type ผ่าน hr_list?type=...&limit=2000 แล้วรวม (defensive · field เดา · กัน null/throw):
//   1. lead_source.updated        → channels[]  (รหัสช่องทาง, ชื่อ, หมวดหมู่, งบรายเดือน, สถานะ)
//   2. campaign.roi.updated       → campaigns[] (รหัส, ชื่อ, ช่องทาง, งบใช้จริง, leads, ลูกค้าจริง, รายได้, ROI%)
//   3. lead.performance.monthly   → monthly[]   (เดือน, ช่องทาง, ลูกค้าใหม่/กลับมา, รายได้, งบ, CPA, ROAS, Conv.Rate, เป้า)
//   ข้อมูลจริงมาทีหลัง — ตอนนี้อาจว่าง → empty state สวย ไม่ error

/* ============================================================
   LM_BACKEND — ดึง 3 type จาก Supabase edge fn hr_list แล้ว normalize · กรอง/group ฝั่ง client
   ============================================================ */
var LM_FN = 'hr_list';
var LM_TYPE_CHANNEL = 'lead_source.updated';
var LM_TYPE_CAMPAIGN = 'campaign.roi.updated';
var LM_TYPE_MONTHLY = 'lead.performance.monthly';
var LM_LIMIT = 2000;

function lm2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function lm2Num(v) {
  if (v == null || v === '') return 0;
  var n = Number(v);
  return isFinite(n) ? n : 0;
}
// คืน null ถ้าไม่มีค่าจริง (ใช้กับ metric ที่อยากแยก "ไม่มีข้อมูล" ออกจาก 0)
function lm2NumOrNull(v) {
  if (v == null || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}
function lm2Str(v) {
  if (v == null) return '';
  return String(v).trim();
}
// คืน 'YYYY-MM' จากค่าวันที่/เดือน ; ถ้าไม่ใช่วันที่ → คืนสตริงดิบ
function lm2Month(v) {
  if (v == null || v === '') return '';
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  var d = new Date(s);
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1);
  }
  return s;
}

// ---- map row แต่ละ type (field เดา · กัน null) ----

// 1. ช่องทาง (lead source)
function lm2MapChannel(p) {
  p = p || {};
  var id = lm2Str(p.channel_id || p.source_id || p.lead_source_id || p.code || p.id || p.entity_id);
  var name = lm2Str(p.channel_name || p.source_name || p.lead_source_name || p.name || p.channel || p.source);
  if (!name) name = id;
  if (!id) id = name;
  return {
    channel_id: id || '—',
    channel_name: name || id || '—',
    category: lm2Str(p.category || p.channel_category || p.group || p.type_label || p.media_type),
    monthly_budget: lm2Num(p.monthly_budget || p.budget_monthly || p.budget || p.planned_budget),
    status: lm2Str(p.status || p.state || p.active_status) || (p.active === false ? 'inactive' : (p.active === true ? 'active' : '')),
    // ---- Conversion ROAS (funnel จริงจาก FO + ค่าแอด) ----
    actual_spend: lm2Num(p.actual_spend || p.spend),
    fo_leads: lm2Num(p.fo_leads),
    fo_appointments: lm2Num(p.fo_appointments),
    fo_showed: lm2Num(p.fo_showed),
    cost_per_lead: lm2NumOrNull(p.cost_per_lead),
    cost_per_appt: lm2NumOrNull(p.cost_per_appt),
    cost_per_show: lm2NumOrNull(p.cost_per_show),
    _raw: p,
  };
}

// ---- JS port ของ campaign_name_parser.parse_campaign — แกะชื่อแคมเปญฝั่ง client ----
// ใช้เป็น fallback เมื่อ backend ยังไม่เติมฟิลด์ (เช่น entity เก่า/จาก publisher อื่น) ทุก entity มี campaign_name ดิบอยู่แล้ว
var LM_CL_LOCATION = { 'INBOX': 'ทักแชต (Messages)', 'ON-YOUR-AD-INTERACTION': 'มีปฏิสัมพันธ์บนโฆษณา', 'ON-YOUR-AD-VIDEOVIEW': 'ดูวิดีโอบนโฆษณา' };
var LM_CL_AS_OBJ = { 'AWARENESS': 1, 'REACH': 1 };
var LM_CO_LABEL = { 'SALE': 'ยอดขาย', 'ENGAGEMENT': 'การมีส่วนร่วม', 'AWARENESS': 'การรับรู้', 'REACH': 'การเข้าถึง' };
var LM_PG_LABEL = { 'MAX.CONV': 'คอนเวอร์ชันสูงสุด', 'MAX.INTERACT': 'ปฏิสัมพันธ์สูงสุด', 'MAX.THRUPLAY': 'ดูวิดีโอจบสูงสุด', 'MAX.REACH': 'เข้าถึงสูงสุด', 'MAX.MES': 'ข้อความสูงสุด' };
var LM_BGS_LABEL = { 'CBO': 'เกลี่ยงบทั้งแคมเปญ (CBO)', 'ASB': 'เกลี่ยงบระดับชุดโฆษณา (ASB/ABO)' };
var LM_BGT_LABEL = { 'LIFETIME': 'งบตลอดอายุ', 'DAILY': 'งบรายวัน' };
var LM_PAGE_LABEL = { 'YIAOYA': 'Yiaoya (รวม)', 'PILATES': 'Pilates', 'KNEE': 'KneeCare (เข่า)' };
var LM_PROGRAM_FIX = { 'PILATES_RROMOTION': 'PILATES_PROMOTION' };
var LM_MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

function lm2NormDate(tok) {
  tok = String(tok || '').trim();
  if (/^\d{8}$/.test(tok)) return { d: tok.slice(0, 4) + '-' + tok.slice(4, 6) + '-' + tok.slice(6, 8), bare: false };
  var m = /^([A-Z]{3})(\d{4})$/.exec(tok);
  if (m && LM_MONTHS[m[1]]) return { d: m[2] + '-' + ('0' + LM_MONTHS[m[1]]).slice(-2) + '-01', bare: true };
  return { d: null, bare: false };
}

function lm2ParseName(raw) {
  raw = String(raw || '').trim();
  var out = { raw_name: raw, name_gen: 'legacy', prod: '', prod_label: '', conv_loc: '', conv_loc_label: '', objective: '', objective_label: '', perf_goal: '', perf_goal_label: '', budget_strat: '', budget_strat_label: '', budget_type: '', budget_type_label: '', start_date: '', program: '', flags: [] };
  var m = /(PL:.*)$/.exec(raw);              // ตัด prefix เช่น "meta:Yiaoya:" ทิ้ง
  if (!m) return out;
  var toks = m[1].split('|'), kv = {}, bare = [], hasKey = {};
  for (var i = 0; i < toks.length; i++) {
    var t = toks[i].trim(); if (!t) continue;
    var ci = t.indexOf(':');
    if (ci < 0) { bare.push(t); continue; }
    var key = t.slice(0, ci).trim().toUpperCase();
    var val = t.slice(ci + 1).trim();
    if (val.charAt(0) === ':') { val = val.replace(/^:+/, '').trim(); out.flags.push(key + '_double_colon'); }
    kv[key] = val; hasKey[key] = 1;
  }
  if (!hasKey.PL) return out;
  var page = (kv.PAGE || '').toUpperCase();
  out.prod = page; out.prod_label = LM_PAGE_LABEL[page] || page;
  var co = (kv.CO || '').toUpperCase();
  var cl = (kv.CL || '').toUpperCase();
  if (LM_CL_AS_OBJ[cl]) { if (!co) co = cl; out.conv_loc = ''; out.flags.push('cl_was_objective_normalized'); }
  else out.conv_loc = cl;
  out.conv_loc_label = LM_CL_LOCATION[out.conv_loc] || out.conv_loc;
  out.objective = co; out.objective_label = LM_CO_LABEL[co] || co;
  var pg = (kv.PG || '').toUpperCase(); out.perf_goal = pg; out.perf_goal_label = LM_PG_LABEL[pg] || pg;
  var bgs = (kv.BGS || '').toUpperCase(), bgt = (kv.BGT || '').toUpperCase();
  if (bgt === 'CBO' || bgt === 'ASB') { if (!bgs) bgs = bgt; out.flags.push('bgt_had_strat_value'); bgt = ''; }
  out.budget_strat = bgs; out.budget_strat_label = LM_BGS_LABEL[bgs] || bgs;
  out.budget_type = bgt; out.budget_type_label = LM_BGT_LABEL[bgt] || bgt;
  var prog = (kv.PROGRAM || '').trim();
  if (prog) { if (LM_PROGRAM_FIX[prog.toUpperCase()]) { prog = LM_PROGRAM_FIX[prog.toUpperCase()]; out.flags.push('program_typo_fixed'); } out.program = prog; }
  var sd = null, fromBare = false;
  if (kv.STA) { sd = lm2NormDate(kv.STA).d; }
  if (!sd) { for (var b = 0; b < bare.length; b++) { var r = lm2NormDate(bare[b]); if (r.d) { sd = r.d; fromBare = r.bare; break; } } }
  out.start_date = sd || '';
  if (fromBare) out.flags.push('date_from_bare_month');
  out.name_gen = kv.STA ? 'A' : (hasKey.PROGRAM ? 'B' : 'A-');
  return out;
}

// 2. แคมเปญ (campaign ROI)
function lm2MapCampaign(p) {
  p = p || {};
  var id = lm2Str(p.campaign_id || p.code || p.id || p.entity_id);
  var name = lm2Str(p.campaign_name || p.name || p.campaign || p.title);
  if (!name) name = id;
  if (!id) id = name;
  var spend = lm2Num(p.actual_spend || p.spend || p.budget_used || p.cost || p.budget_actual || p.budget);
  var leads = lm2Num(p.leads || p.lead_count || p.total_leads);
  var customers = lm2Num(p.customers || p.customer_count || p.conversions || p.real_customers || p.converted);
  // รายได้: FO ยอดปิด ถ้าไม่มี → ใช้ค่าที่ Meta รายงาน (conversion_value / meta_revenue) เป็น "ROAS ตามที่แพลตฟอร์มรายงาน"
  var revenue = lm2Num(p.revenue || p.revenue_total || p.sales || p.income);
  var metaRev = lm2Num(p.meta_revenue || p.conversion_value || p.conversion_values || p.purchase_value);
  // ใช้ revenue_source จาก backend ก่อน (publisher ตั้ง 'platform' เมื่อรายได้มาจาก Meta pixel) ไม่งั้นเดาเอง
  var revSource = lm2Str(p.revenue_source);
  if (!revSource) {
    if (revenue > 0) revSource = 'fo';
    else if (metaRev > 0) { revenue = metaRev; revSource = 'platform'; }
  } else if (revenue === 0 && metaRev > 0) { revenue = metaRev; }
  // ROI% : ใช้ field ถ้ามี ไม่งั้น derive จาก (รายได้-งบ)/งบ*100
  var roi = lm2NumOrNull(p.roi || p.roi_pct || p.roi_percent);
  if (roi == null) roi = spend > 0 && revenue > 0 ? ((revenue - spend) / spend) * 100 : null;
  // แกะชื่อแคมเปญฝั่ง client เป็น fallback (entity เก่า/prefix ไม่มีฟิลด์ parsed)
  var pc = lm2ParseName(p.raw_name || name);
  function pick(field, pcField) { return lm2Str(p[field]) || pc[pcField]; }
  return {
    campaign_id: id || '—',
    campaign_name: name || id || '—',
    channel: lm2Str(p.channel_name || p.channel || p.source || p.channel_id || p.lead_source),
    channel_id: lm2Str(p.channel_id || p.source_id || p.lead_source_id),
    account: lm2Str(p.account_name || p.account || p.ad_account || p.ad_account_name),
    page: lm2Str(p.page || p.page_name || p.fb_page),
    spend: spend,
    leads: leads,
    customers: customers,
    revenue: revenue,
    revenue_source: revSource,   // 'fo' = ยอดปิดจริง · 'platform' = Meta รายงาน (pixel, ก่อนหักต้นทุน)
    roi: roi,
    // ---- field parsed: ใช้ของ backend ก่อน ถ้าไม่มีแกะจากชื่อเอง (pc) ----
    raw_name: lm2Str(p.raw_name) || pc.raw_name || (name || id || ''),
    prod: pick('prod', 'prod'),
    prod_label: pick('prod_label', 'prod_label'),
    conv_loc: pick('conv_loc', 'conv_loc'),
    conv_loc_label: pick('conv_loc_label', 'conv_loc_label'),
    objective: pick('objective', 'objective'),
    objective_label: pick('objective_label', 'objective_label'),
    perf_goal: pick('perf_goal', 'perf_goal'),
    perf_goal_label: pick('perf_goal_label', 'perf_goal_label'),
    budget_strat: pick('budget_strat', 'budget_strat'),
    budget_strat_label: pick('budget_strat_label', 'budget_strat_label'),
    budget_type: pick('budget_type', 'budget_type'),
    budget_type_label: pick('budget_type_label', 'budget_type_label'),
    start_date: pick('start_date', 'start_date'),
    program: pick('program', 'program'),
    name_gen: pick('name_gen', 'name_gen'),
    parse_flags: (lm2ToArr(p.parse_flags).length ? lm2ToArr(p.parse_flags) : pc.flags),
    _raw: p,
  };
}

// 3. รายเดือน × ช่องทาง (monthly performance)
function lm2MapMonthly(p) {
  p = p || {};
  var monthRaw = p.month || p.period || p.date || p.ym;
  var month = lm2Month(monthRaw);
  var channel = lm2Str(p.channel_name || p.channel || p.source || p.lead_source || p.channel_id);
  var newC = lm2Num(p.new_customers || p.new_customer || p.customers_new || p.acquired);
  var retC = lm2Num(p.returning_customers || p.returning_customer || p.customers_returning || p.repeat_customers);
  var revenue = lm2Num(p.revenue || p.revenue_total || p.sales || p.income);
  var budget = lm2Num(p.budget || p.spend || p.cost || p.actual_spend || p.budget_used);
  var leads = lm2Num(p.leads || p.lead_count);
  // CPA : field ถ้ามี ไม่งั้น derive งบ/ลูกค้าใหม่
  var cpa = lm2NumOrNull(p.cpa || p.cost_per_acquisition || p.cost_per_customer);
  if (cpa == null) cpa = newC > 0 ? budget / newC : null;
  // ROAS : field ถ้ามี ไม่งั้น derive รายได้/งบ
  var roas = lm2NumOrNull(p.roas || p.return_on_ad_spend);
  if (roas == null) roas = budget > 0 ? revenue / budget : null;
  // Conv.Rate : field ถ้ามี ไม่งั้น derive ลูกค้าใหม่/leads*100
  var conv = lm2NumOrNull(p.conv_rate || p.conversion_rate || p.cvr);
  if (conv == null) conv = leads > 0 ? (newC / leads) * 100 : null;
  var target = lm2NumOrNull(p.target || p.target_revenue || p.goal || p.revenue_target);
  return {
    month: month,
    month_label: lm2Str(monthRaw) || month,
    channel: channel || '—',
    channel_id: lm2Str(p.channel_id || p.source_id),
    new_customers: newC,
    returning_customers: retC,
    revenue: revenue,
    budget: budget,
    leads: leads,
    cpa: cpa,
    roas: roas,
    conv_rate: conv,
    target: target,
    _raw: p,
  };
}

// ดึง 1 type → คืน items[] (กัน null/throw)
function lm2FetchType(type) {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) return Promise.resolve([]);
  var q = LM_FN + '?type=' + encodeURIComponent(type) + '&limit=' + LM_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    var data = (res && res.data) || {};
    return lm2ToArr(data.items);
  }).catch(function (e) {
    console.warn('[LM_BACKEND] fetch failed (' + type + ')', e);
    return [];
  });
}

var LM_BACKEND = {
  // list — { channels, campaigns, monthly, months, channelNames } (ฝั่ง client กรองเอง)
  lmList: function () {
    return Promise.all([
      lm2FetchType(LM_TYPE_CHANNEL),
      lm2FetchType(LM_TYPE_CAMPAIGN),
      lm2FetchType(LM_TYPE_MONTHLY),
    ]).then(function (parts) {
      var rawCh = parts[0] || [], rawCmp = parts[1] || [], rawMon = parts[2] || [];

      // ช่องทาง — de-dup ตาม channel_id
      var chSeen = {}, channels = [];
      rawCh.forEach(function (p) {
        var c = lm2MapChannel(p);
        var key = c.channel_id || c.channel_name;
        if (!key || chSeen[key]) return;
        chSeen[key] = true;
        channels.push(c);
      });

      // แคมเปญ — de-dup ตาม "ชื่อ canonical" (ตัด prefix meta:/meta:Yiaoya: ทิ้ง) กันแคมเปญเดียวซ้ำ 2 entity
      // ถ้าชนกัน เก็บตัวที่งบสูงกว่า (record ที่สมบูรณ์/ครอบคลุมประวัติมากกว่า) — ไม่บวกรวมกันกันนับซ้ำ
      function lm2CanonKey(c) {
        var n = c.raw_name || c.campaign_name || c.campaign_id || '';
        var m = /(PL:.*)$/.exec(n);          // ตัด prefix ใด ๆ ก่อน |PL:
        var canon = m ? m[1] : n;
        // ★ ใส่ "บัญชี" ใน key ด้วย — กันแคมเปญชื่อเดียวกันคนละบัญชีถูกยุบรวม (ทำให้ leads/รายได้/งบ ของอีกบัญชีหาย)
        var acct = String(c.account || c.account_id || '').replace(/\s+/g, '').toUpperCase();
        return acct + '||' + canon.replace(/\s+/g, '').toUpperCase();
      }
      // คะแนนความ "สมบูรณ์" ของ record: มี ROAS/รายได้ > มี prod > งบสูง — เลือกตัวที่สมบูรณ์สุดเมื่อชนกัน
      function lm2CmpScore(c) {
        var s = 0;
        if ((Number(c.revenue) || 0) > 0 || c.revenue_source === 'platform') s += 1e12;  // มีรายได้/ROAS = ดีสุด
        if (c.prod) s += 1e9;                                                              // แกะ prod ได้
        s += (Number(c.spend) || 0);                                                       // tie-break ด้วยงบ
        return s;
      }
      var cmpIdx = {}, campaigns = [];
      rawCmp.forEach(function (p) {
        var c = lm2MapCampaign(p);
        var key = lm2CanonKey(c);
        if (!key) return;
        if (cmpIdx[key] == null) { cmpIdx[key] = campaigns.length; campaigns.push(c); }
        else {
          var prev = campaigns[cmpIdx[key]];
          // เก็บงบสูงสุดไว้เสมอ (ครอบคลุมประวัติ) แต่เลือก record หลักจากตัวที่สมบูรณ์กว่า แล้วยกงบสูงมาด้วย
          var maxSpend = Math.max(Number(c.spend) || 0, Number(prev.spend) || 0);
          var win = lm2CmpScore(c) >= lm2CmpScore(prev) ? c : prev;
          win.spend = maxSpend;
          // recompute ROI จากงบสุดท้าย (กัน ROI ไม่ตรงกับ spend ที่โชว์ในแถวเดียวกัน)
          win.roi = (win.spend > 0 && (Number(win.revenue) || 0) > 0) ? ((Number(win.revenue) - win.spend) / win.spend) * 100 : null;
          campaigns[cmpIdx[key]] = win;
        }
      });

      // รายเดือน — de-dup ตาม month|channel
      var monSeen = {}, monthly = [];
      rawMon.forEach(function (p) {
        var r = lm2MapMonthly(p);
        if (!r.month) return;
        var key = r.month + '|' + (r.channel_id || r.channel);
        if (monSeen[key]) return;
        monSeen[key] = true;
        monthly.push(r);
      });

      // รวมรายชื่อเดือน (จาก monthly) + ช่องทาง (จากทุกแหล่ง) ไว้ทำ filter
      var mSeen = {}, months = [];
      monthly.forEach(function (r) {
        if (r.month && !mSeen[r.month]) { mSeen[r.month] = true; months.push(r.month); }
      });
      months.sort(function (a, b) { return String(b).localeCompare(String(a)); }); // ใหม่→เก่า

      var cnSeen = {}, channelNames = [];
      function addCn(name) {
        var n = lm2Str(name);
        if (n && !cnSeen[n]) { cnSeen[n] = true; channelNames.push(n); }
      }
      channels.forEach(function (c) { addCn(c.channel_name); });
      campaigns.forEach(function (c) { addCn(c.channel); });
      monthly.forEach(function (r) { addCn(r.channel); });
      channelNames.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });

      // รายชื่อสินค้า (prod_label fallback prod) จาก campaigns ไว้ทำ filter "ตามสินค้า"
      // value = code (prod) ถ้ามี ไม่งั้น label — กรองฝั่ง client ด้วย prodMatch
      var prSeen = {}, prodNames = [];
      campaigns.forEach(function (c) {
        var code = lm2Str(c.prod);
        var label = lm2Str(c.prod_label) || code;
        if (!code && !label) return;
        var val = code || label;
        if (prSeen[val]) return;
        prSeen[val] = true;
        prodNames.push({ value: val, label: label || val });
      });
      prodNames.sort(function (a, b) { return String(a.label).localeCompare(String(b.label), 'th'); });

      return {
        channels: channels,
        campaigns: campaigns,
        monthly: monthly,
        months: months,
        channelNames: channelNames,
        prodNames: prodNames,
      };
    });
  },
};

/* ============================================================
   mountLeadmkt — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountLeadmkt() {
  if (!document.getElementById('wrap-leadmkt')) return;
  var wrap = document.getElementById('wrap-leadmkt');
  wrap.innerHTML = '<style>' + LM_CSS() + '</style><div id="lm">' + LM_MARKUP() + '</div>';
  LM_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #lm (brand tokens เดียวกับหน้าอื่น) ===== */
function LM_CSS() {
  return [
    '#lm{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#lm *{box-sizing:border-box}',
    // page head
    '#lm .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#lm .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#lm .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#lm .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#lm .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // buttons
    '#lm .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#lm .btn:hover{border-color:var(--navy)}',
    '#lm .btn svg{width:14px;height:14px}',
    '#lm .btn-sm{padding:5px 10px;font-size:12px}',
    // read-only banner
    '#lm .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#lm .ro-banner strong{font-weight:600}',
    // stat cards
    '#lm .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#lm .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#lm .stats{grid-template-columns:repeat(2,1fr)}}',
    '#lm .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#lm .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#lm .stat-card.rev::before{background:#166534}',
    '#lm .stat-card.budget::before{background:#B45309}',
    '#lm .stat-card.roas::before{background:#2BA89B}',
    '#lm .stat-card.leads::before{background:#4338CA}',
    '#lm .stat-card.newc::before{background:#1E40AF}',
    '#lm .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#lm .stat-card .v{font-size:22px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#lm .stat-card.rev .v{color:#166534}',
    '#lm .stat-card.roas .v{color:#2BA89B}',
    '#lm .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#lm .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#lm .filter{display:flex;flex-direction:column;gap:2px}',
    '#lm .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#lm .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#lm .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section title
    '#lm .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px}',
    // data table
    '#lm .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#lm .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);white-space:nowrap}',
    '#lm .data-table th.num,#lm .data-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '#lm .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#lm .data-table tr:last-child td{border-bottom:0}',
    '#lm .data-table tr:hover td{background:#FAFBFC}',
    '#lm .data-table tfoot td{font-weight:700;background:#F8FAFC;border-top:2px solid var(--border-strong);color:var(--navy)}',
    '#lm .rev-cell{font-weight:600;color:#166534}',
    '#lm .mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text-muted)}',
    '#lm .name-cell{font-weight:600;color:var(--navy)}',
    '#lm .name-cell .meta{display:block;font-weight:400;font-size:10px;color:var(--text-faint);margin-top:2px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#lm .flag-mark{display:inline-block;margin-left:6px;font-size:10px;font-weight:600;color:var(--warning);cursor:help;vertical-align:middle}',
    '#lm .fix-note{display:inline-block;margin-left:6px;font-size:10px;font-weight:500;color:var(--text-faint);cursor:help;vertical-align:middle}',
    '#lm .rev-src{display:inline-block;margin-left:5px;font-size:9px;font-weight:700;color:var(--teal-dark);background:rgba(61,197,183,.12);border-radius:4px;padding:1px 5px;cursor:help;vertical-align:middle;letter-spacing:.02em}',
    '#lm .dim-cell{color:var(--text-muted)}',
    '#lm .table-wrap{overflow-x:auto}',
    // ROI/ROAS pill (สี = ดี/แย่)
    '#lm .pill{display:inline-block;font-size:11px;font-weight:700;padding:1px 8px;border-radius:10px;font-variant-numeric:tabular-nums}',
    '#lm .pill.good{background:#DCFCE7;color:#166534}',
    '#lm .pill.mid{background:#FEF3C7;color:#92400E}',
    '#lm .pill.bad{background:#FEE2E2;color:#991B1B}',
    '#lm .pill.na{background:#F1F5F9;color:#94A3B8}',
    // status tag
    '#lm .tag{display:inline-block;font-size:10px;padding:1px 7px;border-radius:8px;font-weight:600}',
    '#lm .tag.active{background:#DCFCE7;color:#166534}',
    '#lm .tag.inactive{background:#F1F5F9;color:#64748B}',
    // trend bar (รายเดือน)
    '#lm .trend{display:flex;flex-direction:column;gap:6px}',
    '#lm .trend-row{display:grid;grid-template-columns:90px 1fr 110px;gap:10px;align-items:center}',
    '#lm .trend-row .tm{font-size:11px;font-weight:600;color:var(--navy)}',
    '#lm .trend-bar{height:18px;background:#F1F5F9;border-radius:4px;overflow:hidden;position:relative}',
    '#lm .trend-bar .fill{height:100%;background:linear-gradient(90deg,#3DC5B7,#2BA89B);border-radius:4px}',
    '#lm .trend-row .tv{font-size:11px;text-align:right;color:#166534;font-weight:600;font-variant-numeric:tabular-nums}',
    // empty / loading
    '#lm .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#lm .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#lm .empty-icon svg{width:24px;height:24px}',
    '#lm .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#lm .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#lm .empty-sm{text-align:center;padding:24px;background:var(--surface);border:1px dashed var(--border-strong);border-radius:8px;color:var(--text-muted);font-size:12px;margin-bottom:14px}',
    '#lm .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    '@media (max-width:768px){#lm .stats{grid-template-columns:repeat(2,1fr)}}',
  ].join('\n');
}

/* ===== markup · คง element id เดิม ===== */
function LM_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
    '      Lead & การตลาด',
    '    </h1>',
    '    <div class="subtitle" id="lm-subtitle">ROI / ROAS / CPA แยกตามช่องทาง·แคมเปญ·รายเดือน (Lead & Marketing analytics)</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-sm" onclick="lmReload()" id="lm-refresh-btn"></button>',
    '  </div>',
    '</header>',
    // read-only banner
    '<div class="ro-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#3DC5B7;display:inline-block"></span>',
    '  <span><strong>มุมมองผู้บริหาร/การตลาด:</strong> ภาพรวมการตลาดเชิงรวม (aggregate) ไม่มีข้อมูลส่วนบุคคล · อ่านอย่างเดียว</span>',
    '</div>',
    '<div class="stats" id="lm-stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ตามสินค้า</label>',
    '    <select id="lm-filter-prod" onchange="lmRender()"><option value="">ทุกสินค้า</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>เดือน</label>',
    '    <select id="lm-filter-month" onchange="lmRender()"><option value="">ทุกเดือน</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>ช่องทาง</label>',
    '    <select id="lm-filter-channel" onchange="lmRender()"><option value="">ทุกช่องทาง</option></select>',
    '  </div>',
    '</div>',
    '<div id="lm-content" class="loading">กำลังโหลด...</div>',
  ].join('\n');
}

/* ============================================================
   LM_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function LM_RUN_PAGE_JS() {
  var _lmRoot = document.getElementById('lm');
  function $id(id) { return _lmRoot ? _lmRoot.querySelector('#' + id) : document.getElementById(id); }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function showToast(msg, type) {
    var t = document.getElementById('lm2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'lm2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var ICON_TREND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>';

  var _lmData = null; // { channels, campaigns, monthly, months, channelNames }

  // ---- format helpers (กัน throw ถ้า null) ----
  function fmtBaht(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try {
      return '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    } catch (e) { return '฿' + String(Math.round(n)); }
  }
  function fmtBahtFull(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try {
      return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' บาท';
    } catch (e) { return String(Math.round(n)) + ' บาท'; }
  }
  function fmtInt(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try { return n.toLocaleString('th-TH'); } catch (e) { return String(Math.round(n)); }
  }
  function fmtPct(v) {
    if (v == null) return '—';
    var n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 10) / 10) + '%';
  }
  // ROAS = อัตราส่วน (เท่า)
  function fmtRoas(v) {
    if (v == null) return '—';
    var n = Number(v);
    if (!isFinite(n)) return '—';
    return (Math.round(n * 100) / 100) + '×';
  }
  function monthLabel(mk) {
    if (!mk) return '—';
    var parts = String(mk).split('-');
    if (parts.length >= 2 && /^\d{4}$/.test(parts[0]) && /^\d{2}$/.test(parts[1])) {
      var names = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      var mi = parseInt(parts[1], 10);
      var yr = parseInt(parts[0], 10) + 543; // พ.ศ.
      return (names[mi] || parts[1]) + ' ' + yr;
    }
    return String(mk);
  }

  // pill สี ROI% (>0 ดี, 0..-? แย่)
  function roiPill(v) {
    if (v == null) return '<span class="pill na">—</span>';
    var n = Number(v);
    if (!isFinite(n)) return '<span class="pill na">—</span>';
    var cls = n >= 100 ? 'good' : n >= 0 ? 'mid' : 'bad';
    return '<span class="pill ' + cls + '">' + fmtPct(n) + '</span>';
  }
  // pill สี ROAS (>=1 คุ้ม)
  function roasPill(v) {
    if (v == null) return '<span class="pill na">—</span>';
    var n = Number(v);
    if (!isFinite(n)) return '<span class="pill na">—</span>';
    var cls = n >= 2 ? 'good' : n >= 1 ? 'mid' : 'bad';
    return '<span class="pill ' + cls + '">' + fmtRoas(n) + '</span>';
  }

  // ---- load ----
  function loadData() {
    $id('lm-content').className = 'loading';
    $id('lm-content').innerHTML = 'กำลังโหลด...';
    LM_BACKEND.lmList().then(function (res) {
      _lmData = res || { channels: [], campaigns: [], monthly: [], months: [], channelNames: [], prodNames: [] };
      populateFilters();
      renderAll();
    }).catch(function (e) {
      console.error('[leadmkt] load failed', e);
      _lmData = { channels: [], campaigns: [], monthly: [], months: [], channelNames: [], prodNames: [] };
      $id('lm-content').className = '';
      $id('lm-content').innerHTML = '<div class="empty"><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml((e && e.message) || 'unknown') + '</div></div>';
      renderStats();
    });
  }

  function populateFilters() {
    var mSel = $id('lm-filter-month');
    if (mSel && mSel.options.length <= 1) {
      (_lmData.months || []).forEach(function (m) {
        var o = document.createElement('option');
        o.value = m; o.textContent = monthLabel(m);
        mSel.appendChild(o);
      });
    }
    var cSel = $id('lm-filter-channel');
    if (cSel && cSel.options.length <= 1) {
      (_lmData.channelNames || []).forEach(function (c) {
        var o = document.createElement('option');
        o.value = c; o.textContent = c;
        cSel.appendChild(o);
      });
    }
    var pSel = $id('lm-filter-prod');
    if (pSel && pSel.options.length <= 1) {
      (_lmData.prodNames || []).forEach(function (pr) {
        var o = document.createElement('option');
        o.value = pr.value; o.textContent = pr.label;
        pSel.appendChild(o);
      });
    }
  }

  function curFilters() {
    var mSel = $id('lm-filter-month');
    var cSel = $id('lm-filter-channel');
    var pSel = $id('lm-filter-prod');
    return { month: mSel ? mSel.value : '', channel: cSel ? cSel.value : '', prod: pSel ? pSel.value : '' };
  }
  // match สินค้าแบบกว้าง (code prod หรือ label) — value ใน dropdown = code ถ้ามี ไม่งั้น label
  function prodMatch(row, filterProd) {
    if (!filterProd) return true;
    return row.prod === filterProd || row.prod_label === filterProd;
  }
  // match ช่องทางแบบกว้าง (ชื่อ หรือ id)
  function chMatch(rowChannel, rowChannelId, filterName) {
    if (!filterName) return true;
    return rowChannel === filterName || rowChannelId === filterName;
  }

  // ---- filtered datasets ----
  function filteredMonthly() {
    var f = curFilters();
    var rows = (_lmData && _lmData.monthly) ? _lmData.monthly.slice() : [];
    if (f.month) rows = rows.filter(function (r) { return r.month === f.month; });
    if (f.channel) rows = rows.filter(function (r) { return chMatch(r.channel, r.channel_id, f.channel); });
    return rows;
  }
  function filteredCampaigns() {
    var f = curFilters();
    var rows = (_lmData && _lmData.campaigns) ? _lmData.campaigns.slice() : [];
    if (f.channel) rows = rows.filter(function (r) { return chMatch(r.channel, r.channel_id, f.channel); });
    if (f.prod) rows = rows.filter(function (r) { return prodMatch(r, f.prod); });
    // หมายเหตุ: แคมเปญไม่มีมิติเดือน → ตัวกรองเดือนไม่กระทบ
    rows.sort(function (a, b) {
      var av = a.roi == null ? -Infinity : a.roi;
      var bv = b.roi == null ? -Infinity : b.roi;
      return bv - av; // ROI สูง→ต่ำ
    });
    return rows;
  }
  function filteredChannels() {
    var f = curFilters();
    var rows = (_lmData && _lmData.channels) ? _lmData.channels.slice() : [];
    if (f.channel) rows = rows.filter(function (r) { return chMatch(r.channel_name, r.channel_id, f.channel); });
    return rows;
  }

  // ---- Conversion ROAS: ค่าแอดต่อ lead/นัด/คนมาจริง (กรองเฉพาะช่องทางแอด) ----
  function renderConvRoas() {
    var rows = filteredChannels().filter(function (c) { return (c.actual_spend > 0) || (c.fo_leads > 0); });
    if (!rows.length) return '';
    rows.sort(function (a, b) { return (b.actual_spend || 0) - (a.actual_spend || 0); });
    var body = rows.map(function (c) {
      return '<tr>'
        + '<td class="name-cell">' + escapeHtml(c.channel_name) + '</td>'
        + '<td class="num">' + fmtBaht(c.actual_spend) + '</td>'
        + '<td class="num">' + fmtInt(c.fo_leads) + '</td>'
        + '<td class="num">' + fmtInt(c.fo_appointments) + '</td>'
        + '<td class="num">' + fmtInt(c.fo_showed) + '</td>'
        + '<td class="num">' + (c.cost_per_lead != null ? fmtBaht(c.cost_per_lead) : '—') + '</td>'
        + '<td class="num">' + (c.cost_per_appt != null ? fmtBaht(c.cost_per_appt) : '—') + '</td>'
        + '<td class="num">' + (c.cost_per_show != null ? fmtBaht(c.cost_per_show) : '—') + '</td>'
        + '</tr>';
    }).join('');
    return '<div class="sec-title">Conversion ROAS · ค่าโฆษณาต่อผลลัพธ์จริง (จาก FO)</div>'
      + '<div style="font-size:12px;color:var(--text-muted,#64748B);margin-bottom:8px">เทียบค่าแอดกับ lead/นัด/คนมาจริงที่ทีมหน้าร้านบันทึก · ยิ่งต่ำยิ่งคุ้ม · (ค่าแอด=ยอดรวมที่ดึงมา)</div>'
      + '<div class="table-wrap"><table class="data-table"><thead><tr>'
      + '<th>ช่องทาง</th><th class="num">ค่าแอด</th><th class="num">Leads</th><th class="num">นัด</th><th class="num">มาจริง</th><th class="num">฿/Lead</th><th class="num">฿/นัด</th><th class="num">฿/คนมา</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // ---- render ----
  function renderAll() {
    renderStats();

    var content = $id('lm-content');
    content.className = '';

    var hasAny =
      (_lmData && ((_lmData.channels && _lmData.channels.length) ||
        (_lmData.campaigns && _lmData.campaigns.length) ||
        (_lmData.monthly && _lmData.monthly.length)));

    if (!hasAny) {
      content.innerHTML = emptyState();
      return;
    }
    content.innerHTML =
      renderConvRoas() +
      renderChannelSection() +
      renderCampaignSection() +
      renderMonthlySection();
  }

  // การ์ดสรุป — ใช้ "ทั้งหมด" (ไม่ขึ้นกับ filter) เพื่อภาพรวมผู้บริหาร
  // โดยรวมจาก monthly เป็นหลัก (ครบมิติรายได้/งบ/leads/ลูกค้าใหม่) ; ถ้า monthly ว่าง fallback แคมเปญ
  function renderStats() {
    var monthly = (_lmData && _lmData.monthly) ? _lmData.monthly : [];
    var campaigns = (_lmData && _lmData.campaigns) ? _lmData.campaigns : [];

    var totalRev = 0, totalBudget = 0, totalLeads = 0, totalNew = 0;
    var src = monthly.length ? monthly : null;

    if (src) {
      src.forEach(function (r) {
        totalRev += Number(r.revenue) || 0;
        totalBudget += Number(r.budget) || 0;
        totalLeads += Number(r.leads) || 0;
        totalNew += Number(r.new_customers) || 0;
      });
    } else {
      campaigns.forEach(function (c) {
        totalRev += Number(c.revenue) || 0;
        totalBudget += Number(c.spend) || 0;
        totalLeads += Number(c.leads) || 0;
        totalNew += Number(c.customers) || 0;
      });
    }
    // มูลค่าที่ Meta รายงาน (pixel/conversion value) จากแคมเปญ — ใช้เมื่อ FO ยอดปิดยังว่าง
    // กำกับชัดว่าเป็นค่าก่อนหักต้นทุน "ไม่ใช่ยอดปิดจริง" กัน mislead ([[ai-hq-pnl-cogs-gap]])
    var metaRev = 0;
    campaigns.forEach(function (c) { if (c.revenue_source === 'platform') metaRev += Number(c.revenue) || 0; });
    var showMeta = (totalRev <= 0 && metaRev > 0);
    var revVal = showMeta ? metaRev : totalRev;
    var revSub = showMeta ? 'ตาม Meta · ก่อนหักต้นทุน (ไม่ใช่ยอดปิดจริง)' : (src ? 'ยอดปิดจริง (FO)' : 'จากแคมเปญ');
    var roasBase = showMeta ? metaRev : totalRev;
    var roas = totalBudget > 0 && roasBase > 0 ? roasBase / totalBudget : (totalBudget > 0 ? 0 : null);
    var roasSub = showMeta ? 'ตาม Meta (pixel) · ก่อนหักต้นทุน' : (totalBudget > 0 ? 'รายได้ / งบ' : 'ไม่มีงบ');

    $id('lm-stats').innerHTML = [
      statCard('rev', 'รายได้รวมการตลาด', fmtBaht(revVal), revSub),
      statCard('budget', 'งบรวมที่ใช้', fmtBaht(totalBudget), 'ทุกช่องทาง'),
      statCard('roas', 'ROAS เฉลี่ย', fmtRoas(roas), roasSub),
      statCard('leads', 'Leads รวม', fmtInt(totalLeads), 'ทุกช่องทาง'),
      statCard('newc', 'ลูกค้าใหม่รวม', fmtInt(totalNew), 'สะสม'),
    ].join('');

    var sub = $id('lm-subtitle');
    if (sub) {
      var nCh = (_lmData && _lmData.channels) ? _lmData.channels.length : 0;
      var nCmp = campaigns.length;
      sub.textContent = 'ROI / ROAS / CPA · ' + nCh + ' ช่องทาง · ' + nCmp + ' แคมเปญ · ' + monthly.length + ' แถวรายเดือน';
    }
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

  // ===== ส่วนช่องทาง: งบ/รายได้/ROAS ต่อช่องทาง (รวม monthly เข้ากับ master channel) =====
  function renderChannelSection() {
    var channels = filteredChannels();
    var monthly = filteredMonthly();

    // รวมตัวเลขจาก monthly per ช่องทาง
    var agg = {}; // key = channel name → {rev,budget,newc,leads}
    function bucket(name) {
      var k = name || '—';
      if (!agg[k]) agg[k] = { name: k, rev: 0, budget: 0, newc: 0, leads: 0, has: false };
      return agg[k];
    }
    monthly.forEach(function (r) {
      var b = bucket(r.channel);
      b.rev += Number(r.revenue) || 0;
      b.budget += Number(r.budget) || 0;
      b.newc += Number(r.new_customers) || 0;
      b.leads += Number(r.leads) || 0;
      b.has = true;
    });

    // ผูก master channel (หมวด/งบแผน/สถานะ) เข้ากับ agg
    var rows = [];
    var usedNames = {};
    channels.forEach(function (c) {
      var b = agg[c.channel_name] || { rev: 0, budget: 0, newc: 0, leads: 0 };
      usedNames[c.channel_name] = true;
      rows.push({
        id: c.channel_id,
        name: c.channel_name,
        category: c.category,
        planned: c.monthly_budget,
        status: c.status,
        rev: b.rev, budget: b.budget, newc: b.newc, leads: b.leads,
      });
    });
    // ช่องทางที่มีใน monthly แต่ไม่มี master
    Object.keys(agg).forEach(function (k) {
      if (usedNames[k]) return;
      var b = agg[k];
      rows.push({ id: '', name: k, category: '', planned: 0, status: '', rev: b.rev, budget: b.budget, newc: b.newc, leads: b.leads });
    });

    if (!rows.length) {
      return '<div class="sec-title">ช่องทางการตลาด</div><div class="empty-sm">ยังไม่มีข้อมูลช่องทาง (lead_source.updated)</div>';
    }

    rows.sort(function (a, b) { return (b.rev - a.rev) || (b.budget - a.budget); });

    var totRev = 0, totBudget = 0, totNew = 0, totLeads = 0;
    var body = rows.map(function (r) {
      totRev += r.rev; totBudget += r.budget; totNew += r.newc; totLeads += r.leads;
      var roas = r.budget > 0 ? r.rev / r.budget : null;
      var statusTag = '';
      if (r.status) {
        var st = String(r.status).toLowerCase();
        var isActive = st === 'active' || st === 'on' || st === 'เปิด' || st === 'enabled';
        statusTag = '<span class="tag ' + (isActive ? 'active' : 'inactive') + '">' + escapeHtml(r.status) + '</span>';
      }
      return [
        '<tr>',
        '  <td class="name-cell">' + escapeHtml(r.name) + (r.id && r.id !== r.name ? ' <span class="mono">' + escapeHtml(r.id) + '</span>' : '') + '</td>',
        '  <td>' + (r.category ? escapeHtml(r.category) : '—') + '</td>',
        '  <td class="num">' + (r.planned ? fmtBaht(r.planned) : '—') + '</td>',
        '  <td class="num">' + fmtBaht(r.budget) + '</td>',
        '  <td class="num rev-cell">' + fmtBaht(r.rev) + '</td>',
        '  <td class="num">' + roasPill(roas) + '</td>',
        '  <td class="num">' + fmtInt(r.leads) + '</td>',
        '  <td class="num">' + fmtInt(r.newc) + '</td>',
        '  <td>' + (statusTag || '—') + '</td>',
        '</tr>',
      ].join('');
    }).join('');

    var totRoas = totBudget > 0 ? totRev / totBudget : null;
    return [
      '<div class="sec-title">ช่องทางการตลาด · งบ / รายได้ / ROAS (' + rows.length + ' ช่องทาง)</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>',
      '    <th>ช่องทาง</th><th>หมวดหมู่</th><th class="num">งบแผน/ด.</th><th class="num">งบใช้จริง</th>',
      '    <th class="num">รายได้</th><th class="num">ROAS</th><th class="num">Leads</th><th class="num">ลูกค้าใหม่</th><th>สถานะ</th>',
      '  </tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '  <tfoot><tr>',
      '    <td colspan="3">รวม</td>',
      '    <td class="num">' + fmtBaht(totBudget) + '</td>',
      '    <td class="num">' + fmtBaht(totRev) + '</td>',
      '    <td class="num">' + roasPill(totRoas) + '</td>',
      '    <td class="num">' + fmtInt(totLeads) + '</td>',
      '    <td class="num">' + fmtInt(totNew) + '</td>',
      '    <td>—</td>',
      '  </tr></tfoot>',
      '</table>',
      '</div>',
    ].join('');
  }

  // ===== ส่วนแคมเปญ: ตาราง ROI เรียงสูง→ต่ำ =====
  function renderCampaignSection() {
    var rows = filteredCampaigns();
    if (!rows.length) {
      return '<div class="sec-title">แคมเปญ · ROI</div><div class="empty-sm">ยังไม่มีข้อมูลแคมเปญ (campaign.roi.updated)</div>';
    }
    var totSpend = 0, totLeads = 0, totCust = 0, totRev = 0;
    var body = rows.map(function (c) {
      totSpend += Number(c.spend) || 0;
      totLeads += Number(c.leads) || 0;
      totCust += Number(c.customers) || 0;
      totRev += Number(c.revenue) || 0;

      // ป้ายชื่อหลัก (อ่านง่าย): prod_label + program/objective ถ้ามี ไม่งั้น campaign_name เดิม
      var primary = '';
      if (c.prod_label || c.program || c.objective_label) {
        var bits = [];
        if (c.prod_label) bits.push(c.prod_label);
        if (c.program) bits.push(c.program);
        else if (c.objective_label) bits.push(c.objective_label);
        primary = bits.join(' · ');
      }
      if (!primary) primary = c.campaign_name;

      // ชื่อดิบเต็ม (raw_name) — เก็บไว้ใน title tooltip ของ cell เสมอ ดูได้ตลอดว่าอ้างถึงอะไร
      var fullRaw = c.raw_name || c.campaign_name || '';

      // marker flag (ไม่ใช้ emoji — line-art / ข้อความ muted ตามกฎโปรเจกต์)
      // แยก 2 ระดับ: typo จริง (เตือนสีส้ม) vs normalize/convention (โน้ตเทาจาง)
      var flags = lm2ToArr(c.parse_flags);
      var FLAG_LABEL = {
        program_typo_fixed: 'สะกดชื่อโปรแกรมผิด (แก้ให้แล้ว)',
        PG_double_colon: 'PG มี colon เกิน (แก้ให้แล้ว)',
        bgt_had_strat_value: 'ใส่กลยุทธ์งบผิดช่อง BGT (ย้ายให้แล้ว)',
        cl_was_objective_normalized: 'ย้าย CL ที่เป็นวัตถุประสงค์ไปช่อง objective',
        date_from_bare_month: 'วันเริ่มเป็นเดือนเปลือย (รุ่นย่อ)',
      };
      var TYPO_FLAGS = { program_typo_fixed: 1, PG_double_colon: 1, bgt_had_strat_value: 1 };
      function flagText(arr) {
        return arr.map(function (f) { return FLAG_LABEL[f] || f; }).join(' · ');
      }
      var typos = flags.filter(function (f) { return TYPO_FLAGS[f]; });
      var norms = flags.filter(function (f) { return !TYPO_FLAGS[f]; });
      var flagMark = '';
      if (typos.length) {
        flagMark += ' <span class="flag-mark" title="' + escapeHtml('ตั้งชื่อผิด format: ' + flagText(typos)) + '"><i class="ti ti-flag"></i> [ตั้งชื่อผิด format]</span>';
      }
      if (norms.length) {
        flagMark += ' <span class="fix-note" title="' + escapeHtml('ปรับให้อัตโนมัติ: ' + flagText(norms)) + '"><i class="ti ti-wand"></i> ปรับอัตโนมัติ</span>';
      }

      // meta line: รหัสแคมเปญ (คงของเดิม) + ชื่อดิบเต็ม
      var metaBits = [];
      if (c.campaign_id && c.campaign_id !== c.campaign_name) metaBits.push(c.campaign_id);
      if (fullRaw && fullRaw !== primary) metaBits.push(fullRaw);
      var metaLine = metaBits.length ? '<span class="meta">' + escapeHtml(metaBits.join(' · ')) + '</span>' : '';

      return [
        '<tr>',
        '  <td class="name-cell" title="' + escapeHtml(fullRaw) + '">' + escapeHtml(primary) + flagMark + metaLine + '</td>',
        '  <td class="dim-cell">' + (c.prod_label ? escapeHtml(c.prod_label) : (c.prod ? escapeHtml(c.prod) : '—')) + '</td>',
        '  <td class="dim-cell">' + (c.conv_loc_label ? escapeHtml(c.conv_loc_label) : '—') + '</td>',
        '  <td class="dim-cell">' + (c.objective_label ? escapeHtml(c.objective_label) : '—') + '</td>',
        '  <td>' + (c.channel ? escapeHtml(c.channel) : '—') + '</td>',
        '  <td>' + (c.account ? escapeHtml(c.account) : '—') + '</td>',
        '  <td>' + (c.page ? escapeHtml(c.page) : '—') + '</td>',
        '  <td class="num">' + fmtBaht(c.spend) + '</td>',
        '  <td class="num">' + fmtInt(c.leads) + '</td>',
        '  <td class="num">' + fmtInt(c.customers) + '</td>',
        '  <td class="num rev-cell">' + fmtBaht(c.revenue) +
          (c.revenue_source === 'platform'
            ? ' <span class="rev-src" title="' + escapeHtml('รายได้ที่ Meta รายงาน (pixel/conversion value) — ค่าประมาณก่อนหักต้นทุน ไม่ใช่ยอดปิดจริงจาก FO') + '">Meta</span>'
            : '') + '</td>',
        '  <td class="num">' + roiPill(c.roi) + '</td>',
        '</tr>',
      ].join('');
    }).join('');
    var totRoi = totSpend > 0 ? ((totRev - totSpend) / totSpend) * 100 : null;
    return [
      '<div class="sec-title">แคมเปญ · ROI เรียงสูง→ต่ำ (' + rows.length + ' แคมเปญ)</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>',
      '    <th>แคมเปญ</th><th>สินค้า</th><th>ปลายทาง</th><th>วัตถุประสงค์</th><th>ช่องทาง</th><th>บัญชี</th><th>เพจ</th><th class="num">งบใช้จริง</th><th class="num">Leads</th>',
      '    <th class="num">ลูกค้าจริง</th><th class="num">รายได้</th><th class="num">ROI</th>',
      '  </tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '  <tfoot><tr>',
      '    <td colspan="7">รวม</td>',
      '    <td class="num">' + fmtBaht(totSpend) + '</td>',
      '    <td class="num">' + fmtInt(totLeads) + '</td>',
      '    <td class="num">' + fmtInt(totCust) + '</td>',
      '    <td class="num">' + fmtBaht(totRev) + '</td>',
      '    <td class="num">' + roiPill(totRoi) + '</td>',
      '  </tr></tfoot>',
      '</table>',
      '</div>',
    ].join('');
  }

  // ===== ส่วนรายเดือน: trend (รายได้ต่อเดือน) + ตารางละเอียด =====
  function renderMonthlySection() {
    var rows = filteredMonthly();
    if (!rows.length) {
      return '<div class="sec-title">รายเดือน × ช่องทาง</div><div class="empty-sm">ยังไม่มีข้อมูลรายเดือน (lead.performance.monthly)</div>';
    }

    // trend: รวมรายได้ต่อเดือน (ทุกช่องทาง) เรียงเก่า→ใหม่
    var byMonth = {};
    rows.forEach(function (r) {
      var k = r.month || '—';
      if (!byMonth[k]) byMonth[k] = { month: k, rev: 0 };
      byMonth[k].rev += Number(r.revenue) || 0;
    });
    var months = Object.keys(byMonth).map(function (k) { return byMonth[k]; });
    months.sort(function (a, b) { return String(a.month).localeCompare(String(b.month)); });
    var maxRev = months.reduce(function (m, x) { return Math.max(m, x.rev); }, 0) || 1;
    var trend = months.map(function (x) {
      var pct = Math.max(2, Math.round((x.rev / maxRev) * 100));
      return [
        '<div class="trend-row">',
        '  <span class="tm">' + escapeHtml(monthLabel(x.month)) + '</span>',
        '  <div class="trend-bar"><div class="fill" style="width:' + pct + '%"></div></div>',
        '  <span class="tv">' + fmtBaht(x.rev) + '</span>',
        '</div>',
      ].join('');
    }).join('');

    // ตารางละเอียด เรียงเดือนล่าสุด→เก่า แล้วช่องทาง
    var sorted = rows.slice().sort(function (a, b) {
      var mc = String(b.month).localeCompare(String(a.month));
      if (mc !== 0) return mc;
      return String(a.channel).localeCompare(String(b.channel), 'th');
    });

    var totNew = 0, totRet = 0, totRev = 0, totBudget = 0;
    var body = sorted.map(function (r) {
      totNew += Number(r.new_customers) || 0;
      totRet += Number(r.returning_customers) || 0;
      totRev += Number(r.revenue) || 0;
      totBudget += Number(r.budget) || 0;
      return [
        '<tr>',
        '  <td><span class="mono">' + escapeHtml(monthLabel(r.month)) + '</span></td>',
        '  <td class="name-cell">' + escapeHtml(r.channel) + '</td>',
        '  <td class="num">' + fmtInt(r.new_customers) + ' / ' + fmtInt(r.returning_customers) + '</td>',
        '  <td class="num rev-cell">' + fmtBaht(r.revenue) + '</td>',
        '  <td class="num">' + fmtBaht(r.budget) + '</td>',
        '  <td class="num">' + (r.cpa == null ? '—' : fmtBaht(r.cpa)) + '</td>',
        '  <td class="num">' + roasPill(r.roas) + '</td>',
        '  <td class="num">' + fmtPct(r.conv_rate) + '</td>',
        '  <td class="num">' + (r.target == null ? '—' : fmtBaht(r.target)) + '</td>',
        '</tr>',
      ].join('');
    }).join('');

    var totCpa = totNew > 0 ? totBudget / totNew : null;
    var totRoas = totBudget > 0 ? totRev / totBudget : null;
    return [
      '<div class="sec-title">รายเดือน · แนวโน้มรายได้ (รวมทุกช่องทาง)</div>',
      '<div class="trend">' + trend + '</div>',
      '<div class="sec-title">รายเดือน × ช่องทาง · ละเอียด (' + sorted.length + ' แถว)</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>',
      '    <th>เดือน</th><th>ช่องทาง</th><th class="num">ใหม่ / กลับมา</th><th class="num">รายได้</th>',
      '    <th class="num">งบ</th><th class="num">CPA</th><th class="num">ROAS</th><th class="num">Conv.Rate</th><th class="num">เป้า</th>',
      '  </tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '  <tfoot><tr>',
      '    <td colspan="2">รวม</td>',
      '    <td class="num">' + fmtInt(totNew) + ' / ' + fmtInt(totRet) + '</td>',
      '    <td class="num">' + fmtBaht(totRev) + '</td>',
      '    <td class="num">' + fmtBaht(totBudget) + '</td>',
      '    <td class="num">' + (totCpa == null ? '—' : fmtBaht(totCpa)) + '</td>',
      '    <td class="num">' + roasPill(totRoas) + '</td>',
      '    <td class="num">—</td>',
      '    <td class="num">—</td>',
      '  </tr></tfoot>',
      '</table>',
      '</div>',
    ].join('');
  }

  function emptyState() {
    return [
      '<div class="empty">',
      '  <div class="empty-icon">' + ICON_TREND + '</div>',
      '  <div class="empty-title">ยังไม่มีข้อมูล Lead & การตลาด</div>',
      '  <div class="empty-sub">เมื่อระบบส่งข้อมูลช่องทาง/แคมเปญ/ผลรายเดือน (lead_source.updated · campaign.roi.updated · lead.performance.monthly) ข้อมูลจะแสดงที่นี่</div>',
      '</div>',
    ].join('');
  }

  function lmReload() { loadData(); }
  function lmRender() { renderAll(); }

  // init labels
  $id('lm-refresh-btn').innerHTML = ICON_REFRESH + ' รีเฟรช';

  // expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix lm* กันชน)
  window.lmReload = lmReload;
  window.lmRender = lmRender;

  // init
  loadData();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountLeadmkt) */
if (typeof window !== 'undefined') {
  window.mountLeadmkt = mountLeadmkt;
  window.LM_BACKEND = LM_BACKEND;
}
