/* aisettings — หน้า "AI Settings" (AI Operator control plane)
   ซอย 3 ชั้น: โดเมน (content/finance/hr) → ตำแหน่งงาน (position_key) → งานย่อย (feature)
   แต่ละงานย่อย: toggle "ให้ AI แทน" (enabled) + ระดับ automation_level 0..3
     (ห้ามเกิน max_level → disable ตัวที่เกิน เช่น เผยแพร่≤1, จ่ายเงิน=0)
   แต่ละตำแหน่ง: master toggle "เปิด AI ทั้งตำแหน่ง" (กดทีเดียวเปิด/ปิดทุกงานในตำแหน่ง)
   เซฟผ่าน session ผู้ใช้ (RLS fs_write: เฉพาะ owner/controller แก้ได้) · role อื่น = อ่านอย่างเดียว
   contract: feature_settings(feature_key, module, position_key, position_label, label,
                              automation_level, max_level, approver_role, enabled, sort_order) */
(function () {
  const sb = window.sb, esc = window.esc, $ = window.$;

  // โดเมน + ป้ายหัวข้อ + จำนวนคนปัจจุบัน→เป้า (ตามแผน AI Operator ลด 6→2)
  const MODULES = [
    ['content', '🎨 Content · คอนเทนต์', 'ปัจจุบัน 4 คน → เป้า 1'],
    ['finance', '💰 Finance · บัญชี/จัดซื้อ', 'ปัจจุบัน 1 คน'],
    ['hr', '👥 HR · บุคคล', 'ปัจจุบัน 1 คน'],
  ];
  // ป้าย/ไอคอนรายตำแหน่ง (display เฉย ๆ — ความจริงอยู่ที่ position_label ใน DB)
  // 🔴 = ตำแหน่งมีงานแตะข้อมูลอ่อนไหว/เงิน ควรคงคนคุม
  const POS_META = {
    // 🎨 Content / Marketing
    content_strategist: { icon: '🧭', note: 'วางแผน/กลยุทธ์คอนเทนต์' },
    content_copywriter: { icon: '✍️', note: 'เขียน+SEO+พิสูจน์อักษร' },
    content_designer:   { icon: '🎨', note: 'กราฟิก/ภาพ/อินโฟ' },
    video_editor:      { icon: '🎬', note: 'สคริปต์+ตัดต่อคลิป' },
    social_admin:      { icon: '📣', note: 'ลงโพสต์ + ดูแลเพจ 🔴แชท' },
    ad_optimizer:      { icon: '🎯', note: 'ยิงแอด 🔴คุมงบ' },
    lead_followup:     { icon: '🤝', note: 'ดูแล lead 🔴ข้อมูลลูกค้า' },
    // 💰 Finance
    accountant_ar:  { icon: '🧾', note: 'บัญชีรายรับ' },
    accountant_ap:  { icon: '💸', note: 'บัญชีรายจ่าย 🔴จ่ายเงินล็อก' },
    accountant_tax: { icon: '📊', note: 'ภาษี/ปิดงบ/ไฟล์โอน' },
    cashier_petty:  { icon: '🪙', note: 'การเงิน/เงินสดย่อย' },
    purchaser:      { icon: '🛒', note: 'จัดซื้อ/ผู้ขาย' },
    inventory_keeper:{ icon: '📦', note: 'สต็อก/คลังยา 🔴หมดอายุ' },
    // 👥 HR
    hr_recruiter:  { icon: '🧑‍💼', note: 'สรรหา/สัมภาษณ์' },
    hr_operations: { icon: '📋', note: 'บุคคลทั่วไป/เอกสาร' },
    hr_time:       { icon: '⏰', note: 'เวลา/ลา/OT/เวร' },
    hr_payroll:    { icon: '💵', note: 'เงินเดือน 🔴จ่ายล็อก' },
    hr_engagement: { icon: '🌱', note: 'survey/KPI/อบรม' },
  };
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
    return `<label class="fs-tog" data-key="${esc(r.feature_key)}"
      style="display:inline-flex;align-items:center;gap:7px;cursor:${CAN_WRITE ? 'pointer' : 'default'};font-size:12px;color:#64748B">
      <input type="checkbox" class="fs-en" ${on ? 'checked' : ''} ${CAN_WRITE ? '' : 'disabled'}
        style="width:16px;height:16px;accent-color:#0F766E;cursor:inherit">
      <span class="fs-en-lbl" style="font-weight:600;color:${on ? '#0F766E' : '#94A3B8'}">${on ? 'AI แทน' : 'ปิด'}</span>
    </label>`;
  }

  function row(r) {
    const locked = Number(r.max_level) < 3
      ? `<span style="font-size:10px;color:#B45309;background:#FEF3C7;border-radius:5px;padding:1px 6px;margin-left:6px">เพดาน ≤${esc(r.max_level)}</span>`
      : '';
    return `<div class="fs-row" data-key="${esc(r.feature_key)}" data-pos="${esc(r.position_key || '')}"
        style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:11px 14px;border-bottom:1px solid var(--border,#EEF2F6)">
      <div style="flex:1;min-width:190px">
        <div style="font-weight:600;color:var(--navy,#0D2F4F);font-size:13px">${esc(r.label || r.feature_key)}${locked}</div>
        <div style="font-size:10px;color:#94A3B8;font-family:monospace;margin-top:1px">${esc(r.feature_key)}</div>
      </div>
      <div style="font-size:11px;color:#64748B;min-width:110px">
        ผู้อนุมัติ: <b style="color:#475569">${esc(r.approver_role || '— ไม่ต้อง —')}</b>
      </div>
      ${levelSelect(r)}
      ${toggle(r)}
      <span class="fs-msg" style="font-size:11px;min-width:54px"></span>
    </div>`;
  }

  // การ์ด 1 ตำแหน่ง = หัวตำแหน่ง (+ master toggle) + งานย่อยทั้งหมด
  function positionCard(posKey, posLabel, rows) {
    const meta = POS_META[posKey] || { icon: '🧩', note: '' };
    const onCount = rows.filter(r => r.enabled === true).length;
    const masterOn = onCount === rows.length && rows.length > 0;
    const someOn = onCount > 0 && !masterOn;
    const master = CAN_WRITE
      ? `<label class="fs-master" data-pos="${esc(posKey)}"
           style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:11.5px;color:#0F766E;font-weight:600">
           <input type="checkbox" class="fs-master-cb" ${masterOn ? 'checked' : ''}
             style="width:15px;height:15px;accent-color:#0F766E">เปิด AI ทั้งตำแหน่ง</label>`
      : '';
    const badge = `<span class="fs-pos-badge" style="font-size:10.5px;color:${onCount ? '#0F766E' : '#94A3B8'};background:${onCount ? '#ECFDF5' : '#F1F5F9'};border-radius:6px;padding:2px 8px;font-weight:600">
        AI แทน ${onCount}/${rows.length} งาน${someOn ? ' (บางส่วน)' : ''}</span>`;
    return `<div class="card" style="margin-bottom:12px;overflow:hidden">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 14px;background:var(--bg-soft,#F8FAFC);border-bottom:1px solid var(--border,#EEF2F6)">
        <div style="flex:1;min-width:200px">
          <div style="font-weight:700;color:var(--navy,#0D2F4F);font-size:14px">${meta.icon} ${esc(posLabel || posKey)}</div>
          <div style="font-size:11px;color:#94A3B8;margin-top:1px">${esc(meta.note)}</div>
        </div>
        ${badge}
        ${master}
      </div>
      ${rows.map(row).join('')}
    </div>`;
  }

  // 1 โดเมน = หัวโดเมน + การ์ดทุกตำแหน่งในโดเมนนั้น (เรียงตาม sort_order)
  function domainBlock(modKey, label, headcount, rows) {
    if (!rows.length) return '';
    // จัดกลุ่มตาม position_key คงลำดับการพบ (rows มาเรียง sort_order แล้ว)
    const order = [];
    const byPos = {};
    rows.forEach(r => {
      const pk = r.position_key || 'other';
      if (!byPos[pk]) { byPos[pk] = []; order.push(pk); }
      byPos[pk].push(r);
    });
    const cards = order.map(pk => positionCard(pk, byPos[pk][0].position_label, byPos[pk])).join('');
    return `<div class="sec" style="margin:20px 2px 10px">
        <span class="sec-bar"></span>${esc(label)}
        <span class="sec-c">${esc(headcount)} · ${rows.length} งาน</span></div>
      ${cards}`;
  }

  // ── เซฟ 1 ฟิลด์ (enabled หรือ automation_level) ผ่าน session ผู้ใช้ (RLS gate fs_write) ──
  async function saveField(key, patch, rowEl) {
    const msg = rowEl && rowEl.querySelector('.fs-msg');
    if (msg) { msg.style.color = '#64748B'; msg.textContent = 'กำลังบันทึก…'; }
    try {
      try {
        const { data: u } = await sb.auth.getUser();
        const uid = u && u.user && u.user.id;
        if (uid) patch = { ...patch, updated_by: uid };
      } catch (e) { /* ไม่มี uid → ข้าม */ }
      const { error } = await sb.from('feature_settings').update(patch).eq('feature_key', key);
      if (error) throw new Error(error.message);
      if (msg) {
        msg.style.color = '#0F766E'; msg.textContent = '✓ บันทึก';
        setTimeout(() => { if (msg.textContent === '✓ บันทึก') msg.textContent = ''; }, 1800);
      }
      return true;
    } catch (e) {
      if (msg) { msg.style.color = '#B91C1C'; msg.textContent = 'ไม่สำเร็จ'; }
      console.error('saveField', key, e);
      return false;
    }
  }

  // อัปเดต badge "AI แทน x/y งาน" + สถานะ master ของการ์ดตำแหน่ง หลังมีการเปลี่ยน
  function refreshPosCard(cardEl) {
    const boxes = [...cardEl.querySelectorAll('.fs-en')];
    const on = boxes.filter(b => b.checked).length;
    const badge = cardEl.querySelector('.fs-pos-badge');
    if (badge) {
      const some = on > 0 && on < boxes.length;
      badge.textContent = `AI แทน ${on}/${boxes.length} งาน${some ? ' (บางส่วน)' : ''}`;
      badge.style.color = on ? '#0F766E' : '#94A3B8';
      badge.style.background = on ? '#ECFDF5' : '#F1F5F9';
    }
    const master = cardEl.querySelector('.fs-master-cb');
    if (master) { master.checked = on === boxes.length && boxes.length > 0; }
  }

  function setRowLabel(cb) {
    const rowEl = cb.closest('.fs-row');
    const lbl = rowEl.querySelector('.fs-en-lbl');
    lbl.textContent = cb.checked ? 'AI แทน' : 'ปิด';
    lbl.style.color = cb.checked ? '#0F766E' : '#94A3B8';
  }

  function bind(wrap) {
    if (!CAN_WRITE) return; // read-only: ไม่ผูก event
    // toggle รายงาน
    wrap.querySelectorAll('.fs-en').forEach(cb => {
      cb.onchange = () => {
        const rowEl = cb.closest('.fs-row'); const key = rowEl.dataset.key;
        setRowLabel(cb);
        saveField(key, { enabled: cb.checked }, rowEl);
        refreshPosCard(cb.closest('.card'));
      };
    });
    // เลือก level
    wrap.querySelectorAll('.fs-level').forEach(sel => {
      sel.onchange = () => {
        const rowEl = sel.closest('.fs-row'); const key = rowEl.dataset.key;
        saveField(key, { automation_level: Number(sel.value) }, rowEl);
      };
    });
    // master toggle ทั้งตำแหน่ง — เปิด/ปิดทุกงานในการ์ด (ข้ามตัวที่ค่าตรงอยู่แล้ว)
    wrap.querySelectorAll('.fs-master-cb').forEach(mcb => {
      mcb.onchange = async () => {
        const cardEl = mcb.closest('.card');
        const want = mcb.checked;
        const boxes = [...cardEl.querySelectorAll('.fs-en')];
        for (const cb of boxes) {
          if (cb.checked === want) continue;
          cb.checked = want;
          setRowLabel(cb);
          const rowEl = cb.closest('.fs-row');
          await saveField(rowEl.dataset.key, { enabled: want }, rowEl);
        }
        refreshPosCard(cardEl);
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
        .select('feature_key,module,position_key,position_label,label,automation_level,max_level,approver_role,enabled,sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = data || [];

      const totalOn = rows.filter(r => r.enabled === true).length;
      const banner = CAN_WRITE
        ? `<div style="font-size:12px;color:#0F766E;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:9px 13px;margin-bottom:6px">
            ✓ สิทธิ์ <b>${esc(role)}</b> · ปรับ toggle และระดับอัตโนมัติได้ · เปิดให้ AI แทนอยู่ <b>${totalOn}/${rows.length}</b> งาน</div>`
        : `<div style="font-size:12px;color:#92400E;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:9px 13px;margin-bottom:6px">
            👁 สิทธิ์ <b>${esc(role)}</b> · อ่านอย่างเดียว — เฉพาะ owner/controller แก้ได้</div>`;
      const legend = `<div style="font-size:11px;color:#94A3B8;margin:0 2px 8px;line-height:1.6">
        ระดับ: <b>0</b> ปิด · <b>1</b> AI ร่างให้คนตรวจ · <b>2</b> AI ทำ+รออนุมัติ · <b>3</b> AI ทำเองอัตโนมัติ ·
        <span style="color:#B45309">เพดาน ≤n</span> = งานเสี่ยง ล็อกไม่ให้ดันเกิน (จ่ายเงิน/เผยแพร่)</div>`;

      let html = banner + legend;
      MODULES.forEach(([mk, lbl, hc]) => {
        html += domainBlock(mk, lbl, hc, rows.filter(r => r.module === mk));
      });
      const known = MODULES.map(m => m[0]);
      const other = rows.filter(r => !known.includes(r.module));
      if (other.length) html += domainBlock('other', '🧩 อื่น ๆ', '', other);

      wrap.innerHTML = html || '<div style="padding:24px;color:#94A3B8">— ยังไม่มี feature ในระบบ —</div>';
      bind(wrap);
    } catch (e) {
      wrap.innerHTML = `<div style="padding:20px;color:#B91C1C">โหลดไม่สำเร็จ: ${esc(e.message)}
        <br><small style="color:#94A3B8">ต้องล็อกอินด้วยบัญชีที่ผูกใน app_staff · และต้องรัน schema 30_ai_operator.sql บน Supabase ก่อน</small></div>`;
    }
  }

  window.mountAiSettings = render;
})();
