// _ported/oneonone.js — FULL native port of desktop one_on_one_manager.html (HR Announcement admin)
// ลอกทั้งดุ้นแบบ gold template (announce.js): markup + CSS เดิม (1:1 Log Manager) prefix #oo ทั้งหมด
//   คง element id เดิม (stats/content/tab-*/prop-bg/detail-bg/p-employee/d-*/slot-stack/...)
//   JS หน้าเดิมรันใน scope ของ mountOneonone() · google.script.run = shim → OO_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน mountOneonone (prefix id ปลอดภัยพอ)
//
// backend (edge fn hr_oneonone):
//   list   : sb.functions.invoke('hr_oneonone')                 -> { items:[...] }
//   create/บันทึกผล : sb.functions.invoke('hr_oneonone',{body:{employee_id,supervisor_id,
//            session_date,mode,topic,notes,action_items,sentiment,next_date}})
//   whoami : ไม่มี endpoint จริง → {ok:true} เต็มสิทธิ์
//   propose-slot / confirm / decline / no-show : backend ทำจริงไม่ได้ → stub + toast "ยังไม่พร้อม"

/* ============================================================
   OO_BACKEND — map google.script.run → Supabase edge fn hr_oneonone
   คืน shape เดียวกับที่ JS หน้าเดิมคาดหวัง (renderStats/renderCard/renderDetail/renderOverdue)
   ============================================================ */
function oo2ToBool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

// map row จาก backend → shape ที่ JS หน้าเดิมใช้ (session object)
function oo2MapSession(p) {
  p = p || {};
  var status = String(p.status || 'proposed').toLowerCase();
  var sessionDate = String(p.session_date || '').slice(0, 10);
  var dft = oo2DaysFromToday(sessionDate);
  return {
    session_id: String(p.session_id || p.id || p.row || ((p.employee_id || '') + '|' + sessionDate) || ''),
    employee_id: p.employee_id || '',
    employee_name: p.employee_name || p.employee_id || '',
    employee_nickname: p.employee_nickname || '',
    employee_line_linked: oo2ToBool(p.employee_line_linked),
    supervisor_id: p.supervisor_id || '',
    supervisor_name: p.supervisor_name || p.supervisor_id || '—',
    branch_id: p.branch_id || '',
    branch_name: p.branch_name || '',
    status: status,
    session_date: sessionDate,
    session_time: p.session_time || '',
    mode: p.mode || 'in_person',
    meeting_link: p.meeting_link || '',
    topic: p.topic || p.agenda || p.notes || '',
    notes: p.notes || '',
    action_items: p.action_items || '',
    decisions: p.decisions || '',
    sentiment: Number(p.sentiment || 0),
    decline_reason: p.decline_reason || '',
    reschedule_count: Number(p.reschedule_count || 0),
    reminder_1d_sent: oo2ToBool(p.reminder_1d_sent),
    reminder_1h_sent: oo2ToBool(p.reminder_1h_sent),
    next_date: p.next_date || '',
    days_from_today: dft,
    // alt_slots: backend ไม่มี multi-slot → ใช้ slot เดียวจาก session_date
    alt_slots: (Array.isArray(p.alt_slots) && p.alt_slots.length)
      ? p.alt_slots
      : (sessionDate ? [{ display: sessionDate + (p.session_time ? ' ' + p.session_time : ''), value: sessionDate }] : []),
  };
}

function oo2DaysFromToday(dateStr) {
  if (!dateStr) return 0;
  var d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return 0;
  var now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

// ดึง items ครั้งเดียว แล้ว cache (list/detail/stats ใช้ชุดเดียวกัน)
var _oo2Cache = null;
function oo2FetchAll() {
  return sb.functions.invoke('hr_oneonone').then(function (res) {
    var data = (res && res.data) || {};
    var items = (data.items || []).map(oo2MapSession);
    _oo2Cache = items;
    return items;
  }).catch(function (e) {
    console.error('[OO_BACKEND] fetch', e);
    _oo2Cache = [];
    return [];
  });
}

// คำนวณ stats จาก items (client-side · backend ไม่มี stats endpoint)
function oo2ComputeStats(items) {
  var now = new Date();
  var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  var st = function (r) { return String(r.status || '').toLowerCase(); };
  var bucket = function (s) {
    s = String(s || '').toLowerCase();
    if (s === 'proposed' || s === '') return 'pending';
    if (s === 'confirmed' || s === 'scheduled') return 'upcoming';
    return 'past';
  };
  var proposed = items.filter(function (r) { return bucket(r.status) === 'pending'; }).length;
  var upcoming = items.filter(function (r) { return bucket(r.status) === 'upcoming'; }).length;
  var completedMonth = items.filter(function (r) { return st(r) === 'completed' && String(r.session_date || '').slice(0, 7) === ym; }).length;
  var noShowMonth = items.filter(function (r) { return st(r) === 'no_show' && String(r.session_date || '').slice(0, 7) === ym; }).length;
  var denom = completedMonth + noShowMonth;
  var noShowRate = denom ? Math.round((noShowMonth / denom) * 100) : 0;
  // overdue = พนักงานที่ session ล่าสุด (past) ค้างเกิน 30 วัน
  var byEmp = {};
  items.forEach(function (r) {
    var id = r.employee_id || r.employee_name || '?';
    var dft = oo2DaysFromToday(r.session_date);
    if (!byEmp[id] || dft > byEmp[id]._dft) byEmp[id] = { _dft: dft, status: r.status };
  });
  var overdue = Object.keys(byEmp).filter(function (id) {
    return byEmp[id]._dft <= -30 && bucket(byEmp[id].status) === 'past';
  }).length;
  return {
    proposed: proposed, upcoming: upcoming,
    completed_month: completedMonth, no_show_month: noShowMonth,
    no_show_rate_pct: noShowRate, overdue: overdue,
  };
}

// derive managers/branches list จาก items (filter dropdowns)
function oo2Lookups(items) {
  var mSeen = {}, bSeen = {}, eSeen = {};
  items.forEach(function (r) {
    var mid = (r.supervisor_id || '').trim();
    if (mid && !mSeen[mid]) mSeen[mid] = { id: mid, name: r.supervisor_name || mid, nickname: r.supervisor_name || mid };
    var bid = (r.branch_id || r.branch_name || '').trim();
    if (bid && !bSeen[bid]) bSeen[bid] = { id: bid, name: r.branch_name || bid };
    var eid = (r.employee_id || '').trim();
    if (eid && !eSeen[eid]) eSeen[eid] = {
      id: eid, name: r.employee_name || eid, nickname: r.employee_nickname || '',
      supervisor_id: r.supervisor_id || '', line_linked: r.employee_line_linked,
    };
  });
  return {
    managers: Object.keys(mSeen).map(function (k) { return mSeen[k]; }),
    branches: Object.keys(bSeen).map(function (k) { return bSeen[k]; }),
    employees: Object.keys(eSeen).map(function (k) { return eSeen[k]; }),
  };
}

// apply tab + filters → sessions
function oo2ApplyTab(items, opts) {
  var bucket = function (s) {
    s = String(s || '').toLowerCase();
    if (s === 'proposed' || s === '') return 'pending';
    if (s === 'confirmed' || s === 'scheduled') return 'upcoming';
    return 'past';
  };
  var q = String(opts.search || '').trim().toLowerCase();
  return items.filter(function (r) {
    if (opts.tab !== 'all' && opts.tab !== 'overdue' && bucket(r.status) !== opts.tab) return false;
    if (opts.manager && (r.supervisor_id || '') !== opts.manager) return false;
    if (opts.branch && (r.branch_id || r.branch_name || '') !== opts.branch) return false;
    if (q) {
      var hay = (String(r.employee_name || '') + ' ' + String(r.employee_nickname || '') + ' ' +
        String(r.supervisor_name || '') + ' ' + String(r.topic || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function oo2OverdueEmployees(items) {
  var byEmp = {};
  items.forEach(function (r) {
    var id = r.employee_id || r.employee_name || '?';
    var dft = oo2DaysFromToday(r.session_date);
    if (!byEmp[id] || dft > byEmp[id]._dft) byEmp[id] = Object.assign({}, r, { _dft: dft });
  });
  return Object.keys(byEmp).map(function (id) { return byEmp[id]; })
    .filter(function (r) { return r._dft <= -30; })
    .sort(function (a, b) { return a._dft - b._dft; })
    .map(function (r) {
      return {
        employee_id: r.employee_id, employee_name: r.employee_name, employee_nickname: r.employee_nickname,
        supervisor_id: r.supervisor_id, branch_name: r.branch_name,
        last_session_date: r.session_date || '—',
        days_since_last: r._dft === 0 ? 0 : -r._dft,
      };
    });
}

var OO_BACKEND = {
  // role gate — dashboard user = admin/owner เต็มสิทธิ์
  oneononeAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },
  // list — { stats, managers, branches, employees, sessions / overdue_employees, mode }
  oneononeAdminList: function (opts) {
    opts = opts || {};
    return oo2FetchAll().then(function (items) {
      var stats = oo2ComputeStats(items);
      var look = oo2Lookups(items);
      var base = {
        stats: stats, managers: look.managers, branches: look.branches, employees: look.employees,
      };
      if (opts.tab === 'overdue') {
        base.mode = 'overdue';
        base.overdue_employees = oo2OverdueEmployees(items);
      } else {
        base.mode = 'sessions';
        base.sessions = oo2ApplyTab(items, opts);
      }
      return base;
    });
  },
  // detail — { session, history }
  oneononeAdminGetDetail: function (sessionId) {
    var find = function (items) { return items.find(function (x) { return x.session_id === String(sessionId); }); };
    var go = function (items) {
      var s = find(items);
      if (!s) return { error: 'ไม่พบ session' };
      var history = items
        .filter(function (x) { return x.employee_id === s.employee_id && x.session_id !== s.session_id && String(x.status).toLowerCase() === 'completed'; })
        .sort(function (a, b) { return String(b.session_date).localeCompare(String(a.session_date)); })
        .slice(0, 5)
        .map(function (x) { return { session_date: x.session_date, topic: x.topic || x.notes || '—', sentiment: x.sentiment || 0 }; });
      return { session: s, history: history };
    };
    if (_oo2Cache) return Promise.resolve(go(_oo2Cache));
    return oo2FetchAll().then(go);
  },
  // propose — backend ไม่มี multi-slot/LINE flex → บันทึก session ตรง (slot แรก) + แจ้ง stub LINE
  oneononeAdminPropose: function (payload) {
    payload = payload || {};
    var slot = (payload.slots && payload.slots[0]) || '';
    var sessionDate = String(slot).slice(0, 10);
    var sessionTime = String(slot).slice(11, 16);
    var body = {
      employee_id: payload.employee_id,
      supervisor_id: payload.supervisor_id,
      session_date: sessionDate,
      session_time: sessionTime,
      mode: payload.mode || 'in_person',
      meeting_link: payload.meeting_link || '',
      topic: payload.agenda || '',
      notes: '', action_items: '', sentiment: 0, next_date: '',
      status: 'proposed',
    };
    return sb.functions.invoke('hr_oneonone', { body: body }).then(function (res) {
      var data = (res && res.data) || {};
      if (data.error || (res && res.error)) return { error: data.error || (res.error && res.error.message) || 'บันทึกไม่สำเร็จ' };
      _oo2Cache = null;
      return {
        session_id: data.session_id || data.id || sessionDate,
        // ไม่มี LINE multicast บน dashboard → แจ้งตรงๆ ว่ายังไม่ได้ส่ง LINE
        notify: { notified: false, reason: 'การส่ง LINE ยังไม่พร้อมบน dashboard — บันทึกนัดแล้ว' },
      };
    });
  },
  // confirm slot — backend ไม่มี endpoint แยก → stub
  oneononeAdminConfirm: function () {
    oo2NotReady('ยืนยัน slot ผ่าน LINE');
    return Promise.resolve({ error: 'ยืนยัน slot ยังไม่พร้อมบน dashboard (พนักงานเลือกผ่าน LINE)' });
  },
  // decline — stub
  oneononeAdminDecline: function () {
    oo2NotReady('ปฏิเสธนัด');
    return Promise.resolve({ error: 'ปฏิเสธนัดยังไม่พร้อมบน dashboard' });
  },
  // mark no-show — stub
  oneononeAdminMarkNoShow: function () {
    oo2NotReady('mark no-show');
    return Promise.resolve({ error: 'mark no-show ยังไม่พร้อมบน dashboard' });
  },
  // complete — บันทึกผล (มี backend จริง)
  oneononeAdminComplete: function (payload) {
    payload = payload || {};
    var s = (_oo2Cache || []).find(function (x) { return x.session_id === String(payload.session_id); }) || {};
    var body = {
      session_id: payload.session_id,
      employee_id: s.employee_id || '',
      supervisor_id: s.supervisor_id || '',
      session_date: s.session_date || '',
      mode: s.mode || 'in_person',
      topic: s.topic || '',
      notes: payload.summary || '',
      action_items: payload.action_items || '',
      decisions: payload.decisions || '',
      sentiment: payload.sentiment || 0,
      next_date: payload.next_date || '',
      status: 'completed',
    };
    return sb.functions.invoke('hr_oneonone', { body: body }).then(function (res) {
      var data = (res && res.data) || {};
      if (data.error || (res && res.error)) return { error: data.error || (res.error && res.error.message) || 'บันทึกไม่สำเร็จ' };
      _oo2Cache = null;
      return { ok: true };
    });
  },
  // EmpCache / nav helpers — stub (ไม่มีใน dashboard scope)
  empCacheList: function () { return Promise.resolve([]); },
  navGetExecUrl: function () { return Promise.resolve(''); },
};

var _oo2NotReadyShown = {};
function oo2NotReady(feature) {
  if (_oo2NotReadyShown[feature]) return;
  _oo2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.oo2Toast) window.oo2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountOneonone — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountOneonone() {
  var wrap = document.getElementById('wrap-oneonone');
  if (!wrap) return;

  var CSS = OO2_CSS();
  var MARKUP = OO2_MARKUP();
  wrap.innerHTML = '<style>' + CSS + '</style><div id="oo">' + MARKUP + '</div>';

  // รัน JS ของหน้าเดิม (closure scope · google = shim) → ผูก fn ที่ inline onclick ต้องใช้ ลง window
  OO2_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles + <style> manager) · prefix ทุก selector ด้วย #oo =====
   ตัด .app-shell/topbar/sidebar/main shell ออก (dashboard มี shell แล้ว) · คง class เดิม */
function OO2_CSS() {
  return [
    // tokens
    '#oo{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#oo *{box-sizing:border-box}',

    // ===== shared buttons / field / pills / modal / empty / loading / section / stats / filters =====
    '#oo .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#oo .btn:hover{border-color:var(--navy)}',
    '#oo .btn svg{width:14px;height:14px}',
    '#oo .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#oo .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#oo .btn-navy{background:var(--navy);color:#fff;border-color:var(--navy)}',
    '#oo .btn-navy:hover{background:#0a2540}',
    '#oo .btn-success{background:var(--success);color:#fff;border-color:var(--success)}',
    '#oo .btn-success:hover{background:#15803D;border-color:#15803D}',
    '#oo .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#oo .btn-sm{padding:5px 10px;font-size:12px}',
    '#oo .btn-icon{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;color:#475569}',
    '#oo .btn-icon-danger{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}',
    '#oo .btn-icon-danger:hover{border-color:var(--danger)}',
    '#oo .btn-help{width:30px;height:30px;padding:0;border:1px solid var(--border-strong);background:var(--surface);border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted);transition:all .15s}',
    '#oo .btn-help:hover{color:var(--info);border-color:var(--info);background:var(--info-bg)}',
    '#oo .btn-help svg{width:16px;height:16px}',
    // field
    '#oo .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}',
    '#oo .field label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#oo .field input[type=text],#oo .field input[type=date],#oo .field input[type=datetime-local],#oo .field input[type=email],#oo .field input[type=search],#oo .field input[type=number],#oo .field select,#oo .field textarea{padding:9px 12px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);transition:border .15s;width:100%}',
    '#oo .field input:focus,#oo .field select:focus,#oo .field textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',
    '#oo .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '#oo .field-help{font-size:11px;color:var(--text-faint);margin-top:2px}',
    // stats
    '#oo .stats{display:grid;gap:10px;margin-bottom:18px}',
    '#oo .stats.cols-5{grid-template-columns:repeat(5,1fr)}',
    '#oo .stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;position:relative;overflow:hidden;transition:border .15s}',
    '#oo .stat:hover{border-color:var(--border-strong)}',
    '#oo .stat-stripe{position:absolute;top:0;left:0;bottom:0;width:3px}',
    '#oo .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}',
    '#oo .stat-value{font-size:26px;font-weight:600;color:var(--text);margin-top:4px;letter-spacing:-.03em;line-height:1}',
    '#oo .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    '@media (max-width:900px){#oo .stats.cols-5{grid-template-columns:repeat(2,1fr)}}',
    // filters
    '#oo .filters{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:14px}',
    '#oo .filter{display:flex;flex-direction:column;gap:4px}',
    '#oo .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#oo .filter select,#oo .filter input[type=search]{height:32px;box-sizing:border-box;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);min-width:160px}',
    '#oo .filter select:focus,#oo .filter input:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',
    // section
    '#oo .section{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03);margin-bottom:12px}',
    '#oo .section-header{padding:12px 18px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}',
    '#oo .section-icon{width:30px;height:30px;border-radius:6px;background:var(--info-bg);color:var(--info);display:flex;align-items:center;justify-content:center}',
    '#oo .section-icon svg{width:16px;height:16px}',
    '#oo .section-title{font-size:13px;font-weight:600;color:var(--text)}',
    '#oo .section-sub{font-size:11px;color:var(--text-muted)}',
    '#oo .section>#content,#oo .section>.section-body{padding:16px 18px}',
    // empty / loading
    '#oo .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#oo .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#oo .empty-icon svg{width:24px;height:24px}',
    '#oo .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#oo .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#oo .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // modal (scope ใต้ #oo · z-index สูง · fixed)
    '#oo .modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;z-index:9000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}',
    '#oo .modal-bg.active{display:flex}',
    '#oo .modal{background:var(--surface);border-radius:12px;padding:0;max-width:540px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);display:flex;flex-direction:column}',
    '#oo .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}',
    '#oo .modal-header h2{font-size:16px;font-weight:600;color:var(--text);letter-spacing:-.01em;margin:0}',
    '#oo .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#oo .modal-body{padding:20px 24px;flex:1;overflow-y:auto}',
    '#oo .modal-footer{padding:14px 24px;border-top:1px solid var(--border);background:#F8FAFC;display:flex;gap:8px;justify-content:flex-end}',
    // ===== page <style> (1:1 Log Manager) · prefix #oo =====
    OO2_PAGE_CSS(),
  ].join('\n');
}

/* page-specific CSS จาก <style> ใน one_on_one_manager.html · prefix #oo · คง class เดิม */
function OO2_PAGE_CSS() {
  return [
    '',
    // Tabs
    '#oo .tabs{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}',
    '#oo .tab{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}',
    '#oo .tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#oo .tab:hover:not(.active){color:var(--text)}',
    '#oo .tab svg{width:13px;height:13px}',
    '#oo .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#oo .tab.active .cnt{background:var(--navy)}',
    '#oo .tab.tab-overdue.active .cnt{background:var(--danger)}',
    // Session cards
    '#oo .session-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}',
    '#oo .sess-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;transition:all .15s;cursor:pointer;border-left:3px solid transparent}',
    '#oo .sess-card:hover{border-color:var(--navy-2)}',
    '#oo .sess-card.st-proposed{border-left-color:var(--info)}',
    '#oo .sess-card.st-confirmed{border-left-color:var(--success)}',
    '#oo .sess-card.st-completed{opacity:.7;border-left-color:var(--text-muted)}',
    '#oo .sess-card.st-no_show{border-left-color:var(--danger);background:#FEF2F2}',
    '#oo .sess-card.st-declined{border-left-color:var(--text-faint);opacity:.6}',
    '#oo .sess-card.is-soon{background:#FFFBEB}',
    '#oo .sess-card.is-today{background:#F0FDF4;border-left-color:var(--success);border-left-width:4px}',
    '#oo .sess-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px}',
    '#oo .sess-pair{display:flex;align-items:center;gap:6px;font-size:13px;flex:1;min-width:0}',
    '#oo .av{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--navy) 0%,var(--navy-2) 100%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}',
    '#oo .av-sup{background:linear-gradient(135deg,var(--teal) 0%,var(--teal-dark) 100%)}',
    '#oo .pair-arrow{color:var(--text-faint);font-size:12px}',
    '#oo .pair-info{min-width:0;flex:1}',
    '#oo .pair-emp{font-weight:600;font-size:13px;color:var(--text)}',
    '#oo .pair-sup{font-size:11px;color:var(--text-muted);margin-top:1px}',
    '#oo .st-pill{display:inline-block;padding:2px 9px;border-radius:12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;flex-shrink:0}',
    '#oo .stp-proposed{background:var(--info-bg);color:var(--info)}',
    '#oo .stp-confirmed{background:var(--success-bg);color:var(--success)}',
    '#oo .stp-scheduled{background:#FEF3C7;color:var(--warning)}',
    '#oo .stp-completed{background:#F1F5F9;color:var(--text-muted)}',
    '#oo .stp-no_show{background:var(--danger-bg);color:var(--danger)}',
    '#oo .stp-declined{background:#F1F5F9;color:var(--text-faint)}',
    '#oo .stp-cancelled{background:#F1F5F9;color:var(--text-faint)}',
    '#oo .sess-when{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#FAFBFC;border-radius:6px;margin-bottom:8px;font-size:12px}',
    '#oo .sess-when svg{width:14px;height:14px;color:var(--text-muted);flex-shrink:0}',
    '#oo .sess-when-date{font-weight:600;color:var(--text)}',
    '#oo .sess-when-time{color:var(--text-muted);margin-left:4px}',
    '#oo .sess-when-rel{margin-left:auto;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600}',
    '#oo .rel-today{background:var(--success-bg);color:var(--success)}',
    '#oo .rel-soon{background:var(--warning-bg);color:var(--warning)}',
    '#oo .rel-future{background:var(--info-bg);color:var(--info)}',
    '#oo .rel-past{background:#F1F5F9;color:var(--text-muted)}',
    '#oo .sess-topic{font-size:12px;color:var(--text-muted);line-height:1.5;padding:6px 0;max-height:36px;overflow:hidden}',
    '#oo .sess-meta-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;font-size:10px}',
    '#oo .meta-tag{padding:2px 7px;border-radius:8px;background:#F1F5F9;color:var(--text-muted);font-weight:500;display:inline-flex;align-items:center;gap:3px}',
    '#oo .meta-tag svg{width:10px;height:10px}',
    '#oo .meta-tag.line-on{background:#DCFCE7;color:#15803D}',
    '#oo .meta-tag.line-off{background:#F1F5F9;color:var(--text-faint)}',
    '#oo .meta-tag.resched{background:var(--warning-bg);color:var(--warning)}',
    '#oo .meta-tag.reminder-sent{background:#E0E7FF;color:#4338CA}',
    // Slot picker
    '#oo .slot-stack{display:flex;flex-direction:column;gap:8px}',
    '#oo .slot-row{display:grid;grid-template-columns:auto 1fr auto auto;gap:8px;align-items:center;padding:8px 10px;background:#F8FAFC;border:1px dashed var(--border-strong);border-radius:6px}',
    '#oo .slot-row input{background:#fff}',
    '#oo .slot-num{width:22px;height:22px;border-radius:50%;background:var(--navy);color:#fff;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center}',
    '#oo .slot-add{width:100%;padding:8px;border:1px dashed var(--border-strong);background:transparent;border-radius:6px;color:var(--text-muted);font-family:inherit;font-size:12px;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:5px}',
    '#oo .slot-add:hover{border-color:var(--navy);color:var(--navy)}',
    '#oo .slot-add svg{width:12px;height:12px}',
    // Mode selector
    '#oo .mode-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}',
    '#oo .mode-btn{padding:10px 8px;border:1px solid var(--border-strong);border-radius:6px;cursor:pointer;text-align:center;font-size:12px;font-weight:500;transition:all .15s;background:#fff;display:flex;flex-direction:column;align-items:center;gap:4px}',
    '#oo .mode-btn svg{width:16px;height:16px;color:var(--text-muted)}',
    '#oo .mode-btn.selected{border-color:var(--navy);background:var(--navy);color:#fff}',
    '#oo .mode-btn.selected svg{color:#fff}',
    // Sentiment selector (1-5 · ไม่มี emoji)
    '#oo .sent-row{display:flex;gap:6px}',
    '#oo .sent-btn{flex:1;padding:8px 4px;border:1px solid var(--border-strong);border-radius:6px;cursor:pointer;background:#fff;text-align:center;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:2px}',
    '#oo .sent-btn .sent-num{font-size:16px;font-weight:600;color:var(--navy);line-height:1}',
    '#oo .sent-btn .sent-lbl{font-size:9px;color:var(--text-muted)}',
    '#oo .sent-btn[data-s="1"].selected{background:#FEE2E2;border-color:#B91C1C}',
    '#oo .sent-btn[data-s="2"].selected{background:#FEF3C7;border-color:#B45309}',
    '#oo .sent-btn[data-s="3"].selected{background:#F1F5F9;border-color:var(--navy)}',
    '#oo .sent-btn[data-s="4"].selected{background:#DBEAFE;border-color:#1D4ED8}',
    '#oo .sent-btn[data-s="5"].selected{background:#D1FAE5;border-color:#047857}',
    '#oo .sent-btn.selected{border-width:2px;padding:7px 3px}',
    '#oo .sent-btn.selected .sent-num{font-size:17px}',
    '#oo .sent-btn:hover:not(.selected){border-color:var(--navy)}',
    // History badge (colored number circle)
    '#oo .history-sent{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:600;color:#fff}',
    '#oo .history-sent[data-s="1"]{background:#B91C1C}',
    '#oo .history-sent[data-s="2"]{background:#B45309}',
    '#oo .history-sent[data-s="3"]{background:var(--navy)}',
    '#oo .history-sent[data-s="4"]{background:#1D4ED8}',
    '#oo .history-sent[data-s="5"]{background:#047857}',
    '#oo .history-sent[data-s="0"]{display:none}',
    // Workflow stepper
    '#oo .wf-stepper{display:flex;align-items:center;gap:4px;margin:10px 0 14px;padding:12px;background:#F8FAFC;border-radius:8px}',
    '#oo .wf-step{flex:1;padding:6px 8px;border-radius:6px;text-align:center;font-size:11px;font-weight:500;background:#fff;color:var(--text-faint)}',
    '#oo .wf-step.done{background:var(--success-bg);color:var(--success);font-weight:600}',
    '#oo .wf-step.active{background:var(--info-bg);color:var(--info);border:1px solid var(--info);font-weight:600}',
    '#oo .wf-step.warn{background:var(--danger-bg);color:var(--danger)}',
    '#oo .wf-arrow{color:var(--text-faint);flex-shrink:0}',
    '#oo .wf-arrow svg{width:11px;height:11px}',
    // History rows
    '#oo .history-row{display:flex;gap:8px;align-items:flex-start;padding:8px;border-bottom:1px solid #F1F5F9;font-size:12px}',
    '#oo .history-row:last-child{border-bottom:0}',
    '#oo .history-date{width:80px;flex-shrink:0;font-family:monospace;color:var(--text-muted);font-size:11px}',
    '#oo .history-topic{flex:1;color:var(--text)}',
    // Overdue list
    '#oo .overdue-list{display:grid;grid-template-columns:1fr;gap:8px}',
    '#oo .overdue-row{display:grid;grid-template-columns:36px 1fr auto auto;gap:12px;align-items:center;padding:10px 14px;background:#FEF2F2;border-left:3px solid var(--danger);border-radius:6px}',
    '#oo .overdue-row.warn{background:#FFFBEB;border-left-color:var(--warning)}',
    '#oo .overdue-name{font-size:13px;font-weight:600;color:var(--text)}',
    '#oo .overdue-meta{font-size:11px;color:var(--text-muted);margin-top:2px}',
    '#oo .overdue-days{font-size:18px;font-weight:600;color:var(--danger);text-align:right;line-height:1}',
    '#oo .overdue-days-sub{font-size:10px;color:var(--text-muted);margin-top:2px}',
  ].join('\n');
}

/* ===== markup เดิม ครบ (header + stats + tabs + filters + section + 2 modals) · คง element id เดิม =====
   ตัด app-shell/topbar/sidebar/sheet_link/brand_footer · _yhMoveActions */
function OO2_MARKUP() {
  return ''
  // header (ลอกจาก topbar เดิม → main-head style ของ dashboard ผ่าน .oo-head)
  + '<div class="oo-head" style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;flex-wrap:wrap">'
  +   '<div>'
  +     '<h1 style="font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px"><span style="width:18px;height:18px;color:var(--teal);display:inline-flex" id="logo-icon"></span>1:1 Log Manager</h1>'
  +     '<div class="subtitle" style="font-size:12px;color:var(--text-muted);margin-top:4px">40_One_on_One_Log — บันทึก + จองนัด + ส่ง LINE auto · บันทึก 1:1 monthly · forced cadence ทุก position</div>'
  +   '</div>'
  +   '<div class="topbar-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
  +     '<button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn"></button>'
  +     '<button class="btn btn-sm" onclick="loadList()" id="refresh-btn"></button>'
  +     '<button class="btn btn-primary" onclick="openPropose()" id="propose-btn"></button>'
  +   '</div>'
  + '</div>'

  // stats
  + '<div class="stats cols-5" id="stats"></div>'

  // tabs
  + '<div class="tabs">'
  +   '<button class="tab active" id="tab-pending" onclick="setTab(\'pending\')"></button>'
  +   '<button class="tab" id="tab-upcoming" onclick="setTab(\'upcoming\')"></button>'
  +   '<button class="tab" id="tab-past" onclick="setTab(\'past\')"></button>'
  +   '<button class="tab tab-overdue" id="tab-overdue" onclick="setTab(\'overdue\')"></button>'
  +   '<button class="tab" id="tab-all" onclick="setTab(\'all\')"></button>'
  + '</div>'

  // filters
  + '<div class="filters" id="filter-bar">'
  +   '<div class="filter"><label>ค้นหา</label><input type="search" id="filter-search" placeholder="ชื่อพนักงาน / หัวหน้า / topic" oninput="loadList()"></div>'
  +   '<div class="filter"><label>หัวหน้า</label><select id="filter-manager" onchange="loadList()"><option value="">ทุกคน</option></select></div>'
  +   '<div class="filter"><label>สาขา</label><select id="filter-branch" onchange="loadList()"><option value="">ทุกสาขา</option></select></div>'
  + '</div>'

  // section
  + '<div class="section">'
  +   '<div class="section-header">'
  +     '<div class="section-icon" id="section-icon"></div>'
  +     '<div style="flex:1">'
  +       '<div class="section-title" id="section-title">รออนุมัติจากพนักงาน</div>'
  +       '<div class="section-sub" id="section-sub">คลิกการ์ดเพื่อดูรายละเอียด + สั่งการ</div>'
  +     '</div>'
  +   '</div>'
  +   '<div id="content" class="loading">กำลังโหลด...</div>'
  + '</div>'

  // Propose modal
  + '<div class="modal-bg" id="prop-bg" onclick="if(event.target===this)closePropose()">'
  +   '<div class="modal" style="max-width:560px">'
  +     '<div class="modal-header"><h2>เสนอนัด 1:1</h2><p>เลือกพนักงาน + เสนอเวลา 1-3 ตัว → ระบบส่ง LINE ให้พนักงานเลือก</p></div>'
  +     '<div class="modal-body">'
  +       '<div class="field-grid">'
  +         '<div class="field"><label>พนักงาน *</label><select id="p-employee" onchange="autofillSupervisor()"></select></div>'
  +         '<div class="field"><label>หัวหน้า *</label><select id="p-supervisor"></select></div>'
  +       '</div>'
  +       '<div class="field"><label>หัวข้อ / agenda</label><textarea id="p-agenda" rows="2" placeholder="ติดตามงาน · ฟีดแบค · ปัญหาที่อยากคุย"></textarea></div>'
  +       '<div class="field"><label>รูปแบบ</label><div class="mode-grid">'
  +         '<div class="mode-btn selected" data-mode="in_person" onclick="selectMode(\'in_person\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>พบเจอกัน</div>'
  +         '<div class="mode-btn" data-mode="video" onclick="selectMode(\'video\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="12" x="2" y="6" rx="2"/><path d="m22 8-6 4 6 4z"/></svg>วิดีโอ</div>'
  +         '<div class="mode-btn" data-mode="phone" onclick="selectMode(\'phone\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>โทรศัพท์</div>'
  +       '</div></div>'
  +       '<div class="field" id="p-link-field" style="display:none"><label>Meeting link</label><input type="text" id="p-link" placeholder="https://meet.google.com/..."></div>'
  +       '<div class="field"><label>เวลาที่เสนอ (1-3 slots)</label><div class="slot-stack" id="slot-stack"></div>'
  +         '<button class="slot-add" onclick="addSlot()" id="slot-add-btn"><span id="slot-add-icon"></span> เพิ่มเวลาทางเลือก</button>'
  +         '<div class="field-help">slot แรก = ตัวแนะนำ · พนักงานจะเห็นปุ่มทั้งหมด เลือกอันที่สะดวก</div>'
  +       '</div>'
  +     '</div>'
  +     '<div class="modal-footer"><button class="btn" onclick="closePropose()">ยกเลิก</button><button class="btn btn-primary" onclick="savePropose()" id="prop-save-btn"></button></div>'
  +   '</div>'
  + '</div>'

  // Detail modal
  + '<div class="modal-bg" id="detail-bg" onclick="if(event.target===this)closeDetail()">'
  +   '<div class="modal" style="max-width:640px">'
  +     '<div class="modal-header"><h2 id="d-title">Session</h2><p id="d-sub">—</p></div>'
  +     '<div class="modal-body">'
  +       '<div class="wf-stepper" id="d-stepper"></div>'
  +       '<div id="d-pair-info" style="margin-bottom:14px"></div>'
  +       '<div id="d-slot-picker" style="margin-bottom:14px;display:none"><label class="field-help" style="font-weight:600;color:var(--text);margin-bottom:6px;display:block">เลือก slot ที่จะ confirm:</label><div id="d-slot-buttons"></div></div>'
  +       '<div class="field"><label>หัวข้อ / agenda</label><textarea id="d-topic" rows="2"></textarea></div>'
  +       '<div id="d-completion" style="display:none">'
  +         '<div class="field"><label>สรุปประเด็นที่คุย</label><textarea id="d-summary" rows="3"></textarea></div>'
  +         '<div class="field"><label>Action items (follow-up tasks)</label><textarea id="d-action-items" rows="2"></textarea></div>'
  +         '<div class="field"><label>Decisions ที่ตัดสินกัน (ถ้ามี)</label><textarea id="d-decisions" rows="2" placeholder="เช่น ปรับเงินเดือน, เปลี่ยน scope งาน, ส่งอบรม..."></textarea></div>'
  +         '<div class="field"><label>พนักงานรู้สึกยังไง? (ไม่บังคับ)</label>'
  +           '<div class="sent-row" id="sent-row">'
  +             '<div class="sent-btn" data-s="1" onclick="selectSent(1)" title="เครียดมาก"><span class="sent-num">1</span><span class="sent-lbl">เครียดมาก</span></div>'
  +             '<div class="sent-btn" data-s="2" onclick="selectSent(2)" title="ไม่ค่อยดี"><span class="sent-num">2</span><span class="sent-lbl">ไม่ค่อยดี</span></div>'
  +             '<div class="sent-btn" data-s="3" onclick="selectSent(3)" title="ปกติ"><span class="sent-num">3</span><span class="sent-lbl">ปกติ</span></div>'
  +             '<div class="sent-btn" data-s="4" onclick="selectSent(4)" title="ดี"><span class="sent-num">4</span><span class="sent-lbl">ดี</span></div>'
  +             '<div class="sent-btn" data-s="5" onclick="selectSent(5)" title="ดีมาก"><span class="sent-num">5</span><span class="sent-lbl">ดีมาก</span></div>'
  +           '</div>'
  +           '<div class="field-help">ไม่กด = ไม่ระบุ (จะไม่เข้า average)</div>'
  +         '</div>'
  +         '<div class="field"><label>นัดครั้งถัดไป (ถ้ามี)</label><input type="date" id="d-next-date"></div>'
  +       '</div>'
  +       '<div id="d-history-block" style="margin-top:14px;display:none"><label class="field-help" style="font-weight:600;color:var(--text);text-transform:uppercase;font-size:11px;letter-spacing:.04em;margin-bottom:6px;display:block">ประวัติ 5 ครั้งล่าสุด</label><div id="d-history" style="background:#FAFBFC;border-radius:6px;padding:4px 8px"></div></div>'
  +     '</div>'
  +     '<div class="modal-footer" style="justify-content:space-between"><div style="display:flex;gap:6px" id="d-left-actions"></div><div style="display:flex;gap:6px" id="d-right-actions"></div></div>'
  +   '</div>'
  + '</div>';
}

/* ============================================================
   OO2_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → OO_BACKEND
   helper จาก _shared_scripts (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function OO2_RUN_PAGE_JS() {

  // ---- google.script.run shim → OO_BACKEND (async, คืน shape เดิม) ----
  function _oo2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (OO_BACKEND[prop]) {
            Promise.resolve().then(function () { return OO_BACKEND[prop].apply(OO_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[OO_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[OO_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _oo2MakeChain(); } });

  // ---- helpers จาก _shared_scripts (inline · scope ปลอดภัย ไม่ชน global) ----
  const ICONS = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('oo2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'oo2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.oo2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('oo-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'oo-help-modal-bg'; bg.className = 'modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const cls = s.type === 'warn' ? 'help-section-warn' : '';
      const items = (s.items || []).map(it => '<li>' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div class="help-section ' + cls + '" style="background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (s.type === 'warn' ? '#B45309' : '#CBD5E1') + '"><div class="help-section-title" style="font-size:11px;font-weight:600;color:' + (s.type === 'warn' ? '#B45309' : '#64748B') + ';text-transform:uppercase;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div class="modal" style="max-width:600px;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div class="modal-header" style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'oo-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div class="modal-body" style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div class="modal-footer" style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'oo-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ============================================================
     ===== JS หน้าเดิม (one_on_one_manager.html) ลอกทั้งดุ้น =====
     ปรับ: document.getElementById → scope #oo (id เดิม คงไว้ครบ)
     ============================================================ */
  const $oo = id => document.getElementById(id);

  let currentTab = 'pending';
  let allData = null;
  let currentDetail = null;
  let proposeSlots = [];   // datetime-local strings
  let proposeMode = 'in_person';
  let detailSentiment = 0;  // 0 = "ไม่ระบุ"

  const HELP = {
    title: '1:1 Log Manager',
    subtitle: 'Sheet: 40_One_on_One_Log',
    intro: 'จองนัด 1:1 + ส่ง LINE auto ให้พนักงาน + log session หลังคุยจบ + alert เมื่อไม่ได้คุยเกิน 30 วัน',
    sections: [
      { title: 'Workflow', items: [
        '<strong>เสนอนัด</strong> → กดปุ่ม "เสนอนัด" → เลือก slots 1-3 ตัว → ระบบส่ง LINE flex',
        '<strong>พนักงานเลือก slot</strong> → กดปุ่มใน LINE → status เป็น confirmed อัตโนมัติ',
        'ระบบเตือน LINE ทั้ง 2 ฝั่ง 1 วันก่อน + 1 ชั่วโมงก่อน',
        '<strong>หลังคุยจบ</strong> → กด "บันทึกผล" → กรอก summary + action items + sentiment',
        'ระบบ trigger Survey 1:1 Feedback ให้พนักงาน',
      ]},
      { title: 'แท็บ', items: [
        '<strong>รออนุมัติ</strong> — เสนอแล้วรอพนักงานเลือก slot',
        '<strong>นัดยืนยัน</strong> — confirmed/scheduled กำลังจะถึง',
        '<strong>ผ่านมาแล้ว</strong> — completed/no_show/declined',
        '<strong>ค้างเกิน 30 วัน</strong> — พนักงานที่ไม่มี 1:1 นาน — ต้องจองด่วน',
      ]},
      { type: 'warn', title: 'ระวัง', items: [
        'บน dashboard นี้: ส่ง LINE / ยืนยัน slot / ปฏิเสธ / no-show เป็นฟีเจอร์ของ LINE OA — ยังไม่พร้อม (จะขึ้นแจ้งเตือน)',
        'บันทึกนัด + บันทึกผล 1:1 ใช้งานได้จริงผ่าน backend',
        'Multi-proposal: ระบบ LINE จริงจะ auto-cancel session อื่นเมื่อ employee confirm slot ใด',
      ]},
    ],
  };

  $oo('logo-icon').innerHTML = ICONS.users;
  $oo('refresh-btn').innerHTML = ICONS.refresh;
  $oo('propose-btn').innerHTML = ICONS.plus + ' เสนอนัด';
  $oo('section-icon').innerHTML = ICONS.users;
  $oo('help-btn').innerHTML = ICONS.help;
  $oo('prop-save-btn').innerHTML = ICONS.bell + ' ส่ง LINE หาพนักงาน';
  $oo('slot-add-icon').innerHTML = ICONS.plus;

  $oo('tab-pending').innerHTML = ICONS.bell + ' รออนุมัติ <span class="cnt" id="cnt-pending">—</span>';
  $oo('tab-upcoming').innerHTML = ICONS.cal + ' นัดยืนยัน <span class="cnt" id="cnt-upcoming">—</span>';
  $oo('tab-past').innerHTML = ICONS.list + ' ผ่านมาแล้ว <span class="cnt" id="cnt-past">—</span>';
  $oo('tab-overdue').innerHTML = ICONS.alert + ' ค้างเกิน 30 วัน <span class="cnt" id="cnt-overdue">—</span>';
  $oo('tab-all').innerHTML = ICONS.list + ' ทั้งหมด';

  const TAB_TITLES = {
    pending: { title: 'รออนุมัติจากพนักงาน', sub: 'เสนอแล้วรอพนักงานเลือก slot ใน LINE' },
    upcoming: { title: 'นัดที่ยืนยันแล้ว', sub: 'จะถึงเร็ว ๆ นี้ — ระบบเตือน LINE 1 วัน + 1 ชม.ก่อน' },
    past: { title: 'ผ่านมาแล้ว', sub: 'completed / no_show / declined' },
    overdue: { title: 'พนักงานค้างเกิน 30 วัน', sub: 'ต้องนัดด่วน — กดปุ่ม "เสนอนัด" ของแต่ละคน' },
    all: { title: 'ทุก session', sub: 'ดูทั้งหมดไม่กรอง' },
  };

  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#oo .tab').forEach(b => b.classList.remove('active'));
    $oo('tab-' + tab).classList.add('active');
    const t = TAB_TITLES[tab];
    $oo('section-title').textContent = t.title;
    $oo('section-sub').textContent = t.sub;
    loadList();
  }

  function loadList() {
    $oo('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    const opts = {
      tab: currentTab,
      search: $oo('filter-search').value || '',
      manager: $oo('filter-manager').value || '',
      branch: $oo('filter-branch').value || '',
    };
    google.script.run
      .withSuccessHandler(d => {
        allData = d;
        renderStats(d.stats || {});
        populateFilters(d);
        if (d.mode === 'overdue') renderOverdue(d.overdue_employees || []);
        else renderSessions(d.sessions || []);
      })
      .withFailureHandler(e => {
        $oo('content').innerHTML =
          '<div class="empty"><div class="empty-title">โหลดไม่สำเร็จ</div>' +
          '<div class="empty-sub">' + escapeHtml(e.message) + '</div></div>';
      })
      .oneononeAdminList(opts);
  }

  function renderStats(s) {
    $oo('cnt-pending').textContent = s.proposed || 0;
    $oo('cnt-upcoming').textContent = s.upcoming || 0;
    $oo('cnt-past').textContent = (s.completed_month || 0) + (s.no_show_month || 0);
    $oo('cnt-overdue').textContent = s.overdue || 0;
    // sidebar badge = จำนวน pending (รออนุมัติ)
    const ct = document.getElementById('ct-oneonone');
    if (ct) ct.textContent = (s.proposed || 0) || '';

    $oo('stats').innerHTML = [
      statCard('รออนุมัติ', s.proposed, 'proposed', 'var(--info)'),
      statCard('ยืนยัน', s.upcoming, 'upcoming', 'var(--success)'),
      statCard('เดือนนี้', s.completed_month, 'completed', 'var(--navy)'),
      statCard('No-show', s.no_show_month, (s.no_show_rate_pct || 0) + '% rate', s.no_show_month > 0 ? 'var(--danger)' : 'var(--text-faint)'),
      statCard('ค้างเกิน 30d', s.overdue, 'employees', s.overdue > 0 ? 'var(--warning)' : 'var(--success)'),
    ].join('');
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  let _filtersDone = false;
  function populateFilters(d) {
    if (_filtersDone) return;
    _filtersDone = true;
    const m = $oo('filter-manager');
    (d.managers || []).forEach(x => {
      m.innerHTML += '<option value="' + escapeAttr(x.id) + '">' + escapeHtml(x.nickname || x.name) + '</option>';
    });
    const b = $oo('filter-branch');
    (d.branches || []).forEach(x => {
      b.innerHTML += '<option value="' + escapeAttr(x.id) + '">' + escapeHtml(x.name) + '</option>';
    });
    // Modal selects
    const pe = $oo('p-employee');
    pe.innerHTML = '<option value="">— เลือกพนักงาน —</option>';
    (d.employees || []).forEach(e => {
      pe.innerHTML += '<option value="' + escapeAttr(e.id) + '" data-sup="' + escapeAttr(e.supervisor_id) + '">' +
        escapeHtml((e.nickname || e.name) + (e.line_linked ? '' : ' (no LINE)')) + '</option>';
    });
    const ps = $oo('p-supervisor');
    ps.innerHTML = '<option value="">— เลือก —</option>';
    (d.managers || []).forEach(x => {
      ps.innerHTML += '<option value="' + escapeAttr(x.id) + '">' + escapeHtml(x.nickname || x.name) + '</option>';
    });
  }

  function renderSessions(sessions) {
    if (!sessions.length) {
      $oo('content').innerHTML =
        '<div class="empty"><div class="empty-icon">' + ICONS.users + '</div>' +
        '<div class="empty-title">ไม่มี session ในแท็บนี้</div>' +
        '<div class="empty-sub">กดปุ่ม "เสนอนัด" หรือเปลี่ยนแท็บ</div></div>';
      return;
    }
    const cards = sessions.map(s => renderCard(s)).join('');
    $oo('content').innerHTML = '<div class="session-grid">' + cards + '</div>';
  }

  function renderCard(s) {
    const cardCls = ['sess-card', 'st-' + s.status];
    if (s.days_from_today === 0) cardCls.push('is-today');
    else if (s.days_from_today > 0 && s.days_from_today <= 1 && s.status !== 'completed') cardCls.push('is-soon');

    const empInitials = (s.employee_nickname || s.employee_name || '?').substring(0, 2);

    let relLabel = '', relCls = '';
    if (s.days_from_today === 0) { relLabel = 'วันนี้'; relCls = 'rel-today'; }
    else if (s.days_from_today === 1) { relLabel = 'พรุ่งนี้'; relCls = 'rel-soon'; }
    else if (s.days_from_today > 0) { relLabel = 'อีก ' + s.days_from_today + ' วัน'; relCls = 'rel-future'; }
    else if (s.days_from_today < 0) { relLabel = (-s.days_from_today) + ' วันก่อน'; relCls = 'rel-past'; }

    const tags = [];
    if (s.employee_line_linked) tags.push('<span class="meta-tag line-on">LINE</span>');
    else tags.push('<span class="meta-tag line-off">no LINE</span>');
    if (s.mode === 'video') tags.push('<span class="meta-tag">video</span>');
    else if (s.mode === 'phone') tags.push('<span class="meta-tag">phone</span>');
    if (s.reschedule_count > 0) tags.push('<span class="meta-tag resched">เลื่อน ' + s.reschedule_count + 'x</span>');
    if (s.reminder_1d_sent) tags.push('<span class="meta-tag reminder-sent">เตือน 1d</span>');
    if (s.reminder_1h_sent) tags.push('<span class="meta-tag reminder-sent">เตือน 1h</span>');

    return [
      '<div class="' + cardCls.join(' ') + '" onclick="openDetail(\'' + escapeAttr(s.session_id) + '\')">',
        '<div class="sess-head">',
          '<div class="sess-pair">',
            '<div class="av">' + escapeHtml(empInitials) + '</div>',
            '<div class="pair-info">',
              '<div class="pair-emp">' + escapeHtml(s.employee_nickname || s.employee_name) + '</div>',
              '<div class="pair-sup">กับ ' + escapeHtml(s.supervisor_name) + (s.branch_name ? ' · ' + escapeHtml(s.branch_name) : '') + '</div>',
            '</div>',
          '</div>',
          '<span class="st-pill stp-' + s.status + '">' + s.status + '</span>',
        '</div>',
        '<div class="sess-when">',
          ICONS.cal,
          '<div>',
            '<span class="sess-when-date">' + escapeHtml(s.session_date || '—') + '</span>',
            (s.session_time ? '<span class="sess-when-time">' + escapeHtml(s.session_time) + '</span>' : ''),
          '</div>',
          (relLabel ? '<span class="sess-when-rel ' + relCls + '">' + relLabel + '</span>' : ''),
        '</div>',
        (s.topic ? '<div class="sess-topic">' + escapeHtml(s.topic) + '</div>' : ''),
        tags.length ? '<div class="sess-meta-row">' + tags.join('') + '</div>' : '',
      '</div>',
    ].join('');
  }

  function renderOverdue(items) {
    if (!items.length) {
      $oo('content').innerHTML =
        '<div class="empty"><div class="empty-icon">' + ICONS.check + '</div>' +
        '<div class="empty-title">ไม่มีพนักงานค้าง</div>' +
        '<div class="empty-sub">ทุกคนได้ 1:1 ภายใน 30 วัน</div></div>';
      return;
    }
    const rows = items.map(it => {
      const cls = it.days_since_last === null || it.days_since_last >= 60 ? '' : 'warn';
      const days = it.days_since_last === null
        ? '<div class="overdue-days">—</div><div class="overdue-days-sub">never</div>'
        : '<div class="overdue-days">' + it.days_since_last + '</div><div class="overdue-days-sub">วัน</div>';
      const av = (it.employee_nickname || it.employee_name || '?').substring(0, 2);
      return [
        '<div class="overdue-row ' + cls + '">',
          '<div class="av">' + escapeHtml(av) + '</div>',
          '<div>',
            '<div class="overdue-name">' + escapeHtml(it.employee_nickname || it.employee_name) + '</div>',
            '<div class="overdue-meta">' + escapeHtml(it.branch_name || '') + ' · ครั้งล่าสุด ' + escapeHtml(it.last_session_date) + '</div>',
          '</div>',
          '<div>' + days + '</div>',
          '<button class="btn btn-sm btn-primary" onclick="proposeFor(\'' + escapeAttr(it.employee_id) + '\', \'' + escapeAttr(it.supervisor_id) + '\')">' + ICONS.plus + ' เสนอนัด</button>',
        '</div>',
      ].join('');
    }).join('');
    $oo('content').innerHTML = '<div class="overdue-list">' + rows + '</div>';
  }

  // ===== Propose modal =====

  function openPropose() {
    $oo('p-employee').value = '';
    $oo('p-supervisor').value = '';
    $oo('p-agenda').value = '';
    $oo('p-link').value = '';
    proposeSlots = [];
    proposeMode = 'in_person';
    selectMode('in_person');
    addSlot();
    $oo('prop-bg').classList.add('active');
  }

  function proposeFor(empId, supId) {
    openPropose();
    $oo('p-employee').value = empId;
    $oo('p-supervisor').value = supId;
  }

  function autofillSupervisor() {
    const sel = $oo('p-employee');
    const opt = sel.options[sel.selectedIndex];
    if (opt) {
      const sup = opt.getAttribute('data-sup');
      if (sup) $oo('p-supervisor').value = sup;
    }
  }

  function selectMode(mode) {
    proposeMode = mode;
    document.querySelectorAll('#oo .mode-btn').forEach(b => {
      b.classList.toggle('selected', b.getAttribute('data-mode') === mode);
    });
    $oo('p-link-field').style.display = mode === 'video' ? '' : 'none';
  }

  function addSlot() {
    if (proposeSlots.length >= 3) {
      showToast('เสนอได้สูงสุด 3 slots', 'error');
      return;
    }
    const idx = proposeSlots.length;
    const d = new Date(); d.setDate(d.getDate() + 1 + idx); d.setHours(14, 0, 0, 0);
    const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    proposeSlots.push(iso);
    renderSlotStack();
  }

  function removeSlot(idx) {
    proposeSlots.splice(idx, 1);
    renderSlotStack();
  }

  function updateSlot(idx, val) {
    proposeSlots[idx] = val;
  }

  function renderSlotStack() {
    const stack = $oo('slot-stack');
    stack.innerHTML = proposeSlots.map((s, i) => [
      '<div class="slot-row">',
        '<div class="slot-num">' + (i + 1) + '</div>',
        '<input type="datetime-local" value="' + escapeAttr(s) + '" onchange="updateSlot(' + i + ', this.value)" style="width:100%">',
        '<button class="btn btn-icon" onclick="setQuickSlot(' + i + ', \'tomorrow\')" title="พรุ่งนี้บ่าย" style="padding:4px 8px;font-size:11px">+1d</button>',
        '<button class="btn btn-icon btn-icon-danger" onclick="removeSlot(' + i + ')" title="ลบ">' + ICONS.trash + '</button>',
      '</div>',
    ].join('')).join('');
    $oo('slot-add-btn').style.display = proposeSlots.length >= 3 ? 'none' : '';
  }

  function setQuickSlot(idx, kind) {
    const d = new Date();
    if (kind === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(14, 0, 0, 0); }
    proposeSlots[idx] = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    renderSlotStack();
  }

  function closePropose() { $oo('prop-bg').classList.remove('active'); }

  function savePropose() {
    const payload = {
      employee_id: $oo('p-employee').value,
      supervisor_id: $oo('p-supervisor').value,
      agenda: $oo('p-agenda').value.trim(),
      mode: proposeMode,
      meeting_link: $oo('p-link').value.trim(),
      slots: proposeSlots.filter(Boolean),
    };
    if (!payload.employee_id) { showToast('เลือกพนักงาน', 'error'); return; }
    if (!payload.supervisor_id) { showToast('เลือกหัวหน้า', 'error'); return; }
    if (!payload.slots.length) { showToast('เพิ่ม slot อย่างน้อย 1', 'error'); return; }

    const btn = $oo('prop-save-btn');
    btn.disabled = true; btn.textContent = '...';
    google.script.run
      .withSuccessHandler(r => {
        btn.disabled = false; btn.innerHTML = ICONS.bell + ' ส่ง LINE หาพนักงาน';
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (r.notify && r.notify.notified === false) {
          showToast('บันทึกนัดแล้ว แต่ยังไม่ได้แจ้งทาง LINE: ' + (r.notify.reason || 'ส่งไม่สำเร็จ'), 'error');
        } else {
          showToast('ส่งคำเชิญทาง LINE แล้ว · ' + r.session_id, 'success');
        }
        closePropose(); loadList();
      })
      .withFailureHandler(e => {
        btn.disabled = false; btn.innerHTML = ICONS.bell + ' ส่ง LINE หาพนักงาน';
        showToast('Error: ' + e.message, 'error');
      })
      .oneononeAdminPropose(payload);
  }

  // ===== Detail modal =====

  function openDetail(sessionId) {
    $oo('detail-bg').classList.add('active');
    $oo('d-title').textContent = 'กำลังโหลด...';
    google.script.run
      .withSuccessHandler(d => {
        if (d && d.error) { showToast(d.error, 'error'); closeDetail(); return; }
        currentDetail = d;
        renderDetail(d);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .oneononeAdminGetDetail(sessionId);
  }

  function renderDetail(d) {
    const s = d.session;
    $oo('d-title').textContent = (s.employee_nickname || s.employee_name) + ' × ' + s.supervisor_name;
    $oo('d-sub').textContent = s.session_date + ' ' + (s.session_time || '') + ' · ' + s.status;

    // Stepper
    const steps = ['proposed', 'confirmed', 'completed'];
    const stepLabels = { proposed: 'เสนอ', confirmed: 'ยืนยัน', completed: 'เสร็จ' };
    let stepIdx = steps.indexOf(s.status === 'scheduled' ? 'confirmed' : s.status);
    if (s.status === 'no_show') stepIdx = -1;
    if (s.status === 'declined' || s.status === 'cancelled') stepIdx = -2;
    const stepHtml = steps.map((st, i) => {
      let cls = 'wf-step';
      if (i < stepIdx) cls += ' done';
      else if (i === stepIdx) cls += ' active';
      if (s.status === 'no_show' && st === 'completed') cls += ' warn';
      return '<div class="' + cls + '">' + stepLabels[st] + '</div>';
    });
    const arrow = '<div class="wf-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></div>';
    let stepperHtml = stepHtml[0] + arrow + stepHtml[1] + arrow + stepHtml[2];
    if (s.status === 'no_show') stepperHtml += arrow + '<div class="wf-step warn">no-show</div>';
    if (s.status === 'declined') stepperHtml = '<div class="wf-step warn" style="flex:1">ปฏิเสธ — ' + escapeHtml(s.decline_reason || '') + '</div>';
    if (s.status === 'cancelled') stepperHtml = '<div class="wf-step warn" style="flex:1">ยกเลิก</div>';
    $oo('d-stepper').innerHTML = stepperHtml;

    // Pair info
    $oo('d-pair-info').innerHTML = [
      '<div style="display:flex;justify-content:space-between;gap:12px">',
        '<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Employee</div>',
          '<div style="font-size:14px;font-weight:600">' + escapeHtml(s.employee_nickname || s.employee_name) + '</div>',
          '<div style="font-size:11px;color:var(--text-muted)">' + escapeHtml(s.branch_name || '') + (s.employee_line_linked ? ' · LINE ✓' : ' · no LINE') + '</div>',
        '</div>',
        '<div style="text-align:right"><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Supervisor</div>',
          '<div style="font-size:14px;font-weight:600">' + escapeHtml(s.supervisor_name) + '</div>',
          '<div style="font-size:11px;color:var(--text-muted)">' + (s.mode === 'video' ? 'video call' : s.mode === 'phone' ? 'phone' : 'in-person') + '</div>',
        '</div>',
      '</div>',
    ].join('');

    // Slot picker (proposed only · backend dashboard มี slot เดียว → ซ่อน)
    if (s.status === 'proposed' && s.alt_slots && s.alt_slots.length > 1) {
      $oo('d-slot-picker').style.display = '';
      $oo('d-slot-buttons').innerHTML =
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
        s.alt_slots.map((slot, idx) =>
          '<button class="btn" onclick="confirmSlot(' + idx + ')">' +
            (idx + 1) + '. ' + escapeHtml(slot.display) + '</button>').join('') +
        '</div>';
    } else {
      $oo('d-slot-picker').style.display = 'none';
    }

    $oo('d-topic').value = s.topic || '';

    // Completion fields visible if confirmed/scheduled
    const showComplete = ['confirmed', 'scheduled'].includes(s.status);
    $oo('d-completion').style.display = showComplete ? '' : 'none';
    if (showComplete) {
      $oo('d-summary').value = '';
      $oo('d-action-items').value = '';
      $oo('d-decisions').value = '';
      $oo('d-next-date').value = '';
      detailSentiment = 0;
      document.querySelectorAll('#oo .sent-btn').forEach(b => b.classList.remove('selected'));
    }

    // History
    if (d.history && d.history.length) {
      $oo('d-history-block').style.display = '';
      $oo('d-history').innerHTML = d.history.map(h => {
        const sv = Number(h.sentiment || 0);
        const sentBadge = sv >= 1 && sv <= 5
          ? '<div class="history-sent" data-s="' + sv + '">' + sv + '</div>'
          : '';
        return '<div class="history-row">' +
          '<div class="history-date">' + escapeHtml(h.session_date) + '</div>' +
          '<div class="history-topic">' + escapeHtml(h.topic) + '</div>' +
          sentBadge + '</div>';
      }).join('');
    } else {
      $oo('d-history-block').style.display = 'none';
    }

    // Action buttons
    renderDetailActions(s);
  }

  function renderDetailActions(s) {
    const left = $oo('d-left-actions');
    const right = $oo('d-right-actions');
    left.innerHTML = '';
    right.innerHTML = '<button class="btn" onclick="closeDetail()">ปิด</button>';

    if (s.status === 'proposed') {
      if (s.alt_slots.length === 1) {
        right.innerHTML += '<button class="btn btn-success" onclick="confirmSlot(0)">' + ICONS.check + ' Confirm</button>';
      }
      left.innerHTML = '<button class="btn btn-icon-danger" onclick="declineSession()">' + ICONS.trash + ' ปฏิเสธ</button>' +
        '<button class="btn" onclick="rescheduleSession()">' + ICONS.refresh + ' เสนอใหม่</button>';
    } else if (s.status === 'confirmed' || s.status === 'scheduled') {
      left.innerHTML = '<button class="btn" onclick="markNoShow()" title="ไม่มา">no-show</button>';
      right.innerHTML += '<button class="btn btn-primary" onclick="completeSession()">' + ICONS.save + ' บันทึกผล</button>';
    } else if (s.status === 'completed') {
      right.innerHTML += '<span style="font-size:11px;color:var(--success);font-weight:500;padding:6px">' + ICONS.check + ' completed</span>';
    }
  }

  function selectSent(n) {
    detailSentiment = (detailSentiment === n) ? 0 : n;
    document.querySelectorAll('#oo .sent-btn').forEach(b => {
      b.classList.toggle('selected', String(detailSentiment) === b.getAttribute('data-s'));
    });
  }

  function confirmSlot(idx) {
    if (!currentDetail) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('Confirmed', 'success');
        openDetail(currentDetail.session.session_id); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .oneononeAdminConfirm({ session_id: currentDetail.session.session_id, slot_idx: idx });
  }

  function declineSession() {
    if (!currentDetail) return;
    const reason = prompt('เหตุผลที่ปฏิเสธ:');
    if (reason === null) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('Declined', 'success'); closeDetail(); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .oneononeAdminDecline(currentDetail.session.session_id, reason);
  }

  function rescheduleSession() {
    if (!currentDetail) return;
    const s = currentDetail.session;
    if (!confirm('เสนอ slots ใหม่สำหรับ session นี้?')) return;

    closeDetail();
    openPropose();
    setTimeout(() => {
      $oo('p-employee').value = s.employee_id;
      $oo('p-supervisor').value = s.supervisor_id;
      $oo('p-agenda').value = s.topic || '';
      selectMode(s.mode || 'in_person');
      if (s.meeting_link) $oo('p-link').value = s.meeting_link;
      showToast('เสนอ slots ใหม่ — session เก่าจะถูก auto-cancel เมื่อ employee confirm slot ใหม่', 'success');
    }, 100);
  }

  function markNoShow() {
    if (!currentDetail) return;
    if (!confirm('Mark เป็น no-show?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('Marked no-show', 'success'); closeDetail(); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .oneononeAdminMarkNoShow(currentDetail.session.session_id);
  }

  function completeSession() {
    if (!currentDetail) return;
    const payload = {
      session_id: currentDetail.session.session_id,
      summary: $oo('d-summary').value.trim() || $oo('d-topic').value.trim(),
      action_items: $oo('d-action-items').value.trim(),
      decisions: $oo('d-decisions').value.trim(),
      sentiment: detailSentiment,
      next_date: $oo('d-next-date').value || '',
    };
    if (!payload.summary) { showToast('กรอกสรุปอย่างน้อย', 'error'); return; }
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('บันทึกแล้ว · trigger feedback survey', 'success');
        closeDetail(); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .oneononeAdminComplete(payload);
  }

  function closeDetail() {
    $oo('detail-bg').classList.remove('active');
    currentDetail = null;
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList, setTab, openPropose, proposeFor, autofillSupervisor,
    selectMode, addSlot, removeSlot, updateSlot, setQuickSlot, closePropose, savePropose,
    openDetail, selectSent, confirmSlot, declineSession, rescheduleSession, markNoShow,
    completeSession, closeDetail,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  setTab('pending');
}
