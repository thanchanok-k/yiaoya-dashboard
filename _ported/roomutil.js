// _ported/roomutil.js — Native read-only page "การใช้ห้อง & คอร์สค้าง" (Room Utilization)
// ผู้บริหารดู — คิวคอร์สค้าง (ครั้งคงเหลือ) · ความจุห้องใกล้เต็ม · แยกประเภทห้อง · แยกสาขา
//
// ทำตาม pattern เดียวกับ _ported/fosales.js:
//   - mountRoomutil render เข้า #wrap-roomutil · ใช้ global window.sb · CSS scope ใต้ #ru
//   - fn ที่ inline onclick ต้องเรียก → ผูก window (prefix ru*) กันชน
//
// backend (edge fn hr_list?type=...):
//   jera.room.updated             → ห้อง+เตียง (beds, category, bookable, branch_id)
//   jera.course_remaining.updated → คอร์สค้างรายคน (unused, unused_price, status)
//   jera.appointment.updated      → นัดล่วงหน้า (date, duration, branch_id, status)
//   ข้อมูลจริงมาจาก JERA ผ่าน publish_roomutil.py → ตอนยังว่าง = empty state สวย ไม่ error

/* ============================================================
   ค่าคงที่โมเดล capacity — แก้ได้ตรงนี้ (ยืนยันกับผู้บริหาร 25/06/2569)
   ============================================================ */
var RU_OPEN_HOURS = 9;      // ชม.เปิดรับ/วัน (11:00–20:00)
var RU_OPEN_DAYS  = 7;      // วันเปิด/สัปดาห์ (เปิดเสาร์-อาทิตย์)
var RU_SLOT_MIN   = 60;     // 1 slot = กี่นาที (ฐานการนับครั้ง)
var RU_RED        = 85;     // % ขึ้นไป = แดง (เต็ม)
var RU_YELLOW     = 70;     // % ขึ้นไป = เหลือง (ใกล้เต็ม)
var RU_PIPE_WEEKS = 8;      // สมมติคอร์สค้างทยอยใช้หมดใน N สัปดาห์ (ปรับได้บนหน้าจอ)

var RU_FN = 'hr_list';
var RU_LIMIT = 3000;

/* ============================================================
   RU_BACKEND — ดึง 3 type จาก hr_list, normalize, group ฝั่ง client
   ============================================================ */
function ruNum(v) { if (v == null || v === '') return 0; var n = Number(v); return isFinite(n) ? n : 0; }
function ruDate(v) { return v ? String(v).slice(0, 10) : ''; }

function ruFetchType(type) {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : null;
  if (!sb || !sb.functions) return Promise.resolve([]);
  var q = RU_FN + '?type=' + encodeURIComponent(type) + '&limit=' + RU_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    var data = (res && res.data) || {};
    return Array.isArray(data.items) ? data.items : [];
  }).catch(function (e) { console.warn('[roomutil] fetch ' + type + ' failed', e); return []; });
}

var RU_BACKEND = {
  load: function () {
    return Promise.all([
      ruFetchType('jera.room.updated'),
      ruFetchType('jera.course_remaining.updated'),
      ruFetchType('jera.appointment.updated'),
    ]).then(function (r) {
      var rooms = r[0].map(function (p) {
        return {
          uuid: p.room_uuid || p.entity_id, branch_id: p.branch_id || 'SLY',
          branch_name: p.branch_name || p.branch_id || '', name: p.name || '',
          room_type: p.room_type || '', category: p.category || 'อื่นๆ',
          beds: ruNum(p.beds) || 1, bookable: !!p.bookable,
        };
      });
      var courses = r[1].map(function (p) {
        return {
          uuid: p.course_uuid || p.entity_id, code: p.course_code || '',
          name: p.course_name || '', patient: p.patient_name || '',
          patient_code: p.patient_code || '', branch_name: p.branch_name || '',
          used: ruNum(p.used), unused: ruNum(p.unused),
          unused_price: ruNum(p.unused_price), status: p.status || '',
          buy_date: ruDate(p.buy_date), recent_used: ruDate(p.recent_used),
        };
      });
      var appts = r[2].map(function (p) {
        return {
          uuid: p.appt_uuid || p.entity_id, branch_id: p.branch_id || 'SLY',
          date: ruDate(p.date), duration: ruNum(p.duration) || RU_SLOT_MIN,
          staff: p.staff_name || '', type: p.type || '', status: p.status || '',
        };
      });
      // branch list (จาก rooms เป็นหลัก) — เผื่อขยายหลายสาขา
      var bSeen = {}, branches = [];
      rooms.forEach(function (x) {
        if (x.branch_id && !bSeen[x.branch_id]) {
          bSeen[x.branch_id] = true;
          branches.push({ id: x.branch_id, name: x.branch_name || x.branch_id });
        }
      });
      branches.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
      return { rooms: rooms, courses: courses, appts: appts, branches: branches };
    });
  },
};

/* ============================================================
   mount
   ============================================================ */
function mountRoomutil() {
  var wrap = document.getElementById('wrap-roomutil');
  if (!wrap) return;
  wrap.innerHTML = '<style>' + RU_CSS() + '</style><div id="ru">' + RU_MARKUP() + '</div>';
  RU_RUN();
}

function RU_CSS() {
  return [
    '#ru{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#ru *{box-sizing:border-box}',
    '#ru .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#ru .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ru .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#ru .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ru .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;align-items:end}',
    '#ru .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#ru .btn:hover{border-color:var(--navy)}',
    '#ru .btn svg{width:14px;height:14px}',
    '#ru .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#ru .ro-banner strong{font-weight:600}',
    '#ru .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#ru .filter{display:flex;flex-direction:column;gap:2px}',
    '#ru .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#ru .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:150px;font-family:inherit;background:#fff;color:var(--text)}',
    '#ru .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // stat cards
    '#ru .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:900px){#ru .stats{grid-template-columns:repeat(2,1fr)}}',
    '@media (max-width:560px){#ru .stats{grid-template-columns:1fr}}',
    '#ru .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#ru .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#ru .stat-card.queue::before{background:#7C3AED}',
    '#ru .stat-card.value::before{background:#166534}',
    '#ru .stat-card.util::before{background:#2BA89B}',
    '#ru .stat-card.cap::before{background:#1E40AF}',
    '#ru .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#ru .stat-card .v{font-size:22px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#ru .stat-card.queue .v{color:#6D28D9}',
    '#ru .stat-card.value .v{color:#166534}',
    '#ru .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // section
    '#ru .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px;display:flex;align-items:center;gap:6px}',
    // gauge / capacity panel
    '#ru .cap-panel{background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:6px}',
    '#ru .gauge-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}',
    '#ru .badge{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;padding:6px 12px;border-radius:20px}',
    '#ru .badge.g{background:#ECFDF5;color:#047857}',
    '#ru .badge.y{background:#FFFBEB;color:#B45309}',
    '#ru .badge.r{background:#FEF2F2;color:#B91C1C}',
    '#ru .bar{position:relative;height:22px;border-radius:11px;background:#EEF2F6;overflow:hidden;flex:1;min-width:200px}',
    '#ru .bar .fill{position:absolute;left:0;top:0;bottom:0;border-radius:11px;transition:width .4s}',
    '#ru .bar .fill.g{background:linear-gradient(90deg,#34D399,#059669)}',
    '#ru .bar .fill.y{background:linear-gradient(90deg,#FBBF24,#D97706)}',
    '#ru .bar .fill.r{background:linear-gradient(90deg,#F87171,#DC2626)}',
    '#ru .bar .pipe{position:absolute;top:0;bottom:0;background:repeating-linear-gradient(45deg,rgba(124,58,237,.35),rgba(124,58,237,.35) 5px,rgba(124,58,237,.18) 5px,rgba(124,58,237,.18) 10px)}',
    '#ru .bar .lbl{position:absolute;right:8px;top:0;bottom:0;display:flex;align-items:center;font-size:11px;font-weight:700;color:#0F172A}',
    '#ru .cap-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}',
    '@media (max-width:700px){#ru .cap-meta{grid-template-columns:repeat(2,1fr)}}',
    '#ru .cap-meta .m{background:#F8FAFC;border:1px solid var(--border);border-radius:8px;padding:9px 11px}',
    '#ru .cap-meta .m .k{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}',
    '#ru .cap-meta .m .x{font-size:16px;font-weight:600;color:var(--navy);margin-top:2px}',
    '#ru .note{font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.5}',
    '#ru .note code{background:#F1F5F9;padding:1px 5px;border-radius:4px;font-size:11px}',
    // tables
    '#ru .table-wrap{overflow-x:auto}',
    '#ru .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#ru .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#ru .data-table th.num,#ru .data-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '#ru .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#ru .data-table tr:last-child td{border-bottom:0}',
    '#ru .data-table tr:hover td{background:#FAFBFC}',
    '#ru .data-table tfoot td{font-weight:700;background:#F8FAFC;border-top:2px solid var(--border-strong);color:var(--navy)}',
    '#ru .pill{display:inline-block;font-size:10px;padding:1px 8px;border-radius:10px;font-weight:600}',
    '#ru .pill.g{background:#ECFDF5;color:#047857}',
    '#ru .pill.y{background:#FFFBEB;color:#B45309}',
    '#ru .pill.r{background:#FEF2F2;color:#B91C1C}',
    '#ru .dow{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}',
    '#ru .dow .cell{flex:1;min-width:80px;border:1px solid var(--border);border-radius:8px;padding:8px;text-align:center;background:#fff}',
    '#ru .dow .cell .d{font-size:11px;font-weight:700;color:var(--navy)}',
    '#ru .dow .cell .p{font-size:18px;font-weight:700;margin-top:2px}',
    '#ru .dow .cell .s{font-size:10px;color:var(--text-faint);margin-top:1px}',
    '#ru .dow .cell.g .p{color:#059669}#ru .dow .cell.y .p{color:#D97706}#ru .dow .cell.r .p{color:#DC2626}',
    '#ru .dow .cell.r{border-color:#FCA5A5;background:#FEF6F6}',
    '#ru .empty{text-align:center;padding:56px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#ru .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#ru .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#ru .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
  ].join('\n');
}

function RU_MARKUP() {
  return [
    '<header class="page-head">',
    '  <div>',
    '    <h1><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>การใช้ห้อง & คอร์สค้าง</h1>',
    '    <div class="subtitle" id="ru-subtitle">คิวคอร์สค้าง · ความจุห้องใกล้เต็ม · แยกประเภทห้อง (JERA)</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <div class="filter"><label>สาขา</label><select id="ru-branch" onchange="ruRender()"><option value="">ทุกสาขา</option></select></div>',
    '    <div class="filter"><label>นัด Recall (auto)</label><select id="ru-recall" onchange="ruRender()">',
    '      <option value="in">รวมในโหลด</option><option value="out">ตัดออก (เฉพาะนัดจริง)</option>',
    '    </select></div>',
    '    <div class="filter"><label>คอร์สค้างใช้หมดใน</label><select id="ru-pipe" onchange="ruRender()">',
    '      <option value="4">4 สัปดาห์</option><option value="8" selected>8 สัปดาห์</option><option value="12">12 สัปดาห์</option><option value="999">ไม่รวมในคาดการณ์</option>',
    '    </select></div>',
    '    <button class="btn" onclick="ruReload()" id="ru-refresh"></button>',
    '  </div>',
    '</header>',
    '<div class="ro-banner"><span style="width:8px;height:8px;border-radius:50%;background:#3DC5B7;display:inline-block"></span><span><strong>มุมมองผู้บริหาร:</strong> ลูกค้าซื้อคอร์สแล้วเหลือกี่ครั้ง (คิวค้าง) · ห้องพอรับไหม/ใกล้เต็มหรือยัง · อ่านอย่างเดียว</span></div>',
    '<div class="stats" id="ru-stats"></div>',
    '<div id="ru-content" class="loading">กำลังโหลด...</div>',
  ].join('\n');
}

function RU_RUN() {
  var root = document.getElementById('ru');
  function $id(id) { return root ? root.querySelector('#' + id) : document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function fmtInt(v) { var n = Number(v); if (!isFinite(n)) n = 0; try { return Math.round(n).toLocaleString('th-TH'); } catch (e) { return String(Math.round(n)); } }
  function fmtBaht(v) { var n = Number(v); if (!isFinite(n)) n = 0; return '฿' + Math.round(n).toLocaleString('th-TH'); }
  function fmtPct(v) { var n = Number(v); if (!isFinite(n)) n = 0; return (Math.round(n * 10) / 10) + '%'; }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var DOW_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  var DOW_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];

  var _d = null;

  function statusClass(pct) { return pct >= RU_RED ? 'r' : pct >= RU_YELLOW ? 'y' : 'g'; }
  function statusWord(pct) { return pct >= RU_RED ? 'เต็ม / เกินกำลัง' : pct >= RU_YELLOW ? 'ใกล้เต็ม' : 'รับได้สบาย'; }

  function load() {
    $id('ru-content').className = 'loading';
    $id('ru-content').innerHTML = 'กำลังโหลด...';
    RU_BACKEND.load().then(function (res) {
      _d = res;
      var bSel = $id('ru-branch');
      if (bSel && bSel.options.length <= 1) {
        (res.branches || []).forEach(function (b) {
          var o = document.createElement('option');
          o.value = b.id; o.textContent = b.id + (b.name && b.name !== b.id ? ' — ' + b.name : '');
          bSel.appendChild(o);
        });
      }
      render();
    }).catch(function (e) {
      console.error('[roomutil] load failed', e);
      $id('ru-content').className = '';
      $id('ru-content').innerHTML = '<div class="empty"><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + esc((e && e.message) || 'unknown') + '</div></div>';
    });
  }

  // คำนวณตัวเลขหลักของสาขาที่เลือก (หรือรวมทุกสาขา)
  function compute() {
    var bf = ($id('ru-branch') || {}).value || '';
    var pipeWeeks = Number(($id('ru-pipe') || {}).value || RU_PIPE_WEEKS);
    var recallMode = (($id('ru-recall') || {}).value) || 'in';
    var rooms = _d.rooms.filter(function (r) { return r.bookable && (!bf || r.branch_id === bf); });
    var courses = _d.courses.filter(function (c) { return (c.status || 'Active') !== 'Expired'; });
    var apptsAll = _d.appts.filter(function (a) { return !bf || a.branch_id === bf; });
    var isRecall = function (a) { return /recall/i.test(a.type || ''); };
    var recallCount = apptsAll.filter(isRecall).length;
    var normalCount = apptsAll.length - recallCount;
    // ตัดนัด Recall (auto) ออกจากการนับโหลดถ้าเลือก "ตัดออก"
    var appts = recallMode === 'out' ? apptsAll.filter(function (a) { return !isRecall(a); }) : apptsAll;

    // ความจุ (slot = RU_SLOT_MIN นาที)
    var beds = rooms.reduce(function (s, r) { return s + r.beds; }, 0);
    var slotsPerDay = beds * RU_OPEN_HOURS * (60 / RU_SLOT_MIN);
    var slotsPerWeek = slotsPerDay * RU_OPEN_DAYS;

    // โหลดนัดปัจจุบัน — ถ่วงตาม duration → "slot-เทียบเท่า"
    var dates = appts.map(function (a) { return a.date; }).filter(Boolean).sort();
    var spanDays = 1, windowWeeks = 1;
    if (dates.length) {
      var d0 = new Date(dates[0]), d1 = new Date(dates[dates.length - 1]);
      spanDays = Math.max(1, Math.round((d1 - d0) / 86400000) + 1);
      windowWeeks = Math.max(1, spanDays / 7);
    }
    var demandSlots = appts.reduce(function (s, a) { return s + (a.duration || RU_SLOT_MIN) / RU_SLOT_MIN; }, 0);
    var demandPerWeek = demandSlots / windowWeeks;
    var avgDur = appts.length ? (appts.reduce(function (s, a) { return s + (a.duration || RU_SLOT_MIN); }, 0) / appts.length) : RU_SLOT_MIN;

    // คอร์สค้าง
    var unused = courses.reduce(function (s, c) { return s + c.unused; }, 0);
    var unusedVal = courses.reduce(function (s, c) { return s + c.unused_price; }, 0);
    var pipePerWeek = (pipeWeeks >= 999) ? 0 : (unused * (avgDur / RU_SLOT_MIN)) / pipeWeeks;

    var utilCur = slotsPerWeek > 0 ? demandPerWeek / slotsPerWeek * 100 : 0;
    var utilProj = slotsPerWeek > 0 ? (demandPerWeek + pipePerWeek) / slotsPerWeek * 100 : 0;

    // โหลดต่อวันในสัปดาห์ (DOW)
    var dowSlots = [0, 0, 0, 0, 0, 0, 0], dowCount = [0, 0, 0, 0, 0, 0, 0];
    var dowSeen = [{}, {}, {}, {}, {}, {}, {}];
    appts.forEach(function (a) {
      if (!a.date) return;
      var dt = new Date(a.date); var w = dt.getDay();
      dowSlots[w] += (a.duration || RU_SLOT_MIN) / RU_SLOT_MIN;
      if (!dowSeen[w][a.date]) { dowSeen[w][a.date] = 1; dowCount[w]++; }
    });

    return {
      bf: bf, pipeWeeks: pipeWeeks, rooms: rooms, courses: courses, appts: appts,
      beds: beds, slotsPerDay: slotsPerDay, slotsPerWeek: slotsPerWeek,
      demandPerWeek: demandPerWeek, pipePerWeek: pipePerWeek, avgDur: avgDur,
      unused: unused, unusedVal: unusedVal, utilCur: utilCur, utilProj: utilProj,
      spanDays: spanDays, dowSlots: dowSlots, dowCount: dowCount,
      recallMode: recallMode, recallCount: recallCount, normalCount: normalCount, apptsAll: apptsAll.length,
    };
  }

  function render() {
    if (!_d) return;
    if (!_d.rooms.length && !_d.courses.length && !_d.appts.length) {
      $id('ru-stats').innerHTML = '';
      $id('ru-content').className = '';
      $id('ru-content').innerHTML = emptyState();
      return;
    }
    var c = compute();
    renderStats(c);
    $id('ru-content').className = '';
    $id('ru-content').innerHTML =
      renderCapacity(c) + renderDow(c) + renderRoomTypes(c) + renderCourses(c);
    var sub = $id('ru-subtitle');
    if (sub) sub.textContent = 'คอร์สค้าง ' + fmtInt(c.unused) + ' ครั้ง · ห้องจองได้ ' + c.beds + ' จุด · นัดล่วงหน้า ' + c.apptsAll + ' (นัดหมาย ' + c.normalCount + ' · Recall ' + c.recallCount + ')' + (c.recallMode === 'out' ? ' · ตัด Recall ออก' : '');
  }

  function statCard(cls, label, val, sub) {
    return '<div class="stat-card ' + cls + '"><div class="l">' + esc(label) + '</div><div class="v">' + val + '</div><div class="sub">' + esc(sub) + '</div></div>';
  }

  function renderStats(c) {
    var pcls = statusClass(c.utilProj);
    var pctTxt = '<span class="pill ' + pcls + '">' + statusWord(c.utilProj) + '</span>';
    $id('ru-stats').innerHTML = [
      statCard('queue', 'คิวคอร์สค้าง (ครั้งคงเหลือ)', fmtInt(c.unused) + ' ครั้ง', c.courses.length + ' คอร์ส · ' + uniquePatients(c) + ' ลูกค้า'),
      statCard('value', 'มูลค่าคอร์สค้าง (deferred)', fmtBaht(c.unusedVal), 'รายได้รับล่วงหน้า · รอส่งมอบ'),
      statCard('util', 'การใช้ห้อง (รวมคอร์สค้าง)', fmtPct(c.utilProj), 'ปัจจุบัน ' + fmtPct(c.utilCur) + ' → ' + statusWord(c.utilProj)),
      statCard('cap', 'กำลังรับ/สัปดาห์', fmtInt(c.slotsPerWeek) + ' ครั้ง', c.beds + ' จุด × ' + RU_OPEN_HOURS + ' ชม. × ' + RU_OPEN_DAYS + ' วัน'),
    ].join('');
  }

  function uniquePatients(c) {
    var s = {}; c.courses.forEach(function (x) { if (x.patient_code) s[x.patient_code] = 1; });
    return Object.keys(s).length;
  }

  function renderCapacity(c) {
    var curW = Math.min(100, c.utilCur);
    var projExtra = Math.min(100 - curW, Math.max(0, c.utilProj - c.utilCur));
    var fillCls = statusClass(c.utilProj);
    var badge = '<span class="badge ' + fillCls + '">' + (fillCls === 'r' ? '⚠ ' : fillCls === 'y' ? '◐ ' : '✓ ') + statusWord(c.utilProj) + ' · ' + fmtPct(c.utilProj) + '</span>';
    var pipeNote = c.pipeWeeks >= 999
      ? 'ไม่รวมคอร์สค้างในคาดการณ์'
      : 'รวมคอร์สค้าง ' + fmtInt(c.unused) + ' ครั้ง (สมมติทยอยใช้หมดใน ' + c.pipeWeeks + ' สัปดาห์ ≈ ' + fmtInt(c.pipePerWeek) + ' ครั้ง/สัปดาห์)';
    var recallTxt = c.recallMode === 'out'
      ? '<b style="color:#B45309">ตัดนัด Recall (auto) ' + c.recallCount + ' ออกแล้ว</b> — นับเฉพาะนัดหมายจริง ' + c.normalCount
      : 'รวมนัด Recall (auto) <b>' + c.recallCount + '</b> + นัดหมายจริง <b>' + c.normalCount + '</b> (กดสลับ “ตัดออก” ได้ที่หัวข้อด้านบน)';
    return [
      '<div class="sec-title">พื้นที่เพียงพอไหม / ใกล้เต็มหรือยัง</div>',
      '<div class="cap-panel">',
      '  <div class="gauge-row">', badge,
      '    <div class="bar">',
      '      <div class="fill ' + fillCls + '" style="width:' + curW + '%"></div>',
      '      <div class="pipe" style="left:' + curW + '%;width:' + projExtra + '%"></div>',
      '      <div class="lbl">ปัจจุบัน ' + fmtPct(c.utilCur) + ' · +คอร์สค้าง = ' + fmtPct(c.utilProj) + '</div>',
      '    </div>',
      '  </div>',
      '  <div class="cap-meta">',
      '    <div class="m"><div class="k">กำลังรับ/สัปดาห์</div><div class="x">' + fmtInt(c.slotsPerWeek) + ' ครั้ง</div></div>',
      '    <div class="m"><div class="k">นัดจริง/สัปดาห์</div><div class="x">' + fmtInt(c.demandPerWeek) + ' ครั้ง</div></div>',
      '    <div class="m"><div class="k">คอร์สค้าง/สัปดาห์ (คาด)</div><div class="x">' + fmtInt(c.pipePerWeek) + ' ครั้ง</div></div>',
      '    <div class="m"><div class="k">ที่ว่างเหลือ/สัปดาห์</div><div class="x">' + fmtInt(Math.max(0, c.slotsPerWeek - c.demandPerWeek - c.pipePerWeek)) + ' ครั้ง</div></div>',
      '  </div>',
      '  <div class="note" style="border-top:1px dashed var(--border);padding-top:9px;margin-top:11px">📋 ประเภทนัด: ' + recallTxt + '</div>',
      '  <div class="note">แถบทึบ = นัดที่ลงแล้ว · แถบลายม่วง = คอร์สค้างที่ยังไม่ลงนัด (' + esc(pipeNote) + ') · เกณฑ์: <code>≥' + RU_YELLOW + '%</code> ใกล้เต็ม · <code>≥' + RU_RED + '%</code> เต็ม · เฉลี่ยนัดละ ' + fmtInt(c.avgDur) + ' นาที</div>',
      '</div>',
    ].join('');
  }

  function renderDow(c) {
    var weeks = Math.max(1, c.spanDays / 7);
    var cells = [0, 1, 2, 3, 4, 5, 6].map(function (w) {
      var occ = c.dowCount[w] || (weeks); // จำนวนวันนั้นที่มีในหน้าต่าง
      var perDay = occ > 0 ? c.dowSlots[w] / occ : 0;
      var pct = c.slotsPerDay > 0 ? perDay / c.slotsPerDay * 100 : 0;
      var cls = statusClass(pct);
      return '<div class="cell ' + cls + '"><div class="d">' + DOW_FULL[w] + '</div><div class="p">' + fmtPct(pct) + '</div><div class="s">' + fmtInt(perDay) + '/' + fmtInt(c.slotsPerDay) + ' ครั้ง/วัน</div></div>';
    }).join('');
    return '<div class="sec-title">โหลดต่อวันในสัปดาห์ (เทียบความจุ/วัน)</div><div class="dow">' + cells + '</div>';
  }

  function renderRoomTypes(c) {
    var grp = {};
    c.rooms.forEach(function (r) {
      if (!grp[r.category]) grp[r.category] = { cat: r.category, rooms: 0, beds: 0 };
      grp[r.category].rooms++; grp[r.category].beds += r.beds;
    });
    var list = Object.keys(grp).map(function (k) { return grp[k]; });
    list.sort(function (a, b) { return b.beds - a.beds; });
    if (!list.length) return '';
    var totBeds = 0;
    var body = list.map(function (g) {
      totBeds += g.beds;
      var capDay = g.beds * RU_OPEN_HOURS * (60 / RU_SLOT_MIN);
      return '<tr><td>' + esc(g.cat) + '</td><td class="num">' + g.rooms + '</td><td class="num">' + g.beds + '</td><td class="num">' + fmtInt(capDay) + '</td><td class="num">' + fmtInt(capDay * RU_OPEN_DAYS) + '</td></tr>';
    }).join('');
    return [
      '<div class="sec-title">แยกตามประเภทห้อง</div>',
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>ประเภทห้อง</th><th class="num">ห้อง</th><th class="num">จุด/เตียง</th><th class="num">รับได้/วัน</th><th class="num">รับได้/สัปดาห์</th></tr></thead>',
      '<tbody>' + body + '</tbody>',
      '<tfoot><tr><td>รวม</td><td class="num">' + c.rooms.length + '</td><td class="num">' + totBeds + '</td><td class="num">' + fmtInt(c.slotsPerDay) + '</td><td class="num">' + fmtInt(c.slotsPerWeek) + '</td></tr></tfoot>',
      '</table></div>',
      '<div class="note">นัดใน JERA ยังไม่ระบุห้องรายนัด (room ว่าง) → โหลดจริงดูที่ภาพรวม/รายวันด้านบน · ตารางนี้คือ "กำลังรับสูงสุด" ต่อประเภท</div>',
    ].join('');
  }

  function renderCourses(c) {
    var list = c.courses.slice().sort(function (a, b) { return b.unused - a.unused; }).slice(0, 30);
    if (!list.length) return '';
    var body = list.map(function (x) {
      var total = x.used + x.unused;
      return '<tr><td>' + esc(x.patient || '—') + '<br><span style="font-size:10px;color:#94A3B8">' + esc(x.patient_code) + '</span></td>' +
        '<td>' + esc(x.name || '—') + '</td>' +
        '<td class="num">' + fmtInt(x.used) + ' / ' + fmtInt(total) + '</td>' +
        '<td class="num"><b>' + fmtInt(x.unused) + '</b></td>' +
        '<td class="num">' + fmtBaht(x.unused_price) + '</td>' +
        '<td>' + esc(x.recent_used || '—') + '</td></tr>';
    }).join('');
    return [
      '<div class="sec-title">คอร์สค้างมากสุด (Top ' + list.length + ' · เรียงตามครั้งคงเหลือ)</div>',
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>ลูกค้า</th><th>คอร์ส</th><th class="num">ใช้ไป / ทั้งหมด</th><th class="num">คงเหลือ</th><th class="num">มูลค่าค้าง</th><th>ใช้ล่าสุด</th></tr></thead>',
      '<tbody>' + body + '</tbody></table></div>',
    ].join('');
  }

  function emptyState() {
    return '<div class="empty"><div class="empty-title">ยังไม่มีข้อมูลห้อง/คอร์สจาก JERA</div><div class="empty-sub">เมื่อรัน publish_roomutil.py (jera.room.updated / jera.course_remaining.updated / jera.appointment.updated) ข้อมูลจะแสดงที่นี่</div></div>';
  }

  $id('ru-refresh').innerHTML = ICON_REFRESH + ' รีเฟรช';
  window.ruReload = load;
  window.ruRender = render;
  load();
}

if (typeof window !== 'undefined') {
  window.mountRoomutil = mountRoomutil;
  window.RU_BACKEND = RU_BACKEND;
}
