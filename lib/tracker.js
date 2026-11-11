// Reads and writes the tracker sheet through the Schema, so every column is
// found by its header name and nothing here depends on column order.

const { colLetter } = require('./schema');

const CACHE_MS = 15 * 1000;

const trim = (v) => (v === undefined || v === null ? '' : String(v).trim());
const isTrue = (v) => trim(v).toUpperCase() === 'TRUE';

function makeKey(building, unit) {
  const b = trim(building), u = trim(unit);
  if (!u) return '';
  return b ? `${b}-${u}` : u;
}

function splitTags(s) {
  return trim(s) ? trim(s).split(',').map((x) => x.trim()).filter(Boolean) : [];
}

function fmtDateTime(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.month}/${p.day}/${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

// "2026-11-18" (from an <input type=date>) -> "11/18/2026" so Sheets parses it as a date.
function fmtDateOnly(s) {
  const m = trim(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : trim(s);
}

class Tracker {
  constructor(store, schema) {
    this.store = store;
    this.schema = schema;
    this.config = schema.config;
    this.tz = schema.config.timeZone || 'America/Chicago';
    this._cache = {};
  }

  _cached(name, loader) {
    const c = this._cache[name];
    if (c && Date.now() - c.at < CACHE_MS) return c.value;
    const value = loader();
    this._cache[name] = { at: Date.now(), value };
    return value;
  }
  invalidate() { this._cache = {}; }

  _range(tab, fromRow) {
    const name = this.schema.tabName(tab);
    return `'${name}'!A${fromRow}:${colLetter(Math.max(0, this._width(tab) - 1))}`;
  }
  _width(tab) { return (this.schema._tabs && this.schema._tabs[tab] && this.schema._tabs[tab]._width) || 60; }

  // Turn a raw row into an object keyed by field name. Checkbox fields become booleans,
  // the grievance tag field becomes an array, missing optional columns are left undefined.
  _rowToObject(tab, r, i, cols) {
    const o = { row: i + 2 };
    for (const [field, idx] of Object.entries(cols)) {
      if (field.startsWith('_') || idx === -1) continue;
      const v = r[idx];
      if (this.schema.isCheckbox(tab, field)) o[field] = isTrue(v);
      else if (field === 'grievanceTypes') o[field] = splitTags(v);
      else if (field === 'contacts') o[field] = Number(trim(v) || 0);
      else o[field] = trim(v).startsWith('=') ? '' : trim(v); // a raw formula means "not computed"; fall back below
    }
    return o;
  }

  async lists() {
    return this._cached('lists', async () => {
      const cols = await this.schema.tab('lists');
      const rows = await this.store.getValues(this._range('lists', 2));
      const out = {};
      for (const [field, idx] of Object.entries(cols)) {
        if (field.startsWith('_')) continue;
        out[field] = idx === -1 ? [] : rows.map((r) => trim(r[idx])).filter(Boolean);
      }
      return out;
    });
  }

  async tenants() {
    return this._cached('tenants', async () => {
      const cols = await this.schema.tab('tenants');
      const rows = await this.store.getValues(this._range('tenants', 2));
      const out = [];
      rows.forEach((r, i) => {
        if (!trim(r[cols.unit])) return;
        const o = this._rowToObject('tenants', r, i, cols);
        o.building = o.building || '';
        if (!o.key) o.key = makeKey(o.building, o.unit);
        out.push(o);
      });
      return out;
    });
  }

  async interactions() {
    return this._cached('interactions', async () => {
      const cols = await this.schema.tab('interactions');
      const rows = await this.store.getValues(this._range('interactions', 2));
      const out = [];
      rows.forEach((r, i) => {
        if (!trim(r[cols.date]) && !trim(r[cols.unit])) return;
        const o = this._rowToObject('interactions', r, i, cols);
        o.building = o.building || '';
        if (!o.key) o.key = makeKey(o.building, o.unit);
        out.push(o);
      });
      return out;
    });
  }

  async tenant(key) {
    const t = (await this.tenants()).find((x) => x.key === key);
    if (!t) return null;
    const history = (await this.interactions()).filter((x) => x.key === key).reverse();
    return { ...t, history };
  }

  // The checkbox columns put a value on every row, so "last row" is found from a
  // column that is only filled on real rows.
  async _lastFilledRow(tab, field) {
    const cols = await this.schema.tab(tab);
    const name = this.schema.tabName(tab);
    const L = colLetter(cols[field]);
    const rows = await this.store.getValues(`'${name}'!${L}1:${L}`);
    let last = 1;
    rows.forEach((r, i) => { if (trim(r[0])) last = i + 1; });
    return last;
  }

  // Build a sheet row from {field: value}. Formula columns and unknown columns get
  // null, which the Sheets API treats as "leave this cell alone".
  _buildRow(tab, cols, values) {
    const width = cols._width;
    const row = new Array(width).fill(null);
    for (const [field, idx] of Object.entries(cols)) {
      if (field.startsWith('_') || idx === -1 || idx >= width) continue;
      if (this.schema.isFormula(tab, field)) continue;
      if (field in values) row[idx] = values[field];
      else if (this.schema.isCheckbox(tab, field)) row[idx] = false;
      else row[idx] = '';
    }
    // Extra questions configured by header text (config.extraFields).
    for (const [header, v] of Object.entries(values._extra || {})) {
      const idx = cols._headers.indexOf(String(header).trim().toLowerCase());
      if (idx !== -1 && idx < width) row[idx] = trim(v);
    }
    return row;
  }

  async logInteraction(input) {
    const building = trim(input.building);
    const unit = trim(input.unit);
    if (!unit) throw new Error('Unit is required');
    if (!trim(input.canvasser)) throw new Error('Canvasser is required');
    if (!trim(input.type) || !trim(input.response)) throw new Error('Type and response are required');
    const key = makeKey(building, unit);

    const cols = await this.schema.tab('interactions');
    const row = this._buildRow('interactions', cols, {
      date: fmtDateTime(new Date(), this.tz), unit, building,
      who: trim(input.who), canvasser: trim(input.canvasser), type: trim(input.type),
      response: trim(input.response), discussed: trim(input.discussed),
      followUp: trim(input.followUp), followUpDate: fmtDateOnly(input.followUpDate), done: false,
      _extra: (input.extra && typeof input.extra === 'object') ? input.extra : {},
    });
    const at = (await this._lastFilledRow('interactions', 'date')) + 1;
    await this.store.updateValues(`'${this.schema.tabName('interactions')}'!A${at}`, [row]);

    const created = await this._ensureTenant(building, unit, trim(input.who), trim(input.response));
    await this._updateContact(key, trim(input.phone), trim(input.email));
    if (building) await this._ensureListValue('buildings', building);
    this.invalidate();
    return { key, created, interactionRow: at };
  }

  // Add a value to a Lists column if it is not there yet (new buildings typed at the door).
  async _ensureListValue(field, value) {
    const cols = await this.schema.tab('lists');
    if (cols[field] === undefined || cols[field] === -1) return false;
    const have = (await this.lists())[field] || [];
    if (have.includes(value)) return false;
    const at = (await this._lastFilledRow('lists', field)) + 1;
    await this.store.updateValues(this.schema.cell(this.schema.tabName('lists'), cols[field], at), [[value]]);
    this.invalidate();
    return true;
  }

  async _ensureTenant(building, unit, name, response) {
    const key = makeKey(building, unit);
    if ((await this.tenants()).find((t) => t.key === key)) return false;
    const cols = await this.schema.tab('tenants');
    const ns = this.config.newUnitStatus || {};
    const status = (ns.whenResponseIs && ns.whenResponseIs[response]) || ns.otherwise || 'Contacted';
    const row = this._buildRow('tenants', cols, { building, unit, name, status });
    const at = (await this._lastFilledRow('tenants', 'unit')) + 1;
    await this.store.updateValues(`'${this.schema.tabName('tenants')}'!A${at}`, [row]);
    this.invalidate();
    return true;
  }

  async _updateContact(key, phone, email) {
    if (!phone && !email) return;
    const t = (await this.tenants()).find((x) => x.key === key);
    if (!t) return;
    const fields = {};
    if (phone) fields.phone = phone;
    if (email) fields.email = email;
    await this._writeFields(t.row, fields);
  }

  async _writeFields(row, fields) {
    const cols = await this.schema.tab('tenants');
    const name = this.schema.tabName('tenants');
    const writes = [];
    for (const [field, v] of Object.entries(fields)) {
      const idx = cols[field];
      if (idx === undefined || idx === -1 || this.schema.isFormula('tenants', field)) continue;
      let val = v;
      if (Array.isArray(val)) val = val.join(', ');
      else if (typeof val !== 'boolean') val = trim(val);
      writes.push(this.store.updateValues(this.schema.cell(name, idx, row), [[val]]));
    }
    await Promise.all(writes);
  }

  // Fields organizers may edit from the tenant screen, per config.editableFields.
  async updateTenant(key, fields) {
    const t = (await this.tenants()).find((x) => x.key === key);
    if (!t) throw new Error('No tenant with key ' + key);
    const allowed = new Set(this.config.editableFields || []);
    const picked = {};
    for (const [k, v] of Object.entries(fields)) if (allowed.has(k)) picked[k] = v;
    await this._writeFields(t.row, picked);
    this.invalidate();
    return this.tenant(key);
  }

  async markFollowUpDone(row) {
    const cols = await this.schema.tab('interactions');
    if (cols.done === -1) throw new Error('This sheet has no follow-up done column');
    await this.store.updateValues(this.schema.cell(this.schema.tabName('interactions'), cols.done, row), [[true]]);
    this.invalidate();
  }
}

module.exports = { Tracker, makeKey, splitTags, fmtDateTime, fmtDateOnly };
