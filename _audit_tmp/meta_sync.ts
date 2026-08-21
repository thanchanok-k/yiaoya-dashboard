// meta_sync — ดึง Meta Ads insights (ราย campaign, รายวัน) → upsert เข้า ad_daily
// อ่านอย่างเดียวจาก Meta ด้วย META_ACCESS_TOKEN (read-only system user token, ไม่หมดอายุ)
// เรียกโดย: pg_cron (cron_post → secret ใน body) | manual (?secret=HUB_SECRET) | service_role (Bearer)
// verify_jwt=false → ฟังก์ชันเช็ค secret เอง
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HUB_SECRET   = Deno.env.get("HUB_SECRET") ?? "";
const META_TOKEN   = (Deno.env.get("META_ACCESS_TOKEN") ?? "").trim();
const ENGAGE_TOKEN = (Deno.env.get("META_ENGAGE_TOKEN") ?? "").trim();
const ADS_TOKEN    = (Deno.env.get("META_ADS_TOKEN") ?? "").trim();   // ads_management + pages_manage_ads + leads_retrieval
const GEMINI_KEY   = (Deno.env.get("GEMINI_API_KEY") ?? "").trim();
// สิทธิ์ที่โพสต์ลงเพจได้ (gate หน้าโพสต์) — role ใน app_metadata หรือ email ใน allowlist
const PUBLISH_ROLES = new Set(["owner", "director", "hq", "admin", "content", "content_lead", "adops"]);
const HQ_EMAILS = (Deno.env.get("HQ_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const GRAPH = "https://graph.facebook.com/v21.0";

// action types ที่นับเป็น conversion / รายได้ (ปรับเพิ่มได้)
const PURCHASE_TYPES = new Set([
  "purchase", "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
]);
const LEAD_TYPES = new Set([
  "lead", "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o, null, 2), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
// ดึงค่า tag จากชื่อแคมเปญ เช่น "|PAGE:KNEE|" → "KNEE"
const tagVal = (s: string, key: string) => {
  const m = new RegExp("(?:^|\\|)\\s*" + key + ":([^|]+)", "i").exec(s || "");
  return m ? m[1].trim() : "";
};

function sumActions(arr: any, types: Set<string>) {
  if (!Array.isArray(arr)) return 0;
  let t = 0;
  for (const a of arr) if (types.has(a.action_type)) t += num(a.value);
  return t;
}
// ★ เลือก action_type ที่ count สูงสุดในหมวด แล้วอ่าน value ของ type เดียวกัน → count/value มาจาก event เดียวกัน + กันนับ alias ซ้ำ
function pickConv(actions: any, values: any, types: Set<string>): { count: number; value: number } {
  let best = "", bestC = 0;
  if (Array.isArray(actions)) for (const a of actions) if (types.has(a.action_type)) { const v = num(a.value); if (v > bestC) { bestC = v; best = a.action_type; } }
  let val = 0;
  if (best && Array.isArray(values)) for (const a of values) if (a.action_type === best) val += num(a.value);
  return { count: bestC, value: val };
}

async function graphGet(url: string) {
  // ส่ง token ผ่าน Authorization header (กันอักขระเพี้ยนใน URL)
  const r = await fetch(url, { headers: { "Authorization": `Bearer ${META_TOKEN}` } });
  const j = await r.json();
  if (j.error) throw new Error(`Graph: ${j.error.message}`);
  return j;
}
// เหมือน graphGet แต่ส่ง token ที่ระบุ (เช่น page token) ผ่าน header — กัน token หลุดใน URL/log
async function graphGetT(url: string, tok: string) {
  const r = await fetch(url, { headers: { "Authorization": `Bearer ${tok}` } });
  const j = await r.json();
  if (j.error) throw new Error(`Graph: ${j.error.message}`);
  return j;
}

// ดึงค่าจาก field_data ของ lead form (ชื่อ field หลากหลาย ไทย/อังกฤษ)
function leadField(fd: any, keys: string[]): string {
  if (!Array.isArray(fd)) return "";
  for (const f of fd) {
    const n = String(f.name || "").toLowerCase();
    if (keys.some((x) => n.includes(x))) return Array.isArray(f.values) ? String(f.values[0] || "") : "";
  }
  return "";
}

// ★ SECURITY: verify ตัวตน "จริง" ไม่ decode .role จาก JWT เอง (verify_jwt=false → ปลอม service_role/role ได้)
//   • Bearer === SERVICE_KEY  → service caller (cron_authed / internal) เชื่อถือได้
//   • token อื่น → auth.getUser() ให้ auth server verify signature ก่อน แล้วค่อยอ่าน email/role จาก user จริง
type Caller = { verified: boolean; service?: boolean; email?: string; role?: string };
async function authUser(req: Request): Promise<Caller> {
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (!token) return { verified: false };
  if (SERVICE_KEY && token === SERVICE_KEY) return { verified: true, service: true };
  try {
    const ua = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await ua.auth.getUser(token);
    if (error || !data?.user) return { verified: false };
    const u = data.user;
    // ★ SECURITY: role จาก app_metadata เท่านั้น (admin คุม) — ห้ามเชื่อ user_metadata (ผู้ใช้ updateUser เองได้ → self-escalate)
    const role = String((u.app_metadata as any)?.role || "").toLowerCase();
    return { verified: true, email: String(u.email || "").toLowerCase(), role };
  } catch { return { verified: false }; }
}
// มีสิทธิ์โพสต์ไหม — service (cron/internal) หรือ user ที่ verify แล้วและ role/email อยู่ใน allowlist
function canPublish(c: Caller): boolean {
  if (c.service) return true;
  if (!c.verified) return false;
  if (c.role && PUBLISH_ROLES.has(c.role)) return true;
  if (c.email && HQ_EMAILS.includes(c.email)) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });   // CORS preflight (เรียกจาก browser/dashboard)
  // ── auth: secret (query/body/header) == HUB_SECRET  หรือ  JWT role service_role/authenticated ──
  const u = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* ignore */ } }
  const secret = u.searchParams.get("secret") || body?.secret || req.headers.get("x-hub-secret") || "";
  const okSecret = !!HUB_SECRET && secret === HUB_SECRET;
  // ★ SECURITY: HUB_SECRET (cron_post) หรือ ตัวตนที่ verify จริง (Bearer SERVICE_KEY / getUser) — ไม่เชื่อ decode role
  const caller: Caller = okSecret ? { verified: true, service: true } : await authUser(req);
  if (!caller.verified) return json({ ok: false, error: "unauthorized" }, 401);

  // ★ SECURITY: โหมด server/admin-only (ดึงข้อมูล/เขียน ad_daily/ดึง PII lead) — เฉพาะ service(cron) หรือผู้บริหาร/ทีมการตลาด
  //   (browser ของพนักงานทั่วไปเรียกไม่ได้) · ทุกโหมดต้อง service หรือ canPublish (owner/ผู้บริหาร/การตลาด) · publish ยังมีด่าน canPublish ซ้ำด้านล่าง
  //   explore(ดูค่าแอด/ยอดทั้งบริษัท) + caption(เผา Gemini quota) gate ด้วย — เฉพาะผู้บริหาร/การตลาด
  if (!(caller.service || canPublish(caller))) {
    return json({ ok: false, error: "forbidden — สำหรับระบบ/ผู้บริหาร/ทีมการตลาดเท่านั้น" }, 403);
  }

  // ══ โหมด engage_check: เช็ค META_ENGAGE_TOKEN ใช้ได้ + เพจ/IG ที่โพสต์ได้ (inventory) ══
  if (body?.mode === "engage_check") {
    if (!ENGAGE_TOKEN) return json({ ok: false, error: "META_ENGAGE_TOKEN not set" }, 500);
    const pages: any[] = [];
    const errors: any[] = [];
    try {
      let url = `${GRAPH}/me/accounts?fields=id,name,tasks,instagram_business_account{id,username}&limit=200`;
      while (url) {
        const j = await fetch(url, { headers: { "Authorization": `Bearer ${ENGAGE_TOKEN}` } }).then((r) => r.json());
        if (j.error) throw new Error(j.error.message);
        for (const p of (j.data || [])) {
          pages.push({
            id: p.id, name: p.name, tasks: p.tasks || [],
            ig: p.instagram_business_account
              ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username }
              : null,
          });
        }
        url = j.paging?.next || "";
      }
    } catch (e) { errors.push(String((e as Error).message || e)); }
    return json({ ok: errors.length === 0, mode: "engage_check", page_count: pages.length, pages, errors });
  }

  if (!META_TOKEN) return json({ ok: false, error: "META_ACCESS_TOKEN not set" }, 500);

  // ══ โหมด publish: โพสต์ลงเพจ FB ผ่าน ENGAGE token (published=false = ร่าง ไม่ขึ้นหน้าเพจ) ══
  if (body?.mode === "publish") {
    if (!canPublish(caller)) return json({ ok: false, error: "forbidden — ต้องเป็นทีมคอนเทนต์/ผู้บริหารถึงโพสต์ได้" }, 403);
    if (!ENGAGE_TOKEN) return json({ ok: false, error: "META_ENGAGE_TOKEN not set" }, 500);
    const pageId = String(body.page_id || "");
    const message = String(body.message || "");
    const imageUrl = body.image_url ? String(body.image_url) : "";
    const link = body.link ? String(body.link) : "";
    const published = body.published !== false;   // default true; ส่ง false = ร่าง
    if (!pageId || (!message && !imageUrl)) return json({ ok: false, error: "ต้องมี page_id + message หรือ image_url" }, 400);
    // 1) ขอ page access token (โพสต์ต้องใช้ token ของเพจ ไม่ใช่ของ user)
    let pageToken = "";
    try {
      const j = await fetch(`${GRAPH}/${pageId}?fields=access_token`, { headers: { "Authorization": `Bearer ${ENGAGE_TOKEN}` } }).then((r) => r.json());
      if (j.error) throw new Error(j.error.message);
      pageToken = j.access_token || "";
    } catch (e) { return json({ ok: false, error: `page token: ${String((e as Error).message || e)}` }, 502); }
    if (!pageToken) return json({ ok: false, error: "ไม่ได้ page token (เพจยังไม่ assign ให้ system user?)" }, 502);
    // 2) โพสต์ (มีรูป=/photos, ไม่มี=/feed)
    const params: Record<string, string> = { access_token: pageToken, published: String(published) };
    let endpoint = "";
    if (imageUrl) { endpoint = `${GRAPH}/${pageId}/photos`; params.url = imageUrl; if (message) params.caption = message; }
    else { endpoint = `${GRAPH}/${pageId}/feed`; params.message = message; if (link) params.link = link; }
    const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
    const jr = await r.json();
    if (jr.error) return json({ ok: false, error: jr.error.message }, 502);
    return json({ ok: true, mode: "publish", page_id: pageId, post_id: jr.id || jr.post_id || null, published });
  }

  // ══ โหมด conv_check: นับแชท Messenger ต่อเพจ (พิสูจน์ว่ามี lead จากแชท) ══
  if (body?.mode === "conv_check") {
    if (!ENGAGE_TOKEN) return json({ ok: false, error: "META_ENGAGE_TOKEN not set" }, 500);
    const pages: any[] = [];
    const out: any[] = [];
    const errors: any[] = [];
    let purl = `${GRAPH}/me/accounts?fields=id,name,access_token&limit=200`;
    try {
      while (purl) {
        const j = await fetch(purl, { headers: { "Authorization": `Bearer ${ENGAGE_TOKEN}` } }).then((r) => r.json());
        if (j.error) throw new Error(j.error.message);
        for (const p of (j.data || [])) pages.push(p);
        purl = j.paging?.next || "";
      }
    } catch (e) { return json({ ok: false, error: `pages: ${String((e as Error).message || e)}` }, 502); }
    for (const pg of pages) {
      try {
        const j = await fetch(`${GRAPH}/${pg.id}/conversations?fields=id,updated_time&limit=100`, { headers: { "Authorization": `Bearer ${pg.access_token}` } }).then((r) => r.json());
        if (j.error) throw new Error(j.error.message);
        out.push({ page: pg.name, conversations: (j.data || []).length, has_more: !!(j.paging && j.paging.next) });
      } catch (e) { errors.push({ page: pg.name, error: String((e as Error).message || e) }); }
    }
    return json({ ok: errors.length === 0, mode: "conv_check", pages: out, errors });
  }

  // ══ โหมด explore: คืน ad_daily ตามช่วงเวลา (ทุก platform) ให้หน้า Explorer กรอง/เจาะลึกเอง ══
  if (body?.mode === "explore") {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const days = Math.max(1, Math.min(2000, Math.round(num(body?.days) || 90)));
    const since = body?.since ? String(body.since) : new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const until = body?.until ? String(body.until) : new Date().toISOString().slice(0, 10);
    const rows: any[] = [];
    for (let off = 0; ; off += 1000) {
      let q = sb.from("ad_daily")
        .select("date,platform,account_id,account_name,campaign,spend,impressions,clicks,conversions,conversion_value")
        .gte("date", since).lte("date", until).order("date", { ascending: true }).order("platform").order("account_name").order("campaign").range(off, off + 999);
      const { data, error } = await q;
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data || data.length === 0) break;
      for (const r of data) {
        rows.push({
          date: r.date, platform: r.platform,
          account: (r.account_name || "").trim() || (r.account_id ? String(r.account_id) : "(ไม่ระบุ)"),
          campaign: r.campaign || "",
          page: tagVal(r.campaign || "", "PAGE"),
          spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks),
          conversions: num(r.conversions), conversion_value: num(r.conversion_value),
        });
      }
      if (data.length < 1000) break;
    }
    return json({ ok: true, mode: "explore", since, until, count: rows.length, rows });
  }

  // ══ โหมด ingest: รับ {rows:[...]} (เช่น Google/TikTok จาก Windsor) → upsert ad_daily ══
  if (body?.mode === "ingest") {
    if (!caller.service) return json({ ok: false, error: "forbidden — ingest เขียน ad_daily ได้เฉพาะ service (cron/server)" }, 403);
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    const merged = new Map<string, any>();
    for (const r of raw) {
      const row = {
        date: String(r.date || "").slice(0, 10),
        platform: String(r.platform || "").toLowerCase(),
        account_id: r.account_id ? String(r.account_id) : null,
        account_name: String(r.account_name || "").trim() || (r.account_id ? String(r.account_id) : ""),   // ว่าง→ใช้ account_id กัน collision
        campaign: String(r.campaign || ""),
        spend: num(r.spend), impressions: Math.round(num(r.impressions)), clicks: Math.round(num(r.clicks)),
        conversions: num(r.conversions), conversion_value: num(r.conversion_value),
        updated_at: new Date().toISOString(),
      };
      if (!row.date || !row.platform) continue;
      const k = `${row.date}|${row.platform}|${row.account_name}|${row.campaign}`;
      const e = merged.get(k);
      if (e) { e.spend += row.spend; e.impressions += row.impressions; e.clicks += row.clicks; e.conversions += row.conversions; e.conversion_value += row.conversion_value; }
      else merged.set(k, row);
    }
    const rows = [...merged.values()];
    let up = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const ch = rows.slice(i, i + 500);
      const { error, count } = await sb.from("ad_daily").upsert(ch, { onConflict: "date,platform,account_name,campaign", count: "exact" });
      if (error) return json({ ok: false, error: error.message }, 500);
      up += count ?? ch.length;
    }
    return json({ ok: true, mode: "ingest", received: raw.length, upserted: up });
  }

  // ══ โหมด caption: ให้ AI (Gemini) ร่าง caption คอนเทนต์คลินิก ══
  if (body?.mode === "caption") {
    if (!GEMINI_KEY) return json({ ok: false, error: "GEMINI_API_KEY not set" }, 500);
    const brief = String(body.brief || body.topic || "").trim();
    if (!brief) return json({ ok: false, error: "ต้องมีหัวข้อ (brief)" }, 400);
    const prompt = `เขียนแคปชั่นโพสต์ Facebook/Instagram ภาษาไทย สำหรับคลินิกกายภาพบำบัด/สุขภาพ แบรนด์ "เยียวยา (Yiaoya)" โทนอบอุ่น น่าเชื่อถือ ชวนทัก inbox. หัวข้อ: ${brief}. ความยาว 2-4 ประโยค + อิโมจิพอประมาณ + แฮชแท็ก 3-5 ตัว. ตอบเฉพาะแคปชั่น ไม่ต้องมีคำอธิบายอื่น.`;
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      const j = await r.json();
      if (j.error) return json({ ok: false, error: j.error.message }, 502);
      const text = j.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return json({ ok: true, mode: "caption", caption: String(text).trim() });
    } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }, 502); }
  }

  // ══ โหมด leads: ดึงรายชื่อ lead จากฟอร์ม → meta_leads (PII ตารางล็อค service_role) ══
  if (body?.mode === "leads") {
    if (!ADS_TOKEN) return json({ ok: false, error: "META_ADS_TOKEN not set (ต้องมี pages_manage_ads + leads_retrieval)" }, 500);
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const leads: any[] = [];
    const errs: any[] = [];
    // 1) เพจ + page access token (ใช้ ADS token: pages_manage_ads + leads_retrieval)
    const pages: any[] = [];
    let purl = `${GRAPH}/me/accounts?fields=id,name,access_token&limit=200`;
    try {
      while (purl) {
        const j = await fetch(purl, { headers: { "Authorization": `Bearer ${ADS_TOKEN}` } }).then((r) => r.json());
        if (j.error) throw new Error(j.error.message);
        for (const p of (j.data || [])) pages.push(p);
        purl = j.paging?.next || "";
      }
    } catch (e) { return json({ ok: false, error: `pages: ${String((e as Error).message || e)}` }, 502); }
    // 2) ฟอร์ม + leads ต่อเพจ (ใช้ page token)
    for (const pg of pages) {
      const ptok = pg.access_token || META_TOKEN;
      try {
        const forms: any[] = [];
        let furl = `${GRAPH}/${pg.id}/leadgen_forms?fields=id,name&limit=200`;
        while (furl) { const j = await graphGetT(furl, ptok); for (const f of (j.data || [])) forms.push(f); furl = j.paging?.next || ""; }
        for (const fm of forms) {
          let lurl = `${GRAPH}/${fm.id}/leads?fields=id,created_time,field_data,campaign_id,campaign_name,adset_name,ad_name,platform&limit=200`;
          while (lurl) {
            const j = await graphGetT(lurl, ptok);
            for (const ld of (j.data || [])) {
              const fd = ld.field_data;
              leads.push({
                lead_id: String(ld.id),
                created_time: ld.created_time || null,
                platform: ld.platform || "meta",
                page_id: String(pg.id), page_name: pg.name || "",
                form_id: String(fm.id), form_name: fm.name || "",
                campaign_id: ld.campaign_id || null, campaign_name: ld.campaign_name || "",
                adset_name: ld.adset_name || "", ad_name: ld.ad_name || "",
                full_name: leadField(fd, ["full_name", "ชื่อ", "name"]),
                phone: leadField(fd, ["phone", "เบอร", "โทร"]),
                email: leadField(fd, ["email", "อีเมล"]),
                raw: fd || null,
                ingested_at: new Date().toISOString(),
              });
            }
            lurl = j.paging?.next || "";
          }
        }
      } catch (e) { errs.push({ page: pg.id, error: String((e as Error).message || e) }); }
    }
    let up = 0;
    for (let i = 0; i < leads.length; i += 500) {
      const ch = leads.slice(i, i + 500);
      const { error, count } = await sb.from("meta_leads").upsert(ch, { onConflict: "lead_id", count: "exact" });
      if (error) return json({ ok: false, error: error.message, pages: pages.length, errors: errs }, 500);
      up += count ?? ch.length;
    }
    return json({ ok: true, mode: "leads", pages: pages.length, leads: leads.length, upserted: up, errors: errs });
  }

  // ── ช่วงวันที่: preset "maximum"/lifetime=ย้อน 37 เดือน | since+until | days (default 3) ──
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  let untilDate = new Date();
  let sinceDate: Date;
  if (body?.since && body?.until) {
    sinceDate = new Date(String(body.since)); untilDate = new Date(String(body.until));
  } else if (body?.preset === "maximum" || body?.lifetime) {
    sinceDate = new Date(Date.now() - 37 * 30 * 86400000); // ~37 เดือน = เพดานที่ Meta เก็บ insight
  } else {
    const days = Math.max(1, Math.min(400, Math.round(num(body?.days) || 3)));
    sinceDate = new Date(Date.now() - days * 86400000);
  }
  const since = ymd(sinceDate), until = ymd(untilDate);

  // แบ่งเป็นหน้าต่างปีต่อปี (กัน Meta error "reduce the amount of data" ของบัญชีใหญ่)
  const windows: { s: string; u: string }[] = [];
  for (let ws = new Date(sinceDate); ws < untilDate;) {
    const we = new Date(ws); we.setDate(we.getDate() + 364);
    const wEnd = we < untilDate ? we : untilDate;
    windows.push({ s: ymd(ws), u: ymd(wEnd) });
    ws = new Date(wEnd); ws.setDate(ws.getDate() + 1);
  }

  // ── 1) ค้นหา ad account ทั้งหมดเอง ──
  const accts: { id: string; name: string }[] = [];
  let url = `${GRAPH}/me/adaccounts?fields=account_id,name&limit=200`;
  try {
    while (url) {
      const j = await graphGet(url);
      for (const a of (j.data || [])) accts.push({ id: String(a.account_id), name: a.name || String(a.account_id) });
      url = j.paging?.next || "";
    }
  } catch (e) {
    return json({ ok: false, error: `discover accounts failed: ${String((e as Error).message || e)}` }, 502);
  }

  // ── 2) ดึง insight ราย campaign รายวัน ต่อบัญชี ──
  const rows: any[] = [];
  const errors: any[] = [];
  for (const acc of accts) {
    for (const w of windows) {
      try {
        const tr = encodeURIComponent(JSON.stringify({ since: w.s, until: w.u }));
        let iu = `${GRAPH}/act_${acc.id}/insights?level=campaign&time_increment=1&time_range=${tr}`
               + `&fields=campaign_name,spend,impressions,clicks,actions,action_values`
               + `&limit=500`;
        while (iu) {
          const j = await graphGet(iu);
          for (const r of (j.data || [])) {
            const pc = pickConv(r.actions, r.action_values, PURCHASE_TYPES);
            const lc = pickConv(r.actions, r.action_values, LEAD_TYPES);
            rows.push({
              date: r.date_start,
              platform: "meta",
              account_id: String(acc.id),
              account_name: acc.name || String(acc.id),   // กัน account_name ว่าง → คนละบัญชีถูกยุบรวมใน key
              campaign: r.campaign_name || "",
              spend: num(r.spend),
              impressions: Math.round(num(r.impressions)),
              clicks: Math.round(num(r.clicks)),
              // canonical type ต่อหมวด (count/value ตรง type) แล้วบวกข้ามหมวด (purchase + lead คนละหมวด)
              conversions: pc.count + lc.count,
              conversion_value: pc.value + lc.value,
              updated_at: new Date().toISOString(),
            });
          }
          iu = j.paging?.next || "";
        }
      } catch (e) {
        errors.push({ account: acc.id, window: `${w.s}..${w.u}`, error: String((e as Error).message || e) });
      }
    }
  }

  // ── 3) รวมแถวที่ key ซ้ำกันในชุดเดียว (date,platform,account_name,campaign)
  //      กัน error "ON CONFLICT cannot affect row a second time" (เช่น campaign ชื่อซ้ำวันเดียวกัน) ──
  const merged = new Map<string, any>();
  for (const r of rows) {
    const k = `${r.date}|${r.platform}|${r.account_name}|${r.campaign}`;
    const e = merged.get(k);
    if (e) {
      e.spend += r.spend; e.impressions += r.impressions; e.clicks += r.clicks;
      e.conversions += r.conversions; e.conversion_value += r.conversion_value;
    } else merged.set(k, { ...r });
  }
  const deduped = [...merged.values()];

  // ── 4) upsert เข้า ad_daily ทีละ batch (กัน payload ใหญ่เกิน) ──
  let upserted = 0;
  if (deduped.length) {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    for (let i = 0; i < deduped.length; i += 500) {
      const chunk = deduped.slice(i, i + 500);
      const { error, count } = await sb.from("ad_daily")
        .upsert(chunk, { onConflict: "date,platform,account_name,campaign", count: "exact" });
      if (error) return json({ ok: false, error: error.message, accounts: accts.length, rows: rows.length, errors }, 500);
      upserted += count ?? chunk.length;
    }
  }

  return json({ ok: true, accounts: accts.length, rows: rows.length, merged: deduped.length, upserted, since, until, errors });
});
