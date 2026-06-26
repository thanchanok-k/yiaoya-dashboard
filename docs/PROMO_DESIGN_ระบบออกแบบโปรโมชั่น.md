# ระบบ "ออกแบบโปรโมชั่น" (promo_design) — กฎ + รายละเอียดทั้งหมด

เอกสารนี้สรุป **ตรรกะ กฎ แหล่งข้อมูล และ gotcha ทั้งหมด** ของแท็บ "ออกแบบโปรโมชั่น" ในหน้าการตลาด
อัปเดตล่าสุด: 2026-06-26 · Supabase project `iyldrlzhftylewstfmsg` (yiaoya-hub)

---

## 1. ภาพรวม
แท็บ **"ออกแบบโปรโมชั่น"** (`data-view="promo"` · `mountPromo()` ใน `index.html` กลุ่มการตลาด·วิเคราะห์)
ให้ AI (Gemini) อ่านข้อมูลจริงทั้งหมด → คิดโปรโมชั่น 2 ประเภท + วางแผนลงมือ พร้อม guardrail กำไร

- **Backend:** edge fn `promo_design` (Gemini gemini-2.5-pro + fallback flash · role gate authenticated/service_role · verify_jwt=true)
  - source: `supabase/functions/promo_design/index.ts` (deploy: `supabase functions deploy promo_design --project-ref iyldrlzhftylewstfmsg`)
- **ราคา:** edge fn `prices_sync` + script `_jera_pull_prices.py` (รันใน ~/jera-sandbox/pull_prices.py)
- **Frontend:** `mountPromo()` ใน `index.html` (อ่านผ่าน sb.functions.invoke เท่านั้น)

---

## 2. 2 ประเภทโปรฯ
- **instore (🏪 หน้าร้าน · คนไข้เดิม)** — เพิ่มยอดต่อบิล/ซื้อคอร์สต่อ/อัปเกรด/ต่อยอดของขายดี
- **acquisition (🧲 ดึงคนไข้ใหม่)** — ทดลองครั้งแรก/แพ็กเริ่มต้น/ยิงช่องทาง ฿/แชทถูก

## 3. 2 มุมมอง (viewMode · ปุ่มสลับ · localStorage `promoView`)
- **ผู้บริหาร (owner)** — เห็นทุกอย่าง: ต้นทุน, margin, เพดานลด, ปุ่มตั้งค่า
- **ทีมงาน (staff)** — **ซ่อน margin/ต้นทุน/guardrail** · เห็นราคาขาย+ส่วนลด (บอกลูกค้าได้) + sales playbook
  - **บังคับที่ backend:** `list` action รับ `audience:'staff'` → ตัด `margin_pct` ออกก่อนส่ง (ไม่หลุดทาง network) · `guard` = owner-only
  - ⚠️ ตอนนี้หน้านี้ director-only · พอเปิดให้ staff login ต้อง force audience=staff ตาม app-role (ยังไม่ทำ)

## 4. โหมดทำงาน (promo_settings.mode · toggle)
- **confirm (ให้คนเคาะ)** — AI คิด → status `draft` → คนอนุมัติ
- **auto (รันอัตโนมัติ)** — AI คิด → status `active` ทันที (มี confirm ก่อนสลับ)
- status flow: draft → approved → active / rejected / archived

---

## 5. แหล่งข้อมูลที่ AI ใช้ (ดึงทุกครั้ง — "ทุกช่องทางเสมอ")
| ข้อมูล | แหล่ง | ใช้ทำอะไร |
|---|---|---|
| รายได้/คนไข้ใหม่รายแผนก | `dept_sales` (3 เดือนล่าสุด) | แผนกขายดี · new vs old |
| ช่องทางคนไข้ใหม่ | `mkt_channel` | ยิงช่องไหน |
| ฿/แชท รายแบรนด์ | `ad_creative` (map brand จาก campaign) | ต้นทุน lead |
| ภาพรวมทุกช่องทาง | `mkt_monthly` (Meta/Google) + `ad_creative` | แพลตฟอร์ม/เทรนด์/ครีเอทีฟได้ผล/ROAS |
| ราคาคอร์ส + รายครั้ง | `jera_prices` (จาก JERA) | ตั้งราคาโปรฯ จริง |
| ยอดขายจริง/วัน | `jera_daily_sales` | run-rate |
| เทศกาล/ซีซั่น | คำนวณในโค้ด (TH_SEASON/EVENTS) | เกาะกระแส |

## 6. ราคา (jera_prices) — กฎสำคัญ
- ดึงจาก JERA report (ไม่มี master price endpoint):
  - **คอร์ส** = `course-sales.price` (ราคาแพ็กเกจ · MAX 90 วันล่าสุด/คอร์ส = ราคาหลังปรับขึ้น)
  - **รายครั้ง** = `product-sale` (report aggregate) → `paid_amount / sum_amount` (sum_amount = จำนวนครั้งที่ขาย)
- รีเฟรช: `python3 ~/jera-sandbox/pull_prices.py` (หลังปรับราคา) · push เข้า `jera_prices` (fn prices_sync action put + HUB_SECRET + replace)
- **กฎคอร์สหั่น margin ซ้ำ:** ราคาคอร์ส = หั่นส่วนลดจากรายครั้งมาแล้ว → **ห้ามลดราคาคอร์สลงอีกแรงๆ** ใช้ "แถมครั้ง/บริการเสริม" แทน · ถ้าลด effective ฿/ครั้ง ต้อง ≥ ต้นทุน/ครั้ง
- ⚠️ **ไม่ใช้คอลัมน์ cost ของ JERA โดยตรงเป็น margin** (เป็น direct cost เท่านั้น ไม่รวม overhead) — ดูข้อ 8

---

## 7. กฎกฎหมาย + คุณภาพ
- **โฆษณาสถานพยาบาลไทย:** ห้ามโอ้อวด/รับประกันผลการรักษา/ลดแลกแจกแถมเร้าใจเกินงาม → ออกแบบเป็นแพ็ก/คุณค่าเพิ่ม
- **ทุกโปรฯ = "ร่างข้อเสนอ"** ต้องผ่านตรวจสอบโฆษณาสถานพยาบาลก่อนเผยแพร่ (แบนเนอร์เตือน + ประกาศ public ติด badge "ต้องรีวิวก่อน")
- วันรำลึก (เช่น วันสวรรคต ร.9) = เลี่ยงโทนลดแลกแจกแถม

## 8. ★ โมเดลต้นทุน/กำไร (margin guardrail) — หัวใจของระบบ
**2 ชั้น:**
1. **เพดานส่วนลด (HARD · บังคับ) = contribution margin** — กันแค่ **"ต้นทุนตรง/ผันแปร"** ให้เหลือ ≥ `min_margin` (default 35%)
   - `maxDisc = 1 − directCost / (1 − minMargin)` · บังคับ `promo_price ≥ normal × (1 − maxDisc)` ใน code
   - ต้นทุนตรงรายแผนก = `jera_prices` `sum(cost)/sum(price)` ต่อแผนก (รวม consumables + ค่าตอบแทนผันแปร DF/ค่าคลาส ที่อยู่ใน servicetask/commission) · cap 0.6 กัน outlier
2. **full-cost margin (SOFT · เตือน ไม่บล็อก)** = `1 − (directCost + overhead)` · โชว์ป้ายสี (🟢≥30% 🟠≥10% 🔴<10%)

**overhead = เฉลี่ยทั้งคลินิก (uniform · ไม่ปันรายแผนก)**
- `overhead = (payroll_active + rent + other + ค่าเสื่อมอาคาร[ถ้าเปิด]) / รายได้/เดือน`
- ❌ **ไม่ปัน overhead รายแผนก** เพราะ "รายได้ vs คนทำงาน ไม่ตรงแผนกกัน" (เช่นนวดอยู่ในแพ็ก Full Care → รายได้ลงผสม/กายภาพ แต่จ่ายพนักงานนวด) → ปันรายแผนกเกิด artifact (เคยได้ −248%)

**payroll = active เท่านั้น** ⚠️ gotcha ใหญ่
- ดึงจาก `events` (event_type='employee.payroll_set' ล่าสุด/คน) **JOIN `employees` กรอง status in (active, probation)**
- **ต้องกรอง terminated/resigned ออกเสมอ** — เดิมไม่กรอง → payroll ฿446k (รวมคนออก 11 คน) overhead 59% margin ดูบางผิด · กรองแล้ว ฿247k (15 คน) overhead 29% margin ปกติ

**ค่าเสื่อมอาคาร (ต้นทุนแฝง · toggle)**
- สาขาแรกไม่มีค่าเช่า (ซื้ออาคาร ฿11M) → `building_cost/building_years/building_include` ใน promo_settings
- ค่าเสื่อม = `cost / (years × 12)` (฿11M/30ปี ≈ ฿30,556/ด.) เข้า overhead เมื่อ `building_include=true` · ไม่กระทบเพดานลด (เป็น fixed)

**ตั้งค่าเองได้ (panel "ตั้งค่าต้นทุน/กำไร" · owner only):**
- กำไรขั้นต่ำ (min_margin) · ต้นทุนตรงรายแผนก (dept_costs · เว้นว่าง=auto จาก JERA, กรอก=override) · ค่าเสื่อมอาคาร · วันสำคัญคลินิก (custom_events)

**ผลลัพธ์จริง (active payroll · 2026-06-25):** overhead 29% · full-mg: กายภาพ 57% · ผสม 49% · นวด 39% · พิลาทิส 38% · กระดูก 32% · เพดานลด: กายภาพ ≤79% กระดูก ≤40%

---

## 9. กำหนดราคา + เป้ายอด
- AI กำหนด `normal_price` (ราคาปกติ อิง JERA) + `promo_price` (ราคาโปรฯ · ไม่ต่ำกว่าเพดาน) เป็นตัวเลขบาทจริง
- การ์ดโชว์: ราคาโปรฯ เด่น + ราคาปกติขีดฆ่า + "ประหยัด ฿X" + (owner) full-mg badge
- **เป้ายอดใส่เองได้:** ตอนกด "วางแผนลงมือ" prompt ถามเป้ายอด (`goal_revenue`) → AI วางแผนถอยหลังจากเป้า

## 10. เกาะเทศกาล + คิดแหวก
- **ปฏิทิน** (ในโค้ด · อ่านวันจริง Asia/Bangkok): วันหยุดไทย + สากล (วาเลนไทน์/ฮาโลวีน/คริสต์มาส) + วันช้อป (9.9/10.10/11.11/12.12/mid-year) + บริบทเดือน (อากาศ/จันทรคติ) + จังหวะเงินเดือนออก (25-สิ้นเดือน/1-5)
- นับถอยหลังจริง (วันสำคัญใน 80 วัน เรียงตามใกล้)
- **เพิ่มวันสำคัญคลินิกเองได้** (panel · custom_events เก็บใน promo_settings)
- กฎ AI: **≥2 โปรฯ จับ 2 คอร์สรวมแพ็กข้ามแผนก** (dept=ผสม · เหตุผลว่าเข้ากันยังไง) + **≥2 โปรฯ เกาะเทศกาลใกล้สุด**

## 11. แผนลงมือ (strategist · ปุ่ม "วางแผนลงมือ")
AI (Chief Growth Strategist) กาง execution plan เก็บใน `promo_ideas.plan` (jsonb):
- **กลยุทธ์** (positioning/why_now/target/success_metric/risk/budget)
- **revenue_target** (เป้ายอดตัวเลข · แยก from_new/from_existing · assumptions/breakeven)
- **เส้นทางคนไข้** (awareness→retention · แต่ละขั้น: touchpoint/ทีม/ระบบ + conversion_target + revenue_action ทำยังไงให้เกิดยอด)
- **หน้าบ้านต้องทำ** (frontdesk) · **หลังบ้านต้องเตรียม** (backoffice แยกทีม + lead_time) · **ปฏิทินประกาศแต่ละทีม** (announcements · D-offset → วันจริงจากวันเปิดโปรฯ · public ติด badge ต้องรีวิว)

## 12. Sales playbook (ทุกการ์ด · 4 ฟิลด์ — เน้นทีมงาน)
- `staff_reason` (เหตุผลเชิงดีมานด์/ฤดูกาล ไม่ใช่การเงิน) · `content_angle` (แนวคอนเทนต์ อิงครีเอทีฟ FB) · `target_audience` (ยิงกลุ่มไหนปิดได้ อิงคนไข้ใหม่) · `sales_how` (หน้าบ้านพิตช์/ปิดการขาย)

---

## 13. ตาราง (Supabase)
- **`promo_ideas`** — โปรฯ + status + ราคา + margin_pct + dept + season + plan(jsonb) + sales playbook + launch_date
- **`promo_settings`** (singleton id=1) — mode · min_margin · cost_ratio · dept_costs(jsonb) · custom_events(jsonb) · building_cost/years/include
- **`jera_prices`** — code/name/price/kind(course|service)/cost/dept (จาก JERA)
- RLS เปิด (no policy) เข้าผ่าน edge fn เท่านั้น (postgres.js DB_URL = superuser bypass RLS)

## 14. ⚠️ GOTCHAS (บทเรียนสำคัญ)
1. **payroll/HR ต้องกรอง `employees.status='active'` เสมอ** — มี terminated ค้างในระบบ (เคยทำ payroll เกินเท่าตัว)
2. **`acc_pay_terms` (OCR สัญญาจ้าง 47) เชื่อตัวเลขไม่ได้** — OCR ผิด (ผจก. OCR 35k จริง 18k) + ซ้ำ (หรรษรัตน์=ก๊อปชาลิสา) → **ไม่ใช้คิด margin** (ใช้ events payroll active แทน) · มี task ให้ HR เคลียร์
3. **payroll เก็บใน `events` ไม่ใช่ table** (event_type='employee.payroll_set' · acc_employee_payroll = fn ที่ parse events)
4. **ตารางที่สร้างผ่าน postgres.js (jera_prices/promo_*) ไม่อยู่ใน PostgREST cache** → REST query ตรงไม่ได้ ต้องผ่าน edge fn
5. **per-dept overhead = artifact** (revenue attribution ผิดแผนก) → ใช้ uniform
6. **direct cost ใช้ sum(cost)/sum(price)** ไม่ใช่ avg(cost/price) (กัน loss-leader เช่นปรึกษาแพทย์/home-visit cost>price ดึงเฉลี่ยเพี้ยน)
7. **Gemini 2.5 thinking กิน maxOutputTokens** → ตั้ง thinkingConfig.thinkingBudget สูง + maxOutputTokens ≥6144 + responseSchema (structured) · มี gem() timeout 45-90s + gemBest() fallback pro→flash
8. **ค่าเช่า/OPEX (branch_costs rent_monthly/other_monthly) = 0** (สาขานี้ซื้ออาคารเอง) → ใช้ ค่าเสื่อมอาคาร toggle แทน

## 15. ค่าคงที่ / secret
- HUB_SECRET (เขียน prices_sync) · HUB_ANON (anon JWT public) · service key เทส = ~/jera-sandbox/.env `SUPABASE_SERVICE_KEY`
- GEMINI_API_KEY, SUPABASE_DB_URL = Supabase function secrets
- BR (สาขา JERA) = `b5b80773-c7c2-5676-af68-96ba89661d25`

## 16. วิธี deploy / refresh
```bash
# deploy edge fn (จาก dir ที่มี supabase/functions/<fn>/index.ts)
supabase functions deploy promo_design --project-ref iyldrlzhftylewstfmsg
supabase functions deploy prices_sync  --project-ref iyldrlzhftylewstfmsg
# รีเฟรชราคาจาก JERA → jera_prices
python3 ~/jera-sandbox/pull_prices.py
# frontend = index.html (mountPromo) push GitHub Pages ปกติ (git pull --rebase ก่อน · หลาย session แก้ไฟล์เดียวกัน)
```
