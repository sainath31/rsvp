// WhatsApp delivery via Twilio's WhatsApp API (no SDK needed).
// Without credentials the app still works: the admin dashboard offers click-to-chat links.
const sid = () => process.env.TWILIO_ACCOUNT_SID;
const token = () => process.env.TWILIO_AUTH_TOKEN;
const from = () => process.env.TWILIO_WHATSAPP_FROM; // e.g. +14155238886

export const isConfigured = () => !!(sid() && token() && from());

export function normalizePhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (!d.startsWith('+')) {
    const cc = process.env.DEFAULT_COUNTRY_CODE || '';
    d = cc ? '+' + cc.replace(/\D/g, '') + d.replace(/^0+/, '') : '+' + d;
  }
  const digits = d.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? '+' + digits : '';
}

export async function sendWhatsApp(to, body) {
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: 'invalid phone' };
  if (!isConfigured()) return { ok: false, error: 'whatsapp not configured' };
  const params = new URLSearchParams({
    From: 'whatsapp:' + normalizePhone(from()),
    To: 'whatsapp:' + phone,
  });
  if (process.env.TWILIO_CONTENT_SID) {
    // Approved template: variable 1 carries the full message text.
    params.set('ContentSid', process.env.TWILIO_CONTENT_SID);
    params.set('ContentVariables', JSON.stringify({ 1: body }));
  } else {
    params.set('Body', body);
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid()}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid()}:${token()}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.message || `HTTP ${res.status}` };
    return { ok: true, id: json.sid };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
