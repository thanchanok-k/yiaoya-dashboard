// _ported/pinfo.js — native port ของ desktop personal_info_manager.html (HR Announcement admin)
// ลอก markup + CSS เดิม · scoped ทั้งหมดใต้ #pi (กันชน CSS dashboard) · element id prefix pi-
// ก๊อป design token จาก _shared_styles (prefix '#pi ') ให้หน้า standalone ได้สีเดิมเป๊ะ
// ใช้ global sb + esc + $ (มีอยู่แล้วใน index.html · module scope) — ห้าม redeclare
// backend:
//   list   : hr_personal_info_request → {items:[...]}
//            (payload: request_id, employee_id, field, new_value, note, status, requested_by,
//             + อาจมี: old_value, employee_name, position, sensitive, attachment_url, reviewer_notes, requested_at)
//   อนุมัติ/ปฏิเสธ : hr_approve {request_id, decision:'approved'|'rejected'} → reload
//
// โครงหน้า desktop ที่ลอกมา:
//   - stat row (4): รออนุมัติ / Sensitive รอ HR Mgr / อนุมัติแล้ว / ไม่อนุมัติ — คำนวณ client-side จาก items
//   - tabs (5): รออนุมัติ / Sensitive / อนุมัติ / ไม่อนุมัติ / ทั้งหมด
//   - filters: ค้นหา / ประเภทข้อมูล (client-side filter)
//   - data-table รายการคำขอ + change-diff + status pill + ปุ่ม "ดู"
//   - detail modal + ปุ่ม Approve / Reject (เฉพาะ pending)
//
// field map (7 ค่า — ตรงกับ LIFF request form):
//   address           ที่อยู่ปัจจุบัน
//   phone             เบอร์โทรศัพท์
//   marital_status    สถานภาพสมรส
//   dependent         ผู้อยู่ในอุปการะ
//   emergency_contact ผู้ติดต่อฉุกเฉิน
//   bank_account      บัญชีธนาคาร      (sensitive)
//   other             อื่นๆ

// ประเภทข้อมูล (label ไทย) + sensitive flag (ใช้ classify ถ้า backend ไม่ส่ง r.sensitive มา)
const PINFO_FIELDS = [
  { key: 'address',           label: 'ที่อยู่ปัจจุบัน',  sensitive: false },
  { key: 'phone',             label: 'เบอร์โทรศัพท์',    sensitive: false },
  { key: 'marital_status',    label: 'สถานภาพสมรส',     sensitive: false },
  { key: 'dependent',         label: 'ผู้อยู่ในอุปการะ', sensitive: false },
  { key: 'emergency_contact', label: 'ผู้ติดต่อฉุกเฉิน', sensitive: false },
  { key: 'bank_account',      label: 'บัญชีธนาคาร',     sensitive: true  },
  { key: 'other',             label: 'อื่นๆ',           sensitive: false },
];

// state เฉพาะหน้านี้ (prefix pi)
let _piState = {
  tab: 'pending',        // 'pending' | 'sensitive' | 'approved' | 'rejected' | 'all'
  items: [],             // raw items จาก backend
  filterSearch: '',
  filterField: '',
  acting: false,         // กัน double-click approve/reject
};

function piFieldLabel(key) {
  const t = PINFO_FIELDS.find(x => x.key === key);
  return t ? t.label : (key || '');
}

// normalize status → 'pending' | 'approved' | 'rejected'
function piStatus(r) {
  const s = String((r && r.status) || '').toLowerCase();
  if (s === 'approved' || s === 'auto_approved') return 'approved';
  if (s === 'rejected') return 'rejected';
  return 'pending';        // '' / pending / อื่น ๆ → ถือเป็นรออนุมัติ
}

// sensitive ? — ใช้ flag จาก backend ก่อน · fallback = field bank_account
function piIsSensitive(r) {
  if (r && (r.sensitive === true || r.sensitive === 1 || r.sensitive === 'true')) return true;
  const f = PINFO_FIELDS.find(x => x.key === (r && r.field));
  return !!(f && f.sensitive);
}

function mountPinfo() {
  const wrap = document.getElementById('wrap-pinfo');
  if (!wrap) return;

  const fieldOpts = PINFO_FIELDS.map(f =>
    '<option value="' + f.key + '">' + esc(f.label) + (f.sensitive ? ' · sensitive' : '') + '</option>'
  ).join('');

  wrap.innerHTML = `
<style>
#pi{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;--sens:#5B21B6;--sens-bg:#EDE9FE;color:var(--text);font-size:13px}

/* tab toggle */
#pi .tab-row{display:flex;gap:6px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;width:fit-content;flex-wrap:wrap}
#pi .tab-btn{padding:7px 14px;border:none;background:transparent;border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}
#pi .tab-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}
#pi .tab-btn .count{font-size:10px;padding:1px 7px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}
#pi .tab-btn.active .count{background:var(--navy)}

/* stats */
#pi .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
#pi .stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}
#pi .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px}
#pi .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}
#pi .stat-value{font-size:22px;font-weight:700;color:var(--text);margin-top:4px;line-height:1}
#pi .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}
@media (max-width:900px){#pi .stats{grid-template-columns:repeat(2,1fr)}}

/* filters */
#pi .filters{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;gap:14px;flex-wrap:wrap}
#pi .filter{display:flex;flex-direction:column;gap:4px}
#pi .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#pi .filter select,#pi .filter input[type=search]{height:34px;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--surface);min-width:160px;box-sizing:border-box}
#pi .filter select:focus,#pi .filter input:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.08)}

/* section */
#pi .section{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}
#pi .section-header{display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border)}
#pi .section-icon{width:30px;height:30px;border-radius:8px;background:var(--info-bg);color:var(--info);display:flex;align-items:center;justify-content:center}
#pi .section-icon svg{width:16px;height:16px}
#pi .section-title{font-size:13px;font-weight:600;color:var(--text)}
#pi .section-sub{font-size:11px;color:var(--text-muted)}

/* data table */
#pi .data-table{width:100%;border-collapse:collapse;font-size:13px}
#pi .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}
#pi .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}
#pi .data-table tbody tr{border-left:3px solid transparent;transition:background .15s;cursor:pointer}
#pi .data-table tbody tr:hover{background:#FAFBFC}
#pi .data-table tbody tr.sens-row{border-left-color:var(--sens)}

/* change diff */
#pi .change-diff{font-size:12px;line-height:1.5}
#pi .change-old{color:var(--text-muted);text-decoration:line-through}
#pi .change-arrow{color:var(--text-faint);margin:0 6px}
#pi .change-new{color:var(--text);font-weight:500}

/* status pills */
#pi .pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600}
#pi .pill-success{background:var(--success-bg);color:var(--success)}
#pi .pill-danger{background:var(--danger-bg);color:var(--danger)}
#pi .pill-warning{background:var(--warning-bg);color:var(--warning)}
#pi .pill-info{background:var(--info-bg);color:var(--info)}
#pi .pill-sens{background:var(--sens-bg);color:var(--sens)}

/* buttons */
#pi .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);transition:border .15s}
#pi .btn:hover{border-color:var(--navy)}
#pi .btn-sm{padding:5px 10px;font-size:12px}
#pi .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}
#pi .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}
#pi .btn-danger{background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border)}
#pi .btn-danger:hover{border-color:var(--danger)}
#pi .btn[disabled]{opacity:.5;cursor:not-allowed}

/* empty / loading */
#pi .empty{text-align:center;padding:40px 20px;color:var(--text-muted)}
#pi .empty-icon{width:48px;height:48px;border-radius:12px;background:#F1F5F9;color:var(--text-faint);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px}
#pi .empty-icon svg{width:24px;height:24px}
#pi .empty-title{font-size:14px;font-weight:600;color:var(--text)}
#pi .loading{padding:30px;text-align:center;color:var(--text-muted)}

/* detail grid */
#pi .detail-grid{display:grid;grid-template-columns:120px 1fr;gap:8px 14px;font-size:13px}
#pi .detail-label{color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#pi .detail-value{color:var(--text)}

/* modal */
#pi .pi-modal-bg{display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9000;align-items:center;justify-content:center;padding:20px}
#pi .pi-modal-bg.active{display:flex}
#pi .pi-modal{background:var(--surface);border-radius:12px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.25)}
#pi .pi-modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}
#pi .pi-modal-header h2{font-size:16px;font-weight:600;color:var(--navy);margin:0}
#pi .pi-modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0;font-family:monospace}
#pi .pi-modal-body{padding:20px 24px;flex:1;overflow-y:auto}
#pi .pi-modal-footer{padding:14px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px}
</style>
<div id="pi">

  <div class="tab-row">
    <button class="tab-btn active" id="pi-tab-pending">รออนุมัติ <span class="count" id="pi-cnt-pending">—</span></button>
    <button class="tab-btn" id="pi-tab-sensitive">Sensitive <span class="count" id="pi-cnt-sensitive">—</span></button>
    <button class="tab-btn" id="pi-tab-approved">อนุมัติ <span class="count" id="pi-cnt-approved">—</span></button>
    <button class="tab-btn" id="pi-tab-rejected">ไม่อนุมัติ <span class="count" id="pi-cnt-rejected">—</span></button>
    <button class="tab-btn" id="pi-tab-all">ทั้งหมด <span class="count" id="pi-cnt-all">—</span></button>
  </div>

  <div class="stats" id="pi-stats"></div>

  <div class="filters">
    <div class="filter">
      <label>ค้นหา</label>
      <input type="search" id="pi-f-search" placeholder="รหัส / พนักงาน">
    </div>
    <div class="filter">
      <label>ประเภทข้อมูล</label>
      <select id="pi-f-field"><option value="">ทุกประเภท</option>${fieldOpts}</select>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <div class="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="20" y1="11" x2="20" y2="17"/><line x1="17" y1="14" x2="23" y2="14"/></svg></div>
      <div style="flex:1">
        <div class="section-title" id="pi-sec-title">รออนุมัติ</div>
        <div class="section-sub" id="pi-sec-sub">ขอแก้ข้อมูลส่วนตัวจาก LINE · ต้อง verify ก่อน apply</div>
      </div>
      <button class="btn btn-sm" id="pi-refresh">รีเฟรช</button>
    </div>
    <div id="pi-content" class="loading">กำลังโหลด...</div>
  </div>

  <!-- Detail Modal -->
  <div class="pi-modal-bg" id="pi-modal-bg">
    <div class="pi-modal">
      <div class="pi-modal-header">
        <h2 id="pi-modal-title">รายละเอียดคำขอ</h2>
        <p id="pi-modal-sub"></p>
      </div>
      <div class="pi-modal-body" id="pi-modal-body"></div>
      <div class="pi-modal-footer" id="pi-modal-footer">
        <button class="btn" id="pi-modal-close">ปิด</button>
      </div>
    </div>
  </div>

</div>`;

  // bind tabs
  $('pi-tab-pending').onclick   = () => piSetTab('pending');
  $('pi-tab-sensitive').onclick = () => piSetTab('sensitive');
  $('pi-tab-approved').onclick  = () => piSetTab('approved');
  $('pi-tab-rejected').onclick  = () => piSetTab('rejected');
  $('pi-tab-all').onclick       = () => piSetTab('all');
  // bind filters (client-side)
  $('pi-f-search').oninput = () => { _piState.filterSearch = $('pi-f-search').value; piRender(); };
  $('pi-f-field').onchange = () => { _piState.filterField = $('pi-f-field').value; piRender(); };
  $('pi-refresh').onclick  = () => piLoad();
  // modal
  $('pi-modal-close').onclick = piCloseModal;
  $('pi-modal-bg').onclick = (e) => { if (e.target === $('pi-modal-bg')) piCloseModal(); };

  piLoad();
}

const PI_TABS = [
  { k: 'pending',   t: 'รออนุมัติ',  sub: 'ขอแก้ข้อมูลส่วนตัวจาก LINE · ต้อง verify ก่อน apply' },
  { k: 'sensitive', t: 'Sensitive · รอ HR Mgr', sub: 'คำขอ sensitive (บัญชีธนาคาร) ที่ยังรออนุมัติ' },
  { k: 'approved',  t: 'อนุมัติแล้ว', sub: 'รายการที่ approve แล้ว' },
  { k: 'rejected',  t: 'ไม่อนุมัติ',  sub: 'รายการที่ปฏิเสธ' },
  { k: 'all',       t: 'ทั้งหมด',     sub: 'คำขอแก้ข้อมูลทั้งหมด' },
];

function piSetTab(tab) {
  _piState.tab = tab;
  ['pending', 'sensitive', 'approved', 'rejected', 'all'].forEach(k => {
    const b = $('pi-tab-' + k);
    if (b) b.classList.toggle('active', tab === k);
  });
  const meta = PI_TABS.find(x => x.k === tab) || PI_TABS[0];
  if ($('pi-sec-title')) $('pi-sec-title').textContent = meta.t;
  if ($('pi-sec-sub')) $('pi-sec-sub').textContent = meta.sub;
  piRender();
}

async function piLoad() {
  const content = $('pi-content');
  if (content) { content.className = 'loading'; content.textContent = 'กำลังโหลด...'; }
  try {
    const { data } = await sb.functions.invoke('hr_personal_info_request');
    _piState.items = (data && data.items) || [];
  } catch (e) {
    console.error('piLoad', e);
    _piState.items = [];
    if (content) { content.className = 'empty'; content.textContent = 'โหลดข้อมูลไม่สำเร็จ'; }
  }
  piRender();
}

// แยกตาม tab + apply filters (client-side)
function piFiltered() {
  const tabFn = (r) => {
    const s = piStatus(r);
    switch (_piState.tab) {
      case 'pending':   return s === 'pending';
      case 'sensitive': return s === 'pending' && piIsSensitive(r);
      case 'approved':  return s === 'approved';
      case 'rejected':  return s === 'rejected';
      default:          return true; // all
    }
  };

  const q = _piState.filterSearch.trim().toLowerCase();
  return _piState.items.filter(r => {
    if (!tabFn(r)) return false;
    if (_piState.filterField && (r.field || '') !== _piState.filterField) return false;
    if (q) {
      const hay = (String(r.request_id || '') + ' ' + String(r.employee_id || '') + ' ' +
                   String(r.employee_name || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function piRender() {
  // counts ทุก tab (จาก items ดิบ — ใช้ status / sensitive ล้วน · ไม่ผูก filter ประเภท/ค้นหา)
  const items = _piState.items;
  const cPending = items.filter(r => piStatus(r) === 'pending').length;
  const cSensitive = items.filter(r => piStatus(r) === 'pending' && piIsSensitive(r)).length;
  const cApproved = items.filter(r => piStatus(r) === 'approved').length;
  const cRejected = items.filter(r => piStatus(r) === 'rejected').length;
  const cAll = items.length;
  if ($('pi-cnt-pending'))   $('pi-cnt-pending').textContent = cPending;
  if ($('pi-cnt-sensitive')) $('pi-cnt-sensitive').textContent = cSensitive;
  if ($('pi-cnt-approved'))  $('pi-cnt-approved').textContent = cApproved;
  if ($('pi-cnt-rejected'))  $('pi-cnt-rejected').textContent = cRejected;
  if ($('pi-cnt-all'))       $('pi-cnt-all').textContent = cAll;
  // sidebar badge = จำนวน pending
  const ct = document.getElementById('ct-pinfo');
  if (ct) ct.textContent = cPending || '';

  piRenderStats({ cPending, cSensitive, cApproved, cRejected });
  piRenderTable(piFiltered());
}

function piStatCard(label, value, sub, color) {
  return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
    '<div class="stat-label">' + esc(label) + '</div>' +
    '<div class="stat-value">' + (value || 0) + '</div>' +
    '<div class="stat-sub">' + esc(sub) + '</div></div>';
}

function piRenderStats(c) {
  $('pi-stats').innerHTML = [
    piStatCard('รออนุมัติ', c.cPending, 'จาก LINE', 'var(--warning)'),
    piStatCard('Sensitive', c.cSensitive, 'รอ HR Mgr', 'var(--sens)'),
    piStatCard('อนุมัติแล้ว', c.cApproved, 'verified', 'var(--success)'),
    piStatCard('ไม่อนุมัติ', c.cRejected, 'rejected', 'var(--danger)'),
  ].join('');
}

function piRenderTable(rows) {
  const content = $('pi-content');
  if (!rows || rows.length === 0) {
    content.className = '';
    content.innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><div class="empty-title">ไม่มีรายการ</div></div>';
    return;
  }
  content.className = '';

  const showActions = _piState.tab === 'pending' || _piState.tab === 'sensitive';

  const trs = rows.map(r => {
    const s = piStatus(r);
    const sens = piIsSensitive(r);
    const empName = r.employee_name || r.employee_id || '—';
    const newVal = String(r.new_value != null ? r.new_value : '');
    const oldVal = r.old_value != null && r.old_value !== '' ? String(r.old_value) : '';

    let actions;
    if (showActions && s === 'pending') {
      actions = '<button class="btn btn-sm" data-pi-view="' + esc(r.request_id || '') + '">ดู</button>';
    } else {
      const pill = s === 'approved' ? '<span class="pill pill-success">อนุมัติ</span>'
        : s === 'rejected' ? '<span class="pill pill-danger">ไม่อนุมัติ</span>'
        : '<span class="pill pill-warning">รออนุมัติ</span>';
      actions = pill;
    }

    return [
      '<tr class="' + (sens ? 'sens-row' : '') + '" data-pi-row="' + esc(r.request_id || '') + '">',
        '<td>',
          '<div style="font-weight:500">' + esc(empName) + '</div>',
          '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + esc(r.employee_id || '') + (r.position ? ' · ' + esc(r.position) : '') + '</div>',
        '</td>',
        '<td>' + esc(piFieldLabel(r.field)) + (sens ? ' <span class="pill pill-sens">SENSITIVE</span>' : '') + '</td>',
        '<td><div class="change-diff">' +
          (oldVal ? '<span class="change-old">' + esc(oldVal) + '</span><span class="change-arrow">→</span>' : '') +
          '<span class="change-new">' + (newVal ? esc(newVal) : '—') + '</span>' +
          (r.note ? '<div style="font-size:10px;color:var(--text-muted);margin-top:4px">เหตุผล: ' + esc(String(r.note)) + '</div>' : '') +
        '</div></td>',
        '<td style="font-size:11px;color:var(--text-muted)">' + esc(r.requested_at || '—') + '</td>',
        '<td data-pi-stop="1" style="text-align:right">' + actions + '</td>',
      '</tr>',
    ].join('');
  }).join('');

  content.innerHTML = [
    '<div style="overflow-x:auto"><table class="data-table">',
      '<thead><tr>',
        '<th>พนักงาน</th><th>ประเภท</th><th>การเปลี่ยนแปลง</th>',
        '<th style="width:130px">วันที่ขอ</th>',
        '<th style="width:120px;text-align:right">' + (showActions ? 'Action' : 'Status') + '</th>',
      '</tr></thead>',
      '<tbody>' + trs + '</tbody>',
    '</table></div>',
  ].join('');

  // bind row click → detail
  Array.prototype.forEach.call(content.querySelectorAll('[data-pi-row]'), tr => {
    tr.onclick = (e) => {
      if (e.target.closest('[data-pi-stop]')) return;
      piOpenDetail(tr.getAttribute('data-pi-row'));
    };
  });
  Array.prototype.forEach.call(content.querySelectorAll('[data-pi-view]'), btn => {
    btn.onclick = () => piOpenDetail(btn.getAttribute('data-pi-view'));
  });
}

function piFind(requestId) {
  return _piState.items.find(r => String(r.request_id) === String(requestId));
}

function piOpenDetail(requestId) {
  const d = piFind(requestId);
  if (!d) { alert('ไม่พบคำขอ'); return; }

  const s = piStatus(d);
  const sens = piIsSensitive(d);
  const oldVal = d.old_value != null && d.old_value !== '' ? String(d.old_value) : '';
  const newVal = String(d.new_value != null ? d.new_value : '');

  $('pi-modal-title').textContent = 'คำขอแก้ข้อมูล · ' + (d.employee_name || d.employee_id || '');
  $('pi-modal-sub').textContent = (d.request_id || '') + (d.requested_at ? ' · ส่งเมื่อ ' + d.requested_at : '');

  const statusPill = s === 'approved' ? '<span class="pill pill-success">อนุมัติ</span>'
    : s === 'rejected' ? '<span class="pill pill-danger">ไม่อนุมัติ</span>'
    : '<span class="pill pill-warning">รออนุมัติ</span>';

  let attachmentHtml = '';
  if (d.attachment_url) {
    attachmentHtml = '<a href="' + esc(d.attachment_url) + '" target="_blank" class="btn btn-sm">ดูเอกสารแนบ</a>';
  }

  $('pi-modal-body').innerHTML = [
    '<div class="detail-grid">',
      '<div class="detail-label">พนักงาน</div><div class="detail-value">' + esc(d.employee_name || d.employee_id || '—') + (d.employee_id && d.employee_name ? ' (' + esc(d.employee_id) + ')' : '') + '</div>',
      d.position ? '<div class="detail-label">ตำแหน่ง</div><div class="detail-value">' + esc(d.position) + '</div>' : '',
      '<div class="detail-label">ประเภท</div><div class="detail-value">' + esc(piFieldLabel(d.field)) + (sens ? ' <span class="pill pill-sens">SENSITIVE</span>' : '') + '</div>',
      '<div class="detail-label">ค่าเดิม</div><div class="detail-value">' + (oldVal ? esc(oldVal) : '—') + '</div>',
      '<div class="detail-label">ค่าใหม่</div><div class="detail-value"><b>' + (newVal ? esc(newVal) : '—') + '</b></div>',
      d.note ? '<div class="detail-label">เหตุผล</div><div class="detail-value">' + esc(String(d.note)) + '</div>' : '',
      d.attachment_url ? '<div class="detail-label">เอกสารแนบ</div><div class="detail-value">' + attachmentHtml + '</div>' : '',
      d.reviewer_notes ? '<div class="detail-label">หมายเหตุ HR</div><div class="detail-value">' + esc(String(d.reviewer_notes)) + '</div>' : '',
      '<div class="detail-label">สถานะ</div><div class="detail-value">' + statusPill + '</div>',
    '</div>',
    sens ? '<div style="margin-top:14px;background:var(--sens-bg);border-left:3px solid var(--sens);border-radius:8px;padding:10px;font-size:12px;color:var(--navy);line-height:1.5">ข้อมูล <b>sensitive</b> · ตรวจสอบเอกสารแนบให้ละเอียดก่อนอนุมัติ · HR Manager เท่านั้นที่ควรอนุมัติ</div>' : '',
  ].join('');

  if (s === 'pending') {
    $('pi-modal-footer').innerHTML = [
      '<button class="btn" id="pi-m-close2">ปิด</button>',
      '<button class="btn btn-danger" id="pi-m-reject">Reject</button>',
      '<button class="btn btn-primary" id="pi-m-approve">Approve</button>',
    ].join('');
    $('pi-m-close2').onclick = piCloseModal;
    $('pi-m-reject').onclick = () => piDecide(d.request_id, 'rejected');
    $('pi-m-approve').onclick = () => piDecide(d.request_id, 'approved');
  } else {
    $('pi-modal-footer').innerHTML = '<button class="btn" id="pi-m-close2">ปิด</button>';
    $('pi-m-close2').onclick = piCloseModal;
  }

  $('pi-modal-bg').classList.add('active');
}

function piCloseModal() {
  const bg = $('pi-modal-bg');
  if (bg) bg.classList.remove('active');
}

async function piDecide(requestId, decision) {
  if (_piState.acting) return;
  const label = decision === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';
  if (!confirm(label + 'คำขอแก้ข้อมูลนี้?')) return;

  _piState.acting = true;
  const aBtn = $('pi-m-approve'), rBtn = $('pi-m-reject');
  if (aBtn) aBtn.disabled = true;
  if (rBtn) rBtn.disabled = true;

  try {
    const { data, error } = await sb.functions.invoke('hr_approve', {
      body: { request_id: requestId, decision },
    });
    if (error || (data && data.error)) {
      alert('ผิดพลาด: ' + ((data && data.error) || (error && error.message) || 'ไม่สำเร็จ'));
      _piState.acting = false;
      if (aBtn) aBtn.disabled = false;
      if (rBtn) rBtn.disabled = false;
      return;
    }
    _piState.acting = false;
    piCloseModal();
    await piLoad();
  } catch (e) {
    _piState.acting = false;
    if (aBtn) aBtn.disabled = false;
    if (rBtn) rBtn.disabled = false;
    alert('ผิดพลาด: ' + (e && e.message || ''));
  }
}
