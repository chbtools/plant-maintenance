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

### Work orders

Tap **+ Work order**. Pick the machine, assign a tech, and set the status: draft, open, in progress, waiting on parts, waiting on approval, on hold, or complete.

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

Each phone keeps a copy so the lists come up even on a weak signal. New saves go to the sheet. If the sheet can't be reached, the change stays on that phone and is sent the next time the page can get through. Two people can use parts at the same time: the app sends the change in quantity, not a fresh total, so the second save doesn't put the old count back.

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

## Later changes

- **New plant code:** edit `ACCESS_CODE`, then **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same. Everyone has to enter the new code.
- **Updating Code.gs:** deploy a new version the same way so the URL does not change.
- **Sample data:** with no sheet connected, **More → Reset sample data** puts the practice plant back.
- **Hiding report fields:** uncheck them on Reports. Check them again to bring them back.
