// _ported/holiday.js — FULL native port of desktop holiday_manager.html (HR Announcement admin · หน้า "วันหยุด")
// ลอกทั้งดุ้น: next-holiday banner + stats(5) + filters(year/branch/type) + 3 views(list/month/year)
//   + 2 modals (add/edit + recurring) + help + export .ics + copy prev year + seed
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix #hd ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ HD_RUN_PAGE_JS() · google.script.run = shim → HD_BACKEND (Supabase)
//
// ใช้ global window.sb (index.html module scope) — ห้าม redeclare · helper (esc/$/showToast/showHelp) inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน HD_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=holiday.updated → {items}) :
//   READ  holidayList({year,branch_id,type}) → derive {years,branches,stats,byMonth} client-side
//         จาก payload ล่าสุดต่อ holiday (ตอนนี้ list อาจว่าง = 0 วันหยุด → render ได้ ไม่ error · empty state สวย)
//   WRITE holidayAdd/Update/Remove/SeedPublicYear/CopyYear/AddRecurring → เขียนกลับไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   HD_BACKEND — map google.script.run → Supabase edge fn hr_list (type=holiday.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     holidayList(filter)  → { years, branches, stats, byMonth }
     mutations            → { error } stub + toast
   ============================================================ */
var HD_FN = 'hr_list';
var HD_TYPE = 'holiday.updated';

function hd2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function hd2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function hd2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

var HD_TYPES = ['public', 'company', 'branch_specific', 'religious_observance'];

// map payload event ดิบ → holiday row shape ที่ JS เดิมใช้
function hd2MapHol(p) {
  p = p || {};
  var type = String(p.type || 'public').toLowerCase();
  if (HD_TYPES.indexOf(type) < 0) type = 'public';
  var date = hd2Date(p.holiday_date || p.date);
  return {
    id: p.id || p.holiday_id || p.entity_id || '',
    date: date,
    name: p.name || p.holiday_name || '—',
    type: type,
    branch_id: p.branch_id || 'ALL',
    recurring: p.recurring || 'yearly',
    is_paid: p.is_paid == null ? true : hd2Bool(p.is_paid),
    closes_office: hd2Bool(p.closes_office),
    closes_frontline: hd2Bool(p.closes_frontline),
    substitute_for: p.substitute_for || '',
    notes: p.notes || '',
    _raw: p,
  };
}

// cache row ล่าสุดต่อ holiday (backend ไม่มี endpoint แยก)
var _hd2Hols = [];

function hd2FetchHols() {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) {
    _hd2Hols = [];
    return Promise.resolve([]);
  }
  return sb.functions.invoke(HD_FN + '?type=' + encodeURIComponent(HD_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = hd2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var row = hd2MapHol(p);
      var key = row.id || (row.date + '|' + row.branch_id + '|' + row.name);
      if (!key || seen[key]) return;
      seen[key] = true;
      if (!row.id) row.id = key;   // กัน openEdit/remove ที่ใช้ id
      if (!row.date) return;       // ไม่มีวันที่ → ข้าม (render ไม่ได้)
      rows.push(row);
    });
    _hd2Hols = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[HD_BACKEND] list fetch failed', e);
    _hd2Hols = [];
    return [];
  });
}

var HD_BACKEND = {
  // list — { years, branches, stats, byMonth } (กรองตาม filter ฝั่ง client)
  holidayList: function (filter) {
    filter = filter || {};
    return hd2FetchHols().then(function (all) {
      var year = parseInt(filter.year, 10) || new Date().getFullYear();

      // ปีที่มีข้อมูล + ปีปัจจุบัน +/- ใกล้เคียง (ให้ dropdown ไม่ว่าง)
      var yearSet = {};
      all.forEach(function (h) { var y = parseInt((h.date || '').slice(0, 4), 10); if (y) yearSet[y] = true; });
      var nowY = new Date().getFullYear();
      [nowY - 1, nowY, nowY + 1].forEach(function (y) { yearSet[y] = true; });
      var years = Object.keys(yearSet).map(function (y) { return parseInt(y, 10); }).sort(function (a, b) { return a - b; });

      // สาขา derive จาก holiday rows (backend ไม่มี master list บน dashboard)
      var bSeen = {}, branches = [];
      all.forEach(function (h) {
        if (h.branch_id && h.branch_id !== 'ALL' && !bSeen[h.branch_id]) {
          bSeen[h.branch_id] = true;
          branches.push({ id: h.branch_id, name: h._raw && h._raw.branch_name ? h._raw.branch_name : h.branch_id, is_hq: hd2Bool(h._raw && h._raw.is_hq) });
        }
      });

      // กรองตามปี (เสมอ) + สาขา + ประเภท
      var rows = all.filter(function (h) { return (h.date || '').slice(0, 4) === String(year); });
      if (filter.branch_id) rows = rows.filter(function (h) { return h.branch_id === filter.branch_id || h.branch_id === 'ALL'; });
      if (filter.type) rows = rows.filter(function (h) { return h.type === filter.type; });

      // stats นับจาก rows ที่ผ่าน filter
      var byType = function (t) { return rows.filter(function (h) { return h.type === t; }).length; };
      var stats = {
        total: rows.length,
        public: byType('public'),
        company: byType('company'),
        branch_specific: byType('branch_specific'),
        religious: byType('religious_observance'),
      };

      // byMonth → { 'yyyy-MM': [rows...] }
      var byMonth = {};
      rows.slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); }).forEach(function (h) {
        var mk = (h.date || '').slice(0, 7);
        if (!mk) return;
        (byMonth[mk] = byMonth[mk] || []).push(h);
      });

      return { years: years, branches: branches, stats: stats, byMonth: byMonth };
    });
  },

  // ---- mutations: เขียนกลับไม่ได้บน dashboard → stub + toast ----
  holidayAdd: function () {
    hd2NotReady('เพิ่มวันหยุด');
    return Promise.resolve({ error: 'เพิ่มวันหยุดยังไม่พร้อมบน dashboard (read-only)' });
  },
  holidayUpdate: function () {
    hd2NotReady('แก้ไขวันหยุด');
    return Promise.resolve({ error: 'แก้ไขวันหยุดยังไม่พร้อมบน dashboard (read-only)' });
  },
  holidayRemove: function () {
    hd2NotReady('ลบวันหยุด');
    return Promise.resolve({ error: 'ลบวันหยุดยังไม่พร้อมบน dashboard (read-only)' });
  },
  holidaySeedPublicYear: function () {
    hd2NotReady('Seed วันหยุดราชการ');
    return Promise.resolve({ error: 'Seed ยังไม่พร้อมบน dashboard (read-only)' });
  },
  holidayCopyYear: function () {
    hd2NotReady('คัดลอกวันหยุดจากปีก่อน');
    return Promise.resolve({ error: 'คัดลอกปีก่อนยังไม่พร้อมบน dashboard (read-only)' });
  },
  holidayAddRecurring: function () {
    hd2NotReady('สร้างวันหยุดประจำทั้งปี');
    return Promise.resolve({ error: 'วันหยุดประจำยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _hd2NotReadyShown = {};
function hd2NotReady(feature) {
  if (_hd2NotReadyShown[feature]) return;
  _hd2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.hd2Toast) window.hd2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountHoliday — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountHoliday() {
  if (!document.getElementById('wrap-holiday')) return;
  var wrap = document.getElementById('wrap-holiday');
  wrap.innerHTML = '<style>' + HD_CSS() + '</style><div id="hd">' + HD_MARKUP() + '</div>';
  HD_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #hd =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว) */
function HD_CSS() {
  return [
    // tokens (จาก <style> หน้า manager)
    '#hd{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#FFFFFF;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--c-public:#047857;--c-public-bg:#ECFDF5;--c-company:#6D28D9;--c-company-bg:#F5F3FF;--c-branch:#C2410C;--c-branch-bg:#FFF7ED;--c-religious:#1D4ED8;--c-religious-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#hd *{box-sizing:border-box}',
    // page head (native บน dashboard)
    '#hd .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#hd .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#hd .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#hd .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#hd .page-actions{display:flex;gap:8px;flex-shrink:1;align-items:center;flex-wrap:wrap;justify-content:flex-end}',
    // toggle group
    '#hd .toggle-group{display:flex;background:#F1F5F9;border-radius:6px;padding:2px}',
    '#hd .toggle-btn{padding:6px 12px;background:transparent;border:none;border-radius:4px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:flex;align-items:center;gap:6px;transition:all .15s}',
    '#hd .toggle-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#hd .toggle-btn:hover:not(.active){color:var(--text)}',
    '#hd .toggle-btn svg{width:14px;height:14px}',
    // buttons
    '#hd .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#hd .btn:hover{border-color:var(--navy)}',
    '#hd .btn svg{width:14px;height:14px}',
    '#hd .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#hd .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#hd .btn-navy{background:var(--navy);color:#fff;border-color:var(--navy)}',
    '#hd .btn-navy:hover{background:#0a2540}',
    '#hd .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#hd .btn-sm{padding:5px 10px;font-size:12px}',
    '#hd .btn-icon{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;color:#475569}',
    '#hd .btn-icon-danger{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}',
    '#hd .btn-icon-danger:hover{border-color:var(--danger)}',
    '#hd .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:8px;background:#fff;color:var(--text-muted);cursor:pointer}',
    '#hd .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#hd .btn-help svg{width:14px;height:14px}',
    // stat cards
    '#hd .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px}',
    '#hd .stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;position:relative;overflow:hidden;transition:border .15s}',
    '#hd .stat:hover{border-color:var(--border-strong)}',
    '#hd .stat-stripe{position:absolute;top:0;left:0;right:0;height:2px}',
    '#hd .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}',
    '#hd .stat-value{font-size:26px;font-weight:600;color:var(--text);margin-top:4px;letter-spacing:-.03em;line-height:1}',
    '#hd .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#hd .filters{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:14px}',
    '#hd .filter{display:flex;flex-direction:column;gap:4px}',
    '#hd .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#hd .filter select{padding:7px 28px 7px 10px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);appearance:none;min-width:140px;cursor:pointer}',
    '#hd .filter select:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',
    // month section
    '#hd .month{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03);margin-bottom:12px}',
    '#hd .month-header{padding:12px 18px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}',
    '#hd .month-icon{width:30px;height:30px;border-radius:6px;background:var(--c-religious-bg);display:flex;align-items:center;justify-content:center;color:var(--c-religious)}',
    '#hd .month-title{font-size:13px;font-weight:600;color:var(--text)}',
    '#hd .month-sub{font-size:11px;color:var(--text-muted)}',
    // holiday rows
    '#hd .holiday{border-left:3px solid transparent;border-bottom:1px solid #F1F5F9}',
    '#hd .holiday:last-child{border-bottom:none}',
    '#hd .holiday:hover{background:#FAFBFC}',
    '#hd .holiday[data-type="public"]{border-left-color:var(--c-public)}',
    '#hd .holiday[data-type="company"]{border-left-color:var(--c-company)}',
    '#hd .holiday[data-type="branch_specific"]{border-left-color:var(--c-branch)}',
    '#hd .holiday[data-type="religious_observance"]{border-left-color:var(--c-religious)}',
    '#hd .holiday-row{padding:14px 18px;display:grid;grid-template-columns:60px 1fr auto auto;gap:16px;align-items:center}',
    '#hd .h-date-block{text-align:center}',
    '#hd .h-date{font-size:22px;font-weight:600;color:var(--text);letter-spacing:-.03em;line-height:1}',
    '#hd .h-day{font-size:10px;color:var(--text-faint);margin-top:3px;font-weight:500;text-transform:uppercase;letter-spacing:.05em}',
    '#hd .h-name{font-size:14px;font-weight:500;color:var(--text)}',
    '#hd .h-meta{font-size:11px;color:var(--text-muted);margin-top:4px;display:flex;gap:14px;flex-wrap:wrap}',
    '#hd .h-meta-item{display:inline-flex;align-items:center;gap:4px}',
    '#hd .h-dot{display:inline-block;width:5px;height:5px;border-radius:50%}',
    '#hd .h-branch-mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text)}',
    '#hd .observe-block{display:flex;flex-direction:column;gap:4px;min-width:130px}',
    '#hd .observe-line{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:11px}',
    '#hd .observe-line .label{color:var(--text-muted)}',
    '#hd .pill{padding:2px 9px;border-radius:12px;font-size:10px;font-weight:600}',
    '#hd .pill-closed{background:var(--danger-bg);color:var(--danger)}',
    '#hd .pill-open{background:var(--success-bg);color:var(--success)}',
    // per-branch chips
    '#hd .h-branches{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
    '#hd .h-branches-label{font-size:10px;color:var(--text-faint);align-self:center;margin-right:2px}',
    '#hd .bchip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:500;border:1px solid transparent;white-space:nowrap}',
    '#hd .bchip .bcode{font-family:"SF Mono",Consolas,monospace;font-weight:600;letter-spacing:-.02em}',
    '#hd .bchip-closed{background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border)}',
    '#hd .bchip-open{background:var(--success-bg);color:var(--success)}',
    '#hd .h-actions{display:flex;gap:4px}',
  ].join('\n') + HD_CSS2();
}

/* CSS part 2 — year view / month view / modal / empty / toast / next-banner / responsive */
function HD_CSS2() {
  return '\n' + [
    // year view
    '#hd .year-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}',
    '#hd .year-month{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px;cursor:pointer;transition:all .15s}',
    '#hd .year-month:hover{border-color:var(--navy);box-shadow:0 4px 12px rgba(13,47,79,.08)}',
    '#hd .year-month-title{font-size:12px;font-weight:600;color:var(--text);display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}',
    '#hd .year-month-count{font-size:10px;color:var(--text-muted);background:#F1F5F9;padding:1px 8px;border-radius:10px;font-weight:500}',
    '#hd .year-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-size:10px}',
    '#hd .year-cal-head{color:var(--text-faint);text-align:center;font-size:9px;font-weight:600;padding:2px 0}',
    '#hd .year-cal-cell{aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:4px;color:var(--text);position:relative}',
    '#hd .year-cal-cell.empty{color:transparent}',
    '#hd .year-cal-cell.weekend{color:var(--text-faint)}',
    '#hd .year-cal-cell.has-holiday{background:var(--c-public-bg);color:var(--c-public);font-weight:600}',
    '#hd .year-cal-cell.has-holiday[data-type="company"]{background:var(--c-company-bg);color:var(--c-company)}',
    '#hd .year-cal-cell.has-holiday[data-type="branch_specific"]{background:var(--c-branch-bg);color:var(--c-branch)}',
    '#hd .year-cal-cell.has-holiday[data-type="religious_observance"]{background:var(--c-religious-bg);color:var(--c-religious)}',
    '#hd .year-cal-cell.has-holiday::after{content:"";position:absolute;bottom:1px;left:50%;width:3px;height:3px;border-radius:50%;background:currentColor;transform:translateX(-50%)}',
    '#hd .year-cal-cell.today{outline:2px solid var(--navy);outline-offset:-2px}',
    // month view
    '#hd .month-view-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}',
    '#hd .month-nav{display:flex;align-items:center;gap:8px}',
    '#hd .month-nav-title{font-size:16px;font-weight:600;color:var(--navy);letter-spacing:-.01em;min-width:150px;text-align:center}',
    '#hd .month-nav-btn{width:32px;height:32px;padding:0;border-radius:6px;border:1px solid var(--border-strong);background:var(--surface);color:#475569;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all .15s}',
    '#hd .month-nav-btn:hover{border-color:var(--navy);color:var(--navy)}',
    '#hd .month-nav-btn svg{width:16px;height:16px}',
    '#hd .month-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text-muted)}',
    '#hd .month-legend-item{display:inline-flex;align-items:center;gap:5px}',
    '#hd .month-legend-dot{width:8px;height:8px;border-radius:50%}',
    '#hd .month-cal{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03)}',
    '#hd .month-cal-head{display:grid;grid-template-columns:repeat(7,1fr);background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border)}',
    '#hd .month-cal-head div{padding:10px 0;text-align:center;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}',
    '#hd .month-cal-head div.we{color:var(--text-faint)}',
    '#hd .month-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:minmax(96px,auto)}',
    '#hd .mc-cell{border-right:1px solid #F1F5F9;border-bottom:1px solid #F1F5F9;padding:6px 7px;min-height:96px;display:flex;flex-direction:column;gap:4px;position:relative;background:var(--surface)}',
    '#hd .mc-cell:nth-child(7n){border-right:none}',
    '#hd .mc-cell.empty{background:#FBFCFD}',
    '#hd .mc-cell.weekend{background:#FCFCFD}',
    '#hd .mc-daynum{font-size:12px;font-weight:600;color:var(--text);width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '#hd .mc-cell.weekend .mc-daynum{color:var(--text-faint)}',
    '#hd .mc-cell.today .mc-daynum{background:var(--navy);color:#fff}',
    '#hd .mc-chip{font-size:11px;font-weight:500;line-height:1.3;padding:3px 7px;border-radius:5px;cursor:pointer;border-left:3px solid transparent;white-space:normal;word-break:break-word;transition:filter .12s}',
    '#hd .mc-chip:hover{filter:brightness(.96)}',
    '#hd .mc-chip[data-type="public"]{background:var(--c-public-bg);color:var(--c-public);border-left-color:var(--c-public)}',
    '#hd .mc-chip[data-type="company"]{background:var(--c-company-bg);color:var(--c-company);border-left-color:var(--c-company)}',
    '#hd .mc-chip[data-type="branch_specific"]{background:var(--c-branch-bg);color:var(--c-branch);border-left-color:var(--c-branch)}',
    '#hd .mc-chip[data-type="religious_observance"]{background:var(--c-religious-bg);color:var(--c-religious);border-left-color:var(--c-religious)}',
    '#hd .mc-chip-branch{font-size:9px;font-weight:600;opacity:.75}',
    // modal
    '#hd .modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;z-index:9000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}',
    '#hd .modal-bg.active{display:flex}',
    '#hd .modal{background:var(--surface);border-radius:12px;padding:0;max-width:540px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);display:flex;flex-direction:column}',
    '#hd .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}',
    '#hd .modal-header h2{font-size:16px;font-weight:600;color:var(--text);letter-spacing:-.01em}',
    '#hd .modal-header p{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#hd .modal-body{padding:20px 24px;flex:1;overflow-y:auto}',
    '#hd .modal-footer{padding:14px 24px;border-top:1px solid var(--border);background:#F8FAFC;display:flex;gap:8px;justify-content:flex-end}',
    '#hd .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}',
    '#hd .field label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#hd .field input[type=text],#hd .field input[type=date],#hd .field select,#hd .field textarea{padding:9px 12px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);transition:border .15s}',
    '#hd .field input:focus,#hd .field select:focus,#hd .field textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',
    '#hd .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '#hd .toggle-card{border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:14px}',
    '#hd .toggle-card-title{padding:10px 14px;background:#F8FAFC;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500;border-bottom:1px solid var(--border)}',
    '#hd .toggle-item{padding:12px 14px;display:flex;align-items:flex-start;gap:10px;border-bottom:1px solid #F1F5F9;cursor:pointer;transition:background .15s}',
    '#hd .toggle-item:hover{background:#F8FAFC}',
    '#hd .toggle-item:last-child{border-bottom:none}',
    '#hd .toggle-item input[type=checkbox]{width:16px;height:16px;accent-color:var(--navy);margin-top:2px;cursor:pointer}',
    '#hd .toggle-item .toggle-label{font-size:13px;font-weight:500;color:var(--text)}',
    '#hd .toggle-item .toggle-desc{font-size:11px;color:var(--text-muted);margin-top:2px}',
    // empty / loading
    '#hd .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#hd .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#hd .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#hd .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#hd .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // next holiday banner
    '#hd .next-banner{display:flex;align-items:center;gap:14px;background:linear-gradient(110deg,var(--navy) 0%,var(--navy-2) 100%);color:#fff;border-radius:10px;padding:14px 18px;margin-bottom:14px;box-shadow:0 4px 14px rgba(13,47,79,.18)}',
    '#hd .next-icon{width:38px;height:38px;border-radius:9px;flex-shrink:0;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center}',
    '#hd .next-icon svg{width:20px;height:20px}',
    '#hd .next-body{flex:1;min-width:0}',
    '#hd .next-label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--teal);font-weight:700}',
    '#hd .next-name{font-size:16px;font-weight:600;margin-top:2px;letter-spacing:-.01em}',
    '#hd .next-meta{font-size:11px;color:rgba(255,255,255,.72);margin-top:2px}',
    '#hd .next-count{flex-shrink:0;text-align:center;background:var(--teal);color:var(--navy);border-radius:8px;padding:8px 16px;font-weight:700}',
    '#hd .next-count-num{font-size:15px;white-space:nowrap}',
    // responsive
    '@media (max-width:768px){#hd .stats{grid-template-columns:repeat(2,1fr)}#hd .holiday-row{grid-template-columns:1fr;gap:8px}#hd .year-grid{grid-template-columns:repeat(2,1fr)}#hd .field-grid{grid-template-columns:1fr}#hd .month-cal-grid{grid-auto-rows:minmax(64px,auto)}#hd .mc-cell{min-height:64px;padding:4px}#hd .mc-chip{font-size:9px;padding:2px 4px}#hd .month-nav-title{font-size:14px;min-width:120px}}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + next-banner + stats + filters + content + 2 modals =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function HD_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><circle cx="8" cy="14" r="1"/><circle cx="12" cy="14" r="1"/><circle cx="16" cy="14" r="1"/></svg>',
    '      วันหยุดประจำปี',
    '    </h1>',
    '    <div class="subtitle" id="page-subtitle">CRUD วันหยุดประจำปี + วันหยุดสาขา · seed default ของไทย</div>',
    '  </div>',
    '  <div class="page-actions" id="yh-page-actions">',
    '    <div class="toggle-group">',
    '      <button class="toggle-btn active" id="view-list" onclick="setView(\'list\')">',
    '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    '        List',
    '      </button>',
    '      <button class="toggle-btn" id="view-month" onclick="setView(\'month\')">',
    '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/></svg>',
    '        เดือน',
    '      </button>',
    '      <button class="toggle-btn" id="view-year" onclick="setView(\'year\')">',
    '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
    '        Year',
    '      </button>',
    '    </div>',
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn"></button>',
    '    <button class="btn btn-sm" onclick="exportIcs()" title="ดาวน์โหลดเป็นไฟล์ปฏิทิน (.ics)">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
    '      .ics',
    '    </button>',
    '    <button class="btn btn-sm" onclick="window.print()" title="พิมพ์ / บันทึก PDF สรุปวันหยุดทั้งปี">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg>',
    '      พิมพ์',
    '    </button>',
    '    <button class="btn btn-sm" onclick="copyPrevYear()" title="คัดลอกวันหยุดทั้งปีจากปีก่อนหน้า">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
    '      คัดลอกปีก่อน',
    '    </button>',
    '    <button class="btn" onclick="seedYear()">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    '      Seed มาตรฐาน',
    '    </button>',
    '    <button class="btn" onclick="openRecurring()" title="สร้างวันหยุดประจำ เช่น ปิดเสาร์สัปดาห์ที่ 2 ของทุกเดือน">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/><circle cx="12" cy="15" r="1.5"/></svg>',
    '      วันหยุดประจำ',
    '    </button>',
    '    <button class="btn btn-primary" onclick="openAdd()">',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    '      เพิ่มวันหยุด',
    '    </button>',
    '  </div>',
    '</header>',
    // next holiday + stats + filters + content
    '<div id="next-holiday"></div>',
    '<div class="stats" id="stats"></div>',
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ปี</label>',
    '    <select id="filter-year" onchange="loadList()"></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>สาขา</label>',
    '    <select id="filter-branch" onchange="loadList()"><option value="">ทุกสาขา + ALL</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>ประเภท</label>',
    '    <select id="filter-type" onchange="loadList()">',
    '      <option value="">ทั้งหมด</option>',
    '      <option value="public">Public — วันหยุดราชการ</option>',
    '      <option value="company">Company — บริษัท</option>',
    '      <option value="branch_specific">Branch — เฉพาะสาขา</option>',
    '      <option value="religious_observance">Religious — ทางศาสนา</option>',
    '    </select>',
    '  </div>',
    '  <button class="btn btn-sm" onclick="resetFilters()">',
    '    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
    '    Reset',
    '  </button>',
    '</div>',
    '<div id="content" class="loading">กำลังโหลด...</div>',
    HD_MODALS(),
  ].join('\n');
}

/* 2 modals (add/edit + recurring) · คง element id เดิม */
function HD_MODALS() {
  return [
    // Add / Edit
    '<div class="modal-bg" id="modal-bg" onclick="if(event.target===this)closeModal()">',
    '  <div class="modal">',
    '    <div class="modal-header"><h2 id="modal-title">เพิ่มวันหยุด</h2><p>กรอกรายละเอียด — เลือกประเภทเพื่อ pre-fill ใครต้องหยุด</p></div>',
    '    <div class="modal-body">',
    '      <input type="hidden" id="m-id">',
    '      <div class="field-grid">',
    '        <div class="field"><label>วันที่ *</label><input type="date" id="m-date" required></div>',
    '        <div class="field"><label>สาขา</label><select id="m-branch"><option value="ALL">ALL — ทุกสาขา</option></select></div>',
    '      </div>',
    '      <div class="field"><label>ชื่อวันหยุด *</label><input type="text" id="m-name" placeholder="เช่น วันสงกรานต์" required></div>',
    '      <div class="field-grid">',
    '        <div class="field"><label>ประเภท *</label><select id="m-type" onchange="presetByType()">',
    '          <option value="public">Public — วันหยุดราชการ</option>',
    '          <option value="company">Company — บริษัทกำหนด</option>',
    '          <option value="branch_specific">Branch — เฉพาะสาขา</option>',
    '          <option value="religious_observance">Religious — ทางศาสนา</option>',
    '        </select></div>',
    '        <div class="field"><label>วนรอบ</label><select id="m-recurring">',
    '          <option value="yearly">ทุกปี</option>',
    '          <option value="one_time">ปีเดียว</option>',
    '        </select></div>',
    '      </div>',
    '      <div class="toggle-card">',
    '        <div class="toggle-card-title">ใครต้องหยุดวันนี้</div>',
    '        <label class="toggle-item"><input type="checkbox" id="m-closes-office" checked><div><div class="toggle-label">หลังบ้าน / ออฟฟิศหยุด</div><div class="toggle-desc">HR, บัญชี, การตลาด — หยุดตามวันราชการ</div></div></label>',
    '        <label class="toggle-item"><input type="checkbox" id="m-closes-frontline"><div><div class="toggle-label">หน้าบ้าน / คลินิกปิด</div><div class="toggle-desc">พนง.คลินิก, แพทย์, พยาบาล — ถ้าไม่ติ๊ก คลินิกเปิด พนง.สลับเวรเอาวันหยุดอีกวัน</div></div></label>',
    '      </div>',
    '      <div class="field-grid">',
    '        <div class="field"><label>จ่ายค่าจ้าง</label><select id="m-is-paid">',
    '          <option value="true">จ่ายค่าจ้าง (TRUE)</option>',
    '          <option value="false">ไม่จ่าย (FALSE)</option>',
    '        </select></div>',
    '        <div class="field"><label>สลับมาจาก (substitute_for)</label><input type="text" id="m-substitute-for" placeholder="HOL-XXX (optional)" style="font-family:monospace"></div>',
    '      </div>',
    '      <div class="field"><label>หมายเหตุ</label><input type="text" id="m-notes" placeholder="(optional)"></div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeModal()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveHoliday()" id="save-btn">',
    '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    '        บันทึก',
    '      </button>',
    '    </div>',
    '  </div>',
    '</div>',
    // Recurring
    '<div class="modal-bg" id="rec-modal-bg" onclick="if(event.target===this)closeRecurring()">',
    '  <div class="modal">',
    '    <div class="modal-header"><h2>วันหยุดประจำ (ทุกเดือน)</h2><p>เช่น "ปิดเสาร์สัปดาห์ที่ 2 ของทุกเดือน" — ระบบจะสร้างวันหยุดจริงให้ครบทั้งปีที่เลือก</p></div>',
    '    <div class="modal-body">',
    '      <div class="field-grid">',
    '        <div class="field"><label>สัปดาห์ที่ *</label><select id="rec-nth">',
    '          <option value="1">ที่ 1</option><option value="2" selected>ที่ 2</option><option value="3">ที่ 3</option>',
    '          <option value="4">ที่ 4</option><option value="5">ที่ 5 (ถ้ามี)</option><option value="-1">สุดท้ายของเดือน</option>',
    '        </select></div>',
    '        <div class="field"><label>วันในสัปดาห์ *</label><select id="rec-weekday">',
    '          <option value="1">จันทร์</option><option value="2">อังคาร</option><option value="3">พุธ</option>',
    '          <option value="4">พฤหัสบดี</option><option value="5">ศุกร์</option><option value="6" selected>เสาร์</option><option value="0">อาทิตย์</option>',
    '        </select></div>',
    '      </div>',
    '      <div class="field-grid">',
    '        <div class="field"><label>ปี *</label><select id="rec-year"></select></div>',
    '        <div class="field"><label>สาขา</label><select id="rec-branch"><option value="ALL">ALL — ทุกสาขา</option></select></div>',
    '      </div>',
    '      <div class="field"><label>ชื่อวันหยุด *</label><input type="text" id="rec-name" placeholder="เช่น ปิดประจำเดือน (เสาร์ที่ 2)"></div>',
    '      <div class="toggle-card">',
    '        <div class="toggle-card-title">ใครต้องหยุดวันนี้</div>',
    '        <label class="toggle-item"><input type="checkbox" id="rec-closes-office" checked><div><div class="toggle-label">หลังบ้าน / ออฟฟิศหยุด</div><div class="toggle-desc">HR, บัญชี, การตลาด</div></div></label>',
    '        <label class="toggle-item"><input type="checkbox" id="rec-closes-frontline" checked><div><div class="toggle-label">หน้าบ้าน / คลินิกปิด</div><div class="toggle-desc">ถ้าไม่ติ๊ก = คลินิกเปิด พนง.สลับเวร</div></div></label>',
    '      </div>',
    '      <div class="field"><label>จ่ายค่าจ้าง</label><select id="rec-is-paid">',
    '        <option value="true">จ่ายค่าจ้าง (TRUE)</option>',
    '        <option value="false">ไม่จ่าย (FALSE)</option>',
    '      </select></div>',
    '      <p id="rec-preview" style="margin:8px 0 0;font-size:13px;color:var(--text-muted)"></p>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeRecurring()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveRecurring()" id="rec-save-btn">',
    '        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    '        สร้างทั้งปี',
    '      </button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   HD_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → HD_BACKEND
   helper (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function HD_RUN_PAGE_JS() {

  // ---- google.script.run shim → HD_BACKEND (async, คืน shape เดิม) ----
  function _hd2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (HD_BACKEND[prop]) {
            Promise.resolve().then(function () { return HD_BACKEND[prop].apply(HD_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[HD_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[HD_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _hd2MakeChain(); } });

  // ---- helpers (inline · prefix hd ใน id เพื่อกันชน) ----
  const ICONS = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('hd2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'hd2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.hd2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('hd-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'hd-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'hd-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'hd-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม holiday_manager.html (ลอกทั้งดุ้น) =====
     scope ใต้ #hd กันชน id (helper getById) · document.getElementById เดิม → getById
     ==================================================================== */
  const _hdRoot = document.getElementById('hd');
  function $id(id) { return _hdRoot ? _hdRoot.querySelector('#' + id) : document.getElementById(id); }
  // shim document ภายใน scope: getElementById ค้นใน #hd ก่อน fallback global (เผื่อ toast/help ที่อยู่ body)
  const document_ = {
    getElementById: function (id) { return $id(id) || document.getElementById(id); },
    createElement: function (t) { return document.createElement(t); },
    querySelectorAll: function (s) { return _hdRoot ? _hdRoot.querySelectorAll(s) : document.querySelectorAll(s); },
    get body() { return document.body; },
  };

  let currentData = null;
  let currentView = 'list';
  let monthCursor = null; // { year, month } 1-12

  const HELP = {
    title: 'Holiday Manager — จัดการวันหยุด',
    subtitle: '00c_Branch_Holidays · per role + per branch',
    intro: 'จัดการวันหยุดประจำปี — กำหนดได้ว่า "หลังบ้าน" กับ "หน้าบ้าน" ต้องหยุดไหม (ไม่เหมือนกัน)',
    sections: [
      { title: 'ประเภทวันหยุด 4 แบบ', items: [
        '<strong>Public</strong> (เขียว) — วันหยุดราชการ (ครม. ประกาศ)',
        '<strong>Company</strong> (ม่วง) — บริษัทกำหนดเอง (เช่น วันก่อตั้ง)',
        '<strong>Branch-specific</strong> (ส้ม) — เฉพาะสาขา (เช่น ปิดซ่อม)',
        '<strong>Religious</strong> (น้ำเงิน) — วันสำคัญทางศาสนา',
      ]},
      { title: 'หลังบ้าน vs หน้าบ้าน', items: [
        '<strong>หลังบ้าน หยุด + หน้าบ้าน เปิด</strong> — คลินิกยังเปิด พนง.หน้าบ้านสลับเวรเอาวันหยุดอีกวัน (วันหยุดราชการทั่วไป)',
        '<strong>ทั้ง 2 ฝั่งหยุด</strong> — ทุกคนหยุด (วันก่อตั้งบริษัท)',
        'ระบบจะ <code>_calculateDays</code> ตามบทบาทพนักงาน — frontline หรือ office',
      ]},
      { title: 'การใช้งาน', items: [
        'List view — ดูเป็นกลุ่มเดือน · Year view — มินิปฏิทินทั้งปี',
        'Filter ปี + สาขา + ประเภท',
        'กด "Seed มาตรฐาน" เพื่อใส่ 16 วันหยุดราชการของปีนั้น',
      ]},
      { type: 'warn', title: 'ระวัง', items: [
        'วันสำคัญทางศาสนา (มาฆ/วิสาข/อาสาฬห/เข้าพรรษา) เปลี่ยนทุกปี — ระบบ seed ไม่ใส่ให้',
        'ตรวจประกาศ ครม. แต่ละปี เพื่อยืนยันวันชดเชย',
        'หมายเหตุ: บน dashboard นี้เป็น read-only — เพิ่ม/แก้/ลบ/seed ยังไม่พร้อม',
      ]},
    ],
  };

  // help icon
  document_.getElementById('help-btn').innerHTML = ICONS.help;

  function init() {
    google.script.run
      .withSuccessHandler(d => {
        currentData = d;
        const yearSelect = document_.getElementById('filter-year');
        const thisYear = new Date().getFullYear();
        (d.years || []).forEach(y => {
          const opt = document.createElement('option');
          opt.value = y; opt.textContent = y;
          if (y === thisYear) opt.selected = true;
          yearSelect.appendChild(opt);
        });
        const fb = document_.getElementById('filter-branch');
        const mb = document_.getElementById('m-branch');
        (d.branches || []).forEach(b => {
          const o = document.createElement('option');
          o.value = b.id; o.textContent = b.id + ' — ' + b.name;
          fb.appendChild(o);
          mb.appendChild(o.cloneNode(true));
        });
        render(d);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .holidayList({ year: new Date().getFullYear() });
  }

  function loadList() {
    const filter = {
      year: document_.getElementById('filter-year').value,
      branch_id: document_.getElementById('filter-branch').value || undefined,
      type: document_.getElementById('filter-type').value || undefined,
    };
    document_.getElementById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(render)
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .holidayList(filter);
  }

  function setView(v) {
    currentView = v;
    document_.getElementById('view-list').classList.toggle('active', v === 'list');
    document_.getElementById('view-month').classList.toggle('active', v === 'month');
    document_.getElementById('view-year').classList.toggle('active', v === 'year');
    if (v === 'month') ensureMonthCursor();
    if (currentData) render(currentData);
  }

  function ensureMonthCursor() {
    const filterYear = parseInt(document_.getElementById('filter-year').value) || new Date().getFullYear();
    const now = new Date();
    if (!monthCursor || monthCursor.year !== filterYear) {
      monthCursor = {
        year: filterYear,
        month: (filterYear === now.getFullYear()) ? (now.getMonth() + 1) : 1,
      };
    }
  }

  function resetFilters() {
    document_.getElementById('filter-year').value = new Date().getFullYear();
    document_.getElementById('filter-branch').value = '';
    document_.getElementById('filter-type').value = '';
    loadList();
  }

  function render(d) {
    if (!d) return;
    currentData = d;
    const s = d.stats || {};

    const yearVal = document_.getElementById('filter-year').value || new Date().getFullYear();
    const sub = document_.getElementById('page-subtitle');
    if (sub) sub.textContent = 'วันหยุดประจำปี ' + yearVal + ' · ' + (s.total || 0) + ' รายการ · seed default ของไทย';

    renderNextHoliday(d);

    const stripeFor = (t) => ({
      public: 'var(--c-public)', company: 'var(--c-company)',
      branch_specific: 'var(--c-branch)', religious_observance: 'var(--c-religious)',
    }[t] || 'var(--navy)');

    document_.getElementById('stats').innerHTML = [
      statCard('รวม', s.total, 'วันหยุด ปี ' + yearVal, 'var(--navy)'),
      statCard('Public', s.public, 'วันหยุดราชการ', stripeFor('public')),
      statCard('Company', s.company, 'บริษัทกำหนด', stripeFor('company')),
      statCard('Branch', s.branch_specific, 'เฉพาะสาขา', stripeFor('branch_specific')),
      statCard('Religious', s.religious, 'ทางศาสนา', stripeFor('religious_observance')),
    ].join('');

    const content = document_.getElementById('content');
    content.className = '';

    if (s.total === 0 && currentView !== 'month') {
      content.innerHTML = emptyState();
      return;
    }

    if (currentView === 'year') {
      content.innerHTML = renderYearView(d, parseInt(yearVal));
    } else if (currentView === 'month') {
      ensureMonthCursor();
      content.innerHTML = renderMonthView(d, monthCursor.year, monthCursor.month);
    } else {
      content.innerHTML = renderListView(d);
    }
  }

  function statCard(label, value, sub, color) {
    return [
      '<div class="stat">',
        '<div class="stat-stripe" style="background:' + color + '"></div>',
        '<div class="stat-label">' + label + '</div>',
        '<div class="stat-value">' + (value || 0) + '</div>',
        '<div class="stat-sub">' + sub + '</div>',
      '</div>',
    ].join('');
  }

  // resolve ว่าวันหยุดนี้สาขาไหน "หยุด" / สาขาไหน "เปิด"
  function resolveBranchStatus(h) {
    const branches = (currentData && currentData.branches) || [];
    if (h.branch_id && h.branch_id !== 'ALL') {
      const b = branches.find(x => x.id === h.branch_id);
      return [{ id: h.branch_id, name: b ? b.name : '', closed: !!(h.closes_office || h.closes_frontline) }];
    }
    return branches.map(b => ({
      id: b.id,
      name: b.name,
      closed: b.is_hq ? !!h.closes_office : !!h.closes_frontline,
    }));
  }

  function branchChips(h) {
    const list = resolveBranchStatus(h);
    if (!list.length) return '';
    const chips = list.map(b => {
      const word = b.closed ? 'หยุด' : 'เปิด';
      const title = b.id + (b.name ? ' — ' + b.name : '') + ' · ' + word;
      return '<span class="bchip ' + (b.closed ? 'bchip-closed' : 'bchip-open') + '" title="' +
        escapeAttr(title) + '"><span class="bcode">' + escapeHtml(b.id) + '</span>' + word + '</span>';
    }).join('');
    return '<div class="h-branches"><span class="h-branches-label">สาขา</span>' + chips + '</div>';
  }

  function renderListView(d) {
    const months = Object.keys(d.byMonth).sort();
    const monthNames = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const dotColor = (t) => ({
      public: 'var(--c-public)', company: 'var(--c-company)',
      branch_specific: 'var(--c-branch)', religious_observance: 'var(--c-religious)',
    }[t] || '#999');
    const typeLabels = {
      public: 'Public', company: 'Company',
      branch_specific: 'Branch-specific', religious_observance: 'Religious',
    };

    return months.map(m => {
      const [y, mm] = m.split('-');
      const items = d.byMonth[m];
      const rows = items.map(h => {
        const day = h.date.split('-')[2];
        const dayLabels = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
        const dayFull = dayLabels[new Date(h.date).getDay()];
        const officePill = h.closes_office
          ? '<span class="pill pill-closed">หยุด</span>'
          : '<span class="pill pill-open">ทำงาน</span>';
        const frontPill = h.closes_frontline
          ? '<span class="pill pill-closed">ปิด</span>'
          : '<span class="pill pill-open">เปิด</span>';
        return [
          '<div class="holiday" data-type="' + h.type + '">',
            '<div class="holiday-row">',
              '<div class="h-date-block">',
                '<div class="h-date">' + day + '</div>',
                '<div class="h-day">' + dayFull + '</div>',
              '</div>',
              '<div>',
                '<div class="h-name">' + escapeHtml(h.name) + '</div>',
                '<div class="h-meta">',
                  '<span class="h-meta-item"><span class="h-dot" style="background:' + dotColor(h.type) + '"></span>' + (typeLabels[h.type] || h.type) + '</span>',
                  '<span class="h-meta-item h-branch-mono">' + h.branch_id + '</span>',
                  h.notes ? '<span class="h-meta-item">' + escapeHtml(h.notes) + '</span>' : '',
                '</div>',
                branchChips(h),
              '</div>',
              '<div class="observe-block">',
                '<div class="observe-line"><span class="label">หลังบ้าน</span>' + officePill + '</div>',
                '<div class="observe-line"><span class="label">หน้าบ้าน</span>' + frontPill + '</div>',
              '</div>',
              '<div class="h-actions">',
                '<button class="btn btn-icon" onclick="openEdit(\'' + h.id + '\')" title="แก้ไข">' + ICONS.edit + '</button>',
                '<button class="btn btn-icon btn-icon-danger" onclick="removeHoliday(\'' + h.id + '\', \'' + escapeAttr(h.name) + '\')" title="ลบ">' + ICONS.trash + '</button>',
              '</div>',
            '</div>',
          '</div>',
        ].join('');
      }).join('');
      return [
        '<div class="month">',
          '<div class="month-header">',
            '<div class="month-icon">' + ICONS.cal + '</div>',
            '<div style="flex:1">',
              '<div class="month-title">' + monthNames[parseInt(mm)] + ' ' + y + '</div>',
              '<div class="month-sub">' + items.length + ' วันหยุด</div>',
            '</div>',
          '</div>',
          rows,
        '</div>',
      ].join('');
    }).join('');
  }

  function renderYearView(d, year) {
    const monthNamesShort = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                             'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const today = new Date();
    const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') +
      '-' + String(today.getDate()).padStart(2, '0');

    const cells = [];
    for (let m = 1; m <= 12; m++) {
      const monthKey = year + '-' + String(m).padStart(2, '0');
      const items = d.byMonth[monthKey] || [];
      const itemMap = {};
      items.forEach(h => {
        const day = parseInt(h.date.split('-')[2]);
        itemMap[day] = h;
      });

      const firstDay = new Date(year, m - 1, 1).getDay();
      const daysInMonth = new Date(year, m, 0).getDate();
      let calCells = '';
      ['อา','จ','อ','พ','พฤ','ศ','ส'].forEach(label => {
        calCells += '<div class="year-cal-head">' + label + '</div>';
      });
      for (let i = 0; i < firstDay; i++) {
        calCells += '<div class="year-cal-cell empty">.</div>';
      }
      for (let dd = 1; dd <= daysInMonth; dd++) {
        const dt = new Date(year, m - 1, dd);
        const dow = dt.getDay();
        const dateStr = year + '-' + String(m).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
        const isWeekend = (dow === 0 || dow === 6);
        const item = itemMap[dd];
        const isToday = (dateStr === todayKey);
        let classes = 'year-cal-cell';
        if (isWeekend) classes += ' weekend';
        if (item) classes += ' has-holiday';
        if (isToday) classes += ' today';
        const dataType = item ? ' data-type="' + item.type + '"' : '';
        const titleAttr = item ? ' title="' + escapeAttr(item.name) + '" onclick="openEdit(\'' + item.id + '\')"' : '';
        const cursor = item ? 'cursor:pointer' : '';
        calCells += '<div class="' + classes + '"' + dataType + titleAttr + ' style="' + cursor + '">' + dd + '</div>';
      }

      cells.push([
        '<div class="year-month">',
          '<div class="year-month-title">',
            '<span>' + monthNamesShort[m] + '</span>',
            '<span class="year-month-count">' + items.length + '</span>',
          '</div>',
          '<div class="year-cal">' + calCells + '</div>',
        '</div>',
      ].join(''));
    }
    return '<div class="year-grid">' + cells.join('') + '</div>';
  }

  const MONTH_NAMES_FULL = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
                            'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

  function renderMonthView(d, year, month) {
    const monthKey = year + '-' + String(month).padStart(2, '0');
    const items = (d.byMonth[monthKey] || []).slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    const byDay = {};
    items.forEach(h => {
      const day = parseInt(h.date.split('-')[2]);
      (byDay[day] = byDay[day] || []).push(h);
    });

    const today = new Date();
    const isThisMonth = (today.getFullYear() === year && (today.getMonth() + 1) === month);
    const firstDow = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();

    const dows = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    const head = dows.map((lbl, i) =>
      '<div class="' + (i === 0 || i === 6 ? 'we' : '') + '">' + lbl + '</div>').join('');

    let cells = '';
    for (let i = 0; i < firstDow; i++) cells += '<div class="mc-cell empty"></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const dow = new Date(year, month - 1, day).getDay();
      const isWeekend = (dow === 0 || dow === 6);
      const isToday = (isThisMonth && today.getDate() === day);
      let cls = 'mc-cell';
      if (isWeekend) cls += ' weekend';
      if (isToday) cls += ' today';
      const chips = (byDay[day] || []).map(h => {
        const branch = (h.branch_id && h.branch_id !== 'ALL')
          ? '<div class="mc-chip-branch">' + escapeHtml(h.branch_id) + '</div>' : '';
        return '<div class="mc-chip" data-type="' + h.type + '" title="' + escapeAttr(h.name) +
          '" onclick="openEdit(\'' + h.id + '\')">' + escapeHtml(h.name) + branch + '</div>';
      }).join('');
      cells += '<div class="' + cls + '"><div class="mc-daynum">' + day + '</div>' + chips + '</div>';
    }

    const legendDot = (c) => '<span class="month-legend-dot" style="background:' + c + '"></span>';
    const legend = [
      '<span class="month-legend-item">' + legendDot('var(--c-public)') + 'Public</span>',
      '<span class="month-legend-item">' + legendDot('var(--c-company)') + 'Company</span>',
      '<span class="month-legend-item">' + legendDot('var(--c-branch)') + 'Branch</span>',
      '<span class="month-legend-item">' + legendDot('var(--c-religious)') + 'Religious</span>',
    ].join('');

    const chevL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
    const chevR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

    return [
      '<div class="month-view-bar">',
        '<div class="month-nav">',
          '<button class="month-nav-btn" onclick="monthNav(-1)" title="เดือนก่อนหน้า">' + chevL + '</button>',
          '<span class="month-nav-title">' + MONTH_NAMES_FULL[month] + ' ' + (year + 543) + '</span>',
          '<button class="month-nav-btn" onclick="monthNav(1)" title="เดือนถัดไป">' + chevR + '</button>',
          '<button class="btn btn-sm" onclick="monthToday()" style="margin-left:6px">วันนี้</button>',
        '</div>',
        '<div class="month-legend">' + legend + '</div>',
      '</div>',
      '<div class="month-cal">',
        '<div class="month-cal-head">' + head + '</div>',
        '<div class="month-cal-grid">' + cells + '</div>',
      '</div>',
      items.length === 0
        ? '<div style="text-align:center;padding:14px;color:var(--text-faint);font-size:12px">ไม่มีวันหยุดในเดือนนี้</div>'
        : '',
    ].join('');
  }

  function monthNav(delta) {
    ensureMonthCursor();
    let m = monthCursor.month + delta;
    let y = monthCursor.year;
    if (m < 1) { m = 12; y--; }
    else if (m > 12) { m = 1; y++; }
    monthCursor = { year: y, month: m };
    _applyMonthYear(y);
  }

  function monthToday() {
    const now = new Date();
    monthCursor = { year: now.getFullYear(), month: now.getMonth() + 1 };
    _applyMonthYear(now.getFullYear());
  }

  function _applyMonthYear(year) {
    const sel = document_.getElementById('filter-year');
    if (parseInt(sel.value) !== year) {
      if (!Array.from(sel.options).some(o => parseInt(o.value) === year)) {
        const opt = document.createElement('option');
        opt.value = year; opt.textContent = year;
        sel.appendChild(opt);
      }
      sel.value = year;
      loadList();
    } else if (currentData) {
      render(currentData);
    }
  }

  function emptyState() {
    return [
      '<div class="empty">',
        '<div class="empty-icon">' + ICONS.cal + '</div>',
        '<div class="empty-title">ไม่มีวันหยุดในช่วงนี้</div>',
        '<div class="empty-sub">เพิ่มวันหยุดใหม่ หรือ Seed มาตรฐาน 16 วันราชการ</div>',
      '</div>',
    ].join('');
  }

  function presetByType() {
    const t = document_.getElementById('m-type').value;
    const office = document_.getElementById('m-closes-office');
    const front = document_.getElementById('m-closes-frontline');
    if (t === 'public' || t === 'religious_observance') {
      office.checked = true; front.checked = false;
    } else if (t === 'company' || t === 'branch_specific') {
      office.checked = true; front.checked = true;
    }
  }

  function openAdd() {
    document_.getElementById('modal-title').textContent = 'เพิ่มวันหยุด';
    document_.getElementById('m-id').value = '';
    document_.getElementById('m-date').value = '';
    document_.getElementById('m-name').value = '';
    document_.getElementById('m-type').value = 'public';
    document_.getElementById('m-branch').value = 'ALL';
    document_.getElementById('m-recurring').value = 'yearly';
    document_.getElementById('m-is-paid').value = 'true';
    document_.getElementById('m-substitute-for').value = '';
    document_.getElementById('m-notes').value = '';
    presetByType();
    document_.getElementById('modal-bg').classList.add('active');
  }

  function openEdit(id) {
    let found = null;
    Object.values(currentData.byMonth).forEach(arr => {
      const m = arr.find(x => x.id === id);
      if (m) found = m;
    });
    if (!found) { showToast('ไม่พบวันหยุด', 'error'); return; }
    document_.getElementById('modal-title').textContent = 'แก้ไขวันหยุด';
    document_.getElementById('m-id').value = found.id;
    document_.getElementById('m-date').value = found.date;
    document_.getElementById('m-name').value = found.name;
    document_.getElementById('m-type').value = found.type;
    document_.getElementById('m-branch').value = found.branch_id;
    document_.getElementById('m-recurring').value = found.recurring;
    document_.getElementById('m-is-paid').value = found.is_paid ? 'true' : 'false';
    document_.getElementById('m-substitute-for').value = found.substitute_for || '';
    document_.getElementById('m-notes').value = found.notes;
    document_.getElementById('m-closes-office').checked = found.closes_office;
    document_.getElementById('m-closes-frontline').checked = found.closes_frontline;
    document_.getElementById('modal-bg').classList.add('active');
  }

  function closeModal() {
    document_.getElementById('modal-bg').classList.remove('active');
  }

  function saveHoliday() {
    const id = document_.getElementById('m-id').value;
    const payload = {
      holiday_date: document_.getElementById('m-date').value,
      name: document_.getElementById('m-name').value.trim(),
      type: document_.getElementById('m-type').value,
      branch_id: document_.getElementById('m-branch').value,
      recurring: document_.getElementById('m-recurring').value,
      is_paid: document_.getElementById('m-is-paid').value === 'true',
      closes_office: document_.getElementById('m-closes-office').checked,
      closes_frontline: document_.getElementById('m-closes-frontline').checked,
      substitute_for: document_.getElementById('m-substitute-for').value.trim(),
      notes: document_.getElementById('m-notes').value.trim(),
    };
    if (!payload.holiday_date || !payload.name) {
      showToast('กรุณากรอกวันที่และชื่อ', 'error'); return;
    }
    document_.getElementById('save-btn').disabled = true;
    if (id) {
      google.script.run
        .withSuccessHandler(r => onSaveDone(r, 'แก้ไขแล้ว'))
        .withFailureHandler(onSaveErr)
        .holidayUpdate(id, payload);
    } else {
      google.script.run
        .withSuccessHandler(r => onSaveDone(r, 'เพิ่มแล้ว'))
        .withFailureHandler(onSaveErr)
        .holidayAdd(payload);
    }
  }

  function onSaveDone(r, msg) {
    document_.getElementById('save-btn').disabled = false;
    if (r && r.error) { showToast(r.error, 'error'); return; }
    closeModal();
    showToast(msg, 'success');
    loadList();
  }
  function onSaveErr(e) {
    document_.getElementById('save-btn').disabled = false;
    showToast('Error: ' + e.message, 'error');
  }

  function removeHoliday(id, name) {
    if (!confirm('ลบวันหยุด "' + name + '" ?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('ลบแล้ว', 'success');
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .holidayRemove(id);
  }

  function seedYear() {
    const year = document_.getElementById('filter-year').value;
    if (!confirm('Seed วันหยุดมาตรฐาน 16 วัน สำหรับปี ' + year + ' ?\n(ที่มีอยู่แล้วจะข้ามไป)')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('เพิ่ม ' + r.added + ' / ข้าม ' + r.skipped, 'success');
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .holidaySeedPublicYear(year);
  }

  function _allHolidays(d) {
    const out = [];
    Object.values((d && d.byMonth) || {}).forEach(arr => arr.forEach(h => out.push(h)));
    return out;
  }
  function _parseDate(s) {
    const p = String(s || '').split('-');
    if (p.length !== 3) return null;
    return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]), 12, 0, 0);
  }
  function renderNextHoliday(d) {
    const box = document_.getElementById('next-holiday');
    if (!box) return;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
    const upcoming = _allHolidays(d)
      .map(h => ({ h, dt: _parseDate(h.date) }))
      .filter(x => x.dt && x.dt >= today)
      .sort((a, b) => a.dt - b.dt);
    if (!upcoming.length) { box.innerHTML = ''; return; }
    const { h, dt } = upcoming[0];
    const days = Math.round((dt - today) / 86400000);
    const dayLabels = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
    const monthShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    const dateLabel = 'วัน' + dayLabels[dt.getDay()] + ' ' + dt.getDate() + ' ' + monthShort[dt.getMonth()] + ' ' + (dt.getFullYear() + 543);
    const countLabel = days === 0 ? 'วันนี้' : (days === 1 ? 'พรุ่งนี้' : 'อีก ' + days + ' วัน');
    box.innerHTML = [
      '<div class="next-banner" data-type="' + h.type + '">',
        '<div class="next-icon">',
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>',
        '</div>',
        '<div class="next-body">',
          '<div class="next-label">วันหยุดถัดไป</div>',
          '<div class="next-name">' + escapeHtml(h.name) + '</div>',
          '<div class="next-meta">' + dateLabel + ' · ' + escapeHtml(h.branch_id) + '</div>',
        '</div>',
        '<div class="next-count"><span class="next-count-num">' + countLabel + '</span></div>',
      '</div>',
    ].join('');
  }

  function exportIcs() {
    const items = _allHolidays(currentData)
      .map(h => ({ h, dt: _parseDate(h.date) }))
      .filter(x => x.dt)
      .sort((a, b) => a.dt - b.dt);
    if (!items.length) { showToast('ไม่มีวันหยุดให้ export', 'error'); return; }
    const yearVal = document_.getElementById('filter-year').value || new Date().getFullYear();
    const pad = n => String(n).padStart(2, '0');
    const stamp = (() => {
      const n = new Date();
      return n.getUTCFullYear() + pad(n.getUTCMonth() + 1) + pad(n.getUTCDate()) + 'T' +
        pad(n.getUTCHours()) + pad(n.getUTCMinutes()) + pad(n.getUTCSeconds()) + 'Z';
    })();
    const fold = s => String(s).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Yiaoya HR//Holiday Manager//TH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:วันหยุด Yiaoya ' + yearVal];
    items.forEach(({ h, dt }) => {
      const start = dt.getFullYear() + pad(dt.getMonth() + 1) + pad(dt.getDate());
      const next = new Date(dt.getTime() + 86400000);
      const end = next.getFullYear() + pad(next.getMonth() + 1) + pad(next.getDate());
      const who = [];
      if (h.closes_office) who.push('หลังบ้านหยุด');
      if (h.closes_frontline) who.push('คลินิกปิด'); else who.push('คลินิกเปิด(สลับเวร)');
      lines.push('BEGIN:VEVENT',
        'UID:' + h.id + '@yiaoya-hr',
        'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + start,
        'DTEND;VALUE=DATE:' + end,
        'SUMMARY:' + fold(h.name),
        'DESCRIPTION:' + fold([h.type, who.join(' · '), h.notes].filter(Boolean).join(' · ')),
        'TRANSP:TRANSPARENT',
        'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'yiaoya-holidays-' + yearVal + '.ics';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('ดาวน์โหลด .ics แล้ว (' + items.length + ' วัน)', 'success');
  }

  function copyPrevYear() {
    const year = parseInt(document_.getElementById('filter-year').value);
    if (!year) { showToast('เลือกปีก่อน', 'error'); return; }
    const from = year - 1;
    if (!confirm('คัดลอกวันหยุดทั้งหมดจากปี ' + from + ' มาปี ' + year + ' ?\n(วันที่มีอยู่แล้วจะข้ามไป · เลื่อนปีให้อัตโนมัติ)')) return;
    showToast('กำลังคัดลอก...', '');
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('คัดลอก ' + r.added + ' / ข้าม ' + r.skipped + ' จากปี ' + from, 'success');
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .holidayCopyYear(from, year);
  }

  function openRecurring() {
    const yearSel = document_.getElementById('rec-year');
    yearSel.innerHTML = document_.getElementById('filter-year').innerHTML;
    yearSel.value = document_.getElementById('filter-year').value || new Date().getFullYear();

    const brSel = document_.getElementById('rec-branch');
    brSel.innerHTML = '<option value="ALL">ALL — ทุกสาขา</option>';
    if (currentData && currentData.branches) {
      currentData.branches.forEach(b => {
        const o = document.createElement('option');
        o.value = b.id; o.textContent = b.id + ' — ' + b.name;
        brSel.appendChild(o);
      });
    }
    document_.getElementById('rec-name').value = '';
    document_.getElementById('rec-closes-office').checked = true;
    document_.getElementById('rec-closes-frontline').checked = true;
    document_.getElementById('rec-is-paid').value = 'true';
    updateRecPreview();
    ['rec-nth', 'rec-weekday', 'rec-year'].forEach(id =>
      document_.getElementById(id).onchange = updateRecPreview);
    document_.getElementById('rec-save-btn').disabled = false;
    document_.getElementById('rec-modal-bg').classList.add('active');
  }

  function closeRecurring() {
    document_.getElementById('rec-modal-bg').classList.remove('active');
  }

  function updateRecPreview() {
    const nthMap = { '1': 'ที่ 1', '2': 'ที่ 2', '3': 'ที่ 3', '4': 'ที่ 4', '5': 'ที่ 5', '-1': 'สุดท้าย' };
    const wdMap = { '0': 'อาทิตย์', '1': 'จันทร์', '2': 'อังคาร', '3': 'พุธ', '4': 'พฤหัสบดี', '5': 'ศุกร์', '6': 'เสาร์' };
    const nth = document_.getElementById('rec-nth').value;
    const wd = document_.getElementById('rec-weekday').value;
    const yr = document_.getElementById('rec-year').value;
    document_.getElementById('rec-preview').textContent =
      'จะสร้างวันหยุด: ' + wdMap[wd] + 'สัปดาห์' + nthMap[nth] + ' ของทุกเดือน ปี ' + yr + ' (สูงสุด 12 วัน)';
  }

  function saveRecurring() {
    const name = document_.getElementById('rec-name').value.trim();
    if (!name) { showToast('กรุณากรอกชื่อวันหยุด', 'error'); return; }
    const input = {
      branch_id: document_.getElementById('rec-branch').value,
      weekday: parseInt(document_.getElementById('rec-weekday').value, 10),
      nth: parseInt(document_.getElementById('rec-nth').value, 10),
      year: parseInt(document_.getElementById('rec-year').value, 10),
      name: name,
      closes_office: document_.getElementById('rec-closes-office').checked,
      closes_frontline: document_.getElementById('rec-closes-frontline').checked,
      is_paid: document_.getElementById('rec-is-paid').value === 'true',
    };
    document_.getElementById('rec-save-btn').disabled = true;
    showToast('กำลังสร้าง...', '');
    google.script.run
      .withSuccessHandler(r => {
        document_.getElementById('rec-save-btn').disabled = false;
        if (r && r.error) { showToast(r.error, 'error'); return; }
        closeRecurring();
        showToast(r.summary || ('สร้าง ' + r.added + ' วัน'), 'success');
        loadList();
      })
      .withFailureHandler(e => {
        document_.getElementById('rec-save-btn').disabled = false;
        showToast('Error: ' + e.message, 'error');
      })
      .holidayAddRecurring(input);
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList, setView, resetFilters,
    presetByType, openAdd, openEdit, closeModal, saveHoliday, removeHoliday,
    seedYear, exportIcs, copyPrevYear,
    openRecurring, closeRecurring, updateRecPreview, saveRecurring,
    monthNav, monthToday,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  init();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountHoliday) */
if (typeof window !== 'undefined') {
  window.mountHoliday = mountHoliday;
  window.HD_BACKEND = HD_BACKEND;
}
