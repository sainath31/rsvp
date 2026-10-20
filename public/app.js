const $ = (s) => document.querySelector(s);
let ev;

/* ---------- music: uploaded track, or a soft built-in synth melody ----------
   Starts when the guest taps Open Invitation, fades out when they scroll down past the video,
   fades back in when they scroll up to it. The music button turns it off (and back on) for good. */
const audio = $('#audio');
let ctx, master, synthTimer, usingFile = false;
let muted = false;        // the guest turned it off with the button
let musicStarted = false;      // set by the Open Invitation tap (browsers only allow sound after a tap)
let inMusicZone = true;   // the video at the top of the page is on screen
let override = false;     // the guest tapped the button to turn it on while scrolled away
let playing = false;
const VOL = 0.16, FILE_VOL = 0.7;

function startSynth() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  ctx.resume();
  master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const delay = ctx.createDelay(); delay.delayTime.value = 0.38;
  const fb = ctx.createGain(); fb.gain.value = 0.38;
  delay.connect(fb); fb.connect(delay); delay.connect(master);
  const chords = [[261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]];
  const step = 0.42; let t = ctx.currentTime + 0.1, n = 0;
  const note = (f, at, dur, vol) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    o.connect(g); g.connect(master); g.connect(delay); o.start(at); o.stop(at + dur + 0.05);
  };
  const schedule = () => {
    while (t < ctx.currentTime + 1.5) { // while the context is suspended its clock stands still, so nothing piles up
      const bar = Math.floor(n / 8) % chords.length, ch = chords[bar], i = n % 8;
      if (i === 0) note(ch[0] / 2, t, 3.2, 0.55);
      const seq = [0, 1, 2, 1, 2, 1, 0, 1][i];
      note(ch[seq] * (i === 4 ? 2 : 1), t, 1.4, 0.4);
      t += step; n++;
    }
  };
  schedule(); synthTimer = setInterval(schedule, 400);
}

let fadeTimer;
function fadeTo(target, ms, then) {
  clearInterval(fadeTimer);
  if (!usingFile && master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(target, ctx.currentTime, ms / 3000); setTimeout(() => then && then(), ms); return; }
  const from = audio.volume, steps = 12; let k = 0;
  fadeTimer = setInterval(() => { k++; audio.volume = Math.min(1, Math.max(0, from + (target - from) * k / steps)); if (k >= steps) { clearInterval(fadeTimer); then && then(); } }, ms / steps);
}

// Decide whether music should be playing right now, and make it so.
function applyMusic() {
  const want = musicStarted && !muted && !document.hidden && (inMusicZone || override);
  if (want && !playing) {
    playing = true;
    try {
      if (usingFile) { audio.volume = 0; audio.play().then(() => fadeTo(FILE_VOL, 700)).catch(() => { playing = false; syncMute(); }); }
      else { if (!ctx) startSynth(); else ctx.resume(); fadeTo(VOL, 700); }
    } catch { playing = false; }
  } else if (!want && playing) {
    playing = false;
    fadeTo(0, 500, () => { if (playing) return; usingFile ? audio.pause() : ctx && ctx.suspend(); });
  }
  syncMute();
}
function syncMute() {
  const b = $('#mute');
  b.classList.toggle('off', muted);
  b.setAttribute('aria-label', muted ? 'Turn music on' : 'Turn music off');
  b.title = muted ? 'Turn music on' : 'Turn music off';
  b.classList.toggle('on', playing);
}
$('#mute').onclick = () => {
  muted = !muted;
  override = !muted && !inMusicZone; // turning it on while scrolled away is honoured
  musicStarted = true;
  applyMusic();
};
document.addEventListener('visibilitychange', applyMusic);
function setMusicZone(visible) { if (visible === inMusicZone) return; inMusicZone = visible; if (visible) override = false; applyMusic(); }

/* ---------- render event ---------- */
const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: ev.tz, ...o }).format(new Date(ev.startsAt));

function render() {
  document.title = `${ev.title} – ${ev.hosts}`;
  $('#title').textContent = ev.title;
  $('#hosts').textContent = ev.hosts;
  $('#message').textContent = ev.message;
  $('#heroDate').textContent = fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
  $('#dDate').textContent = fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  $('#dTime').textContent = fmt({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  $('#dVenue').textContent = ev.venue;
  $('#dAddr').textContent = ev.address;
  if (ev.dressCode) { $('#dDress').textContent = ev.dressCode; $('#dressRow').hidden = false; }
  // Directions use the street address only (a venue name like "Our Home" matches nothing on a map).
  // iPhone/iPad -> Apple Maps; everything else -> Google Maps directions. A map link set in the dashboard wins.
  const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const dest = encodeURIComponent(ev.address || '');
  const map = ev.mapUrl || (ev.address ? (isApple ? `https://maps.apple.com/?daddr=${dest}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${dest}`) : '');
  if (map) { $('#mapBtn').href = map; $('#mapBtn').hidden = false; }
  if (ev.rsvpDeadline) $('#deadline').textContent = `Kindly reply by ${new Date(ev.rsvpDeadline + 'T12:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`;
  setupCalendar();
  if (ev.image) { $('#pic').src = ev.image; $('#picCard').hidden = false; }
  const vid = $('#heroVid');
  // Pick one playable file explicitly (more reliable across phone browsers than <source> children).
  const can = (t) => !!vid.canPlayType && vid.canPlayType(t) !== '';
  if (ev.video) { vid.removeAttribute('poster'); vid.src = ev.video; }
  else vid.src = can('video/mp4; codecs="avc1.42E01E"') || !can('video/webm; codecs="vp9"') ? 'hero-v2.mp4' : 'hero-v2.webm'; // MP4 (H.264) first; WebM only if H.264 is unavailable
  vid.load();
  if (ev.music) { audio.src = ev.music; usingFile = true; }
  audio.volume = 0.7;
}

function tick() {
  const ms = new Date(ev.startsAt) - Date.now();
  const cd = $('#countdown');
  if (ms <= 0) { cd.hidden = true; return; }
  const s = Math.floor(ms / 1000);
  $('#cd-d').textContent = Math.floor(s / 86400);
  $('#cd-h').textContent = Math.floor(s % 86400 / 3600);
  $('#cd-m').textContent = Math.floor(s % 3600 / 60);
  $('#cd-s').textContent = s % 60;
}

/* ---------- RSVP form ---------- */
const form = $('#form');
const counts = { adults: 1, children: 0 };
document.querySelectorAll('.stepper').forEach((el) => {
  const key = el.dataset.for, [minus, plus] = el.querySelectorAll('button');
  const set = (v) => { counts[key] = Math.max(key === 'adults' ? 1 : 0, Math.min(20, v)); $('#' + key + 'Out').textContent = counts[key]; };
  minus.onclick = () => set(counts[key] - 1);
  plus.onclick = () => set(counts[key] + 1);
});
const EMAIL_NEEDED = "Email <em>(we'll send your confirmation and a reminder)</em>", EMAIL_OPTIONAL = 'Email <em>(optional)</em>';
form.addEventListener('change', () => {
  const no = form.status.value === 'no';
  $('#counts').hidden = no; $('#guessBox').hidden = no;
  $('#emailLabel').innerHTML = no ? EMAIL_OPTIONAL : EMAIL_NEEDED; // email is only required for accept / maybe
});

try { const s = JSON.parse(localStorage.getItem('rsvp') || 'null'); if (s) { form.name.value = s.name || ''; form.email.value = s.email || ''; } } catch {}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#err'), btn = $('#submit');
  err.hidden = true;
  if (!form.name.value.trim()) { err.textContent = 'Please enter your name.'; err.hidden = false; form.name.focus(); return; }
  if (form.status.value !== 'no' && !form.email.value.trim()) { err.textContent = 'Please enter your email so we can send your confirmation and a reminder.'; err.hidden = false; form.email.focus(); return; }
  const body = { name: form.name.value, email: form.email.value, note: form.note.value, status: form.status.value, guess: form.guess.value, adults: counts.adults, children: counts.children };
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch('api/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Something went wrong');
    try { localStorage.setItem('rsvp', JSON.stringify({ name: body.name, email: body.email })); } catch {}
    const first = body.name.trim().split(/\s+/)[0];
    $('#doneTitle').textContent = body.status === 'no' ? `We'll miss you, ${first}` : `See you there, ${first}!${body.guess ? (body.guess === 'boy' ? ' \uD83D\uDC99' : ' \uD83D\uDC97') : ''}`;
    $('#doneText').textContent = body.status === 'no' ? 'Thank you for letting us know.'
      : `We've got ${j.adults} adult${j.adults === 1 ? '' : 's'}${j.children ? ` and ${j.children} child${j.children === 1 ? '' : 'ren'}` : ''} down.` + (body.email ? ' A confirmation is on its way, and we’ll remind you as the day gets closer.' : '');
    form.hidden = true; $('#done').hidden = false; $('#rsvp h2').hidden = true; $('#deadline').hidden = true;
    if (body.status !== 'no') confetti();
  } catch (x) { err.textContent = x.message; err.hidden = false; }
  btn.disabled = false; btn.textContent = 'Send RSVP';
});
$('#editAgain').onclick = () => { form.hidden = false; $('#done').hidden = true; $('#rsvp h2').hidden = false; $('#deadline').hidden = false; };

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = Object.assign(document.createElement('canvas'), { width: innerWidth, height: innerHeight });
  Object.assign(c.style, { position: 'fixed', inset: 0, zIndex: 60, pointerEvents: 'none' });
  document.body.append(c);
  const g = c.getContext('2d'), colors = ['#ff6fa8', '#4f9bff', '#f1d9a3', '#fff', '#ffc6dc'];
  const ps = Array.from({ length: 110 }, () => ({ x: innerWidth / 2, y: innerHeight * .6, vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4, s: 4 + Math.random() * 5, c: colors[Math.random() * 5 | 0], r: Math.random() * 6 }));
  let f = 0;
  (function loop() {
    g.clearRect(0, 0, c.width, c.height);
    ps.forEach((p) => { p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += .2; g.fillStyle = p.c; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * .6); g.restore(); });
    if (++f < 130) requestAnimationFrame(loop); else c.remove();
  })();
}

/* ---------- add to calendar: one button that does the right thing on each device ---------- */
//  iPhone/iPad : opens Apple's native "Add to Calendar" sheet (the .ics is served inline)
//  Android     : downloads the .ics; tapping "Open" adds it to the phone's own calendar (Samsung, Google, ...).
//                Websites cannot launch the calendar app directly, so this is the reliable route.
//  Desktop     : downloads the .ics calendar file
function setupCalendar() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|Snapchat|Twitter|MicroMessenger|; wv\)/.test(ua);
  const z = (d) => new Date(d).toISOString().replace(/[-:]|\.\d+/g, '');
  const start = new Date(ev.startsAt).getTime();
  const end = start + (Number(ev.durationHours) || 3) * 36e5;
  const here = location.href.split(/[?#]/)[0];
  const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${z(start)}/${z(end)}`, details: `${ev.message}\n\n${here}`, location: `${ev.venue}, ${ev.address}` });
  document.querySelectorAll('.js-cal').forEach((btn) => { if (!isIOS) btn.setAttribute('download', 'invitation.ics'); });
  if (isAndroid) { $('#calHelp').hidden = false; $('#calGoogle').href = google; }
  if (inApp) $('#calHint').hidden = false;
  $('#copyLink').onclick = async () => { try { await navigator.clipboard.writeText(here); $('#copyLink').textContent = 'link copied'; } catch { prompt('Copy this link', here); } };
}

/* ---------- host login (profile icon, top right) ---------- */
function setupHostLogin() {
  const modal = $('#hostModal'), form = $('#hostForm'), err = $('#hostErr'), btn = $('#hostBtn');
  const close = () => { modal.hidden = true; form.reset(); err.hidden = true; btn.focus(); };
  btn.onclick = async () => {
    try { const r = await fetch('api/admin/me'); if (r.ok) { location.href = 'admin.html'; return; } } catch {} // already signed in
    modal.hidden = false; err.hidden = true; setTimeout(() => form.password.focus(), 50);
  };
  $('#hostClose').onclick = close;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); err.hidden = true;
    const go = $('#hostGo'); go.disabled = true; go.textContent = 'Signing in\u2026';
    try {
      let r;
      try { r = await fetch('api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: form.password.value }) }); }
      catch { throw new Error('Could not reach the server. Check your connection and try again.'); }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ? (j.detail ? `${j.error}: ${j.detail}` : j.error) : `Could not sign in (the server answered ${r.status}). ${r.status === 404 ? 'The server part of the site is not responding - open /healthz on this site to check.' : 'Open /healthz on this site, or check the hosting logs.'}`);
      location.href = 'admin.html';
    } catch (x) { err.textContent = x.message; err.hidden = false; form.password.select(); }
    go.disabled = false; go.textContent = 'Sign in';
  });
}

/* ---------- smoothness helpers ---------- */
const showFinalStill = () => { const i = $('#heroImg'); if (i && !i.src.includes('hero-final')) i.src = 'hero-final.jpg'; $('#heroVid').classList.remove('live'); };
let heroGo = false; // the hero video stays on its first frame (empty pot) until the mist is clearing
function setupMotion() {
  const hv = $('#heroVid'), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  hv.addEventListener('playing', () => { if (heroGo) hv.classList.add('live'); });
  hv.addEventListener('error', () => { if (heroGo) showFinalStill(); });
  hv.addEventListener('stalled', () => { if (heroGo && hv.currentTime < 0.3) setTimeout(() => { if (hv.currentTime < 0.3) showFinalStill(); }, 2500); });
  if (reduce) showFinalStill();
  if (/[?&]debug\b/.test(location.search)) debugPanel();
  // 1. Scroll-reveal for the cards.
  const items = [...document.querySelectorAll('.content > .card')];
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.08 });
    items.forEach((el) => { el.classList.add('rv'); io.observe(el); });
    setTimeout(() => items.forEach((el) => el.classList.add('in')), 6000); // safety net: never leave anything hidden
  }
  // 2. Only decode the hero video while it is on screen; restart it if the phone stalls it.
  let heroVisible = true, last = -1, stalls = 0;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { if (!$('#app').hidden) setMusicZone(es[0].intersectionRatio >= 0.35); }, { threshold: [0, 0.2, 0.35, 0.5, 1] }).observe($('.hero'));
    new IntersectionObserver((es) => { heroVisible = es[0].isIntersecting; if (!reduce && heroGo) { heroVisible ? hv.play().catch(() => {}) : hv.pause(); } }, { threshold: 0.05 }).observe($('.hero'));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && heroVisible && !reduce && heroGo) hv.play().catch(() => {}); });
  setInterval(() => {
    if ($('#app').hidden || document.hidden || !heroVisible || reduce || !heroGo) return;
    if (hv.paused) { hv.play().catch(() => {}); return; }
    stalls = hv.currentTime === last ? stalls + 1 : 0;
    last = hv.currentTime;
    if (stalls >= 2) { stalls = 0; try { hv.currentTime = Math.min(hv.duration || 8, hv.currentTime + 0.05); } catch {} hv.play().catch(() => {}); }
  }, 1500);
  // 3. Floating RSVP button until the form is on screen.
  const fab = $('#rsvpFab'), form = $('#rsvp');
  fab.onclick = () => form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => { fab.hidden = false; }, 4500);
  if ('IntersectionObserver' in window) {
    let heroMostlyVisible = true, formVisible = false;
    const sync = () => fab.classList.toggle('off', heroMostlyVisible || formVisible);
    new IntersectionObserver((es) => { heroMostlyVisible = es[0].intersectionRatio > 0.6; sync(); }, { threshold: [0, 0.6, 1] }).observe($('.hero'));
    new IntersectionObserver((es) => { formVisible = es[0].isIntersecting; sync(); }, { threshold: 0.15 }).observe(form);
  }
}

/* ---------- ?debug: shows what the videos are doing (for troubleshooting on a real phone) ---------- */
function debugPanel() {
  const d = Object.assign(document.createElement('pre'), {});
  Object.assign(d.style, { position: 'fixed', left: '6px', bottom: '6px', zIndex: 999, margin: 0, padding: '6px 8px', maxWidth: '92vw', font: '10px/1.35 monospace', color: '#9f9', background: 'rgba(0,0,0,.8)', borderRadius: '6px', whiteSpace: 'pre-wrap', pointerEvents: 'none' });
  document.body.append(d);
  const v = (el, n) => el ? `${n}: t=${el.currentTime.toFixed(1)} paused=${el.paused} ready=${el.readyState} net=${el.networkState} err=${el.error ? el.error.code : '-'} src=${(el.currentSrc || '').split('/').pop() || '(none)'}` : `${n}: (removed)`;
  setInterval(() => { d.textContent = [v($('#heroVid'), 'hero'), `heroGo=${heroGo} live=${$('#heroVid').classList.contains('live')} still=${($('#heroImg').src || '').split('/').pop()}`, v($('#gateIdle'), 'idle'), v($('#gateSwirl'), 'swirl'), `build ${document.querySelector('meta[name=build]')?.content}`, navigator.userAgent.replace(/\(.*?\)/, '').slice(0, 80)].join('\n'); }, 500);
}

/* ---------- boot ---------- */
(async () => {
  try {
    ev = await (await fetch('api/event')).json();
  } catch { document.body.innerHTML = '<p style="padding:2rem">Unable to load the invitation. Please refresh.</p>'; return; }
  render(); tick(); setInterval(tick, 1000); setupMotion(); setupHostLogin();
  $('#mute').hidden = false; $('#hostBtn').hidden = false; syncMute();
  // Browsers only allow sound after a gesture; try silently first, the gate tap guarantees it.
  // Tap: music starts, the smoke swirls together, and the invitation appears through the mist.
  // Every step has a timer fallback, so a slow or blocked video can never leave the screen stuck.
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    const gate = $('#gate'), swirl = $('#gateSwirl'), idle = $('#gateIdle'), hv = $('#heroVid');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    musicStarted = true; applyMusic(); // music starts with the tap (browsers only allow sound after one)
    // Unlock the hero video inside this tap: phones only let video start later if it was started by a user gesture.
    try { hv.muted = true; const pp = hv.play(); if (pp) pp.then(() => { if (!heroGo) { hv.pause(); hv.currentTime = 0; } }).catch(() => {}); } catch {}

    const startHero = () => {
      heroGo = true;
      hv.currentTime = 0;
      const p = hv.play();
      if (p) p.catch(() => hv.addEventListener('canplay', () => hv.play().catch(() => {}), { once: true }));
      // If the video still isn't moving after a few seconds, show a still of the full scene instead of a frozen/blank frame.
      setTimeout(() => { if (hv.currentTime < 0.3 || hv.paused) showFinalStill(); }, 2500);
    };
    let prepared = false, revealed = false;
    // The app is shown under the mist on the empty-pot first frame; the video only starts as the mist clears.
    const prepare = () => {
      if (prepared) return;
      prepared = true;
      $('#app').hidden = false;
      document.body.classList.remove('entrance');
      hv.pause();
      hv.currentTime = 0;
    };
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      prepare();
      gate.classList.add('out');
      if (!reduce) setTimeout(startHero, 700); // pot is visible first, then the babies peek out from behind it
      setTimeout(() => { idle.pause(); gate.remove(); }, 1900);
    };
    if (reduce) return reveal();

    let swirling = false;
    const begin = () => {
      if (swirling || revealed) return;
      swirling = true;
      gate.classList.add('go');
      setTimeout(() => idle.pause(), 700); // one video decoding at a time keeps phones smooth
      setTimeout(prepare, 1900);
      // Hold the mist until the invitation video can actually play (max ~4.5s), so it never shows a frozen frame.
      const t0 = Date.now();
      const whenReady = () => {
        if (hv.error || hv.networkState === 3) { showFinalStill(); reveal(); return; } // video can't load at all: use the still picture
        if (hv.readyState >= 3 || Date.now() - t0 > 4500) reveal(); else setTimeout(whenReady, 150);
      };
      setTimeout(whenReady, 3000);
      setTimeout(() => gate.addEventListener('click', reveal, { once: true }), 500); // tap again to skip
    };
    swirl.currentTime = 0;
    const started = swirl.play();
    swirl.addEventListener('playing', begin, { once: true });
    if (started) started.catch(() => reveal());
    // Swirl video didn't start promptly (slow network, autoplay blocked): skip it rather than hang.
    setTimeout(() => { if (!swirling) reveal(); }, 1200);
  };
  $('#openBtn').onclick = open;
})();
