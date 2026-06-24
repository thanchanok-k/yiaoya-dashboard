// _ported/timeattend.js — FULL native port of desktop time_attendance_manager.html (ลงเวลาเข้า-ออก / Time Attendance + OT)
// ลอกทั้งดุ้น: 4 tab (Calendar / Anomaly / OT Requests / OT Overview)
//   + 6 modals (anomaly review / day detail / recompute late / OT reject / OT create / employee profile)
//   CSS เดิม (_shared_styles ที่ใช้ + <style> หน้า manager) prefix ทุก selector ด้วย #ta กัน CSS รั่ว
//   markup คง element id เดิมทุกตัว (รันใน scope #ta) · JS หน้าเดิมรันใน scope ของ TA_RUN_PAGE_JS() verbatim
//   google.script.run = shim (Proxy) → TA_BACKEND (Supabase) · fn ที่ inline onclick ใช้ → ผูก window
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare (ใช้ของเราเอง ta2*/TA_ เท่านั้น)
// helper จาก _shared_scripts (ICONS/showToast/showHelp/escapeHtml/escapeAttr) inline เข้ามาใน RUN_PAGE_JS
//
// backend (Supabase edge fn hr_list?type=attendance.monthly) :
//   มีข้อมูลจริง = attendance.monthly (~355 records, payload: employee_id, period(YYYY-MM),
//                  ot_minutes, late_minutes, work_days, absent_days, [employee_name/branch_id ถ้ามี])
//   READ (real):
//     attendAdminListAttendance(range) → derive per-month/employee record list จาก attendance.monthly
//                                        (per-day check-in/out ไม่มีบน dashboard → ใช้ monthly aggregate)
//     attendAdminGetTeamOverview(opts) → derive overview (top emps, hours, day-type) จาก attendance.monthly
//   READ (stub, backend ไม่มี endpoint):
//     attendAdminListAnomaly → derive จาก late/absent ของ monthly (read-only highlight)
//     attendAdminListOTRequests / employee profile / month calendar/late → ว่าง/stub
//   WRITE/mutation (review/approve/reject/recompute/create OT/mark synced/export/photo) → stub + toast "ยังไม่พร้อม"
//
// render ได้แม้ data ว่าง (empty state สวย ไม่ error) · ผ่าน node --check

/* ============================================================
   TA_BACKEND — map google.script.run.<fn> → Supabase (type=attendance.monthly)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง
   ============================================================ */
var TA_FN = 'hr_list';
var TA_TYPE = 'attendance.monthly';

function ta2ToArr(v) { return Array.isArray(v) ? v : []; }
function ta2Num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

// cache รายการดิบล่าสุด (ให้ overview/anomaly/profile reuse)
var _ta2Rows = [];          // mapped monthly rows
var _ta2Fetched = false;

// map record ดิบ attendance.monthly → row shape ภายใน
function ta2MapMonthly(p) {
  p = p || {};
  var period = String(p.period || p.month || p.year_month || '').slice(0, 7);
  return {
    employee_id: p.employee_id || p.entity_id || p.id || '',
    employee_name: p.employee_name || p.name || p.nickname || p.employee_id || '—',
    branch_id: p.branch_id || p.primary_branch_id || '',
    branch_name: p.branch_name || p.branch || p.branch_id || '—',
    period: period,
    ot_minutes: ta2Num(p.ot_minutes),
    ot_hours: Math.round((ta2Num(p.ot_minutes) / 60) * 10) / 10,
    late_minutes: ta2Num(p.late_minutes),
    work_days: ta2Num(p.work_days),
    absent_days: ta2Num(p.absent_days),
    _raw: p,
  };
}

function ta2Fetch() {
  return sb.functions.invoke(TA_FN + '?type=' + encodeURIComponent(TA_TYPE) + '&limit=2000').then(function (res) {
    var data = (res && res.data) || {};
    _ta2Rows = ta2ToArr(data.items).map(ta2MapMonthly);
    _ta2Fetched = true;
    return _ta2Rows;
  }).catch(function (e) {
    console.warn('[TA_BACKEND] list fetch failed', e);
    _ta2Rows = [];
    _ta2Fetched = true;
    return [];
  });
}

// แปลง period (YYYY-MM) → record ที่หน้าเดิม Calendar tab ใช้ (date/employee_name/status/...)
// monthly aggregate ไม่มีรายวัน → สร้าง pseudo-record 1 อันต่อ (employee × period)
//   วางที่ "วันที่ 1 ของเดือน" · status = late ถ้า late_minutes>0, absent ถ้า work_days==0&&absent_days>0
function ta2MonthlyToRecords(rows) {
  return rows.map(function (r, i) {
    var status = 'present';
    if (r.work_days === 0 && r.absent_days > 0) status = 'absent';
    else if (r.late_minutes > 0) status = 'late';
    var dateStr = r.period ? (r.period + '-01') : '';
    return {
      record_id: (r.employee_id || 'emp') + '-' + (r.period || 'p') + '-' + i,
      employee_id: r.employee_id,
      employee_name: r.employee_name,
      date: dateStr,
      checkin_time: '—',
      checkout_time: '',
      checkin_method: 'monthly_summary',
      status: status,
      late_minutes: r.late_minutes,
      work_mode: 'on_site',
      flagged_for_review: false,
      anomaly_flags: '',
      checkin_lat: '', checkin_lng: '',
      checkin_photo_url: '', checkout_photo_url: '',
      _row: r,
    };
  });
}

var TA_BACKEND = {
  // ---- Calendar (real, derive จาก monthly) ----
  // หน้าเดิมส่ง {start_date,end_date} ISO → กรอง record ที่ date อยู่ในช่วง · คืน {items,stats,holidays}
  attendAdminListAttendance: function (range) {
    range = range || {};
    var fetchP = _ta2Fetched ? Promise.resolve(_ta2Rows) : ta2Fetch();
    return fetchP.then(function (rows) {
      var recs = ta2MonthlyToRecords(rows);
      var start = range.start_date ? new Date(range.start_date) : null;
      var end = range.end_date ? new Date(range.end_date) : null;
      var inRange = recs.filter(function (r) {
        if (!r.date) return false;
        if (!start && !end) return true;
        var d = new Date(r.date + 'T00:00:00');
        if (isNaN(d.getTime())) return false;
        if (start && d < start) return false;
        if (end && d >= end) return false;
        return true;
      });
      // stats
      var stats = {
        total: inRange.length,
        present: inRange.filter(function (r) { return r.status === 'present'; }).length,
        late: inRange.filter(function (r) { return r.status === 'late'; }).length,
        wfh: inRange.filter(function (r) { return r.status === 'wfh'; }).length,
        flagged: inRange.filter(function (r) { return r.flagged_for_review; }).length,
        total_regular_hours: 0,
        total_ot_hours: inRange.reduce(function (s, r) { return s + ((r._row && r._row.ot_hours) || 0); }, 0),
      };
      return { items: inRange, stats: stats, holidays: [] };
    });
  },

  // ---- Anomaly (derive จาก late/absent ของ monthly · read-only highlight) ----
  attendAdminListAnomaly: function () {
    var fetchP = _ta2Fetched ? Promise.resolve(_ta2Rows) : ta2Fetch();
    return fetchP.then(function (rows) {
      var items = [];
      rows.forEach(function (r, i) {
        var flags = [];
        if (r.absent_days > 0) flags.push('absent_days:' + r.absent_days);
        if (r.late_minutes > 0) flags.push('late_minutes:' + r.late_minutes);
        if (!flags.length) return;
        items.push({
          record_id: (r.employee_id || 'emp') + '-' + (r.period || 'p') + '-anom-' + i,
          employee_id: r.employee_id,
          employee_name: r.employee_name,
          date: r.period ? (r.period + '-01') : '—',
          checkin_time: '—',
          checkout_time: '',
          checkin_method: 'monthly_summary',
          checkin_lat: '', checkin_lng: '',
          work_mode: 'on_site',
          status: (r.late_minutes > 0 ? 'late' : 'absent'),
          late_minutes: r.late_minutes,
          anomaly_flags: flags.join('|'),
          checkin_photo_url: '',
          reviewed_by: '',
          reviewed_at: '',
          approval_status: '',
        });
      });
      return { items: items };
    });
  },

  // ---- OT Requests (backend ไม่มี endpoint บนหน้านี้ → ว่าง) ----
  attendAdminListOTRequests: function () {
    return Promise.resolve({ items: [], stats: { pending: 0, total_approved_hours: 0 } });
  },

  // ---- OT Overview (real, derive จาก monthly ot_minutes) ----
  attendAdminGetTeamOverview: function (opts) {
    opts = opts || {};
    var fetchP = _ta2Fetched ? Promise.resolve(_ta2Rows) : ta2Fetch();
    return fetchP.then(function (rows) {
      var period = opts.period || (function () {
        // default = period ที่มากสุดในข้อมูล หรือเดือนปัจจุบัน
        var ps = rows.map(function (r) { return r.period; }).filter(Boolean).sort();
        return ps.length ? ps[ps.length - 1] : new Date().toISOString().slice(0, 7);
      })();
      var inP = rows.filter(function (r) { return r.period === period; });
      var totalOt = inP.reduce(function (s, r) { return s + r.ot_hours; }, 0);
      var activeOt = inP.filter(function (r) { return r.ot_hours > 0; }).length;

      var byEmp = {};
      inP.forEach(function (r) {
        if (!r.employee_id) return;
        if (!byEmp[r.employee_id]) byEmp[r.employee_id] = { employee_id: r.employee_id, name: r.employee_name, branch: r.branch_name || '—', ot_hours: 0, ot_days: 0 };
        byEmp[r.employee_id].ot_hours += r.ot_hours;
        byEmp[r.employee_id].ot_days += r.work_days;
      });
      var tops = Object.keys(byEmp).map(function (k) {
        var e = byEmp[k]; e.ot_hours = Math.round(e.ot_hours * 10) / 10; return e;
      }).filter(function (e) { return e.ot_hours > 0; })
        .sort(function (a, b) { return b.ot_hours - a.ot_hours; }).slice(0, 10);

      return {
        period: period,
        stats: {
          total_ot_hours: Math.round(totalOt * 10) / 10,
          active_ot_employees: activeOt,
          cap_warnings_count: 0,
          pre_approved_pct: 0,
          post_hoc_pct: 0,
          unsynced_count: 0,
        },
        top_employees: tops,
        cap_warnings: [],
        day_type_distribution: { regular: Math.round(totalOt * 10) / 10, weekly_off: 0, public_holiday: 0, company_holiday: 0 },
      };
    });
  },

  // ---- active employees (derive จาก monthly rows) ----
  attendAdminListActiveEmployees: function () {
    var fetchP = _ta2Fetched ? Promise.resolve(_ta2Rows) : ta2Fetch();
    return fetchP.then(function (rows) {
      var seen = {}, out = [];
      rows.forEach(function (r) {
        if (r.employee_id && !seen[r.employee_id]) {
          seen[r.employee_id] = true;
          out.push({ employee_id: r.employee_id, first_name: r.employee_name, nickname: r.employee_name });
        }
      });
      return out;
    });
  },

  // ---- employee profile (derive 12-month จาก monthly) ----
  attendAdminGetEmployeeProfile: function (employeeId) {
    var fetchP = _ta2Fetched ? Promise.resolve(_ta2Rows) : ta2Fetch();
    return fetchP.then(function (rows) {
      var mine = rows.filter(function (r) { return r.employee_id === employeeId; });
      if (!mine.length) return { error: 'ไม่พบข้อมูลพนักงาน' };
      var first = mine[0];
      var totalOt = mine.reduce(function (s, r) { return s + r.ot_hours; }, 0);
      var monthly = mine.slice().sort(function (a, b) { return (a.period || '').localeCompare(b.period || ''); })
        .map(function (r) { return { year_month: r.period, ot_hours: r.ot_hours }; });
      return {
        employee: {
          employee_id: first.employee_id, name: first.employee_name,
          position_id: '', primary_branch_id: first.branch_name, line_linked: false,
        },
        ot_stats: { total_ot_hours: Math.round(totalOt * 10) / 10, total_approved: mine.length, pre_approved_pct: 0, post_hoc_pct: 0 },
        anomaly_count: mine.filter(function (r) { return r.absent_days > 0 || r.late_minutes > 0; }).length,
        cap_status: { this_week_hours: 0, weekly_cap: 36, utilization_pct: 0, warning: false },
        day_type_breakdown: { regular: Math.round(totalOt * 10) / 10, weekly_off: 0, public_holiday: 0, company_holiday: 0 },
        monthly: monthly,
        recent_requests: [],
      };
    });
  },

  // ---- per-person month aggregates (derive จาก monthly · late accumulate) ----
  attendAdminMonthLate: function (employeeId) {
    var fetchP = _ta2Fetched ? Promise.resolve(_ta2Rows) : ta2Fetch();
    return fetchP.then(function (rows) {
      var mine = rows.filter(function (r) { return r.employee_id === employeeId; });
      if (!mine.length) return { ok: false };
      var latest = mine.slice().sort(function (a, b) { return (b.period || '').localeCompare(a.period || ''); })[0];
      var cap = 180;
      return {
        ok: true, zone_label: '—', grace: 0,
        late_minutes_month: latest.late_minutes, late_cap: cap,
        late_days: latest.late_minutes > 0 ? 1 : 0,
        late_over_cap: latest.late_minutes > cap,
      };
    });
  },

  attendAdminMonthCalendar: function () {
    // per-day calendar ไม่มีบน dashboard (monthly aggregate เท่านั้น)
    return Promise.resolve({ ok: true, zone: '—', days: [], summary: { present: 0, off: 0, missing: 0, late_minutes: 0 } });
  },

  // ---- mutations / write → stub + toast ----
  attendAdminReviewAnomaly: function () { ta2NotReady('Review anomaly (approve/reject)'); return Promise.resolve({ error: 'review ยังไม่พร้อมบน dashboard (read-only)' }); },
  attendAdminRecomputeLate: function () { ta2NotReady('คำนวณสายใหม่'); return Promise.resolve({ error: 'คำนวณสายใหม่ยังไม่พร้อมบน dashboard (read-only)' }); },
  attendAdminApproveOT: function () { ta2NotReady('Approve OT'); return Promise.resolve({ error: 'approve OT ยังไม่พร้อมบน dashboard' }); },
  attendAdminRejectOT: function () { ta2NotReady('Reject OT'); return Promise.resolve({ error: 'reject OT ยังไม่พร้อมบน dashboard' }); },
  attendAdminCreateOT: function () { ta2NotReady('สร้าง OT request'); return Promise.resolve({ error: 'สร้าง OT ยังไม่พร้อมบน dashboard (read-only)' }); },
  attendAdminExportOT: function () { ta2NotReady('Export CSV'); return Promise.resolve({ error: 'export CSV ยังไม่พร้อมบน dashboard' }); },
  attendAdminMarkSynced: function () { ta2NotReady('Mark synced'); return Promise.resolve({ error: 'mark synced ยังไม่พร้อมบน dashboard' }); },
  attendAdminGetCheckinPhoto: function () { ta2NotReady('ดูรูปเช็คอิน'); return Promise.resolve({ ok: false, error: 'รูปเช็คอินยังไม่พร้อมบน dashboard' }); },
};

var _ta2NotReadyShown = {};
function ta2NotReady(feature) {
  if (_ta2NotReadyShown[feature]) return;
  _ta2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ta2Toast) window.ta2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountTimeattend — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountTimeattend() {
  if (!document.getElementById('wrap-timeattend')) return;
  var wrap = document.getElementById('wrap-timeattend');
  wrap.innerHTML = '<style>' + TA_CSS() + '</style><div id="ta">' + TA_MARKUP() + '</div>';
  TA_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #ta =====
   ตัด .app-shell/sidebar/main-area/topbar shell ออก (dashboard มี shell แล้ว) */
function TA_CSS() {
  return [
    // tokens (มาจาก _shared_styles)
    '#ta{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--teal-light:#E0F7F4;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEE2E2;--success:#047857;--warning:#B45309;--info:#1E40AF;color:var(--text);font-size:13px;line-height:1.5}',
    '#ta *{box-sizing:border-box}',
    // buttons (จาก _shared_styles)
    '#ta .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#ta .btn:hover{border-color:var(--navy)}',
    '#ta .btn svg{width:14px;height:14px}',
    '#ta .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#ta .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#ta .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#ta .btn-sm{padding:5px 10px;font-size:12px}',
    '#ta .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:8px;background:#fff;color:var(--text-muted);cursor:pointer}',
    '#ta .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#ta .btn-help svg{width:14px;height:14px}',
    // page head (native บน dashboard)
    '#ta .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#ta .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ta .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#ta .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ta .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center;flex-wrap:wrap}',
    // data-table (จาก _shared_styles · scope #ta)
    '#ta .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#ta .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#ta .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#ta .data-table tr:last-child td{border-bottom:0}',
    '#ta .data-table tr:hover td{background:#FAFBFC}',
    '#ta .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // ===== <style> หน้า manager (verbatim · prefix #ta) =====
    '#ta .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#ta .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#ta .stats{grid-template-columns:repeat(2,1fr)}}',
    '#ta .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#ta .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#ta .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#ta .stat-card .v{font-size:22px;font-weight:600;line-height:1;margin-top:4px}',
    '#ta .stat-card.warning .v{color:var(--warning)}',
    '#ta .stat-card.danger .v{color:var(--danger)}',
    '#ta .stat-card.success .v{color:var(--success)}',
    '#ta .stat-card.info .v{color:var(--info)}',
    '#ta .tabs{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}',
    '#ta .tab{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '#ta .tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#ta .tab svg{width:13px;height:13px}',
    '#ta .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#ta .tab.active .cnt{background:var(--navy)}',
    '#ta .tab.tab-anomaly.active .cnt{background:var(--danger)}',
    '#ta .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#ta .filter{display:flex;flex-direction:column;gap:2px}',
    '#ta .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#ta .filter input,#ta .filter select{padding:4px 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:140px}',
    // Calendar week
    '#ta .cal-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
    '#ta .cal-period{font-size:14px;font-weight:600;min-width:220px;text-align:center}',
    '#ta .cal-week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}',
    '#ta .cal-day{background:#fff;border:.5px solid var(--border);border-radius:6px;min-height:140px}',
    '#ta .cal-day-head{padding:5px 8px;border-bottom:.5px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:#F8FAFC;font-size:10px}',
    '#ta .cal-day-name{font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#ta .cal-day-num{font-size:13px;font-weight:600}',
    '#ta .cal-day.today{border-color:var(--teal)}',
    '#ta .cal-day.today .cal-day-num{color:var(--teal)}',
    '#ta .cal-day-body{padding:4px;display:flex;flex-direction:column;gap:3px;max-height:200px;overflow-y:auto}',
    '@media (max-width:600px){#ta .cal-week{grid-template-columns:1fr;gap:8px}#ta .cal-day{min-height:auto}#ta .cal-day-head{font-size:12px;padding:8px 12px}#ta .cal-day-body{max-height:none}}',
    '@media (max-width:600px){#ta .stack-table{display:block;overflow-x:visible;white-space:normal}#ta .stack-table thead{display:none}#ta .stack-table tbody,#ta .stack-table tr,#ta .stack-table td{display:block;width:100%}#ta .stack-table tr{border:.5px solid var(--border);border-radius:10px;margin-bottom:8px;background:#fff;padding:4px 0}#ta .stack-table td{display:flex;justify-content:space-between;gap:12px;padding:6px 12px;border:none;text-align:right}#ta .stack-table td::before{content:attr(data-label);color:var(--text-muted);font-weight:600;text-align:left}#ta .stack-table td:first-child{font-weight:600;color:var(--navy);border-bottom:.5px solid var(--border)}}',
    '#ta .att-pill{padding:3px 6px;border-radius:3px;font-size:10px;cursor:pointer;line-height:1.3;border-left:2px solid var(--info);background:#EFF6FF}',
    '#ta .att-pill.late{background:#FEF3C7;color:#92400E;border-left-color:#F59E0B}',
    '#ta .att-pill.absent{background:#FEE2E2;color:#991B1B;border-left-color:var(--danger)}',
    '#ta .att-pill.wfh{background:#EDE9FE;color:#5B21B6;border-left-color:#8B5CF6}',
    '#ta .att-pill.off_site{background:#FCE7F3;color:#BE185D;border-left-color:#EC4899}',
    '#ta .att-pill.flagged{border-left-width:4px;border-left-color:var(--danger)}',
    '#ta .att-pill .late-min{color:#92400E;font-weight:600}',
    '#ta .att-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin:0 0 12px;font-size:11px;color:var(--text-muted)}',
    '#ta .att-legend-item{display:inline-flex;align-items:center;gap:5px}',
    '#ta .att-legend-sw{display:inline-block;width:16px;height:12px;border-radius:2px}',
    '#ta .pill{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;display:inline-block}',
    '#ta .pill-present{background:#DBEAFE;color:#1E40AF}',
    '#ta .pill-late{background:#FEF3C7;color:#92400E}',
    '#ta .pill-absent{background:#FEE2E2;color:#991B1B}',
    '#ta .pill-wfh{background:#EDE9FE;color:#5B21B6}',
    '#ta .pill-off_site{background:#FCE7F3;color:#BE185D}',
    '#ta .pill-pending{background:#FEF3C7;color:#92400E}',
    '#ta .pill-approved{background:#DCFCE7;color:#166534}',
    '#ta .pill-rejected{background:#FEE2E2;color:#991B1B}',
    '#ta .pill-completed{background:#DBEAFE;color:#1E40AF}',
    '#ta .pill-regular{background:#F1F5F9;color:var(--text-muted)}',
    '#ta .pill-weekly_off{background:#FCE7F3;color:#BE185D}',
    '#ta .pill-public_holiday{background:#FEE2E2;color:#991B1B}',
    '#ta .pill-company_holiday{background:#FEF3C7;color:#92400E}',
    '#ta .anom-card{background:#fff;border:.5px solid var(--border);border-left:4px solid var(--danger);border-radius:6px;padding:12px 14px;margin-bottom:8px}',
    '#ta .anom-card.reviewed{border-left-color:var(--success);opacity:.7}',
    '#ta .anom-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}',
    '#ta .anom-flags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}',
    '#ta .anom-flag{font-size:9px;padding:1px 6px;background:var(--danger-bg);color:var(--danger);border-radius:8px;font-weight:600}',
    '#ta .ot-card{background:#fff;border:.5px solid var(--border);border-left:4px solid #F59E0B;border-radius:6px;padding:12px 14px;margin-bottom:8px}',
    '#ta .ot-card.approved{border-left-color:var(--success)}',
    '#ta .ot-card.rejected{border-left-color:var(--danger);opacity:.6}',
    '#ta .ot-actions{display:flex;gap:6px;margin-top:8px}',
    // modal
    '#ta .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#ta .modal-bg.active{display:flex}',
    '#ta .modal{background:#fff;border-radius:12px;max-width:580px;width:92%;max-height:92vh;overflow-y:auto}',
    '#ta .modal.large{max-width:880px}',
    '#ta .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#ta .modal-header h2{font-size:16px;margin:0}',
    '#ta .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#ta .modal-body{padding:16px 20px}',
    '#ta .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '#ta .field{margin-bottom:12px}',
    '#ta .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#ta .field input,#ta .field select,#ta .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box}',
    // profile grid
    '#ta .prof-grid{display:grid;grid-template-columns:1fr 2fr;gap:16px}',
    '@media (max-width:600px){#ta .prof-grid{grid-template-columns:1fr}}',
    '#ta .prof-card{background:#F8FAFC;border-radius:8px;padding:14px}',
    '#ta .prof-card-title{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:8px}',
    '#ta .prof-row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}',
    '#ta .prof-row .l{color:var(--text-muted)}',
    '#ta .prof-row .v{font-weight:500}',
    '#ta .month-bars{display:grid;grid-template-columns:repeat(12,1fr);gap:3px;height:80px;align-items:end;margin-top:10px}',
    '#ta .month-bar{background:linear-gradient(180deg,#3DC5B7 0%,#2BA89B 100%);border-radius:3px 3px 0 0;min-height:4px;cursor:pointer;position:relative}',
    '#ta .month-bar:hover{background:var(--teal-dark)}',
    '#ta .month-bar-label{position:absolute;bottom:-16px;left:0;right:0;font-size:8px;color:var(--text-faint);text-align:center}',
    '#ta .cap-bar{display:flex;align-items:center;gap:8px;margin:8px 0}',
    '#ta .cap-progress{flex:1;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden}',
    '#ta .cap-fill{height:100%;background:var(--success);transition:width .3s}',
    '#ta .cap-fill.warn{background:var(--warning)}',
    '#ta .cap-fill.danger{background:var(--danger)}',
    '#ta .empty-tab{padding:30px 20px;text-align:center;color:var(--text-muted);font-size:12px}',
    '#ta .warn-row{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-radius:6px;background:#FEF2F2;margin-bottom:6px;font-size:12px}',
    '#ta .warn-row .pct{font-weight:700;color:var(--danger)}',
    '#ta .top-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:.5px solid var(--border);cursor:pointer}',
    '#ta .top-row:hover{background:#F8FAFC}',
    '#ta .top-rank{font-size:16px;font-weight:700;color:var(--text-muted);min-width:30px;text-align:center}',
    '#ta .top-name{flex:1;font-size:13px;font-weight:500}',
    '#ta .top-bar{flex:2;height:8px;background:#F1F5F9;border-radius:4px;overflow:hidden;max-width:200px}',
    '#ta .top-bar-fill{height:100%;background:var(--info)}',
    '#ta .top-hours{min-width:80px;text-align:right;font-size:13px;font-weight:600}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + tabs + content + 6 modals =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/topbar/brand_footer/app-shell ออก
   (topbar-actions เดิม → ย้าย help/refresh มาไว้ใน page-actions โดยตรง) */
function TA_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    '      ลงเวลาเข้า-ออก · Time Attendance + OT',
    '    </h1>',
    '    <div class="subtitle">Check-in/out · OT request · ลิงค์ JERA fingerprint · LINE LIFF GPS</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn" data-tip="คู่มือการใช้หน้านี้"></button>',
    '    <button class="btn btn-sm" onclick="reloadAll()" id="refresh-btn"></button>',
    '  </div>',
    '</header>',
    // tabs
    '<div class="tabs">',
    '  <button class="tab active" id="tab-calendar" onclick="setTab(\'calendar\')"></button>',
    '  <button class="tab tab-anomaly" id="tab-anomaly" onclick="setTab(\'anomaly\')"></button>',
    '  <button class="tab" id="tab-ot" onclick="setTab(\'ot\')"></button>',
    '  <button class="tab" id="tab-overview" onclick="setTab(\'overview\')"></button>',
    '</div>',
    '<div id="content" class="loading">กำลังโหลด...</div>',
    TA_MODALS(),
  ].join('\n');
}

/* 6 modals · คง element id เดิม */
function TA_MODALS() {
  return [
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
    // Calendar day detail
    '<div class="modal-bg" id="day-bg" onclick="if(event.target===this)closeDayDetail()">',
    '  <div class="modal" style="max-width:420px">',
    '    <div class="modal-header"><h2 id="day-title">รายละเอียดวัน</h2><p id="day-sub">—</p></div>',
    '    <div class="modal-body"><div id="day-detail"></div></div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeDayDetail()">ปิด</button>',
    '      <button class="btn btn-primary" id="day-profile-btn" onclick="dayOpenProfile()">ดูโปรไฟล์เต็ม</button>',
    '    </div>',
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
    '      <div style="display:flex;gap:6px">',
    '        <button class="btn" id="rc-preview-btn" onclick="runRecalc(true)">ดูตัวอย่าง</button>',
    '        <button class="btn btn-primary" id="rc-apply-btn" onclick="runRecalc(false)" disabled>ยืนยันคำนวณจริง</button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>',
    // OT reject modal
    '<div class="modal-bg" id="otreject-bg" onclick="if(event.target===this)closeOtReject()">',
    '  <div class="modal" style="max-width:380px">',
    '    <div class="modal-header"><h2>Reject OT request</h2><p id="otreject-sub">—</p></div>',
    '    <div class="modal-body"><div class="field"><label>เหตุผล *</label><textarea id="otreject-reason" rows="3"></textarea></div></div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeOtReject()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="confirmOtReject()" style="background:var(--danger);border-color:var(--danger);color:#fff">Reject</button>',
    '    </div>',
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
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeOtCreate()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="confirmOtCreate()" id="otc-save-btn"></button>',
    '    </div>',
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
   TA_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → TA_BACKEND
   helper (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function TA_RUN_PAGE_JS() {

  // ---- google.script.run shim → TA_BACKEND (async, คืน shape เดิม) ----
  function _ta2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (TA_BACKEND[prop]) {
            Promise.resolve().then(function () { return TA_BACKEND[prop].apply(TA_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[TA_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[TA_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ta2MakeChain(); } });

  // ---- helpers (inline) ----
  const ICONS = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" x2="19" y1="12" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('ta2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ta2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ta2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('ta-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'ta-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'ta-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'ta-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม time_attendance_manager.html (ลอกทั้งดุ้น) =====
     document.getElementById → getById (scope ใต้ #ta) · document.querySelectorAll → scoped
     ==================================================================== */
  const _taRoot = document.getElementById('ta');
  function getById(id) { return _taRoot ? _taRoot.querySelector('#' + id) : document.getElementById(id); }
  function qsa(sel) { return _taRoot ? _taRoot.querySelectorAll(sel) : document.querySelectorAll(sel); }

  let currentTab = 'calendar';
  let calAnchor = new Date();
  let allData = {};
  let currentAnomalyRecord = null;
  let currentOtToReject = null;
  let employeesCache = [];

  const HELP = {
    title: 'ลงเวลาเข้า-ออก · Time Attendance + OT',
    subtitle: 'Sheets: 22 + 22a · บน dashboard ใช้ attendance.monthly (สรุปรายเดือน)',
    intro: 'ระบบบันทึกเวลาทำงาน · 6 anti-cheat layers · รองรับ on-site/WFH/off-site · OT workflow · HR monitoring · บน dashboard นี้เป็น read-only (สรุปรายเดือน)',
    sections: [
      { title: '4 tabs', items: [
        '<strong>Calendar</strong> — week view เห็นใครมา/ขาด/ลา · คลิก pill เปิด detail',
        '<strong>Anomaly review</strong> — flagged records ที่ระบบ detect ผิดธรรมชาติ · HR review approve/reject',
        '<strong>OT Requests</strong> — pending approve queue · สร้าง OT ทีมได้',
        '<strong>OT Overview</strong> — team aggregate dashboard + cap warnings + export CSV ให้บัญชี',
      ]},
      { title: 'Anti-cheat layers', items: [
        '1. <strong>GPS</strong> + radius (default 100m) เทียบกับ branch.lat/lng',
        '2. <strong>Photo selfie</strong> + face match score',
        '3. <strong>LINE userId binding</strong> — proxy checkin ไม่ได้',
        '4. <strong>Server time only</strong> — ห้าม trust client clock',
        '5. <strong>Device fingerprint</strong> — track เปลี่ยน device',
        '6. <strong>Anomaly detection</strong> — weekly cron scan pattern แปลก',
      ]},
      { title: 'Work modes', items: [
        '<strong>on_site</strong> — สาขา · GPS + photo บังคับ',
        '<strong>wfh</strong> — work from home · ไม่บังคับ GPS · ใส่ task summary หลังจบวัน',
        '<strong>off_site_visit</strong> — ออกไปทำงานนอก · ใส่ visit purpose + location',
        '<strong>hybrid</strong> — เช้าสาขา บ่าย WFH',
      ]},
      { title: 'OT workflow', items: [
        '<strong>Path A:</strong> Manager สร้างให้ทีมล่วงหน้า → auto-approved',
        '<strong>Path B:</strong> Employee ขอเอง → manager approve',
        '<strong>Path C:</strong> Auto-detect post-hoc (checkout เกิน) → flag pending',
        '<strong>Path D:</strong> Public holiday → auto OT (rate 2x/3x — บัญชีคำนวณ)',
        'Cap: <strong>36 ชม./สัปดาห์</strong> (กฎหมาย hard block)',
      ]},
      { type: 'warn', title: 'หมายเหตุบน dashboard', items: [
        'แสดงข้อมูลจริงจาก <strong>attendance.monthly</strong> (สรุปรายเดือน: ชม. OT, สาย, วันทำงาน, วันขาด)',
        'รายละเอียดรายวัน/รูปเช็คอิน/GPS ไม่มีบน dashboard นี้ — pseudo-record วางที่วันที่ 1 ของเดือน',
        'การ review/approve/reject/คำนวณสายใหม่/สร้าง OT/export ยังไม่พร้อม (read-only) — กดแล้วขึ้นแจ้งเตือน',
      ]},
    ],
  };

  // ===== header / tab labels =====
  getById('refresh-btn').innerHTML = ICONS.refresh;
  getById('help-btn').innerHTML = ICONS.help;
  getById('otc-save-btn').innerHTML = ICONS.save + ' สร้าง';

  getById('tab-calendar').innerHTML = ICONS.cal + ' Calendar';
  getById('tab-anomaly').innerHTML = ICONS.alert + ' Anomaly <span class="cnt" id="cnt-anomaly">—</span>';
  getById('tab-ot').innerHTML = ICONS.briefcase + ' OT Requests <span class="cnt" id="cnt-ot">—</span>';
  getById('tab-overview').innerHTML = ICONS.chart + ' OT Overview';

  function setTab(tab) {
    currentTab = tab;
    qsa('.tabs .tab').forEach(b => b.classList.remove('active'));
    getById('tab-' + tab).classList.add('active');
    if (tab === 'calendar') loadCalendar();
    else if (tab === 'anomaly') loadAnomaly();
    else if (tab === 'ot') loadOT();
    else if (tab === 'overview') loadOverview();
  }

  function reloadAll() { setTab(currentTab); }

  // ====== Calendar tab ======
  function loadCalendar() {
    const range = getWeekRange(calAnchor);
    getById('content').innerHTML = renderCalShell(range) + '<div class="loading">กำลังโหลด...</div>';
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
        const wrapEl = getById('cal-body-wrap');
        if (wrapEl) wrapEl.outerHTML = renderWeek(range, byDay, holByDay);
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
    getById('recalc-bg').classList.add('active');
    getById('rc-result').innerHTML = '';
    getById('rc-apply-btn').disabled = true;
    const range = getWeekRange(calAnchor);
    getById('rc-from').value = fmtDateKey(range.start);
    getById('rc-to').value = fmtDateKey(new Date(range.end - 86400000));
    const fill = (emps) => {
      const sel = getById('rc-emp');
      sel.innerHTML = '<option value="">— ทุกคน —</option>' +
        (emps || []).map(e => '<option value="' + escapeAttr(e.employee_id) + '">' +
          escapeHtml((e.nickname || e.first_name) + ' (' + e.employee_id + ')') + '</option>').join('');
    };
    if (employeesCache.length) fill(employeesCache);
    else google.script.run.withSuccessHandler(emps => { employeesCache = emps || []; fill(employeesCache); })
          .attendAdminListActiveEmployees();
  }
  function closeRecalc() { getById('recalc-bg').classList.remove('active'); }

  function runRecalc(dryRun) {
    const from = getById('rc-from').value;
    const to = getById('rc-to').value;
    const empId = getById('rc-emp').value;
    if (!from || !to) return showToast('เลือกช่วงวันที่ก่อน', 'error');
    if (from > to) return showToast('วันเริ่มต้องไม่เกินวันสิ้นสุด', 'error');
    const pbtn = getById('rc-preview-btn');
    const abtn = getById('rc-apply-btn');
    pbtn.disabled = true; abtn.disabled = true;
    getById('rc-result').innerHTML = '<div class="loading">กำลังคำนวณ...</div>';
    google.script.run
      .withSuccessHandler(res => {
        pbtn.disabled = false;
        if (!res || res.error) {
          getById('rc-result').innerHTML = '';
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
        getById('rc-result').innerHTML = '';
        showToast(err.message, 'error');
      })
      .attendAdminRecomputeLate({ from: from, to: to, employee_id: empId, dryRun: dryRun });
  }

  function renderRecalcResult(res) {
    if (!res.changed) {
      getById('rc-result').innerHTML =
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
    getById('rc-result').innerHTML = h;
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
    const el = getById('stats');
    if (el) el.innerHTML = html;
  }
  function statCard(label, val, cls) {
    return '<div class="stat-card ' + cls + '"><div class="l">' + escapeHtml(label) + '</div><div class="v">' + val + '</div></div>';
  }

  // ====== Anomaly tab ======
  function loadAnomaly() {
    getById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.anomaly = res;
        const items = res.items || [];
        getById('cnt-anomaly').textContent = items.filter(i => !i.reviewed_by).length;
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
        getById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminListAnomaly({ days: 30 });
  }

  function openAnomModal(recordId) {
    const r = allData.anomaly.items.find(x => x.record_id === recordId);
    if (!r) return;
    currentAnomalyRecord = r;
    getById('anom-bg').classList.add('active');
    getById('anom-title').textContent = 'Review · ' + r.employee_name;
    getById('anom-sub').textContent = r.date + ' · ' + r.work_mode;
    let detail = '<div style="background:#F8FAFC;padding:12px;border-radius:6px;margin-bottom:12px;font-size:12px;line-height:1.6">';
    detail += '<strong>Check-in:</strong> ' + escapeHtml(r.checkin_time) + ' (' + escapeHtml(r.checkin_method) + ')<br>';
    if (r.checkin_lat) detail += '<strong>GPS:</strong> ' + r.checkin_lat + ', ' + r.checkin_lng + '<br>';
    detail += '<strong>Status:</strong> ' + escapeHtml(r.status) + ' · <strong>Late:</strong> ' + r.late_minutes + ' min<br>';
    detail += '<strong>Flags:</strong> <span class="anom-flag">' + escapeHtml(r.anomaly_flags) + '</span>';
    if (r.checkin_photo_url) detail += '<br><button type="button" class="btn" onclick="loadCheckinPhoto(\'' + escapeAttr(r.checkin_photo_url) + '\')" style="margin-top:6px">ดูรูปเช็คอิน</button>';
    detail += '<div id="anom-photo" style="margin-top:8px"></div>';
    detail += '</div>';
    getById('anom-detail').innerHTML = detail;
    getById('anom-notes').value = '';
  }
  function loadCheckinPhoto(fileId, boxId) {
    const box = getById(boxId || 'anom-photo');
    if (box) box.innerHTML = '<span style="font-size:12px;color:#64748B">กำลังโหลดรูป...</span>';
    google.script.run
      .withSuccessHandler(r => {
        if (!r || !r.ok) { if (box) box.innerHTML = '<span style="font-size:12px;color:var(--danger)">' + escapeHtml((r && r.error) || 'โหลดรูปไม่สำเร็จ') + '</span>'; return; }
        if (box) box.innerHTML = '<img src="' + r.data_url + '" alt="check-in photo" style="max-width:100%;border-radius:8px;border:1px solid var(--border)">';
      })
      .withFailureHandler(e => { if (box) box.innerHTML = '<span style="font-size:12px;color:var(--danger)">' + escapeHtml((e && e.message) ? e.message : String(e)) + '</span>'; })
      .attendAdminGetCheckinPhoto(fileId);
  }
  function closeAnomModal() { getById('anom-bg').classList.remove('active'); currentAnomalyRecord = null; }

  var _dayProfileEmpId = null;
  function openDayDetail(recordId) {
    var items = (allData.calendar && allData.calendar.items) || [];
    var r = items.find(function (x) { return x.record_id === recordId; });
    if (!r) return;
    _dayProfileEmpId = r.employee_id;
    getById('day-bg').classList.add('active');
    getById('day-title').textContent = r.employee_name + ' · ' + (r.status || '');
    getById('day-sub').textContent = (r.date || '') + ' · ' + (r.work_mode || '');
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
      d += '<span style="color:#94A3B8">— ไม่มีรูปเช็คอิน/เช็คเอาท์ (สรุปรายเดือน) —</span>';
    }
    d += '<div id="day-photo" style="margin-top:8px"></div></div>';
    d += '<div id="day-late-accum" style="margin-top:10px;font-size:12px;color:var(--text-muted)">กำลังโหลดสายสะสม...</div>';
    getById('day-detail').innerHTML = d;
    google.script.run
      .withSuccessHandler(function (s) {
        var box = getById('day-late-accum');
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
      .withFailureHandler(function () { var b = getById('day-late-accum'); if (b) b.innerHTML = ''; })
      .attendAdminMonthLate(r.employee_id);
  }
  function closeDayDetail() { getById('day-bg').classList.remove('active'); }
  function dayOpenProfile() {
    closeDayDetail();
    if (_dayProfileEmpId && typeof openProfile === 'function') openProfile(_dayProfileEmpId);
  }
  function reviewAnom(decision) {
    if (!currentAnomalyRecord) return;
    const notes = getById('anom-notes').value;
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
    getById('content').innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">OT Requests</h3><button class="btn btn-primary btn-sm" onclick="openOtCreate()">' + ICONS.plus + ' สร้าง OT</button></div><div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.ot = res;
        const items = res.items || [];
        const stats = res.stats || {};
        getById('cnt-ot').textContent = stats.pending || 0;

        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">OT Requests · ' + (stats.pending || 0) + ' pending · ' + (stats.total_approved_hours || 0) + ' ชม. approved</h3><button class="btn btn-primary btn-sm" onclick="openOtCreate()">' + ICONS.plus + ' สร้าง OT</button></div>';
        if (!items.length) html += '<div class="empty-tab">ยังไม่มี OT requests (OT request ไม่มีบนหน้านี้ — ดูที่หน้า OT Requests แยก)</div>';
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
        getById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminListOTRequests({});
  }

  function approveOt(requestId) {
    if (!confirm('Approve OT request?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('Approved', 'success');
        loadOT();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminApproveOT(requestId);
  }
  function rejectOt(requestId, name) {
    currentOtToReject = requestId;
    getById('otreject-bg').classList.add('active');
    getById('otreject-sub').textContent = 'Reject ' + name;
    getById('otreject-reason').value = '';
  }
  function closeOtReject() { getById('otreject-bg').classList.remove('active'); currentOtToReject = null; }
  function confirmOtReject() {
    const reason = getById('otreject-reason').value;
    if (!reason) return showToast('ใส่เหตุผล', 'error');
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('Rejected', 'success');
        closeOtReject();
        loadOT();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminRejectOT(currentOtToReject, reason);
  }

  function openOtCreate() {
    getById('otcreate-bg').classList.add('active');
    getById('otc-date').valueAsDate = new Date();
    getById('otc-hours').value = 3;
    getById('otc-reason').value = '';
    if (employeesCache.length === 0) {
      google.script.run.withSuccessHandler(emps => {
        employeesCache = emps || [];
        const sel = getById('otc-emp');
        sel.innerHTML = '<option value="">— เลือกพนักงาน —</option>' +
          employeesCache.map(e => '<option value="' + escapeAttr(e.employee_id) + '">' +
            escapeHtml((e.nickname || e.first_name) + ' (' + e.employee_id + ')') + '</option>').join('');
      }).attendAdminListActiveEmployees();
    } else {
      const sel = getById('otc-emp');
      sel.innerHTML = '<option value="">— เลือกพนักงาน —</option>' +
        employeesCache.map(e => '<option value="' + escapeAttr(e.employee_id) + '">' +
          escapeHtml((e.nickname || e.first_name) + ' (' + e.employee_id + ')') + '</option>').join('');
    }
  }
  function closeOtCreate() { getById('otcreate-bg').classList.remove('active'); }
  function confirmOtCreate() {
    const empId = getById('otc-emp').value;
    const date = getById('otc-date').value;
    const hours = getById('otc-hours').value;
    const reason = getById('otc-reason').value;
    if (!empId || !date || !hours || !reason) return showToast('กรอกให้ครบ', 'error');
    getById('otc-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        getById('otc-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('สร้างแล้ว · ' + res.status, 'success');
        closeOtCreate();
        loadOT();
      })
      .withFailureHandler(err => {
        getById('otc-save-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .attendAdminCreateOT({
        employee_id: empId,
        ot_date: date,
        expected_hours: hours,
        reason: reason,
      });
  }

  // ====== OT Overview tab ======
  function loadOverview() {
    getById('content').innerHTML = '<div class="filters"><div class="filter"><label>Period</label><input id="ov-period" placeholder="2026-05" oninput="loadOverview()"></div></div><div class="loading">กำลังโหลด...</div>';
    const periodInput = getById('ov-period');
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

        html += '<div style="background:#fff;border:.5px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px">';
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
          html += '<div style="background:#fff;border:.5px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px">';
          html += '<h4 style="margin:0 0 10px;font-size:13px;color:var(--danger)">Cap warnings (สัปดาห์นี้ ใกล้เกิน ' + (res.cap_warnings[0] && res.cap_warnings[0].cap || 36) + ' ชม.)</h4>';
          res.cap_warnings.forEach(w => {
            html += '<div class="warn-row">';
            html += '<span>' + escapeHtml(w.name) + ' · <span class="pct">' + w.this_week_hours + '/' + w.cap + ' ชม.</span></span>';
            html += '<span class="pct">' + w.pct + '%</span>';
            html += '</div>';
          });
          html += '</div>';
        }

        html += '<div style="background:#fff;border:.5px solid var(--border);border-radius:8px;padding:14px;margin-bottom:14px">';
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

        html += '<div style="background:#F8FAFC;border:.5px solid var(--border);border-radius:8px;padding:14px">';
        html += '<h4 style="margin:0 0 6px;font-size:13px">Export for accounting</h4>';
        html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Download CSV ของ approved OT (period ' + (res.period || '') + ') · ส่งให้บัญชีคำนวณค่าตอบแทน</div>';
        html += '<button class="btn btn-primary btn-sm" onclick="exportCSV()">' + ICONS.download + ' Download CSV</button>';
        html += ' <span style="font-size:11px;color:var(--text-muted);margin-left:10px">unsynced: ' + (stats.unsynced_count || 0) + ' รายการ</span>';
        html += '</div>';

        getById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminGetTeamOverview(opts);
  }

  function exportCSV() {
    const period = (getById('ov-period').value) || '';
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
    getById('prof-bg').classList.add('active');
    getById('prof-name').textContent = 'กำลังโหลด...';
    getById('prof-body').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(d => {
        if (!d || d.error) return showToast(d && d.error || 'load failed', 'error');
        renderProfile(d);
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .attendAdminGetEmployeeProfile(employeeId);
  }
  function closeProfModal() { getById('prof-bg').classList.remove('active'); }

  function renderProfile(d) {
    const emp = d.employee || {};
    getById('prof-name').textContent = emp.name + ' · ' + emp.employee_id;
    getById('prof-sub').textContent = (emp.position_id || '-') + ' · ' + (emp.primary_branch_id || '-') + (emp.line_linked ? ' · LINE linked' : '');

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
        html += '<div class="month-bar" style="height:' + Math.max(4, h) + '%" title="' + m.year_month + ' · ' + m.ot_hours + ' ชม."><span class="month-bar-label">' + (m.year_month || '').substring(5) + '</span></div>';
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

    getById('prof-body').innerHTML = html;
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
        const box = getById('prof-monthcal');
        if (!box) return;
        if (!res || !res.ok) { box.innerHTML = '<div class="empty-tab">ปฏิทินรายวันไม่มีบน dashboard (สรุปรายเดือน)' + (res && res.error ? ' · ' + escapeHtml(res.error) : '') + '</div>'; return; }
        if (!(res.days || []).length) { box.innerHTML = '<div class="empty-tab">ปฏิทินรายวันไม่มีบน dashboard (สรุปรายเดือน)</div>'; return; }
        box.innerHTML = renderMonthCal(res);
      })
      .withFailureHandler(err => {
        const box = getById('prof-monthcal');
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

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, setTab, reloadAll,
    calNav, calToday, openRecalc, closeRecalc, runRecalc,
    openAnomModal, closeAnomModal, reviewAnom, loadCheckinPhoto,
    openDayDetail, closeDayDetail, dayOpenProfile,
    loadOT, approveOt, rejectOt, closeOtReject, confirmOtReject,
    openOtCreate, closeOtCreate, confirmOtCreate,
    loadOverview, exportCSV,
    openProfile, closeProfModal,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadCalendar();
  // Pre-load anomaly count
  google.script.run.withSuccessHandler(res => {
    if (res && res.items) { const el = getById('cnt-anomaly'); if (el) el.textContent = res.items.filter(i => !i.reviewed_by).length; }
  }).attendAdminListAnomaly({ days: 30 });
  google.script.run.withSuccessHandler(res => {
    if (res && res.stats) { const el = getById('cnt-ot'); if (el) el.textContent = res.stats.pending || 0; }
  }).attendAdminListOTRequests({});
}

/* expose mount เข้า window (index.html เรียก) */
window.mountTimeattend = mountTimeattend;
