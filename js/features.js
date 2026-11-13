/* Extra plant-floor modules. Each one is optional in Settings.
   Records travel as normal sheet rows, same as work orders and parts. */
(function () {
  const PM = globalThis.PM;
  const DEFAULT_FAILURE_CODES = ["Worn", "Broken", "Operator", "Electrical", "Air leak", "Lubrication", "Other"];
  const MODULES = [
    ["today", "Today", "What is overdue, down, late, or low this morning"],
    ["qr", "QR tags", "Printable labels and a camera scan that opens the machine"],
    ["photos", "Photos", "Before, after, nameplate, and part pictures on a work order"],
    ["failure", "Failure codes", "Why it failed, asked when a work order is closed"],
    ["digest", "Morning digest", "Email of overdue PMs, down machines, late jobs, and low stock"],
    ["inspect", "Inspections", "Checklists. A failed line opens a work order"],
    ["down", "Machine down", "One tap starts the downtime clock and can email"],
    ["room", "Compressor room", "Pressure, temps, dew point, drains, and run hours"],
    ["repeat", "Repeat offenders", "Machines with the most jobs, downtime, and cost"],
    ["loto", "Lockout / tagout", "Energy sources and how to isolate them, on the QR page"],
    ["warranty", "Vendors and warranty", "Who to call, when the warranty ends, outside repairs"],
    ["schedule", "Weekly schedule", "Put PMs and work orders on a tech and a day"],
    ["sensors", "Sensor tie-in", "ESP32 or a hand entry can log a reading and raise a flag"],
    ["kits", "Parts kits", "The PM parts list is reserved when its work order opens"],
    ["monthly", "Monthly one-pager", "Uptime, PM compliance, cost by area, top offenders"]
  ];

  function list(state, name) {
    if (!state[name]) state[name] = [];
    return state[name];
  }
  function op(collection, doc) {
    const data = {};
    for (const k of PM.FIELDS[collection]) data[k] = (doc[k] === undefined || doc[k] === null) ? "" : doc[k];
    return { op: "set", collection, id: doc.id, data };
  }
  function drop(collection, id) { return { op: "delete", collection, id }; }
  function nowIso(f) { return (f && f.now) || new Date().toISOString(); }
  function fail(message) { return { ok: false, message, ops: [] }; }

  function failureCodeNames(state) {
    const rows = list(state, "failureCodes").filter(c => c.active !== "no");
    if (!rows.length) return DEFAULT_FAILURE_CODES.slice();
    return rows.slice().sort((a, b) => PM.num(a.sort) - PM.num(b.sort) || String(a.name).localeCompare(String(b.name))).map(c => c.name);
  }
  function saveFailureCode(input, f) {
    const state = PM.clone(input);
    const name = String(f.name || "").trim();
    if (!name) return fail("Name the failure code.");
    const rows = list(state, "failureCodes");
    const existing = f.id && rows.find(c => c.id === f.id);
    if (rows.some(c => c.name.toLowerCase() === name.toLowerCase() && (!existing || c.id !== existing.id))) return fail(name + " is already on the list.");
    const row = {
      id: (existing && existing.id) || PM.uid(),
      name,
      active: f.active === "no" ? "no" : "yes",
      sort: f.sort != null ? PM.num(f.sort) : (existing ? PM.num(existing.sort) : rows.length + 1),
      createdAt: (existing && existing.createdAt) || nowIso(f)
    };
    if (existing) Object.assign(existing, row); else rows.push(row);
    return { ok: true, state, ops: [op("failureCodes", existing || row)], message: name + " saved.", id: row.id };
  }
  function deleteFailureCode(input, id) {
    const state = PM.clone(input);
    const rows = list(state, "failureCodes");
    const row = rows.find(c => c.id === id);
    if (!row) return fail("That code is already gone.");
    state.failureCodes = rows.filter(c => c.id !== id);
    return { ok: true, state, ops: [drop("failureCodes", id)], message: row.name + " removed." };
  }

  function todayBrief(state, day) {
    day = day || PM.today();
    const pms = (state.pmTasks || []).map(t => {
      const info = PM.pmInfo(state, t, day);
      const asset = PM.assetById(state, t.assetId);
      return { taskId: t.id, name: t.name, tag: asset ? asset.tag : "", info };
    }).filter(p => p.info.status === "overdue" || p.info.status === "due");
    const down = (state.assets || []).filter(a => a.status === "Down").map(a => {
      const open = list(state, "downtimeEvents").find(e => e.assetId === a.id && e.open === "yes");
      return { id: a.id, tag: a.tag, name: a.name, since: open ? open.startedAt : "" };
    });
    const late = (state.workOrders || []).filter(w => PM.isOverdueWo(w, day)).map(w => ({ id: w.id, woNumber: w.woNumber, title: w.title, tag: w.assetTag, dueDate: w.dueDate }));
    const low = (state.parts || []).filter(p => PM.num(p.onHand) <= PM.num(p.reorderPoint)).map(p => ({ id: p.id, sku: p.sku, name: p.name, onHand: PM.num(p.onHand), reorderPoint: PM.num(p.reorderPoint) }));
    const expiring = warrantyAlerts(state, day);
    return { day, pms, down, late, low, expiring };
  }

  function machineDown(input, f) {
    const state = PM.clone(input);
    const asset = PM.assetById(state, f.assetId);
    if (!asset) return fail("Pick the machine.");
    const events = list(state, "downtimeEvents");
    if (events.some(e => e.assetId === asset.id && e.open === "yes")) return fail(asset.tag + " is already clocked down.");
    const now = nowIso(f);
    asset.status = "Down";
    asset.updatedAt = now;
    const ev = {
      id: PM.uid(), assetId: asset.id, assetTag: asset.tag, workOrderId: f.workOrderId || "",
      startedAt: now, endedAt: "", minutes: "", open: "yes", note: String(f.note || "").trim(), createdAt: now
    };
    events.push(ev);
    const ops = [op("assets", asset), op("downtimeEvents", ev)];
    return { ok: true, state, ops, message: asset.tag + " is down. The clock is running.", assetId: asset.id, eventId: ev.id, notify: true };
  }
  function machineUp(input, f) {
    const state = PM.clone(input);
    const asset = PM.assetById(state, f.assetId);
    if (!asset) return fail("Pick the machine.");
    const ev = list(state, "downtimeEvents").find(e => e.assetId === asset.id && e.open === "yes");
    if (!ev) return fail(asset.tag + " does not have an open downtime clock.");
    const now = nowIso(f);
    const mins = Math.max(0, Math.round((Date.parse(now) - Date.parse(ev.startedAt)) / 60000));
    ev.endedAt = now;
    ev.minutes = mins;
    ev.open = "no";
    if (f.note) ev.note = String(f.note).trim();
    asset.status = f.status && PM.ASSET_STATUSES.includes(f.status) ? f.status : "Running";
    asset.updatedAt = now;
    return { ok: true, state, ops: [op("assets", asset), op("downtimeEvents", ev)], message: asset.tag + " is back up. Down for " + mins + " min.", minutes: mins };
  }
  function openDowntime(state, assetId) {
    return list(state, "downtimeEvents").find(e => e.assetId === assetId && e.open === "yes") || null;
  }

  function saveLimit(input, f) {
    const state = PM.clone(input);
    const asset = PM.assetById(state, f.assetId);
    if (!asset) return fail("Pick the machine.");
    const name = String(f.name || "").trim();
    if (!name) return fail("Name the reading, like Discharge pressure.");
    const rows = list(state, "sensorLimits");
    const existing = f.id && rows.find(x => x.id === f.id);
    const row = {
      id: (existing && existing.id) || PM.uid(),
      assetId: asset.id, name, unit: String(f.unit || "").trim(),
      low: f.low === "" || f.low == null ? "" : PM.num(f.low),
      high: f.high === "" || f.high == null ? "" : PM.num(f.high),
      active: f.active === "no" ? "no" : "yes",
      createdAt: (existing && existing.createdAt) || nowIso(f)
    };
    if (PM.hasNum(row.low) && PM.hasNum(row.high) && PM.num(row.low) > PM.num(row.high)) return fail("The low limit is above the high limit.");
    if (existing) Object.assign(existing, row); else rows.push(row);
    return { ok: true, state, ops: [op("sensorLimits", existing || row)], message: name + " limits saved.", id: row.id };
  }
  function flagValue(limit, value) {
    if (!limit || limit.active === "no") return "ok";
    if (PM.hasNum(limit.low) && value < PM.num(limit.low)) return "low";
    if (PM.hasNum(limit.high) && value > PM.num(limit.high)) return "high";
    return "ok";
  }
  function ingestSensor(input, f) {
    const state = PM.clone(input);
    let asset = f.assetId ? PM.assetById(state, f.assetId) : null;
    if (!asset && f.tag) asset = (state.assets || []).find(a => String(a.tag).toLowerCase() === String(f.tag).trim().toLowerCase());
    if (!asset) return fail("No machine with that tag.");
    if (!PM.hasNum(f.value)) return fail("The reading needs a number.");
    const value = PM.num(f.value);
    const type = String(f.type || "other").toLowerCase();
    const name = String(f.name || type).trim();
    const limit = list(state, "sensorLimits").find(l => l.assetId === asset.id && String(l.name).toLowerCase() === name.toLowerCase() && l.active !== "no");
    const flag = flagValue(limit, value);
    const now = nowIso(f);
    const date = f.date || PM.dayOf(now);
    const log = {
      id: PM.uid(), assetId: asset.id, assetTag: asset.tag, name, unit: (limit && limit.unit) || String(f.unit || ""),
      value, type, date, source: f.source || "manual", flag, note: String(f.note || ""), createdAt: now
    };
    list(state, "sensorLogs").push(log);
    const ops = [op("sensorLogs", log)];
    let pmDue = false;
    if (type === "hours" || type === "meter" || type === "cycles") {
      if (PM.isMetered(asset)) {
        asset.meter = value;
        asset.updatedAt = now;
        ops.push(op("assets", asset));
        const reading = { id: PM.uid(), assetId: asset.id, workOrderId: "", reading: value, techId: f.techId || "", date, notes: "Sensor " + name, createdAt: now };
        list(state, "readings").push(reading);
        ops.push(op("readings", reading));
        pmDue = (state.pmTasks || []).some(t => t.assetId === asset.id && PM.pmInfo(state, t, date).status === "overdue");
      }
    }
    const message = asset.tag + " " + name + " " + value + (log.unit ? " " + log.unit : "") + (flag === "ok" ? "" : " is out of range (" + flag + ").");
    return { ok: true, state, ops, message, flag, pmDue, logId: log.id, assetId: asset.id };
  }
  function trend(state, assetId, name) {
    return list(state, "sensorLogs").filter(l => l.assetId === assetId && (!name || String(l.name).toLowerCase() === String(name).toLowerCase()))
      .slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  function saveTemplate(input, f) {
    const state = PM.clone(input);
    const name = String(f.name || "").trim();
    if (!name) return fail("Name the checklist.");
    const templates = list(state, "checkTemplates");
    const existing = f.id && templates.find(t => t.id === f.id);
    const row = {
      id: (existing && existing.id) || PM.uid(),
      name, assetId: f.assetId || "", notes: String(f.notes || ""),
      active: f.active === "no" ? "no" : "yes",
      createdAt: (existing && existing.createdAt) || nowIso(f)
    };
    if (existing) Object.assign(existing, row); else templates.push(row);
    const ops = [op("checkTemplates", existing || row)];
    const items = Array.isArray(f.items) ? f.items : null;
    if (items) {
      const keep = new Set();
      items.forEach((text, i) => {
        const line = String(text || "").trim();
        if (!line) return;
        const item = { id: PM.uid(), templateId: row.id, sort: i + 1, text: line, createdAt: nowIso(f) };
        list(state, "checkItems").push(item);
        ops.push(op("checkItems", item));
        keep.add(item.id);
      });
      if (existing) {
        state.checkItems = list(state, "checkItems").filter(it => {
          if (it.templateId !== row.id) return true;
          if (keep.has(it.id)) return true;
          ops.push(drop("checkItems", it.id));
          return false;
        });
      }
    }
    return { ok: true, state, ops, message: name + " saved.", id: row.id };
  }
  function submitInspection(input, f) {
    const state = PM.clone(input);
    const template = list(state, "checkTemplates").find(t => t.id === f.templateId);
    if (!template) return fail("That checklist was not found.");
    const asset = PM.assetById(state, f.assetId || template.assetId);
    if (!asset) return fail("Pick the machine you walked.");
    const lines = Array.isArray(f.lines) ? f.lines : [];
    if (!lines.length) return fail("There is nothing to record.");
    const now = nowIso(f);
    const day = f.date || PM.dayOf(now);
    const insp = { id: PM.uid(), templateId: template.id, assetId: asset.id, techId: f.techId || "", date: day, status: "complete", notes: String(f.notes || ""), createdAt: now };
    list(state, "inspections").push(insp);
    const ops = [op("inspections", insp)];
    const opened = [];
    lines.forEach(line => {
      const result = ["pass", "fail", "na"].includes(line.result) ? line.result : "pass";
      let workOrderId = "";
      if (result === "fail") {
        const made = PM.saveWo(state, {
          title: template.name + ": " + String(line.text || "Failed check").slice(0, 60),
          description: "Failed on " + template.name + ".\n" + (line.text || "") + (line.note ? "\n" + line.note : ""),
          assetId: asset.id, status: "open", type: "Inspection", priority: "High",
          assignedTo: f.techId || "", source: "typed", requestedBy: "Inspection", openedDate: day, now
        });
        if (made.ok) {
          Object.keys(state).forEach(k => { if (Array.isArray(made.state[k])) state[k] = made.state[k]; });
          ops.push.apply(ops, made.ops);
          workOrderId = made.woId;
          opened.push(made.woNumber);
        }
      }
      const row = { id: PM.uid(), inspectionId: insp.id, itemId: line.itemId || "", text: String(line.text || ""), result, note: String(line.note || ""), workOrderId, createdAt: now };
      list(state, "inspectionLines").push(row);
      ops.push(op("inspectionLines", row));
    });
    const message = opened.length ? "Inspection saved. Opened " + opened.join(", ") + " for the failed lines." : "Inspection saved. Everything passed or was N/A.";
    return { ok: true, state, ops, message, inspectionId: insp.id, opened };
  }

  function saveLoto(input, f) {
    const state = PM.clone(input);
    const asset = PM.assetById(state, f.assetId);
    if (!asset) return fail("Pick the machine.");
    const name = String(f.name || "").trim();
    if (!name) return fail("Name the energy source, like Main disconnect.");
    const rows = list(state, "lotoPoints");
    const existing = f.id && rows.find(x => x.id === f.id);
    const row = {
      id: (existing && existing.id) || PM.uid(),
      assetId: asset.id, name, energy: String(f.energy || "electrical"),
      howToIsolate: String(f.howToIsolate || ""), photoData: f.photoData != null ? String(f.photoData) : ((existing && existing.photoData) || ""),
      sort: f.sort != null ? PM.num(f.sort) : rows.filter(x => x.assetId === asset.id).length + 1,
      createdAt: (existing && existing.createdAt) || nowIso(f)
    };
    if (existing) Object.assign(existing, row); else rows.push(row);
    return { ok: true, state, ops: [op("lotoPoints", existing || row)], message: name + " saved on the lockout sheet.", id: row.id };
  }
  function deleteLoto(input, id) {
    const state = PM.clone(input);
    const row = list(state, "lotoPoints").find(x => x.id === id);
    if (!row) return fail("That point is already gone.");
    state.lotoPoints = state.lotoPoints.filter(x => x.id !== id);
    return { ok: true, state, ops: [drop("lotoPoints", id)], message: row.name + " removed." };
  }

  function saveWarranty(input, f) {
    const state = PM.clone(input);
    const asset = PM.assetById(state, f.assetId);
    if (!asset) return fail("Pick the machine.");
    const what = String(f.what || "").trim();
    if (!what) return fail("Say what is covered.");
    const rows = list(state, "warranties");
    const existing = f.id && rows.find(x => x.id === f.id);
    const row = {
      id: (existing && existing.id) || PM.uid(),
      assetId: asset.id, vendor: String(f.vendor || "").trim(), what,
      expires: PM.dayOf(f.expires || ""), notes: String(f.notes || ""),
      createdAt: (existing && existing.createdAt) || nowIso(f)
    };
    if (existing) Object.assign(existing, row); else rows.push(row);
    return { ok: true, state, ops: [op("warranties", existing || row)], message: "Warranty saved.", id: row.id };
  }
  function warrantyAlerts(state, day) {
    day = day || PM.today();
    const soon = PM.addDays(day, 30);
    return list(state, "warranties").filter(w => w.expires && w.expires <= soon).map(w => {
      const asset = PM.assetById(state, w.assetId);
      return { id: w.id, tag: asset ? asset.tag : "", what: w.what, vendor: w.vendor, expires: w.expires, overdue: w.expires < day };
    }).sort((a, b) => String(a.expires).localeCompare(String(b.expires)));
  }
  function saveOutsideJob(input, f) {
    const state = PM.clone(input);
    const asset = PM.assetById(state, f.assetId);
    if (!asset) return fail("Pick the machine.");
    const vendor = String(f.vendor || "").trim();
    if (!vendor) return fail("Name the vendor.");
    const rows = list(state, "outsideJobs");
    const existing = f.id && rows.find(x => x.id === f.id);
    const statuses = ["quoted", "approved", "in shop", "back", "closed"];
    const row = {
      id: (existing && existing.id) || PM.uid(),
      assetId: asset.id, vendor, estimate: String(f.estimate || ""), po: String(f.po || ""),
      cost: f.cost === "" || f.cost == null ? "" : PM.round2(f.cost),
      status: statuses.includes(f.status) ? f.status : "quoted",
      openedDate: PM.dayOf(f.openedDate || nowIso(f)), notes: String(f.notes || ""),
      createdAt: (existing && existing.createdAt) || nowIso(f)
    };
    if (existing) Object.assign(existing, row); else rows.push(row);
    return { ok: true, state, ops: [op("outsideJobs", existing || row)], message: "Outside service saved.", id: row.id };
  }

  function saveSchedule(input, f) {
    const state = PM.clone(input);
    const date = PM.dayOf(f.date || "");
    if (!date) return fail("Pick the day.");
    const tech = f.techId ? PM.techById(state, f.techId) : null;
    if (f.techId && !tech) return fail("That tech is not on the team.");
    if (!f.workOrderId && !f.pmTaskId) return fail("Pick a work order or a PM task.");
    const row = {
      id: PM.uid(), date, techId: tech ? tech.id : "", workOrderId: f.workOrderId || "", pmTaskId: f.pmTaskId || "",
      note: String(f.note || ""), createdAt: nowIso(f)
    };
    list(state, "schedules").push(row);
    let ops = [op("schedules", row)];
    let message = "Put on " + date + (tech ? " for " + tech.name : "") + ".";
    if (f.workOrderId) {
      const wo = PM.woById(state, f.workOrderId);
      if (!wo) return fail("That work order was not found.");
      const saved = PM.saveWo(state, Object.assign({}, wo, { assignedTo: tech ? tech.id : wo.assignedTo, dueDate: date }));
      if (!saved.ok) return saved;
      Object.keys(saved.state).forEach(k => { if (Array.isArray(saved.state[k])) state[k] = saved.state[k]; });
      state.schedules = list(state, "schedules");
      if (!state.schedules.some(s => s.id === row.id)) state.schedules.push(row);
      ops = saved.ops.concat(ops);
      message = wo.woNumber + " is on " + date + (tech ? " for " + tech.name : "") + ".";
    }
    return { ok: true, state, ops, message, id: row.id };
  }
  function deleteSchedule(input, id) {
    const state = PM.clone(input);
    const row = list(state, "schedules").find(s => s.id === id);
    if (!row) return fail("That assignment is already gone.");
    state.schedules = state.schedules.filter(s => s.id !== id);
    return { ok: true, state, ops: [drop("schedules", id)], message: "Taken off the board." };
  }

  function saveSettings(input, f) {
    const state = PM.clone(input);
    const rows = list(state, "settings");
    const existing = rows.find(s => s.id === "plantcfg") || null;
    const hour = String(f.digestHour == null || f.digestHour === "" ? (existing ? existing.digestHour : "6") : f.digestHour);
    const row = {
      id: "plantcfg",
      digestEmail: String(f.digestEmail != null ? f.digestEmail : (existing && existing.digestEmail) || "").trim(),
      digestHour: hour,
      alertEmail: String(f.alertEmail != null ? f.alertEmail : (existing && existing.alertEmail) || "").trim(),
      createdAt: (existing && existing.createdAt) || nowIso(f)
    };
    if (existing) Object.assign(existing, row); else rows.push(row);
    return { ok: true, state, ops: [op("settings", existing || row)], message: "Alert settings saved.", id: "plantcfg" };
  }
  function plantSettings(state) {
    return list(state, "settings").find(s => s.id === "plantcfg") || { id: "plantcfg", digestEmail: "", digestHour: "6", alertEmail: "" };
  }

  function addPhoto(input, f) {
    const state = PM.clone(input);
    const kind = ["before", "after", "nameplate", "part", "loto", "other"].includes(f.kind) ? f.kind : "other";
    if (!f.workOrderId && !f.assetId) return fail("A photo needs a work order or a machine.");
    const row = {
      id: PM.uid(), workOrderId: f.workOrderId || "", assetId: f.assetId || "", kind,
      name: String(f.name || kind), driveFileId: f.driveFileId || "", url: f.url || "",
      dataUrl: f.dataUrl || "", techId: f.techId || "", createdAt: nowIso(f)
    };
    list(state, "photos").push(row);
    return { ok: true, state, ops: [op("photos", row)], message: "Photo saved.", id: row.id };
  }

  function downtimeMinutes(state, assetId, from, to) {
    let mins = 0;
    list(state, "downtimeEvents").forEach(e => {
      if (assetId && e.assetId !== assetId) return;
      const startDay = PM.dayOf(e.startedAt);
      if (e.open === "yes") {
        if (startDay && startDay <= to) mins += PM.num(e.minutes) || 0;
        return;
      }
      const endDay = PM.dayOf(e.endedAt || e.startedAt);
      if (endDay && endDay >= from && startDay <= to) mins += PM.num(e.minutes);
    });
    return mins;
  }
  function repeatOffenders(state, day, span) {
    const days = span === 30 ? 30 : 90;
    const from = PM.addDays(day, -(days - 1));
    return (state.assets || []).map(a => {
      const wos = (state.workOrders || []).filter(w => w.assetId === a.id && w.status !== "cancelled" && w.status !== "draft" && PM.inRange(w.openedDate, from, day));
      const spend = PM.spendBetween(state, from, day, a.id);
      const eventMins = downtimeMinutes(state, a.id, from, day);
      const woHours = wos.reduce((n, w) => n + PM.num(w.downtimeHours), 0);
      const downtime = eventMins ? Math.round(eventMins / 60 * 10) / 10 : woHours;
      return { id: a.id, tag: a.tag, name: a.name, area: a.area || "", woCount: wos.length, downtime, cost: spend.total };
    }).filter(a => a.woCount || a.downtime || a.cost).sort((a, b) => b.cost - a.cost || b.downtime - a.downtime || b.woCount - a.woCount);
  }
  function monthlyOnePager(state, day) {
    day = day || PM.today();
    const from = day.slice(0, 7) + "-01";
    const offenders = repeatOffenders(state, day, 30).slice(0, 5);
    const byArea = {};
    (state.assets || []).forEach(a => {
      const spend = PM.spendBetween(state, from, day, a.id);
      const key = a.area || "Unassigned";
      if (!byArea[key]) byArea[key] = { area: key, cost: 0, downtime: 0, wos: 0 };
      byArea[key].cost = PM.round2(byArea[key].cost + spend.total);
      byArea[key].downtime = PM.round2(byArea[key].downtime + spend.downtime);
      byArea[key].wos += spend.woCount;
    });
    const areas = Object.values(byArea).filter(a => a.cost || a.wos || a.downtime).sort((a, b) => b.cost - a.cost);
    const active = (state.pmTasks || []).filter(t => t.active !== "no");
    const ok = active.filter(t => PM.pmInfo(state, t, day).status === "ok").length;
    const compliance = active.length ? Math.round(ok / active.length * 100) : 100;
    const assets = (state.assets || []).filter(a => a.status !== "Out of service");
    const elapsedDays = Math.max(1, PM.daysBetween(from, day) + 1);
    const possible = assets.length * elapsedDays * 24 * 60;
    let down = 0;
    assets.forEach(a => { down += downtimeMinutes(state, a.id, from, day); });
    const uptime = possible ? Math.max(0, Math.min(100, Math.round((1 - down / possible) * 1000) / 10)) : 100;
    const spend = PM.spendBetween(state, from, day);
    return { from, day, compliance, uptime, spend, areas, offenders, pmCount: active.length, pmOk: ok };
  }
  function reorderRows(state) {
    return (state.parts || []).filter(p => PM.num(p.onHand) <= PM.num(p.reorderPoint)).map(p => ({
      sku: p.sku, name: p.name, bin: p.bin || "", onHand: PM.num(p.onHand), reorderPoint: PM.num(p.reorderPoint),
      reorderQty: PM.num(p.reorderQty), vendor: p.vendor || "", unitCost: PM.num(p.unitCost)
    })).sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  }
  function reorderCsv(state) {
    const cols = [
      { key: "sku", label: "SKU" }, { key: "name", label: "Name" }, { key: "bin", label: "Bin" },
      { key: "onHand", label: "On hand", kind: "num" }, { key: "reorderPoint", label: "Reorder point", kind: "num" },
      { key: "reorderQty", label: "Order qty", kind: "num" }, { key: "vendor", label: "Vendor" }, { key: "unitCost", label: "Unit cost", kind: "money" }
    ];
    return PM.toCsv(cols, reorderRows(state));
  }

  function assetLink(assetId) {
    let base = "";
    try { base = location.origin + location.pathname; } catch (e) { base = ""; }
    return base + "#asset/" + assetId;
  }

  function seedFeatures(state, today) {
    const d = n => PM.addDays(today, n);
    const go = r => { if (!r.ok) throw new Error(r.message || "seed failed"); return r.state; };
    let s = state;
    DEFAULT_FAILURE_CODES.forEach((name, i) => { s = go(saveFailureCode(s, { name, sort: i + 1, now: today + "T12:00:00.000Z" })); });
    const ac = s.assets.find(a => a.tag === "AC-2");
    const rt = s.assets.find(a => a.tag === "RT-1");
    const randy = s.techs.find(t => t.name === "Randy Johnson");
    if (ac) {
      s = go(saveLimit(s, { assetId: ac.id, name: "Discharge pressure", unit: "psi", low: 90, high: 125, now: today + "T12:00:00.000Z" }));
      s = go(saveLimit(s, { assetId: ac.id, name: "Dryer dew point", unit: "F", low: -20, high: 40, now: today + "T12:00:00.000Z" }));
      s = go(saveLimit(s, { assetId: ac.id, name: "Oil temp", unit: "F", low: 100, high: 210, now: today + "T12:00:00.000Z" }));
      [[-6, 110], [-4, 108], [-2, 118], [0, 132]].forEach(([day, psi]) => {
        s = go(ingestSensor(s, { assetId: ac.id, name: "Discharge pressure", type: "pressure", value: psi, date: d(day), source: "manual", now: d(day) + "T08:00:00.000Z" }));
      });
      s = go(ingestSensor(s, { assetId: ac.id, name: "Dryer dew point", type: "temp", value: 38, unit: "F", date: today, source: "manual", now: today + "T08:05:00.000Z" }));
      s = go(saveTemplate(s, {
        name: "Daily compressor round", assetId: ac.id,
        items: ["Discharge pressure in range", "Oil temp in range", "Dryer dew point in range", "Drains blown", "No new oil on the floor"],
        now: today + "T12:00:00.000Z"
      }));
    }
    if (rt) {
      s = go(saveLoto(s, { assetId: rt.id, name: "Bridge disconnect", energy: "electrical", howToIsolate: "Lock the wall disconnect at column C4. Try the pendant. It must be dead.", sort: 1, now: today + "T12:00:00.000Z" }));
      s = go(saveLoto(s, { assetId: rt.id, name: "Festoon air", energy: "pneumatic", howToIsolate: "Close the yellow valve on the festoon drop and bleed the gauge to zero.", sort: 2, now: today + "T12:00:00.000Z" }));
      s = go(saveWarranty(s, { assetId: rt.id, vendor: "Mitek", what: "Gearbox rebuild", expires: d(20), notes: "Shop warranty from the last rebuild.", now: today + "T12:00:00.000Z" }));
      s = go(saveOutsideJob(s, { assetId: rt.id, vendor: "Mitek field service", estimate: "EST-441", po: "PO-1904", cost: 900, status: "closed", openedDate: d(-14), notes: "Faced the gearbox cover.", now: today + "T12:00:00.000Z" }));
      const events = list(s, "downtimeEvents");
      const ev = { id: PM.uid(), assetId: rt.id, assetTag: "RT-1", workOrderId: "", startedAt: d(-1) + "T06:40:00.000Z", endedAt: "", minutes: "", open: "yes", note: "Still tripping overload.", createdAt: d(-1) + "T06:40:00.000Z" };
      events.push(ev);
    }
    s = go(saveSettings(s, { digestEmail: "maintenance-lead@example.com", alertEmail: "maintenance-lead@example.com", digestHour: "6", now: today + "T12:00:00.000Z" }));
    const template = s.checkTemplates.find(t => t.name === "Daily compressor round");
    if (template && ac && randy) {
      const items = s.checkItems.filter(i => i.templateId === template.id);
      s = go(submitInspection(s, {
        templateId: template.id, assetId: ac.id, techId: randy.id, date: today,
        lines: items.map((item, idx) => ({ itemId: item.id, text: item.text, result: idx === 0 ? "fail" : "pass", note: idx === 0 ? "Gauge was at 132." : "" })),
        now: today + "T08:20:00.000Z"
      }));
    }
    const saw = s.workOrders.find(w => w.title === "Panel saw cut is wandering");
    const ty = s.techs.find(t => t.name === "Ty Brooks");
    if (saw && ty) s = go(saveSchedule(s, { date: today, techId: ty.id, workOrderId: saw.id, now: today + "T06:00:00.000Z" }));
    return s;
  }

  Object.assign(PM, {
    MODULES, DEFAULT_FAILURE_CODES, failureCodeNames, saveFailureCode, deleteFailureCode, todayBrief,
    machineDown, machineUp, openDowntime, saveLimit, flagValue, ingestSensor, trend,
    saveTemplate, submitInspection, saveLoto, deleteLoto, saveWarranty, warrantyAlerts, saveOutsideJob,
    saveSchedule, deleteSchedule, saveSettings, plantSettings, addPhoto,
    downtimeMinutes, repeatOffenders, monthlyOnePager, reorderRows, reorderCsv, assetLink, seedFeatures
  });
})();
