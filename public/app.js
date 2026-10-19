const $ = (s) => document.querySelector(s);
let ev;

/* ---------- music: uploaded track, or a soft built-in synth melody ---------- */
const audio = $('#audio');
let ctx, synthTimer, muted = false, playing = false, usingFile = false;

function startSynth() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx ||= new AC();
  ctx.resume();
  const master = ctx.createGain(); master.gain.value = 0.16; master.connect(ctx.destination);
  const delay = ctx.createDelay(); delay.delayTime.value = 0.38;
  const fb = ctx.createGain(); fb.gain.value = 0.38;
  delay.connect(fb); fb.connect(delay); delay.connect(master);
  ctx.master = master;
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
    while (t < ctx.currentTime + 1.5) {
      const bar = Math.floor(n / 8) % chords.length, ch = chords[bar], i = n % 8;
      if (i === 0) note(ch[0] / 2, t, 3.2, 0.55);
      const seq = [0, 1, 2, 1, 2, 1, 0, 1][i];
      note(ch[seq] * (i === 4 ? 2 : 1), t, 1.4, 0.4);
      t += step; n++;
    }
  };
  schedule(); synthTimer = setInterval(schedule, 400);
}
function stopSynth() { clearInterval(synthTimer); synthTimer = null; if (ctx) ctx.suspend(); }

async function playMusic() {
  if (muted) return;
  try {
    if (usingFile) { await audio.play(); }
    else if (!synthTimer) startSynth();
    else ctx.resume();
    playing = true;
  } catch { playing = false; }
  syncMute();
}
function pauseMusic() { usingFile ? audio.pause() : stopSynth(); playing = false; syncMute(); }
function syncMute() {
  const b = $('#mute');
  b.classList.toggle('off', muted);
  b.classList.toggle('on', playing && !muted);
}
$('#mute').onclick = () => { muted = !muted; muted ? pauseMusic() : playMusic(); };
let resume = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing) { resume = true; pauseMusic(); }
  else if (!document.hidden && resume && !muted) { resume = false; playMusic(); }
});

/* ---------- render event ---------- */
const fmt = (o) => new Intl.DateTimeFormat('en-US', { timeZone: ev.tz, ...o }).format(new Date(ev.startsAt));

function render() {
  document.title = `${ev.hosts} – ${ev.title}`;
  $('#title').textContent = ev.hosts;
  $('#subtitle').textContent = ev.title;
  $('#message').textContent = ev.message;
  $('#heroDate').textContent = fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase();
  $('#dDate').textContent = fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  $('#dTime').textContent = fmt({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  $('#dVenue').textContent = ev.venue;
  $('#dAddr').textContent = ev.address;
  if (ev.dressCode) { $('#dDress').textContent = ev.dressCode; $('#dressRow').hidden = false; }
  const map = ev.mapUrl || (ev.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.venue + ' ' + ev.address)}` : '');
  if (map) { $('#mapBtn').href = map; $('#mapBtn').hidden = false; }
  if (ev.rsvpDeadline) $('#deadline').textContent = `Kindly reply by ${new Date(ev.rsvpDeadline + 'T12:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`;
  const e = new Date(new Date(ev.startsAt).getTime() + 36e5 * 3), z = (d) => new Date(d).toISOString().replace(/[-:]|\.\d+/g, '');
  $('#gcal').href = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${z(ev.startsAt)}/${z(e)}`, details: ev.message, location: `${ev.venue}, ${ev.address}` });
  if (ev.image) { $('#pic').src = ev.image; $('#picCard').hidden = false; }
  const vid = $('#heroVid');
  if (ev.video) { vid.removeAttribute('poster'); vid.src = ev.video; } else for (const [f, t] of [['hero.mp4', 'video/mp4'], ['hero.webm', 'video/webm']]) vid.append(Object.assign(document.createElement('source'), { src: f, type: t }));
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
form.addEventListener('change', () => { const no = form.status.value === 'no'; $('#counts').hidden = no; $('#guessBox').hidden = no; });

try { const s = JSON.parse(localStorage.getItem('rsvp') || 'null'); if (s) { form.name.value = s.name || ''; form.phone.value = s.phone || ''; form.email.value = s.email || ''; } } catch {}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#err'), btn = $('#submit');
  err.hidden = true;
  if (!form.name.value.trim()) { err.textContent = 'Please enter your name.'; err.hidden = false; form.name.focus(); return; }
  const body = { name: form.name.value, phone: form.phone.value, email: form.email.value, note: form.note.value, status: form.status.value, guess: form.guess.value, adults: counts.adults, children: counts.children };
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch('api/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Something went wrong');
    try { localStorage.setItem('rsvp', JSON.stringify({ name: body.name, phone: body.phone, email: body.email })); } catch {}
    const first = body.name.trim().split(/\s+/)[0];
    $('#doneTitle').textContent = body.status === 'no' ? `We'll miss you, ${first}` : `See you there, ${first}!${body.guess ? (body.guess === 'boy' ? ' \uD83D\uDC99' : ' \uD83D\uDC97') : ''}`;
    $('#doneText').textContent = body.status === 'no' ? 'Thank you for letting us know.'
      : `We've got ${j.adults} adult${j.adults === 1 ? '' : 's'}${j.children ? ` and ${j.children} child${j.children === 1 ? '' : 'ren'}` : ''} down.` + ((body.phone || body.email) ? ' A confirmation is on its way, and we’ll remind you as the day gets closer.' : '');
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

/* ---------- boot ---------- */
(async () => {
  try {
    ev = await (await fetch('api/event')).json();
  } catch { document.body.innerHTML = '<p style="padding:2rem">Unable to load the invitation. Please refresh.</p>'; return; }
  render(); tick(); setInterval(tick, 1000);
  $('#mute').hidden = false;
  // Browsers only allow sound after a gesture; try silently first, the gate tap guarantees it.
  if (usingFile) audio.play().then(() => { playing = true; syncMute(); }).catch(() => {});
  // Tap: music starts, the smoke swirls together, and the invitation appears through the mist.
  // Every step has a timer fallback, so a slow or blocked video can never leave the screen stuck.
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    const gate = $('#gate'), swirl = $('#gateSwirl'), idle = $('#gateIdle'), hv = $('#heroVid');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    playMusic();

    const startHero = () => {
      hv.currentTime = 0;
      const p = hv.play();
      if (p) p.catch(() => hv.addEventListener('canplay', () => hv.play().catch(() => {}), { once: true }));
    };
    let prepared = false, revealed = false;
    // Start the invitation video underneath the mist, so it is already moving when the mist clears.
    const prepare = () => {
      if (prepared) return;
      prepared = true;
      $('#app').hidden = false;
      document.body.classList.remove('entrance');
      if (!reduce) startHero();
    };
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      prepare();
      gate.classList.add('out');
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
      setTimeout(reveal, 3000);
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
