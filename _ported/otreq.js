// _ported/otreq.js — FULL native port of desktop time_attendance_manager.html (Time Attendance + OT)
// ลอกทั้งดุ้น: หน้าเดิมเป็น attendance + OT รวม (4 tab: Calendar / Anomaly / OT Requests / OT Overview)
//   + 6 modals (anomaly review / day detail / recompute late / OT reject / OT create / employee profile)
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix ทุก selector ด้วย #ot
//   markup คง element id เดิมทุกตัว · JS หน้าเดิมรันใน scope ของ mountOtreq() (verbatim)
//   google.script.run = shim (Proxy) → OT_BACKEND (Supabase) · fn ที่ inline onclick ใช้ → ผูก window
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare (เราใช้ของเราเอง ot2*/OT_ เท่านั้น)
// helper จาก _shared_scripts (ICONS/showToast/showHelp/escapeHtml/escapeAttr) inline เข้ามาใน RUN_PAGE_JS
//
// backend (Supabase edge fn):
//   OT จริง:
//     list OT    → sb.functions.invoke('hr_ot_request')                 → {items}
//     approve    → sb.functions.invoke('hr_approve',{body:{request_id,decision:'approved'}})
//     reject     → sb.functions.invoke('hr_approve',{body:{request_id,decision:'rejected',reason}})
//     create     → sb.functions.invoke('hr_ot_request',{body:{...}})
//   ทำไม่ได้บน dashboard → stub + toast "ยังไม่พร้อม":
//     attendance calendar · anomaly review · employee profile · month calendar/late ·
//     recompute late · checkin photo · export CSV · mark synced · active employees (derive จาก OT)

/* ============================================================
   OT_BACKEND — map google.script.run.<fn> → Supabase
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (อ่านจาก loadOT/loadOverview/renderProfile ฯลฯ)
   ============================================================ */
function ot2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function ot2Num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

// แปลงนาที/ชั่วโมงของ 1 รายการ OT → expected_hours (number)
function ot2Hours(p) {
  if (p.expected_hours != null && p.expected_hours !== '') {
    var h = Number(p.expected_hours);
    if (!isNaN(h)) return Math.round(h * 10) / 10;
  }
  if (p.expected_minutes != null && p.expected_minutes !== '') {
    var m = Number(p.expected_minutes);
    if (!isNaN(m)) return Math.round((m / 60) * 10) / 10;
  }
  return 0;
}

// map row จาก hr_ot_request → shape ที่หน้าเดิมใช้ (loadOT/renderProfile/Overview)
function ot2MapRow(p) {
  p = p || {};
  var status = String(p.status || 'pending').toLowerCase();
  // หน้าเดิมใช้ pill-<status>/pill-<day_type> → normalize ค่าที่รู้จัก
  if (status === 'auto_approved') status = 'approved';
  var dayType = String(p.day_type || 'regular').toLowerCase();
  return {
    request_id: p.request_id || p.id || '',
    employee_id: p.employee_id || '',
    employee_name: p.employee_name || p.employee_id || '—',
    branch_id: p.branch_id || '',
    ot_date: p.ot_date || p.date || '—',
    day_type: dayType,
    expected_hours: ot2Hours(p),
    actual_hours: (p.actual_hours != null && p.actual_hours !== '') ? p.actual_hours : '',
    reason: p.reason || '',
    status: status,
    requested_by: p.requested_by || p.created_by || '—',
    requested_at: p.requested_at || p.created_at || '',
    approved_by: p.approved_by || '',
    rejected_reason: p.rejected_reason || p.reject_reason || '',
  };
}

// คำนวณ stats จาก items (เลียนแบบ backend เดิม)
function ot2StatsFromItems(items) {
  var pending = 0, approvedHours = 0;
  items.forEach(function (r) {
    var s = String(r.status || '').toLowerCase();
    if (s === 'pending' || s === '') pending++;
    if (s === 'approved' || s === 'completed') approvedHours += ot2Num(r.expected_hours);
  });
  return { pending: pending, total_approved_hours: Math.round(approvedHours * 10) / 10 };
}

// employees ที่เคยเห็นใน OT items (ใช้แทน active-employees list ที่ backend ไม่มี)
function ot2EmployeesFromItems(items) {
  var seen = {}, out = [];
  items.forEach(function (r) {
    var id = r.employee_id;
    if (id && !seen[id]) {
      seen[id] = true;
      out.push({ employee_id: id, first_name: r.employee_name || id, nickname: r.employee_name || id });
    }
  });
  return out;
}

var _OT_ITEMS_CACHE = [];   // cache items ดิบไว้ให้ stub overview/employees ใช้

// write-back จริง → window.sb.functions.invoke('hr_approve', {request_id, decision, note})
// คืน { ok:true } เมื่อ data.ok · { error, status } เมื่อพลาด (status 403 → caller บอก "ต้องเป็น HR")
function ot2Approve(requestId, decision, failMsg, note) {
  var sbc = (typeof window !== 'undefined' && window.sb) ? window.sb : sb;
  var body = { request_id: requestId, decision: decision };
  if (note != null && note !== '') body.note = note;
  return sbc.functions.invoke('hr_approve', { body: body }).then(function (res) {
    var err = res && res.error, data = (res && res.data) || {};
    var status = (err && (err.status || (err.context && err.context.status))) || (data && data.status) || 0;
    if (err || data.error || !data.ok) {
      return { error: (data && data.error) || (err && err.message) || failMsg, status: status };
    }
    return { ok: true };
  });
}

var OT_BACKEND = {
  // ---- OT จริง ----
  // list OT requests → { items:[...], stats:{pending,total_approved_hours} }
  attendAdminListOTRequests: function () {
    return sb.functions.invoke('hr_ot_request').then(function (res) {
      var data = (res && res.data) || {};
      var items = ot2ToArr(data.items).map(ot2MapRow);
      _OT_ITEMS_CACHE = items;
      return { items: items, stats: ot2StatsFromItems(items) };
    });
  },
  // approve → hr_approve (write-back จริง)
  attendAdminApproveOT: function (requestId) {
    return ot2Approve(requestId, 'approved', 'อนุมัติไม่สำเร็จ');
  },
  // reject → hr_approve (decision rejected + reason/note · write-back จริง)
  attendAdminRejectOT: function (requestId, reason) {
    return ot2Approve(requestId, 'rejected', 'ปฏิเสธไม่สำเร็จ', reason);
  },
  // create OT → hr_ot_request body
  attendAdminCreateOT: function (payload) {
    payload = payload || {};
    var body = {
      employee_id: payload.employee_id,
      ot_date: payload.ot_date,
      expected_hours: payload.expected_hours,
      expected_start: payload.expected_start || '',
      expected_end: payload.expected_end || '',
      reason: payload.reason || '',
    };
    return sb.functions.invoke('hr_ot_request', { body: body }).then(function (res) {
      var data = (res && res.data) || {};
      if (res && res.error) return { error: (res.error.message || 'create failed') };
      if (data.error) return { error: data.error };
      return { ok: true, status: data.status || (data.item && data.item.status) || 'pending' };
    });
  },

  // active employees — backend ไม่มี list เต็ม → derive จาก OT items ที่ load มาแล้ว
  attendAdminListActiveEmployees: function () {
    return Promise.resolve(ot2EmployeesFromItems(_OT_ITEMS_CACHE));
  },

  // ---- stub (ทำไม่ได้บน dashboard) ----
  // calendar attendance — ไม่มี check-in/out บน Supabase
  attendAdminListAttendance: function () {
    ot2NotReady('ปฏิทินลงเวลา (check-in/out)');
    return Promise.resolve({ items: [], stats: {}, holidays: [] });
  },
  // anomaly list — ไม่มี anti-cheat detection
  attendAdminListAnomaly: function () {
    return Promise.resolve({ items: [] });
  },
  attendAdminReviewAnomaly: function () {
    ot2NotReady('รีวิว anomaly');
    return Promise.resolve({ ok: false, error: 'รีวิว anomaly ยังไม่พร้อมบน dashboard' });
  },
  attendAdminGetCheckinPhoto: function () {
    ot2NotReady('ดูรูปเช็คอิน');
    return Promise.resolve({ ok: false, error: 'ดูรูปเช็คอินยังไม่พร้อมบน dashboard' });
  },
  attendAdminRecomputeLate: function () {
    ot2NotReady('คำนวณสายใหม่');
    return Promise.resolve({ error: 'คำนวณสายใหม่ยังไม่พร้อมบน dashboard' });
  },
  attendAdminMonthLate: function () { return Promise.resolve({ ok: false }); },
  attendAdminMonthCalendar: function () {
    return Promise.resolve({ ok: false, error: 'ปฏิทินรายคนยังไม่พร้อมบน dashboard' });
  },
  attendAdminGetEmployeeProfile: function () {
    ot2NotReady('โปรไฟล์พนักงานเต็ม');
    return Promise.resolve({ error: 'โปรไฟล์พนักงานยังไม่พร้อมบน dashboard' });
  },
  // overview — สร้างขั้นต่ำจาก OT items (ไม่มี cap/anti-cheat/post-hoc detection)
  attendAdminGetTeamOverview: function (opts) {
    opts = opts || {};
    return OT_BACKEND.attendAdminListOTRequests().then(function (r) {
      var items = (r && r.items) || [];
      var period = opts.period || (new Date().toISOString().slice(0, 7));
      // filter ตาม period (YYYY-MM) ถ้ามี ot_date
      var inPeriod = items.filter(function (x) { return String(x.ot_date || '').slice(0, 7) === period; });
      var approved = inPeriod.filter(function (x) { var s = String(x.status).toLowerCase(); return s === 'approved' || s === 'completed'; });
      var totalOt = 0, byEmp = {}, dt = { regular: 0, weekly_off: 0, public_holiday: 0, company_holiday: 0 };
      approved.forEach(function (x) {
        var h = ot2Num(x.expected_hours);
        totalOt += h;
        if (dt[x.day_type] != null) dt[x.day_type] += h; else dt.regular += h;
        if (!byEmp[x.employee_id]) byEmp[x.employee_id] = { employee_id: x.employee_id, name: x.employee_name, branch: x.branch_id || '—', ot_hours: 0, ot_days: 0 };
        byEmp[x.employee_id].ot_hours += h;
        byEmp[x.employee_id].ot_days += 1;
      });
      var tops = Object.keys(byEmp).map(function (k) { var e = byEmp[k]; e.ot_hours = Math.round(e.ot_hours * 10) / 10; return e; })
        .sort(function (a, b) { return b.ot_hours - a.ot_hours; }).slice(0, 10);
      ot2NotReady('สรุป OT แบบเต็ม (cap warning / pre-approved %)');
      return {
        period: period,
        stats: {
          total_ot_hours: Math.round(totalOt * 10) / 10,
          active_ot_employees: tops.length,
          cap_warnings_count: 0,
          pre_approved_pct: 0,
          post_hoc_pct: 0,
          unsynced_count: approved.length,
        },
        top_employees: tops,
        cap_warnings: [],
        day_type_distribution: dt,
      };
    });
  },
  attendAdminExportOT: function (period) {
    return OT_BACKEND.attendAdminListOTRequests().then(function (r) {
      var items = (r && r.items) || [];
      var p = period || (new Date().toISOString().slice(0, 7));
      var rows = items.filter(function (x) {
        var s = String(x.status).toLowerCase();
        return (s === 'approved' || s === 'completed') && String(x.ot_date || '').slice(0, 7) === p;
      });
      var header = 'request_id,employee_id,employee_name,ot_date,day_type,expected_hours,reason\n';
      var csv = header + rows.map(function (x) {
        return [x.request_id, x.employee_id, x.employee_name, x.ot_date, x.day_type, x.expected_hours, '"' + String(x.reason || '').replace(/"/g, '""') + '"'].join(',');
      }).join('\n');
      return { csv: csv, period: p, count: rows.length, request_ids: rows.map(function (x) { return x.request_id; }) };
    });
  },
  attendAdminMarkSynced: function () {
    ot2NotReady('mark synced (กัน double-pay)');
    return Promise.resolve({ updated: 0 });
  },
};

var _ot2NotReadyShown = {};
function ot2NotReady(feature) {
  if (_ot2NotReadyShown[feature]) return;
  _ot2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ot2Toast) window.ot2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountOtreq — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountOtreq() {
  var wrap = document.getElementById('wrap-otreq');
  if (!wrap) return;

  wrap.innerHTML = '<style>' + OT_CSS() + '</style><div id="ot">' + OT_MARKUP() + '</div>';

  // รัน JS ของหน้าเดิม (closure scope · google = shim) → ผูก fn ที่ inline onclick ต้องใช้ ลง window
  OT_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles + <style> manager) · prefix ทุก selector ด้วย #ot =====
   ตัด .topbar/.app-shell/.main-area/body shell ออก (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด */
function OT_CSS() {
  return [
    // tokens (จาก _shared_styles)
    '#ot{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--teal-light:#E0F7F4;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#ot *{box-sizing:border-box}',

    // page head (ในหน้าเดิมเป็น .page-head ของ shell · เก็บไว้สำหรับ help/refresh)
    '#ot .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#ot .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ot .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#ot .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ot .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center;flex-wrap:wrap}',
    '#ot .btn-help{width:34px;height:34px;border-radius:8px;background:#fff;border:1px solid var(--border);color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
    '#ot .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#ot .btn-help svg{width:15px;height:15px}',

    // buttons / loading (จาก _shared_styles)
    '#ot .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#ot .btn:hover{border-color:var(--navy)}',
    '#ot .btn svg{width:14px;height:14px}',
    '#ot .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#ot .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#ot .btn-sm{padding:5px 10px;font-size:12px}',
    '#ot .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#ot .loading{text-align:center;padding:40px 20px;color:var(--text-muted);font-size:13px}',

    // tables (จาก _shared_styles · scope #ot ไม่ใช่ main)
    '#ot .data-table{width:100%;border-collapse:collapse;font-size:13px}',
    '#ot .data-table thead th{background:#F8FAFC;padding:8px 10px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);border-bottom:1px solid var(--border)}',
    '#ot .data-table tbody td{padding:8px 10px;border-bottom:0.5px solid var(--border)}',

    // ===== <style> หน้า manager (ลอกทั้งหมด · prefix #ot) =====
    '#ot .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#ot .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#ot .stats{grid-template-columns:repeat(2,1fr)}}',
    '#ot .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#ot .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#ot .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#ot .stat-card .v{font-size:22px;font-weight:600;line-height:1;margin-top:4px}',
    '#ot .stat-card.warning .v{color:var(--warning)}',
    '#ot .stat-card.danger .v{color:var(--danger)}',
    '#ot .stat-card.success .v{color:var(--success)}',
    '#ot .stat-card.info .v{color:var(--info)}',

    '#ot .tabs{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}',
    '#ot .tab{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '#ot .tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#ot .tab svg{width:13px;height:13px}',
    '#ot .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#ot .tab.active .cnt{background:var(--navy)}',
    '#ot .tab.tab-anomaly.active .cnt{background:var(--danger)}',

    '#ot .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#ot .filter{display:flex;flex-direction:column;gap:2px}',
    '#ot .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#ot .filter input,#ot .filter select{padding:4px 8px;font-size:12px;border:0.5px solid var(--border-strong);border-radius:6px;min-width:140px}',

    // calendar week
    '#ot .cal-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
    '#ot .cal-period{font-size:14px;font-weight:600;min-width:220px;text-align:center}',
    '#ot .cal-week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}',
    '#ot .cal-day{background:#fff;border:0.5px solid var(--border);border-radius:6px;min-height:140px}',
    '#ot .cal-day-head{padding:5px 8px;border-bottom:0.5px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:#F8FAFC;font-size:10px}',
    '#ot .cal-day-name{font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#ot .cal-day-num{font-size:13px;font-weight:600}',
    '#ot .cal-day.today{border-color:var(--teal)}',
    '#ot .cal-day.today .cal-day-num{color:var(--teal)}',
    '#ot .cal-day-body{padding:4px;display:flex;flex-direction:column;gap:3px;max-height:200px;overflow-y:auto}',
    '@media (max-width:600px){#ot .cal-week{grid-template-columns:1fr;gap:8px}#ot .cal-day{min-height:auto}#ot .cal-day-head{font-size:12px;padding:8px 12px}#ot .cal-day-body{max-height:none}}',
    '@media (max-width:600px){#ot .stack-table{display:block;overflow-x:visible;white-space:normal}#ot .stack-table thead{display:none}#ot .stack-table tbody,#ot .stack-table tr,#ot .stack-table td{display:block;width:100%}#ot .stack-table tr{border:0.5px solid var(--border);border-radius:10px;margin-bottom:8px;background:#fff;padding:4px 0}#ot .stack-table td{display:flex;justify-content:space-between;gap:12px;padding:6px 12px;border:none;text-align:right}#ot .stack-table td::before{content:attr(data-label);color:var(--text-muted);font-weight:600;text-align:left}#ot .stack-table td:first-child{font-weight:600;color:var(--navy);border-bottom:0.5px solid var(--border)}}',

    '#ot .att-pill{padding:3px 6px;border-radius:3px;font-size:10px;cursor:pointer;line-height:1.3;border-left:2px solid var(--info);background:#EFF6FF}',
    '#ot .att-pill.late{background:#FEF3C7;color:#92400E;border-left-color:#F59E0B}',
    '#ot .att-pill.absent{background:#FEE2E2;color:#991B1B;border-left-color:var(--danger)}',
    '#ot .att-pill.wfh{background:#EDE9FE;color:#5B21B6;border-left-color:#8B5CF6}',
    '#ot .att-pill.off_site{background:#FCE7F3;color:#BE185D;border-left-color:#EC4899}',
    '#ot .att-pill.flagged{border-left-width:4px;border-left-color:var(--danger)}',
    '#ot .att-pill .late-min{color:#92400E;font-weight:600}',
    '#ot .att-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin:0 0 12px;font-size:11px;color:var(--text-muted)}',
    '#ot .att-legend-item{display:inline-flex;align-items:center;gap:5px}',
    '#ot .att-legend-sw{display:inline-block;width:16px;height:12px;border-radius:2px}',

    '#ot .pill{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;display:inline-block}',
    '#ot .pill-present{background:#DBEAFE;color:#1E40AF}',
    '#ot .pill-late{background:#FEF3C7;color:#92400E}',
    '#ot .pill-absent{background:#FEE2E2;color:#991B1B}',
    '#ot .pill-wfh{background:#EDE9FE;color:#5B21B6}',
    '#ot .pill-off_site{background:#FCE7F3;color:#BE185D}',
    '#ot .pill-pending{background:#FEF3C7;color:#92400E}',
    '#ot .pill-approved{background:#DCFCE7;color:#166534}',
    '#ot .pill-rejected{background:#FEE2E2;color:#991B1B}',
    '#ot .pill-completed{background:#DBEAFE;color:#1E40AF}',
    '#ot .pill-regular{background:#F1F5F9;color:var(--text-muted)}',
    '#ot .pill-weekly_off{background:#FCE7F3;color:#BE185D}',
    '#ot .pill-public_holiday{background:#FEE2E2;color:#991B1B}',
    '#ot .pill-company_holiday{background:#FEF3C7;color:#92400E}',

    '#ot .anom-card{background:#fff;border:0.5px solid var(--border);border-left:4px solid var(--danger);border-radius:6px;padding:12px 14px;margin-bottom:8px}',
    '#ot .anom-card.reviewed{border-left-color:var(--success);opacity:.7}',
    '#ot .anom-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}',
    '#ot .anom-flags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
    '#ot .anom-flag{font-size:9px;padding:1px 6px;background:var(--danger-bg);color:var(--danger);border-radius:8px;font-weight:600}',

    '#ot .ot-card{background:#fff;border:0.5px solid var(--border);border-left:4px solid #F59E0B;border-radius:6px;padding:12px 14px;margin-bottom:8px}',
    '#ot .ot-card.approved{border-left-color:var(--success)}',
    '#ot .ot-card.rejected{border-left-color:var(--danger);opacity:.6}',
    '#ot .ot-actions{display:flex;gap:6px;margin-top:8px}',

    // modal
    '#ot .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000}',
    '#ot .modal-bg.active{display:flex}',
    '#ot .modal{background:#fff;border-radius:12px;max-width:580px;width:92%;max-height:92vh;overflow-y:auto}',
    '#ot .modal.large{max-width:880px}',
    '#ot .modal-header{padding:16px 20px;border-bottom:0.5px solid var(--border)}',
    '#ot .modal-header h2{font-size:16px;margin:0}',
    '#ot .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#ot .modal-body{padding:16px 20px}',
    '#ot .modal-footer{padding:12px 20px;border-top:0.5px solid var(--border);display:flex;justify-content:space-between;gap:8px}',
    '#ot .field{margin-bottom:12px}',
    '#ot .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#ot .field input,#ot .field select,#ot .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:0.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box}',

    '#ot .prof-grid{display:grid;grid-template-columns:1fr 2fr;gap:16px}',
    '@media (max-width:600px){#ot .prof-grid{grid-template-columns:1fr}}',
    '#ot .prof-card{background:#F8FAFC;border-radius:8px;padding:14px}',
    '#ot .prof-card-title{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:8px}',
    '#ot .prof-row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}',
    '#ot .prof-row .l{color:var(--text-muted)}',
    '#ot .prof-row .v{font-weight:500}',

    '#ot .month-bars{display:grid;grid-template-columns:repeat(12,1fr);gap:3px;height:80px;align-items:end;margin-top:10px}',
    '#ot .month-bar{background:linear-gradient(180deg,#3DC5B7 0%,#2BA89B 100%);border-radius:3px 3px 0 0;min-height:4px;cursor:pointer;position:relative}',
    '#ot .month-bar:hover{background:var(--teal-dark)}',
    '#ot .month-bar-label{position:absolute;bottom:-16px;left:0;right:0;font-size:8px;color:var(--text-faint);text-align:center}',

    '#ot .cap-bar{display:flex;align-items:center;gap:8px;margin:8px 0}',
    '#ot .cap-progress{flex:1;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden}',
    '#ot .cap-fill{height:100%;background:var(--success);transition:width .3s}',
    '#ot .cap-fill.warn{background:var(--warning)}',
    '#ot .cap-fill.danger{background:var(--danger)}',

    '#ot .empty-tab{padding:30px 20px;text-align:center;color:var(--text-muted);font-size:12px}',
    '#ot .warn-row{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:6px;background:#FEF2F2;margin-bottom:6px;font-size:12px}',
    '#ot .warn-row .pct{font-weight:700;color:var(--danger)}',

    '#ot .top-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--border);cursor:pointer}',
    '#ot .top-row:hover{background:#F8FAFC}',
    '#ot .top-rank{font-size:16px;font-weight:700;color:var(--text-muted);min-width:30px;text-align:center}',
    '#ot .top-name{flex:1;font-size:13px;font-weight:500}',
    '#ot .top-bar{flex:2;height:8px;background:#F1F5F9;border-radius:4px;overflow:hidden;max-width:200px}',
    '#ot .top-bar-fill{height:100%;background:var(--info)}',
    '#ot .top-hours{min-width:80px;text-align:right;font-size:13px;font-weight:600}',

    // help modal (inline · ใช้ของ shim showHelp)
    '#ot .help-section{background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid var(--border-strong)}',
    '#ot .help-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก tab/modal · คง element id เดิม =====
   ตัด app-shell/sidebar/sheet_link/topbar/brand_footer · เก็บ page-head (help/refresh) + tabs + content + 6 modals */
function OT_MARKUP() {
  return [
    // page head (เดิมเป็น shell · เก็บ help/refresh มาไว้ตรงนี้)
    '<header class="page-head">',
    '  <div>',
    '    <h1><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Time Attendance + OT</h1>',
    '    <div class="subtitle">Check-in/out · OT request · ลิงค์ JERA fingerprint · LINE LIFF GPS</div>',
    '  </div>',
    '  <div class="page-actions" id="yh-page-actions">',
    '    <button class="btn-help" onclick="otShowHelp(HELP)" title="ช่วยเหลือ" id="help-btn"></button>',
    '    <button class="btn btn-sm" onclick="reloadAll()" id="refresh-btn"></button>',
    '  </div>',
    '</header>',

    // tabs
    '<div class="tabs">',
    '  <button class="tab active" id="tab-calendar" onclick="otSetTab(\'calendar\')"></button>',
    '  <button class="tab tab-anomaly" id="tab-anomaly" onclick="otSetTab(\'anomaly\')"></button>',
    '  <button class="tab" id="tab-ot" onclick="otSetTab(\'ot\')"></button>',
    '  <button class="tab" id="tab-overview" onclick="otSetTab(\'overview\')"></button>',
    '</div>',

    '<div id="content" class="loading">กำลังโหลด...</div>',

    // Anomaly review modal
    '<div class="modal-bg" id="anom-bg" onclick="if(event.target===this)closeAnomModal()">',
    '  <div class="modal">',
    '    <div class="modal-header"><h2 id="anom-title">Review anomaly</h2><p id="anom-sub">—</p></div>',
    '    <div class="modal-body">',
    '      <div id="anom-detail"></div>',
    '      <div class="field"><label>Manager notes</label><textarea id="anom-notes" rows="3"></textarea></div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <div style="display:flex;gap:6px"><button class="btn" onclick="reviewAnom(\'reject\')" style="color:var(--danger)">Reject</button></div>',
    '      <div style="display:flex;gap:6px"><button class="btn" onclick="closeAnomModal()">ปิด</button><button class="btn btn-primary" onclick="reviewAnom(\'approve\')">Approve</button></div>',
    '    </div>',
    '  </div>',
    '</div>',

    // Calendar day detail modal
    '<div class="modal-bg" id="day-bg" onclick="if(event.target===this)closeDayDetail()">',
    '  <div class="modal" style="max-width:420px">',
    '    <div class="modal-header"><h2 id="day-title">รายละเอียดวัน</h2><p id="day-sub">—</p></div>',
    '    <div class="modal-body"><div id="day-detail"></div></div>',
    '    <div class="modal-footer"><button class="btn" onclick="closeDayDetail()">ปิด</button><button class="btn btn-primary" id="day-profile-btn" onclick="dayOpenProfile()">ดูโปรไฟล์เต็ม</button></div>',
    '  </div>',
    '</div>',

    // Recompute late modal
    '<div class="modal-bg" id="recalc-bg" onclick="if(event.target===this)closeRecalc()">',
    '  <div class="modal" style="max-width:460px">',
    '    <div class="modal-header"><h2>คำนวณ "สาย" ใหม่</h2><p>ใช้เวลาเปิดสาขาจริงล่าสุด · ล้างค่าเก่าที่คิดผิดฐาน (เช่น เปลี่ยนเวลาเปิดทีหลัง)</p></div>',
    '    <div class="modal-body">',
    '      <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">',
    '        <div><label>ตั้งแต่วันที่ *</label><input id="rc-from" type="date"></div>',
    '        <div><label>ถึงวันที่ *</label><input id="rc-to" type="date"></div>',
    '      </div>',
    '      <div class="field"><label>เฉพาะพนักงาน (ไม่บังคับ)</label><select id="rc-emp"><option value="">— ทุกคน —</option></select></div>',
    '      <p style="font-size:12px;color:var(--muted);margin:4px 0 0">แตะเฉพาะวันที่สถานะเป็น มา/สาย (on-site) เท่านั้น · ไม่ยุ่ง WFH/ลา/ออกนอกสถานที่ · กด "ดูตัวอย่าง" ก่อนเสมอ</p>',
    '      <div id="rc-result" style="margin-top:12px"></div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeRecalc()">ปิด</button>',
    '      <div style="display:flex;gap:6px"><button class="btn" id="rc-preview-btn" onclick="runRecalc(true)">ดูตัวอย่าง</button><button class="btn btn-primary" id="rc-apply-btn" onclick="runRecalc(false)" disabled>ยืนยันคำนวณจริง</button></div>',
    '    </div>',
    '  </div>',
    '</div>',

    // OT reject modal
    '<div class="modal-bg" id="otreject-bg" onclick="if(event.target===this)closeOtReject()">',
    '  <div class="modal" style="max-width:380px">',
    '    <div class="modal-header"><h2>Reject OT request</h2><p id="otreject-sub">—</p></div>',
    '    <div class="modal-body"><div class="field"><label>เหตุผล *</label><textarea id="otreject-reason" rows="3"></textarea></div></div>',
    '    <div class="modal-footer"><button class="btn" onclick="closeOtReject()">ยกเลิก</button><button class="btn btn-primary" onclick="confirmOtReject()" style="background:var(--danger);border-color:var(--danger);color:#fff">Reject</button></div>',
    '  </div>',
    '</div>',

    // OT create modal
    '<div class="modal-bg" id="otcreate-bg" onclick="if(event.target===this)closeOtCreate()">',
    '  <div class="modal">',
    '    <div class="modal-header"><h2>สร้าง OT request</h2><p>Manager สร้างให้พนักงาน</p></div>',
    '    <div class="modal-body">',
    '      <div class="field"><label>พนักงาน *</label><select id="otc-emp"></select></div>',
    '      <div class="field"><label>วันที่ *</label><input id="otc-date" type="date"></div>',
    '      <div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">',
    '        <div><label>เวลาเริ่ม</label><input id="otc-start" type="time" value="17:00"></div>',
    '        <div><label>เวลาเสร็จ</label><input id="otc-end" type="time" value="20:00"></div>',
    '      </div>',
    '      <div class="field"><label>ชั่วโมง *</label><input id="otc-hours" type="number" min="0.5" step="0.5" value="3"></div>',
    '      <div class="field"><label>เหตุผล *</label><textarea id="otc-reason" rows="2"></textarea></div>',
    '    </div>',
    '    <div class="modal-footer"><button class="btn" onclick="closeOtCreate()">ยกเลิก</button><button class="btn btn-primary" onclick="confirmOtCreate()" id="otc-save-btn"></button></div>',
    '  </div>',
    '</div>',

    // Per-employee profile modal
    '<div class="modal-bg" id="prof-bg" onclick="if(event.target===this)closeProfModal()">',
    '  <div class="modal large">',
    '    <div class="modal-header"><h2 id="prof-name">กำลังโหลด...</h2><p id="prof-sub">—</p></div>',
    '    <div class="modal-body" id="prof-body"><div class="loading">กำลังโหลด...</div></div>',
    '    <div class="modal-footer"><button class="btn" onclick="closeProfModal()">ปิด</button></div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   OT_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → OT_BACKEND
   helper จาก _shared_scripts (ICONS/showToast/showHelp/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function OT_RUN_PAGE_JS() {

  // ---- google.script.run shim → OT_BACKEND (async, คืน shape เดิม) ----
  function _ot2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (OT_BACKEND[prop]) {
            Promise.resolve().then(function () { return OT_BACKEND[prop].apply(OT_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[OT_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[OT_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ot2MakeChain(); } });

  // ---- scoped id resolver ----
  // หลาย ported page ใช้ id ซ้ำ ('content'/'stats'/'cnt-ot'...) · getElementById คืน "ตัวแรกใน DOM"
  // → otreq mount หลัง announce_p จะไปโดน #content ของ announce · จึง resolve ภายใน subtree #ot ก่อน
  // fallback document สำหรับ id ที่อยู่นอก #ot (toast / help bg / sidebar badge ct-otreq)
  var _otRoot = window.document.getElementById('ot');
  function _gid(id) {
    var el = _otRoot ? _otRoot.querySelector('[id="' + id + '"]') : null;
    return el || window.document.getElementById(id);
  }
  // shim document object เฉพาะใน closure นี้ → getElementById/querySelectorAll resolve ใต้ #ot ก่อน
  var document = (function (realDoc, root) {
    return {
      getElementById: function (id) { return _gid(id); },
      querySelectorAll: function (sel) { return (root || realDoc).querySelectorAll(sel); },
      querySelector: function (sel) { return (root || realDoc).querySelector(sel); },
      createElement: function (tag) { return realDoc.createElement(tag); },
      body: realDoc.body,
      get readyState() { return realDoc.readyState; },
      addEventListener: function () { return realDoc.addEventListener.apply(realDoc, arguments); },
    };
  })(window.document, _otRoot);

  // ---- helpers จาก _shared_scripts (inline) ----
  const ICONS = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>',
    arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" x2="19" y1="12" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('ot2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ot2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ot2Toast = showToast;
  function otShowHelp(content) {
    let bg = document.getElementById('ot-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'ot-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const items = (s.items || []).map(it => '<li>' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      const warn = s.type === 'tip' || s.type === 'warn';
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:620px;width:92%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'ot-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'ot-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ============================================================
     ===== JS หน้าเดิม time_attendance_manager.html (verbatim) =====
     แก้เฉพาะ init ท้ายไฟล์: default tab = 'ot' (หน้านี้คือ "คำขอ OT")
     ============================================================ */
  let currentTab = 'calendar';
  let calAnchor = new Date();
  let allData = {};
  let currentAnomalyRecord = null;
  let currentOtToReject = null;
  let employeesCache = [];

  const HELP = {
    title: 'Time Attendance + OT',
    subtitle: 'Sheets: 22 + 22a',
    intro: 'ระบบบันทึกเวลาทำงาน · 6 anti-cheat layers · รองรับ on-site/WFH/off-site · OT workflow · HR monitoring',
    sections: [
      { title: '4 tabs', items: [
        '<strong>Calendar</strong> — week view เห็นใครมา/ขาด/ลา · คลิก pill เปิด detail',
        '<strong>Anomaly review</strong> — flagged records ที่ระบบ detect ผิดธรรมชาติ · HR review approve/reject',
        '<strong>OT Requests</strong> — pending approve queue · สร้าง OT ทีมได้',
        '<strong>OT Overview</strong> — team aggregate dashboard + cap warnings + export CSV ให้บัญชี',
      ]},
      { title: 'OT workflow', items: [
        '<strong>Path A:</strong> Manager สร้างให้ทีมล่วงหน้า → auto-approved',
        '<strong>Path B:</strong> Employee ขอเอง → manager approve',
        '<strong>Path C:</strong> Auto-detect post-hoc (checkout เกิน) → flag pending',
        '<strong>Path D:</strong> Public holiday → auto OT (rate 2x/3x — บัญชีคำนวณ)',
        'Cap: <strong>36 ชม./สัปดาห์</strong> (กฎหมาย hard block)',
      ]},
      { type: 'tip', title: 'หมายเหตุบน dashboard', items: [
        'หน้านี้โฟกัส <strong>OT Requests</strong> (อนุมัติ/ปฏิเสธ/สร้าง) — ต่อ Supabase จริง',
        'Calendar ลงเวลา · Anomaly · โปรไฟล์เต็ม · export CSV — <strong>ยังไม่พร้อมบน dashboard</strong> (กดได้แต่แจ้งเตือน)',
        '<strong>ระบบ</strong>: บันทึก ชม. + day_type + approval status — <strong>ไม่คำนวณค่าตอบแทน</strong> · บัญชีคำนวณ rate × hours เอง',
      ]},
    ],
  };

  document.getElementById('refresh-btn').innerHTML = ICONS.refresh;
  document.getElementById('help-btn').innerHTML = ICONS.help;
  document.getElementById('otc-save-btn').innerHTML = ICONS.save + ' สร้าง';

  document.getElementById('tab-calendar').innerHTML = ICONS.cal + ' Calendar';
  document.getElementById('tab-anomaly').innerHTML = ICONS.alert + ' Anomaly <span class="cnt" id="cnt-anomaly">—</span>';
  document.getElementById('tab-ot').innerHTML = ICONS.briefcase + ' OT Requests <span class="cnt" id="cnt-ot">—</span>';
  document.getElementById('tab-overview').innerHTML = ICONS.chart + ' OT Overview';

  function otSetTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'calendar') loadCalendar();
    else if (tab === 'anomaly') loadAnomaly();
    else if (tab === 'ot') loadOT();
    else if (tab === 'overview') loadOverview();
  }

  function reloadAll() { otSetTab(currentTab); }

  // ====== Calendar tab ======
  function loadCalendar() {
    const range = getWeekRange(calAnchor);
    document.getElementById('content').innerHTML = renderCalShell(range) + '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.calendar = res;
        renderStats(res.stats || {});
        const items = res.items || [];
        const byDay = {};
        items.forEach(r => {
          if (!byDay[r.date]) byDay[r.date] = [];
          byDay[r.date].push(r);
        });
        const holByDay = {};
        (res.holidays || []).forEach(h => { if (!holByDay[h.date]) holByDay[h.date] = []; holByDay[h.date].push(h); });
        document.getElementById('cal-body-wrap').outerHTML = renderWeek(range, byDay, holByDay);
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminListAttendance({
        start_date: range.start.toISOString(),
        end_date: range.end.toISOString(),
      });
  }

  function attLegendHtml() {
    const items = [
      ['#EFF6FF', '#3B82F6', 'มาปกติ'],
      ['#FEF3C7', '#F59E0B', 'สาย'],
      ['#FEE2E2', '#DC2626', 'ขาด / ต้องตรวจ'],
      ['#EDE9FE', '#8B5CF6', 'WFH'],
      ['#FCE7F3', '#EC4899', 'นอกสถานที่'],
    ];
    return '<div class="att-legend">' + items.map(c =>
      '<span class="att-legend-item"><span class="att-legend-sw" style="background:' + c[0] + ';border-left:3px solid ' + c[1] + '"></span>' + c[2] + '</span>'
    ).join('') + '</div>';
  }

  function renderCalShell(range) {
    const periodLabel = range.start.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) +
      ' – ' + new Date(range.end - 86400000).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
    return [
      '<div class="cal-toolbar">',
        '<button class="btn btn-sm" onclick="calNav(-1)">' + ICONS.back + '</button>',
        '<button class="btn btn-sm" onclick="calToday()">วันนี้</button>',
        '<button class="btn btn-sm" onclick="calNav(1)">' + ICONS.arrowRight + '</button>',
        '<div class="cal-period">' + escapeHtml(periodLabel) + '</div>',
        '<button class="btn btn-sm" onclick="openRecalc()" title="คำนวณ สาย ใหม่ตามเวลาเปิดสาขาจริง (ล้างค่าเก่า)" style="margin-left:auto">' + ICONS.refresh + ' คำนวณสายใหม่</button>',
      '</div>',
      attLegendHtml(),
      '<div id="stats" class="stats"></div>',
      '<div id="cal-body-wrap"></div>',
    ].join('');
  }

  function calNav(dir) { calAnchor.setDate(calAnchor.getDate() + dir * 7); loadCalendar(); }
  function calToday() { calAnchor = new Date(); loadCalendar(); }

  // ====== คำนวณสายใหม่ตามช่วงวันที่ ======
  function openRecalc() {
    document.getElementById('recalc-bg').classList.add('active');
    document.getElementById('rc-result').innerHTML = '';
    document.getElementById('rc-apply-btn').disabled = true;
    const range = getWeekRange(calAnchor);
    document.getElementById('rc-from').value = fmtDateKey(range.start);
    document.getElementById('rc-to').value = fmtDateKey(new Date(range.end - 86400000));
    const fill = (emps) => {
      const sel = document.getElementById('rc-emp');
      sel.innerHTML = '<option value="">— ทุกคน —</option>' +
        (emps || []).map(e => '<option value="' + escapeAttr(e.employee_id) + '">' +
          escapeHtml((e.nickname || e.first_name) + ' (' + e.employee_id + ')') + '</option>').join('');
    };
    if (employeesCache.length) fill(employeesCache);
    else google.script.run.withSuccessHandler(emps => { employeesCache = emps || []; fill(employeesCache); })
          .attendAdminListActiveEmployees();
  }
  function closeRecalc() { document.getElementById('recalc-bg').classList.remove('active'); }

  function runRecalc(dryRun) {
    const from = document.getElementById('rc-from').value;
    const to = document.getElementById('rc-to').value;
    const empId = document.getElementById('rc-emp').value;
    if (!from || !to) return showToast('เลือกช่วงวันที่ก่อน', 'error');
    if (from > to) return showToast('วันเริ่มต้องไม่เกินวันสิ้นสุด', 'error');
    const pbtn = document.getElementById('rc-preview-btn');
    const abtn = document.getElementById('rc-apply-btn');
    pbtn.disabled = true; abtn.disabled = true;
    document.getElementById('rc-result').innerHTML = '<div class="loading">กำลังคำนวณ...</div>';
    google.script.run
      .withSuccessHandler(res => {
        pbtn.disabled = false;
        if (!res || res.error) {
          document.getElementById('rc-result').innerHTML = '';
          return showToast(res && res.error || 'คำนวณไม่สำเร็จ', 'error');
        }
        renderRecalcResult(res);
        abtn.disabled = !(res.dryRun && res.changed > 0);
        if (!res.dryRun) {
          showToast('คำนวณใหม่แล้ว ' + res.changed + ' รายการ', 'success');
          loadCalendar();
        }
      })
      .withFailureHandler(err => {
        pbtn.disabled = false;
        document.getElementById('rc-result').innerHTML = '';
        showToast(err.message, 'error');
      })
      .attendAdminRecomputeLate({ from: from, to: to, employee_id: empId, dryRun: dryRun });
  }

  function renderRecalcResult(res) {
    if (!res.changed) {
      document.getElementById('rc-result').innerHTML =
        '<div style="padding:10px;background:var(--teal-light,#E0F7F4);border-radius:8px;font-size:13px">' +
        'สแกน ' + res.scanned + ' รายการ · <strong>ไม่มีรายการที่ต้องแก้</strong> (ค่าสายตรงกับเวลาเปิดสาขาแล้ว)</div>';
      return;
    }
    let h = '<div style="font-size:13px;margin-bottom:6px">' +
      (res.dryRun ? '<strong>ตัวอย่าง</strong> · ' : '<strong>แก้แล้ว</strong> · ') +
      'สแกน ' + res.scanned + ' · จะเปลี่ยน <strong style="color:var(--teal-dark,#0F6E56)">' + res.changed + '</strong> รายการ</div>';
    h += '<table class="data-table stack-table" style="font-size:11px"><thead><tr>' +
      '<th>พนักงาน</th><th>วันที่</th><th>เช็คอิน</th><th>เปิดสาขา</th><th>เดิม</th><th>ใหม่</th></tr></thead><tbody>';
    (res.samples || []).forEach(s => {
      const oldTxt = s.old.late_minutes + 'น./' + s.old.status;
      const newTxt = s.new.late_minutes + 'น./' + s.new.status;
      h += '<tr><td data-label="พนักงาน">' + escapeHtml(s.employee) + '</td><td data-label="วันที่">' + escapeHtml(s.date) + '</td>' +
        '<td data-label="เช็คอิน">' + escapeHtml(s.checkin) + '</td><td data-label="เปิดสาขา">' + escapeHtml(s.expected_start) + '</td>' +
        '<td data-label="เดิม" style="color:var(--muted)">' + escapeHtml(oldTxt) + '</td>' +
        '<td data-label="ใหม่" style="color:var(--teal-dark,#0F6E56);font-weight:600">' + escapeHtml(newTxt) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (res.changed > (res.samples || []).length) {
      h += '<p style="font-size:11px;color:var(--muted);margin-top:4px">… แสดง ' + res.samples.length + ' จาก ' + res.changed + ' รายการ</p>';
    }
    document.getElementById('rc-result').innerHTML = h;
  }

  function getWeekRange(d) {
    const start = new Date(d); start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start); end.setDate(end.getDate() + 7);
    return { start, end };
  }
  function fmtDateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function renderWeek(range, byDay, holByDay) {
    holByDay = holByDay || {};
    const days = [];
    const todayStr = fmtDateKey(new Date());
    for (let i = 0; i < 7; i++) {
      const d = new Date(range.start);
      d.setDate(d.getDate() + i);
      const k = fmtDateKey(d);
      const isToday = k === todayStr;
      const cls = ['cal-day'];
      if (isToday) cls.push('today');
      const hols = holByDay[k] || [];
      let holBadge = '';
      if (hols.length) {
        const h = hols[0];
        const both = h.closes_office && h.closes_frontline;
        const who = both ? '' : (h.closes_frontline ? ' (หน้าบ้าน)' : h.closes_office ? ' (หลังบ้าน)' : '');
        holBadge = '<div title="' + escapeAttr(hols.map(x => x.name).join(' · ')) +
          '" style="margin-top:2px;font-size:8px;background:#FEE2E2;color:#991B1B;border-radius:4px;padding:1px 4px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">หยุด' + escapeHtml(who) + '</div>';
      }
      const records = (byDay[k] || []).map(r => {
        const pillCls = ['att-pill', r.status];
        if (r.flagged_for_review) pillCls.push('flagged');
        return '<div class="' + pillCls.join(' ') + '" onclick="openDayDetail(\'' + escapeAttr(r.record_id) + '\')" title="' + escapeAttr(r.employee_name + ' · ' + r.checkin_time + ' · คลิกดูรายละเอียด+รูป') + '">' +
          escapeHtml(r.employee_name.substring(0, 12)) +
          '<br><span style="font-size:9px">' + escapeHtml(r.checkin_time) + (r.checkout_time ? '–' + escapeHtml(r.checkout_time) : '') + '</span>' +
          ((r.status === 'late' && r.late_minutes) ? '<br><span class="late-min" style="font-size:9px">สาย ' + r.late_minutes + ' น.</span>' : '') +
        '</div>';
      }).join('');
      days.push(
        '<div class="' + cls.join(' ') + '">' +
          '<div class="cal-day-head">' +
            '<span class="cal-day-name">' + d.toLocaleDateString('th-TH', { weekday: 'short' }) + '</span>' +
            '<span class="cal-day-num">' + d.getDate() + '</span>' +
          '</div>' +
          holBadge +
          '<div class="cal-day-body">' + (records || '<div style="font-size:9px;color:var(--text-faint);text-align:center;padding:8px">—</div>') + '</div>' +
        '</div>'
      );
    }
    return '<div id="cal-body-wrap"><div class="cal-week">' + days.join('') + '</div></div>';
  }

  function renderStats(s) {
    const html = [
      statCard('Total', s.total || 0, ''),
      statCard('Present', s.present || 0, 'success'),
      statCard('Late', s.late || 0, 'warning'),
      statCard('WFH', s.wfh || 0, 'info'),
      statCard('Flagged', s.flagged || 0, 'danger'),
      statCard('Hours', Math.round((s.total_regular_hours || 0) + (s.total_ot_hours || 0)) + 'h', ''),
    ].join('');
    const el = document.getElementById('stats');
    if (el) el.innerHTML = html;
  }
  function statCard(label, val, cls) {
    return '<div class="stat-card ' + cls + '"><div class="l">' + escapeHtml(label) + '</div><div class="v">' + val + '</div></div>';
  }

  // ====== Anomaly tab ======
  function loadAnomaly() {
    document.getElementById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.anomaly = res;
        const items = res.items || [];
        document.getElementById('cnt-anomaly').textContent = items.filter(i => !i.reviewed_by).length;
        let html = '<h3 style="font-size:14px;margin:0 0 4px">Anomaly review (30 วันล่าสุด)</h3>';
        html += '<div style="font-size:11px;color:var(--text-muted);margin:0 0 10px">หมายเหตุ: Anomaly รวมทุกเรื่องที่ระบบอยากให้ตรวจ ไม่ใช่แค่ "สาย" — เช่น gps_too_perfect (GPS ดีเกินไป กันโกง), สาย, ขาด ฯลฯ · บางรายการสถานะ present ได้</div>';
        if (!items.length) html += '<div class="empty-tab">ไม่มี anomaly · ดี!</div>';
        else {
          items.forEach(r => {
            const flagsHtml = (r.anomaly_flags || '').split('|').filter(Boolean)
              .map(f => '<span class="anom-flag">' + escapeHtml(f) + '</span>').join('');
            const cls = r.reviewed_by ? 'anom-card reviewed' : 'anom-card';
            html += '<div class="' + cls + '">';
            html += '<div class="anom-row">';
            html += '<div style="flex:1">';
            html += '<div style="font-size:14px;font-weight:600">' + escapeHtml(r.employee_name) + '</div>';
            html += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escapeHtml(r.date + ' · ' + r.checkin_time + (r.checkout_time ? '–' + r.checkout_time : '')) + '</div>';
            html += '<div style="font-size:11px;margin-top:4px"><strong>Mode:</strong> ' + escapeHtml(r.work_mode) + ' · <strong>Status:</strong> ' + escapeHtml(r.status) + '</div>';
            if (r.status === 'late' && r.late_minutes) {
              html += '<div style="font-size:12px;font-weight:600;color:#92400E;margin-top:3px">สาย ' + r.late_minutes + ' นาที</div>';
            }
            html += '<div class="anom-flags">' + flagsHtml + '</div>';
            if (r.reviewed_by) html += '<div style="font-size:10px;color:var(--text-faint);margin-top:6px">Reviewed by ' + escapeHtml(r.reviewed_by) + ' at ' + escapeHtml(r.reviewed_at) + '</div>';
            html += '</div>';
            html += '<div>';
            if (!r.reviewed_by) {
              html += '<button class="btn btn-sm btn-primary" onclick="openAnomModal(\'' + escapeAttr(r.record_id) + '\')">Review</button>';
            } else {
              html += '<span class="pill pill-' + (r.approval_status === 'approved' ? 'approved' : 'rejected') + '">' + escapeHtml(r.approval_status) + '</span>';
            }
            html += '</div>';
            html += '</div></div>';
          });
        }
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminListAnomaly({ days: 30 });
  }

  function openAnomModal(recordId) {
    const r = allData.anomaly.items.find(x => x.record_id === recordId);
    if (!r) return;
    currentAnomalyRecord = r;
    document.getElementById('anom-bg').classList.add('active');
    document.getElementById('anom-title').textContent = 'Review · ' + r.employee_name;
    document.getElementById('anom-sub').textContent = r.date + ' · ' + r.work_mode;
    let detail = '<div style="background:#F8FAFC;padding:12px;border-radius:6px;margin-bottom:12px;font-size:12px;line-height:1.6">';
    detail += '<strong>Check-in:</strong> ' + escapeHtml(r.checkin_time) + ' (' + escapeHtml(r.checkin_method) + ')<br>';
    if (r.checkin_lat) detail += '<strong>GPS:</strong> ' + r.checkin_lat + ', ' + r.checkin_lng + '<br>';
    detail += '<strong>Status:</strong> ' + escapeHtml(r.status) + ' · <strong>Late:</strong> ' + r.late_minutes + ' min<br>';
    detail += '<strong>Flags:</strong> <span class="anom-flag">' + escapeHtml(r.anomaly_flags) + '</span>';
    if (r.checkin_photo_url) detail += '<br><button type="button" class="btn" onclick="loadCheckinPhoto(\'' + escapeAttr(r.checkin_photo_url) + '\')" style="margin-top:6px">ดูรูปเช็คอิน</button>';
    detail += '<div id="anom-photo" style="margin-top:8px"></div>';
    detail += '</div>';
    document.getElementById('anom-detail').innerHTML = detail;
    document.getElementById('anom-notes').value = '';
  }
  function loadCheckinPhoto(fileId, boxId) {
    const box = document.getElementById(boxId || 'anom-photo');
    if (box) box.innerHTML = '<span style="font-size:12px;color:#64748B">กำลังโหลดรูป...</span>';
    google.script.run
      .withSuccessHandler(r => {
        if (!r || !r.ok) { if (box) box.innerHTML = '<span style="font-size:12px;color:var(--danger)">' + escapeHtml((r && r.error) || 'โหลดรูปไม่สำเร็จ') + '</span>'; return; }
        if (box) box.innerHTML = '<img src="' + r.data_url + '" alt="check-in photo" style="max-width:100%;border-radius:8px;border:1px solid var(--border)">';
      })
      .withFailureHandler(e => { if (box) box.innerHTML = '<span style="font-size:12px;color:var(--danger)">' + escapeHtml((e && e.message) ? e.message : String(e)) + '</span>'; })
      .attendAdminGetCheckinPhoto(fileId);
  }
  function closeAnomModal() { document.getElementById('anom-bg').classList.remove('active'); currentAnomalyRecord = null; }

  var _dayProfileEmpId = null;
  function openDayDetail(recordId) {
    var items = (allData.calendar && allData.calendar.items) || [];
    var r = items.find(function (x) { return x.record_id === recordId; });
    if (!r) return;
    _dayProfileEmpId = r.employee_id;
    document.getElementById('day-bg').classList.add('active');
    document.getElementById('day-title').textContent = r.employee_name + ' · ' + (r.status || '');
    document.getElementById('day-sub').textContent = (r.date || '') + ' · ' + (r.work_mode || '');
    var d = '<div style="background:#F8FAFC;padding:12px;border-radius:6px;font-size:12px;line-height:1.7">';
    d += '<strong>เช็คอิน:</strong> ' + escapeHtml(r.checkin_time || '—') + (r.checkin_method ? ' (' + escapeHtml(r.checkin_method) + ')' : '') + '<br>';
    if (r.checkout_time) d += '<strong>เช็คเอาท์:</strong> ' + escapeHtml(r.checkout_time) + '<br>';
    d += '<strong>สถานะ:</strong> ' + escapeHtml(r.status || '—') + (r.late_minutes ? ' · สาย ' + r.late_minutes + ' นาที' : '') + '<br>';
    if (r.checkin_lat) d += '<strong>GPS:</strong> ' + r.checkin_lat + ', ' + r.checkin_lng + '<br>';
    if (r.anomaly_flags) d += '<strong>Flags:</strong> <span class="anom-flag">' + escapeHtml(r.anomaly_flags) + '</span><br>';
    d += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">';
    if (r.checkin_photo_url) {
      d += '<button type="button" class="btn btn-sm" onclick="loadCheckinPhoto(\'' + escapeAttr(r.checkin_photo_url) + '\',\'day-photo\')">ดูรูปเช็คอิน</button>';
    }
    if (r.checkout_photo_url) {
      d += '<button type="button" class="btn btn-sm" onclick="loadCheckinPhoto(\'' + escapeAttr(r.checkout_photo_url) + '\',\'day-photo\')">ดูรูปเช็คเอาท์</button>';
    }
    d += '</div>';
    if (!r.checkin_photo_url && !r.checkout_photo_url) {
      d += '<span style="color:#94A3B8">— ไม่มีรูปเช็คอิน/เช็คเอาท์วันนี้ —</span>';
    }
    d += '<div id="day-photo" style="margin-top:8px"></div></div>';
    d += '<div id="day-late-accum" style="margin-top:10px;font-size:12px;color:var(--text-muted)">กำลังโหลดสายสะสม...</div>';
    document.getElementById('day-detail').innerHTML = d;
    google.script.run
      .withSuccessHandler(function (s) {
        var box = document.getElementById('day-late-accum');
        if (!box) return;
        if (!s || !s.ok) { box.innerHTML = ''; return; }
        var color = s.late_over_cap ? '#DC2626' : (s.late_minutes_month > 0 ? '#92400E' : '#0F766E');
        box.innerHTML = '<div style="background:#F8FAFC;border-radius:6px;padding:9px 11px">' +
          '<strong>สายสะสมเดือนนี้ (' + escapeHtml(s.zone_label) + '):</strong> ' +
          '<span style="color:' + color + ';font-weight:600">' + s.late_minutes_month + ' / ' + s.late_cap + ' นาที</span>' +
          ' · ' + s.late_days + ' วัน' + (s.late_over_cap ? ' · เกินเพดานแล้ว' : '') +
          '<div style="font-size:10px;color:#94A3B8;margin-top:3px">โซน' + escapeHtml(s.zone_label) +
          ' หักสายเมื่อเกิน ' + s.grace + ' นาที</div></div>';
      })
      .withFailureHandler(function () { var b = document.getElementById('day-late-accum'); if (b) b.innerHTML = ''; })
      .attendAdminMonthLate(r.employee_id);
  }
  function closeDayDetail() { document.getElementById('day-bg').classList.remove('active'); }
  function dayOpenProfile() {
    closeDayDetail();
    if (_dayProfileEmpId && typeof openProfile === 'function') openProfile(_dayProfileEmpId);
  }
  function reviewAnom(decision) {
    if (!currentAnomalyRecord) return;
    const notes = document.getElementById('anom-notes').value;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('Reviewed · ' + decision, 'success');
        closeAnomModal();
        loadAnomaly();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminReviewAnomaly(currentAnomalyRecord.record_id, decision, notes);
  }

  // ====== OT Requests tab ======
  function loadOT() {
    document.getElementById('content').innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">OT Requests</h3><button class="btn btn-primary btn-sm" onclick="openOtCreate()">' + ICONS.plus + ' สร้าง OT</button></div><div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.ot = res;
        const items = res.items || [];
        const stats = res.stats || {};
        document.getElementById('cnt-ot').textContent = stats.pending || 0;
        // sidebar badge (dashboard) = จำนวน pending
        const ctBadge = document.getElementById('ct-otreq');
        if (ctBadge) ctBadge.textContent = stats.pending || '';

        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">OT Requests · ' + (stats.pending || 0) + ' pending · ' + (stats.total_approved_hours || 0) + ' ชม. approved</h3><button class="btn btn-primary btn-sm" onclick="openOtCreate()">' + ICONS.plus + ' สร้าง OT</button></div>';
        if (!items.length) html += '<div class="empty-tab">ยังไม่มี OT requests</div>';
        else {
          items.forEach(r => {
            const cls = ['ot-card'];
            if (r.status === 'approved' || r.status === 'completed') cls.push('approved');
            if (r.status === 'rejected') cls.push('rejected');
            html += '<div class="' + cls.join(' ') + '">';
            html += '<div style="display:flex;justify-content:space-between;align-items:start;gap:10px">';
            html += '<div style="flex:1">';
            html += '<div style="font-size:14px;font-weight:600">' + escapeHtml(r.employee_name) + ' · ' + r.expected_hours + ' ชม.</div>';
            html += '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">';
            html += '<strong>วันที่:</strong> ' + escapeHtml(r.ot_date) + ' · <strong>day_type:</strong> <span class="pill pill-' + r.day_type + '">' + escapeHtml(r.day_type) + '</span>';
            html += '</div>';
            html += '<div style="font-size:11px;margin-top:4px;color:var(--text-muted)"><strong>เหตุผล:</strong> ' + escapeHtml(r.reason || '-') + '</div>';
            html += '<div style="font-size:10px;color:var(--text-faint);margin-top:4px">request โดย ' + escapeHtml(r.requested_by) + ' · ' + escapeHtml(r.requested_at);
            if (r.approved_by) html += ' · approved โดย ' + escapeHtml(r.approved_by);
            html += '</div>';
            if (r.rejected_reason) html += '<div style="font-size:11px;color:var(--danger);margin-top:4px"><strong>Rejected:</strong> ' + escapeHtml(r.rejected_reason) + '</div>';
            html += '</div>';
            html += '<div><span class="pill pill-' + r.status + '">' + escapeHtml(r.status) + '</span></div>';
            html += '</div>';
            if (r.status === 'pending') {
              html += '<div class="ot-actions">';
              html += '<button class="btn btn-sm" onclick="rejectOt(\'' + escapeAttr(r.request_id) + '\', \'' + escapeAttr(r.employee_name) + '\')" style="color:var(--danger)">Reject</button>';
              html += '<button class="btn btn-sm btn-primary" onclick="approveOt(\'' + escapeAttr(r.request_id) + '\')">Approve</button>';
              html += '</div>';
            }
            html += '</div>';
          });
        }
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminListOTRequests({});
  }

  function approveOt(requestId) {
    if (!confirm('Approve OT request?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(Number(res.status) === 403 ? 'ต้องเป็น HR' : res.error, 'error');
        showToast('อนุมัติแล้ว', 'success');
        loadOT();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminApproveOT(requestId);
  }
  function rejectOt(requestId, name) {
    currentOtToReject = requestId;
    document.getElementById('otreject-bg').classList.add('active');
    document.getElementById('otreject-sub').textContent = 'Reject ' + name;
    document.getElementById('otreject-reason').value = '';
  }
  function closeOtReject() { document.getElementById('otreject-bg').classList.remove('active'); currentOtToReject = null; }
  function confirmOtReject() {
    const reason = document.getElementById('otreject-reason').value;
    if (!reason) return showToast('ใส่เหตุผล', 'error');
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(Number(res.status) === 403 ? 'ต้องเป็น HR' : res.error, 'error');
        showToast('ปฏิเสธแล้ว', 'success');
        closeOtReject();
        loadOT();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminRejectOT(currentOtToReject, reason);
  }

  function openOtCreate() {
    document.getElementById('otcreate-bg').classList.add('active');
    document.getElementById('otc-date').valueAsDate = new Date();
    document.getElementById('otc-hours').value = 3;
    document.getElementById('otc-reason').value = '';
    if (employeesCache.length === 0) {
      google.script.run.withSuccessHandler(emps => {
        employeesCache = emps || [];
        const sel = document.getElementById('otc-emp');
        sel.innerHTML = '<option value="">— เลือกพนักงาน —</option>' +
          employeesCache.map(e => '<option value="' + escapeAttr(e.employee_id) + '">' +
            escapeHtml((e.nickname || e.first_name) + ' (' + e.employee_id + ')') + '</option>').join('');
      }).attendAdminListActiveEmployees();
    } else {
      const sel = document.getElementById('otc-emp');
      if (sel && sel.children.length <= 1) {
        sel.innerHTML = '<option value="">— เลือกพนักงาน —</option>' +
          employeesCache.map(e => '<option value="' + escapeAttr(e.employee_id) + '">' +
            escapeHtml((e.nickname || e.first_name) + ' (' + e.employee_id + ')') + '</option>').join('');
      }
    }
  }
  function closeOtCreate() { document.getElementById('otcreate-bg').classList.remove('active'); }
  function confirmOtCreate() {
    const empId = document.getElementById('otc-emp').value;
    const date = document.getElementById('otc-date').value;
    const hours = document.getElementById('otc-hours').value;
    const reason = document.getElementById('otc-reason').value;
    if (!empId || !date || !hours || !reason) return showToast('กรอกให้ครบ', 'error');
    document.getElementById('otc-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('otc-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('สร้างแล้ว · ' + res.status, 'success');
        closeOtCreate();
        loadOT();
      })
      .withFailureHandler(err => {
        document.getElementById('otc-save-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .attendAdminCreateOT({
        employee_id: empId,
        ot_date: date,
        expected_hours: hours,
        expected_start: document.getElementById('otc-start').value,
        expected_end: document.getElementById('otc-end').value,
        reason: reason,
      });
  }

  // ====== OT Overview tab ======
  function loadOverview() {
    document.getElementById('content').innerHTML = '<div class="filters"><div class="filter"><label>Period</label><input id="ov-period" placeholder="2026-05" oninput="loadOverview()"></div></div><div class="loading">กำลังโหลด...</div>';
    const periodInput = document.getElementById('ov-period');
    const opts = {};
    if (periodInput && periodInput.value) opts.period = periodInput.value;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.overview = res;
        const stats = res.stats || {};
        let html = '<div class="filters"><div class="filter"><label>Period</label><input id="ov-period" placeholder="2026-05" value="' + escapeAttr(opts.period || res.period) + '" oninput="loadOverview()"></div></div>';
        html += '<div class="stats">';
        html += statCard('Period', res.period || '—', '');
        html += statCard('Total OT hours', stats.total_ot_hours + 'h', 'info');
        html += statCard('Active OT emps', stats.active_ot_employees || 0, '');
        html += statCard('Cap warnings', stats.cap_warnings_count || 0, stats.cap_warnings_count > 0 ? 'danger' : '');
        html += statCard('Pre-approved', stats.pre_approved_pct + '%', 'success');
        html += statCard('Post-hoc', stats.post_hoc_pct + '%', stats.post_hoc_pct > 20 ? 'warning' : '');
        html += '</div>';

        html += '<div style="background:#fff;border:0.5px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px">';
        html += '<h4 style="margin:0 0 10px;font-size:13px">Top employees · OT มากสุด ' + (res.period || '') + '</h4>';
        const tops = res.top_employees || [];
        if (!tops.length) html += '<div class="empty-tab">ไม่มี OT ในช่วงนี้</div>';
        else {
          const maxHours = Math.max.apply(null, tops.map(t => t.ot_hours)) || 1;
          tops.forEach((t, idx) => {
            const pct = (t.ot_hours / maxHours) * 100;
            html += '<div class="top-row" onclick="openProfile(\'' + escapeAttr(t.employee_id) + '\')">';
            html += '<div class="top-rank">' + (idx + 1) + '</div>';
            html += '<div class="top-name">' + escapeHtml(t.name) + '<div style="font-size:10px;color:var(--text-faint)">' + escapeHtml(t.branch) + ' · ' + t.ot_days + ' days</div></div>';
            html += '<div class="top-bar"><div class="top-bar-fill" style="width:' + pct + '%"></div></div>';
            html += '<div class="top-hours">' + t.ot_hours + ' ชม.</div>';
            html += '</div>';
          });
        }
        html += '</div>';

        if ((res.cap_warnings || []).length > 0) {
          html += '<div style="background:#fff;border:0.5px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px">';
          html += '<h4 style="margin:0 0 10px;font-size:13px;color:var(--danger)">Cap warnings (สัปดาห์นี้ ใกล้เกิน ' + (res.cap_warnings[0] && res.cap_warnings[0].cap || 36) + ' ชม.)</h4>';
          res.cap_warnings.forEach(w => {
            html += '<div class="warn-row">';
            html += '<span>' + escapeHtml(w.name) + ' · <span class="pct">' + w.this_week_hours + '/' + w.cap + ' ชม.</span></span>';
            html += '<span class="pct">' + w.pct + '%</span>';
            html += '</div>';
          });
          html += '</div>';
        }

        html += '<div style="background:#fff;border:0.5px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px">';
        html += '<h4 style="margin:0 0 10px;font-size:13px">Day type breakdown</h4>';
        const dt = res.day_type_distribution || {};
        const total = (dt.regular || 0) + (dt.weekly_off || 0) + (dt.public_holiday || 0) + (dt.company_holiday || 0);
        if (total === 0) html += '<div class="empty-tab">ไม่มีข้อมูล</div>';
        else {
          html += '<table class="data-table" style="font-size:12px"><thead><tr><th>Day type</th><th>Hours</th><th>%</th></tr></thead><tbody>';
          ['regular', 'weekly_off', 'public_holiday', 'company_holiday'].forEach(t => {
            const h = dt[t] || 0;
            if (h === 0) return;
            html += '<tr><td><span class="pill pill-' + t + '">' + t + '</span></td><td>' + Math.round(h * 10) / 10 + ' ชม.</td><td>' + Math.round((h / total) * 100) + '%</td></tr>';
          });
          html += '</tbody></table>';
          html += '<div style="font-size:10px;color:var(--text-faint);margin-top:8px">หมายเหตุ: ระบบบันทึก ชม. + day_type — บัญชีคำนวณ rate × hours เอง</div>';
        }
        html += '</div>';

        html += '<div style="background:#F8FAFC;border:0.5px solid var(--border);border-radius:8px;padding:14px">';
        html += '<h4 style="margin:0 0 6px;font-size:13px">Export for accounting</h4>';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Download CSV ของ approved OT (period ' + (res.period || '') + ') · ส่งให้บัญชีคำนวณค่าตอบแทน</div>';
        html += '<button class="btn btn-primary btn-sm" onclick="exportCSV()">' + ICONS.download + ' Download CSV</button>';
        html += ' <span style="font-size:11px;color:var(--text-muted);margin-left:10px">unsynced: ' + (stats.unsynced_count || 0) + ' รายการ</span>';
        html += '</div>';

        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminGetTeamOverview(opts);
  }

  function exportCSV() {
    const period = (document.getElementById('ov-period').value) || '';
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        const blob = new Blob([res.csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ot_export_' + res.period + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        if (res.count > 0 && confirm('Mark ' + res.count + ' รายการเป็น synced ป้องกัน double-pay?')) {
          google.script.run
            .withSuccessHandler(r2 => {
              if (r2 && r2.error) return showToast(r2.error, 'error');
              showToast('Marked synced ' + (r2.updated || 0) + ' รายการ', 'success');
              loadOverview();
            })
            .attendAdminMarkSynced(res.request_ids);
        }
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminExportOT(period);
  }

  // ====== Per-employee profile ======
  function openProfile(employeeId) {
    document.getElementById('prof-bg').classList.add('active');
    document.getElementById('prof-name').textContent = 'กำลังโหลด...';
    document.getElementById('prof-body').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(d => {
        if (!d || d.error) { closeProfModal(); return showToast(d && d.error || 'load failed', 'error'); }
        renderProfile(d);
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminGetEmployeeProfile(employeeId);
  }
  function closeProfModal() { document.getElementById('prof-bg').classList.remove('active'); }

  function renderProfile(d) {
    const emp = d.employee || {};
    document.getElementById('prof-name').textContent = emp.name + ' · ' + emp.employee_id;
    document.getElementById('prof-sub').textContent = (emp.position_id || '-') + ' · ' + (emp.primary_branch_id || '-') + (emp.line_linked ? ' · LINE linked' : '');

    const cap = d.cap_status || {};
    const capCls = cap.utilization_pct >= 100 ? 'danger' : cap.warning ? 'warn' : '';
    const ots = d.ot_stats || {};

    let html = '<div class="prof-grid">';
    html += '<div class="prof-card">';
    html += '<div class="prof-card-title">12 เดือนล่าสุด</div>';
    html += '<div class="prof-row"><span class="l">Total OT hours</span><span class="v">' + ots.total_ot_hours + ' ชม.</span></div>';
    html += '<div class="prof-row"><span class="l">Total approved</span><span class="v">' + ots.total_approved + ' requests</span></div>';
    html += '<div class="prof-row"><span class="l">Pre-approved</span><span class="v">' + ots.pre_approved_pct + '%</span></div>';
    html += '<div class="prof-row"><span class="l">Post-hoc</span><span class="v">' + ots.post_hoc_pct + '%</span></div>';
    html += '<div class="prof-row"><span class="l">Anomalies (12mo)</span><span class="v">' + d.anomaly_count + '</span></div>';
    html += '</div>';

    html += '<div class="prof-card">';
    html += '<div class="prof-card-title">Cap status (สัปดาห์นี้)</div>';
    html += '<div class="prof-row"><span class="l">OT hours</span><span class="v">' + cap.this_week_hours + ' / ' + cap.weekly_cap + ' ชม.</span></div>';
    html += '<div class="cap-bar"><div class="cap-progress"><div class="cap-fill ' + capCls + '" style="width:' + Math.min(100, cap.utilization_pct) + '%"></div></div><div style="min-width:40px;text-align:right;font-size:12px;font-weight:600">' + cap.utilization_pct + '%</div></div>';
    html += '<div class="prof-card-title" style="margin-top:14px">Day type (เดือนนี้)</div>';
    const dt = d.day_type_breakdown || {};
    ['regular', 'weekly_off', 'public_holiday', 'company_holiday'].forEach(t => {
      const h = dt[t] || 0;
      if (h === 0) return;
      html += '<div class="prof-row"><span class="l">' + t + '</span><span class="v">' + Math.round(h * 10) / 10 + ' ชม.</span></div>';
    });
    html += '</div>';
    html += '</div>';

    html += '<div style="margin-top:14px"><div class="prof-card-title">OT hours per month (12 months)</div>';
    if (!d.monthly || d.monthly.length === 0) html += '<div class="empty-tab">ยังไม่มีข้อมูล</div>';
    else {
      const maxOt = Math.max.apply(null, d.monthly.map(m => m.ot_hours)) || 1;
      html += '<div class="month-bars">';
      d.monthly.forEach(m => {
        const h = (m.ot_hours / maxOt) * 100;
        html += '<div class="month-bar" style="height:' + Math.max(4, h) + '%" title="' + m.year_month + ' · ' + m.ot_hours + ' ชม."><span class="month-bar-label">' + m.year_month.substring(5) + '</span></div>';
      });
      html += '</div>';
    }
    html += '</div>';

    html += '<div style="margin-top:24px"><div class="prof-card-title">ปฏิทินเข้างานเดือนนี้</div>' +
      '<div id="prof-monthcal"><div class="loading">กำลังโหลด...</div></div></div>';

    html += '<div style="margin-top:24px"><div class="prof-card-title">Recent OT requests (10 ล่าสุด)</div>';
    if (!d.recent_requests || !d.recent_requests.length) html += '<div class="empty-tab">ยังไม่มี</div>';
    else {
      html += '<table class="data-table stack-table" style="font-size:11px"><thead><tr><th>วันที่</th><th>day type</th><th>คาด</th><th>จริง</th><th>status</th><th>approver</th></tr></thead><tbody>';
      d.recent_requests.forEach(r => {
        html += '<tr>';
        html += '<td data-label="วันที่">' + escapeHtml(r.ot_date) + '</td>';
        html += '<td data-label="day type"><span class="pill pill-' + r.day_type + '">' + escapeHtml(r.day_type) + '</span></td>';
        html += '<td data-label="คาด">' + r.expected_hours + 'h</td>';
        html += '<td data-label="จริง">' + (r.actual_hours || '-') + 'h</td>';
        html += '<td data-label="status"><span class="pill pill-' + r.status + '">' + escapeHtml(r.status) + '</span></td>';
        html += '<td data-label="approver" style="font-size:10px">' + escapeHtml(r.approved_by || '-') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    document.getElementById('prof-body').innerHTML = html;
    if (emp.employee_id) loadProfileMonthCal(emp.employee_id);
  }

  const MONTHCAL_STATUS = {
    present:  ['#EFF6FF', '#3B82F6', 'มา'],
    late:     ['#FEF3C7', '#F59E0B', 'สาย'],
    off:      ['#F1F5F9', '#94A3B8', 'หยุด'],
    leave:    ['#E6F7F5', '#0F766E', 'ลา'],
    wfh:      ['#EDE9FE', '#8B5CF6', 'WFH'],
    off_site: ['#FCE7F3', '#EC4899', 'นอกสถานที่'],
    missing:  ['#FEE2E2', '#DC2626', 'ขาด'],
    upcoming: ['#FFFFFF', '#E2E8F0', ''],
  };
  function loadProfileMonthCal(empId) {
    const now = new Date();
    google.script.run
      .withSuccessHandler(res => {
        const box = document.getElementById('prof-monthcal');
        if (!box) return;
        if (!res || !res.ok) { box.innerHTML = '<div class="empty-tab">โหลดปฏิทินไม่ได้' + (res && res.error ? ' · ' + escapeHtml(res.error) : '') + '</div>'; return; }
        box.innerHTML = renderMonthCal(res);
      })
      .withFailureHandler(err => {
        const box = document.getElementById('prof-monthcal');
        if (box) box.innerHTML = '<div class="empty-tab">โหลดปฏิทินไม่ได้ · ' + escapeHtml(err.message || String(err)) + '</div>';
      })
      .attendAdminMonthCalendar(empId, now.getFullYear(), now.getMonth() + 1);
  }
  function renderMonthCal(res) {
    const days = res.days || [];
    const s = res.summary || {};
    const dowLabels = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
    let html = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">โซน ' + escapeHtml(res.zone || '-') +
      ' · มา ' + (s.present || 0) + ' · หยุด ' + (s.off || 0) +
      ' · <span style="color:#DC2626">ขาด/ลืมเช็คอิน ' + (s.missing || 0) + '</span>' +
      (s.late_minutes ? ' · สายสะสม ' + s.late_minutes + ' น.' : '') + '</div>';
    html += '<div class="att-legend" style="margin-bottom:8px">' +
      ['present', 'late', 'off', 'leave', 'missing'].map(k => {
        const c = MONTHCAL_STATUS[k];
        return '<span class="att-legend-item"><span class="att-legend-sw" style="background:' + c[0] + ';border-left:3px solid ' + c[1] + '"></span>' + c[2] + '</span>';
      }).join('') + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">';
    html += dowLabels.map(d => '<div style="text-align:center;font-size:10px;color:var(--text-faint);font-weight:600">' + d + '</div>').join('');
    if (days.length) {
      for (let i = 0; i < days[0].dow; i++) html += '<div></div>';
    }
    days.forEach(d => {
      const c = MONTHCAL_STATUS[d.status] || MONTHCAL_STATUS.upcoming;
      const title = d.date + (d.detail ? ' · ' + d.detail : '');
      html += '<div title="' + escapeAttr(title) + '" style="background:' + c[0] + ';border-left:3px solid ' + c[1] +
        ';border-radius:5px;padding:5px 3px;min-height:42px;font-size:10px;line-height:1.25">' +
        '<div style="font-weight:600;color:#334155">' + d.day + '</div>' +
        (c[2] ? '<div style="color:' + c[1] + ';font-weight:600">' + escapeHtml(d.status === 'leave' ? (d.detail || 'ลา') : c[2]) + '</div>' : '') +
        ((d.status === 'present' || d.status === 'late') && d.detail ? '<div style="color:var(--text-faint);font-size:9px">' + escapeHtml(d.detail.split(' · ')[0]) + '</div>' : '') +
        '</div>';
    });
    html += '</div>';
    return html;
  }

  /* ===== ผูก fn ที่ inline onclick (ใน markup ของหน้านี้) ต้องเรียก → window ===== */
  window.otSetTab = otSetTab;
  window.reloadAll = reloadAll;
  window.otShowHelp = otShowHelp;
  window.HELP = HELP;
  window.calNav = calNav;
  window.calToday = calToday;
  window.openRecalc = openRecalc;
  window.closeRecalc = closeRecalc;
  window.runRecalc = runRecalc;
  window.openDayDetail = openDayDetail;
  window.closeDayDetail = closeDayDetail;
  window.dayOpenProfile = dayOpenProfile;
  window.openAnomModal = openAnomModal;
  window.closeAnomModal = closeAnomModal;
  window.reviewAnom = reviewAnom;
  window.loadCheckinPhoto = loadCheckinPhoto;
  window.loadOT = loadOT;
  window.approveOt = approveOt;
  window.rejectOt = rejectOt;
  window.closeOtReject = closeOtReject;
  window.confirmOtReject = confirmOtReject;
  window.openOtCreate = openOtCreate;
  window.closeOtCreate = closeOtCreate;
  window.confirmOtCreate = confirmOtCreate;
  window.loadOverview = loadOverview;
  window.exportCSV = exportCSV;
  window.openProfile = openProfile;
  window.closeProfModal = closeProfModal;

  // ===== Init (แก้จากเดิม: default = OT tab เพราะหน้านี้คือ "คำขอ OT") =====
  otSetTab('ot');
}
