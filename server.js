import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { getEvent, saveEvent, listGuests, putGuest, removeGuest, storageKind, dataIsDurable, redisVarNames, UPLOAD_DIR } from './lib/store.js';
import { mediaMode, maxUploadMB, mediaUrl, saveMedia, deleteMedia } from './lib/media.js';
import { sendMail, isMailConfigured, validEmail } from './lib/mail.js';
import { notifyGuest, channelsConfigured } from './lib/notify.js';
import { render, fmtDate, buildIcs, googleCalUrl } from './lib/messages.js';
import { remindGuest, runReminders, startScheduler } from './lib/reminders.js';
import { securityHeaders, timingSafeEqualStr, issueSession, verifySession, sessionCookie, clearCookie, readCookie } from './lib/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
// Trimmed: a stray space or newline pasted into the hosting settings must not lock you out.
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();
process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;

// The host password is set by you (ADMIN_PASSWORD). In production it must be a real one.
let loginProblem = '';
if (!ADMIN_PASSWORD) loginProblem = 'ADMIN_PASSWORD is not set';
else if (IS_PROD && ADMIN_PASSWORD.length < 10) loginProblem = 'ADMIN_PASSWORD must be at least 10 characters in production';
if (loginProblem) {
  console.error(`⚠  Host login is disabled: ${loginProblem}.`);
  if (IS_PROD && !process.env.VERCEL) { console.error('Refusing to start in production without a strong ADMIN_PASSWORD.'); process.exit(1); }
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.json({ limit: '100kb' }));

const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get(['/healthz', '/api/healthz'], wrap(async (req, res) => {
  await getEvent({ fresh: true }); // proves the storage is reachable
  res.json({
    ok: true, storage: storageKind, uploads: mediaMode, email: isMailConfigured(), hostLogin: !loginProblem,
    ...(loginProblem ? { hostLoginProblem: loginProblem } : {}),
    ...(!dataIsDurable ? { warning: 'The database is not connected, so RSVPs are NOT being saved permanently. Connect the Redis database to this project and redeploy.', variableNamesOnThisSite: redisVarNames() } : {}),
  });
}));

/* ---------- host login (password comes from ADMIN_PASSWORD; signed cookie, no server-side session store) ---------- */
const attempts = new Map();
function requireAdmin(req, res, next) {
  if (verifySession(readCookie(req, 'sid'))) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
app.post('/api/admin/login', wrap(async (req, res) => {
  if (loginProblem) return res.status(503).json({ error: `Host login is not set up: ${loginProblem}. Add it in your hosting settings and redeploy.` });
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60_000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 8) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  if (!timingSafeEqualStr(String(req.body?.password || '').trim(), ADMIN_PASSWORD)) {
    a.n++; attempts.set(ip, a);
    console.warn(`[login] wrong password (attempt ${a.n})`);
    await new Promise((r) => setTimeout(r, 500)); // slows down guessing even across several server instances
    return res.status(401).json({ error: 'Wrong password' });
  }
  attempts.delete(ip);
  res.set('Set-Cookie', sessionCookie(issueSession(), req.secure));
  res.json({ ok: true });
}));
app.post('/api/admin/logout', (req, res) => { res.set('Set-Cookie', clearCookie(req.secure)); res.json({ ok: true }); });
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true }));

/* ---------- public ---------- */
const publicEvent = (ev) => ({
  title: ev.title, hosts: ev.hosts, startsAt: ev.startsAt, tz: ev.tz, venue: ev.venue,
  address: ev.address, mapUrl: ev.mapUrl, message: ev.message, dressCode: ev.dressCode,
  durationHours: ev.durationHours, rsvpDeadline: ev.rsvpDeadline,
  image: mediaUrl(ev.image), video: mediaUrl(ev.video), music: mediaUrl(ev.music),
});
app.get('/api/event', wrap(async (req, res) => {
  // Guests only read this. Let Vercel's edge cache it for 30s so a busy day costs almost no database calls.
  res.set('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=120');
  res.json(publicEvent(await getEvent()));
}));

const rsvpHits = new Map();
app.post('/api/rsvp', wrap(async (req, res) => {
  const hits = (rsvpHits.get(req.ip) || []).filter((t) => Date.now() - t < 10 * 60_000);
  if (hits.length >= 10) return res.status(429).json({ error: 'Too many submissions. Please try again shortly.' });
  rsvpHits.set(req.ip, [...hits, Date.now()]);

  const b = req.body || {};
  const name = clean(b.name, 80);
  const status = ['yes', 'no', 'maybe'].includes(b.status) ? b.status : 'yes';
  const toInt = (v, max) => Math.min(max, Math.max(0, parseInt(v, 10) || 0));
  let adults = toInt(b.adults, 20);
  const children = status === 'no' ? 0 : toInt(b.children, 20);
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (status !== 'no' && adults < 1) adults = 1;
  if (status === 'no') adults = 0;
  const guess = status === 'no' ? '' : ['boy', 'girl'].includes(b.guess) ? b.guess : '';

  const email = clean(b.email, 120).toLowerCase();
  if (!email && status !== 'no') return res.status(400).json({ error: 'Please enter your email so we can send your confirmation and a reminder.' });
  if (email && !validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  const [event, guests] = await Promise.all([getEvent(), listGuests()]);
  // Same person re-submitting (same email, or same name when no email was given) updates their RSVP.
  let guest = guests.find((g) => (email && g.email === email) || (!email && !g.email && g.name.toLowerCase() === name.toLowerCase()));
  const isNew = !guest;
  if (isNew) guest = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), reminders: {} };
  Object.assign(guest, { name, email, guess, status, adults, children, note: clean(b.note, 300), updatedAt: new Date().toISOString() });
  await putGuest(guest);

  const link = baseUrl(req);
  const label = { yes: 'attending', no: 'not attending', maybe: 'maybe' }[status];
  const summary = `New RSVP: ${name} – ${label}${guess ? ` – Team ${guess === 'boy' ? 'Boy' : 'Girl'}` : ''}${status !== 'no' ? ` (${adults} adult${adults === 1 ? '' : 's'}, ${children} child${children === 1 ? '' : 'ren'})` : ''}${guest.note ? `\nNote: ${guest.note}` : ''}`;
  const hostEmail = event.hostEmail || process.env.GMAIL_USER;
  const jobs = [];
  if (hostEmail) jobs.push(sendMail(hostEmail, `RSVP: ${name} – ${label}`, summary, link + '/admin').then((r) => !r.ok && console.warn('[host mail]', r.error)));
  if (email) jobs.push(notifyGuest(guest, `Your RSVP: ${event.title}`, render(event.confirmTemplate, event, guest, link) + (status !== 'no' ? `\n\nAdd to calendar: ${googleCalUrl(event, link)}` : ''), link, status !== 'no' ? [{ filename: 'invitation.ics', content: buildIcs(event, link), contentType: 'text/calendar' }] : undefined).then((r) => !r.ok && console.warn('[confirm]', r.error)));
  // On serverless the function may be frozen once the response is sent, so wait for the emails; they never block the RSVP itself.
  if (process.env.VERCEL) await Promise.allSettled(jobs);
  res.json({ ok: true, updated: !isNew, status, adults, children });
}));

app.get(['/event.ics', '/api/event.ics'], wrap(async (req, res) => {
  // inline (not attachment) lets iPhone Safari open its "Add to Calendar" sheet directly; Android downloads it.
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="invitation.ics"', 'Cache-Control': 'no-cache' }).send(buildIcs(await getEvent(), baseUrl(req)));
}));

if (mediaMode === 'disk') app.use('/media', express.static(UPLOAD_DIR, { maxAge: '1h', index: false, setHeaders: (r) => r.set('Content-Disposition', 'inline') }));

/* ---------- reminders (Vercel Cron calls this daily; other hosts use the built-in scheduler) ---------- */
app.get('/api/cron/reminders', wrap(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(404).json({ error: 'Not found' });
  if (!timingSafeEqualStr(req.headers.authorization || '', `Bearer ${secret}`)) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ ok: true, ...(await runReminders(baseUrl(req))) });
}));

/* ---------- admin: event + uploads ---------- */
app.put('/api/admin/event', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const ev = await getEvent();
  const str = { title: 120, hosts: 120, venue: 120, address: 200, mapUrl: 400, message: 1000, dressCode: 120, rsvpDeadline: 40, tz: 60, hostEmail: 120, confirmTemplate: 600, reminderTemplate: 600 };
  for (const [k, max] of Object.entries(str)) if (k in b) ev[k] = clean(k.endsWith('Template') || k === 'message' ? String(b[k]).replace(/\r/g, '') : b[k], max) || (k.endsWith('Template') ? ev[k] : '');
  if (b.startsAt && !isNaN(new Date(b.startsAt))) ev.startsAt = new Date(b.startsAt).toISOString();
  if ('durationHours' in b) ev.durationHours = Math.min(24, Math.max(1, Number(b.durationHours) || 3));
  if (Array.isArray(b.reminderDays)) ev.reminderDays = b.reminderDays.map(Number).filter((n) => n > 0 && n <= 90).slice(0, 5);
  if (ev.mapUrl && !/^https?:\/\//i.test(ev.mapUrl)) ev.mapUrl = '';
  if (ev.hostEmail && !validEmail(ev.hostEmail)) ev.hostEmail = '';
  await saveEvent(ev);
  res.json({ ok: true, event: ev });
}));

const KINDS = {
  image: { types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }, max: 10 },
  video: { types: { 'video/mp4': 'mp4', 'video/webm': 'webm' }, max: 25 },
  music: { types: { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }, max: 25 },
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
app.post('/api/admin/upload/:kind', requireAdmin, (req, res, next) => (mediaMode === 'none' ? res.status(501).json({ error: 'Uploads are not available on this hosting. Add a Vercel Blob store, or use a host with a persistent disk.' }) : next()), upload.single('file'), wrap(async (req, res) => {
  const kind = KINDS[req.params.kind];
  if (!kind || !req.file) return res.status(400).json({ error: 'No file' });
  const ext = kind.types[req.file.mimetype];
  if (!ext) return res.status(400).json({ error: 'Unsupported file type' });
  const limit = maxUploadMB(kind.max);
  if (req.file.size > limit * 1024 * 1024) return res.status(400).json({ error: `File too large (max ${limit}MB on this hosting)` });
  const ev = await getEvent();
  const ref = await saveMedia(req.params.kind, req.file.buffer, ext, req.file.mimetype);
  const old = ev[req.params.kind];
  ev[req.params.kind] = ref;
  await saveEvent(ev);
  await deleteMedia(old);
  res.json({ ok: true, url: mediaUrl(ref) });
}));
app.delete('/api/admin/upload/:kind', requireAdmin, wrap(async (req, res) => {
  if (!KINDS[req.params.kind]) return res.status(400).json({ error: 'Bad kind' });
  const ev = await getEvent();
  const old = ev[req.params.kind];
  ev[req.params.kind] = '';
  await saveEvent(ev);
  await deleteMedia(old);
  res.json({ ok: true });
}));

/* ---------- admin: guests (host-only) ---------- */
app.get('/api/admin/event', requireAdmin, wrap(async (req, res) => {
  const ev = await getEvent();
  res.json({ ...ev, storage: storageKind, durable: dataIsDurable, imageUrl: mediaUrl(ev.image), videoUrl: mediaUrl(ev.video), musicUrl: mediaUrl(ev.music), link: baseUrl(req), email: isMailConfigured(), uploads: mediaMode !== 'none', maxUploadMB: { image: maxUploadMB(10), video: maxUploadMB(25), music: maxUploadMB(25) } });
}));
app.get('/api/admin/guests', requireAdmin, wrap(async (req, res) => {
  const guests = (await listGuests()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ guests });
}));
app.delete('/api/admin/guests/:id', requireAdmin, wrap(async (req, res) => { await removeGuest(req.params.id); res.json({ ok: true }); }));
app.get('/api/admin/guests.csv', requireAdmin, wrap(async (req, res) => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  const rows = [['Name', 'Email', 'Status', 'Adults', 'Children', 'Guess', 'Note', 'RSVP date'], ...(await listGuests()).map((g) => [g.name, g.email, g.status, g.adults, g.children, g.guess, g.note, g.createdAt])];
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="guests.csv"').send(rows.map((r) => r.map(q).join(',')).join('\n'));
}));
app.post('/api/admin/remind', requireAdmin, wrap(async (req, res) => {
  if (!channelsConfigured()) return res.status(400).json({ error: 'Email is not configured on the server (set GMAIL_USER and GMAIL_APP_PASSWORD).' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  const event = await getEvent();
  const targets = (await listGuests()).filter((g) => g.email && g.status !== 'no' && (!ids || ids.includes(g.id)));
  let sent = 0; const failed = [];
  for (const g of targets) {
    const r = await remindGuest(g, baseUrl(req), event);
    if (r.ok) sent++; else failed.push(`${g.name}: ${r.error}`);
  }
  res.json({ ok: true, sent, failed });
}));
app.post('/api/admin/test-email', requireAdmin, wrap(async (req, res) => {
  const ev = await getEvent(), to = ev.hostEmail || process.env.GMAIL_USER;
  if (!to) return res.status(400).json({ error: 'Add your email address first.' });
  const r = await sendMail(to, 'Test notification', `✅ Email is connected for "${ev.title}" (${fmtDate(ev)}).`);
  res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: r.error });
}));

/* ---------- pages ---------- */
// The home page gets absolute URLs for link previews (WhatsApp / iMessage show the picture and title when the link is shared).
let indexHtml;
const sendIndex = (req, res) => {
  indexHtml ||= fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
  res.set('Cache-Control', 'no-cache').type('html').send(indexHtml.replaceAll('__SITE_URL__', baseUrl(req)));
};
app.get(['/', '/index.html'], sendIndex);
app.get('/admin', (req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public/admin.html')));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '5m', extensions: ['html'],
  setHeaders: (res, file) => { if (!/\.html$/.test(file)) res.set('Cache-Control', 'public, max-age=300, s-maxage=3600'); },
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`RSVP running on http://localhost:${PORT}  (storage: ${storageKind}, uploads: ${mediaMode}, host login: ${loginProblem ? 'DISABLED' : 'on'})`);
    console.log(`Email: ${isMailConfigured() ? 'enabled' : 'not configured (set GMAIL_USER and GMAIL_APP_PASSWORD)'}`);
    startScheduler(process.env.PUBLIC_URL || `http://localhost:${PORT}`);
  });
}
