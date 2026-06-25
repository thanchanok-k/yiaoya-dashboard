// _ported/contracts.js — Native read-only page "สัญญาจ้าง (Contracts)" สำหรับ Supabase dashboard
// ลับ HQ เท่านั้น (เฉพาะผู้บริหาร/HQ) · อ่านอย่างเดียว (ไม่มี write)
//
// ลอกดีไซน์/แนวคิดจาก GAS contract_manager.html (สัญญา + กฎที่เซ็น + ละเมิด)
//   แต่บน dashboard เป็น read-only + ดึงข้อมูลจาก Supabase edge fn **hr_list_hq** (ไม่ใช่ hr_list!)
//   เพราะข้อมูลสัญญาเป็นความลับ → endpoint แยกที่ role-gate ฝั่ง backend
//
// ทำตาม pattern เดียวกับ _ported/scorecard.js + _ported/recruit.js:
//   - mountContracts render เข้า #wrap-contracts
//   - ใช้ global window.sb (index.html module scope) — ห้าม redeclare (ใช้ window.sb/esc/$)
//   - CSS scope ใต้ #ct2 · fn ที่ inline onclick ต้องใช้ → ผูกกับ window (prefix ct2*) กันชน
//   - helper (esc/showToast) inline ใน scope
//
// backend (edge fn hr_list_hq) — 2 type:
//   hr_list_hq?type=contract.updated&limit=2000      → สัญญา (contract_id, employee_id/full_name,
//        contract_type, start_date, end_date, status · **เลขเงินเดือน strip ที่ sync แล้ว** ไม่โชว์เงิน)
//   hr_list_hq?type=contract_rule.updated&limit=2000 → กฎสัญญา (rule_id, name, description)
//   **ไม่รู้ field แน่นอน** → defensive: แสดง field ที่มีจริง
//   **403** (ไม่ใช่ HQ) → หน้า "เฉพาะผู้บริหาร/HQ" สวย ๆ ไม่ throw error

/* ============================================================
   CT2_BACKEND — ดึง 2 type จาก hr_list_hq · normalize ฝั่ง client
   คืน { contracts, rules, denied } — denied=true เมื่อ 403 (ไม่ใช่ HQ)
   ============================================================ */
var CT2_FN = 'hr_list_hq';
var CT2_TYPE_CONTRACT = 'contract.updated';
var CT2_TYPE_RULE = 'contract_rule.updated';
var CT2_LIMIT = 2000;
var CT2_NEAR_DAYS = 45; // ใกล้ครบกำหนด (default ตาม GAS warn_days)

function ct2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.items)) return v.items;
  return [];
}
function ct2Str(v) {
  if (v == null) return '';
  return String(v).trim();
}
function ct2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
// YYYY-MM-DD จากค่าวันที่ (defensive)
function ct2Date(v) {
  if (v == null || v === '') return '';
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  return s.slice(0, 10);
}
// จำนวนวันจากวันนี้ถึง date (บวก=อนาคต, ลบ=อดีต) · null ถ้า parse ไม่ได้
function ct2DaysFromNow(dateStr) {
  if (!dateStr) return null;
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

// label สวยของ contract_type ที่รู้จัก (ลอกจาก GAS)
function ct2TypeLabel(t) {
  var k = String(t || '').toLowerCase();
  if (k === 'fixed_term') return 'มีกำหนด';
  if (k === 'indefinite') return 'ไม่มีกำหนด';
  if (k === 'probation') return 'ทดลองงาน';
  if (k === 'contractor') return 'ผู้รับจ้าง';
  return t || '—';
}
// label สถานะที่รู้จัก
function ct2StatusLabel(s) {
  var k = String(s || '').toLowerCase();
  var map = {
    active: 'ใช้งาน', sent: 'ส่งแล้ว', draft: 'ร่าง', renewed: 'ต่อแล้ว',
    expired: 'หมดอายุ', terminated: 'สิ้นสุด', signed: 'เซ็นแล้ว', pending: 'รอดำเนินการ',
  };
  return map[k] || (s || '—');
}

// map payload สัญญา ดิบ → row (defensive · ไม่แตะตัวเลขเงินเดือน — strip ที่ sync แล้ว)
function ct2MapContract(p) {
  p = p || {};
  var endDate = ct2Date(p.end_date || p.expiry_date || p.contract_end);
  var startDate = ct2Date(p.start_date || p.effective_date || p.contract_start);
  var status = String(p.status || p.signed_status || '').toLowerCase().trim();
  var endDays = ct2DaysFromNow(endDate);
  var isExpired = ct2Bool(p.is_expired) || (endDate && endDays != null && endDays < 0 && status !== 'indefinite' && String(p.contract_type || '').toLowerCase() !== 'indefinite');
  var isNear = !isExpired && ct2Bool(p.is_near_expiry) || (!isExpired && endDate && endDays != null && endDays >= 0 && endDays <= CT2_NEAR_DAYS);
  return {
    id: ct2Str(p.contract_id || p.entity_id || p.id),
    employee_id: ct2Str(p.employee_id || p.emp_id),
    employee_name: ct2Str(p.full_name || p.employee_name || p.name) || ct2Str(p.employee_id) || '—',
    contract_type: ct2Str(p.contract_type || p.type),
    party_type: ct2Str(p.party_type),
    start_date: startDate,
    end_date: endDate,
    status: status,
    round_no: (p.round_no != null && p.round_no !== '') ? p.round_no : '',
    branch_id: ct2Str(p.branch_id || p.branch),
    position_id: ct2Str(p.position_id || p.position),
    ruleset_version: ct2Str(p.ruleset_version),
    signed_at: ct2Date(p.signed_at),
    sign_method: ct2Str(p.sign_method),
    has_file: ct2Bool(p.has_file),
    note: ct2Str(p.note || p.notes || p.remark),
    is_expired: !!isExpired,
    is_near_expiry: !!isNear,
    near_days: endDays,
    _raw: p,
  };
}

// map payload กฎ ดิบ → row (defensive)
function ct2MapRule(p) {
  p = p || {};
  return {
    id: ct2Str(p.rule_id || p.entity_id || p.id),
    name: ct2Str(p.name || p.title) || '—',
    category: ct2Str(p.category),
    severity: ct2Str(p.severity),
    description: ct2Str(p.description || p.text || p.detail),
    is_umbrella: ct2Bool(p.is_umbrella),
    _raw: p,
  };
}

// ตรวจ 403 จาก res ของ functions.invoke (supabase-js คืน {data,error}; error.context = Response)
function ct2Is403(res) {
  if (!res) return false;
  var err = res.error || res;
  if (!err) return false;
  // FunctionsHttpError → err.context.status
  if (err.context && typeof err.context.status === 'number') {
    if (err.context.status === 403 || err.context.status === 401) return true;
  }
  if (typeof err.status === 'number' && (err.status === 403 || err.status === 401)) return true;
  var msg = String(err.message || err.error || err).toLowerCase();
  return msg.indexOf('403') >= 0 || msg.indexOf('forbidden') >= 0 ||
    msg.indexOf('401') >= 0 || msg.indexOf('unauthor') >= 0 || msg.indexOf('not allowed') >= 0;
}

function ct2GetSb() {
  return (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
}

// ดึง 1 type · คืน { items, denied, error }
function ct2FetchType(type) {
  var sb = ct2GetSb();
  if (!sb || !sb.functions) return Promise.resolve({ items: [], denied: false, error: 'no sb' });
  var q = CT2_FN + '?type=' + encodeURIComponent(type) + '&limit=' + CT2_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    if (res && res.error) {
      if (ct2Is403(res)) return { items: [], denied: true, error: null };
      return { items: [], denied: false, error: (res.error.message || String(res.error)) };
    }
    var data = (res && res.data) || {};
    return { items: ct2ToArr(data.items || data), denied: false, error: null };
  }).catch(function (e) {
    if (ct2Is403({ error: e })) return { items: [], denied: true, error: null };
    console.warn('[CT2_BACKEND] fetch failed', type, e);
    return { items: [], denied: false, error: (e && e.message) || String(e) };
  });
}

var CT2_BACKEND = {
  // list — { contracts, rules, denied, error }
  list: function () {
    return Promise.all([
      ct2FetchType(CT2_TYPE_CONTRACT),
      ct2FetchType(CT2_TYPE_RULE),
    ]).then(function (r) {
      var cRes = r[0], rRes = r[1];
      // denied = ทั้งคู่โดน 403 (สิทธิ์ทั้งหน้า) — ถ้าตัวใดตัวหนึ่ง denied ก็ถือว่าไม่ใช่ HQ
      var denied = cRes.denied || rRes.denied;
      if (denied) return { contracts: [], rules: [], denied: true, error: null };

      var seenC = {}, contracts = [];
      cRes.items.forEach(function (p) {
        var row = ct2MapContract(p);
        var key = row.id || (row.employee_id + '|' + row.start_date + '|' + row.end_date);
        if (!key || seenC[key]) return;
        seenC[key] = true;
        if (!row.id) row.id = key;
        contracts.push(row);
      });

      var seenR = {}, rules = [];
      rRes.items.forEach(function (p) {
        var row = ct2MapRule(p);
        var key = row.id || row.name;
        if (!key || seenR[key]) return;
        seenR[key] = true;
        if (!row.id) row.id = key;
        rules.push(row);
      });

      return {
        contracts: contracts,
        rules: rules,
        denied: false,
        error: cRes.error || rRes.error || null,
      };
    });
  },
};

/* ============================================================
   mountContracts — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountContracts() {
  if (!document.getElementById('wrap-contracts')) return;
  var wrap = document.getElementById('wrap-contracts');
  wrap.innerHTML = '<style>' + CT2_CSS() + '</style><div id="ct2">' + CT2_MARKUP() + '</div>';
  CT2_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #ct2 (brand tokens เดียวกับหน้าอื่น) ===== */
function CT2_CSS() {
  return [
    '#ct2{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#ct2 *{box-sizing:border-box}',
    // page head
    '#ct2 .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#ct2 .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ct2 .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#ct2 .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ct2 .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // buttons
    '#ct2 .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#ct2 .btn:hover{border-color:var(--navy)}',
    '#ct2 .btn svg{width:14px;height:14px}',
    '#ct2 .btn-sm{padding:5px 10px;font-size:12px}',
    // HQ-confidential banner
    '#ct2 .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#ct2 .ro-banner strong{font-weight:600}',
    '#ct2 .ro-lock{width:14px;height:14px;flex-shrink:0}',
    // stat cards
    '#ct2 .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#ct2 .stats{grid-template-columns:repeat(2,1fr)}}',
    '@media (max-width:600px){#ct2 .stats{grid-template-columns:repeat(2,1fr)}}',
    '#ct2 .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#ct2 .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#ct2 .stat-card.total::before{background:#1E40AF}',
    '#ct2 .stat-card.near::before{background:#B45309}',
    '#ct2 .stat-card.expired::before{background:#B91C1C}',
    '#ct2 .stat-card.rules::before{background:#6D28D9}',
    '#ct2 .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#ct2 .stat-card .v{font-size:22px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#ct2 .stat-card.near .v{color:#B45309}',
    '#ct2 .stat-card.expired .v{color:#B91C1C}',
    '#ct2 .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#ct2 .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#ct2 .filter{display:flex;flex-direction:column;gap:2px}',
    '#ct2 .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#ct2 .filter input,#ct2 .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#ct2 .filter input:focus,#ct2 .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#ct2 .filter-chk{flex-direction:row;align-items:center;gap:6px;height:32px;font-size:12px;color:var(--text-muted)}',
    '#ct2 .filter-chk input{height:auto;min-width:0}',
    // section title
    '#ct2 .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px;display:flex;align-items:center;gap:8px}',
    '#ct2 .sec-title .cnt{font-weight:600;color:var(--text-faint)}',
    // data table
    '#ct2 .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#ct2 .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);white-space:nowrap}',
    '#ct2 .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top}',
    '#ct2 .data-table tr:last-child td{border-bottom:0}',
    '#ct2 .data-table tr:hover td{background:#FAFBFC}',
    '#ct2 .table-wrap{overflow-x:auto}',
    '#ct2 .emp-cell{font-weight:600;color:var(--navy)}',
    '#ct2 .mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text-muted)}',
    '#ct2 .sub-line{font-size:10px;color:var(--text-faint);margin-top:2px}',
    // pills
    '#ct2 .pill{font-size:11px;font-weight:600;padding:2px 9px;border-radius:999px;display:inline-block}',
    '#ct2 .p-active{color:var(--teal-dark);background:#E6F7F5}',
    '#ct2 .p-near{color:#92400E;background:#FEF3C7}',
    '#ct2 .p-exp{color:#991B1B;background:#FEE2E2}',
    '#ct2 .p-other{color:#475569;background:#F1F5F9}',
    '#ct2 .badge-type{font-size:11px;font-weight:600;padding:2px 8px;border-radius:5px;background:#EEF2FF;color:#4338CA;display:inline-block}',
    '#ct2 .badge-um{font-size:9px;font-weight:700;padding:1px 6px;border-radius:4px;background:#FEF3C7;color:#92400E;display:inline-block;margin-left:4px}',
    // empty / loading / denied
    '#ct2 .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#ct2 .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#ct2 .empty-icon svg{width:24px;height:24px}',
    '#ct2 .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#ct2 .empty-sub{font-size:12px;color:var(--text-muted);max-width:420px;margin:0 auto}',
    '#ct2 .denied{text-align:center;padding:70px 24px;background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);border-radius:12px;color:#fff}',
    '#ct2 .denied-icon{width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;margin:0 auto 16px}',
    '#ct2 .denied-icon svg{width:30px;height:30px;color:#fff}',
    '#ct2 .denied-title{font-size:18px;font-weight:600;margin-bottom:6px}',
    '#ct2 .denied-sub{font-size:13px;color:#CBD5E1;max-width:420px;margin:0 auto;line-height:1.6}',
    '#ct2 .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    '@media (max-width:768px){#ct2 .stats{grid-template-columns:repeat(2,1fr)}}',
  ].join('\n');
}

/* ===== markup · คง element id เดิม (prefix ct2-) ===== */
function CT2_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>',
    '      สัญญาจ้าง',
    '    </h1>',
    '    <div class="subtitle" id="ct2-subtitle">สัญญาจ้าง + กฎสัญญา (Contracts) · ลับ เฉพาะผู้บริหาร/HQ</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-sm" onclick="ct2Reload()" id="ct2-refresh-btn"></button>',
    '  </div>',
    '</header>',
    // HQ confidential banner
    '<div class="ro-banner">',
    '  <svg class="ro-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    '  <span><strong>ลับ · เฉพาะผู้บริหาร/HQ:</strong> ข้อมูลสัญญาจ้าง · อ่านอย่างเดียว · ตัวเลขเงินเดือนถูกตัดออกแล้ว</span>',
    '</div>',
    '<div class="stats" id="ct2-stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ค้นหา</label>',
    '    <input type="search" id="ct2-filter-search" placeholder="ชื่อ / รหัส / เลขสัญญา" oninput="ct2Render()">',
    '  </div>',
    '  <div class="filter">',
    '    <label>สถานะ</label>',
    '    <select id="ct2-filter-status" onchange="ct2Render()"><option value="">ทุกสถานะ</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>ประเภท</label>',
    '    <select id="ct2-filter-type" onchange="ct2Render()"><option value="">ทุกประเภท</option></select>',
    '  </div>',
    '  <label class="filter filter-chk"><input type="checkbox" id="ct2-filter-near" onchange="ct2Render()"> เฉพาะใกล้ครบกำหนด</label>',
    '</div>',
    '<div id="ct2-content" class="loading">กำลังโหลด...</div>',
  ].join('\n');
}

/* ============================================================
   CT2_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function CT2_RUN_PAGE_JS() {
  var _ct2Root = document.getElementById('ct2');
  function $id(id) { return _ct2Root ? _ct2Root.querySelector('#' + id) : document.getElementById(id); }

  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function showToast(msg, type) {
    var t = document.getElementById('ct2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ct2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var ICON_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  var ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  var _ct2Data = null; // { contracts, rules, denied, error }

  // ---- format ----
  function fmtInt(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try { return n.toLocaleString('th-TH'); } catch (e) { return String(Math.round(n)); }
  }
  function dateLabel(d) { return d ? esc(d) : '—'; }

  function statusPill(c) {
    if (c.is_expired) return '<span class="pill p-exp">หมดอายุ</span>';
    if (c.is_near_expiry) {
      var dlbl = (c.near_days != null && c.near_days >= 0) ? ' ' + c.near_days + ' วัน' : '';
      return '<span class="pill p-near">ใกล้ครบ' + dlbl + '</span>';
    }
    if (c.status === 'active' || c.status === 'signed') return '<span class="pill p-active">' + esc(ct2StatusLabel(c.status)) + '</span>';
    if (!c.status) return '<span class="pill p-other">—</span>';
    return '<span class="pill p-other">' + esc(ct2StatusLabel(c.status)) + '</span>';
  }

  // ---- load ----
  function loadData() {
    $id('ct2-content').className = 'loading';
    $id('ct2-content').innerHTML = 'กำลังโหลด...';
    CT2_BACKEND.list().then(function (res) {
      _ct2Data = res || { contracts: [], rules: [], denied: false, error: null };
      if (_ct2Data.denied) {
        renderDenied();
        renderStats(null);
        return;
      }
      populateFilters();
      renderAll();
    }).catch(function (e) {
      console.error('[contracts] load failed', e);
      _ct2Data = { contracts: [], rules: [], denied: false, error: (e && e.message) || 'unknown' };
      $id('ct2-content').className = '';
      $id('ct2-content').innerHTML = '<div class="empty"><div class="empty-icon">' + ICON_FILE + '</div><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + esc(_ct2Data.error) + '</div></div>';
      renderStats(null);
    });
  }

  function renderDenied() {
    var c = $id('ct2-content');
    c.className = '';
    c.innerHTML = [
      '<div class="denied">',
      '  <div class="denied-icon">' + ICON_LOCK + '</div>',
      '  <div class="denied-title">หน้านี้เฉพาะผู้บริหาร/HQ</div>',
      '  <div class="denied-sub">ข้อมูลสัญญาจ้างเป็นความลับ เปิดให้เฉพาะระดับผู้บริหาร/สำนักงานใหญ่ (HQ) เท่านั้น · หากต้องการสิทธิ์เข้าถึง กรุณาติดต่อ HR/ผู้ดูแลระบบ</div>',
      '</div>',
    ].join('');
    var sub = $id('ct2-subtitle');
    if (sub) sub.textContent = 'สัญญาจ้าง (Contracts) · ลับ เฉพาะผู้บริหาร/HQ';
    var stats = $id('ct2-stats');
    if (stats) stats.innerHTML = '';
    // ซ่อน filters ตอน denied
    var fl = _ct2Root.querySelector('.filters');
    if (fl) fl.style.display = 'none';
  }

  function populateFilters() {
    var contracts = (_ct2Data && _ct2Data.contracts) || [];
    var sSel = $id('ct2-filter-status');
    var tSel = $id('ct2-filter-type');
    if (sSel && sSel.options.length <= 1) {
      var sSeen = {};
      contracts.forEach(function (c) {
        var s = c.status;
        if (s && !sSeen[s]) { sSeen[s] = true; var o = document.createElement('option'); o.value = s; o.textContent = ct2StatusLabel(s); sSel.appendChild(o); }
      });
    }
    if (tSel && tSel.options.length <= 1) {
      var tSeen = {};
      contracts.forEach(function (c) {
        var t = c.contract_type;
        if (t && !tSeen[t]) { tSeen[t] = true; var o = document.createElement('option'); o.value = t; o.textContent = ct2TypeLabel(t); tSel.appendChild(o); }
      });
    }
  }

  // ---- filtered ----
  function filteredContracts() {
    var rows = (_ct2Data && _ct2Data.contracts) ? _ct2Data.contracts.slice() : [];
    var q = ($id('ct2-filter-search') ? $id('ct2-filter-search').value : '').toLowerCase().trim();
    var st = $id('ct2-filter-status') ? $id('ct2-filter-status').value : '';
    var tp = $id('ct2-filter-type') ? $id('ct2-filter-type').value : '';
    var near = $id('ct2-filter-near') ? $id('ct2-filter-near').checked : false;
    if (st) rows = rows.filter(function (c) { return c.status === st; });
    if (tp) rows = rows.filter(function (c) { return c.contract_type === tp; });
    if (near) rows = rows.filter(function (c) { return c.is_near_expiry; });
    if (q) {
      rows = rows.filter(function (c) {
        return (c.employee_name || '').toLowerCase().indexOf(q) >= 0 ||
          (c.employee_id || '').toLowerCase().indexOf(q) >= 0 ||
          (c.id || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    // เรียง: ใกล้ครบ/หมดอายุก่อน, แล้ว end_date เร็วสุดก่อน
    rows.sort(function (a, b) {
      var ra = a.is_expired ? 0 : (a.is_near_expiry ? 1 : 2);
      var rb = b.is_expired ? 0 : (b.is_near_expiry ? 1 : 2);
      if (ra !== rb) return ra - rb;
      return String(a.end_date || '9999').localeCompare(String(b.end_date || '9999'));
    });
    return rows;
  }

  // ---- render ----
  function renderAll() {
    if (!_ct2Data || _ct2Data.denied) return;
    renderStats(_ct2Data);
    var content = $id('ct2-content');
    content.className = '';

    var hasAny = (_ct2Data.contracts || []).length || (_ct2Data.rules || []).length;
    if (!hasAny) {
      content.innerHTML = emptyState();
      return;
    }
    content.innerHTML = renderContractsSection() + renderRulesSection();
  }

  function renderStats(data) {
    var contracts = (data && data.contracts) || [];
    var rules = (data && data.rules) || [];
    var near = 0, expired = 0;
    contracts.forEach(function (c) { if (c.is_expired) expired++; else if (c.is_near_expiry) near++; });

    var cards = [
      statCard('total', 'สัญญาทั้งหมด', fmtInt(contracts.length), 'ฉบับ'),
      statCard('near', 'ใกล้ครบกำหนด', fmtInt(near), 'ภายใน ' + CT2_NEAR_DAYS + ' วัน'),
      statCard('expired', 'หมดอายุ', fmtInt(expired), 'ต้องดำเนินการ'),
      statCard('rules', 'กฎสัญญา', fmtInt(rules.length), 'ข้อ'),
    ];
    var statsEl = $id('ct2-stats');
    if (statsEl) statsEl.innerHTML = cards.join('');

    var sub = $id('ct2-subtitle');
    if (sub) sub.textContent = 'สัญญาจ้าง + กฎสัญญา (Contracts) · ลับ เฉพาะผู้บริหาร/HQ · ' + contracts.length + ' ฉบับ';
  }

  function statCard(cls, label, val, sub) {
    return [
      '<div class="stat-card ' + cls + '">',
      '  <div class="l">' + esc(label) + '</div>',
      '  <div class="v">' + val + '</div>',
      '  <div class="sub">' + esc(sub) + '</div>',
      '</div>',
    ].join('');
  }

  // ---- contracts table ----
  function renderContractsSection() {
    var rows = filteredContracts();
    var title = '<div class="sec-title">สัญญาจ้าง <span class="cnt">(' + rows.length + ' ฉบับ)</span></div>';
    if (!rows.length) {
      return title + '<div class="empty"><div class="empty-title">ไม่มีสัญญาตามตัวกรอง</div><div class="empty-sub">ลองล้างตัวกรอง/เปลี่ยนสถานะ</div></div>';
    }
    // เลือกคอลัมน์ตาม field ที่มีจริง (defensive)
    var hasBranch = rows.some(function (c) { return c.branch_id || c.position_id; });
    var hasStart = rows.some(function (c) { return c.start_date; });

    var th = ['<th>สัญญา</th>', '<th>พนักงาน</th>', '<th>ประเภท</th>'];
    if (hasStart) th.push('<th>เริ่ม</th>');
    th.push('<th>สิ้นสุด</th>', '<th>สถานะ</th>');
    if (hasBranch) th.push('<th>สาขา/ตำแหน่ง</th>');

    var body = rows.map(function (c) {
      var tds = [];
      tds.push('<td class="mono">' + (c.id ? esc(c.id) : '—') + (c.round_no !== '' ? '<div class="sub-line">รอบ ' + esc(c.round_no) + '</div>' : '') + '</td>');
      tds.push('<td class="emp-cell">' + esc(c.employee_name) +
        (c.party_type === 'contractor' ? ' <span class="pill p-other" style="font-size:9px">ผู้รับจ้าง</span>' : '') +
        (c.employee_id && c.employee_id !== c.employee_name ? '<div class="sub-line">' + esc(c.employee_id) + '</div>' : '') + '</td>');
      tds.push('<td>' + (c.contract_type ? '<span class="badge-type">' + esc(ct2TypeLabel(c.contract_type)) + '</span>' : '—') + '</td>');
      if (hasStart) tds.push('<td class="mono">' + dateLabel(c.start_date) + '</td>');
      tds.push('<td class="mono">' + (c.end_date ? esc(c.end_date) : (String(c.contract_type).toLowerCase() === 'indefinite' ? '(ไม่มีกำหนด)' : '—')) + '</td>');
      tds.push('<td>' + statusPill(c) + (c.has_file ? ' <span title="มีไฟล์เซ็นแล้ว" style="color:var(--teal-dark)">●</span>' : '') + '</td>');
      if (hasBranch) tds.push('<td class="mono">' + esc(c.branch_id || c.position_id || '—') + '</td>');
      return '<tr>' + tds.join('') + '</tr>';
    }).join('');

    return [
      title,
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>' + th.join('') + '</tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '</table>',
      '</div>',
    ].join('');
  }

  // ---- rules table ----
  function renderRulesSection() {
    var rules = (_ct2Data && _ct2Data.rules) || [];
    var title = '<div class="sec-title">กฎสัญญา <span class="cnt">(' + rules.length + ' ข้อ)</span></div>';
    if (!rules.length) {
      return title + '<div class="empty"><div class="empty-title">ยังไม่มีกฎสัญญา</div><div class="empty-sub">เมื่อระบบส่งกฎสัญญา (contract_rule.updated) เข้ามา จะแสดงที่นี่</div></div>';
    }
    var hasCat = rules.some(function (r) { return r.category || r.severity; });
    var th = ['<th>กฎ</th>', '<th>ชื่อ</th>'];
    if (hasCat) th.push('<th>หมวด</th>');
    th.push('<th>รายละเอียด</th>');

    var body = rules.map(function (r) {
      var tds = [];
      tds.push('<td class="mono">' + (r.id ? esc(r.id) : '—') + '</td>');
      tds.push('<td class="emp-cell">' + (r.is_umbrella ? '☂ ' : '') + esc(r.name) +
        (r.is_umbrella ? '<span class="badge-um">umbrella</span>' : '') + '</td>');
      if (hasCat) tds.push('<td>' + (r.category ? esc(r.category) : '—') + (r.severity ? '<div class="sub-line">' + esc(r.severity) + '</div>' : '') + '</td>');
      tds.push('<td>' + (r.description ? esc(r.description) : '<span class="mono">—</span>') + '</td>');
      return '<tr>' + tds.join('') + '</tr>';
    }).join('');

    return [
      title,
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
      '  <div class="empty-icon">' + ICON_FILE + '</div>',
      '  <div class="empty-title">ยังไม่มีข้อมูลสัญญาจ้าง</div>',
      '  <div class="empty-sub">เมื่อระบบ sync สัญญา (contract.updated) และกฎสัญญา (contract_rule.updated) เข้ามา ข้อมูลจะแสดงที่นี่</div>',
      '</div>',
    ].join('');
  }

  function ct2Reload() { loadData(); }
  function ct2Render() { if (_ct2Data && !_ct2Data.denied) renderAll(); }

  // init labels
  $id('ct2-refresh-btn').innerHTML = ICON_REFRESH + ' รีเฟรช';

  // expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix ct2* กันชน)
  window.ct2Reload = ct2Reload;
  window.ct2Render = ct2Render;

  // init
  loadData();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountContracts) */
if (typeof window !== 'undefined') {
  window.mountContracts = mountContracts;
  window.CT2_BACKEND = CT2_BACKEND;
}
