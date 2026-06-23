/* ===== Purchase Wave 6 — สแกนรับของ / ค้นหารายละเอียด / บันทึกกิจกรรม / LINE identity =====
   ใช้ sb/esc/$/purGet/purBaht/purPill จากไฟล์ก่อนหน้า · edge fn: pur_activity · line_login · pur_stock · pur_item ฯลฯ
   html5-qrcode โหลดจาก CDN ตอนเปิดหน้าสแกน */

/* ---------- LINE identity (audit: ใครทำอะไร) ---------- */
let LINE_ID=null; try{ LINE_ID=JSON.parse(localStorage.getItem('yy_line_id')||'null'); }catch(e){}
function purActor(){ return LINE_ID?{actor_uid:LINE_ID.uid,actor_name:LINE_ID.employee_name||LINE_ID.display_name,created_by:LINE_ID.employee_name||LINE_ID.display_name}:{}; }
function renderLineBadge(){
  const el=$('lineBadge'); if(!el) return;
  if(LINE_ID){ el.innerHTML=`<span style="font-size:11px;color:rgba(255,255,255,.9)">👤 ${esc(LINE_ID.employee_name||LINE_ID.display_name)}${LINE_ID.role?' · '+esc(LINE_ID.role):''}</span> <button id="lineOut" style="padding:3px 8px;background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:6px;font-size:10.5px;cursor:pointer">ออก</button>`; $('lineOut').onclick=lineLogout; }
  else { el.innerHTML=`<button id="lineIn" style="padding:4px 11px;background:#06C755;color:#fff;border:none;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer">เข้าระบบด้วย LINE</button>`; $('lineIn').onclick=lineLoginFlow; }
}
async function lineLoginFlow(){
  // ถ้ามี LIFF (ในแอป LINE) จะ redirect ไป liff.html · บนเว็บปกติใช้โหมด demo เลือกพนักงาน
  if(confirm('เข้าระบบด้วย LINE จริง ต้องเปิดผ่านแอป LINE (LIFF)\n\nกด OK = เข้าโหมดทดสอบ (เลือกพนักงานเพื่อจำลองตัวตน)\nกด Cancel = เปิดหน้า LIFF')){ return lineDemoLogin(); }
  location.href='login.html';
}
async function lineDemoLogin(){
  // ดึง roster เพื่อเลือกตัวตน (ใช้ employees ผ่าน edge fn ที่มีอยู่ หรือ prompt)
  const emp=prompt('โหมดทดสอบ — ใส่รหัสพนักงาน (employee_id) ที่จะจำลองเป็นตัวตน:'); if(!emp)return;
  const uid='Udemo-'+emp;
  const {data}=await sb.functions.invoke('line_login',{body:{action:'verify_demo',uid,display_name:emp}});
  if(!data||data.error){ alert('ไม่สำเร็จ: '+(data&&data.error||'')); return; }
  LINE_ID={uid:data.uid,display_name:data.display_name,employee_name:data.employee_name||emp,employee_id:data.employee_id||emp,role:data.role||'staff'};
  localStorage.setItem('yy_line_id',JSON.stringify(LINE_ID)); renderLineBadge(); alert('เข้าระบบ (ทดสอบ) เป็น: '+(LINE_ID.employee_name)+' · บทบาท '+LINE_ID.role);
}
function lineLogout(){ LINE_ID=null; localStorage.removeItem('yy_line_id'); renderLineBadge(); }

/* ---------- modal ---------- */
function purModal(title,bodyHtml){
  let ov=$('purModalOv'); if(!ov){ ov=document.createElement('div'); ov.id='purModalOv'; ov.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto'; ov.onclick=(e)=>{if(e.target===ov)ov.remove();}; document.body.appendChild(ov); }
  ov.innerHTML=`<div style="background:#fff;border-radius:14px;max-width:680px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--border)"><div style="font-weight:800;color:var(--navy);font-size:15px">${title}</div><button onclick="document.getElementById('purModalOv').remove()" style="border:none;background:#F1F5F9;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:16px">✕</button></div>
    <div style="padding:18px">${bodyHtml}</div></div>`;
}
const _ST_PILL={Open:['เปิด','#FEF3C7','#92400E'],submitted:['รออนุมัติ','#FEF3C7','#92400E'],'approved-1':['อนุมัติ T1','#DBEAFE','#1E40AF'],'approved-2':['อนุมัติ T2','#DBEAFE','#1E40AF'],approved:['อนุมัติครบ','#D1FAE5','#065F46'],'converted-po':['ออก PO แล้ว','#E0E7FF','#3730A3'],rejected:['ปฏิเสธ','#FEE2E2','#991B1B'],Delivered:['รับครบ','#D1FAE5','#065F46'],PartialDelivered:['รับบางส่วน','#FEF3C7','#92400E'],Awarded:['ได้ผู้ชนะ','#D1FAE5','#065F46']};
function kv(k,v){ return v||v===0?`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F1F5F9;font-size:13px"><span style="color:var(--text-muted)">${k}</span><span style="font-weight:600;color:var(--navy);text-align:right">${v}</span></div>`:''; }

/* ---------- ค้นหา & ดูรายละเอียด (purlookup) ---------- */
function mountPurLookup(){
  const w=$('wrap-purlookup'); if(!w) return;
  w.innerHTML=`<div class="card" style="padding:16px;margin-bottom:14px">
     <div style="font-weight:700;color:var(--navy);margin-bottom:8px">ค้นหา / ดูรายละเอียด</div>
     <div style="display:flex;gap:8px;flex-wrap:wrap"><input id="lkId" placeholder="ใส่เลขเอกสาร: V-0001 · I00001 · RFQ-… · PR-… · PO-…" style="flex:1;min-width:220px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit">
     <button id="lkGo" style="padding:10px 20px;background:var(--teal);color:#04342C;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit">ดู</button></div>
     <div style="font-size:11.5px;color:var(--text-muted);margin-top:7px">รองรับ: ผู้ขาย(V-) · สินค้า(I…+ประวัติราคา) · RFQ(เทียบราคา) · ใบขอซื้อ(PR-) · ใบสั่งซื้อ(PO-)</div>
   </div><div id="lkResult"></div>`;
  const go=()=>purLookupGo($('lkId').value.trim());
  $('lkGo').onclick=go; $('lkId').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
}
async function purLookupGo(id){
  if(!id){return;} const box=$('lkResult'); box.innerHTML='<div class="card" style="padding:16px;color:var(--text-muted)">กำลังค้นหา…</div>';
  try{
    if(/^V-/i.test(id)){ const d=await purGet('pur_vendor?vendor_id='+encodeURIComponent(id)); const v=d.vendor; if(!v)throw 0;
      box.innerHTML=`<div class="card" style="padding:16px"><div style="font-weight:800;color:var(--navy);font-size:15px;margin-bottom:8px">${esc(v.vendor_name)} ${purPill(_ST_PILL,v.status)||''}</div>${kv('รหัส',esc(v.vendor_id))}${kv('ประเภท',esc(v.vendor_type||'—'))}${kv('เลขภาษี',esc(v.tax_id||'—'))}${kv('ผู้ติดต่อ',esc((v.contact_name||'')+' '+(v.contact_phone||'')))}${kv('หมวด',esc(v.category||'—'))}${kv('เครดิต',(v.credit_terms||0)+' วัน')}${kv('ธนาคาร',esc((v.bank_name||'')+' '+(v.bank_account_no||'')))}</div>`; }
    else if(/^I\d/i.test(id)){ const d=await purGet('pur_item?item_id='+encodeURIComponent(id)); const it=d.item; if(!it)throw 0;
      const ph=(it.price_history||[]).map(p=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F1F5F9;font-size:12.5px"><span>${esc(p.purchase_date||'')} · ${esc(p.vendor_id||'')}</span><span style="font-weight:600">฿${purBaht(p.effective_unit_price||p.unit_price)} <span style="color:var(--text-muted)">×${p.qty}</span></span></div>`).join('')||'<div style="color:var(--text-muted);font-size:12px">ยังไม่มีประวัติราคา</div>';
      box.innerHTML=`<div class="card" style="padding:16px"><div style="font-weight:800;color:var(--navy);font-size:15px;margin-bottom:8px">${esc(it.item_name)} ${it.has_lot?'<span style="font-size:10px;background:#E0E7FF;color:#3730A3;padding:1px 7px;border-radius:99px">LOT</span>':''}</div>${kv('รหัส',esc(it.item_id))}${kv('SKU',esc(it.item_code||'—'))}${kv('หมวด',esc(it.category||'—'))}${kv('หน่วย',esc(it.uom||'—'))}${kv('สต็อกขั้นต่ำ',it.min_stock||0)}${kv('ราคาล่าสุด','฿'+purBaht(it.last_price||0))}<div style="margin-top:12px;font-weight:700;color:var(--navy);font-size:13px">ประวัติราคา</div>${ph}</div>`; }
    else if(/^RFQ/i.test(id)){ const r=await getRfq(id); if(!r)throw 0;
      const rows=(r.responses||[]).slice().sort((a,b)=>a.total_amount-b.total_amount).map((x,i)=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F1F5F9;font-size:12.5px"><span>${i===0?'🏆 ':''}${esc(x.vendor_id)}${r.winner_vendor_id===x.vendor_id?' (ผู้ชนะ)':''}</span><b>฿${purBaht(x.total_amount)}</b></div>`).join('')||'<div style="color:var(--text-muted);font-size:12px">ยังไม่มีผู้เสนอราคา</div>';
      box.innerHTML=`<div class="card" style="padding:16px"><div style="font-weight:800;color:var(--navy);font-size:15px;margin-bottom:8px">${esc(r.rfq_id)} ${purPill(_ST_PILL,r.status)||''}</div>${kv('หัวข้อ',esc(r.title))}${kv('สาขา',esc(r.branch_id))}${kv('เชิญ',(r.vendors||[]).length+' ราย')}<div style="margin-top:12px;font-weight:700;color:var(--navy);font-size:13px">ใบเสนอราคา</div>${rows}</div>`; }
    else if(/^PR-/i.test(id)){ const d=await purGet('pur_pr'); const pr=(d.prs||[]).find(p=>p.pr_id===id); if(!pr)throw 0;
      const ln=(pr.lines||[]).map(l=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12.5px"><span>${esc(l.item_name)} ×${l.qty}</span><span>฿${purBaht((l.qty||0)*(l.unit_price||0))}</span></div>`).join('');
      box.innerHTML=`<div class="card" style="padding:16px"><div style="font-weight:800;color:var(--navy);font-size:15px;margin-bottom:8px">${esc(pr.pr_id)} ${purPill(_ST_PILL,pr.status)||esc(pr.status)}</div>${kv('สาขา',esc(pr.branch_id))}${kv('ผู้ขอ',esc(pr.requestor_name||pr.requestor_id||'—'))}${kv('ยอดรวม','฿'+purBaht(pr.total_amount||0))}${kv('ขั้นอนุมัติ',(pr.current_tier||'—'))}<div style="margin-top:10px;font-weight:700;font-size:13px">รายการ</div>${ln}</div>`; }
    else if(/^PO-/i.test(id)){ const d=await purGet('pur_po'); const po=(d.pos||[]).find(p=>p.po_id===id); if(!po)throw 0;
      const ln=(po.lines||[]).map(l=>`<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12.5px"><span>${esc(l.item_name)} ×${l.qty}</span><span>฿${purBaht((l.qty||0)*(l.unit_price||0))}</span></div>`).join('');
      box.innerHTML=`<div class="card" style="padding:16px"><div style="font-weight:800;color:var(--navy);font-size:15px;margin-bottom:8px">${esc(po.po_id)} ${purPill(_ST_PILL,po.status)||esc(po.status)}</div>${kv('สาขา',esc(po.branch_id))}${kv('ผู้ขาย',esc(po.vendor_id||'—'))}${kv('ยอดก่อนภาษี','฿'+purBaht(po.subtotal||0))}${kv('VAT','฿'+purBaht(po.vat_amount||0))}${kv('หัก ณ ที่จ่าย','฿'+purBaht(po.wht_amount||0))}${kv('ยอดสุทธิ','฿'+purBaht(po.net_payable||po.grand_total||0))}<div style="margin-top:10px;font-weight:700;font-size:13px">รายการ</div>${ln}</div>`; }
    else { box.innerHTML='<div class="card" style="padding:16px;color:#991B1B">ไม่รู้จักรูปแบบเลขเอกสารนี้</div>'; return; }
  }catch(e){ box.innerHTML='<div class="card" style="padding:16px;color:#991B1B">ไม่พบเอกสาร '+esc(id)+'</div>'; }
}

/* ---------- บันทึกกิจกรรม (puractivity) ---------- */
function mountPurActivity(){ const w=$('wrap-puractivity'); if(!w)return; w.innerHTML='<div id="actBox">กำลังโหลด…</div>'; loadPurActivity(); }
async function loadPurActivity(){
  const d=await purGet('pur_activity?limit=150'); const acts=(d&&d.activities)||[];
  if(!acts.length){ $('actBox').innerHTML='<div class="card" style="padding:18px;text-align:center;color:var(--text-muted)">ยังไม่มีกิจกรรม</div>'; return; }
  $('actBox').innerHTML=`<div class="card" style="padding:6px 14px">${acts.map(a=>{ const t=a.when?new Date(a.when):null; const ts=t?t.toLocaleString('th-TH',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):''; return `<div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);font-size:12.5px;align-items:baseline">
     <span style="color:var(--text-muted);min-width:96px">${ts}</span>
     <span style="flex:1"><b style="color:var(--navy)">${esc(a.action_th||a.event_type)}</b> · ${esc(a.entity_id||'')}${a.detail?` <span style="color:#475569">— ${esc(a.detail)}</span>`:''}</span>
     <span style="color:#64748B">${esc(a.actor||'—')}</span></div>`; }).join('')}</div>`;
}

/* ---------- สแกนรับของ (purscan) ---------- */
let _qrLib=false, _qrInst=null, _itemIndex=null;
function loadQrLib(){ return new Promise((res,rej)=>{ if(_qrLib)return res(); const s=document.createElement('script'); s.src='https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload=()=>{_qrLib=true;res();}; s.onerror=rej; document.head.appendChild(s); }); }
async function buildItemIndex(){ const d=await purGet('pur_item'); _itemIndex={}; (d.items||[]).forEach(it=>{ if(it.item_code)_itemIndex[String(it.item_code).trim().toLowerCase()]=it; _itemIndex[String(it.item_id).toLowerCase()]=it; }); }
function mountPurScan(){
  const w=$('wrap-purscan'); if(!w)return;
  w.innerHTML=`<div class="card" style="padding:16px;margin-bottom:14px">
    <div style="font-weight:700;color:var(--navy);margin-bottom:8px">สแกนรับของเข้าสต็อก</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">เปิดกล้องสแกนบาร์โค้ด/QR ที่รหัสสินค้า (SKU) — หรือพิมพ์รหัสเองด้านล่าง</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button id="scStart" style="padding:9px 16px;background:var(--teal);color:#04342C;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit">📷 เปิดกล้องสแกน</button>
      <button id="scStop" style="padding:9px 16px;background:#F1F5F9;color:#475569;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-family:inherit;display:none">หยุด</button>
      <input id="scManual" placeholder="หรือพิมพ์ SKU/รหัสสินค้า" style="flex:1;min-width:160px;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit">
      <button id="scFind" style="padding:9px 16px;background:#EFF6FF;color:#1E40AF;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit">ค้นหา</button>
    </div>
    <div id="scReader" style="max-width:330px;margin:0 auto;border-radius:10px;overflow:hidden"></div>
    <div id="scMatch" style="margin-top:12px"></div>
  </div>`;
  $('scStart').onclick=scStart; $('scStop').onclick=scStop; $('scFind').onclick=()=>scMatch($('scManual').value.trim());
  $('scManual').addEventListener('keydown',e=>{if(e.key==='Enter')scMatch($('scManual').value.trim());});
}
async function scStart(){
  try{ await loadQrLib(); }catch(e){ alert('โหลดตัวสแกนไม่ได้ (เน็ต?)'); return; }
  if(!_itemIndex) await buildItemIndex();
  $('scStop').style.display=''; $('scStart').style.display='none';
  _qrInst=new Html5Qrcode('scReader');
  _qrInst.start({facingMode:'environment'},{fps:10,qrbox:230},(txt)=>{ scStop(); scMatch(txt); },()=>{}).catch(e=>{ alert('เปิดกล้องไม่ได้: '+e); scStop(); });
}
function scStop(){ $('scStop').style.display='none'; $('scStart').style.display=''; if(_qrInst){ _qrInst.stop().then(()=>{_qrInst.clear();_qrInst=null;}).catch(()=>{_qrInst=null;}); } }
async function scMatch(code){
  if(!code)return; if(!_itemIndex) await buildItemIndex();
  const it=_itemIndex[String(code).trim().toLowerCase()];
  const box=$('scMatch');
  if(!it){ box.innerHTML=`<div class="card" style="padding:14px;border-left:3px solid #EF4444"><div style="color:#991B1B;font-weight:700">ไม่พบสินค้า code: ${esc(code)}</div><div style="font-size:12px;color:var(--text-muted);margin-top:4px">เพิ่มสินค้าในเมนู "สินค้า" ก่อน (ตั้ง SKU = บาร์โค้ด)</div></div>`; return; }
  box.innerHTML=`<div class="card" style="padding:14px;border-left:3px solid var(--teal)">
    <div style="font-weight:800;color:var(--navy)">${esc(it.item_name)} <span style="font-size:11px;color:var(--text-muted)">${esc(it.item_id)} · ${esc(it.item_code||'')}</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:10px 0">
      <input id="scBranch" placeholder="สาขา" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">
      <input id="scQty" type="number" placeholder="จำนวนรับเข้า" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">
      ${it.has_lot?'<input id="scLot" placeholder="เลข lot" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit"><input id="scExp" type="date" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:12.5px;font-family:inherit">':''}
    </div>
    <button id="scRecv" style="padding:9px 18px;background:var(--teal);color:#04342C;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit">รับเข้าสต็อก</button> <span id="scMsg" style="font-size:12px;color:var(--text-muted)"></span>
  </div>`;
  $('scRecv').onclick=async()=>{
    const branch=$('scBranch').value.trim(), qty=Number($('scQty').value)||0;
    if(!branch||qty<=0){ $('scMsg').textContent='ใส่สาขา + จำนวน'; return; }
    $('scMsg').textContent='กำลังรับเข้า…';
    let body;
    if(it.has_lot){ body={action:'create_lot',item_id:it.item_id,branch_id:branch,lot_number:($('scLot')?.value||'').trim(),expiry_date:($('scExp')?.value||''),initial_qty:qty,...purActor()}; }
    else { body={action:'move',item_id:it.item_id,branch_id:branch,move_type:'IN-PO',qty,ref_doc_type:'Scan',...purActor()}; }
    const {data,error}=await sb.functions.invoke('pur_stock',{body});
    $('scMsg').textContent=error||data?.error?('ผิดพลาด: '+(data?.error||error.message)):(`รับเข้า ${it.item_name} +${qty} ✓`);
    if(!error&&!data?.error){ $('scQty').value=''; }
  };
}
