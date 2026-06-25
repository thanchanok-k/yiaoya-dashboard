# Content Engine — Sync + Auto-post (Phase 1+2) วิธี deploy

ระบบ: Google Sheet "Content planner V3" = แหล่งจริงเดียว → Supabase (yiaoya-hub) → Dashboard + LINE
ทีมกรอกใน V3 ที่เดียว · dashboard อัปเดตเอง (ไม่กรอกซ้ำ)

โค้ดที่เตรียมไว้แล้ว:
- `supabase/migrations/20260625_content.sql` — 6 ตาราง (additive ไม่แตะของเดิม)
- `supabase/functions/content_ingest/` — รับจาก Apps Script (guard HUB_SECRET)
- `supabase/functions/content_list/` — dashboard อ่าน (role gate)
- `appsscript/Content_Sync.gs` — วางในชีต V3

---

## Phase 1 — Sync (3 ขั้น)

### ขั้น A — สร้างตาราง + deploy edge fn (รันในเครื่อง)
> ต้องใช้รหัส DB ของ project (เจ้าของ/แอดมินเท่านั้น) — Claude ไม่มีค่านี้

```bash
cd ~/yiaoya-dashboard
supabase link --project-ref iyldrlzhftylewstfmsg     # ผูกโปรเจกต์ (ครั้งเดียว)
supabase db push                                      # สร้าง 6 ตารางจากไฟล์ migration
supabase functions deploy content_ingest --no-verify-jwt   # ingest ใช้ HUB_SECRET แทน JWT
supabase functions deploy content_list                # list ต้องมี JWT (authenticated) อ่านได้
```
- `link` = บอก CLI ว่าจะทำงานกับ project ไหน
- `db push` = เอา SQL ในโฟลเดอร์ migrations ขึ้น DB จริง (สร้างตาราง)
- `functions deploy ... --no-verify-jwt` = ingest เปิดให้ Apps Script เรียกได้ (กันด้วย HUB_SECRET ในโค้ดแทน)
- `functions deploy content_list` = ปล่อยฟังก์ชันอ่าน (บังคับ login ก่อนเรียก)

> ⚠️ ต้องมี secret 2 ตัวตั้งไว้แล้วใน project (ปกติมีอยู่จากระบบ Ads/HR): `HUB_SECRET`, `DB_URL`
> เช็ค: `supabase secrets list` — ถ้าไม่มี ตั้งด้วย `supabase secrets set HUB_SECRET=xxxx DB_URL="postgres://..."`

### ขั้น B — ติดตั้ง Apps Script ในชีต V3 (พี่ทำ — สิทธิ์เจ้าของ)
1. เปิดชีต V3 → เมนู **ส่วนขยาย (Extensions) → Apps Script**
2. สร้างไฟล์ใหม่ → วางเนื้อหา `appsscript/Content_Sync.gs` ทั้งหมด
3. **Project Settings → Script Properties** เพิ่ม 2 ค่า:
   - `INGEST_URL` = `https://iyldrlzhftylewstfmsg.supabase.co/functions/v1/content_ingest`
   - `HUB_SECRET` = (ค่าเดียวกับใน Supabase)
4. กลับมา → เลือกฟังก์ชัน `setupContentSync` → กด Run (อนุญาตสิทธิ์ครั้งแรก)
   → จะ sync ทันที 1 รอบ + ตั้ง trigger ดึงทุกชั่วโมงให้เอง

> Apps Script รัน "ในนามพี่" จึงอ่านชีตได้ปกติ — ไม่ติด AI-block ที่ Claude เจอ

### ขั้น C — ให้ dashboard อ่านข้อมูลจริง (Claude ทำ หลังขั้น A+B เสร็จ)
แก้ mount functions ใน index.html: เปลี่ยนจาก mock (CN_*) → `sb.functions.invoke('content_list')` แล้ว map ลงการ์ดเดิม (มี fallback กลับ mock ถ้าดึงไม่ได้) → push

---

## Phase 2 — Auto-post (ตั้งเวลาโพสต์ "หลังอนุมัติ")
ทำต่อเมื่อ Phase 1 ข้อมูลไหลแล้ว · **โพสต์เฉพาะชิ้นที่ status = ผ่านการรีวิว/อนุมัติ** (คงด่านคนเคาะตามกฎหมาย)

ต้องการจากพี่ (Claude สร้างเองไม่ได้):
- **Meta:** Page Access Token (สิทธิ์ `pages_manage_posts`, `pages_read_engagement`) + IG Business (`instagram_content_publish`) — จาก Meta Business / Graph API
- **LINE OA:** Channel access token (Messaging API) — มีอยู่แล้วในระบบ acc/hr OA
- **TikTok:** ต้องสมัคร Content Posting API (อนุมัติช้า — เฟสหลัง)

จะสร้าง:
- ตาราง `content_schedule` (piece_id, platform, scheduled_at, status, posted_link)
- edge fn `content_publish` (อ่านคิวที่ถึงเวลา + status=อนุมัติ → ยิง Graph/LINE API → เขียน posted_link กลับ)
- pg_cron รันทุก 5–15 นาที เช็คคิว
- ปุ่ม "ตั้งเวลาโพสต์" ใน dashboard (หน้า คิวโพสต์) เขียน content_schedule
