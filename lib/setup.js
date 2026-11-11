// Setup: inspect a sheet, guess a column mapping, build a fresh tracker sheet,
// and read/write the app's config from a hidden tab inside the sheet itself.

const { colLetter } = require('./schema');

const CONFIG_TAB = 'Canvass config';

// ---- config in the sheet -------------------------------------------------------

async function readSheetConfig(store) {
  try {
    const rows = await store.getValues(`'${CONFIG_TAB}'!A2:A2`);
    const text = rows[0] && rows[0][0];
    return text ? JSON.parse(text) : null;
  } catch (e) {
    return null; // tab does not exist yet
  }
}

async function writeSheetConfig(store, config) {
  const clean = { ...config }; delete clean._path;
  const meta = await store.meta();
  const exists = (meta.sheets || []).some((s) => s.properties.title === CONFIG_TAB);
  if (!exists) {
    await store.batchUpdate([{ addSheet: { properties: { title: CONFIG_TAB, hidden: true, gridProperties: { rowCount: 5, columnCount: 2 } } } }]);
  }
  await store.updateValues(`'${CONFIG_TAB}'!A1`, [
    ['Settings for the canvass app. Edit them at /admin, not here.'],
    [JSON.stringify(clean)],
  ]);
}

// ---- inspect an existing sheet -------------------------------------------------

async function inspectSheet(store) {
  const meta = await store.meta();
  const tabs = [];
  for (const s of meta.sheets || []) {
    const title = s.properties.title;
    if (title === CONFIG_TAB) continue;
    const rows = await store.getValues(`'${title}'!A1:AZ6`);
    const headers = (rows[0] || []).map((h) => String(h || '').trim());
    const samples = rows.slice(1, 6);
    const filled = samples.filter((r) => r.some((v) => String(v || '').trim())).length;
    tabs.push({ title, sheetId: s.properties.sheetId, headers, samples, filled, hidden: !!s.properties.hidden });
  }
  return { title: meta.properties && meta.properties.title, tabs };
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));

// Score how well a header matches a wanted header name: exact > contains > shared words.
function matchScore(header, wanted, aliases = []) {
  const h = norm(header);
  if (!h) return 0;
  const cands = [wanted, ...aliases].map(norm);
  let best = 0;
  for (const c of cands) {
    if (h === c) return 100;
    if (h.includes(c) || c.includes(h)) best = Math.max(best, 70);
    const a = tokens(h), b = tokens(c);
    const shared = [...a].filter((x) => b.has(x)).length;
    if (shared) best = Math.max(best, Math.round(50 * shared / Math.max(a.size, b.size)));
  }
  return best;
}

// Words people use for the same thing in home-grown tenant spreadsheets.
const ALIASES = {
  tenants: {
    building: ['bldg', 'building number', 'building #'],
    unit: ['apt', 'apartment', 'unit #', 'apt #', 'unit number', 'door'],
    name: ['tenant', 'resident', 'resident name', 'tenant name', 'contact'],
    phone: ['phone #', 'phone number', 'cell', 'mobile', 'telephone'],
    email: ['e-mail', 'email address'],
    language: ['language', 'preferred language', 'lang'],
    accessibility: ['accessibility', 'visit notes', 'mobility', 'safety issues'],
    residents: ['residents', 'household size', 'how many live'],
    housing: ['hud', 'section 8', 'voucher', 'housing assistance', 'subsidy'],
    groupChat: ['whatsapp', 'group chat', 'fb group', 'facebook', 'signal'],
    groupMsgOk: ['group message', 'ok to text', 'text ok'],
    status: ['status', 'stage', 'call status', 'membership'],
    socialLead: ['social lead', 'leader', 'potential leader', 'resident leader'],
    connected: ['friends', 'knows', 'connected', 'neighbors'],
    ocMember: ['oc', 'organizing committee', 'committee'],
    translator: ['translator', 'bilingual', 'interpreter'],
    stay: ['planning on staying', 'staying', 'moving'],
    lawyer: ['lawyer', 'legal', 'attorney'],
    grievanceTypes: ['grievance type', 'issue type', 'tags', 'categories', 'issues'],
    grievances: ['grievances', 'complaints', 'concerns', 'main concern', 'issues'],
    organizer: ['organizer', 'otu contact', 'main contact', 'assigned'],
    notes: ['notes', 'open notes', 'extra notes', 'comments'],
    lastContact: ['last contact', 'last follow up', 'last touched'],
    lastResponse: ['last response'],
    contacts: ['contacts logged', 'attempts', 'touches'],
    contactStatus: ['contact status', 'needs contact'],
    key: ['unit key', 'key', 'id'],
  },
  interactions: {
    date: ['date', 'timestamp', 'when'],
    unit: ['apt', 'apartment', 'unit #'],
    building: ['bldg'],
    who: ['who', 'spoke with', 'talked to', 'name', 'tenant'],
    canvasser: ['canvasser', 'organizer', 'volunteer', 'caller', 'by'],
    type: ['type', 'method', 'how', 'contact type'],
    response: ['response', 'outcome', 'result', 'call status'],
    discussed: ['discussed', 'discussion', 'notes', 'summary', 'conversation'],
    followUp: ['follow up', 'action items', 'next step', 'to do'],
    followUpDate: ['follow up date', 'due', 'by when'],
    done: ['done', 'completed', 'resolved'],
    key: ['unit key', 'key'],
  },
  lists: {
    statuses: ['status', 'statuses', 'stages'],
    languages: ['language', 'languages'],
    types: ['interaction type', 'types', 'contact type', 'method'],
    responses: ['response', 'responses', 'outcomes'],
    canvassers: ['canvassers', 'organizers', 'volunteers', 'names'],
    stay: ['planning to stay', 'staying'],
    grievanceTypes: ['grievance type', 'grievance types', 'issue types', 'tags'],
    links: ['personal link', 'link', 'form link'],
    buildings: ['building', 'buildings', 'bldg'],
  },
};

// Guess which tab plays which role, by how many of the role's headers it matches.
function guessTabs(inspect, config) {
  const score = (tab, role) => {
    let s = 0;
    for (const [field, header] of Object.entries(config.columns[role])) {
      const best = Math.max(0, ...tab.headers.map((h) => matchScore(h, header, (ALIASES[role] || {})[field])));
      if (best >= 50) s += best;
    }
    return s;
  };
  const out = {};
  const used = new Set();
  for (const role of ['tenants', 'interactions', 'lists']) {
    let best = null, bestScore = 0;
    for (const t of inspect.tabs) {
      if (used.has(t.title)) continue;
      const s = score(t, role);
      if (s > bestScore) { best = t; bestScore = s; }
    }
    if (best && bestScore > 0) { out[role] = best.title; used.add(best.title); }
  }
  return out;
}

// For one role and one tab: field -> {header, score} guesses, each header used once.
function guessColumns(tab, role, config) {
  const wanted = config.columns[role];
  const pairs = [];
  for (const [field, header] of Object.entries(wanted)) {
    tab.headers.forEach((h, i) => {
      if (!h) return;
      const s = matchScore(h, header, (ALIASES[role] || {})[field]);
      if (s >= 50) pairs.push({ field, header: h, i, s });
    });
  }
  pairs.sort((a, b) => b.s - a.s);
  const byField = {}, usedCol = new Set();
  for (const p of pairs) {
    if (byField[p.field] || usedCol.has(p.i)) continue;
    byField[p.field] = { header: p.header, score: p.s };
    usedCol.add(p.i);
  }
  return byField;
}

// ---- build a new sheet ---------------------------------------------------------

const HEADER_STYLE = {
  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontFamily: 'Arial', fontSize: 10 },
  backgroundColor: { red: 0.122, green: 0.22, blue: 0.392 }, verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP',
};

/**
 * Build Tenants / Interactions / Lists / Dashboard tabs from a config on a sheet
 * that has nothing but the default empty tab. Returns the config actually used.
 */
async function buildSheet(store, config, opts = {}) {
  const C = config.columns;
  const lists = { ...config.defaultLists, ...(opts.lists || {}) };
  const tabs = config.tabs;
  const ids = { tenants: 1001, interactions: 1002, lists: 1003, dashboard: 1004 };

  const tCols = Object.keys(C.tenants), iCols = Object.keys(C.interactions), lCols = Object.keys(C.lists);
  const tIdx = Object.fromEntries(tCols.map((k, i) => [k, i]));
  const iIdx = Object.fromEntries(iCols.map((k, i) => [k, i]));
  const lIdx = Object.fromEntries(lCols.map((k, i) => [k, i]));
  const L = colLetter;

  // 1. Tabs
  const meta = await store.meta();
  const existing = (meta.sheets || []).map((s) => s.properties.title);
  for (const t of ['tenants', 'interactions', 'lists', 'dashboard']) {
    if (existing.includes(tabs[t])) throw new Error(`A tab named "${tabs[t]}" already exists. Use a blank sheet, or map the existing sheet instead.`);
  }
  await store.batchUpdate([
    { addSheet: { properties: { sheetId: ids.tenants, title: tabs.tenants, index: 0, gridProperties: { rowCount: 1000, columnCount: tCols.length } } } },
    { addSheet: { properties: { sheetId: ids.interactions, title: tabs.interactions, index: 1, gridProperties: { rowCount: 1000, columnCount: iCols.length } } } },
    { addSheet: { properties: { sheetId: ids.dashboard, title: tabs.dashboard, index: 2, gridProperties: { rowCount: 200, columnCount: 8 } } } },
    { addSheet: { properties: { sheetId: ids.lists, title: tabs.lists, index: 3, gridProperties: { rowCount: 200, columnCount: lCols.length } } } },
  ]);

  // 2. Headers + lists
  await store.updateValues(`'${tabs.tenants}'!A1`, [tCols.map((k) => C.tenants[k])]);
  await store.updateValues(`'${tabs.interactions}'!A1`, [iCols.map((k) => C.interactions[k])]);
  const n = Math.max(1, ...lCols.map((k) => (lists[k] || []).length));
  const listRows = [lCols.map((k) => C.lists[k])];
  for (let i = 0; i < n; i++) listRows.push(lCols.map((k) => (lists[k] || [])[i] || ''));
  await store.updateValues(`'${tabs.lists}'!A1`, listRows);

  // 3. Formulas (only for the formula fields that exist in this config)
  const TN = `'${tabs.tenants}'`, IN = `'${tabs.interactions}'`, DN = `'${tabs.dashboard}'`;
  const tb = tIdx.building, tu = tIdx.unit, ib = iIdx.building, iu = iIdx.unit;
  const keyT = (tb !== undefined)
    ? `=ARRAYFORMULA(IF(${L(tu)}2:${L(tu)}="","",IF(${L(tb)}2:${L(tb)}="",TO_TEXT(${L(tu)}2:${L(tu)}),TO_TEXT(${L(tb)}2:${L(tb)})&"-"&TO_TEXT(${L(tu)}2:${L(tu)}))))`
    : `=ARRAYFORMULA(IF(${L(tu)}2:${L(tu)}="","",TO_TEXT(${L(tu)}2:${L(tu)})))`;
  const keyI = (ib !== undefined)
    ? `=ARRAYFORMULA(IF(${L(iu)}2:${L(iu)}="","",IF(${L(ib)}2:${L(ib)}="",TO_TEXT(${L(iu)}2:${L(iu)}),TO_TEXT(${L(ib)}2:${L(ib)})&"-"&TO_TEXT(${L(iu)}2:${L(iu)}))))`
    : `=ARRAYFORMULA(IF(${L(iu)}2:${L(iu)}="","",TO_TEXT(${L(iu)}2:${L(iu)})))`;
  const formulas = {};
  const K = L(tIdx.key), IK = L(iIdx.key), ID = L(iIdx.date), IR = L(iIdx.response);
  const sorted = `SORT({${IN}!${IK}2:${IK},${IN}!${ID}2:${ID},${IN}!${IR}2:${IR}},2,FALSE)`;
  if (tIdx.key !== undefined) formulas.key = keyT;
  if (tIdx.lastContact !== undefined) formulas.lastContact = `=ARRAYFORMULA(IF(${K}2:${K}="","",IFERROR(VLOOKUP(${K}2:${K},${sorted},2,FALSE),"")))`;
  if (tIdx.lastResponse !== undefined) formulas.lastResponse = `=ARRAYFORMULA(IF(${K}2:${K}="","",IFERROR(VLOOKUP(${K}2:${K},${sorted},3,FALSE),"")))`;
  if (tIdx.contacts !== undefined) formulas.contacts = `=ARRAYFORMULA(IF(${K}2:${K}="","",COUNTIF(${IN}!${IK}2:${IK},${K}2:${K})))`;
  if (tIdx.contactStatus !== undefined && tIdx.lastContact !== undefined) {
    const S = L(tIdx.status), LC = L(tIdx.lastContact);
    const cs = config.contactStatus || {};
    const dead = (cs.deadEndStatuses || []).map((s) => `(${S}2:${S}="${s}")`).join('+') || '(FALSE)';
    const lab = cs.labels || {};
    const over = (lab.overdue || 'Overdue: {days} days').split('{days}');
    const rec = (lab.recent || 'Contacted {days} days ago').split('{days}');
    formulas.contactStatus = `=ARRAYFORMULA(IF(${K}2:${K}="","",IF(${dead}>0,"${lab.deadEnd || 'Dead end'}",IF(N(${LC}2:${LC})=0,"${lab.never || 'Never contacted'}",IF(TODAY()-INT(N(${LC}2:${LC}))>${DN}!$B$3,"${over[0]}"&(TODAY()-INT(N(${LC}2:${LC})))&"${over[1] || ''}","${rec[0]}"&(TODAY()-INT(N(${LC}2:${LC})))&"${rec[1] || ''}")))))`;
  }
  for (const [field, f] of Object.entries(formulas)) await store.updateValues(`${TN}!${L(tIdx[field])}2`, [[f]]);
  if (iIdx.key !== undefined) await store.updateValues(`${IN}!${IK}2`, [[keyI]]);

  // 4. Dashboard
  const S = L(tIdx.status), CS = tIdx.contactStatus !== undefined ? L(tIdx.contactStatus) : null;
  const dash = [
    [config.appName || 'Campaign', ''],
    ['', ''],
    ['Stale after (days)', (config.contactStatus || {}).staleAfterDays || 30],
    ['Units entered', `=COUNTIF(${TN}!${K}2:${K},"?*")`],
    CS ? ['Never contacted or overdue', `=COUNTIF(${TN}!${CS}:${CS},"${(config.contactStatus || {}).labels?.never || 'Never contacted'}")+COUNTIF(${TN}!${CS}:${CS},"Overdue*")`] : ['', ''],
    ['', ''],
    ['Status', 'Units'],
  ];
  (lists.statuses || []).forEach((s, i) => dash.push([`='${tabs.lists}'!${L(lIdx.statuses)}${i + 2}`, `=IF(A${8 + i}="","",COUNTIF(${TN}!$${S}:$${S},A${8 + i}))`]));
  await store.updateValues(`${DN}!A1`, dash);

  // 5. Formatting, checkboxes, dropdowns
  const req = [];
  const header = (sheetId, width) => ({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: width }, cell: { userEnteredFormat: HEADER_STYLE }, fields: 'userEnteredFormat' } });
  const freeze = (sheetId, cols) => ({ updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1, frozenColumnCount: cols } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } });
  const textCol = (sheetId, c) => ({ repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } });
  const dateCol = (sheetId, c) => ({ repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } });
  const checkbox = (sheetId, c) => ({ setDataValidation: { range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: c, endColumnIndex: c + 1 }, rule: { condition: { type: 'BOOLEAN' }, strict: true } } });
  const dropdown = (sheetId, c, listField) => ({ setDataValidation: { range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: c, endColumnIndex: c + 1 }, rule: { condition: { type: 'ONE_OF_RANGE', values: [{ userEnteredValue: `='${tabs.lists}'!$${L(lIdx[listField])}$2:$${L(lIdx[listField])}$200` }] }, showCustomUi: true, strict: false } } });
  const width = (sheetId, c, px) => ({ updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });

  req.push(header(ids.tenants, tCols.length), header(ids.interactions, iCols.length), header(ids.lists, lCols.length), header(ids.dashboard, 2));
  req.push(freeze(ids.tenants, tb !== undefined ? 3 : 2), freeze(ids.interactions, 0), freeze(ids.lists, 0));
  for (const f of ['building', 'unit', 'phone']) if (tIdx[f] !== undefined) req.push(textCol(ids.tenants, tIdx[f]));
  for (const f of ['building', 'unit']) if (iIdx[f] !== undefined) req.push(textCol(ids.interactions, iIdx[f]));
  if (tIdx.lastContact !== undefined) req.push(dateCol(ids.tenants, tIdx.lastContact));
  if (iIdx.date !== undefined) req.push(dateCol(ids.interactions, iIdx.date));
  if (iIdx.followUpDate !== undefined) req.push(dateCol(ids.interactions, iIdx.followUpDate));
  for (const f of config.checkboxFields.tenants || []) if (tIdx[f] !== undefined) req.push(checkbox(ids.tenants, tIdx[f]));
  for (const f of config.checkboxFields.interactions || []) if (iIdx[f] !== undefined) req.push(checkbox(ids.interactions, iIdx[f]));
  const dd = [['tenants', 'status', 'statuses'], ['tenants', 'language', 'languages'], ['tenants', 'stay', 'stay'], ['tenants', 'housing', 'stay'], ['tenants', 'organizer', 'canvassers'], ['tenants', 'building', 'buildings'], ['tenants', 'grievanceTypes', 'grievanceTypes'],
    ['interactions', 'canvasser', 'canvassers'], ['interactions', 'type', 'types'], ['interactions', 'response', 'responses'], ['interactions', 'building', 'buildings']];
  for (const [tab, f, lf] of dd) {
    const idx = tab === 'tenants' ? tIdx : iIdx;
    if (idx[f] !== undefined && lIdx[lf] !== undefined) req.push(dropdown(ids[tab], idx[f], lf));
  }
  tCols.forEach((k, i) => req.push(width(ids.tenants, i, ['grievances', 'notes', 'accessibility', 'grievanceTypes'].includes(k) ? 220 : ['name', 'email', 'connected'].includes(k) ? 170 : 100)));
  iCols.forEach((k, i) => req.push(width(ids.interactions, i, ['discussed', 'followUp'].includes(k) ? 300 : ['who'].includes(k) ? 170 : 100)));
  req.push(width(ids.dashboard, 0, 230), width(ids.dashboard, 1, 120));
  lCols.forEach((k, i) => req.push(width(ids.lists, i, k === 'links' ? 320 : 160)));
  // Delete the default empty "Sheet1" if it is still empty.
  const sheet1 = (meta.sheets || []).find((s) => /^Sheet1$/i.test(s.properties.title));
  if (sheet1) {
    const vals = await store.getValues(`'${sheet1.properties.title}'!A1:C3`);
    if (!vals.length) req.push({ deleteSheet: { sheetId: sheet1.properties.sheetId } });
  }
  await store.batchUpdate(req);
  return config;
}

module.exports = { CONFIG_TAB, readSheetConfig, writeSheetConfig, inspectSheet, guessTabs, guessColumns, matchScore, buildSheet };
