// m-shared.js — โค้ดร่วมของทุกหน้ามือถือพนักงาน (identity · session · api · header)
// ใช้:  import { ID, $, sb, api, mountHead, requireSession, block, esc } from './m-shared.js?v=202608211329';
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
    block('ยังไม่ได้เข้าระบบ — กรุณาเข้าผ่าน LINE ก่อน<br><a class="lk" href="login.html?v=202608211329">เข้าสู่ระบบด้วย LINE →</a>');
    return false;
  }
  let { data: s } = await sb.auth.getSession();
  // ★ 21 ส.ค. 69 — ไม่มีเซสชัน ไม่ได้แปลว่าต้องให้ผู้ใช้ไปเริ่มใหม่เสมอ
  //   ถ้ายังมีตั๋ว LINE อยู่ ขอเซสชันเองได้เลย (เซสชันไม่ได้ถูกส่งต่อข้ามหน้าเสมอไป)
  if (!s.session && ID.line_token) {
    try {
      // ต้องมีตั๋ว JWT ก่อนถึงเรียก edge function ได้ (คีย์สาธารณะแบบใหม่ไม่ใช่ JWT)
      let temp = false;
      try { const r = await sb.auth.signInAnonymously(); temp = !r.error; } catch (e) { temp = false; }
      const res = await sb.functions.invoke('line_login', { body: { action: 'console_session', access_token: ID.line_token } });
      const d = res.data || {};
      if (d.ok && d.access_token && d.refresh_token) {
        await sb.auth.setSession({ access_token: d.access_token, refresh_token: d.refresh_token });
        s = (await sb.auth.getSession()).data;
      } else if (temp) {
        try { await sb.auth.signOut(); } catch (e) { /* ตั๋วชั่วคราวห้ามค้าง */ }
      }
    } catch (e) { /* ขอเองไม่ได้ = ตกไปที่ข้อความให้เข้าใหม่ด้านล่าง */ }
  }
  if (!s.session) {
    block('เซสชันหมดอายุแล้ว — กรุณาเข้าระบบใหม่<br>'
        + '<small>ชื่อที่ขึ้นด้านบนเป็นข้อมูลที่เครื่องจำไว้ ไม่ใช่การเข้าระบบ</small><br>'
        + '<a class="lk" href="login.html?v=202608211329">เข้าสู่ระบบด้วย LINE →</a>');
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
      + '<a class="lk" href="login.html?v=202608211329">เข้าสู่ระบบด้วย LINE →</a>');
}

/** ข้อความที่แปลว่า "เซสชันใช้ไม่ได้" ไม่ใช่ "ไม่มีสิทธิ์" */
export function isSessionError(err) {
  const t = String(err || '');
  return t.indexOf('ยังไม่ได้ผูกกับพนักงาน') >= 0 || t.indexOf('ต้องเข้าระบบก่อน') >= 0;
}

/* ═══════════════════════════════════════════════════════════════════════
   ปุ่มแจ้งปัญหา — ลอกหน้าตาจากระบบ Lead มาทั้งชุด (เจ้าของสั่ง 21 ส.ค. 69)
   ★ ห้ามออกแบบใหม่ · สี ขนาด ป้ายสถานะ การ์ดรายการ ใช้ชุดเดียวกับ lead_console.html

   ★★ กับดักของหน้ามือถือชุดนี้: m-shared.css มีกฎกลาง button{width:100%;padding:14px;margin-top:16px}
      ทุกปุ่มในนี้จึงต้องระบุ width/padding/margin ทับเองทุกตัว ไม่งั้นจะยืดเต็มจอ
   ═══════════════════════════════════════════════════════════════════════ */

const YFB_CATS = [['bug', 'ใช้งานติดขัด'], ['suggest', 'อยากให้เพิ่ม'], ['other', 'อื่น ๆ']];
const YFB_ST   = { new: 'รอรับเรื่อง', in_progress: 'กำลังแก้', fixed: 'แก้แล้ว รอทีมเทส', verified: 'ยืนยันแล้ว' };
const YFB_STC  = { new: '#FEF3C7|#92400E', in_progress: '#DBEAFE|#1E40AF', fixed: '#D1FAE5|#065F46', verified: '#E2E8F0|#334155' };
const YFB_MAXIMG = 5;

function yfbDate(iso) {
  try {
    const d = new Date(iso); if (isNaN(d)) return '';
    const M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    return d.getDate() + ' ' + M[d.getMonth()] + ' ' + String(d.getFullYear() + 543).slice(-2);
  } catch (e) { return ''; }
}

/** ย่อรูปก่อนส่ง — มือถือถ่ายมาไฟล์ใหญ่ ส่งดิบจะช้าและเปลืองที่เก็บ */
function yfbShrink(file) {
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

/** อัปรูปเข้าที่เก็บเดียวกับหน้าเดสก์ท็อป (โฟลเดอร์ = uid ของคนแจ้ง) */
async function yfbUpload(dataUrls) {
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
  if (!ID || !ID.employee_id) return;              // ยังไม่ล็อกอิน = ไม่ต้องมีปุ่ม
  if (document.getElementById('yfbFab')) return;

  // ★ ทุก selector ต้องชนะกฎกลาง button{width:100%…} จึงระบุ width/padding/margin ทับทุกตัว
  const st = document.createElement('style');
  st.textContent = `
    #yfbFab{position:fixed;right:14px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:99;
      background:#0D2F4F;color:#fff;border-radius:24px;padding:10px 16px;font-size:13px;
      box-shadow:0 4px 12px rgba(0,0,0,.25);cursor:pointer;width:auto;margin:0;font-weight:400}
    #yfbModal{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100;display:none;overflow:auto}
    #yfbModal.on{display:block}
    #yfbBox{background:#fff;border-radius:14px;max-width:420px;margin:8vh auto 24px;padding:16px}
    #yfbBox .yfb-h{font-weight:bold;color:#0D2F4F;margin-bottom:8px;font-size:15px}
    #yfbBox .yfb-tabs{display:flex;gap:6px;background:#F1F5F9;border-radius:11px;padding:4px;margin-bottom:12px}
    #yfbBox .yfb-tabs button{flex:1;border:none;background:transparent;color:#64748B;border-radius:8px;
      padding:8px 6px;font:600 13px/1.2 inherit;cursor:pointer;width:auto;margin:0;box-shadow:none}
    #yfbBox .yfb-tabs button.on{background:#fff;color:#0D2F4F;box-shadow:0 1px 3px rgba(15,23,42,.12)}
    #yfbBox .yfb-opts{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
    #yfbBox .yfb-op{font-size:14px;padding:8px 13px;border-radius:8px;border:1px solid #E2E8F0;
      color:#64748B;background:#fff;cursor:pointer;display:inline-block}
    #yfbBox .yfb-op.on{background:#E6F7F5;border-color:#3DC5B7;color:#0F766E;font-weight:600}
    #yfbBox textarea{width:100%;box-sizing:border-box;border:1px solid #E2E8F0;border-radius:8px;padding:8px;
      font-size:13px;font-family:inherit;margin-top:8px}
    #yfbBox .yfb-lbl{font-size:12px;color:#64748B;margin-top:10px}
    #yfbBox .yfb-thumb{position:relative;display:inline-block}
    #yfbBox .yfb-thumb img{height:54px;border-radius:8px;border:1px solid #E2E8F0;object-fit:cover;display:block}
    #yfbBox .yfb-thumb button{position:absolute;top:-6px;right:-6px;background:#B91C1C;color:#fff;border:none;
      border-radius:50%;width:18px;height:18px;font-size:11px;line-height:1;cursor:pointer;padding:0;margin:0}
    #yfbBox .yfb-send{width:100%;padding:12px;background:#0D2F4F;color:#fff;border:none;border-radius:10px;
      font-size:14px;font-weight:700;margin-top:10px;cursor:pointer}
    #yfbBox .yfb-send:disabled{opacity:.55}
    #yfbBox .yfb-sub{font-size:11.5px;color:#94A3B8;margin-top:6px;text-align:center}
    #yfbList{display:none;max-height:60vh;overflow:auto;min-height:120px}
    #yfbList .ack button{width:auto;margin:0;padding:8px 6px}
    #yfbBox .yfb-why{width:100%;box-sizing:border-box;margin-top:7px;border:1.5px solid #E2E8F0;
      border-radius:9px;padding:8px 10px;font-size:13px;font-family:inherit}`;
  document.head.appendChild(st);

  const fab = document.createElement('div');
  fab.id = 'yfbFab'; fab.textContent = 'แจ้งปัญหา/ติชม';
  document.body.appendChild(fab);

  const modal = document.createElement('div');
  modal.id = 'yfbModal';
  modal.innerHTML =
    '<div id="yfbBox">' +
      '<div class="yfb-h">แจ้งปัญหา / ติชม' + (viewLabel ? ' · ' + esc(viewLabel) : '') + '</div>' +
      '<div class="yfb-tabs">' +
        '<button type="button" id="yfbT1" class="on">แจ้งใหม่</button>' +
        '<button type="button" id="yfbT2">รายการที่แจ้งไว้</button>' +
      '</div>' +
      '<div id="yfbList"></div>' +
      '<div id="yfbForm">' +
        '<div class="yfb-opts" id="yfbCats"></div>' +
        '<textarea id="yfbMsg" rows="3" placeholder="เล่าได้เลยค่ะ ทีมพัฒนาอ่านทุกข้อความ"></textarea>' +
        '<div class="yfb-lbl">แนบรูป (ได้หลายรูป · สูงสุด ' + YFB_MAXIMG + ')</div>' +
        '<div class="yfb-opts" id="yfbThumbs"></div>' +
        '<div class="yfb-op" id="yfbAdd" style="display:inline-block">เพิ่มรูป</div>' +
        '<input type="file" id="yfbFile" accept="image/*" multiple style="display:none">' +
        '<button type="button" class="yfb-send" id="yfbSend">ส่งความเห็น</button>' +
        '<div class="yfb-sub" id="yfbSub">แก้แล้วระบบจะแจ้งกลับให้กดยืนยันค่ะ</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('on'); };

  let cat = 'other', imgs = [], busy = false;

  function drawCats() {
    $('yfbCats').innerHTML = YFB_CATS.map((c) =>
      '<span class="yfb-op' + (c[0] === cat ? ' on' : '') + '" data-c="' + c[0] + '">' + c[1] + '</span>').join('');
    $('yfbCats').querySelectorAll('.yfb-op').forEach((b) => b.onclick = () => { cat = b.dataset.c; drawCats(); });
  }
  function drawThumbs() {
    $('yfbThumbs').innerHTML = imgs.map((u, i) =>
      '<span class="yfb-thumb"><img src="' + u + '" alt="รูปที่แนบ ' + (i + 1) + '">' +
      '<button type="button" data-i="' + i + '">×</button></span>').join('');
    $('yfbThumbs').querySelectorAll('button').forEach((b) =>
      b.onclick = () => { imgs.splice(+b.dataset.i, 1); drawThumbs(); });
    $('yfbAdd').style.display = imgs.length >= YFB_MAXIMG ? 'none' : 'inline-block';
  }
  function tab(which) {
    const isList = which === 'list';
    $('yfbT1').className = isList ? '' : 'on';
    $('yfbT2').className = isList ? 'on' : '';
    $('yfbForm').style.display = isList ? 'none' : 'block';
    $('yfbList').style.display = isList ? 'block' : 'none';
    if (isList) loadList();
  }
  $('yfbT1').onclick = () => tab('form');
  $('yfbT2').onclick = () => tab('list');
  $('yfbAdd').onclick = () => $('yfbFile').click();
  $('yfbFile').onchange = async (e) => {
    const fs = [...e.target.files]; e.target.value = '';
    for (const f of fs) {
      if (imgs.length >= YFB_MAXIMG) break;
      const u = await yfbShrink(f); if (u) imgs.push(u);
    }
    drawThumbs();
  };
  $('yfbSend').onclick = send;

  async function send() {
    if (busy) return;
    const m = $('yfbMsg').value.trim();
    const sub = $('yfbSub');
    if (!m) { sub.style.color = '#B91C1C'; sub.textContent = 'พิมพ์ข้อความก่อนนะคะ'; return; }
    busy = true;
    const btn = $('yfbSend'); btn.disabled = true; btn.textContent = 'กำลังส่ง…';
    sub.style.color = '#94A3B8'; sub.textContent = '';
    try {
      const attachments = await yfbUpload(imgs);
      const { error } = await sb.from('trial_feedback').insert({
        // [ออดิท 27 ส.ค. 69] 'dashboard' เป็นถังรวมเก่าที่ถูกถอดออกจากทุกลูปเช็คแล้ว (แถวเดิม re-source หมด)
        // หน้าตระกูล m-* คือหน้ามือถือฝั่ง HR ที่ทีมใช้จริง → ส่งเข้า hr-liff ให้ลูป "แก้เสร็จ→กดยืนยัน" ไม่ขาด
        source: 'hr-liff', view_key: viewKey || 'mobile',
        view_label: viewLabel || viewKey || 'มือถือ',
        page_url: location.pathname.slice(0, 300),
        category: cat, message: m,
        reporter_name: (ID && (ID.employee_name || ID.display_name)) || 'ผู้ใช้',
        reporter_key: (ID && ID.employee_id) || null,
        reporter_role: (ID && ID.role) || null,
        attachments,
      });
      if (error) throw error;
      imgs = []; $('yfbMsg').value = ''; drawThumbs();
      sub.style.color = '#0F766E';
      sub.textContent = 'ส่งแล้วค่ะ ขอบคุณมาก — แก้เสร็จจะแจ้งกลับให้กดยืนยัน';
    } catch (e) {
      sub.style.color = '#B91C1C';
      sub.textContent = 'ส่งไม่สำเร็จ: ' + (e.message || e);
    }
    btn.disabled = false; btn.textContent = 'ส่งความเห็น';
    busy = false;
  }

  async function loadList() {
    const box = $('yfbList');
    box.innerHTML = '<div style="text-align:center;color:#94A3B8;font-size:13px;padding:28px 8px">กำลังโหลด…</div>';
    const { data: u } = await sb.auth.getUser();
    const uid = u && u.user && u.user.id;
    const { data, error } = await sb.from('trial_feedback')
      .select('id,view_label,message,status,fix_note,created_at,reporter_name,reporter_uid')
      .order('created_at', { ascending: false }).limit(60);
    if (error) {
      box.innerHTML = '<div style="text-align:center;color:#B91C1C;font-size:13px;padding:28px 8px">โหลดไม่ได้: '
        + esc(error.message) + '</div>';
      return;
    }
    const items = (data || []).map((r) => ({ ...r, mine: r.reporter_uid === uid }));
    if (!items.length) {
      box.innerHTML = '<div style="text-align:center;color:#94A3B8;font-size:13px;padding:28px 8px">ยังไม่มีรายการที่แจ้งไว้</div>';
      return;
    }
    box.innerHTML = items.map((it) => {
      const s = String(it.status || 'new');
      const c = (YFB_STC[s] || '#F1F5F9|#475569').split('|');
      return '<div style="border:1px solid ' + (it.mine ? '#0D9E73' : '#E2E8F0') + ';border-radius:12px;padding:11px 12px;margin-bottom:9px;'
        + (it.mine ? 'background:#F3FBF8' : '') + '">'
        + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px">'
        +   '<span style="border-radius:11px;padding:3px 9px;font-size:11px;font-weight:700;background:' + c[0] + ';color:' + c[1] + '">'
        +     esc(YFB_ST[s] || s) + '</span>'
        +   (it.mine ? '<span style="background:#0D9E73;color:#fff;border-radius:9px;padding:2px 7px;font-size:10px;font-weight:700">ของคุณ</span>' : '')
        +   (it.view_label ? '<span style="font-size:11px;color:#64748B;font-weight:600">' + esc(it.view_label) + '</span>' : '')
        + '</div>'
        + '<div style="font-size:13px;color:#0F172A;line-height:1.5;white-space:pre-wrap;word-break:break-word">' + esc(it.message) + '</div>'
        + (it.fix_note ? '<div style="margin-top:7px;background:#F0FDF4;border-left:3px solid #34D399;border-radius:0 8px 8px 0;padding:7px 9px;font-size:12px;color:#065F46;line-height:1.5;white-space:pre-wrap">ทีมระบบ: ' + esc(it.fix_note) + '</div>' : '')
        + '<div style="font-size:11px;color:#94A3B8;margin-top:6px">' + esc(it.reporter_name || 'ไม่ระบุชื่อ') + ' · ' + esc(yfbDate(it.created_at)) + '</div>'
        + ((it.mine && s === 'fixed')
            ? '<div class="ack" style="display:flex;gap:7px;margin-top:9px" data-id="' + it.id + '">'
              + '<button type="button" data-a="verify" style="flex:1;border:1.5px solid #0D2F4F;background:#0D2F4F;color:#fff;border-radius:9px;font:700 12px/1.2 inherit;cursor:pointer">โอเค ใช้ได้แล้ว</button>'
              + '<button type="button" data-a="reopen" style="flex:1;border:1.5px solid #E2E8F0;background:#fff;color:#64748B;border-radius:9px;font:700 12px/1.2 inherit;cursor:pointer">ยังไม่โอเค</button>'
              + '</div>'
            : '')
        + '</div>';
    }).join('');
    box.querySelectorAll('.ack button').forEach((b) => b.onclick = () => ack(b));
  }

  async function ack(btn) {
    const wrap = btn.parentNode, id = +wrap.getAttribute('data-id'), a = btn.dataset.a;
    const card = wrap.parentNode;
    // ยังไม่โอเค = ขอเหตุผลก่อน ทีมจะได้รู้ว่าตกตรงไหน (แบบเดียวกับฝั่งลีด)
    if (a === 'reopen' && !card.querySelector('.yfb-why')) {
      const ta = document.createElement('input');
      ta.className = 'yfb-why'; ta.placeholder = 'ยังติดตรงไหนคะ (ไม่ใส่ก็ได้)';
      card.appendChild(ta); ta.focus();
      btn.textContent = 'ส่งกลับให้แก้';
      return;
    }
    const why = card.querySelector('.yfb-why');
    wrap.querySelectorAll('button').forEach((b) => b.disabled = true);
    btn.textContent = 'กำลังบันทึก…';
    const patch = a === 'verify'
      ? { status: 'verified', verified_at: new Date().toISOString() }
      : { status: 'new', fixed_at: null, notified_fixed_at: null };
    // ★ ต้องรู้ว่าเขียนติดจริงไหม — สิทธิ์ไม่ผ่านจะได้ 0 แถวโดยไม่มี error
    const { data: done, error } = await sb.from('trial_feedback').update(patch).eq('id', id).select('id');
    if (error || !done || !done.length) {
      wrap.querySelectorAll('button').forEach((b) => b.disabled = false);
      btn.textContent = a === 'verify' ? 'โอเค ใช้ได้แล้ว' : 'ยังไม่โอเค';
      alert(error ? ('ไม่สำเร็จ: ' + error.message) : 'ใบนี้ไม่ใช่ของคุณค่ะ');
      return;
    }
    await sb.from('trial_feedback_log').insert({
      feedback_id: id, kind: 'status', to_status: patch.status,
      actor_name: (ID && (ID.employee_name || ID.display_name)) || 'ผู้ใช้',
      note: (why && why.value.trim())
        ? (a === 'verify' ? why.value.trim() : 'ยังไม่โอเค: ' + why.value.trim())
        : (a === 'verify' ? 'ยืนยันว่าใช้ได้แล้ว' : 'ยังไม่โอเค เปิดเรื่องใหม่'),
    });
    loadList();
  }

  fab.onclick = () => { modal.classList.add('on'); tab('form'); };
  drawCats(); drawThumbs();
}
