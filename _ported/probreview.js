// _ported/probreview.js — FULL native port of desktop probation_manager.html (HR Announcement admin)
// ลอกทั้งดุ้น: tab toggle (Due/Completed/All) + stats(5) + filter สาขา + data-table 3 view
//   + review modal (weighted criteria scoring + outcome pass/extend/fail + comment) + help modal
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix #pr ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ mountProbreview() · google.script.run = shim → PR_BACKEND (Supabase)
//
// ใช้ global sb + esc (index.html module scope) — ห้าม redeclare
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน PR_RUN_PAGE_JS
//
// backend (edge fn hr_probation_review):
//   list/schedule → sb.functions.invoke('hr_probation_review') → { items:[...] }
//   submit        → sb.functions.invoke('hr_probation_review', { body:{
//                      employee_id, milestone_days, result, score, comments, review_date } })
//   whoami        → {ok:true} เต็มสิทธิ์ (dashboard user = admin)
//   criteria weighted รายข้อ → stub (backend ไม่เก็บ per-criterion) → fallback 1 ข้อ + toast

/* ============================================================
   PR_BACKEND — map google.script.run → Supabase edge fn hr_probation_review
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (อ่านจาก renderStats/renderDue/showReviewForm)
   ============================================================ */
var PR_FN = 'hr_probation_review';

// map row ดิบ → shape ที่ JS เดิมใช้ (รวม derive overdue/days/branch)
function pr2MapRow(r) {
  r = r || {};
  var result = String(r.result || r.outcome || '').toLowerCase();
  var status = String(r.status || '').toLowerCase();
  var completed = !!result || status === 'completed' || status === 'reviewed';
  var days = pr2DaysTo(r);
  var overdue = (r.is_overdue != null) ? !!r.is_overdue : (days != null && days < 0);
  return {
    review_id: r.review_id || ((r.employee_id || '') + '_' + (r.milestone_days || '')),
    employee_id: r.employee_id || '',
    employee_name: r.employee_name || r.employee_id || '',
    branch_id: r.branch_id || '',
    start_date: r.start_date || '',
    review_date: r.review_date || '',
    due_date: r.due_date || r.review_due || '',
    days_to_review: days,
    is_overdue: overdue,
    days_since_start: (r.days_since_start != null) ? r.days_since_start : null,
    milestone_days: Number(r.milestone_days) || r.milestone_days || '',
    score: (r.score != null && r.score !== '') ? r.score : '',
    outcome: result,
    result: result,
    comment: r.comments || r.comment || '',
    comments: r.comments || r.comment || '',
    reviewer_name: r.reviewed_by || r.reviewer_name || '',
    reviewed_by: r.reviewed_by || r.reviewer_name || '',
    _completed: completed,
  };
}
function pr2DaysTo(r) {
  if (r.days_to_review != null && r.days_to_review !== '') return Number(r.days_to_review);
  var due = r.due_date || r.review_due || '';
  if (!due) return null;
  var d = new Date(due);
  if (isNaN(d.getTime())) return null;
  var today = new Date(); today.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}
function pr2Completed(r) {
  var result = String((r && (r.result || r.outcome)) || '').toLowerCase();
  var status = String((r && r.status) || '').toLowerCase();
  return !!result || status === 'completed' || status === 'reviewed';
}

// แคช items จาก list ล่าสุด (ให้ getDetail/schedule reuse · backend ไม่มี endpoint แยก)
var _pr2Items = [];

var PR_BACKEND = {
  // role gate — dashboard user = admin เต็มสิทธิ์
  probationAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },

  // list — { stats, branches, due, completed, probation } (derive client-side จาก items เดียว)
  probationAdminList: function (opts) {
    opts = opts || {};
    return sb.functions.invoke(PR_FN).then(function (res) {
      var data = (res && res.data) || {};
      var items = (data.items || []).map(pr2MapRow);
      _pr2Items = items;

      // filter สาขา (server-side opts.branch_id → ทำ client-side)
      var bf = opts.branch_id || '';
      function byBranch(r) { return !bf || (r.branch_id || '') === bf; }

      var due = items.filter(function (r) { return byBranch(r) && !r._completed; });
      var completed = items.filter(function (r) { return byBranch(r) && r._completed; });

      // all probation = group ตามพนักงาน → milestones ที่ทำไปแล้ว
      var byEmp = {};
      items.filter(byBranch).forEach(function (r) {
        var id = r.employee_id || '';
        if (!byEmp[id]) {
          byEmp[id] = {
            employee_id: id, employee_name: r.employee_name || id,
            branch_id: r.branch_id || '', start_date: r.start_date || '',
            days_since_start: r.days_since_start, completed_milestones: [],
          };
        }
        if (r._completed) {
          var ms = Number(r.milestone_days);
          if (ms && byEmp[id].completed_milestones.indexOf(ms) === -1) byEmp[id].completed_milestones.push(ms);
        }
      });
      var probation = Object.keys(byEmp).map(function (k) {
        var p = byEmp[k];
        p.next_milestone = [30, 60, 90, 120].find(function (m) { return p.completed_milestones.indexOf(m) === -1; }) || null;
        return p;
      });

      // branches list (unique จาก items)
      var seen = {};
      items.forEach(function (r) { var b = (r.branch_id || '').trim(); if (b) seen[b] = true; });
      var branches = Object.keys(seen).sort().map(function (b) { return { id: b, name: b }; });

      // stats
      var now = Date.now();
      var overdue = due.filter(function (r) { return r.is_overdue; }).length;
      var dueSoon = due.filter(function (r) { var dt = r.days_to_review; return dt != null && dt >= 0 && dt <= 7; }).length;
      var last30 = completed.filter(function (r) { var d = new Date(r.review_date || ''); return !isNaN(d.getTime()) && (now - d.getTime()) <= 30 * 86400000; }).length;

      return {
        stats: {
          probation_employees: probation.length, due_soon: dueSoon, overdue: overdue,
          completed_total: completed.length, last_30d: last30,
        },
        branches: branches, due: due, completed: completed, probation: probation,
      };
    });
  },

  // schedule — backend ไม่มี endpoint schedule แยก → คืน id สังเคราะห์ (emp_ms) ให้ getDetail ทำงานต่อ
  probationAdminSchedule: function (empId, ms) {
    return Promise.resolve({ id: String(empId) + '_' + String(ms), ok: true });
  },

  // getDetail — หา item ที่ตรง (จาก review_id หรือ emp_ms) → คืน shape ฟอร์มรีวิว
  //   criteria: backend ไม่เก็บ per-criterion → fallback 1 ข้อ (คะแนนรวม) + toast แจ้ง stub
  probationAdminGetDetail: function (reviewId) {
    var r = _pr2Items.find(function (x) { return String(x.review_id) === String(reviewId); });
    if (!r) {
      // reviewId = emp_ms ที่สังเคราะห์จาก schedule → แยกออก
      var parts = String(reviewId || '').split('_');
      var ms = parts.pop();
      var emp = parts.join('_');
      r = _pr2Items.find(function (x) { return String(x.employee_id) === emp && String(x.milestone_days) === ms; });
      if (!r) r = { employee_id: emp, milestone_days: Number(ms) || ms, review_id: reviewId };
    }
    pr2NotReady('เกณฑ์ประเมินรายข้อ (weighted criteria)');
    var scoreVal = (r.score != null && r.score !== '') ? Number(r.score) : 0;
    return Promise.resolve({
      review_id: r.review_id || reviewId,
      employee_id: r.employee_id || '',
      employee_name: r.employee_name || r.employee_id || '',
      employee_start_date: r.start_date || '—',
      employee_position: r.position || r.employee_position || 'default',
      employee_branch: r.branch_id || '',
      milestone_days: r.milestone_days || '',
      score: scoreVal,
      scores: { overall: scoreVal },
      // fallback 1 criterion (น้ำหนัก 100%) — backend ไม่มี config ราย criterion
      criteria: [{ criterion_key: 'overall', criterion_name: 'คะแนนประเมินรวม', weight: 100, description: 'คะแนนรวม 0-100 (backend ยังไม่เก็บราย criterion)' }],
      outcome: r.outcome || '',
      comment: r.comment || '',
      is_completed: !!r._completed || pr2Completed(r),
    });
  },

  // submit — POST ผลรีวิว (score รวม + outcome + comment)
  probationAdminSubmit: function (reviewId, scores, outcome, comment) {
    // หา emp + ms จาก item (หรือ split emp_ms)
    var r = _pr2Items.find(function (x) { return String(x.review_id) === String(reviewId); });
    var empId, ms;
    if (r) { empId = r.employee_id; ms = r.milestone_days; }
    else { var parts = String(reviewId || '').split('_'); ms = parts.pop(); empId = parts.join('_'); }

    // score รวม — ใช้ scores.overall ถ้ามี · ไม่งั้น weighted average จาก scores ที่ส่งมา
    var score = null;
    if (scores && typeof scores === 'object') {
      if (scores.overall != null && scores.overall !== '') score = Number(scores.overall);
      else {
        var vals = Object.keys(scores).map(function (k) { return Number(scores[k]) || 0; });
        if (vals.length) score = Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length);
      }
    }
    var body = {
      employee_id: empId,
      milestone_days: Number(ms) || ms,
      result: outcome,
      comments: comment || '',
      review_date: new Date().toISOString().slice(0, 10),
    };
    if (score != null && !isNaN(score)) body.score = score;

    return sb.functions.invoke(PR_FN, { body: body }).then(function (res) {
      var data = (res && res.data) || {}, error = res && res.error;
      if (error || data.error) return { error: (data.error || (error && error.message) || 'บันทึกไม่สำเร็จ') };
      return { ok: true };
    });
  },

  // empCacheList / navGetExecUrl — stub (ไม่มีใน dashboard scope)
  empCacheList: function () { return Promise.resolve([]); },
  navGetExecUrl: function () { return Promise.resolve(''); },
};

var _pr2NotReadyShown = {};
function pr2NotReady(feature) {
  if (_pr2NotReadyShown[feature]) return;
  _pr2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.pr2Toast) window.pr2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard — ใช้ช่องคะแนนรวมแทน', 'error');
}

/* ============================================================
   mountProbreview — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountProbreview() {
  var wrap = document.getElementById('wrap-probreview');
  if (!wrap) return;

  wrap.innerHTML = '<style>' + PR_CSS() + '</style><div id="pr">' + PR_MARKUP() + '</div>';

  // รัน JS ของหน้าเดิม (closure scope · google = shim) → ผูก fn ที่ inline onclick ต้องใช้ ลง window
  PR_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles + <style> manager) · prefix ทุก selector ด้วย #pr =====
   ตัด sidebar/main shell/topbar ออก (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด */
function PR_CSS() {
  return [
    // tokens
    '#pr{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#pr *{box-sizing:border-box}',

    // ===== shared: buttons / field / modal / empty / loading / help =====
    '#pr .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#pr .btn:hover{border-color:var(--navy)}',
    '#pr .btn svg{width:14px;height:14px}',
    '#pr .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#pr .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#pr .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#pr .btn-sm{padding:5px 10px;font-size:12px}',
    '#pr .btn-help{width:30px;height:30px;padding:0;border:1px solid var(--border-strong);background:var(--surface);border-radius:50%;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;color:var(--text-muted);transition:all .15s}',
    '#pr .btn-help:hover{color:var(--info);border-color:var(--info);background:var(--info-bg)}',
    '#pr .btn-help svg{width:16px;height:16px}',

    // ===== page head =====
    '#pr .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#pr .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#pr .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#pr .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#pr .page-actions{display:flex;gap:8px;flex-shrink:0}',

    // ===== tab toggle =====
    '#pr .tab-row{display:flex;gap:6px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;width:fit-content;flex-wrap:wrap}',
    '#pr .tab-btn{padding:7px 14px;border:none;background:transparent;border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}',
    '#pr .tab-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#pr .tab-btn svg{width:14px;height:14px}',
    '#pr .tab-btn .count{font-size:10px;padding:1px 7px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#pr .tab-btn.active .count{background:var(--navy)}',

    // ===== stats =====
    '#pr .stats{display:grid;gap:10px;margin-bottom:18px}',
    '#pr .stats.cols-5{grid-template-columns:repeat(5,1fr)}',
    '#pr .stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;position:relative;overflow:hidden;transition:border .15s}',
    '#pr .stat:hover{border-color:var(--border-strong)}',
    '#pr .stat-stripe{position:absolute;top:0;left:0;bottom:0;width:3px}',
    '#pr .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}',
    '#pr .stat-value{font-size:26px;font-weight:600;color:var(--text);margin-top:4px;letter-spacing:-.03em;line-height:1}',
    '#pr .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}',

    // ===== filters =====
    '#pr .filters{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:14px}',
    '#pr .filter{display:flex;flex-direction:column;gap:4px}',
    '#pr .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#pr .filter select{height:32px;box-sizing:border-box;padding:0 28px 0 10px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);min-width:140px;cursor:pointer;appearance:none;background:var(--surface) url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2364748B\' stroke-width=\'2\'><polyline points=\'6,9 12,15 18,9\'/></svg>") no-repeat right 8px center;background-size:14px}',
    '#pr .filter select:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',

    // ===== section card =====
    '#pr .section{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03);margin-bottom:12px}',
    '#pr .section-header{padding:12px 18px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}',
    '#pr .section-icon{width:30px;height:30px;border-radius:6px;background:var(--info-bg);color:var(--info);display:flex;align-items:center;justify-content:center}',
    '#pr .section-icon svg{width:16px;height:16px}',
    '#pr .section-title{font-size:13px;font-weight:600;color:var(--text)}',
    '#pr .section-sub{font-size:11px;color:var(--text-muted)}',

    // ===== data table =====
    '#pr .data-table{width:100%;border-collapse:collapse;font-size:13px}',
    '#pr .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#pr .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}',
    '#pr .data-table tbody tr{border-left:3px solid transparent;transition:background .15s;cursor:pointer}',
    '#pr .data-table tbody tr:hover{background:#FAFBFC}',
    '#pr .data-table tbody tr.is-overdue{border-left-color:var(--danger);background:#FEF2F2}',
    '#pr .data-table tbody tr.due-soon{border-left-color:var(--warning)}',

    // ===== milestone badge =====
    '#pr .ms-badge{display:inline-block;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;font-family:monospace}',
    '#pr .ms-30{background:#DBEAFE;color:#1E40AF}',
    '#pr .ms-60{background:#DCFCE7;color:#15803D}',
    '#pr .ms-90{background:#FEF3C7;color:#B45309}',
    '#pr .ms-120{background:#FCE7F3;color:#BE185D}',

    // ===== days badge =====
    '#pr .days-badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600}',
    '#pr .days-overdue{background:var(--danger-bg);color:var(--danger)}',
    '#pr .days-soon{background:var(--warning-bg);color:var(--warning)}',
    '#pr .days-future{background:var(--success-bg);color:var(--success)}',

    // ===== outcome pill =====
    '#pr .outcome-pill{padding:2px 9px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}',
    '#pr .outcome-pass{background:var(--success-bg);color:var(--success)}',
    '#pr .outcome-fail{background:var(--danger-bg);color:var(--danger)}',
    '#pr .outcome-extend{background:var(--warning-bg);color:var(--warning)}',

    // ===== score bar =====
    '#pr .score-bar{display:inline-flex;align-items:center;gap:6px}',
    '#pr .score-num{font-weight:600;font-size:13px;min-width:30px}',
    '#pr .score-bar-bg{width:80px;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden}',
    '#pr .score-bar-fill{height:100%;background:var(--success);border-radius:3px;transition:width .3s}',
    '#pr .score-bar-fill.low{background:var(--warning)}',
    '#pr .score-bar-fill.poor{background:var(--danger)}',

    // ===== milestone progress dots =====
    '#pr .ms-progress{display:flex;gap:4px;align-items:center}',
    '#pr .ms-dot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;font-family:monospace}',
    '#pr .ms-dot.done{background:var(--success);color:#fff}',
    '#pr .ms-dot.pending{background:#F1F5F9;color:var(--text-muted)}',

    // ===== empty / loading =====
    '#pr .empty{text-align:center;padding:60px 20px;background:var(--surface);border-radius:10px}',
    '#pr .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#pr .empty-icon svg{width:24px;height:24px}',
    '#pr .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#pr .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#pr .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',

    // ===== help modal =====
    '#pr .help-intro{padding:12px 14px;background:var(--info-bg);color:var(--info);border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px}',
    '#pr .help-section{background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid var(--border-strong)}',
    '#pr .help-section.help-section-warn{background:var(--warning-bg);border-left-color:var(--warning)}',
    '#pr .help-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}',
    '#pr .help-section-warn .help-section-title{color:var(--warning)}',
    '#pr .help-section-items{margin-left:18px;font-size:13px;line-height:1.7}',
    '#pr .help-section-items li{margin-bottom:4px}',

    // ===== modal (scope ใต้ #pr · z-index สูง · fixed) =====
    '#pr .modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;z-index:9000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}',
    '#pr .modal-bg.active{display:flex}',
    '#pr .modal{background:var(--surface);border-radius:12px;padding:0;max-width:540px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);display:flex;flex-direction:column}',
    '#pr .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}',
    '#pr .modal-header h2{font-size:16px;font-weight:600;color:var(--text);letter-spacing:-.01em}',
    '#pr .modal-header p{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#pr .modal-body{padding:20px 24px;flex:1;overflow-y:auto}',
    '#pr .modal-footer{padding:14px 24px;border-top:1px solid var(--border);background:#F8FAFC;display:flex;gap:8px;justify-content:flex-end}',

    // ===== field =====
    '#pr .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}',
    '#pr .field label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#pr .field textarea{padding:9px 12px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);transition:border .15s;resize:vertical}',
    '#pr .field textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',

    // ===== score modal (review form) =====
    '#pr .score-row{display:grid;grid-template-columns:1fr 60px 1fr;gap:12px;align-items:center;padding:10px 12px;background:#F8FAFC;border-radius:8px;margin-bottom:8px}',
    '#pr .score-label{font-size:13px;font-weight:500}',
    '#pr .score-input input{width:100%;padding:7px 10px;border:1px solid var(--border-strong);border-radius:6px;font-size:13px;font-family:monospace;text-align:center}',
    '#pr .score-hint{font-size:11px;color:var(--text-muted)}',
    '#pr .total-score{padding:14px;background:var(--info-bg);color:var(--info);border-radius:8px;text-align:center;margin:14px 0}',
    '#pr .total-score-num{font-size:28px;font-weight:600;letter-spacing:-.03em}',
    '#pr .total-score-label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#pr .outcome-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}',
    '#pr .outcome-btn{padding:12px;border:2px solid var(--border);background:#fff;border-radius:8px;cursor:pointer;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:4px;font-family:inherit}',
    '#pr .outcome-btn:hover{border-color:var(--navy)}',
    '#pr .outcome-btn.selected{border-color:var(--navy);background:#EFF6FF}',
    '#pr .outcome-btn-label{font-size:14px;font-weight:600}',
    '#pr .outcome-btn-desc{font-size:11px;color:var(--text-muted)}',
    '#pr .outcome-btn[data-val="pass"].selected{border-color:var(--success);background:var(--success-bg)}',
    '#pr .outcome-btn[data-val="fail"].selected{border-color:var(--danger);background:var(--danger-bg)}',
    '#pr .outcome-btn[data-val="extend"].selected{border-color:var(--warning);background:var(--warning-bg)}',

    // ===== responsive =====
    '@media (max-width:768px){#pr .stats.cols-5{grid-template-columns:repeat(2,1fr)}#pr .section table{display:block;overflow-x:auto;white-space:nowrap}}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก section + review modal · คง element id เดิม =====
   ตัด sidebar/sheet_link/brand_footer/app-shell · คง id: tab-due/tab-completed/tab-all/stats/
   filter-branch/section-icon/section-title/section-sub/content/modal-bg/modal-title/modal-sub/
   modal-body/modal-footer */
function PR_MARKUP() {
  return ''
  + '<header class="page-head">'
  +   '<div>'
  +     '<h1><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Probation Reviews</h1>'
  +     '<div class="subtitle">33_Probation_Reviews — รีวิวพนักงานทดลอง 30/60/90/120 วัน</div>'
  +   '</div>'
  +   '<div class="page-actions">'
  +     '<button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn" data-tip="คู่มือการใช้หน้านี้"></button>'
  +     '<button class="btn btn-sm" onclick="loadCurrent()" id="refresh-btn"></button>'
  +   '</div>'
  + '</header>'

  + '<div class="tab-row">'
  +   '<button class="tab-btn active" id="tab-due" onclick="setTab(\'due\')"></button>'
  +   '<button class="tab-btn" id="tab-completed" onclick="setTab(\'completed\')"></button>'
  +   '<button class="tab-btn" id="tab-all" onclick="setTab(\'all\')"></button>'
  + '</div>'

  + '<div class="stats cols-5" id="stats"></div>'

  + '<div class="filters">'
  +   '<div class="filter">'
  +     '<label>สาขา</label>'
  +     '<select id="filter-branch" onchange="loadCurrent()"><option value="">ทุกสาขา</option></select>'
  +   '</div>'
  + '</div>'

  + '<div class="section">'
  +   '<div class="section-header">'
  +     '<div class="section-icon" id="section-icon"></div>'
  +     '<div style="flex:1">'
  +       '<div class="section-title" id="section-title">Reviews ที่ใกล้ถึง</div>'
  +       '<div class="section-sub" id="section-sub">รีวิวที่ต้องทำใน 30 วัน + overdue</div>'
  +     '</div>'
  +   '</div>'
  +   '<div id="content" class="loading">กำลังโหลด...</div>'
  + '</div>'

  // Review Modal
  + '<div class="modal-bg" id="modal-bg" onclick="if(event.target===this)closeModal()">'
  +   '<div class="modal" style="max-width:600px">'
  +     '<div class="modal-header">'
  +       '<h2 id="modal-title">บันทึกผลรีวิว</h2>'
  +       '<p id="modal-sub"></p>'
  +     '</div>'
  +     '<div class="modal-body" id="modal-body"></div>'
  +     '<div class="modal-footer" id="modal-footer">'
  +       '<button class="btn" onclick="closeModal()">ปิด</button>'
  +     '</div>'
  +   '</div>'
  + '</div>';
}

/* ============================================================
   PR_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → PR_BACKEND
   helper จาก _shared_scripts (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function PR_RUN_PAGE_JS() {

  // ---- google.script.run shim → PR_BACKEND (async, คืน shape เดิม) ----
  function _pr2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (PR_BACKEND[prop]) {
            Promise.resolve().then(function () { return PR_BACKEND[prop].apply(PR_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[PR_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[PR_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _pr2MakeChain(); } });

  // ---- helpers จาก _shared_scripts (inline · scope ใต้ closure นี้) ----
  const ICONS = {
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('pr2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pr2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.pr2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('pr-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'pr-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? escapeHtml(it) : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'pr-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'pr-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  // ===== root scope helper (querySelector ใต้ #pr · กันชน id ซ้ำ dashboard) =====
  const PR_ROOT = document.getElementById('pr');
  function $id(id) { return PR_ROOT ? PR_ROOT.querySelector('#' + id) : document.getElementById(id); }

  /* ============================================================
     ===== JS หน้าเดิม (ลอกจาก probation_manager.html <script>) =====
     แก้เฉพาะ: document.getElementById(X) → $id(X) (scope ใต้ #pr) · ตัด logo/back-btn (ไม่มีใน dashboard)
     ============================================================ */
  let currentTab = 'due';
  let currentData = null;
  let currentReviewId = null;
  let selectedOutcome = null;

  const HELP = {
    title: 'Probation Reviews — รีวิวพนักงานทดลองงาน',
    subtitle: 'Sheet: 33_Probation_Reviews',
    intro: 'ติดตามและบันทึกผลรีวิวพนักงานทดลองงานตามรอบ 30 / 60 / 90 / 120 วัน เกณฑ์รีวิวอ่านจาก position config (config ได้จาก Probation Criteria Manager)',
    sections: [
      {
        title: 'การใช้งาน',
        items: [
          'แท็บ Due/Overdue — รีวิวที่ถึงกำหนด/เลยกำหนด ต้องทำก่อน',
          'แท็บ Completed — รีวิวที่บันทึกผลแล้ว (ดูประวัติ)',
          'แท็บ All — รวมพนักงานในช่วงทดลองทั้งหมด',
          'คลิกพนักงาน → กรอกคะแนน + comments + outcome (Pass / Extend / Fail)',
        ],
      },
      {
        title: 'Outcome',
        items: [
          'Pass — ผ่านทดลอง บรรจุพนักงานประจำ',
          'Extend — ขยายช่วงทดลอง (เช่น +30 วัน)',
          'Fail — ไม่ผ่าน เลิกจ้าง',
        ],
      },
      {
        type: 'warn',
        title: 'ระวัง',
        items: [
          'หัวข้อรีวิวต่อตำแหน่ง config ได้ที่ Probation Criteria Manager',
          'หากตำแหน่งไม่มี criteria — fallback ใช้เกณฑ์มาตรฐาน (คะแนนรวม)',
          'บน dashboard นี้: เกณฑ์ประเมินรายข้อยังไม่พร้อม → กรอกคะแนนรวมแทน',
        ],
      },
    ],
  };

  $id('refresh-btn').innerHTML = ICONS.refresh;
  $id('section-icon').innerHTML = ICONS.user;
  $id('help-btn').innerHTML = ICONS.help;
  $id('tab-due').innerHTML = ICONS.bell + ' Due / Overdue <span class="count" id="cnt-due">—</span>';
  $id('tab-completed').innerHTML = ICONS.list + ' Completed <span class="count" id="cnt-completed">—</span>';
  $id('tab-all').innerHTML = ICONS.users + ' All Probation <span class="count" id="cnt-all">—</span>';

  function setTab(tab) {
    currentTab = tab;
    ['due', 'completed', 'all'].forEach(t => {
      $id('tab-' + t).classList.toggle('active', t === tab);
    });
    const titles = {
      due: ['Reviews ที่ใกล้ถึง', 'รีวิวที่ต้องทำใน 30 วัน + overdue'],
      completed: ['Reviews ที่เสร็จแล้ว', 'ประวัติทั้งหมดเรียงตามวันที่'],
      all: ['พนักงานทดลองงาน', 'รายชื่อพนักงาน status=probation + milestones ที่ผ่านมา'],
    };
    $id('section-title').textContent = titles[tab][0];
    $id('section-sub').textContent = titles[tab][1];
    if (currentData) renderTab();
  }

  function loadCurrent() {
    $id('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(d => {
        currentData = d;
        populateBranches(d.branches || []);
        renderStats(d.stats || {});
        renderTab();
      })
      .withFailureHandler(e => showToast('Error: ' + (e && e.message ? e.message : e), 'error'))
      .probationAdminList({ branch_id: $id('filter-branch').value || undefined });
  }

  function populateBranches(branches) {
    const sel = $id('filter-branch');
    if (sel.children.length > 1) return;
    branches.forEach(b => {
      sel.innerHTML += `<option value="${escapeAttr(b.id)}">${escapeAttr(b.id)} — ${escapeHtml(b.name)}</option>`;
    });
  }

  function renderStats(s) {
    $id('cnt-due').textContent = (currentData.due || []).length;
    $id('cnt-completed').textContent = (currentData.completed || []).length;
    $id('cnt-all').textContent = (currentData.probation || []).length;
    // sidebar badge = จำนวน due (ที่ต้องทำ)
    const ct = document.getElementById('ct-probreview');
    if (ct) ct.textContent = (currentData.due || []).length || '';
    $id('stats').innerHTML = [
      statCard('Probation', s.probation_employees, 'พนักงานทดลอง', 'var(--navy)'),
      statCard('Due ≤7d', s.due_soon, 'ใกล้ถึง', 'var(--warning)'),
      statCard('Overdue', s.overdue, 'เลย deadline', s.overdue > 0 ? 'var(--danger)' : 'var(--text-faint)'),
      statCard('Completed', s.completed_total, 'รีวิวเสร็จแล้ว', 'var(--success)'),
      statCard('Last 30d', s.last_30d, 'เพิ่งทำ', 'var(--info)'),
    ].join('');
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  function renderTab() {
    if (currentTab === 'due') renderDue();
    else if (currentTab === 'completed') renderCompleted();
    else renderAllProbation();
  }

  function renderDue() {
    const rows = currentData.due || [];
    if (rows.length === 0) {
      $id('content').innerHTML = '<div class="empty"><div class="empty-icon">' + ICONS.user + '</div><div class="empty-title">ไม่มี review ที่ใกล้ถึง</div><div class="empty-sub">ทุก milestone ทำเสร็จแล้ว หรือยังไม่ถึง 30 วันก่อน</div></div>';
      return;
    }

    const trs = rows.map(r => {
      const trClass = r.is_overdue ? 'is-overdue' : (r.days_to_review != null && r.days_to_review <= 7 ? 'due-soon' : '');
      const daysClass = r.is_overdue ? 'days-overdue' :
        (r.days_to_review != null && r.days_to_review <= 7 ? 'days-soon' : 'days-future');
      const daysText = r.days_to_review == null ? '—' :
        r.is_overdue ? 'เลย ' + Math.abs(r.days_to_review) + ' วัน' :
        r.days_to_review === 0 ? 'วันนี้' :
        'อีก ' + r.days_to_review + ' วัน';
      return [
        '<tr class="' + trClass + '" onclick="openReview(\'' + escapeAttr(r.employee_id) + '\', ' + r.milestone_days + ', \'' + escapeAttr(r.review_id || '') + '\')">',
          '<td>',
            '<div style="font-weight:500">' + escapeHtml(r.employee_name) + '</div>',
            '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + escapeHtml(r.employee_id) + ' · ' + escapeHtml(r.branch_id) + '</div>',
          '</td>',
          '<td><span class="ms-badge ms-' + r.milestone_days + '">วันที่ ' + r.milestone_days + '</span></td>',
          '<td style="font-size:12px">เริ่ม: <strong>' + escapeHtml(r.start_date || '—') + '</strong></td>',
          '<td style="font-size:12px">' + escapeHtml(r.due_date || '—') + '</td>',
          '<td><span class="days-badge ' + daysClass + '">' + daysText + '</span></td>',
          '<td onclick="event.stopPropagation()" style="text-align:right">',
            '<button class="btn btn-sm btn-primary" onclick="openReview(\'' + escapeAttr(r.employee_id) + '\', ' + r.milestone_days + ', \'' + escapeAttr(r.review_id || '') + '\')">รีวิว</button>',
          '</td>',
        '</tr>',
      ].join('');
    }).join('');

    $id('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th>พนักงาน</th><th style="width:90px">Milestone</th>',
          '<th>วันเริ่มงาน</th><th>Due date</th>',
          '<th style="width:120px">Days</th><th style="width:100px"></th>',
        '</tr></thead>',
        '<tbody>' + trs + '</tbody>',
      '</table>',
    ].join('');
  }

  function renderCompleted() {
    const rows = (currentData.completed || []).slice().sort((a, b) =>
      String(b.review_date || '').localeCompare(String(a.review_date || '')));
    if (rows.length === 0) {
      $id('content').innerHTML = '<div class="empty"><div class="empty-icon">' + ICONS.list + '</div><div class="empty-title">ยังไม่มีรีวิวที่เสร็จ</div></div>';
      return;
    }

    const trs = rows.map(r => {
      const score = Number(r.score) || 0;
      const scoreClass = score >= 80 ? '' : (score >= 60 ? 'low' : 'poor');
      const outcomeClass = 'outcome-' + (r.outcome === 'pass' ? 'pass' : r.outcome === 'fail' ? 'fail' : 'extend');
      return [
        '<tr onclick="viewCompletedDetail(\'' + escapeAttr(r.review_id) + '\')">',
          '<td>',
            '<div style="font-weight:500">' + escapeHtml(r.employee_name) + '</div>',
            '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + escapeHtml(r.employee_id) + ' · ' + escapeHtml(r.branch_id) + '</div>',
          '</td>',
          '<td><span class="ms-badge ms-' + r.milestone_days + '">วันที่ ' + r.milestone_days + '</span></td>',
          '<td>',
            '<div class="score-bar">',
              '<span class="score-num">' + escapeHtml(String(r.score != null && r.score !== '' ? r.score : '–')) + '</span>',
              '<div class="score-bar-bg"><div class="score-bar-fill ' + scoreClass + '" style="width:' + Math.min(100, score) + '%"></div></div>',
            '</div>',
          '</td>',
          '<td><span class="outcome-pill ' + outcomeClass + '">' + escapeHtml(r.outcome || '—') + '</span></td>',
          '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(r.review_date || '—') + '</td>',
          '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(r.reviewer_name || '—') + '</td>',
          '<td style="font-size:11px;color:var(--text-muted)">' + escapeHtml(r.comment || '—') + '</td>',
        '</tr>',
      ].join('');
    }).join('');

    $id('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th>พนักงาน</th><th style="width:90px">Milestone</th>',
          '<th style="width:160px">คะแนน</th><th style="width:90px">Outcome</th>',
          '<th>วันที่</th><th>Reviewer</th><th>Comment</th>',
        '</tr></thead>',
        '<tbody>' + trs + '</tbody>',
      '</table>',
    ].join('');
  }

  function renderAllProbation() {
    const rows = currentData.probation || [];
    if (rows.length === 0) {
      $id('content').innerHTML = '<div class="empty"><div class="empty-icon">' + ICONS.users + '</div><div class="empty-title">ไม่มีพนักงานทดลองงาน</div></div>';
      return;
    }

    const trs = rows.map(p => {
      const milestones = [30, 60, 90, 120];
      const dotsHtml = milestones.map(ms => {
        const done = (p.completed_milestones || []).includes(ms);
        return '<div class="ms-dot ' + (done ? 'done' : 'pending') + '" title="' + ms + ' วัน">' + ms + '</div>';
      }).join('');
      return [
        '<tr>',
          '<td>',
            '<div style="font-weight:500">' + escapeHtml(p.employee_name) + '</div>',
            '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + escapeHtml(p.employee_id) + ' · ' + escapeHtml(p.branch_id) + '</div>',
          '</td>',
          '<td>' + escapeHtml(p.start_date || '—') + '</td>',
          '<td>' + (p.days_since_start != null ? '<strong>' + escapeHtml(String(p.days_since_start)) + '</strong> วัน' : '—') + '</td>',
          '<td><div class="ms-progress">' + dotsHtml + '</div></td>',
          '<td>' + (p.next_milestone ? '<span class="ms-badge ms-' + p.next_milestone + '">วันที่ ' + p.next_milestone + '</span>' : '<span style="color:var(--text-faint)">เสร็จครบ</span>') + '</td>',
          '<td onclick="event.stopPropagation()" style="text-align:right">',
            p.next_milestone ? '<button class="btn btn-sm" onclick="scheduleNew(\'' + escapeAttr(p.employee_id) + '\', ' + p.next_milestone + ')">Schedule</button>' : '',
          '</td>',
        '</tr>',
      ].join('');
    }).join('');

    $id('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th>พนักงาน</th><th>วันเริ่มงาน</th><th style="width:90px">Days</th>',
          '<th>Milestones progress</th><th>Next</th><th style="width:100px"></th>',
        '</tr></thead>',
        '<tbody>' + trs + '</tbody>',
      '</table>',
    ].join('');
  }

  // === Review modal ===
  function openReview(empId, milestone, existingReviewId) {
    if (existingReviewId) {
      // Has pending review row — load it
      google.script.run
        .withSuccessHandler(d => showReviewForm(d))
        .withFailureHandler(e => showToast('Error: ' + (e && e.message ? e.message : e), 'error'))
        .probationAdminGetDetail(existingReviewId);
    } else {
      // Schedule first, then load
      google.script.run
        .withSuccessHandler(r => {
          if (r && r.error) { showToast(r.error, 'error'); return; }
          google.script.run
            .withSuccessHandler(d => showReviewForm(d))
            .probationAdminGetDetail(r.id);
        })
        .withFailureHandler(e => showToast('Error: ' + (e && e.message ? e.message : e), 'error'))
        .probationAdminSchedule(empId, milestone);
    }
  }

  function showReviewForm(d) {
    if (!d || d.error) { showToast(d ? d.error : 'error', 'error'); return; }
    currentReviewId = d.review_id;
    selectedOutcome = d.outcome || null;
    // store criteria for dynamic scoring
    window._prCurrentCriteria = d.criteria || [];

    $id('modal-title').textContent =
      'รีวิว ' + d.employee_name + ' · วันที่ ' + d.milestone_days;
    $id('modal-sub').textContent =
      'เริ่มงาน: ' + d.employee_start_date + ' · ' + d.employee_position + ' · ' + d.employee_branch;

    const total = d.score || 0;
    const scores = d.scores || {};

    // render score rows from dynamic criteria
    const criteriaHtml = (d.criteria || []).map(c => {
      const value = scores[c.criterion_key] || 0;
      return scoreRow(c.criterion_key, c.criterion_name + ' (' + c.weight + '%)',
        value, c.description);
    }).join('');

    $id('modal-body').innerHTML = [
      '<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">',
        '<span>คะแนน ' + (d.criteria || []).length + ' มิติ (0-100, weighted)</span>',
        '<span style="font-size:10px;color:var(--text-faint);text-transform:none;letter-spacing:0">criteria จาก: ' + escapeHtml(d.employee_position || 'default') + '</span>',
      '</div>',
      criteriaHtml,

      '<div class="total-score" id="total-score">',
        '<div class="total-score-num" id="total-num">' + total.toFixed(1) + '</div>',
        '<div class="total-score-label">คะแนนรวม (weighted)</div>',
      '</div>',

      '<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Outcome</div>',
      '<div class="outcome-row">',
        '<button class="outcome-btn ' + (d.outcome === 'pass' ? 'selected' : '') + '" data-val="pass" onclick="selectOutcome(\'pass\')">',
          '<div class="outcome-btn-label">Pass</div>',
          '<div class="outcome-btn-desc">ผ่าน probation</div>',
        '</button>',
        '<button class="outcome-btn ' + (d.outcome === 'extend' ? 'selected' : '') + '" data-val="extend" onclick="selectOutcome(\'extend\')">',
          '<div class="outcome-btn-label">Extend</div>',
          '<div class="outcome-btn-desc">ต่อ probation</div>',
        '</button>',
        '<button class="outcome-btn ' + (d.outcome === 'fail' ? 'selected' : '') + '" data-val="fail" onclick="selectOutcome(\'fail\')">',
          '<div class="outcome-btn-label">Fail</div>',
          '<div class="outcome-btn-desc">ไม่ผ่าน</div>',
        '</button>',
      '</div>',

      '<div class="field">',
        '<label>Comment / หมายเหตุ</label>',
        '<textarea id="m-comment" placeholder="ข้อสังเกต + คำแนะนำ" style="min-height:70px">' + escapeHtml(d.comment) + '</textarea>',
      '</div>',
    ].join('');

    // Wire score input listeners for dynamic criteria
    (window._prCurrentCriteria || []).forEach(c => {
      const el = $id('s-' + c.criterion_key);
      if (el) el.addEventListener('input', updateTotalScore);
    });

    // Footer
    if (d.is_completed) {
      $id('modal-footer').innerHTML = [
        '<div style="font-size:12px;color:var(--text-muted);margin-right:auto">รีวิวเสร็จแล้ว — แก้ได้</div>',
        '<button class="btn" onclick="closeModal()">ปิด</button>',
        '<button class="btn btn-primary" onclick="submitReview()">บันทึกใหม่</button>',
      ].join('');
    } else {
      $id('modal-footer').innerHTML = [
        '<button class="btn" onclick="closeModal()">ปิด</button>',
        '<button class="btn btn-primary" onclick="submitReview()">บันทึก</button>',
      ].join('');
    }

    $id('modal-bg').classList.add('active');
  }

  function scoreRow(key, label, value, hint) {
    return [
      '<div class="score-row">',
        '<div>',
          '<div class="score-label">' + escapeHtml(label) + '</div>',
          '<div class="score-hint">' + escapeHtml(hint || '') + '</div>',
        '</div>',
        '<div class="score-input"><input type="number" id="s-' + escapeAttr(key) + '" min="0" max="100" value="' + (value || 0) + '"></div>',
        '<div style="font-size:11px;color:var(--text-muted);text-align:right">/ 100</div>',
      '</div>',
    ].join('');
  }

  function selectOutcome(val) {
    selectedOutcome = val;
    PR_ROOT.querySelectorAll('.outcome-btn').forEach(b => {
      b.classList.toggle('selected', b.getAttribute('data-val') === val);
    });
  }

  function updateTotalScore() {
    // weighted average using criteria weights
    const criteria = window._prCurrentCriteria || [];
    let totalScore = 0, totalWeight = 0;
    criteria.forEach(c => {
      const el = $id('s-' + c.criterion_key);
      const v = el ? Number(el.value || 0) : 0;
      totalScore += v * c.weight;
      totalWeight += c.weight;
    });
    const avg = totalWeight > 0 ? totalScore / totalWeight : 0;
    const el = $id('total-num');
    if (el) el.textContent = avg.toFixed(1);
  }

  function submitReview() {
    if (!selectedOutcome) { showToast('เลือก outcome ก่อน (pass/extend/fail)', 'error'); return; }
    // collect scores from dynamic criteria
    const scores = {};
    (window._prCurrentCriteria || []).forEach(c => {
      const el = $id('s-' + c.criterion_key);
      scores[c.criterion_key] = el ? Number(el.value || 0) : 0;
    });
    const comment = $id('m-comment').value.trim();

    const btn = PR_ROOT.querySelector('#modal-footer .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }

    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; } showToast(r.error, 'error'); return; }
        showToast('บันทึกแล้ว — outcome: ' + selectedOutcome, 'success');
        closeModal();
        loadCurrent();
      })
      .withFailureHandler(e => { if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; } showToast('Error: ' + (e && e.message ? e.message : e), 'error'); })
      .probationAdminSubmit(currentReviewId, scores, selectedOutcome, comment);
  }

  function viewCompletedDetail(reviewId) {
    google.script.run
      .withSuccessHandler(d => showReviewForm(d))
      .withFailureHandler(e => showToast('Error: ' + (e && e.message ? e.message : e), 'error'))
      .probationAdminGetDetail(reviewId);
  }

  function scheduleNew(empId, milestone) {
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        // dashboard: schedule = สังเคราะห์ → เปิดฟอร์มรีวิวเลย (ไม่มี schedule row จริง)
        openReview(empId, milestone, '');
      })
      .withFailureHandler(e => showToast('Error: ' + (e && e.message ? e.message : e), 'error'))
      .probationAdminSchedule(empId, milestone);
  }

  function closeModal() { $id('modal-bg').classList.remove('active'); }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    HELP, showHelp, setTab, loadCurrent, openReview, viewCompletedDetail,
    scheduleNew, selectOutcome, submitReview, closeModal,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  setTab('due');
  loadCurrent();
}
