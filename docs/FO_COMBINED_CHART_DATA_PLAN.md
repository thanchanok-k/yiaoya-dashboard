# แผน: เติม data ให้กราฟรวม FO (ยอดขายแยกใหม่/เก่า + ช่องทางแยกใหม่/เก่า)

อัปเดต 2026-06-27 · สถานะ: **รออนุมัติก่อน deploy production**

## เป้าหมาย
กราฟรวม toggle ในหน้า FO ภาพรวม อยากเพิ่มเส้น:
- ยอดขาย **ผู้ป่วยใหม่ vs เก่า** (รายวัน)
- **ช่องทาง** ของผู้ป่วยใหม่ vs เก่า (รายวัน)

(ยอดขาย "แยกแผนก" ทำเสร็จแล้วจาก `fo.fo_daily_sales` — live)

## สิ่งที่ค้นเจอ (สำคัญ)
**JERA มีข้อมูลที่ขาด ครบทุกมิติ อยู่แล้ว** — ไม่ต้องเพิ่มงานพนักงาน:
- `/report/payment/` → `is_new_patient` (bool) · `patient_channel` · `realized_paid_amount` · `create_date`
- `/report/course-sales/` → `is_new_patient` + course/แผนก
- จัดแผนกด้วย `~/jera-sandbox/pull_dept_sales.py` (ฟังก์ชัน `dept()`): กายภาพ/พิลาทิส/กระดูกและข้อ/นวด
- hub: edge fn `jera_sync` (emit `fo.sale.posted` + `is_new_patient`) + table `dept_sales` (มี `new_patient` bool) — **deploy แล้ว**

→ ทำให้ **track JERA ทางเดียว ครบทั้ง 3 มิติ** (ใหม่/เก่า × แผนก × ช่องทาง) โดยไม่แตะ flow งานหน้าร้าน

## คำแนะนำ
**ลุย JERA เป็นหลัก** · FO-form เป็น optional (ใช้เฉพาะ cross-check / ถ้าต้องการให้พนักงานยืนยัน — แต่เพิ่มภาระกรอกมือ + ซ้ำกับ JERA)

---

## Track A — JERA (แนะนำ · ได้ครบ)
1. **Aggregation script** (~ขยาย `pull_dept_sales.py`): ดึง `/report/payment/` + `/report/course-sales/` → group เป็น
   `(day, dept, is_new_patient, channel) → {amount, count}`
2. **ตารางปลายทาง** ใน Supabase: `fo.fo_sales_segment_daily` (record_date, branch_id, dept, is_new_patient, channel, amount, cnt)
   - RLS: service_role เขียน · authenticated อ่าน (branch-scoped)
3. **Cron**: เสียบใน `~/jera-sandbox/refresh_jera_snapshot.py` (รายวัน)
4. **Dashboard**: `fov_fetchSegment()` → เพิ่ม toggle series: ยอดขายใหม่/เก่า, ช่องทาง×ใหม่/เก่า (เสียบในกราฟรวมที่มีอยู่ — โครงพร้อมแล้ว)

ไฟล์อ้างอิง: `~/jera-sandbox/{pull_dept_sales.py, snapshot.py, refresh_jera_snapshot.py, JERA_CATALOGUE.md}` ·
`00 Integration Hub/20_Supabase/supabase/functions/{jera_sync,dept_sales}/index.ts`

## Track B — FO form (optional · ขนานได้)
เพิ่มให้ฟอร์มหน้าร้านเก็บ ใหม่/เก่า + ช่องทาง (กรณีอยากมีตัวเลขจากหน้าร้านเทียบ JERA)
- schema: `migrations/003_fo_facts.sql` → ตารางลูก `fo_daily_sales_patient_breakdown`
- form: `webapp/app/sales/new/page.tsx`
- ETL: `etl/030_transform_daily_sales.sql`
- dict: `FO-Data-Dictionary.md` · view: `reporting/100_fo_reporting_views.sql`
- deploy: `fo/build_apply.sh` → รัน SQL ใน Supabase Editor

## Gate ก่อน deploy (production)
- [ ] อนุมัติ schema ตาราง `fo_sales_segment_daily` + RLS
- [ ] อนุมัติเพิ่ม cron ใน JERA refresh
- PDPA: channel/patient_type = ระดับ INTERNAL → RLS branch-scoped พอ (ไม่ใช่ข้อมูลระบุตัวตน)
