import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { getDb, save, UPLOAD_DIR } from './lib/store.js';
import { sendWhatsApp, isConfigured, normalizePhone } from './lib/whatsapp.js';
import { sendMail, isMailConfigured, validEmail } from './lib/mail.js';
import { notifyGuest, channelsConfigured } from './lib/notify.js';
import { render, fmtDate, buildIcs, googleCalUrl } from './lib/messages.js';
import { remindGuest, startScheduler } from './lib/reminders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) console.warn('⚠  ADMIN_PASSWORD is not set – admin login is disabled. Set it in .env / environment.');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
  next();
});

const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

/* ---------- auth (single host, in-memory sessions) ---------- */
const sessions = new Map();
const attempts = new Map();
const cookie = (req, name) =>
  (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];
const safeEq = (a, b) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};
function requireAdmin(req, res, next) {
  const exp = sessions.get(cookie(req, 'sid'));
  if (exp && exp > Date.now()) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60_000) { a.n = 0; a.t = Date.now(); }
  if (a.n >= 8) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const pw = String(req.body?.password || '');
  if (!ADMIN_PASSWORD || !safeEq(pw, ADMIN_PASSWORD)) {
    a.n++; attempts.set(ip, a);
    return res.status(401).json({ error: 'Wrong password' });
  }
  attempts.delete(ip);
  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, Date.now() + 14 * 864e5);
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${14 * 86400}${secure}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  sessions.delete(cookie(req, 'sid'));
  res.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true, whatsapp: isConfigured() }));

/* ---------- public ---------- */
const publicEvent = (ev) => ({
  title: ev.title, hosts: ev.hosts, startsAt: ev.startsAt, tz: ev.tz, venue: ev.venue,
  address: ev.address, mapUrl: ev.mapUrl, message: ev.message, dressCode: ev.dressCode,
  rsvpDeadline: ev.rsvpDeadline, image: ev.image ? `/media/${ev.image}` : '',
  music: ev.music ? `/media/${ev.music}` : '',
});

app.get('/api/event', (req, res) => res.json(publicEvent(getDb().event)));

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const rsvpHits = new Map();

app.post('/api/rsvp', async (req, res) => {
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
  const phoneRaw = clean(b.phone, 30);
  const phone = normalizePhone(phoneRaw);
  if (phoneRaw && !phone) return res.status(400).json({ error: 'Please enter a valid WhatsApp number with country code.' });

  const email = clean(b.email, 120).toLowerCase();
  if (email && !validEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  const db = getDb();
  // Same person re-submitting (same phone, or same name without phone) updates their RSVP.
  let guest = db.guests.find((g) => (phone && g.phone === phone) || (email && g.email === email) || (!phone && !email && !g.phone && !g.email && g.name.toLowerCase() === name.toLowerCase()));
  const isNew = !guest;
  if (isNew) { guest = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), reminders: {} }; db.guests.push(guest); }
  Object.assign(guest, { name, phone, email, guess, status, adults, children, note: clean(b.note, 300), updatedAt: new Date().toISOString() });
  await save();

  const link = baseUrl(req);
  const label = { yes: 'attending', no: 'not attending', maybe: 'maybe' }[status];
  // Fire-and-forget notifications; failures never block the guest.
  const summary = `New RSVP: ${name} \u2013 ${label}${guess ? ` \u2013 Team ${guess === 'boy' ? 'Boy' : 'Girl'}` : ''}${status !== 'no' ? ` (${adults} adult${adults === 1 ? '' : 's'}, ${children} child${children === 1 ? '' : 'ren'})` : ''}${guest.note ? `\nNote: ${guest.note}` : ''}`;
  const host = normalizePhone(db.event.hostPhone);
  if (host) sendWhatsApp(host, '\uD83D\uDCEC ' + summary).then((r) => !r.ok && console.warn('[host wa]', r.error));
  const hostEmail = db.event.hostEmail || process.env.GMAIL_USER;
  if (hostEmail) sendMail(hostEmail, `RSVP: ${name} \u2013 ${label}`, summary, link + '/admin').then((r) => !r.ok && console.warn('[host mail]', r.error));
  if (phone || email) notifyGuest(guest, `Your RSVP: ${db.event.title}`, render(db.event.confirmTemplate, db.event, guest, link) + (status !== 'no' ? `\n\nAdd to calendar: ${googleCalUrl(db.event)}` : ''), link, status !== 'no' ? [{ filename: 'invitation.ics', content: buildIcs(db.event), contentType: 'text/calendar' }] : undefined).then((r) => !r.ok && console.warn('[confirm]', r.error));
  res.json({ ok: true, updated: !isNew, status, adults, children });
});

app.get('/event.ics', (req, res) => {
  res.type('text/calendar').set('Content-Disposition', 'attachment; filename="invitation.ics"').send(buildIcs(getDb().event));
});
app.get('/api/calendar', (req, res) => res.json({ google: googleCalUrl(getDb().event) }));

app.use('/media', express.static(UPLOAD_DIR, { maxAge: '1h', index: false, setHeaders: (r) => r.set('Content-Disposition', 'inline') }));

/* ---------- admin: event + uploads ---------- */
app.put('/api/admin/event', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const ev = getDb().event;
  const str = { title: 120, hosts: 120, venue: 120, address: 200, mapUrl: 400, message: 1000, dressCode: 120, rsvpDeadline: 40, tz: 60, hostEmail: 120, confirmTemplate: 600, reminderTemplate: 600 };
  for (const [k, max] of Object.entries(str)) if (k in b) ev[k] = clean(k.endsWith('Template') || k === 'message' ? String(b[k]).replace(/\r/g, '') : b[k], max) || (k.endsWith('Template') ? ev[k] : '');
  if (b.startsAt && !isNaN(new Date(b.startsAt))) ev.startsAt = new Date(b.startsAt).toISOString();
  if ('hostPhone' in b) { ev.hostPhone = normalizePhone(b.hostPhone); }
  if ('durationHours' in b) ev.durationHours = Math.min(24, Math.max(1, Number(b.durationHours) || 3));
  if (Array.isArray(b.reminderDays)) ev.reminderDays = b.reminderDays.map(Number).filter((n) => n > 0 && n <= 90).slice(0, 5);
  if (ev.mapUrl && !/^https?:\/\//i.test(ev.mapUrl)) ev.mapUrl = '';
  await save();
  res.json({ ok: true, event: ev });
});

const KINDS = {
  image: { types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }, max: 10 },
  music: { types: { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav' }, max: 25 },
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
app.post('/api/admin/upload/:kind', requireAdmin, upload.single('file'), async (req, res) => {
  const kind = KINDS[req.params.kind];
  if (!kind || !req.file) return res.status(400).json({ error: 'No file' });
  const ext = kind.types[req.file.mimetype];
  if (!ext) return res.status(400).json({ error: 'Unsupported file type' });
  if (req.file.size > kind.max * 1024 * 1024) return res.status(400).json({ error: `File too large (max ${kind.max}MB)` });
  const ev = getDb().event;
  const name = `${req.params.kind}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), req.file.buffer);
  const old = ev[req.params.kind];
  ev[req.params.kind] = name;
  await save();
  if (old) fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(old))).catch(() => {});
  res.json({ ok: true, url: `/media/${name}` });
});
app.delete('/api/admin/upload/:kind', requireAdmin, async (req, res) => {
  const ev = getDb().event;
  if (!KINDS[req.params.kind]) return res.status(400).json({ error: 'Bad kind' });
  const old = ev[req.params.kind];
  ev[req.params.kind] = '';
  await save();
  if (old) fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(old))).catch(() => {});
  res.json({ ok: true });
});

/* ---------- admin: guests (host-only) ---------- */
app.get('/api/admin/event', requireAdmin, (req, res) => res.json({ ...getDb().event, imageUrl: getDb().event.image ? `/media/${getDb().event.image}` : '', musicUrl: getDb().event.music ? `/media/${getDb().event.music}` : '', link: baseUrl(req), whatsapp: isConfigured(), email: isMailConfigured() }));
app.get('/api/admin/guests', requireAdmin, (req, res) => {
  const ev = getDb().event;
  const guests = [...getDb().guests].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((g) => ({
    ...g, waLink: g.phone ? `https://wa.me/${g.phone.slice(1)}?text=${encodeURIComponent(render(ev.reminderTemplate, ev, g, baseUrl(req)))}` : '',
  }));
  res.json({ guests });
});
app.delete('/api/admin/guests/:id', requireAdmin, async (req, res) => {
  const db = getDb();
  db.guests = db.guests.filter((g) => g.id !== req.params.id);
  await save();
  res.json({ ok: true });
});
app.get('/api/admin/guests.csv', requireAdmin, (req, res) => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
  const rows = [['Name', 'Phone', 'Email', 'Status', 'Adults', 'Children', 'Guess', 'Note', 'RSVP date'], ...getDb().guests.map((g) => [g.name, g.phone, g.email, g.status, g.adults, g.children, g.guess, g.note, g.createdAt])];
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="guests.csv"').send(rows.map((r) => r.map(q).join(',')).join('\n'));
});
app.post('/api/admin/remind', requireAdmin, async (req, res) => {
  if (!channelsConfigured()) return res.status(400).json({ error: 'Neither email nor WhatsApp is configured on the server.' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  const targets = getDb().guests.filter((g) => (g.phone || g.email) && g.status !== 'no' && (!ids || ids.includes(g.id)));
  let sent = 0; const failed = [];
  for (const g of targets) {
    const r = await remindGuest(g, baseUrl(req));
    if (r.ok) sent++; else failed.push(`${g.name}: ${r.error}`);
  }
  res.json({ ok: true, sent, failed });
});
app.post('/api/admin/test-whatsapp', requireAdmin, async (req, res) => {
  const r = await sendWhatsApp(getDb().event.hostPhone, `✅ WhatsApp is connected for "${getDb().event.title}" (${fmtDate(getDb().event)}).`);
  res.status(r.ok ? 200 : 400).json(r.ok ? { ok: true } : { error: r.error });
});

/* ---------- static ---------- */
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m', extensions: ['html'] }));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => {
  console.log(`RSVP running on http://localhost:${PORT}  (admin: /admin)`);
  console.log(`WhatsApp: ${isConfigured() ? 'enabled' : 'not configured'} | Email: ${isMailConfigured() ? 'enabled' : 'not configured'}`);
  startScheduler(process.env.PUBLIC_URL || `http://localhost:${PORT}`);
});
