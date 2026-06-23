// _ported/announce.js — native port of desktop announcement_manager.html (HR Announcement admin)
// ลอก markup + CSS เดิม (จาก _shared_styles + <style> ในหน้า) · scoped ทั้งหมดใต้ #an (กันชน CSS dashboard)
//   element id prefix an2-  ·  var/fn prefix an2/AN2
// ใช้ global sb + esc + $ (มีอยู่แล้วใน index.html · module scope) — ห้าม redeclare
//
// backend (edge function hr_announce):
//   - list:   sb.functions.invoke('hr_announce')                  -> { announcements:[...] }
//             payload: title, body, audience, category, effective_date, requires_ack, posted_by, posted_at
//   - create: sb.functions.invoke('hr_announce', { body: {
//                 title, body, audience, category, effective_date, requires_ack
//             }})
//
// โครงหน้า desktop ที่ลอกมา (จากของจริง 4 view แต่ scope ลงตาม backend ที่มี):
//   - header แถบ gradient + ปุ่ม Refresh / เขียนใหม่
//   - view switcher: Dashboard / List  (Calendar/Analytics ของเดิมต้องใช้ lookups+stats backend → ตัดออก)
//   - status tabs (5): ทั้งหมด/Draft/Scheduled/Published/Archived  (นับ client-side จาก status)
//   - filter bar: ค้นหา + หมวด + ช่วงเวลา (client-side)
//   - Dashboard: stat cards (5) + category breakdown bar · คำนวณจาก list
//   - List view: การ์ดประกาศ (ann-card) เหมือนเดิม + meta pills + sort
//   - create modal: ฟอร์มเขียนประกาศใหม่ (6 ฟิลด์ตาม backend)

/* category — 8 ค่า (label mirror CATEGORY_META + getAnnCategories ในของเดิม) */
var AN2_CATEGORIES = [
  { v: 'general',      l: 'ทั่วไป',           color: '#94A3B8' },
  { v: 'policy',       l: 'นโยบาย/ระเบียบ',    color: '#1D4ED8' },
  { v: 'welfare',      l: 'สวัสดิการ',         color: '#2BA89B' },
  { v: 'activity',     l: 'กิจกรรม/CSR',       color: '#6D28D9' },
  { v: 'urgent',       l: 'ด่วน',              color: '#B91C1C' },
  { v: 'monthly',      l: 'บอร์ดประจำเดือน',   color: '#6D28D9' },
  { v: 'permanent',    l: 'บอร์ดถาวร',         color: '#0D2F4F' },
  { v: 'announcement', l: 'แจ้งเตือนทั่วไป',    color: '#94A3B8' }
];

function an2CatMeta(cat) {
  var c = String(cat || 'general').toLowerCase();
  for (var i = 0; i < AN2_CATEGORIES.length; i++) {
    if (AN2_CATEGORIES[i].v === c) return AN2_CATEGORIES[i];
  }
  return { v: c, l: cat || 'ทั่วไป', color: '#94A3B8' };
}
function an2CatLabel(cat) { return an2CatMeta(cat).l; }

// state เฉพาะหน้านี้ (prefix an2)
var _an2State = {
  view: 'dashboard',     // 'dashboard' | 'list'
  tab: 'all',            // 'all' | 'draft' | 'scheduled' | 'published' | 'archived'
  items: [],             // raw announcements จาก backend
  filterSearch: '',
  filterCategory: '',
  filterRange: 'all',    // all | month | last30 | last90 | year
  sort: 'newest',
  posting: false
};

/* status ของ row — backend อาจไม่ส่ง status (LINE-style create) → default published */
function an2Status(a) {
  return String(a.status || 'published').toLowerCase();
}

/* mountAnnounceP — render desktop announcement manager ลง #wrap-announce_p
   No-op ถ้าไม่มี container (return เงียบ ๆ) */
function mountAnnounceP() {
  var wrap = document.getElementById('wrap-announce_p');
  if (!wrap) return;

  var catOpts = AN2_CATEGORIES
    .map(function (c) { return '<option value="' + c.v + '">' + esc(c.l) + '</option>'; })
    .join('');
  var filterCatOpts = '<option value="">ทุกหมวด</option>' + catOpts;

  wrap.innerHTML = ''
    + '<style>'
    // scope root + tokens (ก๊อปจาก _shared_styles + <style> หน้า manager · prefix #an)
    + '#an{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px}'

    // header
    + '#an .main-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;gap:16px;flex-wrap:wrap}'
    + '#an .main-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:10px}'
    + '#an .main-head h1 svg{width:20px;height:20px;color:var(--teal)}'
    + '#an .main-head h1 .badge-version{font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;background:var(--teal);color:var(--navy);letter-spacing:.04em}'
    + '#an .main-head .sub{font-size:12px;color:var(--text-muted);margin-top:4px}'
    + '#an .head-actions{display:flex;gap:8px;flex-wrap:wrap}'
    + '#an .btn-icon-only{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;background:#fff;border:1px solid var(--border);color:var(--text-muted);cursor:pointer}'
    + '#an .btn-icon-only:hover{border-color:var(--teal);color:var(--teal-dark)}'
    + '#an .btn-icon-only svg{width:14px;height:14px}'

    // buttons
    + '#an .btn{padding:8px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);transition:border .15s;display:inline-flex;align-items:center;gap:6px}'
    + '#an .btn:hover{border-color:var(--navy)}'
    + '#an .btn svg{width:14px;height:14px}'
    + '#an .btn-sm{padding:5px 10px;font-size:12px}'
    + '#an .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}'
    + '#an .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}'
    + '#an .btn[disabled]{opacity:.5;cursor:not-allowed}'

    // view switcher
    + '#an .view-switcher{display:inline-flex;padding:4px;background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:14px}'
    + '#an .vs-tab{padding:7px 14px;border:0;background:transparent;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .12s}'
    + '#an .vs-tab:hover{color:var(--navy)}'
    + '#an .vs-tab.active{background:var(--navy);color:#fff;box-shadow:0 1px 3px rgba(13,47,79,.2)}'
    + '#an .vs-tab svg{width:13px;height:13px}'

    // status tabs
    + '#an .tabs{display:inline-flex;gap:4px;padding:4px;background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;flex-wrap:wrap}'
    + '#an .tab{padding:7px 12px;border:0;background:transparent;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .12s}'
    + '#an .tab:hover{color:var(--navy)}'
    + '#an .tab.active{background:#E6F7F5;color:var(--teal-dark);font-weight:600}'
    + '#an .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--border);color:var(--text-muted);font-weight:700}'
    + '#an .tab.active .cnt{background:var(--teal);color:#fff}'

    // filter bar
    + '#an .filter-bar{background:#fff;border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:12px}'
    + '#an .filter-row{display:grid;grid-template-columns:1.8fr 1.2fr 1.2fr auto;gap:8px;align-items:end}'
    + '@media (max-width:700px){#an .filter-row{grid-template-columns:1fr}}'
    + '#an .filter-field{display:flex;flex-direction:column;gap:4px;min-width:0}'
    + '#an .filter-field>label{font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}'
    + '#an .filter-field input[type=search],#an .filter-field select{height:32px;box-sizing:border-box;padding:0 10px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:12px;color:var(--text);background:#fff;width:100%}'
    + '#an .filter-field input[type=search]:focus,#an .filter-field select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}'

    // dashboard stat cards
    + '#an .dash-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:18px}'
    + '@media (max-width:1100px){#an .dash-grid{grid-template-columns:repeat(3,1fr)}}'
    + '@media (max-width:600px){#an .dash-grid{grid-template-columns:repeat(2,1fr)}}'
    + '#an .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;position:relative;overflow:hidden}'
    + '#an .stat-card .stripe{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}'
    + '#an .stat-card .stat-label{font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}'
    + '#an .stat-card .stat-value{font-size:26px;font-weight:700;color:var(--navy);line-height:1;margin-top:6px;letter-spacing:-.02em}'
    + '#an .stat-card .stat-sub{font-size:11px;color:var(--text-muted);margin-top:4px}'

    // panel + category bar list
    + '#an .panel{background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:18px}'
    + '#an .panel-title{font-size:12px;font-weight:700;color:var(--navy);letter-spacing:-.01em;display:flex;align-items:center;gap:6px;margin-bottom:12px}'
    + '#an .panel-title svg{width:14px;height:14px;color:var(--teal-dark)}'
    + '#an .bar-list{display:flex;flex-direction:column;gap:8px}'
    + '#an .bar-row{display:grid;grid-template-columns:120px 1fr 40px;gap:10px;align-items:center;font-size:11px}'
    + '#an .bar-row .lbl{font-weight:500;color:var(--text)}'
    + '#an .bar-track{height:18px;background:var(--border);border-radius:4px;overflow:hidden;position:relative}'
    + '#an .bar-track .fill{height:100%;transition:width .4s;border-radius:4px;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;color:#fff;font-size:10px;font-weight:600}'
    + '#an .bar-row .cnt{font-size:11px;font-weight:600;color:var(--navy);text-align:right}'
    + '#an .perf-empty{padding:18px 10px;text-align:center;font-size:11px;color:var(--text-faint)}'

    // section head (list)
    + '#an .section-head{display:flex;justify-content:space-between;align-items:center;margin:0 0 10px}'
    + '#an .section-head .ttl{font-size:13px;font-weight:700;color:var(--navy)}'
    + '#an .section-head .sub{font-size:11px;color:var(--text-muted);font-weight:400;margin-left:6px}'
    + '#an .section-head select{padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;background:#fff;font-family:inherit}'

    // list cards (ann-card)
    + '#an .ann-grid{display:flex;flex-direction:column;gap:10px}'
    + '#an .ann-card{background:#fff;border:1px solid var(--border);border-left:3px solid transparent;border-radius:10px;padding:14px 16px;cursor:pointer;transition:all .12s;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:flex-start}'
    + '#an .ann-card:hover{border-color:var(--teal);box-shadow:0 2px 8px rgba(13,47,79,.06)}'
    + '#an .ann-card.draft{border-left-color:var(--info)}'
    + '#an .ann-card.scheduled{border-left-color:var(--warning)}'
    + '#an .ann-card.published{border-left-color:var(--success)}'
    + '#an .ann-card.archived{opacity:.7;border-left-color:var(--text-faint)}'
    + '#an .ann-meta-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center}'
    + '#an .meta-pill{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;line-height:1}'
    + '#an .meta-pill svg{width:11px;height:11px;flex-shrink:0}'
    + '#an .pill-cat{background:var(--info-bg);color:var(--info)}'
    + '#an .pill-st-draft{background:var(--info-bg);color:var(--info)}'
    + '#an .pill-st-scheduled{background:var(--warning-bg);color:var(--warning)}'
    + '#an .pill-st-published{background:var(--success-bg);color:var(--success)}'
    + '#an .pill-st-archived{background:var(--border);color:var(--text-muted)}'
    + '#an .pill-ack{background:#FCE7F3;color:#BE185D}'
    + '#an .pill-date{background:#F1F5F9;color:var(--text-muted);font-weight:500}'
    + '#an .ann-title{font-size:14px;font-weight:600;color:var(--navy);margin-top:4px;line-height:1.4}'
    + '#an .ann-preview{font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
    + '#an .ann-targets{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#F8FAFC;border-radius:12px;font-size:11px;color:var(--text-muted);margin-top:8px}'
    + '#an .ann-targets svg{width:12px;height:12px}'
    + '#an .ann-stats{display:flex;flex-direction:column;gap:5px;align-items:flex-end;min-width:120px}'
    + '#an .stat-line{font-size:11px;color:var(--text-muted)}'
    + '#an .stat-line strong{color:var(--navy);font-weight:700}'

    // empty / loading
    + '#an .empty{padding:50px 20px;text-align:center;background:#fff;border:1px dashed var(--border);border-radius:10px}'
    + '#an .empty svg{width:40px;height:40px;color:var(--text-faint);margin-bottom:10px}'
    + '#an .empty-title{font-size:14px;font-weight:600;color:var(--text-muted)}'
    + '#an .empty-sub{font-size:12px;color:var(--text-faint);margin-top:4px}'
    + '#an .loading{padding:40px;text-align:center;color:var(--text-muted)}'

    // create modal
    + '#an .an2-modal-bg{display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9000;align-items:center;justify-content:center;padding:20px}'
    + '#an .an2-modal-bg.active{display:flex}'
    + '#an .an2-modal{background:#fff;border-radius:12px;width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.25)}'
    + '#an .an2-modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}'
    + '#an .an2-modal-header h2{font-size:16px;font-weight:600;color:var(--navy);margin:0}'
    + '#an .an2-modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}'
    + '#an .an2-modal-body{padding:20px 24px;flex:1;overflow-y:auto}'
    + '#an .an2-modal-footer{padding:14px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;align-items:center}'
    + '#an .an2-field{margin-bottom:12px}'
    + '#an .an2-field label{display:block;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px}'
    + '#an .an2-field input,#an .an2-field select,#an .an2-field textarea{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:#fff}'
    + '#an .an2-field input:focus,#an .an2-field select:focus,#an .an2-field textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}'
    + '#an .an2-field textarea{min-height:110px;resize:vertical;line-height:1.6}'
    + '#an .an2-ack{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--navy);font-weight:500;text-transform:none;letter-spacing:0}'
    + '#an .an2-ack input{width:auto}'
    + '#an .an2-note{background:#FEF3C7;border-radius:8px;padding:10px;font-size:12px;color:#854F0B;margin-top:6px}'
    + '#an .an2-msg{font-size:12px;color:var(--teal-dark);margin-right:auto}'
    + '#an .an2-msg.err{color:var(--danger)}'
    + '</style>'

    + '<div id="an">'

    // ===== header =====
    +   '<div class="main-head">'
    +     '<div>'
    +       '<h1><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>'
    +         'Announcements<span class="badge-version">v2</span></h1>'
    +       '<p class="sub">เขียนประกาศ + ดูรายการ · สถิติตามหมวด/สถานะ</p>'
    +     '</div>'
    +     '<div class="head-actions">'
    +       '<button class="btn-icon-only" id="an2-refresh" title="Refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-9-9c2.5 0 4.85.99 6.6 2.6L21 8"/><path d="M21 3v5h-5"/></svg></button>'
    +       '<button class="btn btn-primary" id="an2-new"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>เขียนใหม่</button>'
    +     '</div>'
    +   '</div>'

    // ===== view switcher =====
    +   '<div class="view-switcher">'
    +     '<button class="vs-tab active" data-view="dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>Dashboard</button>'
    +     '<button class="vs-tab" data-view="list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>List</button>'
    +   '</div>'

    // ===== status tabs =====
    +   '<div class="tabs">'
    +     '<button class="tab active" data-tab="all">ทั้งหมด <span class="cnt" id="an2-cnt-all">—</span></button>'
    +     '<button class="tab" data-tab="draft">Draft <span class="cnt" id="an2-cnt-draft">—</span></button>'
    +     '<button class="tab" data-tab="scheduled">Scheduled <span class="cnt" id="an2-cnt-scheduled">—</span></button>'
    +     '<button class="tab" data-tab="published">Published <span class="cnt" id="an2-cnt-published">—</span></button>'
    +     '<button class="tab" data-tab="archived">Archived <span class="cnt" id="an2-cnt-archived">—</span></button>'
    +   '</div>'

    // ===== filter bar =====
    +   '<div class="filter-bar"><div class="filter-row">'
    +     '<div class="filter-field"><label>ค้นหา</label><input type="search" id="an2-f-search" placeholder="title / body / audience"></div>'
    +     '<div class="filter-field"><label>หมวด</label><select id="an2-f-category">' + filterCatOpts + '</select></div>'
    +     '<div class="filter-field"><label>ช่วงเวลา</label><select id="an2-f-range">'
    +       '<option value="all">ทั้งหมด</option><option value="month">เดือนนี้</option>'
    +       '<option value="last30">30 วันล่าสุด</option><option value="last90">90 วันล่าสุด</option>'
    +       '<option value="year">ปีนี้</option></select></div>'
    +     '<div class="filter-field"><label>&nbsp;</label><button class="btn-icon-only" id="an2-clear" title="ล้าง filter"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
    +   '</div></div>'

    // ===== dashboard view =====
    +   '<section id="an2-view-dashboard">'
    +     '<div class="dash-grid">'
    +       '<div class="stat-card"><div class="stripe" style="background:var(--navy)"></div><div class="stat-label">ทั้งหมด</div><div class="stat-value" id="an2-d-total">—</div><div class="stat-sub">ทุกสถานะ</div></div>'
    +       '<div class="stat-card"><div class="stripe" style="background:var(--success)"></div><div class="stat-label">Published</div><div class="stat-value" id="an2-d-published">—</div><div class="stat-sub">ส่งจริง</div></div>'
    +       '<div class="stat-card"><div class="stripe" style="background:var(--info)"></div><div class="stat-label">Draft</div><div class="stat-value" id="an2-d-draft">—</div><div class="stat-sub">รอ publish</div></div>'
    +       '<div class="stat-card"><div class="stripe" style="background:var(--teal)"></div><div class="stat-label">ต้องรับทราบ</div><div class="stat-value" id="an2-d-ack">—</div><div class="stat-sub">requires ack</div></div>'
    +       '<div class="stat-card"><div class="stripe" style="background:#F59E0B"></div><div class="stat-label">เดือนนี้</div><div class="stat-value" id="an2-d-month">—</div><div class="stat-sub">ประกาศใหม่</div></div>'
    +     '</div>'
    +     '<div class="panel">'
    +       '<div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>ตามหมวด</div>'
    +       '<div class="bar-list" id="an2-cat-breakdown"></div>'
    +     '</div>'
    +   '</section>'

    // ===== list view =====
    +   '<section id="an2-view-list" style="display:none">'
    +     '<div class="section-head">'
    +       '<div class="ttl">รายการประกาศ <span class="sub" id="an2-list-count">—</span></div>'
    +       '<select id="an2-f-sort">'
    +         '<option value="newest">ใหม่สุดก่อน</option><option value="oldest">เก่าสุดก่อน</option>'
    +       '</select>'
    +     '</div>'
    +     '<div id="an2-content" class="loading">กำลังโหลด...</div>'
    +   '</section>'

    // ===== create modal =====
    +   '<div class="an2-modal-bg" id="an2-modal-bg">'
    +     '<div class="an2-modal">'
    +       '<div class="an2-modal-header"><h2>เขียนประกาศใหม่</h2><p>กรอกข้อมูล → ระบบส่งให้พนักงานตาม audience</p></div>'
    +       '<div class="an2-modal-body">'
    +         '<div class="an2-field"><label>หัวข้อ *</label><input id="an2-title" placeholder="เช่น ปรับเวลาทำการช่วงเทศกาล"></div>'
    +         '<div class="an2-field"><label>หมวด</label><select id="an2-category">' + catOpts + '</select></div>'
    +         '<div class="an2-field"><label>เนื้อหา</label><textarea id="an2-body" placeholder="เนื้อหาประกาศ..."></textarea></div>'
    +         '<div class="an2-field"><label>กลุ่มเป้าหมาย (audience)</label><input id="an2-audience" placeholder="เช่น ทุกสาขา / แผนกบัญชี (เว้นว่าง = ทั้งหมด)"></div>'
    +         '<div class="an2-field"><label>วันที่มีผลบังคับใช้</label><input id="an2-effective" type="date"></div>'
    +         '<div class="an2-field"><label class="an2-ack"><input id="an2-ack" type="checkbox"> ต้องกดรับทราบ (requires acknowledgement)</label></div>'
    +         '<div class="an2-note">ประกาศจะถูกส่งให้พนักงานตาม audience ที่เลือก · ถ้าติ๊ก "ต้องกดรับทราบ" พนักงานต้องเปิดอ่านและยืนยัน</div>'
    +       '</div>'
    +       '<div class="an2-modal-footer"><div class="an2-msg" id="an2-msg"></div>'
    +         '<button class="btn" id="an2-cancel">ยกเลิก</button>'
    +         '<button class="btn btn-primary" id="an2-submit">โพสต์ประกาศ</button>'
    +       '</div>'
    +     '</div>'
    +   '</div>'

    + '</div>';

  // ===== bind events =====
  Array.prototype.forEach.call(wrap.querySelectorAll('.vs-tab'), function (b) {
    b.onclick = function () { an2SetView(b.getAttribute('data-view')); };
  });
  Array.prototype.forEach.call(wrap.querySelectorAll('.tab'), function (b) {
    b.onclick = function () { an2SetTab(b.getAttribute('data-tab')); };
  });
  $('an2-f-search').oninput   = function () { _an2State.filterSearch = $('an2-f-search').value; an2Render(); };
  $('an2-f-category').onchange = function () { _an2State.filterCategory = $('an2-f-category').value; an2Render(); };
  $('an2-f-range').onchange   = function () { _an2State.filterRange = $('an2-f-range').value; an2Render(); };
  $('an2-f-sort').onchange    = function () { _an2State.sort = $('an2-f-sort').value; an2RenderList(an2Filtered()); };
  $('an2-clear').onclick      = an2ClearFilters;
  $('an2-refresh').onclick    = an2Load;
  $('an2-new').onclick        = an2OpenModal;
  $('an2-cancel').onclick     = an2CloseModal;
  $('an2-submit').onclick     = an2Submit;
  $('an2-modal-bg').onclick   = function (e) { if (e.target === $('an2-modal-bg')) an2CloseModal(); };

  an2Load();
}

/* ============================================================
   VIEW / TAB
   ============================================================ */
function an2SetView(v) {
  _an2State.view = v;
  Array.prototype.forEach.call(document.querySelectorAll('#an .vs-tab'), function (t) {
    t.classList.toggle('active', t.getAttribute('data-view') === v);
  });
  var dash = $('an2-view-dashboard'), list = $('an2-view-list');
  if (dash) dash.style.display = (v === 'dashboard') ? '' : 'none';
  if (list) list.style.display = (v === 'list') ? '' : 'none';
  an2Render();
}

function an2SetTab(tab) {
  _an2State.tab = tab;
  Array.prototype.forEach.call(document.querySelectorAll('#an .tab'), function (t) {
    t.classList.toggle('active', t.getAttribute('data-tab') === tab);
  });
  an2Render();
}

function an2ClearFilters() {
  _an2State.filterSearch = '';
  _an2State.filterCategory = '';
  _an2State.filterRange = 'all';
  if ($('an2-f-search')) $('an2-f-search').value = '';
  if ($('an2-f-category')) $('an2-f-category').value = '';
  if ($('an2-f-range')) $('an2-f-range').value = 'all';
  an2Render();
}

/* ============================================================
   LOAD — sb.functions.invoke('hr_announce') -> { announcements:[...] }
   ============================================================ */
async function an2Load() {
  var content = $('an2-content');
  if (content) { content.className = 'loading'; content.textContent = 'กำลังโหลด...'; }
  try {
    var res = await sb.functions.invoke('hr_announce');
    var data = res && res.data;
    _an2State.items = (data && data.announcements) || [];
  } catch (e) {
    console.error('an2Load', e);
    _an2State.items = [];
    if (content) { content.className = 'empty'; content.innerHTML = '<div class="empty-title">โหลดประกาศไม่สำเร็จ</div>'; }
  }
  an2Render();
}

/* ค่าเวลาของ row สำหรับ sort/range */
function an2When(a) {
  return a.posted_at || a.published_at || a.created_at || a.scheduled_at || a.effective_date || '';
}

/* apply filter (search + category + range) — ไม่รวม status tab (tab apply ทีหลัง) */
function an2ApplyFilters() {
  var q = _an2State.filterSearch.trim().toLowerCase();
  var cat = _an2State.filterCategory;
  var range = _an2State.filterRange;

  var cutoff = null;
  if (range !== 'all') {
    var now = new Date();
    if (range === 'month') cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (range === 'last30') cutoff = new Date(Date.now() - 30 * 86400000);
    else if (range === 'last90') cutoff = new Date(Date.now() - 90 * 86400000);
    else if (range === 'year') cutoff = new Date(now.getFullYear(), 0, 1);
  }

  return _an2State.items.filter(function (a) {
    if (cat && String(a.category || 'general').toLowerCase() !== cat) return false;
    if (cutoff) {
      var t = an2When(a);
      if (!t || new Date(t) < cutoff) return false;
    }
    if (q) {
      var hay = (String(a.title || '') + ' ' + String(a.body || '') + ' ' +
                 String(a.audience || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

/* filter + status tab */
function an2Filtered() {
  var base = an2ApplyFilters();
  if (_an2State.tab === 'all') return base;
  return base.filter(function (a) { return an2Status(a) === _an2State.tab; });
}

/* ============================================================
   RENDER (master) — counts + active view
   ============================================================ */
function an2Render() {
  // status counts ใช้ filter (ยกเว้น status tab) เหมือน onFiltersChanged เดิม
  var c = an2ApplyFilters();
  var cnt = function (s) { return c.filter(function (a) { return an2Status(a) === s; }).length; };
  an2SetText('an2-cnt-all', c.length);
  an2SetText('an2-cnt-draft', cnt('draft'));
  an2SetText('an2-cnt-scheduled', cnt('scheduled'));
  an2SetText('an2-cnt-published', cnt('published'));
  an2SetText('an2-cnt-archived', cnt('archived'));

  // sidebar badge = จำนวนทั้งหมด (ตาม spec เดิม items.length)
  var ct = document.getElementById('ct-announce');
  if (ct) ct.textContent = _an2State.items.length || '';

  var rows = an2Filtered();
  if (_an2State.view === 'dashboard') an2RenderDashboard(rows);
  else an2RenderList(rows);
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function an2RenderDashboard(rows) {
  var st = function (s) { return rows.filter(function (a) { return an2Status(a) === s; }).length; };
  an2SetText('an2-d-total', rows.length);
  an2SetText('an2-d-published', st('published'));
  an2SetText('an2-d-draft', st('draft'));
  an2SetText('an2-d-ack', rows.filter(function (a) { return !!a.requires_ack; }).length);

  // เดือนนี้
  var now = new Date();
  var monthCount = rows.filter(function (a) {
    var t = an2When(a); if (!t) return false;
    var d = new Date(t);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  an2SetText('an2-d-month', monthCount);

  // category breakdown bar
  var catCounts = {};
  rows.forEach(function (a) {
    var id = String(a.category || 'general').toLowerCase();
    catCounts[id] = (catCounts[id] || 0) + 1;
  });
  var catData = Object.keys(catCounts).map(function (id) {
    var m = an2CatMeta(id);
    return { label: m.l, color: m.color, count: catCounts[id] };
  }).sort(function (a, b) { return b.count - a.count; });
  var catMax = Math.max.apply(null, [1].concat(catData.map(function (x) { return x.count; })));

  var wrap = $('an2-cat-breakdown');
  if (!wrap) return;
  wrap.innerHTML = catData.length
    ? catData.map(function (c) {
        return '<div class="bar-row">'
          + '<div class="lbl">' + esc(c.label) + '</div>'
          + '<div class="bar-track"><div class="fill" style="width:' + (c.count / catMax * 100) + '%;background:' + c.color + '">' + (c.count > 0 ? c.count : '') + '</div></div>'
          + '<div class="cnt">' + c.count + '</div>'
          + '</div>';
      }).join('')
    : '<div class="perf-empty">ยังไม่มีประกาศตรง filter นี้</div>';
}

/* ============================================================
   LIST VIEW — ann-card (ลอกจาก renderListView เดิม)
   ============================================================ */
function an2RenderList(rows) {
  var content = $('an2-content');
  if (!content) return;
  content.classList.remove('loading');
  an2SetText('an2-list-count', '— ' + rows.length + ' รายการ');

  if (!rows.length) {
    content.className = '';
    content.innerHTML = '<div class="empty">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>'
      + '<div class="empty-title">ไม่มีประกาศตรง filter นี้</div>'
      + '<div class="empty-sub">กดปุ่ม X เพื่อล้างตัวกรอง · หรือ "เขียนใหม่"</div></div>';
    return;
  }
  content.className = '';

  var list = rows.slice();
  if (_an2State.sort === 'newest') list.sort(function (a, b) { return String(an2When(b)).localeCompare(String(an2When(a))); });
  else if (_an2State.sort === 'oldest') list.sort(function (a, b) { return String(an2When(a)).localeCompare(String(an2When(b))); });

  content.innerHTML = '<div class="ann-grid">' + list.map(function (a) {
    var status = an2Status(a);
    var m = an2CatMeta(a.category);
    var when = an2When(a);
    var dateStr = '';
    if (when) {
      try { dateStr = new Date(when).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); }
      catch (e) { dateStr = String(when).slice(0, 10); }
    }
    var preview = String(a.body_preview || a.body || '');
    var audience = a.audience ? esc(a.audience) : 'ทั้งหมด';
    var ackFlag = a.requires_ack
      ? '<span class="meta-pill pill-ack"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ack</span>'
      : '';
    var posted = a.posted_by ? '<div class="stat-line">โดย <strong>' + esc(a.posted_by) + '</strong></div>' : '';
    var eff = a.effective_date ? '<div class="stat-line">มีผล ' + esc(String(a.effective_date).slice(0, 10)) + '</div>' : '';

    return '<div class="ann-card ' + status + '">'
      + '<div>'
      +   '<div class="ann-meta-row">'
      +     '<span class="meta-pill pill-st-' + status + '">' + esc(status) + '</span>'
      +     '<span class="meta-pill pill-cat">' + esc(m.l) + '</span>'
      +     ackFlag
      +     (dateStr ? '<span class="meta-pill pill-date">' + esc(dateStr) + '</span>' : '')
      +   '</div>'
      +   '<div class="ann-title">' + esc(a.title || '') + '</div>'
      +   (preview ? '<div class="ann-preview">' + esc(preview) + '</div>' : '')
      +   '<div class="ann-targets"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> ' + audience + '</div>'
      + '</div>'
      + '<div class="ann-stats">' + posted + eff + '</div>'
      + '</div>';
  }).join('') + '</div>';
}

/* ============================================================
   CREATE MODAL
   ============================================================ */
function an2OpenModal() {
  var bg = $('an2-modal-bg');
  if (bg) bg.classList.add('active');
}
function an2CloseModal() {
  var bg = $('an2-modal-bg');
  if (bg) bg.classList.remove('active');
}

/* create — body: {title, body, audience, category, effective_date, requires_ack(bool)} */
async function an2Submit() {
  if (_an2State.posting) return;
  var msg = $('an2-msg');
  var btn = $('an2-submit');
  if (msg) { msg.classList.remove('err'); msg.textContent = ''; }

  var title = ($('an2-title').value || '').trim();
  if (!title) {
    if (msg) { msg.classList.add('err'); msg.textContent = 'กรุณาใส่หัวข้อ'; }
    return;
  }

  var body = {
    title: title,
    body: $('an2-body').value || '',
    audience: ($('an2-audience').value || '').trim(),
    category: $('an2-category').value,
    effective_date: $('an2-effective').value || '',
    requires_ack: !!$('an2-ack').checked
  };

  _an2State.posting = true;
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังโพสต์...'; }
  if (msg) msg.textContent = 'กำลังโพสต์…';

  try {
    var res = await sb.functions.invoke('hr_announce', { body: body });
    var data = res && res.data, error = res && res.error;
    if (error || (data && data.error)) {
      if (msg) { msg.classList.add('err'); msg.textContent = 'ผิดพลาด: ' + ((data && data.error) || (error && error.message) || 'unknown'); }
      _an2State.posting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'โพสต์ประกาศ'; }
      return;
    }
  } catch (e) {
    if (msg) { msg.classList.add('err'); msg.textContent = 'ผิดพลาด: ' + (e && e.message || ''); }
    _an2State.posting = false;
    if (btn) { btn.disabled = false; btn.textContent = 'โพสต์ประกาศ'; }
    return;
  }

  // success: clear form + reload
  _an2State.posting = false;
  if (btn) { btn.disabled = false; btn.textContent = 'โพสต์ประกาศ'; }
  $('an2-title').value = '';
  $('an2-body').value = '';
  $('an2-audience').value = '';
  $('an2-effective').value = '';
  $('an2-ack').checked = false;
  if (msg) { msg.classList.remove('err'); msg.textContent = 'โพสต์แล้ว ✓'; }
  an2CloseModal();
  an2Load();
}

/* ============================================================
   helper
   ============================================================ */
function an2SetText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}
