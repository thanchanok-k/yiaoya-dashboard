// _ported/birthday.js — FULL native port of desktop birthday_manager.html (HR Announcement admin · หน้า "วันเกิดพนักงาน")
// ลอกทั้งดุ้น: stats(5) + cake-config card + month nav + year strip(12 เดือน) + bday cards grid
//   + cake workflow stepper (ordered→received→celebrated) + badges + notes modal + help
//   CSS เดิม (_shared_styles ที่ใช้ + <style> manager) prefix #bd ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ BD_RUN_PAGE_JS() · google.script.run = shim → BD_BACKEND (Supabase)
//
// ใช้ global window.sb (index.html module scope) — ห้าม redeclare · helper (esc/$/ICONS/showToast/showHelp) inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน BD_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=birthday.updated → {items}) :
//   list   → derive cards/stats/year-overview client-side จาก payload ล่าสุดต่อ employee/tracker
//            (list อาจว่าง → derive จาก employee.updated ที่มี birthdate ก็ได้ · render ได้ ไม่ error · empty state สวย)
//   mutations (markOrdered/markReceived/markCelebrated/addManualEntry/updateEntry/
//     runCheckUpcoming/forceOrderCakes) → เขียนกลับ/ส่ง email ไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   BD_BACKEND — map google.script.run → Supabase edge fn hr_list
   primary: type=birthday.updated · fallback: derive จาก employee.updated (มี birthdate)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     birthdayAdminList(opts)  → { items, stats, cake_settings, branches }
     mutations                → { ok / error / skipped } stub + toast
   ============================================================ */
var BD_FN = 'hr_list';
var BD_TYPE = 'birthday.updated';
var BD_EMP_TYPE = 'employee.updated';

function bd2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function bd2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function bd2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

// parse birthdate → {day, month} (รองรับ YYYY-MM-DD / DD/MM / ISO)
function bd2ParseBirthdate(v) {
  if (!v) return null;
  var s = String(v).trim();
  // ISO / YYYY-MM-DD
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { month: bd2Num(m[2]), day: bd2Num(m[3]) };
  // DD/MM/YYYY หรือ DD/MM
  m = s.match(/^(\d{1,2})\/(\d{1,2})/);
  if (m) return { day: bd2Num(m[1]), month: bd2Num(m[2]) };
  var d = new Date(s);
  if (!isNaN(d.getTime())) return { month: d.getMonth() + 1, day: d.getDate() };
  return null;
}

var BD_CAKE_STATUSES = ['pending', 'ordered', 'received', 'celebrated', 'needs_manual_order', 'missed'];

// map payload event ดิบ → bday card row shape ที่ JS เดิมใช้
function bd2MapItem(p) {
  p = p || {};
  var bdInfo = bd2ParseBirthdate(p.birthdate || p.birthday || p.dob || p.birth_date);
  var status = String(p.cake_status || p.status || 'pending').toLowerCase();
  if (BD_CAKE_STATUSES.indexOf(status) < 0) status = 'pending';
  var lineId = p.line_user_id || p.line_uid || '';
  var lineLinked = lineId ? true : bd2Bool(p.line_linked);
  var hasTracker = !!(p.bday_id || p.tracker_id || p.cake_status);
  var tracker = null;
  if (hasTracker) {
    tracker = {
      bday_id: p.bday_id || p.tracker_id || p.entity_id || p.id || '',
      accounting_notified: bd2Bool(p.accounting_notified),
      team_notified: bd2Bool(p.team_notified),
      card_status: p.card_status || '',
      notes: p.notes || p.bday_notes || '',
    };
  }
  return {
    employee_id: p.employee_id || p.entity_id || p.id || '',
    name: p.name || p.full_name || p.employee_name || '—',
    nickname: p.nickname || p.nick_name || '',
    branch_id: p.branch_id || '',
    branch_name: p.branch_name || p.branch || '—',
    birthday_day: bdInfo ? bdInfo.day : 0,
    birthday_month: bdInfo ? bdInfo.month : 0,
    days_until: 0, // คำนวณตอน list ตามเดือน/ปีที่เลือก
    cake_status: status,
    cake_type: p.cake_type || '',
    cake_note: p.cake_note || '',
    line_linked: lineLinked,
    line_user_id: lineId,
    tracker: tracker,
    _raw: p,
  };
}

// cache payload ดิบล่าสุด
var _bd2Items = [];

function bd2FetchItems() {
  var inv = function (type) {
    return window.sb.functions.invoke(BD_FN + '?type=' + encodeURIComponent(type)).then(function (res) {
      var data = (res && res.data) || {};
      return bd2ToArr(data.items);
    }).catch(function (e) {
      console.warn('[BD_BACKEND] fetch failed (' + type + ')', e);
      return [];
    });
  };
  return inv(BD_TYPE).then(function (items) {
    if (items && items.length) return items;
    // fallback — derive จาก employee.updated ที่มี birthdate
    return inv(BD_EMP_TYPE).then(function (emps) {
      return bd2ToArr(emps).filter(function (e) {
        return bd2ParseBirthdate(e.birthdate || e.birthday || e.dob || e.birth_date);
      });
    });
  }).then(function (items) {
    var seen = {}; var rows = [];
    bd2ToArr(items).forEach(function (p) {
      var id = p.employee_id || p.bday_id || p.entity_id || p.id || '';
      if (id && seen[id]) return;
      if (id) seen[id] = true;
      var row = bd2MapItem(p);
      if (!row.birthday_month) return; // ไม่มีวันเกิด → ข้าม
      rows.push(row);
    });
    _bd2Items = rows;
    return rows;
  });
}

// คำนวณ days_until สำหรับเดือน/ปี ที่เลือก
function bd2DaysUntil(row, year, month) {
  if (!row.birthday_day || !row.birthday_month) return 0;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var target = new Date(year, month - 1, row.birthday_day);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

var BD_BACKEND = {
  // list — { items, stats, cake_settings, branches }
  birthdayAdminList: function (opts) {
    opts = opts || {};
    var year = bd2Num(opts.year) || new Date().getFullYear();
    var month = bd2Num(opts.month) || (new Date().getMonth() + 1);
    return bd2FetchItems().then(function (all) {
      // year overview — distribution ต่อเดือน (ทุกคน)
      var monthDist = {};
      for (var i = 1; i <= 12; i++) monthDist[i] = 0;
      all.forEach(function (r) { if (r.birthday_month >= 1 && r.birthday_month <= 12) monthDist[r.birthday_month]++; });

      // filter เดือน + สาขา
      var filtered = all.filter(function (r) { return r.birthday_month === month; });
      if (opts.branch) filtered = filtered.filter(function (r) { return r.branch_id === opts.branch; });

      filtered.forEach(function (r) { r.days_until = bd2DaysUntil(r, year, month); });
      filtered.sort(function (a, b) { return (a.birthday_day || 0) - (b.birthday_day || 0); });

      // stats
      var inMonth = all.filter(function (r) { return r.birthday_month === month; });
      var stats = {
        year_total: all.length,
        this_month: inMonth.length,
        ordered: all.filter(function (r) { return ['ordered', 'received', 'celebrated'].indexOf(r.cake_status) >= 0; }).length,
        received: all.filter(function (r) { return ['received', 'celebrated'].indexOf(r.cake_status) >= 0; }).length,
        needs_manual: all.filter(function (r) { return r.cake_status === 'needs_manual_order'; }).length,
        month_distribution: monthDist,
      };

      // branches จาก items (backend ไม่มี master list บน dashboard)
      var bSeen = {}, branches = [];
      all.forEach(function (r) {
        if (r.branch_id && !bSeen[r.branch_id]) { bSeen[r.branch_id] = true; branches.push({ id: r.branch_id, name: r.branch_name || r.branch_id }); }
      });

      // cake_settings — backend ไม่มี settings บน dashboard → ว่าง (จะโชว์ warn card)
      var cake_settings = { vendor_email: '', default_type: '' };

      return { items: filtered, stats: stats, cake_settings: cake_settings, branches: branches };
    });
  },

  // ---- mutations: เขียนกลับ/ส่ง email ไม่ได้บน dashboard → stub + toast ----
  birthdayAdminMarkOrdered: function () {
    bd2NotReady('Mark ordered');
    return Promise.resolve({ error: 'Mark ordered ยังไม่พร้อมบน dashboard (read-only)' });
  },
  birthdayAdminMarkReceived: function () {
    bd2NotReady('Mark received');
    return Promise.resolve({ error: 'Mark received ยังไม่พร้อมบน dashboard (read-only)' });
  },
  birthdayAdminMarkCelebrated: function () {
    bd2NotReady('Mark celebrated');
    return Promise.resolve({ error: 'Mark celebrated ยังไม่พร้อมบน dashboard (read-only)' });
  },
  birthdayAdminAddManualEntry: function () {
    bd2NotReady('เพิ่ม tracker');
    return Promise.resolve({ error: 'เพิ่ม tracker ยังไม่พร้อมบน dashboard (read-only)' });
  },
  birthdayAdminUpdateEntry: function () {
    bd2NotReady('บันทึก notes / cake type');
    return Promise.resolve({ error: 'บันทึกยังไม่พร้อมบน dashboard (read-only)' });
  },
  birthdayAdminRunCheckUpcoming: function () {
    bd2NotReady('Sync upcoming birthdays');
    return Promise.resolve({ error: 'Sync upcoming ยังไม่พร้อมบน dashboard (read-only)' });
  },
  birthdayAdminForceOrderCakes: function () {
    bd2NotReady('สั่งเค้ก (ส่ง email vendor)');
    return Promise.resolve({ error: 'สั่งเค้ก/ส่ง email ยังไม่พร้อมบน dashboard' });
  },
};

var _bd2NotReadyShown = {};
function bd2NotReady(feature) {
  if (_bd2NotReadyShown[feature]) return;
  _bd2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.bd2Toast) window.bd2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountBirthday — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountBirthday() {
  if (!document.getElementById('wrap-birthday')) return;
  var wrap = document.getElementById('wrap-birthday');
  wrap.innerHTML = '<style>' + BD_CSS() + '</style><div id="bd">' + BD_MARKUP() + '</div>';
  BD_RUN_PAGE_JS();
}
if (typeof window !== 'undefined') window.mountBirthday = mountBirthday;

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #bd =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว) */
function BD_CSS() {
  return [
    // tokens (มาจาก _shared_styles)
    '#bd{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;--info:#1D4ED8;--info-bg:#EFF6FF;--success-bg:#ECFDF5;--warning-bg:#FFFBEB;--danger-bg:#FEF2F2;color:var(--text);font-size:13px;line-height:1.5}',
    '#bd *{box-sizing:border-box}',
    // buttons (จาก _shared_styles)
    '#bd .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#bd .btn:hover{border-color:var(--navy)}',
    '#bd .btn svg{width:14px;height:14px}',
    '#bd .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#bd .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#bd .btn-success{background:var(--success);color:#fff;border-color:var(--success)}',
    '#bd .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#bd .btn-sm{padding:5px 10px;font-size:12px}',
    '#bd .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:8px;background:#fff;color:var(--text-muted);cursor:pointer}',
    '#bd .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#bd .btn-help svg{width:14px;height:14px}',
    // page head (native บน dashboard)
    '#bd .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#bd .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#bd .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#bd .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#bd .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;align-items:center}',
    // stats (5 cols)
    '#bd .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#bd .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#bd .stats{grid-template-columns:repeat(2,1fr)}}',
    '#bd .stat{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#bd .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#bd .stat-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#bd .stat-value{font-size:22px;font-weight:600;line-height:1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#bd .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#bd .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:flex-end}',
    '#bd .filter{display:flex;flex-direction:column;gap:2px}',
    '#bd .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#bd .filter input,#bd .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:140px;font-family:inherit;background:#fff;color:var(--text)}',
    '#bd .filter input:focus,#bd .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section
    '#bd .section{background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-top:14px}',
    '#bd .section-header{display:flex;align-items:flex-start;gap:10px;margin-bottom:14px}',
    '#bd .section-icon{width:32px;height:32px;border-radius:8px;background:#F0FDFA;color:var(--teal-dark);display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '#bd .section-icon svg{width:16px;height:16px}',
    '#bd .section-title{font-size:14px;font-weight:600;color:var(--text)}',
    '#bd .section-sub{font-size:11px;color:var(--text-muted);margin-top:2px}',
    '#bd .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    '#bd .empty{text-align:center;padding:40px 20px;color:var(--text-muted)}',
    '#bd .empty-icon{width:40px;height:40px;margin:0 auto 12px;color:var(--text-faint)}',
    '#bd .empty-icon svg{width:40px;height:40px}',
    '#bd .empty-title{font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px}',
    '#bd .empty-sub{font-size:12px;color:var(--text-muted)}',
    // ===== manager page <style> (prefix #bd) =====
    // Month navigator
    '#bd .month-nav{display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:4px}',
    '#bd .month-nav-btn{width:30px;height:30px;border:0;background:transparent;border-radius:6px;cursor:pointer;color:var(--text-muted);display:flex;align-items:center;justify-content:center}',
    '#bd .month-nav-btn:hover{background:#F1F5F9;color:var(--text)}',
    '#bd .month-nav-btn svg{width:14px;height:14px}',
    '#bd .month-display{flex:1;text-align:center;font-size:13px;font-weight:600;color:var(--text);padding:0 12px;min-width:140px}',
    // Year strip
    '#bd .year-strip{display:grid;grid-template-columns:repeat(12,1fr);gap:4px;margin:14px 0;background:var(--surface);border:1px solid var(--border);padding:6px;border-radius:8px}',
    '#bd .month-cell{padding:8px 4px;border-radius:6px;cursor:pointer;text-align:center;transition:all .15s;border:1px solid transparent}',
    '#bd .month-cell:hover{background:#F8FAFC}',
    '#bd .month-cell.selected{background:var(--navy);color:#fff;border-color:var(--navy)}',
    '#bd .month-cell.selected .mc-count{background:rgba(255,255,255,.2);color:#fff}',
    '#bd .month-cell.is-current{border-color:var(--teal)}',
    '#bd .mc-name{font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}',
    '#bd .month-cell.selected .mc-name,#bd .month-cell:hover .mc-name{color:inherit}',
    '#bd .mc-count{font-size:16px;font-weight:600;color:var(--text);margin-top:4px;display:inline-block;min-width:26px;padding:1px 6px;border-radius:10px;background:#F1F5F9}',
    '#bd .month-cell.selected .mc-count{color:#fff}',
    '#bd .month-cell.zero .mc-count{background:transparent;color:var(--text-faint);font-weight:400}',
    // Cake config card
    '#bd .config-card{background:var(--info-bg);border-left:3px solid var(--info);border-radius:6px;padding:10px 14px;margin-bottom:14px;display:flex;gap:14px;align-items:center;font-size:12px;color:var(--text)}',
    '#bd .config-card svg{width:18px;height:18px;color:var(--info);flex-shrink:0}',
    '#bd .config-card strong{font-weight:600}',
    '#bd .config-card code{background:var(--surface);padding:1px 6px;border-radius:3px;font-size:11px}',
    '#bd .config-card.warn{background:var(--warning-bg);border-color:var(--warning)}',
    '#bd .config-card.warn svg{color:var(--warning)}',
    // Birthday cards grid
    '#bd .bday-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}',
    '#bd .bday-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;transition:all .15s;position:relative;overflow:hidden}',
    '#bd .bday-card:hover{border-color:var(--navy-2)}',
    '#bd .bday-card.is-today{border-color:var(--teal);border-width:2px;padding:13px}',
    '#bd .bday-card.is-soon{border-left:3px solid var(--warning)}',
    '#bd .bday-card.is-past{opacity:.65}',
    '#bd .bday-head{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px}',
    '#bd .bday-avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--navy) 0%,var(--navy-2) 100%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0}',
    '#bd .bday-info{flex:1;min-width:0}',
    '#bd .bday-name{font-size:14px;font-weight:600;color:var(--text)}',
    '#bd .bday-meta{font-size:11px;color:var(--text-muted);margin-top:2px}',
    '#bd .bday-date{text-align:right;flex-shrink:0}',
    '#bd .bday-day{font-size:22px;font-weight:600;color:var(--text);line-height:1}',
    '#bd .bday-mon{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}',
    '#bd .bday-until{display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:600;margin-top:4px}',
    '#bd .bday-until.today{background:var(--success-bg);color:var(--success)}',
    '#bd .bday-until.soon{background:var(--warning-bg);color:var(--warning)}',
    '#bd .bday-until.future{background:#F1F5F9;color:var(--text-muted)}',
    '#bd .bday-until.past{background:var(--text-faint);color:#fff}',
    // Cake info row
    '#bd .cake-row{display:flex;gap:8px;align-items:center;padding:8px 10px;background:#FAFBFC;border-radius:6px;margin-bottom:10px;font-size:12px}',
    '#bd .cake-icon{width:26px;height:26px;border-radius:50%;background:#FCE7F3;color:#BE185D;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '#bd .cake-icon svg{width:14px;height:14px}',
    '#bd .cake-type{font-weight:500;color:var(--text);text-transform:capitalize}',
    '#bd .cake-note{display:block;font-size:10px;color:var(--text-muted);margin-top:1px}',
    // Workflow stepper
    '#bd .stepper{display:flex;align-items:center;gap:4px;margin-top:10px;margin-bottom:10px}',
    '#bd .step{flex:1;padding:4px;border-radius:4px;text-align:center;font-size:10px;font-weight:500;background:#F1F5F9;color:var(--text-faint);transition:all .15s;position:relative}',
    '#bd .step.done{background:var(--success-bg);color:var(--success)}',
    '#bd .step.active{background:var(--info-bg);color:var(--info);border:1px solid var(--info)}',
    '#bd .step.warn{background:var(--warning-bg);color:var(--warning)}',
    '#bd .step-arrow{width:10px;flex-shrink:0;color:var(--text-faint);display:flex;align-items:center;justify-content:center}',
    '#bd .step-arrow svg{width:10px;height:10px}',
    // Action buttons
    '#bd .bday-actions{display:flex;gap:6px;flex-wrap:wrap}',
    '#bd .bday-actions button{flex:1;padding:6px 8px;font-size:11px;min-width:80px}',
    // LINE indicator
    '#bd .line-tag{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:8px;background:#DCFCE7;color:#15803D;font-size:9px;font-weight:600}',
    '#bd .line-tag.unlinked{background:#F1F5F9;color:var(--text-faint)}',
    // notification badges + notes
    '#bd .badge-row{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}',
    '#bd .nbadge{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:8px;font-size:10px;font-weight:500;background:var(--info-bg);color:var(--info)}',
    '#bd .nbadge.acc{background:#FEF3C7;color:#B45309}',
    '#bd .nbadge.team{background:#E0E7FF;color:#4338CA}',
    '#bd .nbadge.card{background:#DCFCE7;color:#15803D}',
    '#bd .nbadge svg{width:10px;height:10px}',
    '#bd .notes-block{background:#FAFBFC;border-left:2px solid var(--text-faint);padding:6px 10px;margin-top:8px;font-size:11px;color:var(--text-muted);line-height:1.5;border-radius:0 4px 4px 0;display:flex;gap:6px;align-items:flex-start}',
    '#bd .notes-block svg{width:11px;height:11px;color:var(--text-faint);flex-shrink:0;margin-top:2px}',
    '#bd .notes-edit-btn{background:transparent;border:0;color:var(--text-faint);cursor:pointer;padding:0;font-size:10px;margin-left:auto}',
    '#bd .notes-edit-btn:hover{color:var(--info)}',
  ].join('\n') + BD_CSS2();
}

/* CSS part 2 — modal / field */
function BD_CSS2() {
  return '\n' + [
    '#bd .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#bd .modal-bg.active{display:flex}',
    '#bd .modal{background:#fff;border-radius:12px;max-width:720px;width:92%;max-height:92vh;overflow-y:auto}',
    '#bd .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#bd .modal-header h2{font-size:16px;margin:0}',
    '#bd .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#bd .modal-body{padding:16px 20px}',
    '#bd .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
    '#bd .field{margin-bottom:12px}',
    '#bd .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#bd .field input,#bd .field select,#bd .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#bd .field input:focus,#bd .field select:focus,#bd .field textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + stats + cake-config + filters + year-strip + section + notes modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell/topbar ออก */
function BD_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-8H4v8M1 21h22M6 13V8a4 4 0 014-4h4a4 4 0 014 4v5M9 8V5a3 3 0 016 0v3"/></svg>',
    '      Birthday Tracker',
    '    </h1>',
    '    <div class="subtitle">วันเกิดพนักงาน + cake workflow · auto-flex อวยพร · opt-out ได้</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn" data-tip="คู่มือการใช้หน้านี้"></button>',
    '    <button class="btn btn-sm" onclick="loadList()" id="refresh-btn"></button>',
    '    <button class="btn btn-sm" onclick="forceCheck()">Sync upcoming</button>',
    '    <button class="btn btn-primary" onclick="forceOrder()" id="order-btn"></button>',
    '  </div>',
    '</header>',
    '<div class="stats" id="stats"></div>',
    '<div id="cake-config"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>เดือน</label>',
    '    <div class="month-nav">',
    '      <button class="month-nav-btn" onclick="navMonth(-1)" id="prev-btn"></button>',
    '      <div class="month-display" id="month-display">—</div>',
    '      <button class="month-nav-btn" onclick="navMonth(1)" id="next-btn"></button>',
    '    </div>',
    '  </div>',
    '  <div class="filter">',
    '    <label>ปี</label>',
    '    <input type="number" id="filter-year" min="2024" max="2030" onchange="loadList()">',
    '  </div>',
    '  <div class="filter">',
    '    <label>สาขา</label>',
    '    <select id="filter-branch" onchange="loadList()"><option value="">ทุกสาขา</option></select>',
    '  </div>',
    '</div>',
    // year strip
    '<div class="year-strip" id="year-strip"></div>',
    // section
    '<div class="section">',
    '  <div class="section-header">',
    '    <div class="section-icon" id="section-icon"></div>',
    '    <div style="flex:1">',
    '      <div class="section-title" id="section-title">วันเกิดเดือนนี้</div>',
    '      <div class="section-sub">คลิกขั้นตอน workflow เพื่อ mark cake ordered → received → celebrated</div>',
    '    </div>',
    '  </div>',
    '  <div id="content" class="loading">กำลังโหลด...</div>',
    '</div>',
    // Notes edit modal
    '<div class="modal-bg" id="notes-modal-bg" onclick="if(event.target===this)closeNotesModal()">',
    '  <div class="modal" style="max-width:480px">',
    '    <div class="modal-header"><h2>หมายเหตุ</h2><p id="notes-modal-sub">—</p></div>',
    '    <div class="modal-body">',
    '      <input type="hidden" id="notes-bday-id">',
    '      <div class="field"><label>Cake type</label>',
    '        <input type="text" id="notes-cake-type" list="cake-type-list" placeholder="chocolate / vanilla / fruit / halal / vegan">',
    '        <datalist id="cake-type-list">',
    '          <option value="chocolate"></option><option value="vanilla"></option><option value="fruit"></option>',
    '          <option value="halal"></option><option value="vegan"></option><option value="gluten-free"></option>',
    '        </datalist>',
    '      </div>',
    '      <div class="field"><label>Notes (สำหรับ HR + การ์ดงานนี้)</label>',
    '        <textarea id="notes-text" rows="4" placeholder="ความสนใจ ของขวัญ ข้อจำกัดอาหาร ฯลฯ"></textarea>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeNotesModal()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveNotes()" id="notes-save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   BD_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → BD_BACKEND
   helper (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function BD_RUN_PAGE_JS() {

  // ---- google.script.run shim → BD_BACKEND (async, คืน shape เดิม) ----
  function _bd2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (BD_BACKEND[prop]) {
            Promise.resolve().then(function () { return BD_BACKEND[prop].apply(BD_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[BD_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[BD_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _bd2MakeChain(); } });

  // ---- helpers (inline · prefix bd ใน id เพื่อกันชน) ----
  const ICONS = {
    cake: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('bd2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'bd2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.bd2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('bd-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'bd-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'bd-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'bd-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม birthday_manager.html (ลอกทั้งดุ้น) =====
     ใช้ scope ใต้ #bd กันชน id (helper)
     ==================================================================== */
  const _bdRoot = document.getElementById('bd');
  function $id(id) { return _bdRoot ? _bdRoot.querySelector('#' + id) : document.getElementById(id); }
  function getById(id) { return $id(id); }

  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth() + 1;
  let allData = null;
  const MONTH_NAMES_TH = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const MONTH_NAMES_SHORT = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  const HELP = {
    title: 'Birthday Tracker — รายชื่อวันเกิด + cake workflow',
    subtitle: 'วันเกิดพนักงาน + cake workflow',
    intro: 'จัดการวันเกิดพนักงาน + workflow สั่งเค้ก ตั้งแต่ pending → ordered → received → celebrated',
    sections: [
      { title: 'การใช้งาน', items: [
        'เลือกเดือนจาก year strip ด้านบน หรือใช้ปุ่ม < > navigate',
        'กด "Sync upcoming" — สแกน employees + insert tracker rows สำหรับเดือนนี้',
        'กด "สั่งเค้กเดือนนี้" → ส่ง email cake vendor ทันที (group by cake_type)',
        'แต่ละการ์ด → กด button "Ordered/Received/Celebrated" เพื่อเดิน workflow',
      ]},
      { title: 'Cake workflow stages', items: [
        '<strong>pending</strong> — ยังไม่ได้สั่ง (กด "Sync upcoming" ครั้งแรก)',
        '<strong>ordered</strong> — ส่ง email vendor แล้ว / mark manual (เช่นโทรไปสั่ง)',
        '<strong>received</strong> — เค้กมาถึงแล้ว (HR ตรวจรับ)',
        '<strong>celebrated</strong> — จัดเลี้ยงเสร็จ (workflow ปิด)',
        '<strong>needs_manual_order</strong> — vendor email ไม่ตั้งค่า → HR ต้องสั่งเอง',
      ]},
      { title: 'Cake config', items: [
        '<code>CAKE_VENDOR_EMAIL</code> — email บริษัทเค้ก (ตั้งใน Settings)',
        '<code>CAKE_DEFAULT_TYPE</code> — ประเภท fallback ถ้า employee ไม่ระบุ',
        'พนักงานสามารถระบุ cake_type ส่วนตัวใน Employee Manager',
      ]},
      { type: 'warn', title: 'ระวัง', items: [
        'cron จริงรันแค่วันที่ 5 ของเดือน — "Sync upcoming" override นี้ได้',
        'กด "สั่งเค้ก" จะส่ง email จริงทันที — ใช้ระวัง',
        'หมายเหตุ: บน dashboard นี้เป็น read-only — การสั่งเค้ก / เขียนกลับยังไม่พร้อม',
      ]},
    ],
  };

  // ===== header / labels =====
  getById('section-icon').innerHTML = ICONS.cake;
  getById('refresh-btn').innerHTML = ICONS.refresh;
  getById('help-btn').innerHTML = ICONS.help;
  getById('order-btn').innerHTML = ICONS.cake + ' สั่งเค้กเดือนนี้';
  getById('prev-btn').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  getById('next-btn').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  getById('notes-save-btn').innerHTML = ICONS.save + ' บันทึก';
  getById('filter-year').value = currentYear;

  function navMonth(delta) {
    currentMonth += delta;
    if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    getById('filter-year').value = currentYear;
    loadList();
  }

  function selectMonth(m) {
    currentMonth = m;
    loadList();
  }

  function loadList() {
    const yr = parseInt(getById('filter-year').value, 10) || currentYear;
    currentYear = yr;
    getById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    getById('month-display').textContent = MONTH_NAMES_TH[currentMonth] + ' ' + currentYear;

    const opts = {
      year: currentYear,
      month: currentMonth,
      branch: getById('filter-branch').value || '',
    };

    google.script.run
      .withSuccessHandler(d => {
        d = d || {};
        allData = d;
        renderStats(d.stats || {});
        renderConfig(d.cake_settings || {});
        populateBranches(d.branches || []);
        renderYearStrip(d.stats && d.stats.month_distribution || {});
        renderList(d.items || []);
      })
      .withFailureHandler(e => {
        getById('content').innerHTML =
          '<div class="empty"><div class="empty-title">โหลดไม่สำเร็จ</div>' +
          '<div class="empty-sub">' + escapeHtml(e.message) + '</div></div>';
      })
      .birthdayAdminList(opts);
  }

  function renderStats(s) {
    getById('stats').innerHTML = [
      statCard('ปีนี้', s.year_total, 'พนักงานที่ระบุวันเกิด', 'var(--navy)'),
      statCard('เดือนนี้', s.this_month, 'รวม + ผ่านมาแล้ว', 'var(--info)'),
      statCard('สั่งแล้ว', s.ordered, 'cake ordered', 'var(--warning)'),
      statCard('รับแล้ว', s.received, 'cake received', 'var(--success)'),
      statCard('Manual', s.needs_manual, 'ต้องสั่งเอง', s.needs_manual > 0 ? 'var(--danger)' : 'var(--text-faint)'),
    ].join('');
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  function renderConfig(c) {
    const wrap = getById('cake-config');
    if (!c.vendor_email) {
      wrap.innerHTML = [
        '<div class="config-card warn">',
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
          '<div>',
            '<strong>CAKE_VENDOR_EMAIL ยังไม่ได้ตั้งค่า</strong> — auto-order จะข้ามและ HR ต้องสั่งเอง · ',
            '<span style="color:var(--warning)">ตั้งใน Settings (GAS)</span>',
          '</div>',
        '</div>',
      ].join('');
    } else {
      wrap.innerHTML = [
        '<div class="config-card">',
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"/><path d="M2 21h20"/><path d="M7 8v3"/><path d="M12 8v3"/><path d="M17 8v3"/></svg>',
          '<div>',
            'Vendor: <code>' + escapeHtml(c.vendor_email) + '</code> · ',
            'Default cake: <code>' + escapeHtml(c.default_type) + '</code>',
          '</div>',
        '</div>',
      ].join('');
    }
  }

  let _branchPopulated = false;
  function populateBranches(branches) {
    if (_branchPopulated) return;
    _branchPopulated = true;
    const sel = getById('filter-branch');
    branches.forEach(b => {
      sel.innerHTML += '<option value="' + escapeAttr(b.id) + '">' + escapeHtml(b.name) + '</option>';
    });
  }

  function renderYearStrip(monthDist) {
    const today = new Date();
    const todayMonth = today.getMonth() + 1;
    const cells = [];
    for (let m = 1; m <= 12; m++) {
      const count = monthDist[m] || 0;
      const cls = [
        'month-cell',
        m === currentMonth ? 'selected' : '',
        m === todayMonth ? 'is-current' : '',
        count === 0 ? 'zero' : '',
      ].filter(Boolean).join(' ');
      cells.push([
        '<div class="' + cls + '" onclick="selectMonth(' + m + ')">',
          '<div class="mc-name">' + MONTH_NAMES_SHORT[m] + '</div>',
          '<div class="mc-count">' + count + '</div>',
        '</div>',
      ].join(''));
    }
    getById('year-strip').innerHTML = cells.join('');
  }

  function renderList(items) {
    const sectionTitle = MONTH_NAMES_TH[currentMonth] + ' ' + currentYear + ' · ' + items.length + ' คน';
    getById('section-title').textContent = sectionTitle;

    if (!items.length) {
      getById('content').innerHTML =
        '<div class="empty"><div class="empty-icon">' + ICONS.cake + '</div>' +
        '<div class="empty-title">ไม่มีวันเกิดในเดือนนี้</div>' +
        '<div class="empty-sub">ลองเปลี่ยนเดือนจาก year strip ด้านบน</div></div>';
      return;
    }

    const cards = items.map(it => {
      const initials = (it.nickname || it.name || '?').substring(0, 2).toUpperCase();
      const dayMonth = String(it.birthday_day).padStart(2, '0');
      const monLabel = MONTH_NAMES_SHORT[currentMonth];

      let untilCls, untilLabel;
      if (it.days_until === 0) { untilCls = 'today'; untilLabel = 'วันนี้'; }
      else if (it.days_until > 0 && it.days_until <= 7) { untilCls = 'soon'; untilLabel = 'อีก ' + it.days_until + ' วัน'; }
      else if (it.days_until > 0) { untilCls = 'future'; untilLabel = 'อีก ' + it.days_until + ' วัน'; }
      else { untilCls = 'past'; untilLabel = 'ผ่านมา ' + (-it.days_until) + ' วัน'; }

      const cardCls = [
        'bday-card',
        it.days_until === 0 ? 'is-today' : '',
        it.days_until > 0 && it.days_until <= 7 ? 'is-soon' : '',
        it.days_until < 0 ? 'is-past' : '',
      ].filter(Boolean).join(' ');

      // Stepper
      const status = it.cake_status;
      const isOrdered = ['ordered', 'received', 'celebrated'].includes(status);
      const isReceived = ['received', 'celebrated'].includes(status);
      const isCelebrated = status === 'celebrated';
      const isManual = status === 'needs_manual_order';
      const isMissed = status === 'missed';

      let stepper;
      if (isMissed) {
        stepper = '<div class="stepper"><div class="step warn" style="width:100%">missed (ไม่มี tracker)</div></div>';
      } else {
        const arrow = '<div class="step-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>';
        const orderedCls = isOrdered ? 'done' : (isManual ? 'warn' : (status === 'pending' ? 'active' : ''));
        const receivedCls = isReceived ? 'done' : (isOrdered ? 'active' : '');
        const celebCls = isCelebrated ? 'done' : (isReceived ? 'active' : '');
        stepper = [
          '<div class="stepper">',
            '<div class="step ' + orderedCls + '">' + (isManual ? 'Manual!' : 'Ordered') + '</div>',
            arrow,
            '<div class="step ' + receivedCls + '">Received</div>',
            arrow,
            '<div class="step ' + celebCls + '">Celebrated</div>',
          '</div>',
        ].join('');
      }

      // Action buttons
      let actions = '';
      if (it.tracker) {
        const id = it.tracker.bday_id;
        if (!isOrdered && !isManual) {
          actions += '<button class="btn btn-sm" onclick="markOrdered(\'' + escapeAttr(id) + '\', \'' + escapeAttr(it.cake_type) + '\')">Mark Ordered</button>';
        }
        if (isManual) {
          actions += '<button class="btn btn-sm btn-primary" onclick="markOrdered(\'' + escapeAttr(id) + '\', \'' + escapeAttr(it.cake_type) + '\')">สั่งแล้ว</button>';
        }
        if (isOrdered && !isReceived) {
          actions += '<button class="btn btn-sm btn-primary" onclick="markReceived(\'' + escapeAttr(id) + '\')">Mark Received</button>';
        }
        if (isReceived && !isCelebrated) {
          actions += '<button class="btn btn-sm btn-success" onclick="markCelebrated(\'' + escapeAttr(id) + '\')">Mark Celebrated</button>';
        }
        if (isCelebrated) {
          actions += '<span style="font-size:11px;color:var(--success);font-weight:500;padding:6px 8px">' + ICONS.check + ' เสร็จสมบูรณ์</span>';
        }
      } else {
        actions += '<button class="btn btn-sm" onclick="addManualEntry(\'' + escapeAttr(it.employee_id) + '\')">+ Add tracker</button>';
      }

      // notification badges + notes
      const badges = [];
      if (it.tracker) {
        if (it.tracker.accounting_notified) {
          badges.push('<span class="nbadge acc" title="บัญชีรู้แล้ว">' + ICONS.bell + ' บัญชี</span>');
        }
        if (it.tracker.team_notified) {
          badges.push('<span class="nbadge team" title="หัวหน้าสาขาแจ้งแล้ว">' + ICONS.users + ' ทีม</span>');
        }
        if (it.tracker.card_status === 'done') {
          badges.push('<span class="nbadge card" title="การ์ดเตรียมเสร็จ">' + ICONS.check + ' การ์ดพร้อม</span>');
        } else if (it.tracker.card_status === 'pending_prep') {
          badges.push('<span class="nbadge" title="กำลังเตรียมการ์ด">' + ICONS.edit + ' การ์ด pending</span>');
        }
      }
      const badgeRow = badges.length ? '<div class="badge-row">' + badges.join('') + '</div>' : '';

      const notes = it.tracker && it.tracker.notes ? it.tracker.notes : '';
      const notesBlock = it.tracker ? [
        '<div class="notes-block" data-bday="' + escapeAttr(it.tracker.bday_id) + '" data-name="' + escapeAttr(it.nickname || it.name) + '" data-cake="' + escapeAttr(it.cake_type || '') + '" data-notes="' + escapeAttr(notes) + '">',
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
          '<div style="flex:1">' + (notes ? escapeHtml(notes) : '<span style="color:var(--text-faint);font-style:italic">no notes</span>') + '</div>',
          '<button class="notes-edit-btn" onclick="openNotesFromCard(this)" title="แก้หมายเหตุ">edit</button>',
        '</div>',
      ].join('') : '';

      return [
        '<div class="' + cardCls + '">',
          '<div class="bday-head">',
            '<div class="bday-avatar">' + escapeHtml(initials) + '</div>',
            '<div class="bday-info">',
              '<div class="bday-name">' + escapeHtml(it.nickname || it.name) + '</div>',
              '<div class="bday-meta">' + escapeHtml(it.name) + ' · ' + escapeHtml(it.branch_name) + '</div>',
              '<div style="margin-top:4px">',
                it.line_linked
                  ? '<span class="line-tag">LINE</span>'
                  : '<span class="line-tag unlinked">no LINE</span>',
              '</div>',
            '</div>',
            '<div class="bday-date">',
              '<div class="bday-day">' + dayMonth + '</div>',
              '<div class="bday-mon">' + monLabel + '</div>',
              '<div class="bday-until ' + untilCls + '">' + untilLabel + '</div>',
            '</div>',
          '</div>',
          badgeRow,
          '<div class="cake-row">',
            '<div class="cake-icon">' + ICONS.cake + '</div>',
            '<div style="flex:1">',
              '<span class="cake-type">' + escapeHtml(it.cake_type || '—') + '</span>',
              it.cake_note ? '<span class="cake-note">' + escapeHtml(it.cake_note) + '</span>' : '',
            '</div>',
          '</div>',
          stepper,
          '<div class="bday-actions">' + actions + '</div>',
          notesBlock,
        '</div>',
      ].join('');
    }).join('');

    getById('content').innerHTML = '<div class="bday-grid">' + cards + '</div>';
  }

  // === Actions (read-only บน dashboard → shim คืน error + toast) ===

  function markOrdered(bdayId, cakeType) {
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('Marked ordered', 'success'); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .birthdayAdminMarkOrdered(bdayId, cakeType);
  }

  function markReceived(bdayId) {
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('Marked received', 'success'); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .birthdayAdminMarkReceived(bdayId);
  }

  function markCelebrated(bdayId) {
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('Celebrated', 'success'); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .birthdayAdminMarkCelebrated(bdayId);
  }

  function addManualEntry(empId) {
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('เพิ่ม tracker แล้ว', 'success'); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .birthdayAdminAddManualEntry(empId, { year: currentYear });
  }

  // === Notes editing ===
  function openNotesFromCard(btn) {
    const block = btn.closest('.notes-block');
    if (!block) return;
    openNotes(
      block.getAttribute('data-bday') || '',
      block.getAttribute('data-name') || '',
      block.getAttribute('data-cake') || '',
      block.getAttribute('data-notes') || ''
    );
  }

  function openNotes(bdayId, displayName, cakeType, currentNotes) {
    getById('notes-bday-id').value = bdayId;
    getById('notes-modal-sub').textContent = displayName;
    getById('notes-cake-type').value = cakeType || '';
    getById('notes-text').value = currentNotes || '';
    getById('notes-modal-bg').classList.add('active');
  }

  function closeNotesModal() {
    getById('notes-modal-bg').classList.remove('active');
  }

  function saveNotes() {
    const bdayId = getById('notes-bday-id').value;
    const updates = {
      cake_type: getById('notes-cake-type').value.trim(),
      notes: getById('notes-text').value.trim(),
    };
    const btn = getById('notes-save-btn');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(r => {
        btn.disabled = false; btn.innerHTML = ICONS.save + ' บันทึก';
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('บันทึกแล้ว', 'success');
        closeNotesModal(); loadList();
      })
      .withFailureHandler(e => {
        btn.disabled = false; btn.innerHTML = ICONS.save + ' บันทึก';
        showToast('Error: ' + e.message, 'error');
      })
      .birthdayAdminUpdateEntry(bdayId, updates);
  }

  function forceCheck() {
    if (!confirm('Sync upcoming birthdays\n\nสแกน employees + insert tracker rows สำหรับเดือนนี้\n(ไม่ส่ง email vendor — กดปุ่ม "สั่งเค้กเดือนนี้" แยก)')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        const msg = 'สแกน ' + (r.upcoming || 0) + ' คน · เพิ่ม tracker ' + (r.inserted || 0) + ' row (ไม่ส่ง email)';
        showToast(msg, 'success');
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .birthdayAdminRunCheckUpcoming();
  }

  function forceOrder() {
    if (!confirm('สั่งเค้กเดือนนี้\n\nส่ง email vendor ทันที (group by cake_type อัตโนมัติ)\nคนที่สั่งไปแล้วจะถูก skip — กดซ้ำได้ไม่เกิดปัญหา')) return;
    getById('order-btn').disabled = true;
    google.script.run
      .withSuccessHandler(r => {
        getById('order-btn').disabled = false;
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (r && r.skipped === 'no_birthdays_this_month') {
          showToast('ไม่มีวันเกิดในเดือนนี้', 'success'); return;
        }
        if (r && r.skipped === 'all_already_ordered') {
          showToast('สั่งครบแล้ว ' + (r.total_in_month || 0) + ' คน — ไม่มีอะไรให้ส่งเพิ่ม', 'success'); return;
        }
        const skipMsg = r.skipped_already_done > 0
          ? ' (skip ' + r.skipped_already_done + ' ที่สั่งแล้ว)'
          : '';
        showToast('สั่งเค้ก ' + (r.ordered || 0) + ' คน' + skipMsg, 'success');
        loadList();
      })
      .withFailureHandler(e => {
        getById('order-btn').disabled = false;
        showToast('Error: ' + e.message, 'error');
      })
      .birthdayAdminForceOrderCakes();
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList, navMonth, selectMonth,
    markOrdered, markReceived, markCelebrated, addManualEntry,
    openNotesFromCard, openNotes, closeNotesModal, saveNotes,
    forceCheck, forceOrder,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadList();
}
