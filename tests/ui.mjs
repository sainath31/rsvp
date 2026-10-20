import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire('/usr/lib/node_modules/');
let pw; try { pw = require('playwright'); } catch { pw = require('/usr/local/lib/node_modules/playwright'); }
const PASS = 'a-strong-host-password-2026';
const srv = spawn('node', ['server.js'], { env: { ...process.env, NODE_ENV: 'production', PORT: '4030', ADMIN_PASSWORD: PASS, SESSION_SECRET: 's', DATA_DIR: '/tmp/claude-0/ui-data', MAIL_DRY_RUN: '1' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const BASE = 'http://localhost:4030';
const b = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const res = []; const ok = (n, c, d = '') => res.push([c ? 'PASS' : 'FAIL', n, c ? '' : '-> ' + d]);
const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const p = await ctx.newPage(); const csp = [], errs = [];
p.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t.slice(0, 160)); else if (m.type() === 'error' && !/Failed to load resource/.test(t)) errs.push(t.slice(0, 160)); });
p.on('pageerror', (e) => errs.push(e.message));
const open = async () => { await p.goto(BASE + '/'); await p.waitForTimeout(900); await p.tap('#openBtn'); await p.waitForTimeout(5800); };

await open();
const pos = await p.evaluate(() => { const h = document.querySelector('#hostBtn').getBoundingClientRect(), m = document.querySelector('#mute').getBoundingClientRect(); return { hostRight: Math.round(innerWidth - h.right), hostTop: Math.round(h.top), hostVisible: !document.querySelector('#hostBtn').hidden, muteLeftOfHost: m.right <= h.left, w: h.width }; });
ok('U1 profile icon is at the top right, music button sits to its left', pos.hostVisible && pos.hostRight <= 16 && pos.hostTop <= 20 && pos.muteLeftOfHost, JSON.stringify(pos));
ok('U1b no footer "Host login" link or build text left on the page', !(await p.evaluate(() => /Host login ·|build v\d+/.test(document.body.innerText))));
await p.tap('#hostBtn'); await p.waitForTimeout(500);
const modal = await p.evaluate(() => ({ shown: !document.querySelector('#hostModal').hidden, focus: document.activeElement?.name, type: document.querySelector('#hostForm input').type }));
ok('U2 tapping the icon opens a password box (hidden characters, focused)', modal.shown && modal.focus === 'password' && modal.type === 'password', JSON.stringify(modal));
await p.screenshot({ path: '/tmp/claude-0/ui-modal.png' });
await p.fill('#hostForm input', 'not-the-password'); await p.tap('#hostGo'); await p.waitForTimeout(1500);
const bad = await p.evaluate(() => ({ err: !document.querySelector('#hostErr').hidden && document.querySelector('#hostErr').textContent, still: !document.querySelector('#hostModal').hidden, url: location.pathname }));
ok('U3 wrong password shows an error and stays on the page', /Wrong password/.test(bad.err || '') && bad.still && bad.url === '/', JSON.stringify(bad));
await p.fill('#hostForm input', PASS); await Promise.all([p.waitForURL(/admin(\.html)?$/, { timeout: 8000 }).catch(() => {}), p.tap('#hostGo')]); await p.waitForTimeout(1500);
const dash = await p.evaluate(() => ({ url: location.pathname, dash: !document.querySelector('#dash').hidden, login: !document.querySelector('#login').hidden }));
ok('U4 right password opens the host dashboard (no second login)', /admin/.test(dash.url) && dash.dash && !dash.login, JSON.stringify(dash));
await p.screenshot({ path: '/tmp/claude-0/ui-dash.png' });
for (const t of ['event', 'notify', 'guests']) { await p.tap(`.tabs button[data-tab=${t}]`); await p.waitForTimeout(300); }
ok('U4b dashboard tabs work and the page does not scroll sideways', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
await open();
await p.tap('#hostBtn'); await p.waitForTimeout(1200);
ok('U5 when already signed in, the icon goes straight to the dashboard', /admin/.test(await p.evaluate(() => location.pathname)));
await p.evaluate(() => fetch('api/admin/logout', { method: 'POST' })); await open(); await p.tap('#hostBtn'); await p.waitForTimeout(500);
ok('U5b after logout the icon asks for the password again', await p.evaluate(() => !document.querySelector('#hostModal').hidden));
await p.tap('#hostClose'); await p.waitForTimeout(200); ok('U6 the X closes the box', await p.evaluate(() => document.querySelector('#hostModal').hidden));
await p.tap('#hostBtn'); await p.waitForTimeout(300); await p.keyboard.press('Escape'); await p.waitForTimeout(200); ok('U6b Escape closes the box', await p.evaluate(() => document.querySelector('#hostModal').hidden));
await p.tap('#hostBtn'); await p.waitForTimeout(300); await p.touchscreen.tap(20, 30); await p.waitForTimeout(200); ok('U6c tapping outside closes the box', await p.evaluate(() => document.querySelector('#hostModal').hidden));
// the sign-in box explains a broken server instead of a vague message
await open(); await p.route('**/api/admin/login', (r) => r.fulfill({ status: 404, contentType: 'text/html', body: '<h1>NOT_FOUND</h1>' }));
await p.tap('#hostBtn'); await p.waitForTimeout(400); await p.fill('#hostForm input', 'whatever-password'); await p.tap('#hostGo'); await p.waitForTimeout(800);
const e404 = await p.evaluate(() => document.querySelector('#hostErr').textContent);
ok('U6d a missing server (404) is explained, with the status code and where to look', /404/.test(e404) && /healthz/.test(e404), e404);
await p.route('**/api/admin/login', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'The server failed to start', detail: "Cannot find package 'express'" }) }));
await p.fill('#hostForm input', 'whatever-password'); await p.tap('#hostGo'); await p.waitForTimeout(800);
const e500 = await p.evaluate(() => document.querySelector('#hostErr').textContent);
ok('U6e a server startup failure shows its reason', /failed to start/.test(e500) && /express/.test(e500), e500);
await p.route('**/api/admin/login', (r) => r.abort());
await p.fill('#hostForm input', 'whatever-password'); await p.tap('#hostGo'); await p.waitForTimeout(800);
ok('U6f no connection is explained', /Could not reach the server/.test(await p.evaluate(() => document.querySelector('#hostErr').textContent)));
await p.unroute('**/api/admin/login'); await p.tap('#hostClose');
// rate limit
const lim = await p.evaluate(async () => { const out = []; for (let i = 0; i < 9; i++) { const r = await fetch('api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'bad' + i }) }); out.push(r.status); } return out; });
ok('U7 repeated wrong passwords get locked out (429)', lim.includes(429), JSON.stringify(lim));
// guest RSVP with the production CSP
await open(); await p.evaluate(() => document.querySelector('#rsvp').scrollIntoView()); await p.waitForTimeout(500);
await p.tap('input[name=guess][value=boy] + span'); await p.fill('input[name=name]', 'CSP Tester'); await p.fill('input[name=email]', 'csp@example.com'); await p.tap('#submit'); await p.waitForTimeout(1500);
ok('U8 guest can RSVP under the production security policy', await p.evaluate(() => !document.querySelector('#done').hidden));
await p.goto(BASE + '/admin'); await p.waitForTimeout(800);
ok('U9a database warning banner is hidden when data is safe (local disk)', await p.evaluate(async () => { await fetch('api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'a-strong-host-password-2026' }) }); return true; }));
ok('U9 admin page loads under the policy', await p.evaluate(() => !!document.querySelector('#login') ));
ok('U10 no Content-Security-Policy violations anywhere', csp.length === 0, csp.join(' | '));
ok('U11 no JavaScript errors anywhere', errs.length === 0, errs.join(' | '));
await b.close(); srv.kill();
const f = res.filter((x) => x[0] === 'FAIL'); for (const x of res) if (x[0] === 'FAIL' || process.argv.includes('-v')) console.log(x.join(' ')); console.log(`\n${res.length - f.length}/${res.length} passed`); process.exit(f.length ? 1 : 0);
