// Thin wrapper over the Google Sheets API. Everything the app reads or writes
// goes through getValues / updateValues so the rest of the code never touches
// googleapis directly, and tests can swap in the in-memory MockStore below.

const { google } = require('googleapis');

class SheetStore {
  constructor({ sheetId, credentialsJson }) {
    if (!sheetId) throw new Error('SHEET_ID is not set');
    if (!credentialsJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
    const creds = JSON.parse(credentialsJson);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheetId = sheetId;
    this.api = google.sheets({ version: 'v4', auth });
  }

  // Returns a 2D array of displayed values (dates come back formatted as shown in the sheet).
  async getValues(range) {
    const res = await this.api.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    return res.data.values || [];
  }

  // Writes a 2D array starting at the top-left of `range`. USER_ENTERED so dates
  // and TRUE/FALSE are parsed the way typing them would be.
  async updateValues(range, values) {
    await this.api.spreadsheets.values.update({
      spreadsheetId: this.sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }
}

// In-memory stand-in with the same interface, for local development and tests.
// Seeded with a small slice of realistic data so the UI has something to show.
class MockStore {
  constructor(seed) {
    this.tabs = seed;
  }
  _parse(range) {
    const m = range.match(/^'?([^'!]+)'?!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
    if (!m) throw new Error('MockStore cannot parse range ' + range);
    const col = (s) => s.split('').reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
    return {
      tab: m[1],
      r0: m[3] ? parseInt(m[3], 10) - 1 : 0,
      c0: col(m[2]),
      r1: m[5] ? parseInt(m[5], 10) - 1 : Infinity,
      c1: m[4] ? col(m[4]) : col(m[2]),
    };
  }
  async getValues(range) {
    const { tab, r0, c0, r1, c1 } = this._parse(range);
    const rows = this.tabs[tab] || [];
    const out = [];
    for (let r = r0; r <= Math.min(r1, rows.length - 1); r++) {
      const row = rows[r] || [];
      out.push(row.slice(c0, c1 + 1).map((v) => (v === undefined || v === null ? '' : String(v))));
    }
    while (out.length && out[out.length - 1].every((v) => v === '')) out.pop();
    return out;
  }
  async updateValues(range, values) {
    const { tab, r0, c0 } = this._parse(range);
    const rows = (this.tabs[tab] = this.tabs[tab] || []);
    values.forEach((vals, i) => {
      const row = (rows[r0 + i] = rows[r0 + i] || []);
      vals.forEach((v, j) => { row[c0 + j] = v; });
    });
  }
}

module.exports = { SheetStore, MockStore };
