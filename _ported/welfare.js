// _ported/welfare.js — Native read-only page "สวัสดิการพนักงาน (Welfare/Benefits)" สำหรับ Supabase dashboard
// HR/ผู้บริหารดู — ทะเบียนสวัสดิการพนักงาน แยกตามประเภท/พนักงาน · อ่านอย่างเดียว (ไม่มี write)
//
// ทำตาม pattern เดียวกับ _ported/scorecard.js + _ported/fosales.js :
//   - mountWelfare render เข้า #wrap-welfare
//   - ใช้ global window.sb (index.html module scope) — ห้าม redeclare
//   - CSS scope ใต้ #wf · markup คง element id เดิม
//   - fn ที่ inline onclick ต้องใช้ → ผูกกับ window (prefix wf*) กันชน
//   - helper (esc/showToast) inline ใน scope
//
// backend (edge fn hr_list?type=welfare.updated → {items}) :
//   READ  wfList() → items แต่ละตัว = 1 รายการสวัสดิการ
//         **ไม่รู้ field แน่นอน** → defensive:
//           - ระบุ "พนักงาน" จาก full_name | employee_name | name | employee_id
//           - ระบุ "ประเภท" จาก benefit_type | welfare_type | type | category
//           - สถานะ จาก status | state
//           - ช่วงวัน จาก start_date / end_date
//           - หมายเหตุ จาก note | remark | description
//           - **ตัวเลขเงินถูกตัดออกที่ฝั่ง sync แล้ว → ไม่มี amount → ไม่โชว์เงิน**
//         field ที่เหลือ (ที่ไม่ใช่ meta/internal) → แสดงเป็นคอลัมน์เสริมอัตโนมัติ
//         ข้อมูลจริงมาทีหลัง — ตอนนี้อาจว่าง → empty state สวย ไม่ error

/* ============================================================
   WF_BACKEND — ดึงข้อมูลจาก Supabase edge fn hr_list (type=welfare.updated)
   คืน rows ที่ normalize แล้ว + รายชื่อ extra field ที่เจอจริง · กรอง/group ฝั่ง client
   ============================================================ */
var WF_FN = 'hr_list';
var WF_TYPE = 'welfare.updated';
var WF_LIMIT = 2000;

function wf2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function wf2Str(v) {
  if (v == null) return '';
  return String(v).trim();
}
// คืน 'YYYY-MM-DD' จากค่าวันที่ ถ้าแปลงได้ ; แปลงไม่ได้ → คืนสตริงดิบ (ตัดให้สั้น)
function wf2Date(v) {
  if (v == null || v === '') return '';
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  var d = new Date(s);
  if (!isNaN(d.getTime()) && /\d{4}/.test(s)) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  return s.slice(0, 20);
}

// field ที่ถือว่าเป็น "ตัวระบุ/meta/เงิน" → ไม่เอามาเป็นคอลัมน์เสริม
// (เงินทุกชนิดถูกตัดที่ sync แล้ว แต่กันไว้เผื่อหลุดมา จะไม่โชว์)
var WF_META_KEYS = {
  id: 1, welfare_id: 1, benefit_id: 1, entity_id: 1, record_id: 1,
  employee_id: 1, emp_id: 1, staff_id: 1,
  full_name: 1, employee_name: 1, emp_name: 1, name: 1, staff_name: 1,
  benefit_type: 1, welfare_type: 1, type: 1, category: 1, benefit: 1, welfare: 1,
  status: 1, state: 1,
  start_date: 1, end_date: 1, effective_date: 1, expiry_date: 1, date: 1,
  note: 1, notes: 1, remark: 1, remarks: 1, description: 1, desc: 1, detail: 1,
  branch_id: 1, branch: 1, branch_name: 1, dept: 1, department: 1,
  event_type: 1, created_at: 1, updated_at: 1, ts: 1, timestamp: 1,
  _raw: 1,
  // เงิน — กันโชว์เด็ดขาด (เผื่อ sync หลุด)
  amount: 1, total: 1, total_amount: 1, value: 1, baht: 1, cost: 1, price: 1,
  limit: 1, balance: 1, used: 1, remaining: 1, quota_amount: 1, claim_amount: 1,
};

// คีย์ที่บ่งว่าเป็นเงิน → ไม่โชว์แน่นอน (กันชื่อแปลก ๆ)
function wf2IsMoneyKey(key) {
  var k = String(key).toLowerCase();
  return /amount|baht|money|cost|price|salary|wage|฿|total_paid|paid|claim|reimburse/.test(k);
}

// label ไทยของ field ที่รู้จัก (ที่เหลือ humanize อัตโนมัติ)
var WF_LABELS = {
  benefit_type: 'ประเภทสวัสดิการ', welfare_type: 'ประเภทสวัสดิการ', type: 'ประเภท', category: 'ประเภท',
  status: 'สถานะ', state: 'สถานะ',
  start_date: 'เริ่ม', end_date: 'สิ้นสุด', effective_date: 'มีผล', expiry_date: 'หมดอายุ',
  note: 'หมายเหตุ', remark: 'หมายเหตุ', description: 'รายละเอียด',
  full_name: 'พนักงาน', employee_name: 'พนักงาน',
  branch: 'สาขา', branch_id: 'สาขา', dept: 'แผนก', department: 'แผนก',
  quota: 'โควตา', count: 'จำนวน', days: 'จำนวนวัน',
};

function wf2Humanize(key) {
  var k = String(key);
  if (WF_LABELS[k.toLowerCase()]) return WF_LABELS[k.toLowerCase()];
  return k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

// map payload event ดิบ → row shape (defensive)
function wf2MapRow(p) {
  p = p || {};
  var empId = wf2Str(p.employee_id || p.emp_id || p.staff_id);
  var emp = wf2Str(p.full_name || p.employee_name || p.emp_name || p.name || p.staff_name);
  if (!emp) emp = empId || '—';
  var type = wf2Str(p.benefit_type || p.welfare_type || p.type || p.category || p.benefit || p.welfare) || '—';
  var status = wf2Str(p.status || p.state);
  var startDate = wf2Date(p.start_date || p.effective_date || p.date);
  var endDate = wf2Date(p.end_date || p.expiry_date);
  var note = wf2Str(p.note || p.notes || p.remark || p.remarks || p.description || p.desc || p.detail);

  // extra: field อื่น ๆ ที่ไม่ใช่ meta และไม่ใช่เงิน → เก็บเป็นสตริงโชว์
  var extra = {};
  Object.keys(p).forEach(function (k) {
    if (WF_META_KEYS[k]) return;
    if (k.charAt(0) === '_') return;
    if (wf2IsMoneyKey(k)) return; // ห้ามโชว์เงิน
    var s = wf2Str(p[k]);
    if (s !== '') extra[k] = s;
  });

  return {
    id: wf2Str(p.welfare_id || p.benefit_id || p.id || p.entity_id || p.record_id),
    employee: emp,
    employee_id: empId,
    type: type,
    status: status,
    start_date: startDate,
    end_date: endDate,
    note: note,
    extra: extra,
    _deleted: (p._status === 'deleted' || p._deleted === true || p.deleted === true),
    _raw: p,
  };
}

// ตรวจ 403/401 จาก res ของ functions.invoke (supabase-js คืน {data,error}; error.context = Response)
function wf2Is403(res) {
  if (!res) return false;
  var err = res.error || res;
  if (!err) return false;
  if (err.context && typeof err.context.status === 'number') {
    if (err.context.status === 403 || err.context.status === 401) return true;
  }
  if (typeof err.status === 'number' && (err.status === 403 || err.status === 401)) return true;
  var msg = String(err.message || err.error || err).toLowerCase();
  return msg.indexOf('403') >= 0 || msg.indexOf('forbidden') >= 0 ||
    msg.indexOf('401') >= 0 || msg.indexOf('unauthor') >= 0 || msg.indexOf('not allowed') >= 0;
}

// unwrap error body (FunctionsHttpError → error.context เป็น Response) → คืน Promise<string>
function wf2UnwrapErr(err) {
  if (err && err.context && typeof err.context.json === 'function') {
    return err.context.json().then(function (j) {
      return (j && (j.error || j.message)) || (err.message || 'error');
    }).catch(function () { return (err && err.message) || 'error'; });
  }
  return Promise.resolve((err && err.message) || String(err || 'error'));
}

function wf2GetSb() {
  return (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
}

var WF_WRITE_FN = 'hr_write';

// cache row ล่าสุด (backend ไม่มี endpoint แยก)
var _wf2Rows = [];

function wf2FetchRows() {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  if (!sb || !sb.functions) {
    _wf2Rows = [];
    return Promise.resolve([]);
  }
  var q = WF_FN + '?type=' + encodeURIComponent(WF_TYPE) + '&limit=' + WF_LIMIT;
  return sb.functions.invoke(q).then(function (res) {
    var data = (res && res.data) || {};
    var items = wf2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p, i) {
      var row = wf2MapRow(p);
      if (row._deleted) return; // กรองรายการที่ลบ (soft delete) ทิ้ง
      var key = row.id || (row.employee_id + '|' + row.type + '|' + row.start_date) || ('idx' + i);
      if (seen[key]) return;
      seen[key] = true;
      if (!row.id) row.id = key;
      rows.push(row);
    });
    _wf2Rows = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[WF_BACKEND] list fetch failed', e);
    _wf2Rows = [];
    return [];
  });
}

var WF_BACKEND = {
  // list — { rows, types, employees, statuses, extraKeys } (ฝั่ง client กรองเอง)
  wfList: function () {
    return wf2FetchRows().then(function (all) {
      var tSeen = {}, types = [];
      var eSeen = {}, employees = [];
      var sSeen = {}, statuses = [];
      var xSeen = {}, extraKeys = [];
      all.forEach(function (r) {
        if (r.type && !tSeen[r.type]) { tSeen[r.type] = true; types.push(r.type); }
        if (r.employee && !eSeen[r.employee]) { eSeen[r.employee] = true; employees.push(r.employee); }
        if (r.status && !sSeen[r.status]) { sSeen[r.status] = true; statuses.push(r.status); }
        Object.keys(r.extra || {}).forEach(function (k) {
          if (!xSeen[k]) { xSeen[k] = true; extraKeys.push(k); }
        });
      });
      types.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });
      employees.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });
      statuses.sort(function (a, b) { return String(a).localeCompare(String(b), 'th'); });
      extraKeys.sort(function (a, b) { return a.localeCompare(b); });
      return { rows: all, types: types, employees: employees, statuses: statuses, extraKeys: extraKeys };
    });
  },

  // เพิ่ม/แก้ — ไม่ส่ง entity_id = ใหม่ · ส่ง entity_id = แก้ของเดิม
  // คืน { ok, denied, error }
  wfSave: function (payload, entityId) {
    var sb = wf2GetSb();
    if (!sb || !sb.functions) return Promise.resolve({ ok: false, denied: false, error: 'no sb' });
    var body = { event_type: WF_TYPE, payload: payload };
    if (entityId) body.entity_id = entityId;
    return sb.functions.invoke(WF_WRITE_FN, { body: body }).then(function (res) {
      if (res && res.error) {
        if (wf2Is403(res)) return { ok: false, denied: true, error: null };
        return wf2UnwrapErr(res.error).then(function (m) { return { ok: false, denied: false, error: m }; });
      }
      var data = (res && res.data) || {};
      if (!data.ok) return { ok: false, denied: false, error: (data.error || 'save failed') };
      return { ok: true, denied: false, error: null };
    }).catch(function (e) {
      if (wf2Is403({ error: e })) return { ok: false, denied: true, error: null };
      return wf2UnwrapErr(e).then(function (m) { return { ok: false, denied: false, error: m }; });
    });
  },

  // ลบ (soft) — ส่ง entity_id + deleted:true · คืน { ok, denied, error }
  wfDelete: function (entityId) {
    var sb = wf2GetSb();
    if (!sb || !sb.functions) return Promise.resolve({ ok: false, denied: false, error: 'no sb' });
    if (!entityId) return Promise.resolve({ ok: false, denied: false, error: 'no id' });
    var body = { event_type: WF_TYPE, entity_id: entityId, deleted: true };
    return sb.functions.invoke(WF_WRITE_FN, { body: body }).then(function (res) {
      if (res && res.error) {
        if (wf2Is403(res)) return { ok: false, denied: true, error: null };
        return wf2UnwrapErr(res.error).then(function (m) { return { ok: false, denied: false, error: m }; });
      }
      var data = (res && res.data) || {};
      if (!data.ok) return { ok: false, denied: false, error: (data.error || 'delete failed') };
      return { ok: true, denied: false, error: null };
    }).catch(function (e) {
      if (wf2Is403({ error: e })) return { ok: false, denied: true, error: null };
      return wf2UnwrapErr(e).then(function (m) { return { ok: false, denied: false, error: m }; });
    });
  },
};

/* ============================================================
   mountWelfare — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountWelfare() {
  if (!document.getElementById('wrap-welfare')) return;
  var wrap = document.getElementById('wrap-welfare');
  wrap.innerHTML = '<style>' + WF_CSS() + '</style><div id="wf">' + WF_MARKUP() + '</div>';
  WF_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #wf (brand tokens เดียวกับหน้าอื่น) ===== */
function WF_CSS() {
  return [
    '#wf{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#wf *{box-sizing:border-box}',
    // page head
    '#wf .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#wf .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#wf .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#wf .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#wf .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // buttons
    '#wf .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4}',
    '#wf .btn:hover{border-color:var(--navy)}',
    '#wf .btn svg{width:14px;height:14px}',
    '#wf .btn-sm{padding:5px 10px;font-size:12px}',
    // read-only banner
    '#wf .ro-banner{background:linear-gradient(135deg,#0D2F4F 0%,#1E4A73 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#wf .ro-banner strong{font-weight:600}',
    // stat cards
    '#wf .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#wf .stats{grid-template-columns:repeat(2,1fr)}}',
    '@media (max-width:600px){#wf .stats{grid-template-columns:repeat(2,1fr)}}',
    '#wf .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#wf .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#wf .stat-card.rows::before{background:#1E40AF}',
    '#wf .stat-card.type::before{background:#6D28D9}',
    '#wf .stat-card.emp::before{background:#4338CA}',
    '#wf .stat-card.active::before{background:#166534}',
    '#wf .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#wf .stat-card .v{font-size:22px;font-weight:600;line-height:1.1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#wf .stat-card.active .v{color:#166534}',
    '#wf .stat-card .sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // filters
    '#wf .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#wf .filter{display:flex;flex-direction:column;gap:2px}',
    '#wf .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#wf .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#wf .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section title
    '#wf .sec-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 8px}',
    // type summary cards
    '#wf .type-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-bottom:14px}',
    '#wf .type-card{background:#fff;border:1px solid var(--border);border-left:3px solid var(--teal);border-radius:8px;padding:12px 14px}',
    '#wf .type-card .tname{font-size:13px;font-weight:700;color:var(--navy)}',
    '#wf .type-card .tcount{font-size:20px;font-weight:600;color:var(--navy-2);margin-top:4px;letter-spacing:-.02em}',
    '#wf .type-card .tmeta{font-size:11px;color:var(--text-muted);margin-top:4px;display:flex;gap:12px;flex-wrap:wrap}',
    // data table
    '#wf .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#wf .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);white-space:nowrap}',
    '#wf .data-table th.num,#wf .data-table td.num{text-align:right;font-variant-numeric:tabular-nums}',
    '#wf .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top}',
    '#wf .data-table tr:last-child td{border-bottom:0}',
    '#wf .data-table tr:hover td{background:#FAFBFC}',
    '#wf .emp-cell{font-weight:600;color:var(--navy)}',
    '#wf .id-mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text-muted)}',
    '#wf .date-mono{font-family:"SF Mono",Consolas,monospace;font-size:11px;color:var(--text-muted);white-space:nowrap}',
    '#wf .note-cell{color:var(--text-muted);max-width:280px}',
    '#wf .table-wrap{overflow-x:auto}',
    // status badge
    '#wf .badge{display:inline-block;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;white-space:nowrap;background:#F1F5F9;color:#475569}',
    '#wf .badge.ok{background:#DCFCE7;color:#166534}',
    '#wf .badge.warn{background:#FEF3C7;color:#92400E}',
    '#wf .badge.off{background:#FEE2E2;color:#991B1B}',
    // empty / loading
    '#wf .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px solid var(--border);border-radius:10px}',
    '#wf .empty-icon{width:48px;height:48px;border-radius:50%;background:#F1F5F9;color:var(--text-faint);display:flex;align-items:center;justify-content:center;margin:0 auto 12px}',
    '#wf .empty-icon svg{width:24px;height:24px}',
    '#wf .empty-title{font-size:14px;font-weight:500;color:var(--text);margin-bottom:4px}',
    '#wf .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#wf .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // action buttons (toolbar + row)
    '#wf .btn-primary{background:var(--teal);border-color:var(--teal);color:#fff;font-weight:600}',
    '#wf .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#wf .row-actions{white-space:nowrap;text-align:right}',
    '#wf .btn-icon{padding:3px 8px;font-size:11px;border:1px solid var(--border-strong);border-radius:5px;background:#fff;color:var(--text);cursor:pointer;font-family:inherit;margin-left:4px}',
    '#wf .btn-icon:hover{border-color:var(--navy)}',
    '#wf .btn-icon.danger{color:var(--danger);border-color:#FCA5A5}',
    '#wf .btn-icon.danger:hover{background:#FEE2E2;border-color:var(--danger)}',
    // modal
    '#wf-modal{position:fixed;inset:0;z-index:9998;display:none;align-items:flex-start;justify-content:center;background:rgba(15,23,42,.45);padding:40px 16px;overflow-y:auto}',
    '#wf-modal.open{display:flex}',
    '#wf-modal .modal-card{background:#fff;border-radius:12px;width:100%;max-width:520px;box-shadow:0 20px 50px rgba(0,0,0,.25);overflow:hidden}',
    '#wf-modal .modal-head{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
    '#wf-modal .modal-head h2{margin:0;font-size:16px;font-weight:600;color:var(--navy)}',
    '#wf-modal .modal-x{background:none;border:0;font-size:20px;line-height:1;color:var(--text-faint);cursor:pointer;padding:0 4px}',
    '#wf-modal .modal-body{padding:18px 20px;max-height:60vh;overflow-y:auto}',
    '#wf-modal .modal-foot{padding:14px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px}',
    '#wf-modal .fld{margin-bottom:14px}',
    '#wf-modal .fld label{display:block;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px}',
    '#wf-modal .fld label .req{color:var(--danger)}',
    '#wf-modal .fld input,#wf-modal .fld select,#wf-modal .fld textarea{width:100%;box-sizing:border-box;padding:8px 10px;font-size:13px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;background:#fff;color:var(--text)}',
    '#wf-modal .fld input:focus,#wf-modal .fld select:focus,#wf-modal .fld textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#wf-modal .fld textarea{resize:vertical;min-height:60px}',
    '#wf-modal .fld-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '@media (max-width:768px){#wf .stats{grid-template-columns:repeat(2,1fr)}}',
  ].join('\n');
}

/* ===== markup · คง element id เดิม ===== */
function WF_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    '      สวัสดิการพนักงาน',
    '    </h1>',
    '    <div class="subtitle" id="wf-subtitle">ทะเบียนสวัสดิการ แยกตามประเภท/พนักงาน (Welfare/Benefits)</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn btn-sm btn-primary" onclick="wfOpenAdd()" id="wf-add-btn">＋ เพิ่ม</button>',
    '    <button class="btn btn-sm" onclick="wfReload()" id="wf-refresh-btn"></button>',
    '  </div>',
    '</header>',
    // info banner
    '<div class="ro-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:#3DC5B7;display:inline-block"></span>',
    '  <span><strong>มุมมอง HR:</strong> ทะเบียนสวัสดิการของพนักงานแต่ละท่าน · เพิ่ม/แก้/ลบ ได้ (ไม่แสดงข้อมูลจำนวนเงิน)</span>',
    '</div>',
    '<div class="stats" id="wf-stats"></div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ประเภทสวัสดิการ</label>',
    '    <select id="wf-filter-type" onchange="wfRender()"><option value="">ทุกประเภท</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>พนักงาน</label>',
    '    <select id="wf-filter-emp" onchange="wfRender()"><option value="">ทุกคน</option></select>',
    '  </div>',
    '</div>',
    '<div id="wf-content" class="loading">กำลังโหลด...</div>',
    // modal (เพิ่ม/แก้)
    '<div id="wf-modal">',
    '  <div class="modal-card">',
    '    <div class="modal-head"><h2 id="wf-modal-title">เพิ่มสวัสดิการ</h2><button class="modal-x" onclick="wfCloseModal()" type="button">&times;</button></div>',
    '    <form id="wf-form" onsubmit="return wfSubmitForm(event)">',
    '      <div class="modal-body" id="wf-form-body"></div>',
    '      <div class="modal-foot">',
    '        <button type="button" class="btn btn-sm" onclick="wfCloseModal()">ยกเลิก</button>',
    '        <button type="submit" class="btn btn-sm btn-primary" id="wf-save-btn">บันทึก</button>',
    '      </div>',
    '    </form>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   WF_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function WF_RUN_PAGE_JS() {
  var _wfRoot = document.getElementById('wf');
  function $id(id) { return _wfRoot ? _wfRoot.querySelector('#' + id) : document.getElementById(id); }

  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function showToast(msg, type) {
    var t = document.getElementById('wf2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'wf2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }

  var ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';
  var ICON_HEART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

  var _wfData = null; // { rows, types, employees, statuses, extraKeys }

  function fmtInt(v) {
    var n = Number(v);
    if (!isFinite(n)) n = 0;
    try { return n.toLocaleString('th-TH'); } catch (e) { return String(Math.round(n)); }
  }

  function dateLabel(d) {
    if (!d) return '';
    var parts = String(d).split('-');
    if (parts.length === 3 && /^\d{4}$/.test(parts[0])) {
      var names = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      var mi = parseInt(parts[1], 10);
      var yr = parseInt(parts[0], 10) + 543; // พ.ศ.
      return parseInt(parts[2], 10) + ' ' + (names[mi] || parts[1]) + ' ' + String(yr).slice(-2);
    }
    return String(d);
  }

  // เดาคลาส badge จากสตริงสถานะ (defensive — รองรับไทย/อังกฤษ)
  function statusClass(st) {
    var s = String(st || '').toLowerCase();
    if (!s) return '';
    if (/active|approved|อนุมัติ|ใช้งาน|ปกติ|enrolled|enroll|ลงทะเบียน|มีผล|valid|paid/.test(s)) return 'ok';
    if (/pending|รอ|review|กำลัง|draft|ร่าง/.test(s)) return 'warn';
    if (/expire|หมดอายุ|ยกเลิก|cancel|reject|ปฏิเสธ|inactive|ไม่ใช้|สิ้นสุด|terminat|ended/.test(s)) return 'off';
    return '';
  }

  // ---- load ----
  function loadData() {
    $id('wf-content').className = 'loading';
    $id('wf-content').innerHTML = 'กำลังโหลด...';
    WF_BACKEND.wfList().then(function (res) {
      _wfData = res || { rows: [], types: [], employees: [], statuses: [], extraKeys: [] };
      populateFilters();
      renderAll();
    }).catch(function (e) {
      console.error('[welfare] load failed', e);
      _wfData = { rows: [], types: [], employees: [], statuses: [], extraKeys: [] };
      $id('wf-content').className = '';
      $id('wf-content').innerHTML = '<div class="empty"><div class="empty-title">โหลดข้อมูลไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml((e && e.message) || 'unknown') + '</div></div>';
      renderStats([]);
    });
  }

  function populateFilters() {
    var tSel = $id('wf-filter-type');
    if (tSel && tSel.options.length <= 1) {
      (_wfData.types || []).forEach(function (t) {
        var o = document.createElement('option');
        o.value = t; o.textContent = t;
        tSel.appendChild(o);
      });
    }
    var eSel = $id('wf-filter-emp');
    if (eSel && eSel.options.length <= 1) {
      (_wfData.employees || []).forEach(function (e) {
        var o = document.createElement('option');
        o.value = e; o.textContent = e;
        eSel.appendChild(o);
      });
    }
  }

  // ---- filtered rows ----
  function filteredRows() {
    var rows = (_wfData && _wfData.rows) ? _wfData.rows.slice() : [];
    var tSel = $id('wf-filter-type');
    var eSel = $id('wf-filter-emp');
    var t = tSel ? tSel.value : '';
    var e = eSel ? eSel.value : '';
    if (t) rows = rows.filter(function (r) { return r.type === t; });
    if (e) rows = rows.filter(function (r) { return r.employee === e; });
    // เรียง: พนักงาน แล้วประเภท แล้ววันเริ่ม (ใหม่→เก่า)
    rows.sort(function (a, b) {
      var ec = String(a.employee || '').localeCompare(String(b.employee || ''), 'th');
      if (ec !== 0) return ec;
      var tc = String(a.type || '').localeCompare(String(b.type || ''), 'th');
      if (tc !== 0) return tc;
      return String(b.start_date || '').localeCompare(String(a.start_date || ''));
    });
    return rows;
  }

  // ---- render ----
  function renderAll() {
    var all = (_wfData && _wfData.rows) ? _wfData.rows : [];
    renderStats(all);

    var content = $id('wf-content');
    content.className = '';

    if (!all.length) {
      content.innerHTML = emptyState();
      return;
    }

    var rows = filteredRows();
    if (!rows.length) {
      content.innerHTML = '<div class="empty"><div class="empty-title">ไม่มีข้อมูลตามตัวกรอง</div><div class="empty-sub">ลองเปลี่ยนประเภท/พนักงาน</div></div>';
      return;
    }
    content.innerHTML = renderTypeSummary(rows) + renderTable(rows);
  }

  function renderStats(all) {
    all = all || [];
    var tSeen = {}, eSeen = {}, activeN = 0;
    all.forEach(function (r) {
      if (r.type) tSeen[r.type] = true;
      if (r.employee) eSeen[r.employee] = true;
      if (statusClass(r.status) === 'ok') activeN++;
    });
    var typeN = Object.keys(tSeen).length;
    var empN = Object.keys(eSeen).length;
    var hasStatus = (_wfData && _wfData.statuses && _wfData.statuses.length) ? true : false;

    var cards = [
      statCard('rows', 'รายการสวัสดิการ', fmtInt(all.length), typeN + ' ประเภท'),
      statCard('type', 'ประเภทสวัสดิการ', fmtInt(typeN), 'ที่ใช้งาน'),
      statCard('emp', 'พนักงานที่มีสวัสดิการ', fmtInt(empN), 'คน'),
    ];
    if (hasStatus) {
      cards.push(statCard('active', 'รายการที่ใช้งานอยู่', fmtInt(activeN), 'จาก ' + all.length + ' รายการ'));
    } else {
      cards.push(statCard('active', 'เฉลี่ยต่อคน', empN ? (Math.round((all.length / empN) * 10) / 10) : '—', 'รายการ/คน'));
    }

    $id('wf-stats').innerHTML = cards.join('');

    var sub = $id('wf-subtitle');
    if (sub) sub.textContent = 'ทะเบียนสวัสดิการ แยกตามประเภท/พนักงาน (Welfare/Benefits) · ' + all.length + ' รายการ';
  }

  function statCard(cls, label, val, sub) {
    return [
      '<div class="stat-card ' + cls + '">',
      '  <div class="l">' + escapeHtml(label) + '</div>',
      '  <div class="v">' + val + '</div>',
      '  <div class="sub">' + escapeHtml(sub) + '</div>',
      '</div>',
    ].join('');
  }

  function renderTypeSummary(rows) {
    var grouped = {};
    rows.forEach(function (r) {
      var t = r.type || '—';
      if (!grouped[t]) grouped[t] = { name: t, count: 0, emps: {} };
      grouped[t].count++;
      if (r.employee) grouped[t].emps[r.employee] = true;
    });
    var list = Object.keys(grouped).map(function (k) {
      var g = grouped[k];
      g.empN = Object.keys(g.emps).length;
      return g;
    });
    list.sort(function (a, b) { return b.count - a.count; });
    if (!list.length) return '';
    var cards = list.map(function (g) {
      return [
        '<div class="type-card">',
        '  <div class="tname">' + escapeHtml(g.name) + '</div>',
        '  <div class="tcount">' + fmtInt(g.count) + ' รายการ</div>',
        '  <div class="tmeta">',
        '    <span>' + fmtInt(g.empN) + ' คน</span>',
        '  </div>',
        '</div>',
      ].join('');
    }).join('');
    return '<div class="sec-title">สรุปตามประเภท · เรียงจำนวนมากสุด</div><div class="type-grid">' + cards + '</div>';
  }

  function renderTable(rows) {
    var extraKeys = (_wfData && _wfData.extraKeys) || [];
    var hasStatus = rows.some(function (r) { return r.status; });
    var hasNote = rows.some(function (r) { return r.note; });
    var hasDate = rows.some(function (r) { return r.start_date || r.end_date; });

    // header
    var th = ['<th>พนักงาน</th>', '<th>ประเภทสวัสดิการ</th>'];
    if (hasStatus) th.push('<th>สถานะ</th>');
    if (hasDate) th.push('<th>ช่วงวัน</th>');
    extraKeys.forEach(function (k) { th.push('<th>' + escapeHtml(wf2Humanize(k)) + '</th>'); });
    if (hasNote) th.push('<th>หมายเหตุ</th>');
    th.push('<th class="row-actions">จัดการ</th>');

    var body = rows.map(function (r) {
      var tds = [
        '<td class="emp-cell">' + escapeHtml(r.employee || '—') + (r.employee_id && r.employee_id !== r.employee ? ' <span class="id-mono">' + escapeHtml(r.employee_id) + '</span>' : '') + '</td>',
        '<td>' + escapeHtml(r.type || '—') + '</td>',
      ];
      if (hasStatus) {
        var sc = statusClass(r.status);
        tds.push('<td>' + (r.status ? '<span class="badge ' + sc + '">' + escapeHtml(r.status) + '</span>' : '<span class="id-mono">—</span>') + '</td>');
      }
      if (hasDate) {
        var dr = '';
        if (r.start_date && r.end_date) dr = dateLabel(r.start_date) + ' – ' + dateLabel(r.end_date);
        else if (r.start_date) dr = dateLabel(r.start_date);
        else if (r.end_date) dr = 'ถึง ' + dateLabel(r.end_date);
        tds.push('<td><span class="date-mono">' + (dr ? escapeHtml(dr) : '—') + '</span></td>');
      }
      extraKeys.forEach(function (k) {
        var v = (r.extra && r.extra[k] != null) ? r.extra[k] : '';
        tds.push('<td>' + (v !== '' ? escapeHtml(v) : '<span class="id-mono">—</span>') + '</td>');
      });
      if (hasNote) {
        tds.push('<td class="note-cell">' + (r.note ? escapeHtml(r.note) : '—') + '</td>');
      }
      var rid = escapeHtml(r.id || '');
      tds.push(
        '<td class="row-actions">' +
        '<button type="button" class="btn-icon" onclick="wfOpenEdit(\'' + rid + '\')">แก้</button>' +
        '<button type="button" class="btn-icon danger" onclick="wfAskDelete(\'' + rid + '\')">ลบ</button>' +
        '</td>'
      );
      return '<tr>' + tds.join('') + '</tr>';
    }).join('');

    var colCount = th.length;
    return [
      '<div class="sec-title">รายการสวัสดิการ (' + rows.length + ' รายการ)</div>',
      '<div class="table-wrap">',
      '<table class="data-table">',
      '  <thead><tr>' + th.join('') + '</tr></thead>',
      '  <tbody>' + body + '</tbody>',
      '  <tfoot><tr><td colspan="' + colCount + '">รวม ' + rows.length + ' รายการ</td></tr></tfoot>',
      '</table>',
      '</div>',
    ].join('');
  }

  function emptyState() {
    return [
      '<div class="empty">',
      '  <div class="empty-icon">' + ICON_HEART + '</div>',
      '  <div class="empty-title">ยังไม่มีข้อมูลสวัสดิการพนักงาน</div>',
      '  <div class="empty-sub">เมื่อระบบส่งข้อมูลสวัสดิการเข้ามา (welfare.updated) ข้อมูลจะแสดงที่นี่</div>',
      '</div>',
    ].join('');
  }

  /* ===== CRUD: modal form (เพิ่ม/แก้) + ลบ ===== */
  // นิยามฟิลด์ฟอร์ม — payload key ตรงกับที่ wf2MapRow อ่าน
  // employee_name / employee_id / benefit_type(required) / status / start_date / end_date / note
  var WF_FIELDS = [
    { key: 'employee_name', label: 'พนักงาน', type: 'text', required: true, ph: 'ชื่อ-สกุล พนักงาน' },
    { key: 'employee_id', label: 'รหัสพนักงาน', type: 'text', required: false, ph: 'เช่น EMP001' },
    { key: 'benefit_type', label: 'ประเภทสวัสดิการ', type: 'text', required: true, ph: 'เช่น ประกันสุขภาพ' },
    { key: 'status', label: 'สถานะ', type: 'text', required: false, ph: 'เช่น ใช้งาน / รออนุมัติ' },
    { key: 'start_date', label: 'วันเริ่ม', type: 'date', required: false, half: true },
    { key: 'end_date', label: 'วันสิ้นสุด', type: 'date', required: false, half: true },
    { key: 'note', label: 'หมายเหตุ', type: 'textarea', required: false, ph: 'รายละเอียดเพิ่มเติม (ถ้ามี)' },
  ];

  var _wfEditId = null; // null = เพิ่มใหม่ · มีค่า = แก้

  function buildForm(row) {
    var halves = [];
    var html = WF_FIELDS.map(function (f) {
      var val = '';
      if (row) {
        if (f.key === 'employee_name') val = row.employee || '';
        else if (f.key === 'employee_id') val = row.employee_id || '';
        else if (f.key === 'benefit_type') val = row.type || '';
        else if (f.key === 'status') val = row.status || '';
        else if (f.key === 'start_date') val = row.start_date || '';
        else if (f.key === 'end_date') val = row.end_date || '';
        else if (f.key === 'note') val = row.note || '';
      }
      var req = f.required ? ' <span class="req">*</span>' : '';
      var attrs = 'id="wf-f-' + f.key + '"' + (f.required ? ' required' : '') + (f.ph ? ' placeholder="' + escapeHtml(f.ph) + '"' : '');
      var ctrl;
      if (f.type === 'textarea') {
        ctrl = '<textarea ' + attrs + '>' + escapeHtml(val) + '</textarea>';
      } else {
        ctrl = '<input type="' + f.type + '" ' + attrs + ' value="' + escapeHtml(val) + '">';
      }
      var fld = '<div class="fld"><label>' + escapeHtml(f.label) + req + '</label>' + ctrl + '</div>';
      if (f.half) { halves.push(fld); return ''; }
      return fld;
    });
    // วันเริ่ม + วันสิ้นสุด → จัดเป็นแถวคู่
    var out = html.filter(function (s) { return s; }).join('');
    if (halves.length) {
      out += '<div class="fld-row">' + halves.join('') + '</div>';
    }
    return out;
  }

  function openModal(title, row, editId) {
    _wfEditId = editId || null;
    var t = $id('wf-modal-title'); if (t) t.textContent = title;
    var body = $id('wf-form-body'); if (body) body.innerHTML = buildForm(row);
    var m = $id('wf-modal'); if (m) m.classList.add('open');
    var first = body && body.querySelector('input,textarea');
    if (first) try { first.focus(); } catch (e) {}
  }

  function wfCloseModal() {
    var m = $id('wf-modal'); if (m) m.classList.remove('open');
    _wfEditId = null;
  }

  function wfOpenAdd() {
    openModal('เพิ่มสวัสดิการ', null, null);
  }

  function wfOpenEdit(id) {
    var rows = (_wfData && _wfData.rows) || [];
    var row = null;
    for (var i = 0; i < rows.length; i++) { if (String(rows[i].id) === String(id)) { row = rows[i]; break; } }
    if (!row) { showToast('ไม่พบรายการ', 'error'); return; }
    openModal('แก้ไขสวัสดิการ', row, id);
  }

  function collectForm() {
    var payload = {};
    var missing = false;
    WF_FIELDS.forEach(function (f) {
      var el = $id('wf-f-' + f.key);
      var v = el ? String(el.value || '').trim() : '';
      if (f.required && !v) missing = true;
      if (v !== '') payload[f.key] = v; // กัน null/ค่าว่าง — ส่งเฉพาะที่มีค่า
    });
    return { payload: payload, missing: missing };
  }

  function wfSubmitForm(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var c = collectForm();
    if (c.missing) { showToast('กรุณากรอกฟิลด์ที่จำเป็น (*)', 'error'); return false; }
    var btn = $id('wf-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
    WF_BACKEND.wfSave(c.payload, _wfEditId).then(function (res) {
      if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; }
      if (res.denied) { showToast('ต้องเป็น HR / ล็อกอินก่อน', 'error'); return; }
      if (!res.ok) { showToast('บันทึกไม่สำเร็จ: ' + (res.error || ''), 'error'); return; }
      showToast(_wfEditId ? 'แก้ไขเรียบร้อย' : 'เพิ่มเรียบร้อย', 'success');
      wfCloseModal();
      loadData();
    }).catch(function (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; }
      showToast('บันทึกไม่สำเร็จ: ' + ((e && e.message) || e), 'error');
    });
    return false;
  }

  function wfAskDelete(id) {
    if (!id) return;
    var rows = (_wfData && _wfData.rows) || [];
    var label = id;
    for (var i = 0; i < rows.length; i++) { if (String(rows[i].id) === String(id)) { label = (rows[i].employee || '') + ' · ' + (rows[i].type || ''); break; } }
    if (!window.confirm('ยืนยันลบรายการสวัสดิการนี้?\n' + label)) return;
    WF_BACKEND.wfDelete(id).then(function (res) {
      if (res.denied) { showToast('ต้องเป็น HR / ล็อกอินก่อน', 'error'); return; }
      if (!res.ok) { showToast('ลบไม่สำเร็จ: ' + (res.error || ''), 'error'); return; }
      showToast('ลบเรียบร้อย', 'success');
      loadData();
    }).catch(function (e) {
      showToast('ลบไม่สำเร็จ: ' + ((e && e.message) || e), 'error');
    });
  }

  function wfReload() { loadData(); }
  function wfRender() { renderAll(); }

  // init labels
  $id('wf-refresh-btn').innerHTML = ICON_REFRESH + ' รีเฟรช';

  // expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix wf* กันชน)
  window.wfReload = wfReload;
  window.wfRender = wfRender;
  window.wfOpenAdd = wfOpenAdd;
  window.wfOpenEdit = wfOpenEdit;
  window.wfAskDelete = wfAskDelete;
  window.wfCloseModal = wfCloseModal;
  window.wfSubmitForm = wfSubmitForm;

  // init
  loadData();
}

/* expose mount + backend ไปยัง window (index.html เรียก window.mountWelfare) */
if (typeof window !== 'undefined') {
  window.mountWelfare = mountWelfare;
  window.WF_BACKEND = WF_BACKEND;
}
