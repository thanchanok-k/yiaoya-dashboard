/* accessmgr — "จัดการสิทธิ์พนักงาน" (สิทธิ์ตามบทบาท + เพิ่มรายคน)
   effective(emp) = role_access[emp.role] ∪ app_access[emp.employee_id]
   - หน้าเต็ม: window.mountAccessmgr (รายชื่อพนักงาน + panel)
   - modal: window.openAccessPanel(empId) — เรียกจากหน้าทะเบียนพนักงาน (ปุ่ม line icon ต่อแถว)
   ไม่ใช้ emoji — ใช้ Tabler line icons (ti) ทั้งหมด
   2-tier: เปลี่ยนบทบาท=owner · hr_director เปิดเพิ่มได้เฉพาะ !owner_reserved · RLS บังคับชั้น DB */
(function () {
  const sb = window.sb, esc = window.esc, $ = window.$;

  const DOMAINS = [
    ['hr', 'ti-users', 'HR · บุคคล'], ['acc', 'ti-cash', 'บัญชี/การเงิน'],
    ['purchase', 'ti-shopping-cart', 'จัดซื้อ'], ['content', 'ti-palette', 'คอนเทนต์/การตลาด'],
    ['exec', 'ti-chart-bar', 'ผู้บริหาร/ภาพรวม'], ['system', 'ti-settings', 'ระบบ'],
    ['ai', 'ti-robot', 'AI Operator'],
  ];

  let MY_ROLE = 'viewer', MY_UID = null, MODE = 'person', LOADED = false;
  let MENU = {}, MENUS = [], ROLES = [], ROLEBASE = {}, EMPS = [], EMPROLE = {}, EMPADD = {};
  let CUR_EMP = null, EMP_FILTER = '', ADD_FILTER = '', BASE_ROLE = null;
  let RERENDER = null; // callback rerender ของบริบทปัจจุบัน (page หรือ modal)

  const ic = (name, extra) => `<i class="ti ${name}"${extra || ''} aria-hidden="true"></i>`;
  const canEdit = (vk) => MY_ROLE === 'owner' || (MY_ROLE === 'hr_director' && MENU[vk] && !MENU[vk].owner_reserved);
  const canSetRole = () => MY_ROLE === 'owner';
  const roleHasReserved = (rk) => [...(ROLEBASE[rk] || [])].some(vk => MENU[vk] && MENU[vk].owner_reserved);

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
      sb.from('app_access').select('view_key,employee_id'),
    ]);
    if (mr.error) throw new Error(mr.error.message);
    MENUS = mr.data || []; MENU = {}; MENUS.forEach(m => { MENU[m.view_key] = m; });
    ROLES = ar.data || [];
    ROLEBASE = {}; (ra.data || []).forEach(r => { (ROLEBASE[r.role_key] = ROLEBASE[r.role_key] || new Set()).add(r.view_key); });
    EMPS = (emp.data || []).filter(e => e.employee_id).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'th'));
    EMPROLE = {}; (er.data || []).forEach(r => { EMPROLE[r.employee_id] = r.access_role; });
    EMPADD = {}; (aa.data || []).forEach(r => { if (r.employee_id) (EMPADD[r.employee_id] = EMPADD[r.employee_id] || new Set()).add(r.view_key); });
    LOADED = true;
  }

  function roleLabel(rk) { return rk ? (ROLES.find(r => r.role_key === rk)?.label || rk) : '— ยังไม่ตั้ง —'; }

  function empList() {
    const q = EMP_FILTER.trim().toLowerCase();
    const rows = EMPS.filter(e => !q || (e.full_name || '').toLowerCase().includes(q) || (e.employee_id || '').toLowerCase().includes(q) || (e.position || '').toLowerCase().includes(q));
    const items = rows.slice(0, 200).map(e => {
      const sel = e.employee_id === CUR_EMP;
      return `<div class="am-emp" data-emp="${esc(e.employee_id)}"
        style="padding:9px 11px;border-bottom:1px solid var(--border,#EEF2F6);cursor:pointer;background:${sel ? '#ECFDF5' : 'transparent'}">
        <div style="font-weight:600;font-size:13px;color:var(--navy,#0D2F4F)">${esc(e.full_name || e.employee_id)}</div>
        <div style="font-size:10.5px;color:#94A3B8">${esc(e.employee_id)} · ${esc(roleLabel(EMPROLE[e.employee_id]))}</div>
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

  function roleOptions(curRole) {
    return ROLES.map(r => {
      const disabled = (MY_ROLE === 'hr_director' && roleHasReserved(r.role_key)) ? ' disabled' : '';
      return `<option value="${esc(r.role_key)}"${r.role_key === curRole ? ' selected' : ''}${disabled}>${esc(r.label)}</option>`;
    }).join('');
  }

  function baseChips(role) {
    const base = [...(ROLEBASE[role] || [])];
    if (!base.length) return '<span style="font-size:12px;color:#94A3B8">— บทบาทนี้ยังไม่มีสิทธิ์พื้นฐาน —</span>';
    return base.map(vk => `<span style="font-size:11.5px;background:#F1F5F9;color:#475569;border-radius:7px;padding:3px 9px;margin:0 4px 4px 0;display:inline-block">${esc(MENU[vk]?.label || vk)}</span>`).join('');
  }

  function addRow(m, granted) {
    const editable = canEdit(m.view_key);
    const lock = m.owner_reserved ? `<span style="font-size:10px;color:#B45309;background:#FEF3C7;border-radius:5px;padding:1px 6px;margin-left:6px">${ic('ti-lock')} เฉพาะผู้บริหาร</span>` : '';
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

  function addListHTML() {
    const base = ROLEBASE[EMPROLE[CUR_EMP]] || new Set();
    const add = EMPADD[CUR_EMP] || new Set();
    const q = ADD_FILTER.trim().toLowerCase();
    const addMenus = MENUS.filter(m => !base.has(m.view_key))
      .filter(m => !q || (m.label || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q) || m.view_key.includes(q));
    let html = '';
    DOMAINS.forEach(([dk, dic, dl]) => {
      const rows = addMenus.filter(m => m.domain === dk);
      if (!rows.length) return;
      html += `<div class="sec" style="margin:12px 2px 4px"><span class="sec-bar"></span>${ic(dic)} ${esc(dl)}<span class="sec-c">${rows.length}</span></div>
        <div class="card" style="margin-bottom:2px">${rows.map(m => addRow(m, add.has(m.view_key))).join('')}</div>`;
    });
    return html || '<div style="padding:14px;color:#94A3B8;font-size:12px">ไม่พบเมนูตามคำค้น</div>';
  }

  function panelHTML() {
    if (!CUR_EMP) return '<div style="flex:1;padding:30px;color:#94A3B8">เลือกพนักงานเพื่อตั้งสิทธิ์</div>';
    const e = EMPS.find(x => x.employee_id === CUR_EMP) || {};
    const role = EMPROLE[CUR_EMP] || '';
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
        <div id="am-add-list">${addListHTML()}</div>
      </div>
    </div>`;
  }

  function baseListHTML() {
    if (!BASE_ROLE) BASE_ROLE = ROLES[0]?.role_key;
    const base = ROLEBASE[BASE_ROLE] || new Set();
    const q = ADD_FILTER.trim().toLowerCase();
    const menus = MENUS.filter(m => !q || (m.label || '').toLowerCase().includes(q) || m.view_key.includes(q));
    let html = '';
    DOMAINS.forEach(([dk, dic, dl]) => {
      const rows = menus.filter(m => m.domain === dk);
      if (!rows.length) return;
      html += `<div class="sec" style="margin:12px 2px 4px"><span class="sec-bar"></span>${ic(dic)} ${esc(dl)}</div><div class="card" style="margin-bottom:2px">`;
      html += rows.map(m => `<label class="am-base" data-key="${esc(m.view_key)}" style="display:flex;gap:10px;align-items:flex-start;padding:9px 12px;border-bottom:1px solid var(--border,#EEF2F6);cursor:pointer">
        <input type="checkbox" class="am-base-cb" ${base.has(m.view_key) ? 'checked' : ''} style="width:16px;height:16px;accent-color:#0F766E;margin-top:1px">
        <span style="flex:1"><span style="font-size:13px;font-weight:600;color:var(--navy,#0D2F4F)">${esc(m.label)}</span>
          <span style="display:block;font-size:11px;color:#64748B">${esc(m.description || '')}</span></span>
        <span class="am-msg" style="font-size:11px;min-width:36px;text-align:right"></span></label>`).join('');
      html += '</div>';
    });
    return html;
  }
  function baseEditor() {
    return `<div style="flex:1">
      <div class="card" style="padding:12px 16px;margin-bottom:10px">
        <label style="font-size:12px;color:#64748B;display:block;margin-bottom:4px">แก้สิทธิ์พื้นฐานของบทบาท (มีผลกับทุกคนในบทบาทนั้น)</label>
        <select id="am-baserole" style="max-width:340px;padding:8px 10px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:13px">
          ${ROLES.map(r => `<option value="${esc(r.role_key)}"${r.role_key === BASE_ROLE ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
        </select>
        <input id="am-add-search" placeholder="ค้นหาเมนู…" value="${esc(ADD_FILTER)}" style="margin-left:8px;padding:7px 9px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:12.5px;min-width:160px">
      </div>
      <div id="am-add-list">${baseListHTML()}</div>
    </div>`;
  }

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
        EMPADD[CUR_EMP] && EMPADD[CUR_EMP].delete(key);
      }
      if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.innerHTML = ic('ti-check'); setTimeout(() => { msgEl.innerHTML = ''; }, 1200); }
    } catch (e) { if (msgEl) { msgEl.style.color = '#B91C1C'; msgEl.textContent = 'ห้าม'; } console.error(e); }
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
        ROLEBASE[BASE_ROLE] && ROLEBASE[BASE_ROLE].delete(key);
      }
      if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.innerHTML = ic('ti-check'); setTimeout(() => { msgEl.innerHTML = ''; }, 1200); }
    } catch (e) { if (msgEl) { msgEl.style.color = '#B91C1C'; msgEl.textContent = 'ห้าม'; } console.error(e); }
  }

  // bind handler บน scope ปัจจุบัน · rerender = ฟังก์ชัน redraw panel ทั้งก้อน
  function bindPanel() {
    const rs = document.getElementById('am-role');
    if (rs) rs.onchange = async () => { await setEmpRole(rs.value); RERENDER && RERENDER(); };
    const br = document.getElementById('am-baserole');
    if (br) br.onchange = () => { BASE_ROLE = br.value; RERENDER && RERENDER(); };
    const as = document.getElementById('am-add-search');
    if (as) as.oninput = () => {
      ADD_FILTER = as.value;
      const list = document.getElementById('am-add-list');
      if (list) list.innerHTML = (MODE === 'base') ? baseListHTML() : addListHTML();
      const f = document.getElementById('am-add-search'); if (f) { f.focus(); f.selectionStart = f.value.length; }
      bindToggles();
    };
    bindToggles();
  }
  function bindToggles() {
    document.querySelectorAll('.am-add-cb').forEach(cb => { cb.onchange = () => { const r = cb.closest('.am-add'); toggleAdd(r.dataset.key, cb.checked, r.querySelector('.am-msg')); }; });
    document.querySelectorAll('.am-base-cb').forEach(cb => { cb.onchange = () => { const r = cb.closest('.am-base'); toggleBase(r.dataset.key, cb.checked, r.querySelector('.am-msg')); }; });
  }

  // ── หน้าเต็ม ──
  function rerenderMain() {
    const host = document.getElementById('am-main'); if (!host) return;
    host.innerHTML = MODE === 'base' ? baseEditor() : (empList() + panelHTML());
    document.querySelectorAll('.am-emp').forEach(el => { el.onclick = () => { CUR_EMP = el.dataset.emp; ADD_FILTER = ''; rerenderMain(); }; });
    const es = document.getElementById('am-emp-search');
    if (es) es.oninput = () => { EMP_FILTER = es.value; rerenderMain(); const f = document.getElementById('am-emp-search'); if (f) { f.focus(); f.selectionStart = f.value.length; } };
    RERENDER = rerenderMain;
    bindPanel();
  }

  async function render() {
    const root = $('wrap-accessmgr'); if (!root) return;
    root.innerHTML = '<div style="padding:24px;color:#94A3B8">กำลังโหลด…</div>';
    try {
      await loadMe();
      if (MY_ROLE !== 'owner' && MY_ROLE !== 'hr_director') {
        root.innerHTML = `<div style="padding:24px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px">${ic('ti-lock')} เฉพาะ <b>ผู้บริหาร (owner)</b> หรือ <b>HR Director</b> เท่านั้นที่จัดการสิทธิ์ได้ · สิทธิ์ปัจจุบัน: ${esc(MY_ROLE)}</div>`;
        return;
      }
      await loadAll();
      const banner = MY_ROLE === 'owner'
        ? `<div style="font-size:12px;color:#0F766E;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:9px 13px;margin-bottom:8px">${ic('ti-crown')} ผู้บริหาร (owner) · จัดสิทธิ์ได้ทุกเมนู + แก้สิทธิ์พื้นฐานราย บทบาท</div>`
        : `<div style="font-size:12px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:9px 13px;margin-bottom:8px">${ic('ti-user-shield')} HR Director · เปิดได้เฉพาะเมนูทั่วไป — เมนู ${ic('ti-lock')} (AI/เงิน/คดี) ผู้บริหารกำหนดเอง · เปลี่ยนบทบาท = ผู้บริหาร</div>`;
      const tabs = MY_ROLE === 'owner'
        ? `<div style="display:flex;gap:8px;margin-bottom:10px">
            <button id="am-tab-person" style="padding:6px 14px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:12.5px;cursor:pointer;background:${MODE === 'person' ? '#0F766E' : '#fff'};color:${MODE === 'person' ? '#fff' : '#475569'}">ตามคน</button>
            <button id="am-tab-base" style="padding:6px 14px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:12.5px;cursor:pointer;background:${MODE === 'base' ? '#0F766E' : '#fff'};color:${MODE === 'base' ? '#fff' : '#475569'}">ตามบทบาท (สิทธิ์พื้นฐาน)</button>
          </div>` : '';
      root.innerHTML = banner + tabs + `<div id="am-main" style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start"></div>`;
      const tp = document.getElementById('am-tab-person'), tb = document.getElementById('am-tab-base');
      if (tp) tp.onclick = () => { MODE = 'person'; ADD_FILTER = ''; render(); };
      if (tb) tb.onclick = () => { MODE = 'base'; ADD_FILTER = ''; render(); };
      rerenderMain();
    } catch (e) {
      root.innerHTML = `<div style="padding:20px;color:#B91C1C">โหลดไม่สำเร็จ: ${esc(e.message)}<br><small style="color:#94A3B8">ต้องรัน 33_role_access.sql และ login ด้วย owner/hr_director</small></div>`;
    }
  }

  // ── modal (เรียกจากหน้าทะเบียนพนักงาน) ──
  function closeModal() { const m = document.getElementById('am-modal'); if (m) m.remove(); }
  function rerenderModalBody() {
    const b = document.getElementById('am-modal-body'); if (!b) return;
    MODE = 'person'; b.innerHTML = panelHTML();
    RERENDER = rerenderModalBody; bindPanel();
  }
  async function openPanel(empId) {
    if (!sb) return;
    try {
      if (!LOADED) { await loadMe(); }
      if (MY_ROLE !== 'owner' && MY_ROLE !== 'hr_director') { if (window.em2Toast) window.em2Toast('เฉพาะผู้บริหาร/HR Director จัดการสิทธิ์ได้', 'error'); return; }
      if (!LOADED) await loadAll(); else { /* refresh grants/role ของคนนี้ */ }
      MODE = 'person'; CUR_EMP = empId; ADD_FILTER = '';
      closeModal();
      const ov = document.createElement('div');
      ov.id = 'am-modal';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:30px 14px';
      ov.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:760px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border,#EEF2F6)">
          <span style="font-weight:700;font-size:15px;color:var(--navy,#0D2F4F)">${ic('ti-shield-lock')} ตั้งสิทธิ์เข้าระบบ</span>
          <span style="flex:1"></span>
          <button id="am-modal-x" style="border:1px solid var(--border,#E5E7EB);background:#fff;border-radius:8px;width:30px;height:30px;cursor:pointer">${ic('ti-x')}</button>
        </div>
        <div id="am-modal-body" style="padding:14px 16px">${panelHTML()}</div>
      </div>`;
      ov.onclick = (e) => { if (e.target === ov) closeModal(); };
      document.body.appendChild(ov);
      document.getElementById('am-modal-x').onclick = closeModal;
      RERENDER = rerenderModalBody; bindPanel();
    } catch (e) { console.error('openAccessPanel', e); if (window.em2Toast) window.em2Toast('เปิดแผงสิทธิ์ไม่สำเร็จ', 'error'); }
  }

  window.mountAccessmgr = render;
  window.openAccessPanel = openPanel;
})();
