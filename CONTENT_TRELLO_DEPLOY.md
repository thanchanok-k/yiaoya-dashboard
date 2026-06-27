# Trello → กระดานผลิต (Kanban) — วิธี deploy

ดึงบอร์ด **YY: Content Creator** จาก Trello สดทุกครั้งที่เปิดหน้า (on-demand) มาเสริมการ์ดในกระดานผลิต
รวม **เนื้อหาการ์ด (desc) + คอมเมนต์ทุกอัน** (คนเขียน + วันเวลา)

สถาปัตยกรรม: Dashboard → `content_trello` (Edge Function, เก็บ token ฝั่งเซิร์ฟเวอร์) → Trello API → ส่งกลับเป็น pieces
**token ไม่โผล่ฝั่ง client เลย** · ฟังก์ชันบังคับ login (verify_jwt) เพราะคอมเมนต์อาจมีข้อมูลคนไข้ (PDPA)

โค้ดที่เตรียมไว้แล้ว:
- `supabase/functions/content_trello/index.ts` — proxy ดึง Trello (ผ่าน `deno check` แล้ว)
- `index.html` — ต่อบอร์ดให้แล้ว (`cnLoadTrello` + แสดง desc/คอมเมนต์ใน modal + chip Trello/จำนวนคอมเมนต์)

---

## ขั้น A — เอา Trello API key + token (พี่ทำ ครั้งเดียว · สิทธิ์เจ้าของบัญชี Trello)

1. **API key:** เปิด <https://trello.com/power-ups/admin> → สร้าง Power-Up (ชื่ออะไรก็ได้ เช่น "Yiaoya Dashboard") → แท็บ **API Key** → คัดลอกค่า `API Key`
2. **Token (อ่านอย่างเดียว พอ):** เปิดลิงก์นี้ (แทน `YOURKEY` ด้วย API Key ข้างบน) แล้วกด **Allow**:
   ```
   https://trello.com/1/authorize?expiration=never&scope=read&name=Yiaoya%20Dashboard&key=YOURKEY&response_type=token
   ```
   → จะได้ token ยาว ๆ มา คัดลอกเก็บไว้
   - `expiration=never` = token ไม่หมดอายุ · `scope=read` = อ่านได้อย่างเดียว (ปลอดภัย ลบ/แก้บอร์ดไม่ได้)

---

## ขั้น B — ตั้ง secret + deploy (รันในเครื่อง · ต้องมีรหัส DB ของ project)

```bash
cd ~/yiaoya-dashboard
supabase link --project-ref iyldrlzhftylewstfmsg     # ผูกกับ project (ถ้ายังไม่ได้ผูก)
supabase secrets set TRELLO_KEY=<API Key จากขั้น A1> TRELLO_TOKEN=<token จากขั้น A2>
supabase functions deploy content_trello             # deploy แบบ verify_jwt เปิด (บังคับ login)
```

อธิบายทีละบรรทัด:
- `link` = บอก CLI ว่าจะทำงานกับ project ไหน (ครั้งเดียวพอ)
- `secrets set` = เก็บ key/token ไว้ฝั่ง Supabase (เข้ารหัส) — โค้ดอ่านผ่าน `Deno.env.get` ไม่ฝังในไฟล์
- `functions deploy content_trello` = ปล่อยฟังก์ชันขึ้นใช้งานจริง (ไม่ใส่ `--no-verify-jwt` → ต้อง login ก่อนเรียก = กัน PDPA)
- (ถ้าอยากเปลี่ยนบอร์ด: `supabase secrets set TRELLO_BOARD=<board id>` · ค่า default คือบอร์ด Content Creator)

---

## ขั้น C — ตรวจว่าใช้ได้

1. เปิดแดชบอร์ด → เมนู **กระดานผลิต** → การ์ดจาก Trello จะมีป้าย <kbd>Trello</kbd> สีฟ้า + ตัวเลขจำนวนคอมเมนต์
2. คลิกการ์ด → เห็น **เนื้อหา** + **คอมเมนต์ทั้งหมด** (คนเขียน + วันที่) + ปุ่ม "เปิดการ์ดใน Trello"
3. ถ้าไม่ขึ้น: เปิด DevTools (F12) → Console หา `content_trello` → ข้อความ error จะบอกสาเหตุ (เช่น ยังไม่ตั้ง secret)

ทดสอบ backend ตรง ๆ:
```bash
curl -s -X POST "https://iyldrlzhftylewstfmsg.supabase.co/functions/v1/content_trello" \
  -H "Authorization: Bearer <JWT ของ user ที่ login แล้ว>" | head -c 800
```

---

## การแมป (mapping) ที่ตั้งไว้

**ลิสต์ Trello → คอลัมน์กระดานผลิต** (ในไฟล์ `content_trello/index.ts` ตัวแปร `LIST_MAP` แก้เพิ่มได้):

| Trello list | คอลัมน์ |
|---|---|
| ไอเดีย / วางแผน | วางแผน |
| กำลังทำ | กำลังทำ |
| ดำเนินการเรียบร้อย ✅ | ส่งงานแล้ว |
| พี่ตองตรวจ / พี่ฟาตรวจ | อยู่ระหว่างการตรวจ |
| รอรีวิวจากพี่เซิน | อยู่ระหว่างการตรวจ (ชั้นเซิน) |
| แก้ไข | แก้ไข |
| ผ่านการรีวิว | ผ่านการรีวิว |
| นำไปใช้จริง (โพสแล้ว) | โพสเรียบร้อย |

ลิสต์อื่น (Ads / สรุปงานรายเดือน / Template ฯลฯ) = **ข้าม** ไม่เอาเข้าบอร์ด

**ผู้ดูแล (who):** อ่านจาก label คนใน Trello → ถ้าชื่อไม่ตรงกับชื่อในแดชบอร์ด เติมที่ตัวแปร `WHO_MAP`
**แผนก (dept):** บอร์ด Trello นี้ไม่มี field แผนก → เว้นว่าง (ถ้าทีมเริ่มติด label แผนก ค่อยแมปเพิ่ม)

---

## สถานะ (27 มิ.ย. 2569) — LIVE ✅

- ตั้ง secret `TRELLO_KEY` + `TRELLO_TOKEN` (read-only) + deploy แล้ว · ยิงเทสผ่าน
- ผลจริง: **533 การ์ด** เข้ากระดานผลิต (จาก 1,168 ใบในบอร์ด — เอาเฉพาะลิสต์ใน pipeline) · **802 คอมเมนต์**
- **แก้บั๊ก `API_TOO_MANY_CARDS_REQUESTED`:** บอร์ดมีการ์ด 1,168 ใบ → ขอ `cards` พ่วง `actions` ทีเดียวไม่ได้
  เปลี่ยนเป็น **ดึงการ์ด (ไม่พ่วง actions) + ดึงคอมเมนต์ทั้งบอร์ด `boards/{id}/actions?filter=commentCard&limit=1000` แยก แล้วจับคู่ตาม card id**
  → ข้อจำกัด: เห็นคอมเมนต์ล่าสุด **1,000 อันทั้งบอร์ด** (ครอบคลุมงาน active) · ถ้าต้องการลึกกว่านี้ค่อยทำ paginate `before=`
- เรื่อง key/token ที่เคยพลาด: **Secret ≠ Token** — token จริงขึ้นต้น `ATTA...` กดจากลิงก์ authorize (`scope=read`) เท่านั้น

### รูปงาน (ผลงาน) ในการ์ด — เพิ่ม 27 มิ.ย. 2569
- การ์ด 491/533 ใบมีรูปแนบ → โชว์ **รูปย่อบนการ์ด** (กระดานผลิต) + **รูปเต็มในโมดัล** (หัวข้อ "ผลงาน")
- รูป Trello เปิดได้เฉพาะ `Authorization: OAuth oauth_consumer_key="KEY", oauth_token="TOKEN"` (header เท่านั้น · query/public ไม่ได้)
  → ห้ามฝัง token ใน client (PDPA) เลยทำ proxy ฝั่งเซิร์ฟเวอร์
- **ฟังก์ชันใหม่ `content_trello_img`** (deploy แบบ `--no-verify-jwt` เพราะ `<img>` ส่ง bearer ไม่ได้):
  - กั้นด้วย **HMAC** (`CONTENT_SECRET`) — `content_trello` เซ็น `c:a:p` ต่อรูป · proxy ตรวจ sig ก่อนดึง · sig ปลอม = 403
  - cache `public, max-age=86400, immutable` → browser cache ได้ (URL เซ็นคงที่) ลดโหลด Trello
- `content_trello` ส่ง `thumb` (preview ~250px) + `image` (~800px) เป็น signed URL ต่อ piece
- หน้าเว็บ: thumbnail ใช้ `loading="lazy"` โหลดเฉพาะการ์ดที่เลื่อนเห็น
- deploy: `supabase functions deploy content_trello` + `supabase functions deploy content_trello_img --no-verify-jwt`

### รวมการ์ดซ้ำ V3 + Trello — เพิ่ม 27 มิ.ย. 2569
- กระดานผลิตดึงจาก 2 แหล่ง (ชีต V3 `content_pieces` + Trello) → เคยโชว์การ์ดเดียวกัน 2 รอบ (709 ใบ)
- `cnDATA()` รวมด้วย **ชื่อการ์ด** (normalize): Trello เป็นฐาน (รูป/คอมเมนต์/สถานะสด) + เติม KPI/eng/โปรโม/วันโพสต์จาก V3 · V3 ที่ไม่มีคู่คงไว้
- ผลจริง: ยุบซ้ำได้ 66 ใบ (709→644) · ถ้าอยากแม่น 100% ให้เก็บ "ลิงก์ Trello" ลงชีต V3 แล้วจับคู่ด้วยลิงก์แทนชื่อ

### สั่งงานกลับ Trello (คอมเมนต์/อนุมัติ/ตีกลับ/ย้ายสถานะ) — เพิ่ม 27 มิ.ย. 2569
- ต้องใช้ **token แบบ `scope=read,write`** (ขอใหม่จากลิงก์ authorize · token เดิม read-only ใช้ไม่ได้) → ตั้งทับ `TRELLO_TOKEN`
- **ฟังก์ชันใหม่ `content_trello_action`** (verify_jwt=TRUE — ต้อง login ก่อนสั่งงาน):
  - `comment` → POST คอมเมนต์ · `move` → PUT idList ตาม `COL_TO_LIST` · `approve` → ย้าย "ผ่านการรีวิว" + คอมเมนต์ · `reject` → ย้าย "แก้ไข" + คอมเมนต์
  - คอมเมนต์เซ็นชื่อผู้สั่งอัตโนมัติ: `[<ชื่อ> · แดชบอร์ด] ...` (token เป็นบัญชีกลาง Zern → ต้องเซ็นชื่อให้ทีมรู้ว่าใครสั่ง)
  - card id รับได้ทั้ง `TR-<shortlink>` หรือ shortlink เปล่า (Trello รับ shortLink แทน card id ได้)
- หน้าเว็บ: โมดัลมีกล่องคอมเมนต์ + ปุ่ม ส่งคอมเมนต์/อนุมัติ/ตีกลับ (`cnTrelloAct`) · ลากการ์ด Trello ข้ามคอลัมน์ → `cnAct` ย้าย list ใน Trello ตรงๆ
- deploy: `supabase functions deploy content_trello_action`
- ทดสอบแล้ว: comment + approve(move+comment) เขียนเข้า Trello จริง แล้วลบ/ย้อนกลับ — ผ่าน

### งานที่เป็นลิงก์ (Canva/Drive) ไม่ใช่รูปแนบ — เพิ่ม 27 มิ.ย. 2569
ปัญหา: หลายการ์ดงานจริงอยู่บน **Canva/Google Drive** (เป็นลิงก์) ไม่ได้อัปรูปเข้า Trello → เปิดการ์ดแล้วไม่เห็นงาน + คอมเมนต์เป็นพืดลิงก์ดิบ
- **`content_trello` ส่ง `links[]`** (attachment ที่ไม่ใช่รูป + URL ใน desc) = `{name,url,kind}` · kind: canva/drive/youtube/tiktok/facebook/link
- **Google Drive thumbnail สาธารณะ** (`drive.google.com/thumbnail?id=..&sz=w400`, ไม่ต้อง token) → การ์ดไม่มีรูปแนบแต่มีลิงก์ Drive ใช้ thumbnail เป็นรูป `thumb`/`image` ได้เลย
- หน้าเว็บ: โมดัลมีปุ่ม **"เปิดดูงาน"** (Canva/Drive/ฯลฯ) + `_cnLinkify()` แปลงลิงก์ดิบ/มาร์กดาวน์ Trello (`[..](url "smartCard-inline")`) ในเนื้อหา+คอมเมนต์ → ลิงก์คลิกได้สั้น (โดเมน ↗)
- **บั๊กที่แก้:** token placeholder ของ `_cnLinkify` ห้ามใช้ ` <เลข> ` (ชนตัวเลขในข้อความ → โผล่ "undefined") · เปลี่ยนเป็น `@@LK<i>@@`
- ผลจริง: 361 การ์ดมีลิงก์งาน (Drive 376 · Facebook 705 = ลิงก์โพสต์จริง · Canva 14)

## หมายเหตุ
- **เสริม ไม่ทับ V3:** ถ้าชีต V3 sync แล้ว บอร์ดจะโชว์ V3 + Trello รวมกัน · ถ้า V3 ยังไม่มา จะโชว์ Trello อย่างเดียว (ทิ้ง mock อัตโนมัติ)
- **ดึงสดทุกครั้ง:** ทุกครั้งที่เปิดหน้า = ดึง Trello ใหม่ ไม่มี cache (ข้อมูลตรงกับ Trello เสมอ)
- **PDPA:** คอมเมนต์เคสโฮม/คนไข้มีชื่อ-ที่อยู่จริง → ฟังก์ชันบังคับ login แล้ว · ถ้าต้องจำกัดเฉพาะบางบทบาท แจ้งได้ จะเพิ่ม role gate
