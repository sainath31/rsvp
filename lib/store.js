// Storage for the event settings and the guest list.
//  - file  : db.json on disk (local use, or a host with a persistent disk: Render, Railway, Fly, a VPS)
//  - redis : Upstash Redis over its REST API (Vercel / serverless, where the disk does not persist)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
export const storageKind = REDIS_URL && REDIS_TOKEN ? 'redis' : 'file';
export const onServerless = !!process.env.VERCEL;

export const DATA_DIR = process.env.DATA_DIR || (onServerless ? '/tmp/rsvp-data' : path.join(root, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const defaultEvent = () => ({
  title: 'A Sweet Surprise',
  hosts: 'Mamatha Devi & Sainath',
  startsAt: '2026-10-31T20:00:00.000Z', // Oct 31, 2026 4:00 PM Eastern (edit in the dashboard)
  tz: 'America/New_York',
  durationHours: 3,
  venue: 'Our Home',
  address: '35982 Ellsworth PL, Zephyrhills, FL 33541',
  mapUrl: '',
  message: 'Join us as we find out whether baby is a little prince or a little princess! Cast your guess, enjoy great food and be there for the big reveal.',
  dressCode: '',
  rsvpDeadline: '',
  image: '',
  video: '',
  music: '',
  hostEmail: '',
  reminderDays: [7, 1],
  confirmTemplate: 'Hi {name}! Thanks for your RSVP to {event} ({status}). {date} at {venue}. Details: {link}',
  reminderTemplate: 'Hi {name}, a friendly reminder: {event} is {when}! {date} at {venue}. See you there 🎉 {link}',
});
const withDefaults = (ev) => ({ ...defaultEvent(), ...(ev || {}) });

/* ---------------- file backend ---------------- */
let db;
function loadFile() {
  if (db) return db;
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* read-only disk: uploads are disabled elsewhere */ }
  try {
    const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db = { event: withDefaults(loaded.event), guests: loaded.guests || [] };
  } catch {
    db = { event: defaultEvent(), guests: [] };
  }
  return db;
}
let writing = Promise.resolve();
function writeFile() {
  const tmp = DB_FILE + '.tmp';
  writing = writing.then(async () => {
    await fs.promises.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.promises.rename(tmp, DB_FILE);
  }).catch((e) => console.error('[store] could not write db.json:', e.message));
  return writing;
}

/* ---------------- redis backend (Upstash REST) ---------------- */
async function redis(...cmd) {
  const res = await fetch(REDIS_URL, { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(`redis ${cmd[0]} failed: ${j.error || res.status}`);
  return j.result;
}
const EVENT_KEY = 'rsvp:event', GUESTS_KEY = 'rsvp:guests';

/* ---------------- public API (async) ---------------- */
// The event settings are read on almost every request but change rarely, so each server instance keeps them for a
// few seconds. That keeps Redis usage (and any free-plan quota) tiny. Edits clear the cache straight away.
let eventCache = null;
const EVENT_TTL_MS = 15_000;
export async function getEvent({ fresh = false } = {}) {
  if (storageKind === 'redis') {
    if (!fresh && eventCache && Date.now() - eventCache.at < EVENT_TTL_MS) return structuredClone(eventCache.value);
    const raw = await redis('GET', EVENT_KEY);
    const value = withDefaults(raw ? JSON.parse(raw) : null);
    eventCache = { at: Date.now(), value };
    return structuredClone(value);
  }
  return structuredClone(loadFile().event);
}
export async function saveEvent(ev) {
  if (storageKind === 'redis') { await redis('SET', EVENT_KEY, JSON.stringify(ev)); eventCache = null; return; }
  loadFile().event = withDefaults(ev); await writeFile();
}
export async function listGuests() {
  if (storageKind === 'redis') {
    const flat = (await redis('HGETALL', GUESTS_KEY)) || [];
    const out = [];
    for (let i = 1; i < flat.length; i += 2) { try { out.push(JSON.parse(flat[i])); } catch { /* skip a corrupt row */ } }
    return out;
  }
  return structuredClone(loadFile().guests);
}
export async function putGuest(g) {
  if (storageKind === 'redis') { await redis('HSET', GUESTS_KEY, g.id, JSON.stringify(g)); return; }
  const d = loadFile(); const i = d.guests.findIndex((x) => x.id === g.id);
  if (i >= 0) d.guests[i] = structuredClone(g); else d.guests.push(structuredClone(g));
  await writeFile();
}
export async function removeGuest(id) {
  if (storageKind === 'redis') { await redis('HDEL', GUESTS_KEY, id); return; }
  const d = loadFile(); d.guests = d.guests.filter((g) => g.id !== id); await writeFile();
}
