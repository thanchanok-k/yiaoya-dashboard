// _ported/pinfo.js — FULL native port of desktop personal_info_manager.html (HR Personal Info Requests admin)
// ลอกทั้งดุ้น: page-head + yh-quick-stats (4) + PIR stat row (4) + status tabs + data table (change-diff) + detail modal
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix #pi ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ mountPinfo() · google.script.run = shim → PI_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope · บรรทัด 616-618) — ห้าม redeclare
// fn/var ที่ต้อง expose ให้ inline onclick = ผูกกับ window ภายใน mountPinfo
//
// backend map (grep → 88_PersonalInfoChange.js / edge fn):
//   list    → sb.functions.invoke('hr_personal_info_request') → {items}  → คืน {ok,rows,counts} ที่ JS เดิมคาด
//   whoami  → {ok:true} เต็มสิทธิ์ (dashboard = HR/owner)
//   approve → sb.functions.invoke('hr_approve',{body:{request_id,decision:'approved'}})
//   reject  → sb.functions.invoke('hr_approve',{body:{request_id,decision:'rejected'}})
//   apply (write-back ลง Tab 01 Employees) → stub + toast (edge fn ไม่มี applyToRecord)

/* ============================================================
   PI_BACKEND — map google.script.run → Supabase edge fn
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (onLoaded: {ok,rows,counts}; view/approve/reject/apply)
   ============================================================ */

// field-type meta (ลอกจาก 88_PersonalInfoChange.js REQUEST_TYPES) — label + sensitive + field map
var PI2_TYPES = {
  address:           { label: 'ที่อยู่ปัจจุบัน',            field: 'current_address',   sensitive: false },
  phone:             { label: 'เบอร์โทรศัพท์',              field: 'phone',             sensitive: false },
  marital_status:    { label: 'สถานภาพสมรส',               field: 'marital_status',    sensitive: false },
  dependent:         { label: 'ผู้อยู่ในอุปการะ',           field: 'dependents',        sensitive: false },
  emergency_contact: { label: 'ผู้ติดต่อกรณีฉุกเฉิน',        field: 'emergency_contact', sensitive: false },
  bank_account:      { label: 'บัญชีธนาคาร (รับเงินเดือน)', field: 'bank_account',      sensitive: true  },
  other:             { label: 'อื่นๆ',                      field: 'notes',             sensitive: false },
};
function pi2TypeDef(rt) { return PI2_TYPES[rt] || { label: rt || '', field: '', sensitive: false }; }
function pi2ToBool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function pi2NormStatus(s) {
  s = String(s || '').toLowerCase();
  if (s === 'approved' || s === 'auto_approved') return 'approved';
  if (s === 'rejected') return 'rejected';
  return 'pending';
}
function pi2FmtDate(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// parse new_value (อาจเป็น JSON {display,data} จาก structured form) → display string
function pi2ParseValue(raw) {
  if (raw == null || raw === '') return '';
  var s = String(raw);
  if (s.charAt(0) === '{' || s.charAt(0) === '[') {
    try { var o = JSON.parse(s); if (o && typeof o === 'object' && o.display != null) return String(o.display); } catch (e) {}
  }
  return s;
}

// map raw item (จาก edge fn payload) → enriched row shape ที่ JS เดิมใช้ (เหมือน 88.list() enriched)
function pi2MapRow(r) {
  r = r || {};
  var rt = r.request_type || r.field || '';
  var td = pi2TypeDef(rt);
  var sensitive = (r.sensitive != null) ? pi2ToBool(r.sensitive) : !!td.sensitive;
  return {
    request_id: r.request_id || '',
    employee_id: r.employee_id || '',
    employee_name: r.employee_name || r.employee_id || '',
    position: r.position || '',
    request_type: rt,
    type_label: r.type_label || td.label || rt,
    sensitive: sensitive,
    old_value: r.old_value != null ? String(r.old_value) : '',
    new_value: pi2ParseValue(r.new_value != null ? r.new_value : r.new_value_display),
    diff_rows: Array.isArray(r.diff_rows) ? r.diff_rows : [],
    reason: r.reason || r.note || '',
    attachment_url: r.attachment_url || '',
    requested_at: r.requested_at ? pi2FmtDate(r.requested_at) : '',
    status: pi2NormStatus(r.status),
    reviewer_notes: r.reviewer_notes || '',
    effective_date: r.effective_date ? pi2FmtDate(r.effective_date) : '',
    applied: pi2ToBool(r.applied != null ? r.applied : r.applied_to_employee_record),
  };
}

// คำนวณ counts client-side (edge fn คืนแค่ {items} — ไม่มี analytics) เหมือนของเดิม
function pi2Counts(rows) {
  var now = new Date();
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  function _d(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  var cPending = 0, cApproved = 0, cRejected = 0, cSens = 0, cApprovedMonth = 0, cAddress = 0;
  var slaTotal = 0, slaWithin = 0;
  rows.forEach(function (r) {
    var st = pi2NormStatus(r.status);
    if (st === 'pending') cPending++;
    else if (st === 'approved') cApproved++;
    else if (st === 'rejected') cRejected++;
    if (r.sensitive && st === 'pending') cSens++;
    if (r.request_type === 'address') cAddress++;
    if (st === 'approved') {
      var rd = _d(r.reviewed_at) || _d(r.effective_date);
      if (rd && rd >= monthStart) cApprovedMonth++;
    }
    if (st === 'approved' || st === 'rejected') {
      var a = _d(r.requested_at), b = _d(r.reviewed_at);
      if (a && b) { slaTotal++; if ((b - a) / 36e5 <= 24) slaWithin++; }
    }
  });
  return {
    pending: cPending, approved: cApproved, rejected: cRejected,
    sensitive_pending: cSens, all: rows.length,
    approved_month: cApprovedMonth, address_count: cAddress,
    sla_24h: slaTotal ? Math.round(slaWithin / slaTotal * 100) : null,
  };
}

var _pi2RawCache = [];   // raw mapped rows (ทุก status) — ใช้ filter ตาม tab client-side
var PI_BACKEND = {
  // role gate — dashboard user = HR/owner เต็มสิทธิ์
  piAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'hr_manager' });
  },
  // list — { ok, rows, counts } ; opts.tab filter ฝั่ง client (edge fn คืนทุก item)
  piAdminList: function (opts) {
    opts = opts || {};
    return sb.functions.invoke('hr_personal_info_request').then(function (res) {
      var data = (res && res.data) || {};
      if (data.error) return { ok: false, error: data.error };
      var all = (data.items || []).map(pi2MapRow);
      _pi2RawCache = all;
      var counts = pi2Counts(all);
      var tab = opts.tab || 'pending';
      var rows = all;
      if (tab === 'pending') rows = all.filter(function (r) { return r.status === 'pending'; });
      else if (tab === 'approved') rows = all.filter(function (r) { return r.status === 'approved'; });
      else if (tab === 'rejected') rows = all.filter(function (r) { return r.status === 'rejected'; });
      else if (tab === 'sensitive') rows = all.filter(function (r) { return r.sensitive; });
      rows = rows.slice().sort(function (a, b) { return new Date(b.requested_at) - new Date(a.requested_at); });
      return { ok: true, rows: rows, counts: counts };
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || 'โหลดข้อมูลไม่สำเร็จ' };
    });
  },
  // approve → hr_approve {request_id, decision:'approved'}
  piAdminApprove: function (requestId) {
    return sb.functions.invoke('hr_approve', { body: { request_id: requestId, decision: 'approved' } }).then(function (res) {
      var data = (res && res.data) || {};
      var err = (res && res.error);
      if (err || data.error) return { ok: false, error: data.error || (err && err.message) || 'อนุมัติไม่สำเร็จ' };
      return { ok: true };
    }).catch(function (e) { return { ok: false, error: (e && e.message) || 'อนุมัติไม่สำเร็จ' }; });
  },
  // reject → hr_approve {request_id, decision:'rejected'} (notes แนบไปด้วยถ้ามี)
  piAdminReject: function (requestId, opts) {
    var body = { request_id: requestId, decision: 'rejected' };
    if (opts && opts.notes) body.notes = opts.notes;
    return sb.functions.invoke('hr_approve', { body: body }).then(function (res) {
      var data = (res && res.data) || {};
      var err = (res && res.error);
      if (err || data.error) return { ok: false, error: data.error || (err && err.message) || 'ปฏิเสธไม่สำเร็จ' };
      return { ok: true };
    }).catch(function (e) { return { ok: false, error: (e && e.message) || 'ปฏิเสธไม่สำเร็จ' }; });
  },
  // apply-to-record — edge fn ไม่มี applyToRecord → stub + toast
  piAdminApply: function () {
    pi2NotReady('apply เข้า Tab 01 Employees');
    return Promise.resolve({ ok: false, error: 'apply เข้าระเบียนพนักงานยังไม่พร้อมบน dashboard — ทำผ่าน Apps Script เดิม' });
  },
};

var _pi2NotReadyShown = {};
function pi2NotReady(feature) {
  if (_pi2NotReadyShown[feature]) return;
  _pi2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.pi2Toast) window.pi2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountPinfo — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountPinfo() {
  var wrap = document.getElementById('wrap-pinfo');
  if (!wrap) return;
  wrap.innerHTML = '<style>' + PI2_CSS() + '</style><div id="pi">' + PI2_MARKUP() + '</div>';
  PI2_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles tokens + <style> หน้า manager + yh-quick-stats + sidebar-unification page-head)
   prefix ทุก selector ด้วย #pi · ตัด .app-shell/.main-area/.topbar shell (dashboard มี shell แล้ว) ===== */
function PI2_CSS() {
  return [
    // tokens (จาก :root หน้าเดิม)
    '#pi{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--bg:#F8F9FA;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--warn:#F59E0B;--success:#16A34A;color:var(--navy);font-size:14px;line-height:1.5}',
    '#pi *,#pi *::before,#pi *::after{box-sizing:border-box}',
    // page-head (sidebar-unification block)
    '#pi .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #E2E8F0}',
    '#pi .page-head h1{font-size:20px;font-weight:600;color:#0D2F4F;letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#pi .page-head h1 svg{width:18px;height:18px;color:#3DC5B7}',
    '#pi .page-head .subtitle{font-size:12px;color:#64748B;margin-top:4px}',
    '#pi .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}',
    // yh-quick-stats (v1.10.100)
    '#pi .yh-quick-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}',
    '@media (max-width:900px){#pi .yh-quick-stats{grid-template-columns:repeat(2,1fr)}}',
    '#pi .yh-qs-card{background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;position:relative;overflow:hidden;cursor:help}',
    '#pi .yh-qs-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#pi .yh-qs-card.warn::before{background:#F59E0B}',
    '#pi .yh-qs-card.danger::before{background:#EF4444}',
    '#pi .yh-qs-card.info::before{background:#185FA5}',
    '#pi .yh-qs-card.success::before{background:#10B981}',
    '#pi .yh-qs-lbl{font-size:10px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:4px}',
    '#pi .yh-qs-lbl svg{width:11px;height:11px;color:#94A3B8}',
    '#pi .yh-qs-val{font-size:22px;font-weight:700;color:#0D2F4F;line-height:1;margin-top:6px;letter-spacing:-.02em}',
    '#pi .yh-qs-sub{font-size:10px;color:#94A3B8;margin-top:3px}',
    // top bar (page header block)
    '#pi .top{background:var(--navy);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;border-radius:10px 10px 0 0}',
    '#pi .top-t{font-size:16px;font-weight:600}',
    '#pi .top-b{background:var(--teal);padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600}',
    // PIR stat row (4)
    '#pi .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 0}',
    '@media (max-width:900px){#pi .stats{grid-template-columns:repeat(2,1fr)}}',
    '#pi .st{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;border-left-width:3px}',
    '#pi .st.pen{border-left-color:var(--warn)}',
    '#pi .st.app{border-left-color:var(--success)}',
    '#pi .st.rej{border-left-color:var(--error)}',
    '#pi .st.sen{border-left-color:#7C3AED}',
    '#pi .st-n{font-size:24px;font-weight:600}',
    '#pi .st-l{font-size:11px;color:var(--muted);margin-top:3px}',
    // status tabs
    '#pi .tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);background:#fff;border-radius:10px 10px 0 0;padding:0 20px}',
    '#pi .tab{padding:11px 16px;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;font-weight:500}',
    '#pi .tab.act{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    '#pi .tab-c{background:var(--bg);padding:1px 7px;border-radius:99px;font-size:10px;margin-left:4px}',
    // body
    '#pi .body{padding:14px 20px;background:#fff;border:1px solid var(--border);border-top:0;border-radius:0 0 10px 10px}',
    // table
    '#pi table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)}',
    '#pi th{background:var(--navy);color:#fff;padding:11px 12px;font-size:11px;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:.3px}',
    '#pi td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border);vertical-align:middle}',
    '#pi tr:hover td{background:var(--teal-light)}',
    // pills
    '#pi .pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600}',
    '#pi .pill.pending{background:#FEF3C7;color:#B45309}',
    '#pi .pill.approved{background:#D1FAE5;color:#047857}',
    '#pi .pill.rejected{background:#FEE2E2;color:#B91C1C}',
    '#pi .pill.sens{background:#EDE9FE;color:#5B21B6}',
    // change diff
    '#pi .change-diff{font-size:11px}',
    '#pi .change-old{color:var(--muted);text-decoration:line-through}',
    '#pi .change-arrow{color:var(--muted);margin:0 6px}',
    '#pi .change-new{color:var(--navy);font-weight:500}',
    // row buttons
    '#pi .rb{padding:5px 10px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:#fff;color:var(--navy)}',
    '#pi .rb.app{background:var(--success);color:#fff;border-color:var(--success)}',
    '#pi .rb.rej{background:var(--error);color:#fff;border-color:var(--error)}',
    // empty
    '#pi .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    // btn (refresh in page-actions)
    '#pi .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:6px;border:1px solid #E2E8F0;background:#fff;color:#475569;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit}',
    '#pi .btn.btn-sm{padding:7px 12px}',
    '#pi .btn:hover{border-color:#3DC5B7;color:#0F766E}',
    // modal
    '#pi .modal-bg{display:none;position:fixed;inset:0;background:rgba(13,47,79,.6);z-index:9000;align-items:center;justify-content:center;padding:20px}',
    '#pi .modal-bg.open{display:flex}',
    '#pi .modal{background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto}',
    '#pi .modal-h{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
    '#pi .modal-x{background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer}',
    '#pi .modal-b{padding:16px 20px}',
    '#pi .field{margin-bottom:11px}',
    '#pi .field-l{display:block;font-size:11px;font-weight:600;margin-bottom:5px}',
    '#pi .field-i{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit}',
    '#pi a{color:var(--teal-dark,#2BA89B);color:#1D4ED8}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก section + modal · คง element id เดิม
   ตัด app-shell/sidebar/sheet_link/brand_footer/topbar (dashboard shell มีแล้ว) ===== */
function PI2_MARKUP() {
  return ''
  // page-head (sidebar-unification)
  + '<header class="page-head">'
  +   '<div>'
  +     '<h1><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="20" y1="11" x2="20" y2="17"/><line x1="17" y1="14" x2="23" y2="14"/></svg>Personal Info Changes</h1>'
  +     '<div class="subtitle">ขอแก้ข้อมูลส่วนตัวจาก LINE · ต้อง verify ก่อน apply</div>'
  +   '</div>'
  +   '<div class="page-actions" id="yh-page-actions"><button class="btn btn-sm" onclick="typeof reload === \'function\' ? reload() : location.reload()" title="Refresh"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-9-9c2.5 0 4.85.99 6.6 2.6L21 8"/><path d="M21 3v5h-5"/></svg>Refresh</button></div>'
  + '</header>'
  // yh-quick-stats (4)
  + '<div class="yh-quick-stats">'
  +   '<div class="yh-qs-card warn" data-tip="ขอแก้ข้อมูลที่ยังไม่ verify · เปิดดูเอกสารแนบก่อน approve">'
  +     '<div class="yh-qs-lbl">รอ verify ' + PI2_QICON() + '</div>'
  +     '<div class="yh-qs-val" id="yh-qs-pending">—</div>'
  +     '<div class="yh-qs-sub">จาก LINE</div>'
  +   '</div>'
  +   '<div class="yh-qs-card success" data-tip="รายการที่ approve แล้ว · มี audit trail">'
  +     '<div class="yh-qs-lbl">Approved เดือนนี้ ' + PI2_QICON() + '</div>'
  +     '<div class="yh-qs-val" id="yh-qs-approved_month">—</div>'
  +     '<div class="yh-qs-sub">ที่ผ่านมา</div>'
  +   '</div>'
  +   '<div class="yh-qs-card" data-tip="field ที่ขอแก้บ่อยที่สุด · ใช้วิเคราะห์ trend">'
  +     '<div class="yh-qs-lbl">แก้ที่อยู่บ่อย ' + PI2_QICON() + '</div>'
  +     '<div class="yh-qs-val" id="yh-qs-address_count">—</div>'
  +     '<div class="yh-qs-sub">top field</div>'
  +   '</div>'
  +   '<div class="yh-qs-card" data-tip="สัดส่วนรายการที่ HR ตอบใน 24 ชม. · target = 100%">'
  +     '<div class="yh-qs-lbl">ตอบใน 24 ชม. ' + PI2_QICON() + '</div>'
  +     '<div class="yh-qs-val" id="yh-qs-sla">—</div>'
  +     '<div class="yh-qs-sub">%</div>'
  +   '</div>'
  + '</div>'
  // top bar
  + '<div class="top"><div class="top-t">Personal Info Requests</div><div class="top-b">PIR</div></div>'
  // PIR stat row
  + '<div class="stats">'
  +   '<div class="st pen"><div><div class="st-n" id="stP">–</div><div class="st-l">รออนุมัติ</div></div></div>'
  +   '<div class="st sen"><div><div class="st-n" id="stS">–</div><div class="st-l">Sensitive · รอ HR Mgr</div></div></div>'
  +   '<div class="st app"><div><div class="st-n" id="stA">–</div><div class="st-l">อนุมัติแล้ว</div></div></div>'
  +   '<div class="st rej"><div><div class="st-n" id="stR">–</div><div class="st-l">ไม่อนุมัติ</div></div></div>'
  + '</div>'
  // status tabs + body
  + '<div class="tabs" id="tabs"></div>'
  + '<div class="body" id="bodyWrap"><div class="empty">กำลังโหลด...</div></div>'
  // detail modal
  + '<div class="modal-bg" id="modalBg" onclick="if(event.target===this)closeModal()">'
  +   '<div class="modal">'
  +     '<div class="modal-h"><div style="font-size:15px;font-weight:600" id="mt"></div><button class="modal-x" onclick="closeModal()">×</button></div>'
  +     '<div class="modal-b" id="mb"></div>'
  +   '</div>'
  + '</div>';
}
function PI2_QICON() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>';
}

/* ============================================================
   PI2_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → PI_BACKEND
   esc → reuse global esc (ห้าม redeclare) · fn ที่ inline onclick ใช้ → ผูก window ตอนท้าย
   ============================================================ */
function PI2_RUN_PAGE_JS() {

  // ---- google.script.run shim → PI_BACKEND (async, คืน shape เดิม) ----
  function _pi2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (PI_BACKEND[prop]) {
            Promise.resolve().then(function () { return PI_BACKEND[prop].apply(PI_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[PI_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[PI_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _pi2MakeChain(); } });

  // toast helper (สำหรับ stub apply) — global pi2Toast
  function showToast(msg, type) {
    var t = document.getElementById('pi2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pi2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.pi2Toast = showToast;

  /* ============================================================
     JS หน้าเดิม (personal_info_manager.html <script>) — ลอกทั้งดุ้น
     esc = global (alias ไว้ใน scope นี้ ไม่ redeclare ของ index.html)
     ============================================================ */
  var esc = window.esc || function (s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };

  // scope helper: ใช้ getElementById ตรง ๆ (id เดิมอยู่ใต้ #pi)
  function gid(id) { return document.getElementById(id); }

  let _state = { tab: 'pending', rows: [], counts: {} };
  function init() { reload(); }
  function reload() {
    gid('bodyWrap').innerHTML = '<div class="empty">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(onLoaded)
      .withFailureHandler(onFailed)
      .piAdminList({ tab: _state.tab });
  }
  function setText(id, val) { var el = gid(id); if (el) el.textContent = val; }
  function onLoaded(r) {
    // v1.10.153 — surface server-side errors instead of leaving the spinner stuck
    if (!r || !r.ok) { onFailed(new Error((r && r.error) || 'โหลดข้อมูลไม่สำเร็จ')); return; }
    _state.rows = r.rows || [];
    _state.counts = r.counts || {};
    // PIR pipeline stat row
    setText('stP', _state.counts.pending || 0);
    setText('stS', _state.counts.sensitive_pending || 0);
    setText('stA', _state.counts.approved || 0);
    setText('stR', _state.counts.rejected || 0);
    // Top quick-stats row
    setText('yh-qs-pending', _state.counts.pending || 0);
    setText('yh-qs-approved_month', _state.counts.approved_month || 0);
    setText('yh-qs-address_count', _state.counts.address_count || 0);
    setText('yh-qs-sla', _state.counts.sla_24h == null ? '—' : (_state.counts.sla_24h + '%'));
    // sidebar badge = pending
    var ct = document.getElementById('ct-pinfo'); if (ct) ct.textContent = (_state.counts.pending || 0) || '';
    renderTabs(); renderTable();
  }
  function onFailed(err) {
    var msg = (err && err.message) || 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์';
    gid('bodyWrap').innerHTML =
      '<div class="empty">โหลดข้อมูลไม่สำเร็จ'
      + '<div style="font-size:12px;color:var(--error);margin-top:6px;">' + esc(msg) + '</div>'
      + '<button class="rb" style="margin-top:14px;" onclick="reload()">ลองใหม่</button></div>';
  }
  function renderTabs() {
    const c = _state.counts;
    const tabs = [
      { k: 'pending', l: 'รออนุมัติ', n: c.pending || 0 },
      { k: 'sensitive', l: 'Sensitive', n: c.sensitive_pending || 0 },
      { k: 'approved', l: 'อนุมัติ', n: c.approved || 0 },
      { k: 'rejected', l: 'ไม่อนุมัติ', n: c.rejected || 0 },
      { k: 'all', l: 'ทั้งหมด', n: c.all || 0 },
    ];
    gid('tabs').innerHTML = tabs.map(t =>
      `<div class="tab ${_state.tab === t.k ? 'act' : ''}" onclick="setTab('${t.k}')">${t.l}<span class="tab-c">${t.n}</span></div>`
    ).join('');
  }
  function setTab(k) { _state.tab = k; reload(); }
  function renderTable() {
    if (!_state.rows.length) { gid('bodyWrap').innerHTML = '<div class="empty">ไม่มีรายการ</div>'; return; }
    let html = `<table><thead><tr>
      <th>พนักงาน</th><th>ประเภท</th><th>การเปลี่ยนแปลง</th><th>วันที่ขอ</th><th>สถานะ</th><th>Actions</th>
    </tr></thead><tbody>`;
    html += _state.rows.map(r => `<tr>
      <td><b>${esc(r.employee_name)}</b><div style="font-size:10px;color:var(--muted);">${esc(r.position)}</div></td>
      <td>${esc(r.type_label)}${r.sensitive ? ' <span class="pill sens">SENSITIVE</span>' : ''}</td>
      <td><div class="change-diff">
        <span class="change-old">${esc(r.old_value || '-')}</span><span class="change-arrow">→</span><span class="change-new">${esc(r.new_value)}</span>
        ${r.reason ? '<div style="font-size:10px;color:var(--muted);margin-top:4px;">เหตุผล: ' + esc(r.reason) + '</div>' : ''}
      </div></td>
      <td>${esc(r.requested_at)}</td>
      <td><span class="pill ${esc(r.status)}">${statusLabel(r.status)}</span></td>
      <td>${r.status === 'pending' ? `
        <button class="rb" onclick='view(${JSON.stringify(r.request_id)})'>ดู</button>
        <button class="rb app" onclick='approveReq(${JSON.stringify(r.request_id)})'>อนุมัติ</button>
        <button class="rb rej" onclick='rejectReq(${JSON.stringify(r.request_id)})'>ไม่อนุมัติ</button>
      ` : `<button class="rb" onclick='view(${JSON.stringify(r.request_id)})'>ดู</button>${r.status === 'approved' && !r.applied ? ' <button class="rb app" onclick="applyChange(\'' + r.request_id + '\')">apply to record</button>' : ''}`}</td>
    </tr>`).join('');
    html += '</tbody></table>';
    gid('bodyWrap').innerHTML = html;
  }
  function statusLabel(s) { return ({ pending: 'รออนุมัติ', approved: 'อนุมัติ', rejected: 'ไม่อนุมัติ' })[s] || s; }

  function view(id) {
    const r = _state.rows.find(x => x.request_id === id);
    if (!r) return;
    gid('mt').textContent = r.request_id;

    // v1.10.60 — render structured diff if available
    let diffHtml = '';
    if (Array.isArray(r.diff_rows) && r.diff_rows.length) {
      diffHtml = `<div style="margin-top:12px; border:1px solid var(--border); border-radius:9px; overflow:hidden;">
        <div style="background:var(--bg); padding:8px 11px; font-size:11px; color:var(--muted); letter-spacing:0.5px; font-weight:600;">FIELD-BY-FIELD DIFF</div>
        <table style="width:100%; font-size:12px; border-collapse:collapse;">
          <thead><tr style="background:#FAFAFA;">
            <th style="text-align:left; padding:6px 10px; font-weight:600; width:30%; border-bottom:1px solid var(--border);">Field</th>
            <th style="text-align:left; padding:6px 10px; font-weight:600; width:30%; border-bottom:1px solid var(--border);">เดิม</th>
            <th style="text-align:left; padding:6px 10px; font-weight:600; width:30%; border-bottom:1px solid var(--border);">ใหม่</th>
            <th style="text-align:right; padding:6px 10px; font-weight:600; border-bottom:1px solid var(--border);"></th>
          </tr></thead><tbody>
          ${r.diff_rows.map(d => `<tr>
            <td style="padding:6px 10px; color:var(--muted); border-bottom:1px solid var(--bg);">${esc(d.label)}</td>
            <td style="padding:6px 10px; border-bottom:1px solid var(--bg);">${esc(d.old || '-')}</td>
            <td style="padding:6px 10px; border-bottom:1px solid var(--bg); ${d.changed ? 'color:#047857; font-weight:500;' : ''}">${esc(d.new || '-')}</td>
            <td style="padding:6px 10px; text-align:right; border-bottom:1px solid var(--bg);">
              ${d.changed
                ? '<span style="background:#FEF3C7; color:#B45309; font-size:9px; padding:2px 7px; border-radius:9px; font-weight:500;">CHANGED</span>'
                : '<span style="background:#F1F3F5; color:#6B7280; font-size:9px; padding:2px 7px; border-radius:9px;">SAME</span>'}
            </td>
          </tr>`).join('')}
        </tbody></table></div>`;
    } else {
      diffHtml = `<table style="width:100%; font-size:12px;">
        <tr><td style="color:var(--muted); padding:5px 0;">จาก</td><td>${esc(r.old_value || '-')}</td></tr>
        <tr><td style="color:var(--muted); padding:5px 0;">เป็น</td><td><b>${esc(r.new_value)}</b></td></tr>
      </table>`;
    }

    gid('mb').innerHTML = `
      <table style="width:100%; font-size:12px;">
        <tr><td style="color:var(--muted); padding:5px 0; width:120px;">พนักงาน</td><td><b>${esc(r.employee_name)}</b></td></tr>
        <tr><td style="color:var(--muted); padding:5px 0;">ประเภท</td><td>${esc(r.type_label)}${r.sensitive ? ' <span class="pill sens">SENSITIVE</span>' : ''}</td></tr>
        <tr><td style="color:var(--muted); padding:5px 0;">เหตุผล</td><td>${esc(r.reason || '-')}</td></tr>
        ${r.attachment_url ? `<tr><td style="color:var(--muted); padding:5px 0;">เอกสาร</td><td><a href="${esc(r.attachment_url)}" target="_blank">เปิดดู</a></td></tr>` : ''}
        ${r.reviewer_notes ? `<tr><td style="color:var(--muted); padding:5px 0; vertical-align:top;">หมายเหตุ HR</td><td>${esc(r.reviewer_notes)}</td></tr>` : ''}
      </table>
      ${diffHtml}`;
    gid('modalBg').classList.add('open');
  }

  function approveReq(id) {
    const notes = prompt('หมายเหตุ (optional):') || '';
    if (notes === null) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) reload();
      else alert('อนุมัติล้มเหลว · ' + (r && r.error));
    }).withFailureHandler(e => alert('อนุมัติล้มเหลว · ' + (e && e.message))).piAdminApprove(id, { notes });
  }

  function rejectReq(id) {
    const notes = prompt('ระบุเหตุผลที่ไม่อนุมัติ:');
    if (!notes) { alert('ต้องระบุเหตุผล'); return; }
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) reload();
      else alert('ปฏิเสธล้มเหลว · ' + (r && r.error));
    }).withFailureHandler(e => alert('ปฏิเสธล้มเหลว · ' + (e && e.message))).piAdminReject(id, { notes });
  }

  function applyChange(id) {
    if (!confirm('อัพเดทข้อมูลใน Tab 01 Employees เลย?')) return;
    google.script.run.withSuccessHandler(r => {
      if (r && r.ok) { alert('อัพเดทเรียบร้อย'); reload(); }
      else alert('Apply ล้มเหลว · ' + (r && r.error));
    }).withFailureHandler(e => alert('Apply ล้มเหลว · ' + (e && e.message))).piAdminApply(id);
  }

  function closeModal() { gid('modalBg').classList.remove('open'); }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = { reload, setTab, view, approveReq, rejectReq, applyChange, closeModal };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  init();
}
