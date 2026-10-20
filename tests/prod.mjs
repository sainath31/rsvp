// Production-readiness checks: Redis + Blob + serverless runner + cron + sessions + security headers + prod-mode guards.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { startUpstash } from './mock-upstash.mjs';
import { startBlob } from './mock-blob.mjs';

const results = []; const ok = (n, c, d = '') => results.push([c ? 'PASS' : 'FAIL', n, c ? '' : '-> ' + d]);
const PASS = 'a-strong-host-password-2026', SECRET = 'test-session-secret', CRON = 'cron-secret-123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(file, env, args = []) {
  const p = spawn('node', [file, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.out = ''; p.on('error', () => {}); p.stdout.on('data', (d) => (p.out += d)); p.stderr.on('data', (d) => (p.out += d));
  return p;
}
async function waitReady(p, port) { for (let i = 0; i < 60; i++) { if (p.exitCode !== null) return false; try { const r = await fetch(`http://localhost:${port}/healthz`); if (r.status) return true; } catch {} await sleep(150); } return false; }
const stop = (p) => new Promise((r) => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill(); });
const call = async (base, method, url, { body, cookie, headers = {}, raw } = {}) => {
  const res = await fetch(base + url, { method, headers: { ...(body && !raw ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: raw || (body ? JSON.stringify(body) : undefined), redirect: 'manual' });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch {} return { res, status: res.status, json, text };
};

/* ===== A. serverless runner + Redis + Blob + cron ===== */
const upstash = await startUpstash(4001), blob = await startBlob(4002);
const envA = (port) => ({ VERCEL: '1', RUNNER_PORT: String(port), KV_REST_API_URL: 'http://localhost:4001', KV_REST_API_TOKEN: 'tok', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_teststore_abc123', VERCEL_BLOB_API_URL: 'http://localhost:4002', ADMIN_PASSWORD: PASS, SESSION_SECRET: SECRET, CRON_SECRET: CRON, MAIL_DRY_RUN: '1', PUBLIC_URL: 'https://example.vercel.app' });
let A = start('tests/serverless-runner.mjs', envA(4010)); const base = 'http://localhost:4010';
ok('A0 serverless runner boots (no app.listen needed)', await waitReady(A, 4010), A.out);

let r = await call(base, 'GET', '/healthz'); ok('A1 /healthz reports redis + blob + login on', r.json?.storage === 'redis' && r.json?.uploads === 'blob' && r.json?.hostLogin === true, r.text);
r = await call(base, 'GET', '/api/healthz'); ok('A1b /api/healthz alias (used by Vercel rewrite)', r.status === 200, r.text);
r = await call(base, 'GET', '/api/event'); ok('A2 event served from Redis defaults when empty', r.json?.hosts === 'Mamatha Devi & Sainath' && r.json?.title === 'A Sweet Surprise', r.text);
const rsvp = (body) => call(base, 'POST', '/api/rsvp', { body, headers: { 'X-Forwarded-For': `10.0.0.${Math.floor(Math.random() * 250)}` } });
r = await rsvp({ name: 'Asha', status: 'yes', adults: 2, children: 1, guess: 'girl', email: 'asha@example.com' }); ok('A3 RSVP saved', r.status === 200 && r.json?.ok, r.text);
ok('A3b RSVP is stored in Redis (not on disk)', upstash.hashes.get('rsvp:guests')?.size === 1 && [...upstash.hashes.get('rsvp:guests').values()][0].includes('asha@example.com'));
ok('A3c serverless waited for the emails (dry-run lines present)', /\[mail dry-run\] to=asha@example.com subject=Your RSVP/.test(A.out), A.out.slice(-300));
r = await call(base, 'GET', '/api/admin/guests'); ok('A4 guest list is private without login (401)', r.status === 401);

r = await call(base, 'POST', '/api/admin/login', { body: { password: 'wrong' } }); ok('A5 wrong password rejected', r.status === 401, r.text);
r = await call(base, 'POST', '/api/admin/login', { body: { password: PASS } }); const good = r.res.headers.get('set-cookie')?.split(';')[0] || ''; const sc = r.res.headers.get('set-cookie') || '';
ok('A5b right password signs in with an HttpOnly SameSite=Strict cookie', r.status === 200 && /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc), sc);
r = await call(base, 'GET', '/api/admin/guests', { cookie: good }); ok('A6 host sees the guest list', r.status === 200 && r.json?.guests?.length === 1 && r.json.guests[0].guess === 'girl', r.text);
const [exp, sig] = good.split('=')[1].split('.');
r = await call(base, 'GET', '/api/admin/guests', { cookie: `sid=${exp}.${sig.slice(0, -2)}xx` }); ok('A7 tampered cookie rejected', r.status === 401);
r = await call(base, 'GET', '/api/admin/guests', { cookie: `sid=${Number(exp) + 99999999999}.${sig}` }); ok('A7b cookie with a changed expiry rejected', r.status === 401);
r = await call(base, 'GET', '/api/admin/guests', { cookie: `sid=1000.${sig}` }); ok('A7c expired cookie rejected', r.status === 401);

r = await call(base, 'PUT', '/api/admin/event', { cookie: good, body: { title: 'Baby Reveal Party', hostEmail: 'host@example.com' } }); ok('A8 host can edit event', r.status === 200 && r.json?.event?.title === 'Baby Reveal Party', r.text);
ok('A8b edit stored in Redis', JSON.parse(upstash.kv.get('rsvp:event')).title === 'Baby Reveal Party');
r = await call(base, 'GET', '/api/event'); ok('A8c public event shows the edit', r.json?.title === 'Baby Reveal Party');
r = await call(base, 'GET', '/event.ics'); ok('A9 calendar file reflects the edit', /SUMMARY:Baby Reveal Party/.test(r.text) && /^text\/calendar/.test(r.res.headers.get('content-type')) && /^inline/.test(r.res.headers.get('content-disposition')), r.res.headers.get('content-type'));
r = await call(base, 'GET', '/api/event.ics'); ok('A9b /api/event.ics alias (Vercel rewrite target)', r.status === 200 && r.text.startsWith('BEGIN:VCALENDAR'));

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const form = (buf, type, name) => { const f = new FormData(); f.append('file', new Blob([buf], { type }), name); return f; };
let up = await fetch(base + '/api/admin/upload/image', { method: 'POST', headers: { Cookie: good }, body: form(png, 'image/png', 'a.png') }); let uj = await up.json();
ok('A10 image upload goes to Blob and returns its public URL', up.status === 200 && /^http:\/\/localhost:4002\/files\/rsvp\/image-/.test(uj.url) && blob.files.size === 1, JSON.stringify(uj));
r = await call(base, 'GET', '/api/event'); ok('A10b public event uses the Blob URL', /^http:\/\/localhost:4002\/files\/rsvp\/image-/.test(r.json?.image), r.text.slice(0, 200));
up = await fetch(base + '/api/admin/upload/image', { method: 'POST', headers: { Cookie: good }, body: form(Buffer.alloc(5 * 1024 * 1024, 1), 'image/png', 'big.png') }); uj = await up.json();
ok('A10c uploads over the 4 MB Vercel limit are refused with a clear message', up.status === 400 && /max 4MB/.test(uj.error), JSON.stringify(uj));
up = await fetch(base + '/api/admin/upload/image', { method: 'POST', headers: { Cookie: good }, body: form(Buffer.from('x'), 'application/x-msdownload', 'a.exe') }); ok('A10d wrong file type refused', up.status === 400);
up = await fetch(base + '/api/admin/upload/image', { method: 'POST', body: form(png, 'image/png', 'a.png') }); ok('A10e upload without login refused', up.status === 401);
const before = blob.files.size;
r = await call(base, 'DELETE', '/api/admin/upload/image', { cookie: good }); ok('A10f removing the upload deletes it from Blob', r.status === 200 && blob.files.size === before - 1 && blob.log.some((l) => l[0] === 'del'), JSON.stringify(blob.log.slice(-2)));

for (const g of [{ name: 'Ben', status: 'yes', adults: 1, email: 'ben@example.com' }, { name: 'Cara', status: 'maybe', adults: 1, email: 'cara@example.com' }, { name: 'Dev', status: 'no' }, { name: 'Eli', status: 'no', email: 'eli@example.com' }]) await rsvp(g);
r = await call(base, 'GET', '/api/admin/guests', { cookie: good }); ok('A11 five guests stored', r.json?.guests?.length === 5, String(r.json?.guests?.length));
await rsvp({ name: 'Asha K', status: 'yes', adults: 3, email: 'ASHA@example.com' }); r = await call(base, 'GET', '/api/admin/guests', { cookie: good }); ok('A11b resubmitting with the same email updates (no duplicate)', r.json?.guests?.length === 5 && r.json.guests.find((g) => g.email === 'asha@example.com')?.adults === 3);
const eli = r.json.guests.find((g) => g.name === 'Eli');
r = await call(base, 'DELETE', `/api/admin/guests/${eli.id}`, { cookie: good }); ok('A11c host can remove a guest', r.status === 200); r = await call(base, 'GET', '/api/admin/guests', { cookie: good }); ok('A11d removed from Redis', r.json?.guests?.length === 4 && upstash.hashes.get('rsvp:guests').size === 4);
r = await call(base, 'GET', '/api/admin/guests.csv', { cookie: good }); ok('A11e CSV export works', r.status === 200 && r.text.split('\n').length === 5 && !/Phone/.test(r.text), r.text.slice(0, 120));

await stop(A); A = start('tests/serverless-runner.mjs', envA(4010)); await waitReady(A, 4010);
r = await call(base, 'GET', '/api/admin/guests', { cookie: good }); ok('A12 data and host session survive a cold start / new instance', r.status === 200 && r.json?.guests?.length === 4, r.text.slice(0, 100));

r = await call(base, 'GET', '/api/cron/reminders'); ok('A13 cron without secret is refused', r.status === 401, r.text);
r = await call(base, 'GET', '/api/cron/reminders', { headers: { Authorization: 'Bearer nope' } }); ok('A13b cron with the wrong secret refused', r.status === 401);
r = await call(base, 'GET', '/api/cron/reminders', { headers: { Authorization: `Bearer ${CRON}` } }); ok('A13c cron before any reminder is due sends nothing', r.status === 200 && r.json?.sent === 0 && /no reminder due/.test(r.json?.note || ''), r.text);
await call(base, 'PUT', '/api/admin/event', { cookie: good, body: { startsAt: new Date(Date.now() + 20 * 3600e3).toISOString() } });
const mark = A.out.length;
r = await call(base, 'GET', '/api/cron/reminders', { headers: { Authorization: `Bearer ${CRON}` } }); ok('A14 inside the 1-day window: reminders sent to the 3 guests who said yes/maybe with an email', r.json?.sent === 3 && r.json?.failed === 0, r.text);
const lines = (A.out.slice(mark).match(/\[mail dry-run\] to=\S+ subject=Reminder:/g) || []); ok('A14b exactly those 3 emails went out', lines.length === 3, JSON.stringify(lines));
r = await call(base, 'GET', '/api/cron/reminders', { headers: { Authorization: `Bearer ${CRON}` } }); ok('A14c running the job again sends nothing (no duplicates)', r.json?.sent === 0, r.text);
ok('A14d reminder history stored in Redis', [...upstash.hashes.get('rsvp:guests').values()].filter((v) => JSON.parse(v).reminders?.['1']).length === 3);
await call(base, 'PUT', '/api/admin/event', { cookie: good, body: { startsAt: new Date(Date.now() - 3600e3).toISOString() } });
r = await call(base, 'GET', '/api/cron/reminders', { headers: { Authorization: `Bearer ${CRON}` } }); ok('A14e after the party starts nothing is sent', r.json?.sent === 0 && /already started/.test(r.json?.note || ''), r.text);

r = await call(base, 'GET', '/api/event'); const h = r.res.headers;
ok('A15 security headers on API responses', /default-src 'self'/.test(h.get('content-security-policy') || '') && h.get('x-frame-options') === 'DENY' && h.get('x-content-type-options') === 'nosniff' && /no-store/.test(h.get('cache-control') || ''), JSON.stringify([...h.entries()].slice(0, 8)));
ok('A15b no HSTS over plain http', !h.get('strict-transport-security'));
r = await call(base, 'GET', '/api/event', { headers: { 'X-Forwarded-Proto': 'https' } }); ok('A15c HSTS when served over https', /max-age=\d+/.test(r.res.headers.get('strict-transport-security') || ''));
r = await call(base, 'POST', '/api/admin/login', { body: { password: PASS }, headers: { 'X-Forwarded-Proto': 'https' } }); ok('A15d session cookie is Secure over https', /; Secure/.test(r.res.headers.get('set-cookie') || ''));
r = await call(base, 'GET', '/api/nope'); ok('A16 unknown API route is a clean 404 JSON', r.status === 404 && r.json?.error === 'Not found');
r = await call(base, 'GET', '/api/admin/event', { cookie: good }); ok('A17 admin sees upload availability + size caps', r.json?.uploads === true && r.json?.maxUploadMB?.music === 4, JSON.stringify([r.json?.uploads, r.json?.maxUploadMB]));

await stop(A); A = start('tests/serverless-runner.mjs', { ...envA(4010), ADMIN_PASSWORD: PASS + '-changed' }); await waitReady(A, 4010);
r = await call(base, 'GET', '/api/admin/guests', { cookie: good }); ok('A18 changing ADMIN_PASSWORD signs out every existing session', r.status === 401);
r = await call(base, 'POST', '/api/admin/login', { body: { password: PASS } }); ok('A18b old password no longer works', r.status === 401);
r = await call(base, 'POST', '/api/admin/login', { body: { password: PASS + '-changed' } }); ok('A18c new password works', r.status === 200);
await stop(A);

A = start('tests/serverless-runner.mjs', { VERCEL: '1', RUNNER_PORT: '4011', ADMIN_PASSWORD: PASS, SESSION_SECRET: SECRET, MAIL_DRY_RUN: '1', DATA_DIR: '/tmp/claude-0/ephemeral-a' }); await waitReady(A, 4011);
const bB = 'http://localhost:4011'; r = await call(bB, 'POST', '/api/admin/login', { body: { password: PASS } }); const cB = r.res.headers.get('set-cookie')?.split(';')[0];
up = await fetch(bB + '/api/admin/upload/image', { method: 'POST', headers: { Cookie: cB }, body: form(png, 'image/png', 'a.png') }); uj = await up.json(); ok('B1 serverless without Blob: uploads switched off with a clear message (501)', up.status === 501 && /not available/.test(uj.error), JSON.stringify(uj));
r = await call(bB, 'GET', '/healthz'); ok('B1b healthz says uploads: none', r.json?.uploads === 'none', r.text);
r = await call(bB, 'GET', '/api/admin/event', { cookie: cB }); ok('B1c dashboard is told uploads are off', r.json?.uploads === false);
await stop(A);
A = start('tests/serverless-runner.mjs', { VERCEL: '1', RUNNER_PORT: '4012', ADMIN_PASSWORD: 'short', DATA_DIR: '/tmp/claude-0/ephemeral-b' }); await waitReady(A, 4012);
r = await call('http://localhost:4012', 'POST', '/api/admin/login', { body: { password: 'short' } }); ok('B2 weak password in production: login stays disabled (503) even with the right text', r.status === 503, r.text); await stop(A);

const nodeProd = (env) => start('server.js', { NODE_ENV: 'production', PORT: '4020', DATA_DIR: '/tmp/claude-0/prod-c', ...env });
let C = nodeProd({}); await sleep(1200); ok('C1 production refuses to start without ADMIN_PASSWORD', C.exitCode === 1, C.out);
C = nodeProd({ ADMIN_PASSWORD: 'short' }); await sleep(1200); ok('C2 production refuses to start with a weak password', C.exitCode === 1 && /at least 10/.test(C.out), C.out);
C = nodeProd({ ADMIN_PASSWORD: PASS, SESSION_SECRET: SECRET }); ok('C3 production starts with a strong password', await waitReady(C, 4020), C.out);
r = await call('http://localhost:4020', 'GET', '/'); ok('C4 home page served with link-preview address filled in', /og:image" content="http:\/\/localhost:4020\/og\.jpg"/.test(r.text) && !r.text.includes('__SITE_URL__'), r.text.match(/og:image[^>]*/)?.[0]);
ok('C4b home page is not indexable', /noindex/.test(r.text));
r = await call('http://localhost:4020', 'GET', '/robots.txt'); ok('C4c robots.txt disallows crawlers', /Disallow: \//.test(r.text));
r = await call('http://localhost:4020', 'GET', '/og.jpg'); ok('C4d link-preview image exists', r.status === 200 && /image\/jpeg/.test(r.res.headers.get('content-type')));
await stop(C);

const vj = JSON.parse(fs.readFileSync('vercel.json', 'utf8')); const { CSP } = await import('../lib/security.js');
ok('D1 vercel.json CSP matches the server CSP', vj.headers[0].headers.find((x) => x.key === 'Content-Security-Policy')?.value === CSP);
ok('D2 vercel.json cron path matches the route', vj.crons[0].path === '/api/cron/reminders');
ok('D3 vercel.json is valid and serves public/ with admin/event/healthz rewrites', vj.outputDirectory === 'public' && ['/admin', '/event.ics', '/healthz'].every((s) => vj.rewrites.some((x) => x.source === s)));
ok('D4 Vercel entry file exists and re-exports the app', /export default app/.test(fs.readFileSync('api/[...path].js', 'utf8')));
const pj = JSON.parse(fs.readFileSync('package.json', 'utf8')); ok('D5 package.json pins Node 22 and has no WhatsApp leftovers', pj.engines.node === '22.x' && !/whatsapp/i.test(JSON.stringify(pj)));
fs.copyFileSync('public/index.html', '/tmp/claude-0/index.backup.html');
await new Promise((res) => { const p = spawn('node', ['scripts/prepare.mjs'], { env: { ...process.env, CI: '', VERCEL: '', SITE_URL: '', PUBLIC_URL: '' } }); p.on('exit', res); });
ok('D6 prepare script leaves the page alone outside CI/Vercel', fs.readFileSync('public/index.html', 'utf8').includes('__SITE_URL__'));
await new Promise((res) => { const p = spawn('node', ['scripts/prepare.mjs'], { env: { ...process.env, SITE_URL: 'https://rsvp.example.com/' } }); p.on('exit', res); });
const prepared = fs.readFileSync('public/index.html', 'utf8'); ok('D7 prepare script writes the real address into the preview tags', prepared.includes('content="https://rsvp.example.com/og.jpg"') && !prepared.includes('__SITE_URL__'));
fs.copyFileSync('/tmp/claude-0/index.backup.html', 'public/index.html');

upstash.close(); blob.close();
const f = results.filter((x) => x[0] === 'FAIL'); for (const x of results) if (x[0] === 'FAIL' || process.argv.includes('-v')) console.log(x.join(' ')); console.log(`\n${results.length - f.length}/${results.length} passed`); process.exit(f.length ? 1 : 0);
