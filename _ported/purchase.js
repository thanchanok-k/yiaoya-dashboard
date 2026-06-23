/* ===== Purchase Wave 1 — จัดซื้อ (PR / PO / GR) native บน Supabase hub =====
   inject เข้า module scope ของ index.html (ใช้ sb / esc / $ ร่วม) · wire mount* ใน start()
   edge fn: pur_pr · pur_po · pur_gr  */

const PUR_PILL = {
  'submitted':['รออนุมัติ','#FEF3C7','#92400E'],
  'approved-T1':['อนุมัติ T1 · รอ T2','#DBEAFE','#1E40AF'],
  'approved-T2':['อนุมัติ T2 · รอ T3','#DBEAFE','#1E40AF'],
  'approved':['อนุมัติครบ','#D1FAE5','#065F46'],
  'converted-po':['ออก PO แล้ว','#E0E7FF','#3730A3'],
  'rejected':['ไม่อนุมัติ','#FEE2E2','#991B1B'],
  'cancelled':['ยกเลิก','#F1F5F9','#64748B'],
};
const PO_PILL = {
  'Draft':['ร่าง','#F1F5F9','#475569'],'Sent':['ส่งแล้ว','#DBEAFE','#1E40AF'],
  'Acknowledged':['ผู้ขายรับทราบ','#DBEAFE','#1E40AF'],'PartialDelivered':['รับบางส่วน','#FEF3C7','#92400E'],
  'Delivered':['รับครบ','#D1FAE5','#065F46'],'Closed':['ปิดแล้ว','#E0E7FF','#3730A3'],'Cancelled':['ยกเลิก','#FEE2E2','#991B1B'],
};
function purPill(map,k){ const p=map[k]||[k,'#F1F5F9','#475569']; return `<span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700;background:${p[1]};color:${p[2]}">${esc(p[0])}</span>`; }
function purBaht(n){ return Number(n||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function purInput(id,ph,type){ return `<input id="${id}" ${type?`type="${type}"`:''} placeholder="${ph||''}" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit">`; }

/* แถวรายการสินค้า (ใช้ร่วม PR/PO) */
function purLineRow(pfx){
  return `<div class="${pfx}-ln" style="display:grid;grid-template-columns:2fr .8fr .8fr 1fr auto;gap:6px;margin-bottom:6px">
    <input class="ln-name" placeholder="ชื่อสินค้า" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">
    <input class="ln-qty" type="number" step="any" placeholder="จำนวน" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">
    <input class="ln-uom" placeholder="หน่วย" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">
    <input class="ln-price" type="number" step="any" placeholder="ราคา/หน่วย" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">
    <button type="button" class="ln-del" style="border:none;background:#FEE2E2;color:#991B1B;border-radius:7px;padding:0 10px;cursor:pointer;font-size:14px">×</button>
  </div>`;
}
function purReadLines(box){
  const out=[];
  box.querySelectorAll('[class$="-ln"]').forEach(r=>{
    const name=r.querySelector('.ln-name').value.trim();
    const qty=parseFloat(r.querySelector('.ln-qty').value)||0;
    if(!name||qty<=0) return;
    out.push({item_name:name,qty,uom:r.querySelector('.ln-uom').value.trim(),unit_price:parseFloat(r.querySelector('.ln-price').value)||0});
  });
  return out;
}
function purWireLines(box,addBtn,pfx){
  addBtn.onclick=()=>{ const d=document.createElement('div'); d.innerHTML=purLineRow(pfx); box.appendChild(d.firstElementChild); };
  box.onclick=(e)=>{ if(e.target.classList.contains('ln-del')) e.target.closest('[class$="-ln"]').remove(); };
  addBtn.onclick();
}

/* ---------- ใบขอซื้อ (PR) + อนุมัติ 3 ขั้น ---------- */
function mountPurPr(){
  const w=$('wrap-purpr'); if(!w) return;
  w.innerHTML=`
   <div class="card" style="padding:16px;margin-bottom:14px">
     <div style="font-weight:700;margin-bottom:10px;color:var(--navy)">สร้างใบขอซื้อ (PR)</div>
     <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
       ${purInput('pprBranch','สาขา เช่น BR01')}
       ${purInput('pprReq','รหัสผู้ขอ เช่น EMP100')}
       <select id="pprPurpose" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit">
         <option value="สั่งซื้อปกติ">สั่งซื้อปกติ</option><option value="ของหมด">ของหมด</option><option value="เร่งด่วน">เร่งด่วน</option><option value="ครุภัณฑ์ใหม่">ครุภัณฑ์ใหม่</option><option value="สำรองจ่าย">สำรองจ่าย</option>
       </select>
     </div>
     ${purInput('pprDesc','เหตุผล/รายละเอียด')}
     <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin:12px 0 6px">รายการสินค้า</div>
     <div id="pprLines"></div>
     <button type="button" id="pprAddLn" style="border:1px dashed var(--border);background:#fff;color:var(--navy);border-radius:7px;padding:7px 12px;cursor:pointer;font-size:12.5px;margin-bottom:10px">+ เพิ่มรายการ</button>
     <div style="display:flex;gap:8px;align-items:center">
       <button id="pprPost" style="padding:9px 18px;background:var(--teal);color:#04342C;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">ส่งใบขอซื้อ</button>
       <span id="pprMsg" style="font-size:12px;color:var(--text-muted)"></span>
     </div>
     <div style="font-size:11px;color:var(--text-muted);margin-top:8px">กฎอนุมัติ: ≤5,000 → T1 (ผจก.สาขา) · ≤30,000 → +T2 (จัดซื้อ) · &gt;30,000 → +T3 (ผู้บริหาร)</div>
   </div>
   <div id="pprStat"></div><div id="pprList">กำลังโหลด…</div>`;
  $('pprDesc').style.width='100%';$('pprDesc').style.marginBottom='4px';
  purWireLines($('pprLines'),$('pprAddLn'),'ppr');
  $('pprPost').onclick=pprPost;
  w.addEventListener('click',pprListClick);
  loadPurPr();
}
async function pprPost(){
  const branch=$('pprBranch').value.trim(); if(!branch){$('pprMsg').textContent='กรอกสาขา';return;}
  const lines=purReadLines($('pprLines')); if(!lines.length){$('pprMsg').textContent='ใส่รายการอย่างน้อย 1';return;}
  $('pprMsg').textContent='กำลังส่ง…';
  const {data,error}=await sb.functions.invoke('pur_pr',{body:{action:'create',branch_id:branch,requestor_id:$('pprReq').value.trim(),purpose_type:$('pprPurpose').value,description:$('pprDesc').value.trim(),lines}});
  if(error||data?.error){$('pprMsg').textContent='ผิดพลาด: '+(data?.error||error.message);return;}
  $('pprMsg').textContent=`สร้าง ${data.pr_id} (฿${purBaht(data.total_amount)} · ${data.required_tiers.join('+')}) ✓`;
  $('pprBranch').value='';$('pprDesc').value='';$('pprLines').innerHTML='';$('pprAddLn').onclick();
  loadPurPr();
}
async function loadPurPr(){
  const {data}=await sb.functions.invoke('pur_pr');
  const prs=(data&&data.prs)||[];
  $('pprStat').innerHTML=`<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
     <div class="stat" style="flex:1;min-width:120px"><div class="stat-n">${prs.length}</div><div class="stat-l">ใบขอซื้อทั้งหมด</div></div>
     <div class="stat" style="flex:1;min-width:120px"><div class="stat-n">${data?.pending||0}</div><div class="stat-l">รออนุมัติ</div></div></div>`;
  if(!prs.length){$('pprList').innerHTML='<div class="card" style="padding:18px;text-align:center;color:var(--text-muted)">ยังไม่มีใบขอซื้อ</div>';return;}
  $('pprList').innerHTML=prs.map(p=>{
    const canAct=(p.status==='submitted'||p.status.startsWith('approved-'))&&p.current_tier;
    const items=(p.lines||[]).map(l=>`${esc(l.item_name)} ×${l.qty}`).join(', ');
    return `<div class="card" style="padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap">
        <div><div style="font-weight:700;color:var(--navy)">${esc(p.pr_id)} ${purPill(PUR_PILL,p.status)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${esc(p.branch_id)} · ${esc(p.requestor_name||p.requestor_id||'-')} · ${esc(p.purpose_type||'')}</div></div>
        <div style="text-align:right"><div style="font-weight:800;font-size:17px;color:var(--navy)">฿${purBaht(p.total_amount)}</div>
          <div style="font-size:11px;color:var(--text-muted)">ขั้น: ${(p.required_tiers||[]).map(t=>p.approved_tiers.includes(t)?`<b style="color:#065F46">${t}✓</b>`:t).join(' · ')}</div></div>
      </div>
      <div style="font-size:12px;color:#475569;margin-top:6px">${esc(items)}</div>
      ${p.linked_po_id?`<div style="font-size:11.5px;color:#3730A3;margin-top:4px">→ ${esc(p.linked_po_id)}</div>`:''}
      ${canAct?`<div style="margin-top:9px;display:flex;gap:7px">
        <button class="ppr-ap" data-id="${esc(p.pr_id)}" data-tier="${p.current_tier}" style="padding:6px 14px;background:var(--teal);color:#04342C;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">อนุมัติ ${p.current_tier}</button>
        <button class="ppr-rj" data-id="${esc(p.pr_id)}" style="padding:6px 14px;background:#FEE2E2;color:#991B1B;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">ปฏิเสธ</button>
      </div>`:''}
    </div>`;}).join('');
}
async function pprListClick(e){
  const ap=e.target.closest('.ppr-ap'), rj=e.target.closest('.ppr-rj');
  if(ap){ ap.disabled=true; const {data,error}=await sb.functions.invoke('pur_pr',{body:{action:'approve',pr_id:ap.dataset.id}}); if(error||data?.error)alert(data?.error||error.message); loadPurPr(); }
  else if(rj){ const note=prompt('เหตุผลที่ปฏิเสธ?')||''; const {data,error}=await sb.functions.invoke('pur_pr',{body:{action:'reject',pr_id:rj.dataset.id,note}}); if(error||data?.error)alert(data?.error||error.message); loadPurPr(); }
}

/* ---------- ใบสั่งซื้อ (PO) ---------- */
function mountPurPo(){
  const w=$('wrap-purpo'); if(!w) return;
  w.innerHTML=`
   <div class="card" style="padding:16px;margin-bottom:14px">
     <div style="font-weight:700;margin-bottom:10px;color:var(--navy)">สร้างใบสั่งซื้อ (PO)</div>
     <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
       ${purInput('ppoBranch','สาขา เช่น BR01')}${purInput('ppoVendor','รหัสผู้ขาย เช่น V001')}${purInput('ppoPr','อ้างใบขอซื้อ PR (ถ้ามี)')}
       ${purInput('ppoTerms','เงื่อนไขจ่าย เช่น เครดิต 30วัน')}
       <select id="ppoVat" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit"><option value="7">VAT 7%</option><option value="0">ไม่มี VAT</option></select>
       <select id="ppoWht" style="padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit"><option value="0">WHT 0%</option><option value="1">1%</option><option value="3">3%</option><option value="5">5%</option></select>
     </div>
     <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin:6px 0 6px">รายการ</div>
     <div id="ppoLines"></div>
     <button type="button" id="ppoAddLn" style="border:1px dashed var(--border);background:#fff;color:var(--navy);border-radius:7px;padding:7px 12px;cursor:pointer;font-size:12.5px;margin-bottom:10px">+ เพิ่มรายการ</button>
     <div style="display:flex;gap:8px;align-items:center"><button id="ppoPost" style="padding:9px 18px;background:var(--teal);color:#04342C;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">สร้าง PO</button><span id="ppoMsg" style="font-size:12px;color:var(--text-muted)"></span></div>
   </div>
   <div id="ppoStat"></div><div id="ppoList">กำลังโหลด…</div>`;
  purWireLines($('ppoLines'),$('ppoAddLn'),'ppo');
  $('ppoPost').onclick=ppoPost;
  loadPurPo();
}
async function ppoPost(){
  const branch=$('ppoBranch').value.trim(),vendor=$('ppoVendor').value.trim();
  if(!branch||!vendor){$('ppoMsg').textContent='กรอกสาขา + ผู้ขาย';return;}
  const lines=purReadLines($('ppoLines')); if(!lines.length){$('ppoMsg').textContent='ใส่รายการ';return;}
  $('ppoMsg').textContent='กำลังสร้าง…';
  const {data,error}=await sb.functions.invoke('pur_po',{body:{action:'create',branch_id:branch,vendor_id:vendor,source_pr_id:$('ppoPr').value.trim(),payment_terms:$('ppoTerms').value.trim(),vat_rate:Number($('ppoVat').value),wht_rate:Number($('ppoWht').value),lines}});
  if(error||data?.error){$('ppoMsg').textContent='ผิดพลาด: '+(data?.error||error.message);return;}
  $('ppoMsg').textContent=`สร้าง ${data.po_id} (รวม ฿${purBaht(data.grand_total)}) ✓`;
  $('ppoVendor').value='';$('ppoPr').value='';$('ppoLines').innerHTML='';$('ppoAddLn').onclick();
  loadPurPo();
}
async function loadPurPo(){
  const {data}=await sb.functions.invoke('pur_po');
  const pos=(data&&data.pos)||[];
  $('ppoStat').innerHTML=`<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
     <div class="stat" style="flex:1;min-width:120px"><div class="stat-n">${pos.length}</div><div class="stat-l">ใบสั่งซื้อทั้งหมด</div></div>
     <div class="stat" style="flex:1;min-width:120px"><div class="stat-n">${data?.open||0}</div><div class="stat-l">ยังไม่ปิด</div></div></div>`;
  if(!pos.length){$('ppoList').innerHTML='<div class="card" style="padding:18px;text-align:center;color:var(--text-muted)">ยังไม่มีใบสั่งซื้อ</div>';return;}
  $('ppoList').innerHTML=pos.map(p=>{
    const items=(p.lines||[]).map(l=>`${esc(l.item_name)} ×${l.qty}`).join(', ');
    return `<div class="card" style="padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:start;gap:10px;flex-wrap:wrap">
        <div><div style="font-weight:700;color:var(--navy)">${esc(p.po_id)} ${purPill(PO_PILL,p.status)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px">${esc(p.branch_id)} · ผู้ขาย ${esc(p.vendor_id)} ${p.source_pr_id?'· จาก '+esc(p.source_pr_id):''} · ${esc(p.payment_terms||'-')}</div></div>
        <div style="text-align:right"><div style="font-weight:800;font-size:17px;color:var(--navy)">฿${purBaht(p.grand_total)}</div><div style="font-size:11px;color:var(--text-muted)">จ่ายสุทธิ ฿${purBaht(p.net_payable)}</div></div>
      </div>
      <div style="font-size:12px;color:#475569;margin-top:6px">${esc(items)}</div>
    </div>`;}).join('');
}

/* ---------- รับของ (GR) ---------- */
function mountPurGr(){
  const w=$('wrap-purgr'); if(!w) return;
  w.innerHTML=`
   <div class="card" style="padding:16px;margin-bottom:14px">
     <div style="font-weight:700;margin-bottom:10px;color:var(--navy)">บันทึกรับของ (GR)</div>
     <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
       ${purInput('pgrPo','รหัส PO เช่น PO-BR01-2606-0001')}${purInput('pgrRecv','ผู้รับของ')}${purInput('pgrDn','เลขใบส่งของ')}
       ${purInput('pgrTax','เลขใบกำกับภาษี (ถ้ามี)')}
     </div>
     <div style="font-size:11.5px;color:var(--text-muted);margin-bottom:6px">ใส่ line_no ตาม PO + จำนวนที่รับจริง</div>
     <div id="pgrLines"></div>
     <button type="button" id="pgrAddLn" style="border:1px dashed var(--border);background:#fff;color:var(--navy);border-radius:7px;padding:7px 12px;cursor:pointer;font-size:12.5px;margin-bottom:10px">+ เพิ่มรายการรับ</button>
     <div style="display:flex;gap:8px;align-items:center"><button id="pgrPost" style="padding:9px 18px;background:var(--teal);color:#04342C;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">บันทึกรับของ</button><span id="pgrMsg" style="font-size:12px;color:var(--text-muted)"></span></div>
   </div>
   <div id="pgrList">กำลังโหลด…</div>`;
  pgrAddRow(); $('pgrAddLn').onclick=pgrAddRow; $('pgrPost').onclick=pgrPost;
  $('pgrLines').onclick=(e)=>{ if(e.target.classList.contains('grln-del'))e.target.closest('.pgr-ln').remove(); };
  loadPurGr();
}
function pgrAddRow(){
  const d=document.createElement('div'); d.className='pgr-ln'; d.style.cssText='display:grid;grid-template-columns:.8fr 2fr .8fr auto;gap:6px;margin-bottom:6px';
  d.innerHTML=`<input class="grln-no" type="number" placeholder="line_no" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">
   <input class="grln-name" placeholder="ชื่อสินค้า (ไม่บังคับ)" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">
   <input class="grln-qty" type="number" step="any" placeholder="รับจริง" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">
   <button type="button" class="grln-del" style="border:none;background:#FEE2E2;color:#991B1B;border-radius:7px;padding:0 10px;cursor:pointer;font-size:14px">×</button>`;
  $('pgrLines').appendChild(d);
}
async function pgrPost(){
  const po=$('pgrPo').value.trim(); if(!po){$('pgrMsg').textContent='กรอกรหัส PO';return;}
  const lines=[]; $('pgrLines').querySelectorAll('.pgr-ln').forEach(r=>{ const no=parseInt(r.querySelector('.grln-no').value)||0; const qty=parseFloat(r.querySelector('.grln-qty').value)||0; if(no>0&&qty>0)lines.push({line_no:no,item_name:r.querySelector('.grln-name').value.trim(),received_qty:qty}); });
  if(!lines.length){$('pgrMsg').textContent='ใส่รายการรับ';return;}
  $('pgrMsg').textContent='กำลังบันทึก…';
  const {data,error}=await sb.functions.invoke('pur_gr',{body:{action:'create',po_id:po,receiver_id:$('pgrRecv').value.trim(),delivery_note_no:$('pgrDn').value.trim(),tax_invoice_no:$('pgrTax').value.trim(),lines}});
  if(error||data?.error){$('pgrMsg').textContent='ผิดพลาด: '+(data?.error||error.message);return;}
  $('pgrMsg').textContent=`บันทึก ${data.gr_id} · ${data.gr_status==='Complete'?'รับครบ':'รับบางส่วน'} ✓`;
  $('pgrLines').innerHTML='';pgrAddRow();
  loadPurGr();
}
async function loadPurGr(){
  const {data}=await sb.functions.invoke('pur_gr');
  const grs=(data&&data.grs)||[];
  if(!grs.length){$('pgrList').innerHTML='<div class="card" style="padding:18px;text-align:center;color:var(--text-muted)">ยังไม่มีรายการรับของ</div>';return;}
  $('pgrList').innerHTML=grs.map(g=>{
    const items=(g.lines||[]).map(l=>`#${l.line_no} ${esc(l.item_name||'')} รับ ${l.received_qty}`).join(', ');
    const pill=g.status==='Complete'?['รับครบ','#D1FAE5','#065F46']:['รับบางส่วน','#FEF3C7','#92400E'];
    return `<div class="card" style="padding:13px;margin-bottom:9px">
      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
        <div style="font-weight:700;color:var(--navy)">${esc(g.gr_id)} <span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:700;background:${pill[1]};color:${pill[2]}">${pill[0]}</span></div>
        <div style="font-size:12px;color:var(--text-muted)">${esc(g.po_id)} ${g.tax_invoice_no?'· ใบกำกับ '+esc(g.tax_invoice_no):''}</div></div>
      <div style="font-size:12px;color:#475569;margin-top:5px">${esc(items)}</div></div>`;}).join('');
}

/* ---------- สรุปจัดซื้อ (dashboard) ---------- */
async function mountPurDash(){
  const w=$('wrap-purdash'); if(!w) return;
  w.innerHTML='<div style="color:var(--text-muted)">กำลังโหลด…</div>';
  const [pr,po,gr]=await Promise.all([sb.functions.invoke('pur_pr'),sb.functions.invoke('pur_po'),sb.functions.invoke('pur_gr')]);
  const prs=(pr.data&&pr.data.prs)||[],pos=(po.data&&po.data.pos)||[],grs=(gr.data&&gr.data.grs)||[];
  const poValue=pos.reduce((s,p)=>s+Number(p.grand_total||0),0);
  const card=(n,l,c)=>`<div class="stat" style="flex:1;min-width:140px"><div class="stat-n" style="color:${c||'var(--navy)'}">${n}</div><div class="stat-l">${l}</div></div>`;
  w.innerHTML=`<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
     ${card(pr.data?.pending||0,'ใบขอซื้อรออนุมัติ','#92400E')}
     ${card(prs.filter(p=>p.status==='approved').length,'อนุมัติแล้ว · รอออก PO','#065F46')}
     ${card(po.data?.open||0,'ใบสั่งซื้อยังไม่ปิด')}
     ${card('฿'+purBaht(poValue),'มูลค่า PO รวม')}
     ${card(grs.length,'ครั้งที่รับของ')}
   </div>
   <div class="card" style="padding:16px"><div style="font-weight:700;color:var(--navy);margin-bottom:8px">ใบขอซื้อรออนุมัติล่าสุด</div>
   ${prs.filter(p=>p.status==='submitted'||p.status.startsWith('approved-')).slice(0,6).map(p=>`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px"><span>${esc(p.pr_id)} · ${esc(p.branch_id)} <span style="color:var(--text-muted)">(รอ ${p.current_tier})</span></span><b>฿${purBaht(p.total_amount)}</b></div>`).join('')||'<div style="color:var(--text-muted);font-size:13px">ไม่มีค้างอนุมัติ 🎉</div>'}
   </div>`;
}
