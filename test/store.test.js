const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const mem = {};
globalThis.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem(k, v) { mem[k] = String(v); },
  removeItem(k) { delete mem[k]; },
  clear() { for (const k of Object.keys(mem)) delete mem[k]; }
};
globalThis.PLANT_SCRIPT_URL = "https://script.google.com/macros/s/test/exec";

const PM = require("../js/logic.js");
require("../js/sample.js");
require("../js/store.js");

const Store = globalThis.Store;
const QUEUE = "pm-queue-v1";
let calls;
let handler;

globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  calls.push(body);
  const result = await handler(body);
  return { json: async () => result };
};

function reset() {
  localStorage.clear();
  calls = [];
  Store.pending = 0;
  Store.rejected = "";
  Store.unreachable = false;
  Store.authProblem = false;
  Store.mode = "live";
  handler = async () => ({ ok: true });
}
function queue() {
  return JSON.parse(localStorage.getItem(QUEUE) || "[]");
}
function op(id) {
  return { op: "set", collection: "techs", id, data: { name: id } };
}
function blankList() {
  const body = { ok: true };
  for (const name of Object.keys(PM.FIELDS)) body[name] = [];
  return body;
}

describe("save queue", { concurrency: false }, () => {
  test("a rejected save is not retried and does not block the next one", async () => {
    reset();
    let n = 0;
    handler = async () => {
      n += 1;
      if (n === 1) return { ok: false, error: "bad id" };
      return { ok: true };
    };
    const first = await Store.persist(PM.emptyState(), [op("tech0001")]);
    assert.equal(first.ok, false);
    assert.equal(first.rejected, true);
    assert.equal(first.queued, false);
    assert.equal(first.sent, 0);
    assert.equal(Store.pending, 0);
    assert.match(first.message, /not be retried/);
    assert.match(Store.rejected, /not be retried/);
    const second = await Store.persist(PM.emptyState(), [op("tech0002")]);
    assert.equal(second.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(queue().length, 0);
  });

  test("a permanent failure is dropped so a later save can sync", async () => {
    reset();
    localStorage.setItem(QUEUE, JSON.stringify([
      { batchId: "batch-bad01", ops: [op("bad!")] },
      { batchId: "batch-good1", ops: [op("techok01")] }
    ]));
    handler = async (body) => {
      if (body.batchId === "batch-bad01") return { ok: false, error: "bad id" };
      return { ok: true };
    };
    const flushed = await Store.flush();
    assert.equal(flushed.ok, true);
    assert.equal(flushed.dropped, true);
    assert.equal(Store.pending, 0);
    assert.deepEqual(calls.map(c => c.batchId), ["batch-bad01", "batch-good1"]);
    assert.match(Store.rejected, /not be retried/);
  });

  test("a dropped connection keeps the save and retries that same batch first", async () => {
    reset();
    let down = true;
    handler = async () => {
      if (down) throw new Error("offline");
      return { ok: true };
    };
    const saved = await Store.persist(PM.emptyState(), [op("asset0001")]);
    assert.equal(saved.ok, false);
    assert.equal(saved.queued, true);
    assert.equal(Store.pending, 1);
    assert.equal(Store.unreachable, true);
    const id = queue()[0].batchId;
    assert.equal(calls.length, 1);
    down = false;
    const again = await Store.flush();
    assert.equal(again.ok, true);
    assert.equal(Store.pending, 0);
    assert.equal(Store.unreachable, false);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].batchId, id);
  });

  test("a save the sheet cannot answer stays in front of later saves", async () => {
    reset();
    localStorage.setItem(QUEUE, JSON.stringify([
      { batchId: "firstbatch", ops: [op("tech0001")] },
      { batchId: "laterbatch", ops: [op("tech0002")] }
    ]));
    handler = async () => { throw new Error("down"); };
    const flushed = await Store.flush();
    assert.equal(flushed.offline, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].batchId, "firstbatch");
    assert.deepEqual(queue().map(item => item.batchId), ["firstbatch", "laterbatch"]);
  });

  test("a wrong plant code keeps the save and sends it once the code is right", async () => {
    reset();
    handler = async (body) => {
      if (body.code !== "lillington-shop") return { ok: false, error: "unauthorized" };
      return { ok: true };
    };
    Store.saveCode("nope");
    const saved = await Store.persist(PM.emptyState(), [op("tech0001")]);
    assert.equal(saved.unauthorized, true);
    assert.equal(saved.queued, true);
    assert.match(saved.message, /right code/);
    assert.equal(Store.authProblem, true);
    const id = queue()[0].batchId;
    const blocked = await Store.flush();
    assert.equal(blocked.unauthorized, true);
    assert.equal(queue().length, 1);
    assert.equal(queue()[0].batchId, id);
    Store.saveCode("lillington-shop");
    const ok = await Store.flush();
    assert.equal(ok.ok, true);
    assert.equal(Store.pending, 0);
    const sent = calls.filter(c => c.batchId === id);
    assert.equal(sent.length, 3);
    assert.equal(sent[0].batchId, sent[2].batchId);
    assert.equal(sent[2].code, "lillington-shop");
    assert.deepEqual(sent[2].ops, sent[0].ops);
  });

  test("a large save is split into batches the old script will accept", async () => {
    reset();
    handler = async (body) => {
      assert.ok(body.ops.length <= PM.MAX_BATCH);
      return { ok: true };
    };
    const ops = [];
    for (let i = 0; i < 81; i++) ops.push(op("t" + String(i).padStart(6, "0")));
    const saved = await Store.persist(PM.emptyState(), ops);
    assert.equal(saved.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].ops.length, 80);
    assert.equal(calls[1].ops.length, 1);
    assert.notEqual(calls[0].batchId, calls[1].batchId);
  });

  test("a wrong code queues every piece of a large save and stops asking", async () => {
    reset();
    Store.saveCode("");
    handler = async () => ({ ok: false, error: "unauthorized" });
    const ops = [];
    for (let i = 0; i < 81; i++) ops.push(op("t" + String(i).padStart(6, "0")));
    const saved = await Store.persist(PM.emptyState(), ops);
    assert.equal(saved.unauthorized, true);
    assert.equal(saved.queued, true);
    assert.equal(queue().length, 2);
    assert.equal(calls.length, 1);
    assert.ok(queue().every(item => item.ops.length <= PM.MAX_BATCH));
  });

  test("an oversized queued save is split after the sheet refuses it", async () => {
    reset();
    const ops = [];
    for (let i = 0; i < 81; i++) ops.push(op("t" + String(i).padStart(6, "0")));
    localStorage.setItem(QUEUE, JSON.stringify([{ batchId: "bigbatch01", ops }]));
    handler = async (body) => {
      if (body.ops.length > 80) return { ok: false, error: "bad batch" };
      return { ok: true };
    };
    const flushed = await Store.flush();
    assert.equal(flushed.ok, true);
    assert.equal(Store.pending, 0);
    assert.equal(calls[0].batchId, "bigbatch01");
    assert.equal(calls[0].ops.length, 81);
    const rest = calls.slice(1);
    assert.ok(rest.every(c => c.ops.length <= 80));
    assert.equal(rest.reduce((n, c) => n + c.ops.length, 0), 81);
    assert.ok(rest.every(c => c.batchId !== "bigbatch01"));
  });

  test("refresh remembers when the sheet can't be reached, and can hold a rejection notice", async () => {
    reset();
    handler = async () => { throw new Error("down"); };
    const failed = await Store.refresh();
    assert.equal(failed.offline, true);
    assert.equal(Store.unreachable, true);
    Store.rejected = "The sheet rejected a save.";
    localStorage.setItem("pm-notice-v1", Store.rejected);
    handler = async (body) => (body.action === "list" ? blankList() : { ok: true });
    const held = await Store.refresh({ keepNotice: true });
    assert.equal(held.ok, true);
    assert.equal(Store.unreachable, false);
    assert.match(Store.rejected, /rejected/);
    const cleared = await Store.refresh();
    assert.equal(cleared.ok, true);
    assert.equal(Store.rejected, "");
    assert.equal(localStorage.getItem("pm-notice-v1"), null);
  });
});
