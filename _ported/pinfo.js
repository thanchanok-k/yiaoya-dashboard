// _ported/pinfo.js — native port ของ "ขอแก้ข้อมูลส่วนตัว"
// ลอกจาก HR Announcement/AppsScript/personal_info_request.html ให้ทำงานบน dashboard
// pattern เดียวกับ mountExpense ใน index.html
// globals ที่ใช้ (ห้าม redeclare): $  sb  esc
// scoped CSS prefix: #pi · element id prefix: pi-
// แทน ?uid= เดิม ด้วย input "รหัสพนักงาน" id pi-emp
//
// field map (7 ค่า):
//   address           ที่อยู่ปัจจุบัน        (sensitive: ไม่ · แนบเอกสาร: ไม่)
//   phone             เบอร์โทรศัพท์          (sensitive: ไม่ · แนบเอกสาร: ไม่)
//   marital_status    สถานภาพสมรส           (sensitive: ไม่ · แนบเอกสาร: ใช่)
//   dependent         ผู้อยู่ในอุปการะ       (sensitive: ไม่ · แนบเอกสาร: ไม่)
//   emergency_contact ผู้ติดต่อฉุกเฉิน       (sensitive: ไม่ · แนบเอกสาร: ไม่)
//   bank_account      บัญชีธนาคาร           (sensitive: ใช่ · แนบเอกสาร: ใช่)
//   other             อื่นๆ                 (sensitive: ไม่ · แนบเอกสาร: ไม่)

var PI_FIELDS = [
  { key: 'address',           label: 'ที่อยู่ปัจจุบัน',  sensitive: false, attach: false, ph: 'เช่น 99/1 หมู่ 2 ต.บางรัก กทม. 10500' },
  { key: 'phone',             label: 'เบอร์โทรศัพท์',    sensitive: false, attach: false, ph: '0812345678' },
  { key: 'marital_status',    label: 'สถานภาพสมรส',     sensitive: false, attach: true,  ph: 'เช่น สมรส / โสด / หย่า' },
  { key: 'dependent',         label: 'ผู้อยู่ในอุปการะ', sensitive: false, attach: false, ph: 'ชื่อ-สกุล · ความสัมพันธ์ · ปีเกิด' },
  { key: 'emergency_contact', label: 'ผู้ติดต่อฉุกเฉิน', sensitive: false, attach: false, ph: 'ชื่อ-สกุล · ความสัมพันธ์ · เบอร์โทร' },
  { key: 'bank_account',      label: 'บัญชีธนาคาร',     sensitive: true,  attach: true,  ph: 'ธนาคาร · เลขบัญชี · ชื่อบัญชี' },
  { key: 'other',             label: 'อื่นๆ',           sensitive: false, attach: false, ph: 'ระบุข้อมูลที่ต้องการแก้' }
];

function piSelectedField() {
  var v = $('pi-field') ? $('pi-field').value : '';
  for (var i = 0; i < PI_FIELDS.length; i++) if (PI_FIELDS[i].key === v) return PI_FIELDS[i];
  return PI_FIELDS[0];
}

function mountPinfo() {
  if (!$('wrap-pinfo')) return;
  $('wrap-pinfo').innerHTML = `
 <style>
 #pi{--pnavy:#0D2F4F;--pteal:#3DC5B7;--ptealdk:#0F766E;--ppurple:#7C3AED;--ppurpledk:#5B21B6;--pline:#E5E7EB;--pmuted:#6B7280;max-width:480px;margin:0 auto}
 #pi .phead{position:relative;background:linear-gradient(135deg,var(--pnavy),var(--ptealdk));color:#fff;padding:16px;border-radius:12px;overflow:hidden}
 #pi .pblob{position:absolute;width:120px;height:120px;border-radius:50%;background:#ffffff14;top:-44px;right:-36px}
 #pi .peb{font-size:12px;color:var(--pteal);font-weight:600;position:relative}
 #pi .ph1{font-size:18px;font-weight:600;margin:6px 0 0;position:relative}
 #pi .pcard{background:#fff;border-radius:12px;border:.5px solid rgba(0,0,0,.1);margin:14px 0;padding:16px}
 #pi .psec{font-size:13px;color:var(--pnavy);font-weight:600;margin:0 0 10px}
 #pi label{display:block;font-size:12px;color:var(--pmuted);margin:10px 0 4px}
 #pi select,#pi input,#pi textarea{width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:14px;background:#fff;font-family:inherit}
 #pi textarea{min-height:60px;resize:vertical}
 #pi .pinfo{background:#E6F7F5;border-left:3px solid var(--pteal);border-radius:8px;padding:10px;font-size:12px;color:var(--pnavy);line-height:1.5;margin-bottom:4px}
 #pi .psens{background:#EDE9FE;border-left:3px solid var(--ppurple);border-radius:8px;padding:10px;font-size:12px;color:var(--pnavy);line-height:1.5;margin-top:10px;display:none}
 #pi .pnote{background:#FEF3C7;border-radius:8px;padding:10px;font-size:12px;color:#854F0B;margin-top:10px}
 #pi .pattach{display:none}
 #pi .pattach.on{display:block}
 #pi .preq::after{content:" *";color:#DC2626}
 #pi .prow{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:.5px solid var(--pline)}
 #pi .prow:last-child{border-bottom:0}
 #pi .ppill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:10px;background:#FAEEDA;color:#854F0B}
 #pi .ppill.ap{background:#E6F7F5;color:#0F766E}#pi .ppill.rj{background:#FCEBEB;color:#791F1F}
 #pi .pcta button{width:100%;padding:13px;border:0;border-radius:10px;background:var(--pteal);color:#04342C;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;margin:4px 0 14px}
 #pi .pcta button.sens{background:var(--ppurple);color:#fff}
 #pi .pcta button:disabled{background:#9CA3AF;color:#fff;cursor:not-allowed}
 #pi .pdiff{font-size:12px;color:var(--pmuted);margin-top:5px;word-break:break-word}
 #pi .pempty{color:var(--pmuted);font-size:13px;text-align:center;padding:14px}
 </style>
 <div id="pi">
  <div class="phead"><div class="pblob"></div><div class="peb">PERSONAL · ขอแก้ข้อมูลส่วนตัว</div><div class="ph1">ยื่นคำขอ / ดูประวัติ</div></div>
  <div class="pcard">
   <div class="pinfo"><b>คำขอจะส่งให้ HR review ก่อน</b> · ข้อมูลใน Sheet พนักงานจะไม่ถูกแก้ทันที · ใช้เวลา 1-2 วันทำการ</div>
   <div class="psec" style="margin-top:14px">ยื่นคำขอใหม่</div>
   <label class="preq">รหัสพนักงาน</label><input id="pi-emp" placeholder="YY-XNU-013">
   <label class="preq">ต้องการเปลี่ยนข้อมูลอะไร</label>
   <select id="pi-field">${PI_FIELDS.map(f => '<option value="' + f.key + '">' + esc(f.label) + (f.sensitive ? ' · sensitive' : f.attach ? ' · ต้องแนบเอกสาร' : '') + '</option>').join('')}</select>
   <div class="psens" id="pi-sens"><b>ข้อมูล sensitive</b> · ตรวจสอบให้ละเอียดก่อนส่ง · ผิดพลาดอาจทำให้เงินเดือนเข้าผิดบัญชี · HR Manager เท่านั้นที่อนุมัติได้</div>
   <label class="preq">ค่าใหม่</label><textarea id="pi-newval" placeholder="กรอกข้อมูลใหม่"></textarea>
   <label>เหตุผล / หมายเหตุ</label><textarea id="pi-note" placeholder="ทำไมต้องเปลี่ยน · เช่น ย้ายที่อยู่, จดทะเบียนสมรส, เปลี่ยนธนาคาร"></textarea>
   <div class="pattach" id="pi-attach-wrap">
    <label class="preq">ลิงก์เอกสารแนบ</label>
    <input id="pi-attach" type="url" placeholder="https://drive.google.com/...">
    <div style="font-size:11px;color:var(--pmuted);margin-top:4px">URL Google Drive · เช่น สำเนาทะเบียนสมรส / หน้าสมุดบัญชี (ต้องเห็น เลขที่ + ชื่อบัญชี)</div>
   </div>
   <div class="pnote">คำขอ sensitive (บัญชีธนาคาร) ต้องผ่าน HR Manager · บางประเภทต้องแนบเอกสารยืนยัน</div>
  </div>
  <div class="pcta"><button id="pi-btn">ส่งคำขอ</button></div>
  <div class="pcard"><div class="psec">คำขอที่ผ่านมา</div><div id="pi-hist"><div class="pempty">กำลังโหลด...</div></div></div>
 </div>`;
  $('pi-field').onchange = piOnFieldChange;
  $('pi-btn').onclick = piSubmit;
  piOnFieldChange();
  piLoad();
}

function piOnFieldChange() {
  var sel = piSelectedField();
  var aw = $('pi-attach-wrap'); if (aw) aw.classList.toggle('on', !!sel.attach);
  var sw = $('pi-sens'); if (sw) sw.style.display = sel.sensitive ? 'block' : 'none';
  var btn = $('pi-btn'); if (btn) { btn.classList.toggle('sens', !!sel.sensitive); btn.textContent = sel.sensitive ? 'ส่งคำขอ (sensitive)' : 'ส่งคำขอ'; }
  var nv = $('pi-newval'); if (nv) nv.placeholder = sel.ph || 'กรอกข้อมูลใหม่';
}

async function piLoad() {
  try {
    const { data } = await sb.functions.invoke('hr_personal_info_request');
    const items = (data && data.items) || [];
    const labelOf = function (k) { for (var i = 0; i < PI_FIELDS.length; i++) if (PI_FIELDS[i].key === k) return PI_FIELDS[i].label; return k || ''; };
    $('pi-hist').innerHTML = items.length ? items.map(function (x) {
      var st = x.status || '';
      var pill = st === 'approved' ? 'ap' : st === 'rejected' ? 'rj' : '';
      return '<div class="prow"><div style="flex:1;min-width:0">'
        + '<div>' + esc(labelOf(x.field)) + '</div>'
        + '<div class="pdiff">' + (x.old_value ? esc(String(x.old_value)) + ' &rarr; ' : '') + '<b>' + esc(String(x.new_value || '')) + '</b></div>'
        + (x.note ? '<div style="font-size:11px;color:#6B7280;margin-top:3px">' + esc(String(x.note)) + '</div>' : '')
        + (x.reviewer_notes ? '<div style="font-size:11px;color:#6B7280;margin-top:3px">HR: ' + esc(String(x.reviewer_notes)) + '</div>' : '')
        + '</div><div style="text-align:right;margin-left:8px"><span class="ppill ' + pill + '">' + esc(st) + '</span></div></div>';
    }).join('') : '<div class="pempty">ยังไม่มีคำขอ</div>';
    const ct = $('ct-pinfo'); if (ct) ct.textContent = items.length || '';
  } catch (e) { console.error('pi', e); }
}

async function piSubmit() {
  var emp = $('pi-emp').value.trim();
  var sel = piSelectedField();
  var newval = $('pi-newval').value.trim();
  var note = $('pi-note').value.trim();
  var attach = $('pi-attach').value.trim();
  if (!emp) { alert('กรอกรหัสพนักงาน'); return; }
  if (!newval) { alert('กรอกค่าใหม่'); return; }
  if (sel.attach && !attach) { alert('ข้อมูลประเภทนี้ต้องแนบเอกสารยืนยัน'); return; }
  var btn = $('pi-btn'); var orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'กำลังส่ง...';
  const { data, error } = await sb.functions.invoke('hr_personal_info_request', {
    body: { employee_id: emp, field: sel.key, new_value: newval, note: note, attachment_url: attach }
  });
  btn.disabled = false; btn.textContent = orig;
  if (error || (data && data.error)) { alert('ไม่สำเร็จ: ' + ((data && data.error) || (error && error.message) || 'unknown')); return; }
  $('pi-newval').value = ''; $('pi-note').value = ''; $('pi-attach').value = '';
  piLoad();
}
