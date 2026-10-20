import { sendMail, isMailConfigured } from './mail.js';

export const channelsConfigured = () => isMailConfigured();

// Confirmations and reminders go out by email.
export async function notifyGuest(guest, subject, text, link, attachments) {
  if (!guest.email) return { ok: false, error: 'no email address' };
  return sendMail(guest.email, subject, text, link, attachments);
}
