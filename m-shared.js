// m-shared.js — โค้ดร่วมของทุกหน้ามือถือพนักงาน (identity · session · api · header)
// ใช้:  import { ID, $, sb, api, mountHead, requireSession, block, esc } from './m-shared.js';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SB_URL = "https://iyldrlzhftylewstfmsg.supabase.co";
export const ANON   = "sb_publishable_jLTyhyQ60OBRiT7CATCNDg_7bhmMrCK";
export const sb = createClient(SB_URL, ANON);
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

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
  const out = await r.json().catch(() => ({ error: 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง' }));
  // ★ 21 ส.ค. 69 — จับอาการ "เซสชันใช้ไม่ได้" ที่ตัวกลางนี้ที่เดียว ครอบทุกหน้า
  //   เดิมแต่ละหน้าเอา error ดิบไปโชว์ ผู้ใช้เห็น "บัญชีนี้ยังไม่ได้ผูกกับพนักงาน"
  //   แล้วเข้าใจว่าตัวเองไม่มีสิทธิ์ ทั้งที่ความจริงคือแค่ต้องเข้าระบบใหม่
  if (out && out.error && isSessionError(out.error)) blockRelogin('เข้าระบบใหม่อีกครั้งนะคะ');
  return out;
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

/**
 * เช็คว่าพร้อมใช้งานจริงไหม · คืน true ถ้าใช่
 *
 * ★★ แก้ 21 ส.ค. 69 — มายแจ้งว่าเข้าไม่ได้ ทั้งที่หน้าจอโชว์ชื่อและรหัสเธอถูกต้อง
 *   สาเหตุ: เดิมถ้าไม่มี session จะ "สร้างบัญชีชั่วคราวแบบไม่ระบุตัวตน" ให้เงียบ ๆ
 *   แต่ทั้งระบบผูกสิทธิ์ไว้กับบัญชีจริงที่ล็อกอินผ่าน LINE (ตาราง app_staff)
 *   บัญชีชั่วคราวจึง **ไม่มีทางผ่านด่านได้เลย** — เซิร์ฟเวอร์ตอบว่า "ยังไม่ได้ผูกกับพนักงาน"
 *   ส่วนชื่อบนหัวจอมาจากที่จำไว้ในเครื่อง ซึ่งอยู่คนละที่กับ session → เลยดูเหมือนล็อกอินอยู่
 *   ผลข้างเคียง: สร้างบัญชีขยะทิ้งไว้แล้ว 110 บัญชี
 *
 *   ตอนนี้: ไม่มี session = บอกตรง ๆ ว่าหมดอายุ แล้วให้เข้าใหม่ · ไม่สร้างบัญชีชั่วคราวอีก
 */
export async function requireSession() {
  if (!ID || !ID.employee_id) {
    block('ยังไม่ได้เข้าระบบ — กรุณาเข้าผ่าน LINE ก่อน<br><a class="lk" href="login.html">เข้าสู่ระบบด้วย LINE →</a>');
    return false;
  }
  const { data: s } = await sb.auth.getSession();
  if (!s.session) {
    block('เซสชันหมดอายุแล้ว — กรุณาเข้าระบบใหม่<br>'
        + '<small>ชื่อที่ขึ้นด้านบนเป็นข้อมูลที่เครื่องจำไว้ ไม่ใช่การเข้าระบบ</small><br>'
        + '<a class="lk" href="login.html">เข้าสู่ระบบด้วย LINE →</a>');
    return false;
  }
  const a = $('app'); if (a) a.style.display = 'block';
  return true;
}

/**
 * เรียกเมื่อเซิร์ฟเวอร์ตอบว่าบัญชีไม่ผูกกับพนักงาน — เป็นอาการของเซสชันเพี้ยน
 * ไม่ใช่เรื่องสิทธิ์ จึงต้องบอกให้เข้าใหม่ ไม่ใช่โยนข้อความดิบให้ผู้ใช้งง
 */
export function blockRelogin(msg) {
  block((msg || 'เข้าระบบไม่สำเร็จ') + '<br>'
      + '<small>ลองเข้าระบบใหม่อีกครั้ง ถ้ายังไม่ได้แจ้งทีมระบบ</small><br>'
      + '<a class="lk" href="login.html">เข้าสู่ระบบด้วย LINE →</a>');
}

/** ข้อความที่แปลว่า "เซสชันใช้ไม่ได้" ไม่ใช่ "ไม่มีสิทธิ์" */
export function isSessionError(err) {
  const t = String(err || '');
  return t.indexOf('ยังไม่ได้ผูกกับพนักงาน') >= 0 || t.indexOf('ต้องเข้าระบบก่อน') >= 0;
}
