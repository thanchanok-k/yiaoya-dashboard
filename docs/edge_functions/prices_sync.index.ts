// prices_sync — เก็บ "ราคาปัจจุบัน" ของคอร์ส/บริการ จาก JERA (sale ล่าสุด = ราคาที่ปรับขึ้นแล้ว)
//   POST {action:'put', secret, rows:[{code,name,price,kind}]}  -> upsert (HUB_SECRET)
//   POST {action:'get'} | GET  -> role gate authenticated/service_role -> ราคาปัจจุบันทั้งหมด
//   table jera_prices · DB_URL (postgres.js)
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const HUB_SECRET = Deno.env.get("HUB_SECRET") ?? "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }
const n = (x: unknown) => (x == null || x === "" ? 0 : Number(x)) || 0;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: any = {}; if (req.method === "POST") { try { body = await req.json(); } catch { /* */ } }
  const action = body.action || (req.method === "GET" ? "get" : "get");

  let sql: any;
  try {
    sql = postgres(DB_URL, { prepare: false });
    await sql`create table if not exists public.jera_prices (
      code text primary key, name text, price numeric default 0, kind text, updated_at timestamptz default now()
    )`;
    await sql`alter table public.jera_prices enable row level security`;
    await sql`alter table public.jera_prices add column if not exists cost numeric`;      // ต้นทุนตรง/ครั้ง จาก JERA (อ้างอิง — ไม่รวม overhead)
    await sql`alter table public.jera_prices add column if not exists dept text`;          // แผนก (map จาก code/ชื่อ)

    if (action === "put") {
      if (!HUB_SECRET || body.secret !== HUB_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (body.replace) await sql`truncate table public.jera_prices`;
      let up = 0;
      for (const r of rows) {
        const code = String(r.code || "").slice(0, 100); if (!code) continue;
        await sql`insert into public.jera_prices (code, name, price, kind, cost, dept, updated_at)
          values (${code}, ${String(r.name || "").slice(0, 300)}, ${n(r.price)}, ${String(r.kind || "").slice(0, 30)},
            ${r.cost != null ? n(r.cost) : null}, ${r.dept ? String(r.dept).slice(0, 40) : null}, now())
          on conflict (code) do update set name=excluded.name, price=excluded.price, kind=excluded.kind, cost=excluded.cost, dept=excluded.dept, updated_at=now()`;
        up++;
      }
      return json({ ok: true, upserted: up });
    }

    // get — role gate
    const role = (() => { try { let p = (req.headers.get("Authorization") || "").replace("Bearer ", "").split(".")[1]; p = p.replace(/-/g, "+").replace(/_/g, "/"); while (p.length % 4) p += "="; return JSON.parse(atob(p)).role || ""; } catch { return ""; } })();
    if (role !== "authenticated" && role !== "service_role") return json({ ok: false, error: "unauthorized" }, 401);
    const rows = await sql`select code, name, price, kind, updated_at from public.jera_prices order by price desc`;
    return json({ ok: true, prices: rows, count: rows.length });
  } catch (e) {
    return json({ ok: false, error: "internal error" }, 500);
  } finally { if (sql) await sql.end(); }
});
