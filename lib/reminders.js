import { getDb, save } from './store.js';
import { sendWhatsApp, isConfigured } from './whatsapp.js';
import { render } from './messages.js';

export async function remindGuest(guest, link) {
  const { event } = getDb();
  return sendWhatsApp(guest.phone, render(event.reminderTemplate, event, guest, link));
}

// Sends each scheduled reminder (e.g. 7 days and 1 day before) once per guest.
export async function runReminders(link) {
  if (!isConfigured()) return;
  const { event, guests } = getDb();
  const start = new Date(event.startsAt).getTime();
  const now = Date.now();
  if (now >= start) return;
  const due = [...(event.reminderDays || [])].map(Number).filter((d) => now >= start - d * 864e5);
  if (!due.length) return;
  // Only the most recent due slot fires, so a late-added guest isn't spammed with older ones.
  const slot = String(Math.min(...due));
  let changed = false;
  for (const g of guests) {
    if (!g.phone || g.status === 'no') continue;
    g.reminders ||= {};
    if (Object.keys(g.reminders).some((k) => Number(k) <= Number(slot))) continue;
    const r = await remindGuest(g, link);
    if (r.ok) { g.reminders[slot] = new Date().toISOString(); changed = true; }
    else console.warn(`[reminder] ${g.name}: ${r.error}`);
  }
  if (changed) await save();
}

export function startScheduler(link) {
  const tick = () => runReminders(link).catch((e) => console.error('[reminder]', e));
  setTimeout(tick, 10_000);
  setInterval(tick, 15 * 60_000);
}
