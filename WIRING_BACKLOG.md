# WIRING BACKLOG — Yiaoya Dashboard (57 โมดูล)

อัปเดต: 2026-06-26 · ที่มา: audit การ wire ของ 57 โมดูลใน dashboard
จุดประสงค์: จัดลำดับว่าควรต่อท่อ (wire) โมดูลไหนก่อน เพื่อให้ HR ใช้งานจริงได้ ไม่ใช่แค่ดู

---

## 1. สรุปผู้บริหาร

### Read layer (อ่านข้อมูล) — รวม 57 โมดูล
| สถานะ | จำนวน |
|---|---|
| real (อ่านจริง) | 52 |
| partial (อ่านได้บางส่วน) | 4 |
| stub (ยังไม่อ่านจริง) | 1 |

### Write layer (เขียน/บันทึกข้อมูล) — รวม 57 โมดูล
| สถานะ | จำนวน |
|---|---|
| real (เขียนจริง) | 15 |
| partial (เขียนได้บางปุ่ม) | 13 |
| stub (กดได้แต่ไม่บันทึก) | 20 |
| none (ไม่มี write ตามดีไซน์) | 9 |

### Write target (ปลายทางการเขียน)
| ปลายทาง | จำนวน |
|---|---|
| supabase | 34 |
| none | 22 |
| google_sheet | 1 |

### ภาพรวม
- **Read แทบครบทั้งระบบ** — 52/57 โมดูลอ่านข้อมูลจริงจาก Supabase edge function (`hr_list` / `hr_list_hq` / โดเมนเฉพาะ) แล้ว ดังนั้น dashboard ในมุม "ดูข้อมูล" ถือว่าใช้ได้
- **Write คือคอขวดจริง** — มีเพียง 15 โมดูลที่เขียนกลับได้จริง อีก 33 โมดูล (partial+stub) กดปุ่มแล้วไม่ persist ทำให้ HR ยังต้องไปทำงานจริงในระบบเก่า (GAS/Sheet) อยู่
- **อุปสรรคซ้ำที่สุด 3 อย่าง**: (1) edge function ฝั่ง write ยังไม่ deploy/ไม่มี handler, (2) ตาราง/migration + RLS ยังไม่สร้าง, (3) feature ที่ผูก LINE OA (multicast/flex/reminder) เป็น stub แทบทุกโมดูล

---

## 2. ลำดับการ wire (P0 → P3)

เกณฑ์: ความถี่ใช้งาน HR จริง + ผลกระทบถ้าทำไม่ได้
- **เพิ่ม/แก้พนักงาน, อนุมัติลา/OT, ออกเอกสาร/วินัย = สูง (ใช้ทุกวัน)**
- รายงาน/วิเคราะห์ที่ดูนาน ๆ ครั้ง = ต่ำ

### P0 — ทำก่อน (ใช้ทุกวัน + ตอนนี้เขียนไม่ได้/ไม่ครบ)
| โมดูล | read | write | gap หลัก | เหตุผลลำดับ |
|---|---|---|---|---|
| employeemgr | real | stub | เพิ่ม/แก้พนักงาน + multi-branch ยังไม่ wire (ปลายทางยังชี้ Google Sheet) | ทะเบียนพนักงานคืองานหลัก HR ทุกวัน เป็นต้นทางของทุกโมดูล |
| emp360 | real | stub | บันทึก profile/prefs/notes/leave quota เป็น stub ทั้งหมด | หน้ารายคนที่ HR เปิดบ่อยสุด แก้อะไรไม่ได้เลย |
| otreq | partial | real | core approve/reject ได้แล้ว แต่ read partial + cap/rate hardcoded 0 | อนุมัติ OT รายวัน กระทบเงิน ต้องทำให้ read+คำนวณครบ |
| payrollmgr | partial | stub | run calc / payslip / mark paid เป็น stub | จ่ายเงินเดือนกระทบตรง แต่ต้องคุม (ห้าม auto-commit) |
| timeattend | real | stub | review/approve anomaly + export เป็น stub | ลงเวลา/เข้าสายป้อนเข้าทั้ง OT และเงินเดือน |
| accessmgr | real | real | cache ไม่ sync หลังแก้ + ไม่มี onConflict upsert | คุมสิทธิ์เข้าระบบ ถ้าเพี้ยนคนเข้าผิด/หลุดสิทธิ์ |
| accessreq | real | real | `line_login` edge fn ยังไม่มี → อนุมัติคำขอจริงไม่ได้ | พนักงานขอสิทธิ์ค้างทั้งหมดถ้า fn ไม่ deploy |
| aisettings | real | real | ตาราง feature_settings/app_staff + RLS ยังไม่ migrate (404) | โมดูลขึ้น NotFound = พังเห็นชัด ต้องสร้าง schema |

### P1 — รอบถัดไป (ใช้บ่อย + workflow อนุมัติ/ออกเอกสาร)
| โมดูล | read | write | gap หลัก | เหตุผลลำดับ |
|---|---|---|---|---|
| offerletter | real | stub | create/send/withdraw/remind เป็น stub ทั้ง 4 | ออก offer letter ออกจาก dashboard ไม่ได้เลย |
| onboard | real | partial | สร้าง case + 9 mutation เป็น NotReady | รับคนเข้าใหม่เป็นงานประจำ HR |
| offboard | real | stub | 18 mutation stub + employee selector ว่าง | ลาออก/พ้นสภาพต้องบันทึก (payout/return/KT) |
| recruit | real | partial | move/intake/hire ได้ แต่ notes/MBTI/LINE ไม่ persist | สรรหารายวัน บันทึกผลสัมภาษณ์หาย |
| pinfo | real | partial | applyToRecord ไม่มี edge fn → ไม่ลง Tab 01 | คำขอแก้ข้อมูลส่วนตัวอนุมัติแล้วไม่ apply จริง |
| oneonone | real | partial | confirm/decline/noshow/multicast stub | นัด 1:1 ทำได้ครึ่งเดียว |
| incident | real | partial | root cause/preventive/SSO ไม่ persist | ปิดเคสได้ แต่ข้อมูลสอบสวนหาย |
| license | real | partial | reminder/bulk LINE stub + role gate hardcode | ใบอนุญาตหมดอายุต้องเตือน (compliance) |
| position | real | partial | add position ไม่คืน entity_id + ไม่มี cascade check | ตั้งตำแหน่ง/แผนกเป็น master ของหลายโมดูล |
| sop | real | partial | edit form ยัง reuse create + delete ไม่ persist หลัง reload | เอกสารขั้นตอนงาน แก้ไม่ครบวงจร |
| milestone | real | partial | seed defaults stub | CRUD ได้แล้ว เหลือ seed |
| calendar | real | partial | Google Cal settings/sync stub | ปฏิทินลา/งานอ่านได้ เหลือ sync Google |
| training | real | partial | auto-enroll + enrollment write stub | course เขียนได้ แต่ลงทะเบียนเรียนยังไม่ได้ |
| equipment | real | partial | LINE คืนของ stub + received_by ยัง mock | ยืม-คืนอุปกรณ์ บันทึกได้แต่แจ้งเตือนไม่ครบ |

### P2 — เขียนได้แต่ค้างปลีกย่อย / read-only ที่ควรเปิด write
| โมดูล | read | write | gap หลัก | เหตุผลลำดับ |
|---|---|---|---|---|
| birthday | real | stub | mutation วันเกิด/สั่งเค้ก stub + email vendor | ความถี่กลาง ไม่กระทบ core HR |
| doctorshift | real | stub | cancel/replacement/rating/recompute stub | งานเฉพาะกลุ่มหมอ |
| disciplinary | real | real | issue form latency + authorized_positions ว่าง | เขียนได้แล้ว เหลือทำให้ robust |
| document | real | real | rerun/audit/notify (3 admin) ยัง stub | core เขียนได้ เหลือ admin trigger |
| internship | real | stub | สร้าง intern + LINE flex stub | ความถี่ต่ำ |
| insurance | real | stub | create/edit/delete stub + ไม่มี role gate | read-only เฟส 2 ตามดีไซน์ |
| pulse | real | stub | create/open/close/remind stub | survey ภายใน ความถี่ต่ำ |
| raise | real | stub | approve/reject ไม่ persist (ไม่มี edge fn) | ขึ้นเงินเดือนทำเป็นรอบ ไม่ใช่ทุกวัน |
| reward | real | stub | grant/revoke stub | ให้รางวัลเป็นรอบ |
| survey | real | partial | manual/bulk send + cron + CSV stub | submit/อ่านได้แล้ว |
| recruittpl | real | stub | create/edit/delete/seed stub | template ตั้งครั้งเดียว |
| interviewbank | real | stub | CRUD stub + ไม่มี permission gate | คลังคำถาม ตั้งนาน ๆ ครั้ง |
| internaljob | stub | stub | read ก็ stub (hr_list ยังไม่ deploy type นี้) | ต้อง deploy read ก่อน ความถี่ต่ำ |
| openpos | partial | stub | backend ไม่ส่ง open_position.updated | ขึ้นกับ requisition flow |
| kpimgr | partial | stub | 2 tab อ่านจริง ที่เหลือว่าง + mutation stub | กำลัง port ระบบ 70-75 |

### P3 — read-only ตามดีไซน์ (ไม่ต้อง wire write ตอนนี้)
| โมดูล | read | write | gap หลัก | เหตุผลลำดับ |
|---|---|---|---|---|
| compliance | real | none | action card ปิด (ตามดีไซน์ write-less) | รายงานสถานะ อ่านอย่างเดียว |
| contracts | real | none | field mapping defensive, ไม่มี write UI | ดูสัญญา HQ-gate |
| dfschedule | real | none | field mapping defensive | ดูตารางเวร |
| fosales | real | none | branch_name/rebook ยังขาด | รายงานยอด FO |
| hiring | real | none | recommendation hardcode | สัญญาณจ้าง อ่านอย่างเดียว |
| leadmkt | real | none | schema ยังไม่ validate | analytics การตลาด |
| leadpipe | real | none | ไม่มี export | ดู pipeline FO |
| legal | real | stub | detail จาก cache + ไม่มี write UI | ดูคดี HQ |
| roomutil | real | none | provider_load ยังไม่ publish | insights ผู้บริหาร |
| scorecard | real | none | field mapping ไม่มี doc | รายงานคะแนนหมอ |
| surveyexit | real | stub | submit ปิด (PDPA design) | exit interview อ่านอย่างเดียว |

---

## 3. เชื่อมแล้ว — read + write จริง (14 โมดูล)

โมดูลที่ทั้งอ่านและเขียนกลับ Supabase ได้จริงแล้ว (ยังมี gap ปลีกย่อยตาม audit เดิม แต่ใช้งาน core ได้):

`accessmgr` · `accessreq` · `aisettings` · `announce` · `disciplinary` · `document` · `holiday` · `leavereq` · `myday` · `pip` · `probcriteria` · `probreview` · `tag` · `tasks`

> หมายเหตุ: 14 นี้นับ write=real ทั้งหมด แต่ accessreq/aisettings ยังมี blocker ระดับ backend (edge fn `line_login` ยังไม่มี / ตาราง+RLS ยังไม่ migrate) จึงถูกยกไป P0 ให้ปิด blocker ก่อน

---

## 4. Top 5 ที่ควร wire ก่อน

จัดจากผลกระทบรายวัน + จำนวนคนที่ติด + ความง่ายที่จะปลดล็อก

### 1) employeemgr — เพิ่ม/แก้ทะเบียนพนักงาน
- **ทำไม**: เป็นต้นทางของทุกโมดูล (emp360, payroll, leave, OT อ้างพนักงานหมด) ตอนนี้ write ยังชี้ Google Sheet และเป็น stub
- **แนวทาง**: ย้าย write ไป **Supabase event** — `empAdminAdd/Update/AddAssignment/EndAssignment` ให้ยิง `hr_write` (event `employee.updated`) แล้วให้ hub projection อัปเดต Tab 01; เลิกพึ่ง Google Sheet เพื่อให้ตรงทิศ Supabase migration

### 2) emp360 — บันทึกข้อมูลรายคน
- **ทำไม**: หน้าที่ HR เปิดบ่อยสุดต่อคน แต่กดบันทึกอะไรก็เด้ง error
- **แนวทาง**: wire `updateEmployeeProfile/Preferences/Notes/LeaveQuota` → `hr_write` upsert (Supabase event) โดยคงเกราะ PDPA เดิม (เงินเดือน/ปกส./ใบรับรองแพทย์ readonly); ผูกกับ employeemgr ให้ใช้ projection ชุดเดียวกัน

### 3) accessreq + line_login — อนุมัติคำขอสิทธิ์
- **ทำไม**: invoke ฝั่ง write ตั้งไว้แล้ว แต่ **edge function `line_login` ยังไม่มี** → HR อนุมัติคำขอจริงไม่ได้เลย พนักงานค้างทั้งกอง
- **แนวทาง**: สร้าง+deploy **Supabase edge function `line_login`** (ไม่ใช่ GAS) ให้ครบ verify + emit event, เพิ่ม error handling ตอน select `employees` fail, และ verify ว่าส่ง LINE จริงก่อนค่อย refresh UI

### 4) otreq — อนุมัติ OT + คำนวณค่าตอบแทน
- **ทำไม**: approve/reject เขียนจริงแล้ว แต่ read ยัง partial และ cap 36 ชม./สัปดาห์ + อัตรา 1x/2x/3x ยัง hardcode 0 → ตัวเลขที่ส่งต่อเงินเดือนผิด
- **แนวทาง**: เติม read layer (attendance range) + ย้ายสูตร cap/rate มาเป็น logic จริงใน edge fn; เชื่อม "marks synced" กับ payroll กัน double-pay (ทำใน Supabase ฝั่ง edge fn)

### 5) aisettings — สร้าง schema + RLS ให้โมดูลเลิก 404
- **ทำไม**: โค้ด read+write พร้อม แต่ตาราง `feature_settings`/`app_staff` + RLS `fs_read`/`fs_write` **ยังไม่ migrate** → หน้าขึ้น NotFound/404 (fallback อ้าง `30_ai_operator.sql` ที่ไม่มีในโปรเจกต์)
- **แนวทาง**: เขียน **migration SQL + RLS policy** ใน `~/yiaoya-dashboard/supabase` (owner/controller เท่านั้น update, read เปิด) แล้ว deploy; งานนี้เล็กแต่ปลดล็อกโมดูลที่ "เกือบเสร็จ" ทันที

> หลักการร่วม: งานทั้ง 5 คือ **เขียนผ่าน Supabase event/edge function (`hr_write` / โดเมน fn)** ตามทิศ migration — ไม่กลับไปต่อ GAS WebApp ใหม่ และ feature ที่ผูก LINE (multicast/flex/reminder) ให้แยกเป็นงาน wave ถัดไป เพราะเป็น stub ซ้ำกันแทบทุกโมดูล
