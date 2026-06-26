#!/usr/bin/env python3
"""ดึง "ราคาปัจจุบัน" ของคอร์ส/บริการ จาก JERA (ราคาสูงสุดที่ขายใน 90 วันล่าสุด = ราคาหลังปรับขึ้น)
   → push Supabase jera_prices (ไม่เก็บ PII · code+name+price+kind)"""
import jera_client as J, json, urllib.request, urllib.error, datetime
from pull_dept_sales import dept as map_dept  # map code/ชื่อ → แผนก (logic เดียวกับ dept_sales)
BR = "b5b80773-c7c2-5676-af68-96ba89661d25"
ENDPOINT = "https://iyldrlzhftylewstfmsg.supabase.co/functions/v1/prices_sync"
SECRET = "hub_a9Kx72mQp4Lz"
HUB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5bGRybHpoZnR5bGV3c3RmbXNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwOTQ0MDUsImV4cCI6MjA5NzY3MDQwNX0.jeKS9W5AdzTnvQ7TelBWqfaFG8g3Cf0EOMtL0S4nOrA"

def num(x):
    try: return float(x)
    except: return 0.0

def pull(days=90):
    end = datetime.date.today(); start = end - datetime.timedelta(days=days)
    s, e = start.isoformat(), end.isoformat()
    best = {}  # code -> {code,name,price,kind}  ราคาสูงสุด/รายการ = ราคาเต็ม (กันส่วนลดทำให้ต่ำ)
    st, cs = J.get('/openapi/v1/report/course-sales/', branch_uuid=BR, start_date=s, end_date=e)
    for r in (cs or []):
        code = r.get('course_code') or r.get('course_name')
        if not code: continue
        pr = num(r.get('price'))
        cur = best.get(str(code))
        if pr > 0 and (cur is None or pr > cur['price']):
            best[str(code)] = {"code": str(code), "name": r.get('course_name') or str(code), "price": pr, "kind": "course",
                               "dept": map_dept(r.get('course_code'), r.get('patient_type'), r.get('course_name'))}
    # service (รายครั้ง) จาก product-sale = report aggregate · sum_amount = จำนวนครั้งที่ขาย
    # ราคารายครั้ง = paid_amount/sum_amount · cost = ต้นทุน "ตรง" จาก JERA (อ้างอิง = ค่ายา/หัตถการ ไม่รวม overhead
    #   → margin guardrail เอา cost ตรงนี้ + จัดสรร overhead จากการเงินมารวม)
    COST_KEYS = ['medicine_cost', 'medicinetask_cost', 'service_medicine_cost', 'servicetask_cost', 'service_other_cost', 'commission_cost', 'other_cost']
    st, sv = J.get('/openapi/v1/report/product-sale/', branch_uuid=BR, start_date=s, end_date=e, type='service')
    sv = sv.get('data', []) if isinstance(sv, dict) else (sv or [])
    for r in sv:
        code = r.get('product_code') or (r.get('action') or r.get('subcat_name'))
        if not code: continue
        qty = num(r.get('sum_amount')); paid = num(r.get('paid_amount'))
        if qty < 1 or paid <= 0: continue
        nm = r.get('action') or r.get('subcat_name') or str(code)
        cost_unit = sum(num(r.get(k)) for k in COST_KEYS) / qty
        best[str(code)] = {"code": str(code), "name": nm, "price": round(paid / qty), "kind": "service",
                           "cost": round(cost_unit), "dept": map_dept(r.get('product_code'), None, nm)}
    return list(best.values())

def push(rows):
    body = json.dumps({"action": "put", "secret": SECRET, "replace": True, "rows": rows}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json", "Authorization": "Bearer " + HUB_ANON}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:300]

if __name__ == "__main__":
    rows = pull()
    courses = [r for r in rows if r['kind'] == 'course']; services = [r for r in rows if r['kind'] == 'service']
    print(f"pulled {len(rows)} ราคา (course {len(courses)} · service {len(services)})")
    for r in sorted(rows, key=lambda x: -x['price'])[:10]:
        print(f"  {r['kind']:7} {r['name'][:40]:42} ฿{r['price']:,.0f}")
    st, resp = push(rows)
    print("push", st, resp)
