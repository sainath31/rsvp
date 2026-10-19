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
