const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PM = require("../js/logic.js");
const QR = require("../js/qr.js");
require("../js/features.js");
require("../js/sample.js");

const DAY = "2026-11-12";

function sample() { return PM.buildSample(DAY); }
function task(s, name) { return s.pmTasks.find(t => t.name === name); }
function asset(s, tag) { return s.assets.find(a => a.tag === tag); }
function part(s, sku) { return s.parts.find(p => p.sku === sku); }
function sumMoves(s, partId) {
  return PM.round2(s.moves.filter(m => m.partId === partId).reduce((n, m) => n + PM.num(m.qty), 0));
}

test("sample plant tells the Lillington story", () => {
  const s = sample();
  assert.equal(s.techs.length, 5);
  assert.ok(s.techs.some(t => t.name === "Randy Johnson" && t.role === "Maintenance lead"));
  assert.equal(s.assets.length, 10);
  assert.equal(asset(s, "RT-1").status, "Down");
  assert.equal(PM.isMetered(asset(s, "PS-12")), false);
  assert.equal(PM.isMetered(asset(s, "AC-2")), true);
  assert.equal(PM.num(asset(s, "AC-2").meter), 18640);
  assert.equal(PM.num(asset(s, "WL-1").meter), 9120);

  const low = s.parts.filter(p => PM.num(p.onHand) <= PM.num(p.reorderPoint)).map(p => p.sku).sort();
  assert.deepEqual(low, ["HYD-05", "OIL-46", "PBF-20", "VB-B68"]);

  for (const p of s.parts) assert.equal(sumMoves(s, p.id), PM.num(p.onHand), p.sku);

  const voice = s.workOrders.find(w => w.source === "voice");
  assert.ok(voice);
  assert.equal(voice.status, "draft");
  assert.equal(voice.assetId, "");
  assert.match(voice.voiceTranscript, /grinding/);

  const leak = s.workOrders.find(w => w.title === "Hydraulic seep at the turner");
  assert.equal(PM.whoName(s, leak), "Marcus Hale");
  assert.equal(leak.status, "open");
  assert.equal(PM.isOverdueWo(leak, DAY), true);

  const comp = PM.pmInfo(s, task(s, "500 hour compressor service"), DAY);
  assert.equal(comp.status, "overdue", comp.summary);
  assert.ok(comp.suggestedDate);

  const air = PM.pmInfo(s, task(s, "Monthly filter change"), DAY);
  assert.equal(air.status, "overdue", air.summary);
  assert.equal(PM.isMetered(asset(s, "MA-1")), false);

  const lube = PM.pmInfo(s, task(s, "250 hour lube and chain"), DAY);
  assert.equal(lube.status, "soon", lube.summary);
  assert.ok(lube.suggestedDate > DAY, lube.summary);

  const booth = PM.pmInfo(s, task(s, "Quarterly booth filters"), DAY);
  assert.equal(booth.status, "soon", booth.summary);

  const daily = PM.pmInfo(s, task(s, "Daily walkaround"), DAY);
  assert.equal(daily.status, "due", daily.summary);

  const floor = PM.pmInfo(s, task(s, "Monthly floor line service"), DAY);
  assert.equal(floor.status, "overdue", floor.summary);
  assert.ok(floor.openWoNumber, floor.summary);

  const dash = PM.dashboard(s, DAY);
  assert.equal(dash.topAssets[0].tag, "RT-1");
  assert.ok(dash.topAssets[0].total > 3000);
  assert.ok(dash.downtime[0].tag === "RT-1" && dash.downtime[0].hours >= 22);
  assert.ok(dash.lowCount >= 4);
  assert.ok(dash.openByTech.some(t => t.name === "Marcus Hale" && t.count >= 1));

  const linked = PM.compatibleParts(s, asset(s, "WL-1").id).linked.map(p => p.sku);
  assert.ok(linked.includes("HYD-05"));
  assert.ok(!linked.includes("OIL-46"));
});

test("using a part deducts stock and a second phone's count still adds up", () => {
  let s = PM.emptyState();
  s = PM.savePart(s, { sku: "T-1", name: "Test filter", onHand: 10, reorderPoint: 4, reorderQty: 6, unitCost: 5, bin: "Z" }).state;
  s = PM.saveAsset(s, { tag: "X-1", name: "Test machine", metered: "no" }).state;
  s = PM.saveTech(s, { name: "Pat", hourlyRate: 20 }).state;
  const wo = PM.saveWo(s, { title: "Leak", assetId: s.assets[0].id, status: "open", assignedTo: s.techs[0].id });
  s = wo.state;
  const used = PM.usePart(s, { workOrderId: wo.woId, partId: s.parts[0].id, qty: 7, techId: s.techs[0].id });
  assert.equal(used.ok, true, used.message);
  assert.equal(used.state.parts[0].onHand, 3);
  assert.match(used.message, /reorder point is 4/i);
  const op = used.ops.find(o => o.collection === "parts");
  assert.equal(op.data._onHandDelta, -7);
  assert.equal(op.data.onHand, undefined);
  assert.equal(PM.nextOnHand(10, op.data), 3);
  assert.equal(PM.nextOnHand(12, op.data), 5, "a count already on the sheet is not replaced");
  const back = PM.returnUse(used.state, used.state.uses[0].id);
  assert.equal(back.state.parts[0].onHand, 10);
  assert.equal(PM.woCosts(back.state, wo.woId).parts, 0);
});

test("receive adds and a recount sets, edits do not wipe the bin", () => {
  let s = PM.emptyState();
  s = PM.savePart(s, { sku: "OIL", name: "Oil", onHand: 0, reorderPoint: 2, reorderQty: 4, unitCost: 10 }).state;
  const id = s.parts[0].id;
  const rec = PM.receiveStock(s, { partId: id, qty: 5, note: "PO 100" });
  assert.equal(rec.state.parts[0].onHand, 5);
  assert.equal(PM.nextOnHand(0, rec.ops.find(o => o.collection === "parts").data), 5);
  const edit = PM.savePart(rec.state, { id, sku: "OIL", name: "Oil gal", unitCost: 11, reorderPoint: 2, reorderQty: 4 });
  const data = edit.ops.find(o => o.collection === "parts").data;
  assert.equal(data._onHandDelta, 0);
  assert.equal(PM.nextOnHand(8, data), 8);
  const adj = PM.adjustStock(edit.state, { partId: id, onHand: 1, note: "Counted the shelf" });
  assert.equal(adj.state.parts[0].onHand, 1);
  assert.equal(PM.nextOnHand(99, adj.ops.find(o => o.collection === "parts").data), 1);
  assert.match(adj.message, /reorder point is 2/i);
  assert.equal(PM.nextOnHand(0, { _onHandDelta: 0 }), 0);
  assert.equal(PM.nextOnHand(0, { _onHandDelta: 5 }), 5);
});

test("PM work order pulls parts, logs cost, and will not double-open", () => {
  const s0 = sample();
  const t = task(s0, "500 hour compressor service");
  const oilBefore = part(s0, "OIL-46").onHand;
  const filtBefore = part(s0, "CF-200").onHand;
  const made = PM.generatePm(s0, { taskId: t.id, assignedTo: s0.techs[0].id, today: DAY });
  assert.equal(made.ok, true, made.message);
  assert.match(made.message, /OIL-46/);
  assert.match(made.message, /reorder/i);
  const oil = made.state.parts.find(p => p.sku === "OIL-46");
  const filt = made.state.parts.find(p => p.sku === "CF-200");
  assert.equal(oil.onHand, PM.round2(oilBefore - 4));
  assert.equal(filt.onHand, PM.round2(filtBefore - 1));
  const wo = made.state.workOrders.find(w => w.id === made.woId);
  assert.equal(wo.type, "PM");
  assert.equal(wo.assetTag, "AC-2");
  assert.equal(wo.source, "pm");
  const cost = PM.woCosts(made.state, wo.id);
  assert.equal(cost.parts, PM.round2(4 * 22 + 34));
  const again = PM.generatePm(made.state, { taskId: t.id, today: DAY });
  assert.equal(again.ok, false);
  assert.equal(again.woId, wo.id);
  const cancelled = PM.setWoStatus(made.state, { id: wo.id, status: "cancelled" });
  assert.equal(cancelled.state.parts.find(p => p.sku === "OIL-46").onHand, oilBefore);
  assert.equal(PM.woCosts(cancelled.state, wo.id).parts, 0);
});

test("completing a PM stamps the meter and clears the overdue flag", () => {
  let s = sample();
  const t = task(s, "500 hour compressor service");
  s = PM.generatePm(s, { taskId: t.id, today: DAY }).state;
  const wo = s.workOrders.find(w => w.pmTaskId === t.id && w.status !== "complete");
  const done = PM.setWoStatus(s, { id: wo.id, status: "complete", date: DAY, meterAt: 18640, downtimeHours: 1.5, workPerformed: "Oil and filter changed." });
  assert.equal(done.ok, true, done.message);
  const after = done.state.pmTasks.find(x => x.id === t.id);
  assert.equal(after.lastCompletedAt, DAY);
  assert.equal(PM.num(after.lastMeter), 18640);
  const info = PM.pmInfo(done.state, after, DAY);
  assert.equal(info.status, "ok", info.summary);
  assert.equal(PM.num(done.state.assets.find(a => a.tag === "AC-2").meter), 18640);
});

test("a meter reading on a repair moves the PM date", () => {
  const s0 = sample();
  const wall = asset(s0, "WL-1");
  const leak = s0.workOrders.find(w => w.title === "Hydraulic seep at the turner");
  const logged = PM.saveReading(s0, { assetId: wall.id, workOrderId: leak.id, reading: 9400, date: DAY, techId: s0.techs[0].id });
  assert.equal(logged.ok, true, logged.message);
  assert.equal(PM.num(logged.state.assets.find(a => a.tag === "WL-1").meter), 9400);
  assert.equal(PM.num(logged.state.workOrders.find(w => w.id === leak.id).meterAt), 9400);
  const info = PM.pmInfo(logged.state, task(logged.state, "250 hour lube and chain"), DAY);
  assert.equal(info.status, "overdue", info.summary);
  const saw = PM.saveReading(s0, { assetId: asset(s0, "PS-12").id, reading: 10, date: DAY });
  assert.equal(saw.ok, false);
  const lvl = PM.saveLevel(s0, { assetId: asset(s0, "MA-1").id, name: "500 hours", basis: "meter", everyMeter: 500 });
  assert.equal(lvl.ok, false);
});

test("hours land on the tech and the asset, including time with no work order", () => {
  const s = sample();
  const [from, to] = PM.rangeBounds("90d", DAY);
  const reps = PM.buildReports(s, { from, to, today: DAY });
  const hours = reps.find(r => r.id === "hours");
  const loose = hours.rows.filter(r => r.tech === "Jordan Ellis" && r.assetTag === "WL-1" && !r.woNumber);
  assert.equal(loose.length, 1);
  assert.equal(loose[0].hours, 0.5);
  const ty = hours.rows.filter(r => r.tech === "Ty Brooks" && r.assetTag === "WL-1");
  assert.ok(ty.some(r => r.hours === 3));
  const work = reps.find(r => r.id === "work");
  const gear = work.rows.find(r => r.title === "Gearbox rebuild");
  assert.equal(gear.downtimeHours, 22);
  assert.ok(gear.partsCost > 1500);
  assert.ok(gear.laborCost > 700);
  const assets = reps.find(r => r.id === "assets");
  assert.equal(assets.rows[0].tag, "RT-1");
  const csv = PM.toCsv(work.columns.filter(c => ["woNumber", "downtimeHours", "partsCost"].includes(c.key)), work.rows);
  assert.match(csv, /Downtime hrs/);
  assert.match(csv, /Parts cost/);
  const trimmed = PM.toCsv(hours.columns.filter(c => c.key !== "notes"), hours.rows);
  assert.doesNotMatch(trimmed.split(/\r\n/)[0], /Notes/);
});

test("drafts can wait for a machine, and dictated text is just text", () => {
  let s = sample();
  const typed = PM.saveWo(s, {
    title: "Strange noise on the press",
    description: "Press chatters on the down stroke. Dictated with Wispr.",
    status: "draft",
    source: "voice",
    voiceTranscript: "Press chatters on the down stroke.",
    assetId: ""
  });
  assert.equal(typed.ok, true, typed.message);
  assert.equal(typed.state.workOrders.find(w => w.id === typed.woId).description, "Press chatters on the down stroke. Dictated with Wispr.");
  const needsAsset = PM.setWoStatus(typed.state, { id: typed.woId, status: "open" });
  assert.equal(needsAsset.ok, false);
});

test("sheet columns match the app", () => {
  const gs = fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8");
  for (const [name, fields] of Object.entries(PM.FIELDS)) {
    const m = gs.match(new RegExp(name + ":\\s*\\[([^\\]]+)\\]"));
    assert.ok(m, name);
    const cols = m[1].split(",").map(s => s.replace(/['"\s]/g, "")).filter(Boolean);
    assert.deepEqual(cols, fields, name);
  }
  assert.match(gs, /function nextOnHand/);
  assert.match(gs, /_onHandDelta/);
  assert.match(gs, /_onHandSet/);
});

test("generate due opens only what is due and skips work already open", () => {
  const s = sample();
  const before = s.workOrders.length;
  const oil = part(s, "OIL-46").onHand;
  const made = PM.generateDue(s, { today: DAY, assignedTo: s.techs.find(t => t.name === "Ty Brooks").id });
  assert.equal(made.ok, true, made.message);
  const titles = made.state.workOrders.filter(w => !s.workOrders.some(o => o.id === w.id)).map(w => w.title).sort();
  assert.deepEqual(titles, ["500 hour compressor service", "Daily walkaround", "Monthly filter change"]);
  assert.ok(made.state.workOrders.length > before);
  assert.equal(made.state.workOrders.filter(w => w.title === "Monthly floor line service").length, 1);
  assert.ok(made.state.parts.find(p => p.sku === "OIL-46").onHand < oil);
  const again = PM.generateDue(made.state, { today: DAY });
  assert.equal(again.ok, false);
});

test("a meter PM due exactly now says due now, like a calendar PM", () => {
  let s = PM.emptyState();
  s = PM.saveAsset(s, { tag: "HM-1", name: "Hour machine", metered: "yes", meterType: "Hours", meter: 1000, status: "Running" }).state;
  s = PM.saveLevel(s, { assetId: s.assets[0].id, name: "250 hours", basis: "meter", everyMeter: 250 }).state;
  s = PM.saveTask(s, {
    assetId: s.assets[0].id, levelId: s.levels[0].id, name: "Hour service",
    lastCompletedAt: "2026-10-01", lastMeter: 750
  }).state;
  const info = PM.pmInfo(s, s.pmTasks[0], DAY);
  assert.equal(info.status, "due", info.summary);
  assert.match(info.summary, /^Due now/);
  assert.doesNotMatch(info.summary, /over/i);

  s.assets[0].meter = 1000.4;
  const barely = PM.pmInfo(s, s.pmTasks[0], DAY);
  assert.equal(barely.status, "due", barely.summary);
  assert.doesNotMatch(barely.summary, /over/i);

  s.assets[0].meter = 1001;
  const over = PM.pmInfo(s, s.pmTasks[0], DAY);
  assert.equal(over.status, "overdue", over.summary);
  assert.match(over.summary, /1 hrs over/);

  let cal = PM.emptyState();
  cal = PM.saveAsset(cal, { tag: "CA-1", name: "Calendar machine", metered: "no" }).state;
  cal = PM.saveLevel(cal, { assetId: cal.assets[0].id, name: "Weekly", basis: "calendar", everyDays: 7 }).state;
  cal = PM.saveTask(cal, {
    assetId: cal.assets[0].id, levelId: cal.levels[0].id, name: "Weekly look",
    lastCompletedAt: PM.addDays(DAY, -7)
  }).state;
  const todayDue = PM.pmInfo(cal, cal.pmTasks[0], DAY);
  assert.equal(todayDue.status, "due", todayDue.summary);
  assert.match(todayDue.summary, /Due now/);
  assert.match(todayDue.summary, /due today/);
});

test("date math accepts a full timestamp and does not throw", () => {
  assert.equal(PM.addDays("2026-11-12", 1), "2026-11-13");
  assert.equal(PM.addDays("2026-11-12T15:30:00.000Z", 3), "2026-11-15");
  assert.equal(PM.addDays("2026-11-12 15:30:00", -1), "2026-11-11");
  assert.equal(PM.daysBetween("2026-11-01T08:00:00.000Z", "2026-11-12T23:59:00.000Z"), 11);
  assert.equal(PM.daysBetween("2026-11-12", "2026-11-12T00:00:01"), 0);
  assert.equal(PM.startOfWeek("2026-11-12T15:30:00.000Z"), PM.startOfWeek("2026-11-12"));
  assert.equal(PM.addDays("not-a-date", 1), "");
  assert.equal(Number.isNaN(PM.daysBetween("nope", "2026-11-12")), true);
  assert.equal(PM.startOfWeek("not-a-date"), "");
  assert.doesNotThrow(() => PM.addDays("2026-11-12T15:30:00.000Z", 1));
  assert.doesNotThrow(() => PM.daysBetween("2026-13-40T00:00:00", "also-bad"));
  assert.doesNotThrow(() => PM.startOfWeek("2026-11-12T15:30:00.000Z"));

  let s = PM.emptyState();
  s = PM.saveAsset(s, { tag: "HM-2", name: "Hour machine", metered: "yes", meter: 500 }).state;
  s = PM.saveLevel(s, { assetId: s.assets[0].id, name: "Weekly", basis: "calendar", everyDays: 7 }).state;
  s = PM.saveTask(s, {
    assetId: s.assets[0].id, levelId: s.levels[0].id, name: "Dated",
    lastCompletedAt: "2026-11-01T18:45:00.000Z"
  }).state;
  const info = PM.pmInfo(s, s.pmTasks[0], DAY);
  assert.equal(info.status, "overdue", info.summary);
  assert.match(info.summary, /4 days over/);
  s.pmTasks[0].lastCompletedAt = "tomorrow afternoon";
  const bad = PM.pmInfo(s, s.pmTasks[0], DAY);
  assert.equal(bad.status, "due", bad.summary);
  assert.match(bad.summary, /check the last-done date/);
  assert.doesNotThrow(() => PM.dashboard(s, DAY));
});

test("big saves split, stock plans stay stable, and a missed sheet is called out", () => {
  assert.equal(PM.MAX_BATCH, 80);
  assert.equal(PM.chunkOps([]).length, 0);
  const eighty = PM.chunkOps(Array.from({ length: 80 }, (_, i) => i));
  assert.equal(eighty.length, 1);
  assert.equal(eighty[0].length, 80);
  const eightyOne = PM.chunkOps(Array.from({ length: 81 }, (_, i) => i));
  assert.deepEqual(eightyOne.map(c => c.length), [80, 1]);

  const ops = [
    { op: "set", collection: "parts", id: "p1", data: { _onHandDelta: -2 } },
    { op: "set", collection: "uses", id: "u1", data: {} },
    { op: "set", collection: "parts", id: "p1", data: { _onHandDelta: -3 } },
    { op: "set", collection: "parts", id: "p2", data: { _onHandSet: 4 } }
  ];
  const onHandOf = id => (id === "p1" ? 10 : 0);
  const plan = PM.planPartAbsolutes(ops, onHandOf);
  assert.equal(plan["0"], 8);
  assert.equal(plan["1"], undefined);
  assert.equal(plan["2"], 5);
  assert.equal(plan["3"], 4);
  assert.deepEqual(PM.planPartAbsolutes(ops, onHandOf), plan);
  assert.equal(PM.nextOnHand(999, { _onHandSet: plan["2"] }), 5);

  const offline = PM.syncNotices({ mode: "live", unreachable: true, pending: 2 });
  assert.equal(offline[0].code, "offline");
  assert.match(offline[0].text, /Couldn't reach the sheet/);
  assert.match(offline[0].text, /2 changes/);
  const auth = PM.syncNotices({ mode: "live", authProblem: true, pending: 1 });
  assert.match(auth[0].text, /Plant code was not accepted/);
  assert.match(auth[0].text, /right code/);
  const waiting = PM.syncNotices({ mode: "live", pending: 1 });
  assert.equal(waiting[0].code, "pending");
  assert.match(waiting[0].lead, /1 change waiting/);
  const rejected = PM.syncNotices({ mode: "live", rejected: "That save was not kept." });
  assert.equal(rejected[0].text, "That save was not kept.");
  assert.equal(PM.syncNotices({ mode: "sample", unreachable: true }).length, 0);
});

test("the sheet script claims a batch before stock changes and keeps the placeholder code", () => {
  const gs = fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8");
  assert.match(gs, /const ACCESS_CODE = 'CHANGE-ME'/);
  assert.ok(gs.indexOf("claim-before-apply") < gs.indexOf("apply-after-claim"));
  assert.match(gs, /function planPartAbsolutes/);
  assert.match(gs, /function allocateWoNumber/);
  assert.match(gs, /'WO-' \+ max/);
  assert.match(gs, /ops\.length > 400/);
  assert.match(gs, /at most 80 ops/);
  const applied = gs.match(/applied:\s*\[([^\]]+)\]/);
  assert.ok(applied);
  const cols = applied[1].split(",").map(s => s.replace(/['"\s]/g, "")).filter(Boolean);
  assert.deepEqual(cols.slice(0, 2), ["id", "at"]);
  assert.ok(cols.includes("body"));
});

test("floor modules: down clock, failure code, inspection, sensor, kit, report", () => {
  const day = "2026-11-12";
  const s0 = sample();
  assert.ok(s0.failureCodes.length >= 7);
  assert.ok(s0.downtimeEvents.some(e => e.assetTag === "RT-1" && e.open === "yes"));
  assert.ok(s0.reservations.some(r => r.status === "issued"));
  assert.ok(s0.inspections.length >= 1);
  const brief = PM.todayBrief(s0, day);
  assert.ok(brief.down.some(a => a.tag === "RT-1"));
  assert.ok(brief.low.some(p => p.sku === "VB-B68"));
  assert.ok(brief.pms.some(p => p.info.status === "overdue"));
  assert.ok(brief.expiring.some(w => w.tag === "RT-1"));

  let s = PM.machineDown(s0, { assetId: s0.assets.find(a => a.tag === "PS-12").id, now: day + "T09:00:00.000Z" }).state;
  assert.equal(s.assets.find(a => a.tag === "PS-12").status, "Down");
  const up = PM.machineUp(s, { assetId: s.assets.find(a => a.tag === "PS-12").id, now: day + "T10:30:00.000Z" });
  assert.equal(up.minutes, 90);
  assert.equal(up.state.assets.find(a => a.tag === "PS-12").status, "Running");

  const wo = s0.workOrders.find(w => w.title === "Hydraulic seep at the turner");
  const closed = PM.setWoStatus(s0, { id: wo.id, status: "complete", failureCode: "Air leak", rootCause: "Whip hose", date: day });
  assert.equal(closed.state.workOrders.find(w => w.id === wo.id).failureCode, "Air leak");
  const added = PM.saveFailureCode(s0, { name: "Belt" });
  assert.ok(PM.failureCodeNames(added.state).includes("Belt"));

  const ac = s0.assets.find(a => a.tag === "AC-2");
  const hot = PM.ingestSensor(s0, { assetId: ac.id, name: "Discharge pressure", type: "pressure", value: 140, date: day, source: "esp32" });
  assert.equal(hot.flag, "high");
  const hours = PM.ingestSensor(s0, { assetId: ac.id, tag: "AC-2", name: "Run hours", type: "hours", value: 19000, date: day, source: "esp32" });
  assert.equal(PM.num(hours.state.assets.find(a => a.tag === "AC-2").meter), 19000);

  const tmpl = PM.saveTemplate(PM.emptyState(), { name: "Dryer round", items: ["Drain clear", "Dew point ok"] });
  const asset = PM.saveAsset(tmpl.state, { tag: "DR-1", name: "Dryer", metered: "no" });
  const tech = PM.saveTech(asset.state, { name: "Pat", hourlyRate: 20 });
  const items = tech.state.checkItems;
  const ran = PM.submitInspection(tech.state, {
    templateId: tmpl.id, assetId: asset.assetId, techId: tech.state.techs[0].id,
    lines: [{ itemId: items[0].id, text: items[0].text, result: "fail", note: "Water in the bowl" }, { itemId: items[1].id, text: items[1].text, result: "pass" }]
  });
  assert.equal(ran.ok, true, ran.message);
  assert.equal(ran.opened.length, 1);
  assert.ok(ran.state.workOrders.some(w => /Drain clear/.test(w.title)));

  const rows = PM.repeatOffenders(s0, day, 90);
  assert.equal(rows[0].tag, "RT-1");
  const month = PM.monthlyOnePager(s0, day);
  assert.ok(month.compliance >= 0 && month.compliance <= 100);
  assert.ok(month.uptime >= 0 && month.uptime <= 100);
  assert.match(PM.reorderCsv(s0), /VB-B68/);

  const qr = QR.matrix(PM.assetLink(ac.id).replace(/^.*#/, "https://chbtools.github.io/plant-maintenance/#"));
  assert.ok(qr.length >= 21);
  assert.equal(qr[0][0], 1);
  assert.equal(qr[6][6], 1);
  assert.equal(qr[0][qr.length - 1], 1);
});

test("a general plant task does not need a machine", () => {
  const s = sample();
  const lights = s.workOrders.find(w => w.title === "Replace the light over the break room door");
  assert.ok(lights);
  assert.equal(lights.assetId, "");
  assert.equal(lights.type, "General / plant task");
  assert.equal(lights.location, "Break room");
  assert.equal(PM.isGeneral(lights), true);
  const made = PM.saveWo(s, {
    type: "General / plant task", assetId: "", location: "Dock", status: "open",
    title: "Sweep the dock", description: "Sweep the dock before the truck.", priority: "Low",
    openedDate: DAY
  });
  assert.equal(made.ok, true, made.message);
  const wo = made.state.workOrders.find(w => w.id === made.woId);
  assert.equal(wo.assetId, "");
  assert.equal(wo.assetTag, "");
  const hours = PM.saveTime(made.state, { workOrderId: wo.id, techId: s.techs[0].id, hours: 0.5, date: DAY });
  assert.equal(hours.ok, true, hours.message);
  const report = PM.buildReports(made.state, { from: "2026-11-01", to: DAY, today: DAY }).find(r => r.id === "work");
  const row = report.rows.find(r => r.title === "Sweep the dock");
  assert.equal(row.assetTag, "No machine");
  assert.match(row.area, /Dock|No machine/);
  const month = PM.monthlyOnePager(made.state, DAY);
  assert.ok(month.areas.some(a => /No machine/.test(a.area) && a.wos >= 1));
  const repair = PM.saveWo(s, { title: "Needs a machine", assetId: "", status: "open", type: "Repair" });
  assert.equal(repair.ok, false);
});

test("dictation does not rebuild a box that is focused or composing", () => {
  assert.equal(PM.dictationAllowsRender({ focused: false, composing: false }), true);
  assert.equal(PM.dictationAllowsRender({ focused: true, composing: false }), false);
  assert.equal(PM.dictationAllowsRender({ focused: false, composing: true }), false);
});

test("voice work order parses several phrasings, including a general task", () => {
  const s = sample();
  const today = "2026-11-12";
  const spoken = PM.parseVoiceWorkOrder(
    "Work order, Truss air compressor, air leak on the drain valve, priority high, assign to Randy",
    s, { today }
  );
  assert.equal(spoken.assetTag, "AC-2");
  assert.equal(spoken.type, "Repair");
  assert.equal(spoken.priority, "High");
  assert.equal(spoken.assignedName, "Randy Johnson");
  assert.match(spoken.description, /air leak on the drain valve/i);
  const saved = PM.saveWo(s, {
    type: spoken.type, assetId: spoken.assetId, location: spoken.location,
    title: spoken.title, description: spoken.description, priority: spoken.priority,
    assignedTo: spoken.assignedTo, status: "open", source: "voice",
    voiceTranscript: spoken.transcript, openedDate: today
  });
  assert.equal(saved.ok, true, saved.message);
  const wo = saved.state.workOrders.find(w => w.id === saved.woId);
  assert.equal(wo.assetTag, "AC-2");
  assert.equal(wo.priority, "High");
  assert.equal(wo.assignedName, "Randy Johnson");
  assert.equal(wo.source, "voice");

  const general = PM.parseVoiceWorkOrder(
    "General task, replace the light over the break room door, location break room",
    s, { today }
  );
  assert.equal(general.type, "General / plant task");
  assert.equal(general.assetId, "");
  assert.equal(general.assetTag, "");
  assert.match(general.location, /break room/i);
  assert.match(general.description, /replace the light/i);
  assert.equal(PM.voiceCommand("save"), "save");
  assert.equal(PM.voiceCommand("yes"), "save");
  assert.equal(PM.voiceCommand("cancel"), "cancel");
  const changed = PM.applyVoiceCommand(spoken, "change priority to low", s, { today });
  assert.equal(changed.command, "change");
  assert.equal(changed.parsed.priority, "Low");
  assert.equal(changed.parsed.assetTag, "AC-2");

  const friday = PM.parseVoiceWorkOrder("Work order, panel saw, blade is dull, due Friday", s, { today });
  assert.equal(friday.assetTag, "PS-12");
  assert.equal(friday.dueDate, "2026-11-13");
  const nameday = PM.parseVoiceWorkOrder("Work order, panel saw, Friday night shift is noisy", s, { today });
  assert.equal(nameday.dueDate, "");
  assert.match(nameday.description, /Friday night/);
  const byDay = PM.parseVoiceWorkOrder("Work order, panel saw, blade is dull, by Monday", s, { today });
  assert.equal(byDay.dueDate, "2026-11-16");
  const nowhere = PM.parseVoiceWorkOrder("Work order, hose is wet somewhere", s, { today });
  assert.equal(nowhere.assetId, "");
  assert.equal(nowhere.needsAsset, true);
  assert.equal(PM.voiceSaveFields(nowhere, "").type, "General / plant task");
  assert.equal(PM.voiceSaveFields(nowhere, s.assets.find(a => a.tag === "WL-1").id).type, "Repair");
  assert.equal(PM.voiceSaveFields(nowhere, s.assets.find(a => a.tag === "WL-1").id).assetId, s.assets.find(a => a.tag === "WL-1").id);
  const prefilled = PM.parseVoiceWorkOrder("Work order, hose is wet, due tomorrow", s, { today, assetId: s.assets.find(a => a.tag === "WL-1").id });
  assert.equal(prefilled.assetTag, "WL-1");
  assert.equal(prefilled.dueDate, "2026-11-13");
  assert.match(PM.voiceSummary(general), /no machine/i);
});

test("voice assignee, urgent, and today", () => {
  let s = sample();
  s = PM.saveTech(s, { name: "Michael Smith", hourlyRate: 30 }).state;
  s = PM.saveTech(s, { name: "Jordan Hale", hourlyRate: 30 }).state;
  const today = "2026-11-12";
  const mike = PM.parseVoiceWorkOrder("Work order, panel saw, blade is dull, assign to Mike", s, { today });
  assert.equal(mike.assignedName, "Michael Smith");
  assert.equal(mike.assigneeNote, "Assigned to Michael Smith, right?");
  assert.match(PM.voiceSummary(mike), /Assigned to Michael Smith, right\?/);
  const heard = PM.parseVoiceWorkOrder("Work order, panel saw, assign to Elana", s, { today });
  assert.equal(heard.assignedName, "Elena Vasquez");
  const tie = PM.parseVoiceWorkOrder("Work order, panel saw, assign to Jordan", s, { today });
  assert.equal(tie.assignedTo, "");
  assert.match(tie.assigneeNote, /No confident match/);
  assert.match(PM.voiceSummary(tie), /unassigned/);
  const none = PM.parseVoiceWorkOrder("Work order, panel saw, assign to Zzzzz", s, { today });
  assert.equal(none.assignedTo, "");
  const urgent = PM.parseVoiceWorkOrder("Work order, panel saw, emergency leak today", s, { today });
  assert.equal(urgent.priority, "High");
  assert.equal(urgent.dueDate, today);
  assert.match(PM.voiceSummary(urgent), /priority High/);
  assert.match(PM.voiceSummary(urgent), /location|priority High/);
  assert.match(PM.voiceSummary(urgent), /due 2026-11-12/);
  const asap = PM.parseVoiceWorkOrder("Work order, panel saw, ASAP tomorrow", s, { today });
  assert.equal(asap.priority, "High");
  assert.equal(asap.dueDate, "2026-11-13");
  const low = PM.parseVoiceWorkOrder("Work order, panel saw, priority low, location yard", s, { today });
  assert.equal(low.priority, "Low");
  assert.match(low.location, /yard/i);
  assert.match(PM.voiceSummary(low), /location yard/i);
  assert.match(PM.voiceSummary(low), /priority Low/);
  const friday = PM.parseVoiceWorkOrder("Work order, panel saw, Friday night shift", s, { today });
  assert.equal(friday.dueDate, "");
});

test("voice names, negation, and today stay literal unless they are the request", () => {
  let s = sample();
  s = PM.saveTech(s, { name: "Michael Smith", hourlyRate: 30 }).state;
  for (const name of ["William Brooks", "Edward Cole", "Jose Hale", "Sean Ellis", "Leah Vasquez", "Frederick Johnson"]) {
    s = PM.saveTech(s, { name, hourlyRate: 20 }).state;
  }
  const today = "2026-11-12";
  for (const phrase of ["will not start", "hose", "seal", "leak", "ed", "Frederick St"]) {
    const parsed = PM.parseVoiceWorkOrder("Work order, " + phrase, s, { today });
    assert.equal(parsed.assignedTo, "", phrase);
  }
  const given = PM.parseVoiceWorkOrder("Work order, panel saw, give it to Mike", s, { today });
  assert.equal(given.assignedName, "Michael Smith");
  const named = PM.parseVoiceWorkOrder("Work order, panel saw for Randy", s, { today });
  assert.equal(named.assignedName, "Randy Johnson");
  for (const phrase of ["not urgent, the saw is loud", "isn't urgent, leave it", "no rush on the saw"]) {
    const parsed = PM.parseVoiceWorkOrder("Work order, " + phrase, s, { today });
    assert.equal(parsed.priority, "Normal", phrase);
    assert.match(parsed.description, new RegExp(phrase.split(",")[0].replace("'", "'"), "i"), phrase);
  }
  const alone = PM.parseVoiceWorkOrder("today", s, { today });
  assert.equal(alone.dueDate, today);
  const urgentToday = PM.parseVoiceWorkOrder("Work order, panel saw, urgent today", s, { today });
  assert.equal(urgentToday.priority, "High");
  assert.equal(urgentToday.dueDate, today);
  assert.equal(PM.parseVoiceWorkOrder("Work order, panel saw, due today", s, { today }).dueDate, today);
  assert.equal(PM.parseVoiceWorkOrder("Work order, panel saw, by tomorrow", s, { today }).dueDate, "2026-11-13");
  assert.equal(PM.parseVoiceWorkOrder("Work order, panel saw, needs done today", s, { today }).dueDate, today);
  assert.equal(PM.parseVoiceWorkOrder("Work order, panel saw, fix the guard today", s, { today }).dueDate, today);
  for (const phrase of ["broke down today", "started today", "since today", "wait until tomorrow"]) {
    const parsed = PM.parseVoiceWorkOrder("Work order, the press " + phrase, s, { today });
    assert.equal(parsed.dueDate, "", phrase);
    assert.match(parsed.description, /today|tomorrow/, phrase);
  }
  const stillFriday = PM.parseVoiceWorkOrder("Work order, panel saw, Friday night shift", s, { today });
  assert.equal(stillFriday.dueDate, "");
  const stopped = PM.parseVoiceWorkOrder("Work order, the line stopped today", s, { today });
  assert.equal(stopped.dueDate, "");
  assert.match(stopped.description, /stopped today/i);
});

test("for a name is exact, and a bare name is only a suggestion", () => {
  let s = sample();
  s = PM.saveTech(s, { name: "Fred", hourlyRate: 20 }).state;
  s = PM.saveTech(s, { name: "Cooper", hourlyRate: 20 }).state;
  s = PM.saveTech(s, { name: "Michael Smith", hourlyRate: 30 }).state;
  const today = "2026-11-12";
  const seal = PM.parseVoiceWorkOrder("Work order, for the seal", s, { today });
  assert.equal(seal.assignedTo, "");
  assert.match(seal.description, /for the seal/i);
  const waiting = PM.parseVoiceWorkOrder("Work order, waiting for Fred's call", s, { today });
  assert.equal(waiting.assignedTo, "");
  assert.match(waiting.description, /waiting for Fred's call/i);
  const forFred = PM.parseVoiceWorkOrder("Work order, this one is for Fred", s, { today });
  assert.equal(forFred.assignedName, "Fred");
  const slip = PM.parseVoiceWorkOrder("Work order, this one is for Elana", s, { today });
  assert.equal(slip.assignedTo, "");
  assert.match(slip.description, /Elana/i);
  const fitting = PM.parseVoiceWorkOrder("Work order, the Cooper fitting is cracked", s, { today });
  assert.equal(fitting.assignedTo, "");
  assert.equal(fitting.suggestedName, "Cooper");
  assert.equal(fitting.assigneeNote, "Assign to Cooper?");
  assert.match(PM.voiceSummary(fitting), /Assign to Cooper\?/);
  assert.match(fitting.description, /Cooper fitting/i);
  const accepted = PM.acceptAssigneeSuggestion(fitting);
  assert.equal(accepted.assignedName, "Cooper");
  assert.equal(accepted.suggestedName, "");
  assert.equal(PM.applyVoiceCommand(fitting, "yes", s, { today }).command, "accept");
  const welder = PM.parseVoiceWorkOrder("Work order, Mike the welder said the guard is loose", s, { today });
  assert.equal(welder.assignedTo, "");
  assert.equal(welder.suggestedId, "");
  assert.match(welder.description, /Mike the welder/i);
});

test("a photo that does not fit is refused and a short one is kept whole", () => {
  const gs = fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8");
  assert.equal(PM.acceptPhotoData("").ok, false);
  assert.equal(PM.acceptPhotoData("data:image/jpeg;base64,abc").ok, true);
  assert.equal(PM.acceptPhotoData("x".repeat(PM.PHOTO_MAX + 1)).ok, false);
  assert.match(PM.acceptPhotoData("x".repeat(PM.PHOTO_MAX + 1)).message, /not saved/);
  assert.doesNotMatch(gs, /ANYONE_WITH_LINK/);
  assert.doesNotMatch(gs, /raw\.slice\(0,\s*45000\)/);
  assert.match(gs, /PHOTO_FOLDER_ID/);
  assert.match(gs, /photoGet/);
  assert.match(gs, /photo too large/);
  assert.match(gs, /getParents\(\)/);
});

test("meter posts reject junk and a lower reading, and skip a machine with no meter", () => {
  let s = PM.emptyState();
  s = PM.saveAsset(s, { tag: "AC-9", name: "Compressor", metered: "yes", meter: 100 }).state;
  s = PM.saveAsset(s, { tag: "PS-9", name: "Saw", metered: "no" }).state;
  const low = PM.ingestSensor(s, { tag: "AC-9", name: "Run hours", type: "hours", value: 90 });
  assert.equal(low.ok, false);
  assert.match(low.message, /lower/);
  assert.equal(PM.num(s.assets.find(a => a.tag === "AC-9").meter), 100);
  for (const value of [0, -5, "nope"]) {
    const bad = PM.ingestSensor(s, { tag: "AC-9", name: "Run hours", type: "hours", value });
    assert.equal(bad.ok, false, String(value));
  }
  const saw = PM.ingestSensor(s, { tag: "PS-9", name: "Run hours", type: "hours", value: 10 });
  assert.equal(saw.ok, true, saw.message);
  assert.equal(saw.state.assets.find(a => a.tag === "PS-9").meter, "");
  assert.equal(saw.state.readings.length, 0);
  const up = PM.ingestSensor(s, { tag: "AC-9", name: "Run hours", type: "hours", value: 110 });
  assert.equal(up.ok, true, up.message);
  assert.equal(PM.num(up.state.assets.find(a => a.tag === "AC-9").meter), 110);
  const gs = fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8");
  assert.match(gs, /ingestSensorLocked/);
  assert.match(gs, /LockService\.getScriptLock/);
  assert.match(gs, /meter went backwards/);
});

test("out-of-range mail waits for the window", () => {
  const now = Date.parse("2026-11-12T15:00:00.000Z");
  assert.equal(PM.sensorAlertDue(0, now, 60), true);
  assert.equal(PM.sensorAlertDue(now - 30 * 60000, now, 60), false);
  assert.equal(PM.sensorAlertDue(now - 60 * 60000, now, 60), true);
  const gs = fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8");
  assert.match(gs, /SENSOR_ALERT_MINUTES/);
  assert.match(gs, /SENSOR_SAMPLE_MINUTES/);
  assert.match(gs, /SENSOR_REMIND_HOURS/);
  assert.match(gs, /back in range/);
  assert.doesNotMatch(gs, /p\.subject/);
  assert.doesNotMatch(gs, /p\.body/);
  const t0 = Date.parse("2026-11-12T12:00:00.000Z");
  assert.equal(PM.sensorShouldStore(null, { value: 100, flag: "ok", now: t0 }, 15).store, true);
  const steady = PM.sensorShouldStore({ value: 100, flag: "ok", at: t0 }, { value: 100.1, flag: "ok", now: t0 + 5 * 60000 }, 15);
  assert.equal(steady.store, false);
  assert.equal(PM.sensorShouldStore({ value: 100, flag: "ok", at: t0 }, { value: 110, flag: "ok", now: t0 + 60000 }, 15).reason, "change");
  assert.equal(PM.sensorShouldStore({ value: 100, flag: "ok", at: t0 }, { value: 140, flag: "high", now: t0 + 60000 }, 15).reason, "out");
  assert.equal(PM.sensorShouldStore({ value: 100, flag: "ok", at: t0 }, { value: 100, flag: "ok", now: t0 + 15 * 60000 }, 15).reason, "interval");
  const out = PM.sensorAlertPlan({ flag: "ok", lastAlert: 0 }, { flag: "high" }, t0, 4);
  assert.equal(out.send, "out");
  const stuck = PM.sensorAlertPlan(out.state, { flag: "high" }, t0 + 60 * 60000, 4);
  assert.equal(stuck.send, "");
  const remind = PM.sensorAlertPlan(out.state, { flag: "high" }, t0 + 4 * 3600000, 4);
  assert.equal(remind.send, "remind");
  const back = PM.sensorAlertPlan(remind.state, { flag: "ok" }, t0 + 5 * 3600000, 4);
  assert.equal(back.send, "back");
  assert.equal(PM.sensorAlertPlan(back.state, { flag: "ok" }, t0 + 6 * 3600000, 4).send, "");
});

test("downtime counts an open clock and adds closed events to work-order hours", () => {
  let s = PM.emptyState();
  s = PM.saveAsset(s, { tag: "RT-9", name: "Gantry", metered: "no" }).state;
  const asset = s.assets[0];
  const down = PM.machineDown(s, { assetId: asset.id, now: "2026-11-12T14:00:00.000Z" });
  s = down.state;
  s.assets[0].status = "Running";
  assert.equal(PM.downAction(s.assets[0], s.downtimeEvents), "up");
  const openMins = PM.downtimeMinutes(s, asset.id, "2026-11-12", "2026-11-12", "2026-11-12T15:00:00.000Z");
  assert.equal(openMins, 60);
  const up = PM.machineUp(s, { assetId: asset.id, now: "2026-11-12T15:00:00.000Z" });
  s = up.state;
  const wo = PM.saveWo(s, { title: "Trip", assetId: asset.id, status: "open", downtimeHours: 2, openedDate: "2026-11-12" });
  s = wo.state;
  const rows = PM.repeatOffenders(s, "2026-11-12", 30);
  const row = rows.find(r => r.tag === "RT-9");
  assert.equal(row.downtime, 3);
  const month = PM.monthlyOnePager(s, "2026-11-12");
  assert.ok(month.uptime < 100);
  assert.ok(month.uptime > 90);
});

test("csv and the sheet escape formula text", () => {
  const csv = PM.toCsv([{ key: "title", label: "Title" }], [
    { title: "=cmd|calc" },
    { title: "+1+1" },
    { title: "@sum" },
    { title: "ok" }
  ]);
  assert.match(csv, /'=cmd\|calc/);
  assert.match(csv, /'\+1\+1/);
  assert.match(csv, /'@sum/);
  assert.match(csv, /(?<![+'"])ok/);
  assert.doesNotMatch(csv, /(^|\n)=cmd/);
  const nums = PM.toCsv([{ key: "n", label: "N", kind: "num" }, { key: "title", label: "Title" }], [{ n: -1, title: "ok" }]);
  assert.match(nums, /(^|\r\n)-1,ok/);
  assert.doesNotMatch(nums, /'-1/);
  const gs = fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8");
  assert.match(gs, /function sheetSafe/);
  assert.match(gs, /sheetSafe\(text/);
});

test("cancelling a PM work order cancels the kit reservation", () => {
  const s = sample();
  const task = s.pmTasks.find(t => t.name === "500 hour compressor service");
  const made = PM.generatePm(s, { taskId: task.id, today: DAY, now: DAY + "T16:00:00.000Z" });
  assert.equal(made.ok, true, made.message);
  assert.match(made.message, /Kit reserved/);
  const woId = made.woId;
  assert.ok(made.state.reservations.some(r => r.workOrderId === woId && r.status === "issued"));
  const cancelled = PM.setWoStatus(made.state, { id: woId, status: "cancelled" });
  assert.equal(cancelled.ok, true, cancelled.message);
  const left = cancelled.state.reservations.filter(r => r.workOrderId === woId);
  assert.ok(left.length >= 1);
  assert.ok(left.every(r => r.status === "cancelled"));
  let bare = PM.emptyState();
  bare = PM.saveAsset(bare, { tag: "ZZ-1", name: "Bench", metered: "no" }).state;
  bare = PM.saveLevel(bare, { assetId: bare.assets[0].id, name: "Weekly", basis: "calendar", everyDays: 7 }).state;
  bare = PM.saveTask(bare, { assetId: bare.assets[0].id, levelId: bare.levels[0].id, name: "Sweep", parts: [] }).state;
  const none = PM.generatePm(bare, { taskId: bare.pmTasks[0].id, today: DAY });
  assert.equal(none.ok, true, none.message);
  assert.doesNotMatch(none.message, /Kit reserved/);
  assert.match(none.message, /No parts/);
});

test("labels decode with a real QR reader", () => {
  const jsQR = require("jsqr");
  function decode(text) {
    const m = QR.matrix(text);
    const scale = 4;
    const quiet = 4;
    const n = m.length + quiet * 2;
    const w = n * scale;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < m.length && my < m.length && m[my][mx];
      const i = (y * w + x) * 4;
      const v = dark ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
    const hit = jsQR(data, w, w);
    return hit && hit.data;
  }
  const link = "https://chbtools.github.io/plant-maintenance/#asset/asset1234";
  assert.equal(decode(link), link);
  assert.equal(decode("WL-1"), "WL-1");
  assert.equal(decode("https://example.com/plant/" + "a".repeat(40)), "https://example.com/plant/" + "a".repeat(40));
});
