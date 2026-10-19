import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const defaults = () => ({
  event: {
    title: 'Little Krishna or Little Radha?',
    hosts: 'Mamatha Devi & Sainath',
    startsAt: '2026-10-31T20:00:00.000Z', // Oct 31, 2026 4:00 PM Eastern (edit in dashboard)
    tz: 'America/New_York',
    durationHours: 3,
    venue: 'Our Home',
    address: '35982 Ellsworth PL, Zephyrhills, FL 33541',
    mapUrl: '',
    message: 'Join us as we find out whether baby is a little prince or a little princess! Cast your guess, enjoy great food and be there for the big reveal.',
    dressCode: 'Wear pink or blue to show your team',
    rsvpDeadline: '',
    image: '',
    video: '',
    music: '',
    hostPhone: '',
    reminderDays: [7, 1],
    confirmTemplate:
      'Hi {name}! Thanks for your RSVP to {event} ({status}). {date} at {venue}. Details: {link}',
    reminderTemplate:
      'Hi {name}, a friendly reminder: {event} is {when}! {date} at {venue}. See you there 🎉 {link}',
  },
  guests: [],
});

let db;
try {
  const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const d = defaults();
  db = { event: { ...d.event, ...loaded.event }, guests: loaded.guests || [] };
} catch {
  db = defaults();
}

let writing = Promise.resolve();
export function save() {
  const tmp = DB_FILE + '.tmp';
  writing = writing.then(async () => {
    await fs.promises.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.promises.rename(tmp, DB_FILE);
  });
  return writing;
}

export const getDb = () => db;
