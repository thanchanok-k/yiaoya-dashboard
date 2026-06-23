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

/* ============================================================
   AN2_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → ANN_BACKEND
   helper จาก _shared_scripts (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function AN2_RUN_PAGE_JS() {

  // ---- google.script.run shim → ANN_BACKEND (async, คืน shape เดิม) ----
  function _an2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function(){}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (ANN_BACKEND[prop]) {
            Promise.resolve().then(function () { return ANN_BACKEND[prop].apply(ANN_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[ANN_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[ANN_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _an2MakeChain(); } });

  // ---- helpers จาก _shared_scripts (inline) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('an2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'an2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.an2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('an-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'an-help-modal-bg'; bg.className = 'modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.classList.remove('active'); bg.style.display = (bg.classList.contains('active')) ? 'flex' : 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const cls = s.type === 'warn' ? 'help-section-warn' : '';
      const items = (s.items || []).map(it => '<li>' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div class="help-section ' + cls + '" style="background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid #CBD5E1"><div class="help-section-title" style="font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div class="modal" style="max-width:600px;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div class="modal-header" style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'an-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div class="modal-body" style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div class="modal-footer" style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'an-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.classList.add('active'); bg.style.display = 'flex';
  }

  /* ===== STATE (ลอกจากหน้าเดิม) ===== */
  let currentTab = 'all';
  let currentView = 'dashboard';
  let allData = null;
  let lookups = null;
  let filteredCache = [];
  let currentDetail = null;
  let IS_OWNER = false;
  let MY_ROLE = '';
  let editing = { branches: new Set(), positions: new Set(), departments: new Set(), tags: new Set(), employees: new Set(), exclude_employees: new Set() };
  const FILTERS = { category: [], position: [], branch: [], department: [], range: 'all' };

  const HELP = {
    title: 'Announcements v2',
    subtitle: 'ประกาศบริษัท · เก็บบน Supabase (events)',
    intro: 'เขียน → targeting → multicast LINE · ดูสถิติ 4 มุมมอง (Dashboard/Calendar/List/Analytics)',
    sections: [
      { title: '4 มุมมอง', items: ['<strong>Dashboard</strong> — สถิติรวม · trend · top/low · coverage', '<strong>Calendar</strong> — ปฏิทินรายเดือน · click วัน', '<strong>List</strong> — รายการ · sort ได้', '<strong>Analytics</strong> — engagement ตามตำแหน่ง/สาขา/แผนก/หมวด'] },
      { title: 'Multi-select filter', items: ['หมวด · ตำแหน่ง · สาขา · แผนก เลือกหลายอันได้', 'Filter apply ทุก view ทันที'] },
      { type: 'warn', title: 'ระวัง', items: ['บาง feature (อัปโหลด Drive · ส่ง LINE จริง) ยังไม่พร้อมบน dashboard → กดได้แต่จะแจ้งว่ายังไม่พร้อม', 'Archive ≠ Delete'] },
    ],
  };

  const CATEGORY_META = {
    permanent: { label: 'บอร์ดถาวร', cls: 'cat-policy', color: '#0D2F4F' },
    monthly: { label: 'บอร์ดประจำเดือน', cls: 'cat-activity', color: '#6D28D9' },
    policy: { label: 'นโยบาย/ระเบียบ', cls: 'cat-policy', color: '#1D4ED8' },
    welfare: { label: 'สวัสดิการ', cls: 'cat-welfare', color: '#2BA89B' },
    activity: { label: 'กิจกรรม/CSR', cls: 'cat-activity', color: '#6D28D9' },
    announcement: { label: 'แจ้งเตือนทั่วไป', cls: 'cat-general', color: '#94A3B8' },
    urgent: { label: 'ด่วน', cls: 'cat-urgent', color: '#B91C1C' },
    general: { label: 'ทั่วไป', cls: 'cat-general', color: '#94A3B8' },
    rule: { label: 'ระเบียบ', cls: 'cat-rule', color: '#B45309' },
  };
  function catMeta(id) { return CATEGORY_META[id] || { label: id || 'ทั่วไป', cls: 'cat-general', color: '#94A3B8' }; }

  /* ===== STATIC ICONS / LABELS ===== */
  document.getElementById('help-btn').innerHTML = ICONS.help;
  document.getElementById('new-btn').innerHTML = ICONS.plus + ' เขียนใหม่';
  document.getElementById('preview-btn').innerHTML = ICONS.users + ' Preview targets';
  document.getElementById('es-options').innerHTML = ICONS.settings + ' Options';
  document.getElementById('es-targeting').innerHTML = ICONS.users + ' Targeting (multi-criteria)';
  document.getElementById('es-images').innerHTML = ICONS.doc + ' Images & Send mode';

  /* ===== VIEW SWITCHER ===== */
  function setView(v) {
    currentView = v;
    document.querySelectorAll('#an .vs-tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    document.querySelectorAll('#an .view-section').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
    if (v === 'dashboard') renderDashboard();
    else if (v === 'calendar') renderCalendar();
    else if (v === 'list') renderListView();
    else if (v === 'analytics') renderAnalytics();
  }
  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#an .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    onFiltersChanged();
  }

  /* ===== MULTI-SELECT DROPDOWN ===== */
  function renderMs(field, items, labelKey) {
    const wrap = document.getElementById('ms-' + field);
    if (!wrap) return;
    const selected = FILTERS[field];
    const chips = selected.length
      ? selected.slice(0, 2).map(id => {
          const it = items.find(x => x.id === id);
          const label = it ? (it[labelKey] || it.id) : id;
          return '<span class="ms-chip-mini">' + escapeHtml(label) + '<span class="x" onclick="event.stopPropagation();msToggle(\'' + field + '\',\'' + escapeAttr(id) + '\')">×</span></span>';
        }).join('') + (selected.length > 2 ? '<span class="ms-chip-mini" style="background:var(--border);color:var(--text-muted)">+' + (selected.length - 2) + '</span>' : '')
      : '<span style="color:var(--text-faint)">เลือก…</span>';
    const optionsHtml = items.map(it => {
      const checked = selected.includes(it.id) ? 'checked' : '';
      const meta = it.count != null ? '<span class="opt-meta">' + it.count + '</span>' : '';
      return '<label class="ms-option" onclick="event.stopPropagation()"><input type="checkbox" ' + checked + ' onchange="msToggle(\'' + field + '\',\'' + escapeAttr(it.id) + '\')">' + escapeHtml(it[labelKey] || it.id) + meta + '</label>';
    }).join('');
    wrap.innerHTML = '<div class="ms-trigger ' + (selected.length ? '' : 'is-empty') + '" onclick="msToggleOpen(\'' + field + '\')">' + chips + '</div><div class="ms-panel"><div class="ms-actions"><span class="ms-action" onclick="msAll(\'' + field + '\')">เลือกทั้งหมด</span><span class="ms-action" onclick="msNone(\'' + field + '\')">ล้าง</span></div>' + optionsHtml + '</div>';
  }
  function msToggleOpen(field) { document.querySelectorAll('#an .ms-dropdown').forEach(d => { if (d.id === 'ms-' + field) d.classList.toggle('open'); else d.classList.remove('open'); }); }
  function msToggle(field, id) { const arr = FILTERS[field]; const idx = arr.indexOf(id); if (idx < 0) arr.push(id); else arr.splice(idx, 1); renderAllMs(); onFiltersChanged(); }
  function _getMsItems(field) {
    if (field === 'category') return getCategoryItems();
    if (field === 'position') return (lookups && lookups.positions) || [];
    if (field === 'branch') return (lookups && lookups.branches) || [];
    if (field === 'department') return (lookups && lookups.departments) || [];
    return [];
  }
  function msAll(field) { FILTERS[field] = _getMsItems(field).map(x => x.id); renderAllMs(); onFiltersChanged(); }
  function msNone(field) { FILTERS[field] = []; renderAllMs(); onFiltersChanged(); }
  function renderAllMs() {
    renderMs('category', getCategoryItems(), 'name');
    renderMs('position', (lookups && lookups.positions) || [], 'name');
    renderMs('branch', (lookups && lookups.branches) || [], 'name');
    renderMs('department', (lookups && lookups.departments) || [], 'name');
  }
  function getCategoryItems() {
    const seen = new Set();
    ((allData && allData.announcements) || []).forEach(a => seen.add(a.category));
    const list = Array.from(seen).filter(Boolean).map(id => ({ id: id, name: (CATEGORY_META[id] && CATEGORY_META[id].label) || id }));
    Object.keys(CATEGORY_META).forEach(id => { if (!list.find(x => x.id === id)) list.push({ id: id, name: CATEGORY_META[id].label }); });
    return list;
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('#an .ms-dropdown')) { document.querySelectorAll('#an .ms-dropdown').forEach(d => d.classList.remove('open')); } });
  function clearAllFilters() {
    FILTERS.category = []; FILTERS.position = []; FILTERS.branch = []; FILTERS.department = []; FILTERS.range = 'all';
    const s = document.getElementById('f-search'); if (s) s.value = '';
    const r = document.getElementById('f-range'); if (r) r.value = 'all';
    renderAllMs(); onFiltersChanged();
  }

  /* ===== CLIENT-SIDE FILTERING ===== */
  function applyClientFilters() {
    let list = ((allData && allData.announcements) || []).slice();
    const q = ((document.getElementById('f-search') || {}).value || '').toLowerCase();
    if (q) list = list.filter(a => (a.title || '').toLowerCase().includes(q) || (a.body_md || '').toLowerCase().includes(q) || (a.ann_id || '').toLowerCase().includes(q));
    if (FILTERS.category.length) list = list.filter(a => FILTERS.category.includes(a.category));
    if (FILTERS.position.length) list = list.filter(a => { const tp = a.target_positions || []; if (!tp.length) return true; return tp.some(p => FILTERS.position.includes(p)); });
    if (FILTERS.branch.length) list = list.filter(a => { const tb = a.target_branches || []; if (!tb.length) return true; return tb.some(b => FILTERS.branch.includes(b)); });
    if (FILTERS.department.length) list = list.filter(a => { const td = a.target_departments || []; if (!td.length) return true; return td.some(d => FILTERS.department.includes(d)); });
    const range = (document.getElementById('f-range') || {}).value || 'all';
    if (range !== 'all') {
      const now = new Date(); let cutoff = new Date(now);
      if (range === 'month') cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
      else if (range === 'last30') cutoff.setDate(now.getDate() - 30);
      else if (range === 'last90') cutoff.setDate(now.getDate() - 90);
      else if (range === 'year') cutoff = new Date(now.getFullYear(), 0, 1);
      list = list.filter(a => { const t = a.published_at || a.created_at || a.scheduled_at; if (!t) return false; return new Date(t) >= cutoff; });
    }
    return list;
  }
  function onFiltersChanged() {
    filteredCache = applyClientFilters();
    const c = filteredCache;
    setText('cnt-all', c.length);
    setText('cnt-draft', c.filter(a => a.status === 'draft').length);
    setText('cnt-scheduled', c.filter(a => a.status === 'scheduled').length);
    setText('cnt-published', c.filter(a => a.status === 'published').length);
    setText('cnt-archived', c.filter(a => a.status === 'archived').length);
    const ct = document.getElementById('ct-announce'); if (ct) ct.textContent = ((allData && allData.announcements) || []).length || '';
    if (currentView === 'dashboard') renderDashboard();
    else if (currentView === 'calendar') renderCalendar();
    else if (currentView === 'list') renderListView();
    else if (currentView === 'analytics') renderAnalytics();
  }
  function _statusFiltered() {
    let base = IS_OWNER ? filteredCache : filteredCache.filter(a => a.status !== 'archived');
    if (currentTab === 'all') return base;
    return base.filter(a => a.status === currentTab);
  }

  /* ===== DATA LOAD ===== */
  function loadList() {
    if (currentView === 'list') { const el = document.getElementById('content'); if (el) el.innerHTML = '<div class="empty"><div class="empty-title">กำลังโหลด...</div></div>'; }
    google.script.run
      .withSuccessHandler(d => { allData = d; lookups = d.lookups || null; renderAllMs(); onFiltersChanged(); })
      .withFailureHandler(e => { const el = document.getElementById('content'); if (el) el.innerHTML = '<div class="empty"><div class="empty-title">โหลดไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml(e && e.message ? e.message : e) + '</div></div>'; })
      .annAdminList({ tab: 'all' });
  }
  function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

  /* ===== DASHBOARD RENDER ===== */
  function renderDashboard() {
    const list = _statusFiltered();
    const pub = list.filter(a => a.status === 'published');
    setText('d-total', list.length);
    setText('d-published', list.filter(a => a.status === 'published').length);
    setText('d-draft', list.filter(a => a.status === 'draft').length);
    const totalReached = pub.reduce((s, a) => s + (a.target_count || 0), 0);
    setText('d-published-sub', 'ส่งแล้ว · ' + totalReached + ' คน');
    const drafts = list.filter(a => a.status === 'draft');
    if (drafts.length) {
      const ages = drafts.map(a => { const t = a.created_at; if (!t) return 0; return Math.floor((Date.now() - new Date(t).getTime()) / 86400000); });
      setText('d-draft-sub', 'รอ publish · เก่าสุด ' + Math.max(...ages) + ' วัน');
    } else setText('d-draft-sub', 'ไม่มี draft');
    const avgOpen = pub.length ? Math.round(pub.reduce((s, a) => s + (a.open_rate || 0), 0) / pub.length) : 0;
    const avgAck = pub.length ? Math.round(pub.reduce((s, a) => s + (a.ack_rate || 0), 0) / pub.length) : 0;
    setText('d-open', avgOpen); setText('d-ack', avgAck);
    setText('d-ack-sub', avgAck >= 80 ? 'ดีมาก' : avgAck >= 60 ? 'ใช้ได้' : 'ต้องตาม');
    // trend sparkline
    const months = [], labels = []; const now = new Date();
    const TH_MO = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ y: d.getFullYear(), m: d.getMonth() }); labels.push(TH_MO[d.getMonth()]); }
    const counts = months.map(({ y, m }) => list.filter(a => { const t = a.published_at || a.created_at; if (!t) return false; const dt = new Date(t); return dt.getFullYear() === y && dt.getMonth() === m; }).length);
    const maxC = Math.max(1, ...counts); const W = 600, H = 80, PAD = 10;
    const stepX = (W - PAD * 2) / Math.max(1, counts.length - 1);
    const pts = counts.map((c, i) => { const x = PAD + i * stepX; const y = H - PAD - (c / maxC) * (H - PAD * 2); return [x, y]; });
    const lineD = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const areaD = lineD + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - PAD) + ' L' + pts[0][0].toFixed(1) + ' ' + (H - PAD) + ' Z';
    const dots = pts.map(p => '<circle fill="#3DC5B7" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3"/>').join('');
    const numLabels = pts.map((p, i) => '<text x="' + p[0].toFixed(1) + '" y="' + Math.max(p[1] - 6, 12).toFixed(1) + '" text-anchor="middle" font-size="10" fill="#0D2F4F" font-weight="700">' + counts[i] + '</text>').join('');
    document.getElementById('spark-trend').innerHTML = '<defs><linearGradient id="sparkGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#3DC5B7" stop-opacity="0.45"/><stop offset="100%" stop-color="#3DC5B7" stop-opacity="0"/></linearGradient></defs><path d="' + areaD + '" fill="url(#sparkGrad)"/><path class="line" d="' + lineD + '"/>' + dots + numLabels;
    document.getElementById('spark-labels').innerHTML = labels.map(l => '<span>' + l + '</span>').join('');
    // compliance ring
    const ackRequired = pub.filter(a => a.requires_ack);
    const totalAckTarget = ackRequired.reduce((s, a) => s + (a.target_count || 0), 0);
    const totalAcked = ackRequired.reduce((s, a) => s + (a.ack_count || 0), 0);
    const ringPct = totalAckTarget > 0 ? Math.round(totalAcked / totalAckTarget * 100) : 0;
    const circ = 2 * Math.PI * 42;
    document.getElementById('ring-fill').setAttribute('stroke-dasharray', circ.toFixed(1));
    document.getElementById('ring-fill').setAttribute('stroke-dashoffset', (circ * (1 - ringPct / 100)).toFixed(1));
    const ringFill = document.getElementById('ring-fill'); ringFill.classList.remove('warn', 'poor');
    if (ringPct < 60) ringFill.classList.add('poor'); else if (ringPct < 80) ringFill.classList.add('warn');
    setText('ring-num', ringPct + '%'); setText('ring-lbl', totalAcked + ' / ' + totalAckTarget + ' คน');
    const unacked = totalAckTarget - totalAcked;
    document.getElementById('compliance-detail').innerHTML = 'ประกาศที่ต้อง ack · ' + ackRequired.length + ' รายการ<br>' + (unacked > 0 ? '<strong style="color:var(--warning)">' + unacked + ' คน</strong> ยังไม่ acknowledge' : '<strong style="color:var(--success)">ทุกคน ack ครบแล้ว</strong>');
    // quick stats
    const quizzes = pub.filter(a => a.requires_quiz);
    const scheduledNext = list.filter(a => a.status === 'scheduled' && a.scheduled_at).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0];
    const nextSchedText = scheduledNext ? new Date(scheduledNext.scheduled_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const senders = {}; pub.forEach(a => { senders[a.created_by || '—'] = (senders[a.created_by || '—'] || 0) + 1; });
    const topSender = Object.entries(senders).sort((a, b) => b[1] - a[1])[0];
    document.getElementById('quick-stats').innerHTML = [
      '<div class="qs-row"><span class="lbl">ประกาศที่มี Quiz</span><span class="val success">' + quizzes.length + '</span></div>',
      '<div class="qs-row"><span class="lbl">Total reach (published)</span><span class="val">' + totalReached + ' คน</span></div>',
      '<div class="qs-row"><span class="lbl">ประกาศต้อง Ack</span><span class="val">' + ackRequired.length + '</span></div>',
      '<div class="qs-row"><span class="lbl">Most active sender</span><span class="val">' + escapeHtml(topSender ? topSender[0] : '—') + '</span></div>',
      '<div class="qs-row"><span class="lbl">Scheduled ครั้งถัดไป</span><span class="val teal">' + nextSchedText + '</span></div>',
    ].join('');
    // top / low performers
    const top = pub.slice().sort((a, b) => b.ack_rate - a.ack_rate).slice(0, 5);
    const low = pub.slice().sort((a, b) => a.ack_rate - b.ack_rate).slice(0, 5);
    const renderPerf = items => items.length ? items.map(a => {
      const cls = a.ack_rate >= 85 ? 'good' : a.ack_rate < 60 ? 'warn' : '';
      return '<div class="perf-row ' + cls + '" onclick="openDetail(\'' + escapeAttr(a.ann_id) + '\')"><div><div class="title">' + escapeHtml(a.title) + '</div><div class="meta">' + escapeHtml(a.ann_id) + ' · ' + escapeHtml(a.targets_summary || '—') + '</div></div><div><div class="score">' + a.ack_rate + '%</div><div class="score-sub">ack ' + a.ack_count + '/' + a.target_count + '</div></div></div>';
    }).join('') : '<div class="perf-empty">ยังไม่มี published</div>';
    document.getElementById('perf-top').innerHTML = renderPerf(top);
    document.getElementById('perf-low').innerHTML = renderPerf(low);
    // category breakdown
    const catCounts = {}; list.forEach(a => { catCounts[a.category] = (catCounts[a.category] || 0) + 1; });
    const catData = Object.keys(catCounts).map(id => ({ label: catMeta(id).label, color: catMeta(id).color, count: catCounts[id] })).sort((a, b) => b.count - a.count);
    const catMax = Math.max(1, ...catData.map(x => x.count));
    document.getElementById('cat-breakdown').innerHTML = catData.length ? catData.map(c => '<div class="bar-row"><div class="lbl">' + escapeHtml(c.label) + '</div><div class="bar-track"><div class="fill" style="width:' + (c.count / catMax * 100) + '%;background:' + c.color + '">' + (c.count > 0 ? c.count : '') + '</div></div><div class="cnt">' + c.count + '</div></div>').join('') : '<div class="perf-empty">ยังไม่มีประกาศ</div>';
    // heatmap branch
    const branchAgg = {}; pub.forEach(a => { (a.target_branches || []).forEach(b => { if (!branchAgg[b]) branchAgg[b] = { reach: 0, opened: 0 }; branchAgg[b].reach += (a.target_count || 0); branchAgg[b].opened += (a.read_count || 0); }); });
    const branches = (lookups && lookups.branches) || [];
    const hmBranch = branches.map(b => { const a = branchAgg[b.id]; const rate = a && a.reach > 0 ? Math.round(a.opened / a.reach * 100) : 0; return { lbl: b.name || b.id, val: rate }; }).filter(r => r.val > 0 || (branches.length <= 10));
    document.getElementById('heatmap-branch').innerHTML = hmBranch.length ? hmBranch.map(r => { const cls = r.val >= 80 ? '' : r.val >= 60 ? 'warn' : 'poor'; return '<div class="hm-row"><div class="lbl">' + escapeHtml(r.lbl) + '</div><div class="hm-bar"><div class="fill ' + cls + '" style="width:' + r.val + '%"></div></div><div class="val">' + r.val + '%</div></div>'; }).join('') : '<div class="perf-empty">ไม่มีข้อมูล coverage</div>';
    // heatmap position
    const posAgg = {}; pub.forEach(a => { (a.target_positions || []).forEach(p => { if (!posAgg[p]) posAgg[p] = { reach: 0, acked: 0 }; posAgg[p].reach += (a.target_count || 0); posAgg[p].acked += (a.ack_count || 0); }); });
    const positions = (lookups && lookups.positions) || [];
    const hmPos = positions.map(p => { const a = posAgg[p.id]; const rate = a && a.reach > 0 ? Math.round(a.acked / a.reach * 100) : 0; return { lbl: p.name || p.id, val: rate }; }).filter(r => r.val > 0).slice(0, 10);
    document.getElementById('heatmap-position').innerHTML = hmPos.length ? hmPos.map(r => { const cls = r.val >= 80 ? '' : r.val >= 60 ? 'warn' : 'poor'; return '<div class="hm-row"><div class="lbl">' + escapeHtml(r.lbl) + '</div><div class="hm-bar"><div class="fill ' + cls + '" style="width:' + r.val + '%"></div></div><div class="val">' + r.val + '%</div></div>'; }).join('') : '<div class="perf-empty">ไม่มีข้อมูล coverage</div>';
  }

  /* ===== CALENDAR ===== */
  let CAL_DATE = new Date(); CAL_DATE.setDate(1);
  const TH_MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  function calPrev() { CAL_DATE = new Date(CAL_DATE.getFullYear(), CAL_DATE.getMonth() - 1, 1); renderCalendar(); }
  function calNext() { CAL_DATE = new Date(CAL_DATE.getFullYear(), CAL_DATE.getMonth() + 1, 1); renderCalendar(); }
  function calToday() { CAL_DATE = new Date(); CAL_DATE.setDate(1); renderCalendar(); const t = new Date(); selectDay(t.getFullYear(), t.getMonth(), t.getDate()); }
  function renderCalendar() {
    const list = _statusFiltered();
    const y = CAL_DATE.getFullYear(), m = CAL_DATE.getMonth();
    document.getElementById('cal-month-label').textContent = TH_MONTHS_FULL[m] + ' ' + (y + 543);
    const first = new Date(y, m, 1); let startDay = first.getDay() - 1; if (startDay < 0) startDay = 6;
    const daysInMonth = new Date(y, m + 1, 0).getDate(); const prevDays = new Date(y, m, 0).getDate(); const today = new Date();
    const byDay = {};
    list.forEach(a => { const t = a.published_at || a.scheduled_at || (a.status === 'draft' ? a.created_at : ''); if (!t) return; const d = new Date(t); if (d.getFullYear() !== y || d.getMonth() !== m) return; const key = d.getDate(); if (!byDay[key]) byDay[key] = []; byDay[key].push(a); });
    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push({ day: prevDays - startDay + i + 1, otherMonth: true });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d });
    let nextDay = 1; while (cells.length % 7 !== 0) cells.push({ day: nextDay++, otherMonth: true });
    const html = cells.map((c, idx) => {
      const isWeekend = (idx % 7 >= 5);
      const isToday = !c.otherMonth && c.day === today.getDate() && y === today.getFullYear() && m === today.getMonth();
      const evs = c.otherMonth ? [] : (byDay[c.day] || []);
      const evHtml = evs.slice(0, 3).map(a => '<div class="cal-event ' + catMeta(a.category).cls + (a.status === 'draft' ? ' draft' : '') + '" title="' + escapeAttr(a.title) + '">' + escapeHtml(a.title) + '</div>').join('');
      const more = evs.length > 3 ? '<div class="cal-more">+' + (evs.length - 3) + ' อื่น ๆ</div>' : '';
      return '<div class="cal-cell' + (c.otherMonth ? ' other-month' : '') + (isWeekend ? ' weekend' : '') + (isToday ? ' today' : '') + '"' + (!c.otherMonth ? ' onclick="selectDay(' + y + ',' + m + ',' + c.day + ')"' : '') + '><div class="day-num">' + c.day + '</div><div class="day-events">' + evHtml + more + '</div></div>';
    }).join('');
    document.getElementById('cal-grid').innerHTML = html;
  }
  function selectDay(y, m, d) {
    const list = _statusFiltered();
    const evs = list.filter(a => { const t = a.published_at || a.scheduled_at || (a.status === 'draft' ? a.created_at : ''); if (!t) return false; const dt = new Date(t); return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d; });
    const det = document.getElementById('day-detail');
    const dateStr = d + ' ' + TH_MONTHS_FULL[m] + ' ' + (y + 543);
    let html = '<div class="dd-title">ประกาศของวันนี้</div><div class="dd-date">' + dateStr + '</div>';
    if (!evs.length) html += '<div class="dd-empty">ไม่มีประกาศในวันนี้</div>';
    else {
      html += '<div class="dd-list">' + evs.map(a => {
        const c = catMeta(a.category);
        const cBg = c.cls === 'cat-policy' ? 'var(--info-bg)' : c.cls === 'cat-welfare' ? '#E6F7F5' : c.cls === 'cat-activity' ? 'var(--c-company-bg)' : c.cls === 'cat-urgent' ? 'var(--danger-bg)' : c.cls === 'cat-rule' ? 'var(--warning-bg)' : 'var(--border)';
        return '<div class="dd-item" onclick="openDetail(\'' + escapeAttr(a.ann_id) + '\')"><span class="cat" style="background:' + cBg + ';color:' + c.color + '">' + escapeHtml(c.label) + ' · ' + a.status + '</span><div class="ttl">' + escapeHtml(a.title) + '</div><div class="meta"><span>' + escapeHtml(a.ann_id) + '</span>' + (a.status === 'published' ? '<span>ack ' + a.ack_rate + '% <span class="ack-bar"><span class="f" style="width:' + a.ack_rate + '%"></span></span></span>' : '') + (a.target_count > 0 ? '<span>' + a.target_count + ' คน</span>' : '') + (a.requires_ack ? '<span style="color:#BE185D">ต้อง ack</span>' : '') + (a.requires_quiz ? '<span style="color:var(--success)">มี quiz</span>' : '') + '</div></div>';
      }).join('') + '</div>';
    }
    det.innerHTML = html;
  }

  /* ===== LIST VIEW ===== */
  function renderListView() {
    let list = _statusFiltered();
    document.getElementById('content').classList.remove('loading');
    document.getElementById('list-count').textContent = '— ' + list.length + ' รายการ';
    if (!list.length) {
      document.getElementById('content').innerHTML = '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><div class="empty-title">ไม่มีประกาศตรง filter นี้</div><div class="empty-sub">กดปุ่ม X เพื่อล้างทุกตัวกรอง · หรือ "เขียนใหม่"</div></div>';
      return;
    }
    const sort = (document.getElementById('f-sort') || {}).value || 'newest';
    list = list.slice();
    if (sort === 'newest') list.sort((a, b) => (b.published_at || b.created_at || '').localeCompare(a.published_at || a.created_at || ''));
    else if (sort === 'oldest') list.sort((a, b) => (a.published_at || a.created_at || '').localeCompare(b.published_at || b.created_at || ''));
    else if (sort === 'ack-high') list.sort((a, b) => b.ack_rate - a.ack_rate);
    else if (sort === 'ack-low') list.sort((a, b) => a.ack_rate - b.ack_rate);
    else if (sort === 'target-high') list.sort((a, b) => b.target_count - a.target_count);
    document.getElementById('content').innerHTML = '<div class="ann-grid">' + list.map(a => {
      const rateColor = a.ack_rate >= 80 ? '' : a.ack_rate >= 50 ? 'low' : 'poor';
      const dateStr = a.published_at ? new Date(a.published_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : a.scheduled_at ? 'sched: ' + new Date(a.scheduled_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : a.created_at ? 'draft: ' + new Date(a.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '';
      const c = catMeta(a.category); const flags = [];
      if (a.requires_ack) flags.push('<span class="meta-pill pill-ack">' + ICONS.check + ' ack</span>');
      if (a.requires_quiz) flags.push('<span class="meta-pill pill-quiz">quiz</span>');
      const ackInfo = a.status === 'published' ? ['<div class="stat-line"><strong>' + a.target_count + '</strong> targets</div>', '<div class="stat-line">Open <strong>' + a.open_rate + '%</strong> · Ack <strong>' + a.ack_rate + '%</strong></div>', '<div class="rate-bar"><div class="rate-fill ' + rateColor + '" style="width:' + a.ack_rate + '%"></div></div>'].join('') : (a.status === 'scheduled' ? '<div class="stat-line" style="color:var(--warning)">รอ publish · ' + (a.scheduled_at ? new Date(a.scheduled_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '') + '</div>' : '<div class="stat-line" style="color:var(--text-faint)">ยังไม่ publish</div>');
      let delBtn = '';
      if (a.status === 'draft') delBtn = '<button class="card-del-btn" title="ลบ draft นี้" onclick="quickRemoveAnn(event, \'' + escapeAttr(a.ann_id) + '\')">' + ICONS.trash + ' ลบ</button>';
      else if (a.status === 'scheduled') delBtn = '<button class="card-del-btn" title="ลบประกาศที่ตั้งเวลาไว้" onclick="quickRemoveScheduled(event, \'' + escapeAttr(a.ann_id) + '\')">' + ICONS.trash + ' ลบ</button>';
      else if (a.status === 'published') delBtn = IS_OWNER ? '<button class="card-del-btn" title="ลบประกาศ (Owner)" onclick="ownerDeleteAnn(event, \'' + escapeAttr(a.ann_id) + '\')">' + ICONS.trash + ' ลบ</button>' : '<button class="card-del-btn" title="ขอลบประกาศนี้" onclick="requestRemoveAnn(event, \'' + escapeAttr(a.ann_id) + '\')">' + ICONS.trash + ' ขอลบ</button>';
      return '<div class="ann-card ' + a.status + '" onclick="openDetail(\'' + escapeAttr(a.ann_id) + '\')"><div><div class="ann-meta-row"><span class="meta-pill pill-st-' + a.status + '">' + a.status + '</span><span class="meta-pill pill-cat">' + escapeHtml(c.label) + '</span>' + flags.join('') + (dateStr ? '<span class="meta-pill pill-date">' + dateStr + '</span>' : '') + '</div><div class="ann-title">' + escapeHtml(a.title) + '</div><div class="ann-preview">' + escapeHtml(a.body_preview) + '</div><div class="ann-targets">' + ICONS.users + ' ' + escapeHtml(a.targets_summary) + ' · ' + (a.target_count || 0) + ' คน</div></div><div class="ann-stats">' + ackInfo + delBtn + '</div></div>';
    }).join('') + '</div>';
  }

  /* ===== ANALYTICS ===== */
  function renderAnalytics() {
    const list = _statusFiltered(); const pub = list.filter(a => a.status === 'published');
    const posAgg = {}; pub.forEach(a => { (a.target_positions || []).forEach(p => { if (!posAgg[p]) posAgg[p] = { reach: 0, opened: 0, acked: 0 }; posAgg[p].reach += (a.target_count || 0); posAgg[p].opened += (a.read_count || 0); posAgg[p].acked += (a.ack_count || 0); }); });
    const positions = (lookups && lookups.positions) || [];
    const posData = positions.map(p => { const a = posAgg[p.id] || { reach: 0, opened: 0, acked: 0 }; const ackRate = a.reach > 0 ? Math.round(a.acked / a.reach * 100) : 0; return { name: p.name || p.id, reach: a.reach, opened: a.opened, acked: a.acked, ackRate }; }).filter(r => r.reach > 0).sort((a, b) => b.ackRate - a.ackRate);
    setAnTable('an-position-body', posData);
    const brAgg = {}; pub.forEach(a => { (a.target_branches || []).forEach(b => { if (!brAgg[b]) brAgg[b] = { reach: 0, opened: 0, acked: 0 }; brAgg[b].reach += (a.target_count || 0); brAgg[b].opened += (a.read_count || 0); brAgg[b].acked += (a.ack_count || 0); }); });
    const branches = (lookups && lookups.branches) || [];
    const brData = branches.map(b => { const a = brAgg[b.id] || { reach: 0, opened: 0, acked: 0 }; const ackRate = a.reach > 0 ? Math.round(a.acked / a.reach * 100) : 0; return { name: b.name || b.id, reach: a.reach, opened: a.opened, acked: a.acked, ackRate }; }).filter(r => r.reach > 0).sort((a, b) => b.ackRate - a.ackRate);
    setAnTable('an-branch-body', brData);
    const depAgg = {}; pub.forEach(a => { (a.target_departments || []).forEach(d => { if (!depAgg[d]) depAgg[d] = { reach: 0, opened: 0, acked: 0 }; depAgg[d].reach += (a.target_count || 0); depAgg[d].opened += (a.read_count || 0); depAgg[d].acked += (a.ack_count || 0); }); });
    const departments = (lookups && lookups.departments) || [];
    const depData = departments.map(d => { const a = depAgg[d.id] || { reach: 0, opened: 0, acked: 0 }; const ackRate = a.reach > 0 ? Math.round(a.acked / a.reach * 100) : 0; return { name: d.name || d.id, reach: a.reach, opened: a.opened, acked: a.acked, ackRate }; }).filter(r => r.reach > 0).sort((a, b) => b.ackRate - a.ackRate);
    setAnTable('an-department-body', depData);
    const catAgg = {}; pub.forEach(a => { const id = a.category || 'general'; if (!catAgg[id]) catAgg[id] = { count: 0, openSum: 0, ackSum: 0 }; catAgg[id].count++; catAgg[id].openSum += (a.open_rate || 0); catAgg[id].ackSum += (a.ack_rate || 0); });
    const catTbody = document.getElementById('an-category-body');
    const catRows = Object.keys(catAgg).map(id => { const a = catAgg[id]; return { name: catMeta(id).label, count: a.count, openRate: Math.round(a.openSum / a.count), ackRate: Math.round(a.ackSum / a.count) }; }).sort((a, b) => b.ackRate - a.ackRate);
    catTbody.innerHTML = catRows.length ? catRows.map(r => '<tr><td>' + escapeHtml(r.name) + '</td><td>' + r.count + '</td><td>' + r.openRate + '%</td><td><span class="an-rate"><span class="bar"><span class="f" style="width:' + r.ackRate + '%;background:' + (r.ackRate >= 80 ? 'var(--success)' : r.ackRate >= 60 ? 'var(--warning)' : 'var(--danger)') + '"></span></span><span class="num">' + r.ackRate + '%</span></span></td></tr>').join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text-faint);padding:18px">ไม่มีข้อมูล</td></tr>';
  }
  function setAnTable(tbodyId, rows) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = rows.length ? rows.map(r => '<tr><td>' + escapeHtml(r.name) + '</td><td>' + r.reach + '</td><td>' + r.opened + '</td><td><span class="an-rate"><span class="bar"><span class="f" style="width:' + r.ackRate + '%;background:' + (r.ackRate >= 80 ? 'var(--success)' : r.ackRate >= 60 ? 'var(--warning)' : 'var(--danger)') + '"></span></span><span class="num">' + r.ackRate + '%</span></span></td></tr>').join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text-faint);padding:18px">ไม่มีข้อมูล</td></tr>';
  }

  /* ===== EDITOR / QUIZ / BLOCK EDITOR / UPLOAD / TARGETING ===== */
  let ANN_CATEGORIES = []; let ANN_PREFIXES = []; let QUIZ_DRAFT = [];
  function loadAnnPrefixes() {
    google.script.run.withSuccessHandler(list => { ANN_PREFIXES = list || []; if (lookups) renderChips(); }).withFailureHandler(e => console.warn('loadAnnPrefixes', e)).annAdminGetPrefixes();
  }
  function quizAdd() { QUIZ_DRAFT.push({ q: '', choices: ['', '', '', ''], correct: 0 }); renderQuizDraft(); }
  function quizRemove(idx) { QUIZ_DRAFT.splice(idx, 1); renderQuizDraft(); }
  function quizUpdate(idx, key, val, choiceIdx) { if (key === 'q') QUIZ_DRAFT[idx].q = val; else if (key === 'choice') QUIZ_DRAFT[idx].choices[choiceIdx] = val; else if (key === 'correct') QUIZ_DRAFT[idx].correct = parseInt(val, 10); }
  function renderQuizDraft() {
    const wrap = document.getElementById('quiz-list'); if (!wrap) return;
    if (!QUIZ_DRAFT.length) { wrap.innerHTML = '<div style="font-size:11px;color:#94A3B8;padding:4px">ยังไม่มีคำถาม · กด "+ เพิ่มคำถาม"</div>'; return; }
    wrap.innerHTML = QUIZ_DRAFT.map((q, i) => {
      const choices = q.choices.map((c, j) => '<label style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><input type="radio" name="qc' + i + '" value="' + j + '"' + (q.correct === j ? ' checked' : '') + ' onchange="quizUpdate(' + i + ',\'correct\',this.value)" style="width:auto"><input type="text" value="' + escapeAttr(c) + '" placeholder="ตัวเลือก ' + (j + 1) + '" oninput="quizUpdate(' + i + ',\'choice\',this.value,' + j + ')" style="flex:1;padding:3px 6px;font-size:11px;border:0.5px solid #E2E8F0;border-radius:3px"></label>').join('');
      return '<div class="quiz-item"><div style="display:flex;gap:4px;align-items:center;margin-bottom:5px"><strong style="font-size:11px;color:#0E7490">ข้อ ' + (i + 1) + '</strong><span style="flex:1"></span><button type="button" onclick="quizRemove(' + i + ')" style="padding:2px 7px;background:#FEE2E2;color:#991B1B;border:0;border-radius:3px;font-size:10px;cursor:pointer">ลบ</button></div><input type="text" value="' + escapeAttr(q.q) + '" placeholder="พิมพ์คำถาม..." oninput="quizUpdate(' + i + ',\'q\',this.value)"><div style="margin-top:4px">' + choices + '</div></div>';
    }).join('');
  }
  function loadAnnCategories() {
    google.script.run.withSuccessHandler(list => { ANN_CATEGORIES = list || []; const sel = document.getElementById('ed-category'); sel.innerHTML = ANN_CATEGORIES.map(c => '<option value="' + c.value + '" title="' + (c.desc || '') + '">' + c.label + '</option>').join(''); }).withFailureHandler(e => console.warn('loadAnnCategories', e)).annAdminGetCategories();
  }
  function loadAnnIdPreview() {
    google.script.run.withSuccessHandler(r => { if (r && r.next_id) { const el = document.getElementById('ed-ann-id-preview'); el.textContent = r.next_id + ' · ' + (r.prefix_label || r.prefix); } }).withFailureHandler(e => console.warn('previewNextAnnId', e)).annAdminPreviewNextAnnId({ target_departments: Array.from(editing.departments) });
  }
  // block editor
  let edBlocks = []; let edActiveTA = null;
  function edEscape(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function edSplitRow(line) { return line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()); }
  function edNormRows(rows) { const w = Math.max.apply(null, rows.map(r => r.length)); return rows.map(r => { const c = r.slice(); while (c.length < w) c.push(''); return c; }); }
  function edParse(md) {
    const lines = String(md || '').split('\n'); const out = []; let i = 0, buf = [];
    const flush = () => { if (buf.length) { out.push({ type: 'text', text: buf.join('\n').replace(/^\n+|\n+$/g, '') }); buf = []; } };
    while (i < lines.length) {
      if (/^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?[\s:|\-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        flush(); const rows = [edSplitRow(lines[i])]; i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(edSplitRow(lines[i])); i++; }
        out.push({ type: 'table', rows: edNormRows(rows) });
      } else { buf.push(lines[i]); i++; }
    }
    flush(); if (!out.length) out.push({ type: 'text', text: '' }); return out;
  }
  function edSerialize() {
    const parts = [];
    edBlocks.forEach(b => { if (b.type === 'text') { if ((b.text || '').trim() !== '') parts.push(b.text); } else { const rows = b.rows; const md = rows.map(r => '| ' + r.join(' | ') + ' |'); md.splice(1, 0, '|' + rows[0].map(() => '---').join('|') + '|'); parts.push(md.join('\n')); } });
    return parts.join('\n\n');
  }
  function edSync() { document.getElementById('ed-body').value = edSerialize(); }
  function edLoadFromHidden() { edBlocks = edParse(document.getElementById('ed-body').value); edActiveTA = null; edRender(); edSync(); }
  function edRender() {
    const root = document.getElementById('ed-blocks'); if (!root) return; root.innerHTML = '';
    edBlocks.forEach((b, bi) => {
      const div = document.createElement('div'); div.className = 'ed-block';
      if (b.type === 'text') {
        const ta = document.createElement('textarea'); ta.className = 'ed-txt'; ta.placeholder = 'พิมพ์ข้อความ...'; ta.value = b.text || ''; ta.dataset.bi = bi;
        ta.addEventListener('focus', () => { edActiveTA = ta; });
        ta.addEventListener('input', () => { edBlocks[ta.dataset.bi].text = ta.value; edAutosize(ta); edSync(); });
        ta.addEventListener('keydown', edTextKeydown);
        ta.addEventListener('paste', edTextPaste);
        const del = document.createElement('button'); del.type = 'button'; del.className = 'ed-del'; del.title = 'ลบบล็อก'; del.textContent = '×'; del.onclick = () => edDeleteBlock(bi);
        div.appendChild(ta); div.appendChild(del); setTimeout(() => edAutosize(ta), 0);
      } else {
        div.innerHTML = edTableHtml(b, bi);
        const del = document.createElement('button'); del.type = 'button'; del.className = 'ed-del'; del.title = 'ลบตาราง'; del.textContent = '×'; del.onclick = () => edDeleteBlock(bi);
        div.appendChild(del);
      }
      root.appendChild(div);
    });
    root.querySelectorAll('[data-cell]').forEach(cell => { cell.addEventListener('input', () => { const p = cell.dataset.cell.split('-').map(Number); edBlocks[p[0]].rows[p[1]][p[2]] = cell.textContent; edSync(); }); });
  }
  function edTableHtml(b, bi) {
    let h = '<div class="ed-tlabel">▦ ตาราง</div><div class="ed-grid-wrap"><table class="ed-grid"><tbody>';
    b.rows.forEach((row, r) => { h += '<tr class="' + (r === 0 ? 'head' : '') + '">'; row.forEach((c, ci) => { h += '<td><div class="ed-cell" contenteditable="true" data-cell="' + bi + '-' + r + '-' + ci + '">' + edEscape(c) + '</div></td>'; }); h += '</tr>'; });
    h += '</tbody></table><button type="button" class="ed-addcol" title="เพิ่มคอลัมน์" onclick="edAddCol(' + bi + ')">+</button><button type="button" class="ed-addrow" title="เพิ่มแถว" onclick="edAddRow(' + bi + ')">+</button></div><div class="ed-tbl-tools"><button type="button" class="danger" onclick="edDelCol(' + bi + ')">– คอลัมน์</button><button type="button" class="danger" onclick="edDelRow(' + bi + ')">– แถว</button></div>';
    return h;
  }
  function edTextPaste(e) {
    const cb = e.clipboardData || window.clipboardData; if (!cb) return;
    const txt = cb.getData('text'); if (!txt || txt.indexOf('\t') < 0) return;
    const lines = txt.replace(/\s+$/, '').split('\n').filter(l => l.length);
    if (!(lines.length >= 2 || (lines.length === 1 && /\t/.test(lines[0])))) return;
    e.preventDefault();
    const rows = lines.map(l => l.split('\t').map(c => c.trim()));
    const bi = parseInt(e.target.dataset.bi, 10); const at = isNaN(bi) ? edBlocks.length : bi + 1;
    edBlocks.splice(at, 0, { type: 'table', rows: edNormRows(rows) }); edActiveTA = null; edRender(); edSync();
    showToast('วางเป็นตารางให้แล้ว · แก้ในช่องได้เลย', 'success');
  }
  function edAutosize(ta) { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight) + 'px'; }
  function edTextKeydown(e) { if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); rtFormat('bold'); } else if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); rtFormat('italic'); } }
  function edEnsureActiveTA() {
    if (edActiveTA && document.body.contains(edActiveTA)) return edActiveTA;
    let idx = -1; for (let i = edBlocks.length - 1; i >= 0; i--) { if (edBlocks[i].type === 'text') { idx = i; break; } }
    if (idx < 0) { edBlocks.push({ type: 'text', text: '' }); edRender(); edSync(); idx = edBlocks.length - 1; }
    const ta = document.querySelector('#an .ed-txt[data-bi="' + idx + '"]'); if (ta) { ta.focus(); edActiveTA = ta; }
    return edActiveTA;
  }
  function edAddCol(bi) { edBlocks[bi].rows.forEach((r, i) => r.push(i === 0 ? 'คอลัมน์ ' + (r.length + 1) : '')); edRender(); edSync(); }
  function edDelCol(bi) { const t = edBlocks[bi].rows; if (t[0].length > 1) { t.forEach(r => r.pop()); edRender(); edSync(); } }
  function edAddRow(bi) { const w = edBlocks[bi].rows[0].length; edBlocks[bi].rows.push(new Array(w).fill('')); edRender(); edSync(); }
  function edDelRow(bi) { if (edBlocks[bi].rows.length > 2) { edBlocks[bi].rows.pop(); edRender(); edSync(); } }
  function edAddText() { edBlocks.push({ type: 'text', text: '' }); edRender(); edSync(); }
  function edAddTable() { edBlocks.push({ type: 'table', rows: [['คอลัมน์ 1', 'คอลัมน์ 2'], ['', ''], ['', '']] }); edRender(); edSync(); }
  function edDeleteBlock(bi) { edBlocks.splice(bi, 1); if (!edBlocks.length) edBlocks.push({ type: 'text', text: '' }); edActiveTA = null; edRender(); edSync(); }
  function edTogglePaste() { const w = document.getElementById('ed-paste-wrap'); w.style.display = (w.style.display === 'none' ? 'block' : 'none'); }
  function edImportPaste() {
    const raw = document.getElementById('ed-paste-box').value.replace(/\s+$/, ''); if (!raw.trim()) return;
    const rows = raw.split('\n').map(l => l.split('\t').map(c => c.trim()));
    edBlocks.push({ type: 'table', rows: edNormRows(rows) }); document.getElementById('ed-paste-box').value = ''; edTogglePaste(); edRender(); edSync();
  }
  function edFetchSheetLink() {
    const url = (document.getElementById('ed-sheet-url').value || '').trim(); const msg = document.getElementById('ed-sheet-msg'); const btn = document.getElementById('ed-sheet-fetch-btn');
    if (!/docs\.google\.com\/spreadsheets\//.test(url)) { msg.style.color = '#DC2626'; msg.textContent = 'กรุณาวางลิงก์ Google Sheet ที่ถูกต้อง'; return; }
    btn.disabled = true; msg.style.color = '#64748B'; msg.textContent = 'กำลังดึงข้อมูลจากชีต...';
    google.script.run.withSuccessHandler(function (r) {
      btn.disabled = false;
      if (!r || !r.ok) { msg.style.color = '#DC2626'; msg.textContent = (r && r.error) || 'ดึงไม่สำเร็จ'; return; }
      document.getElementById('ed-paste-box').value = r.tsv || ''; edImportPaste(); document.getElementById('ed-sheet-url').value = ''; msg.style.color = '#0F766E'; msg.textContent = 'สร้างตารางจากชีตแล้ว ✓';
    }).withFailureHandler(function (e) { btn.disabled = false; msg.style.color = '#DC2626'; msg.textContent = 'Error: ' + ((e && e.message) || e); }).announcementFetchSheetTSV(url);
  }
  function rtFormat(kind) {
    const ta = edEnsureActiveTA(); if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd, sel = ta.value.substring(start, end); let wrapped = sel;
    if (kind === 'bold') wrapped = '**' + (sel || 'ตัวหนา') + '**';
    else if (kind === 'italic') wrapped = '*' + (sel || 'ตัวเอียง') + '*';
    else if (kind === 'bullet') wrapped = (sel || 'รายการที่ 1\nรายการที่ 2').split('\n').map(l => '• ' + l).join('\n');
    else if (kind === 'number') wrapped = (sel || 'ข้อที่ 1\nข้อที่ 2').split('\n').map((l, i) => (i + 1) + '. ' + l).join('\n');
    ta.value = ta.value.substring(0, start) + wrapped + ta.value.substring(end); ta.focus(); ta.selectionStart = start; ta.selectionEnd = start + wrapped.length;
    if (ta.dataset.bi != null && edBlocks[ta.dataset.bi]) edBlocks[ta.dataset.bi].text = ta.value; edAutosize(ta); edSync();
  }
  function rtInsertImage() {
    const url = prompt('วาง Image URL (Drive uc?id=... หรือ https://...):'); if (!url) return;
    const ta = edEnsureActiveTA(); if (!ta) return; const tag = '\n![](' + url + ')\n'; const pos = ta.selectionStart;
    ta.value = ta.value.substring(0, pos) + tag + ta.value.substring(pos); ta.focus(); ta.selectionStart = ta.selectionEnd = pos + tag.length;
    if (ta.dataset.bi != null && edBlocks[ta.dataset.bi]) edBlocks[ta.dataset.bi].text = ta.value; edAutosize(ta); edSync();
  }
  let _inlineImgInsertPos = 0; let _inlineImgTA = null;
  function rtUploadImageAtCursor() { const ta = edEnsureActiveTA(); if (!ta) return; _inlineImgTA = ta; _inlineImgInsertPos = (ta.selectionStart != null) ? ta.selectionStart : ta.value.length; const input = document.getElementById('upload-inline'); input.value = ''; input.click(); }
  function onInlineImagePicked(input) {
    const file = input.files && input.files[0]; if (!file) return;
    const ta = (_inlineImgTA && document.body.contains(_inlineImgTA)) ? _inlineImgTA : edEnsureActiveTA(); if (!ta) return;
    const commit = () => { if (ta.dataset.bi != null && edBlocks[ta.dataset.bi]) edBlocks[ta.dataset.bi].text = ta.value; edAutosize(ta); edSync(); };
    const token = '![กำลังอัปโหลด: ' + file.name + ']()'; const pos = Math.min(_inlineImgInsertPos, ta.value.length);
    const before = ta.value.substring(0, pos), after = ta.value.substring(pos);
    const lead = (before && !before.endsWith('\n')) ? '\n' : ''; const trail = (after && !after.startsWith('\n')) ? '\n' : '';
    const placeholder = lead + token + trail; ta.value = before + placeholder + after; commit();
    const reader = new FileReader();
    reader.onload = function (e) {
      const base64 = e.target.result.split(',')[1];
      google.script.run.withSuccessHandler(r => { if (r && r.ok && r.url) { ta.value = ta.value.replace(token, '![](' + r.url + ')'); showToast('แทรกรูปแล้ว', 'success'); } else { ta.value = ta.value.replace(placeholder, ''); showToast('อัปโหลดรูปไม่สำเร็จ: ' + (r && r.error ? r.error : 'unknown'), 'error'); } commit(); }).withFailureHandler(err => { ta.value = ta.value.replace(placeholder, ''); showToast('อัปโหลดรูปไม่สำเร็จ: ' + (err && err.message ? err.message : err), 'error'); commit(); }).annAdminUploadImage(file.name, file.type, base64);
    };
    reader.readAsDataURL(file);
  }
  function switchImgTab(tab) { document.querySelectorAll('#an .img-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); document.getElementById('img-tab-upload').style.display = tab === 'upload' ? '' : 'none'; document.getElementById('img-tab-url').style.display = tab === 'url' ? '' : 'none'; }
  function uploadImage(input, slot) {
    const files = input.files; if (!files || !files.length) return;
    const statusEl = document.getElementById('upload-' + slot + '-status'); statusEl.textContent = 'กำลังอัพโหลด...';
    let done = 0, total = files.length, uploaded = [];
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = function (e) {
        const base64 = e.target.result.split(',')[1];
        google.script.run.withSuccessHandler(r => {
          done++;
          if (r && r.ok && r.url) {
            uploaded.push(r.url); statusEl.textContent = 'อัพโหลด ' + done + '/' + total;
            if (slot === 'header') { document.getElementById('ed-header-image').value = r.url; document.getElementById('upload-header-preview').innerHTML = '<img class="img-thumb" src="' + r.url + '" alt="header preview">'; }
            else { const cur = document.getElementById('ed-body-images').value.trim(); document.getElementById('ed-body-images').value = (cur ? cur + ',' : '') + uploaded.join(','); renderBodyImagePreviews(); }
            if (done === total) statusEl.textContent = 'อัพโหลดเสร็จ ' + total + ' รูป';
          } else statusEl.textContent = 'พลาด: ' + (r && r.error ? r.error : 'unknown');
        }).withFailureHandler(e => { statusEl.textContent = 'พลาด: ' + (e.message || e); }).annAdminUploadImage(file.name, file.type, base64);
      };
      reader.readAsDataURL(file);
    });
  }
  function renderBodyImagePreviews() { const urls = document.getElementById('ed-body-images').value.split(',').map(s => s.trim()).filter(Boolean); document.getElementById('upload-body-preview').innerHTML = urls.map(u => '<img class="img-thumb" src="' + u + '" alt="body" onclick="window.open(\'' + u + '\',\'_blank\')">').join(''); }
  function previewLineFlex() {
    const title = document.getElementById('ed-title').value || '(ไม่มีหัวข้อ)'; const body = document.getElementById('ed-body').value || '';
    const catSel = document.getElementById('ed-category'); const catLabel = catSel.options[catSel.selectedIndex] ? catSel.options[catSel.selectedIndex].textContent : 'ทั่วไป';
    const headerImg = document.getElementById('ed-header-image').value.trim(); const annIdEl = document.getElementById('ed-ann-id-preview'); const annId = (annIdEl.textContent || '').split(' ')[0] || 'A-XXX/2026';
    const tParts = []; if (editing.branches.size) tParts.push(editing.branches.size + ' สาขา'); if (editing.departments.size) tParts.push(editing.departments.size + ' แผนก'); if (editing.positions.size) tParts.push(editing.positions.size + ' ตำแหน่ง');
    const targetLine = tParts.length ? 'ถึง: ' + tParts.join(' · ') : '(ส่งทุกคน)'; const bodyShort = body.substring(0, 200) + (body.length > 200 ? '...' : ''); const reqAck = document.getElementById('ed-ack').checked;
    const html = '<div style="background:white;border-radius:8px;border:1px solid #E2E8F0;padding:0;max-width:300px;font-family:sans-serif">' + (headerImg ? '<img src="' + headerImg + '" style="width:100%;border-radius:8px 8px 0 0;display:block;max-height:180px;object-fit:cover">' : '') + '<div style="padding:12px"><div style="font-size:9px;color:#94A3B8">ประกาศบริษัท · ' + annId + '</div><div style="font-size:10px;color:#3DC5B7;font-weight:600;margin-top:2px">[' + catLabel + ']</div><div style="font-size:14px;font-weight:600;color:#0D2F4F;margin-top:4px;line-height:1.3">' + escapeHtml(title) + '</div><div style="font-size:9px;color:#64748B;margin-top:2px">' + escapeHtml(targetLine) + '</div><hr style="border:0;border-top:1px solid #F1F5F9;margin:8px 0"><div style="font-size:11px;color:#475569;white-space:pre-wrap;line-height:1.5">' + escapeHtml(bodyShort) + '</div><div style="margin-top:10px;display:flex;flex-direction:column;gap:4px">' + (reqAck ? '<button style="padding:6px;background:#3DC5B7;color:white;border:0;border-radius:4px;font-size:11px">รับทราบ</button>' : '') + '<button style="padding:6px;background:white;color:#475569;border:1px solid #E2E8F0;border-radius:4px;font-size:11px">อ่านเพิ่ม</button></div></div></div>';
    document.getElementById('line-flex-preview').style.display = ''; document.getElementById('line-flex-preview-body').innerHTML = html;
  }

  /* ===== Editor open/close ===== */
  function openEditor() {
    if (!lookups) { showToast('ยังโหลดข้อมูลไม่เสร็จ', 'error'); return; }
    document.getElementById('ed-modal-title').textContent = 'เขียนประกาศใหม่';
    document.getElementById('ed-id').value = ''; document.getElementById('ed-title').value = ''; document.getElementById('ed-category').value = 'general';
    document.getElementById('ed-body').value = ''; var _e = document.getElementById('ed-effective-date'); if (_e) _e.value = '';
    edLoadFromHidden(); const _pw = document.getElementById('ed-paste-wrap'); if (_pw) _pw.style.display = 'none';
    document.getElementById('ed-ack').checked = false; document.getElementById('ed-quiz').checked = false; document.getElementById('ed-scheduled').value = '';
    document.getElementById('ed-header-image').value = ''; document.getElementById('ed-body-images').value = ''; document.getElementById('ed-send-mode').value = 'auto';
    document.getElementById('ed-silent').checked = false; document.getElementById('ed-remind').checked = false;
    document.getElementById('ed-remove-btn').style.display = ''; document.getElementById('ed-archive-btn').style.display = 'none';
    editing = { branches: new Set(), positions: new Set(), departments: new Set(), tags: new Set(), employees: new Set(), exclude_employees: new Set() };
    renderChips(); renderEmpPicker(); document.getElementById('preview-result').style.display = 'none';
    document.getElementById('save-btn').innerHTML = ICONS.save + ' Save Draft'; document.getElementById('publish-btn').innerHTML = ICONS.bell + ' Publish';
    if (!ANN_CATEGORIES.length) loadAnnCategories(); if (!ANN_PREFIXES.length) loadAnnPrefixes();
    QUIZ_DRAFT = []; renderQuizDraft(); loadAnnIdPreview(); switchImgTab('upload');
    ['upload-header-status', 'upload-body-status'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = 'ยังไม่ได้เลือก'; });
    ['upload-header-preview', 'upload-body-preview', 'line-flex-preview-body'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
    document.getElementById('line-flex-preview').style.display = 'none'; document.getElementById('editor-bg').classList.add('active');
  }
  function openEditorWithData(a) {
    openEditor();
    document.getElementById('ed-modal-title').textContent = 'แก้ไข ' + (a.title || a.ann_id);
    document.getElementById('ed-id').value = a.ann_id; document.getElementById('ed-title').value = a.title || ''; document.getElementById('ed-category').value = a.category || 'general';
    document.getElementById('ed-body').value = a.body_md || ''; edLoadFromHidden();
    document.getElementById('ed-ack').checked = a.requires_ack; document.getElementById('ed-quiz').checked = a.requires_quiz;
    try { var _qj = a.quiz_json; var _q = _qj ? (typeof _qj === 'string' ? JSON.parse(_qj) : _qj) : []; QUIZ_DRAFT = Array.isArray(_q) ? _q.map(function (x) { return { q: x.q || '', choices: (x.choices && x.choices.length ? x.choices : ['', '', '', '']), correct: x.correct || 0 }; }) : []; } catch (e) { QUIZ_DRAFT = []; }
    renderQuizDraft();
    if (a.status === 'published' || a.status === 'archived') {
      document.getElementById('save-btn').style.display = 'none'; document.getElementById('publish-btn').style.display = 'none';
      const remBtn = document.getElementById('ed-remove-btn'), arcBtn = document.getElementById('ed-archive-btn');
      if (a.status === 'published') { remBtn.style.display = ''; remBtn.textContent = IS_OWNER ? 'ลบจริง' : 'ขอลบ'; arcBtn.style.display = IS_OWNER ? '' : 'none'; }
      else { remBtn.style.display = IS_OWNER ? '' : 'none'; remBtn.textContent = 'ลบจริง'; arcBtn.style.display = 'none'; }
    } else { document.getElementById('save-btn').style.display = ''; document.getElementById('publish-btn').style.display = ''; document.getElementById('ed-remove-btn').textContent = 'ลบ'; }
    editing.branches = new Set(a.target_branches); editing.positions = new Set(a.target_positions); editing.departments = new Set(a.target_departments);
    editing.tags = new Set(a.target_tags); editing.employees = new Set(a.target_employees); editing.exclude_employees = new Set(a.target_exclude_employees);
    document.getElementById('ed-header-image').value = a.header_image || ''; document.getElementById('ed-body-images').value = (a.body_images || []).join(', ');
    document.getElementById('ed-send-mode').value = a.send_mode || 'auto'; document.getElementById('ed-silent').checked = !!a.silent_push; document.getElementById('ed-remind').checked = !!a.remind_24h;
    var _ef = document.getElementById('ed-effective-date'); if (_ef) _ef.value = a.effective_date ? String(a.effective_date).slice(0, 10) : '';
    if (a.scheduled_at) { const d = new Date(a.scheduled_at); if (!isNaN(d.getTime())) { const pad = n => String(n).padStart(2, '0'); document.getElementById('ed-scheduled').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); } }
    else document.getElementById('ed-scheduled').value = '';
    renderChips(); renderEmpPicker();
  }
  function closeEditor() { document.getElementById('editor-bg').classList.remove('active'); document.getElementById('save-btn').style.display = ''; document.getElementById('publish-btn').style.display = ''; }
  function renderChips() {
    const renderGroup = (containerId, items, set, cls) => {
      document.getElementById(containerId).innerHTML = (items || []).map(it => { const sel = set.has(it.id || it.name); return '<div class="chip ' + (sel ? 'selected ' + (cls || '') : '') + '" data-id="' + escapeAttr(it.id || it.name) + '" onclick="toggleChip(\'' + (set === editing.branches ? 'branches' : set === editing.positions ? 'positions' : set === editing.departments ? 'departments' : 'tags') + '\', this)">' + escapeHtml(it.name || it.label) + '</div>'; }).join('');
    };
    renderGroup('cg-branches', lookups.branches, editing.branches, '');
    renderGroup('cg-positions', lookups.positions, editing.positions, '');
    const deptItems = (ANN_PREFIXES.length ? ANN_PREFIXES : lookups.departments).map(p => ({ id: p.id, name: p.id + ' · ' + (p.label || p.name) }));
    renderGroup('cg-departments', deptItems, editing.departments, 'dept-chip');
    renderGroup('cg-tags', lookups.tags, editing.tags, 'tag-chip');
  }
  function toggleChip(group, el) { const id = el.getAttribute('data-id'); const set = editing[group]; if (set.has(id)) set.delete(id); else set.add(id); renderChips(); if (group === 'departments') loadAnnIdPreview(); }
  const EMP_TEMP_RE = /(ทดลอง|พาร์|part|intern|นักศึกษา|ฝึกงาน)/i;
  function renderEmpPicker() {
    const q = (document.getElementById('ed-emp-search').value || '').toLowerCase(); const permEl = document.getElementById('ed-emp-permanent-only'); const permOnly = permEl ? permEl.checked : false;
    const filtered = (lookups.employees || []).filter(e => { if (q && !(e.name + ' ' + e.nickname).toLowerCase().includes(q)) return false; if (permOnly && EMP_TEMP_RE.test(e.emp_type || '')) return false; return true; });
    document.getElementById('emp-picker').innerHTML = filtered.slice(0, 100).map(e => { const inc = editing.employees.has(e.id); const exc = editing.exclude_employees.has(e.id); const noLine = e.has_line === false; return '<div class="emp-row ' + (inc ? 'selected' : '') + (exc ? ' excluded' : '') + '" onclick="toggleEmp(\'' + escapeAttr(e.id) + '\', event)"><input type="checkbox" ' + (inc ? 'checked' : '') + ' style="pointer-events:none"><div style="flex:1">' + escapeHtml(e.nickname || e.name) + ' <span style="color:var(--text-faint);font-size:10px">' + escapeHtml(e.name) + '</span>' + (noLine ? ' <span style="color:#B91C1C;font-size:10px;font-weight:500">● ไม่มี LINE</span>' : '') + '</div>' + (exc ? '<span class="target-status ts-unopened">excluded</span>' : '') + '</div>'; }).join('') || '<div style="padding:14px;text-align:center;font-size:11px;color:var(--text-faint)">ไม่มีรายชื่อพนักงาน (lookups ว่างบน dashboard)</div>';
  }
  function filterEmpPicker() { renderEmpPicker(); }
  function toggleEmp(empId, event) { if (event && event.shiftKey) { if (editing.exclude_employees.has(empId)) editing.exclude_employees.delete(empId); else { editing.exclude_employees.add(empId); editing.employees.delete(empId); } } else { if (editing.employees.has(empId)) editing.employees.delete(empId); else { editing.employees.add(empId); editing.exclude_employees.delete(empId); } } renderEmpPicker(); }
  function previewTargets() {
    const payload = buildTargetPayload(); document.getElementById('preview-btn').disabled = true;
    google.script.run.withSuccessHandler(r => { document.getElementById('preview-btn').disabled = false; if (r && r.error) { showToast(r.error, 'error'); return; } renderPreview(r); }).withFailureHandler(e => { document.getElementById('preview-btn').disabled = false; showToast('Error: ' + e.message, 'error'); }).annAdminPreviewTargets(payload);
  }
  function renderPreview(r) {
    document.getElementById('preview-result').style.display = ''; document.getElementById('pv-count').textContent = r.count || 0;
    document.getElementById('pv-sub').textContent = (r.line_linked_count || 0) + ' link LINE · ' + (r.no_line_count || 0) + ' ไม่ได้ link';
    document.getElementById('pv-list').innerHTML = (r.sample || []).slice(0, 12).map(s => '<li>' + escapeHtml(s.nickname || s.name) + ' — ' + escapeHtml(s.branch_name) + ' / ' + escapeHtml(s.position_name) + (s.line_linked ? '' : ' <span style="color:var(--danger)">(no LINE)</span>') + '</li>').join('') + (r.count > 12 ? '<li style="color:var(--text-faint)">... อีก ' + (r.count - 12) + ' คน</li>' : '');
    const warn = document.getElementById('pv-warn');
    if (r.no_line_count > 0) { warn.style.display = ''; warn.textContent = 'ระวัง: ' + r.no_line_count + ' คน ไม่ได้ link LINE'; }
    else if (r.count === 0) { warn.style.display = ''; warn.textContent = 'ไม่มี target — ตรวจ criteria (lookups ว่างบน dashboard → preview รายคนยังไม่พร้อม)'; }
    else warn.style.display = 'none';
  }
  function buildTargetPayload() { return { target_branches: Array.from(editing.branches), target_positions: Array.from(editing.positions), target_departments: Array.from(editing.departments), target_tags: Array.from(editing.tags), target_employees: Array.from(editing.employees), target_exclude_employees: Array.from(editing.exclude_employees), quiz_json: QUIZ_DRAFT && QUIZ_DRAFT.length ? JSON.stringify(QUIZ_DRAFT.filter(q => q.q && q.q.trim())) : '', kpi_link_enabled: false }; }
  function buildPayload() { const imgsRaw = document.getElementById('ed-body-images').value || ''; const bodyImgs = imgsRaw.split(',').map(s => s.trim()).filter(Boolean); return Object.assign({ title: document.getElementById('ed-title').value.trim(), body_md: document.getElementById('ed-body').value, category: document.getElementById('ed-category').value.trim() || 'general', requires_ack: document.getElementById('ed-ack').checked, requires_quiz: document.getElementById('ed-quiz').checked, kpi_weight: 0, scheduled_at: document.getElementById('ed-scheduled').value || '', effective_date: (document.getElementById('ed-effective-date') || {}).value || '', header_image: document.getElementById('ed-header-image').value.trim(), body_images_json: bodyImgs, send_mode: document.getElementById('ed-send-mode').value || 'auto', silent_push: document.getElementById('ed-silent').checked, remind_24h: document.getElementById('ed-remind').checked }, buildTargetPayload()); }
  let SAVE_INFLIGHT = false;
  function _setSaveButtons(disabled) { const sb2 = document.getElementById('save-btn'), pb = document.getElementById('publish-btn'); if (sb2) sb2.disabled = disabled; if (pb) pb.disabled = disabled; }
  function saveAnn(thenPublish) {
    if (SAVE_INFLIGHT) return; const payload = buildPayload();
    if (!payload.title) { showToast('ระบุ title', 'error'); return; } if (!payload.body_md) { showToast('ระบุเนื้อหา', 'error'); return; }
    const totalImgs = (payload.header_image ? 1 : 0) + (payload.body_images_json || []).length;
    if (payload.send_mode === 'carousel' && totalImgs < 2) { if (!confirm('Send mode = carousel แต่มีรูปแค่ ' + totalImgs + ' รูป — ต้องการต่อ?')) return; }
    if (payload.send_mode === 'single_hero' && totalImgs === 0) { if (!confirm('Send mode = single hero แต่ไม่มีรูป — ต้องการต่อ?')) return; }
    if (thenPublish && !confirm('Publish ทันที? — ส่ง LINE multicast ตอนนี้เลย')) return;
    const isEdit = !!document.getElementById('ed-id').value; const annId = document.getElementById('ed-id').value;
    SAVE_INFLIGHT = true; _setSaveButtons(true);
    const done = () => { SAVE_INFLIGHT = false; _setSaveButtons(false); };
    const fail = (e) => { done(); showToast('Error: ' + (e && e.message ? e.message : e), 'error'); };
    const onSave = (r) => {
      if (r && r.error) { done(); showToast(r.error, 'error'); return; }
      const id = isEdit ? annId : r.ann_id;
      if (thenPublish) { google.script.run.withSuccessHandler(p => { done(); if (p && p.error) { showToast(p.error, 'error'); return; } showToast('Published — ส่งหา ' + (p.target_count || 0) + ' คน', 'success'); closeEditor(); loadList(); }).withFailureHandler(fail).annAdminPublish(id); }
      else { done(); showToast('บันทึกแล้ว', 'success'); closeEditor(); loadList(); }
    };
    if (isEdit) google.script.run.withSuccessHandler(onSave).withFailureHandler(fail).annAdminUpdate(annId, payload);
    else google.script.run.withSuccessHandler(onSave).withFailureHandler(fail).annAdminCreate(payload);
  }
  function archiveAnn() { const annId = document.getElementById('ed-id').value; if (!annId) return; if (!confirm('Archive ประกาศนี้?')) return; google.script.run.withSuccessHandler(r => { if (r && r.error) { showToast(r.error, 'error'); return; } showToast('Archived', 'success'); closeEditor(); loadList(); }).withFailureHandler(e => showToast('Error: ' + e.message, 'error')).annAdminArchive(annId); }
  function removeAnn() {
    const annId = document.getElementById('ed-id').value; if (!annId) return;
    const a = ((allData && allData.announcements) || []).find(x => x.ann_id === annId); const status = a ? a.status : 'draft';
    if (status === 'published') { if (IS_OWNER) ownerDeleteAnn(null, annId, true); else requestRemoveAnn(null, annId, true); return; }
    if (!confirm('ลบประกาศนี้?\nลบแล้วกู้คืนไม่ได้')) return;
    google.script.run.withSuccessHandler(r => { if (r && r.error) { showToast(r.error, 'error'); return; } showToast('ลบแล้ว', 'success'); closeEditor(); loadList(); }).withFailureHandler(e => showToast('Error: ' + e.message, 'error')).annAdminRemove(annId, { mode: 'hard' });
  }
  function ownerDeleteAnn(event, annId, fromEditor) {
    if (event) { event.stopPropagation(); event.preventDefault(); } if (!annId) return;
    const a = ((allData && allData.announcements) || []).find(x => x.ann_id === annId); const title = (a && a.title) || annId;
    const hard = confirm('ลบประกาศ "' + title + '" แบบไหน?\n\nOK = ลบจริง (กู้คืนไม่ได้)\nCancel = ไปต่อเพื่อเลือกย้าย Archive'); let mode;
    if (hard) mode = 'hard'; else { if (!confirm('ย้ายประกาศ "' + title + '" ไป Archive แทน?')) return; mode = 'archive'; }
    google.script.run.withSuccessHandler(r => { if (r && r.error) { showToast(r.error, 'error'); return; } showToast(mode === 'archive' ? 'ย้ายไป Archive แล้ว' : 'ลบประกาศแล้ว', 'success'); if (fromEditor) closeEditor(); loadList(); }).withFailureHandler(e => showToast('Error: ' + e.message, 'error')).annAdminRemove(annId, { mode: mode });
  }
  function requestRemoveAnn(event, annId, fromEditor) {
    if (event) { event.stopPropagation(); event.preventDefault(); } if (!annId) return;
    const a = ((allData && allData.announcements) || []).find(x => x.ann_id === annId); const title = (a && a.title) || annId;
    const reason = prompt('ขอลบประกาศ "' + title + '"\nระบุเหตุผล:', ''); if (reason === null) return;
    google.script.run.withSuccessHandler(r => { if (r && r.error) { if (r.is_owner) { ownerDeleteAnn(null, annId, fromEditor); return; } showToast(r.error, 'error'); return; } if (r && r.is_owner) { ownerDeleteAnn(null, annId, fromEditor); return; } showToast('ส่งคำขอแล้ว', 'success'); if (fromEditor) closeEditor(); }).withFailureHandler(e => showToast('Error: ' + e.message, 'error')).annAdminRequestRemove(annId, reason);
  }
  function quickRemoveAnn(event, annId) { if (event) { event.stopPropagation(); event.preventDefault(); } if (!annId) return; const a = ((allData && allData.announcements) || []).find(x => x.ann_id === annId); const title = (a && a.title) || annId; if (!confirm('ลบ draft "' + title + '" ?')) return; google.script.run.withSuccessHandler(r => { if (r && r.error) { showToast(r.error, 'error'); return; } showToast('ลบ draft แล้ว', 'success'); loadList(); }).withFailureHandler(e => showToast('Error: ' + e.message, 'error')).annAdminRemove(annId); }
  function quickRemoveScheduled(event, annId) { if (event) { event.stopPropagation(); event.preventDefault(); } if (!annId) return; const a = ((allData && allData.announcements) || []).find(x => x.ann_id === annId); const title = (a && a.title) || annId; const when = (a && a.scheduled_at) ? '\nตั้งเวลาส่ง: ' + new Date(a.scheduled_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; if (!confirm('ลบประกาศที่ตั้งเวลาไว้ "' + title + '" ?' + when)) return; google.script.run.withSuccessHandler(r => { if (r && r.error) { showToast(r.error, 'error'); return; } showToast('ลบประกาศที่ตั้งเวลาไว้แล้ว', 'success'); loadList(); }).withFailureHandler(e => showToast('Error: ' + e.message, 'error')).annAdminRemove(annId); }

  /* ===== Detail ===== */
  function openDetail(annId) {
    document.getElementById('detail-bg').classList.add('active'); document.getElementById('d-title').textContent = 'กำลังโหลด...';
    google.script.run.withSuccessHandler(d => { if (!d || d.error || !d.announcement) { showToast((d && d.error) ? d.error : 'โหลดรายละเอียดไม่สำเร็จ', 'error'); closeDetail(); return; } currentDetail = d; renderDetail(d); }).withFailureHandler(e => { showToast('Error: ' + e.message, 'error'); closeDetail(); }).annAdminGetDetail(annId);
  }
  function renderDetail(d) {
    if (!d || !d.announcement) { showToast('โหลดรายละเอียดไม่สำเร็จ', 'error'); closeDetail(); return; }
    const a = d.announcement; const c = d.counts || {};
    const annIdEl = document.getElementById('d-ann-id-badge'); if (annIdEl) annIdEl.textContent = a.ann_id || '(no id)';
    document.getElementById('d-title').textContent = a.title; document.getElementById('d-sub').textContent = '[' + a.category + '] · ' + a.status + ' · ' + (a.published_at || a.created_at);
    document.getElementById('d-stats').innerHTML = ['<div class="stat-box"><div class="v">' + c.total + '</div><div class="l">targets</div></div>', '<div class="stat-box unopened"><div class="v">' + c.unopened + '</div><div class="l">unopened</div></div>', '<div class="stat-box"><div class="v">' + c.opened + '</div><div class="l">opened (' + c.open_rate + '%)</div></div>', '<div class="stat-box received"><div class="v">' + c.acknowledged + '</div><div class="l">ack (' + c.ack_rate + '%)</div></div>'].join('');
    document.getElementById('d-body').innerHTML = renderBody(a.body_md);
    document.getElementById('d-targets').innerHTML = (d.target_list || []).map(t => { const status = t.acknowledged ? '<span class="target-status ts-acked">' + ICONS.check + ' acked</span>' : t.opened ? '<span class="target-status ts-opened">opened</span>' : '<span class="target-status ts-unopened">unopened</span>'; const cls = t.acknowledged ? 'acked' : t.opened ? 'opened' : 'unopened'; return '<div class="target-row ' + cls + '"><div><div class="target-name">' + escapeHtml(t.employee_nickname || t.employee_name) + '</div><div class="target-meta">' + escapeHtml(t.branch_name) + ' · ' + escapeHtml(t.position_name) + (t.line_linked ? '' : ' · <span style="color:var(--danger)">no LINE</span>') + '</div></div><div>' + status + '</div><div style="font-size:10px;color:var(--text-faint)">' + escapeHtml(t.ack_at || t.opened_at || '—') + '</div></div>'; }).join('') || '<div style="padding:14px;text-align:center;font-size:11px;color:var(--text-faint)">ไม่มี target list (dashboard ยังไม่เก็บสถานะการอ่านรายคน)</div>';
    document.getElementById('d-remind-btn').style.display = (a.status === 'published' && c.unopened + (c.opened - c.acknowledged) > 0) ? '' : 'none';
    document.getElementById('d-edit-btn').style.display = (a.status === 'draft' || a.status === 'scheduled') ? '' : 'none';
    const resendBtn = document.getElementById('d-resend-btn'); if (resendBtn) resendBtn.style.display = (a.status === 'published') ? '' : 'none';
  }
  function renderBody(text) {
    const lines = String(text || '').split('\n');
    function inlineFmt(str) { let s = escapeHtml(str); s = s.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>'); s = s.replace(/(^|[^\*])\*([^\*\n]+)\*([^\*]|$)/g, '$1<em>$2</em>$3'); s = s.replace(/!\[[^\]]*\]\(([^)]+)\)/g, function (m, url) { if (!/^https?:\/\//i.test(url)) return ''; return '<img src="' + url + '" alt="" style="max-width:100%;border-radius:6px;margin:6px 0">'; }); return s; }
    function isSep(l) { return /^\s*\|?[\s:|\-]+\|?\s*$/.test(l) && l.indexOf('-') >= 0; }
    function splitRow(l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); }
    let out = '', i = 0;
    while (i < lines.length) {
      if (/^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const rows = [splitRow(lines[i])]; i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
        let t = '<table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:13px;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden"><thead><tr>';
        rows[0].forEach(function (c) { t += '<th style="background:#0D2F4F;color:#fff;text-align:left;padding:7px 9px;font-weight:700;font-size:12px">' + inlineFmt(c) + '</th>'; });
        t += '</tr></thead><tbody>';
        for (let r = 1; r < rows.length; r++) { const bg = (r % 2 === 0) ? 'background:#F8FAFC;' : ''; t += '<tr>'; rows[r].forEach(function (c) { t += '<td style="border-top:1px solid #E2E8F0;padding:7px 9px;' + bg + '">' + inlineFmt(c) + '</td>'; }); t += '</tr>'; }
        t += '</tbody></table>'; out += t;
      } else { out += inlineFmt(lines[i]); if (i < lines.length - 1) out += '\n'; i++; }
    }
    return out;
  }
  /* ===== Resend ===== */
  let resendEditing = { branches: new Set(), positions: new Set(), departments: new Set(), employees: new Set(), exclude_employees: new Set() };
  function resendAnnouncement() {
    if (!currentDetail || !currentDetail.announcement) return; if (!ANN_PREFIXES.length) loadAnnPrefixes();
    const a = currentDetail.announcement; const c = currentDetail.counts || {};
    document.getElementById('r-ann-id').textContent = a.ann_id; document.getElementById('r-count-all').textContent = (c.total || 0) + ' คน · ทุกคนใน target list';
    document.getElementById('r-count-unacked').textContent = ((c.total || 0) - (c.acknowledged || 0)) + ' คน · ยังไม่กดรับทราบ'; document.getElementById('r-count-unopened').textContent = (c.unopened || 0) + ' คน · ยังไม่อ่าน';
    resendEditing = { branches: new Set(), positions: new Set(), departments: new Set(), employees: new Set(), exclude_employees: new Set() };
    document.getElementById('r-custom-panel').style.display = 'none'; document.querySelector('#an input[name="r-mode"][value="all"]').checked = true; updateResendPreview();
    document.querySelectorAll('#an input[name="r-mode"]').forEach(r => { r.onchange = function () { document.getElementById('r-custom-panel').style.display = this.value === 'custom' ? '' : 'none'; if (this.value === 'custom') rRenderChips(); updateResendPreview(); }; });
    document.getElementById('resend-bg').classList.add('active');
  }
  function closeResend() { document.getElementById('resend-bg').classList.remove('active'); }
  function updateResendPreview() { const mode = (document.querySelector('#an input[name="r-mode"]:checked') || {}).value || 'all'; const c = (currentDetail && currentDetail.counts) || {}; let n = 0; if (mode === 'all') n = c.total || 0; else if (mode === 'unacked') n = (c.total || 0) - (c.acknowledged || 0); else if (mode === 'unopened') n = c.unopened || 0; else if (mode === 'custom') n = '~ (ขึ้นกับเงื่อนไข)'; document.getElementById('r-final-count').textContent = n; }
  function rRenderChips() {
    if (!lookups) return; const dept = (ANN_PREFIXES.length) ? ANN_PREFIXES.map(p => ({ id: p.id, name: p.id + ' · ' + p.label })) : lookups.departments;
    const renderG = (id, items, set) => { document.getElementById(id).innerHTML = (items || []).map(it => { const sel = set.has(it.id || it.name); return '<div class="' + (sel ? 'chip selected' : 'chip') + '" data-id="' + escapeAttr(it.id || it.name) + '" onclick="rToggleChip(\'' + (set === resendEditing.branches ? 'branches' : set === resendEditing.positions ? 'positions' : 'departments') + '\', this)">' + escapeHtml(it.name || it.label) + '</div>'; }).join(''); };
    renderG('r-cg-branches', lookups.branches, resendEditing.branches); renderG('r-cg-positions', lookups.positions, resendEditing.positions); renderG('r-cg-departments', dept, resendEditing.departments); rRenderEmpPicker();
  }
  function rToggleChip(group, el) { const id = el.getAttribute('data-id'); const set = resendEditing[group]; if (set.has(id)) set.delete(id); else set.add(id); rRenderChips(); }
  function rRenderEmpPicker() { const q = ((document.getElementById('r-emp-search') || {}).value || '').toLowerCase(); const filtered = (lookups.employees || []).filter(e => !q || ((e.name || '') + ' ' + (e.nickname || '')).toLowerCase().includes(q)); document.getElementById('r-emp-picker').innerHTML = filtered.slice(0, 50).map(e => { const inc = resendEditing.employees.has(e.id); const exc = resendEditing.exclude_employees.has(e.id); return '<div class="emp-row ' + (inc ? 'selected' : '') + (exc ? ' excluded' : '') + '" onclick="rToggleEmp(\'' + e.id + '\', event)">' + escapeHtml(e.nickname || e.name) + ' <span style="color:var(--text-faint)">' + escapeHtml(e.branch_id) + '</span>' + (inc ? '<span class="target-status ts-acked">+</span>' : '') + (exc ? '<span class="target-status ts-unopened">×</span>' : '') + '</div>'; }).join(''); }
  function rToggleEmp(empId, ev) { if (ev && ev.shiftKey) { if (resendEditing.exclude_employees.has(empId)) resendEditing.exclude_employees.delete(empId); else { resendEditing.exclude_employees.add(empId); resendEditing.employees.delete(empId); } } else { if (resendEditing.employees.has(empId)) resendEditing.employees.delete(empId); else { resendEditing.employees.add(empId); resendEditing.exclude_employees.delete(empId); } } rRenderEmpPicker(); }
  function rFilterEmp() { rRenderEmpPicker(); }
  function confirmResend() {
    try {
      if (!currentDetail || !currentDetail.announcement) { alert('ไม่พบข้อมูลประกาศ'); return; }
      const annId = currentDetail.announcement.ann_id; const mode = (document.querySelector('#an input[name="r-mode"]:checked') || {}).value || 'all'; const btn = document.getElementById('r-send-btn'); if (!btn) return;
      btn.disabled = true; btn.textContent = 'กำลังส่ง...'; const opts = { mode: mode };
      if (mode === 'custom') { opts.target_branches = Array.from(resendEditing.branches); opts.target_positions = Array.from(resendEditing.positions); opts.target_departments = Array.from(resendEditing.departments); opts.target_employees = Array.from(resendEditing.employees); opts.target_exclude_employees = Array.from(resendEditing.exclude_employees); if (!opts.target_branches.length && !opts.target_positions.length && !opts.target_departments.length && !opts.target_employees.length) { alert('Custom mode · ต้องเลือกอย่างน้อย 1 criteria'); btn.disabled = false; btn.textContent = 'ส่งซ้ำ'; return; } }
      google.script.run.withSuccessHandler(r => { btn.disabled = false; btn.textContent = 'ส่งซ้ำ'; if (r && r.error) { showToast(r.error, 'error'); return; } showToast((r && r.message) ? r.message : ('ส่งซ้ำสำเร็จ · ' + (r && r.count ? r.count + ' คน' : '')), 'success'); closeResend(); }).withFailureHandler(e => { btn.disabled = false; btn.textContent = 'ส่งซ้ำ'; showToast('ส่งซ้ำพลาด: ' + (e.message || e), 'error'); }).annAdminResend(annId, opts);
    } catch (err) { alert('JS error ใน confirmResend: ' + err.message); const b2 = document.getElementById('r-send-btn'); if (b2) { b2.disabled = false; b2.textContent = 'ส่งซ้ำ'; } }
  }
  function editFromDetail() { if (!currentDetail) return; closeDetail(); openEditorWithData(currentDetail.announcement); }
  function remindUnacked() { if (!currentDetail) return; if (!confirm('ส่ง LINE เตือนคนที่ยังไม่ ack ทั้งหมด?')) return; google.script.run.withSuccessHandler(r => { if (r && r.error) { showToast(r.error, 'error'); return; } if (r.message) showToast(r.message, 'success'); else showToast('ส่งซ้ำหา ' + (r.sent || 0) + ' คน', 'success'); }).withFailureHandler(e => showToast('Error: ' + e.message, 'error')).annAdminRemindUnacked(currentDetail.announcement.ann_id); }
  function closeDetail() { document.getElementById('detail-bg').classList.remove('active'); currentDetail = null; }

  /* ===== role gating ===== */
  function loadWhoAmI() { google.script.run.withSuccessHandler(r => { if (r && r.ok) { IS_OWNER = !!r.is_owner; MY_ROLE = r.role || ''; } applyOwnerGating(); }).withFailureHandler(_ => { applyOwnerGating(); }).annAdminWhoAmI(); }
  function applyOwnerGating() { const archTab = document.querySelector('#an .tab[data-tab="archived"]'); if (archTab) archTab.style.display = IS_OWNER ? '' : 'none'; if (!IS_OWNER && currentTab === 'archived') { setTab('all'); return; } if (allData && currentView === 'list') renderListView(); }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = { showHelp, HELP, loadList, openEditor, setView, setTab, onFiltersChanged, clearAllFilters, msToggle, msToggleOpen, msAll, msNone, renderListView, calPrev, calNext, calToday, selectDay, openDetail, closeEditor, saveAnn, archiveAnn, removeAnn, ownerDeleteAnn, requestRemoveAnn, quickRemoveAnn, quickRemoveScheduled, closeDetail, editFromDetail, remindUnacked, resendAnnouncement, closeResend, confirmResend, rToggleChip, rToggleEmp, rFilterEmp, previewTargets, previewLineFlex, toggleChip, toggleEmp, filterEmpPicker, switchImgTab, uploadImage, rtFormat, rtInsertImage, rtUploadImageAtCursor, onInlineImagePicked, edAddText, edAddTable, edTogglePaste, edImportPaste, edFetchSheetLink, edAddCol, edAddRow, edDelCol, edDelRow, quizAdd, quizRemove, quizUpdate };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadWhoAmI();
  loadList();
}
