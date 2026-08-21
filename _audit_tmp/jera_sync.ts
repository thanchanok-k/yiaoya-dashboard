// jera_sync — ดึงยอดขาย+คนไข้จาก JERA OpenAPI (read-only) → emit event เข้า hub
// ทิศทางเดียว: JERA (production clinical) → events table. ไม่เคยเขียนกลับ JERA (GET เท่านั้น)
//
//   POST {action:'sync', secret, days?:N}        -> ดึง payment+patient N วันล่าสุด → emit fo.sale.posted / fo.patient.registered
//   POST {action:'sync', secret, test:true}      -> SANDBOX TEST: ดึงไม่กี่แถว, entity_id prefix 'ZZTEST-JERA-' (ลบทิ้งง่าย)
//   POST {action:'cleanup_test', secret}         -> ลบ event ทดสอบทั้งหมด (entity_id LIKE 'ZZTEST-JERA-%')
//   POST {action:'ping', secret}                 -> เช็ค token JERA ติดไหม (ไม่ emit)
//
// auth: HUB_SECRET (cron/server) หรือ JWT role authenticated/service_role (เรียกจาก console)
// idempotent: event_id = sha256('jera|<type>|<entity_id>') → sync ซ้ำ = upsert ทับ ไม่เกิดแถวซ้ำ
//
// === PDPA (load-bearing) ===
// JERA = ข้อมูล production คนไข้จริง · patient = Tier-3
// fo.patient.registered emit เฉพาะ patient_hn (Tier-2) + branch/channel/service_type/วันลงทะเบียน
// *** ห้าม *** copy citizen_id / ชื่อ-สกุล / เบอร์ / birthdate ลง hub จาก fn นี้ (ทิ้งไว้ที่ JERA จน migrate จริง)
// fo.sale.posted ก็ไม่พก patient_name/nickname — แค่ patient_hn ref + ยอดเงิน
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HUB_SECRET   = Deno.env.get("HUB_SECRET") ?? "";

// JERA OpenAPI (production · read-only) — ตั้งผ่าน `supabase secrets set` (ห้าม hardcode key/secret)
const JERA_BASE   = (Deno.env.get("JERA_BASE_URL") ?? "").replace(/\/$/, "");
const JERA_KEY    = Deno.env.get("JERA_KEY") ?? "";
const JERA_SECRET = Deno.env.get("JERA_SECRET") ?? "";

// branch_uuid (JERA) -> branch_id (hub canonical · public.branches)
// JERA สาขาที่ 1 (SLY/ศาลายา) = คลินิกแห่งแรก. ปรับ map ตรงนี้เมื่อ JERA เปิดสาขาเพิ่ม (ไม่แก้โค้ดส่วนอื่น)
const BRANCH_MAP: Record<string, string> = {
  "b5b80773-c7c2-5676-af68-96ba89661d25": "BR01", // SLY · สาขาที่ 1
};
const DEFAULT_BRANCH_UUID = "b5b80773-c7c2-5676-af68-96ba89661d25";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
function J(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}
// ★ SECURITY: ไม่ decode .role จาก JWT (verify_jwt=false → ปลอม service_role ได้). service caller ถือ SERVICE_KEY จริง
const isServiceBearer = (req: Request) =>
  !!SERVICE_KEY && (req.headers.get("Authorization") || "").replace("Bearer ", "").trim() === SERVICE_KEY;
async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

// ---- JERA token (HTTP Basic key:secret -> bearer) · GET เท่านั้นหลังจากนี้ ----
async function jeraToken(): Promise<string> {
  if (!JERA_BASE || !JERA_KEY || !JERA_SECRET) {
    throw new Error("JERA secret ยังไม่ตั้ง — ต้อง `supabase secrets set JERA_BASE_URL=.. JERA_KEY=.. JERA_SECRET=..`");
  }
  const basic = btoa(`${JERA_KEY}:${JERA_SECRET}`);
  const r = await fetch(`${JERA_BASE}/openapi/v1/token/`, {
    method: "POST",
    headers: { "Authorization": `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`JERA token failed HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  if (!d.access_token) throw new Error("JERA token: ไม่มี access_token ใน response");
  return d.access_token as string;
}
async function jeraGet(token: string, path: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const url = `${JERA_BASE}${path}${qs ? (path.includes("?") ? "&" : "?") + qs : ""}`;
  // ★ retry/backoff สำหรับ JERA DRF throttle (429) + 5xx + timeout — JERA จำกัดยิงรัว ~6 ครั้ง/นาที
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 30000);
      try { r = await fetch(url, { headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" }, signal: ctl.signal }); }
      finally { clearTimeout(to); }
    } catch (e) {
      if (attempt < 3) { await new Promise((res) => setTimeout(res, 2000 * (attempt + 1))); continue; }
      throw new Error(`JERA GET ${path} network: ${String((e as Error).message || e)}`);
    }
    if (r.ok) return await r.json();
    if ((r.status === 429 || r.status >= 500) && attempt < 3) {
      const ra = Number(r.headers.get("Retry-After")) || 0;
      await new Promise((res) => setTimeout(res, (ra ? ra * 1000 : 2000 * (attempt + 1))));
      continue;
    }
    throw new Error(`JERA GET ${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

// ---- normalize: JERA payment row -> fo.sale.posted payload (ไม่มี PII Tier-3) ----
function payMethod(p: any): string {
  const m: [string, string][] = [
    ["cash", "paid_amount_cash"], ["credit_card", "paid_amount_credit_card"],
    ["transfer", "paid_amount_transfer"], ["e_wallet", "paid_amount_e_wallet"],
    ["social_security", "paid_amount_social_security"], ["payment_link", "paid_amount_payment_link"],
  ];
  let best = "", bestv = 0;
  for (const [name, k] of m) { const v = num(p[k]); if (v > bestv) { best = name; bestv = v; } }
  return best || "course"; // 0 ทุกช่อง = ตัดจากคอร์ส/แพ็กเกจที่จ่ายล่วงหน้า (course redemption)
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  let b: any;
  try { b = await req.json(); } catch { return J({ ok: false, error: "invalid json" }, 400); }

  // auth: HUB_SECRET (cron_post ส่ง secret ใน body) หรือ Bearer SERVICE_KEY (service caller จริง) — ไม่เชื่อ decode role
  const secretOk = !!HUB_SECRET && b.secret === HUB_SECRET;
  if (!secretOk && !isServiceBearer(req)) {
    return J({ ok: false, error: "unauthorized" }, 401);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const action = b.action || "sync";
  const isTest = b.test === true;
  const TP = isTest ? "ZZTEST-JERA-" : ""; // prefix entity_id ของ row ทดสอบ → ลบทิ้งง่าย

  try {
    // --- cleanup รอบทดสอบ ---
    if (action === "cleanup_test") {
      const { data, error } = await sb.from("events").delete().like("entity_id", "ZZTEST-JERA-%").select("event_id");
      if (error) return J({ ok: false, error: error.message }, 500);
      return J({ ok: true, action, deleted: (data || []).length });
    }

    // --- ping: เช็ค token JERA ---
    if (action === "ping") {
      const token = await jeraToken();
      return J({ ok: true, action, jera_token: token ? "obtained" : "none", base: JERA_BASE || "(unset)" });
    }

    // --- dept_sales: ดึง course-sales + product-sale(service) → แมปแผนก → upsert dept_sales (port pull_dept_sales.py) ---
    if (action === "dept_sales") {
      const token = await jeraToken();
      const bu = String(b.branch_uuid || DEFAULT_BRANCH_UUID);
      const bid = "SLY";   // ★ dept_sales ใช้รหัสสาขา 'SLY' (ตรงกับ dept_sales.ts default + python เดิม) — อย่าใช้ BR01 จะแยกบัคเก็ต
      const months = (Array.isArray(b.months) && b.months.length) ? b.months : (() => {
        const t = new Date(); const out = []; let y = t.getUTCFullYear(), m = t.getUTCMonth() + 1;
        for (let i = 0; i < 2; i++) { out.push(y + "-" + ("0" + m).slice(-2)); m--; if (m === 0) { m = 12; y--; } }
        return out;
      })();
      const dmap = (code: any, ptype: any, name: any): string => {
        const pt = String(ptype || "").trim();
        if (pt) { if (pt.includes("&")) return "ผสม"; if (pt.includes("กระดูก")) return "กระดูกและข้อ"; if (pt.includes("กายภาพ")) return "กายภาพ"; if (pt.includes("พิลาท")) return "พิลาทิส"; if (pt.includes("นวด")) return "นวด"; }
        for (const s of String(code || "").toUpperCase().split("-")) { if (s === "DR" || s === "KN") return "กระดูกและข้อ"; if (s === "PT") return "กายภาพ"; if (s === "PL" || s === "PRO" || s.startsWith("PLT")) return "พิลาทิส"; if (s === "MAS") return "นวด"; if (s === "HYB") return "ผสม"; }
        const nm = String(name || "").toLowerCase();
        if (nm) {
          if (["full care", "fcx", "fullcare", "combo", "all in"].some((k) => nm.includes(k))) return "ผสม";
          if (["pilates", "reformer", "พิลาท"].some((k) => nm.includes(k))) return "พิลาทิส";
          if (["massage", "นวด", "spa"].some((k) => nm.includes(k))) return "นวด";
          if (["laser", "hpl", "shockwave", "fswt", "tens", "pms", "ultrasound", "combine", "แม่เหล็ก", "เลเซอร์", "ช็อค", "กายภาพ", "rehab", "relief", "คลื่น", "ประคบ"].some((k) => nm.includes(k))) return "กายภาพ";
          if (["ha ", "hyaluronic", "prp", "injection", "ฉีด", "เข่า", "osteni", "knee", "ortho", "ข้อ", "steroid", "block"].some((k) => nm.includes(k))) return "กระดูกและข้อ";
        }
        return "อื่นๆ";
      };
      let totalIns = 0; const summary: Record<string, number> = {}; const errors: any[] = [];
      for (const mo of months) {
        try {
          const [yy, mm] = String(mo).split("-").map(Number);
          const startD = `${mo}-01`;
          const endD = new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
          const rows: any[] = [];
          const cs = await jeraGet(token, "/openapi/v1/report/course-sales/", { branch_uuid: bu, start_date: startD, end_date: endD });
          const csArr = Array.isArray(cs) ? cs : ((cs && cs.data) || []);
          for (const r of csArr) rows.push({ kind: "course", dept: dmap(r.course_code, r.patient_type, r.course_name), code: r.course_code ?? null, name: r.course_name ?? null, amount: num(r.price), txn_date: r.buy_date || null, new_patient: !!r.is_new_patient, performer: r.performer_names || null, patient_type: r.patient_type || null });
          const ps = await jeraGet(token, "/openapi/v1/report/product-sale/", { branch_uuid: bu, start_date: startD, end_date: endD, type: "service" });
          const psArr = Array.isArray(ps) ? ps : ((ps && ps.data) || []);
          for (const r of psArr) rows.push({ kind: "service", dept: dmap(r.product_code, null, r.action || r.subcat_name), code: r.product_code ?? null, name: (r.action || r.subcat_name) ?? null, amount: num(r.paid_amount), txn_date: null, new_patient: false, performer: null, patient_type: null });
          // ★ กันเดือนหาย: ถ้า JERA คืน 0 แถว (อาจ throttle/hiccup) → ไม่ลบของเดิม ข้ามเดือนนี้
          if (!rows.length) { summary[mo] = 0; errors.push({ month: mo, note: "0 rows from JERA — kept existing data" }); continue; }
          // ★ atomicity: insert ของใหม่ก่อน (stamp runTs) → แล้วลบของเก่า (updated_at < runTs) ทีหลัง
          //   ถ้า insert พังกลางคัน ของเดิมยังอยู่ (ไม่เหลือเดือนว่าง/partial) · มี dup ชั่วคราวถึงรอบหน้า
          const runTs = new Date().toISOString();
          const ins = rows.map((r) => ({ month: mo, dept: r.dept, kind: r.kind, code: r.code, name: r.name, amount: r.amount, txn_date: r.txn_date, new_patient: r.new_patient, performer: r.performer, patient_type: r.patient_type, branch: bid, updated_at: runTs }));
          for (let i = 0; i < ins.length; i += 500) { const ch = ins.slice(i, i + 500); const { error } = await sb.from("dept_sales").insert(ch); if (error) throw new Error(error.message); }
          await sb.from("dept_sales").delete().eq("month", mo).lt("updated_at", runTs);
          totalIns += ins.length; summary[mo] = ins.length;
        } catch (e) {
          // ★ non-fatal ต่อเดือน: เดือนนึงพังไม่ทำให้เดือนอื่นล่ม/หาย
          errors.push({ month: mo, error: String((e as Error).message || e) });
        }
      }
      return J({ ok: errors.filter((x: any) => x.error).length === 0, action: "dept_sales", months, inserted: totalIns, summary, errors });
    }

    // --- sync: ดึง JERA → emit events ---
    const branchUuid = String(b.branch_uuid || DEFAULT_BRANCH_UUID);
    const branchId = BRANCH_MAP[branchUuid] || "BR01";
    const days = Math.min(Math.max(Number(b.days) || (isTest ? 7 : 35), 1), 120);
    const limitRows = isTest ? Number(b.limit || 3) : Infinity;

    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    const start = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);

    const token = await jeraToken();
    const events: any[] = [];

    // 1) SALES  <- /report/payment/  (fo.sale.posted)
    const pay = await jeraGet(token, "/openapi/v1/report/payment/", { branch_uuid: branchUuid, start_date: start, end_date: end });
    let saleCount = 0;
    for (const p of (pay?.payment_data || [])) {
      if (saleCount >= limitRows) break;
      if (p.is_unpaid) continue;
      const rawId = String(p.uuid || "");
      if (!rawId) continue;
      const entity_id = TP + rawId;
      const amount = num(p.realized_paid_amount ?? p.paid_amount ?? p.total);
      const payload = {
        sale_id: entity_id,
        amount,
        currency: "THB",
        branch_id: branchId,
        method: payMethod(p),
        status: p.status || "posted",
        posted_at: p.create_date || null,
        patient_hn: p.patient_code || null, // Tier-2 HN ref เท่านั้น — ไม่พก ชื่อ/birthdate/citizen_id
        is_new_patient: p.is_new_patient ?? null,
        channel: p.patient_channel || null,
        seller: p.create_by_name || p.seller || null,
        _test: isTest || undefined,
      };
      events.push({
        event_id: await sha256(`jera|fo.sale.posted|${entity_id}`),
        event_type: "fo.sale.posted", source: "fo", entity_id,
        occurred_at: p.create_date || new Date().toISOString(),
        version: "v1", payload, status: "logged",
      });
      saleCount++;
    }

    // 2) PATIENTS  <- /patient/  (fo.patient.registered · HN-only, ไม่มี PII Tier-3)
    // loop ทุกหน้า (เดิมดึงแค่ page 1 → คนไข้ส่วนใหญ่ไม่ sync) · หยุดเมื่อไม่มี next หรือถึง limitRows
    const patRows: any[] = [];
    for (let page = 1; page <= 500; page++) {
      const pat = await jeraGet(token, "/openapi/v1/patient/", { page: String(page) });
      const chunk = pat?.results || pat?.data || (Array.isArray(pat) ? pat : []);
      patRows.push(...chunk);
      if (patRows.length >= limitRows || !chunk.length || !(pat && pat.next)) break;
    }
    let patCount = 0;
    for (const u of patRows) {
      if (patCount >= limitRows) break;
      const rawId = String(u.patient_uuid || u.uuid || "");
      if (!rawId) continue;
      const entity_id = TP + rawId;
      const payload = {
        patient_hn: u.patient_code || null, // Tier-2 — join key เข้า clinical
        branch_id: branchId,
        service_type: u.type || null,       // กายภาพบำบัด ฯลฯ (catalog free-text จาก JERA)
        channel: u.channel || null,
        registered_at: u.first_visit || u.create_date || null,
        // *** จงใจไม่ใส่: citizen_id, fname/lname, mobile, birthdate (Tier-3/PII) ***
        _test: isTest || undefined,
      };
      events.push({
        event_id: await sha256(`jera|fo.patient.registered|${entity_id}`),
        event_type: "fo.patient.registered", source: "fo", entity_id,
        occurred_at: u.first_visit || u.create_date || new Date().toISOString(),
        version: "v1", payload, status: "logged",
      });
      patCount++;
    }

    if (!events.length) return J({ ok: true, action, test: isTest, range: { start, end }, emitted: 0, note: "ไม่มีข้อมูลในช่วงนี้" });

    // idempotent upsert (event_id unique) — sync ซ้ำทับแถวเดิม ไม่ซ้อน
    const { error } = await sb.from("events").upsert(events, { onConflict: "event_id" });
    if (error) return J({ ok: false, error: error.message }, 500);

    return J({
      ok: true, action, test: isTest, range: { start, end }, branch_id: branchId,
      emitted: events.length, sales: saleCount, patients: patCount,
      sample: events.slice(0, 2).map((e) => ({ event_type: e.event_type, entity_id: e.entity_id, payload: e.payload })),
    });
  } catch (err) {
    return J({ ok: false, action, error: String(err) }, 500);
  }
});
