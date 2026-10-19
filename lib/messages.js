export function fmtDate(ev) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: ev.tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(ev.startsAt));
  } catch {
    return new Date(ev.startsAt).toUTCString();
  }
}

export function whenText(ev, now = Date.now()) {
  const days = Math.round((new Date(ev.startsAt) - now) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export function render(tpl, ev, guest, link) {
  const status = { yes: 'attending', no: 'not attending', maybe: 'maybe' }[guest.status] || guest.status;
  const vars = {
    name: guest.name, event: ev.title, status, date: fmtDate(ev),
    venue: ev.venue, link, when: whenText(ev),
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const icsEsc = (t) => String(t).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');

export function buildIcs(ev) {
  const end = new Date(new Date(ev.startsAt).getTime() + (ev.durationHours || 3) * 36e5);
  const alarm = (trig, d) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(d)}`, `TRIGGER:${trig}`, 'END:VALARM'];
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RSVP//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${Buffer.from(ev.startsAt + ev.title).toString('hex').slice(0, 32)}@rsvp`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(ev.startsAt)}`, `DTEND:${stamp(end)}`, `SUMMARY:${icsEsc(ev.title)}`,
    `LOCATION:${icsEsc(`${ev.venue}, ${ev.address}`)}`, `DESCRIPTION:${icsEsc(ev.message)}`,
    ...alarm('-P1D', `Tomorrow: ${ev.title}`), ...alarm('-PT2H', `Soon: ${ev.title}`), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export function googleCalUrl(ev) {
  const end = new Date(new Date(ev.startsAt).getTime() + (ev.durationHours || 3) * 36e5);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${stamp(ev.startsAt)}/${stamp(end)}`, details: ev.message, location: `${ev.venue}, ${ev.address}` });
  return 'https://calendar.google.com/calendar/render?' + q;
}
