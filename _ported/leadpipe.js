// _ported/leadpipe.js — Native read-only page "Lead Pipeline (FO หน้าร้าน)" สำหรับ Supabase dashboard
// **ลับ · director/HQ เท่านั้น** · อ่านอย่างเดียว (read-only · ไม่มี write)
//
// ลอก pattern จาก:
//   - _ported/legal.js   → HQ role-gate + 403/401 lock screen สวย ๆ (ไม่ throw)
//   - _ported/leadmkt.js → multi-type fetch · normalize · การ์ดสรุป · ตาราง · filter
//
// ข้อมูล — **เรียก hr_list_hq (ไม่ใช่ hr_list!)** มี role-gate ฝั่ง server (director/HQ) · 2 type:
//   1. fo.lead.updated     → Lead Pipeline (pseudonymized — ไม่มี ชื่อ/เบอร์/HN/อาการ)
//        คอลัมน์จริง: Brand, Branch, Budget, Lead ID, SLA Due, Attempts, Booked By, Created By,
//        Converted By, Service Type, สถานะ Lead, สถานะติดตาม, ยอดมัดจำ, ยอดปิด, วันที่...
//   2. fo.followup.logged  → Call Log
//        Lead ID, เวลา, ผลสาย, ผู้โทร, ชิปผลคุย, คะแนนพึงพอใจ, ปัจจัยที่ชอบ, ช่องทางประเมิน
//   ข้อมูลจริงอาจมาทีหลัง → empty state สวย ไม่ error · field เดา · กัน null/throw · format ฿
//
// pattern เดียวกับหน้าอื่น:
//   - mountLeadpipe render เข้า #wrap-leadpipe
//   - ใช้ global window.sb / esc / $ (index.html module scope) — ห้าม redeclare
//   - CSS scope ใต้ #lp2 · fn ที่ inline onclick ผูกกับ window (prefix lp2*) กันชน
//   - helper (escapeHtml/showToast) inline ใน closure

/* ============================================================
   LP_BACKEND — ดึง 2 type จาก Supabase edge fn hr_list_hq แล้ว normalize
   role-gate ฝั่ง server → 403/401 = forbidden flag (ไม่ throw แดง)
   ============================================================ */
var LP_FN = 'hr_list_hq';
var LP_TYPE_LEAD = 'fo.lead.updated';
var LP_TYPE_FOLLOWUP = 'fo.followup.logged';
var LP_LIMIT = 2000;

function lp2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function lp2Str(v) {
  if (v == null) return '';
  return String(v).trim();
}
function lp2Num(v) {
  if (v == null || v === '') return 0;
  var n = Number(String(v).replace(/[, ฿]/g, ''));
  return isFinite(n) ? n : 0;
}
// คืน null ถ้าไม่มีค่าจริง (แยก "ไม่มีข้อมูล" ออกจาก 0)
function lp2NumOrNull(v) {
  if (v == null || v === '') return null;
  var n = Number(String(v).replace(/[, ฿]/g, ''));
  return isFinite(n) ? n : null;
}
// คืน 'YYYY-MM-DD' จากค่าวันที่ ; ไม่ใช่วันที่ → คืนสตริงดิบ
function lp2Date(v) {
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
// คืน datetime อ่านง่าย (ตัด ms/timezone) สำหรับ call log
function lp2DateTime(v) {
  if (v == null || v === '') return '';
  var s = String(v).trim();
  var m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (m) return m[1] + ' ' + m[2];
  return lp2Date(v) || s;
}

// map สถานะ Lead → bucket funnel (รับ→ติดตาม→นัด→ปิด)
function lp2LeadStageBucket(statusLead, statusFollow, converted, closeAmt) {
  var s = (lp2Str(statusLead) || '').toLowerCase();
  var f = (lp2Str(statusFollow) || '').toLowerCase();
  // ปิดได้: มี Converted By หรือ ยอดปิด > 0 หรือ สถานะบอกปิด/ชนะ
  if (converted || lp2Num(closeAmt) > 0 ||
    /closed|won|converted|ปิด|สำเร็จ|จบ|deal/.test(s) || /closed|won|converted|ปิด|สำเร็จ/.test(f)) return 'closed';
  // นัด/จอง
  if (/book|appoint|นัด|จอง|schedule/.test(s) || /book|appoint|นัด|จอง|schedule/.test(f)) return 'booked';
  // ติดตาม
  if (/follow|contact|ติดตาม|โทร|คุย|progress|qualify/.test(s) || /follow|contact|ติดตาม|โทร|คุย|progress/.test(f)) return 'follow';
  // รับ/ใหม่ (default)
  return 'received';
}

// map payload lead ดิบ → row shape (defensive · เก็บ _raw ไว้ detail reuse)
function lp2MapLead(p) {
  p = p || {};
  var leadId = lp2Str(p.lead_id || p.leadId || p['Lead ID'] || p.id || p.entity_id);
  var brand = lp2Str(p.brand || p.Brand || p.brand_name);
  var branch = lp2Str(p.branch || p.Branch || p.branch_id || p.branch_name);
  var budget = lp2NumOrNull(p.budget || p.Budget || p.budget_amount);
  var slaDue = lp2Date(p.sla_due || p['SLA Due'] || p.slaDue || p.sla);
  var attempts = lp2NumOrNull(p.attempts || p.Attempts || p.attempt_count || p.contact_attempts);
  var bookedBy = lp2Str(p.booked_by || p['Booked By'] || p.bookedBy);
  var createdBy = lp2Str(p.created_by || p['Created By'] || p.createdBy);
  var convertedBy = lp2Str(p.converted_by || p['Converted By'] || p.convertedBy);
  var serviceType = lp2Str(p.service_type || p['Service Type'] || p.serviceType || p.service);
  var statusLead = lp2Str(p.status_lead || p['สถานะ Lead'] || p.lead_status || p.statusLead || p.status);
  var statusFollow = lp2Str(p.status_followup || p['สถานะติดตาม'] || p.followup_status || p.statusFollow || p.follow_status);
  var depositAmt = lp2Num(p.deposit_amount || p['ยอดมัดจำ'] || p.deposit || p.depositAmt);
  var closeAmt = lp2Num(p.close_amount || p['ยอดปิด'] || p.closed_amount || p.closeAmt || p.deal_amount);
  var date = lp2Date(p.date || p['วันที่'] || p.created_at || p.createdAt || p.updated_at || p.timestamp);
  return {
    lead_id: leadId || '—',
    brand: brand,
    branch: branch || '—',
    budget: budget,
    sla_due: slaDue,
    attempts: attempts,
    booked_by: bookedBy,
    created_by: createdBy,
    converted_by: convertedBy,
    service_type: serviceType,
    status_lead: statusLead,
    status_followup: statusFollow,
    deposit_amount: depositAmt,
    close_amount: closeAmt,
    date: date,
    // closed flag — มี Converted By หรือ ยอดปิด > 0
    is_closed: !!(convertedBy || closeAmt > 0),
    stage: lp2LeadStageBucket(statusLead, statusFollow, convertedBy, closeAmt),
    _raw: p,
  };
}

// map payload follow-up ดิบ → row shape (call log)
function lp2MapFollowup(p) {
  p = p || {};
  return {
    lead_id: lp2Str(p.lead_id || p.leadId || p['Lead ID'] || p.id),
    when: lp2DateTime(p.time || p['เวลา'] || p.timestamp || p.created_at || p.logged_at || p.date),
    call_result: lp2Str(p.call_result || p['ผลสาย'] || p.callResult || p.result || p.outcome),
    caller: lp2Str(p.caller || p['ผู้โทร'] || p.agent || p.by || p.user),
    chip: lp2Str(p.chip || p['ชิปผลคุย'] || p.talk_chip || p.conversation_chip || p.tag),
    csat: lp2NumOrNull(p.csat || p['คะแนนพึงพอใจ'] || p.satisfaction || p.satisfaction_score || p.rating || p.score),
    liked_factor: lp2Str(p.liked_factor || p['ปัจจัยที่ชอบ'] || p.likedFactor || p.factor || p.liked),
    eval_channel: lp2Str(p.eval_channel || p['ช่องทางประเมิน'] || p.evalChannel || p.channel),
    _raw: p,
  };
}

var _lp2Leads = [];
var _lp2Followups = [];
var _lp2Forbidden = false; // true ถ้า backend คืน 403/401 (ไม่ใช่ director/HQ)

// ตรวจว่า error จาก functions.invoke เป็น 403/401 หรือไม่ (FunctionsHttpError มี .context = Response)
function lp2IsForbidden(err) {
  if (!err) return false;
  try {
    var ctx = err.context;
    if (ctx && typeof ctx.status === 'number' && (ctx.status === 403 || ctx.status === 401)) return true;
  } catch (e) { /* noop */ }
  var msg = String((err && err.message) || err || '').toLowerCase();
  return /\b(403|401)\b/.test(msg) || /forbidden|unauthorized|not\s*hq|permission/.test(msg);
}

// ดึง 1 type ผ่าน hr_list_hq → คืน { items, forbidden }
// (ตรวจ 403/401 ทั้งที่ res.error, body {ok:false}, และ catch)
function lp2FetchType(type) {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) return Promise.resolve({ items: [], forbidden: false });
  var q = LP_FN + '?type=' + encodeURIComponent(type) + '&limit=' + LP_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    if (res && res.error) {
      if (lp2IsForbidden(res.error)) return { items: [], forbidden: true };
      throw res.error;
    }
    var data = (res && res.data) || {};
    if (data && data.ok === false) {
      var be = String(data.error || '').toLowerCase();
      if (/forbidden|hq|permission|unauthorized|403|401/.test(be)) return { items: [], forbidden: true };
    }
    return { items: lp2ToArr(data.items), forbidden: false };
  }).catch(function (e) {
    if (lp2IsForbidden(e)) return { items: [], forbidden: true };
    console.warn('[LP_BACKEND] fetch failed (' + type + ')', e);
    throw e;
  });
}

var LP_BACKEND = {
  // list — { leads, followups, branches, statuses, forbidden }
  lpList: function () {
    _lp2Forbidden = false;
    return Promise.all([
      lp2FetchType(LP_TYPE_LEAD),
      lp2FetchType(LP_TYPE_FOLLOWUP),
    ]).then(function (parts) {
      var leadRes = parts[0] || { items: [], forbidden: false };
      var fuRes = parts[1] || { items: [], forbidden: false };
      if (leadRes.forbidden || fuRes.forbidden) {
        _lp2Forbidden = true;
        _lp2Leads = []; _lp2Followups = [];
        return { leads: [], followups: [], branches: [], statuses: [], forbidden: true };
      }

      // leads — de-dup ตาม lead_id (เก็บแถวล่าสุดตามวันที่)
      var lSeen = {}, leads = [];
      lp2ToArr(leadRes.items).forEach(function (p) {
        var row = lp2MapLead(p);
        var key = row.lead_id && row.lead_id !== '—' ? row.lead_id : (row.brand + '|' + row.branch + '|' + row.date + '|' + leads.length);
        if (lSeen[key] != null) {
          // ถ้าซ้ำ — เก็บอันที่วันที่ใหม่กว่า
          var prev = leads[lSeen[key]];
          if (String(row.date || '').localeCompare(String(prev.date || '')) >= 0) leads[lSeen[key]] = row;
          return;
        }
        lSeen[key] = leads.length;
        leads.push(row);
      });

      // followups — เก็บทั้งหมด (1 lead มีได้หลายสาย)
      var followups = lp2ToArr(fuRes.items).map(lp2MapFollowup);

      // ตัวเลือก filter
      var bSeen = {}, branches = [];
      var sSeen = {}, statuses = [];
      leads.forEach(function (r) {
        if (r.branch && r.branch !== '—' && !bSeen[r.branch]) { bSeen[r.branch] = true; branches.push(r.branch); }
        if (r.status_lead && !sSeen[r.status_lead]) { sSeen[r.status_lead] = true; statuses.push(r.status_lead); }
      });
      branches.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });
      statuses.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });

      _lp2Leads = leads; _lp2Followups = followups;
      return { leads: leads, followups: followups, branches: branches, statuses: statuses, forbidden: false };
    }).catch(function (e) {
      if (_lp2Forbidden) return { leads: [], followups: [], branches: [], statuses: [], forbidden: true };
      throw e;
    });
  },
  // detail — reuse lead row ที่ cache ไว้
  lpDetail: function (id) {
    var r = null;
    for (var i = 0; i < _lp2Leads.length; i++) { if (_lp2Leads[i].lead_id === id) { r = _lp2Leads[i]; break; } }
    return Promise.resolve(r);
  },
};

/* ============================================================
   mountLeadpipe — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountLeadpipe() {
  if (!document.getElementById('wrap-leadpipe')) return;
  var wrap = document.getElementById('wrap-leadpipe');
  wrap.innerHTML = '<style>' + LP_CSS() + '</style><div id="lp2">' + LP_MARKUP() + '</div>';
  LP_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #lp2 (brand tokens เดียวกับหน้าอื่น) ===== */
function LP_CSS() {
  return [
    '#lp2{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#lp2 *{box-sizing:border-box}',
    // page head
    '#lp2 .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#lp2 .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#lp2 .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#lp2 .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#lp2 .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // buttons
    '#lp2 .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#lp2 .btn:hover{border-color:var(--navy)}',
    '#lp2 .btn svg{width:14px;height:14px}',
    '#lp2 .btn-sm{padding:5px 10px;font-size:12px}',
    // read-only / confidential banner
    '#lp2 .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:10px;display:flex;align-items:center;gap:8px}',
    '#lp2 .ro-banner strong{font-weight:600}',
    '#lp2 .disclaimer{background:#FFFBEB;border:1px solid #FDE68A;color:#92400E;border-radius:6px;padding:8px 14px;font-size:11.5px;margin-bottom:14px;line-height:1.5}',
    // stat cards
    '#lp2 .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#lp2 .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#lp2 .stats{grid-template-columns:repeat(2,1fr)}}',
    '#lp2 .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#lp2 .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#lp2 .stat-card.total::before{background:#1E40AF}',
    '#lp2 .stat-card.closed::before{background:#166534}',
    '#lp2 .stat-card.rate::before{background:#2BA89B}',
    '#lp2 .stat-card.deposit::before{background:#B45309}',
    '#lp2 .stat-card.close::before{background:#4338CA}',
    '#lp2 .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#lp2 .stat-card .v{font-size:22px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#lp2 .stat-card.closed .v{color:#166534}',
    '#lp2 .stat-card.rate .v{color:#2BA89B}',
    '#lp2 .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // funnel
    '#lp2 .funnel{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:6px}',
    '@media (max-width:600px){#lp2 .funnel{grid-template-columns:repeat(2,1fr)}}',
    '#lp2 .funnel-step{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;position:relative}',
    '#lp2 .funnel-step .fl{font-size:11px;color:var(--text-muted);font-weight:600}',
    '#lp2 .funnel-step .fv{font-size:24px;font-weight:700;color:var(--navy);margin-top:4px;letter-spacing:-.02em}',
    '#lp2 .funnel-step .fp{font-size:10px;color:var(--text-faint);margin-top:2px}',
    '#lp2 .funnel-bar{height:6px;border-radius:4px;margin-top:8px;background:#F1F5F9;overflow:hidden}',
    '#lp2 .funnel-bar .fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#3DC5B7,#2BA89B)}',
    '#lp2 .funnel-step.s-received .fill{background:linear-gradient(90deg,#60A5FA,#2563EB)}',
    '#lp2 .funnel-step.s-follow .fill{background:linear-gradient(90deg,#FBBF24,#B45309)}',
    '#lp2 .funnel-step.s-booked .fill{background:linear-gradient(90deg,#A78BFA,#6D28D9)}',
    '#lp2 .funnel-step.s-closed .fill{background:linear-gradient(90deg,#3DC5B7,#166534)}',
    // filters
    '#lp2 .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#lp2 .filter{display:flex;flex-direction:column;gap:2px}',
    '#lp2 .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#lp2 .filter select,#lp2 .filter input{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#lp2 .filter select:focus,#lp2 .filter input:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section title
    '#lp2 .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px}',
    // pills (สถานะ Lead → stage)
    '#lp2 .pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap}',
    '#lp2 .pill-received{background:#DBEAFE;color:#1E40AF}',
    '#lp2 .pill-follow{background:#FEF3C7;color:#92400E}',
    '#lp2 .pill-booked{background:#EDE9FE;color:#6D28D9}',
    '#lp2 .pill-closed{background:#DCFCE7;color:#166534}',
    '#lp2 .pill-na{background:#E5E7EB;color:#6B7280}',
    // data table
    '#lp2 .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#lp2 .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);white-space:nowrap}',
    '#lp2 .data-table th.num,#lp2 .data-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '#lp2 .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top}',
    '#lp2 .data-table tr:last-child td{border-bottom:0}',
    '#lp2 .data-table tbody tr{cursor:pointer}',
    '#lp2 .data-table tbody tr:hover td{background:#F0FBF9}',
    '#lp2 .data-table tfoot td{font-weight:700;background:#F8FAFC;border-top:2px solid var(--border-strong);color:var(--navy);cursor:default}',
    '#lp2 .rev-cell{font-weight:600;color:#166534}',
    '#lp2 .id-cell{font-weight:600;color:var(--navy)}',
    '#lp2 .mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text-muted)}',
    '#lp2 .table-wrap{overflow-x:auto}',
    // call log chips
    '#lp2 .tag{display:inline-block;font-size:10px;padding:1px 7px;border-radius:8px;font-weight:600;background:#F1F5F9;color:#475569}',
    '#lp2 .csat{font-weight:700;font-variant-numeric:tabular-nums}',
    // modal (detail)
    '#lp2 .modal-bg{position:fixed;inset:0;background:rgba(13,47,79,.45);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#lp2 .modal-bg.active{display:flex}',
    '#lp2 .modal{background:#fff;border-radius:12px;max-width:560px;width:94%;max-height:92vh;overflow-y:auto}',
    '#lp2 .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;gap:12px}',
    '#lp2 .modal-header h2{font-size:16px;margin:0;color:var(--navy)}',
    '#lp2 .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#lp2 .modal-x{cursor:pointer;border:none;background:none;font-size:20px;color:var(--text-faint);line-height:1}',
    '#lp2 .modal-body{padding:16px 20px}',
    '#lp2 .kv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}',
    '#lp2 .kv{background:#F9FAFB;border:1px solid var(--border);border-radius:8px;padding:9px 11px}',
    '#lp2 .kv .k{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}',
    '#lp2 .kv .v{font-size:14px;font-weight:600;color:var(--navy);margin-top:2px;word-break:break-word}',
    '#lp2 .kv.full{grid-column:1/-1}',
    // empty / loading / gate
    '#lp2 .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#lp2 .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#lp2 .empty-icon svg{width:24px;height:24px}',
    '#lp2 .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#lp2 .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#lp2 .empty-sm{text-align:center;padding:24px;background:var(--surface);border:1px dashed var(--border-strong);border-radius:8px;color:var(--text-muted);font-size:12px;margin-bottom:14px}',
    '#lp2 .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // gate (403/401)
    '#lp2 .gate{text-align:center;padding:64px 24px;background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);border-radius:14px;color:#fff}',
    '#lp2 .gate-icon{width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;margin:0 auto 16px}',
    '#lp2 .gate-icon svg{width:30px;height:30px;color:#fff}',
    '#lp2 .gate-title{font-size:17px;font-weight:700;margin-bottom:6px}',
    '#lp2 .gate-sub{font-size:13px;color:#CBD5E1;max-width:380px;margin:0 auto;line-height:1.6}',
  ].join('\n');
}

/* ===== markup ===== */
function LP_MARKUP() {
  return [
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54z"/></svg>',
    '      Lead Pipeline (FO)',
    '    </h1>',
    '    <div class="subtitle" id="lp2-subtitle">ภาพรวม Lead หน้าร้าน · funnel · อัตราปิด · call log (FO Lead Pipeline)</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-sm" onclick="lp2Reload()" id="lp2-refresh-btn"></button>',
    '  </div>',
    '</header>',
    '<div class="ro-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#EF4444;display:inline-block"></span>',
    '  <span><strong>เฉพาะผู้บริหาร/HQ:</strong> ข้อมูล Lead แบบไม่ระบุตัวบุคคล (pseudonymized — ไม่มีชื่อ/เบอร์/HN/อาการ) · อ่านอย่างเดียว</span>',
    '</div>',
    '<div class="stats" id="lp2-stats"></div>',
    '<div class="filters" id="lp2-filters">',
    '  <div class="filter">',
    '    <label>สาขา</label>',
    '    <select id="lp2-filter-branch" onchange="lp2Render()"><option value="">ทุกสาขา</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>สถานะ Lead</label>',
    '    <select id="lp2-filter-status" onchange="lp2Render()"><option value="">ทุกสถานะ</option></select>',
    '  </div>',
    '  <div class="filter" style="flex:1;min-width:180px">',
    '    <label>ค้นหา (Lead ID/Brand/ผู้ปิด)</label>',
    '    <input id="lp2-filter-q" type="text" placeholder="พิมพ์เพื่อค้นหา..." oninput="lp2Render()" style="width:100%">',
    '  </div>',
    '</div>',
    '<div id="lp2-content" class="loading">กำลังโหลด...</div>',
    // detail modal
    '<div class="modal-bg" id="lp2-detail-bg" onclick="if(event.target===this)lp2CloseDetail()">',
    '  <div class="modal">',
    '    <div class="modal-header">',
    '      <div><h2 id="lp2-d-title">กำลังโหลด...</h2><p id="lp2-d-sub">—</p></div>',
    '      <button class="modal-x" onclick="lp2CloseDetail()">&times;</button>',
    '    </div>',
    '    <div class="modal-body" id="lp2-d-body"></div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   LP_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function LP_RUN_PAGE_JS() {
  var _lpRoot = document.getElementById('lp2');
  function $id(id) { return _lpRoot ? _lpRoot.querySelector('#' + id) : document.getElementById(id); }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function showToast(msg, type) {
    var t = document.getElementById('lp2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'lp2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var ICON_FUNNEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54z"/></svg>';
  var ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  var _lpData = null; // { leads, followups, branches, statuses, forbidden }

  // ---- format helpers (กัน throw ถ้า null) ----
  function fmtBaht(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try { return '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
    catch (e) { return '฿' + String(Math.round(n)); }
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

  // stage → label + pill class
  var STAGE_LABEL = { received: 'รับ Lead', follow: 'ติดตาม', booked: 'นัด/จอง', closed: 'ปิดได้' };
  var STAGE_PILL = { received: 'pill-received', follow: 'pill-follow', booked: 'pill-booked', closed: 'pill-closed' };
  function stagePill(stage, rawStatus) {
    var cls = STAGE_PILL[stage] || 'pill-na';
    var label = rawStatus ? rawStatus : (STAGE_LABEL[stage] || '—');
    return '<span class="pill ' + cls + '">' + escapeHtml(label) + '</span>';
  }

  // ---- load ----
  function loadData() {
    var c = $id('lp2-content');
    c.className = 'loading'; c.innerHTML = 'กำลังโหลด...';
    LP_BACKEND.lpList().then(function (res) {
      _lpData = res || { leads: [], followups: [], branches: [], statuses: [], forbidden: false };
      if (_lpData.forbidden) { renderGate(); return; }
      populateFilters();
      renderAll();
    }).catch(function (e) {
      console.error('[leadpipe] load failed', e);
      _lpData = { leads: [], followups: [], branches: [], statuses: [], forbidden: false };
      var cc = $id('lp2-content');
      cc.className = '';
      cc.innerHTML = '<div class="empty"><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml((e && e.message) || 'unknown') + '</div></div>';
      renderStats([]);
    });
  }

  // ---- 403/401 director/HQ gate ----
  function renderGate() {
    var st = $id('lp2-stats'); if (st) st.innerHTML = '';
    var fl = $id('lp2-filters'); if (fl) fl.style.display = 'none';
    var sub = $id('lp2-subtitle'); if (sub) sub.textContent = 'หน้านี้เฉพาะผู้บริหาร/HQ';
    var c = $id('lp2-content');
    c.className = '';
    c.innerHTML = [
      '<div class="gate">',
      '  <div class="gate-icon">' + ICON_LOCK + '</div>',
      '  <div class="gate-title">หน้านี้เฉพาะผู้บริหาร / HQ</div>',
      '  <div class="gate-sub">ข้อมูล Lead Pipeline หน้าร้าน (FO) เปิดให้เฉพาะผู้บริหาร (director) และ HQ เท่านั้น หากต้องการสิทธิ์เข้าถึง กรุณาติดต่อ HR Manager</div>',
      '</div>',
    ].join('');
  }

  function populateFilters() {
    var bSel = $id('lp2-filter-branch');
    if (bSel && bSel.options.length <= 1) {
      (_lpData.branches || []).forEach(function (b) {
        var o = document.createElement('option');
        o.value = b; o.textContent = b;
        bSel.appendChild(o);
      });
    }
    var sSel = $id('lp2-filter-status');
    if (sSel && sSel.options.length <= 1) {
      (_lpData.statuses || []).forEach(function (s) {
        var o = document.createElement('option');
        o.value = s; o.textContent = s;
        sSel.appendChild(o);
      });
    }
  }

  function curFilters() {
    return {
      branch: ($id('lp2-filter-branch') || {}).value || '',
      status: ($id('lp2-filter-status') || {}).value || '',
      q: (($id('lp2-filter-q') || {}).value || '').trim().toLowerCase(),
    };
  }

  function filteredLeads() {
    var f = curFilters();
    var rows = (_lpData && _lpData.leads) ? _lpData.leads.slice() : [];
    if (f.branch) rows = rows.filter(function (r) { return r.branch === f.branch; });
    if (f.status) rows = rows.filter(function (r) { return r.status_lead === f.status; });
    if (f.q) {
      rows = rows.filter(function (r) {
        return (r.lead_id + ' ' + r.brand + ' ' + r.branch + ' ' + r.converted_by + ' ' + r.service_type + ' ' + r.status_lead).toLowerCase().indexOf(f.q) >= 0;
      });
    }
    // เรียงล่าสุดก่อน (วันที่)
    rows.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    return rows;
  }

  // ---- render ----
  function renderAll() {
    var all = (_lpData && _lpData.leads) ? _lpData.leads : [];
    renderStats(all);
    var content = $id('lp2-content');
    content.className = '';

    var hasAny = all.length || (_lpData && _lpData.followups && _lpData.followups.length);
    if (!hasAny) { content.innerHTML = emptyState(); return; }

    content.innerHTML =
      renderFunnel(all) +
      renderPipelineTable() +
      renderCallLogSection();
  }

  // การ์ดสรุป — ใช้ "ทั้งหมด" (ไม่ขึ้นกับ filter)
  function renderStats(all) {
    all = all || [];
    var total = all.length;
    var closed = 0, depositSum = 0, closeSum = 0;
    all.forEach(function (r) {
      if (r.is_closed) closed++;
      depositSum += Number(r.deposit_amount) || 0;
      closeSum += Number(r.close_amount) || 0;
    });
    var rate = total > 0 ? (closed / total) * 100 : null;

    $id('lp2-stats').innerHTML = [
      statCard('total', 'Lead ทั้งหมด', fmtInt(total), (_lpData.branches || []).length + ' สาขา'),
      statCard('closed', 'ปิดได้', fmtInt(closed), 'มีผู้ปิด/ยอดปิด'),
      statCard('rate', 'อัตราปิด', fmtPct(rate), total > 0 ? closed + ' / ' + total : 'ไม่มีข้อมูล'),
      statCard('deposit', 'ยอดมัดจำรวม', fmtBaht(depositSum), 'ทุก Lead'),
      statCard('close', 'ยอดปิดรวม', fmtBaht(closeSum), 'ที่ปิดได้'),
    ].join('');

    var sub = $id('lp2-subtitle');
    if (sub) {
      var nFu = (_lpData && _lpData.followups) ? _lpData.followups.length : 0;
      sub.textContent = 'FO Lead Pipeline · ' + total + ' lead · ' + nFu + ' call log · ' + (_lpData.branches || []).length + ' สาขา';
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

  // ===== Funnel: นับ Lead ตาม stage (รับ→ติดตาม→นัด→ปิด) · เคารพ filter สาขา/สถานะ =====
  function renderFunnel(allLeads) {
    var f = curFilters();
    // funnel ใช้ leads ที่ผ่าน filter สาขา (ไม่ผูก status filter เพื่อให้เห็นทุก stage) + คำค้น
    var rows = (allLeads || []).slice();
    if (f.branch) rows = rows.filter(function (r) { return r.branch === f.branch; });
    if (f.q) {
      rows = rows.filter(function (r) {
        return (r.lead_id + ' ' + r.brand + ' ' + r.branch + ' ' + r.converted_by + ' ' + r.service_type + ' ' + r.status_lead).toLowerCase().indexOf(f.q) >= 0;
      });
    }

    var counts = { received: 0, follow: 0, booked: 0, closed: 0 };
    rows.forEach(function (r) { counts[r.stage] = (counts[r.stage] || 0) + 1; });
    var total = rows.length || 0;
    var maxN = Math.max(counts.received, counts.follow, counts.booked, counts.closed, 1);

    var steps = [
      { key: 'received', cls: 's-received', label: 'รับ Lead' },
      { key: 'follow', cls: 's-follow', label: 'ติดตาม' },
      { key: 'booked', cls: 's-booked', label: 'นัด/จอง' },
      { key: 'closed', cls: 's-closed', label: 'ปิดได้' },
    ];
    var cards = steps.map(function (s) {
      var n = counts[s.key] || 0;
      var pctOfTotal = total > 0 ? Math.round((n / total) * 100) : 0;
      var barW = Math.max(2, Math.round((n / maxN) * 100));
      return [
        '<div class="funnel-step ' + s.cls + '">',
        '  <div class="fl">' + escapeHtml(s.label) + '</div>',
        '  <div class="fv">' + fmtInt(n) + '</div>',
        '  <div class="fp">' + pctOfTotal + '% ของทั้งหมด</div>',
        '  <div class="funnel-bar"><div class="fill" style="width:' + barW + '%"></div></div>',
        '</div>',
      ].join('');
    }).join('');

    return [
      '<div class="sec-title">Funnel · สถานะ Lead (รับ → ติดตาม → นัด → ปิด)' + (f.branch ? ' · ' + escapeHtml(f.branch) : '') + '</div>',
      '<div class="funnel">' + cards + '</div>',
    ].join('');
  }

  // ===== ตาราง Pipeline =====
  function renderPipelineTable() {
    var rows = filteredLeads();
    if (!rows.length) {
      return '<div class="sec-title">รายการ Lead</div><div class="empty-sm">ไม่มี Lead ตามตัวกรอง — ลองเปลี่ยนสาขา/สถานะ หรือล้างคำค้น</div>';
    }
    var totDeposit = 0, totClose = 0, totClosed = 0;
    var body = rows.map(function (r) {
      totDeposit += Number(r.deposit_amount) || 0;
      totClose += Number(r.close_amount) || 0;
      if (r.is_closed) totClosed++;
      return [
        '<tr onclick="lp2OpenDetail(\'' + escapeHtml(r.lead_id).replace(/'/g, '&#39;') + '\')">',
        '  <td class="id-cell"><span class="mono">' + escapeHtml(r.lead_id) + '</span></td>',
        '  <td>' + escapeHtml(r.brand || '—') + '</td>',
        '  <td>' + escapeHtml(r.branch || '—') + '</td>',
        '  <td>' + stagePill(r.stage, r.status_lead) + '</td>',
        '  <td class="num">' + (r.budget == null ? '—' : fmtBaht(r.budget)) + '</td>',
        '  <td class="num rev-cell">' + (r.close_amount > 0 ? fmtBaht(r.close_amount) : '—') + '</td>',
        '  <td>' + (r.converted_by ? escapeHtml(r.converted_by) : '—') + '</td>',
        '  <td><span class="mono">' + escapeHtml(r.date || '—') + '</span></td>',
        '</tr>',
      ].join('');
    }).join('');

    return [
      '<div class="sec-title">รายการ Lead · เรียงล่าสุดก่อน (' + rows.length + ' lead · ปิดได้ ' + totClosed + ') · คลิกเพื่อดูรายละเอียด</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>',
      '    <th>Lead ID</th><th>Brand</th><th>สาขา</th><th>สถานะ</th>',
      '    <th class="num">Budget</th><th class="num">ยอดปิด</th><th>Converted By</th><th>วันที่</th>',
      '  </tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '  <tfoot><tr>',
      '    <td colspan="4">รวม (' + rows.length + ' lead)</td>',
      '    <td class="num">—</td>',
      '    <td class="num">' + fmtBaht(totClose) + '</td>',
      '    <td colspan="2">มัดจำรวม ' + fmtBaht(totDeposit) + '</td>',
      '  </tr></tfoot>',
      '</table>',
      '</div>',
    ].join('');
  }

  // ===== Call Log: ผลสาย / CSAT =====
  function renderCallLogSection() {
    var f = curFilters();
    var fus = (_lpData && _lpData.followups) ? _lpData.followups.slice() : [];

    // ถ้ากรองสาขา → จำกัด call log เฉพาะ lead ในสาขานั้น (จับคู่ผ่าน lead_id)
    if (f.branch) {
      var inBranch = {};
      (_lpData.leads || []).forEach(function (r) { if (r.branch === f.branch && r.lead_id) inBranch[r.lead_id] = true; });
      fus = fus.filter(function (x) { return x.lead_id && inBranch[x.lead_id]; });
    }

    if (!fus.length) {
      return '<div class="sec-title">Call Log · ผลสาย / CSAT</div><div class="empty-sm">ยังไม่มี call log (fo.followup.logged)' + (f.branch ? ' สำหรับสาขานี้' : '') + '</div>';
    }

    // นับผลสาย
    var resCount = {}; var resOrder = [];
    var csatSum = 0, csatN = 0;
    fus.forEach(function (x) {
      var rk = x.call_result || '(ไม่ระบุ)';
      if (resCount[rk] == null) { resCount[rk] = 0; resOrder.push(rk); }
      resCount[rk]++;
      if (x.csat != null && isFinite(Number(x.csat))) { csatSum += Number(x.csat); csatN++; }
    });
    var csatAvg = csatN > 0 ? csatSum / csatN : null;
    resOrder.sort(function (a, b) { return resCount[b] - resCount[a]; });

    // สรุปผลสาย (chip นับ)
    var resChips = resOrder.map(function (rk) {
      return '<span class="tag" style="font-size:11px;padding:3px 10px;margin:0 4px 4px 0">' + escapeHtml(rk) + ' · ' + fmtInt(resCount[rk]) + '</span>';
    }).join('');

    // ตาราง call log ล่าสุด (จำกัด 200 แถว กัน DOM ใหญ่)
    var sorted = fus.slice().sort(function (a, b) { return String(b.when || '').localeCompare(String(a.when || '')); });
    var shown = sorted.slice(0, 200);
    var body = shown.map(function (x) {
      return [
        '<tr style="cursor:default">',
        '  <td><span class="mono">' + escapeHtml(x.lead_id || '—') + '</span></td>',
        '  <td><span class="mono">' + escapeHtml(x.when || '—') + '</span></td>',
        '  <td>' + (x.call_result ? escapeHtml(x.call_result) : '—') + '</td>',
        '  <td>' + (x.caller ? escapeHtml(x.caller) : '—') + '</td>',
        '  <td>' + (x.chip ? '<span class="tag">' + escapeHtml(x.chip) + '</span>' : '—') + '</td>',
        '  <td class="num csat">' + (x.csat == null ? '—' : escapeHtml(String(x.csat))) + '</td>',
        '  <td>' + (x.liked_factor ? escapeHtml(x.liked_factor) : '—') + '</td>',
        '</tr>',
      ].join('');
    }).join('');

    var moreNote = sorted.length > shown.length ? ' (แสดง ' + shown.length + ' จาก ' + sorted.length + ')' : '';

    return [
      '<div class="sec-title">Call Log · สรุปผลสาย (' + fus.length + ' สาย) · CSAT เฉลี่ย ' + (csatAvg == null ? '—' : (Math.round(csatAvg * 10) / 10)) + '</div>',
      '<div style="margin-bottom:10px">' + (resChips || '<span class="empty-sub">ไม่มีผลสาย</span>') + '</div>',
      '<div class="sec-title">Call Log · ละเอียด' + moreNote + '</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>',
      '    <th>Lead ID</th><th>เวลา</th><th>ผลสาย</th><th>ผู้โทร</th><th>ชิปผลคุย</th><th class="num">CSAT</th><th>ปัจจัยที่ชอบ</th>',
      '  </tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '</table>',
      '</div>',
    ].join('');
  }

  function emptyState() {
    return [
      '<div class="empty">',
      '  <div class="empty-icon">' + ICON_FUNNEL + '</div>',
      '  <div class="empty-title">ยังไม่มีข้อมูล Lead Pipeline</div>',
      '  <div class="empty-sub">เมื่อระบบหน้าร้าน (FO) ส่งข้อมูล Lead / call log (fo.lead.updated · fo.followup.logged) ข้อมูลจะแสดงที่นี่</div>',
      '</div>',
    ].join('');
  }

  // ---- detail (read-only) ----
  function kv(label, val, full) {
    var v = (val == null || val === '') ? '—' : val;
    return '<div class="kv' + (full ? ' full' : '') + '"><div class="k">' + escapeHtml(label) + '</div><div class="v">' + escapeHtml(v) + '</div></div>';
  }
  function openDetail(id) {
    LP_BACKEND.lpDetail(id).then(function (r) {
      if (!r) { showToast('ไม่พบข้อมูล Lead', 'error'); return; }
      $id('lp2-d-title').textContent = r.lead_id || '—';
      $id('lp2-d-sub').textContent = (r.brand ? r.brand + ' · ' : '') + (r.branch || '') + (r.service_type ? ' · ' + r.service_type : '');
      var parts = [
        '<div class="kv-grid">',
        kv('Lead ID', r.lead_id),
        kv('Brand', r.brand),
        kv('สาขา', r.branch),
        kv('Service Type', r.service_type),
        kv('สถานะ Lead', r.status_lead),
        kv('สถานะติดตาม', r.status_followup),
        kv('Budget', r.budget == null ? '' : fmtBaht(r.budget)),
        kv('ยอดมัดจำ', r.deposit_amount ? fmtBaht(r.deposit_amount) : ''),
        kv('ยอดปิด', r.close_amount ? fmtBaht(r.close_amount) : ''),
        kv('Attempts', r.attempts == null ? '' : String(r.attempts)),
        kv('SLA Due', r.sla_due),
        kv('Created By', r.created_by),
        kv('Booked By', r.booked_by),
        kv('Converted By', r.converted_by),
        kv('วันที่', r.date),
      ];
      // call log ของ lead นี้
      var fus = ((_lpData && _lpData.followups) || []).filter(function (x) { return x.lead_id && x.lead_id === r.lead_id; });
      if (fus.length) {
        var lines = fus.slice().sort(function (a, b) { return String(b.when || '').localeCompare(String(a.when || '')); }).map(function (x) {
          return escapeHtml((x.when || '—') + ' · ' + (x.call_result || '—') + (x.caller ? ' · ' + x.caller : '') + (x.csat != null ? ' · CSAT ' + x.csat : ''));
        }).join('<br>');
        parts.push(kv('Call Log (' + fus.length + ')', '', true).replace('—', lines));
      }
      parts.push('</div>');
      parts.push('<div class="disclaimer" style="margin:14px 0 0">หน้านี้อ่านอย่างเดียว · ข้อมูล Lead เป็นแบบไม่ระบุตัวบุคคล (ไม่มีชื่อ/เบอร์/HN/อาการ) · จัดการได้ที่ระบบหน้าร้าน (FO) เท่านั้น</div>');
      $id('lp2-d-body').innerHTML = parts.join('');
      $id('lp2-detail-bg').classList.add('active');
    });
  }
  function closeDetail() { $id('lp2-detail-bg').classList.remove('active'); }

  // ---- read-only write stub (กันมี action เขียนในอนาคต) ----
  function lp2WriteStub() { showToast('หน้านี้อ่านอย่างเดียว · จัดการที่ระบบหน้าร้าน (FO)', 'error'); }

  function lp2Reload() { loadData(); }
  function lp2Render() { renderAll(); }

  // init labels
  $id('lp2-refresh-btn').innerHTML = ICON_REFRESH + ' รีเฟรช';

  // expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix lp2* กันชน)
  window.lp2Reload = lp2Reload;
  window.lp2Render = lp2Render;
  window.lp2OpenDetail = openDetail;
  window.lp2CloseDetail = closeDetail;
  window.lp2WriteStub = lp2WriteStub;

  // init
  loadData();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountLeadpipe) */
if (typeof window !== 'undefined') {
  window.mountLeadpipe = mountLeadpipe;
  window.LP_BACKEND = LP_BACKEND;
}
