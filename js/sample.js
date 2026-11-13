/* Practice data for the Lillington plant. Dates are relative to "today"
   so overdue PMs and open jobs still look right whenever the page is opened.
   Loaded only until a Google Sheet is connected. */
(function () {
  const PM = globalThis.PM;
  PM.buildSample = function (today) {
    today = today || PM.today();
    const d = n => PM.addDays(today, n);
    const at = (n, hm) => d(n) + "T" + (hm || "15:00:00") + ".000Z";
    let s = PM.emptyState();
    const go = r => { if (!r || !r.ok) throw new Error((r && r.message) || "Sample data failed to build"); return r; };
    const keep = r => { s = go(r).state; return go(r); };

    const techs = [
      ["Randy Johnson", "Maintenance lead", "910-555-0142", "randy.johnson@example.com", 42],
      ["Marcus Hale", "Millwright", "910-555-0172", "marcus.hale@example.com", 32],
      ["Elena Vasquez", "Electrician", "910-555-0194", "elena.vasquez@example.com", 34],
      ["Ty Brooks", "Mechanic", "910-555-0116", "ty.brooks@example.com", 28],
      ["Jordan Ellis", "Apprentice", "910-555-0133", "", 18]
    ];
    for (const [name, role, phone, email, hourlyRate] of techs) {
      keep(PM.saveTech(s, { name, role, phone, email, hourlyRate, active: "yes", now: at(-90) }));
    }
    const tech = name => s.techs.find(t => t.name === name).id;

    const assets = [
      ["WL-1", "Wall line station 1", "Wall build", "Production line", "Randek", "Auto wall", 2018, "WL-4418", "Running", "yes", "Hours", "Panel line. Meter is run hours off the line PLC."],
      ["FL-2", "Floor cassette line", "Floor build", "Production line", "Triad", "FL-200", 2019, "FL-1902", "Running", "yes", "Hours", "Deck and joist line."],
      ["RT-1", "Roof truss gantry", "Roof", "Gantry", "Mitek", "Gantry 40", 2016, "RT-7721", "Down", "yes", "Hours", "Down — still trips overload after the gearbox job."],
      ["PS-12", "Panel saw", "Cutting", "Saw", "Holz-Her", "PS-12", 2020, "PS-3310", "Running", "no", "", "Cut station. No hour meter."],
      ["DC-1", "Dust collector", "Air and dust", "Dust collector", "Donaldson", "Dalamatic", 2017, "DC-088", "Running", "yes", "Hours", "Serves the saws and the routers."],
      ["AC-2", "Air compressor 2", "Air and dust", "Compressor", "Quincy", "QGS-50", 2015, "AC-5502", "Running", "yes", "Hours", "Plant air. Hour meter is on the controller."],
      ["PB-1", "Paint booth", "Finish", "Spray booth", "Col-Met", "Open face", 2014, "PB-14", "Running", "no", "", "Waterborne booth. Filters are calendar PM."],
      ["CR-3", "Bay 3 bridge crane", "Material handling", "Bridge crane", "Cranewerks", "5 ton", 2012, "CR-305", "Running", "yes", "Hours", "Bridge travel and hoist."],
      ["HP-4", "Hydraulic press", "Component", "Hydraulic press", "Dake", "50 ton", 2011, "HP-050", "Idle", "no", "", "Used for bracket forming. No meter."],
      ["MA-1", "Makeup air unit", "HVAC", "Air handler", "Reznor", "MAU-80", 2013, "MA-1620", "Running", "no", "", "Finish-side makeup air. No meter."]
    ];
    for (const [tag, name, area, type, make, model, year, serial, status, metered, meterType, notes] of assets) {
      keep(PM.saveAsset(s, { tag, name, area, type, make, model, year, serial, status, metered, meterType: meterType || "Hours", notes, now: at(-90) }));
    }
    const asset = tag => s.assets.find(a => a.tag === tag).id;

    const parts = [
      ["GREASE-1", "Multi-purpose grease cartridge", "A-12", 8, 4, 12, 6.5, "Motion", "Line grease."],
      ["HYD-05", "1/2 in hydraulic hose assembly", "B-02", 3, 4, 6, 18.5, "Local hydraulics", "Wall line, press, and floor line."],
      ["OIL-46", "Compressor oil ISO 46 (gal)", "C-01", 6, 6, 12, 22, "Quincy dealer", "AC-2 only."],
      ["CF-200", "Compressor intake filter", "C-01", 3, 2, 4, 34, "Quincy dealer", ""],
      ["VB-B68", "V-belt B68", "C-04", 0, 2, 4, 16, "Grainger", "Bin is empty."],
      ["PBF-20", "Paint booth intake filter", "D-03", 10, 4, 12, 12, "Col-Met", ""],
      ["MAF-1620", "Makeup air filter 16x20", "D-06", 5, 2, 8, 14, "Grainger", ""],
      ["DF-30", "Dust collector cartridge", "D-01", 3, 2, 2, 85, "Donaldson", ""],
      ["SB-12", "12 in carbide saw blade", "E-02", 6, 2, 4, 64, "Forrest", ""],
      ["CB-30", "Crane bridge brake shoe", "F-08", 2, 1, 2, 110, "Cranewerks", ""],
      ["PX-24", "24V proximity sensor", "E-11", 4, 2, 4, 47, "AutomationDirect", "Used on the lines and the gantry."],
      ["SV-120", "120V solenoid valve", "E-09", 2, 1, 2, 68, "ASCO", ""],
      ["GSK-RT", "Gantry gearbox seal kit", "F-02", 2, 0, 1, 860, "Mitek", "Special order."],
      ["BRG-6208", "Bearing 6208", "F-02", 4, 1, 4, 320, "Motion", ""],
      ["OIL-68", "Gear oil ISO 68 (gal)", "C-02", 8, 2, 4, 24, "Motion", ""]
    ];
    for (const [sku, name, bin, onHand, reorderPoint, reorderQty, unitCost, vendor, notes] of parts) {
      keep(PM.savePart(s, { sku, name, bin, onHand, reorderPoint, reorderQty, unitCost, vendor, notes, description: name, now: at(-80) }));
    }
    const part = sku => s.parts.find(p => p.sku === sku).id;

    const fits = [
      ["GREASE-1", "WL-1", "Chain and turner bearings"],
      ["GREASE-1", "FL-2", "Cassette dogs"],
      ["GREASE-1", "HP-4", "Ram guides"],
      ["GREASE-1", "RT-1", "Trolley wheels"],
      ["HYD-05", "WL-1", "Turner cylinder whip hose"],
      ["HYD-05", "FL-2", "Squaring stop"],
      ["HYD-05", "HP-4", "Ram hose"],
      ["OIL-46", "AC-2", ""],
      ["CF-200", "AC-2", ""],
      ["VB-B68", "AC-2", "Motor belt"],
      ["VB-B68", "DC-1", "Blower belt"],
      ["PBF-20", "PB-1", ""],
      ["MAF-1620", "MA-1", "Two per change"],
      ["DF-30", "DC-1", ""],
      ["SB-12", "PS-12", ""],
      ["CB-30", "CR-3", ""],
      ["PX-24", "WL-1", "Infeed flag"],
      ["PX-24", "FL-2", "Deck present"],
      ["PX-24", "RT-1", "Overload proxy"],
      ["SV-120", "PB-1", "Water valve"],
      ["SV-120", "AC-2", "Unloader"],
      ["GSK-RT", "RT-1", ""],
      ["BRG-6208", "RT-1", ""],
      ["OIL-68", "RT-1", "Gearbox"]
    ];
    for (const [sku, tag, notes] of fits) keep(PM.saveFit(s, { partId: part(sku), assetId: asset(tag), notes, addedBy: "Randy Johnson", now: at(-80) }));

    const levels = [
      ["WL-1", "Daily", "calendar", 1, 0, "Start of shift walk."],
      ["WL-1", "250 hours", "meter", 0, 250, "Lube and chain."],
      ["FL-2", "Monthly", "both", 30, 200, "Whichever comes first."],
      ["RT-1", "Monthly", "calendar", 30, 0, "Inspection even while the hour meter is low."],
      ["PS-12", "Weekly", "calendar", 7, 0, ""],
      ["DC-1", "Weekly", "calendar", 7, 0, ""],
      ["AC-2", "500 hours", "meter", 0, 500, "Oil and filter."],
      ["PB-1", "Quarterly", "calendar", 90, 0, ""],
      ["CR-3", "Annual", "calendar", 365, 0, ""],
      ["HP-4", "Quarterly", "calendar", 90, 0, ""],
      ["MA-1", "Monthly", "calendar", 30, 0, ""]
    ];
    for (const [tag, name, basis, everyDays, everyMeter, notes] of levels) {
      keep(PM.saveLevel(s, { assetId: asset(tag), name, basis, everyDays, everyMeter, active: "yes", notes, now: at(-70) }));
    }
    const level = (tag, name) => s.levels.find(l => l.assetId === asset(tag) && l.name === name).id;

    const tasks = [
      ["WL-1", "Daily", "Daily walkaround", "Walk the wall line. Check manifold air, look for hydraulic seepage under the turner, and try both e-stops. Write up anything that isn't right.", [], d(-1), ""],
      ["WL-1", "250 hours", "250 hour lube and chain", "Grease the chain and the turner bearings. Two cartridges. Check chain tension and the proximity flags. Log the hour meter.", [["GREASE-1", 2]], d(-10), 8880],
      ["FL-2", "Monthly", "Monthly floor line service", "Grease the cassette dogs, check the deck-present sensor, and look over the hoses. Log hours.", [["GREASE-1", 1]], d(-32), 5220],
      ["RT-1", "Monthly", "Monthly gantry inspection", "Look at the bridge wheels, the festoon, and the gearbox weep hole. Do not load the crane if it trips.", [], d(-12), ""],
      ["PS-12", "Weekly", "Weekly blade and guard check", "Check the blade for burned teeth, the guard, and the dust hose. Change the blade if the cut is fuzzy.", [], d(-2), ""],
      ["DC-1", "Weekly", "Weekly dust collector blowdown", "Pulse the bags, check the drum, and listen for a slipping belt.", [], d(-6), ""],
      ["AC-2", "500 hours", "500 hour compressor service", "Change the ISO 46 oil and the intake filter. Check the belt and the unloader. Log the hour meter when you finish.", [["OIL-46", 4], ["CF-200", 1]], d(-45), 18000],
      ["PB-1", "Quarterly", "Quarterly booth filters", "Replace the intake filters. Six pads. Check the water curtain.", [["PBF-20", 6]], d(-82), ""],
      ["CR-3", "Annual", "Annual crane inspection", "Inspect brakes, wire rope, and limit switches. This is the yearly, not the monthly look.", [["CB-30", 2]], d(-200), ""],
      ["HP-4", "Quarterly", "Quarterly press inspection", "Check the ram hose, the guides, and the pressure gauge.", [], d(-30), ""],
      ["MA-1", "Monthly", "Monthly filter change", "Replace both 16x20 filters. Check the belt and the condensate drain.", [["MAF-1620", 2]], d(-50), ""]
    ];
    for (const [tag, lvl, name, instructions, partLines, lastCompletedAt, lastMeter] of tasks) {
      keep(PM.saveTask(s, {
        assetId: asset(tag), levelId: level(tag, lvl), name, instructions, active: "yes",
        parts: partLines.map(([sku, qty]) => ({ partId: part(sku), qty })),
        lastCompletedAt, lastMeter, now: at(-60)
      }));
    }
    const task = name => s.pmTasks.find(t => t.name === name).id;

    const read = (tag, day, reading, woId) => keep(PM.saveReading(s, {
      assetId: asset(tag), reading, date: d(day), workOrderId: woId || "", techId: tech("Randy Johnson"), now: at(day, "12:00:00")
    }));
    read("AC-2", -30, 17800);
    read("AC-2", -3, 18640);
    read("FL-2", -14, 5100);
    read("FL-2", 0, 5400);
    read("RT-1", -40, 2000);
    read("RT-1", -2, 2310);
    read("DC-1", -20, 6100);
    read("DC-1", -2, 6400);
    read("CR-3", -200, 11800);
    read("CR-3", -10, 12050);
    read("WL-1", -21, 8800);

    const wo = (fields) => keep(PM.saveWo(s, Object.assign({ type: "Repair", priority: "Normal", source: "typed", otherCost: 0, downtimeHours: 0, now: at(0) }, fields)));

    wo({
      assetId: asset("RT-1"), title: "Gearbox rebuild", status: "complete", type: "Repair", priority: "Urgent",
      assignedTo: tech("Marcus Hale"), requestedBy: "Roof lead", openedDate: d(-14), completedDate: d(-12),
      downtimeHours: 22, otherCost: 900, description: "Gearbox howled and locked the bridge. Seals and bearings.",
      workPerformed: "Replaced seal kit and both 6208 bearings. Filled with ISO 68. Outside shop faced the cover.",
      now: at(-14)
    });
    const gear = s.workOrders.find(w => w.title === "Gearbox rebuild").id;
    const use = (title, sku, qty, who, day) => keep(PM.usePart(s, {
      workOrderId: s.workOrders.find(w => w.title === title).id, partId: part(sku), qty, techId: tech(who), now: at(day, "13:00:00")
    }));
    use("Gearbox rebuild", "GSK-RT", 1, "Marcus Hale", -13);
    use("Gearbox rebuild", "BRG-6208", 2, "Marcus Hale", -13);
    use("Gearbox rebuild", "OIL-68", 2, "Marcus Hale", -13);
    keep(PM.saveTime(s, { workOrderId: gear, techId: tech("Marcus Hale"), hours: 16, date: d(-13), notes: "Tear down and reassembly", now: at(-13, "18:00:00") }));
    keep(PM.saveTime(s, { workOrderId: gear, techId: tech("Randy Johnson"), hours: 6, date: d(-12), notes: "Cover and lineup", now: at(-12, "18:00:00") }));

    wo({
      assetId: asset("PB-1"), title: "Quarterly booth filters", status: "complete", type: "PM", source: "pm",
      pmTaskId: task("Quarterly booth filters"), assignedTo: tech("Elena Vasquez"), openedDate: d(-82), completedDate: d(-82),
      description: "Replace the intake filters.", workPerformed: "Six new pads. Water curtain running.", now: at(-82)
    });
    use("Quarterly booth filters", "PBF-20", 6, "Elena Vasquez", -82);
    keep(PM.saveTime(s, { workOrderId: s.workOrders.find(w => w.title === "Quarterly booth filters").id, techId: tech("Elena Vasquez"), hours: 1.5, date: d(-82), notes: "", now: at(-82, "18:00:00") }));

    wo({
      assetId: asset("CR-3"), title: "Annual crane inspection", status: "complete", type: "PM", source: "pm",
      pmTaskId: task("Annual crane inspection"), assignedTo: tech("Randy Johnson"), openedDate: d(-200), completedDate: d(-200),
      description: "Yearly inspection.", workPerformed: "Brakes and limits good. Shoes still have meat.", now: at(-200)
    });
    keep(PM.saveTime(s, { workOrderId: s.workOrders.find(w => w.title === "Annual crane inspection").id, techId: tech("Randy Johnson"), hours: 4, date: d(-200), notes: "", now: at(-200, "18:00:00") }));

    wo({
      assetId: asset("WL-1"), title: "Hydraulic seep at the turner", status: "open", priority: "High",
      assignedTo: tech("Marcus Hale"), requestedBy: "Wall line lead", dueDate: d(-1), openedDate: d(-1),
      description: "Turner cylinder whip hose is wet. Mast drifts when the line sits.", now: at(-1, "07:30:00")
    });
    use("Hydraulic seep at the turner", "HYD-05", 2, "Ty Brooks", -1);
    keep(PM.saveTime(s, { workOrderId: s.workOrders.find(w => w.title === "Hydraulic seep at the turner").id, techId: tech("Ty Brooks"), hours: 3, date: d(-1), notes: "Pulled the whip hose, waiting on Marcus to bleed it", now: at(-1, "16:00:00") }));
    read("WL-1", -1, 9120, s.workOrders.find(w => w.title === "Hydraulic seep at the turner").id);

    wo({
      assetId: asset("PS-12"), title: "Panel saw cut is wandering", status: "in_progress", priority: "Normal",
      assignedTo: tech("Ty Brooks"), requestedBy: "Cut lead", dueDate: d(1), openedDate: d(0),
      description: "Last sheet of the day walked off the line. Check fence and blade.", now: at(0, "08:10:00")
    });
    keep(PM.saveTime(s, { workOrderId: s.workOrders.find(w => w.title === "Panel saw cut is wandering").id, techId: tech("Ty Brooks"), hours: 1.5, date: d(0), notes: "Fence is loose", now: at(0, "10:00:00") }));

    wo({
      assetId: asset("DC-1"), title: "Inlet damper sensor dead", status: "waiting_parts", priority: "Normal",
      assignedTo: tech("Elena Vasquez"), requestedBy: "Elena Vasquez", dueDate: d(2), openedDate: d(-1),
      description: "Damper doesn't prove closed. 24V prox on the inlet is dead. Holding the spare until we confirm the wiring.", now: at(-1, "09:00:00")
    });
    keep(PM.saveTime(s, { workOrderId: s.workOrders.find(w => w.title === "Inlet damper sensor dead").id, techId: tech("Elena Vasquez"), hours: 1, date: d(0), notes: "Traced the cable", now: at(0, "11:00:00") }));

    wo({
      assetId: asset("RT-1"), title: "Gantry trips overload after gearbox", status: "in_progress", priority: "High",
      assignedTo: tech("Randy Johnson"), requestedBy: "Roof lead", dueDate: d(0), openedDate: d(-1), downtimeHours: 6,
      description: "Bridge travel trips as soon as it picks up a truss. Proxy or a brake dragging.", now: at(-1, "06:40:00")
    });
    use("Gantry trips overload after gearbox", "PX-24", 1, "Randy Johnson", -1);
    keep(PM.saveTime(s, { workOrderId: s.workOrders.find(w => w.title === "Gantry trips overload after gearbox").id, techId: tech("Randy Johnson"), hours: 2, date: d(0), notes: "Swapped the proxy, still trips", now: at(0, "14:00:00") }));

    wo({
      title: "Bay 3 crane grinding on the bridge travel",
      description: "Bay 3 crane grinding on the bridge travel. Sounds like a dry bearing.",
      voiceTranscript: "Bay 3 crane grinding on the bridge travel. Sounds like a dry bearing.",
      status: "draft", source: "voice", assetId: "", priority: "Normal", type: "Repair", openedDate: d(0),
      now: at(0, "17:05:00")
    });

    keep(PM.generatePm(s, { taskId: task("Monthly floor line service"), assignedTo: tech("Jordan Ellis"), today, now: at(0, "16:00:00") }));
    const floorWo = s.workOrders.find(w => w.pmTaskId === task("Monthly floor line service")).id;
    keep(PM.saveTime(s, { workOrderId: floorWo, techId: tech("Jordan Ellis"), hours: 1, date: d(0), notes: "Started the grease pass", now: at(0, "16:20:00") }));
    keep(PM.saveTime(s, { assetId: asset("WL-1"), techId: tech("Jordan Ellis"), hours: 0.5, date: d(0), notes: "Swept the pit, no work order", now: at(0, "17:40:00") }));

    if (PM.seedFeatures) s = PM.seedFeatures(s, today);
    return s;
  };
})();
