// _ported/myday.js — "ศูนย์ทำงานวันนี้ (My Day)"
// หน้า action-center: รวมทุกอย่างที่ต้องทำวันนี้ + กดอนุมัติ/ปฏิเสธได้เลย inline
// เป้า: "ทำงานง่ายที่สุด"
//
// pattern เดียวกับ _ported/leavereq.js (approve จริงผ่าน hr_approve) + _ported/fosales.js (read) + _ported/accessreq.js (line_login):
//   - window.mountMyday render เข้า #wrap-myday
//   - ใช้ global window.sb / window.esc / window.$ (index.html module scope) — ห้าม redeclare
//   - CSS scope ใต้ #md · fn ที่ inline onclick ใช้ → ผูกกับ window (prefix md* กันชน)
//   - helper (esc/toast) inline ใน scope
//
// ส่วนของหน้า:
//   1) 🔴 รออนุมัติ (กดได้จริง inline) — ลา/OT/ขอแก้ข้อมูล/เบิกเงิน → hr_approve · คำขอสิทธิ์ → line_login
//   2) 🟡 ครบกำหนด/เตือน (อ่านอย่างเดียว + ลิงก์) — สัญญา/ใบอนุญาต/ทดลองงาน/วันเกิด/ครบรอบ
//   3) 📋 งานค้าง — task.updated ที่ยังไม่เสร็จ
//
// ทุก fetch ห่อ try/catch แยก — type ไหน error/ว่าง → ส่วนนั้นซ่อน/empty · ไม่ทำทั้งหน้าพัง

/* ============================================================
   mountMyday — set innerHTML (CSS+markup) แล้วรัน JS หน้า
   ============================================================ */
function mountMyday() {
  if (!document.getElementById('wrap-myday')) return;
  var wrap = document.getElementById('wrap-myday');
  wrap.innerHTML = '<style>' + MD_CSS() + '</style><div id="md">' + MD_MARKUP() + '</div>';
  MD_RUN_PAGE_JS();
}

/* ===== CSS · prefix ทุก selector ด้วย #md (brand tokens เดียวกับหน้าอื่น) ===== */
function MD_CSS() {
  return [
    '#md{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#md *{box-sizing:border-box}',
    // ---- greeting header ----
    '#md .md-hello{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#md .md-hello h1{font-size:22px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0}',
    '#md .md-hello .md-date{font-size:13px;color:var(--text-muted);margin-top:4px}',
    '#md .md-hello .md-actions{display:flex;gap:8px;flex-shrink:0}',
    // ---- summary chips (นับงานแต่ละส่วน) ----
    '#md .md-summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px}',
    '#md .md-chip{flex:1;min-width:150px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 16px;position:relative;overflow:hidden}',
    '#md .md-chip::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--text-faint)}',
    '#md .md-chip.red::before{background:var(--danger)}',
    '#md .md-chip.amber::before{background:var(--warning)}',
    '#md .md-chip.blue::before{background:var(--info)}',
    '#md .md-chip .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#md .md-chip .v{font-size:26px;font-weight:600;line-height:1;margin-top:6px;letter-spacing:-.02em;color:var(--navy)}',
    '#md .md-chip.red .v{color:var(--danger)}',
    '#md .md-chip.amber .v{color:var(--warning)}',
    '#md .md-chip.blue .v{color:var(--info)}',
    '#md .md-chip .s{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // ---- section ----
    '#md .md-sec{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.03);margin-bottom:16px}',
    '#md .md-sec-head{padding:12px 18px;background:linear-gradient(180deg,#F8FAFC 0%,var(--surface) 100%);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px}',
    '#md .md-sec-head .ico{font-size:18px;line-height:1}',
    '#md .md-sec-head .t{font-size:14px;font-weight:600;color:var(--text);flex:1}',
    '#md .md-sec-head .c{font-size:11px;font-weight:600;padding:2px 10px;border-radius:12px;background:#F1F5F9;color:var(--text-muted)}',
    '#md .md-sec-head .c.has{background:var(--danger-bg);color:var(--danger)}',
    '#md .md-sec-body{padding:8px 14px 14px}',
    // ---- approval card (inline action) ----
    '#md .md-grp{margin-top:10px}',
    '#md .md-grp-title{font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:12px 4px 6px;display:flex;align-items:center;gap:6px}',
    '#md .md-card{border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;background:#fff;transition:opacity .3s,border-color .15s}',
    '#md .md-card:hover{border-color:var(--border-strong)}',
    '#md .md-card .md-row1{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline}',
    '#md .md-card .md-name{font-weight:600;color:var(--navy);font-size:14px}',
    '#md .md-card .md-when{font-size:11px;color:var(--text-faint);white-space:nowrap}',
    '#md .md-card .md-meta{font-size:12px;color:var(--text-muted);margin:4px 0 10px;line-height:1.55}',
    '#md .md-card .md-tag{display:inline-block;font-size:10px;font-weight:600;padding:1px 8px;border-radius:8px;background:var(--info-bg);color:var(--info);margin-right:6px}',
    '#md .md-card .md-act{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '#md .md-card select{flex:1;min-width:150px;height:34px;padding:0 10px;border:1px solid var(--border-strong);border-radius:8px;font-size:13px;font-family:inherit;background:#fff;color:var(--text)}',
    '#md .md-card .md-msg{font-size:12px;margin-top:8px}',
    // ---- buttons ----
    '#md .btn{padding:8px 16px;border:1px solid var(--border-strong);border-radius:8px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;background:#fff;color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.3}',
    '#md .btn:hover{border-color:var(--navy)}',
    '#md .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#md .btn-ok{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#md .btn-ok:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#md .btn-no{background:var(--danger-bg);color:var(--danger);border-color:var(--danger-border)}',
    '#md .btn-no:hover{border-color:var(--danger)}',
    '#md .btn-sm{padding:5px 12px;font-size:12px;font-weight:500}',
    '#md .btn-link{background:transparent;border:none;color:var(--info);font-weight:600;cursor:pointer;font-size:12px;padding:0}',
    '#md .btn-link:hover{text-decoration:underline}',
    // ---- alert list (อ่านอย่างเดียว) ----
    '#md .md-alert{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 12px;border-bottom:1px solid #F1F5F9}',
    '#md .md-alert:last-child{border-bottom:0}',
    '#md .md-alert .a-name{font-weight:500;color:var(--text)}',
    '#md .md-alert .a-sub{font-size:11px;color:var(--text-muted)}',
    '#md .md-pill{font-size:11px;font-weight:600;padding:2px 10px;border-radius:12px;white-space:nowrap}',
    '#md .md-pill.warn{background:var(--warning-bg);color:var(--warning)}',
    '#md .md-pill.danger{background:var(--danger-bg);color:var(--danger)}',
    '#md .md-pill.info{background:var(--info-bg);color:var(--info)}',
    '#md .md-pill.ok{background:var(--success-bg);color:var(--success)}',
    // ---- empty / loading ----
    '#md .md-empty{text-align:center;padding:22px 16px;color:var(--text-muted);font-size:13px}',
    '#md .md-loading{text-align:center;padding:40px;color:var(--text-muted);font-size:13px}',
    // ---- all-clear hero ----
    '#md .md-clear{text-align:center;padding:60px 20px;background:linear-gradient(135deg,#ECFDF5 0%,#F0FDFA 100%);border:1px solid #A7F3D0;border-radius:14px}',
    '#md .md-clear .big{font-size:48px;line-height:1}',
    '#md .md-clear .t{font-size:18px;font-weight:600;color:var(--success);margin-top:10px}',
    '#md .md-clear .s{font-size:13px;color:var(--text-muted);margin-top:4px}',
    '@media (max-width:680px){#md .md-summary{flex-direction:column}#md .md-chip{min-width:0}}',
  ].join('\n');
}

/* ===== markup ===== */
function MD_MARKUP() {
  return [
    '<div class="md-hello">',
    '  <div>',
    '    <h1 id="md-greet">สวัสดี</h1>',
    '    <div class="md-date" id="md-date"></div>',
    '  </div>',
    '  <div class="md-actions">',
    '    <button class="btn btn-sm" onclick="mdReload()" id="md-refresh">รีเฟรช</button>',
    '  </div>',
    '</div>',
    '<div class="md-summary" id="md-summary"></div>',
    '<div id="md-root"><div class="md-loading">กำลังโหลดงานวันนี้…</div></div>',
  ].join('\n');
}

/* ============================================================
   MD_RUN_PAGE_JS — รัน JS หน้า (closure) · helper inline · expose fn → window
   ============================================================ */
function MD_RUN_PAGE_JS() {
  var sb = (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
  var _mdRoot = document.getElementById('md');
  function $id(id) { return _mdRoot ? _mdRoot.querySelector('#' + id) : document.getElementById(id); }
  function esc(s) {
    if (typeof window !== 'undefined' && window.esc) return window.esc(s);
    var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML;
  }
  function escAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function toast(msg, type) {
    var t = document.getElementById('md2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'md2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:11px 18px;border-radius:8px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.18);font-size:13px;font-weight:600;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }

  // ---------- utils ----------
  function toArr(v) { return Array.isArray(v) ? v : []; }
  function lc(v) { return String(v == null ? '' : v).toLowerCase().trim(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
  function pick() { for (var i = 0; i < arguments.length; i++) { var v = arguments[i]; if (v != null && v !== '') return v; } return ''; }
  function ymd(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v).slice(0, 10);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function whenShort(v) { return String(v || '').replace('T', ' ').slice(0, 16); }
  function daysTo(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr); if (isNaN(d.getTime())) return null;
    var t0 = new Date(); t0.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - t0.getTime()) / 86400000);
  }
  function todayThai() {
    var months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    var dows = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
    var d = new Date();
    return 'วัน' + dows[d.getDay()] + 'ที่ ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + (d.getFullYear() + 543);
  }
  function whoName() {
    try {
      var li = JSON.parse(localStorage.getItem('yy_line_id') || 'null');
      if (li && (li.employee_name || li.display_name)) return li.employee_name || li.display_name;
    } catch (e) {}
    return 'ผู้บริหาร';
  }
  // ลิงก์ "ดูทั้งหมด" — navTo ถ้ามี · fallback showView
  function goView(v) {
    if (typeof window !== 'undefined') {
      if (typeof window.navTo === 'function') return window.navTo(v);
      if (typeof window.showView === 'function') return window.showView(v);
    }
  }
  window.mdGo = goView;

  // เรียก hr_list?type=... → items[] · error/ไม่มี sb → []
  function hrList(type, limit) {
    if (!sb || !sb.functions) return Promise.resolve([]);
    var q = 'hr_list?type=' + encodeURIComponent(type) + '&limit=' + (limit || 500);
    return sb.functions.invoke(q).then(function (res) {
      var data = (res && res.data) || {};
      return toArr(data.items || data.requests);
    }).catch(function (e) { console.warn('[myday] hr_list ' + type + ' failed', e); return []; });
  }
  // เรียก edge fn (no query) → data · error → null
  function invokeFn(name, body) {
    if (!sb || !sb.functions) return Promise.resolve(null);
    return sb.functions.invoke(name, body ? { body: body } : undefined).then(function (res) {
      if (res && res.error) throw res.error;
      return (res && res.data) || null;
    }).catch(function (e) { console.warn('[myday] ' + name + ' failed', e); return null; });
  }

  // pending = สถานะที่ยังรออนุมัติ (รองรับ string ไทย/อังกฤษ/ว่าง)
  var PENDING_SET = { pending: 1, requested: 1, 'change_requested': 1, claimed: 1, submitted: 1, 'รออนุมัติ': 1, '': 1 };
  function isPending(r) { return !!PENDING_SET[lc(r && r.status)]; }

  // ---------- state ----------
  var _state = { leave: [], ot: [], pinfo: [], expense: [], access: [], task: [] };
  var _counts = { approve: 0, alert: 0, task: 0 };

  // ============================================================
  // ส่วน 1 · 🔴 รออนุมัติ — แต่ละ type โหลดแยก try/catch · render การ์ด inline
  // ============================================================
  var APPROVE_GROUPS = [
    { key: 'leave', type: 'leave.updated', kind: 'hr', label: 'ลา', emoji: '🌴' },
    { key: 'ot', type: 'ot.updated', kind: 'hr', label: 'OT (ทำงานล่วงเวลา)', emoji: '⏱️' },
    { key: 'pinfo', type: 'personal_info.change_requested', kind: 'hr', label: 'ขอแก้ข้อมูลส่วนตัว', emoji: '✏️' },
    { key: 'expense', type: 'expense.claimed', kind: 'hr', label: 'เบิกเงิน', emoji: '💸' },
    { key: 'access', type: '', kind: 'access', label: 'คำขอสิทธิ์เข้าระบบ', emoji: '🔑' },
  ];
  var ROLES = [
    ['staff', 'พนักงาน (staff)'], ['hr', 'ทรัพยากรบุคคล (hr)'], ['accountant', 'บัญชี (accountant)'],
    ['purchasing', 'จัดซื้อ (purchasing)'], ['director', 'ผู้บริหาร (director)'],
  ];
  var _empRoster = [];

  // โหลดรายการ hr-type ที่รออนุมัติ
  function loadHrPending(type) {
    return hrList(type).then(function (items) {
      return items.filter(isPending).map(function (r) {
        return {
          request_id: pick(r.request_id, r.id, r.entity_id),
          employee_id: pick(r.employee_id, ''),
          name: pick(r.employee_name, r.full_name, r.name, r.employee_id, '(ไม่ระบุชื่อ)'),
          branch_id: pick(r.branch_id, ''),
          when: pick(r.submitted_at, r.created_at, r.requested_at, ''),
          summary: hrSummary(type, r),
          _raw: r,
        };
      });
    });
  }
  // สรุปรายละเอียดสั้น ๆ ต่อ type
  function hrSummary(type, r) {
    if (type === 'leave.updated') {
      var sd = ymd(r.start_date), ed = ymd(r.end_date || r.start_date);
      var rng = sd ? (sd + (ed && ed !== sd ? ' – ' + ed : '')) : '';
      return [lc(r.leave_type) || 'ลา', rng, (r.days != null ? r.days + ' วัน' : ''), r.reason].filter(Boolean).join(' · ');
    }
    if (type === 'ot.updated') {
      return [ymd(r.date || r.ot_date), (r.hours != null ? r.hours + ' ชม.' : ''), r.reason].filter(Boolean).join(' · ');
    }
    if (type === 'personal_info.change_requested') {
      return [pick(r.field, r.field_name, ''), r.new_value ? '→ ' + r.new_value : '', r.reason].filter(Boolean).join(' · ') || 'ขอแก้ข้อมูลส่วนตัว';
    }
    if (type === 'expense.claimed') {
      var amt = num(r.amount);
      var amtTxt = amt != null ? fmtBaht(amt) : '';
      return [amtTxt, pick(r.category, r.expense_type, ''), r.reason || r.note].filter(Boolean).join(' · ') || 'เบิกเงิน';
    }
    return '';
  }
  function fmtBaht(n) {
    try { return '฿' + Number(n).toLocaleString('th-TH', { maximumFractionDigits: 0 }); } catch (e) { return '฿' + Math.round(n); }
  }

  // โหลดคำขอสิทธิ์เข้าระบบ (line_login action:requests) + roster (ให้เลือกผูกพนักงาน)
  function loadAccessPending() {
    if (!sb || !sb.functions) return Promise.resolve([]);
    var pRoster = sb.from ? sb.from('employees').select('employee_id,full_name,branch_id,position').order('full_name').limit(1000) : Promise.resolve({ data: [] });
    var pReq = invokeFn('line_login', { action: 'requests' });
    return Promise.all([Promise.resolve(pRoster).catch(function () { return { data: [] }; }), pReq]).then(function (arr) {
      _empRoster = (arr[0] && arr[0].data) || [];
      var data = arr[1] || {};
      return toArr(data.requests).map(function (r) {
        return {
          uid: r.uid,
          name: pick(r.full_name, r.display_name, '(ไม่ระบุชื่อ)'),
          display_name: r.display_name || '',
          position: r.position || '',
          branch_id: r.branch_id || '',
          when: pick(r.requested_at, ''),
          note: r.note || '',
          _raw: r,
        };
      });
    }).catch(function (e) { console.warn('[myday] access requests failed', e); return []; });
  }

  // ---- render การ์ดอนุมัติ ----
  function approveCardHtml(g, r) {
    var when = whenShort(r.when);
    var metaBits = [];
    if (r.branch_id) metaBits.push('สาขา ' + esc(r.branch_id));
    if (r.employee_id) metaBits.push('<span style="font-family:monospace;font-size:10px;color:#94A3B8">' + esc(r.employee_id) + '</span>');
    var meta = metaBits.join(' · ');
    var summary = r.summary ? '<div>' + esc(r.summary) + '</div>' : '';
    return [
      '<div class="md-card" data-key="' + g.key + '" data-id="' + escAttr(r.request_id) + '">',
      '  <div class="md-row1">',
      '    <div class="md-name"><span class="md-tag">' + esc(g.label) + '</span>' + esc(r.name) + '</div>',
      '    <div class="md-when">' + (when ? 'ขอเมื่อ ' + esc(when) : '') + '</div>',
      '  </div>',
      '  <div class="md-meta">' + summary + (meta ? '<div>' + meta + '</div>' : '') + '</div>',
      '  <div class="md-act">',
      '    <button class="btn btn-ok md-ok">อนุมัติ</button>',
      '    <button class="btn btn-no md-no">ปฏิเสธ</button>',
      '  </div>',
      '  <div class="md-msg"></div>',
      '</div>',
    ].join('');
  }
  // การ์ดคำขอสิทธิ์ (มี dropdown เลือกพนักงาน + role)
  function accessCardHtml(r) {
    var empOpts = '<option value="">— เลือกพนักงาน —</option>' + _empRoster.map(function (e) {
      return '<option value="' + escAttr(e.employee_id) + '">' + esc(e.full_name || e.employee_id) + ' · ' + esc(e.branch_id || '') + '</option>';
    }).join('');
    var roleOpts = ROLES.map(function (x) { return '<option value="' + x[0] + '">' + esc(x[1]) + '</option>'; }).join('');
    var when = whenShort(r.when);
    var metaBits = [];
    if (r.display_name) metaBits.push('LINE: ' + esc(r.display_name));
    if (r.position) metaBits.push(esc(r.position));
    if (r.branch_id) metaBits.push('สาขา ' + esc(r.branch_id));
    return [
      '<div class="md-card md-access" data-uid="' + escAttr(r.uid) + '">',
      '  <div class="md-row1">',
      '    <div class="md-name"><span class="md-tag">🔑 สิทธิ์</span>' + esc(r.name) + '</div>',
      '    <div class="md-when">' + (when ? 'ขอเมื่อ ' + esc(when) : '') + '</div>',
      '  </div>',
      '  <div class="md-meta">' + (metaBits.join(' · ') || '') + (r.note ? '<div>📝 ' + esc(r.note) + '</div>' : '') +
      '    <div style="font-family:monospace;font-size:10px;color:#CBD5E1;margin-top:2px">' + esc(r.uid) + '</div>',
      '  </div>',
      '  <div class="md-act">',
      '    <select class="md-emp">' + empOpts + '</select>',
      '    <select class="md-role">' + roleOpts + '</select>',
      '    <button class="btn btn-ok md-ok">อนุมัติ</button>',
      '    <button class="btn btn-no md-no">ปฏิเสธ</button>',
      '  </div>',
      '  <div class="md-msg"></div>',
      '</div>',
    ].join('');
  }

  // bind ปุ่มอนุมัติ/ปฏิเสธ (hr_approve)
  function bindHrCard(el) {
    var id = el.getAttribute('data-id');
    var msg = el.querySelector('.md-msg');
    el.querySelector('.md-ok').onclick = function () { doHrApprove(el, id, 'approved', msg); };
    el.querySelector('.md-no').onclick = function () {
      var note = prompt('เหตุผลที่ปฏิเสธ (ถ้ามี)?', '');
      if (note === null) return;
      doHrApprove(el, id, 'rejected', msg, note);
    };
  }
  function doHrApprove(el, id, decision, msg, note) {
    if (!id) { msg.style.color = '#B91C1C'; msg.textContent = 'ไม่พบรหัสคำขอ'; return; }
    var btns = el.querySelectorAll('button');
    btns.forEach(function (b) { b.disabled = true; });
    msg.style.color = '#64748B'; msg.textContent = decision === 'approved' ? 'กำลังอนุมัติ…' : 'กำลังปฏิเสธ…';
    var body = { request_id: id, decision: decision };
    if (note != null && note !== '') body.note = note;
    sb.functions.invoke('hr_approve', { body: body }).then(function (res) {
      var err = res && res.error, data = (res && res.data) || {};
      var status = (err && (err.status || (err.context && err.context.status))) || data.status || 0;
      if (err || data.error || !data.ok) {
        var em = (data && data.error) || (err && err.message) || 'ไม่สำเร็จ';
        if (Number(status) === 403) em = 'ต้องเป็น HR จึงจะอนุมัติได้';
        throw new Error(em);
      }
      removeCard(el);
      toast(decision === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว', 'success');
    }).catch(function (e) {
      btns.forEach(function (b) { b.disabled = false; });
      msg.style.color = '#B91C1C'; msg.textContent = 'ไม่สำเร็จ: ' + ((e && e.message) || e);
    });
  }
  // bind ปุ่มคำขอสิทธิ์ (line_login)
  function bindAccessCard(el) {
    var uid = el.getAttribute('data-uid');
    var msg = el.querySelector('.md-msg');
    el.querySelector('.md-ok').onclick = function () {
      var employee_id = el.querySelector('.md-emp').value;
      var role = el.querySelector('.md-role').value;
      if (!employee_id) { msg.style.color = '#B91C1C'; msg.textContent = 'เลือกพนักงานก่อน'; return; }
      doAccess(el, msg, 'approve', { uid: uid, employee_id: employee_id, role: role });
    };
    el.querySelector('.md-no').onclick = function () {
      var note = prompt('เหตุผลที่ปฏิเสธ (ถ้ามี)?'); if (note === null) return;
      doAccess(el, msg, 'reject', { uid: uid, note: note });
    };
  }
  function doAccess(el, msg, action, body) {
    var btns = el.querySelectorAll('button');
    btns.forEach(function (b) { b.disabled = true; });
    msg.style.color = '#64748B'; msg.textContent = action === 'approve' ? 'กำลังอนุมัติ…' : 'กำลังปฏิเสธ…';
    sb.functions.invoke('line_login', { body: Object.assign({ action: action }, body) }).then(function (res) {
      var err = res && res.error, data = (res && res.data) || {};
      if (err) {
        var em = err.message;
        try { return err.context.json().then(function (j) { throw new Error((j.error || em) + (j.need ? ' (ต้องเป็น ' + j.need + ')' : '')); }); } catch (e) {}
        throw new Error(em);
      }
      if (data && data.error) throw new Error(data.error + (data.need ? ' (ต้องเป็น ' + data.need + ')' : ''));
      removeCard(el);
      toast(action === 'approve' ? 'อนุมัติแล้ว · แจ้ง LINE แล้ว' : 'ปฏิเสธแล้ว · แจ้ง LINE แล้ว', 'success');
    }).catch(function (e) {
      btns.forEach(function (b) { b.disabled = false; });
      msg.style.color = '#B91C1C'; msg.textContent = 'ไม่สำเร็จ: ' + ((e && e.message) || e);
    });
  }

  // ลบการ์ดออก + อัปเดตตัวนับ · ถ้าหมด → empty
  function removeCard(el) {
    el.style.opacity = '0';
    setTimeout(function () {
      var sec = $id('md-approve-body');
      if (el && el.parentNode) el.parentNode.removeChild(el);
      _counts.approve = Math.max(0, _counts.approve - 1);
      // ลบ group title ที่ว่าง
      if (sec) {
        sec.querySelectorAll('.md-grp').forEach(function (g) {
          if (!g.querySelector('.md-card')) g.parentNode && g.parentNode.removeChild(g);
        });
        if (!sec.querySelector('.md-card')) {
          sec.innerHTML = '<div class="md-empty">✅ ไม่มีรายการรออนุมัติแล้ว</div>';
        }
      }
      refreshSummary();
    }, 280);
  }

  // ============================================================
  // ส่วน 2 · 🟡 ครบกำหนด/เตือน (อ่านอย่างเดียว + ลิงก์)
  // ============================================================
  // สัญญาใกล้หมด
  function loadContractAlert() {
    return invokeFn('hr_contract_alert').then(function (d) {
      if (!d) return null;
      var rows = toArr(d.expiring).map(function (r) {
        return { name: pick(r.employee_name, r.name, r.employee_id, '—'), branch: r.branch_id || '', sub: pick(r.contract_end_date, ''), days: num(r.days_left) };
      });
      return { rows: rows, view: 'contract' };
    });
  }
  // ใบอนุญาตใกล้หมด (≤60 วัน client-side)
  function loadLicenseAlert() {
    return hrList('license.updated').then(function (items) {
      var rows = items.map(function (p) {
        var exp = pick(p.expiry_date, p.expiry, '');
        if (exp) exp = String(exp).slice(0, 10);
        return { name: pick(p.employee_name, p.name, p.employee_id, '—'), branch: p.branch_id || '', type: pick(p.type, p.license_type, ''), sub: exp, days: daysTo(exp) };
      }).filter(function (r) { return r.days != null && r.days <= 60; });
      rows.sort(function (a, b) { return a.days - b.days; });
      return rows.length ? { rows: rows, view: 'license' } : null;
    });
  }
  // daily digest: probation ครบกำหนด + วันเกิดวันนี้ + ครบรอบงาน
  function loadDigest() {
    return invokeFn('hr_daily_digest').then(function (d) {
      if (!d) return null;
      return {
        probation: toArr(d.probation).map(function (r) {
          return { name: pick(r.employee_name, r.name, r.employee_id, '—'), branch: r.branch_id || '', sub: pick(r.due_date, ''), days: num(r.due_in_days) };
        }),
        birthday: toArr(d.birthdays).filter(function (r) { return num(r.in_days) === 0; }).map(function (r) {
          return { name: pick(r.employee_name, r.name, r.employee_id, '—'), branch: r.branch_id || '', sub: r.turning != null ? 'ครบ ' + r.turning + ' ปี' : '' };
        }),
        onleave: toArr(d.on_leave_today).map(function (r) {
          return { name: pick(r.employee_name, r.name, r.employee_id, '—'), branch: r.branch_id || '', sub: pick(r.leave_type, r.reason, '') };
        }),
      };
    });
  }

  function alertRow(r, opts) {
    opts = opts || {};
    var pill = '';
    if (r.days != null) {
      var cls = r.days < 0 ? 'danger' : (r.days <= 7 ? 'warn' : 'info');
      pill = '<span class="md-pill ' + cls + '">' + (r.days < 0 ? 'เลย ' + Math.abs(r.days) + ' วัน' : 'อีก ' + r.days + ' วัน') + '</span>';
    } else if (opts.pill) {
      pill = '<span class="md-pill ' + (opts.pillCls || 'info') + '">' + esc(opts.pill) + '</span>';
    }
    var subBits = [];
    if (r.type) subBits.push(esc(r.type));
    if (r.branch) subBits.push('สาขา ' + esc(r.branch));
    if (r.sub) subBits.push(esc(r.sub));
    return '<div class="md-alert"><div><div class="a-name">' + esc(r.name) + '</div>' +
      (subBits.length ? '<div class="a-sub">' + subBits.join(' · ') + '</div>' : '') + '</div>' + pill + '</div>';
  }
  // กล่องเตือน 1 ชนิด (มีหัวข้อ + นับ + ลิงก์ดูทั้งหมด)
  function alertBlock(title, rows, view, opts) {
    if (!rows || !rows.length) return '';
    var shown = rows.slice(0, 5);
    var more = rows.length > 5 ? '<div class="md-empty" style="padding:8px">…และอีก ' + (rows.length - 5) + ' รายการ</div>' : '';
    var link = view ? '<button class="btn-link" onclick="mdGo(\'' + escAttr(view) + '\')">ดูทั้งหมด →</button>' : '';
    return [
      '<div class="md-grp">',
      '  <div class="md-grp-title">' + esc(title) + ' <span class="c" style="background:#F1F5F9;color:#64748B;padding:1px 8px;border-radius:10px;font-size:10px">' + rows.length + '</span>' +
      '    <span style="flex:1"></span>' + link,
      '  </div>',
      shown.map(function (r) { return alertRow(r, opts); }).join(''),
      more,
      '</div>',
    ].join('');
  }

  // ============================================================
  // ส่วน 3 · 📋 งานค้าง — task.updated ที่ยังไม่เสร็จ
  // ============================================================
  function loadTasks() {
    return hrList('task.updated', 2000).then(function (items) {
      return items.map(function (p) {
        var st = lc(p.status);
        var due = ymd(p.due_date || p.due);
        return {
          name: pick(p.template_name, p.task_name, p.title, 'งาน ad-hoc'),
          owner: pick(p.owner_name, p.owner, '—'),
          branch: pick(p.branch_name, p.branch_id, ''),
          status: st,
          due: due,
          days: due ? daysTo(due) : null,
        };
      }).filter(function (t) { return t.status !== 'done' && t.status !== 'completed' && t.status !== 'cancelled'; });
    });
  }
  function taskRow(t) {
    var pill = '';
    if (t.days != null) {
      if (t.days < 0) pill = '<span class="md-pill danger">เกิน ' + Math.abs(t.days) + ' วัน</span>';
      else if (t.days === 0) pill = '<span class="md-pill warn">ครบวันนี้</span>';
      else pill = '<span class="md-pill info">อีก ' + t.days + ' วัน</span>';
    }
    var subBits = [];
    if (t.owner && t.owner !== '—') subBits.push('ผู้รับผิดชอบ ' + esc(t.owner));
    if (t.branch) subBits.push('สาขา ' + esc(t.branch));
    if (t.due) subBits.push('ครบ ' + esc(t.due));
    return '<div class="md-alert"><div><div class="a-name">' + esc(t.name) + '</div>' +
      (subBits.length ? '<div class="a-sub">' + subBits.join(' · ') + '</div>' : '') + '</div>' + pill + '</div>';
  }

  // ============================================================
  // RENDER — โหลดทุกส่วน (try/catch แยกกัน) แล้ว render
  // ============================================================
  function refreshSummary() {
    var html = [
      '<div class="md-chip red"><div class="l">รออนุมัติ</div><div class="v">' + _counts.approve + '</div><div class="s">กดอนุมัติ/ปฏิเสธได้เลย</div></div>',
      '<div class="md-chip amber"><div class="l">ครบกำหนด / เตือน</div><div class="v">' + _counts.alert + '</div><div class="s">สัญญา · ใบอนุญาต · ทดลองงาน</div></div>',
      '<div class="md-chip blue"><div class="l">งานค้าง</div><div class="v">' + _counts.task + '</div><div class="s">task ที่ยังไม่เสร็จ</div></div>',
    ].join('');
    var el = $id('md-summary'); if (el) el.innerHTML = html;
  }

  function render() {
    $id('md-greet').textContent = 'สวัสดี ' + whoName();
    $id('md-date').textContent = todayThai();

    var root = $id('md-root');
    root.innerHTML = '<div class="md-loading">กำลังโหลดงานวันนี้…</div>';

    // โหลดทุกส่วนพร้อมกัน — แต่ละ promise กัน error ในตัวแล้ว (คืน [] / null)
    var pHr = Promise.all(APPROVE_GROUPS.filter(function (g) { return g.kind === 'hr'; }).map(function (g) {
      return loadHrPending(g.type).then(function (rows) { return { g: g, rows: rows }; }).catch(function () { return { g: g, rows: [] }; });
    }));
    var pAccess = loadAccessPending().catch(function () { return []; });
    var pContract = loadContractAlert().catch(function () { return null; });
    var pLicense = loadLicenseAlert().catch(function () { return null; });
    var pDigest = loadDigest().catch(function () { return null; });
    var pTasks = loadTasks().catch(function () { return []; });

    Promise.all([pHr, pAccess, pContract, pLicense, pDigest, pTasks]).then(function (out) {
      var hrGroups = out[0] || [];
      var access = out[1] || [];
      var contract = out[2];
      var license = out[3];
      var digest = out[4];
      var tasks = out[5] || [];

      // ---- count ----
      var approveCount = access.length;
      hrGroups.forEach(function (x) { approveCount += x.rows.length; });
      _counts.approve = approveCount;

      var alertCount = 0;
      if (contract) alertCount += contract.rows.length;
      if (license) alertCount += license.rows.length;
      if (digest) alertCount += digest.probation.length + digest.birthday.length + digest.onleave.length;
      _counts.alert = alertCount;

      _counts.task = tasks.length;

      refreshSummary();

      // ---- ถ้าไม่มีอะไรเลย → all-clear ----
      if (_counts.approve === 0 && _counts.alert === 0 && _counts.task === 0) {
        root.innerHTML = [
          '<div class="md-clear">',
          '  <div class="big">✅</div>',
          '  <div class="t">วันนี้ไม่มีงานค้าง</div>',
          '  <div class="s">ทุกอย่างเรียบร้อย เคลียร์หมดแล้ว 🎉</div>',
          '</div>',
        ].join('');
        return;
      }

      var html = '';

      // ===== ส่วน 1 · รออนุมัติ =====
      var approveInner = '';
      hrGroups.forEach(function (x) {
        if (!x.rows.length) return;
        approveInner += '<div class="md-grp"><div class="md-grp-title">' + esc(x.g.emoji + ' ' + x.g.label) +
          ' <span class="c" style="background:#FEF2F2;color:#B91C1C;padding:1px 8px;border-radius:10px;font-size:10px">' + x.rows.length + '</span></div>' +
          x.rows.map(function (r) { return approveCardHtml(x.g, r); }).join('') + '</div>';
      });
      if (access.length) {
        approveInner += '<div class="md-grp"><div class="md-grp-title">🔑 คำขอสิทธิ์เข้าระบบ' +
          ' <span class="c" style="background:#FEF2F2;color:#B91C1C;padding:1px 8px;border-radius:10px;font-size:10px">' + access.length + '</span></div>' +
          access.map(accessCardHtml).join('') + '</div>';
      }
      html += [
        '<div class="md-sec">',
        '  <div class="md-sec-head"><span class="ico">🔴</span><span class="t">รออนุมัติ</span>',
        '    <span class="c' + (_counts.approve ? ' has' : '') + '">' + _counts.approve + '</span></div>',
        '  <div class="md-sec-body" id="md-approve-body">' + (approveInner || '<div class="md-empty">✅ ไม่มีรายการรออนุมัติ</div>') + '</div>',
        '</div>',
      ].join('');

      // ===== ส่วน 2 · ครบกำหนด/เตือน =====
      var alertInner = '';
      if (contract && contract.rows.length) alertInner += alertBlock('สัญญาใกล้หมด', contract.rows, 'contract');
      if (license && license.rows.length) alertInner += alertBlock('ใบอนุญาตใกล้หมด (≤60 วัน)', license.rows, 'license');
      if (digest) {
        alertInner += alertBlock('ทดลองงานครบกำหนด', digest.probation, 'probreview');
        alertInner += alertBlock('วันเกิดวันนี้', digest.birthday, 'birthday', { pill: '🎂 วันนี้', pillCls: 'ok' });
        alertInner += alertBlock('ลาวันนี้', digest.onleave, 'leavereq', { pill: 'ลาวันนี้', pillCls: 'info' });
      }
      if (alertInner) {
        html += [
          '<div class="md-sec">',
          '  <div class="md-sec-head"><span class="ico">🟡</span><span class="t">ครบกำหนด / เตือน</span>',
          '    <span class="c">' + _counts.alert + '</span></div>',
          '  <div class="md-sec-body">' + alertInner + '</div>',
          '</div>',
        ].join('');
      }

      // ===== ส่วน 3 · งานค้าง =====
      if (tasks.length) {
        tasks.sort(function (a, b) {
          var da = a.days == null ? 9999 : a.days, db = b.days == null ? 9999 : b.days;
          return da - db;
        });
        var shown = tasks.slice(0, 10);
        var more = tasks.length > 10 ? '<div class="md-empty" style="padding:8px">…และอีก ' + (tasks.length - 10) + ' งาน</div>' : '';
        html += [
          '<div class="md-sec">',
          '  <div class="md-sec-head"><span class="ico">📋</span><span class="t">งานค้าง</span>',
          '    <span class="c">' + tasks.length + '</span>',
          '    <button class="btn-link" onclick="mdGo(\'tasks\')">ดูทั้งหมด →</button></div>',
          '  <div class="md-sec-body">' + shown.map(taskRow).join('') + more + '</div>',
          '</div>',
        ].join('');
      }

      root.innerHTML = html;

      // bind ปุ่ม inline
      var body = $id('md-approve-body');
      if (body) {
        body.querySelectorAll('.md-card').forEach(function (el) {
          if (el.classList.contains('md-access')) bindAccessCard(el);
          else bindHrCard(el);
        });
      }
    }).catch(function (e) {
      console.error('[myday] render failed', e);
      root.innerHTML = '<div class="md-empty">โหลดงานวันนี้ไม่สำเร็จ · ' + esc((e && e.message) || 'unknown') + '</div>';
    });
  }

  function reload() { render(); }
  window.mdReload = reload;

  // init
  refreshSummary();
  render();
}

/* expose mount ไปยัง window (index.html เรียก window.mountMyday) */
if (typeof window !== 'undefined') {
  window.mountMyday = mountMyday;
}
