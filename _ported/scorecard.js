// _ported/scorecard.js — Native read-only page "สกอร์การ์ดหมอ (Doctor Scorecard)" สำหรับ Supabase dashboard
// ผู้บริหาร/HR ดู — คะแนน/เมตริกหมอ แยกตามรอบ (period) · อ่านอย่างเดียว (ไม่มี write)
//
// ทำตาม pattern เดียวกับ _ported/fosales.js + _ported/holiday.js:
//   - mountScorecard render เข้า #wrap-scorecard
//   - ใช้ global window.sb (index.html module scope) — ห้าม redeclare
//   - CSS scope ใต้ #sc · markup คง element id เดิม
//   - fn ที่ inline onclick ต้องใช้ → ผูกกับ window (prefix sc*) กันชน
//   - helper (esc/showToast) inline ใน scope
//
// backend (edge fn hr_list?type=scorecard.updated → {items}) :
//   READ  scList() → items แต่ละตัว = 1 สกอร์การ์ดหมอ
//         **ไม่รู้ field แน่นอน** → defensive:
//           - ระบุ "หมอ" จาก doctor_name | doctor | employee_name | employee_id | name
//           - ระบุ "รอบ" จาก period | month | cycle | date (YYYY-MM)
//           - เมตริกตัวเลข = field ตัวเลขอื่น ๆ ทั้งหมดใน payload (auto-detect) → คอลัมน์ตาราง
//         ข้อมูลจริงมาทีหลัง — ตอนนี้อาจว่าง → empty state สวย ไม่ error

/* ============================================================
   SC_BACKEND — ดึงข้อมูลจาก Supabase edge fn hr_list (type=scorecard.updated)
   คืน rows ที่ normalize แล้ว + รายชื่อ metric field ที่เจอจริง · กรอง/group ฝั่ง client
   ============================================================ */
var SC_FN = 'hr_list';
var SC_TYPE = 'scorecard.updated';
var SC_LIMIT = 2000;

function sc2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function sc2Num(v) {
  if (v == null || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}
function sc2Str(v) {
  if (v == null) return '';
  return String(v).trim();
}
// คืน 'YYYY-MM' จากค่าวันที่/รอบ ถ้าเป็นวันที่ ; ไม่ใช่วันที่ → คืนสตริงดิบ
function sc2Period(v) {
  if (v == null || v === '') return '';
  var s = String(v).trim();
  // already looks like YYYY-MM or YYYY-MM-DD
  var m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  var d = new Date(s);
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1);
  }
  return s; // เช่น "Q1 2026", "รอบที่ 1" → ใช้ตามดิบ
}

// field ที่ถือว่าเป็น "ตัวระบุ/meta" ไม่ใช่ metric ตัวเลขสำหรับโชว์ในคอลัมน์เมตริก
var SC_META_KEYS = {
  id: 1, scorecard_id: 1, entity_id: 1, doctor_id: 1, employee_id: 1,
  doctor_name: 1, doctor: 1, employee_name: 1, name: 1,
  period: 1, month: 1, cycle: 1, date: 1, quarter: 1, year: 1,
  branch_id: 1, branch: 1, branch_name: 1, dept: 1, department: 1,
  type: 1, event_type: 1, created_at: 1, updated_at: 1, ts: 1, timestamp: 1,
  _raw: 1, notes: 1, note: 1, remark: 1,
};

// label สวย ๆ ของ metric key ที่รู้จัก (ที่เหลือ humanize อัตโนมัติ)
var SC_METRIC_LABELS = {
  revenue: 'รายได้', revenue_total: 'รายได้', sales: 'ยอดขาย',
  cases: 'เคส', case_count: 'เคส', patients: 'คนไข้', visits: 'การเข้าตรวจ',
  satisfaction: 'ความพึงพอใจ', csat: 'CSAT', nps: 'NPS', rating: 'คะแนนรีวิว',
  rebook_rate: '% Rebook', rebook: 'Rebook', rebook_count: 'Rebook',
  score_total: 'คะแนนรวม', total_score: 'คะแนนรวม', score: 'คะแนน',
  kpi: 'KPI', kpi_score: 'KPI',
};
// metric ที่ควรแสดงเป็น % (ค่าระหว่าง 0-100 หรือชื่อบ่งว่าเป็น rate/pct)
function sc2IsPct(key) {
  var k = String(key).toLowerCase();
  return /(_rate|_pct|percent|ratio)$/.test(k) || k === 'rebook_rate' || k.indexOf('rate') >= 0;
}
// metric ที่เป็นเงิน
function sc2IsMoney(key) {
  var k = String(key).toLowerCase();
  return k === 'revenue' || k === 'revenue_total' || k === 'sales' || /revenue|baht|amount|income/.test(k);
}

function sc2Humanize(key) {
  var k = String(key);
  if (SC_METRIC_LABELS[k.toLowerCase()]) return SC_METRIC_LABELS[k.toLowerCase()];
  return k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

// map payload event ดิบ → row shape (defensive — เก็บ metrics ที่เป็นตัวเลขทั้งหมด)
function sc2MapRow(p) {
  p = p || {};
  var doctor = sc2Str(p.doctor_name || p.doctor || p.employee_name || p.name);
  var docId = sc2Str(p.doctor_id || p.employee_id || p.id);
  if (!doctor) doctor = docId || '—';
  var periodRaw = p.period || p.month || p.cycle || p.quarter || p.date;
  var period = sc2Period(periodRaw);

  // เก็บ metric ตัวเลขทุกตัวที่ไม่ใช่ meta
  var metrics = {};
  Object.keys(p).forEach(function (k) {
    if (SC_META_KEYS[k]) return;
    if (k.charAt(0) === '_') return;
    var n = sc2Num(p[k]);
    if (n != null) metrics[k] = n;
  });

  return {
    id: sc2Str(p.scorecard_id || p.id || p.entity_id),
    doctor: doctor,
    doctor_id: docId,
    period: period,
    period_label: sc2Str(periodRaw) || period,
    branch_id: sc2Str(p.branch_id || p.branch),
    metrics: metrics,
    _raw: p,
  };
}

// cache row ล่าสุด (backend ไม่มี endpoint แยก)
var _sc2Rows = [];

function sc2FetchRows() {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) {
    _sc2Rows = [];
    return Promise.resolve([]);
  }
  var q = SC_FN + '?type=' + encodeURIComponent(SC_TYPE) + '&limit=' + SC_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    var data = (res && res.data) || {};
    var items = sc2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var row = sc2MapRow(p);
      var key = row.id || (row.doctor + '|' + row.period);
      if (!key || seen[key]) return;
      seen[key] = true;
      if (!row.id) row.id = key;
      rows.push(row);
    });
    _sc2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[SC_BACKEND] list fetch failed', e);
    _sc2Rows = [];
    return [];
  });
}

var SC_BACKEND = {
  // list — { rows, periods, doctors, metricKeys } (ฝั่ง client กรองเอง)
  scList: function () {
    return sc2FetchRows().then(function (all) {
      var pSeen = {}, periods = [];
      var dSeen = {}, doctors = [];
      var mSeen = {}, metricKeys = [];
      all.forEach(function (r) {
        if (r.period && !pSeen[r.period]) { pSeen[r.period] = true; periods.push(r.period); }
        if (r.doctor && !dSeen[r.doctor]) { dSeen[r.doctor] = true; doctors.push(r.doctor); }
        Object.keys(r.metrics || {}).forEach(function (k) {
          if (!mSeen[k]) { mSeen[k] = true; metricKeys.push(k); }
        });
      });
      periods.sort(function (a, b) { return String(b).localeCompare(String(a)); }); // ใหม่→เก่า
      doctors.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });
      // จัดลำดับ metric: score_total/total ก่อน, แล้วเรียงตามที่เจอ
      metricKeys.sort(function (a, b) {
        var pr = function (k) {
          var kk = k.toLowerCase();
          if (kk === 'score_total' || kk === 'total_score' || kk === 'score') return 0;
          if (sc2IsMoney(kk)) return 1;
          return 2;
        };
        var d = pr(a) - pr(b);
        return d !== 0 ? d : a.localeCompare(b);
      });
      return { rows: all, periods: periods, doctors: doctors, metricKeys: metricKeys };
    });
  },
};

/* ============================================================
   mountScorecard — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountScorecard() {
  if (!document.getElementById('wrap-scorecard')) return;
  var wrap = document.getElementById('wrap-scorecard');
  wrap.innerHTML = '<style>' + SC_CSS() + '</style><div id="sc">' + SC_MARKUP() + '</div>';
  SC_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #sc (brand tokens เดียวกับหน้าอื่น) ===== */
function SC_CSS() {
  return [
    '#sc{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#sc *{box-sizing:border-box}',
    // page head
    '#sc .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#sc .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#sc .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#sc .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#sc .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // buttons
    '#sc .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#sc .btn:hover{border-color:var(--navy)}',
    '#sc .btn svg{width:14px;height:14px}',
    '#sc .btn-sm{padding:5px 10px;font-size:12px}',
    // read-only banner
    '#sc .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#sc .ro-banner strong{font-weight:600}',
    // stat cards
    '#sc .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#sc .stats{grid-template-columns:repeat(2,1fr)}}',
    '@media (max-width:600px){#sc .stats{grid-template-columns:repeat(2,1fr)}}',
    '#sc .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#sc .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#sc .stat-card.doc::before{background:#1E40AF}',
    '#sc .stat-card.period::before{background:#6D28D9}',
    '#sc .stat-card.rows::before{background:#4338CA}',
    '#sc .stat-card.score::before{background:#166534}',
    '#sc .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#sc .stat-card .v{font-size:22px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#sc .stat-card.score .v{color:#166534}',
    '#sc .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#sc .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#sc .filter{display:flex;flex-direction:column;gap:2px}',
    '#sc .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#sc .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#sc .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section title
    '#sc .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px}',
    // doctor summary cards
    '#sc .doc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px;margin-bottom:14px}',
    '#sc .doc-card{background:#fff;border:1px solid var(--border);border-left:3px solid var(--teal);border-radius:8px;padding:12px 14px}',
    '#sc .doc-card .dname{font-size:13px;font-weight:700;color:var(--navy)}',
    '#sc .doc-card .dscore{font-size:20px;font-weight:600;color:#166534;margin-top:4px;letter-spacing:-.02em}',
    '#sc .doc-card .dmeta{font-size:11px;color:var(--text-muted);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap}',
    // data table
    '#sc .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#sc .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);white-space:nowrap}',
    '#sc .data-table th.num,#sc .data-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '#sc .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#sc .data-table tr:last-child td{border-bottom:0}',
    '#sc .data-table tr:hover td{background:#FAFBFC}',
    '#sc .data-table tfoot td{font-weight:700;background:#F8FAFC;border-top:2px solid var(--border-strong);color:var(--navy)}',
    '#sc .doc-cell{font-weight:600;color:var(--navy)}',
    '#sc .period-mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text-muted)}',
    '#sc .score-cell{font-weight:600;color:#166534}',
    '#sc .table-wrap{overflow-x:auto}',
    // empty / loading
    '#sc .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#sc .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#sc .empty-icon svg{width:24px;height:24px}',
    '#sc .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#sc .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#sc .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    '@media (max-width:768px){#sc .stats{grid-template-columns:repeat(2,1fr)}}',
  ].join('\n');
}

/* ===== markup · คง element id เดิม ===== */
function SC_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    '      สกอร์การ์ดหมอ',
    '    </h1>',
    '    <div class="subtitle" id="sc-subtitle">คะแนน/เมตริกแพทย์ แยกตามรอบ (Doctor Scorecard)</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-sm" onclick="scReload()" id="sc-refresh-btn"></button>',
    '  </div>',
    '</header>',
    // read-only banner
    '<div class="ro-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#3DC5B7;display:inline-block"></span>',
    '  <span><strong>มุมมองผู้บริหาร/HR:</strong> คะแนนและเมตริกของแพทย์แต่ละท่านต่อรอบประเมิน · อ่านอย่างเดียว</span>',
    '</div>',
    '<div class="stats" id="sc-stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>รอบ (Period)</label>',
    '    <select id="sc-filter-period" onchange="scRender()"><option value="">ทุกรอบ</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>หมอ</label>',
    '    <select id="sc-filter-doctor" onchange="scRender()"><option value="">ทุกคน</option></select>',
    '  </div>',
    '</div>',
    '<div id="sc-content" class="loading">กำลังโหลด...</div>',
  ].join('\n');
}

/* ============================================================
   SC_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function SC_RUN_PAGE_JS() {
  var _scRoot = document.getElementById('sc');
  function $id(id) { return _scRoot ? _scRoot.querySelector('#' + id) : document.getElementById(id); }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function showToast(msg, type) {
    var t = document.getElementById('sc2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'sc2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var ICON_PULSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';

  var _scData = null; // { rows, periods, doctors, metricKeys }

  // ---- format helpers (กัน throw ถ้า null) ----
  function fmtNum(v) {
    var n = Number(v);
    if (!isFinite(n)) return '—';
    try {
      // ทศนิยมเฉพาะเมื่อจำเป็น (กันเลขจำนวนเต็มมีจุด)
      var hasFrac = Math.abs(n % 1) > 1e-9;
      return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: hasFrac ? 2 : 0 });
    } catch (e) { return String(n); }
  }
  function fmtMoney(v) {
    var n = Number(v);
    if (!isFinite(n)) return '—';
    try {
      return '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    } catch (e) { return '฿' + String(Math.round(n)); }
  }
  function fmtPct(v) {
    var n = Number(v);
    if (!isFinite(n)) return '—';
    // ถ้าเป็นสัดส่วน 0-1 → คูณ 100
    if (n > 0 && n <= 1) n = n * 100;
    return (Math.round(n * 10) / 10) + '%';
  }
  function fmtInt(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try { return n.toLocaleString('th-TH'); } catch (e) { return String(Math.round(n)); }
  }
  // format ค่า metric ตามชนิดของ key
  function fmtMetric(key, v) {
    if (v == null) return '—';
    if (sc2IsMoney(key)) return fmtMoney(v);
    if (sc2IsPct(key)) return fmtPct(v);
    return fmtNum(v);
  }

  function periodLabel(pk) {
    if (!pk) return '—';
    var s = String(pk);
    var parts = s.split('-');
    if (parts.length >= 2 && /^\d{4}$/.test(parts[0]) && /^\d{2}$/.test(parts[1])) {
      var names = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      var mi = parseInt(parts[1], 10);
      var yr = parseInt(parts[0], 10) + 543; // พ.ศ.
      return (names[mi] || parts[1]) + ' ' + yr;
    }
    return s; // เช่น "Q1 2026" ใช้ตามดิบ
  }

  // หา key ของ "คะแนนรวม" (ถ้ามี) เพื่อใช้สรุป/เรียง
  function scoreKey() {
    var keys = (_scData && _scData.metricKeys) || [];
    var pref = ['score_total', 'total_score', 'score', 'kpi_score', 'kpi'];
    for (var i = 0; i < pref.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        if (keys[j].toLowerCase() === pref[i]) return keys[j];
      }
    }
    return null;
  }

  // ---- load ----
  function loadData() {
    $id('sc-content').className = 'loading';
    $id('sc-content').innerHTML = 'กำลังโหลด...';
    SC_BACKEND.scList().then(function (res) {
      _scData = res || { rows: [], periods: [], doctors: [], metricKeys: [] };
      populateFilters();
      renderAll();
    }).catch(function (e) {
      console.error('[scorecard] load failed', e);
      _scData = { rows: [], periods: [], doctors: [], metricKeys: [] };
      $id('sc-content').className = '';
      $id('sc-content').innerHTML = '<div class="empty"><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml((e && e.message) || 'unknown') + '</div></div>';
      renderStats([]);
    });
  }

  function populateFilters() {
    var pSel = $id('sc-filter-period');
    if (pSel && pSel.options.length <= 1) {
      (_scData.periods || []).forEach(function (p) {
        var o = document.createElement('option');
        o.value = p; o.textContent = periodLabel(p);
        pSel.appendChild(o);
      });
    }
    var dSel = $id('sc-filter-doctor');
    if (dSel && dSel.options.length <= 1) {
      (_scData.doctors || []).forEach(function (d) {
        var o = document.createElement('option');
        o.value = d; o.textContent = d;
        dSel.appendChild(o);
      });
    }
  }

  // ---- filtered rows ----
  function filteredRows() {
    var rows = (_scData && _scData.rows) ? _scData.rows.slice() : [];
    var pSel = $id('sc-filter-period');
    var dSel = $id('sc-filter-doctor');
    var p = pSel ? pSel.value : '';
    var d = dSel ? dSel.value : '';
    if (p) rows = rows.filter(function (r) { return r.period === p; });
    if (d) rows = rows.filter(function (r) { return r.doctor === d; });
    // เรียง: รอบล่าสุดก่อน, แล้วชื่อหมอ
    rows.sort(function (a, b) {
      var pc = String(b.period || '').localeCompare(String(a.period || ''));
      if (pc !== 0) return pc;
      return String(a.doctor || '').localeCompare(String(b.doctor || ''), 'th');
    });
    return rows;
  }

  // ---- render ----
  function renderAll() {
    var all = (_scData && _scData.rows) ? _scData.rows : [];
    renderStats(all);

    var content = $id('sc-content');
    content.className = '';

    if (!all.length) {
      content.innerHTML = emptyState();
      return;
    }

    var rows = filteredRows();
    if (!rows.length) {
      content.innerHTML = '<div class="empty"><div class="empty-title">ไม่มีข้อมูลตามตัวกรอง</div><div class="empty-sub">ลองเปลี่ยนรอบ/หมอ</div></div>';
      return;
    }
    content.innerHTML = renderDoctorSummary(rows) + renderTable(rows);
  }

  function renderStats(all) {
    all = all || [];
    var dSeen = {}, pSeen = {};
    var sk = scoreKey();
    var scoreSum = 0, scoreCnt = 0;
    all.forEach(function (r) {
      if (r.doctor) dSeen[r.doctor] = true;
      if (r.period) pSeen[r.period] = true;
      if (sk && r.metrics && r.metrics[sk] != null) { scoreSum += Number(r.metrics[sk]) || 0; scoreCnt++; }
    });
    var docN = Object.keys(dSeen).length;
    var perN = Object.keys(pSeen).length;
    var avgScore = scoreCnt > 0 ? (scoreSum / scoreCnt) : null;

    var cards = [
      statCard('rows', 'สกอร์การ์ดทั้งหมด', fmtInt(all.length), perN + ' รอบ'),
      statCard('doc', 'จำนวนหมอ', fmtInt(docN), 'มีคะแนน'),
      statCard('period', 'รอบประเมิน', fmtInt(perN), perN ? 'รอบล่าสุด ' + periodLabel((_scData.periods || [])[0]) : '—'),
    ];
    if (sk && avgScore != null) {
      cards.push(statCard('score', 'คะแนนเฉลี่ย (' + sc2Humanize(sk) + ')', fmtMetric(sk, avgScore), 'จาก ' + scoreCnt + ' รายการ'));
    } else {
      cards.push(statCard('score', 'เมตริกที่ติดตาม', fmtInt((_scData.metricKeys || []).length), 'คอลัมน์'));
    }

    $id('sc-stats').innerHTML = cards.join('');

    var sub = $id('sc-subtitle');
    if (sub) sub.textContent = 'คะแนน/เมตริกแพทย์ แยกตามรอบ (Doctor Scorecard) · ' + all.length + ' รายการ';
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

  function renderDoctorSummary(rows) {
    var sk = scoreKey();
    if (!sk) return ''; // ไม่มี metric คะแนนรวม → ข้ามการ์ดสรุป
    var grouped = {};
    rows.forEach(function (r) {
      var d = r.doctor || '—';
      if (!grouped[d]) grouped[d] = { name: d, sum: 0, cnt: 0, periods: {} };
      var v = r.metrics && r.metrics[sk] != null ? Number(r.metrics[sk]) : null;
      if (v != null && isFinite(v)) { grouped[d].sum += v; grouped[d].cnt++; }
      if (r.period) grouped[d].periods[r.period] = true;
    });
    var list = Object.keys(grouped).map(function (k) {
      var g = grouped[k];
      g.avg = g.cnt > 0 ? g.sum / g.cnt : null;
      g.periodN = Object.keys(g.periods).length;
      return g;
    }).filter(function (g) { return g.avg != null; });
    list.sort(function (a, b) { return (b.avg || 0) - (a.avg || 0); });
    if (!list.length) return '';
    var cards = list.map(function (g) {
      return [
        '<div class="doc-card">',
        '  <div class="dname">' + escapeHtml(g.name) + '</div>',
        '  <div class="dscore">' + fmtMetric(sk, g.avg) + '</div>',
        '  <div class="dmeta">',
        '    <span>' + sc2Humanize(sk) + ' เฉลี่ย</span>',
        '    <span>' + g.periodN + ' รอบ</span>',
        '  </div>',
        '</div>',
      ].join('');
    }).join('');
    return '<div class="sec-title">สรุปต่อหมอ · เรียงคะแนนสูงสุด</div><div class="doc-grid">' + cards + '</div>';
  }

  function renderTable(rows) {
    var metricKeys = (_scData && _scData.metricKeys) || [];
    // header
    var th = ['<th>หมอ</th>', '<th>รอบ</th>'];
    metricKeys.forEach(function (k) {
      th.push('<th class="num">' + escapeHtml(sc2Humanize(k)) + '</th>');
    });

    var sk = scoreKey();
    var sums = {}; // metric → {sum,cnt}
    var body = rows.map(function (r) {
      var tds = [
        '<td class="doc-cell">' + escapeHtml(r.doctor || '—') + (r.doctor_id && r.doctor_id !== r.doctor ? ' <span class="period-mono">' + escapeHtml(r.doctor_id) + '</span>' : '') + '</td>',
        '<td><span class="period-mono">' + escapeHtml(r.period_label || r.period || '—') + '</span></td>',
      ];
      metricKeys.forEach(function (k) {
        var v = r.metrics ? r.metrics[k] : null;
        if (v != null && isFinite(Number(v))) {
          if (!sums[k]) sums[k] = { sum: 0, cnt: 0 };
          sums[k].sum += Number(v); sums[k].cnt++;
        }
        var cls = (k === sk) ? 'num score-cell' : 'num';
        tds.push('<td class="' + cls + '">' + fmtMetric(k, v) + '</td>');
      });
      return '<tr>' + tds.join('') + '</tr>';
    }).join('');

    // footer: รวม (เงิน/นับ = sum, %/score = avg)
    var tf = ['<td colspan="2">รวม / เฉลี่ย</td>'];
    metricKeys.forEach(function (k) {
      var agg = sums[k];
      if (!agg || !agg.cnt) { tf.push('<td class="num">—</td>'); return; }
      var val;
      if (sc2IsPct(k) || k === sk) {
        val = fmtMetric(k, agg.sum / agg.cnt); // เฉลี่ย
      } else {
        val = fmtMetric(k, agg.sum); // ผลรวม
      }
      tf.push('<td class="num">' + val + '</td>');
    });

    return [
      '<div class="sec-title">รายการสกอร์การ์ด · เรียงรอบล่าสุดก่อน (' + rows.length + ' รายการ)</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>' + th.join('') + '</tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '  <tfoot><tr>' + tf.join('') + '</tr></tfoot>',
      '</table>',
      '</div>',
    ].join('');
  }

  function emptyState() {
    return [
      '<div class="empty">',
      '  <div class="empty-icon">' + ICON_PULSE + '</div>',
      '  <div class="empty-title">ยังไม่มีข้อมูลสกอร์การ์ดหมอ</div>',
      '  <div class="empty-sub">เมื่อระบบส่งคะแนน/เมตริกแพทย์เข้ามา (scorecard.updated) ข้อมูลจะแสดงที่นี่</div>',
      '</div>',
    ].join('');
  }

  function scReload() { loadData(); }
  function scRender() { renderAll(); }

  // init labels
  $id('sc-refresh-btn').innerHTML = ICON_REFRESH + ' รีเฟรช';

  // expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix sc* กันชน)
  window.scReload = scReload;
  window.scRender = scRender;

  // init
  loadData();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountScorecard) */
if (typeof window !== 'undefined') {
  window.mountScorecard = mountScorecard;
  window.SC_BACKEND = SC_BACKEND;
}
