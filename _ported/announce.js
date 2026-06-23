/* ====================================================================
   announce.js — Native port of "ประกาศ" (announcement_manager.html)
   Pattern: mirrors mountExpense() in index.html (scoped style + HTML
   injected into a container, wire button, then load list).

   Conventions (per port spec):
   - Scoped CSS prefix: #an   ·   element id prefix: an2-
   - Function / var prefix: an2   (avoid clashing with existing
     loadAnnounce/postAnnounce/annTitle in index.html)
   - Globals reused (DO NOT redeclare): sb (supabase client), esc (escaper)
   - Container: #wrap-announce_p  (parent adds the div later)
     -> mountAnnounceP() is a no-op if the container is absent.

   Edge function: hr_announce
   - create: sb.functions.invoke('hr_announce', { body: {
       title, body, audience, category, effective_date, requires_ack(bool)
     }})
   - list:   sb.functions.invoke('hr_announce')  ->  { announcements:[...] }
   ==================================================================== */

/* category — 8 values, labels mirror announcement_view.html categoryLabel() */
var AN2_CATEGORIES = [
  { v: 'general',      l: 'ทั่วไป' },
  { v: 'policy',       l: 'นโยบาย' },
  { v: 'welfare',      l: 'สวัสดิการ' },
  { v: 'activity',     l: 'กิจกรรม' },
  { v: 'urgent',       l: 'ด่วน' },
  { v: 'monthly',      l: 'บอร์ดประจำเดือน' },
  { v: 'permanent',    l: 'บอร์ดถาวร' },
  { v: 'announcement', l: 'แจ้งเตือน' }
];

function an2CatLabel(cat) {
  var c = String(cat || 'general').toLowerCase();
  for (var i = 0; i < AN2_CATEGORIES.length; i++) {
    if (AN2_CATEGORIES[i].v === c) return AN2_CATEGORIES[i].l;
  }
  return cat || 'ทั่วไป';
}

/* mountAnnounceP — render the native announcement panel into #wrap-announce_p.
   No-op when the container is absent (index.html may not have it yet). */
function mountAnnounceP() {
  var wrap = document.getElementById('wrap-announce_p');
  if (!wrap) return;

  var catOpts = AN2_CATEGORIES
    .map(function (c) { return '<option value="' + c.v + '">' + esc(c.l) + '</option>'; })
    .join('');

  wrap.innerHTML = ''
    + '<style>'
    + '#an{--annavy:#0D2F4F;--anteal:#3DC5B7;--antealdk:#0F766E;--anline:#E5E7EB;--anmuted:#6B7280;max-width:480px;margin:0 auto}'
    + '#an .anhead{position:relative;background:linear-gradient(135deg,var(--annavy),var(--antealdk));color:#fff;padding:16px;border-radius:12px;overflow:hidden}'
    + '#an .anblob{position:absolute;width:120px;height:120px;border-radius:50%;background:#ffffff14;top:-44px;right:-36px}'
    + '#an .aneb{font-size:12px;color:var(--anteal);font-weight:600;position:relative}'
    + '#an .anh1{font-size:18px;font-weight:600;margin:6px 0 0;position:relative}'
    + '#an .ancard{background:#fff;border-radius:12px;border:.5px solid rgba(0,0,0,.1);margin:14px 0;padding:16px}'
    + '#an .ansec{font-size:13px;color:var(--annavy);font-weight:600;margin:0 0 10px}'
    + '#an label{display:block;font-size:12px;color:var(--anmuted);margin:10px 0 4px}'
    + '#an select,#an input,#an textarea{width:100%;padding:10px;border:1px solid #CBD5E1;border-radius:8px;font-size:14px;background:#fff;font-family:inherit}'
    + '#an textarea{min-height:90px;resize:vertical}'
    + '#an .anack{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;color:var(--annavy)}'
    + '#an .anack input{width:auto;margin:0}'
    + '#an .annote{background:#FEF3C7;border-radius:8px;padding:10px;font-size:12px;color:#854F0B;margin-top:10px}'
    + '#an .ancta button{width:100%;padding:13px;border:0;border-radius:10px;background:var(--anteal);color:#04342C;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;margin:4px 0 6px}'
    + '#an .ancta button:disabled{opacity:.6;cursor:not-allowed}'
    + '#an .anmsg{font-size:12px;color:var(--antealdk);min-height:16px;text-align:center;margin-bottom:8px}'
    + '#an .anmsg.err{color:#B91C1C}'
    + '#an .anitem{border-bottom:.5px solid var(--anline);padding:12px 0}'
    + '#an .anitem:last-child{border-bottom:0}'
    + '#an .anit-cat{display:inline-block;font-size:11px;font-weight:600;padding:3px 9px;border-radius:10px;background:#E0F2FE;color:#075985}'
    + '#an .anit-cat.urgent{background:#FCEBEB;color:#791F1F}'
    + '#an .anit-ttl{font-weight:600;color:var(--annavy);font-size:14px;margin:6px 0 0}'
    + '#an .anit-body{color:#475569;margin:4px 0;white-space:pre-wrap;font-size:13px}'
    + '#an .anit-meta{font-size:11px;color:#94A3B8;margin-top:4px}'
    + '#an .anit-ack{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:8px;background:#FEF3C7;color:#92400E;margin-left:6px}'
    + '#an .anempty{color:var(--anmuted);font-size:13px;text-align:center;padding:14px}'
    + '</style>'
    + '<div id="an">'
    +   '<div class="anhead"><div class="anblob"></div><div class="aneb">ANNOUNCE · ประกาศบริษัท</div><div class="anh1">เขียนประกาศ / ดูรายการ</div></div>'
    +   '<div class="ancard"><div class="ansec">เขียนประกาศใหม่</div>'
    +     '<label>หัวข้อ</label><input id="an2-title" placeholder="เช่น ปรับเวลาทำการช่วงเทศกาล">'
    +     '<label>รายละเอียด</label><textarea id="an2-body" placeholder="เนื้อหาประกาศ..."></textarea>'
    +     '<label>กลุ่มเป้าหมาย (audience)</label><input id="an2-audience" placeholder="เช่น ทุกสาขา / แผนกบัญชี (เว้นว่าง = ทั้งหมด)">'
    +     '<label>หมวด</label><select id="an2-category">' + catOpts + '</select>'
    +     '<label>วันที่มีผลบังคับใช้ (effective date)</label><input id="an2-effective" type="date">'
    +     '<label class="anack"><input id="an2-ack" type="checkbox"> ต้องกดรับทราบ (requires acknowledgement)</label>'
    +     '<div class="annote">ประกาศจะถูกส่งให้พนักงานตาม audience ที่เลือก · ถ้าติ๊ก "ต้องกดรับทราบ" พนักงานต้องเปิดอ่านและยืนยัน</div>'
    +   '</div>'
    +   '<div class="ancta"><div class="anmsg" id="an2-msg"></div><button id="an2-btn">โพสต์ประกาศ</button></div>'
    +   '<div class="ancard"><div class="ansec">ประกาศล่าสุด</div><div id="an2-list"><div class="anempty">กำลังโหลด...</div></div></div>'
    + '</div>';

  document.getElementById('an2-btn').onclick = an2Submit;
  an2Load();
}

/* render one announcement row (mirrors annCard + announcement_view fields) */
function an2Item(a) {
  var cat = String(a.category || 'general').toLowerCase();
  var when = String(a.posted_at || a.published_at || a.created_at || '').slice(0, 16).replace('T', ' ');
  return '<div class="anitem">'
    + '<span class="anit-cat' + (cat === 'urgent' ? ' urgent' : '') + '">' + esc(an2CatLabel(cat)) + '</span>'
    + (a.requires_ack ? '<span class="anit-ack">ต้องรับทราบ</span>' : '')
    + '<div class="anit-ttl">' + esc(a.title || '') + '</div>'
    + (a.body ? '<div class="anit-body">' + esc(a.body) + '</div>' : '')
    + '<div class="anit-meta">'
    +   (a.audience ? esc(a.audience) : 'ทั้งหมด')
    +   (when ? ' · ' + esc(when) : '')
    +   (a.posted_by ? ' · ' + esc(a.posted_by) : '')
    +   (a.effective_date ? ' · มีผล ' + esc(String(a.effective_date).slice(0, 10)) : '')
    + '</div>'
    + '</div>';
}

/* list — sb.functions.invoke('hr_announce') -> { announcements:[...] } */
async function an2Load() {
  var list = document.getElementById('an2-list');
  try {
    var res = await sb.functions.invoke('hr_announce');
    var data = res && res.data;
    var items = (data && data.announcements) || [];
    if (list) {
      list.innerHTML = items.length
        ? items.map(an2Item).join('')
        : '<div class="anempty">ยังไม่มีประกาศ</div>';
    }
    var ct = document.getElementById('ct-announce');
    if (ct) ct.textContent = items.length || '';
  } catch (e) {
    console.error('an2Load', e);
    if (list) list.innerHTML = '<div class="anempty">โหลดประกาศไม่สำเร็จ</div>';
  }
}

/* create — body: {title, body, audience, category, effective_date, requires_ack(bool)} */
async function an2Submit() {
  var msg = document.getElementById('an2-msg');
  var btn = document.getElementById('an2-btn');
  if (msg) { msg.classList.remove('err'); msg.textContent = ''; }

  var title = (document.getElementById('an2-title').value || '').trim();
  if (!title) {
    if (msg) { msg.classList.add('err'); msg.textContent = 'กรุณาใส่หัวข้อ'; }
    return;
  }

  var body = {
    title: title,
    body: document.getElementById('an2-body').value || '',
    audience: (document.getElementById('an2-audience').value || '').trim(),
    category: document.getElementById('an2-category').value,
    effective_date: document.getElementById('an2-effective').value || '',
    requires_ack: !!document.getElementById('an2-ack').checked
  };

  if (btn) { btn.disabled = true; btn.textContent = 'กำลังโพสต์...'; }
  if (msg) msg.textContent = 'กำลังโพสต์…';

  var res = await sb.functions.invoke('hr_announce', { body: body });
  var data = res && res.data, error = res && res.error;

  if (btn) { btn.disabled = false; btn.textContent = 'โพสต์ประกาศ'; }

  if (error || (data && data.error)) {
    if (msg) {
      msg.classList.add('err');
      msg.textContent = 'ผิดพลาด: ' + ((data && data.error) || (error && error.message) || 'unknown');
    }
    return;
  }

  /* success: clear form + reload + count is set inside an2Load via ct-announce */
  document.getElementById('an2-title').value = '';
  document.getElementById('an2-body').value = '';
  document.getElementById('an2-audience').value = '';
  document.getElementById('an2-effective').value = '';
  document.getElementById('an2-ack').checked = false;
  if (msg) { msg.classList.remove('err'); msg.textContent = 'โพสต์แล้ว ✓'; }
  an2Load();
}
