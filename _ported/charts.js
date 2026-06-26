// _ported/charts.js — YChart : ชุดกราฟ/แดชบอร์ดกลาง (JERA-style) ใช้ซ้ำได้ทุกหน้า
// ----------------------------------------------------------------------------
// ดีไซน์อิงหน้า dashboard ของ JERA (yiaoya.jeracloud.com): KPI rail + filter bar +
//   grid ของกราฟ (donut / line เทียบปี / stacked bar รายวัน / radar สัดส่วน /
//   gauge ครึ่งวง / Top-N list). สีตาม Altmedical brand (Navy #0D2F4F + Teal #3DC5B7).
//
// dependency-free — กราฟทุกตัวเป็น inline SVG เขียนมือ (เหมือน convention เดิมในระบบ)
//   ห้าม emoji · ใช้ ti-* (Tabler) สำหรับไอคอน
//
// ทุกฟังก์ชัน return เป็น HTML string (เข้ากับสไตล์ string-building ของโมดูล)
//   วิธีใช้ในโมดูล:  el.innerHTML = YChart.card({title:'รายรับ', body: YChart.line({...})})
//   CSS ฉีดเข้า <head> ครั้งเดียวอัตโนมัติ (YChart._css)
//
// global: window.YChart  (โหลดเป็น classic <script> ก่อน main module ใน index.html)
// ============================================================================
(function (root) {
  'use strict';

  // ---- palette : นำด้วย teal/navy แล้วต่อด้วยสีที่แยกออกจากกันชัด (โทนเดียวกับ donut ของ JERA)
  // palette โทนอ่อน (pastel) — แยกออกจากกันได้ชัดแต่ดูนุ่ม ไม่จัดจ้าน
  var PALETTE = ['#6FD2C6', '#7BA0C9', '#F6CB85', '#A7AAEE', '#F2AECF', '#92D9B2', '#9AD9E6', '#F4ABA6', '#C2ACEC', '#BFE08F'];
  var C = {
    navy: '#0D2F4F', teal: '#3DC5B7', tealInk: '#0F766E', tealDark: '#2BA89B',
    tealSoft: '#6FD2C6', navySoft: '#7BA0C9', amberSoft: '#F6CB85',
    grid: '#EEF2F6', axis: '#94A3B8', muted: '#64748B', faint: '#94A3B8',
    up: '#16A34A', down: '#DC2626', track: '#EDF1F5'
  };

  // ---- helpers
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function fmt(v) {
    var n = num(v);
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1) + 'k';
    return String(Math.round(n));
  }
  function full(v) { return num(v).toLocaleString('th-TH'); }
  function baht(v) { return '฿' + num(v).toLocaleString('th-TH', { maximumFractionDigits: 0 }); }
  function pct(v) { return (num(v) > 0 ? '+' : '') + num(v).toFixed(2) + '%'; }
  function col(i) { return PALETTE[i % PALETTE.length]; }

  // ---- hover tooltip (singleton ติดที่ body · delegated listener ครั้งเดียว)
  //   ใช้ data-tip="<html>" บน element ใดก็ได้ → โผล่ตาม mouse ทุกกราฟ
  function ensureTip() {
    if (typeof document === 'undefined' || document.getElementById('yc-tip')) return;
    var t = document.createElement('div'); t.id = 'yc-tip';
    t.style.cssText = 'position:fixed;z-index:99999;pointer-events:none;background:#0D2F4F;color:#fff;font:500 11.5px/1.45 "Noto Sans Thai",Inter,sans-serif;padding:7px 10px;border-radius:9px;box-shadow:0 8px 24px rgba(13,47,79,.28);opacity:0;transform:translateY(2px);transition:opacity .1s,transform .1s;max-width:260px';
    document.body.appendChild(t);
    var show = function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (!el) return; t.innerHTML = el.getAttribute('data-tip'); t.style.opacity = '1'; t.style.transform = 'translateY(0)'; };
    document.addEventListener('mouseover', show, { passive: true });
    document.addEventListener('focusin', show);
    document.addEventListener('mousemove', function (e) {
      if (t.style.opacity === '0') return;
      var x = e.clientX + 14, y = e.clientY + 16, w = t.offsetWidth, h = t.offsetHeight;
      if (x + w > window.innerWidth - 6) x = e.clientX - w - 14;
      if (y + h > window.innerHeight - 6) y = e.clientY - h - 16;
      t.style.left = x + 'px'; t.style.top = y + 'px';
    }, { passive: true });
    document.addEventListener('mouseout', function (e) { if (e.target.closest && e.target.closest('[data-tip]')) { t.style.opacity = '0'; t.style.transform = 'translateY(2px)'; } }, { passive: true });
    // toggle chart : คลิก chip → เปิด/ปิดเส้น แล้ว re-render กราฟในที่เดิม
    document.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('[data-yc-tg]'); if (!chip) return;
      var id = chip.getAttribute('data-yc-tg'), key = chip.getAttribute('data-key'), cfg = _tg[id]; if (!cfg) return;
      if (cfg._active[key]) delete cfg._active[key]; else cfg._active[key] = 1;
      var svgBox = document.getElementById(id + '_svg'); if (svgBox) svgBox.innerHTML = tgSvg(cfg);
      var wrap = document.getElementById(id);
      if (wrap) wrap.querySelectorAll('[data-yc-tg]').forEach(function (b) { b.classList.toggle('off', !cfg._active[b.getAttribute('data-key')]); });
    });
  }
  // สร้าง attribute data-tip (escape ปลอดภัย) — html: swatch สี + label + value
  function tip(label, value, color) {
    var s = (color ? '<span style=\'display:inline-block;width:8px;height:8px;border-radius:2px;background:' + color + ';margin-right:6px\'></span>' : '') +
      '<span style=\'color:#9FE1CB\'>' + esc(label) + '</span> <b style=\'margin-left:4px\'>' + esc(value) + '</b>';
    return ' data-tip="' + s.replace(/"/g, '&quot;') + '" style="cursor:pointer"';
  }
  var _tg = {}, _tgSeq = 0; // registry ของ toggle chart (ใช้ re-render ตอนคลิก chip)

  // ---- CSS (ฉีดครั้งเดียว)
  var CSS =
    '.yc-grid{display:grid;gap:14px}' +
    '.yc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:2px 0 16px}' +
    '.yc-kpi{background:#E6F7F5;border-radius:13px;padding:14px 16px;position:relative;overflow:hidden}' +
    '.yc-kpi.flat{background:#fff;border:1px solid #E2E8F0}' +
    '.yc-kpi .lab{display:flex;align-items:center;gap:6px;color:#64748B;font-size:12.5px;font-weight:500}' +
    '.yc-kpi .lab i{color:#3DC5B7;font-size:16px}' +
    '.yc-kpi .val{color:#0D2F4F;font-size:25px;font-weight:700;margin-top:5px;letter-spacing:-.02em;line-height:1.1}' +
    '.yc-kpi .val .u{font-size:13px;font-weight:500;color:#64748B;margin-left:3px}' +
    '.yc-kpi .sub{margin-top:3px;font-size:11.5px;color:#94A3B8}' +
    '.yc-kpi .dlt{font-size:12px;font-weight:700;margin-left:6px}' +
    '.yc-kpi .dlt.up{color:#16A34A}.yc-kpi .dlt.down{color:#DC2626}' +
    '.yc-card{background:#fff;border:1px solid #E2E8F0;border-radius:13px;overflow:hidden}' +
    '.yc-card .hd{display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #EEF2F6;color:#0D2F4F;font-weight:600;font-size:14px}' +
    '.yc-card .hd i{color:#3DC5B7;font-size:17px}' +
    '.yc-card .hd .sub{font-weight:400;color:#94A3B8;font-size:11.5px;margin-left:2px}' +
    '.yc-card .hd .act{margin-left:auto;font-weight:400}' +
    '.yc-card .bd{padding:14px 16px}' +
    '.yc-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px}' +
    '.yc-legend .it{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#475569}' +
    '.yc-legend .sw{width:10px;height:10px;border-radius:3px;flex:none}' +
    '.yc-legend .it b{color:#0D2F4F;font-weight:600}' +
    '.yc-donutwrap{display:flex;align-items:center;gap:16px;flex-wrap:wrap}' +
    '.yc-top{display:flex;flex-direction:column}' +
    '.yc-top .row{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid #F1F5F9}' +
    '.yc-top .row:last-child{border-bottom:none}' +
    '.yc-top .rk{width:22px;height:22px;border-radius:50%;background:#E6F7F5;color:#0F766E;font-size:11px;font-weight:700;display:grid;place-items:center;flex:none}' +
    '.yc-top .row:nth-child(-n+3) .rk{background:#0D2F4F;color:#fff}' +
    '.yc-top .nm{flex:1;min-width:0;font-size:12.5px;color:#0F172A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.yc-top .bdg{font-size:10px;font-weight:600;padding:1px 7px;border-radius:20px;background:#E6F7F5;color:#0F766E;flex:none}' +
    '.yc-top .vl{font-size:12.5px;font-weight:700;color:#0D2F4F;flex:none}' +
    '.yc-empty{padding:26px;text-align:center;color:#94A3B8;font-size:12.5px}' +
    '.yc-bars{display:flex;flex-direction:column;gap:7px}' +
    '.yc-bars .b{display:flex;align-items:center;gap:9px;font-size:12px}' +
    '.yc-bars .b .nm{width:120px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right;flex:none}' +
    '.yc-bars .b .tr{flex:1;height:16px;background:#F1F5F9;border-radius:5px;overflow:hidden}' +
    '.yc-bars .b .fl{height:100%;border-radius:5px}' +
    '.yc-bars .b .vl{width:64px;text-align:right;color:#0D2F4F;font-weight:600;flex:none}' +
    // ---- settings : pills (segment/period) · icon buttons · filter bar
    '.yc-pills{display:inline-flex;gap:3px;background:#F1F5F9;border-radius:9px;padding:3px}' +
    '.yc-pills button{border:none;background:none;font:inherit;font-size:12px;color:#64748B;padding:4px 11px;border-radius:7px;cursor:pointer;white-space:nowrap}' +
    '.yc-pills button.on{background:#fff;color:#0D2F4F;font-weight:600;box-shadow:0 1px 3px rgba(13,47,79,.1)}' +
    '.yc-ib{width:28px;height:28px;border-radius:8px;border:1px solid #E2E8F0;background:#fff;color:#64748B;cursor:pointer;display:inline-grid;place-items:center;font-size:15px}' +
    '.yc-ib:hover{border-color:#3DC5B7;color:#0F766E;background:#E6F7F5}' +
    '.yc-filter{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;background:#fff;border:1px solid #E2E8F0;border-radius:13px;padding:12px 14px;margin-bottom:14px}' +
    '.yc-filter .fld{display:flex;flex-direction:column;gap:3px}' +
    '.yc-filter label{font-size:10.5px;color:#94A3B8;font-weight:600;text-transform:uppercase;letter-spacing:.04em}' +
    '.yc-filter select,.yc-filter input{font:inherit;font-size:13px;color:#0F172A;border:1px solid #E2E8F0;border-radius:8px;padding:7px 10px;background:#fff;min-width:120px}' +
    '.yc-filter select:focus,.yc-filter input:focus{outline:none;border-color:#3DC5B7}' +
    '.yc-filter .go{background:#3DC5B7;color:#fff;border:none;border-radius:8px;padding:8px 18px;font:inherit;font-weight:700;font-size:13px;cursor:pointer}' +
    '.yc-filter .go:hover{background:#2BA89B}' +
    // ---- toggle chart (เลือกเส้นแสดงพร้อมกัน)
    '.yc-tg-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}' +
    '.yc-tg-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #E2E8F0;background:#fff;border-radius:20px;padding:5px 11px;font:inherit;font-size:12px;color:#0F172A;cursor:pointer;transition:.12s}' +
    '.yc-tg-chip .dot{width:9px;height:9px;border-radius:50%;flex:none}' +
    '.yc-tg-chip .ax{font-size:10px;color:#94A3B8;font-weight:700}' +
    '.yc-tg-chip:hover{border-color:#3DC5B7}' +
    '.yc-tg-chip.off{background:#F8FAFC;color:#94A3B8;border-color:#EEF2F6}' +
    '.yc-tg-chip.off .dot{background:#CBD5E1 !important}';

  function ensureCSS() {
    if (typeof document === 'undefined' || document.getElementById('ychart-css')) return;
    var st = document.createElement('style'); st.id = 'ychart-css'; st.textContent = CSS;
    document.head.appendChild(st);
    ensureTip();
  }

  // ============================================================ KPI cards
  // YChart.kpi({label, value, unit, sub, delta, icon, flat})  delta: number (% — บวก=เขียว ลบ=แดง) | null
  function kpi(o) {
    o = o || {};
    var d = '';
    if (o.delta != null && o.delta !== '') {
      var n = num(o.delta);
      d = '<span class="dlt ' + (n >= 0 ? 'up' : 'down') + '">' + pct(n) + '</span>';
    }
    return '<div class="yc-kpi' + (o.flat ? ' flat' : '') + '">' +
      '<div class="lab">' + (o.icon ? '<i class="ti ' + esc(o.icon) + '"></i>' : '') + esc(o.label || '') + '</div>' +
      '<div class="val">' + (o.value == null ? '…' : esc(o.value)) + (o.unit ? '<span class="u">' + esc(o.unit) + '</span>' : '') + d + '</div>' +
      (o.sub ? '<div class="sub">' + esc(o.sub) + '</div>' : '') +
      '</div>';
  }
  function kpiRow(cards) { ensureCSS(); return '<div class="yc-kpis">' + (cards || []).map(kpi).join('') + '</div>'; }

  // ============================================================ card / panel
  // YChart.card({title, icon, sub, action, body})
  function card(o) {
    ensureCSS(); o = o || {};
    var head = (o.title || o.icon) ?
      '<div class="hd">' + (o.icon ? '<i class="ti ' + esc(o.icon) + '"></i>' : '') + esc(o.title || '') +
      (o.sub ? '<span class="sub">' + esc(o.sub) + '</span>' : '') +
      (o.action ? '<span class="act">' + o.action + '</span>' : '') + '</div>' : '';
    return '<div class="yc-card">' + head + '<div class="bd">' + (o.body || '') + '</div></div>';
  }
  // YChart.grid(htmlParts[], {cols, min})  → responsive grid
  function grid(parts, o) {
    ensureCSS(); o = o || {};
    var tmpl = o.cols ? 'repeat(' + o.cols + ',1fr)' : 'repeat(auto-fit,minmax(' + (o.min || 300) + 'px,1fr))';
    return '<div class="yc-grid" style="grid-template-columns:' + tmpl + '">' + (parts || []).join('') + '</div>';
  }

  // ============================================================ legend
  // parts: [{label, value?, color}]
  function legend(parts, o) {
    o = o || {};
    return '<div class="yc-legend">' + (parts || []).map(function (p, i) {
      return '<span class="it"><span class="sw" style="background:' + (p.color || col(i)) + '"></span>' +
        esc(p.label) + (o.showValue && p.value != null ? ' <b>' + (o.valueFmt ? o.valueFmt(p.value) : full(p.value)) + '</b>' : '') + '</span>';
    }).join('') + '</div>';
  }

  // ============================================================ donut
  // parts: [{label, value, color?}]  opts: {size, centerLabel, centerValue, valueFmt, legend}
  function donut(parts, o) {
    ensureCSS(); o = o || {}; parts = (parts || []).filter(function (p) { return num(p.value) > 0; });
    if (!parts.length) return '<div class="yc-empty">ไม่มีข้อมูล</div>';
    var sz = o.size || 170, R = 66, sw = 26, CC = 2 * Math.PI * R;
    var tot = parts.reduce(function (a, p) { return a + num(p.value); }, 0) || 1;
    var off = 0;
    var seg = parts.map(function (p, i) {
      var c = p.color || col(i), dash = num(p.value) / tot * CC;
      var el = '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-dasharray="' + dash + ' ' + (CC - dash) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 100 100)"' + tip(p.label, full(p.value) + ' (' + Math.round(num(p.value) / tot * 100) + '%)', c) + '></circle>';
      off += dash; return el;
    }).join('');
    var cv = o.centerValue != null ? esc(o.centerValue) : (o.valueFmt ? o.valueFmt(tot) : fmt(tot));
    var svg = '<svg viewBox="0 0 200 200" style="width:' + sz + 'px;height:' + sz + 'px;flex:none">' + seg +
      '<text x="100" y="93" font-size="11" fill="#94A3B8" text-anchor="middle">' + esc(o.centerLabel || 'รวม') + '</text>' +
      '<text x="100" y="115" font-size="17" fill="#0D2F4F" text-anchor="middle" font-weight="800">' + cv + '</text></svg>';
    if (o.legend === false) return svg;
    var lg = legend(parts.map(function (p, i) { return { label: p.label, value: p.value, color: p.color || col(i) }; }), { showValue: true, valueFmt: o.valueFmt });
    return '<div class="yc-donutwrap">' + svg + '<div style="flex:1;min-width:130px">' + lg + '</div></div>';
  }

  // ============================================================ line (multi-series)
  // opts: {labels:[], series:[{name, vals:[], color?}], height, yFmt}
  function line(o) {
    o = o || {}; var labels = o.labels || [], series = o.series || [];
    if (!labels.length || !series.length) return '<div class="yc-empty">ไม่มีข้อมูล</div>';
    var W = 840, H = o.height || 250, padL = 44, padR = 14, padB = 26, padT = 10, n = labels.length;
    var yFmt = o.yFmt || fmt;
    var mx = Math.max(1, Math.max.apply(null, series.flatMap(function (s) { return s.vals.map(num); })));
    var X = function (i) { return padL + (n <= 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (n - 1)); };
    var Y = function (v) { return H - padB - (num(v) / mx) * (H - padB - padT); };
    var g = '';
    for (var k = 0; k <= 4; k++) {
      var yy = H - padB - (k / 4) * (H - padB - padT);
      g += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="' + C.grid + '"/>' +
        '<text x="' + (padL - 6) + '" y="' + (yy + 3) + '" font-size="9" fill="' + C.faint + '" text-anchor="end">' + yFmt(mx * k / 4) + '</text>';
    }
    labels.forEach(function (m, i) {
      if (n > 12 && i % 2) return;
      g += '<text x="' + X(i) + '" y="' + (H - 9) + '" font-size="8.5" fill="' + C.muted + '" text-anchor="middle">' + esc(m) + '</text>';
    });
    series.forEach(function (s, si) {
      var c = s.color || col(si);
      var pts = s.vals.map(function (v, i) { return X(i) + ',' + Y(v); }).join(' ');
      g += '<polyline points="' + pts + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      s.vals.forEach(function (v, i) { g += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="3.2" fill="#fff" stroke="' + c + '" stroke-width="2"' + tip(s.name + ' · ' + labels[i], full(v), c) + '></circle>'; });
    });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' + g + '</svg>';
    if (series.length > 1 || o.legend) svg += legend(series.map(function (s, i) { return { label: s.name, color: s.color || col(i) }; }));
    return svg;
  }

  // ============================================================ bars (grouped / stacked)
  // opts: {labels:[], series:[{name, vals:[], color?}], stacked, height, yFmt}
  function bars(o) {
    o = o || {}; var labels = o.labels || [], series = o.series || [];
    if (!labels.length || !series.length) return '<div class="yc-empty">ไม่มีข้อมูล</div>';
    var W = 840, H = o.height || 230, padL = 40, padR = 12, padB = 24, padT = 8, n = labels.length;
    var yFmt = o.yFmt || fmt, stacked = !!o.stacked;
    var mx;
    if (stacked) mx = Math.max(1, Math.max.apply(null, labels.map(function (_, i) { return series.reduce(function (a, s) { return a + num(s.vals[i]); }, 0); })));
    else mx = Math.max(1, Math.max.apply(null, series.flatMap(function (s) { return s.vals.map(num); })));
    var bw = (W - padL - padR) / n;
    var Y = function (v) { return H - padB - (num(v) / mx) * (H - padB - padT); };
    var HH = function (v) { return (num(v) / mx) * (H - padB - padT); };
    var g = '';
    for (var k = 0; k <= 4; k++) {
      var yy = H - padB - (k / 4) * (H - padB - padT);
      g += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="' + C.grid + '"/>' +
        '<text x="' + (padL - 5) + '" y="' + (yy + 3) + '" font-size="9" fill="' + C.faint + '" text-anchor="end">' + yFmt(mx * k / 4) + '</text>';
    }
    labels.forEach(function (lb, i) {
      var cx = padL + i * bw + bw / 2;
      if (!(n > 14 && i % 2)) g += '<text x="' + cx + '" y="' + (H - 8) + '" font-size="8.5" fill="' + C.muted + '" text-anchor="middle">' + esc(lb) + '</text>';
      if (stacked) {
        var acc = 0;
        series.forEach(function (s, si) {
          var v = num(s.vals[i]); if (v <= 0) return;
          var bx = padL + i * bw + bw * 0.18, w = bw * 0.64;
          var y = Y(acc + v);
          g += '<rect x="' + bx + '" y="' + y + '" width="' + w + '" height="' + HH(v) + '" fill="' + (s.color || col(si)) + '" rx="2"' + tip(s.name + ' · ' + lb, full(v), s.color || col(si)) + '></rect>';
          acc += v;
        });
      } else {
        var sn = series.length, gw = bw * 0.7, ew = gw / sn;
        series.forEach(function (s, si) {
          var v = num(s.vals[i]);
          var bx = padL + i * bw + bw * 0.15 + si * ew;
          g += '<rect x="' + bx + '" y="' + Y(v) + '" width="' + (ew * 0.86) + '" height="' + HH(v) + '" fill="' + (s.color || col(si)) + '" rx="1.5"' + tip(s.name + ' · ' + lb, full(v), s.color || col(si)) + '></rect>';
        });
      }
    });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' + g + '</svg>';
    if (series.length > 1 || o.legend) svg += legend(series.map(function (s, i) { return { label: s.name, color: s.color || col(i) }; }));
    return svg;
  }

  // ============================================================ sparkline
  function spark(vals, o) {
    o = o || {}; vals = (vals || []).map(num);
    if (!vals.length) return '';
    var W = o.width || 90, H = o.height || 24, c = o.color || C.teal, mx = Math.max(1, Math.max.apply(null, vals)), mn = Math.min.apply(null, vals);
    var rng = (mx - mn) || 1;
    var pts = vals.map(function (v, i) { return (vals.length <= 1 ? W / 2 : i * W / (vals.length - 1)) + ',' + (H - 2 - ((v - mn) / rng) * (H - 4)); });
    var area = 'M0,' + H + ' L' + pts.join(' L') + ' L' + W + ',' + H + ' Z';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:' + W + 'px;height:' + H + 'px">' +
      '<path d="' + area + '" fill="' + c + '" opacity=".12"/>' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + c + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  // ============================================================ gauge (half-donut)
  // YChart.gauge({value, max, label, color, valueFmt})  — เหมือน "ยังใช้บริการ/หายไป" ของ JERA
  function gauge(o) {
    o = o || {}; var v = num(o.value), mx = num(o.max) || 1, frac = Math.max(0, Math.min(1, v / mx));
    var R = 70, cx = 100, cy = 100, sw = 20;
    function pt(a) { return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; }
    var a0 = Math.PI, a1 = Math.PI + Math.PI * frac;
    var bg = describeArc(cx, cy, R, Math.PI, 2 * Math.PI);
    var fg = describeArc(cx, cy, R, a0, a1);
    var c = o.color || C.teal;
    var cv = o.valueFmt ? o.valueFmt(v) : full(v);
    return '<svg viewBox="0 0 200 120" style="width:100%;height:auto;max-width:220px">' +
      '<path d="' + bg + '" fill="none" stroke="' + C.track + '" stroke-width="' + sw + '" stroke-linecap="round"/>' +
      '<path d="' + fg + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round"/>' +
      '<text x="100" y="92" font-size="22" font-weight="800" fill="#0D2F4F" text-anchor="middle">' + cv + '</text>' +
      '<text x="100" y="110" font-size="10.5" fill="#94A3B8" text-anchor="middle">' + esc(o.label || '') + '</text></svg>';
  }
  function describeArc(cx, cy, r, a0, a1) {
    var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    var large = (a1 - a0) > Math.PI ? 1 : 0;
    return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
  }

  // ============================================================ radar
  // YChart.radar({axes:['ขายยา',...], series:[{name, vals:[], color?}]})  — สัดส่วนรายรับ
  function radar(o) {
    o = o || {}; var axes = o.axes || [], series = o.series || [];
    if (axes.length < 3 || !series.length) return '<div class="yc-empty">ไม่มีข้อมูล</div>';
    var cx = 130, cy = 125, R = 92, n = axes.length;
    var mx = Math.max(1, Math.max.apply(null, series.flatMap(function (s) { return s.vals.map(num); })));
    function ang(i) { return -Math.PI / 2 + i * 2 * Math.PI / n; }
    function pt(i, frac) { var a = ang(i); return [cx + R * frac * Math.cos(a), cy + R * frac * Math.sin(a)]; }
    var g = '';
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var poly = axes.map(function (_, i) { return pt(i, f).map(function (z) { return z.toFixed(1); }).join(','); }).join(' ');
      g += '<polygon points="' + poly + '" fill="none" stroke="' + C.grid + '"/>';
    });
    axes.forEach(function (ax, i) {
      var p = pt(i, 1), lp = pt(i, 1.16);
      g += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="' + C.grid + '"/>';
      var anchor = Math.abs(lp[0] - cx) < 8 ? 'middle' : (lp[0] > cx ? 'start' : 'end');
      g += '<text x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 3).toFixed(1) + '" font-size="9.5" fill="' + C.muted + '" text-anchor="' + anchor + '">' + esc(ax) + '</text>';
    });
    series.forEach(function (s, si) {
      var c = s.color || col(si);
      var poly = s.vals.map(function (v, i) { return pt(i, num(v) / mx).map(function (z) { return z.toFixed(1); }).join(','); }).join(' ');
      g += '<polygon points="' + poly + '" fill="' + c + '" fill-opacity=".18" stroke="' + c + '" stroke-width="2"/>';
      s.vals.forEach(function (v, i) { var p = pt(i, num(v) / mx); g += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="#fff" stroke="' + c + '" stroke-width="2"' + tip(axes[i], full(v), c) + '></circle>'; });
    });
    var svg = '<svg viewBox="0 0 260 250" style="width:100%;height:auto;max-width:300px">' + g + '</svg>';
    if (series.length > 1) svg += legend(series.map(function (s, i) { return { label: s.name, color: s.color || col(i) }; }));
    return svg;
  }

  // ============================================================ Top-N list
  // items: [{name, value, badge?}]  opts: {valueFmt, limit}
  function topList(items, o) {
    ensureCSS(); o = o || {}; items = (items || []).slice(0, o.limit || 20);
    if (!items.length) return '<div class="yc-empty">ไม่มีข้อมูล</div>';
    var vf = o.valueFmt || full;
    return '<div class="yc-top">' + items.map(function (it, i) {
      return '<div class="row"><span class="rk">' + (i + 1) + '</span>' +
        (it.badge ? '<span class="bdg">' + esc(it.badge) + '</span>' : '') +
        '<span class="nm">' + esc(it.name) + '</span>' +
        '<span class="vl">' + vf(it.value) + '</span></div>';
    }).join('') + '</div>';
  }

  // ============================================================ horizontal bar list (สัดส่วน/อันดับ)
  // items: [{name, value, color?}]  opts: {valueFmt}
  function barList(items, o) {
    ensureCSS(); o = o || {}; items = (items || []);
    if (!items.length) return '<div class="yc-empty">ไม่มีข้อมูล</div>';
    var mx = Math.max(1, Math.max.apply(null, items.map(function (it) { return num(it.value); })));
    var vf = o.valueFmt || full;
    return '<div class="yc-bars">' + items.map(function (it, i) {
      return '<div class="b"><span class="nm" title="' + esc(it.name) + '">' + esc(it.name) + '</span>' +
        '<span class="tr"><span class="fl" style="width:' + (num(it.value) / mx * 100).toFixed(1) + '%;background:' + (it.color || col(i)) + '"></span></span>' +
        '<span class="vl">' + vf(it.value) + '</span></div>';
    }).join('') + '</div>';
  }

  // ============================================================ toggle chart (กราฟรวม เลือกดูได้)
  // YChart.toggleChart({id, labels, series:[{key,name,vals,color,axis:'left'|'right'}], active:[keys]})
  //   คลิก chip → เปิด/ปิดเส้น · รองรับแกนคู่ (ซ้าย=คน, ขวา=บาท) · re-render เองผ่าน delegated click
  function toggleChart(o) {
    ensureCSS(); o = o || {};
    var id = o.id || ('yctg' + (++_tgSeq));
    var cfg = { id: id, labels: o.labels || [], series: o.series || [], height: o.height || 300, _active: {} };
    var act = (o.active && o.active.length) ? o.active : cfg.series.map(function (s) { return s.key; });
    act.forEach(function (k) { cfg._active[k] = 1; });
    _tg[id] = cfg;
    return '<div class="yc-tg" id="' + id + '">' + tgChips(cfg) + '<div class="yc-tg-svg" id="' + id + '_svg">' + tgSvg(cfg) + '</div></div>';
  }
  function tgChips(cfg) {
    return '<div class="yc-tg-chips">' + cfg.series.map(function (s, i) {
      var c = s.color || col(i), on = cfg._active[s.key];
      return '<button class="yc-tg-chip' + (on ? '' : ' off') + '" data-yc-tg="' + esc(cfg.id) + '" data-key="' + esc(s.key) + '">' +
        '<span class="dot" style="background:' + c + '"></span>' + esc(s.name) + (s.axis === 'right' ? ' <span class="ax">฿</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  function tgSvg(cfg) {
    var labels = cfg.labels, sel = cfg.series.filter(function (s) { return cfg._active[s.key]; });
    if (!sel.length) return empty('เลือกอย่างน้อย 1 รายการเพื่อแสดงกราฟ', 'ti-eye-off');
    var W = 900, H = cfg.height, padL = 46, padR = 46, padB = 28, padT = 12, n = labels.length;
    var leftS = sel.filter(function (s) { return s.axis !== 'right'; });
    var rightS = sel.filter(function (s) { return s.axis === 'right'; });
    var flat = function (arr) { return arr.flatMap(function (s) { return s.vals.map(num); }).concat([0]); };
    var lMax = Math.max(1, Math.max.apply(null, flat(leftS)));
    var rMax = Math.max(1, Math.max.apply(null, flat(rightS)));
    var X = function (i) { return padL + (n <= 1 ? (W - padL - padR) / 2 : i * (W - padL - padR) / (n - 1)); };
    var Yl = function (v) { return H - padB - (num(v) / lMax) * (H - padB - padT); };
    var Yr = function (v) { return H - padB - (num(v) / rMax) * (H - padB - padT); };
    var g = '';
    for (var k = 0; k <= 4; k++) {
      var yy = H - padB - (k / 4) * (H - padB - padT);
      g += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="' + C.grid + '"/>';
      if (leftS.length) g += '<text x="' + (padL - 6) + '" y="' + (yy + 3) + '" font-size="9" fill="' + C.faint + '" text-anchor="end">' + fmt(lMax * k / 4) + '</text>';
      if (rightS.length) g += '<text x="' + (W - padR + 6) + '" y="' + (yy + 3) + '" font-size="9" fill="' + C.faint + '" text-anchor="start">' + fmt(rMax * k / 4) + '</text>';
    }
    labels.forEach(function (m, i) { if (n > 12 && i % 2) return; g += '<text x="' + X(i) + '" y="' + (H - 9) + '" font-size="8.5" fill="' + C.muted + '" text-anchor="middle">' + esc(m) + '</text>'; });
    if (rightS.length) g += '<text x="' + (W - padR + 6) + '" y="' + (padT + 2) + '" font-size="9" fill="' + C.faint + '" text-anchor="start">฿</text>';
    sel.forEach(function (s, si) {
      var c = s.color || col(cfg.series.indexOf(s)), Y = s.axis === 'right' ? Yr : Yl;
      var pts = s.vals.map(function (v, i) { return X(i) + ',' + Y(v); }).join(' ');
      g += '<polyline points="' + pts + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      s.vals.forEach(function (v, i) { g += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="3" fill="#fff" stroke="' + c + '" stroke-width="2"' + tip(s.name + ' · ' + labels[i], (s.axis === 'right' ? baht(v) : full(v)), c) + '></circle>'; });
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' + g + '</svg>';
  }

  // ============================================================ settings controls
  // pills : ตัวเลือกแบบ segment (เช่น ช่วงเวลา 14/30/90 วัน) — onPick = ชื่อฟังก์ชัน global, ส่งค่า v กลับ
  // YChart.pills({items:[{v,label}], active, onPick})
  function pills(o) {
    ensureCSS(); o = o || {};
    return '<span class="yc-pills">' + (o.items || []).map(function (it) {
      return '<button class="' + (String(it.v) === String(o.active) ? 'on' : '') + '" onclick="' + esc(o.onPick) + '(\'' + esc(it.v) + '\')">' + esc(it.label) + '</button>';
    }).join('') + '</span>';
  }
  // iconBtn : ปุ่มไอคอนในหัวการ์ด (เช่น ดาวน์โหลด) — onClick = JS string
  function iconBtn(icon, onClick, title) {
    ensureCSS();
    return '<button class="yc-ib" title="' + esc(title || '') + '" onclick="' + esc(onClick || '') + '"><i class="ti ' + esc(icon) + '"></i></button>';
  }
  // filterBar : แถบกรองแบบ JERA (สาขา/ช่วงวันที่/...) — fields ฉีด element id ให้โมดูลอ่านค่าเอง
  // YChart.filterBar({fields:[{id,label,type:'select'|'date'|'text',options?,value?}], onSearch})
  function filterBar(o) {
    ensureCSS(); o = o || {};
    var h = (o.fields || []).map(function (f) {
      var inner;
      if (f.type === 'select') {
        inner = '<select id="' + esc(f.id) + '">' + (f.options || []).map(function (op) {
          var v = op.v != null ? op.v : op, lb = op.label != null ? op.label : op;
          return '<option value="' + esc(v) + '"' + (String(v) === String(f.value) ? ' selected' : '') + '>' + esc(lb) + '</option>';
        }).join('') + '</select>';
      } else {
        inner = '<input id="' + esc(f.id) + '" type="' + esc(f.type || 'text') + '"' + (f.value != null ? ' value="' + esc(f.value) + '"' : '') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '>';
      }
      return '<div class="fld"><label>' + esc(f.label || '') + '</label>' + inner + '</div>';
    }).join('');
    if (o.onSearch) h += '<div class="fld"><label>&nbsp;</label><button class="go" onclick="' + esc(o.onSearch) + '"><i class="ti ti-search" style="font-size:14px;vertical-align:-2px"></i> ค้นหา</button></div>';
    return '<div class="yc-filter">' + h + '</div>';
  }
  // CSV export — ดาวน์โหลดข้อมูลกราฟ (rows = array of object, cols = [{k,h}])
  function toCSV(rows, cols) {
    var head = cols.map(function (c) { return '"' + String(c.h).replace(/"/g, '""') + '"'; }).join(',');
    var body = (rows || []).map(function (r) {
      return cols.map(function (c) { var v = r[c.k]; return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\n');
    return head + '\n' + body;
  }
  function download(filename, text, mime) {
    if (typeof document === 'undefined') return;
    var blob = new Blob(['﻿' + text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  // ============================================================ empty state
  function empty(msg, icon) {
    return '<div class="yc-empty"><i class="ti ' + esc(icon || 'ti-chart-bar-off') + '" style="font-size:22px;display:block;margin-bottom:6px;color:#CBD5E1"></i>' + esc(msg || 'ยังไม่มีข้อมูล') + '</div>';
  }

  root.YChart = {
    PALETTE: PALETTE, C: C, color: col,
    esc: esc, num: num, fmt: fmt, full: full, baht: baht, pct: pct,
    kpi: kpi, kpiRow: kpiRow, card: card, grid: grid, legend: legend,
    donut: donut, line: line, bars: bars, spark: spark, gauge: gauge, radar: radar,
    topList: topList, barList: barList, toggleChart: toggleChart, empty: empty, ensureCSS: ensureCSS,
    pills: pills, iconBtn: iconBtn, filterBar: filterBar, toCSV: toCSV, download: download, tip: tip
  };
})(typeof window !== 'undefined' ? window : this);
