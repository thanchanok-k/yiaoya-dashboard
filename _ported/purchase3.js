/* ===== Purchase Wave 3/4/5 — สต็อก + bridge บัญชี + LINE preview =====
   ใช้ helper/purGet จาก purchase.js/purchase2.js · edge fn: pur_stock · pur_po(request_payment) · pur_line_digest  */

function psFld(id,ph,type){ return `<input id="${id}" ${type?`type="${type}"`:''} placeholder="${ph||''}" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">`; }

/* ---------- สต็อก (Stock) ---------- */
function mountPurStock(){
  const w=$('wrap-purstock'); if(!w) return;
  w.innerHTML=`
   <div id="pstAlert"></div>
   <div class="card" style="padding:16px;margin-bottom:14px">
     <div style="font-weight:700;margin-bottom:10px;color:var(--navy)">บันทึกความเคลื่อนไหวสต็อก</div>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
       <div style="border:1px solid var(--border);border-radius:9px;padding:12px">
         <div style="font-size:12.5px;font-weight:700;color:#065F46;margin-bottom:7px">📥 รับเข้า (สร้าง lot)</div>
         <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">${psFld('stRcItem','รหัสสินค้า')}${psFld('stRcBranch','สาขา')}${psFld('stRcLot','เลข lot')}${psFld('stRcExp','วันหมดอายุ','date')}${psFld('stRcQty','จำนวน','number')}</div>
         <button id="stRcBtn" style="padding:7px 14px;background:var(--teal);color:#04342C;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">รับเข้า</button> <span id="stRcMsg" style="font-size:11.5px;color:var(--text-muted)"></span>
       </div>
       <div style="border:1px solid var(--border);border-radius:9px;padding:12px">
         <div style="font-size:12.5px;font-weight:700;color:#991B1B;margin-bottom:7px">📤 เบิกออก</div>
         <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">${psFld('stIsItem','รหัสสินค้า')}${psFld('stIsBranch','สาขา')}${psFld('stIsLot','lot_id (ถ้ามี)')}${psFld('stIsQty','จำนวน','number')}</div>
         <button id="stIsBtn" style="padding:7px 14px;background:#FEE2E2;color:#991B1B;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">เบิก</button> <span id="stIsMsg" style="font-size:11.5px;color:var(--text-muted)"></span>
       </div>
       <div style="border:1px solid var(--border);border-radius:9px;padding:12px">
         <div style="font-size:12.5px;font-weight:700;color:#1E40AF;margin-bottom:7px">🔄 โอนระหว่างสาขา</div>
         <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">${psFld('stTrItem','รหัสสินค้า')}${psFld('stTrLot','lot_id (ถ้ามี)')}${psFld('stTrFrom','จากสาขา')}${psFld('stTrTo','ไปสาขา')}${psFld('stTrQty','จำนวน','number')}</div>
         <button id="stTrBtn" style="padding:7px 14px;background:#EFF6FF;color:#1E40AF;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">โอน</button> <span id="stTrMsg" style="font-size:11.5px;color:var(--text-muted)"></span>
       </div>
       <div style="border:1px solid var(--border);border-radius:9px;padding:12px">
         <div style="font-size:12.5px;font-weight:700;color:#92400E;margin-bottom:7px">📋 นับสต็อก (ปรับยอด)</div>
         <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">${psFld('stTkItem','รหัสสินค้า')}${psFld('stTkBranch','สาขา')}${psFld('stTkLot','lot_id (ถ้ามี)')}${psFld('stTkCount','นับได้จริง','number')}</div>
         <button id="stTkBtn" style="padding:7px 14px;background:#FEF3C7;color:#92400E;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">บันทึกการนับ</button> <span id="stTkMsg" style="font-size:11.5px;color:var(--text-muted)"></span>
       </div>
     </div>
   </div>
   <div class="sec" style="margin-bottom:8px"><span class="sec-bar"></span>คงเหลือในสต็อก</div>
   <div id="pstBal">กำลังโหลด…</div>`;
  $('stRcBtn').onclick=async()=>{ const{data,error}=await sb.functions.invoke('pur_stock',{body:{action:'create_lot',item_id:$('stRcItem').value.trim(),branch_id:$('stRcBranch').value.trim(),lot_number:$('stRcLot').value.trim(),expiry_date:$('stRcExp').value,initial_qty:Number($('stRcQty').value)||0}}); $('stRcMsg').textContent=error||data?.error?('ผิดพลาด'):(`สร้าง ${data.lot_id} ✓`); loadPurStock(); };
  $('stIsBtn').onclick=async()=>{ const{data,error}=await sb.functions.invoke('pur_stock',{body:{action:'issue',branch_id:$('stIsBranch').value.trim(),lines:[{item_id:$('stIsItem').value.trim(),lot_id:$('stIsLot').value.trim()||undefined,qty:Number($('stIsQty').value)||0}]}}); $('stIsMsg').textContent=error||data?.error?('ผิดพลาด'):('เบิกแล้ว ✓'); loadPurStock(); };
  $('stTrBtn').onclick=async()=>{ const{data,error}=await sb.functions.invoke('pur_stock',{body:{action:'transfer',from_branch:$('stTrFrom').value.trim(),to_branch:$('stTrTo').value.trim(),lines:[{item_id:$('stTrItem').value.trim(),lot_id:$('stTrLot').value.trim()||undefined,qty:Number($('stTrQty').value)||0}]}}); $('stTrMsg').textContent=error||data?.error?('ผิดพลาด'):('โอนแล้ว ✓'); loadPurStock(); };
  $('stTkBtn').onclick=async()=>{ const{data,error}=await sb.functions.invoke('pur_stock',{body:{action:'stocktake',branch_id:$('stTkBranch').value.trim(),lines:[{item_id:$('stTkItem').value.trim(),lot_id:$('stTkLot').value.trim()||undefined,counted_qty:Number($('stTkCount').value)||0}]}}); $('stTkMsg').textContent=error||data?.error?('ผิดพลาด'):(`ปรับ variance ${(data.adjustments||[]).map(a=>a.variance).join(',')||0} ✓`); loadPurStock(); };
  loadPurStock();
}
async function loadPurStock(){
  const [bal,al]=await Promise.all([purGet('pur_stock?balance=1'),purGet('pur_stock?alerts=1&days=60')]);
  const balances=(bal&&bal.balances)||[]; const low=(al&&al.low_stock)||[]; const exp=(al&&al.expiring)||[];
  $('pstAlert').innerHTML=`<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
    <div class="stat" style="flex:1;min-width:130px"><div class="stat-n">${balances.length}</div><div class="stat-l">SKU มีของ</div></div>
    <div class="stat" style="flex:1;min-width:130px"><div class="stat-n" style="color:${low.length?'#991B1B':'var(--navy)'}">${low.length}</div><div class="stat-l">ต่ำกว่าขั้นต่ำ</div></div>
    <div class="stat" style="flex:1;min-width:130px"><div class="stat-n" style="color:${exp.length?'#92400E':'var(--navy)'}">${exp.length}</div><div class="stat-l">ใกล้หมดอายุ (60วัน)</div></div>
    <div class="stat" style="flex:1;min-width:130px;display:flex;align-items:center;justify-content:center"><button id="pstLine" style="padding:8px 14px;background:#06C755;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">พรีวิวแจ้งเตือน LINE</button></div></div>
    ${exp.length?`<div class="card" style="padding:12px;margin-bottom:12px;border-left:3px solid #F59E0B"><div style="font-weight:700;color:#92400E;font-size:13px;margin-bottom:6px">⚠️ ใกล้หมดอายุ</div>${exp.map(e=>`<div style="font-size:12px;padding:3px 0">${esc(e.item_name||e.item_id)} · lot ${esc(e.lot_number||e.lot_id)} · เหลือ ${e.days_left} วัน · คงเหลือ ${e.qty_on_hand}</div>`).join('')}</div>`:''}
    ${low.length?`<div class="card" style="padding:12px;margin-bottom:12px;border-left:3px solid #EF4444"><div style="font-weight:700;color:#991B1B;font-size:13px;margin-bottom:6px">🔻 ต่ำกว่าขั้นต่ำ</div>${low.map(e=>`<div style="font-size:12px;padding:3px 0">${esc(e.item_name||e.item_id)} @ ${esc(e.branch_id)} · เหลือ ${e.qty_on_hand} (ขั้นต่ำ ${e.min_stock})</div>`).join('')}</div>`:''}`;
  $('pstLine').onclick=async()=>{ const d=await purGet('pur_line_digest?dry=1'); alert('พรีวิวข้อความ LINE:\n\n'+(d.preview||JSON.stringify(d))+'\n\n'+(d.reason==='ยังไม่ตั้ง LINE_TOKEN_PUR'?'(ยังไม่ส่งจริง — ต้องตั้ง LINE_TOKEN_PUR ก่อน)':'')); };
  if(!balances.length){$('pstBal').innerHTML='<div class="card" style="padding:18px;text-align:center;color:var(--text-muted)">ยังไม่มีของในสต็อก</div>';return;}
  $('pstBal').innerHTML=`<div class="card" style="padding:6px 14px">${balances.map(b=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
     <span>${esc(b.item_name||b.item_id)} <span style="color:var(--text-muted)">@ ${esc(b.branch_id)}${b.lot_number?' · lot '+esc(b.lot_number):''}${b.expiry_date?' · exp '+esc(b.expiry_date):''}</span></span>
     <b style="color:${b.qty_on_hand<0?'#991B1B':'var(--navy)'}">${b.qty_on_hand}</b></div>`).join('')}</div>`;
}

/* ---------- Wave 5: ปุ่มส่ง PO เข้าคิวเบิกจ่ายบัญชี (เพิ่ม panel ในหน้าใบสั่งซื้อ) ---------- */
function mountPurBridge(){
  const w=$('wrap-purpo'); if(!w||$('ppoBridge')) return;
  const panel=document.createElement('div');
  panel.id='ppoBridge'; panel.className='card'; panel.style.cssText='padding:14px;margin-bottom:14px;border-left:3px solid var(--teal)';
  panel.innerHTML=`<div style="font-weight:700;color:var(--navy);margin-bottom:8px">ส่งใบสั่งซื้อเข้าคิวเบิกจ่าย (บัญชี)</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${psFld('brPo','รหัส PO เช่น PO-BR01-2606-0001')}
    <button id="brBtn" style="padding:8px 16px;background:var(--teal);color:#04342C;border:none;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer">ส่งเบิกจ่าย →</button><span id="brMsg" style="font-size:12px;color:var(--text-muted)"></span></div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:6px">จะไปโผล่ในเมนู "คำขอจ่าย·อนุมัติ" ของบัญชี (จำนวนเงิน = ยอดสุทธิหลังหัก WHT)</div>`;
  // แทรกไว้บนสุดของ #wrap-purpo
  w.insertBefore(panel, w.firstChild);
  $('brBtn').onclick=async()=>{ const po=$('brPo').value.trim(); if(!po){$('brMsg').textContent='กรอกรหัส PO';return;} $('brMsg').textContent='กำลังส่ง…';
    const {data,error}=await sb.functions.invoke('pur_po',{body:{action:'request_payment',po_id:po}});
    $('brMsg').textContent=error||data?.error?('ผิดพลาด: '+(data?.error||error.message)):(`ส่งแล้ว → ${data.payment_request_id} (฿${purBaht(data.amount)}) ✓`); };
}
