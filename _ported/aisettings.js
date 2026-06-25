/* aisettings — หน้า "AI Settings" (AI Operator control plane)
   ตาราง feature_settings จัดกลุ่มตาม module (content/finance/hr)
   แต่ละแถว: toggle enabled + เลือก automation_level 0..3 (ห้ามเกิน max_level → disable ตัวที่เกิน)
   + แสดง approver_role · เซฟผ่าน session ผู้ใช้ (RLS: เฉพาะ owner/controller แก้ได้)
   ถ้า role อื่น → แสดงอ่านอย่างเดียว (read-only)
   contract: feature_settings(feature_key, module, label, automation_level, max_level,
                               approver_role, enabled, sort_order) + helper app_role() */
(function () {
  const sb = window.sb, esc = window.esc, $ = window.$;

  // โมดูล + ป้ายหัวข้อ (ตามลำดับใน schema)
  const MODULES = [
    ['content', '🎨 Content · คอนเทนต์'],
    ['finance', '💰 Finance · การเงิน/จัดซื้อ'],
    ['hr', '👥 HR · บุคคล'],
  ];
  // คำอธิบาย automation_level (0..3)
  const LEVELS = [
    ['0', 'ปิด'],
    ['1', 'ร่าง'],
    ['2', 'ทำ+รออนุมัติ'],
    ['3', 'auto'],
  ];

  let CAN_WRITE = false; // owner/controller เท่านั้น (เช็คจาก app_role())

  // ── อ่าน role จริงของผู้ใช้จาก app_staff (ไม่ใช่ currentRole ของ dashboard) ──
  async function myAppRole() {
    try {
      const { data: u } = await sb.auth.getUser();
      const uid = u && u.user && u.user.id;
      if (!uid) return 'viewer';
      // RLS app_staff_self อนุญาตให้เห็นแถวตัวเอง
      const { data } = await sb.from('app_staff').select('role').eq('uid', uid).eq('active', true).maybeSingle();
      return (data && data.role) || 'viewer';
    } catch (e) { return 'viewer'; }
  }

  function levelSelect(r) {
    // ตัวเลือก level: disable ตัวที่ > max_level (ล็อกงานเสี่ยง เช่น publish≤1, จ่ายเงิน=0)
    const opts = LEVELS.map(([v, txt]) => {
      const n = Number(v);
      const over = n > Number(r.max_level);
      const sel = n === Number(r.automation_level) ? ' selected' : '';
      const dis = over ? ' disabled' : '';
      const hint = over ? ' (เกินเพดาน)' : '';
      return `<option value="${v}"${sel}${dis}>${v} · ${esc(txt)}${hint}</option>`;
    }).join('');
    const disAttr = CAN_WRITE ? '' : ' disabled';
    return `<select class="fs-level" data-key="${esc(r.feature_key)}"${disAttr}
      style="padding:7px 9px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:12.5px;min-width:130px">${opts}</select>`;
  }

  function toggle(r) {
    const on = r.enabled === true;
    const disAttr = CAN_WRITE ? '' : ' style="opacity:.5;pointer-events:none"';
    return `<label class="fs-tog" data-key="${esc(r.feature_key)}"${disAttr}
      style="display:inline-flex;align-items:center;gap:7px;cursor:${CAN_WRITE ? 'pointer' : 'default'};font-size:12px;color:#64748B">
      <input type="checkbox" class="fs-en" ${on ? 'checked' : ''} ${CAN_WRITE ? '' : 'disabled'}
        style="width:16px;height:16px;accent-color:#0F766E;cursor:inherit">
      <span class="fs-en-lbl" style="font-weight:600;color:${on ? '#0F766E' : '#94A3B8'}">${on ? 'เปิด' : 'ปิด'}</span>
    </label>`;
  }

  function row(r) {
    const locked = Number(r.max_level) < 3
      ? `<span style="font-size:10px;color:#B45309;background:#FEF3C7;border-radius:5px;padding:1px 6px;margin-left:6px">เพดาน ≤${esc(r.max_level)}</span>`
      : '';
    return `<div class="fs-row" data-key="${esc(r.feature_key)}"
        style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid var(--border,#EEF2F6)">
      <div style="flex:1;min-width:200px">
        <div style="font-weight:600;color:var(--navy,#0D2F4F);font-size:13.5px">${esc(r.label || r.feature_key)}${locked}</div>
        <div style="font-size:10.5px;color:#94A3B8;font-family:monospace;margin-top:1px">${esc(r.feature_key)}</div>
      </div>
      <div style="font-size:11.5px;color:#64748B;min-width:120px">
        ผู้อนุมัติ: <b style="color:#475569">${esc(r.approver_role || '— ไม่ต้อง —')}</b>
      </div>
      ${levelSelect(r)}
      ${toggle(r)}
      <span class="fs-msg" style="font-size:11px;min-width:60px"></span>
    </div>`;
  }

  function group(modKey, label, rows) {
    if (!rows.length) return '';
    return `<div class="sec" style="margin:18px 2px 8px"><span class="sec-bar"></span>${esc(label)}
        <span class="sec-c">${rows.length} feature</span></div>
      <div class="card" style="margin-bottom:4px">${rows.map(row).join('')}</div>`;
  }

  // ── เซฟ 1 ฟิลด์ (enabled หรือ automation_level) ผ่าน session ผู้ใช้ (RLS gate fs_write) ──
  async function saveField(key, patch, rowEl) {
    const msg = rowEl.querySelector('.fs-msg');
    msg.style.color = '#64748B'; msg.textContent = 'กำลังบันทึก…';
    try {
      // updated_by: บันทึก uid ผู้แก้ (column เขียนได้ผ่าน fs_write owner/controller)
      try {
        const { data: u } = await sb.auth.getUser();
        const uid = u && u.user && u.user.id;
        if (uid) patch = { ...patch, updated_by: uid };
      } catch (e) { /* ไม่มี uid → ข้าม ปล่อยให้ patch เดิม */ }
      const { error } = await sb.from('feature_settings').update(patch).eq('feature_key', key);
      if (error) throw new Error(error.message);
      msg.style.color = '#0F766E'; msg.textContent = '✓ บันทึก';
      setTimeout(() => { if (msg.textContent === '✓ บันทึก') msg.textContent = ''; }, 1800);
    } catch (e) {
      msg.style.color = '#B91C1C'; msg.textContent = 'ไม่สำเร็จ';
      console.error('saveField', key, e);
    }
  }

  function bind(wrap) {
    if (!CAN_WRITE) return; // read-only: ไม่ผูก event
    wrap.querySelectorAll('.fs-en').forEach(cb => {
      cb.onchange = () => {
        const rowEl = cb.closest('.fs-row'); const key = rowEl.dataset.key;
        const lbl = rowEl.querySelector('.fs-en-lbl');
        lbl.textContent = cb.checked ? 'เปิด' : 'ปิด';
        lbl.style.color = cb.checked ? '#0F766E' : '#94A3B8';
        saveField(key, { enabled: cb.checked }, rowEl);
      };
    });
    wrap.querySelectorAll('.fs-level').forEach(sel => {
      sel.onchange = () => {
        const rowEl = sel.closest('.fs-row'); const key = rowEl.dataset.key;
        saveField(key, { automation_level: Number(sel.value) }, rowEl);
      };
    });
  }

  async function render() {
    const wrap = $('wrap-aisettings'); if (!wrap) return;
    wrap.innerHTML = '<div style="padding:24px;color:#94A3B8">กำลังโหลดการตั้งค่า AI…</div>';
    try {
      const role = await myAppRole();
      CAN_WRITE = (role === 'owner' || role === 'controller');
      // RLS fs_read อนุญาตให้ทุกคน login อ่านได้
      const { data, error } = await sb.from('feature_settings')
        .select('feature_key,module,label,automation_level,max_level,approver_role,enabled,sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = data || [];

      const banner = CAN_WRITE
        ? `<div style="font-size:12px;color:#0F766E;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:9px 13px;margin-bottom:6px">
            ✓ สิทธิ์ <b>${esc(role)}</b> · ปรับ toggle และระดับอัตโนมัติได้</div>`
        : `<div style="font-size:12px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:9px 13px;margin-bottom:6px">
            👁 สิทธิ์ <b>${esc(role)}</b> · อ่านอย่างเดียว — เฉพาะ owner/controller แก้ได้</div>`;

      let html = banner;
      MODULES.forEach(([mk, lbl]) => {
        html += group(mk, lbl, rows.filter(r => r.module === mk));
      });
      // เผื่อ module นอกเหนือ 3 ตัวหลัก (กันตกหล่น)
      const known = MODULES.map(m => m[0]);
      const other = rows.filter(r => !known.includes(r.module));
      if (other.length) html += group('other', 'อื่น ๆ', other);

      wrap.innerHTML = html || '<div style="padding:24px;color:#94A3B8">— ยังไม่มี feature ในระบบ —</div>';
      bind(wrap);
    } catch (e) {
      wrap.innerHTML = `<div style="padding:20px;color:#B91C1C">โหลดไม่สำเร็จ: ${esc(e.message)}
        <br><small style="color:#94A3B8">ต้องล็อกอินด้วยบัญชีที่ผูกใน app_staff</small></div>`;
    }
  }

  window.mountAiSettings = render;
})();
