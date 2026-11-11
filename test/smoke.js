// Exercises the tracker against the mock sheet. Run with: npm test
const assert = require('assert');
const { MockStore } = require('../lib/sheets');
const { Tracker, makeKey } = require('../lib/tracker');
const auth = require('../lib/auth');
const seed = require('./seed');

(async () => {
  const store = new MockStore(seed());
  const tr = new Tracker(store);

  const lists = await tr.lists();
  assert.strictEqual(lists.canvassers.length, 7);
  assert.strictEqual(lists.buildings.length, 10);
  assert.strictEqual(lists.grievanceTypes.length, 22);

  const tenants = await tr.tenants();
  assert.strictEqual(tenants.length, 8, 'checkbox-only rows must not count as tenants');
  const opal = tenants.find((t) => t.name === 'Opal Brandt');
  assert.strictEqual(opal.key, '8663-13');
  assert.deepStrictEqual(opal.grievanceTypes.slice(0, 2), ['Pests', 'Hot water']);

  const detail = await tr.tenant('8663-13');
  assert.strictEqual(detail.history.length, 1);

  // Log a conversation on an existing unit: lands on the next real row, not row 1001.
  const r1 = await tr.logInteraction({ building: '8663', unit: '13', canvasser: 'Ben K', type: 'Door knock', response: 'Talked', discussed: 'Roaches are back.', phone: '(918) 555-0199' });
  assert.strictEqual(r1.created, false);
  assert.strictEqual(r1.interactionRow, 10);
  const after = await tr.tenant('8663-13');
  assert.strictEqual(after.history.length, 2);
  assert.strictEqual(after.history[0].discussed, 'Roaches are back.');
  assert.strictEqual(after.phone, '(918) 555-0199', 'phone given at the door replaces what was on file');

  // New unit: creates the Tenants row with status from the response.
  const r2 = await tr.logInteraction({ building: '8645', unit: '7', canvasser: 'Ben K', type: 'Door knock', response: 'No answer', who: '' });
  assert.strictEqual(r2.created, true);
  assert.strictEqual(r2.key, '8645-7');
  const nu = await tr.tenant('8645-7');
  assert.strictEqual(nu.status, 'No answer');
  assert.strictEqual(nu.row, 10, 'new tenant row goes right after the last real tenant');
  assert.strictEqual((await tr.tenants()).length, 9);

  // Same unit again: no duplicate row.
  const r3 = await tr.logInteraction({ building: '8645', unit: '7', canvasser: 'Ben K', type: 'Door knock', response: 'Talked', who: 'Sam' });
  assert.strictEqual(r3.created, false);
  assert.strictEqual((await tr.tenants()).length, 9);

  // Edit details.
  const ed = await tr.updateTenant('8645-7', { status: 'Supportive', grievanceTypes: ['Pests', 'Trash'], groupChat: true, name: 'Sam' });
  assert.strictEqual(ed.status, 'Supportive');
  assert.deepStrictEqual(ed.grievanceTypes, ['Pests', 'Trash']);
  assert.strictEqual(ed.groupChat, true);

  // Validation.
  await assert.rejects(tr.logInteraction({ unit: '', canvasser: 'Ben K', type: 'Door knock', response: 'Talked' }), /Unit is required/);
  await assert.rejects(tr.logInteraction({ unit: '3', canvasser: 'Ben K', type: '', response: 'Talked' }), /required/);

  // Keys and auth.
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
