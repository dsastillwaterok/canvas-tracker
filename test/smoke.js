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
  assert.strictEqual(lists.grievanceTypes.length, 30);
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
  assert.strictEqual(after.okPhone, false, 'consent is not implied by giving a number');
  await tr.logInteraction({ building: '8663', unit: '13', canvasser: 'Ben K', type: 'Text', response: 'Talked', okPhone: true });
  assert.strictEqual((await tr.tenant('8663-13')).okPhone, true);
  await tr.logInteraction({ building: '8663', unit: '13', canvasser: 'Ben K', type: 'Text', response: 'Talked', okPhone: false });
  assert.strictEqual((await tr.tenant('8663-13')).okPhone, true, 'an unchecked box on a later visit never revokes consent');

  // Tags picked on the door form replace the tenant's set; omitting them leaves it alone.
  await tr.logInteraction({ building: '8663', unit: '13', canvasser: 'Ben K', type: 'Text', response: 'Talked', grievanceTypes: ['Pests', 'Heating'] });
  assert.deepStrictEqual((await tr.tenant('8663-13')).grievanceTypes, ['Pests', 'Heating']);
  await tr.logInteraction({ building: '8663', unit: '13', canvasser: 'Ben K', type: 'Text', response: 'Talked' });
  assert.deepStrictEqual((await tr.tenant('8663-13')).grievanceTypes, ['Pests', 'Heating']);

  // New unit creates the Tenants row with status from the response; no duplicates after.
  const r2 = await tr.logInteraction({ building: '8645', unit: '7', canvasser: 'Ben K', type: 'Door knock', response: 'No answer' });
  assert.strictEqual(r2.created, true);
  assert.strictEqual(r2.key, '8645-7');
  const nu = await tr.tenant('8645-7');
  assert.strictEqual(nu.status, 'No answer');
  assert.strictEqual(nu.row, 10);
  assert.strictEqual((await tr.tenants()).length, 9);
  await tr.logInteraction({ building: '8645', unit: '7', canvasser: 'Ben K', type: 'Door knock', response: 'Talked', who: 'Sam' });
  assert.strictEqual((await tr.tenants()).length, 9);
  // A new building typed at the door is added to the Lists tab.
  await tr.logInteraction({ building: '9999', unit: '1', canvasser: 'Ben K', type: 'Door knock', response: 'Talked' });
  assert.ok((await tr.lists()).buildings.includes('9999'));

  // Formula columns are never written: the key cell on the new row stays empty in the mock.
  const raw = await store.getValues(`'${config.tabs.tenants}'!A10:AC10`);
  assert.strictEqual((raw[0] || [])[28] || '', '', 'key column must be left to the sheet formula');

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
  mapped.form.fields.push({ id: 'h:Documentation available?', kind: 'text', label: 'Documentation?', required: true });
  const s2 = new Schema(theirs, mapped);
  const tr2 = new Tracker(theirs, s2);
  const f2 = await s2.features();
  assert.strictEqual(f2.housing, false);
  assert.strictEqual((await tr2.tenants())[0].key, '100-3');
  await assert.rejects(tr2.logInteraction({ building: '100', unit: '3', canvasser: 'Ana', type: 'Phone', response: 'Talked' }), /Documentation\? is required/);
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

  // ---- the door form definition ------------------------------------------------
  const formLib = require('../lib/form');
  const legacy = formLib.formSpec({ formFields: ['who', 'phone'], extraFields: [{ header: 'Photo?', kind: 'textarea' }] });
  assert.deepStrictEqual(legacy.map((f) => f.id), ['type', 'response', 'who', 'phone', 'h:Photo?'], 'older configs migrate, required questions stay');
  assert.strictEqual(legacy[4].kind, 'textarea');
  const spec = formLib.formSpec(config);
  assert.strictEqual(formLib.validate(spec, { type: 'Text', response: 'Talked' }, lists), null);
  assert.match(formLib.validate(spec, { type: '', response: 'Talked' }, lists), /Pick how/);
  assert.match(formLib.validate(spec, { type: 'Carrier pigeon', response: 'Talked' }, lists), /isn't one of the choices/);
  assert.match(formLib.validate(spec, { type: 'Text', response: 'Talked', followUpDate: 'soon' }, lists), /needs a date/);
  assert.match(formLib.validate(spec, { type: 'Text', response: 'Talked', grievanceTypes: ['Dragons'] }, lists), /Dragons/);
  const strict = [formLib.normalizeField({ id: 'h:Unit size', kind: 'number', label: 'Unit size' }), formLib.normalizeField({ id: 'who', kind: 'text', pattern: '^[A-Z]', patternHint: 'Capitalize the name.' })];
  assert.match(formLib.validate(strict, { 'h:Unit size': 'big' }), /needs a number/);
  assert.match(formLib.validate(strict, { who: 'bob' }), /Capitalize/);
  assert.strictEqual(formLib.validate(strict, { 'h:Unit size': '2', who: 'Bob' }), null);
  assert.strictEqual(formLib.normalizeField({ id: 'x', kind: 'text', pattern: '(' }).pattern, '', 'a broken pattern is dropped, not fatal');
  const avail = formLib.availableFields(spec, { interactions: await schema.tab('interactions'), tenants: await schema.tab('tenants') });
  assert.strictEqual(avail.length, spec.length, 'the default sheet has every default question');

  // ---- keys and auth -------------------------------------------------------------
  assert.strictEqual(makeKey('8659', 'TBD-Carol'), '8659-TBD-Carol');
  assert.strictEqual(makeKey('', '9'), '9');
  const now = 1_700_000_000_000;
  const DAY = 86400e3;
  // Personal links: expire, verify, reject tampering and removed names.
  const tok = auth.personalToken('s3cret', 'Ben K', now + 3 * DAY);
  assert.strictEqual(auth.resolvePersonalToken('s3cret', tok, lists.canvassers, now).name, 'Ben K');
  assert.strictEqual(auth.resolvePersonalToken('s3cret', tok, lists.canvassers, now).expires, now + 3 * DAY);
  assert.match(auth.resolvePersonalToken('s3cret', tok, lists.canvassers, now + 4 * DAY).reason, /expired/);
  assert.match(auth.resolvePersonalToken('other', tok, lists.canvassers, now).reason, /earlier canvass/);
  assert.match(auth.resolvePersonalToken('s3cret', tok.slice(0, -1) + 'x', lists.canvassers, now).reason, /earlier canvass/, 'a bad signature reads as an old link: the likelier cause');
  assert.match(auth.resolvePersonalToken('s3cret', tok, ['Someone Else'], now).reason, /no longer active/);
  // Starting a new canvass (a new epoch) invalidates the old canvass's links and sessions.
  const tokE = auth.personalToken('s3cret', 'Ben K', now + DAY, 111);
  assert.strictEqual(auth.resolvePersonalToken('s3cret', tokE, lists.canvassers, now, 111).name, 'Ben K');
  assert.match(auth.resolvePersonalToken('s3cret', tokE, lists.canvassers, now, 222).reason, /earlier canvass/);
  assert.strictEqual(auth.nameFromCookie('s3cret', auth.cookieValue('s3cret', 'Ben K', now + DAY, 111), now, 222), null);
  assert.match(auth.personalLink('https://x.org/', 's3cret', 'Ben K', now + DAY), /^https:\/\/x\.org\/c\/[A-Za-z0-9_-]{12}\.\d+\.[A-Za-z0-9_-]{24}$/);
  // Cookies carry the same expiry.
  const ck = auth.cookieValue('s3cret', 'Ben K', now + 3 * DAY);
  assert.strictEqual(auth.nameFromCookie('s3cret', ck, now), 'Ben K');
  assert.strictEqual(auth.nameFromCookie('s3cret', ck, now + 3 * DAY + 1), null);
  assert.strictEqual(auth.nameFromCookie('s3cret', ck + 'x', now), null);
  assert.strictEqual(auth.nameFromCookie('other', ck, now), null);
  // Email sign-in links work once.
  const lt = auth.loginToken('s3cret', 'Ben K', now + 15 * 60e3);
  assert.strictEqual(auth.resolveLoginToken('s3cret', lt, lists.canvassers, now).name, 'Ben K');
  assert.match(auth.resolveLoginToken('s3cret', lt, lists.canvassers, now).reason, /already used/);
  const lt2 = auth.loginToken('s3cret', 'Ben K', now + 1000);
  assert.match(auth.resolveLoginToken('s3cret', lt2, lists.canvassers, now + 2000).reason, /expired/);
  assert.match(auth.resolveLoginToken('s3cret', tok, lists.canvassers, now).reason, /not valid/, 'a personal link is not a login link');

  // Sign-up links: valid, expired, cancelled, tampered.
  const jt = auth.joinToken('s3cret', now, now + 86400e3);
  assert.strictEqual(auth.parseJoinToken('s3cret', jt, { now: now + 1000 }).ok, true);
  assert.match(auth.parseJoinToken('s3cret', jt, { now: now + 2 * 86400e3 }).reason, /expired/);
  assert.match(auth.parseJoinToken('s3cret', jt, { now: now + 1000, notBefore: now + 1 }).reason, /cancelled/);
  assert.strictEqual(auth.parseJoinToken('s3cret', jt.slice(0, -1) + 'x', { now }).ok, false);
  assert.strictEqual(auth.parseJoinToken('other', jt, { now }).ok, false);
  // Self-registration adds to the Lists tab once, fills a blank email, never duplicates.
  const added = await tr.addCanvasser('Zed Q', 'zed@example.org');
  assert.strictEqual(added.created, true);
  const again = await tr.addCanvasser('zed q', '');
  assert.strictEqual(again.created, false);
  const byEmail = await tr.addCanvasser('Zedediah Quill', 'ZED@example.org');
  assert.strictEqual(byEmail.created, false, 'a known email is the same person whatever name they typed');
  assert.strictEqual(byEmail.name, 'Zed Q');
  assert.strictEqual((await tr.canvassers()).filter((c) => c.name === 'Zed Q').length, 1);
  await tr.markLinkSent('Zed Q');
  assert.ok((await tr.canvassers()).find((c) => c.name === 'Zed Q').linkSent);

  console.log('smoke test: all good');
})().catch((e) => { console.error(e); process.exit(1); });
