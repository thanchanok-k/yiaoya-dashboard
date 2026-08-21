# ตัวเลข social ที่ "ยังดึงได้จริง" — ผลยิงทดสอบ 11 ส.ค. 2569

> ที่มา: ยิง Graph API จริงกับเพจ/บัญชีของ Yiaoya ทีละ metric (ไม่ได้อ่านจากเอกสาร Meta)
> ทดสอบบน: เยียวยา (144036758782939) · KneeCare (440009909190756) · Resto Pilates (558498130687803) · IG เยียวยา
> ทำไมต้องมีเอกสารนี้: Meta เลิก metric **ตามวันที่ ไม่ใช่ตามเวอร์ชัน API** — ยิง v21 หรือ v25 ก็ตายเท่ากัน การค้างเวอร์ชันเก่าไว้จึงไม่ช่วยอะไร

---

## 1. Facebook — ระดับโพสต์

### ตายถาวร (ทุกเวอร์ชัน v21–v24 · error เดียวกันหมด `(#100) must be a valid insights metric`)
`post_impressions` และญาติทั้งตระกูล (`_unique`, `_organic`, `_organic_unique`, `_paid`, `_fan`, `_viral`) · `post_engaged_users` · `post_reach` · `post_views` · `post_content_views` · `post_total_impressions` · `post_negative_feedback` · `post_story_adds` · `post_video_views_10s` · `blue_reels_total_plays`

**แปลว่า: ยอด impressions / reach รวมของโพสต์ ไม่มีทางดึงได้อีกแล้ว** ไม่ว่าจะทำอะไรก็ตาม

### ยังใช้ได้ (พร้อมค่าตัวอย่างจริง)
| metric | ตัวอย่าง | ใช้แทนอะไร |
|---|---|---|
| `post_fan_reach` | 567 / 70 / 28 | **reach ตัวเดียวที่เหลือ** — แต่นับเฉพาะแฟนเพจ |
| `post_video_views_unique` | 142 / 96 / 55 | ใกล้ reach จริงที่สุดสำหรับโพสต์วิดีโอ |
| `post_video_views` | 150 / 96 / 57 | ยอดวิว (นับตามเกณฑ์ post) |
| `post_clicks` · `post_clicks_by_type` | 4 · `{"other clicks":3,"photo view":1}` | คลิก |
| `post_activity_by_action_type` | `{"share":1,"like":1}` | **ใช้แทน engaged** (และแม่นกว่า field `shares` ที่คืน null บ่อย) |
| `post_reactions_by_type_total` | `{"like":5}` | reaction แยกชนิด |
| `post_video_avg_time_watched` | 5413 ms | ดูเฉลี่ยกี่วินาที |
| `post_video_view_time` | 1,938,268 ms | เวลาดูรวม |
| `post_video_complete_views_organic` | 10 | ดูจบกี่ครั้ง |
| `post_video_retention_graph` | `{"0":1,...,"4":0.69,...}` | กราฟคนดูหลุดตอนไหน |

### ★ ยอดวิว reel ตัวจริง อยู่บน video object ไม่ใช่ post
`GET /{video_id}/video_insights?metric=blue_reels_play_count` → **294 / 429 / 197**
โพสต์เดียวกัน `post_video_views` = 49 แต่ reel plays = 197 → **ตัวหลังคือเลขที่ตรงกับที่เห็นในแอป** ต้องใช้ตัวนี้เป็นยอดวิวหลัก

### ★ ความยาวคลิป Facebook — ได้
`GET /{video_id}?fields=length` → วินาที (ทศนิยม): `56.84`, `50.618`, `28.536`
video id หาจาก `attachments{target}` → `attachments.data[].target.id`

### ระดับเพจ (สำรอง เมื่อระดับโพสต์ไม่พอ)
ใช้ได้: `page_posts_impressions_organic` · `page_post_engagements` · `page_video_views` · `page_views_total` · `page_follows` · `page_daily_follows_unique`
ตาย: `page_impressions*` · `page_posts_impressions` (ถ้าไม่ใส่ `_organic`) · `page_engaged_users` · `page_fans` · `page_fan_adds`

---

## 2. Instagram

### ความยาวคลิป — API ไม่มีให้ แต่แกะจากไฟล์ได้
ยิงทดสอบทุกชื่อที่เป็นไปได้ (`duration`, `video_duration`, `length`, `media_duration`, `duration_ms` ฯลฯ) ได้ `nonexisting field` หมดทุกเวอร์ชัน v21–v25

**วิธีที่ได้จริง (ทดสอบสำเร็จ 3/3):** ขอ `media_url` (มากับ list อยู่แล้ว ไม่เปลือง request) → ดึงไฟล์แค่ **16 KB แรก** ด้วย HTTP Range → อ่าน atom `mvhd` ใน MP4 header → `duration / timescale`
ผลจริง: **39.66 · 56.96 · 12.20 วินาที** ใช้เวลา 3–55 ms ต่อคลิป

### metric ที่ยังไม่ได้เก็บ ทั้งที่ขอได้ฟรี (ตอนนี้ `social_stats` ขอแค่ `views,reach`)
ทั้ง REELS และ FEED: `saved` · `shares` · `likes` · `comments` · `total_interactions` · `reposts`
เฉพาะ REELS: `ig_reels_avg_watch_time` · `ig_reels_video_view_total_time` · `reels_skip_rate` (เช่น 71.7%)
เฉพาะ FEED: `profile_visits` · `profile_activity` · `follows`
ตายแล้ว: `impressions` (Meta แจ้งตรง ๆ ว่า "no longer supported from v22.0 and above" และตายย้อนหลังถึง v21) · `plays` · `video_views` · `thruplays` · `clips_replays_count`

**กับดักที่ต้องรู้:** `ig_reels_avg_watch_time` **นับ replay ด้วย** → เจอเคสคลิปยาว 12.2 วิ แต่ avg watch 21.75 วิ (ดูวนซ้ำ) ดังนั้น watch-ratio เกิน 100% ได้ ไม่ใช่บั๊ก

### กับดักอื่นใน `social_stats` (พบตอนออดิท ยังไม่แก้)
- คอลัมน์ชื่อ `media_type` เก็บค่า `media_product_type` (REELS/FEED) ไม่ใช่ media type (VIDEO/IMAGE) — ถ้าจะเก็บทั้งคู่ต้องเพิ่มคอลัมน์
- `media_url` เป็น signed CDN URL **หมดอายุ** ห้ามเก็บลง DB ไว้ใช้ยาว ให้เก็บแค่ `duration_sec` ที่แกะได้แล้ว
- ห้ามขอ field รวมเป็นชุดใหญ่ — ถ้ามีชื่อผิดตัวเดียว ทั้ง request พังหมด

---

## 3. Google Drive (ต้นทางไฟล์วิดีโอ)

- โฟลเดอร์จริงของคลิป = ปลายทาง Google Form **แบบแบนราบ ไม่มีชั้นปี/เดือน**: `10Gxtfk…AP5JgNkFw` ("อัพโหลดไฟล์ได้สูงสุด 10 ไฟล์ (File responses)") เจ้าของ marketing@altmedical.info
- ค่า `Google_Drive_Structure = YYYY/MM/Videos` ใน CONFIG ของ YYCT01 **ไม่มีอยู่จริง** และ `Google_Drive_Root` ว่าง → ต้องแก้ให้ชี้ folder id ข้างบน
- **ปริมาณจริงมากกว่าที่เข้าใจ**: มิ.ย. 2569 เดือนเดียว > 100 ไฟล์ (ไม่ใช่ 40–60) · mp4:mov ≈ 70:30
- Drive MCP **ไม่คืน** `videoMediaMetadata.durationMillis` (ทดสอบ 4 ไฟล์ + grep 200 ไฟล์ = 0) → ถ้าจะเอาความยาวจาก Drive ต้องเรียก Drive API v3 ตรง (`fields=files(videoMediaMetadata(durationMillis))`, `supportsAllDrives=true`) ทางที่ถูกที่สุดคือ Apps Script + Advanced Drive Service
- ต้องทดสอบก่อนเชื่อ: ไฟล์ `.mov` (≈30%) Drive จะเติม metadata หลัง transcode เท่านั้น อาจว่าง
- **ชื่อไฟล์ไม่ unique** (เจอชื่อซ้ำจริง 2 ไฟล์) → join กลับเข้า planner ด้วยชื่ออย่างเดียวไม่ได้ ต้องใช้ `fileId`

### ไฟล์แนบใน Trello ใช้แทนไม่ได้
5,385 ไฟล์แนบทั้งบอร์ด: อัปโหลดตรงเข้า Trello 90% · ลิงก์ Drive 9.4% — แต่ **เป็นไฟล์วิดีโอแค่ 11 ใบ** ที่เหลือเป็นรูป/กราฟิก

---

## 4. สรุปว่าตอนนี้ตอบอะไรได้บ้าง

| คำถาม | ตอบได้ไหม | ที่มา |
|---|---|---|
| คลิปนี้มีคนดูกี่คน (FB) | ได้ | `blue_reels_play_count` (reel) / `post_video_views_unique` |
| คลิปนี้มีคนดูกี่คน (IG) | ได้ | `views` + `reach` (เก็บอยู่แล้ว) |
| คนดูจบไหม ดูเฉลี่ยกี่วิ | ได้ทั้ง 2 ช่อง | FB: avg_time_watched + retention graph · IG: avg_watch_time + skip_rate |
| reach จริงของโพสต์ FB | **ไม่ได้ถาวร** | เหลือแค่ fan reach |
| ความยาวคลิป FB | ได้ | video `length` |
| ความยาวคลิป IG | ได้ (แกะจาก MP4 header) | ต้องแก้ `social_stats` ก่อน |
| ความยาวคลิปที่ยังไม่โพสต์ | ยังไม่ได้ | ต้องต่อ Drive API |
| TikTok | ยังไม่ได้ | ยังไม่มีท่อเข้าฮับ |

---

## 5. สิ่งที่ทำไปแล้ว / ยังไม่ได้ทำ

**ทำแล้ว 11 ส.ค. 69**
- `fb_organic` v27 — เพิ่มรอบ 2 (insights ทีละ metric + fail-soft) · รอบ 3 (video length + reel plays) · ขอ `attachments` เพื่อแยกคลิป/รูป · ย้ายไป v23.0 · เพิ่ม `limit_posts`/`refresh_hours` กันหมดเวลา รันซ้ำได้
- `public.fb_posts` เพิ่มคอลัมน์: `media_type, fan_reach, clicks, video_views, video_views_unique, reel_plays, video_len_sec, avg_watch_sec, watch_time_sec, completes, reactions_total, insights_at, insights_dead`
- **Backfill 90 วันเสร็จ** — ผลเทียบก่อน/หลัง:

| ตัวชี้วัด | ก่อน | หลัง |
|---|---|---|
| โพสต์ที่มี insights | 0 | **129 / 129** |
| fan_reach > 0 | 0 | 125 |
| ยอดเล่น reel > 0 | 0 | 73 |
| รู้ความยาวคลิป | 0 | 73 |
| แยกคลิป/รูปได้ | ไม่ได้ | 73 คลิป / 51 รูป |

`dead_metrics` = ว่างทุก batch (metric ทั้ง 9 ตัวรอดทุกโพสต์) · ไม่มี error

### ✅ แก้ตัวชนแล้ว: `social_stats` v5 (12 ส.ค. 69)
ของเดิม `social_stats` (cron 05:55 น. ไทย) `update fb_posts set views=post_video_views, engaged=post_clicks`
→ ทับค่าที่ `fb_organic` เขียน ด้วยเลขที่ **ต่ำกว่าความจริง**
**เกิดขึ้นจริงแล้ว 1 รอบ** — เช้า 12 ส.ค. มันทับ 10 ใบ (เช่น reel plays 243 → เหลือ 58) ตรวจเจอตอน verify แล้วสั่ง `fb_organic` ซ่อมกลับครบ
**แก้แล้ว:** ถอดบล็อก FB ออกจาก `social_stats` เหลือแค่ IG + page-level · โพสต์รายชิ้นเป็นหน้าที่ `fb_organic` อย่างเดียว

### ✅ `social_stats` v5 — IG ครบชุด
- metric ใหม่: `saved` `shares` `likes` `comments` `total_interactions` `reposts` + REELS: `ig_reels_avg_watch_time` `ig_reels_video_view_total_time` `reels_skip_rate` + FEED: `profile_visits` `profile_activity` `follows`
- **ความยาวคลิป** จาก MP4 header (16KB แรก) · แกะครั้งเดียวแล้วเก็บ ไม่แกะซ้ำ
- แยก `media_type` (REELS/FEED) กับ `product_type` (VIDEO/IMAGE) เป็นคนละคอลัมน์แล้ว
- ไม่เก็บ `media_url` ลง DB (signed URL หมดอายุ)
- ถ้า metric ชุดใหม่พัง → ถอยไป `views,reach` อัตโนมัติ ไม่ให้ทั้งรอบล่ม
- ผลรันจริง: IG 31 ชิ้น/30 วัน · ได้ความยาว 15/16 รีล · `saved` ครบ 31/31

### ✅ ลบฟังก์ชันทดสอบแล้ว
`tmp_probe_fb` · `tmp_probe_ig` — ลบทั้งคู่ ยืนยันด้วย HTTP 404

### ค้างอยู่
- cron `fb_organic_nightly` ส่งแค่ `{days:90}` → `limit_posts` ใช้ค่าเริ่มต้น 40/คืน กับโพสต์ ~130 ใบ = แต่ละใบรีเฟรชทุก ~3 วัน ถ้าอยากให้สดทุกวันต้องเพิ่มเป็น 60–70
- ต่อ Drive API เอาความยาวคลิปตั้งแต่ก่อนโพสต์ · ต่อ TikTok เข้าฮับ

**ยังไม่ได้ทำ (รออนุมัติ)**
- `social_stats` (IG) — เพิ่ม metric 11 ตัว + ความยาวคลิปจาก MP4 header (มี patch พร้อมแล้ว)
- `ig_media` เพิ่มคอลัมน์ 12 ตัว
- ต่อ Drive API เอาความยาวคลิปตั้งแต่ก่อนโพสต์
- ต่อ TikTok เข้าฮับ
- ลบฟังก์ชันทดสอบ `tmp_probe_fb` และ `tmp_probe_ig` (ตัว fb มี fallback key ฝังในโค้ด — ควรลบ)
