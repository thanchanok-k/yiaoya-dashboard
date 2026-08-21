// hr_list_hq — read path เฉพาะ "HQ/ผู้บริหาร" สำหรับข้อมูลลับสุด (คดี/สัญญา)
// แยกจาก hr_list (generic, authenticated ทุกคน) — type พวกนี้ "ห้าม" อยู่ใน hr_list
// gate: service_role | app_metadata.role ∈ {director,hq,admin} | email ∈ HQ_EMAILS เท่านั้น
//   ?type=<event_type>&limit=N → dedupe payload ล่าสุดต่อ entity → {count, items}
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
// เฉพาะ type ลับ HQ (คดี/สัญญา) — generic hr_list ไม่รับ type พวกนี้
const ALLOWED = new Set([
  "legal.updated", "legal.timeline.updated", "legal.doc.updated", "legal.consult.updated",
  "contract.updated", "contract_rule.updated",
  "lead.updated", "fo.lead.updated", "fo.followup.logged",
  "fo.followup.legacy",
]);
const HQ_ROLES = ["director", "hq", "admin"];

function claimsOf(req: Request): any {
  try { let p = (req.headers.get("Authorization") || "").replace("Bearer ", "").split(".")[1]; p = p.replace(/-/g, "+").replace(/_/g, "/"); while (p.length % 4) p += "="; return JSON.parse(atob(p)); } catch { return {}; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  const claims = claimsOf(req);
  const role = claims.role || "";
  if (role !== "authenticated" && role !== "service_role") return J({ error: "unauthorized" }, 401);
  // ★ HQ gate — เฉพาะ director/HQ (คดี/สัญญา = ลับสุด)
  // ★ SECURITY: role จาก app_metadata เท่านั้น (ตัด user_role fallback — กัน self-escalate เห็น PII/คดี)
  const myRole = String((claims.app_metadata && claims.app_metadata.role) || "");
  const allow = (Deno.env.get("HQ_EMAILS") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isHQ = role === "service_role" || HQ_ROLES.includes(myRole) || allow.includes(String(claims.email || "").toLowerCase());
  if (!isHQ) return J({ error: "forbidden", need: "HQ/director role" }, 403);

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "";
    const lim = Math.min(+(url.searchParams.get("limit") || 1000), 3000);

    // ★ meta_leads (PII) — อ่านจากตาราง meta_leads ที่ล็อค (grant service_role เท่านั้น) · gate HQ เดียวกัน
    if (type === "meta_leads") {
      const sb = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data } = await sb.from("meta_leads")
        .select("lead_id,created_time,full_name,phone,email,page_name,form_name,campaign_name,ad_name,platform")
        .order("created_time", { ascending: false }).limit(lim);
      return J({ type, count: (data || []).length, items: data || [] });
    }

    if (!ALLOWED.has(type)) return J({ error: "type not allowed (HQ only)", allowed: [...ALLOWED] }, 400);
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data } = await sb.from("events").select("entity_id,payload,status,occurred_at").eq("event_type", type).order("seq", { ascending: false }).limit(lim);
    const seen = new Set<string>(); const items: any[] = [];
    for (const r of data || []) {
      const k = r.entity_id || JSON.stringify(r.payload);
      if (!seen.has(k)) { seen.add(k); items.push({ ...(r.payload || {}), _status: r.status, _at: r.occurred_at }); }
    }
    return J({ type, count: items.length, items });
  } catch (err) {
    return J({ error: String(err) }, 500);
  }
});
