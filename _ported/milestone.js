// _ported/milestone.js — FULL native port of desktop milestone_manager.html (HR Announcement admin · "หมุดหมายอายุงาน" / HR Milestones)
// ลอกทั้งดุ้น: stats(5) + filters(search/recurrence/severity/handling/active)
//   + two-column ms-grid (list table + upcoming 30 วัน sidebar) + modal (add/edit) + help
//   CSS เดิม (_shared_styles ที่ใช้ + <style> หน้า manager) prefix #ms ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ MS_RUN_PAGE_JS() · google.script.run = shim → MS_BACKEND (Supabase)
//
// ใช้ global window.sb / window.esc / window.$ (index.html) — ห้าม redeclare · helper inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน MS_RUN_PAGE_JS (prefix-safe ผ่าน _exp)
//
// backend (edge fn hr_list?type=milestone.updated&limit=2000 → {items}) :
//   milestoneAdminList(opts) → { milestones, stats, upcoming, total_in_db, total }
//       derive next_occurrence / upcoming(30วัน) / stats client-side จาก payload ล่าสุดต่อ milestone
//       (list อาจว่าง = 0 milestone → render ได้ ไม่ error · empty state สวย)
//   milestoneAdminAdd / Update / ToggleActive / Remove / SeedDefaults
//       → เขียนกลับไม่ได้บน dashboard → stub + toast 'ยังไม่พร้อมบน dashboard'

/* ============================================================
   MS_BACKEND — map google.script.run → Supabase edge fn hr_list (type=milestone.updated)
   ============================================================ */
var MS_FN = 'hr_list';
var MS_WRITE_FN = 'hr_write';   // edge fn กลาง CRUD (add/edit/soft-delete)
var MS_TYPE = 'milestone.updated';
var MS_LIMIT = 2000;

function ms2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function ms2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function ms2Bool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  if (s === '') return true; // default active
  return s === 'true' || s === 'yes' || s === '1' || s === 'y' || s === 'active';
}
function ms2pad(n) { return String(n).padStart(2, '0'); }
function ms2DateISO(d) {
  if (!d || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + ms2pad(d.getMonth() + 1) + '-' + ms2pad(d.getDate());
}

var MS_REC_HUMAN = {
  monthly: 'รายเดือน',
  yearly: 'รายปี',
  weekly: 'รายสัปดาห์',
  one_time: 'ครั้งเดียว',
};

// last day of given (year, month0)
function ms2LastDom(year, month0) { return new Date(year, month0 + 1, 0).getDate(); }

// resolve "dom" token (number | "last") → actual day for (year, month0)
function ms2ResolveDom(domToken, year, month0) {
  var s = String(domToken == null ? '' : domToken).toLowerCase().trim();
  if (s === 'last') return ms2LastDom(year, month0);
  var n = parseInt(s, 10);
  if (isNaN(n)) return null;
  var last = ms2LastDom(year, month0);
  return Math.min(Math.max(n, 1), last);
}

// compute next_occurrence (ISO date) for a milestone, on/after `from` (Date midnight)
function ms2NextOccurrence(m, from) {
  var base = from ? new Date(from) : new Date();
  base.setHours(0, 0, 0, 0);
  var rec = m.recurrence;

  if (rec === 'one_time') {
    if (!m.date_iso) return '';
    var d = new Date(m.date_iso); d.setHours(0, 0, 0, 0);
    if (isNaN(d.getTime())) return '';
    return (d >= base) ? ms2DateISO(d) : ''; // ครั้งเดียว: ผ่านไปแล้ว = ไม่มี next
  }

  if (rec === 'monthly') {
    if (m.dom == null || m.dom === '') return '';
    for (var i = 0; i < 24; i++) {
      var y = base.getFullYear();
      var mo = base.getMonth() + i;
      var year = y + Math.floor(mo / 12);
      var month0 = ((mo % 12) + 12) % 12;
      var day = ms2ResolveDom(m.dom, year, month0);
      if (day == null) return '';
      var cand = new Date(year, month0, day); cand.setHours(0, 0, 0, 0);
      if (cand >= base) return ms2DateISO(cand);
    }
    return '';
  }

  if (rec === 'yearly') {
    if (!m.month || m.dom == null || m.dom === '') return '';
    var mon0 = ms2Num(m.month) - 1;
    if (mon0 < 0 || mon0 > 11) return '';
    for (var yy = 0; yy < 3; yy++) {
      var yr = base.getFullYear() + yy;
      var dd = ms2ResolveDom(m.dom, yr, mon0);
      if (dd == null) return '';
      var c2 = new Date(yr, mon0, dd); c2.setHours(0, 0, 0, 0);
      if (c2 >= base) return ms2DateISO(c2);
    }
    return '';
  }

  if (rec === 'weekly') {
    var dow = ms2Num(m.day_of_week);
    if (m.day_of_week == null || m.day_of_week === '') return '';
    var wom = String(m.week_of_month == null ? 'all' : m.week_of_month).toLowerCase();
    // scan ahead up to ~120 days
    for (var k = 0; k < 120; k++) {
      var c3 = new Date(base.getTime() + k * 86400000); c3.setHours(0, 0, 0, 0);
      if (c3.getDay() !== dow) continue;
      if (wom === 'all') return ms2DateISO(c3);
      // which occurrence-of-this-weekday is c3 within its month?
      var occ = Math.floor((c3.getDate() - 1) / 7) + 1;
      var last = ms2LastDom(c3.getFullYear(), c3.getMonth());
      var isLast = (c3.getDate() + 7) > last;
      if (wom === 'last') { if (isLast) return ms2DateISO(c3); continue; }
      if (occ === ms2Num(wom)) return ms2DateISO(c3);
    }
    return '';
  }

  return '';
}

// map payload event ดิบ → milestone row shape ที่ JS เดิมใช้
function ms2MapMilestone(p) {
  p = p || {};
  var rec = String(p.recurrence || 'monthly').toLowerCase();
  if (['monthly', 'yearly', 'weekly', 'one_time'].indexOf(rec) < 0) rec = 'monthly';
  var sev = String(p.severity || 'normal').toLowerCase();
  if (['info', 'normal', 'high', 'urgent'].indexOf(sev) < 0) sev = 'normal';
  var m = {
    milestone_id: p.milestone_id || p.entity_id || p.id || '',
    title: p.title || p.name || '—',
    description: p.description || '',
    recurrence: rec,
    recurrence_human: MS_REC_HUMAN[rec] || rec,
    severity: sev,
    dom: (p.dom != null ? p.dom : (p.day_of_month != null ? p.day_of_month : '')),
    month: (p.month != null ? p.month : ''),
    day_of_week: (p.day_of_week != null ? p.day_of_week : (p.dow != null ? p.dow : '')),
    week_of_month: (p.week_of_month != null ? p.week_of_month : (p.wom != null ? p.wom : 'all')),
    date_iso: p.date_iso || p.date || '',
    time: p.time || '',
    icon: p.icon || 'calendar',
    link: p.link || '',
    target_role: p.target_role || 'all_hr',
    auto_handled: ms2Bool(p.auto_handled),
    active: ms2Bool(p.active == null ? true : p.active),
    notes: p.notes || '',
    next_occurrence: '',
    _raw: p,
  };
  if (m.active) m.next_occurrence = ms2NextOccurrence(m);
  return m;
}

// cache payload ดิบล่าสุดต่อ milestone (ให้ reuse · backend ไม่มี endpoint แยก)
var _ms2Rows = [];
var _ms2Raw = {};

function ms2FetchAll() {
  return sb.functions.invoke(MS_FN + '?type=' + encodeURIComponent(MS_TYPE) + '&limit=' + MS_LIMIT).then(function (res) {
    var data = (res && res.data) || {};
    var items = ms2ToArr(data.items);
    var seen = {}; var rows = [];   // id → index (เก็บล่าสุด)
    // dedupe เก็บล่าสุดต่อ id (payload เรียงเก่า→ใหม่) · soft-delete (event ล่าสุด=deleted) → ทิ้ง
    items.forEach(function (p) {
      var id = p.milestone_id || p.entity_id || p.id || '';
      if (!id) return;
      var isDel = !!(p && (p._status === 'deleted' || p._deleted === true || p.deleted === true));
      if (seen[id] != null) {
        if (isDel) { rows[seen[id]] = null; delete _ms2Raw[id]; return; }
        _ms2Raw[id] = p;
        rows[seen[id]] = ms2MapMilestone(p);
        return;
      }
      if (isDel) return;
      seen[id] = rows.length;
      _ms2Raw[id] = p;
      rows.push(ms2MapMilestone(p));
    });
    rows = rows.filter(function (r) { return r; }); // กรองช่องที่ถูก soft-delete ทิ้ง
    _ms2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[MS_BACKEND] list fetch failed', e);
    _ms2Rows = [];
    return [];
  });
}

// build upcoming (30 วันข้างหน้า) จาก milestones ที่ active + มี next_occurrence
function ms2BuildUpcoming(all) {
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var out = [];
  all.forEach(function (m) {
    if (!m.active || !m.next_occurrence) return;
    var d = new Date(m.next_occurrence); d.setHours(0, 0, 0, 0);
    if (isNaN(d.getTime())) return;
    var days = Math.floor((d - today) / 86400000);
    if (days < 0 || days > 30) return;
    out.push({
      milestone_id: m.milestone_id,
      title: m.title,
      date: m.next_occurrence,
      time: m.time || '',
      severity: m.severity,
      days_from_today: days,
    });
  });
  out.sort(function (a, b) { return a.days_from_today - b.days_from_today; });
  return out;
}

var MS_BACKEND = {
  // list — { milestones, stats, upcoming, total_in_db, total }
  milestoneAdminList: function (opts) {
    opts = opts || {};
    return ms2FetchAll().then(function (all) {
      var filtered = all.slice();
      if (opts.recurrence) filtered = filtered.filter(function (m) { return m.recurrence === opts.recurrence; });
      if (opts.severity) filtered = filtered.filter(function (m) { return m.severity === opts.severity; });
      if (opts.handling === 'auto') filtered = filtered.filter(function (m) { return m.auto_handled; });
      else if (opts.handling === 'manual') filtered = filtered.filter(function (m) { return !m.auto_handled; });
      if (opts.active === 'true') filtered = filtered.filter(function (m) { return m.active; });
      else if (opts.active === 'false') filtered = filtered.filter(function (m) { return !m.active; });
      if (opts.search) {
        var q = String(opts.search).toLowerCase();
        filtered = filtered.filter(function (m) {
          return (m.title || '').toLowerCase().indexOf(q) >= 0 ||
            (m.description || '').toLowerCase().indexOf(q) >= 0 ||
            (m.notes || '').toLowerCase().indexOf(q) >= 0;
        });
      }

      // sort: มี next_occurrence ก่อน (ใกล้สุดขึ้นก่อน) → ไม่มีไว้ท้าย
      filtered.sort(function (a, b) {
        var an = a.next_occurrence || '9999-99-99';
        var bn = b.next_occurrence || '9999-99-99';
        if (an !== bn) return an.localeCompare(bn);
        return (a.title || '').localeCompare(b.title || '');
      });

      var today = new Date(); today.setHours(0, 0, 0, 0);
      var upcoming7 = all.filter(function (m) {
        if (!m.active || !m.next_occurrence) return false;
        var d = new Date(m.next_occurrence); d.setHours(0, 0, 0, 0);
        if (isNaN(d.getTime())) return false;
        var days = Math.floor((d - today) / 86400000);
        return days >= 0 && days <= 7;
      }).length;

      var stats = {
        total: all.length,
        active: all.filter(function (m) { return m.active; }).length,
        auto: all.filter(function (m) { return m.auto_handled; }).length,
        manual: all.filter(function (m) { return !m.auto_handled; }).length,
        upcoming_7: upcoming7,
      };

      return {
        milestones: filtered,
        stats: stats,
        upcoming: ms2BuildUpcoming(all),
        total_in_db: all.length,
        total: all.length,
      };
    });
  },

  // ---- mutations: เขียนจริงผ่าน hr_write ----
  // add — ไม่ส่ง entity_id = สร้างใหม่
  milestoneAdminAdd: function (payload) {
    return ms2Write({ payload: ms2BuildPayload(payload) });
  },
  // update — ส่ง entity_id = id เดิม
  milestoneAdminUpdate: function (id, payload) {
    if (!id) return Promise.resolve({ error: 'ไม่มี milestone_id' });
    var p = ms2BuildPayload(payload); p.id = id; p.milestone_id = id;
    return ms2Write({ entity_id: id, payload: p });
  },
  // toggle active — อ่านค่าปัจจุบันจาก cache แล้วเขียน flip (คง field รอบเวลาเดิมครบ)
  milestoneAdminToggleActive: function (id) {
    if (!id) return Promise.resolve({ error: 'ไม่มี milestone_id' });
    var cur = null;
    for (var i = 0; i < _ms2Rows.length; i++) { if (_ms2Rows[i].milestone_id === id) { cur = _ms2Rows[i]; break; } }
    if (!cur) return Promise.resolve({ error: 'ไม่พบ milestone' });
    var p = ms2BuildPayload(cur); p.id = id; p.milestone_id = id; p.active = !cur.active;
    return ms2Write({ entity_id: id, payload: p });
  },
  // soft delete — เขียน event ใหม่ deleted=true ทับ entity เดิม
  milestoneAdminRemove: function (id) {
    if (!id) return Promise.resolve({ error: 'ไม่มี milestone_id' });
    return ms2Write({ entity_id: id, deleted: true, payload: { id: id, milestone_id: id } });
  },
  // seed defaults — ยังไม่รองรับบน dashboard (batch ฝั่ง backend)
  milestoneAdminSeedDefaults: function () {
    ms2NotReady('Seed defaults');
    return Promise.resolve({ error: 'Seed defaults ยังไม่พร้อมบน dashboard (ใช้ปุ่ม + เพิ่มทีละข้อ)' });
  },
};

// payload milestone → คอลัมน์เดิม (ส่ง field รอบเวลาตาม recurrence · กัน null)
function ms2BuildPayload(payload) {
  payload = payload || {};
  var rec = String(payload.recurrence || 'monthly').toLowerCase();
  if (['monthly', 'yearly', 'weekly', 'one_time'].indexOf(rec) < 0) rec = 'monthly';
  var p = {
    title: payload.title || '',
    description: payload.description || '',
    recurrence: rec,
    severity: payload.severity || 'normal',
    time: payload.time || '',
    icon: payload.icon || 'calendar',
    link: payload.link || '',
    target_role: payload.target_role || 'all_hr',
    auto_handled: !!payload.auto_handled,
    notes: payload.notes || '',
    active: (payload.active === false ? false : true),
  };
  if (rec === 'monthly') p.dom = (payload.dom != null ? payload.dom : '');
  if (rec === 'yearly') { p.dom = (payload.dom != null ? payload.dom : ''); p.month = (payload.month != null ? payload.month : ''); }
  if (rec === 'weekly') { p.day_of_week = (payload.day_of_week != null ? payload.day_of_week : ''); p.week_of_month = (payload.week_of_month != null ? payload.week_of_month : 'all'); }
  if (rec === 'one_time') p.date_iso = payload.date_iso || payload.date || '';
  return p;
}

// ตรวจ 403/401
function ms2Is403(err) {
  if (!err) return false;
  if (err.context && typeof err.context.status === 'number' &&
    (err.context.status === 403 || err.context.status === 401)) return true;
  if (typeof err.status === 'number' && (err.status === 403 || err.status === 401)) return true;
  var msg = String(err.message || err.error || err).toLowerCase();
  return msg.indexOf('403') >= 0 || msg.indexOf('forbidden') >= 0 ||
    msg.indexOf('401') >= 0 || msg.indexOf('unauthor') >= 0 || msg.indexOf('not allowed') >= 0;
}

// unwrap error body (FunctionsHttpError → context) → Promise<string>
function ms2ErrMsg(err, data) {
  if (data && data.ok === false && data.error) return Promise.resolve(String(data.error));
  if (!err) return Promise.resolve('unknown');
  if (err.context && typeof err.context.json === 'function') {
    return err.context.json().then(function (b) {
      return (b && (b.error || b.message)) ? String(b.error || b.message) : (err.message || String(err));
    }).catch(function () { return err.message || String(err); });
  }
  return Promise.resolve(err.message || String(err));
}

// เขียนกลับผ่าน hr_write — body: { event_type, entity_id?, deleted?, payload }
function ms2Write(opts) {
  opts = opts || {};
  var body = { event_type: MS_TYPE, payload: opts.payload || {} };
  if (opts.entity_id) body.entity_id = opts.entity_id;
  if (opts.deleted) body.deleted = true;
  return sb.functions.invoke(MS_WRITE_FN, { body: body }).then(function (res) {
    var data = (res && res.data) || null;
    var err = res && res.error;
    if (err || (data && data.ok === false)) {
      if (ms2Is403(err)) return { error: 'ต้องเป็น HR / ล็อกอินก่อน' };
      return ms2ErrMsg(err, data).then(function (m) { return { error: m }; });
    }
    return { ok: true, entity_id: (data && data.entity_id) || opts.entity_id || '' };
  }).catch(function (e) {
    if (ms2Is403(e)) return { error: 'ต้องเป็น HR / ล็อกอินก่อน' };
    return ms2ErrMsg(e, null).then(function (m) { return { error: m }; });
  });
}

var _ms2NotReadyShown = {};
function ms2NotReady(feature) {
  if (_ms2NotReadyShown[feature]) return;
  _ms2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ms2Toast) window.ms2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountMilestone — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountMilestone() {
  if (!document.getElementById('wrap-milestone')) return;
  var wrap = document.getElementById('wrap-milestone');
  wrap.innerHTML = '<style>' + MS_CSS() + '</style><div id="ms">' + MS_MARKUP() + '</div>';
  MS_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #ms =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว) */
function MS_CSS() {
  return [
    // tokens (มาจาก _shared_styles)
    '#ms{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEE2E2;--success:#047857;--success-bg:#DCFCE7;--warning:#B45309;--warning-bg:#FEF3C7;--info:#1D4ED8;--info-bg:#DBEAFE;color:var(--text);font-size:13px;line-height:1.5}',
    '#ms *{box-sizing:border-box}',
    // buttons
    '#ms .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#ms .btn:hover{border-color:var(--navy)}',
    '#ms .btn svg{width:14px;height:14px}',
    '#ms .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#ms .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#ms .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#ms .btn-sm{padding:5px 10px;font-size:12px}',
    '#ms .btn-icon-danger{color:var(--danger);border-color:var(--danger)}',
    '#ms .btn-icon-danger:hover{background:var(--danger-bg)}',
    '#ms .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:8px;background:#fff;color:var(--text-muted);cursor:pointer}',
    '#ms .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#ms .btn-help svg{width:14px;height:14px}',
    // page head (native บน dashboard)
    '#ms .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#ms .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ms .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#ms .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ms .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;align-items:center}',
    // stats
    '#ms .stats{display:grid;gap:10px;margin-bottom:14px}',
    '#ms .stats.cols-5{grid-template-columns:repeat(5,1fr)}',
    '@media (max-width:1100px){#ms .stats.cols-5{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#ms .stats.cols-5{grid-template-columns:repeat(2,1fr)}}',
    '#ms .stat{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#ms .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px}',
    '#ms .stat-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#ms .stat-value{font-size:22px;font-weight:600;line-height:1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#ms .stat-sub{font-size:10px;color:var(--text-faint);margin-top:3px}',
    // filters
    '#ms .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}',
    '#ms .filter{display:flex;flex-direction:column;gap:2px}',
    '#ms .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#ms .filter input,#ms .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:150px;font-family:inherit;background:#fff;color:var(--text)}',
    '#ms .filter input:focus,#ms .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section
    '#ms .section{background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden}',
    '#ms .section-header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--border)}',
    '#ms .section-icon{width:30px;height:30px;border-radius:8px;background:var(--info-bg);color:var(--info);display:inline-flex;align-items:center;justify-content:center}',
    '#ms .section-icon svg{width:16px;height:16px}',
    '#ms .section-title{font-size:13px;font-weight:600;color:var(--text)}',
    '#ms .section-sub{font-size:11px;color:var(--text-muted);margin-top:1px}',
    '#ms .loading{text-align:center;padding:40px;color:var(--text-muted);font-size:13px}',
    '#ms .empty{padding:40px 20px;text-align:center}',
    '#ms .empty-icon{width:40px;height:40px;margin:0 auto 10px;color:var(--text-faint)}',
    '#ms .empty-icon svg{width:40px;height:40px}',
    '#ms .empty-title{font-size:14px;font-weight:600;color:var(--text)}',
    '#ms .empty-sub{font-size:12px;color:var(--text-muted);margin-top:4px}',
    // ms-grid (two-column)
    '#ms .ms-grid{display:grid;grid-template-columns:1fr 280px;gap:14px;align-items:start}',
    '@media (max-width:900px){#ms .ms-grid{grid-template-columns:1fr}}',
    // data-table
    '#ms .data-table{width:100%;border-collapse:collapse;font-size:13px}',
    '#ms .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#ms .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}',
    '#ms .data-table tbody tr{border-left:3px solid transparent;transition:background .15s;cursor:pointer}',
    '#ms .data-table tbody tr:hover{background:#FAFBFC}',
    '#ms .data-table tbody tr.is-inactive{opacity:.5}',
    '#ms .data-table tbody tr.sev-high{border-left-color:var(--warning)}',
    '#ms .data-table tbody tr.sev-urgent{border-left-color:var(--danger)}',
    '#ms .data-table tbody tr.sev-info{border-left-color:var(--info)}',
    '#ms .ms-title-cell{font-weight:500;font-size:13px;color:var(--text)}',
    '#ms .ms-id-meta{display:block;font-size:10px;color:var(--text-faint);margin-top:2px;font-family:monospace}',
    // pills
    '#ms .rec-pill{display:inline-block;padding:2px 9px;border-radius:12px;font-size:11px;font-weight:600}',
    '#ms .rec-monthly{background:#DBEAFE;color:#1E40AF}',
    '#ms .rec-yearly{background:#FEF3C7;color:#B45309}',
    '#ms .rec-weekly{background:#FCE7F3;color:#BE185D}',
    '#ms .rec-one_time{background:#DCFCE7;color:#15803D}',
    '#ms .sev-pill{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}',
    '#ms .sev-pill.sev-info{background:var(--info-bg);color:var(--info)}',
    '#ms .sev-pill.sev-normal{background:#F1F5F9;color:var(--text-muted)}',
    '#ms .sev-pill.sev-high{background:var(--warning-bg);color:var(--warning)}',
    '#ms .sev-pill.sev-urgent{background:var(--danger-bg);color:var(--danger)}',
    '#ms .handling-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}',
    '#ms .handling-auto{background:var(--success-bg);color:var(--success)}',
    '#ms .handling-manual{background:var(--warning-bg);color:var(--warning)}',
    '#ms .handling-badge svg{width:11px;height:11px}',
    '#ms .next-cell{font-size:12px;font-family:"SF Mono",Consolas,monospace;color:var(--text)}',
    '#ms .next-meta{display:block;font-size:10px;color:var(--text-faint);margin-top:1px}',
    '#ms .next-meta.soon{color:var(--warning);font-weight:600}',
    '#ms .next-meta.today{color:var(--danger);font-weight:600}',
  ].join('\n') + MS_CSS2();
}

/* CSS part 2 — switch / upcoming sidebar / modal / field / conditional / sev-radio */
function MS_CSS2() {
  return '\n' + [
    // toggle switch
    '#ms .switch{position:relative;display:inline-block;width:36px;height:20px}',
    '#ms .switch input{opacity:0;width:0;height:0}',
    '#ms .slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#CBD5E1;border-radius:10px;transition:.2s}',
    '#ms .slider:before{position:absolute;content:"";height:16px;width:16px;left:2px;bottom:2px;background:#fff;border-radius:50%;transition:.2s}',
    '#ms .switch input:checked + .slider{background:var(--success)}',
    '#ms .switch input:checked + .slider:before{transform:translateX(16px)}',
    // upcoming sidebar
    '#ms .upcoming-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;position:sticky;top:14px}',
    '#ms .upcoming-title{font-size:12px;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.04em;display:flex;align-items:center;gap:8px;margin-bottom:12px}',
    '#ms .upcoming-title svg{width:14px;height:14px;color:var(--text-muted)}',
    '#ms .upcoming-item{padding:8px 10px;border-left:2px solid transparent;margin-bottom:4px;border-radius:4px;transition:background .15s}',
    '#ms .upcoming-item:hover{background:#FAFBFC}',
    '#ms .upcoming-item.today{border-left-color:var(--danger);background:#FEF2F2}',
    '#ms .upcoming-item.tomorrow{border-left-color:var(--warning);background:#FFFBEB}',
    '#ms .upcoming-item.week{border-left-color:var(--info)}',
    '#ms .up-date{font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;display:flex;justify-content:space-between}',
    '#ms .up-title{font-size:12px;color:var(--text);margin-top:3px;line-height:1.3}',
    '#ms .up-time{font-size:10px;color:var(--text-faint);margin-top:2px;font-family:monospace}',
    // modal
    '#ms .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#ms .modal-bg.active{display:flex}',
    '#ms .modal{background:#fff;border-radius:12px;max-width:600px;width:92%;max-height:92vh;overflow-y:auto}',
    '#ms .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#ms .modal-header h2{font-size:16px;margin:0}',
    '#ms .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#ms .modal-body{padding:16px 20px}',
    '#ms .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;gap:8px;flex-wrap:wrap}',
    // field
    '#ms .field{margin-bottom:12px}',
    '#ms .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#ms .field input,#ms .field select,#ms .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#ms .field input:focus,#ms .field select:focus,#ms .field textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#ms .field textarea{min-height:64px;resize:vertical}',
    '#ms .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '#ms code{background:#F1F5F9;padding:1px 5px;border-radius:3px;font-family:monospace;font-size:11px}',
    // conditional
    '#ms .conditional{display:none}',
    '#ms .conditional.active{display:block}',
    '#ms .recurrence-help{font-size:11px;color:var(--text-muted);background:#F8FAFC;padding:8px 10px;border-radius:6px;margin-top:6px;line-height:1.5}',
    // sev radios
    '#ms .sev-radio-group{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}',
    '#ms .sev-radio{padding:8px 10px;border:1px solid var(--border-strong);border-radius:6px;cursor:pointer;text-align:center;font-size:12px;font-weight:500;transition:all .15s;background:var(--surface)}',
    '#ms .sev-radio:hover{border-color:var(--navy)}',
    '#ms .sev-radio.selected{border-width:2px;padding:7px 9px}',
    '#ms .sev-radio[data-sev="info"].selected{border-color:var(--info);background:var(--info-bg);color:var(--info)}',
    '#ms .sev-radio[data-sev="normal"].selected{border-color:var(--text-muted);background:#F1F5F9;color:var(--text)}',
    '#ms .sev-radio[data-sev="high"].selected{border-color:var(--warning);background:var(--warning-bg);color:var(--warning)}',
    '#ms .sev-radio[data-sev="urgent"].selected{border-color:var(--danger);background:var(--danger-bg);color:var(--danger)}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + stats + filters + ms-grid + modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell/topbar ออก */
function MS_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4l8 4 8-4v18M4 22h16"/><line x1="12" y1="22" x2="12" y2="13"/></svg>',
    '      HR Milestones',
    '    </h1>',
    '    <div class="subtitle">Milestone ของพนักงาน · 1 ปี · 5 ปี · 10 ปี · auto-flex อวยพร</div>',
    '  </div>',
    '  <div class="page-actions" id="ms-page-actions">',
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn" data-tip="คู่มือการใช้หน้านี้"></button>',
    '    <button class="btn btn-sm" onclick="loadList()" id="refresh-btn"></button>',
    '    <button class="btn btn-sm" onclick="seedDefaults()">Seed defaults</button>',
    '    <button class="btn btn-primary" onclick="openAdd()" id="add-btn"></button>',
    '  </div>',
    '</header>',
    // stats
    '<div class="stats cols-5" id="stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ค้นหา</label>',
    '    <input type="search" id="filter-search" placeholder="title / description / notes" oninput="loadList()">',
    '  </div>',
    '  <div class="filter">',
    '    <label>Recurrence</label>',
    '    <select id="filter-rec" onchange="loadList()">',
    '      <option value="">ทั้งหมด</option>',
    '      <option value="monthly">รายเดือน</option>',
    '      <option value="yearly">รายปี</option>',
    '      <option value="weekly">รายสัปดาห์</option>',
    '      <option value="one_time">ครั้งเดียว</option>',
    '    </select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>Severity</label>',
    '    <select id="filter-sev" onchange="loadList()">',
    '      <option value="">ทุกระดับ</option>',
    '      <option value="urgent">Urgent</option>',
    '      <option value="high">High</option>',
    '      <option value="normal">Normal</option>',
    '      <option value="info">Info</option>',
    '    </select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>การจัดการ</label>',
    '    <select id="filter-handling" onchange="loadList()">',
    '      <option value="">ทั้งหมด</option>',
    '      <option value="auto">Auto (ระบบทำเอง)</option>',
    '      <option value="manual">Manual (HR ทำมือ)</option>',
    '    </select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>สถานะ</label>',
    '    <select id="filter-active" onchange="loadList()">',
    '      <option value="">ทั้งหมด</option>',
    '      <option value="true">เปิดใช้งาน</option>',
    '      <option value="false">ปิด</option>',
    '    </select>',
    '  </div>',
    '</div>',
    // ms-grid
    '<div class="ms-grid">',
    '  <div class="section">',
    '    <div class="section-header">',
    '      <div class="section-icon" id="section-icon"></div>',
    '      <div style="flex:1">',
    '        <div class="section-title">รายการ Milestone</div>',
    '        <div class="section-sub">คลิกแถวเพื่อแก้ไข — toggle switch เพื่อเปิด/ปิดเร็ว</div>',
    '      </div>',
    '    </div>',
    '    <div id="content" class="loading">กำลังโหลด...</div>',
    '  </div>',
    '  <div class="upcoming-card">',
    '    <div class="upcoming-title">',
    '      <span id="up-icon"></span>',
    '      <span>30 วันข้างหน้า</span>',
    '    </div>',
    '    <div id="upcoming-list" class="loading">—</div>',
    '  </div>',
    '</div>',
    MS_MODAL(),
  ].join('\n');
}

/* Modal add/edit · คง element id เดิม */
function MS_MODAL() {
  return [
    '<div class="modal-bg" id="modal-bg" onclick="if(event.target===this)closeModal()">',
    '  <div class="modal" style="max-width:600px">',
    '    <div class="modal-header">',
    '      <h2 id="modal-title">เพิ่ม Milestone</h2>',
    '      <p id="modal-sub">กรอกชื่องาน + รอบเวลา</p>',
    '    </div>',
    '    <div class="modal-body">',
    '      <input type="hidden" id="m-id">',
    '      <div class="field"><label>ชื่องาน *</label><input type="text" id="m-title" placeholder="เช่น ส่ง สปส.1-10 ภายในวันที่ 15"></div>',
    '      <div class="field"><label>คำอธิบาย</label><textarea id="m-description" placeholder="รายละเอียดที่ HR ต้องทำ — แสดงใน HR Today"></textarea></div>',
    '      <div class="field">',
    '        <label>รอบการเตือน *</label>',
    '        <select id="m-recurrence" onchange="onRecurrenceChange()">',
    '          <option value="monthly">รายเดือน — ทุกเดือนวันเดียวกัน</option>',
    '          <option value="yearly">รายปี — เดือน + วันที่กำหนด</option>',
    '          <option value="weekly">รายสัปดาห์ — วันในสัปดาห์</option>',
    '          <option value="one_time">ครั้งเดียว — เฉพาะวันที่ระบุ</option>',
    '        </select>',
    '      </div>',
    // monthly
    '      <div class="conditional" id="cond-monthly">',
    '        <div class="field">',
    '          <label>วันที่ในเดือน *</label>',
    '          <input type="text" id="m-dom-monthly" placeholder=\'เช่น 15 หรือ "last"\' style="font-family:monospace">',
    '          <div class="recurrence-help">ใส่ตัวเลข 1-31 (เช่น <code>15</code>) หรือ <code>last</code> สำหรับวันสุดท้ายของเดือน</div>',
    '        </div>',
    '      </div>',
    // yearly
    '      <div class="conditional" id="cond-yearly">',
    '        <div class="field-grid">',
    '          <div class="field">',
    '            <label>เดือน *</label>',
    '            <select id="m-month">',
    '              <option value="">— เลือก —</option>',
    '              <option value="1">มกราคม (1)</option>',
    '              <option value="2">กุมภาพันธ์ (2)</option>',
    '              <option value="3">มีนาคม (3)</option>',
    '              <option value="4">เมษายน (4)</option>',
    '              <option value="5">พฤษภาคม (5)</option>',
    '              <option value="6">มิถุนายน (6)</option>',
    '              <option value="7">กรกฎาคม (7)</option>',
    '              <option value="8">สิงหาคม (8)</option>',
    '              <option value="9">กันยายน (9)</option>',
    '              <option value="10">ตุลาคม (10)</option>',
    '              <option value="11">พฤศจิกายน (11)</option>',
    '              <option value="12">ธันวาคม (12)</option>',
    '            </select>',
    '          </div>',
    '          <div class="field"><label>วันที่ *</label><input type="text" id="m-dom-yearly" placeholder=\'1-31 หรือ "last"\' style="font-family:monospace"></div>',
    '        </div>',
    '      </div>',
    // weekly
    '      <div class="conditional" id="cond-weekly">',
    '        <div class="field-grid">',
    '          <div class="field">',
    '            <label>วันในสัปดาห์ *</label>',
    '            <select id="m-dow">',
    '              <option value="">— เลือก —</option>',
    '              <option value="0">อาทิตย์</option>',
    '              <option value="1">จันทร์</option>',
    '              <option value="2">อังคาร</option>',
    '              <option value="3">พุธ</option>',
    '              <option value="4">พฤหัสบดี</option>',
    '              <option value="5">ศุกร์</option>',
    '              <option value="6">เสาร์</option>',
    '            </select>',
    '          </div>',
    '          <div class="field">',
    '            <label>สัปดาห์ที่</label>',
    '            <select id="m-wom">',
    '              <option value="all">ทุกสัปดาห์</option>',
    '              <option value="1">สัปดาห์ที่ 1</option>',
    '              <option value="2">สัปดาห์ที่ 2</option>',
    '              <option value="3">สัปดาห์ที่ 3</option>',
    '              <option value="4">สัปดาห์ที่ 4</option>',
    '              <option value="last">สัปดาห์สุดท้าย</option>',
    '            </select>',
    '          </div>',
    '        </div>',
    '      </div>',
    // one-time
    '      <div class="conditional" id="cond-one_time">',
    '        <div class="field">',
    '          <label>วันที่ *</label>',
    '          <input type="date" id="m-date">',
    '          <div class="recurrence-help">วันที่เฉพาะเจาะจง — เตือนแค่ครั้งเดียว</div>',
    '        </div>',
    '      </div>',
    // severity
    '      <div class="field">',
    '        <label>ระดับความสำคัญ</label>',
    '        <div class="sev-radio-group" id="sev-radios">',
    '          <div class="sev-radio" data-sev="info" onclick="selectSev(\'info\')">Info</div>',
    '          <div class="sev-radio selected" data-sev="normal" onclick="selectSev(\'normal\')">Normal</div>',
    '          <div class="sev-radio" data-sev="high" onclick="selectSev(\'high\')">High</div>',
    '          <div class="sev-radio" data-sev="urgent" onclick="selectSev(\'urgent\')">Urgent</div>',
    '        </div>',
    '      </div>',
    '      <div class="field-grid">',
    '        <div class="field"><label>เวลา (HH:mm)</label><input type="text" id="m-time" placeholder="09:00" style="font-family:monospace"></div>',
    '        <div class="field">',
    '          <label>Icon</label>',
    '          <select id="m-icon">',
    '            <option value="calendar">calendar</option>',
    '            <option value="data">data</option>',
    '            <option value="door">door</option>',
    '            <option value="money">money</option>',
    '            <option value="cake">cake</option>',
    '            <option value="compliance">compliance</option>',
    '            <option value="folder">folder</option>',
    '            <option value="announcement">announcement</option>',
    '            <option value="medical">medical</option>',
    '            <option value="chart">chart</option>',
    '            <option value="survey">survey</option>',
    '          </select>',
    '        </div>',
    '      </div>',
    '      <div class="field-grid">',
    '        <div class="field"><label>Link</label><input type="text" id="m-link" placeholder="?page=compliance หรือ https://..." style="font-family:monospace;font-size:12px"></div>',
    '        <div class="field"><label>Target Role</label><input type="text" id="m-target" placeholder="all_hr / accountant / hr_manager"></div>',
    '      </div>',
    '      <div class="field">',
    '        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">',
    '          <input type="checkbox" id="m-auto" style="width:auto">',
    '          <span><strong>Auto-handled</strong> — ระบบทำเองอัตโนมัติ (ไม่ต้องโชว์ใน HR Today urgent list)</span>',
    '        </label>',
    '      </div>',
    '      <div class="field"><label>Notes (internal)</label><textarea id="m-notes" placeholder="หมายเหตุภายใน เช่น Trello card ref"></textarea></div>',
    '    </div>',
    '    <div class="modal-footer" style="justify-content:space-between">',
    '      <div><button class="btn btn-icon-danger" id="m-remove-btn" onclick="removeMilestone()" style="display:none">ลบ</button></div>',
    '      <div style="display:flex;gap:6px">',
    '        <button class="btn" onclick="closeModal()">ยกเลิก</button>',
    '        <button class="btn btn-primary" onclick="saveMilestone()" id="save-btn"></button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   MS_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → MS_BACKEND
   helper (ICONS/showHelp/showToast/escapeHtml/escapeAttr/statCard) inline
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function MS_RUN_PAGE_JS() {

  // ---- google.script.run shim → MS_BACKEND ----
  function _ms2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (MS_BACKEND[prop]) {
            Promise.resolve().then(function () { return MS_BACKEND[prop].apply(MS_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[MS_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[MS_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ms2MakeChain(); } });

  // ---- ICONS (inline subset ที่หน้านี้ใช้) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('ms2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ms2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ms2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('ms-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'ms-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'ms-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'ms-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม milestone_manager.html (ลอกทั้งดุ้น) =====
     ใช้ scope ใต้ #ms กันชน id (getById helper)
     ==================================================================== */
  const _msRoot = document.getElementById('ms');
  function $id(id) { return _msRoot ? _msRoot.querySelector('#' + id) : document.getElementById(id); }
  function getById(id) { return $id(id); }

  let allData = null;
  let selectedSeverity = 'normal';

  const HELP = {
    title: 'HR Milestones — ปฏิทินงาน HR',
    subtitle: 'Sheet: 78_HR_Milestones',
    intro: 'ตั้งค่างาน/event ที่ HR ต้องทำซ้ำตามรอบ — ระบบจะเตือนใน HR Today dashboard + push LINE morning digest',
    sections: [
      { title: 'การใช้งาน', items: [
        'กด <strong>Seed defaults</strong> ครั้งแรก — สร้าง milestones ตัวอย่าง 20+ ชิ้นจาก Trello',
        'กด <strong>+ เพิ่ม</strong> ใหม่ → กรอก title + เลือก recurrence (monthly/yearly/weekly/once)',
        'Toggle switch ในตาราง = เปิด/ปิดเร็ว (active)',
        'คลิกแถว = แก้ไขเต็ม + ลบ',
      ]},
      { title: 'Recurrence types', items: [
        '<strong>Monthly</strong> — ทุกเดือนวันเดียวกัน (เช่น dom=15)',
        '<strong>Yearly</strong> — เดือน + วันที่ (เช่น month=12, dom=31)',
        '<strong>Weekly</strong> — วันในสัปดาห์ (dow=1=จันทร์) + สัปดาห์ที่ (1-4/last/all)',
        '<strong>One-time</strong> — เฉพาะวันที่ระบุ ครั้งเดียว',
        'ใช้ <code>last</code> ใน dom = วันสุดท้ายของเดือน (รองรับ 28-31)',
      ]},
      { title: 'Auto vs Manual', items: [
        '<strong>Auto-handled</strong> = ระบบทำเอง (เช่น Backend Data Extract, Cake order) → ไม่โชว์ใน urgent',
        '<strong>Manual</strong> = HR ต้องทำมือ → โชว์ใน HR Today + เตือน LINE',
      ]},
      { type: 'warn', title: 'ระวัง', items: [
        'แก้ recurrence แล้ว next_occurrence ใน sidebar จะ refresh หลัง reload',
        'Milestone ที่ <code>auto_handled = true</code> ต้องมี cron/trigger ทำงานคู่กัน — ไม่งั้นจะไม่ทำอะไร',
        'ลบ milestone บน dashboard = soft delete (event ใหม่ deleted=true · กู้คืนได้) ใช้ toggle off แทนถ้าจะ pause',
        'การเพิ่ม/แก้/ลบ/toggle เขียนกลับ Supabase จริง · Seed defaults ยังไม่พร้อม (เพิ่มทีละข้อ)',
      ]},
    ],
  };

  // ===== header icons =====
  getById('refresh-btn').innerHTML = ICONS.refresh;
  getById('add-btn').innerHTML = ICONS.plus + ' เพิ่ม';
  getById('save-btn').innerHTML = ICONS.save + ' บันทึก';
  getById('section-icon').innerHTML = ICONS.cal;
  getById('help-btn').innerHTML = ICONS.help;
  getById('up-icon').innerHTML = ICONS.cal;

  function loadList() {
    getById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    getById('upcoming-list').innerHTML = '<div class="loading">—</div>';
    const opts = {
      search: getById('filter-search').value || '',
      recurrence: getById('filter-rec').value || '',
      severity: getById('filter-sev').value || '',
      handling: getById('filter-handling').value || '',
      active: getById('filter-active').value || '',
    };
    google.script.run
      .withSuccessHandler(d => {
        allData = d;
        renderStats(d.stats || {});
        renderList(d.milestones || []);
        renderUpcoming(d.upcoming || []);
      })
      .withFailureHandler(e => {
        getById('content').innerHTML =
          '<div class="empty"><div class="empty-title">โหลดไม่สำเร็จ</div>' +
          '<div class="empty-sub">' + escapeHtml(e.message) + '</div></div>';
      })
      .milestoneAdminList(opts);
  }

  function renderStats(s) {
    getById('stats').innerHTML = [
      statCard('ทั้งหมด', s.total, 'milestones', 'var(--navy)'),
      statCard('เปิดใช้', s.active, 'active', 'var(--success)'),
      statCard('Auto', s.auto, 'ระบบทำเอง', 'var(--info)'),
      statCard('Manual', s.manual, 'HR ทำมือ', 'var(--warning)'),
      statCard('7 วันถัดไป', s.upcoming_7, 'จะถึงเร็ว ๆ', s.upcoming_7 > 0 ? 'var(--danger)' : 'var(--text-faint)'),
    ].join('');
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  function renderList(items) {
    if (!items.length) {
      const total = (allData && allData.total_in_db) || 0;
      if (total === 0) {
        getById('content').innerHTML =
          '<div class="empty"><div class="empty-icon">' + ICONS.cal + '</div>' +
          '<div class="empty-title">ยังไม่มี milestone</div>' +
          '<div class="empty-sub">ยังไม่มีข้อมูล milestone บน dashboard</div></div>';
      } else {
        getById('content').innerHTML =
          '<div class="empty"><div class="empty-title">ไม่พบ milestone</div>' +
          '<div class="empty-sub">ลองเปลี่ยน filter</div></div>';
      }
      return;
    }

    const rows = items.map(m => {
      const trClass = [
        m.active ? '' : 'is-inactive',
        'sev-' + m.severity,
      ].filter(Boolean).join(' ');

      let nextMeta = '';
      if (m.next_occurrence) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const next = new Date(m.next_occurrence);
        const days = Math.floor((next - today) / 86400000);
        if (days === 0) nextMeta = '<span class="next-meta today">วันนี้</span>';
        else if (days === 1) nextMeta = '<span class="next-meta soon">พรุ่งนี้</span>';
        else if (days <= 7) nextMeta = '<span class="next-meta soon">อีก ' + days + ' วัน</span>';
        else nextMeta = '<span class="next-meta">อีก ' + days + ' วัน</span>';
      }

      const handling = m.auto_handled
        ? '<span class="handling-badge handling-auto">' + ICONS.check + ' Auto</span>'
        : '<span class="handling-badge handling-manual">' + ICONS.bell + ' Manual</span>';

      return [
        '<tr class="' + trClass + '" onclick="openEdit(\'' + escapeAttr(m.milestone_id) + '\')">',
          '<td>',
            '<div class="ms-title-cell">' + escapeHtml(m.title) + '</div>',
            '<span class="ms-id-meta">' + escapeHtml(m.milestone_id) + '</span>',
          '</td>',
          '<td><span class="rec-pill rec-' + m.recurrence + '">' + escapeHtml(m.recurrence_human) + '</span></td>',
          '<td><span class="sev-pill sev-' + m.severity + '">' + escapeHtml(m.severity) + '</span></td>',
          '<td>' + handling + '</td>',
          '<td><div class="next-cell">' + escapeHtml(m.next_occurrence || '—') + nextMeta + '</div></td>',
          '<td onclick="event.stopPropagation()" style="text-align:center">',
            '<label class="switch">',
              '<input type="checkbox" ' + (m.active ? 'checked' : '') + ' onchange="toggleActive(\'' + escapeAttr(m.milestone_id) + '\')">',
              '<span class="slider"></span>',
            '</label>',
          '</td>',
        '</tr>',
      ].join('');
    }).join('');

    getById('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th>Milestone</th>',
          '<th style="width:160px">รอบเวลา</th>',
          '<th style="width:80px">ระดับ</th>',
          '<th style="width:90px">การจัดการ</th>',
          '<th style="width:140px">ครั้งถัดไป</th>',
          '<th style="width:60px;text-align:center">เปิด</th>',
        '</tr></thead>',
        '<tbody>' + rows + '</tbody>',
      '</table>',
    ].join('');
  }

  function renderUpcoming(items) {
    if (!items.length) {
      getById('upcoming-list').innerHTML =
        '<div style="font-size:11px;color:var(--text-faint);padding:14px 0;text-align:center">ไม่มีงานใน 30 วัน</div>';
      return;
    }
    const html = items.map(it => {
      const days = it.days_from_today;
      const cls = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days <= 7 ? 'week' : '';
      const dateLabel = days === 0 ? 'วันนี้' : days === 1 ? 'พรุ่งนี้' :
                       days <= 7 ? 'อีก ' + days + ' วัน' : it.date.substring(5);
      const sevDot = it.severity === 'urgent' ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--danger);margin-right:4px;vertical-align:middle"></span>' :
                     it.severity === 'high' ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--warning);margin-right:4px;vertical-align:middle"></span>' : '';
      return [
        '<div class="upcoming-item ' + cls + '" onclick="openEdit(\'' + escapeAttr(it.milestone_id) + '\')" style="cursor:pointer">',
          '<div class="up-date"><span>' + dateLabel + '</span><span style="font-family:monospace">' + escapeHtml(it.date.substring(5)) + '</span></div>',
          '<div class="up-title">' + sevDot + escapeHtml(it.title) + '</div>',
          it.time ? '<div class="up-time">' + escapeHtml(it.time) + '</div>' : '',
        '</div>',
      ].join('');
    }).join('');
    getById('upcoming-list').innerHTML = html;
  }

  function onRecurrenceChange() {
    const rec = getById('m-recurrence').value;
    ['monthly', 'yearly', 'weekly', 'one_time'].forEach(r => {
      const el = getById('cond-' + r);
      if (el) el.classList.toggle('active', r === rec);
    });
  }

  function selectSev(sev) {
    selectedSeverity = sev;
    _msRoot.querySelectorAll('.sev-radio').forEach(el => {
      el.classList.toggle('selected', el.getAttribute('data-sev') === sev);
    });
  }

  function openAdd() {
    getById('modal-title').textContent = 'เพิ่ม Milestone';
    getById('modal-sub').textContent = 'กรอกชื่องาน + รอบเวลา';
    getById('m-id').value = '';
    getById('m-title').value = '';
    getById('m-description').value = '';
    getById('m-recurrence').value = 'monthly';
    getById('m-dom-monthly').value = '';
    getById('m-dom-yearly').value = '';
    getById('m-month').value = '';
    getById('m-dow').value = '';
    getById('m-wom').value = 'all';
    getById('m-date').value = '';
    getById('m-time').value = '';
    getById('m-icon').value = 'calendar';
    getById('m-link').value = '';
    getById('m-target').value = 'all_hr';
    getById('m-auto').checked = false;
    getById('m-notes').value = '';
    selectSev('normal');
    getById('m-remove-btn').style.display = 'none';
    onRecurrenceChange();
    getById('modal-bg').classList.add('active');
  }

  function openEdit(id) {
    const m = (allData && allData.milestones || []).find(x => x.milestone_id === id);
    if (!m) return;
    getById('modal-title').textContent = 'แก้ไข ' + m.milestone_id;
    getById('modal-sub').textContent = m.recurrence_human;
    getById('m-id').value = m.milestone_id;
    getById('m-title').value = m.title;
    getById('m-description').value = m.description || '';
    getById('m-recurrence').value = m.recurrence;
    getById('m-dom-monthly').value = m.dom || '';
    getById('m-dom-yearly').value = m.dom || '';
    getById('m-month').value = m.month || '';
    getById('m-dow').value = m.day_of_week || '';
    getById('m-wom').value = m.week_of_month || 'all';
    getById('m-date').value = m.date_iso || '';
    getById('m-time').value = m.time || '';
    getById('m-icon').value = m.icon || 'calendar';
    getById('m-link').value = m.link || '';
    getById('m-target').value = m.target_role || 'all_hr';
    getById('m-auto').checked = !!m.auto_handled;
    getById('m-notes').value = m.notes || '';
    selectSev(m.severity || 'normal');
    getById('m-remove-btn').style.display = '';
    onRecurrenceChange();
    getById('modal-bg').classList.add('active');
  }

  function closeModal() { getById('modal-bg').classList.remove('active'); }

  function saveMilestone() {
    const isEdit = !!getById('m-id').value;
    const rec = getById('m-recurrence').value;

    const payload = {
      title: getById('m-title').value.trim(),
      description: getById('m-description').value.trim(),
      recurrence: rec,
      severity: selectedSeverity,
      time: getById('m-time').value.trim(),
      icon: getById('m-icon').value,
      link: getById('m-link').value.trim(),
      target_role: getById('m-target').value.trim() || 'all_hr',
      auto_handled: getById('m-auto').checked,
      notes: getById('m-notes').value.trim(),
      active: true,
    };
    if (rec === 'monthly') payload.dom = getById('m-dom-monthly').value.trim();
    if (rec === 'yearly') {
      payload.dom = getById('m-dom-yearly').value.trim();
      payload.month = getById('m-month').value;
    }
    if (rec === 'weekly') {
      payload.day_of_week = getById('m-dow').value;
      payload.week_of_month = getById('m-wom').value;
    }
    if (rec === 'one_time') payload.date_iso = getById('m-date').value;

    if (!payload.title) { showToast('ระบุ title', 'error'); return; }

    const btn = getById('save-btn');
    btn.disabled = true; btn.textContent = '...';

    const onDone = (r) => {
      btn.disabled = false; btn.innerHTML = ICONS.save + ' บันทึก';
      if (r && r.error) { showToast(r.error, 'error'); return; }
      showToast(isEdit ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว', 'success');
      closeModal(); loadList();
    };
    const onErr = (e) => {
      btn.disabled = false; btn.innerHTML = ICONS.save + ' บันทึก';
      showToast('Error: ' + e.message, 'error');
    };

    if (isEdit) {
      google.script.run.withSuccessHandler(onDone).withFailureHandler(onErr)
        .milestoneAdminUpdate(getById('m-id').value, payload);
    } else {
      google.script.run.withSuccessHandler(onDone).withFailureHandler(onErr)
        .milestoneAdminAdd(payload);
    }
  }

  function toggleActive(id) {
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); loadList(); return; }
        showToast('อัปเดตสถานะแล้ว', 'success'); loadList();
      })
      .withFailureHandler(e => { showToast('Error: ' + e.message, 'error'); loadList(); })
      .milestoneAdminToggleActive(id);
  }

  function removeMilestone() {
    const id = getById('m-id').value;
    if (!id) return;
    if (!confirm('ลบ milestone นี้? (ใช้ toggle off แทนถ้าจะ pause ชั่วคราว)')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('ลบแล้ว', 'success');
        closeModal(); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .milestoneAdminRemove(id);
  }

  function seedDefaults() {
    if (!confirm('Seed default milestones? — จะ insert 20+ ตัวอย่าง (ข้ามถ้ามีอยู่แล้ว)')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (r && r.skipped) { showToast('มี milestones อยู่แล้ว ' + r.count + ' ตัว', 'success'); }
        else if (r && r.seeded) { showToast('Seed สำเร็จ ' + r.seeded + ' ตัว', 'success'); }
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .milestoneAdminSeedDefaults();
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window (prefix-safe ผ่าน _exp) ===== */
  const _exp = {
    showHelp, HELP, loadList,
    renderStats, renderList, renderUpcoming, statCard,
    onRecurrenceChange, selectSev,
    openAdd, openEdit, closeModal, saveMilestone, toggleActive, removeMilestone, seedDefaults,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadList();
}

/* expose mount fn ให้ index.html PORTED_FN เรียกได้ */
if (typeof window !== 'undefined') { window.mountMilestone = mountMilestone; }
