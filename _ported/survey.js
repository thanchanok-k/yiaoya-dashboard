// _ported/survey.js — native port of desktop surveys_manager.html (HR Announcement admin)
// ลอก markup + CSS เดิม · scoped ทั้งหมดใต้ #sv (ก๊อป _shared_styles prefix '#sv ') · element id prefix sv-
// ใช้ global sb + esc + $ (มีอยู่แล้วใน index.html · module scope) — ห้าม redeclare
// backend: hr_survey_response
//   list   : sb.functions.invoke('hr_survey_response') → {items:[...]}  (payload: survey_type, rating, comment, status, employee_id?)
//   submit : sb.functions.invoke('hr_survey_response',{body:{survey_type,employee_id,rating,comment,anonymous}})
//
// โครงหน้า desktop ที่ลอกมา (surveys_manager.html):
//   - tabs: Overview / Responses / Trends / ส่งคำตอบ
//   - Overview: stat-card ต่อ survey type (total / เดือนนี้ / avg rating / ล่าสุด) คำนวณ client-side จาก items
//   - Responses: filter (type / search / from / to) + rating distribution + data-table + detail modal
//   - Trends: trend-bars avg rating ต่อเดือน (client-side group)
//   - ส่งคำตอบ: ฟอร์มสร้าง response (survey_type / employee_id / rating 1-5 / comment / anonymous)
//   ตัดออกจากของเดิม: Flex Preview · Manual Send (cron/bulk) · Export CSV → ต้องใช้ admin backend ที่ native ไม่มี

// survey types (ลอกจาก surveys_manager TYPE_LABELS + pulse/review_360 ตามสเปก native)
const SV_TYPES = [
  { key: 'pulse',            label: 'Pulse Survey' },
  { key: 'exit_hr',          label: 'Exit Interview · HR' },
  { key: 'one_on_one',       label: '1:1 Feedback' },
  { key: 'learning_log',     label: 'Learning Log' },
  { key: 'idp_review',       label: 'IDP Review' },
  { key: 'quarterly_review', label: 'Quarterly Review' },
  { key: 'buddy_feedback',   label: 'Buddy Feedback' },
  { key: 'review_360',       label: '360° Review' },
];

const SV_SCALE = 5; // rating 1..5

let _svState = {
  tab: 'overview',     // 'overview' | 'responses' | 'trends' | 'send'
  items: [],           // raw items จาก backend
  filterType: '',
  filterSearch: '',
  filterFrom: '',
  filterTo: '',
  form: { type: 'pulse', rating: null, comment: '', anonymous: true, emp: '' },
  sending: false,
};

function svTypeLabel(key) {
  const t = SV_TYPES.find(x => x.key === key);
  return t ? t.label : (key || '');
}

function mountSurvey() {
  const wrap = document.getElementById('wrap-survey');
  if (!wrap) return;

  const typeOpts = SV_TYPES.map(t =>
    '<option value="' + t.key + '">' + esc(t.label) + '</option>'
  ).join('');
  const formTypeOpts = SV_TYPES.map(t =>
    '<option value="' + t.key + '">' + esc(t.key) + ' — ' + esc(t.label) + '</option>'
  ).join('');

  wrap.innerHTML = `
<style>
#sv{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px}

/* tabs */
#sv .tab-row{display:flex;gap:6px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;width:fit-content;flex-wrap:wrap}
#sv .tab-btn{padding:7px 14px;border:none;background:transparent;border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}
#sv .tab-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}

/* stats */
#sv .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
#sv .stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden;cursor:pointer;transition:border .15s,transform .15s}
#sv .stat:hover{border-color:var(--teal);transform:translateY(-2px)}
#sv .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}
#sv .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}
#sv .stat-name{font-size:13px;color:var(--navy);font-weight:600;margin-top:3px}
#sv .stat-big{font-size:22px;font-weight:700;color:var(--teal);margin-top:4px;line-height:1}
#sv .stat-row{display:flex;justify-content:space-between;font-size:11px;color:var(--text);margin-top:5px}
#sv .stat-row.muted{color:var(--text-muted)}
@media (max-width:900px){#sv .stats{grid-template-columns:repeat(2,1fr)}}

/* filters */
#sv .filters{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end}
#sv .filter{display:flex;flex-direction:column;gap:4px}
#sv .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#sv .filter select,#sv .filter input{height:34px;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--surface);min-width:150px;box-sizing:border-box}
#sv .filter select:focus,#sv .filter input:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.08)}

/* section */
#sv .section{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:12px}
#sv .section-header{display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border)}
#sv .section-icon{width:30px;height:30px;border-radius:8px;background:var(--info-bg);color:var(--info);display:flex;align-items:center;justify-content:center}
#sv .section-icon svg{width:16px;height:16px}
#sv .section-title{font-size:13px;font-weight:600;color:var(--text)}
#sv .section-sub{font-size:11px;color:var(--text-muted)}
#sv .section-body{padding:14px 16px}

/* data table */
#sv .data-table{width:100%;border-collapse:collapse;font-size:13px}
#sv .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}
#sv .data-table thead th.center{text-align:center}
#sv .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}
#sv .data-table tbody td.center{text-align:center}
#sv .data-table tbody tr{border-left:3px solid transparent;transition:background .15s;cursor:pointer}
#sv .data-table tbody tr:hover{background:#FAFBFC}

/* rating distribution */
#sv .rating-dist{display:flex;gap:8px}
#sv .rd-item{flex:1;background:var(--info-bg);border-radius:6px;padding:10px;text-align:center}
#sv .rd-count{font-size:18px;font-weight:700;color:var(--teal)}
#sv .rd-label{font-size:11px;color:var(--text-muted);margin-top:2px}

/* trend bars */
#sv .trend-bars{display:flex;align-items:flex-end;gap:8px;height:200px;padding:30px 0 0;border-bottom:1px solid var(--border)}
#sv .trend-bar{flex:1;min-width:30px;border-radius:4px 4px 0 0;position:relative;background:var(--teal)}
#sv .bar-label{position:absolute;top:-22px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--navy);font-weight:600}
#sv .bar-period{position:absolute;bottom:-34px;left:50%;transform:translateX(-50%);font-size:10px;color:var(--text-muted);white-space:nowrap;text-align:center}

/* pills */
#sv .pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600}
#sv .pill-success{background:var(--success-bg);color:var(--success)}
#sv .pill-warning{background:var(--warning-bg);color:var(--warning)}
#sv .pill-danger{background:var(--danger-bg);color:var(--danger)}
#sv .pill-muted{background:#F1F5F9;color:var(--text-muted)}
#sv .rating-val{color:var(--teal);font-weight:700}

/* buttons */
#sv .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);transition:border .15s}
#sv .btn:hover{border-color:var(--navy)}
#sv .btn-sm{padding:5px 10px;font-size:12px}
#sv .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}
#sv .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}
#sv .btn[disabled]{opacity:.5;cursor:not-allowed}

/* info banner */
#sv .info-banner{background:var(--info-bg);border:1px solid #BFDBFE;color:var(--info);padding:11px 14px;border-radius:8px;margin-bottom:14px;font-size:13px}

/* empty / loading */
#sv .empty{text-align:center;padding:40px 20px;color:var(--text-muted)}
#sv .empty-icon{width:48px;height:48px;border-radius:12px;background:#F1F5F9;color:var(--text-faint);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px}
#sv .empty-icon svg{width:24px;height:24px}
#sv .empty-title{font-size:14px;font-weight:600;color:var(--text)}
#sv .loading{padding:30px;text-align:center;color:var(--text-muted)}

/* detail grid */
#sv .detail-grid{display:grid;grid-template-columns:130px 1fr;gap:8px 14px;font-size:13px}
#sv .detail-label{color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#sv .detail-value{color:var(--text);word-break:break-word}

/* send form */
#sv .form-row{margin-bottom:14px}
#sv .form-row label{display:block;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500;margin-bottom:5px}
#sv .form-row select,#sv .form-row input,#sv .form-row textarea{width:100%;padding:9px 12px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);box-sizing:border-box}
#sv .form-row textarea{min-height:90px;resize:vertical}
#sv .form-row select:focus,#sv .form-row input:focus,#sv .form-row textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.08)}
#sv .star-row{display:flex;gap:6px}
#sv .star{font-size:28px;line-height:1;cursor:pointer;color:var(--border-strong);transition:color .1s;user-select:none}
#sv .star.on{color:#F59E0B}
#sv .check-row{display:flex;align-items:center;gap:8px}
#sv .check-row input{width:auto}
#sv .check-row label{margin:0;text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)}

/* modal */
#sv-modal-bg{display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9000;align-items:center;justify-content:center;padding:20px}
#sv-modal-bg.active{display:flex}
#sv .sv-modal{background:var(--surface);border-radius:12px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.25)}
#sv .sv-modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}
#sv .sv-modal-header h2{font-size:16px;font-weight:600;color:var(--navy);margin:0}
#sv .sv-modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}
#sv .sv-modal-body{padding:20px 24px;flex:1;overflow-y:auto}
#sv .sv-modal-footer{padding:14px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px}
</style>
<div id="sv">

  <div class="tab-row">
    <button class="tab-btn active" id="sv-tab-overview">Overview</button>
    <button class="tab-btn" id="sv-tab-responses">Responses</button>
    <button class="tab-btn" id="sv-tab-trends">Trends</button>
    <button class="tab-btn" id="sv-tab-send">ส่งคำตอบ</button>
  </div>

  <!-- OVERVIEW -->
  <div id="sv-panel-overview">
    <div class="info-banner" id="sv-ov-banner">กำลังโหลด...</div>
    <div class="stats" id="sv-stats"></div>
  </div>

  <!-- RESPONSES -->
  <div id="sv-panel-responses" style="display:none">
    <div class="filters">
      <div class="filter">
        <label>Survey type</label>
        <select id="sv-f-type"><option value="">ทุกประเภท</option>${typeOpts}</select>
      </div>
      <div class="filter">
        <label>ค้นหา</label>
        <input type="search" id="sv-f-search" placeholder="รหัส / พนักงาน / comment">
      </div>
      <div class="filter">
        <label>ตั้งแต่</label>
        <input type="date" id="sv-f-from">
      </div>
      <div class="filter">
        <label>ถึง</label>
        <input type="date" id="sv-f-to">
      </div>
    </div>
    <div id="sv-resp-content"></div>
  </div>

  <!-- TRENDS -->
  <div id="sv-panel-trends" style="display:none">
    <div class="filters">
      <div class="filter">
        <label>Survey type</label>
        <select id="sv-t-type"><option value="">ทุกประเภท</option>${typeOpts}</select>
      </div>
    </div>
    <div id="sv-trend-content"></div>
  </div>

  <!-- SEND -->
  <div id="sv-panel-send" style="display:none">
    <div class="section">
      <div class="section-header">
        <div class="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></div>
        <div style="flex:1">
          <div class="section-title">ส่งคำตอบแบบสอบถาม</div>
          <div class="section-sub">สร้าง response ใหม่เข้าระบบ</div>
        </div>
      </div>
      <div class="section-body">
        <div class="form-row">
          <label>ประเภทแบบสอบถาม</label>
          <select id="sv-form-type">${formTypeOpts}</select>
        </div>
        <div class="form-row">
          <label>รหัสพนักงาน (employee_id)</label>
          <input type="text" id="sv-form-emp" placeholder="เช่น YY-XNU-013">
        </div>
        <div class="form-row">
          <label>คะแนน (Rating)</label>
          <div class="star-row" id="sv-form-stars"></div>
        </div>
        <div class="form-row">
          <label>ความคิดเห็น (Comment)</label>
          <textarea id="sv-form-comment" placeholder="พิมพ์ความคิดเห็น..."></textarea>
        </div>
        <div class="form-row check-row">
          <input type="checkbox" id="sv-form-anon" checked>
          <label for="sv-form-anon">ไม่ระบุตัวตน (anonymous)</label>
        </div>
        <button class="btn btn-primary" id="sv-form-submit">ส่งคำตอบ</button>
      </div>
    </div>
  </div>

  <!-- Detail Modal -->
  <div id="sv-modal-bg">
    <div class="sv-modal">
      <div class="sv-modal-header">
        <h2 id="sv-modal-title">รายละเอียดคำตอบ</h2>
        <p id="sv-modal-sub"></p>
      </div>
      <div class="sv-modal-body" id="sv-modal-body"></div>
      <div class="sv-modal-footer">
        <button class="btn" id="sv-modal-close">ปิด</button>
      </div>
    </div>
  </div>

</div>`;

  // tabs
  $('sv-tab-overview').onclick  = () => svSetTab('overview');
  $('sv-tab-responses').onclick = () => svSetTab('responses');
  $('sv-tab-trends').onclick    = () => svSetTab('trends');
  $('sv-tab-send').onclick      = () => svSetTab('send');

  // responses filters (client-side)
  $('sv-f-type').onchange   = () => { _svState.filterType = $('sv-f-type').value; svRenderResponses(); };
  $('sv-f-search').oninput  = () => { _svState.filterSearch = $('sv-f-search').value; svRenderResponses(); };
  $('sv-f-from').onchange   = () => { _svState.filterFrom = $('sv-f-from').value; svRenderResponses(); };
  $('sv-f-to').onchange     = () => { _svState.filterTo = $('sv-f-to').value; svRenderResponses(); };

  // trends filter
  $('sv-t-type').onchange   = () => { _svState.filterType = $('sv-t-type').value; svRenderTrends(); };

  // modal
  $('sv-modal-close').onclick = svCloseModal;
  $('sv-modal-bg').onclick = (e) => { if (e.target === $('sv-modal-bg')) svCloseModal(); };

  // send form
  svRenderStars();
  $('sv-form-type').onchange    = () => { _svState.form.type = $('sv-form-type').value; };
  $('sv-form-emp').oninput      = () => { _svState.form.emp = $('sv-form-emp').value; };
  $('sv-form-comment').oninput  = () => { _svState.form.comment = $('sv-form-comment').value; };
  $('sv-form-anon').onchange    = () => { _svState.form.anonymous = $('sv-form-anon').checked; };
  $('sv-form-submit').onclick   = svSubmit;

  svLoad();
}

function svSetTab(tab) {
  _svState.tab = tab;
  ['overview', 'responses', 'trends', 'send'].forEach(t => {
    if ($('sv-tab-' + t)) $('sv-tab-' + t).classList.toggle('active', t === tab);
    if ($('sv-panel-' + t)) $('sv-panel-' + t).style.display = (t === tab) ? '' : 'none';
  });
  if (tab === 'overview') svRenderOverview();
  else if (tab === 'responses') svRenderResponses();
  else if (tab === 'trends') svRenderTrends();
}

async function svLoad() {
  try {
    const { data } = await sb.functions.invoke('hr_survey_response');
    _svState.items = (data && data.items) || [];
  } catch (e) {
    console.error('svLoad', e);
    _svState.items = [];
  }
  svRender();
}

function svRender() {
  // sidebar badge = จำนวน response ทั้งหมด
  const ct = document.getElementById('ct-survey');
  if (ct) ct.textContent = _svState.items.length || '';
  // render tab ที่ active อยู่
  svSetTab(_svState.tab);
}

// ---- helpers: ดึง field จาก row (ทนชื่อหลายแบบ) ----
function svRowType(r)   { return r.survey_type || r.type || ''; }
function svRowDate(r)   { return r.submitted_at || r.created_at || r.date || ''; }
function svRowRating(r) { const v = r.rating; return (v == null || v === '') ? null : Number(v); }
function svRowName(r)   { return r.nickname || r.employee_name || r.employee_id || '—'; }

// ============ OVERVIEW ============
function svRenderOverview() {
  const items = _svState.items;
  const banner = $('sv-ov-banner');
  if (banner) {
    banner.innerHTML = '<strong>' + items.length + '</strong> คำตอบทั้งหมด · คลิกที่การ์ดเพื่อดู responses ของประเภทนั้น';
  }

  const stats = SV_TYPES.map(t => {
    const rows = items.filter(r => svRowType(r) === t.key);
    const ratings = rows.map(svRowRating).filter(v => v != null && !isNaN(v));
    const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : null;
    const thisMonth = rows.filter(r => svSamePeriod(svRowDate(r), svNowPeriod())).length;
    const last = rows.map(svRowDate).filter(Boolean).sort().slice(-1)[0] || '';
    return { key: t.key, label: t.label, total: rows.length, thisMonth, avg, last };
  });

  const el = $('sv-stats');
  if (!el) return;
  el.innerHTML = stats.map(x =>
    '<div class="stat" data-sv-card="' + esc(x.key) + '">' +
      '<div class="stat-stripe"></div>' +
      '<div class="stat-label">' + esc(x.key) + '</div>' +
      '<div class="stat-name">' + esc(x.label) + '</div>' +
      '<div class="stat-big">' + x.total + '</div>' +
      '<div class="stat-row"><span>เดือนนี้</span><strong>' + x.thisMonth + '</strong></div>' +
      (x.avg != null ? '<div class="stat-row"><span>Avg rating</span><strong>' + x.avg.toFixed(1) + '/' + SV_SCALE + '</strong></div>' : '') +
      '<div class="stat-row muted"><span>ล่าสุด</span><span>' + esc(String(x.last || '-').slice(0, 10)) + '</span></div>' +
    '</div>'
  ).join('');

  Array.prototype.forEach.call(el.querySelectorAll('[data-sv-card]'), card => {
    card.onclick = () => {
      _svState.filterType = card.getAttribute('data-sv-card');
      if ($('sv-f-type')) $('sv-f-type').value = _svState.filterType;
      svSetTab('responses');
    };
  });
}

// ============ RESPONSES ============
function svFiltered() {
  const q = _svState.filterSearch.trim().toLowerCase();
  const from = _svState.filterFrom;
  const to = _svState.filterTo;
  return _svState.items.filter(r => {
    if (_svState.filterType && svRowType(r) !== _svState.filterType) return false;
    const d = String(svRowDate(r) || '').slice(0, 10);
    if (from && d && d < from) return false;
    if (to && d && d > to) return false;
    if (q) {
      const hay = (String(r.employee_id || '') + ' ' + svRowName(r) + ' ' +
                   String(r.comment || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function svRenderResponses() {
  const el = $('sv-resp-content');
  if (!el) return;
  const rows = svFiltered();

  if (!rows.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="empty-title">ไม่มี responses</div></div>';
    return;
  }

  // rating distribution + avg (stat จาก list)
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let hasRating = false;
  rows.forEach(r => { const v = svRowRating(r); if (v != null && dist[v] != null) { dist[v]++; hasRating = true; } });
  const ratings = rows.map(svRowRating).filter(v => v != null && !isNaN(v));
  const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length) : null;

  let distHtml = '';
  if (hasRating) {
    distHtml =
      '<div class="section"><div class="section-header"><div style="flex:1"><div class="section-title">Rating distribution</div>' +
      (avg != null ? '<div class="section-sub">เฉลี่ย ' + avg.toFixed(1) + '/' + SV_SCALE + ' · ' + ratings.length + ' ratings</div>' : '') +
      '</div></div><div class="section-body"><div class="rating-dist">' +
      [1, 2, 3, 4, 5].map(n =>
        '<div class="rd-item"><div class="rd-count">' + (dist[n] || 0) + '</div><div class="rd-label">' + n + ' ดาว</div></div>'
      ).join('') +
      '</div></div></div>';
  }

  const typeLbl = _svState.filterType ? svTypeLabel(_svState.filterType) : 'ทุกประเภท';
  const trs = rows.map((r, i) => {
    const rating = svRowRating(r);
    const comment = String(r.comment || '');
    const commentShort = comment.slice(0, 100) + (comment.length > 100 ? '…' : '');
    const status = r.status ? '<span class="pill ' + svStatusPill(r.status) + '">' + esc(r.status) + '</span>' : '';
    return '<tr data-sv-row="' + i + '">' +
      '<td><div style="font-weight:500">' + esc(svRowName(r)) + '</div>' +
        '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + esc(r.employee_id || '-') + '</div></td>' +
      '<td><span class="pill pill-muted">' + esc(svRowType(r) || '-') + '</span></td>' +
      '<td>' + esc(String(svRowDate(r) || '-').slice(0, 16)) + '</td>' +
      '<td class="center">' + (rating != null ? '<span class="rating-val">' + rating + '/' + SV_SCALE + '</span>' : '-') + '</td>' +
      '<td class="center">' + (status || '-') + '</td>' +
      '<td style="font-size:11px;color:var(--text-muted);max-width:300px">' + esc(commentShort) + '</td>' +
      '</tr>';
  }).join('');

  el.innerHTML = distHtml +
    '<div class="section">' +
      '<div class="section-header"><div style="flex:1"><div class="section-title">' + esc(typeLbl) + ' · ' + rows.length + ' responses</div></div></div>' +
      '<div style="overflow-x:auto"><table class="data-table">' +
        '<thead><tr><th>พนักงาน</th><th>ประเภท</th><th>วันที่</th><th class="center">Rating</th><th class="center">สถานะ</th><th>Comment</th></tr></thead>' +
        '<tbody>' + trs + '</tbody>' +
      '</table></div>' +
    '</div>';

  Array.prototype.forEach.call(el.querySelectorAll('[data-sv-row]'), tr => {
    tr.onclick = () => svOpenDetail(rows[Number(tr.getAttribute('data-sv-row'))]);
  });
}

function svStatusPill(s) {
  const k = String(s).toLowerCase();
  if (k === 'completed' || k === 'pass' || k === 'submitted' || k === 'approved') return 'pill-success';
  if (k === 'in_progress' || k === 'pending' || k === 'extend') return 'pill-warning';
  if (k === 'needs_revision' || k === 'fail' || k === 'rejected') return 'pill-danger';
  return 'pill-muted';
}

function svOpenDetail(r) {
  if (!r) return;
  $('sv-modal-title').textContent = svTypeLabel(svRowType(r)) || 'รายละเอียดคำตอบ';
  $('sv-modal-sub').textContent = (svRowName(r) || '') + (r.employee_id ? ' · ' + r.employee_id : '');

  const rating = svRowRating(r);
  $('sv-modal-body').innerHTML =
    '<div class="detail-grid">' +
      '<div class="detail-label">พนักงาน</div><div class="detail-value">' + esc(svRowName(r)) + (r.employee_id ? ' (' + esc(r.employee_id) + ')' : '') + '</div>' +
      '<div class="detail-label">ประเภท</div><div class="detail-value">' + esc(svRowType(r) || '-') + ' · ' + esc(svTypeLabel(svRowType(r))) + '</div>' +
      '<div class="detail-label">วันที่</div><div class="detail-value">' + esc(svRowDate(r) || '-') + '</div>' +
      '<div class="detail-label">คะแนน</div><div class="detail-value">' + (rating != null ? '<span class="rating-val">' + rating + '/' + SV_SCALE + '</span>' : '-') + '</div>' +
      (r.status ? '<div class="detail-label">สถานะ</div><div class="detail-value"><span class="pill ' + svStatusPill(r.status) + '">' + esc(r.status) + '</span></div>' : '') +
      (r.anonymous != null ? '<div class="detail-label">ไม่ระบุตัวตน</div><div class="detail-value">' + (r.anonymous ? 'ใช่' : 'ไม่') + '</div>' : '') +
      '<div class="detail-label">ความคิดเห็น</div><div class="detail-value">' + esc(r.comment || '—') + '</div>' +
    '</div>';

  $('sv-modal-bg').classList.add('active');
}

function svCloseModal() {
  const bg = $('sv-modal-bg');
  if (bg) bg.classList.remove('active');
}

// ============ TRENDS ============
function svRenderTrends() {
  const el = $('sv-trend-content');
  if (!el) return;
  if ($('sv-t-type')) $('sv-t-type').value = _svState.filterType;

  const rows = _svState.items.filter(r => !_svState.filterType || svRowType(r) === _svState.filterType);
  // group ตามเดือน (YYYY-MM) → avg rating + count
  const byMonth = {};
  rows.forEach(r => {
    const d = String(svRowDate(r) || '').slice(0, 7); // YYYY-MM
    if (!d) return;
    const v = svRowRating(r);
    if (!byMonth[d]) byMonth[d] = { sum: 0, n: 0, count: 0 };
    byMonth[d].count++;
    if (v != null && !isNaN(v)) { byMonth[d].sum += v; byMonth[d].n++; }
  });
  const periods = Object.keys(byMonth).sort();

  if (!periods.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div><div class="empty-title">ไม่มีข้อมูล trend</div></div>';
    return;
  }

  const typeLbl = _svState.filterType ? svTypeLabel(_svState.filterType) : 'ทุกประเภท';
  const bars = periods.map(p => {
    const m = byMonth[p];
    const avg = m.n ? (m.sum / m.n) : null;
    const h = avg ? (avg / SV_SCALE) * 100 : 2;
    const color = h > 80 ? 'var(--success)' : h > 60 ? 'var(--teal)' : h > 40 ? 'var(--warning)' : 'var(--danger)';
    return '<div class="trend-bar" style="height:' + h + '%;background:' + color + '">' +
      '<div class="bar-label">' + (avg != null ? avg.toFixed(1) : '-') + '</div>' +
      '<div class="bar-period">' + esc(p) + '<br>(' + m.count + ')</div>' +
      '</div>';
  }).join('');

  el.innerHTML =
    '<div class="section">' +
      '<div class="section-header"><div style="flex:1"><div class="section-title">' + esc(typeLbl) + ' · Avg rating per month</div>' +
        '<div class="section-sub">' + periods.length + ' periods · เลขในวงเล็บ = จำนวน responses · max scale ' + SV_SCALE + '</div></div></div>' +
      '<div class="section-body"><div class="trend-bars">' + bars + '</div><div style="height:30px"></div></div>' +
    '</div>';
}

// ============ SEND FORM ============
function svRenderStars() {
  const el = $('sv-form-stars');
  if (!el) return;
  const cur = _svState.form.rating || 0;
  el.innerHTML = '';
  for (let n = 1; n <= SV_SCALE; n++) {
    const s = document.createElement('span');
    s.className = 'star' + (n <= cur ? ' on' : '');
    s.textContent = '★';
    s.onclick = () => { _svState.form.rating = (_svState.form.rating === n ? null : n); svRenderStars(); };
    el.appendChild(s);
  }
}

async function svSubmit() {
  if (_svState.sending) return;
  const f = _svState.form;
  if (!f.type) { alert('เลือกประเภทแบบสอบถาม'); return; }
  if (f.rating == null && !String(f.comment || '').trim()) {
    alert('ใส่คะแนนหรือความคิดเห็นอย่างน้อย 1 อย่าง'); return;
  }

  _svState.sending = true;
  const btn = $('sv-form-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังส่ง...'; }

  try {
    const { data, error } = await sb.functions.invoke('hr_survey_response', {
      body: {
        survey_type: f.type,
        employee_id: f.emp || null,
        rating: f.rating,
        comment: f.comment || '',
        anonymous: f.anonymous,
      },
    });
    if (error || (data && data.error)) {
      alert('ส่งไม่สำเร็จ: ' + ((data && data.error) || (error && error.message) || ''));
      return;
    }
    alert('ส่งคำตอบสำเร็จ');
    _svState.form = { type: f.type, rating: null, comment: '', anonymous: true, emp: '' };
    if ($('sv-form-emp')) $('sv-form-emp').value = '';
    if ($('sv-form-comment')) $('sv-form-comment').value = '';
    if ($('sv-form-anon')) $('sv-form-anon').checked = true;
    svRenderStars();
    await svLoad();
  } catch (e) {
    alert('ส่งไม่สำเร็จ: ' + (e && e.message || ''));
  } finally {
    _svState.sending = false;
    if (btn) { btn.disabled = false; btn.textContent = 'ส่งคำตอบ'; }
  }
}

// ---- period helpers (เดือนปัจจุบัน YYYY-MM) ----
function svNowPeriod() { return new Date().toISOString().slice(0, 7); }
function svSamePeriod(dateStr, period) {
  return String(dateStr || '').slice(0, 7) === period;
}
