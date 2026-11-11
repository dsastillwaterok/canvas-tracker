// Resolves the config's header names to column positions by reading each tab's
// header row. Nothing else in the app knows a column letter.

const fs = require('fs');
const path = require('path');

const REQUIRED = {
  tenants: ['unit', 'name', 'status'],
  interactions: ['date', 'unit', 'canvasser', 'type', 'response'],
  lists: ['canvassers', 'types', 'responses', 'statuses'],
};
const HEADER_CACHE_MS = 5 * 60 * 1000;

function loadConfig(configPath) {
  const p = configPath || process.env.CONFIG_PATH || path.join(__dirname, '..', 'config', 'default.json');
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  cfg._path = p;
  return cfg;
}

const norm = (s) => String(s || '').trim().toLowerCase();

function colLetter(i) {
  let s = ''; i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

class Schema {
  constructor(store, config) {
    this.store = store;
    this.config = config;
    this._tabs = null;
    this._at = 0;
  }

  tabName(tab) { return this.config.tabs[tab]; }

  // Returns { field -> 0-based column index } for a tab, -1 for missing optional fields.
  async tab(tab) {
    if (!this._tabs || Date.now() - this._at > HEADER_CACHE_MS) await this._resolveAll();
    return this._tabs[tab];
  }

  async _resolveAll() {
    const tabs = {};
    for (const tab of ['tenants', 'interactions', 'lists']) {
      const name = this.tabName(tab);
      const rows = await this.store.getValues(`'${name}'!1:1`);
      const headers = (rows[0] || []).map(norm);
      const wanted = this.config.columns[tab];
      const idx = {};
      const missing = [];
      for (const [field, header] of Object.entries(wanted)) {
        const i = headers.indexOf(norm(header));
        idx[field] = i;
        if (i === -1 && REQUIRED[tab].includes(field)) missing.push(`${field} (header "${header}")`);
      }
      if (missing.length) {
        throw new Error(`Tab "${name}" is missing required columns: ${missing.join(', ')}. ` +
          `Rename the headers in the sheet or change config.columns.${tab} in ${this.config._path}.`);
      }
      idx._headers = headers;
      idx._width = headers.length;
      tabs[tab] = idx;
    }
    this._tabs = tabs;
    this._at = Date.now();
  }

  // Which tenant fields this sheet actually has (over the full set the app knows), for the UI.
  async features() {
    const t = await this.tab('tenants');
    const known = Object.keys(loadConfig().columns.tenants);
    const out = {};
    for (const f of known) out[f] = t[f] !== undefined && t[f] !== -1;
    return out;
  }

  isCheckbox(tab, field) { return (this.config.checkboxFields[tab] || []).includes(field); }
  isFormula(tab, field) { return (this.config.formulaFields[tab] || []).includes(field); }

  // A1 range for one cell.
  cell(tabName, colIndex, row) { return `'${tabName}'!${colLetter(colIndex)}${row}`; }
}

module.exports = { Schema, loadConfig, colLetter, REQUIRED };
