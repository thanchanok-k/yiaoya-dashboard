// _ported/interviewbank.js — FULL native port of interview_bank_manager.html (HR Announcement admin · หน้า "สรรหา · คลังคำถามสัมภาษณ์")
// ลอกทั้งดุ้น: quick-stats(4) + alert banner + actions(เพิ่ม/รีเฟรช) + data table(6 col) + create modal + detail alert
//   CSS เดิม (<style> หน้า manager · :root tokens + table + modal + yh-quick-stats) prefix #ib ทั้งหมด
//   markup คง element id เดิม (tableWrap, createModal, modalErr, f_question_th, yh-qs-* ฯลฯ)
//   JS หน้าเดิมรันใน scope ของ IB_RUN_PAGE_JS() · google.script.run = shim → IB_BACKEND (Supabase)
//
// ใช้ global sb (index.html module scope) — ห้าม redeclare · helper (esc/showToast) inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน IB_RUN_PAGE_JS
//
// backend (edge fn hr_list?type=interview_bank.updated → {items}) :
//   list   → derive rows(6 col) + quick-stats client-side จาก payload ล่าสุดต่อ question
//            (ตอนนี้ list อาจว่าง = 0 question → render ได้ ไม่ error · empty state สวย)
//   create → เขียนกลับไม่ได้ → stub + toast แจ้งยังไม่พร้อม (read-only)

/* ============================================================
   IB_BACKEND — map google.script.run → Supabase edge fn hr_list (type=interview_bank.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     interviewBankList(opts)   → { rows: [{Question,Position,Category,Difficulty,Usage,"Avg Score"}], _full: [...] }
     interviewBankCreate(p)    → { ok / error } stub + toast
   ============================================================ */
var IB_FN = 'hr_list';
var IB_TYPE = 'interview_bank.updated';

function ib2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function ib2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function ib2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// map payload event ดิบ → question detail object (flat · เก็บไว้ให้ openItem ดู)
function ib2MapQ(p) {
  p = p || {};
  return {
    question_id: p.question_id || p.entity_id || p.id || '',
    question_th: p.question_th || p.question || p.text || '—',
    question_en: p.question_en || '',
    position_id: p.position_id || 'ALL',
    position_name: p.position_name || p.position || '',
    category: p.category || '',
    difficulty: p.difficulty || '',
    time_estimate_min: ib2Num(p.time_estimate_min),
    expected_keywords: p.expected_keywords || '',
    follow_up_questions: p.follow_up_questions || '',
    usage_count: ib2Num(p.usage_count != null ? p.usage_count : p.usage),
    avg_score: (p.avg_score != null) ? p.avg_score : (p.average_score != null ? p.average_score : ''),
    created_at: ib2Date(p.created_at || p.posted_at),
    _raw: p,
  };
}

var IB_BACKEND = {
  // list — { rows(6 col, ตาม COLUMNS เดิม), _full(detail), _stats }
  interviewBankList: function (opts) {
    opts = opts || {};
    return sb.functions.invoke(IB_FN + '?type=' + encodeURIComponent(IB_TYPE)).then(function (res) {
      var data = (res && res.data) || {};
      var items = ib2ToArr(data.items);
      var seen = {}; var full = [];
      items.forEach(function (p) {
        var id = p.question_id || p.entity_id || p.id || '';
        // ไม่มี id → ยังเก็บ (กันคำถามที่ backend ไม่ใส่ id) · ถ้ามี id ให้ dedupe ตัวล่าสุดชนะ
        if (id) { if (seen[id]) return; seen[id] = true; }
        full.push(ib2MapQ(p));
      });

      // rows ตาม COLUMNS เดิม: ["Question","Position","Category","Difficulty","Usage","Avg Score"]
      // ใช้ key เรียงตรงกับ COLUMNS เพราะ render() เดิมใช้ Object.values(r).slice(0, COLUMNS.length)
      var rows = full.map(function (q) {
        return {
          'Question': q.question_th,
          'Position': q.position_name || q.position_id || 'ALL',
          'Category': q.category || '-',
          'Difficulty': q.difficulty || '-',
          'Usage': q.usage_count || 0,
          'Avg Score': (q.avg_score === '' || q.avg_score == null) ? '-' : q.avg_score,
        };
      });

      // quick-stats derive
      var nowMonth = ib2Date(new Date()).slice(0, 7);
      var posSeen = {};
      var topQ = '—'; var topUsage = -1;
      var addedMonth = 0;
      full.forEach(function (q) {
        if (q.position_id) posSeen[q.position_id] = true;
        if ((q.usage_count || 0) > topUsage) { topUsage = q.usage_count || 0; topQ = q.usage_count || 0; }
        if (q.created_at && q.created_at.slice(0, 7) === nowMonth) addedMonth++;
      });
      var stats = {
        total_q: full.length,
        positions: Object.keys(posSeen).length,
        top_q: (topUsage > 0 ? topUsage : '—'),
        added_month: addedMonth,
      };

      return { rows: rows, _full: full, _stats: stats };
    }).catch(function (e) {
      console.warn('[IB_BACKEND] list fetch failed', e);
      return { rows: [], _full: [], _stats: { total_q: 0, positions: 0, top_q: '—', added_month: 0 } };
    });
  },

  // ---- mutation: เขียนกลับไม่ได้บน dashboard → stub + toast ----
  interviewBankCreate: function () {
    ib2NotReady('เพิ่มคำถามสัมภาษณ์');
    return Promise.resolve({ error: 'เพิ่มคำถามยังไม่พร้อมบน dashboard (read-only)' });
  },
};

var _ib2NotReadyShown = {};
function ib2NotReady(feature) {
  if (_ib2NotReadyShown[feature]) return;
  _ib2NotReadyShown[feature] = true;
  if (typeof window !== 'undefined' && window.ib2Toast) window.ib2Toast('ยังไม่พร้อมบน dashboard', 'error');
}

/* ============================================================
   mountInterviewbank — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountInterviewbank() {
  if (!document.getElementById('wrap-interviewbank')) return;
  var wrap = document.getElementById('wrap-interviewbank');
  wrap.innerHTML = '<style>' + IB_CSS() + '</style><div id="ib">' + IB_MARKUP() + '</div>';
  IB_RUN_PAGE_JS();
}

/* ===== CSS เดิม (<style> manager) · prefix ทุก selector ด้วย #ib =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell เดิมที่เป็น global ออก (dashboard มี shell แล้ว)
   คง :root tokens → ย้ายเป็น #ib · คง .top/.actions/.body/table/.modal/.yh-quick-stats ครบ */
function IB_CSS() {
  return [
    // :root tokens เดิม → scope #ib
    '#ib{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--bg:#F8F9FA;--muted:#6B7280;--border:#E5E7EB;color:var(--navy);font-size:14px}',
    '#ib *,#ib *::before,#ib *::after{box-sizing:border-box}',
    // page-head เดิม (header.page-head) · native บน dashboard
    '#ib .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid #E2E8F0}',
    '#ib .page-head h1{font-size:20px;font-weight:600;color:#0D2F4F;letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#ib .page-head h1 svg{width:18px;height:18px;color:#3DC5B7}',
    '#ib .page-head .subtitle{font-size:12px;color:#64748B;margin-top:4px}',
    '#ib .page-actions{display:flex;gap:8px;flex-shrink:0;align-items:center}',
    // quick-stats เดิม
    '#ib .yh-quick-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}',
    '@media (max-width:900px){#ib .yh-quick-stats{grid-template-columns:repeat(2,1fr)}}',
    '#ib .yh-qs-card{background:white;border:1px solid #E2E8F0;border-radius:10px;padding:12px 14px;position:relative;overflow:hidden;cursor:help}',
    '#ib .yh-qs-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#3DC5B7}',
    '#ib .yh-qs-card.warn::before{background:#F59E0B}',
    '#ib .yh-qs-card.danger::before{background:#EF4444}',
    '#ib .yh-qs-card.info::before{background:#185FA5}',
    '#ib .yh-qs-card.success::before{background:#10B981}',
    '#ib .yh-qs-lbl{font-size:10px;font-weight:600;color:#64748B;text-transform:uppercase;letter-spacing:.05em;display:flex;align-items:center;gap:4px}',
    '#ib .yh-qs-lbl svg{width:11px;height:11px;color:#94A3B8}',
    '#ib .yh-qs-val{font-size:22px;font-weight:700;color:#0D2F4F;line-height:1;margin-top:6px;letter-spacing:-.02em}',
    '#ib .yh-qs-sub{font-size:10px;color:#94A3B8;margin-top:3px}',
    // top banner เดิม
    '#ib .top{background:var(--navy);color:white;padding:18px 20px;position:relative;overflow:hidden;border-radius:10px}',
    '#ib .top::after{content:"";position:absolute;top:-30px;right:-30px;width:90px;height:90px;border-radius:50%;background:var(--teal);opacity:.18}',
    '#ib .top>*{position:relative;z-index:1}',
    '#ib .top-eyebrow{font-size:11px;color:rgba(255,255,255,.7);letter-spacing:1.5px}',
    '#ib .top-title{font-size:18px;font-weight:500;margin-top:2px}',
    '#ib .top-sub{font-size:11px;color:rgba(255,255,255,.7);margin-top:6px}',
    // alert
    '#ib .alert{padding:11px 14px;border-radius:8px;margin:14px 0 0;font-size:12px;background:#FEF3C7;color:#B45309;border-left:3px solid #F59E0B}',
    // actions
    '#ib .actions{padding:14px 0;display:flex;gap:10px}',
    '#ib .btn{padding:9px 14px;border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;border:1px solid var(--border);background:white;color:var(--navy)}',
    '#ib .btn-primary{background:var(--teal);color:white;border-color:var(--teal)}',
    // body / table
    '#ib .body{padding:0}',
    '#ib table{width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;border:1px solid var(--border)}',
    '#ib th{background:var(--bg);padding:10px 12px;font-size:10px;font-weight:600;text-align:left;letter-spacing:.5px;color:var(--muted);text-transform:uppercase}',
    '#ib td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border)}',
    '#ib tr:hover td{background:var(--teal-light);cursor:pointer}',
    '#ib .empty{padding:60px 20px;text-align:center;color:var(--muted)}',
    '#ib .loading{padding:40px 20px;text-align:center;color:var(--muted)}',
    // modal
    '#ib .modal-backdrop{position:fixed;inset:0;background:rgba(13,47,79,.6);display:none;align-items:flex-start;justify-content:center;z-index:9000;padding:40px 16px;overflow-y:auto}',
    '#ib .modal-backdrop.show{display:flex}',
    '#ib .modal{background:white;border-radius:14px;padding:24px;max-width:480px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.2)}',
    '#ib .modal-eyebrow{font-size:11px;color:var(--muted);letter-spacing:1.2px}',
    '#ib .modal-title{font-size:17px;font-weight:500;color:var(--navy);margin:2px 0 16px}',
    '#ib .modal-field{margin-bottom:12px}',
    '#ib .modal-label{display:block;font-size:11px;font-weight:500;color:var(--navy);margin-bottom:5px;letter-spacing:.3px}',
    '#ib .modal-input,#ib .modal-select,#ib .modal-textarea{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:inherit;color:var(--navy);background:white}',
    '#ib .modal-input:focus,#ib .modal-select:focus,#ib .modal-textarea:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px var(--teal-light)}',
    '#ib .modal-textarea{resize:vertical;min-height:60px}',
    '#ib .modal-row{display:flex;gap:10px}',
    '#ib .modal-row>.modal-field{flex:1}',
    '#ib .modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}',
    '#ib .modal-err{padding:9px 12px;border-radius:7px;font-size:11px;background:#FEE2E2;color:#DC2626;border-left:3px solid #DC2626;margin-bottom:10px;display:none}',
    '#ib .modal-err.show{display:block}',
  ].join('\n');
}

/* ===== markup เดิม ครบ page-head + quick-stats + top + alert + actions + table + create modal =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell ออก */
function IB_MARKUP() {
  var qsIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>';
  return [
    // page head เดิม
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>',
    '      Interview Bank',
    '    </h1>',
    '    <div class="subtitle">คลังคำถามสัมภาษณ์แยกตำแหน่ง · ดึงไปใช้ตอนนัด interview</div>',
    '  </div>',
    '  <div class="page-actions" id="yh-page-actions">',
    '    <button class="btn btn-sm" onclick="ibLoadData()" title="Refresh" style="display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:6px;border:1px solid #E2E8F0;background:white;color:#475569;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-9-9c2.5 0 4.85.99 6.6 2.6L21 8"/><path d="M21 3v5h-5"/></svg>Refresh</button>',
    '  </div>',
    '</header>',
    // quick stats เดิม
    '<div class="yh-quick-stats">',
    '  <div class="yh-qs-card info" data-tip="คำถามสัมภาษณ์ในคลังทั้งหมด · แยกตามตำแหน่ง · ใช้ตอนนัด interview">',
    '    <div class="yh-qs-lbl">คำถามทั้งหมด ' + qsIco + '</div>',
    '    <div class="yh-qs-val" id="yh-qs-total_q">—</div>',
    '    <div class="yh-qs-sub">in bank</div>',
    '  </div>',
    '  <div class="yh-qs-card" data-tip="จำนวนตำแหน่งที่มีคำถามครบ · ตำแหน่งใหม่ต้องเพิ่ม Q">',
    '    <div class="yh-qs-lbl">ตำแหน่งครอบคลุม ' + qsIco + '</div>',
    '    <div class="yh-qs-val" id="yh-qs-positions">—</div>',
    '    <div class="yh-qs-sub">มี Q</div>',
    '  </div>',
    '  <div class="yh-qs-card" data-tip="คำถามที่ใช้ในการสัมภาษณ์บ่อยที่สุด">',
    '    <div class="yh-qs-lbl">ใช้บ่อยที่สุด ' + qsIco + '</div>',
    '    <div class="yh-qs-val" id="yh-qs-top_q">—</div>',
    '    <div class="yh-qs-sub">count</div>',
    '  </div>',
    '  <div class="yh-qs-card success" data-tip="คำถามที่ HR เพิ่มเข้าคลังในเดือนนี้">',
    '    <div class="yh-qs-lbl">เพิ่มเดือนนี้ ' + qsIco + '</div>',
    '    <div class="yh-qs-val" id="yh-qs-added_month">—</div>',
    '    <div class="yh-qs-sub">คำถามใหม่</div>',
    '  </div>',
    '</div>',
    // top banner เดิม
    '<div class="top">',
    '  <div class="top-eyebrow">G1 · TRELLO CARD #55</div>',
    '  <div class="top-title">Interview Question Bank</div>',
    '  <div class="top-sub">คำถามสัมภาษณ์ per-position · scoring rubric · stratified picker</div>',
    '</div>',
    // alert เดิม
    '<div class="alert">Phase 2 Wave 2 · admin UI scaffolding · backend logic ใน module .gs · เปิด Google Sheet ดูข้อมูลดิบได้</div>',
    // actions เดิม
    '<div class="actions"><button class="btn btn-primary" onclick="ibOpenCreate()">เพิ่ม question</button><button class="btn" onclick="ibLoadData()">รีเฟรช</button></div>',
    // body / table
    '<div class="body"><div id="tableWrap" class="loading">กำลังโหลด...</div></div>',
    // create modal เดิม
    '<div class="modal-backdrop" id="createModal">',
    '  <div class="modal">',
    '    <div class="modal-eyebrow">G1 · INTERVIEW BANK</div>',
    '    <div class="modal-title">เพิ่มคำถามสัมภาษณ์ใหม่</div>',
    '    <div class="modal-err" id="modalErr"></div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">คำถาม (ไทย) *</label>',
    '      <textarea class="modal-textarea" id="f_question_th" placeholder="เช่น · เล่าประสบการณ์ที่ต้องจัดการลูกค้าโกรธ"></textarea>',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">คำถาม (อังกฤษ)</label>',
    '      <textarea class="modal-textarea" id="f_question_en"></textarea>',
    '    </div>',
    '    <div class="modal-row">',
    '      <div class="modal-field">',
    '        <label class="modal-label">Position ID</label>',
    '        <input type="text" class="modal-input" id="f_position_id" placeholder="ALL หรือ P-XXX" value="ALL">',
    '      </div>',
    '      <div class="modal-field">',
    '        <label class="modal-label">Category</label>',
    '        <select class="modal-select" id="f_category">',
    '          <option value="behavioral">Behavioral</option>',
    '          <option value="technical">Technical</option>',
    '          <option value="situational">Situational</option>',
    '          <option value="culture_fit">Culture Fit</option>',
    '          <option value="red_flag">Red Flag</option>',
    '        </select>',
    '      </div>',
    '    </div>',
    '    <div class="modal-row">',
    '      <div class="modal-field">',
    '        <label class="modal-label">Difficulty</label>',
    '        <select class="modal-select" id="f_difficulty">',
    '          <option value="easy">Easy</option>',
    '          <option value="medium" selected>Medium</option>',
    '          <option value="hard">Hard</option>',
    '        </select>',
    '      </div>',
    '      <div class="modal-field">',
    '        <label class="modal-label">เวลาที่คาดว่าจะใช้ตอบ (นาที)</label>',
    '        <input type="number" class="modal-input" id="f_time_estimate_min" value="5" min="1" max="60">',
    '      </div>',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">Keywords ที่คาดหวัง (คั่นด้วย ,)</label>',
    '      <input type="text" class="modal-input" id="f_expected_keywords" placeholder="ใจเย็น,ขอโทษ,ฟังก่อน">',
    '    </div>',
    '    <div class="modal-field">',
    '      <label class="modal-label">Follow-up questions (คั่นด้วย |)</label>',
    '      <input type="text" class="modal-input" id="f_follow_up_questions" placeholder="แล้วสุดท้ายเป็นยังไง|ถ้าเจอแบบนี้อีกจะทำต่างจากเดิมไหม">',
    '    </div>',
    '    <div class="modal-actions">',
    '      <button class="btn" onclick="ibCloseCreate()">ยกเลิก</button>',
    '      <button class="btn btn-primary" id="saveBtn" onclick="ibDoCreate()">บันทึก</button>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   IB_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → IB_BACKEND
   helper (escapeHtml/showToast) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window ตอนท้าย (prefix ib เพื่อกันชนกับหน้าอื่น)
   ============================================================ */
function IB_RUN_PAGE_JS() {

  // ---- google.script.run shim → IB_BACKEND (async, คืน shape เดิม) ----
  function _ib2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (IB_BACKEND[prop]) {
            Promise.resolve().then(function () { return IB_BACKEND[prop].apply(IB_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[IB_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[IB_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _ib2MakeChain(); } });

  // ---- helpers (inline · scope ใต้ #ib กันชน) ----
  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function showToast(msg, type) {
    var t = document.getElementById('ib2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'ib2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(function () { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.ib2Toast = showToast;

  /* ====================================================================
     ===== JS หน้าเดิม interview_bank_manager.html (ลอกทั้งดุ้น) =====
     ใช้ scope ใต้ #ib กันชน id (getById) · COLUMNS/loadData/render คงเดิม
     ==================================================================== */
  var _ibRoot = document.getElementById('ib');
  function getById(id) { return _ibRoot ? _ibRoot.querySelector('#' + id) : document.getElementById(id); }

  var COLUMNS = ['Question', 'Position', 'Category', 'Difficulty', 'Usage', 'Avg Score'];
  var _rows = [];
  var _full = [];   // detail object ต่อ row (สำหรับ openItem)

  function loadData() {
    getById('tableWrap').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(onLoaded).withFailureHandler(function (e) {
      getById('tableWrap').innerHTML = '<div class="empty">โหลดล้มเหลว · ' + escapeHtml(e.message || e) + '</div>';
    }).interviewBankList({});
  }

  function onLoaded(res) {
    if (!res || res.error) {
      getById('tableWrap').innerHTML = '<div class="empty">' + escapeHtml(res ? res.error : 'no_data') + '</div>';
      return;
    }
    _rows = res.rows || res.records || res.items || res.by_channel || [];
    _full = res._full || [];
    renderStats(res._stats || {});
    render();
  }

  function renderStats(s) {
    var set = function (id, v) { var el = getById(id); if (el) el.textContent = (v === '' || v == null) ? '—' : v; };
    set('yh-qs-total_q', s.total_q);
    set('yh-qs-positions', s.positions);
    set('yh-qs-top_q', s.top_q);
    set('yh-qs-added_month', s.added_month);
  }

  function render() {
    if (!_rows.length || !COLUMNS.length) {
      getById('tableWrap').innerHTML = '<div class="empty">ยังไม่มีรายการ</div>';
      return;
    }
    var h = '<table><thead><tr>';
    COLUMNS.forEach(function (c) { h += '<th>' + escapeHtml(c) + '</th>'; });
    h += '</tr></thead><tbody>';
    _rows.forEach(function (r, i) {
      h += '<tr onclick="ibOpenItem(' + i + ')">';
      Object.values(r).slice(0, COLUMNS.length).forEach(function (v) {
        h += '<td>' + escapeHtml(String(v == null ? '-' : v)) + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table>';
    getById('tableWrap').innerHTML = h;
  }

  function openItem(idx) {
    var d = _full[idx] || _rows[idx] || {};
    // ตัด _raw ออกก่อนโชว์ (เดิมใช้ alert(JSON) — คงพฤติกรรมเดิม)
    var view = {};
    Object.keys(d).forEach(function (k) { if (k !== '_raw') view[k] = d[k]; });
    alert(JSON.stringify(view, null, 2));
  }

  // ===== Create modal handlers (คงเดิม · WRITE = stub) =====
  function openCreate() {
    getById('modalErr').classList.remove('show');
    getById('createModal').classList.add('show');
  }
  function closeCreate() { getById('createModal').classList.remove('show'); }
  function modalErr(msg) {
    var e = getById('modalErr'); e.textContent = msg; e.classList.add('show');
  }
  function doCreate() {
    var q = getById('f_question_th').value.trim();
    if (!q) { modalErr('กรุณากรอกคำถาม (ไทย)'); return; }
    var payload = {
      question_th: q,
      question_en: getById('f_question_en').value.trim(),
      position_id: getById('f_position_id').value.trim() || 'ALL',
      category: getById('f_category').value,
      difficulty: getById('f_difficulty').value,
      time_estimate_min: Number(getById('f_time_estimate_min').value || 5),
      expected_keywords: getById('f_expected_keywords').value.trim(),
      follow_up_questions: getById('f_follow_up_questions').value.trim(),
    };
    var btn = getById('saveBtn');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
    google.script.run
      .withSuccessHandler(function (res) {
        btn.disabled = false; btn.textContent = 'บันทึก';
        if (res && res.ok) {
          closeCreate();
          getById('f_question_th').value = '';
          getById('f_question_en').value = '';
          getById('f_expected_keywords').value = '';
          getById('f_follow_up_questions').value = '';
          loadData();
        } else { modalErr('บันทึกล้มเหลว · ' + (res ? res.error : 'unknown')); }
      })
      .withFailureHandler(function (e) {
        btn.disabled = false; btn.textContent = 'บันทึก';
        modalErr('ระบบขัดข้อง · ' + (e.message || e));
      })
      .interviewBankCreate(payload);
  }

  /* ===== expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix ib กันชนหน้าอื่น) ===== */
  window.ibLoadData = loadData;
  window.ibOpenItem = openItem;
  window.ibOpenCreate = openCreate;
  window.ibCloseCreate = closeCreate;
  window.ibDoCreate = doCreate;

  /* ===== Init ===== */
  loadData();
}
