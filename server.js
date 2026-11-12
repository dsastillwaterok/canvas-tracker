const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { SheetStore, MockStore } = require('./lib/sheets');
const { Schema, loadConfig } = require('./lib/schema');
const { Tracker } = require('./lib/tracker');
const setup = require('./lib/setup');
const admin = require('./lib/admin');
const auth = require('./lib/auth');
const form = require('./lib/form');
const contact = require('./lib/contact');
const { mailer } = require('./lib/mail');

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
  store, appSecret: APP_SECRET, adminKey: ADMIN_KEY, mailer: mailer(),
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
  // Until an organizer picks the door-form questions in the wizard, follow the defaults as they grow.
  if (!config.form && !config.formFieldsChosen) config.formFields = [...new Set([...(config.formFields || []), ...form.DEFAULT_FIELDS.map((f) => f.id)])];
  // Likewise the optional Residents tab: known by its default name and headers until the wizard says otherwise.
  if (!config.peopleChosen && !config.columns.people) {
    const d = loadConfig();
    config.tabs.people = config.tabs.people || d.tabs.people;
    config.columns.people = d.columns.people;
    config.checkboxFields.people = d.checkboxFields.people;
  }
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
// Revalidate on every load (ETag 304s are cheap); a canvasser's phone must never run a stale app.js.
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: 0, etag: true, lastModified: true }));
app.get('/static/contact.js', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'lib', 'contact.js')));
const VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || 'dev').slice(0, 7);
app.use('/admin', admin.router(ctx));

async function currentCanvasser(req) {
  if (!ctx.configured) return null;
  const name = auth.nameFromCookie(APP_SECRET, req.cookies[auth.COOKIE], Date.now(), epoch());
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

const DAY = 24 * 3600 * 1000;
function sessionDays() { return Math.min(7, Math.max(1, parseInt(ctx.config?.sessionDays, 10) || 3)); }
const epoch = () => (ctx.config?.event?.issued) || 0; // the current canvass; see lib/auth.js
function signIn(req, res, name, expires) {
  res.cookie(auth.COOKIE, auth.cookieValue(APP_SECRET, name, expires, epoch()), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: Math.max(0, expires - Date.now()), path: '/' });
}
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function gatePage(title, body) {
  const name = ctx.config?.appName || 'Canvass';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="/static/style.css"></head><body class="gate"><main class="gate-box"><p class="plate">${esc(name)}</p>${body}</main></body></html>`;
}
// The locked-out screen. Offers email sign-in when the app can send mail.
function gate(res, status, headline, detail) {
  const loginBit = ctx.mailer
    ? `<p><a class="btn primary block" href="/login">Sign in with your email</a></p><p class="hint">We'll email you a link that signs you in for the next few days.</p>`
    : '';
  res.status(status).set('Cache-Control', 'no-store').send(gatePage('Sign in', `<h1>${esc(headline)}</h1><p>${esc(detail)}</p>${loginBit}`));
}
const GATE_DEFAULT = ['Scan the code for this canvass to sign in.', 'Organizers show a QR code at each canvass; scanning it signs you in until the canvass ends. Missed it? Ask an organizer for the link.'];

app.get('/c/:token', async (req, res, next) => {
  try {
    if (!ctx.configured) return gate(res, 503, 'Not ready yet', 'An organizer still has to finish setting up the app.');
    const { canvassers } = await ctx.tracker.lists();
    const r = auth.resolvePersonalToken(APP_SECRET, req.params.token, canvassers, Date.now(), epoch());
    if (!r.name) return gate(res, 410, r.reason, 'Links are issued per canvass and stop working when it ends.');
    signIn(req, res, r.name, r.expires);
    res.redirect('/');
  } catch (e) { next(e); }
});

// ---- email sign-in (only when SMTP is configured) ----------------------------------
const LOGIN_MINUTES = 15;
app.get('/login', (req, res) => {
  if (!ctx.mailer) return res.redirect('/');
  res.set('Cache-Control', 'no-store').send(gatePage('Sign in', `<h1>Sign in with your email</h1>
<p>Enter the email an organizer has on file for you. We'll send a link that signs you in for ${sessionDays()} day${sessionDays() === 1 ? '' : 's'}.</p>
<form method="post" action="/login">
<div class="field"><label for="email">Email</label><input class="text" id="email" name="email" type="email" required autocomplete="email" autofocus></div>
<div class="field"><button class="btn primary block">Email me a sign-in link</button></div>
</form>`));
});
app.post('/login', express.urlencoded({ extended: false }), async (req, res, next) => {
  try {
    if (!ctx.mailer || !ctx.configured) return res.redirect('/');
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
    const who = (await ctx.tracker.canvassers()).find((c) => c.email && c.email.toLowerCase() === email);
    if (who) {
      const expires = Date.now() + LOGIN_MINUTES * 60 * 1000;
      const link = `${ctx.baseUrl(req).replace(/\/$/, '')}/login/${auth.loginToken(APP_SECRET, who.name, expires)}`;
      await ctx.mailer.send({ to: who.email, subject: `Sign in to ${ctx.config.appName}`, text: `Hi ${who.name.split(' ')[0]}, tap this to sign in to the ${ctx.config.appName} canvass app:\n\n${link}\n\nIt works once, within ${LOGIN_MINUTES} minutes. If you didn't ask for it, ignore this email.` });
    }
    // Same answer either way, so the form can't be used to find out who's on the list.
    res.set('Cache-Control', 'no-store').send(gatePage('Check your email', `<h1>Check your email</h1><p>If ${esc(email)} is on the canvasser list, a sign-in link is on its way. It works once, within ${LOGIN_MINUTES} minutes.</p><p class="hint">Nothing arrived? Check spam, or ask an organizer whether this is the email they have for you.</p>`));
  } catch (e) { next(e); }
});
app.get('/login/:token', async (req, res, next) => {
  try {
    if (!ctx.configured) return gate(res, 503, 'Not ready yet', 'An organizer still has to finish setting up the app.');
    const { canvassers } = await ctx.tracker.lists();
    const r = auth.resolveLoginToken(APP_SECRET, req.params.token, canvassers);
    if (!r.name) return gate(res, 410, r.reason, 'Sign-in links work once, within a few minutes of being sent.');
    const ev = ctx.config.event && ctx.config.event.expires > Date.now() ? ctx.config.event : null;
    signIn(req, res, r.name, ev ? ev.expires : Date.now() + sessionDays() * DAY);
    res.redirect('/');
  } catch (e) { next(e); }
});

// ---- self-registration ----------------------------------------------------------
const joinPage = (body) => gatePage('Sign in to canvass', body);
const fmtUntil = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ctx.config?.timeZone || 'UTC' });
async function emailColumn() { return (await ctx.schema.tab('lists')).canvasserEmails >= 0; }
app.get('/join/:token', async (req, res, next) => {
  try {
    if (!ctx.configured) return res.status(503).send(joinPage('<h1>Not ready yet</h1><p>An organizer still has to finish setting up the app.</p>'));
    const t = auth.parseJoinToken(APP_SECRET, req.params.token, { notBefore: ctx.config.joinNotBefore || 0 });
    if (!t.ok) return gate(res, 410, t.reason, 'Sign-up links are made per canvass and stop working when it ends.');
    if (await currentCanvasser(req)) return res.redirect('/'); // already signed in on this phone
    const needEmail = await emailColumn();
    res.set('Cache-Control', 'no-store');
    res.send(joinPage(`<h1>Sign in to canvass</h1>
<p>${needEmail ? 'Your email is how we recognize you next time; your name is how conversations you log get credited.' : 'Your name is how conversations you log get credited.'}</p>
<form method="post" action="/join/${esc(req.params.token)}">
${needEmail ? '<div class="field"><label for="email">Email</label><input class="text" id="email" name="email" type="email" required autocomplete="email" autofocus></div>' : ''}
<div class="field"><label for="name">Your name</label><input class="text" id="name" name="name" required autocomplete="name" placeholder="First name and last initial is fine" ${needEmail ? '' : 'autofocus'}></div>
<div class="field"><button class="btn primary block">Sign me in</button></div>
</form>
<p class="hint">Signed in until ${esc(fmtUntil(t.expires))}.</p>`));
  } catch (e) { next(e); }
});
app.post('/join/:token', express.urlencoded({ extended: false }), async (req, res, next) => {
  try {
    if (!ctx.configured) return res.status(503).send(joinPage('<h1>Not ready yet</h1>'));
    const t = auth.parseJoinToken(APP_SECRET, req.params.token, { notBefore: ctx.config.joinNotBefore || 0 });
    if (!t.ok) return gate(res, 410, t.reason, 'Sign-up links are made per canvass and stop working when it ends.');
    const name = String(req.body.name || '').trim().slice(0, 80);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 120);
    const needEmail = await emailColumn();
    if (!name || (needEmail && !email)) return res.status(400).send(joinPage(`<h1>${needEmail ? 'Name and email are both needed' : 'Name is required'}</h1><p><a href="">Try again</a></p>`));
    const c = await ctx.tracker.addCanvasser(name, email);
    signIn(req, res, c.name, t.expires);
    res.send(joinPage(`<h1>You're in, ${esc(c.name.split(' ')[0])}.</h1>
<p>Signed in on this phone until ${esc(fmtUntil(t.expires))}. Use Share > <strong>Add to Home Screen</strong> so the app is one tap away.</p>
<p>At the next canvass, scan the new code${ctx.mailer && c.email ? ' or sign in with your email' : ''}.</p>
<p><a class="btn primary block" href="/">Open the app</a></p>`));
  } catch (e) { next(e); }
});

app.get('/', async (req, res, next) => {
  try {
    const name = await currentCanvasser(req);
    res.set('Cache-Control', 'no-store');
    if (name) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    if (!ctx.configured) return gate(res, 503, 'Not ready yet', 'An organizer still has to finish setting up the app.');
    if (req.cookies[auth.COOKIE]) return gate(res, 200, 'Your sign-in has ended.', 'Sign-in is granted per canvass and ends with it. Scan the code for this canvass' + (ctx.mailer ? ', sign in with your email,' : '') + ' or ask an organizer for a link.');
    gate(res, 200, GATE_DEFAULT[0], GATE_DEFAULT[1]);
  } catch (e) { next(e); }
});

app.get('/healthz', (req, res) => res.json({ ok: true, configured: ctx.configured, version: VERSION, emailLogin: !!ctx.mailer }));

// ---- API ---------------------------------------------------------------------

app.get('/api/bootstrap', requireCanvasser, async (req, res, next) => {
  try {
    const [lists, tenants, features, interactions, people] = await Promise.all([ctx.tracker.lists(), ctx.tracker.tenants(), ctx.schema.features(), ctx.tracker.interactions(), ctx.tracker.people()]);
    const icols = await ctx.schema.tab('interactions');
    const tcols = await ctx.schema.tab('tenants');
    res.json({
      me: req.canvasser,
      appName: ctx.config.appName,
      features,
      form: form.availableFields(form.formSpec(ctx.config), { interactions: icols, tenants: tcols }),
      tagGroups: ctx.config.tagGroups || [],
      headers: ctx.config.columns.tenants, // sheet header per tenant field, for labels on the phone
      editable: ctx.config.editableFields || [],
      lists,
      // Whole rows, so the phone can open a tenant without a round trip; the list uses a few fields.
      tenants,
      interactions,
      people: people.map(({ key, row, name, phone, email, okPhone, okEmail, notes }) => ({ key, row, name, phone, email, okPhone, okEmail, notes })),
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
    const spec = form.availableFields(form.formSpec(ctx.config), { interactions: await ctx.schema.tab('interactions'), tenants: await ctx.schema.tab('tenants') });
    const problem = form.validate(spec, req.body || {}, await ctx.tracker.lists());
    if (problem) return res.status(400).json({ error: problem });
    for (const p of (Array.isArray(req.body.people) ? req.body.people : [])) {
      if (!String(p.name || '').trim()) return res.status(400).json({ error: 'Each other person needs a name.' });
      const e = contact.email(p.email), ph = contact.phone(p.phone);
      if (!e.ok) return res.status(400).json({ error: `${p.name}'s email: ${e.error}` });
      if (!ph.ok) return res.status(400).json({ error: `${p.name}'s phone: ${ph.error}` });
      p.email = e.value; p.phone = ph.value;
    }
    const result = await ctx.tracker.logInteraction({ ...req.body, canvasser: req.canvasser });
    res.json({ ...result, tenant: await ctx.tracker.tenant(result.key) });
  } catch (e) {
    if (/required/i.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

app.post('/api/tenant/:key', requireCanvasser, async (req, res, next) => {
  try {
    const b = req.body || {};
    if ('phone' in b) { const r = contact.phone(b.phone); if (!r.ok) return res.status(400).json({ error: `Phone: ${r.error}` }); b.phone = r.value; }
    if ('email' in b) { const r = contact.email(b.email); if (!r.ok) return res.status(400).json({ error: `Email: ${r.error}` }); b.email = r.value; }
    res.json(await ctx.tracker.updateTenant(req.params.key, b));
  }
  catch (e) { if (/No tenant/.test(e.message)) return res.status(404).json({ error: e.message }); next(e); }
});

app.post('/api/tenant/:key/replace', requireCanvasser, async (req, res, next) => {
  try {
    const name = String((req.body || {}).name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'Enter the new tenant\'s name.' });
    res.json(await ctx.tracker.replaceTenant(req.params.key, name));
  } catch (e) { if (/No tenant/.test(e.message)) return res.status(404).json({ error: e.message }); next(e); }
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
