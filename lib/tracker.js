// Everything that knows the layout of the Tenant Tracker sheet lives here.
// If a column moves in the sheet, change the maps below and nothing else.

const T = { // Tenants tab, 0-based column indexes
  BUILDING: 0, UNIT: 1, NAME: 2, PHONE: 3, EMAIL: 4, LANGUAGE: 5, ACCESSIBILITY: 6,
  RESIDENTS: 7, HOUSING: 8, GROUP_CHAT: 9, GROUP_MSG: 10, STATUS: 11, SOCIAL_LEAD: 12,
  CONNECTED: 13, OC_MEMBER: 14, TRANSLATOR: 15, STAY: 16, LAWYER: 17, GRIEVANCE_TYPES: 18,
  GRIEVANCES: 19, ORGANIZER: 20, NOTES: 21, LAST_CONTACT: 22, LAST_RESPONSE: 23,
  CONTACTS: 24, CONTACT_STATUS: 25, KEY: 26,
};
const I = { // Interactions tab
  DATE: 0, UNIT: 1, BUILDING: 2, WHO: 3, CANVASSER: 4, TYPE: 5, RESPONSE: 6,
  DISCUSSED: 7, FOLLOW_UP: 8, FOLLOW_UP_DATE: 9, DONE: 10, KEY: 11,
};
const L = { // Lists tab
  STATUS: 0, LANGUAGE: 1, TYPE: 2, RESPONSE: 3, CANVASSER: 4, STAY: 5,
  GRIEVANCE_TYPE: 6, LINK: 7, BUILDING: 8,
};
const TENANTS_WRITE_COLS = 22;  // A..V are typed; W..AA are formulas, never written
const INTERACTIONS_WRITE_COLS = 11; // A..K; L is a formula

const CACHE_MS = 15 * 1000;

const trim = (v) => (v === undefined || v === null ? '' : String(v).trim());
const isTrue = (v) => trim(v).toUpperCase() === 'TRUE';
const colLetter = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

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
  constructor(store, { tz = 'America/Chicago' } = {}) {
    this.store = store;
    this.tz = tz;
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

  async lists() {
    return this._cached('lists', async () => {
      const rows = await this.store.getValues('Lists!A2:I');
      const col = (i) => rows.map((r) => trim(r[i])).filter(Boolean);
      return {
        statuses: col(L.STATUS), languages: col(L.LANGUAGE), types: col(L.TYPE),
        responses: col(L.RESPONSE), canvassers: col(L.CANVASSER), stay: col(L.STAY),
        grievanceTypes: col(L.GRIEVANCE_TYPE), buildings: col(L.BUILDING),
      };
    });
  }

  async tenants() {
    return this._cached('tenants', async () => {
      const rows = await this.store.getValues('Tenants!A2:AA');
      const out = [];
      rows.forEach((r, i) => {
        if (!trim(r[T.UNIT])) return;
        out.push({
          row: i + 2,
          building: trim(r[T.BUILDING]), unit: trim(r[T.UNIT]),
          key: trim(r[T.KEY]) || makeKey(r[T.BUILDING], r[T.UNIT]),
          name: trim(r[T.NAME]), phone: trim(r[T.PHONE]), email: trim(r[T.EMAIL]),
          language: trim(r[T.LANGUAGE]), accessibility: trim(r[T.ACCESSIBILITY]),
          residents: trim(r[T.RESIDENTS]), housing: trim(r[T.HOUSING]),
          groupChat: isTrue(r[T.GROUP_CHAT]), groupMsgOk: isTrue(r[T.GROUP_MSG]),
          status: trim(r[T.STATUS]), socialLead: isTrue(r[T.SOCIAL_LEAD]),
          connected: trim(r[T.CONNECTED]), ocMember: isTrue(r[T.OC_MEMBER]),
          translator: isTrue(r[T.TRANSLATOR]), stay: trim(r[T.STAY]), lawyer: isTrue(r[T.LAWYER]),
          grievanceTypes: splitTags(r[T.GRIEVANCE_TYPES]), grievances: trim(r[T.GRIEVANCES]),
          organizer: trim(r[T.ORGANIZER]), notes: trim(r[T.NOTES]),
          lastContact: trim(r[T.LAST_CONTACT]), lastResponse: trim(r[T.LAST_RESPONSE]),
          contacts: Number(trim(r[T.CONTACTS]) || 0), contactStatus: trim(r[T.CONTACT_STATUS]),
        });
      });
      return out;
    });
  }

  async interactions() {
    return this._cached('interactions', async () => {
      const rows = await this.store.getValues('Interactions!A2:L');
      const out = [];
      rows.forEach((r, i) => {
        if (!trim(r[I.DATE]) && !trim(r[I.UNIT])) return;
        out.push({
          row: i + 2, date: trim(r[I.DATE]), unit: trim(r[I.UNIT]), building: trim(r[I.BUILDING]),
          key: trim(r[I.KEY]) || makeKey(r[I.BUILDING], r[I.UNIT]),
          who: trim(r[I.WHO]), canvasser: trim(r[I.CANVASSER]), type: trim(r[I.TYPE]),
          response: trim(r[I.RESPONSE]), discussed: trim(r[I.DISCUSSED]),
          followUp: trim(r[I.FOLLOW_UP]), followUpDate: trim(r[I.FOLLOW_UP_DATE]), done: isTrue(r[I.DONE]),
        });
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

  // The checkbox columns put a value on every row, so "last row" has to be found
  // from a column that is only filled on real rows.
  async _lastFilledRow(tab, colLetterToCheck) {
    const rows = await this.store.getValues(`${tab}!${colLetterToCheck}1:${colLetterToCheck}`);
    let last = 1;
    rows.forEach((r, i) => { if (trim(r[0])) last = i + 1; });
    return last;
  }

  async logInteraction(input) {
    const building = trim(input.building);
    const unit = trim(input.unit);
    if (!unit) throw new Error('Unit is required');
    if (!trim(input.canvasser)) throw new Error('Canvasser is required');
    if (!trim(input.type) || !trim(input.response)) throw new Error('Type and response are required');
    const key = makeKey(building, unit);

    const row = new Array(INTERACTIONS_WRITE_COLS).fill('');
    row[I.DATE] = fmtDateTime(new Date(), this.tz);
    row[I.UNIT] = unit;
    row[I.BUILDING] = building;
    row[I.WHO] = trim(input.who);
    row[I.CANVASSER] = trim(input.canvasser);
    row[I.TYPE] = trim(input.type);
    row[I.RESPONSE] = trim(input.response);
    row[I.DISCUSSED] = trim(input.discussed);
    row[I.FOLLOW_UP] = trim(input.followUp);
    row[I.FOLLOW_UP_DATE] = fmtDateOnly(input.followUpDate);
    row[I.DONE] = false;

    const at = (await this._lastFilledRow('Interactions', 'A')) + 1;
    await this.store.updateValues(`Interactions!A${at}:${colLetter(INTERACTIONS_WRITE_COLS - 1)}${at}`, [row]);

    const created = await this._ensureTenant(building, unit, row[I.WHO], row[I.RESPONSE]);
    await this._updateContact(key, trim(input.phone), trim(input.email));
    this.invalidate();
    return { key, created, interactionRow: at };
  }

  async _ensureTenant(building, unit, name, response) {
    const key = makeKey(building, unit);
    const existing = (await this.tenants()).find((t) => t.key === key);
    if (existing) return false;
    const row = new Array(TENANTS_WRITE_COLS).fill('');
    row[T.BUILDING] = trim(building);
    row[T.UNIT] = trim(unit);
    row[T.NAME] = trim(name);
    row[T.GROUP_CHAT] = false; row[T.GROUP_MSG] = false; row[T.SOCIAL_LEAD] = false;
    row[T.OC_MEMBER] = false; row[T.TRANSLATOR] = false; row[T.LAWYER] = false;
    row[T.STATUS] = trim(response) === 'No answer' ? 'No answer' : 'Contacted';
    const at = (await this._lastFilledRow('Tenants', 'B')) + 1;
    await this.store.updateValues(`Tenants!A${at}:${colLetter(TENANTS_WRITE_COLS - 1)}${at}`, [row]);
    this.invalidate();
    return true;
  }

  async _updateContact(key, phone, email) {
    if (!phone && !email) return;
    const t = (await this.tenants()).find((x) => x.key === key);
    if (!t) return;
    if (phone) await this.store.updateValues(`Tenants!${colLetter(T.PHONE)}${t.row}`, [[phone]]);
    if (email) await this.store.updateValues(`Tenants!${colLetter(T.EMAIL)}${t.row}`, [[email]]);
  }

  // Fields organizers may edit from the tenant screen. Anything else stays sheet-only.
  async updateTenant(key, fields) {
    const t = (await this.tenants()).find((x) => x.key === key);
    if (!t) throw new Error('No tenant with key ' + key);
    const allowed = {
      name: T.NAME, phone: T.PHONE, email: T.EMAIL, status: T.STATUS,
      groupChat: T.GROUP_CHAT, socialLead: T.SOCIAL_LEAD, accessibility: T.ACCESSIBILITY,
      residents: T.RESIDENTS, housing: T.HOUSING, grievanceTypes: T.GRIEVANCE_TYPES,
      grievances: T.GRIEVANCES, connected: T.CONNECTED, notes: T.NOTES,
    };
    const writes = [];
    for (const [k, col] of Object.entries(allowed)) {
      if (!(k in fields)) continue;
      let v = fields[k];
      if (Array.isArray(v)) v = v.join(', ');
      if (typeof v === 'boolean') { /* keep */ } else v = trim(v);
      writes.push(this.store.updateValues(`Tenants!${colLetter(col)}${t.row}`, [[v]]));
    }
    await Promise.all(writes);
    this.invalidate();
    return this.tenant(key);
  }

  async markFollowUpDone(row) {
    await this.store.updateValues(`Interactions!${colLetter(I.DONE)}${row}`, [[true]]);
    this.invalidate();
  }
}

module.exports = { Tracker, makeKey, splitTags, fmtDateTime, fmtDateOnly, T, I, L };
