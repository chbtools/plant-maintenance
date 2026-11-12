/* Plant maintenance domain logic.
   Shared by the page and the node tests. Code.gs must use the same FIELDS
   and the same nextOnHand rules, or the sheet and the phones will drift. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PM = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STATUSES = ["draft", "open", "in_progress", "waiting_parts", "waiting_approval", "on_hold", "complete", "cancelled"];
  const STATUS_LABEL = {
    draft: "Draft", open: "Open", in_progress: "In progress", waiting_parts: "Waiting on parts",
    waiting_approval: "Waiting on approval", on_hold: "On hold", complete: "Complete", cancelled: "Cancelled"
  };
  const PRIORITIES = ["Low", "Normal", "High", "Urgent"];
  const WO_TYPES = ["Repair", "PM", "Inspection", "Project"];
  const ASSET_STATUSES = ["Running", "Down", "Idle", "Out of service"];
  const METER_TYPES = ["Hours", "Cycles", "Miles"];
  const BASES = ["calendar", "meter", "both"];
  const SOURCES = ["typed", "voice", "pm"];
  const LEVEL_PRESETS = [
    { name: "Daily", basis: "calendar", everyDays: 1, everyMeter: 0 },
    { name: "Weekly", basis: "calendar", everyDays: 7, everyMeter: 0 },
    { name: "Monthly", basis: "calendar", everyDays: 30, everyMeter: 0 },
    { name: "Quarterly", basis: "calendar", everyDays: 90, everyMeter: 0 },
    { name: "Semi-annual", basis: "calendar", everyDays: 182, everyMeter: 0 },
    { name: "Annual", basis: "calendar", everyDays: 365, everyMeter: 0 },
    { name: "250 hours", basis: "meter", everyDays: 0, everyMeter: 250 },
    { name: "500 hours", basis: "meter", everyDays: 0, everyMeter: 500 },
    { name: "1000 hours", basis: "meter", everyDays: 0, everyMeter: 1000 }
  ];

  const FIELDS = {
    techs: ["id", "name", "role", "phone", "email", "hourlyRate", "active", "notes", "createdAt"],
    assets: ["id", "tag", "name", "area", "type", "make", "model", "year", "serial", "status", "metered", "meterType", "meter", "notes", "createdAt", "updatedAt"],
    levels: ["id", "assetId", "name", "basis", "everyDays", "everyMeter", "active", "notes", "createdAt"],
    pmTasks: ["id", "assetId", "levelId", "name", "instructions", "partsJson", "active", "lastCompletedAt", "lastMeter", "lastWoId", "createdAt"],
    workOrders: ["id", "woNumber", "assetId", "assetTag", "assetName", "title", "description", "type", "status", "priority", "assignedTo", "assignedName", "requestedBy", "dueDate", "openedDate", "completedDate", "downtimeHours", "meterAt", "workPerformed", "otherCost", "laborHours", "laborCost", "partsCost", "totalCost", "pmTaskId", "source", "voiceTranscript", "notes", "createdAt", "updatedAt"],
    parts: ["id", "sku", "name", "description", "bin", "onHand", "reorderPoint", "reorderQty", "unitCost", "vendor", "notes", "createdAt", "updatedAt"],
    fits: ["id", "partId", "assetId", "notes", "addedBy", "createdAt"],
    uses: ["id", "workOrderId", "partId", "assetId", "partSku", "partName", "qty", "unitCost", "extended", "techId", "createdAt"],
    timeLogs: ["id", "workOrderId", "assetId", "techId", "techName", "date", "hours", "rate", "notes", "createdAt"],
    readings: ["id", "assetId", "workOrderId", "reading", "techId", "date", "notes", "createdAt"],
    moves: ["id", "partId", "qty", "reason", "workOrderId", "note", "onHandAfter", "createdAt"]
  };

  const num = v => { const n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isFinite(n) ? n : 0; };
  const hasNum = v => !(v === "" || v == null) && isFinite(typeof v === "number" ? v : parseFloat(String(v).replace(/[$,]/g, "")));
  const yes = v => v === true || v === 1 || v === "1" || v === "yes" || v === "true";
  const round2 = n => Math.round((num(n) + Number.EPSILON) * 100) / 100;
  const pad = n => String(n).padStart(2, "0");
  const money = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(round2(n) || 0);
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  const addDays = (iso, n) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  };
  const daysBetween = (a, b) => {
    const p = s => { const [y, m, d] = String(s).split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((p(b) - p(a)) / 86400000);
  };
  const startOfWeek = iso => { const [y, m, d] = iso.split("-").map(Number); const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return addDays(iso, day === 0 ? -6 : 1 - day); };
  const dayOf = v => String(v || "").slice(0, 10);
  const fmtDate = s => { if (!s) return ""; const [y, m, d] = String(s).split("-").map(Number); if (!y || !m || !d) return String(s); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
  const fmtShort = s => { if (!s) return ""; const [y, m, d] = String(s).split("-").map(Number); if (!y || !m || !d) return String(s); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  const uid = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  const clone = v => structuredClone(v);
  const inRange = (date, from, to) => { const d = dayOf(date); return !!d && d >= from && d <= to; };
  const emptyState = () => ({ techs: [], assets: [], levels: [], pmTasks: [], workOrders: [], parts: [], fits: [], uses: [], timeLogs: [], readings: [], moves: [] });

  /* Stock changes travel as a delta or an absolute recount.
     Phones send the change, not the total, so two techs can pull parts
     without the second save putting the old count back.
     _onHandSet wins (a physical recount, or a brand-new part).
     Otherwise _onHandDelta is added to whatever the sheet has now.
     A delta of 0 leaves the sheet count alone. */
  function nextOnHand(current, data) {
    data = data || {};
    if (data._onHandSet !== undefined && data._onHandSet !== "" && data._onHandSet !== null) return round2(data._onHandSet);
    if (data._onHandDelta !== undefined && data._onHandDelta !== "" && data._onHandDelta !== null) {
      const base = (current === "" || current == null || !isFinite(Number(current))) ? 0 : Number(current);
      return round2(base + num(data._onHandDelta));
    }
    return round2(current);
  }

  const byId = (list, id) => list.find(x => x.id === id) || null;
  const techById = (s, id) => byId(s.techs, id);
  const assetById = (s, id) => byId(s.assets, id);
  const partById = (s, id) => byId(s.parts, id);
  const levelById = (s, id) => byId(s.levels, id);
  const taskById = (s, id) => byId(s.pmTasks, id);
  const woById = (s, id) => byId(s.workOrders, id);
  const isMetered = a => !!(a && yes(a.metered));
  const isActive = status => status !== "draft" && status !== "complete" && status !== "cancelled";
  const meterWord = a => { const t = (a && a.meterType) || "Hours"; if (/cycle/i.test(t)) return "cycles"; if (/mile/i.test(t)) return "miles"; return "hrs"; };
  const whoName = (s, wo) => { const t = wo && wo.assignedTo && techById(s, wo.assignedTo); return t ? t.name : (wo && wo.assignedName) || ""; };
  const priorityRank = p => ({ Urgent: 0, High: 1, Normal: 2, Low: 3 })[p] ?? 2;
  const isOverdueWo = (wo, day) => !!(wo && isActive(wo.status) && wo.dueDate && wo.dueDate < day);

  function fill(collection, obj) {
    const out = {};
    for (const k of FIELDS[collection]) out[k] = (obj[k] === undefined || obj[k] === null) ? "" : obj[k];
    return out;
  }
  function put(ops, collection, doc) {
    const data = fill(collection, doc);
    const i = ops.findIndex(o => o.op === "set" && o.collection === collection && o.id === doc.id);
    const op = { op: "set", collection, id: doc.id, data };
    if (i >= 0) ops[i] = op; else ops.push(op);
  }
  function putPart(ops, part, stock) {
    stock = stock || {};
    const i = ops.findIndex(o => o.op === "set" && o.collection === "parts" && o.id === part.id);
    const prev = i >= 0 ? ops[i].data : null;
    const data = fill("parts", part);
    delete data.onHand;
    let mode = "delta", value = num(stock.delta);
    if (stock.set != null && stock.set !== "") { mode = "set"; value = num(stock.set); }
    if (prev) {
      if (mode === "set") { /* recount replaces */ }
      else if (prev._onHandSet !== undefined && prev._onHandSet !== "" && prev._onHandSet !== null) { mode = "set"; value = round2(num(prev._onHandSet) + num(stock.delta)); }
      else value = round2(num(prev._onHandDelta) + num(stock.delta));
    }
    if (mode === "set") data._onHandSet = value;
    else data._onHandDelta = value;
    const op = { op: "set", collection: "parts", id: part.id, data };
    if (i >= 0) ops[i] = op; else ops.push(op);
  }
  function drop(ops, collection, id) {
    for (let i = ops.length - 1; i >= 0; i--) if (ops[i].collection === collection && ops[i].id === id) ops.splice(i, 1);
    ops.push({ op: "delete", collection, id });
  }
  function removeById(list, id) { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); }
  const fail = (message, extra) => Object.assign({ ok: false, message }, extra || {});
  const stamp = f => (f && f.now) || new Date().toISOString();
  const dayFrom = f => (f && f.date) || dayOf(f && f.now) || today();

  function parseParts(json) {
    try {
      const a = typeof json === "string" ? JSON.parse(json || "[]") : json;
      if (!Array.isArray(a)) return [];
      return a.map(x => ({ partId: String((x && x.partId) || ""), qty: num(x && x.qty) })).filter(x => x.partId && x.qty > 0);
    } catch (e) { return []; }
  }
  function stockNote(part) {
    if (!part) return "";
    const on = num(part.onHand), pt = num(part.reorderPoint);
    if (on < 0) return part.sku + " is at " + on + ". The bin was short — receive stock or correct the count.";
    if (on <= pt) return part.sku + " is at " + on + ". Reorder point is " + pt + ".";
    return "";
  }
  function intervalLabel(level, asset) {
    if (!level) return "";
    const d = num(level.everyDays), m = num(level.everyMeter), w = meterWord(asset);
    if (level.basis === "both") return "every " + d + " days or " + m + " " + w + ", whichever comes first";
    if (level.basis === "meter") return "every " + m + " " + w;
    return "every " + d + " day" + (d === 1 ? "" : "s");
  }
  function warnDays(every) {
    if (every <= 1) return 0;
    if (every <= 7) return 1;
    return Math.max(2, Math.round(every * 0.1));
  }

  function runRatePerDay(state, assetId) {
    const rs = state.readings.filter(r => r.assetId === assetId).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)));
    if (rs.length < 2) return null;
    const a = rs[0], b = rs[rs.length - 1];
    const days = daysBetween(a.date, b.date);
    const dh = num(b.reading) - num(a.reading);
    if (days < 1 || dh <= 0) return null;
    return dh / days;
  }

  function pmInfo(state, task, day) {
    day = day || today();
    const asset = task && assetById(state, task.assetId);
    const level = task && levelById(state, task.levelId);
    const open = task && state.workOrders.find(w => w.pmTaskId === task.id && w.status !== "complete" && w.status !== "cancelled");
    const base = { status: "off", suggestedDate: null, dueMeter: null, meter: asset && hasNum(asset.meter) ? num(asset.meter) : null, reasons: [], openWoId: open ? open.id : "", openWoNumber: open ? open.woNumber : "", summary: "Paused" };
    if (!task || !yes(task.active)) return Object.assign(base, { summary: "Paused" });
    if (!level) return Object.assign(base, { summary: "This task needs a maintenance level." });
    if (!yes(level.active)) return Object.assign(base, { summary: "This level is paused." });
    let status = "ok";
    const reasons = [];
    let suggested = null;
    const worse = (a, b) => (["ok", "soon", "due", "overdue"].indexOf(a) >= ["ok", "soon", "due", "overdue"].indexOf(b) ? a : b);
    const considerDate = iso => { if (!iso) return; if (!suggested || iso < suggested) suggested = iso; };

    if (level.basis === "calendar" || level.basis === "both") {
      const every = num(level.everyDays);
      if (every > 0) {
        if (!task.lastCompletedAt) { status = worse(status, "due"); reasons.push("no PM logged yet"); considerDate(day); }
        else {
          const due = addDays(task.lastCompletedAt, every);
          const left = daysBetween(day, due);
          considerDate(due);
          if (left < 0) { status = worse(status, "overdue"); reasons.push(Math.abs(left) + " day" + (left === -1 ? "" : "s") + " over"); }
          else if (left === 0) { status = worse(status, "due"); reasons.push("due today"); }
          else if (left <= warnDays(every)) { status = worse(status, "soon"); reasons.push(left + " day" + (left === 1 ? "" : "s") + " left"); }
          else reasons.push("due " + fmtShort(due));
        }
      }
    }
    if ((level.basis === "meter" || level.basis === "both") && isMetered(asset)) {
      const every = num(level.everyMeter);
      const word = meterWord(asset);
      if (every > 0) {
        const meter = num(asset.meter);
        if (!hasNum(task.lastMeter)) { status = worse(status, "due"); reasons.push("no meter at last PM"); considerDate(day); }
        else {
          const dueAt = num(task.lastMeter) + every;
          const left = dueAt - meter;
          base.dueMeter = dueAt;
          const rate = runRatePerDay(state, asset.id);
          if (left <= 0) {
            status = worse(status, "overdue");
            reasons.push(Math.abs(Math.round(left)) + " " + word + " over");
            if (rate) considerDate(addDays(day, Math.round(left / rate)));
            else considerDate(day);
          } else {
            const soon = left <= Math.max(1, every * 0.1);
            if (soon) status = worse(status, "soon");
            reasons.push(Math.round(left) + " " + word + " left");
            if (rate) considerDate(addDays(day, Math.round(left / rate)));
            else reasons.push("log meter readings on two different days to suggest a date");
          }
        }
      }
    }
    const summaryBits = [status === "overdue" ? "Overdue" : status === "due" ? "Due now" : status === "soon" ? "Due soon" : "OK"].concat(reasons);
    if (suggested) summaryBits.push("suggest " + fmtShort(suggested));
    if (open) summaryBits.push(open.woNumber + " open");
    return { status, suggestedDate: suggested, dueMeter: base.dueMeter, meter: base.meter, reasons, openWoId: base.openWoId, openWoNumber: base.openWoNumber, summary: summaryBits.join(" · ") };
  }

  function dueDateFor(info, day) {
    if (!info || !info.suggestedDate || info.suggestedDate < day) return day;
    return info.suggestedDate;
  }

  function woCosts(state, woId) {
    let parts = 0, hours = 0, labor = 0;
    for (const u of state.uses) if (u.workOrderId === woId) parts += num(u.extended);
    for (const t of state.timeLogs) if (t.workOrderId === woId) {
      hours += num(t.hours);
      const tech = techById(state, t.techId);
      const rate = hasNum(t.rate) ? num(t.rate) : num(tech && tech.hourlyRate);
      labor += num(t.hours) * rate;
    }
    const wo = woById(state, woId);
    const other = num(wo && wo.otherCost);
    return { parts: round2(parts), labor: round2(labor), laborHours: round2(hours), other: round2(other), total: round2(parts + labor + other) };
  }
  function denormWo(state, ops, woId) {
    const wo = woById(state, woId);
    if (!wo) return;
    const c = woCosts(state, woId);
    wo.laborHours = c.laborHours;
    wo.laborCost = c.labor;
    wo.partsCost = c.parts;
    wo.otherCost = round2(wo.otherCost);
    wo.totalCost = round2(c.parts + c.labor + c.other);
    put(ops, "workOrders", wo);
  }
  function mutate(input, fn) {
    const state = clone(input);
    const ops = [];
    const ret = fn(state, ops) || {};
    if (ret.ok === false) return { ok: false, message: ret.message || "Could not save that.", state: input, ops: [], woId: ret.woId || "" };
    const ids = new Set(ret.touchWos || []);
    for (const op of ops) if (op.collection === "workOrders" && op.op === "set") ids.add(op.id);
    for (const id of ids) denormWo(state, ops, id);
    return Object.assign({ ok: true, state, ops, message: ret.message || "Saved." }, ret);
  }

  function addMove(state, ops, m) {
    const move = {
      id: m.id || uid(), partId: m.partId, qty: round2(m.qty), reason: m.reason || "",
      workOrderId: m.workOrderId || "", note: m.note || "", onHandAfter: round2(m.onHandAfter), createdAt: m.createdAt
    };
    state.moves.push(move);
    put(ops, "moves", move);
    return move;
  }
  function addUse(state, ops, f) {
    const wo = woById(state, f.workOrderId);
    const part = partById(state, f.partId);
    if (!wo) return fail("That work order was not found.");
    if (wo.status === "cancelled") return fail("That work order is cancelled. Reopen it before using parts.");
    if (!part) return fail("That part is not in inventory.");
    const qty = round2(f.qty);
    if (!(qty > 0)) return fail("Enter how many you used.");
    const now = f.now || new Date().toISOString();
    const use = {
      id: f.id || uid(), workOrderId: wo.id, partId: part.id, assetId: wo.assetId || "",
      partSku: part.sku, partName: part.name, qty, unitCost: round2(part.unitCost), extended: round2(qty * num(part.unitCost)),
      techId: f.techId || "", createdAt: now
    };
    state.uses.push(use);
    put(ops, "uses", use);
    part.onHand = round2(num(part.onHand) - qty);
    part.updatedAt = now;
    putPart(ops, part, { delta: -qty });
    addMove(state, ops, { partId: part.id, qty: -qty, reason: "use", workOrderId: wo.id, note: "Used on " + wo.woNumber, onHandAfter: part.onHand, createdAt: now });
    wo.updatedAt = now;
    put(ops, "workOrders", wo);
    const note = stockNote(part);
    let message = "Used " + qty + " × " + part.sku + " on " + wo.woNumber + ".";
    if (note) message += " " + note;
    return { ok: true, message, useId: use.id };
  }
  function giveBackUse(state, ops, useId, now) {
    const use = state.uses.find(u => u.id === useId);
    if (!use) return;
    const part = partById(state, use.partId);
    const wo = woById(state, use.workOrderId);
    if (part) {
      part.onHand = round2(num(part.onHand) + num(use.qty));
      part.updatedAt = now;
      putPart(ops, part, { delta: num(use.qty) });
      addMove(state, ops, { partId: part.id, qty: num(use.qty), reason: "return", workOrderId: use.workOrderId, note: "Returned from " + ((wo && wo.woNumber) || "a work order"), onHandAfter: part.onHand, createdAt: now });
    }
    removeById(state.uses, use.id);
    drop(ops, "uses", use.id);
  }

  function addReading(state, ops, f) {
    const asset = assetById(state, f.assetId);
    if (!asset) return fail("Pick a piece of equipment.");
    if (!isMetered(asset)) return fail("That equipment has no meter. Its PM dates come from the calendar.");
    if (!hasNum(f.reading) || num(f.reading) < 0) return fail("Enter the meter reading.");
    if (f.workOrderId && !woById(state, f.workOrderId)) return fail("That work order was not found.");
    const now = f.now || new Date().toISOString();
    const reading = {
      id: f.id || uid(), assetId: asset.id, workOrderId: f.workOrderId || "", reading: num(f.reading),
      techId: f.techId || "", date: f.date || dayOf(now), notes: f.notes || "", createdAt: now
    };
    state.readings.push(reading);
    put(ops, "readings", reading);
    asset.meter = reading.reading;
    asset.updatedAt = now;
    put(ops, "assets", asset);
    if (reading.workOrderId) {
      const wo = woById(state, reading.workOrderId);
      wo.meterAt = reading.reading;
      wo.updatedAt = now;
      put(ops, "workOrders", wo);
    }
    return { ok: true, message: "Meter on " + asset.tag + " set to " + reading.reading.toLocaleString() + " " + meterWord(asset) + "." };
  }

  function nextWoNumber(state) {
    let max = 1000;
    for (const w of state.workOrders) {
      const n = parseInt(String(w.woNumber || "").replace(/\D/g, ""), 10);
      if (n > max) max = n;
    }
    return "WO-" + (max + 1);
  }

  function saveTech(input, f) {
    return mutate(input, (state, ops) => {
      const name = String(f.name || "").trim();
      if (!name) return fail("Enter the tech's name.");
      const existing = f.id && techById(state, f.id);
      if (state.techs.some(t => t.name.toLowerCase() === name.toLowerCase() && t.id !== (existing && existing.id))) return fail(name + " is already on the team.");
      const rate = round2(f.hourlyRate);
      if (rate < 0) return fail("Hourly rate can't be negative.");
      const now = stamp(f);
      const tech = {
        id: (existing && existing.id) || f.id || uid(), name, role: String(f.role || "").trim(), phone: String(f.phone || "").trim(),
        email: String(f.email || "").trim(), hourlyRate: rate, active: f.active === "no" || f.active === false ? "no" : "yes",
        notes: String(f.notes || "").trim(), createdAt: (existing && existing.createdAt) || now
      };
      if (existing) Object.assign(existing, tech); else state.techs.push(tech);
      put(ops, "techs", existing || tech);
      return { message: existing ? "Saved " + name + "." : name + " added to the team." };
    });
  }
  function deleteTech(input, id) {
    return mutate(input, (state, ops) => {
      const t = techById(state, id);
      if (!t) return fail("That tech is already gone.");
      removeById(state.techs, id);
      drop(ops, "techs", id);
      return { message: t.name + " removed. Old work orders still show their name." };
    });
  }

  function saveAsset(input, f) {
    return mutate(input, (state, ops) => {
      const tag = String(f.tag || "").trim();
      const name = String(f.name || "").trim();
      if (!tag) return fail("Enter the equipment tag, like WL-1.");
      if (!name) return fail("Enter a name for this equipment.");
      const existing = f.id && assetById(state, f.id);
      if (state.assets.some(a => a.tag.toLowerCase() === tag.toLowerCase() && a.id !== (existing && existing.id))) return fail("Tag " + tag + " is already in use.");
      const now = stamp(f);
      const metered = yes(f.metered) ? "yes" : "no";
      const asset = {
        id: (existing && existing.id) || uid(), tag, name, area: String(f.area || "").trim(), type: String(f.type || "").trim(),
        make: String(f.make || "").trim(), model: String(f.model || "").trim(), year: hasNum(f.year) ? String(parseInt(f.year, 10)) : "",
        serial: String(f.serial || "").trim(), status: ASSET_STATUSES.includes(f.status) ? f.status : ((existing && existing.status) || "Running"),
        metered, meterType: METER_TYPES.includes(f.meterType) ? f.meterType : "Hours",
        meter: metered === "yes" ? (hasNum(f.meter) ? num(f.meter) : (existing && hasNum(existing.meter) ? num(existing.meter) : "")) : "",
        notes: String(f.notes || "").trim(), createdAt: (existing && existing.createdAt) || now, updatedAt: now
      };
      if (metered === "no") asset.meter = "";
      if (existing) Object.assign(existing, asset); else state.assets.push(asset);
      put(ops, "assets", existing || state.assets[state.assets.length - 1]);
      return { message: existing ? "Saved " + tag + "." : tag + " added.", assetId: asset.id };
    });
  }

  function saveLevel(input, f) {
    return mutate(input, (state, ops) => {
      const asset = assetById(state, f.assetId);
      if (!asset) return fail("Pick the equipment this level belongs to.");
      const name = String(f.name || "").trim();
      if (!name) return fail("Name this level — Daily, Weekly, 250 hours, or your own.");
      const basis = BASES.includes(f.basis) ? f.basis : "calendar";
      if ((basis === "meter" || basis === "both") && !isMetered(asset)) return fail(asset.tag + " has no meter. Use a calendar level, or edit the equipment and turn the meter on.");
      const everyDays = round2(f.everyDays), everyMeter = round2(f.everyMeter);
      if ((basis === "calendar" || basis === "both") && !(everyDays >= 1)) return fail("Enter how many days between services.");
      if ((basis === "meter" || basis === "both") && !(everyMeter > 0)) return fail("Enter how many " + meterWord(asset) + " between services.");
      const existing = f.id && levelById(state, f.id);
      if (state.levels.some(l => l.assetId === asset.id && l.name.toLowerCase() === name.toLowerCase() && l.id !== (existing && existing.id))) return fail(asset.tag + " already has a " + name + " level.");
      const now = stamp(f);
      const level = {
        id: (existing && existing.id) || uid(), assetId: asset.id, name, basis,
        everyDays: basis === "meter" ? 0 : everyDays, everyMeter: basis === "calendar" ? 0 : everyMeter,
        active: f.active === "no" || f.active === false ? "no" : "yes", notes: String(f.notes || "").trim(),
        createdAt: (existing && existing.createdAt) || now
      };
      if (existing) Object.assign(existing, level); else state.levels.push(level);
      put(ops, "levels", existing || level);
      return { message: name + " saved on " + asset.tag + ".", levelId: level.id };
    });
  }
  function deleteLevel(input, id) {
    return mutate(input, (state, ops) => {
      const level = levelById(state, id);
      if (!level) return fail("That level is already gone.");
      if (state.pmTasks.some(t => t.levelId === id)) return fail("A PM task still uses " + level.name + ". Delete or retarget the task first.");
      removeById(state.levels, id);
      drop(ops, "levels", id);
      return { message: level.name + " removed." };
    });
  }

  function saveTask(input, f) {
    return mutate(input, (state, ops) => {
      const asset = assetById(state, f.assetId);
      const level = levelById(state, f.levelId);
      if (!asset) return fail("Pick the equipment.");
      if (!level || level.assetId !== asset.id) return fail("Pick a maintenance level for " + (asset ? asset.tag : "this equipment") + ".");
      const name = String(f.name || "").trim();
      if (!name) return fail("Name the PM task.");
      const existing = f.id && taskById(state, f.id);
      const parts = Array.isArray(f.parts) ? f.parts : (f.partsJson != null ? parseParts(f.partsJson) : (existing ? parseParts(existing.partsJson) : []));
      for (const line of parts) if (!partById(state, line.partId)) return fail("One of the required parts is not in inventory.");
      const now = stamp(f);
      const task = {
        id: (existing && existing.id) || uid(), assetId: asset.id, levelId: level.id, name,
        instructions: String(f.instructions == null ? (existing && existing.instructions) || "" : f.instructions).trim(),
        partsJson: JSON.stringify(parts.map(p => ({ partId: p.partId, qty: round2(p.qty) }))),
        active: f.active === "no" || f.active === false ? "no" : "yes",
        lastCompletedAt: f.lastCompletedAt != null ? dayOf(f.lastCompletedAt) : ((existing && existing.lastCompletedAt) || ""),
        lastMeter: f.lastMeter != null ? (hasNum(f.lastMeter) ? num(f.lastMeter) : "") : ((existing && hasNum(existing.lastMeter) ? num(existing.lastMeter) : "")),
        lastWoId: f.lastWoId != null ? f.lastWoId : ((existing && existing.lastWoId) || ""),
        createdAt: (existing && existing.createdAt) || now
      };
      if ((level.basis === "meter" || level.basis === "both") && task.lastCompletedAt && !hasNum(task.lastMeter)) {
        /* allowed — pmInfo will ask for a meter */
      }
      if (existing) Object.assign(existing, task); else state.pmTasks.push(task);
      put(ops, "pmTasks", existing || task);
      return { message: name + " saved.", taskId: task.id };
    });
  }
  function deleteTask(input, id) {
    return mutate(input, (state, ops) => {
      const task = taskById(state, id);
      if (!task) return fail("That PM task is already gone.");
      if (state.workOrders.some(w => w.pmTaskId === id && w.status !== "complete" && w.status !== "cancelled")) return fail("A work order for this PM is still open. Finish or cancel it first.");
      removeById(state.pmTasks, id);
      drop(ops, "pmTasks", id);
      return { message: task.name + " removed." };
    });
  }

  function savePart(input, f) {
    return mutate(input, (state, ops) => {
      const sku = String(f.sku || "").trim();
      const name = String(f.name || "").trim();
      if (!sku) return fail("Enter a part number or SKU.");
      if (!name) return fail("Enter the part name.");
      const existing = f.id && partById(state, f.id);
      if (state.parts.some(p => p.sku.toLowerCase() === sku.toLowerCase() && p.id !== (existing && existing.id))) return fail(sku + " is already in inventory.");
      const cost = round2(f.unitCost);
      const reorderPoint = round2(f.reorderPoint);
      const reorderQty = round2(f.reorderQty);
      if (cost < 0 || reorderPoint < 0 || reorderQty < 0) return fail("Cost, reorder point, and reorder quantity can't be negative.");
      const now = stamp(f);
      if (!existing) {
        const onHand = round2(f.onHand);
        if (onHand < 0) return fail("On hand can't start below zero. Receive a positive count.");
        const part = {
          id: uid(), sku, name, description: String(f.description || "").trim(), bin: String(f.bin || "").trim(),
          onHand, reorderPoint, reorderQty, unitCost: cost, vendor: String(f.vendor || "").trim(),
          notes: String(f.notes || "").trim(), createdAt: now, updatedAt: now
        };
        state.parts.push(part);
        putPart(ops, part, { set: onHand });
        if (onHand !== 0) addMove(state, ops, { partId: part.id, qty: onHand, reason: "balance", note: "Opening count", onHandAfter: onHand, createdAt: now });
        return { message: sku + " added. On hand " + onHand + ".", partId: part.id };
      }
      existing.sku = sku; existing.name = name; existing.description = String(f.description || "").trim();
      existing.bin = String(f.bin || "").trim(); existing.reorderPoint = reorderPoint; existing.reorderQty = reorderQty;
      existing.unitCost = cost; existing.vendor = String(f.vendor || "").trim(); existing.notes = String(f.notes || "").trim();
      existing.updatedAt = now;
      putPart(ops, existing, { delta: 0 });
      return { message: sku + " saved.", partId: existing.id };
    });
  }

  function saveFit(input, f) {
    return mutate(input, (state, ops) => {
      const part = partById(state, f.partId), asset = assetById(state, f.assetId);
      if (!part || !asset) return fail("Pick both a part and a machine.");
      const existing = state.fits.find(x => x.partId === part.id && x.assetId === asset.id);
      if (existing) return { message: part.sku + " is already on " + asset.tag + "'s parts list.", fitId: existing.id };
      const fit = { id: uid(), partId: part.id, assetId: asset.id, notes: String(f.notes || "").trim(), addedBy: String(f.addedBy || "").trim(), createdAt: stamp(f) };
      state.fits.push(fit);
      put(ops, "fits", fit);
      return { message: part.sku + " added to " + asset.tag + ".", fitId: fit.id };
    });
  }
  function deletePart(input, id) {
    return mutate(input, (state, ops) => {
      const part = partById(state, id);
      if (!part) return fail("That part is already gone.");
      if (state.uses.some(u => u.partId === id)) return fail(part.sku + " is on work orders, so it stays. Correct the count to zero if you don't stock it anymore.");
      if (state.pmTasks.some(t => parseParts(t.partsJson).some(p => p.partId === id))) return fail("A PM task still calls for " + part.sku + ". Take it off that task first.");
      removeById(state.parts, id);
      drop(ops, "parts", id);
      for (const fit of state.fits.filter(x => x.partId === id).slice()) {
        removeById(state.fits, fit.id);
        drop(ops, "fits", fit.id);
      }
      return { message: part.sku + " removed from inventory." };
    });
  }
  function deleteFit(input, id) {
    return mutate(input, (state, ops) => {
      const fit = state.fits.find(x => x.id === id);
      if (!fit) return fail("That link is already gone.");
      removeById(state.fits, id);
      drop(ops, "fits", id);
      const part = partById(state, fit.partId), asset = assetById(state, fit.assetId);
      return { message: ((part && part.sku) || "Part") + " removed from " + ((asset && asset.tag) || "the machine") + "'s list." };
    });
  }

  function saveWo(input, f) {
    return mutate(input, (state, ops) => {
      const existing = f.id && woById(state, f.id);
      const title = String(f.title || "").trim();
      if (!title) return fail("Give the work order a short title.");
      const status = STATUSES.includes(f.status) ? f.status : ((existing && existing.status) || "open");
      const assetId = Object.prototype.hasOwnProperty.call(f, "assetId") ? f.assetId : ((existing && existing.assetId) || "");
      const asset = assetId ? assetById(state, assetId) : null;
      if (assetId && !asset) return fail("That equipment was not found.");
      if (!asset && status !== "draft") return fail("Pick the equipment. Drafts can wait until you know which machine.");
      const type = WO_TYPES.includes(f.type) ? f.type : ((existing && existing.type) || "Repair");
      const priority = PRIORITIES.includes(f.priority) ? f.priority : ((existing && existing.priority) || "Normal");
      const source = SOURCES.includes(f.source) ? f.source : ((existing && existing.source) || "typed");
      const now = stamp(f);
      const day = f.openedDate || (existing && existing.openedDate) || dayOf(now);
      const tech = f.assignedTo ? techById(state, f.assignedTo) : null;
      if (f.assignedTo && !tech) return fail("That tech is not on the team.");
      const wo = existing || { id: f.id || uid(), woNumber: nextWoNumber(state), createdAt: now };
      wo.assetId = asset ? asset.id : "";
      wo.assetTag = asset ? asset.tag : (existing && existing.assetTag) || "";
      wo.assetName = asset ? asset.name : (existing && existing.assetName) || "";
      wo.title = title;
      wo.description = String(f.description == null ? wo.description || "" : f.description);
      wo.type = type;
      wo.status = status;
      wo.priority = priority;
      wo.assignedTo = tech ? tech.id : "";
      wo.assignedName = tech ? tech.name : "";
      wo.requestedBy = String(f.requestedBy == null ? wo.requestedBy || "" : f.requestedBy).trim();
      wo.dueDate = f.dueDate != null ? dayOf(f.dueDate) : (wo.dueDate || "");
      wo.openedDate = day;
      wo.completedDate = status === "complete" ? (dayOf(f.completedDate) || wo.completedDate || dayOf(now)) : (f.completedDate != null ? dayOf(f.completedDate) : (wo.completedDate || ""));
      if (status !== "complete" && f.completedDate == null && !existing) wo.completedDate = "";
      wo.downtimeHours = f.downtimeHours != null ? round2(f.downtimeHours) : round2(wo.downtimeHours || 0);
      if (wo.downtimeHours < 0) return fail("Downtime hours can't be negative.");
      wo.meterAt = f.meterAt != null ? (hasNum(f.meterAt) ? num(f.meterAt) : "") : (hasNum(wo.meterAt) ? num(wo.meterAt) : "");
      wo.workPerformed = String(f.workPerformed == null ? wo.workPerformed || "" : f.workPerformed);
      wo.otherCost = f.otherCost != null ? round2(f.otherCost) : round2(wo.otherCost || 0);
      if (wo.otherCost < 0) return fail("Other cost can't be negative.");
      wo.pmTaskId = f.pmTaskId != null ? f.pmTaskId : (wo.pmTaskId || "");
      wo.source = source;
      wo.voiceTranscript = String(f.voiceTranscript == null ? wo.voiceTranscript || "" : f.voiceTranscript);
      wo.notes = String(f.notes == null ? wo.notes || "" : f.notes);
      wo.updatedAt = now;
      if (!existing) {
        wo.laborHours = 0; wo.laborCost = 0; wo.partsCost = 0; wo.totalCost = round2(wo.otherCost);
        state.workOrders.push(wo);
      }
      put(ops, "workOrders", wo);
      return { message: existing ? wo.woNumber + " saved." : wo.woNumber + " created.", woId: wo.id, woNumber: wo.woNumber };
    });
  }

  function setWoStatus(input, f) {
    return mutate(input, (state, ops) => {
      const wo = woById(state, f.id);
      if (!wo) return fail("That work order was not found.");
      const status = f.status;
      if (!STATUSES.includes(status)) return fail("Unknown status.");
      if (status !== "draft" && !wo.assetId) return fail("Pick the equipment before moving this out of draft.");
      const now = stamp(f);
      const day = f.date || dayOf(now);
      if (status === "cancelled" && wo.status !== "cancelled") {
        for (const u of state.uses.filter(u => u.workOrderId === wo.id).slice()) giveBackUse(state, ops, u.id, now);
      }
      if (f.workPerformed != null) wo.workPerformed = String(f.workPerformed);
      if (f.downtimeHours != null) {
        if (num(f.downtimeHours) < 0) return fail("Downtime hours can't be negative.");
        wo.downtimeHours = round2(f.downtimeHours);
      }
      if (f.otherCost != null) wo.otherCost = round2(f.otherCost);
      wo.status = status;
      wo.updatedAt = now;
      if (status === "complete") {
        wo.completedDate = dayOf(f.completedDate) || wo.completedDate || day;
        if (hasNum(f.meterAt)) {
          const asset = assetById(state, wo.assetId);
          if (asset && isMetered(asset)) {
            const r = addReading(state, ops, { assetId: asset.id, workOrderId: wo.id, reading: f.meterAt, techId: f.techId || "", date: day, notes: "Logged when " + wo.woNumber + " was completed", now });
            if (r.ok === false) return r;
          }
        }
        if (wo.pmTaskId) {
          const task = taskById(state, wo.pmTaskId);
          const asset = assetById(state, wo.assetId);
          if (task) {
            task.lastCompletedAt = wo.completedDate;
            task.lastWoId = wo.id;
            if (asset && isMetered(asset) && hasNum(asset.meter)) task.lastMeter = num(asset.meter);
            put(ops, "pmTasks", task);
          }
        }
      }
      put(ops, "workOrders", wo);
      return { message: wo.woNumber + " marked " + STATUS_LABEL[status].toLowerCase() + ".", woId: wo.id };
    });
  }

  function deleteDraft(input, id) {
    return mutate(input, (state, ops) => {
      const wo = woById(state, id);
      if (!wo) return fail("That work order was not found.");
      if (wo.status !== "draft") return fail("Only drafts can be deleted. Cancel a work order if you want to keep the history.");
      const now = new Date().toISOString();
      for (const u of state.uses.filter(u => u.workOrderId === wo.id).slice()) giveBackUse(state, ops, u.id, now);
      for (const t of state.timeLogs.filter(t => t.workOrderId === wo.id).slice()) {
        removeById(state.timeLogs, t.id);
        drop(ops, "timeLogs", t.id);
      }
      removeById(state.workOrders, wo.id);
      drop(ops, "workOrders", wo.id);
      return { message: wo.woNumber + " deleted.", touchWos: [] };
    });
  }

  function usePart(input, f) { return mutate(input, (state, ops) => addUse(state, ops, f)); }
  function returnUse(input, useId) {
    return mutate(input, (state, ops) => {
      const use = state.uses.find(u => u.id === useId);
      if (!use) return fail("That part line is already gone.");
      const wo = woById(state, use.workOrderId);
      giveBackUse(state, ops, useId, new Date().toISOString());
      if (wo) { wo.updatedAt = new Date().toISOString(); put(ops, "workOrders", wo); }
      return { message: "Returned " + use.qty + " × " + use.partSku + " to stock." };
    });
  }
  function receiveStock(input, f) {
    return mutate(input, (state, ops) => {
      const part = partById(state, f.partId);
      if (!part) return fail("That part is not in inventory.");
      const qty = round2(f.qty);
      if (!(qty > 0)) return fail("Enter how many came in.");
      const now = stamp(f);
      part.onHand = round2(num(part.onHand) + qty);
      part.updatedAt = now;
      putPart(ops, part, { delta: qty });
      addMove(state, ops, { partId: part.id, qty, reason: "receive", note: String(f.note || "Received").trim(), onHandAfter: part.onHand, createdAt: now });
      const note = stockNote(part);
      return { message: "Received " + qty + " × " + part.sku + ". On hand is " + part.onHand + "." + (note ? " " + note : "") };
    });
  }
  function adjustStock(input, f) {
    return mutate(input, (state, ops) => {
      const part = partById(state, f.partId);
      if (!part) return fail("That part is not in inventory.");
      if (!hasNum(f.onHand) || num(f.onHand) < 0) return fail("Enter the counted quantity, zero or more.");
      const target = round2(f.onHand);
      const delta = round2(target - num(part.onHand));
      const now = stamp(f);
      part.onHand = target;
      part.updatedAt = now;
      putPart(ops, part, { set: target });
      addMove(state, ops, { partId: part.id, qty: delta, reason: "adjust", note: String(f.note || "Physical count").trim(), onHandAfter: target, createdAt: now });
      const note = stockNote(part);
      return { message: part.sku + " count set to " + target + "." + (note ? " " + note : "") };
    });
  }
  function saveReading(input, f) { return mutate(input, (state, ops) => addReading(state, ops, f)); }

  function saveTime(input, f) {
    return mutate(input, (state, ops) => {
      const tech = techById(state, f.techId);
      if (!tech) return fail("Pick who did the work.");
      const hours = round2(f.hours);
      if (!(hours > 0)) return fail("Enter the hours.");
      if (hours > 24) return fail("That's more than a day. Log each day on its own line.");
      const wo = f.workOrderId ? woById(state, f.workOrderId) : null;
      if (f.workOrderId && !wo) return fail("That work order was not found.");
      const asset = wo ? assetById(state, wo.assetId) : assetById(state, f.assetId);
      if (!asset) return fail("Pick the equipment this time goes against.");
      const existing = f.id && state.timeLogs.find(t => t.id === f.id);
      const now = stamp(f);
      const rate = f.rate != null && f.rate !== "" ? round2(f.rate) : round2(tech.hourlyRate);
      const row = {
        id: (existing && existing.id) || uid(), workOrderId: wo ? wo.id : "", assetId: asset.id, techId: tech.id, techName: tech.name,
        date: f.date || dayOf(now), hours, rate, notes: String(f.notes || "").trim(), createdAt: (existing && existing.createdAt) || now
      };
      if (!row.date) return fail("Enter the date.");
      if (existing) Object.assign(existing, row); else state.timeLogs.push(row);
      put(ops, "timeLogs", existing || row);
      if (wo) { wo.updatedAt = now; put(ops, "workOrders", wo); }
      return { message: "Logged " + hours + " h for " + tech.name + " on " + asset.tag + "." };
    });
  }
  function deleteTime(input, id) {
    return mutate(input, (state, ops) => {
      const row = state.timeLogs.find(t => t.id === id);
      if (!row) return fail("That time entry is already gone.");
      removeById(state.timeLogs, id);
      drop(ops, "timeLogs", id);
      if (row.workOrderId) {
        const wo = woById(state, row.workOrderId);
        if (wo) put(ops, "workOrders", wo);
      }
      return { message: "Time entry removed." };
    });
  }

  function generatePm(input, f) {
    return mutate(input, (state, ops) => {
      const task = taskById(state, f.taskId);
      if (!task || !yes(task.active)) return fail("That PM task is paused or missing.");
      const day = f.today || today();
      const info = pmInfo(state, task, day);
      if (info.openWoId) return fail(info.openWoNumber + " is already open for this PM.", { woId: info.openWoId });
      const asset = assetById(state, task.assetId);
      const level = levelById(state, task.levelId);
      const lines = parseParts(task.partsJson);
      const missing = [];
      const pulled = [];
      const now = stamp(f);
      const tech = f.assignedTo ? techById(state, f.assignedTo) : null;
      if (f.assignedTo && !tech) return fail("That tech is not on the team.");
      const woFields = {
        title: task.name,
        description: task.instructions || "",
        type: "PM",
        status: "open",
        priority: info.status === "overdue" ? "High" : "Normal",
        assetId: asset ? asset.id : "",
        assignedTo: tech ? tech.id : "",
        requestedBy: "PM schedule",
        dueDate: dueDateFor(info, day),
        openedDate: day,
        pmTaskId: task.id,
        source: "pm",
        notes: "Opened from the PM schedule (" + (level ? level.name : "PM") + "). Parts on the task were pulled from inventory.",
        otherCost: 0,
        downtimeHours: 0,
        now
      };
      /* save via the same path, but we're already inside mutate — inline a child by calling saveWo's body would double-clone.
         Build the WO here with the same defaults. */
      if (!asset) return fail("That PM points at equipment that was removed.");
      const wo = {
        id: uid(), woNumber: nextWoNumber(state), assetId: asset.id, assetTag: asset.tag, assetName: asset.name,
        title: woFields.title, description: woFields.description, type: "PM", status: "open", priority: woFields.priority,
        assignedTo: tech ? tech.id : "", assignedName: tech ? tech.name : "", requestedBy: "PM schedule",
        dueDate: woFields.dueDate, openedDate: day, completedDate: "", downtimeHours: 0, meterAt: "",
        workPerformed: "", otherCost: 0, laborHours: 0, laborCost: 0, partsCost: 0, totalCost: 0,
        pmTaskId: task.id, source: "pm", voiceTranscript: "", notes: woFields.notes, createdAt: now, updatedAt: now
      };
      state.workOrders.push(wo);
      put(ops, "workOrders", wo);
      for (const line of lines) {
        const part = partById(state, line.partId);
        if (!part) { missing.push(line.partId); continue; }
        const used = addUse(state, ops, { workOrderId: wo.id, partId: part.id, qty: line.qty, techId: tech ? tech.id : "", now });
        if (used.ok === false) return used;
        pulled.push(line.qty + " × " + part.sku);
      }
      if (missing.length) wo.notes += " Missing from inventory: " + missing.join(", ") + ".";
      let message = wo.woNumber + " opened on " + asset.tag + ".";
      if (pulled.length) message += " Pulled " + pulled.join(", ") + ".";
      else message += " No parts on this PM.";
      const lows = [];
      for (const line of lines) { const p = partById(state, line.partId); const n = p && stockNote(p); if (n) lows.push(n); }
      if (lows.length) message += " " + lows.join(" ");
      message += " Due " + fmtShort(wo.dueDate) + ".";
      return { message, woId: wo.id, woNumber: wo.woNumber };
    });
  }

  function generateDue(input, f) {
    const day = (f && f.today) || today();
    const due = input.pmTasks.filter(t => {
      const info = pmInfo(input, t, day);
      return (info.status === "due" || info.status === "overdue") && !info.openWoId;
    });
    if (!due.length) return { ok: false, message: "Nothing is due that doesn't already have a work order.", state: input, ops: [] };
    let state = input;
    const ops = [];
    const numbers = [];
    for (const task of due) {
      const r = generatePm(state, { taskId: task.id, assignedTo: (f && f.assignedTo) || "", today: day, now: f && f.now });
      if (!r.ok) continue;
      state = r.state;
      ops.push.apply(ops, r.ops);
      numbers.push(r.woNumber);
    }
    if (!numbers.length) return { ok: false, message: "Nothing is due that doesn't already have a work order.", state: input, ops: [] };
    return { ok: true, state, ops, woNumbers: numbers, message: "Opened " + numbers.length + " PM work order" + (numbers.length === 1 ? "" : "s") + ": " + numbers.join(", ") + "." };
  }

  function looseLabor(state, from, to, assetId) {
    let hours = 0, labor = 0;
    for (const t of state.timeLogs) {
      if (t.workOrderId) continue;
      if (assetId && t.assetId !== assetId) continue;
      if (!inRange(t.date, from, to)) continue;
      const tech = techById(state, t.techId);
      const rate = hasNum(t.rate) ? num(t.rate) : num(tech && tech.hourlyRate);
      hours += num(t.hours);
      labor += num(t.hours) * rate;
    }
    return { hours: round2(hours), labor: round2(labor) };
  }
  function spendBetween(state, from, to, assetId) {
    let parts = 0, labor = 0, other = 0, downtime = 0, hours = 0, n = 0;
    for (const wo of state.workOrders) {
      if (wo.status === "cancelled" || wo.status === "draft") continue;
      if (assetId && wo.assetId !== assetId) continue;
      if (!inRange(wo.openedDate, from, to)) continue;
      const c = woCosts(state, wo.id);
      parts += c.parts; labor += c.labor; other += c.other; hours += c.laborHours; downtime += num(wo.downtimeHours); n++;
    }
    const loose = looseLabor(state, from, to, assetId || "");
    return { parts: round2(parts), labor: round2(labor + loose.labor), other: round2(other), total: round2(parts + labor + loose.labor + other), downtime: round2(downtime), hours: round2(hours + loose.hours), woCount: n };
  }

  function dashboard(state, day) {
    day = day || today();
    const from90 = addDays(day, -89);
    const monthFrom = day.slice(0, 7) + "-01";
    const weekFrom = startOfWeek(day);
    const spend90 = spendBetween(state, from90, day);
    const spendMonth = spendBetween(state, monthFrom, day);
    const weekHours = state.timeLogs.filter(t => inRange(t.date, weekFrom, day)).reduce((s, t) => s + num(t.hours), 0);
    const active = state.workOrders.filter(w => isActive(w.status));
    const drafts = state.workOrders.filter(w => w.status === "draft");
    const byTechMap = new Map();
    const addTech = (id, name) => { if (!byTechMap.has(id)) byTechMap.set(id, { techId: id, name: name || "Unassigned", count: 0, high: 0 }); return byTechMap.get(id); };
    for (const w of active) {
      const row = addTech(w.assignedTo || "", whoName(state, w) || "Unassigned");
      row.count++;
      if (w.priority === "High" || w.priority === "Urgent" || isOverdueWo(w, day)) row.high++;
    }
    const openByTech = Array.from(byTechMap.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const topAssets = state.assets.map(a => {
      const s = spendBetween(state, from90, day, a.id);
      return { id: a.id, tag: a.tag, name: a.name, status: a.status, total: s.total, parts: s.parts, labor: s.labor, downtime: s.downtime, hours: s.hours };
    }).filter(a => a.total > 0).sort((a, b) => b.total - a.total);
    const pms = state.pmTasks.map(t => {
      const info = pmInfo(state, t, day);
      const asset = assetById(state, t.assetId);
      const level = levelById(state, t.levelId);
      return { taskId: t.id, name: t.name, assetId: t.assetId, tag: asset ? asset.tag : "", assetName: asset ? asset.name : "", level: level ? level.name : "", info };
    }).filter(p => p.info.status === "overdue" || p.info.status === "due" || p.info.status === "soon")
      .sort((a, b) => ["overdue", "due", "soon"].indexOf(a.info.status) - ["overdue", "due", "soon"].indexOf(b.info.status) || String(a.info.suggestedDate || "").localeCompare(String(b.info.suggestedDate || "")));
    const lowStock = state.parts.filter(p => num(p.onHand) <= num(p.reorderPoint)).map(p => ({ id: p.id, sku: p.sku, name: p.name, onHand: num(p.onHand), reorderPoint: num(p.reorderPoint), bin: p.bin, unitCost: num(p.unitCost) })).sort((a, b) => (b.reorderPoint - b.onHand) - (a.reorderPoint - a.onHand));
    const downtime = state.assets.map(a => {
      const s = spendBetween(state, from90, day, a.id);
      return { id: a.id, tag: a.tag, name: a.name, status: a.status, hours: s.downtime };
    }).filter(a => a.hours > 0 || a.status === "Down").sort((a, b) => b.hours - a.hours || (a.status === "Down" ? -1 : 1));
    return {
      day, from90, spend90, spendMonth, weekHours: round2(weekHours),
      openCount: active.length, draftCount: drafts.length,
      lateCount: active.filter(w => isOverdueWo(w, day)).length,
      downCount: state.assets.filter(a => a.status === "Down").length,
      overduePm: pms.filter(p => p.info.status === "overdue").length,
      duePm: pms.filter(p => p.info.status === "due").length,
      soonPm: pms.filter(p => p.info.status === "soon").length,
      lowCount: lowStock.length,
      openByTech, topAssets, pms, lowStock, downtime
    };
  }

  function partsUsedText(state, woId) {
    return state.uses.filter(u => u.workOrderId === woId).map(u => (num(u.qty) !== 1 ? u.qty + " × " : "") + u.partSku + " " + u.partName).join("; ");
  }
  function techsOnWo(state, woId) {
    const names = [];
    for (const t of state.timeLogs) if (t.workOrderId === woId && t.techName && !names.includes(t.techName)) names.push(t.techName);
    return names.join(", ");
  }

  function buildReports(state, opts) {
    const day = (opts && opts.today) || today();
    const from = (opts && opts.from) || "0000-01-01";
    const to = (opts && opts.to) || "9999-12-31";
    const workRows = state.workOrders.filter(w => inRange(w.openedDate, from, to)).slice().sort((a, b) => String(a.openedDate).localeCompare(String(b.openedDate)) || String(a.woNumber).localeCompare(String(b.woNumber))).map(w => {
      const c = woCosts(state, w.id);
      const task = w.pmTaskId && taskById(state, w.pmTaskId);
      return {
        woNumber: w.woNumber, openedDate: w.openedDate, completedDate: w.completedDate, assetTag: w.assetTag, assetName: w.assetName,
        area: (assetById(state, w.assetId) || {}).area || "", type: w.type, status: STATUS_LABEL[w.status] || w.status, priority: w.priority,
        assigned: whoName(state, w), title: w.title, dueDate: w.dueDate, meterAt: hasNum(w.meterAt) ? num(w.meterAt) : "",
        downtimeHours: num(w.downtimeHours), laborHours: c.laborHours, laborCost: c.labor, partsCost: c.parts, otherCost: c.other, totalCost: c.total,
        partsUsed: partsUsedText(state, w.id), techs: techsOnWo(state, w.id), source: w.source, pmTask: task ? task.name : "",
        requestedBy: w.requestedBy, description: w.description
      };
    });
    const hourRows = state.timeLogs.filter(t => inRange(t.date, from, to)).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.techName).localeCompare(String(b.techName))).map(t => {
      const asset = assetById(state, t.assetId), wo = t.workOrderId && woById(state, t.workOrderId);
      const rate = hasNum(t.rate) ? num(t.rate) : 0;
      return { date: t.date, tech: t.techName, assetTag: asset ? asset.tag : "", assetName: asset ? asset.name : "", area: asset ? asset.area : "", woNumber: wo ? wo.woNumber : "", hours: num(t.hours), rate, laborCost: round2(num(t.hours) * rate), notes: t.notes };
    });
    const assetRows = state.assets.slice().sort((a, b) => String(a.tag).localeCompare(String(b.tag), undefined, { numeric: true })).map(a => {
      const s = spendBetween(state, from, to, a.id);
      const overdue = state.pmTasks.filter(t => t.assetId === a.id && pmInfo(state, t, day).status === "overdue").length;
      const open = state.workOrders.filter(w => w.assetId === a.id && isActive(w.status)).length;
      return { tag: a.tag, name: a.name, area: a.area, type: a.type, status: a.status, meter: hasNum(a.meter) ? num(a.meter) : "", woCount: s.woCount, laborHours: s.hours, partsCost: s.parts, laborCost: s.labor, otherCost: s.other, totalCost: s.total, downtimeHours: s.downtime, openWos: open, overduePms: overdue };
    }).sort((a, b) => b.totalCost - a.totalCost);
    const partRows = state.parts.slice().sort((a, b) => String(a.sku).localeCompare(String(b.sku))).map(p => {
      const used = state.uses.filter(u => u.partId === p.id && inRange(u.createdAt, from, to));
      const qty = used.reduce((s, u) => s + num(u.qty), 0);
      const cost = used.reduce((s, u) => s + num(u.extended), 0);
      const tags = state.fits.filter(f => f.partId === p.id).map(f => (assetById(state, f.assetId) || {}).tag).filter(Boolean);
      return { sku: p.sku, name: p.name, bin: p.bin, vendor: p.vendor, onHand: num(p.onHand), reorderPoint: num(p.reorderPoint), reorderQty: num(p.reorderQty), unitCost: num(p.unitCost), stockValue: round2(num(p.onHand) * num(p.unitCost)), qtyUsed: round2(qty), costUsed: round2(cost), fits: tags.join(", "), low: num(p.onHand) <= num(p.reorderPoint) ? "Yes" : "" };
    });
    const pmRows = state.pmTasks.map(t => {
      const asset = assetById(state, t.assetId), level = levelById(state, t.levelId), info = pmInfo(state, t, day);
      const parts = parseParts(t.partsJson).map(line => { const p = partById(state, line.partId); return line.qty + " × " + (p ? p.sku : line.partId); }).join(", ");
      return { asset: asset ? asset.tag + " " + asset.name : "", level: level ? level.name : "", task: t.name, basis: level ? level.basis : "", interval: intervalLabel(level, asset), lastDone: t.lastCompletedAt, lastMeter: hasNum(t.lastMeter) ? num(t.lastMeter) : "", suggested: info.suggestedDate || "", status: info.summary, openWo: info.openWoNumber, parts };
    }).sort((a, b) => String(a.asset).localeCompare(String(b.asset)) || String(a.task).localeCompare(String(b.task)));

    const col = (key, label, kind) => ({ key, label, kind: kind || "text" });
    return [
      { id: "work", title: "Work orders", blurb: "Every work order opened in the range, with hours, parts, downtime, and cost.", columns: [
        col("woNumber", "WO #"), col("openedDate", "Opened", "date"), col("completedDate", "Completed", "date"), col("assetTag", "Asset"), col("assetName", "Asset name"), col("area", "Area"),
        col("type", "Type"), col("status", "Status"), col("priority", "Priority"), col("assigned", "Assigned to"), col("title", "Title"), col("dueDate", "Due", "date"),
        col("meterAt", "Meter", "num"), col("downtimeHours", "Downtime hrs", "num"), col("laborHours", "Labor hrs", "num"), col("laborCost", "Labor cost", "money"),
        col("partsCost", "Parts cost", "money"), col("otherCost", "Other cost", "money"), col("totalCost", "Total", "money"), col("partsUsed", "Parts used"),
        col("techs", "Techs on the job"), col("source", "Source"), col("pmTask", "PM task"), col("requestedBy", "Requested by"), col("description", "Description")
      ], rows: workRows },
      { id: "hours", title: "Hours by tech and asset", blurb: "One line per time entry, so you can see who spent hours on which machine.", columns: [
        col("date", "Date", "date"), col("tech", "Tech"), col("assetTag", "Asset"), col("assetName", "Asset name"), col("area", "Area"), col("woNumber", "Work order"),
        col("hours", "Hours", "num"), col("rate", "Rate", "money"), col("laborCost", "Labor cost", "money"), col("notes", "Notes")
      ], rows: hourRows },
      { id: "assets", title: "Cost and downtime by asset", blurb: "Which equipment cost the most in the range. Parts, labor, other, and downtime hours.", columns: [
        col("tag", "Tag"), col("name", "Name"), col("area", "Area"), col("type", "Type"), col("status", "Status"), col("meter", "Meter", "num"),
        col("woCount", "Work orders", "num"), col("laborHours", "Labor hrs", "num"), col("partsCost", "Parts cost", "money"), col("laborCost", "Labor cost", "money"),
        col("otherCost", "Other cost", "money"), col("totalCost", "Total", "money"), col("downtimeHours", "Downtime hrs", "num"), col("openWos", "Open WOs", "num"), col("overduePms", "Overdue PMs", "num")
      ], rows: assetRows },
      { id: "parts", title: "Parts and stock", blurb: "On-hand is the count right now. Qty used and cost used follow the date range.", columns: [
        col("sku", "SKU"), col("name", "Name"), col("bin", "Bin"), col("vendor", "Vendor"), col("onHand", "On hand", "num"), col("reorderPoint", "Reorder point", "num"),
        col("reorderQty", "Reorder qty", "num"), col("unitCost", "Unit cost", "money"), col("stockValue", "Stock value now", "money"), col("qtyUsed", "Qty used", "num"),
        col("costUsed", "Cost used", "money"), col("fits", "Fits"), col("low", "Low stock")
      ], rows: partRows },
      { id: "pm", title: "PM status", blurb: "Current preventive maintenance. The date range does not filter this list.", columns: [
        col("asset", "Asset"), col("level", "Level"), col("task", "Task"), col("basis", "Basis"), col("interval", "Interval"), col("lastDone", "Last done", "date"),
        col("lastMeter", "Meter at last PM", "num"), col("suggested", "Suggested due", "date"), col("status", "Status"), col("openWo", "Open WO"), col("parts", "Required parts")
      ], rows: pmRows }
    ];
  }

  function toCsv(columns, rows) {
    const q = v => { v = v == null ? "" : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [columns.map(c => q(c.label)).join(",")];
    for (const row of rows) lines.push(columns.map(c => q(c.kind === "money" || c.kind === "num" ? (row[c.key] === "" ? "" : round2(row[c.key])) : row[c.key])).join(","));
    return lines.join("\r\n");
  }

  function rangeBounds(key, day, custom) {
    day = day || today();
    const [y, m] = day.split("-").map(Number);
    switch (key) {
      case "month": return [day.slice(0, 7) + "-01", day, "This month"];
      case "30d": return [addDays(day, -29), day, "Last 30 days"];
      case "90d": return [addDays(day, -89), day, "Last 90 days"];
      case "ytd": return [y + "-01-01", day, "Year to date"];
      case "12m": return [addDays(day, -364), day, "Last 12 months"];
      case "lastmonth": {
        const start = addDays(y + "-" + pad(m) + "-01", -1).slice(0, 7) + "-01";
        return [start, addDays(y + "-" + pad(m) + "-01", -1), "Last month"];
      }
      case "all": return ["0000-01-01", "9999-12-31", "All time"];
      case "custom": return [(custom && custom.from) || "0000-01-01", (custom && custom.to) || "9999-12-31", "Custom"];
      default: return [addDays(day, -89), day, "Last 90 days"];
    }
  }

  function compatibleParts(state, assetId) {
    const ids = state.fits.filter(f => f.assetId === assetId).map(f => f.partId);
    const linked = state.parts.filter(p => ids.includes(p.id)).slice().sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
    const rest = state.parts.filter(p => !ids.includes(p.id)).slice().sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
    return { linked, rest };
  }

  function sortWork(list, day) {
    return list.slice().sort((a, b) => (isOverdueWo(b, day) - isOverdueWo(a, day)) || (priorityRank(a.priority) - priorityRank(b.priority)) || String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")) || String(a.openedDate || "").localeCompare(String(b.openedDate || "")));
  }

  return {
    STATUSES, STATUS_LABEL, PRIORITIES, WO_TYPES, ASSET_STATUSES, METER_TYPES, BASES, SOURCES, LEVEL_PRESETS, FIELDS,
    num, hasNum, yes, round2, money, pad, today, addDays, daysBetween, startOfWeek, dayOf, fmtDate, fmtShort, uid, clone, inRange, emptyState,
    nextOnHand, techById, assetById, partById, levelById, taskById, woById, isMetered, isActive, meterWord, whoName, priorityRank, isOverdueWo,
    parseParts, stockNote, intervalLabel, runRatePerDay, pmInfo, dueDateFor, woCosts, nextWoNumber,
    saveTech, deleteTech, saveAsset, saveLevel, deleteLevel, saveTask, deleteTask, savePart, deletePart, saveFit, deleteFit,
    saveWo, setWoStatus, deleteDraft, usePart, returnUse, receiveStock, adjustStock, saveReading, saveTime, deleteTime,
    generatePm, generateDue, spendBetween, dashboard, buildReports, toCsv, rangeBounds, compatibleParts, sortWork
  };
});
