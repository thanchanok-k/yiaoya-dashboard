// _ported/kpimgr.js — FULL native port of desktop kpi_manager.html (HR KPI admin)
// ลอกทั้งดุ้น: 7 tab (Templates/Overrides/Periods/Scores/Aggregates/Feeders/Log) + 6 modals + setup wizard
//   CSS เดิม (_shared_styles + <style> หน้า manager) prefix #km ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ mountKpimgr() · google.script.run = shim → KM_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน mountKpimgr
//
// backend จริงบน Supabase ที่มี (read-only):
//   - sb.functions.invoke('hr_list?type=kpi.scored')  → {items}  → Scores tab
//   - sb.functions.invoke('hr_kpi_summary')            → {overall_avg, by_branch, by_employee, top5, bottom5} → Aggregates tab
//   - whoami → {ok:true, is_owner:true}
// feature ที่ backend เขียนกลับไม่ได้ (templates/overrides/periods/feeders admin · calc/seed/finalize/override) → stub + toast

/* ============================================================
   KM_BACKEND — map google.script.run → Supabase
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (อ่านจาก loadScores/loadAggregates ฯลฯ)
   ============================================================ */
function km2Num(v, d) { var n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); }
function km2Str(v) { return v == null ? '' : String(v); }

// map kpi.scored payload → row shape ที่ loadScores เดิมใช้
function km2MapScore(p) {
  p = p || {};
  return {
    score_id: km2Str(p.score_id),
    period_id: km2Str(p.period_id),
    employee_id: km2Str(p.employee_id),
    employee_name: km2Str(p.employee_name || p.employee_id),
    tpl_id: km2Str(p.tpl_id),
    tpl_name: km2Str(p.tpl_name || p.tpl_id),
    target: km2Num(p.target),
    actual: km2Num(p.actual),
    raw_score: km2Num(p.raw_score),
    weighted_score: km2Num(p.weighted_score),
    branch_id: km2Str(p.branch_id),
    data_source_used: km2Str(p.data_source_used || p.data_source || '—'),
  };
}

// grade จากคะแนนรวม (~0-100) — mirror KPIEngine A/B/C/D/F
function km2Grade(score) {
  var s = Number(score) || 0;
  if (s >= 85) return 'A';
  if (s >= 70) return 'B';
  if (s >= 55) return 'C';
  if (s >= 40) return 'D';
  return 'F';
}

// invoke helper — รองรับทั้ง 'fn?query=...' (อ่าน query) และ body
function km2Invoke(fnWithQuery, opts) {
  return sb.functions.invoke(fnWithQuery, opts || {}).then(function (res) {
    if (res && res.error) throw new Error((res.error && res.error.message) || String(res.error));
    return (res && res.data) || {};
  });
}

var KM_BACKEND = {
  // role gate — user dashboard = admin/owner เต็มสิทธิ์
  kpiAdminWhoAmI: function () { return Promise.resolve({ ok: true, is_owner: true, role: 'owner' }); },

  // ===== READ จริง =====
  // Scores — { items:[...] } จาก hr_list?type=kpi.scored
  kpiAdminListScores: function (opts) {
    opts = opts || {};
    return km2Invoke('hr_list?type=kpi.scored&limit=3000').then(function (data) {
      var items = (data.items || []).map(km2MapScore);
      if (opts.period_id) items = items.filter(function (s) { return s.period_id === opts.period_id || s.period_id.indexOf(opts.period_id) === 0; });
      if (opts.employee_id) items = items.filter(function (s) { return s.employee_id === opts.employee_id; });
      return { items: items };
    });
  },
  // Aggregates — derive จาก hr_kpi_summary (by_employee = คะแนนรวมงวดล่าสุดต่อคน)
  kpiAdminListAggregates: function (opts) {
    opts = opts || {};
    return km2Invoke('hr_kpi_summary').then(function (data) {
      var emps = data.by_employee || [];
      var items = emps.map(function (e) {
        var score = km2Num(e.latest_score);
        return {
          employee_id: km2Str(e.employee_id),
          employee_name: km2Str(e.name || e.employee_id),
          position_id: km2Str(e.position_id || '-'),
          branch_name: km2Str(e.branch_id || '—'),
          period_id: km2Str(e.latest_period || ''),
          total_weighted_score: score,
          grade: km2Grade(score),
          trend: 'flat',
          bonus_eligibility: score >= 85,
        };
      });
      if (opts.period_id) items = items.filter(function (a) { return a.period_id === opts.period_id || a.period_id.indexOf(opts.period_id) === 0; });
      var dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
      items.forEach(function (a) { dist[a.grade] = (dist[a.grade] || 0) + 1; });
      var avg = items.length ? Math.round(items.reduce(function (s, a) { return s + a.total_weighted_score; }, 0) / items.length * 10) / 10 : (data.overall_avg || 0);
      return {
        items: items,
        stats: {
          total: items.length, avg_score: avg,
          bonus_eligible: items.filter(function (a) { return a.bonus_eligibility; }).length,
          grade_distribution: dist,
        },
      };
    });
  },

  // ===== STUB (เขียนกลับไม่ได้บน dashboard — read-only shadow) =====
  // Templates — คืนว่าง + แจ้ง (ไม่มี kpi.template event บน Supabase)
  kpiAdminListTemplates: function () {
    return Promise.resolve({ items: [], positions: [], position_weights: [], stats: { total: 0 } });
  },
  kpiAdminListOverrides: function () { return Promise.resolve({ items: [], templates: [], branches: [] }); },
  kpiAdminListPeriods: function () { return Promise.resolve({ items: [] }); },
  kpiAdminListFeeders: function () { return Promise.resolve({ items: [], templates: [] }); },
  kpiAdminListLog: function () { return Promise.resolve({ items: [], total_in_log: 0 }); },

  // mutations / calc — stub แจ้งยังไม่พร้อม
  kpiAdminAddTemplate: function () { return km2NotReadyP('เพิ่ม KPI template'); },
  kpiAdminUpdateTemplate: function () { return km2NotReadyP('แก้ KPI template'); },
  kpiAdminApproveTemplate: function () { return km2NotReadyP('approve template'); },
  kpiAdminApprovePosition: function () { return km2NotReadyP('approve ทั้งตำแหน่ง'); },
  kpiAdminArchiveTemplate: function () { return km2NotReadyP('archive template'); },
  kpiAdminApplyPositionSetup: function () { return km2NotReadyP('ตั้งค่า KPI รายตำแหน่ง'); },
  kpiAdminSeedTemplates: function () { return km2NotReadyP('Seed KPI ตั้งต้น'); },
  kpiAdminAddOverride: function () { return km2NotReadyP('เพิ่ม branch override'); },
  kpiAdminRemoveOverride: function () { return km2NotReadyP('ลบ override'); },
  kpiAdminAddPeriod: function () { return km2NotReadyP('สร้าง period'); },
  kpiAdminNormalizePeriods: function () { return km2NotReadyP('จัดการ period'); },
  kpiAdminBackfillPeriods: function () { return km2NotReadyP('สร้าง period ย้อนหลัง'); },
  kpiAdminRecalcPeriod: function () { return km2NotReadyP('Recalc period'); },
  kpiAdminFinalizePeriod: function () { return km2NotReadyP('Finalize period'); },
  kpiAdminReopenPeriod: function () { return km2NotReadyP('Reopen period'); },
  kpiAdminRunMonthly: function () { return km2NotReadyP('Run monthly calc'); },
  kpiAdminRunForPeriod: function () { return km2NotReadyP('คิด KPI ย้อนหลัง'); },
  kpiAdminRunAllPeriods: function () { return km2NotReadyP('คิด KPI ย้อนหลังทั้งหมด'); },
  kpiAdminFoSyncNow: function () { return km2NotReadyP('ดึงข้อมูลหน้าบ้าน'); },
  kpiAdminOverrideScore: function () { return km2NotReadyP('override actual'); },
  kpiAdminAddFeeder: function () { return km2NotReadyP('เพิ่ม feeder'); },
  kpiAdminUpdateFeeder: function () { return km2NotReadyP('แก้ feeder'); },
  kpiAdminTestFeeder: function () { return km2NotReadyP('test feeder'); },
  kpiAdminRemoveFeeder: function () { return km2NotReadyP('ลบ feeder'); },
};

var _km2NotReadyShown = {};
function km2NotReady(feature) {
  if (_km2NotReadyShown[feature]) return;
  _km2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.km2Toast) window.km2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard (read-only shadow)', 'error');
}
function km2NotReadyP(feature) { km2NotReady(feature); return Promise.resolve({ error: 'ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard — ระบบ KPI เขียนกลับต้องทำผ่าน HR Apps Script' }); }

/* ============================================================
   mountKpimgr — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountKpimgr() {
  var wrap = document.getElementById('wrap-kpimgr');
  if (!wrap) return;

  wrap.innerHTML = '<style>' + KM2_CSS() + '</style><div id="km">' + KM2_MARKUP() + '</div>';

  // รัน JS ของหน้าเดิม (closure scope · google = shim) → ผูก fn ที่ inline onclick ต้องใช้ ลง window
  KM2_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles + <style> manager) · prefix ทุก selector ด้วย #km =====
   ตัด .app-shell/sidebar/topbar/main-area shell ออก (dashboard มี shell แล้ว) · คง class เดิมทั้งหมด */
function KM2_CSS() {
  return [
    // tokens (จาก _shared_styles · เดิมอยู่ :root)
    '#km{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--teal-bg:#E6F7F5;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--success:#047857;--warning:#B45309;--info:#1D4ED8;color:var(--text);font-size:13px;line-height:1.5}',
    '#km *{box-sizing:border-box}',

    // shared buttons / fields (จาก _shared_styles)
    '#km .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#km .btn:hover{border-color:var(--navy)}',
    '#km .btn svg{width:14px;height:14px}',
    '#km .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#km .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#km .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#km .btn-sm{padding:5px 10px;font-size:12px}',
    '#km .btn-help{width:30px;height:30px;padding:0;border:1px solid var(--border-strong);border-radius:6px;background:var(--surface);color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
    '#km .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#km .btn-help svg{width:14px;height:14px}',
    '#km code{font-family:monospace}',
    '#km h3{color:var(--navy)}',

    // page-head (เดิม) → ใช้เป็นหัวหน้าในกล่อง
    '#km .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#km .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#km .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#km .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#km .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}',
    '#km .page-badge{background:#DBEAFE;color:#1E40AF;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600;align-self:center}',

    // stats / tabs
    '#km .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:900px){#km .stats{grid-template-columns:repeat(2,1fr)}}',
    '#km .stat-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px}',
    '#km .stat-card .l{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#km .stat-card .v{font-size:22px;font-weight:600;line-height:1;margin-top:4px}',
    '#km .stat-card.draft .v{color:var(--warning)}',
    '#km .stat-card.archived .v{color:var(--text-faint)}',
    '#km .tabs{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap;overflow-x:auto}',
    '#km .tab{padding:6px 14px;border:0;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}',
    '#km .tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#km .tab svg{width:13px;height:13px}',
    '#km .tab .cnt{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:#fff;font-weight:600}',
    '#km .tab.active .cnt{background:var(--navy)}',

    // filters
    '#km .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:end}',
    '#km .filter{display:flex;flex-direction:column;gap:2px}',
    '#km .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#km .filter input,#km .filter select{padding:4px 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:140px}',

    // pills
    '#km .pill{padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;display:inline-block}',
    '#km .pill-draft{background:#FEF3C7;color:#92400E}',
    '#km .pill-approved{background:#DCFCE7;color:#166534}',
    '#km .pill-archived{background:#F1F5F9;color:var(--text-muted)}',
    '#km .pill-active{background:#DBEAFE;color:#1E40AF}',
    '#km .pill-inactive{background:#F1F5F9;color:var(--text-muted)}',
    '#km .pill-monthly{background:#DBEAFE;color:#1E40AF}',
    '#km .pill-quarterly{background:#EDE9FE;color:#5B21B6}',
    '#km .pill-yearly{background:#FCE7F3;color:#BE185D}',
    '#km .pill-open{background:#DBEAFE;color:#1E40AF}',
    '#km .pill-calculated{background:#FEF3C7;color:#92400E}',
    '#km .pill-finalized{background:#DCFCE7;color:#166534}',
    '#km .pill-A{background:#166534;color:#fff}',
    '#km .pill-B{background:#15803D;color:#fff}',
    '#km .pill-C{background:#B45309;color:#fff}',
    '#km .pill-D{background:#DC2626;color:#fff}',
    '#km .pill-F{background:#7F1D1D;color:#fff}',
    '#km .pill-up{background:#DCFCE7;color:#166534}',
    '#km .pill-down{background:#FEE2E2;color:#991B1B}',
    '#km .pill-flat{background:#F1F5F9;color:var(--text-muted)}',
    '#km .pill-ok{background:#DCFCE7;color:#166534}',
    '#km .pill-error{background:#FEE2E2;color:#991B1B}',

    // weight banner
    '#km .weight-banner{background:#fff;border:.5px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:12px}',
    '#km .weight-banner h4{margin:0 0 8px;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#km .weight-row{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px}',
    '#km .weight-row.warn{color:var(--danger)}',
    '#km .weight-row .pos-name{flex:1}',
    '#km .weight-row .total{font-weight:600;min-width:50px;text-align:right}',
    '#km .weight-row .indicator{width:14px;height:14px;border-radius:50%;background:var(--success);display:inline-block}',
    '#km .weight-row.warn .indicator{background:var(--danger)}',
    '#km .weight-row.clickable{cursor:pointer;padding:5px 8px;margin:0 -8px;border-radius:6px;transition:background .12s}',
    '#km .weight-row.clickable:hover{background:#E6F7F5}',
    '#km .weight-row.clickable:focus-visible{outline:2px solid var(--teal);outline-offset:1px}',
    '#km .weight-row.active{background:#E6F7F5}',
    '#km .weight-row .wr-caret{color:var(--text-faint);font-size:15px;line-height:1;margin-left:2px;transition:color .12s,transform .12s}',
    '#km .weight-row.clickable:hover .wr-caret,#km .weight-row.active .wr-caret{color:var(--teal-dark)}',
    '#km .weight-row.active .wr-caret{transform:rotate(90deg)}',

    // data table
    '#km .data-table{width:100%;border-collapse:collapse;font-size:13px;background:var(--surface);border:.5px solid var(--border);border-radius:8px;overflow:hidden}',
    '#km .data-table thead th{background:#F8FAFC;padding:9px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:5}',
    '#km .data-table thead th.num{text-align:right}',
    '#km .data-table tbody td{padding:10px 12px;border-bottom:1px solid #F1F5F9;vertical-align:middle}',
    '#km .data-table tbody td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
    '#km .data-table tbody tr{transition:background .15s}',
    '#km .data-table tbody tr:hover:not(.grp-row){background:var(--teal-bg)}',
    '#km .data-table tr.grp-row td{background:#EEF4F7;border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:7px 12px}',
    '#km .grp-name{font-weight:600;color:var(--navy);font-size:12px}',
    '#km .grp-id{font-family:monospace;font-size:10px;color:var(--text-faint);margin-left:6px}',
    '#km .grp-meta{float:right;display:inline-flex;gap:10px;align-items:center;font-size:11px;color:var(--text-muted)}',
    '#km .grp-w{font-weight:600;padding:1px 9px;border-radius:10px}',
    '#km .grp-w.ok{background:#DCFCE7;color:#166534}',
    '#km .grp-w.warn{background:#FEE2E2;color:#991B1B}',
    '#km .data-table tbody td.act{white-space:nowrap;text-align:right;width:1%}',
    '#km .row-actions{display:flex;gap:4px;justify-content:flex-end;flex-wrap:nowrap;white-space:nowrap}',
    '#km .grp-approve{margin-left:12px}',

    // modal (scope ใต้ #km · z-index สูง)
    '#km .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000}',
    '#km .modal-bg.active{display:flex}',
    '#km .modal{background:#fff;border-radius:12px;max-width:580px;width:92%;max-height:92vh;overflow-y:auto}',
    '#km .modal.large{max-width:760px}',
    '#km .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#km .modal-header h2{font-size:16px;margin:0;color:var(--text)}',
    '#km .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#km .modal-body{padding:16px 20px}',
    '#km .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}',
    '#km .field{margin-bottom:12px}',
    '#km .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#km .field input,#km .field select,#km .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box}',
    '#km .field-help{font-size:10px;color:var(--text-faint);margin-top:3px}',
    '#km .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '#km .row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}',
    '@media (max-width:600px){#km .row2,#km .row3{grid-template-columns:1fr}}',

    // aggregate grade grid
    '#km .grade-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px}',
    '#km .grade-card{background:#fff;border:.5px solid var(--border);border-radius:8px;padding:14px;text-align:center}',
    '#km .grade-card .grade-letter{font-size:28px;font-weight:800;line-height:1}',
    '#km .grade-card .grade-count{font-size:18px;font-weight:600;margin-top:6px}',
    '#km .grade-card .grade-label{font-size:10px;color:var(--text-muted);margin-top:2px;text-transform:uppercase;letter-spacing:.05em}',
    '#km .grade-A .grade-letter{color:#166534}',
    '#km .grade-B .grade-letter{color:#15803D}',
    '#km .grade-C .grade-letter{color:#B45309}',
    '#km .grade-D .grade-letter{color:#DC2626}',
    '#km .grade-F .grade-letter{color:#7F1D1D}',

    '#km .empty-tab{padding:30px 20px;text-align:center;color:var(--text-muted);font-size:12px}',
    '#km .formula{font-family:monospace;font-size:10px;background:#F1F5F9;padding:2px 6px;border-radius:3px}',
    '#km .loading{text-align:center;padding:40px;color:var(--text-muted);font-size:13px}',

    // log entry
    '#km .log-entry{background:#fff;border:.5px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:6px;font-size:12px}',
    '#km .log-entry .log-meta{display:flex;gap:10px;align-items:center;margin-bottom:4px;flex-wrap:wrap;font-size:11px;color:var(--text-muted)}',
    '#km .log-entry .log-action{padding:1px 7px;border-radius:8px;background:#DBEAFE;color:#1E40AF;font-size:10px;font-weight:600}',
    '#km .log-entry .log-json{font-family:monospace;font-size:10px;color:var(--text-muted);background:#F8FAFC;padding:6px 8px;border-radius:3px;margin-top:4px;word-break:break-all;max-height:80px;overflow-y:auto}',

    // templates controls + setup wizard
    '#km .tpl-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}',
    '#km .tpl-controls select{padding:6px 10px;border:.5px solid var(--border);border-radius:6px;font-size:12px;background:#fff}',
    '#km .seg{display:inline-flex;border:.5px solid var(--border);border-radius:6px;overflow:hidden}',
    '#km .seg button{border:0;background:#fff;padding:6px 14px;font-size:12px;cursor:pointer;color:var(--text-muted)}',
    '#km .seg button.on{background:var(--navy);color:#fff;font-weight:600}',
    '#km .wz-head,#km .wz-row{display:grid;grid-template-columns:30px 1fr 84px 116px;gap:8px;align-items:center}',
    '#km .wz-head{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;padding-bottom:6px;border-bottom:.5px solid var(--border)}',
    '#km .wz-row{padding:8px 0;border-bottom:1px solid #F1F5F9}',
    '#km .wz-row.off{opacity:.42}',
    '#km .wz-row input[type=number]{width:100%;padding:5px 7px;border:.5px solid var(--border);border-radius:5px;font-size:12px}',
    '#km .wz-row .wz-name{font-size:12px;font-weight:500}',
    '#km .wz-row .wz-src{font-size:10px;color:var(--text-faint)}',
    '#km .wz-sum{display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding:10px 12px;border-radius:6px;background:#F8FAFC;font-size:13px}',
    '#km .wz-sum.ok{background:#DCFCE7;color:#166534}',
    '#km .wz-sum.warn{background:#FEF3C7;color:#92400E}',

    // kpi chart view
    '#km .kpi-chart{background:var(--surface);border:.5px solid var(--border);border-radius:8px;padding:16px 18px}',
    '#km .chart-legend{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:16px;font-size:11px;color:var(--text-muted)}',
    '#km .chart-legend .lg{display:inline-flex;align-items:center;gap:5px}',
    '#km .chart-legend .sw{width:11px;height:11px;border-radius:3px;display:inline-block}',
    '#km .chart-row{margin-bottom:15px}',
    '#km .chart-pos{font-size:12px;font-weight:600;color:var(--navy);margin-bottom:5px;display:flex;align-items:center;gap:8px}',
    '#km .chart-sum{font-size:10px;font-weight:600;color:#92400E;background:#FEF3C7;padding:1px 8px;border-radius:10px}',
    '#km .chart-sum.ok{color:#166534;background:#DCFCE7}',
    '#km .chart-bar{display:flex;height:26px;border-radius:6px;overflow:hidden;background:#F1F5F9}',
    '#km .seg2{display:flex;align-items:center;justify-content:center;min-width:2px;cursor:default;transition:opacity .15s}',
    '#km .seg2:hover{opacity:.82}',
    '#km .seg2 span{color:#fff;font-size:10px;font-weight:600}',
    '#km .wz-bar{display:flex;height:22px;border-radius:6px;overflow:hidden;background:#F1F5F9;margin-top:14px}',

    // help modal (เหมือน announce)
    '#km .help-section{background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid var(--border-strong)}',
    '#km .help-section.help-section-warn{background:#FFFBEB;border-left-color:var(--warning)}',
    '#km .help-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก section + 6 modals + wizard · คง element id เดิม =====
   ตัด app-shell/sidebar/sheet_link/brand_footer · header เปลี่ยนเป็น .page-head ในกล่อง */
function KM2_MARKUP() {
  return KM2_HEADER() + KM2_TABS() + '<div id="content" class="loading">กำลังโหลด...</div>' +
    KM2_TPL_MODAL() + KM2_OVR_MODAL() + KM2_PRD_MODAL() + KM2_FDR_MODAL() + KM2_OVS_MODAL() + KM2_WZ_MODAL();
}

function KM2_HEADER() {
  return '' +
    '<header class="page-head">' +
    '  <div>' +
    '    <h1>' +
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>' +
    '      KPI Manager' +
    '    </h1>' +
    '    <div class="subtitle">70-75 — templates · overrides · periods · scores · aggregates · feeders · log</div>' +
    '  </div>' +
    '  <div class="page-actions">' +
    '    <span class="page-badge">ANALYTICS</span>' +
    '    <button class="btn-help" onclick="showHelp(HELP)" title="ช่วยเหลือ" id="help-btn"></button>' +
    '    <button class="btn btn-sm" onclick="reloadAll()" id="refresh-btn"></button>' +
    '    <button class="btn btn-sm" onclick="runFoSync()" id="fo-sync-btn"></button>' +
    '    <button class="btn btn-sm" onclick="runMonthly()" id="run-monthly-btn"></button>' +
    '    <button class="btn btn-sm" onclick="seedKpiSetup()" id="seed-btn"></button>' +
    '    <button class="btn btn-sm" onclick="fixPeriods()" id="fix-period-btn"></button>' +
    '    <button class="btn btn-sm" onclick="runBackPeriod()" id="run-back-btn"></button>' +
    '    <button class="btn btn-sm" onclick="backfillPeriodsUI()" id="backfill-btn"></button>' +
    '    <button class="btn btn-sm" onclick="runAllPeriodsUI()" id="runall-btn"></button>' +
    '  </div>' +
    '</header>';
}

function KM2_TABS() {
  return '' +
    '<div class="tabs">' +
    '  <button class="tab active" id="tab-templates" onclick="setTab(\'templates\')"></button>' +
    '  <button class="tab" id="tab-overrides" onclick="setTab(\'overrides\')"></button>' +
    '  <button class="tab" id="tab-periods" onclick="setTab(\'periods\')"></button>' +
    '  <button class="tab" id="tab-scores" onclick="setTab(\'scores\')"></button>' +
    '  <button class="tab" id="tab-aggregates" onclick="setTab(\'aggregates\')"></button>' +
    '  <button class="tab" id="tab-feeders" onclick="setTab(\'feeders\')"></button>' +
    '  <button class="tab" id="tab-log" onclick="setTab(\'log\')"></button>' +
    '</div>';
}

function KM2_TPL_MODAL() {
  return '' +
    '<div class="modal-bg" id="tpl-bg" onclick="if(event.target===this)closeTplModal()">' +
    '  <div class="modal large">' +
    '    <div class="modal-header"><h2 id="tpl-title">เพิ่ม KPI template</h2><p>กำหนดเป้าหมาย + วิธีคำนวณ + ความถี่</p></div>' +
    '    <div class="modal-body">' +
    '      <input type="hidden" id="t-id-existing">' +
    '      <div class="field"><label>ชื่อ KPI *</label><input id="t-name" placeholder="เช่น ยอดขายต่อเดือน"></div>' +
    '      <div class="field"><label>คำอธิบาย</label><textarea id="t-desc" rows="2"></textarea></div>' +
    '      <div class="row3">' +
    '        <div class="field"><label>หมวด</label><select id="t-category"><option value="sales">sales</option><option value="quality">quality</option><option value="attendance">attendance</option><option value="training">training</option><option value="service">service</option><option value="custom">custom</option></select></div>' +
    '        <div class="field"><label>ตำแหน่ง *</label><select id="t-position"></select></div>' +
    '        <div class="field"><label>ความถี่ *</label><select id="t-frequency"><option value="monthly">monthly</option><option value="quarterly">quarterly</option><option value="yearly">yearly</option></select></div>' +
    '      </div>' +
    '      <div class="row3">' +
    '        <div class="field"><label>Weight (0-1) *</label><input id="t-weight" type="number" min="0" max="1" step="0.05" value="0.2"><div class="field-help">รวมต่อ position ควร = 1.0</div></div>' +
    '        <div class="field"><label>Target *</label><input id="t-target" type="number" value="100"></div>' +
    '        <div class="field"><label>Unit</label><select id="t-unit"><option value="">-</option><option value="baht">baht</option><option value="count">count</option><option value="percent">percent</option><option value="hours">hours</option><option value="rating">rating</option></select></div>' +
    '      </div>' +
    '      <div class="row2">' +
    '        <div class="field"><label>Scoring method</label><select id="t-scoring"><option value="linear">linear (ยิ่งมาก = ยิ่งดี)</option><option value="inverse">inverse (ยิ่งน้อย = ยิ่งดี)</option><option value="binary">binary (ผ่าน/ไม่ผ่าน)</option></select></div>' +
    '        <div class="field"><label>Data source</label><select id="t-source"><option value="manual">manual (HR ใส่)</option><option value="auto-from-sheet">auto-from-sheet (ผูกกับ feeder)</option><option value="ann-read">ann-read (% ack ประกาศ)</option><option value="task-completion">task-completion (% งานเสร็จตรงเวลา)</option><option value="line-bot">line-bot (ผ่าน chatbot)</option></select></div>' +
    '      </div>' +
    '      <div class="field"><label>Source formula (ถ้า auto-from-sheet)</label><input id="t-formula" placeholder="internal:22_Time_Attendance:hours_worked:SUM"><div class="field-help">syntax: fo:self:cases|revenue_split · internal:TAB:column:aggregator · count:TAB:field=value · external:SHEET_ID:gid:cell</div></div>' +
    '      <div class="row2"><div class="field"><label>Effective from</label><input id="t-effrom" type="date"></div><div class="field"><label>Effective until</label><input id="t-efuntil" type="date"></div></div>' +
    '      <div class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="t-active" style="width:16px;height:16px"><label for="t-active" style="margin:0;cursor:pointer">Active (เริ่มใช้งานทันทีถ้า approved)</label></div>' +
    '    </div>' +
    '    <div class="modal-footer"><button class="btn" onclick="closeTplModal()">ยกเลิก</button><button class="btn btn-primary" onclick="saveTemplate()" id="t-save-btn"></button></div>' +
    '  </div>' +
    '</div>';
}

function KM2_OVR_MODAL() {
  return '' +
    '<div class="modal-bg" id="ovr-bg" onclick="if(event.target===this)closeOvrModal()">' +
    '  <div class="modal">' +
    '    <div class="modal-header"><h2>Branch override target</h2><p>ตั้งค่าเป้าหมายต่างจาก default สำหรับสาขาเฉพาะ</p></div>' +
    '    <div class="modal-body">' +
    '      <div class="field"><label>Template *</label><select id="o-tpl"></select></div>' +
    '      <div class="field"><label>สาขา *</label><select id="o-branch"></select></div>' +
    '      <div class="field"><label>Target สำหรับสาขานี้ *</label><input id="o-target" type="number" value="0"></div>' +
    '      <div class="field"><label>เหตุผล</label><input id="o-reason" placeholder="เช่น สาขาเปิดใหม่ ตั้ง target ต่ำกว่า"></div>' +
    '      <div class="row2"><div class="field"><label>Effective from</label><input id="o-effrom" type="date"></div><div class="field"><label>Effective until</label><input id="o-efuntil" type="date"></div></div>' +
    '    </div>' +
    '    <div class="modal-footer"><button class="btn" onclick="closeOvrModal()">ยกเลิก</button><button class="btn btn-primary" onclick="saveOverride()" id="o-save-btn"></button></div>' +
    '  </div>' +
    '</div>';
}

function KM2_PRD_MODAL() {
  return '' +
    '<div class="modal-bg" id="prd-bg" onclick="if(event.target===this)closePrdModal()">' +
    '  <div class="modal" style="max-width:420px">' +
    '    <div class="modal-header"><h2>เพิ่ม period</h2><p>ส่วนใหญ่ระบบสร้าง period ให้เองตอน cron — ใช้กรณีย้อนหลังเอง</p></div>' +
    '    <div class="modal-body">' +
    '      <div class="field"><label>Period ID *</label><input id="p-id" placeholder="2026-05 หรือ 2026-Q2 หรือ 2026"></div>' +
    '      <div class="field"><label>Type</label><select id="p-type"><option value="monthly">monthly</option><option value="quarterly">quarterly</option><option value="yearly">yearly</option></select></div>' +
    '      <div class="row2"><div class="field"><label>Start date</label><input id="p-start" type="date"></div><div class="field"><label>End date</label><input id="p-end" type="date"></div></div>' +
    '    </div>' +
    '    <div class="modal-footer"><button class="btn" onclick="closePrdModal()">ยกเลิก</button><button class="btn btn-primary" onclick="savePeriod()" id="p-save-btn"></button></div>' +
    '  </div>' +
    '</div>';
}

function KM2_FDR_MODAL() {
  return '' +
    '<div class="modal-bg" id="fdr-bg" onclick="if(event.target===this)closeFdrModal()">' +
    '  <div class="modal">' +
    '    <div class="modal-header"><h2 id="fdr-title">เพิ่ม Auto Feeder</h2><p>ตั้งสูตรดึงค่า actual จาก sheet อัตโนมัติ</p></div>' +
    '    <div class="modal-body">' +
    '      <input type="hidden" id="f-id-existing">' +
    '      <div class="field"><label>ชื่อ Feeder *</label><input id="f-name" placeholder="เช่น OPD ต่อเดือน"></div>' +
    '      <div class="field"><label>Link KPI Template</label><select id="f-tpl"></select></div>' +
    '      <div class="field"><label>Source type</label><select id="f-type"><option value="internal">internal — Master DB tab</option><option value="external">external — Sheet ภายนอก</option><option value="count">count — นับแถวที่ตรงเงื่อนไข</option></select></div>' +
    '      <div class="field"><label>Source formula *</label><textarea id="f-formula" rows="2" placeholder="internal:22_Time_Attendance:hours_worked:SUM"></textarea><div class="field-help">internal: TAB:column:SUM/AVG/COUNT · external: SHEET_ID:gid:cell · count: TAB:field=value</div></div>' +
    '      <div class="field"><label>คำอธิบาย</label><textarea id="f-desc" rows="2"></textarea></div>' +
    '      <div class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="f-active" checked style="width:16px;height:16px"><label for="f-active" style="margin:0">Active</label></div>' +
    '      <div id="f-test-result" style="display:none;font-size:11px;background:#F0FDFA;border-left:3px solid var(--teal);padding:8px 10px;margin-top:8px;border-radius:4px"></div>' +
    '    </div>' +
    '    <div class="modal-footer"><button class="btn" onclick="closeFdrModal()">ยกเลิก</button><button class="btn" onclick="testFeederBtn()" id="f-test-btn">Test feeder</button><button class="btn btn-primary" onclick="saveFeeder()" id="f-save-btn"></button></div>' +
    '  </div>' +
    '</div>';
}

function KM2_OVS_MODAL() {
  return '' +
    '<div class="modal-bg" id="ovs-bg" onclick="if(event.target===this)closeOvsModal()">' +
    '  <div class="modal" style="max-width:420px">' +
    '    <div class="modal-header"><h2>Override actual value</h2><p id="ovs-sub">—</p></div>' +
    '    <div class="modal-body">' +
    '      <div class="field"><label>Actual ใหม่ *</label><input id="ov-actual" type="number"><div class="field-help">ระบบ re-calc raw + weighted ให้</div></div>' +
    '      <div class="field"><label>Note (ทำไมต้อง override)</label><textarea id="ov-note" rows="3"></textarea></div>' +
    '    </div>' +
    '    <div class="modal-footer"><button class="btn" onclick="closeOvsModal()">ยกเลิก</button><button class="btn btn-primary" onclick="confirmOverrideScore()" id="ov-save-btn"></button></div>' +
    '  </div>' +
    '</div>';
}

function KM2_WZ_MODAL() {
  return '' +
    '<div class="modal-bg" id="wz-bg" onclick="if(event.target===this)closeWizard()">' +
    '  <div class="modal large">' +
    '    <div class="modal-header"><h2>ตัวช่วยตั้งค่า KPI รายตำแหน่ง</h2><p style="font-size:11px;color:var(--text-muted);margin:4px 0 0">เลือกตำแหน่ง → ติ๊ก KPI ที่ใช้ + ปรับ weight/target → กดบันทึกทีเดียว</p></div>' +
    '    <div class="modal-body" style="padding:16px 20px">' +
    '      <div class="field"><label>ตำแหน่ง</label><select id="wz-pos" onchange="wzRender()"></select></div>' +
    '      <div id="wz-list" style="margin-top:14px"></div>' +
    '      <div class="wz-bar" id="wz-bar"></div>' +
    '      <div class="wz-sum" id="wz-sum"></div>' +
    '    </div>' +
    '    <div class="modal-footer"><button class="btn" onclick="closeWizard()">ยกเลิก</button><button class="btn btn-primary" id="wz-save-btn" onclick="saveWizard()">บันทึก + ใช้งาน</button></div>' +
    '  </div>' +
    '</div>';
}

/* ============================================================
   KM2_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → KM_BACKEND
   helper จาก _shared_scripts (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   ============================================================ */
function KM2_RUN_PAGE_JS() {

  // ---- google.script.run shim → KM_BACKEND (async, คืน shape เดิม) ----
  function _km2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (KM_BACKEND[prop]) {
            Promise.resolve().then(function () { return KM_BACKEND[prop].apply(KM_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[KM_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[KM_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _km2MakeChain(); } });

  // ---- helpers (inline · scoped) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" x2="5" y1="12" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  };

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('km2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'km2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : (type === 'warn' || type === 'warning') ? '#B45309' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.km2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('km-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'km-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const cls = s.type === 'warn' ? 'help-section-warn' : '';
      const items = (s.items || []).map(it => '<li>' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div class="help-section ' + cls + '" style="background:#F8FAFC;border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid #CBD5E1"><div class="help-section-title" style="font-size:11px;font-weight:600;color:#64748B;text-transform:uppercase;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div class="modal" style="max-width:600px;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div class="modal-header" style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'km-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div class="modal-body" style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div class="modal-footer" style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'km-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }
  // scope document.getElementById/querySelector* ให้ค้นเฉพาะใน #km (กันชนกับ dashboard shell)
  // capture real document ผ่านชื่ออื่น (กัน TDZ ของ const document ที่ shadow ทั้ง closure)
  const _realDoc = globalThis.document;
  const _kmRoot = _realDoc.getElementById('km') || _realDoc;
  function gid(id) { return _kmRoot.querySelector('#' + (globalThis.CSS && CSS.escape ? CSS.escape(id) : id)) || _realDoc.getElementById(id); }
  const _doc = {
    getElementById: gid,
    querySelector: function (s) { return _kmRoot.querySelector(s); },
    querySelectorAll: function (s) { return _kmRoot.querySelectorAll(s); },
  };
  // ใช้ alias 'document' ภายใน closure → ค้น/แก้เฉพาะ subtree #km · แต่ createElement/body ยัง delegate ของจริง
  const document = new Proxy(_realDoc, {
    get: function (t, k) {
      if (k === 'getElementById') return _doc.getElementById;
      if (k === 'querySelector') return _doc.querySelector;
      if (k === 'querySelectorAll') return _doc.querySelectorAll;
      const v = t[k];
      return (typeof v === 'function') ? v.bind(t) : v;
    },
  });

  /* ===== STATE (ลอกจากหน้าเดิม) ===== */
  let currentTab = 'templates';
  let allData = {};
  let positionsCache = [];
  let templatesCache = [];
  let branchesCache = [];
  let currentScoreToOverride = null;
  let currentFeederId = null;
  let tplFilterPos = '';
  let tplViewMode = 'pos';
  const KPI_SRC_COLOR = { 'auto-from-sheet': '#3DC5B7', 'ann-read': '#3B82F6', 'task-completion': '#8B5CF6', 'manual': '#0D2F4F' };

  const HELP = {
    title: 'KPI Manager',
    subtitle: 'Sheets: 70-75 · Supabase shadow (read-only)',
    intro: 'จัดการ KPI ทั้งระบบ — templates / overrides / periods / scores / aggregates / feeders / config log',
    sections: [
      { title: '7 tabs', items: [
        '<strong>Templates (70)</strong> — KPI template ต่อตำแหน่ง · approve workflow',
        '<strong>Branch overrides (70a)</strong> — target ต่างจาก default ต่อสาขา',
        '<strong>Periods (71)</strong> — เดือน/ไตรมาส/ปี · open → calculated → finalized',
        '<strong>Scores (72)</strong> — raw scores ต่อ employee × template × period',
        '<strong>Aggregates (73)</strong> — grade dashboard A/B/C/D/F + bonus eligibility',
        '<strong>Auto Feeders (74)</strong> — สูตรดึงค่า actual จาก sheet',
        '<strong>Config log (75)</strong> — audit history ทุก mutation',
      ] },
      { type: 'warn', title: 'หมายเหตุบน dashboard', items: [
        'Scores + Aggregates = ข้อมูลจริงจาก Supabase (kpi.scored · hr_kpi_summary)',
        'Templates / Overrides / Periods / Feeders / Log + ทุกการเขียนกลับ (calc/seed/approve/finalize/override) → ยังต้องทำผ่าน HR Apps Script · กดได้แต่จะแจ้งว่ายังไม่พร้อม',
      ] },
    ],
  };

  /* ===== STATIC ICONS / LABELS ===== */
  document.getElementById('refresh-btn').innerHTML = ICONS.refresh;
  document.getElementById('help-btn').innerHTML = ICONS.help;
  document.getElementById('run-monthly-btn').innerHTML = ICONS.refresh + ' Run monthly calc';
  document.getElementById('fo-sync-btn').innerHTML = ICONS.refresh + ' ดึงข้อมูลหน้าบ้าน';
  document.getElementById('seed-btn').innerHTML = ICONS.plus + ' Seed KPI ตั้งต้น';
  document.getElementById('fix-period-btn').innerHTML = ICONS.cal + ' ตั้ง Period เดือนนี้';
  document.getElementById('run-back-btn').innerHTML = ICONS.refresh + ' คิดย้อนหลัง';
  document.getElementById('backfill-btn').innerHTML = ICONS.cal + ' สร้างย้อนหลัง';
  document.getElementById('runall-btn').innerHTML = ICONS.refresh + ' คิดย้อนหลังทั้งหมด';
  document.getElementById('t-save-btn').innerHTML = ICONS.save + ' บันทึก';
  document.getElementById('o-save-btn').innerHTML = ICONS.save + ' บันทึก override';
  document.getElementById('p-save-btn').innerHTML = ICONS.save + ' สร้าง period';
  document.getElementById('f-save-btn').innerHTML = ICONS.save + ' บันทึก feeder';
  document.getElementById('ov-save-btn').innerHTML = ICONS.save + ' บันทึก override';

  document.getElementById('tab-templates').innerHTML = ICONS.list + ' Templates <span class="cnt" id="cnt-templates">—</span>';
  document.getElementById('tab-overrides').innerHTML = ICONS.building + ' Branch overrides <span class="cnt" id="cnt-overrides">—</span>';
  document.getElementById('tab-periods').innerHTML = ICONS.cal + ' Periods <span class="cnt" id="cnt-periods">—</span>';
  document.getElementById('tab-scores').innerHTML = ICONS.chart + ' Scores';
  document.getElementById('tab-aggregates').innerHTML = ICONS.users + ' Aggregates';
  document.getElementById('tab-feeders').innerHTML = ICONS.refresh + ' Auto feeders <span class="cnt" id="cnt-feeders">—</span>';
  document.getElementById('tab-log').innerHTML = ICONS.doc + ' Config log';

  function setTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    if (tab === 'templates') loadTemplates();
    else if (tab === 'overrides') loadOverrides();
    else if (tab === 'periods') loadPeriods();
    else if (tab === 'scores') loadScores();
    else if (tab === 'aggregates') loadAggregates();
    else if (tab === 'feeders') loadFeeders();
    else if (tab === 'log') loadLog();
  }

  function reloadAll() { setTab(currentTab); }

  function runMonthly() {
    if (!confirm('Run KPI monthly calc สำหรับเดือนปัจจุบัน?')) return;
    document.getElementById('run-monthly-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('run-monthly-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('Calc สำเร็จ · ' + (res.success || 0) + ' employees · period ' + (res.period || ''), 'success');
        reloadAll();
      })
      .withFailureHandler(err => { document.getElementById('run-monthly-btn').disabled = false; showToast(err.message, 'error'); })
      .kpiAdminRunMonthly();
  }

  function runBackPeriod() {
    var id = prompt('คิด KPI ย้อนหลังของเดือนไหน? ใส่รูปแบบ YYYY-MM เช่น 2026-03');
    if (!id) return;
    id = id.trim();
    if (!/^\d{4}-\d{2}$/.test(id)) return showToast('รูปแบบต้องเป็น YYYY-MM เช่น 2026-03', 'error');
    if (!confirm('สร้าง (ถ้ายังไม่มี) + คิด KPI ของ ' + id + '?')) return;
    var btn = document.getElementById('run-back-btn');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(function (res) {
        btn.disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        var r = (res && res.result) || {};
        showToast('คิด ' + id + ' เสร็จ · ' + (r.success || 0) + ' คน', 'success');
        reloadAll();
      })
      .withFailureHandler(function (err) { btn.disabled = false; showToast(err.message, 'error'); })
      .kpiAdminRunForPeriod(id);
  }

  function backfillPeriodsUI() {
    var n = prompt('สร้าง period ย้อนหลังกี่เดือน? (นับรวมเดือนปัจจุบัน · สูงสุด 24)', '6');
    if (!n) return;
    n = parseInt(n, 10);
    if (!n || n < 1) return showToast('ใส่จำนวนเดือนเป็นตัวเลข', 'error');
    var btn = document.getElementById('backfill-btn');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(function (res) {
        btn.disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        var c = (res.created || []).length, s = (res.skipped || []).length;
        showToast('สร้าง period: ใหม่ ' + c + ' · มีอยู่แล้ว ' + s, 'success');
        reloadAll();
      })
      .withFailureHandler(function (err) { btn.disabled = false; showToast(err.message, 'error'); })
      .kpiAdminBackfillPeriods(n);
  }

  function runAllPeriodsUI() {
    var n = prompt('คิด KPI ย้อนหลังทั้งหมดกี่เดือน? (นับรวมเดือนปัจจุบัน · สูงสุด 24)', '12');
    if (!n) return;
    n = parseInt(n, 10);
    if (!n || n < 1) return showToast('ใส่จำนวนเดือนเป็นตัวเลข', 'error');
    if (!confirm('สร้าง + คิด KPI ย้อนหลัง ' + n + ' เดือนรวดเดียว?')) return;
    var btn = document.getElementById('runall-btn');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(function (res) {
        btn.disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('คิดย้อนหลังเสร็จ ' + (res.months || 0) + ' เดือน · รวม ' + (res.total_success || 0) + ' รายการ', 'success');
        reloadAll();
      })
      .withFailureHandler(function (err) { btn.disabled = false; showToast(err.message, 'error'); })
      .kpiAdminRunAllPeriods(n);
  }

  function runFoSync() {
    if (!confirm('ดึงข้อมูลหน้าบ้าน (บันทึกรายวัน) ของเดือนนี้เข้าระบบ KPI?')) return;
    var btn = document.getElementById('fo-sync-btn');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('ดึงข้อมูลสำเร็จ · ' + (res.branches || 0) + ' สาขา · ' + (res.daily_rows || 0) + ' แถวรายคน', 'success');
      })
      .withFailureHandler(err => { btn.disabled = false; showToast(err.message, 'error'); })
      .kpiAdminFoSyncNow();
  }

  function seedKpiSetup() {
    if (!confirm('สร้าง KPI ตั้งต้นทุกตำแหน่ง (เป็น draft)?')) return;
    var btn = document.getElementById('seed-btn');
    var old = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = ICONS.refresh + ' กำลัง seed... สักครู่';
    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false; btn.innerHTML = old;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('Seed สำเร็จ · ' + (res.summary || ''), 'success');
        reloadAll();
      })
      .withFailureHandler(err => { btn.disabled = false; btn.innerHTML = old; showToast(err.message, 'error'); })
      .kpiAdminSeedTemplates({});
  }

  function fixPeriods() {
    if (!confirm('ล้าง period ซ้ำ + ตั้ง period เดือนนี้ให้เรียบร้อย?')) return;
    var btn = document.getElementById('fix-period-btn');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('จัดการ period แล้ว', 'success');
        if (currentTab === 'periods') reloadAll();
      })
      .withFailureHandler(err => { btn.disabled = false; showToast(err.message, 'error'); })
      .kpiAdminNormalizePeriods();
  }

  // ====== Templates tab ======
  function loadTemplates() {
    document.getElementById('content').innerHTML = renderTemplatesShell() + '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.templates = res;
        positionsCache = res.positions || [];
        templatesCache = (res.items || []).filter(t => t.approval_status === 'approved');
        document.getElementById('cnt-templates').textContent = res.stats.total;
        renderTemplatesContent(res);
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminListTemplates({});
  }
  function renderTemplatesShell() {
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">KPI Templates</h3>' +
      '<div style="display:flex;gap:6px">' +
      '<button class="btn btn-sm" onclick="openSetupWizard()">' + ICONS.list + ' ตัวช่วย setup รายตำแหน่ง</button>' +
      '<button class="btn btn-primary btn-sm" onclick="openTplModal()">' + ICONS.plus + ' เพิ่ม template</button>' +
      '</div></div>';
  }
  function renderTemplatesContent(res) {
    let items = res.items || [];

    let banner = '<div class="weight-banner"><h4>Weight check ต่อตำแหน่ง (active + approved) <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--text-faint)">— กดที่ตำแหน่งเพื่อดู/แก้ KPI</span></h4>';
    (res.position_weights || []).forEach(w => {
      const cls = w.ok ? '' : 'warn';
      const active = (tplFilterPos === (w.position_id || '')) ? ' active' : '';
      const pid = escapeAttr(w.position_id || '');
      banner += '<div class="weight-row clickable ' + cls + active + '" role="button" tabindex="0"' +
        ' onclick="filterByPosition(\'' + pid + '\')"' +
        ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();filterByPosition(\'' + pid + '\');}">' +
        '<span class="indicator"></span><span class="pos-name">' + escapeHtml(w.position_name) + ' (' + escapeHtml(w.position_id) + ')</span>' +
        '<span class="total">' + w.total_weight.toFixed(2) + '</span>' +
        (w.ok ? '' : ' <span style="font-size:10px">ไม่ตรง 1.0</span>') +
        '<span class="wr-caret">&rsaquo;</span></div>';
    });
    banner += '</div>';

    const posOpts = (res.positions || positionsCache || []);
    let ctrl = '<div class="tpl-controls">';
    ctrl += '<span class="seg"><button class="' + (tplViewMode === 'pos' ? 'on' : '') + '" onclick="setTplView(\'pos\')">ตามตำแหน่ง</button><button class="' + (tplViewMode === 'kpi' ? 'on' : '') + '" onclick="setTplView(\'kpi\')">ตาม KPI</button><button class="' + (tplViewMode === 'chart' ? 'on' : '') + '" onclick="setTplView(\'chart\')">กราฟ</button></span>';
    ctrl += '<select id="tpl-pos-filter" onchange="applyTplFilter()"><option value="">ทุกตำแหน่ง</option>' +
      posOpts.map(p => '<option value="' + escapeAttr(p.id) + '"' + (tplFilterPos === p.id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>').join('') + '</select>';
    ctrl += '</div>';

    if (tplFilterPos) items = items.filter(t => (t.position_id || 'ALL') === tplFilterPos);

    let body;
    if (!items.length) body = '<div class="empty-tab">ไม่มี KPI template บน dashboard — ระบบ template/seed ต้องตั้งค่าผ่าน HR Apps Script (ดูคะแนนจริงได้ที่แท็บ Scores · Aggregates)</div>';
    else if (tplViewMode === 'kpi') body = buildKpiView(items);
    else if (tplViewMode === 'chart') body = buildChartView(items);
    else body = buildPosView(items, res);

    document.getElementById('content').innerHTML = renderTemplatesShell() + banner + ctrl + body;
  }

  function buildPosView(items, res) {
    const wmap = {}; (res.position_weights || []).forEach(w => { wmap[w.position_id] = w; });
    const cntByPos = {}, draftByPos = {};
    items.forEach(t => {
      const p = t.position_id || 'ALL';
      cntByPos[p] = (cntByPos[p] || 0) + 1;
      if ((t.approval_status || 'draft') === 'draft') draftByPos[p] = (draftByPos[p] || 0) + 1;
    });
    let html = '<table class="data-table"><thead><tr><th>Name</th><th class="num">Weight</th><th class="num">Target</th><th>วิธีคำนวณ</th><th>Source</th><th>ความถี่</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    let curPos = null;
    items.forEach(t => {
      const pid = t.position_id || 'ALL';
      if (pid !== curPos) {
        curPos = pid;
        const w = wmap[pid];
        let meta = '<span class="grp-meta">' + cntByPos[pid] + ' รายการ';
        if (w) meta += '<span class="grp-w ' + (w.ok ? 'ok' : 'warn') + '">Σ ' + w.total_weight.toFixed(2) + '</span>';
        if (draftByPos[pid]) meta += '<button class="btn btn-sm btn-primary grp-approve" onclick="approvePositionBtn(\'' + escapeAttr(pid) + '\',\'' + escapeAttr(t.position_name) + '\',' + draftByPos[pid] + ')">Approve ทั้งตำแหน่ง (' + draftByPos[pid] + ')</button>';
        meta += '</span>';
        html += '<tr class="grp-row"><td colspan="8"><span class="grp-name">' + escapeHtml(t.position_name) + '</span><span class="grp-id">' + escapeHtml(pid) + '</span>' + meta + '</td></tr>';
      }
      html += '<tr>';
      html += '<td><strong>' + escapeHtml(t.name) + '</strong>' + (t.description ? '<div style="font-size:10px;color:var(--text-faint)">' + escapeHtml(t.description.substring(0, 60)) + '</div>' : '') + '</td>';
      html += '<td class="num">' + t.weight.toFixed(2) + '</td>';
      html += '<td class="num">' + t.target_value.toLocaleString() + (t.unit ? ' ' + escapeHtml(t.unit) : '') + '</td>';
      html += '<td><span class="pill pill-' + t.scoring_method + '" style="background:#F1F5F9;color:var(--text-muted)">' + escapeHtml(t.scoring_method) + '</span></td>';
      html += '<td>' + escapeHtml(t.data_source) + (t.source_formula ? '<div class="formula">' + escapeHtml(t.source_formula.substring(0, 30)) + '</div>' : '') + '</td>';
      html += '<td><span class="pill pill-' + t.frequency + '">' + escapeHtml(t.frequency) + '</span></td>';
      html += '<td><span class="pill pill-' + t.approval_status + '">' + escapeHtml(t.approval_status) + '</span>' + (t.active ? ' <span class="pill pill-active" style="margin-left:3px">active</span>' : '') + '</td>';
      html += '<td class="act"><div class="row-actions">';
      html += '<button class="btn btn-sm" onclick="openTplEdit(\'' + escapeAttr(t.tpl_id) + '\')">แก้</button>';
      if (t.approval_status === 'draft') html += '<button class="btn btn-sm btn-primary" onclick="approveTemplate(\'' + escapeAttr(t.tpl_id) + '\')">Approve</button>';
      if (t.approval_status !== 'archived') html += '<button class="btn btn-sm" onclick="archiveTemplate(\'' + escapeAttr(t.tpl_id) + '\')">Archive</button>';
      html += '</div></td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function buildKpiView(items) {
    const groups = {};
    items.forEach(t => { const k = t.name || '(ไม่มีชื่อ)'; (groups[k] = groups[k] || []).push(t); });
    const names = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'th'));
    let html = '<table class="data-table"><thead><tr><th>ตำแหน่ง</th><th class="num">Weight</th><th class="num">Target</th><th>Source</th><th>Status</th><th>Action</th></tr></thead><tbody>';
    names.forEach(nm => {
      const rows = groups[nm];
      html += '<tr class="grp-row"><td colspan="6"><span class="grp-name">' + escapeHtml(nm) + '</span><span class="grp-meta">' + rows.length + ' ตำแหน่ง</span></td></tr>';
      rows.sort((a, b) => (a.position_name || '').localeCompare(b.position_name || '', 'th')).forEach(t => {
        html += '<tr>';
        html += '<td>' + escapeHtml(t.position_name) + ' <span class="grp-id">' + escapeHtml(t.position_id || '') + '</span></td>';
        html += '<td class="num">' + t.weight.toFixed(2) + '</td>';
        html += '<td class="num">' + t.target_value.toLocaleString() + (t.unit ? ' ' + escapeHtml(t.unit) : '') + '</td>';
        html += '<td>' + escapeHtml(t.data_source) + '</td>';
        html += '<td><span class="pill pill-' + t.approval_status + '">' + escapeHtml(t.approval_status) + '</span></td>';
        html += '<td class="act"><div class="row-actions"><button class="btn btn-sm" onclick="openTplEdit(\'' + escapeAttr(t.tpl_id) + '\')">แก้</button></div></td>';
        html += '</tr>';
      });
    });
    html += '</tbody></table>';
    return html;
  }

  function buildChartView(items) {
    const SRC_COLOR = KPI_SRC_COLOR;
    const SRC_LABEL = [['auto-from-sheet', 'ดึงอัตโนมัติ (หน้าบ้าน)'], ['ann-read', 'รับทราบประกาศ'], ['task-completion', 'งานเสร็จตรงเวลา'], ['manual', 'ประเมินโดยหัวหน้า']];
    const groups = {};
    items.forEach(t => { const p = t.position_id || 'ALL'; if (!groups[p]) groups[p] = { name: t.position_name, rows: [] }; groups[p].rows.push(t); });
    const pids = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    let h = '<div class="kpi-chart">';
    h += '<div class="chart-legend">';
    SRC_LABEL.forEach(([k, lbl]) => { h += '<span class="lg"><span class="sw" style="background:' + SRC_COLOR[k] + '"></span>' + lbl + '</span>'; });
    h += '</div>';
    pids.forEach(p => {
      const g = groups[p];
      const sum = g.rows.reduce((s, t) => s + Number(t.weight || 0), 0);
      const sumOk = Math.abs(sum - 1.0) < 0.01;
      h += '<div class="chart-row"><div class="chart-pos">' + escapeHtml(g.name) + ' <span class="grp-id">' + escapeHtml(p) + '</span>' +
        '<span class="chart-sum' + (sumOk ? ' ok' : '') + '">Σ ' + sum.toFixed(2) + '</span></div>';
      h += '<div class="chart-bar">';
      g.rows.slice().sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0)).forEach(t => {
        const pct = Math.max(0, Number(t.weight || 0)) * 100;
        const col = SRC_COLOR[t.data_source] || '#94A3B8';
        h += '<div class="seg2" style="width:' + pct + '%;background:' + col + '">' + (pct >= 9 ? '<span>' + Math.round(pct) + '%</span>' : '') + '</div>';
      });
      h += '</div></div>';
    });
    h += '</div>';
    return h;
  }

  function applyTplFilter() {
    const el = document.getElementById('tpl-pos-filter');
    tplFilterPos = el ? el.value : '';
    renderTemplatesContent(allData.templates);
  }
  function filterByPosition(pid) {
    pid = pid || '';
    tplFilterPos = (tplFilterPos === pid) ? '' : pid;
    if (tplFilterPos) tplViewMode = 'pos';
    renderTemplatesContent(allData.templates);
    const tbl = document.querySelector('.data-table');
    if (tbl && tplFilterPos) tbl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function setTplView(mode) { tplViewMode = mode; renderTemplatesContent(allData.templates); }
  function approvePositionBtn(pid, name, n) {
    if (!confirm('Approve KPI ทั้งตำแหน่ง ' + name + ' (' + n + ' ตัว draft)?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (res && res.error) return showToast(res.error, 'error');
        showToast('Approved ' + (res.approved || 0) + ' ตัว · ' + name, 'success');
        loadTemplates();
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminApprovePosition(pid);
  }

  // ====== Setup Wizard รายตำแหน่ง ======
  function openSetupWizard() {
    const sel = document.getElementById('wz-pos');
    const posOpts = (allData.templates && allData.templates.positions) || positionsCache || [];
    sel.innerHTML = '<option value="">— เลือกตำแหน่ง —</option>' +
      posOpts.map(p => '<option value="' + escapeAttr(p.id) + '">' + escapeHtml(p.name) + '</option>').join('');
    sel.value = tplFilterPos || '';
    document.getElementById('wz-bg').classList.add('active');
    wzRender();
  }
  function closeWizard() { document.getElementById('wz-bg').classList.remove('active'); }
  function wzRender() {
    const pos = document.getElementById('wz-pos').value;
    const list = document.getElementById('wz-list');
    const sumEl = document.getElementById('wz-sum');
    if (!pos) { list.innerHTML = '<div class="empty-tab" style="padding:20px">เลือกตำแหน่งก่อนค่ะ</div>'; sumEl.innerHTML = ''; sumEl.className = 'wz-sum'; return; }
    const items = ((allData.templates && allData.templates.items) || []).filter(t => (t.position_id || 'ALL') === pos);
    if (!items.length) { list.innerHTML = '<div class="empty-tab" style="padding:20px">ตำแหน่งนี้ยังไม่มี KPI — ตั้งค่าผ่าน HR Apps Script ก่อน</div>'; sumEl.innerHTML = ''; sumEl.className = 'wz-sum'; return; }
    let h = '<div class="wz-head"><span>ใช้</span><span>KPI</span><span>Weight</span><span>Target</span></div>';
    items.forEach((t, i) => {
      const inc = (t.approval_status === 'approved');
      h += '<div class="wz-row' + (inc ? '' : ' off') + '" id="wz-row-' + i + '" data-tpl="' + escapeAttr(t.tpl_id) + '" data-src="' + escapeAttr(t.data_source) + '" data-name="' + escapeAttr(t.name) + '">';
      h += '<input type="checkbox" ' + (inc ? 'checked' : '') + ' onchange="wzToggle(' + i + ')">';
      h += '<div><div class="wz-name">' + escapeHtml(t.name) + '</div><div class="wz-src">' + escapeHtml(t.data_source) + (t.source_formula ? ' · ' + escapeHtml(t.source_formula) : '') + ' · ' + escapeHtml(t.scoring_method) + '</div></div>';
      h += '<input type="number" min="0" max="1" step="0.05" value="' + t.weight + '" oninput="wzSum()">';
      h += '<input type="number" step="any" value="' + t.target_value + '">';
      h += '</div>';
    });
    list.innerHTML = h;
    wzSum();
  }
  function wzToggle(i) {
    const r = document.getElementById('wz-row-' + i);
    const cb = r.querySelector('input[type=checkbox]');
    r.classList.toggle('off', !cb.checked);
    wzSum();
  }
  function wzSum() {
    let sum = 0;
    document.querySelectorAll('#wz-list .wz-row').forEach(r => {
      const cb = r.querySelector('input[type=checkbox]');
      const w = parseFloat(r.querySelector('input[type=number]').value) || 0;
      if (cb.checked) sum += w;
    });
    const el = document.getElementById('wz-sum');
    const ok = Math.abs(sum - 1.0) < 0.01;
    el.className = 'wz-sum ' + (ok ? 'ok' : 'warn');
    el.innerHTML = '<span>รวม weight ของ KPI ที่ติ๊กใช้</span><strong>' + sum.toFixed(2) + (ok ? ' · ครบ 1.00' : ' · ควรได้ 1.00') + '</strong>';

    let bar = '';
    document.querySelectorAll('#wz-list .wz-row').forEach(r => {
      const cb = r.querySelector('input[type=checkbox]');
      if (!cb.checked) return;
      const w = parseFloat(r.querySelector('input[type=number]').value) || 0;
      const col = KPI_SRC_COLOR[r.getAttribute('data-src') || ''] || '#94A3B8';
      const pct = Math.max(0, w) * 100;
      bar += '<div class="seg2" style="width:' + pct + '%;background:' + col + '">' + (pct >= 12 ? '<span>' + Math.round(pct) + '%</span>' : '') + '</div>';
    });
    const barEl = document.getElementById('wz-bar');
    if (barEl) barEl.innerHTML = bar || '<div style="display:flex;align-items:center;justify-content:center;width:100%;font-size:11px;color:var(--text-faint)">ติ๊กเลือก KPI เพื่อดูสัดส่วน</div>';
  }
  function saveWizard() {
    const pos = document.getElementById('wz-pos').value;
    if (!pos) return showToast('เลือกตำแหน่งก่อน', 'error');
    const rows = [];
    document.querySelectorAll('#wz-list .wz-row').forEach(r => {
      const nums = r.querySelectorAll('input[type=number]');
      rows.push({ tpl_id: r.getAttribute('data-tpl'), include: r.querySelector('input[type=checkbox]').checked, weight: parseFloat(nums[0].value) || 0, target_value: parseFloat(nums[1].value) || 0 });
    });
    if (!rows.length) return showToast('ไม่มี KPI ให้บันทึก', 'error');
    const sum = rows.filter(r => r.include).reduce((s, r) => s + r.weight, 0);
    if (Math.abs(sum - 1.0) > 0.01 && !confirm('รวม weight ของ KPI ที่ติ๊กใช้ = ' + sum.toFixed(2) + ' (ไม่ใช่ 1.00)\nบันทึกต่อไหมคะ?')) return;
    const btn = document.getElementById('wz-save-btn');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('บันทึกแล้ว · ปรับ ' + (res.updated || 0), 'success');
        closeWizard();
        loadTemplates();
      })
      .withFailureHandler(err => { btn.disabled = false; showToast(err.message, 'error'); })
      .kpiAdminApplyPositionSetup(pos, rows);
  }

  function openTplModal() {
    document.getElementById('tpl-bg').classList.add('active');
    document.getElementById('tpl-title').textContent = 'เพิ่ม KPI template';
    document.getElementById('t-id-existing').value = '';
    ['t-name', 't-desc', 't-formula'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('t-category').value = 'custom';
    document.getElementById('t-frequency').value = 'monthly';
    document.getElementById('t-weight').value = '0.2';
    document.getElementById('t-target').value = '100';
    document.getElementById('t-unit').value = '';
    document.getElementById('t-scoring').value = 'linear';
    document.getElementById('t-source').value = 'manual';
    document.getElementById('t-effrom').value = '';
    document.getElementById('t-efuntil').value = '';
    document.getElementById('t-active').checked = false;
    const sel = document.getElementById('t-position');
    sel.innerHTML = '<option value="ALL">ALL — ทุกตำแหน่ง</option>' +
      positionsCache.map(p => '<option value="' + escapeAttr(p.id) + '">' + escapeHtml(p.name) + '</option>').join('');
    sel.value = 'ALL';
  }
  function openTplEdit(tplId) {
    const t = allData.templates.items.find(x => x.tpl_id === tplId);
    if (!t) return;
    openTplModal();
    document.getElementById('tpl-title').textContent = 'แก้ไข ' + t.tpl_id;
    document.getElementById('t-id-existing').value = t.tpl_id;
    document.getElementById('t-name').value = t.name;
    document.getElementById('t-desc').value = t.description;
    document.getElementById('t-category').value = t.category;
    document.getElementById('t-position').value = t.position_id;
    document.getElementById('t-frequency').value = t.frequency;
    document.getElementById('t-weight').value = t.weight;
    document.getElementById('t-target').value = t.target_value;
    document.getElementById('t-unit').value = t.unit;
    document.getElementById('t-scoring').value = t.scoring_method;
    document.getElementById('t-source').value = t.data_source;
    document.getElementById('t-formula').value = t.source_formula;
    document.getElementById('t-effrom').value = t.effective_from || '';
    document.getElementById('t-efuntil').value = t.effective_until || '';
    document.getElementById('t-active').checked = t.active;
  }
  function closeTplModal() { document.getElementById('tpl-bg').classList.remove('active'); }
  function saveTemplate() {
    const isEdit = !!document.getElementById('t-id-existing').value;
    const payload = {
      name: document.getElementById('t-name').value || '',
      description: document.getElementById('t-desc').value || '',
      category: document.getElementById('t-category').value,
      position_id: document.getElementById('t-position').value,
      frequency: document.getElementById('t-frequency').value,
      weight: document.getElementById('t-weight').value,
      target_value: document.getElementById('t-target').value,
      unit: document.getElementById('t-unit').value,
      scoring_method: document.getElementById('t-scoring').value,
      data_source: document.getElementById('t-source').value,
      source_formula: document.getElementById('t-formula').value,
      effective_from: document.getElementById('t-effrom').value,
      effective_until: document.getElementById('t-efuntil').value,
      active: document.getElementById('t-active').checked,
    };
    if (!payload.name) return showToast('ใส่ชื่อ', 'error');
    document.getElementById('t-save-btn').disabled = true;
    const fn = isEdit ? 'kpiAdminUpdateTemplate' : 'kpiAdminAddTemplate';
    const arg = isEdit ? document.getElementById('t-id-existing').value : payload;
    const arg2 = isEdit ? payload : undefined;
    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('t-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast(isEdit ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว', 'success');
        closeTplModal();
        loadTemplates();
      })
      .withFailureHandler(err => { document.getElementById('t-save-btn').disabled = false; showToast(err.message, 'error'); })
      [fn](arg, arg2);
  }
  function approveTemplate(tplId) {
    if (!confirm('Approve template ' + tplId + '?')) return;
    google.script.run
      .withSuccessHandler(res => { if (res && res.error) return showToast(res.error, 'error'); showToast('Approved', 'success'); loadTemplates(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminApproveTemplate(tplId);
  }
  function archiveTemplate(tplId) {
    if (!confirm('Archive template ' + tplId + '?')) return;
    google.script.run
      .withSuccessHandler(res => { if (res && res.error) return showToast(res.error, 'error'); showToast('Archived', 'success'); loadTemplates(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminArchiveTemplate(tplId);
  }

  // ====== Overrides tab ======
  function loadOverrides() {
    document.getElementById('content').innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">Branch overrides</h3><button class="btn btn-primary btn-sm" onclick="openOvrModal()">' + ICONS.plus + ' เพิ่ม override</button></div><div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.overrides = res;
        branchesCache = res.branches || [];
        document.getElementById('cnt-overrides').textContent = (res.items || []).length;
        const items = res.items || [];
        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">Branch overrides</h3><button class="btn btn-primary btn-sm" onclick="openOvrModal()">' + ICONS.plus + ' เพิ่ม override</button></div>';
        if (!items.length) html += '<div class="empty-tab">ยังไม่มี override บน dashboard — branch override ต้องตั้งค่าผ่าน HR Apps Script</div>';
        else {
          html += '<table class="data-table"><thead><tr><th>Template</th><th>สาขา</th><th>Default target</th><th>Override target</th><th>เหตุผล</th><th>Active</th><th>Action</th></tr></thead><tbody>';
          items.forEach(o => {
            html += '<tr>';
            html += '<td><strong>' + escapeHtml(o.tpl_name) + '</strong></td>';
            html += '<td>' + escapeHtml(o.branch_name) + '</td>';
            html += '<td>' + (o.tpl_target == null || o.tpl_target === '' ? '<span style="color:#9CA3AF">— (ไม่มีเลข)</span>' : Number(o.tpl_target).toLocaleString()) + '</td>';
            html += '<td><strong>' + (o.target_value == null || o.target_value === '' ? '—' : Number(o.target_value).toLocaleString()) + '</strong></td>';
            html += '<td style="font-size:11px">' + escapeHtml(o.reason || '-') + '</td>';
            html += '<td>' + (o.active ? '<span class="pill pill-active">active</span>' : '<span class="pill pill-inactive">inactive</span>') + '</td>';
            html += '<td><button class="btn btn-sm" onclick="removeOverride(\'' + escapeAttr(o.override_id) + '\')">' + ICONS.trash + '</button></td>';
            html += '</tr>';
          });
          html += '</tbody></table>';
        }
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminListOverrides({});
  }
  function openOvrModal() {
    document.getElementById('ovr-bg').classList.add('active');
    ['o-target', 'o-reason', 'o-effrom', 'o-efuntil'].forEach(id => document.getElementById(id).value = '');
    const sel1 = document.getElementById('o-tpl');
    sel1.innerHTML = '<option value="">— เลือก template —</option>' +
      (allData.overrides.templates || []).map(t => '<option value="' + escapeAttr(t.id) + '">' + escapeHtml(t.name) + '</option>').join('');
    const sel2 = document.getElementById('o-branch');
    sel2.innerHTML = '<option value="">— เลือกสาขา —</option>' +
      (allData.overrides.branches || []).map(b => '<option value="' + escapeAttr(b.id) + '">' + escapeHtml(b.name) + '</option>').join('');
  }
  function closeOvrModal() { document.getElementById('ovr-bg').classList.remove('active'); }
  function saveOverride() {
    const payload = {
      tpl_id: document.getElementById('o-tpl').value,
      branch_id: document.getElementById('o-branch').value,
      target_value: document.getElementById('o-target').value,
      reason: document.getElementById('o-reason').value,
      effective_from: document.getElementById('o-effrom').value,
      effective_until: document.getElementById('o-efuntil').value,
      active: true,
    };
    if (!payload.tpl_id || !payload.branch_id) return showToast('เลือก template + สาขา', 'error');
    document.getElementById('o-save-btn').disabled = true;
    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('o-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast('เพิ่ม override แล้ว', 'success');
        closeOvrModal();
        loadOverrides();
      })
      .withFailureHandler(err => { document.getElementById('o-save-btn').disabled = false; showToast(err.message, 'error'); })
      .kpiAdminAddOverride(payload);
  }
  function removeOverride(id) {
    if (!confirm('ลบ override นี้?')) return;
    google.script.run
      .withSuccessHandler(res => { if (res && res.error) return showToast(res.error, 'error'); showToast('ลบแล้ว', 'success'); loadOverrides(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminRemoveOverride(id);
  }

  // ====== Periods tab ======
  function loadPeriods() {
    document.getElementById('content').innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">KPI Periods</h3><button class="btn btn-primary btn-sm" onclick="openPrdModal()">' + ICONS.plus + ' สร้าง period</button></div><div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.periods = res;
        const items = res.items || [];
        document.getElementById('cnt-periods').textContent = items.length;
        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">KPI Periods</h3><button class="btn btn-primary btn-sm" onclick="openPrdModal()">' + ICONS.plus + ' สร้าง period</button></div>';
        if (!items.length) html += '<div class="empty-tab">ยังไม่มี period บน dashboard — period สร้างอัตโนมัติบน HR Apps Script (cron วันที่ 21)</div>';
        else {
          html += '<table class="data-table"><thead><tr><th>Period</th><th>Type</th><th>Range</th><th>Status</th><th>Aggregates</th><th>Calculated</th><th>Finalized</th><th>Action</th></tr></thead><tbody>';
          items.forEach(p => {
            html += '<tr>';
            html += '<td><strong>' + escapeHtml(p.period_id) + '</strong></td>';
            html += '<td><span class="pill pill-' + p.period_type + '">' + escapeHtml(p.period_type) + '</span></td>';
            html += '<td>' + escapeHtml(p.start_date + ' → ' + p.end_date) + '</td>';
            html += '<td><span class="pill pill-' + p.status + '">' + escapeHtml(p.status) + '</span></td>';
            html += '<td>' + p.aggregate_count + '</td>';
            html += '<td style="font-size:10px">' + escapeHtml(p.calculated_at || '-') + '</td>';
            html += '<td style="font-size:10px">' + escapeHtml(p.finalized_at || '-') + (p.finalized_by ? '<br>โดย ' + escapeHtml(p.finalized_by) : '') + '</td>';
            html += '<td>';
            html += '<button class="btn btn-sm" onclick="recalcPeriod(\'' + escapeAttr(p.period_id) + '\')">Recalc</button> ';
            if (p.status !== 'finalized') html += '<button class="btn btn-sm btn-primary" onclick="finalizePeriod(\'' + escapeAttr(p.period_id) + '\')">Finalize</button>';
            else html += '<button class="btn btn-sm" onclick="reopenPeriod(\'' + escapeAttr(p.period_id) + '\')">Reopen</button>';
            html += '</td></tr>';
          });
          html += '</tbody></table>';
        }
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminListPeriods({});
  }
  function openPrdModal() {
    document.getElementById('prd-bg').classList.add('active');
    ['p-id', 'p-start', 'p-end'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('p-type').value = 'monthly';
  }
  function closePrdModal() { document.getElementById('prd-bg').classList.remove('active'); }
  function savePeriod() {
    const payload = {
      period_id: document.getElementById('p-id').value,
      period_type: document.getElementById('p-type').value,
      start_date: document.getElementById('p-start').value,
      end_date: document.getElementById('p-end').value,
    };
    if (!payload.period_id) return showToast('ใส่ period_id', 'error');
    google.script.run
      .withSuccessHandler(res => { if (res && res.error) return showToast(res.error, 'error'); showToast('สร้างแล้ว', 'success'); closePrdModal(); loadPeriods(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminAddPeriod(payload);
  }
  function recalcPeriod(id) {
    if (!confirm('Recalc period ' + id + '? จะ overwrite scores ที่มี')) return;
    google.script.run
      .withSuccessHandler(res => { if (res && res.error) return showToast(res.error, 'error'); showToast('Recalc แล้ว', 'success'); loadPeriods(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminRecalcPeriod(id);
  }
  function finalizePeriod(id) {
    if (!confirm('Finalize period ' + id + '? · scores จะ lock')) return;
    google.script.run
      .withSuccessHandler(res => { if (res && res.error) return showToast(res.error, 'error'); showToast('Finalized · lock ' + (res.aggregates_locked || 0) + ' aggregates', 'success'); loadPeriods(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminFinalizePeriod(id);
  }
  function reopenPeriod(id) {
    if (!confirm('Reopen period ' + id + '?')) return;
    google.script.run
      .withSuccessHandler(res => { if (res && res.error) return showToast(res.error, 'error'); showToast('Reopened', 'success'); loadPeriods(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminReopenPeriod(id);
  }

  // ====== Scores tab ======
  function loadScores() {
    document.getElementById('content').innerHTML = '<div class="filters"><div class="filter"><label>Period</label><input id="filter-period" placeholder="2026-05"></div><div class="filter"><label>Employee ID</label><input id="filter-emp"></div></div><div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.scores = res;
        const items = res.items || [];
        let html = '<div class="filters"><div class="filter"><label>Period</label><input id="filter-period" placeholder="2026-05" oninput="filterScores()"></div><div class="filter"><label>Employee ID</label><input id="filter-emp" oninput="filterScores()"></div></div>';
        if (!items.length) html += '<div class="empty-tab">ยังไม่มี scores · ระบบยังไม่ได้คำนวณ KPI งวดนี้</div>';
        else {
          html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">' + items.length + ' scores</div>';
          html += '<table class="data-table"><thead><tr><th>Period</th><th>Employee</th><th>Template</th><th>Target</th><th>Actual</th><th>Raw score</th><th>Weighted</th><th>Source</th><th>Action</th></tr></thead><tbody>';
          items.slice(0, 200).forEach(s => {
            html += '<tr>';
            html += '<td>' + escapeHtml(s.period_id) + '</td>';
            html += '<td>' + escapeHtml(s.employee_name) + '<div style="font-size:10px;color:var(--text-faint)">' + escapeHtml(s.employee_id) + '</div></td>';
            html += '<td>' + escapeHtml(s.tpl_name) + '</td>';
            html += '<td>' + s.target.toLocaleString() + '</td>';
            html += '<td><strong>' + s.actual.toLocaleString() + '</strong>' + (s.data_source_used === 'manual_override' ? '<div style="font-size:9px;color:var(--warning)">override</div>' : '') + '</td>';
            html += '<td>' + s.raw_score.toFixed(1) + '</td>';
            html += '<td>' + s.weighted_score.toFixed(1) + '</td>';
            html += '<td style="font-size:10px">' + escapeHtml(s.data_source_used) + '</td>';
            html += '<td><button class="btn btn-sm" onclick="openOverrideScore(\'' + escapeAttr(s.score_id) + '\', ' + s.actual + ', \'' + escapeAttr(s.employee_name + ' · ' + s.tpl_name) + '\')">Override</button></td>';
            html += '</tr>';
          });
          html += '</tbody></table>';
          if (items.length > 200) html += '<div style="text-align:center;padding:10px;color:var(--text-faint);font-size:11px">แสดง 200 จาก ' + items.length + ' · ใช้ filter เพื่อแคบลง</div>';
        }
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminListScores({});
  }
  function filterScores() {
    const period = document.getElementById('filter-period').value || '';
    const emp = document.getElementById('filter-emp').value || '';
    const opts = {};
    if (period) opts.period_id = period;
    if (emp) opts.employee_id = emp;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return;
        const items = res.items || [];
        let tbl = '';
        if (!items.length) tbl = '<div class="empty-tab">ไม่พบตามเงื่อนไข</div>';
        else {
          tbl = '<div style="font-size:11px;color:var(--text-muted);margin:10px 0 6px">' + items.length + ' scores</div>';
          tbl += '<table class="data-table"><thead><tr><th>Period</th><th>Employee</th><th>Template</th><th>Target</th><th>Actual</th><th>Raw</th><th>Weighted</th><th>Source</th><th>Action</th></tr></thead><tbody>';
          items.slice(0, 200).forEach(s => {
            tbl += '<tr>';
            tbl += '<td>' + escapeHtml(s.period_id) + '</td>';
            tbl += '<td>' + escapeHtml(s.employee_name) + '</td>';
            tbl += '<td>' + escapeHtml(s.tpl_name) + '</td>';
            tbl += '<td>' + s.target.toLocaleString() + '</td>';
            tbl += '<td><strong>' + s.actual.toLocaleString() + '</strong></td>';
            tbl += '<td>' + s.raw_score.toFixed(1) + '</td>';
            tbl += '<td>' + s.weighted_score.toFixed(1) + '</td>';
            tbl += '<td>' + escapeHtml(s.data_source_used) + '</td>';
            tbl += '<td><button class="btn btn-sm" onclick="openOverrideScore(\'' + escapeAttr(s.score_id) + '\', ' + s.actual + ', \'' + escapeAttr(s.employee_name + ' · ' + s.tpl_name) + '\')">Override</button></td>';
            tbl += '</tr>';
          });
          tbl += '</tbody></table>';
        }
        const filterDiv = document.querySelector('#content .filters');
        const filterHtml = filterDiv ? filterDiv.outerHTML : '';
        document.getElementById('content').innerHTML = filterHtml + tbl;
        if (period) document.getElementById('filter-period').value = period;
        if (emp) document.getElementById('filter-emp').value = emp;
      })
      .kpiAdminListScores(opts);
  }
  function openOverrideScore(scoreId, currentActual, sub) {
    currentScoreToOverride = scoreId;
    document.getElementById('ovs-bg').classList.add('active');
    document.getElementById('ovs-sub').textContent = sub;
    document.getElementById('ov-actual').value = currentActual;
    document.getElementById('ov-note').value = '';
  }
  function closeOvsModal() { document.getElementById('ovs-bg').classList.remove('active'); currentScoreToOverride = null; }
  function confirmOverrideScore() {
    if (!currentScoreToOverride) return;
    const actual = document.getElementById('ov-actual').value;
    const note = document.getElementById('ov-note').value;
    if (!note) return showToast('ใส่เหตุผล (audit log)', 'error');
    google.script.run
      .withSuccessHandler(res => { if (res && res.error) return showToast(res.error, 'error'); showToast('Override + recalc แล้ว', 'success'); closeOvsModal(); loadScores(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminOverrideScore(currentScoreToOverride, actual, note);
  }

  // ====== Aggregates tab ======
  function loadAggregates() {
    document.getElementById('content').innerHTML = '<div class="filters"><div class="filter"><label>Period</label><input id="agg-period" placeholder="2026-05"></div></div><div class="loading">กำลังโหลด...</div>';
    const opts = {};
    const periodInput = document.getElementById('agg-period');
    if (periodInput && periodInput.value) opts.period_id = periodInput.value;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.aggregates = res;
        const items = res.items || [];
        const stats = res.stats || {};
        const dist = stats.grade_distribution || {};
        let html = '<div class="filters"><div class="filter"><label>Period</label><input id="agg-period" placeholder="2026-05" oninput="loadAggregates()" value="' + escapeAttr(opts.period_id || '') + '"></div></div>';

        html += '<div class="grade-grid">';
        ['A', 'B', 'C', 'D', 'F'].forEach(g => {
          html += '<div class="grade-card grade-' + g + '"><div class="grade-letter">' + g + '</div><div class="grade-count">' + (dist[g] || 0) + '</div><div class="grade-label">คน</div></div>';
        });
        html += '</div>';

        html += '<div style="display:flex;gap:14px;margin-bottom:14px;flex-wrap:wrap;font-size:12px">';
        html += '<div><strong>Total:</strong> ' + (stats.total || 0) + '</div>';
        html += '<div><strong>Avg score:</strong> ' + (stats.avg_score || 0) + '</div>';
        html += '<div><strong>Bonus eligible:</strong> ' + (stats.bonus_eligible || 0) + '</div>';
        html += '</div>';

        if (!items.length) html += '<div class="empty-tab">ยังไม่มี aggregates · ระบบยังไม่ได้คำนวณ KPI งวดนี้</div>';
        else {
          html += '<table class="data-table"><thead><tr><th>Rank</th><th>Employee</th><th>ตำแหน่ง</th><th>สาขา</th><th>Period</th><th>Score</th><th>Grade</th><th>Trend</th><th>Bonus</th></tr></thead><tbody>';
          items.slice(0, 100).forEach((a, idx) => {
            html += '<tr>';
            html += '<td><strong>' + (idx + 1) + '</strong></td>';
            html += '<td>' + escapeHtml(a.employee_name) + '</td>';
            html += '<td>' + escapeHtml(a.position_id || '-') + '</td>';
            html += '<td>' + escapeHtml(a.branch_name) + '</td>';
            html += '<td>' + escapeHtml(a.period_id) + '</td>';
            html += '<td><strong>' + a.total_weighted_score.toFixed(1) + '</strong></td>';
            html += '<td><span class="pill pill-' + a.grade + '">' + escapeHtml(a.grade) + '</span></td>';
            html += '<td><span class="pill pill-' + a.trend + '">' + escapeHtml(a.trend) + '</span></td>';
            html += '<td>' + (a.bonus_eligibility ? '<span class="pill pill-ok">eligible</span>' : '-') + '</td>';
            html += '</tr>';
          });
          html += '</tbody></table>';
          if (items.length > 100) html += '<div style="text-align:center;padding:10px;color:var(--text-faint);font-size:11px">แสดง 100 จาก ' + items.length + '</div>';
        }
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminListAggregates(opts);
  }

  // ====== Feeders tab ======
  function loadFeeders() {
    document.getElementById('content').innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">Auto Feeders</h3><button class="btn btn-primary btn-sm" onclick="openFdrModal()">' + ICONS.plus + ' เพิ่ม feeder</button></div><div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        allData.feeders = res;
        const items = res.items || [];
        document.getElementById('cnt-feeders').textContent = items.length;
        let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0;font-size:14px">Auto Feeders</h3><button class="btn btn-primary btn-sm" onclick="openFdrModal()">' + ICONS.plus + ' เพิ่ม feeder</button></div>';
        if (!items.length) html += '<div class="empty-tab">ยังไม่มี feeder บน dashboard — auto feeder ต้องตั้งค่าผ่าน HR Apps Script</div>';
        else {
          html += '<table class="data-table"><thead><tr><th>Name</th><th>Linked KPI</th><th>Type</th><th>Formula</th><th>Last run</th><th>Status</th><th>Action</th></tr></thead><tbody>';
          items.forEach(f => {
            html += '<tr>';
            html += '<td><strong>' + escapeHtml(f.name) + '</strong></td>';
            html += '<td>' + escapeHtml(f.tpl_name) + '</td>';
            html += '<td><span class="pill pill-active">' + escapeHtml(f.source_type) + '</span></td>';
            html += '<td><code class="formula">' + escapeHtml(f.source_formula.substring(0, 50)) + '</code></td>';
            html += '<td style="font-size:10px">' + escapeHtml(f.last_run_at || '-') + (f.last_run_value ? '<br>value: ' + escapeHtml(String(f.last_run_value)) : '') + '</td>';
            html += '<td>' + (f.last_run_status === 'ok' ? '<span class="pill pill-ok">ok</span>' : f.last_run_status ? '<span class="pill pill-error">' + escapeHtml(f.last_run_status.substring(0, 30)) + '</span>' : '-') + '</td>';
            html += '<td>';
            html += '<button class="btn btn-sm" onclick="openFdrEdit(\'' + escapeAttr(f.feeder_id) + '\')">แก้</button> ';
            html += '<button class="btn btn-sm" onclick="removeFeeder(\'' + escapeAttr(f.feeder_id) + '\')">' + ICONS.trash + '</button>';
            html += '</td></tr>';
          });
          html += '</tbody></table>';
        }
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminListFeeders();
  }
  function openFdrModal() {
    document.getElementById('fdr-bg').classList.add('active');
    document.getElementById('fdr-title').textContent = 'เพิ่ม Auto Feeder';
    document.getElementById('f-id-existing').value = '';
    ['f-name', 'f-formula', 'f-desc'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('f-type').value = 'internal';
    document.getElementById('f-active').checked = true;
    document.getElementById('f-test-result').style.display = 'none';
    const sel = document.getElementById('f-tpl');
    sel.innerHTML = '<option value="">— เลือก template (optional) —</option>' +
      (allData.feeders.templates || []).map(t => '<option value="' + escapeAttr(t.id) + '">' + escapeHtml(t.name) + '</option>').join('');
    currentFeederId = null;
  }
  function openFdrEdit(id) {
    const f = allData.feeders.items.find(x => x.feeder_id === id);
    if (!f) return;
    openFdrModal();
    document.getElementById('fdr-title').textContent = 'แก้ไข ' + id;
    document.getElementById('f-id-existing').value = id;
    document.getElementById('f-name').value = f.name;
    document.getElementById('f-tpl').value = f.tpl_id;
    document.getElementById('f-type').value = f.source_type;
    document.getElementById('f-formula').value = f.source_formula;
    document.getElementById('f-desc').value = f.description;
    document.getElementById('f-active').checked = f.active;
    currentFeederId = id;
  }
  function closeFdrModal() { document.getElementById('fdr-bg').classList.remove('active'); }
  function saveFeeder() {
    const isEdit = !!document.getElementById('f-id-existing').value;
    const payload = {
      name: document.getElementById('f-name').value,
      tpl_id: document.getElementById('f-tpl').value,
      source_type: document.getElementById('f-type').value,
      source_formula: document.getElementById('f-formula').value,
      description: document.getElementById('f-desc').value,
      active: document.getElementById('f-active').checked,
    };
    if (!payload.name) return showToast('ใส่ชื่อ', 'error');
    document.getElementById('f-save-btn').disabled = true;
    const fn = isEdit ? 'kpiAdminUpdateFeeder' : 'kpiAdminAddFeeder';
    const arg = isEdit ? document.getElementById('f-id-existing').value : payload;
    const arg2 = isEdit ? payload : undefined;
    google.script.run
      .withSuccessHandler(res => {
        document.getElementById('f-save-btn').disabled = false;
        if (res && res.error) return showToast(res.error, 'error');
        showToast(isEdit ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว', 'success');
        closeFdrModal();
        loadFeeders();
      })
      .withFailureHandler(err => { document.getElementById('f-save-btn').disabled = false; showToast(err.message, 'error'); })
      [fn](arg, arg2);
  }
  function testFeederBtn() {
    if (!currentFeederId) return showToast('Save feeder ก่อน test', 'error');
    const empId = prompt('Sample employee_id (active) สำหรับ test:');
    if (!empId) return;
    google.script.run
      .withSuccessHandler(res => {
        const div = document.getElementById('f-test-result');
        div.style.display = 'block';
        if (res && res.error) { div.style.borderLeftColor = 'var(--danger)'; div.style.background = '#FEF2F2'; div.style.color = 'var(--danger)'; div.textContent = 'Error: ' + res.error; }
        else { div.style.borderLeftColor = 'var(--success)'; div.style.background = '#F0FDFA'; div.style.color = '#0F766E'; div.textContent = 'OK · sample: ' + res.sample_employee + ' · value: ' + res.value; }
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminTestFeeder(currentFeederId, empId);
  }
  function removeFeeder(id) {
    if (!confirm('ลบ feeder?')) return;
    google.script.run
      .withSuccessHandler(res => { if (res && res.error) return showToast(res.error, 'error'); showToast('ลบแล้ว', 'success'); loadFeeders(); })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminRemoveFeeder(id);
  }

  // ====== Log tab ======
  function loadLog() {
    document.getElementById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) return showToast(res && res.error || 'load failed', 'error');
        const items = res.items || [];
        let html = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">แสดง ' + items.length + ' รายการ จาก ' + (res.total_in_log || 0) + ' ทั้งหมด</div>';
        if (!items.length) html += '<div class="empty-tab">ยังไม่มี config log บน dashboard — audit log อยู่ใน HR Apps Script (Sheet 75)</div>';
        else {
          items.forEach(l => {
            html += '<div class="log-entry">';
            html += '<div class="log-meta">';
            html += '<span class="log-action">' + escapeHtml(l.action) + '</span>';
            html += '<span><strong>' + escapeHtml(l.entity_type) + '</strong> ' + escapeHtml(l.entity_id) + '</span>';
            html += '<span style="color:var(--text-faint)">' + escapeHtml(l.changed_by) + '</span>';
            html += '<span style="color:var(--text-faint);margin-left:auto">' + escapeHtml(l.changed_at) + '</span>';
            html += '</div>';
            if (l.before_json && l.before_json !== '{}') html += '<div class="log-json">before: ' + escapeHtml(l.before_json.substring(0, 200)) + '</div>';
            if (l.after_json && l.after_json !== '{}') html += '<div class="log-json">after: ' + escapeHtml(l.after_json.substring(0, 200)) + '</div>';
            html += '</div>';
          });
        }
        document.getElementById('content').innerHTML = html;
      })
      .withFailureHandler(err => showToast(err.message, 'error'))
      .kpiAdminListLog({ limit: 100 });
  }

  /* ===== expose fn ที่ inline onclick/markup ต้องเรียก ไปยัง window ===== */
  const _exp = {
    showHelp: showHelp, HELP: HELP, setTab: setTab, reloadAll: reloadAll,
    runMonthly: runMonthly, runBackPeriod: runBackPeriod, backfillPeriodsUI: backfillPeriodsUI, runAllPeriodsUI: runAllPeriodsUI,
    runFoSync: runFoSync, seedKpiSetup: seedKpiSetup, fixPeriods: fixPeriods,
    openSetupWizard: openSetupWizard, closeWizard: closeWizard, wzRender: wzRender, wzToggle: wzToggle, wzSum: wzSum, saveWizard: saveWizard,
    openTplModal: openTplModal, openTplEdit: openTplEdit, closeTplModal: closeTplModal, saveTemplate: saveTemplate,
    approveTemplate: approveTemplate, archiveTemplate: archiveTemplate, approvePositionBtn: approvePositionBtn,
    applyTplFilter: applyTplFilter, filterByPosition: filterByPosition, setTplView: setTplView,
    openOvrModal: openOvrModal, closeOvrModal: closeOvrModal, saveOverride: saveOverride, removeOverride: removeOverride,
    openPrdModal: openPrdModal, closePrdModal: closePrdModal, savePeriod: savePeriod,
    recalcPeriod: recalcPeriod, finalizePeriod: finalizePeriod, reopenPeriod: reopenPeriod,
    filterScores: filterScores, openOverrideScore: openOverrideScore, closeOvsModal: closeOvsModal, confirmOverrideScore: confirmOverrideScore,
    loadAggregates: loadAggregates,
    openFdrModal: openFdrModal, openFdrEdit: openFdrEdit, closeFdrModal: closeFdrModal, saveFeeder: saveFeeder, testFeederBtn: testFeederBtn, removeFeeder: removeFeeder,
  };
  Object.keys(_exp).forEach(k => { window[k] = _exp[k]; });

  /* ===== Init ===== */
  loadTemplates();
}
