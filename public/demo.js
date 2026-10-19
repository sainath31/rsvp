// Static preview mode (GitHub Pages): there is no server, so /api is emulated in localStorage.
// On a real deployment (Node server) this file does nothing.
(() => {
  if (!/github\.io$/.test(location.hostname) && !/[?&]demo\b/.test(location.search)) return;
  const K = 'rsvp-demo-v4';
  const load = () => { try { return JSON.parse(localStorage.getItem(K)); } catch { return null; } };
  const db = load() || {
    event: { title: 'Little Krishna or Little Radha?', hosts: 'Mamatha Devi & Sainath', startsAt: '2026-10-31T20:00:00.000Z', tz: 'America/New_York', durationHours: 4, venue: 'Our Home', address: '35982 Ellsworth PL, Zephyrhills, FL 33541', mapUrl: '', message: 'Join us as we find out whether baby is a little prince or a little princess! Cast your guess, enjoy great food and be there for the big reveal.', dressCode: 'Wear pink or blue to show your team', rsvpDeadline: '', image: '', video: '', music: '', hostPhone: '', reminderDays: [7, 1], confirmTemplate: 'Hi {name}! Thanks for your RSVP to {event}.', reminderTemplate: 'Hi {name}, reminder: {event} is {when}!' },
    guests: [],
  };
  const save = () => localStorage.setItem(K, JSON.stringify(db));
  const json = (o, status = 200) => Promise.resolve(new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } }));
  const real = window.fetch.bind(window);
  window.fetch = (url, opts = {}) => {
    url = String(url);
    if (!url.startsWith('api/')) return real(url, opts);
    const body = opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
    const m = opts.method || 'GET', e = db.event, authed = sessionStorage.getItem('demo-admin');
    if (url === 'api/event') return json({ ...e });
    if (url === 'api/rsvp') {
      if (!body.name?.trim()) return json({ error: 'Please enter your name.' }, 400);
      const no = body.status === 'no';
      const g = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), name: body.name.trim(), phone: body.phone || '', email: body.email || '', guess: no ? '' : body.guess || '', status: body.status, adults: no ? 0 : Math.max(1, body.adults | 0), children: no ? 0 : body.children | 0, note: body.note || '' };
      db.guests.unshift(g); save();
      return json({ ok: true, status: g.status, adults: g.adults, children: g.children });
    }
    if (url === 'api/admin/login') return body.password === 'demo' ? (sessionStorage.setItem('demo-admin', 1), json({ ok: true })) : json({ error: 'Preview password is "demo"' }, 401);
    if (!authed) return json({ error: 'Unauthorized' }, 401);
    if (url === 'api/admin/logout') { sessionStorage.removeItem('demo-admin'); return json({ ok: true }); }
    if (url === 'api/admin/me') return json({ ok: true });
    if (url === 'api/admin/event') { if (m === 'PUT') { Object.assign(e, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))); save(); } return json({ ...e, imageUrl: e.image, musicUrl: e.music, whatsapp: false }); }
    if (url === 'api/admin/guests') return json({ guests: db.guests });
    if (url.startsWith('api/admin/guests/') && m === 'DELETE') { db.guests = db.guests.filter((g) => g.id !== url.split('/').pop()); save(); return json({ ok: true }); }
    if (url.startsWith('api/admin/upload/')) return json({ error: 'Uploads need the live server (not available in preview).' }, 400);
    return json({ error: 'Not available in preview' }, 400);
  };
  addEventListener('DOMContentLoaded', () => {
    const b = Object.assign(document.createElement('div'), { textContent: 'Preview mode – data stays in your browser · host password: demo' });
    Object.assign(b.style, { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 99, font: '500 11px Inter,sans-serif', textAlign: 'center', padding: '5px', background: '#d9b573', color: '#2a2008' });
    document.body.append(b);
  });
})();
