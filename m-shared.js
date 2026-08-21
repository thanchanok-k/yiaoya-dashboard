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

/* ═══════════════════════════════════════════════════════════════════════
   ปุ่มแจ้งปัญหา — ให้ทุกหน้ามือถือมีเหมือนระบบสต็อก (เจ้าของสั่ง 21 ส.ค. 69)
   ทำที่ตัวกลางที่เดียว ทุกหน้าเรียก mountFeedback() บรรทัดเดียวจบ

   วงจรเดียวกับที่ใช้ทั้งระบบ: แจ้ง → ทีมแก้ + เขียนอธิบายกลับ → ผู้แจ้งกดยืนยัน
   หรือตีกลับพร้อมแนบรูป · ★ ตีกลับ = ล้างตราแจ้งเตือน ให้แจ้งซ้ำได้เมื่อแก้รอบสอง
   ═══════════════════════════════════════════════════════════════════════ */

const FB_CATS = [['bug','ใช้ไม่ได้'], ['slow','ช้า'], ['suggest','อยากให้เพิ่ม'], ['other','อื่น ๆ']];
const FB_ST   = { new:'รอรับเรื่อง', in_progress:'กำลังแก้', fixed:'แก้แล้ว รอเช็ค', verified:'ยืนยันแล้ว' };
const FB_MAX_IMG = 3;

/** ย่อรูปก่อนส่ง — มือถือถ่ายมาไฟล์ใหญ่มาก ส่งดิบจะช้าและเปลืองที่เก็บ */
function fbShrink(file) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = (e) => {
      const im = new Image();
      im.onload = () => {
        let w = im.width, h = im.height; const max = 1280;
        if (w > max) { h = Math.round(h * max / w); w = max; }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(im, 0, 0, w, h);
        res(c.toDataURL('image/jpeg', 0.8));
      };
      im.onerror = () => res(null);
      im.src = e.target.result;
    };
    r.onerror = () => res(null);
    r.readAsDataURL(file);
  });
}

/** dataURL → File เพื่ออัปเข้าที่เก็บเดียวกับหน้าเดสก์ท็อป (โฟลเดอร์ = uid ของคนแจ้ง) */
async function fbUpload(dataUrls) {
  if (!dataUrls.length) return [];
  const { data: u } = await sb.auth.getUser();
  const uid = u && u.user && u.user.id;
  if (!uid) return [];
  const out = [];
  for (let i = 0; i < dataUrls.length; i++) {
    const blob = await (await fetch(dataUrls[i])).blob();
    const path = uid + '/' + Date.now() + '_' + i + '.jpg';
    const { error } = await sb.storage.from('feedback').upload(path, blob, { contentType: 'image/jpeg' });
    if (!error) out.push({ path, name: 'รูป' + (i + 1) + '.jpg', type: 'image/jpeg', size: blob.size });
    // อัปไม่สำเร็จ = ส่งต่อโดยไม่มีรูปนั้น ห้าม block การแจ้ง (ข้อความสำคัญกว่ารูป)
  }
  return out;
}

export function mountFeedback(viewKey, viewLabel) {
  if (!ID || !ID.employee_id) return;          // ยังไม่ล็อกอิน = ไม่ต้องมีปุ่ม
  if (document.getElementById('yfbBtn')) return;

  const st = document.createElement('style');
  st.textContent = `
    #yfbBtn{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));z-index:80;
      background:#0D2F4F;color:#fff;border:0;border-radius:999px;padding:11px 17px;font:700 13px/1 inherit;
      box-shadow:0 6px 20px -6px rgba(13,47,79,.55);cursor:pointer}
    #yfbSheet{position:fixed;inset:0;z-index:90;background:rgba(15,23,42,.45);display:none;align-items:flex-end}
    #yfbSheet.on{display:flex}
    #yfbCard{background:#fff;width:100%;max-height:88vh;overflow:auto;border-radius:16px 16px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom))}
    #yfbCard h3{margin:0 0 12px;font-size:16px;color:#0D2F4F}
    .yfb-tabs{display:flex;gap:8px;margin-bottom:12px}
    .yfb-tabs button{flex:1;border:1.5px solid #E2E8F0;background:#fff;color:#475569;border-radius:10px;
      padding:9px;font:700 13px/1 inherit;cursor:pointer}
    .yfb-tabs button.on{background:#0D2F4F;color:#fff;border-color:#0D2F4F}
    .yfb-cats{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px}
    .yfb-cats button{border:1.5px solid #E2E8F0;background:#fff;color:#475569;border-radius:20px;
      padding:6px 13px;font:600 12.5px/1 inherit;cursor:pointer}
    .yfb-cats button.on{background:#0D2F4F;color:#fff;border-color:#0D2F4F}
    #yfbMsg{width:100%;box-sizing:border-box;border:1.5px solid #E2E8F0;border-radius:10px;padding:11px;
      font:400 15px/1.5 inherit;resize:vertical;min-height:88px}
    .yfb-pick{display:inline-block;border:1.5px dashed #CBD5E1;border-radius:10px;padding:8px 13px;
      font:600 12.5px/1 inherit;color:#475569;cursor:pointer;margin-top:9px}
    .yfb-th{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}
    .yfb-th img{height:62px;border-radius:8px;border:1px solid #E2E8F0;object-fit:cover;display:block}
    .yfb-th button{font:600 11px/1 inherit;color:#DC2626;background:none;border:0;cursor:pointer;margin-top:3px}
    .yfb-go{width:100%;margin-top:13px;background:#0D2F4F;color:#fff;border:0;border-radius:11px;
      padding:13px;font:700 14px/1 inherit;cursor:pointer}
    .yfb-go[disabled]{opacity:.55}
    .yfb-item{border:1px solid #E7EDF2;border-radius:11px;padding:12px;margin-bottom:9px}
    .yfb-chip{display:inline-block;font:700 10.5px/1 inherit;padding:4px 9px;border-radius:20px;
      background:#EEF2F6;color:#475569;margin-bottom:6px}
    .yfb-fix{background:#F6FAF9;border-left:3px solid #3DC5B7;border-radius:0 8px 8px 0;padding:9px 11px;
      margin-top:8px;font-size:12.5px;color:#334155}
    .yfb-acts{display:flex;gap:7px;margin-top:9px}
    .yfb-acts button{flex:1;border-radius:9px;padding:9px;font:700 12.5px/1 inherit;cursor:pointer}
    .yfb-ok{background:#15803D;color:#fff;border:0}
    .yfb-no{background:#fff;color:#B91C1C;border:1.5px solid #FCA5A5}
    .yfb-msg{font-size:12.5px;margin-top:8px;min-height:16px}
    .yfb-err{color:#B91C1C}`;
  document.head.appendChild(st);

  const btn = document.createElement('button');
  btn.id = 'yfbBtn'; btn.type = 'button'; btn.textContent = 'แจ้งปัญหา';
  document.body.appendChild(btn);

  const sheet = document.createElement('div');
  sheet.id = 'yfbSheet';
  sheet.innerHTML = '<div id="yfbCard"></div>';
  document.body.appendChild(sheet);
  sheet.onclick = (e) => { if (e.target === sheet) sheet.classList.remove('on'); };

  const card = () => document.getElementById('yfbCard');
  let tab = 'form', cat = 'bug', imgs = [], busy = false;

  function shell(inner) {
    card().innerHTML =
      '<h3>' + esc(viewLabel || 'แจ้งปัญหา') + '</h3>' +
      '<div class="yfb-tabs">' +
        '<button id="yfbT1" class="' + (tab === 'form' ? 'on' : '') + '">แจ้งปัญหา</button>' +
        '<button id="yfbT2" class="' + (tab === 'list' ? 'on' : '') + '">รายการที่แจ้งไว้</button>' +
      '</div>' + inner;
    document.getElementById('yfbT1').onclick = () => { tab = 'form'; drawForm(); };
    document.getElementById('yfbT2').onclick = () => { tab = 'list'; drawList(); };
  }

  function drawThumbs() {
    const w = document.getElementById('yfbTh'); if (!w) return;
    w.innerHTML = imgs.map((u, i) =>
      '<div><img src="' + u + '" alt="รูปที่แนบ ' + (i + 1) + '"><br><button data-i="' + i + '">ลบรูป</button></div>').join('');
    w.querySelectorAll('button').forEach((b) => b.onclick = () => { imgs.splice(+b.dataset.i, 1); drawThumbs(); });
    const p = document.getElementById('yfbPick'); if (p) p.style.display = imgs.length >= FB_MAX_IMG ? 'none' : 'inline-block';
  }

  function drawForm() {
    shell(
      '<div class="yfb-cats">' + FB_CATS.map((c) =>
        '<button data-c="' + c[0] + '" class="' + (c[0] === cat ? 'on' : '') + '">' + c[1] + '</button>').join('') + '</div>' +
      '<textarea id="yfbMsg" placeholder="เจอปัญหาอะไรคะ เล่าให้ฟังได้เลย"></textarea>' +
      '<label class="yfb-pick" id="yfbPick">แนบรูปหน้าจอ (ได้ ' + FB_MAX_IMG + ' รูป)' +
        '<input type="file" accept="image/*" multiple hidden id="yfbFile"></label>' +
      '<div class="yfb-th" id="yfbTh"></div>' +
      '<button class="yfb-go" id="yfbGo">ส่งให้ทีมระบบ</button>' +
      '<div class="yfb-msg" id="yfbM"></div>');
    card().querySelectorAll('.yfb-cats button').forEach((b) => b.onclick = () => { cat = b.dataset.c; drawForm(); });
    document.getElementById('yfbFile').onchange = async (e) => {
      const fs = [...e.target.files]; e.target.value = '';
      for (const f of fs) {
        if (imgs.length >= FB_MAX_IMG) break;
        const u = await fbShrink(f); if (u) imgs.push(u);
      }
      drawThumbs();
    };
    drawThumbs();
    document.getElementById('yfbGo').onclick = send;
  }

  async function send() {
    if (busy) return;
    const m = document.getElementById('yfbMsg').value.trim();
    const box = document.getElementById('yfbM');
    if (!m) { box.className = 'yfb-msg yfb-err'; box.textContent = 'พิมพ์ข้อความก่อนนะคะ'; return; }
    busy = true;
    const go = document.getElementById('yfbGo'); go.disabled = true; go.textContent = 'กำลังส่ง…';
    box.className = 'yfb-msg'; box.textContent = '';
    try {
      const attachments = await fbUpload(imgs);
      const { error } = await sb.from('trial_feedback').insert({
        source: 'dashboard', view_key: viewKey || 'mobile',
        view_label: viewLabel || viewKey || 'มือถือ',
        page_url: location.pathname.slice(0, 300),
        category: cat, message: m,
        reporter_name: (ID && (ID.employee_name || ID.display_name)) || 'ผู้ใช้',
        reporter_key: (ID && ID.employee_id) || null,
        reporter_role: (ID && ID.role) || null,
        attachments,
      });
      if (error) throw error;
      imgs = [];
      card().innerHTML = '<h3>ส่งแล้วค่ะ</h3>'
        + '<p style="color:#475569;font-size:14px;line-height:1.6">ทีมระบบจะดูให้แล้วเขียนอธิบายกลับมา '
        + 'พอแก้เสร็จจะขึ้นในแท็บ “รายการที่แจ้งไว้” ให้กดยืนยันว่าใช้ได้ไหมค่ะ</p>'
        + '<button class="yfb-go" id="yfbClose">ปิด</button>';
      document.getElementById('yfbClose').onclick = () => { sheet.classList.remove('on'); tab = 'form'; };
    } catch (e) {
      box.className = 'yfb-msg yfb-err';
      box.textContent = 'ส่งไม่สำเร็จ: ' + (e.message || e);
      go.disabled = false; go.textContent = 'ส่งให้ทีมระบบ';
    }
    busy = false;
  }

  async function drawList() {
    shell('<div id="yfbL" style="color:#64748B;font-size:13px">กำลังโหลด…</div>');
    const { data: u } = await sb.auth.getUser();
    const uid = u && u.user && u.user.id;
    const { data, error } = await sb.from('trial_feedback')
      .select('id,category,view_label,message,status,fix_note,created_at,reporter_uid')
      .order('created_at', { ascending: false }).limit(60);
    const L = document.getElementById('yfbL'); if (!L) return;
    if (error) { L.className = 'yfb-err'; L.textContent = 'โหลดไม่ได้: ' + error.message; return; }
    const mine = (data || []).filter((r) => r.reporter_uid === uid);
    if (!mine.length) { L.textContent = 'ยังไม่เคยแจ้งอะไรไว้ค่ะ'; return; }
    L.className = '';
    L.innerHTML = mine.map((r) =>
      '<div class="yfb-item" data-id="' + r.id + '">' +
        '<span class="yfb-chip">#' + r.id + ' · ' + esc(FB_ST[r.status] || r.status) + '</span>' +
        '<div style="font-size:14px;color:#0D2F4F;line-height:1.55;white-space:pre-wrap">' + esc(r.message) + '</div>' +
        (r.fix_note ? '<div class="yfb-fix"><b>ทีมแก้แล้ว:</b> ' + esc(r.fix_note) + '</div>' : '') +
        (r.status === 'fixed'
          ? '<div class="yfb-acts"><button class="yfb-ok" data-a="verify" data-id="' + r.id + '">โอเค ใช้ได้แล้ว</button>'
            + '<button class="yfb-no" data-a="reopen" data-id="' + r.id + '">ยังไม่โอเค</button></div>'
            + '<div class="yfb-msg" id="yfbR' + r.id + '"></div>'
          : '') +
      '</div>').join('');
    L.querySelectorAll('button[data-a]').forEach((b) => b.onclick = () => act(b));
  }

  async function act(b) {
    const id = +b.dataset.id, a = b.dataset.a;
    const box = document.getElementById('yfbR' + id);
    b.disabled = true; b.textContent = 'กำลังบันทึก…';
    const patch = a === 'verify'
      ? { status: 'verified', verified_at: new Date().toISOString() }
      : { status: 'new', fixed_at: null, notified_fixed_at: null };
    // ★ ต้องรู้ว่าเขียนติดจริงไหม — สิทธิ์ไม่ผ่านจะได้ 0 แถวโดยไม่มี error
    const { data: done, error } = await sb.from('trial_feedback').update(patch).eq('id', id).select('id');
    if (error || !done || !done.length) {
      box.className = 'yfb-msg yfb-err';
      box.textContent = error ? ('ไม่สำเร็จ: ' + error.message) : 'ใบนี้ไม่ใช่ของคุณค่ะ';
      b.disabled = false; b.textContent = a === 'verify' ? 'โอเค ใช้ได้แล้ว' : 'ยังไม่โอเค';
      return;
    }
    await sb.from('trial_feedback_log').insert({
      feedback_id: id, kind: 'status', to_status: patch.status,
      actor_name: (ID && (ID.employee_name || ID.display_name)) || 'ผู้ใช้',
      note: a === 'verify' ? 'ยืนยันว่าใช้ได้แล้ว' : 'ยังไม่โอเค เปิดเรื่องใหม่',
    });
    drawList();
  }

  btn.onclick = () => { sheet.classList.add('on'); tab === 'list' ? drawList() : drawForm(); };
}
