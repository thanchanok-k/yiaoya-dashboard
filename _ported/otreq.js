// _ported/otreq.js — native port of desktop "จัดการคำขอ OT" (HR Announcement admin)
// อ้างอิงโครงจาก leavereq.js (tab รออนุมัติ/ประวัติ + stat + filter + ตาราง + modal อนุมัติ)
// markup/CSS ลอกสไตล์ระบบเดิม (time_attendance_manager.html ส่วน OT + _shared_styles)
// scoped ทั้งหมดใต้ #ot (กันชน CSS dashboard) · element id prefix ot- · var/fn prefix ot
// ใช้ global sb + esc + $ (มีอยู่แล้วใน index.html · module scope) — ห้าม redeclare
// backend:
//   list:    sb.functions.invoke('hr_ot_request') → {items:[...]}
//            payload item: request_id, employee_id, ot_date, expected_hours,
//                          expected_minutes, reason, status (+ employee_name/branch_id/day_type ถ้ามี)
//   approve: sb.functions.invoke('hr_approve',{body:{request_id,decision}}) → reload
//   create:  sb.functions.invoke('hr_ot_request',{body:{employee_id,ot_date,expected_start,expected_end,expected_minutes,reason}})

// state เฉพาะหน้านี้ (prefix ot)
let _otreqState = {
  tab: 'pending',        // 'pending' | 'history'
  items: [],             // raw items จาก backend
  filterSearch: '',
  filterBranch: '',
  filterStatus: '',
  acting: false,         // กัน double-click approve/reject
};

// รวมนาที OT ของ 1 รายการ (รองรับทั้ง expected_minutes และ expected_hours)
function otreqMinutes(r) {
  if (r.expected_minutes != null && r.expected_minutes !== '') {
    const m = Number(r.expected_minutes);
    if (!isNaN(m)) return m;
  }
  if (r.expected_hours != null && r.expected_hours !== '') {
    const h = Number(r.expected_hours);
    if (!isNaN(h)) return Math.round(h * 60);
  }
  return 0;
}

// แสดงชั่วโมง:นาที จากนาที
function otreqFmtHM(mins) {
  const m = Math.max(0, Math.round(mins || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h && mm) return h + ' ชม. ' + mm + ' น.';
  if (h) return h + ' ชม.';
  return mm + ' น.';
}

// แสดง "จำนวน OT" ของรายการ (ชอบชั่วโมงถ้ามี ไม่งั้นแปลงจากนาที)
function otreqHoursLabel(r) {
  if (r.expected_hours != null && r.expected_hours !== '') return r.expected_hours + ' ชม.';
  return otreqFmtHM(otreqMinutes(r));
}

function mountOtreq() {
  const wrap = document.getElementById('wrap-otreq');
  if (!wrap) return;

  wrap.innerHTML = `
<style>
#ot{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;--c-public:#047857;--c-public-bg:#ECFDF5;--c-branch:#C2410C;--c-branch-bg:#FFF7ED;--c-religious:#1D4ED8;--c-religious-bg:#EFF6FF;color:var(--text);font-size:13px}

/* tab toggle */
#ot .tab-row{display:flex;gap:6px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;width:fit-content}
#ot .tab-btn{padding:7px 14px;border:none;background:transparent;border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}
#ot .tab-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}
#ot .tab-btn .count{font-size:10px;padding:1px 7px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}
#ot .tab-btn.active .count{background:var(--navy)}

/* stats */
#ot .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
#ot .stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}
#ot .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px}
#ot .stat-label{font-size:10px;color:var(--text-muted);font-weight:500;text-transform:uppercase;letter-spacing:.05em}
#ot .stat-value{font-size:22px;font-weight:700;color:var(--text);margin-top:4px;line-height:1}
#ot .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}
@media (max-width:900px){#ot .stats{grid-template-columns:repeat(2,1fr)}}

/* filters */
#ot .filters{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;gap:14px;flex-wrap:wrap}
#ot .filter{display:flex;flex-direction:column;gap:4px}
#ot .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#ot .filter select,#ot .filter input[type=search]{height:34px;padding:0 10px;border:1px solid var(--border-strong);border-radius:6px;font-size:13px;font-family:inherit;color:var(--text);background:var(--surface);min-width:160px;box-sizing:border-box}
#ot .filter select:focus,#ot .filter input:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.08)}

/* section */
#ot .section{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}
#ot .section-header{display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border)}
#ot .section-icon{width:30px;height:30px;border-radius:8px;background:var(--warning-bg);color:var(--warning);display:flex;align-items:center;justify-content:center}
#ot .section-icon svg{width:16px;height:16px}
#ot .section-title{font-size:13px;font-weight:600;color:var(--text)}
#ot .section-sub{font-size:11px;color:var(--text-muted)}

/* data table */
#ot .data-table{width:100%;border-collapse:collapse;font-size:13px}
#ot .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}
#ot .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}
#ot .data-table tbody tr{border-left:3px solid transparent;transition:background .15s;cursor:pointer}
#ot .data-table tbody tr:hover{background:#FAFBFC}
#ot .data-table tbody tr.pending-row{border-left-color:var(--warning)}

/* OT hours badge */
#ot .hours-badge{display:inline-block;padding:2px 8px;border-radius:10px;background:var(--warning-bg);color:var(--warning);font-size:12px;font-weight:600}
#ot .day-pill{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:#F1F5F9;color:var(--text-muted)}

/* status pills */
#ot .pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600}
#ot .pill-success{background:var(--success-bg);color:var(--success)}
#ot .pill-danger{background:var(--danger-bg);color:var(--danger)}
#ot .pill-warning{background:var(--warning-bg);color:var(--warning)}
#ot .pill-info{background:var(--info-bg);color:var(--info)}

/* buttons */
#ot .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);transition:border .15s}
#ot .btn:hover{border-color:var(--navy)}
#ot .btn-sm{padding:5px 10px;font-size:12px}
#ot .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}
#ot .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}
#ot .btn-danger{background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border)}
#ot .btn-danger:hover{border-color:var(--danger)}
#ot .btn[disabled]{opacity:.5;cursor:not-allowed}

/* empty / loading */
#ot .empty{text-align:center;padding:40px 20px;color:var(--text-muted)}
#ot .empty-icon{width:48px;height:48px;border-radius:12px;background:#F1F5F9;color:var(--text-faint);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px}
#ot .empty-icon svg{width:24px;height:24px}
#ot .empty-title{font-size:14px;font-weight:600;color:var(--text)}
#ot .loading{padding:30px;text-align:center;color:var(--text-muted)}

/* detail grid */
#ot .detail-grid{display:grid;grid-template-columns:120px 1fr;gap:8px 14px;font-size:13px}
#ot .detail-label{color:var(--text-muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:500}
#ot .detail-value{color:var(--text)}

/* modal */
#ot .ot-modal-bg{display:none;position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9000;align-items:center;justify-content:center;padding:20px}
#ot .ot-modal-bg.active{display:flex}
#ot .ot-modal{background:var(--surface);border-radius:12px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.25)}
#ot .ot-modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}
#ot .ot-modal-header h2{font-size:16px;font-weight:600;color:var(--navy);margin:0}
#ot .ot-modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0;font-family:monospace}
#ot .ot-modal-body{padding:20px 24px;flex:1;overflow-y:auto}
#ot .ot-modal-footer{padding:14px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px}
</style>
<div id="ot">

  <div class="tab-row">
    <button class="tab-btn active" id="ot-tab-pending">รออนุมัติ <span class="count" id="ot-cnt-pending">—</span></button>
    <button class="tab-btn" id="ot-tab-history">ประวัติ <span class="count" id="ot-cnt-history">—</span></button>
  </div>

  <div class="stats" id="ot-stats"></div>

  <div class="filters">
    <div class="filter">
      <label>ค้นหา</label>
      <input type="search" id="ot-f-search" placeholder="รหัส / พนักงาน">
    </div>
    <div class="filter">
      <label>สาขา</label>
      <select id="ot-f-branch"><option value="">ทุกสาขา</option></select>
    </div>
    <div class="filter">
      <label>สถานะ</label>
      <select id="ot-f-status">
        <option value="">ทุกสถานะ</option>
        <option value="pending">pending</option>
        <option value="approved">approved</option>
        <option value="rejected">rejected</option>
      </select>
    </div>
  </div>

  <div class="section">
    <div class="section-header">
      <div class="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg></div>
      <div style="flex:1">
        <div class="section-title" id="ot-sec-title">รออนุมัติ</div>
        <div class="section-sub" id="ot-sec-sub">คำขอทำงานล่วงเวลา (OT) ที่รอการอนุมัติจากหัวหน้า/HR</div>
      </div>
      <button class="btn btn-sm" id="ot-refresh">รีเฟรช</button>
    </div>
    <div id="ot-content" class="loading">กำลังโหลด...</div>
  </div>

  <!-- Detail Modal -->
  <div class="ot-modal-bg" id="ot-modal-bg">
    <div class="ot-modal">
      <div class="ot-modal-header">
        <h2 id="ot-modal-title">รายละเอียดคำขอ OT</h2>
        <p id="ot-modal-sub"></p>
      </div>
      <div class="ot-modal-body" id="ot-modal-body"></div>
      <div class="ot-modal-footer" id="ot-modal-footer">
        <button class="btn" id="ot-modal-close">ปิด</button>
      </div>
    </div>
  </div>

</div>`;

  // bind tabs
  $('ot-tab-pending').onclick = () => otreqSetTab('pending');
  $('ot-tab-history').onclick = () => otreqSetTab('history');
  // bind filters (client-side)
  $('ot-f-search').oninput  = () => { _otreqState.filterSearch = $('ot-f-search').value; otreqRender(); };
  $('ot-f-branch').onchange = () => { _otreqState.filterBranch = $('ot-f-branch').value; otreqRender(); };
  $('ot-f-status').onchange = () => { _otreqState.filterStatus = $('ot-f-status').value; otreqRender(); };
  $('ot-refresh').onclick   = () => otreqLoad();
  // modal
  $('ot-modal-close').onclick = otreqCloseModal;
  $('ot-modal-bg').onclick = (e) => { if (e.target === $('ot-modal-bg')) otreqCloseModal(); };

  otreqLoad();
}

function otreqSetTab(tab) {
  _otreqState.tab = tab;
  $('ot-tab-pending').classList.toggle('active', tab === 'pending');
  $('ot-tab-history').classList.toggle('active', tab === 'history');
  $('ot-sec-title').textContent = tab === 'pending' ? 'รออนุมัติ' : 'ประวัติคำขอ OT';
  $('ot-sec-sub').textContent = tab === 'pending'
    ? 'คำขอทำงานล่วงเวลา (OT) ที่รอการอนุมัติจากหัวหน้า/HR'
    : 'รายการที่ตัดสินแล้ว — approved / rejected';
  otreqRender();
}

async function otreqLoad() {
  const content = $('ot-content');
  if (content) { content.className = 'loading'; content.textContent = 'กำลังโหลด...'; }
  try {
    const { data } = await sb.functions.invoke('hr_ot_request');
    _otreqState.items = (data && data.items) || [];
  } catch (e) {
    console.error('otreqLoad', e);
    _otreqState.items = [];
    if (content) { content.className = 'empty'; content.textContent = 'โหลดข้อมูลไม่สำเร็จ'; }
  }
  otreqPopulateBranches();
  otreqRender();
}

function otreqPopulateBranches() {
  const sel = $('ot-f-branch');
  if (!sel || sel.children.length > 1) return;
  const seen = {};
  _otreqState.items.forEach(r => {
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
function otreqFiltered() {
  const status = (r) => String(r.status || '').toLowerCase();
  const tabFn = _otreqState.tab === 'pending'
    ? (r) => status(r) === 'pending' || status(r) === ''
    : (r) => status(r) !== 'pending' && status(r) !== '';

  const q = _otreqState.filterSearch.trim().toLowerCase();
  return _otreqState.items.filter(r => {
    if (!tabFn(r)) return false;
    if (_otreqState.filterBranch && (r.branch_id || '') !== _otreqState.filterBranch) return false;
    if (_otreqState.filterStatus && status(r) !== _otreqState.filterStatus) return false;
    if (q) {
      const hay = (String(r.request_id || '') + ' ' + String(r.employee_id || '') + ' ' +
                   String(r.employee_name || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function otreqRender() {
  // counts ทุก tab (ก่อน filter — ใช้ status ล้วน)
  const st = (r) => String(r.status || '').toLowerCase();
  const pendingCount = _otreqState.items.filter(r => st(r) === 'pending' || st(r) === '').length;
  const historyCount = _otreqState.items.filter(r => st(r) !== 'pending' && st(r) !== '').length;
  if ($('ot-cnt-pending')) $('ot-cnt-pending').textContent = pendingCount;
  if ($('ot-cnt-history')) $('ot-cnt-history').textContent = historyCount;
  // sidebar badge = จำนวน pending
  const ct = document.getElementById('ct-otreq');
  if (ct) ct.textContent = pendingCount || '';

  const rows = otreqFiltered();
  otreqRenderStats(rows);
  otreqRenderTable(rows);
}

function otreqStatCard(label, value, sub, color) {
  return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
    '<div class="stat-label">' + esc(label) + '</div>' +
    '<div class="stat-value">' + (value || 0) + '</div>' +
    '<div class="stat-sub">' + esc(sub) + '</div></div>';
}

function otreqRenderStats(rows) {
  const totalMins = rows.reduce((s, r) => s + otreqMinutes(r), 0);
  const totalHours = Math.round((totalMins / 60) * 10) / 10;  // 1 ตำแหน่ง
  const st = (r) => String(r.status || '').toLowerCase();
  const approved = rows.filter(r => st(r) === 'approved' || st(r) === 'auto_approved' || st(r) === 'completed').length;
  const rejected = rows.filter(r => st(r) === 'rejected').length;
  const subLabel = _otreqState.tab === 'pending' ? 'รออนุมัติ' : 'ประวัติ';
  $('ot-stats').innerHTML = [
    otreqStatCard('คำขอรวม', rows.length, subLabel, 'var(--navy)'),
    otreqStatCard('ชั่วโมงรวม', totalHours, 'ชม. (' + otreqFmtHM(totalMins) + ')', 'var(--warning)'),
    otreqStatCard('อนุมัติ', approved, 'approved', 'var(--success)'),
    otreqStatCard('ปฏิเสธ', rejected, 'rejected', 'var(--danger)'),
  ].join('');
}

function otreqRenderTable(rows) {
  const content = $('ot-content');
  if (!rows || rows.length === 0) {
    content.className = '';
    content.innerHTML = '<div class="empty"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg></div><div class="empty-title">ไม่มีคำขอ OT</div></div>';
    return;
  }
  content.className = '';

  const showActions = _otreqState.tab === 'pending';

  const trs = rows.map(r => {
    const empName = r.employee_name || r.employee_id || '—';
    const trClass = (showActions ? 'pending-row' : '');
    const dayType = r.day_type
      ? '<span class="day-pill">' + esc(r.day_type) + '</span>'
      : '';

    let actions;
    if (showActions) {
      actions = '<button class="btn btn-sm" data-ot-view="' + esc(r.request_id || '') + '">ดู</button>';
    } else {
      const s = String(r.status || '').toLowerCase();
      const pill = (s === 'approved' || s === 'completed') ? '<span class="pill pill-success">' + esc(r.status) + '</span>'
        : s === 'auto_approved' ? '<span class="pill pill-success">auto</span>'
        : s === 'rejected' ? '<span class="pill pill-danger">rejected</span>'
        : '<span class="pill pill-warning">' + esc(r.status || '—') + '</span>';
      actions = pill;
    }

    return [
      '<tr class="' + trClass + '" data-ot-row="' + esc(r.request_id || '') + '">',
        '<td>',
          '<div style="font-weight:500">' + esc(empName) + '</div>',
          '<div style="font-size:10px;color:var(--text-faint);font-family:monospace">' + esc(r.employee_id || '') + (r.branch_id ? ' · ' + esc(r.branch_id) : '') + '</div>',
        '</td>',
        '<td><div style="font-weight:500">' + esc(r.ot_date || '—') + '</div>' + (dayType ? '<div style="margin-top:3px">' + dayType + '</div>' : '') + '</td>',
        '<td><span class="hours-badge">' + esc(otreqHoursLabel(r)) + '</span></td>',
        '<td style="font-size:11px;color:var(--text-muted)">' + esc(r.reason || '—') + '</td>',
        '<td data-ot-stop="1" style="text-align:right">' + actions + '</td>',
      '</tr>',
    ].join('');
  }).join('');

  content.innerHTML = [
    '<div style="overflow-x:auto"><table class="data-table">',
      '<thead><tr>',
        '<th>พนักงาน</th><th>วันที่ OT</th>',
        '<th style="width:120px">จำนวน</th><th>เหตุผล</th>',
        '<th style="width:110px;text-align:right">' + (showActions ? 'Action' : 'Status') + '</th>',
      '</tr></thead>',
      '<tbody>' + trs + '</tbody>',
    '</table></div>',
  ].join('');

  // bind row click → detail
  Array.prototype.forEach.call(content.querySelectorAll('[data-ot-row]'), tr => {
    tr.onclick = (e) => {
      if (e.target.closest('[data-ot-stop]')) return;
      otreqOpenDetail(tr.getAttribute('data-ot-row'));
    };
  });
  Array.prototype.forEach.call(content.querySelectorAll('[data-ot-view]'), btn => {
    btn.onclick = () => otreqOpenDetail(btn.getAttribute('data-ot-view'));
  });
}

function otreqFind(requestId) {
  return _otreqState.items.find(r => String(r.request_id) === String(requestId));
}

function otreqOpenDetail(requestId) {
  const d = otreqFind(requestId);
  if (!d) { alert('ไม่พบคำขอ OT'); return; }

  $('ot-modal-title').textContent = 'คำขอ OT · ' + (d.employee_name || d.employee_id || '');
  $('ot-modal-sub').textContent = (d.request_id || '') + (d.requested_at ? ' · ส่งเมื่อ ' + d.requested_at : '');

  $('ot-modal-body').innerHTML = [
    '<div class="detail-grid">',
      '<div class="detail-label">พนักงาน</div><div class="detail-value">' + esc(d.employee_name || d.employee_id || '—') + (d.employee_id ? ' (' + esc(d.employee_id) + ')' : '') + '</div>',
      d.branch_id ? '<div class="detail-label">สาขา</div><div class="detail-value">' + esc(d.branch_id) + '</div>' : '',
      '<div class="detail-label">วันที่ OT</div><div class="detail-value">' + esc(d.ot_date || '—') + (d.day_type ? ' <span class="day-pill">' + esc(d.day_type) + '</span>' : '') + '</div>',
      (d.expected_start || d.expected_end) ? '<div class="detail-label">ช่วงเวลา</div><div class="detail-value">' + esc(d.expected_start || '—') + ' – ' + esc(d.expected_end || '—') + '</div>' : '',
      '<div class="detail-label">จำนวน</div><div class="detail-value"><span class="hours-badge">' + esc(otreqHoursLabel(d)) + '</span></div>',
      '<div class="detail-label">เหตุผล</div><div class="detail-value">' + esc(d.reason || '—') + '</div>',
      d.requested_by ? '<div class="detail-label">ขอโดย</div><div class="detail-value">' + esc(d.requested_by) + '</div>' : '',
      '<div class="detail-label">สถานะ</div><div class="detail-value"><span class="pill pill-info">' + esc(d.status || '—') + '</span></div>',
      d.approved_by ? '<div class="detail-label">อนุมัติโดย</div><div class="detail-value">' + esc(d.approved_by) + '</div>' : '',
      d.rejected_reason ? '<div class="detail-label">เหตุผลปฏิเสธ</div><div class="detail-value" style="color:var(--danger)">' + esc(d.rejected_reason) + '</div>' : '',
    '</div>',
  ].join('');

  const isPending = String(d.status || '').toLowerCase() === 'pending' || !d.status;
  if (isPending) {
    $('ot-modal-footer').innerHTML = [
      '<button class="btn" id="ot-m-close2">ปิด</button>',
      '<button class="btn btn-danger" id="ot-m-reject">Reject</button>',
      '<button class="btn btn-primary" id="ot-m-approve">Approve</button>',
    ].join('');
    $('ot-m-close2').onclick = otreqCloseModal;
    $('ot-m-reject').onclick = () => otreqDecide(d.request_id, 'rejected');
    $('ot-m-approve').onclick = () => otreqDecide(d.request_id, 'approved');
  } else {
    $('ot-modal-footer').innerHTML = '<button class="btn" id="ot-m-close2">ปิด</button>';
    $('ot-m-close2').onclick = otreqCloseModal;
  }

  $('ot-modal-bg').classList.add('active');
}

function otreqCloseModal() {
  const bg = $('ot-modal-bg');
  if (bg) bg.classList.remove('active');
}

async function otreqDecide(requestId, decision) {
  if (_otreqState.acting) return;
  const label = decision === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ';
  if (!confirm(label + 'คำขอ OT นี้?')) return;

  _otreqState.acting = true;
  const aBtn = $('ot-m-approve'), rBtn = $('ot-m-reject');
  if (aBtn) aBtn.disabled = true;
  if (rBtn) rBtn.disabled = true;

  try {
    const { data, error } = await sb.functions.invoke('hr_approve', {
      body: { request_id: requestId, decision },
    });
    if (error || (data && data.error)) {
      alert('ผิดพลาด: ' + ((data && data.error) || (error && error.message) || 'ไม่สำเร็จ'));
      _otreqState.acting = false;
      if (aBtn) aBtn.disabled = false;
      if (rBtn) rBtn.disabled = false;
      return;
    }
    _otreqState.acting = false;
    otreqCloseModal();
    await otreqLoad();
  } catch (e) {
    _otreqState.acting = false;
    if (aBtn) aBtn.disabled = false;
    if (rBtn) rBtn.disabled = false;
    alert('ผิดพลาด: ' + (e && e.message || ''));
  }
}
