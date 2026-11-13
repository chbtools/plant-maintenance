# Plant Maintenance

Work orders, preventive maintenance, parts, and cost for the equipment in the Champion Homes Lillington plant. This is its own app. It is not part of the forklift fleet log.

It runs in the browser on a phone or a shop computer. Until you connect a Google Sheet, it opens with **sample data** saved only on that phone, so you can try every screen right away. The orange banner says **Sample data** so nobody mistakes it for the live plant.

## Open the app

After GitHub Pages is on (steps below), the address is:

**https://chbtools.github.io/plant-maintenance/**

On a phone, open that link in Chrome or Safari, then **Add to Home Screen** (Safari) or **Install app** (Chrome). It then opens full screen like any other app.

On a computer, open the same link. The sections sit across the top and the lists spread out into columns. On a phone those same sections sit along the bottom.

### Add the crew

1. Tap **More**, then **Team**.
2. Tap **+ Tech**.
3. Enter the name, role, cell number, and hourly rate. The rate is what labor cost is figured from.
4. On each phone, open **Work** and set **This phone** to that person's name. "Mine" and "Assign to me" use it.

### Add equipment

1. Tap **Assets**, then **+ Asset**.
2. Tag it the way the floor already talks about it (`WL-1`, `AC-2`).
3. If the machine has an hour meter, set **Meter** to **Has a meter** and enter today's reading. If it doesn't, leave it on **No meter**. PM dates then come from the calendar.

### Parts

1. Tap **Parts**, then **+ Part**. The reorder point is the count that should raise a flag. When on-hand hits that number, Home and the Parts list both say **Reorder**.
2. Open a machine and tap **Add a part to this machine** when a tech finds something that belongs on it. From then on, a work order for that machine lists those parts first.
3. On a work order, enter a quantity and tap **Use**. That pulls the part out of stock and adds the cost to the job and the machine. **Return** puts it back. **Receive** is how new stock comes in. **Correct the count** is only for when you have physically counted the bin.

### Preventive maintenance

1. Open the machine. Under **Maintenance levels**, add Daily, Weekly, Monthly, or an hour interval (250 hours, 500 hours, or your own). A machine with no meter can only use day counts.
2. Add a **PM task** on that level. Write what to do, and list the parts it should pull.
3. Fill in **Last done** (and the meter that day, if it has one) so the schedule knows where you are.
4. Open **PM**. Each task shows whether it is OK, due soon, due now, or overdue. Metered machines get a suggested date from how fast the hours have been climbing. The rest use the calendar.
5. Tap **Make work order**. That opens a work order, pulls the listed parts out of inventory, and logs the cost on that asset. **Generate due PMs** does it for everything that is due and doesn't already have an open job.
6. When the job is finished, tap **Complete** and, on a metered machine, enter the meter. That reading is what the next due date is based on. You can also log a meter in the middle of a repair with **Log meter**.

### Quick flag, typing, and Wispr Flow

Tap **Quick flag** (on a phone the button says **Flag**).

The big box is a normal text box:

- Click it and dictate with **Wispr Flow**. Wispr types into whatever box is selected, the same as a keyboard.
- Or type.
- Or tap **Mic** to use this browser's speech recognition. That writes into the same box. The mic is extra. You do not need it for Wispr or for typing.

Save. You get a **draft** work order to finish later (pick the machine, assign someone, add parts).

A full work order works the same way. The title and the "what's wrong" box are normal text fields. Put the cursor in the one you want and dictate or type. If you only fill the big box, the first line becomes the title.

Every text box, search box, and note in the app works the same way. The list under a search box updates without rebuilding the box you are typing in, so the phone keyboard mic and Wispr Flow are not cut off mid-word. Each box has a small **Mic** button when the browser has speech recognition. Chrome and Edge do. If the browser does not, the button is hidden and Settings says so.

### Work orders

Tap **+ Work order**. Pick the machine, assign a tech, and set the status: draft, open, in progress, waiting on parts, waiting on approval, on hold, or complete.

**General / plant task** is for work that is not on a machine: a light, a door, a cleanup. Leave equipment blank. Type a location if you have one (Break room, Yard). The list shows **No machine**, plus that location. Machine-down and inspections still need a machine.

**Voice work order** is the big button on Home, on Today, on the work-order list, and on a machine you opened from its QR label (that machine is already filled in). The browser will not turn the mic on by itself, so the first tap is required. After that, talk normally, for example: "Work order, Truss air compressor, air leak on the drain valve, priority high, assign to Randy" or "General task, replace the light over the break room door, location break room." The app reads a summary back and shows it. Say **save** or **yes** to create it (same save as the form, including the offline queue), **cancel** to drop it, or **change** and then the correction. Turn the button off under **Floor → Settings**, same as the other modules.

**Complete** asks for the work performed, downtime hours, and the meter if the machine has one.

**Log time** records hours for a tech on that job. You can also log hours on a machine with no work order, from the machine or from **More → Time**. Labor cost is hours times that tech's rate.

### Home and reports

**Home** shows open work by tech, the machines that cost the most, overdue PMs, low stock, and downtime.

**More → Reports** starts with every field turned on: hours by tech and asset, parts cost, downtime, and the rest. Uncheck a field to hide it. That choice stays on this phone. **Download CSV** saves whatever fields are still showing.

## Turn on GitHub Pages

A computer is easier for this part.

1. Merge this project onto the `main` branch.
2. On GitHub, open **chbtools/plant-maintenance**.
3. Go to **Settings → Pages**.
4. Under **Branch**, choose **main** and **/ (root)**, then **Save**.
5. Wait a minute or two. The app is at **https://chbtools.github.io/plant-maintenance/**.

You can use the app with sample data as soon as that page loads. The sheet is a separate step.

## Connect your Google Sheet

Do this when the crew should all see the same jobs. It takes about 15 minutes. The sample data on your phone is not copied into the sheet. The sheet starts empty, and you add your real machines.

1. Go to [sheets.google.com](https://sheets.google.com) and create a blank sheet. Name it **Plant Maintenance**.
2. Click **Extensions → Apps Script**.
3. Delete what is in the editor and paste in the whole `Code.gs` file from this repo.
4. Near the top, change `CHANGE-ME` on this line to a plant code you choose (for example `lillington-shop-42`):

   `const ACCESS_CODE = 'CHANGE-ME';`

   The crew types that code once on each phone. "Anyone" on the next step only lets the web page reach the script. The code is what keeps strangers out.
5. Click **Save** (the disk icon).
6. In the function dropdown, choose **setup** and click **Run**. Google asks you to allow it: pick your account, then **Advanced → Go to (project name) → Allow**. Tabs appear in the sheet for techs, assets, work orders, parts, and the rest.
7. Click **Deploy → New deployment**. Click the gear, choose **Web app**.
8. Set **Execute as: Me** and **Who has access: Anyone**.
9. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
10. In this repo, edit `index.html`. Near the top, replace the placeholder with that URL. Keep the quotes:

    `window.PLANT_SCRIPT_URL = "https://script.google.com/macros/s/…/exec";`

11. Commit that change to `main`. Pages picks it up in a minute or two.
12. Open the app. It asks for the plant code. Enter it once per phone.

Each phone keeps a copy so the lists come up even on a weak signal. New saves go to the sheet. If the sheet can't be reached, the page says so, and the change stays on that phone until the sheet answers. A wrong plant code works the same way: the change waits until the right code is entered. It does not disappear. If the sheet refuses a save outright, that one is not retried forever. A phone that is newer than the script is different: a save the old script does not know (it answers "unknown collection") stays on the phone, and the page says the script needs an update. Nothing is dropped while you still need to redeploy. The page says it was not kept, and later saves can still go through. Two people can use parts at the same time: the app sends the change in quantity, not a fresh total, so the second save doesn't put the old count back. Two phones opening work orders at the same moment get different WO- numbers from the sheet, after the updated script is deployed.

On-hand in the **parts** tab of the sheet is the live count. Change stock from the app (Receive, Use, or Correct the count). You can sort and filter the sheet, but don't rename the tabs or the header row.

### What's in the sheet

| Tab | What it is |
| --- | --- |
| techs | The crew and their rates |
| assets | Equipment, status, meter |
| levels | Daily, weekly, hours, and so on, per machine |
| pmTasks | The PM jobs and when they were last done |
| workOrders | Every work order, including drafts |
| parts | Inventory, reorder point, unit cost, on hand |
| fits | Which part belongs on which machine |
| uses | Parts pulled onto work orders |
| timeLogs | Hours by tech |
| readings | Meter readings |
| moves | Stock history (received, used, returned, counted) |
| settings | Digest email, alert email, hour |
| failureCodes | The list used when a job is closed |
| photos | Photo rows. The file itself is in Drive when that worked |
| downtimeEvents | Machine-down clock, start and stop |
| checkTemplates, checkItems | Inspection checklists |
| inspections, inspectionLines | A completed round, and any work order a failed line opened |
| sensorLimits, sensorLogs | Limits and readings, including ESP32 posts |
| lotoPoints | Lockout / tagout points per machine |
| warranties | Coverage and the date it ends |
| outsideJobs | Vendor repairs: estimate, PO, cost, status |
| schedules | Who has which job on which day |
| reservations | Parts kit reserved when a PM work order opens |

New tabs appear the first time the updated script runs (open the app, or run **setup** once from the editor). New columns are added to the end of an existing tab. Don't rename the header row.

## Floor tools

Everything below is turned on so you can see it. **Floor → Settings** (or **More → Settings**) has a checkbox for each one. Uncheck it to take it off the menus. The records stay.

### QR tags

**Floor → Print QR labels** makes one label or a sheet of them. Each code opens that machine's page (`#asset/` plus its id), which is also where the lockout sheet is. **Floor → Scan a QR** uses the camera on Chrome for Android. Other browsers can type the tag. Printing uses the browser's print dialog (choose Save as PDF if you want a file).

### Photos

On a work order, pick Before, After, Nameplate, or Part number and take a picture. The phone shrinks it until it fits. With the sheet connected, the script saves the file in a **private** Drive folder. The folder's id is remembered on the script (Script property `PHOTO_FOLDER_ID`), so a different folder with the same name is not used. The picture is not shared with anyone who has the link. The phone asks the script for the picture, and the script checks the plant code before it sends the bytes back. If Drive isn't authorized and the picture still fits in one cell, the full copy is kept on the sheet. If it does not fit, the app says so and does not save a cut-off image.

### Failure codes

When you tap **Complete**, pick a code (worn, broken, operator, electrical, air leak, lubrication, other) and a short root cause. **Floor → Failure codes** is where you add or remove codes.

### Morning digest and Today

**Floor → Today** is the same list on the phone: overdue PMs, machines that are down, late work orders, low stock, and warranties expiring in 30 days. The email is the same idea. Set the address and the hour under **Settings**, redeploy the script, then in Apps Script choose the function **installDigestTrigger** and click **Run** once. That adds a daily trigger at the hour you saved. It does not change the web app URL. The hour is read in the script's timezone. Set that to **America/New_York** or the mail will not arrive at 6am Eastern: in Apps Script, click the gear (**Project settings**) and set **Time zone** to `America/New_York`. The email does not contain the plant code. Down alerts and out-of-range notes use fixed wording written in the script. A phone cannot put its own subject or message in the email. Each kind of note is sent at most once per machine per hour. Change that window with the script property `SENSOR_ALERT_MINUTES` (minutes, default 60).

### Inspections

**Floor → Inspections**. Build a checklist (daily compressor round, dryer round). Run it on a machine. Any line you mark Fail opens a work order on that machine.

### Machine down

On the machine page, **Machine down** sets the status to Down, starts a clock, and writes a downtime event. If an alert email is saved, the script sends that address a note. **Back up** stops the clock and records the minutes.

### Compressor room

**Floor → Compressor room** shows pressure, temperature, dew point, and the limits you set on the machine (low and high). A reading outside the limits is flagged. You can log a number by hand, or an ESP32 can post it.

### Repeat offenders

**Floor → Repeat offenders** lists machines by job count, downtime hours, and cost for 30 or 90 days. **Reorder CSV** downloads the parts that are at or under the reorder point.

### Lockout / tagout

On the machine page, under **Lockout / tagout**, list each energy source and how to isolate it. Optional photo. Scanning the QR label opens this same page.

### Vendors and warranty

On the machine: what is covered, who the vendor is, and the end date. **Floor → Vendors and warranty** lists anything expiring in the next 30 days. Outside service is a log of estimate number, PO, cost, and status (quoted, approved, in shop, back, closed).

### Weekly schedule

**Floor → Weekly schedule**. Tap a day under a tech and pick an open work order. That sets the due date and the assignment.

### ESP32 sensor tie-in

The script accepts `action: "sensor"` with the plant code, an asset tag, a name, a type, and a value. It stores a row when the value moves, when it is outside the limits, or at most every 15 minutes if it is sitting still. Change that gap with the script property `SENSOR_SAMPLE_MINUTES`. Types `hours`, `meter`, and `cycles` update the hour meter only on a machine that has a meter, and only when the new number is higher than the one already stored and the sample is one that gets stored. Zero, blank, and negative meter posts are refused. The first time a reading leaves the limits, the script sends one email. If it stays out, a reminder goes out at most every 4 hours (`SENSOR_REMIND_HOURS`). When it comes back inside the limits, one "back in range" email is sent. Phones sync the last 30 days of readings (500 rows at most). Older rows stay on the sheet and are not copied to every phone.

A starter sketch is in `examples/esp32-sensor.ino`. It checks the certificate instead of skipping that check. As of this writing, `script.google.com` and `script.googleusercontent.com` (the address the script redirects to) chain through Google's WE2 intermediate to **GTS Root R4**. Root R1 does not verify that chain. The sketch pins R4 and also keeps R1. To see what is live:

```
openssl s_client -showcerts -connect script.google.com:443 -servername script.google.com </dev/null
openssl s_client -showcerts -connect script.googleusercontent.com:443 -servername script.googleusercontent.com </dev/null
```

The issuer of the WE2 certificate is the root to download from [https://pki.goog/repository/](https://pki.goog/repository/) (`gtsr4.pem` today). Paste that PEM into `GTS_ROOTS` in the sketch. Put your own code and URL in the sketch. Don't commit the real plant code. The sketch prints only the HTTP status, not the code.

### Parts kits

The parts on a PM task are the kit. When you **Make work order**, those parts are reserved to that job and pulled from stock (the on-hand count drops, and a reservation row says `issued`). A PM with no parts does not say the kit was reserved. Cancelling that work order returns the parts and marks the reservation `cancelled`. **Reorder CSV** is the shopping list.

### Voice work order

Turned on with the other modules. One tap, then hands-free. Hidden when the browser has no speech recognition. See **Work orders** above.

### Monthly one-pager

**Floor → Monthly one-pager** shows uptime, the percent of PM tasks that are currently on time, cost by area, and the top offenders. **Print / PDF** uses the browser print dialog.

## Updating the Google script

Do this whenever `Code.gs` in this repo changes. The page on GitHub Pages updates by itself. The sheet does not.

1. Open the Plant Maintenance sheet. Click **Extensions → Apps Script**.
2. Select everything in the editor and delete it. Paste in the whole new `Code.gs`.
3. The file says `const ACCESS_CODE = 'CHANGE-ME'`. Put your real plant code back on that line. Do not leave `CHANGE-ME`.
4. Click **Save**.
5. Click **Deploy → Manage deployments**.
6. On the web app that is already there, click the pencil (**Edit**). Do not make a new deployment.
7. Set **Version** to **New version**. Leave **Execute as: Me** and **Who has access: Anyone**.
8. Click **Deploy**. The address should stay the same and still end in `/exec`. You do not need to change `index.html` if it didn't.

The first time you save a photo, send an alert, or run the digest, Google asks for more permission:

- **Drive** — to create the private Plant Maintenance Photos folder and store pictures. The files are not shared by link.
- **Gmail** (sending email as you) — for the morning digest, the machine-down note, and an out-of-range sensor.
- **Script triggers** — only if you run **installDigestTrigger** from the editor. That is a daily timer, not a new web address.

Run **setup** once from the editor if you want the new tabs created before anyone opens the app. Opening the app also creates them.

## Later changes

- **New plant code:** edit `ACCESS_CODE`, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same. Everyone has to enter the new code.
- **Updating Code.gs:** paste the new file over the script, put your real plant code back on the `ACCESS_CODE` line (do not leave `CHANGE-ME`), then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The `/exec` URL stays the same. Until you do that, the phones have the page fixes and the sheet keeps running the old script.
- **Sample data:** with no sheet connected, **More → Reset sample data** puts the practice plant back.
- **Hiding report fields:** uncheck them on Reports. Check them again to bring them back.
