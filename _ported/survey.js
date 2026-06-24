// _ported/survey.js — FULL native port of desktop surveys_manager.html (HR Announcement admin)
// ลอกทั้งดุ้น: 5 tab (Overview / Responses / Flex Preview / Manual Send / Trends) + detail modal + help modal
//   CSS เดิม (in-page <style> ของ surveys_manager) prefix #sv ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ mountSurvey() · google.script.run = shim → SV_BACKEND (Supabase)
//
// ใช้ global sb + esc + $ (index.html module scope) — ห้าม redeclare
//   (esc/onError ของหน้าเดิม เป็น closure-local ใน SV_RUN_PAGE_JS · ไม่ชน global)
// fn ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน SV_RUN_PAGE_JS
//
// backend (edge fn hr_survey_response):
//   list   : sb.functions.invoke('hr_survey_response') → { items:[...] }
//   submit : sb.functions.invoke('hr_survey_response',{body:{survey_type,employee_id,rating,comment,anonymous}})
//   feature ที่ทำ backend จริงไม่ได้ (Flex multicast / manual send / bulk / cron / export CSV) → stub + toast

/* ============================================================
   SV_BACKEND — map google.script.run (surveysAdmin*) → Supabase hr_survey_response
   คืน shape เดียวกับที่ JS เดิมคาดหวัง (อ่านจาก renderOverview/renderResponses/renderDetail/renderTrend)
   ============================================================ */

// survey types (เดิม TYPE_LABELS) + pulse/review_360 ตามสเปก native dashboard
var SV_TYPE_LABELS = {
  pulse: 'Pulse Survey',
  exit_hr: 'Exit Interview · HR',
  exit_manager: 'Exit Interview · Manager',
  one_on_one: '1:1 Feedback',
  learning_log: 'Learning Log',
  idp_review: 'IDP Review',
  probation_review: 'Probation Review',
  quarterly_review: 'Quarterly Review',
  buddy_feedback: 'Buddy Feedback',
  review_360: '360° Review',
};
// type ที่มี rating field (กำหนดว่าจะโชว์ rating distribution + column)
var SV_RATING_TYPES = { pulse: 1, one_on_one: 1, learning_log: 1, idp_review: 1, quarterly_review: 1, buddy_feedback: 1, review_360: 1, exit_hr: 1, exit_manager: 1 };

function sv2RowType(r)   { return r.survey_type || r.type || ''; }
function sv2RowDate(r)   { return r.submitted_at || r.created_at || r.date || ''; }
function sv2RowRating(r) { var v = r.rating; return (v == null || v === '') ? null : Number(v); }
function sv2RowName(r)   { return r.nickname || r.employee_name || r.employee_id || '—'; }
function sv2NowPeriod()  { return new Date().toISOString().slice(0, 7); }

// cache รายการคำตอบทั้งหมด (โหลดครั้งเดียวจาก list · backend ไม่มี per-type endpoint)
var _sv2Items = null;
function sv2LoadItems() {
  if (_sv2Items) return Promise.resolve(_sv2Items);
  return sb.functions.invoke('hr_survey_response').then(function (res) {
    var data = (res && res.data) || {};
    _sv2Items = (data.items || []);
    // update sidebar badge
    var ct = document.getElementById('ct-survey');
    if (ct) ct.textContent = _sv2Items.length || '';
    return _sv2Items;
  }).catch(function (e) { console.error('[SV_BACKEND list]', e); _sv2Items = []; return _sv2Items; });
}
function sv2InvalidateCache() { _sv2Items = null; }

var SV_BACKEND = {
  // overview — { total_employees, items:[{key,label,total_responses,this_month,avg_rating,last_submitted}] }
  surveysAdminOverview: function () {
    return sv2LoadItems().then(function (items) {
      var keys = Object.keys(SV_TYPE_LABELS);
      var out = keys.map(function (k) {
        var rows = items.filter(function (r) { return sv2RowType(r) === k; });
        var ratings = rows.map(sv2RowRating).filter(function (v) { return v != null && !isNaN(v); });
        var avg = ratings.length ? (ratings.reduce(function (a, b) { return a + b; }, 0) / ratings.length) : null;
        var nowP = sv2NowPeriod();
        var thisMonth = rows.filter(function (r) { return String(sv2RowDate(r) || '').slice(0, 7) === nowP; }).length;
        var last = rows.map(sv2RowDate).filter(Boolean).sort().slice(-1)[0] || '';
        return {
          key: k, label: SV_TYPE_LABELS[k],
          total_responses: rows.length, this_month: thisMonth,
          avg_rating: avg, last_submitted: String(last || '').slice(0, 10),
        };
      }).filter(function (x) { return x.total_responses > 0 || SV_TYPE_LABELS[x.key]; });
      return { total_employees: items.length, items: out };
    });
  },

  // list responses ของ type หนึ่ง — { type,label,total,items,rating_field,rating_distribution }
  surveysAdminListResponses: function (type, opts) {
    opts = opts || {};
    return sv2LoadItems().then(function (items) {
      var rows = items.filter(function (r) { return sv2RowType(r) === type; });
      if (opts.from_date) rows = rows.filter(function (r) { return String(sv2RowDate(r) || '').slice(0, 10) >= opts.from_date; });
      if (opts.to_date)   rows = rows.filter(function (r) { return String(sv2RowDate(r) || '').slice(0, 10) <= opts.to_date; });
      var hasRating = SV_RATING_TYPES[type] && rows.some(function (r) { return sv2RowRating(r) != null; });
      var dist = null;
      if (hasRating) {
        dist = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
        rows.forEach(function (r) { var v = sv2RowRating(r); if (v != null && dist[String(v)] != null) dist[String(v)]++; });
      }
      var mapped = rows.map(function (r, i) {
        return {
          response_id: r.response_id || r.id || String(i),
          employee_id: r.employee_id || '',
          employee_name: sv2RowName(r),
          nickname: r.nickname || '',
          submitted_at: String(sv2RowDate(r) || ''),
          rating: sv2RowRating(r),
          comment: r.comment || '',
          status: r.status || '',
          _raw: r,
        };
      });
      return {
        type: type, label: SV_TYPE_LABELS[type] || type, total: mapped.length,
        items: mapped, rating_field: hasRating ? 'rating' : null, rating_distribution: dist,
      };
    });
  },

  // detail — { label, employee, fields:[{key,value}] }
  surveysAdminGetDetail: function (type, responseId) {
    return sv2LoadItems().then(function (items) {
      var rows = items.filter(function (r) { return sv2RowType(r) === type; });
      var r = rows.filter(function (x, i) {
        return String(x.response_id || x.id || String(i)) === String(responseId);
      })[0];
      // fallback หา index
      if (!r) {
        rows.forEach(function (x, i) { if (String(i) === String(responseId)) r = x; });
      }
      if (!r) return { error: 'ไม่พบคำตอบ' };
      var fields = [];
      var order = ['survey_type', 'employee_id', 'nickname', 'employee_name', 'rating', 'status',
                   'anonymous', 'comment', 'submitted_at', 'created_at'];
      var seen = {};
      order.forEach(function (k) { if (r[k] != null && r[k] !== '') { fields.push({ key: k, value: r[k] }); seen[k] = 1; } });
      Object.keys(r).forEach(function (k) { if (!seen[k] && k.charAt(0) !== '_' && r[k] != null && r[k] !== '') fields.push({ key: k, value: r[k] }); });
      return {
        label: SV_TYPE_LABELS[type] || type,
        employee: r.employee_id ? { name: sv2RowName(r), nickname: r.nickname || '', employee_id: r.employee_id } : null,
        fields: fields,
      };
    });
  },

  // trend — { label, items:[{period,avg_rating,count}] }
  surveysAdminGetTrend: function (type) {
    return sv2LoadItems().then(function (items) {
      var rows = items.filter(function (r) { return sv2RowType(r) === type; });
      var byMonth = {};
      rows.forEach(function (r) {
        var d = String(sv2RowDate(r) || '').slice(0, 7);
        if (!d) return;
        var v = sv2RowRating(r);
        if (!byMonth[d]) byMonth[d] = { sum: 0, n: 0, count: 0 };
        byMonth[d].count++;
        if (v != null && !isNaN(v)) { byMonth[d].sum += v; byMonth[d].n++; }
      });
      var periods = Object.keys(byMonth).sort();
      var out = periods.map(function (p) {
        var m = byMonth[p];
        return { period: p, avg_rating: m.n ? (m.sum / m.n) : null, count: m.count };
      });
      return { label: SV_TYPE_LABELS[type] || type, items: out };
    });
  },

  // submit คำตอบใหม่ (manual send 1 คน ใช้ฟอร์ม native แทน — แต่หน้าเดิมไม่มี · ใช้ผ่าน addRecord)
  surveysAdminSubmit: function (payload) {
    return sb.functions.invoke('hr_survey_response', { body: payload }).then(function (res) {
      var data = (res && res.data) || {};
      if (data.error) return { error: data.error };
      sv2InvalidateCache();
      return { ok: true };
    });
  },

  // ===== features ที่ backend native ทำไม่ได้ → stub + toast =====
  // Flex preview — ไม่มี flex builder บน dashboard
  surveysAdminPreviewFlex: function () {
    sv2NotReady('ตัวอย่าง Flex message');
    return Promise.resolve({ error: 'Flex preview ยังไม่พร้อมบน dashboard — ดูได้จาก HR Announcement WebApp' });
  },
  // list targets (manual send) — ไม่มี employee resolver เต็ม
  surveysAdminListTargets: function () {
    sv2NotReady('รายชื่อผู้รับ (manual send)');
    return Promise.resolve({ count: 0, items: [], error: 'รายชื่อผู้รับยังไม่พร้อมบน dashboard — ใช้ HR Announcement WebApp' });
  },
  surveysAdminSendManual: function () {
    sv2NotReady('ส่งแบบสอบถามผ่าน LINE');
    return Promise.resolve({ error: 'ส่งผ่าน LINE ยังไม่พร้อมบน dashboard' });
  },
  surveysAdminBulkSend: function () {
    sv2NotReady('Bulk send LINE');
    return Promise.resolve({ error: 'Bulk send ยังไม่พร้อมบน dashboard' });
  },
  surveysAdminRunCron: function () {
    sv2NotReady('Force-run cron');
    return Promise.resolve({ error: 'Force-run cron ยังไม่พร้อมบน dashboard' });
  },
  surveysAdminExportCsv: function () {
    sv2NotReady('Export CSV');
    return Promise.resolve({ error: 'Export CSV ยังไม่พร้อมบน dashboard' });
  },
  // EmpCache stub
  empCacheList: function () { return Promise.resolve([]); },
  navGetExecUrl: function () { return Promise.resolve(''); },
};

var _sv2NotReadyShown = {};
function sv2NotReady(feature) {
  if (_sv2NotReadyShown[feature]) return;
  _sv2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.sv2Toast) window.sv2Toast('ฟีเจอร์ "' + feature + '" ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountSurvey — set innerHTML (CSS + markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountSurvey() {
  var wrap = document.getElementById('wrap-survey');
  if (!wrap) return;
  wrap.innerHTML = '<style>' + SV_CSS() + '</style><div id="sv">' + SV_MARKUP() + '</div>';
  SV_RUN_PAGE_JS();
}

/* ===== CSS เดิม (in-page <style> surveys_manager) · prefix ทุก selector ด้วย #sv =====
   ตัด .app-shell / .main-area / .topbar / .page / body shell · คง class เดิมทั้งหมด */
function SV_CSS() {
  return [
    '#sv{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--bg:#F8F9FA;--text:#333;--muted:#6B7280;--border:#E5E7EB;--card:#FFF;--success:#16A34A;--warn:#D97706;--error:#DC2626;color:var(--text);font-size:14px;line-height:1.5}',
    '#sv *{box-sizing:border-box}',
    // tabs
    '#sv .tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap}',
    '#sv .tab{background:none;border:none;border-bottom:3px solid transparent;padding:10px 16px;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;transition:.15s;font-family:inherit}',
    '#sv .tab:hover{color:var(--navy);background:var(--teal-light)}',
    '#sv .tab.active{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}',
    '#sv .panel{display:none}',
    '#sv .panel.active{display:block}',
    // stat cards
    '#sv .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}',
    '#sv .stat-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;cursor:pointer;transition:.15s;position:relative;overflow:hidden}',
    '#sv .stat-card:hover{border-color:var(--teal);transform:translateY(-2px);box-shadow:0 4px 12px rgba(13,47,79,.08)}',
    '#sv .stat-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#sv .stat-card .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}',
    '#sv .stat-card .name{color:var(--navy);font-size:15px;font-weight:600;margin-bottom:4px}',
    '#sv .stat-card .row{display:flex;justify-content:space-between;font-size:12px;color:var(--text);margin-top:4px}',
    '#sv .stat-card .row.muted{color:var(--muted)}',
    '#sv .stat-card .big{color:var(--teal);font-size:22px;font-weight:700;margin:4px 0}',
    // buttons
    '#sv .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:500;border:1px solid var(--border);background:#fff;color:var(--navy);cursor:pointer;font-family:inherit;transition:.15s}',
    '#sv .btn:hover{background:var(--teal-light);border-color:var(--teal)}',
    '#sv .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#sv .btn-primary:hover{background:var(--navy);border-color:var(--navy)}',
    '#sv .btn-danger{background:#fff;color:var(--error);border-color:var(--error)}',
    '#sv .btn-danger:hover{background:var(--error);color:#fff}',
    '#sv .btn-sm{padding:4px 10px;font-size:12px}',
    '#sv .btn:disabled{opacity:.5;cursor:not-allowed}',
    '#sv .btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}',
    // card
    '#sv .card{background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px}',
    '#sv .card-header{padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}',
    '#sv .card-title{font-weight:600;color:var(--navy);font-size:14px}',
    '#sv .card-body{padding:16px}',
    // table
    '#sv table{width:100%;border-collapse:collapse;font-size:13px}',
    '#sv thead{background:var(--navy)}',
    '#sv thead th{color:#fff;padding:10px 12px;text-align:left;font-weight:500;font-size:12px;text-transform:uppercase;letter-spacing:.3px}',
    '#sv tbody td{padding:10px 12px;border-top:1px solid var(--border)}',
    '#sv tbody tr:hover{background:var(--teal-light)}',
    '#sv td.right,#sv th.right{text-align:right}',
    '#sv td.center,#sv th.center{text-align:center}',
    // pills
    '#sv .pill{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500}',
    '#sv .pill-pass{background:#DCFCE7;color:var(--success)}',
    '#sv .pill-extend{background:#FEF3C7;color:var(--warn)}',
    '#sv .pill-fail{background:#FEE2E2;color:var(--error)}',
    '#sv .pill-pending{background:#F3F4F6;color:var(--muted)}',
    '#sv .pill-completed{background:#DCFCE7;color:var(--success)}',
    '#sv .pill-in_progress{background:#FEF3C7;color:var(--warn)}',
    '#sv .pill-needs_revision{background:#FEE2E2;color:var(--error)}',
    // flex preview canvas
    '#sv .flex-preview{background:#B7C5D5;border-radius:16px;padding:20px;min-height:400px;display:flex;align-items:center;justify-content:center}',
    '#sv .flex-bubble{background:#fff;border-radius:16px;max-width:320px;width:100%;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.15);font-family:inherit;line-height:1.35}',
    '#sv .flex-text{white-space:pre-wrap;word-break:break-word}',
    '#sv .flex-btn{display:block;padding:10px 12px;border-radius:8px;text-align:center;font-weight:500;font-size:13px;margin:4px 0;text-decoration:none;border:1px solid transparent}',
    '#sv .flex-btn.primary{color:#fff}',
    '#sv .flex-btn.secondary{background:#fff;border-color:var(--border);color:var(--navy)}',
    '#sv .flex-btn.link{color:var(--teal);text-decoration:underline}',
    '#sv .flex-separator{height:1px;background:var(--border);margin:8px 0}',
    // modal (scope #sv · fixed · z สูง)
    '#sv .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9000;justify-content:center;align-items:flex-start;padding-top:40px;overflow-y:auto}',
    '#sv .modal-overlay.show{display:flex}',
    '#sv .modal{background:#fff;border-radius:12px;max-width:720px;width:92%;padding:24px;box-shadow:0 20px 40px rgba(0,0,0,.2)}',
    '#sv .modal h3{color:var(--navy);margin:0 0 16px 0;font-size:18px}',
    '#sv .form-row{margin-bottom:12px}',
    '#sv .form-row label{display:block;color:var(--muted);font-size:12px;font-weight:500;margin-bottom:4px}',
    '#sv .form-row input,#sv .form-row select,#sv .form-row textarea{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit}',
    '#sv .modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}',
    // filter row
    '#sv .filter-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center}',
    '#sv .filter-row input,#sv .filter-row select{border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px;background:#fff}',
    // empty / loading / banners
    '#sv .empty{padding:40px;text-align:center;color:var(--muted)}',
    '#sv .loading{padding:40px;text-align:center;color:var(--muted)}',
    '#sv .warn-banner{background:#FEF3C7;border:1px solid var(--warn);color:#92400E;padding:12px 16px;border-radius:8px;margin-bottom:12px;font-size:13px}',
    '#sv .info-banner{background:var(--teal-light);border:1px solid var(--teal);color:var(--navy);padding:12px 16px;border-radius:8px;margin-bottom:12px;font-size:13px}',
    '#sv .help-btn{background:var(--navy);color:#fff;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-weight:700}',
    // trend bars
    '#sv .trend-bars{display:flex;align-items:flex-end;gap:6px;height:200px;padding:16px 0;border-bottom:1px solid var(--border)}',
    '#sv .trend-bar{flex:1;background:var(--teal);border-radius:4px 4px 0 0;position:relative;min-width:30px}',
    '#sv .trend-bar .bar-label{position:absolute;top:-22px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--navy);font-weight:600}',
    '#sv .trend-bar .bar-period{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:10px;color:var(--muted);white-space:nowrap}',
    // rating distribution
    '#sv .rating-distribution{display:flex;gap:6px;padding:8px 0}',
    '#sv .rating-distribution .rd-item{flex:1;background:var(--teal-light);border-radius:4px;padding:8px;text-align:center}',
    '#sv .rating-distribution .rd-item .rd-count{font-size:18px;font-weight:700;color:var(--teal)}',
    '#sv .rating-distribution .rd-item .rd-label{font-size:11px;color:var(--muted)}',
    '@media (max-width:768px){#sv .stat-grid{grid-template-columns:1fr}#sv table{font-size:12px}#sv thead th,#sv tbody td{padding:8px 6px}}',
  ].join('\n');
}

/* ===== markup เดิม ครบทุก panel + 2 modals · คง element id เดิม =====
   ตัด page-head/app-shell · header in-page ใช้ปุ่ม help เดิม */
function SV_MARKUP() {
  return [
    // help button bar (เดิมอยู่ใน .page-actions)
    '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">',
      '<button class="help-btn" onclick="svShowHelp()" title="คู่มือ">?</button>',
    '</div>',
    // tabs
    '<div class="tabs">',
      '<button class="tab active" data-tab="overview" onclick="svSwitchTab(\'overview\')">Overview</button>',
      '<button class="tab" data-tab="responses" onclick="svSwitchTab(\'responses\')">Responses</button>',
      '<button class="tab" data-tab="preview" onclick="svSwitchTab(\'preview\')">Flex Preview</button>',
      '<button class="tab" data-tab="send" onclick="svSwitchTab(\'send\')">Manual Send</button>',
      '<button class="tab" data-tab="trends" onclick="svSwitchTab(\'trends\')">Trends</button>',
    '</div>',
    // OVERVIEW
    '<div class="panel active" id="panel-overview">',
      '<div id="overviewContent" class="loading">กำลังโหลด...</div>',
    '</div>',
    // RESPONSES
    '<div class="panel" id="panel-responses">',
      '<div class="filter-row">',
        '<label style="color:var(--muted);font-size:12px">Survey type:</label>',
        '<select id="respType" onchange="loadResponses()"><option value="">เลือก survey type</option></select>',
        '<input type="date" id="respFrom" onchange="loadResponses()" />',
        '<input type="date" id="respTo" onchange="loadResponses()" />',
        '<button class="btn btn-sm" onclick="exportResponsesCsv()">Export CSV</button>',
      '</div>',
      '<div id="responsesContent" class="empty">เลือก survey type ก่อน</div>',
    '</div>',
    // FLEX PREVIEW
    '<div class="panel" id="panel-preview">',
      '<div class="filter-row">',
        '<label style="color:var(--muted);font-size:12px">Survey type:</label>',
        '<select id="prevType" onchange="loadPreview()"><option value="">เลือก survey type</option></select>',
        '<span style="color:var(--muted);font-size:12px">· ใช้ sample data เพื่อ render flex</span>',
      '</div>',
      '<div id="previewContent" class="empty">เลือก survey type เพื่อดูตัวอย่าง flex message</div>',
    '</div>',
    // MANUAL SEND
    '<div class="panel" id="panel-send">',
      '<div class="filter-row">',
        '<label style="color:var(--muted);font-size:12px">Survey type:</label>',
        '<select id="sendType" onchange="loadSendTargets()"><option value="">เลือก survey type</option></select>',
      '</div>',
      '<div id="sendContent" class="empty">เลือก survey type ก่อน</div>',
    '</div>',
    // TRENDS
    '<div class="panel" id="panel-trends">',
      '<div class="filter-row">',
        '<label style="color:var(--muted);font-size:12px">Survey type:</label>',
        '<select id="trendType" onchange="loadTrend()"><option value="">เลือก survey type</option></select>',
      '</div>',
      '<div id="trendContent" class="empty">เลือก survey type ก่อน · trend show rating avg ต่อเดือน</div>',
    '</div>',
    // Response Detail Modal
    '<div class="modal-overlay" id="detailModal">',
      '<div class="modal" style="max-width:720px">',
        '<div id="detailContent">กำลังโหลด...</div>',
        '<div class="modal-actions"><button class="btn" onclick="svCloseDetailModal()">ปิด</button></div>',
      '</div>',
    '</div>',
    // Help Modal
    '<div class="modal-overlay" id="helpModal">',
      '<div class="modal" style="max-width:720px">',
        '<h3>คู่มือ Surveys Manager</h3>',
        '<div style="font-size:13px;color:var(--text);line-height:1.7">',
          '<p><strong>8 surveys:</strong></p>',
          '<ol>',
            '<li><strong>Exit HR</strong> — HR กดส่งหลัง open offboarding case</li>',
            '<li><strong>Exit Manager</strong> — หัวหน้าคุยรอบ 2</li>',
            '<li><strong>1:1 Feedback</strong> — auto หลัง 1:1 complete · inline rating</li>',
            '<li><strong>Learning Log</strong> — วันที่ 21 ทุกเดือน + spot-check 10%</li>',
            '<li><strong>IDP Review</strong> — เช็ค IDP ค้าง 60 วัน · monthly cron</li>',
            '<li><strong>Probation Review</strong> — ตาม milestone 30/60/90 · scheduler</li>',
            '<li><strong>Quarterly Review</strong> — วันแรกของ Q1/Q2/Q3/Q4 · KPI summary</li>',
            '<li><strong>Buddy Feedback</strong> — Day 14 ของพนักงานใหม่ · once only</li>',
          '</ol>',
          '<p><strong>Permissions:</strong></p>',
          '<ul>',
            '<li><strong>HR Officer+:</strong> ดู responses, preview flex, manual send 1 คน, approve learning log</li>',
            '<li><strong>HR Manager+:</strong> Force-run cron, bulk send, export CSV</li>',
          '</ul>',
          '<p><strong>Flex preview tab</strong> ใช้ sample data render bubble เหมือนใน LINE — ดูก่อนส่งจริง</p>',
        '</div>',
        '<div class="modal-actions"><button class="btn btn-primary" onclick="svCloseHelp()">เข้าใจแล้ว</button></div>',
      '</div>',
    '</div>',
  ].join('');
}

/* ============================================================
   SV_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → SV_BACKEND
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย
   หมายเหตุ scope: getElementById('id') ทำงานได้เพราะ id เดิมถูกคง (อยู่ใน #sv subtree)
   ============================================================ */
function SV_RUN_PAGE_JS() {

  // ---- google.script.run shim → SV_BACKEND (async, คืน shape เดิม) ----
  function _sv2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (SV_BACKEND[prop]) {
            Promise.resolve().then(function () { return SV_BACKEND[prop].apply(SV_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[SV_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[SV_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      }
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _sv2MakeChain(); } });

  // ---- helper: toast (สำหรับ stub) ----
  function svShowToast(msg, type) {
    var t = document.getElementById('sv2-toast');
    if (!t) {
      t = document.createElement('div'); t.id = 'sv2-toast';
      t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s';
      document.body.appendChild(t);
    }
    t.style.background = type === 'error' ? '#DC2626' : type === 'success' ? '#16A34A' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.sv2Toast = svShowToast;

  // ===== โค้ดหน้าเดิม (surveys_manager.html <script>) — ลอกทั้งดุ้น =====
  const TYPE_LABELS = {
    exit_hr: 'Exit Interview · HR',
    exit_manager: 'Exit Interview · Manager',
    one_on_one: '1:1 Feedback',
    learning_log: 'Learning Log',
    idp_review: 'IDP Review',
    probation_review: 'Probation Review',
    quarterly_review: 'Quarterly Review',
    buddy_feedback: 'Buddy Feedback',
    // เพิ่ม pulse / review_360 (native dashboard มี)
    pulse: 'Pulse Survey',
    review_360: '360° Review',
  };
  const CRON_TYPES = ['learning_log', 'idp_review', 'quarterly_review', 'buddy_feedback'];

  function init() {
    // Populate selects
    ['respType', 'prevType', 'sendType', 'trendType'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      Object.entries(TYPE_LABELS).forEach(([k, v]) => {
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = v;
        sel.appendChild(opt);
      });
    });
    loadOverview();
  }

  function svSwitchTab(name) {
    document.querySelectorAll('#sv .tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    document.querySelectorAll('#sv .panel').forEach(p => {
      p.classList.toggle('active', p.id === 'panel-' + name);
    });
  }

  function loadOverview() {
    document.getElementById('overviewContent').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(renderOverview)
      .withFailureHandler(onError)
      .surveysAdminOverview();
  }

  function renderOverview(res) {
    if (!res || res.error) {
      document.getElementById('overviewContent').innerHTML =
        '<div class="warn-banner">' + (res && res.error || 'load ล้มเหลว') + '</div>';
      return;
    }
    const html = `
      <div class="info-banner">
        <strong>${res.total_employees}</strong> คำตอบทั้งหมด · click ที่ card เพื่อดู responses
      </div>
      <div class="stat-grid">
        ${res.items.map(x => `
          <div class="stat-card" onclick="openResponseTab('${x.key}')">
            <div class="label">${esc(x.key)}</div>
            <div class="name">${esc(x.label)}</div>
            <div class="big">${x.total_responses}</div>
            <div class="row"><span>เดือนนี้</span><strong>${x.this_month}</strong></div>
            ${x.avg_rating != null ? `<div class="row"><span>Avg rating</span><strong>${x.avg_rating.toFixed(1)}/5</strong></div>` : ''}
            <div class="row muted"><span>ล่าสุด</span><span>${esc(x.last_submitted || '-')}</span></div>
          </div>
        `).join('')}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Quick actions</div></div>
        <div class="card-body">
          <div class="btn-row">
            ${CRON_TYPES.map(t => `
              <button class="btn" onclick="forceCron('${t}')">Force run · ${esc(TYPE_LABELS[t])}</button>
            `).join('')}
            <button class="btn" onclick="forceCron('learning_log_spot_check')">Learning Log Spot-check</button>
          </div>
          <p style="font-size:12px;color:var(--muted);margin-top:8px">
            HR Manager only · Force-run cron จะส่ง survey ออกไปทันที (override schedule)
          </p>
        </div>
      </div>
    `;
    document.getElementById('overviewContent').innerHTML = html;
  }

  function openResponseTab(type) {
    svSwitchTab('responses');
    document.getElementById('respType').value = type;
    loadResponses();
  }

  function loadResponses() {
    const type = document.getElementById('respType').value;
    if (!type) {
      document.getElementById('responsesContent').innerHTML = '<div class="empty">เลือก survey type ก่อน</div>';
      return;
    }
    const opts = {};
    const from = document.getElementById('respFrom').value;
    const to = document.getElementById('respTo').value;
    if (from) opts.from_date = from;
    if (to) opts.to_date = to;
    document.getElementById('responsesContent').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(renderResponses)
      .withFailureHandler(onError)
      .surveysAdminListResponses(type, opts);
  }

  function renderResponses(res) {
    if (!res || res.error) {
      document.getElementById('responsesContent').innerHTML =
        '<div class="warn-banner">' + (res && res.error || 'load ล้มเหลว') + '</div>';
      return;
    }
    if (!res.items || !res.items.length) {
      document.getElementById('responsesContent').innerHTML = '<div class="empty">ไม่มี responses</div>';
      return;
    }
    const showRating = !!res.rating_field;
    const showOutcome = res.type === 'probation_review';
    let distHtml = '';
    if (res.rating_distribution) {
      distHtml = `
        <div class="card">
          <div class="card-header"><div class="card-title">Rating distribution</div></div>
          <div class="card-body">
            <div class="rating-distribution">
              ${[1, 2, 3, 4, 5].map(n => `
                <div class="rd-item">
                  <div class="rd-count">${res.rating_distribution[String(n)] || 0}</div>
                  <div class="rd-label">${n} ดาว</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }
    if (res.outcome_distribution) {
      distHtml = `
        <div class="card">
          <div class="card-header"><div class="card-title">Outcome breakdown</div></div>
          <div class="card-body">
            <div class="rating-distribution">
              ${[['pass', 'ผ่าน'], ['extend', 'ขยาย'], ['fail', 'ไม่ผ่าน'], ['pending', 'รอ']].map(([k, lbl]) => `
                <div class="rd-item">
                  <div class="rd-count">${res.outcome_distribution[k] || 0}</div>
                  <div class="rd-label">${lbl}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }
    const html = `
      ${distHtml}
      <div class="card">
        <div class="card-header">
          <div class="card-title">${esc(res.label)} · ${res.total} responses</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>พนักงาน</th>
              <th>วันที่ submit</th>
              ${showRating ? '<th class="center">Rating</th>' : ''}
              ${showOutcome ? '<th class="center">Outcome</th>' : ''}
              <th>Comment</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${res.items.map(x => `
              <tr>
                <td>${esc(x.nickname || x.employee_name)}<br><span style="color:var(--muted);font-size:11px">${esc(x.employee_id || '-')}</span></td>
                <td>${esc(x.submitted_at || '-')}</td>
                ${showRating ? `<td class="center"><strong style="color:var(--teal)">${x.rating != null ? x.rating + '/5' : '-'}</strong></td>` : ''}
                ${showOutcome ? `<td class="center">${pillOutcome(x.outcome)}</td>` : ''}
                <td style="max-width:300px">${esc((x.comment || '').slice(0, 100))}${(x.comment || '').length > 100 ? '…' : ''}</td>
                <td><button class="btn btn-sm" onclick="svViewDetail('${res.type}', '${esc(String(x.response_id))}')">ดู</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('responsesContent').innerHTML = html;
  }

  function pillOutcome(o) {
    if (!o) return '<span class="pill pill-pending">-</span>';
    const k = String(o).toLowerCase();
    const labels = { pass: 'ผ่าน', extend: 'ขยาย', fail: 'ไม่ผ่าน', pending: 'รอ',
      completed: 'พัฒนาแล้ว', in_progress: 'อยู่ระหว่าง', needs_revision: 'ต้องปรับ' };
    return `<span class="pill pill-${k}">${esc(labels[k] || o)}</span>`;
  }

  function svViewDetail(type, responseId) {
    document.getElementById('detailContent').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    document.getElementById('detailModal').classList.add('show');
    google.script.run
      .withSuccessHandler(renderDetail)
      .withFailureHandler(onError)
      .surveysAdminGetDetail(type, responseId);
  }

  function renderDetail(res) {
    if (!res || res.error) {
      document.getElementById('detailContent').innerHTML =
        '<div class="warn-banner">' + (res && res.error || 'load ล้มเหลว') + '</div>';
      return;
    }
    const html = `
      <h3>${esc(res.label)}</h3>
      ${res.employee ? `<p style="color:var(--muted);font-size:13px">
        <strong>${esc(res.employee.name)}</strong> (${esc(res.employee.nickname)}) · ${esc(res.employee.employee_id)}
      </p>` : ''}
      <table style="font-size:12px">
        <thead><tr><th>Field</th><th>Value</th></tr></thead>
        <tbody>
          ${res.fields.map(f => `
            <tr>
              <td style="font-weight:500;color:var(--navy);white-space:nowrap">${esc(f.key)}</td>
              <td style="word-break:break-all">${esc(f.value == null ? '' : String(f.value))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    document.getElementById('detailContent').innerHTML = html;
  }

  function svCloseDetailModal() {
    document.getElementById('detailModal').classList.remove('show');
  }

  function exportResponsesCsv() {
    const type = document.getElementById('respType').value;
    if (!type) { alert('เลือก survey type ก่อน'); return; }
    if (!confirm('Export CSV สำหรับ ' + TYPE_LABELS[type] + '? (HR Manager only)')) return;
    const opts = {};
    const from = document.getElementById('respFrom').value;
    const to = document.getElementById('respTo').value;
    if (from) opts.from_date = from;
    if (to) opts.to_date = to;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) { svShowToast((res && res.error) || 'export ล้มเหลว', 'error'); return; }
        if (confirm('Export สำเร็จ ' + res.rows + ' rows · เปิดไฟล์ใน Drive?')) {
          window.open(res.file_url, '_blank');
        }
      })
      .withFailureHandler(onError)
      .surveysAdminExportCsv(type, opts);
  }

  // ====== Flex preview ======
  function loadPreview() {
    const type = document.getElementById('prevType').value;
    if (!type) {
      document.getElementById('previewContent').innerHTML = '<div class="empty">เลือก survey type</div>';
      return;
    }
    document.getElementById('previewContent').innerHTML = '<div class="loading">กำลัง render...</div>';
    google.script.run
      .withSuccessHandler(renderPreview)
      .withFailureHandler(onError)
      .surveysAdminPreviewFlex(type, null);
  }

  function renderPreview(res) {
    if (!res || res.error) {
      document.getElementById('previewContent').innerHTML =
        '<div class="warn-banner">' + (res && res.error || 'load ล้มเหลว') + '</div>';
      return;
    }
    const html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">Flex bubble preview</div>
          <span style="font-size:12px;color:var(--muted)">ใช้ sample data — เหมือนที่พนักงานจะเห็นใน LINE</span>
        </div>
        <div class="flex-preview">${renderBubble(res.bubble)}</div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Sample data used</div></div>
        <div class="card-body">
          <pre style="font-size:11px;background:var(--bg);padding:12px;border-radius:8px;overflow-x:auto;margin:0">${esc(JSON.stringify(res.data_used, null, 2))}</pre>
        </div>
      </div>
    `;
    document.getElementById('previewContent').innerHTML = html;
  }

  // flex renderer (ลอกจากหน้าเดิม v1.10.46)
  const FLEX_SIZES = { xxs: 10, xs: 11, sm: 12, md: 14, lg: 16, xl: 18, xxl: 22, '3xl': 28, '4xl': 32, '5xl': 36 };
  const FLEX_SPACE = { none: 0, xs: 4, sm: 6, md: 8, lg: 12, xl: 16, xxl: 24 };
  function flexPx(val) {
    if (val == null) return '';
    if (typeof val === 'number') return val + 'px';
    const s = String(val);
    if (/^-?\d+(\.\d+)?(px|%)$/.test(s)) return s;
    if (FLEX_SPACE[s] != null) return FLEX_SPACE[s] + 'px';
    return s;
  }
  function renderBubble(b) {
    if (!b) return '<div class="empty">no bubble</div>';
    let html = '<div class="flex-bubble">';
    if (b.hero) html += renderBox(b.hero);
    if (b.body) html += renderBox(b.body);
    if (b.footer) html += renderBox(b.footer);
    html += '</div>';
    return html;
  }
  function renderBox(box) {
    if (!box) return '';
    const style = boxStyleString(box);
    return '<div class="flex-box ' + (box.layout || 'vertical') + '" style="' + style + '">' +
      renderBoxContents(box) + '</div>';
  }
  function boxStyleString(box) {
    const style = [];
    const layout = box.layout || 'vertical';
    if (layout === 'horizontal' || layout === 'baseline') {
      style.push('display:flex', 'flex-direction:row');
      if (layout === 'baseline') style.push('align-items:baseline');
    } else {
      style.push('display:flex', 'flex-direction:column');
    }
    if (box.justifyContent) {
      const map = { 'flex-start': 'flex-start', 'flex-end': 'flex-end', center: 'center', 'space-between': 'space-between', 'space-around': 'space-around', 'space-evenly': 'space-evenly' };
      style.push('justify-content:' + (map[box.justifyContent] || box.justifyContent));
    }
    if (box.alignItems) style.push('align-items:' + box.alignItems);
    if (box.backgroundColor) style.push('background:' + box.backgroundColor);
    if (box.cornerRadius) style.push('border-radius:' + flexPx(box.cornerRadius));
    if (box.borderColor) style.push('border:' + flexPx(box.borderWidth || '1px') + ' solid ' + box.borderColor);
    if (box.paddingAll) style.push('padding:' + flexPx(box.paddingAll));
    if (box.paddingTop) style.push('padding-top:' + flexPx(box.paddingTop));
    if (box.paddingBottom) style.push('padding-bottom:' + flexPx(box.paddingBottom));
    if (box.paddingStart) style.push('padding-left:' + flexPx(box.paddingStart));
    if (box.paddingEnd) style.push('padding-right:' + flexPx(box.paddingEnd));
    if (box.spacing) style.push('gap:' + flexPx(box.spacing));
    if (box.width) style.push('width:' + flexPx(box.width));
    if (box.height) style.push('height:' + flexPx(box.height));
    if (box.flex != null) style.push('flex:' + box.flex);
    if (box.position === 'absolute') {
      style.push('position:absolute');
      if (box.offsetTop != null) style.push('top:' + flexPx(box.offsetTop));
      if (box.offsetBottom != null) style.push('bottom:' + flexPx(box.offsetBottom));
      if (box.offsetStart != null) style.push('left:' + flexPx(box.offsetStart));
      if (box.offsetEnd != null) style.push('right:' + flexPx(box.offsetEnd));
      style.push('pointer-events:none');
    } else {
      style.push('position:relative');
    }
    if (box.margin) style.push('margin-top:' + flexPx(box.margin));
    if (Array.isArray(box.contents) && box.contents.some(c => c && c.position === 'absolute')) {
      style.push('overflow:hidden');
    }
    return style.join(';');
  }
  function renderBoxContents(box) {
    if (!box || !box.contents) return '';
    return box.contents.map(c => renderComponent(c)).join('');
  }
  function renderComponent(c) {
    if (!c) return '';
    if (c.type === 'text') {
      const style = [];
      if (c.color) style.push('color:' + c.color);
      if (c.weight === 'bold') style.push('font-weight:600');
      if (c.size) style.push('font-size:' + (FLEX_SIZES[c.size] || 13) + 'px');
      if (c.align) style.push('text-align:' + c.align);
      if (c.gravity === 'center') style.push('align-self:center');
      if (c.margin) style.push('margin-top:' + flexPx(c.margin));
      if (c.flex != null) style.push('flex:' + c.flex);
      if (c.wrap) style.push('white-space:pre-wrap', 'word-break:break-word');
      style.push('line-height:1.35');
      return '<div class="flex-text" style="' + style.join(';') + '">' + esc(c.text || '') + '</div>';
    }
    if (c.type === 'separator') {
      const style = ['height:1px', 'background:' + (c.color || '#E5E7EB')];
      if (c.margin) style.push('margin-top:' + flexPx(c.margin), 'margin-bottom:' + flexPx(c.margin));
      return '<div style="' + style.join(';') + '"></div>';
    }
    if (c.type === 'filler') {
      return '<div style="flex:' + (c.flex != null ? c.flex : '1') + '"></div>';
    }
    if (c.type === 'box') {
      return renderBox(c);
    }
    if (c.type === 'button') {
      const style = c.style || 'secondary';
      const inline = ['display:block', 'padding:9px 10px', 'border-radius:8px', 'text-align:center',
        'font-size:12px', 'font-weight:500', 'margin-top:4px'];
      if (style === 'primary') {
        inline.push('background:' + (c.color || '#3DC5B7'), 'color:white');
      } else if (style === 'secondary') {
        inline.push('background:white', 'color:#0D2F4F', 'border:1px solid #D1D5DB');
      } else if (style === 'link') {
        inline.push('color:' + (c.color || '#3DC5B7'), 'font-weight:500', 'padding:6px');
      }
      const label = (c.action && c.action.label) || 'Button';
      return '<div style="' + inline.join(';') + '">' + esc(label) + '</div>';
    }
    return '';
  }

  // ====== Manual Send ======
  function loadSendTargets() {
    const type = document.getElementById('sendType').value;
    if (!type) {
      document.getElementById('sendContent').innerHTML = '<div class="empty">เลือก survey type</div>';
      return;
    }
    document.getElementById('sendContent').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(renderSendTargets)
      .withFailureHandler(onError)
      .surveysAdminListTargets(type);
  }

  function renderSendTargets(res) {
    const type = document.getElementById('sendType').value;
    if (!res || res.error) {
      document.getElementById('sendContent').innerHTML =
        '<div class="warn-banner">' + (res && res.error || 'load ล้มเหลว') + '</div>';
      return;
    }
    const isCron = CRON_TYPES.includes(type);
    const html = `
      ${isCron ? `
        <div class="info-banner">
          <strong>${esc(TYPE_LABELS[type])}</strong> เป็น cron-driven · ใช้ Bulk Send สำหรับเลือกหลายคนทีเดียว
          หรือ Force run cron จาก Overview tab
        </div>` : ''}
      <div class="card">
        <div class="card-header">
          <div class="card-title">${esc(TYPE_LABELS[type])} · ${res.count} targets</div>
          <input type="search" placeholder="ค้นหา" oninput="filterTargets(this.value)" style="width:200px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px" />
        </div>
        ${isCron ? `
          <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onclick="selectAllTargets(true)">เลือกทั้งหมด</button>
            <button class="btn btn-sm" onclick="selectAllTargets(false)">ล้าง</button>
            <button class="btn btn-danger btn-sm" onclick="bulkSendSelected()">Bulk Send · HR Mgr only</button>
          </div>
        ` : ''}
        <table id="targetsTable">
          <thead>
            <tr>
              ${isCron ? '<th><input type="checkbox" onchange="selectAllTargets(this.checked)" /></th>' : ''}
              <th>Target</th>
              <th class="center">Action</th>
            </tr>
          </thead>
          <tbody>
            ${res.items.map(x => `
              <tr data-search="${esc((x.target_label || '').toLowerCase())}">
                ${isCron ? `<td><input type="checkbox" data-target="${esc(x.target_id)}" /></td>` : ''}
                <td>${esc(x.target_label)}</td>
                <td class="center"><button class="btn btn-primary btn-sm" onclick="sendOne('${type}', '${esc(x.target_id)}')">Send</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('sendContent').innerHTML = html;
  }

  function filterTargets(q) {
    q = q.toLowerCase();
    document.querySelectorAll('#sv #targetsTable tbody tr').forEach(tr => {
      tr.style.display = !q || tr.dataset.search.includes(q) ? '' : 'none';
    });
  }

  function selectAllTargets(checked) {
    document.querySelectorAll('#sv #targetsTable tbody input[type="checkbox"]').forEach(cb => {
      if (cb.closest('tr').style.display !== 'none') cb.checked = checked;
    });
  }

  function sendOne(type, targetId) {
    if (!confirm('ส่ง ' + TYPE_LABELS[type] + ' หา ' + targetId + '?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) { svShowToast((res && res.error) || 'ส่งล้มเหลว', 'error'); return; }
        svShowToast('ส่งสำเร็จ', 'success');
      })
      .withFailureHandler(onError)
      .surveysAdminSendManual(type, targetId, null);
  }

  function bulkSendSelected() {
    const type = document.getElementById('sendType').value;
    const ids = Array.from(document.querySelectorAll('#sv #targetsTable tbody input[type="checkbox"]:checked'))
      .map(cb => cb.dataset.target);
    if (ids.length === 0) { alert('เลือกอย่างน้อย 1 คน'); return; }
    if (ids.length > 200) { alert('เลือกได้ไม่เกิน 200 คนต่อ batch'); return; }
    if (!confirm('Bulk send ' + TYPE_LABELS[type] + ' หา ' + ids.length + ' คน?')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) { svShowToast((res && res.error) || 'bulk send ล้มเหลว', 'error'); return; }
        svShowToast('Bulk send · sent: ' + res.sent + ' · failed: ' + res.failed, 'success');
      })
      .withFailureHandler(onError)
      .surveysAdminBulkSend(type, ids, null);
  }

  function forceCron(type) {
    if (!confirm('Force-run cron · ' + (TYPE_LABELS[type] || type) + '?\n(จะส่ง survey ทันที override schedule)')) return;
    google.script.run
      .withSuccessHandler(res => {
        if (!res || res.error) { svShowToast((res && res.error) || 'cron ล้มเหลว', 'error'); return; }
        svShowToast('Cron รันสำเร็จ', 'success');
      })
      .withFailureHandler(onError)
      .surveysAdminRunCron(type);
  }

  // ====== Trends ======
  function loadTrend() {
    const type = document.getElementById('trendType').value;
    if (!type) {
      document.getElementById('trendContent').innerHTML = '<div class="empty">เลือก survey type</div>';
      return;
    }
    document.getElementById('trendContent').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run
      .withSuccessHandler(renderTrend)
      .withFailureHandler(onError)
      .surveysAdminGetTrend(type, null);
  }

  function renderTrend(res) {
    if (!res || res.error) {
      document.getElementById('trendContent').innerHTML =
        '<div class="warn-banner">' + (res && res.error || 'load ล้มเหลว') + '</div>';
      return;
    }
    if (!res.items || !res.items.length) {
      document.getElementById('trendContent').innerHTML = '<div class="empty">ไม่มี data trend</div>';
      return;
    }
    const max = 5;
    const html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">${esc(res.label)} · Avg rating per month</div>
          <span style="font-size:12px;color:var(--muted)">${res.items.length} periods</span>
        </div>
        <div class="card-body">
          <div class="trend-bars" style="margin-top:30px">
            ${res.items.map(x => {
              const h = x.avg_rating ? (x.avg_rating / max) * 100 : 0;
              return `
                <div class="trend-bar" style="height:${h}%;background:${h > 80 ? 'var(--success)' : h > 60 ? 'var(--teal)' : h > 40 ? 'var(--warn)' : 'var(--error)'}">
                  <div class="bar-label">${x.avg_rating != null ? x.avg_rating.toFixed(1) : '-'}</div>
                  <div class="bar-period">${esc(x.period)}<br/>(${x.count})</div>
                </div>
              `;
            }).join('')}
          </div>
          <p style="font-size:11px;color:var(--muted);margin-top:36px">
            เลข = avg rating · เลขในวงเล็บ = จำนวน responses · max scale = 5
          </p>
        </div>
      </div>
    `;
    document.getElementById('trendContent').innerHTML = html;
  }

  function svShowHelp() { document.getElementById('helpModal').classList.add('show'); }
  function svCloseHelp() { document.getElementById('helpModal').classList.remove('show'); }

  function onError(e) {
    svShowToast('Error: ' + (e && e.message ? e.message : e), 'error');
  }

  // esc — closure-local (ลอกจากหน้าเดิม) · ไม่แตะ/ไม่ชน global esc ใน index.html module scope
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // ---- expose fn ที่ inline onclick / oninput / onchange ต้องใช้ → window ----
  window.svSwitchTab = svSwitchTab;
  window.openResponseTab = openResponseTab;
  window.loadResponses = loadResponses;
  window.svViewDetail = svViewDetail;
  window.svCloseDetailModal = svCloseDetailModal;
  window.exportResponsesCsv = exportResponsesCsv;
  window.loadPreview = loadPreview;
  window.loadSendTargets = loadSendTargets;
  window.filterTargets = filterTargets;
  window.selectAllTargets = selectAllTargets;
  window.sendOne = sendOne;
  window.bulkSendSelected = bulkSendSelected;
  window.forceCron = forceCron;
  window.loadTrend = loadTrend;
  window.svShowHelp = svShowHelp;
  window.svCloseHelp = svCloseHelp;

  // ---- start ----
  init();
}
