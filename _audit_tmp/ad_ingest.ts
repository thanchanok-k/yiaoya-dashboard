// ad_ingest — รับแถวข้อมูลโฆษณา (POST {rows:[...]}) → upsert เข้า ad_daily
// ป้องกันด้วย ?secret=HUB_SECRET (server-to-server, Claude เป็นผู้ดึงจาก connector แล้วส่งมา) · verify_jwt=false
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HUB_SECRET   = Deno.env.get("HUB_SECRET") ?? "";
function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o, null, 2), { status: s, headers: { "Content-Type": "application/json" } });
}
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };

Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (!HUB_SECRET || u.searchParams.get("secret") !== HUB_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (!rows.length) return json({ ok: false, error: "no rows" }, 400);

  const clean = rows.map((r: any) => ({
    date: String(r.date),
    platform: String(r.platform || "").toLowerCase(),
    account_id: r.account_id ? String(r.account_id) : null,
    account_name: String(r.account_name || "").trim() || (r.account_id ? String(r.account_id) : ""),   // ว่าง→account_id กัน collision (ตรงกับ meta_sync)
    campaign: String(r.campaign || ""),
    spend: num(r.spend),
    impressions: Math.round(num(r.impressions)),
    clicks: Math.round(num(r.clicks)),
    conversions: num(r.conversions),
    conversion_value: num(r.conversion_value),
    updated_at: new Date().toISOString(),
  })).filter((r: any) => r.date && r.platform);

  // dedupe key ซ้ำในชุดเดียว (date,platform,account_name,campaign) — กัน Postgres
  // "ON CONFLICT cannot affect row a second time" (เช่น แคมเปญ Google ชื่อซ้ำในวันเดียว
  // → 2 แถว key เดียวกัน ทำทั้ง batch ล้ม) · รวม metric เข้าด้วยกัน เหมือน meta_sync/google_sync
  const merged = new Map<string, any>();
  for (const r of clean) {
    const k = `${r.date}|${r.platform}|${r.account_name}|${r.campaign}`;
    const e = merged.get(k);
    if (e) {
      e.spend += r.spend; e.impressions += r.impressions; e.clicks += r.clicks;
      e.conversions += r.conversions; e.conversion_value += r.conversion_value;
    } else merged.set(k, { ...r });
  }
  const deduped = [...merged.values()];

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error, count } = await sb.from("ad_daily")
    .upsert(deduped, { onConflict: "date,platform,account_name,campaign", count: "exact" });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, rows: clean.length, merged: deduped.length, upserted: count ?? deduped.length });
});
