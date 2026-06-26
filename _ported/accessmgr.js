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
  let MENU = {}, MENUS = [], ROLES = [], ROLEBASE = {}, EMPS = [], EMPROLE = {}, EMPADD = {}, EMPLOCK = {};
  let CUR_EMP = null, EMP_FILTER = '', ADD_FILTER = '', BASE_ROLE = null, OPEN_DOMS = null;
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
    const [mr, ar, ra, emp, er, aa, el] = await Promise.all([
      sb.from('menu_registry').select('view_key,label,domain,owner_reserved,sensitive,description,sort_order').order('sort_order'),
      sb.from('access_role').select('role_key,label,sort_order').order('sort_order'),
      sb.from('role_access').select('role_key,view_key'),
      sb.from('employees').select('employee_id,full_name,position,status'),
      sb.from('emp_access_role').select('employee_id,access_role'),
      sb.from('app_access').select('view_key,employee_id'),
      sb.from('emp_locks').select('employee_id,position_locked,role_locked'),
    ]);
    if (mr.error) throw new Error(mr.error.message);
    MENUS = mr.data || []; MENU = {}; MENUS.forEach(m => { MENU[m.view_key] = m; });
    ROLES = ar.data || [];
    ROLEBASE = {}; (ra.data || []).forEach(r => { (ROLEBASE[r.role_key] = ROLEBASE[r.role_key] || new Set()).add(r.view_key); });
    EMPS = (emp.data || []).filter(e => e.employee_id).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'th'));
    EMPROLE = {}; (er.data || []).forEach(r => { EMPROLE[r.employee_id] = r.access_role; });
    EMPADD = {}; (aa.data || []).forEach(r => { if (r.employee_id) (EMPADD[r.employee_id] = EMPADD[r.employee_id] || new Set()).add(r.view_key); });
    EMPLOCK = {}; (el && el.data || []).forEach(r => { if (r.employee_id) EMPLOCK[r.employee_id] = { position_locked: r.position_locked, role_locked: r.role_locked }; });
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
    return ROLES.filter(r => MY_ROLE === 'owner' || !roleHasReserved(r.role_key)).map(r => {
      return `<option value="${esc(r.role_key)}"${r.role_key === curRole ? ' selected' : ''}>${esc(r.label)}</option>`;
    }).join('');
  }

  /* ===== render ใหม่: accordion + toggle + สรุปสิทธิ์ (คง logic เดิม) ===== */
  // inject CSS ครั้งเดียว
  function ensureStyle() {
    if (document.getElementById('am2-style')) return;
    const s = document.createElement('style'); s.id = 'am2-style';
    s.textContent = '.am-sw{width:38px;height:22px;border-radius:11px;background:#CBD5E1;position:relative;flex:0 0 auto;cursor:pointer;transition:background .15s}'
      + '.am-sw.on{background:#3DC5B7}.am-sw.lk{background:#94A3B8;cursor:not-allowed}'
      + '.am-kn{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}'
      + '.am-sw.on .am-kn{left:18px}'
      + '.am-pill{font-size:10px;border-radius:5px;padding:1px 6px;margin-left:5px;white-space:nowrap}'
      + '.am-tag{font-size:10px;border-radius:5px;padding:2px 7px;font-weight:600;white-space:nowrap}'
      + '.am-dom{border:1px solid var(--border,#E5E7EB);border-radius:10px;margin-bottom:8px;overflow:hidden}'
      + '.am-dh{display:flex;align-items:center;gap:9px;padding:10px 12px;cursor:pointer;background:#fff}.am-dh:hover{background:#F8F9FA}'
      + '.am-grp{font-size:11px;border:1px solid var(--border,#E5E7EB);border-radius:7px;padding:3px 9px;background:#fff;color:#475569;cursor:pointer}.am-grp:hover{background:#E6F7F5}'
      + '.am-cnt{font-size:11px;font-weight:600;border-radius:7px;padding:2px 8px;white-space:nowrap}'
      + '.am-row:hover{background:#FAFCFC}';
    document.head.appendChild(s);
  }

  // state ของเมนู 1 อัน ตามโหมด
  function menuOn(m, mode) {
    if (mode === 'base') { const rs = ROLEBASE[BASE_ROLE] || new Set(); return { on: rs.has(m.view_key), src: rs.has(m.view_key) ? 'role' : null }; }
    const base = ROLEBASE[EMPROLE[CUR_EMP]] || new Set();
    const add = EMPADD[CUR_EMP] || new Set();
    if (base.has(m.view_key)) return { on: true, src: 'role' };
    if (add.has(m.view_key)) return { on: true, src: 'add' };
    return { on: false, src: null };
  }
  function menuEditable(m, mode) {
    if (!canEdit(m.view_key)) return false;                       // owner_reserved + hr_director → ล็อก
    if (mode === 'person' && (ROLEBASE[EMPROLE[CUR_EMP]] || new Set()).has(m.view_key)) return false; // มาจากบทบาท → แก้ที่นี่ไม่ได้
    return true;
  }
  function personStats() {
    const base = ROLEBASE[EMPROLE[CUR_EMP]] || new Set();
    const add = EMPADD[CUR_EMP] || new Set();
    const union = new Set([...base, ...add]);
    let addOnly = 0; add.forEach(v => { if (!base.has(v)) addOnly++; });
    return { all: union.size, role: base.size, add: addOnly };
  }
  function summaryInner() {
    const s = personStats();
    const card = (n, l, bg, nc, lc) => `<div style="background:${bg};border-radius:8px;padding:9px 11px;text-align:center"><div style="font-size:21px;font-weight:700;color:${nc};line-height:1.1">${n}</div><div style="font-size:11px;color:${lc};margin-top:2px">${l}</div></div>`;
    return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px">
      ${card(s.all, 'เข้าได้ทั้งหมด', '#E6F7F5', '#0D2F4F', '#0F766E')}
      ${card(s.role, 'จากบทบาท', '#F1F5F9', '#475569', '#64748B')}
      ${card(s.add, 'เพิ่มให้คนนี้', '#E6F7F5', '#0D2F4F', '#0F766E')}
    </div>`;
  }
  function rowHTML(m, mode) {
    const st = menuOn(m, mode);
    const ed = menuEditable(m, mode);
    const swCls = 'am-sw' + (st.on ? ' on' : '') + (ed ? '' : ' lk');
    let pills = '';
    if (m.owner_reserved) pills += `<span class="am-pill" style="background:#FEF3C7;color:#B45309">${ic('ti-lock')} เฉพาะผู้บริหาร</span>`;
    if (m.sensitive) pills += `<span class="am-pill" style="background:#F3E8FF;color:#6B21A8">PDPA</span>`;
    let tag = '';
    if (mode === 'person') {
      if (st.src === 'role') tag = '<span class="am-tag" style="background:#F1F5F9;color:#475569">จากบทบาท</span>';
      else if (st.src === 'add') tag = '<span class="am-tag" style="background:#E6F7F5;color:#0F766E">เพิ่มเอง</span>';
    }
    return `<div class="am-row" data-key="${esc(m.view_key)}" style="display:flex;gap:10px;align-items:center;padding:9px 12px;border-top:1px solid #F1F5F9${ed ? '' : ';opacity:.6'}">
      <span class="${swCls}"><span class="am-kn"></span></span>
      <span style="flex:1;min-width:0"><span style="font-size:13px;font-weight:600;color:var(--navy,#0D2F4F)">${esc(m.label || m.view_key)}${pills}</span><span style="display:block;font-size:11px;color:#94A3B8">${esc(m.description || '')}</span></span>
      ${tag}
      <span class="am-msg" style="font-size:11px;min-width:18px;text-align:right"></span>
    </div>`;
  }
  function initOpenDoms(mode) {
    OPEN_DOMS = new Set();
    DOMAINS.forEach(([dk]) => {
      const onAll = MENUS.filter(m => m.domain === dk && (MY_ROLE === 'owner' || !m.owner_reserved)).filter(m => menuOn(m, mode).on).length;
      if (onAll > 0) OPEN_DOMS.add(dk);
    });
    if (OPEN_DOMS.size === 0) { const first = DOMAINS.find(([dk]) => MENUS.some(m => m.domain === dk && (MY_ROLE === 'owner' || !m.owner_reserved))); if (first) OPEN_DOMS.add(first[0]); }
  }
  function accordionHTML(mode) {
    const q = (ADD_FILTER || '').trim().toLowerCase();
    if (OPEN_DOMS === null) initOpenDoms(mode);
    let html = '';
    DOMAINS.forEach(([dk, dic, dl]) => {
      const all = MENUS.filter(m => m.domain === dk && (MY_ROLE === 'owner' || !m.owner_reserved));
      if (!all.length) return;
      const rows = q ? all.filter(m => (m.label || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q) || m.view_key.toLowerCase().includes(q)) : all;
      if (!rows.length) return;
      const onAll = all.filter(m => menuOn(m, mode).on).length;
      const open = q ? true : OPEN_DOMS.has(dk);
      const cntStyle = onAll > 0 ? 'background:#E6F7F5;color:#0F766E' : 'background:#F1F5F9;color:#94A3B8';
      const anyEd = rows.some(m => menuEditable(m, mode));
      const grp = anyEd ? `<div style="display:flex;gap:7px;padding:8px 12px;border-top:1px solid #F1F5F9;background:#FAFCFC"><button class="am-grp" data-dom="${dk}" data-act="on">${ic('ti-check')} เปิดทั้งหมวด</button><button class="am-grp" data-dom="${dk}" data-act="off">${ic('ti-x')} ปิดทั้งหมวด</button></div>` : '';
      html += `<div class="am-dom"><div class="am-dh" data-dom="${dk}">${ic(open ? 'ti-chevron-down' : 'ti-chevron-right')} ${ic(dic)} <span style="font-weight:600;font-size:13.5px;color:var(--navy,#0D2F4F);flex:1">${esc(dl)}</span><span class="am-cnt" style="${cntStyle}">เปิด ${onAll} / ${all.length}</span></div><div class="am-db" style="display:${open ? 'block' : 'none'}">${grp}${rows.map(m => rowHTML(m, mode)).join('')}</div></div>`;
    });
    return html || '<div style="padding:14px;color:#94A3B8;font-size:12px">ไม่พบเมนูตามคำค้น</div>';
  }
  function refreshAcc(mode) {
    const acc = document.getElementById('am-acc'); if (acc) acc.innerHTML = accordionHTML(mode);
    if (mode === 'person') { const s = document.getElementById('am-summary'); if (s) s.innerHTML = summaryInner(); }
    else { const bc = document.getElementById('am-base-count'); if (bc) bc.textContent = MENUS.filter(m => (ROLEBASE[BASE_ROLE] || new Set()).has(m.view_key)).length; }
    bindAcc(mode);
  }
  function bindAcc(mode) {
    document.querySelectorAll('#am-acc .am-dh').forEach(h => {
      h.onclick = (ev) => { if (ev.target.closest('.am-grp')) return; const dk = h.dataset.dom; if (OPEN_DOMS === null) initOpenDoms(mode); if (OPEN_DOMS.has(dk)) OPEN_DOMS.delete(dk); else OPEN_DOMS.add(dk); refreshAcc(mode); };
    });
    document.querySelectorAll('#am-acc .am-sw').forEach(sw => {
      sw.onclick = async () => {
        const r = sw.closest('.am-row'); const vk = r.dataset.key; const msg = r.querySelector('.am-msg');
        if (sw.classList.contains('lk')) {
          if (mode === 'person' && (ROLEBASE[EMPROLE[CUR_EMP]] || new Set()).has(vk)) { if (window.em2Toast) window.em2Toast('สิทธิ์นี้มาจากบทบาท — แก้ที่บทบาท หรือเปลี่ยนบทบาทของคนนี้', 'error'); }
          else if (window.em2Toast) window.em2Toast('เมนูนี้เฉพาะผู้บริหาร (owner) กำหนดได้', 'error');
          return;
        }
        const want = !sw.classList.contains('on');
        const ok = mode === 'base' ? await toggleBase(vk, want, msg) : await toggleAdd(vk, want, msg);
        if (ok) refreshAcc(mode);
      };
    });
    document.querySelectorAll('#am-acc .am-grp').forEach(b => {
      b.onclick = async (ev) => {
        ev.stopPropagation();
        const dk = b.dataset.dom, want = b.dataset.act === 'on';
        const rows = MENUS.filter(m => m.domain === dk && menuEditable(m, mode));
        for (const m of rows) {
          const cur = menuOn(m, mode).on;
          if (want && !cur) { mode === 'base' ? await toggleBase(m.view_key, true, null) : await toggleAdd(m.view_key, true, null); }
          else if (!want && cur) { mode === 'base' ? await toggleBase(m.view_key, false, null) : await toggleAdd(m.view_key, false, null); }
        }
        refreshAcc(mode);
      };
    });
    bindMenuTooltips();
  }

  function panelHTML() {
    if (!CUR_EMP) return '<div style="flex:1;padding:30px;color:#94A3B8">เลือกพนักงานเพื่อตั้งสิทธิ์</div>';
    const e = EMPS.find(x => x.employee_id === CUR_EMP) || {};
    const role = EMPROLE[CUR_EMP] || '';
    const roleLocked = !!(EMPLOCK[CUR_EMP] && EMPLOCK[CUR_EMP].role_locked);
    const roleDis = (canSetRole() && !roleLocked) ? '' : ' disabled';
    const roleHint = canSetRole() ? 'เลือกบทบาทเพื่อกำหนดสิทธิ์พื้นฐาน — เมนูที่มาจากบทบาทจะติดป้าย “จากบทบาท” อัตโนมัติ (ล็อกไว้) · ติ๊กเพิ่มได้เฉพาะเมนูอื่น' : 'เปลี่ยนบทบาทได้เฉพาะผู้บริหาร (owner)';
    const lockNote = roleLocked ? `<div style="font-size:10px;color:#B45309;margin-top:4px;white-space:nowrap">${ic('ti-lock')} บทบาทถูกล็อก — ปลดล็อกได้ที่หน้าทะเบียนพนักงาน</div>` : '';
    const initials = (e.full_name || CUR_EMP).trim().slice(0, 2);
    return `<div style="flex:1;min-width:300px">
      <div class="card" style="padding:12px 14px;margin-bottom:11px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="width:42px;height:42px;border-radius:50%;background:#0D2F4F;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px">${esc(initials)}</div>
        <div style="flex:1;min-width:140px">
          <div style="font-weight:700;font-size:15px;color:var(--navy,#0D2F4F)">${esc(e.full_name || CUR_EMP)}</div>
          <div style="font-size:11.5px;color:#94A3B8">${esc(CUR_EMP)} · ${esc(e.position || '—')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:#94A3B8;margin-bottom:3px">บทบาท (สิทธิ์พื้นฐาน)</div>
          <select id="am-role"${roleDis} style="min-width:170px;padding:7px 9px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:13px"><option value="">— เลือกบทบาท —</option>${roleOptions(role)}</select>
          ${lockNote}
        </div>
      </div>
      <div id="am-summary">${summaryInner()}</div>
      <div style="position:relative;margin:11px 0 6px">
        <span style="position:absolute;left:11px;top:8px;color:#94A3B8">${ic('ti-search')}</span>
        <input id="am-add-search" placeholder="ค้นหาเมนูทุกหมวด…" value="${esc(ADD_FILTER)}" style="width:100%;padding:8px 10px 8px 32px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:13px;box-sizing:border-box">
      </div>
      <div style="font-size:11px;color:#94A3B8;margin-bottom:8px">${esc(roleHint)}</div>
      <div id="am-acc">${accordionHTML('person')}</div>
    </div>`;
  }

  function baseEditor() {
    if (!BASE_ROLE) BASE_ROLE = ROLES[0]?.role_key;
    const onAll = MENUS.filter(m => (ROLEBASE[BASE_ROLE] || new Set()).has(m.view_key)).length;
    return `<div style="flex:1">
      <div class="card" style="padding:12px 14px;margin-bottom:11px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:160px">
          <div style="font-size:12px;color:#64748B;margin-bottom:4px">แก้สิทธิ์พื้นฐานของบทบาท <span style="color:#94A3B8">(มีผลกับทุกคนในบทบาทนี้)</span></div>
          <select id="am-baserole" style="min-width:240px;padding:8px 10px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:13px">${ROLES.map(r => `<option value="${esc(r.role_key)}"${r.role_key === BASE_ROLE ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
        </div>
        <div style="text-align:right"><div id="am-base-count" style="font-size:21px;font-weight:700;color:#0D2F4F;line-height:1">${onAll}</div><div style="font-size:11px;color:#0F766E">เมนูที่เปิด</div></div>
      </div>
      <div style="position:relative;margin-bottom:11px">
        <span style="position:absolute;left:11px;top:8px;color:#94A3B8">${ic('ti-search')}</span>
        <input id="am-add-search" placeholder="ค้นหาเมนูทุกหมวด…" value="${esc(ADD_FILTER)}" style="width:100%;padding:8px 10px 8px 32px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:13px;box-sizing:border-box">
      </div>
      <div id="am-acc">${accordionHTML('base')}</div>
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
        ROLEBASE[BASE_ROLE] && ROLEBASE[BASE_ROLE].delete(key);
      }
      if (msgEl) { msgEl.style.color = '#0F766E'; msgEl.innerHTML = ic('ti-check'); setTimeout(() => { msgEl.innerHTML = ''; }, 1200); }
      return true;
    } catch (e) { if (msgEl) { msgEl.style.color = '#B91C1C'; msgEl.textContent = 'ห้าม'; } console.error(e); return false; }
  }

  // bind handler บน scope ปัจจุบัน · rerender = ฟังก์ชัน redraw panel ทั้งก้อน
  function bindPanel() {
    ensureStyle();
    const rs = document.getElementById('am-role');
    if (rs) rs.onchange = async () => { if (EMPLOCK[CUR_EMP] && EMPLOCK[CUR_EMP].role_locked) return; await setEmpRole(rs.value); OPEN_DOMS = null; RERENDER && RERENDER(); };
    const br = document.getElementById('am-baserole');
    if (br) br.onchange = () => { BASE_ROLE = br.value; OPEN_DOMS = null; RERENDER && RERENDER(); };
    const as = document.getElementById('am-add-search');
    if (as) as.oninput = () => {
      ADD_FILTER = as.value;
      refreshAcc(MODE);
      const f = document.getElementById('am-add-search'); if (f) { f.focus(); f.selectionStart = f.value.length; }
    };
    bindAcc(MODE);
  }

  // ── tooltip สรุปต่อเมนู (hover แถวสิทธิ์) ──
  const DOMAIN_LBL = {}; DOMAINS.forEach(([dk, , dl]) => { DOMAIN_LBL[dk] = dl; });
  function rolesWithMenu(vk) {
    return ROLES.filter(r => ROLEBASE[r.role_key] && ROLEBASE[r.role_key].has(vk)).map(r => r.label);
  }
  function menuTipHTML(vk) {
    const m = MENU[vk]; if (!m) return '';
    const row = (label, val) => `<div style="display:flex;gap:6px;margin-top:4px"><span style="color:#94A3B8;min-width:62px">${label}</span><span style="color:#E2E8F0;flex:1">${val}</span></div>`;
    const flags = [];
    if (m.owner_reserved) flags.push('<span style="color:#FCD34D">เฉพาะผู้บริหาร (owner)</span>');
    if (m.sensitive) flags.push('<span style="color:#E9D5FF">ข้อมูลอ่อนไหว · PDPA</span>');
    const roles = rolesWithMenu(vk);
    let h = `<div style="font-weight:700;font-size:12.5px;color:#fff;margin-bottom:2px">${esc(m.label || vk)}</div>`;
    if (m.description) h += `<div style="color:#CBD5E1;line-height:1.45">${esc(m.description)}</div>`;
    h += row('รหัสเมนู', `<code style="color:#7DD3FC">${esc(vk)}</code>`);
    h += row('โดเมน', esc(DOMAIN_LBL[m.domain] || m.domain || '—'));
    if (flags.length) h += row('สถานะ', flags.join(' · '));
    h += row('บทบาทพื้นฐาน', roles.length ? esc(roles.join(', ')) : '<span style="color:#94A3B8">— ไม่มีบทบาทใดเปิดให้โดยอัตโนมัติ —</span>');
    return h;
  }
  function tipEl() {
    let t = document.getElementById('am-tip');
    if (!t) {
      t = document.createElement('div'); t.id = 'am-tip';
      t.style.cssText = 'position:fixed;z-index:10001;max-width:320px;background:#0F172A;border:1px solid #334155;border-radius:9px;padding:10px 12px;font-size:11.5px;line-height:1.4;box-shadow:0 12px 30px rgba(0,0,0,.4);pointer-events:none;display:none';
      document.body.appendChild(t);
    }
    return t;
  }
  function moveTip(e) {
    const t = tipEl(); const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    const w = t.offsetWidth || 320, h = t.offsetHeight || 120;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
    t.style.left = Math.max(8, x) + 'px'; t.style.top = Math.max(8, y) + 'px';
  }
  function bindMenuTooltips() {
    document.querySelectorAll('.am-row').forEach(r => {
      const vk = r.dataset.key; if (!vk) return;
      r.onmouseenter = () => { const t = tipEl(); const html = menuTipHTML(vk); if (!html) return; t.innerHTML = html; t.style.display = 'block'; };
      r.onmousemove = moveTip;
      r.onmouseleave = () => { const t = document.getElementById('am-tip'); if (t) t.style.display = 'none'; };
    });
  }

  // ── หน้าเต็ม ──
  function rerenderMain() {
    const host = document.getElementById('am-main'); if (!host) return;
    host.innerHTML = MODE === 'base' ? baseEditor() : (empList() + panelHTML());
    document.querySelectorAll('.am-emp').forEach(el => { el.onclick = () => { CUR_EMP = el.dataset.emp; ADD_FILTER = ''; OPEN_DOMS = null; rerenderMain(); }; });
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
      if (tp) tp.onclick = () => { MODE = 'person'; ADD_FILTER = ''; OPEN_DOMS = null; render(); };
      if (tb) tb.onclick = () => { MODE = 'base'; ADD_FILTER = ''; OPEN_DOMS = null; render(); };
      rerenderMain();
    } catch (e) {
      root.innerHTML = `<div style="padding:20px;color:#B91C1C">โหลดไม่สำเร็จ: ${esc(e.message)}<br><small style="color:#94A3B8">ต้องรัน 33_role_access.sql และ login ด้วย owner/hr_director</small></div>`;
    }
  }

  // ── modal (เรียกจากหน้าทะเบียนพนักงาน) ──
  function closeModal() { const m = document.getElementById('am-modal'); if (m) m.remove(); const t = document.getElementById('am-tip'); if (t) t.style.display = 'none'; }
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
      MODE = 'person'; CUR_EMP = empId; ADD_FILTER = ''; OPEN_DOMS = null;
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
