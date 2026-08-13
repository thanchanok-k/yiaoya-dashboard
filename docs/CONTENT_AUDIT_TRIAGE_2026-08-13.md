# Content hub+ERP — triage ผลออดิท 38 ข้อ (13 ส.ค. 2569)

> **อัปเดตท้ายวัน 13 ส.ค.: ปิดครบแล้ว 37/38** (เหลือ #11-รอบสอง = ความเสี่ยงที่ยอมรับ ดูท้ายไฟล์)
> พี่เซินสั่ง "ทำทั้งหมดเลยค่ะ" → ทำ 4 ข้อที่เคยรอเคาะ + 15 ข้อ batch + รัน**ออดิทรอบ 2** (30 agent)
> เจอเพิ่ม 21 ข้อ (P1:7 P2:14 — ส่วนใหญ่คือ "แก้ไม่สุด" ของรอบแรก) แล้วแก้+deploy+ยิงทดสอบครบ
> รายละเอียดรอบ 2 อยู่ท้ายไฟล์

ที่มา: workflow ออดิท 5 lens → adversarial verify (51 agent) รอบ 12 ส.ค. 69
raw JSON เต็ม: เก็บใน session scratchpad `audit-findings-38.json` (สรุปสาระไว้ที่นี่แทน)
สรุป: ยืนยัน 38 จากข้อกล่าวหา 46 (ตัดทิ้ง 8) — P0:7 · P1:11 · P2:20

## สถานะรวม

| สถานะ | จำนวน | ข้อ |
|---|---|---|
| ✅ ปิดแล้ว | 13 | 1,2,3,4,5,6,7,11,20,27,31,36 + 19(บางส่วน) |
| 🟠 รอเคาะ (ต้องตัดสินใจ) | 10 | 8,9,10,13,15,16,17,18,28,38 |
| 🔧 แก้ได้เลย รอทำ batch ถัดไป | 15 | 12,14,21,22,23,24,25,26,29,30,32,33,34,35,37 |

## ✅ ปิดแล้ว (ยืนยันด้วยการยิงทดสอบซ้ำ)

- **#1/#4/#7 + #2/#5/#6/#11** — `content_trello` และ `content_task_list` เพิ่มด่านในโค้ด:
  `auth.getUser()` → ปฏิเสธ anonymous → role จาก `app_staff` → person จากอีเมลใน JWT เท่านั้น
  (บทเรียน: **verify_jwt=true ไม่ใช่ role gate** — publishable key ผ่าน gateway ได้)
  ยิงด้วย publishable key จริง = 401 ทั้งคู่
- **#3** — GRANT SELECT/INSERT/UPDATE/DELETE บน `content_task, content_task_move,
  content_post_match, content_person, content_ai_check, content_ai_budget` ให้ `service_role`
  (+ sequence usage) — ทดสอบ REST ด้วย service key: SELECT เห็น 4 คน, UPDATE ตอบ 200
- **#27/#31** — REVOKE TRUNCATE (และ REFERENCES/TRIGGER ที่ไม่จำเป็น) จาก anon/authenticated ทั้ง 6 ตาราง
- **#20/#36 + #19 บางส่วน** — `POST /api/content/my-tasks` (ERP):
  - เลิกกลืน error ทุกจุด (`{ data, error }` แล้วโยนจริง) — permission denied จะไม่ปลอมเป็น "ยังไม่ผูกชื่อ" อีก
  - เช็คจำนวนแถวที่อัปเดต — ผูกไม่สำเร็จตอบ 409 พร้อมเหตุผล ไม่ใช่ success ลอย ๆ
  - 1 บัญชี ผูกได้ 1 ชื่อ — กันจองซ้ำหลายชื่อ (ส่วน first-come + ถอนไม่ได้ ยังเหลือ → #19 ที่เหลือรวมใน #10)
  - ⚠️ แก้ในโค้ด local แล้ว **ยังไม่ commit/deploy ขึ้น Vercel**

## 🟠 รอเคาะ — คำถามถึงพี่เซิน

1. **#8 `content_trello_action`** — ปุ่มเขียนกลับ Trello (comment/move/approve) ยังเรียกได้ด้วย
   publishable key = คนนอกย้ายการ์ด/คอมเมนต์บอร์ดได้ → เสนอเพิ่มด่านเดียวกับ content_trello (ทำได้ทันทีถ้าอนุมัติ)
2. **`content_list`** — ยังเปิดอยู่ (ค้างจากรอบก่อน รอคำตอบ) คืนข้อมูลงานจากชีต ไม่มีคอมเมนต์คนไข้
3. **#9/#13 ปุ่ม "เริ่มทำ" ใน LIFF** — ส่ง to_status='กำลังทำ' แต่บอร์ดไม่มีลิสต์ชื่อนี้ → พังทุกครั้ง
   ต้องเคาะ: การ์ดที่เริ่มทำควรย้ายไปลิสต์ไหน (บอร์ดมี "to do list today" ที่ใกล้เคียงสุด) หรือสร้างลิสต์ "กำลังทำ" ใหม่
4. **#10/#16/#17/#18 การผูกชื่อ** — พนักงาน ERP คนไหนก็อ้างเป็น ตอง/แฟร์/ปาย/แป้ง ได้ (first-come)
   ตัวเลือก: (ก) ให้หัวหน้า/แอดมินเป็นคนผูกให้ (ข) ผูกเองแล้วหัวหน้า approve (ค) ยอมรับ risk เพราะทีมเล็ก
5. **#28 ปุ่ม LIFF กดไม่ได้จริง** — `/api/content/action` กั้น role owner/admin/manager/marketing
   แต่ `app_staff` ไม่มีใครถือ marketing และน้องทีมคอนเทนต์ยังไม่อยู่ใน app_staff เลย
   → ต้องเคาะ: อนุญาตคนที่ผูกชื่อใน `content_person` ทำ action บนการ์ดของตัวเองได้ไหม
6. **#15 นิยาม "ดำเนินการเรียบร้อย ✅"** — ตอนนี้แมปเป็นสเตจ "ตรวจ" (คิวรอหัวหน้า)
   ถ้าทีมใช้ลิสต์นี้หมายถึง "เสร็จแล้ว" คิวตรวจจะบวม → ขอ confirm ความหมายจริงจากทีม
7. **#38** — role `marketing` เห็น KPI รายคนทั้งทีม — ตั้งใจไหม หรือควรจำกัดแค่ manager ขึ้นไป

## 🔧 แก้ได้เลย (ไม่ต้องตัดสินใจ) — batch ถัดไป

| ข้อ | เรื่อง | ไฟล์ |
|---|---|---|
| #21/#34 | social_stats ทับตัวเลข IG ดี ๆ ด้วย 0/null ตอน insights ล้ม → ต้อง skip แทน | social_stats/index.ts |
| #23/#32 | fb_organic เขียน 0 ทับ + ปั๊ม insights_at ทำให้ไม่ retry → เขียนเฉพาะ metric ที่ได้จริง | fb_organic/index.ts |
| #22 | content_match_posts: การ์ดจับคู่หลายโพสต์ + pending ล็อกถาวร | content_match_posts() SQL |
| #24 | การ์ดหลาย label → KPI นับซ้ำ / งานหายจาก "ของฉัน" | content_task_sync() SQL |
| #25/#30 | num() ไม่ครอบ kpi/my_kpi (bigint→string) | hub-content-task.ts |
| #26 | วิวเฉลี่ยเอา 0 ของภาพนิ่งมาเฉลี่ย → กรองเฉพาะโพสต์วิดีโอ | v_content_kpi_monthly |
| #29/#33 | content_ai_check: max_tokens 2000 น้อยไป + parse พังแล้วไม่บันทึกต้นทุน → บันทึกก่อน parse | content_ai_check/index.ts |
| #12 | อ่าน content_task (sync วันละครั้ง) แต่เขียน Trello สด → กดซ้ำได้ | เพิ่ม optimistic update / sync หลัง action |
| #14 | action='move' ทิ้ง comment (ลิงก์โพสต์หาย) | content_trello_action: move แล้ว comment ต่อ |
| #35 | ปุ่ม LIFF ไม่มี auth retry ตอน token หมดอายุ | liff/my-tasks/page.tsx |
| #37 | ไม่มีชื่อว่างให้เลือก → หน้าจอเงียบเหมือนปกติ | liff/my-tasks/page.tsx |

## หมายเหตุ deploy

- SQL (grant/revoke) มีผลทันทีบน hub แล้ว
- Edge functions ที่แก้ (content_trello v42, content_task_list) deploy แล้ว
- โค้ด ERP (`my-tasks/route.ts`) แก้ local — **รอ commit + deploy Vercel** (repo มีของค้างอย่างอื่นปนอยู่ รอเคาะขอบเขต commit)

---

## ภาคผนวก: งานรอบบ่าย 13 ส.ค. — ปิดที่เหลือทั้งหมด + ออดิทรอบ 2

### การตัดสินใจที่เคาะแล้ว (พี่เซิน "ทำทั้งหมดเลยค่ะ")
1. `content_trello_action` + `content_list` → เพิ่มด่านในโค้ด (ปฏิเสธ publishable/anonymous)
2. ปุ่ม "เริ่มทำ" → ย้ายการ์ดไปลิสต์ **"to do list today"** (COL_TO_LIST แมป "กำลังทำ" → ลิสต์นี้)
3. การผูกชื่อ: ยอมรับ risk ทีมเล็ก (first-come) + เพิ่ม **DELETE /api/content/my-tasks** ให้หัวหน้าปลดชื่อได้
4. น้องทีม (ผูกชื่อใน content_person) ทำ action ได้เฉพาะ **การ์ดตัวเอง** — move ไป
   `กำลังทำ/ตองตรวจ/เซินรีวิว/โพสเรียบร้อย` เท่านั้น (ไม่มี "ผ่านการรีวิว" = กัน self-approve)
   และ "โพสเรียบร้อย" ต้องมาจากสเตจ "รอโพสต์" (กันข้ามรีวิว)

### ออดิทรอบ 2 (workflow 30 agent, 5 lens + adversarial verify) — 21 ข้อ แก้แล้ว 20
raw: session scratchpad `audit2-findings-21.json`

| กลุ่ม | ข้อค้นพบสำคัญ | การแก้ |
|---|---|---|
| authz ผิดชั้น (P1) | ด่าน role อยู่ฝั่ง ERP แต่ edge fn ยิงตรงได้ → user LIFF โมดูลไหนก็ self-approve ได้ | ย้าย authz ทั้งชุดเข้า `content_trello_action` เอง (role จาก app_staff / person จาก content_person / ownership จาก content_task) + `by` derive จาก JWT เลิกเชื่อ body |
| id 2 รูปแบบ (P1) | แดชบอร์ด/บอร์ดรวมส่ง TR-shortLink แต่ content_task เก็บ 24-hex → sync ทันที no-op เงียบ + ด่าน ownership ฝั่ง ERP ปฏิเสธการ์ดตัวเอง | fn resolve full id จาก Trello (`GET cards/{x}?fields=id,idBoard`) ก่อนเสมอ + กันการ์ดนอกบอร์ด · ฝั่ง ERP ตัด ownCardAllowed ทิ้ง ให้ hub ตัดสิน |
| fail-soft รั่ว (P1+P2) | fb_organic: value=null → num()=0 ทับค่าจริง · โพสต์ insights ตายถาวรโดนเลือกซ้ำกิน budget · social_stats: fallback เขียน null ทับ 9 metric, data ว่างเขียน 0 ทับ | null → dead map · anyLive=false ก็ปั๊ม insights_at (backoff ตาม refresh_hours) · upsert เป็น coalesce ทุกคอลัมน์ metric · insOk = มี metric จริง ≥1 |
| เงิน AI (P1) | manual re-run จ่าย Anthropic จริงแต่ on conflict do nothing กลืนแถว cost → เพดานงบมองไม่เห็น | manual run ใช้ move_id = `manual-<uuid>` → มีแถวบันทึกทุกครั้งที่จ่ายเงิน |
| false-pass AI | verdict "ข้อมูลไม่พอตรวจ" ถูกคอมเมนต์เป็น "ผ่าน" | renderComment แยกเคสชัดเจน |
| LIFF UX | window.prompt พังเงียบใน LINE iOS · busy รายการ์ด → double-submit ได้ · 403/409/หมด session = ทางตัน | ช่องกรอกลิงก์ในการ์ด · ล็อกทุกปุ่มตอน busy · error ทุกทางมีข้อความชี้ทาง + รีเฟรชอัตโนมัติ |

### ความเสี่ยงที่ยอมรับ (ตัดสินใจแล้ว ไม่ใช่ลืม)
- **ผูกชื่อเปิดให้ทุก authenticated user** (รอบ 2 #11): พนักงานโมดูลอื่นที่ login ได้ก็กดผูกชื่อว่างได้
  ยอมรับเพราะทีมเล็ก + 1 บัญชีผูกได้ชื่อเดียว + หัวหน้าปลดได้ (DELETE) + คอมเมนต์ Trello เซ็นชื่อจริงจาก JWT
- role `marketing` เห็น KPI ทั้งทีม (รอบแรก #38): ตอนนี้ยังไม่มีใครถือ role นี้ใน app_staff

### ยิงทดสอบยืนยัน (13 ส.ค.)
- publishable key → 401 ทั้ง `content_trello / content_task_list / content_list / content_trello_action / content_action`
- owner session → ผ่านทุกด่าน · การ์ด shortLink resolve เป็น full id ได้ · การ์ดนอกบอร์ด → ปฏิเสธ
- user LIFF นอกทีม (ไม่อยู่ app_staff/content_person) ยิง approve ตรง → **403** "ยังไม่ได้ผูกชื่อในบอร์ดคอนเทนต์"
- E2E ปุ่ม "เริ่มทำ": การ์ดทดสอบย้ายไป "to do list today" + คอมเมนต์แนบ + content_task อัปเดตทันที (เก็บกวาดแล้ว)
- fb_organic / social_stats หลัง deploy: ok ทุกหน้า เลขเดิมไม่โดนทับ
- deploy: hub 5 fns + SQL migration (`20260813_content_audit_fixes.sql` รันแล้ว) + ERP Vercel prod (commit b2f3c05, 9eb1eea)
