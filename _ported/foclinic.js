// _ported/foclinic.js — Native page "FO · คลินิก" — ข้อมูลจริงจาก JERA + จัดการนัด (write)
// นัดวันนี้ (กดยืนยัน/เช็คอิน/ยกเลิก/ไม่มา = เขียน fo.appointment จริง) · คอร์สใกล้จบ · รายได้
// pattern: mountFoclinic → #wrap-foclinic · window.sb.schema('fo') · prefix fcl_ · ไม่มี emoji

function fcl_num(v){var n=Number(v);return isFinite(n)?n:0;}
function fcl_fmt(v){return fcl_num(v).toLocaleString('th-TH');}
function fcl_baht(v){return '฿'+fcl_num(v).toLocaleString('th-TH',{maximumFractionDigits:0});}
function fcl_esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];});}
function fcl_today(){try{return new Date().toLocaleDateString('en-CA');}catch(e){return new Date().toISOString().slice(0,10);}}
function fcl_dateTH(s){if(!s)return'-';var d=new Date(s);if(isNaN(d.getTime()))return String(s).slice(0,10);try{return d.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'});}catch(e){return String(s).slice(0,10);}}
function fcl_sb(){return (typeof window!=='undefined'&&window.sb)?window.sb:(typeof sb!=='undefined'?sb:null);}
var FCL_ST={booked:'รอยืนยัน',confirmed:'ยืนยันแล้ว',checked_in:'เช็คอิน',in_progress:'กำลังรักษา',completed:'เสร็จสิ้น',cancelled:'ยกเลิก',no_show:'ไม่มาตามนัด'};
var fcl_staffMap={}, fcl_todayStr='', fcl_busy=false;

// ปุ่ม action ตามสถานะ (id, currentStatus) -> HTML
function fcl_btns(id, st){
  function b(label,to,cls,cf){return '<button class="fc-btn '+cls+'" onclick="window.fcl_act(\''+id+'\',\''+to+'\','+(cf?'1':'0')+')">'+label+'</button>';}
  var out=[];
  if(st==='booked') out.push(b('ยืนยัน','confirmed','fc-b-teal',0));
  if(st==='booked'||st==='confirmed') out.push(b('เช็คอิน','checked_in','fc-b-navy',0));
  if(st==='checked_in') out.push(b('เสร็จ','completed','fc-b-green',0));
  if(st==='booked'||st==='confirmed'||st==='checked_in'){
    out.push(b('ไม่มา','no_show','fc-b-gray',1));
    out.push(b('ยกเลิก','cancelled','fc-b-red',1));
  }
  return out.join('');
}

// เขียนสถานะนัดกลับ fo.appointment (write จริง)
if(typeof window!=='undefined') window.fcl_act=function(id,status,needCf){
  if(fcl_busy) return;
  if(needCf && !window.confirm('ยืนยันเปลี่ยนสถานะเป็น "'+(FCL_ST[status]||status)+'" ?')) return;
  var sb=fcl_sb(); if(!sb||!sb.schema) return;
  fcl_busy=true;
  sb.schema('fo').from('appointment').update({status:status}).eq('id',id)
    .then(function(res){
      fcl_busy=false;
      if(res.error){ alert('บันทึกไม่ได้: '+res.error.message); return; }
      fcl_loadAppt();   // refresh เฉพาะส่วนนัด
    }).catch(function(e){ fcl_busy=false; alert('บันทึกไม่ได้: '+(e&&e.message)); });
};

function fcl_loadAppt(){
  var sb=fcl_sb(); var box=document.getElementById('fclAppt'); if(!sb||!box) return;
  sb.schema('fo').from('appointment').select('id,start_time,patient_name,doctor_id,status,service_type')
    .eq('appointment_date',fcl_todayStr).order('start_time',{ascending:true}).limit(100)
    .then(function(res){
      if(res.error){box.innerHTML='<div class="fc-empty">โหลดไม่ได้: '+fcl_esc(res.error.message)+'</div>';return;}
      var rows=res.data||[];
      if(!rows.length){box.innerHTML='<div class="fc-empty">วันนี้ไม่มีนัด</div>';return;}
      var h='<table><thead><tr><th>เวลา</th><th>คนไข้</th><th>หมอ/PT</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>';
      rows.forEach(function(r){
        var st=FCL_ST[r.status]||r.status||'-';
        var col=r.status==='cancelled'||r.status==='no_show'?'#DC2626':r.status==='completed'?'#16A34A':r.status==='checked_in'?'#0F766E':'#0D2F4F';
        h+='<tr><td>'+fcl_esc((r.start_time||'').slice(0,5))+'</td><td>'+fcl_esc(r.patient_name||'-')+
           '</td><td>'+fcl_esc(fcl_staffMap[r.doctor_id]||'-')+
           '</td><td><span class="fc-pill" style="background:#E6F7F5;color:'+col+'">'+fcl_esc(st)+'</span></td>'+
           '<td><div class="fc-acts">'+fcl_btns(r.id,r.status)+'</div></td></tr>';
      });
      box.innerHTML=h+'</tbody></table>';
    }).catch(function(){box.innerHTML='<div class="fc-empty">โหลดไม่ได้</div>';});
}

function mountFoclinic(){
  var wrap=document.getElementById('wrap-foclinic'); if(!wrap) return;
  var sb=fcl_sb();
  fcl_todayStr=fcl_today();
  wrap.innerHTML=
    '<style>'+
    '#fcl .fc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:4px 0 20px}'+
    '#fcl .fc-card{background:#E6F7F5;border-radius:12px;padding:14px 16px}'+
    '#fcl .fc-lab{display:flex;align-items:center;gap:6px;color:#6B7280;font-size:13px}#fcl .fc-lab i{color:#3DC5B7;font-size:16px}'+
    '#fcl .fc-val{color:#0D2F4F;font-size:23px;font-weight:600;margin-top:4px}#fcl .fc-sub{font-size:11.5px;color:#6B7280;font-weight:400}'+
    '#fcl .fc-sec{font-size:14px;font-weight:600;color:#0D2F4F;margin:20px 0 10px;display:flex;align-items:center;gap:7px}#fcl .fc-sec i{color:#3DC5B7;font-size:17px}'+
    '#fcl .fc-tw{background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden}'+
    '#fcl table{width:100%;border-collapse:collapse;font-size:13px}'+
    '#fcl thead tr{background:#0D2F4F;color:#fff;text-align:left}#fcl th,#fcl td{padding:8px 14px}#fcl td.r,#fcl th.r{text-align:right}'+
    '#fcl tbody tr{border-bottom:1px solid #eef0f2}#fcl tbody tr:hover{background:#E6F7F580}'+
    '#fcl .fc-pill{font-size:11.5px;padding:2px 9px;border-radius:20px}'+
    '#fcl .fc-acts{display:flex;gap:5px;flex-wrap:wrap}'+
    '#fcl .fc-btn{font-size:11.5px;padding:3px 9px;border:none;border-radius:7px;cursor:pointer;font-weight:500}'+
    '#fcl .fc-b-teal{background:#3DC5B7;color:#04342C}#fcl .fc-b-navy{background:#0D2F4F;color:#fff}'+
    '#fcl .fc-b-green{background:#16A34A;color:#fff}#fcl .fc-b-gray{background:#E5E7EB;color:#374151}#fcl .fc-b-red{background:#FEE2E2;color:#DC2626}'+
    '#fcl .fc-empty{padding:18px;text-align:center;color:#6B7280;font-size:13px}'+
    '</style>'+
    '<div id="fcl">'+
    '<div class="fc-grid">'+
    '<div class="fc-card"><div class="fc-lab"><i class="ti ti-calendar-event"></i>นัดวันนี้</div><div class="fc-val" id="fclK_appt">…</div></div>'+
    '<div class="fc-card"><div class="fc-lab"><i class="ti ti-stethoscope"></i>ประวัติรักษา</div><div class="fc-val" id="fclK_visit">…</div></div>'+
    '<div class="fc-card"><div class="fc-lab"><i class="ti ti-clipboard-list"></i>คอร์ส active</div><div class="fc-val" id="fclK_course">…</div></div>'+
    '<div class="fc-card"><div class="fc-lab"><i class="ti ti-cash"></i>รายได้วันนี้</div><div class="fc-val" id="fclK_rev">…</div></div>'+
    '</div>'+
    '<div class="fc-sec"><i class="ti ti-calendar-time"></i>นัดหมายวันนี้ — กดจัดการได้</div>'+
    '<div class="fc-tw" id="fclAppt"><div class="fc-empty">กำลังโหลด…</div></div>'+
    '<div class="fc-sec"><i class="ti ti-hourglass-low"></i>คอร์สใกล้จบ (เหลือ ≤2 ครั้ง) → เสนอขายต่อ</div>'+
    '<div class="fc-tw" id="fclUpsell"><div class="fc-empty">กำลังโหลด…</div></div>'+
    '<div class="fc-sec"><i class="ti ti-chart-bar"></i>รายได้รายวัน 14 วันล่าสุด</div>'+
    '<div class="fc-tw" id="fclRev"><div class="fc-empty">กำลังโหลด…</div></div>'+
    '</div>';
  if(!sb||!sb.schema){document.getElementById('fclAppt').innerHTML='<div class="fc-empty">เชื่อมต่อฐานข้อมูลไม่ได้</div>';return;}
  var S=function(){return sb.schema('fo');};

  // staff map → แล้วโหลดนัด
  S().from('staff').select('id,nickname,full_name').then(function(res){
    (res.data||[]).forEach(function(s){fcl_staffMap[s.id]=s.nickname||s.full_name;});
    fcl_loadAppt();
  }).catch(function(){fcl_loadAppt();});

  // KPI
  function cnt(tbl,build){var q=S().from(tbl).select('*',{count:'exact',head:true});if(build)q=build(q);return q.then(function(r){return r.count||0;}).catch(function(){return 0;});}
  cnt('appointment',function(q){return q.eq('appointment_date',fcl_todayStr);}).then(function(n){document.getElementById('fclK_appt').textContent=fcl_fmt(n);});
  cnt('visit').then(function(n){document.getElementById('fclK_visit').textContent=fcl_fmt(n);});
  cnt('course',function(q){return q.eq('status','active');}).then(function(n){document.getElementById('fclK_course').textContent=fcl_fmt(n);});
  S().from('v_revenue_daily').select('revenue_total,receipts').eq('sale_date',fcl_todayStr).then(function(res){
    var r=(res.data&&res.data[0])||{};document.getElementById('fclK_rev').innerHTML=fcl_baht(r.revenue_total)+' <span class="fc-sub">'+fcl_fmt(r.receipts)+' บิล</span>';
  }).catch(function(){document.getElementById('fclK_rev').textContent='฿0';});

  // คอร์สใกล้จบ
  S().from('v_course_upsell').select('product_name,sessions_used,sessions_total,sessions_remaining,pct_used').order('pct_used',{ascending:false}).limit(50).then(function(res){
    var box=document.getElementById('fclUpsell');if(!box)return;
    if(res.error){box.innerHTML='<div class="fc-empty">โหลดไม่ได้</div>';return;}
    var rows=res.data||[];
    if(!rows.length){box.innerHTML='<div class="fc-empty">ยังไม่มีคอร์สใกล้จบ</div>';return;}
    var h='<table><thead><tr><th>คอร์ส</th><th class="r">ใช้/รวม</th><th class="r">เหลือ</th><th class="r">%</th></tr></thead><tbody>';
    rows.forEach(function(r){h+='<tr><td>'+fcl_esc(r.product_name||'-')+'</td><td class="r">'+fcl_fmt(r.sessions_used)+'/'+fcl_fmt(r.sessions_total)+'</td><td class="r">'+fcl_fmt(r.sessions_remaining)+'</td><td class="r">'+fcl_fmt(r.pct_used)+'%</td></tr>';});
    box.innerHTML=h+'</tbody></table>';
  }).catch(function(){var b=document.getElementById('fclUpsell');if(b)b.innerHTML='<div class="fc-empty">โหลดไม่ได้</div>';});

  // รายได้รายวัน
  S().from('v_revenue_daily').select('sale_date,revenue_total,receipts').order('sale_date',{ascending:false}).limit(14).then(function(res){
    var box=document.getElementById('fclRev');if(!box)return;
    if(res.error){box.innerHTML='<div class="fc-empty">โหลดไม่ได้</div>';return;}
    var rows=res.data||[];
    if(!rows.length){box.innerHTML='<div class="fc-empty">ยังไม่มีข้อมูลรายได้</div>';return;}
    var h='<table><thead><tr><th>วันที่</th><th class="r">ยอดขาย</th><th class="r">บิล</th></tr></thead><tbody>';
    rows.forEach(function(r){h+='<tr><td>'+fcl_dateTH(r.sale_date)+'</td><td class="r">'+fcl_baht(r.revenue_total)+'</td><td class="r">'+fcl_fmt(r.receipts)+'</td></tr>';});
    box.innerHTML=h+'</tbody></table>';
  }).catch(function(){var b=document.getElementById('fclRev');if(b)b.innerHTML='<div class="fc-empty">โหลดไม่ได้</div>';});
}

if(typeof window!=='undefined') window.mountFoclinic=mountFoclinic;
