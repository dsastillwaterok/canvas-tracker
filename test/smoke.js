// Exercises the tracker, schema, setup wizard logic and auth against the mock sheet.
// Run with: npm test
const assert = require('assert');
const { MockStore } = require('../lib/sheets');
const { Schema, loadConfig } = require('../lib/schema');
const { Tracker, makeKey } = require('../lib/tracker');
const setup = require('../lib/setup');
const auth = require('../lib/auth');
const seed = require('./seed');

(async () => {
  const config = loadConfig();

  // ---- against a seeded sheet in the default layout ----------------------------
  const store = new MockStore(seed(config));
  const schema = new Schema(store, config);
  const tr = new Tracker(store, schema);

  const lists = await tr.lists();
  assert.strictEqual(lists.canvassers.length, 4);
  assert.strictEqual(lists.buildings.length, 10);
  assert.strictEqual(lists.grievanceTypes.length, 22);
  const feats = await schema.features();
  assert.strictEqual(feats.housing, true);

  const tenants = await tr.tenants();
  assert.strictEqual(tenants.length, 8, 'checkbox-only rows must not count as tenants');
  const opal = tenants.find((t) => t.name === 'Opal Brandt');
  assert.strictEqual(opal.key, '8663-13');
  assert.deepStrictEqual(opal.grievanceTypes.slice(0, 2), ['Pests', 'Hot water']);
  assert.strictEqual(opal.groupChat, true);

  const detail = await tr.tenant('8663-13');
  assert.strictEqual(detail.history.length, 1);

  // Log on an existing unit: lands on the next real row, not row 1001; phone replaces.
  const r1 = await tr.logInteraction({ building: '8663', unit: '13', canvasser: 'Ben K', type: 'Door knock', response: 'Talked', discussed: 'Roaches are back.', phone: '(918) 555-0199' });
  assert.strictEqual(r1.created, false);
  assert.strictEqual(r1.interactionRow, 10);
  const after = await tr.tenant('8663-13');
  assert.strictEqual(after.history.length, 2);
  assert.strictEqual(after.history[0].discussed, 'Roaches are back.');
  assert.strictEqual(after.phone, '(918) 555-0199');

  // New unit creates the Tenants row with status from the response; no duplicates after.
  const r2 = await tr.logInteraction({ building: '8645', unit: '7', canvasser: 'Ben K', type: 'Door knock', response: 'No answer' });
  assert.strictEqual(r2.created, true);
  assert.strictEqual(r2.key, '8645-7');
  const nu = await tr.tenant('8645-7');
  assert.strictEqual(nu.status, 'No answer');
  assert.strictEqual(nu.row, 10);
  await tr.logInteraction({ building: '8645', unit: '7', canvasser: 'Ben K', type: 'Door knock', response: 'Talked', who: 'Sam' });
  assert.strictEqual((await tr.tenants()).length, 9);

  // Formula columns are never written: the key cell on the new row stays empty in the mock.
  const raw = await store.getValues(`'${config.tabs.tenants}'!A10:AA10`);
  assert.strictEqual((raw[0] || [])[26] || '', '', 'key column must be left to the sheet formula');

  // Edits respect editableFields.
  const ed = await tr.updateTenant('8645-7', { status: 'Supportive', grievanceTypes: ['Pests', 'Trash'], groupChat: true, name: 'Sam', lastContact: 'nope' });
  assert.strictEqual(ed.status, 'Supportive');
  assert.deepStrictEqual(ed.grievanceTypes, ['Pests', 'Trash']);
  assert.strictEqual(ed.groupChat, true);
  assert.notStrictEqual(ed.lastContact, 'nope');

  await assert.rejects(tr.logInteraction({ unit: '', canvasser: 'Ben K', type: 'Door knock', response: 'Talked' }), /Unit is required/);

  // ---- a home-grown sheet with different headers maps through the wizard ---------
  const theirs = new MockStore({
    'Residents': [['Resident Name', 'Phone #', 'Apt', 'Bldg', 'Call Status', 'Main Concern(s)', 'Notes'], ['Lee Park', '555', '3', '100', 'Completed', 'leak', 'nice']],
    'Call log': [['Date', 'Apt', 'Bldg', 'Caller', 'Method', 'Outcome', 'Summary', 'Next step', 'Documentation available?'], ['8/1/2026', '3', '100', 'Ana', 'Phone', 'Talked', 'ok', '', 'photos']],
    'Options': [['Call Status', 'Method', 'Outcome', 'Callers'], ['Completed', 'Phone', 'Talked', 'Ana']],
  });
  const insp = await setup.inspectSheet(theirs);
  const tabs = setup.guessTabs(insp, config);
  assert.deepStrictEqual(tabs, { tenants: 'Residents', interactions: 'Call log', lists: 'Options' });
  const g = setup.guessColumns(insp.tabs[0], 'tenants', config);
  assert.strictEqual(g.name.header, 'Resident Name');
  assert.strictEqual(g.unit.header, 'Apt');
  assert.strictEqual(g.building.header, 'Bldg');
  assert.strictEqual(g.status.header, 'Call Status');
  assert.strictEqual(g.grievances.header, 'Main Concern(s)');
  const gi = setup.guessColumns(insp.tabs[1], 'interactions', config);
  assert.strictEqual(gi.canvasser.header, 'Caller');
  assert.strictEqual(gi.type.header, 'Method');
  assert.strictEqual(gi.response.header, 'Outcome');
  assert.strictEqual(gi.discussed.header, 'Summary');

  // A mapped config works end to end, including an extra question written by header.
  const mapped = JSON.parse(JSON.stringify(config));
  mapped.tabs = { tenants: 'Residents', interactions: 'Call log', lists: 'Options', dashboard: 'Dashboard' };
  mapped.columns.tenants = { name: 'Resident Name', phone: 'Phone #', unit: 'Apt', building: 'Bldg', status: 'Call Status', grievances: 'Main Concern(s)', notes: 'Notes' };
  mapped.columns.interactions = { date: 'Date', unit: 'Apt', building: 'Bldg', canvasser: 'Caller', type: 'Method', response: 'Outcome', discussed: 'Summary', followUp: 'Next step' };
  mapped.columns.lists = { statuses: 'Call Status', types: 'Method', responses: 'Outcome', canvassers: 'Callers' };
  mapped.extraFields = [{ header: 'Documentation available?', label: 'Documentation?', kind: 'text' }];
  const s2 = new Schema(theirs, mapped);
  const tr2 = new Tracker(theirs, s2);
  const f2 = await s2.features();
  assert.strictEqual(f2.housing, false);
  assert.strictEqual((await tr2.tenants())[0].key, '100-3');
  await tr2.logInteraction({ building: '100', unit: '3', canvasser: 'Ana', type: 'Phone', response: 'Talked', discussed: 'again', extra: { 'Documentation available?': 'video' } });
  const log = await theirs.getValues("'Call log'!A3:I3");
  assert.strictEqual(log[0][8], 'video');
  assert.strictEqual(log[0][6], 'again');
  await assert.rejects((async () => { const bad = JSON.parse(JSON.stringify(mapped)); bad.columns.tenants.name = 'Nope'; await new Schema(theirs, bad).tab('tenants'); })(), /missing required columns/);

  // ---- building a fresh sheet from the config ------------------------------------
  const blank = new MockStore({ Sheet1: [] });
  const built = await setup.buildSheet(blank, JSON.parse(JSON.stringify(config)), { lists: { canvassers: ['Ana'], buildings: ['100'] } });
  const s3 = new Schema(blank, built);
  await s3.tab('tenants');
  const tr3 = new Tracker(blank, s3);
  assert.strictEqual((await tr3.lists()).canvassers[0], 'Ana');
  const r3 = await tr3.logInteraction({ building: '100', unit: '1', canvasser: 'Ana', type: 'Door knock', response: 'Talked' });
  assert.strictEqual(r3.created, true);
  assert.strictEqual(r3.interactionRow, 2, 'first row after the header; the key formula column is skipped, not overwritten');
  assert.strictEqual((await tr3.tenants()).length, 1);
  await setup.writeSheetConfig(blank, built);
  const back = await setup.readSheetConfig(blank);
  assert.strictEqual(back.appName, config.appName);
  assert.strictEqual(await setup.readSheetConfig(new MockStore({ Sheet1: [] })), null);

  // ---- keys and auth -------------------------------------------------------------
  assert.strictEqual(makeKey('8659', 'TBD-Carol'), '8659-TBD-Carol');
  assert.strictEqual(makeKey('', '9'), '9');
  const tok = auth.tokenFor('s3cret', 'Ben K');
  assert.strictEqual(auth.nameForToken('s3cret', tok, lists.canvassers), 'Ben K');
  assert.strictEqual(auth.nameForToken('other', tok, lists.canvassers), null);
  const ck = auth.cookieValue('s3cret', 'Ben K');
  assert.strictEqual(auth.nameFromCookie('s3cret', ck), 'Ben K');
  assert.strictEqual(auth.nameFromCookie('s3cret', ck + 'x'), null);

  console.log('smoke test: all good');
})().catch((e) => { console.error(e); process.exit(1); });
