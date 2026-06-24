/* accessreq — HR อนุมัติคำขอเข้าระบบจาก LINE (action requests/approve/reject ของ line_login)
   พนักงานส่งคำขอผ่าน login.html (LIFF) → โผล่คิวที่นี่ → HR เลือกผูกกับพนักงาน + role → อนุมัติ → แจ้งกลับทาง LINE */
(function () {
  const sb = window.sb, esc = window.esc, $ = window.$;
  const ROLES = [
    ['staff', 'พนักงาน (staff)'], ['hr', 'ทรัพยากรบุคคล (hr)'], ['accountant', 'บัญชี (accountant)'],
    ['purchasing', 'จัดซื้อ (purchasing)'], ['director', 'ผู้บริหาร (director)'],
  ];
  let EMP = [];

  async function invoke(action, body) {
    const { data, error } = await sb.functions.invoke('line_login', { body: { action, ...body } });
    if (error) {
      // ดึงข้อความ error จริงจาก response (กรณี 403/401)
      let msg = error.message;
      try { const j = await error.context.json(); if (j.error) msg = j.error + (j.need ? ' (ต้องเป็น ' + j.need + ')' : ''); } catch (e) {}
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error + (data.need ? ' (ต้องเป็น ' + data.need + ')' : ''));
    return data;
  }

  function card(r) {
    const empOpts = '<option value="">— เลือกพนักงาน —</option>' +
      EMP.map(e => `<option value="${esc(e.employee_id)}">${esc(e.full_name || e.employee_id)} · ${esc(e.branch_id || '')}</option>`).join('');
    const roleOpts = ROLES.map(x => `<option value="${x[0]}">${esc(x[1])}</option>`).join('');
    const when = String(r.requested_at || '').replace('T', ' ').slice(0, 16);
    return `<div class="arq" data-uid="${esc(r.uid)}" style="border:1px solid var(--border,#E5E7EB);border-radius:12px;padding:14px 16px;margin-bottom:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
        <div style="font-weight:700;color:var(--navy,#0D2F4F);font-size:15px">${esc(r.full_name || r.display_name || '(ไม่ระบุชื่อ)')}</div>
        <div style="font-size:11px;color:#94A3B8">ขอเมื่อ ${esc(when)}</div>
      </div>
      <div style="font-size:12px;color:#64748B;margin:3px 0 10px">
        LINE: ${esc(r.display_name || '-')} ${r.position ? '· ' + esc(r.position) : ''} ${r.branch_id ? '· สาขา ' + esc(r.branch_id) : ''}
        ${r.note ? '<br>📝 ' + esc(r.note) : ''}
        <div style="font-size:10px;color:#CBD5E1;font-family:monospace;margin-top:2px">${esc(r.uid)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <select class="arq-emp" style="flex:1;min-width:160px;padding:8px 10px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:13px">${empOpts}</select>
        <select class="arq-role" style="padding:8px 10px;border:1px solid var(--border,#E5E7EB);border-radius:8px;font-size:13px">${roleOpts}</select>
        <button class="arq-ok" style="background:#0F766E;color:#fff;border:0;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer">อนุมัติ</button>
        <button class="arq-no" style="background:#fff;color:#B91C1C;border:1px solid #FCA5A5;border-radius:8px;padding:9px 14px;font-size:13px;cursor:pointer">ปฏิเสธ</button>
      </div>
      <div class="arq-msg" style="font-size:12px;margin-top:8px"></div>
    </div>`;
  }

  async function render() {
    const wrap = $('wrap-accreq'); if (!wrap) return;
    wrap.innerHTML = '<div style="padding:24px;color:#94A3B8">กำลังโหลดคิวคำขอ…</div>';
    try {
      // โหลด roster พนักงาน (ให้ HR เลือกผูก) + คิวคำขอ พร้อมกัน
      const [empRes, data] = await Promise.all([
        sb.from('employees').select('employee_id,full_name,branch_id,position').order('full_name').limit(1000),
        invoke('requests', {}),
      ]);
      EMP = empRes.data || [];
      const reqs = data.requests || [];
      const head = `<div class="sec" style="margin:0 0 12px"><span class="sec-bar"></span>คำขอเข้าระบบผ่าน LINE
        <span class="sec-c">${reqs.length} รออนุมัติ</span></div>`;
      if (!reqs.length) {
        wrap.innerHTML = head + '<div style="padding:24px;text-align:center;color:#94A3B8;border:1px dashed var(--border,#E5E7EB);border-radius:12px">— ไม่มีคำขอค้างอนุมัติ —</div>';
        return;
      }
      wrap.innerHTML = head + reqs.map(card).join('');
      wrap.querySelectorAll('.arq').forEach(bindCard);
    } catch (e) {
      wrap.innerHTML = `<div style="padding:20px;color:#B91C1C">โหลดไม่สำเร็จ: ${esc(e.message)}<br><small style="color:#94A3B8">หน้านี้เฉพาะ HR/ผู้ดูแล (ต้องล็อกอินด้วยบัญชีที่มีสิทธิ์)</small></div>`;
    }
  }

  function bindCard(el) {
    const uid = el.dataset.uid;
    const msg = el.querySelector('.arq-msg');
    el.querySelector('.arq-ok').onclick = async () => {
      const employee_id = el.querySelector('.arq-emp').value;
      const role = el.querySelector('.arq-role').value;
      if (!employee_id) { msg.style.color = '#B91C1C'; msg.textContent = 'เลือกพนักงานก่อน'; return; }
      msg.style.color = '#64748B'; msg.textContent = 'กำลังอนุมัติ…';
      try {
        await invoke('approve', { uid, employee_id, role });
        el.style.transition = 'opacity .3s'; el.style.opacity = '.4';
        msg.style.color = '#0F766E'; msg.textContent = '✓ อนุมัติแล้ว · แจ้ง LINE แล้ว';
        setTimeout(render, 700);
      } catch (e) { msg.style.color = '#B91C1C'; msg.textContent = 'ไม่สำเร็จ: ' + e.message; }
    };
    el.querySelector('.arq-no').onclick = async () => {
      const note = prompt('เหตุผลที่ปฏิเสธ (ถ้ามี)?'); if (note === null) return;
      msg.style.color = '#64748B'; msg.textContent = 'กำลังปฏิเสธ…';
      try {
        await invoke('reject', { uid, note });
        el.style.opacity = '.4';
        msg.style.color = '#92400E'; msg.textContent = '✕ ปฏิเสธแล้ว · แจ้ง LINE แล้ว';
        setTimeout(render, 700);
      } catch (e) { msg.style.color = '#B91C1C'; msg.textContent = 'ไม่สำเร็จ: ' + e.message; }
    };
  }

  window.mountAccessReq = render;
})();
