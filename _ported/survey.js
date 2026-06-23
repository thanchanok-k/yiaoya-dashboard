/* survey.js · native port of pulse_response.html (+ survey_360.html) · v1
 * ใช้ global `sb` (supabase client) + `esc` ที่ index.html ประกาศไว้แล้ว — ห้าม redeclare
 * Edge function: hr_survey_response
 *   create: sb.functions.invoke('hr_survey_response',{body:{survey_type,employee_id,rating,comment,anonymous}})
 *   list  : sb.functions.invoke('hr_survey_response') -> {items:[...]}
 * survey_type: pulse | exit_hr | one_on_one | learning_log | idp_review | quarterly_review | buddy_feedback | review_360
 * mount target: #wrap-survey · counter: #ct-survey
 */

// ---- ชนิดแบบสอบถาม (ลอกจากระบบเดิม) ----
var SV_TYPES = [
  { v: 'pulse',            l: 'Pulse Survey · เช็คความรู้สึก' },
  { v: 'exit_hr',          l: 'สัมภาษณ์ลาออก (HR)' },
  { v: 'one_on_one',       l: '1-on-1 · คุยตัวต่อตัว' },
  { v: 'learning_log',     l: 'Learning Log · บันทึกการเรียนรู้' },
  { v: 'idp_review',       l: 'IDP Review · แผนพัฒนา' },
  { v: 'quarterly_review', l: 'Quarterly Review · รายไตรมาส' },
  { v: 'buddy_feedback',   l: 'Buddy Feedback · เพื่อนคู่หู' },
  { v: 'review_360',       l: '360° Review · feedback รอบทิศ' }
];

var SV_SCALE = 5; // 1..5

// state
var _svState = { type: 'pulse', rating: null, comment: '', anonymous: true, emp: '' };

function mountSurvey() {
  if (!document.getElementById('wrap-survey')) return;
  document.getElementById('wrap-survey').innerHTML = `
 <style>
 #sv{--svnavy:#0D2F4F;--svteal:#3DC5B7;--svtealdk:#0F766E;--svteallt:#E1F5EE;--svline:#E5E7EB;--svmuted:#6B7280;--sverr:#EF4444;max-width:480px;margin:0 auto}
 #sv .sv-head{position:relative;background:linear-gradient(135deg,var(--svnavy),var(--svtealdk));color:#fff;padding:16px;border-radius:12px;overflow:hidden}
 #sv .sv-blob{position:absolute;width:120px;height:120px;border-radius:50%;background:#ffffff14;top:-44px;right:-36px}
 #sv .sv-eb{font-size:12px;color:var(--svteal);font-weight:600;position:relative}
 #sv .sv-h1{font-size:18px;font-weight:600;margin:6px 0 0;position:relative}
 #sv .sv-card{background:#fff;border-radius:12px;border:.5px solid rgba(0,0,0,.1);margin:14px 0;padding:16px}
 #sv .sv-sec{font-size:13px;color:var(--svnavy);font-weight:600;margin:0 0 10px}
 #sv label{display:block;font-size:12px;color:var(--svmuted);margin:10px 0 4px}
 #sv select,#sv input,#sv textarea{width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:14px;background:#fff;font-family:inherit;box-sizing:border-box}
 #sv textarea{min-height:80px;resize:vertical}
 #sv .sv-anon{background:var(--svteallt);border-left:3px solid var(--svteal);border-radius:7px;padding:11px 13px;margin:0 0 12px;font-size:13px;color:#0F6E56;line-height:1.5}
 #sv .sv-anon b{color:var(--svnavy)}
 #sv .sv-q{font-size:15px;font-weight:500;line-height:1.5;margin:0 0 11px}
 #sv .sv-q .sv-req{color:var(--sverr)}
 #sv .sv-scale{display:flex;gap:5px}
 #sv .sv-pill{flex:1;padding:13px 0;border-radius:7px;text-align:center;font-size:14px;font-weight:500;background:#FAFBFC;color:var(--svmuted);cursor:pointer;border:1px solid var(--svline)}
 #sv .sv-pill:hover{background:var(--svteallt)}
 #sv .sv-pill.active{background:var(--svteal);color:#fff;box-shadow:0 0 0 3px rgba(61,197,183,.25);border-color:var(--svteal)}
 #sv .sv-help{display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:#9CA3AF}
 #sv .sv-chk{display:flex;align-items:center;gap:8px;margin:6px 0 0;cursor:pointer;font-size:13px;color:var(--svnavy)}
 #sv .sv-chk input{width:auto;margin:0}
 #sv .sv-cta button{width:100%;padding:13px;border:0;border-radius:10px;background:var(--svteal);color:#04342C;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;margin:4px 0 6px}
 #sv .sv-cta button:disabled{background:#9CA3AF;color:#fff;cursor:not-allowed}
 #sv .sv-cta-h{font-size:12px;color:#9CA3AF;text-align:center;margin-bottom:14px}
 #sv .sv-row{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:.5px solid var(--svline)}
 #sv .sv-row:last-child{border-bottom:0}
 #sv .sv-pill-st{font-size:11px;font-weight:600;padding:3px 9px;border-radius:10px;background:#FAEEDA;color:#854F0B}
 #sv .sv-pill-st.ap{background:#E6F7F5;color:#0F766E}#sv .sv-pill-st.rj{background:#FCEBEB;color:#791F1F}
 #sv .sv-empty{color:var(--svmuted);font-size:13px;text-align:center;padding:14px}
 </style>
 <div id="sv">
  <div class="sv-head"><div class="sv-blob"></div><div class="sv-eb">SURVEY · แบบสอบถาม</div><div class="sv-h1">ส่งคำตอบ / ดูประวัติ</div></div>
  <div class="sv-card"><div class="sv-sec">ตอบแบบสอบถาม</div>
   <div class="sv-anon" id="sv-banner">
     <b>คำตอบของคุณจะถูกเก็บแบบไม่ระบุชื่อ</b><br>
     HR เห็นเฉพาะภาพรวมตามสาขา/ตำแหน่ง · ไม่สามารถระบุตัวตนรายบุคคล · ปลอดภัยที่จะตอบตรงไปตรงมา
   </div>
   <label>ชนิดแบบสอบถาม</label>
   <select id="sv-type">${SV_TYPES.map(t => `<option value="${t.v}">${esc(t.l)}</option>`).join('')}</select>

   <div style="margin-top:14px">
     <div class="sv-q">ให้คะแนนความรู้สึก / ความเห็นโดยรวม <span class="sv-req">*</span></div>
     <div class="sv-scale" id="sv-scale"></div>
     <div class="sv-help"><span>1 = น้อยที่สุด</span><span>${SV_SCALE} = มากที่สุด</span></div>
   </div>

   <label style="margin-top:14px">ความคิดเห็นเพิ่มเติม</label>
   <textarea id="sv-comment" placeholder="พิมพ์ความคิดเห็น (ไม่บังคับ)"></textarea>

   <label class="sv-chk" style="margin-top:12px"><input type="checkbox" id="sv-anon" checked> ส่งแบบไม่ระบุชื่อ (anonymous)</label>

   <div id="sv-emp-wrap" style="display:none">
     <label>รหัสพนักงาน</label>
     <input id="sv-emp" placeholder="YY-XNU-013">
   </div>
  </div>
  <div class="sv-cta"><button id="sv-btn" disabled>ส่งคำตอบ</button>
   <div class="sv-cta-h" id="sv-btn-h">ให้คะแนนก่อนส่ง</div>
  </div>
  <div class="sv-card"><div class="sv-sec">ประวัติการตอบ</div><div id="sv-hist"><div class="sv-empty">กำลังโหลด...</div></div></div>
 </div>`;

  svRenderScale();
  document.getElementById('sv-type').onchange = function () { _svState.type = this.value; };
  document.getElementById('sv-comment').oninput = function () { _svState.comment = this.value; };
  document.getElementById('sv-anon').onchange = function () { _svState.anonymous = this.checked; svSyncAnon(); };
  document.getElementById('sv-btn').onclick = svSubmit;
  svSyncAnon();
  svUpdateCta();
  svLoad();
}

function svRenderScale() {
  var box = document.getElementById('sv-scale');
  if (!box) return;
  var html = '';
  for (var n = 1; n <= SV_SCALE; n++) {
    html += `<div class="sv-pill${_svState.rating === n ? ' active' : ''}" data-n="${n}">${n}</div>`;
  }
  box.innerHTML = html;
  box.querySelectorAll('.sv-pill').forEach(function (p) {
    p.onclick = function () { svSetRating(parseInt(this.getAttribute('data-n'), 10)); };
  });
}

function svSetRating(n) {
  _svState.rating = n;
  svRenderScale();
  svUpdateCta();
}

function svSyncAnon() {
  // anonymous ติ๊ก = ซ่อน + ไม่ส่ง employee_id
  var w = document.getElementById('sv-emp-wrap');
  var banner = document.getElementById('sv-banner');
  if (w) w.style.display = _svState.anonymous ? 'none' : 'block';
  if (banner) banner.style.display = _svState.anonymous ? 'block' : 'none';
}

function svUpdateCta() {
  var btn = document.getElementById('sv-btn');
  var h = document.getElementById('sv-btn-h');
  if (!btn || !h) return;
  if (_svState.rating != null) {
    btn.disabled = false;
    h.textContent = 'พร้อมส่ง · ส่งแล้วแก้ไม่ได้';
  } else {
    btn.disabled = true;
    h.textContent = 'ให้คะแนนก่อนส่ง';
  }
}

async function svLoad() {
  try {
    const { data } = await sb.functions.invoke('hr_survey_response');
    const items = (data && data.items) || [];
    const hist = document.getElementById('sv-hist');
    if (!hist) return;
    const labelOf = function (v) { var t = SV_TYPES.find(function (x) { return x.v === v; }); return t ? t.l : (v || ''); };
    hist.innerHTML = items.length
      ? items.map(function (x) {
          var st = x.status || '';
          var cls = st === 'approved' ? 'ap' : (st === 'rejected' ? 'rj' : '');
          return '<div class="sv-row"><div><div>' + esc(labelOf(x.survey_type)) +
            '</div><div style="font-size:11px;color:#6B7280">' + esc(x.comment || '') + '</div></div>' +
            '<div style="text-align:right"><div style="font-weight:600;color:#0D2F4F">' +
            (x.rating != null ? esc(String(x.rating)) : '-') + '</div>' +
            '<span class="sv-pill-st ' + cls + '">' + esc(st) + '</span></div></div>';
        }).join('')
      : '<div class="sv-empty">ยังไม่มีการตอบแบบสอบถาม</div>';
    const ct = document.getElementById('ct-survey');
    if (ct) ct.textContent = items.length || '';
  } catch (e) { console.error('sv', e); }
}

async function svSubmit() {
  if (_svState.rating == null) { alert('กรุณาให้คะแนนก่อนส่ง'); return; }
  var anon = !!_svState.anonymous;
  var emp = anon ? '' : (document.getElementById('sv-emp') ? document.getElementById('sv-emp').value.trim() : '');
  if (!anon && !emp) { alert('กรอกรหัสพนักงาน หรือเลือกส่งแบบไม่ระบุชื่อ'); return; }

  var btn = document.getElementById('sv-btn');
  var h = document.getElementById('sv-btn-h');
  btn.disabled = true; btn.textContent = 'กำลังส่ง...'; if (h) h.textContent = 'กำลังส่ง...';

  var body = {
    survey_type: _svState.type,
    rating: _svState.rating,
    comment: _svState.comment,
    anonymous: anon
  };
  if (!anon) body.employee_id = emp; // anonymous = ไม่ต้องส่ง employee_id

  const { data, error } = await sb.functions.invoke('hr_survey_response', { body: body });

  btn.textContent = 'ส่งคำตอบ';
  if (error || (data && data.error)) {
    btn.disabled = false;
    var msg = (data && data.error) || (error && error.message) || 'unknown';
    if (h) h.textContent = 'ส่งล้มเหลว · ' + msg;
    alert('ไม่สำเร็จ: ' + msg);
    return;
  }

  // เคลียร์ฟอร์ม + reload + set ct-survey
  _svState.rating = null;
  _svState.comment = '';
  var c = document.getElementById('sv-comment'); if (c) c.value = '';
  svRenderScale();
  svUpdateCta();
  svLoad();
}
