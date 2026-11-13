/* Local sample data, or the shared Google Sheet.
   A save that the sheet refuses (bad id, too big, not valid) is not retried.
   A dropped connection or a wrong plant code stays queued and is sent later.
   Big saves are split into MAX_BATCH pieces so an older script still accepts them. */
(function () {
  const PM = globalThis.PM;
  const SAMPLE_KEY = "pm-sample-v1";
  const CACHE_KEY = "pm-cache-v1";
  const QUEUE_KEY = "pm-queue-v1";
  const CODE_KEY = "pm-code";
  const NOTICE_KEY = "pm-notice-v1";
  const PERMANENT = {
    "bad batch": "The sheet rejected a save because it was too big or not valid. That save was not kept, and it will not be retried.",
    "bad id": "The sheet rejected a save because an id was not valid. That save was not kept, and it will not be retried.",
    "unknown collection": "The sheet rejected a save it did not recognize. That save was not kept, and it will not be retried.",
    "bad op": "The sheet rejected a save it could not apply. That save was not kept, and it will not be retried.",
    "bad request": "The sheet could not read that save. It was not kept, and it will not be retried."
  };

  function scriptUrl() {
    const url = String((globalThis.PLANT_SCRIPT_URL || "")).trim();
    if (!url || /^PASTE/i.test(url)) return "";
    return url;
  }
  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch (e) { return null; }
  }
  function valid(state) {
    return !!(state && Array.isArray(state.assets) && Array.isArray(state.workOrders) && Array.isArray(state.parts) && Array.isArray(state.techs) && Array.isArray(state.pmTasks));
  }
  function freshSample() { return PM.buildSample(PM.today()); }
  function readQueue() { const q = readJson(QUEUE_KEY); return Array.isArray(q) ? q : []; }
  function code() { try { return localStorage.getItem(CODE_KEY) || ""; } catch (e) { return ""; } }
  function isPermanent(e) {
    return !!(e && e.code === "server" && Object.prototype.hasOwnProperty.call(PERMANENT, String(e.message || "")));
  }
  function rejectText(e) {
    const msg = String((e && e.message) || "");
    return PERMANENT[msg] || ("The sheet rejected a save (" + (msg || "error") + "). It was not kept, and it will not be retried.");
  }
  function writeQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {}
    Store.pending = q.length;
  }
  function writeNotice(text) {
    Store.rejected = text || "";
    try {
      if (text) localStorage.setItem(NOTICE_KEY, text);
      else localStorage.removeItem(NOTICE_KEY);
    } catch (e) {}
  }

  async function call(action, payload) {
    const url = scriptUrl();
    if (!url) throw { code: "unconfigured" };
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ action, code: code() }, payload || {}))
      });
    } catch (e) { throw { code: "unavailable" }; }
    let j;
    try { j = await res.json(); } catch (e) { throw { code: "unavailable" }; }
    if (!j.ok) {
      if (j.error === "unauthorized") throw { code: "unauthorized" };
      throw { code: "server", message: j.error || "The sheet rejected that save." };
    }
    return j;
  }
  async function deliver(item) {
    await call("batch", { batchId: item.batchId, ops: item.ops });
  }
  function unpack(j) {
    const state = PM.emptyState();
    for (const name of Object.keys(PM.FIELDS)) state[name] = Array.isArray(j[name]) ? j[name] : [];
    return state;
  }

  const Store = {
    mode: "sample",
    pending: 0,
    unreachable: false,
    rejected: "",
    authProblem: false,
    load() {
      const live = !!scriptUrl();
      this.mode = live ? "live" : "sample";
      this.unreachable = false;
      this.authProblem = false;
      try { this.rejected = localStorage.getItem(NOTICE_KEY) || ""; } catch (e) { this.rejected = ""; }
      if (!live) {
        const saved = readJson(SAMPLE_KEY);
        this.pending = 0;
        return { state: valid(saved) ? saved : freshSample(), mode: "sample", needsCode: false };
      }
      const cache = readJson(CACHE_KEY);
      const q = readQueue();
      this.pending = q.length;
      this.authProblem = !code() && q.length > 0;
      return {
        state: cache && valid(cache.state) ? cache.state : PM.emptyState(),
        mode: "live",
        needsCode: !code(),
        fromCache: !!(cache && valid(cache.state)),
        cacheAt: cache && cache.savedAt,
        pending: q.length
      };
    },
    saveCode(v) { try { localStorage.setItem(CODE_KEY, v || ""); } catch (e) {} },
    remember(state) {
      const key = scriptUrl() ? CACHE_KEY : SAMPLE_KEY;
      const payload = scriptUrl() ? { state, savedAt: new Date().toISOString() } : state;
      try { localStorage.setItem(key, JSON.stringify(payload)); } catch (e) {}
    },
    resetSample() {
      try { localStorage.removeItem(SAMPLE_KEY); } catch (e) {}
      this.mode = "sample";
      return freshSample();
    },
    async persist(state, ops) {
      if (!scriptUrl()) {
        try { localStorage.setItem(SAMPLE_KEY, JSON.stringify(state)); } catch (e) {}
        return { ok: true, queued: false };
      }
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ state, savedAt: new Date().toISOString() })); } catch (e) {}
      if (!ops || !ops.length) return { ok: true, queued: false };
      const items = PM.chunkOps(ops).map(part => ({ batchId: PM.uid(), ops: part }));
      const queued = [];
      let rejected = "";
      let unauthorized = false;
      let sent = 0;
      for (let i = 0; i < items.length; i++) {
        try {
          await deliver(items[i]);
          sent++;
        } catch (e) {
          if (e && e.code === "unauthorized") {
            unauthorized = true;
            this.authProblem = true;
            this.unreachable = false;
            for (let j = i; j < items.length; j++) queued.push(items[j]);
            break;
          }
          if (isPermanent(e)) {
            rejected = rejectText(e);
            writeNotice(rejected);
            continue;
          }
          this.unreachable = true;
          for (let j = i; j < items.length; j++) queued.push(items[j]);
          break;
        }
      }
      if (queued.length) {
        const q = readQueue();
        for (let i = 0; i < queued.length; i++) q.push(queued[i]);
        writeQueue(q);
      }
      if (unauthorized) {
        return {
          ok: false,
          unauthorized: true,
          queued: true,
          message: "That plant code was not accepted. This change is saved on this phone and will sync after you enter the right code."
        };
      }
      if (rejected) return { ok: false, rejected: true, queued: queued.length > 0, sent, message: rejected };
      if (queued.length) return { ok: false, queued: true };
      this.unreachable = false;
      this.authProblem = false;
      return { ok: true, queued: false };
    },
    async flush() {
      if (!scriptUrl()) return { ok: true };
      let q = readQueue();
      let dropped = false;
      while (q.length) {
        const item = q[0];
        try {
          await deliver(item);
        } catch (e) {
          // "bad batch" is returned before the script writes anything. An old queue
          // entry that is over the limit can be split safely and sent in pieces.
          if (e && e.code === "server" && e.message === "bad batch" && item.ops && item.ops.length > PM.MAX_BATCH) {
            const parts = PM.chunkOps(item.ops).map(ops => ({ batchId: PM.uid(), ops }));
            if (parts.length > 1 && parts.every(part => part.ops.length <= PM.MAX_BATCH)) {
              q = parts.concat(q.slice(1));
              writeQueue(q);
              continue;
            }
          }
          if (isPermanent(e)) {
            q.shift();
            dropped = true;
            writeNotice(rejectText(e));
            writeQueue(q);
            continue;
          }
          writeQueue(q);
          if (e && e.code === "unauthorized") {
            this.authProblem = true;
            this.unreachable = false;
            return { ok: false, unauthorized: true, dropped };
          }
          this.unreachable = true;
          return { ok: false, offline: true, dropped };
        }
        q.shift();
        writeQueue(q);
      }
      this.pending = 0;
      this.authProblem = false;
      this.unreachable = false;
      return { ok: true, dropped };
    },
    async refresh(opt) {
      if (!scriptUrl()) return { ok: true, state: valid(readJson(SAMPLE_KEY)) ? readJson(SAMPLE_KEY) : freshSample() };
      const flushed = await this.flush();
      if (!flushed.ok) return flushed;
      try {
        const j = await call("list");
        const state = unpack(j);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ state, savedAt: new Date().toISOString() })); } catch (e) {}
        this.unreachable = false;
        this.authProblem = false;
        if (!(opt && opt.keepNotice) && !flushed.dropped) writeNotice("");
        return { ok: true, state };
      } catch (e) {
        if (e && e.code === "unauthorized") {
          this.authProblem = true;
          this.unreachable = false;
          return { ok: false, unauthorized: true };
        }
        this.unreachable = true;
        return { ok: false, offline: true };
      }
    }
  };
  globalThis.Store = Store;
})();
