/* Plant Maintenance UI. Phones and shop computers share this page.
   Every text box stays a normal field so Wispr Flow, Gboard, and the keyboard
   can type into it. A small Mic button uses this browser's speech recognition
   and writes into that same box. Search lists update in place so the box is
   not rebuilt while you are still typing. */
(function () {
  const PM = window.PM;
  const view = document.getElementById("view");
  let state = PM.emptyState();
  let stopMic = function () {};
  let composing = false;
  document.addEventListener("compositionstart", () => { composing = true; });
  document.addEventListener("compositionend", () => { composing = false; });
  const ui = {
    me: "",
    workView: "open",
    workQ: "",
    assetQ: "",
    partQ: "",
    partView: "all",
    report: "work",
    range: "90d",
    from: "",
    to: "",
    hidden: {}
  };
  try { ui.me = localStorage.getItem("pm-me") || ""; } catch (e) {}
  try { ui.report = localStorage.getItem("pm-report") || "work"; } catch (e) {}
  try { ui.range = localStorage.getItem("pm-range") || "90d"; } catch (e) {}
  try { ui.hidden = JSON.parse(localStorage.getItem("pm-hidden") || "{}") || {}; } catch (e) {}

  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money0 = n => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.round(n || 0));
  const byId = id => document.getElementById(id);
  const val = id => (byId(id) && byId(id).value) || "";
  const initials = n => String(n || "?").trim().split(/\s+/).map(w => w[0] || "").slice(0, 2).join("").toUpperCase() || "?";
  function saveUi() {
    try {
      localStorage.setItem("pm-me", ui.me || "");
      localStorage.setItem("pm-report", ui.report);
      localStorage.setItem("pm-range", ui.range);
      localStorage.setItem("pm-hidden", JSON.stringify(ui.hidden));
    } catch (e) {}
  }
  function meTech() { return ui.me && PM.techById(state, ui.me); }
  function meName() { const t = meTech(); return t ? t.name : ""; }
  function toast(msg) {
    const root = document.getElementById("toastRoot");
    root.innerHTML = "";
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 3200);
  }
  function sortedAssets() {
    return state.assets.slice().sort((a, b) => String(a.tag).localeCompare(String(b.tag), undefined, { numeric: true }));
  }
  function sortedTechs() {
    return state.techs.filter(t => t.active !== "no").slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  function assetChoices(blank) {
    return [["" , blank || "Choose equipment…"]].concat(sortedAssets().map(a => [a.id, a.tag + " — " + a.name]));
  }
  function techChoices(blank) {
    return [["" , blank || "Unassigned"]].concat(sortedTechs().map(t => [t.id, t.name]));
  }
  function sel(id, value, options, attrs) {
    return `<select id="${esc(id)}" ${attrs || ""}>${options.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(value == null ? "" : value) ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select>`;
  }
  function pill(level, text) { return `<span class="pill ${level}">${esc(text)}</span>`; }
  function assetPill(a) {
    const s = (a && a.status) || "Running";
    const level = s === "Running" ? "ok" : s === "Down" ? "bad" : "idle";
    return pill(level, s);
  }
  function statusPill(status) {
    const level = status === "complete" ? "ok" : status === "cancelled" ? "idle" : status === "waiting_parts" || status === "waiting_approval" || status === "on_hold" ? "warn" : status === "draft" ? "info" : status === "in_progress" ? "ok" : "warn";
    return pill(level, PM.STATUS_LABEL[status] || status);
  }
  function pmPill(info) {
    const level = info.status === "overdue" ? "bad" : info.status === "due" || info.status === "soon" ? "warn" : info.status === "ok" ? "ok" : "idle";
    const label = info.status === "overdue" ? "Overdue" : info.status === "due" ? "Due now" : info.status === "soon" ? "Due soon" : info.status === "ok" ? "OK" : "Paused";
    return pill(level, label);
  }
  function who(wo) {
    const n = PM.whoName(state, wo);
    return n ? `<span class="who"><span class="av">${esc(initials(n))}</span>${esc(n)}</span>` : `<span class="who">Unassigned</span>`;
  }

  function closeSheet() {
    stopMic();
    stopMic = function () {};
    if (typeof stopVoiceSession === "function") stopVoiceSession();
    document.getElementById("sheetRoot").innerHTML = "";
    document.body.style.overflow = "";
  }
  function openSheet(title, body, foot, mount) {
    closeSheet();
    document.getElementById("sheetRoot").innerHTML = `<div class="scrim" id="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle"><div class="sheet-h"><h2 id="sheetTitle">${esc(title)}</h2><button class="x" type="button" data-close aria-label="Close">×</button></div><div class="sheet-b">${body}</div>${foot ? `<div class="sheet-f">${foot}</div>` : ""}</div></div>`;
    const sc = document.getElementById("scrim");
    sc.addEventListener("mousedown", e => { if (e.target === sc) closeSheet(); });
    sc.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
    document.body.style.overflow = "hidden";
    if (mount) mount(sc);
    attachMics(sc);
  }
  function showErr(msg) {
    const el = byId("formErr");
    if (el) el.textContent = msg || "";
    else if (msg) toast(msg);
  }
  function focusField(id) {
    const el = byId(id);
    if (!el) return;
    if (composing && document.activeElement === el) return;
    el.focus();
    if (composing || document.activeElement !== el) return;
    try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) {}
  }
  function speechOk() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
  function voiceWoButton(assetId) {
    if (!speechOk()) return "";
    if (window.Floor && Floor.shown && !Floor.shown("voicewo")) return "";
    return `<button class="btn primary voice-wo" type="button" data-action="voice-wo" data-id="${esc(assetId || "")}">Voice work order</button>`;
  }
  /* One mic on every text box. Hidden when this browser has no speech recognition.
     Writing the words does not move the caret during keyboard composition. */
  function attachMics(root) {
    if (!root) return;
    root.querySelectorAll("input, textarea").forEach(field => {
      if (field.dataset.micAttached) return;
      const type = (field.getAttribute("type") || "text").toLowerCase();
      if (type === "password" || field.dataset.secret === "1" || field.id === "plantCode") return;
      if (field.tagName === "INPUT" && !["text", "search", "email", "tel", "number"].includes(type)) return;
      field.dataset.micAttached = "1";
      const codeLike = field.dataset.code === "1";
      if (codeLike) {
        field.setAttribute("autocorrect", "off");
        field.setAttribute("autocapitalize", "off");
        field.setAttribute("spellcheck", "false");
      } else {
        if (!field.getAttribute("autocomplete") || field.getAttribute("autocomplete") === "off") field.setAttribute("autocomplete", "on");
        field.setAttribute("autocorrect", "on");
        if (!field.getAttribute("autocapitalize")) field.setAttribute("autocapitalize", "sentences");
        field.setAttribute("spellcheck", "true");
      }
      if (!speechOk()) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn small mic-btn";
      btn.textContent = "Mic";
      btn.setAttribute("aria-label", "Dictate into this field");
      const wrap = document.createElement("div");
      wrap.className = "mic-wrap";
      if (field.classList.contains("grow")) { wrap.classList.add("grow"); field.classList.remove("grow"); }
      field.parentNode.insertBefore(wrap, field);
      wrap.appendChild(field);
      wrap.appendChild(btn);
      let rec = null, prefix = "";
      const stop = () => { if (rec) { try { rec.onend = null; rec.stop(); } catch (e) {} rec = null; } btn.setAttribute("aria-pressed", "false"); btn.textContent = "Mic"; };
      btn.addEventListener("click", () => {
        if (rec) { stop(); return; }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        try { rec = new SR(); } catch (e) { toast("The mic isn't available in this browser. Type in the box, or dictate with Wispr Flow."); return; }
        stopMic();
        stopMic = stop;
        prefix = field.value.trim() ? field.value.replace(/\s+$/, "") + " " : "";
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        rec.onresult = ev => {
          if (composing) return;
          let said = "";
          for (let i = 0; i < ev.results.length; i++) said += ev.results[i][0].transcript;
          if (type === "number") said = said.replace(/[^\d.]/g, "");
          field.value = prefix + said;
          field.dataset.mic = "1";
          field.dispatchEvent(new Event("input", { bubbles: true }));
        };
        rec.onerror = () => { stop(); toast("The mic isn't available in this browser. Type in the box, or dictate with Wispr Flow."); };
        rec.onend = () => { rec = null; btn.setAttribute("aria-pressed", "false"); btn.textContent = "Mic"; };
        try { rec.start(); btn.setAttribute("aria-pressed", "true"); btn.textContent = "Stop"; }
        catch (e) { rec = null; toast("The mic isn't available in this browser. Type in the box, or dictate with Wispr Flow."); }
      });
    });
  }
  async function commit(result, opt) {
    opt = opt || {};
    if (!result || result.ok === false) { showErr((result && result.message) || "Could not save that."); return false; }
    const previous = state;
    state = result.state;
    const saved = await Store.persist(state, result.ops || []);
    if (saved.unauthorized) {
      toast(saved.message || "That plant code was not accepted. This change is saved on this phone and will sync after you enter the right code.");
      render();
      askCode(true);
      return false;
    }
    if (saved.rejected) {
      const fresh = await Store.refresh({ keepNotice: true });
      if (fresh && fresh.ok && fresh.state) state = fresh.state;
      else if (!saved.sent) { state = previous; Store.remember(previous); }
      if (opt.close !== false) closeSheet();
      render();
      toast(saved.message || "The sheet rejected that save. It was not kept.");
      if (fresh && fresh.unauthorized) askCode(true);
      return false;
    }
    let needCode = false;
    if (Store.mode === "live" && saved.ok) {
      const fresh = await Store.refresh();
      if (fresh && fresh.ok && fresh.state) state = fresh.state;
      else if (fresh && fresh.unauthorized) needCode = true;
    }
    if (opt.close !== false) closeSheet();
    const hash = opt.hash || "";
    if (hash && location.hash !== hash) location.hash = hash;
    render();
    toast((result.message || "Saved.") + (saved.scriptStale ? " The sheet script needs an update before this can sync." : saved.queued ? " Kept on this phone until the sheet answers." : ""));
    if (needCode) askCode(true);
    return true;
  }

  function route() {
    const raw = (location.hash || "#home").replace(/^#/, "");
    const bits = raw.split("/");
    const name = bits[0] || "home";
    const known = ["home", "work", "assets", "parts", "pm", "more", "reports", "time", "team", "help", "wo", "asset", "part"].concat(window.Floor ? Floor.routes : []);
    if (!known.includes(name)) return { name: "home", id: "" };
    return { name, id: decodeURIComponent(bits.slice(1).join("/") || "") };
  }
  function tabFor(name) {
    if (name === "wo") return "work";
    if (name === "asset") return "assets";
    if (name === "part") return "parts";
    if (window.Floor && Floor.routes.indexOf(name) >= 0) return name === "settings" || name === "codes" ? "more" : "floor";
    if (["reports", "time", "team", "help"].includes(name)) return "more";
    return name;
  }
  function paintChrome() {
    const sub = byId("brandSub");
    if (sub) sub.textContent = Store.mode === "sample" ? "Lillington · sample data" : "Champion Homes · Lillington";
    const tab = tabFor(route().name);
    document.querySelectorAll(".nav a").forEach(a => a.setAttribute("aria-current", a.dataset.tab === tab ? "page" : "false"));
    const b = byId("banner");
    if (!b) return;
    if (Store.mode === "sample") {
      b.innerHTML = `<div class="banner sample" data-sample="true"><b>Sample data.</b> This is practice data for the Lillington plant, saved only on this phone. The crew will not see changes. Connect a Google Sheet when you want one shared list — the steps are in the README.</div>`;
      return;
    }
    const notes = PM.syncNotices({
      mode: Store.mode,
      pending: Store.pending,
      unreachable: Store.unreachable,
      rejected: Store.rejected,
      authProblem: Store.authProblem,
      scriptStale: Store.scriptStale
    });
    b.innerHTML = notes.map(n => `<div class="banner ${n.kind}" data-sync="${esc(n.code)}">${n.lead ? `<b>${esc(n.lead)}</b> ` : ""}${esc(n.text)}</div>`).join("");
  }

  function floorCtx() {
    window.__floorState = state;
    return {
      view, state, ui, PM, Store, route: route(), esc, sel, pill, toast, openSheet, closeSheet, commit, byId, val,
      assetChoices, techChoices, meName, sortedAssets, sortedTechs, statusPill, assetPill, download, paint: paintChrome,
      notify: (kind, assetId) => {
        if (Store.mode === "live" && Store.notify) Store.notify(kind, assetId).catch(() => toast("The email did not send. Check the alert address and that the script was redeployed."));
      },
      uploadPhoto: (dataUrl, name) => Store.uploadPhoto ? Store.uploadPhoto(dataUrl, name) : Promise.resolve({ ok: true, fallback: true, dataUrl })
    };
  }
  function render() {
    if (ui.me && !PM.techById(state, ui.me)) ui.me = "";
    window.__floorState = state;
    if (window.Floor) Floor._ctx = floorCtx();
    paintChrome();
    const r = route();
    try {
      if (window.Floor && Floor.handles(r.name)) { Floor.render(floorCtx()); return; }
      if (r.name === "home") renderHome();
      else if (r.name === "work") renderWork();
      else if (r.name === "wo") renderWo(r.id);
      else if (r.name === "assets") renderAssets();
      else if (r.name === "asset") renderAsset(r.id);
      else if (r.name === "parts") renderParts();
      else if (r.name === "part") renderPart(r.id);
      else if (r.name === "pm") renderPm();
      else if (r.name === "reports") renderReports();
      else if (r.name === "time") renderTime();
      else if (r.name === "team") renderTeam();
      else if (r.name === "help") renderHelp();
      else renderMore();
    } catch (err) {
      console.error(err);
      view.innerHTML = `<div class="empty"><h3>This page hit a snag</h3><p>${esc(err.message)}</p></div>`;
    }
    attachMics(view);
    if (window.Floor && Floor.loadDrivePhotos) Floor.loadDrivePhotos(view);
  }

  function renderHome() {
    const d = PM.dashboard(state, PM.today());
    const k = (key, label, value, tone) => `<div class="kpi" data-kpi="${key}"><div class="lab">${label}</div><div class="val ${tone || ""}">${value}</div></div>`;
    const max = d.topAssets[0] ? d.topAssets[0].total : 1;
    view.innerHTML = `
      ${Store.mode === "sample" ? `<p class="intro">Practice plant: wall line, compressor, gantry, and Randy Johnson's crew. Floor tools (QR, inspections, the compressor room) are under Floor.</p>` : ""}
      ${voiceWoButton("")}
      ${window.Floor && Floor.shown("today") ? `<p class="note"><a href="#today">Today</a> — ${PM.todayBrief(state, PM.today()).down.length} down, ${PM.todayBrief(state, PM.today()).pms.length} PM due, ${PM.todayBrief(state, PM.today()).late.length} late, ${PM.todayBrief(state, PM.today()).low.length} low stock.</p>` : ""}
      <section class="kpis" aria-label="Plant summary">
        ${k("open", "Open work", d.lateCount ? d.openCount + " · " + d.lateCount + " late" : String(d.openCount), d.lateCount ? "bad" : d.openCount ? "warn" : "")}
        ${k("overdue", "Overdue PMs", String(d.overduePm), d.overduePm ? "bad" : "")}
        ${k("low", "Low stock", String(d.lowCount), d.lowCount ? "warn" : "")}
        ${k("down", "Assets down", String(d.downCount), d.downCount ? "bad" : "")}
        ${k("spend", "Cost, 90 days", money0(d.spend90.total), "")}
        ${k("hours", "Hours this week", String(d.weekHours), "")}
      </section>
      <div class="home-grid">
        <section class="panel"><h2>Top cost, 90 days</h2>
          ${d.topAssets.length ? d.topAssets.slice(0, 5).map(a => `<a class="list-link" href="#asset/${esc(a.id)}"><span><b>${esc(a.tag)}</b> ${esc(a.name)}<span class="bar" style="width:${Math.max(4, a.total / max * 100)}%"></span></span><b class="num">${esc(PM.money(a.total))}</b></a>`).join("") : `<p class="note">No cost in the last 90 days.</p>`}
        </section>
        <section class="panel"><h2>Open work by tech</h2>
          ${d.openByTech.length ? d.openByTech.map(t => `<a class="list-link" href="#work"><span>${esc(t.name)}${t.high ? ` <small>${t.high} urgent or late</small>` : ""}</span><b class="num">${t.count}</b></a>`).join("") : `<p class="note">Nothing open.</p>`}
          ${d.draftCount ? `<p class="note">${d.draftCount} draft${d.draftCount === 1 ? "" : "s"} waiting to be finished.</p>` : ""}
        </section>
        <section class="panel"><h2>PMs that need attention</h2>
          ${d.pms.length ? d.pms.slice(0, 8).map(p => `<a class="list-link" href="#pm"><span>${pmPill(p.info)} <b>${esc(p.tag)}</b> ${esc(p.name)}<small>${esc(p.info.summary)}</small></span></a>`).join("") : `<p class="note">No PM is due or overdue.</p>`}
        </section>
        <section class="panel"><h2>Low stock</h2>
          ${d.lowStock.length ? d.lowStock.map(p => `<a class="list-link" href="#part/${esc(p.id)}" data-sku="${esc(p.sku)}"><span><b>${esc(p.sku)}</b> ${esc(p.name)}<small>Bin ${esc(p.bin || "—")}</small></span><b class="num">${esc(p.onHand)} / ${esc(p.reorderPoint)}</b></a>`).join("") : `<p class="note">Nothing is at its reorder point.</p>`}
        </section>
        <section class="panel span"><h2>Downtime, 90 days</h2>
          ${d.downtime.length ? d.downtime.map(a => `<a class="list-link" href="#asset/${esc(a.id)}"><span>${esc(a.tag)} ${esc(a.name)} ${a.status === "Down" ? pill("bad", "Down") : ""}</span><b class="num">${esc(a.hours)} h</b></a>`).join("") : `<p class="note">No downtime logged.</p>`}
        </section>
      </div>`;
  }

  function woTag(w) {
    if (w.assetTag) return `<span class="tag">${esc(w.assetTag)}</span>`;
    if (PM.isGeneral(w)) return `<span class="tag">No machine</span>`;
    return `<span class="tag">Draft</span>`;
  }
  function filteredWork(day) {
    const q = ui.workQ.toLowerCase();
    let list = state.workOrders.slice();
    if (ui.workView === "open") list = list.filter(w => PM.isActive(w.status));
    else if (ui.workView === "mine") list = list.filter(w => PM.isActive(w.status) && w.assignedTo === ui.me);
    else if (ui.workView === "unassigned") list = list.filter(w => PM.isActive(w.status) && !w.assignedTo);
    else if (ui.workView === "drafts") list = list.filter(w => w.status === "draft");
    else if (ui.workView === "done") list = list.filter(w => w.status === "complete" && w.completedDate >= PM.addDays(day, -90));
    if (q) list = list.filter(w => [w.woNumber, w.title, w.description, w.assetTag, w.assetName, w.location, PM.whoName(state, w), w.voiceTranscript].join(" ").toLowerCase().includes(q));
    return ui.workView === "done" ? list.sort((a, b) => String(b.completedDate).localeCompare(String(a.completedDate))) : PM.sortWork(list, day);
  }
  function workCards(list, day) {
    if (!list.length) return `<div class="empty"><h3>${ui.workView === "mine" && !ui.me ? "Choose your name" : "Nothing in this list"}</h3><p>${ui.workView === "drafts" ? "A quick flag lands here as a draft." : "Write a work order or flag something from the floor."}</p><button class="btn primary" type="button" data-action="new-wo">+ Work order</button></div>`;
    return `<div class="cards">${list.map(w => `<a class="card ${w.priority === "Urgent" ? "urgent" : w.priority === "High" ? "high" : ""}" href="#wo/${esc(w.id)}" data-wo="${esc(w.id)}">
        <div class="card-top">${woTag(w)}<span class="title">${esc(w.title)}</span>${w.priority === "High" || w.priority === "Urgent" ? `<span class="pill ${w.priority === "Urgent" ? "bad" : "warn"}">${esc(w.priority)}</span>` : ""}</div>
        <div class="meta">${statusPill(w.status)}${who(w)}<span class="mono">${esc(w.woNumber)}</span>${w.location && !w.assetTag ? `<span>${esc(w.location)}</span>` : ""}${w.dueDate ? `<span>${PM.isOverdueWo(w, day) ? "Overdue " : "Due "}${esc(PM.fmtShort(w.dueDate))}</span>` : ""}${PM.woCosts(state, w.id).total ? `<span class="num">${esc(PM.money(PM.woCosts(state, w.id).total))}</span>` : ""}</div>
      </a>`).join("")}</div>`;
  }
  function renderWork() {
    const day = PM.today();
    const views = [
      ["open", "Open"], ["mine", "Mine"], ["unassigned", "Unassigned"], ["drafts", "Drafts"], ["done", "Done"], ["all", "All"]
    ];
    view.innerHTML = `
      ${voiceWoButton("")}
      <div class="me-row"><span>This phone</span>${sel("meSel", ui.me, [["", "Choose your name…"]].concat(sortedTechs().map(t => [t.id, t.name])))}</div>
      <div class="toolbar"><div class="chips" role="group">${views.map(([k, l]) => `<button class="chip" type="button" data-view="${k}" aria-pressed="${ui.workView === k}">${l}</button>`).join("")}</div>
        <input class="grow" id="workQ" type="search" placeholder="Search work, asset, tech, WO #" value="${esc(ui.workQ)}" aria-label="Search work orders" autocomplete="on"></div>
      <div id="workList">${workCards(filteredWork(day), day)}</div>`;
    view.querySelectorAll("[data-view]").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.view === "mine" && !ui.me) { toast("Choose your name first."); byId("meSel").focus(); return; }
      ui.workView = b.dataset.view; renderWork(); paintChrome();
    }));
    const ms = byId("meSel");
    if (ms) ms.addEventListener("change", () => { ui.me = ms.value; saveUi(); if (ui.me) { ui.workView = "mine"; toast("This phone is " + meName()); } render(); });
    bindSearch("workQ", value => {
      ui.workQ = value;
      const host = byId("workList");
      if (host) host.innerHTML = workCards(filteredWork(day), day);
    });
    attachMics(view);
  }

  function renderWo(id) {
    const w = PM.woById(state, id);
    if (!w) { view.innerHTML = `<div class="empty"><h3>Work order not found</h3><p><a href="#work">Back to work</a></p></div>`; return; }
    const asset = PM.assetById(state, w.assetId);
    const c = PM.woCosts(state, w.id);
    const uses = state.uses.filter(u => u.workOrderId === w.id);
    const times = state.timeLogs.filter(t => t.workOrderId === w.id).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const comp = asset ? PM.compatibleParts(state, asset.id) : { linked: [], rest: [] };
    const day = PM.today();
    const partRow = (p, linked) => `<div class="partline"><div><b>${esc(p.sku)}</b> ${esc(p.name)}<div class="note">${esc(PM.money(p.unitCost))} · on hand <span data-onhand="${esc(p.sku)}">${esc(PM.num(p.onHand))}</span>${PM.num(p.onHand) <= PM.num(p.reorderPoint) ? " · reorder" : ""}</div></div>
      <div class="fitrow"><input class="qty" id="qty-${esc(p.id)}" type="number" min="0" step="any" value="1" aria-label="Quantity of ${esc(p.sku)}">${linked ? "" : `<label class="hint"><input type="checkbox" id="fit-${esc(p.id)}"> Add to ${esc(asset.tag)}</label>`}<button class="btn small primary" type="button" data-action="use-part" data-id="${esc(p.id)}">Use</button></div></div>`;
    view.innerHTML = `
      <p class="back"><a href="#work">Work orders</a></p>
      <div class="detail-grid">
        <div class="stack main">
          <article class="panel">
            <div class="card-top">${w.assetTag ? `<a class="tag" href="#asset/${esc(w.assetId)}">${esc(w.assetTag)}</a>` : `<span class="tag">${PM.isGeneral(w) ? "No machine" : "No asset"}</span>`}<h2 class="title" style="margin:0;font-size:1.35rem">${esc(w.title)}</h2></div>
            ${PM.isGeneral(w) ? `<p class="note">No machine · General${w.location ? " · " + esc(w.location) : ""}</p>` : ""}
            <p class="prose">${esc(w.description || "")}</p>
            ${w.voiceTranscript && w.voiceTranscript !== w.description ? `<p class="note">Dictated: ${esc(w.voiceTranscript)}</p>` : ""}
            ${w.workPerformed ? `<h3>Work performed</h3><p class="prose">${esc(w.workPerformed)}</p>` : ""}
          </article>
          <article class="panel"><h2>Parts on this job</h2>
            ${uses.length ? uses.map(u => `<div class="partline"><div><b>${esc(u.qty)} × ${esc(u.partSku)}</b> ${esc(u.partName)}<div class="note">${esc(PM.money(u.extended))}</div></div><button class="btn small" type="button" data-action="return-use" data-id="${esc(u.id)}">Return</button></div>`).join("") : `<p class="note">No parts used yet.</p>`}
            ${asset ? `<h3>Parts that fit ${esc(asset.tag)}</h3>${comp.linked.length ? comp.linked.map(p => partRow(p, true)).join("") : `<p class="note">Nothing is linked to this machine yet. Add one from the list below, or from the asset.</p>`}
              <details><summary>Other stock</summary>${comp.rest.map(p => partRow(p, false)).join("") || `<p class="note">No other parts.</p>`}</details>` : `<p class="note">${PM.isGeneral(w) ? "This plant task isn't tied to a machine, so parts are picked from the full list when you edit the job." : "Pick the equipment on this draft and the parts that fit it will show up here."}</p>`}
          </article>
          <article class="panel"><h2>Time</h2>
            ${times.length ? times.map(t => `<div class="partline"><div><b>${esc(t.techName)}</b> ${esc(t.date)} · ${esc(t.hours)} h<div class="note">${esc(t.notes || "")} ${esc(PM.money(PM.num(t.hours) * PM.num(t.rate)))}</div></div><button class="btn small" type="button" data-action="delete-time" data-id="${esc(t.id)}">Remove</button></div>`).join("") : `<p class="note">No hours logged.</p>`}
            <button class="btn" type="button" data-action="log-time" data-id="${esc(w.id)}">Log time</button>
          </article>
          ${window.Floor ? Floor.photoPanel(w, esc) : ""}
        </div>
        <div class="stack side">
          <article class="panel">
            <div class="meta">${statusPill(w.status)}${w.priority !== "Normal" ? pill(w.priority === "Urgent" || w.priority === "High" ? "warn" : "idle", w.priority) : ""}<span class="mono">${esc(w.woNumber)}</span></div>
            <div class="f" style="margin-top:10px"><label for="woStatus">Status</label>${sel("woStatus", w.status, PM.STATUSES.map(s => [s, PM.STATUS_LABEL[s]]))}</div>
            <div class="f"><label for="woWho">Assigned to</label>${sel("woWho", w.assignedTo, techChoices("Unassigned"))}</div>
            <div class="costline"><div>Total<b class="num">${esc(PM.money(c.total))}</b></div><div>Parts<div class="num">${esc(PM.money(c.parts))}</div></div><div>Labor<div class="num">${esc(c.laborHours)} h · ${esc(PM.money(c.labor))}</div></div><div>Other<div class="num">${esc(PM.money(c.other))}</div></div>${PM.num(w.downtimeHours) ? `<div>Downtime<div class="num">${esc(w.downtimeHours)} h</div></div>` : ""}</div>
            <p class="note">${w.dueDate ? (PM.isOverdueWo(w, day) ? "Overdue " : "Due ") + PM.fmtDate(w.dueDate) + ". " : ""}${w.requestedBy ? "Requested by " + w.requestedBy + ". " : ""}${asset && PM.isMetered(asset) ? "Meter " + (PM.hasNum(asset.meter) ? PM.num(asset.meter).toLocaleString() + " " + PM.meterWord(asset) : "not logged") + (PM.hasNum(w.meterAt) ? " · at this job " + PM.num(w.meterAt).toLocaleString() : "") : ""}</p>
            <div class="actions">
              <button class="btn" type="button" data-action="edit-wo" data-id="${esc(w.id)}">Edit</button>
              ${w.status !== "complete" && w.status !== "cancelled" ? `<button class="btn primary" type="button" data-action="complete-wo" data-id="${esc(w.id)}">Complete</button>` : ""}
              ${meTech() && w.assignedTo !== ui.me && w.status !== "cancelled" ? `<button class="btn" type="button" data-action="assign-me" data-id="${esc(w.id)}">Assign to me</button>` : ""}
              ${asset && PM.isMetered(asset) ? `<button class="btn" type="button" data-action="log-meter" data-id="${esc(asset.id)}" data-wo="${esc(w.id)}">Log meter</button>` : ""}
              <button class="btn" type="button" data-action="print-wo" data-id="${esc(w.id)}">Print</button>
              ${w.status === "draft" ? `<button class="btn danger" type="button" data-action="delete-draft" data-id="${esc(w.id)}">Delete draft</button>` : ""}
              ${w.status !== "cancelled" && w.status !== "draft" ? `<button class="btn danger" type="button" data-action="cancel-wo" data-id="${esc(w.id)}">Cancel</button>` : ""}
            </div>
          </article>
        </div>
      </div>`;
    byId("woStatus").addEventListener("change", () => {
      const status = byId("woStatus").value;
      if (status === w.status) return;
      if (status === "complete") { byId("woStatus").value = w.status; completeForm(w); return; }
      if (status === "cancelled") { byId("woStatus").value = w.status; confirmCancel(w); return; }
      commit(PM.setWoStatus(state, { id: w.id, status }));
    });
    byId("woWho").addEventListener("change", () => {
      commit(PM.saveWo(state, Object.assign({}, w, { assignedTo: byId("woWho").value })));
    });
  }

  function renderAssets() {
    view.innerHTML = `
      <div class="toolbar"><input class="grow" id="assetQ" type="search" placeholder="Search tag, name, area" value="${esc(ui.assetQ)}" aria-label="Search equipment" autocomplete="on"><button class="btn primary" type="button" data-action="new-asset">+ Asset</button></div>
      <div id="assetList">${assetCards()}</div>`;
    bindSearch("assetQ", value => {
      ui.assetQ = value;
      const host = byId("assetList");
      if (host) host.innerHTML = assetCards();
    });
    attachMics(view);
  }
  function assetCards() {
    const q = ui.assetQ.toLowerCase();
    const list = sortedAssets().filter(a => !q || [a.tag, a.name, a.area, a.type, a.make, a.model].join(" ").toLowerCase().includes(q));
    const day = PM.today();
    if (!list.length) return `<div class="empty"><h3>No equipment yet</h3><p>Add each machine once. Then work orders, parts, and PMs hang off it.</p><button class="btn primary" type="button" data-action="new-asset">+ Asset</button></div>`;
    return `<div class="cards">${list.map(a => {
      const spend = PM.spendBetween(state, PM.addDays(day, -89), day, a.id);
      const due = state.pmTasks.filter(t => t.assetId === a.id && ["overdue", "due", "soon"].includes(PM.pmInfo(state, t, day).status)).length;
      return `<a class="card" href="#asset/${esc(a.id)}"><div class="card-top"><span class="tag">${esc(a.tag)}</span><span class="title">${esc(a.name)}<small style="display:block;font-weight:400;color:var(--muted)">${esc(a.area || a.type || "")}</small></span>${assetPill(a)}</div>
          <div class="meta"><span>${PM.isMetered(a) && PM.hasNum(a.meter) ? esc(PM.num(a.meter).toLocaleString()) + " " + esc(PM.meterWord(a)) : "No meter"}</span><span>90-day ${esc(money0(spend.total))}</span>${due ? `<span>${due} PM</span>` : ""}</div></a>`;
    }).join("")}</div>`;
  }

  function renderAsset(id) {
    const a = PM.assetById(state, id);
    if (!a) { view.innerHTML = `<div class="empty"><h3>Equipment not found</h3><p><a href="#assets">Back</a></p></div>`; return; }
    const day = PM.today();
    const spend = PM.spendBetween(state, PM.addDays(day, -89), day, a.id);
    const wos = state.workOrders.filter(w => w.assetId === a.id).sort((x, y) => String(y.openedDate).localeCompare(String(x.openedDate))).slice(0, 8);
    const levels = state.levels.filter(l => l.assetId === a.id);
    const tasks = state.pmTasks.filter(t => t.assetId === a.id);
    const fits = state.fits.filter(f => f.assetId === a.id);
    view.innerHTML = `
      <p class="back"><a href="#assets">Equipment</a></p>
      <div class="detail-grid">
        <div class="stack side">
          <article class="panel">
            <div class="card-top"><span class="tag">${esc(a.tag)}</span><h2 class="title" style="margin:0">${esc(a.name)}</h2></div>
            <p class="note">${esc([a.area, a.type, a.make, a.model, a.year].filter(Boolean).join(" · "))}${a.serial ? " · " + esc(a.serial) : ""}</p>
            <div class="f"><label for="assetStatus">Status</label>${sel("assetStatus", a.status, PM.ASSET_STATUSES.map(s => [s, s]))}</div>
            <div class="costline"><div>90-day cost<b>${esc(money0(spend.total))}</b></div><div>Downtime<div>${esc(spend.downtime)} h</div></div><div>Labor<div>${esc(spend.hours)} h</div></div></div>
            <p class="note">${PM.isMetered(a) ? "Meter: " + (PM.hasNum(a.meter) ? PM.num(a.meter).toLocaleString() + " " + PM.meterWord(a) : "none logged yet") : "No meter — PM dates come from the calendar."}</p>
            ${a.notes ? `<p class="prose">${esc(a.notes)}</p>` : ""}
            <div class="actions">
              <button class="btn" type="button" data-action="edit-asset" data-id="${esc(a.id)}">Edit</button>
              <button class="btn primary" type="button" data-action="new-wo" data-id="${esc(a.id)}">+ Work order</button>
              ${voiceWoButton(a.id)}
              ${PM.isMetered(a) ? `<button class="btn" type="button" data-action="log-meter" data-id="${esc(a.id)}">Log meter</button>` : ""}
              <button class="btn" type="button" data-action="log-time-asset" data-id="${esc(a.id)}">Log time</button>
              ${window.Floor ? Floor.assetExtra(a, esc) : ""}
            </div>
          </article>
        </div>
        <div class="stack main">
          <article class="panel"><h2>Maintenance levels</h2>
            <p class="note">Daily, weekly, monthly, hours — set the rhythm for this machine. PM tasks use a level.</p>
            ${levels.length ? levels.map(l => `<div class="partline"><div><b>${esc(l.name)}</b><div class="note">${esc(PM.intervalLabel(l, a))}${l.active === "no" ? " · paused" : ""}</div></div><div class="fitrow"><button class="btn small" type="button" data-action="edit-level" data-id="${esc(l.id)}">Edit</button><button class="btn small danger" type="button" data-action="delete-level" data-id="${esc(l.id)}">Remove</button></div></div>`).join("") : `<p class="note">No levels yet.</p>`}
            <button class="btn" type="button" data-action="add-level" data-id="${esc(a.id)}">+ Level</button>
          </article>
          <article class="panel"><h2>PM tasks</h2>
            ${tasks.length ? tasks.map(t => { const info = PM.pmInfo(state, t, day); const level = PM.levelById(state, t.levelId); return `<div class="partline"><div>${pmPill(info)} <b>${esc(t.name)}</b><div class="note">${esc(level ? level.name : "")} · ${esc(info.summary)}</div></div><button class="btn small" type="button" data-action="edit-task" data-id="${esc(t.id)}">Edit</button></div>`; }).join("") : `<p class="note">No PM tasks yet. Add a level, then a task.</p>`}
            <button class="btn" type="button" data-action="add-task" data-id="${esc(a.id)}">+ PM task</button>
          </article>
          <article class="panel"><h2>Parts that fit ${esc(a.tag)}</h2>
            ${fits.length ? fits.map(f => { const p = PM.partById(state, f.partId); if (!p) return ""; return `<div class="partline"><div><b>${esc(p.sku)}</b> ${esc(p.name)}<div class="note">On hand ${esc(PM.num(p.onHand))}${PM.num(p.onHand) <= PM.num(p.reorderPoint) ? " · reorder" : ""}${f.notes ? " · " + esc(f.notes) : ""}</div></div><button class="btn small" type="button" data-action="remove-fit" data-id="${esc(f.id)}">Remove</button></div>`; }).join("") : `<p class="note">None yet. When a tech finds a part that belongs here, add it.</p>`}
            <button class="btn" type="button" data-action="add-fit" data-id="${esc(a.id)}">Add a part to this machine</button>
          </article>
          ${window.Floor ? Floor.assetPanels(a, esc) : ""}
          <article class="panel"><h2>Recent work</h2>
            ${wos.length ? wos.map(w => `<a class="list-link" href="#wo/${esc(w.id)}"><span>${statusPill(w.status)} ${esc(w.woNumber)} ${esc(w.title)}</span><span class="num">${esc(PM.money(PM.woCosts(state, w.id).total))}</span></a>`).join("") : `<p class="note">No work orders yet.</p>`}
          </article>
        </div>
      </div>`;
    byId("assetStatus").addEventListener("change", () => commit(PM.saveAsset(state, Object.assign({}, a, { status: byId("assetStatus").value }))));
  }

  function renderParts() {
    view.innerHTML = `
      <div class="toolbar"><div class="chips"><button class="chip" type="button" data-pv="all" aria-pressed="${ui.partView === "all"}">All</button><button class="chip" type="button" data-pv="low" aria-pressed="${ui.partView === "low"}">Low stock</button></div>
        <input class="grow" id="partQ" type="search" placeholder="Search part number or name" value="${esc(ui.partQ)}" aria-label="Search parts" autocomplete="on"><button class="btn" type="button" id="reorderBtn">Reorder CSV</button><button class="btn primary" type="button" data-action="new-part">+ Part</button></div>
      <div id="partList">${partCards()}</div>`;
    view.querySelectorAll("[data-pv]").forEach(b => b.addEventListener("click", () => { ui.partView = b.dataset.pv; renderParts(); }));
    const reorderBtn = byId("reorderBtn");
    if (reorderBtn) reorderBtn.addEventListener("click", () => download("reorder-list.csv", PM.reorderCsv(state)));
    bindSearch("partQ", value => {
      ui.partQ = value;
      const host = byId("partList");
      if (host) host.innerHTML = partCards();
    });
    attachMics(view);
  }
  function partCards() {
    const q = ui.partQ.toLowerCase();
    let list = state.parts.slice().sort((a, b) => (PM.num(a.onHand) <= PM.num(a.reorderPoint) ? 0 : 1) - (PM.num(b.onHand) <= PM.num(b.reorderPoint) ? 0 : 1) || String(a.sku).localeCompare(String(b.sku)));
    if (ui.partView === "low") list = list.filter(p => PM.num(p.onHand) <= PM.num(p.reorderPoint));
    if (q) list = list.filter(p => [p.sku, p.name, p.bin, p.vendor].join(" ").toLowerCase().includes(q));
    if (!list.length) return `<div class="empty"><h3>No parts</h3><button class="btn primary" type="button" data-action="new-part">+ Part</button></div>`;
    return `<div class="cards">${list.map(p => {
      const low = PM.num(p.onHand) <= PM.num(p.reorderPoint);
      const tags = state.fits.filter(f => f.partId === p.id).map(f => (PM.assetById(state, f.assetId) || {}).tag).filter(Boolean);
      return `<a class="card" href="#part/${esc(p.id)}" data-sku="${esc(p.sku)}"><div class="card-top"><span class="tag">${esc(p.sku)}</span><span class="title">${esc(p.name)}</span>${low ? pill("warn", "Reorder") : ""}</div>
          <div class="meta"><span data-onhand="${esc(p.sku)}">On hand ${esc(PM.num(p.onHand))}</span><span>Reorder at ${esc(PM.num(p.reorderPoint))}</span><span>${esc(PM.money(p.unitCost))}</span>${tags.length ? `<span>Fits ${esc(tags.join(", "))}</span>` : ""}</div></a>`;
    }).join("")}</div>`;
  }

  function renderPart(id) {
    const p = PM.partById(state, id);
    if (!p) { view.innerHTML = `<div class="empty"><h3>Part not found</h3><p><a href="#parts">Back</a></p></div>`; return; }
    const fits = state.fits.filter(f => f.partId === p.id);
    const used = state.uses.filter(u => u.partId === p.id);
    const spent = used.reduce((n, u) => n + PM.num(u.extended), 0);
    const low = PM.num(p.onHand) <= PM.num(p.reorderPoint);
    view.innerHTML = `
      <p class="back"><a href="#parts">Parts</a></p>
      <div class="detail-grid">
        <div class="stack side"><article class="panel">
          <div class="card-top"><span class="tag">${esc(p.sku)}</span><h2 class="title" style="margin:0">${esc(p.name)}</h2>${low ? pill("warn", "Reorder") : pill("ok", "In stock")}</div>
          <div class="costline"><div>On hand<b data-onhand="${esc(p.sku)}">${esc(PM.num(p.onHand))}</b></div><div>Reorder at<div>${esc(PM.num(p.reorderPoint))}</div></div><div>Unit<div>${esc(PM.money(p.unitCost))}</div></div><div>Stock value<div>${esc(PM.money(PM.num(p.onHand) * PM.num(p.unitCost)))}</div></div></div>
          <p class="note">${p.bin ? "Bin " + esc(p.bin) + ". " : ""}${p.vendor ? esc(p.vendor) + ". " : ""}Reorder qty ${esc(PM.num(p.reorderQty))}. Used cost ${esc(PM.money(spent))}.</p>
          ${p.notes ? `<p>${esc(p.notes)}</p>` : ""}
          <div class="actions">
            <button class="btn primary" type="button" data-action="receive" data-id="${esc(p.id)}">Receive</button>
            <button class="btn" type="button" data-action="adjust" data-id="${esc(p.id)}">Correct the count</button>
            <button class="btn" type="button" data-action="edit-part" data-id="${esc(p.id)}">Edit</button>
            <button class="btn danger" type="button" data-action="delete-part" data-id="${esc(p.id)}">Delete</button>
          </div>
        </article></div>
        <div class="stack main">
          <article class="panel"><h2>Fits these machines</h2>
            ${fits.length ? fits.map(f => { const a = PM.assetById(state, f.assetId); return `<div class="partline"><div><a href="#asset/${esc(f.assetId)}"><b>${esc(a ? a.tag : "")}</b> ${esc(a ? a.name : "")}</a><div class="note">${esc(f.notes || "")}${f.addedBy ? " · added by " + esc(f.addedBy) : ""}</div></div><button class="btn small" type="button" data-action="remove-fit" data-id="${esc(f.id)}">Remove</button></div>`; }).join("") : `<p class="note">Not linked to a machine yet.</p>`}
          </article>
          <article class="panel"><h2>Where it's been used</h2>
            ${used.length ? used.slice().reverse().slice(0, 12).map(u => { const w = PM.woById(state, u.workOrderId); return `<a class="list-link" href="#wo/${esc(u.workOrderId)}"><span>${esc(u.qty)} × on ${esc(w ? w.woNumber : "a job")} ${esc(w ? w.title : "")}</span><span>${esc(PM.money(u.extended))}</span></a>`; }).join("") : `<p class="note">Not used on a work order yet.</p>`}
          </article>
        </div>
      </div>`;
  }

  function renderPm() {
    const day = PM.today();
    const rows = state.pmTasks.map(t => {
      const info = PM.pmInfo(state, t, day);
      const a = PM.assetById(state, t.assetId);
      const level = PM.levelById(state, t.levelId);
      return { t, info, a, level };
    }).sort((x, y) => ["overdue", "due", "soon", "ok", "off"].indexOf(x.info.status) - ["overdue", "due", "soon", "ok", "off"].indexOf(y.info.status) || String(x.a && x.a.tag).localeCompare(String(y.a && y.a.tag)));
    view.innerHTML = `
      <div class="toolbar"><p class="note" style="flex:1;margin:0">Due dates use the hour meter when the machine has one, and the calendar when it doesn't. Opening a PM work order pulls the parts and puts the cost on that asset.</p>
        <button class="btn primary" type="button" data-action="generate-due">Generate due PMs</button></div>
      ${rows.length ? `<div class="cards">${rows.map(({ t, info, a, level }) => `<article class="card" data-pm="${esc(t.id)}">
        <div class="card-top">${a ? `<a class="tag" href="#asset/${esc(a.id)}">${esc(a.tag)}</a>` : ""}<span class="title">${esc(t.name)}</span>${pmPill(info)}</div>
        <div class="meta"><span>${esc(level ? level.name : "")}</span><span>${esc(PM.intervalLabel(level, a))}</span></div>
        <p class="note" style="margin:0">${esc(info.summary)}</p>
        <div class="actions">${info.openWoId ? `<a class="btn" href="#wo/${esc(info.openWoId)}">Open ${esc(info.openWoNumber)}</a>` : `<button class="btn primary" type="button" data-action="make-pm" data-id="${esc(t.id)}">Make work order</button>`}</div>
      </article>`).join("")}</div>` : `<div class="empty"><h3>No PM tasks</h3><p>Open a machine, add a level such as Weekly or 250 hours, then add a task.</p><a class="btn" href="#assets">Equipment</a></div>`}`;
  }

  function renderReports() {
    const day = PM.today();
    const [from, to, label] = PM.rangeBounds(ui.range, day, { from: ui.from, to: ui.to });
    const reports = PM.buildReports(state, { from, to, today: day });
    const report = reports.find(r => r.id === ui.report) || reports[0];
    ui.report = report.id;
    const hidden = new Set(ui.hidden[report.id] || []);
    const cols = report.columns.filter(c => !hidden.has(c.key));
    const ranges = [["month", "This month"], ["90d", "Last 90 days"], ["ytd", "Year to date"], ["12m", "Last 12 months"], ["all", "All time"], ["custom", "Custom"]];
    const show = v => v == null || v === "" ? "" : (typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString() : PM.round2(v).toLocaleString()) : String(v));
    view.innerHTML = `
      <div class="toolbar">
        ${sel("repId", report.id, reports.map(r => [r.id, r.title]), 'aria-label="Report"')}
        ${sel("repRange", ui.range, ranges, 'aria-label="Date range"')}
        ${ui.range === "custom" ? `<input type="date" id="repFrom" value="${esc(ui.from)}" aria-label="From"><input type="date" id="repTo" value="${esc(ui.to)}" aria-label="To">` : ""}
        <button class="btn" type="button" id="csvBtn">Download CSV</button>
      </div>
      <p class="note">${esc(report.blurb)} ${esc(label)}. Uncheck a field to hide it. That choice stays on this phone.</p>
      <div class="checks" id="fieldChecks">${report.columns.map(c => `<label><input type="checkbox" data-col="${esc(c.key)}" ${hidden.has(c.key) ? "" : "checked"}> ${esc(c.label)}</label>`).join("")}</div>
      <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr>${cols.map(c => `<th class="${c.kind === "num" || c.kind === "money" ? "num" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead>
        <tbody>${report.rows.length ? report.rows.map(row => `<tr>${cols.map(c => `<td class="${c.kind === "num" || c.kind === "money" ? "num" : c.key === "description" || c.key === "partsUsed" || c.key === "status" ? "" : "clip"}">${esc(c.kind === "money" ? PM.money(row[c.key] || 0) : c.kind === "date" ? PM.fmtShort(row[c.key]) : show(row[c.key]))}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}">Nothing in this range.</td></tr>`}</tbody></table></div>`;
    byId("repId").addEventListener("change", () => { ui.report = byId("repId").value; saveUi(); renderReports(); });
    byId("repRange").addEventListener("change", () => { ui.range = byId("repRange").value; saveUi(); renderReports(); });
    if (byId("repFrom")) byId("repFrom").addEventListener("change", () => { ui.from = byId("repFrom").value; renderReports(); });
    if (byId("repTo")) byId("repTo").addEventListener("change", () => { ui.to = byId("repTo").value; renderReports(); });
    byId("fieldChecks").addEventListener("change", e => {
      const key = e.target.dataset.col;
      if (!key) return;
      const set = new Set(ui.hidden[report.id] || []);
      if (e.target.checked) set.delete(key); else set.add(key);
      if (set.size >= report.columns.length) { e.target.checked = true; toast("Leave at least one field."); return; }
      ui.hidden[report.id] = Array.from(set);
      saveUi();
      renderReports();
    });
    byId("csvBtn").addEventListener("click", () => download(report.id + ".csv", PM.toCsv(cols, report.rows)));
  }

  function renderTime() {
    const rows = state.timeLogs.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 40);
    view.innerHTML = `
      <div class="toolbar"><p class="note" style="flex:1;margin:0">Hours against a work order roll into that job's labor cost. You can also log time on a machine with no work order.</p><button class="btn primary" type="button" data-action="log-time-asset">Log time</button></div>
      ${rows.length ? rows.map(t => { const a = PM.assetById(state, t.assetId); const w = t.workOrderId && PM.woById(state, t.workOrderId); return `<div class="partline"><div><b>${esc(t.techName)}</b> · ${esc(a ? a.tag : "")} ${esc(a ? a.name : "")}<div class="note">${esc(t.date)} · ${esc(t.hours)} h · ${esc(PM.money(PM.num(t.hours) * PM.num(t.rate)))}${w ? " · " + esc(w.woNumber) : ""}${t.notes ? " · " + esc(t.notes) : ""}</div></div></div>`; }).join("") : `<div class="empty"><h3>No time logged</h3></div>`}`;
  }

  function renderTeam() {
    view.innerHTML = `
      <p class="note">People you can assign work to. A cell number lets you text them the job from the work order.</p>
      ${state.techs.length ? state.techs.slice().sort((a, b) => a.name.localeCompare(b.name)).map(t => `<div class="partline"><div><b>${esc(t.name)}</b> ${t.role ? "· " + esc(t.role) : ""}<div class="note">${esc([t.phone, t.email, PM.money(t.hourlyRate) + "/h"].filter(Boolean).join(" · "))}${t.active === "no" ? " · inactive" : ""}</div></div><button class="btn small" type="button" data-action="edit-tech" data-id="${esc(t.id)}">Edit</button></div>`).join("") : `<p class="note">No one yet.</p>`}
      <button class="btn primary" type="button" data-action="new-tech" style="margin-top:8px">+ Tech</button>`;
  }

  function renderHelp() {
    view.innerHTML = `
      <article class="panel"><h2>Using this on the floor or at a desk</h2>
        <p>The same page runs on a phone and on a shop computer. On a phone the sections sit along the bottom. On a wide screen they sit under the header and the lists spread into columns.</p>
        <p>On a phone, use the browser's <b>Add to Home Screen</b> (or Install app) so it opens like any other app.</p>
        <h3>Quick flag</h3>
        <p>Tap <b>Quick flag</b>. Click the big box. Dictate with <b>Wispr Flow</b> — it types into whatever box is selected — or type, or tap <b>Mic</b> for this browser's speech recognition. Save, and you get a draft work order to finish later. The words stay exactly as they landed in the box.</p>
        <h3>Work orders</h3>
        <p>The title and the description are normal text boxes, so Wispr Flow, the keyboard, and the mic all work. Every text box in the app works that way, including search. Assign the job to a tech. Parts that fit that machine are listed on the job; <b>Use</b> takes them out of stock and adds the cost. If the count hits the reorder point, you'll see it here and on Home.</p>
        <p>Set the type to <b>General / plant task</b> when the job is not on a machine. Leave equipment blank and type a location, such as Break room. The list shows <b>No machine</b>.</p>
        <p><b>Voice work order</b> is on Home, Today, the work list, and a machine you opened from a QR label. One tap starts the mic. Say the job, listen to the read-back, then say save, cancel, or change. Browsers will not start the mic with no tap at all.</p>
        <h3>Equipment, levels, and PM</h3>
        <p>Add a machine under Assets. Give it levels (daily, weekly, monthly, or hours). Add a PM task on a level and list the parts it needs. <b>Make work order</b> opens the job, pulls those parts, and logs the cost on that asset. Metered machines get a suggested date from how fast the hours are climbing. Machines without a meter use the calendar.</p>
        <h3>Meters and time</h3>
        <p>Log the meter while you're on the repair. That reading is what the next PM date is based on. Log hours on the work order, or on the machine if there isn't a work order yet.</p>
        <h3>Reports</h3>
        <p>Reports start with every field showing: hours, parts, downtime, cost. Uncheck a field to hide it. The choice sticks on this phone.</p>
        ${Store.mode === "sample" ? `<p><b>This phone is on sample data.</b> It is not shared. More → Reset sample data puts the practice plant back.</p>` : `<p>This phone is tied to the shared Google Sheet. Everyone with the link and the plant code sees the same jobs.</p>`}
      </article>`;
  }

  function renderMore() {
    view.innerHTML = `
      <div class="me-row"><span>This phone</span>${sel("meSel", ui.me, [["", "Choose your name…"]].concat(sortedTechs().map(t => [t.id, t.name])))}</div>
      <div class="cards">
        <a class="card" href="#floor"><span class="title">Floor tools</span><span class="note">QR, inspections, compressor room, schedule, downtime, monthly report.</span></a>
        <a class="card" href="#settings"><span class="title">Settings</span><span class="note">Hide modules you don't want. Digest and alert email.</span></a>
        <a class="card" href="#reports"><span class="title">Reports</span><span class="note">Hours, parts, downtime, cost. Hide fields you don't need.</span></a>
        <a class="card" href="#time"><span class="title">Time</span><span class="note">Hours by tech, on a job or on a machine.</span></a>
        <a class="card" href="#team"><span class="title">Team</span><span class="note">Techs you can assign work to.</span></a>
        <a class="card" href="#help"><span class="title">How to use</span><span class="note">Phones, desktops, Wispr Flow, PMs, and parts.</span></a>
        ${Store.mode === "sample" ? `<button class="card" type="button" data-action="reset-sample"><span class="title">Reset sample data</span><span class="note">Put the practice plant back. Your edits on this phone go away.</span></button>` : `<button class="card" type="button" data-action="sync"><span class="title">Sync now</span><span class="note">Pull the latest from the Google Sheet.</span></button>`}
      </div>`;
    const ms = byId("meSel");
    if (ms) ms.addEventListener("change", () => { ui.me = ms.value; saveUi(); toast(ui.me ? "This phone is " + meName() : "This phone isn't set to a name."); });
  }

  function bindSearch(id, apply) {
    const el = byId(id);
    if (!el) return;
    let t;
    el.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const box = byId(id);
        if (!box) return;
        if (!PM.dictationAllowsRender({ focused: document.activeElement === box, composing })) {
          apply(box.value);
          return;
        }
        apply(box.value);
      }, 180);
    });
  }
  function download(filename, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function textField(id, label, value, hint, kind) {
    return `<div class="f"><label for="${id}">${label}</label><input id="${id}" class="dictate" data-dictate="${esc(kind || id)}" type="text" autocomplete="on" autocapitalize="sentences" spellcheck="true" value="${esc(value || "")}">${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
  }
  function areaField(id, label, value, hint, micId, kind, placeholder) {
    return `<div class="f"><label for="${id}">${label}</label>
      <textarea id="${id}" class="dictate" data-dictate="${esc(kind || id)}" rows="6" autocomplete="on" autocapitalize="sentences" spellcheck="true" placeholder="${esc(placeholder || "")}">${esc(value || "")}</textarea>
      ${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
  }

  const WISPR = "Click the box and dictate with Wispr Flow, the phone keyboard mic, or type. Mic on this box uses the browser's speech recognition and writes into the same box. Edit the words before you save.";

  function flagForm() {
    openSheet("Quick flag", `
      ${areaField("flagText", "What's going on?", "", "Dictate with Wispr Flow into this box, type it, or use Mic. This saves a draft work order to finish later.", "", "flag", "Bay 3 crane is grinding on the bridge travel…")}
      <div class="g2"><div class="f"><label for="flagAsset">Equipment, if you know it</label>${sel("flagAsset", "", assetChoices("Not sure yet"))}</div>
        <div class="f"><label for="flagWho">Assign to</label>${sel("flagWho", ui.me, techChoices("Leave unassigned"))}</div></div>
      <div class="err" id="formErr" role="alert"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="flagSave">Save draft</button>`,
      () => {
        focusField("flagText");
        byId("flagSave").addEventListener("click", async () => {
          const text = val("flagText").trim();
          if (!text) { showErr("Say what you found, or type it in the box."); focusField("flagText"); return; }
          const title = text.split(/\n/)[0].slice(0, 80);
          const field = byId("flagText");
          const result = PM.saveWo(state, {
            title, description: text, voiceTranscript: field.dataset.mic === "1" ? text : "",
            status: "draft", source: field.dataset.mic === "1" ? "voice" : "typed",
            assetId: val("flagAsset"), assignedTo: val("flagWho"), priority: "Normal", type: "Repair", openedDate: PM.today()
          });
          await commit(result, { hash: result.ok ? "#wo/" + result.woId : "" });
        });
      });
  }

  function woForm(existing, preset) {
    const w = existing || {};
    preset = preset || {};
    const assetId = preset.assetId || w.assetId || "";
    openSheet(existing ? "Edit " + w.woNumber : "New work order", `
      <div class="f"><label for="wType">Type</label>${sel("wType", w.type || "Repair", PM.WO_TYPES.map(t => [t, t]))}</div>
      <div class="f"><label for="wAsset">Equipment</label>${sel("wAsset", assetId, assetChoices("No machine — General / plant task, or a draft"))}</div>
      ${textField("wLoc", "Location / area", w.location || "", "Optional. Used when this job isn't on a machine, for example Break room.")}
      ${textField("wTitle", "Title", w.title || "", "Leave this blank if you're dictating the whole job into the box below. The first line becomes the title.")}
      ${areaField("wDesc", "What's wrong / what to do", w.description || "", WISPR, "", "description", "Turner hose is wet and the mast drifts when the line sits.")}
      <div class="g3">
        <div class="f"><label for="wPri">Priority</label>${sel("wPri", w.priority || "Normal", PM.PRIORITIES.map(t => [t, t]))}</div>
        <div class="f"><label for="wStat">Status</label>${sel("wStat", w.status === "complete" ? "complete" : (w.status || "open"), PM.STATUSES.filter(s => s !== "cancelled" && (s !== "complete" || w.status === "complete")).map(s => [s, PM.STATUS_LABEL[s]]))}</div>
      </div>
      <div class="g2">
        <div class="f"><label for="wWho">Assign to</label>${sel("wWho", w.assignedTo || (existing ? "" : ui.me), techChoices("Unassigned"))}</div>
        <div class="f"><label for="wDue">Due</label><input id="wDue" type="date" value="${esc(w.dueDate || "")}"></div>
      </div>
      <div class="g2">
        <div class="f"><label for="wDown">Downtime hours</label><input id="wDown" type="number" min="0" step="0.1" value="${esc(w.downtimeHours || 0)}"></div>
        <div class="f"><label for="wOther">Other cost</label><input id="wOther" type="number" min="0" step="0.01" value="${esc(w.otherCost || 0)}"></div>
      </div>
      <div class="f"><label for="wBy">Requested by</label><input id="wBy" type="text" value="${esc(w.requestedBy || "")}" autocomplete="on"></div>
      ${areaField("wDone", "Work performed", w.workPerformed || "", "Same kind of box — Wispr Flow types here when this box is selected.", "", "performed", "")}
      <div class="err" id="formErr" role="alert"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="wSave">${existing ? "Save" : "Create work order"}</button>`,
      () => {
        focusField(existing ? "wDesc" : "wTitle");
        byId("wSave").addEventListener("click", async () => {
          let title = val("wTitle").trim();
          let description = val("wDesc").trim();
          if (!title && description) title = description.split(/\n/)[0].slice(0, 80);
          if (!description && title) description = title;
          const field = byId("wDesc");
          const status = val("wStat") || "open";
          const type = val("wType");
          const result = PM.saveWo(state, {
            id: existing ? w.id : undefined,
            assetId: type === PM.GENERAL_TYPE ? "" : val("wAsset"),
            location: val("wLoc"),
            title, description, status,
            type, priority: val("wPri"), assignedTo: val("wWho"),
            dueDate: val("wDue"), downtimeHours: val("wDown"), otherCost: val("wOther"),
            requestedBy: val("wBy"), workPerformed: val("wDone"),
            source: existing ? w.source : (field.dataset.mic === "1" ? "voice" : "typed"),
            voiceTranscript: field.dataset.mic === "1" ? description : (existing ? w.voiceTranscript : ""),
            openedDate: existing ? w.openedDate : PM.today(),
            pmTaskId: existing ? w.pmTaskId : "",
            meterAt: existing ? w.meterAt : ""
          });
          await commit(result, { hash: result.ok ? "#wo/" + result.woId : "" });
        });
      });
  }

  function completeForm(w) {
    const asset = PM.assetById(state, w.assetId);
    if (!asset && w.status === "draft" && !PM.isGeneral(w)) { woForm(w); toast("Pick the equipment before completing this draft, or set the type to General / plant task."); return; }
    openSheet("Complete " + w.woNumber, `
      ${areaField("cDone", "Work performed", w.workPerformed || "", "Type or dictate what you did.", "", "performed", "")}
      ${asset && PM.isMetered(asset) ? `<div class="f"><label for="cMeter">Meter now (${esc(PM.meterWord(asset))})</label><input id="cMeter" type="number" min="0" step="any" value="${esc(PM.hasNum(asset.meter) ? asset.meter : "")}"><p class="hint">This reading feeds the next PM date.</p></div>` : ""}
      <div class="g2"><div class="f"><label for="cDown">Downtime hours</label><input id="cDown" type="number" min="0" step="0.1" value="${esc(w.downtimeHours || 0)}"></div>
        <div class="f"><label for="cDate">Completed</label><input id="cDate" type="date" value="${esc(PM.today())}"></div></div>
      ${window.Floor && Floor.shown && !Floor.shown("failure") ? "" : `<div class="g2"><div class="f"><label for="cFail">Failure code</label>${sel("cFail", w.failureCode || "", [["", "Not set"]].concat(PM.failureCodeNames(state).map(n => [n, n])))}</div>
        <div class="f"><label for="cRoot">Root cause</label><input id="cRoot" type="text" value="${esc(w.rootCause || "")}" placeholder="What actually caused it" autocomplete="on"></div></div>
      <p class="note">The code list is under Floor → Failure codes.</p>`}
      <div class="err" id="formErr" role="alert"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="cSave">Mark complete</button>`,
      () => {
        focusField("cDone");
        byId("cSave").addEventListener("click", () => commit(PM.setWoStatus(state, {
          id: w.id, status: "complete", workPerformed: val("cDone"), downtimeHours: val("cDown"),
          completedDate: val("cDate") || PM.today(), meterAt: byId("cMeter") ? val("cMeter") : "", techId: ui.me, date: val("cDate") || PM.today(),
          failureCode: byId("cFail") ? val("cFail") : w.failureCode, rootCause: byId("cRoot") ? val("cRoot") : w.rootCause
        }), { hash: "#wo/" + w.id }));
      });
  }

  function confirmCancel(w) {
    openSheet("Cancel " + w.woNumber, `<p>Cancelling returns every part on this job to the shelf. The work order stays in the history.</p><div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Keep it</button><span class="sp"></span><button class="btn danger" type="button" id="yesCancel">Cancel work order</button>`,
      () => byId("yesCancel").addEventListener("click", () => commit(PM.setWoStatus(state, { id: w.id, status: "cancelled" }), { hash: "#wo/" + w.id })));
  }

  function meterForm(assetId, woId) {
    const a = PM.assetById(state, assetId);
    if (!a) return;
    openSheet("Meter · " + a.tag, `
      <p class="note">Current: ${PM.hasNum(a.meter) ? esc(PM.num(a.meter).toLocaleString()) + " " + esc(PM.meterWord(a)) : "nothing logged yet"}.</p>
      <div class="f"><label for="mRead">Reading</label><input id="mRead" type="number" min="0" step="any" inputmode="decimal"></div>
      <div class="f"><label for="mDate">Date</label><input id="mDate" type="date" value="${esc(PM.today())}"></div>
      <div class="f"><label for="mNote">Note</label><input id="mNote" type="text" autocomplete="on"></div>
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="mSave">Save reading</button>`,
      () => {
        focusField("mRead");
        byId("mSave").addEventListener("click", () => commit(PM.saveReading(state, {
          assetId, workOrderId: woId || "", reading: val("mRead"), date: val("mDate"), notes: val("mNote"), techId: ui.me
        })));
      });
  }

  function timeForm(opts) {
    opts = opts || {};
    const wo = opts.woId && PM.woById(state, opts.woId);
    const assetId = (wo && wo.assetId) || opts.assetId || "";
    openSheet("Log time", `
      <div class="f"><label for="tWho">Tech</label>${sel("tWho", ui.me, techChoices("Choose a tech…").slice(0))}</div>
      ${wo ? `<p class="note">On ${esc(wo.woNumber)} · ${esc(wo.assetTag || (PM.isGeneral(wo) ? "No machine" : ""))} ${esc(wo.title)}</p>` : `<div class="f"><label for="tAsset">Equipment</label>${sel("tAsset", assetId, assetChoices())}</div>`}
      <div class="g2"><div class="f"><label for="tHours">Hours</label><input id="tHours" type="number" min="0" step="0.1" value="1"></div>
        <div class="f"><label for="tDate">Date</label><input id="tDate" type="date" value="${esc(PM.today())}"></div></div>
      ${areaField("tNote", "Note", "", "", "", "time-note", "What you spent the time on")}
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="tSave">Save time</button>`,
      () => {
        focusField("tHours");
        byId("tSave").addEventListener("click", () => commit(PM.saveTime(state, {
          techId: val("tWho"), workOrderId: wo ? wo.id : "", assetId: wo ? wo.assetId : val("tAsset"),
          hours: val("tHours"), date: val("tDate"), notes: val("tNote")
        })));
      });
  }

  function assetForm(existing) {
    const a = existing || { status: "Running", metered: "no", meterType: "Hours" };
    openSheet(existing ? "Edit " + a.tag : "New equipment", `
      <div class="g2"><div class="f"><label for="aTag">Tag</label><input id="aTag" data-code="1" type="text" value="${esc(a.tag || "")}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="WL-1"></div>
        <div class="f"><label for="aName">Name</label><input id="aName" type="text" value="${esc(a.name || "")}" autocomplete="on"></div></div>
      <div class="g2"><div class="f"><label for="aArea">Area</label><input id="aArea" type="text" value="${esc(a.area || "")}"></div>
        <div class="f"><label for="aType">Type</label><input id="aType" type="text" value="${esc(a.type || "")}"></div></div>
      <div class="g3"><div class="f"><label for="aMake">Make</label><input id="aMake" type="text" value="${esc(a.make || "")}"></div>
        <div class="f"><label for="aModel">Model</label><input id="aModel" type="text" value="${esc(a.model || "")}"></div>
        <div class="f"><label for="aYear">Year</label><input id="aYear" type="number" value="${esc(a.year || "")}"></div></div>
      <div class="f"><label for="aSerial">Serial</label><input id="aSerial" data-code="1" type="text" value="${esc(a.serial || "")}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div>
      <div class="g2"><div class="f"><label for="aStatus">Status</label>${sel("aStatus", a.status || "Running", PM.ASSET_STATUSES.map(s => [s, s]))}</div>
        <div class="f"><label for="aMetered">Meter</label>${sel("aMetered", a.metered === "yes" ? "yes" : "no", [["no", "No meter — calendar PM"], ["yes", "Has a meter"]])}</div></div>
      <div class="g2" id="meterBits"><div class="f"><label for="aMType">Meter type</label>${sel("aMType", a.meterType || "Hours", PM.METER_TYPES.map(s => [s, s]))}</div>
        <div class="f"><label for="aMeter">Current reading</label><input id="aMeter" type="number" min="0" step="any" value="${esc(PM.hasNum(a.meter) ? a.meter : "")}"></div></div>
      <div class="f"><label for="aNotes">Notes</label><textarea id="aNotes" rows="3">${esc(a.notes || "")}</textarea></div>
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="aSave">Save</button>`,
      () => {
        const sync = () => { byId("meterBits").style.display = val("aMetered") === "yes" ? "" : "none"; };
        byId("aMetered").addEventListener("change", sync); sync();
        focusField("aTag");
        byId("aSave").addEventListener("click", async () => {
          const result = PM.saveAsset(state, {
            id: existing && existing.id, tag: val("aTag"), name: val("aName"), area: val("aArea"), type: val("aType"),
            make: val("aMake"), model: val("aModel"), year: val("aYear"), serial: val("aSerial"), status: val("aStatus"),
            metered: val("aMetered"), meterType: val("aMType"), meter: val("aMeter"), notes: val("aNotes")
          });
          await commit(result, { hash: result.ok ? "#asset/" + result.assetId : "" });
        });
      });
  }

  function levelForm(assetId, existing) {
    const a = PM.assetById(state, assetId);
    const L = existing || { name: "", basis: "calendar", everyDays: 7, everyMeter: 0, active: "yes" };
    const presets = PM.LEVEL_PRESETS.filter(p => PM.isMetered(a) || p.basis === "calendar");
    openSheet((existing ? "Edit level" : "New level") + " · " + (a ? a.tag : ""), `
      <p class="note">${PM.isMetered(a) ? "This machine has a meter, so a level can run on hours, the calendar, or whichever comes first." : "This machine has no meter, so levels use the calendar."}</p>
      <div class="seg" id="presets">${presets.map(p => `<button type="button" data-preset="${esc(p.name)}">${esc(p.name)}</button>`).join("")}<button type="button" data-preset="">Custom</button></div>
      <div class="f"><label for="lName">Name</label><input id="lName" type="text" value="${esc(L.name || "")}"></div>
      <div class="f"><label for="lBasis">Based on</label>${sel("lBasis", L.basis || "calendar", (PM.isMetered(a) ? [["calendar", "Calendar"], ["meter", "Meter"], ["both", "Whichever comes first"]] : [["calendar", "Calendar"]]))}</div>
      <div class="g2"><div class="f" id="lDaysWrap"><label for="lDays">Every (days)</label><input id="lDays" type="number" min="0" step="1" value="${esc(L.everyDays || 0)}"></div>
        <div class="f" id="lMeterWrap"><label for="lMeter">Every (${esc(PM.meterWord(a))})</label><input id="lMeter" type="number" min="0" step="1" value="${esc(L.everyMeter || 0)}"></div></div>
      <div class="f"><label for="lActive">Active</label>${sel("lActive", L.active === "no" ? "no" : "yes", [["yes", "Active"], ["no", "Paused"]])}</div>
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="lSave">Save level</button>`,
      () => {
        const sync = () => {
          const b = val("lBasis");
          byId("lDaysWrap").style.display = b === "meter" ? "none" : "";
          byId("lMeterWrap").style.display = b === "calendar" ? "none" : "";
        };
        byId("lBasis").addEventListener("change", sync); sync();
        document.getElementById("presets").addEventListener("click", e => {
          const btn = e.target.closest("[data-preset]");
          if (!btn) return;
          const p = PM.LEVEL_PRESETS.find(x => x.name === btn.dataset.preset);
          if (!p) { focusField("lName"); return; }
          byId("lName").value = p.name;
          byId("lBasis").value = PM.isMetered(a) ? p.basis : "calendar";
          byId("lDays").value = p.everyDays;
          byId("lMeter").value = p.everyMeter;
          sync();
        });
        byId("lSave").addEventListener("click", () => commit(PM.saveLevel(state, {
          id: existing && existing.id, assetId, name: val("lName"), basis: val("lBasis"),
          everyDays: val("lDays"), everyMeter: val("lMeter"), active: val("lActive")
        }), { hash: "#asset/" + assetId }));
      });
  }

  function taskForm(assetId, existing) {
    const a = PM.assetById(state, assetId);
    const levels = state.levels.filter(l => l.assetId === assetId);
    if (!levels.length) { levelForm(assetId); toast("Add a maintenance level first."); return; }
    const t = existing || { levelId: levels[0].id, active: "yes", partsJson: "[]" };
    let lines = PM.parseParts(t.partsJson);
    const draw = () => {
      const host = byId("taskParts");
      if (!host) return;
      host.innerHTML = lines.map((line, i) => `<div class="partline"><div>${sel("tp" + i, line.partId, state.parts.map(p => [p.id, p.sku + " — " + p.name]))}</div><div class="fitrow"><input id="tq${i}" type="number" min="0" step="any" value="${esc(line.qty)}" style="width:80px" aria-label="Quantity"><button class="btn small" type="button" data-rm="${i}">Remove</button></div></div>`).join("") || `<p class="note">No parts required. That's fine for a walkaround.</p>`;
      host.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { readLines(); lines.splice(Number(b.dataset.rm), 1); draw(); }));
      host.querySelectorAll("select, input").forEach(el => el.addEventListener("change", readLines));
    };
    function readLines() {
      lines = lines.map((line, i) => ({ partId: val("tp" + i) || line.partId, qty: val("tq" + i) || line.qty }));
    }
    openSheet((existing ? "Edit PM" : "New PM") + " · " + (a ? a.tag : ""), `
      <div class="f"><label for="tLevel">Level</label>${sel("tLevel", t.levelId, levels.map(l => [l.id, l.name + " · " + PM.intervalLabel(l, a)]))}</div>
      <div class="f"><label for="tName">Task</label><input id="tName" class="dictate" data-dictate="pm-name" type="text" value="${esc(t.name || "")}" autocomplete="on"></div>
      ${areaField("tInst", "What to do", t.instructions || "", "Wispr Flow types into this box when it's selected.", "", "pm-instructions", "")}
      <div class="lbl">Parts to pull from inventory</div><div id="taskParts"></div>
      <button class="btn small" type="button" id="addLine">+ Required part</button>
      <div class="g2"><div class="f"><label for="tLast">Last done</label><input id="tLast" type="date" value="${esc(t.lastCompletedAt || "")}"></div>
        <div class="f"><label for="tLastM">Meter that day</label><input id="tLastM" type="number" min="0" step="any" value="${esc(PM.hasNum(t.lastMeter) ? t.lastMeter : "")}"></div></div>
      <div class="f"><label for="tActive">Active</label>${sel("tActive", t.active === "no" ? "no" : "yes", [["yes", "Active"], ["no", "Paused"]])}</div>
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="tSave">Save task</button>`,
      () => {
        draw();
        byId("addLine").addEventListener("click", () => { readLines(); lines.push({ partId: state.parts[0] ? state.parts[0].id : "", qty: 1 }); draw(); });
        byId("tSave").addEventListener("click", () => {
          readLines();
          commit(PM.saveTask(state, {
            id: existing && existing.id, assetId, levelId: val("tLevel"), name: val("tName"), instructions: val("tInst"),
            parts: lines.filter(l => l.partId && PM.num(l.qty) > 0), active: val("tActive"),
            lastCompletedAt: val("tLast"), lastMeter: val("tLastM")
          }), { hash: "#asset/" + assetId });
        });
      });
  }

  function partForm(existing) {
    const p = existing || {};
    openSheet(existing ? "Edit " + p.sku : "New part", `
      <div class="g2"><div class="f"><label for="pSku">Part number</label><input id="pSku" data-code="1" type="text" value="${esc(p.sku || "")}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div>
        <div class="f"><label for="pName">Name</label><input id="pName" type="text" value="${esc(p.name || "")}" autocomplete="on"></div></div>
      <div class="g2"><div class="f"><label for="pBin">Bin</label><input id="pBin" type="text" value="${esc(p.bin || "")}"></div>
        <div class="f"><label for="pVendor">Vendor</label><input id="pVendor" type="text" value="${esc(p.vendor || "")}"></div></div>
      <div class="g3"><div class="f"><label for="pCost">Unit cost</label><input id="pCost" type="number" min="0" step="0.01" value="${esc(p.unitCost || 0)}"></div>
        <div class="f"><label for="pPoint">Reorder point</label><input id="pPoint" type="number" min="0" step="any" value="${esc(p.reorderPoint || 0)}"></div>
        <div class="f"><label for="pQty">Reorder qty</label><input id="pQty" type="number" min="0" step="any" value="${esc(p.reorderQty || 0)}"></div></div>
      ${existing ? `<p class="note">On hand is ${esc(PM.num(p.onHand))}. Use Receive or Correct the count to change it.</p>` : `<div class="f"><label for="pOn">On hand now</label><input id="pOn" type="number" min="0" step="any" value="0"></div>`}
      <div class="f"><label for="pNotes">Notes</label><textarea id="pNotes" rows="2">${esc(p.notes || "")}</textarea></div>
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="pSave">Save part</button>`,
      () => {
        focusField("pSku");
        byId("pSave").addEventListener("click", async () => {
          const result = PM.savePart(state, {
            id: existing && existing.id, sku: val("pSku"), name: val("pName"), bin: val("pBin"), vendor: val("pVendor"),
            unitCost: val("pCost"), reorderPoint: val("pPoint"), reorderQty: val("pQty"),
            onHand: existing ? existing.onHand : val("pOn"), notes: val("pNotes"), description: val("pName")
          });
          await commit(result, { hash: result.ok ? "#part/" + result.partId : "" });
        });
      });
  }

  function receiveForm(id) {
    const p = PM.partById(state, id);
    openSheet("Receive " + p.sku, `<p class="note">On hand now: ${esc(PM.num(p.onHand))}. This adds to the count.</p>
      <div class="f"><label for="rQty">Quantity in</label><input id="rQty" type="number" min="0" step="any" value="1"></div>
      <div class="f"><label for="rNote">Note</label><input id="rNote" type="text" placeholder="PO or packing slip" autocomplete="on"></div>
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="rSave">Receive</button>`,
      () => byId("rSave").addEventListener("click", () => commit(PM.receiveStock(state, { partId: id, qty: val("rQty"), note: val("rNote") }), { hash: "#part/" + id })));
  }
  function adjustForm(id) {
    const p = PM.partById(state, id);
    openSheet("Correct " + p.sku, `<p>Use this after you count the bin. It replaces the on-hand number. Receiving new stock should use Receive, so two phones don't overwrite each other.</p>
      <div class="f"><label for="aOn">Counted quantity</label><input id="aOn" type="number" min="0" step="any" value="${esc(PM.num(p.onHand))}"></div>
      <div class="f"><label for="aNote">Note</label><input id="aNote" type="text" value="Physical count" autocomplete="on"></div>
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="aSave">Set count</button>`,
      () => byId("aSave").addEventListener("click", () => commit(PM.adjustStock(state, { partId: id, onHand: val("aOn"), note: val("aNote") }), { hash: "#part/" + id })));
  }

  function fitForm(assetId) {
    const a = PM.assetById(state, assetId);
    const have = new Set(state.fits.filter(f => f.assetId === assetId).map(f => f.partId));
    const choices = state.parts.filter(p => !have.has(p.id));
    if (!choices.length) { partForm(); toast("Every part is already on this machine, or there are no parts yet. Add a part, then link it."); return; }
    openSheet("Add a part to " + a.tag, `
      <div class="f"><label for="fPart">Part</label>${sel("fPart", choices[0].id, choices.map(p => [p.id, p.sku + " — " + p.name]))}</div>
      <div class="f"><label for="fNote">Where it goes on this machine</label><input id="fNote" type="text" autocomplete="on" placeholder="Turner whip hose"></div>
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><button class="btn" type="button" id="fNew">New part</button><span class="sp"></span><button class="btn primary" type="button" id="fSave">Add to this machine</button>`,
      () => {
        byId("fNew").addEventListener("click", () => partForm());
        byId("fSave").addEventListener("click", () => commit(PM.saveFit(state, { partId: val("fPart"), assetId, notes: val("fNote"), addedBy: meName() }), { hash: "#asset/" + assetId }));
      });
  }

  function makePmForm(taskId) {
    const t = PM.taskById(state, taskId);
    const info = PM.pmInfo(state, t, PM.today());
    if (info.openWoId) { location.hash = "#wo/" + info.openWoId; return; }
    const lines = PM.parseParts(t.partsJson).map(line => {
      const p = PM.partById(state, line.partId);
      return p ? `<li>${esc(line.qty)} × ${esc(p.sku)} ${esc(p.name)} — on hand ${esc(PM.num(p.onHand))}</li>` : "";
    }).join("");
    openSheet("PM work order", `
      <p><b>${esc(t.name)}</b></p>
      <p class="note">${esc(info.summary)}</p>
      ${lines ? `<p>These parts will be pulled from inventory and the cost lands on the asset:</p><ul>${lines}</ul>` : `<p>This PM doesn't list parts.</p>`}
      <div class="f"><label for="gWho">Assign to</label>${sel("gWho", ui.me, techChoices("Leave unassigned"))}</div>
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="gSave">Make work order</button>`,
      () => byId("gSave").addEventListener("click", async () => {
        const result = PM.generatePm(state, { taskId, assignedTo: val("gWho"), today: PM.today() });
        await commit(result, { hash: result.ok ? "#wo/" + result.woId : "" });
      }));
  }

  function generateDueForm() {
    const day = PM.today();
    const due = state.pmTasks.filter(t => { const info = PM.pmInfo(state, t, day); return (info.status === "due" || info.status === "overdue") && !info.openWoId; });
    if (!due.length) { toast("Nothing is due that doesn't already have a work order."); return; }
    openSheet("Generate due PMs", `<p>This opens ${due.length} work order${due.length === 1 ? "" : "s"} and pulls the parts on each task.</p><ul>${due.map(t => { const a = PM.assetById(state, t.assetId); return `<li><b>${esc(a ? a.tag : "")}</b> ${esc(t.name)}</li>`; }).join("")}</ul>
      <div class="f"><label for="gWho">Assign them to</label>${sel("gWho", ui.me, techChoices("Leave unassigned"))}</div>
      <div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><span class="sp"></span><button class="btn primary" type="button" id="gSave">Open them</button>`,
      () => byId("gSave").addEventListener("click", () => commit(PM.generateDue(state, { today: day, assignedTo: val("gWho") }), { hash: "#work" })));
  }

  function techForm(existing) {
    const t = existing || { active: "yes" };
    openSheet(existing ? "Edit " + t.name : "Add a tech", `
      <div class="g2"><div class="f"><label for="eName">Name</label><input id="eName" type="text" value="${esc(t.name || "")}" autocomplete="name"></div>
        <div class="f"><label for="eRole">Role</label><input id="eRole" type="text" value="${esc(t.role || "")}" placeholder="Millwright"></div></div>
      <div class="g2"><div class="f"><label for="ePhone">Cell</label><input id="ePhone" type="tel" value="${esc(t.phone || "")}"></div>
        <div class="f"><label for="eMail">Email</label><input id="eMail" type="email" value="${esc(t.email || "")}"></div></div>
      <div class="g2"><div class="f"><label for="eRate">Hourly rate</label><input id="eRate" type="number" min="0" step="0.01" value="${esc(t.hourlyRate || 0)}"></div>
        <div class="f"><label for="eActive">Active</label>${sel("eActive", t.active === "no" ? "no" : "yes", [["yes", "Active"], ["no", "Inactive"]])}</div></div>
      <div class="err" id="formErr"></div>`,
      `${existing ? `<button class="btn danger" type="button" id="eDel">Remove</button>` : ""}<span class="sp"></span><button class="btn" type="button" data-close>Close</button><button class="btn primary" type="button" id="eSave">Save</button>`,
      () => {
        focusField("eName");
        if (byId("eDel")) byId("eDel").addEventListener("click", async () => {
          const result = PM.deleteTech(state, t.id);
          if (ui.me === t.id) { ui.me = ""; saveUi(); }
          await commit(result, { hash: "#team" });
        });
        byId("eSave").addEventListener("click", () => commit(PM.saveTech(state, {
          id: existing && existing.id, name: val("eName"), role: val("eRole"), phone: val("ePhone"), email: val("eMail"), hourlyRate: val("eRate"), active: val("eActive")
        }), { hash: "#team" }));
      });
  }

  function askCode(wrong) {
    openSheet("Plant code", `<p class="note">Ask Randy for the plant code. You type it once on this phone. It is what keeps the shared sheet private.</p>
      <div class="f"><label for="plantCode">Plant code</label><input id="plantCode" type="password" data-secret="1" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></div>
      <div class="err" id="formErr">${wrong ? "That code didn't work." : ""}</div>`,
      `<span class="sp"></span><button class="btn primary" type="button" id="codeGo">Continue</button>`,
      () => {
        focusField("plantCode");
        const go = async () => {
          const v = val("plantCode").trim();
          if (!v) return;
          Store.saveCode(v);
          closeSheet();
          const fresh = await Store.refresh();
          if (fresh.unauthorized) { Store.saveCode(""); render(); askCode(true); return; }
          if (fresh.ok && fresh.state) { state = fresh.state; toast("Connected to the sheet."); render(); }
          else { toast("Couldn't reach the sheet yet. We'll keep trying."); render(); }
        };
        byId("codeGo").addEventListener("click", go);
        byId("plantCode").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
      });
  }

  function printWo(id) {
    const w = PM.woById(state, id);
    if (!w) return;
    const a = PM.assetById(state, w.assetId) || {};
    const c = PM.woCosts(state, w.id);
    const uses = state.uses.filter(u => u.workOrderId === w.id);
    document.getElementById("printArea").innerHTML = `<div style="font-family:Arial,sans-serif;padding:16px"><h1 style="margin:0">Work order ${esc(w.woNumber)}</h1>
      <p>${esc(w.assetTag)} ${esc(w.assetName)} · ${esc(PM.STATUS_LABEL[w.status])} · ${esc(PM.whoName(state, w) || "Unassigned")}</p>
      <p><b>${esc(w.title)}</b></p><p style="white-space:pre-wrap">${esc(w.description || "")}</p>
      <p>Parts: ${esc(uses.map(u => u.qty + " × " + u.partSku).join(", ") || "none")} · ${esc(PM.money(c.parts))}</p>
      <p>Labor ${esc(c.laborHours)} h · ${esc(PM.money(c.labor))} · Other ${esc(PM.money(c.other))} · <b>Total ${esc(PM.money(c.total))}</b></p>
      <p>Downtime ${esc(w.downtimeHours || 0)} h ${PM.isMetered(a) && PM.hasNum(w.meterAt) ? "· Meter " + esc(w.meterAt) : ""}</p>
      <p style="white-space:pre-wrap">${esc(w.workPerformed || "")}</p></div>`;
    setTimeout(() => window.print(), 50);
  }

  async function onUse(partId) {
    const r = route();
    const qtyEl = byId("qty-" + partId);
    const qty = qtyEl ? qtyEl.value : "1";
    const remember = byId("fit-" + partId);
    let result = PM.usePart(state, { workOrderId: r.id, partId, qty, techId: ui.me });
    if (result.ok && remember && remember.checked) {
      const wo = result.state.workOrders.find(w => w.id === r.id);
      const fit = PM.saveFit(result.state, { partId, assetId: wo.assetId, addedBy: meName(), notes: "Added from the work order" });
      if (fit.ok) result = { ok: true, state: fit.state, ops: result.ops.concat(fit.ops), message: result.message + " " + fit.message };
    }
    await commit(result);
  }

  let voiceSession = null;
  function stopVoiceSession() {
    if (voiceSession) {
      try { voiceSession.onend = null; voiceSession.stop(); } catch (e) {}
      voiceSession = null;
    }
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
  }
  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }
  function startVoiceWorkOrder(assetId) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast("This browser has no speech recognition, so voice work orders stay off. Type one instead."); return; }
    stopVoiceSession();
    let phase = "capture";
    let finals = "";
    let transcript = "";
    let parsed = null;
    let pauseTimer = null;
    openSheet("Voice work order", `
      <p class="note" id="voiceHint">Listening. Say the job the way you would to another tech. One tap already started the mic.</p>
      <p id="voiceHeard" class="prose"></p>
      <div id="voiceCard"></div>
      <div class="err" id="formErr" role="alert"></div>`,
      `<button class="btn" type="button" id="voiceCancel">Cancel</button><span class="sp"></span><button class="btn primary" type="button" id="voiceSave" hidden>Save</button>`,
      () => {
        byId("voiceCancel").onclick = () => { stopVoiceSession(); closeSheet(); toast("Discarded."); };
        byId("voiceSave").onclick = () => saveParsed();
      });
    function showParsed(p) {
      parsed = p;
      const card = byId("voiceCard");
      if (!card) return;
      const askMachine = p.needsAsset && !p.assetId;
      card.innerHTML = `<article class="panel"><p>Type <b>${esc(p.type)}</b></p>
        <p>${p.assetTag ? esc(p.assetTag + " " + p.assetName) : (p.type === PM.GENERAL_TYPE ? "No machine · General" : "No machine yet")}</p>
        ${askMachine ? `<div class="f"><label for="voiceAsset">Which machine?</label>${sel("voiceAsset", "", assetChoices("No machine — save as General"))}<p class="hint">Leave this blank and Save stores it as a General / plant task.</p></div>` : ""}
        ${p.location ? `<p>Location ${esc(p.location)}</p>` : ""}
        <p>${esc(p.description)}</p>
        <p>Priority ${esc(p.priority || "Normal")}${p.dueDate ? " · due " + esc(p.dueDate) : ""}</p>
        ${p.assigneeNote ? `<p>${esc(p.assigneeNote)}</p>` : ""}
        <p class="note">Say save, cancel, or change.</p></article>`;
      const hint = byId("voiceHint");
      if (hint) hint.textContent = "Say save to create it, cancel to discard, or change and then the correction.";
      const saveBtn = byId("voiceSave");
      if (saveBtn) saveBtn.hidden = false;
      speak(PM.voiceSummary(p));
    }
    function saveParsed() {
      if (!parsed) return;
      const chosen = byId("voiceAsset") ? byId("voiceAsset").value : "";
      const fields = PM.voiceSaveFields(parsed, chosen);
      stopVoiceSession();
      const result = PM.saveWo(state, {
        type: fields.type, assetId: fields.assetId, location: fields.location,
        title: fields.title, description: fields.description,
        priority: fields.priority, assignedTo: fields.assignedTo, dueDate: fields.dueDate,
        status: "open", source: "voice", voiceTranscript: fields.voiceTranscript,
        openedDate: PM.today(), requestedBy: meName()
      });
      commit(result, { hash: result.ok ? "#wo/" + result.woId : "" });
    }
    let rec;
    try { rec = new SR(); } catch (e) { toast("The mic isn't available in this browser. Type the work order instead."); return; }
    voiceSession = rec;
    rec.lang = "en-US";
    rec.interimResults = true;
    try { rec.continuous = true; } catch (e) {}
    rec.onresult = ev => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finals += (finals && !/\s$/.test(finals) ? " " : "") + piece;
        else interim += piece;
      }
      const heard = (finals + " " + interim).replace(/\s+/g, " ").trim();
      const box = byId("voiceHeard");
      if (box) box.textContent = heard;
      if (phase === "capture") {
        clearTimeout(pauseTimer);
        if (!finals.trim()) return;
        pauseTimer = setTimeout(() => {
          if (phase !== "capture" || !byId("voiceHeard")) return;
          phase = "confirm";
          transcript = finals.trim();
          finals = "";
          showParsed(PM.parseVoiceWorkOrder(transcript, state, { today: PM.today(), assetId: assetId || "" }));
        }, 1400);
      } else if (finals.trim()) {
        const said = finals.trim();
        finals = "";
        const follow = PM.applyVoiceCommand(parsed, said, state, { today: PM.today(), assetId: assetId || "" });
        if (follow.command === "save") saveParsed();
        else if (follow.command === "cancel") { stopVoiceSession(); closeSheet(); toast("Discarded."); }
        else if (follow.command === "change") {
          transcript = follow.parsed.transcript;
          showParsed(follow.parsed);
        }
      }
    };
    rec.onerror = () => { if (byId("voiceHint")) byId("voiceHint").textContent = "The mic stopped. Close this and tap Voice work order to try again."; };
    rec.onend = () => {
      if (voiceSession !== rec || !byId("voiceHeard")) return;
      try { rec.start(); } catch (e) {}
    };
    try { rec.start(); }
    catch (e) { voiceSession = null; toast("The mic isn't available. Type the work order instead."); }
  }

  view.addEventListener("click", e => {
    const btn = e.target.closest("[data-action]");
    if (!btn || !view.contains(btn)) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id || "";
    if (action === "voice-wo") startVoiceWorkOrder(id);
    else if (action === "new-wo") woForm(null, { assetId: id });
    else if (action === "edit-wo") woForm(PM.woById(state, id));
    else if (action === "complete-wo") completeForm(PM.woById(state, id));
    else if (action === "cancel-wo") confirmCancel(PM.woById(state, id));
    else if (action === "delete-draft") commit(PM.deleteDraft(state, id), { hash: "#work" });
    else if (action === "assign-me") commit(PM.saveWo(state, Object.assign({}, PM.woById(state, id), { assignedTo: ui.me })));
    else if (action === "log-time") timeForm({ woId: id });
    else if (action === "log-time-asset") timeForm({ assetId: id });
    else if (action === "log-meter") meterForm(id, btn.dataset.wo || (route().name === "wo" ? route().id : ""));
    else if (action === "use-part") onUse(id);
    else if (action === "return-use") commit(PM.returnUse(state, id));
    else if (action === "print-wo") printWo(id);
    else if (action === "new-asset") assetForm();
    else if (action === "edit-asset") assetForm(PM.assetById(state, id));
    else if (action === "add-level") levelForm(id);
    else if (action === "edit-level") { const l = PM.levelById(state, id); levelForm(l.assetId, l); }
    else if (action === "delete-level") commit(PM.deleteLevel(state, id));
    else if (action === "add-task") taskForm(id);
    else if (action === "edit-task") { const t = PM.taskById(state, id); taskForm(t.assetId, t); }
    else if (action === "add-fit") fitForm(id);
    else if (action === "remove-fit") commit(PM.deleteFit(state, id));
    else if (action === "new-part") partForm();
    else if (action === "edit-part") partForm(PM.partById(state, id));
    else if (action === "receive") receiveForm(id);
    else if (action === "adjust") adjustForm(id);
    else if (action === "delete-part") commit(PM.deletePart(state, id), { hash: "#parts" });
    else if (action === "make-pm") makePmForm(id);
    else if (action === "generate-due") generateDueForm();
    else if (action === "new-tech") techForm();
    else if (action === "edit-tech") techForm(PM.techById(state, id));
    else if (action === "delete-time") commit(PM.deleteTime(state, id));
    else if (action === "reset-sample") {
      state = Store.resetSample();
      ui.me = "";
      saveUi();
      toast("Sample data reset.");
      location.hash = "#home";
      render();
    } else if (action === "sync") {
      pullSheet({ ask: true, force: true }).then(r => {
        if (!r || r.unauthorized) return;
        if (r.ok) toast("Up to date.");
        else toast("Couldn't reach the sheet.");
      });
    }
  });

  document.getElementById("flagBtn").addEventListener("click", flagForm);
  document.getElementById("newBtn").addEventListener("click", () => woForm());
  document.addEventListener("keydown", e => { if (e.key === "Escape" && byId("scrim")) closeSheet(); });
  window.addEventListener("hashchange", render);

  function sheetStamp() {
    return [Store.unreachable, Store.authProblem, Store.pending, Store.rejected || ""].join(":");
  }
  function pullSheet(opt) {
    opt = opt || {};
    const before = sheetStamp();
    return Store.refresh(opt).then(r => {
      if (r && r.ok && r.state) state = r.state;
      if (r && r.unauthorized && opt.ask) askCode(true);
      if ((r && r.ok && r.state) || sheetStamp() !== before || opt.force) render();
      return r;
    });
  }

  const boot = Store.load();
  state = boot.state;
  if (!location.hash) location.replace("#home");
  render();
  if (boot.needsCode) askCode(false);
  else if (Store.mode === "live") pullSheet({ keepNotice: true, ask: true });

  setInterval(() => {
    if (Store.mode !== "live" || document.hidden || byId("scrim")) return;
    const ae = document.activeElement;
    if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return;
    pullSheet();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || Store.mode !== "live" || byId("scrim")) return;
    pullSheet();
  });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  window.__plant = { getState: () => state, getUi: () => ui };
})();
