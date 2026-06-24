// _ported/doctorshift.js — FULL native port of desktop doctor_shifts_manager.html (HR Announcement admin)
// ลอกทั้งดุ้น: stats(6) + tabs(calendar/replace/filled/doctors)
//   + calendar week/month view + replacement cards + filled table + doctor cards
//   + 3 modals (cancel+replacement / doctor profile+scorecard / supervisor rating)
//   CSS เดิม (_shared_styles base ที่ใช้ + <style> หน้า manager) prefix #dsh ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ DSH_RUN_PAGE_JS() · google.script.run = shim → DSH_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน DSH_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=doctor_shift.updated → {items}) :
//   list   → derive shifts/stats client-side จาก payload ล่าสุดต่อ shift (shift_id/employee_id/date/branch/time...)
//            ว่าง = empty state สวย ไม่ error
//   whoami → {ok:true, is_owner:true} (dashboard user = admin เต็มสิทธิ์)
//   open_replacement / filled / doctors → derive จาก list เดียวกัน (filter ตาม status)
//   cancel / find_replacement / set_rating / recompute / get_profile (เขียนกลับ/LINE)
//     → เขียนกลับ/multicast ไม่ได้บน dashboard → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   DSH_BACKEND — map google.script.run → Supabase edge fn hr_list (type=doctor_shift.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     doctorShiftListShifts({start,end})    → { items:[...], stats:{...} }
     doctorShiftListOpenReplacement()      → { items:[...], count }
     doctorShiftListFilled({days})         → { items:[...], count }
     doctorShiftListDoctors()              → { items:[...], count }
     doctorShiftGetProfile(id)             → { doctor, lifetime, history, recent_shifts, ... }
     doctorShiftCancel / FindReplacement / SetRating / RecomputeAll → stub
   ============================================================ */
var DSH_FN = 'hr_list';
var DSH_TYPE = 'doctor_shift.updated';

function dsh2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function dsh2Num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function dsh2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function dsh2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function dsh2Time(v) {
  if (!v) return '';
  var s = String(v);
  // strip seconds ถ้ามี (08:00:00 → 08:00)
  var m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? (m[1].padStart(2, '0') + ':' + m[2]) : s;
}

// map payload event ดิบ → shift row shape ที่ JS เดิมใช้ (calendar/replacement/filled)
function dsh2MapShift(p) {
  p = p || {};
  return {
    shift_id: p.shift_id || p.entity_id || p.id || '',
    shift_date: dsh2Date(p.shift_date || p.date),
    start_time: dsh2Time(p.start_time),
    end_time: dsh2Time(p.end_time),
    status: String(p.status || 'scheduled').toLowerCase(),
    employee_id: p.employee_id || p.doctor_id || '',
    doctor_name: p.doctor_name || p.employee_name || '',
    branch_id: p.branch_id || '',
    branch_name: p.branch_name || p.branch_id || '-',
    original_doctor_name: p.original_doctor_name || '',
    cancel_reason: p.cancel_reason || '',
    total_payment: dsh2Num(p.total_payment),
    // replacement-specific
    urgent: dsh2Bool(p.urgent),
    replacement_sent_count: dsh2Num(p.replacement_sent_count),
    replacement_request_at: p.replacement_request_at || '',
    replacement_age_label: p.replacement_age_label || '',
    replacement_filled_at: p.replacement_filled_at || '',
    _raw: p,
  };
}

// cache ของ shift ล่าสุดต่อ shift_id (dedupe · ใช้ทุก tab)
var _dsh2Shifts = [];
var _dsh2Raw = {};

// ดึง items ล่าสุด → dedupe ต่อ shift_id (hr_list dedupe ให้แล้ว แต่กันเหนียว)
function dsh2FetchShifts() {
  return sb.functions.invoke(DSH_FN + '?type=' + encodeURIComponent(DSH_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = dsh2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.shift_id || p.entity_id || p.id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      _dsh2Raw[id] = p;
      rows.push(dsh2MapShift(p));
    });
    _dsh2Shifts = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[DSH_BACKEND] list fetch failed', e);
    _dsh2Shifts = [];
    return [];
  });
}

// คำนวณ stats จาก shifts ทั้งหมด (ทุก status · ใช้ทั้ง set ไม่ใช่เฉพาะ range)
function dsh2Stats(rows) {
  var s = { total: 0, scheduled: 0, open_replacement: 0, filled: 0, cancelled: 0, total_payment: 0 };
  rows.forEach(function (r) {
    s.total++;
    if (r.status === 'scheduled') s.scheduled++;
    else if (r.status === 'open_for_replacement') s.open_replacement++;
    else if (r.status === 'filled') s.filled++;
    else if (r.status === 'cancelled') s.cancelled++;
    s.total_payment += dsh2Num(r.total_payment);
  });
  return s;
}

// derive รายชื่อหมอจาก shifts (group by employee_id) — backend ไม่มี roster endpoint แยก
function dsh2DeriveDoctors(rows) {
  var by = {};
  rows.forEach(function (r) {
    var id = r.employee_id;
    if (!id) return;
    if (!by[id]) {
      by[id] = {
        employee_id: id, name: r.doctor_name || id,
        position_id: (r._raw && (r._raw.position_id || r._raw.position_code)) || '',
        primary_branch_id: r.branch_id || (r._raw && r._raw.primary_branch_id) || '',
        line_linked: !!(r._raw && (r._raw.line_linked || r._raw.line_user_id)),
        shifts_scheduled: 0, _cancel: 0, reliability_score: 0,
        cancel_rate: 0, df_accuracy_pct: 0,
      };
    }
    by[id].shifts_scheduled++;
    if (r.status === 'cancelled') by[id]._cancel++;
    // ถ้า payload มี metric สำเร็จรูป ใช้ค่าล่าสุด
    if (r._raw) {
      if (r._raw.reliability_score != null) by[id].reliability_score = dsh2Num(r._raw.reliability_score);
      if (r._raw.df_accuracy_pct != null) by[id].df_accuracy_pct = dsh2Num(r._raw.df_accuracy_pct);
    }
  });
  return Object.keys(by).map(function (k) {
    var d = by[k];
    d.cancel_rate = d.shifts_scheduled ? Math.round(d._cancel / d.shifts_scheduled * 100) : 0;
    return d;
  });
}

var DSH_BACKEND = {
  // ---- list shifts (calendar) — { items, stats } ----
  doctorShiftListShifts: function (opts) {
    opts = opts || {};
    return dsh2FetchShifts().then(function (rows) {
      // filter ตาม range ถ้าส่งมา (calendar ส่ง ISO start/end)
      var items = rows;
      if (opts.start_date || opts.end_date) {
        var s = opts.start_date ? new Date(opts.start_date) : null;
        var e = opts.end_date ? new Date(opts.end_date) : null;
        items = rows.filter(function (r) {
          if (!r.shift_date) return false;
          var d = new Date(r.shift_date + 'T00:00:00');
          if (s && d < new Date(s.getFullYear(), s.getMonth(), s.getDate())) return false;
          if (e && d >= e) return false;
          return true;
        });
      }
      return { items: items, stats: dsh2Stats(rows) };
    });
  },
  // ---- open for replacement — { items, count } ----
  doctorShiftListOpenReplacement: function () {
    return dsh2FetchShifts().then(function (rows) {
      var items = rows.filter(function (r) { return r.status === 'open_for_replacement'; });
      return { items: items, count: items.length };
    });
  },
  // ---- filled by replacement — { items, count } ----
  doctorShiftListFilled: function (opts) {
    opts = opts || {};
    return dsh2FetchShifts().then(function (rows) {
      var days = dsh2Num(opts.days) || 60;
      var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
      var items = rows.filter(function (r) {
        if (r.status !== 'filled') return false;
        if (!r.shift_date) return true;
        var d = new Date(r.shift_date + 'T00:00:00');
        return isNaN(d.getTime()) || d >= cutoff;
      });
      return { items: items, count: items.length };
    });
  },
  // ---- doctors list — { items, count } ----
  doctorShiftListDoctors: function () {
    return dsh2FetchShifts().then(function (rows) {
      var items = dsh2DeriveDoctors(rows);
      return { items: items, count: items.length };
    });
  },
  // ---- doctor profile — derive จาก shifts ของหมอคนนั้น ----
  doctorShiftGetProfile: function (doctorId) {
    return dsh2FetchShifts().then(function (rows) {
      var mine = rows.filter(function (r) { return r.employee_id === doctorId; });
      var raw = (mine[0] && mine[0]._raw) || {};
      var scheduled = mine.length;
      var cancelledSelf = mine.filter(function (r) { return r.status === 'cancelled'; }).length;
      var completed = mine.filter(function (r) { return r.status === 'completed'; }).length;
      var taken = mine.filter(function (r) { return r.status === 'filled' && r.employee_id === doctorId; }).length;
      var cancelRate = scheduled ? Math.round(cancelledSelf / scheduled * 100) : 0;
      return {
        doctor: {
          employee_id: doctorId,
          first_name: raw.first_name || '', last_name: raw.last_name || '',
          nickname: raw.nickname || '', position_id: raw.position_id || raw.position_code || '',
          primary_branch_id: raw.primary_branch_id || raw.branch_id || '',
          start_date: dsh2Date(raw.start_date), phone: raw.phone || '', email: raw.email || '',
          line_linked: !!(raw.line_linked || raw.line_user_id),
        },
        lifetime: {
          avg_reliability: dsh2Num(raw.reliability_score),
          shifts_scheduled: scheduled, shifts_completed: completed,
          shifts_cancelled_self: cancelledSelf, shifts_taken_replacement: taken,
          cancel_rate: cancelRate, df_accuracy_pct: dsh2Num(raw.df_accuracy_pct),
        },
        reliability_badge: raw.reliability_badge || 'no_data',
        history: [],          // backend ไม่เก็บ scorecard รายเดือน → ว่าง (empty state)
        recent_shifts: [],    // backend ไม่ส่ง df_planned/actual ราย shift → ว่าง
        last_probation: null,
      };
    });
  },
  // ---- whoami — dashboard user = owner เต็มสิทธิ์ ----
  doctorShiftWhoAmI: function () { return Promise.resolve({ ok: true, is_owner: true }); },
  // ---- เขียนกลับ / LINE multicast / cron → stub ----
  doctorShiftCancel: function () {
    dsh2NotReady('Cancel + ส่งหา replacement');
    return Promise.resolve({ error: 'การ cancel เวร + ส่ง LINE ยังไม่พร้อมบน dashboard' });
  },
  doctorShiftFindReplacement: function () {
    dsh2NotReady('ส่ง LINE หา replacement');
    return Promise.resolve({ error: 'ส่ง LINE หาหมอแทนยังไม่พร้อมบน dashboard' });
  },
  doctorShiftSetRating: function () {
    dsh2NotReady('บันทึก supervisor rating');
    return Promise.resolve({ error: 'บันทึก rating ยังไม่พร้อมบน dashboard' });
  },
  doctorShiftRecomputeAll: function () {
    dsh2NotReady('Recompute scorecards');
    return Promise.resolve({ error: 'Recompute scorecard ยังไม่พร้อมบน dashboard' });
  },
};

var _dsh2NotReadyShown = {};
function dsh2NotReady(feature) {
  if (_dsh2NotReadyShown[feature]) return;
  _dsh2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.dsh2Toast) window.dsh2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountDoctorshift — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountDoctorshift() {
  var wrap = document.getElementById('wrap-doctorshift');
  if (!wrap) return;

  var CSS = DSH_CSS();
  var MARKUP = DSH_MARKUP();
  wrap.innerHTML = '<style>' + CSS + '</style><div id="dsh">' + MARKUP + '</div>';

  // รัน JS ของหน้าเดิม (closure scope · google = shim) → ผูก fn ที่ inline onclick ต้องใช้ ลง window
  DSH_RUN_PAGE_JS();
}

/* ===== CSS เดิม (base ที่หน้านี้ใช้ จาก _shared_styles + <style> manager) · prefix #dsh =====
   ตัด topbar/sidebar/app-shell/page-head shell ออก (dashboard มี shell แล้ว) */
function DSH_CSS() {
  return [
    // tokens (จาก _shared_styles)
    '#dsh{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--success:#047857;--info:#1D4ED8;color:var(--text);font-size:13px;line-height:1.5}',
    '#dsh *{box-sizing:border-box}',

    // ===== base shared: buttons / field / modal =====
    '#dsh .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#dsh .btn:hover{border-color:var(--navy)}',
    '#dsh .btn svg{width:14px;height:14px}',
    '#dsh .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#dsh .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#dsh .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#dsh .btn-sm{padding:5px 10px;font-size:12px}',
    '#dsh .btn-help{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;background:#fff;border:1px solid var(--border);color:var(--text-muted);cursor:pointer}',
    '#dsh .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#dsh .btn-help svg{width:16px;height:16px}',
    '#dsh .field{margin-bottom:12px}',
    '#dsh .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#dsh .field input,#dsh .field select,#dsh .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box}',
    '#dsh .field-help{font-size:10px;color:var(--text-faint);margin-top:3px}',
    // data-table (หน้านี้ใช้ใน Filled tab + profile — ไม่มีใน shared → ใส่เอง)
    '#dsh .data-table{width:100%;border-collapse:collapse;font-size:12px}',
    '#dsh .data-table th{text-align:left;padding:8px 10px;background:#FAFBFC;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#dsh .data-table td{padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#dsh .data-table tr:hover td{background:#FAFBFC}',
    // loading
    '#dsh .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // help modal sections (shared showHelp ใช้ class เหล่านี้ via inline style ใน shim)
    DSH_PAGE_CSS(),
  ].join('\n');
}

/* ===== <style> เฉพาะหน้า doctor_shifts_manager · prefix ทุก selector ด้วย #dsh ===== */
function DSH_PAGE_CSS() {
  return [
    // stats
    '#dsh .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#dsh .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#dsh .stats{grid-template-columns:repeat(2,1fr)}}',
    '#dsh .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#dsh .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#dsh .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#dsh .stat-card .v{font-size:22px;font-weight:600;line-height:1;margin-top:4px}',
    '#dsh .stat-card.urgent .v{color:var(--danger)}',
    '#dsh .stat-card.scheduled .v{color:var(--info)}',
    '#dsh .stat-card.filled .v{color:var(--success)}',
    // tabs
    '#dsh .tabs{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}',
    '#dsh .tab{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '#dsh .tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#dsh .tab svg{width:13px;height:13px}',
    '#dsh .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#dsh .tab.active .cnt{background:var(--navy)}',
    '#dsh .tab.tab-replace.active .cnt{background:var(--danger)}',
    // calendar toolbar
    '#dsh .cal-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}',
    '#dsh .cal-nav-btn{padding:4px 10px;font-size:12px}',
    '#dsh .cal-period{font-size:14px;font-weight:600;min-width:220px;text-align:center}',
    '#dsh .cal-mode-toggle{display:inline-flex;gap:0;border:1px solid var(--border);border-radius:6px;overflow:hidden}',
    '#dsh .cal-mode-btn{padding:5px 12px;background:#fff;border:0;cursor:pointer;font-family:inherit;font-size:11px;color:var(--text-muted)}',
    '#dsh .cal-mode-btn.active{background:var(--navy);color:#fff}',
    // calendar week
    '#dsh .cal-week{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}',
    '#dsh .cal-day{background:#fff;border:.5px solid var(--border);border-radius:6px;min-height:140px;display:flex;flex-direction:column}',
    '@media (max-width:600px){#dsh .cal-week{grid-template-columns:1fr;gap:8px}#dsh .cal-day{min-height:auto}}',
    '#dsh .cal-day-head{padding:5px 8px;border-bottom:.5px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:#F8FAFC;font-size:10px}',
    '#dsh .cal-day-name{font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#dsh .cal-day-num{font-size:13px;font-weight:600;color:var(--text)}',
    '#dsh .cal-day.today{border-color:var(--teal);border-width:1px}',
    '#dsh .cal-day.today .cal-day-num{color:var(--teal)}',
    '#dsh .cal-day.weekend{background:#FAFAFA}',
    '#dsh .cal-day-body{padding:4px;flex:1;display:flex;flex-direction:column;gap:3px;overflow-y:auto;max-height:200px}',
    // shift pill
    '#dsh .shift-pill{padding:4px 6px;border-radius:4px;cursor:pointer;font-size:10px;line-height:1.3;border-left:3px solid var(--info);background:#EFF6FF;color:var(--info)}',
    '#dsh .shift-pill:hover{transform:translateX(2px);transition:transform .1s}',
    '#dsh .shift-pill.cancelled{background:#FEF2F2;color:var(--danger);border-left-color:var(--danger);text-decoration:line-through;opacity:.7}',
    '#dsh .shift-pill.open_for_replacement{background:#FEF3C7;color:#92400E;border-left-color:#F59E0B;animation:dsh-pulse-bg 2s ease-in-out infinite}',
    '#dsh .shift-pill.filled{background:#DCFCE7;color:#166534;border-left-color:var(--success)}',
    '#dsh .shift-pill.completed{background:#F1F5F9;color:var(--text-muted);border-left-color:var(--text-faint)}',
    '@keyframes dsh-pulse-bg{0%,100%{background:#FEF3C7}50%{background:#FDE68A}}',
    '#dsh .shift-pill .time{font-weight:600}',
    '#dsh .shift-pill .doc{display:block}',
    '#dsh .shift-pill .br{display:block;font-size:9px;opacity:.8}',
    // calendar month
    '#dsh .cal-month{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}',
    '#dsh .cal-month-day{background:#fff;border:.5px solid var(--border);border-radius:4px;min-height:80px;padding:3px 5px;display:flex;flex-direction:column}',
    '#dsh .cal-month-day.other-month{opacity:.4}',
    '#dsh .cal-month-day.today{border-color:var(--teal);border-width:1px}',
    '#dsh .cal-month-day-num{font-size:11px;font-weight:600;color:var(--text);margin-bottom:2px}',
    '#dsh .cal-month-day-num.weekend{color:var(--danger)}',
    '#dsh .cal-month-pill{font-size:9px;padding:1px 4px;border-radius:3px;cursor:pointer;line-height:1.3;margin-bottom:1px}',
    // replacement card
    '#dsh .replace-card{background:#fff;border:.5px solid var(--border);border-left:4px solid #F59E0B;border-radius:6px;padding:12px;margin-bottom:8px}',
    '#dsh .replace-card.urgent{border-left-color:var(--danger);background:#FEF2F2}',
    '#dsh .replace-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}',
    '#dsh .replace-info h4{margin:0 0 4px;font-size:14px}',
    '#dsh .replace-meta{font-size:11px;color:var(--text-muted);line-height:1.5}',
    '#dsh .replace-age{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;background:#FEF3C7;color:#92400E}',
    '#dsh .replace-age.urgent{background:var(--danger-bg);color:var(--danger)}',
    '#dsh .replace-actions{display:flex;gap:6px;margin-top:8px}',
    // doctor list card
    '#dsh .doc-card{background:#fff;border:.5px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:8px;cursor:pointer;transition:border-color .15s}',
    '#dsh .doc-card:hover{border-color:var(--navy-2)}',
    '#dsh .doc-row{display:grid;grid-template-columns:auto 1fr auto auto auto auto;gap:14px;align-items:center}',
    '#dsh .doc-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--navy) 0%,var(--navy-2) 100%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}',
    '#dsh .doc-info{min-width:0}',
    '#dsh .doc-name{font-weight:600;font-size:13px}',
    '#dsh .doc-sub{font-size:11px;color:var(--text-muted);margin-top:2px}',
    '#dsh .doc-stat{text-align:center}',
    '#dsh .doc-stat .l{font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#dsh .doc-stat .v{font-size:14px;font-weight:600;margin-top:2px}',
    '#dsh .doc-stat .v.green{color:var(--success)}',
    '#dsh .doc-stat .v.amber{color:#B45309}',
    '#dsh .doc-stat .v.red{color:var(--danger)}',
    // reliability badge
    '#dsh .rel-badge{padding:4px 10px;border-radius:14px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px}',
    '#dsh .rel-excellent{background:#DCFCE7;color:#166534}',
    '#dsh .rel-good{background:#DBEAFE;color:#1E40AF}',
    '#dsh .rel-fair{background:#FEF3C7;color:#92400E}',
    '#dsh .rel-needs_attention{background:#FEE2E2;color:#991B1B}',
    '#dsh .rel-no_data{background:#F1F5F9;color:var(--text-muted)}',
    // modal (scope ใต้ #dsh · z-index สูง · fixed)
    '#dsh .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000}',
    '#dsh .modal-bg.active{display:flex}',
    '#dsh .modal{background:#fff;border-radius:12px;max-width:560px;width:92%;max-height:92vh;overflow-y:auto}',
    '#dsh .modal.large{max-width:880px}',
    '#dsh .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#dsh .modal-header h2{font-size:16px;margin:0}',
    '#dsh .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#dsh .modal-body{padding:16px 20px}',
    '#dsh .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    // profile modal
    '#dsh .profile-grid{display:grid;grid-template-columns:1fr 2fr;gap:16px;margin-bottom:14px}',
    '@media (max-width:600px){#dsh .profile-grid{grid-template-columns:1fr}}',
    '#dsh .profile-card{background:#F8FAFC;border-radius:8px;padding:14px}',
    '#dsh .profile-card-title{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600;margin-bottom:8px}',
    '#dsh .profile-row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}',
    '#dsh .profile-row .l{color:var(--text-muted)}',
    '#dsh .profile-row .v{font-weight:500}',
    '#dsh .profile-history-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:10px}',
    '@media (max-width:700px){#dsh .profile-history-grid{grid-template-columns:repeat(3,1fr)}}',
    '#dsh .month-card{background:#fff;border:.5px solid var(--border);border-radius:6px;padding:10px 8px;text-align:center;cursor:pointer}',
    '#dsh .month-card:hover{border-color:var(--navy-2)}',
    '#dsh .month-card .month-label{font-size:10px;color:var(--text-muted);text-transform:uppercase}',
    '#dsh .month-card .month-score{font-size:16px;font-weight:700;margin:3px 0}',
    '#dsh .month-card .month-stat{font-size:9px;color:var(--text-faint)}',
    '#dsh .month-card.green .month-score{color:var(--success)}',
    '#dsh .month-card.amber .month-score{color:#B45309}',
    '#dsh .month-card.red .month-score{color:var(--danger)}',
    '#dsh .empty-tab{padding:30px 20px;text-align:center;color:var(--text-muted);font-size:12px}',
    // help section (used by shim showHelp)
    '#dsh .help-section{background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid var(--border-strong)}',
    '#dsh .help-section-warn{background:#FFFBEB;border-left-color:#B45309}',
    '#dsh .help-section-tip{background:#ECFDF5;border-left-color:var(--success)}',
    '#dsh .help-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header(actions) + stats + tabs + content + 3 modals · คง element id เดิม =====
   ตัด app-shell/sidebar/page-head/sheet_link/brand_footer · ตัด topbar เดิม (ย้ายปุ่มไป head actions) */
function DSH_MARKUP() {
  return [
    // header actions row (แทน topbar เดิม — ชื่อ/subtitle ใช้ของ section ใน index.html)
    '<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-bottom:14px">',
      '<button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn"></button>',
      '<button class="btn btn-sm" onclick="reloadAll()" id="refresh-btn"></button>',
      '<button class="btn btn-sm" onclick="recomputeAll()" id="recompute-btn"></button>',
    '</div>',

    '<div class="stats" id="stats"></div>',

    '<div class="tabs">',
      '<button class="tab active" id="tab-calendar" onclick="setTab(\'calendar\')"></button>',
      '<button class="tab tab-replace" id="tab-replace" onclick="setTab(\'replace\')"></button>',
      '<button class="tab" id="tab-filled" onclick="setTab(\'filled\')"></button>',
      '<button class="tab" id="tab-doctors" onclick="setTab(\'doctors\')"></button>',
    '</div>',

    '<div id="content" class="loading">กำลังโหลด...</div>',

    // Cancel + replacement modal
    '<div class="modal-bg" id="cancel-bg" onclick="if(event.target===this)closeCancelModal()">',
      '<div class="modal">',
        '<div class="modal-header">',
          '<h2>Cancel + ส่งหา replacement</h2>',
          '<p>หมอแจ้ง cancel ผ่านโทร/แชท · กดเพื่อ cancel เวรนี้แล้ว multicast หาหมอท่านอื่น</p>',
        '</div>',
        '<div class="modal-body">',
          '<div id="cancel-shift-info" style="background:#F8FAFC;padding:12px;border-radius:6px;margin-bottom:14px;font-size:12px"></div>',
          '<div class="field">',
            '<label>เหตุผล (optional)</label>',
            '<input id="cancel-reason" placeholder="เช่น ติดธุระด่วน, ป่วย, เดินทางไม่ทัน">',
          '</div>',
          '<div class="field">',
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">',
              '<input type="checkbox" id="cancel-auto-send" checked style="width:16px;height:16px;accent-color:var(--danger)">',
              '<span style="margin:0">ส่ง LINE หา doctors ท่านอื่นทันทีหลัง cancel</span>',
            '</label>',
            '<div class="field-help">ถ้าไม่ติ๊ก ระบบจะ cancel อย่างเดียว — HR กด "ส่งหา replacement" ทีหลังได้</div>',
          '</div>',
        '</div>',
        '<div class="modal-footer">',
          '<button class="btn" onclick="closeCancelModal()">ยกเลิก</button>',
          '<button class="btn btn-primary" onclick="confirmCancel()" id="cancel-confirm-btn" style="background:var(--danger);border-color:var(--danger);color:#fff"></button>',
        '</div>',
      '</div>',
    '</div>',

    // Doctor profile modal
    '<div class="modal-bg" id="profile-bg" onclick="if(event.target===this)closeProfileModal()">',
      '<div class="modal large">',
        '<div class="modal-header">',
          '<h2 id="prof-name">กำลังโหลด...</h2>',
          '<p id="prof-sub">—</p>',
        '</div>',
        '<div class="modal-body" id="prof-body">',
          '<div class="loading">กำลังโหลด...</div>',
        '</div>',
        '<div class="modal-footer">',
          '<button class="btn" onclick="closeProfileModal()">ปิด</button>',
        '</div>',
      '</div>',
    '</div>',

    // Rating modal
    '<div class="modal-bg" id="rating-bg" onclick="if(event.target===this)closeRatingModal()">',
      '<div class="modal" style="max-width:380px">',
        '<div class="modal-header">',
          '<h2>ให้คะแนน supervisor rating</h2>',
          '<p id="rating-sub">—</p>',
        '</div>',
        '<div class="modal-body">',
          '<div class="field">',
            '<label>คะแนน (0-5)</label>',
            '<input id="rating-input" type="number" min="0" max="5" step="0.5" value="3">',
            '<div class="field-help">ใส่ 0 ถ้ายังไม่มี data · 5 = ดีเยี่ยม</div>',
          '</div>',
          '<div class="field">',
            '<label>Notes (optional)</label>',
            '<textarea id="rating-notes" rows="3"></textarea>',
          '</div>',
        '</div>',
        '<div class="modal-footer">',
          '<button class="btn" onclick="closeRatingModal()">ยกเลิก</button>',
          '<button class="btn btn-primary" onclick="saveRating()" id="rating-save-btn"></button>',
        '</div>',
      '</div>',
    '</div>',
  ].join('');
}

/* ============================================================
   DSH_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → DSH_BACKEND
   helper จาก _shared_scripts (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   query selector ทั้งหมดอ้าง id เดิม (อยู่ใต้ #dsh) — getElementById ใช้ได้ปกติ
   ============================================================ */
function DSH_RUN_PAGE_JS() {

  // ---- google.script.run shim → DSH_BACKEND (async, คืน shape เดิม) ----
  function _dsh2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (DSH_BACKEND[prop]) {
            Promise.resolve().then(function () { return DSH_BACKEND[prop].apply(DSH_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[DSH_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[DSH_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _dsh2MakeChain(); } });

  // ---- helpers จาก _shared_scripts (inline · scope ใต้ closure) ----
  const ICONS = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" x2="19" y1="12" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('dsh2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'dsh2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.dsh2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('dsh-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'dsh-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const cls = s.type === 'warn' ? 'help-section-warn' : s.type === 'tip' ? 'help-section-tip' : '';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div class="help-section ' + cls + '" style="background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid #CBD5E1"><div style="font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh;width:100%"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'dsh-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" style="background:#3DC5B7;color:#fff;border:1px solid #3DC5B7;padding:7px 14px;border-radius:6px;cursor:pointer;font-family:inherit" onclick="document.getElementById(\'dsh-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ============================================================
     ===== JS ของหน้าเดิม (ลอกทั้งดุ้น · ปรับ topbar init เป็น head actions) =====
     ============================================================ */
  let currentTab = 'calendar';
  let calMode = 'week';  // 'week' | 'month'
  let calAnchor = new Date();  // ตำแหน่งปัจจุบันของ calendar
  let allShiftsData = null;
  let openReplData = null;
  let filledData = null;
  let doctorsData = null;
  let currentShiftForCancel = null;
  let currentDoctorProfile = null;
  let currentRatingTarget = null;  // {doctor_id, year_month}

  const HELP = {
    title: 'Doctor shifts',
    subtitle: 'Sheets: 42 + 46',
    intro: 'จัดการเวรหมอ + Cancel/Replacement workflow + Doctor scorecard · หมอ cancel เองไม่ได้ HR เป็นคนกด',
    sections: [
      { title: '4 tabs', items: [
        '<strong>Calendar</strong> — week/month view เห็นเวรทุกหมอ · คลิกเวรเปิด detail',
        '<strong>Open for replacement</strong> — เวรที่ HR cancel + กำลังหาหมอแทน · มี countdown urgency',
        '<strong>Filled by replacement</strong> — เวรที่หมอท่านอื่นรับแทนแล้ว (60 วันล่าสุด)',
        '<strong>Doctors</strong> — รายชื่อหมอ + reliability score · คลิกเปิด profile + scorecard history',
      ]},
      { title: 'Cancel workflow', items: [
        'หมอโทร/แชท HR แจ้ง cancel · <strong>หมอ cancel เองทาง LINE ไม่ได้</strong> (permission gate)',
        'HR คลิกเวรใน Calendar → กด "Cancel + ส่งหา replacement" → กรอกเหตุผล + ส่งทันที',
        'ระบบ multicast LINE flex สีแดง URGENT หาหมอทุกคน · exclude หมอที่ cancel',
        'คนแรกที่กด "รับเวร" = ได้ (LockService) · คนหลัง = "หมอท่านอื่นรับไปแล้ว"',
        'HR ได้รับ noti บน main OA แจ้งใครรับ + อัพเดต status=filled',
      ]},
      { title: 'Doctor scorecard (Tab 46)', items: [
        'รันอัตโนมัติวันที่ 1 ของเดือน · cron compute เดือนก่อนหน้า ของหมอทุกคน',
        'Score weighted formula (default): cancel 40 + DF accuracy 30 + on-time 20 + supervisor rating 10',
        'HR ปรับ weight ผ่าน Setting · DOCTOR_SCORE_W_*',
        'Reliability badge: ≥4.5 excellent · ≥4.0 good · ≥3.0 fair · <3.0 needs attention',
        'Profile modal แสดง 6 เดือนล่าสุด + recent shifts 60 วัน + last probation review',
      ]},
      { type: 'tip', title: 'เคล็ดลับ', items: [
        'กด "Recompute" ที่ topbar หลังแก้ shift มาก ๆ เพื่อรีเฟรช scorecard ทุกหมอ',
        'กด supervisor rating ใน profile → ระบบ re-calc reliability ทันที',
        'ดูเดือนเก่าใน history grid → คลิก month card → modal rating',
      ]},
    ],
  };

  document.getElementById('refresh-btn').innerHTML = ICONS.refresh;
  document.getElementById('recompute-btn').innerHTML = ICONS.refresh + ' Recompute scorecards';
  document.getElementById('help-btn').innerHTML = ICONS.help;
  document.getElementById('cancel-confirm-btn').innerHTML = ICONS.alert + ' Cancel + ส่งหา replacement';
  document.getElementById('rating-save-btn').innerHTML = ICONS.save + ' บันทึก';

  document.getElementById('tab-calendar').innerHTML = ICONS.cal + ' Calendar';
  document.getElementById('tab-replace').innerHTML = ICONS.alert + ' Open for replacement <span class="cnt" id="cnt-replace">—</span>';
  document.getElementById('tab-filled').innerHTML = ICONS.check + ' Filled by replacement <span class="cnt" id="cnt-filled">—</span>';
  document.getElementById('tab-doctors').innerHTML = ICONS.users + ' Doctors <span class="cnt" id="cnt-doctors">—</span>';

  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#dsh .tabs .tab').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'calendar') loadCalendar();
    else if (tab === 'replace') loadReplacement();
    else if (tab === 'filled') loadFilled();
    else if (tab === 'doctors') loadDoctors();
  }

  function reloadAll() {
    loadReplacementCount();
    loadFilledCount();
    loadDoctorsCount();
    if (currentTab === 'calendar') loadCalendar();
    else if (currentTab === 'replace') loadReplacement();
    else if (currentTab === 'filled') loadFilled();
    else if (currentTab === 'doctors') loadDoctors();
  }

  // ====== Calendar ======
  function loadCalendar() {
    const range = calMode === 'week' ? getWeekRange(calAnchor) : getMonthRange(calAnchor);
    document.getElementById('content').innerHTML = renderCalendarShell(range);
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allShiftsData = res;
        renderCalendarBody(res, range);
        renderStats(res.stats || {});
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .doctorShiftListShifts({
        start_date: range.start.toISOString(),
        end_date: range.end.toISOString(),
      });
  }

  function renderCalendarShell(range) {
    const periodLabel = calMode === 'week'
      ? thaiDate(range.start) + ' – ' + thaiDate(new Date(range.end - 86400000))
      : range.start.toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });
    return [
      '<div class="cal-toolbar">',
        '<button class="btn cal-nav-btn" onclick="calNav(-1)">' + ICONS.back + '</button>',
        '<button class="btn cal-nav-btn" onclick="calToday()">วันนี้</button>',
        '<button class="btn cal-nav-btn" onclick="calNav(1)">' + ICONS.arrowRight + '</button>',
        '<div class="cal-period">' + escapeHtml(periodLabel) + '</div>',
        '<div class="cal-mode-toggle">',
          '<button class="cal-mode-btn ' + (calMode === 'week' ? 'active' : '') + '" onclick="setCalMode(\'week\')">Week</button>',
          '<button class="cal-mode-btn ' + (calMode === 'month' ? 'active' : '') + '" onclick="setCalMode(\'month\')">Month</button>',
        '</div>',
      '</div>',
      '<div id="cal-body" class="loading">กำลังโหลด...</div>',
    ].join('');
  }

  function setCalMode(mode) { calMode = mode; loadCalendar(); }
  function calNav(dir) {
    if (calMode === 'week') {
      calAnchor.setDate(calAnchor.getDate() + dir * 7);
    } else {
      calAnchor.setMonth(calAnchor.getMonth() + dir);
    }
    loadCalendar();
  }
  function calToday() { calAnchor = new Date(); loadCalendar(); }

  function renderCalendarBody(res, range) {
    const items = res.items || [];
    const byDay = {};
    items.forEach(s => {
      const k = s.shift_date;
      if (!byDay[k]) byDay[k] = [];
      byDay[k].push(s);
    });
    if (calMode === 'week') {
      document.getElementById('cal-body').outerHTML = renderWeek(range, byDay);
    } else {
      document.getElementById('cal-body').outerHTML = renderMonth(range, byDay);
    }
  }

  function renderWeek(range, byDay) {
    const days = [];
    const todayStr = fmtDate(new Date());
    for (let i = 0; i < 7; i++) {
      const d = new Date(range.start);
      d.setDate(d.getDate() + i);
      const k = fmtDate(d);
      const isToday = k === todayStr;
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const cls = ['cal-day'];
      if (isToday) cls.push('today');
      if (isWeekend) cls.push('weekend');
      const shifts = (byDay[k] || []).map(renderShiftPill).join('');
      days.push(
        '<div class="' + cls.join(' ') + '">' +
          '<div class="cal-day-head">' +
            '<span class="cal-day-name">' + d.toLocaleDateString('th-TH', { weekday: 'short' }) + '</span>' +
            '<span class="cal-day-num">' + d.getDate() + '</span>' +
          '</div>' +
          '<div class="cal-day-body">' + (shifts || '<div style="font-size:9px;color:var(--text-faint);text-align:center;padding:8px">ไม่มีเวร</div>') + '</div>' +
        '</div>'
      );
    }
    return '<div id="cal-body"><div class="cal-week">' + days.join('') + '</div></div>';
  }

  function renderShiftPill(s) {
    const cls = ['shift-pill', s.status];
    return '<div class="' + cls.join(' ') + '" onclick="openShiftDetail(\'' + escapeAttr(s.shift_id) + '\')">' +
      '<span class="time">' + escapeHtml(s.start_time + '–' + s.end_time) + '</span>' +
      '<span class="doc">' + escapeHtml(s.doctor_name || '(ว่าง)') + '</span>' +
      '<span class="br">' + escapeHtml(s.branch_name || '-') + '</span>' +
    '</div>';
  }

  function renderMonth(range, byDay) {
    const monthStart = new Date(range.start);
    const startDay = new Date(monthStart);
    startDay.setDate(startDay.getDate() - startDay.getDay());  // back to Sunday
    const monthEnd = new Date(range.end);
    const endDay = new Date(monthEnd);
    endDay.setDate(endDay.getDate() + (6 - endDay.getDay()));  // forward to Saturday

    const todayStr = fmtDate(new Date());
    const cells = [];
    ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'].forEach(label => {
      cells.push('<div style="font-size:10px;font-weight:600;color:var(--text-muted);text-align:center;padding:4px">' + label + '</div>');
    });
    for (let d = new Date(startDay); d < endDay; d.setDate(d.getDate() + 1)) {
      const k = fmtDate(d);
      const isToday = k === todayStr;
      const isOtherMonth = d.getMonth() !== monthStart.getMonth();
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const cls = ['cal-month-day'];
      if (isToday) cls.push('today');
      if (isOtherMonth) cls.push('other-month');
      const dayShifts = (byDay[k] || []).slice(0, 4).map(s => {
        const pillCls = ['cal-month-pill'];
        const bg = s.status === 'cancelled' ? '#FEE2E2' : s.status === 'open_for_replacement' ? '#FEF3C7' : s.status === 'filled' ? '#DCFCE7' : '#EFF6FF';
        const fg = s.status === 'cancelled' ? '#991B1B' : s.status === 'open_for_replacement' ? '#92400E' : s.status === 'filled' ? '#166534' : '#1E40AF';
        return '<div class="' + pillCls.join(' ') + '" style="background:' + bg + ';color:' + fg + '" onclick="openShiftDetail(\'' + escapeAttr(s.shift_id) + '\')" title="' + escapeAttr(s.doctor_name + ' ' + s.start_time) + '">' +
          s.start_time + ' ' + escapeHtml((s.doctor_name || '?').substring(0, 8)) + '</div>';
      }).join('');
      const moreLabel = (byDay[k] || []).length > 4 ? '<div style="font-size:9px;color:var(--text-faint)">+' + ((byDay[k] || []).length - 4) + ' more</div>' : '';
      cells.push(
        '<div class="' + cls.join(' ') + '">' +
          '<div class="cal-month-day-num ' + (isWeekend && !isOtherMonth ? 'weekend' : '') + '">' + d.getDate() + '</div>' +
          dayShifts + moreLabel +
        '</div>'
      );
    }
    return '<div id="cal-body"><div class="cal-month">' + cells.join('') + '</div></div>';
  }

  function getWeekRange(d) {
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());  // back to Sunday
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }
  function getMonthRange(d) {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return { start, end };
  }
  function fmtDate(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function thaiDate(d) {
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  }

  function renderStats(s) {
    document.getElementById('stats').innerHTML = [
      statCard('ทั้งหมด', s.total || 0, ''),
      statCard('Scheduled', s.scheduled || 0, 'scheduled'),
      statCard('Open replacement', s.open_replacement || 0, 'urgent'),
      statCard('Filled', s.filled || 0, 'filled'),
      statCard('Cancelled', s.cancelled || 0, ''),
      statCard('รวมจ่าย', (s.total_payment || 0).toLocaleString() + ' ฿', ''),
    ].join('');
  }
  function statCard(label, val, cls) {
    return '<div class="stat-card ' + cls + '"><div class="l">' + escapeHtml(label) + '</div><div class="v">' + val + '</div></div>';
  }

  // ====== Replacement tab ======
  function loadReplacement() {
    document.getElementById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        openReplData = res;
        const items = res.items || [];
        document.getElementById('cnt-replace').textContent = items.length;
        if (!items.length) {
          document.getElementById('content').innerHTML = '<div class="empty-tab">ไม่มีเวรที่กำลังหา replacement · ดี!</div>';
          return;
        }
        const html = items.map(s => {
          const cls = ['replace-card'];
          if (s.urgent) cls.push('urgent');
          return '<div class="' + cls.join(' ') + '">' +
            '<div class="replace-row">' +
              '<div class="replace-info">' +
                '<h4>' + escapeHtml(s.shift_date + ' ' + s.start_time + '–' + s.end_time) + '</h4>' +
                '<div class="replace-meta">' +
                  '<strong>' + escapeHtml(s.branch_name) + '</strong> · ค่าตอบแทน <strong>' + (s.total_payment || 0).toLocaleString() + ' ฿</strong><br>' +
                  'หมอเดิม: ' + escapeHtml(s.original_doctor_name || '-') +
                  (s.cancel_reason ? ' · เหตุผล: ' + escapeHtml(s.cancel_reason) : '') + '<br>' +
                  'ส่ง multicast หา <strong>' + (s.replacement_sent_count || 0) + '</strong> หมอเมื่อ ' + escapeHtml(s.replacement_request_at) +
                '</div>' +
              '</div>' +
              '<span class="replace-age ' + (s.urgent ? 'urgent' : '') + '">' + escapeHtml(s.replacement_age_label) + '</span>' +
            '</div>' +
            '<div class="replace-actions">' +
              '<button class="btn btn-sm" onclick="openShiftDetail(\'' + escapeAttr(s.shift_id) + '\')">รายละเอียด</button>' +
              '<button class="btn btn-sm btn-primary" onclick="resendReplacement(\'' + escapeAttr(s.shift_id) + '\')">ส่ง LINE ซ้ำ</button>' +
            '</div>' +
          '</div>';
        }).join('');
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .doctorShiftListOpenReplacement();
  }

  function loadReplacementCount() {
    google.script.run.withSuccessHandler(res => {
      if (res && res.count !== undefined) document.getElementById('cnt-replace').textContent = res.count;
    }).doctorShiftListOpenReplacement();
  }

  function resendReplacement(shiftId) {
    if (!confirm('ส่ง LINE flex หาหมอท่านอื่นซ้ำ?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ส่งแล้ว · ' + (res.sent_to || 0) + ' หมอ', 'success');
        reloadAll();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .doctorShiftFindReplacement(shiftId);
  }

  // ====== Filled tab ======
  function loadFilled() {
    document.getElementById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        filledData = res;
        const items = res.items || [];
        document.getElementById('cnt-filled').textContent = items.length;
        if (!items.length) {
          document.getElementById('content').innerHTML = '<div class="empty-tab">ไม่มี replacement ใน 60 วันล่าสุด</div>';
          return;
        }
        let html = '<table class="data-table"><thead><tr><th>วันที่</th><th>หมอเดิม</th><th>หมอแทน</th><th>สาขา</th><th>เวลา</th><th>ค่าตอบแทน</th><th>Filled at</th></tr></thead><tbody>';
        items.forEach(s => {
          html += '<tr style="cursor:pointer" onclick="openShiftDetail(\'' + escapeAttr(s.shift_id) + '\')">';
          html += '<td>' + escapeHtml(s.shift_date) + '</td>';
          html += '<td style="color:var(--danger)">' + escapeHtml(s.original_doctor_name || '-') + '</td>';
          html += '<td style="color:var(--success);font-weight:600">' + escapeHtml(s.doctor_name || '-') + '</td>';
          html += '<td>' + escapeHtml(s.branch_name) + '</td>';
          html += '<td>' + escapeHtml(s.start_time + '–' + s.end_time) + '</td>';
          html += '<td>' + (s.total_payment || 0).toLocaleString() + ' ฿</td>';
          html += '<td style="font-size:10px;color:var(--text-faint)">' + escapeHtml(s.replacement_filled_at) + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table>';
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .doctorShiftListFilled({ days: 60 });
  }

  function loadFilledCount() {
    google.script.run.withSuccessHandler(res => {
      if (res && res.count !== undefined) document.getElementById('cnt-filled').textContent = res.count;
    }).doctorShiftListFilled({ days: 60 });
  }

  // ====== Doctors tab ======
  function loadDoctors() {
    document.getElementById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        doctorsData = res;
        const items = res.items || [];
        document.getElementById('cnt-doctors').textContent = items.length;
        if (!items.length) {
          document.getElementById('content').innerHTML = '<div class="empty-tab">ไม่พบหมอใน Tab 01_Employees · เพิ่มพนักงาน position มี "DOCTOR"</div>';
          return;
        }
        const html = items.map(d => {
          const initials = (d.name || '?').substring(0, 2).toUpperCase();
          const score = d.reliability_score || 0;
          const cls = score >= 4.5 ? 'green' : score >= 3.0 ? 'amber' : score > 0 ? 'red' : '';
          const cancelCls = d.cancel_rate > 20 ? 'red' : d.cancel_rate > 10 ? 'amber' : 'green';
          const dfCls = d.df_accuracy_pct >= 90 ? 'green' : d.df_accuracy_pct >= 70 ? 'amber' : 'red';
          return '<div class="doc-card" onclick="openDoctorProfile(\'' + escapeAttr(d.employee_id) + '\')">' +
            '<div class="doc-row">' +
              '<div class="doc-avatar">' + escapeHtml(initials) + '</div>' +
              '<div class="doc-info">' +
                '<div class="doc-name">' + escapeHtml(d.name) + '</div>' +
                '<div class="doc-sub">' + escapeHtml(d.position_id || '-') + ' · ' + escapeHtml(d.primary_branch_id || '-') + (d.line_linked ? ' · LINE' : '') + '</div>' +
              '</div>' +
              '<div class="doc-stat"><div class="l">เวร</div><div class="v">' + (d.shifts_scheduled || 0) + '</div></div>' +
              '<div class="doc-stat"><div class="l">Cancel</div><div class="v ' + cancelCls + '">' + (d.cancel_rate || 0) + '%</div></div>' +
              '<div class="doc-stat"><div class="l">DF acc</div><div class="v ' + dfCls + '">' + (d.df_accuracy_pct || 0) + '%</div></div>' +
              '<div class="doc-stat"><div class="l">Score</div><div class="v ' + cls + '">' + score.toFixed(1) + '</div></div>' +
            '</div>' +
          '</div>';
        }).join('');
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .doctorShiftListDoctors();
  }

  function loadDoctorsCount() {
    google.script.run.withSuccessHandler(res => {
      if (res && res.count !== undefined) document.getElementById('cnt-doctors').textContent = res.count;
    }).doctorShiftListDoctors();
  }

  // ====== Cancel modal ======
  function openShiftDetail(shiftId) {
    const shift = findShiftInData(shiftId);
    if (!shift) { showToast('ไม่พบเวร · refresh หน้านี้แล้วลองใหม่', 'error'); return; }
    if (shift.status === 'scheduled') {
      openCancelModal(shift);
    } else {
      showShiftInfo(shift);
    }
  }

  function findShiftInData(shiftId) {
    if (allShiftsData && allShiftsData.items) {
      const s = allShiftsData.items.find(x => x.shift_id === shiftId);
      if (s) return s;
    }
    if (openReplData && openReplData.items) {
      const s = openReplData.items.find(x => x.shift_id === shiftId);
      if (s) return s;
    }
    if (filledData && filledData.items) {
      const s = filledData.items.find(x => x.shift_id === shiftId);
      if (s) return s;
    }
    return null;
  }

  function showShiftInfo(s) {
    const info = [
      'Shift: ' + s.shift_date + ' ' + s.start_time + '–' + s.end_time,
      'หมอ: ' + (s.doctor_name || '(ว่าง)'),
      'สาขา: ' + s.branch_name,
      'Status: ' + s.status,
      s.original_doctor_name ? 'หมอเดิม: ' + s.original_doctor_name : '',
      s.cancel_reason ? 'เหตุผล cancel: ' + s.cancel_reason : '',
      'ค่าตอบแทน: ' + (s.total_payment || 0).toLocaleString() + ' ฿',
    ].filter(Boolean).join('\n');
    alert(info);
  }

  function openCancelModal(shift) {
    currentShiftForCancel = shift;
    document.getElementById('cancel-bg').classList.add('active');
    document.getElementById('cancel-shift-info').innerHTML =
      '<strong>' + escapeHtml(shift.shift_date + ' · ' + shift.start_time + '–' + shift.end_time) + '</strong><br>' +
      'หมอ: ' + escapeHtml(shift.doctor_name) + ' · สาขา: ' + escapeHtml(shift.branch_name) +
      '<br>ค่าตอบแทน: ' + (shift.total_payment || 0).toLocaleString() + ' ฿';
    document.getElementById('cancel-reason').value = '';
    document.getElementById('cancel-auto-send').checked = true;
  }
  function closeCancelModal() { document.getElementById('cancel-bg').classList.remove('active'); currentShiftForCancel = null; }
  function confirmCancel() {
    if (!currentShiftForCancel) return;
    const reason = document.getElementById('cancel-reason').value || '';
    const autoSend = document.getElementById('cancel-auto-send').checked;
    document.getElementById('cancel-confirm-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('cancel-confirm-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('Cancel แล้ว · ' + (autoSend ? 'ส่งหา ' + (res.sent_to || 0) + ' หมอ' : 'ยังไม่ส่ง'), 'success');
        closeCancelModal();
        reloadAll();
      })
      .withFailureHandler(err => {
        document.getElementById('cancel-confirm-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .doctorShiftCancel(currentShiftForCancel.shift_id, reason, autoSend);
  }

  // ====== Doctor profile ======
  function openDoctorProfile(doctorId) {
    document.getElementById('profile-bg').classList.add('active');
    document.getElementById('prof-name').textContent = 'กำลังโหลด...';
    document.getElementById('prof-body').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(d => {
        if (!d || d.error) return showToast(d && d.error || 'load failed', 'error');
        currentDoctorProfile = d;
        renderProfile(d);
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .doctorShiftGetProfile(doctorId);
  }
  function closeProfileModal() { document.getElementById('profile-bg').classList.remove('active'); currentDoctorProfile = null; }

  function renderProfile(d) {
    const doc = d.doctor || {};
    const lt = d.lifetime || {};
    const fullName = (doc.first_name + ' ' + doc.last_name).trim() || doc.nickname || doc.employee_id;
    document.getElementById('prof-name').textContent = (doc.nickname || fullName) + ' · ' + doc.employee_id;
    document.getElementById('prof-sub').textContent = doc.position_id + ' · ' + doc.primary_branch_id +
      ' · เริ่มงาน ' + doc.start_date + (doc.line_linked ? ' · LINE linked' : '');

    const badge = d.reliability_badge || 'no_data';
    const badgeLabel = { excellent: 'Excellent', good: 'Good', fair: 'Fair', needs_attention: 'Needs attention', no_data: 'ไม่มีข้อมูล' }[badge] || badge;

    const profileHtml = [
      '<div class="profile-grid">',
        '<div class="profile-card">',
          '<div class="profile-card-title">ข้อมูลทั่วไป</div>',
          '<div class="profile-row"><span class="l">ชื่อเล่น</span><span class="v">' + escapeHtml(doc.nickname || '-') + '</span></div>',
          '<div class="profile-row"><span class="l">ตำแหน่ง</span><span class="v">' + escapeHtml(doc.position_id || '-') + '</span></div>',
          '<div class="profile-row"><span class="l">สาขาหลัก</span><span class="v">' + escapeHtml(doc.primary_branch_id || '-') + '</span></div>',
          '<div class="profile-row"><span class="l">โทร</span><span class="v">' + escapeHtml(doc.phone || '-') + '</span></div>',
          '<div class="profile-row"><span class="l">Email</span><span class="v" style="font-size:11px">' + escapeHtml(doc.email || '-') + '</span></div>',
          '<div class="profile-row"><span class="l">Reliability</span><span class="v"><span class="rel-badge rel-' + badge + '">' + badgeLabel + ' · ' + (lt.avg_reliability != null ? lt.avg_reliability : 0).toFixed(1) + '/5</span></span></div>',
        '</div>',
        '<div class="profile-card">',
          '<div class="profile-card-title">สถิติ 12 เดือนล่าสุด</div>',
          '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">',
            summaryStat('Scheduled', lt.shifts_scheduled, ''),
            summaryStat('Completed', lt.shifts_completed, 'green'),
            summaryStat('Cancelled (เอง)', lt.shifts_cancelled_self, lt.shifts_cancelled_self > 5 ? 'red' : ''),
            summaryStat('Taken (แทนคนอื่น)', lt.shifts_taken_replacement, 'green'),
            summaryStat('Cancel rate', lt.cancel_rate + '%', lt.cancel_rate > 15 ? 'red' : lt.cancel_rate > 5 ? 'amber' : 'green'),
            summaryStat('DF accuracy', lt.df_accuracy_pct + '%', lt.df_accuracy_pct < 80 ? 'red' : lt.df_accuracy_pct < 95 ? 'amber' : 'green'),
          '</div>',
        '</div>',
      '</div>',
    ].join('');

    let historyHtml = '<div class="profile-card-title" style="margin-top:14px">Scorecard 6 เดือนล่าสุด</div>';
    if (!d.history || !d.history.length) {
      historyHtml += '<div class="empty-tab">ยังไม่มี scorecard · กด Recompute ที่ topbar</div>';
    } else {
      historyHtml += '<div class="profile-history-grid">';
      const hist = d.history.slice().reverse();
      hist.forEach(s => {
        const score = s.reliability_score || 0;
        const cls = score >= 4.5 ? 'green' : score >= 3.0 ? 'amber' : score > 0 ? 'red' : '';
        historyHtml += '<div class="month-card ' + cls + '" onclick="openRatingModal(\'' + escapeAttr(s.doctor_id) + '\', \'' + escapeAttr(s.year_month) + '\', ' + (s.rating_from_supervisor || 0) + ')">' +
          '<div class="month-label">' + escapeHtml(s.year_month) + '</div>' +
          '<div class="month-score">' + score.toFixed(1) + '</div>' +
          '<div class="month-stat">' + s.shifts_scheduled + ' shifts</div>' +
          '<div class="month-stat">cancel ' + s.cancel_rate + '%</div>' +
        '</div>';
      });
      historyHtml += '</div>';
      historyHtml += '<div style="font-size:10px;color:var(--text-faint);margin-top:6px;text-align:center">คลิกเดือนเพื่อให้ supervisor rating</div>';
    }

    let shiftsHtml = '<div class="profile-card-title" style="margin-top:14px">Recent shifts (60 วัน)</div>';
    if (!d.recent_shifts || !d.recent_shifts.length) {
      shiftsHtml += '<div class="empty-tab">ไม่มี shifts ใน 60 วันล่าสุด</div>';
    } else {
      shiftsHtml += '<table class="data-table" style="font-size:11px"><thead><tr><th>วันที่</th><th>สาขา</th><th>ชม</th><th>DF planned</th><th>DF actual</th><th>Diff</th><th>Role</th></tr></thead><tbody>';
      d.recent_shifts.forEach(s => {
        const diff = (s.df_actual || 0) - (s.df_planned || 0);
        const diffCls = diff < 0 ? 'color:var(--danger)' : diff > 0 ? 'color:var(--success)' : '';
        const roleLabel = { completed: 'เสร็จ', scheduled: 'นัด', cancelled: 'cancel เอง', cancelled_replaced: 'cancel (แทน)', taken_replacement: 'รับแทน' }[s.role] || s.role;
        shiftsHtml += '<tr>';
        shiftsHtml += '<td>' + escapeHtml(s.shift_date) + '</td>';
        shiftsHtml += '<td>' + escapeHtml(s.branch_id) + '</td>';
        shiftsHtml += '<td>' + s.hours + '</td>';
        shiftsHtml += '<td>' + (s.df_planned || 0).toLocaleString() + '</td>';
        shiftsHtml += '<td>' + (s.df_actual || 0).toLocaleString() + '</td>';
        shiftsHtml += '<td style="' + diffCls + '">' + (diff > 0 ? '+' : '') + diff.toLocaleString() + '</td>';
        shiftsHtml += '<td><span style="font-size:10px;background:#F1F5F9;padding:1px 6px;border-radius:8px">' + roleLabel + '</span></td>';
        shiftsHtml += '</tr>';
      });
      shiftsHtml += '</tbody></table>';
    }

    let probationHtml = '';
    if (d.last_probation) {
      probationHtml = '<div class="profile-card-title" style="margin-top:14px">Probation review ล่าสุด</div>' +
        '<div class="profile-card">' +
          '<div class="profile-row"><span class="l">วันรีวิว</span><span class="v">' + escapeHtml(d.last_probation.review_date) + '</span></div>' +
          '<div class="profile-row"><span class="l">Milestone</span><span class="v">' + escapeHtml(d.last_probation.milestone_days) + ' วัน</span></div>' +
          '<div class="profile-row"><span class="l">Outcome</span><span class="v">' + escapeHtml(d.last_probation.outcome) + '</span></div>' +
          '<div class="profile-row"><span class="l">Score</span><span class="v">' + escapeHtml(d.last_probation.score || '-') + '</span></div>' +
          (d.last_probation.comment ? '<div style="margin-top:8px;font-size:11px;color:var(--text-muted);background:#fff;padding:8px;border-radius:5px;line-height:1.4">' + escapeHtml(d.last_probation.comment) + '</div>' : '') +
        '</div>';
    }

    document.getElementById('prof-body').innerHTML = profileHtml + historyHtml + shiftsHtml + probationHtml;
  }

  function summaryStat(label, val, cls) {
    return '<div style="background:#fff;padding:8px;border-radius:5px"><div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">' + escapeHtml(label) + '</div><div style="font-size:14px;font-weight:600;margin-top:2px" class="' + cls + '">' + val + '</div></div>';
  }

  // ====== Rating modal ======
  function openRatingModal(doctorId, yearMonth, currentRating) {
    currentRatingTarget = { doctor_id: doctorId, year_month: yearMonth };
    document.getElementById('rating-bg').classList.add('active');
    document.getElementById('rating-sub').textContent = doctorId + ' · ' + yearMonth;
    document.getElementById('rating-input').value = currentRating || 0;
    document.getElementById('rating-notes').value = '';
  }
  function closeRatingModal() { document.getElementById('rating-bg').classList.remove('active'); currentRatingTarget = null; }
  function saveRating() {
    if (!currentRatingTarget) return;
    const rating = Number(document.getElementById('rating-input').value || 0);
    const notes = document.getElementById('rating-notes').value || '';
    document.getElementById('rating-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('rating-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('บันทึก rating แล้ว · re-calc reliability', 'success');
        closeRatingModal();
        if (currentDoctorProfile) openDoctorProfile(currentDoctorProfile.doctor.employee_id);
      })
      .withFailureHandler(err => {
        document.getElementById('rating-save-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .doctorShiftSetRating(currentRatingTarget.doctor_id, currentRatingTarget.year_month, rating, notes);
  }

  // ====== Recompute all ======
  function recomputeAll() {
    if (!confirm('Recompute scorecards เดือนก่อนหน้าให้หมอทุกคน?')) return;
    document.getElementById('recompute-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('recompute-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('Recompute แล้ว · ' + (res.scorecards_computed || 0) + ' หมอ · เดือน ' + (res.year_month || ''), 'success');
        reloadAll();
      })
      .withFailureHandler(err => {
        document.getElementById('recompute-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .doctorShiftRecomputeAll();
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, reloadAll, recomputeAll, setTab,
    calNav, calToday, setCalMode,
    openShiftDetail, resendReplacement,
    openCancelModal, closeCancelModal, confirmCancel,
    openDoctorProfile, closeProfileModal,
    openRatingModal, closeRatingModal, saveRating,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadCalendar();
  loadReplacementCount();
  loadFilledCount();
  loadDoctorsCount();
}

/* expose top-level mount → window (router เรียกผ่าน window[PORTED_FN[v]]) */
try { window.mountDoctorshift = mountDoctorshift; } catch (e) {}
