# YChart — ชุดกราฟ/แดชบอร์ดกลาง (JERA-style)

ไฟล์: `_ported/charts.js` · โหลดเป็น global `<script>` ใน `index.html` (ก่อน main module) → `window.YChart` พร้อมใช้ทุกโมดูล

## ทำไม
ลอกแนวทาง dashboard ของ JERA (`yiaoya.jeracloud.com/v3/*`) มาใช้ในระบบ Supabase ของเรา:
KPI rail + filter + grid ของกราฟ (donut / line เทียบปี / stacked bar รายวัน / radar สัดส่วน / gauge ครึ่งวง / Top-N).
สีตาม **Altmedical brand** (Navy `#0D2F4F` + Teal `#3DC5B7`), dependency-free (inline SVG เขียนมือ), ห้าม emoji ใช้ `ti-*`.

## API (ทุกฟังก์ชัน return เป็น HTML string)

| ฟังก์ชัน | ใช้ทำ |
|---|---|
| `YChart.kpiRow([{label,value,unit,sub,delta,icon,flat}])` | แถว KPI cards (delta บวก=เขียว ลบ=แดง) |
| `YChart.card({title,icon,sub,action,body})` | กล่อง panel หัวขาว |
| `YChart.grid([html...], {cols\|min})` | grid responsive |
| `YChart.donut([{label,value,color?}], {centerLabel,valueFmt,legend})` | โดนัท + center total + legend |
| `YChart.line({labels,series:[{name,vals,color?}],height,yFmt})` | เส้นหลายชุด (เทียบปี) |
| `YChart.bars({labels,series,stacked,height,yFmt})` | แท่ง grouped/stacked |
| `YChart.spark(vals,{color,width,height})` | sparkline |
| `YChart.gauge({value,max,label,color,valueFmt})` | เกจครึ่งวง |
| `YChart.radar({axes,series})` | เรดาร์ (สัดส่วนรายรับ) |
| `YChart.topList([{name,value,badge?}], {valueFmt,limit})` | Top-N อันดับ |
| `YChart.barList([{name,value,color?}], {valueFmt})` | แท่งแนวนอน |
| `YChart.empty(msg,icon)` | empty state |
| helper: `YChart.fmt/full/baht/pct/color/C/PALETTE` | จัดรูปแบบเลข + palette |

## วิธีใช้ในโมดูล
```js
function fov_renderCharts(rows){
  if (!window.YChart) return;          // kit ยังไม่โหลด → ข้าม ไม่ error
  var Y = window.YChart;
  box.innerHTML = Y.grid([
    Y.card({title:'ผู้ป่วยรายวัน', icon:'ti-users',
      body: Y.bars({labels, stacked:true, series:[{name:'ใหม่',vals,color:Y.C.teal},{name:'เก่า',vals,color:Y.C.navy}]})}),
    Y.card({title:'สัดส่วนบริการ', icon:'ti-chart-donut',
      body: Y.donut([{label:'กายภาพ',value:n1},{label:'Pilates',value:n2}])})
  ], {min:320});
}
```

## สถานะ roll-out
- [x] kit + global wiring (`index.html`)
- [x] `fooverview` (HQ · FO ภาพรวม) — stacked bar ใหม่/เก่า + donut สัดส่วนบริการ จาก 14 วันล่าสุด
- [ ] `digest` (HR ภาพรวม) · `accdigest` (บัญชี) · `leadmkt` (การตลาด) — ทยอยลงหน้าที่ data พร้อม

> กราฟต้องมี data จริงรองรับ — หน้าที่ backend ยังว่าง ใช้ `YChart.empty()` ไปก่อน ไม่แปะกราฟเปล่า
