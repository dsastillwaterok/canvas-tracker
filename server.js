const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { SheetStore, MockStore } = require('./lib/sheets');
const { Schema, loadConfig } = require('./lib/schema');
const { Tracker } = require('./lib/tracker');
const setup = require('./lib/setup');
const admin = require('./lib/admin');
const auth = require('./lib/auth');

const PORT = process.env.PORT || 3000;
const APP_SECRET = process.env.APP_SECRET;
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!APP_SECRET) { console.error('APP_SECRET is not set'); process.exit(1); }
if (!ADMIN_KEY) { console.error('ADMIN_KEY is not set'); process.exit(1); }

let store;
try {
  store = process.env.MOCK_SHEET
    ? new MockStore(process.env.MOCK_SHEET === 'blank' ? { Sheet1: [] } : require('./test/seed')())
    : new SheetStore({ sheetId: process.env.SHEET_ID, credentialsJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON });
} catch (e) { console.error(e.message); process.exit(1); }

// Everything that depends on the config lives in ctx so setup can swap it at runtime.
const ctx = {
  store, appSecret: APP_SECRET, adminKey: ADMIN_KEY,
  config: null, schema: null, tracker: null, configured: false, lastError: '',
  baseUrl: (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`,
  async applyConfig(config, { persist = false } = {}) {
    if (process.env.APP_NAME) config.appName = process.env.APP_NAME;
    const schema = new Schema(store, config);
    await schema.tab('tenants'); // throws with a clear message if the layout doesn't match
    if (persist) await setup.writeSheetConfig(store, config);
    ctx.config = config; ctx.schema = schema; ctx.tracker = new Tracker(store, schema);
    ctx.configured = true; ctx.lastError = '';
  },
};

async function boot() {
  const fromSheet = await setup.readSheetConfig(store);
  const config = fromSheet || loadConfig();
  try {
    await ctx.applyConfig(config);
    const f = await ctx.schema.features();
    const missing = Object.entries(f).filter(([, ok]) => !ok).map(([k]) => k);
    console.log(`Sheet layout OK (${config.appName}, settings from ${fromSheet ? 'the sheet' : 'config/default.json'}).` + (missing.length ? ` Optional columns not present: ${missing.join(', ')}` : ''));
  } catch (e) {
    ctx.config = config; ctx.configured = false; ctx.lastError = e.message;
    console.log(`Not configured yet: ${e.message}\nOpen /admin?key=ADMIN_KEY to run setup. Retrying every 30 seconds.`);
    // A sheet share or an API enable can land after startup; keep trying rather than needing a redeploy.
    setTimeout(() => boot().catch(() => {}), 30 * 1000).unref();
  }
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/admin', admin.router(ctx));

async function currentCanvasser(req) {
  if (!ctx.configured) return null;
  const name = auth.nameFromCookie(APP_SECRET, req.cookies[auth.COOKIE]);
  if (!name) return null;
  const { canvassers } = await ctx.tracker.lists();
  return canvassers.includes(name) ? name : null;
}

async function requireCanvasser(req, res, next) {
  try {
    if (!ctx.configured) return res.status(503).json({ error: 'The app is not set up yet. An organizer needs to finish setup at /admin.' });
    const name = await currentCanvasser(req);
    if (!name) return res.status(401).json({ error: 'Not signed in. Open your personal link.' });
    req.canvasser = name;
    next();
  } catch (e) { next(e); }
}

app.get('/c/:token', async (req, res, next) => {
  try {
    if (!ctx.configured) return res.status(503).sendFile(path.join(__dirname, 'public', 'gate.html'));
    const { canvassers } = await ctx.tracker.lists();
    const name = auth.nameForToken(APP_SECRET, req.params.token, canvassers);
    if (!name) return res.status(404).sendFile(path.join(__dirname, 'public', 'gate.html'));
    res.cookie(auth.COOKIE, auth.cookieValue(APP_SECRET, name), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 365 * 24 * 3600 * 1000, path: '/' });
    res.redirect('/');
  } catch (e) { next(e); }
});

app.get('/', async (req, res, next) => {
  try {
    const name = await currentCanvasser(req);
    res.sendFile(path.join(__dirname, 'public', name ? 'index.html' : 'gate.html'));
  } catch (e) { next(e); }
});

app.get('/healthz', (req, res) => res.json({ ok: true, configured: ctx.configured }));

// ---- API ---------------------------------------------------------------------

app.get('/api/bootstrap', requireCanvasser, async (req, res, next) => {
  try {
    const [lists, tenants, features] = await Promise.all([ctx.tracker.lists(), ctx.tracker.tenants(), ctx.schema.features()]);
    const icols = await ctx.schema.tab('interactions');
    res.json({
      me: req.canvasser,
      appName: ctx.config.appName,
      features,
      interactionFields: Object.fromEntries(Object.keys(ctx.config.columns.interactions).map((f) => [f, icols[f] !== -1])),
      formFields: ctx.config.formFields || ['who', 'discussed', 'followUp', 'followUpDate', 'phone', 'email'],
      extraFields: ctx.config.extraFields || [],
      editable: ctx.config.editableFields || [],
      lists,
      tenants: tenants.map((t) => ({
        key: t.key, building: t.building, unit: t.unit, name: t.name, status: t.status,
        contactStatus: t.contactStatus, lastContact: t.lastContact, lastResponse: t.lastResponse, grievanceTypes: t.grievanceTypes,
      })),
    });
  } catch (e) { next(e); }
});

app.get('/api/tenant/:key', requireCanvasser, async (req, res, next) => {
  try {
    const t = await ctx.tracker.tenant(req.params.key);
    if (!t) return res.status(404).json({ error: 'No tenant with that unit' });
    res.json(t);
  } catch (e) { next(e); }
});

app.post('/api/interaction', requireCanvasser, async (req, res, next) => {
  try {
    const result = await ctx.tracker.logInteraction({ ...req.body, canvasser: req.canvasser });
    res.json({ ...result, tenant: await ctx.tracker.tenant(result.key) });
  } catch (e) {
    if (/required/i.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

app.post('/api/tenant/:key', requireCanvasser, async (req, res, next) => {
  try { res.json(await ctx.tracker.updateTenant(req.params.key, req.body || {})); }
  catch (e) { if (/No tenant/.test(e.message)) return res.status(404).json({ error: e.message }); next(e); }
});

app.post('/api/followup/:row/done', requireCanvasser, async (req, res, next) => {
  try {
    const row = parseInt(req.params.row, 10);
    if (!(row > 1)) return res.status(400).json({ error: 'Bad row' });
    await ctx.tracker.markFollowUpDone(row);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong talking to the sheet. Try again in a moment.' });
  res.status(500).send('Something went wrong talking to the sheet: ' + err.message);
});

boot().then(() => app.listen(PORT, () => console.log(`Canvass app on :${PORT}${process.env.MOCK_SHEET ? ' (mock sheet)' : ''}`)));
