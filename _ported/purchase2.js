/* ===== Purchase Wave 2 — ผู้ขาย / สินค้า / RFQ =====
   ใช้ helper จาก purchase.js (purPill,purBaht,purInput,purLineRow,purReadLines,purWireLines) · sb/esc/$ module scope
   edge fn: pur_vendor · pur_item · pur_rfq  */

const VEND_PILL={'Active':['ใช้งาน','#D1FAE5','#065F46'],'Inactive':['พักใช้','#F1F5F9','#64748B'],'Blacklisted':['บัญชีดำ','#FEE2E2','#991B1B']};

/* ---------- ผู้ขาย (Vendor) ---------- */
function mountPurVendor(){
  const w=$('wrap-purvendor'); if(!w) return;
  w.innerHTML=`
   <div class="card" style="padding:16px;margin-bottom:14px">
     <div style="font-weight:700;margin-bottom:10px;color:var(--navy)">เพิ่มผู้ขาย</div>
     <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
       ${purInput('pvName','ชื่อร้าน/บริษัท')}
       <select id="pvType" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit"><option value="บริษัท">บริษัท</option><option value="บุคคลธรรมดา">บุคคลธรรมดา</option><option value="ห้างหุ้นส่วน">ห้างหุ้นส่วน</option></select>
       ${purInput('pvTax','เลขผู้เสียภาษี')}
       ${purInput('pvContact','ผู้ติดต่อ')}${purInput('pvPhone','เบอร์โทร')}
       <select id="pvCat" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit"><option value="">หมวด —</option><option>ยา</option><option>เวชภัณฑ์</option><option>อุปกรณ์สำนักงาน</option><option>IT</option><option>การตลาด</option><option>บริการ</option><option>อื่นๆ</option></select>
       ${purInput('pvBank','ธนาคาร')}${purInput('pvAcc','เลขบัญชี')}${purInput('pvCredit','เครดิต (วัน)','number')}
     </div>
     <div style="display:flex;gap:8px;align-items:center"><button id="pvPost" style="padding:9px 18px;background:var(--teal);color:#04342C;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">บันทึกผู้ขาย</button><span id="pvMsg" style="font-size:12px;color:var(--text-muted)"></span></div>
   </div>
   <div id="pvStat"></div><div id="pvList">กำลังโหลด…</div>`;
  $('pvPost').onclick=pvPost;
  w.addEventListener('click',pvListClick);
  loadPurVendor();
}
async function pvPost(){
  const name=$('pvName').value.trim(); if(!name){$('pvMsg').textContent='กรอกชื่อผู้ขาย';return;}
  $('pvMsg').textContent='กำลังบันทึก…';
  const {data,error}=await sb.functions.invoke('pur_vendor',{body:{action:'create',vendor_name:name,vendor_type:$('pvType').value,tax_id:$('pvTax').value.trim(),contact_name:$('pvContact').value.trim(),contact_phone:$('pvPhone').value.trim(),category:$('pvCat').value,bank_name:$('pvBank').value.trim(),bank_account_no:$('pvAcc').value.trim(),credit_terms:Number($('pvCredit').value)||0}});
  if(error||data?.error){$('pvMsg').textContent='ผิดพลาด: '+(data?.error||error.message);return;}
  $('pvMsg').textContent=`บันทึก ${data.vendor_id} ✓`;
  ['pvName','pvTax','pvContact','pvPhone','pvBank','pvAcc','pvCredit'].forEach(id=>$(id).value='');
  loadPurVendor();
}
async function loadPurVendor(){
  const {data}=await sb.functions.invoke('pur_vendor');
  const vs=(data&&data.vendors)||[];
  $('pvStat').innerHTML=`<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap"><div class="stat" style="flex:1;min-width:120px"><div class="stat-n">${vs.length}</div><div class="stat-l">ผู้ขายทั้งหมด</div></div><div class="stat" style="flex:1;min-width:120px"><div class="stat-n">${data?.active||0}</div><div class="stat-l">ใช้งานอยู่</div></div></div>`;
  if(!vs.length){$('pvList').innerHTML='<div class="card" style="padding:18px;text-align:center;color:var(--text-muted)">ยังไม่มีผู้ขาย</div>';return;}
  $('pvList').innerHTML=vs.map(v=>`<div class="card" style="padding:13px;margin-bottom:9px">
     <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
       <div><div style="font-weight:700;color:var(--navy)">${esc(v.vendor_name)} ${purPill(VEND_PILL,v.status)}</div>
         <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${esc(v.vendor_id)} · ${esc(v.vendor_type||'')} ${v.category?'· '+esc(v.category):''} ${v.credit_terms?'· เครดิต '+v.credit_terms+'วัน':''}</div>
         ${v.contact_name||v.contact_phone?`<div style="font-size:12px;color:#475569;margin-top:2px">${esc(v.contact_name||'')} ${v.contact_phone?'· '+esc(v.contact_phone):''}</div>`:''}
         ${v.bank_name?`<div style="font-size:11.5px;color:#64748B;margin-top:2px">${esc(v.bank_name)} ${esc(v.bank_account_no||'')}</div>`:''}</div>
       <div style="display:flex;gap:6px;align-items:start">
         ${v.status!=='Blacklisted'?`<button class="pv-bl" data-id="${esc(v.vendor_id)}" style="padding:5px 11px;background:#FEE2E2;color:#991B1B;border:none;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer">บัญชีดำ</button>`:`<button class="pv-ac" data-id="${esc(v.vendor_id)}" style="padding:5px 11px;background:#D1FAE5;color:#065F46;border:none;border-radius:7px;font-size:11.5px;font-weight:700;cursor:pointer">เปิดใช้</button>`}
       </div></div></div>`).join('');
}
async function pvListClick(e){
  const bl=e.target.closest('.pv-bl'), ac=e.target.closest('.pv-ac');
  if(bl){ if(!confirm('ขึ้นบัญชีดำผู้ขายนี้?'))return; await sb.functions.invoke('pur_vendor',{body:{action:'set_status',vendor_id:bl.dataset.id,status:'Blacklisted'}}); loadPurVendor(); }
  else if(ac){ await sb.functions.invoke('pur_vendor',{body:{action:'set_status',vendor_id:ac.dataset.id,status:'Active'}}); loadPurVendor(); }
}

/* ---------- สินค้า (Items) + ประวัติราคา ---------- */
function mountPurItem(){
  const w=$('wrap-puritem'); if(!w) return;
  w.innerHTML=`
   <div class="card" style="padding:16px;margin-bottom:14px">
     <div style="font-weight:700;margin-bottom:10px;color:var(--navy)">เพิ่มสินค้า</div>
     <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;margin-bottom:8px">
       ${purInput('piName','ชื่อสินค้า')}${purInput('piCode','รหัส/SKU')}
       <select id="piCat" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit"><option>ยา</option><option>เวชภัณฑ์</option><option>ครุภัณฑ์</option><option>สิ้นเปลือง</option><option>บริการ</option></select>
       ${purInput('piUom','หน่วย')}
     </div>
     <div style="display:flex;gap:14px;align-items:center;margin-bottom:8px">
       <div style="display:flex;gap:6px;align-items:center">${purInput('piMin','สต็อกขั้นต่ำ','number')}</div>
       <label style="font-size:12.5px;color:#475569;display:flex;gap:5px;align-items:center"><input type="checkbox" id="piLot"> ติดตาม lot/หมดอายุ (ยา/เวชภัณฑ์)</label>
     </div>
     <div style="display:flex;gap:8px;align-items:center"><button id="piPost" style="padding:9px 18px;background:var(--teal);color:#04342C;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">บันทึกสินค้า</button><span id="piMsg" style="font-size:12px;color:var(--text-muted)"></span></div>
   </div>
   <div id="piStat"></div><div id="piList">กำลังโหลด…</div>`;
  $('piPost').onclick=piPost;
  w.addEventListener('click',piListClick);
  loadPurItem();
}
async function piPost(){
  const name=$('piName').value.trim(); if(!name){$('piMsg').textContent='กรอกชื่อสินค้า';return;}
  $('piMsg').textContent='กำลังบันทึก…';
  const {data,error}=await sb.functions.invoke('pur_item',{body:{action:'create',item_name:name,item_code:$('piCode').value.trim(),category:$('piCat').value,uom:$('piUom').value.trim(),min_stock:Number($('piMin').value)||0,has_lot:$('piLot').checked}});
  if(error||data?.error){$('piMsg').textContent='ผิดพลาด: '+(data?.error||error.message);return;}
  $('piMsg').textContent=`บันทึก ${data.item_id} ✓`;
  ['piName','piCode','piUom','piMin'].forEach(id=>$(id).value='');$('piLot').checked=false;
  loadPurItem();
}
async function loadPurItem(){
  const {data}=await sb.functions.invoke('pur_item');
  const its=(data&&data.items)||[];
  $('piStat').innerHTML=`<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap"><div class="stat" style="flex:1;min-width:120px"><div class="stat-n">${its.length}</div><div class="stat-l">รายการสินค้า</div></div></div>`;
  if(!its.length){$('piList').innerHTML='<div class="card" style="padding:18px;text-align:center;color:var(--text-muted)">ยังไม่มีสินค้า</div>';return;}
  $('piList').innerHTML=its.map(it=>`<div class="card" style="padding:13px;margin-bottom:9px">
     <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
       <div><div style="font-weight:700;color:var(--navy)">${esc(it.item_name)} ${it.has_lot?'<span style="font-size:10px;background:#E0E7FF;color:#3730A3;padding:1px 7px;border-radius:99px;font-weight:700">LOT</span>':''}</div>
         <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${esc(it.item_id)} ${it.item_code?'· '+esc(it.item_code):''} · ${esc(it.category||'')} ${it.uom?'· '+esc(it.uom):''} ${it.min_stock?'· ขั้นต่ำ '+it.min_stock:''}</div></div>
       <div style="text-align:right"><div style="font-size:12px;color:var(--text-muted)">ราคาล่าสุด</div><div style="font-weight:800;color:var(--navy)">${it.last_price?'฿'+purBaht(it.last_price):'—'}</div>
         <button class="pi-pr" data-id="${esc(it.item_id)}" data-name="${esc(it.item_name)}" style="margin-top:5px;padding:4px 10px;background:#EFF6FF;color:#1E40AF;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">+ บันทึกราคา</button></div></div></div>`).join('');
}
async function piListClick(e){
  const pr=e.target.closest('.pi-pr'); if(!pr)return;
  const v=prompt('รหัสผู้ขาย (vendor_id):'); if(!v)return;
  const up=parseFloat(prompt('ราคา/หน่วย (บาท):')); if(!(up>0))return;
  const qty=parseFloat(prompt('จำนวนที่ซื้อ:','1'))||1;
  const {data,error}=await sb.functions.invoke('pur_item',{body:{action:'record_price',item_id:pr.dataset.id,vendor_id:v.trim(),unit_price:up,qty}});
  if(error||data?.error)alert(data?.error||error.message); else alert(`บันทึกราคา ${pr.dataset.name} = ฿${up} (effective ฿${data.effective_unit_price}) ✓`);
  loadPurItem();
}

/* ---------- RFQ (ขอใบเสนอราคา / เทียบราคา) ---------- */
function mountPurRfq(){
  const w=$('wrap-purrfq'); if(!w) return;
  w.innerHTML=`
   <div class="card" style="padding:16px;margin-bottom:14px">
     <div style="font-weight:700;margin-bottom:10px;color:var(--navy)">เปิด RFQ (ขอใบเสนอราคา)</div>
     <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-bottom:8px">${purInput('prqBranch','สาขา เช่น BR01')}${purInput('prqTitle','หัวข้อ เช่น จัดซื้อยา ก.ค.')}</div>
     ${purInput('prqVendors','รหัสผู้ขายที่เชิญ คั่นด้วย , เช่น V-0001,V-0002')}
     <div style="margin-top:8px;display:flex;gap:8px;align-items:center"><button id="prqPost" style="padding:9px 18px;background:var(--teal);color:#04342C;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">เปิด RFQ</button><span id="prqMsg" style="font-size:12px;color:var(--text-muted)"></span></div>
   </div>
   <div class="card" style="padding:16px;margin-bottom:14px">
     <div style="font-weight:700;margin-bottom:10px;color:var(--navy)">บันทึกใบเสนอราคาที่ได้รับ</div>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">${purInput('prqRfqId','รหัส RFQ')}${purInput('prqVendor','รหัสผู้ขายที่เสนอ')}</div>
     <div id="prqLines"></div>
     <button type="button" id="prqAddLn" style="border:1px dashed var(--border);background:#fff;color:var(--navy);border-radius:7px;padding:7px 12px;cursor:pointer;font-size:12.5px;margin-bottom:10px">+ เพิ่มรายการ</button>
     <div style="display:flex;gap:8px;align-items:center"><button id="prqRespPost" style="padding:9px 18px;background:#EFF6FF;color:#1E40AF;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">บันทึกใบเสนอราคา</button><span id="prqRespMsg" style="font-size:12px;color:var(--text-muted)"></span></div>
   </div>
   <div id="prqList">กำลังโหลด…</div>`;
  purWireLines($('prqLines'),$('prqAddLn'),'prq');
  $('prqPost').onclick=prqPost; $('prqRespPost').onclick=prqRespPost;
  w.addEventListener('click',prqListClick);
  loadPurRfq();
}
async function prqPost(){
  const branch=$('prqBranch').value.trim(),title=$('prqTitle').value.trim();
  const vendors=$('prqVendors').value.split(',').map(s=>s.trim()).filter(Boolean);
  if(!branch||!title||!vendors.length){$('prqMsg').textContent='กรอกสาขา + หัวข้อ + ผู้ขายอย่างน้อย 1';return;}
  $('prqMsg').textContent='กำลังเปิด…';
  const {data,error}=await sb.functions.invoke('pur_rfq',{body:{action:'create',branch_id:branch,title,vendor_ids:vendors}});
  if(error||data?.error){$('prqMsg').textContent='ผิดพลาด: '+(data?.error||error.message);return;}
  $('prqMsg').textContent=`เปิด ${data.rfq_id} (เชิญ ${data.vendor_count} ราย) ✓`;
  $('prqTitle').value='';$('prqVendors').value='';
  loadPurRfq();
}
async function prqRespPost(){
  const rfq=$('prqRfqId').value.trim(),vendor=$('prqVendor').value.trim();
  if(!rfq||!vendor){$('prqRespMsg').textContent='กรอก RFQ + ผู้ขาย';return;}
  const lines=purReadLines($('prqLines')); if(!lines.length){$('prqRespMsg').textContent='ใส่รายการ';return;}
  $('prqRespMsg').textContent='กำลังบันทึก…';
  const {data,error}=await sb.functions.invoke('pur_rfq',{body:{action:'respond',rfq_id:rfq,vendor_id:vendor,lines}});
  if(error||data?.error){$('prqRespMsg').textContent='ผิดพลาด: '+(data?.error||error.message);return;}
  $('prqRespMsg').textContent=`บันทึก ${vendor} = ฿${purBaht(data.total_amount)} ✓`;
  $('prqLines').innerHTML='';$('prqAddLn').onclick();
  loadPurRfq();
}
async function purGet(qs){
  const t=(await sb.auth.getSession()).data.session?.access_token;
  const r=await fetch(SB_URL+'/functions/v1/'+qs,{headers:{Authorization:'Bearer '+t}});
  return r.json();
}
async function loadPurRfq(){
  const data=await purGet('pur_rfq');
  const rfqs=(data&&data.rfqs)||[];
  if(!rfqs.length){$('prqList').innerHTML='<div class="card" style="padding:18px;text-align:center;color:var(--text-muted)">ยังไม่มี RFQ</div>';return;}
  $('prqList').innerHTML=(await Promise.all(rfqs.map(async r=>{
    const det=await getRfq(r.rfq_id)||r;
    const resp=(det&&det.responses)||[];
    const sorted=resp.slice().sort((a,b)=>a.total_amount-b.total_amount);
    const stPill={'Open':['เปิดรับ','#FEF3C7','#92400E'],'Awarded':['เลือกผู้ชนะแล้ว','#D1FAE5','#065F46'],'Cancelled':['ยกเลิก','#FEE2E2','#991B1B']};
    const rows=sorted.map((x,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12.5px">
       <span>${i===0?'🏆 ':''}${esc(x.vendor_id)}${det.winner_vendor_id===x.vendor_id?' <b style="color:#065F46">(ผู้ชนะ)</b>':''}</span>
       <span style="display:flex;gap:8px;align-items:center"><b>฿${purBaht(x.total_amount)}</b>${det.status==='Open'?`<button class="prq-aw" data-rfq="${esc(r.rfq_id)}" data-v="${esc(x.vendor_id)}" style="padding:3px 9px;background:var(--teal);color:#04342C;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">เลือก</button>`:''}</span></div>`).join('')||'<div style="font-size:12px;color:var(--text-muted);padding:6px 0">ยังไม่มีผู้เสนอราคา</div>';
    return `<div class="card" style="padding:14px;margin-bottom:10px">
       <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div style="font-weight:700;color:var(--navy)">${esc(r.rfq_id)} ${purPill(stPill,det.status)}</div><div style="font-size:12px;color:var(--text-muted)">${esc(r.branch_id)} · เชิญ ${(det.vendors||[]).length} · ตอบ ${resp.length}</div></div>
       <div style="font-size:13px;color:#475569;margin:4px 0 8px">${esc(r.title)}</div>${rows}</div>`;
  }))).join('');
}
async function getRfq(id){ try{ const data=await purGet('pur_rfq?rfq_id='+encodeURIComponent(id)); return data&&data.rfq; }catch(e){ return null; } }
async function prqListClick(e){
  const aw=e.target.closest('.prq-aw'); if(!aw)return;
  if(!confirm('เลือกผู้ขายนี้เป็นผู้ชนะ?'))return;
  const {data,error}=await sb.functions.invoke('pur_rfq',{body:{action:'award',rfq_id:aw.dataset.rfq,vendor_id:aw.dataset.v}});
  if(error||data?.error)alert(data?.error||error.message);
  loadPurRfq();
}
