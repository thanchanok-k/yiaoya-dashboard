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
  var PALETTE = ['#3DC5B7', '#0D2F4F', '#F59E0B', '#6366F1', '#EC4899', '#10B981', '#06B6D4', '#EF4444', '#8B5CF6', '#84CC16', '#F97316', '#14B8A6'];
  var C = {
    navy: '#0D2F4F', teal: '#3DC5B7', tealInk: '#0F766E', tealDark: '#2BA89B',
    grid: '#EEF2F6', axis: '#94A3B8', muted: '#64748B', faint: '#94A3B8',
    up: '#16A34A', down: '#DC2626', track: '#E2E8F0'
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
    '.yc-bars .b .vl{width:64px;text-align:right;color:#0D2F4F;font-weight:600;flex:none}';

  function ensureCSS() {
    if (typeof document === 'undefined' || document.getElementById('ychart-css')) return;
    var st = document.createElement('style'); st.id = 'ychart-css'; st.textContent = CSS;
    document.head.appendChild(st);
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
      var el = '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-dasharray="' + dash + ' ' + (CC - dash) + '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90 100 100)"><title>' + esc(p.label) + ': ' + full(p.value) + ' (' + Math.round(num(p.value) / tot * 100) + '%)</title></circle>';
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
      s.vals.forEach(function (v, i) { g += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="2.6" fill="' + c + '"><title>' + esc(s.name) + ' ' + esc(labels[i]) + ': ' + full(v) + '</title></circle>'; });
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
          g += '<rect x="' + bx + '" y="' + y + '" width="' + w + '" height="' + HH(v) + '" fill="' + (s.color || col(si)) + '" rx="2"><title>' + esc(s.name) + ' ' + esc(lb) + ': ' + full(v) + '</title></rect>';
          acc += v;
        });
      } else {
        var sn = series.length, gw = bw * 0.7, ew = gw / sn;
        series.forEach(function (s, si) {
          var v = num(s.vals[i]);
          var bx = padL + i * bw + bw * 0.15 + si * ew;
          g += '<rect x="' + bx + '" y="' + Y(v) + '" width="' + (ew * 0.86) + '" height="' + HH(v) + '" fill="' + (s.color || col(si)) + '" rx="1.5"><title>' + esc(s.name) + ' ' + esc(lb) + ': ' + full(v) + '</title></rect>';
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
      s.vals.forEach(function (v, i) { var p = pt(i, num(v) / mx); g += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.6" fill="' + c + '"><title>' + esc(axes[i]) + ': ' + full(v) + '</title></circle>'; });
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

  // ============================================================ empty state
  function empty(msg, icon) {
    return '<div class="yc-empty"><i class="ti ' + esc(icon || 'ti-chart-bar-off') + '" style="font-size:22px;display:block;margin-bottom:6px;color:#CBD5E1"></i>' + esc(msg || 'ยังไม่มีข้อมูล') + '</div>';
  }

  root.YChart = {
    PALETTE: PALETTE, C: C, color: col,
    esc: esc, num: num, fmt: fmt, full: full, baht: baht, pct: pct,
    kpi: kpi, kpiRow: kpiRow, card: card, grid: grid, legend: legend,
    donut: donut, line: line, bars: bars, spark: spark, gauge: gauge, radar: radar,
    topList: topList, barList: barList, empty: empty, ensureCSS: ensureCSS
  };
})(typeof window !== 'undefined' ? window : this);
