// _ported/incident.js — FULL native port of desktop incident_manager.html (HR Announcement admin)
// ลอกทั้งดุ้น (gold template = _ported/announce.js):
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix ทุก selector ด้วย #ic
//   markup เดิม คง element id เดิม (stN/stCR/stSSO/stTot · tabs · tableWrap · modalBg/mt/mb)
//   JS หน้าเดิม รันใน closure scope ของ mountIncident() · google.script.run = shim → IC_BACKEND (Supabase)
//
// ใช้ global sb (supabase client) + esc (html escape) จาก index.html module scope — ห้าม redeclare
// fn/var ที่ inline onclick ต้องใช้ → ผูกกับ window ภายใน IC_RUN_PAGE_JS
//
// backend (edge fn hr_incident / hr_approve) — ตามกฎ:
//   list  → sb.functions.invoke('hr_incident')                                  → { items:[...] }
//           (หน้าเดิมคาด { ok, rows, counts } → shim filter+count ฝั่ง client คืน shape เดิม)
//   whoami→ { ok:true } เต็มสิทธิ์
//   ปิดเคส/อัปเดตสถานะ resolved|closed → sb.functions.invoke('hr_approve',{body:{request_id:incident_id,decision:'approved'}})
//   create→ sb.functions.invoke('hr_incident',{body:{...}})
//   root cause / preventive / SSO / per-field update อื่น ๆ ที่ backend ทำไม่ได้ → stub + toast (คืน ok ให้ modal ปิดได้)

/* ============================================================
   IC_BACKEND — map google.script.run → Supabase (hr_incident / hr_approve)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (incidentAdminList → {ok,rows,counts})
   ============================================================ */
// normalize row จาก backend → shape ที่ JS เดิมใช้ (incident_type/description/...)
function ic2MapRow(p) {
  p = p || {};
  return {
    incident_id: p.incident_id || '',
    reporter_id: p.reporter_id || '',
    reporter_name: p.reporter_name || p.reported_by || p.reporter_id || '',
    incident_type: p.incident_type || p.category || '',
    severity: String(p.severity || '').toLowerCase(),
    incident_date: p.incident_date || '',
    incident_location: p.incident_location || '',
    branch_id: p.branch_id || '',
    branch_name: p.branch_name || p.branch_id || '',
    description: (p.description != null ? p.description : (p.detail || '')) || '',
    immediate_action: p.immediate_action || '',
    root_cause: p.root_cause || '',
    preventive_action: p.preventive_action || '',
    medical_attention: ic2Bool(p.medical_attention),
    sso_claim_filed: ic2Bool(p.sso_claim_filed),
    sso_claim_id: p.sso_claim_id || '',
    attachment_urls: p.attachment_urls || '',
    status: String(p.status || 'new').toLowerCase(),
    hr_review_status: p.hr_review_status || 'pending',
    owner_notified: ic2Bool(p.owner_notified),
    created_at: p.created_at || p.incident_date || '',
    resolved_at: p.resolved_at || '',
  };
}
function ic2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
// counts จาก enriched rows ทั้งหมด (mirror IncidentAdmin.list ของเดิม)
function ic2Counts(rows) {
  return {
    'new': rows.filter(function (i) { return i.status === 'new'; }).length,
    investigating: rows.filter(function (i) { return i.status === 'investigating'; }).length,
    critical: rows.filter(function (i) { return i.severity === 'critical'; }).length,
    sso_pending: rows.filter(function (i) { return i.medical_attention && !i.sso_claim_filed; }).length,
    resolved: rows.filter(function (i) { return i.status === 'resolved' || i.status === 'closed'; }).length,
    all: rows.length,
  };
}
// filter + sort ตาม tab (mirror ของเดิม)
function ic2FilterSort(rows, tab) {
  var filtered = rows;
  if (tab === 'new') filtered = rows.filter(function (i) { return i.status === 'new'; });
  else if (tab === 'investigating') filtered = rows.filter(function (i) { return i.status === 'investigating'; });
  else if (tab === 'critical') filtered = rows.filter(function (i) { return i.severity === 'critical'; });
  else if (tab === 'sso') filtered = rows.filter(function (i) { return i.medical_attention && !i.sso_claim_filed; });
  else if (tab === 'resolved') filtered = rows.filter(function (i) { return i.status === 'resolved' || i.status === 'closed'; });
  // sort: new ก่อน · severity · recent
  var sevRank = function (s) { return ({ critical: 0, severe: 1, moderate: 2, minor: 3 })[s] != null ? ({ critical: 0, severe: 1, moderate: 2, minor: 3 })[s] : 4; };
  return filtered.slice().sort(function (a, b) {
    if (a.status === 'new' && b.status !== 'new') return -1;
    if (b.status === 'new' && a.status !== 'new') return 1;
    var d = sevRank(a.severity) - sevRank(b.severity);
    if (d !== 0) return d;
    return String(b.created_at).localeCompare(String(a.created_at));
  });
}

var IC_BACKEND = {
  // role gate — dashboard user = hr_officer/owner เต็มสิทธิ์
  incidentAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },
  // list — { ok, rows, counts } (filter+count ฝั่ง client จาก hr_incident {items})
  incidentAdminList: function (opts) {
    opts = opts || {};
    return sb.functions.invoke('hr_incident').then(function (res) {
      var data = (res && res.data) || {};
      var all = (data.items || data.rows || []).map(ic2MapRow).filter(function (i) { return i.incident_id; });
      var counts = ic2Counts(all);
      var rows = ic2FilterSort(all, opts.tab || 'new');
      if (opts.search) {
        var q = String(opts.search).toLowerCase();
        rows = rows.filter(function (i) {
          return (i.reporter_name || '').toLowerCase().indexOf(q) >= 0
            || (i.description || '').toLowerCase().indexOf(q) >= 0
            || (i.incident_location || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      return { ok: true, rows: rows, counts: counts };
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || 'โหลดล้มเหลว' };
    });
  },
  // today summary — mirror ของเดิม (client-side)
  incidentAdminTodaySummary: function () {
    return sb.functions.invoke('hr_incident').then(function (res) {
      var data = (res && res.data) || {};
      var all = (data.items || data.rows || []).map(ic2MapRow).filter(function (i) { return i.incident_id; });
      return {
        ok: true,
        'new': all.filter(function (i) { return i.status === 'new'; }).length,
        critical_open: all.filter(function (i) { return i.severity === 'critical' && i.status !== 'closed' && i.status !== 'resolved'; }).length,
        sso_pending: all.filter(function (i) { return i.medical_attention && !i.sso_claim_filed; }).length,
      };
    }).catch(function () { return { ok: false }; });
  },
  // update — backend มีแค่ "ปิดเคส" ผ่าน hr_approve (decision='approved')
  //   status resolved|closed → hr_approve · field อื่น (root_cause/preventive/SSO) → stub+toast แต่คืน ok
  incidentAdminUpdate: function (incidentId, fields) {
    fields = fields || {};
    var willClose = (fields.status === 'resolved' || fields.status === 'closed');
    // มี field ที่ backend อัปเดตไม่ได้ → แจ้ง stub (ไม่บล็อกการปิดเคส)
    var stubFields = ['root_cause', 'preventive_action', 'sso_claim_filed', 'sso_claim_id'];
    var hasStub = stubFields.some(function (k) { return fields[k] != null && fields[k] !== '' && fields[k] !== false; });
    if (hasStub) ic2NotReady('บันทึก root cause / preventive / กท.16');

    if (willClose) {
      return sb.functions.invoke('hr_approve', {
        body: { request_id: incidentId, decision: 'approved' }
      }).then(function (resp) {
        var data = resp && resp.data, error = resp && resp.error;
        if (error || (data && data.error)) {
          return { ok: false, error: (data && data.error) || (error && error.message) || 'ปิดเคสไม่สำเร็จ' };
        }
        return { ok: true };
      }).catch(function (e) {
        return { ok: false, error: (e && e.message) || 'ปิดเคสไม่สำเร็จ' };
      });
    }
    // ไม่ได้ปิดเคส + แก้แต่ field ที่ backend ทำไม่ได้ → คืน ok ให้ modal ปิดได้ (toast แจ้งแล้ว)
    if (!hasStub) ic2NotReady('อัปเดตสถานะ (ที่ไม่ใช่ปิดเคส)');
    return Promise.resolve({ ok: true });
  },
  // create — sb.functions.invoke('hr_incident',{body:{...}})
  incidentAdminCreate: function (payload) {
    var body = Object.assign({ action: 'create' }, payload || {});
    return sb.functions.invoke('hr_incident', { body: body }).then(function (res) {
      var data = (res && res.data) || {};
      if (data.error) return { ok: false, error: data.error };
      return { ok: true, incident_id: data.incident_id || data.id || '' };
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || 'สร้างไม่สำเร็จ' };
    });
  },
};

var _ic2NotReadyShown = {};
function ic2NotReady(feature) {
  if (_ic2NotReadyShown[feature]) return;
  _ic2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ic2Toast) window.ic2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountIncident — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountIncident() {
  var wrap = document.getElementById('wrap-incident');
  if (!wrap) return;

  wrap.innerHTML = '<style>' + IC_CSS() + '</style><div id="ic">' + IC_MARKUP() + '</div>';

  // รัน JS ของหน้าเดิม (closure · google = shim) → ผูก fn ที่ inline onclick ต้องใช้ ลง window
  IC_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles tokens + <style> incident_manager) · prefix ทุก selector ด้วย #ic =====
   ตัด .topbar/.app-shell/.main-area/.page-head shell + body rules (dashboard มี shell แล้ว) · คง class เดิม */
function IC_CSS() {
  return [
    // tokens (จาก :root หน้า manager)
    '#ic{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--teal-dark:#0F766E;--bg:#F8F9FA;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--warn:#F59E0B;--success:#16A34A;color:var(--navy);font-size:14px;line-height:1.5}',
    '#ic *,#ic *::before,#ic *::after{box-sizing:border-box}',

    // top banner
    '#ic .top{background:var(--navy);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;border-radius:10px 10px 0 0}',
    '#ic .top-t{font-size:16px;font-weight:600}',
    '#ic .top-b{background:#DC2626;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600}',

    // stats
    '#ic .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 20px;background:var(--bg)}',
    '#ic .st{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;border-left-width:3px}',
    '#ic .st.n{border-left-color:var(--warn)}',
    '#ic .st.cr{border-left-color:#991B1B}',
    '#ic .st.sso{border-left-color:var(--error)}',
    '#ic .st.tot{border-left-color:var(--navy)}',
    '#ic .st-n{font-size:24px;font-weight:600}',
    '#ic .st-l{font-size:11px;color:var(--muted);margin-top:3px}',
    '@media (max-width:768px){#ic .stats{grid-template-columns:repeat(2,1fr)}}',

    // tabs
    '#ic .tabs{display:flex;gap:2px;padding:0 20px;border-bottom:1px solid var(--border);background:#fff;overflow-x:auto}',
    '#ic .tab{padding:11px 16px;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;font-weight:500;white-space:nowrap}',
    '#ic .tab.act{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    '#ic .tab-c{background:var(--bg);padding:1px 7px;border-radius:99px;font-size:10px;margin-left:4px}',

    // body / table
    '#ic .body{padding:14px 20px}',
    '#ic table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)}',
    '#ic th{background:var(--navy);color:#fff;padding:11px 12px;font-size:11px;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:.3px}',
    '#ic td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border);vertical-align:middle}',
    '#ic tr:hover td{background:var(--teal-light)}',

    // pills
    '#ic .pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600}',
    '#ic .pill.minor{background:#DBEAFE;color:#1E40AF}',
    '#ic .pill.moderate{background:#FEF3C7;color:#B45309}',
    '#ic .pill.severe{background:#FEE2E2;color:#991B1B}',
    '#ic .pill.critical{background:#7F1D1D;color:#fff}',
    '#ic .pill.new{background:#FEF3C7;color:#B45309}',
    '#ic .pill.investigating{background:#DBEAFE;color:#1E40AF}',
    '#ic .pill.resolved{background:#D1FAE5;color:#047857}',
    '#ic .pill.closed{background:#F3F4F6;color:#4B5563}',

    // row button
    '#ic .rb{padding:5px 10px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:#fff;color:var(--navy);font-family:inherit}',
    '#ic .rb.p{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#ic .empty{padding:60px 20px;text-align:center;color:var(--muted)}',

    // modal (scope ใต้ #ic · fixed · z-index สูง)
    '#ic .modal-bg{display:none;position:fixed;inset:0;background:rgba(13,47,79,.6);z-index:9000;align-items:center;justify-content:center;padding:20px}',
    '#ic .modal-bg.open{display:flex}',
    '#ic .modal{background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto}',
    '#ic .modal-h{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
    '#ic .modal-x{background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer;line-height:1}',
    '#ic .modal-b{padding:16px 20px}',
    '#ic .field{margin-bottom:11px}',
    '#ic .field-l{display:block;font-size:11px;font-weight:600;margin-bottom:5px}',
    '#ic .field-i{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit}',
  ].join('\n');
}

/* ===== markup เดิม ครบ · คง element id เดิม (stN/stCR/stSSO/stTot · tabs · tableWrap · modalBg/mt/mb) =====
   ตัด app-shell/sidebar/sheet_link/page-head/brand_footer (dashboard มี shell แล้ว) */
function IC_MARKUP() {
  return [
    '<div class="top">',
    '  <div class="top-t">Incident Manager</div>',
    '  <div class="top-b">INC</div>',
    '</div>',
    '<div class="stats">',
    '  <div class="st n"><div><div class="st-n" id="stN">–</div><div class="st-l">รอจัดการ</div></div></div>',
    '  <div class="st cr"><div><div class="st-n" id="stCR">–</div><div class="st-l">Critical เปิดอยู่</div></div></div>',
    '  <div class="st sso"><div><div class="st-n" id="stSSO">–</div><div class="st-l">กท.16 ยังไม่ยื่น</div></div></div>',
    '  <div class="st tot"><div><div class="st-n" id="stTot">–</div><div class="st-l">ทั้งหมด</div></div></div>',
    '</div>',
    '<div class="tabs" id="tabs"></div>',
    '<div class="body" id="tableWrap"><div class="empty">กำลังโหลด...</div></div>',
    '<div class="modal-bg" id="modalBg">',
    '  <div class="modal">',
    '    <div class="modal-h"><div style="font-size:15px;font-weight:600" id="mt">รายละเอียด</div><button class="modal-x" id="modalX">×</button></div>',
    '    <div class="modal-b" id="mb"></div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   IC_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → IC_BACKEND
   helper esc/showToast inline เข้ามา · fn ที่ inline onclick ต้องใช้ → ผูก window ตอนท้าย
   ============================================================ */
function IC_RUN_PAGE_JS() {

  // ---- google.script.run shim → IC_BACKEND (async · คืน shape เดิม) ----
  function _ic2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (IC_BACKEND[prop]) {
            Promise.resolve().then(function () { return IC_BACKEND[prop].apply(IC_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[IC_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[IC_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ic2MakeChain(); } });

  // ---- helpers (inline · esc มี global แล้วแต่ใช้ local ในหน้าเดิม) ----
  function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function showToast(msg, type) {
    var t = document.getElementById('ic2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ic2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#DC2626' : type === 'success' ? '#16A34A' : '#0D2F4F';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ic2Toast = showToast;

  // scope helper: query เฉพาะใต้ #ic (id เดิมไม่ชนกับ dashboard เพราะ markup เดิมมี id stN/tabs/...)
  var ROOT = document.getElementById('ic');
  function $id(id) { return ROOT ? ROOT.querySelector('#' + id) : document.getElementById(id); }

  /* ====================== JS หน้าเดิม (incident_manager) — ลอกทั้งดุ้น ====================== */
  var _state = { tab: 'new', rows: [], counts: {} };

  function init() { reload(); }

  function reload() {
    $id('tableWrap').innerHTML = '<div class="empty">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(onLoaded).withFailureHandler(function (e) {
      $id('tableWrap').innerHTML = '<div class="empty">โหลดล้มเหลว</div>';
    }).incidentAdminList({ tab: _state.tab });
  }

  function onLoaded(res) {
    if (!res || !res.ok) return;
    _state.rows = res.rows || [];
    _state.counts = res.counts || {};
    $id('stN').textContent = _state.counts['new'] || 0;
    $id('stCR').textContent = _state.counts.critical || 0;
    $id('stSSO').textContent = _state.counts.sso_pending || 0;
    $id('stTot').textContent = _state.counts.all || 0;
    // sidebar badge = เคสที่ยังเปิดอยู่ (รอจัดการ + กำลังจัดการ)
    var ct = document.getElementById('ct-incident');
    if (ct) { var open = (_state.counts['new'] || 0) + (_state.counts.investigating || 0); ct.textContent = open || ''; }
    renderTabs(); renderTable();
  }

  function renderTabs() {
    var c = _state.counts;
    var tabs = [
      { k: 'new', l: 'รอจัดการ', n: c['new'] || 0 },
      { k: 'investigating', l: 'กำลังจัดการ', n: c.investigating || 0 },
      { k: 'critical', l: 'Critical', n: c.critical || 0 },
      { k: 'sso', l: 'กท.16 ค้าง', n: c.sso_pending || 0 },
      { k: 'resolved', l: 'ปิดแล้ว', n: c.resolved || 0 },
      { k: 'all', l: 'ทั้งหมด', n: c.all || 0 },
    ];
    $id('tabs').innerHTML = tabs.map(function (t) {
      return '<div class="tab ' + (_state.tab === t.k ? 'act' : '') + '" data-tab="' + esc(t.k) + '">' + esc(t.l) + '<span class="tab-c">' + t.n + '</span></div>';
    }).join('');
    Array.prototype.forEach.call($id('tabs').querySelectorAll('.tab'), function (el) {
      el.onclick = function () { setTab(el.getAttribute('data-tab')); };
    });
  }
  function setTab(k) { _state.tab = k; reload(); }

  function renderTable() {
    if (!_state.rows.length) { $id('tableWrap').innerHTML = '<div class="empty">ไม่มีรายการ</div>'; return; }
    var checkSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg>';
    var html = '<div style="overflow-x:auto"><table><thead><tr>'
      + '<th>ID</th><th>ประเภท / severity</th><th>ผู้แจ้ง</th><th>สาขา · สถานที่</th><th>วันที่</th><th>Status</th><th>กท.16</th><th>Actions</th>'
      + '</tr></thead><tbody>';
    html += _state.rows.map(function (r) {
      var sso = r.medical_attention
        ? (r.sso_claim_filed
          ? '<span style="color:#16A34A;display:inline-flex;align-items:center;gap:4px">' + checkSvg + 'ยื่นแล้ว</span>'
          : '<span style="color:#DC2626">รอยื่น</span>')
        : '—';
      return '<tr>'
        + '<td>' + esc(r.incident_id) + '</td>'
        + '<td>' + typeLabel(r.incident_type) + '<div><span class="pill ' + esc(r.severity) + '">' + sevLabel(r.severity) + '</span></div></td>'
        + '<td>' + esc(r.reporter_name) + '</td>'
        + '<td>' + esc(r.branch_name || r.branch_id) + '<div style="font-size:10px;color:var(--muted)">' + esc(r.incident_location) + '</div></td>'
        + '<td>' + esc(r.incident_date) + '</td>'
        + '<td><span class="pill ' + esc(r.status) + '">' + statusLabel(r.status) + '</span></td>'
        + '<td>' + sso + '</td>'
        + '<td><button class="rb p" data-view="' + esc(r.incident_id) + '">เปิด</button></td>'
        + '</tr>';
    }).join('');
    html += '</tbody></table></div>';
    $id('tableWrap').innerHTML = html;
    Array.prototype.forEach.call($id('tableWrap').querySelectorAll('[data-view]'), function (btn) {
      btn.onclick = function () { viewIncident(btn.getAttribute('data-view')); };
    });
  }

  function typeLabel(t) { return ({ injury: 'บาดเจ็บ', near_miss: 'เกือบเกิดเหตุ', equipment_damage: 'อุปกรณ์เสียหาย', security: 'security', patient_safety: 'patient safety', other: 'อื่น ๆ' })[t] || esc(t); }
  function sevLabel(s) { return ({ minor: 'เล็กน้อย', moderate: 'ปานกลาง', severe: 'รุนแรง', critical: 'วิกฤต' })[s] || esc(s); }
  function statusLabel(s) { return ({ 'new': 'รอจัดการ', investigating: 'กำลังจัดการ', resolved: 'แก้แล้ว', closed: 'ปิด' })[s] || esc(s); }

  function viewIncident(id) {
    var r = _state.rows.find(function (x) { return String(x.incident_id) === String(id); });
    if (!r) return;
    $id('mt').textContent = r.incident_id + ' · ' + (typeLabel(r.incident_type).replace(/<[^>]*>/g, ''));
    var attachRow = r.attachment_urls
      ? '<tr><td style="color:var(--muted);padding:5px 0">หลักฐาน</td><td>' + r.attachment_urls.split('|').map(function (u) { return '<a href="' + esc(u.trim()) + '" target="_blank">' + esc(u.split('/').pop().slice(0, 20)) + '</a>'; }).join(' · ') + '</td></tr>'
      : '';
    $id('mb').innerHTML =
      '<table style="width:100%;font-size:12px;margin-bottom:14px">'
      + '<tr><td style="color:var(--muted);padding:5px 0;width:130px">ประเภท</td><td>' + typeLabel(r.incident_type) + ' · <span class="pill ' + esc(r.severity) + '">' + sevLabel(r.severity) + '</span></td></tr>'
      + '<tr><td style="color:var(--muted);padding:5px 0">ผู้แจ้ง</td><td>' + esc(r.reporter_name) + '</td></tr>'
      + '<tr><td style="color:var(--muted);padding:5px 0">วันที่ · สถานที่</td><td>' + esc(r.incident_date) + ' · ' + esc(r.incident_location) + '</td></tr>'
      + '<tr><td style="color:var(--muted);padding:5px 0">สาขา</td><td>' + esc(r.branch_name || r.branch_id) + '</td></tr>'
      + '<tr><td style="color:var(--muted);padding:5px 0;vertical-align:top">รายละเอียด</td><td style="white-space:pre-wrap">' + esc(r.description) + '</td></tr>'
      + '<tr><td style="color:var(--muted);padding:5px 0;vertical-align:top">การแก้ทันที</td><td style="white-space:pre-wrap">' + esc(r.immediate_action || '-') + '</td></tr>'
      + '<tr><td style="color:var(--muted);padding:5px 0">รักษา</td><td>' + (r.medical_attention ? 'ใช่ · ' + (esc(r.medical_provider) || '-') : 'ไม่') + '</td></tr>'
      + attachRow
      + '</table>'
      + '<div class="field"><label class="field-l">Root cause</label><textarea class="field-i" id="fRC" rows="2">' + esc(r.root_cause || '') + '</textarea></div>'
      + '<div class="field"><label class="field-l">Preventive action</label><textarea class="field-i" id="fPA" rows="2">' + esc(r.preventive_action || '') + '</textarea></div>'
      + '<div class="field"><label class="field-l">Status</label><select class="field-i" id="fStatus">'
      + ['new', 'investigating', 'resolved', 'closed'].map(function (s) { return '<option value="' + s + '" ' + (r.status === s ? 'selected' : '') + '>' + statusLabel(s) + '</option>'; }).join('')
      + '</select></div>'
      + (r.medical_attention
        ? '<div class="field"><label class="field-l"><input type="checkbox" id="fSSO" ' + (r.sso_claim_filed ? 'checked' : '') + '> ยื่น กท.16 แล้ว</label>'
          + (r.sso_claim_filed ? '' : '<input class="field-i" id="fSSOID" placeholder="SSO claim ID" value="' + esc(r.sso_claim_id || '') + '" style="margin-top:6px">')
          + '</div>'
        : '')
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button class="rb" id="icBtnCancel">ยกเลิก</button>'
      + '<button class="rb p" id="icBtnSave">บันทึก</button></div>';

    $id('icBtnCancel').onclick = closeModal;
    $id('icBtnSave').onclick = function () { saveUpdate(r.incident_id); };
    $id('modalBg').classList.add('open');
  }

  function saveUpdate(id) {
    var fields = {
      root_cause: $id('fRC').value,
      preventive_action: $id('fPA').value,
      status: $id('fStatus').value,
    };
    var ssoEl = $id('fSSO');
    if (ssoEl) {
      fields.sso_claim_filed = ssoEl.checked;
      var ssoIdEl = $id('fSSOID');
      if (ssoIdEl) fields.sso_claim_id = ssoIdEl.value;
    }
    google.script.run.withSuccessHandler(function (r) {
      if (r && r.ok) { closeModal(); reload(); }
      else { showToast('บันทึกไม่สำเร็จ · ' + (r && r.error || ''), 'error'); }
    }).withFailureHandler(function (e) {
      showToast('บันทึกไม่สำเร็จ · ' + ((e && e.message) || ''), 'error');
    }).incidentAdminUpdate(id, fields);
  }

  function closeModal() { $id('modalBg').classList.remove('open'); }

  // ---- wire modal close (x + backdrop) ----
  var mx = $id('modalX'); if (mx) mx.onclick = closeModal;
  var mbg = $id('modalBg');
  if (mbg) mbg.onclick = function (e) { if (e.target === mbg) closeModal(); };

  // ---- expose fn ที่อาจถูกเรียกจาก inline / external ----
  window.icReload = reload;

  // ---- start ----
  init();
}
