// _ported/compliance.js — FULL native port of desktop compliance_dashboard.html (HR Announcement admin · "Compliance ประจำปี")
// ลอกทั้งดุ้น (gold template = _ported/recruit.js · _ported/license.js):
//   CSS เดิม (:root tokens + <style> compliance_dashboard) prefix ทุก selector ด้วย #cp
//   markup เดิม คง element id/class เดิม (page-head · stats-row · cards · tables) → render เป็น string
//   หน้าเดิมเป็น GAS server-template (<?= summary/expired/expiring30/... ?>) → port เป็น client render
//   JS รันใน closure ของ mountCompliance() · google.script.run = shim → CP_BACKEND (Supabase)
//
// ใช้ global window.sb / window.esc / window.$ (index.html module scope) — ห้าม redeclare
// fn/var ที่ inline onclick/markup ต้องใช้ → ผูกกับ window prefix cp* กันชน
//
// backend (edge fn hr_list?type=<X> → {items}) — หน้าเดิมอ่านหลาย source · map ไปหลาย hr_list type:
//   เอกสารหมดอายุ/ใกล้หมด/ค้างส่ง  → license.updated + insurance.updated + training.updated (derive client-side)
//   filings (สปส./ภาษี/ภงด./PF)      → compliance.updated (filing_type/period/due_date/status)
//   ทุก type ว่างได้ → render empty state ได้ ไม่ error
//   ไม่มี write บนหน้านี้ (auto-reminder เป็น backend) → ถ้ามี action → stub + showToast

/* ============================================================
   CP_BACKEND — map google.script.run → Supabase edge fn hr_list (multi-type)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     complianceGetData() → { summary, expired, expiring30, expiring60,
                             overdueFilings, upcomingFilings, missing }
   ============================================================ */
var CP_FN = 'hr_list';
var CP_TYPE = 'compliance.updated';                       // filings (primary)
var CP_DOC_TYPES = ['license.updated', 'insurance.updated', 'training.updated']; // expiry docs

function cp2ToArr(v) { return Array.isArray(v) ? v : []; }
function cp2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function cp2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
// parse date (YYYY-MM-DD / ISO) → Date เที่ยงคืน local · null ถ้าไม่ valid
function cp2ParseDate(v) {
  if (!v) return null;
  var s = String(v).slice(0, 10);
  var d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}
function cp2DaysTo(expiry) {
  var d = cp2ParseDate(expiry);
  if (!d) return null;
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// map payload เอกสาร (license/insurance/training) → doc row shape ที่ markup เดิมใช้
function cp2MapDoc(p, src) {
  p = p || {};
  var expiry = p.expiry_date || p.expiry || p.valid_until || '';
  if (expiry) expiry = String(expiry).slice(0, 10);
  var days = cp2DaysTo(expiry);
  var docType =
    p.doc_type || p.document_name ||
    p.license_type_label || p.license_type ||
    p.insurance_type || p.plan_name ||
    p.training_name || p.course_name ||
    p.type || (src === 'insurance.updated' ? 'ประกัน' : src === 'training.updated' ? 'อบรม' : 'เอกสาร');
  var status = String(p.status || '').toLowerCase().trim();
  return {
    employee_id: p.employee_id || p.id || '',
    nickname: p.nickname || p.employee_name || p.emp_name || p.name || p.employee_id || '—',
    position_id: p.position_id || p.position_name || p.position || '',
    branch_id: p.branch_id || p.branch_name || p.branch || '',
    doc_type: docType,
    document_name: p.document_name || docType,
    expiry_date: expiry,
    _days: days,
    status: status || 'pending',
    _src: src,
  };
}

// map payload filing (compliance.updated) → filing row shape ที่ markup เดิมใช้
function cp2MapFiling(p) {
  p = p || {};
  var due = p.due_date || p.deadline || '';
  if (due) due = String(due).slice(0, 10);
  return {
    filing_type: p.filing_type || p.type || p.name || '—',
    description: p.description || p.note || p.notes || '',
    period: p.period || p.month || '',
    due_date: due,
    status: String(p.status || 'pending').toLowerCase().trim(),
    _days: cp2DaysTo(due),
  };
}

// แยกแยะว่า event เป็น filing (มี filing_type/due_date) หรือ doc (มี expiry)
function cp2IsFiling(p) {
  if (!p) return false;
  return !!(p.filing_type || p.due_date || p.deadline);
}

// fetch ทุก type ขนานกัน → คืน { docs:[...], filings:[...] }
function cp2FetchAll() {
  var fetchType = function (type) {
    return window.sb.functions.invoke(CP_FN + '?type=' + encodeURIComponent(type))
      .then(function (res) { return { type: type, items: cp2ToArr((res && res.data && res.data.items) || []) }; })
      .catch(function (e) { console.warn('[CP_BACKEND] fetch failed', type, e); return { type: type, items: [] }; });
  };
  var jobs = [fetchType(CP_TYPE)].concat(CP_DOC_TYPES.map(fetchType));
  return Promise.all(jobs).then(function (parts) {
    var docs = [], filings = [];
    parts.forEach(function (part) {
      part.items.forEach(function (p) {
        if (part.type === CP_TYPE) {
          // compliance.updated อาจมีทั้ง filing และ doc ปนกัน → แยกตาม shape
          if (cp2IsFiling(p)) filings.push(cp2MapFiling(p));
          else docs.push(cp2MapDoc(p, CP_TYPE));
        } else {
          docs.push(cp2MapDoc(p, part.type));
        }
      });
    });
    return { docs: docs, filings: filings };
  });
}

var CP_BACKEND = {
  // role gate — dashboard user = admin เต็มสิทธิ์
  complianceWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },

  // อ่านข้อมูล + derive bucket ทั้งหมดฝั่ง client (mirror template vars หน้าเดิม)
  complianceGetData: function () {
    return cp2FetchAll().then(function (bundle) {
      var docs = bundle.docs, filings = bundle.filings;

      var expired = [], expiring30 = [], expiring60 = [], missing = [];
      var seenActive = {};
      docs.forEach(function (d) {
        if (d.employee_id) seenActive[d.employee_id] = true;
        // เอกสารค้างส่ง — ไม่มีวันหมดอายุ + status pending/missing
        var st = String(d.status || '').toLowerCase();
        if (!d.expiry_date && (st === 'missing' || st === 'pending' || st === '')) {
          missing.push(d);
          return;
        }
        if (d._days == null) return;
        if (d._days < 0) {
          d.days_overdue = Math.abs(d._days);
          expired.push(d);
        } else if (d._days <= 30) {
          d.days_left = d._days;
          expiring30.push(d);
        } else if (d._days <= 60) {
          d.days_left = d._days;
          expiring60.push(d);
        }
      });
      expired.sort(function (a, b) { return (b.days_overdue || 0) - (a.days_overdue || 0); });
      expiring30.sort(function (a, b) { return (a.days_left || 0) - (b.days_left || 0); });
      expiring60.sort(function (a, b) { return (a.days_left || 0) - (b.days_left || 0); });

      var overdueFilings = [], upcomingFilings = [];
      filings.forEach(function (f) {
        var done = f.status === 'filed' || f.status === 'done' || f.status === 'completed' || f.status === 'submitted';
        if (done) return;
        if (f._days == null) return;
        if (f._days < 0) overdueFilings.push(f);
        else if (f._days <= 60) upcomingFilings.push(f);
      });
      upcomingFilings.sort(function (a, b) { return (a._days || 0) - (b._days || 0); });
      overdueFilings.sort(function (a, b) { return (a._days || 0) - (b._days || 0); });

      var summary = {
        expired_count: expired.length,
        expiring30_count: expiring30.length,
        expiring60_count: expiring60.length,
        missing_count: missing.length,
        total_active: Object.keys(seenActive).length,
      };

      return {
        summary: summary,
        expired: expired,
        expiring30: expiring30,
        expiring60: expiring60,
        overdueFilings: overdueFilings,
        upcomingFilings: upcomingFilings,
        missing: missing,
      };
    });
  },
};

var _cp2NotReadyShown = {};
function cp2NotReady(feature) {
  if (_cp2NotReadyShown[feature]) return;
  _cp2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.cp2Toast) window.cp2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountCompliance — set innerHTML (CSS+markup shell) แล้วโหลดข้อมูล + render
   ============================================================ */
function mountCompliance() {
  if (!document.getElementById('wrap-compliance')) return;
  var wrap = document.getElementById('wrap-compliance');
  wrap.innerHTML = '<style>' + CP_CSS() + '</style><div id="cp">' + CP_MARKUP() + '</div>';
  CP_RUN_PAGE_JS();
}

/* ===== CSS เดิม (:root tokens + <style> compliance_dashboard) · prefix ทุก selector ด้วย #cp =====
   ตัด .app-shell/.main-area/.page-head shell + body rules (dashboard มี shell แล้ว) · คง class เดิม */
function CP_CSS() {
  return [
    '#cp{--navy:#0D2F4F;--teal:#3DC5B7;--teal-hover:#2BA89B;--teal-light:#E6F7F5;--bg:#F5F6F8;--card:#FFF;--border:#E5E7EB;--text-1:#111827;--text-2:#6B7280;--text-3:#9CA3AF;--success:#16A34A;--warning:#F59E0B;--error:#DC2626;--info:#3B82F6;--radius-sm:6px;--radius-md:8px;--radius-lg:12px;--radius-xl:16px;color:var(--text-1);line-height:1.5}',
    '#cp *{box-sizing:border-box}',
    // page head (native บน dashboard)
    '#cp .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #E2E8F0}',
    '#cp .page-head h1{font-size:20px;font-weight:600;color:#0D2F4F;letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#cp .page-head h1 svg{width:18px;height:18px;color:#3DC5B7}',
    '#cp .page-head .subtitle{font-size:12px;color:#64748B;margin-top:4px}',
    '#cp .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    '#cp .page-badge{background:#FEE2E2;color:#991B1B;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600}',
    // buttons (refresh/help)
    '#cp .btn{padding:7px 14px;border:1px solid #CBD5E1;border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:#fff;color:var(--text-1);display:inline-flex;align-items:center;gap:6px;line-height:1.4}',
    '#cp .btn:hover{border-color:var(--navy)}',
    '#cp .btn svg{width:14px;height:14px}',
    '#cp .btn-sm{padding:5px 10px;font-size:12px}',
    '#cp .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid #CBD5E1;border-radius:8px;background:#fff;color:var(--text-2);cursor:pointer}',
    '#cp .btn-help:hover{border-color:var(--teal);color:var(--teal-hover)}',
    '#cp .btn-help svg{width:14px;height:14px}',
    // container
    '#cp .container{max-width:1280px;margin:0 auto;padding:0}',
    // stats row
    '#cp .stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}',
    '@media (max-width:800px){#cp .stats-row{grid-template-columns:repeat(2,1fr)}}',
    '@media (max-width:480px){#cp .stats-row{grid-template-columns:1fr}}',
    '#cp .stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;position:relative;overflow:hidden}',
    '#cp .stat::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:#3DC5B7}',
    '#cp .stat.error::before{background:var(--error)}',
    '#cp .stat.warn::before{background:var(--warning)}',
    '#cp .stat.info::before{background:var(--info)}',
    '#cp .stat.success::before{background:var(--success)}',
    '#cp .stat-l{font-size:11px;color:var(--text-2);font-weight:500}',
    '#cp .stat-v{font-size:28px;font-weight:700;color:var(--navy);line-height:1;margin-top:6px}',
    '#cp .stat-meta{font-size:11px;color:var(--text-3);margin-top:4px}',
    // card
    '#cp .card{background:var(--card);border-radius:var(--radius-lg);padding:20px;margin-bottom:16px;border:1px solid var(--border)}',
    '#cp .card.error-card{border-color:var(--error);background:linear-gradient(135deg,#FEF2F2,white)}',
    '#cp .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--border)}',
    '#cp .card-title{font-size:15px;font-weight:600;color:var(--navy);display:flex;align-items:center;gap:10px}',
    '#cp .card-title::before{content:"";width:4px;height:16px;background:var(--teal);border-radius:2px}',
    '#cp .card-title.error::before{background:var(--error)}',
    '#cp .card-meta{font-size:11px;color:var(--text-3)}',
    // table
    '#cp table{width:100%;border-collapse:collapse;font-size:13px}',
    '#cp th{background:var(--bg);color:var(--navy);padding:10px 12px;text-align:left;font-weight:600;font-size:12px}',
    '#cp td{padding:10px 12px;border-bottom:1px solid #F3F4F6}',
    '#cp tr:hover td{background:var(--bg)}',
    '#cp td a{color:var(--teal);text-decoration:none;font-weight:500;cursor:pointer}',
    // badge
    '#cp .badge{display:inline-block;padding:3px 10px;border-radius:var(--radius-xl);font-size:11px;font-weight:600}',
    '#cp .badge-error{background:#FEE2E2;color:#7F1D1D}',
    '#cp .badge-warn{background:#FEF3C7;color:#78350F}',
    '#cp .badge-info{background:#DBEAFE;color:#1E3A8A}',
    '#cp .badge-ok{background:#DCFCE7;color:#14532D}',
    // grid-2
    '#cp .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}',
    '@media (max-width:900px){#cp .grid-2{grid-template-columns:1fr}}',
    // empty
    '#cp .empty{text-align:center;padding:32px 16px;color:var(--text-2);font-size:13px}',
    '#cp .empty-icon{display:flex;width:48px;height:48px;margin:0 auto 12px;background:#DCFCE7;border-radius:50%;align-items:center;justify-content:center;color:var(--success)}',
    '#cp .doc-row .days-badge{font-weight:700;font-size:12px}',
    '#cp .loading{text-align:center;padding:50px;color:var(--text-2);font-size:13px}',
    '@media (max-width:480px){#cp table{font-size:12px}#cp th,#cp td{padding:8px}}',
  ].join('\n');
}

/* ===== markup เดิม (header + stats placeholder + content placeholder) =====
   คง element id เดิม (#stats-row, #content) · ส่วน data render ผ่าน JS หลังโหลด */
function CP_MARKUP() {
  return [
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    '      Compliance Dashboard',
    '    </h1>',
    '    <div class="subtitle">เอกสารหมดอายุ · ปกส · ภาษี · ใบอนุญาต · auto-reminder</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn-help" onclick="cpShowHelp()" title="ช่วยเหลือ" id="cp-help-btn"></button>',
    '    <button class="btn btn-sm" onclick="cpLoad()" id="cp-refresh-btn"></button>',
    '    <span class="page-badge">COMPLIANCE</span>',
    '  </div>',
    '</header>',
    '<div class="container">',
    '  <div class="stats-row" id="cp-stats"></div>',
    '  <div id="cp-content" class="loading">กำลังโหลด...</div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   CP_RUN_PAGE_JS — load + render · helpers inline · expose window cp*
   ============================================================ */
function CP_RUN_PAGE_JS() {
  var _cpRoot = document.getElementById('cp');
  function cpById(id) { return _cpRoot ? _cpRoot.querySelector('#' + id) : document.getElementById(id); }

  // esc — ใช้ global window.esc ถ้ามี ไม่งั้น fallback
  var esc = (typeof window !== 'undefined' && window.esc) ? window.esc : function (s) {
    var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML;
  };

  var ICONS = {
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  };

  function showToast(msg, type) {
    var t = document.getElementById('cp2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cp2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#DC2626' : type === 'success' ? '#16A34A' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.cp2Toast = showToast;

  function thDate(v) {
    if (!v) return '-';
    var d = new Date(String(v).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return String(v);
    try { return d.toLocaleDateString('th-TH'); } catch (e) { return String(v).slice(0, 10); }
  }
  function empLink(d) {
    var nm = esc(d.nickname || '—');
    if (!d.employee_id) return nm;
    return '<a onclick="cpOpenEmp(\'' + esc(String(d.employee_id)).replace(/'/g, '') + '\')">' + nm + '</a>';
  }

  // ===== header labels =====
  cpById('cp-refresh-btn').innerHTML = ICONS.refresh + ' รีเฟรช';
  cpById('cp-help-btn').innerHTML = ICONS.help;

  function emptyState(msg) {
    return '<div class="empty"><div class="empty-icon">' + ICONS.check + '</div><p>' + esc(msg) + '</p></div>';
  }

  function renderStats(s) {
    s = s || {};
    var html = [
      '<div class="stat ' + (s.expired_count > 0 ? 'error' : 'success') + '">' +
        '<div class="stat-l">เอกสารหมดอายุ</div>' +
        '<div class="stat-v" style="color:' + (s.expired_count > 0 ? 'var(--error)' : 'var(--success)') + '">' + (s.expired_count || 0) + '</div>' +
        '<div class="stat-meta">ต้องต่ออายุด่วน</div></div>',
      '<div class="stat warn">' +
        '<div class="stat-l">ใกล้หมดอายุ (30 วัน)</div>' +
        '<div class="stat-v" style="color:var(--warning)">' + (s.expiring30_count || 0) + '</div>' +
        '<div class="stat-meta">ดำเนินการต่ออายุ</div></div>',
      '<div class="stat info">' +
        '<div class="stat-l">ใกล้หมดอายุ (60 วัน)</div>' +
        '<div class="stat-v" style="color:var(--info)">' + (s.expiring60_count || 0) + '</div>' +
        '<div class="stat-meta">เตือนล่วงหน้า</div></div>',
      '<div class="stat ' + (s.missing_count > 0 ? 'warn' : 'success') + '">' +
        '<div class="stat-l">เอกสารค้างส่ง</div>' +
        '<div class="stat-v" style="color:' + (s.missing_count > 0 ? 'var(--warning)' : 'var(--success)') + '">' + (s.missing_count || 0) + '</div>' +
        '<div class="stat-meta">' + (s.total_active || 0) + ' active employees</div></div>',
    ].join('');
    cpById('cp-stats').innerHTML = html;
  }

  function renderExpired(rows) {
    if (!rows || !rows.length) return '';
    var body = rows.map(function (d) {
      return '<tr>' +
        '<td>' + empLink(d) + '</td>' +
        '<td style="color:var(--text-2)">' + esc(d.position_id || '') + '</td>' +
        '<td style="color:var(--text-2)">' + esc(d.branch_id || '') + '</td>' +
        '<td>' + esc(d.doc_type || d.document_name || '') + '</td>' +
        '<td style="color:var(--text-2)">' + thDate(d.expiry_date) + '</td>' +
        '<td style="text-align:right"><span class="badge badge-error days-badge">' + (d.days_overdue || 0) + ' วัน</span></td>' +
      '</tr>';
    }).join('');
    return '<div class="card error-card">' +
      '<div class="card-header"><div class="card-title error">เอกสารหมดอายุแล้ว</div>' +
        '<span class="card-meta" style="color:var(--error);font-weight:600">ต้องดำเนินการทันที</span></div>' +
      '<div style="overflow-x:auto"><table class="doc-row">' +
        '<thead><tr><th>พนักงาน</th><th>ตำแหน่ง</th><th>สาขา</th><th>เอกสาร</th><th>หมดอายุ</th><th style="text-align:right">เกินกำหนด</th></tr></thead>' +
        '<tbody>' + body + '</tbody></table></div></div>';
  }

  function renderExpiringCard(title, rows, badgeCls, emptyMsg) {
    var inner;
    if (rows && rows.length) {
      var body = rows.map(function (d) {
        return '<tr>' +
          '<td>' + empLink(d) + '<div style="font-size:11px;color:var(--text-2)">' + esc(d.position_id || '') + '</div></td>' +
          '<td>' + esc(d.doc_type || d.document_name || '') + '</td>' +
          '<td style="text-align:right"><span class="badge ' + badgeCls + '">' + (d.days_left || 0) + ' วัน</span></td>' +
        '</tr>';
      }).join('');
      inner = '<div style="overflow-x:auto"><table>' +
        '<thead><tr><th>พนักงาน</th><th>เอกสาร</th><th style="text-align:right">เหลือ</th></tr></thead>' +
        '<tbody>' + body + '</tbody></table></div>';
    } else {
      inner = emptyState(emptyMsg);
    }
    return '<div class="card"><div class="card-header"><div class="card-title">' + esc(title) + '</div></div>' + inner + '</div>';
  }

  function renderOverdueFilings(rows) {
    if (!rows || !rows.length) return '';
    var body = rows.map(function (f) {
      return '<tr>' +
        '<td><strong>' + esc(f.filing_type || '') + '</strong><div style="font-size:11px;color:var(--text-2)">' + esc(f.description || '') + '</div></td>' +
        '<td>' + esc(f.period || '-') + '</td>' +
        '<td style="color:var(--error);font-weight:600">' + thDate(f.due_date) + '</td>' +
        '<td><span class="badge badge-error">' + esc(f.status || 'pending') + '</span></td>' +
      '</tr>';
    }).join('');
    return '<div class="card error-card">' +
      '<div class="card-header"><div class="card-title error">Filings เกินกำหนดส่ง</div>' +
        '<span class="card-meta" style="color:var(--error);font-weight:600">รีบส่งเลย</span></div>' +
      '<table><thead><tr><th>ประเภท</th><th>Period</th><th>Due date</th><th>Status</th></tr></thead>' +
        '<tbody>' + body + '</tbody></table></div>';
  }

  function renderUpcomingFilings(rows) {
    var inner;
    if (rows && rows.length) {
      var body = rows.map(function (f) {
        var daysLeft = (f._days != null) ? f._days : 0;
        return '<tr>' +
          '<td><strong>' + esc(f.filing_type || '') + '</strong><div style="font-size:11px;color:var(--text-2)">' + esc(f.description || '') + '</div></td>' +
          '<td>' + esc(f.period || '-') + '</td>' +
          '<td>' + thDate(f.due_date) + '</td>' +
          '<td><span class="badge ' + (daysLeft <= 7 ? 'badge-warn' : 'badge-info') + '">' + daysLeft + ' วัน</span></td>' +
          '<td><span class="badge ' + (f.status === 'in_progress' ? 'badge-warn' : 'badge-info') + '">' + esc(f.status || 'pending') + '</span></td>' +
        '</tr>';
      }).join('');
      inner = '<table><thead><tr><th>ประเภท</th><th>Period</th><th>Due date</th><th>เหลือ</th><th>Status</th></tr></thead>' +
        '<tbody>' + body + '</tbody></table>';
    } else {
      inner = emptyState('ไม่มี filing ใกล้กำหนด');
    }
    return '<div class="card"><div class="card-header"><div class="card-title">Upcoming Filings · 60 วัน</div>' +
      '<span class="card-meta">ปกส. ภาษี ภงด. PF</span></div>' + inner + '</div>';
  }

  function renderMissing(rows) {
    if (!rows || !rows.length) return '';
    var body = rows.map(function (d) {
      return '<tr>' +
        '<td>' + empLink(d) + '</td>' +
        '<td style="color:var(--text-2)">' + esc(d.position_id || '') + '</td>' +
        '<td style="color:var(--text-2)">' + esc(d.branch_id || '') + '</td>' +
        '<td>' + esc(d.doc_type || d.document_name || '') + '</td>' +
        '<td><span class="badge badge-warn">' + esc(d.status || 'pending') + '</span></td>' +
      '</tr>';
    }).join('');
    return '<div class="card"><div class="card-header"><div class="card-title">เอกสารค้างส่ง</div>' +
      '<span class="card-meta">ต้องเก็บจากพนักงาน</span></div>' +
      '<table><thead><tr><th>พนักงาน</th><th>ตำแหน่ง</th><th>สาขา</th><th>เอกสาร</th><th>Status</th></tr></thead>' +
        '<tbody>' + body + '</tbody></table></div>';
  }

  function renderAll(res) {
    res = res || {};
    renderStats(res.summary || {});
    var html = '';
    html += renderExpired(res.expired);
    html += '<div class="grid-2">' +
      renderExpiringCard('ใกล้หมดอายุ (30 วัน)', res.expiring30, 'badge-warn', 'ไม่มีเอกสารใกล้หมดอายุ 30 วัน') +
      renderExpiringCard('ใกล้หมดอายุ (60 วัน)', res.expiring60, 'badge-info', 'ไม่มีเอกสารใกล้หมดอายุ 60 วัน') +
      '</div>';
    html += renderOverdueFilings(res.overdueFilings);
    html += renderUpcomingFilings(res.upcomingFilings);
    html += renderMissing(res.missing);
    cpById('cp-content').innerHTML = html;
  }

  // google.script.run shim → CP_BACKEND
  function _cp2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (CP_BACKEND[prop]) {
            Promise.resolve().then(function () { return CP_BACKEND[prop].apply(CP_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[CP_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[CP_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _cp2MakeChain(); } });

  function cpLoad() {
    cpById('cp-content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(function (res) {
        if (!res || res.error) {
          cpById('cp-content').innerHTML = '<div class="empty">ผิดพลาด: ' + esc((res && res.error) || 'unknown') + '</div>';
          return;
        }
        renderAll(res);
      })
      .withFailureHandler(function (err) {
        cpById('cp-content').innerHTML = '<div class="empty">โหลดล้มเหลว: ' + esc((err && err.message) || err) + '</div>';
      })
      .complianceGetData();
  }

  function cpOpenEmp(id) {
    if (!id) return;
    if (typeof window.openEmployee360 === 'function') { window.openEmployee360(id); return; }
    if (typeof window.navigateTo === 'function') { window.navigateTo('employee360', { id: id }); return; }
    showToast('เปิด employee 360 (id ' + id + ') — ยังไม่เชื่อมบนหน้านี้', 'error');
  }

  function cpShowHelp() {
    var bg = document.getElementById('cp-help-modal-bg');
    if (!bg) {
      bg = document.createElement('div'); bg.id = 'cp-help-modal-bg';
      bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none';
      bg.onclick = function (e) { if (e.target === bg) bg.style.display = 'none'; };
      document.body.appendChild(bg);
    }
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh">' +
      '<div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0;display:flex;align-items:center;justify-content:space-between">' +
        '<div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">Compliance Dashboard</h2>' +
        '<p style="font-size:12px;color:#64748B;margin-top:4px">เอกสารหมดอายุ · ปกส · ภาษี · ใบอนุญาต</p></div>' +
        '<button onclick="document.getElementById(\'cp-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div>' +
      '<div style="padding:20px 24px;overflow-y:auto;font-size:13px;line-height:1.7;color:#334155">' +
        '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;margin-bottom:14px">รวมเอกสารที่ต้องต่ออายุ (ใบอนุญาต · ประกัน · อบรม) + filings ราชการ (ปกส./ภาษี/ภงด./PF) ไว้ที่เดียว · auto-reminder ทำงานฝั่ง backend</div>' +
        '<ul style="margin-left:18px">' +
          '<li><strong>เอกสารหมดอายุ</strong> — เกินวันหมดอายุแล้ว · ต้องต่อด่วน</li>' +
          '<li><strong>ใกล้หมดอายุ 30/60 วัน</strong> — เตือนล่วงหน้า</li>' +
          '<li><strong>เอกสารค้างส่ง</strong> — ยังไม่มีในระบบ · ต้องเก็บจากพนักงาน</li>' +
          '<li><strong>Filings</strong> — สปส./ภาษี/ภงด./PF · เกินกำหนด + ใกล้กำหนด 60 วัน</li>' +
        '</ul>' +
        '<div style="margin-top:14px;padding:12px 14px;background:#FFFBEB;color:#B45309;border-radius:6px">หมายเหตุ: หน้านี้บน dashboard เป็น read-only · ข้อมูลจาก Supabase (license/insurance/training/compliance)</div>' +
      '</div>' +
      '<div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end">' +
        '<button class="btn" style="background:#3DC5B7;color:#fff;border-color:#3DC5B7" onclick="document.getElementById(\'cp-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  // expose fn ที่ inline onclick/markup ต้องเรียก → window (prefix cp* กันชน)
  window.cpLoad = cpLoad;
  window.cpOpenEmp = cpOpenEmp;
  window.cpShowHelp = cpShowHelp;

  // init
  cpLoad();
}

if (typeof window !== 'undefined') window.mountCompliance = mountCompliance;
