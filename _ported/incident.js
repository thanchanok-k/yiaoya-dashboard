// ===== หน้ารายงานเหตุการณ์ — ลอก incident_report.html เดิมเป๊ะ (scoped #ic) =====
// ใช้ global เดิม: sb (supabase client), esc (html escape), $ (getElementById)
// ห้าม redeclare sb / esc · var/fn ทุกตัว prefix ic
// แทน ?uid= / line_uid เดิมด้วยฟิลด์ "ผู้รายงาน" มาจาก login อยู่แล้ว → ใช้ branch_id field แทน context
//
// category 6 ค่า: injury / near_miss / equipment_damage / security / patient_safety / other
// severity 4 ค่า: minor / moderate / severe / critical
// create: sb.functions.invoke('hr_incident',{body:{branch_id,category,severity,detail,
//          incident_date,incident_time,incident_location,immediate_action,medical_attention}})
// list:   sb.functions.invoke('hr_incident') -> {items:[...]}

var IC_TYPES = [
  { key: 'injury',           label: 'บาดเจ็บ' },
  { key: 'near_miss',        label: 'เกือบเกิดเหตุ' },
  { key: 'equipment_damage', label: 'อุปกรณ์เสียหาย' },
  { key: 'security',         label: 'ความปลอดภัย' },
  { key: 'patient_safety',   label: 'ความปลอดภัยผู้ป่วย' },
  { key: 'other',            label: 'อื่น ๆ' }
];
var IC_SEVS = [
  { key: 'minor',    label: 'เล็กน้อย', sub: 'ไม่ต้องรักษา' },
  { key: 'moderate', label: 'ปานกลาง',  sub: 'ปฐมพยาบาล' },
  { key: 'severe',   label: 'รุนแรง',   sub: 'ต้องพบแพทย์' },
  { key: 'critical', label: 'วิกฤต',    sub: 'ฉุกเฉิน/หยุดงาน' }
];

var _icState = {
  branch_id: 'BR00',
  category: '',
  severity: '',
  detail: '',
  incident_location: '',
  incident_date: new Date().toISOString().slice(0, 10),
  incident_time: '',
  immediate_action: '',
  medical_attention: false
};

function mountIncident() {
  if (!document.getElementById('wrap-incident')) return;
  document.getElementById('wrap-incident').innerHTML = `
 <style>
 #ic{--icnavy:#0D2F4F;--icteal:#3DC5B7;--icerr:#DC2626;--icwarn:#F59E0B;--iccrit:#991B1B;--icmuted:#6B7280;--icborder:#E5E7EB;--icbg:#F8F9FA;max-width:680px;margin:0 auto;color:var(--icnavy)}
 #ic .ic-head{position:relative;background:#DC2626;color:#fff;padding:16px;border-radius:12px;overflow:hidden}
 #ic .ic-head::after{content:"";position:absolute;top:-30px;right:-25px;width:90px;height:90px;border-radius:50%;background:#fff;opacity:.18}
 #ic .ic-head>*{position:relative;z-index:1}
 #ic .ic-eb{font-size:12px;color:rgba(255,255,255,.85);font-weight:600}
 #ic .ic-h1{font-size:18px;font-weight:600;margin:4px 0 0}
 #ic .ic-meta{font-size:11px;color:rgba(255,255,255,.85);margin-top:4px}
 #ic .ic-warn{background:#FEF3C7;border-left:3px solid var(--icwarn);border-radius:7px;padding:10px 12px;margin:14px 0 10px;font-size:11px;color:#92400E;line-height:1.5}
 #ic .ic-warn b{color:#92400E;font-weight:600}
 #ic .ic-card{background:#fff;border:1px solid var(--icborder);border-radius:11px;padding:13px;margin-bottom:10px}
 #ic .ic-t{font-size:12px;font-weight:600;margin-bottom:8px;letter-spacing:.3px;display:flex;gap:8px;align-items:center}
 #ic .ic-n{background:#DC2626;color:#fff;font-size:10px;padding:2px 7px;border-radius:99px}
 #ic .ic-req::after{content:"*";color:var(--icerr);margin-left:3px}
 #ic label{display:block}
 #ic .ic-lab{font-size:10px;color:var(--icmuted)}
 #ic .ic-i{width:100%;padding:9px 11px;border:1px solid var(--icborder);border-radius:7px;font-size:13px;font-family:inherit;background:#fff}
 #ic .ic-i:focus{outline:none;border-color:var(--icteal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}
 #ic textarea.ic-i{resize:vertical}
 #ic .ic-type-row{display:grid;grid-template-columns:1fr 1fr;gap:7px}
 #ic .ic-type-c{padding:11px;border:1px solid var(--icborder);border-radius:9px;background:#fff;cursor:pointer;text-align:center;font-size:12px}
 #ic .ic-type-c:hover{background:#E6F7F5}
 #ic .ic-type-c.act{background:var(--icteal);color:#fff;border-color:var(--icteal);font-weight:500}
 #ic .ic-sev-row{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
 #ic .ic-sev-c{padding:9px 4px;border:1px solid var(--icborder);border-radius:7px;background:#fff;cursor:pointer;text-align:center;font-size:11px;font-weight:500}
 #ic .ic-sev-c .ic-sev-l{font-size:9px;color:var(--icmuted);margin-top:2px}
 #ic .ic-sev-c.act.minor{background:#3DC5B7;color:#fff;border-color:#3DC5B7}
 #ic .ic-sev-c.act.moderate{background:var(--icwarn);color:#fff;border-color:var(--icwarn)}
 #ic .ic-sev-c.act.severe{background:var(--icerr);color:#fff;border-color:var(--icerr)}
 #ic .ic-sev-c.act.critical{background:var(--iccrit);color:#fff;border-color:var(--iccrit)}
 #ic .ic-sev-c.act .ic-sev-l{color:rgba(255,255,255,.85)}
 #ic .ic-toggle{display:flex;align-items:center;gap:8px;padding:9px 11px;background:var(--icbg);border-radius:7px;font-size:12px;cursor:pointer}
 #ic .ic-toggle input{width:auto}
 #ic .ic-cta{margin-bottom:14px}
 #ic .ic-cta button{width:100%;padding:12px;border:0;border-radius:9px;background:var(--icerr);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 0 0 3px rgba(220,38,38,.2)}
 #ic .ic-cta button:disabled{background:#9CA3AF;cursor:not-allowed;box-shadow:none}
 #ic .ic-cta-h{font-size:10px;color:var(--icmuted);text-align:center;margin-top:5px}
 #ic .ic-row{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:.5px solid var(--icborder)}
 #ic .ic-row:last-child{border-bottom:0}
 #ic .ic-pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:10px;background:#F1F5F9;color:#475569;text-transform:capitalize}
 #ic .ic-pill.minor{background:#E6F7F5;color:#0F766E}
 #ic .ic-pill.moderate{background:#FEF3C7;color:#92400E}
 #ic .ic-pill.severe{background:#FEE2E2;color:#B91C1C}
 #ic .ic-pill.critical{background:#FCE7E7;color:#991B1B}
 #ic .ic-empty{color:var(--icmuted);font-size:13px;text-align:center;padding:14px}
 </style>
 <div id="ic">
  <div class="ic-head">
   <div class="ic-eb">INCIDENT · แจ้งเหตุการณ์</div>
   <div class="ic-h1">รายงานเหตุการณ์</div>
   <div class="ic-meta">ผู้รายงานมาจากบัญชีที่ล็อกอิน · severe/critical จะ alert ทันที</div>
  </div>

  <div class="ic-warn"><b>ข้อมูลสำคัญ:</b> เหตุการณ์ severe หรือ critical จะส่ง alert ทันทีให้ HR + Branch Manager · critical → Owner ด้วย</div>

  <div class="ic-card">
   <div class="ic-t"><span class="ic-n">1</span><span class="ic-req">ประเภทเหตุการณ์</span></div>
   <div class="ic-type-row" id="ic-types">${IC_TYPES.map(t => `<div class="ic-type-c ${_icState.category === t.key ? 'act' : ''}" data-k="${esc(t.key)}">${esc(t.label)}</div>`).join('')}</div>
  </div>

  <div class="ic-card">
   <div class="ic-t"><span class="ic-n">2</span><span class="ic-req">ระดับความรุนแรง</span></div>
   <div class="ic-sev-row" id="ic-sevs">${IC_SEVS.map(s => `<div class="ic-sev-c ${s.key} ${_icState.severity === s.key ? 'act' : ''}" data-k="${esc(s.key)}">${esc(s.label)}<div class="ic-sev-l">${esc(s.sub)}</div></div>`).join('')}</div>
  </div>

  <div class="ic-card">
   <div class="ic-t"><span class="ic-n">3</span><span class="ic-req">สาขา · วันที่ · สถานที่</span></div>
   <label class="ic-lab">สาขา</label>
   <select class="ic-i" id="ic-branch"><option value="BR00">BR00</option><option value="BR01">BR01</option></select>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:7px 0">
    <div><label class="ic-lab">วันที่เหตุการณ์</label><input type="date" class="ic-i" id="ic-date" value="${esc(_icState.incident_date)}"></div>
    <div><label class="ic-lab">เวลา</label><input type="time" class="ic-i" id="ic-time"></div>
   </div>
   <label class="ic-lab">สถานที่</label>
   <input class="ic-i" id="ic-loc" placeholder="เช่น · ห้องทรีตเมนต์ 2 / โถงหน้าร้าน / Lab">
  </div>

  <div class="ic-card">
   <div class="ic-t"><span class="ic-n">4</span><span class="ic-req">รายละเอียดเหตุการณ์</span></div>
   <textarea class="ic-i" id="ic-detail" rows="3" placeholder="อะไรเกิดขึ้น · ใครเกี่ยวข้อง · เกิดขึ้นยังไง"></textarea>
  </div>

  <div class="ic-card">
   <div class="ic-t"><span class="ic-n">5</span><span>การแก้ไขทันที</span></div>
   <textarea class="ic-i" id="ic-action" rows="2" placeholder="สิ่งที่ทำทันทีเพื่อจัดการ · first aid / โทร 1669 / แจ้ง manager"></textarea>
  </div>

  <div class="ic-card">
   <div class="ic-t"><span class="ic-n">6</span><span>การรักษาพยาบาล</span></div>
   <label class="ic-toggle"><input type="checkbox" id="ic-med"><span>มีการรักษาพยาบาล (กท.16 / SSO)</span></label>
  </div>

  <div class="ic-cta">
   <button id="ic-btn" disabled>แจ้งเหตุการณ์</button>
   <div class="ic-cta-h" id="ic-ctah">กรอกข้อมูลครบก่อนส่ง</div>
  </div>

  <div class="ic-card"><div class="ic-t"><span class="ic-n">·</span><span>เหตุการณ์ล่าสุด</span></div><div id="ic-hist"><div class="ic-empty">กำลังโหลด...</div></div></div>
 </div>`;

  // type / severity pickers
  document.getElementById('ic-types').onclick = function (e) {
    var c = e.target.closest('.ic-type-c'); if (!c) return;
    icSetType(c.dataset.k);
  };
  document.getElementById('ic-sevs').onclick = function (e) {
    var c = e.target.closest('.ic-sev-c'); if (!c) return;
    icSetSev(c.dataset.k);
  };
  // field bindings
  document.getElementById('ic-branch').value = _icState.branch_id;
  document.getElementById('ic-branch').oninput = function () { _icState.branch_id = this.value; };
  document.getElementById('ic-date').oninput = function () { _icState.incident_date = this.value; };
  document.getElementById('ic-time').oninput = function () { _icState.incident_time = this.value; };
  document.getElementById('ic-loc').oninput = function () { _icState.incident_location = this.value; icUpdateCta(); };
  document.getElementById('ic-detail').oninput = function () { _icState.detail = this.value; icUpdateCta(); };
  document.getElementById('ic-action').oninput = function () { _icState.immediate_action = this.value; };
  document.getElementById('ic-med').onchange = function () { _icState.medical_attention = this.checked; };
  document.getElementById('ic-btn').onclick = icSubmit;

  icUpdateCta();
  icLoad();
}

function icSetType(k) {
  _icState.category = k;
  var nodes = document.querySelectorAll('#ic-types .ic-type-c');
  for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('act', nodes[i].dataset.k === k);
  icUpdateCta();
}

function icSetSev(k) {
  _icState.severity = k;
  var nodes = document.querySelectorAll('#ic-sevs .ic-sev-c');
  for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('act', nodes[i].dataset.k === k);
  icUpdateCta();
}

function icUpdateCta() {
  var btn = document.getElementById('ic-btn'), h = document.getElementById('ic-ctah');
  if (!btn) return;
  var ok = _icState.category && _icState.severity && _icState.detail.trim() && _icState.incident_location.trim();
  btn.disabled = !ok;
  h.textContent = ok ? 'พร้อมส่ง · จะ noti HR + manager ทันที' : 'กรอกข้อมูลครบก่อนส่ง';
}

async function icLoad() {
  try {
    var res = await sb.functions.invoke('hr_incident');
    var items = (res && res.data && res.data.items) || [];
    var hist = document.getElementById('ic-hist');
    if (!hist) return;
    hist.innerHTML = items.length ? items.map(function (x) {
      var sev = x.severity || '';
      return '<div class="ic-row"><div><div>' + esc(icTypeLabel(x.category)) + '</div>'
        + '<div style="font-size:11px;color:#6B7280">' + esc(x.incident_date || '') + (x.incident_location ? ' · ' + esc(x.incident_location) : '') + '</div></div>'
        + '<div style="text-align:right"><div style="font-size:11px;color:#6B7280">' + esc(x.status || '') + '</div>'
        + '<span class="ic-pill ' + esc(sev) + '">' + esc(sev) + '</span></div></div>';
    }).join('') : '<div class="ic-empty">ยังไม่มีเหตุการณ์</div>';
    var ct = document.getElementById('ct-incident'); if (ct) ct.textContent = items.length || '';
  } catch (e) { console.error('incident load', e); }
}

function icTypeLabel(k) {
  for (var i = 0; i < IC_TYPES.length; i++) if (IC_TYPES[i].key === k) return IC_TYPES[i].label;
  return k || '';
}

async function icSubmit() {
  var btn = document.getElementById('ic-btn'), h = document.getElementById('ic-ctah');
  if (btn.disabled) return;
  btn.disabled = true; h.textContent = 'กำลังส่ง...';
  var body = {
    branch_id: _icState.branch_id,
    category: _icState.category,
    severity: _icState.severity,
    detail: _icState.detail,
    incident_date: _icState.incident_date,
    incident_time: _icState.incident_time,
    incident_location: _icState.incident_location,
    immediate_action: _icState.immediate_action,
    medical_attention: _icState.medical_attention
  };
  var resp = await sb.functions.invoke('hr_incident', { body: body });
  var data = resp && resp.data, error = resp && resp.error;
  if (error || (data && data.error)) {
    btn.disabled = false;
    h.textContent = 'ส่งล้มเหลว · ' + ((data && data.error) || (error && error.message) || '');
    return;
  }
  // เคลียร์ฟอร์ม + reset state
  _icState.category = '';
  _icState.severity = '';
  _icState.detail = '';
  _icState.incident_location = '';
  _icState.incident_time = '';
  _icState.immediate_action = '';
  _icState.medical_attention = false;
  // reload หน้า (mount ใหม่) + อัปเดต count
  mountIncident();
}
