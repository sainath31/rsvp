import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire('/usr/lib/node_modules/');
let pw; try { pw = require('playwright'); } catch { pw = require('/usr/local/lib/node_modules/playwright'); }
const PASS = 'a-strong-host-password-2026';
import fs from 'node:fs';
fs.rmSync('/tmp/claude-0/park-data', { recursive: true, force: true });
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '4040', ADMIN_PASSWORD: PASS, DATA_DIR: '/tmp/claude-0/park-data', MAIL_DRY_RUN: '1' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const BASE = 'http://localhost:4040'; const res = []; const ok = (n, c, d = '') => res.push([c ? 'PASS' : 'FAIL', n, c ? '' : '-> ' + d]);
const ev = await (await fetch(BASE + '/api/event')).json();
ok('P1 public event carries the parking details', ev.parking === 'At the club house' && ev.parkingAddress === '35820 Sunflower Hl Dr', JSON.stringify([ev.parking, ev.parkingAddress]));
const ics = await (await fetch(BASE + '/event.ics')).text();
ok('P2 calendar entry mentions the parking', /Parking:\\nAt the club house\\n35820 Sunflower Hl Dr/.test(ics.replace(/\r\n /g, '')), ics.slice(ics.indexOf('DESCRIPTION'), ics.indexOf('DESCRIPTION') + 200));
ok('P2b calendar lines are still folded to 75 octets', ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
const b = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const UAS = { iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', Android: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' };
for (const [n, ua] of Object.entries(UAS)) {
  const ctx = await b.newContext({ userAgent: ua, viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); const p = await ctx.newPage();
  await p.goto(BASE + '/'); await p.waitForTimeout(800); await p.tap('#openBtn'); await p.waitForTimeout(5500);
  const r = await p.evaluate(() => ({ shown: !document.querySelector('#parkRow').hidden, text: document.querySelector('#dPark').textContent, href: decodeURIComponent(document.querySelector('#parkMap').href), mapHidden: document.querySelector('#parkMap').hidden }));
  ok(`P3 ${n}: Parking row shows the note and address`, r.shown && r.text === 'At the club house\n35820 Sunflower Hl Dr', JSON.stringify(r));
  ok(`P3b ${n}: parking directions use the ${n === 'iPhone' ? 'Apple' : 'Google'} map with the street address (city/state borrowed from the main address)`, n === 'iPhone' ? r.href.startsWith('https://maps.apple.com/?daddr=35820 Sunflower Hl Dr, Zephyrhills, FL 33541') : r.href.startsWith('https://www.google.com/maps/dir/?api=1&destination=35820 Sunflower Hl Dr, Zephyrhills, FL 33541'), r.href);
  if (n === 'iPhone') { await p.evaluate(() => document.querySelector('.details').scrollIntoView()); await p.waitForTimeout(700); await p.screenshot({ path: '/tmp/claude-0/parking.png' }); }
  await ctx.close();
}
// dashboard can edit and clear it
const login = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PASS }) }); const cookie = login.headers.get('set-cookie').split(';')[0];
let put = await fetch(BASE + '/api/admin/event', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ parking: 'Park on the street.\nDo not block the gate.', parkingAddress: '' }) });
const ev2 = await (await fetch(BASE + '/api/event')).json(); ok('P4 host can write multi-line parking instructions (line breaks kept) and clear the address', put.ok && ev2.parking === 'Park on the street.\nDo not block the gate.' && ev2.parkingAddress === '', JSON.stringify([ev2.parking, ev2.parkingAddress]));
{ const ics2 = (await (await fetch(BASE + '/event.ics')).text()).replace(/\r\n /g, ''); ok('P4b the multi-line instructions reach the calendar entry', /Parking:\\nPark on the street\.\\nDo not block the gate\./.test(ics2), ics2.slice(ics2.indexOf('DESCRIPTION'), ics2.indexOf('DESCRIPTION') + 220)); }
await fetch(BASE + '/api/admin/event', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ parking: '', parkingAddress: '' }) });
{ const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); await p.goto(BASE + '/'); await p.waitForTimeout(600); await p.tap('#openBtn'); await p.waitForTimeout(5000);
  ok('P5 with parking cleared the row is hidden', await p.evaluate(() => document.querySelector('#parkRow').hidden)); await ctx.close(); }
{ const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); await p.goto(BASE + '/admin'); await p.waitForTimeout(500); await p.fill('#loginForm input', PASS); await p.tap('#loginForm button'); await p.waitForTimeout(1200); await p.tap('.tabs button[data-tab=event]'); await p.waitForTimeout(400);
  ok('P6 dashboard has a multi-line Parking instructions box and a Parking address field', await p.evaluate(() => !!document.querySelector('textarea[name=parking]') && !!document.querySelector('input[name=parkingAddress]'))); await ctx.close(); }
await b.close(); srv.kill();
const f = res.filter((x) => x[0] === 'FAIL'); for (const x of res) if (x[0] === 'FAIL' || process.argv.includes('-v')) console.log(x.join(' ')); console.log(`\n${res.length - f.length}/${res.length} passed`); process.exit(f.length ? 1 : 0);
