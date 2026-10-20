# Deploying to Vercel (free Hobby plan)

The app runs on Vercel as one serverless function (`api/index.js`) that serves the pages, the API and the media.
Because Vercel has no permanent disk, guest data lives in **Upstash Redis** and optional uploads in **Vercel Blob**.
A daily **Cron Job** sends the reminder emails.

## 1. Import the project
1. vercel.com → **Add New… → Project** → import the GitHub repo `sainath31/rsvp`.
2. Leave the framework and build settings alone (`vercel.json` sets everything; Vercel will note that project settings are ignored - that is expected). Click **Deploy**.
   (Do not share the link yet - storage and the host password are not set up.)

## 2. Add storage (Project → Storage)
- **Redis (required):** *Create Database* → **Upstash for Redis** (free plan) → connect it to this project.
  This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically (a custom prefix such as `STORAGE_` is also recognised).
- **Blob (optional):** *Create Database* → **Blob** → connect. Adds `BLOB_READ_WRITE_TOKEN`.
  Without it the built-in video, picture and music are used and the dashboard upload buttons are switched off.
  With it, uploads are limited to about 4 MB each (Vercel's request limit).

## 3. Environment variables (Project → Settings → Environment Variables, Production)
| Name | Value |
|---|---|
| `ADMIN_PASSWORD` | the host password you choose (10+ characters) |
| `SESSION_SECRET` | any long random text (e.g. run `openssl rand -hex 32`) |
| `CRON_SECRET` | another long random text |
| `PUBLIC_URL` | your site address, e.g. `https://rsvp-xxxx.vercel.app` (no trailing slash) |
| `GMAIL_USER` | the Gmail address that sends the emails |
| `GMAIL_APP_PASSWORD` | a Google **App password** (Google Account → Security → 2-Step Verification → App passwords) |
| `MAIL_FROM_NAME` | `Mamatha Devi & Sainath` |

## 4. Redeploy
Deployments → the latest one → **⋯ → Redeploy** (environment variables only apply to new deployments).

## 5. Check it works
- `https://YOUR-SITE/healthz` should show `"storage":"redis"` (if it says `file`, the database is not connected: it then also lists the variable names it found), `"email":true`, `"hostLogin":true`.
- Open the invitation, submit a test RSVP, then sign in with the profile icon (top right) and look for it in Guests.
- Dashboard → **Notify tab → Send test to me** sends a test email.
- Project → Settings → **Cron Jobs** lists `/api/cron/reminders` (daily).

## Notes
- **Reminders:** the Hobby plan runs a cron job once a day (14:00 UTC = 10 AM Eastern). The 7-day and 1-day reminders go out on the first run after each moment passes, once per guest.
- **Changing the host password:** change `ADMIN_PASSWORD` in Vercel and redeploy. Everyone is signed out.
- **Hobby plan terms:** personal, non-commercial use. A family party is fine.
- **Another host:** any host with a persistent disk works too (`npm start`, set `DATA_DIR` to the disk and `NODE_ENV=production`).
