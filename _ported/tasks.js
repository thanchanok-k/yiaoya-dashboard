// _ported/tasks.js — FULL native port of desktop tasks_manager.html (HR Announcement admin · หน้า "มอบหมายงาน / Tasks")
// ลอกทั้งดุ้น: stats(5) + tabs(pending/overdue/done/all) + filters(search/branch/owner/template)
//   + data-table (งาน/template · สาขา · owner · ครบกำหนด · checklist progress · status pill)
//   + 2 modals (add ad-hoc · detail + checklist drill-down) + help
//   CSS เดิม (_shared_styles ที่ใช้ + <style> manager) prefix #tk ทั้งหมด · markup คง element id เดิม
//   JS หน้าเดิมรันใน scope ของ TK_RUN_PAGE_JS() · google.script.run = shim → TK_BACKEND (Supabase)
//
// ใช้ global sb/esc/$ (index.html module scope) — ห้าม redeclare · helper inline ใน scope
// fn/var ที่ inline onclick ต้องใช้ = ผูกกับ window ภายใน TK_RUN_PAGE_JS (prefix tk กันชน)
//
// backend (edge fn hr_list?type=task.updated&limit=2000 → {items}) :
//   list   → derive tasks/stats/branches/owners/templates client-side จาก payload ล่าสุดต่อ task_id
//            (ตอนนี้ list อาจว่าง = 0 task → render ได้ ไม่ error · empty state สวย)
//   detail → reuse payload ดิบที่ cache ไว้ตอน list (task + checklist จาก field ที่ฝังมา)
//   add/update/markComplete/markPending/escalate/remove/
//     checklist add/update/remove → เขียนกลับ/ส่ง LINE ไม่ได้ → stub + toast แจ้งยังไม่พร้อม

/* ============================================================
   TK_BACKEND — map google.script.run → Supabase edge fn hr_list (type=task.updated)
   คืน shape เดียวกับที่ JS เดิมคาดหวัง:
     tasksAdminList(opts)        → { tasks, stats, branches, owners, templates }
     tasksAdminGetDetail(id)     → { task, checklist, branch_name, owner_name, template_name }
     mutations                   → { ok / error } stub + toast
   ============================================================ */
var TK_FN = 'hr_list';
var TK_WRITE_FN = 'hr_write';   // edge fn กลาง CRUD (add/edit/soft-delete)
var TK_TYPE = 'task.updated';

function tk2ToArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return [];
}
function tk2Num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function tk2Bool(v) {
  if (v === true || v === 1) return true;
  var s = String(v == null ? '' : v).toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}
function tk2Date(v) {
  if (!v) return '';
  var d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function tk2DaysFromDue(due) {
  if (!due) return null;
  var d0 = new Date(due);
  if (isNaN(d0.getTime())) return null;
  d0.setHours(0, 0, 0, 0);
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((today - d0) / 86400000);   // >0 = เลยมาแล้ว · 0 = วันนี้ · <0 = ยังไม่ถึง
}

// map payload event ดิบ → checklist item shape เดิม
function tk2MapCl(c) {
  c = c || {};
  return {
    tcl_id: c.tcl_id || c.id || '',
    task_name: c.task_name || c.name || c.title || '—',
    status: String(c.status || 'pending').toLowerCase(),
    completed_at: tk2Date(c.completed_at),
  };
}

// ดึง checklist array จาก payload ดิบ (อาจมาในหลายชื่อ field)
function tk2Checklist(p) {
  var raw = p.checklist || p.checklist_items || p.items || p.tcl || [];
  return tk2ToArr(raw).map(tk2MapCl);
}

// map payload event ดิบ → task row shape ที่ JS เดิมใช้
function tk2MapTask(p) {
  p = p || {};
  var statusRaw = String(p.status || 'pending').toLowerCase();
  var due = tk2Date(p.due_date || p.due);
  var daysFromDue = (statusRaw !== 'done') ? tk2DaysFromDue(due) : null;
  var statusComputed = statusRaw;
  if (statusRaw !== 'done' && daysFromDue !== null && daysFromDue > 0) statusComputed = 'overdue';

  var cl = tk2Checklist(p);
  var clTotal = cl.length;
  var clDone = cl.filter(function (c) { return c.status === 'done'; }).length;
  var clPct = clTotal > 0 ? Math.round((clDone / clTotal) * 100) : 0;

  return {
    task_id: p.task_id || p.entity_id || p.id || '',
    template_id: p.template_id || '',
    template_name: p.template_name || p.template || p.title || 'งาน ad-hoc',
    template_frequency: p.template_frequency || p.frequency || '',
    branch_id: p.branch_id || '',
    branch_name: p.branch_name || p.branch || '—',
    owner: p.owner || p.owner_id || '',
    owner_name: p.owner_name || p.owner || '—',
    due_date: due,
    days_from_due: daysFromDue,
    status_raw: statusRaw,
    status_computed: statusComputed,
    status: statusRaw,
    notes: p.notes || '',
    created_at: tk2Date(p.created_at),
    completed_at: tk2Date(p.completed_at),
    escalation_count: tk2Num(p.escalation_count),
    line_user_id: p.line_user_id || p.line_uid || '',
    checklist_total: clTotal,
    checklist_done: clDone,
    checklist_pct: clPct,
    _checklist: cl,
    _raw: p,
  };
}

function tk2GetSb() {
  return (typeof window !== 'undefined' && window.sb) ? window.sb : (typeof sb !== 'undefined' ? sb : null);
}

// soft-delete? (latest event = deleted)
function tk2IsDeleted(p) {
  return !!(p && (p._status === 'deleted' || p._deleted === true || tk2Bool(p._deleted) || p.deleted === true));
}

// unwrap error → Promise<string>
function tk2ErrMsg(err, data) {
  if (data && data.ok === false && data.error) return Promise.resolve(String(data.error));
  if (!err) return Promise.resolve('unknown');
  if (err.context && typeof err.context.json === 'function') {
    return err.context.json().then(function (b) {
      return (b && (b.error || b.message)) ? String(b.error || b.message) : (err.message || String(err));
    }).catch(function () { return err.message || String(err); });
  }
  return Promise.resolve(err.message || String(err));
}

function tk2Is403(err) {
  if (!err) return false;
  if (err.context && typeof err.context.status === 'number' && (err.context.status === 403 || err.context.status === 401)) return true;
  if (typeof err.status === 'number' && (err.status === 403 || err.status === 401)) return true;
  var msg = String(err.message || err.error || err).toLowerCase();
  return msg.indexOf('403') >= 0 || msg.indexOf('forbidden') >= 0 ||
    msg.indexOf('401') >= 0 || msg.indexOf('unauthor') >= 0 || msg.indexOf('not allowed') >= 0;
}

// เขียนกลับผ่าน hr_write — คืน { ok, entity_id } หรือ { error }
function tk2Write(opts) {
  opts = opts || {};
  var sb = tk2GetSb();
  if (!sb || !sb.functions) return Promise.resolve({ error: 'no sb' });
  var body = { event_type: TK_TYPE, payload: opts.payload || {} };
  if (opts.entity_id) body.entity_id = opts.entity_id;
  if (opts.deleted) body.deleted = true;
  return sb.functions.invoke(TK_WRITE_FN, { body: body }).then(function (res) {
    var data = (res && res.data) || null;
    var err = res && res.error;
    if (err || (data && data.ok === false)) {
      if (tk2Is403(err)) return { error: 'ต้องเป็น HR / ล็อกอินก่อน (403)' };
      return tk2ErrMsg(err, data).then(function (m) { return { error: m }; });
    }
    // optimistic: อัปเดต cache raw ให้ detail reopen เห็นค่าใหม่ก่อน refetch
    if (opts.entity_id && opts.payload && !opts.deleted) _tk2Raw[opts.entity_id] = opts.payload;
    if (opts.entity_id && opts.deleted) delete _tk2Raw[opts.entity_id];
    return { ok: true, entity_id: (data && data.entity_id) || opts.entity_id || '' };
  }).catch(function (e) {
    if (tk2Is403(e)) return { error: 'ต้องเป็น HR / ล็อกอินก่อน (403)' };
    return tk2ErrMsg(e, null).then(function (m) { return { error: m }; });
  });
}

// today 'YYYY-MM-DD'
function tk2Today() { return tk2Date(new Date()); }

// อ่าน payload ดิบล่าสุดของ task (สำหรับ build payload เขียนทับ) → object (clone ตื้น)
function tk2RawOf(taskId) {
  var p = _tk2Raw[taskId];
  var out = {};
  if (p) { Object.keys(p).forEach(function (k) { if (k.charAt(0) !== '_') out[k] = p[k]; }); }
  out.task_id = taskId;
  if (!Array.isArray(out.checklist)) out.checklist = tk2Checklist(p || {});
  return out;
}

// cache payload ดิบล่าสุดต่อ task (ให้ detail reuse · backend ไม่มี endpoint แยก)
var _tk2Tasks = [];
var _tk2Raw = {};

function tk2FetchTasks() {
  return sb.functions.invoke(TK_FN + '?type=' + encodeURIComponent(TK_TYPE) + '&limit=2000').then(function (res) {
    var data = (res && res.data) || {};
    var items = tk2ToArr(data.items);
    var seen = {}; var rows = [];
    items.forEach(function (p) {
      var id = p.task_id || p.entity_id || p.id || '';
      if (!id || seen[id]) return;
      seen[id] = true;
      if (tk2IsDeleted(p)) { delete _tk2Raw[id]; return; }   // กรองรายการที่ลบ (soft delete) ทิ้ง
      _tk2Raw[id] = p;
      rows.push(tk2MapTask(p));
    });
    _tk2Tasks = rows;
    return rows;
  }).catch(function (e) {
    console.warn('[TK_BACKEND] list fetch failed', e);
    _tk2Tasks = [];
    return [];
  });
}

var TK_BACKEND = {
  // list — { tasks, stats, branches, owners, templates }
  tasksAdminList: function (opts) {
    opts = opts || {};
    return tk2FetchTasks().then(function (all) {
      var tab = opts.tab || 'pending';
      var filtered = all.slice();

      if (tab === 'pending') filtered = filtered.filter(function (t) { return t.status_raw !== 'done'; });
      else if (tab === 'overdue') filtered = filtered.filter(function (t) { return t.status_raw !== 'done' && t.status_computed === 'overdue'; });
      else if (tab === 'done') filtered = filtered.filter(function (t) { return t.status_raw === 'done'; });
      // tab === 'all' → ไม่กรอง

      if (opts.branch) filtered = filtered.filter(function (t) { return t.branch_id === opts.branch; });
      if (opts.owner) filtered = filtered.filter(function (t) { return t.owner === opts.owner; });
      if (opts.template) filtered = filtered.filter(function (t) { return t.template_id === opts.template; });
      if (opts.search) {
        var q = String(opts.search).toLowerCase();
        filtered = filtered.filter(function (t) {
          return (t.task_id || '').toLowerCase().indexOf(q) >= 0 ||
            (t.template_name || '').toLowerCase().indexOf(q) >= 0 ||
            (t.owner_name || '').toLowerCase().indexOf(q) >= 0 ||
            (t.notes || '').toLowerCase().indexOf(q) >= 0;
        });
      }

      // sort: overdue ก่อน → pending → done · ใน group เรียงตาม due_date
      var rank = function (t) { return t.status_raw === 'done' ? 2 : (t.status_computed === 'overdue' ? 0 : 1); };
      filtered.sort(function (a, b) {
        var ra = rank(a), rb = rank(b);
        if (ra !== rb) return ra - rb;
        return (a.due_date || '').localeCompare(b.due_date || '');
      });

      var todayStr = tk2Date(new Date());
      var stats = {
        total: all.length,
        pending: all.filter(function (t) { return t.status_raw !== 'done' && t.status_computed !== 'overdue'; }).length,
        overdue: all.filter(function (t) { return t.status_raw !== 'done' && t.status_computed === 'overdue'; }).length,
        done: all.filter(function (t) { return t.status_raw === 'done'; }).length,
        done_today: all.filter(function (t) { return t.status_raw === 'done' && t.completed_at === todayStr; }).length,
        escalated: all.filter(function (t) { return t.escalation_count > 0; }).length,
      };

      // branches / owners / templates จาก tasks ที่มี (backend ไม่มี master list บน dashboard)
      var bSeen = {}, branches = [];
      var oSeen = {}, owners = [];
      var tSeen = {}, templates = [];
      all.forEach(function (t) {
        if (t.branch_id && !bSeen[t.branch_id]) { bSeen[t.branch_id] = true; branches.push({ id: t.branch_id, name: t.branch_name || t.branch_id }); }
        if (t.owner && !oSeen[t.owner]) { oSeen[t.owner] = true; owners.push({ id: t.owner, name: t.owner_name || t.owner }); }
        if (t.template_id && !tSeen[t.template_id]) { tSeen[t.template_id] = true; templates.push({ id: t.template_id, name: t.template_name || t.template_id }); }
      });

      return { tasks: filtered, stats: stats, branches: branches, owners: owners, templates: templates };
    });
  },

  // detail — { task, checklist, branch_name, owner_name, template_name } (reuse cache)
  tasksAdminGetDetail: function (taskId) {
    var build = function () {
      var p = _tk2Raw[taskId];
      var t = p ? tk2MapTask(p) : _tk2Tasks.find(function (x) { return x.task_id === taskId; });
      if (!t) return { error: 'ไม่พบงาน' };
      return {
        task: {
          task_id: t.task_id,
          status: t.status_raw,
          due_date: t.due_date,
          owner: t.owner,
          notes: t.notes,
          created_at: t.created_at,
          completed_at: t.completed_at,
          escalation_count: t.escalation_count,
        },
        checklist: t._checklist || [],
        branch_name: t.branch_name,
        owner_name: t.owner_name,
        template_name: t.template_name,
      };
    };
    if (_tk2Tasks.length || Object.keys(_tk2Raw).length) return Promise.resolve(build());
    return tk2FetchTasks().then(build);
  },

  // ---- mutations: เขียนกลับจริงผ่าน hr_write ----
  // เพิ่มงาน ad-hoc — ไม่ส่ง entity_id = สร้างใหม่ · gen task_id ฝั่ง client
  tasksAdminAdd: function (payload) {
    payload = payload || {};
    if (!payload.branch_id) return Promise.resolve({ error: 'เลือกสาขา' });
    if (!payload.due_date) return Promise.resolve({ error: 'ระบุวันครบกำหนด' });
    var taskId = 'TASK_' + Date.now().toString(36).toUpperCase();
    var p = {
      task_id: taskId,
      branch_id: payload.branch_id,
      owner: payload.owner || '',
      template_id: payload.template_id || '',
      due_date: payload.due_date,
      notes: String(payload.notes || '').trim(),
      status: 'pending',
      escalation_count: 0,
      created_at: tk2Today(),
      checklist: [],
    };
    return tk2Write({ entity_id: taskId, payload: p }).then(function (r) {
      if (r && r.ok) r.task_id = taskId;
      return r;
    });
  },
  // แก้ notes / due / owner — เขียนทับ entity เดิม (merge กับ payload ดิบล่าสุด)
  tasksAdminUpdate: function (taskId, updates) {
    updates = updates || {};
    if (!taskId) return Promise.resolve({ error: 'ไม่มี task_id' });
    var p = tk2RawOf(taskId);
    if (updates.notes != null) p.notes = String(updates.notes).trim();
    if (updates.due_date != null) p.due_date = updates.due_date;
    if (updates.owner != null) p.owner = updates.owner;
    return tk2Write({ entity_id: taskId, payload: p });
  },
  // มาร์คเสร็จ
  tasksAdminMarkComplete: function (taskId) {
    if (!taskId) return Promise.resolve({ error: 'ไม่มี task_id' });
    var p = tk2RawOf(taskId);
    p.status = 'done';
    p.completed_at = tk2Today();
    return tk2Write({ entity_id: taskId, payload: p });
  },
  // ย้อนเป็น pending
  tasksAdminMarkPending: function (taskId) {
    if (!taskId) return Promise.resolve({ error: 'ไม่มี task_id' });
    var p = tk2RawOf(taskId);
    p.status = 'pending';
    p.completed_at = '';
    return tk2Write({ entity_id: taskId, payload: p });
  },
  // Escalate — เพิ่ม count (LINE push ยังไม่พร้อมบน dashboard — เขียนเฉพาะ count)
  tasksAdminEscalate: function (taskId) {
    if (!taskId) return Promise.resolve({ error: 'ไม่มี task_id' });
    var p = tk2RawOf(taskId);
    var cnt = tk2Num(p.escalation_count) + 1;
    p.escalation_count = cnt;
    return tk2Write({ entity_id: taskId, payload: p }).then(function (r) {
      if (r && r.ok) r.escalation_count = cnt;
      return r;
    });
  },
  // ลบงาน (soft) + checklist (ฝังในงานเดียวกัน หายไปด้วย)
  tasksAdminRemove: function (taskId) {
    if (!taskId) return Promise.resolve({ error: 'ไม่มี task_id' });
    return tk2Write({ entity_id: taskId, deleted: true, payload: { task_id: taskId } });
  },
  // เพิ่ม checklist item — append เข้า checklist ของงานแล้วเขียนทับ
  tasksAdminAddChecklistItem: function (taskId, name) {
    if (!taskId) return Promise.resolve({ error: 'ไม่มี task_id' });
    if (!String(name || '').trim()) return Promise.resolve({ error: 'พิมพ์ชื่อ checklist' });
    var p = tk2RawOf(taskId);
    p.checklist = tk2ToArr(p.checklist).slice();
    p.checklist.push({ tcl_id: 'TCL_' + Date.now().toString(36).toUpperCase(), task_name: String(name).trim(), status: 'pending', completed_at: '' });
    return tk2Write({ entity_id: taskId, payload: p });
  },
  // tick / แก้ checklist item — หา item ตาม tcl_id แล้วอัปเดต status
  tasksAdminUpdateChecklistItem: function (tclId, updates) {
    updates = updates || {};
    if (!tclId) return Promise.resolve({ error: 'ไม่มี checklist id' });
    var taskId = tk2FindTaskByTcl(tclId);
    if (!taskId) return Promise.resolve({ error: 'ไม่พบงานของ checklist นี้' });
    var p = tk2RawOf(taskId);
    p.checklist = tk2ToArr(p.checklist).map(function (c) {
      var cid = c.tcl_id || c.id || '';
      if (String(cid) === String(tclId)) {
        var nc = {}; Object.keys(c).forEach(function (k) { nc[k] = c[k]; });
        if (updates.status != null) {
          nc.status = updates.status;
          nc.completed_at = (updates.status === 'done') ? tk2Today() : '';
        }
        if (updates.task_name != null) nc.task_name = updates.task_name;
        return nc;
      }
      return c;
    });
    return tk2Write({ entity_id: taskId, payload: p });
  },
  // ลบ checklist item — กรองออกแล้วเขียนทับ
  tasksAdminRemoveChecklistItem: function (tclId) {
    if (!tclId) return Promise.resolve({ error: 'ไม่มี checklist id' });
    var taskId = tk2FindTaskByTcl(tclId);
    if (!taskId) return Promise.resolve({ error: 'ไม่พบงานของ checklist นี้' });
    var p = tk2RawOf(taskId);
    p.checklist = tk2ToArr(p.checklist).filter(function (c) {
      var cid = c.tcl_id || c.id || '';
      return String(cid) !== String(tclId);
    });
    return tk2Write({ entity_id: taskId, payload: p });
  },
};

// หา task_id จาก tcl_id (เดิน checklist ของ raw tasks ที่ cache ไว้)
function tk2FindTaskByTcl(tclId) {
  var keys = Object.keys(_tk2Raw);
  for (var i = 0; i < keys.length; i++) {
    var p = _tk2Raw[keys[i]];
    var cl = tk2Checklist(p);
    for (var j = 0; j < cl.length; j++) {
      if (String(cl[j].tcl_id) === String(tclId)) return keys[i];
    }
  }
  return '';
}

/* ============================================================
   mountTasks — set innerHTML (CSS+markup) แล้วรัน JS หน้าเดิม
   ============================================================ */
function mountTasks() {
  if (!document.getElementById('wrap-tasks')) return;
  var wrap = document.getElementById('wrap-tasks');
  wrap.innerHTML = '<style>' + TK_CSS() + '</style><div id="tk">' + TK_MARKUP() + '</div>';
  TK_RUN_PAGE_JS();
}

/* ===== CSS เดิม (_shared_styles ที่ใช้ + <style> ใน tasks_manager.html) · prefix ทุก selector ด้วย #tk =====
   ตัด .app-shell/sidebar/main-area/topbar/page-head shell ออก (dashboard มี shell แล้ว) */
function TK_CSS() {
  return [
    // tokens (จาก _shared_styles)
    '#tk{--navy:#0D2F4F;--navy-2:#1E4A73;--teal:#3DC5B7;--teal-dark:#2BA89B;--bg:#F8FAFC;--surface:#fff;--border:#E2E8F0;--border-strong:#CBD5E1;--text:#0F172A;--text-muted:#64748B;--text-faint:#94A3B8;--danger:#B91C1C;--danger-bg:#FEE2E2;--success:#047857;--success-bg:#DCFCE7;--warning:#B45309;--warning-bg:#FEF3C7;--info:#1E40AF;--info-bg:#DBEAFE;color:var(--text);font-size:13px;line-height:1.5}',
    '#tk *{box-sizing:border-box}',
    // buttons (จาก _shared_styles)
    '#tk .btn{padding:7px 14px;border:1px solid var(--border-strong);border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;background:var(--surface);color:var(--text);display:inline-flex;align-items:center;gap:6px;transition:all .15s;line-height:1.4;text-decoration:none}',
    '#tk .btn:hover{border-color:var(--navy)}',
    '#tk .btn svg{width:14px;height:14px}',
    '#tk .btn-primary{background:var(--teal);color:#fff;border-color:var(--teal)}',
    '#tk .btn-primary:hover{background:var(--teal-dark);border-color:var(--teal-dark)}',
    '#tk .btn-success{background:var(--success);color:#fff;border-color:var(--success)}',
    '#tk .btn-success:hover{filter:brightness(1.08)}',
    '#tk .btn[disabled]{opacity:.5;cursor:not-allowed}',
    '#tk .btn-sm{padding:5px 10px;font-size:12px}',
    '#tk .btn-icon{padding:5px;width:28px;height:28px;justify-content:center}',
    '#tk .btn-icon-danger{color:var(--danger);border-color:var(--border-strong)}',
    '#tk .btn-icon-danger:hover{background:var(--danger-bg);border-color:var(--danger)}',
    '#tk .btn-help{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-strong);border-radius:8px;background:#fff;color:var(--text-muted);cursor:pointer}',
    '#tk .btn-help:hover{border-color:var(--teal);color:var(--teal-dark)}',
    '#tk .btn-help svg{width:14px;height:14px}',
    // page head (native บน dashboard)
    '#tk .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border)}',
    '#tk .page-head h1{font-size:20px;font-weight:600;color:var(--navy);letter-spacing:-.02em;margin:0;display:flex;align-items:center;gap:8px}',
    '#tk .page-head h1 svg{width:18px;height:18px;color:var(--teal)}',
    '#tk .page-head .subtitle{font-size:12px;color:var(--text-muted);margin-top:4px}',
    '#tk .page-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;align-items:center}',
    // stat cards (cols-5)
    '#tk .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px}',
    '@media (max-width:1100px){#tk .stats{grid-template-columns:repeat(3,1fr)}}',
    '@media (max-width:600px){#tk .stats{grid-template-columns:repeat(2,1fr)}}',
    '#tk .stat{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px 12px 16px;position:relative;overflow:hidden}',
    '#tk .stat-stripe{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--teal)}',
    '#tk .stat-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '#tk .stat-value{font-size:22px;font-weight:600;line-height:1;margin-top:4px;color:var(--navy);letter-spacing:-.02em}',
    '#tk .stat-sub{font-size:10px;color:var(--text-faint);margin-top:4px}',
    // tab toggle
    '#tk .tab-row{display:flex;gap:4px;padding:4px;background:#F1F5F9;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}',
    '#tk .tab-btn{padding:6px 14px;border:none;background:transparent;border-radius:6px;font-family:inherit;font-size:12px;font-weight:500;color:var(--text-muted);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s}',
    '#tk .tab-btn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.05)}',
    '#tk .tab-btn:hover:not(.active){color:var(--text)}',
    '#tk .tab-btn svg{width:13px;height:13px}',
    '#tk .tab-btn .count{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--text-faint);color:white;font-weight:600}',
    '#tk .tab-btn.active .count{background:var(--navy)}',
    '#tk .tab-btn.tab-overdue.active .count{background:var(--danger)}',
    // filters
    '#tk .filters{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}',
    '#tk .filter{display:flex;flex-direction:column;gap:2px}',
    '#tk .filter label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}',
    '#tk .filter input,#tk .filter select{height:32px;box-sizing:border-box;padding:0 8px;font-size:12px;border:.5px solid var(--border-strong);border-radius:6px;min-width:160px;font-family:inherit;background:#fff;color:var(--text)}',
    '#tk .filter input:focus,#tk .filter select:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    // section
    '#tk .section{background:#fff;border:1px solid var(--border);border-radius:10px;overflow:hidden}',
    '#tk .section-header{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border)}',
    '#tk .section-icon{width:34px;height:34px;border-radius:8px;background:#E6F7F5;color:var(--teal-dark);display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '#tk .section-icon svg{width:18px;height:18px}',
    '#tk .section-title{font-size:14px;font-weight:600;color:var(--navy)}',
    '#tk .section-sub{font-size:11px;color:var(--text-muted);margin-top:2px}',
    '#tk .loading{text-align:center;padding:50px;color:var(--text-muted);font-size:13px}',
    // data table
    '#tk .data-table{width:100%;border-collapse:collapse;font-size:13px}',
    '#tk .data-table thead th{background:#F8FAFC;padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}',
    '#tk .data-table tbody td{padding:12px 14px;border-bottom:1px solid #F1F5F9;vertical-align:middle}',
    '#tk .data-table tbody tr{border-left:3px solid transparent;transition:background .15s;cursor:pointer}',
    '#tk .data-table tbody tr:hover{background:#FAFBFC}',
    '#tk .data-table tbody tr.is-overdue{border-left-color:var(--danger);background:#FEF2F2}',
    '#tk .data-table tbody tr.is-soon{border-left-color:var(--warning)}',
    '#tk .data-table tbody tr.is-done{opacity:.65}',
    // status pills
    '#tk .st-pill{display:inline-block;padding:2px 9px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}',
    '#tk .st-pending{background:var(--info-bg);color:var(--info)}',
    '#tk .st-overdue{background:var(--danger-bg);color:var(--danger)}',
    '#tk .st-done{background:var(--success-bg);color:var(--success)}',
    // due cell
    '#tk .due-cell{font-size:12px;font-family:"SF Mono",Consolas,monospace}',
    '#tk .due-meta{display:block;font-size:10px;color:var(--text-faint);margin-top:2px}',
    '#tk .due-meta.overdue{color:var(--danger);font-weight:600}',
    '#tk .due-meta.soon{color:var(--warning);font-weight:600}',
    // progress bar
    '#tk .progress-wrap{display:flex;align-items:center;gap:8px}',
    '#tk .progress-bg{width:80px;height:6px;background:#F1F5F9;border-radius:3px;overflow:hidden}',
    '#tk .progress-fill{height:100%;background:var(--success);border-radius:3px;transition:width .3s}',
    '#tk .progress-fill.partial{background:var(--info)}',
    '#tk .progress-fill.empty{background:var(--text-faint)}',
    '#tk .progress-text{font-size:11px;color:var(--text-muted);font-weight:600;font-family:monospace;min-width:36px}',
    // escalation badge
    '#tk .escalation-badge{display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:10px;background:var(--warning-bg);color:var(--warning);font-size:10px;font-weight:700;font-family:monospace}',
    '#tk .escalation-badge svg{width:11px;height:11px}',
    // row template name
    '#tk .row-template-name{font-weight:500;font-size:13px}',
    '#tk .row-template-meta{display:block;font-size:10px;color:var(--text-faint);margin-top:2px;font-family:monospace}',
    // empty
    '#tk .empty-state{padding:60px 20px;text-align:center;color:var(--text-muted)}',
    '#tk .empty-state .empty-icon{width:50px;height:50px;margin:0 auto 14px;opacity:.4}',
    '#tk .empty-state .empty-icon svg{width:50px;height:50px}',
    '#tk .empty-title{font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px}',
    '#tk .empty-sub{font-size:12px;color:var(--text-muted)}',
    '#tk .empty{padding:40px 20px;text-align:center;color:var(--text-muted)}',
  ].join('\n') + TK_CSS2();
}

/* CSS part 2 — modal / field / checklist / misc */
function TK_CSS2() {
  return '\n' + [
    // modal
    '#tk .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:none;align-items:center;justify-content:center;z-index:9000;padding:20px}',
    '#tk .modal-bg.active{display:flex}',
    '#tk .modal{background:#fff;border-radius:12px;max-width:520px;width:92%;max-height:92vh;overflow-y:auto}',
    '#tk .modal.large{max-width:720px}',
    '#tk .modal-header{padding:16px 20px;border-bottom:.5px solid var(--border)}',
    '#tk .modal-header h2{font-size:16px;margin:0}',
    '#tk .modal-header p{font-size:12px;color:var(--text-muted);margin:4px 0 0}',
    '#tk .modal-body{padding:16px 20px}',
    '#tk .modal-footer{padding:12px 20px;border-top:.5px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
    // field
    '#tk .field{margin-bottom:12px}',
    '#tk .field label{display:block;font-size:11px;color:var(--text-muted);margin-bottom:4px;font-weight:500}',
    '#tk .field input,#tk .field select,#tk .field textarea{width:100%;padding:7px 10px;font-size:13px;font-family:inherit;border:.5px solid var(--border-strong);border-radius:6px;box-sizing:border-box;background:#fff;color:var(--text)}',
    '#tk .field input:focus,#tk .field select:focus,#tk .field textarea:focus{outline:0;border-color:var(--teal);box-shadow:0 0 0 3px rgba(61,197,183,.15)}',
    '#tk .field textarea{resize:vertical;min-height:60px}',
    '#tk .field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    // detail meta
    '#tk .detail-meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px 18px;padding:14px;background:#F8FAFC;border-radius:8px;margin-bottom:14px;font-size:12px}',
    '#tk .detail-meta .label{color:var(--text-muted);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.04em}',
    '#tk .detail-meta .value{color:var(--text);font-weight:500;margin-top:2px;font-size:13px}',
    // checklist
    '#tk .checklist-block{background:#F8FAFC;border-radius:8px;padding:10px;margin-bottom:14px}',
    '#tk .checklist-empty{padding:14px;text-align:center;color:var(--text-faint);font-size:12px;font-style:italic}',
    '#tk .checklist-row{display:grid;grid-template-columns:22px 1fr auto;gap:10px;align-items:center;padding:8px 12px;background:white;border-radius:6px;margin-bottom:4px;border:1px solid var(--border)}',
    '#tk .checklist-row.is-done{background:#F0FDF4;border-color:#BBF7D0}',
    '#tk .checklist-row.is-done .cl-name{text-decoration:line-through;color:var(--text-muted)}',
    '#tk .cl-toggle{width:18px;height:18px;border-radius:4px;border:1.5px solid var(--border-strong);cursor:pointer;display:flex;align-items:center;justify-content:center;background:white;transition:all .15s}',
    '#tk .cl-toggle:hover{border-color:var(--success)}',
    '#tk .cl-toggle.checked{background:var(--success);border-color:var(--success)}',
    '#tk .cl-toggle svg{width:11px;height:11px;color:white;display:none}',
    '#tk .cl-toggle.checked svg{display:block}',
    '#tk .cl-name{font-size:13px}',
    '#tk .cl-actions{display:flex;gap:4px}',
    '#tk .cl-actions button svg{width:12px;height:12px}',
    '#tk .cl-meta{display:block;font-size:10px;color:var(--text-faint);margin-top:2px}',
    // add new checklist
    '#tk .add-cl-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:8px 12px;background:white;border:1px dashed var(--border-strong);border-radius:6px;margin-top:6px}',
    '#tk .add-cl-row input{border:none;padding:4px;font-size:13px;font-family:inherit;outline:none}',
    '#tk .add-cl-row input::placeholder{color:var(--text-faint)}',
    // modal section title
    '#tk .modal-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}',
    '#tk .modal-section-title:first-child{margin-top:0}',
    '#tk .ms-text{display:flex;align-items:center;gap:8px}',
    '#tk .modal-section-title svg{width:14px;height:14px;color:var(--text-faint)}',
    '#tk .ms-count{font-size:10px;padding:1px 7px;border-radius:10px;background:var(--info-bg);color:var(--info);font-weight:600;text-transform:none;letter-spacing:0}',
  ].join('\n');
}

/* ===== markup เดิม ครบ header + stats + tabs + filters + section + 2 modals =====
   คง element id เดิมทั้งหมด · ตัด sidebar/sheet_link/brand_footer/app-shell/topbar ออก */
function TK_MARKUP() {
  return [
    // header (native บน dashboard)
    '<header class="page-head">',
    '  <div>',
    '    <h1>',
    '      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
    '      Tasks (งานที่ค้างอยู่)',
    '    </h1>',
    '    <div class="subtitle">งานที่ assign แล้วยังไม่เสร็จ · auto-escalate ถ้าเลย due date</div>',
    '  </div>',
    '  <div class="page-actions">',
    '    <button class="btn-help" onclick="tkShowHelp(TK_HELP)" title="ช่วยเหลือ" id="help-btn" data-tip="คู่มือการใช้หน้านี้"></button>',
    '    <button class="btn btn-sm" onclick="tkLoadList()" id="refresh-btn"></button>',
    '    <button class="btn btn-primary" onclick="tkOpenAdd()" id="add-btn"></button>',
    '  </div>',
    '</header>',
    // stats
    '<div class="stats cols-5" id="stats"></div>',
    // tabs
    '<div class="tab-row" id="tab-row">',
    '  <button class="tab-btn active" id="tab-pending" onclick="tkSetTab(\'pending\')"></button>',
    '  <button class="tab-btn tab-overdue" id="tab-overdue" onclick="tkSetTab(\'overdue\')"></button>',
    '  <button class="tab-btn" id="tab-done" onclick="tkSetTab(\'done\')"></button>',
    '  <button class="tab-btn" id="tab-all" onclick="tkSetTab(\'all\')"></button>',
    '</div>',
    // filters
    '<div class="filters">',
    '  <div class="filter">',
    '    <label>ค้นหา</label>',
    '    <input type="search" id="filter-search" placeholder="task ID / template / owner / notes" oninput="tkLoadList()">',
    '  </div>',
    '  <div class="filter">',
    '    <label>สาขา</label>',
    '    <select id="filter-branch" onchange="tkLoadList()"><option value="">ทุกสาขา</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>Owner</label>',
    '    <select id="filter-owner" onchange="tkLoadList()"><option value="">ทุกคน</option></select>',
    '  </div>',
    '  <div class="filter">',
    '    <label>Template</label>',
    '    <select id="filter-template" onchange="tkLoadList()"><option value="">ทั้งหมด</option></select>',
    '  </div>',
    '</div>',
    // section
    '<div class="section">',
    '  <div class="section-header">',
    '    <div class="section-icon" id="section-icon"></div>',
    '    <div style="flex:1">',
    '      <div class="section-title" id="section-title">งานที่ต้องทำ</div>',
    '      <div class="section-sub">คลิกแถวเพื่อดูรายละเอียด + checklist</div>',
    '    </div>',
    '  </div>',
    '  <div id="content" class="loading">กำลังโหลด...</div>',
    '</div>',
    TK_MODALS(),
  ].join('\n');
}

/* 2 modals · คง element id เดิม */
function TK_MODALS() {
  return [
    // Modal: Add ad-hoc task
    '<div class="modal-bg" id="add-bg" onclick="if(event.target===this)tkCloseAdd()">',
    '  <div class="modal">',
    '    <div class="modal-header"><h2>เพิ่มงาน ad-hoc</h2><p>งานที่ไม่ได้มาจาก template — ใส่เอง</p></div>',
    '    <div class="modal-body">',
    '      <div class="field-grid">',
    '        <div class="field"><label>สาขา *</label><select id="m-branch"></select></div>',
    '        <div class="field"><label>Owner</label><select id="m-owner"><option value="">— เลือก —</option></select></div>',
    '      </div>',
    '      <div class="field-grid">',
    '        <div class="field"><label>Template (ไม่บังคับ)</label><select id="m-template"><option value="">— ad-hoc (ไม่มี template) —</option></select></div>',
    '        <div class="field"><label>วันครบกำหนด *</label><input type="date" id="m-due"></div>',
    '      </div>',
    '      <div class="field"><label>หมายเหตุ / รายละเอียดงาน</label><textarea id="m-notes" placeholder="งานนี้ต้องทำอะไร..."></textarea></div>',
    '    </div>',
    '    <div class="modal-footer">',
    '      <button class="btn" onclick="tkCloseAdd()">ยกเลิก</button>',
    '      <button class="btn btn-primary" onclick="tkSaveAdd()" id="add-save-btn"></button>',
    '    </div>',
    '  </div>',
    '</div>',
    // Modal: Task detail + checklist
    '<div class="modal-bg" id="detail-bg" onclick="if(event.target===this)tkCloseDetail()">',
    '  <div class="modal large">',
    '    <div class="modal-header"><h2 id="d-title">งาน</h2><p id="d-sub">รายละเอียด</p></div>',
    '    <div class="modal-body">',
    '      <div class="detail-meta" id="d-meta"></div>',
    '      <div class="modal-section-title">',
    '        <span class="ms-text" id="ms-checklist-text"></span>',
    '        <span class="ms-count" id="ms-checklist-count">0/0</span>',
    '      </div>',
    '      <div class="checklist-block" id="d-checklist"></div>',
    '      <div class="modal-section-title"><span class="ms-text" id="ms-edit-text"></span></div>',
    '      <div class="field"><label>หมายเหตุ</label><textarea id="d-notes" placeholder="..."></textarea></div>',
    '      <div class="field-grid">',
    '        <div class="field"><label>วันครบกำหนด</label><input type="date" id="d-due"></div>',
    '        <div class="field"><label>Owner</label><select id="d-owner"><option value="">— เลือก —</option></select></div>',
    '      </div>',
    '    </div>',
    '    <div class="modal-footer" style="justify-content:space-between">',
    '      <div style="display:flex;gap:6px">',
    '        <button class="btn" id="d-escalate-btn" onclick="tkEscalateTask()" title="แจ้งเตือน owner ผ่าน LINE"></button>',
    '        <button class="btn btn-icon-danger" id="d-remove-btn" onclick="tkRemoveTask()" title="ลบงาน"></button>',
    '      </div>',
    '      <div style="display:flex;gap:6px">',
    '        <button class="btn" onclick="tkCloseDetail()">ปิด</button>',
    '        <button class="btn" id="d-revert-btn" onclick="tkRevertTask()" style="display:none">ย้อนเป็น pending</button>',
    '        <button class="btn btn-primary" id="d-save-btn" onclick="tkSaveDetail()"></button>',
    '        <button class="btn btn-success" id="d-complete-btn" onclick="tkCompleteTask()"></button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ============================================================
   TK_RUN_PAGE_JS — รัน JS ของหน้าเดิม (closure) · google = shim → TK_BACKEND
   helper (ICONS/showHelp/showToast/escapeHtml/escapeAttr) inline เข้ามา
   fn ที่ inline onclick ต้องใช้ → ผูกกับ window (prefix tk กันชน) ตอนท้าย
   ============================================================ */
function TK_RUN_PAGE_JS() {

  // ---- google.script.run shim → TK_BACKEND (async, คืน shape เดิม) ----
  function _tk2MakeChain() {
    var h = { _s: null, _f: null };
    var p = new Proxy(function () {}, {
      get: function (_t, prop) {
        if (prop === 'withSuccessHandler') return function (cb) { h._s = cb; return p; };
        if (prop === 'withFailureHandler') return function (cb) { h._f = cb; return p; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          if (TK_BACKEND[prop]) {
            Promise.resolve().then(function () { return TK_BACKEND[prop].apply(TK_BACKEND, args); })
              .then(function (r) { if (h._s) h._s(r); })
              .catch(function (e) { if (h._f) h._f(e); else console.error('[TK_BACKEND ' + String(prop) + ']', e); });
          } else { console.warn('[TK_BACKEND] no method:', prop); if (h._s) h._s(null); }
          return p;
        };
      },
    });
    return p;
  }
  var google = { script: { run: null } };
  Object.defineProperty(google.script, 'run', { get: function () { return _tk2MakeChain(); } });

  // ---- helpers (inline · ใช้ global esc ถ้ามี, fallback ใน scope) ----
  const ICONS = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="6" y1="6" y2="18"/><line x1="6" x2="18" y1="6" y2="18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
  };

  function escapeHtml(s) {
    if (typeof window !== 'undefined' && typeof window.esc === 'function') return window.esc(String(s == null ? '' : s));
    const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML;
  }
  function escapeAttr(s) { return String(s == null ? '' : s).replace(/'/g, '&#39;').replace(/"/g, '&quot;'); }
  function showToast(msg, type) {
    let t = document.getElementById('tk2-toast');
    if (!t) { t = document.createElement('div'); t.id = 'tk2-toast'; t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:6px;color:#fff;box-shadow:0 10px 25px rgba(0,0,0,.15);font-size:13px;font-weight:500;transition:all .3s'; document.body.appendChild(t); }
    t.style.background = type === 'error' ? '#B91C1C' : type === 'success' ? '#047857' : '#0F172A';
    t.textContent = msg; t.style.opacity = '1'; t.style.transform = 'translateY(0)';
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(100px)'; }, 2800);
  }
  window.tk2Toast = showToast;
  function showHelp(content) {
    let bg = document.getElementById('tk-help-modal-bg');
    if (!bg) { bg = document.createElement('div'); bg.id = 'tk-help-modal-bg'; bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9500;align-items:center;justify-content:center;padding:20px;display:none'; bg.onclick = e => { if (e.target === bg) bg.style.display = 'none'; }; document.body.appendChild(bg); }
    const sections = (content.sections || []).map(s => {
      const warn = s.type === 'warn';
      const items = (s.items || []).map(it => '<li style="margin-bottom:4px">' + (typeof it === 'string' ? it : (it.html || '')) + '</li>').join('');
      return '<div style="background:' + (warn ? '#FFFBEB' : '#F8FAFC') + ';border-radius:8px;padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (warn ? '#B45309' : '#CBD5E1') + '"><div style="font-size:11px;font-weight:600;color:' + (warn ? '#B45309' : '#64748B') + ';text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">' + escapeHtml(s.title) + '</div><ul style="margin-left:18px;font-size:13px;line-height:1.7">' + items + '</ul></div>';
    }).join('');
    bg.innerHTML = '<div style="max-width:600px;width:100%;background:#fff;border-radius:12px;display:flex;flex-direction:column;max-height:90vh"><div style="padding:20px 24px 16px;border-bottom:1px solid #E2E8F0"><div style="display:flex;align-items:center;justify-content:space-between"><div><h2 style="font-size:16px;font-weight:600;color:#0F172A;margin:0">' + escapeHtml(content.title || 'Help') + '</h2>' + (content.subtitle ? '<p style="font-size:12px;color:#64748B;margin-top:4px">' + escapeHtml(content.subtitle) + '</p>' : '') + '</div><button onclick="document.getElementById(\'tk-help-modal-bg\').style.display=\'none\'" style="border:none;background:transparent;cursor:pointer;color:#64748B">' + ICONS.close + '</button></div></div><div style="padding:20px 24px;overflow-y:auto">' + (content.intro ? '<div style="padding:12px 14px;background:#EFF6FF;color:#1D4ED8;border-radius:6px;font-size:13px;line-height:1.6;margin-bottom:14px">' + escapeHtml(content.intro) + '</div>' : '') + sections + '</div><div style="padding:14px 24px;border-top:1px solid #E2E8F0;background:#F8FAFC;display:flex;justify-content:flex-end"><button class="btn btn-primary" onclick="document.getElementById(\'tk-help-modal-bg\').style.display=\'none\'">เข้าใจแล้ว</button></div></div>';
    bg.style.display = 'flex';
  }

  /* ====================================================================
     ===== JS หน้าเดิม tasks_manager.html (ลอกทั้งดุ้น) =====
     ใช้ scope ใต้ #tk กันชน id (helper getById)
     ==================================================================== */
  const _tkRoot = document.getElementById('tk');
  function getById(id) { return _tkRoot ? _tkRoot.querySelector('#' + id) : document.getElementById(id); }

  let allData = null;
  let currentTab = 'pending';
  let currentDetail = null;

  const HELP = {
    title: 'Tasks Manager — งานที่ต้องทำ',
    subtitle: 'Sheets: 12_Tasks + 13_Task_Checklist',
    intro: 'หน้านี้แสดง task instance ที่ระบบ generate ตามรอบ (จาก Task Templates) + งาน ad-hoc ที่เพิ่มเอง พร้อม checklist drill-down ของแต่ละงาน',
    sections: [
      { title: 'การใช้งาน', items: [
        'แท็บ <strong>รออยู่</strong> — งานที่ยัง pending + overdue (ทำก่อน)',
        'แท็บ <strong>เกินกำหนด</strong> — เฉพาะที่เลย due date แล้ว',
        'แท็บ <strong>เสร็จแล้ว</strong> — งานที่ done (ดูประวัติ)',
        'คลิกแถวเพื่อเปิด detail + tick checklist ทีละข้อ',
        'กด <strong>เพิ่มงาน</strong> เพื่อสร้างงาน ad-hoc (ไม่ผูก template)',
      ]},
      { title: 'Smart features', items: [
        'Auto overdue detection — ถ้า status=pending แต่ due_date เลยมาแล้ว → แสดง overdue สีแดง',
        'Progress bar checklist — แสดง % เสร็จต่องาน',
        'Escalation — กดปุ่ม push LINE หา owner + เพิ่ม escalation_count',
        'Cascade delete — ลบงานจะลบ checklist ทั้งหมดที่ผูกอยู่',
      ]},
      { type: 'warn', title: 'ระวัง', items: [
        'งานที่มาจาก template (template_id ไม่ว่าง) — แก้แล้วระบบ auto-generate ใหม่ไม่ทับ',
        'ลบงาน → checklist หาย ไม่สามารถกู้ได้',
        'Escalate ส่ง LINE → owner ต้อง link line_user_id แล้วเท่านั้น',
        'มาร์ค done แล้วย้อนได้ (revert) แต่ระบบจะ log ใน 90_Audit_Log',
        'เพิ่ม/แก้/มาร์คเสร็จ/checklist ใช้งานได้ · ลบเป็น soft delete · Escalate เพิ่ม count เท่านั้น (LINE push ยังไม่พร้อม)',
      ]},
    ],
  };

  // ===== header / section / tab labels =====
  getById('refresh-btn').innerHTML = ICONS.refresh;
  getById('add-btn').innerHTML = ICONS.plus + ' เพิ่มงาน';
  getById('section-icon').innerHTML = ICONS.list;
  getById('help-btn').innerHTML = ICONS.help;
  getById('add-save-btn').innerHTML = ICONS.save + ' บันทึก';
  getById('d-save-btn').innerHTML = ICONS.save + ' บันทึก';
  getById('d-complete-btn').innerHTML = ICONS.check + ' มาร์คเสร็จ';
  getById('d-escalate-btn').innerHTML = ICONS.bell + ' Escalate';
  getById('d-remove-btn').innerHTML = ICONS.trash;
  getById('ms-checklist-text').innerHTML = ICONS.list + ' Checklist items';
  getById('ms-edit-text').innerHTML = ICONS.edit + ' แก้ไขรายละเอียด';

  getById('tab-pending').innerHTML = ICONS.bell + ' รออยู่ <span class="count" id="cnt-pending">—</span>';
  getById('tab-overdue').innerHTML = ICONS.alert + ' เกินกำหนด <span class="count" id="cnt-overdue">—</span>';
  getById('tab-done').innerHTML = ICONS.check + ' เสร็จแล้ว <span class="count" id="cnt-done">—</span>';
  getById('tab-all').innerHTML = ICONS.list + ' ทั้งหมด <span class="count" id="cnt-all">—</span>';

  function setTab(tab) {
    currentTab = tab;
    _tkRoot.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    getById('tab-' + tab).classList.add('active');
    loadList();
  }

  function loadList() {
    getById('content').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    const opts = {
      tab: currentTab,
      search: getById('filter-search').value || '',
      branch: getById('filter-branch').value || '',
      owner: getById('filter-owner').value || '',
      template: getById('filter-template').value || '',
    };
    google.script.run
      .withSuccessHandler(d => {
        allData = d;
        renderStats(d.stats || {});
        populateFilters(d);
        renderList(d.tasks || []);
      })
      .withFailureHandler(e => {
        getById('content').innerHTML = '<div class="empty"><div class="empty-title">โหลดไม่สำเร็จ</div><div class="empty-sub">' + escapeHtml(e.message) + '</div></div>';
      })
      .tasksAdminList(opts);
  }

  function renderStats(s) {
    getById('cnt-pending').textContent = (s.pending || 0) + (s.overdue || 0);
    getById('cnt-overdue').textContent = s.overdue || 0;
    getById('cnt-done').textContent = s.done || 0;
    getById('cnt-all').textContent = s.total || 0;

    getById('stats').innerHTML = [
      statCard('รวม', s.total, 'งานทั้งหมด', 'var(--navy)'),
      statCard('Pending', s.pending, 'รอดำเนินการ', 'var(--info)'),
      statCard('Overdue', s.overdue, 'เลยกำหนด', s.overdue > 0 ? 'var(--danger)' : 'var(--success)'),
      statCard('เสร็จวันนี้', s.done_today, 'ปิดวันนี้', 'var(--success)'),
      statCard('Escalated', s.escalated, 'ถูกเร่ง', s.escalated > 0 ? 'var(--warning)' : 'var(--text-faint)'),
    ].join('');
  }

  function statCard(label, value, sub, color) {
    return '<div class="stat"><div class="stat-stripe" style="background:' + color + '"></div>' +
      '<div class="stat-label">' + label + '</div>' +
      '<div class="stat-value">' + (value || 0) + '</div>' +
      '<div class="stat-sub">' + sub + '</div></div>';
  }

  let _populated = false;
  function populateFilters(d) {
    if (_populated) return;
    _populated = true;

    const br = getById('filter-branch');
    (d.branches || []).forEach(b => {
      br.innerHTML += '<option value="' + escapeAttr(b.id) + '">' + escapeHtml(b.name) + '</option>';
    });

    const ow = getById('filter-owner');
    (d.owners || []).forEach(o => {
      ow.innerHTML += '<option value="' + escapeAttr(o.id) + '">' + escapeHtml(o.name) + '</option>';
    });

    const tp = getById('filter-template');
    (d.templates || []).forEach(t => {
      tp.innerHTML += '<option value="' + escapeAttr(t.id) + '">' + escapeHtml(t.name) + '</option>';
    });

    // Modal selects
    const mb = getById('m-branch');
    mb.innerHTML = '<option value="">— เลือก —</option>';
    (d.branches || []).forEach(b => {
      mb.innerHTML += '<option value="' + escapeAttr(b.id) + '">' + escapeHtml(b.name) + '</option>';
    });
    const mo = getById('m-owner');
    (d.owners || []).forEach(o => {
      mo.innerHTML += '<option value="' + escapeAttr(o.id) + '">' + escapeHtml(o.name) + '</option>';
    });
    const mt = getById('m-template');
    (d.templates || []).forEach(t => {
      mt.innerHTML += '<option value="' + escapeAttr(t.id) + '">' + escapeHtml(t.name) + '</option>';
    });
    // Detail owner
    const dOw = getById('d-owner');
    (d.owners || []).forEach(o => {
      dOw.innerHTML += '<option value="' + escapeAttr(o.id) + '">' + escapeHtml(o.name) + '</option>';
    });
  }

  function renderList(tasks) {
    if (!tasks.length) {
      getById('content').innerHTML =
        '<div class="empty-state"><div class="empty-icon">' + ICONS.check + '</div>' +
        '<div class="empty-title">ไม่มีงานในแท็บนี้</div>' +
        '<div class="empty-sub">เปลี่ยน filter หรือเลือก tab อื่น</div></div>';
      return;
    }

    const rows = tasks.map(t => {
      const trClass = t.status_raw === 'done' ? 'is-done' :
                      t.status_computed === 'overdue' ? 'is-overdue' :
                      (t.days_from_due !== null && t.days_from_due >= -3 && t.days_from_due <= 0 ? 'is-soon' : '');

      const stPill = t.status_raw === 'done' ? 'st-done' :
                     t.status_computed === 'overdue' ? 'st-overdue' : 'st-pending';
      const stLabel = t.status_raw === 'done' ? 'done' :
                      t.status_computed === 'overdue' ? 'overdue' : 'pending';

      let dueMeta = '';
      if (t.days_from_due !== null && t.status_raw !== 'done') {
        if (t.days_from_due > 0) dueMeta = '<span class="due-meta overdue">เลย ' + t.days_from_due + ' วัน</span>';
        else if (t.days_from_due === 0) dueMeta = '<span class="due-meta soon">วันนี้</span>';
        else if (t.days_from_due >= -3) dueMeta = '<span class="due-meta soon">อีก ' + (-t.days_from_due) + ' วัน</span>';
        else dueMeta = '<span class="due-meta">อีก ' + (-t.days_from_due) + ' วัน</span>';
      } else if (t.completed_at) {
        dueMeta = '<span class="due-meta">เสร็จ ' + escapeHtml(t.completed_at.split(' ')[0] || '') + '</span>';
      }

      let progress = '<span style="font-size:11px;color:var(--text-faint)">—</span>';
      if (t.checklist_total > 0) {
        const pct = t.checklist_pct;
        const pctCls = pct === 100 ? '' : pct > 0 ? 'partial' : 'empty';
        progress = [
          '<div class="progress-wrap">',
            '<div class="progress-bg"><div class="progress-fill ' + pctCls + '" style="width:' + pct + '%"></div></div>',
            '<span class="progress-text">' + t.checklist_done + '/' + t.checklist_total + '</span>',
          '</div>',
        ].join('');
      }

      let escBadge = '';
      if (t.escalation_count > 0) {
        escBadge = ' <span class="escalation-badge">' + ICONS.bell + ' ' + t.escalation_count + '</span>';
      }

      return [
        '<tr class="' + trClass + '" onclick="tkOpenDetail(\'' + escapeAttr(t.task_id) + '\')">',
          '<td>',
            '<div class="row-template-name">' + escapeHtml(t.template_name) + escBadge + '</div>',
            '<span class="row-template-meta">' + escapeHtml(t.task_id) + (t.template_frequency ? ' · ' + t.template_frequency : '') + '</span>',
          '</td>',
          '<td>' + escapeHtml(t.branch_name) + '</td>',
          '<td>' + escapeHtml(t.owner_name) + '</td>',
          '<td><div class="due-cell">' + escapeHtml(t.due_date || '—') + dueMeta + '</div></td>',
          '<td>' + progress + '</td>',
          '<td><span class="st-pill ' + stPill + '">' + stLabel + '</span></td>',
        '</tr>',
      ].join('');
    }).join('');

    getById('content').innerHTML = [
      '<table class="data-table">',
        '<thead><tr>',
          '<th>งาน / Template</th>',
          '<th style="width:130px">สาขา</th>',
          '<th style="width:130px">Owner</th>',
          '<th style="width:130px">ครบกำหนด</th>',
          '<th style="width:140px">Checklist</th>',
          '<th style="width:90px">สถานะ</th>',
        '</tr></thead>',
        '<tbody>' + rows + '</tbody>',
      '</table>',
    ].join('');
  }

  // === Add ad-hoc task ===

  function openAdd() {
    getById('m-branch').value = '';
    getById('m-owner').value = '';
    getById('m-template').value = '';
    getById('m-notes').value = '';
    // Default due = today + 3 days
    const d = new Date(); d.setDate(d.getDate() + 3);
    getById('m-due').value = d.toISOString().split('T')[0];
    getById('add-bg').classList.add('active');
  }

  function closeAdd() { getById('add-bg').classList.remove('active'); }

  function saveAdd() {
    const payload = {
      branch_id: getById('m-branch').value,
      owner: getById('m-owner').value,
      template_id: getById('m-template').value,
      due_date: getById('m-due').value,
      notes: getById('m-notes').value.trim(),
    };
    if (!payload.branch_id) { showToast('เลือกสาขา', 'error'); return; }
    if (!payload.due_date) { showToast('ระบุวันครบกำหนด', 'error'); return; }

    const btn = getById('add-save-btn');
    btn.disabled = true; btn.textContent = '...';
    google.script.run
      .withSuccessHandler(r => {
        btn.disabled = false; btn.innerHTML = ICONS.save + ' บันทึก';
        if (r && r.error) { showToast(r.error, 'error'); return; }
        closeAdd();
        showToast('สร้างงาน ' + r.task_id, 'success');
        loadList();
      })
      .withFailureHandler(e => {
        btn.disabled = false; btn.innerHTML = ICONS.save + ' บันทึก';
        showToast('Error: ' + e.message, 'error');
      })
      .tasksAdminAdd(payload);
  }

  // === Detail + checklist ===

  function openDetail(taskId) {
    getById('detail-bg').classList.add('active');
    getById('d-checklist').innerHTML = '<div class="loading">กำลังโหลด...</div>';
    getById('d-meta').innerHTML = '';
    getById('d-title').textContent = 'งาน ' + taskId;

    google.script.run
      .withSuccessHandler(d => {
        if (d && d.error) { showToast(d.error, 'error'); closeDetail(); return; }
        currentDetail = d;
        renderDetail(d);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tasksAdminGetDetail(taskId);
  }

  function renderDetail(d) {
    const t = d.task;
    const isDone = t.status === 'done';

    getById('d-title').textContent = d.template_name + ' · ' + t.task_id;
    getById('d-sub').textContent = isDone ? 'เสร็จสมบูรณ์แล้ว' : 'กำลังดำเนินการ';

    const due = t.due_date ? new Date(t.due_date).toISOString().split('T')[0] : '';
    const created = t.created_at ? new Date(t.created_at).toISOString().split('T')[0] : '';

    getById('d-meta').innerHTML = [
      '<div><div class="label">Task ID</div><div class="value" style="font-family:monospace">' + escapeHtml(t.task_id) + '</div></div>',
      '<div><div class="label">Status</div><div class="value">' + escapeHtml(t.status || 'pending') + (t.escalation_count > 0 ? ' (escalated ' + t.escalation_count + 'x)' : '') + '</div></div>',
      '<div><div class="label">สาขา</div><div class="value">' + escapeHtml(d.branch_name || '—') + '</div></div>',
      '<div><div class="label">Owner</div><div class="value">' + escapeHtml(d.owner_name || '—') + '</div></div>',
      '<div><div class="label">ครบกำหนด</div><div class="value">' + escapeHtml(due || '—') + '</div></div>',
      '<div><div class="label">สร้างเมื่อ</div><div class="value">' + escapeHtml(created || '—') + '</div></div>',
    ].join('');

    // Edit fields
    getById('d-notes').value = t.notes || '';
    getById('d-due').value = due;
    getById('d-owner').value = t.owner || '';

    // Buttons
    getById('d-complete-btn').style.display = isDone ? 'none' : '';
    getById('d-revert-btn').style.display = isDone ? '' : 'none';

    // Checklist
    renderChecklistItems(d.checklist || []);
  }

  function renderChecklistItems(items) {
    const block = getById('d-checklist');
    const total = items.length;
    const done = items.filter(c => c.status === 'done').length;
    getById('ms-checklist-count').textContent = done + '/' + total;

    if (total === 0) {
      block.innerHTML = '<div class="checklist-empty">งานนี้ไม่มี checklist · เพิ่มได้ด้านล่าง</div>';
    } else {
      block.innerHTML = items.map(c => {
        const cls = c.status === 'done' ? 'is-done' : '';
        const ckCls = c.status === 'done' ? 'checked' : '';
        const meta = c.completed_at ? '<span class="cl-meta">เสร็จ ' + escapeHtml(c.completed_at) + '</span>' : '';
        return [
          '<div class="checklist-row ' + cls + '" data-tcl="' + escapeAttr(c.tcl_id) + '">',
            '<div class="cl-toggle ' + ckCls + '" onclick="tkToggleCheck(\'' + escapeAttr(c.tcl_id) + '\', ' + (c.status === 'done' ? 'false' : 'true') + ')">',
              ICONS.check,
            '</div>',
            '<div>',
              '<div class="cl-name">' + escapeHtml(c.task_name) + '</div>',
              meta,
            '</div>',
            '<div class="cl-actions">',
              '<button class="btn btn-icon btn-icon-danger" onclick="tkRemoveCheckItem(\'' + escapeAttr(c.tcl_id) + '\')" title="ลบ">' + ICONS.trash + '</button>',
            '</div>',
          '</div>',
        ].join('');
      }).join('');
    }

    // Add row
    block.innerHTML += [
      '<div class="add-cl-row">',
        '<input type="text" id="new-cl-name" placeholder="เพิ่ม checklist item ใหม่... (Enter เพื่อบันทึก)" onkeydown="if(event.key===\'Enter\')tkAddCheckItem()">',
        '<button class="btn btn-sm btn-primary" onclick="tkAddCheckItem()">' + ICONS.plus + '</button>',
      '</div>',
    ].join('');
  }

  function toggleCheck(tclId, makeDone) {
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        // Refetch detail to refresh percentage
        if (currentDetail) openDetail(currentDetail.task.task_id);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tasksAdminUpdateChecklistItem(tclId, { status: makeDone ? 'done' : 'pending' });
  }

  function addCheckItem() {
    const inp = getById('new-cl-name');
    const name = (inp.value || '').trim();
    if (!name) { showToast('พิมพ์ชื่อ checklist', 'error'); return; }
    if (!currentDetail) return;

    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        inp.value = '';
        openDetail(currentDetail.task.task_id);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tasksAdminAddChecklistItem(currentDetail.task.task_id, name);
  }

  function removeCheckItem(tclId) {
    if (!confirm('ลบ checklist item นี้?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        if (currentDetail) openDetail(currentDetail.task.task_id);
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tasksAdminRemoveChecklistItem(tclId);
  }

  function saveDetail() {
    if (!currentDetail) return;
    const updates = {
      notes: getById('d-notes').value.trim(),
      due_date: getById('d-due').value,
      owner: getById('d-owner').value,
    };
    const btn = getById('d-save-btn');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(r => {
        btn.disabled = false;
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('บันทึกแล้ว', 'success');
        loadList();
      })
      .withFailureHandler(e => { btn.disabled = false; showToast('Error: ' + e.message, 'error'); })
      .tasksAdminUpdate(currentDetail.task.task_id, updates);
  }

  function completeTask() {
    if (!currentDetail) return;
    if (!confirm('มาร์คงาน "' + (currentDetail.template_name || '') + '" เป็นเสร็จ?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('เสร็จแล้ว', 'success');
        closeDetail(); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tasksAdminMarkComplete(currentDetail.task.task_id);
  }

  function revertTask() {
    if (!currentDetail) return;
    if (!confirm('ย้อนงานกลับเป็น pending?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('ย้อนกลับเป็น pending', 'success');
        closeDetail(); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tasksAdminMarkPending(currentDetail.task.task_id);
  }

  function escalateTask() {
    if (!currentDetail) return;
    if (!confirm('Escalate งานนี้ — push LINE หา owner + เพิ่ม count?')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('Escalated (count = ' + r.escalation_count + ')', 'success');
        openDetail(currentDetail.task.task_id);
        loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tasksAdminEscalate(currentDetail.task.task_id);
  }

  function removeTask() {
    if (!currentDetail) return;
    const t = currentDetail.task;
    const cnt = (currentDetail.checklist || []).length;
    if (!confirm('ลบงานนี้ + checklist ' + cnt + ' รายการ? ลบแล้วกู้ไม่ได้')) return;
    google.script.run
      .withSuccessHandler(r => {
        if (r && r.error) { showToast(r.error, 'error'); return; }
        showToast('ลบแล้ว', 'success');
        closeDetail(); loadList();
      })
      .withFailureHandler(e => showToast('Error: ' + e.message, 'error'))
      .tasksAdminRemove(t.task_id);
  }

  function closeDetail() {
    getById('detail-bg').classList.remove('active');
    currentDetail = null;
  }

  /* ===== expose fn ที่ inline onclick ต้องเรียก ไปยัง window (prefix tk กันชน) ===== */
  window.tkShowHelp = showHelp;
  window.TK_HELP = HELP;
  window.tkLoadList = loadList;
  window.tkSetTab = setTab;
  window.tkOpenAdd = openAdd;
  window.tkCloseAdd = closeAdd;
  window.tkSaveAdd = saveAdd;
  window.tkOpenDetail = openDetail;
  window.tkCloseDetail = closeDetail;
  window.tkToggleCheck = toggleCheck;
  window.tkAddCheckItem = addCheckItem;
  window.tkRemoveCheckItem = removeCheckItem;
  window.tkSaveDetail = saveDetail;
  window.tkCompleteTask = completeTask;
  window.tkRevertTask = revertTask;
  window.tkEscalateTask = escalateTask;
  window.tkRemoveTask = removeTask;

  /* ===== Init ===== */
  loadList();
}

/* ===== expose mount ===== */
if (typeof window !== 'undefined') window.mountTasks = mountTasks;
