// _ported/otreq.js · v1.10.176 port → native dashboard page "คำขอ OT"
// ลอกจาก HR Announcement/AppsScript/ot_request_liff.html มาเป็น native
// - scoped CSS prefix #ot · element id prefix ot- · var/fn prefix ot
// - ใช้ global sb + esc (ห้าม redeclare) · invoke แทน google.script.run
// - แทน ?uid= ด้วย input "รหัสพนักงาน" #ot-emp
// create: sb.functions.invoke('hr_ot_request',{body:{...}})
// list:   sb.functions.invoke('hr_ot_request') → {items:[...]}

// ── helper local (ไม่พึ่ง $ global) ──
const otQ = id => document.getElementById(id);

// ── ชุดเหตุผลคลินิก (กดเลือก) · "อื่นๆ" ต้องพิมพ์รายละเอียด ──
const OT_REASONS = [
  'เคลียร์เอกสาร/เวชระเบียนค้าง',
  'รับผู้ป่วยเพิ่ม/คิวยาว',
  'ช่วยงานสาขาอื่น',
  'เตรียมงานอบรม/ประชุม',
  'ปิดยอด/เช็คสต็อก',
  'อื่นๆ',
];

function otTodayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

const _otState = {
  ot_date:    otTodayStr(),
  start:      '',
  end:        '',
  minutes:    '',
  minsAuto:   true,    // คำนวณนาทีอัตโนมัติจากเริ่ม/สิ้นสุด จนกว่าผู้ใช้แก้เอง
  reasonChip: '',
  reasonText: '',
  submitting: false,
};

function mountOtreq() {
  if (!otQ('wrap-otreq')) return;
  otQ('wrap-otreq').innerHTML = `
  <style>
  #ot{--otnavy:#0D2F4F;--otteal:#3DC5B7;--ottealdk:#0F766E;--otline:#E5E7EB;--otmuted:#6B7280;--otfaint:#9CA3AF;--ottext:#1F2937;max-width:480px;margin:0 auto}
  #ot .ot-head{position:relative;background:linear-gradient(135deg,var(--otnavy),var(--ottealdk));color:#fff;padding:16px;border-radius:12px;overflow:hidden}
  #ot .ot-blob{position:absolute;width:120px;height:120px;border-radius:50%;background:#ffffff14;top:-44px;right:-36px}
  #ot .ot-eb{font-size:12px;color:var(--otteal);font-weight:600;position:relative;letter-spacing:.05em}
  #ot .ot-h1{font-size:18px;font-weight:600;margin:6px 0 0;position:relative}
  #ot .ot-sub{font-size:12.5px;color:#FFFFFFCC;margin-top:5px;position:relative;line-height:1.45}
  #ot .ot-card{background:#fff;border-radius:12px;border:.5px solid rgba(0,0,0,.1);margin:14px 0;padding:16px}
  #ot .ot-sectitle{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;color:var(--otnavy);margin:0 0 11px}
  #ot .ot-secnum{width:22px;height:22px;flex-shrink:0;border-radius:50%;background:var(--otteal);color:#04342C;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
  #ot .ot-secfaint{font-size:12px;color:var(--otfaint);font-weight:400}
  #ot label{display:block;font-size:12px;color:var(--otmuted);margin:0 0 4px}
  #ot input,#ot textarea{width:100%;padding:10px 12px;border:1px solid #CBD5E1;border-radius:8px;font-size:14px;background:#fff;font-family:inherit;color:var(--ottext)}
  #ot textarea{min-height:60px;resize:vertical}
  #ot .ot-hint{font-size:12px;color:var(--otfaint);margin-top:7px}
  #ot .ot-hint b{color:var(--ottealdk);font-weight:600}
  #ot .ot-timerow{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:end}
  #ot .ot-to{padding-bottom:11px;font-size:13px;color:var(--otfaint)}
  #ot .ot-mins{display:flex;align-items:center;gap:10px}
  #ot .ot-mins input{max-width:130px;text-align:center;font-weight:600;font-size:18px}
  #ot .ot-mins-unit{font-size:14px;color:var(--otmuted)}
  #ot .ot-chiprow{display:flex;flex-wrap:wrap;gap:8px}
  #ot .ot-chip{font-size:13px;padding:7px 13px;border-radius:999px;border:1px solid var(--otline);background:#fff;color:var(--ottext);cursor:pointer;user-select:none}
  #ot .ot-chip.selected{background:#E6F7F5;border-color:var(--otteal);color:var(--ottealdk);font-weight:600}
  #ot .ot-reason-text{margin-top:10px}
  #ot .ot-cta button{width:100%;padding:13px;border:0;border-radius:10px;background:var(--otteal);color:#04342C;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;margin:4px 0 6px}
  #ot .ot-cta button:disabled{opacity:.5;cursor:not-allowed}
  #ot .ot-ctah{font-size:13px;color:var(--otfaint);text-align:center;margin-bottom:10px}
  #ot .ot-row{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:.5px solid var(--otline)}
  #ot .ot-row:last-child{border-bottom:0}
  #ot .ot-pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:10px;background:#FAEEDA;color:#854F0B}
  #ot .ot-pill.ap{background:#E6F7F5;color:#0F766E}#ot .ot-pill.rj{background:#FCEBEB;color:#791F1F}
  #ot .ot-empty{color:var(--otmuted);font-size:13px;text-align:center;padding:14px}
  #ot .ot-ok{text-align:center;padding:30px 16px}
  #ot .ot-ok-icon{width:56px;height:56px;border-radius:50%;background:#16A34A;color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
  #ot .ot-ok-title{font-size:16px;font-weight:600;color:var(--ottext)}
  #ot .ot-ok-sub{font-size:13px;color:var(--otmuted);margin-top:7px}
  </style>
  <div id="ot">
   <div class="ot-head"><div class="ot-blob"></div>
    <div class="ot-eb">OT REQUEST · คำขอทำงานล่วงเวลา</div>
    <div class="ot-h1">ขอ OT / ดูประวัติ</div>
    <div class="ot-sub">คำขอจะส่งให้หัวหน้าอนุมัติ · ระบบบันทึกเวลา ไม่คำนวณค่าตอบแทน</div>
   </div>

   <div class="ot-card" id="ot-form">
    <label>รหัสพนักงาน *</label>
    <input id="ot-emp" placeholder="YY-XNU-013">

    <div class="ot-sectitle" style="margin-top:16px"><span class="ot-secnum">1</span>วันที่ทำ OT</div>
    <input id="ot-date" type="date" max="${otTodayStr()}" value="${esc(_otState.ot_date)}">
    <div class="ot-hint">ขอย้อนหลังได้ไม่เกินที่ HR กำหนด (ปกติ 7 วัน)</div>

    <div class="ot-sectitle" style="margin-top:16px"><span class="ot-secnum">2</span>ช่วงเวลา</div>
    <div class="ot-timerow">
     <div><label>เริ่ม</label><input id="ot-start" type="time" value="${esc(_otState.start)}"></div>
     <div class="ot-to">ถึง</div>
     <div><label>สิ้นสุด</label><input id="ot-end" type="time" value="${esc(_otState.end)}"></div>
    </div>

    <div class="ot-sectitle" style="margin-top:16px"><span class="ot-secnum">3</span>จำนวนเวลา</div>
    <div class="ot-mins">
     <input id="ot-mins" type="number" min="0" max="1440" step="5" inputmode="numeric" value="${esc(_otState.minutes)}">
     <span class="ot-mins-unit">นาที</span>
    </div>
    <div class="ot-hint" id="ot-mins-hint">คำนวณอัตโนมัติจากเวลาเริ่ม–สิ้นสุด · แก้เองได้</div>

    <div class="ot-sectitle" style="margin-top:16px"><span class="ot-secnum">4</span>เหตุผล</div>
    <div class="ot-chiprow" id="ot-reason-chips">
     ${OT_REASONS.map(r => '<span class="ot-chip" data-r="' + esc(r) + '">' + esc(r) + '</span>').join('')}
    </div>
    <textarea id="ot-reason" class="ot-reason-text" maxlength="300" placeholder="รายละเอียดเพิ่มเติม (ถ้ามี) · เช่น เคลียร์เวชระเบียนผู้ป่วยค้าง 12 ราย"></textarea>
    <div class="ot-hint">กดเลือกหัวข้อ แล้วพิมพ์เพิ่มได้ · ระบุชัดช่วยให้อนุมัติเร็ว</div>
   </div>

   <div class="ot-cta"><button id="ot-btn" disabled><span id="ot-btn-text">ส่งคำขอ OT</span></button></div>
   <div class="ot-ctah" id="ot-ctah">ยังขาด: รหัสพนักงาน · วันที่ · จำนวนเวลา · เหตุผล</div>

   <div class="ot-card"><div class="ot-sectitle"><span class="ot-secnum" style="background:var(--otnavy);color:#fff">≡</span>ประวัติคำขอ OT</div><div id="ot-hist"><div class="ot-empty">กำลังโหลด...</div></div></div>
  </div>`;

  // ── bind events ──
  otQ('ot-date').oninput  = e => { _otState.ot_date = e.target.value; otUpdateCta(); };
  otQ('ot-start').oninput = e => { _otState.start = e.target.value; otRecomputeMins(); otUpdateCta(); };
  otQ('ot-end').oninput   = e => { _otState.end = e.target.value; otRecomputeMins(); otUpdateCta(); };
  otQ('ot-mins').oninput  = e => otSetMins(e.target.value);
  otQ('ot-reason').oninput = e => { _otState.reasonText = e.target.value; otUpdateCta(); };
  otQ('ot-emp').oninput   = () => otUpdateCta();
  otQ('ot-reason-chips').addEventListener('click', e => {
    const chip = e.target.closest('.ot-chip');
    if (chip) otPickReason(chip.dataset.r);
  });
  otQ('ot-btn').onclick = otSubmit;

  otLoad();
}

function otSetMins(v) {
  _otState.minutes = v;
  _otState.minsAuto = false;
  const h = otQ('ot-mins-hint');
  if (h) h.innerHTML = otMinsBreakdown(v) + ' · แก้ค่าเอง';
  otUpdateCta();
}

function otMinsBreakdown(mins) {
  const m = Number(mins);
  if (!m || m <= 0) return 'คำนวณอัตโนมัติจากเวลาเริ่ม–สิ้นสุด · แก้เองได้';
  const h = Math.floor(m / 60), r = m % 60;
  let s = '≈ ';
  if (h > 0) s += '<b>' + h + ' ชม.</b>';
  if (r > 0) s += (h > 0 ? ' ' : '') + '<b>' + r + ' นาที</b>';
  return s;
}

function otRecomputeMins() {
  if (!_otState.minsAuto) return;            // ผู้ใช้คุมเอง
  if (!_otState.start || !_otState.end) return;
  const [sh, sm] = _otState.start.split(':').map(Number);
  const [eh, em] = _otState.end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;             // ข้ามเที่ยงคืน
  _otState.minutes = mins ? String(mins) : '';
  const fM = otQ('ot-mins');
  if (fM) fM.value = _otState.minutes;
  const h = otQ('ot-mins-hint');
  if (h) h.innerHTML = otMinsBreakdown(_otState.minutes);
}

function otPickReason(r) {
  _otState.reasonChip = (_otState.reasonChip === r) ? '' : r;
  document.querySelectorAll('#ot-reason-chips .ot-chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.r === _otState.reasonChip);
  });
  otUpdateCta();
}

function otReasonValid() {
  if (_otState.reasonChip && _otState.reasonChip !== 'อื่นๆ') return true;
  return _otState.reasonText.trim().length > 0;   // "อื่นๆ" หรือไม่เลือก chip → ต้องมีข้อความ
}

function otFinalReason() {
  const parts = [];
  if (_otState.reasonChip && _otState.reasonChip !== 'อื่นๆ') parts.push(_otState.reasonChip);
  if (_otState.reasonText.trim()) parts.push(_otState.reasonText.trim());
  return parts.join(' — ');
}

function otCanSubmit() {
  const emp = (otQ('ot-emp') ? otQ('ot-emp').value.trim() : '');
  const mins = Number(_otState.minutes);
  return !_otState.submitting && !!emp && !!_otState.ot_date && mins > 0 && mins <= 1440 && otReasonValid();
}

function otUpdateCta() {
  const btn = otQ('ot-btn');
  const hint = otQ('ot-ctah');
  if (!btn) return;
  const ok = otCanSubmit();
  btn.disabled = !ok;
  if (_otState.submitting) { if (hint) hint.textContent = 'กำลังส่ง...'; return; }
  if (ok) { if (hint) hint.textContent = 'พร้อมส่งให้หัวหน้าอนุมัติ'; return; }
  const miss = [];
  const emp = (otQ('ot-emp') ? otQ('ot-emp').value.trim() : '');
  if (!emp) miss.push('รหัสพนักงาน');
  if (!_otState.ot_date) miss.push('วันที่');
  if (!(Number(_otState.minutes) > 0)) miss.push('จำนวนเวลา');
  if (!otReasonValid()) miss.push('เหตุผล');
  if (hint) hint.textContent = 'ยังขาด: ' + miss.join(' · ');
}

async function otLoad() {
  try {
    const { data } = await sb.functions.invoke('hr_ot_request');
    const items = (data && data.items) || [];
    otQ('ot-hist').innerHTML = items.length ? items.map(x => {
      const s = String(x.status || '').toLowerCase();
      const cls = s === 'approved' ? 'ap' : (s === 'rejected' ? 'rj' : '');
      const when = esc(x.ot_date || '') + (x.expected_start ? ' · ' + esc(x.expected_start) + '–' + esc(x.expected_end || '') : '');
      const hrs = (x.expected_hours != null) ? (x.expected_hours + ' ชม.') : ((x.expected_minutes != null) ? (x.expected_minutes + ' นาที') : '');
      return '<div class="ot-row"><div><div>' + when + '</div><div style="font-size:11px;color:#6B7280">' +
        esc(x.reason || '') + '</div></div><div style="text-align:right"><div style="font-weight:600;color:#0D2F4F">' +
        esc(hrs) + '</div><span class="ot-pill ' + cls + '">' + esc(x.status || '') + '</span></div></div>';
    }).join('') : '<div class="ot-empty">ยังไม่มีคำขอ OT</div>';
    const ct = otQ('ct-otreq'); if (ct) ct.textContent = items.length || '';
  } catch (e) { console.error('ot load', e); }
}

async function otSubmit() {
  if (!otCanSubmit()) return;
  const emp = otQ('ot-emp').value.trim();
  _otState.submitting = true;
  otUpdateCta();
  const btn = otQ('ot-btn'), bt = otQ('ot-btn-text');
  if (btn) btn.disabled = true;
  if (bt) bt.textContent = 'กำลังส่ง...';

  const body = {
    employee_id:      emp,
    ot_date:          _otState.ot_date,
    expected_start:   _otState.start,
    expected_end:     _otState.end,
    expected_minutes: Number(_otState.minutes),
    reason:           otFinalReason(),
  };

  try {
    const { data, error } = await sb.functions.invoke('hr_ot_request', { body });
    _otState.submitting = false;
    if (error || (data && data.error)) {
      if (bt) bt.textContent = 'ส่งคำขอ OT';
      otUpdateCta();
      alert('ส่งคำขอไม่สำเร็จ: ' + ((data && data.error) || (error && error.message) || ''));
      return;
    }
    otOnDone(data);
  } catch (e) {
    _otState.submitting = false;
    if (bt) bt.textContent = 'ส่งคำขอ OT';
    otUpdateCta();
    alert('ส่งคำขอไม่สำเร็จ: ' + (e.message || ''));
  }
}

function otOnDone(res) {
  // เคลียร์ฟอร์ม
  _otState.ot_date = otTodayStr();
  _otState.start = ''; _otState.end = ''; _otState.minutes = '';
  _otState.minsAuto = true; _otState.reasonChip = ''; _otState.reasonText = '';
  _otState.submitting = false;

  const f = otQ('ot-form');
  const minsTh = (res && res.expected_minutes != null) ? (res.expected_minutes + ' นาที')
              : ((res && res.expected_hours != null) ? (res.expected_hours + ' ชม.') : '');
  const statusTh = (res && res.status === 'approved') ? 'อนุมัติอัตโนมัติแล้ว' : 'รออนุมัติจากหัวหน้า';
  if (f) {
    f.innerHTML =
      '<div class="ot-ok">' +
        '<div class="ot-ok-icon"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>' +
        '<div class="ot-ok-title">ส่งคำขอ OT แล้ว</div>' +
        '<div class="ot-ok-sub">' + esc(minsTh) + ' · ' + esc(statusTh) + '</div>' +
        ((res && res.request_id) ? '<div class="ot-ok-sub" style="margin-top:10px">เลขคำขอ: ' + esc(res.request_id) + '</div>' : '') +
        '<div class="ot-ok-sub" style="margin-top:14px"><a href="#" id="ot-again" style="color:#0F766E;font-weight:600">+ ขอ OT อีกรายการ</a></div>' +
      '</div>';
    const again = otQ('ot-again');
    if (again) again.onclick = ev => { ev.preventDefault(); mountOtreq(); };
  }

  otLoad();   // reload list + set ct-otreq
}
