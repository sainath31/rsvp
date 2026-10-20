# RSVP – gender reveal invitation

Features: opening screen with a smoke-swirl reveal, background music (starts when a guest opens the invitation, pauses while they scroll away from the video, music button to turn it off; uploaded track or built-in melody), invitation photo upload,
RSVP with name / adults / children / email, host-only dashboard (`/admin`, password protected),
email confirmations + automatic reminders (e.g. 7 and 1 days before), one-tap Add to Calendar (iPhone, Android and desktop), CSV export.

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

## Deployments
- **Production (Vercel, free):** see [DEPLOY.md](DEPLOY.md). Redis stores guests, Blob stores optional uploads, a daily Cron sends reminders.
- **Any host with a persistent disk:** `NODE_ENV=production ADMIN_PASSWORD=... SESSION_SECRET=... DATA_DIR=/data npm start`.
- **GitHub Pages preview:** static only (`public/demo.js` fakes the API in the visitor's browser; host password `demo`).
- **Tests:** `node tests/prod.mjs` (Redis, Blob, cron, sessions, security) and `node tests/ui.mjs` (host login screen, security policy).
