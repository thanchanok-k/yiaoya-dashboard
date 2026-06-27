// _ported/foclinic.js — Native page "FO · คลินิก" — อ่านข้อมูลจริงจาก JERA ETL
// นัดวันนี้ · คอร์สใกล้จบ · รายได้รายวัน — อ่าน fo.appointment/course/receipt/views
// pattern เดียวกับ foops.js: mountFoclinic → #wrap-foclinic · window.sb.schema('fo') · read-only · ไม่มี emoji
// prefix fcl_

function fcl_num(v){var n=Number(v);return isFinite(n)?n:0;}
function fcl_fmt(v){return fcl_num(v).toLocaleString('th-TH');}
function fcl_baht(v){return '฿'+fcl_num(v).toLocaleString('th-TH',{maximumFractionDigits:0});}
function fcl_esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c];});}
function fcl_today(){try{return new Date().toLocaleDateString('en-CA');}catch(e){return new Date().toISOString().slice(0,10);}}
function fcl_dateTH(s){if(!s)return'-';var d=new Date(s);if(isNaN(d.getTime()))return String(s).slice(0,10);try{return d.toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'});}catch(e){return String(s).slice(0,10);}}
function fcl_sb(){return (typeof window!=='undefined'&&window.sb)?window.sb:(typeof sb!=='undefined'?sb:null);}
var FCL_ST={booked:'รอยืนยัน',confirmed:'ยืนยันแล้ว',checked_in:'เช็คอิน',in_progress:'กำลังรักษา',completed:'เสร็จสิ้น',cancelled:'ยกเลิก',no_show:'ไม่มาตามนัด'};

function mountFoclinic(){
  var wrap=document.getElementById('wrap-foclinic'); if(!wrap) return;
  var sb=fcl_sb();
  wrap.innerHTML=
    '<style>'+
    '#fcl .fc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:4px 0 20px}'+
    '#fcl .fc-card{background:#E6F7F5;border-radius:12px;padding:14px 16px}'+
    '#fcl .fc-lab{display:flex;align-items:center;gap:6px;color:#6B7280;font-size:13px}'+
    '#fcl .fc-lab i{color:#3DC5B7;font-size:16px}'+
    '#fcl .fc-val{color:#0D2F4F;font-size:23px;font-weight:600;margin-top:4px}'+
    '#fcl .fc-sub{font-size:11.5px;color:#6B7280;font-weight:400}'+
    '#fcl .fc-sec{font-size:14px;font-weight:600;color:#0D2F4F;margin:20px 0 10px;display:flex;align-items:center;gap:7px}'+
    '#fcl .fc-sec i{color:#3DC5B7;font-size:17px}'+
    '#fcl .fc-tw{background:#fff;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden}'+
    '#fcl table{width:100%;border-collapse:collapse;font-size:13px}'+
    '#fcl thead tr{background:#0D2F4F;color:#fff;text-align:left}'+
    '#fcl th,#fcl td{padding:8px 14px}#fcl td.r,#fcl th.r{text-align:right}'+
    '#fcl tbody tr{border-bottom:1px solid #eef0f2}#fcl tbody tr:hover{background:#E6F7F580}'+
    '#fcl .fc-pill{font-size:11.5px;padding:2px 9px;border-radius:20px}'+
    '#fcl .fc-empty{padding:18px;text-align:center;color:#6B7280;font-size:13px}'+
    '</style>'+
    '<div id="fcl">'+
    '<div class="fc-grid">'+
    '<div class="fc-card"><div class="fc-lab"><i class="ti ti-calendar-event"></i>นัดวันนี้</div><div class="fc-val" id="fclK_appt">…</div></div>'+
    '<div class="fc-card"><div class="fc-lab"><i class="ti ti-stethoscope"></i>ประวัติรักษา</div><div class="fc-val" id="fclK_visit">…</div></div>'+
    '<div class="fc-card"><div class="fc-lab"><i class="ti ti-clipboard-list"></i>คอร์ส active</div><div class="fc-val" id="fclK_course">…</div></div>'+
    '<div class="fc-card"><div class="fc-lab"><i class="ti ti-cash"></i>รายได้วันนี้</div><div class="fc-val" id="fclK_rev">…</div></div>'+
    '</div>'+
    '<div class="fc-sec"><i class="ti ti-calendar-time"></i>นัดหมายวันนี้</div>'+
    '<div class="fc-tw" id="fclAppt"><div class="fc-empty">กำลังโหลด…</div></div>'+
    '<div class="fc-sec"><i class="ti ti-hourglass-low"></i>คอร์สใกล้จบ (เหลือ ≤2 ครั้ง) → เสนอขายต่อ</div>'+
    '<div class="fc-tw" id="fclUpsell"><div class="fc-empty">กำลังโหลด…</div></div>'+
    '<div class="fc-sec"><i class="ti ti-chart-bar"></i>รายได้รายวัน 14 วันล่าสุด</div>'+
    '<div class="fc-tw" id="fclRev"><div class="fc-empty">กำลังโหลด…</div></div>'+
    '</div>';
  if(!sb||!sb.schema){document.getElementById('fclAppt').innerHTML='<div class="fc-empty">เชื่อมต่อฐานข้อมูลไม่ได้</div>';return;}
  var S=function(){return sb.schema('fo');};
  var today=fcl_today();

  // ---- staff map (id -> ชื่อ) ----
  var staffMap={};
  S().from('staff').select('id,nickname,full_name').then(function(res){
    (res.data||[]).forEach(function(s){staffMap[s.id]=s.nickname||s.full_name;});
    loadAppt();
  }).catch(function(){loadAppt();});

  // ---- KPI ----
  function cnt(tbl,build){var q=S().from(tbl).select('*',{count:'exact',head:true});if(build)q=build(q);return q.then(function(r){return r.count||0;}).catch(function(){return 0;});}
  cnt('appointment',function(q){return q.eq('appointment_date',today);}).then(function(n){document.getElementById('fclK_appt').textContent=fcl_fmt(n);});
  cnt('visit').then(function(n){document.getElementById('fclK_visit').textContent=fcl_fmt(n);});
  cnt('course',function(q){return q.eq('status','active');}).then(function(n){document.getElementById('fclK_course').textContent=fcl_fmt(n);});
  S().from('v_revenue_daily').select('revenue_total,receipts').eq('sale_date',today).then(function(res){
    var r=(res.data&&res.data[0])||{};
    document.getElementById('fclK_rev').innerHTML=fcl_baht(r.revenue_total)+' <span class="fc-sub">'+fcl_fmt(r.receipts)+' บิล</span>';
  }).catch(function(){document.getElementById('fclK_rev').textContent='฿0';});

  // ---- นัดวันนี้ ----
  function loadAppt(){
    S().from('appointment').select('start_time,patient_name,doctor_id,status,service_type')
      .eq('appointment_date',today).order('start_time',{ascending:true}).limit(80)
      .then(function(res){
        var box=document.getElementById('fclAppt');if(!box)return;
        if(res.error){box.innerHTML='<div class="fc-empty">โหลดไม่ได้: '+fcl_esc(res.error.message)+'</div>';return;}
        var rows=res.data||[];
        if(!rows.length){box.innerHTML='<div class="fc-empty">วันนี้ไม่มีนัด</div>';return;}
        var h='<table><thead><tr><th>เวลา</th><th>คนไข้</th><th>หมอ/PT</th><th>บริการ</th><th>สถานะ</th></tr></thead><tbody>';
        rows.forEach(function(r){
          var st=FCL_ST[r.status]||r.status||'-';
          var col=r.status==='cancelled'||r.status==='no_show'?'#DC2626':r.status==='completed'?'#16A34A':'#0D2F4F';
          h+='<tr><td>'+fcl_esc((r.start_time||'').slice(0,5))+'</td><td>'+fcl_esc(r.patient_name||'-')+
             '</td><td>'+fcl_esc(staffMap[r.doctor_id]||'-')+'</td><td>'+fcl_esc(r.service_type||'-')+
             '</td><td><span class="fc-pill" style="background:#E6F7F5;color:'+col+'">'+fcl_esc(st)+'</span></td></tr>';
        });
        box.innerHTML=h+'</tbody></table>';
      }).catch(function(e){var b=document.getElementById('fclAppt');if(b)b.innerHTML='<div class="fc-empty">โหลดไม่ได้</div>';});
  }

  // ---- คอร์สใกล้จบ ----
  S().from('v_course_upsell').select('product_name,sessions_used,sessions_total,sessions_remaining,pct_used')
    .order('pct_used',{ascending:false}).limit(50).then(function(res){
      var box=document.getElementById('fclUpsell');if(!box)return;
      if(res.error){box.innerHTML='<div class="fc-empty">โหลดไม่ได้: '+fcl_esc(res.error.message)+'</div>';return;}
      var rows=res.data||[];
      if(!rows.length){box.innerHTML='<div class="fc-empty">ยังไม่มีคอร์สใกล้จบ</div>';return;}
      var h='<table><thead><tr><th>คอร์ส</th><th class="r">ใช้/รวม</th><th class="r">เหลือ</th><th class="r">%</th></tr></thead><tbody>';
      rows.forEach(function(r){h+='<tr><td>'+fcl_esc(r.product_name||'-')+'</td><td class="r">'+fcl_fmt(r.sessions_used)+'/'+fcl_fmt(r.sessions_total)+'</td><td class="r">'+fcl_fmt(r.sessions_remaining)+'</td><td class="r">'+fcl_fmt(r.pct_used)+'%</td></tr>';});
      box.innerHTML=h+'</tbody></table>';
    }).catch(function(){var b=document.getElementById('fclUpsell');if(b)b.innerHTML='<div class="fc-empty">โหลดไม่ได้</div>';});

  // ---- รายได้รายวัน ----
  S().from('v_revenue_daily').select('sale_date,revenue_total,receipts,cash,card,transfer,qr')
    .order('sale_date',{ascending:false}).limit(14).then(function(res){
      var box=document.getElementById('fclRev');if(!box)return;
      if(res.error){box.innerHTML='<div class="fc-empty">โหลดไม่ได้: '+fcl_esc(res.error.message)+'</div>';return;}
      var rows=res.data||[];
      if(!rows.length){box.innerHTML='<div class="fc-empty">ยังไม่มีข้อมูลรายได้</div>';return;}
      var h='<table><thead><tr><th>วันที่</th><th class="r">ยอดขาย</th><th class="r">บิล</th></tr></thead><tbody>';
      rows.forEach(function(r){h+='<tr><td>'+fcl_dateTH(r.sale_date)+'</td><td class="r">'+fcl_baht(r.revenue_total)+'</td><td class="r">'+fcl_fmt(r.receipts)+'</td></tr>';});
      box.innerHTML=h+'</tbody></table>';
    }).catch(function(){var b=document.getElementById('fclRev');if(b)b.innerHTML='<div class="fc-empty">โหลดไม่ได้</div>';});
}

if(typeof window!=='undefined') window.mountFoclinic=mountFoclinic;
