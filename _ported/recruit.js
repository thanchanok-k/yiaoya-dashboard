// _ported/recruit.js — FULL native port of desktop recruit_manager.html (HR Announcement admin · หน้า "สรรหา")
// ลอกทั้งดุ้น: stats(6) + tabs(active/hired/rejected/all) + filters(search/position/branch)
//   + pipeline kanban 6 stage (drag-drop ย้าย stage) + 6 modals (intake/detail/invite/flex/mbti/offer) + help
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix #rc ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ RC_RUN_PAGE_JS() · google.script.run = shim → RC_BACKEND (Supabase)
//
// ใช้ global sb (index.html module scope) — ห้าม redeclare · helper (esc/$/ICONS/showToast/showHelp) inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน RC_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=recruit.updated → {items}) :
//   list   → derive candidates/stats/positions/branches client-side จาก payload ล่าสุดต่อ candidate
//            (ตอนนี้ list อาจว่าง = 0 candidate → render ได้ ไม่ error · empty state สวย)
//   whoami → {ok:true, is_owner:true} (dashboard user = admin เต็มสิทธิ์)
//   detail → reuse payload ดิบที่ cache ไว้ตอน list
//   intake/moveStage/updateCandidate/reject/hire/sendInterviewInvite/sendOffer/
//     sendManualFlex/setMbti → เขียนกลับ/ส่ง LINE ไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   RC_BACKEND — map google.script.run → Supabase edge fn hr_list (type=recruit.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     recruitAdminList(opts)        → { items, stats, positions, branches }
     recruitAdminDetail(id)        → candidate detail object (flat)
     recruitGetOaName()            → string
     mutations                     → { ok / error } stub + toast
   ============================================================ */
var RC_FN = 'hr_list';
var RC_TYPE = 'recruit.updated';

function rc2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function rc2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function rc2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function rc2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

var RC_STAGES = ['open_position', 'applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];

// map payload event ดิบ → candidate row shape ที่ JS เดิมใช้
function rc2MapCand(p) {
  p = p || {};
  var stage = String(p.stage || p.status || 'applied').toLowerCase();
  if (RC_STAGES.indexOf(stage) < 0) stage = 'applied';
  var lineId = p.line_user_id || p.line_uid || '';
  var lineLinked = lineId ? true : rc2Bool(p.line_linked);
  var appliedAt = rc2Date(p.applied_at || p.created_at || p.posted_at);
  var ageDays = null;
  if (appliedAt) {
    var d0 = new Date(appliedAt); var today = new Date(); today.setHours(0, 0, 0, 0);
    if (!isNaN(d0.getTime())) ageDays = Math.max(0, Math.floor((today - d0) / 86400000));
  }
  return {
    candidate_id: p.candidate_id || p.entity_id || p.id || '',
    name: p.name || p.candidate_name || p.full_name || '—',
    position_id: p.position_id || '',
    position_name: p.position_name || p.position || '—',
    branch_id: p.branch_id || '',
    branch_name: p.branch_name || p.branch || '—',
    contact: p.contact || p.phone || '',
    phone: p.phone || '',
    email: p.email || '',
    source: p.source || '',
    stage: stage,
    score: (p.score != null) ? p.score : (p.screening_score != null ? p.screening_score : ''),
    screening_score: p.screening_score || '',
    line_user_id: lineId,
    line_linked: lineLinked,
    applied_at: appliedAt,
    age_days: ageDays,
    resume_url: p.resume_url || '',
    hr_notes: p.hr_notes || p.notes || '',
    // interview
    interview_date: rc2Date(p.interview_date),
    interview_time: p.interview_time || '',
    interview_location: p.interview_location || '',
    interview_invite_sent_at: rc2Date(p.interview_invite_sent_at),
    // offer
    offered_at: rc2Date(p.offered_at),
    offer_salary: rc2Num(p.offer_salary),
    offer_start_date: rc2Date(p.offer_start_date),
    offer_response: p.offer_response || '',
    // mbti
    mbti_test_sent_at: rc2Date(p.mbti_test_sent_at),
    mbti_result: p.mbti_result || '',
    mbti_completed_at: rc2Date(p.mbti_completed_at),
    // flex log
    manual_flex_log: p.manual_flex_log || '',
    // hired / rejected
    hired_at: rc2Date(p.hired_at),
    rejection_reason: p.rejection_reason || '',
    _raw: p,
  };
}

// cache payload ดิบล่าสุดต่อ candidate (ให้ detail reuse · backend ไม่มี endpoint แยก)
var _rc2Cands = [];
var _rc2Raw = {};

function rc2FetchCands() {
  return sb.functions.invoke(RC_FN + '?type=' + encodeURIComponent(RC_TYPE)).then(function (res) {
    var data = (res && res.data) || {};
    var items = rc2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.candidate_id || p.entity_id || p.id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      _rc2Raw[id] = p;
      rows.push(rc2MapCand(p));
    });
    _rc2Cands = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[RC_BACKEND] list fetch failed', e);
    _rc2Cands = [];
    return [];
  });
}

var RC_BACKEND = {
  // role gate — dashboard user = admin เต็มสิทธิ์
  recruitAdminWhoAmI: function () {
    return Promise.resolve({ ok: true, is_owner: true, role: 'owner' });
  },

  // OA name — backend ไม่มี settings → คืน default ของหน้าเดิม
  recruitGetOaName: function () {
    return Promise.resolve('@yiaoya_recruit');
  },

  // list — { items, stats, positions, branches }
  recruitAdminList: function (opts) {
    opts = opts || {};
    return rc2FetchCands().then(function (all) {
      var tab = opts.tab || 'active';
      var filtered = all.slice();
      if (tab === 'active') filtered = filtered.filter(function (c) { return c.stage !== 'hired' && c.stage !== 'rejected'; });
      else if (tab === 'hired') filtered = filtered.filter(function (c) { return c.stage === 'hired'; });
      else if (tab === 'rejected') filtered = filtered.filter(function (c) { return c.stage === 'rejected'; });
      // tab === 'all' → ไม่กรอง

      if (opts.position_id) filtered = filtered.filter(function (c) { return c.position_id === opts.position_id; });
      if (opts.branch_id) filtered = filtered.filter(function (c) { return c.branch_id === opts.branch_id; });
      if (opts.search) {
        var q = String(opts.search).toLowerCase();
        filtered = filtered.filter(function (c) {
          return (c.name || '').toLowerCase().indexOf(q) >= 0 ||
            (c.contact || '').toLowerCase().indexOf(q) >= 0 ||
            (c.phone || '').toLowerCase().indexOf(q) >= 0 ||
            (c.email || '').toLowerCase().indexOf(q) >= 0;
        });
      }

      var stageRank = {};
      RC_STAGES.forEach(function (s, i) { stageRank[s] = i; });
      filtered.sort(function (a, b) {
        var ai = stageRank[a.stage] == null ? 99 : stageRank[a.stage];
        var bi = stageRank[b.stage] == null ? 99 : stageRank[b.stage];
        if (ai !== bi) return ai - bi;
        return (b.applied_at || '').localeCompare(a.applied_at || '');
      });

      var byStage = function (s) { return all.filter(function (c) { return c.stage === s; }).length; };
      var stats = {
        total: all.length,
        applied: byStage('applied'),
        screening: byStage('screening'),
        interview: byStage('interview'),
        offer: byStage('offer'),
        hired: byStage('hired'),
        rejected: byStage('rejected'),
        active: all.filter(function (c) { return c.stage !== 'hired' && c.stage !== 'rejected'; }).length,
      };

      // positions / branches จาก candidates ที่มี (backend ไม่มี master list บน dashboard)
      var pSeen = {}, positions = [];
      var bSeen = { HQ: true }, branches = [];   // HQ มีเป็น default option ใน markup แล้ว
      all.forEach(function (c) {
        if (c.position_id && !pSeen[c.position_id]) { pSeen[c.position_id] = true; positions.push({ id: c.position_id, name: c.position_name || c.position_id }); }
        if (c.branch_id && !bSeen[c.branch_id]) { bSeen[c.branch_id] = true; branches.push({ id: c.branch_id, name: c.branch_name || c.branch_id }); }
      });

      return { items: filtered, stats: stats, positions: positions, branches: branches };
    });
  },

  // detail — flat candidate object (reuse cache)
  recruitAdminDetail: function (candidateId) {
    var build = function () {
      var p = _rc2Raw[candidateId];
      if (!p) {
        var c0 = _rc2Cands.find(function (x) { return x.candidate_id === candidateId; });
        if (c0) return c0;
        return { error: 'ไม่พบ candidate' };
      }
      return rc2MapCand(p);
    };
    if (_rc2Cands.length || Object.keys(_rc2Raw).length) return Promise.resolve(build());
    return rc2FetchCands().then(build);
  },

  // ---- mutations: เขียนกลับ/ส่ง LINE ไม่ได้บน dashboard → stub + toast ----
  recruitAdminIntake: function () {
    rc2NotReady('เพิ่ม candidate (manual)');
    return Promise.resolve({ error: 'เพิ่ม candidate ยังไม่พร้อมบน dashboard (read-only)' });
  },
  recruitAdminMoveStage: function () {
    rc2NotReady('เปลี่ยน stage');
    return Promise.resolve({ error: 'เปลี่ยน stage ยังไม่พร้อมบน dashboard (read-only)' });
  },
  recruitAdminUpdateCandidate: function () {
    rc2NotReady('บันทึก notes / แก้ข้อมูล candidate');
    return Promise.resolve({ error: 'บันทึกยังไม่พร้อมบน dashboard (read-only)' });
  },
  recruitAdminReject: function () {
    rc2NotReady('Reject candidate');
    return Promise.resolve({ error: 'Reject ยังไม่พร้อมบน dashboard (read-only)' });
  },
  recruitAdminHire: function () {
    rc2NotReady('Hire (สร้าง employee + onboarding)');
    return Promise.resolve({ error: 'Hire ยังไม่พร้อมบน dashboard (read-only)' });
  },
  recruitAdminSendInterviewInvite: function () {
    rc2NotReady('ส่ง LINE invite สัมภาษณ์');
    return Promise.resolve({ error: 'ส่ง LINE invite ยังไม่พร้อมบน dashboard' });
  },
  recruitAdminSendOffer: function () {
    rc2NotReady('ส่ง LINE offer letter');
    return Promise.resolve({ error: 'ส่ง LINE offer ยังไม่พร้อมบน dashboard' });
  },
  recruitAdminSendManualFlex: function () {
    rc2NotReady('ส่ง flex / MBTI ทาง LINE');
    return Promise.resolve({ error: 'ส่ง flex ทาง LINE ยังไม่พร้อมบน dashboard' });
  },
  recruitAdminSetMbti: function () {
    rc2NotReady('บันทึกผล MBTI');
    return Promise.resolve({ error: 'บันทึก MBTI ยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _rc2NotReadyShown = {};
function rc2NotReady(feature) {
  if (_rc2NotReadyShown[feature]) return;
  _rc2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.rc2Toast) window.rc2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only)', 'error');
}

/* ============================================================
   mountRecruit — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountRecruit() {
  if (!document.getElementById('wrap-recruit')) return;
  var wrap = document.getElementById('wrap-recruit');
  wrap.innerHTML = '<style>' + RC_CSS() + '</style><div id="rc">' + RC_MARKUP() + '</div>';
  RC_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> manager) · prefix ทุก selector ด้วย #rc =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว) */
function RC_CSS() {
  return [
    // tokens (มาจาก _shared_styles)
    '#rc{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;color:var(--text);font-size:13px;line-height:1.5}',
    '#rc *{box-sizing:border-box}',
    // buttons (จาก _shared_styles)
    '#rc .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#rc .btn:hover{border-color:var(--navy)}',
    '#rc .btn svg{width:14px;height:14px}',
    '#rc .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#rc .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#rc .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#rc .btn-sm{padding:5px 10px;font-size:12px}',
    '#rc .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:8px;background:#fff;color:var(--text-muted);cursor:pointer}',
    '#rc .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#rc .btn-help svg{width:14px;height:14px}',
    // page head (native บน dashboard · ไม่มี shell page-head เดิม)
    '#rc .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#rc .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#rc .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#rc .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#rc .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}',
    // stat cards
    '#rc .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#rc .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#rc .stats{grid-template-columns:repeat(2,1fr)}}',
    '#rc .stat-card{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;position:relative;overflow:hidden}',
    '#rc .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#rc .stat-card.applied::before{background:#1E40AF}',
    '#rc .stat-card.interview::before{background:#B45309}',
    '#rc .stat-card.offer::before{background:#4338CA}',
    '#rc .stat-card.hired::before{background:#166534}',
    '#rc .stat-card.rejected::before{background:#94A3B8}',
    '#rc .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#rc .stat-card .v{font-size:22px;font-weight:600;line-height:1;margin-top:4px;color:#0D2F4F;letter-spacing:-.02em}',
    '#rc .stat-card.applied .v{color:#1E40AF}',
    '#rc .stat-card.interview .v{color:#B45309}',
    '#rc .stat-card.offer .v{color:#4338CA}',
    '#rc .stat-card.hired .v{color:#166534}',
    '#rc .stat-card.rejected .v{color:var(--text-faint)}',
    // tabs
    '#rc .tabs{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}',
    '#rc .tab{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '#rc .tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#rc .tab svg{width:13px;height:13px}',
    '#rc .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#rc .tab.active .cnt{background:var(--navy)}',
    // filters
    '#rc .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}',
    '#rc .filter{display:flex;flex-direction:column;gap:2px}',
    '#rc .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#rc .filter input,#rc .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#rc .filter input:focus,#rc .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // pipeline
    '#rc .pipeline{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;min-height:400px}',
    '@media (max-width:1300px){#rc .pipeline{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:700px){#rc .pipeline{grid-template-columns:1fr}}',
    '#rc .col-header{padding:8px 10px;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;align-items:center;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}',
    '#rc .col-applied{background:#DBEAFE;color:#1E40AF}',
    '#rc .col-screening{background:#E0E7FF;color:#4338CA}',
    '#rc .col-interview{background:#FEF3C7;color:#92400E}',
    '#rc .col-offer{background:#EDE9FE;color:#5B21B6}',
    '#rc .col-hired{background:#DCFCE7;color:#166534}',
    '#rc .col-rejected{background:#F1F5F9;color:var(--text-muted)}',
    '#rc .col-cnt{padding:1px 7px;border-radius:10px;background:rgba(255,255,255,.7);font-size:10px}',
    '#rc .col-body{padding:6px;background:#F8FAFC;border-radius:0 0 6px 6px;border:.5px solid var(--border);border-top:0;max-height:600px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;min-height:200px;transition:background .15s}',
    '#rc .col-body.drag-over{background:#E6F7F5;outline:2px dashed #3DC5B7;outline-offset:-2px}',
    '#rc .cand-card{background:#fff;border:.5px solid var(--border);border-left:3px solid var(--navy-2);border-radius:4px;padding:8px 10px;cursor:grab;transition:all .15s}',
    '#rc .cand-card:hover{border-color:var(--navy-2);box-shadow:0 2px 4px rgba(0,0,0,.05)}',
    '#rc .cand-card.line-linked{border-left-color:#00B900}',
    '#rc .cand-card.dragging{opacity:.4;cursor:grabbing}',
    '#rc .cand-name{font-size:12px;font-weight:600}',
    '#rc .cand-meta{font-size:10px;color:var(--text-faint);margin-top:2px}',
    '#rc .cand-tags{display:flex;gap:3px;margin-top:4px;flex-wrap:wrap;font-size:9px}',
    '#rc .cand-tag{padding:1px 5px;border-radius:3px;background:#F1F5F9;color:var(--text-muted);font-weight:500}',
    '#rc .cand-tag.line{background:#DCFCE7;color:#15803D}',
    '#rc .cand-tag.score{background:#FEF3C7;color:#92400E}',
    // data table (จาก _shared_styles · scope #rc)
    '#rc .data-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:12px}',
    '#rc .data-table th{background:#F8FAFC;text-align:left;padding:9px 12px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#rc .data-table td{padding:9px 12px;border-bottom:1px solid var(--border);color:var(--text)}',
    '#rc .data-table tr:last-child td{border-bottom:0}',
    '#rc .data-table tr:hover td{background:#FAFBFC}',
  ].join('\n') + RC_CSS2();
}

/* CSS part 2 — modal / field / summary / pill / action-block / banner / misc */
function RC_CSS2() {
  return '\n' + [
    // modal
    '#rc .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#rc .modal-bg.active{display:flex}',
    '#rc .modal{background:#fff;border-radius:12px;max-width:720px;width:92%;max-height:92vh;overflow-y:auto}',
    '#rc .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#rc .modal-header h2{font-size:16px;margin:0}',
    '#rc .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#rc .modal-body{padding:16px 20px}',
    '#rc .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    // field
    '#rc .field{margin-bottom:12px}',
    '#rc .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#rc .field input,#rc .field select,#rc .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#rc .field input:focus,#rc .field select:focus,#rc .field textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#rc .field-help{font-size:10px;color:var(--text-faint);margin-top:3px}',
    '#rc .row{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    // summary grid
    '#rc .summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:14px;background:#F8FAFC;border-radius:8px;margin-bottom:14px}',
    '@media (max-width:600px){#rc .summary-grid{grid-template-columns:1fr 1fr}}',
    '#rc .summary-cell .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}',
    '#rc .summary-cell .v{font-size:13px;font-weight:500;margin-top:2px;word-break:break-word}',
    // pills
    '#rc .pill{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;display:inline-block}',
    '#rc .pill-open_position{background:#F1F5F9;color:var(--text-muted)}',
    '#rc .pill-applied{background:#DBEAFE;color:#1E40AF}',
    '#rc .pill-screening{background:#E0E7FF;color:#4338CA}',
    '#rc .pill-interview{background:#FEF3C7;color:#92400E}',
    '#rc .pill-offer{background:#EDE9FE;color:#5B21B6}',
    '#rc .pill-hired{background:#DCFCE7;color:#166534}',
    '#rc .pill-rejected{background:#FEE2E2;color:#991B1B}',
    // action block / banner / misc
    '#rc .action-block{background:#F8FAFC;padding:12px;border-radius:6px;margin-bottom:10px;border-left:3px solid #3DC5B7}',
    '#rc .action-block h4{margin:0 0 8px;font-size:12px;color:var(--text);text-transform:uppercase;letter-spacing:.04em}',
    '#rc .action-block p{font-size:11px;color:var(--text-muted);margin:0 0 8px}',
    '#rc .channel-banner{background:linear-gradient(135deg,#00B900 0%,#007e00 100%);color:#fff;padding:8px 14px;border-radius:6px;font-size:11px;margin-bottom:14px;display:flex;align-items:center;gap:8px}',
    '#rc .channel-banner strong{font-weight:600}',
    '#rc .empty-tab{padding:30px 20px;text-align:center;color:var(--text-muted);font-size:12px}',
    '#rc .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    '#rc .notes{background:#F8FAFC;padding:8px 10px;border-radius:4px;font-size:11px;color:var(--text-muted);white-space:pre-wrap;max-height:120px;overflow-y:auto;line-height:1.4}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + banner + stats + tabs + filters + content + 6 modals =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function RC_MARKUP() {
  return [
    // header
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    '      Recruit pipeline',
    '    </h1>',
    '    <div class="subtitle">candidates + LINE OA แยก channel · pipeline 6 stages</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn" data-tip="คู่มือการใช้หน้านี้"></button>',
    '    <button class="btn btn-sm" onclick="loadList()" id="refresh-btn"></button>',
    '    <button class="btn btn-primary" onclick="openIntake()" id="new-btn"></button>',
    '  </div>',
    '</header>',
    // banner
    '<div class="channel-banner">',
    '  <span style="width:8px;height:8px;border-radius:50%;background:white;display:inline-block"></span>',
    '  <span><strong>LINE OA แยก:</strong> candidates ติดต่อผ่าน <span id="recruit-oa-name">@yiaoya_recruit</span> · webhook routing แยกจาก main HR channel · ไม่ปะปนกับ LINE พนักงาน</span>',
    '</div>',
    '<div class="stats" id="stats"></div>',
    // tabs
    '<div class="tabs">',
    '  <button class="tab active" id="tab-active" onclick="setTab(\'active\')"></button>',
    '  <button class="tab" id="tab-hired" onclick="setTab(\'hired\')"></button>',
    '  <button class="tab" id="tab-rejected" onclick="setTab(\'rejected\')"></button>',
    '  <button class="tab" id="tab-all" onclick="setTab(\'all\')"></button>',
    '</div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ค้นหา</label>',
    '    <input type="search" id="filter-search" placeholder="ชื่อ / เบอร์ / email" oninput="loadDebounced()">',
    '  </div>',
    '  <div class="filter">',
    '    <label>ตำแหน่ง</label>',
    '    <select id="filter-position" onchange="loadList()"><option value="">ทุกตำแหน่ง</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>สมัครที่</label>',
    '    <select id="filter-branch" onchange="loadList()"><option value="">ทุกที่</option><option value="HQ">HQ (สำนักงานใหญ่)</option></select>',
    '  </div>',
    '</div>',
    '<div id="content" class="loading">กำลังโหลด...</div>',
    RC_MODALS(),
  ].join('\n');
}

/* 6 modals · คง element id เดิม */
function RC_MODALS() {
  return [
    // Intake
    '<div class="modal-bg" id="intake-bg" onclick="if(event.target===this)closeIntake()">',
    '  <div class="modal" style="max-width:520px">',
    '    <div class="modal-header"><h2>เพิ่ม candidate (manual)</h2><p>กรณี walk-in / referral · candidate ผ่าน LINE OA จะ auto-create ตอน Add OA</p></div>',
    '    <div class="modal-body">',
    '      <div class="field"><label>ชื่อ-นามสกุล *</label><input id="ik-name"></div>',
    '      <div class="row">',
    '        <div class="field"><label>เบอร์ / contact *</label><input id="ik-contact"></div>',
    '        <div class="field"><label>Email</label><input id="ik-email" type="email"></div>',
    '      </div>',
    '      <div class="row">',
    '        <div class="field"><label>ตำแหน่ง</label><select id="ik-position"></select></div>',
    '        <div class="field"><label>สาขาที่สมัคร</label><select id="ik-branch"></select></div>',
    '      </div>',
    '      <div class="field"><label>Source</label><select id="ik-source">',
    '        <option value="walk_in">walk_in — เดินมาสมัคร</option>',
    '        <option value="referral">referral — แนะนำ</option>',
    '        <option value="form">form — Google form</option>',
    '      </select></div>',
    '      <div class="field"><label>Resume URL</label><input id="ik-resume" type="url" placeholder="https://drive.google.com/..."></div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeIntake()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveIntake()" id="ik-save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
    // Detail
    '<div class="modal-bg" id="detail-bg" onclick="if(event.target===this)closeDetail()">',
    '  <div class="modal">',
    '    <div class="modal-header"><h2 id="d-title">กำลังโหลด...</h2><p id="d-sub">—</p></div>',
    '    <div class="modal-body">',
    '      <div class="summary-grid" id="d-summary"></div>',
    '      <div id="d-action-area"></div>',
    '      <div class="field">',
    '        <label>HR notes (ดูประวัติการสนทนา + การกระทำ)</label>',
    '        <textarea id="d-notes" rows="5"></textarea>',
    '        <button class="btn btn-sm" onclick="saveNotes()" style="margin-top:6px">บันทึก notes</button>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <div style="display:flex;gap:6px"><button class="btn" onclick="rejectCandidate()" style="color:var(--danger)">Reject</button></div>',
    '      <div style="display:flex;gap:6px;flex-wrap:wrap">',
    '        <select id="d-stage-select" onchange="changeStage()" style="padding:6px 10px;border:.5px solid var(--border-strong);border-radius:6px;font-size:12px">',
    '          <option value="open_position">open_position</option>',
    '          <option value="applied">applied</option>',
    '          <option value="screening">screening</option>',
    '          <option value="interview">interview</option>',
    '          <option value="offer">offer</option>',
    '          <option value="hired">hired</option>',
    '          <option value="rejected">rejected</option>',
    '        </select>',
    '        <button class="btn" onclick="closeDetail()">ปิด</button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>',
    // Invite
    '<div class="modal-bg" id="invite-bg" onclick="if(event.target===this)closeInvite()">',
    '  <div class="modal" style="max-width:480px">',
    '    <div class="modal-header"><h2>ส่ง LINE invite สัมภาษณ์</h2><p>candidate จะได้รับ flex มีปุ่ม "ยืนยัน" / "ขอเลื่อน"</p></div>',
    '    <div class="modal-body">',
    '      <div class="row">',
    '        <div class="field"><label>วันที่ *</label><input id="iv-date" type="date"></div>',
    '        <div class="field"><label>เวลา</label><input id="iv-time" placeholder="13:00"></div>',
    '      </div>',
    '      <div class="field"><label>สถานที่</label><input id="iv-location" placeholder="เยียวยา คลินิก สาขาลาดพร้าว ชั้น 2"></div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeInvite()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="confirmSendInvite()" id="iv-save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
    // Manual flex
    '<div class="modal-bg" id="flex-bg" onclick="if(event.target===this)closeFlexModal()">',
    '  <div class="modal" style="max-width:480px">',
    '    <div class="modal-header"><h2>ส่ง flex template</h2><p>เลือก template ที่จะ push ไปหา candidate ผ่าน LINE OA recruit</p></div>',
    '    <div class="modal-body">',
    '      <div class="field"><label>Template *</label><select id="fx-template" onchange="onFxTemplateChange()">',
    '        <option value="welcome">Welcome — บัตรต้อนรับพร้อม CTA</option>',
    '        <option value="branch_picker">Branch picker — เลือก HQ/สาขา</option>',
    '        <option value="positions">Positions — list ตำแหน่งใน branch ที่เลือก</option>',
    '        <option value="required_docs">Required docs — เอกสารของตำแหน่งปัจจุบัน</option>',
    '        <option value="mbti">MBTI test — ลิงก์ทำแบบทดสอบ</option>',
    '        <option value="custom_text">Custom text — ข้อความเอง</option>',
    '      </select></div>',
    '      <div class="field" id="fx-text-wrap" style="display:none"><label>ข้อความ</label><textarea id="fx-text" rows="4" placeholder="พิมพ์ข้อความที่จะส่ง..."></textarea></div>',
    '      <div class="field" id="fx-help" style="background:#F0FDFA;border:1px solid #99F6E4;border-radius:6px;padding:10px;color:#0F766E;font-size:11px;line-height:1.5"></div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeFlexModal()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="sendManualFlex()" id="fx-send-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
    // MBTI input
    '<div class="modal-bg" id="mbti-bg" onclick="if(event.target===this)closeMbtiModal()">',
    '  <div class="modal" style="max-width:380px">',
    '    <div class="modal-header"><h2>ใส่ผล MBTI</h2><p>กรณี candidate ส่งผลทางอื่น (อีเมล, walk-in)</p></div>',
    '    <div class="modal-body">',
    '      <div class="field"><label>ผล MBTI (4 ตัวอักษร) *</label>',
    '        <input id="mbti-input" placeholder="INTJ, ENFP, ISTJ ..." style="text-transform:uppercase;font-family:monospace;font-size:16px;letter-spacing:.1em">',
    '        <div class="field-help">เช่น INTJ, ENFP, ISTJ — ระบบจะ validate format</div>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeMbtiModal()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="saveMbti()" id="mbti-save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
    // Offer
    '<div class="modal-bg" id="offer-bg" onclick="if(event.target===this)closeOffer()">',
    '  <div class="modal" style="max-width:480px">',
    '    <div class="modal-header"><h2>ส่ง LINE offer letter</h2><p>candidate จะได้รับ flex มีปุ่ม "รับ" / "ปฏิเสธ"</p></div>',
    '    <div class="modal-body">',
    '      <div class="field"><label>ตำแหน่งที่ offer</label><select id="of-position"></select></div>',
    '      <div class="row">',
    '        <div class="field"><label>เงินเดือน (฿) *</label><input id="of-salary" type="number" min="0"></div>',
    '        <div class="field"><label>วันเริ่มงาน *</label><input id="of-start" type="date"></div>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="closeOffer()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="confirmSendOffer()" id="of-save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   RC_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → RC_BACKEND
   helper (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function RC_RUN_PAGE_JS() {

  // ---- google.script.run shim → RC_BACKEND (async, คืน shape เดิม) ----
  function _rc2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (RC_BACKEND[prop]) {
            Promise.resolve().then(function () { return RC_BACKEND[prop].apply(RC_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[RC_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[RC_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _rc2MakeChain(); } });

  // ---- helpers (inline · prefix rc ใน id เพื่อกันชน) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('rc2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'rc2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.rc2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('rc-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'rc-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'rc-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'rc-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม recruit_manager.html (ลอกทั้งดุ้น) =====
     ใช้ $ scope ใต้ #rc กันชน id (helper)
     ==================================================================== */
  const _rcRoot = document.getElementById('rc');
  function $id(id) { return _rcRoot ? _rcRoot.querySelector('#' + id) : document.getElementById(id); }
  // alias เพื่อให้โค้ดเดิม document.getElementById(...) ยังทำงาน → ใช้ getById ใน scope
  function getById(id) { return $id(id); }

  let currentTab = 'active';
  let allData = null;
  let currentDetail = null;
  let _searchDebounce = null;
  let allPositions = [];
  let allBranches = [];

  const HELP = {
    title: 'Recruit pipeline',
    subtitle: 'Sheet 30 + LINE OA แยก channel',
    intro: 'จัดการ candidates ตั้งแต่สมัคร → คัดกรอง → สัมภาษณ์ → offer → hire · ใช้ LINE OA แยกสำหรับ recruit (ไม่ปะปนกับ LINE OA พนักงาน)',
    sections: [
      { title: 'Pipeline 6 stages', items: [
        '<strong>open_position</strong> — เปิดรับ (ยังไม่มี candidate)',
        '<strong>applied</strong> — รับสมัครแล้ว · รอ HR คัดกรอง',
        '<strong>screening</strong> — กำลังคัดกรอง resume / โทรสัมภาษณ์',
        '<strong>interview</strong> — นัดสัมภาษณ์แล้ว',
        '<strong>offer</strong> — ส่ง offer แล้ว · รอตอบรับ',
        '<strong>hired</strong> — รับงาน → auto-create employee + เปิด onboarding case',
      ]},
      { title: 'LINE OA แยก channel', items: [
        'Script Properties: <code>LINE_RECRUIT_TOKEN</code> + <code>LINE_RECRUIT_CHANNEL_SECRET</code>',
        'Webhook URL ของ recruit OA → ใช้ URL เดียวกับ main (ระบบ detect channel จาก signature อัตโนมัติ)',
        'พนักงาน Add LINE OA ใหม่ → auto-create candidate row (stage=applied) + ส่ง welcome flex',
        'Postback "ดูตำแหน่งที่เปิดรับ" / "สถานะใบสมัคร" / "สมัคร <ตำแหน่ง>" ทำงานในเฉพาะ recruit channel',
        'HR ใน main channel จะได้รับ noti เมื่อมี candidate ใหม่/ตอบ offer',
      ]},
      { title: 'Workflow ปกติ', items: [
        '<strong>1. รับสมัคร</strong> — candidate Add OA เอง (auto) หรือ HR กด "เพิ่ม candidate" (manual)',
        '<strong>2. คัดกรอง</strong> — ดู resume + เปลี่ยน stage → screening · ใส่ score + notes',
        '<strong>3. นัดสัมภาษณ์</strong> — กด "ส่ง LINE invite" ใน detail modal · ใส่วัน/เวลา/สถานที่ → flex ส่งทันที',
        '<strong>4. ส่ง offer</strong> — กด "ส่ง LINE offer" · ใส่เงินเดือน + วันเริ่มงาน → flex มีปุ่ม รับ/ปฏิเสธ',
        '<strong>5. Hire</strong> — เปลี่ยน stage → hired (หรือกด Hire) · ระบบ auto-create employee + onboarding case',
      ]},
      { type: 'warn', title: 'ระวัง', items: [
        'ส่ง LINE ได้เฉพาะ candidate ที่มี line_user_id (Add OA แล้ว) — manual intake ไม่มี LINE',
        'Reject เปลี่ยน stage → rejected + ส่ง LINE ขอบคุณอัตโนมัติ',
        'เปลี่ยน stage → hired = irreversible (สร้าง employee แล้ว)',
        'หมายเหตุ: บน dashboard นี้เป็น read-only — การส่ง LINE / เขียนกลับยังไม่พร้อม',
      ]},
    ],
  };

  // ===== header / tab labels =====
  getById('refresh-btn').innerHTML = ICONS.refresh;
  getById('help-btn').innerHTML = ICONS.help;
  getById('new-btn').innerHTML = ICONS.plus + ' เพิ่ม candidate';
  getById('ik-save-btn').innerHTML = ICONS.save + ' บันทึก';
  getById('iv-save-btn').innerHTML = ICONS.bell + ' ส่ง LINE invite';
  getById('of-save-btn').innerHTML = ICONS.bell + ' ส่ง LINE offer';
  getById('fx-send-btn').innerHTML = ICONS.bell + ' Push flex';
  getById('mbti-save-btn').innerHTML = ICONS.save + ' บันทึก';

  getById('tab-active').innerHTML = ICONS.users + ' Active <span class="cnt" id="cnt-active">—</span>';
  getById('tab-hired').innerHTML = ICONS.check + ' Hired <span class="cnt" id="cnt-hired">—</span>';
  getById('tab-rejected').innerHTML = ICONS.close + ' Rejected <span class="cnt" id="cnt-rejected">—</span>';
  getById('tab-all').innerHTML = ICONS.list + ' ทั้งหมด';

  function loadDebounced() { clearTimeout(_searchDebounce); _searchDebounce = setTimeout(loadList, 300); }

  function setTab(tab) {
    currentTab = tab;
    _rcRoot.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
    getById('tab-' + tab).classList.add('active');
    loadList();
  }

  function loadList() {
    const opts = {
      tab: currentTab,
      search: getById('filter-search').value || '',
      position_id: getById('filter-position').value || '',
      branch_id: getById('filter-branch').value || '',
    };
    getById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(renderList)
      .withFailureHandler(err => {
        getById('content').innerHTML = '<div class="empty-tab">โหลดล้มเหลว: ' + escapeHtml(err.message) + '</div>';
      })
      .recruitAdminList(opts);
  }

  function renderList(res) {
    if (!res || res.error) {
      getById('content').innerHTML = '<div class="empty-tab">ผิดพลาด: ' + escapeHtml((res && res.error) || 'unknown') + '</div>';
      return;
    }
    allData = res;
    allPositions = res.positions || [];
    allBranches = res.branches || [];
    populateFilters();
    populateModalDropdowns();
    renderStats(res.stats || {});

    const items = res.items || [];
    if (!items.length) {
      getById('content').innerHTML = '<div class="empty-tab">ไม่มี candidate — กดปุ่ม "เพิ่ม candidate" เพื่อสร้าง</div>';
      return;
    }
    if (currentTab === 'active') {
      getById('content').innerHTML = renderPipeline(items);
    } else {
      getById('content').innerHTML = renderTable(items);
    }
  }

  function renderStats(s) {
    getById('stats').innerHTML = [
      statCard('total', 'ทั้งหมด', s.total || 0, ''),
      statCard('applied', 'Applied', s.applied || 0, 'applied'),
      statCard('interview', 'Interview', s.interview || 0, 'interview'),
      statCard('offer', 'Offer', s.offer || 0, 'offer'),
      statCard('hired', 'Hired', s.hired || 0, 'hired'),
      statCard('rejected', 'Rejected', s.rejected || 0, 'rejected'),
    ].join('');
    getById('cnt-active').textContent = s.active || 0;
    getById('cnt-hired').textContent = s.hired || 0;
    getById('cnt-rejected').textContent = s.rejected || 0;
  }

  function statCard(id, label, val, cls) {
    return '<div class="stat-card ' + cls + '"><div class="l">' + escapeHtml(label) + '</div><div class="v">' + val + '</div></div>';
  }

  function populateFilters() {
    const sel = getById('filter-position');
    if (sel.options.length === 1) {
      allPositions.forEach(p => {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = p.name;
        sel.appendChild(o);
      });
    }
    const sel2 = getById('filter-branch');
    if (sel2.options.length <= 2) {
      allBranches.forEach(b => {
        const o = document.createElement('option');
        o.value = b.id; o.textContent = b.name;
        sel2.appendChild(o);
      });
    }
  }

  function populateModalDropdowns() {
    const fillPos = (sel) => {
      if (!sel) return;
      sel.innerHTML = '<option value="">— เลือกตำแหน่ง —</option>' +
        allPositions.map(p => '<option value="' + escapeAttr(p.id) + '">' + escapeHtml(p.name) + '</option>').join('');
    };
    const fillBranch = (sel) => {
      if (!sel) return;
      sel.innerHTML = '<option value="">— เลือกสาขา —</option>' +
        allBranches.map(b => '<option value="' + escapeAttr(b.id) + '">' + escapeHtml(b.name) + '</option>').join('');
    };
    fillPos(getById('ik-position'));
    fillBranch(getById('ik-branch'));
    fillPos(getById('of-position'));
  }

  function renderPipeline(items) {
    const stages = [
      { key: 'applied',    label: 'Applied' },
      { key: 'screening',  label: 'Screening' },
      { key: 'interview',  label: 'Interview' },
      { key: 'offer',      label: 'Offer' },
      { key: 'hired',      label: 'Hired' },
      { key: 'rejected',   label: 'Rejected' },
    ];
    const grouped = {};
    stages.forEach(s => grouped[s.key] = []);
    items.forEach(it => { if (grouped[it.stage]) grouped[it.stage].push(it); });
    const cols = stages.map(s => {
      const cards = grouped[s.key].length
        ? grouped[s.key].map(renderCandCard).join('')
        : '<div style="font-size:10px;color:var(--text-faint);text-align:center;padding:14px 6px">ไม่มี</div>';
      return [
        '<div>',
          '<div class="col-header col-' + s.key + '">',
            '<span>' + escapeHtml(s.label) + '</span>',
            '<span class="col-cnt">' + grouped[s.key].length + '</span>',
          '</div>',
          '<div class="col-body" data-stage="' + escapeAttr(s.key) + '" ondragover="recruitDragOver(event)" ondragleave="recruitDragLeave(event)" ondrop="recruitDrop(event)">' + cards + '</div>',
        '</div>',
      ].join('');
    }).join('');
    return '<div class="pipeline">' + cols + '</div>';
  }

  function renderCandCard(c) {
    const cls = ['cand-card'];
    if (c.line_linked) cls.push('line-linked');
    const tags = [];
    if (c.line_linked) tags.push('<span class="cand-tag line">LINE</span>');
    if (c.score) tags.push('<span class="cand-tag score">score ' + escapeHtml(c.score) + '</span>');
    if (c.age_days !== null && c.age_days >= 7) tags.push('<span class="cand-tag">' + c.age_days + 'd</span>');
    return [
      '<div class="' + cls.join(' ') + '" draggable="true" data-cand="' + escapeAttr(c.candidate_id) + '" data-stage="' + escapeAttr(c.stage) + '"',
        ' ondragstart="recruitDragStart(event)" ondragend="recruitDragEnd(event)"',
        ' onclick="openDetail(\'' + escapeAttr(c.candidate_id) + '\')">',
        '<div class="cand-name">' + escapeHtml(c.name || '-') + '</div>',
        '<div class="cand-meta">' + escapeHtml(c.position_name || '-') + ' · ' + escapeHtml(c.branch_name || '-') + '</div>',
        '<div class="cand-meta">' + escapeHtml(c.contact || c.phone || c.email || '-') + '</div>',
        tags.length ? '<div class="cand-tags">' + tags.join('') + '</div>' : '',
      '</div>',
    ].join('');
  }

  /* HTML5 drag-drop handlers */
  let _dragCand = null;
  let _dragFromStage = null;
  function recruitDragStart(ev) {
    const card = ev.target.closest('.cand-card');
    if (!card) return;
    _dragCand = card.getAttribute('data-cand');
    _dragFromStage = card.getAttribute('data-stage');
    card.classList.add('dragging');
    ev.dataTransfer.effectAllowed = 'move';
    try { ev.dataTransfer.setData('text/plain', _dragCand); } catch (e) {}
  }
  function recruitDragEnd(ev) {
    const card = ev.target.closest('.cand-card');
    if (card) card.classList.remove('dragging');
    _rcRoot.querySelectorAll('.col-body.drag-over').forEach(c => c.classList.remove('drag-over'));
  }
  function recruitDragOver(ev) {
    if (!_dragCand) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    const col = ev.currentTarget;
    if (col) col.classList.add('drag-over');
  }
  function recruitDragLeave(ev) {
    const col = ev.currentTarget;
    if (col) col.classList.remove('drag-over');
  }
  function recruitDrop(ev) {
    ev.preventDefault();
    const col = ev.currentTarget;
    if (col) col.classList.remove('drag-over');
    if (!_dragCand) return;
    const toStage = col.getAttribute('data-stage');
    if (!toStage || toStage === _dragFromStage) { _dragCand = null; return; }
    if (toStage === 'hired') {
      if (!confirm('ย้ายไป Hired = สร้าง employee ทันที (irreversible) ยืนยัน?')) { _dragCand = null; return; }
    }
    if (toStage === 'rejected') {
      if (!confirm('ย้ายไป Rejected = ส่ง LINE ขอบคุณอัตโนมัติ ยืนยัน?')) { _dragCand = null; return; }
    }
    const candId = _dragCand;
    _dragCand = null;
    _dragFromStage = null;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.ok) loadList();
        else showToast('เปลี่ยน stage ล้มเหลว · ' + ((r && r.error) || 'unknown'), 'error');
      })
      .withFailureHandler(err => showToast('error: ' + err.message, 'error'))
      .recruitAdminMoveStage(candId, toStage, '', null);
  }

  function renderTable(items) {
    if (!items.length) return '<div class="empty-tab">ไม่มี</div>';
    let html = '<table class="data-table"><thead><tr>';
    html += '<th>ชื่อ</th><th>ตำแหน่ง</th><th>สาขา</th><th>contact</th><th>Source</th>';
    html += '<th>Stage</th><th>สมัครเมื่อ</th><th>Action</th></tr></thead><tbody>';
    items.forEach(c => {
      html += '<tr>';
      html += '<td><strong>' + escapeHtml(c.name || '-') + '</strong>' +
        (c.line_linked ? ' <span class="cand-tag line">LINE</span>' : '') + '</td>';
      html += '<td>' + escapeHtml(c.position_name || '-') + '</td>';
      html += '<td>' + escapeHtml(c.branch_name || '-') + '</td>';
      html += '<td>' + escapeHtml(c.contact || c.phone || '-') + '</td>';
      html += '<td>' + escapeHtml(c.source || '-') + '</td>';
      html += '<td><span class="pill pill-' + escapeAttr(c.stage) + '">' + escapeHtml(c.stage) + '</span></td>';
      html += '<td>' + escapeHtml(c.applied_at || '-') + '</td>';
      html += '<td><button class="btn btn-sm" onclick="openDetail(\'' + escapeAttr(c.candidate_id) + '\')">ดู</button></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  // ====== Intake ======
  function openIntake() {
    getById('intake-bg').classList.add('active');
    ['ik-name', 'ik-contact', 'ik-email', 'ik-resume'].forEach(id => getById(id).value = '');
    getById('ik-source').value = 'walk_in';
    populateModalDropdowns();
  }
  function closeIntake() { getById('intake-bg').classList.remove('active'); }
  function saveIntake() {
    const input = {
      name: getById('ik-name').value || '',
      contact: getById('ik-contact').value || '',
      email: getById('ik-email').value || '',
      position_id: getById('ik-position').value || '',
      branch_id: getById('ik-branch').value || '',
      source: getById('ik-source').value || 'walk_in',
      resume_url: getById('ik-resume').value || '',
    };
    if (!input.name) return showToast('ใส่ชื่อ', 'error');
    if (!input.contact) return showToast('ใส่ contact', 'error');
    getById('ik-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        getById('ik-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('เพิ่มแล้ว', 'success');
        closeIntake();
        loadList();
      })
      .withFailureHandler(err => {
        getById('ik-save-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .recruitAdminIntake(input);
  }

  // ====== Detail ======
  function openDetail(candidateId) {
    getById('detail-bg').classList.add('active');
    getById('d-title').textContent = 'กำลังโหลด...';
    getById('d-action-area').innerHTML = '<div class="loading">...</div>';
    google.script.run
      .withSuccessHandler(d => {
        if (!d || d.error) {
          getById('d-title').textContent = 'โหลดล้มเหลว';
          return showToast((d && d.error) || 'unknown', 'error');
        }
        currentDetail = d;
        renderDetail(d);
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .recruitAdminDetail(candidateId);
  }
  function closeDetail() { getById('detail-bg').classList.remove('active'); currentDetail = null; }

  function renderDetail(d) {
    getById('d-title').textContent = (d.name || '-') + ' · ' + d.candidate_id;
    getById('d-sub').textContent =
      d.position_name + ' · ' + d.branch_name + ' · source ' + (d.source || '-');
    getById('d-stage-select').value = d.stage;
    getById('d-notes').value = d.hr_notes || '';

    getById('d-summary').innerHTML = [
      summaryCell('Stage', '<span class="pill pill-' + escapeAttr(d.stage) + '">' + escapeHtml(d.stage) + '</span>'),
      summaryCell('LINE', d.line_user_id ? '<span class="cand-tag line">linked</span>' : '<span class="cand-tag">ไม่ได้ link</span>'),
      summaryCell('Contact', escapeHtml(d.contact || d.phone || d.email || '-')),
      summaryCell('สมัครเมื่อ', escapeHtml(d.applied_at || '-')),
      summaryCell('Score', escapeHtml(d.score || d.screening_score || '-')),
      summaryCell('Resume', d.resume_url ? '<a href="' + escapeAttr(d.resume_url) + '" target="_blank">เปิด</a>' : '-'),
    ].join('');

    let actions = '';

    if (d.line_user_id) {
      actions += '<div class="action-block" style="border-left-color:#3DC5B7"><h4>ส่ง LINE manual</h4>' +
        '<p>เลือก template ที่จะ push ไปหา candidate ตอนนี้ (ไม่กระทบ stage)</p>' +
        '<button class="btn btn-primary btn-sm" onclick="openFlexModal()">' + ICONS.bell + ' เลือก template ส่ง</button>' +
        (d.manual_flex_log ? '<div style="margin-top:8px;font-size:10px;color:var(--text-faint);line-height:1.5">ประวัติ: ' + escapeHtml(d.manual_flex_log.replace(/\|/g, ' · ')) + '</div>' : '') +
      '</div>';
    }

    if (d.mbti_test_sent_at || d.mbti_result) {
      actions += '<div class="action-block" style="border-left-color:#7C3AED"><h4>MBTI</h4>' +
        (d.mbti_result
          ? '<p>ผล: <strong style="font-family:monospace;font-size:14px;color:#5B21B6">' + escapeHtml(d.mbti_result) + '</strong> · บันทึกเมื่อ ' + escapeHtml(d.mbti_completed_at || '-') + '</p>'
          : '<p>ส่งลิงก์ MBTI ให้ candidate แล้วเมื่อ ' + escapeHtml(d.mbti_test_sent_at) + ' · รอผล</p>') +
        '<button class="btn btn-sm" onclick="openMbtiModal()">' + (d.mbti_result ? 'แก้ผล' : 'ใส่ผลเอง') + '</button>' +
      '</div>';
    } else if (d.line_user_id) {
      actions += '<div class="action-block" style="border-left-color:#7C3AED;background:#FAFAFF"><h4>MBTI (ยังไม่ส่ง)</h4>' +
        '<p>ถ้าตำแหน่งไม่ต้องการ MBTI auto ระบบจะข้าม · กดด้านล่างเพื่อส่ง manual</p>' +
        '<button class="btn btn-sm" onclick="quickSendMbti()">ส่งลิงก์ MBTI</button> ' +
        '<button class="btn btn-sm" onclick="openMbtiModal()">ใส่ผลเอง (ถ้าทำมาแล้ว)</button>' +
      '</div>';
    }

    if (!d.line_user_id) {
      actions += '<div class="action-block" style="border-left-color:var(--text-faint)"><h4>ไม่มี LINE</h4><p>candidate ยังไม่ได้ Add LINE OA recruit · HR ต้องส่งลิงก์ Add OA หรือสื่อสารผ่าน contact อื่น</p></div>';
    }
    if (d.stage === 'applied' || d.stage === 'screening') {
      if (d.line_user_id) {
        actions += '<div class="action-block"><h4>ส่ง interview invite</h4><p>กด "ส่ง LINE invite" ระบบจะเปลี่ยน stage → interview พร้อมส่ง flex</p>' +
          '<button class="btn btn-primary btn-sm" onclick="openInvite()">ส่ง LINE invite</button></div>';
      }
    }
    if (d.stage === 'interview') {
      if (d.interview_date) {
        actions += '<div class="action-block"><h4>นัดสัมภาษณ์</h4><p>วัน ' + escapeHtml(d.interview_date) + ' · เวลา ' + escapeHtml(d.interview_time || '-') +
          ' · สถานที่ ' + escapeHtml(d.interview_location || '-') +
          '<br>ส่ง invite เมื่อ ' + escapeHtml(d.interview_invite_sent_at || '-') + '</p>' +
          (d.line_user_id ? '<button class="btn btn-sm" onclick="openInvite()">ส่ง invite ใหม่</button> ' : '') +
          '<button class="btn btn-sm" onclick="moveStage(\'screening\')">กลับไป screening</button> ' +
          '<button class="btn btn-primary btn-sm" onclick="openOffer()">' + (d.line_user_id ? 'ส่ง offer ทาง LINE' : 'เปลี่ยนเป็น offer') + '</button></div>';
      } else {
        actions += '<div class="action-block"><h4>ยังไม่ส่ง invite</h4>' +
          (d.line_user_id ? '<button class="btn btn-primary btn-sm" onclick="openInvite()">ส่ง LINE invite</button>' : '<p>ไม่มี LINE — บันทึกวันนัดเองใน notes</p>') + '</div>';
      }
    }
    if (d.stage === 'offer') {
      actions += '<div class="action-block"><h4>Offer</h4><p>ส่งเมื่อ ' + escapeHtml(d.offered_at || '-') +
        ' · เงินเดือน ' + (d.offer_salary || 0).toLocaleString() + ' ฿' +
        ' · เริ่มงาน ' + escapeHtml(d.offer_start_date || '-') +
        ' · ตอบกลับ: <strong>' + escapeHtml(d.offer_response || 'pending') + '</strong></p>' +
        (d.offer_response === 'accepted' ?
          '<button class="btn btn-primary btn-sm" onclick="hireNow()">Hire เลย → สร้าง employee + onboarding case</button>' :
          '') + '</div>';
    }
    if (d.stage === 'hired') {
      actions += '<div class="action-block" style="border-left-color:var(--success)"><h4>Hired</h4><p>เริ่มงานเมื่อ ' + escapeHtml(d.hired_at || '-') +
        ' · ระบบสร้าง employee + onboarding case ให้แล้ว</p></div>';
    }
    if (d.stage === 'rejected') {
      actions += '<div class="action-block" style="border-left-color:var(--text-faint)"><h4>Rejected</h4><p>เหตุผล: ' + escapeHtml(d.rejection_reason || '-') + '</p></div>';
    }
    getById('d-action-area').innerHTML = actions;
  }

  function summaryCell(l, v) {
    return '<div class="summary-cell"><div class="l">' + escapeHtml(l) + '</div><div class="v">' + v + '</div></div>';
  }

  function changeStage() {
    const newStage = getById('d-stage-select').value;
    if (!currentDetail) return;
    if (newStage === currentDetail.stage) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('เปลี่ยน stage แล้ว', 'success');
        openDetail(currentDetail.candidate_id);
        loadList();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .recruitAdminMoveStage(currentDetail.candidate_id, newStage, '', null);
  }

  function moveStage(newStage) {
    if (!currentDetail) return;
    if (!confirm('เปลี่ยน stage เป็น ' + newStage + '?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        openDetail(currentDetail.candidate_id);
        loadList();
      })
      .recruitAdminMoveStage(currentDetail.candidate_id, newStage, '', null);
  }

  function saveNotes() {
    if (!currentDetail) return;
    const notes = getById('d-notes').value || '';
    google.script.run
      .withSuccessHandler(() => showToast('บันทึก notes แล้ว', 'success'))
      .withFailureHandler(err => showToast(err.message, 'error'))
      .recruitAdminUpdateCandidate(currentDetail.candidate_id, { hr_notes: notes });
  }

  function rejectCandidate() {
    if (!currentDetail) return;
    const reason = prompt('เหตุผล (จะส่ง LINE ขอบคุณให้ candidate ถ้ามี LINE):');
    if (reason === null) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('Reject แล้ว', 'success');
        closeDetail();
        loadList();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .recruitAdminReject(currentDetail.candidate_id, reason);
  }

  function hireNow() {
    if (!currentDetail) return;
    const startDate = prompt('วันเริ่มงาน (YYYY-MM-DD):',
      currentDetail.offer_start_date || new Date().toISOString().slice(0, 10));
    if (!startDate) return;
    const email = prompt('Email work (สำหรับสร้าง employee):', currentDetail.email);
    if (!confirm('Hire ' + currentDetail.name + '? · ระบบจะสร้าง employee + onboarding case')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('Hire สำเร็จ — สร้าง onboarding case แล้ว', 'success');
        closeDetail();
        loadList();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .recruitAdminHire(currentDetail.candidate_id, { start_date: startDate, email: email });
  }

  // ====== Invite modal ======
  function openInvite() {
    if (!currentDetail) return;
    getById('invite-bg').classList.add('active');
    getById('iv-date').value = currentDetail.interview_date || '';
    getById('iv-time').value = currentDetail.interview_time || '13:00';
    getById('iv-location').value = currentDetail.interview_location || '';
  }
  function closeInvite() { getById('invite-bg').classList.remove('active'); }
  function confirmSendInvite() {
    if (!currentDetail) return;
    const opts = {
      interview_date: getById('iv-date').value || '',
      interview_time: getById('iv-time').value || '',
      interview_location: getById('iv-location').value || '',
    };
    if (!opts.interview_date) return showToast('ใส่วัน', 'error');
    getById('iv-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        getById('iv-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ส่ง LINE invite แล้ว', 'success');
        closeInvite();
        openDetail(currentDetail.candidate_id);
        loadList();
      })
      .withFailureHandler(err => {
        getById('iv-save-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .recruitAdminSendInterviewInvite(currentDetail.candidate_id, opts);
  }

  // ====== Offer modal ======
  function openOffer() {
    if (!currentDetail) return;
    getById('offer-bg').classList.add('active');
    populateModalDropdowns();
    getById('of-position').value = currentDetail.position_id || '';
    getById('of-salary').value = currentDetail.offer_salary || '';
    getById('of-start').value = currentDetail.offer_start_date || '';
  }
  function closeOffer() { getById('offer-bg').classList.remove('active'); }
  function confirmSendOffer() {
    if (!currentDetail) return;
    const opts = {
      position_id: getById('of-position').value || currentDetail.position_id,
      salary: getById('of-salary').value || 0,
      start_date: getById('of-start').value || '',
    };
    if (!opts.salary) return showToast('ใส่เงินเดือน', 'error');
    if (!opts.start_date) return showToast('ใส่วันเริ่ม', 'error');
    getById('of-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        getById('of-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ส่ง LINE offer แล้ว', 'success');
        closeOffer();
        openDetail(currentDetail.candidate_id);
        loadList();
      })
      .withFailureHandler(err => {
        getById('of-save-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .recruitAdminSendOffer(currentDetail.candidate_id, opts);
  }

  // ===== Manual flex modal =====
  const FLEX_HELP = {
    welcome: 'การ์ดต้อนรับ + stats + 2 ปุ่ม CTA · ใช้ตอน candidate เพิ่ง Add OA หรือลืมเริ่มต้น',
    branch_picker: 'Carousel เลือก HQ/สาขา · ส่งซ้ำได้ถ้า candidate กดผิด',
    positions: 'List ตำแหน่งใน branch ที่ candidate เลือก (ใช้ target_branch_id ของเขา)',
    required_docs: 'รายการเอกสาร + tip · ใช้ถ้าเขาลืมส่ง',
    mbti: 'ลิงก์ทำ MBTI · ใช้กับพนักงานปกติ (ไม่ใช่หมอ) · ระบบจะ mark mbti_test_sent_at ให้',
    custom_text: 'ส่งข้อความเอง (ไม่ใช่ flex) · เหมาะสำหรับตอบคำถามเฉพาะ',
  };

  function openFlexModal() {
    if (!currentDetail) return;
    getById('flex-bg').classList.add('active');
    getById('fx-template').value = 'welcome';
    getById('fx-text').value = '';
    onFxTemplateChange();
  }
  function closeFlexModal() { getById('flex-bg').classList.remove('active'); }
  function onFxTemplateChange() {
    const v = getById('fx-template').value;
    getById('fx-text-wrap').style.display = (v === 'custom_text') ? '' : 'none';
    getById('fx-help').textContent = FLEX_HELP[v] || '';
  }
  function sendManualFlex() {
    if (!currentDetail) return;
    const tpl = getById('fx-template').value;
    const opts = {};
    if (tpl === 'custom_text') {
      opts.text = getById('fx-text').value || '';
      if (!opts.text) return showToast('ใส่ข้อความ', 'error');
    }
    getById('fx-send-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        getById('fx-send-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ส่ง flex แล้ว', 'success');
        closeFlexModal();
        openDetail(currentDetail.candidate_id);
      })
      .withFailureHandler(err => {
        getById('fx-send-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .recruitAdminSendManualFlex(currentDetail.candidate_id, tpl, opts);
  }

  function quickSendMbti() {
    if (!currentDetail) return;
    if (!confirm('ส่งลิงก์ MBTI ให้ candidate ผ่าน LINE?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ส่ง MBTI แล้ว', 'success');
        openDetail(currentDetail.candidate_id);
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .recruitAdminSendManualFlex(currentDetail.candidate_id, 'mbti', {});
  }

  // ===== MBTI input modal =====
  function openMbtiModal() {
    if (!currentDetail) return;
    getById('mbti-bg').classList.add('active');
    getById('mbti-input').value = currentDetail.mbti_result || '';
  }
  function closeMbtiModal() { getById('mbti-bg').classList.remove('active'); }
  function saveMbti() {
    if (!currentDetail) return;
    const v = (getById('mbti-input').value || '').toUpperCase().trim();
    if (!/^[IE][NS][TF][JP]$/.test(v)) return showToast('ผล MBTI ต้องเป็น 4 ตัวอักษร เช่น INTJ, ENFP', 'error');
    getById('mbti-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        getById('mbti-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('บันทึก MBTI แล้ว', 'success');
        closeMbtiModal();
        openDetail(currentDetail.candidate_id);
      })
      .withFailureHandler(err => {
        getById('mbti-save-btn').disabled = false;
        showToast(err.message, 'error');
      })
      .recruitAdminSetMbti(currentDetail.candidate_id, v);
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp, HELP, loadList, loadDebounced, setTab,
    openIntake, closeIntake, saveIntake,
    openDetail, closeDetail, changeStage, moveStage, saveNotes, rejectCandidate, hireNow,
    openInvite, closeInvite, confirmSendInvite,
    openOffer, closeOffer, confirmSendOffer,
    openFlexModal, closeFlexModal, onFxTemplateChange, sendManualFlex, quickSendMbti,
    openMbtiModal, closeMbtiModal, saveMbti,
    recruitDragStart, recruitDragEnd, recruitDragOver, recruitDragLeave, recruitDrop,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadList();
  // Pull recruit OA name from settings
  google.script.run.withSuccessHandler(name => {
    if (name) { const el = getById('recruit-oa-name'); if (el) el.textContent = name; }
  }).recruitGetOaName();
}
