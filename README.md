# Canvass tracker

A phone-first web app for tenant organizing. Canvassers search a unit, see what's known about it, and log the conversation in under a minute. Everything lives in a Google Sheet that your organizers already know how to use; the app reads and writes it directly, so there's no vendor holding your tenants' data and nothing to export.

Built for the Woodland Manor campaign of the Oklahoma Tenants Union. Made to be forked: point it at your own sheet, or let it build one.

## What canvassers get

- **Search** by unit, building, or name. A "Needs a knock" filter shows units never contacted or overdue.
- **A tenant screen**: status, phone (tap to call), a "before you knock" note, grievance tags, the last conversation, and any follow-up due with a "Mark done" button.
- **A log form** with big tappable buttons for how and what happened, free text for the rest. Saving writes the conversation to the sheet and creates the tenant's row if the unit is new.
- **Other people in the unit**: a button on the form (closed by default) opens name, phone, email and consent boxes for a roommate or family member. They're kept on an optional `Residents` tab, one row per person, and listed on the tenant screen.
- **Edit details** from the phone: status, tags, contact info, notes.
- **Someone new lives here**: when a tenant moves out, one action clears the person-level fields (name, contact details, consents, group chat and the like, listed in `personFields`), writes who was there before into Notes, clears the unit's other residents, and keeps the unit's grievances and conversation history.

No Google sign-in and no passwords. Before each canvass an organizer shows a QR code; scanning it signs a canvasser in until the canvass ends (a few days), then everyone's access lapses on its own. Removing a name from the sheet revokes it at once.

## What organizers get

- The sheet, exactly as before. The app adds rows and edits cells; formulas, filters and the Dashboard keep working.
- `/admin`: a setup wizard, a door-form builder (questions, order, wording, kinds, validation), the sign-in QR code for the current canvass, a link per person for anyone who can't scan, and an overview of which fields are in use.
- Settings stored in a hidden tab inside the sheet, so they move with the data if the sheet changes hands.

## Set it up

You need: a Google account, a place to run a small Node app (Railway, Render, Fly, a Docker host, or any computer), and 15 minutes.

### 1. Service account (the app's own Google identity)

1. Go to https://console.cloud.google.com and create a project (any name).
2. APIs & Services > Library > enable **Google Sheets API**.
3. IAM & Admin > Service Accounts > Create. Name it `canvass-app`. No roles needed.
4. Open it > Keys > Add key > JSON. A file downloads. It's a password: keep it private, never commit it.
5. Copy the service account's email (ends in `iam.gserviceaccount.com`).

### 2. The sheet

Either:

- **Existing sheet**: open it, Share, add the service account email as **Editor**.
- **New sheet**: create a blank Google Sheet, name it, Share it with the service account email as **Editor**. The wizard builds the rest.

Copy the sheet's ID from its URL: the long string between `/d/` and `/edit`.

### 3. Deploy

**Railway**: New project > Deploy from GitHub repo > pick your fork. Railway detects Node. Under Variables add the four below, then Settings > Networking > Generate domain.

**Anywhere else**: `docker build -t canvass .` and run it with the same variables, or `npm ci && npm start` on any machine with Node 18+.

Variables:

| Name | What |
|---|---|
| `SHEET_ID` | from the sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the whole JSON key file as one value (base64 also accepted) |
| `APP_SECRET` | a long random string (`openssl rand -hex 32`). Personal links derive from it; changing it invalidates them |
| `ADMIN_KEY` | another long random string; unlocks `/admin` |

Optional: `BASE_URL` (public address, for links behind a proxy), `APP_NAME`, `TZ`, `PORT`.

Open `https://your-domain/healthz`. `{"ok":true,"configured":false}` means it's running and waiting for setup.

### 4. Run setup

Open `https://your-domain/admin?key=YOUR_ADMIN_KEY`.

- **Use my existing sheet**: the wizard reads every tab and header, guesses which tab holds tenants, which holds conversations, and which holds dropdown lists, and guesses each column. Correct anything it got wrong and save. Required columns are: unit, name and status for tenants; date, unit, canvasser, how and what happened for conversations; canvasser names, how, what happened and statuses on a lists tab. Everything else is optional and simply doesn't appear if it's missing.
- **Build a new tracker**: name the campaign, say whether units sit inside numbered buildings, tick the fields you want, edit the dropdown choices, list your canvassers. It creates `Tenants`, `Interactions`, `Lists` and `Dashboard` tabs with headers, dropdowns, checkboxes, and the formulas that link conversations to tenants (last contact, last response, contact status).

**The door form.** After setup, **Door form** in `/admin` lists every question canvassers answer. For each: the column it writes (a conversation column, or a tenant column that is pre-filled from the tenant's row and saved back), its kind (short or long text, phone, email, date, number, checkbox, pick one as buttons or a dropdown, pick many as chips), label, hint and placeholder, whether it's required, a pattern the answer must match with the message to show when it doesn't, whether the answer stays filled for the next conversation, and layout (a section heading, side-by-side rows, a checkbox tucked under the field above it, chips grouped by theme). Any column on either tab can become a question. The server checks every answer against the same rules, so the sheet only ever receives what the form allows.

If the sheet already matches the default layout (the Woodland Manor one, headers in `config/default.json`), the app configures itself on first start and the wizard is only needed to change things.

### 5. Canvassers and signing in

Sign-in is granted per canvass, not per person forever. Open **This canvass** in `/admin`:

- It shows a **QR code** (and the link behind it) for the current canvass, good for the default lifetime you set on the Canvassers step (3 days out of the box, up to a week). Project it at the kickoff, print the full-screen version, or paste the link into the group chat. Whoever scans it enters their email and name and is signed in until the canvass ends. A known email signs in as that person, whatever name they typed; a new email is added to the lists tab. Nothing is emailed to anyone automatically, so people who skip an event never hear about it.
- **Start a new sign-up link** before the next canvass. It signs everyone out: the old code, every personal link, and every phone that used them.
- **Links for one person**, for anyone who can't scan: *Email* and *Text* open your own mail or messages app with a ready-written message; *Copy link* copies it. These expire with the canvass too.

The skippable **Canvassers** step is the list of who may sign in, with their emails (stored on the lists tab; emails go in a "Canvasser email" column if the sheet has one), the default canvass length, and the message template.

**Email sign-in (optional).** Set the SMTP variables below and two things appear: a *Send email* button per person on This canvass, and *Sign in with your email* on the locked screen, which emails a one-time link (good for 15 minutes) to anyone whose email is on the list. That's the way back in for someone who left before the QR code went up.

| Name | What |
|---|---|
| `SMTP_HOST` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | `465` (default) or `587` |
| `SMTP_USER` | the sending address, e.g. your organization's Gmail |
| `SMTP_PASS` | its password. For Gmail, an **app password** (Google Account > Security > 2-Step Verification > App passwords), not the account password |
| `MAIL_FROM` | optional display form, e.g. `Riverside Tenants <riverside@gmail.com>` |

For local development, `MAIL_LOG=1` prints emails to the console instead of sending them.

## How the sheet is used

| Tab | The app... |
|---|---|
| Tenants | reads every row with a unit; writes a new row when a new unit is logged; edits the fields listed in `editableFields` |
| Interactions | writes one row per saved conversation, after the last row that has a date |
| Lists | reads dropdown choices, canvasser names and emails; writes personal links if a links column exists |
| Residents (optional) | one row per extra person in a unit: building, unit, name, phone, email, consent boxes, notes, added. Matched by unit and name; the form adds or updates. Without this tab the "other people" button doesn't appear |
| Formula columns | never written. The app writes `null` for those cells, which the Sheets API treats as "leave alone" |

Columns are found by header text, never by position, so you can reorder or insert columns freely. The "last filled row" is found from the unit / date column, because checkbox columns put a value on every row down to 1000 and would otherwise fool an append.

The key that links a conversation to a tenant is `building-unit` (`8659-4`) or just the unit when there's no building column. On a built sheet it's a formula column; on a mapped sheet the app computes it if the sheet doesn't.

## Configuration reference

`config/default.json` is the starting point for both wizards and the fallback when a sheet has no saved settings. The saved settings live in the hidden `Canvass config` tab (cell A2, JSON). Keys:

- `appName`, `timeZone`
- `tabs`: names of the tenants / interactions / lists / dashboard tabs
- `columns.<tab>`: `{ field: "Header text" }`. Remove a field to tell the app the sheet doesn't have it.
- `checkboxFields`, `formulaFields`: which fields are checkboxes (read/written as TRUE/FALSE) and which are formulas (never written)
- `editableFields`: tenant fields organizers may change from the phone
- `personFields`: tenant fields that belong to the person rather than the unit; "Someone new lives here" clears them
- `form.fields`: the door form, one entry per question, in order. Each has `id` (a column key from `columns`, with `target: "tenant"` for a tenant-row column, or `h:Header text` for any other column), `kind` (`text`, `textarea`, `tel`, `email`, `date`, `number`, `checkbox`, `choice`, `select`, `tags`), `label`, `hint`, `placeholder`, `required`, `pattern` + `patternHint`, `sticky` (keep the answer for the next conversation), `list` or `options` for choices, `grouped` (chips by `tagGroups`), `onlyOn` (a tenant checkbox the form can set but never clear), and layout: `section` / `sectionHint`, `row` (questions sharing a row name sit side by side), `under` (inside the previous question's box). The **Door form** page in `/admin` edits all of this; older configs with `formFields` / `extraFields` are read as before.
- `tagGroups`: `[{ "label": "Inside the unit", "tags": [...] }]`, how pick-many chips are grouped; tags not in any group appear under "Other"
- `newUnitStatus`: status given to a tenant row created from a conversation, by response
- `contactStatus`: stale window, dead-end statuses, and label text used by the built formula
- `tagGroups`: `[{ "label": "Inside the unit", "tags": [...] }]`, how grievance tags are grouped on the phone; tags not in any group appear under "Other"
- `defaultLists`: dropdown choices the build wizard starts from

To change settings for a sheet that's already configured, re-run the mapping wizard; it starts from the saved settings.

## Development

```
npm install
npm run dev          # mock sheet with invented sample data; admin key and secret are "dev"; emails print to the console
npm run dev:blank    # mock blank sheet, to try the build wizard
npm test             # tracker, schema, wizard logic, auth
```

Local URLs: `http://localhost:3000/admin?key=dev`. The sign-in QR and personal links are under This canvass.

Code map: `server.js` (routes), `lib/schema.js` (headers to columns), `lib/tracker.js` (read/write logic), `lib/setup.js` (inspect, guess, build, saved settings), `lib/admin.js` (organizer pages), `lib/auth.js` (links and cookies), `public/` (the canvasser UI, one file of plain JS).

## Privacy notes

- Tenant data stays in your Google Sheet and in the browser of a signed-in canvasser. The app server holds it in memory for 15 seconds at a time (a read cache) and logs nothing about tenants.
- Sign-in links and cookies are signed bearer tokens that expire with the canvass; nothing is stored server-side. Anyone with a live personal link can log as that person, so don't post those publicly (the QR link is meant to be shared, and only creates or matches a name). Starting a new canvass, or changing `APP_SECRET`, signs everyone out.
- The service account key gives full edit access to any sheet shared with it. Keep it in the host's secret store only.
- This repo's sample data is invented. Keep it that way in your fork: never commit a real sheet export.

## Moving hosts or accounts

Nothing about the data moves. Deploy the same repo elsewhere with the same four variables (same `APP_SECRET` keeps existing links valid), generate a domain, and either set `BASE_URL` or hand out fresh links. The service account, the sheet share, and the settings in the sheet are unchanged.

## License

CC0. Take it, change it, organize.
