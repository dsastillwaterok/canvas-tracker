const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { SheetStore, MockStore } = require('./lib/sheets');
const { Tracker } = require('./lib/tracker');
const auth = require('./lib/auth');

const PORT = process.env.PORT || 3000;
const TZ = process.env.TZ || 'America/Chicago';
const APP_SECRET = process.env.APP_SECRET;
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!APP_SECRET) { console.error('APP_SECRET is not set'); process.exit(1); }

const store = process.env.MOCK_SHEET
  ? new MockStore(require('./test/seed')())
  : new SheetStore({ sheetId: process.env.SHEET_ID, credentialsJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON });
const tracker = new Tracker(store, { tz: TZ });

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const baseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

// Resolve the signed-in canvasser, if any, and confirm they are still on the Lists tab.
async function currentCanvasser(req) {
  const name = auth.nameFromCookie(APP_SECRET, req.cookies[auth.COOKIE]);
  if (!name) return null;
  const { canvassers } = await tracker.lists();
  return canvassers.includes(name) ? name : null;
}

async function requireCanvasser(req, res, next) {
  try {
    const name = await currentCanvasser(req);
    if (!name) return res.status(401).json({ error: 'Not signed in. Open your personal link.' });
    req.canvasser = name;
    next();
  } catch (e) { next(e); }
}

// Personal link: sets the cookie and goes to the app.
app.get('/c/:token', async (req, res, next) => {
  try {
    const { canvassers } = await tracker.lists();
    const name = auth.nameForToken(APP_SECRET, req.params.token, canvassers);
    if (!name) return res.status(404).sendFile(path.join(__dirname, 'public', 'gate.html'));
    res.cookie(auth.COOKIE, auth.cookieValue(APP_SECRET, name), {
      httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 365 * 24 * 3600 * 1000, path: '/',
    });
    res.redirect('/');
  } catch (e) { next(e); }
});

app.get('/', async (req, res, next) => {
  try {
    const name = await currentCanvasser(req);
    res.sendFile(path.join(__dirname, 'public', name ? 'index.html' : 'gate.html'));
  } catch (e) { next(e); }
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---- API -------------------------------------------------------------------

app.get('/api/bootstrap', requireCanvasser, async (req, res, next) => {
  try {
    const [lists, tenants] = await Promise.all([tracker.lists(), tracker.tenants()]);
    res.json({
      me: req.canvasser,
      lists,
      tenants: tenants.map((t) => ({
        key: t.key, building: t.building, unit: t.unit, name: t.name, status: t.status,
        contactStatus: t.contactStatus, lastContact: t.lastContact, lastResponse: t.lastResponse,
        grievanceTypes: t.grievanceTypes,
      })),
    });
  } catch (e) { next(e); }
});

app.get('/api/tenant/:key', requireCanvasser, async (req, res, next) => {
  try {
    const t = await tracker.tenant(req.params.key);
    if (!t) return res.status(404).json({ error: 'No tenant with that unit' });
    res.json(t);
  } catch (e) { next(e); }
});

app.post('/api/interaction', requireCanvasser, async (req, res, next) => {
  try {
    const result = await tracker.logInteraction({ ...req.body, canvasser: req.canvasser });
    const tenant = await tracker.tenant(result.key);
    res.json({ ...result, tenant });
  } catch (e) {
    if (/required/i.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

app.post('/api/tenant/:key', requireCanvasser, async (req, res, next) => {
  try {
    res.json(await tracker.updateTenant(req.params.key, req.body || {}));
  } catch (e) {
    if (/No tenant/.test(e.message)) return res.status(404).json({ error: e.message });
    next(e);
  }
});

app.post('/api/followup/:row/done', requireCanvasser, async (req, res, next) => {
  try {
    const row = parseInt(req.params.row, 10);
    if (!(row > 1)) return res.status(400).json({ error: 'Bad row' });
    await tracker.markFollowUpDone(row);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---- Admin: personal links ---------------------------------------------------

app.get('/admin', async (req, res, next) => {
  try {
    if (!auth.adminOk(ADMIN_KEY, req.query.key)) return res.status(403).send('Add ?key=ADMIN_KEY to the address.');
    const { canvassers } = await tracker.lists();
    const links = canvassers.map((n) => ({ name: n, link: auth.personalLink(baseUrl(req), APP_SECRET, n) }));
    const rows = links.map((l) => `<tr><td>${esc(l.name)}</td><td><a href="${l.link}">${l.link}</a></td></tr>`).join('');
    res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Canvasser links</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:24px;max-width:900px}table{border-collapse:collapse;width:100%}td{padding:8px 12px 8px 0;border-bottom:1px solid #ddd;word-break:break-all}form{margin-top:20px}button{font:inherit;padding:8px 14px}</style>
<h1>Personal links</h1>
<p>Send each canvasser their link. It opens the app with their name set. To revoke someone, remove their name from the Lists tab.</p>
<table>${rows}</table>
<form method="post" action="/admin/write-links?key=${encodeURIComponent(req.query.key)}"><button>Write these links to the Lists tab (column H)</button></form>`);
  } catch (e) { next(e); }
});

app.post('/admin/write-links', async (req, res, next) => {
  try {
    if (!auth.adminOk(ADMIN_KEY, req.query.key)) return res.status(403).send('Forbidden');
    const rows = await store.getValues('Lists!E2:E');
    const values = rows.map((r) => {
      const n = (r[0] || '').trim();
      return [n ? auth.personalLink(baseUrl(req), APP_SECRET, n) : ''];
    });
    if (values.length) await store.updateValues(`Lists!H2:H${values.length + 1}`, values);
    res.redirect(`/admin?key=${encodeURIComponent(req.query.key)}`);
  } catch (e) { next(e); }
});

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Something went wrong talking to the sheet. Try again in a moment.' });
});

app.listen(PORT, () => console.log(`Canvass app on :${PORT}${process.env.MOCK_SHEET ? ' (mock sheet)' : ''}`));
