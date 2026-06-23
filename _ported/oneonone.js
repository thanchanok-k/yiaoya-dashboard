// _ported/oneonone.js — native port of desktop one_on_one_manager.html (HR Announcement admin)
// ลอก markup + CSS เดิม (1:1 Log Manager) · scoped ทั้งหมดใต้ #oo (กันชน CSS dashboard) · element id prefix oo-
// ใช้ global sb + esc + $ (มีอยู่แล้วใน index.html · module scope) — ห้าม redeclare
// backend: hr_oneonone → {items:[...]} (list) · create ผ่าน body เดียวกัน
//   create : sb.functions.invoke('hr_oneonone',{body:{employee_id,supervisor_id,session_date,
//            mode,topic,notes,action_items,sentiment,next_date}})  · mode = in_person|video|phone
//   list   : sb.functions.invoke('hr_oneonone') -> {items:[...]}
//
// โครงหน้า desktop ที่ลอกมา (เทียบ one_on_one_manager.html):
//   - tabs: รออนุมัติ / นัดยืนยัน / ผ่านมาแล้ว / ค้างเกิน 30 วัน / ทั้งหมด  (count badge ต่อ tab)
//   - stats cards (5): รออนุมัติ · ยืนยัน · เดือนนี้ · No-show · ค้างเกิน 30d (client-side จาก items)
//   - filters: ค้นหา / หัวหน้า / สาขา  (client-side)
//   - session-grid การ์ด 1:1 (sess-card) + status pill + when-row + meta tags
//   - propose modal: เสนอนัด 1:1 (พนักงาน/หัวหน้า/agenda/mode/วันที่) → create
//   - detail modal: stepper + pair-info + topic + completion fields (summary/action/sentiment/next)

// state เฉพาะหน้านี้ (prefix oo)
let _ooState = {
  tab: 'pending',          // pending | upcoming | past | overdue | all
  items: [],               // raw items จาก backend
  filterSearch: '',
  filterManager: '',
  filterBranch: '',
  proposeMode: 'in_person',
  detailSentiment: 0,      // 0 = ไม่ระบุ
  acting: false,           // กัน double-submit
};

const OO_TAB_TITLES = {
  pending:  { title: 'รออนุมัติจากพนักงาน', sub: 'เสนอแล้วรอพนักงานเลือก slot ใน LINE' },
  upcoming: { title: 'นัดที่ยืนยันแล้ว', sub: 'จะถึงเร็ว ๆ นี้ — ระบบเตือน LINE 1 วัน + 1 ชม.ก่อน' },
  past:     { title: 'ผ่านมาแล้ว', sub: 'completed / no_show / declined' },
  overdue:  { title: 'พนักงานค้างเกิน 30 วัน', sub: 'ต้องนัดด่วน — กดปุ่ม "เสนอนัด" ของแต่ละคน' },
  all:      { title: 'ทุก session', sub: 'ดูทั้งหมดไม่กรอง' },
};

// SVG ไอคอน inline (ลอกจากของเดิม — brand: ไม่มี emoji)
const OO_ICON = {
  msg:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  cal:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  alert:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  arrow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>',
};

// แปลง status ของ item → bucket ของ tab
function ooBucket(st) {
  st = String(st || '').toLowerCase();
  if (st === 'proposed' || st === '') return 'pending';
  if (st === 'confirmed' || st === 'scheduled') return 'upcoming';
  if (st === 'completed' || st === 'no_show' || st === 'declined' || st === 'cancelled') return 'past';
  return 'past';
}

// คำนวณ days_from_today จาก session_date (YYYY-MM-DD)
function ooDaysFromToday(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

function mountOneonone() {
  const wrap = document.getElementById('wrap-oneonone');
  if (!wrap) return;

  wrap.innerHTML = `
<style>
#oo{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px}

/* tabs (ลอกจาก .tabs/.tab เดิม) */
#oo .tabs{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}
#oo .tab{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}
#oo .tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}
#oo .tab:hover:not(.active){color:var(--text)}
#oo .tab svg{width:13px;height:13px}
#oo .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}
#oo .tab.active .cnt{background:var(--navy)}
#oo .tab.tab-overdue.active .cnt{background:var(--danger)}

/* stats (ลอกจาก _shared_styles .stats.cols-5) */
#oo .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:18px}
#oo .stat{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:14px 16px;position:relative;overflow:hidden;transition:border .15s}
#oo .stat:hover{border-color:var(--border-strong)}
#oo .stat-stripe{position:absolute;top:0;left:0;bottom:0;width:3px}
#oo .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}
#oo .stat-value{font-size:26px;font-weight:600;color:var(--text);margin-top:4px;letter-spacing:-.03em;line-height:1}
#oo .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}
@media (max-width:900px){#oo .stats{grid-template-columns:repeat(2,1fr)}}

/* filters (ลอกจาก _shared_styles .filters) */
#oo .filters{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px;display:flex;gap:16px;align-items:end;flex-wrap:wrap;margin-bottom:14px}
#oo .filter{display:flex;flex-direction:column;gap:4px}
#oo .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#oo .filter select,#oo .filter input[type=search]{height:32px;box-sizing:border-box;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);min-width:160px}
#oo .filter select:focus,#oo .filter input:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}

/* page actions row */
#oo .oo-actions{display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px}

/* section card */
#oo .section{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03)}
#oo .section-header{padding:12px 18px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}
#oo .section-icon{width:30px;height:30px;border-radius:6px;background:var(--info-bg);color:var(--info);display:flex;align-items:center;justify-content:center}
#oo .section-icon svg{width:16px;height:16px}
#oo .section-title{font-size:13px;font-weight:600;color:var(--text)}
#oo .section-sub{font-size:11px;color:var(--text-muted)}
#oo .section-body{padding:16px 18px}

/* session cards (ลอกจาก .session-grid/.sess-card) */
#oo .session-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
#oo .sess-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;transition:all .15s;cursor:pointer;border-left:3px solid transparent}
#oo .sess-card:hover{border-color:var(--navy-2)}
#oo .sess-card.st-proposed{border-left-color:var(--info)}
#oo .sess-card.st-confirmed,#oo .sess-card.st-scheduled{border-left-color:var(--success)}
#oo .sess-card.st-completed{opacity:.7;border-left-color:var(--text-muted)}
#oo .sess-card.st-no_show{border-left-color:var(--danger);background:#FEF2F2}
#oo .sess-card.st-declined,#oo .sess-card.st-cancelled{border-left-color:var(--text-faint);opacity:.6}
#oo .sess-card.is-soon{background:#FFFBEB}
#oo .sess-card.is-today{background:#F0FDF4;border-left-color:var(--success);border-left-width:4px}

#oo .sess-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px}
#oo .sess-pair{display:flex;align-items:center;gap:6px;font-size:13px;flex:1;min-width:0}
#oo .av{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--navy) 0%,var(--navy-2) 100%);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}
#oo .pair-info{min-width:0;flex:1}
#oo .pair-emp{font-weight:600;font-size:13px;color:var(--text)}
#oo .pair-sup{font-size:11px;color:var(--text-muted);margin-top:1px}

#oo .st-pill{display:inline-block;padding:2px 9px;border-radius:12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;flex-shrink:0}
#oo .stp-proposed{background:var(--info-bg);color:var(--info)}
#oo .stp-confirmed{background:var(--success-bg);color:var(--success)}
#oo .stp-scheduled{background:#FEF3C7;color:var(--warning)}
#oo .stp-completed{background:#F1F5F9;color:var(--text-muted)}
#oo .stp-no_show{background:var(--danger-bg);color:var(--danger)}
#oo .stp-declined,#oo .stp-cancelled{background:#F1F5F9;color:var(--text-faint)}

#oo .sess-when{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#FAFBFC;border-radius:6px;margin-bottom:8px;font-size:12px}
#oo .sess-when svg{width:14px;height:14px;color:var(--text-muted);flex-shrink:0}
#oo .sess-when-date{font-weight:600;color:var(--text)}
#oo .sess-when-time{color:var(--text-muted);margin-left:4px}
#oo .sess-when-rel{margin-left:auto;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:600}
#oo .rel-today{background:var(--success-bg);color:var(--success)}
#oo .rel-soon{background:var(--warning-bg);color:var(--warning)}
#oo .rel-future{background:var(--info-bg);color:var(--info)}
#oo .rel-past{background:#F1F5F9;color:var(--text-muted)}

#oo .sess-topic{font-size:12px;color:var(--text-muted);line-height:1.5;padding:6px 0;max-height:36px;overflow:hidden}
#oo .sess-meta-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;font-size:10px}
#oo .meta-tag{padding:2px 7px;border-radius:8px;background:#F1F5F9;color:var(--text-muted);font-weight:500;display:inline-flex;align-items:center;gap:3px}
#oo .meta-tag.line-on{background:#DCFCE7;color:#15803D}
#oo .meta-tag.line-off{background:#F1F5F9;color:var(--text-faint)}

/* overdue list */
#oo .overdue-list{display:grid;grid-template-columns:1fr;gap:8px}
#oo .overdue-row{display:grid;grid-template-columns:36px 1fr auto auto;gap:12px;align-items:center;padding:10px 14px;background:#FEF2F2;border-left:3px solid var(--danger);border-radius:6px}
#oo .overdue-row.warn{background:#FFFBEB;border-left-color:var(--warning)}
#oo .overdue-name{font-size:13px;font-weight:600;color:var(--text)}
#oo .overdue-meta{font-size:11px;color:var(--text-muted);margin-top:2px}
#oo .overdue-days{font-size:18px;font-weight:600;color:var(--danger);text-align:right;line-height:1}
#oo .overdue-days-sub{font-size:10px;color:var(--text-muted);margin-top:2px}

/* mode selector */
#oo .mode-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
#oo .mode-btn{padding:10px 8px;border:1px solid var(--border-strong);border-radius:6px;cursor:pointer;text-align:center;font-size:12px;font-weight:500;transition:all .15s;background:#fff;display:flex;flex-direction:column;align-items:center;gap:4px}
#oo .mode-btn svg{width:16px;height:16px;color:var(--text-muted)}
#oo .mode-btn.selected{border-color:var(--navy);background:var(--navy);color:#fff}
#oo .mode-btn.selected svg{color:#fff}

/* sentiment selector (1-5 · ไม่มี emoji) */
#oo .sent-row{display:flex;gap:6px}
#oo .sent-btn{flex:1;padding:8px 4px;border:1px solid var(--border-strong);border-radius:6px;cursor:pointer;background:#fff;text-align:center;transition:all .15s;display:flex;flex-direction:column;align-items:center;gap:2px}
#oo .sent-btn .sent-num{font-size:16px;font-weight:600;color:var(--navy);line-height:1}
#oo .sent-btn .sent-lbl{font-size:9px;color:var(--text-muted)}
#oo .sent-btn[data-s="1"].selected{background:#FEE2E2;border-color:#B91C1C}
#oo .sent-btn[data-s="2"].selected{background:#FEF3C7;border-color:#B45309}
#oo .sent-btn[data-s="3"].selected{background:#F1F5F9;border-color:var(--navy)}
#oo .sent-btn[data-s="4"].selected{background:#DBEAFE;border-color:#1D4ED8}
#oo .sent-btn[data-s="5"].selected{background:#D1FAE5;border-color:#047857}
#oo .sent-btn.selected{border-width:2px;padding:7px 3px}
#oo .sent-btn.selected .sent-num{font-size:17px}
#oo .sent-btn:hover:not(.selected){border-color:var(--navy)}

/* history badge (colored number circle) */
#oo .history-sent{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:600;color:#fff}
#oo .history-sent[data-s="1"]{background:#B91C1C}
#oo .history-sent[data-s="2"]{background:#B45309}
#oo .history-sent[data-s="3"]{background:var(--navy)}
#oo .history-sent[data-s="4"]{background:#1D4ED8}
#oo .history-sent[data-s="5"]{background:#047857}

/* workflow stepper (detail modal) */
#oo .wf-stepper{display:flex;align-items:center;gap:4px;margin:0 0 14px;padding:12px;background:#F8FAFC;border-radius:8px}
#oo .wf-step{flex:1;padding:6px 8px;border-radius:6px;text-align:center;font-size:11px;font-weight:500;background:#fff;color:var(--text-faint)}
#oo .wf-step.done{background:var(--success-bg);color:var(--success);font-weight:600}
#oo .wf-step.active{background:var(--info-bg);color:var(--info);border:1px solid var(--info);font-weight:600}
#oo .wf-step.warn{background:var(--danger-bg);color:var(--danger)}
#oo .wf-arrow{color:var(--text-faint);flex-shrink:0}
#oo .wf-arrow svg{width:11px;height:11px}

/* buttons (ลอกจาก _shared_styles .btn) */
#oo .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}
#oo .btn:hover{border-color:var(--navy)}
#oo .btn svg{width:14px;height:14px}
#oo .btn-sm{padding:5px 10px;font-size:12px}
#oo .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}
#oo .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}
#oo .btn-success{background:var(--success);color:#fff;border-color:var(--success)}
#oo .btn-success:hover{background:#15803D;border-color:#15803D}
#oo .btn-danger{background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border)}
#oo .btn-danger:hover{border-color:var(--danger)}
#oo .btn[disabled]{opacity:.5;cursor:not-allowed}

/* fields (ลอกจาก _shared_styles .field) */
#oo .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}
#oo .field label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#oo .field input,#oo .field select,#oo .field textarea{padding:9px 12px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);transition:border .15s;box-sizing:border-box}
#oo .field input:focus,#oo .field select:focus,#oo .field textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}
#oo .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
#oo .field-help{font-size:11px;color:var(--text-faint);margin-top:2px}

/* empty / loading */
#oo .empty{text-align:center;padding:50px 20px;color:var(--text-muted)}
#oo .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px}
#oo .empty-icon svg{width:24px;height:24px}
#oo .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}
#oo .empty-sub{font-size:12px;color:var(--text-muted)}
#oo .loading{text-align:center;padding:50px;color:var(--text-muted)}

/* modal (ลอกจาก _shared_styles .modal) */
#oo .modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;z-index:9000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}
#oo .modal-bg.active{display:flex}
#oo .modal{background:var(--surface);border-radius:12px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);display:flex;flex-direction:column}
#oo .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}
#oo .modal-header h2{font-size:16px;font-weight:600;color:var(--text);margin:0}
#oo .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}
#oo .modal-body{padding:20px 24px;flex:1;overflow-y:auto}
#oo .modal-footer{padding:14px 24px;border-top:1px solid var(--border);background:#F8FAFC;display:flex;gap:8px;justify-content:flex-end}
</style>
<div id="oo">

  <div class="oo-actions">
    <button class="btn btn-sm" id="oo-refresh">รีเฟรช</button>
    <button class="btn btn-primary" id="oo-propose">${OO_ICON.plus} เสนอนัด</button>
  </div>

  <div class="stats" id="oo-stats"></div>

  <div class="tabs">
    <button class="tab tab-pending active" id="oo-tab-pending">${OO_ICON.msg} รออนุมัติ <span class="cnt" id="oo-cnt-pending">—</span></button>
    <button class="tab tab-upcoming" id="oo-tab-upcoming">${OO_ICON.cal} นัดยืนยัน <span class="cnt" id="oo-cnt-upcoming">—</span></button>
    <button class="tab tab-past" id="oo-tab-past">${OO_ICON.check} ผ่านมาแล้ว <span class="cnt" id="oo-cnt-past">—</span></button>
    <button class="tab tab-overdue" id="oo-tab-overdue">${OO_ICON.alert} ค้างเกิน 30 วัน <span class="cnt" id="oo-cnt-overdue">—</span></button>
    <button class="tab tab-all" id="oo-tab-all">${OO_ICON.msg} ทั้งหมด</button>
  </div>

  <div class="filters">
    <div class="filter">
      <label>ค้นหา</label>
      <input type="search" id="oo-f-search" placeholder="ชื่อพนักงาน / หัวหน้า / topic">
    </div>
    <div class="filter">
      <label>หัวหน้า</label>
      <select id="oo-f-manager"><option value="">ทุกคน</option></select>
    </div>
    <div class="filter">
      <label>สาขา</label>
      <select id="oo-f-branch"><option value="">ทุกสาขา</option></select>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <div class="section-icon">${OO_ICON.msg}</div>
      <div style="flex:1">
        <div class="section-title" id="oo-sec-title">รออนุมัติจากพนักงาน</div>
        <div class="section-sub" id="oo-sec-sub">คลิกการ์ดเพื่อดูรายละเอียด + สั่งการ</div>
      </div>
    </div>
    <div class="section-body"><div id="oo-content" class="loading">กำลังโหลด...</div></div>
  </div>

  <!-- Propose modal -->
  <div class="modal-bg" id="oo-prop-bg">
    <div class="modal" style="max-width:560px">
      <div class="modal-header">
        <h2>เสนอนัด 1:1</h2>
        <p>เลือกพนักงาน + เวลา + รูปแบบ แล้วบันทึก</p>
      </div>
      <div class="modal-body">
        <div class="field-grid">
          <div class="field"><label>พนักงาน *</label><input type="text" id="oo-p-emp" placeholder="รหัส / ชื่อพนักงาน"></div>
          <div class="field"><label>หัวหน้า *</label><input type="text" id="oo-p-sup" placeholder="รหัส / ชื่อหัวหน้า"></div>
        </div>
        <div class="field"><label>วันที่นัด *</label><input type="date" id="oo-p-date"></div>
        <div class="field">
          <label>หัวข้อ / agenda</label>
          <textarea id="oo-p-agenda" rows="2" placeholder="ติดตามงาน · ฟีดแบค · ปัญหาที่อยากคุย"></textarea>
        </div>
        <div class="field">
          <label>รูปแบบ</label>
          <div class="mode-grid" id="oo-mode-grid">
            <div class="mode-btn selected" data-mode="in_person"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>พบเจอกัน</div>
            <div class="mode-btn" data-mode="video"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="12" x="2" y="6" rx="2"/><path d="m22 8-6 4 6 4z"/></svg>วิดีโอ</div>
            <div class="mode-btn" data-mode="phone"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>โทรศัพท์</div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" id="oo-prop-cancel">ยกเลิก</button>
        <button class="btn btn-primary" id="oo-prop-save">บันทึกนัด</button>
      </div>
    </div>
  </div>

  <!-- Detail modal -->
  <div class="modal-bg" id="oo-detail-bg">
    <div class="modal" style="max-width:640px">
      <div class="modal-header">
        <h2 id="oo-d-title">Session</h2>
        <p id="oo-d-sub">—</p>
      </div>
      <div class="modal-body">
        <div class="wf-stepper" id="oo-d-stepper"></div>
        <div id="oo-d-pair-info" style="margin-bottom:14px"></div>

        <div class="field"><label>หัวข้อ / agenda</label><textarea id="oo-d-topic" rows="2"></textarea></div>

        <div id="oo-d-completion" style="display:none">
          <div class="field"><label>สรุปประเด็นที่คุย</label><textarea id="oo-d-summary" rows="3"></textarea></div>
          <div class="field"><label>Action items (follow-up tasks)</label><textarea id="oo-d-action" rows="2"></textarea></div>
          <div class="field">
            <label>พนักงานรู้สึกยังไง? (ไม่บังคับ)</label>
            <div class="sent-row" id="oo-d-sent">
              <div class="sent-btn" data-s="1"><span class="sent-num">1</span><span class="sent-lbl">เครียดมาก</span></div>
              <div class="sent-btn" data-s="2"><span class="sent-num">2</span><span class="sent-lbl">ไม่ค่อยดี</span></div>
              <div class="sent-btn" data-s="3"><span class="sent-num">3</span><span class="sent-lbl">ปกติ</span></div>
              <div class="sent-btn" data-s="4"><span class="sent-num">4</span><span class="sent-lbl">ดี</span></div>
              <div class="sent-btn" data-s="5"><span class="sent-num">5</span><span class="sent-lbl">ดีมาก</span></div>
            </div>
            <div class="field-help">ไม่กด = ไม่ระบุ (จะไม่เข้า average)</div>
          </div>
          <div class="field"><label>นัดครั้งถัดไป (ถ้ามี)</label><input type="date" id="oo-d-next"></div>
        </div>
      </div>
      <div class="modal-footer" style="justify-content:space-between">
        <div style="display:flex;gap:6px" id="oo-d-left"></div>
        <div style="display:flex;gap:6px" id="oo-d-right"></div>
      </div>
    </div>
  </div>

</div>`;

  // ---- bind tabs ----
  ['pending', 'upcoming', 'past', 'overdue', 'all'].forEach(t => {
    const el = $('oo-tab-' + t);
    if (el) el.onclick = () => ooSetTab(t);
  });
  // ---- bind filters (client-side) ----
  $('oo-f-search').oninput  = () => { _ooState.filterSearch = $('oo-f-search').value; ooRender(); };
  $('oo-f-manager').onchange = () => { _ooState.filterManager = $('oo-f-manager').value; ooRender(); };
  $('oo-f-branch').onchange  = () => { _ooState.filterBranch = $('oo-f-branch').value; ooRender(); };
  $('oo-refresh').onclick    = () => ooLoad();
  // ---- propose modal ----
  $('oo-propose').onclick     = ooOpenPropose;
  $('oo-prop-cancel').onclick = ooClosePropose;
  $('oo-prop-save').onclick   = ooSavePropose;
  $('oo-prop-bg').onclick = (e) => { if (e.target === $('oo-prop-bg')) ooClosePropose(); };
  Array.prototype.forEach.call($('oo-mode-grid').querySelectorAll('.mode-btn'), b => {
    b.onclick = () => ooSelectMode(b.getAttribute('data-mode'));
  });
  // ---- detail modal sentiment ----
  Array.prototype.forEach.call($('oo-d-sent').querySelectorAll('.sent-btn'), b => {
    b.onclick = () => ooSelectSent(Number(b.getAttribute('data-s')));
  });
  $('oo-detail-bg').onclick = (e) => { if (e.target === $('oo-detail-bg')) ooCloseDetail(); };

  ooLoad();
}

function ooSetTab(tab) {
  _ooState.tab = tab;
  Array.prototype.forEach.call(document.querySelectorAll('#oo .tab'), b => b.classList.remove('active'));
  const el = $('oo-tab-' + tab);
  if (el) el.classList.add('active');
  const t = OO_TAB_TITLES[tab];
  $('oo-sec-title').textContent = t.title;
  $('oo-sec-sub').textContent = t.sub;
  ooRender();
}

async function ooLoad() {
  const content = $('oo-content');
  if (content) { content.className = 'loading'; content.textContent = 'กำลังโหลด...'; }
  try {
    const { data } = await sb.functions.invoke('hr_oneonone');
    _ooState.items = (data && data.items) || [];
  } catch (e) {
    console.error('ooLoad', e);
    _ooState.items = [];
    if (content) { content.className = 'empty'; content.textContent = 'โหลดข้อมูลไม่สำเร็จ'; }
  }
  ooPopulateFilters();
  ooRender();
}

function ooPopulateFilters() {
  // หัวหน้า
  const mSel = $('oo-f-manager');
  if (mSel && mSel.children.length <= 1) {
    const seen = {};
    _ooState.items.forEach(r => {
      const id = (r.supervisor_id || '').trim();
      if (id && !seen[id]) { seen[id] = r.supervisor_name || id; }
    });
    Object.keys(seen).sort().forEach(id => {
      const o = document.createElement('option');
      o.value = id; o.textContent = seen[id];
      mSel.appendChild(o);
    });
  }
  // สาขา
  const bSel = $('oo-f-branch');
  if (bSel && bSel.children.length <= 1) {
    const seen = {};
    _ooState.items.forEach(r => {
      const id = (r.branch_id || r.branch_name || '').trim();
      if (id && !seen[id]) { seen[id] = r.branch_name || id; }
    });
    Object.keys(seen).sort().forEach(id => {
      const o = document.createElement('option');
      o.value = id; o.textContent = seen[id];
      bSel.appendChild(o);
    });
  }
}

// apply tab + filters → rows
function ooFiltered() {
  const q = _ooState.filterSearch.trim().toLowerCase();
  return _ooState.items.filter(r => {
    if (_ooState.tab !== 'all' && ooBucket(r.status) !== _ooState.tab) return false;
    if (_ooState.filterManager && (r.supervisor_id || '') !== _ooState.filterManager) return false;
    if (_ooState.filterBranch && (r.branch_id || r.branch_name || '') !== _ooState.filterBranch) return false;
    if (q) {
      const hay = (String(r.employee_name || '') + ' ' + String(r.employee_id || '') + ' ' +
        String(r.supervisor_name || '') + ' ' + String(r.supervisor_id || '') + ' ' +
        String(r.topic || '') + ' ' + String(r.notes || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function ooRender() {
  // counts ทุก tab (ตาม status bucket — ก่อน filter อื่น)
  let cP = 0, cU = 0, cPast = 0, cOver = 0;
  _ooState.items.forEach(r => {
    const b = ooBucket(r.status);
    if (b === 'pending') cP++;
    else if (b === 'upcoming') cU++;
    else cPast++;
    // overdue: completed ล่าสุดเกิน 30 วัน (ดูจาก days_from_today ติดลบ + completed/no_show)
    const dft = ooDaysFromToday(r.session_date);
    if ((b === 'past') && dft !== null && dft <= -30) cOver++;
  });
  if ($('oo-cnt-pending'))  $('oo-cnt-pending').textContent  = cP;
  if ($('oo-cnt-upcoming')) $('oo-cnt-upcoming').textContent = cU;
  if ($('oo-cnt-past'))     $('oo-cnt-past').textContent     = cPast;
  if ($('oo-cnt-overdue'))  $('oo-cnt-overdue').textContent  = cOver;
  // sidebar badge = จำนวน pending (รออนุมัติ)
  const ct = document.getElementById('ct-oneonone');
  if (ct) ct.textContent = cP || '';

  ooRenderStats();

  if (_ooState.tab === 'overdue') { ooRenderOverdue(); return; }
  ooRenderSessions(ooFiltered());
}

function ooStatCard(label, value, sub, color) {
  return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
    '<div class="stat-label">' + esc(label) + '</div>' +
    '<div class="stat-value">' + (value || 0) + '</div>' +
    '<div class="stat-sub">' + esc(sub) + '</div></div>';
}

function ooRenderStats() {
  const items = _ooState.items;
  const st = (r) => String(r.status || '').toLowerCase();
  const proposed = items.filter(r => ooBucket(r.status) === 'pending').length;
  const upcoming = items.filter(r => ooBucket(r.status) === 'upcoming').length;

  // เดือนนี้ (completed ใน session_date เดือนปัจจุบัน)
  const now = new Date();
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const completedMonth = items.filter(r => st(r) === 'completed' && String(r.session_date || '').slice(0, 7) === ym).length;
  const noShowMonth = items.filter(r => st(r) === 'no_show' && String(r.session_date || '').slice(0, 7) === ym).length;
  const denom = completedMonth + noShowMonth;
  const noShowRate = denom ? Math.round((noShowMonth / denom) * 100) : 0;

  const overdue = items.filter(r => {
    const dft = ooDaysFromToday(r.session_date);
    return ooBucket(r.status) === 'past' && dft !== null && dft <= -30;
  }).length;

  $('oo-stats').innerHTML = [
    ooStatCard('รออนุมัติ', proposed, 'proposed', 'var(--info)'),
    ooStatCard('ยืนยัน', upcoming, 'upcoming', 'var(--success)'),
    ooStatCard('เดือนนี้', completedMonth, 'completed', 'var(--navy)'),
    ooStatCard('No-show', noShowMonth, noShowRate + '% rate', noShowMonth > 0 ? 'var(--danger)' : 'var(--text-faint)'),
    ooStatCard('ค้างเกิน 30d', overdue, 'sessions', overdue > 0 ? 'var(--warning)' : 'var(--success)'),
  ].join('');
}

function ooRenderSessions(sessions) {
  const content = $('oo-content');
  content.className = '';
  if (!sessions.length) {
    content.innerHTML =
      '<div class="empty"><div class="empty-icon">' + OO_ICON.msg + '</div>' +
      '<div class="empty-title">ไม่มี session ในแท็บนี้</div>' +
      '<div class="empty-sub">กดปุ่ม "เสนอนัด" หรือเปลี่ยนแท็บ</div></div>';
    return;
  }
  content.innerHTML = '<div class="session-grid">' + sessions.map(ooRenderCard).join('') + '</div>';
  Array.prototype.forEach.call(content.querySelectorAll('[data-oo-card]'), c => {
    c.onclick = () => ooOpenDetail(c.getAttribute('data-oo-card'));
  });
}

function ooSessId(s) {
  return String(s.session_id || s.id || s.row || (s.employee_id + '|' + s.session_date) || '');
}

function ooRenderCard(s) {
  const status = String(s.status || 'proposed').toLowerCase();
  const cardCls = ['sess-card', 'st-' + status];
  const dft = ooDaysFromToday(s.session_date);
  if (dft === 0) cardCls.push('is-today');
  else if (dft !== null && dft > 0 && dft <= 1 && status !== 'completed') cardCls.push('is-soon');

  const empName = s.employee_nickname || s.employee_name || s.employee_id || '?';
  const empInitials = String(empName).substring(0, 2);
  const supName = s.supervisor_name || s.supervisor_id || '—';

  let relLabel = '', relCls = '';
  if (dft === 0) { relLabel = 'วันนี้'; relCls = 'rel-today'; }
  else if (dft === 1) { relLabel = 'พรุ่งนี้'; relCls = 'rel-soon'; }
  else if (dft !== null && dft > 0) { relLabel = 'อีก ' + dft + ' วัน'; relCls = 'rel-future'; }
  else if (dft !== null && dft < 0) { relLabel = (-dft) + ' วันก่อน'; relCls = 'rel-past'; }

  const tags = [];
  if (s.employee_line_linked) tags.push('<span class="meta-tag line-on">LINE</span>');
  else if (s.employee_line_linked === false) tags.push('<span class="meta-tag line-off">no LINE</span>');
  if (s.mode === 'video') tags.push('<span class="meta-tag">video</span>');
  else if (s.mode === 'phone') tags.push('<span class="meta-tag">phone</span>');
  const topic = s.topic || s.notes || '';

  return [
    '<div class="' + cardCls.join(' ') + '" data-oo-card="' + esc(ooSessId(s)) + '">',
      '<div class="sess-head">',
        '<div class="sess-pair">',
          '<div class="av">' + esc(empInitials) + '</div>',
          '<div class="pair-info">',
            '<div class="pair-emp">' + esc(empName) + '</div>',
            '<div class="pair-sup">กับ ' + esc(supName) + (s.branch_name ? ' · ' + esc(s.branch_name) : '') + '</div>',
          '</div>',
        '</div>',
        '<span class="st-pill stp-' + esc(status) + '">' + esc(status) + '</span>',
      '</div>',
      '<div class="sess-when">',
        OO_ICON.cal,
        '<div>',
          '<span class="sess-when-date">' + esc(s.session_date || '—') + '</span>',
          (s.session_time ? '<span class="sess-when-time">' + esc(s.session_time) + '</span>' : ''),
        '</div>',
        (relLabel ? '<span class="sess-when-rel ' + relCls + '">' + relLabel + '</span>' : ''),
      '</div>',
      (topic ? '<div class="sess-topic">' + esc(topic) + '</div>' : ''),
      tags.length ? '<div class="sess-meta-row">' + tags.join('') + '</div>' : '',
    '</div>',
  ].join('');
}

function ooRenderOverdue() {
  const content = $('oo-content');
  content.className = '';
  // จัดกลุ่มตามพนักงาน → หา session ล่าสุด → ค้างเกิน 30 วัน
  const byEmp = {};
  _ooState.items.forEach(r => {
    const id = r.employee_id || r.employee_name || '?';
    const dft = ooDaysFromToday(r.session_date);
    if (!byEmp[id] || (dft !== null && (byEmp[id]._dft === null || dft > byEmp[id]._dft))) {
      byEmp[id] = Object.assign({}, r, { _dft: dft });
    }
  });
  const items = Object.keys(byEmp)
    .map(id => byEmp[id])
    .filter(r => r._dft !== null && r._dft <= -30)
    .sort((a, b) => a._dft - b._dft);

  if (!items.length) {
    content.innerHTML =
      '<div class="empty"><div class="empty-icon">' + OO_ICON.check + '</div>' +
      '<div class="empty-title">ไม่มีพนักงานค้าง</div>' +
      '<div class="empty-sub">ทุกคนได้ 1:1 ภายใน 30 วัน</div></div>';
    return;
  }
  const rows = items.map(it => {
    const days = -it._dft;
    const cls = days >= 60 ? '' : 'warn';
    const empName = it.employee_nickname || it.employee_name || it.employee_id || '?';
    const av = String(empName).substring(0, 2);
    return [
      '<div class="overdue-row ' + cls + '">',
        '<div class="av">' + esc(av) + '</div>',
        '<div>',
          '<div class="overdue-name">' + esc(empName) + '</div>',
          '<div class="overdue-meta">' + esc(it.branch_name || '') + ' · ครั้งล่าสุด ' + esc(it.session_date || '—') + '</div>',
        '</div>',
        '<div><div class="overdue-days">' + days + '</div><div class="overdue-days-sub">วัน</div></div>',
        '<button class="btn btn-sm btn-primary" data-oo-propose-emp="' + esc(it.employee_id || '') + '" data-oo-propose-sup="' + esc(it.supervisor_id || '') + '">' + OO_ICON.plus + ' เสนอนัด</button>',
      '</div>',
    ].join('');
  }).join('');
  content.innerHTML = '<div class="overdue-list">' + rows + '</div>';
  Array.prototype.forEach.call(content.querySelectorAll('[data-oo-propose-emp]'), btn => {
    btn.onclick = () => ooProposeFor(btn.getAttribute('data-oo-propose-emp'), btn.getAttribute('data-oo-propose-sup'));
  });
}

// ===== Propose modal =====

function ooOpenPropose() {
  $('oo-p-emp').value = '';
  $('oo-p-sup').value = '';
  $('oo-p-date').value = '';
  $('oo-p-agenda').value = '';
  ooSelectMode('in_person');
  $('oo-prop-bg').classList.add('active');
}

function ooProposeFor(empId, supId) {
  ooOpenPropose();
  $('oo-p-emp').value = empId || '';
  $('oo-p-sup').value = supId || '';
}

function ooSelectMode(mode) {
  _ooState.proposeMode = mode;
  Array.prototype.forEach.call($('oo-mode-grid').querySelectorAll('.mode-btn'), b => {
    b.classList.toggle('selected', b.getAttribute('data-mode') === mode);
  });
}

function ooClosePropose() { $('oo-prop-bg').classList.remove('active'); }

async function ooSavePropose() {
  if (_ooState.acting) return;
  const body = {
    employee_id:   $('oo-p-emp').value.trim(),
    supervisor_id: $('oo-p-sup').value.trim(),
    session_date:  $('oo-p-date').value,
    mode:          _ooState.proposeMode,
    topic:         $('oo-p-agenda').value.trim(),
    notes:         '',
    action_items:  '',
    sentiment:     0,
    next_date:     '',
  };
  if (!body.employee_id) { alert('กรอกพนักงาน'); return; }
  if (!body.supervisor_id) { alert('กรอกหัวหน้า'); return; }
  if (!body.session_date) { alert('เลือกวันที่นัด'); return; }

  _ooState.acting = true;
  const btn = $('oo-prop-save');
  btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
  try {
    const { data, error } = await sb.functions.invoke('hr_oneonone', { body });
    if (error || (data && data.error)) {
      alert('ไม่สำเร็จ: ' + ((data && data.error) || (error && error.message) || 'unknown'));
      return;
    }
    ooClosePropose();
    await ooLoad();
  } catch (e) {
    alert('ไม่สำเร็จ: ' + (e && e.message || e));
  } finally {
    _ooState.acting = false;
    btn.disabled = false; btn.textContent = 'บันทึกนัด';
  }
}

// ===== Detail modal =====

function ooFind(sessionId) {
  return _ooState.items.find(r => ooSessId(r) === String(sessionId));
}

function ooSelectSent(n) {
  _ooState.detailSentiment = (_ooState.detailSentiment === n) ? 0 : n;
  Array.prototype.forEach.call($('oo-d-sent').querySelectorAll('.sent-btn'), b => {
    b.classList.toggle('selected', Number(b.getAttribute('data-s')) === _ooState.detailSentiment);
  });
}

function ooOpenDetail(sessionId) {
  const s = ooFind(sessionId);
  if (!s) { alert('ไม่พบ session'); return; }
  _ooState.currentDetail = s;
  _ooState.detailSentiment = 0;

  const status = String(s.status || 'proposed').toLowerCase();
  const empName = s.employee_nickname || s.employee_name || s.employee_id || '?';
  const supName = s.supervisor_name || s.supervisor_id || '—';

  $('oo-d-title').textContent = empName + ' × ' + supName;
  $('oo-d-sub').textContent = (s.session_date || '—') + ' ' + (s.session_time || '') + ' · ' + status;

  // Stepper
  const steps = ['proposed', 'confirmed', 'completed'];
  const stepLabels = { proposed: 'เสนอ', confirmed: 'ยืนยัน', completed: 'เสร็จ' };
  let stepIdx = steps.indexOf(status === 'scheduled' ? 'confirmed' : status);
  if (status === 'no_show') stepIdx = -1;
  if (status === 'declined' || status === 'cancelled') stepIdx = -2;
  const stepHtml = steps.map((st, i) => {
    let cls = 'wf-step';
    if (i < stepIdx) cls += ' done';
    else if (i === stepIdx) cls += ' active';
    if (status === 'no_show' && st === 'completed') cls += ' warn';
    return '<div class="' + cls + '">' + stepLabels[st] + '</div>';
  });
  const arrow = '<div class="wf-arrow">' + OO_ICON.arrow + '</div>';
  let stepperHtml = stepHtml[0] + arrow + stepHtml[1] + arrow + stepHtml[2];
  if (status === 'no_show') stepperHtml += arrow + '<div class="wf-step warn">no-show</div>';
  if (status === 'declined') stepperHtml = '<div class="wf-step warn" style="flex:1">ปฏิเสธ</div>';
  if (status === 'cancelled') stepperHtml = '<div class="wf-step warn" style="flex:1">ยกเลิก</div>';
  $('oo-d-stepper').innerHTML = stepperHtml;

  // Pair info
  $('oo-d-pair-info').innerHTML = [
    '<div style="display:flex;justify-content:space-between;gap:12px">',
      '<div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Employee</div>',
        '<div style="font-size:14px;font-weight:600">' + esc(empName) + '</div>',
        '<div style="font-size:11px;color:var(--text-muted)">' + esc(s.branch_name || '') + (s.employee_line_linked ? ' · LINE ✓' : '') + '</div>',
      '</div>',
      '<div style="text-align:right"><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase">Supervisor</div>',
        '<div style="font-size:14px;font-weight:600">' + esc(supName) + '</div>',
        '<div style="font-size:11px;color:var(--text-muted)">' + (s.mode === 'video' ? 'video call' : s.mode === 'phone' ? 'phone' : 'in-person') + '</div>',
      '</div>',
    '</div>',
  ].join('');

  $('oo-d-topic').value = s.topic || '';

  // Completion fields visible if confirmed/scheduled
  const showComplete = ['confirmed', 'scheduled'].includes(status);
  $('oo-d-completion').style.display = showComplete ? '' : 'none';
  if (showComplete) {
    $('oo-d-summary').value = s.notes || '';
    $('oo-d-action').value = s.action_items || '';
    $('oo-d-next').value = '';
    Array.prototype.forEach.call($('oo-d-sent').querySelectorAll('.sent-btn'), b => b.classList.remove('selected'));
  }

  ooRenderDetailActions(s, status);
  $('oo-detail-bg').classList.add('active');
}

function ooRenderDetailActions(s, status) {
  const left = $('oo-d-left');
  const right = $('oo-d-right');
  left.innerHTML = '';
  right.innerHTML = '<button class="btn" id="oo-d-close">ปิด</button>';

  if (status === 'confirmed' || status === 'scheduled') {
    right.innerHTML += '<button class="btn btn-primary" id="oo-d-complete">' + OO_ICON.check + ' บันทึกผล</button>';
  } else if (status === 'completed') {
    right.innerHTML += '<span style="font-size:11px;color:var(--success);font-weight:500;padding:6px;display:inline-flex;align-items:center;gap:4px">' + OO_ICON.check + ' completed</span>';
  }

  $('oo-d-close').onclick = ooCloseDetail;
  const cBtn = $('oo-d-complete');
  if (cBtn) cBtn.onclick = ooCompleteSession;
}

async function ooCompleteSession() {
  if (_ooState.acting) return;
  const s = _ooState.currentDetail;
  if (!s) return;
  const body = {
    employee_id:   s.employee_id || '',
    supervisor_id: s.supervisor_id || '',
    session_date:  s.session_date || '',
    mode:          s.mode || 'in_person',
    topic:         $('oo-d-topic').value.trim(),
    notes:         $('oo-d-summary').value.trim() || $('oo-d-topic').value.trim(),
    action_items:  $('oo-d-action').value.trim(),
    sentiment:     _ooState.detailSentiment,
    next_date:     $('oo-d-next').value || '',
  };
  if (s.session_id) body.session_id = s.session_id;
  body.status = 'completed';
  if (!body.notes) { alert('กรอกสรุปอย่างน้อย'); return; }

  _ooState.acting = true;
  const btn = $('oo-d-complete');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const { data, error } = await sb.functions.invoke('hr_oneonone', { body });
    if (error || (data && data.error)) {
      alert('ไม่สำเร็จ: ' + ((data && data.error) || (error && error.message) || 'unknown'));
      return;
    }
    ooCloseDetail();
    await ooLoad();
  } catch (e) {
    alert('ไม่สำเร็จ: ' + (e && e.message || e));
  } finally {
    _ooState.acting = false;
    if (btn) { btn.disabled = false; btn.innerHTML = OO_ICON.check + ' บันทึกผล'; }
  }
}

function ooCloseDetail() {
  $('oo-detail-bg').classList.remove('active');
  _ooState.currentDetail = null;
}
