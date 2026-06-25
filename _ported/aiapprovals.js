/* aiapprovals — หน้า "AI Approvals" (คิวงาน AI ที่รอคนกดอนุมัติ)
   list approval_queue ที่ status=pending สำหรับ role ผู้ใช้ (RLS aq_read ใช้ app_role())
   แสดง summary + preview · ปุ่มอนุมัติ/ปฏิเสธ → update approval_queue
     (status, decided_by, decided_by_line, decided_at, decision_note)
   subscribe Realtime ที่ approval_queue ให้เด้งสด
   contract: approval_queue(approval_id, job_id, feature_key, module, approver_role,
                            branch_id, summary, preview jsonb, status, decided_by,
                            decided_by_line, decided_at, decision_note, created_at, expires_at)
   หมายเหตุ: การ "ลงมือจริง" หลังอนุมัติทำที่ EF ai_execute (ฝั่ง service_role) — หน้านี้แค่ตัดสินใจ */
(function () {
  const sb = window.sb, esc = window.esc, $ = window.$;

  let _chan = null;       // realtime channel (กันสมัครซ้ำ)
  let _myUid = null, _myLine = null, _myRole = 'viewer';

  async function whoami() {
    try {
      const { data: u } = await sb.auth.getUser();
      _myUid = (u && u.user && u.user.id) || null;
      // app_staff: role + line_uid ของตัวเอง (RLS app_staff_self)
      if (_myUid) {
        const { data } = await sb.from('app_staff')
          .select('role,line_uid').eq('uid', _myUid).eq('active', true).maybeSingle();
        if (data) { _myRole = data.role || 'viewer'; _myLine = data.line_uid || null; }
      }
    } catch (e) { /* fallback viewer */ }
  }

  function fmtPreview(preview) {
    if (preview == null) return '';
    let txt;
    try { txt = typeof preview === 'string' ? preview : JSON.stringify(preview, null, 2); }
    catch (e) { txt = String(preview); }
    if (txt.length > 1400) txt = txt.slice(0, 1400) + '\n…';
    return `<pre style="margin:8px 0 0;font-size:11.5px;line-height:1.5;color:#475569;background:#F8FAFC;border:1px solid var(--border,#EEF2F6);border-radius:8px;padding:10px 12px;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto">${esc(txt)}</pre>`;
  }

  function card(r) {
    const when = String(r.created_at || '').replace('T', ' ').slice(0, 16);
    const exp = r.expires_at ? `<span style="font-size:11px;color:#B45309">หมดอายุ ${esc(String(r.expires_at).replace('T', ' ').slice(0, 16))}</span>` : '';
    return `<div class="aq" data-id="${esc(r.approval_id)}"
        style="border:1px solid var(--border,#E5E7EB);border-radius:12px;padding:14px 16px;margin-bottom:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:baseline">
        <div style="font-weight:700;color:var(--navy,#0D2F4F);font-size:14.5px">${esc(r.summary || '(ไม่มีสรุป)')}</div>
        <div style="font-size:11px;color:#94A3B8">${esc(when)}</div>
      </div>
      <div style="font-size:11.5px;color:#64748B;margin:4px 0 0;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span style="background:#EFF6FF;color:#1D4ED8;border-radius:5px;padding:1px 7px">${esc(r.module || '')}</span>
        <span style="font-family:monospace">${esc(r.feature_key || '')}</span>
        ${r.branch_id ? '· สาขา ' + esc(r.branch_id) : ''}
        ${exp}
      </div>
      ${fmtPreview(r.preview)}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:11px">
        <button class="aq-ok" style="background:#0F766E;color:#fff;border:0;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer">อนุมัติ</button>
        <button class="aq-no" style="background:#fff;color:#B91C1C;border:1px solid #FCA5A5;border-radius:8px;padding:9px 15px;font-size:13px;cursor:pointer">ปฏิเสธ</button>
        <span class="aq-msg" style="font-size:12px"></span>
      </div>
    </div>`;
  }

  // ── อนุมัติ/ปฏิเสธ: update approval_queue ผ่าน session ผู้ใช้ (RLS aq_decide gate) ──
  // ⚠️ เปลี่ยนได้เฉพาะ pending→approved/rejected และ role ต้องตรง approver_role (หรือ owner)
  async function decide(el, newStatus) {
    const id = el.dataset.id;
    const msg = el.querySelector('.aq-msg');
    let note = null;
    if (newStatus === 'rejected') {
      note = prompt('เหตุผลที่ปฏิเสธ (ถ้ามี)?'); if (note === null) return;
    }
    msg.style.color = '#64748B'; msg.textContent = newStatus === 'approved' ? 'กำลังอนุมัติ…' : 'กำลังปฏิเสธ…';
    try {
      const patch = {
        status: newStatus,
        decided_by: _myUid,
        decided_by_line: _myLine,
        decided_at: new Date().toISOString(),
      };
      if (note != null) patch.decision_note = note;
      // กันแย่งกด: อัปเดตเฉพาะแถวที่ยัง pending
      const { data, error } = await sb.from('approval_queue')
        .update(patch).eq('approval_id', id).eq('status', 'pending').select('approval_id');
      if (error) throw new Error(error.message);
      if (!data || !data.length) throw new Error('งานนี้ถูกตัดสินใจไปแล้ว');
      el.style.transition = 'opacity .3s'; el.style.opacity = '.4';
      // ── ลงมือจริง: เรียก EF ai_execute (supabase-js แนบ session JWT ให้อัตโนมัติ) — เส้น dashboard ที่เคยขาด (Blocker A) ──
      let exNote = '';
      try {
        const { data: ex, error: exErr } = await sb.functions.invoke('ai_execute', { body: { approval_id: id, decided_by_line: _myLine } });
        if (exErr) exNote = ' (ai_execute: ' + exErr.message + ')';
        else if (ex && ex.error) exNote = ' (ai_execute: ' + ex.error + ')';
      } catch (ex2) { exNote = ' (ai_execute เรียกไม่ได้: ' + ex2.message + ')'; }
      msg.style.color = newStatus === 'approved' ? '#0F766E' : '#92400E';
      msg.textContent = (newStatus === 'approved' ? '✓ อนุมัติแล้ว · ลงมือแล้ว' : '✕ ปฏิเสธแล้ว') + exNote;
      setTimeout(load, 900);
    } catch (e) {
      msg.style.color = '#B91C1C'; msg.textContent = 'ไม่สำเร็จ: ' + e.message;
    }
  }

  function bind(el) {
    el.querySelector('.aq-ok').onclick = () => decide(el, 'approved');
    el.querySelector('.aq-no').onclick = () => decide(el, 'rejected');
  }

  // ── badge sidebar: จำนวนคิวรออนุมัติ (เด้งสดแม้อยู่หน้าอื่น) · ซ่อนเมื่อ 0 ──
  function setBadge(n) {
    const el = document.getElementById('ct-aiapprovals');
    if (!el) return;
    if (n > 0) { el.textContent = String(n); el.style.display = ''; }
    else { el.textContent = ''; el.style.display = 'none'; }
  }

  async function load() {
    // หมายเหตุ: ไม่ guard ด้วย wrap ตรงนี้ เพราะ badge ต้องอัปเดตแม้ผู้ใช้อยู่หน้าอื่น
    //   (realtime handler ก็เรียก load() → badge เด้งสด); การ render การ์ดยัง guard ด้วย wrap ด้านล่าง
    try {
      // RLS aq_read กรองให้เห็นเฉพาะ approver_role ตรง (หรือ owner) อยู่แล้ว
      // เพิ่ม .eq('status','pending') เพื่อโชว์เฉพาะที่รอ
      const { data, error } = await sb.from('approval_queue')
        .select('approval_id,job_id,feature_key,module,approver_role,branch_id,summary,preview,status,created_at,expires_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const rows = data || [];
      setBadge(rows.length);  // อัปเดต badge sidebar ทุกครั้ง (clear/ซ่อนเมื่อ 0)
      const wrap = $('wrap-aiapprovals'); if (!wrap) return;  // ไม่ได้อยู่หน้านี้ → จบแค่ badge
      const head = `<div class="sec" style="margin:0 0 12px"><span class="sec-bar"></span>คิวงาน AI รออนุมัติ
        <span class="sec-c"><span class="dot"></span>${rows.length} รออนุมัติ · role ${esc(_myRole)}</span></div>`;
      if (!rows.length) {
        wrap.innerHTML = head + '<div style="padding:24px;text-align:center;color:#94A3B8;border:1px dashed var(--border,#E5E7EB);border-radius:12px">— ไม่มีงานค้างอนุมัติ —</div>';
        return;
      }
      wrap.innerHTML = head + rows.map(card).join('');
      wrap.querySelectorAll('.aq').forEach(bind);
    } catch (e) {
      // re-lookup wrap (block-scoped ใน try แล้ว) — แสดง error เฉพาะถ้าอยู่หน้านี้
      const w = $('wrap-aiapprovals'); if (!w) return;
      w.innerHTML = `<div style="padding:20px;color:#B91C1C">โหลดไม่สำเร็จ: ${esc(e.message)}
        <br><small style="color:#94A3B8">ต้องล็อกอินด้วยบัญชีที่มีสิทธิ์อนุมัติ (app_staff role ตรง approver_role)</small></div>`;
    }
  }

  // ── Realtime: approval_queue เปลี่ยน → โหลดใหม่ (สมัครครั้งเดียว, reuse channel) ──
  function subscribe() {
    if (_chan) return;
    _chan = sb.channel('aq-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_queue' }, () => load())
      .subscribe();
  }

  async function render() {
    const wrap = $('wrap-aiapprovals'); if (!wrap) return;
    wrap.innerHTML = '<div style="padding:24px;color:#94A3B8">กำลังโหลดคิวอนุมัติ…</div>';
    await whoami();
    await load();
    subscribe();
  }

  window.mountAiApprovals = render;
})();
