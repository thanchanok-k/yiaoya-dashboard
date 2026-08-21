// leadmkt_project — แปลง ad_daily → 3 event types (Lead & การตลาด) → POST /publish
// port จาก jera-sandbox/publish_leadmkt.py ให้รันเองผ่าน pg_cron (หลัง meta_sync)
// emit: lead_source.updated (ช่องทาง) · campaign.roi.updated (แคมเปญ) · lead.performance.monthly (เดือน×ช่องทาง)
// auth: HUB_SECRET (body/query secret) หรือ JWT role service_role/authenticated · verify_jwt=false
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HUB_SECRET   = Deno.env.get("HUB_SECRET") ?? "";
const SOURCE = "adops";

// platform → (ชื่อช่องทาง, หมวด)
const CHANNELS: Record<string, [string, string]> = {
  meta:   ["Facebook / Instagram (Meta)", "โฆษณาออนไลน์"],
  google: ["Google Ads", "โฆษณาออนไลน์"],
  tiktok: ["TikTok Ads", "โฆษณาออนไลน์"],
};
// ช่องทางฝั่ง FO (free-text) → platform (สำหรับ join รายได้เข้า ROAS)
const FO_CHANNEL_MAP: Record<string, string> = {
  fb: "meta", facebook: "meta", meta: "meta", ig: "meta", instagram: "meta",
  google: "google", "google ads": "google", "ค้นหา google": "google",
  tiktok: "tiktok", "tik tok": "tiktok",
};

function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o, null, 2), { status: s, headers: { "Content-Type": "application/json" } });
}
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };
const monthOf = (d: string) => { const s = String(d || ""); return s.length >= 7 ? s.slice(0, 7) : ""; };
// ดึงค่า tag จากชื่อแคมเปญ format "|PL:META|...|PAGE:KNEE|STA:...|"
const tagVal = (s: string, key: string) => {
  const m = new RegExp("(?:^|\\|)\\s*" + key + ":([^|]+)", "i").exec(s || "");
  return m ? m[1].trim() : "";
};
// ★ SECURITY: ไม่ decode .role จาก JWT (verify_jwt=false → ปลอม service_role ได้). service caller ถือ SERVICE_KEY จริง
const isServiceBearer = (req: Request) =>
  !!SERVICE_KEY && (req.headers.get("Authorization") || "").replace("Bearer ", "").trim() === SERVICE_KEY;

Deno.serve(async (req) => {
  const u = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* ignore */ } }
  const secret = u.searchParams.get("secret") || body?.secret || req.headers.get("x-hub-secret") || "";
  // auth: HUB_SECRET (publish script/cron) หรือ Bearer SERVICE_KEY (service caller) — ไม่เชื่อ decode role
  if (!(HUB_SECRET && secret === HUB_SECRET) && !isServiceBearer(req)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const days = Math.max(1, Math.min(2000, Math.round(num(body?.days) || 120)));
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const occurred_at = new Date().toISOString();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── 1) อ่าน ad_daily แบบ paginate (PostgREST cap 1000/หน้า) + กันนับซ้ำ (campaign ทับ account) ──
  const adRows: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error: adErr } = await sb.from("ad_daily")
      .select("date,platform,campaign,account_id,account_name,spend,clicks,conversions,conversion_value")
      .gte("date", since).order("date", { ascending: true }).order("platform").order("account_name").order("campaign").range(off, off + 999);
    if (adErr) return json({ ok: false, error: `ad_daily: ${adErr.message}` }, 500);
    if (!data || data.length === 0) break;
    adRows.push(...data);
    if (data.length < 1000) break;
  }
  const hasCamp = new Set<string>();
  for (const r of adRows) if ((r.campaign || "").trim()) hasCamp.add(`${r.date}|${r.platform}`);
  const ad = adRows.filter((r: any) => {
    const camp = (r.campaign || "").trim();
    return !(!camp && hasCamp.has(`${r.date}|${r.platform}`));
  });

  // ── 2) รายได้ต่อ (เดือน×ช่องทาง) จาก fo.lead.updated (ติดเมื่อ FO กรอกยอดปิด) ──
  const rev: Record<string, { revenue: number; customers: number }> = {};
  const foFunnel: Record<string, { leads: number; appt: number; showed: number }> = {};   // funnel จริงจาก FO ต่อ platform
  try {
    const foRows: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data } = await sb.from("events")
        .select("entity_id,payload,occurred_at").eq("event_type", "fo.lead.updated").order("seq", { ascending: true }).range(off, off + 999);
      if (!data || data.length === 0) break;
      foRows.push(...data);
      if (data.length < 1000) break;
    }
    // ★ dedup: fo.lead.updated เป็น append-only — lead เดียวมีหลายแถว (สถานะเปลี่ยน) → เก็บแถวล่าสุดต่อ entity_id
    //   (ไม่ dedup = นับ lead/นัด/มาจริง/รายได้ ซ้ำหลายเท่า)
    const latestById = new Map<string, any>();
    for (const r of foRows) {
      const id = String((r as any).entity_id || "") || ("_" + JSON.stringify((r as any).payload || {}).slice(0, 80));
      const prev = latestById.get(id);
      if (!prev || String((r as any).occurred_at || "") >= String(prev.occurred_at || "")) latestById.set(id, r);
    }
    for (const r of latestById.values()) {
      const p = (r as any).payload || {};
      const chRaw = String(p["ช่องทาง"] || p.channel || p.source || "").trim().toLowerCase();
      const plat = FO_CHANNEL_MAP[chRaw];
      if (!plat) continue;
      // ★ จูนช่วงเวลา: นับเฉพาะ lead ที่อยู่ในหน้าต่างเดียวกับ spend (since) → cost-per ตรงจริง
      let ld = String(p["วันที่รับ Lead"] || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}/.test(ld)) ld = String((r as any).occurred_at || "").slice(0, 10);
      if (ld && ld < since) continue;
      // funnel: นับทุก lead (ไม่ใช่แค่ที่ปิด) → leads/นัด/มาจริง ต่อช่องทาง
      const st = String(p["สถานะ Lead"] || p.status || "").trim();
      (foFunnel[plat] ||= { leads: 0, appt: 0, showed: 0 });
      foFunnel[plat].leads++;
      if (st === "นัดแล้ว" || st === "มาตามนัด") foFunnel[plat].appt++;
      if (st === "มาตามนัด") foFunnel[plat].showed++;
      const close = num(p["ยอดปิด"] || p.close_amount || p.revenue);
      if (close <= 0) continue;
      const dt = String(p["วันปิด"] || p.closed_at || p["วันที่"] || (r as any).occurred_at || "");
      const ym = monthOf(dt.length >= 10 ? dt.slice(0, 10) : dt);
      if (!ym) continue;
      const k = `${ym}|${plat}`;
      (rev[k] ||= { revenue: 0, customers: 0 });
      rev[k].revenue += close; rev[k].customers += 1;
    }
  } catch { /* ข้ามถ้าอ่านไม่ได้ */ }

  // ── 3) aggregate ──
  const byPlat: Record<string, any> = {}, byMonth: Record<string, any> = {}, byCamp: Record<string, any> = {};
  const campMeta: Record<string, any> = {};               // key แคมเปญ → {account_name, account_id}
  const monthsOfPlat: Record<string, Set<string>> = {};
  let latestMonth = "";
  const add = (o: Record<string, any>, k: string, sp: number, ld: number, ck: number) => {
    (o[k] ||= { spend: 0, leads: 0, clicks: 0 }); o[k].spend += sp; o[k].leads += ld; o[k].clicks += ck;
  };
  for (const r of ad) {
    const plat = r.platform, ym = monthOf(r.date);
    const sp = num(r.spend), ld = num(r.conversions), ck = num(r.clicks);
    const acctName = (r.account_name || "").trim() || (r.account_id ? String(r.account_id) : "(ไม่ระบุบัญชี)");
    add(byPlat, plat, sp, ld, ck);
    add(byMonth, `${ym}|${plat}`, sp, ld, ck);
    (monthsOfPlat[plat] ||= new Set()).add(ym);
    const camp = (r.campaign || "").trim();
    if (camp) {
      const ck2 = `${plat}|${acctName}|${camp}`;
      add(byCamp, ck2, sp, ld, ck);
      campMeta[ck2] = { account_name: acctName, account_id: r.account_id ? String(r.account_id) : null };
    }
    if (ym > latestMonth) latestMonth = ym;
  }

  // ── 4) สร้าง events ──
  const events: any[] = [];
  const env = (event_type: string, entity_id: string, data: any) => ({ event_type, entity_id, occurred_at, data });

  // 4.1 ช่องทาง
  for (const plat of Object.keys(byPlat).sort()) {
    const agg = byPlat[plat];
    const [name, cat] = CHANNELS[plat] || [plat, "โฆษณาออนไลน์"];
    const months = [...(monthsOfPlat[plat] || [])];
    const lastM = months.length ? months.sort().slice(-1)[0] : latestMonth;
    const monthlyBudget = byMonth[`${lastM}|${plat}`]?.spend || 0;
    let revTotal = 0; for (const k of Object.keys(rev)) if (k.endsWith(`|${plat}`)) revTotal += rev[k].revenue;
    const fn = foFunnel[plat] || { leads: 0, appt: 0, showed: 0 };
    const cpl = fn.leads > 0 ? agg.spend / fn.leads : null;       // ค่าแอดต่อ 1 lead จริง (FO)
    const cpa2 = fn.appt > 0 ? agg.spend / fn.appt : null;        // ต่อ 1 นัด
    const cps = fn.showed > 0 ? agg.spend / fn.showed : null;     // ต่อ 1 คนมาจริง
    events.push(env("lead_source.updated", "mkt:channel:" + plat, {
      channel_id: plat, channel_name: name, category: cat,
      monthly_budget: Math.round(monthlyBudget * 100) / 100,
      actual_spend: Math.round(agg.spend * 100) / 100,
      leads: Math.round(agg.leads), revenue: Math.round(revTotal * 100) / 100, status: "active",
      fo_leads: fn.leads, fo_appointments: fn.appt, fo_showed: fn.showed,
      cost_per_lead: cpl !== null ? Math.round(cpl * 100) / 100 : null,
      cost_per_appt: cpa2 !== null ? Math.round(cpa2 * 100) / 100 : null,
      cost_per_show: cps !== null ? Math.round(cps * 100) / 100 : null,
    }));
  }
  // 4.2 แคมเปญ (แยกตามบัญชี: key = plat|account|campaign)
  for (const k of Object.keys(byCamp).sort()) {
    const plat = k.split("|")[0];
    const meta = campMeta[k] || { account_name: "", account_id: null };
    const acct = meta.account_name || "";
    const camp = k.slice((plat + "|" + acct + "|").length);
    const agg = byCamp[k];
    const [name] = CHANNELS[plat] || [plat, ""];
    const page = tagVal(camp, "PAGE");   // เพจที่ยิง (จาก tag ในชื่อแคมเปญ)
    events.push(env("campaign.roi.updated", "mkt:campaign:" + plat + ":" + acct + ":" + camp, {
      campaign_id: plat + ":" + acct + ":" + camp, campaign_name: camp,
      channel_name: name, channel_id: plat,
      account_name: acct, account_id: meta.account_id,
      page: page,
      actual_spend: Math.round(agg.spend * 100) / 100, leads: Math.round(agg.leads),
      customers: 0, revenue: 0, roi: null,
    }));
  }
  // 4.3 รายเดือน×ช่องทาง
  for (const k of Object.keys(byMonth).sort()) {
    const [ym, plat] = k.split("|");
    const agg = byMonth[k];
    const [name] = CHANNELS[plat] || [plat, ""];
    const rv = rev[k] || { revenue: 0, customers: 0 };
    const budget = agg.spend, leads = Math.round(agg.leads);
    const cpa = leads > 0 ? budget / leads : null;
    const roas = budget > 0 && rv.revenue > 0 ? rv.revenue / budget : null;
    events.push(env("lead.performance.monthly", "mkt:monthly:" + ym + ":" + plat, {
      month: ym, channel_name: name, channel_id: plat,
      new_customers: rv.customers, returning_customers: 0,
      revenue: Math.round(rv.revenue * 100) / 100, budget: Math.round(budget * 100) / 100,
      leads, cpa: cpa !== null ? Math.round(cpa * 100) / 100 : null,
      roas: roas !== null ? Math.round(roas * 10000) / 10000 : null, conv_rate: null, target: null,
    }));
  }

  // ── 5) POST /publish (reuse dispatch + idempotent ด้วย entity_id) ──
  let pushed = 0;
  for (let i = 0; i < events.length; i += 700) {
    const chunk = events.slice(i, i + 700);
    const r = await fetch(`${SUPABASE_URL}/functions/v1/publish`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: HUB_SECRET, source: SOURCE, events: chunk }),
    });
    if (!r.ok) return json({ ok: false, error: `publish HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`, pushed }, 502);
    pushed += chunk.length;
  }

  return json({
    ok: true, since, ad_rows: ad.length, events: events.length, pushed,
    channels: Object.keys(byPlat).length, campaigns: Object.keys(byCamp).length, months: Object.keys(byMonth).length,
  });
});
