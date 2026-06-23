/* _ported/oneonone.js
 * Native port ของหน้า "1:1 Log" เดิม (Apps Script: one_on_one_manager.html)
 * Pattern: เลียนแบบ mountExpense() ใน index.html — scoped CSS prefix #oo + id prefix oo-
 * ใช้ global `sb` (supabase client) + `esc` (html escaper) ที่ index.html ประกาศไว้แล้ว (ห้าม redeclare)
 * Mount เข้า #wrap-oneonone · set badge #ct-oneonone
 *
 * Edge Function:
 *   create : sb.functions.invoke('hr_oneonone',{body:{employee_id,supervisor_id,session_date,
 *            mode,topic,notes,action_items,sentiment,next_date}})  · mode = in_person|video|phone
 *   list   : sb.functions.invoke('hr_oneonone') -> {items:[...]}
 */

function mountOneonone(){
  if(typeof $!=='undefined'){ if(!$('wrap-oneonone'))return; }
  var wrap=document.getElementById('wrap-oneonone'); if(!wrap)return;

  wrap.innerHTML=`
  <style>
  #oo{--onavy:#0D2F4F;--oteal:#3DC5B7;--otealdk:#0F766E;--oline:#E5E7EB;--omuted:#6B7280;max-width:480px;margin:0 auto}
  #oo .oo-head{position:relative;background:linear-gradient(135deg,var(--onavy),var(--otealdk));color:#fff;padding:16px;border-radius:12px;overflow:hidden}
  #oo .oo-blob{position:absolute;width:120px;height:120px;border-radius:50%;background:#ffffff14;top:-44px;right:-36px}
  #oo .oo-eb{font-size:12px;color:var(--oteal);font-weight:600;position:relative}
  #oo .oo-h1{font-size:18px;font-weight:600;margin:6px 0 0;position:relative}
  #oo .oo-card{background:#fff;border-radius:12px;border:.5px solid rgba(0,0,0,.1);margin:14px 0;padding:16px}
  #oo .oo-sec{font-size:13px;color:var(--onavy);font-weight:600;margin:0 0 10px}
  #oo label{display:block;font-size:12px;color:var(--omuted);margin:10px 0 4px}
  #oo select,#oo input,#oo textarea{width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:14px;background:#fff;font-family:inherit;box-sizing:border-box}
  #oo textarea{min-height:56px;resize:vertical}
  #oo .oo-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  #oo .oo-mode{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:4px}
  #oo .oo-mbtn{padding:10px 6px;border:1px solid #CBD5E1;border-radius:8px;background:#fff;text-align:center;font-size:13px;font-weight:500;color:var(--omuted);cursor:pointer}
  #oo .oo-mbtn.sel{background:var(--onavy);color:#fff;border-color:var(--onavy)}
  #oo .oo-sent{display:flex;gap:6px;margin-top:4px}
  #oo .oo-sbtn{flex:1;padding:8px 4px;border:1px solid #CBD5E1;border-radius:8px;background:#fff;text-align:center;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
  #oo .oo-sbtn .n{font-size:16px;font-weight:600;color:var(--onavy);line-height:1}
  #oo .oo-sbtn .l{font-size:9px;color:var(--omuted)}
  #oo .oo-sbtn.sel{border-width:2px}
  #oo .oo-sbtn[data-s="1"].sel{background:#FEE2E2;border-color:#B91C1C}
  #oo .oo-sbtn[data-s="2"].sel{background:#FEF3C7;border-color:#B45309}
  #oo .oo-sbtn[data-s="3"].sel{background:#F1F5F9;border-color:var(--onavy)}
  #oo .oo-sbtn[data-s="4"].sel{background:#DBEAFE;border-color:#1D4ED8}
  #oo .oo-sbtn[data-s="5"].sel{background:#D1FAE5;border-color:#047857}
  #oo .oo-hint{font-size:11px;color:var(--omuted);margin-top:6px;line-height:1.45}
  #oo .oo-cta button{width:100%;padding:13px;border:0;border-radius:10px;background:var(--oteal);color:#04342C;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;margin:4px 0 14px}
  #oo .oo-cta button:disabled{opacity:.55;cursor:default}
  #oo .oo-row{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:.5px solid var(--oline)}
  #oo .oo-row:last-child{border-bottom:0}
  #oo .oo-pill{font-size:11px;font-weight:600;padding:3px 9px;border-radius:10px;background:#FAEEDA;color:#854F0B}
  #oo .oo-pill.ap{background:#E6F7F5;color:#0F766E}#oo .oo-pill.rj{background:#FCEBEB;color:#791F1F}
  #oo .oo-badge{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:600;color:#fff}
  #oo .oo-badge[data-s="1"]{background:#B91C1C}#oo .oo-badge[data-s="2"]{background:#B45309}
  #oo .oo-badge[data-s="3"]{background:var(--onavy)}#oo .oo-badge[data-s="4"]{background:#1D4ED8}
  #oo .oo-badge[data-s="5"]{background:#047857}
  #oo .oo-empty{color:var(--omuted);font-size:13px;text-align:center;padding:14px}
  </style>
  <div id="oo">
   <div class="oo-head"><div class="oo-blob"></div><div class="oo-eb">1:1 LOG · บันทึก 1-on-1</div><div class="oo-h1">บันทึกการคุย / ดูประวัติ</div></div>
   <div class="oo-card"><div class="oo-sec">บันทึกใหม่</div>
    <div class="oo-grid2">
     <div><label>รหัสพนักงาน</label><input id="oo-emp" placeholder="YY-XNU-013"></div>
     <div><label>หัวหน้า</label><input id="oo-sup" placeholder="YY-..."></div>
    </div>
    <label>วันที่คุย</label><input id="oo-date" type="date">
    <label>รูปแบบ</label>
    <div class="oo-mode">
     <div class="oo-mbtn sel" data-mode="in_person">พบเจอกัน</div>
     <div class="oo-mbtn" data-mode="video">วิดีโอ</div>
     <div class="oo-mbtn" data-mode="phone">โทรศัพท์</div>
    </div>
    <label>หัวข้อ / agenda</label><textarea id="oo-topic" placeholder="ติดตามงาน · ฟีดแบค · ปัญหาที่อยากคุย"></textarea>
    <label>บันทึกการคุย / สรุปประเด็น</label><textarea id="oo-notes" placeholder="สรุปสิ่งที่คุยกัน"></textarea>
    <label>Action items (สิ่งที่ต้องทำต่อ)</label><textarea id="oo-action" placeholder="follow-up tasks"></textarea>
    <label>พนักงานรู้สึกยังไง? (ไม่บังคับ)</label>
    <div class="oo-sent" id="oo-sent">
     <div class="oo-sbtn" data-s="1"><span class="n">1</span><span class="l">เครียดมาก</span></div>
     <div class="oo-sbtn" data-s="2"><span class="n">2</span><span class="l">ไม่ค่อยดี</span></div>
     <div class="oo-sbtn" data-s="3"><span class="n">3</span><span class="l">ปกติ</span></div>
     <div class="oo-sbtn" data-s="4"><span class="n">4</span><span class="l">ดี</span></div>
     <div class="oo-sbtn" data-s="5"><span class="n">5</span><span class="l">ดีมาก</span></div>
    </div>
    <div class="oo-hint">ไม่กด = ไม่ระบุ (จะไม่เข้า average)</div>
    <label>นัดครั้งถัดไป (ถ้ามี)</label><input id="oo-next" type="date">
   </div>
   <div class="oo-cta"><button id="oo-btn">บันทึก 1:1</button></div>
   <div class="oo-card"><div class="oo-sec">ประวัติการคุย</div><div id="oo-hist"><div class="oo-empty">กำลังโหลด...</div></div></div>
  </div>`;

  // mode selector (var/fn prefix oo)
  var ooMode='in_person';
  Array.prototype.forEach.call(document.querySelectorAll('#oo .oo-mbtn'),function(b){
    b.onclick=function(){
      ooMode=b.getAttribute('data-mode');
      Array.prototype.forEach.call(document.querySelectorAll('#oo .oo-mbtn'),function(x){ x.classList.toggle('sel',x===b); });
    };
  });

  // sentiment selector (0 = ไม่ระบุ)
  var ooSent=0;
  Array.prototype.forEach.call(document.querySelectorAll('#oo .oo-sbtn'),function(b){
    b.onclick=function(){
      var v=Number(b.getAttribute('data-s'));
      ooSent=(ooSent===v)?0:v;
      Array.prototype.forEach.call(document.querySelectorAll('#oo .oo-sbtn'),function(x){
        x.classList.toggle('sel',Number(x.getAttribute('data-s'))===ooSent);
      });
    };
  });

  // expose current selections + reset to submit handler (closure vars live here)
  window.__ooGetMode=function(){ return ooMode; };
  window.__ooGetSent=function(){ return ooSent; };
  window.__ooResetSel=function(){
    ooMode='in_person'; ooSent=0;
    Array.prototype.forEach.call(document.querySelectorAll('#oo .oo-mbtn'),function(x){
      x.classList.toggle('sel',x.getAttribute('data-mode')==='in_person');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#oo .oo-sbtn'),function(x){ x.classList.remove('sel'); });
  };

  document.getElementById('oo-btn').onclick=ooSubmit;
  ooLoad();
}

async function ooLoad(){
  try{
    var res=await sb.functions.invoke('hr_oneonone');
    var data=res&&res.data; var items=(data&&data.items)||[];
    var host=document.getElementById('oo-hist'); if(!host)return;
    host.innerHTML=items.length?items.map(function(x){
      var st=x.status||'';
      var pill=st==='approved'?'ap':(st==='rejected'?'rj':'');
      var s=Number(x.sentiment||0);
      var badge=(s>=1&&s<=5)?'<span class="oo-badge" data-s="'+s+'">'+s+'</span>':'';
      var modeLbl=x.mode==='video'?'วิดีโอ':(x.mode==='phone'?'โทร':'พบตัว');
      var head=esc(x.employee_id||'')+(x.session_date?' · '+esc(x.session_date):'');
      var sub=esc(x.topic||x.notes||'')||modeLbl;
      return '<div class="oo-row">'
        +'<div style="min-width:0"><div>'+head+'</div>'
        +'<div style="font-size:11px;color:#6B7280">'+sub+'</div></div>'
        +'<div style="text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px">'
        +(badge||'')
        +'<span class="oo-pill '+pill+'">'+(esc(st)||modeLbl)+'</span></div>'
        +'</div>';
    }).join(''):'<div class="oo-empty">ยังไม่มีบันทึก 1:1</div>';
    var ct=document.getElementById('ct-oneonone'); if(ct)ct.textContent=items.length||'';
  }catch(e){ console.error('oneonone',e);
    var h=document.getElementById('oo-hist'); if(h)h.innerHTML='<div class="oo-empty">โหลดประวัติไม่สำเร็จ</div>';
  }
}

async function ooSubmit(){
  var emp=document.getElementById('oo-emp').value.trim();
  if(!emp){ alert('กรอกรหัสพนักงาน'); return; }

  var sentVal=(typeof window.__ooGetSent==='function')?window.__ooGetSent():0;
  var body={
    employee_id:   emp,
    supervisor_id: document.getElementById('oo-sup').value.trim(),
    session_date:  document.getElementById('oo-date').value,
    mode:          (typeof window.__ooGetMode==='function')?window.__ooGetMode():'in_person',
    topic:         document.getElementById('oo-topic').value.trim(),
    notes:         document.getElementById('oo-notes').value.trim(),
    action_items:  document.getElementById('oo-action').value.trim(),
    sentiment:     sentVal,
    next_date:     document.getElementById('oo-next').value
  };

  var btn=document.getElementById('oo-btn');
  btn.disabled=true; btn.textContent='กำลังบันทึก...';
  try{
    var res=await sb.functions.invoke('hr_oneonone',{body:body});
    var data=res&&res.data, error=res&&res.error;
    if(error||(data&&data.error)){
      alert('ไม่สำเร็จ: '+((data&&data.error)||(error&&error.message)||'unknown'));
      return;
    }
    // เคลียร์ฟอร์ม
    ['oo-emp','oo-sup','oo-date','oo-topic','oo-notes','oo-action','oo-next'].forEach(function(id){
      var el=document.getElementById(id); if(el)el.value='';
    });
    // reset mode + sentiment (closure state + UI)
    if(typeof window.__ooResetSel==='function') window.__ooResetSel();
    ooLoad();
  }catch(e){
    alert('ไม่สำเร็จ: '+(e&&e.message||e));
  }finally{
    btn.disabled=false; btn.textContent='บันทึก 1:1';
  }
}
