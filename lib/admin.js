// Organizer pages: setup wizard (map an existing sheet, or build a new one),
// personal links, and a settings overview. Server-rendered, no client JS needed.

const express = require('express');
const auth = require('./auth');
const setup = require('./setup');
const { loadConfig } = require('./schema');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FIELD_HELP = {
  tenants: {
    building: 'Building number, if units repeat across buildings', unit: 'Apartment or unit number (required)',
    name: 'Tenant name (required)', status: 'Where they are with the union (required)',
    grievanceTypes: 'Tags, comma separated', lastContact: 'Formula column, if the sheet has one',
    key: 'Formula column joining building and unit, if the sheet has one',
  },
  interactions: {
    date: 'When the conversation happened (required)', unit: 'Unit (required)', canvasser: 'Who logged it (required)',
    type: 'Door knock, call, text... (required)', response: 'What happened (required)',
    discussed: 'Free text notes', followUpDate: 'A date column', done: 'A checkbox column',
  },
  lists: { canvassers: 'Names that can sign in (required)', types: 'Choices for how (required)', responses: 'Choices for what happened (required)', statuses: 'Choices for status (required)' },
};

const TZS = ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];

function page(title, body, key) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/static/style.css"><link rel="stylesheet" href="/static/admin.css"></head>
<body class="admin"><main class="admin-box">
<nav class="admin-nav"><a href="/admin?key=${encodeURIComponent(key)}">Overview</a> <a href="/admin/setup?key=${encodeURIComponent(key)}">Setup</a> <a href="/admin/links?key=${encodeURIComponent(key)}">Canvasser links</a></nav>
${body}</main></body></html>`;
}

function router(ctx) {
  const r = express.Router();
  r.use(express.urlencoded({ extended: true, limit: '256kb' }));

  r.use((req, res, next) => {
    if (!auth.adminOk(ctx.adminKey, req.query.key)) return res.status(403).send('Add ?key=ADMIN_KEY to the address. ADMIN_KEY is set in the app\'s environment variables.');
    req.key = req.query.key;
    next();
  });

  // ---- overview --------------------------------------------------------------
  r.get('/', async (req, res, next) => {
    try {
      const k = req.key;
      let body;
      if (!ctx.configured) {
        body = `<h1>Set up the canvass app</h1>
<p>The app is connected to the sheet but doesn't know its layout yet. Pick one:</p>
<div class="choice-cards">
  <a class="card" href="/admin/setup/map?key=${encodeURIComponent(k)}"><strong>Use my existing sheet</strong><span>I already track tenants in this sheet. Match my columns to the app.</span></a>
  <a class="card" href="/admin/setup/build?key=${encodeURIComponent(k)}"><strong>Build a new tracker</strong><span>The sheet is blank. Create the tabs, dropdowns and formulas for me.</span></a>
</div>
${ctx.lastError ? `<p class="err">Last problem: ${esc(ctx.lastError)}</p>` : ''}`;
      } else {
        const f = await ctx.schema.features();
        const have = Object.entries(f).filter(([, ok]) => ok).map(([x]) => x);
        const miss = Object.entries(f).filter(([, ok]) => !ok).map(([x]) => x);
        const lists = await ctx.tracker.lists();
        body = `<h1>${esc(ctx.config.appName)}</h1>
<p class="ok">Connected and configured. ${(await ctx.tracker.tenants()).length} units on the ${esc(ctx.config.tabs.tenants)} tab, ${lists.canvassers.length} canvassers.</p>
<ul class="plain">
  <li><a href="/admin/links?key=${encodeURIComponent(k)}">Canvasser links</a>: send each person their link.</li>
  <li><a href="/admin/setup/map?key=${encodeURIComponent(k)}">Change the column mapping</a> or the door form.</li>
  <li>Settings are stored in a hidden tab in the sheet called <code>${esc(setup.CONFIG_TAB)}</code>, so they move with the sheet.</li>
</ul>
<h2>Fields in use</h2><p>${have.map(esc).join(', ')}</p>
${miss.length ? `<h2>Not in this sheet</h2><p class="muted">${miss.map(esc).join(', ')}. Add a column with the matching header and re-run setup to use it.</p>` : ''}`;
      }
      res.send(page('Canvass admin', body, k));
    } catch (e) { next(e); }
  });

  // ---- links -----------------------------------------------------------------
  r.get('/links', async (req, res, next) => {
    try {
      const k = req.key;
      if (!ctx.configured) return res.redirect(`/admin?key=${encodeURIComponent(k)}`);
      const { canvassers } = await ctx.tracker.lists();
      const base = ctx.baseUrl(req);
      const rows = canvassers.map((n) => `<tr><td>${esc(n)}</td><td><a href="${esc(auth.personalLink(base, ctx.appSecret, n))}">${esc(auth.personalLink(base, ctx.appSecret, n))}</a></td></tr>`).join('');
      res.send(page('Canvasser links', `<h1>Personal links</h1>
<p>Each link opens the app signed in as that person. On a phone, open it once and "Add to Home Screen". To revoke someone, remove their name from the ${esc(ctx.config.tabs.lists)} tab.</p>
<table>${rows || '<tr><td>No canvassers yet. Add names to the Canvassers column on the Lists tab.</td></tr>'}</table>
<form method="post" action="/admin/write-links?key=${encodeURIComponent(k)}"><button class="btn">Write these links into the ${esc(ctx.config.tabs.lists)} tab</button></form>`, k));
    } catch (e) { next(e); }
  });

  r.post('/write-links', async (req, res, next) => {
    try {
      const k = req.key;
      const cols = await ctx.schema.tab('lists');
      if (cols.links === -1) return res.status(400).send(page('Links', `<p class="err">Add a column headed "${esc(ctx.config.columns.lists.links)}" to the ${esc(ctx.config.tabs.lists)} tab first.</p>`, k));
      const { colLetter } = require('./schema');
      const name = ctx.schema.tabName('lists');
      const rows = await ctx.store.getValues(`'${name}'!${colLetter(cols.canvassers)}2:${colLetter(cols.canvassers)}`);
      const base = ctx.baseUrl(req);
      const values = rows.map((row) => { const n = (row[0] || '').trim(); return [n ? auth.personalLink(base, ctx.appSecret, n) : '']; });
      if (values.length) await ctx.store.updateValues(`'${name}'!${colLetter(cols.links)}2`, values);
      res.redirect(`/admin/links?key=${encodeURIComponent(k)}`);
    } catch (e) { next(e); }
  });

  // ---- setup chooser -----------------------------------------------------------
  r.get('/setup', (req, res) => {
    const k = req.key;
    res.send(page('Setup', `<h1>Setup</h1>
<div class="choice-cards">
  <a class="card" href="/admin/setup/map?key=${encodeURIComponent(k)}"><strong>Map an existing sheet</strong><span>Match the sheet's columns to the app and choose what's on the door form.</span></a>
  <a class="card" href="/admin/setup/build?key=${encodeURIComponent(k)}"><strong>Build a new tracker</strong><span>For a blank sheet: creates the tabs, dropdowns and formulas.</span></a>
</div>`, k));
  });

  // ---- map an existing sheet ----------------------------------------------------
  r.get('/setup/map', async (req, res, next) => {
    try {
      const k = req.key;
      const base = ctx.config;
      const insp = await setup.inspectSheet(ctx.store);
      const dataTabs = insp.tabs.filter((t) => t.headers.some(Boolean));
      if (!dataTabs.length) {
        return res.send(page('Map sheet', `<h1>This sheet is empty</h1><p>There are no headers to map. <a href="/admin/setup/build?key=${encodeURIComponent(k)}">Build a new tracker</a> instead.</p>`, k));
      }
      const guessTab = setup.guessTabs(insp, base);
      const tabSelect = (role, label) => `<label>${label}<select name="tab_${role}">${dataTabs.map((t) => `<option value="${esc(t.title)}" ${guessTab[role] === t.title ? 'selected' : ''}>${esc(t.title)} (${t.headers.filter(Boolean).length} columns)</option>`).join('')}</select></label>`;

      const fieldRows = (role) => {
        const tab = dataTabs.find((t) => t.title === guessTab[role]) || dataTabs[0];
        const guess = setup.guessColumns(tab, role, base);
        const required = require('./schema').REQUIRED[role];
        return Object.entries(base.columns[role]).map(([field, header]) => {
          const g = guess[field];
          const help = (FIELD_HELP[role] || {})[field] || '';
          const opts = ['<option value="">(not in sheet)</option>'].concat(tab.headers.filter(Boolean).map((h) => `<option value="${esc(h)}" ${g && g.header === h ? 'selected' : ''}>${esc(h)}</option>`)).join('');
          return `<tr><td><strong>${esc(field)}</strong>${required.includes(field) ? ' <span class="req">required</span>' : ''}<div class="muted">${esc(help || header)}</div></td>
<td><select name="col_${role}_${field}" data-tab-select="tab_${role}">${opts}</select>${g ? `<div class="muted">guessed, ${g.score}% match</div>` : ''}</td></tr>`;
        }).join('');
      };

      const formFields = base.formFields || ['who', 'discussed', 'followUp', 'followUpDate'];
      const body = `<h1>Map your sheet</h1>
<p>${esc(insp.title || 'Sheet')} has ${dataTabs.length} tab${dataTabs.length === 1 ? '' : 's'} with headers. The app guessed which is which; correct anything that's wrong. Dropdowns list the headers from the chosen tab, so if you change a tab, save once and come back to refine the columns.</p>
<form method="post" action="/admin/setup/map?key=${encodeURIComponent(k)}">
<fieldset><legend>About the campaign</legend>
<label>App name<input name="appName" value="${esc(base.appName)}"></label>
<label>Time zone<select name="timeZone">${TZS.map((z) => `<option ${base.timeZone === z ? 'selected' : ''}>${z}</option>`).join('')}</select></label>
</fieldset>
<fieldset><legend>Which tab is which</legend>
${tabSelect('tenants', 'Tenants (one row per unit)')}
${tabSelect('interactions', 'Conversations (one row per door knock or call)')}
${tabSelect('lists', 'Lists (dropdown choices and canvasser names)')}
</fieldset>
<fieldset><legend>Tenant columns</legend><table class="map">${fieldRows('tenants')}</table></fieldset>
<fieldset><legend>Conversation columns</legend><table class="map">${fieldRows('interactions')}</table></fieldset>
<fieldset><legend>List columns</legend><table class="map">${fieldRows('lists')}</table></fieldset>
<fieldset><legend>The door form</legend>
<p class="muted">How, what happened, unit and canvasser are always on the form. Choose what else canvassers see:</p>
${[['who', 'Who you talked to'], ['discussed', 'What was discussed'], ['followUp', 'Follow-up needed'], ['followUpDate', 'Follow-up date'], ['phone', 'Phone (saved to the tenant)'], ['email', 'Email (saved to the tenant)']].map(([f, l]) => `<label class="check"><input type="checkbox" name="form_${f}" ${formFields.includes(f) ? 'checked' : ''}> ${l}</label>`).join('')}
<p class="muted">Extra questions: any other column on the conversations tab can be a free-text question. List the exact headers, one per line.</p>
<textarea name="extraFields" rows="3" placeholder="e.g. Documentation available?">${esc((base.extraFields || []).map((x) => x.header).join('\n'))}</textarea>
</fieldset>
<button class="btn primary">Save mapping</button>
</form>`;
      res.send(page('Map sheet', body, k));
    } catch (e) { next(e); }
  });

  r.post('/setup/map', async (req, res, next) => {
    try {
      const k = req.key;
      const b = req.body;
      const base = loadConfig();
      const cfg = JSON.parse(JSON.stringify(base));
      delete cfg._path;
      cfg.appName = (b.appName || '').trim() || cfg.appName;
      cfg.timeZone = TZS.includes(b.timeZone) ? b.timeZone : cfg.timeZone;
      cfg.tabs = { tenants: b.tab_tenants, interactions: b.tab_interactions, lists: b.tab_lists, dashboard: cfg.tabs.dashboard };
      for (const role of ['tenants', 'interactions', 'lists']) {
        const cols = {};
        for (const field of Object.keys(base.columns[role])) {
          const v = (b[`col_${role}_${field}`] || '').trim();
          if (v) cols[field] = v;
        }
        cfg.columns[role] = cols;
      }
      cfg.formFields = ['who', 'discussed', 'followUp', 'followUpDate', 'phone', 'email'].filter((f) => b[`form_${f}`]);
      cfg.extraFields = String(b.extraFields || '').split('\n').map((s) => s.trim()).filter(Boolean).map((header) => ({ header, label: header, kind: 'text' }));
      await ctx.applyConfig(cfg, { persist: true });
      res.redirect(`/admin?key=${encodeURIComponent(k)}`);
    } catch (e) {
      res.status(400).send(page('Map sheet', `<h1>That mapping didn't work</h1><p class="err">${esc(e.message)}</p><p><a href="/admin/setup/map?key=${encodeURIComponent(req.key)}">Back to the mapping</a></p>`, req.key));
    }
  });

  // ---- build a new sheet ----------------------------------------------------------
  r.get('/setup/build', (req, res) => {
    const k = req.key;
    const base = loadConfig();
    const optional = Object.keys(base.columns.tenants).filter((f) => !['unit', 'name', 'status', 'building', 'lastContact', 'lastResponse', 'contacts', 'contactStatus', 'key'].includes(f));
    const listArea = (f, label) => `<label>${label}<textarea name="list_${f}" rows="4">${esc((base.defaultLists[f] || []).join('\n'))}</textarea></label>`;
    res.send(page('Build tracker', `<h1>Build a new tracker</h1>
<p>This creates the ${esc(base.tabs.tenants)}, ${esc(base.tabs.interactions)}, ${esc(base.tabs.lists)} and ${esc(base.tabs.dashboard)} tabs in the connected sheet, with headers, dropdowns, checkboxes and the formulas that link conversations to tenants. The sheet should be blank.</p>
<form method="post" action="/admin/setup/build?key=${encodeURIComponent(k)}">
<fieldset><legend>About the campaign</legend>
<label>App name (the building or campaign)<input name="appName" value="" placeholder="e.g. Riverside Apartments" required></label>
<label>Time zone<select name="timeZone">${TZS.map((z) => `<option ${base.timeZone === z ? 'selected' : ''}>${z}</option>`).join('')}</select></label>
<label class="check"><input type="checkbox" name="hasBuildings" checked> Units are in numbered buildings (unit 4 in building 8659). Uncheck for a single building or street addresses.</label>
</fieldset>
<fieldset><legend>Tenant fields to include</legend>
<p class="muted">Unit, name and status are always included. Uncheck anything you won't use; you can add columns later.</p>
${optional.map((f) => `<label class="check"><input type="checkbox" name="field_${f}" checked> ${esc(base.columns.tenants[f])}</label>`).join('')}
</fieldset>
<fieldset><legend>Dropdown choices</legend><p class="muted">One per line. Edit freely; these go on the Lists tab and can be changed there later.</p>
${listArea('statuses', 'Statuses')}${listArea('types', 'How (interaction types)')}${listArea('responses', 'What happened (responses)')}${listArea('grievanceTypes', 'Grievance tags')}
<label>Canvasser names<textarea name="list_canvassers" rows="4" placeholder="One per line"></textarea></label>
<label>Buildings<textarea name="list_buildings" rows="4" placeholder="One per line, e.g. 8659"></textarea></label>
</fieldset>
<button class="btn primary">Build the sheet</button>
</form>`, k));
  });

  r.post('/setup/build', async (req, res) => {
    try {
      const k = req.key;
      const b = req.body;
      const base = loadConfig();
      const cfg = JSON.parse(JSON.stringify(base)); delete cfg._path;
      cfg.appName = (b.appName || '').trim() || cfg.appName;
      cfg.timeZone = TZS.includes(b.timeZone) ? b.timeZone : cfg.timeZone;
      const keep = Object.keys(base.columns.tenants).filter((f) => ['unit', 'name', 'status', 'lastContact', 'lastResponse', 'contacts', 'contactStatus', 'key'].includes(f) || (f === 'building' ? !!b.hasBuildings : !!b[`field_${f}`]));
      cfg.columns.tenants = Object.fromEntries(keep.map((f) => [f, base.columns.tenants[f]]));
      if (!b.hasBuildings) { delete cfg.columns.interactions.building; delete cfg.columns.lists.buildings; }
      const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
      const lists = {};
      for (const f of ['statuses', 'types', 'responses', 'grievanceTypes', 'canvassers', 'buildings']) lists[f] = lines(b[`list_${f}`]);
      lists.languages = base.defaultLists.languages; lists.stay = base.defaultLists.stay;
      if (!lists.statuses.length || !lists.types.length || !lists.responses.length) throw new Error('Statuses, how, and what happened each need at least one choice.');
      cfg.formFields = ['who', 'discussed', 'followUp', 'followUpDate', 'phone', 'email'].filter((f) => f !== 'phone' && f !== 'email' ? true : cfg.columns.tenants[f]);
      await setup.buildSheet(ctx.store, cfg, { lists });
      await ctx.applyConfig(cfg, { persist: true });
      res.redirect(`/admin?key=${encodeURIComponent(k)}`);
    } catch (e) {
      res.status(400).send(page('Build tracker', `<h1>Couldn't build the sheet</h1><p class="err">${esc(e.message)}</p><p><a href="/admin/setup/build?key=${encodeURIComponent(req.key)}">Back</a></p>`, req.key));
    }
  });

  return r;
}

module.exports = { router };
