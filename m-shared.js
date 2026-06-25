// m-shared.js — โค้ดร่วมของทุกหน้ามือถือพนักงาน (identity · session · api · header)
// ใช้:  import { ID, $, sb, api, mountHead, requireSession, block, esc } from './m-shared.js';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SB_URL = "https://iyldrlzhftylewstfmsg.supabase.co";
export const ANON   = "sb_publishable_jLTyhyQ60OBRiT7CATCNDg_7bhmMrCK";
export const sb = createClient(SB_URL, ANON);
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// ตัวตนจาก LINE login (login.html เก็บไว้ใน localStorage)
export let ID = null;
try { ID = JSON.parse(localStorage.getItem('yy_line_id') || 'null'); } catch (e) { ID = null; }

// แสดงกล่องบล็อก (ยังไม่ล็อกอิน / ระบบไม่พร้อม) + ซ่อน #app
export function block(html) {
  let b = $('block');
  if (!b) { b = document.createElement('div'); b.id = 'block'; document.body.appendChild(b); }
  b.innerHTML = '<div class="warn">' + html + '</div>';
  b.style.display = 'block';
  const a = $('app'); if (a) a.style.display = 'none';
}

export async function token() {
  return (await sb.auth.getSession()).data.session?.access_token;
}

// เรียก edge fn (แนบ session token + apikey) · go-live: เติม x-line-token ที่นี่ที่เดียวพอ
export async function api(path, body) {
  const t = await token();
  const headers = { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', apikey: ANON };
  if (ID && ID.line_token) headers['x-line-token'] = ID.line_token;  // hardening: ใช้เมื่อ LIFF live
  const r = await fetch(SB_URL + '/functions/v1/' + path, {
    method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

// วาง header แบรนด์ (gradient) บนสุดของ body — เรียกครั้งเดียวต่อหน้า
export function mountHead(title) {
  const who = (ID && (ID.employee_name || ID.display_name)) || '';
  const sub = ID && ID.employee_id ? who + ' · ' + esc(ID.employee_id) : who;
  const h = document.createElement('div');
  h.className = 'head';
  h.innerHTML = '<div class="eb">YIAOYA · HR</div><h1>' + esc(title) + '</h1><div class="who" id="who">' + esc(sub) + '</div>';
  document.body.insertBefore(h, document.body.firstChild);
}

// เช็คตัวตน + ensure Supabase session (anonymous) · คืน true ถ้าพร้อมใช้งาน
export async function requireSession() {
  if (!ID || !ID.employee_id) {
    block('ยังไม่ได้เข้าระบบ — กรุณาเข้าผ่าน LINE ก่อน<br><a class="lk" href="login.html">เข้าสู่ระบบด้วย LINE →</a>');
    return false;
  }
  let { data: s } = await sb.auth.getSession();
  if (!s.session) {
    const r = await sb.auth.signInAnonymously();
    if (r.error) { block('ระบบยังไม่เปิด anonymous sign-in<br><small>แจ้งแอดมินเปิดใน Supabase → Auth</small>'); return false; }
  }
  const a = $('app'); if (a) a.style.display = 'block';
  return true;
}
