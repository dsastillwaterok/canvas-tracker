# Woodland Manor canvass app

A phone-first web app for door knocking. It reads and writes the **Woodland Manor Tenant Tracker** Google Sheet directly, so the sheet stays the source of truth and the Dashboard keeps working. It replaces the Google Form.

What canvassers get:

- Search by unit, building, or name. "Needs a knock" filters to units never contacted or overdue.
- A tenant screen: status, last conversation, grievance tags, accessibility notes, phone number as a tap-to-call link, follow-up due banner.
- A log form with big tappable buttons for how and what happened, free text for the rest. Saves straight into the Interactions tab and creates the Tenants row for a new unit.
- Edit the tenant's details (status, grievance tags, group chat, contact info, notes).

No Google sign-in. Each canvasser has a personal link that signs them in; access is revoked by removing their name from the Lists tab.

## How it fits the sheet

| Sheet | App |
|---|---|
| `Tenants` A:V | Read for the list and tenant screen; new rows written on a new unit; a few columns editable |
| `Tenants` W:AA | Formulas. Never written. The app shows what they say. |
| `Interactions` A:K | One row per saved conversation |
| `Lists` | Dropdown values, canvasser names (column E), buildings (column I) |

Column positions are in `lib/tracker.js` at the top. If a column is added to the sheet, update the map there.

## Deploy on Railway

### 1. Service account (one time, 5 minutes)

The app needs its own Google identity to edit the sheet.

1. Go to https://console.cloud.google.com and create a project (any name, e.g. `otu-canvass`).
2. APIs & Services > Library > enable **Google Sheets API**.
3. IAM & Admin > Service Accounts > Create. Name it `canvass-app`. No roles needed.
4. Open the service account > Keys > Add key > JSON. A file downloads. Keep it private; it is a password.
5. Copy the service account's email address (ends in `iam.gserviceaccount.com`). In the Google Sheet, Share it with that address as **Editor**.

### 2. Railway

1. New project > Deploy from GitHub repo > pick this repo. Railway detects Node and runs `npm start`.
2. Variables tab, add:
   - `SHEET_ID`: the long id from the sheet's URL
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: the entire contents of the downloaded JSON file, pasted as one value
   - `APP_SECRET`: a long random string (`openssl rand -hex 32`). Personal links are derived from it; changing it later invalidates every link.
   - `ADMIN_KEY`: another long random string
   - `TZ`: `America/Chicago`
3. Settings > Networking > Generate domain. Optionally add `BASE_URL` = that domain (with https://) so links are generated correctly behind the proxy.
4. Open `https://<your-domain>/healthz`. It should say `{"ok":true}`.

### 3. Hand out links

Open `https://<your-domain>/admin?key=<ADMIN_KEY>`. It lists a personal link for every name in the Lists tab's Canvassers column. "Write these links to the Lists tab" copies them into column H next to each name.

Send each canvasser their link. On a phone: open it, then "Add to Home Screen". From then on it opens as an app with their name already set.

Add a canvasser: add their name on the Lists tab, reload `/admin`, send them the new link. Remove one: delete the name; their link and cookie stop working on the next request.

## Moving to another Railway account later

Nothing about the data moves. In the new account: deploy the same repo, set the same five variables (same `APP_SECRET` keeps everyone's links valid), generate a domain, and either update `BASE_URL` or hand out fresh links from `/admin`. The service account and the sheet share are unchanged.

## Local development

```
npm install
MOCK_SHEET=1 APP_SECRET=dev ADMIN_KEY=dev npm start   # in-memory sheet with sample data
npm test                                               # logic tests against the mock
```

Against the real sheet, copy `.env.example` to `.env`, fill it in, and run with a loader such as `node --env-file=.env server.js` (Node 20+).

## Retiring the Google Form

Once canvassers are on the app:

1. In the sheet, Extensions > Apps Script, delete the `copyResponseToInteractions` and `syncFormChoices` triggers (clock icon in the left bar). Keep `onEdit` if organizers still type rows by hand; it still creates Tenants rows for them.
2. Unlink the form (Form editor > Responses > three dots > Unlink) or just stop sharing it. The `Form Responses 1` tab can be deleted.
