# RSVP – gender reveal invitation

Features: opening screen + background music (uploaded track or built-in melody), invitation photo upload,
RSVP with name / adults / children / WhatsApp number, host-only dashboard (`/admin`, password protected),
WhatsApp confirmations + automatic reminders (e.g. 7 and 1 days before), calendar (.ics) download, CSV export.

## Run
```
cp .env.example .env   # set ADMIN_PASSWORD etc.
npm install
npm start              # http://localhost:3000, host dashboard at /admin
```
The guest list is only returned by authenticated `/api/admin/*` routes.

## Email (Gmail, free)
Turn on 2-Step Verification for your Google account, create an **App password**, then set `GMAIL_USER` and
`GMAIL_APP_PASSWORD`. Guests get a confirmation email (with a calendar invite attached), you get one per RSVP,
and reminders are emailed automatically (7 and 1 days before by default). Personal Gmail allows ~500 emails/day.

## WhatsApp (optional)
Set the `TWILIO_*` variables (Twilio WhatsApp API). Without them, each guest in the dashboard has a one-tap
click-to-chat button. Note: WhatsApp only allows business-initiated messages outside a 24h window via an
approved template (`TWILIO_CONTENT_SID`, body `{{1}}`).

## Deployments
- **GitHub Pages** (`.github/workflows/pages.yml`): static *preview only*. Pages cannot run the Node server, so `public/demo.js`
  emulates the API in the visitor's browser (host password `demo`; no uploads/WhatsApp).
- **Vercel / production**: needs the real backend. Data is stored in `DATA_DIR/db.json` and uploads on disk, which
  do not persist on Vercel serverless – use a host with a volume (Render/Railway/Fly) or move storage to a DB + blob store.
