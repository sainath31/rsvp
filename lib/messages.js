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
const icsEsc = (t) => String(t).replace(/\r/g, '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
// RFC 5545: lines are folded at 75 octets (continuation lines start with one space), never splitting a character.
const fold = (line) => {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
};
const parkingLine = (ev) => (ev.parking || ev.parkingAddress ? `\n\nParking: ${[ev.parking, ev.parkingAddress].filter(Boolean).join(', ')}` : '');
const endOf = (ev) => new Date(new Date(ev.startsAt).getTime() + (Number(ev.durationHours) || 3) * 36e5);

export function buildIcs(ev, link = '') {
  const alarm = (trig, d) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(d)}`, `TRIGGER:${trig}`, 'END:VALARM'];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RSVP//Invitation//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEsc(ev.title)}`, 'BEGIN:VEVENT',
    `UID:${Buffer.from(ev.startsAt + ev.title).toString('hex').slice(0, 32)}@rsvp`, `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(ev.startsAt)}`, `DTEND:${stamp(endOf(ev))}`, `SUMMARY:${icsEsc(ev.title)}`,
    `LOCATION:${icsEsc(`${ev.venue}, ${ev.address}`)}`, `DESCRIPTION:${icsEsc(ev.message + parkingLine(ev) + (link ? `\n\n${link}` : ''))}`,
    ...(link ? [`URL:${link}`] : []), 'STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'SEQUENCE:0',
    ...alarm('-P1D', `Tomorrow: ${ev.title}`), ...alarm('-PT2H', `Soon: ${ev.title}`), 'END:VEVENT', 'END:VCALENDAR'];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function googleCalUrl(ev, link = '') {
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates: `${stamp(ev.startsAt)}/${stamp(endOf(ev))}`, details: ev.message + parkingLine(ev) + (link ? `\n\n${link}` : ''), location: `${ev.venue}, ${ev.address}` });
  return 'https://calendar.google.com/calendar/render?' + q;
}
