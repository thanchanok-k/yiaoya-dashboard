// dept_sales — ยอดขายแยกแผนก (4 แผนก: กระดูกและข้อ/กายภาพ/พิลาทิส/นวด + ผสม) จาก JERA course+service
//   POST {action:'put', secret, month:'2026-06', rows:[{kind,dept,code,name,amount,txn_date,new_patient}]} -> replace-by-month
//   POST {action:'get'} | GET            -> role gate -> line items ทั้งหมด (dashboard aggregate เอง)
// ไม่เก็บ PII คนไข้ (PDPA) · DB_URL postgres.js · put=HUB_SECRET
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const HUB_SECRET = Deno.env.get("HUB_SECRET") ?? "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }
const num = (x: unknown) => (x == null || x === "" ? 0 : Number(x)) || 0;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* */ } }
  let sql: any;
  try {
    sql = postgres(DB_URL, { prepare: false });
    await sql`create table if not exists public.dept_sales (
      id bigserial primary key,
      month text not null, dept text not null, kind text,
      code text, name text, amount numeric default 0,
      txn_date date, new_patient boolean default false, branch text default 'SLY',
      performer text, patient_type text,
      updated_at timestamptz default now()
    )`;
    await sql`create index if not exists dept_sales_month_idx on public.dept_sales(month)`;
    await sql`alter table public.dept_sales add column if not exists performer text`;
    await sql`alter table public.dept_sales add column if not exists patient_type text`;

    if (body.action === "put") {
      if (!HUB_SECRET || body.secret !== HUB_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
      const month = body.month; const rows = body.rows;
      if (!month || !Array.isArray(rows)) return json({ ok: false, error: "missing month/rows" }, 400);
      await sql`delete from public.dept_sales where month = ${month}`;
      let c = 0;
      for (const r of rows) {
        await sql`insert into public.dept_sales (month, dept, kind, code, name, amount, txn_date, new_patient, branch, performer, patient_type, updated_at)
          values (${month}, ${r.dept ?? "อื่นๆ"}, ${r.kind ?? null}, ${r.code ?? null}, ${r.name ?? null},
            ${num(r.amount)}, ${r.txn_date ?? null}, ${!!r.new_patient}, ${r.branch ?? "SLY"}, ${r.performer ?? null}, ${r.patient_type ?? null}, now())`;
        c++;
      }
      return json({ ok: true, month, inserted: c });
    }

    const role = (() => { try { let p = (req.headers.get("Authorization") || "").replace("Bearer ", "").split(".")[1]; p = p.replace(/-/g, "+").replace(/_/g, "/"); while (p.length % 4) p += "="; return JSON.parse(atob(p)).role || ""; } catch { return ""; } })();
    if (role !== "authenticated" && role !== "service_role") return json({ ok: false, error: "unauthorized" }, 401);
    const m = (body.month) || (new URL(req.url).searchParams.get("month"));
    // ★ ไม่คืน performer/patient_type (PII พนักงาน/คนไข้) ให้ authenticated ทั่วไป — dashboard ใช้แค่ aggregate
    const cols = sql`month, dept, kind, code, name, amount, txn_date, new_patient, branch`;
    const rows = m ? await sql`select ${cols} from public.dept_sales where month=${m} order by amount desc`
                   : await sql`select ${cols} from public.dept_sales order by month desc, amount desc`;
    const months = await sql`select distinct month from public.dept_sales order by month desc`;
    return json({ ok: true, count: rows.length, months: months.map((x: any) => x.month), rows });
  } catch (e) {
    return json({ ok: false, error: "internal error" }, 500);
  } finally { if (sql) await sql.end(); }
});
