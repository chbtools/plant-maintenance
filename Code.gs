/**
 * Plant Maintenance — Google Sheets backend.
 * Paste this into Extensions → Apps Script on a new Google Sheet.
 * Change ACCESS_CODE before you deploy. It is the plant code the crew types once.
 *
 * Stock counts use a delta (or a recount), matching nextOnHand in js/logic.js.
 * Two phones can use parts and the second save will not put the old count back.
 *
 * A batch is claimed before those stock changes run. A retry reuses the same
 * on-hand numbers (the same rules as planPartAbsolutes in js/logic.js) so a
 * slow or timed-out save cannot take parts out twice.
 * New work-order numbers are chosen here, under the script lock, so two phones
 * cannot both be handed WO-1006. Numbers stay in the WO- form.
 */
const ACCESS_CODE = 'CHANGE-ME';

const COLUMNS = {
  techs: ['id', 'name', 'role', 'phone', 'email', 'hourlyRate', 'active', 'notes', 'createdAt'],
  assets: ['id', 'tag', 'name', 'area', 'type', 'make', 'model', 'year', 'serial', 'status', 'metered', 'meterType', 'meter', 'notes', 'createdAt', 'updatedAt'],
  levels: ['id', 'assetId', 'name', 'basis', 'everyDays', 'everyMeter', 'active', 'notes', 'createdAt'],
  pmTasks: ['id', 'assetId', 'levelId', 'name', 'instructions', 'partsJson', 'active', 'lastCompletedAt', 'lastMeter', 'lastWoId', 'createdAt'],
  workOrders: ['id', 'woNumber', 'assetId', 'assetTag', 'assetName', 'title', 'description', 'type', 'status', 'priority', 'assignedTo', 'assignedName', 'requestedBy', 'dueDate', 'openedDate', 'completedDate', 'downtimeHours', 'meterAt', 'workPerformed', 'otherCost', 'laborHours', 'laborCost', 'partsCost', 'totalCost', 'pmTaskId', 'source', 'voiceTranscript', 'notes', 'failureCode', 'rootCause', 'location', 'createdAt', 'updatedAt'],
  parts: ['id', 'sku', 'name', 'description', 'bin', 'onHand', 'reorderPoint', 'reorderQty', 'unitCost', 'vendor', 'notes', 'createdAt', 'updatedAt'],
  fits: ['id', 'partId', 'assetId', 'notes', 'addedBy', 'createdAt'],
  uses: ['id', 'workOrderId', 'partId', 'assetId', 'partSku', 'partName', 'qty', 'unitCost', 'extended', 'techId', 'createdAt'],
  timeLogs: ['id', 'workOrderId', 'assetId', 'techId', 'techName', 'date', 'hours', 'rate', 'notes', 'createdAt'],
  readings: ['id', 'assetId', 'workOrderId', 'reading', 'techId', 'date', 'notes', 'createdAt'],
  moves: ['id', 'partId', 'qty', 'reason', 'workOrderId', 'note', 'onHandAfter', 'createdAt'],
  settings: ['id', 'digestEmail', 'digestHour', 'alertEmail', 'createdAt'],
  failureCodes: ['id', 'name', 'active', 'sort', 'createdAt'],
  photos: ['id', 'workOrderId', 'assetId', 'kind', 'name', 'driveFileId', 'url', 'dataUrl', 'techId', 'createdAt'],
  downtimeEvents: ['id', 'assetId', 'assetTag', 'workOrderId', 'startedAt', 'endedAt', 'minutes', 'open', 'note', 'createdAt'],
  checkTemplates: ['id', 'name', 'assetId', 'notes', 'active', 'createdAt'],
  checkItems: ['id', 'templateId', 'sort', 'text', 'createdAt'],
  inspections: ['id', 'templateId', 'assetId', 'techId', 'date', 'status', 'notes', 'createdAt'],
  inspectionLines: ['id', 'inspectionId', 'itemId', 'text', 'result', 'note', 'workOrderId', 'createdAt'],
  sensorLimits: ['id', 'assetId', 'name', 'unit', 'low', 'high', 'active', 'createdAt'],
  sensorLogs: ['id', 'assetId', 'assetTag', 'name', 'unit', 'value', 'type', 'date', 'source', 'flag', 'note', 'createdAt'],
  lotoPoints: ['id', 'assetId', 'name', 'energy', 'howToIsolate', 'photoData', 'sort', 'createdAt'],
  warranties: ['id', 'assetId', 'vendor', 'what', 'expires', 'notes', 'createdAt'],
  outsideJobs: ['id', 'assetId', 'vendor', 'estimate', 'po', 'cost', 'status', 'openedDate', 'notes', 'createdAt'],
  schedules: ['id', 'date', 'techId', 'workOrderId', 'pmTaskId', 'note', 'createdAt'],
  reservations: ['id', 'workOrderId', 'pmTaskId', 'partId', 'qty', 'status', 'createdAt'],
  applied: ['id', 'at', 'body']
};

const NUMERIC = ['hourlyRate', 'year', 'meter', 'everyDays', 'everyMeter', 'lastMeter', 'downtimeHours', 'meterAt', 'otherCost', 'laborHours', 'laborCost', 'partsCost', 'totalCost', 'onHand', 'reorderPoint', 'reorderQty', 'unitCost', 'qty', 'extended', 'hours', 'rate', 'reading', 'onHandAfter', 'digestHour', 'sort', 'minutes', 'low', 'high', 'value', 'cost'];
const DATA = ['techs', 'assets', 'levels', 'pmTasks', 'workOrders', 'parts', 'fits', 'uses', 'timeLogs', 'readings', 'moves', 'settings', 'failureCodes', 'photos', 'downtimeEvents', 'checkTemplates', 'checkItems', 'inspections', 'inspectionLines', 'sensorLimits', 'sensorLogs', 'lotoPoints', 'warranties', 'outsideJobs', 'schedules', 'reservations'];

function doPost(e) {
  let p;
  try { p = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad request' }); }
  return handle(p);
}
function doGet() {
  return out({ ok: true, app: 'plant-maintenance', message: 'Plant Maintenance backend is running.' });
}

function handle(p) {
  try {
    if (String(p.code || '') !== ACCESS_CODE) return out({ ok: false, error: 'unauthorized' });
    if (p.action === 'list') {
      const body = { ok: true };
      DATA.forEach(name => { body[name] = readAll(name); });
      return out(body);
    }
    if (p.action === 'photo') return savePhotoFile(p);
    if (p.action === 'notify') return sendAlert(p);
    if (p.action === 'sensor') return ingestSensor(p);
    if (p.action === 'batch') return batch(p);
    if (!COLUMNS[p.collection] || p.collection === 'applied') return out({ ok: false, error: 'unknown collection' });
    if (!okId(p.id)) return out({ ok: false, error: 'bad id' });
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { applyOp({ op: p.action === 'delete' ? 'delete' : 'set', collection: p.collection, id: p.id, data: p.data || {} }, {}); }
    finally { lock.releaseLock(); }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

function checkOp(op) {
  op = op || {};
  const name = op.collection;
  if (!COLUMNS[name] || name === 'applied') throw new Error('unknown collection');
  if (!okId(op.id)) throw new Error('bad id');
  if (op.op !== 'delete' && op.op !== 'set' && op.op !== 'update') throw new Error('bad op');
}

/* Same rules as planPartAbsolutes in js/logic.js. The number stored for each
   parts op is the on-hand AFTER that op, figured before anything is written. */
function planPartAbsolutes(ops) {
  const plan = {};
  const running = {};
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] || {};
    if (op.collection !== 'parts' || op.op === 'delete') continue;
    if (!Object.prototype.hasOwnProperty.call(running, op.id)) {
      const cur = readDoc('parts', op.id);
      running[op.id] = cur ? cur.onHand : 0;
    }
    running[op.id] = nextOnHand(running[op.id], op.data || {});
    plan[String(i)] = running[op.id];
  }
  return plan;
}

function woDigits(v) {
  const n = parseInt(String(v || '').replace(/\D/g, ''), 10);
  return isFinite(n) ? n : 0;
}

function workOrderNumbers() {
  const sh = sheet('workOrders');
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 2).getValues().filter(function (r) { return r[0] !== ''; });
}

function woNumberTaken(number, exceptId) {
  if (!number) return false;
  const rows = workOrderNumbers();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][1]) === String(number) && String(rows[i][0]) !== String(exceptId)) return true;
  }
  return false;
}

function allocateWoNumber(reserved) {
  let max = 1000;
  workOrderNumbers().forEach(function (r) { const n = woDigits(r[1]); if (n > max) max = n; });
  Object.keys(reserved || {}).forEach(function (num) { const n = woDigits(num); if (n > max) max = n; });
  for (let guard = 0; guard < 10000; guard++) {
    max++;
    const num = 'WO-' + max;
    if (reserved && reserved[num]) continue;
    if (woNumberTaken(num, '')) continue;
    return num;
  }
  throw new Error('Could not assign a work order number');
}

function assignWoNumber(id, data, reserved) {
  reserved = reserved || {};
  const cur = readDoc('workOrders', id);
  if (cur && cur.id) {
    data.woNumber = cur.woNumber || data.woNumber || '';
    if (data.woNumber) reserved[data.woNumber] = id;
    return;
  }
  let num = String(data.woNumber || '');
  if (!/^WO-\d+$/.test(num) || reserved[num] || woNumberTaken(num, id)) num = allocateWoNumber(reserved);
  data.woNumber = num;
  reserved[num] = id;
}

function applyResolved(op, plan, i, reserved) {
  if (plan && op && op.collection === 'parts' && op.op !== 'delete' && plan[String(i)] !== undefined && plan[String(i)] !== null) {
    const data = Object.assign({}, op.data || {});
    data._onHandSet = plan[String(i)];
    delete data._onHandDelta;
    applyOp({ op: op.op, collection: op.collection, id: op.id, data: data }, reserved);
    return;
  }
  applyOp(op, reserved);
}

function batch(p) {
  if (p.batchId && !okId(p.batchId)) return out({ ok: false, error: 'bad batch' });
  const ops = Array.isArray(p.ops) ? p.ops : null;
  // Phones send at most 80 ops per request (MAX_BATCH in js/logic.js) so an older
  // copy of this script still accepts the save. 400 is the ceiling for a phone
  // that has not picked up that split yet.
  if (!ops || ops.length > 400) return out({ ok: false, error: 'bad batch' });
  try { for (let i = 0; i < ops.length; i++) checkOp(ops[i]); }
  catch (err) { return out({ ok: false, error: String(err && err.message || err) }); }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  const reserved = {};
  try {
    let plan = null;
    if (p.batchId) {
      const prior = readDoc('applied', p.batchId);
      if (prior && prior.at !== 'pending') return out({ ok: true, duplicate: true });
      if (prior && prior.at === 'pending') {
        // Already claimed. Reuse the frozen on-hand numbers. Do not add the delta again.
        if (!prior.body) return out({ ok: false, error: 'bad request' });
        try { plan = JSON.parse(prior.body); }
        catch (err) { return out({ ok: false, error: 'bad request' }); }
        if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return out({ ok: false, error: 'bad request' });
      } else {
        plan = planPartAbsolutes(ops);
        // claim-before-apply
        writeDoc('applied', p.batchId, { at: 'pending', body: JSON.stringify(plan) });
      }
    }
    // apply-after-claim
    for (let i = 0; i < ops.length; i++) applyResolved(ops[i], plan, i, reserved);
    if (p.batchId) writeDoc('applied', p.batchId, { at: new Date().toISOString(), body: '' });
  } finally { lock.releaseLock(); }
  return out({ ok: true });
}

function okId(id) { return /^[A-Za-z0-9_-]{4,40}$/.test(String(id || '')); }

/* Same rules as nextOnHand in js/logic.js. */
function nextOnHand(current, data) {
  data = data || {};
  if (data._onHandSet !== undefined && data._onHandSet !== '' && data._onHandSet !== null) return round2(data._onHandSet);
  if (data._onHandDelta !== undefined && data._onHandDelta !== '' && data._onHandDelta !== null) return round2(num(current) + num(data._onHandDelta));
  return round2(current);
}
function num(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function round2(n) { return Math.round((num(n) + 1e-9) * 100) / 100; }

function applyOp(op, reserved) {
  const name = op.collection;
  if (!COLUMNS[name] || name === 'applied') throw new Error('unknown collection');
  if (!okId(op.id)) throw new Error('bad id');
  if (op.op === 'delete') { deleteDoc(name, op.id); return; }
  if (op.op !== 'set' && op.op !== 'update') throw new Error('bad op');
  const data = Object.assign({}, op.data || {});
  if (name === 'workOrders') assignWoNumber(op.id, data, reserved || {});
  if (name === 'parts') {
    const cur = readDoc(name, op.id);
    data.onHand = nextOnHand(cur ? cur.onHand : 0, data);
    delete data._onHandDelta;
    delete data._onHandSet;
  }
  if (op.op === 'update') {
    const cur = readDoc(name, op.id) || {};
    writeDoc(name, op.id, Object.assign(cur, data));
  } else writeDoc(name, op.id, data);
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  const cols = COLUMNS[name];
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    cols.forEach((c, i) => {
      const r = sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1);
      if (NUMERIC.indexOf(c) === -1) r.setNumberFormat('@');
      else if (/Cost|total|unitCost|extended|rate|hourlyRate|stock/i.test(c) || c === 'unitCost' || c === 'extended' || c === 'hourlyRate' || c === 'rate') r.setNumberFormat('$#,##0.00');
    });
  } else {
    // Add headers that this deployment knows about and the tab does not. Don't rename or reorder what's there.
    const width = Math.max(sh.getLastColumn(), 1);
    const headers = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h || ''); });
    cols.forEach(function (c) {
      if (headers.indexOf(c) === -1) {
        const col = headers.length + 1;
        sh.getRange(1, col).setValue(c).setFontWeight('bold');
        headers.push(c);
      }
    });
  }
  return sh;
}

function headerMap(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h || ''); });
  const map = {};
  headers.forEach(function (h, i) { if (h && map[h] == null) map[h] = i; });
  return { headers: headers, map: map, width: headers.length };
}
function cellValue(c, v) {
  if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (NUMERIC.indexOf(c) !== -1) return (v === '' || v === null || v === undefined) ? '' : Number(v);
  return v === null || v === undefined ? '' : String(v);
}
function toObj(cols, row, map) {
  const o = {};
  cols.forEach(function (c, i) {
    const idx = map ? map[c] : i;
    o[c] = cellValue(c, idx == null ? '' : row[idx]);
  });
  return o;
}

function readAll(name) {
  const sh = sheet(name), cols = COLUMNS[name];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const hm = headerMap(sh);
  const width = Math.max(hm.width, 1);
  return sh.getRange(2, 1, last - 1, width).getValues().filter(function (r) { return r[0] !== ''; }).map(function (r) { return toObj(cols, r, hm.map); });
}

function findRow(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const hit = sh.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function readDoc(name, id) {
  const sh = sheet(name), r = findRow(sh, id);
  if (!r) return null;
  const hm = headerMap(sh);
  return toObj(COLUMNS[name], sh.getRange(r, 1, 1, Math.max(hm.width, 1)).getValues()[0], hm.map);
}

function writeDoc(name, id, data) {
  const sh = sheet(name), cols = COLUMNS[name];
  data.id = id;
  const hm = headerMap(sh);
  const width = Math.max(hm.width, cols.length);
  const row = new Array(width).fill('');
  cols.forEach(function (c) {
    const idx = hm.map[c];
    if (idx == null) return;
    const v = data[c];
    if (v === null || v === undefined) row[idx] = '';
    else if (NUMERIC.indexOf(c) !== -1) row[idx] = v === '' ? '' : Number(v);
    else row[idx] = String(v).slice(0, (c === 'dataUrl' || c === 'photoData') ? 45000 : 8000);
  });
  const r = findRow(sh, id) || sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, width).setValues([row]);
}

function deleteDoc(name, id) {
  const sh = sheet(name), r = findRow(sh, id);
  if (r) sh.deleteRow(r);
}

/** Run once from the editor to create the tabs and authorize the script. */
function setup() {
  DATA.concat(['applied']).forEach(name => sheet(name));
}

function photoFolder() {
  const name = 'Plant Maintenance Photos';
  const it = DriveApp.getFoldersByName(name);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  return folder;
}

/* Photos go to a Drive folder. If Drive isn't authorized, the phone keeps a
   compressed copy in the sheet instead. The plant code is never written on the file. */
function savePhotoFile(p) {
  const raw = String(p.dataUrl || '');
  const comma = raw.indexOf(',');
  const b64 = comma >= 0 ? raw.slice(comma + 1) : raw;
  if (!b64) return out({ ok: false, error: 'empty photo' });
  try {
    const bytes = Utilities.base64Decode(b64);
    const blob = Utilities.newBlob(bytes, 'image/jpeg', String(p.name || 'photo').replace(/[^\w.-]+/g, '_') + '.jpg');
    const file = photoFolder().createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shareErr) {}
    return out({ ok: true, driveFileId: file.getId(), url: 'https://drive.google.com/uc?export=view&id=' + file.getId(), fallback: false });
  } catch (err) {
    return out({ ok: true, fallback: true, driveFileId: '', url: '', dataUrl: raw.slice(0, 45000) });
  }
}

function alertAddress() {
  const rows = readAll('settings');
  const row = rows.filter(function (r) { return r.id === 'plantcfg'; })[0] || {};
  return String(row.alertEmail || row.digestEmail || '').trim();
}

function sendAlert(p) {
  const to = alertAddress();
  if (!to) return out({ ok: true, skipped: true, message: 'No alert email is saved yet.' });
  const subject = String(p.subject || 'Plant maintenance').slice(0, 180);
  const body = String(p.body || '').slice(0, 8000);
  MailApp.sendEmail(to, subject, body);
  return out({ ok: true, sent: true });
}

function findAssetByTag(tag) {
  const want = String(tag || '').trim().toLowerCase();
  const rows = readAll('assets');
  for (let i = 0; i < rows.length; i++) if (String(rows[i].tag || '').trim().toLowerCase() === want) return rows[i];
  return null;
}

/* ESP32 and the phone both use this. The plant code stays in the request only
   long enough to check it. It is not stored on the reading. */
function ingestSensor(p) {
  const asset = p.assetId ? readDoc('assets', p.assetId) : findAssetByTag(p.tag);
  if (!asset) return out({ ok: false, error: 'unknown asset' });
  const value = Number(p.value);
  if (!isFinite(value)) return out({ ok: false, error: 'bad value' });
  const type = String(p.type || 'other').toLowerCase();
  const name = String(p.name || type).slice(0, 80);
  const limits = readAll('sensorLimits').filter(function (l) { return l.assetId === asset.id && String(l.name).toLowerCase() === name.toLowerCase() && String(l.active) !== 'no'; });
  const limit = limits[0];
  let flag = 'ok';
  if (limit && limit.low !== '' && value < Number(limit.low)) flag = 'low';
  if (limit && limit.high !== '' && value > Number(limit.high)) flag = 'high';
  const id = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  writeDoc('sensorLogs', id, {
    id: id, assetId: asset.id, assetTag: asset.tag, name: name, unit: (limit && limit.unit) || String(p.unit || ''),
    value: value, type: type, date: String(p.date || day).slice(0, 10), source: String(p.source || 'esp32'),
    flag: flag, note: String(p.note || '').slice(0, 500), createdAt: now
  });
  let pmDue = false;
  if (type === 'hours' || type === 'meter' || type === 'cycles') {
    asset.meter = value;
    asset.updatedAt = now;
    writeDoc('assets', asset.id, asset);
    const rid = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    writeDoc('readings', rid, { id: rid, assetId: asset.id, workOrderId: '', reading: value, techId: '', date: day, notes: 'Sensor ' + name, createdAt: now });
  }
  if (flag !== 'ok') {
    const to = alertAddress();
    if (to) {
      try { MailApp.sendEmail(to, asset.tag + ' ' + name + ' is out of range', asset.tag + ' ' + name + ' read ' + value + ' (' + flag + ').'); } catch (mailErr) {}
    }
  }
  return out({ ok: true, id: id, flag: flag, asset: asset.tag, pmDue: pmDue });
}

function digestText() {
  const day = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const lines = ['Plant maintenance — ' + day, ''];
  readAll('assets').forEach(function (a) { if (a.status === 'Down') lines.push('DOWN  ' + a.tag + '  ' + a.name); });
  readAll('workOrders').forEach(function (w) {
    if (w.status !== 'complete' && w.status !== 'cancelled' && w.status !== 'draft' && w.dueDate && w.dueDate < day) {
        var where = w.assetTag || (w.location ? ('No machine · ' + w.location) : 'No machine');
        lines.push('LATE  ' + w.woNumber + '  ' + where + '  ' + w.title);
      }
  });
  readAll('parts').forEach(function (p) {
    if (p.onHand !== '' && p.reorderPoint !== '' && Number(p.onHand) <= Number(p.reorderPoint)) lines.push('LOW   ' + p.sku + '  on hand ' + p.onHand + '  reorder ' + p.reorderPoint);
  });
  if (lines.length === 2) lines.push('Nothing overdue, down, late, or low.');
  return lines.join('\n');
}

/** Time-driven. Run installDigestTrigger once from the editor after you save an email address. */
function plantDigest() {
  const to = alertAddress();
  if (!to) return;
  MailApp.sendEmail(to, 'Plant maintenance morning digest', digestText());
}

/** Run once from the editor. It replaces any older digest trigger. Does not change the web app URL. */
function installDigestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'plantDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('plantDigest').timeBased().everyDays(1).atHour(6).create();
}
