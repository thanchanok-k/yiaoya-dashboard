// _ported/onboard.js — FULL native port of desktop onboarding_manager.html (HR Announcement admin)
// ลอกทั้งดุ้น: tab(active/overdue/completed/all) + stats(5) + filter(search/branch)
//   + pipeline kanban 5 stage (drag-drop ย้าย stage) + create modal + detail modal (5 sub-tabs:
//     tasks/docs/acks/equipment/buddy) + help modal
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix #ob ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ OB_RUN_PAGE_JS() · google.script.run = shim → OB_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน OB_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=onboarding.updated → {items}) :
//   list   → derive cases/stats/branches/candidates client-side จาก payload ล่าสุดต่อ case
//            (ตอนนี้ list อาจว่าง = 0 case → render ได้ ไม่ error · empty state สวย)
//   whoami → {ok:true, is_owner:true} (dashboard user = admin เต็มสิทธิ์)
//   create/updateTask/updateDoc/markAck/assignEquipment/addEquipment/assignBuddy/
//     updateStatus/resendPreboardingForm → เขียนกลับไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   OB_BACKEND — map google.script.run → Supabase edge fn hr_list (type=onboarding.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (loadList → {cases,stats,branches,candidates}
   getDetail → {case_info,tasks_by_phase,docs,acks,equipment,counts})
   ============================================================ */
var OB_FN = 'hr_list';
var OB_TYPE = 'onboarding.updated';

function ob2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function ob2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function ob2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// map payload event ดิบ → case row shape ที่ JS เดิมใช้ (list view)
function ob2MapCase(p) {
  p = p || {};
  var tasks = ob2ToArr(p.tasks);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var tTotal = (p.tasks_total != null) ? ob2Num(p.tasks_total) : tasks.length;
  var tDone = (p.tasks_done != null) ? ob2Num(p.tasks_done)
    : tasks.filter(function (t) { return String(t.status || '').toLowerCase() === 'done'; }).length;
  var tOverdue = (p.tasks_overdue != null) ? ob2Num(p.tasks_overdue)
    : tasks.filter(function (t) {
        if (String(t.status || '').toLowerCase() === 'done') return false;
        if (!t.due_date) return false;
        var d = new Date(t.due_date); return !isNaN(d.getTime()) && d < today;
      }).length;
  var start = p.start_date ? new Date(p.start_date) : null;
  var daysSince = (start && !isNaN(start.getTime())) ? Math.floor((today - start) / 86400000) : null;
  var pct = (p.progress_pct != null) ? ob2Num(p.progress_pct)
    : (tTotal ? Math.round(tDone / tTotal * 100) : 0);
  return {
    case_id: p.case_id || p.entity_id || '',
    employee_id: p.employee_id || '',
    employee_name: p.employee_name || p.employee_id || '—',
    employee_nickname: p.employee_nickname || '',
    employee_email: p.employee_email || '',
    line_linked: !!p.line_linked,
    branch_id: p.branch_id || '',
    branch_name: p.branch_name || '—',
    status: String(p.status || 'preboarding'),
    start_date: ob2Date(p.start_date),
    days_since_start: (p.days_since_start != null) ? ob2Num(p.days_since_start) : daysSince,
    buddy_id: p.buddy_id || '',
    buddy_name: p.buddy_name || '',
    supervisor_id: p.supervisor_id || '',
    supervisor_name: p.supervisor_name || '',
    progress_pct: pct,
    tasks_total: tTotal,
    tasks_done: tDone,
    tasks_overdue: tOverdue,
    escalation_count: ob2Num(p.escalation_count),
    notes: p.notes || '',
    _raw: p,
  };
}

// cache ของ payload ดิบล่าสุดต่อ case (ให้ getDetail reuse · backend ไม่มี endpoint แยก)
var _ob2Cases = [];
var _ob2Raw = {};

// ดึง items ล่าสุด → dedupe ต่อ case_id (hr_list dedupe ให้แล้ว แต่กันเหนียว)
function ob2FetchCases() {
  return sb.functions.invoke(OB_FN + '?type=' + encodeURIComponent(OB_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = ob2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.case_id || p.entity_id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      _ob2Raw[id] = p;
      rows.push(ob2MapCase(p));
    });
    _ob2Cases = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[OB_BACKEND] list fetch failed', e);
    _ob2Cases = [];
    return [];
  });
}

function ob2AvgProgress(cases) {
  if (!cases.length) return 0;
  var sum = cases.reduce(function (a, c) { return a + (c.progress_pct || 0); }, 0);
  return Math.round(sum / cases.length);
}

var OB_BACKEND = {
  // role gate — dashboard user = admin เต็มสิทธิ์
  onboardingAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },

  // list — { cases, stats, branches, candidates }
  onboardingAdminList: function (opts) {
    opts = opts || {};
    return ob2FetchCases().then(function (all) {
      var tab = opts.tab || 'active';
      var filtered = all.slice();
      if (tab === 'active') filtered = filtered.filter(function (c) { return c.status !== 'completed' && c.status !== 'cancelled'; });
      else if (tab === 'completed') filtered = filtered.filter(function (c) { return c.status === 'completed'; });
      else if (tab === 'overdue') filtered = filtered.filter(function (c) { return c.tasks_overdue > 0 && c.status !== 'completed'; });

      if (opts.branch) filtered = filtered.filter(function (c) { return c.branch_id === opts.branch; });
      if (opts.search) {
        var q = String(opts.search).toLowerCase();
        filtered = filtered.filter(function (c) {
          return (c.employee_name || '').toLowerCase().indexOf(q) >= 0 ||
            (c.employee_nickname || '').toLowerCase().indexOf(q) >= 0 ||
            (c.case_id || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      var statusOrder = ['preboarding', 'preboarding_partial', 'day1', 'week1', 'month1', 'completed', 'cancelled'];
      filtered.sort(function (a, b) {
        var ai = statusOrder.indexOf(a.status), bi = statusOrder.indexOf(b.status);
        if (ai !== bi) return ai - bi;
        return (b.start_date || '').localeCompare(a.start_date || '');
      });

      var stats = {
        total: all.length,
        active: all.filter(function (c) { return c.status !== 'completed' && c.status !== 'cancelled'; }).length,
        completed: all.filter(function (c) { return c.status === 'completed'; }).length,
        overdue: all.filter(function (c) { return c.tasks_overdue > 0 && c.status !== 'completed'; }).length,
        avg_progress: ob2AvgProgress(all.filter(function (c) { return c.status !== 'completed' && c.status !== 'cancelled'; })),
      };

      // branches จาก cases ที่มี (backend ไม่มี master branch list บน dashboard)
      var brSeen = {}; var branches = [];
      all.forEach(function (c) { if (c.branch_id && !brSeen[c.branch_id]) { brSeen[c.branch_id] = true; branches.push({ id: c.branch_id, name: c.branch_name || c.branch_id }); } });

      return { cases: filtered, stats: stats, branches: branches, candidates: [] };
    });
  },

  // detail — { case_info, tasks_by_phase, docs, acks, equipment, counts }
  onboardingAdminGetDetail: function (caseId) {
    var build = function () {
      var p = _ob2Raw[caseId];
      if (!p) return { error: 'ไม่พบ case' };
      var c = ob2MapCase(p);
      var tasks = ob2ToArr(p.tasks);
      var phases = ['preboarding', 'day1', 'week1', 'month1'];
      var byPhase = { preboarding: [], day1: [], week1: [], month1: [] };
      tasks.forEach(function (t) {
        var ph = String(t.phase || 'preboarding');
        if (!byPhase[ph]) ph = 'preboarding';
        byPhase[ph].push({
          task_id: t.task_id || '', sequence: t.sequence != null ? t.sequence : '',
          task_name: t.task_name || t.name || '', owner_role: t.owner_role || '',
          due_date: ob2Date(t.due_date), status: String(t.status || 'pending').toLowerCase(),
          completed_at: ob2Date(t.completed_at), evidence_url: t.evidence_url || '',
        });
      });
      var docs = ob2ToArr(p.docs).map(function (d) {
        return { doc_id: d.doc_id || '', doc_type: d.doc_type || '', required: !!d.required,
          status: String(d.status || 'missing').toLowerCase(), received_date: ob2Date(d.received_date), drive_link: d.drive_link || '' };
      });
      var acks = ob2ToArr(p.acks).map(function (a) {
        return { ack_id: a.ack_id || '', doc_type: a.doc_type || '', signed: !!a.signed,
          signed_at: ob2Date(a.signed_at), signature_url: a.signature_url || '' };
      });
      var equipment = ob2ToArr(p.equipment).map(function (e) {
        return { eq_id: e.eq_id || '', item_type: e.item_type || '', assigned: !!e.assigned,
          serial: e.serial || '', assigned_at: ob2Date(e.assigned_at) };
      });
      var counts = {
        tasks_total: c.tasks_total, tasks_done: c.tasks_done,
        docs_total: docs.length, docs_received: docs.filter(function (d) { return d.status === 'received' || d.status === 'verified'; }).length,
        acks_total: acks.length, acks_signed: acks.filter(function (a) { return a.signed; }).length,
        equipment_total: equipment.length, equipment_assigned: equipment.filter(function (e) { return e.assigned; }).length,
      };
      return {
        case_info: {
          case_id: c.case_id, employee_id: c.employee_id, employee_name: c.employee_name,
          employee_nickname: c.employee_nickname, employee_email: c.employee_email, line_linked: c.line_linked,
          branch_id: c.branch_id, start_date: c.start_date, status: c.status, progress_pct: c.progress_pct,
          buddy_id: c.buddy_id, buddy_name: c.buddy_name, supervisor_id: c.supervisor_id, supervisor_name: c.supervisor_name,
          escalation_count: c.escalation_count, notes: c.notes,
        },
        tasks_by_phase: byPhase, docs: docs, acks: acks, equipment: equipment, counts: counts,
      };
    };
    // ถ้า cache ว่าง (เปิด detail ก่อน list) → fetch ก่อน
    if (_ob2Raw[caseId]) return Promise.resolve(build());
    return ob2FetchCases().then(build);
  },

  // ===== mutations: เขียนกลับไม่ได้บน dashboard → stub + toast =====
  onboardingAdminCreateCase: function () { ob2NotReady('สร้าง onboarding case'); return Promise.resolve({ error: 'สร้าง case ยังไม่พร้อมบน dashboard (read-only)' }); },
  onboardingAdminUpdateTask: function () { ob2NotReady('อัปเดต task'); return Promise.resolve({ error: 'แก้ task ยังไม่พร้อมบน dashboard (read-only)' }); },
  onboardingAdminUpdateDoc: function () { ob2NotReady('อัปเดตเอกสาร'); return Promise.resolve({ error: 'แก้เอกสารยังไม่พร้อมบน dashboard (read-only)' }); },
  onboardingAdminMarkAck: function () { ob2NotReady('เซ็นรับทราบ (ack)'); return Promise.resolve({ error: 'เซ็น ack ยังไม่พร้อมบน dashboard (read-only)' }); },
  onboardingAdminUnmarkAck: function () { ob2NotReady('ยกเลิก ack'); return Promise.resolve({ error: 'ยกเลิก ack ยังไม่พร้อมบน dashboard (read-only)' }); },
  onboardingAdminAssignEquipment: function () { ob2NotReady('จ่ายอุปกรณ์'); return Promise.resolve({ error: 'จ่ายอุปกรณ์ยังไม่พร้อมบน dashboard (read-only)' }); },
  onboardingAdminAddEquipment: function () { ob2NotReady('เพิ่มอุปกรณ์'); return Promise.resolve({ error: 'เพิ่มอุปกรณ์ยังไม่พร้อมบน dashboard (read-only)' }); },
  onboardingAdminAssignBuddy: function () { ob2NotReady('กำหนด buddy'); return Promise.resolve({ error: 'กำหนด buddy ยังไม่พร้อมบน dashboard (read-only)' }); },
  onboardingAdminUpdateStatus: function () { ob2NotReady('เปลี่ยน status / ย้าย stage'); return Promise.resolve({ error: 'เปลี่ยน status ยังไม่พร้อมบน dashboard (read-only)' }); },
  onboardingAdminResendPreboardingForm: function () { ob2NotReady('ส่ง pre-board form (LINE)'); return Promise.resolve({ error: 'ส่งฟอร์มซ้ำยังไม่พร้อมบน dashboard' }); },
};

var _ob2NotReadyShown = {};
function ob2NotReady(feature) {
  if (_ob2NotReadyShown[feature]) return;
  _ob2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ob2Toast) window.ob2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountOnboard — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountOnboard() {
  var wrap = document.getElementById('wrap-onboard');
  if (!wrap) return;
  wrap.innerHTML = '<style>' + OB_CSS() + '</style><div id="ob">' + OB_MARKUP() + '</div>';
  OB_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles base + <style> manager) · prefix ทุก selector ด้วย #ob =====
   ตัด app-shell/topbar/sidebar/main shell ออก (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด */
function OB_CSS() {
  return [
    // tokens (scope #ob)
    '#ob{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#ob *{box-sizing:border-box}',

    // ===== shared base: page-head / stats / filters / buttons / section / field / pill / modal / empty / loading =====
    '#ob .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#ob .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ob .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#ob .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ob .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',

    '#ob .stats{display:grid;gap:10px;margin-bottom:18px}',
    '#ob .stats.cols-5{grid-template-columns:repeat(5,1fr)}',
    '@media (max-width:1100px){#ob .stats.cols-5{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#ob .stats.cols-5{grid-template-columns:repeat(2,1fr)}}',
    '#ob .stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;position:relative;overflow:hidden;transition:border .15s}',
    '#ob .stat:hover{border-color:var(--border-strong)}',
    '#ob .stat-stripe{position:absolute;top:0;left:0;bottom:0;width:3px}',
    '#ob .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}',
    '#ob .stat-value{font-size:26px;font-weight:600;color:var(--navy);margin-top:4px;letter-spacing:-.03em;line-height:1}',
    '#ob .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}',

    '#ob .filters{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:14px}',
    '#ob .filter{display:flex;flex-direction:column;gap:4px}',
    '#ob .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#ob .filter select,#ob .filter input[type=search]{height:32px;box-sizing:border-box;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);min-width:160px}',
    '#ob .filter select{cursor:pointer}',
    '#ob .filter select:focus,#ob .filter input:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',

    '#ob .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#ob .btn:hover{border-color:var(--navy)}',
    '#ob .btn svg{width:14px;height:14px}',
    '#ob .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#ob .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#ob .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#ob .btn-sm{padding:5px 10px;font-size:12px}',
    '#ob .btn-icon{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;color:#475569}',
    '#ob .btn-help{width:30px;height:30px;padding:0;border:1px solid var(--border-strong);background:var(--surface);border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted);transition:all .15s}',
    '#ob .btn-help:hover{color:var(--info);border-color:var(--info);background:var(--info-bg)}',
    '#ob .btn-help svg{width:16px;height:16px}',

    '#ob .section{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03);margin-bottom:12px}',
    '#ob .section-header{padding:12px 18px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}',
    '#ob .section-icon{width:30px;height:30px;border-radius:6px;background:var(--info-bg);color:var(--info);display:flex;align-items:center;justify-content:center}',
    '#ob .section-icon svg{width:16px;height:16px}',
    '#ob .section-title{font-size:13px;font-weight:600;color:var(--text)}',
    '#ob .section-sub{font-size:11px;color:var(--text-muted)}',
    '#ob .section #content{padding:14px 18px}',

    '#ob .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}',
    '#ob .field label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#ob .field input[type=text],#ob .field select,#ob .field textarea{padding:9px 12px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);transition:border .15s;width:100%}',
    '#ob .field input:focus,#ob .field select:focus,#ob .field textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',
    '#ob .field-help{font-size:11px;color:var(--text-faint);margin-top:2px}',

    '#ob .pill{padding:2px 9px;border-radius:12px;font-size:10px;font-weight:600}',
    '#ob .pill-danger{background:var(--danger-bg);color:var(--danger)}',
    '#ob .pill-success{background:var(--success-bg);color:var(--success)}',

    '#ob .modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;z-index:9000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}',
    '#ob .modal-bg.active{display:flex}',
    '#ob .modal{background:var(--surface);border-radius:12px;padding:0;max-width:540px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);display:flex;flex-direction:column}',
    '#ob .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}',
    '#ob .modal-header h2{font-size:16px;font-weight:600;color:var(--text);letter-spacing:-.01em}',
    '#ob .modal-header p{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ob .modal-body{padding:20px 24px;flex:1;overflow-y:auto}',
    '#ob .modal-footer{padding:14px 24px;border-top:1px solid var(--border);background:#F8FAFC;display:flex;gap:8px;justify-content:flex-end}',

    '#ob .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#ob .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#ob .empty-icon svg{width:24px;height:24px}',
    '#ob .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#ob .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#ob .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',

    // help modal sections
    '#ob .help-section{background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid var(--border-strong)}',
    '#ob .help-section-warn{background:var(--warning-bg);border-left-color:var(--warning)}',
    '#ob .help-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}',
  ].join('\n') + OB_CSS2();
}

/* CSS part 2 — tabs / pipeline / case card / detail modal / sub-tabs / item rows (จาก <style> หน้า manager) */
function OB_CSS2() {
  return '\n' + [
    // Tabs
    '#ob .tabs{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}',
    '#ob .tab{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}',
    '#ob .tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#ob .tab svg{width:13px;height:13px}',
    '#ob .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#ob .tab.active .cnt{background:var(--navy)}',
    '#ob .tab.tab-overdue.active .cnt{background:var(--danger)}',
    // Pipeline (kanban)
    '#ob .pipeline{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;min-height:400px}',
    '@media (max-width:1100px){#ob .pipeline{grid-template-columns:repeat(2,1fr)}}',
    '#ob .col-header{padding:10px 12px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}',
    '#ob .col-pre{background:#DBEAFE;color:#1E40AF}',
    '#ob .col-day1{background:#FEF3C7;color:#B45309}',
    '#ob .col-week1{background:#FCE7F3;color:#BE185D}',
    '#ob .col-month1{background:#E0E7FF;color:#4338CA}',
    '#ob .col-completed{background:#DCFCE7;color:#166534}',
    '#ob .col-count{padding:1px 7px;border-radius:10px;background:rgba(255,255,255,.7);font-size:10px}',
    '#ob .col-body{padding:8px;background:#F8FAFC;border-radius:0 0 8px 8px;border:.5px solid var(--border);border-top:0;max-height:600px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;transition:background .15s}',
    '#ob .col-body.drag-over{background:#E6F7F5;outline:2px dashed #3DC5B7;outline-offset:-2px}',
    // Case card
    '#ob .case-card{background:#fff;border:.5px solid var(--border);border-radius:6px;padding:10px 12px;cursor:grab;transition:all .15s;border-left:3px solid transparent}',
    '#ob .case-card:hover{border-color:var(--navy-2)}',
    '#ob .case-card.has-overdue{border-left-color:var(--danger);background:#FEF2F2}',
    '#ob .case-card.is-new{border-left-color:var(--info)}',
    '#ob .case-card.dragging{opacity:.4;cursor:grabbing}',
    '#ob .case-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
    '#ob .av-mini{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--navy) 0%,var(--navy-2) 100%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}',
    '#ob .case-name{font-weight:600;font-size:12px;flex:1}',
    '#ob .case-meta{font-size:10px;color:var(--text-faint);margin-bottom:6px}',
    '#ob .case-progress{display:flex;align-items:center;gap:6px;font-size:10px}',
    '#ob .case-progress-bar{flex:1;height:4px;background:#F1F5F9;border-radius:2px;overflow:hidden}',
    '#ob .case-progress-fill{height:100%;background:var(--success);transition:width .3s}',
    '#ob .case-progress-fill.low{background:var(--warning)}',
    '#ob .case-progress-pct{font-weight:600;min-width:30px;text-align:right}',
    '#ob .case-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;font-size:9px}',
    '#ob .case-tag{padding:1px 6px;border-radius:4px;background:#F1F5F9;color:var(--text-muted);font-weight:500}',
    '#ob .case-tag.line{background:#DCFCE7;color:#15803D}',
    '#ob .case-tag.no-line{color:var(--text-faint)}',
    '#ob .case-tag.overdue{background:var(--danger-bg);color:var(--danger)}',
    '#ob .case-tag.buddy{background:#E0E7FF;color:#4338CA}',
    // Detail modal
    '#ob .modal.large{max-width:900px}',
    '#ob .case-summary{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;padding:14px;background:#F8FAFC;border-radius:8px;margin-bottom:14px}',
    '@media (max-width:700px){#ob .case-summary{grid-template-columns:1fr 1fr}}',
    '#ob .summary-cell .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}',
    '#ob .summary-cell .v{font-size:13px;font-weight:500;color:var(--text);margin-top:2px}',
    // Sub-tabs
    '#ob .sub-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:14px;flex-wrap:wrap}',
    '#ob .sub-tab{padding:8px 14px;border:0;background:transparent;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;border-bottom:2px solid transparent;display:inline-flex;align-items:center;gap:6px}',
    '#ob .sub-tab.active{color:var(--text);border-bottom-color:var(--navy);font-weight:600}',
    '#ob .sub-tab svg{width:13px;height:13px}',
    '#ob .sub-tab .cnt{font-size:9px;padding:1px 6px;border-radius:8px;background:#F1F5F9}',
    '#ob .sub-tab.active .cnt{background:var(--navy);color:#fff}',
    // Phase headers
    '#ob .phase-header{font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;padding:8px 12px;background:#F8FAFC;border-radius:4px;margin:12px 0 6px;display:flex;justify-content:space-between}',
    '#ob .phase-header:first-child{margin-top:0}',
    // Item rows
    '#ob .item-row{display:grid;grid-template-columns:24px 1fr auto auto;gap:10px;align-items:center;padding:9px 12px;border:.5px solid var(--border);border-radius:6px;margin-bottom:4px;background:#fff;font-size:12px}',
    '#ob .item-row.done{background:#F0FDF4;border-color:#BBF7D0}',
    '#ob .item-row.overdue{background:#FEF2F2;border-color:#FCA5A5}',
    '#ob .checkbox{width:18px;height:18px;border-radius:3px;border:1.5px solid var(--border-strong);background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '#ob .checkbox.checked{background:var(--success);border-color:var(--success);color:#fff}',
    '#ob .checkbox.checked svg{width:11px;height:11px;display:block}',
    '#ob .checkbox svg{display:none}',
    '#ob .item-name{font-size:12px;color:var(--text)}',
    '#ob .item-name.done{text-decoration:line-through;color:var(--text-muted)}',
    '#ob .item-meta{display:block;font-size:10px;color:var(--text-faint);margin-top:2px}',
    '#ob .status-pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}',
    '#ob .sp-pending{background:#F1F5F9;color:var(--text-muted)}',
    '#ob .sp-done{background:#DCFCE7;color:#15803D}',
    '#ob .sp-missing{background:var(--danger-bg);color:var(--danger)}',
    '#ob .sp-received{background:#DBEAFE;color:#1E40AF}',
    '#ob .sp-verified{background:#DCFCE7;color:#15803D}',
    '#ob .url-link{color:var(--info);font-size:11px}',
    '#ob .url-link:hover{text-decoration:underline}',
    '#ob .add-row{display:grid;grid-template-columns:1fr auto;gap:6px;padding:8px 12px;background:#FAFBFC;border:1px dashed var(--border-strong);border-radius:6px;margin-top:6px}',
    '#ob .add-row input{padding:4px 8px;font-size:11px;border:.5px solid var(--border-strong);border-radius:4px}',
    '#ob .empty-tab{padding:40px 20px;text-align:center;color:var(--text-muted);font-size:12px}',
  ].join('\n');
}

/* ===== markup เดิม ครบ (header / stats / tabs / filters / section / 2 modals) · คง element id เดิม =====
   ตัด app-shell / _sidebar / _sheet_link / _brand_footer · header เดิม (page-head) คงไว้ */
function OB_MARKUP() {
  return [
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
    '      Onboarding Cases',
    '    </h1>',
    '    <div class="subtitle">31 + 31a-31e — pipeline 5 stages × 23 tasks × 7 docs × 4 acks × equipment</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn" data-tip="คู่มือการใช้หน้านี้"></button>',
    '    <button class="btn btn-sm" onclick="loadList()" id="refresh-btn"></button>',
    '    <button class="btn btn-primary" onclick="openCreate()" id="new-btn"></button>',
    '  </div>',
    '</header>',
    '',
    '<div class="stats cols-5" id="stats"></div>',
    '',
    '<div class="tabs">',
    '  <button class="tab active" id="tab-active" onclick="setTab(\'active\')"></button>',
    '  <button class="tab tab-overdue" id="tab-overdue" onclick="setTab(\'overdue\')"></button>',
    '  <button class="tab" id="tab-completed" onclick="setTab(\'completed\')"></button>',
    '  <button class="tab" id="tab-all" onclick="setTab(\'all\')"></button>',
    '</div>',
    '',
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ค้นหา</label>',
    '    <input type="search" id="filter-search" placeholder="ชื่อ / nickname / case_id" oninput="loadList()">',
    '  </div>',
    '  <div class="filter">',
    '    <label>สาขา</label>',
    '    <select id="filter-branch" onchange="loadList()">',
    '      <option value="">ทุกสาขา</option>',
    '    </select>',
    '  </div>',
    '</div>',
    '',
    '<div class="section">',
    '  <div class="section-header">',
    '    <div class="section-icon" id="section-icon"></div>',
    '    <div style="flex:1">',
    '      <div class="section-title" id="section-title">Active cases — pipeline view</div>',
    '      <div class="section-sub">คลิก case → ดู 5 sub-tabs (tasks / docs / acks / equipment / buddy)</div>',
    '    </div>',
    '  </div>',
    '  <div id="content" class="loading">กำลังโหลด...</div>',
    '</div>',
    '',
    // Create case modal
    '<div class="modal-bg" id="create-bg" onclick="if(event.target===this)closeCreate()">',
    '  <div class="modal" style="max-width:480px">',
    '    <div class="modal-header">',
    '      <h2>สร้าง onboarding case</h2>',
    '      <p>ระบบจะ clone 23 tasks + 7 docs + 4 acks + equipment ให้อัตโนมัติ</p>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="field">',
    '        <label>เลือกพนักงานที่จะรับเข้า *</label>',
    '        <select id="c-employee"></select>',
    '        <div class="field-help">แสดงเฉพาะพนักงานที่ยังไม่มี active case</div>',
    '      </div>',
    '      <div class="field">',
    '        <label>Buddy (ถ้ามี)</label>',
    '        <select id="c-buddy">',
    '          <option value="">— ยังไม่กำหนด —</option>',
    '        </select>',
    '        <div class="field-help">หัวหน้าจับคู่ buddy ภายหลังก็ได้</div>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeCreate()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveCreate()" id="c-save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
    '',
    // Detail modal
    '<div class="modal-bg" id="detail-bg" onclick="if(event.target===this)closeDetail()">',
    '  <div class="modal large">',
    '    <div class="modal-header">',
    '      <h2 id="d-title">กำลังโหลด...</h2>',
    '      <p id="d-sub">—</p>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="case-summary" id="d-summary"></div>',
    '      <div class="sub-tabs">',
    '        <button class="sub-tab active" id="st-tasks" onclick="setSubTab(\'tasks\')"></button>',
    '        <button class="sub-tab" id="st-docs" onclick="setSubTab(\'docs\')"></button>',
    '        <button class="sub-tab" id="st-acks" onclick="setSubTab(\'acks\')"></button>',
    '        <button class="sub-tab" id="st-equipment" onclick="setSubTab(\'equipment\')"></button>',
    '        <button class="sub-tab" id="st-buddy" onclick="setSubTab(\'buddy\')"></button>',
    '      </div>',
    '      <div id="sub-content"></div>',
    '    </div>',
    '    <div class="modal-footer" style="justify-content:space-between">',
    '      <div style="display:flex;gap:6px">',
    '        <button class="btn" onclick="resendForm()">ส่ง pre-board form ใหม่</button>',
    '      </div>',
    '      <div style="display:flex;gap:6px">',
    '        <select id="d-status-select" onchange="changeStatus()" style="padding:6px 10px;border:.5px solid var(--border-strong);border-radius:6px;font-size:12px">',
    '          <option value="preboarding">preboarding</option>',
    '          <option value="day1">day1</option>',
    '          <option value="week1">week1</option>',
    '          <option value="month1">month1</option>',
    '          <option value="completed">completed</option>',
    '          <option value="cancelled">cancelled</option>',
    '        </select>',
    '        <button class="btn" onclick="closeDetail()">ปิด</button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   OB_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → OB_BACKEND
   helper จาก _shared_scripts (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function OB_RUN_PAGE_JS() {

  // ---- google.script.run shim → OB_BACKEND (async, คืน shape เดิม) ----
  function _ob2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (OB_BACKEND[prop]) {
            Promise.resolve().then(function () { return OB_BACKEND[prop].apply(OB_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[OB_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[OB_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ob2MakeChain(); } });

  // ---- helpers จาก _shared_scripts (inline · prefix ob ใน id เพื่อกันชน) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('ob2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ob2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ob2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('ob-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'ob-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'ob-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'ob-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ===================== JS หน้าเดิม (onboarding_manager.html) — ลอกทั้งดุ้น ===================== */
  let currentTab = 'active';
  let currentSubTab = 'tasks';
  let allData = null;
  let currentDetail = null;
  let allEmployees = [];

  const HELP = {
    title: 'Onboarding Cases',
    subtitle: 'Sheets: 31 + 31a-31e',
    intro: 'จัดการ onboarding ของพนักงานใหม่ — 5 phases × 23 tasks + checklists',
    sections: [
      { title: 'Pipeline 5 stages', items: [
        '<strong>preboarding</strong> — D-3 to D-1: รับเอกสาร, ลงทะเบียน, สร้าง email, จับคู่ buddy',
        '<strong>day1</strong> — วันแรก: ต้อนรับ, brief PDPA, ติด LINE OA',
        '<strong>week1</strong> — สัปดาห์แรก: เริ่มเทรนนิ่ง, daily check-in, end-of-week 1:1',
        '<strong>month1</strong> — เดือนแรก: weekly 1:1, Day 30 probation review',
        '<strong>completed</strong> — ผ่านโปร 30 วัน',
      ] },
      { title: 'Detail modal — 5 sub-tabs', items: [
        '<strong>Tasks</strong> 23 ข้อ group by phase — กดเช็คเสร็จ + ใส่ evidence URL',
        '<strong>Docs</strong> 7 ฉบับ (ID/ทะเบียน/วุฒิ/รูป/ใบรับรองแพทย์/บัญชี/รับรองงานเดิม) — track received/verified',
        '<strong>Acks</strong> 4 ตัว (rules, benefits, PDPA, NDA) — sign off',
        '<strong>Equipment</strong> — uniform, badge, notebook, locker key — assign + serial',
        '<strong>Buddy</strong> — กำหนด buddy + dump buddy survey link',
      ] },
      { type: 'warn', title: 'ระวัง (dashboard read-only)', items: [
        'หน้านี้บน dashboard = read-only — ดูข้อมูลได้ แต่สร้าง/แก้ task/ย้าย stage ยังเขียนกลับไม่ได้',
        'สร้าง case → engine clone task ทันที (ทำที่ระบบ HR เดิม)',
        'Status auto-advance เมื่อ progress = 100% → completed',
        'Cancelled case ลบไม่ได้ — ใช้ status=cancelled แทน',
      ] },
    ],
  };

  // ===== static icons / labels =====
  document.getElementById('refresh-btn').innerHTML = ICONS.refresh;
  document.getElementById('section-icon').innerHTML = ICONS.user;
  document.getElementById('help-btn').innerHTML = ICONS.help;
  document.getElementById('new-btn').innerHTML = ICONS.plus + ' รับพนักงานใหม่';
  document.getElementById('c-save-btn').innerHTML = ICONS.save + ' สร้าง';

  document.getElementById('tab-active').innerHTML = ICONS.user + ' Active <span class="cnt" id="cnt-active">—</span>';
  document.getElementById('tab-overdue').innerHTML = ICONS.alert + ' Overdue <span class="cnt" id="cnt-overdue">—</span>';
  document.getElementById('tab-completed').innerHTML = ICONS.check + ' Completed <span class="cnt" id="cnt-completed">—</span>';
  document.getElementById('tab-all').innerHTML = ICONS.list + ' ทั้งหมด';

  document.getElementById('st-tasks').innerHTML = ICONS.list + ' Tasks <span class="cnt" id="cnt-tasks">—</span>';
  document.getElementById('st-docs').innerHTML = ICONS.doc + ' Docs <span class="cnt" id="cnt-docs">—</span>';
  document.getElementById('st-acks').innerHTML = ICONS.check + ' Acks <span class="cnt" id="cnt-acks">—</span>';
  document.getElementById('st-equipment').innerHTML = ICONS.briefcase + ' Equipment <span class="cnt" id="cnt-equipment">—</span>';
  document.getElementById('st-buddy').innerHTML = ICONS.users + ' Buddy';

  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#ob .tab').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    loadList();
  }

  function loadList() {
    document.getElementById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    const opts = {
      tab: currentTab,
      search: document.getElementById('filter-search').value || '',
      branch: document.getElementById('filter-branch').value || '',
    };
    google.script.run
      .withSuccessHandler(d => {
        allData = d;
        renderStats(d.stats || {});
        populateFilters(d);
        renderPipeline(d.cases || [], d.stats || {});
      })
      .withFailureHandler(e => {
        document.getElementById('content').innerHTML =
          '<div class="empty"><div class="empty-icon">' + ICONS.alert + '</div><div class="empty-title">โหลดไม่สำเร็จ</div>' +
          '<div class="empty-sub">' + escapeHtml(e && e.message ? e.message : e) + '</div></div>';
      })
      .onboardingAdminList(opts);
  }

  function renderStats(s) {
    document.getElementById('cnt-active').textContent = s.active || 0;
    document.getElementById('cnt-overdue').textContent = s.overdue || 0;
    document.getElementById('cnt-completed').textContent = s.completed || 0;

    document.getElementById('stats').innerHTML = [
      statCard('ทั้งหมด', s.total, 'cases', 'var(--navy)'),
      statCard('Active', s.active, 'กำลังดำเนินการ', 'var(--info)'),
      statCard('Overdue', s.overdue, 'มี task ค้าง', s.overdue > 0 ? 'var(--danger)' : 'var(--success)'),
      statCard('Avg progress', (s.avg_progress || 0) + '%', 'active cases', s.avg_progress >= 70 ? 'var(--success)' : 'var(--warning)'),
      statCard('Completed', s.completed, 'ผ่านโปรแล้ว', 'var(--success)'),
    ].join('');
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value == null ? 0 : value) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  let _filtersDone = false;
  function populateFilters(d) {
    if (_filtersDone) return;
    _filtersDone = true;
    const b = document.getElementById('filter-branch');
    (d.branches || []).forEach(x => {
      b.innerHTML += '<option value="' + escapeAttr(x.id) + '">' + escapeHtml(x.name) + '</option>';
    });
    const emp = document.getElementById('c-employee');
    emp.innerHTML = '<option value="">— เลือก —</option>';
    (d.candidates || []).forEach(e => {
      const start = e.start_date ? ' · เริ่ม ' + e.start_date : '';
      emp.innerHTML += '<option value="' + escapeAttr(e.id) + '">' +
        escapeHtml((e.nickname || e.name) + start) + '</option>';
    });
    allEmployees = (d.candidates || []).slice();
    const buddySel = document.getElementById('c-buddy');
    buddySel.innerHTML = '<option value="">— ยังไม่กำหนด —</option>';
    (d.candidates || []).forEach(e => {
      buddySel.innerHTML += '<option value="' + escapeAttr(e.id) + '">' +
        escapeHtml(e.nickname || e.name) + '</option>';
    });
  }

  function renderPipeline(cases, stats) {
    if (currentTab === 'active' || currentTab === 'all') {
      if (!cases.length) {
        document.getElementById('content').innerHTML =
          '<div class="empty"><div class="empty-icon">' + ICONS.user + '</div>' +
          '<div class="empty-title">ยังไม่มี onboarding case</div>' +
          '<div class="empty-sub">เมื่อมีพนักงานใหม่เข้าระบบ case จะแสดงเป็น pipeline 5 stage ที่นี่</div></div>';
        return;
      }
      const byStatus = { preboarding: [], day1: [], week1: [], month1: [], completed: [] };
      cases.forEach(c => {
        const k = (c.status === 'preboarding_partial') ? 'preboarding' :
                  (c.status === 'cancelled') ? null : c.status;
        if (k && byStatus[k]) byStatus[k].push(c);
      });
      const cols = [
        { key: 'preboarding', name: 'Preboarding', cls: 'col-pre' },
        { key: 'day1', name: 'Day 1', cls: 'col-day1' },
        { key: 'week1', name: 'Week 1', cls: 'col-week1' },
        { key: 'month1', name: 'Month 1', cls: 'col-month1' },
        { key: 'completed', name: 'Completed', cls: 'col-completed' },
      ];
      document.getElementById('content').innerHTML =
        '<div class="pipeline">' +
        cols.map(col => {
          const items = byStatus[col.key] || [];
          const cards = items.length === 0
            ? '<div style="padding:14px;text-align:center;color:var(--text-faint);font-size:11px">ว่าง</div>'
            : items.map(renderCaseCard).join('');
          return '<div>' +
            '<div class="col-header ' + col.cls + '">' +
              '<span>' + col.name + '</span>' +
              '<span class="col-count">' + items.length + '</span>' +
            '</div>' +
            '<div class="col-body" data-status="' + col.key + '" ondragover="obDragOver(event)" ondragleave="obDragLeave(event)" ondrop="obDrop(event)">' + cards + '</div>' +
          '</div>';
        }).join('') +
        '</div>';
    } else {
      if (!cases.length) {
        document.getElementById('content').innerHTML =
          '<div class="empty"><div class="empty-icon">' + ICONS.user + '</div>' +
          '<div class="empty-title">ไม่มี case</div>' +
          '<div class="empty-sub">ไม่มี case ในแท็บนี้</div></div>';
        return;
      }
      document.getElementById('content').innerHTML =
        '<div style="display:flex;flex-direction:column;gap:8px">' +
        cases.map(renderCaseCard).join('') +
        '</div>';
    }
  }

  function renderCaseCard(c) {
    const initials = (c.employee_nickname || c.employee_name).substring(0, 2);
    const overdue = c.tasks_overdue > 0;
    const isNew = c.days_since_start !== null && c.days_since_start <= 1;
    const cls = ['case-card', overdue ? 'has-overdue' : '', isNew ? 'is-new' : ''].filter(Boolean).join(' ');
    const pctCls = c.progress_pct >= 70 ? '' : 'low';

    const tags = [];
    if (c.line_linked) tags.push('<span class="case-tag line">LINE</span>');
    else tags.push('<span class="case-tag no-line">no LINE</span>');
    if (c.tasks_overdue > 0) tags.push('<span class="case-tag overdue">' + c.tasks_overdue + ' ค้าง</span>');
    if (c.buddy_name) tags.push('<span class="case-tag buddy">buddy: ' + escapeHtml(c.buddy_name) + '</span>');

    return '<div class="' + cls + '" draggable="true" data-case="' + escapeAttr(c.case_id) + '" data-status="' + escapeAttr(c.status) + '"' +
      ' ondragstart="obDragStart(event)" ondragend="obDragEnd(event)"' +
      ' onclick="openDetail(\'' + escapeAttr(c.case_id) + '\')">' +
      '<div class="case-head">' +
        '<div class="av-mini">' + escapeHtml(initials) + '</div>' +
        '<div class="case-name">' + escapeHtml(c.employee_nickname || c.employee_name) + '</div>' +
      '</div>' +
      '<div class="case-meta">' + escapeHtml(c.branch_name) + ' · เริ่ม ' + escapeHtml(c.start_date || '—') + '</div>' +
      '<div class="case-progress">' +
        '<div class="case-progress-bar"><div class="case-progress-fill ' + pctCls + '" style="width:' + c.progress_pct + '%"></div></div>' +
        '<span class="case-progress-pct">' + c.progress_pct + '%</span>' +
      '</div>' +
      '<div style="font-size:10px;color:var(--text-muted);margin-top:4px">' +
        c.tasks_done + '/' + c.tasks_total + ' tasks done' +
      '</div>' +
      (tags.length ? '<div class="case-tags">' + tags.join('') + '</div>' : '') +
    '</div>';
  }

  // ===== Create =====
  function openCreate() {
    document.getElementById('c-employee').value = '';
    document.getElementById('c-buddy').value = '';
    document.getElementById('create-bg').classList.add('active');
  }
  function closeCreate() { document.getElementById('create-bg').classList.remove('active'); }

  function saveCreate() {
    const empId = document.getElementById('c-employee').value;
    const buddyId = document.getElementById('c-buddy').value;
    if (!empId) { showToast('เลือกพนักงาน', 'error'); return; }
    const btn = document.getElementById('c-save-btn');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(r => {
        btn.disabled = false; btn.innerHTML = ICONS.save + ' สร้าง';
        if (r && r.error) { showToast(r.error, 'error'); return; }
        const warns = (r.warnings && r.warnings.length) ? ' (warnings: ' + r.warnings.length + ')' : '';
        showToast('สร้าง ' + r.case_id + warns, 'success');
        closeCreate(); loadList();
      })
      .withFailureHandler(e => { btn.disabled = false; btn.innerHTML = ICONS.save + ' สร้าง'; showToast('Error: ' + e.message, 'error'); })
      .onboardingAdminCreateCase(empId, { buddy_id: buddyId });
  }

  // ===== Detail =====
  function openDetail(caseId) {
    document.getElementById('detail-bg').classList.add('active');
    document.getElementById('d-title').textContent = 'กำลังโหลด...';
    document.getElementById('sub-content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(d => {
        if (d && d.error) { showToast(d.error, 'error'); closeDetail(); return; }
        currentDetail = d;
        renderDetail(d);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminGetDetail(caseId);
  }

  function renderDetail(d) {
    const c = d.case_info;
    document.getElementById('d-title').textContent = (c.employee_nickname || c.employee_name) + ' · ' + c.case_id;
    document.getElementById('d-sub').textContent = 'เริ่ม ' + c.start_date + ' · ' + c.progress_pct + '% · ' + c.status;

    document.getElementById('d-summary').innerHTML = [
      summaryCell('Status', c.status),
      summaryCell('Progress', c.progress_pct + '%'),
      summaryCell('Buddy', c.buddy_name || '—'),
      summaryCell('Supervisor', c.supervisor_name || '—'),
    ].join('');

    document.getElementById('d-status-select').value = c.status;

    document.getElementById('cnt-tasks').textContent = d.counts.tasks_done + '/' + d.counts.tasks_total;
    document.getElementById('cnt-docs').textContent = d.counts.docs_received + '/' + d.counts.docs_total;
    document.getElementById('cnt-acks').textContent = d.counts.acks_signed + '/' + d.counts.acks_total;
    document.getElementById('cnt-equipment').textContent = d.counts.equipment_assigned + '/' + d.counts.equipment_total;

    setSubTab(currentSubTab);
  }

  function summaryCell(label, value) {
    return '<div class="summary-cell"><div class="l">' + label + '</div><div class="v">' + escapeHtml(value || '—') + '</div></div>';
  }

  /* drag-drop kanban · ย้าย case ระหว่าง stage */
  let _obDragCase = null;
  let _obDragFrom = null;
  function obDragStart(ev) {
    const card = ev.target.closest('.case-card');
    if (!card) return;
    _obDragCase = card.getAttribute('data-case');
    _obDragFrom = card.getAttribute('data-status');
    card.classList.add('dragging');
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', _obDragCase); } catch (e) {}
  }
  function obDragEnd(ev) {
    const card = ev.target.closest('.case-card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('#ob .col-body.drag-over').forEach(c => c.classList.remove('drag-over'));
  }
  function obDragOver(ev) {
    if (!_obDragCase) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    const col = ev.currentTarget;
    if (col) col.classList.add('drag-over');
  }
  function obDragLeave(ev) {
    const col = ev.currentTarget;
    if (col) col.classList.remove('drag-over');
  }
  function obDrop(ev) {
    ev.preventDefault();
    const col = ev.currentTarget;
    if (col) col.classList.remove('drag-over');
    if (!_obDragCase) return;
    const toStatus = col.getAttribute('data-status');
    if (!toStatus || toStatus === _obDragFrom) { _obDragCase = null; return; }
    if (toStatus === 'completed' && !confirm('ย้าย case ไป Completed · ปิดเคส (irreversible) ยืนยัน?')) {
      _obDragCase = null; return;
    }
    const caseId = _obDragCase;
    _obDragCase = null;
    _obDragFrom = null;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); loadList(); return; }
        showToast('ย้ายไป ' + toStatus + ' แล้ว', 'success');
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminUpdateStatus(caseId, toStatus);
  }

  function setSubTab(name) {
    currentSubTab = name;
    document.querySelectorAll('#ob .sub-tab').forEach(b => b.classList.remove('active'));
    document.getElementById('st-' + name).classList.add('active');
    if (!currentDetail) return;
    const sub = document.getElementById('sub-content');

    if (name === 'tasks') {
      const phases = ['preboarding', 'day1', 'week1', 'month1'];
      const phaseNames = { preboarding: 'Preboarding (D-3 to D-1)', day1: 'Day 1', week1: 'Week 1', month1: 'Month 1' };
      const html = phases.map(p => {
        const items = (currentDetail.tasks_by_phase[p] || []);
        if (!items.length) return '';
        const done = items.filter(t => t.status === 'done').length;
        return '<div class="phase-header"><span>' + phaseNames[p] + '</span><span>' + done + '/' + items.length + ' done</span></div>' +
          items.map(t => renderTaskRow(t)).join('');
      }).join('');
      sub.innerHTML = html || '<div class="empty-tab">ยังไม่มี task ในเคสนี้</div>';
    } else if (name === 'docs') {
      sub.innerHTML = currentDetail.docs.length
        ? currentDetail.docs.map(renderDocRow).join('')
        : '<div class="empty-tab">ไม่มี doc requirement</div>';
    } else if (name === 'acks') {
      sub.innerHTML = currentDetail.acks.length
        ? currentDetail.acks.map(renderAckRow).join('')
        : '<div class="empty-tab">ไม่มี ack requirement</div>';
    } else if (name === 'equipment') {
      sub.innerHTML = (currentDetail.equipment.length
        ? currentDetail.equipment.map(renderEqRow).join('')
        : '<div class="empty-tab">ไม่มี equipment</div>') +
        '<div class="add-row">' +
          '<input type="text" id="new-eq-input" placeholder="เพิ่มอุปกรณ์... (เช่น stethoscope)">' +
          '<button class="btn btn-sm btn-primary" onclick="addEquipment()">' + ICONS.plus + '</button>' +
        '</div>';
    } else if (name === 'buddy') {
      const c = currentDetail.case_info;
      sub.innerHTML = '<div style="padding:14px;background:#F8FAFC;border-radius:8px">' +
        '<div style="font-size:13px;font-weight:500;margin-bottom:10px">Buddy ปัจจุบัน: <strong>' +
          escapeHtml(c.buddy_name || 'ยังไม่กำหนด') + '</strong></div>' +
        '<div class="field">' +
          '<label>เปลี่ยน buddy</label>' +
          '<select id="buddy-select" style="width:100%;padding:7px 10px;border:.5px solid var(--border-strong);border-radius:6px"></select>' +
          '<div class="field-help">เลือกพนักงาน senior ที่จะดูแล</div>' +
        '</div>' +
        '<button class="btn btn-primary" onclick="saveBuddy()">' + ICONS.save + ' กำหนด buddy</button>' +
      '</div>';
      const sel = document.getElementById('buddy-select');
      sel.innerHTML = '<option value="">— เลือก —</option>';
      (allEmployees || []).forEach(e => {
        if (e.id === c.employee_id) return;
        sel.innerHTML += '<option value="' + escapeAttr(e.id) + '"' + (e.id === c.buddy_id ? ' selected' : '') + '>' +
          escapeHtml(e.nickname || e.name) + '</option>';
      });
    }
  }

  function renderTaskRow(t) {
    const isDone = t.status === 'done';
    const cls = ['item-row', isDone ? 'done' : ''].filter(Boolean).join(' ');
    const checkCls = isDone ? 'checkbox checked' : 'checkbox';
    return '<div class="' + cls + '">' +
      '<div class="' + checkCls + '" onclick="toggleTask(\'' + escapeAttr(t.task_id) + '\', ' + (isDone ? 'false' : 'true') + ')">' +
        ICONS.check +
      '</div>' +
      '<div>' +
        '<div class="item-name ' + (isDone ? 'done' : '') + '"><strong>#' + t.sequence + '</strong> ' + escapeHtml(t.task_name) + '</div>' +
        '<div class="item-meta">' + escapeHtml(t.owner_role) + (t.due_date ? ' · due ' + escapeHtml(t.due_date) : '') +
          (isDone && t.completed_at ? ' · เสร็จ ' + escapeHtml(t.completed_at) : '') + '</div>' +
      '</div>' +
      '<div>' +
        (t.evidence_url
          ? '<a href="' + escapeAttr(t.evidence_url) + '" target="_blank" class="url-link">evidence</a>'
          : '<button class="btn btn-icon btn-sm" onclick="setEvidence(\'' + escapeAttr(t.task_id) + '\')" title="แนบ URL">' + ICONS.doc + '</button>') +
      '</div>' +
      '<div></div>' +
    '</div>';
  }

  function renderDocRow(d) {
    const cls = ['item-row', (d.status === 'verified' || d.status === 'received') ? 'done' : ''].filter(Boolean).join(' ');
    return '<div class="' + cls + '">' +
      '<div></div>' +
      '<div>' +
        '<div class="item-name">' + escapeHtml(d.doc_type) + (d.required ? ' *' : '') + '</div>' +
        (d.received_date ? '<div class="item-meta">รับ ' + escapeHtml(d.received_date) + '</div>' : '') +
      '</div>' +
      '<div>' +
        (d.drive_link
          ? '<a href="' + escapeAttr(d.drive_link) + '" target="_blank" class="url-link">file</a>'
          : '<button class="btn btn-icon btn-sm" onclick="setDocUrl(\'' + escapeAttr(d.doc_id) + '\')" title="ใส่ Drive URL">' + ICONS.doc + '</button>') +
      '</div>' +
      '<select class="status-pill sp-' + d.status + '" style="border:0;cursor:pointer" onchange="setDocStatus(\'' + escapeAttr(d.doc_id) + '\', this.value)">' +
        ['missing', 'received', 'verified'].map(s =>
          '<option value="' + s + '"' + (s === d.status ? ' selected' : '') + '>' + s + '</option>').join('') +
      '</select>' +
    '</div>';
  }

  function renderAckRow(a) {
    const cls = ['item-row', a.signed ? 'done' : ''].filter(Boolean).join(' ');
    const checkCls = a.signed ? 'checkbox checked' : 'checkbox';
    return '<div class="' + cls + '">' +
      '<div class="' + checkCls + '" onclick="toggleAck(\'' + escapeAttr(a.ack_id) + '\', ' + (a.signed ? 'false' : 'true') + ')">' +
        ICONS.check +
      '</div>' +
      '<div>' +
        '<div class="item-name ' + (a.signed ? 'done' : '') + '">' + escapeHtml(a.doc_type.toUpperCase()) + '</div>' +
        (a.signed_at ? '<div class="item-meta">เซ็น ' + escapeHtml(a.signed_at) + '</div>' : '') +
      '</div>' +
      '<div>' +
        (a.signature_url ? '<a href="' + escapeAttr(a.signature_url) + '" target="_blank" class="url-link">signature</a>' : '') +
      '</div>' +
      '<div></div>' +
    '</div>';
  }

  function renderEqRow(e) {
    const cls = ['item-row', e.assigned ? 'done' : ''].filter(Boolean).join(' ');
    return '<div class="' + cls + '">' +
      '<div></div>' +
      '<div>' +
        '<div class="item-name">' + escapeHtml(e.item_type) + '</div>' +
        (e.serial ? '<div class="item-meta">SN: ' + escapeHtml(e.serial) + (e.assigned_at ? ' · ' + escapeHtml(e.assigned_at) : '') + '</div>' : '') +
      '</div>' +
      '<div>' +
        (e.assigned
          ? '<span class="status-pill sp-done">assigned</span>'
          : '<button class="btn btn-sm" onclick="assignEq(\'' + escapeAttr(e.eq_id) + '\')">Assign</button>') +
      '</div>' +
      '<div></div>' +
    '</div>';
  }

  // ===== Mutations =====
  function toggleTask(taskId, makeDone) {
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (currentDetail) openDetail(currentDetail.case_info.case_id);
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminUpdateTask(taskId, makeDone ? 'done' : 'pending', null);
  }

  function setEvidence(taskId) {
    const url = prompt('Drive URL หรือ link ของหลักฐาน:');
    if (!url) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (currentDetail) openDetail(currentDetail.case_info.case_id);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminUpdateTask(taskId, 'done', url.trim());
  }

  function setDocStatus(docId, status) {
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (currentDetail) openDetail(currentDetail.case_info.case_id);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminUpdateDoc(docId, status, null);
  }

  function setDocUrl(docId) {
    const url = prompt('Drive URL ของเอกสาร:');
    if (!url) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (currentDetail) openDetail(currentDetail.case_info.case_id);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminUpdateDoc(docId, 'received', url.trim());
  }

  function toggleAck(ackId, makeSigned) {
    const fn = makeSigned ? 'onboardingAdminMarkAck' : 'onboardingAdminUnmarkAck';
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (currentDetail) openDetail(currentDetail.case_info.case_id);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))[fn](ackId, '');
  }

  function assignEq(eqId) {
    const sn = prompt('Serial number (ถ้ามี):') || '';
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (currentDetail) openDetail(currentDetail.case_info.case_id);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminAssignEquipment(eqId, sn, 'good');
  }

  function addEquipment() {
    const itemType = (document.getElementById('new-eq-input').value || '').trim();
    if (!itemType) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (currentDetail) openDetail(currentDetail.case_info.case_id);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminAddEquipment(currentDetail.case_info.case_id, itemType);
  }

  function saveBuddy() {
    const buddyId = document.getElementById('buddy-select').value;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('กำหนด buddy แล้ว', 'success');
        if (currentDetail) openDetail(currentDetail.case_info.case_id);
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminAssignBuddy(currentDetail.case_info.case_id, buddyId);
  }

  function changeStatus() {
    const newStatus = document.getElementById('d-status-select').value;
    if (!currentDetail) return;
    if (!confirm('เปลี่ยน status เป็น "' + newStatus + '"?')) {
      document.getElementById('d-status-select').value = currentDetail.case_info.status;
      return;
    }
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); document.getElementById('d-status-select').value = currentDetail.case_info.status; return; }
        showToast('เปลี่ยนสถานะแล้ว', 'success');
        if (currentDetail) openDetail(currentDetail.case_info.case_id);
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminUpdateStatus(currentDetail.case_info.case_id, newStatus);
  }

  function resendForm() {
    if (!currentDetail) return;
    if (!confirm('ส่ง pre-boarding form (LINE flex) ใหม่หา ' + currentDetail.case_info.employee_name + '?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('ส่งแล้ว', 'success');
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .onboardingAdminResendPreboardingForm(currentDetail.case_info.case_id);
  }

  function closeDetail() {
    document.getElementById('detail-bg').classList.remove('active');
    currentDetail = null;
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList, setTab, openCreate, closeCreate, saveCreate,
    openDetail, closeDetail, setSubTab, changeStatus, resendForm,
    toggleTask, setEvidence, setDocStatus, setDocUrl, toggleAck, assignEq, addEquipment, saveBuddy,
    obDragStart, obDragEnd, obDragOver, obDragLeave, obDrop,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  setTab('active');
}
