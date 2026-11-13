/* Screens for the extra modules. Hidden ones stay off the menus; the page still opens from a link. */
(function () {
  const PM = () => globalThis.PM;
  function mods() { try { return JSON.parse(localStorage.getItem("pm-modules") || "{}") || {}; } catch (e) { return {}; } }
  function shown(id) { return mods()[id] !== false; }
  function setShown(id, on) {
    const m = mods();
    if (on) delete m[id]; else m[id] = false;
    localStorage.setItem("pm-modules", JSON.stringify(m));
  }
  function linkFor(id) {
    try { return location.origin + location.pathname + "#asset/" + id; } catch (e) { return "#asset/" + id; }
  }
  function qrImg(text) {
    if (!globalThis.QR) return "";
    return QR.svg(text, 2);
  }
  function compressFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Couldn't read that photo"));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 1280;
          let w = img.width, h = img.height;
          if (w > max || h > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
        img.onerror = () => reject(new Error("That file isn't a photo the phone can use"));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function chart(points, low, high) {
    if (points.length < 2) return `<p class="note">Log this twice to see a trend.</p>`;
    const vals = points.map(p => PM().num(p.value));
    const min = Math.min.apply(null, vals.concat(PM().hasNum(low) ? [PM().num(low)] : []));
    const max = Math.max.apply(null, vals.concat(PM().hasNum(high) ? [PM().num(high)] : []));
    const span = max - min || 1;
    const w = 320, h = 120, pad = 8;
    const coords = vals.map((v, i) => {
      const x = pad + (w - pad * 2) * (i / (vals.length - 1));
      const y = h - pad - (h - pad * 2) * ((v - min) / span);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    const yOf = v => (h - pad - (h - pad * 2) * ((v - min) / span)).toFixed(1);
    let guides = "";
    if (PM().hasNum(high)) guides += `<line x1="${pad}" x2="${w - pad}" y1="${yOf(PM().num(high))}" y2="${yOf(PM().num(high))}" stroke="#b42318" stroke-dasharray="3 3"/>`;
    if (PM().hasNum(low)) guides += `<line x1="${pad}" x2="${w - pad}" y1="${yOf(PM().num(low))}" y2="${yOf(PM().num(low))}" stroke="#a86a12" stroke-dasharray="3 3"/>`;
    return `<svg viewBox="0 0 ${w} ${h}" class="trend" role="img"><rect width="${w}" height="${h}" fill="transparent"/>${guides}<polyline fill="none" stroke="currentColor" stroke-width="2" points="${coords}"/></svg>`;
  }

  const Floor = {
    shown,
    routes: ["floor", "today", "scan", "labels", "room", "inspect", "schedule", "offenders", "monthly", "vendors", "settings", "codes"],
    handles(name) { return this.routes.indexOf(name) >= 0; },
    assetExtra(a, esc) {
      const bits = [];
      if (shown("qr")) bits.push(`<a class="btn" href="#labels/${esc(a.id)}">QR label</a>`);
      if (shown("down")) bits.push(`<button class="btn ${a.status === "Down" ? "primary" : "danger"}" type="button" data-floor="${a.status === "Down" ? "up" : "down"}" data-id="${esc(a.id)}">${a.status === "Down" ? "Back up" : "Machine down"}</button>`);
      return bits.join("");
    },
    assetPanels(a, esc) {
      const P = PM();
      const state = window.__floorState || { lotoPoints: [], warranties: [], outsideJobs: [], sensorLimits: [], downtimeEvents: [] };
      let html = "";
      if (shown("loto")) {
        const points = (state.lotoPoints || []).filter(p => p.assetId === a.id).sort((x, y) => P.num(x.sort) - P.num(y.sort));
        html += `<article class="panel" id="loto"><h2>Lockout / tagout</h2><p class="note">This is the sheet a tech sees after scanning the QR label.</p>
          ${points.length ? points.map(p => `<div class="partline"><div><b>${esc(p.name)}</b> <span class="pill idle">${esc(p.energy)}</span><div class="note">${esc(p.howToIsolate || "")}</div>${p.photoData ? `<img class="shot" alt="" src="${esc(p.photoData)}">` : ""}</div><button class="btn small" type="button" data-floor="del-loto" data-id="${esc(p.id)}">Remove</button></div>`).join("") : `<p class="note">No energy sources listed yet.</p>`}
          <button class="btn" type="button" data-floor="add-loto" data-id="${esc(a.id)}">+ Isolation point</button></article>`;
      }
      if (shown("warranty")) {
        const wars = (state.warranties || []).filter(w => w.assetId === a.id);
        const jobs = (state.outsideJobs || []).filter(j => j.assetId === a.id);
        html += `<article class="panel"><h2>Vendor and warranty</h2>
          ${wars.map(w => `<div class="partline"><div><b>${esc(w.what)}</b><div class="note">${esc(w.vendor || "")} · until ${esc(w.expires || "—")}</div></div></div>`).join("") || `<p class="note">No warranty on file.</p>`}
          <button class="btn" type="button" data-floor="add-warranty" data-id="${esc(a.id)}">+ Warranty</button>
          <h3>Outside service</h3>
          ${jobs.map(j => `<div class="partline"><div><b>${esc(j.vendor)}</b> ${esc(j.status)}<div class="note">${j.estimate ? "Est " + esc(j.estimate) + " · " : ""}${j.po ? "PO " + esc(j.po) + " · " : ""}${j.cost !== "" ? esc(P.money(j.cost)) : ""}</div></div></div>`).join("") || `<p class="note">No outside jobs.</p>`}
          <button class="btn" type="button" data-floor="add-outside" data-id="${esc(a.id)}">+ Outside job</button></article>`;
      }
      if (shown("room") || shown("sensors")) {
        const limits = (state.sensorLimits || []).filter(l => l.assetId === a.id);
        html += `<article class="panel"><h2>Readings and limits</h2>
          ${limits.map(l => `<div class="partline"><div><b>${esc(l.name)}</b><div class="note">${esc(l.low)} – ${esc(l.high)} ${esc(l.unit || "")}</div>${chart((state.sensorLogs || []).filter(x => x.assetId === a.id && x.name === l.name), l.low, l.high)}</div></div>`).join("") || `<p class="note">No limits yet. The compressor room uses these too.</p>`}
          <div class="actions"><button class="btn" type="button" data-floor="add-limit" data-id="${esc(a.id)}">+ Limit</button><button class="btn" type="button" data-floor="log-sensor" data-id="${esc(a.id)}">Log a reading</button></div></article>`;
      }
      return html;
    },
    photoPanel(w, esc) {
      if (!shown("photos")) return "";
      const photos = ((window.__floorState || {}).photos || []).filter(p => p.workOrderId === w.id);
      return `<article class="panel"><h2>Photos</h2><p class="note">Before, after, nameplate, or a part number. Pictures are compressed on the phone. With the sheet connected they go to a Drive folder named Plant Maintenance Photos. If Drive isn't available, a small copy is kept on the sheet.</p>
        <div class="shots">${photos.map(p => `<figure><img class="shot" alt="${esc(p.kind)}" src="${esc(p.url || p.dataUrl)}"><figcaption>${esc(p.kind)}</figcaption></figure>`).join("") || `<p class="note">No photos yet.</p>`}</div>
        <div class="g2"><div class="f"><label for="photoKind">Kind</label><select id="photoKind"><option value="before">Before</option><option value="after">After</option><option value="nameplate">Nameplate</option><option value="part">Part number</option><option value="other">Other</option></select></div>
          <div class="f"><label for="photoFile">Picture</label><input id="photoFile" type="file" accept="image/*" capture="environment"></div></div>
        <button class="btn" type="button" data-floor="add-photo" data-id="${esc(w.id)}" data-asset="${esc(w.assetId || "")}">Save photo</button></article>`;
    },
    render(ctx) {
      window.__floorState = ctx.state;
      this._ctx = ctx;
      const name = ctx.route.name;
      const id = ctx.route.id;
      const fn = {
        floor: hub, today: today, scan: scan, labels: labels, room: room, inspect: inspect,
        schedule: schedule, offenders: offenders, monthly: monthly, vendors: vendors, settings: settings, codes: codes
      }[name];
      if (fn) fn(ctx, id);
    },
    async onAction(action, btn) {
      const ctx = this._ctx;
      if (!ctx) return;
      const id = btn.dataset.id || "";
      const P = PM();
      if (action === "down") {
        const result = P.machineDown(ctx.state, { assetId: id, note: "Marked down from the phone" });
        const ok = await ctx.commit(result);
        if (ok && result.notify) ctx.notify(result.state.assets.find(a => a.id === id).tag + " is down", (result.state.assets.find(a => a.id === id).tag) + " was marked down. The downtime clock is running.");
      } else if (action === "up") {
        await ctx.commit(P.machineUp(ctx.state, { assetId: id }));
      } else if (action === "add-loto") lotoForm(ctx, id);
      else if (action === "del-loto") await ctx.commit(P.deleteLoto(ctx.state, id));
      else if (action === "add-warranty") warrantyForm(ctx, id);
      else if (action === "add-outside") outsideForm(ctx, id);
      else if (action === "add-limit") limitForm(ctx, id);
      else if (action === "log-sensor") sensorForm(ctx, id);
      else if (action === "add-photo") savePhoto(ctx, id, btn.dataset.asset);
      else if (action === "run-inspect") location.hash = "#inspect/" + id;
      else if (action === "assign") assignForm(ctx, btn.dataset.date, btn.dataset.tech);
      else if (action === "unschedule") await ctx.commit(P.deleteSchedule(ctx.state, id));
    }
  };

  function hub(ctx) {
    const cards = [
      ["today", "#today", "Today", "Overdue PMs, down machines, late jobs, low stock."],
      ["qr", "#scan", "Scan a QR", "Open the machine the label is stuck on."],
      ["qr", "#labels", "Print QR labels", "One label, or a sheet of them."],
      ["down", "#assets", "Machine down", "Open the machine and tap Machine down. The clock starts."],
      ["room", "#room", "Compressor room", "Pressure, temps, dew point, drains, run hours."],
      ["inspect", "#inspect", "Inspections", "Daily rounds. A failed line opens a work order."],
      ["schedule", "#schedule", "Weekly schedule", "Tap a day to put a job on a tech."],
      ["repeat", "#offenders", "Repeat offenders", "Most jobs, downtime, and cost. 30 or 90 days."],
      ["monthly", "#monthly", "Monthly one-pager", "Uptime, PM compliance, cost by area. Print to PDF."],
      ["warranty", "#vendors", "Vendors and warranty", "Expiration alerts and outside repairs."],
      ["failure", "#codes", "Failure codes", "The list techs pick when they close a job."],
      ["kits", "#parts", "Reorder list", "On Parts, or download the CSV from Repeat / Parts."],
      ["sensors", "#room", "Sensor tie-in", "ESP32 posts a reading. Out of range flags here."],
      ["digest", "#settings", "Morning digest", "Set the email. The script sends it after you install the trigger."]
    ].filter(([mod]) => shown(mod));
    ctx.view.innerHTML = `<h2 class="title">Floor tools</h2><p class="note">These are all on so you can see them. Hide any you don't want under Settings.</p>
      <div class="cards">${cards.map(([, href, title, note]) => `<a class="card" href="${href}"><span class="title">${ctx.esc(title)}</span><span class="note">${ctx.esc(note)}</span></a>`).join("")}
      <a class="card" href="#settings"><span class="title">Settings</span><span class="note">Hide modules, digest email, alert email.</span></a></div>`;
  }
  function voiceBtn(assetId) {
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!SR || !shown("voicewo")) return "";
    return `<button class="btn primary voice-wo" type="button" data-action="voice-wo" data-id="${assetId || ""}">Voice work order</button>`;
  }
  function today(ctx) {
    const b = PM().todayBrief(ctx.state, PM().today());
    const row = (href, html) => `<a class="list-link" href="${href}">${html}</a>`;
    ctx.view.innerHTML = `<p class="back"><a href="#floor">Floor tools</a></p>${voiceBtn("")}<article class="panel"><h2>Today</h2>
      <h3>Down</h3>${b.down.length ? b.down.map(a => row("#asset/" + ctx.esc(a.id), `<span><b>${ctx.esc(a.tag)}</b> ${ctx.esc(a.name)}</span><span>${a.since ? "since " + ctx.esc(a.since.slice(11, 16)) : ""}</span>`)).join("") : `<p class="note">Nothing is down.</p>`}
      <h3>Overdue or due PMs</h3>${b.pms.length ? b.pms.map(p => row("#pm", `<span>${ctx.esc(p.tag)} ${ctx.esc(p.name)}</span><span>${ctx.esc(p.info.status)}</span>`)).join("") : `<p class="note">None.</p>`}
      <h3>Late work orders</h3>${b.late.length ? b.late.map(w => row("#wo/" + ctx.esc(w.id), `<span>${ctx.esc(w.woNumber)} ${ctx.esc(w.title)}</span><span>${ctx.esc(w.dueDate)}</span>`)).join("") : `<p class="note">None late.</p>`}
      <h3>Low stock</h3>${b.low.length ? b.low.map(p => row("#part/" + ctx.esc(p.id), `<span>${ctx.esc(p.sku)} ${ctx.esc(p.name)}</span><span>${p.onHand} / ${p.reorderPoint}</span>`)).join("") : `<p class="note">Stock is above the reorder points.</p>`}
      <h3>Warranties</h3>${b.expiring.length ? b.expiring.map(w => `<p class="note">${ctx.esc(w.tag)} ${ctx.esc(w.what)} · ${ctx.esc(w.expires)}${w.overdue ? " (past)" : ""}</p>`).join("") : `<p class="note">None expiring in the next 30 days.</p>`}
    </article>`;
  }
  function scan(ctx) {
    ctx.view.innerHTML = `<p class="back"><a href="#floor">Floor tools</a></p><article class="panel"><h2>Scan a QR label</h2>
      <p class="note">On Chrome for Android this uses the camera. Anywhere else, type the tag or paste the link the label opens.</p>
      <video id="scanVideo" playsinline autoplay muted style="width:100%;max-height:280px;background:#111;border-radius:6px"></video>
      <p id="scanMsg" class="note"></p>
      <div class="f"><label for="scanTag">Or type the tag</label><input id="scanTag" type="text" autocomplete="on" placeholder="WL-1"></div>
      <button class="btn primary" type="button" id="scanGo">Open machine</button></article>`;
    const msg = document.getElementById("scanMsg");
    const go = (text) => {
      const hash = (text || "").split("#")[1];
      if (hash && hash.indexOf("asset/") === 0) { location.hash = "#" + hash; return; }
      const tag = String(text || "").trim().toLowerCase();
      const asset = ctx.state.assets.find(a => a.tag.toLowerCase() === tag);
      if (asset) location.hash = "#asset/" + asset.id;
      else ctx.toast("No machine tagged " + text);
    };
    document.getElementById("scanGo").onclick = () => go(document.getElementById("scanTag").value);
    const video = document.getElementById("scanVideo");
    if (!navigator.mediaDevices || !window.BarcodeDetector) {
      video.hidden = true;
      msg.textContent = "This browser has no live QR scanner. Type the tag, or just open the link if you tapped the printed label.";
      return;
    }
    const det = new BarcodeDetector({ formats: ["qr_code"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }).then(stream => {
      video.srcObject = stream;
      const tick = async () => {
        if (!document.body.contains(video)) { stream.getTracks().forEach(t => t.stop()); return; }
        try {
          const codes = await det.detect(video);
          if (codes && codes[0]) { stream.getTracks().forEach(t => t.stop()); go(codes[0].rawValue); return; }
        } catch (e) {}
        requestAnimationFrame(tick);
      };
      video.onloadedmetadata = () => tick();
    }).catch(() => { video.hidden = true; msg.textContent = "Camera permission was blocked. Type the tag instead."; });
  }
  function labels(ctx, id) {
    const list = id ? ctx.state.assets.filter(a => a.id === id) : ctx.state.assets.slice().sort((a, b) => String(a.tag).localeCompare(String(b.tag), undefined, { numeric: true }));
    ctx.view.innerHTML = `<p class="back"><a href="#floor">Floor tools</a></p><div class="toolbar"><p class="note" style="flex:1;margin:0">${id ? "One label." : "A sheet of labels. Use the browser print dialog and pick Save as PDF if you want a file."}</p><button class="btn primary" type="button" id="printLabels">Print</button></div>
      <div class="labels" id="labelSheet">${list.map(a => `<article class="label"><div class="qr">${qrImg(linkFor(a.id))}</div><div><b>${ctx.esc(a.tag)}</b><div>${ctx.esc(a.name)}</div><div class="note">${ctx.esc(a.area || "")}</div></div></article>`).join("")}</div>`;
    document.getElementById("printLabels").onclick = () => {
      document.getElementById("printArea").innerHTML = document.getElementById("labelSheet").outerHTML;
      setTimeout(() => window.print(), 50);
    };
  }
  function room(ctx) {
    const P = PM();
    const assets = ctx.state.assets.filter(a => (ctx.state.sensorLimits || []).some(l => l.assetId === a.id) || /air|compress/i.test(a.area + a.type + a.name));
    ctx.view.innerHTML = `<p class="back"><a href="#floor">Floor tools</a></p><article class="panel"><h2>Compressor room</h2>
      <p class="note">Pressure, temperature, dryer dew point, drains, and run hours. A reading outside the limits is flagged. An ESP32 can post the same numbers.</p>
      ${assets.map(a => {
        const limits = (ctx.state.sensorLimits || []).filter(l => l.assetId === a.id);
        return `<h3><a href="#asset/${ctx.esc(a.id)}">${ctx.esc(a.tag)}</a> ${ctx.esc(a.name)}</h3>` + (limits.length ? limits.map(l => {
          const logs = (ctx.state.sensorLogs || []).filter(x => x.assetId === a.id && x.name === l.name);
          const last = logs[logs.length - 1];
          const flag = last && last.flag && last.flag !== "ok";
          return `<div class="partline"><div><b>${ctx.esc(l.name)}</b> ${last ? ctx.esc(last.value) + " " + ctx.esc(l.unit || "") : "—"} ${flag ? `<span class="pill bad">${ctx.esc(last.flag)}</span>` : ""}<div class="note">Limit ${ctx.esc(l.low)} – ${ctx.esc(l.high)} ${ctx.esc(l.unit || "")}</div>${chart(logs, l.low, l.high)}</div><button class="btn small" type="button" data-floor="log-sensor" data-id="${ctx.esc(a.id)}">Log</button></div>`;
        }).join("") : `<p class="note">Add limits on the machine page.</p>`);
      }).join("") || `<p class="note">No compressor readings yet.</p>`}
    </article>`;
  }
  function inspect(ctx, id) {
    const P = PM();
    if (!id) {
      const templates = ctx.state.checkTemplates || [];
      ctx.view.innerHTML = `<p class="back"><a href="#floor">Floor tools</a></p><div class="toolbar"><button class="btn primary" type="button" id="newCheck">+ Checklist</button></div>
        <div class="cards">${templates.map(t => `<article class="card"><span class="title">${ctx.esc(t.name)}</span><span class="note">${(ctx.state.checkItems || []).filter(i => i.templateId === t.id).length} lines</span><button class="btn" type="button" data-floor="run-inspect" data-id="${ctx.esc(t.id)}">Run it</button></article>`).join("") || `<p class="note">No checklists yet.</p>`}</div>`;
      document.getElementById("newCheck").onclick = () => templateForm(ctx);
      return;
    }
    const template = (ctx.state.checkTemplates || []).find(t => t.id === id);
    if (!template) { ctx.view.innerHTML = `<p class="note">Checklist not found.</p>`; return; }
    const items = (ctx.state.checkItems || []).filter(i => i.templateId === id).sort((a, b) => P.num(a.sort) - P.num(b.sort));
    ctx.view.innerHTML = `<p class="back"><a href="#inspect">Inspections</a></p><article class="panel"><h2>${ctx.esc(template.name)}</h2>
      <div class="f"><label for="inspAsset">Machine</label>${ctx.sel("inspAsset", template.assetId, ctx.assetChoices())}</div>
      ${items.map(item => `<div class="f"><span class="lbl">${ctx.esc(item.text)}</span><div class="seg" data-item="${ctx.esc(item.id)}" data-text="${ctx.esc(item.text)}">
        <button type="button" data-res="pass" aria-pressed="true">Pass</button><button type="button" data-res="fail">Fail</button><button type="button" data-res="na">N/A</button>
      </div><input type="text" data-note="${ctx.esc(item.id)}" placeholder="Note if it failed" autocomplete="on"></div>`).join("")}
      <button class="btn primary" type="button" id="inspSave">Save inspection</button><div class="err" id="formErr"></div></article>`;
    ctx.view.querySelectorAll(".seg").forEach(seg => seg.querySelectorAll("button").forEach(b => b.onclick = () => {
      seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    }));
    document.getElementById("inspSave").onclick = async () => {
      const lines = items.map(item => {
        const seg = ctx.view.querySelector('[data-item="' + item.id + '"] button[aria-pressed="true"]');
        const note = ctx.view.querySelector('[data-note="' + item.id + '"]');
        return { itemId: item.id, text: item.text, result: seg ? seg.dataset.res : "pass", note: note ? note.value : "" };
      });
      const result = P.submitInspection(ctx.state, { templateId: id, assetId: document.getElementById("inspAsset").value, techId: ctx.ui.me, lines, date: P.today() });
      await ctx.commit(result, { hash: "#inspect" });
    };
  }
  function schedule(ctx) {
    const P = PM();
    const start = P.startOfWeek(P.today());
    const days = [0, 1, 2, 3, 4, 5, 6].map(n => P.addDays(start, n));
    const techs = ctx.sortedTechs();
    ctx.view.innerHTML = `<p class="back"><a href="#floor">Floor tools</a></p><article class="panel"><h2>This week</h2><p class="note">Tap a cell to put an open job on that tech and that day.</p>
      <div class="board">${["Tech"].concat(days).map(d => `<div class="board-h">${d === "Tech" ? "Tech" : ctx.esc(P.fmtShort(d))}</div>`).join("")}
      ${techs.map(t => `<div class="board-name">${ctx.esc(t.name)}</div>` + days.map(d => {
        const items = (ctx.state.schedules || []).filter(s => s.techId === t.id && s.date === d);
        return `<button class="board-cell" type="button" data-floor="assign" data-date="${ctx.esc(d)}" data-tech="${ctx.esc(t.id)}">${items.map(s => {
          const wo = s.workOrderId && P.woById(ctx.state, s.workOrderId);
          return `<span>${ctx.esc(wo ? wo.woNumber : "PM")}</span>`;
        }).join("<br>") || "+"}</button>`;
      }).join("")).join("")}</div>
      ${(ctx.state.schedules || []).slice(0, 12).map(s => `<div class="partline"><div>${ctx.esc(s.date)} · ${ctx.esc((ctx.state.techs.find(t => t.id === s.techId) || {}).name || "")}</div><button class="btn small" type="button" data-floor="unschedule" data-id="${ctx.esc(s.id)}">Remove</button></div>`).join("")}
    </article>`;
  }
  function offenders(ctx) {
    const P = PM();
    const span = (ctx.ui.span === 30) ? 30 : 90;
    const rows = P.repeatOffenders(ctx.state, P.today(), span);
    ctx.view.innerHTML = `<p class="back"><a href="#floor">Floor tools</a></p><div class="toolbar"><button class="chip" type="button" id="span30" aria-pressed="${span === 30}">30 days</button><button class="chip" type="button" id="span90" aria-pressed="${span === 90}">90 days</button>
      <button class="btn" type="button" id="reorderCsv">Reorder CSV</button></div>
      <article class="panel"><h2>Repeat offenders</h2><div class="tbl-wrap"><table><thead><tr><th>Asset</th><th class="num">Jobs</th><th class="num">Downtime h</th><th class="num">Cost</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.id ? `<a href="#asset/${ctx.esc(r.id)}">${ctx.esc(r.tag)}</a>` : ctx.esc(r.tag)} ${ctx.esc(r.name)}</td><td class="num">${r.woCount}</td><td class="num">${r.downtime}</td><td class="num">${ctx.esc(P.money(r.cost))}</td></tr>`).join("") || `<tr><td colspan="4">Nothing in this window.</td></tr>`}
      </tbody></table></div></article>`;
    document.getElementById("span30").onclick = () => { ctx.ui.span = 30; offenders(ctx); };
    document.getElementById("span90").onclick = () => { ctx.ui.span = 90; offenders(ctx); };
    document.getElementById("reorderCsv").onclick = () => ctx.download("reorder-list.csv", P.reorderCsv(ctx.state));
  }
  function monthly(ctx) {
    const P = PM();
    const r = P.monthlyOnePager(ctx.state, P.today());
    ctx.view.innerHTML = `<p class="back no-print"><a href="#floor">Floor tools</a></p><div class="toolbar no-print"><button class="btn primary" type="button" id="printMonth">Print / PDF</button></div>
      <article class="panel" id="onePager"><h2>Monthly one-pager</h2><p class="note">${ctx.esc(P.fmtDate(r.from))} – ${ctx.esc(P.fmtDate(r.day))}</p>
      <div class="costline"><div>Uptime<b>${r.uptime}%</b></div><div>PM compliance<b>${r.compliance}%</b></div><div>Cost<b>${ctx.esc(P.money(r.spend.total))}</b></div><div>Downtime<b>${r.spend.downtime} h</b></div></div>
      <h3>Cost by area</h3><div class="tbl-wrap"><table><thead><tr><th>Area</th><th class="num">Jobs</th><th class="num">Cost</th></tr></thead><tbody>
      ${r.areas.map(a => `<tr><td>${ctx.esc(a.area)}</td><td class="num">${a.wos}</td><td class="num">${ctx.esc(P.money(a.cost))}</td></tr>`).join("") || `<tr><td colspan="3">No spend this month.</td></tr>`}</tbody></table></div>
      <h3>Top offenders</h3><div class="tbl-wrap"><table><thead><tr><th>Asset</th><th class="num">Jobs</th><th class="num">Down h</th><th class="num">Cost</th></tr></thead><tbody>
      ${r.offenders.map(o => `<tr><td>${ctx.esc(o.tag)} ${ctx.esc(o.name)}</td><td class="num">${o.woCount}</td><td class="num">${o.downtime}</td><td class="num">${ctx.esc(P.money(o.cost))}</td></tr>`).join("")}</tbody></table></div>
      <p class="note">${r.pmOk} of ${r.pmCount} PM tasks are currently on time.</p></article>`;
    document.getElementById("printMonth").onclick = () => {
      document.getElementById("printArea").innerHTML = document.getElementById("onePager").outerHTML;
      setTimeout(() => window.print(), 50);
    };
  }
  function vendors(ctx) {
    const alerts = PM().warrantyAlerts(ctx.state, PM().today());
    ctx.view.innerHTML = `<p class="back"><a href="#floor">Floor tools</a></p><article class="panel"><h2>Warranties coming due</h2>
      ${alerts.length ? alerts.map(w => `<a class="list-link" href="#asset/${ctx.esc((ctx.state.warranties.find(x => x.id === w.id) || {}).assetId || "")}"><span>${ctx.esc(w.tag)} ${ctx.esc(w.what)}</span><span>${ctx.esc(w.expires)}</span></a>`).join("") : `<p class="note">Nothing expires in the next 30 days.</p>`}
      <h3>Outside service</h3>
      ${(ctx.state.outsideJobs || []).map(j => `<div class="partline"><div><b>${ctx.esc(j.vendor)}</b> ${ctx.esc(j.status)}<div class="note">${ctx.esc(j.estimate)} ${ctx.esc(j.po)} ${j.cost !== "" ? ctx.esc(PM().money(j.cost)) : ""}</div></div></div>`).join("") || `<p class="note">None logged.</p>`}
    </article>`;
  }
  function codes(ctx) {
    const names = PM().failureCodeNames(ctx.state);
    const rows = ctx.state.failureCodes || [];
    ctx.view.innerHTML = `<p class="back"><a href="#floor">Floor tools</a></p><article class="panel"><h2>Failure codes</h2><p class="note">Techs pick one of these when they complete a work order. Add or retire a code here.</p>
      ${rows.length ? rows.map(c => `<div class="partline"><div><b>${ctx.esc(c.name)}</b>${c.active === "no" ? " · paused" : ""}</div><button class="btn small" type="button" data-floor="del-code" data-id="${ctx.esc(c.id)}">Remove</button></div>`).join("") : `<p class="note">Using the built-in list until you save your own: ${ctx.esc(names.join(", "))}.</p>`}
      <div class="fitrow"><input id="codeName" type="text" placeholder="New code" autocomplete="on"><button class="btn" type="button" id="addCode">Add</button></div></article>`;
    ctx.view.querySelectorAll("[data-floor='del-code']").forEach(b => b.onclick = () => ctx.commit(PM().deleteFailureCode(ctx.state, b.dataset.id)));
    document.getElementById("addCode").onclick = () => ctx.commit(PM().saveFailureCode(ctx.state, { name: document.getElementById("codeName").value }));
  }
  function settings(ctx) {
    const s = PM().plantSettings(ctx.state);
    const speechHere = !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
    ctx.view.innerHTML = `<p class="back"><a href="#floor">Floor tools</a></p><article class="panel"><h2>What to show</h2><p class="note">Turn off a module you don't want on the menus. Nothing is deleted.</p>
      ${speechHere ? "" : `<p class="note">This browser has no speech recognition, so Voice work order and the Mic buttons on text boxes stay hidden. Chrome and Edge have it. You can still type every box, and Wispr Flow still types into whichever box is selected.</p>`}
      <div class="checks">${PM().MODULES.map(([id, label, note]) => `<label><input type="checkbox" data-mod="${ctx.esc(id)}" ${shown(id) ? "checked" : ""}> ${ctx.esc(label)} <span class="note">${ctx.esc(note)}</span></label>`).join("")}</div></article>
      <article class="panel"><h2>Email</h2><p class="note">The morning digest and the machine-down alert use these addresses. They send only after you redeploy Code.gs and run installDigestTrigger once (see the README). The plant code is not in the email.</p>
      <div class="f"><label for="digestEmail">Digest email</label><input id="digestEmail" type="email" value="${ctx.esc(s.digestEmail || "")}"></div>
      <div class="g2"><div class="f"><label for="digestHour">Hour (0–23)</label><input id="digestHour" type="number" min="0" max="23" value="${ctx.esc(s.digestHour || "6")}"></div>
        <div class="f"><label for="alertEmail">Down / out-of-range email</label><input id="alertEmail" type="email" value="${ctx.esc(s.alertEmail || "")}"></div></div>
      <button class="btn primary" type="button" id="saveMail">Save email settings</button></article>`;
    ctx.view.querySelectorAll("[data-mod]").forEach(box => box.onchange = () => { setShown(box.dataset.mod, box.checked); ctx.toast(box.checked ? "Showing that module." : "Hidden from the menus."); ctx.paint && ctx.paint(); });
    document.getElementById("saveMail").onclick = () => ctx.commit(PM().saveSettings(ctx.state, {
      digestEmail: document.getElementById("digestEmail").value,
      digestHour: document.getElementById("digestHour").value,
      alertEmail: document.getElementById("alertEmail").value
    }));
  }

  function lotoForm(ctx, assetId) {
    ctx.openSheet("Isolation point", `<div class="f"><label for="lName">Name</label><input id="lName" type="text" placeholder="Main disconnect"></div>
      <div class="f"><label for="lEnergy">Energy</label><select id="lEnergy"><option>electrical</option><option>pneumatic</option><option>hydraulic</option><option>gravity</option><option>thermal</option><option>other</option></select></div>
      <div class="f"><label for="lHow">How to isolate</label><textarea id="lHow" rows="3"></textarea></div><div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><button class="btn primary" type="button" id="lSave">Save</button>`,
      () => document.getElementById("lSave").onclick = () => ctx.commit(PM().saveLoto(ctx.state, { assetId, name: document.getElementById("lName").value, energy: document.getElementById("lEnergy").value, howToIsolate: document.getElementById("lHow").value })));
  }
  function warrantyForm(ctx, assetId) {
    ctx.openSheet("Warranty", `<div class="f"><label for="wWhat">What is covered</label><input id="wWhat" type="text"></div>
      <div class="g2"><div class="f"><label for="wVendor">Vendor</label><input id="wVendor" type="text"></div><div class="f"><label for="wExp">Expires</label><input id="wExp" type="date"></div></div><div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><button class="btn primary" type="button" id="wSaveW">Save</button>`,
      () => document.getElementById("wSaveW").onclick = () => ctx.commit(PM().saveWarranty(ctx.state, { assetId, what: document.getElementById("wWhat").value, vendor: document.getElementById("wVendor").value, expires: document.getElementById("wExp").value })));
  }
  function outsideForm(ctx, assetId) {
    ctx.openSheet("Outside service", `<div class="f"><label for="oVendor">Vendor</label><input id="oVendor" type="text"></div>
      <div class="g2"><div class="f"><label for="oEst">Estimate #</label><input id="oEst" type="text"></div><div class="f"><label for="oPo">PO</label><input id="oPo" type="text"></div></div>
      <div class="g2"><div class="f"><label for="oCost">Cost</label><input id="oCost" type="number" min="0" step="0.01"></div>
        <div class="f"><label for="oStat">Status</label><select id="oStat"><option>quoted</option><option>approved</option><option>in shop</option><option>back</option><option>closed</option></select></div></div><div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><button class="btn primary" type="button" id="oSave">Save</button>`,
      () => document.getElementById("oSave").onclick = () => ctx.commit(PM().saveOutsideJob(ctx.state, { assetId, vendor: document.getElementById("oVendor").value, estimate: document.getElementById("oEst").value, po: document.getElementById("oPo").value, cost: document.getElementById("oCost").value, status: document.getElementById("oStat").value, openedDate: PM().today() })));
  }
  function limitForm(ctx, assetId) {
    ctx.openSheet("Reading limit", `<div class="f"><label for="limName">Name</label><input id="limName" type="text" placeholder="Discharge pressure"></div>
      <div class="g3"><div class="f"><label for="limUnit">Unit</label><input id="limUnit" type="text" placeholder="psi"></div>
        <div class="f"><label for="limLow">Low</label><input id="limLow" type="number" step="any"></div>
        <div class="f"><label for="limHigh">High</label><input id="limHigh" type="number" step="any"></div></div><div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><button class="btn primary" type="button" id="limSave">Save</button>`,
      () => document.getElementById("limSave").onclick = () => ctx.commit(PM().saveLimit(ctx.state, { assetId, name: document.getElementById("limName").value, unit: document.getElementById("limUnit").value, low: document.getElementById("limLow").value, high: document.getElementById("limHigh").value })));
  }
  function sensorForm(ctx, assetId) {
    const names = (ctx.state.sensorLimits || []).filter(l => l.assetId === assetId).map(l => l.name);
    ctx.openSheet("Log a reading", `<div class="f"><label for="sName">Reading</label><input id="sName" type="text" list="sNames" value="${ctx.esc(names[0] || "")}"><datalist id="sNames">${names.map(n => `<option value="${ctx.esc(n)}">`).join("")}</datalist></div>
      <div class="g2"><div class="f"><label for="sVal">Value</label><input id="sVal" type="number" step="any"></div>
        <div class="f"><label for="sType">Type</label><select id="sType"><option value="pressure">pressure</option><option value="temp">temperature</option><option value="dewpoint">dew point</option><option value="drain">drain check</option><option value="hours">run hours</option><option value="other">other</option></select></div></div><div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><button class="btn primary" type="button" id="sSave">Save</button>`,
      () => document.getElementById("sSave").onclick = async () => {
        const result = PM().ingestSensor(ctx.state, { assetId, name: document.getElementById("sName").value, value: document.getElementById("sVal").value, type: document.getElementById("sType").value, source: "manual", date: PM().today() });
        const ok = await ctx.commit(result);
        if (ok && result.flag && result.flag !== "ok") ctx.notify("Reading out of range", result.message);
      });
  }
  function templateForm(ctx) {
    ctx.openSheet("New checklist", `<div class="f"><label for="cName">Name</label><input id="cName" type="text" placeholder="Daily compressor round"></div>
      <div class="f"><label for="cAsset">Machine (optional)</label>${ctx.sel("cAsset", "", ctx.assetChoices("Any machine"))}</div>
      <div class="f"><label for="cLines">Lines, one per row</label><textarea id="cLines" rows="6" placeholder="Discharge pressure in range&#10;Drains blown"></textarea></div><div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><button class="btn primary" type="button" id="cSaveT">Save</button>`,
      () => document.getElementById("cSaveT").onclick = () => ctx.commit(PM().saveTemplate(ctx.state, { name: document.getElementById("cName").value, assetId: document.getElementById("cAsset").value, items: document.getElementById("cLines").value.split(/\n/) })));
  }
  function assignForm(ctx, date, techId) {
    const open = ctx.state.workOrders.filter(w => w.status !== "complete" && w.status !== "cancelled" && w.status !== "draft");
    ctx.openSheet("Assign " + date, `<div class="f"><label for="aWo">Work order</label><select id="aWo">${open.map(w => `<option value="${ctx.esc(w.id)}">${ctx.esc(w.woNumber)} ${ctx.esc(w.title)}</option>`).join("")}</select></div><div class="err" id="formErr"></div>`,
      `<button class="btn" type="button" data-close>Close</button><button class="btn primary" type="button" id="aSave">Put it on this day</button>`,
      () => document.getElementById("aSave").onclick = () => ctx.commit(PM().saveSchedule(ctx.state, { date, techId, workOrderId: document.getElementById("aWo").value })));
  }
  async function savePhoto(ctx, woId, assetId) {
    const file = document.getElementById("photoFile") && document.getElementById("photoFile").files[0];
    if (!file) { ctx.toast("Choose a photo first."); return; }
    let dataUrl = "";
    try { dataUrl = await compressFile(file); } catch (e) { ctx.toast(e.message); return; }
    let stored = { dataUrl, url: "", driveFileId: "" };
    if (ctx.Store.mode === "live" && ctx.uploadPhoto) {
      try {
        const up = await ctx.uploadPhoto(dataUrl, file.name || "photo");
        if (up && up.driveFileId) stored = { dataUrl: "", url: up.url || "", driveFileId: up.driveFileId };
        else if (up && up.fallback) stored = { dataUrl: up.dataUrl || dataUrl, url: "", driveFileId: "" };
      } catch (e) { stored = { dataUrl, url: "", driveFileId: "" }; }
    }
    await ctx.commit(PM().addPhoto(ctx.state, { workOrderId: woId, assetId, kind: document.getElementById("photoKind").value, name: file.name, dataUrl: stored.dataUrl, url: stored.url, driveFileId: stored.driveFileId, techId: ctx.ui.me }));
  }

  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-floor]");
    if (!btn) return;
    Floor.onAction(btn.dataset.floor, btn);
  });
  globalThis.Floor = Floor;
})();
