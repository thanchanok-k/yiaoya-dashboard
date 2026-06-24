# กฏการเพิ่มเมนู/หน้าใหม่ใน Dashboard (index.html)

> เปิด DevTools → Console ดูได้เลยว่ามีเมนูไหน "ยังไม่ครบ" — ฟังก์ชัน `navAudit()` จะเตือนตอนเปิดหน้า

## เพิ่ม "เมนู" 1 อัน = แตะ 5 จุด

| # | จุด | ตัวอย่าง | ถ้าลืม |
|---|---|---|---|
| 1 | **nav item** ใน `<nav id="sbnav">` | `<div class="sb-item" data-view="X"><i class="ti ti-..."></i>ชื่อไทย<span class="ct" id="ct-X"></span></div>` | ไม่มีเมนูให้คลิก |
| 2 | **section** (กล่องเนื้อหา) | `<section class="view" data-view="X">...</section>` | คลิกแล้วหน้าว่าง |
| 3 | **VIEW_TITLE** | `...,X:'ชื่อหัวข้อ'}` | หัวข้อบนสุดว่าง |
| 4 | **NAV_GROUPS** (จัดกลุ่ม) | ใส่ `'X'` ในกลุ่มที่เหมาะ | ตกกอง **"อื่น ๆ"** |
| 5 | **VIEWS_BY_ROLE** (สิทธิ์เห็น) | ใส่ `'X'` ใน role ที่ควรเห็น | **เห็นเฉพาะ director** |

## ถ้าเป็น "ported page" (โหลดแยกจาก `_ported/X.js`) = +3 จุด

| # | จุด | ตัวอย่าง |
|---|---|---|
| 6 | `PORTED_FN` | `X:'mountX'` |
| 7 | `PORTED_SCRIPT` | `X:'_ported/X.js'` |
| 8 | `PORTED_WRAP` | `X:'wrap-X'` |
| + | ใน section ใส่ `<div id="wrap-X"></div>` และไฟล์ `_ported/X.js` ต้องมี `window.mountX=...` |

## หลักการจัดกลุ่ม (NAV_GROUPS)
- กลุ่มเรียงตาม **ประเภทงาน / โดเมน**: ภาพรวม · ข้อมูล(Entities) · HR(5 หมวดย่อย) · บัญชี · จัดซื้อ · การตลาด · HQ · ระบบ
- HR แบ่งย่อย: **แดชบอร์ด**(ดูสรุป/วิเคราะห์) · **คำขอ/อนุมัติ** · **บันทึก/ประเมิน** · **ทะเบียนพนักงาน** · **เงินเดือน/KPI**
- เมนู "ดิบ" (entity raw view) → กลุ่ม **ข้อมูล·Entities** · เมนู analytics/จัดการ → กลุ่ม HR
- ชื่อกลุ่มต้อง **สื่อความ** (ห้ามใช้ชื่อ technical เช่น "ฟังก์ชัน·Supabase")

## หลักการจัดสิทธิ์ (VIEWS_BY_ROLE)
- `director` = เห็นทุกเมนู (ALL_VIEWS) — ไม่ต้องเพิ่มทีละอัน
- `hr` / `accountant` / `purchasing` / `staff` = เห็นเฉพาะของ role ตัวเอง → **ต้องเพิ่ม view ใหม่เข้า role ที่เกี่ยว**
- เมนู exec/marketing/FO (mkt, hub360, dept, appointments ฯลฯ) = ตั้งใจให้ director-only จนกว่าจะมี role พวกนั้น

## หลังแก้เสร็จ
1. เปิดหน้า → ดู Console: ต้องขึ้น `[navAudit] เมนูครบถ้วนทุกจุด ✓` (ถ้ามีเตือนสีส้ม = ยังไม่ครบ ตามจุดที่บอก)
2. `git pull --rebase` ก่อน push เสมอ (มีหลาย session แก้ไฟล์นี้)
3. commit + push → GitHub Pages เผยแพร่ ~1 นาที
