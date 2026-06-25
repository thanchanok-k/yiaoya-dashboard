/* accessmgr — หน้า "จัดการสิทธิ์พนักงาน" (เฟส C ของระบบสิทธิ์ 2 ชั้น)
   - owner       : กำหนดสิทธิ์เห็นเมนูให้พนักงานได้ "ทุกเมนู" (รวม owner_reserved)
   - hr_director : กำหนดได้ "เฉพาะเมนูที่ไม่ owner_reserved" (เมนู AI/เงิน/sensitive ถูกล็อก)
   - role อื่น   : เข้าหน้านี้ไม่ได้ (lock screen)
   contract: menu_registry(view_key,label,domain,owner_reserved,sensitive,sort_order)
            app_access(uid,view_key,granted_by) · app_staff(uid,employee_id,role)
   ฝั่ง DB บังคับด้วย RLS (hr_director insert/delete เมนู reserved ไม่ได้) — UI แค่สะท้อนสิทธิ์ */
(function () {
  const sb = window.sb, esc = window.esc, $ = window.$;

  const DOMAINS = [
    ['hr', '👥 HR · บุคคล'],
    ['acc', '💰 บัญชี/การเงิน'],
    ['purchase', '🛒 จัดซื้อ'],
    ['content', '🎨 คอนเทนต์/การตลาด'],
    ['exec', '📊 ผู้บริหาร/ภาพรวม'],
    ['system', '⚙️ ระบบ'],
    ['ai', '🤖 AI Operator'],
  ];

  let MY_ROLE = 'viewer', MY_UID = null;
  let MENUS = [];          // menu_registry ทั้งหมด
  let STAFF = [];          // app_staff + ชื่อ
  let NAMES = {};          // employee_id -> full_name
  let GRANTS = new Set();  // view_key ที่คนที่เลือกถูก grant
  let CUR_UID = null;      // uid ของพนักงานที่กำลังจัดการ

  async function loadMe() {
    try {
      const { data: u } = await sb.auth.getUser();
      MY_UID = u && u.user && u.user.id;
      if (!MY_UID) return;
      const { data } = await sb.from('app_staff').select('role').eq('uid', MY_UID).eq('active', true).maybeSingle();
      MY_ROLE = (data && data.role) || 'viewer';
    } catch (e) { MY_ROLE = 'viewer'; }
  }

  const canEdit = (m) => MY_ROLE === 'owner' || (MY_ROLE === 'hr_director' && !m.owner_reserved);

  async function loadGrants(uid) {
    GRANTS = new Set();
    if (!uid) return;
    const { data } = await sb.from('app_access').select('view_key').eq('uid', uid);
    (data || []).forEach(r => GRANTS.add(r.view_key));
  }

  function personOptions() {
    return STAFF.map(s => {
      const nm = NAMES[s.employee_id] || s.employee_id || s.uid.slice(0, 8);
      const sel = s.uid === CUR_UID ? ' selected' : '';
      return `<option value="${esc(s.uid)}"${sel}>${esc(nm)} · ${esc(s.role)}</option>`;
    }).join('');
  }

  function menuRow(m) {
    const on = GRANTS.has(m.view_key);
    const editable = canEdit(m);
    const lock = m.owner_reserved
      ? `<span title="เฉพาะผู้บริหาร (owner)" style="font-size:10px;color:#B45309;background:#FEF3C7;border-radius:5px;padding:1px 6px;margin-left:6px">🔒 เฉพาะผู้บริหาร</span>` : '';
    const pii = m.sensitive
      ? `<span title="ข้อมูลอ่อนไหว PDPA" style="font-size:10px;color:#9333EA;background:#F3E8FF;border-radius:5px;padding:1px 6px;margin-left:4px">PDPA</span>` : '';
    return `<label class="am-row" data-key="${esc(m.view_key)}"
        style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border,#EEF2F6);
               cursor:${editable ? 'pointer' : 'not-allowed'};opacity:${editable ? 1 : .55}">
      <input type="checkbox" class="am-cb" ${on ? 'checked' : ''} ${editable ? '' : 'disabled'}
        style="width:16px;height:16px;accent-color:#0F766E">
      <span style="flex:1;font-size:13px;color:var(--navy,#0D2F4F)">${esc(m.label || m.view_key)}${lock}${pii}</span>
      <span style="font-size:10px;color:#94A3B8;font-family:monospace">${esc(m.view_key)}</span>
      <span class="am-msg" style="font-size:11px;min-width:48px"></span>
    </label>`;
  }

  function domainBlock(domKey, label) {
    const rows = MENUS.filter(m => m.domain === domKey);
    if (!rows.length) return '';
    const onN = rows.filter(m => GRANTS.has(m.view_key)).length;
    return `<div class="sec" style="margin:16px 2px 6px"><span class="sec-bar"></span>${esc(label)}
        <span class="sec-c">${onN}/${rows.length}</span></div>
      <div class="card" style="margin-bottom:4px">${rows.map(menuRow).join('')}</div>`;
  }

  async function toggleGrant(key, want, rowEl) {
    const msg = rowEl.querySelector('.am-msg');
    msg.style.color = '#64748B'; msg.textContent = '…';
    try {
      if (want) {
        const { error } = await sb.from('app_access').insert({ uid: CUR_UID, view_key: key, granted_by: MY_UID });
        if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
        GRANTS.add(key);
      } else {
        const { error } = await sb.from('app_access').delete().eq('uid', CUR_UID).eq('view_key', key);
        if (error) throw new Error(error.message);
        GRANTS.delete(key);
      }
      msg.style.color = '#0F766E'; msg.textContent = '✓';
      setTimeout(() => { if (msg.textContent === '✓') msg.textContent = ''; }, 1400);
    } catch (e) {
      // RLS ปฏิเสธ (เช่น hr_director แตะเมนู reserved) → ดีดกลับ
      const cb = rowEl.querySelector('.am-cb'); if (cb) cb.checked = !want;
      msg.style.color = '#B91C1C'; msg.textContent = 'ห้าม';
      console.error('toggleGrant', key, e);
    }
  }

  function bindRows(wrap) {
    wrap.querySelectorAll('.am-cb').forEach(cb => {
      cb.onchange = () => {
        const rowEl = cb.closest('.am-row');
        toggleGrant(rowEl.dataset.key, cb.checked, rowEl);
      };
    });
  }

  async function renderBody(wrap) {
    if (!CUR_UID) { wrap.innerHTML = '<div style="padding:20px;color:#94A3B8">— ยังไม่มีพนักงานให้จัดการ (พนักงานจะปรากฏหลัง login ครั้งแรก) —</div>'; return; }
    await loadGrants(CUR_UID);
    let html = '';
    DOMAINS.forEach(([k, l]) => { html += domainBlock(k, l); });
    wrap.innerHTML = html;
    bindRows(wrap);
  }

  async function render() {
    const root = $('wrap-accessmgr'); if (!root) return;
    root.innerHTML = '<div style="padding:24px;color:#94A3B8">กำลังโหลด…</div>';
    try {
      await loadMe();
      if (MY_ROLE !== 'owner' && MY_ROLE !== 'hr_director') {
        root.innerHTML = `<div style="padding:24px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px">
          🔒 เฉพาะ <b>ผู้บริหาร (owner)</b> หรือ <b>HR Director</b> เท่านั้นที่จัดการสิทธิ์ได้ · สิทธิ์ปัจจุบัน: ${esc(MY_ROLE)}</div>`;
        return;
      }
      // โหลด menu_registry + app_staff + ชื่อพนักงาน
      const [mr, st, emp] = await Promise.all([
        sb.from('menu_registry').select('view_key,label,domain,owner_reserved,sensitive,sort_order').order('sort_order'),
        sb.from('app_staff').select('uid,employee_id,role').eq('active', true),
        sb.from('employees').select('employee_id,full_name'),
      ]);
      if (mr.error) throw new Error(mr.error.message);
      MENUS = mr.data || [];
      STAFF = (st.data || []).filter(s => s.role !== 'owner'); // ไม่ต้องจัดสิทธิ์ owner เอง
      NAMES = {}; (emp.data || []).forEach(e => { NAMES[e.employee_id] = e.full_name; });
      CUR_UID = STAFF.length ? STAFF[0].uid : null;

      const reservedNote = MY_ROLE === 'hr_director'
        ? `<div style="font-size:12px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:9px 13px;margin-bottom:8px">
            👤 สิทธิ์ <b>HR Director</b> · จัดได้เฉพาะเมนูทั่วไป — เมนู <b>🔒 เฉพาะผู้บริหาร</b> (AI/เงินเดือน/คดี/sensitive) ผู้บริหารกำหนดเอง</div>`
        : `<div style="font-size:12px;color:#0F766E;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:9px 13px;margin-bottom:8px">
            👑 สิทธิ์ <b>ผู้บริหาร (owner)</b> · จัดสิทธิ์ได้ทุกเมนู</div>`;

      root.innerHTML = `${reservedNote}
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 2px 6px">
          <span style="font-size:12.5px;color:#64748B">เลือกพนักงาน:</span>
          <select id="am-person" style="padding:7px 10px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:13px;min-width:220px">
            ${personOptions()}
          </select>
        </div>
        <div id="am-body"></div>`;

      const sel = document.getElementById('am-person');
      const body = document.getElementById('am-body');
      if (sel) sel.onchange = () => { CUR_UID = sel.value; renderBody(body); };
      await renderBody(body);
    } catch (e) {
      root.innerHTML = `<div style="padding:20px;color:#B91C1C">โหลดไม่สำเร็จ: ${esc(e.message)}
        <br><small style="color:#94A3B8">ต้องรัน schema 32_access_control.sql และ login ด้วยบัญชี owner/hr_director</small></div>`;
    }
  }

  window.mountAccessmgr = render;
})();
