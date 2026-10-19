import { sendMail, isMailConfigured } from './mail.js';
import { sendWhatsApp, isConfigured as isWaConfigured } from './whatsapp.js';

export const channelsConfigured = () => isMailConfigured() || isWaConfigured();

// Sends to every channel the guest provided; succeeds if at least one goes through.
export async function notifyGuest(guest, subject, text, link, attachments) {
  const jobs = [];
  if (guest.email) jobs.push(sendMail(guest.email, subject, text, link, attachments));
  if (guest.phone) jobs.push(sendWhatsApp(guest.phone, text));
  if (!jobs.length) return { ok: false, error: 'no contact details' };
  const rs = await Promise.all(jobs);
  return rs.some((r) => r.ok) ? { ok: true } : { ok: false, error: rs.map((r) => r.error).join('; ') };
}
