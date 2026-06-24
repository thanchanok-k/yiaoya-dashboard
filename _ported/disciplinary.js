// _ported/disciplinary.js — FULL native port of desktop disciplinary_manager.html (HR วินัย admin)
// ⚠️ ข้อมูลละเอียดอ่อน (sensitive) — แสดงเฉพาะ field ที่มีใน payload จริงเท่านั้น
//   ห้ามเดา / ห้ามเติมข้อความ พรบ. / กฎหมายเอง · ว่าง = empty ok
//
//   CSS เดิม (<style> หน้า manager) prefix #ds ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน closure scope ของ mountDisciplinary() · google.script.run = shim → DS_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
// fn/var ที่ inline onclick ต้องใช้ → ผูกกับ window ภายใน DS_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=disciplinary.updated → { items:[...] }):
//   list → map → shape { ok, rows, counts, authorized_positions }
//   whoami → { ok:true, is_owner:true }
//   create/update/approve/void/issue → stub + toast "ยังไม่พร้อม" (ไม่มี write-back endpoint)

/* ============================================================
   DS_BACKEND — map google.script.run → Supabase edge fn hr_list (type=disciplinary.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (อ่านจาก onLoaded/renderTable/viewDetail)
   ⚠️ map เฉพาะ field ที่มีใน payload — ไม่มี = ว่าง (JS เดิม guard ด้วย optional render อยู่แล้ว)
   ============================================================ */
var DS_FN = 'hr_list';
var DS_TYPE = 'disciplinary.updated';

function ds2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(function (x) { return x != null; });
  return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
function ds2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function ds2Str(v) { return (v == null) ? '' : String(v); }

// map payload ดิบ → row shape ที่ JS เดิมใช้ — ⚠️ ใส่เฉพาะที่มาจริง ที่เหลือปล่อยว่าง
function ds2MapRow(p) {
  p = p || {};
  var record_type = ds2Str(p.record_type || p.type || '').toLowerCase();
  if (record_type !== 'commendation') record_type = record_type === 'warning' ? 'warning' : (record_type || 'warning');
  return {
    record_id: ds2Str(p.record_id || p.disciplinary_id || p.entity_id || p.id || ''),
    record_type: record_type,
    level: ds2Str(p.level || '').toLowerCase(),
    level_label: ds2Str(p.level_label || p.level || ''),
    category: ds2Str(p.category || ''),
    category_label: ds2Str(p.category_label || p.category || ''),
    employee_id: ds2Str(p.employee_id || ''),
    employee_name: ds2Str(p.employee_name || p.employee || ''),
    employee_position: ds2Str(p.employee_position || p.position || ''),
    issuer_name: ds2Str(p.issuer_name || p.issued_by || p.issuer || ''),
    issued_at: ds2Str(p.issued_at || p.issue_date || ''),
    incident_date: ds2Str(p.incident_date || ''),
    expires_at: ds2Str(p.expires_at || ''),
    doc_num: ds2Str(p.doc_num || ''),
    subject: ds2Str(p.subject || ''),
    description: ds2Str(p.description || ''),
    consequence_text: ds2Str(p.consequence_text || ''),
    benefit_text: ds2Str(p.benefit_text || ''),
    attachment_url: ds2Str(p.attachment_url || ''),
    ack_status: ds2Str(p.ack_status || 'pending').toLowerCase(),
    ack_at: ds2Str(p.ack_at || ''),
    dispute_reason: ds2Str(p.dispute_reason || ''),
    review_status: ds2Str(p.review_status || 'pending_review').toLowerCase(),
    void_reason: ds2Str(p.void_reason || ''),
    pip_triggered: ds2Bool(p.pip_triggered),
  };
}

// นับยอดตามแท็บ (client-side จาก rows ทั้งหมด)
function ds2Counts(all) {
  var c = {
    pending_review: 0, warnings: 0, commendations: 0,
    disputed: 0, voided: 0, all: all.length,
  };
  all.forEach(function (r) {
    if (r.review_status === 'pending_review') c.pending_review++;
    if (r.review_status === 'voided') { c.voided++; return; }
    if (r.record_type === 'warning') c.warnings++;
    if (r.record_type === 'commendation') c.commendations++;
    if (r.ack_status === 'disputed') c.disputed++;
  });
  return c;
}

// filter ตามแท็บ
function ds2FilterTab(all, tab) {
  switch (tab) {
    case 'pending_review': return all.filter(function (r) { return r.review_status === 'pending_review'; });
    case 'warnings': return all.filter(function (r) { return r.record_type === 'warning' && r.review_status !== 'voided'; });
    case 'commendations': return all.filter(function (r) { return r.record_type === 'commendation' && r.review_status !== 'voided'; });
    case 'disputed': return all.filter(function (r) { return r.ack_status === 'disputed'; });
    case 'voided': return all.filter(function (r) { return r.review_status === 'voided'; });
    default: return all;
  }
}

var DS_BACKEND = {
  // role gate — dashboard user = hr/owner เต็มสิทธิ์
  disciplinaryAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },
  // list — { ok, rows, counts, authorized_positions } (filter+count ฝั่ง client จาก hr_list {items})
  disciplinaryAdminList: function (opts) {
    opts = opts || {};
    return sb.functions.invoke(DS_FN + '?type=' + encodeURIComponent(DS_TYPE)).then(function (res) {
      var data = (res && res.data) || {};
      var all = ds2ToArr(data.items || data.rows).map(ds2MapRow).filter(function (r) { return r.record_id; });
      var counts = ds2Counts(all);
      var rows = ds2FilterTab(all, opts.tab || 'pending_review');
      if (opts.search) {
        var q = String(opts.search).toLowerCase();
        rows = rows.filter(function (r) {
          return (r.employee_name || '').toLowerCase().indexOf(q) >= 0
            || (r.issuer_name || '').toLowerCase().indexOf(q) >= 0
            || (r.category_label || '').toLowerCase().indexOf(q) >= 0
            || (r.description || '').toLowerCase().indexOf(q) >= 0;
        });
      }
      // authorized_positions — backend ไม่มี → ว่าง (auth banner ซ่อน · ไม่ error)
      return { ok: true, rows: rows, counts: counts, authorized_positions: [] };
    }).catch(function (e) {
      return { ok: false, error: (e && e.message) || 'โหลดล้มเหลว' };
    });
  },
  // today summary — client-side จากข้อมูลเดียวกัน
  disciplinaryAdminTodaySummary: function () {
    return sb.functions.invoke(DS_FN + '?type=' + encodeURIComponent(DS_TYPE)).then(function (res) {
      var data = (res && res.data) || {};
      var all = ds2ToArr(data.items || data.rows).map(ds2MapRow).filter(function (r) { return r.record_id; });
      return {
        ok: true,
        pending_review: all.filter(function (r) { return r.review_status === 'pending_review'; }).length,
        disputed: all.filter(function (r) { return r.ack_status === 'disputed'; }).length,
        pip_triggered_unhandled: all.filter(function (r) { return r.pip_triggered && r.review_status === 'pending_review'; }).length,
      };
    }).catch(function () { return { ok: false }; });
  },
  // approve — backend ไม่มี write-back → stub + toast
  disciplinaryAdminApprove: function () {
    ds2NotReady('อนุมัติใบวินัย');
    return Promise.resolve({ ok: false, error: 'การอนุมัติยังไม่พร้อมบน dashboard' });
  },
  // void — stub
  disciplinaryAdminVoid: function () {
    ds2NotReady('ยกเลิกใบวินัย');
    return Promise.resolve({ ok: false, error: 'การยกเลิกยังไม่พร้อมบน dashboard' });
  },
  // HR ออกใบ — context stub (ไม่มี employee resolver / categories endpoint)
  disciplinaryAdminIssueContext: function () {
    ds2NotReady('HR ออกใบผ่านเว็บ');
    return Promise.resolve({ ok: false, error: 'การออกใบผ่าน dashboard ยังไม่พร้อม — ใช้ผ่าน LINE OA / หน้าเดิม' });
  },
  disciplinaryAdminEmployeeHistory: function () {
    return Promise.resolve({ ok: false, error: 'ประวัติยังไม่พร้อมบน dashboard' });
  },
  disciplinaryAdminHrIssue: function () {
    ds2NotReady('HR ออกใบผ่านเว็บ');
    return Promise.resolve({ ok: false, error: 'การออกใบผ่าน dashboard ยังไม่พร้อม' });
  },
};

var _ds2NotReadyShown = {};
function ds2NotReady(feature) {
  if (_ds2NotReadyShown[feature]) return;
  _ds2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ds2Toast) window.ds2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountDisciplinary — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountDisciplinary() {
  if (!document.getElementById('wrap-disciplinary')) return;
  var wrap = document.getElementById('wrap-disciplinary');

  wrap.innerHTML = '<style>' + DS_CSS() + '</style><div id="ds">' + DS_MARKUP() + '</div>';

  // รัน JS ของหน้าเดิม (closure · google = shim) → ผูก fn ที่ inline onclick ต้องใช้ ลง window
  DS_RUN_PAGE_JS();
}
if (typeof window !== 'undefined') window.mountDisciplinary = mountDisciplinary;

/* ===== CSS เดิม (:root tokens + <style> disciplinary_manager) · prefix ทุก selector ด้วย #ds =====
   ตัด .top/.app-shell/.main-area/.page-head shell + body rules (dashboard มี shell แล้ว) · คง class เดิม */
function DS_CSS() {
  return [
    // tokens
    '#ds{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--teal-dark:#0F766E;--bg:#F8F9FA;--text:#333;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--warn:#F59E0B;--orange:#EA580C;--success:#16A34A;color:var(--text);font-size:14px;line-height:1.5}',
    '#ds *,#ds *::before,#ds *::after{box-sizing:border-box}',

    // top banner
    '#ds .top{background:var(--navy);color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-radius:10px 10px 0 0}',
    '#ds .top-l{display:flex;align-items:center;gap:12px}',
    '#ds .top-t{font-size:16px;font-weight:600}',
    '#ds .top-badge{background:var(--teal);color:#fff;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600;letter-spacing:.5px}',
    '#ds .btn{padding:8px 14px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;border:none;font-family:inherit}',
    '#ds .btn-p{background:var(--teal);color:#fff}',
    '#ds .btn-p:hover{background:var(--teal-dark)}',
    '#ds .btn-s{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2)}',

    // stats
    '#ds .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;padding:16px 20px;background:var(--bg)}',
    '#ds .st{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;border-left-width:3px}',
    '#ds .st.pr{border-left-color:var(--warn)}',
    '#ds .st.wn{border-left-color:var(--error)}',
    '#ds .st.cm{border-left-color:var(--success)}',
    '#ds .st.dp{border-left-color:var(--orange)}',
    '#ds .st.pip{border-left-color:#7C3AED}',
    '#ds .st-n{font-size:24px;font-weight:600;color:var(--navy);line-height:1}',
    '#ds .st-l{font-size:11px;color:var(--muted);margin-top:3px}',

    // tabs
    '#ds .tabs{display:flex;gap:2px;padding:0 20px;border-bottom:1px solid var(--border);background:#fff;flex-wrap:wrap}',
    '#ds .tab{padding:11px 16px;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;font-weight:500}',
    '#ds .tab:hover{color:var(--navy)}',
    '#ds .tab.act{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    '#ds .tab-c{background:var(--bg);color:var(--muted);padding:1px 7px;border-radius:99px;font-size:10px;margin-left:5px;font-weight:600}',
    '#ds .tab.act .tab-c{background:var(--teal-light);color:var(--teal-dark)}',

    // filters
    '#ds .filters{padding:14px 20px;background:#fff;border-bottom:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
    '#ds .input{padding:7px 11px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit;color:var(--navy);background:#fff;min-width:240px}',
    '#ds .input:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',

    // auth banner
    '#ds .auth-banner{padding:9px 14px;background:var(--teal-light);border-left:3px solid var(--teal);margin:14px 20px 0;border-radius:7px;font-size:11px;color:var(--teal-dark);line-height:1.5}',
    '#ds .auth-banner b{color:var(--navy);font-weight:600}',

    // table
    '#ds .table-wrap{padding:14px 20px}',
    '#ds table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)}',
    '#ds th{background:var(--navy);color:#fff;text-align:left;padding:11px 12px;font-size:11px;font-weight:600;letter-spacing:.3px;text-transform:uppercase}',
    '#ds td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border);color:var(--navy);vertical-align:middle}',
    '#ds tr:hover td{background:var(--teal-light)}',
    '#ds .emp{display:flex;gap:9px;align-items:center}',
    '#ds .emp-av{width:30px;height:30px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0}',
    '#ds .emp-n{font-weight:500}',
    '#ds .emp-m{font-size:10px;color:var(--muted)}',
    '#ds .type-cell{display:flex;flex-direction:column}',
    '#ds .type-t{font-weight:500}',
    '#ds .type-l{font-size:10px;color:var(--muted)}',

    // pills
    '#ds .pill{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10px;font-weight:600}',
    '#ds .pill-d{width:6px;height:6px;border-radius:50%}',
    '#ds .pill.warn-v{background:#FEF3C7;color:#B45309}', '#ds .pill.warn-v .pill-d{background:#F59E0B}',
    '#ds .pill.warn-w{background:#FEE2E2;color:#991B1B}', '#ds .pill.warn-w .pill-d{background:#DC2626}',
    '#ds .pill.warn-f{background:#7F1D1D;color:#fff}', '#ds .pill.warn-f .pill-d{background:#fff}',
    '#ds .pill.comm-s{background:#D1FAE5;color:#047857}', '#ds .pill.comm-s .pill-d{background:#16A34A}',
    '#ds .pill.comm-e{background:#EDE9FE;color:#5B21B6}', '#ds .pill.comm-e .pill-d{background:#8B5CF6}',
    '#ds .pill.ack-p{background:#FEF3C7;color:#B45309}', '#ds .pill.ack-p .pill-d{background:#F59E0B}',
    '#ds .pill.ack-a{background:#D1FAE5;color:#047857}', '#ds .pill.ack-a .pill-d{background:#16A34A}',
    '#ds .pill.ack-d{background:#FED7AA;color:#9A3412}', '#ds .pill.ack-d .pill-d{background:#EA580C}',
    '#ds .pill.rev-p{background:#FEF3C7;color:#B45309}',
    '#ds .pill.rev-a{background:#D1FAE5;color:#047857}',
    '#ds .pill.rev-v{background:#F3F4F6;color:#4B5563}',
    '#ds .pip-flag{background:#7C3AED;color:#fff;padding:2px 6px;border-radius:99px;font-size:9px;font-weight:600}',

    // row actions
    '#ds .row-actions{display:flex;gap:6px}',
    '#ds .btn-row{padding:5px 10px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:#fff;color:var(--navy);font-family:inherit}',
    '#ds .btn-row.app{background:var(--success);color:#fff;border-color:var(--success)}',
    '#ds .btn-row.void{background:#FEE2E2;color:#991B1B;border-color:#FECACA}',
    '#ds .btn-row:hover{background:var(--teal-light);border-color:var(--teal);color:var(--teal-dark)}',

    // modal (scope ใต้ #ds · z-index สูง · fixed)
    '#ds .modal-bg{display:none;position:fixed;inset:0;background:rgba(13,47,79,.6);z-index:9000;align-items:center;justify-content:center;padding:20px}',
    '#ds .modal-bg.open{display:flex}',
    '#ds .modal{background:#fff;border-radius:14px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto}',
    '#ds .modal-h{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}',
    '#ds .modal-t{font-size:15px;font-weight:600;color:var(--navy)}',
    '#ds .modal-x{background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer}',
    '#ds .modal-b{padding:16px 20px}',
    '#ds .field{margin-bottom:12px}',
    '#ds .field-l{display:block;font-size:11px;font-weight:600;color:var(--navy);margin-bottom:5px;letter-spacing:.3px}',
    '#ds .field-l .req{color:var(--error)}',
    '#ds .field-i{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:inherit;color:var(--navy)}',
    '#ds .field-i:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#ds .modal-f{padding:14px 20px;border-top:1px solid var(--border);display:flex;gap:9px;justify-content:flex-end}',
    '#ds .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    '#ds .loading{padding:40px 20px;text-align:center;color:var(--muted)}',
  ].join('\n');
}

/* ===== markup เดิม (top/stats/tabs/filters/table/modal) · คง element id เดิม =====
   ตัด page-head/app-shell/sidebar/sheet_link/brand_footer · ตัด refresh button (dashboard มี refresh) */
function DS_MARKUP() {
  return ''
    + '<div class="top">'
    + '  <div class="top-l">'
    + '    <div class="top-t">บันทึกวินัย · ตักเตือน / ชมเชย</div>'
    + '    <div class="top-badge">DSC</div>'
    + '  </div>'
    + '  <div>'
    + '    <button class="btn btn-p" onclick="openHrIssue()">+ HR ออกใบ</button>'
    + '  </div>'
    + '</div>'
    + '<div class="auth-banner" id="authBanner" style="display:none;"></div>'
    + '<div class="stats" id="stats">'
    + '  <div class="st pr"><div><div class="st-n" id="stPr">–</div><div class="st-l">รอ HR ทบทวน</div></div></div>'
    + '  <div class="st wn"><div><div class="st-n" id="stWn">–</div><div class="st-l">ตักเตือนที่ใช้อยู่</div></div></div>'
    + '  <div class="st cm"><div><div class="st-n" id="stCm">–</div><div class="st-l">ใบชมเชย</div></div></div>'
    + '  <div class="st dp"><div><div class="st-n" id="stDp">–</div><div class="st-l">พนง.โต้แย้ง</div></div></div>'
    + '  <div class="st pip"><div><div class="st-n" id="stPip">–</div><div class="st-l">เข้าแผนพัฒนา (PIP)</div></div></div>'
    + '</div>'
    + '<div class="tabs" id="tabs"></div>'
    + '<div class="filters">'
    + '  <input class="input" id="search" type="search" placeholder="ค้นหา · ชื่อพนักงาน / ผู้ออก / หมวด / รายละเอียด" oninput="reload()">'
    + '  <span style="font-size:11px; color:var(--muted); margin-left:auto;" id="rowCount">–</span>'
    + '</div>'
    + '<div class="table-wrap" id="tableWrap"><div class="loading">กำลังโหลด...</div></div>'
    + '<div class="modal-bg" id="modalBg" onclick="if(event.target===this)closeModal()">'
    + '  <div class="modal">'
    + '    <div class="modal-h">'
    + '      <div class="modal-t" id="modalT">รายละเอียดใบ</div>'
    + '      <button class="modal-x" onclick="closeModal()">×</button>'
    + '    </div>'
    + '    <div class="modal-b" id="modalB"></div>'
    + '    <div class="modal-f" id="modalF"></div>'
    + '  </div>'
    + '</div>';
}

/* ============================================================
   DS_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → DS_BACKEND
   helper esc/showToast inline · fn ที่ inline onclick ต้องใช้ → ผูก window ตอนท้าย
   ============================================================ */
function DS_RUN_PAGE_JS() {

  // ---- google.script.run shim → DS_BACKEND (async · คืน shape เดิม) ----
  function _ds2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (DS_BACKEND[prop]) {
            Promise.resolve().then(function () { return DS_BACKEND[prop].apply(DS_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[DS_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[DS_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ds2MakeChain(); } });

  // ---- helpers (inline · esc local ในหน้าเดิม) ----
  function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function showToast(msg, type) {
    var t = document.getElementById('ds2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ds2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#DC2626' : type === 'success' ? '#16A34A' : '#0D2F4F';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ds2Toast = showToast;

  // scope helper: query เฉพาะใต้ #ds (กัน id ชนกับหน้าอื่นใน dashboard)
  var ROOT = document.getElementById('ds');
  function gid(id) { return ROOT ? ROOT.querySelector('#' + id) : document.getElementById(id); }

  /* ====================== JS หน้าเดิม (disciplinary_manager) — ลอกทั้งดุ้น ======================
     แทน document.getElementById(...) → gid(...) เพื่อ scope ใต้ #ds */
  var _state = { tab: 'pending_review', rows: [], counts: {}, authorized: [], loadSeq: 0, issueCtxSeq: 0 };

  function init() {
    try {
      reload();
      google.script.run.withSuccessHandler(function (s) {
        if (!s || !s.ok) return;
        var a = gid('stPr'); if (a) a.textContent = s.pending_review || 0;
        var b = gid('stDp'); if (b) b.textContent = s.disputed || 0;
        var c = gid('stPip'); if (c) c.textContent = s.pip_triggered_unhandled || 0;
      }).disciplinaryAdminTodaySummary();
    } catch (e) {
      var tw = gid('tableWrap');
      if (tw) tw.innerHTML = '<div class="empty">init error · ' + (e && (e.message || e)) + '</div>';
    }
  }

  function reload() {
    var tw = gid('tableWrap');
    try {
      var sEl = gid('search');
      var opts = { tab: _state.tab, search: sEl ? sEl.value : '' };
      if (tw) tw.innerHTML = '<div class="loading">กำลังโหลด...</div>';
      // watchdog: กัน "กำลังโหลด..." ค้างถาวร
      var _seq = ++_state.loadSeq;
      setTimeout(function () {
        if (_seq === _state.loadSeq && tw && tw.querySelector('.loading')) {
          tw.innerHTML = '<div class="empty">โหลดข้อมูลนานผิดปกติ (ระบบอาจช้าช่วงนี้) · ' +
            '<a href="#" onclick="dsReload();return false;" style="color:var(--teal,#3DC5B7)">ลองโหลดใหม่</a></div>';
        }
      }, 25000);
      google.script.run.withSuccessHandler(onLoaded).withFailureHandler(onError).disciplinaryAdminList(opts);
    } catch (e) {
      if (tw) tw.innerHTML = '<div class="empty">reload error · ' + (e && (e.message || e)) + '</div>';
    }
  }

  function onError(e) {
    var tw = gid('tableWrap');
    if (tw) tw.innerHTML = '<div class="empty">โหลดข้อมูลล้มเหลว · ' + (e.message || e) + '</div>';
  }

  function onLoaded(res) {
    if (!res || !res.ok) return onError(new Error((res && res.error) || 'unknown'));
    _state.rows = res.rows || [];
    _state.counts = res.counts || {};
    _state.authorized = res.authorized_positions || [];
    gid('stWn').textContent = _state.counts.warnings || 0;
    gid('stCm').textContent = _state.counts.commendations || 0;
    renderAuthBanner();
    renderTabs();
    renderTable();
  }

  function renderAuthBanner() {
    var b = gid('authBanner');
    if (!_state.authorized.length) { b.style.display = 'none'; return; }
    var warnPos = _state.authorized.filter(function (p) { return p.can_issue_warning; }).map(function (p) { return esc(p.position_name_th); });
    var commPos = _state.authorized.filter(function (p) { return p.can_issue_commendation; }).map(function (p) { return esc(p.position_name_th); });
    b.style.display = 'block';
    b.innerHTML = '<b>ตำแหน่งที่มีสิทธิ์ออกใบ:</b> ตักเตือน · ' + (warnPos.join(', ') || '—') +
      ' &nbsp;&nbsp;|&nbsp;&nbsp; ชมเชย · ' + (commPos.join(', ') || '—') +
      ' &nbsp;&nbsp;<i style="color:var(--muted);">(ปรับใน Position Manager · column can_issue_warning / can_issue_commendation / max_warning_level)</i>';
  }

  function renderTabs() {
    var c = _state.counts;
    var tabs = [
      { k: 'pending_review', label: 'รอทบทวน', count: c.pending_review || 0 },
      { k: 'warnings', label: 'ตักเตือน', count: c.warnings || 0 },
      { k: 'commendations', label: 'ชมเชย', count: c.commendations || 0 },
      { k: 'disputed', label: 'โต้แย้ง', count: c.disputed || 0 },
      { k: 'voided', label: 'ยกเลิก', count: c.voided || 0 },
      { k: 'all', label: 'ทั้งหมด', count: c.all || 0 },
    ];
    gid('tabs').innerHTML = tabs.map(function (t) {
      return '<div class="tab ' + (_state.tab === t.k ? 'act' : '') + '" onclick="setTab(\'' + t.k + '\')">' + esc(t.label) + ' <span class="tab-c">' + t.count + '</span></div>';
    }).join('');
  }
  function setTab(k) { _state.tab = k; reload(); }

  function renderTable() {
    gid('rowCount').textContent = _state.rows.length + ' รายการ';
    if (!_state.rows.length) {
      gid('tableWrap').innerHTML = '<div class="empty">ไม่มีรายการที่ตรงเงื่อนไข</div>';
      return;
    }
    var html = '<table><thead><tr>' +
      '<th>พนักงาน</th><th>ประเภท / ระดับ</th><th>หมวด</th><th>ผู้ออก</th>' +
      '<th>วันที่</th><th>รับทราบ</th><th>สถานะ</th><th>จัดการ</th>' +
      '</tr></thead><tbody>';
    html += _state.rows.map(function (r) {
      var lvlClass = r.record_type === 'warning'
        ? (r.level === 'verbal' ? 'warn-v' : r.level === 'written' ? 'warn-w' : 'warn-f')
        : (r.level === 'standard' ? 'comm-s' : 'comm-e');
      var ackClass = r.ack_status === 'acknowledged' ? 'ack-a' :
        r.ack_status === 'disputed' ? 'ack-d' : 'ack-p';
      var revClass = r.review_status === 'pending_review' ? 'rev-p' :
        r.review_status === 'voided' ? 'rev-v' : 'rev-a';
      var rid = String(r.record_id || '').replace(/'/g, "\\'");
      var desc = (r.description || '');
      return '<tr>' +
        '<td><div class="emp">' +
          '<div class="emp-av">' + esc((r.employee_name || '?').charAt(0)) + '</div>' +
          '<div><div class="emp-n">' + esc(r.employee_name) + '</div><div class="emp-m">' + esc(r.employee_position || '-') + '</div></div>' +
        '</div></td>' +
        '<td><div class="type-cell">' +
          '<div class="type-t">' + (r.record_type === 'warning' ? 'ใบตักเตือน' : 'ใบชมเชย') + '</div>' +
          '<span class="pill ' + lvlClass + '"><span class="pill-d"></span>' + esc(r.level_label) + '</span>' +
          (r.pip_triggered ? '<span class="pip-flag">PIP</span>' : '') +
        '</div></td>' +
        '<td>' + esc(r.category_label) + '<div class="emp-m">' + esc(desc.substring(0, 50)) + (desc.length > 50 ? '…' : '') + '</div></td>' +
        '<td>' + esc(r.issuer_name) + '</td>' +
        '<td>' + esc(r.issued_at) + (r.expires_at ? '<div class="emp-m">หมด ' + esc(r.expires_at) + '</div>' : '') + '</td>' +
        '<td><span class="pill ' + ackClass + '"><span class="pill-d"></span>' + ackLabel(r.ack_status) + '</span></td>' +
        '<td><span class="pill ' + revClass + '">' + revLabel(r.review_status) + '</span></td>' +
        '<td><div class="row-actions">' +
          '<button class="btn-row" onclick="viewDetail(\'' + rid + '\')">ดู</button>' +
          (r.review_status === 'pending_review' ? '<button class="btn-row app" onclick="approve(\'' + rid + '\')">อนุมัติ</button>' : '') +
          (r.review_status !== 'voided' ? '<button class="btn-row void" onclick="openVoid(\'' + rid + '\')">ยกเลิก</button>' : '') +
        '</div></td>' +
      '</tr>';
    }).join('');
    html += '</tbody></table>';
    gid('tableWrap').innerHTML = html;
  }

  function ackLabel(s) { return s === 'acknowledged' ? 'รับทราบ' : s === 'disputed' ? 'โต้แย้ง' : 'รอ ack'; }
  function revLabel(s) { return s === 'approved' ? 'อนุมัติ' : s === 'auto_approved' ? 'auto' : s === 'voided' ? 'ยกเลิก' : 'รอ HR'; }

  function approve(id) {
    if (!confirm('อนุมัติใบนี้?')) return;
    google.script.run.withSuccessHandler(function (r) {
      if (r && r.ok) reload();
      else showToast('Approve ล้มเหลว · ' + (r && r.error), 'error');
    }).disciplinaryAdminApprove(id);
  }

  function openVoid(id) {
    _state.voidId = id;
    gid('modalT').textContent = 'ยกเลิกใบ · ระบุเหตุผล';
    gid('modalB').innerHTML =
      '<div class="field"><label class="field-l">เหตุผล <span class="req">*</span></label>' +
      '<textarea class="field-i" id="voidReason" rows="3" placeholder="เช่น · เอกสารไม่ครบ / ออกผิดคน / employee ชี้แจงแล้ว"></textarea></div>';
    gid('modalF').innerHTML =
      '<button class="btn-row" onclick="closeModal()">ยกเลิก</button>' +
      '<button class="btn-row void" onclick="confirmVoid()">ยืนยันยกเลิก</button>';
    gid('modalBg').classList.add('open');
  }

  function confirmVoid() {
    var reason = gid('voidReason').value.trim();
    if (!reason) { alert('ต้องระบุเหตุผล'); return; }
    google.script.run.withSuccessHandler(function (r) {
      if (r && r.ok) { closeModal(); reload(); }
      else showToast('Void ล้มเหลว · ' + (r && r.error), 'error');
    }).disciplinaryAdminVoid(_state.voidId, reason);
  }

  function viewDetail(id) {
    var r = _state.rows.find(function (x) { return x.record_id === id; });
    if (!r) return;
    gid('modalT').textContent = r.record_id;
    var row = function (label, val) { return '<tr><td style="color:var(--muted); padding:5px 0; vertical-align:top;">' + label + '</td><td>' + val + '</td></tr>'; };
    // ⚠️ แสดงเฉพาะ field ที่มีค่าจริงใน payload — ไม่เดา/ไม่เติมข้อความ พรบ./กฎหมาย
    gid('modalB').innerHTML =
      '<table style="width:100%; font-size:12px;">' +
        row('พนักงาน', '<b>' + esc(r.employee_name) + '</b> · ' + esc(r.employee_position)) +
        row('ผู้ออก', esc(r.issuer_name)) +
        row('ประเภท', (r.record_type === 'warning' ? 'ใบตักเตือน' : 'ใบชมเชย') + ' · ' + esc(r.level_label)) +
        row('หมวด', esc(r.category_label)) +
        (r.incident_date ? row('วันที่เหตุการณ์', esc(r.incident_date)) : '') +
        (r.issued_at ? row('วันที่ออก', esc(r.issued_at)) : '') +
        (r.doc_num ? row('เลขที่หนังสือ', '<b>' + esc(r.doc_num) + '</b>') : '') +
        (r.expires_at ? row('หมดอายุ', esc(r.expires_at)) : '') +
        (r.subject ? row('เรื่อง', '<span style="font-weight:600;">' + esc(r.subject) + '</span>') : '') +
        (r.description ? row('รายละเอียด', '<span style="white-space:pre-wrap;">' + esc(r.description) + '</span>') : '') +
        (r.consequence_text ? row('คำเตือน/ผลกระทบ', '<span style="white-space:pre-wrap; color:#7C2D12;">' + esc(r.consequence_text) + '</span>') : '') +
        (r.benefit_text ? row('ผลลัพธ์ต่อองค์กร', '<span style="white-space:pre-wrap; color:#14532D;">' + esc(r.benefit_text) + '</span>') : '') +
        (r.attachment_url ? row('หลักฐาน', '<a href="' + esc(r.attachment_url) + '" target="_blank">เปิดดู</a>') : '') +
        row('Ack status', ackLabel(r.ack_status) + (r.ack_at ? ' · ' + esc(r.ack_at) : '')) +
        (r.dispute_reason ? row('เหตุผลโต้แย้ง', '<span style="color:#9A3412;">' + esc(r.dispute_reason) + '</span>') : '') +
        (r.void_reason ? row('เหตุผล void', esc(r.void_reason)) : '') +
      '</table>';
    gid('modalF').innerHTML = '<button class="btn-row" onclick="closeModal()">ปิด</button>';
    gid('modalBg').classList.add('open');
  }

  // HR ออกใบผ่านเว็บ — dashboard ยังไม่รองรับ (backend ไม่มี issue endpoint) → context จะคืน error → แจ้งผู้ใช้
  function openHrIssue() {
    gid('modalT').textContent = 'HR ออกใบตักเตือน / ชมเชย';
    gid('modalB').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    gid('modalF').innerHTML = '';
    gid('modalBg').classList.add('open');
    if (_state.issueCtx) { renderHrIssue(); return; }
    var _ctxSeq = ++_state.issueCtxSeq;
    setTimeout(function () {
      var mb = gid('modalB');
      if (_ctxSeq === _state.issueCtxSeq && mb && mb.querySelector('.loading')) {
        mb.innerHTML = '<div class="empty">โหลดข้อมูลนานผิดปกติ (ระบบอาจช้าช่วงนี้) · ' +
          '<a href="#" onclick="openHrIssue();return false;" style="color:var(--teal,#3DC5B7)">ลองโหลดใหม่</a></div>';
      }
    }, 25000);
    google.script.run.withSuccessHandler(function (res) {
      if (_ctxSeq !== _state.issueCtxSeq) return;
      if (!res || !res.ok) {
        gid('modalB').innerHTML =
          '<div class="empty">โหลด context ไม่สำเร็จ · ' + esc((res && res.error) || 'unknown') + '</div>';
        return;
      }
      _state.issueCtx = res;
      renderHrIssue();
    }).withFailureHandler(function (e) {
      if (_ctxSeq !== _state.issueCtxSeq) return;
      gid('modalB').innerHTML =
        '<div class="empty">โหลด context ไม่สำเร็จ · ' + esc(e.message || e) + '</div>';
    }).disciplinaryAdminIssueContext();
  }

  function renderHrIssue() {
    var ctx = _state.issueCtx;
    var f = _state.hrIssue = _state.hrIssue ||
      { record_type: 'warning', branch: '', level: '', category: '', employee_id: '', description: '', incident_date: '', attachment_url: '' };
    var isWarn = f.record_type === 'warning';
    var levels = isWarn
      ? [['verbal', 'ตักเตือนวาจา', '#F59E0B'], ['written', 'ลายลักษณ์อักษร', '#DC2626'], ['final', 'ครั้งสุดท้าย', '#7F1D1D']]
      : [['standard', 'ชมเชยปกติ', '#16A34A'], ['exceptional', 'เกียรติคุณ', '#8B5CF6']];
    var cats = isWarn ? (ctx.categories_warning || []) : (ctx.categories_commendation || []);
    if (!levels.some(function (l) { return l[0] === f.level; })) f.level = '';
    if (!cats.some(function (c) { return c.key === f.category; })) f.category = '';

    _state.hrHistCache = _state.hrHistCache || {};
    if (f.employee_id && !_state.hrHistCache[f.employee_id]) hrIssueLoadHist(f.employee_id);

    var branches = [];
    (ctx.employees || []).forEach(function (e) { if (e.branch_id && branches.indexOf(e.branch_id) < 0) branches.push(e.branch_id); });
    branches.sort();
    var emps = (ctx.employees || []).filter(function (e) { return !f.branch || e.branch_id === f.branch; });
    if (f.employee_id && !emps.some(function (e) { return e.employee_id === f.employee_id; })) f.employee_id = '';

    function chip(label, on, color, onclick, full) {
      return '<button type="button" onclick="' + onclick + '" style="' + (full ? '' : 'flex:1; min-width:96px; ')
        + 'text-align:' + (full ? 'left' : 'center') + '; padding:8px 10px; border-radius:7px; cursor:pointer; font-size:12px; font-weight:'
        + (full ? '500' : '600') + '; font-family:inherit; border:1px solid ' + (on ? color : '#E5E7EB') + '; background:' + (on ? color : '#fff')
        + '; color:' + (on ? '#fff' : '#374151') + ';">' + esc(label) + '</button>';
    }

    var html = '';
    html += '<div class="field"><label class="field-l">ประเภท <span class="req">*</span></label>'
      + '<div style="display:flex; gap:8px;">'
      + chip('ใบตักเตือน', isWarn, '#DC2626', "hrIssueSetType('warning')")
      + chip('ใบชมเชย', !isWarn, '#16A34A', "hrIssueSetType('commendation')")
      + '</div></div>';

    html += '<div class="field"><label class="field-l">สาขา</label>'
      + '<select class="field-i" id="hrBranch" onchange="hrIssueSetBranch(this.value)">'
      + '<option value="">ทุกสาขา</option>'
      + branches.map(function (b) { return '<option value="' + esc(b) + '"' + (f.branch === b ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('')
      + '</select></div>';

    html += '<div class="field"><label class="field-l">พนักงานที่จะออกใบ <span class="req">*</span></label>'
      + '<select class="field-i" id="hrEmp" onchange="hrIssueSetEmp(this.value)">'
      + '<option value="">— เลือกพนักงาน (' + emps.length + ' คน) —</option>'
      + emps.map(function (e) {
          var label = (e.nickname || e.full_name || e.employee_id)
            + (e.position ? (' · ' + e.position) : '') + (e.branch_id ? (' · ' + e.branch_id) : '');
          return '<option value="' + esc(e.employee_id) + '"' + (f.employee_id === e.employee_id ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('')
      + '</select></div>';

    if (f.employee_id) {
      html += '<div class="field">' + hrIssueHistHtml((_state.hrHistCache || {})[f.employee_id]) + '</div>';
    }

    html += '<div class="field"><label class="field-l">ระดับ <span class="req">*</span></label>'
      + '<div style="display:flex; gap:6px; flex-wrap:wrap;">'
      + levels.map(function (l) { return chip(l[1], f.level === l[0], l[2], "hrIssueSetLevel('" + l[0] + "')"); }).join('')
      + '</div></div>';

    html += '<div class="field"><label class="field-l">หมวด <span class="req">*</span></label>'
      + '<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">'
      + cats.map(function (c) { return chip(c.th, f.category === c.key, '#3DC5B7', "hrIssueSetCat('" + c.key + "')", true); }).join('')
      + '</div></div>';

    html += '<div class="field"><label class="field-l">รายละเอียด <span class="req">*</span></label>'
      + '<textarea class="field-i" id="hrDesc" rows="3" oninput="_dsHrIssueDesc(this.value)" placeholder="'
        + (isWarn ? 'อธิบายเหตุการณ์ · วันเวลา · ผลกระทบ' : 'อธิบายผลงานที่ดี · impact ต่อทีม/องค์กร') + '">' + esc(f.description) + '</textarea></div>';

    html += '<div class="field"><label class="field-l">วันที่เกิดเหตุการณ์</label>'
      + '<input type="date" class="field-i" id="hrDate" value="' + esc(f.incident_date) + '" oninput="_dsHrIssueDate(this.value)"></div>';

    html += '<div class="field"><label class="field-l">URL หลักฐาน (Drive · optional)</label>'
      + '<input type="url" class="field-i" id="hrAtt" value="' + esc(f.attachment_url) + '" oninput="_dsHrIssueAtt(this.value)" placeholder="https://drive.google.com/..."></div>';

    html += '<div style="font-size:11px; color:var(--muted); line-height:1.5;">ออกในนาม <b>'
      + esc(ctx.issuer ? ctx.issuer.name : '-') + '</b> · ระดับ written/final จะเข้าสถานะ "รอ HR ทบทวน" · ระบบ push แจ้งพนักงานทันที</div>';

    gid('modalB').innerHTML = html;
    gid('modalF').innerHTML =
      '<button class="btn-row" onclick="closeModal()">ยกเลิก</button>'
      + '<button class="btn-row app" onclick="submitHrIssue()">ออกใบ</button>';
  }

  function hrIssueSetType(t) {
    _state.hrIssue = _state.hrIssue || {};
    _state.hrIssue.record_type = t;
    _state.hrIssue.level = '';
    _state.hrIssue.category = '';
    renderHrIssue();
  }
  function hrIssueSetBranch(b) { _state.hrIssue.branch = b; renderHrIssue(); }
  function hrIssueSetLevel(l) { _state.hrIssue.level = l; renderHrIssue(); }
  function hrIssueSetCat(k) { _state.hrIssue.category = k; renderHrIssue(); }
  function hrIssueSetEmp(id) { _state.hrIssue.employee_id = id; renderHrIssue(); }

  function hrIssueLoadHist(id) {
    _state.hrHistCache = _state.hrHistCache || {};
    _state.hrHistCache[id] = { loading: true };
    google.script.run.withSuccessHandler(function (res) {
      _state.hrHistCache[id] = (res && res.ok) ? res : { error: (res && res.error) || 'load failed' };
      if (_state.hrIssue && _state.hrIssue.employee_id === id) renderHrIssue();
    }).withFailureHandler(function (e) {
      _state.hrHistCache[id] = { error: (e && e.message) || String(e) };
      if (_state.hrIssue && _state.hrIssue.employee_id === id) renderHrIssue();
    }).disciplinaryAdminEmployeeHistory(id);
  }

  function hrIssueHistHtml(h) {
    var box = '<div style="background:#F8F9FA; border:1px solid var(--border); border-radius:8px; padding:10px;">'
      + '<div style="font-size:11px; font-weight:600; color:var(--navy); margin-bottom:6px;">ประวัติใบของพนักงานคนนี้</div>';
    if (!h || h.loading) return box + '<div style="font-size:12px; color:var(--muted);">กำลังโหลด...</div></div>';
    if (h.error) return box + '<div style="font-size:12px; color:var(--error);">โหลดประวัติไม่ได้ · ' + esc(h.error) + '</div></div>';
    if (!h.records || !h.records.length) return box + '<div style="font-size:12px; color:var(--muted);">ยังไม่มีประวัติ</div></div>';
    var s = h.summary || {};
    box += '<div style="font-size:11px; margin-bottom:6px;"><span style="color:#991B1B; font-weight:600;">ตักเตือน active ' + (s.warnings_active || 0)
      + '</span> &nbsp;·&nbsp; <span style="color:#047857; font-weight:600;">ชมเชย ' + (s.commendations || 0) + '</span></div>';
    box += h.records.slice(0, 8).map(function (r) {
      var isW = r.record_type === 'warning';
      var col = isW ? (r.level === 'final' ? '#7F1D1D' : r.level === 'written' ? '#DC2626' : '#F59E0B') : '#16A34A';
      var ack = r.ack_status === 'acknowledged' ? 'รับทราบ' : r.ack_status === 'disputed' ? 'โต้แย้ง' : 'รอ ack';
      return '<div style="display:flex; align-items:center; gap:6px; font-size:11px; padding:3px 0; ' + (r.expired ? 'opacity:.5;' : '') + '">'
        + '<span style="width:7px; height:7px; border-radius:50%; background:' + col + '; flex-shrink:0;"></span>'
        + '<span style="font-weight:600; color:' + col + '; min-width:88px;">' + esc(r.level_label) + '</span>'
        + '<span style="color:#374151; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(r.category_label) + '</span>'
        + '<span style="color:var(--muted); flex-shrink:0;">' + esc(r.issued_at) + ' · ' + ack + (r.expired ? ' · หมดอายุ' : '') + '</span></div>';
    }).join('');
    if (h.records.length > 8) box += '<div style="font-size:10px; color:#9CA3AF; margin-top:4px;">… อีก ' + (h.records.length - 8) + ' รายการ</div>';
    return box + '</div>';
  }

  function submitHrIssue() {
    var f = _state.hrIssue || {};
    if (!f.employee_id) { alert('เลือกพนักงานก่อน'); return; }
    if (!f.level) { alert('เลือกระดับ'); return; }
    if (!f.category) { alert('เลือกหมวด'); return; }
    if (!f.description || !f.description.trim()) { alert('กรอกรายละเอียด'); return; }
    gid('modalF').innerHTML = '<span style="font-size:12px; color:var(--muted);">กำลังออกใบ...</span>';
    google.script.run.withSuccessHandler(function (res) {
      if (res && res.ok) {
        _state.hrIssue = null;
        closeModal();
        reload();
        google.script.run.withSuccessHandler(function (s) {
          if (s && s.ok) gid('stPr').textContent = s.pending_review || 0;
        }).disciplinaryAdminTodaySummary();
      } else {
        showToast('ออกใบไม่สำเร็จ · ' + ((res && res.error) || 'unknown'), 'error');
        renderHrIssue();
      }
    }).withFailureHandler(function (e) {
      showToast('ออกใบไม่สำเร็จ · ' + (e.message || e), 'error');
      renderHrIssue();
    }).disciplinaryAdminHrIssue({
      record_type: f.record_type,
      employee_id: f.employee_id,
      level: f.level,
      category: f.category,
      description: f.description,
      incident_date: f.incident_date,
      attachment_url: f.attachment_url,
    });
  }

  function closeModal() { gid('modalBg').classList.remove('open'); }

  // ---- expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ----
  var _exp = {
    reload: reload, setTab: setTab, viewDetail: viewDetail, approve: approve,
    openVoid: openVoid, confirmVoid: confirmVoid, closeModal: closeModal,
    openHrIssue: openHrIssue, renderHrIssue: renderHrIssue, submitHrIssue: submitHrIssue,
    hrIssueSetType: hrIssueSetType, hrIssueSetBranch: hrIssueSetBranch,
    hrIssueSetLevel: hrIssueSetLevel, hrIssueSetCat: hrIssueSetCat, hrIssueSetEmp: hrIssueSetEmp,
  };
  Object.keys(_exp).forEach(function (k) { window[k] = _exp[k]; });
  // alias สำหรับ watchdog link + oninput state setters (เดิมแตะ _state.hrIssue ตรง ๆ ใน inline)
  window.dsReload = reload;
  window._dsHrIssueDesc = function (v) { _state.hrIssue = _state.hrIssue || {}; _state.hrIssue.description = v; };
  window._dsHrIssueDate = function (v) { _state.hrIssue = _state.hrIssue || {}; _state.hrIssue.incident_date = v; };
  window._dsHrIssueAtt = function (v) { _state.hrIssue = _state.hrIssue || {}; _state.hrIssue.attachment_url = v; };

  // ---- start ----
  init();
}
