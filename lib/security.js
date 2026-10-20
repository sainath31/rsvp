import crypto from 'node:crypto';

// Everything is served from our own origin; Blob/Redis are only reached from the server.
export const CSP = "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

export function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

/* ---- host sessions: signed, stateless cookies (work across serverless instances) ---- */
const MAX_AGE_S = 14 * 86400;
export const timingSafeEqualStr = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
// The signing key depends on the password, so changing ADMIN_PASSWORD signs every host out.
const key = () => crypto.createHash('sha256').update(`${process.env.SESSION_SECRET || ''}|${process.env.ADMIN_PASSWORD || ''}|rsvp-session-v1`).digest();
const sign = (payload) => crypto.createHmac('sha256', key()).update(payload).digest('base64url');

export const issueSession = () => { const exp = String(Date.now() + MAX_AGE_S * 1000); return `${exp}.${sign(exp)}`; };
export function verifySession(token) {
  if (!token || !process.env.ADMIN_PASSWORD) return false;
  const [exp, sig] = String(token).split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const want = sign(exp);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
export const sessionCookie = (token, secure) => `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_S}${secure ? '; Secure' : ''}`;
export const clearCookie = (secure) => `sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
export const readCookie = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }).find(([k]) => k === name)?.[1];
