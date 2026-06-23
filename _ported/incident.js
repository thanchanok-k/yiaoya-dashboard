// _ported/incident.js — native port of desktop incident_manager.html (HR Announcement admin)
// ลอก markup + CSS เดิม (desktop incident_manager) · scoped ทั้งหมดใต้ #ic (กันชน CSS dashboard) · element id prefix ic-
// ใช้ global sb (supabase client) + esc (html escape) — ห้าม redeclare · var/fn ทุกตัว prefix ic
//
// backend (ตามกฎ):
//   list:   sb.functions.invoke('hr_incident')                                  -> {items:[...]}
//           payload: incident_id, branch_id, category, severity, detail,
//                    incident_date, status, reported_by (+ optional: branch_name,
//                    incident_location, incident_time, immediate_action,
//                    medical_attention, sso_claim_filed, root_cause, preventive_action)
//   action: sb.functions.invoke('hr_approve',{body:{request_id:incident_id,decision:'approved'}})
//           ใช้ decision='approved' = ปิดเคส (resolve/close) — backend ไม่มี admin-update endpoint
//
// โครงหน้า desktop ที่ลอกมา (incident_manager):
//   - top banner สีแดง "Incident Manager · INC"
//   - stats cards (4): รอจัดการ / Critical เปิดอยู่ / กท.16 ยังไม่ยื่น / ทั้งหมด  (client-side จาก items)
//   - tabs (6): รอจัดการ / กำลังจัดการ / Critical / กท.16 ค้าง / ปิดแล้ว / ทั้งหมด (filter client-side)
//   - data-table: ID / ประเภท+severity / ผู้แจ้ง / สาขา·สถานที่ / วันที่ / Status / กท.16 / Actions
//   - detail modal + ปุ่ม "ปิดเคส" (resolve → hr_approve approved) เฉพาะเคสที่ยังไม่ปิด

var IC_CATS = [
  { key: 'injury',           label: 'บาดเจ็บ' },
  { key: 'near_miss',        label: 'เกือบเกิดเหตุ' },
  { key: 'equipment_damage', label: 'อุปกรณ์เสียหาย' },
  { key: 'security',         label: 'security' },
  { key: 'patient_safety',   label: 'patient safety' },
  { key: 'other',            label: 'อื่น ๆ' }
];
var IC_SEVS = [
  { key: 'minor',    label: 'เล็กน้อย' },
  { key: 'moderate', label: 'ปานกลาง' },
  { key: 'severe',   label: 'รุนแรง' },
  { key: 'critical', label: 'วิกฤต' }
];

// state เฉพาะหน้านี้ (prefix ic)
var _icState = {
  tab: 'new',          // new | investigating | critical | sso | resolved | all
  items: [],           // raw items จาก backend
  acting: false        // กัน double-click ปิดเคส
};

function icCatLabel(k) {
  for (var i = 0; i < IC_CATS.length; i++) if (IC_CATS[i].key === k) return IC_CATS[i].label;
  return k || '';
}
function icSevLabel(k) {
  for (var i = 0; i < IC_SEVS.length; i++) if (IC_SEVS[i].key === k) return IC_SEVS[i].label;
  return k || '';
}
function icStatusLabel(s) {
  return ({ 'new': 'รอจัดการ', investigating: 'กำลังจัดการ', resolved: 'แก้แล้ว', closed: 'ปิด' })[s] || s || '';
}
// normalize: backend อาจส่ง category หรือ incident_type · detail หรือ description
function icCat(r)    { return r.category || r.incident_type || ''; }
function icDetail(r) { return r.detail != null ? r.detail : (r.description || ''); }
function icStatus(r) { return String(r.status || 'new').toLowerCase(); }
function icIsOpen(r) { var s = icStatus(r); return s !== 'resolved' && s !== 'closed'; }
function icSsoPending(r) { return !!r.medical_attention && !r.sso_claim_filed; }

function mountIncident() {
  var wrap = document.getElementById('wrap-incident');
  if (!wrap) return;

  wrap.innerHTML = `
<style>
#ic{--navy:#0D2F4F;--teal:#3DC5B7;--teal-light:#E6F7F5;--teal-dark:#0F766E;--bg:#F8F9FA;--muted:#6B7280;--border:#E5E7EB;--error:#DC2626;--warn:#F59E0B;--success:#16A34A;color:var(--navy);font-size:14px}

/* top banner (desktop incident_manager) */
#ic .ic-top{background:var(--navy);color:#fff;padding:14px 20px;display:flex;align-items:center;gap:12px;border-radius:10px 10px 0 0}
#ic .ic-top-t{font-size:16px;font-weight:600}
#ic .ic-top-b{background:#DC2626;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600}

/* stats */
#ic .ic-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 20px;background:var(--bg)}
#ic .ic-st{background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px;border-left-width:3px}
#ic .ic-st.n{border-left-color:var(--warn)}
#ic .ic-st.cr{border-left-color:#991B1B}
#ic .ic-st.sso{border-left-color:var(--error)}
#ic .ic-st.tot{border-left-color:var(--navy)}
#ic .ic-st-n{font-size:24px;font-weight:600}
#ic .ic-st-l{font-size:11px;color:var(--muted);margin-top:3px}
@media (max-width:768px){#ic .ic-stats{grid-template-columns:repeat(2,1fr)}}

/* tabs */
#ic .ic-tabs{display:flex;gap:2px;padding:0 20px;border-bottom:1px solid var(--border);background:#fff;overflow-x:auto}
#ic .ic-tab{padding:11px 16px;font-size:13px;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;font-weight:500;white-space:nowrap}
#ic .ic-tab.act{color:var(--navy);border-bottom-color:var(--teal);font-weight:600}
#ic .ic-tab-c{background:var(--bg);padding:1px 7px;border-radius:99px;font-size:10px;margin-left:4px}

/* body / table */
#ic .ic-body{padding:14px 20px}
#ic table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;border:1px solid var(--border)}
#ic th{background:var(--navy);color:#fff;padding:11px 12px;font-size:11px;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:.3px}
#ic td{padding:11px 12px;font-size:13px;border-top:1px solid var(--border);vertical-align:middle}
#ic tbody tr:hover td{background:var(--teal-light)}

/* pills */
#ic .ic-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600}
#ic .ic-pill.minor{background:#DBEAFE;color:#1E40AF}
#ic .ic-pill.moderate{background:#FEF3C7;color:#B45309}
#ic .ic-pill.severe{background:#FEE2E2;color:#991B1B}
#ic .ic-pill.critical{background:#7F1D1D;color:#fff}
#ic .ic-pill.new{background:#FEF3C7;color:#B45309}
#ic .ic-pill.investigating{background:#DBEAFE;color:#1E40AF}
#ic .ic-pill.resolved{background:#D1FAE5;color:#047857}
#ic .ic-pill.closed{background:#F3F4F6;color:#4B5563}

/* row button */
#ic .ic-rb{padding:5px 10px;border-radius:5px;font-size:10px;font-weight:500;cursor:pointer;border:1px solid var(--border);background:#fff;color:var(--navy);font-family:inherit}
#ic .ic-rb.p{background:var(--teal);color:#fff;border-color:var(--teal)}
#ic .ic-rb[disabled]{opacity:.5;cursor:not-allowed}
#ic .ic-empty{padding:60px 20px;text-align:center;color:var(--muted)}

/* modal */
#ic .ic-modal-bg{display:none;position:fixed;inset:0;background:rgba(13,47,79,.6);z-index:9000;align-items:center;justify-content:center;padding:20px}
#ic .ic-modal-bg.active{display:flex}
#ic .ic-modal{background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto}
#ic .ic-modal-h{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
#ic .ic-modal-h .ic-mt{font-size:15px;font-weight:600}
#ic .ic-modal-x{background:none;border:none;font-size:20px;color:var(--muted);cursor:pointer;line-height:1}
#ic .ic-modal-b{padding:16px 20px}
#ic .ic-dt{width:100%;font-size:12px;margin-bottom:14px}
#ic .ic-dt td{padding:5px 0;border:0;font-size:12px}
#ic .ic-dt td.k{color:var(--muted);width:130px;vertical-align:top}
</style>
<div id="ic">

  <div class="ic-top">
    <div class="ic-top-t">Incident Manager</div>
    <div class="ic-top-b">INC</div>
  </div>

  <div class="ic-stats">
    <div class="ic-st n"><div><div class="ic-st-n" id="ic-stN">–</div><div class="ic-st-l">รอจัดการ</div></div></div>
    <div class="ic-st cr"><div><div class="ic-st-n" id="ic-stCR">–</div><div class="ic-st-l">Critical เปิดอยู่</div></div></div>
    <div class="ic-st sso"><div><div class="ic-st-n" id="ic-stSSO">–</div><div class="ic-st-l">กท.16 ยังไม่ยื่น</div></div></div>
    <div class="ic-st tot"><div><div class="ic-st-n" id="ic-stTot">–</div><div class="ic-st-l">ทั้งหมด</div></div></div>
  </div>

  <div class="ic-tabs" id="ic-tabs"></div>

  <div class="ic-body" id="ic-tableWrap"><div class="ic-empty">กำลังโหลด...</div></div>

  <div class="ic-modal-bg" id="ic-modal-bg">
    <div class="ic-modal">
      <div class="ic-modal-h"><div class="ic-mt" id="ic-mt">รายละเอียด</div><button class="ic-modal-x" id="ic-modal-x">×</button></div>
      <div class="ic-modal-b" id="ic-mb"></div>
    </div>
  </div>

</div>`;

  document.getElementById('ic-modal-x').onclick = icCloseModal;
  document.getElementById('ic-modal-bg').onclick = function (e) {
    if (e.target === document.getElementById('ic-modal-bg')) icCloseModal();
  };

  icLoad();
}

async function icLoad() {
  var tw = document.getElementById('ic-tableWrap');
  if (tw) tw.innerHTML = '<div class="ic-empty">กำลังโหลด...</div>';
  try {
    var res = await sb.functions.invoke('hr_incident');
    _icState.items = (res && res.data && res.data.items) || [];
  } catch (e) {
    console.error('icLoad', e);
    _icState.items = [];
    if (tw) tw.innerHTML = '<div class="ic-empty">โหลดล้มเหลว</div>';
  }
  icRenderStats();
  icRenderTabs();
  icRenderTable();
}

function icCounts() {
  var it = _icState.items;
  var c = { 'new': 0, investigating: 0, critical: 0, sso_pending: 0, resolved: 0, all: it.length };
  for (var i = 0; i < it.length; i++) {
    var r = it[i], s = icStatus(r);
    if (s === 'new') c['new']++;
    if (s === 'investigating') c.investigating++;
    if (r.severity === 'critical' && icIsOpen(r)) c.critical++;
    if (icSsoPending(r)) c.sso_pending++;
    if (s === 'resolved' || s === 'closed') c.resolved++;
  }
  return c;
}

function icRenderStats() {
  var c = icCounts();
  document.getElementById('ic-stN').textContent = c['new'];
  document.getElementById('ic-stCR').textContent = c.critical;
  document.getElementById('ic-stSSO').textContent = c.sso_pending;
  document.getElementById('ic-stTot').textContent = c.all;
  // sidebar badge = เคสที่ยังเปิดอยู่ (รอจัดการ + กำลังจัดการ)
  var ct = document.getElementById('ct-incident');
  if (ct) { var open = c['new'] + c.investigating; ct.textContent = open || ''; }
}

function icRenderTabs() {
  var c = icCounts();
  var tabs = [
    { k: 'new',           l: 'รอจัดการ',     n: c['new'] },
    { k: 'investigating', l: 'กำลังจัดการ',   n: c.investigating },
    { k: 'critical',      l: 'Critical',     n: c.critical },
    { k: 'sso',           l: 'กท.16 ค้าง',    n: c.sso_pending },
    { k: 'resolved',      l: 'ปิดแล้ว',       n: c.resolved },
    { k: 'all',           l: 'ทั้งหมด',       n: c.all }
  ];
  document.getElementById('ic-tabs').innerHTML = tabs.map(function (t) {
    return '<div class="ic-tab ' + (_icState.tab === t.k ? 'act' : '') + '" data-tab="' + esc(t.k) + '">'
      + esc(t.l) + '<span class="ic-tab-c">' + t.n + '</span></div>';
  }).join('');
  Array.prototype.forEach.call(document.querySelectorAll('#ic-tabs .ic-tab'), function (el) {
    el.onclick = function () { icSetTab(el.getAttribute('data-tab')); };
  });
}

function icSetTab(k) {
  _icState.tab = k;
  icRenderTabs();
  icRenderTable();
}

// filter client-side ตาม tab ที่เลือก
function icFiltered() {
  var t = _icState.tab;
  return _icState.items.filter(function (r) {
    var s = icStatus(r);
    if (t === 'all') return true;
    if (t === 'new') return s === 'new';
    if (t === 'investigating') return s === 'investigating';
    if (t === 'critical') return r.severity === 'critical' && icIsOpen(r);
    if (t === 'sso') return icSsoPending(r);
    if (t === 'resolved') return s === 'resolved' || s === 'closed';
    return true;
  });
}

function icRenderTable() {
  var tw = document.getElementById('ic-tableWrap');
  if (!tw) return;
  var rows = icFiltered();
  if (!rows.length) { tw.innerHTML = '<div class="ic-empty">ไม่มีรายการ</div>'; return; }

  var checkSvg = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4 10-10"/></svg>';

  var body = rows.map(function (r) {
    var sev = r.severity || '';
    var st = icStatus(r);
    var sso = !r.medical_attention ? '—'
      : (r.sso_claim_filed
          ? '<span style="color:#16A34A;display:inline-flex;align-items:center;gap:4px">' + checkSvg + 'ยื่นแล้ว</span>'
          : '<span style="color:#DC2626">รอยื่น</span>');
    return '<tr>'
      + '<td>' + esc(r.incident_id) + '</td>'
      + '<td>' + esc(icCatLabel(icCat(r)))
        + '<div><span class="ic-pill ' + esc(sev) + '">' + esc(icSevLabel(sev)) + '</span></div></td>'
      + '<td>' + esc(r.reporter_name || r.reported_by || '') + '</td>'
      + '<td>' + esc(r.branch_name || r.branch_id || '')
        + '<div style="font-size:10px;color:var(--muted)">' + esc(r.incident_location || '') + '</div></td>'
      + '<td>' + esc(r.incident_date || '') + '</td>'
      + '<td><span class="ic-pill ' + esc(st) + '">' + esc(icStatusLabel(st)) + '</span></td>'
      + '<td>' + sso + '</td>'
      + '<td><button class="ic-rb p" data-view="' + esc(r.incident_id) + '">เปิด</button></td>'
      + '</tr>';
  }).join('');

  tw.innerHTML = '<div style="overflow-x:auto"><table><thead><tr>'
    + '<th>ID</th><th>ประเภท / severity</th><th>ผู้แจ้ง</th><th>สาขา · สถานที่</th>'
    + '<th>วันที่</th><th>Status</th><th>กท.16</th><th>Actions</th>'
    + '</tr></thead><tbody>' + body + '</tbody></table></div>';

  Array.prototype.forEach.call(tw.querySelectorAll('[data-view]'), function (btn) {
    btn.onclick = function () { icViewIncident(btn.getAttribute('data-view')); };
  });
}

function icFind(id) {
  return _icState.items.find(function (x) { return String(x.incident_id) === String(id); });
}

function icViewIncident(id) {
  var r = icFind(id);
  if (!r) { alert('ไม่พบเหตุการณ์'); return; }
  var sev = r.severity || '';
  var st = icStatus(r);

  document.getElementById('ic-mt').textContent = (r.incident_id || '') + ' · ' + icCatLabel(icCat(r));

  var rowsHtml = [
    '<tr><td class="k">ประเภท</td><td>' + esc(icCatLabel(icCat(r))) + ' · <span class="ic-pill ' + esc(sev) + '">' + esc(icSevLabel(sev)) + '</span></td></tr>',
    '<tr><td class="k">ผู้แจ้ง</td><td>' + esc(r.reporter_name || r.reported_by || '—') + '</td></tr>',
    '<tr><td class="k">วันที่ · สถานที่</td><td>' + esc(r.incident_date || '—') + (r.incident_location ? ' · ' + esc(r.incident_location) : '') + '</td></tr>',
    '<tr><td class="k">สาขา</td><td>' + esc(r.branch_name || r.branch_id || '—') + '</td></tr>',
    '<tr><td class="k">สถานะ</td><td><span class="ic-pill ' + esc(st) + '">' + esc(icStatusLabel(st)) + '</span></td></tr>',
    '<tr><td class="k">รายละเอียด</td><td style="white-space:pre-wrap">' + esc(icDetail(r) || '—') + '</td></tr>',
    '<tr><td class="k">การแก้ทันที</td><td style="white-space:pre-wrap">' + esc(r.immediate_action || '—') + '</td></tr>',
    '<tr><td class="k">รักษา</td><td>' + (r.medical_attention ? 'ใช่' + (r.sso_claim_filed ? ' · ยื่น กท.16 แล้ว' : ' · รอยื่น กท.16') : 'ไม่') + '</td></tr>'
  ];
  if (r.root_cause) rowsHtml.push('<tr><td class="k">Root cause</td><td style="white-space:pre-wrap">' + esc(r.root_cause) + '</td></tr>');
  if (r.preventive_action) rowsHtml.push('<tr><td class="k">Preventive</td><td style="white-space:pre-wrap">' + esc(r.preventive_action) + '</td></tr>');

  var footer;
  if (icIsOpen(r)) {
    footer = '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button class="ic-rb" id="ic-m-close">ปิด</button>'
      + '<button class="ic-rb p" id="ic-m-resolve">ปิดเคส</button></div>';
  } else {
    footer = '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button class="ic-rb" id="ic-m-close">ปิด</button></div>';
  }

  document.getElementById('ic-mb').innerHTML =
    '<table class="ic-dt">' + rowsHtml.join('') + '</table>' + footer;

  document.getElementById('ic-m-close').onclick = icCloseModal;
  var rb = document.getElementById('ic-m-resolve');
  if (rb) rb.onclick = function () { icResolve(r.incident_id); };

  document.getElementById('ic-modal-bg').classList.add('active');
}

function icCloseModal() {
  var bg = document.getElementById('ic-modal-bg');
  if (bg) bg.classList.remove('active');
}

// ปิดเคส → hr_approve {request_id: incident_id, decision:'approved'} (approved = ปิดเคส)
async function icResolve(id) {
  if (_icState.acting) return;
  if (!confirm('ปิดเคสนี้?')) return;

  _icState.acting = true;
  var rb = document.getElementById('ic-m-resolve');
  if (rb) rb.disabled = true;

  try {
    var resp = await sb.functions.invoke('hr_approve', {
      body: { request_id: id, decision: 'approved' }
    });
    var data = resp && resp.data, error = resp && resp.error;
    if (error || (data && data.error)) {
      alert('ผิดพลาด: ' + ((data && data.error) || (error && error.message) || 'ไม่สำเร็จ'));
      _icState.acting = false;
      if (rb) rb.disabled = false;
      return;
    }
    _icState.acting = false;
    icCloseModal();
    await icLoad();
  } catch (e) {
    _icState.acting = false;
    if (rb) rb.disabled = false;
    alert('ผิดพลาด: ' + ((e && e.message) || ''));
  }
}
