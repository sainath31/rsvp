import { getEvent, listGuests, putGuest } from './store.js';
import { notifyGuest, channelsConfigured } from './notify.js';
import { render, parkingLine } from './messages.js';

export async function remindGuest(guest, link, event) {
  const ev = event || (await getEvent());
  return notifyGuest(guest, `Reminder: ${ev.title}`, render(ev.reminderTemplate, ev, guest, link) + parkingLine(ev), link);
}

// Sends each scheduled reminder (e.g. 7 days and 1 day before) once per guest.
// Safe to call as often as you like: a guest is never sent the same slot twice.
export async function runReminders(link) {
  const result = { sent: 0, failed: 0, skipped: 0 };
  if (!channelsConfigured()) return { ...result, note: 'email not configured' };
  const event = await getEvent();
  const start = new Date(event.startsAt).getTime();
  const now = Date.now();
  if (now >= start) return { ...result, note: 'event already started' };
  const due = [...(event.reminderDays || [])].map(Number).filter((d) => now >= start - d * 864e5);
  if (!due.length) return { ...result, note: 'no reminder due yet' };
  // Only the most recent due slot fires, so a late-added guest isn't spammed with older ones.
  const slot = String(Math.min(...due));
  for (const g of await listGuests()) {
    if (!g.email || g.status === 'no') { result.skipped++; continue; }
    g.reminders ||= {};
    if (Object.keys(g.reminders).some((k) => Number(k) <= Number(slot))) { result.skipped++; continue; }
    const r = await remindGuest(g, link, event);
    if (r.ok) { g.reminders[slot] = new Date().toISOString(); await putGuest(g); result.sent++; }
    else { result.failed++; console.warn(`[reminder] ${g.name}: ${r.error}`); }
  }
  return result;
}

// Long-running hosts only (Render, Fly, a VPS...). On Vercel a daily Cron job calls /api/cron/reminders instead.
export function startScheduler(link) {
  const tick = () => runReminders(link).catch((e) => console.error('[reminder]', e));
  setTimeout(tick, 10_000);
  setInterval(tick, 15 * 60_000);
}
