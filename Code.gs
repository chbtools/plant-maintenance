/**
 * Plant Maintenance — Google Sheets backend.
 * Paste this into Extensions → Apps Script on a new Google Sheet.
 * Change ACCESS_CODE before you deploy. It is the plant code the crew types once.
 *
 * Stock counts use a delta (or a recount), matching nextOnHand in js/logic.js.
 * Two phones can use parts and the second save will not put the old count back.
 */
const ACCESS_CODE = 'CHANGE-ME';

const COLUMNS = {
  techs: ['id', 'name', 'role', 'phone', 'email', 'hourlyRate', 'active', 'notes', 'createdAt'],
  assets: ['id', 'tag', 'name', 'area', 'type', 'make', 'model', 'year', 'serial', 'status', 'metered', 'meterType', 'meter', 'notes', 'createdAt', 'updatedAt'],
  levels: ['id', 'assetId', 'name', 'basis', 'everyDays', 'everyMeter', 'active', 'notes', 'createdAt'],
  pmTasks: ['id', 'assetId', 'levelId', 'name', 'instructions', 'partsJson', 'active', 'lastCompletedAt', 'lastMeter', 'lastWoId', 'createdAt'],
  workOrders: ['id', 'woNumber', 'assetId', 'assetTag', 'assetName', 'title', 'description', 'type', 'status', 'priority', 'assignedTo', 'assignedName', 'requestedBy', 'dueDate', 'openedDate', 'completedDate', 'downtimeHours', 'meterAt', 'workPerformed', 'otherCost', 'laborHours', 'laborCost', 'partsCost', 'totalCost', 'pmTaskId', 'source', 'voiceTranscript', 'notes', 'createdAt', 'updatedAt'],
  parts: ['id', 'sku', 'name', 'description', 'bin', 'onHand', 'reorderPoint', 'reorderQty', 'unitCost', 'vendor', 'notes', 'createdAt', 'updatedAt'],
  fits: ['id', 'partId', 'assetId', 'notes', 'addedBy', 'createdAt'],
  uses: ['id', 'workOrderId', 'partId', 'assetId', 'partSku', 'partName', 'qty', 'unitCost', 'extended', 'techId', 'createdAt'],
  timeLogs: ['id', 'workOrderId', 'assetId', 'techId', 'techName', 'date', 'hours', 'rate', 'notes', 'createdAt'],
  readings: ['id', 'assetId', 'workOrderId', 'reading', 'techId', 'date', 'notes', 'createdAt'],
  moves: ['id', 'partId', 'qty', 'reason', 'workOrderId', 'note', 'onHandAfter', 'createdAt'],
  applied: ['id', 'at']
};

const NUMERIC = ['hourlyRate', 'year', 'meter', 'everyDays', 'everyMeter', 'lastMeter', 'downtimeHours', 'meterAt', 'otherCost', 'laborHours', 'laborCost', 'partsCost', 'totalCost', 'onHand', 'reorderPoint', 'reorderQty', 'unitCost', 'qty', 'extended', 'hours', 'rate', 'reading', 'onHandAfter'];
const DATA = ['techs', 'assets', 'levels', 'pmTasks', 'workOrders', 'parts', 'fits', 'uses', 'timeLogs', 'readings', 'moves'];

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
    if (p.action === 'batch') return batch(p);
    if (!COLUMNS[p.collection] || p.collection === 'applied') return out({ ok: false, error: 'unknown collection' });
    if (!okId(p.id)) return out({ ok: false, error: 'bad id' });
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { applyOp({ op: p.action === 'delete' ? 'delete' : 'set', collection: p.collection, id: p.id, data: p.data || {} }); }
    finally { lock.releaseLock(); }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

function batch(p) {
  if (p.batchId && !okId(p.batchId)) return out({ ok: false, error: 'bad batch' });
  const ops = p.ops || [];
  if (!Array.isArray(ops) || ops.length > 80) return out({ ok: false, error: 'bad batch' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (p.batchId && findRow(sheet('applied'), p.batchId)) return out({ ok: true, duplicate: true });
    ops.forEach(op => applyOp(op));
    if (p.batchId) writeDoc('applied', p.batchId, { at: new Date().toISOString() });
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

function applyOp(op) {
  const name = op.collection;
  if (!COLUMNS[name] || name === 'applied') throw new Error('unknown collection');
  if (!okId(op.id)) throw new Error('bad id');
  if (op.op === 'delete') { deleteDoc(name, op.id); return; }
  if (op.op !== 'set' && op.op !== 'update') throw new Error('bad op');
  const data = Object.assign({}, op.data || {});
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
  }
  return sh;
}

function toObj(cols, row) {
  const o = {};
  cols.forEach((c, i) => {
    let v = row[i];
    if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (NUMERIC.indexOf(c) !== -1) v = (v === '' || v === null) ? '' : Number(v);
    else v = v === null ? '' : String(v);
    o[c] = v;
  });
  return o;
}

function readAll(name) {
  const sh = sheet(name), cols = COLUMNS[name];
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getValues().filter(r => r[0] !== '').map(r => toObj(cols, r));
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
  return toObj(COLUMNS[name], sh.getRange(r, 1, 1, COLUMNS[name].length).getValues()[0]);
}

function writeDoc(name, id, data) {
  const sh = sheet(name), cols = COLUMNS[name];
  data.id = id;
  const row = cols.map(c => {
    const v = data[c];
    if (v === null || v === undefined) return '';
    if (NUMERIC.indexOf(c) !== -1) return v === '' ? '' : Number(v);
    return String(v).slice(0, 8000);
  });
  const r = findRow(sh, id) || sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, cols.length).setValues([row]);
}

function deleteDoc(name, id) {
  const sh = sheet(name), r = findRow(sh, id);
  if (r) sh.deleteRow(r);
}

/** Run once from the editor to create the tabs and authorize the script. */
function setup() {
  DATA.concat(['applied']).forEach(name => sheet(name));
}
