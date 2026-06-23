// _ported/leavereq.js — native port of leave_request_form.html (HR Announcement)
// ลอก markup + CSS เดิม · scoped ใต้ #lv · ทุก element id prefix lv-
// ใช้ global sb + esc (มีอยู่แล้วใน index.html) — ห้าม redeclare
// edge fn: hr_leave_request · create=invoke(body) · list=invoke() คืน {items:[...]}

// 12 leave types (ตรงกับ edge fn)
const LV_TYPES = [
  { key: 'annual',          label: 'ลาพักร้อน' },
  { key: 'sick',            label: 'ลาป่วย' },
  { key: 'personal',        label: 'ลากิจ' },
  { key: 'maternity',       label: 'ลาคลอด' },
  { key: 'paternity',       label: 'ลาเลี้ยงดูบุตร' },
  { key: 'ordination',      label: 'ลาบวช' },
  { key: 'military',        label: 'ลาทหาร' },
  { key: 'emergency',       label: 'ลาฉุกเฉิน' },
  { key: 'special_holiday', label: 'ลาพิเศษ' },
  { key: 'birthday',        label: 'ลาวันเกิด' },
  { key: 'reward',          label: 'วันหยุดแถม' },
  { key: 'other',           label: 'อื่นๆ' },
];

// state เฉพาะหน้านี้ (prefix lv)
let _lvState = {
  leave_type: 'annual',
  submitting: false,
};

function mountLeavereq() {
  const wrap = document.getElementById('wrap-leavereq');
  if (!wrap) return;

  const typeChips = LV_TYPES.map(t =>
    '<span class="chip ' + (_lvState.leave_type === t.key ? 'act' : '') +
    '" data-lvtype="' + t.key + '">' + esc(t.label) + '</span>'
  ).join('');

  wrap.innerHTML = `
<style>
#lv{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--teal-dark:#0F766E;--bg:#FAFBFC;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--success:#16A34A;max-width:480px;margin:0 auto;font-size:15px;line-height:1.5;color:var(--navy)}
#lv .hint-box{background:var(--teal-light);border-left:3px solid var(--teal);border-radius:7px;padding:10px 12px;margin-bottom:12px;font-size:13px;color:var(--teal-dark);line-height:1.5}
#lv .section{background:#fff;border:1px solid var(--border);border-radius:10px;padding:13px;margin-bottom:10px}
#lv .section-h{display:flex;align-items:center;gap:9px;margin-bottom:10px}
#lv .section-num{width:22px;height:22px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0}
#lv .section-t{font-size:15px;font-weight:600;color:var(--navy)}
#lv .req::after{content:"*";color:var(--error);margin-left:3px}
#lv .field-l{display:block;font-size:13px;color:var(--muted);margin-bottom:5px}
#lv .field-i{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:15px;font-family:inherit;color:var(--navy);background:#fff;box-sizing:border-box}
#lv .field-i:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,0.15)}
#lv .ta{width:100%;min-height:72px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:15px;resize:vertical;color:var(--navy);background:#fff;box-sizing:border-box}
#lv .ta:focus{outline:none;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,0.15)}
#lv .row2{display:flex;gap:10px}
#lv .row2 > div{flex:1}
#lv .chip-row{display:flex;gap:7px;flex-wrap:wrap}
#lv .chip{padding:7px 13px;border-radius:16px;font-size:13px;background:#fff;border:1px solid var(--border);color:var(--muted);cursor:pointer;font-weight:500}
#lv .chip.act{background:var(--navy);color:#fff;border-color:var(--navy)}
#lv .half-row{display:flex;align-items:center;gap:10px;margin-top:10px;padding:10px 12px;background:var(--bg);border-radius:8px}
#lv .half-row input{width:18px;height:18px;accent-color:var(--teal);cursor:pointer;flex-shrink:0}
#lv .half-row label{font-size:13px;cursor:pointer;flex:1}
#lv .lv-cta{margin:14px 0}
#lv .lv-cta button{width:100%;padding:13px;border:0;border-radius:10px;background:var(--teal);color:#04342C;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:8px}
#lv .lv-cta button:disabled{background:#CBD5E1;color:#fff;cursor:not-allowed}
#lv .lv-cta svg{width:18px;height:18px}
#lv .lv-hint{font-size:13px;color:#9CA3AF;text-align:center;margin-top:6px}
#lv .ok-box{background:#DCFCE7;color:var(--success);border-radius:10px;margin:12px 0;padding:18px 14px;text-align:center;font-size:15px;line-height:1.5}
#lv .ok-box .ok-id{font-weight:600;font-size:14px;margin-top:8px;color:#15803D}
#lv .lv-list .lv-row{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:.5px solid var(--border)}
#lv .lv-list .lv-row:last-child{border-bottom:0}
#lv .lv-pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:10px;background:#FAEEDA;color:#854F0B}
#lv .lv-pill.ap{background:#E6F7F5;color:#0F766E}
#lv .lv-pill.rj{background:#FCEBEB;color:#791F1F}
#lv .lv-empty{color:var(--muted);font-size:13px;text-align:center;padding:14px}
</style>
<div id="lv">
  <div class="hint-box">ยื่นใบลา → ระบบส่งให้หัวหน้า/HR พิจารณาทุกใบ · ได้รับแจ้งผลกลับทาง LINE</div>

  <div class="section">
    <div class="section-h"><span class="section-num">1</span><span class="section-t req">ผู้ขอลา</span></div>
    <label class="field-l">รหัสพนักงาน</label>
    <input class="field-i" id="lv-emp" placeholder="YY-XNU-013">
  </div>

  <div class="section">
    <div class="section-h"><span class="section-num">2</span><span class="section-t req">ประเภทการลา</span></div>
    <div class="chip-row" id="lv-chips">${typeChips}</div>
  </div>

  <div class="section">
    <div class="section-h"><span class="section-num">3</span><span class="section-t req">ช่วงวันที่</span></div>
    <div class="row2">
      <div><label class="field-l">วันเริ่ม</label><input type="date" class="field-i" id="lv-start"></div>
      <div><label class="field-l">วันสิ้นสุด</label><input type="date" class="field-i" id="lv-end"></div>
    </div>
    <div class="half-row">
      <input type="checkbox" id="lv-half">
      <label for="lv-half">ลาครึ่งวัน (นับ 0.5 วัน · ใช้กับวันเดียว)</label>
    </div>
  </div>

  <div class="section">
    <div class="section-h"><span class="section-num">4</span><span class="section-t">เหตุผล</span></div>
    <textarea class="ta" id="lv-reason" maxlength="500" placeholder="เช่น พาผู้ปกครองไปหาหมอ"></textarea>
  </div>

  <div class="section">
    <div class="section-h"><span class="section-num">5</span><span class="section-t">ผู้รับมอบงานแทน</span></div>
    <input class="field-i" id="lv-replace" placeholder="รหัสผู้รับมอบงาน (ไม่บังคับ) · YY-...">
  </div>

  <div class="section">
    <div class="section-h"><span class="section-num">6</span><span class="section-t">แนบใบรับรองแพทย์ (ทางเลือก)</span></div>
    <label class="field-l">ลาป่วยตั้งแต่ 3 วัน รบกวนแนบลิงก์ไฟล์ใบรับรอง (ถ้ามี)</label>
    <input class="field-i" id="lv-attach" placeholder="วางลิงก์ไฟล์ (ไม่บังคับ)">
  </div>

  <div class="lv-cta">
    <button id="lv-btn" disabled>
      <span id="lv-btntext">ส่งใบลา</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" x2="19" y1="12" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
    </button>
    <div class="lv-hint" id="lv-cta-hint">เลือกประเภท + วันที่ ก่อนส่ง</div>
  </div>

  <div class="section">
    <div class="section-h"><span class="section-num">＋</span><span class="section-t">ประวัติการลา</span></div>
    <div class="lv-list" id="lv-hist"><div class="lv-empty">กำลังโหลด...</div></div>
  </div>
</div>`;

  // bind chips (ประเภทการลา)
  Array.prototype.forEach.call(wrap.querySelectorAll('[data-lvtype]'), el => {
    el.onclick = () => lvPickType(el.getAttribute('data-lvtype'));
  });
  // bind inputs → validate ปุ่ม
  ['lv-start', 'lv-end'].forEach(id => { const e = document.getElementById(id); if (e) e.onchange = lvOnChange; });
  ['lv-emp', 'lv-reason', 'lv-replace', 'lv-attach'].forEach(id => { const e = document.getElementById(id); if (e) e.oninput = lvOnChange; });
  const half = document.getElementById('lv-half'); if (half) half.onchange = lvOnChange;
  document.getElementById('lv-btn').onclick = lvSubmit;

  lvOnChange();
  lvLoad();
}

function lvPickType(key) {
  _lvState.leave_type = key;
  Array.prototype.forEach.call(document.querySelectorAll('#lv-chips [data-lvtype]'), el => {
    el.classList.toggle('act', el.getAttribute('data-lvtype') === key);
  });
  lvOnChange();
}

function lvOnChange() {
  const start = (document.getElementById('lv-start') || {}).value || '';
  const half = !!((document.getElementById('lv-half') || {}).checked);
  // ลาครึ่งวัน → ล็อกวันสิ้นสุด = วันเริ่ม
  const endEl = document.getElementById('lv-end');
  if (half && start && endEl) { endEl.value = start; endEl.disabled = true; }
  else if (endEl) { endEl.disabled = false; }
  const end = (document.getElementById('lv-end') || {}).value || '';
  const emp = ((document.getElementById('lv-emp') || {}).value || '').trim();

  const btn = document.getElementById('lv-btn');
  const hint = document.getElementById('lv-cta-hint');
  if (!btn || !hint) return;
  let ok = !!emp && !!_lvState.leave_type && !!start && !!end;
  let msg = 'กดเพื่อส่งใบลาให้หัวหน้า/HR';
  if (ok && end < start) { ok = false; msg = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'; }
  if (!ok && !(end && start && end < start)) msg = 'กรอกรหัสพนักงาน + ประเภท + วันเริ่ม + วันสิ้นสุด ก่อนส่ง';
  btn.disabled = !ok;
  hint.textContent = msg;
}

async function lvLoad() {
  try {
    const { data } = await sb.functions.invoke('hr_leave_request');
    const items = (data && data.items) || [];
    const host = document.getElementById('lv-hist');
    if (host) {
      host.innerHTML = items.length
        ? items.map(x => {
            const st = x.status || '';
            const cls = st === 'approved' ? 'ap' : st === 'rejected' ? 'rj' : '';
            return '<div class="lv-row"><div><div>' + esc(lvTypeLabel(x.leave_type)) + '</div>'
              + '<div style="font-size:11px;color:#6B7280">' + esc(x.start_date || '') + (x.end_date && x.end_date !== x.start_date ? ' → ' + esc(x.end_date) : '') + ' · ' + esc(String(x.days != null ? x.days : '')) + ' วัน</div></div>'
              + '<div style="text-align:right"><div style="font-size:11px;color:#6B7280">' + esc(x.request_id || '') + '</div>'
              + '<span class="lv-pill ' + cls + '">' + esc(st) + '</span></div></div>';
          }).join('')
        : '<div class="lv-empty">ยังไม่มีคำขอลา</div>';
    }
    const ct = document.getElementById('ct-leavereq');
    if (ct) ct.textContent = items.length || '';
  } catch (e) { console.error('lvLoad', e); }
}

function lvTypeLabel(key) {
  const t = LV_TYPES.find(t => t.key === key);
  return t ? t.label : (key || '');
}

async function lvSubmit() {
  if (_lvState.submitting) return;
  const btn = document.getElementById('lv-btn');
  if (!btn || btn.disabled) return;

  const emp = ((document.getElementById('lv-emp') || {}).value || '').trim();
  const start = (document.getElementById('lv-start') || {}).value || '';
  const end = (document.getElementById('lv-end') || {}).value || '';
  const half = !!((document.getElementById('lv-half') || {}).checked);
  if (!emp) { alert('กรอกรหัสพนักงาน'); return; }
  if (!start || !end) { alert('เลือกช่วงวันที่'); return; }
  if (end < start) { alert('วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'); return; }

  _lvState.submitting = true;
  btn.disabled = true;
  document.getElementById('lv-btntext').textContent = 'กำลังส่ง...';
  const hint = document.getElementById('lv-cta-hint');
  if (hint) hint.textContent = 'กำลังส่ง...';

  const body = {
    employee_id:             emp,
    leave_type:              _lvState.leave_type,
    start_date:              start,
    end_date:                end,
    days:                    half ? 0.5 : undefined,
    half_day:                half,
    reason:                  ((document.getElementById('lv-reason')  || {}).value || '').trim(),
    replacement_employee_id: ((document.getElementById('lv-replace') || {}).value || '').trim(),
    attachment_url:          ((document.getElementById('lv-attach')  || {}).value || '').trim(),
  };

  try {
    const { data, error } = await sb.functions.invoke('hr_leave_request', { body });
    _lvState.submitting = false;
    btn.disabled = false;
    document.getElementById('lv-btntext').textContent = 'ส่งใบลา';
    if (error || (data && data.error)) {
      const m = (data && (data.error || (data.errors && data.errors.join(', ')))) || (error && error.message) || 'ส่งไม่สำเร็จ';
      if (hint) hint.textContent = 'แก้ไขแล้วลองส่งอีกครั้ง';
      alert('ไม่สำเร็จ: ' + m);
      lvOnChange();
      return;
    }
    // สำเร็จ → แสดงผล + เคลียร์ฟอร์ม + โหลด list ใหม่
    const reqId = (data && (data.requestId || data.request_id)) || '';
    ['lv-start', 'lv-end', 'lv-reason', 'lv-replace', 'lv-attach'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    const halfEl = document.getElementById('lv-half'); if (halfEl) { halfEl.checked = false; }
    const endEl = document.getElementById('lv-end'); if (endEl) endEl.disabled = false;
    _lvState.leave_type = 'annual';
    Array.prototype.forEach.call(document.querySelectorAll('#lv-chips [data-lvtype]'), el => {
      el.classList.toggle('act', el.getAttribute('data-lvtype') === 'annual');
    });
    if (hint) hint.innerHTML = 'ส่งใบลาเรียบร้อย · รออนุมัติจากหัวหน้า/HR' + (reqId ? ' · ' + esc(reqId) : '');
    lvOnChange();
    lvLoad();
  } catch (e) {
    _lvState.submitting = false;
    btn.disabled = false;
    document.getElementById('lv-btntext').textContent = 'ส่งใบลา';
    if (hint) hint.textContent = 'ส่งไม่สำเร็จ · ลองอีกครั้งค่ะ';
    alert('ส่งไม่สำเร็จ: ' + (e && e.message || ''));
  }
}
