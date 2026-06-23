// _ported/calendar.js — FULL native port of master_calendar.html (Yiaoya HR · ปฏิทินรวม)
// ลอกทั้งดุ้น: month / week / list views + day modal + settings (Google Cal) modal
//   CSS เดิม (<style> หน้า master_calendar) prefix #cal ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ mountCalendar() · google.script.run = shim → CAL_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare (ในนี้ใช้ตัวแปร cal/CAL_ ล้วน)
// fn ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน mountCalendar
//
// backend (CAL_BACKEND):
//   events บนปฏิทิน = รวมจาก hr_list?type=leave.updated (ลาพนักงาน → layer 'leaves')
//                      + hr_list?type=task.updated (งาน/event → layer 'events' · อาจว่าง)
//   masterCalendarGetEvents(opts) → { ok, events:[{layer,start,end,title,meta}], layerCounts, today, branches }
//   masterCalendarGetSettings / masterCalendarSaveSelection → stub (Google Cal sync เขียนกลับไม่ได้)

/* ============================================================
   CAL_BACKEND — map google.script.run → Supabase (events table ผ่าน edge fn hr_list)
   คืน shape เดียวกับที่ JS หน้าเดิมคาด (อ่านจาก onEventsLoaded / renderMonth / openDay)
   ============================================================ */

// ---- helpers ----
function cal2ToBool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
// ดึง array จาก response (รองรับ items/rows/events หรือ array ตรง ๆ)
function cal2RowsOf(res) {
  var data = (res && res.data) || res || {};
  if (Array.isArray(data)) return data;
  return data.items || data.rows || data.events || [];
}
// payload ของ event (latestByEntity คืน payload ตรง ๆ; เผื่อ wrap ใน {payload})
function cal2Payload(r) {
  if (!r) return {};
  return r.payload || r;
}
// แปลงค่าเป็น ISO yyyy-mm-dd (ตัดเวลา/เผื่อรูปแบบ datetime)
function cal2Iso(v) {
  if (!v) return '';
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    var y = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + mo + '-' + dd;
  }
  return '';
}
function cal2TodayIso() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ป้ายประเภทลา (ไทย) สำหรับ meta.leave_type_label
var CAL_LEAVE_LABELS = {
  sick: 'ลาป่วย', annual: 'ลาพักร้อน', personal: 'ลากิจ', vacation: 'ลาพักร้อน',
  maternity: 'ลาคลอด', ordination: 'ลาบวช', military: 'ลาทหาร', unpaid: 'ลาไม่รับเงิน',
  other: 'อื่น ๆ',
};
var CAL_STATUS_LABELS = {
  pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', auto_approved: 'อนุมัติอัตโนมัติ',
  rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก',
};

// map leave payload → event ของปฏิทิน (layer 'leaves')
function cal2MapLeave(p) {
  p = cal2Payload(p);
  var start = cal2Iso(p.start_date || p.start || p.date);
  if (!start) return null;
  var end = cal2Iso(p.end_date || p.end) || start;
  var name = p.employee_name || p.employee_id || 'พนักงาน';
  var lt = String(p.leave_type || 'other').toLowerCase();
  var ltLabel = CAL_LEAVE_LABELS[lt] || lt || 'ลา';
  var status = String(p.status || 'pending').toLowerCase();
  // นับจำนวนวัน (รวมปลายทาง)
  var days = 1;
  try {
    var ds = new Date(start + 'T00:00:00'), de = new Date(end + 'T00:00:00');
    days = Math.max(1, Math.round((de - ds) / 86400000) + 1);
  } catch (e) { days = 1; }
  return {
    layer: 'leaves',
    start: start,
    end: end,
    title: name + ' · ' + ltLabel,
    meta: {
      branch_id: p.branch_id || '',
      branch_name: p.branch_id || '',
      leave_type: lt,
      leave_type_label: ltLabel,
      status: status,
      status_label: CAL_STATUS_LABELS[status] || status,
      days: days,
      employee_id: p.employee_id || '',
    },
  };
}

// map task/event payload → event ของปฏิทิน (layer 'events')
function cal2MapTask(p) {
  p = cal2Payload(p);
  var start = cal2Iso(p.start_date || p.start || p.due_date || p.date || p.event_date);
  if (!start) return null;
  var end = cal2Iso(p.end_date || p.end) || start;
  var title = p.title || p.name || p.task_name || p.subject || 'งาน';
  return {
    layer: 'events',
    start: start,
    end: end,
    title: title,
    meta: {
      branch_id: p.branch_id || '',
      branch_name: p.branch_id || '',
      location: p.location || '',
      status: String(p.status || '').toLowerCase(),
    },
  };
}

// derive รายชื่อสาขาจาก events (id + name) — backend ไม่มี lookup สาขาเต็ม
function cal2BranchesFromEvents(events) {
  var seen = {}, out = [];
  (events || []).forEach(function (ev) {
    var id = (ev.meta && ev.meta.branch_id) || '';
    id = String(id).trim();
    if (!id || seen[id]) return;
    seen[id] = 1;
    out.push({ id: id, name: (ev.meta && ev.meta.branch_name) || id });
  });
  out.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  return out;
}

// นับ events ต่อ layer (ทั้งชุด · ก่อน filter เดือน) — สำหรับ chip count
function cal2LayerCounts(events) {
  var c = {};
  (events || []).forEach(function (ev) { c[ev.layer] = (c[ev.layer] || 0) + 1; });
  return c;
}

var _calNotReadyShown = {};
function cal2NotReady(feature) {
  if (_calNotReadyShown[feature]) return;
  _calNotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.calToast) window.calToast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

var CAL_BACKEND = {
  // role gate — dashboard user = owner เต็มสิทธิ์
  whoami: function () {
    return Promise.resolve({ ok: true, is_owner: true });
  },

  // events บนปฏิทิน — รวม leave + task ตาม layer ที่เปิด · filter เดือน/สาขา ฝั่ง client
  masterCalendarGetEvents: function (opts) {
    opts = opts || {};
    var layersOn = opts.layers || [];
    var wantLeaves = layersOn.indexOf('leaves') >= 0;
    var wantEvents = layersOn.indexOf('events') >= 0;

    var jobs = [];
    // ลา (342 · แสดงวันลาบนปฏิทิน)
    jobs.push(
      wantLeaves
        ? sb.functions.invoke('hr_list?type=leave.updated')
            .then(function (res) { return cal2RowsOf(res).map(cal2MapLeave).filter(Boolean); })
            .catch(function () { return []; })
        : Promise.resolve([])
    );
    // งาน / event บริษัท (อาจว่าง)
    jobs.push(
      wantEvents
        ? sb.functions.invoke('hr_list?type=task.updated')
            .then(function (res) { return cal2RowsOf(res).map(cal2MapTask).filter(Boolean); })
            .catch(function () { return []; })
        : Promise.resolve([])
    );

    return Promise.all(jobs).then(function (parts) {
      var events = parts[0].concat(parts[1]);
      // filter สาขา (branch_ids = null => ทุกสาขา)
      var bids = opts.branch_ids;
      if (bids && bids.length) {
        events = events.filter(function (ev) {
          var id = (ev.meta && ev.meta.branch_id) || '';
          return bids.indexOf(id) >= 0;
        });
      }
      return {
        ok: true,
        events: events,
        layerCounts: cal2LayerCounts(events),
        today: cal2TodayIso(),
        branches: cal2BranchesFromEvents(events),
      };
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || 'โหลดปฏิทินไม่สำเร็จ', events: [], branches: [], layerCounts: {}, today: cal2TodayIso() };
    });
  },

  // Google Calendar settings — read ปฏิทินจริงไม่ได้ + เขียนกลับไม่ได้ → stub (ไม่ error · ปฏิทินว่าง)
  masterCalendarGetSettings: function () {
    return Promise.resolve({ ok: true, calendars: [], selected: [] });
  },
  masterCalendarSaveSelection: function () {
    cal2NotReady('บันทึกตั้งค่า Google Calendar');
    return Promise.resolve({ ok: true });
  },
};

/* ============================================================
   mountCalendar — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountCalendar() {
  var wrap = document.getElementById('wrap-calendar');
  if (!wrap) return;

  var CSS = CAL_CSS();
  var MARKUP = CAL_MARKUP();
  wrap.innerHTML = '<style>' + CSS + '</style><div id="cal">' + MARKUP + '</div>';

  // รัน JS ของหน้าเดิม (closure scope · google = shim) → ผูก fn ที่ inline onclick ต้องใช้ ลง window
  CAL_RUN_PAGE_JS();
}

/* ===== CSS เดิม (<style> master_calendar) · prefix ทุก selector ด้วย #cal =====
   ตัด .app-shell / .main-area / sidebar / breadcrumb shell ออก (dashboard มี shell แล้ว)
   คง class เดิมทั้งหมด · tokens layer-* ครบ */
function CAL_CSS() {
  return [
    // tokens (รวม layer colors)
    '#cal{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-light:#E6F7F5;--teal-dark:#0F766E;--bg:#F8FAFC;--surface:#FFFFFF;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;--layer-holiday:#0F6E56;--layer-holiday-bg:#E1F5EE;--layer-leave:#854F0B;--layer-leave-bg:#FAEEDA;--layer-event:#3C3489;--layer-event-bg:#EEEDFE;--layer-gcal:#1E40AF;--layer-gcal-bg:#DBEAFE;--layer-birthday:#BE185D;--layer-birthday-bg:#FCE7F3;--layer-fo-dayoff:#0E7490;--layer-fo-dayoff-bg:#CFFAFE;color:var(--text);font-size:13px;line-height:1.5}',
    '#cal *{box-sizing:border-box}',
    '#cal button,#cal input,#cal select{font-family:inherit;font-size:inherit}',

    // ===== page header =====
    '#cal .page-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap;gap:10px}',
    '#cal .page-title{font-size:18px;font-weight:600;color:var(--text)}',
    '#cal .page-sub{font-size:12px;color:var(--text-muted);margin-top:2px}',
    '#cal .page-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',

    // ===== buttons =====
    '#cal .btn{height:30px;padding:0 12px;background:var(--surface);border:1px solid var(--border-strong);border-radius:6px;font-size:12px;font-weight:500;color:var(--text);cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:all .15s}',
    '#cal .btn:hover{border-color:var(--navy)}',
    '#cal .btn svg{width:13px;height:13px}',
    '#cal .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#cal .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#cal .btn-ghost{background:transparent;border-color:transparent;color:var(--text-muted)}',
    '#cal .btn-ghost:hover{background:#F1F5F9;border-color:transparent}',
    '#cal .btn-icon{width:30px;padding:0;display:inline-flex;align-items:center;justify-content:center}',

    // ===== summary stat bar =====
    '#cal .summary-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;margin-bottom:14px}',
    '#cal .stat-card{position:relative;overflow:hidden;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px 10px 14px}',
    '#cal .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#cal .stat-card.s-holidays::before{background:var(--layer-holiday)}',
    '#cal .stat-card.s-leaves::before{background:var(--layer-leave)}',
    '#cal .stat-card.s-fo_dayoff::before{background:var(--layer-fo-dayoff)}',
    '#cal .stat-card.s-events::before{background:var(--layer-event)}',
    '#cal .stat-card.s-today::before{background:var(--navy)}',
    '#cal .stat-label{font-size:11px;color:var(--text-muted)}',
    '#cal .stat-value{font-size:22px;font-weight:600;line-height:1.2;color:var(--navy)}',
    '#cal .stat-card.s-holidays .stat-value{color:var(--layer-holiday)}',
    '#cal .stat-card.s-leaves .stat-value{color:var(--layer-leave)}',
    '#cal .stat-card.s-fo_dayoff .stat-value{color:var(--layer-fo-dayoff)}',
    '#cal .stat-card.s-events .stat-value{color:var(--layer-event)}',

    // ===== layer toggle chips =====
    '#cal .layer-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;align-items:center}',
    '#cal .chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:16px;font-size:11px;border:1px solid var(--border);background:var(--surface);cursor:pointer;user-select:none}',
    '#cal .chip input[type=checkbox]{width:12px;height:12px;margin:0;cursor:pointer}',
    '#cal .chip-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}',
    '#cal .chip.active{border-color:currentColor}',
    '#cal .chip.layer-holidays.active{background:var(--layer-holiday-bg);color:var(--layer-holiday)}',
    '#cal .chip.layer-leaves.active{background:var(--layer-leave-bg);color:var(--layer-leave)}',
    '#cal .chip.layer-events.active{background:var(--layer-event-bg);color:var(--layer-event)}',
    '#cal .chip.layer-gcal.active{background:var(--layer-gcal-bg);color:var(--layer-gcal)}',
    '#cal .chip.layer-birthdays.active{background:var(--layer-birthday-bg);color:var(--layer-birthday)}',
    '#cal .chip.layer-fo_dayoff.active{background:var(--layer-fo-dayoff-bg);color:var(--layer-fo-dayoff)}',
    '#cal .chip-count{font-size:10px;opacity:.75}',

    // ===== branch multi-select bar =====
    '#cal .branch-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:9px 12px;margin-bottom:12px}',
    '#cal .branch-bar-label{font-size:11px;color:var(--text-muted);display:inline-flex;align-items:center;gap:5px;flex-shrink:0}',
    '#cal .branch-bar-label svg{width:13px;height:13px}',
    '#cal .branch-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '#cal .branch-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:14px;font-size:11px;border:1px solid var(--border);background:var(--surface);color:var(--text);cursor:pointer;user-select:none}',
    '#cal .branch-chip input[type=checkbox]{width:12px;height:12px;margin:0;pointer-events:none}',
    '#cal .branch-chip.active{border-color:var(--teal);background:var(--teal-light);color:var(--teal-dark)}',
    '#cal .branch-chip.all{font-weight:500}',
    '#cal .branch-chip.all.active{background:var(--navy);border-color:var(--navy);color:#fff}',

    '#cal .view-switch{display:inline-flex;gap:0;background:#F1F5F9;padding:2px;border-radius:6px;margin-left:auto}',
    '#cal .view-btn{height:24px;padding:0 12px;font-size:11px;font-weight:500;background:transparent;border:none;color:var(--text-muted);cursor:pointer;border-radius:4px}',
    '#cal .view-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',

    // ===== month nav =====
    '#cal .month-nav{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
    '#cal .month-label{font-size:14px;font-weight:600;color:var(--navy);min-width:150px}',

    // ===== calendar grid (month) =====
    '#cal .cal-grid{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--surface)}',
    '#cal .cal-dow{display:grid;grid-template-columns:repeat(7,1fr);background:#F1F5F9;border-bottom:1px solid var(--border)}',
    '#cal .cal-dow>div{padding:8px 6px;text-align:center;font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#cal .cal-week{display:grid;grid-template-columns:repeat(7,1fr);border-bottom:1px solid var(--border)}',
    '#cal .cal-week:last-child{border-bottom:none}',
    '#cal .cal-cell{min-height:110px;padding:5px 6px;border-right:1px solid var(--border);position:relative;overflow:hidden;cursor:pointer;transition:background .1s}',
    '#cal .cal-cell:last-child{border-right:none}',
    '#cal .cal-cell:hover{background:var(--teal-light)}',
    '#cal .cal-cell.outside{background:#FAFBFC;color:var(--text-faint)}',
    '#cal .cal-cell.is-weekend:not(.outside){background:#FCFDFE}',
    '#cal .cal-cell.today{background:var(--teal-light)}',
    '#cal .cal-cell.today .cal-day-num{background:var(--navy);color:#fff;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}',
    '#cal .cal-day-num{font-size:12px;font-weight:500;display:inline-block;min-width:22px}',
    '#cal .cal-events{margin-top:4px;display:flex;flex-direction:column;gap:2px}',
    '#cal .cal-event{font-size:10px;padding:2px 5px;border-radius:3px;border-left:2px solid;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;display:flex;align-items:center;gap:4px}',
    '#cal .cal-event .ev-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}',
    '#cal .cal-event.layer-holidays{background:var(--layer-holiday-bg);color:var(--layer-holiday);border-left-color:var(--layer-holiday)}',
    '#cal .cal-event.layer-leaves{background:var(--layer-leave-bg);color:var(--layer-leave);border-left-color:var(--layer-leave)}',
    '#cal .cal-event.layer-events{background:var(--layer-event-bg);color:var(--layer-event);border-left-color:var(--layer-event)}',
    '#cal .cal-event.layer-gcal{background:var(--layer-gcal-bg);color:var(--layer-gcal);border-left-color:var(--layer-gcal)}',
    '#cal .cal-event.layer-birthdays{background:var(--layer-birthday-bg);color:var(--layer-birthday);border-left-color:var(--layer-birthday)}',
    '#cal .cal-event.layer-fo_dayoff{background:var(--layer-fo-dayoff-bg);color:var(--layer-fo-dayoff);border-left-color:var(--layer-fo-dayoff)}',
    '#cal .cal-event-more{font-size:9px;color:var(--text-muted);padding:1px 5px;font-style:italic}',

    // ===== week view =====
    '#cal .week-grid{border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--surface)}',
    '#cal .week-head{display:grid;grid-template-columns:repeat(7,1fr);background:#F1F5F9;border-bottom:1px solid var(--border)}',
    '#cal .week-head>div{padding:8px 6px;text-align:center;font-size:10px;color:var(--text-muted)}',
    '#cal .week-head .wh-num{font-size:14px;font-weight:600;color:var(--text);margin-top:2px}',
    '#cal .week-head .wh-day.today .wh-num{background:var(--navy);color:#fff;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin:2px auto 0}',
    '#cal .week-body{display:grid;grid-template-columns:repeat(7,1fr)}',
    '#cal .week-col{min-height:260px;padding:8px 6px;border-right:1px solid var(--border);display:flex;flex-direction:column;gap:4px}',
    '#cal .week-col:last-child{border-right:none}',
    '#cal .week-col.today{background:var(--teal-light)}',
    '#cal .week-col .empty{font-size:11px;color:var(--text-faint);text-align:center;padding-top:8px}',

    // ===== list view =====
    '#cal .list-wrap{background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden}',
    '#cal .list-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #F1F5F9;cursor:pointer}',
    '#cal .list-row:last-child{border-bottom:none}',
    '#cal .list-row:hover{background:#F8FAFC}',
    '#cal .list-row.is-today{background:var(--teal-light)}',
    '#cal .list-date{width:46px;text-align:center;flex-shrink:0}',
    '#cal .list-date .ld-num{font-size:17px;font-weight:600;color:var(--navy);line-height:1}',
    '#cal .list-date .ld-dow{font-size:10px;color:var(--text-faint);margin-top:2px}',
    '#cal .list-stripe{width:3px;height:32px;border-radius:2px;flex-shrink:0}',
    '#cal .list-main{flex:1;min-width:0}',
    '#cal .list-title{font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#cal .list-title .branch-pill{margin-left:6px}',
    '#cal .list-meta{font-size:11px;color:var(--text-muted)}',
    '#cal .list-badge{font-size:10px;padding:2px 8px;border-radius:10px;flex-shrink:0}',
    '#cal .branch-pill{display:inline-block;font-size:10px;font-weight:500;padding:1px 7px;border-radius:8px;background:var(--bg);color:var(--text-muted);border:1px solid var(--border);vertical-align:middle;white-space:nowrap}',
    '#cal .list-empty,#cal .list-section{padding:14px}',
    '#cal .list-section{font-size:11px;font-weight:600;color:var(--text-muted);background:#F8FAFC;border-bottom:1px solid var(--border);padding:8px 14px}',

    // ===== modals (scope ใต้ #cal · z-index สูง) =====
    '#cal .modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;z-index:9000;align-items:center;justify-content:center;padding:20px}',
    '#cal .modal-bg.active{display:flex}',
    '#cal .modal{background:var(--surface);border-radius:12px;max-width:480px;width:100%;max-height:85vh;overflow:hidden;box-shadow:0 20px 40px rgba(0,0,0,.2);display:flex;flex-direction:column}',
    '#cal .modal-header{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
    '#cal .modal-title{font-size:15px;font-weight:600;color:var(--navy)}',
    '#cal .modal-close{width:28px;height:28px;padding:0;background:transparent;border:none;color:var(--text-muted);cursor:pointer;border-radius:4px;display:inline-flex;align-items:center;justify-content:center}',
    '#cal .modal-close:hover{background:#F1F5F9}',
    '#cal .modal-body{padding:16px 20px;overflow-y:auto}',
    '#cal .modal-footer{padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px}',
    '#cal .modal-event{padding:10px 12px;border-radius:6px;border-left:3px solid;margin-bottom:8px}',
    '#cal .modal-event-title{font-size:13px;font-weight:500}',
    '#cal .modal-event-meta{font-size:11px;color:var(--text-muted);margin-top:2px}',
    '#cal .set-note{font-size:11px;color:var(--text-muted);background:var(--info-bg);border:1px solid #BFDBFE;border-radius:6px;padding:8px 10px;margin-bottom:12px}',
    '#cal .set-row{display:flex;align-items:center;gap:9px;padding:8px 4px;border-bottom:1px solid #F1F5F9;cursor:pointer}',
    '#cal .set-row:last-child{border-bottom:none}',
    '#cal .set-row input{width:14px;height:14px}',
    '#cal .set-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}',
    '#cal .set-name{font-size:12px}',
    '#cal .set-primary{font-size:10px;color:var(--text-faint);margin-left:4px}',

    // ===== loading + empty =====
    '#cal .loading{text-align:center;padding:40px;color:var(--text-muted);font-size:13px}',
    '#cal .error-banner{padding:10px 14px;background:var(--danger-bg);color:var(--danger);border:1px solid #FCA5A5;border-radius:6px;margin-bottom:12px;font-size:12px}',

    // responsive
    '@media (max-width:768px){#cal .cal-cell{min-height:72px}#cal .cal-event{font-size:9px;padding:1px 4px}#cal .week-col{min-height:150px}}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก view/section + 2 modals · คง element id เดิม =====
   ตัด app-shell/sidebar/sheet_link/brand_footer/breadcrumb shell · ใช้ string ปกติ */
function CAL_MARKUP() {
  return ''
  // page header
  + '<div class="page-head">'
  +   '<div>'
  +     '<div class="page-title">Master Calendar</div>'
  +     '<div class="page-sub">ดูวันหยุด · ลาพนักงาน · event บริษัท · Google Calendar ในมุมมองเดียว</div>'
  +   '</div>'
  +   '<div class="page-actions">'
  +     '<button class="btn btn-icon" id="settings-btn" onclick="openSettings()" title="ตั้งค่า Google Calendar">'
  +       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
  +     '</button>'
  +     '<button class="btn btn-icon" onclick="loadEvents()" title="Refresh">'
  +       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>'
  +     '</button>'
  +   '</div>'
  + '</div>'
  // summary stat bar
  + '<div class="summary-bar" id="summary-bar"></div>'
  // layer chips
  + '<div class="layer-chips" id="layer-chips"></div>'
  // branch multi-select bar
  + '<div class="branch-bar" id="branch-bar">'
  +   '<span class="branch-bar-label">'
  +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>'
  +     'สาขา'
  +   '</span>'
  +   '<div class="branch-chips" id="branch-chips"><span style="font-size:11px;color:var(--text-faint);">กำลังโหลด...</span></div>'
  + '</div>'
  // month nav
  + '<div class="month-nav">'
  +   '<button class="btn btn-icon" onclick="navPrev()" title="ก่อนหน้า"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>'
  +   '<div class="month-label" id="month-label">—</div>'
  +   '<button class="btn btn-icon" onclick="navNext()" title="ถัดไป"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>'
  +   '<button class="btn" onclick="navToday()">วันนี้</button>'
  +   '<div class="view-switch" id="view-switch"></div>'
  + '</div>'
  // error banner
  + '<div id="error-banner" style="display:none;" class="error-banner"></div>'
  // view area
  + '<div id="view-area"><div class="loading">กำลังโหลด...</div></div>'
  // ===== Day detail modal =====
  + '<div class="modal-bg" id="day-modal-bg" onclick="if(event.target===this) closeModal()">'
  +   '<div class="modal">'
  +     '<div class="modal-header">'
  +       '<div class="modal-title" id="modal-title">รายการวันที่</div>'
  +       '<button class="modal-close" onclick="closeModal()" aria-label="ปิด"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg></button>'
  +     '</div>'
  +     '<div class="modal-body" id="modal-body"></div>'
  +   '</div>'
  + '</div>'
  // ===== Settings modal (Google Calendar) =====
  + '<div class="modal-bg" id="settings-modal-bg" onclick="if(event.target===this) closeSettings()">'
  +   '<div class="modal">'
  +     '<div class="modal-header">'
  +       '<div class="modal-title">เลือก Google Calendar ที่จะแสดง</div>'
  +       '<button class="modal-close" onclick="closeSettings()" aria-label="ปิด"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg></button>'
  +     '</div>'
  +     '<div class="modal-body" id="settings-body"><div class="loading">กำลังโหลด...</div></div>'
  +     '<div class="modal-footer">'
  +       '<button class="btn btn-ghost" onclick="closeSettings()">ยกเลิก</button>'
  +       '<button class="btn btn-primary" id="settings-save-btn" onclick="saveSettings()">บันทึก</button>'
  +     '</div>'
  +   '</div>'
  + '</div>';
}

/* ============================================================
   CAL_RUN_PAGE_JS — รัน JS หน้าเดิม (closure) · google = shim → CAL_BACKEND
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ตัวแปร/fn ภายในเป็น scope ของ closure นี้ (ไม่ชน global)
   ============================================================ */
function CAL_RUN_PAGE_JS() {

  // ---- google.script.run shim → CAL_BACKEND (async, คืน shape เดิม) ----
  function _cal2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (CAL_BACKEND[prop]) {
            Promise.resolve().then(function () { return CAL_BACKEND[prop].apply(CAL_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[CAL_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[CAL_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _cal2MakeChain(); } });

  // toast (เผื่อ stub แจ้งเตือน) — expose ให้ CAL_BACKEND เรียกผ่าน window
  function showToast(msg, type) {
    var t = document.getElementById('cal2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cal2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.calToast = showToast;

  /* ============================================================
     ===== JS หน้าเดิม (master_calendar.html v1.10.133) verbatim =====
     ปรับเฉพาะ: scope esc ใช้ตัวในนี้ (กัน redeclare global) · DOMContentLoaded init ย้ายมาเรียกตรง
     ============================================================ */

  // State
  const _state = {
    view: 'month',          // 'month' | 'week' | 'list'
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1, // 1-12
    weekStart: null,        // Date · Sunday of the displayed week (week view)
    layers: {
      holidays: true,
      leaves: true,
      events: true,
      gcal: false,    // off by default — user opts in via settings
      birthdays: false,
      fo_dayoff: true, // วันหยุดประจำเดือนทีมหน้าบ้าน
    },
    branches: [],           // [{id, name}] from server
    branchSel: {},          // { branch_id: bool }
    allBranches: true,      // true => no branch filter (show all)
    branchesInit: false,
    events: [],
    layerCounts: {},
    today: '',
    settingsCals: [],
  };

  const LAYER_DEFS = [
    { id: 'holidays',  label: 'วันหยุดราชการ',     color: '#0F6E56' },
    { id: 'leaves',    label: 'ลาพนักงาน',         color: '#854F0B' },
    { id: 'fo_dayoff', label: 'วันหยุดหน้าบ้าน',   color: '#0E7490' },
    { id: 'events',    label: 'Event บริษัท',      color: '#3C3489' },
    { id: 'gcal',      label: 'Google Cal',        color: '#1E40AF' },
    { id: 'birthdays', label: 'วันเกิด',           color: '#BE185D' },
  ];

  const VIEW_DEFS = [
    { id: 'month', label: 'Month' },
    { id: 'week',  label: 'Week' },
    { id: 'list',  label: 'List' },
  ];

  const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                     'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const TH_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                           'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const TH_DOW = ['อา','จ','อ','พ','พฤ','ศ','ส'];

  // esc ของ scope นี้ (กัน redeclare global esc)
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ===== Chips + view switch =====
  function renderChips() {
    const wrap = document.getElementById('layer-chips');
    let html = '';
    LAYER_DEFS.forEach(L => {
      const on = !!_state.layers[L.id];
      const count = _state.layerCounts[L.id] || 0;
      html += '<label class="chip layer-' + L.id + (on ? ' active' : '') + '">' +
              '<input type="checkbox"' + (on ? ' checked' : '') + ' onchange="toggleLayer(\'' + L.id + '\')" />' +
              '<span class="chip-dot" style="background:' + L.color + '"></span>' +
              '<span>' + L.label + '</span>' +
              '<span class="chip-count">(' + count + ')</span>' +
              '</label>';
    });
    wrap.innerHTML = html;
  }

  function renderViewSwitch() {
    const wrap = document.getElementById('view-switch');
    wrap.innerHTML = VIEW_DEFS.map(V =>
      '<button class="view-btn' + (_state.view === V.id ? ' active' : '') + '"' +
      ' onclick="setView(\'' + V.id + '\')">' + V.label + '</button>'
    ).join('');
  }

  function setView(v) {
    if (_state.view === v) return;
    _state.view = v;
    if (v === 'week' && !_state.weekStart) _state.weekStart = defaultWeekStart();
    renderViewSwitch();
    updateMonthLabel();
    renderView();
  }

  function toggleLayer(id) {
    _state.layers[id] = !_state.layers[id];
    loadEvents();
  }

  // ===== Branch multi-select =====
  function renderBranchChips() {
    const wrap = document.getElementById('branch-chips');
    if (!_state.branches.length) {
      wrap.innerHTML = '<span style="font-size:11px;color:var(--text-faint);">ไม่มีข้อมูลสาขา</span>';
      return;
    }
    const all = _state.allBranches;
    let html = '<label class="branch-chip all' + (all ? ' active' : '') + '" onclick="selectAllBranches()">ทุกสาขา</label>';
    _state.branches.forEach(b => {
      const on = !all && !!_state.branchSel[b.id];
      html += '<label class="branch-chip' + (on ? ' active' : '') + '" onclick="toggleBranch(\'' + esc(b.id) + '\')">' +
              '<input type="checkbox"' + (on ? ' checked' : '') + ' />' +
              esc(b.id) + ' · ' + esc(b.name) +
              '</label>';
    });
    wrap.innerHTML = html;
  }

  function selectAllBranches() {
    _state.allBranches = true;
    _state.branches.forEach(b => { _state.branchSel[b.id] = true; });
    loadEvents();
  }

  function toggleBranch(id) {
    if (_state.allBranches) {
      // First specific pick → narrow to just this branch
      _state.allBranches = false;
      _state.branches.forEach(b => { _state.branchSel[b.id] = (b.id === id); });
    } else {
      _state.branchSel[id] = !_state.branchSel[id];
      const none = _state.branches.every(b => !_state.branchSel[b.id]);
      const every = _state.branches.every(b => !!_state.branchSel[b.id]);
      if (none || every) {
        _state.allBranches = true;
        _state.branches.forEach(b => { _state.branchSel[b.id] = true; });
      }
    }
    loadEvents();
  }

  function selectedBranchIds() {
    if (_state.allBranches) return null;
    return _state.branches.filter(b => _state.branchSel[b.id]).map(b => b.id);
  }

  // ===== Navigation =====
  function navPrev() { _nav(-1); }
  function navNext() { _nav(1); }

  function _nav(delta) {
    if (_state.view === 'week') {
      const ws = _state.weekStart || defaultWeekStart();
      ws.setDate(ws.getDate() + delta * 7);
      _state.weekStart = ws;
      const mid = new Date(ws); mid.setDate(mid.getDate() + 3); // Wednesday
      _state.year = mid.getFullYear();
      _state.month = mid.getMonth() + 1;
    } else {
      _state.month += delta;
      if (_state.month > 12) { _state.month = 1; _state.year++; }
      if (_state.month < 1)  { _state.month = 12; _state.year--; }
      _state.weekStart = null; // recompute when entering week view
    }
    loadEvents();
  }

  function navToday() {
    const t = new Date();
    _state.year = t.getFullYear();
    _state.month = t.getMonth() + 1;
    _state.weekStart = sundayOf(t);
    loadEvents();
  }

  function defaultWeekStart() {
    const t = new Date();
    const inDisplayedMonth = (t.getFullYear() === _state.year && (t.getMonth() + 1) === _state.month);
    const anchor = inDisplayedMonth ? t : new Date(_state.year, _state.month - 1, 1);
    return sundayOf(anchor);
  }

  function sundayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - x.getDay());
    return x;
  }

  function updateMonthLabel() {
    const el = document.getElementById('month-label');
    if (_state.view === 'week' && _state.weekStart) {
      const s = new Date(_state.weekStart);
      const e = new Date(_state.weekStart); e.setDate(e.getDate() + 6);
      const sLab = s.getDate() + ' ' + TH_MONTHS_SHORT[s.getMonth()];
      const eLab = e.getDate() + ' ' + TH_MONTHS_SHORT[e.getMonth()] + ' ' + (e.getFullYear() + 543);
      el.textContent = sLab + ' – ' + eLab;
    } else {
      el.textContent = TH_MONTHS[_state.month - 1] + ' ' + (_state.year + 543);
    }
  }

  // ===== Data load =====
  function loadEvents() {
    updateMonthLabel();
    const layersOn = LAYER_DEFS.filter(L => _state.layers[L.id]).map(L => L.id);
    const opts = {
      year: _state.year,
      month: _state.month,
      layers: layersOn,
      branch_ids: selectedBranchIds(),  // null => all branches
    };
    document.getElementById('view-area').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    document.getElementById('error-banner').style.display = 'none';

    google.script.run
      .withSuccessHandler(onEventsLoaded)
      .withFailureHandler(onError)
      .masterCalendarGetEvents(opts);
  }

  function onEventsLoaded(res) {
    if (!res || res.ok === false) {
      onError({ message: (res && res.error) || 'ไม่สามารถโหลดข้อมูลได้' });
      return;
    }
    _state.events = res.events || [];
    _state.layerCounts = res.layerCounts || {};
    _state.today = res.today || isoOf(new Date());
    initBranches(res.branches || []);
    renderChips();
    renderViewSwitch();
    renderSummary();
    renderView();
  }

  function initBranches(branches) {
    _state.branches = branches;
    if (!_state.branchesInit) {
      branches.forEach(b => { _state.branchSel[b.id] = true; });
      _state.branchesInit = true;
    } else {
      // keep any newly-appeared branch selected when in "all" mode
      branches.forEach(b => {
        if (!(b.id in _state.branchSel)) _state.branchSel[b.id] = _state.allBranches;
      });
    }
    renderBranchChips();
  }

  function onError(e) {
    const banner = document.getElementById('error-banner');
    banner.style.display = 'block';
    banner.textContent = 'โหลดไม่สำเร็จ: ' + (e.message || 'unknown');
    document.getElementById('view-area').innerHTML = '';
  }

  // ===== Summary bar =====
  function monthBounds() {
    const start = isoOf(new Date(_state.year, _state.month - 1, 1));
    const end = isoOf(new Date(_state.year, _state.month, 0));
    return { start: start, end: end };
  }

  function countInMonth(layer) {
    const b = monthBounds();
    // count events whose start falls within the displayed month (avoids spillover dup)
    return (_state.events || []).filter(ev =>
      ev.layer === layer && ev.start >= b.start && ev.start <= b.end
    ).length;
  }

  function renderSummary() {
    // นับ "ใครหยุดวันนี้" รวมทั้งใบลา + วันหยุดประจำเดือนหน้าบ้าน
    const offToday = (_state.events || []).filter(ev => {
      if (ev.layer !== 'leaves' && ev.layer !== 'fo_dayoff') return false;
      const s = ev.start, e = ev.end || ev.start;
      return _state.today && s <= _state.today && _state.today <= e;
    }).length;

    const cards = [
      { cls: 's-holidays',  label: 'วันหยุดเดือนนี้',   value: countInMonth('holidays') },
      { cls: 's-leaves',    label: 'ลาพนักงาน',        value: countInMonth('leaves') },
      { cls: 's-fo_dayoff', label: 'หยุดหน้าบ้าน',     value: countInMonth('fo_dayoff') },
      { cls: 's-events',    label: 'Event บริษัท',     value: countInMonth('events') },
      { cls: 's-today',     label: 'ใครหยุดวันนี้',    value: offToday },
    ];
    document.getElementById('summary-bar').innerHTML = cards.map(c =>
      '<div class="stat-card ' + c.cls + '">' +
        '<div class="stat-label">' + c.label + '</div>' +
        '<div class="stat-value">' + c.value + '</div>' +
      '</div>'
    ).join('');
  }

  // ===== View dispatch =====
  function renderView() {
    if (_state.view === 'week') return renderWeek();
    if (_state.view === 'list') return renderList();
    return renderMonth();
  }

  function eventsByDate() {
    const byDate = {};
    (_state.events || []).forEach(ev => {
      const s = ev.start; const e = ev.end || ev.start;
      if (!s) return;
      let d = new Date(s + 'T00:00:00');
      const end = new Date(e + 'T00:00:00');
      let safety = 0;
      while (d <= end && safety < 90) {
        const k = isoOf(d);
        (byDate[k] = byDate[k] || []).push(ev);
        d.setDate(d.getDate() + 1);
        safety++;
      }
    });
    return byDate;
  }

  function eventChipHtml(ev) {
    const def = LAYER_DEFS.find(L => L.id === ev.layer) || {};
    return '<div class="cal-event layer-' + esc(ev.layer) + '" title="' + esc(ev.title) + '">' +
             '<span class="ev-dot" style="background:' + (def.color || '#64748B') + '"></span>' +
             '<span style="overflow:hidden;text-overflow:ellipsis;">' + esc(ev.title) + '</span>' +
           '</div>';
  }

  // ===== Month view (dynamic 5/6 rows) =====
  function renderMonth() {
    const year = _state.year, month = _state.month;
    const firstOfMonth = new Date(year, month - 1, 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay()); // back to Sunday
    const daysInMonth = new Date(year, month, 0).getDate();
    const weeks = Math.ceil((firstOfMonth.getDay() + daysInMonth) / 7); // 4..6

    const byDate = eventsByDate();
    const todayIso = _state.today || isoOf(new Date());

    let html = '<div class="cal-grid"><div class="cal-dow">' +
               TH_DOW.map(d => '<div>' + d + '</div>').join('') + '</div>';

    for (let w = 0; w < weeks; w++) {
      html += '<div class="cal-week">';
      for (let dow = 0; dow < 7; dow++) {
        const cell = new Date(gridStart);
        cell.setDate(cell.getDate() + (w * 7 + dow));
        const iso = isoOf(cell);
        const inMonth = cell.getMonth() === (month - 1);
        const isToday = iso === todayIso;
        const isWeekend = dow === 0 || dow === 6;
        const events = byDate[iso] || [];
        const visible = events.slice(0, 3);
        const overflow = events.length - visible.length;

        let cellEvents = visible.map(eventChipHtml).join('');
        if (overflow > 0) {
          cellEvents += '<div class="cal-event-more">+ อีก ' + overflow + ' รายการ</div>';
        }

        html += '<div class="cal-cell' +
                (inMonth ? '' : ' outside') +
                (isWeekend ? ' is-weekend' : '') +
                (isToday ? ' today' : '') +
                '" data-date="' + iso + '" onclick="openDay(\'' + iso + '\')">' +
                  '<div class="cal-day-num">' + cell.getDate() + '</div>' +
                  '<div class="cal-events">' + cellEvents + '</div>' +
                '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    document.getElementById('view-area').innerHTML = html;
  }

  // ===== Week view =====
  function renderWeek() {
    const ws = _state.weekStart || defaultWeekStart();
    _state.weekStart = ws;
    const todayIso = _state.today || isoOf(new Date());
    const byDate = eventsByDate();

    let head = '<div class="week-head">';
    let body = '<div class="week-body">';
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws); d.setDate(d.getDate() + i);
      const iso = isoOf(d);
      const isToday = iso === todayIso;
      head += '<div class="wh-day' + (isToday ? ' today' : '') + '">' +
                TH_DOW[i] +
                '<div class="wh-num">' + d.getDate() + '</div>' +
              '</div>';
      const events = byDate[iso] || [];
      body += '<div class="week-col' + (isToday ? ' today' : '') + '"' +
              ' data-date="' + iso + '" onclick="openDay(\'' + iso + '\')">' +
              (events.length ? events.map(eventChipHtml).join('') : '<div class="empty">—</div>') +
              '</div>';
    }
    head += '</div>'; body += '</div>';
    document.getElementById('view-area').innerHTML = '<div class="week-grid">' + head + body + '</div>';
  }

  // ===== List view =====
  function renderList() {
    const b = monthBounds();
    const items = (_state.events || [])
      .filter(ev => ev.start >= b.start && ev.start <= b.end)
      .slice()
      .sort((a, c) => (a.start < c.start ? -1 : a.start > c.start ? 1 : 0));

    if (!items.length) {
      document.getElementById('view-area').innerHTML =
        '<div class="list-wrap"><div class="list-empty" style="text-align:center;color:var(--text-muted);padding:40px;">ไม่มีรายการตามตัวกรองนี้</div></div>';
      return;
    }

    const todayIso = _state.today;
    let html = '<div class="list-wrap">';
    let lastDate = '';
    items.forEach(ev => {
      const def = LAYER_DEFS.find(L => L.id === ev.layer) || {};
      const d = new Date(ev.start + 'T00:00:00');
      if (ev.start !== lastDate) {
        lastDate = ev.start;
      }
      // meta: layer label + status (สำหรับ pending) + leave type + location/days
      let metaExtra = def.label;
      if (ev.meta && ev.meta.status_label && ev.meta.status === 'pending') metaExtra += ' · ' + ev.meta.status_label;
      if (ev.meta && ev.meta.leave_type_label) metaExtra += ' · ' + ev.meta.leave_type_label;
      if (ev.meta && ev.meta.location) metaExtra += ' · ' + ev.meta.location;
      if (ev.meta && ev.meta.days > 1) metaExtra += ' · ' + ev.meta.days + ' วัน';
      // branch pill เด่นแยกออกมา (ใช้ branch_name ที่อ่านง่ายกว่า branch_id)
      const branchPill = (ev.meta && ev.meta.branch_name)
        ? '<span class="branch-pill">' + esc(ev.meta.branch_name) + '</span>'
        : '';
      const isToday = ev.start === todayIso;
      html += '<div class="list-row' + (isToday ? ' is-today' : '') + '" onclick="openDay(\'' + ev.start + '\')">' +
                '<div class="list-date"><div class="ld-num">' + d.getDate() + '</div>' +
                  '<div class="ld-dow">' + TH_DOW[d.getDay()] + ' · ' + TH_MONTHS_SHORT[d.getMonth()] + '</div></div>' +
                '<span class="list-stripe" style="background:' + (def.color || '#64748B') + '"></span>' +
                '<div class="list-main"><div class="list-title">' + esc(ev.title) + branchPill + '</div>' +
                  '<div class="list-meta">' + esc(metaExtra) + '</div></div>' +
                '<span class="list-badge" style="background:' + layerBg(ev.layer) + ';color:' + (def.color || '#64748B') + '">' + esc(def.label) + '</span>' +
              '</div>';
    });
    html += '</div>';
    document.getElementById('view-area').innerHTML = html;
  }

  function layerBg(layer) {
    return ({
      holidays: '#E1F5EE', leaves: '#FAEEDA', events: '#EEEDFE',
      gcal: '#DBEAFE', birthdays: '#FCE7F3', fo_dayoff: '#CFFAFE',
    })[layer] || '#F1F5F9';
  }

  // ===== Day detail modal =====
  function openDay(iso) {
    const events = (_state.events || []).filter(ev => {
      const s = ev.start; const e = ev.end || ev.start;
      return iso >= s && iso <= e;
    });
    const title = formatThaiDate(iso) + ' · ' + events.length + ' รายการ';
    document.getElementById('modal-title').textContent = title;
    let body = '';
    if (!events.length) {
      body = '<div style="color: var(--text-muted); text-align: center; padding: 20px;">ไม่มีรายการในวันนี้</div>';
    } else {
      events.forEach(ev => {
        const def = LAYER_DEFS.find(L => L.id === ev.layer) || {};
        const layerLabel = def.label || ev.layer;
        const color = def.color || '#64748B';
        // meta: layer label + status (สำหรับ pending) + leave type + location/days
        let meta = layerLabel;
        if (ev.meta && ev.meta.status_label && ev.meta.status === 'pending') meta += ' · ' + ev.meta.status_label;
        if (ev.meta && ev.meta.leave_type_label) meta += ' · ' + ev.meta.leave_type_label;
        if (ev.meta && ev.meta.location) meta += ' · ' + ev.meta.location;
        if (ev.meta && ev.meta.days > 1) meta += ' · ' + ev.meta.days + ' วัน';
        // branch pill เด่นแยกออกมา (ใช้ branch_name)
        const branchPill = (ev.meta && ev.meta.branch_name)
          ? ' <span class="branch-pill">' + esc(ev.meta.branch_name) + '</span>'
          : '';
        body += '<div class="modal-event" style="background: ' + layerBg(ev.layer) + '; border-left-color: ' + color + ';">' +
                  '<div class="modal-event-title">' + esc(ev.title) + branchPill + '</div>' +
                  '<div class="modal-event-meta">' + esc(meta) + '</div>' +
                '</div>';
      });
    }
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('day-modal-bg').classList.add('active');
  }

  function closeModal() {
    document.getElementById('day-modal-bg').classList.remove('active');
  }

  // ===== Settings modal (Google Calendar) =====
  function openSettings() {
    document.getElementById('settings-body').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    document.getElementById('settings-modal-bg').classList.add('active');
    google.script.run
      .withSuccessHandler(onSettingsLoaded)
      .withFailureHandler(function(e) {
        document.getElementById('settings-body').innerHTML =
          '<div class="set-note">เปิดการเข้าถึง Google Calendar ไม่สำเร็จ — ต้องอนุญาตสิทธิ์ (authorize) ก่อนใช้งานครั้งแรก<br>' + esc(e.message || '') + '</div>';
      })
      .masterCalendarGetSettings();
  }

  function onSettingsLoaded(res) {
    const body = document.getElementById('settings-body');
    if (!res || res.ok === false) {
      body.innerHTML = '<div class="set-note">โหลดรายการปฏิทินไม่สำเร็จ: ' + esc((res && res.error) || 'unknown') + '</div>';
      return;
    }
    _state.settingsCals = res.calendars || [];
    const selected = res.selected || [];
    let html = '<div class="set-note">เลือกปฏิทินที่อยากให้แสดงในเลเยอร์ Google Cal · ระบบจะอ่านแบบอ่านอย่างเดียว (read-only)<br>หมายเหตุ: การเชื่อม Google Calendar ยังไม่พร้อมบน dashboard นี้</div>';
    if (!_state.settingsCals.length) {
      html += '<div style="color:var(--text-muted);text-align:center;padding:20px;">ไม่พบปฏิทิน — อาจต้องอนุญาตสิทธิ์ Google Calendar ก่อน</div>';
    } else {
      _state.settingsCals.forEach((c, i) => {
        const checked = selected.indexOf(c.id) >= 0 ? ' checked' : '';
        html += '<label class="set-row">' +
                  '<input type="checkbox" data-calidx="' + i + '"' + checked + ' />' +
                  '<span class="set-dot" style="background:' + esc(c.color || '#3B82F6') + '"></span>' +
                  '<span class="set-name">' + esc(c.name) + '</span>' +
                  (c.isPrimary ? '<span class="set-primary">(ของฉัน)</span>' : '') +
                '</label>';
      });
    }
    body.innerHTML = html;
  }

  function saveSettings() {
    const checks = document.querySelectorAll('#settings-body input[type=checkbox]');
    const ids = [];
    checks.forEach(ch => {
      if (ch.checked) {
        const idx = parseInt(ch.getAttribute('data-calidx'), 10);
        const cal = _state.settingsCals[idx];
        if (cal) ids.push(cal.id);
      }
    });
    const btn = document.getElementById('settings-save-btn');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
    google.script.run
      .withSuccessHandler(function() {
        btn.disabled = false; btn.textContent = 'บันทึก';
        closeSettings();
        // turn on the gcal layer so the saved selection is visible right away
        _state.layers.gcal = true;
        loadEvents();
      })
      .withFailureHandler(function(e) {
        btn.disabled = false; btn.textContent = 'บันทึก';
        alert('บันทึกไม่สำเร็จ: ' + (e.message || 'unknown'));
      })
      .masterCalendarSaveSelection(ids);
  }

  function closeSettings() {
    document.getElementById('settings-modal-bg').classList.remove('active');
  }

  // ===== Helpers =====
  function isoOf(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + dd;
  }

  function formatThaiDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    const day = d.getDate();
    const month = TH_MONTHS[d.getMonth()];
    const year = d.getFullYear() + 543;
    const dows = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
    return dows[d.getDay()] + 'ที่ ' + day + ' ' + month + ' ' + year;
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    openSettings, closeSettings, saveSettings, loadEvents,
    navPrev, navNext, navToday, setView, toggleLayer,
    selectAllBranches, toggleBranch, openDay, closeModal,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init (เดิมอยู่ใน DOMContentLoaded → เรียกตรงหลัง mount) ===== */
  renderViewSwitch();
  renderChips();
  loadEvents();
}
