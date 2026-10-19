// Email via Gmail SMTP. Needs a Google "App password" (Account > Security > 2-Step Verification > App passwords).
import nodemailer from 'nodemailer';

let transport;
export const isMailConfigured = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
export const validEmail = (e) => /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function sendMail(to, subject, text, link, attachments) {
  if (!isMailConfigured()) return { ok: false, error: 'email not configured' };
  if (!validEmail(to || '')) return { ok: false, error: 'invalid email' };
  transport ||= nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, '') },
  });
  const html = `<div style="font-family:Georgia,serif;max-width:480px;margin:auto;padding:28px;background:#0d1020;color:#f4f1ea;border-radius:16px">
<p style="white-space:pre-line;font-size:16px;line-height:1.6;margin:0 0 20px">${esc(text)}</p>
${link ? `<a href="${esc(link)}" style="display:inline-block;background:#d9b573;color:#2a2008;padding:12px 24px;border-radius:99px;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold">View invitation</a>` : ''}</div>`;
  try {
    const info = await transport.sendMail({
      from: `"${process.env.MAIL_FROM_NAME || 'Invitation'}" <${process.env.GMAIL_USER}>`,
      to, subject, text, html, attachments,
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
