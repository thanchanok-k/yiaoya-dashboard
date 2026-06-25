/* accessmgr — "จัดการสิทธิ์พนักงาน" (console สิทธิ์ตามบทบาท + เพิ่มรายคน)
   โมเดล: effective(emp) = role_access[emp.role] ∪ app_access[emp.employee_id]
   - เลือกพนักงาน → เลือกบทบาท (base) → ดูสิทธิ์พื้นฐาน → เปิดสิทธิ์เพิ่มเติม (ค้นหา+คำอธิบายได้)
   - owner: ทำได้ทุกเมนู + เปลี่ยนบทบาท + แก้ base ราย บทบาท (โหมด "ตามบทบาท")
   - hr_director: เปลี่ยนบทบาทไม่ได้ (owner คุม) · เปิดเพิ่มได้เฉพาะเมนูไม่ owner_reserved
   ตาราง: menu_registry · access_role · role_access · employees · emp_access_role · app_access
   RLS บังคับชั้น DB — UI แค่สะท้อนสิทธิ์ */
(function () {
  const sb = window.sb, esc = window.esc, $ = window.$;

  const DOMAINS = [
    ['hr', '👥 HR · บุคคล'], ['acc', '💰 บัญชี/การเงิน'], ['purchase', '🛒 จัดซื้อ'],
    ['content', '🎨 คอนเทนต์/การตลาด'], ['exec', '📊 ผู้บริหาร/ภาพรวม'],
    ['system', '⚙️ ระบบ'], ['ai', '🤖 AI Operator'],
  ];

  let MY_ROLE = 'viewer', MY_UID = null, MODE = 'person';
  let MENU = {}, MENUS = [];      // view_key -> {..}, และ array เรียง
  let ROLES = [];                 // [{role_key,label}]
  let ROLEBASE = {};              // role_key -> Set(view_key)
  let EMPS = [];                  // [{employee_id,full_name,position,status}]
  let EMPROLE = {};               // employee_id -> role_key
  let EMPADD = {};                // employee_id -> Set(view_key)
  let CUR_EMP = null;             // employee_id ที่เลือก
  let EMP_FILTER = '', ADD_FILTER = '', BASE_ROLE = null;

  const canEditView = (vk) => MY_ROLE === 'owner' || (MY_ROLE === 'hr_director' && !MENU[vk]?.owner_reserved);
  const canSetRole  = () => MY_ROLE === 'owner';   // เปลี่ยนบทบาท = owner (เพราะ base อาจมีเมนู reserved)
  // บทบาทที่ hr_director เลือกให้ได้ = base ไม่มีเมนู reserved เลย (กันแอบ grant reserved ผ่าน base)
  const roleHasReserved = (rk) => [...(ROLEBASE[rk] || [])].some(vk => MENU[vk]?.owner_reserved);

  async function loadMe() {
    try {
      const { data: u } = await sb.auth.getUser();
      MY_UID = u && u.user && u.user.id;
      if (!MY_UID) return;
      const { data } = await sb.from('app_staff').select('role').eq('uid', MY_UID).eq('active', true).maybeSingle();
      MY_ROLE = (data && data.role) || 'viewer';
    } catch (e) { MY_ROLE = 'viewer'; }
  }

  async function loadAll() {
    const [mr, ar, ra, emp, er, aa] = await Promise.all([
      sb.from('menu_registry').select('view_key,label,domain,owner_reserved,sensitive,description,sort_order').order('sort_order'),
      sb.from('access_role').select('role_key,label,sort_order').order('sort_order'),
      sb.from('role_access').select('role_key,view_key'),
      sb.from('employees').select('employee_id,full_name,position,status'),
      sb.from('emp_access_role').select('employee_id,access_role'),
      sb.from('app_access').select('employee_id,view_key'),
    ]);
    if (mr.error) throw new Error(mr.error.message);
    MENUS = mr.data || []; MENU = {}; MENUS.forEach(m => { MENU[m.view_key] = m; });
    ROLES = ar.data || [];
    ROLEBASE = {}; (ra.data || []).forEach(r => { (ROLEBASE[r.role_key] = ROLEBASE[r.role_key] || new Set()).add(r.view_key); });
    EMPS = (emp.data || []).filter(e => e.employee_id).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'th'));
    EMPROLE = {}; (er.data || []).forEach(r => { EMPROLE[r.employee_id] = r.access_role; });
    EMPADD = {}; (aa.data || []).forEach(r => { if (r.employee_id) (EMPADD[r.employee_id] = EMPADD[r.employee_id] || new Set()).add(r.view_key); });
  }

  // ── employee list (ซ้าย) ──
  function empList() {
    const q = EMP_FILTER.trim().toLowerCase();
    const rows = EMPS.filter(e => !q || (e.full_name || '').toLowerCase().includes(q) || (e.employee_id || '').toLowerCase().includes(q) || (e.position || '').toLowerCase().includes(q));
    const items = rows.slice(0, 200).map(e => {
      const sel = e.employee_id === CUR_EMP;
      const rk = EMPROLE[e.employee_id];
      const rlbl = rk ? (ROLES.find(r => r.role_key === rk)?.label || rk) : '— ยังไม่ตั้ง —';
      return `<div class="am-emp" data-emp="${esc(e.employee_id)}"
        style="padding:9px 11px;border-bottom:1px solid var(--border,#EEF2F6);cursor:pointer;background:${sel ? '#ECFDF5' : 'transparent'}">
        <div style="font-weight:600;font-size:13px;color:var(--navy,#0D2F4F)">${esc(e.full_name || e.employee_id)}</div>
        <div style="font-size:10.5px;color:#94A3B8">${esc(e.employee_id)} · ${esc(rlbl)}</div>
      </div>`;
    }).join('');
    return `<div style="flex:0 0 270px;min-width:230px;border:1px solid var(--border,#E5E7EB);border-radius:10px;overflow:hidden;align-self:flex-start">
      <div style="padding:9px 11px;border-bottom:1px solid var(--border,#EEF2F6)">
        <input id="am-emp-search" placeholder="ค้นหาพนักงาน…" value="${esc(EMP_FILTER)}"
          style="width:100%;padding:7px 9px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:12.5px;box-sizing:border-box">
      </div>
      <div style="max-height:560px;overflow:auto">${items || '<div style="padding:14px;color:#94A3B8;font-size:12px">ไม่พบ</div>'}</div>
    </div>`;
  }

  // ── panel ขวา (สิทธิ์ของพนักงานที่เลือก) ──
  function roleOptions(curRole) {
    return ROLES.map(r => {
      const disabled = (MY_ROLE === 'hr_director' && roleHasReserved(r.role_key)) ? ' disabled' : '';
      const sel = r.role_key === curRole ? ' selected' : '';
      return `<option value="${esc(r.role_key)}"${sel}${disabled}>${esc(r.label)}</option>`;
    }).join('');
  }

  function baseChips(role) {
    const base = [...(ROLEBASE[role] || [])];
    if (!base.length) return '<span style="font-size:12px;color:#94A3B8">— บทบาทนี้ยังไม่มีสิทธิ์พื้นฐาน —</span>';
    return base.map(vk => `<span style="font-size:11.5px;background:#F1F5F9;color:#475569;border-radius:7px;padding:3px 9px;margin:0 4px 4px 0;display:inline-block">
      ${esc(MENU[vk]?.label || vk)}</span>`).join('');
  }

  function addRow(m, granted) {
    const editable = canEditView(m.view_key);
    const lock = m.owner_reserved ? `<span style="font-size:10px;color:#B45309;background:#FEF3C7;border-radius:5px;padding:1px 6px;margin-left:6px">🔒 เฉพาะผู้บริหาร</span>` : '';
    const pii = m.sensitive ? `<span style="font-size:10px;color:#6B21A8;background:#F3E8FF;border-radius:5px;padding:1px 6px;margin-left:4px">PDPA</span>` : '';
    return `<label class="am-add" data-key="${esc(m.view_key)}"
        style="display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border-bottom:1px solid var(--border,#EEF2F6);cursor:${editable ? 'pointer' : 'not-allowed'};opacity:${editable ? 1 : .55}">
      <input type="checkbox" class="am-add-cb" ${granted ? 'checked' : ''} ${editable ? '' : 'disabled'} style="width:16px;height:16px;accent-color:#0F766E;margin-top:1px">
      <span style="flex:1">
        <span style="font-size:13px;font-weight:600;color:var(--navy,#0D2F4F)">${esc(m.label || m.view_key)}${lock}${pii}</span>
        <span style="display:block;font-size:11px;color:#64748B;margin-top:1px">${esc(m.description || '')}</span>
      </span>
      <span class="am-msg" style="font-size:11px;min-width:36px;text-align:right"></span>
    </label>`;
  }

  function panel() {
    if (!CUR_EMP) return '<div style="flex:1;padding:30px;color:#94A3B8">← เลือกพนักงานทางซ้ายเพื่อตั้งสิทธิ์</div>';
    const e = EMPS.find(x => x.employee_id === CUR_EMP) || {};
    const role = EMPROLE[CUR_EMP] || '';
    const base = ROLEBASE[role] || new Set();
    const add = EMPADD[CUR_EMP] || new Set();
    const q = ADD_FILTER.trim().toLowerCase();
    // เมนูเพิ่มเติม = เมนูที่ "ไม่อยู่ใน base" (base มีให้อยู่แล้ว) + ผ่านตัวกรองค้นหา
    const addMenus = MENUS.filter(m => !base.has(m.view_key))
      .filter(m => !q || (m.label || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q) || m.view_key.includes(q));
    let addHtml = '';
    DOMAINS.forEach(([dk, dl]) => {
      const rows = addMenus.filter(m => m.domain === dk);
      if (!rows.length) return;
      addHtml += `<div class="sec" style="margin:12px 2px 4px"><span class="sec-bar"></span>${esc(dl)}<span class="sec-c">${rows.length}</span></div>
        <div class="card" style="margin-bottom:2px">${rows.map(m => addRow(m, add.has(m.view_key))).join('')}</div>`;
    });
    const roleDis = canSetRole() ? '' : ' disabled';
    const roleHint = canSetRole() ? 'เลือกบทบาทเพื่อกำหนดสิทธิ์พื้นฐาน' : 'เปลี่ยนบทบาทได้เฉพาะผู้บริหาร (owner)';
    return `<div style="flex:1;min-width:300px">
      <div class="card" style="padding:14px 16px;margin-bottom:10px">
        <div style="font-weight:700;font-size:15px;color:var(--navy,#0D2F4F)">${esc(e.full_name || CUR_EMP)}</div>
        <div style="font-size:11.5px;color:#94A3B8;margin-bottom:10px">${esc(CUR_EMP)} · ตำแหน่งเดิม: ${esc(e.position || '—')}</div>
        <label style="font-size:12px;color:#64748B;display:block;margin-bottom:4px">1 · บทบาท (สิทธิ์พื้นฐาน)</label>
        <select id="am-role"${roleDis} style="width:100%;max-width:340px;padding:8px 10px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:13px">
          <option value="">— เลือกบทบาท —</option>${roleOptions(role)}
        </select>
        <div style="font-size:11px;color:#94A3B8;margin-top:4px">${esc(roleHint)}</div>
      </div>
      <div class="card" style="padding:12px 16px;margin-bottom:10px">
        <div style="font-size:12px;color:#64748B;margin-bottom:7px">2 · สิทธิ์พื้นฐานของบทบาทนี้ <span style="color:#94A3B8">(มาอัตโนมัติ)</span></div>
        <div>${role ? baseChips(role) : '<span style="font-size:12px;color:#94A3B8">— ยังไม่ได้เลือกบทบาท —</span>'}</div>
      </div>
      <div class="card" style="padding:12px 16px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <span style="font-size:12px;color:#64748B">3 · ให้สิทธิ์เพิ่มเติม (เฉพาะคนนี้)</span>
          <input id="am-add-search" placeholder="ค้นหาเมนูที่จะเปิดเพิ่ม…" value="${esc(ADD_FILTER)}"
            style="flex:1;min-width:180px;padding:7px 9px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:12.5px">
        </div>
        <div id="am-add-list">${addHtml || '<div style="padding:14px;color:#94A3B8;font-size:12px">ไม่พบเมนูตามคำค้น</div>'}</div>
      </div>
    </div>`;
  }

  // ── โหมด "ตามบทบาท" (owner แก้ base) ──
  function baseEditor() {
    if (!BASE_ROLE) BASE_ROLE = ROLES[0]?.role_key;
    const base = ROLEBASE[BASE_ROLE] || new Set();
    const q = ADD_FILTER.trim().toLowerCase();
    const menus = MENUS.filter(m => !q || (m.label || '').toLowerCase().includes(q) || m.view_key.includes(q));
    let html = '';
    DOMAINS.forEach(([dk, dl]) => {
      const rows = menus.filter(m => m.domain === dk);
      if (!rows.length) return;
      html += `<div class="sec" style="margin:12px 2px 4px"><span class="sec-bar"></span>${esc(dl)}</div><div class="card" style="margin-bottom:2px">`;
      html += rows.map(m => `<label class="am-base" data-key="${esc(m.view_key)}" style="display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border-bottom:1px solid var(--border,#EEF2F6);cursor:pointer">
        <input type="checkbox" class="am-base-cb" ${base.has(m.view_key) ? 'checked' : ''} style="width:16px;height:16px;accent-color:#0F766E;margin-top:1px">
        <span style="flex:1"><span style="font-size:13px;font-weight:600;color:var(--navy,#0D2F4F)">${esc(m.label)}</span>
          <span style="display:block;font-size:11px;color:#64748B">${esc(m.description || '')}</span></span>
        <span class="am-msg" style="font-size:11px;min-width:36px;text-align:right"></span></label>`).join('');
      html += '</div>';
    });
    return `<div style="flex:1">
      <div class="card" style="padding:12px 16px;margin-bottom:10px">
        <label style="font-size:12px;color:#64748B;display:block;margin-bottom:4px">แก้สิทธิ์พื้นฐานของบทบาท (มีผลกับทุกคนในบทบาทนั้น)</label>
        <select id="am-baserole" style="max-width:340px;padding:8px 10px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:13px">
          ${ROLES.map(r => `<option value="${esc(r.role_key)}"${r.role_key === BASE_ROLE ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select>
        <input id="am-add-search" placeholder="ค้นหาเมนู…" value="${esc(ADD_FILTER)}" style="margin-left:8px;padding:7px 9px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:12.5px;min-width:160px">
      </div>
      <div id="am-add-list">${html}</div>
    </div>`;
  }

  // ── save handlers ──
  async function setEmpRole(role) {
    await sb.from('emp_access_role').upsert({ employee_id: CUR_EMP, access_role: role || null, updated_by: MY_UID }, { onConflict: 'employee_id' });
    EMPROLE[CUR_EMP] = role || undefined;
  }
  async function toggleAdd(key, want, msgEl) {
    if (msgEl) { msgEl.style.color = '#64748B'; msgEl.textContent = '…'; }
    try {
      if (want) {
        const { error } = await sb.from('app_access').insert({ employee_id: CUR_EMP, view_key: key, granted_by: MY_UID });
        if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
        (EMPADD[CUR_EMP] = EMPADD[CUR_EMP] || new Set()).add(key);
      } else {
        const { error } = await sb.from('app_access').delete().eq('employee_id', CUR_EMP).eq('view_key', key);
        if (error) throw new Error(error.message);
        EMPADD[CUR_EMP]?.delete(key);
      }
      if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '✓'; setTimeout(() => { if (msgEl.textContent === '✓') msgEl.textContent = ''; }, 1200); }
      return true;
    } catch (e) { if (msgEl) { msgEl.style.color = '#B91C1C'; msgEl.textContent = 'ห้าม'; } console.error(e); return false; }
  }
  async function toggleBase(key, want, msgEl) {
    if (msgEl) { msgEl.style.color = '#64748B'; msgEl.textContent = '…'; }
    try {
      if (want) {
        const { error } = await sb.from('role_access').insert({ role_key: BASE_ROLE, view_key: key });
        if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
        (ROLEBASE[BASE_ROLE] = ROLEBASE[BASE_ROLE] || new Set()).add(key);
      } else {
        const { error } = await sb.from('role_access').delete().eq('role_key', BASE_ROLE).eq('view_key', key);
        if (error) throw new Error(error.message);
        ROLEBASE[BASE_ROLE]?.delete(key);
      }
      if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.textContent = '✓'; setTimeout(() => { if (msgEl.textContent === '✓') msgEl.textContent = ''; }, 1200); }
    } catch (e) { if (msgEl) { msgEl.style.color = '#B91C1C'; msgEl.textContent = 'ห้าม'; } console.error(e); }
  }

  function rerenderPanel() {
    const host = document.getElementById('am-main'); if (!host) return;
    host.innerHTML = MODE === 'base' ? baseEditor() : (empList() + panel());
    bind();
  }

  function bind() {
    const es = document.getElementById('am-emp-search');
    if (es) es.oninput = () => { EMP_FILTER = es.value; const list = document.querySelector('#am-main'); // re-render only list keeps focus loss; acceptable
      rerenderPanel(); const f = document.getElementById('am-emp-search'); if (f) { f.focus(); f.selectionStart = f.value.length; } };
    document.querySelectorAll('.am-emp').forEach(el => { el.onclick = () => { CUR_EMP = el.dataset.emp; ADD_FILTER = ''; rerenderPanel(); }; });
    const rs = document.getElementById('am-role');
    if (rs) rs.onchange = async () => { await setEmpRole(rs.value); rerenderPanel(); };
    const as = document.getElementById('am-add-search');
    if (as) as.oninput = () => { ADD_FILTER = as.value; const list = document.getElementById('am-add-list');
      // re-render list ส่วนเดียวเพื่อคงโฟกัส
      if (MODE === 'base') { document.getElementById('am-main').innerHTML = baseEditor(); } else { rerenderListOnly(); }
      const f = document.getElementById('am-add-search'); if (f) { f.focus(); f.selectionStart = f.value.length; } bindAddOnly(); };
    const br = document.getElementById('am-baserole');
    if (br) br.onchange = () => { BASE_ROLE = br.value; rerenderPanel(); };
    bindAddOnly();
  }
  function rerenderListOnly() { const host = document.getElementById('am-main'); host.innerHTML = empList() + panel(); }
  function bindAddOnly() {
    document.querySelectorAll('.am-add-cb').forEach(cb => { cb.onchange = () => { const r = cb.closest('.am-add'); toggleAdd(r.dataset.key, cb.checked, r.querySelector('.am-msg')); }; });
    document.querySelectorAll('.am-base-cb').forEach(cb => { cb.onchange = () => { const r = cb.closest('.am-base'); toggleBase(r.dataset.key, cb.checked, r.querySelector('.am-msg')); }; });
    document.querySelectorAll('.am-emp').forEach(el => { el.onclick = () => { CUR_EMP = el.dataset.emp; ADD_FILTER = ''; rerenderPanel(); }; });
    const rs = document.getElementById('am-role'); if (rs) rs.onchange = async () => { await setEmpRole(rs.value); rerenderPanel(); };
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
      await loadAll();
      const banner = MY_ROLE === 'owner'
        ? `<div style="font-size:12px;color:#0F766E;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:9px 13px;margin-bottom:8px">👑 ผู้บริหาร (owner) · จัดสิทธิ์ได้ทุกเมนู + แก้สิทธิ์พื้นฐานราย บทบาท</div>`
        : `<div style="font-size:12px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:9px 13px;margin-bottom:8px">🧑‍💼 HR Director · เปิดได้เฉพาะเมนูทั่วไป — เมนู 🔒 (AI/เงิน/คดี) ผู้บริหารกำหนดเอง · เปลี่ยนบทบาท = ผู้บริหาร</div>`;
      const tabs = MY_ROLE === 'owner'
        ? `<div style="display:flex;gap:8px;margin-bottom:10px">
            <button id="am-tab-person" style="padding:6px 14px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:12.5px;cursor:pointer;background:${MODE === 'person' ? '#0F766E' : '#fff'};color:${MODE === 'person' ? '#fff' : '#475569'}">ตามคน</button>
            <button id="am-tab-base" style="padding:6px 14px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:12.5px;cursor:pointer;background:${MODE === 'base' ? '#0F766E' : '#fff'};color:${MODE === 'base' ? '#fff' : '#475569'}">ตามบทบาท (สิทธิ์พื้นฐาน)</button>
          </div>` : '';
      root.innerHTML = banner + tabs + `<div id="am-main" style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start"></div>`;
      const tp = document.getElementById('am-tab-person'), tb = document.getElementById('am-tab-base');
      if (tp) tp.onclick = () => { MODE = 'person'; ADD_FILTER = ''; render(); };
      if (tb) tb.onclick = () => { MODE = 'base'; ADD_FILTER = ''; render(); };
      rerenderPanel();
    } catch (e) {
      root.innerHTML = `<div style="padding:20px;color:#B91C1C">โหลดไม่สำเร็จ: ${esc(e.message)}
        <br><small style="color:#94A3B8">ต้องรัน schema 33_role_access.sql และ login ด้วย owner/hr_director</small></div>`;
    }
  }

  window.mountAccessmgr = render;
})();
