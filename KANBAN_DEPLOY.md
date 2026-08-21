# กระดานงาน (Kanban กลาง) — วิธี deploy เฟส 1

Kanban ทุกตำแหน่ง role-aware + ส่งข้ามตำแหน่งให้รีวิว (เลือกปลายทาง+ประเภทเอง)
โมเดลลอกจาก ERP (`cross-role-requests` / CrossRoleRequest) → ทำจริงบน hub Supabase + โผล่บน dashboard

## โครงสร้าง (เขียน+เช็คผ่านแล้ว)
- `supabase/migrations/20260627_kanban.sql` — 3 ตาราง: `kanban_cards` · `kanban_requests` (คำขอข้ามตำแหน่ง) · `kanban_events` (audit)
- `supabase/functions/kanban_list/` — คืนการ์ด+คำขอที่ตำแหน่งฉันเห็น (resolve ตำแหน่งจาก JWT→app_staff · fallback body) + ดึงประวัติเมื่อส่ง `card_id`
- `supabase/functions/kanban_save/` — สร้าง/แก้การ์ด
- `supabase/functions/kanban_action/` — move / send_review / approve / reject / comment (เขียน event ทุกครั้ง)
- `index.html` — เมนู **"กระดานงาน" บนสุด** (ทุก role เห็น) + `mountBoard()` + drag ย้ายคอลัมน์ + กล่อง "รอฉันรีวิว" + ส่งรีวิวเลือกตำแหน่ง + modal ประวัติ

## ขั้น deploy (พี่เซินรัน — สิทธิ์เจ้าของ DB)
```bash
cd ~/yiaoya-dashboard
supabase link --project-ref iyldrlzhftylewstfmsg     # ถ้ายังไม่ผูก
supabase db push                                      # สร้าง 3 ตารางจาก migration
supabase functions deploy kanban_list                 # verify_jwt เปิด (ต้อง login)
supabase functions deploy kanban_save
supabase functions deploy kanban_action
```
อธิบายทีละบรรทัด:
- `link` = บอก CLI ว่าทำงานกับ project ไหน (ครั้งเดียว)
- `db push` = เอา SQL ใน migrations ขึ้น DB จริง (สร้าง 3 ตาราง · additive ไม่แตะของเดิม)
- `functions deploy ...` = ปล่อย edge fn 3 ตัว (ไม่ใส่ `--no-verify-jwt` → บังคับ login ก่อนเรียก)
- secret ที่ใช้: ใช้ `SUPABASE_DB_URL` + `SUPABASE_URL` + `SUPABASE_ANON_KEY` ที่ Supabase **inject ให้อัตโนมัติ** — ไม่ต้องตั้งเพิ่ม

> Claude deploy functions เองได้ (ผ่าน classifier) แต่ `db push` ต้องรหัส DB = พี่เซินรันเอง

## ขั้นตรวจ
1. เปิด dashboard → เมนูบนสุด **"กระดานงาน"** → กด "เพิ่มการ์ด" → การ์ดขึ้นคอลัมน์
2. คลิกการ์ด → "ส่งให้ตำแหน่งอื่นรีวิว" เลือกตำแหน่ง+ประเภท → ส่ง
3. login เป็นตำแหน่งปลายทาง → เห็นกล่อง "รอฉันรีวิว" → อนุมัติ/ตีกลับ
4. ถ้าไม่ขึ้น: F12 → Console หา `kanban_` → error บอกสาเหตุ (เช่นยังไม่ db push)

## การกรองตามตำแหน่ง (scope)
- ตำแหน่งผู้ใช้ = `access_role` จาก `app_staff`/`emp_access_role` (เหมือนระบบสิทธิ์เดิม)
- เห็นการ์ด = เจ้าของ=ตำแหน่งฉัน **OR** ส่งมารีวิวให้ฉัน **OR** มอบหมายให้ฉัน
- `director/owner/admin` = เห็นทุกการ์ด
- คอลัมน์มาตรฐาน: วางแผน → กำลังทำ → รอรีวิว → แก้ไข → เสร็จ (ปรับรายตำแหน่งได้ในเฟส 3)

## เฟสถัดไป
- **เฟส 2:** ดึง Trello (content_trello) เข้าบอร์ด content + lazy-load รายละเอียดเต็ม
- **เฟส 3:** คอลัมน์รายตำแหน่ง + แจ้งเตือน LINE เมื่อมีการ์ดส่งมารีวิว

## หมายเหตุ
- **menu_registry:** ตามกฎเพิ่มเมนู (จุดที่ 9) ควรเพิ่มแถว `board` ใน `00 Integration Hub/20_Supabase/32_access_control.sql` ด้วย (ไม่งั้น navAudit เตือนสีแดงใน console — ไม่กระทบการทำงาน)
- **PDPA:** การ์ด/คำขอ อยู่หลัง login (verify_jwt) เสมอ
- **hardening (เฟสหลัง):** ตอนนี้ LINE/anon user ส่ง position มาจาก client ได้ — เมื่อพนักงานมี Supabase Auth account รายคนแล้ว ให้ resolve ตำแหน่งจาก JWT อย่างเดียว (kanban_list ทำไว้แล้วสำหรับ user จริง)
