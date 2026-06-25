// _ported/hiring.js — Native read-only page "สัญญาณการจ้างงาน" (Hiring Signal) ฝั่ง HR
// ตอบ: ต้องจ้างตำแหน่งไหนเพิ่มไหม — ขับด้วยข้อมูลคอขวดจริง (JERA provider load + คอร์สค้าง) + headcount แผนก
//
// pattern เดียวกับ _ported/roomutil.js · ใช้ window.sb · scope #hire · fn prefix hire*
// backend (hr_list?type=):
//   jera.provider_load.updated      → โหลดจริงต่อเทรนเนอร์ 30 วัน (sessions_per_week, hours)
//   jera.course_remaining.updated   → คอร์สค้าง (ดีมานด์อนาคต)
//   employee.updated                → headcount แยกแผนก (context)

var HIRE_TARGET = 26;     // นัด/สัปดาห์ ต่อเทรนเนอร์ 1 คน (full load) — ตรงกับ roomutil
var HIRE_PIPE_WEEKS = 8;  // คอร์สค้างทยอยใช้หมดใน N สัปดาห์
var HIRE_RED = 85, HIRE_YELLOW = 70;
var HIRE_LIMIT = 3000;

function hireNum(v) { if (v == null || v === '') return 0; var n = Number(v); return isFinite(n) ? n : 0; }
function hireFetch(type) {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : null;
  if (!sb || !sb.functions) return Promise.resolve([]);
  return sb.functions.invoke('hr_list?type=' + encodeURIComponent(type) + '&limit=' + HIRE_LIMIT)
    .then(function (res) { var d = (res && res.data) || {}; return Array.isArray(d.items) ? d.items : []; })
    .catch(function (e) { console.warn('[hiring] fetch ' + type + ' failed', e); return []; });
}

var HIRE_BACKEND = {
  load: function () {
    return Promise.all([
      hireFetch('jera.provider_load.updated'),
      hireFetch('jera.course_remaining.updated'),
      hireFetch('employee.updated'),
    ]).then(function (r) {
      var providers = r[0].map(function (p) {
        return { name: p.staff_name || '-', sessions_week: hireNum(p.sessions_per_week), hours_week: hireNum(p.hours_per_week), sessions_30d: hireNum(p.sessions_30d) };
      }).filter(function (x) { return x.name !== '-' && x.sessions_30d > 0; });
      var unused = r[1].reduce(function (s, c) { return s + hireNum(c.unused); }, 0);
      var emps = r[2].map(function (e) {
        return { dept: e.department_th || e.department || e.position || 'ไม่ระบุ', status: e.status || 'active', name: e.full_name || '' };
      }).filter(function (e) { return (e.status || 'active') !== 'inactive' && (e.status || '') !== 'resigned'; });
      return { providers: providers, unused: unused, emps: emps };
    });
  },
};

function mountHiring() {
  var wrap = document.getElementById('wrap-hiring');
  if (!wrap) return;
  wrap.innerHTML = '<style>' + HIRE_CSS() + '</style><div id="hire">' + HIRE_MARKUP() + '</div>';
  HIRE_RUN();
}

function HIRE_CSS() {
  return [
    '#hire{--navy:#0D2F4F;--teal:#3DC5B7;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;color:var(--text);font-size:13px;line-height:1.5}',
    '#hire *{box-sizing:border-box}',
    '#hire .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#hire .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#hire .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#hire .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#hire .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px}',
    '#hire .btn:hover{border-color:var(--navy)}#hire .btn svg{width:14px;height:14px}',
    '#hire .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#hire .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px}',
    // recommendation cards
    '#hire .rec-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}',
    '#hire .rec{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;border-left:4px solid var(--teal)}',
    '#hire .rec.urgent{border-left-color:#DC2626}#hire .rec.consider{border-left-color:#D97706}#hire .rec.ok{border-left-color:#059669}',
    '#hire .rec .role{font-size:15px;font-weight:700;color:var(--navy)}',
    '#hire .rec .verdict{font-size:22px;font-weight:700;margin:6px 0;letter-spacing:-.01em}',
    '#hire .rec.urgent .verdict{color:#DC2626}#hire .rec.consider .verdict{color:#D97706}#hire .rec.ok .verdict{color:#059669}',
    '#hire .rec .why{font-size:12px;color:var(--text-muted);line-height:1.5}',
    '#hire .rec .pri{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-top:8px}',
    '#hire .rec.urgent .pri{background:#FEF2F2;color:#B91C1C}#hire .rec.consider .pri{background:#FFFBEB;color:#B45309}#hire .rec.ok .pri{background:#ECFDF5;color:#047857}',
    // tables
    '#hire .table-wrap{overflow-x:auto}',
    '#hire .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#hire .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#hire .data-table th.num,#hire .data-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '#hire .data-table td{padding:9px 12px;border-bottom:1px solid var(--border)}',
    '#hire .data-table tr:last-child td{border-bottom:0}#hire .data-table tr:hover td{background:#FAFBFC}',
    '#hire .data-table tfoot td{font-weight:700;background:#F8FAFC;border-top:2px solid var(--border-strong);color:var(--navy)}',
    '#hire .pill{display:inline-block;font-size:10px;padding:1px 8px;border-radius:10px;font-weight:600}',
    '#hire .pill.r{background:#FEF2F2;color:#B91C1C}#hire .pill.y{background:#FFFBEB;color:#B45309}#hire .pill.g{background:#ECFDF5;color:#047857}',
    '#hire .note{font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.5}',
    '#hire .empty{text-align:center;padding:56px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#hire .loading{text-align:center;padding:50px;color:var(--text-muted)}',
  ].join('\n');
}

function HIRE_MARKUP() {
  return [
    '<header class="page-head"><div>',
    '  <h1><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>สัญญาณการจ้างงาน</h1>',
    '  <div class="subtitle" id="hire-subtitle">ต้องจ้างตำแหน่งไหนเพิ่ม — จากคอขวดจริง (โหลดเทรนเนอร์ + คอร์สค้าง)</div>',
    '</div><div><button class="btn" onclick="hireReload()" id="hire-refresh"></button></div></header>',
    '<div class="ro-banner"><span style="width:8px;height:8px;border-radius:50%;background:#3DC5B7;display:inline-block"></span><span><strong>มุมมอง HR:</strong> สัญญาณว่าควรเพิ่มคนตำแหน่งไหน · อิงโหลดงานจริง 30 วัน · อ่านอย่างเดียว</span></div>',
    '<div id="hire-content" class="loading">กำลังโหลด...</div>',
  ].join('\n');
}

function HIRE_RUN() {
  var root = document.getElementById('hire');
  function $id(id) { return root ? root.querySelector('#' + id) : document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function fmtInt(v) { var n = Number(v); if (!isFinite(n)) n = 0; return Math.round(n).toLocaleString('th-TH'); }
  function fmtPct(v) { var n = Number(v); if (!isFinite(n)) n = 0; return (Math.round(n * 10) / 10) + '%'; }
  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var _d = null;

  function load() {
    $id('hire-content').className = 'loading'; $id('hire-content').innerHTML = 'กำลังโหลด...';
    HIRE_BACKEND.load().then(function (res) { _d = res; render(); })
      .catch(function (e) { $id('hire-content').className = ''; $id('hire-content').innerHTML = '<div class="empty"><div style="font-weight:600">โหลดไม่สำเร็จ</div><div style="color:#64748B;font-size:12px">' + esc((e && e.message) || 'unknown') + '</div></div>'; });
  }

  function analyzePT() {
    var ps = (_d.providers || []).slice().sort(function (a, b) { return b.sessions_week - a.sessions_week; });
    var n = ps.length;
    var load = ps.reduce(function (s, p) { return s + p.sessions_week; }, 0);
    var cap = n * HIRE_TARGET;
    var util = cap > 0 ? load / cap * 100 : 0;
    var spare = ps.reduce(function (s, p) { return s + Math.max(0, HIRE_TARGET - p.sessions_week); }, 0);
    var fullCount = ps.filter(function (p) { return p.sessions_week / HIRE_TARGET * 100 >= HIRE_RED; }).length;
    var top3 = ps.slice(0, 3).reduce(function (s, p) { return s + p.sessions_week; }, 0);
    var top3Share = load > 0 ? top3 / load * 100 : 0;
    var pipe = (_d.unused || 0) / HIRE_PIPE_WEEKS; // นัด/สัปดาห์ ที่คอร์สค้างต้องการ
    // logic แนะนำจ้าง
    var hire = 0, pri = 'ok', reason = '';
    var gap = (load + pipe) - cap; // ถ้าโหลดรวมคอร์สค้างเกิน capacity → ต้องจ้าง
    if (gap > 0) { hire = Math.ceil(gap / HIRE_TARGET); pri = 'urgent'; reason = 'โหลดจริง + คอร์สค้าง (' + fmtInt(load + pipe) + '/สัปดาห์) เกินกำลังคนปัจจุบัน (' + fmtInt(cap) + ') → ขาด ' + fmtInt(gap) + ' นัด/สัปดาห์'; }
    else if (top3Share >= 50 && fullCount >= 1) { hire = 1; pri = 'consider'; reason = 'กำลังรวมยังพอ แต่กระจุกหนัก — ' + fmtInt(top3) + '/' + fmtInt(load) + ' นัด (' + fmtPct(top3Share) + ') อยู่ที่ 3 คนแรก และ ' + fullCount + ' คนเต็มแล้ว เสี่ยงพังถ้าลาออก'; }
    else { reason = 'กำลังคนปัจจุบันรับไหว (ใช้ ' + fmtPct(util) + ') และคอร์สค้างกระจายโหลดได้'; }
    return { n: n, load: load, cap: cap, util: util, spare: spare, fullCount: fullCount, top3Share: top3Share, pipe: pipe, hire: hire, pri: pri, reason: reason, providers: ps };
  }

  function render() {
    if (!_d) return;
    if (!_d.providers || !_d.providers.length) {
      $id('hire-content').className = '';
      $id('hire-content').innerHTML = '<div class="empty"><div style="font-weight:600">ยังไม่มีข้อมูลโหลดบุคลากร</div><div style="color:#64748B;font-size:12px">จะแสดงเมื่อ publish_roomutil.py รันรอบถัดไป (jera.provider_load.updated)</div></div>';
      return;
    }
    var pt = analyzePT();
    $id('hire-content').className = '';
    $id('hire-content').innerHTML = renderRecs(pt) + renderPTtable(pt) + renderDept();
    var sub = $id('hire-subtitle');
    if (sub) sub.textContent = 'เทรนเนอร์ ' + pt.n + ' คน · ใช้กำลัง ' + fmtPct(pt.util) + ' · คอร์สค้างรอ ' + fmtInt(pt.pipe) + ' นัด/สัปดาห์';
  }

  function recCard(cls, role, verdict, why, priLabel) {
    return '<div class="rec ' + cls + '"><div class="role">' + esc(role) + '</div><div class="verdict">' + verdict + '</div><div class="why">' + why + '</div><span class="pri">' + esc(priLabel) + '</span></div>';
  }

  function renderRecs(pt) {
    var priLabel = pt.pri === 'urgent' ? 'เร่งด่วน' : pt.pri === 'consider' ? 'ควรพิจารณา' : 'ยังไม่จำเป็น';
    var verdict = pt.hire > 0 ? '+' + pt.hire + ' คน' : 'ยังไม่ต้องจ้าง';
    var ptCard = recCard(pt.pri, 'เทรนเนอร์ / นักกายภาพ (PT)', verdict, pt.reason, priLabel);
    // FO/Reception — ไม่มีสัญญาณดีมานด์ตรง ๆ บอกตามตรง
    var foCard = recCard('ok', 'หน้าร้าน / Reception · บัญชี', 'ไม่มีสัญญาณ', 'ยังไม่มีตัวชี้วัดโหลดงานต่อคนของฝ่ายนี้ในระบบ — เพิ่มได้ถ้าต่อข้อมูลคิว/ใบงานหน้าร้าน', 'ข้อมูลไม่พอ');
    return '<div class="sec-title">คำแนะนำการจ้าง</div><div class="rec-grid">' + ptCard + foCard + '</div>' +
      '<div class="note">โมเดล: เทรนเนอร์ 1 คนรับไหว ' + HIRE_TARGET + ' นัด/สัปดาห์ · คอร์สค้างเฉลี่ยใช้หมดใน ' + HIRE_PIPE_WEEKS + ' สัปดาห์ · เกณฑ์เต็ม ≥' + HIRE_RED + '%</div>';
  }

  function renderPTtable(pt) {
    var rows = pt.providers.map(function (p) {
      var u = HIRE_TARGET > 0 ? p.sessions_week / HIRE_TARGET * 100 : 0;
      var st = u >= HIRE_RED ? '<span class="pill r">เต็ม</span>' : u >= HIRE_YELLOW ? '<span class="pill y">หนัก</span>' : '<span class="pill g">ว่าง</span>';
      return '<tr><td>' + esc(p.name.replace(/^\[|\].*$/g, '').slice(0, 24) || p.name) + '</td><td class="num"><b>' + fmtInt(p.sessions_week) + '</b></td><td class="num">' + fmtInt(p.hours_week) + '</td><td class="num">' + fmtPct(u) + '</td><td class="num">' + fmtInt(Math.max(0, HIRE_TARGET - p.sessions_week)) + '</td><td>' + st + '</td></tr>';
    }).join('');
    return '<div class="sec-title">กำลังคนคลินิก (โหลดจริง 30 วัน)</div><div class="table-wrap"><table class="data-table"><thead><tr><th>เทรนเนอร์</th><th class="num">นัด/สัปดาห์</th><th class="num">ชม./สัปดาห์</th><th class="num">% เต็ม</th><th class="num">ว่าง</th><th>สถานะ</th></tr></thead><tbody>' + rows +
      '</tbody><tfoot><tr><td>รวม ' + pt.n + ' คน</td><td class="num">' + fmtInt(pt.load) + '</td><td class="num">—</td><td class="num">' + fmtPct(pt.util) + '</td><td class="num">' + fmtInt(pt.spare) + '</td><td>—</td></tr></tfoot></table></div>';
  }

  function renderDept() {
    var emps = _d.emps || [];
    if (!emps.length) return '<div class="sec-title">กำลังคนแยกแผนก</div><div class="note">ยังไม่มีข้อมูลพนักงานจากระบบ (employee.updated)</div>';
    var grp = {};
    emps.forEach(function (e) { grp[e.dept] = (grp[e.dept] || 0) + 1; });
    var list = Object.keys(grp).map(function (k) { return { dept: k, n: grp[k] }; }).sort(function (a, b) { return b.n - a.n; });
    var rows = list.map(function (g) { return '<tr><td>' + esc(g.dept) + '</td><td class="num">' + g.n + '</td></tr>'; }).join('');
    return '<div class="sec-title">กำลังคนแยกแผนก (ทั้งบริษัท · context)</div><div class="table-wrap"><table class="data-table"><thead><tr><th>แผนก/ตำแหน่ง</th><th class="num">คน</th></tr></thead><tbody>' + rows + '</tbody><tfoot><tr><td>รวม</td><td class="num">' + emps.length + '</td></tr></tfoot></table></div>';
  }

  $id('hire-refresh').innerHTML = ICON_REFRESH + ' รีเฟรช';
  window.hireReload = load;
  load();
}

if (typeof window !== 'undefined') {
  window.mountHiring = mountHiring;
  window.HIRE_BACKEND = HIRE_BACKEND;
}
