// _ported/offboard.js — FULL native port of desktop offboarding_manager.html (HR Announcement admin)
// ลอกทั้งดุ้น: stats(5) + tabs(active/urgent/closed/all) + filter(search/branch)
//   + pipeline 6 phases (notice/last_week/last_day/next_day/post_exit/closed) + case card
//   + create modal + detail modal (7 sub-tabs: tasks/revoke/returns/payout/docs/survey/kt)
//   + help modal · upload letter · send LINE return · recalc payout ฯลฯ
//   CSS เดิม (_shared_styles base + <style> หน้า manager) prefix #ofb ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ OFB_RUN_PAGE_JS() · google.script.run = shim → OFB_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน OFB_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=offboarding.updated → {items}) :
//   list   → derive items/stats/branches client-side จาก payload ล่าสุดต่อ case (11 case จริงใน hub)
//   whoami → {ok:true, is_owner:true} (dashboard user = admin เต็มสิทธิ์)
//   detail → case_info จาก payload + sub-arrays (tasks/revoke/returns/payout/docs/survey/kt)
//            hub sync เฉพาะ tab 32 (case) → sub-arrays ว่าง = empty state สวย ไม่ error
//   ⚠️ Final Payout sensitive — โชว์เฉพาะถ้ามีใน payload เท่านั้น (ปกติไม่มี → "ยังไม่มี payout")
//   create / toggleTask / revoke / addReturn / payout / docs / survey / kt / status / close
//     / upload letter / send LINE → เขียนกลับไม่ได้บน dashboard → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   OFB_BACKEND — map google.script.run → Supabase edge fn hr_list (type=offboarding.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (loadList → {items,stats,branches}
   getDetail → {case_info, tasks_by_phase, tasks_count, revoke, revoke_count,
                returns, open_loans, payout, docs, survey, kt})
   ============================================================ */
var OFB_FN = 'hr_list';
var OFB_TYPE = 'offboarding.updated';

function ofb2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function ofb2Num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function ofb2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function ofb2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// map payload event ดิบ → case row shape ที่ JS เดิมใช้ (list view)
function ofb2MapCase(p) {
  p = p || {};
  var tasks = ofb2ToArr(p.tasks);
  var revoke = ofb2ToArr(p.revoke);
  var today = new Date(); today.setHours(0, 0, 0, 0);

  var tTotal = (p.tasks_total != null) ? ofb2Num(p.tasks_total) : tasks.length;
  var tDone = (p.tasks_done != null) ? ofb2Num(p.tasks_done)
    : tasks.filter(function (t) { return String(t.status || '').toLowerCase() === 'done'; }).length;
  var tOverdue = (p.tasks_overdue != null) ? ofb2Num(p.tasks_overdue)
    : tasks.filter(function (t) {
        if (String(t.status || '').toLowerCase() === 'done') return false;
        if (!t.due_date) return false;
        var d = new Date(t.due_date); return !isNaN(d.getTime()) && d < today;
      }).length;
  var rTotal = (p.revoke_total != null) ? ofb2Num(p.revoke_total) : revoke.length;
  var rRevoked = (p.revoke_revoked != null) ? ofb2Num(p.revoke_revoked)
    : revoke.filter(function (r) { var s = String(r.status || '').toLowerCase(); return s === 'revoked' || s === 'na'; }).length;

  var lastDay = p.last_day ? new Date(p.last_day) : null;
  var daysUntil = (p.days_until_last_day != null) ? ofb2Num(p.days_until_last_day)
    : (lastDay && !isNaN(lastDay.getTime()) ? Math.floor((lastDay - today) / 86400000) : null);
  var pct = (p.task_progress != null) ? ofb2Num(p.task_progress)
    : (tTotal ? Math.round(tDone / tTotal * 100) : 0);

  return {
    case_id: p.case_id || p.entity_id || p.id || '',
    employee_id: p.employee_id || '',
    employee_name: p.employee_name || ((String(p.first_name || '') + ' ' + String(p.last_name || '')).trim()) || p.employee_id || '—',
    employee_nickname: p.employee_nickname || p.nickname || '',
    line_linked: !!(p.line_linked || p.line_user_id),
    branch_id: p.branch_id || p.primary_branch_id || '',
    branch_name: p.branch_name || '—',
    status: String(p.status || 'notice'),
    last_day: ofb2Date(p.last_day),
    notice_date: ofb2Date(p.notice_date),
    days_until_last_day: daysUntil,
    resignation_type: p.resignation_type || 'voluntary',
    replacement_needed: ofb2Bool(p.replacement_needed),
    severance_amount: ofb2Num(p.severance_amount),
    final_pay_amount: ofb2Num(p.final_pay_amount),
    tasks_total: tTotal,
    tasks_done: tDone,
    tasks_overdue: tOverdue,
    task_progress: pct,
    revoke_total: rTotal,
    revoke_revoked: rRevoked,
    resignation_letter_url: p.resignation_letter_url || '',
    closed_at: ofb2Date(p.closed_at),
    notes: p.notes || '',
    _raw: p,
  };
}

// cache ของ payload ดิบล่าสุดต่อ case (ให้ getDetail reuse · hub ไม่มี endpoint แยก)
var _ofb2Cases = [];
var _ofb2Raw = {};

// ดึง items ล่าสุด → dedupe ต่อ case_id (hr_list dedupe ให้แล้ว แต่กันเหนียว)
function ofb2FetchCases() {
  return sb.functions.invoke(OFB_FN + '?type=' + encodeURIComponent(OFB_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = ofb2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.case_id || p.entity_id || p.id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      _ofb2Raw[id] = p;
      rows.push(ofb2MapCase(p));
    });
    _ofb2Cases = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[OFB_BACKEND] list fetch failed', e);
    _ofb2Cases = [];
    return [];
  });
}

function ofb2Avg(cases, key) {
  var arr = cases.filter(function (c) { return c.status !== 'closed' && c.status !== 'cancelled'; });
  if (!arr.length) return 0;
  var sum = arr.reduce(function (a, c) { return a + (c[key] || 0); }, 0);
  return Math.round(sum / arr.length);
}

var OFB_BACKEND = {
  // role gate — dashboard user = admin เต็มสิทธิ์
  offboardingAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },

  // list — { items, stats, branches }
  offboardingAdminList: function (opts) {
    opts = opts || {};
    return ofb2FetchCases().then(function (all) {
      var tab = opts.tab || 'active';
      var filtered = all.slice();
      if (tab === 'active') filtered = filtered.filter(function (c) { return c.status !== 'closed' && c.status !== 'cancelled'; });
      else if (tab === 'closed') filtered = filtered.filter(function (c) { return c.status === 'closed'; });
      else if (tab === 'urgent') filtered = filtered.filter(function (c) {
        return c.status !== 'closed' && c.status !== 'cancelled' &&
          (c.tasks_overdue > 0 || (c.days_until_last_day !== null && c.days_until_last_day <= 7));
      });
      // tab === 'all' → ไม่กรอง

      if (opts.branch) filtered = filtered.filter(function (c) { return c.branch_id === opts.branch; });
      if (opts.search) {
        var q = String(opts.search).toLowerCase();
        filtered = filtered.filter(function (c) {
          return (c.employee_name || '').toLowerCase().indexOf(q) >= 0 ||
            (c.employee_nickname || '').toLowerCase().indexOf(q) >= 0 ||
            (c.case_id || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      var statusOrder = ['notice', 'last_week', 'last_day', 'next_day', 'post_exit', 'closed', 'cancelled'];
      filtered.sort(function (a, b) {
        var ai = statusOrder.indexOf(a.status), bi = statusOrder.indexOf(b.status);
        if (ai !== bi) return ai - bi;
        return (a.last_day || '').localeCompare(b.last_day || '');
      });

      var stats = {
        total: all.length,
        active: all.filter(function (c) { return c.status !== 'closed' && c.status !== 'cancelled'; }).length,
        closed: all.filter(function (c) { return c.status === 'closed'; }).length,
        urgent: all.filter(function (c) {
          return c.status !== 'closed' && c.status !== 'cancelled' &&
            (c.tasks_overdue > 0 || (c.days_until_last_day !== null && c.days_until_last_day <= 7));
        }).length,
        avg_task_progress: ofb2Avg(all, 'task_progress'),
        total_severance: all.filter(function (c) { return c.status === 'closed'; }).reduce(function (a, c) { return a + c.severance_amount; }, 0),
      };

      // branches จาก cases ที่มี (hub ไม่มี master branch list บน dashboard)
      var brSeen = {}; var branches = [];
      all.forEach(function (c) { if (c.branch_id && !brSeen[c.branch_id]) { brSeen[c.branch_id] = true; branches.push({ id: c.branch_id, name: c.branch_name || c.branch_id }); } });

      return { items: filtered, stats: stats, branches: branches };
    });
  },

  // active employees (สำหรับ create modal + KT receiver) — hub ไม่มี resolver บน dashboard → ว่าง
  offboardingActiveEmployees: function () {
    return Promise.resolve([]);
  },

  // detail — { case_info, tasks_by_phase, tasks_count, revoke, revoke_count, returns, open_loans, payout, docs, survey, kt }
  offboardingAdminDetail: function (caseId) {
    var build = function () {
      var p = _ofb2Raw[caseId];
      if (!p) return { error: 'ไม่พบ case' };
      var c = ofb2MapCase(p);

      // tasks_by_phase (จาก payload ถ้ามี · sub-array hub ไม่ sync → ว่าง)
      var tasks = ofb2ToArr(p.tasks).map(function (t) {
        return {
          task_id: t.task_id || '', phase: t.phase || 'other',
          sequence: ofb2Num(t.sequence), task_name: t.task_name || t.name || '',
          owner_role: t.owner_role || '', due_date: ofb2Date(t.due_date),
          status: String(t.status || 'pending').toLowerCase(),
          completed_at: ofb2Date(t.completed_at), evidence_url: t.evidence_url || '',
          is_legal_compliance: ofb2Bool(t.is_legal_compliance),
        };
      }).sort(function (a, b) { return a.sequence - b.sequence; });
      var tasksByPhase = {};
      tasks.forEach(function (t) {
        var ph = t.phase || 'other';
        if (!tasksByPhase[ph]) tasksByPhase[ph] = [];
        tasksByPhase[ph].push(t);
      });

      var revoke = ofb2ToArr(p.revoke).map(function (r) {
        return {
          revoke_id: r.revoke_id || '', system_name: r.system_name || '',
          criticality: r.criticality || 'medium', owner_role: r.owner_role || '',
          status: String(r.status || 'pending').toLowerCase(),
          revoked_by: r.revoked_by || '', revoked_at: ofb2Date(r.revoked_at),
          evidence_url: r.evidence_url || '',
        };
      });

      var returns = ofb2ToArr(p.returns).map(function (r) {
        return {
          return_id: r.return_id || '', item_type: r.item_type || '', item_name: r.item_name || '',
          condition: r.condition || '', returned_at: ofb2Date(r.returned_at),
          deduction_amount: ofb2Num(r.deduction_amount), evidence_url: r.evidence_url || '', notes: r.notes || '',
        };
      });

      var openLoans = ofb2ToArr(p.open_loans).map(function (l) {
        return {
          loan_id: l.loan_id || '', item_type: l.item_type || '', item_name: l.item_name || '',
          serial: l.serial || '', lent_at: ofb2Date(l.lent_at), expected_return: ofb2Date(l.expected_return),
          return_request_at: ofb2Date(l.return_request_at), status: String(l.status || 'active').toLowerCase(),
        };
      });

      // ⚠️ Final Payout sensitive — โชว์เฉพาะถ้ามีใน payload (ปกติ hub ไม่ sync → null → empty state)
      var pay = p.payout;
      var payoutData = pay ? {
        payout_id: pay.payout_id || '',
        working_days_remaining: ofb2Num(pay.working_days_remaining),
        ot_pending: ofb2Num(pay.ot_pending),
        leave_unused_payout: ofb2Num(pay.leave_unused_payout),
        severance_law: ofb2Num(pay.severance_law),
        commission_pending: ofb2Num(pay.commission_pending),
        deductions: ofb2Num(pay.deductions),
        total_net: ofb2Num(pay.total_net),
        payment_date: ofb2Date(pay.payment_date),
        payslip_url: pay.payslip_url || '',
      } : null;

      var docs = ofb2ToArr(p.docs).map(function (d) {
        return {
          doc_id: d.doc_id || '', doc_type: d.doc_type || '', drive_url: d.drive_url || '',
          issued_at: ofb2Date(d.issued_at), signed_by_employee_at: ofb2Date(d.signed_by_employee_at), notes: d.notes || '',
        };
      });

      var sv = p.survey;
      var surveyData = sv ? {
        survey_id: sv.survey_id || '', rating: ofb2Num(sv.rating),
        comment: sv.comment || '', submitted_at: ofb2Date(sv.submitted_at),
      } : null;

      var kt = ofb2ToArr(p.kt).map(function (k) {
        return {
          kt_id: k.kt_id || '', topic: k.topic || '', receiver_id: k.receiver_id || '',
          receiver_name: k.receiver_name || '', status: String(k.status || 'planned').toLowerCase(),
          sop_url: k.sop_url || '', signed_off_at: ofb2Date(k.signed_off_at), notes: k.notes || '',
        };
      });

      return {
        case_info: {
          case_id: c.case_id, employee_id: c.employee_id, employee_name: c.employee_name,
          employee_nickname: c.employee_nickname, line_linked: c.line_linked,
          branch_id: c.branch_id, branch_name: c.branch_name, status: c.status,
          last_day: c.last_day, notice_date: c.notice_date, days_until_last_day: c.days_until_last_day,
          resignation_type: c.resignation_type, replacement_needed: c.replacement_needed,
          severance_amount: c.severance_amount, final_pay_amount: c.final_pay_amount,
          closed_at: c.closed_at, notes: c.notes, resignation_letter_url: c.resignation_letter_url,
        },
        tasks_by_phase: tasksByPhase,
        tasks_count: { total: tasks.length, done: tasks.filter(function (t) { return t.status === 'done'; }).length },
        revoke: revoke,
        revoke_count: { total: revoke.length, revoked: revoke.filter(function (r) { return r.status === 'revoked' || r.status === 'na'; }).length },
        returns: returns,
        open_loans: openLoans,
        payout: payoutData,
        docs: docs,
        survey: surveyData,
        kt: kt,
      };
    };
    if (_ofb2Raw[caseId]) return Promise.resolve(build());
    return ofb2FetchCases().then(build);
  },

  // ===== mutations: เขียนกลับไม่ได้บน dashboard → stub + toast =====
  offboardingAdminCreate: function () { ofb2NotReady('เปิด offboarding case'); return Promise.resolve({ error: 'เปิดเคสยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminUpdateTask: function () { ofb2NotReady('อัปเดต task'); return Promise.resolve({ error: 'แก้ task ยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminUpdateRevoke: function () { ofb2NotReady('อัปเดต access revoke'); return Promise.resolve({ error: 'แก้ revoke ยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminAddReturn: function () { ofb2NotReady('เพิ่มรายการคืน'); return Promise.resolve({ error: 'เพิ่มรายการคืนยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminRemoveReturn: function () { ofb2NotReady('ลบรายการคืน'); return Promise.resolve({ error: 'ลบรายการคืนยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminRecalcPayout: function () { ofb2NotReady('คำนวณ Final Payout'); return Promise.resolve({ error: 'คำนวณ payout ยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminUpdatePayout: function () { ofb2NotReady('บันทึก payout'); return Promise.resolve({ error: 'บันทึก payout ยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminAddDoc: function () { ofb2NotReady('เพิ่มเอกสาร'); return Promise.resolve({ error: 'เพิ่มเอกสารยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminUpdateDoc: function () { ofb2NotReady('อัปเดตเอกสาร'); return Promise.resolve({ error: 'แก้เอกสารยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminSaveSurvey: function () { ofb2NotReady('บันทึก exit survey'); return Promise.resolve({ error: 'บันทึก survey ยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminAddKt: function () { ofb2NotReady('เพิ่ม knowledge transfer'); return Promise.resolve({ error: 'เพิ่ม KT ยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminUpdateKt: function () { ofb2NotReady('อัปเดต KT'); return Promise.resolve({ error: 'แก้ KT ยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminRemoveKt: function () { ofb2NotReady('ลบ KT'); return Promise.resolve({ error: 'ลบ KT ยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminUpdateStatus: function () { ofb2NotReady('เปลี่ยน status'); return Promise.resolve({ error: 'เปลี่ยน status ยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminCloseCase: function () { ofb2NotReady('ปิดเคส'); return Promise.resolve({ error: 'ปิดเคสยังไม่พร้อมบน dashboard (read-only)' }); },
  offboardingAdminUploadLetter: function () { ofb2NotReady('อัปโหลดใบลาออกไป Drive'); return Promise.resolve({ ok: false, error: 'อัปโหลดไฟล์ยังไม่พร้อมบน dashboard' }); },
  equipmentLoanSendReturn: function () { ofb2NotReady('ส่ง LINE ขอคืนของ'); return Promise.resolve({ error: 'ส่ง LINE ยังไม่พร้อมบน dashboard' }); },
};

var _ofb2NotReadyShown = {};
function ofb2NotReady(feature) {
  if (_ofb2NotReadyShown[feature]) return;
  _ofb2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ofb2Toast) window.ofb2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountOffboard — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountOffboard() {
  if (!document.getElementById('wrap-offboard')) return;
  var wrap = document.getElementById('wrap-offboard');
  wrap.innerHTML = '<style>' + OFB_CSS() + '</style><div id="ofb">' + OFB_MARKUP() + '</div>';
  OFB_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles base + <style> manager) · prefix ทุก selector ด้วย #ofb =====
   ตัด app-shell/topbar/sidebar/main shell ออก (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด */
function OFB_CSS() {
  return [
    // tokens (scope #ofb)
    '#ofb{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#ofb *{box-sizing:border-box}',

    // ===== shared base: page-head / buttons / field / pill / modal / loading =====
    '#ofb .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#ofb .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ofb .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#ofb .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ofb .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;align-items:center}',

    '#ofb .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#ofb .btn:hover{border-color:var(--navy)}',
    '#ofb .btn svg{width:14px;height:14px}',
    '#ofb .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#ofb .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#ofb .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#ofb .btn-sm{padding:5px 10px;font-size:12px}',
    '#ofb .btn-help{width:30px;height:30px;padding:0;border:1px solid var(--border-strong);background:var(--surface);border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted);transition:all .15s}',
    '#ofb .btn-help:hover{color:var(--info);border-color:var(--info);background:var(--info-bg)}',
    '#ofb .btn-help svg{width:16px;height:16px}',

    '#ofb .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}',
    '#ofb .field label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#ofb .field input[type=text],#ofb .field input[type=date],#ofb .field input[type=number],#ofb .field input[type=url],#ofb .field select,#ofb .field textarea{padding:9px 12px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);transition:border .15s;width:100%}',
    '#ofb .field input:focus,#ofb .field select:focus,#ofb .field textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',
    '#ofb .field-help{font-size:11px;color:var(--text-faint);margin-top:2px}',

    '#ofb .modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;z-index:9000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}',
    '#ofb .modal-bg.active{display:flex}',
    '#ofb .modal{background:var(--surface);border-radius:12px;padding:0;max-width:540px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);display:flex;flex-direction:column}',
    '#ofb .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}',
    '#ofb .modal-header h2{font-size:16px;font-weight:600;color:var(--text);letter-spacing:-.01em}',
    '#ofb .modal-header p{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#ofb .modal-body{padding:20px 24px;flex:1;overflow-y:auto}',
    '#ofb .modal-footer{padding:14px 24px;border-top:1px solid var(--border);background:#F8FAFC;display:flex;gap:8px;justify-content:flex-end}',
    '#ofb .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',

    // data-table (จาก _shared_styles)
    '#ofb .data-table{width:100%;border-collapse:collapse;font-size:12px}',
    '#ofb .data-table th{text-align:left;padding:8px 10px;background:#F8FAFC;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border)}',
    '#ofb .data-table td{padding:8px 10px;border-bottom:.5px solid var(--border);vertical-align:top}',
    '#ofb .data-table tr:hover td{background:#FAFBFC}',
    '#ofb .data-table a{color:var(--info)}',

    // help modal sections
    '#ofb .help-section{background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid var(--border-strong)}',
    '#ofb .help-section-warn{background:var(--warning-bg);border-left-color:var(--warning)}',
    '#ofb .help-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}',
  ].join('\n') + OFB_CSS2();
}

/* CSS part 2 — stats / tabs / filters / pipeline / case card / detail modal / sub-tabs / rows
   (จาก <style> หน้า manager · prefix #ofb · คง class เดิม) */
function OFB_CSS2() {
  return '\n' + [
    // Stats row
    '#ofb .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:900px){#ofb .stats{grid-template-columns:repeat(2,1fr)}}',
    '#ofb .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#ofb .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#ofb .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#ofb .stat-card .v{font-size:22px;font-weight:600;line-height:1;letter-spacing:-.02em;margin-top:4px}',
    '#ofb .stat-card.urgent .v{color:var(--danger)}',
    '#ofb .stat-card.active .v{color:var(--info)}',
    '#ofb .stat-card.closed .v{color:var(--success)}',
    // Tabs
    '#ofb .tabs{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}',
    '#ofb .tab{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '#ofb .tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#ofb .tab svg{width:13px;height:13px}',
    '#ofb .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#ofb .tab.active .cnt{background:var(--navy)}',
    '#ofb .tab.tab-urgent.active .cnt{background:var(--danger)}',
    // Filter row
    '#ofb .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}',
    '#ofb .filter{display:flex;flex-direction:column;gap:2px}',
    '#ofb .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#ofb .filter input,#ofb .filter select{padding:4px 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px}',
    // Pipeline
    '#ofb .pipeline{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;min-height:400px}',
    '@media (max-width:1300px){#ofb .pipeline{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:700px){#ofb .pipeline{grid-template-columns:1fr}}',
    '#ofb .col-header{padding:10px 12px;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}',
    '#ofb .col-notice{background:#DBEAFE;color:#1E40AF}',
    '#ofb .col-last_week{background:#FEF3C7;color:#92400E}',
    '#ofb .col-last_day{background:#FED7AA;color:#9A3412}',
    '#ofb .col-next_day{background:#FCE7F3;color:#BE185D}',
    '#ofb .col-post_exit{background:#E0E7FF;color:#4338CA}',
    '#ofb .col-closed{background:#DCFCE7;color:#166534}',
    '#ofb .col-count{padding:1px 7px;border-radius:10px;background:rgba(255,255,255,.7);font-size:10px}',
    '#ofb .col-body{padding:8px;background:#F8FAFC;border-radius:0 0 8px 8px;border:.5px solid var(--border);border-top:0;max-height:600px;overflow-y:auto;display:flex;flex-direction:column;gap:8px}',
    // Case card
    '#ofb .case-card{background:#fff;border:.5px solid var(--border);border-radius:6px;padding:10px 12px;cursor:pointer;transition:all .15s;border-left:3px solid transparent}',
    '#ofb .case-card:hover{border-color:var(--navy-2)}',
    '#ofb .case-card.has-overdue{border-left-color:var(--danger);background:#FEF2F2}',
    '#ofb .case-card.urgent{border-left-color:var(--warning)}',
    '#ofb .case-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}',
    '#ofb .av-mini{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--navy) 0%,var(--navy-2) 100%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}',
    '#ofb .case-name{font-weight:600;font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#ofb .case-meta{font-size:10px;color:var(--text-faint);margin-bottom:6px}',
    '#ofb .case-meta strong{color:var(--text-muted)}',
    '#ofb .case-progress{display:flex;align-items:center;gap:6px;font-size:10px}',
    '#ofb .case-progress-bar{flex:1;height:4px;background:#F1F5F9;border-radius:2px;overflow:hidden}',
    '#ofb .case-progress-fill{height:100%;background:var(--success)}',
    '#ofb .case-progress-fill.low{background:var(--warning)}',
    '#ofb .case-progress-pct{font-weight:600;min-width:30px;text-align:right}',
    '#ofb .case-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;font-size:9px}',
    '#ofb .case-tag{padding:1px 6px;border-radius:4px;background:#F1F5F9;color:var(--text-muted);font-weight:500}',
    '#ofb .case-tag.danger{background:var(--danger-bg);color:var(--danger)}',
    '#ofb .case-tag.warning{background:var(--warning-bg);color:var(--warning)}',
    '#ofb .case-tag.legal{background:#FEE2E2;color:#991B1B}',
    // Detail modal
    '#ofb .modal.large{max-width:980px}',
    '#ofb .case-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px;background:#F8FAFC;border-radius:8px;margin-bottom:14px}',
    '@media (max-width:700px){#ofb .case-summary{grid-template-columns:repeat(2,1fr)}}',
    '#ofb .summary-cell .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}',
    '#ofb .summary-cell .v{font-size:13px;font-weight:500;color:var(--text);margin-top:2px}',
    // Sub-tabs
    '#ofb .sub-tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:14px;flex-wrap:wrap;overflow-x:auto}',
    '#ofb .sub-tab{padding:8px 14px;border:0;background:transparent;border-bottom:2px solid transparent;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}',
    '#ofb .sub-tab:hover{color:var(--text)}',
    '#ofb .sub-tab.active{color:var(--navy);border-bottom-color:var(--navy)}',
    '#ofb .sub-tab svg{width:13px;height:13px}',
    '#ofb .sub-tab .cnt{font-size:10px;padding:1px 5px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#ofb .sub-tab.active .cnt{background:var(--navy)}',
    // Sub content
    '#ofb .phase-block{margin-bottom:14px}',
    '#ofb .phase-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;padding:8px 0;border-bottom:.5px solid var(--border);margin-bottom:6px}',
    '#ofb .row-item{display:grid;grid-template-columns:auto 1fr auto;gap:10px;padding:8px 6px;border-radius:4px;align-items:center;font-size:12px;border-bottom:.5px solid var(--border)}',
    '#ofb .row-item:hover{background:#F8FAFC}',
    '#ofb .row-cb{width:16px;height:16px;cursor:pointer}',
    '#ofb .row-name{font-size:12px;color:var(--text);line-height:1.4}',
    '#ofb .row-name .seq{font-size:10px;color:var(--text-faint);margin-right:4px}',
    '#ofb .row-name.done{text-decoration:line-through;color:var(--text-faint)}',
    '#ofb .row-meta{font-size:10px;color:var(--text-faint);margin-top:2px}',
    '#ofb .row-actions{display:flex;gap:4px}',
    '#ofb .legal-badge{padding:1px 6px;border-radius:4px;background:#FEE2E2;color:#991B1B;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}',
    // pills
    '#ofb .pill{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600}',
    '#ofb .pill-pending{background:#FEF3C7;color:#92400E}',
    '#ofb .pill-revoked{background:#DCFCE7;color:#166534}',
    '#ofb .pill-active{background:#DBEAFE;color:#1E40AF}',
    '#ofb .pill-awaiting_hr{background:#FEF3C7;color:#92400E}',
    '#ofb .pill-na{background:#F1F5F9;color:var(--text-muted)}',
    '#ofb .pill-high{background:#FEE2E2;color:#991B1B}',
    '#ofb .pill-medium{background:#FEF3C7;color:#92400E}',
    '#ofb .pill-low{background:#F1F5F9;color:var(--text-muted)}',
    '#ofb .pill-closed{background:#DCFCE7;color:#166534}',
    // Payout block
    '#ofb .payout-grid{display:grid;grid-template-columns:2fr 1fr;gap:10px 14px;padding:14px;background:#F8FAFC;border-radius:8px}',
    '#ofb .payout-grid .label{font-size:12px;color:var(--text-muted)}',
    '#ofb .payout-grid .value{font-size:13px;font-weight:500;text-align:right;font-variant-numeric:tabular-nums}',
    '#ofb .payout-grid .value.deduct{color:var(--danger)}',
    '#ofb .payout-grid .value.total{font-size:16px;font-weight:700;color:var(--success)}',
    '#ofb .payout-grid hr{grid-column:span 2;border:0;border-top:1px solid var(--border);margin:4px 0}',
    '#ofb .empty-tab{padding:30px 20px;text-align:center;color:var(--text-muted);font-size:12px}',
    '#ofb .add-block{display:flex;gap:6px;margin-top:10px;padding:10px;background:#F8FAFC;border-radius:6px;align-items:center;flex-wrap:wrap}',
    '#ofb .add-block input,#ofb .add-block select{padding:4px 8px;font-size:11px;border:.5px solid var(--border-strong);border-radius:4px}',
    '#ofb .add-block input{min-width:120px}',
  ].join('\n');
}

/* ===== markup เดิม ครบ (header / stats / tabs / filters / content + 2 modals) · คง element id เดิม =====
   ตัด app-shell / topbar / _sidebar / _sheet_link / _brand_footer · header เดิม (page-head) คงไว้
   topbar-actions เดิม รวมเข้า page-actions แล้ว (icon/labels ถูกเซ็ตใน RUN_PAGE_JS) */
function OFB_MARKUP() {
  return [
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    '      Offboarding Cases',
    '    </h1>',
    '    <div class="subtitle">32 + 32a-32g — pipeline 5 phases &times; 25 tasks + 17 system revoke + Final Payout</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn" data-tip="คู่มือการใช้หน้านี้"></button>',
    '    <button class="btn btn-sm" onclick="loadList()" id="refresh-btn"></button>',
    '    <button class="btn btn-primary" onclick="openCreate()" id="new-btn"></button>',
    '  </div>',
    '</header>',
    '',
    '<div class="stats" id="stats"></div>',
    '',
    '<div class="tabs">',
    '  <button class="tab active" id="tab-active" onclick="setTab(\'active\')"></button>',
    '  <button class="tab tab-urgent" id="tab-urgent" onclick="setTab(\'urgent\')"></button>',
    '  <button class="tab" id="tab-closed" onclick="setTab(\'closed\')"></button>',
    '  <button class="tab" id="tab-all" onclick="setTab(\'all\')"></button>',
    '</div>',
    '',
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ค้นหา</label>',
    '    <input type="search" id="filter-search" placeholder="ชื่อ / nickname / case_id" oninput="loadListDebounced()">',
    '  </div>',
    '  <div class="filter">',
    '    <label>สาขา</label>',
    '    <select id="filter-branch" onchange="loadList()">',
    '      <option value="">ทุกสาขา</option>',
    '    </select>',
    '  </div>',
    '</div>',
    '',
    '<div id="content" class="loading">กำลังโหลด...</div>',
    '',
    // Create case modal
    '<div class="modal-bg" id="create-bg" onclick="if(event.target===this)closeCreate()">',
    '  <div class="modal" style="max-width:520px">',
    '    <div class="modal-header">',
    '      <h2>เปิด offboarding case</h2>',
    '      <p>ระบบจะ clone 25 tasks + 17 system revoke + คำนวณ Final Payout ให้อัตโนมัติ</p>',
    '    </div>',
    '    <div class="modal-body">',
    '      <div class="field">',
    '        <label>เลือกพนักงานที่จะออก *</label>',
    '        <select id="c-employee"></select>',
    '        <div class="field-help">แสดงเฉพาะพนักงาน status=active ที่ยังไม่มี offboarding case</div>',
    '      </div>',
    '      <div class="field">',
    '        <label>วันสุดท้าย (last day) *</label>',
    '        <input type="date" id="c-last-day">',
    '        <div class="field-help">ระบบจะ generate notice_date = last_day - 30 วัน</div>',
    '      </div>',
    '      <div class="field">',
    '        <label>ประเภทการลาออก</label>',
    '        <select id="c-reason">',
    '          <option value="voluntary">voluntary — ลาออกเอง</option>',
    '          <option value="involuntary">involuntary — เลิกจ้าง</option>',
    '          <option value="end_of_contract">end_of_contract — หมดสัญญา</option>',
    '          <option value="retirement">retirement — เกษียณ</option>',
    '        </select>',
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
    '        <button class="sub-tab" id="st-revoke" onclick="setSubTab(\'revoke\')"></button>',
    '        <button class="sub-tab" id="st-returns" onclick="setSubTab(\'returns\')"></button>',
    '        <button class="sub-tab" id="st-payout" onclick="setSubTab(\'payout\')"></button>',
    '        <button class="sub-tab" id="st-docs" onclick="setSubTab(\'docs\')"></button>',
    '        <button class="sub-tab" id="st-survey" onclick="setSubTab(\'survey\')"></button>',
    '        <button class="sub-tab" id="st-kt" onclick="setSubTab(\'kt\')"></button>',
    '      </div>',
    '      <div id="sub-content"></div>',
    '    </div>',
    '    <div class="modal-footer" style="justify-content:space-between">',
    '      <div style="display:flex;gap:6px">',
    '        <button class="btn" onclick="closeCase()" id="close-case-btn">ปิดเคส</button>',
    '      </div>',
    '      <div style="display:flex;gap:6px">',
    '        <select id="d-status-select" onchange="changeStatus()" style="padding:6px 10px;border:.5px solid var(--border-strong);border-radius:6px;font-size:12px">',
    '          <option value="notice">notice</option>',
    '          <option value="last_week">last_week</option>',
    '          <option value="last_day">last_day</option>',
    '          <option value="next_day">next_day</option>',
    '          <option value="post_exit">post_exit</option>',
    '          <option value="closed">closed</option>',
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
   OFB_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → OFB_BACKEND
   helper จาก _shared_scripts (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function OFB_RUN_PAGE_JS() {

  // ---- google.script.run shim → OFB_BACKEND (async, คืน shape เดิม) ----
  function _ofb2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (OFB_BACKEND[prop]) {
            Promise.resolve().then(function () { return OFB_BACKEND[prop].apply(OFB_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[OFB_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[OFB_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ofb2MakeChain(); } });

  // ---- helpers จาก _shared_scripts (inline) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('ofb2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ofb2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ofb2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('ofb-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'ofb-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li>' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'ofb-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'ofb-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ===== STATE (ลอกจากหน้าเดิม) ===== */
  let currentTab = 'active';
  let currentSubTab = 'tasks';
  let allData = null;
  let currentDetail = null;
  let allEmployees = [];
  let _searchDebounce = null;

  const HELP = {
    title: 'Offboarding Cases',
    subtitle: 'Sheets: 32 + 32a-32g · เก็บบน Supabase (events)',
    intro: 'จัดการ offboarding ของพนักงานที่ลาออก/เลิกจ้าง — 5 phases × 25 tasks + 17 system revoke + Final Payout calc',
    sections: [
      { title: 'Pipeline 5 phases', items: [
        '<strong>notice</strong> — D-30 to D-8: รับใบลาออก, exit interview, KT plan, replacement decision',
        '<strong>last_week</strong> — D-7 to D-1: เซ็น KT, เตรียมเอกสารออก, lock sensitive systems',
        '<strong>last_day</strong> — วันสุดท้าย: คืนอุปกรณ์, เซ็นใบสำคัญ, รับเอกสาร',
        '<strong>next_day</strong> — D+1 to D+7: revoke 17 systems, แจ้ง สปส., final pay transfer',
        '<strong>post_exit</strong> — D+30 to D+90: PVD disburse, audit access revoke, rehire decision, close',
      ] },
      { title: 'Detail modal — 7 sub-tabs', items: [
        '<strong>Tasks</strong> 25 ข้อ group by phase — tick เสร็จ + แนบ evidence URL',
        '<strong>Access Revoke</strong> 17 systems (JERA, Google, Meta, LINE OA, fingerprint, badge ฯลฯ) — ใช้ความ critical',
        '<strong>Returns</strong> — uniform/badge/locker key/laptop — ใส่ condition + deduction',
        '<strong>Payout</strong> — สรุป severance + leave + working days + tax (รายละเอียดส่ง email ให้ HR Manager)',
        '<strong>Docs Issued</strong> — ใบรับรอง, ปกส.6-09, 50ทวิ, ใบสำคัญรับเงิน',
        '<strong>Exit Survey</strong> — rating + comment',
        '<strong>Knowledge Transfer</strong> — topics + receiver + SOP url + signed off',
      ] },
      { title: 'Returns + LINE workflow', items: [
        '<strong>Returns sub-tab</strong> ดึงของยืม Tab 45 อัตโนมัติ — เห็นว่า พนง.ยืมอะไรค้างอยู่ทันที',
        'ปุ่ม <strong>"ส่ง LINE ขอคืน"</strong> ส่ง flex carousel ให้พนักงานเลือกของที่จะคืน',
        'พนักงานกด "คืนแล้ว" → status เปลี่ยนเป็น awaiting_hr → ระบบเตือน HR ทาง LINE',
        'HR เปิดหน้า Equipment Loans → confirm condition + แนบรูป → คนรับบันทึกอัตโนมัติ',
      ] },
      { type: 'warn', title: 'ระวัง', items: [
        'ปิดเคสได้เมื่อ tasks ทั้งหมด done + access revoke ทั้ง 17 ระบบเสร็จ',
        'ลบเคสไม่ได้ — ใช้ status=cancelled แทน',
        'recalc payout เมื่อ last_day หรือ salary มีการแก้ไข — สรุปจะส่ง email ให้ HR Manager',
        'บน dashboard นี้เป็น read-only: การเขียนกลับ (tick task / revoke / payout / upload / ส่ง LINE) ยังไม่พร้อม',
      ] },
    ],
  };

  /* ===== STATIC ICONS / LABELS ===== */
  document.getElementById('refresh-btn').innerHTML = ICONS.refresh;
  document.getElementById('help-btn').innerHTML = ICONS.help;
  document.getElementById('new-btn').innerHTML = ICONS.plus + ' เปิดเคสใหม่';
  document.getElementById('c-save-btn').innerHTML = ICONS.save + ' สร้าง';

  document.getElementById('tab-active').innerHTML = ICONS.user + ' Active <span class="cnt" id="cnt-active">—</span>';
  document.getElementById('tab-urgent').innerHTML = ICONS.alert + ' Urgent <span class="cnt" id="cnt-urgent">—</span>';
  document.getElementById('tab-closed').innerHTML = ICONS.check + ' Closed <span class="cnt" id="cnt-closed">—</span>';
  document.getElementById('tab-all').innerHTML = ICONS.list + ' ทั้งหมด';

  document.getElementById('st-tasks').innerHTML = ICONS.list + ' Tasks <span class="cnt" id="cnt-tasks">—</span>';
  document.getElementById('st-revoke').innerHTML = ICONS.shield + ' Revoke <span class="cnt" id="cnt-revoke">—</span>';
  document.getElementById('st-returns').innerHTML = ICONS.briefcase + ' Returns <span class="cnt" id="cnt-returns">—</span>';
  document.getElementById('st-payout').innerHTML = ICONS.chart + ' Payout';
  document.getElementById('st-docs').innerHTML = ICONS.doc + ' Docs <span class="cnt" id="cnt-docs">—</span>';
  document.getElementById('st-survey').innerHTML = ICONS.bell + ' Exit Survey';
  document.getElementById('st-kt').innerHTML = ICONS.users + ' KT <span class="cnt" id="cnt-kt">—</span>';

  function loadListDebounced() {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(loadList, 300);
  }

  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#ofb .tabs .tab').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    loadList();
  }

  function loadList() {
    const opts = {
      tab: currentTab,
      search: document.getElementById('filter-search').value || '',
      branch: document.getElementById('filter-branch').value || '',
    };
    document.getElementById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(renderList)
      .withFailureHandler(err => {
        document.getElementById('content').innerHTML = '<div class="empty-tab">โหลดข้อมูลล้มเหลว: ' + escapeHtml(err.message) + '</div>';
      })
      .offboardingAdminList(opts);
  }

  function renderList(res) {
    if (!res || res.error) {
      document.getElementById('content').innerHTML = '<div class="empty-tab">ผิดพลาด: ' + escapeHtml(res && res.error || 'unknown') + '</div>';
      return;
    }
    allData = res;
    populateBranchFilter(res.branches || []);
    renderStats(res.stats || {});

    const items = res.items || [];
    if (!items.length) {
      document.getElementById('content').innerHTML = '<div class="empty-tab">ไม่มีเคสตรงตามเงื่อนไข — กดปุ่ม "เปิดเคสใหม่" เพื่อสร้าง</div>';
      return;
    }
    if (currentTab === 'active' || currentTab === 'urgent') {
      document.getElementById('content').innerHTML = renderPipeline(items);
    } else {
      document.getElementById('content').innerHTML = renderListView(items);
    }
  }

  function renderStats(s) {
    document.getElementById('stats').innerHTML = [
      statCard('total', 'ทั้งหมด', s.total || 0, ''),
      statCard('active', 'Active', s.active || 0, 'active'),
      statCard('urgent', 'Urgent', s.urgent || 0, 'urgent'),
      statCard('closed', 'Closed', s.closed || 0, 'closed'),
      statCard('total_severance', 'Severance รวม', formatBaht(s.total_severance || 0), ''),
    ].join('');
    document.getElementById('cnt-active').textContent = s.active || 0;
    document.getElementById('cnt-urgent').textContent = s.urgent || 0;
    document.getElementById('cnt-closed').textContent = s.closed || 0;
  }

  function statCard(id, label, val, cls) {
    return '<div class="stat-card ' + cls + '"><div class="l">' + escapeHtml(label) + '</div><div class="v">' + val + '</div></div>';
  }

  function formatBaht(n) {
    return Number(n || 0).toLocaleString('en-US') + ' ฿';
  }

  function populateBranchFilter(branches) {
    const sel = document.getElementById('filter-branch');
    if (sel.options.length > 1) return;
    branches.forEach(b => {
      const o = document.createElement('option');
      o.value = b.id; o.textContent = b.name;
      sel.appendChild(o);
    });
  }

  function renderPipeline(items) {
    const phases = [
      { key: 'notice', label: 'Notice (D-30 to D-8)' },
      { key: 'last_week', label: 'Last week (D-7 to D-1)' },
      { key: 'last_day', label: 'Last day' },
      { key: 'next_day', label: 'Next day (D+1 to D+7)' },
      { key: 'post_exit', label: 'Post-exit (D+30 to D+90)' },
      { key: 'closed', label: 'Closed' },
    ];
    const grouped = {};
    phases.forEach(p => grouped[p.key] = []);
    items.forEach(it => {
      if (grouped[it.status]) grouped[it.status].push(it);
      else if (it.status === 'cancelled') { /* hide */ }
    });

    const cols = phases.map(p => {
      const cards = grouped[p.key].map(renderCaseCard).join('') ||
        '<div style="font-size:10px;color:var(--text-faint);text-align:center;padding:14px 6px">ไม่มี case</div>';
      return [
        '<div class="col">',
          '<div class="col-header col-' + p.key + '">',
            '<span>' + escapeHtml(p.label) + '</span>',
            '<span class="col-count">' + grouped[p.key].length + '</span>',
          '</div>',
          '<div class="col-body">' + cards + '</div>',
        '</div>',
      ].join('');
    }).join('');

    return '<div class="pipeline">' + cols + '</div>';
  }

  function renderListView(items) {
    if (!items.length) return '<div class="empty-tab">ไม่มีเคส</div>';
    return '<div style="display:flex;flex-direction:column;gap:8px">' +
      items.map(renderCaseCard).join('') + '</div>';
  }

  function renderCaseCard(c) {
    const cls = ['case-card'];
    if (c.tasks_overdue > 0) cls.push('has-overdue');
    else if (c.days_until_last_day !== null && c.days_until_last_day >= 0 && c.days_until_last_day <= 7) cls.push('urgent');
    const initials = (c.employee_nickname || c.employee_name || '?').substring(0, 2).toUpperCase();
    const progFill = c.task_progress >= 60 ? '' : 'low';
    const dayUntil = c.days_until_last_day;
    const dayLabel = dayUntil === null ? '-' :
      dayUntil < 0 ? 'ผ่านมาแล้ว ' + Math.abs(dayUntil) + 'd' :
      dayUntil === 0 ? 'วันนี้' :
      'อีก ' + dayUntil + 'd';

    const tags = [];
    if (c.tasks_overdue > 0) tags.push('<span class="case-tag danger">' + c.tasks_overdue + ' overdue</span>');
    if (c.replacement_needed) tags.push('<span class="case-tag warning">replacement</span>');
    if (c.line_linked) tags.push('<span class="case-tag">LINE</span>');
    if (c.severance_amount > 0) tags.push('<span class="case-tag legal">severance ' + formatBaht(c.severance_amount) + '</span>');

    return [
      '<div class="' + cls.join(' ') + '" onclick="openDetail(\'' + escapeAttr(c.case_id) + '\')">',
        '<div class="case-head">',
          '<div class="av-mini">' + escapeHtml(initials) + '</div>',
          '<div class="case-name">' + escapeHtml(c.employee_nickname || c.employee_name) + '</div>',
        '</div>',
        '<div class="case-meta">',
          '<strong>' + escapeHtml(c.branch_name || '-') + '</strong> · last day ' + escapeHtml(c.last_day || '-') + ' · ' + escapeHtml(dayLabel),
        '</div>',
        '<div class="case-progress">',
          '<div class="case-progress-bar"><div class="case-progress-fill ' + progFill + '" style="width:' + c.task_progress + '%"></div></div>',
          '<div class="case-progress-pct">' + c.task_progress + '%</div>',
        '</div>',
        '<div class="case-meta" style="margin-top:4px">tasks ' + c.tasks_done + '/' + c.tasks_total + ' · revoke ' + c.revoke_revoked + '/' + c.revoke_total + '</div>',
        tags.length ? '<div class="case-tags">' + tags.join('') + '</div>' : '',
      '</div>',
    ].join('');
  }

  // ====== Create modal ======
  function openCreate() {
    document.getElementById('create-bg').classList.add('active');
    const d = new Date(); d.setDate(d.getDate() + 30);
    document.getElementById('c-last-day').value = d.toISOString().slice(0, 10);
    document.getElementById('c-reason').value = 'voluntary';
    loadActiveEmployees();
  }

  function closeCreate() {
    document.getElementById('create-bg').classList.remove('active');
  }

  function loadActiveEmployees() {
    const sel = document.getElementById('c-employee');
    sel.innerHTML = '<option>กำลังโหลด...</option>';
    google.script.run
      .withSuccessHandler(emps => {
        allEmployees = emps || [];
        sel.innerHTML = '<option value="">— เลือกพนักงาน —</option>' +
          allEmployees.map(e =>
            '<option value="' + escapeAttr(e.employee_id) + '">' +
            escapeHtml((e.nickname || e.first_name) + ' (' + e.employee_id + ')') +
            '</option>'
          ).join('');
        if (!allEmployees.length) sel.innerHTML = '<option value="">— ไม่มีรายชื่อ (dashboard read-only) —</option>';
      })
      .withFailureHandler(err => {
        sel.innerHTML = '<option>โหลดไม่สำเร็จ: ' + escapeHtml(err.message) + '</option>';
      })
      .offboardingActiveEmployees();
  }

  function saveCreate() {
    const empId = document.getElementById('c-employee').value;
    const lastDay = document.getElementById('c-last-day').value;
    const reason = document.getElementById('c-reason').value;
    if (!empId) return showToast('เลือกพนักงานก่อน', 'error');
    if (!lastDay) return showToast('ใส่วันสุดท้ายก่อน', 'error');
    document.getElementById('c-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('c-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('เปิดเคสสำเร็จ', 'success');
        closeCreate();
        loadList();
        if (res && res.case_id) openDetail(res.case_id);
      })
      .withFailureHandler(err => {
        document.getElementById('c-save-btn').disabled = false;
        showToast('สร้างไม่สำเร็จ: ' + err.message, 'error');
      })
      .offboardingAdminCreate(empId, { last_day: lastDay, reason: reason });
  }

  // ====== Detail ======
  function openDetail(caseId) {
    document.getElementById('detail-bg').classList.add('active');
    document.getElementById('d-title').textContent = 'กำลังโหลด...';
    document.getElementById('sub-content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(d => {
        if (!d || d.error) {
          document.getElementById('d-title').textContent = 'โหลดล้มเหลว';
          return showToast('ผิดพลาด: ' + (d && d.error || 'unknown'), 'error');
        }
        currentDetail = d;
        renderDetail(d);
      })
      .withFailureHandler(err => {
        document.getElementById('d-title').textContent = 'โหลดล้มเหลว';
        showToast(err.message, 'error');
      })
      .offboardingAdminDetail(caseId);
  }

  function closeDetail() {
    document.getElementById('detail-bg').classList.remove('active');
    currentDetail = null;
  }

  function renderDetail(d) {
    const ci = d.case_info;
    document.getElementById('d-title').textContent = ci.employee_name + ' · ' + ci.case_id;
    document.getElementById('d-sub').textContent =
      ci.branch_name + ' · ' + ci.resignation_type + ' · last day ' + ci.last_day +
      (ci.days_until_last_day !== null ? ' (' + (ci.days_until_last_day < 0 ? 'ผ่านมา ' + Math.abs(ci.days_until_last_day) + 'd' : 'อีก ' + ci.days_until_last_day + 'd') + ')' : '');
    document.getElementById('d-status-select').value = ci.status;

    const letterCell = ci.resignation_letter_url
      ? '<a href="' + escapeAttr(ci.resignation_letter_url) + '" target="_blank" style="color:var(--teal-dark);font-weight:600">เปิดไฟล์</a>' +
        ' · <label style="cursor:pointer;color:var(--text-muted);text-decoration:underline">เปลี่ยน<input type="file" accept="application/pdf,image/*" style="display:none" onchange="doUploadLetter(this)"></label>'
      : '<label style="cursor:pointer;color:var(--navy-2);font-weight:600;text-decoration:underline">แนบไฟล์เซ็น<input type="file" accept="application/pdf,image/*" style="display:none" onchange="doUploadLetter(this)"></label>';
    document.getElementById('d-summary').innerHTML = [
      summaryCell('Status', '<span class="pill pill-' + (ci.status === 'closed' ? 'revoked' : 'pending') + '">' + escapeHtml(ci.status) + '</span>'),
      summaryCell('Last day', escapeHtml(ci.last_day || '-')),
      summaryCell('Severance', formatBaht(ci.severance_amount)),
      summaryCell('Final pay', formatBaht(ci.final_pay_amount)),
      summaryCell('ใบลาออก (เซ็น)', letterCell),
    ].join('');

    document.getElementById('cnt-tasks').textContent = (d.tasks_count.done || 0) + '/' + (d.tasks_count.total || 0);
    document.getElementById('cnt-revoke').textContent = (d.revoke_count.revoked || 0) + '/' + (d.revoke_count.total || 0);
    document.getElementById('cnt-returns').textContent = (d.returns || []).length;
    document.getElementById('cnt-docs').textContent = (d.docs || []).length;
    document.getElementById('cnt-kt').textContent = (d.kt || []).length;

    setSubTab(currentSubTab);
  }

  function summaryCell(l, v) {
    return '<div class="summary-cell"><div class="l">' + escapeHtml(l) + '</div><div class="v">' + v + '</div></div>';
  }

  // upload ไฟล์ใบลาออกที่เซ็น (PDF/รูป) → Drive
  function doUploadLetter(input) {
    if (!input.files || !input.files[0]) return;
    if (!currentDetail || !currentDetail.case_info) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) { showToast('ไฟล์ใหญ่เกิน 5MB', 'error'); input.value = ''; return; }
    const caseId = currentDetail.case_info.case_id;
    showToast('กำลังอัปโหลด ' + file.name + '...', 'info');
    const reader = new FileReader();
    reader.onload = function (e) {
      google.script.run
        .withSuccessHandler(function (res) {
          if (res && res.ok) { showToast('อัปโหลดใบลาออกแล้ว', 'success'); openDetail(caseId); }
          else { showToast('ล้มเหลว: ' + ((res && res.error) || 'unknown'), 'error'); }
        })
        .withFailureHandler(function (err) { showToast('ล้มเหลว: ' + err.message, 'error'); })
        .offboardingAdminUploadLetter(caseId, e.target.result, file.name);
    };
    reader.readAsDataURL(file);
  }

  function setSubTab(tab) {
    currentSubTab = tab;
    document.querySelectorAll('#ofb .sub-tab').forEach(b => b.classList.remove('active'));
    document.getElementById('st-' + tab).classList.add('active');
    if (!currentDetail) return;
    let html = '';
    if (tab === 'tasks') html = renderSubTasks(currentDetail.tasks_by_phase || {});
    else if (tab === 'revoke') html = renderSubRevoke(currentDetail.revoke || []);
    else if (tab === 'returns') html = renderSubReturns(currentDetail.returns || [], currentDetail.open_loans || []);
    else if (tab === 'payout') html = renderSubPayout(currentDetail.payout, currentDetail.case_info);
    else if (tab === 'docs') html = renderSubDocs(currentDetail.docs || []);
    else if (tab === 'survey') html = renderSubSurvey(currentDetail.survey);
    else if (tab === 'kt') html = renderSubKt(currentDetail.kt || []);
    document.getElementById('sub-content').innerHTML = html;
  }

  // ===== Sub: Tasks =====
  function renderSubTasks(tasksByPhase) {
    const phases = ['notice', 'last_week', 'last_day', 'next_day', 'post_exit'];
    let html = '';
    phases.forEach(p => {
      const items = tasksByPhase[p] || [];
      if (!items.length) return;
      html += '<div class="phase-block">';
      html += '<div class="phase-title">' + escapeHtml(p) + ' (' + items.length + ')</div>';
      items.forEach(t => {
        const checked = t.status === 'done' ? 'checked' : '';
        const nameCls = t.status === 'done' ? 'done' : '';
        const legal = t.is_legal_compliance ? '<span class="legal-badge">legal</span>' : '';
        html += '<div class="row-item">';
        html += '<input type="checkbox" class="row-cb" ' + checked + ' onchange="toggleTask(\'' + escapeAttr(t.task_id) + '\', this.checked)">';
        html += '<div>';
        html += '<div class="row-name ' + nameCls + '"><span class="seq">#' + t.sequence + '</span>' + escapeHtml(t.task_name) + ' ' + legal + '</div>';
        html += '<div class="row-meta">' + escapeHtml(t.owner_role) + ' · due ' + escapeHtml(t.due_date) +
          (t.evidence_url ? ' · <a href="' + escapeAttr(t.evidence_url) + '" target="_blank">evidence</a>' : '') + '</div>';
        html += '</div>';
        html += '<div class="row-actions"><button class="btn btn-sm" onclick="promptEvidence(\'' + escapeAttr(t.task_id) + '\')">evidence</button></div>';
        html += '</div>';
      });
      html += '</div>';
    });
    return html || '<div class="empty-tab">ยังไม่มี task (dashboard sync เฉพาะข้อมูล case หลัก)</div>';
  }

  function toggleTask(taskId, checked) {
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        reloadDetail();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminUpdateTask(taskId, checked ? 'done' : 'pending', '');
  }

  function promptEvidence(taskId) {
    const url = prompt('ใส่ Drive URL evidence:');
    if (!url) return;
    google.script.run
      .withSuccessHandler(() => { showToast('บันทึก evidence แล้ว', 'success'); reloadDetail(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminUpdateTask(taskId, 'done', url);
  }

  // ===== Sub: Revoke =====
  function renderSubRevoke(revoke) {
    if (!revoke.length) return '<div class="empty-tab">ยังไม่มี checklist (dashboard sync เฉพาะข้อมูล case หลัก)</div>';
    let html = '<table class="data-table"><thead><tr><th>System</th><th>Criticality</th><th>Owner</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    revoke.forEach(r => {
      html += '<tr>';
      html += '<td><strong>' + escapeHtml(r.system_name) + '</strong>' +
        (r.evidence_url ? ' · <a href="' + escapeAttr(r.evidence_url) + '" target="_blank">evidence</a>' : '') + '</td>';
      html += '<td><span class="pill pill-' + r.criticality + '">' + escapeHtml(r.criticality) + '</span></td>';
      html += '<td>' + escapeHtml(r.owner_role) + '</td>';
      html += '<td><span class="pill pill-' + r.status + '">' + escapeHtml(r.status) + '</span>' +
        (r.revoked_at ? ' <span style="font-size:10px;color:var(--text-faint)"> ' + escapeHtml(r.revoked_at) + '</span>' : '') + '</td>';
      html += '<td>' +
        (r.status === 'pending' ?
          '<button class="btn btn-sm" onclick="revokeSystem(\'' + escapeAttr(r.revoke_id) + '\')">Mark revoked</button>' +
          ' <button class="btn btn-sm" onclick="markNa(\'' + escapeAttr(r.revoke_id) + '\')">N/A</button>'
          : '<button class="btn btn-sm" onclick="undoRevoke(\'' + escapeAttr(r.revoke_id) + '\')">undo</button>') +
      '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function revokeSystem(revokeId) {
    const url = prompt('ใส่ Drive URL evidence (optional):') || '';
    google.script.run
      .withSuccessHandler(() => { showToast('Revoked', 'success'); reloadDetail(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminUpdateRevoke(revokeId, 'revoked', url);
  }

  function markNa(revokeId) {
    google.script.run
      .withSuccessHandler(reloadDetail)
      .offboardingAdminUpdateRevoke(revokeId, 'na', '');
  }

  function undoRevoke(revokeId) {
    google.script.run
      .withSuccessHandler(reloadDetail)
      .offboardingAdminUpdateRevoke(revokeId, 'pending', '');
  }

  // ===== Sub: Returns =====
  function renderSubReturns(returns, openLoans) {
    let html = '';
    openLoans = openLoans || [];

    if (openLoans.length > 0) {
      const allActive = openLoans.filter(l => l.status === 'active');
      const sendableIds = allActive.map(l => l.loan_id);
      html += '<div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:8px;padding:12px;margin-bottom:14px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html += '<div style="font-size:12px;font-weight:600;color:#991B1B;text-transform:uppercase;letter-spacing:0.05em">ของยืมที่ยังไม่คืน · ' + openLoans.length + ' รายการ</div>';
      if (sendableIds.length > 0) {
        html += '<button class="btn btn-sm btn-primary" onclick="sendLineReturnFromOffboarding([' +
          sendableIds.map(id => '\'' + escapeAttr(id) + '\'').join(',') +
          '])">' + ICONS.bell + ' ส่ง LINE ขอคืน ' + sendableIds.length + ' รายการ</button>';
      }
      html += '</div>';
      html += '<table class="data-table"><thead><tr><th>ประเภท</th><th>Item</th><th>Serial</th><th>ยืมเมื่อ</th><th>Status</th><th>Action</th></tr></thead><tbody>';
      openLoans.forEach(l => {
        html += '<tr>';
        html += '<td>' + escapeHtml(l.item_type) + '</td>';
        html += '<td><strong>' + escapeHtml(l.item_name || '-') + '</strong></td>';
        html += '<td>' + escapeHtml(l.serial || '-') + '</td>';
        html += '<td>' + escapeHtml(l.lent_at || '-') + (l.expected_return ? '<div style="font-size:10px;color:var(--text-faint)">คาด ' + escapeHtml(l.expected_return) + '</div>' : '') + '</td>';
        html += '<td><span class="pill pill-' + l.status + '">' + escapeHtml(l.status) + '</span>' +
          (l.return_request_at ? '<div style="font-size:10px;color:var(--text-faint);margin-top:2px">พนง.กด ' + escapeHtml(l.return_request_at) + '</div>' : '') + '</td>';
        html += '<td><span style="font-size:10px;color:var(--text-faint)">ดูที่หน้า loans</span></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      html += '<div style="font-size:10px;color:var(--text-faint);margin-top:6px">บันทึก condition + คนรับคืนได้ที่หน้า Equipment loans (Tab 45)</div>';
      html += '</div>';
    }

    if (!returns.length) html += '<div class="empty-tab" style="padding:14px">ยังไม่มีรายการคืน checklist (uniform/badge ที่ระบบ trigger)</div>';
    else {
      html += '<table class="data-table"><thead><tr><th>Type</th><th>Item</th><th>Condition</th><th>Returned at</th><th>Deduct</th><th></th></tr></thead><tbody>';
      returns.forEach(r => {
        html += '<tr>';
        html += '<td>' + escapeHtml(r.item_type) + '</td>';
        html += '<td>' + escapeHtml(r.item_name) +
          (r.evidence_url ? ' · <a href="' + escapeAttr(r.evidence_url) + '" target="_blank">photo</a>' : '') + '</td>';
        html += '<td>' + escapeHtml(r.condition) + '</td>';
        html += '<td>' + escapeHtml(r.returned_at || '-') + '</td>';
        html += '<td>' + (r.deduction_amount ? formatBaht(r.deduction_amount) : '-') + '</td>';
        html += '<td><button class="btn btn-sm" onclick="removeReturn(\'' + escapeAttr(r.return_id) + '\')">ลบ</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += [
      '<div class="add-block">',
        '<select id="ar-type"><option value="uniform">uniform</option><option value="badge">badge</option><option value="key">key</option><option value="laptop">laptop</option><option value="other">other</option></select>',
        '<input id="ar-name" placeholder="ชื่อ item">',
        '<select id="ar-cond"><option value="good">good</option><option value="damaged">damaged</option><option value="lost">lost</option></select>',
        '<input id="ar-deduct" type="number" placeholder="Deduct (฿)" style="width:100px">',
        '<button class="btn btn-sm btn-primary" onclick="addReturn()">เพิ่ม</button>',
      '</div>',
    ].join('');
    return html;
  }

  function sendLineReturnFromOffboarding(loanIds) {
    if (!currentDetail || !currentDetail.case_info) return;
    const empId = currentDetail.case_info.employee_id;
    if (!confirm('ส่ง LINE flex ให้พนักงานกดคืน ' + loanIds.length + ' รายการ?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ส่ง LINE แล้ว · พนักงานจะได้รับ flex ' + (res.loans_sent || 0) + ' รายการ', 'success');
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .equipmentLoanSendReturn(empId, loanIds);
  }

  function addReturn() {
    const opts = {
      item_type: document.getElementById('ar-type').value,
      item_name: document.getElementById('ar-name').value || '',
      condition: document.getElementById('ar-cond').value,
      deduction_amount: document.getElementById('ar-deduct').value || 0,
      returned_at: new Date().toISOString(),
    };
    if (!opts.item_name) return showToast('ใส่ชื่อ item ก่อน', 'error');
    google.script.run
      .withSuccessHandler(() => { showToast('เพิ่มรายการแล้ว', 'success'); reloadDetail(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminAddReturn(currentDetail.case_info.case_id, opts);
  }

  function removeReturn(retId) {
    if (!confirm('ลบรายการนี้?')) return;
    google.script.run
      .withSuccessHandler(reloadDetail)
      .offboardingAdminRemoveReturn(retId);
  }

  // ===== Sub: Payout =====
  function renderSubPayout(p, ci) {
    if (!p) {
      return [
        '<div class="empty-tab">ยังไม่มี payout — กดคำนวณ</div>',
        '<div style="text-align:center;margin-top:10px"><button class="btn btn-primary" onclick="recalcPayout()">คำนวณ Final Payout</button></div>',
      ].join('');
    }
    const html = [
      '<div class="payout-grid">',
        '<div class="label">Working days remaining</div><div class="value">' + p.working_days_remaining + ' วัน</div>',
        '<div class="label">OT pending</div><div class="value">' + formatBaht(p.ot_pending) + '</div>',
        '<div class="label">Leave unused payout</div><div class="value">' + formatBaht(p.leave_unused_payout) + '</div>',
        '<div class="label">Severance</div><div class="value">' + formatBaht(p.severance_law) + '</div>',
        '<div class="label">Commission pending</div><div class="value">' + formatBaht(p.commission_pending) + '</div>',
        '<hr>',
        '<div class="label" style="font-weight:600">Deductions</div><div class="value deduct">−' + formatBaht(p.deductions) + '</div>',
        '<hr>',
        '<div class="label" style="font-weight:700">Total net</div><div class="value total">' + formatBaht(p.total_net) + '</div>',
      '</div>',
      '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">',
        '<button class="btn" onclick="recalcPayout()">' + ICONS.refresh + ' Recalc</button>',
        '<input type="date" id="p-pay-date" value="' + (p.payment_date || '') + '" style="padding:6px 10px;border:.5px solid var(--border-strong);border-radius:6px">',
        '<input type="url" id="p-payslip" placeholder="Payslip Drive URL" value="' + escapeAttr(p.payslip_url || '') + '" style="padding:6px 10px;border:.5px solid var(--border-strong);border-radius:6px;flex:1;min-width:200px">',
        '<button class="btn btn-primary" onclick="savePayout()">บันทึก</button>',
      '</div>',
      '<div style="font-size:10px;color:var(--text-faint);margin-top:8px;padding:6px 10px;background:#F8FAFC;border-radius:6px">สรุปฉบับเต็ม (รวม breakdown รายตัว) ถูกส่ง email ให้ HR Manager แล้วเมื่อกด Recalc/บันทึก</div>',
    ].join('');
    return html;
  }

  function recalcPayout() {
    if (!confirm('คำนวณ Final Payout ใหม่จาก salary ล่าสุด?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('คำนวณใหม่แล้ว', 'success');
        reloadDetail();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminRecalcPayout(currentDetail.case_info.case_id);
  }

  function savePayout() {
    const updates = {
      payment_date: document.getElementById('p-pay-date').value || '',
      payslip_url: document.getElementById('p-payslip').value || '',
    };
    google.script.run
      .withSuccessHandler(() => { showToast('บันทึก payout แล้ว', 'success'); reloadDetail(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminUpdatePayout(currentDetail.case_info.case_id, updates);
  }

  // ===== Sub: Docs Issued =====
  function renderSubDocs(docs) {
    let html = '';
    if (!docs.length) html += '<div class="empty-tab">ยังไม่มีเอกสาร</div>';
    else {
      html += '<table class="data-table"><thead><tr><th>Doc type</th><th>Drive</th><th>Issued</th><th>Signed</th><th></th></tr></thead><tbody>';
      docs.forEach(d => {
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(d.doc_type) + '</strong></td>';
        html += '<td>' + (d.drive_url ? '<a href="' + escapeAttr(d.drive_url) + '" target="_blank">เปิด</a>' : '-') + '</td>';
        html += '<td>' + escapeHtml(d.issued_at || '-') + '</td>';
        html += '<td>' + escapeHtml(d.signed_by_employee_at || '-') + '</td>';
        html += '<td><button class="btn btn-sm" onclick="markDocSigned(\'' + escapeAttr(d.doc_id) + '\')">Mark signed</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += [
      '<div class="add-block">',
        '<select id="ad-type">',
          '<option value="ใบรับรองการทำงาน">ใบรับรองการทำงาน</option>',
          '<option value="ปกส.6-09">ปกส.6-09</option>',
          '<option value="50ทวิ">50ทวิ</option>',
          '<option value="ใบสำคัญรับเงิน">ใบสำคัญรับเงิน</option>',
          '<option value="ใบคืนอุปกรณ์">ใบคืนอุปกรณ์</option>',
        '</select>',
        '<input id="ad-url" type="url" placeholder="Drive URL" style="flex:1;min-width:200px">',
        '<button class="btn btn-sm btn-primary" onclick="addDoc()">บันทึก</button>',
      '</div>',
    ].join('');
    return html;
  }

  function addDoc() {
    const opts = {
      doc_type: document.getElementById('ad-type').value,
      drive_url: document.getElementById('ad-url').value || '',
      issued_at: new Date().toISOString(),
    };
    if (!opts.drive_url) return showToast('ใส่ Drive URL', 'error');
    google.script.run
      .withSuccessHandler(() => { showToast('เพิ่มเอกสารแล้ว', 'success'); reloadDetail(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminAddDoc(currentDetail.case_info.case_id, opts);
  }

  function markDocSigned(docId) {
    google.script.run
      .withSuccessHandler(reloadDetail)
      .offboardingAdminUpdateDoc(docId, { signed_by_employee_at: new Date().toISOString() });
  }

  // ===== Sub: Exit Survey =====
  function renderSubSurvey(s) {
    const rating = s ? s.rating : 0;
    const comment = s ? s.comment : '';
    return [
      '<div style="padding:14px;background:#F8FAFC;border-radius:8px;margin-bottom:10px">',
        s ? '<div style="font-size:11px;color:var(--text-faint);margin-bottom:6px">บันทึกเมื่อ ' + escapeHtml(s.submitted_at || '-') + '</div>' : '',
        '<div class="field">',
          '<label>Rating (1-5)</label>',
          '<input type="number" id="sv-rating" min="1" max="5" value="' + rating + '" style="width:80px">',
        '</div>',
        '<div class="field">',
          '<label>Comment</label>',
          '<textarea id="sv-comment" rows="4" style="width:100%">' + escapeHtml(comment) + '</textarea>',
        '</div>',
        '<button class="btn btn-primary" onclick="saveSurvey()">บันทึก</button>',
      '</div>',
      '<div style="font-size:11px;color:var(--text-muted)">หมายเหตุ: Exit interview detail ของ HR และผู้บริหารอยู่ใน 81-82 (ดูใน Surveys page)</div>',
    ].join('');
  }

  function saveSurvey() {
    const opts = {
      rating: document.getElementById('sv-rating').value || 0,
      comment: document.getElementById('sv-comment').value || '',
    };
    google.script.run
      .withSuccessHandler(() => { showToast('บันทึก survey แล้ว', 'success'); reloadDetail(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminSaveSurvey(currentDetail.case_info.case_id, opts);
  }

  // ===== Sub: KT =====
  function renderSubKt(kt) {
    let html = '';
    if (!kt.length) html += '<div class="empty-tab">ยังไม่มีหัวข้อ KT</div>';
    else {
      html += '<table class="data-table"><thead><tr><th>Topic</th><th>Receiver</th><th>Status</th><th>SOP</th><th></th></tr></thead><tbody>';
      kt.forEach(k => {
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(k.topic) + '</strong>' +
          (k.notes ? '<div style="font-size:10px;color:var(--text-faint)">' + escapeHtml(k.notes) + '</div>' : '') + '</td>';
        html += '<td>' + escapeHtml(k.receiver_name || k.receiver_id || '-') + '</td>';
        html += '<td><select onchange="changeKtStatus(\'' + escapeAttr(k.kt_id) + '\', this.value)">' +
          ['planned', 'in_progress', 'signed_off'].map(s =>
            '<option value="' + s + '" ' + (k.status === s ? 'selected' : '') + '>' + s + '</option>').join('') +
          '</select>' + (k.signed_off_at ? '<div style="font-size:10px;color:var(--text-faint)">' + escapeHtml(k.signed_off_at) + '</div>' : '') + '</td>';
        html += '<td>' + (k.sop_url ? '<a href="' + escapeAttr(k.sop_url) + '" target="_blank">เปิด</a>' : '-') + '</td>';
        html += '<td><button class="btn btn-sm" onclick="removeKt(\'' + escapeAttr(k.kt_id) + '\')">ลบ</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += [
      '<div class="add-block">',
        '<input id="kt-topic" placeholder="หัวข้อ" style="flex:1;min-width:200px">',
        '<select id="kt-receiver"><option value="">— ผู้รับ —</option></select>',
        '<input id="kt-sop" type="url" placeholder="SOP URL">',
        '<button class="btn btn-sm btn-primary" onclick="addKt()">เพิ่ม</button>',
      '</div>',
    ].join('');
    setTimeout(() => {
      const sel = document.getElementById('kt-receiver');
      if (!sel) return;
      if (allEmployees.length === 0) loadActiveEmployees();
      sel.innerHTML = '<option value="">— ผู้รับ —</option>' + allEmployees.map(e =>
        '<option value="' + escapeAttr(e.employee_id) + '">' +
        escapeHtml((e.nickname || e.first_name) + ' (' + e.employee_id + ')') +
        '</option>').join('');
    }, 50);
    return html;
  }

  function addKt() {
    const opts = {
      topic: document.getElementById('kt-topic').value || '',
      receiver_id: document.getElementById('kt-receiver').value || '',
      sop_url: document.getElementById('kt-sop').value || '',
      status: 'planned',
    };
    if (!opts.topic) return showToast('ใส่หัวข้อก่อน', 'error');
    google.script.run
      .withSuccessHandler(() => { showToast('เพิ่ม KT แล้ว', 'success'); reloadDetail(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminAddKt(currentDetail.case_info.case_id, opts);
  }

  function changeKtStatus(ktId, status) {
    google.script.run
      .withSuccessHandler(reloadDetail)
      .offboardingAdminUpdateKt(ktId, { status: status });
  }

  function removeKt(ktId) {
    if (!confirm('ลบ KT รายการนี้?')) return;
    google.script.run
      .withSuccessHandler(reloadDetail)
      .offboardingAdminRemoveKt(ktId);
  }

  // ===== Status / Close =====
  function changeStatus() {
    const newStatus = document.getElementById('d-status-select').value;
    if (!currentDetail) return;
    if (newStatus === currentDetail.case_info.status) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('เปลี่ยน status แล้ว', 'success');
        reloadDetail();
        loadList();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminUpdateStatus(currentDetail.case_info.case_id, newStatus);
  }

  function closeCase() {
    if (!currentDetail) return;
    if (!confirm('ปิดเคสนี้? ระบบจะตรวจว่า tasks + revoke ครบหรือยัง')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ปิดเคสสำเร็จ', 'success');
        closeDetail();
        loadList();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .offboardingAdminCloseCase(currentDetail.case_info.case_id);
  }

  function reloadDetail() {
    if (currentDetail) openDetail(currentDetail.case_info.case_id);
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList, loadListDebounced, setTab, openCreate, closeCreate, saveCreate,
    openDetail, closeDetail, setSubTab, doUploadLetter,
    toggleTask, promptEvidence, revokeSystem, markNa, undoRevoke,
    sendLineReturnFromOffboarding, addReturn, removeReturn,
    recalcPayout, savePayout, addDoc, markDocSigned, saveSurvey,
    addKt, changeKtStatus, removeKt, changeStatus, closeCase,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadList();
  loadActiveEmployees();  // pre-warm so KT receiver dropdown works on first open
}
