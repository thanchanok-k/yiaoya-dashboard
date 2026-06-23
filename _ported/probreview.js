/* probreview.js — native port ของหน้า "ประเมินทดลองงาน" (เดิม probation_review_liff.html)
 * ใช้ global ที่มีอยู่แล้วใน index.html: sb (supabase client), esc (html-escape)
 * ห้าม redeclare sb/esc · var/fn ทุกตัว prefix `pr` · scoped CSS `#pr` + element id `pr-`
 * mount จุดเดียว: เรียก mountProbreview() แทน mountWrite('probreview')
 *
 * Field map (contract กับ edge function hr_probation_review):
 *   create body = { employee_id, milestone_days, result, score, comments, review_date }
 *     - employee_id   : string  (input "รหัสพนักงาน" -> pr-emp แทน ?uid=)
 *     - milestone_days : 30 | 60 | 90 | 120
 *     - result        : pass | extend | fail
 *     - score         : number (คะแนนรวม 0-100, อาจเว้นได้)
 *     - comments      : string (ความเห็นเพิ่มเติม)
 *     - review_date   : YYYY-MM-DD
 *   list = sb.functions.invoke('hr_probation_review') -> { items:[...] }
 */

var PR_FN = 'hr_probation_review';
var prResult = '';      // ผลที่เลือก: pass | extend | fail
var prBusy = false;

function mountProbreview() {
  var wrap = document.getElementById('wrap-probreview');
  if (!wrap) return;

  wrap.innerHTML = ''
    + '<style>'
    + '#pr{--prnavy:#0D2F4F;--prteal:#3DC5B7;--prtealdk:#0F766E;--prline:#E5E7EB;--prmuted:#6B7280;max-width:480px;margin:0 auto}'
    + '#pr .pr-head{position:relative;background:linear-gradient(135deg,var(--prnavy),var(--prtealdk));color:#fff;padding:16px;border-radius:12px;overflow:hidden}'
    + '#pr .pr-blob{position:absolute;width:120px;height:120px;border-radius:50%;background:#ffffff14;top:-44px;right:-36px}'
    + '#pr .pr-eb{font-size:12px;color:var(--prteal);font-weight:600;position:relative}'
    + '#pr .pr-h1{font-size:18px;font-weight:600;margin:6px 0 0;position:relative}'
    + '#pr .pr-card{background:#fff;border-radius:12px;border:.5px solid rgba(0,0,0,.1);margin:14px 0;padding:16px}'
    + '#pr .pr-sec{font-size:13px;color:var(--prnavy);font-weight:600;margin:0 0 10px;display:flex;align-items:center;gap:8px}'
    + '#pr .pr-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#E0F7F4;color:var(--prtealdk);font-size:11px;font-weight:700}'
    + '#pr label{display:block;font-size:12px;color:var(--prmuted);margin:10px 0 4px}'
    + '#pr select,#pr input,#pr textarea{width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:14px;background:#fff;font-family:inherit;box-sizing:border-box}'
    + '#pr textarea{min-height:64px;resize:vertical}'
    + '#pr .pr-notice{background:#FEF3C7;color:#92400E;border-radius:10px;padding:9px 12px;font-size:12.5px;line-height:1.55;margin-bottom:12px}'
    + '#pr .pr-deci{display:flex;gap:8px}'
    + '#pr .pr-deci button{flex:1;text-align:center;border:1.5px solid var(--prline);border-radius:10px;padding:11px 4px;font-size:13px;font-weight:600;color:var(--prmuted);background:#fff;font-family:inherit;cursor:pointer}'
    + '#pr .pr-deci button.on{border-color:var(--prtealdk);background:#E0F7F4;color:var(--prtealdk)}'
    + '#pr .pr-cta button{width:100%;padding:13px;border:0;border-radius:10px;background:var(--prteal);color:#04342C;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;margin:4px 0 14px}'
    + '#pr .pr-cta button:disabled{opacity:.6;cursor:default}'
    + '#pr .pr-msg{font-size:12.5px;color:var(--prmuted);text-align:center;min-height:18px;margin-bottom:8px}'
    + '#pr .pr-msg.err{color:#A32D2D}#pr .pr-msg.ok{color:var(--prtealdk)}'
    + '#pr .pr-row{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:.5px solid var(--prline)}'
    + '#pr .pr-row:last-child{border-bottom:0}'
    + '#pr .pr-pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:10px;background:#FAEEDA;color:#854F0B}'
    + '#pr .pr-pill.ap{background:#E6F7F5;color:#0F766E}#pr .pr-pill.rj{background:#FCEBEB;color:#791F1F}'
    + '#pr .pr-res{font-weight:600;color:var(--prnavy)}'
    + '#pr .pr-empty{color:var(--prmuted);font-size:13px;text-align:center;padding:14px}'
    + '</style>'
    + '<div id="pr">'
    + '  <div class="pr-head"><div class="pr-blob"></div><div class="pr-eb">PROBATION · ประเมินทดลองงาน</div><div class="pr-h1">บันทึกผลรีวิว / ดูประวัติ</div></div>'
    + '  <div class="pr-notice">ผลรีวิวเป็นข้อมูลลับ · ระบบบันทึกผู้กรอกและเวลา · พนักงานจะได้รับแจ้งผลผ่าน flow ปกติ ไม่เห็นคะแนนรายข้อ</div>'
    + '  <div class="pr-card">'
    + '    <div class="pr-sec"><span class="pr-num">1</span>พนักงาน &amp; รอบประเมิน</div>'
    + '    <label>รหัสพนักงาน</label><input id="pr-emp" placeholder="YY-XNU-013">'
    + '    <label>รอบประเมิน (วัน)</label><select id="pr-milestone"><option value="30">ครบ 30 วัน</option><option value="60">ครบ 60 วัน</option><option value="90" selected>ครบ 90 วัน</option><option value="120">ครบ 120 วัน</option></select>'
    + '    <label>วันประเมิน</label><input id="pr-date" type="date">'
    + '  </div>'
    + '  <div class="pr-card">'
    + '    <div class="pr-sec"><span class="pr-num">2</span>คะแนน &amp; ความเห็น</div>'
    + '    <label>คะแนนรวม (0-100)</label><input id="pr-score" type="number" min="0" max="100" placeholder="เช่น 82">'
    + '    <label>ความเห็นเพิ่มเติม</label><textarea id="pr-comments" placeholder="จุดแข็ง · จุดที่ควรพัฒนา · ข้อสังเกต"></textarea>'
    + '  </div>'
    + '  <div class="pr-card">'
    + '    <div class="pr-sec"><span class="pr-num">3</span>ผลการประเมินรอบนี้</div>'
    + '    <div class="pr-deci" id="pr-deci">'
    + '      <button data-result="pass">ผ่านเกณฑ์</button>'
    + '      <button data-result="extend">ติดตามต่อ</button>'
    + '      <button data-result="fail">ไม่ผ่าน</button>'
    + '    </div>'
    + '  </div>'
    + '  <div class="pr-msg" id="pr-msg"></div>'
    + '  <div class="pr-cta"><button id="pr-btn">บันทึกผลรีวิว</button></div>'
    + '  <div class="pr-card"><div class="pr-sec"><span class="pr-num"><i class="ti ti-history" style="font-size:12px"></i></span>ประวัติการประเมิน</div><div id="pr-hist"><div class="pr-empty">กำลังโหลด...</div></div></div>'
    + '</div>';

  // reset state ทุกครั้งที่ mount
  prResult = '';
  prBusy = false;

  // ปุ่มผลการประเมิน — toggle เลือกได้ครั้งเดียว (เหมือน setDecision เดิม)
  var deci = document.getElementById('pr-deci');
  var btns = deci.getElementsByTagName('button');
  for (var i = 0; i < btns.length; i++) {
    btns[i].onclick = prSetResult;
  }

  document.getElementById('pr-btn').onclick = prSubmit;
  prLoad();
}

function prSetResult(e) {
  var btn = e.currentTarget;
  prResult = btn.getAttribute('data-result');
  var btns = document.getElementById('pr-deci').getElementsByTagName('button');
  for (var i = 0; i < btns.length; i++) btns[i].className = '';
  btn.className = 'on';
}

function prMsg(text, kind) {
  var el = document.getElementById('pr-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'pr-msg' + (kind ? ' ' + kind : '');
}

// map ผล -> ฉลากไทย/สีในตารางประวัติ
function prResultLabel(r) {
  return { pass: 'ผ่าน', extend: 'ติดตามต่อ', fail: 'ไม่ผ่าน' }[r] || (r || '');
}

async function prLoad() {
  try {
    var res = await sb.functions.invoke(PR_FN);
    var data = res && res.data;
    var items = (data && data.items) || [];
    var hist = document.getElementById('pr-hist');
    if (!hist) return;
    if (!items.length) {
      hist.innerHTML = '<div class="pr-empty">ยังไม่มีรายการประเมิน</div>';
    } else {
      hist.innerHTML = items.map(function (x) {
        var s = String(x.status || '').toLowerCase();
        var pill = s === 'approved' ? 'ap' : (s === 'rejected' ? 'rj' : '');
        var scoreTxt = (x.score != null && x.score !== '') ? (Math.round(Number(x.score) * 10) / 10) : '–';
        return '<div class="pr-row">'
          + '<div><div>' + esc(x.employee_id || '') + ' · ครบ ' + esc(x.milestone_days || '') + ' วัน</div>'
          + '<div style="font-size:11px;color:#6B7280">' + esc(prResultLabel(x.result)) + (x.comments ? ' · ' + esc(x.comments) : '') + '</div></div>'
          + '<div style="text-align:right"><div class="pr-res">' + esc(scoreTxt) + '</div>'
          + (x.status ? '<span class="pr-pill ' + pill + '">' + esc(x.status) + '</span>' : '') + '</div>'
          + '</div>';
      }).join('');
    }
    var ct = document.getElementById('ct-probreview');
    if (ct) ct.textContent = items.length || '';
  } catch (e) {
    console.error('pr', e);
  }
}

async function prSubmit() {
  if (prBusy) return;
  var emp = (document.getElementById('pr-emp').value || '').trim();
  var milestone = document.getElementById('pr-milestone').value;
  var scoreRaw = (document.getElementById('pr-score').value || '').trim();
  var comments = document.getElementById('pr-comments').value || '';
  var reviewDate = document.getElementById('pr-date').value || '';

  if (!emp) { prMsg('กรุณากรอกรหัสพนักงาน', 'err'); return; }
  if (!prResult) { prMsg('กรุณาเลือกผลการประเมิน (ผ่าน / ติดตามต่อ / ไม่ผ่าน)', 'err'); return; }

  var body = {
    employee_id: emp,
    milestone_days: milestone,
    result: prResult,
    comments: comments,
    review_date: reviewDate,
  };
  if (scoreRaw !== '') body.score = Number(scoreRaw);

  prBusy = true;
  var btn = document.getElementById('pr-btn');
  btn.disabled = true; btn.textContent = 'กำลังส่ง…';
  prMsg('กำลังบันทึก…');

  try {
    var res = await sb.functions.invoke(PR_FN, { body: body });
    var data = res && res.data, error = res && res.error;
    prBusy = false;
    btn.disabled = false; btn.textContent = 'บันทึกผลรีวิว';
    if (error || (data && data.error)) {
      prMsg('ไม่สำเร็จ: ' + ((data && data.error) || (error && error.message) || ''), 'err');
      return;
    }
    // สำเร็จ — เคลียร์ฟอร์ม + reset ผล + reload + set ct
    document.getElementById('pr-emp').value = '';
    document.getElementById('pr-score').value = '';
    document.getElementById('pr-comments').value = '';
    document.getElementById('pr-date').value = '';
    prResult = '';
    var btns = document.getElementById('pr-deci').getElementsByTagName('button');
    for (var i = 0; i < btns.length; i++) btns[i].className = '';
    prMsg('บันทึกผลรีวิวเรียบร้อย ✓', 'ok');
    prLoad();
  } catch (e) {
    prBusy = false;
    btn.disabled = false; btn.textContent = 'บันทึกผลรีวิว';
    prMsg('ไม่สำเร็จ: ' + (e && e.message), 'err');
  }
}
