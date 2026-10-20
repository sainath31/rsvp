const $ = (s) => document.querySelector(s);
let guests = [], filter = 'all', ev;
const api = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined });
  if (res.status === 401 && !url.includes('login')) { showLogin(); throw new Error('Signed out'); }
  const j = res.headers.get('content-type')?.includes('json') ? await res.json() : {};
  if (!res.ok) throw new Error(j.error || 'Request failed');
  return j;
};
const toast = (m) => { const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: m }); document.body.append(t); setTimeout(() => t.remove(), 3200); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showLogin() { $('#dash').hidden = true; $('#login').hidden = false; }
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault();
  try { await api('api/admin/login', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) }); boot(); }
  catch (x) { $('#loginErr').textContent = x.message; $('#loginErr').hidden = false; }
};
$('#logout').onclick = async () => { await api('api/admin/logout', { method: 'POST' }).catch(() => {}); showLogin(); };

document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.id === 'p-' + b.dataset.tab));
});

/* guests */
async function loadGuests() { guests = (await api('api/admin/guests')).guests; renderGuests(); }
function renderGuests() {
  const going = guests.filter((g) => g.status === 'yes');
  const a = going.reduce((n, g) => n + g.adults, 0), c = going.reduce((n, g) => n + g.children, 0);
  $('#sPeople').textContent = a + c; $('#sAdults').textContent = a; $('#sKids').textContent = c;
  $('#sBoy').textContent = guests.filter((g) => g.guess === 'boy').length; $('#sGirl').textContent = guests.filter((g) => g.guess === 'girl').length;
  const rows = guests.filter((g) => filter === 'all' || g.status === filter);
  const label = { yes: 'Attending', no: 'Declined', maybe: 'Maybe' };
  $('#list').innerHTML = rows.length ? rows.map((g) => `
    <div class="card guest"><div class="h"><div><b>${esc(g.name)}</b>
      <div class="meta">${g.status === 'no' ? 'Not attending' : `${g.adults} adult${g.adults === 1 ? '' : 's'}${g.children ? ` &middot; ${g.children} child${g.children === 1 ? '' : 'ren'}` : ''}`}${g.email ? ` &middot; ${esc(g.email)}` : ''}</div></div>
      <span class="badge ${g.status}">${g.guess ? (g.guess === 'boy' ? '\uD83D\uDC99 ' : '\uD83D\uDC97 ') : ''}${label[g.status]}</span></div>
      ${g.note ? `<div class="meta">&ldquo;${esc(g.note)}&rdquo;</div>` : ''}
      <div class="g-act"><button class="btn btn-ghost" data-del="${esc(g.id)}">Remove</button></div></div>`).join('')
    : '<p class="empty">No responses yet. Share your invitation link!</p>';
}
$('#filters').onclick = (e) => {
  const f = e.target.dataset.f; if (!f) return;
  filter = f; document.querySelectorAll('#filters [data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === f)); renderGuests();
};
$('#list').onclick = async (e) => {
  const id = e.target.dataset.del; if (!id || !confirm('Remove this response?')) return;
  await api('api/admin/guests/' + id, { method: 'DELETE' }); loadGuests();
};
$('#csv').onclick = () => { location.href = 'api/admin/guests.csv'; };

/* event */
const toLocal = (iso) => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
async function loadEvent() {
  ev = await api('api/admin/event');
  const f = $('#evForm');
  for (const k of ['title', 'hosts', 'venue', 'address', 'mapUrl', 'dressCode', 'rsvpDeadline', 'message', 'durationHours']) f[k].value = ev[k] ?? '';
  f.startsAt.value = toLocal(ev.startsAt);
  const noUp = ev.uploads === false;
  $('#uploadNote').hidden = !noUp;
  document.querySelectorAll('#evForm input[type=file]').forEach((i) => { i.disabled = noUp; i.closest('label').style.opacity = noUp ? .45 : ''; });
  const n = $('#ntForm');
  n.hostEmail.value = ev.hostEmail || ''; n.reminderDays.value = ev.reminderDays.join(', ');
  n.confirmTemplate.value = ev.confirmTemplate; n.reminderTemplate.value = ev.reminderTemplate;
  $('#waStatus').textContent = ev.email ? 'Email (Gmail) is connected \u2705' : 'Email is not set up on the server yet \u26A0 (see README: GMAIL_USER and GMAIL_APP_PASSWORD).';
  $('#imgPrev').style.backgroundImage = ev.imageUrl ? `url("${ev.imageUrl}")` : ''; $('#imgPrev').textContent = ev.imageUrl ? '' : 'No picture yet';
  $('#vidPrev').innerHTML = ev.videoUrl ? `<video controls muted playsinline src="${esc(ev.videoUrl)}" style="width:60%;border-radius:12px"></video>` : 'Built-in Krishna & Radha video';
  $('#musPrev').innerHTML = ev.musicUrl ? `<audio controls src="${esc(ev.musicUrl)}"></audio>` : 'Built-in melody';
}
$('#evForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  const body = Object.fromEntries(['title', 'hosts', 'venue', 'address', 'mapUrl', 'dressCode', 'rsvpDeadline', 'message', 'durationHours'].map((k) => [k, f[k].value]));
  body.startsAt = f.startsAt.value ? new Date(f.startsAt.value).toISOString() : undefined;
  body.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try { await api('api/admin/event', { method: 'PUT', body: JSON.stringify(body) }); toast('Saved ✓'); loadEvent(); } catch (x) { toast(x.message); }
};
$('#ntForm').onsubmit = async (e) => {
  e.preventDefault(); const f = e.target;
  const body = { hostEmail: f.hostEmail.value, confirmTemplate: f.confirmTemplate.value, reminderTemplate: f.reminderTemplate.value,
    reminderDays: f.reminderDays.value.split(/[,\s]+/).filter(Boolean).map(Number) };
  try { await api('api/admin/event', { method: 'PUT', body: JSON.stringify(body) }); toast('Saved ✓'); loadEvent(); } catch (x) { toast(x.message); }
};
for (const [kind, input, del] of [['image', '#imgFile', '#imgDel'], ['video', '#vidFile', '#vidDel'], ['music', '#musFile', '#musDel']]) {
  $(input).onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const fd = new FormData(); fd.append('file', file); toast('Uploading…');
    try { await api('api/admin/upload/' + kind, { method: 'POST', body: fd }); toast('Uploaded ✓'); loadEvent(); } catch (x) { toast(x.message); }
    e.target.value = '';
  };
  $(del).onclick = async () => { await api('api/admin/upload/' + kind, { method: 'DELETE' }); loadEvent(); };
}
$('#testWa').onclick = async () => { try { await api('api/admin/test-email', { method: 'POST' }); toast('Test sent ✓'); } catch (x) { toast(x.message); } };
$('#remindAll').onclick = async () => {
  if (!confirm('Email a reminder to all attending/maybe guests now?')) return;
  try { const r = await api('api/admin/remind', { method: 'POST', body: JSON.stringify({}) }); toast(`Sent ${r.sent}${r.failed.length ? `, ${r.failed.length} failed` : ''}`); } catch (x) { toast(x.message); }
};

async function boot() {
  try { await api('api/admin/me'); } catch { return showLogin(); }
  $('#login').hidden = true; $('#dash').hidden = false;
  await Promise.all([loadGuests(), loadEvent()]);
}
boot();
