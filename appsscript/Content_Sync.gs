/**
 * Content_Sync.gs — sync Google Sheet "Content planner V3" → Supabase (yiaoya-hub)
 * วางไฟล์นี้ใน: Extensions → Apps Script ของชีต V3 → วางโค้ด → setupContentSync() ครั้งเดียว → ตั้ง trigger รายชม.
 *
 * ตั้งค่า 1 ครั้ง (เก็บ secret ใน Script Properties — ไม่โผล่ในชีต ปลอดภัยกว่า):
 *   เมนู Apps Script → Project Settings → Script Properties → เพิ่ม
 *     INGEST_URL = https://iyldrlzhftylewstfmsg.supabase.co/functions/v1/content_ingest
 *     HUB_SECRET = <ค่าเดียวกับ HUB_SECRET ใน Supabase>
 *   แล้วรัน setupContentSync() (สร้าง trigger รายชั่วโมงให้เอง)
 */

function _cfg(k){ return PropertiesService.getScriptProperties().getProperty(k); }
function _ss(){ return SpreadsheetApp.getActiveSpreadsheet(); }

// อ่านชีตเป็น array of object โดย map ตามชื่อหัวคอลัมน์ (หา header row อัตโนมัติ)
function _read(tab, headerNeedle){
  var sh = _ss().getSheetByName(tab); if(!sh) return [];
  var vals = sh.getDataRange().getValues();
  var hi = -1;
  for (var r=0; r<Math.min(vals.length,6); r++){
    if (vals[r].some(function(c){ return String(c).trim()===headerNeedle; })){ hi=r; break; }
  }
  if (hi<0) return [];
  var head = vals[hi].map(function(c){ return String(c).trim(); });
  var out=[];
  for (var i=hi+1; i<vals.length; i++){
    var row=vals[i]; if(!row.some(function(c){return c!=='' && c!=null;})) continue;
    var o={}; for (var j=0;j<head.length;j++){ if(head[j]) o[head[j]]=row[j]; }
    out.push(o);
  }
  return out;
}
function _d(v){ if(!v) return null; try{ return Utilities.formatDate(new Date(v), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }catch(e){ return null; } }
function _m(v){ var d=_d(v); return d? d.slice(0,7) : null; }
function _num(v){ var n=parseFloat(v); return isNaN(n)?null:n; }
function _arr(v){ if(!v) return []; return String(v).split(/;|,|\n/).map(function(s){return s.trim();}).filter(String); }

function _post(table, rows){
  if(!rows.length) return;
  var res = UrlFetchApp.fetch(_cfg('INGEST_URL'), {
    method:'post', contentType:'application/json', muteHttpExceptions:true,
    payload: JSON.stringify({ secret:_cfg('HUB_SECRET'), table:table, rows:rows })
  });
  Logger.log(table + ' → ' + res.getResponseCode() + ' ' + res.getContentText());
}

function runContentSync(){
  // 1) MONTHLY_PLANNER → content_pieces
  _post('content_pieces', _read('MONTHLY_PLANNER','ชื่อเรื่อง').map(function(r){
    var pub=_d(r['Publish Date']);
    return {
      id:String(r['#']||r['ชื่อเรื่อง']), title:r['ชื่อเรื่อง'], dept:r['แผนก'], fmt:r['Content Format'],
      topic:r['หัวข้อ'], who:r['ผู้ดูแล'], status:r['สถานะ'], deadline:_d(r['Deadline']), publish_date:pub,
      fb_link:r['FB Link'], ig_link:r['IG Link'], tt_link:r['TT Link'], line_link:r['LINE Link'],
      caption:r['Caption Text'], media_link:r['Media Link'], promo_id:r['Promo_ID'], month:_m(r['Publish Date'])
    };
  }).filter(function(x){return x.title;}));

  // 2) KPI_TRACKER → content_kpi
  var mm = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  _post('content_kpi', _read('KPI_TRACKER','ชื่อ').map(function(r){
    return { who:r['ชื่อ'], month:mm, output:_num(r['Output /25']), weighted:_num(r['Weighted /25']),
      discipline:_num(r['Discipline /20']), quality:_num(r['Quality /15']), platform:_num(r['Platform /15']),
      total:_num(r['Total %']), grade:r['Grade'] };
  }).filter(function(x){return x.who;}));

  // 3) PROMO_MONTHLY → content_promo
  _post('content_promo', _read('PROMO_MONTHLY','Promo_ID').map(function(r){
    return { promo_id:r['Promo_ID'], month:_m(r['เดือน']), name:r['ชื่อโปรโม'], dept:r['แผนก'],
      price:_num(r['ราคาโปรโม']), target_cases:_num(r['เป้าจำนวนเคส']), actual_cases:_num(r['เคสจริง']),
      est_revenue:_num(r['Est. Revenue']), is_lead:String(r['Is Lead Promo']).toUpperCase()==='Y',
      approval_status:r['Approval Status'] };
  }).filter(function(x){return x.promo_id;}));

  // 4) INFLUENCER_DB → content_influencer (ไม่ส่งเลขบัตร/บัญชี — PDPA)
  _post('content_influencer', _read('INFLUENCER_DB','รหัสดีล').map(function(r){
    return { deal_id:String(r['รหัสดีล']), name:r['ชื่อ-นามสกุลจริง']||r['ชื่อ LINE'], channel:r['ช่องทางหลัก'],
      followers:String(r['TikTok Followers']||r['IG Followers']||''), rate:_num(r['ราคา/ค่าตัว']),
      quota:_num(r['โควต้า']), who:r['ผู้ดูแล'], status:r['ทำคลิปอะไร'] };
  }).filter(function(x){return x.deal_id;}));

  // 5) DAILY_LOG → content_checkin
  _post('content_checkin', _read('DAILY_LOG','ชื่อ').map(function(r){
    return { log_date:_d(r['วันที่']), who:r['ชื่อ'], checkin_time:String(r['Check-in เวลา']||''),
      punctuality:r['Punctuality Score'], plan:r['แผนวันนี้'], eod_pct:_num(r['% สำเร็จ']) };
  }).filter(function(x){return x.log_date && x.who;}));

  // 6) MORNING_BRIEF → content_brief
  _post('content_brief', _read('MORNING_BRIEF','วันที่').map(function(r){
    return { brief_date:_d(r['วันที่']), lead:r['ผู้นำประชุม'], present:_arr(r['คนที่มา']),
      absent:_arr(r['คนที่ไม่มา/ลา']), highlight:_arr(r['ไฮไลท์วันนี้']), deadline:_arr(r['Deadline วันนี้']),
      remind:_arr(r['เตือนทีม']) };
  }).filter(function(x){return x.brief_date;}));
}

function setupContentSync(){
  ScriptApp.getProjectTriggers().forEach(function(t){ if(t.getHandlerFunction()==='runContentSync') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runContentSync').timeBased().everyHours(1).create();
  runContentSync(); // รันทันที 1 รอบ
  Logger.log('ตั้ง trigger รายชั่วโมง + sync รอบแรกเสร็จ');
}
