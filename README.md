# Canvass tracker

A phone-first web app for tenant organizing. Canvassers search a unit, see what's known about it, and log the conversation in under a minute. Everything lives in a Google Sheet that your organizers already know how to use; the app reads and writes it directly, so there's no vendor holding your tenants' data and nothing to export.

Built for the Woodland Manor campaign of the Oklahoma Tenants Union. Made to be forked: point it at your own sheet, or let it build one.

## What canvassers get

- **Search** by unit, building, or name. A "Needs a knock" filter shows units never contacted or overdue.
- **A tenant screen**: status, phone (tap to call), a "before you knock" note, grievance tags, the last conversation, and any follow-up due with a "Mark done" button.
- **A log form** with big tappable buttons for how and what happened, free text for the rest. Saving writes the conversation to the sheet and creates the tenant's row if the unit is new.
- **Edit details** from the phone: status, tags, contact info, notes.

No Google sign-in. Each canvasser gets a personal link that signs them in; removing their name from the sheet revokes it.

## What organizers get

- The sheet, exactly as before. The app adds rows and edits cells; formulas, filters and the Dashboard keep working.
- `/admin`: a setup wizard, the list of personal links, and an overview of which fields are in use.
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

- **Use my existing sheet**: the wizard reads every tab and header, guesses which tab holds tenants, which holds conversations, and which holds dropdown lists, and guesses each column. Correct anything it got wrong, pick which fields appear on the door form, add any extra columns as questions, save. Required columns are: unit, name and status for tenants; date, unit, canvasser, how and what happened for conversations; canvasser names, how, what happened and statuses on a lists tab. Everything else is optional and simply doesn't appear if it's missing.
- **Build a new tracker**: name the campaign, say whether units sit inside numbered buildings, tick the fields you want, edit the dropdown choices, list your canvassers. It creates `Tenants`, `Interactions`, `Lists` and `Dashboard` tabs with headers, dropdowns, checkboxes, and the formulas that link conversations to tenants (last contact, last response, contact status).

If the sheet already matches the default layout (the Woodland Manor one, headers in `config/default.json`), the app configures itself on first start and the wizard is only needed to change things.

### 5. Canvassers and their links

After setup, a skippable **Canvassers** step lets you add names and optional emails (stored on the lists tab; emails go in a "Canvasser email" column if the sheet has one). Then **Links** shows a personal link per person with three buttons: *Email* and *Text* open your own mail or messages app with a ready-written message containing their link, *Copy link* copies it. Nothing is sent by the app itself; the link comes from a person they know. On a phone they open it once and "Add to Home Screen".

Add or remove a canvasser on the Canvassers step (or by editing the sheet). A removed name's link stops working on the next request. The message template is editable on the same step.

**Let people sign themselves up.** On the Canvassers step, create a sign-up link good for a day to a month and paste it into the volunteer group chat. Whoever opens it enters a name and optional email, is added to the lists tab, and lands in the app already signed in with their personal link and home-screen instructions. "Cancel all sign-up links" invalidates every outstanding one.

**Send the links from the app (optional).** Set these variables and the Links page gains *Send email* per person and *Send to everyone not yet sent*; each send stamps the date in a "Link sent" column on the lists tab if one exists.

| Name | What |
|---|---|
| `SMTP_HOST` | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | `465` (default) or `587` |
| `SMTP_USER` | the sending address, e.g. your organization's Gmail |
| `SMTP_PASS` | its password. For Gmail, an **app password** (Google Account > Security > 2-Step Verification > App passwords), not the account password |
| `MAIL_FROM` | optional display form, e.g. `Riverside Tenants <riverside@gmail.com>` |

Without them, the Email and Text buttons open your own mail or messages app, which is a fine way to run a small team.

## How the sheet is used

| Tab | The app... |
|---|---|
| Tenants | reads every row with a unit; writes a new row when a new unit is logged; edits the fields listed in `editableFields` |
| Interactions | writes one row per saved conversation, after the last row that has a date |
| Lists | reads dropdown choices and canvasser names; writes personal links if a links column exists |
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
- `formFields`: which optional questions the door form shows (`who`, `discussed`, `followUp`, `followUpDate`, `phone`, `email`)
- `extraFields`: `[{ "header": "Documentation available?", "label": "Documentation?", "kind": "text" | "textarea" }]`, extra questions written to the conversations tab by header
- `newUnitStatus`: status given to a tenant row created from a conversation, by response
- `contactStatus`: stale window, dead-end statuses, and label text used by the built formula
- `defaultLists`: dropdown choices the build wizard starts from

To change settings for a sheet that's already configured, re-run the mapping wizard; it starts from the saved settings.

## Development

```
npm install
npm run dev          # mock sheet with invented sample data; admin key and secret are "dev"
npm run dev:blank    # mock blank sheet, to try the build wizard
npm test             # tracker, schema, wizard logic, auth
```

Local URLs: `http://localhost:3000/admin?key=dev`. Personal links are listed there.

Code map: `server.js` (routes), `lib/schema.js` (headers to columns), `lib/tracker.js` (read/write logic), `lib/setup.js` (inspect, guess, build, saved settings), `lib/admin.js` (organizer pages), `lib/auth.js` (links and cookies), `public/` (the canvasser UI, one file of plain JS).

## Privacy notes

- Tenant data stays in your Google Sheet and in the browser of a signed-in canvasser. The app server holds it in memory for 15 seconds at a time (a read cache) and logs nothing about tenants.
- Personal links are bearer tokens: anyone with the link can log as that person. Don't post them publicly. Rotate everyone's links by changing `APP_SECRET`.
- The service account key gives full edit access to any sheet shared with it. Keep it in the host's secret store only.
- This repo's sample data is invented. Keep it that way in your fork: never commit a real sheet export.

## Moving hosts or accounts

Nothing about the data moves. Deploy the same repo elsewhere with the same four variables (same `APP_SECRET` keeps existing links valid), generate a domain, and either set `BASE_URL` or hand out fresh links. The service account, the sheet share, and the settings in the sheet are unchanged.

## License

CC0. Take it, change it, organize.
