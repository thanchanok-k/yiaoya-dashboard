// _ported/leavereq.js — native port of desktop leave_manager.html (HR Announcement admin)
// ลอก markup + CSS เดิม · scoped ทั้งหมดใต้ #lv (กันชน CSS dashboard) · element id prefix lv-
// ใช้ global sb + esc + $ (มีอยู่แล้วใน index.html · module scope) — ห้าม redeclare
// backend: hr_leave_request → {items:[...]} (list) · hr_approve {request_id,decision} (approve/reject)
//
// โครงหน้า desktop ที่ลอกมา:
//   - tab toggle: รออนุมัติ / ประวัติ  (tab "ยอดลาคงเหลือ" ของเดิมต้อง query แยก → ตัดออก)
//   - stats cards (5): คำนวณ client-side จาก items
//   - filters: ค้นหา / สาขา / ประเภทลา (client-side filter)
//   - data-table รายการลา + status pill + ปุ่ม "ดู"
//   - detail modal + ปุ่ม Approve / Reject (เฉพาะ pending)

// ประเภทการลา (label ไทย + สีจากของเดิม lt-*)
const LV_TYPES = [
  { key: 'sick',            label: 'ลาป่วย' },
  { key: 'personal',        label: 'ลากิจ' },
  { key: 'annual',          label: 'ลาพักร้อน' },
  { key: 'maternity',       label: 'ลาคลอด' },
  { key: 'paternity',       label: 'ลาเลี้ยงดูบุตร' },
  { key: 'ordination',      label: 'ลาบวช' },
  { key: 'military',        label: 'ลาทหาร' },
  { key: 'emergency',       label: 'ลาฉุกเฉิน' },
  { key: 'special_holiday', label: 'ลาพิเศษ' },
  { key: 'birthday',        label: 'ลาวันเกิด' },
  { key: 'reward',          label: 'วันหยุดแถม' },
  { key: 'other',           label: 'อื่นๆ' },
];

// state เฉพาะหน้านี้ (prefix lv)
let _lvState = {
  tab: 'pending',        // 'pending' | 'history'
  items: [],             // raw items จาก backend
  filterSearch: '',
  filterBranch: '',
  filterType: '',
  acting: false,         // กัน double-click approve/reject
};

function lvTypeLabel(key) {
  const t = LV_TYPES.find(x => x.key === key);
  return t ? t.label : (key || '');
}

function mountLeavereq() {
  const wrap = document.getElementById('wrap-leavereq');
  if (!wrap) return;

  const typeOpts = LV_TYPES.map(t =>
    '<option value="' + t.key + '">' + esc(t.key) + ' — ' + esc(t.label) + '</option>'
  ).join('');

  wrap.innerHTML = `
<style>
#lv{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;--c-public:#047857;--c-public-bg:#ECFDF5;--c-branch:#C2410C;--c-branch-bg:#FFF7ED;--c-religious:#1D4ED8;--c-religious-bg:#EFF6FF;color:var(--text);font-size:13px}

/* tab toggle */
#lv .tab-row{display:flex;gap:6px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;width:fit-content}
#lv .tab-btn{padding:7px 14px;border:none;background:transparent;border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}
#lv .tab-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}
#lv .tab-btn .count{font-size:10px;padding:1px 7px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}
#lv .tab-btn.active .count{background:var(--navy)}

/* stats */
#lv .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}
#lv .stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}
#lv .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px}
#lv .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}
#lv .stat-value{font-size:22px;font-weight:700;color:var(--text);margin-top:4px;line-height:1}
#lv .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}
@media (max-width:900px){#lv .stats{grid-template-columns:repeat(2,1fr)}}

/* filters */
#lv .filters{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;gap:14px;flex-wrap:wrap}
#lv .filter{display:flex;flex-direction:column;gap:4px}
#lv .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#lv .filter select,#lv .filter input[type=search]{height:34px;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--surface);min-width:160px;box-sizing:border-box}
#lv .filter select:focus,#lv .filter input:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.08)}

/* section */
#lv .section{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}
#lv .section-header{display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border)}
#lv .section-icon{width:30px;height:30px;border-radius:8px;background:var(--info-bg);color:var(--info);display:flex;align-items:center;justify-content:center}
#lv .section-icon svg{width:16px;height:16px}
#lv .section-title{font-size:13px;font-weight:600;color:var(--text)}
#lv .section-sub{font-size:11px;color:var(--text-muted)}

/* data table */
#lv .data-table{width:100%;border-collapse:collapse;font-size:13px}
#lv .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}
#lv .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}
#lv .data-table tbody tr{border-left:3px solid transparent;transition:background .15s;cursor:pointer}
#lv .data-table tbody tr:hover{background:#FAFBFC}
#lv .data-table tbody tr.backdated{border-left-color:var(--danger)}

/* leave-type pills */
#lv .leave-type-pill{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
#lv .lt-sick{background:var(--danger-bg);color:var(--danger)}
#lv .lt-annual{background:var(--c-public-bg);color:var(--c-public)}
#lv .lt-personal{background:var(--c-religious-bg);color:var(--c-religious)}
#lv .lt-maternity,#lv .lt-paternity{background:#FCE7F3;color:#BE185D}
#lv .lt-ordination,#lv .lt-military{background:var(--c-branch-bg);color:var(--c-branch)}
#lv .lt-emergency,#lv .lt-special_holiday,#lv .lt-birthday,#lv .lt-reward,#lv .lt-other{background:#F1F5F9;color:var(--text-muted)}

#lv .days-badge{display:inline-block;padding:2px 8px;border-radius:10px;background:var(--info-bg);color:var(--info);font-size:12px;font-weight:600;font-family:monospace}
#lv .flag-pill{padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px}
#lv .flag-half{background:#DBEAFE;color:#1E40AF}
#lv .flag-back{background:var(--danger-bg);color:var(--danger)}

/* status pills */
#lv .pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600}
#lv .pill-success{background:var(--success-bg);color:var(--success)}
#lv .pill-danger{background:var(--danger-bg);color:var(--danger)}
#lv .pill-warning{background:var(--warning-bg);color:var(--warning)}
#lv .pill-info{background:var(--info-bg);color:var(--info)}

/* buttons */
#lv .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);transition:border .15s}
#lv .btn:hover{border-color:var(--navy)}
#lv .btn-sm{padding:5px 10px;font-size:12px}
#lv .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}
#lv .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}
#lv .btn-danger{background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border)}
#lv .btn-danger:hover{border-color:var(--danger)}
#lv .btn[disabled]{opacity:.5;cursor:not-allowed}

/* empty / loading */
#lv .empty{text-align:center;padding:40px 20px;color:var(--text-muted)}
#lv .empty-icon{width:48px;height:48px;border-radius:12px;background:#F1F5F9;color:var(--text-faint);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px}
#lv .empty-icon svg{width:24px;height:24px}
#lv .empty-title{font-size:14px;font-weight:600;color:var(--text)}
#lv .loading{padding:30px;text-align:center;color:var(--text-muted)}

/* detail grid */
#lv .detail-grid{display:grid;grid-template-columns:120px 1fr;gap:8px 14px;font-size:13px}
#lv .detail-label{color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#lv .detail-value{color:var(--text)}

/* modal */
#lv .lv-modal-bg{display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9000;align-items:center;justify-content:center;padding:20px}
#lv .lv-modal-bg.active{display:flex}
#lv .lv-modal{background:var(--surface);border-radius:12px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.25)}
#lv .lv-modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}
#lv .lv-modal-header h2{font-size:16px;font-weight:600;color:var(--navy);margin:0}
#lv .lv-modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0;font-family:monospace}
#lv .lv-modal-body{padding:20px 24px;flex:1;overflow-y:auto}
#lv .lv-modal-footer{padding:14px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px}
</style>
<div id="lv">

  <div class="tab-row">
    <button class="tab-btn active" id="lv-tab-pending">รออนุมัติ <span class="count" id="lv-cnt-pending">—</span></button>
    <button class="tab-btn" id="lv-tab-history">ประวัติ <span class="count" id="lv-cnt-history">—</span></button>
  </div>

  <div class="stats" id="lv-stats"></div>

  <div class="filters">
    <div class="filter">
      <label>ค้นหา</label>
      <input type="search" id="lv-f-search" placeholder="รหัส / พนักงาน">
    </div>
    <div class="filter">
      <label>สาขา</label>
      <select id="lv-f-branch"><option value="">ทุกสาขา</option></select>
    </div>
    <div class="filter">
      <label>ประเภทลา</label>
      <select id="lv-f-type"><option value="">ทุกประเภท</option>${typeOpts}</select>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <div class="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
      <div style="flex:1">
        <div class="section-title" id="lv-sec-title">รออนุมัติ</div>
        <div class="section-sub" id="lv-sec-sub">คำขอลาที่รอการอนุมัติจากหัวหน้า/HR</div>
      </div>
      <button class="btn btn-sm" id="lv-refresh">รีเฟรช</button>
    </div>
    <div id="lv-content" class="loading">กำลังโหลด...</div>
  </div>

  <!-- Detail Modal -->
  <div class="lv-modal-bg" id="lv-modal-bg">
    <div class="lv-modal">
      <div class="lv-modal-header">
        <h2 id="lv-modal-title">รายละเอียดคำขอลา</h2>
        <p id="lv-modal-sub"></p>
      </div>
      <div class="lv-modal-body" id="lv-modal-body"></div>
      <div class="lv-modal-footer" id="lv-modal-footer">
        <button class="btn" id="lv-modal-close">ปิด</button>
      </div>
    </div>
  </div>

</div>`;

  // bind tabs
  $('lv-tab-pending').onclick = () => lvSetTab('pending');
  $('lv-tab-history').onclick = () => lvSetTab('history');
  // bind filters (client-side)
  $('lv-f-search').oninput  = () => { _lvState.filterSearch = $('lv-f-search').value; lvRender(); };
  $('lv-f-branch').onchange = () => { _lvState.filterBranch = $('lv-f-branch').value; lvRender(); };
  $('lv-f-type').onchange   = () => { _lvState.filterType = $('lv-f-type').value; lvRender(); };
  $('lv-refresh').onclick   = () => lvLoad();
  // modal
  $('lv-modal-close').onclick = lvCloseModal;
  $('lv-modal-bg').onclick = (e) => { if (e.target === $('lv-modal-bg')) lvCloseModal(); };

  lvLoad();
}

function lvSetTab(tab) {
  _lvState.tab = tab;
  $('lv-tab-pending').classList.toggle('active', tab === 'pending');
  $('lv-tab-history').classList.toggle('active', tab === 'history');
  $('lv-sec-title').textContent = tab === 'pending' ? 'รออนุมัติ' : 'ประวัติการลา';
  $('lv-sec-sub').textContent = tab === 'pending'
    ? 'คำขอลาที่รอการอนุมัติจากหัวหน้า/HR'
    : 'รายการที่ตัดสินแล้ว — approved / rejected';
  lvRender();
}

async function lvLoad() {
  const content = $('lv-content');
  if (content) { content.className = 'loading'; content.textContent = 'กำลังโหลด...'; }
  try {
    const { data } = await sb.functions.invoke('hr_leave_request');
    _lvState.items = (data && data.items) || [];
  } catch (e) {
    console.error('lvLoad', e);
    _lvState.items = [];
    if (content) { content.className = 'empty'; content.textContent = 'โหลดข้อมูลไม่สำเร็จ'; }
  }
  lvPopulateBranches();
  lvRender();
}

function lvPopulateBranches() {
  const sel = $('lv-f-branch');
  if (!sel || sel.children.length > 1) return;
  const seen = {};
  _lvState.items.forEach(r => {
    const b = (r.branch_id || '').trim();
    if (b && !seen[b]) { seen[b] = true; }
  });
  Object.keys(seen).sort().forEach(b => {
    const o = document.createElement('option');
    o.value = b; o.textContent = b;
    sel.appendChild(o);
  });
}

// แยก pending / history จาก items + apply filters
function lvFiltered() {
  const status = (r) => String(r.status || '').toLowerCase();
  const tabFn = _lvState.tab === 'pending'
    ? (r) => status(r) === 'pending' || status(r) === ''
    : (r) => status(r) !== 'pending' && status(r) !== '';

  const q = _lvState.filterSearch.trim().toLowerCase();
  return _lvState.items.filter(r => {
    if (!tabFn(r)) return false;
    if (_lvState.filterBranch && (r.branch_id || '') !== _lvState.filterBranch) return false;
    if (_lvState.filterType && (r.leave_type || '') !== _lvState.filterType) return false;
    if (q) {
      const hay = (String(r.request_id || '') + ' ' + String(r.employee_id || '') + ' ' +
                   String(r.employee_name || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function lvRender() {
  // counts ทุก tab (ก่อน filter ประเภท/สาขา — ใช้ status ล้วน)
  const st = (r) => String(r.status || '').toLowerCase();
  const pendingCount = _lvState.items.filter(r => st(r) === 'pending' || st(r) === '').length;
  const historyCount = _lvState.items.filter(r => st(r) !== 'pending' && st(r) !== '').length;
  if ($('lv-cnt-pending')) $('lv-cnt-pending').textContent = pendingCount;
  if ($('lv-cnt-history')) $('lv-cnt-history').textContent = historyCount;
  // sidebar badge = จำนวน pending
  const ct = document.getElementById('ct-leavereq');
  if (ct) ct.textContent = pendingCount || '';

  const rows = lvFiltered();
  lvRenderStats(rows);
  lvRenderTable(rows);
}

function lvStatCard(label, value, sub, color) {
  return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
    '<div class="stat-label">' + esc(label) + '</div>' +
    '<div class="stat-value">' + (value || 0) + '</div>' +
    '<div class="stat-sub">' + esc(sub) + '</div></div>';
}

function lvRenderStats(rows) {
  const by = (k) => rows.filter(r => (r.leave_type || '') === k).length;
  const other = rows.length - by('sick') - by('annual') - by('personal');
  const subLabel = _lvState.tab === 'pending' ? 'รออนุมัติ' : 'ประวัติ';
  $('lv-stats').innerHTML = [
    lvStatCard('รวม', rows.length, subLabel, 'var(--navy)'),
    lvStatCard('Sick', by('sick'), 'ป่วย', 'var(--danger)'),
    lvStatCard('Annual', by('annual'), 'พักร้อน', 'var(--c-public)'),
    lvStatCard('Personal', by('personal'), 'กิจ', 'var(--c-religious)'),
    lvStatCard('Other', other, 'อื่นๆ', 'var(--c-branch)'),
  ].join('');
}

function lvRenderTable(rows) {
  const content = $('lv-content');
  if (!rows || rows.length === 0) {
    content.className = '';
    content.innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div class="empty-title">ไม่มีคำขอ</div></div>';
    return;
  }
  content.className = '';

  const showActions = _lvState.tab === 'pending';

  const trs = rows.map(r => {
    const lt = r.leave_type || 'other';
    const flags = [
      r.half_day ? '<span class="flag-pill flag-half">½</span>' : '',
      r.backdated ? '<span class="flag-pill flag-back">y/back</span>' : '',
    ].join('');
    const trClass = r.backdated ? 'backdated' : '';
    const sameDate = r.start_date === r.end_date || !r.end_date;
    const dateStr = esc(r.start_date || '—') + (sameDate ? '' : ' – ' + esc(r.end_date));
    const empName = r.employee_name || r.employee_id || '—';

    let actions;
    if (showActions) {
      actions = '<button class="btn btn-sm" data-lv-view="' + esc(r.request_id || '') + '">ดู</button>';
    } else {
      const s = String(r.status || '').toLowerCase();
      const pill = s === 'approved' ? '<span class="pill pill-success">approved</span>'
        : s === 'auto_approved' ? '<span class="pill pill-success">auto</span>'
        : s === 'rejected' ? '<span class="pill pill-danger">rejected</span>'
        : '<span class="pill pill-warning">' + esc(r.status || '—') + '</span>';
      actions = pill;
    }

    return [
      '<tr class="' + trClass + '" data-lv-row="' + esc(r.request_id || '') + '">',
        '<td>',
          '<div style="font-weight:500">' + esc(empName) + '</div>',
          '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + esc(r.employee_id || '') + (r.branch_id ? ' · ' + esc(r.branch_id) : '') + '</div>',
        '</td>',
        '<td><span class="leave-type-pill lt-' + esc(lt) + '">' + esc(lt) + '</span>' + flags + '</td>',
        '<td><div style="font-weight:500">' + dateStr + '</div></td>',
        '<td><span class="days-badge">' + esc(String(r.days != null ? r.days : '—')) + '</span></td>',
        '<td style="font-size:11px;color:var(--text-muted)">' + esc(r.reason || '—') + '</td>',
        '<td data-lv-stop="1" style="text-align:right">' + actions + '</td>',
      '</tr>',
    ].join('');
  }).join('');

  content.innerHTML = [
    '<div style="overflow-x:auto"><table class="data-table">',
      '<thead><tr>',
        '<th>พนักงาน</th><th>ประเภท</th><th>วันที่</th>',
        '<th style="width:70px">วัน</th><th>เหตุผล</th>',
        '<th style="width:110px;text-align:right">' + (showActions ? 'Action' : 'Status') + '</th>',
      '</tr></thead>',
      '<tbody>' + trs + '</tbody>',
    '</table></div>',
  ].join('');

  // bind row click → detail
  Array.prototype.forEach.call(content.querySelectorAll('[data-lv-row]'), tr => {
    tr.onclick = (e) => {
      if (e.target.closest('[data-lv-stop]')) return;
      lvOpenDetail(tr.getAttribute('data-lv-row'));
    };
  });
  Array.prototype.forEach.call(content.querySelectorAll('[data-lv-view]'), btn => {
    btn.onclick = () => lvOpenDetail(btn.getAttribute('data-lv-view'));
  });
}

function lvFind(requestId) {
  return _lvState.items.find(r => String(r.request_id) === String(requestId));
}

function lvOpenDetail(requestId) {
  const d = lvFind(requestId);
  if (!d) { alert('ไม่พบคำขอลา'); return; }

  $('lv-modal-title').textContent = 'คำขอลา · ' + (d.employee_name || d.employee_id || '');
  $('lv-modal-sub').textContent = (d.request_id || '') + (d.submitted_at ? ' · ส่งเมื่อ ' + d.submitted_at : '');

  const lt = d.leave_type || 'other';
  const flags = [
    d.half_day ? '<span class="flag-pill flag-half">half-day</span>' : '',
    d.backdated ? '<span class="flag-pill flag-back">backdated</span>' : '',
  ].join(' ');
  const sameDate = d.start_date === d.end_date || !d.end_date;

  let attachmentHtml = '';
  if (d.attachment_url) {
    attachmentHtml = '<a href="' + esc(d.attachment_url) + '" target="_blank" class="btn btn-sm">ดูเอกสารแนบ</a>';
  }

  $('lv-modal-body').innerHTML = [
    '<div class="detail-grid">',
      '<div class="detail-label">พนักงาน</div><div class="detail-value">' + esc(d.employee_name || d.employee_id || '—') + (d.employee_id ? ' (' + esc(d.employee_id) + ')' : '') + '</div>',
      d.branch_id ? '<div class="detail-label">สาขา</div><div class="detail-value">' + esc(d.branch_id) + '</div>' : '',
      '<div class="detail-label">ประเภทลา</div><div class="detail-value"><span class="leave-type-pill lt-' + esc(lt) + '">' + esc(lt) + '</span> ' + flags + '</div>',
      '<div class="detail-label">ช่วงเวลา</div><div class="detail-value">' + esc(d.start_date || '—') + (sameDate ? '' : ' ถึง ' + esc(d.end_date)) + '</div>',
      '<div class="detail-label">จำนวน</div><div class="detail-value"><span class="days-badge">' + esc(String(d.days != null ? d.days : '—')) + ' วัน</span></div>',
      '<div class="detail-label">เหตุผล</div><div class="detail-value">' + esc(d.reason || '—') + '</div>',
      d.replacement_employee_id ? '<div class="detail-label">ผู้รับมอบงาน</div><div class="detail-value">' + esc(d.replacement_name || d.replacement_employee_id) + '</div>' : '',
      '<div class="detail-label">สถานะ</div><div class="detail-value"><span class="pill pill-info">' + esc(d.status || '—') + '</span></div>',
      d.attachment_url ? '<div class="detail-label">เอกสารแนบ</div><div class="detail-value">' + attachmentHtml + '</div>' : '',
      d.approved_at ? '<div class="detail-label">อนุมัติเมื่อ</div><div class="detail-value">' + esc(d.approved_at) + '</div>' : '',
    '</div>',
  ].join('');

  const isPending = String(d.status || '').toLowerCase() === 'pending' || !d.status;
  if (isPending) {
    $('lv-modal-footer').innerHTML = [
      '<button class="btn" id="lv-m-close2">ปิด</button>',
      '<button class="btn btn-danger" id="lv-m-reject">Reject</button>',
      '<button class="btn btn-primary" id="lv-m-approve">Approve</button>',
    ].join('');
    $('lv-m-close2').onclick = lvCloseModal;
    $('lv-m-reject').onclick = () => lvDecide(d.request_id, 'rejected');
    $('lv-m-approve').onclick = () => lvDecide(d.request_id, 'approved');
  } else {
    $('lv-modal-footer').innerHTML = '<button class="btn" id="lv-m-close2">ปิด</button>';
    $('lv-m-close2').onclick = lvCloseModal;
  }

  $('lv-modal-bg').classList.add('active');
}

function lvCloseModal() {
  const bg = $('lv-modal-bg');
  if (bg) bg.classList.remove('active');
}

async function lvDecide(requestId, decision) {
  if (_lvState.acting) return;
  const label = decision === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';
  if (!confirm(label + 'คำขอลานี้?')) return;

  _lvState.acting = true;
  const aBtn = $('lv-m-approve'), rBtn = $('lv-m-reject');
  if (aBtn) aBtn.disabled = true;
  if (rBtn) rBtn.disabled = true;

  try {
    const { data, error } = await sb.functions.invoke('hr_approve', {
      body: { request_id: requestId, decision },
    });
    if (error || (data && data.error)) {
      alert('ผิดพลาด: ' + ((data && data.error) || (error && error.message) || 'ไม่สำเร็จ'));
      _lvState.acting = false;
      if (aBtn) aBtn.disabled = false;
      if (rBtn) rBtn.disabled = false;
      return;
    }
    _lvState.acting = false;
    lvCloseModal();
    await lvLoad();
  } catch (e) {
    _lvState.acting = false;
    if (aBtn) aBtn.disabled = false;
    if (rBtn) rBtn.disabled = false;
    alert('ผิดพลาด: ' + (e && e.message || ''));
  }
}
