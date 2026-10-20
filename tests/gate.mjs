// The first screen's smoke must keep moving, or fall back to a drifting picture - never a frozen frame.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const require = createRequire('/usr/lib/node_modules/');
let pw; try { pw = require('playwright'); } catch { pw = require('/usr/local/lib/node_modules/playwright'); }
fs.rmSync('/tmp/claude-0/gate-data', { recursive: true, force: true });
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: '4050', ADMIN_PASSWORD: 'x'.repeat(12), DATA_DIR: '/tmp/claude-0/gate-data' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const BASE = 'http://localhost:4050'; const res = []; const ok = (n, c, d = '') => res.push([c ? 'PASS' : 'FAIL', n, c ? '' : '-> ' + d]);
const b = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const state = (p) => p.evaluate(() => { const v = document.querySelector('#gateIdle'); return { moving: !v.paused && v.currentTime > 0.15, t: +v.currentTime.toFixed(2), drift: document.querySelector('#gatePoster').classList.contains('drift') }; });
const mk = async (init, route) => { const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); if (init) await p.addInitScript(init); if (route) await p.route(route, (r) => r.abort()); return { ctx, p }; };

// 1. normal: the video plays and the picture does NOT drift
{ const { ctx, p } = await mk(null); await p.goto(BASE + '/'); await p.waitForTimeout(2500); const a = await state(p); await p.waitForTimeout(1500); const c = await state(p);
  ok('G1 smoke video plays on the first screen', a.moving && c.t > a.t, JSON.stringify([a, c])); ok('G1b the fallback drift is off while the video plays', !c.drift, JSON.stringify(c)); ok('G1c no JS errors', p.errs.length === 0, p.errs.join('|')); await ctx.close(); }

// 2. autoplay refused (iPhone Low Power Mode): picture drifts, then the first touch starts the video
{ const { ctx, p } = await mk((() => { window.__allow = false; const real = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { if (this.id === 'gateIdle' && !window.__allow) return Promise.reject(new DOMException('blocked', 'NotAllowedError')); return real.call(this); };
  document.addEventListener('play', (e) => { if (e.target.id === 'gateIdle' && !window.__allow) e.target.pause(); }, true);
  document.addEventListener('playing', (e) => { if (e.target.id === 'gateIdle' && !window.__allow) e.target.pause(); }, true); }));
  await p.goto(BASE + '/'); await p.waitForTimeout(2500); const a = await state(p);
  ok('G2 autoplay refused: video is not moving but the picture drifts so the screen is alive', !a.moving && a.drift, JSON.stringify(a));
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector('#gatePoster')).animationName); ok('G2b the drift animation is really running', anim === 'gatedrift', anim);
  await p.evaluate(() => { window.__allow = true; }); await p.touchscreen.tap(30, 30); await p.waitForTimeout(2200); const c = await state(p);
  ok('G2c the first touch starts the video and the drift stops', c.moving && !c.drift, JSON.stringify(c));
  await p.evaluate(() => { window.__allow = false; document.querySelector('#gateIdle').pause(); }); await p.waitForTimeout(1600); const d = await state(p); ok('G2d if it gets paused again it is noticed and the drift comes back', !d.moving, JSON.stringify(d));
  ok('G2e no JS errors', p.errs.length === 0, p.errs.join('|')); await ctx.close(); }

// 3. autoplay refused, then the guest taps Open Invitation: the opening still completes
{ const { ctx, p } = await mk((() => { window.__allow = false; const real = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { if (this.id === 'gateIdle' && !window.__allow) return Promise.reject(new DOMException('blocked', 'NotAllowedError')); return real.call(this); };
  document.addEventListener('play', (e) => { if (e.target.id === 'gateIdle' && !window.__allow) e.target.pause(); }, true);
  document.addEventListener('playing', (e) => { if (e.target.id === 'gateIdle' && !window.__allow) e.target.pause(); }, true); }));
  await p.goto(BASE + '/'); await p.waitForTimeout(1500); await p.tap('#openBtn'); await p.waitForTimeout(7500);
  ok('G3 with autoplay refused the Open Invitation sequence still completes', await p.evaluate(() => !document.querySelector('#gate') && !document.querySelector('#app').hidden), 'gate still there'); await ctx.close(); }

// 4. the video file cannot be downloaded at all: drifting picture, no errors, button still works
{ const { ctx, p } = await mk(null, /gate-gold-idle\.(mp4|webm)/); await p.goto(BASE + '/'); await p.waitForTimeout(2500); const a = await state(p);
  ok('G4 video file missing: the picture drifts instead of freezing', !a.moving && a.drift, JSON.stringify(a)); await p.tap('#openBtn'); await p.waitForTimeout(7000);
  ok('G4b ...and opening the invitation still works', await p.evaluate(() => !document.querySelector('#gate')), 'gate still there'); ok('G4c no JS errors', p.errs.length === 0, p.errs.join('|')); await ctx.close(); }

// 5. reduced motion: no drift animation
{ const ctx = await b.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); const p = await ctx.newPage(); await p.addInitScript((() => { window.__allow = false; const real = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { if (this.id === 'gateIdle' && !window.__allow) return Promise.reject(new DOMException('blocked', 'NotAllowedError')); return real.call(this); };
  document.addEventListener('play', (e) => { if (e.target.id === 'gateIdle' && !window.__allow) e.target.pause(); }, true);
  document.addEventListener('playing', (e) => { if (e.target.id === 'gateIdle' && !window.__allow) e.target.pause(); }, true); }));
  await p.goto(BASE + '/'); await p.waitForTimeout(2200); ok('G5 reduced motion: the picture stays still (no drift animation)', (await p.evaluate(() => getComputedStyle(document.querySelector('#gatePoster')).animationName)) === 'none'); await ctx.close(); }
await b.close(); srv.kill();
const f = res.filter((x) => x[0] === 'FAIL'); for (const x of res) if (x[0] === 'FAIL' || process.argv.includes('-v')) console.log(x.join(' ')); console.log(`\n${res.length - f.length}/${res.length} passed`); process.exit(f.length ? 1 : 0);
