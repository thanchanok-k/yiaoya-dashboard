// _ported/announce.js — FULL native port of desktop announcement_manager.html (HR Announcement admin)
// ลอกทั้งดุ้น: 4 view (Dashboard/Calendar/List/Analytics) + editor modal + resend modal + detail modal
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix #an ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ mountAnnounceP() · google.script.run = shim → ANN_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
// fn/var ที่ต้อง expose ให้ inline onclick = ผูกกับ window ภายใน mountAnnounceP
//
// backend (edge fn hr_announce): action list/create/update/publish/archive/remove
//   feature ที่ทำ backend จริงไม่ได้ (upload Drive, LINE multicast, prefixes/lookups เต็ม) → stub แจ้ง "ยังไม่พร้อม"

/* ============================================================
   ANN_BACKEND — map google.script.run → Supabase edge fn hr_announce
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (อ่านจาก renderListView/renderDetail/openEditorWithData)
   ============================================================ */
var ANN_LOOKUPS_CACHE = null;

function an2NowIso() { return new Date().toISOString(); }

// map payload (จาก events.payload) → row shape ที่ JS เดิมใช้
function an2MapRow(p) {
  p = p || {};
  var status = String(p.status || 'published').toLowerCase();
  var target_count = (p.target_count != null) ? p.target_count : 0;
  var read_count = p.read_count || 0;
  var ack_count = p.ack_count || 0;
  var open_rate = (p.open_rate != null) ? p.open_rate : (target_count ? Math.round(read_count / target_count * 100) : 0);
  var ack_rate = (p.ack_rate != null) ? p.ack_rate : (target_count ? Math.round(ack_count / target_count * 100) : 0);
  var body_md = String(p.body_md || p.body || '');
  var tb = an2ToArr(p.target_branches), tp = an2ToArr(p.target_positions), td = an2ToArr(p.target_departments);
  var tt = an2ToArr(p.target_tags), te = an2ToArr(p.target_employees), tx = an2ToArr(p.target_exclude_employees);
  var tsParts = [];
  if (tb.length) tsParts.push(tb.length + ' สาขา');
  if (td.length) tsParts.push(td.length + ' แผนก');
  if (tp.length) tsParts.push(tp.length + ' ตำแหน่ง');
  var targets_summary = p.targets_summary || (tsParts.length ? tsParts.join(' · ') : (p.audience || 'ทุกคน'));
  return {
    ann_id: p.announcement_id || p.ann_id || '',
    title: p.title || '',
    body_md: body_md,
    body_preview: p.body_preview || body_md.replace(/[#*|>\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
    category: String(p.category || 'general').toLowerCase(),
    status: status,
    audience: p.audience || '',
    requires_ack: an2ToBool(p.requires_ack),
    requires_quiz: an2ToBool(p.requires_quiz),
    quiz_json: p.quiz_json || '',
    effective_date: p.effective_date || '',
    header_image: p.header_image || '',
    body_images: an2ToArr(p.body_images),
    send_mode: p.send_mode || 'auto',
    silent_push: an2ToBool(p.silent_push),
    remind_24h: an2ToBool(p.remind_24h),
    scheduled_at: p.scheduled_at || '',
    created_at: p.created_at || p.posted_at || '',
    published_at: (status === 'published') ? (p.published_at || p.posted_at || '') : (p.published_at || ''),
    created_by: p.posted_by || p.created_by || '—',
    target_branches: tb, target_positions: tp, target_departments: td,
    target_tags: tt, target_employees: te, target_exclude_employees: tx,
    target_count: target_count, read_count: read_count, ack_count: ack_count,
    open_rate: open_rate, ack_rate: ack_rate,
  };
}
function an2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(function (s) { return String(s).trim(); }).filter(Boolean);
  return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}
function an2ToBool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

// lookups stub — backend ไม่มี employees/branches/positions เต็ม → คืนว่าง (chips/picker จะว่าง · ไม่ error)
function an2BuildLookups() {
  return { branches: [], positions: [], departments: [], tags: [], employees: [] };
}

var ANN_BACKEND = {
  // role gate — user dashboard = admin/owner เต็มสิทธิ์
  annAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },
  // list — { announcements:[...], lookups:{...} }
  annAdminList: function () {
    return sb.functions.invoke('hr_announce', { body: { action: 'list' } }).then(function (res) {
      var data = (res && res.data) || {};
      var items = (data.announcements || []).map(an2MapRow);
      return { announcements: items, lookups: an2BuildLookups(), stats: {} };
    });
  },
  // detail — { announcement, counts, target_list }
  annAdminGetDetail: function (annId) {
    return sb.functions.invoke('hr_announce', { body: { action: 'list' } }).then(function (res) {
      var data = (res && res.data) || {};
      var items = (data.announcements || []).map(an2MapRow);
      var a = items.find(function (x) { return x.ann_id === annId; });
      if (!a) return { error: 'ไม่พบประกาศ' };
      var total = a.target_count || 0;
      var opened = a.read_count || 0;
      var acked = a.ack_count || 0;
      return {
        announcement: a,
        counts: {
          total: total, opened: opened, acknowledged: acked,
          unopened: Math.max(0, total - opened),
          open_rate: a.open_rate, ack_rate: a.ack_rate,
        },
        target_list: [],   // backend ไม่เก็บ per-target read state → ว่าง
      };
    });
  },
  // create — { ann_id }
  annAdminCreate: function (payload) {
    var body = Object.assign({ action: 'create' }, payload, { status: 'draft' });
    return sb.functions.invoke('hr_announce', { body: body }).then(function (res) {
      var data = (res && res.data) || {};
      if (data.error) return { error: data.error };
      return { ann_id: data.id || (data.announcement && data.announcement.announcement_id) };
    });
  },
  // update
  annAdminUpdate: function (annId, payload) {
    var body = Object.assign({ action: 'update', announcement_id: annId }, payload);
    return sb.functions.invoke('hr_announce', { body: body }).then(function (res) {
      var data = (res && res.data) || {};
      if (data.error) return { error: data.error };
      return { ok: true, ann_id: annId };
    });
  },
  // publish
  annAdminPublish: function (annId) {
    return sb.functions.invoke('hr_announce', { body: { action: 'publish', announcement_id: annId } }).then(function (res) {
      var data = (res && res.data) || {};
      if (data.error) return { error: data.error };
      return { ok: true, target_count: (data.announcement && data.announcement.target_count) || 0 };
    });
  },
  // archive
  annAdminArchive: function (annId) {
    return sb.functions.invoke('hr_announce', { body: { action: 'archive', announcement_id: annId } }).then(function (res) {
      var data = (res && res.data) || {};
      if (data.error) return { error: data.error };
      return { ok: true };
    });
  },
  // remove (draft/scheduled hard · published owner) — opts.mode hard/archive
  annAdminRemove: function (annId, opts) {
    opts = opts || {};
    if (opts.mode === 'archive') return ANN_BACKEND.annAdminArchive(annId);
    return sb.functions.invoke('hr_announce', { body: { action: 'remove', announcement_id: annId } }).then(function (res) {
      var data = (res && res.data) || {};
      if (data.error) return { error: data.error };
      return { ok: true };
    });
  },
  // request remove — dashboard = owner → คืน is_owner ให้ JS เดิม fallback ลบตรง
  annAdminRequestRemove: function () {
    return Promise.resolve({ is_owner: true });
  },
  // categories — mirror getAnnCategories ของเดิม
  annAdminGetCategories: function () {
    return Promise.resolve([
      { value: 'permanent', label: 'บอร์ดถาวร', desc: 'ประกาศติดบอร์ดถาวร' },
      { value: 'monthly', label: 'บอร์ดประจำเดือน', desc: 'ประกาศประจำเดือน' },
      { value: 'policy', label: 'นโยบาย/ระเบียบ', desc: 'นโยบาย/ระเบียบบริษัท' },
      { value: 'welfare', label: 'สวัสดิการ', desc: 'สวัสดิการพนักงาน' },
      { value: 'activity', label: 'กิจกรรม/CSR', desc: 'กิจกรรม/CSR' },
      { value: 'announcement', label: 'แจ้งเตือนทั่วไป', desc: 'แจ้งเตือนทั่วไป' },
      { value: 'urgent', label: 'ด่วน', desc: 'ประกาศด่วน' },
      { value: 'general', label: 'ทั่วไป', desc: 'ทั่วไป' },
    ]);
  },
  // prefixes (14 แผนก) — backend ไม่มี → คืนว่าง (chips แผนก fallback lookups.departments = ว่าง)
  annAdminGetPrefixes: function () { return Promise.resolve([]); },
  // preview next ann id — stub
  annAdminPreviewNextAnnId: function () {
    return Promise.resolve({ next_id: 'A-NEW', prefix: '', prefix_label: 'auto' });
  },
  // preview targets — backend ไม่มี employee resolver → stub count 0
  annAdminPreviewTargets: function () {
    return Promise.resolve({ count: 0, line_linked_count: 0, no_line_count: 0, sample: [] });
  },
  // resend — stub (ไม่มี LINE multicast)
  annAdminResend: function () {
    an2NotReady('ส่งซ้ำ LINE');
    return Promise.resolve({ ok: true, count: 0, message: 'ฟีเจอร์ส่งซ้ำ LINE ยังไม่พร้อมบน dashboard' });
  },
  // remind unacked — stub
  annAdminRemindUnacked: function () {
    an2NotReady('เตือนคนที่ยังไม่ ack');
    return Promise.resolve({ ok: true, sent: 0, message: 'ฟีเจอร์เตือนซ้ำ LINE ยังไม่พร้อมบน dashboard' });
  },
  // upload image — stub (ไม่มี Drive)
  annAdminUploadImage: function () {
    an2NotReady('อัปโหลดรูปไป Drive');
    return Promise.resolve({ ok: false, error: 'อัปโหลดรูปยังไม่พร้อมบน dashboard — ใช้ช่อง "วาง URL เอง" แทน' });
  },
  // fetch sheet TSV — stub
  announcementFetchSheetTSV: function () {
    an2NotReady('ดึงตารางจาก Google Sheet');
    return Promise.resolve({ ok: false, error: 'ดึงจากลิงก์ชีตยังไม่พร้อมบน dashboard — ใช้วิธีก๊อปวางช่วงเซลล์แทน' });
  },
  // EmpCache / nav helpers — stub (ไม่มีใน dashboard scope)
  empCacheList: function () { return Promise.resolve([]); },
  navGetExecUrl: function () { return Promise.resolve(''); },
};

var _an2NotReadyShown = {};
function an2NotReady(feature) {
  if (_an2NotReadyShown[feature]) return;
  _an2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.an2Toast) window.an2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountAnnounceP — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountAnnounceP() {
  var wrap = document.getElementById('wrap-announce_p');
  if (!wrap) return;

  var CSS = AN2_CSS();
  var MARKUP = AN2_MARKUP();
  wrap.innerHTML = '<style>' + CSS + '</style><div id="an">' + MARKUP + '</div>';

  // รัน JS ของหน้าเดิม (closure scope · google = shim) → ผูก fn ที่ inline onclick ต้องใช้ ลง window
  AN2_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles + <style> manager) · prefix ทุก selector ด้วย #an =====
   ตัด .topbar/sidebar/main shell ออก (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด */
function AN2_CSS() {
  return [
    // tokens
    '#an{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEF2F2;--danger-border:#FEE2E2;--success:#047857;--success-bg:#ECFDF5;--warning:#B45309;--warning-bg:#FFFBEB;--info:#1D4ED8;--info-bg:#EFF6FF;--c-public:#047857;--c-public-bg:#ECFDF5;--c-company:#6D28D9;--c-company-bg:#F5F3FF;--c-branch:#C2410C;--c-branch-bg:#FFF7ED;--c-religious:#1D4ED8;--c-religious-bg:#EFF6FF;color:var(--text);font-size:13px;line-height:1.5}',
    '#an *{box-sizing:border-box}',

    // ===== shared buttons / field / pills / modal / empty / loading / help / toast =====
    '#an .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#an .btn:hover{border-color:var(--navy)}',
    '#an .btn svg{width:14px;height:14px}',
    '#an .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#an .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#an .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#an .btn-sm{padding:5px 10px;font-size:12px}',
    '#an .btn-icon{width:30px;height:30px;padding:0;display:inline-flex;align-items:center;justify-content:center;color:#475569}',
    '#an .btn-icon-danger{border-color:var(--danger-border);background:var(--danger-bg);color:var(--danger)}',
    '#an .btn-icon-danger:hover{border-color:var(--danger)}',
    '#an .field{display:flex;flex-direction:column;gap:5px;margin-bottom:14px}',
    '#an .field label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:500}',
    '#an .field input[type=text],#an .field input[type=date],#an .field input[type=datetime-local],#an .field input[type=email],#an .field input[type=search],#an .field input[type=number],#an .field select,#an .field textarea{padding:9px 12px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;color:var(--text);background:var(--surface);transition:border .15s;width:100%}',
    '#an .field input:focus,#an .field select:focus,#an .field textarea:focus{outline:none;border-color:var(--navy);box-shadow:0 0 0 3px rgba(13,47,79,.1)}',
    '#an .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '#an .field-help{font-size:11px;color:var(--text-faint);margin-top:2px}',
    '#an .pill{padding:2px 9px;border-radius:12px;font-size:10px;font-weight:600}',
    '#an .pill-danger{background:var(--danger-bg);color:var(--danger)}',
    '#an .pill-success{background:var(--success-bg);color:var(--success)}',
    '#an .pill-warning{background:var(--warning-bg);color:var(--warning)}',
    '#an .pill-info{background:var(--info-bg);color:var(--info)}',
    '#an .pill-muted{background:#F1F5F9;color:var(--text-muted)}',
    // modal (scope ใต้ #an · z-index สูง · fixed)
    '#an .modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.5);display:none;z-index:9000;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)}',
    '#an .modal-bg.active{display:flex}',
    '#an .modal{background:var(--surface);border-radius:12px;padding:0;max-width:540px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.25);display:flex;flex-direction:column}',
    '#an .modal-header{padding:20px 24px 16px;border-bottom:1px solid var(--border)}',
    '#an .modal-header h2{font-size:16px;font-weight:600;color:var(--text);letter-spacing:-.01em}',
    '#an .modal-header p{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#an .modal-body{padding:20px 24px;flex:1;overflow-y:auto}',
    '#an .modal-footer{padding:14px 24px;border-top:1px solid var(--border);background:#F8FAFC;display:flex;gap:8px;justify-content:flex-end}',
    '#an .empty{text-align:center;padding:60px 20px;background:var(--surface);border:1px dashed var(--border);border-radius:10px}',
    '#an .empty svg{width:40px;height:40px;color:var(--text-faint);margin-bottom:10px}',
    '#an .empty-title{font-size:14px;font-weight:600;color:var(--text-muted)}',
    '#an .empty-sub{font-size:12px;color:var(--text-faint);margin-top:4px}',
    '#an .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // help modal
    '#an .help-intro{padding:12px 14px;background:var(--info-bg);color:var(--info);border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px}',
    '#an .help-section{background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid var(--border-strong)}',
    '#an .help-section.help-section-warn{background:var(--warning-bg);border-left-color:var(--warning)}',
    '#an .help-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}',
    '#an .help-section-warn .help-section-title{color:var(--warning)}',
    '#an .help-section-items{margin-left:18px;font-size:13px;line-height:1.7}',
    '#an .help-section-items li{margin-bottom:4px}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก view/section + 3 modals · คง element id เดิม =====
   ตัด sidebar/sheet_link/brand_footer · ใช้ string ปกติ (มี class ของหน้า manager) */
function AN2_MARKUP() {
  return AN2_VIEW_CSS() + AN2_HEADER() + AN2_DASHBOARD() + AN2_CALENDAR() + AN2_LIST() + AN2_ANALYTICS() + AN2_EDITOR_MODAL() + AN2_RESEND_MODAL() + AN2_DETAIL_MODAL();
}

/* view-specific CSS (จาก <style> ในหน้า manager · prefix #an) — return เป็น <style> ก้อนเดียว */
function AN2_VIEW_CSS() {
  var c = [
    // view switcher / status tabs
    '#an .view-switcher{display:inline-flex;padding:4px;background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:14px}',
    '#an .vs-tab{padding:7px 14px;border:0;background:transparent;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .12s}',
    '#an .vs-tab:hover{color:var(--navy)}',
    '#an .vs-tab.active{background:var(--navy);color:#fff;box-shadow:0 1px 3px rgba(13,47,79,.2)}',
    '#an .vs-tab svg{width:13px;height:13px}',
    '#an .tabs{display:inline-flex;gap:4px;padding:4px;background:#fff;border:1px solid var(--border);border-radius:10px;margin-bottom:12px;flex-wrap:wrap}',
    '#an .tab{padding:7px 12px;border:0;background:transparent;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .12s}',
    '#an .tab:hover{color:var(--navy)}',
    '#an .tab.active{background:#E6F7F5;color:var(--teal-dark);font-weight:600}',
    '#an .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--border);color:var(--text-muted);font-weight:700}',
    '#an .tab.active .cnt{background:var(--teal);color:#fff}',
    // header
    '#an .main-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;gap:16px;flex-wrap:wrap}',
    '#an .main-head h1{font-size:22px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:10px}',
    '#an .main-head h1 svg{width:22px;height:22px;color:var(--teal)}',
    '#an .main-head h1 .badge-version{font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;background:var(--teal);color:var(--navy);letter-spacing:.04em}',
    '#an .main-head .sub{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#an .head-actions{display:flex;gap:8px;flex-wrap:wrap}',
    '#an .btn-icon-only{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;background:#fff;border:1px solid var(--border);color:var(--text-muted);cursor:pointer}',
    '#an .btn-icon-only:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#an .btn-icon-only svg{width:14px;height:14px}',
    // filter bar + multiselect
    '#an .filter-bar{background:#fff;border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:12px}',
    '#an .filter-row{display:grid;grid-template-columns:1.8fr 1.2fr 1.2fr 1.2fr 1.2fr 0.9fr auto;gap:8px;align-items:end}',
    '@media (max-width:1300px){#an .filter-row{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:700px){#an .filter-row{grid-template-columns:1fr}}',
    '#an .filter-field{display:flex;flex-direction:column;gap:4px;min-width:0}',
    '#an .filter-field>label{font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#an .filter-field>label .opt{font-weight:400;text-transform:none;color:var(--text-faint);margin-left:2px}',
    '#an .filter-field input[type=search],#an .filter-field select{height:32px;box-sizing:border-box;padding:0 10px;border:1px solid var(--border);border-radius:6px;font-family:inherit;font-size:12px;color:var(--text);background:#fff;width:100%}',
    '#an .filter-field input[type=search]:focus,#an .filter-field select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#an .ms-dropdown{position:relative}',
    '#an .ms-trigger{height:32px;box-sizing:border-box;padding:0 26px 0 9px;border:1px solid var(--border);border-radius:6px;background:#fff;cursor:pointer;font-size:12px;color:var(--text);width:100%;display:flex;align-items:center;gap:3px;flex-wrap:nowrap;overflow:hidden;position:relative}',
    '#an .ms-trigger:hover{border-color:var(--teal)}',
    '#an .ms-trigger::after{content:"";position:absolute;right:10px;top:50%;width:6px;height:6px;border-right:1.5px solid var(--text-muted);border-bottom:1.5px solid var(--text-muted);transform:translateY(-70%) rotate(45deg)}',
    '#an .ms-trigger.is-empty{color:var(--text-faint)}',
    '#an .ms-chip-mini{display:inline-flex;align-items:center;gap:3px;padding:2px 6px;background:#E6F7F5;color:var(--teal-dark);border-radius:4px;font-size:11px;font-weight:600}',
    '#an .ms-chip-mini .x{font-size:14px;line-height:1;cursor:pointer;color:var(--text-muted)}',
    '#an .ms-chip-mini .x:hover{color:var(--danger)}',
    '#an .ms-panel{position:absolute;top:calc(100% + 4px);left:0;right:0;max-height:280px;overflow-y:auto;background:#fff;border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(13,47,79,.1);z-index:50;padding:6px;display:none}',
    '#an .ms-dropdown.open .ms-panel{display:block}',
    '#an .ms-actions{display:flex;gap:6px;padding:4px 6px;border-bottom:1px solid var(--border);margin-bottom:4px}',
    '#an .ms-action{font-size:10px;color:var(--teal-dark);cursor:pointer;font-weight:600;padding:2px 6px;border-radius:4px}',
    '#an .ms-action:hover{background:#E6F7F5}',
    '#an .ms-option{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:5px;cursor:pointer;font-size:12px}',
    '#an .ms-option:hover{background:#E6F7F5}',
    '#an .ms-option input{margin:0;accent-color:var(--teal);cursor:pointer}',
    '#an .ms-option .opt-meta{margin-left:auto;font-size:10px;color:var(--text-faint)}',
    // dashboard grid + stat cards
    '#an .dash-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:18px}',
    '@media (max-width:1100px){#an .dash-grid{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#an .dash-grid{grid-template-columns:repeat(2,1fr)}}',
    '#an .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px 16px;position:relative;overflow:hidden}',
    '#an .stat-card .stripe{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#an .stat-card .stat-label{font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#an .stat-card .stat-value{font-size:26px;font-weight:700;color:var(--navy);line-height:1;margin-top:6px;letter-spacing:-.02em}',
    '#an .stat-card .stat-sub{font-size:11px;color:var(--text-muted);margin-top:4px;display:flex;align-items:center;gap:4px}',
    '#an .dash-row{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:12px;margin-bottom:18px}',
    '@media (max-width:1000px){#an .dash-row{grid-template-columns:1fr}}',
    '#an .dash-row.cols-2{grid-template-columns:1fr 1fr}',
    '@media (max-width:1000px){#an .dash-row.cols-2{grid-template-columns:1fr}}',
    '#an .panel{background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px}',
    '#an .panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}',
    '#an .panel-title{font-size:12px;font-weight:700;color:var(--navy);letter-spacing:-.01em;display:flex;align-items:center;gap:6px}',
    '#an .panel-title svg{width:14px;height:14px;color:var(--teal-dark)}',
    '#an .panel-sub{font-size:10px;color:var(--text-faint);font-weight:400;margin-left:6px}',
    '#an .panel-action{font-size:10px;color:var(--teal-dark);cursor:pointer;font-weight:600}',
    '#an .perf-list{display:flex;flex-direction:column;gap:8px}',
    '#an .perf-row{display:grid;grid-template-columns:1fr auto;gap:10px;padding:8px 10px;background:#FAFBFC;border-radius:6px;align-items:center;cursor:pointer;transition:background .12s}',
    '#an .perf-row:hover{background:#E6F7F5}',
    '#an .perf-row .title{font-size:12px;font-weight:500;color:var(--text)}',
    '#an .perf-row .meta{font-size:10px;color:var(--text-muted);margin-top:2px}',
    '#an .perf-row .score{font-size:13px;font-weight:700;color:var(--navy);text-align:right;min-width:70px}',
    '#an .perf-row .score-sub{font-size:9px;color:var(--text-faint);font-weight:500;margin-top:1px}',
    '#an .perf-row.warn{background:#FEF7E7}',
    '#an .perf-row.warn .score{color:var(--warning)}',
    '#an .perf-row.good{background:#ECFDF5}',
    '#an .perf-row.good .score{color:var(--success)}',
    '#an .perf-empty{padding:18px 10px;text-align:center;font-size:11px;color:var(--text-faint)}',
    '#an .heatmap{display:flex;flex-direction:column;gap:6px}',
    '#an .hm-row{display:grid;grid-template-columns:110px 1fr 60px;gap:10px;align-items:center;font-size:11px}',
    '#an .hm-row .lbl{color:var(--text);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#an .hm-bar{height:10px;background:var(--border);border-radius:5px;overflow:hidden}',
    '#an .hm-bar .fill{height:100%;background:var(--teal);transition:width .4s;border-radius:5px}',
    '#an .hm-bar .fill.warn{background:var(--warning)}',
    '#an .hm-bar .fill.poor{background:var(--danger)}',
    '#an .hm-row .val{font-size:11px;font-weight:600;color:var(--navy);text-align:right}',
    '#an .compliance-ring{display:flex;flex-direction:column;align-items:center;padding:10px 0}',
    '#an .ring-svg{width:130px;height:130px}',
    '#an .ring-bg{stroke:var(--border)}',
    '#an .ring-fill{stroke:var(--teal);stroke-linecap:round;transition:stroke-dashoffset .6s}',
    '#an .ring-fill.warn{stroke:var(--warning)}',
    '#an .ring-fill.poor{stroke:var(--danger)}',
    '#an .ring-center{text-anchor:middle}',
    '#an .ring-center .num{font-size:24px;font-weight:700;fill:var(--navy)}',
    '#an .ring-center .lbl{font-size:10px;fill:var(--text-muted)}',
    '#an .compliance-detail{margin-top:8px;font-size:11px;color:var(--text-muted);text-align:center}',
    '#an .bar-list{display:flex;flex-direction:column;gap:8px}',
    '#an .bar-row{display:grid;grid-template-columns:100px 1fr 40px;gap:10px;align-items:center;font-size:11px}',
    '#an .bar-row .lbl{font-weight:500;color:var(--text)}',
    '#an .bar-track{height:18px;background:var(--border);border-radius:4px;overflow:hidden;position:relative}',
    '#an .bar-track .fill{height:100%;transition:width .4s;border-radius:4px;display:flex;align-items:center;justify-content:flex-end;padding-right:6px;color:#fff;font-size:10px;font-weight:600}',
    '#an .bar-row .cnt{font-size:11px;font-weight:600;color:var(--navy);text-align:right}',
    '#an .qs-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:12px}',
    '#an .qs-row + .qs-row{border-top:1px solid var(--border)}',
    '#an .qs-row .lbl{color:var(--text-muted)}',
    '#an .qs-row .val{font-weight:700;color:var(--navy)}',
    '#an .qs-row .val.success{color:var(--success)}',
    '#an .qs-row .val.teal{color:var(--teal-dark)}',
    '#an .spark{width:100%;height:80px}',
    '#an .spark path.line{fill:none;stroke:var(--teal);stroke-width:2;stroke-linecap:round}',
    '#an .spark path.area{opacity:.3}',
    // view visibility
    '#an .view-section{display:none}',
    '#an .view-section.active{display:block}',
    '#an .section-head{display:flex;justify-content:space-between;align-items:center;margin:18px 0 10px}',
    '#an .section-head .ttl{font-size:13px;font-weight:700;color:var(--navy)}',
    '#an .section-head .sub{font-size:11px;color:var(--text-muted);font-weight:400;margin-left:6px}',
  ];
  return '<style>' + c.join('\n') + AN2_VIEW_CSS2() + '</style>';
}

/* view CSS part 2 — calendar / list cards / analytics / editor sections */
function AN2_VIEW_CSS2() {
  return [
    '',
    // calendar
    '#an .calendar-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px}',
    '#an .cal-nav{display:flex;align-items:center;gap:8px}',
    '#an .cal-nav button{width:30px;height:30px;border-radius:6px;background:#fff;border:1px solid var(--border);cursor:pointer;color:var(--text-muted);display:inline-flex;align-items:center;justify-content:center}',
    '#an .cal-nav button:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#an .cal-nav button svg{width:14px;height:14px}',
    '#an .cal-month-label{font-size:18px;font-weight:600;color:var(--navy);letter-spacing:-.01em;min-width:220px;text-align:center}',
    '#an .cal-jump{font-size:11px;color:var(--teal-dark);cursor:pointer;font-weight:600;padding:4px 10px;border-radius:6px}',
    '#an .cal-jump:hover{background:#E6F7F5}',
    '#an .cal-legend{display:flex;gap:8px;flex-wrap:wrap}',
    '#an .cal-legend .lg{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--text-muted)}',
    '#an .cal-legend .lg .dot{width:8px;height:8px;border-radius:50%}',
    '#an .calendar{background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden}',
    '#an .cal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);background:#FAFBFC;border-bottom:1px solid var(--border)}',
    '#an .cal-weekdays .wd{padding:8px 12px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;text-align:center}',
    '#an .cal-weekdays .wd.weekend{color:var(--text-faint)}',
    '#an .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:minmax(110px,auto)}',
    '#an .cal-cell{border-right:1px solid var(--border);border-bottom:1px solid var(--border);padding:6px 8px;cursor:pointer;display:flex;flex-direction:column;gap:4px;transition:background .12s;position:relative;overflow:hidden}',
    '#an .cal-cell:nth-child(7n){border-right:0}',
    '#an .cal-cell:hover{background:#FAFBFC}',
    '#an .cal-cell.other-month{background:#FAFBFC;opacity:.5;cursor:default}',
    '#an .cal-cell.today{background:#E6F7F5}',
    '#an .cal-cell.today .day-num{background:var(--teal);color:#fff;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:700}',
    '#an .cal-cell .day-num{font-size:11px;font-weight:600;color:var(--text-muted)}',
    '#an .cal-cell.weekend .day-num{color:var(--text-faint)}',
    '#an .cal-cell .day-events{display:flex;flex-direction:column;gap:2px}',
    '#an .cal-event{font-size:10px;padding:2px 5px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:2px solid;background:#fff;color:var(--text)}',
    '#an .cal-event.cat-policy{background:var(--info-bg);border-color:var(--info);color:var(--info)}',
    '#an .cal-event.cat-welfare{background:#E6F7F5;border-color:var(--teal-dark);color:var(--teal-dark)}',
    '#an .cal-event.cat-activity{background:var(--c-company-bg);border-color:var(--c-company);color:var(--c-company)}',
    '#an .cal-event.cat-urgent{background:var(--danger-bg);border-color:var(--danger);color:var(--danger)}',
    '#an .cal-event.cat-general{background:var(--border);border-color:var(--text-faint);color:var(--text-muted)}',
    '#an .cal-event.cat-rule{background:var(--warning-bg);border-color:var(--warning);color:var(--warning)}',
    '#an .cal-event.draft{opacity:.65;font-style:italic}',
    '#an .cal-more{font-size:10px;color:var(--text-muted);margin-top:2px;cursor:pointer;font-weight:600}',
    '#an .cal-more:hover{color:var(--teal-dark)}',
    '#an .calendar-with-detail{display:grid;grid-template-columns:1fr 320px;gap:14px}',
    '@media (max-width:1100px){#an .calendar-with-detail{grid-template-columns:1fr}}',
    '#an .day-detail{background:#fff;border:1px solid var(--border);border-radius:10px;padding:16px;height:fit-content;position:sticky;top:18px;max-height:calc(100vh - 36px);overflow-y:auto}',
    '#an .dd-title{font-size:13px;font-weight:700;color:var(--navy)}',
    '#an .dd-date{font-size:11px;color:var(--text-muted);margin-top:2px}',
    '#an .dd-empty{padding:24px 10px;text-align:center;color:var(--text-faint);font-size:12px}',
    '#an .dd-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}',
    '#an .dd-item{padding:10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:all .12s}',
    '#an .dd-item:hover{border-color:var(--teal);background:#E6F7F5}',
    '#an .dd-item .cat{font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;text-transform:uppercase;letter-spacing:.04em}',
    '#an .dd-item .ttl{font-size:12px;font-weight:600;color:var(--navy);margin-top:4px;line-height:1.4}',
    '#an .dd-item .meta{font-size:10px;color:var(--text-muted);margin-top:4px;display:flex;gap:8px;flex-wrap:wrap}',
    '#an .dd-item .meta .ack-bar{width:60px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;display:inline-block;vertical-align:middle}',
    '#an .dd-item .meta .ack-bar .f{height:100%;background:var(--success)}',
    // list cards
    '#an .ann-grid{display:flex;flex-direction:column;gap:10px}',
    '#an .ann-card{background:#fff;border:1px solid var(--border);border-left:3px solid transparent;border-radius:10px;padding:14px 16px;cursor:pointer;transition:all .12s;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:flex-start}',
    '#an .ann-card:hover{border-color:var(--teal);box-shadow:0 2px 8px rgba(13,47,79,.06)}',
    '#an .ann-card.draft{border-left-color:var(--info)}',
    '#an .ann-card.scheduled{border-left-color:var(--warning)}',
    '#an .ann-card.published{border-left-color:var(--success)}',
    '#an .ann-card.archived{opacity:.7;border-left-color:var(--text-faint)}',
    '#an .ann-meta-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center}',
    '#an .meta-pill{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;line-height:1;vertical-align:middle}',
    '#an .meta-pill svg{width:11px;height:11px;flex-shrink:0}',
    '#an .pill-cat{background:var(--info-bg);color:var(--info)}',
    '#an .pill-st-draft{background:var(--info-bg);color:var(--info)}',
    '#an .pill-st-scheduled{background:var(--warning-bg);color:var(--warning)}',
    '#an .pill-st-published{background:var(--success-bg);color:var(--success)}',
    '#an .pill-st-archived{background:var(--border);color:var(--text-muted)}',
    '#an .pill-ack{background:#FCE7F3;color:#BE185D}',
    '#an .pill-quiz{background:var(--success-bg);color:var(--success)}',
    '#an .pill-date{background:#F1F5F9;color:var(--text-muted);font-weight:500}',
    '#an .ann-title{font-size:14px;font-weight:600;color:var(--navy);margin-top:4px;line-height:1.4}',
    '#an .ann-preview{font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '#an .ann-targets{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#F8FAFC;border-radius:12px;font-size:11px;color:var(--text-muted);margin-top:8px}',
    '#an .ann-targets svg{width:12px;height:12px}',
    '#an .ann-stats{display:flex;flex-direction:column;gap:5px;align-items:flex-end;min-width:150px}',
    '#an .stat-line{font-size:11px;color:var(--text-muted)}',
    '#an .stat-line strong{color:var(--navy);font-weight:700}',
    '#an .card-del-btn{display:inline-flex;align-items:center;gap:4px;margin-top:2px;padding:3px 9px;background:var(--danger-bg);color:var(--danger);border:1px solid transparent;border-radius:6px;font-size:10px;font-weight:600;font-family:inherit;cursor:pointer;transition:all .12s}',
    '#an .card-del-btn:hover{background:var(--danger);color:#fff}',
    '#an .card-del-btn svg{width:12px;height:12px}',
    '#an .rate-bar{width:140px;height:5px;background:var(--border);border-radius:3px;overflow:hidden}',
    '#an .rate-fill{height:100%;background:var(--success);transition:width .3s}',
    '#an .rate-fill.low{background:var(--warning)}',
    '#an .rate-fill.poor{background:var(--danger)}',
    // analytics
    '#an .analytics-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
    '@media (max-width:1000px){#an .analytics-grid{grid-template-columns:1fr}}',
    '#an .an-table{width:100%;border-collapse:collapse;font-size:12px}',
    '#an .an-table th{text-align:left;padding:8px 10px;background:#FAFBFC;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#an .an-table td{padding:10px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#an .an-table td:last-child,#an .an-table th:last-child{text-align:right}',
    '#an .an-table tr:last-child td{border-bottom:0}',
    '#an .an-table tr:hover td{background:#FAFBFC}',
    '#an .an-rate{display:inline-flex;align-items:center;gap:6px}',
    '#an .an-rate .bar{width:60px;height:5px;background:var(--border);border-radius:3px;overflow:hidden}',
    '#an .an-rate .bar .f{height:100%;background:var(--success)}',
    '#an .an-rate .num{font-weight:600;color:var(--navy);min-width:38px;text-align:right}',
    // editor / chips / quiz / upload / preview
    '#an .tip{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;background:#F1F5F9;color:#64748B;font-size:9px;font-weight:700;cursor:help;border:1px solid #E2E8F0;margin-left:4px}',
    '#an .rt-toolbar{display:flex;gap:4px;align-items:center;padding:6px;background:#F8FAFC;border:1px solid #E2E8F0;border-bottom:0;border-radius:6px 6px 0 0}',
    '#an .rt-toolbar button{padding:4px 10px;min-width:28px;background:#fff;border:1px solid #E2E8F0;border-radius:4px;cursor:pointer;font-size:12px;color:#0D2F4F}',
    '#an .rt-toolbar button:hover{background:#F1F5F9;border-color:#94A3B8}',
    '#an .body-editor{width:100%;min-height:360px;padding:14px;border:1px solid var(--border-strong);border-radius:0 0 6px 6px;font-family:inherit;font-size:14px;line-height:1.7;resize:vertical}',
    '#an .ed-blocks{border:1px solid var(--border-strong);border-top:0;border-radius:0 0 6px 6px;background:#fff;padding:6px;min-height:320px}',
    '#an .ed-block{position:relative;border:1px solid transparent;border-radius:6px;padding:4px;margin:2px 0}',
    '#an .ed-block:hover{border-color:#EEF2F6;background:#FCFDFE}',
    '#an .ed-block textarea.ed-txt{width:100%;border:0;resize:none;background:transparent;font-family:inherit;font-size:14px;line-height:1.7;padding:6px 8px;min-height:28px}',
    '#an .ed-block textarea.ed-txt:focus{outline:2px solid #E6F7F5;border-radius:5px}',
    '#an .ed-block .ed-del{position:absolute;top:4px;right:4px;width:22px;height:22px;border:0;border-radius:5px;background:#F1F5F9;color:#94A3B8;font-size:14px;cursor:pointer;opacity:0;transition:opacity .12s;line-height:1}',
    '#an .ed-block:hover .ed-del{opacity:1}',
    '#an .ed-block .ed-del:hover{background:#FEE2E2;color:#B91C1C}',
    '#an .ed-tlabel{font-size:10.5px;font-weight:700;color:#0F766E;letter-spacing:.3px;margin:0 0 5px 2px}',
    '#an table.ed-grid{border-collapse:collapse;width:100%;table-layout:fixed}',
    '#an table.ed-grid td{border:1px solid #E2E8F0;padding:0;position:relative}',
    '#an table.ed-grid td .ed-cell{min-height:30px;padding:7px 9px;font-size:13px;outline:none;word-break:break-word;line-height:1.45}',
    '#an table.ed-grid td .ed-cell:focus{background:#E6F7F5}',
    '#an table.ed-grid tr.head td{background:#0D2F4F}',
    '#an table.ed-grid tr.head .ed-cell{color:#fff;font-weight:700}',
    '#an .ed-grid-wrap{position:relative;padding:0 22px 22px 0}',
    '#an .ed-addcol,#an .ed-addrow{border:1px dashed #3DC5B7;background:#E6F7F5;color:#0F766E;border-radius:6px;font-size:14px;cursor:pointer;font-weight:700;line-height:1;padding:0}',
    '#an .ed-addcol{position:absolute;top:0;right:0;width:18px;bottom:22px}',
    '#an .ed-addrow{position:absolute;left:0;right:22px;bottom:0;height:18px}',
    '#an .ed-tbl-tools{display:flex;gap:5px;margin-top:7px;flex-wrap:wrap}',
    '#an .ed-tbl-tools button{font-size:11px;border:1px solid #D7DEE6;background:#fff;border-radius:5px;padding:3px 8px;cursor:pointer;color:#0D2F4F}',
    '#an .ed-tbl-tools button:hover{border-color:#3DC5B7;background:#E6F7F5}',
    '#an .ed-tbl-tools .danger{color:#B91C1C}',
    '#an .ed-addbar{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
    '#an .ed-addbar button{font-size:12px;border:1px solid #E2E8F0;background:#F8FAFC;border-radius:6px;padding:5px 11px;cursor:pointer;color:#0D2F4F;font-weight:600}',
    '#an .ed-addbar button:hover{border-color:#3DC5B7;background:#E6F7F5;color:#0F766E}',
    '#an .ed-paste-box{width:100%;min-height:50px;border:1px dashed #3DC5B7;border-radius:6px;padding:8px;font-size:12px;font-family:monospace;background:#fff;margin:6px 0}',
    '#an .img-tab-toggle{display:flex;gap:2px;margin-bottom:8px;background:#F1F5F9;border-radius:6px;padding:3px}',
    '#an .img-tab{flex:1;padding:6px 10px;border:0;background:transparent;cursor:pointer;font-size:12px;color:#64748B;border-radius:4px;font-weight:500}',
    '#an .img-tab.active{background:#fff;color:#0D2F4F;box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#an .upload-zone{padding:8px;border:1px dashed #CBD5E1;border-radius:6px;background:#F8FAFC;display:flex;align-items:center;flex-wrap:wrap}',
    '#an .upload-zone:hover{border-color:#3DC5B7;background:#F0FDFA}',
    '#an .upload-zone .btn{font-size:11px;padding:5px 12px}',
    '#an .img-thumb{width:60px;height:60px;border-radius:4px;border:1px solid #E2E8F0;object-fit:cover;cursor:pointer}',
    '#an .chip-group{display:flex;flex-wrap:wrap;gap:4px;min-height:32px}',
    '#an .chip{padding:4px 10px;border:1px solid var(--border-strong);border-radius:14px;background:#fff;font-size:11px;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:4px}',
    '#an .chip:hover{border-color:var(--navy)}',
    '#an .chip.selected{background:var(--navy);color:#fff;border-color:var(--navy)}',
    '#an .chip.selected.exclude{background:var(--danger);border-color:var(--danger)}',
    '#an .chip.selected.tag-chip{background:var(--info);border-color:var(--info)}',
    '#an .chip.selected.dept-chip{background:var(--warning);border-color:var(--warning)}',
    '#an .emp-picker{max-height:180px;overflow-y:auto;border:.5px solid var(--border-strong);border-radius:6px;padding:4px;background:#fff}',
    '#an .emp-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:12px}',
    '#an .emp-row:hover{background:#F8FAFC}',
    '#an .emp-row.selected{background:var(--info-bg);color:var(--info)}',
    '#an .emp-row.excluded{background:var(--danger-bg);color:var(--danger)}',
    '#an .preview-card{background:#F8FAFC;border-radius:8px;padding:12px;margin-top:10px}',
    '#an .preview-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px}',
    '#an .preview-count{font-size:28px;font-weight:600;color:var(--navy);line-height:1}',
    '#an .preview-sub{font-size:11px;color:var(--text-muted);margin-top:2px}',
    '#an .preview-list{max-height:140px;overflow-y:auto;margin-top:8px;font-size:11px;padding-left:12px;color:var(--text-muted)}',
    '#an .preview-warn{background:var(--warning-bg);color:var(--warning);padding:6px 10px;border-radius:6px;font-size:11px;margin-top:6px}',
    '#an .stat-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}',
    '#an .stat-box{background:#F8FAFC;padding:10px;border-radius:6px;text-align:center}',
    '#an .stat-box .v{font-size:20px;font-weight:600;color:var(--text);line-height:1}',
    '#an .stat-box .l{font-size:10px;color:var(--text-muted);margin-top:4px;text-transform:uppercase;letter-spacing:.04em}',
    '#an .stat-box.received .v{color:var(--success)}',
    '#an .stat-box.unopened .v{color:var(--danger)}',
    '#an .target-list{max-height:280px;overflow-y:auto;border:.5px solid var(--border);border-radius:6px}',
    '#an .target-row{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid #F1F5F9;font-size:12px}',
    '#an .target-row:last-child{border-bottom:0}',
    '#an .target-row.unopened{background:#FEF2F2}',
    '#an .target-name{font-weight:500}',
    '#an .target-meta{font-size:10px;color:var(--text-faint)}',
    '#an .target-status{font-size:10px;padding:2px 7px;border-radius:8px;font-weight:600;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;line-height:1}',
    '#an .target-status svg{width:11px;height:11px;flex-shrink:0}',
    '#an .ts-unopened{background:var(--danger-bg);color:var(--danger)}',
    '#an .ts-opened{background:var(--info-bg);color:var(--info)}',
    '#an .ts-acked{background:var(--success-bg);color:var(--success)}',
    '#an .schedule-card{padding:10px 12px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:6px;margin-top:8px}',
    '#an .schedule-card label{font-size:11px;font-weight:500;color:#92400E;display:block;margin-bottom:4px}',
    '#an .schedule-card input{width:100%;padding:6px 8px;border:.5px solid #FCD34D;border-radius:4px;font-size:12px}',
    '#an .schedule-card .hint{font-size:10px;color:#92400E;margin-top:4px}',
    '#an .quiz-builder{margin-top:8px;padding:10px 12px;background:#ECFEFF;border:1px solid #A5F3FC;border-radius:6px}',
    '#an .quiz-builder h4{font-size:11px;font-weight:500;color:#0E7490;margin:0 0 6px}',
    '#an .quiz-item{padding:8px;background:#fff;border:.5px solid #CFFAFE;border-radius:5px;margin-bottom:6px}',
    '#an .quiz-item input{width:100%;padding:4px 6px;font-size:12px;border:.5px solid var(--border-strong);border-radius:3px;margin-bottom:4px}',
    '#an .quiz-add{padding:5px 10px;background:#fff;border:1px dashed #67E8F9;color:#0E7490;border-radius:4px;font-size:11px;cursor:pointer;width:100%}',
    '#an .quiz-add:hover{background:#ECFEFF}',
    '#an .body-help{font-size:11px;color:var(--text-muted);margin-top:4px}',
    '#an .modal.editor{max-width:800px}',
    '#an #resend-bg{z-index:9100}',
    '#an .editor-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:16px}',
    '@media (max-width:800px){#an .editor-grid{grid-template-columns:1fr}}',
    '#an .editor-section{background:#F8FAFC;padding:12px;border:.5px solid var(--border);border-radius:8px;margin-bottom:10px}',
    '#an .editor-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;display:flex;align-items:center;gap:6px}',
    '#an .editor-section-title svg{width:12px;height:12px}',
    '#an .r-mode-card{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #E2E8F0;border-radius:6px;cursor:pointer;transition:all .12s;background:#fff}',
    '#an .r-mode-card:hover{border-color:#3DC5B7;background:#F0FDFA}',
    '#an .r-mode-card input[type=radio]{width:auto;margin:0;flex-shrink:0}',
    '#an .r-mode-card:has(input:checked){border-color:#3DC5B7;background:#ECFEFF}',
  ].join('\n');
}

/* ===== markup sections (ลอกจาก announcement_manager.html · คง element id เดิม) ===== */
function AN2_HEADER() {
  return ''
  + '<div class="main-head">'
  +   '<div>'
  +     '<h1><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>Announcements<span class="badge-version">v2</span></h1>'
  +     '<p class="sub">เขียนประกาศ + multi-criteria targeting + monthly calendar + read stats</p>'
  +   '</div>'
  +   '<div class="head-actions">'
  +     '<button class="btn-icon-only" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn"></button>'
  +     '<button class="btn-icon-only" onclick="loadList()" title="Refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-9-9c2.5 0 4.85.99 6.6 2.6L21 8"/><path d="M21 3v5h-5"/></svg></button>'
  +     '<button class="btn btn-primary" onclick="openEditor()" id="new-btn"></button>'
  +   '</div>'
  + '</div>'
  // view switcher
  + '<div class="view-switcher">'
  +   '<button class="vs-tab active" data-view="dashboard" onclick="setView(\'dashboard\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>Dashboard</button>'
  +   '<button class="vs-tab" data-view="calendar" onclick="setView(\'calendar\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Calendar</button>'
  +   '<button class="vs-tab" data-view="list" onclick="setView(\'list\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>List</button>'
  +   '<button class="vs-tab" data-view="analytics" onclick="setView(\'analytics\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>Analytics</button>'
  + '</div>'
  // status tabs
  + '<div class="tabs">'
  +   '<button class="tab active" data-tab="all" onclick="setTab(\'all\')">ทั้งหมด <span class="cnt" id="cnt-all">—</span></button>'
  +   '<button class="tab" data-tab="draft" onclick="setTab(\'draft\')">Draft <span class="cnt" id="cnt-draft">—</span></button>'
  +   '<button class="tab" data-tab="scheduled" onclick="setTab(\'scheduled\')">Scheduled <span class="cnt" id="cnt-scheduled">—</span></button>'
  +   '<button class="tab" data-tab="published" onclick="setTab(\'published\')">Published <span class="cnt" id="cnt-published">—</span></button>'
  +   '<button class="tab" data-tab="archived" onclick="setTab(\'archived\')">Archived <span class="cnt" id="cnt-archived">—</span></button>'
  + '</div>'
  // filter bar
  + '<div class="filter-bar"><div class="filter-row">'
  +   '<div class="filter-field"><label>ค้นหา</label><input type="search" id="f-search" placeholder="title / body / ann_id" oninput="onFiltersChanged()"></div>'
  +   '<div class="filter-field"><label>หมวด <span class="opt">(multi)</span></label><div class="ms-dropdown" id="ms-category"></div></div>'
  +   '<div class="filter-field"><label>ตำแหน่ง <span class="opt">(multi)</span></label><div class="ms-dropdown" id="ms-position"></div></div>'
  +   '<div class="filter-field"><label>สาขา <span class="opt">(multi)</span></label><div class="ms-dropdown" id="ms-branch"></div></div>'
  +   '<div class="filter-field"><label>แผนก <span class="opt">(multi)</span></label><div class="ms-dropdown" id="ms-department"></div></div>'
  +   '<div class="filter-field"><label>ช่วงเวลา</label><select id="f-range" onchange="onFiltersChanged()"><option value="all">ทั้งหมด</option><option value="month">เดือนนี้</option><option value="last30">30 วันล่าสุด</option><option value="last90">90 วันล่าสุด</option><option value="year">ปีนี้</option></select></div>'
  +   '<div class="filter-field"><label>&nbsp;</label><button class="btn-icon-only" onclick="clearAllFilters()" title="ล้าง filter ทั้งหมด"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>'
  + '</div></div>';
}

function AN2_DASHBOARD() {
  return ''
  + '<section class="view-section active" id="view-dashboard">'
  +   '<div class="dash-grid">'
  +     '<div class="stat-card"><div class="stripe" style="background:var(--navy)"></div><div class="stat-label">ทั้งหมด</div><div class="stat-value" id="d-total">—</div><div class="stat-sub" id="d-total-sub">all statuses</div></div>'
  +     '<div class="stat-card"><div class="stripe" style="background:var(--success)"></div><div class="stat-label">Published</div><div class="stat-value" id="d-published">—</div><div class="stat-sub" id="d-published-sub">ส่งจริง</div></div>'
  +     '<div class="stat-card"><div class="stripe" style="background:var(--info)"></div><div class="stat-label">Draft</div><div class="stat-value" id="d-draft">—</div><div class="stat-sub" id="d-draft-sub">รอ publish</div></div>'
  +     '<div class="stat-card"><div class="stripe" style="background:var(--teal)"></div><div class="stat-label">Avg Open Rate</div><div class="stat-value"><span id="d-open">—</span><span style="font-size:14px;font-weight:600;color:var(--text-muted)">%</span></div><div class="stat-sub">all published</div></div>'
  +     '<div class="stat-card"><div class="stripe" style="background:#F59E0B"></div><div class="stat-label">Avg Ack Rate</div><div class="stat-value"><span id="d-ack">—</span><span style="font-size:14px;font-weight:600;color:var(--text-muted)">%</span></div><div class="stat-sub" id="d-ack-sub">all published</div></div>'
  +   '</div>'
  +   '<div class="dash-row">'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>Trend — 6 เดือนล่าสุด<span class="panel-sub">จำนวนประกาศ / เดือน</span></div></div><svg class="spark" id="spark-trend" viewBox="0 0 600 80" preserveAspectRatio="none"></svg><div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-faint);margin-top:6px" id="spark-labels"></div></div>'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>Compliance — Ack</div></div><div class="compliance-ring"><svg class="ring-svg" viewBox="0 0 100 100"><circle class="ring-bg" cx="50" cy="50" r="42" fill="none" stroke-width="9"/><circle id="ring-fill" class="ring-fill" cx="50" cy="50" r="42" fill="none" stroke-width="9" stroke-dasharray="263.9" stroke-dashoffset="263.9" transform="rotate(-90 50 50)"/><g class="ring-center"><text id="ring-num" class="num" x="50" y="52">—</text><text id="ring-lbl" class="lbl" x="50" y="68">— / —</text></g></svg><div class="compliance-detail" id="compliance-detail">ประกาศที่ต้อง ack</div></div></div>'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>Quick Stats</div></div><div id="quick-stats"></div></div>'
  +   '</div>'
  +   '<div class="dash-row">'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>Top 5 — Ack rate สูงสุด</div></div><div class="perf-list" id="perf-top"></div></div>'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>ต้องตาม — Ack ต่ำ</div></div><div class="perf-list" id="perf-low"></div></div>'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>ตามหมวด</div></div><div class="bar-list" id="cat-breakdown"></div></div>'
  +   '</div>'
  +   '<div class="dash-row cols-2">'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>Coverage — ตามสาขา<span class="panel-sub">% open ของพนักงาน</span></div></div><div class="heatmap" id="heatmap-branch"></div></div>'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/></svg>Coverage — ตามตำแหน่ง<span class="panel-sub">% ack ของพนักงาน</span></div></div><div class="heatmap" id="heatmap-position"></div></div>'
  +   '</div>'
  + '</section>';
}

function AN2_CALENDAR() {
  return ''
  + '<section class="view-section" id="view-calendar">'
  +   '<div class="calendar-head">'
  +     '<div class="cal-nav">'
  +       '<button onclick="calPrev()" title="เดือนก่อน"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>'
  +       '<div class="cal-month-label" id="cal-month-label"></div>'
  +       '<button onclick="calNext()" title="เดือนถัดไป"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>'
  +       '<span class="cal-jump" onclick="calToday()">วันนี้</span>'
  +     '</div>'
  +     '<div class="cal-legend">'
  +       '<span class="lg"><span class="dot" style="background:var(--info)"></span>นโยบาย</span>'
  +       '<span class="lg"><span class="dot" style="background:var(--teal)"></span>สวัสดิการ</span>'
  +       '<span class="lg"><span class="dot" style="background:var(--c-company)"></span>กิจกรรม</span>'
  +       '<span class="lg"><span class="dot" style="background:var(--warning)"></span>ระเบียบ</span>'
  +       '<span class="lg"><span class="dot" style="background:var(--danger)"></span>ด่วน</span>'
  +       '<span class="lg"><span class="dot" style="background:var(--text-faint)"></span>ทั่วไป</span>'
  +     '</div>'
  +   '</div>'
  +   '<div class="calendar-with-detail">'
  +     '<div><div class="calendar"><div class="cal-weekdays"><div class="wd">จันทร์</div><div class="wd">อังคาร</div><div class="wd">พุธ</div><div class="wd">พฤหัสบดี</div><div class="wd">ศุกร์</div><div class="wd weekend">เสาร์</div><div class="wd weekend">อาทิตย์</div></div><div class="cal-grid" id="cal-grid"></div></div></div>'
  +     '<div class="day-detail" id="day-detail"><div class="dd-title">คลิกวันใน calendar</div><div class="dd-date">เพื่อดูประกาศของวันนั้น</div><div class="dd-empty"><div>เลือกวันที่จะดูประกาศ</div></div></div>'
  +   '</div>'
  + '</section>';
}

function AN2_LIST() {
  return ''
  + '<section class="view-section" id="view-list">'
  +   '<div class="section-head">'
  +     '<div class="ttl">รายการประกาศ <span class="sub" id="list-count">—</span></div>'
  +     '<div><select id="f-sort" onchange="renderListView()" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:11px;background:#fff;font-family:inherit"><option value="newest">ใหม่สุดก่อน</option><option value="oldest">เก่าสุดก่อน</option><option value="ack-high">Ack สูงสุด</option><option value="ack-low">Ack ต่ำสุด</option><option value="target-high">Target มากสุด</option></select></div>'
  +   '</div>'
  +   '<div id="content" class="loading">กำลังโหลด...</div>'
  + '</section>';
}

function AN2_ANALYTICS() {
  return ''
  + '<section class="view-section" id="view-analytics">'
  +   '<div class="analytics-grid">'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/></svg>Engagement ตามตำแหน่ง</div></div><table class="an-table"><thead><tr><th>ตำแหน่ง</th><th>ได้รับ</th><th>เปิด</th><th>Ack rate</th></tr></thead><tbody id="an-position-body"></tbody></table></div>'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>Engagement ตามสาขา</div></div><table class="an-table"><thead><tr><th>สาขา</th><th>ได้รับ</th><th>เปิด</th><th>Ack rate</th></tr></thead><tbody id="an-branch-body"></tbody></table></div>'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>Engagement ตามแผนก</div></div><table class="an-table"><thead><tr><th>แผนก</th><th>ได้รับ</th><th>เปิด</th><th>Ack rate</th></tr></thead><tbody id="an-department-body"></tbody></table></div>'
  +     '<div class="panel"><div class="panel-head"><div class="panel-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Engagement ตามหมวด<span class="panel-sub">เฉลี่ย rate</span></div></div><table class="an-table"><thead><tr><th>หมวด</th><th>จำนวน</th><th>Avg open</th><th>Avg ack</th></tr></thead><tbody id="an-category-body"></tbody></table></div>'
  +   '</div>'
  + '</section>';
}

function AN2_EDITOR_MODAL() {
  return ''
  + '<div class="modal-bg" id="editor-bg" onclick="if(event.target===this)closeEditor()">'
  +   '<div class="modal editor">'
  +     '<div class="modal-header"><h2 id="ed-modal-title">เขียนประกาศใหม่</h2><p>เลขประกาศ: <strong id="ed-ann-id-preview" style="color:#3DC5B7">รอ generate</strong> · กรอกข้อมูล + เลือก target → ระบบ multicast LINE</p></div>'
  +     '<div class="modal-body">'
  +       '<input type="hidden" id="ed-id">'
  +       '<div class="editor-grid">'
  +         '<div>'
  +           '<div class="field-grid">'
  +             '<div class="field"><label>หัวข้อ * <span class="tip" data-tip="หัวข้อจะโชว์ตัวใหญ่ที่สุด">?</span></label><input type="text" id="ed-title" placeholder="แจ้งสิทธิ์วันลาประจำปี"></div>'
  +             '<div class="field"><label>ประเภท * <span class="tip" data-tip="เลือกหมวดประกาศ">?</span></label><select id="ed-category" style="width:100%"></select></div>'
  +           '</div>'
  +           '<div class="field">'
  +             '<label>เนื้อหา * <span class="tip" data-tip="กดปุ่ม B / I / List">?</span></label>'
  +             '<div class="rt-toolbar">'
  +               '<button type="button" onclick="rtFormat(\'bold\')" title="ตัวหนา" style="font-weight:700">B</button>'
  +               '<button type="button" onclick="rtFormat(\'italic\')" title="ตัวเอียง" style="font-style:italic">I</button>'
  +               '<button type="button" onclick="rtFormat(\'bullet\')" title="Bullet list">•&nbsp;list</button>'
  +               '<button type="button" onclick="rtFormat(\'number\')" title="Numbered list">1.&nbsp;list</button>'
  +               '<button type="button" onclick="edAddTable()" title="แทรกตาราง" style="font-weight:600;color:#0F766E">▦&nbsp;ตาราง</button>'
  +               '<span style="flex:1"></span>'
  +               '<button type="button" onclick="rtUploadImageAtCursor()" title="เลือกรูปจากเครื่อง"><span style="font-size:13px">+&nbsp;แทรกรูป</span></button>'
  +               '<button type="button" onclick="rtInsertImage()" title="วาง URL รูปเอง" style="font-size:11px;color:#64748B">URL</button>'
  +               '<input type="file" accept="image/*" id="upload-inline" onchange="onInlineImagePicked(this)" style="display:none">'
  +             '</div>'
  +             '<div class="ed-blocks" id="ed-blocks"></div>'
  +             '<textarea id="ed-body" class="body-editor" style="display:none" placeholder="พิมพ์เนื้อหา..."></textarea>'
  +             '<div class="ed-addbar"><button type="button" onclick="edAddText()">+ ข้อความ</button><button type="button" onclick="edAddTable()">▦ + ตาราง</button><button type="button" onclick="edTogglePaste()">วางจาก Google Sheet</button></div>'
  +             '<div id="ed-paste-wrap" style="display:none">'
  +               '<div style="display:flex;gap:6px;margin-bottom:6px"><input type="text" id="ed-sheet-url" placeholder="วางลิงก์ Google Sheet แล้วกดดึง" style="flex:1;padding:6px 9px;font-size:12px;border:.5px solid #CBD5E1;border-radius:6px"><button type="button" class="btn btn-sm" id="ed-sheet-fetch-btn" onclick="edFetchSheetLink()" style="background:#0D2F4F;color:#fff;white-space:nowrap">ดึงจากลิงก์</button></div>'
  +               '<div id="ed-sheet-msg" style="font-size:11px;color:#64748B;margin-bottom:4px"></div>'
  +               '<textarea id="ed-paste-box" class="ed-paste-box" placeholder="หรือก็อปช่วงเซลล์จาก Google Sheet แล้ววางตรงนี้"></textarea>'
  +               '<button type="button" class="btn btn-sm" onclick="edImportPaste()" style="background:#3DC5B7;color:#fff">สร้างเป็นตาราง</button>'
  +             '</div>'
  +             '<div class="body-help">คลิกในเซลล์เพื่อพิมพ์ · ปุ่ม + ขอบขวา/ล่างตาราง = เพิ่มคอลัมน์/แถว · แถวบนสุด = หัวตาราง</div>'
  +           '</div>'
  +           '<div class="editor-section">'
  +             '<div class="editor-section-title" id="es-images"></div>'
  +             '<div class="img-tab-toggle"><button type="button" class="img-tab active" data-tab="upload" onclick="switchImgTab(\'upload\')"><span>อัพโหลดรูป (แนะนำ)</span></button><button type="button" class="img-tab" data-tab="url" onclick="switchImgTab(\'url\')"><span>วาง URL เอง</span></button></div>'
  +             '<div class="img-tab-pane" id="img-tab-upload">'
  +               '<div class="field"><label>Header image <span class="tip" data-tip="รูปหลักบนสุด 16:10">?</span></label><div class="upload-zone" id="uz-header"><input type="file" accept="image/*" id="upload-header" onchange="uploadImage(this,\'header\')" style="display:none"><button type="button" class="btn btn-sm" onclick="document.getElementById(\'upload-header\').click()">เลือกรูป</button><span id="upload-header-status" style="font-size:11px;color:#64748B;margin-left:8px">ยังไม่ได้เลือก</span></div><div id="upload-header-preview" style="margin-top:6px"></div></div>'
  +               '<div class="field"><label>Body images (สูงสุด 11 รูป) <span class="tip" data-tip="2-11 รูป = carousel">?</span></label><div class="upload-zone"><input type="file" accept="image/*" id="upload-body" multiple onchange="uploadImage(this,\'body\')" style="display:none"><button type="button" class="btn btn-sm" onclick="document.getElementById(\'upload-body\').click()">เลือกหลายรูป</button><span id="upload-body-status" style="font-size:11px;color:#64748B;margin-left:8px">ยังไม่ได้เลือก</span></div><div id="upload-body-preview" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px"></div></div>'
  +             '</div>'
  +             '<div class="img-tab-pane" id="img-tab-url" style="display:none">'
  +               '<div class="field"><label>Header image URL</label><input type="text" id="ed-header-image" placeholder="https://drive.google.com/uc?id=..." style="font-family:monospace;font-size:11px"></div>'
  +               '<div class="field"><label>Body images URLs (comma)</label><textarea id="ed-body-images" rows="2" placeholder="url1, url2..." style="font-family:monospace;font-size:11px"></textarea></div>'
  +             '</div>'
  +             '<div class="field-grid">'
  +               '<div class="field"><label>Send mode</label><select id="ed-send-mode"><option value="auto">Auto (แนะนำ)</option><option value="text_only">Text only</option><option value="single_hero">Single bubble</option><option value="carousel">Carousel</option><option value="web_link">Web link</option></select></div>'
  +               '<div class="field"><label>Push behavior</label><label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;margin-top:6px"><input type="checkbox" id="ed-silent" style="width:auto"> ส่งเงียบ (ไม่ noti)</label><label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;margin-top:4px"><input type="checkbox" id="ed-remind" style="width:auto"> เตือนซ้ำ 24 ชม.</label></div>'
  +             '</div>'
  +           '</div>'
  +           '<div class="editor-section">'
  +             '<div class="editor-section-title" id="es-options"></div>'
  +             '<div class="field-grid">'
  +               '<div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ed-ack" style="width:auto"><span>ต้องกด <strong>รับทราบ</strong> (ack)</span></label></div>'
  +               '<div class="field"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="ed-quiz" style="width:auto"><span>ต้องทำ <strong>Quiz</strong></span></label></div>'
  +             '</div>'
  +           '</div>'
  +           '<div class="schedule-card"><label>ตั้งเวลาส่ง (Schedule broadcast) <span class="tip" data-tip="ว่าง = ส่งทันที">?</span></label><input type="datetime-local" id="ed-scheduled"><div class="hint">ว่าง = ส่งทันทีเมื่อกด Publish · ใส่ = scheduled</div></div>'
  +           '<div class="schedule-card"><label>วันที่มีผลบังคับใช้ <span class="tip" data-tip="ว่าง = ไม่ระบุ">?</span></label><input type="date" id="ed-effective-date"><div class="hint">เช่น นโยบายเริ่มใช้วันที่ ... (คนละอย่างกับวันประกาศ)</div></div>'
  +           '<div class="quiz-builder" id="quiz-builder-section"><h4>Quiz builder (custom คำถาม)</h4><div id="quiz-list"></div><button type="button" class="quiz-add" onclick="quizAdd()">+ เพิ่มคำถาม</button></div>'
  +         '</div>'
  +         '<div>'
  +           '<div class="editor-section">'
  +             '<div class="editor-section-title" id="es-targeting"></div>'
  +             '<div class="field"><label>สาขา (any of)</label><div class="chip-group" id="cg-branches"></div><div class="field-help">เว้นว่าง = ทุกสาขา</div></div>'
  +             '<div class="field"><label>ตำแหน่ง (any of)</label><div class="chip-group" id="cg-positions"></div></div>'
  +             '<div class="field"><label>แผนก (14 prefix)</label><div class="chip-group" id="cg-departments"></div><div class="field-help" style="color:#3DC5B7">prefix ของแผนกที่เลือก = prefix ของเลขประกาศ (auto)</div></div>'
  +             '<div class="field"><label>Tags (any of)</label><div class="chip-group" id="cg-tags"></div></div>'
  +             '<div class="field"><label>เพิ่ม/ยกเว้น เป็นรายคน</label><input type="search" id="ed-emp-search" placeholder="ค้นหาชื่อ/nickname..." oninput="filterEmpPicker()"><label style="display:flex;align-items:center;gap:6px;margin:6px 0;font-size:12px;font-weight:400;cursor:pointer"><input type="checkbox" id="ed-emp-permanent-only" checked onchange="filterEmpPicker()" style="width:auto;margin:0">เฉพาะพนักงานประจำ (กันติ๊กผิด)</label><div class="emp-picker" id="emp-picker"></div><div class="field-help">คลิก = include · Shift+คลิก = exclude · <span style="color:#B91C1C">● ไม่มี LINE = คนนั้นจะไม่ได้รับ</span></div></div>'
  +             '<div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-sm" onclick="previewTargets()" id="preview-btn" style="flex:1;justify-content:center"></button><button class="btn btn-sm btn-primary" onclick="previewLineFlex()" id="preview-line-btn" style="flex:1;justify-content:center">Preview LINE</button></div>'
  +             '<div id="line-flex-preview" style="display:none;margin-top:10px;padding:10px;background:#E0F2FE;border:1px solid #BFDBFE;border-radius:8px"><div style="font-size:11px;font-weight:600;color:#1E40AF;margin-bottom:6px">Preview ที่จะส่ง LINE</div><div id="line-flex-preview-body"></div></div>'
  +             '<div class="preview-card" id="preview-result" style="display:none"><div class="preview-title">จะส่งหา</div><div class="preview-count" id="pv-count">0</div><div class="preview-sub" id="pv-sub">— · — link LINE</div><ul class="preview-list" id="pv-list"></ul><div class="preview-warn" id="pv-warn" style="display:none"></div></div>'
  +           '</div>'
  +         '</div>'
  +       '</div>'
  +     '</div>'
  +     '<div class="modal-footer" style="justify-content:space-between">'
  +       '<div><button class="btn btn-icon-danger" id="ed-remove-btn" onclick="removeAnn()" style="display:none">ลบ</button><button class="btn" id="ed-archive-btn" onclick="archiveAnn()" style="display:none">Archive</button></div>'
  +       '<div style="display:flex;gap:6px"><button class="btn" onclick="closeEditor()">ยกเลิก</button><button class="btn" onclick="saveAnn(false)" id="save-btn"></button><button class="btn btn-primary" onclick="saveAnn(true)" id="publish-btn"></button></div>'
  +     '</div>'
  +   '</div>'
  + '</div>';
}

function AN2_RESEND_MODAL() {
  return ''
  + '<div class="modal-bg" id="resend-bg" onclick="if(event.target===this)closeResend()">'
  +   '<div class="modal" style="max-width:600px">'
  +     '<div class="modal-header"><h2 style="margin:0;font-size:15px">ส่งซ้ำประกาศ <span id="r-ann-id" style="color:#3DC5B7;font-family:monospace"></span></h2><p style="margin:4px 0 0 0;font-size:11px;color:#64748B">เลือก mode หรือกำหนดเอง · ระบบจะ push flex LINE ใหม่</p></div>'
  +     '<div class="modal-body">'
  +       '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">'
  +         '<label class="r-mode-card" data-mode="all"><input type="radio" name="r-mode" value="all" checked><div><strong>ทุกคนเดิม</strong><br><span style="font-size:11px;color:#64748B" id="r-count-all">— คน</span></div></label>'
  +         '<label class="r-mode-card" data-mode="unacked"><input type="radio" name="r-mode" value="unacked"><div><strong>เฉพาะคนที่ยังไม่ ack</strong><br><span style="font-size:11px;color:#64748B" id="r-count-unacked">— คน</span></div></label>'
  +         '<label class="r-mode-card" data-mode="unopened"><input type="radio" name="r-mode" value="unopened"><div><strong>เฉพาะคนที่ยังไม่อ่าน</strong><br><span style="font-size:11px;color:#64748B" id="r-count-unopened">— คน</span></div></label>'
  +         '<label class="r-mode-card" data-mode="custom"><input type="radio" name="r-mode" value="custom"><div><strong>เลือกใหม่</strong><br><span style="font-size:11px;color:#64748B">เลือก สาขา/แผนก/ตำแหน่ง/รายคน</span></div></label>'
  +       '</div>'
  +       '<div id="r-custom-panel" style="display:none;padding:12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px">'
  +         '<div style="font-size:11px;color:#475569;margin-bottom:8px;font-weight:500">เลือก target ใหม่ (multi-criteria)</div>'
  +         '<div class="field"><label style="font-size:10px;color:#64748B">สาขา</label><div class="chip-group" id="r-cg-branches" style="min-height:28px"></div></div>'
  +         '<div class="field"><label style="font-size:10px;color:#64748B">ตำแหน่ง</label><div class="chip-group" id="r-cg-positions" style="min-height:28px"></div></div>'
  +         '<div class="field"><label style="font-size:10px;color:#64748B">แผนก (prefix)</label><div class="chip-group" id="r-cg-departments" style="min-height:28px"></div></div>'
  +         '<div class="field"><label style="font-size:10px;color:#64748B">เพิ่ม/ยกเว้น เป็นรายคน</label><input type="search" id="r-emp-search" placeholder="ค้นหาชื่อ/nickname..." oninput="rFilterEmp()" style="padding:5px 8px;font-size:11px;width:100%"><div class="emp-picker" id="r-emp-picker" style="max-height:160px;overflow-y:auto"></div><div class="field-help">คลิก = include · Shift+คลิก = exclude</div></div>'
  +       '</div>'
  +       '<div style="margin-top:12px;padding:8px 10px;background:#DBEAFE;border:1px solid #93C5FD;border-radius:5px;font-size:11px;color:#1E40AF" id="r-preview">จะส่งหา <strong id="r-final-count">0</strong> คน</div>'
  +     '</div>'
  +     '<div class="modal-footer"><button class="btn" onclick="closeResend()">ยกเลิก</button><button class="btn btn-primary" onclick="confirmResend()" id="r-send-btn">ส่งซ้ำ</button></div>'
  +   '</div>'
  + '</div>';
}

function AN2_DETAIL_MODAL() {
  return ''
  + '<div class="modal-bg" id="detail-bg" onclick="if(event.target===this)closeDetail()">'
  +   '<div class="modal" style="max-width:720px">'
  +     '<div class="modal-header" style="background:linear-gradient(135deg,#ECFEFF 0%,#F0FDFA 100%);border-bottom:1px solid #A5F3FC"><div style="display:flex;align-items:flex-start;gap:14px"><div style="flex-shrink:0;padding:10px 14px;background:#3DC5B7;color:#fff;border-radius:8px;font-family:monospace;font-weight:700;font-size:15px;letter-spacing:.5px" id="d-ann-id-badge">A-XXX/2026</div><div style="flex:1;min-width:0"><h2 id="d-title" style="margin:0;font-size:16px;color:#0D2F4F">Detail</h2><p id="d-sub" style="margin:4px 0 0 0;font-size:11px;color:#475569">—</p></div></div></div>'
  +     '<div class="modal-body">'
  +       '<div class="stat-row" id="d-stats"></div>'
  +       '<div style="margin-bottom:14px"><div class="editor-section-title">เนื้อหา</div><div id="d-body" style="white-space:pre-wrap;font-size:13px;line-height:1.6;background:#F8FAFC;padding:12px;border-radius:6px"></div></div>'
  +       '<div><div class="editor-section-title">Target list</div><div class="target-list" id="d-targets"></div></div>'
  +     '</div>'
  +     '<div class="modal-footer" style="justify-content:space-between"><div style="display:flex;gap:6px"><button class="btn" id="d-remind-btn" onclick="remindUnacked()" style="display:none">เตือนคนที่ยังไม่ ack</button><button class="btn" id="d-resend-btn" onclick="resendAnnouncement()" title="ส่งซ้ำ flex LINE">ส่งซ้ำ</button></div><div style="display:flex;gap:6px"><button class="btn" onclick="closeDetail()">ปิด</button><button class="btn" onclick="editFromDetail()" id="d-edit-btn">แก้ไข</button></div></div>'
  +   '</div>'
  + '</div>';
}
