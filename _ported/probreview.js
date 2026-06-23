/* probreview.js — native port ของหน้า desktop "probation_manager.html" (HR Announcement admin)
 * ลอก markup + CSS เดิมเป๊ะ · scoped ทั้งหมดใต้ #pr (กันชน CSS dashboard) · element id prefix pr-
 * ใช้ global ที่มีอยู่แล้วใน index.html: sb (supabase client) + esc (html-escape) — ห้าม redeclare
 * mount จุดเดียว: mountProbreview() → render ลง #wrap-probreview
 *
 * โครงหน้า desktop ที่ลอกมา:
 *   - tab toggle: Due/Overdue · Completed · All Probation  (ตัดจาก 3 list ของ desktop → derive client-side จาก items เดียว)
 *   - stats cards (5): Probation / Due ≤7d / Overdue / Completed / Last 30d  (คำนวณ client-side จาก items)
 *   - filters: สาขา (client-side)
 *   - data-table แต่ละ tab + ms-badge / score-bar / outcome-pill / ms-progress (CSS เดิม)
 *   - review modal: score รวม (0-100) + outcome (pass/extend/fail) + comment → POST
 *
 * Backend contract (native — ต่างจาก desktop ที่ใช้ google.script.run หลายฟังก์ชัน):
 *   list  = sb.functions.invoke('hr_probation_review') → { items:[...] }
 *           item: { employee_id, milestone_days, result, score, comments, status, reviewed_by,
 *                   employee_name?, branch_id?, start_date?, review_date?, due_date? }
 *   save  = sb.functions.invoke('hr_probation_review', { body:{
 *             employee_id, milestone_days, result, score, comments, review_date } })
 *           milestone_days: 30|60|90|120 · result: pass|extend|fail
 *
 * หมายเหตุ: native ไม่มี endpoint schedule/get-detail แยกแบบ desktop → ปุ่ม "รีวิว" เปิด modal ฟอร์ม
 *           แล้ว POST ผ่าน body เดียว (employee_id + milestone_days เป็น key).
 */

var PR_FN = 'hr_probation_review';

// state เฉพาะหน้านี้ (prefix pr)
var _prState = {
  tab: 'due',          // 'due' | 'completed' | 'all'
  items: [],           // raw items จาก backend
  filterBranch: '',
  busy: false,         // กัน double submit
  outcome: null,       // outcome ที่เลือกใน modal
};

// ---- helpers ----------------------------------------------------------------

function prStatus(r) { return String(r.status || '').toLowerCase(); }
function prResultOf(r) { return String(r.result || r.outcome || '').toLowerCase(); }

// item ถือว่า "completed" เมื่อมีผล (result) แล้ว
function prIsCompleted(r) {
  return !!prResultOf(r) || prStatus(r) === 'completed' || prStatus(r) === 'reviewed';
}

function prDaysTo(r) {
  // ถ้า backend ส่ง days_to_review มาให้ใช้เลย · ไม่งั้นคำนวณจาก due_date
  if (r.days_to_review != null && r.days_to_review !== '') return Number(r.days_to_review);
  var due = r.due_date || r.review_due || '';
  if (!due) return null;
  var d = new Date(due);
  if (isNaN(d.getTime())) return null;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function prIsOverdue(r) {
  if (r.is_overdue != null) return !!r.is_overdue;
  var dt = prDaysTo(r);
  return dt != null && dt < 0;
}

function prEmpName(r) { return r.employee_name || r.employee_id || '—'; }

// ---- mount ------------------------------------------------------------------

function mountProbreview() {
  var wrap = document.getElementById('wrap-probreview');
  if (!wrap) return;

  wrap.innerHTML = `
<style>
#pr{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px}

/* tab toggle */
#pr .tab-row{display:flex;gap:6px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;width:fit-content}
#pr .tab-btn{padding:7px 14px;border:none;background:transparent;border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}
#pr .tab-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}
#pr .tab-btn svg{width:14px;height:14px}
#pr .tab-btn .count{font-size:10px;padding:1px 7px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}
#pr .tab-btn.active .count{background:var(--navy)}

/* stats */
#pr .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px}
#pr .stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;position:relative;overflow:hidden;transition:border .15s}
#pr .stat:hover{border-color:var(--border-strong)}
#pr .stat-stripe{position:absolute;top:0;left:0;bottom:0;width:3px}
#pr .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}
#pr .stat-value{font-size:26px;font-weight:600;color:var(--text);margin-top:4px;letter-spacing:-.03em;line-height:1}
#pr .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}
@media (max-width:768px){#pr .stats{grid-template-columns:repeat(2,1fr)}}

/* filters */
#pr .filters{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:14px}
#pr .filter{display:flex;flex-direction:column;gap:4px}
#pr .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#pr .filter select{height:32px;box-sizing:border-box;padding:0 28px 0 10px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);min-width:140px;cursor:pointer;appearance:none;background:var(--surface) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2'><polyline points='6,9 12,15 18,9'/></svg>") no-repeat right 8px center;background-size:14px}
#pr .filter select:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}

/* section */
#pr .section{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03)}
#pr .section-header{padding:12px 18px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
#pr .section-icon{width:30px;height:30px;border-radius:6px;background:var(--info-bg);color:var(--info);display:flex;align-items:center;justify-content:center}
#pr .section-icon svg{width:16px;height:16px}
#pr .section-title{font-size:13px;font-weight:600;color:var(--text)}
#pr .section-sub{font-size:11px;color:var(--text-muted)}

/* data table */
#pr .data-table{width:100%;border-collapse:collapse;font-size:13px}
#pr .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}
#pr .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}
#pr .data-table tbody tr{border-left:3px solid transparent;transition:background .15s;cursor:pointer}
#pr .data-table tbody tr:hover{background:#FAFBFC}
#pr .data-table tbody tr.is-overdue{border-left-color:var(--danger);background:#FEF2F2}
#pr .data-table tbody tr.due-soon{border-left-color:var(--warning)}

/* milestone badge */
#pr .ms-badge{display:inline-block;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:600;font-family:monospace}
#pr .ms-30{background:#DBEAFE;color:#1E40AF}
#pr .ms-60{background:#DCFCE7;color:#15803D}
#pr .ms-90{background:#FEF3C7;color:#B45309}
#pr .ms-120{background:#FCE7F3;color:#BE185D}

/* days badge */
#pr .days-badge{display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600}
#pr .days-overdue{background:var(--danger-bg);color:var(--danger)}
#pr .days-soon{background:var(--warning-bg);color:var(--warning)}
#pr .days-future{background:var(--success-bg);color:var(--success)}

/* outcome pill */
#pr .outcome-pill{padding:2px 9px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
#pr .outcome-pass{background:var(--success-bg);color:var(--success)}
#pr .outcome-fail{background:var(--danger-bg);color:var(--danger)}
#pr .outcome-extend{background:var(--warning-bg);color:var(--warning)}

/* score bar */
#pr .score-bar{display:inline-flex;align-items:center;gap:6px}
#pr .score-num{font-weight:600;font-size:13px;min-width:30px}
#pr .score-bar-bg{width:80px;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden}
#pr .score-bar-fill{height:100%;background:var(--success);border-radius:3px;transition:width .3s}
#pr .score-bar-fill.low{background:var(--warning)}
#pr .score-bar-fill.poor{background:var(--danger)}

/* milestone progress dots */
#pr .ms-progress{display:flex;gap:4px;align-items:center}
#pr .ms-dot{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;font-family:monospace}
#pr .ms-dot.done{background:var(--success);color:#fff}
#pr .ms-dot.pending{background:#F1F5F9;color:var(--text-muted)}

/* buttons */
#pr .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}
#pr .btn:hover{border-color:var(--navy)}
#pr .btn-sm{padding:5px 10px;font-size:12px}
#pr .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}
#pr .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}
#pr .btn[disabled]{opacity:.5;cursor:not-allowed}

/* empty / loading */
#pr .empty{text-align:center;padding:40px 20px;color:var(--text-muted)}
#pr .empty-icon{width:48px;height:48px;border-radius:12px;background:#F1F5F9;color:var(--text-faint);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px}
#pr .empty-icon svg{width:24px;height:24px}
#pr .empty-title{font-size:14px;font-weight:600;color:var(--text)}
#pr .empty-sub{font-size:12px;color:var(--text-muted);margin-top:4px}
#pr .loading{padding:40px;text-align:center;color:var(--text-muted)}

/* score modal */
#pr .score-row{display:grid;grid-template-columns:1fr 90px;gap:12px;align-items:center;padding:10px 12px;background:#F8FAFC;border-radius:8px;margin-bottom:8px}
#pr .score-label{font-size:13px;font-weight:500}
#pr .score-hint{font-size:11px;color:var(--text-muted)}
#pr .score-input input{width:100%;padding:7px 10px;border:1px solid var(--border-strong);border-radius:6px;font-size:13px;font-family:monospace;text-align:center;box-sizing:border-box}
#pr .total-score{padding:14px;background:var(--info-bg);color:var(--info);border-radius:8px;text-align:center;margin:14px 0}
#pr .total-score-num{font-size:28px;font-weight:600;letter-spacing:-.03em}
#pr .total-score-label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#pr .outcome-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px}
#pr .outcome-btn{padding:12px;border:2px solid var(--border);background:#fff;border-radius:8px;cursor:pointer;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:4px;font-family:inherit}
#pr .outcome-btn:hover{border-color:var(--navy)}
#pr .outcome-btn-label{font-size:14px;font-weight:600}
#pr .outcome-btn-desc{font-size:11px;color:var(--text-muted)}
#pr .outcome-btn[data-val="pass"].selected{border-color:var(--success);background:var(--success-bg)}
#pr .outcome-btn[data-val="fail"].selected{border-color:var(--danger);background:var(--danger-bg)}
#pr .outcome-btn[data-val="extend"].selected{border-color:var(--warning);background:var(--warning-bg)}

/* field */
#pr .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}
#pr .field label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#pr .field textarea{padding:9px 12px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);min-height:70px;resize:vertical;box-sizing:border-box}
#pr .field textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}

/* modal */
#pr .pr-modal-bg{display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
#pr .pr-modal-bg.active{display:flex}
#pr .pr-modal{background:var(--surface);border-radius:12px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(0,0,0,.25)}
#pr .pr-modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}
#pr .pr-modal-header h2{font-size:16px;font-weight:600;color:var(--text);margin:0;letter-spacing:-.01em}
#pr .pr-modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}
#pr .pr-modal-body{padding:20px 24px;flex:1;overflow-y:auto}
#pr .pr-modal-footer{padding:14px 24px;border-top:1px solid var(--border);background:#F8FAFC;display:flex;justify-content:flex-end;gap:8px}
</style>
<div id="pr">

  <div class="tab-row">
    <button class="tab-btn active" id="pr-tab-due">${prIcon('bell')} Due / Overdue <span class="count" id="pr-cnt-due">—</span></button>
    <button class="tab-btn" id="pr-tab-completed">${prIcon('list')} Completed <span class="count" id="pr-cnt-completed">—</span></button>
    <button class="tab-btn" id="pr-tab-all">${prIcon('users')} All Probation <span class="count" id="pr-cnt-all">—</span></button>
  </div>

  <div class="stats" id="pr-stats"></div>

  <div class="filters">
    <div class="filter">
      <label>สาขา</label>
      <select id="pr-f-branch"><option value="">ทุกสาขา</option></select>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <div class="section-icon">${prIcon('user')}</div>
      <div style="flex:1">
        <div class="section-title" id="pr-sec-title">Reviews ที่ใกล้ถึง</div>
        <div class="section-sub" id="pr-sec-sub">รีวิวที่ต้องทำใน 30 วัน + overdue</div>
      </div>
      <button class="btn btn-sm" id="pr-refresh">${prIcon('refresh')} รีเฟรช</button>
    </div>
    <div id="pr-content" class="loading">กำลังโหลด...</div>
  </div>

  <!-- Review Modal -->
  <div class="pr-modal-bg" id="pr-modal-bg">
    <div class="pr-modal">
      <div class="pr-modal-header">
        <h2 id="pr-modal-title">บันทึกผลรีวิว</h2>
        <p id="pr-modal-sub"></p>
      </div>
      <div class="pr-modal-body" id="pr-modal-body"></div>
      <div class="pr-modal-footer" id="pr-modal-footer">
        <button class="btn" id="pr-modal-close">ปิด</button>
      </div>
    </div>
  </div>

</div>`;

  // reset state ทุกครั้งที่ mount
  _prState.tab = 'due';
  _prState.filterBranch = '';
  _prState.busy = false;
  _prState.outcome = null;

  // bind tabs
  document.getElementById('pr-tab-due').onclick = function () { prSetTab('due'); };
  document.getElementById('pr-tab-completed').onclick = function () { prSetTab('completed'); };
  document.getElementById('pr-tab-all').onclick = function () { prSetTab('all'); };
  // bind filter
  document.getElementById('pr-f-branch').onchange = function () {
    _prState.filterBranch = this.value; prRender();
  };
  document.getElementById('pr-refresh').onclick = prLoad;
  // modal
  document.getElementById('pr-modal-close').onclick = prCloseModal;
  document.getElementById('pr-modal-bg').onclick = function (e) {
    if (e.target === this) prCloseModal();
  };

  prLoad();
}

// inline SVG icons (เลียน ICONS ของ desktop — ตัดมาเฉพาะที่ใช้)
function prIcon(name) {
  var p = {
    bell: '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    users: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
    user: '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
  }[name] || '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
}

// ---- tabs -------------------------------------------------------------------

function prSetTab(tab) {
  _prState.tab = tab;
  ['due', 'completed', 'all'].forEach(function (t) {
    document.getElementById('pr-tab-' + t).classList.toggle('active', t === tab);
  });
  var titles = {
    due: ['Reviews ที่ใกล้ถึง', 'รีวิวที่ต้องทำใน 30 วัน + overdue'],
    completed: ['Reviews ที่เสร็จแล้ว', 'ประวัติทั้งหมดเรียงตามวันที่'],
    all: ['พนักงานทดลองงาน', 'รายชื่อพนักงาน status=probation + milestones ที่ผ่านมา'],
  };
  document.getElementById('pr-sec-title').textContent = titles[tab][0];
  document.getElementById('pr-sec-sub').textContent = titles[tab][1];
  prRender();
}

// ---- data load --------------------------------------------------------------

async function prLoad() {
  var content = document.getElementById('pr-content');
  if (content) { content.className = 'loading'; content.textContent = 'กำลังโหลด...'; }
  try {
    var res = await sb.functions.invoke(PR_FN);
    var data = res && res.data;
    _prState.items = (data && data.items) || [];
  } catch (e) {
    console.error('prLoad', e);
    _prState.items = [];
    if (content) { content.className = 'empty'; content.textContent = 'โหลดข้อมูลไม่สำเร็จ'; }
  }
  prPopulateBranches();
  prRender();
}

function prPopulateBranches() {
  var sel = document.getElementById('pr-f-branch');
  if (!sel || sel.children.length > 1) return;
  var seen = {};
  _prState.items.forEach(function (r) {
    var b = (r.branch_id || '').trim();
    if (b && !seen[b]) seen[b] = true;
  });
  Object.keys(seen).sort().forEach(function (b) {
    var o = document.createElement('option');
    o.value = b; o.textContent = b;
    sel.appendChild(o);
  });
}

// ---- filter / group ---------------------------------------------------------

function prByBranch(r) {
  return !_prState.filterBranch || (r.branch_id || '') === _prState.filterBranch;
}

// due = ยังไม่มีผล (pending review) + กรองสาขา
function prDueItems() {
  return _prState.items.filter(function (r) {
    return prByBranch(r) && !prIsCompleted(r);
  });
}

// completed = มีผลแล้ว
function prCompletedItems() {
  return _prState.items.filter(function (r) {
    return prByBranch(r) && prIsCompleted(r);
  });
}

// all probation = group ตามพนักงาน → milestones ที่ทำไปแล้ว
function prAllProbation() {
  var byEmp = {};
  _prState.items.filter(prByBranch).forEach(function (r) {
    var id = r.employee_id || '';
    if (!byEmp[id]) {
      byEmp[id] = {
        employee_id: id,
        employee_name: r.employee_name || id,
        branch_id: r.branch_id || '',
        start_date: r.start_date || '',
        days_since_start: r.days_since_start,
        completed_milestones: [],
      };
    }
    if (prIsCompleted(r)) {
      var ms = Number(r.milestone_days);
      if (ms && byEmp[id].completed_milestones.indexOf(ms) === -1) {
        byEmp[id].completed_milestones.push(ms);
      }
    }
  });
  return Object.keys(byEmp).map(function (k) {
    var p = byEmp[k];
    p.next_milestone = [30, 60, 90, 120].find(function (m) {
      return p.completed_milestones.indexOf(m) === -1;
    }) || null;
    return p;
  });
}

// ---- render -----------------------------------------------------------------

function prRender() {
  // counts ทุก tab (ก่อนกรองสาขา? ใช้กรองสาขาด้วยให้ตรงกับที่แสดง)
  document.getElementById('pr-cnt-due').textContent = prDueItems().length;
  document.getElementById('pr-cnt-completed').textContent = prCompletedItems().length;
  document.getElementById('pr-cnt-all').textContent = prAllProbation().length;
  // sidebar badge = จำนวน due (ที่ต้องทำ)
  var ct = document.getElementById('ct-probreview');
  if (ct) ct.textContent = prDueItems().length || '';

  prRenderStats();

  if (_prState.tab === 'due') prRenderDue();
  else if (_prState.tab === 'completed') prRenderCompleted();
  else prRenderAll();
}

function prStatCard(label, value, sub, color) {
  return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
    '<div class="stat-label">' + esc(label) + '</div>' +
    '<div class="stat-value">' + (value || 0) + '</div>' +
    '<div class="stat-sub">' + esc(sub) + '</div></div>';
}

function prRenderStats() {
  var due = prDueItems();
  var completed = prCompletedItems();
  var probEmployees = prAllProbation().length;
  var overdue = due.filter(prIsOverdue).length;
  var dueSoon = due.filter(function (r) {
    var dt = prDaysTo(r);
    return dt != null && dt >= 0 && dt <= 7;
  }).length;
  // last 30 วัน — completed ที่ review_date อยู่ใน 30 วัน
  var now = Date.now();
  var last30 = completed.filter(function (r) {
    var d = new Date(r.review_date || '');
    return !isNaN(d.getTime()) && (now - d.getTime()) <= 30 * 86400000;
  }).length;

  document.getElementById('pr-stats').innerHTML = [
    prStatCard('Probation', probEmployees, 'พนักงานทดลอง', 'var(--navy)'),
    prStatCard('Due ≤7d', dueSoon, 'ใกล้ถึง', 'var(--warning)'),
    prStatCard('Overdue', overdue, 'เลย deadline', overdue > 0 ? 'var(--danger)' : 'var(--text-faint)'),
    prStatCard('Completed', completed.length, 'รีวิวเสร็จแล้ว', 'var(--success)'),
    prStatCard('Last 30d', last30, 'เพิ่งทำ', 'var(--info)'),
  ].join('');
}

function prRenderDue() {
  var rows = prDueItems();
  var content = document.getElementById('pr-content');
  if (!rows.length) {
    content.className = '';
    content.innerHTML = '<div class="empty" style="padding:40px 20px"><div class="empty-icon">' + prIcon('user') + '</div><div class="empty-title">ไม่มี review ที่ใกล้ถึง</div><div class="empty-sub">ทุก milestone ทำเสร็จแล้ว หรือยังไม่ถึงรอบ</div></div>';
    return;
  }
  content.className = '';

  var trs = rows.map(function (r) {
    var dt = prDaysTo(r);
    var overdue = prIsOverdue(r);
    var trClass = overdue ? 'is-overdue' : (dt != null && dt <= 7 ? 'due-soon' : '');
    var daysClass = overdue ? 'days-overdue' : (dt != null && dt <= 7 ? 'days-soon' : 'days-future');
    var daysText = dt == null ? '—' :
      overdue ? 'เลย ' + Math.abs(dt) + ' วัน' :
      dt === 0 ? 'วันนี้' : 'อีก ' + dt + ' วัน';
    var ms = Number(r.milestone_days) || '';
    return [
      '<tr data-pr-emp="' + esc(r.employee_id || '') + '" data-pr-ms="' + esc(String(ms)) + '" class="' + trClass + '">',
        '<td>',
          '<div style="font-weight:500">' + esc(prEmpName(r)) + '</div>',
          '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + esc(r.employee_id || '') + (r.branch_id ? ' · ' + esc(r.branch_id) : '') + '</div>',
        '</td>',
        '<td><span class="ms-badge ms-' + esc(String(ms)) + '">วันที่ ' + esc(String(ms)) + '</span></td>',
        '<td style="font-size:12px">เริ่ม: <strong>' + esc(r.start_date || '—') + '</strong></td>',
        '<td style="font-size:12px">' + esc(r.due_date || '—') + '</td>',
        '<td><span class="days-badge ' + daysClass + '">' + daysText + '</span></td>',
        '<td data-pr-stop="1" style="text-align:right">',
          '<button class="btn btn-sm btn-primary" data-pr-review="1">รีวิว</button>',
        '</td>',
      '</tr>',
    ].join('');
  }).join('');

  content.innerHTML = [
    '<div style="overflow-x:auto"><table class="data-table">',
      '<thead><tr>',
        '<th>พนักงาน</th><th style="width:90px">Milestone</th>',
        '<th>วันเริ่มงาน</th><th>Due date</th>',
        '<th style="width:120px">Days</th><th style="width:100px"></th>',
      '</tr></thead>',
      '<tbody>' + trs + '</tbody>',
    '</table></div>',
  ].join('');

  prBindRows(content);
}

function prRenderCompleted() {
  var rows = prCompletedItems().slice().sort(function (a, b) {
    return String(b.review_date || '').localeCompare(String(a.review_date || ''));
  });
  var content = document.getElementById('pr-content');
  if (!rows.length) {
    content.className = '';
    content.innerHTML = '<div class="empty" style="padding:40px 20px"><div class="empty-icon">' + prIcon('list') + '</div><div class="empty-title">ยังไม่มีรีวิวที่เสร็จ</div></div>';
    return;
  }
  content.className = '';

  var trs = rows.map(function (r) {
    var score = Number(r.score) || 0;
    var scoreClass = score >= 80 ? '' : (score >= 60 ? 'low' : 'poor');
    var out = prResultOf(r);
    var outcomeClass = 'outcome-' + (out === 'pass' ? 'pass' : out === 'fail' ? 'fail' : 'extend');
    var ms = Number(r.milestone_days) || '';
    return [
      '<tr data-pr-emp="' + esc(r.employee_id || '') + '" data-pr-ms="' + esc(String(ms)) + '" data-pr-view="1">',
        '<td>',
          '<div style="font-weight:500">' + esc(prEmpName(r)) + '</div>',
          '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + esc(r.employee_id || '') + (r.branch_id ? ' · ' + esc(r.branch_id) : '') + '</div>',
        '</td>',
        '<td><span class="ms-badge ms-' + esc(String(ms)) + '">วันที่ ' + esc(String(ms)) + '</span></td>',
        '<td>',
          '<div class="score-bar">',
            '<span class="score-num">' + esc(String(r.score != null && r.score !== '' ? r.score : '–')) + '</span>',
            '<div class="score-bar-bg"><div class="score-bar-fill ' + scoreClass + '" style="width:' + Math.min(100, score) + '%"></div></div>',
          '</div>',
        '</td>',
        '<td><span class="outcome-pill ' + outcomeClass + '">' + esc(out || '—') + '</span></td>',
        '<td style="font-size:11px;color:var(--text-muted)">' + esc(r.review_date || '—') + '</td>',
        '<td style="font-size:11px;color:var(--text-muted)">' + esc(r.reviewed_by || r.reviewer_name || '—') + '</td>',
        '<td style="font-size:11px;color:var(--text-muted)">' + esc(r.comments || r.comment || '—') + '</td>',
      '</tr>',
    ].join('');
  }).join('');

  content.innerHTML = [
    '<div style="overflow-x:auto"><table class="data-table">',
      '<thead><tr>',
        '<th>พนักงาน</th><th style="width:90px">Milestone</th>',
        '<th style="width:160px">คะแนน</th><th style="width:90px">Outcome</th>',
        '<th>วันที่</th><th>Reviewer</th><th>Comment</th>',
      '</tr></thead>',
      '<tbody>' + trs + '</tbody>',
    '</table></div>',
  ].join('');

  prBindRows(content);
}

function prRenderAll() {
  var rows = prAllProbation();
  var content = document.getElementById('pr-content');
  if (!rows.length) {
    content.className = '';
    content.innerHTML = '<div class="empty" style="padding:40px 20px"><div class="empty-icon">' + prIcon('users') + '</div><div class="empty-title">ไม่มีพนักงานทดลองงาน</div></div>';
    return;
  }
  content.className = '';

  var trs = rows.map(function (p) {
    var dots = [30, 60, 90, 120].map(function (ms) {
      var done = p.completed_milestones.indexOf(ms) !== -1;
      return '<div class="ms-dot ' + (done ? 'done' : 'pending') + '" title="' + ms + ' วัน">' + ms + '</div>';
    }).join('');
    var next = p.next_milestone;
    return [
      '<tr data-pr-emp="' + esc(p.employee_id) + '" data-pr-ms="' + esc(String(next || '')) + '"' + (next ? '' : ' style="cursor:default"') + '>',
        '<td>',
          '<div style="font-weight:500">' + esc(p.employee_name) + '</div>',
          '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + esc(p.employee_id) + (p.branch_id ? ' · ' + esc(p.branch_id) : '') + '</div>',
        '</td>',
        '<td>' + esc(p.start_date || '—') + '</td>',
        '<td>' + (p.days_since_start != null ? '<strong>' + esc(String(p.days_since_start)) + '</strong> วัน' : '—') + '</td>',
        '<td><div class="ms-progress">' + dots + '</div></td>',
        '<td>' + (next ? '<span class="ms-badge ms-' + next + '">วันที่ ' + next + '</span>' : '<span style="color:var(--text-faint)">เสร็จครบ</span>') + '</td>',
        '<td data-pr-stop="1" style="text-align:right">',
          next ? '<button class="btn btn-sm" data-pr-review="1">รีวิว</button>' : '',
        '</td>',
      '</tr>',
    ].join('');
  }).join('');

  content.innerHTML = [
    '<div style="overflow-x:auto"><table class="data-table">',
      '<thead><tr>',
        '<th>พนักงาน</th><th>วันเริ่มงาน</th><th style="width:90px">Days</th>',
        '<th>Milestones progress</th><th>Next</th><th style="width:100px"></th>',
      '</tr></thead>',
      '<tbody>' + trs + '</tbody>',
    '</table></div>',
  ].join('');

  prBindRows(content);
}

// ผูก row click + ปุ่มรีวิว → เปิด modal
function prBindRows(content) {
  Array.prototype.forEach.call(content.querySelectorAll('[data-pr-emp]'), function (tr) {
    var emp = tr.getAttribute('data-pr-emp');
    var ms = tr.getAttribute('data-pr-ms');
    if (!ms) return;  // all-tab ที่ครบแล้ว → ไม่มี action
    tr.onclick = function (e) {
      if (e.target.closest('[data-pr-stop]') && !e.target.closest('[data-pr-review]')) return;
      prOpenModal(emp, ms);
    };
  });
}

// ---- review modal -----------------------------------------------------------

// หา item ที่ตรง employee + milestone (เพื่อ prefill ตอนแก้/ดู)
function prFind(empId, milestone) {
  return _prState.items.find(function (r) {
    return String(r.employee_id) === String(empId) &&
           String(r.milestone_days) === String(milestone);
  });
}

function prOpenModal(empId, milestone) {
  var existing = prFind(empId, milestone) || {};
  var name = existing.employee_name || empId;
  var completed = prIsCompleted(existing);
  _prState.outcome = completed ? prResultOf(existing) : null;
  _prState._editEmp = empId;
  _prState._editMs = milestone;

  document.getElementById('pr-modal-title').textContent =
    'รีวิว ' + name + ' · วันที่ ' + milestone;
  document.getElementById('pr-modal-sub').textContent =
    (existing.start_date ? 'เริ่มงาน: ' + existing.start_date : '') +
    (existing.branch_id ? ' · ' + existing.branch_id : '') +
    ' · ' + empId;

  var scoreVal = (existing.score != null && existing.score !== '') ? existing.score : '';
  var commentVal = existing.comments || existing.comment || '';

  document.getElementById('pr-modal-body').innerHTML = [
    '<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">คะแนนรวม (0-100)</div>',
    '<div class="score-row">',
      '<div>',
        '<div class="score-label">คะแนนประเมินรวม</div>',
        '<div class="score-hint">weighted score 0-100 (เว้นว่างได้)</div>',
      '</div>',
      '<div class="score-input"><input type="number" id="pr-m-score" min="0" max="100" value="' + esc(String(scoreVal)) + '" placeholder="เช่น 82"></div>',
    '</div>',

    '<div class="total-score">',
      '<div class="total-score-num" id="pr-m-total">' + (scoreVal !== '' ? esc(String(scoreVal)) : '–') + '</div>',
      '<div class="total-score-label">คะแนนรวม</div>',
    '</div>',

    '<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Outcome</div>',
    '<div class="outcome-row">',
      '<button class="outcome-btn ' + (_prState.outcome === 'pass' ? 'selected' : '') + '" data-val="pass"><div class="outcome-btn-label">Pass</div><div class="outcome-btn-desc">ผ่าน probation</div></button>',
      '<button class="outcome-btn ' + (_prState.outcome === 'extend' ? 'selected' : '') + '" data-val="extend"><div class="outcome-btn-label">Extend</div><div class="outcome-btn-desc">ต่อ probation</div></button>',
      '<button class="outcome-btn ' + (_prState.outcome === 'fail' ? 'selected' : '') + '" data-val="fail"><div class="outcome-btn-label">Fail</div><div class="outcome-btn-desc">ไม่ผ่าน</div></button>',
    '</div>',

    '<div class="field">',
      '<label>Comment / หมายเหตุ</label>',
      '<textarea id="pr-m-comment" placeholder="ข้อสังเกต + คำแนะนำ">' + esc(commentVal) + '</textarea>',
    '</div>',
  ].join('');

  // sync score → total display
  var scoreEl = document.getElementById('pr-m-score');
  scoreEl.addEventListener('input', function () {
    var v = (scoreEl.value || '').trim();
    document.getElementById('pr-m-total').textContent = v !== '' ? v : '–';
  });
  // outcome buttons
  Array.prototype.forEach.call(document.querySelectorAll('#pr-modal-body .outcome-btn'), function (b) {
    b.onclick = function () { prSelectOutcome(b.getAttribute('data-val')); };
  });

  // footer
  document.getElementById('pr-modal-footer').innerHTML = completed
    ? '<div style="font-size:12px;color:var(--text-muted);margin-right:auto">รีวิวเสร็จแล้ว — แก้ได้</div>' +
      '<button class="btn" id="pr-m-close2">ปิด</button>' +
      '<button class="btn btn-primary" id="pr-m-submit">บันทึกใหม่</button>'
    : '<button class="btn" id="pr-m-close2">ปิด</button>' +
      '<button class="btn btn-primary" id="pr-m-submit">บันทึก</button>';
  document.getElementById('pr-m-close2').onclick = prCloseModal;
  document.getElementById('pr-m-submit').onclick = prSubmit;

  document.getElementById('pr-modal-bg').classList.add('active');
}

function prSelectOutcome(val) {
  _prState.outcome = val;
  Array.prototype.forEach.call(document.querySelectorAll('#pr-modal-body .outcome-btn'), function (b) {
    b.classList.toggle('selected', b.getAttribute('data-val') === val);
  });
}

function prCloseModal() {
  var bg = document.getElementById('pr-modal-bg');
  if (bg) bg.classList.remove('active');
}

async function prSubmit() {
  if (_prState.busy) return;
  if (!_prState.outcome) { alert('เลือก outcome ก่อน (pass / extend / fail)'); return; }

  var scoreRaw = (document.getElementById('pr-m-score').value || '').trim();
  var comment = (document.getElementById('pr-m-comment').value || '').trim();

  var body = {
    employee_id: _prState._editEmp,
    milestone_days: Number(_prState._editMs) || _prState._editMs,
    result: _prState.outcome,
    comments: comment,
    review_date: new Date().toISOString().slice(0, 10),
  };
  if (scoreRaw !== '') body.score = Number(scoreRaw);

  _prState.busy = true;
  var btn = document.getElementById('pr-m-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }

  try {
    var res = await sb.functions.invoke(PR_FN, { body: body });
    var data = res && res.data, error = res && res.error;
    _prState.busy = false;
    if (error || (data && data.error)) {
      if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; }
      alert('ไม่สำเร็จ: ' + ((data && data.error) || (error && error.message) || ''));
      return;
    }
    prCloseModal();
    await prLoad();
  } catch (e) {
    _prState.busy = false;
    if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; }
    alert('ไม่สำเร็จ: ' + (e && e.message || ''));
  }
}
