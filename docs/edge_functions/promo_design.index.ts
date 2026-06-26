// promo_design — AI ออกแบบโปรโมชั่นอัตโนมัติ (Yiaoya HQ) · อ่านข้อมูลรวม → Gemini คิดโปรฯ 2 ประเภท
//   POST {action:'generate', n?}  -> Gemini คิดโปรฯ (instore/acquisition) -> บันทึก promo_ideas -> คืน
//   POST {action:'list'} | GET    -> โหมด + โปรฯ ที่บันทึก (ไม่ archived)
//   POST {action:'decide', id, status}  -> อนุมัติ/ปฏิเสธ/เปิดใช้/เก็บ
//   POST {action:'set_mode', mode}      -> 'confirm' (คนเคาะ) | 'auto' (เปิดใช้อัตโนมัติ)
//   role gate authenticated/service_role · GEMINI_API_KEY secret · model gemini-2.5-flash
//   หมายเหตุ: โปรฯ ทุกชิ้น = "ร่างข้อเสนอ" ต้องผ่านการตรวจสอบโฆษณาสถานพยาบาลก่อนเผยแพร่
import postgres from "https://deno.land/x/postgresjs@v3.4.5/mod.js";
const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const GKEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GMODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const PRO_MODEL = Deno.env.get("PROMO_MODEL") ?? "gemini-2.5-pro"; // คุณภาพสูงสุดสำหรับคิดโปรฯ/วางแผน
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
function json(o: unknown, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } }); }
async function gem(genConfig: any, prompt: string, model = GMODEL, ms = 60000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(GKEY)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: genConfig }), signal: ctl.signal,
    });
  } finally { clearTimeout(t); }
}
// ลองรุ่นคุณภาพสูง (pro) ก่อน · ถ้าพลาด/ช้า fallback กลับ flash อัตโนมัติ
async function gemBest(genConfig: any, prompt: string): Promise<{ res: Response; model: string }> {
  try { const r = await gem(genConfig, prompt, PRO_MODEL, 90000); if (r.ok) return { res: r, model: PRO_MODEL }; } catch { /* timeout/err → fallback */ }
  return { res: await gem(genConfig, prompt, GMODEL, 60000), model: GMODEL };
}
const B = (n: number) => "฿" + Math.round(n).toLocaleString("en-US");
// แตกจำนวนครั้งจากชื่อคอร์ส ("...10 ครั้ง") → ฿/ครั้ง ในคอร์ส (= ราคาที่หั่นจากรายครั้งแล้ว)
function perSessionTxt(name: string, price: number): string {
  const m = String(name || "").match(/(\d+)\s*คร[ั]?้ง/);
  const n = m ? +m[1] : 0;
  if (n > 1 && price > 0) return ` [${n} ครั้ง ≈ ฿${Math.round(price / n).toLocaleString("en-US")}/ครั้งในคอร์ส]`;
  return "";
}
const VALID_STATUS = ["draft", "approved", "rejected", "active", "archived"];

async function ensure(sql: any) {
  await sql`create table if not exists public.promo_ideas (
    id bigint generated always as identity primary key,
    created_at timestamptz default now(),
    batch text,
    category text,
    title text,
    target text,
    mechanic text,
    price_note text,
    rationale text,
    channel text,
    kpi text,
    est_impact text,
    status text default 'draft',
    source text default 'ai',
    decided_by text,
    decided_at timestamptz
  )`;
  await sql`alter table public.promo_ideas enable row level security`;
  await sql`create table if not exists public.promo_settings (
    id int primary key default 1,
    mode text default 'confirm',
    updated_at timestamptz default now()
  )`;
  await sql`alter table public.promo_settings enable row level security`;
  await sql`insert into public.promo_settings(id,mode) values(1,'confirm') on conflict (id) do nothing`;
  await sql`alter table public.promo_ideas add column if not exists plan jsonb`;
  await sql`alter table public.promo_ideas add column if not exists plan_at timestamptz`;
  await sql`alter table public.promo_ideas add column if not exists launch_date date`;
  await sql`alter table public.promo_ideas add column if not exists promo_price numeric`;
  await sql`alter table public.promo_ideas add column if not exists normal_price numeric`;
  await sql`alter table public.promo_ideas add column if not exists margin_pct numeric`;
  await sql`alter table public.promo_ideas add column if not exists dept text`;
  await sql`alter table public.promo_ideas add column if not exists staff_reason text`;
  await sql`alter table public.promo_ideas add column if not exists content_angle text`;
  await sql`alter table public.promo_ideas add column if not exists target_audience text`;
  await sql`alter table public.promo_ideas add column if not exists sales_how text`;
  await sql`alter table public.promo_ideas add column if not exists season text`;
  await sql`alter table public.promo_settings add column if not exists min_margin numeric default 0.35`;
  await sql`alter table public.promo_settings add column if not exists cost_ratio numeric`;
  await sql`alter table public.promo_settings add column if not exists dept_costs jsonb`;
  await sql`alter table public.promo_settings add column if not exists custom_events jsonb`;
  await sql`alter table public.promo_settings add column if not exists building_cost numeric default 0`;     // ราคาซื้ออาคาร (ต้นทุนแฝง)
  await sql`alter table public.promo_settings add column if not exists building_years numeric default 30`;   // อายุค่าเสื่อม (ปี)
  await sql`alter table public.promo_settings add column if not exists building_include boolean default false`; // toggle รวม/ไม่รวม
}
const DEPTS = ["กระดูกและข้อ", "กายภาพ", "พิลาทิส", "นวด", "ผสม"];
// ปฏิทินวันสำคัญแบบระบุวันที่จริง: วันหยุดไทย + สากล + วันช้อป × มุมคลินิกกายภาพ/ฟื้นฟู
// [เดือน, วัน, ชื่อ, มุมการตลาด, ประเภท]  (จันทรคติ/เคลื่อนได้ = ใส่ใน MONTH_CTX แทน)
const EVENTS: [number, number, string, string, string][] = [
  [1, 1, "วันปีใหม่", "โบนัส/ตั้งเป้าสุขภาพต้นปี/ของขวัญ", "หยุดไทย+สากล"],
  [1, 16, "วันครู", "บุคลากรครู ดูแลสุขภาพ", "ไทย"],
  [2, 14, "วาเลนไทน์", "คอร์สคู่รัก/ของขวัญคนรัก/ดูแลตัวเอง", "สากล"],
  [3, 8, "วันสตรีสากล", "ผู้หญิงดูแลตัวเอง/สุขภาพ/หุ่น", "สากล"],
  [4, 6, "วันจักรี", "หยุดยาว", "หยุดไทย"],
  [4, 13, "สงกรานต์ (13-15)", "เดินทาง/ผู้สูงอายุกลับบ้าน/ปวดเมื่อย-อุบัติเหตุหลังเที่ยว", "หยุดไทย"],
  [5, 1, "วันแรงงาน", "พนักงานออฟฟิศ/ออฟฟิศซินโดรม", "หยุดไทย+สากล"],
  [5, 4, "วันฉัตรมงคล", "หยุด", "หยุดไทย"],
  [6, 1, "Mid-Year Sale (มิ.ย.)", "ช้อปกลางปี ลดทั้งเมือง คนตั้งใจซื้อ", "วันช้อป"],
  [6, 3, "วันเฉลิมฯ สมเด็จพระราชินี", "หยุด", "หยุดไทย"],
  [7, 28, "วันเฉลิมฯ ร.10", "หยุด", "หยุดไทย"],
  [8, 12, "วันแม่แห่งชาติ", "ของขวัญวันแม่/ดูแลเข่า-สุขภาพคุณแม่/ผู้สูงอายุ", "หยุดไทย+สากล"],
  [9, 9, "9.9 Sale", "วันช้อปเลขเบิ้ล", "วันช้อป"],
  [10, 10, "10.10 Sale", "วันช้อปเลขเบิ้ล", "วันช้อป"],
  [10, 13, "วันคล้ายวันสวรรคต ร.9", "รำลึก — เลี่ยงโทนรื่นเริง/ลดแลกแจกแถม", "หยุดไทย"],
  [10, 23, "วันปิยมหาราช", "หยุด", "หยุดไทย"],
  [10, 31, "ฮาโลวีน", "คอนเทนต์สนุก/ธีมสร้างสรรค์", "สากล"],
  [11, 11, "11.11 Mega Sale", "วันช้อปใหญ่สุดของปี คนรอซื้อ", "วันช้อป"],
  [12, 5, "วันพ่อ/วันชาติ", "ของขวัญวันพ่อ/ผู้สูงอายุ", "หยุดไทย"],
  [12, 10, "วันรัฐธรรมนูญ", "หยุด", "หยุดไทย"],
  [12, 12, "12.12 Sale", "วันช้อปเลขเบิ้ล", "วันช้อป"],
  [12, 25, "คริสต์มาส", "ของขวัญ/voucher/ธีมเทศกาล", "สากล"],
  [12, 31, "สิ้นปี/เคาท์ดาวน์", "โบนัส/หยุดยาว/เช็คสุขภาพส่งท้ายปี", "หยุดไทย+สากล"],
];
// บริบทรายเดือน: อากาศ + วันสำคัญทางพุทธ(จันทรคติ เคลื่อนได้) + งบ
const MONTH_CTX: Record<number, string> = {
  1: "ปลายหนาว · ตรุษจีน(บางปี อั่งเปา)", 2: "ปลายหนาว · มาฆบูชา(จันทรคติ) · ตรุษจีน", 3: "ร้อนเริ่ม · ปิดเทอม · เงินคืนภาษีเข้า",
  4: "ร้อนจัด · ปีใหม่ไทย", 5: "เข้าหน้าฝน · วิสาขบูชา(จันทรคติ) · เปิดเทอม(ใช้เงินก้อน)", 6: "หน้าฝน ปวดเข่า/ข้อ · ออฟฟิศซินโดรม",
  7: "หน้าฝน · อาสาฬหบูชา/เข้าพรรษา(จันทรคติ หยุดยาว)", 8: "หน้าฝน · ปลายปีงบราชการ(เร่งเบิก)", 9: "ปลายฝน · ปวดข้อ/ฟื้นฟู",
  10: "ปลายฝน · ออกพรรษา(จันทรคติ) · ปิดเทอม", 11: "อากาศเย็นเริ่ม ปวดข้อ · ลอยกระทง(จันทรคติ)", 12: "หน้าหนาว · โบนัสปลายปี",
};
const SPENDING_NOTE = "เงินเดือนออกปลายเดือน(25-สิ้นเดือน)+ต้นเดือน(1-5) = คนพร้อมจ่าย → จัดโปรฯ/ปิดการขายล้อช่วงนี้ · เลขเบิ้ล 9.9/10.10/11.11/12.12 · โบนัสปลายปี(ธ.ค.-ม.ค.) = พีคใช้เงินสุด";
function seasonInsight(customEvents: any[] = []) {
  let y = 2026, mm = 6, dd = 1;
  try { const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); const p = f.split("-"); y = +p[0]; mm = +p[1]; dd = +p[2]; } catch { /* */ }
  const today = Date.UTC(y, mm - 1, dd);
  // วันสำคัญของคลินิก (เซินเพิ่มเอง) + วันสำคัญมาตรฐาน
  const cust: [number, number, string, string, string][] = (Array.isArray(customEvents) ? customEvents : [])
    .filter((e) => e && +e.m >= 1 && +e.m <= 12 && +e.d >= 1 && +e.d <= 31)
    .map((e) => [+e.m, +e.d, String(e.name || "วันสำคัญคลินิก"), String(e.angle || "วันพิเศษของคลินิก"), "คลินิก"]);
  const all = EVENTS.concat(cust);
  // วันสำคัญที่กำลังมาใน 80 วัน — นับถอยหลังจริง
  const up = all.map(([m, d, name, angle, tag]) => {
    let ev = Date.UTC(y, m - 1, d); if (ev < today - 2 * 864e5) ev = Date.UTC(y + 1, m - 1, d);
    return { days: Math.round((ev - today) / 864e5), m, d, name, angle, tag };
  }).filter((e) => e.days >= 0 && e.days <= 80).sort((a, b) => a.days - b.days);
  const upTxt = up.length
    ? up.map((e) => `• อีก ${e.days} วัน (${e.d}/${e.m}) ${e.name} [${e.tag}] — ${e.angle}`).join("\n")
    : "(ไม่มีวันสำคัญใน 80 วันข้างหน้า)";
  // เงินเดือนออกรอบถัดไป
  const payNext = dd <= 5 ? "วันนี้-ต้นเดือน (เพิ่งเงินออก)" : (dd >= 25 ? "ช่วงนี้ (สิ้นเดือน เงินออก)" : `อีก ${25 - dd} วัน (สิ้นเดือน)`);
  const txt = `วันนี้ ${dd}/${mm}/${y}\n[วันสำคัญที่กำลังมา — เลือกเกาะอันที่ใกล้/แรงที่สุด]\n${upTxt}\n[บริบทเดือนนี้] ${MONTH_CTX[mm]}\n[จังหวะคนใช้เงิน] ${SPENDING_NOTE} · เงินเดือนออกรอบถัดไป: ${payNext}`;
  return { mm, dd, txt };
}
// คำนวณ guardrail margin จากต้นทุนจริง: payroll + ค่าเช่า + OPEX + ค่าแอด ÷ รายได้/เดือน
async function marginGuard(sql: any) {
  const cfg = await sql`select coalesce(min_margin,0.35)::numeric mm, cost_ratio, custom_events, coalesce(building_cost,0)::numeric bcost, coalesce(building_years,30)::numeric byears, coalesce(building_include,false) binc from public.promo_settings where id=1`;
  const minMargin = Math.min(0.9, Math.max(0, +(cfg[0]?.mm ?? 0.35)));
  // ต้นทุนแฝงอาคาร (ค่าเสื่อม) — เปิด/ปิดได้
  const bInc = cfg[0]?.binc === true; const bCost = +(cfg[0]?.bcost || 0); const bYears = +(cfg[0]?.byears || 30) || 30;
  const buildingMonthly = (bInc && bCost > 0) ? bCost / (bYears * 12) : 0;
  let customEvents = cfg[0]?.custom_events; if (typeof customEvents === "string") { try { customEvents = JSON.parse(customEvents); } catch { customEvents = []; } } if (!Array.isArray(customEvents)) customEvents = [];
  let rev = 0;
  try { const d = await sql`select avg(net)::numeric a from public.jera_daily_sales where date > current_date - 60`; rev = +(d[0]?.a || 0) * 30; } catch { /* */ }
  if (!rev) { try { const d = await sql`select sum(amount)::numeric s, count(distinct month)::int m from public.dept_sales where month in (select distinct month from public.dept_sales order by month desc limit 3)`; rev = +(d[0]?.s || 0) / Math.max(1, +(d[0]?.m || 1)); } catch { /* */ } }
  let payroll = 0, rent = 0, other = 0, ad = 0, staffActive = 0, staffTotal = 0;
  // เงินเดือน "active เท่านั้น" = events(employee.payroll_set ล่าสุดต่อคน) JOIN employees กรอง status active/probation
  //   (เดิมรวม terminated → payroll เกินเกือบเท่าตัว ทำ margin ดูบางผิด) · acc_pay_terms(OCR) เชื่อตัวเลขไม่ได้ จึงใช้ payroll จริง
  try {
    const pr = await sql`with pay as (
      select distinct on (payload->>'employee_id') (payload->>'employee_id') eid, (payload->>'base_salary')::numeric sal
      from public.events where event_type='employee.payroll_set'
      order by payload->>'employee_id', seq desc)
      select count(*)::int n, count(*) filter (where lower(coalesce(e.status,'')) in ('active','probation'))::int act,
        coalesce(sum(pay.sal) filter (where lower(coalesce(e.status,'')) in ('active','probation')),0)::numeric s
      from pay join public.employees e on e.employee_id = pay.eid where coalesce(pay.sal,0) > 0`;
    payroll = +(pr[0]?.s || 0); staffActive = +(pr[0]?.act || 0); staffTotal = +(pr[0]?.n || 0);
  } catch { /* */ }
  try { const b = await sql`select coalesce(rent_monthly,0)::numeric r, coalesce(other_monthly,0)::numeric o from public.branch_costs where id=1`; rent = +(b[0]?.r || 0); other = +(b[0]?.o || 0); } catch { /* */ }
  try { const a = await sql`select avg(s)::numeric a from (select month, sum(coalesce(spend,0)) s from public.mkt_monthly where source in ('meta','google') group by month order by month desc limit 3) m`; ad = +(a[0]?.a || 0); } catch { /* */ }
  const overheadCost = payroll + rent + other + buildingMonthly;     // ค่าแรง+เช่า+OPEX+ค่าเสื่อมอาคาร = overhead
  const cost = overheadCost + ad;
  const override = cfg[0]?.cost_ratio != null ? +cfg[0].cost_ratio : null;
  const orgRatio = override != null ? override : (rev > 0 ? cost / rev : null);  // ต้นทุนรวมเฉลี่ยทั้งคลินิก
  const orgMarginNow = orgRatio != null ? 1 - orgRatio : null;
  const overheadRatio = (rev > 0) ? overheadCost / rev : null;  // overhead เฉลี่ยทั้งคลินิก (fallback)
  // ต้นทุน "ตรง" รายแผนก จาก JERA (cost/price = ค่ายา/หัตถการ · อ้างอิง ไม่รวม overhead)
  const directByDept: Record<string, number> = {}; let orgDirect: number | null = null;
  try {
    // ใช้ sum(cost)/sum(price) (ถ่วงน้ำหนักด้วยราคา) กัน outlier ตัวขาดทุน (consult/home-visit cost>price) ดึงค่าเฉลี่ยเพี้ยน
    const dr = await sql`select dept, sum(cost)::numeric c, sum(price)::numeric p from public.jera_prices where cost is not null and price > 0 and dept is not null group by dept`;
    for (const row of dr) if (row.dept && +row.p > 0) directByDept[row.dept] = Math.min(0.6, +row.c / +row.p);
    const od = await sql`select sum(cost)::numeric c, sum(price)::numeric p from public.jera_prices where cost is not null and price > 0`;
    if (od[0]?.p > 0) orgDirect = Math.min(0.6, +od[0].c / +od[0].p);
  } catch { /* */ }
  const laborMode = "uniform";  // overhead เฉลี่ยทั้งคลินิก (ไม่ปันรายแผนก — รายได้ vs คนทำงานไม่ตรงแผนก เช่นนวดอยู่ใน Full Care)
  // ต้นทุนรายแผนก: (1) override เซิน (2) ตรง(JERA) + overhead เฉลี่ย (3) seed
  let dc = cfg[0]?.dept_costs; if (typeof dc === "string") { try { dc = JSON.parse(dc); } catch { dc = null; } }
  const seed: Record<string, number> = { "กระดูกและข้อ": 0.55, "กายภาพ": 0.45, "พิลาทิส": 0.40, "นวด": 0.50, "ผสม": 0.48 };
  const base = orgRatio != null ? orgRatio : 0.5;
  const depts: Record<string, any> = {};
  for (const d of DEPTS) {
    // overhead = เฉลี่ยทั้งคลินิก (uniform) — ไม่ปันรายแผนก เพราะรายได้ vs คนทำงาน ไม่ตรงแผนกกัน (เช่น นวดไปอยู่ใน Full Care) → ปันรายแผนกได้ artifact
    const overhead: number | null = overheadRatio;
    let direct: number, src = "auto";
    if (dc && dc[d] != null) { direct = Math.min(0.95, Math.max(0, +dc[d])); src = "override"; }  // override = ต้นทุนตรง/ผันแปร
    else { direct = directByDept[d] != null ? directByDept[d] : (orgDirect != null ? orgDirect : 0.12); src = "auto"; }
    const ratioFull = direct + (overhead != null ? overhead : 0);  // ต้นทุนรวม (direct+overhead) · ไม่ cap → full margin ติดลบได้ (บอกความจริงว่าขาดทุน)
    // ★ เพดานส่วนลด (HARD) = กันแค่ต้นทุน "ตรง" (contribution) ให้เหลือ ≥ minMargin · overhead เป็นต้นทุนคงที่ (เตือนแยก)
    const maxDisc = Math.max(0, 1 - direct / (1 - minMargin));
    depts[d] = { ratio: ratioFull, direct, overhead, src, ratioFull, contribMargin: 1 - direct, fullMargin: 1 - ratioFull, marginNow: 1 - ratioFull, maxDisc };
  }
  const custom = !!(dc && Object.keys(dc).length);
  return { minMargin, rev, cost, payroll, rent, other, ad, orgRatio, orgMarginNow, overheadRatio, orgDirect, laborMode, staffActive, staffTotal, override: override != null, depts, deptCustom: custom, customEvents, building: { include: bInc, cost: bCost, years: bYears, monthly: Math.round(buildingMonthly) } };
}
const deptRatio = (g: any, dept: string) => (g?.depts?.[dept]?.ratio ?? g?.orgRatio ?? 0.5);
const deptMaxDisc = (g: any, dept: string) => (g?.depts?.[dept]?.maxDisc ?? (g?.orgRatio != null ? Math.max(0, 1 - g.orgRatio / (1 - g.minMargin)) : 0));
async function getMode(sql: any): Promise<string> {
  const r = await sql`select mode from public.promo_settings where id=1`;
  return (r[0]?.mode === "auto") ? "auto" : "confirm";
}
// ภาพรวมทุกช่องทาง (JERA + Meta/Facebook + Google) — ใช้ประกอบการวิเคราะห์เสมอ
async function channelInsights(sql: any) {
  let platformTxt = "", trendTxt = "", creativeTxt = "", roasTxt = "";
  try {
    const pl = await sql`select source, sum(coalesce(spend,0))::numeric spend, sum(coalesce(messages,0))::int msg, sum(coalesce(clicks,0))::int clk from public.mkt_monthly where source in ('meta','google') group by source`;
    platformTxt = pl.map((r: any) => { const c = +r.msg > 0 ? ` · ฿${(+r.spend / +r.msg).toFixed(0)}/แชท` : (+r.clk > 0 ? ` · ฿${(+r.spend / +r.clk).toFixed(0)}/คลิก` : ""); return `${r.source === "meta" ? "Meta (FB/IG)" : "Google"}: แอดรวม ${B(+r.spend)} · ทักแชท ${r.msg}${c}`; }).join("\n");
  } catch { /* */ }
  try {
    const tr = await sql`select month, sum(coalesce(spend,0))::numeric spend, sum(coalesce(messages,0))::int msg, sum(coalesce(cnt,0))::int newp from public.mkt_monthly group by month order by month desc limit 4`;
    trendTxt = tr.reverse().map((r: any) => `${r.month}: แอด ${B(+r.spend)} · ทักแชท ${r.msg} · คนไข้ใหม่ ${r.newp}`).join("\n");
  } catch { /* */ }
  try {
    const cr = await sql`select ad_name, coalesce(messages,0)::int msg, coalesce(ctr,0)::numeric ctr, coalesce(spend,0)::numeric spend from public.ad_creative where coalesce(messages,0) > 0 order by messages desc limit 5`;
    creativeTxt = cr.map((r: any) => `${r.ad_name || "-"}: ทักแชท ${r.msg} · CTR ${(+r.ctr).toFixed(1)}% · แอด ${B(+r.spend)}`).join("\n");
  } catch { /* */ }
  try {
    const rev = await sql`select sum(amount)::numeric r from public.dept_sales where month in (select distinct month from public.mkt_monthly order by month desc limit 3)`;
    const sp = await sql`select sum(coalesce(spend,0))::numeric s from public.mkt_monthly where source in ('meta','google') and month in (select distinct month from public.mkt_monthly order by month desc limit 3)`;
    if (+(sp[0]?.s || 0) > 0) roasTxt = `ROAS ระดับองค์กร ~${(+(rev[0]?.r || 0) / +sp[0].s).toFixed(1)}x (รายได้ ${B(+(rev[0]?.r || 0))} ÷ ค่าแอด ${B(+sp[0].s)} · 3 เดือน)`;
  } catch { /* */ }
  const block = `[ภาพรวมทุกช่องทาง — JERA + Facebook/Meta + Google (ใช้ประกอบการวิเคราะห์เสมอ)]
- แพลตฟอร์มโฆษณา:\n${platformTxt || "-"}
- เทรนด์รายเดือน (แอด/ทักแชท/คนไข้ใหม่):\n${trendTxt || "-"}
- ครีเอทีฟที่ได้ผลสุด (ทักแชทเยอะ — ใช้เป็นแนวคอนเทนต์/ช่องทางของโปรฯ):\n${creativeTxt || "-"}
- ${roasTxt || "ROAS: -"}`;
  return block;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const role = (() => { try { let p = (req.headers.get("Authorization") || "").replace("Bearer ", "").split(".")[1]; p = p.replace(/-/g, "+").replace(/_/g, "/"); while (p.length % 4) p += "="; return JSON.parse(atob(p)).role || ""; } catch { return ""; } })();
  if (role !== "authenticated" && role !== "service_role") return json({ ok: false, error: "unauthorized" }, 401);
  let body: any = {}; if (req.method === "POST") { try { body = await req.json(); } catch { /* */ } }
  const action = body.action || (req.method === "GET" ? "list" : "list");

  let sql: any;
  try {
    sql = postgres(DB_URL, { prepare: false });
    await ensure(sql);

    // ---- list ----
    if (action === "list") {
      const mode = await getMode(sql);
      const rows = await sql`select * from public.promo_ideas where status <> 'archived' order by created_at desc, id desc limit 200`;
      const audience = body.audience === "staff" ? "staff" : "owner";
      let guard: any = null;
      if (audience === "owner") { try { guard = await marginGuard(sql); } catch { /* */ } }
      else {
        // โหมดทีมงาน: ตัดเฉพาะ "ตัวเลขกำไร/ต้นทุน" (margin) ออกก่อนส่ง · เก็บ normal_price ไว้ (= ราคาปกติ บอกลูกค้าได้)
        for (const r of rows) { delete r.margin_pct; }
      }
      return json({ ok: true, mode, audience, promos: rows, guard });
    }

    // ---- set_margin (ตั้งค่า guardrail กำไรขั้นต่ำ + ต้นทุน override) ----
    if (action === "set_margin") {
      const mm = body.min_margin != null ? Math.min(0.9, Math.max(0, Number(body.min_margin) || 0)) : null;
      const cr = body.cost_ratio != null && body.cost_ratio !== "" ? Math.min(0.99, Math.max(0, Number(body.cost_ratio) || 0)) : null;
      if (mm != null) await sql`update public.promo_settings set min_margin=${mm} where id=1`;
      if (body.cost_ratio === null || body.cost_ratio === "") await sql`update public.promo_settings set cost_ratio=null where id=1`;
      else if (cr != null) await sql`update public.promo_settings set cost_ratio=${cr} where id=1`;
      if (body.dept_costs && typeof body.dept_costs === "object") {
        const clean: Record<string, number> = {};
        for (const d of DEPTS) { const v = body.dept_costs[d]; if (v != null && v !== "") clean[d] = Math.min(0.99, Math.max(0, Number(v) || 0)); }
        await sql`update public.promo_settings set dept_costs=${sql.json(clean)} where id=1`;
      }
      if (body.building_cost != null && body.building_cost !== "") await sql`update public.promo_settings set building_cost=${Math.max(0, Number(body.building_cost) || 0)} where id=1`;
      if (body.building_years != null && body.building_years !== "") await sql`update public.promo_settings set building_years=${Math.max(1, Number(body.building_years) || 30)} where id=1`;
      if (body.building_include != null) await sql`update public.promo_settings set building_include=${body.building_include === true || body.building_include === "true"} where id=1`;
      if (Array.isArray(body.custom_events)) {
        const ev = body.custom_events
          .filter((e: any) => e && +e.m >= 1 && +e.m <= 12 && +e.d >= 1 && +e.d <= 31)
          .slice(0, 40)
          .map((e: any) => ({ m: +e.m, d: +e.d, name: String(e.name || "").slice(0, 80), angle: String(e.angle || "").slice(0, 160) }));
        await sql`update public.promo_settings set custom_events=${sql.json(ev)} where id=1`;
      }
      const guard = await marginGuard(sql);
      return json({ ok: true, guard });
    }

    // ---- set_mode ----
    if (action === "set_mode") {
      const mode = body.mode === "auto" ? "auto" : "confirm";
      await sql`update public.promo_settings set mode=${mode}, updated_at=now() where id=1`;
      return json({ ok: true, mode });
    }

    // ---- decide ----
    if (action === "decide") {
      const id = parseInt(body.id, 10);
      const status = String(body.status || "");
      if (!id || !VALID_STATUS.includes(status)) return json({ ok: false, error: "bad params" }, 400);
      const by = (() => { try { let p = (req.headers.get("Authorization") || "").replace("Bearer ", "").split(".")[1]; p = p.replace(/-/g, "+").replace(/_/g, "/"); while (p.length % 4) p += "="; const j = JSON.parse(atob(p)); return j.email || j.sub || "user"; } catch { return "user"; } })();
      const upd = await sql`update public.promo_ideas set status=${status}, decided_by=${by}, decided_at=now() where id=${id} returning *`;
      return json({ ok: true, promo: upd[0] || null });
    }

    // ---- set_launch ----
    if (action === "set_launch") {
      const id = parseInt(body.id, 10);
      const ld = String(body.launch_date || "");
      if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(ld)) return json({ ok: false, error: "bad params" }, 400);
      const upd = await sql`update public.promo_ideas set launch_date=${ld} where id=${id} returning *`;
      return json({ ok: true, promo: upd[0] || null });
    }

    // ---- plan (strategist execution plan) ----
    if (action === "plan") {
      if (!GKEY) return json({ ok: false, error: "ยังไม่ได้ตั้ง GEMINI_API_KEY ใน Supabase secrets", need_key: true }, 200);
      const id = parseInt(body.id, 10);
      if (!id) return json({ ok: false, error: "bad id" }, 400);
      const rows = await sql`select * from public.promo_ideas where id=${id}`;
      const p = rows[0];
      if (!p) return json({ ok: false, error: "not found" }, 404);
      if (body.launch_date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.launch_date))) {
        await sql`update public.promo_ideas set launch_date=${body.launch_date} where id=${id}`;
      }
      const catTxt = p.category === "acquisition" ? "ดึงคนไข้ใหม่" : "หน้าร้าน · คนไข้เดิม";

      // ===== ดึงข้อมูลจริงทั้งหมดมาตั้งเป้าเป็นตัวเลข (แยกคนไข้ใหม่/เก่า) =====
      const pmonths = (await sql`select distinct month from public.dept_sales order by month desc limit 3`).map((r: any) => r.month);
      let splitTxt = "", pbestTxt = "", pchTxt = "", pbrandTxt = "", prateTxt = "";
      try {
        const ov = await sql`select sum(amount)::numeric tot, sum(amount) filter (where new_patient)::numeric newrev,
          count(*)::int units, count(*) filter (where new_patient)::int newunits
          from public.dept_sales where month = any(${pmonths})`;
        const o = ov[0] || {}; const tot = +(o.tot || 0), nr = +(o.newrev || 0), u = +(o.units || 0), nu = +(o.newunits || 0);
        if (tot) splitTxt = `ยอดรวม 3 เดือน ${B(tot)} (${u} ดีล) · คนไข้ใหม่ ${B(nr)} (${nu} ดีล ${Math.round(nr / tot * 100)}%) · คนไข้เก่า ${B(tot - nr)} (${u - nu} ดีล ${Math.round((tot - nr) / tot * 100)}%) · เฉลี่ย ${B(tot / Math.max(1, u))}/ดีล`;
      } catch { /* */ }
      try {
        const best = await sql`select dept, name, count(*)::int units, sum(amount)::numeric rev, avg(amount)::numeric avgp, sum((new_patient)::int)::int newu
          from public.dept_sales where month = any(${pmonths}) and name is not null and name <> '' and amount > 0
          group by dept, name order by rev desc limit 15`;
        pbestTxt = best.map((r: any) => `${r.dept} · ${r.name}: ขาย ${r.units} ครั้ง (คนไข้ใหม่ ${r.newu} / คนเก่า ${+r.units - +r.newu}) · ราคาเฉลี่ย ${B(+r.avgp)} · รายได้ ${B(+r.rev)}`).join("\n");
      } catch { /* */ }
      try {
        const ch = await sql`select channel, sum(cnt)::int c from public.mkt_channel group by channel order by c desc`;
        pchTxt = ch.map((r: any) => `${r.channel}:${r.c}`).join(" · ");
      } catch { /* */ }
      try {
        const br = await sql`select case when campaign ilike '%KNEE%' or campaign ilike '%เข่า%' then 'KneeCare' when campaign ilike '%นางฟ้า%' then 'นางฟ้า' when campaign ilike '%YIAOYA%' or campaign ilike '%เยียวยา%' then 'Yiaoya' else 'อื่นๆ' end brand, sum(spend)::numeric spend, sum(messages)::int msg from public.ad_creative group by 1 having sum(messages) > 0 order by spend desc`;
        pbrandTxt = br.map((r: any) => `${r.brand}: ฿${(+r.spend / Math.max(1, +r.msg)).toFixed(0)}/แชท`).join(" · ");
      } catch { /* */ }
      try {
        const ds = await sql`select avg(net)::numeric a, avg(bills)::numeric b from public.jera_daily_sales where date > current_date - 60`;
        if (ds[0]?.a) prateTxt = `ยอดเฉลี่ย ${B(+ds[0].a)}/วัน · ${Math.round(+ds[0].b)} บิล/วัน`;
      } catch { /* */ }
      // ราคาคอร์สปัจจุบันจาก JERA (ราคาล่าสุด/หลังปรับขึ้น) = ราคาอ้างอิงหลัก
      let priceTxt = "";
      try {
        const pr = await sql`select name, price, kind from public.jera_prices where price > 0 order by price desc limit 60`;
        priceTxt = pr.map((r: any) => `${r.name}: ${B(+r.price)}${r.kind === "service" ? " (ราคารายครั้ง)" : perSessionTxt(r.name, +r.price)}`).join("\n");
      } catch { /* */ }
      const goal = Math.round(+(body.goal_revenue || 0)) || 0; // เป้ายอดที่ผู้บริหารกำหนดเอง (ถ้ามี)
      const chanBlock = await channelInsights(sql); // JERA + Meta + Google ทุกช่องทาง

      const prompt = `คุณคือ Chief Growth Strategist ระดับรางวัลของคลินิก Yiaoya (กายภาพ/เวชศาสตร์ฟื้นฟู สาขาศาลายา · 4 แผนก: กระดูกและข้อ/กายภาพ/พิลาทิส/นวด)
[วิธีคิด] คิดเป็นขั้นก่อนตอบ: หา insight จากตัวเลขจริง → ออกแบบแผนที่ทั้งแม่นยำ (เป้าเป็นตัวเลขสมจริง อิงสัดส่วนใหม่/เก่า+conversion+run-rate) และสร้างสรรค์ (care path มีลูกเล่นทำให้คนไข้ผูกพัน/ซื้อซ้ำ, สคริปต์ขายที่กระตุ้นการตัดสินใจ, ประกาศที่สะดุด)
หน้าที่: วางแผนลงมือแบบ strategist ที่ "ทำเงินได้จริง" — ต้องตั้งเป้าเป็น "ตัวเลข" (ต้องขายกี่ดีล/ยอดเท่าไหร่ แยกคนไข้ใหม่กับเก่า) และออกแบบ care path ให้เกิดยอดขายจริง

[โปรโมชั่นที่ต้องวางแผน] ประเภท: ${catTxt}
ชื่อ: ${p.title}
กลุ่มเป้าหมาย: ${p.target || "-"}
กลไก: ${p.mechanic || "-"}
ราคา/มูลค่า: ${p.price_note || "-"}
เหตุผล: ${p.rationale || "-"}
ช่องทาง: ${p.channel || "-"}

[ราคาคอร์สปัจจุบันจาก JERA (ราคาล่าสุด/หลังปรับขึ้นแล้ว) — ✅ ใช้เป็น "ราคาจริง" หลักในการคิด assumed_price/price_note]
${priceTxt || "(ไม่มีข้อมูลราคาปัจจุบัน)"}

[ข้อมูลจริง 3 เดือนล่าสุด (${pmonths.join(", ")}) — ใช้ตั้งเป้าเป็นตัวเลข ห้ามแต่งเลขเอง]
- สัดส่วนยอดคนไข้ใหม่/เก่า: ${splitTxt || "-"}
- คอร์ส/บริการขายดี (ดูว่า "อะไรขายดี" จากจำนวนครั้ง · ⚠️ ราคาเฉลี่ยในนี้เป็นย้อนหลังอาจรวมราคาเก่า ห้ามใช้เป็นราคาปัจจุบัน ให้ใช้ราคาจาก JERA ด้านบนแทน):
${pbestTxt || "-"}
- ช่องทางคนไข้ใหม่มาจากไหน: ${pchTxt || "-"}
- ต้นทุนต่อแชทรายแบรนด์: ${pbrandTxt || "-"}
- run-rate: ${prateTxt || "-"}

${chanBlock}
${goal ? `\n[★ เป้ายอดขายที่ผู้บริหารกำหนด] โปรฯ นี้ต้องทำยอดให้ได้ ${B(goal)} → ออกแบบแผน "ถอยหลังจากเป้านี้": คำนวณว่าต้องขายกี่ดีลที่ราคาจริง, ต้องได้ lead/แชทกี่คนที่ conversion สมจริง, แบ่งยอดมาจากคนไข้ใหม่กับเก่าเท่าไหร่ · ตั้ง revenue_target.target_revenue = ${goal} เป๊ะ` : ""}

[ทีม] หน้าบ้าน(ต้อนรับ/ขาย) · คลินิก(แพทย์/PT) · การตลาด/คอนเทนต์ · บัญชี/การเงิน(JERA+POS) · จัดซื้อ/สต็อก
[ระบบ] JERA(ขาย/คอร์ส/นัด) · LINE OA · Meta/Google Ads · บอร์ดภายใน
[กฎ] โฆษณาสถานพยาบาลไทย: ห้ามโอ้อวด/รับประกันผล · ประกาศ public = ร่าง ต้องรีวิวก่อน · ตัวเลขเป้าทุกตัวต้องสมเหตุผลกับข้อมูลจริงด้านบน (อิงราคาเฉลี่ย/สัดส่วนใหม่-เก่า/run-rate)
[กฎ margin คอร์ส] ราคาคอร์ส = หั่นส่วนลดจากรายครั้งมาแล้ว (ถูกกว่ารายครั้ง — ดู [฿/ครั้งในคอร์ส] เทียบ "ราคารายครั้ง") → อย่าตัดราคาคอร์สซ้ำ ใช้แถมครั้ง/บริการเสริมแทน · ถ้าลด effective ฿/ครั้ง ต้องไม่ต่ำกว่าต้นทุน/ครั้ง

[งาน] ออกแบบแผนเป็น JSON:
1) strategy: positioning, why_now(อิงตัวเลข), target_segment, success_metric(เป็นตัวเลขชัด), risk, budget_note
2) revenue_target (เป้ายอดขายเป็นตัวเลข): timeframe(ช่วงเวลา), target_units(ต้องขายกี่ดีล), assumed_price(ราคาต่อดีล อิงราคาจริง), target_revenue(ยอดเป้ารวม ฿), from_new{units,revenue}(มาจากคนไข้ใหม่กี่ดีล/฿), from_existing{units,revenue}(มาจากคนไข้เก่ากี่ดีล/฿), assumptions(สมมติฐาน เช่น conversion rate, จำนวน lead), breakeven(จุดคุ้ม เช่น ต้องขายกี่ดีลถึงคุ้มค่าแอด)
3) duration
4) patient_journey: เส้นทางดูแลคนไข้ awareness→inquiry→booking→visit→service→retention แต่ละขั้น: stage, touchpoint, what_happens, owner_team, system, conversion_target(เป้า% แปลงไปขั้นถัดไป เช่น "ทักแชท→จองนัด 60%"), revenue_action(ในขั้นนี้ทำอะไรให้ "เกิด/รักษายอด" เช่น เสนอคอร์สต่อ, ลด no-show, upsell, นัดติดตามเพื่อซื้อซ้ำ)
5) frontdesk: task, detail, day_offset
6) backoffice: team(clinical/finance/purchasing/marketing แบบไทย), task, detail, lead_time, day_offset
7) announcements: team, audience("staff"/"public"), channel, title, draft(ร่างจริงพร้อมใช้), day_offset
ทุก day_offset = จำนวนเต็มวันเทียบวันเปิดโปรฯ (ก่อนเปิดติดลบ, วันเปิด=0, หลังเปิดบวก) · ภาษาไทย กระชับ ใช้งานได้จริง`;

      const schema = {
        type: "object",
        properties: {
          strategy: {
            type: "object",
            properties: { positioning: { type: "string" }, why_now: { type: "string" }, target_segment: { type: "string" }, success_metric: { type: "string" }, risk: { type: "string" }, budget_note: { type: "string" } },
            required: ["positioning", "why_now", "success_metric"],
          },
          revenue_target: {
            type: "object",
            properties: {
              timeframe: { type: "string" }, target_units: { type: "integer" }, assumed_price: { type: "number" }, target_revenue: { type: "number" },
              from_new: { type: "object", properties: { units: { type: "integer" }, revenue: { type: "number" } } },
              from_existing: { type: "object", properties: { units: { type: "integer" }, revenue: { type: "number" } } },
              assumptions: { type: "string" }, breakeven: { type: "string" },
            },
            required: ["target_units", "target_revenue"],
          },
          duration: { type: "string" },
          patient_journey: { type: "array", items: { type: "object", properties: { stage: { type: "string" }, touchpoint: { type: "string" }, what_happens: { type: "string" }, owner_team: { type: "string" }, system: { type: "string" }, conversion_target: { type: "string" }, revenue_action: { type: "string" } }, required: ["stage", "what_happens"] } },
          frontdesk: { type: "array", items: { type: "object", properties: { task: { type: "string" }, detail: { type: "string" }, day_offset: { type: "integer" } }, required: ["task"] } },
          backoffice: { type: "array", items: { type: "object", properties: { team: { type: "string" }, task: { type: "string" }, detail: { type: "string" }, lead_time: { type: "string" }, day_offset: { type: "integer" } }, required: ["team", "task"] } },
          announcements: { type: "array", items: { type: "object", properties: { team: { type: "string" }, audience: { type: "string" }, channel: { type: "string" }, title: { type: "string" }, draft: { type: "string" }, day_offset: { type: "integer" } }, required: ["team", "title", "draft"] } },
        },
        required: ["strategy", "revenue_target", "patient_journey", "frontdesk", "backoffice", "announcements"],
      };

      let gr: Response;
      try { const b = await gemBest({ temperature: 0.55, topP: 0.95, maxOutputTokens: 16384, responseMimeType: "application/json", responseSchema: schema, thinkingConfig: { thinkingBudget: 4096 } }, prompt); gr = b.res; }
      catch { return json({ ok: false, error: "AI ใช้เวลานานเกินไป (timeout) ลองใหม่อีกครั้ง" }, 200); }
      const gd = await gr.json();
      if (!gr.ok) return json({ ok: false, error: "Gemini error" }, 200);
      let raw = (gd?.candidates?.[0]?.content?.parts?.map((x: any) => x.text).join("") || "{}").trim();
      if (raw.startsWith("```")) raw = raw.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "").trim();
      let plan: any; try { plan = JSON.parse(raw); } catch { return json({ ok: false, error: "parse error", finish: gd?.candidates?.[0]?.finishReason || "" }, 200); }
      if (!plan || !plan.strategy) return json({ ok: false, error: "AI วางแผนไม่สำเร็จ ลองใหม่" }, 200);
      await sql`update public.promo_ideas set plan=${sql.json(plan)}, plan_at=now() where id=${id}`;
      const out = await sql`select * from public.promo_ideas where id=${id}`;
      return json({ ok: true, promo: out[0] });
    }

    // ---- generate ----
    if (action === "generate") {
      if (!GKEY) return json({ ok: false, error: "ยังไม่ได้ตั้ง GEMINI_API_KEY ใน Supabase secrets", need_key: true }, 200);

      // รายได้/คนไข้ใหม่ รายแผนก (3 เดือนล่าสุด)
      const months = (await sql`select distinct month from public.dept_sales order by month desc limit 3`).map((r: any) => r.month);
      const dep = await sql`select dept, sum(amount)::numeric rev, sum((new_patient)::int) newp
        from public.dept_sales where month = any(${months}) group by dept order by rev desc`;
      const depTxt = dep.map((d: any) => `${d.dept}: รายได้${B(+d.rev)} คนไข้ใหม่จ่าย${d.newp}`).join("\n");

      // ช่องทางคนไข้ใหม่
      const ch = await sql`select channel, sum(cnt)::int c from public.mkt_channel group by channel order by c desc`;
      const chTxt = ch.map((r: any) => `${r.channel}:${r.c}`).join(" · ");

      // ฿/แชท รายแบรนด์ (map brand จากชื่อแคมเปญ)
      let brandTxt = "(ไม่มีข้อมูล)";
      try {
        const br = await sql`select
          case when campaign ilike '%KNEE%' or campaign ilike '%เข่า%' then 'KneeCare'
               when campaign ilike '%นางฟ้า%' then 'นางฟ้า'
               when campaign ilike '%YIAOYA%' or campaign ilike '%เยียวยา%' then 'Yiaoya'
               else 'อื่นๆ' end brand,
          sum(spend)::numeric spend, sum(messages)::int msg
          from public.ad_creative group by 1 having sum(messages) > 0 order by spend desc`;
        brandTxt = br.map((r: any) => `${r.brand}: แอด${B(+r.spend)} ทักแชท${r.msg} = ฿${(+r.spend / Math.max(1, +r.msg)).toFixed(0)}/แชท`).join("\n");
      } catch { /* ad_creative อาจไม่มี */ }

      // ยอดขายจริงรายวัน
      let salesTxt = "";
      try {
        const ds = await sql`select avg(net)::numeric a, count(*)::int d, avg(bills)::numeric b from public.jera_daily_sales where date > current_date - 60`;
        if (ds[0]?.d) salesTxt = `ยอดขายจริงเฉลี่ย ${B(+ds[0].a)}/วัน · บิลเฉลี่ย ${Math.round(+ds[0].b)} บิล/วัน`;
      } catch { /* */ }

      // บริการ/คอร์สขายดีจริง + ราคาเฉลี่ย (จาก dept_sales · แต่ละแถว = 1 การขาย) = ของที่คลินิกมีจริงเท่านั้น
      let bestTxt = "";
      try {
        const best = await sql`select dept, name, count(*)::int units, sum(amount)::numeric rev, avg(amount)::numeric avgp, sum((new_patient)::int)::int newu
          from public.dept_sales where month = any(${months}) and name is not null and name <> '' and amount > 0
          group by dept, name order by rev desc limit 20`;
        bestTxt = best.map((r: any) => `${r.dept} · ${r.name}: ขาย ${r.units} ครั้ง (คนไข้ใหม่ ${r.newu} / คนเก่า ${+r.units - +r.newu}) · รายได้ ${B(+r.rev)}`).join("\n");
      } catch { /* */ }
      // ราคาคอร์สปัจจุบันจาก JERA (ราคาล่าสุด/หลังปรับขึ้น) = ราคาอ้างอิงหลัก
      let gpriceTxt = "";
      try {
        const pr = await sql`select name, price, kind from public.jera_prices where price > 0 order by price desc limit 60`;
        gpriceTxt = pr.map((r: any) => `${r.name}: ${B(+r.price)}`).join("\n");
      } catch { /* */ }
      const gchanBlock = await channelInsights(sql); // JERA + Meta + Google ทุกช่องทาง
      const mg = await marginGuard(sql); // guardrail รายแผนก: ลดได้สูงสุดกี่ % เพื่อคง margin >= min
      const deptCapTxt = DEPTS.map((d) => { const x = mg.depts[d]; return `${d}: ลดได้สูงสุด ${Math.round(x.maxDisc * 100)}% (promo_price ≥ normal × ${(1 - x.maxDisc).toFixed(3)}) · ต้นทุนตรง ${Math.round(x.direct * 100)}% · full-cost margin ${Math.round(x.fullMargin * 100)}%${x.fullMargin < 0.15 ? " ⚠️บาง/ติดลบ-ต้องพึ่งvolume" : ""}`; }).join("\n");
      const mgTxt = `เพดานส่วนลด (บังคับ) = ลดได้โดยยังเหลือกำไรเหนือ "ต้นทุนตรง" ≥ ${Math.round(mg.minMargin * 100)}% (contribution) — overhead(ค่าแรง/เช่า) เป็นต้นทุนคงที่ จ่ายอยู่แล้ว ไม่นับในเพดานลด แต่โชว์ full-cost margin เป็นบริบท · ห้ามลดเกินเพดานของแผนกนั้น · ถ้า full-cost margin บาง/ติดลบ = โปรฯ นั้นต้องเน้น volume/ขายเพิ่ม ไม่ใช่ขาดทุน:\n${deptCapTxt}`;

      const ssn = seasonInsight(mg.customEvents);
      const want = Math.min(8, Math.max(2, parseInt(body.n, 10) || 6));
      const prompt = `คุณคือ Creative Marketing Director ระดับรางวัลของคลินิก Yiaoya (กายภาพ/เวชศาสตร์ฟื้นฟู สาขาศาลายา · 4 แผนก: กระดูกและข้อ/กายภาพ/พิลาทิส/นวด) — เก่งทั้ง "แม่นยำกับตัวเลข" และ "คิดสร้างสรรค์เกินคาด"

[วิธีคิด — สำคัญ] คิดเป็นขั้น: (1) อ่านข้อมูลจริงหา insight ที่คนอื่นมองข้าม (เช่น คอร์สที่คนเก่าซื้อซ้ำเยอะ=ของดีบอกต่อ, แผนกที่คนใหม่เยอะ=ตลาดโต, เทศกาลที่ใกล้+เงินเดือนออก) (2) แล้วค่อยปั้นโปรฯ ที่ทั้งอิงตัวเลขและมีลูกเล่นน่าจดจำ
[2 เสาที่ต้องมีพร้อมกัน]
- แม่นยำ: ทุกตัวเลข/ราคา/กลุ่มเป้าหมาย อิงข้อมูลจริงด้านล่าง · ราคาอิง JERA · เคารพเพดานส่วนลด · เป้าสมจริง
- จินตนาการ: ตั้ง "ชื่อแคมเปญ" ให้น่าจดจำ (ไม่ใช่แค่ชื่อคอร์ส) · มีมุมเล่าเรื่อง/อารมณ์ · กลไกแปลกใหม่ (แพ็กคู่, ท้าทาย 30 วัน, สะสม, ชวนเพื่อน, ของแถมที่คิดต้นทุนแล้ว) · เซอร์ไพรส์แต่สมเหตุผล

หน้าที่: ออกแบบ "ร่างโปรโมชั่น" จากข้อมูลจริงด้านล่าง แบ่งเป็น 2 ประเภทให้สมดุล (อย่างละ ~${Math.round(want / 2)} โปรฯ):
- category="instore" = โปรฯ หน้าร้าน เน้นคนไข้เดิม/คนที่มาแล้ว: เพิ่มยอดต่อบิล, ซื้อคอร์สต่อ, อัปเกรด, ต่อยอดบริการ/คอร์สที่ขายดี
- category="acquisition" = โปรฯ ดึงคนไข้ใหม่: ทดลองครั้งแรก, แพ็กเริ่มต้นราคาเข้าถึงง่าย, ยิงผ่านช่องทางที่ ฿/แชท ถูกที่สุด

[คิดให้แหวก/สร้างสรรค์ — ไม่จำเจ]
- **อย่างน้อย 2 โปรฯ ต้อง "จับ 2 คอร์ส/บริการจริงมารวมเป็นแพ็กใหม่" (cross-sell ข้ามแผนก)** เช่น กระดูก+กายภาพ = ครบวงจรหายเร็ว · พิลาทิส+นวด = คอร์+ผ่อนคลาย · ใส่เหตุผลใน rationale ว่าทำไม 2 ตัวนี้เข้ากัน · ตั้ง dept="ผสม" · normal_price = ผลรวมราคาจริง 2 ตัว · ตั้งชื่อแพ็กให้น่าสนใจ
- **อย่างน้อย 2 โปรฯ ต้องเกาะเทศกาล/ซีซั่นที่กำลังมา** (ดูปฏิทินด้านล่าง) ผูกมุมเทศกาลเข้ากับบริการจริง (เช่น วาเลนไทน์ = คอร์สคู่, วันแม่ = ดูแลเข่าคุณแม่) · ใส่ field season = ชื่อเทศกาล/ซีซั่น
- ที่เหลือคิดมุมใหม่ๆ ได้ (challenge 30 วัน, สะสมแต้ม, สมาชิก, ชวนเพื่อน refer)

[กฎสำคัญ]
- **เสนอได้เฉพาะบริการ/คอร์สที่ปรากฏใน "บริการ/คอร์สขายดีจริง" ด้านล่างเท่านั้น (= ของที่คลินิกมีจริง) ห้ามคิดชื่อเครื่องมือ/บริการ/คอร์สที่ไม่มีในข้อมูลขึ้นมาเอง เด็ดขาด**
- **กำหนดราคาโปรฯ เป็นตัวเลขชัดเจน: normal_price (ราคาปกติ อิงราคา JERA จริง) + promo_price (ราคาโปรฯ ที่ตั้งขาย) — ต้องเป็นตัวเลขบาทจริง ไม่ใช่คำกว้างๆ** · price_note = อธิบายสั้นๆ (เช่น "แพ็ก 10 ครั้ง ฿37,900 จากปกติ ฿45,000 ประหยัด ฿7,100")
- **⛔ GUARDRAIL กำไรขั้นต่ำ: ${mgTxt} — ห้ามตั้ง promo_price ต่ำกว่าเพดานนี้เด็ดขาด (ถ้าโปรฯ ไหนต้องลดแรงกว่านี้ ให้เปลี่ยนกลไกเป็นแถม/มูลค่าเพิ่มแทนการลดราคา)**
- ราคาทั้งหมดอิง **ราคาคอร์สปัจจุบันจาก JERA** ด้านล่าง (ราคาล่าสุดหลังปรับขึ้น) — ห้ามใช้ราคาเฉลี่ยย้อนหลัง (เก่า)
- **⚠️ สำคัญเรื่อง margin คอร์ส: ราคาคอร์ส = "หั่นส่วนลดจากราคารายครั้งมาแล้ว" (ซื้อคอร์ส ฿/ครั้ง ถูกกว่ารายครั้งอยู่แล้ว — ดูในรายการ [N ครั้ง ≈ ฿/ครั้งในคอร์ส] เทียบกับ "ราคารายครั้ง") → การลดราคาคอร์สลงอีก = หั่น margin ซ้ำซ้อน อันตราย** · สำหรับโปรฯ คอร์ส **ให้เลี่ยงการตัดราคา ใช้กลไก "แถมครั้ง / แถมบริการเสริม / ของแถม" แทน** · ถ้าจำเป็นต้องลดราคา effective ฿/ครั้ง ของโปรฯ ต้องไม่ต่ำกว่าต้นทุน/ครั้ง · โปรฯ "รายครั้ง/ทดลองครั้งแรก" ให้อิงราคารายครั้งจริง
- เลือก channel ของโปรฯ จากข้อมูล "ภาพรวมทุกช่องทาง" (ช่องไหน ฿/แชทถูก/ครีเอทีฟไหนได้ผล)
- อ้างอิงตัวเลขจริงจากข้อมูลด้านล่างในช่อง rationale เสมอ ห้ามแต่งตัวเลขเอง
- ข้อกฎหมายโฆษณาสถานพยาบาลไทย: ห้ามโอ้อวดเกินจริง/รับประกันผลการรักษา/ใช้ถ้อยคำลดแลกแจกแถมการรักษาแบบเร้าใจเกินงาม → ออกแบบเป็นแพ็กเกจ/คุณค่าเพิ่ม เลี่ยงคำต้องห้าม
- ตอบภาษาไทย กระชับ ใช้ได้จริง

[ข้อมูลรายได้+คนไข้ใหม่รายแผนก (3 เดือนล่าสุด: ${months.join(", ")})]
${depTxt}

[ช่องทางคนไข้ใหม่ รวมทุกเดือน] ${chTxt}

[ต้นทุนต่อแชท รายแบรนด์]
${brandTxt}

[ราคาคอร์สปัจจุบันจาก JERA (ราคาล่าสุด/หลังปรับขึ้นแล้ว) — ✅ ใช้ราคานี้ในการตั้ง price_note]
${gpriceTxt || "(ไม่มีข้อมูลราคาปัจจุบัน)"}

[บริการ/คอร์สขายดีจริง (3 เดือนล่าสุด · เรียงตามรายได้ · = ของที่คลินิกมีจริง ใช้เสนอโปรฯ ได้เท่านั้น · ดูว่า "อะไรขายดี" จากจำนวนครั้ง)]
${bestTxt || "(ไม่มีข้อมูลขายดี)"}

${salesTxt ? "[ยอดขายรวม] " + salesTxt + "\n" : ""}
[ปฏิทินเทศกาล/ซีซั่นที่กำลังมา (วันนี้เดือน ${ssn.mm}) — ออกแบบโปรฯ ให้เกาะเทศกาล/ฤดูกาลที่ใกล้ที่สุด]
${ssn.txt}

${gchanBlock}

[สำหรับทีมงาน (ห้ามใส่ตัวเลขต้นทุน/กำไรในฟิลด์เหล่านี้ — พนักงานจะเห็น)]
- staff_reason: เหตุผลที่ควรดันโปรฯ นี้ "เชิงโอกาส/ดีมานด์/ฤดูกาล/ความต้องการคนไข้" (ไม่ใช่เหตุผลต้นทุน/กำไร)
- content_angle: แนวออกแบบคอนเทนต์/ครีเอทีฟ (hook, รูปแบบ video/ภาพ, ข้อความหลัก) อิงครีเอทีฟที่ได้ผลจากข้อมูล FB ด้านบน
- target_audience: ควรยิงกลุ่มไหนถึงปิดการขายได้ (อายุ/อาการ/พฤติกรรม + กลุ่ม FB/ช่องทาง) อิงข้อมูลคนไข้ใหม่ (แผนกที่ดึงคนใหม่ + ช่องทางคนไข้ใหม่)
- sales_how: หน้าบ้านต้องขาย/พิตช์/ปิดการขายยังไง (สคริปต์สั้น + จังหวะเสนอ)

ส่งคืนเป็น JSON: { "promos": [ { category, dept(กระดูกและข้อ/กายภาพ/พิลาทิส/นวด/ผสม), season(ชื่อเทศกาล/ซีซั่นที่เกาะ ถ้าไม่ผูกเทศกาลใส่ ""), title, target, mechanic, normal_price(บาท อิง JERA · ถ้าแพ็ก 2 ตัว=ผลรวม), promo_price(บาท · ไม่ต่ำกว่าเพดานแผนก), price_note, rationale(เหตุผลเชิงตัวเลข/การเงิน + ทำไม 2 SKU เข้ากัน — สำหรับผู้บริหาร), staff_reason, content_angle, target_audience, sales_how, channel, kpi, est_impact } ] }`;

      const schema = {
        type: "object",
        properties: {
          promos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string", enum: ["instore", "acquisition"] },
                dept: { type: "string", enum: ["กระดูกและข้อ", "กายภาพ", "พิลาทิส", "นวด", "ผสม"] },
                season: { type: "string" },
                title: { type: "string" }, target: { type: "string" }, mechanic: { type: "string" },
                normal_price: { type: "number" }, promo_price: { type: "number" },
                price_note: { type: "string" }, rationale: { type: "string" }, channel: { type: "string" },
                kpi: { type: "string" }, est_impact: { type: "string" },
                staff_reason: { type: "string" }, content_angle: { type: "string" }, target_audience: { type: "string" }, sales_how: { type: "string" },
              },
              required: ["category", "title", "target", "mechanic", "promo_price", "rationale", "staff_reason", "target_audience", "sales_how", "kpi"],
            },
          },
        },
        required: ["promos"],
      };

      let gr: Response;
      try { const b = await gemBest({ temperature: 0.75, topP: 0.97, maxOutputTokens: 16384, responseMimeType: "application/json", responseSchema: schema, thinkingConfig: { thinkingBudget: 4096 } }, prompt); gr = b.res; }
      catch { return json({ ok: false, error: "AI ใช้เวลานานเกินไป (timeout) ลองใหม่อีกครั้ง" }, 200); }
      const gd = await gr.json();
      if (!gr.ok) return json({ ok: false, error: "Gemini error" }, 200);
      let raw = (gd?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "{}").trim();
      if (raw.startsWith("```")) raw = raw.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "").trim();
      let parsed: any = {}; try { parsed = JSON.parse(raw); } catch { return json({ ok: false, error: "parse error", finish: gd?.candidates?.[0]?.finishReason || "" }, 200); }
      const list = Array.isArray(parsed.promos) ? parsed.promos : [];
      if (!list.length) return json({ ok: false, error: "AI ไม่ได้เสนอโปรฯ ลองใหม่อีกครั้ง" }, 200);

      const mode = await getMode(sql);
      const initStatus = mode === "auto" ? "active" : "draft";
      const batch = new Date().toISOString();
      const inserted: any[] = [];
      for (const p of list) {
        const cat = p.category === "acquisition" ? "acquisition" : "instore";
        const dept = DEPTS.includes(p.dept) ? p.dept : "";
        const ratio = deptRatio(mg, dept);            // ต้นทุน% ของแผนกนั้น
        const maxD = deptMaxDisc(mg, dept);           // เพดานส่วนลดของแผนกนั้น
        let np = p.normal_price != null ? Number(p.normal_price) || 0 : 0;
        let pp = p.promo_price != null ? Number(p.promo_price) || 0 : 0;
        // ⛔ บังคับเพดานส่วนลดรายแผนก: promo_price ต้อง >= floor เพื่อคง margin >= min
        if (np > 0 && pp > 0) {
          const floor = Math.ceil(np * (1 - maxD));
          if (pp < floor) pp = floor;
        }
        // margin หลังหักต้นทุน (ต้นทุน = ราคาปกติ × ratio ของแผนก · คงที่ต่อคอร์ส)
        let marginPct: number | null = null;
        if (pp > 0 && np > 0) marginPct = +(((pp - np * ratio) / pp).toFixed(3));
        const row = await sql`insert into public.promo_ideas
          (batch, category, dept, season, title, target, mechanic, normal_price, promo_price, margin_pct, price_note, rationale, channel, kpi, est_impact,
           staff_reason, content_angle, target_audience, sales_how, status, source)
          values (${batch}, ${cat}, ${dept || null}, ${String(p.season || "").slice(0, 80) || null}, ${String(p.title || "").slice(0, 200)}, ${String(p.target || "").slice(0, 300)},
            ${String(p.mechanic || "").slice(0, 400)}, ${np || null}, ${pp || null}, ${marginPct},
            ${String(p.price_note || "").slice(0, 200)},
            ${String(p.rationale || "").slice(0, 800)}, ${String(p.channel || "").slice(0, 200)},
            ${String(p.kpi || "").slice(0, 200)}, ${String(p.est_impact || "").slice(0, 300)},
            ${String(p.staff_reason || "").slice(0, 600)}, ${String(p.content_angle || "").slice(0, 600)}, ${String(p.target_audience || "").slice(0, 600)}, ${String(p.sales_how || "").slice(0, 600)},
            ${initStatus}, 'ai')
          returning *`;
        inserted.push(row[0]);
      }
      return json({ ok: true, mode, batch, count: inserted.length, promos: inserted, months, guard: mg });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    return json({ ok: false, error: "internal error" }, 500);
  } finally { if (sql) await sql.end(); }
});
