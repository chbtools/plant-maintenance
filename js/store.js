/* Local sample data, or the shared Google Sheet. */
(function () {
  const PM = globalThis.PM;
  const SAMPLE_KEY = "pm-sample-v1";
  const CACHE_KEY = "pm-cache-v1";
  const QUEUE_KEY = "pm-queue-v1";
  const CODE_KEY = "pm-code";

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
  function unpack(j) {
    const state = PM.emptyState();
    for (const name of Object.keys(PM.FIELDS)) state[name] = Array.isArray(j[name]) ? j[name] : [];
    return state;
  }

  const Store = {
    mode: "sample",
    pending: 0,
    load() {
      const live = !!scriptUrl();
      this.mode = live ? "live" : "sample";
      if (!live) {
        const saved = readJson(SAMPLE_KEY);
        this.pending = 0;
        return { state: valid(saved) ? saved : freshSample(), mode: "sample", needsCode: false };
      }
      const cache = readJson(CACHE_KEY);
      const q = readQueue();
      this.pending = q.length;
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
      const item = { batchId: PM.uid(), ops };
      try {
        await call("batch", { batchId: item.batchId, ops });
        return { ok: true, queued: false };
      } catch (e) {
        if (e.code === "unauthorized") return { ok: false, unauthorized: true, queued: false };
        const q = readQueue();
        q.push(item);
        try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (err) {}
        this.pending = q.length;
        return { ok: false, queued: true };
      }
    },
    async flush() {
      if (!scriptUrl()) return { ok: true };
      let q = readQueue();
      while (q.length) {
        try { await call("batch", { batchId: q[0].batchId, ops: q[0].ops }); }
        catch (e) {
          this.pending = q.length;
          if (e.code === "unauthorized") return { ok: false, unauthorized: true };
          return { ok: false, offline: true };
        }
        q.shift();
        try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (err) {}
      }
      this.pending = 0;
      return { ok: true };
    },
    async refresh() {
      if (!scriptUrl()) return { ok: true, state: valid(readJson(SAMPLE_KEY)) ? readJson(SAMPLE_KEY) : freshSample() };
      const flushed = await this.flush();
      if (!flushed.ok) return flushed;
      try {
        const j = await call("list");
        const state = unpack(j);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ state, savedAt: new Date().toISOString() })); } catch (e) {}
        return { ok: true, state };
      } catch (e) {
        if (e.code === "unauthorized") return { ok: false, unauthorized: true };
        return { ok: false, offline: true };
      }
    }
  };
  globalThis.Store = Store;
})();
