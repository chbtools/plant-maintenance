const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PM = require("../js/logic.js");
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
