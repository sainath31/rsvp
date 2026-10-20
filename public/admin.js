const $ = (s) => document.querySelector(s);
let guests = [], filter = 'all', ev;
const api = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined });
  if (res.status === 401 && !url.includes('login')) { showLogin(); throw new Error('Signed out'); }
  const j = res.headers.get('content-type')?.includes('json') ? await res.json() : {};
  if (!res.ok) throw new Error(j.error ? (j.detail ? `${j.error}: ${j.detail}` : j.error) : `Request failed (the server answered ${res.status})`);
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
  // Headcount = people who said yes and were not switched off with "Count in totals".
  const going = guests.filter((g) => g.status === 'yes' && !g.excluded);
  const a = going.reduce((n, g) => n + g.adults, 0), c = going.reduce((n, g) => n + g.children, 0);
  $('#sPeople').textContent = a + c; $('#sAdults').textContent = a; $('#sKids').textContent = c;
  $('#sBoy').textContent = guests.filter((g) => g.guess === 'boy').length; $('#sGirl').textContent = guests.filter((g) => g.guess === 'girl').length;
  const out = guests.filter((g) => g.status !== 'no' && g.excluded);
  const outPeople = out.filter((g) => g.status === 'yes').reduce((n, g) => n + g.adults + g.children, 0);
  $('#exNote').hidden = !out.length;
  $('#exNote').textContent = out.length ? `Not counted: ${out.length} response${out.length === 1 ? '' : 's'}${outPeople ? ` (${outPeople} ${outPeople === 1 ? 'person' : 'people'})` : ''} switched off, e.g. joining virtually. Team guesses still include everyone.` : '';
  const rows = guests.filter((g) => filter === 'all' || (filter === 'excluded' ? g.status !== 'no' && g.excluded : g.status === filter));
  const label = { yes: 'Attending', no: 'Declined', maybe: 'Maybe' };
  $('#list').innerHTML = rows.length ? rows.map((g) => `
    <div class="card guest${g.excluded && g.status !== 'no' ? ' off' : ''}"><div class="h"><div><b>${esc(g.name)}</b>
      <div class="meta">${g.status === 'no' ? 'Not attending' : `${g.adults} adult${g.adults === 1 ? '' : 's'}${g.children ? ` &middot; ${g.children} child${g.children === 1 ? '' : 'ren'}` : ''}`}${g.email ? ` &middot; ${esc(g.email)}` : ''}</div></div>
      <span class="badge ${g.status}">${g.guess ? (g.guess === 'boy' ? '\uD83D\uDC99 ' : '\uD83D\uDC97 ') : ''}${label[g.status]}</span></div>
      ${g.note ? `<div class="meta">&ldquo;${esc(g.note)}&rdquo;</div>` : ''}
      <div class="g-act">${g.status !== 'no' ? `<label class="sw"><input type="checkbox" data-count="${esc(g.id)}" ${g.excluded ? '' : 'checked'} aria-label="Count ${esc(g.name)} in totals"><span class="sw-track"></span><span>${g.excluded ? 'Not counted' : 'Count in totals'}</span></label>` : ''}<button class="btn btn-ghost" data-del="${esc(g.id)}" style="margin-left:auto">Remove</button></div></div>`).join('')
    : '<p class="empty">No responses yet. Share your invitation link!</p>';
}
$('#list').addEventListener('change', async (e) => {
  const id = e.target.dataset.count; if (!id) return;
  const g = guests.find((x) => x.id === id); if (!g) return;
  const want = !e.target.checked; // checked = counted, unchecked = excluded
  g.excluded = want; renderGuests();
  try { await api('api/admin/guests/' + id, { method: 'PATCH', body: JSON.stringify({ excluded: want }) }); toast(want ? 'Not counted in totals' : 'Counted in totals'); }
  catch (x) { g.excluded = !want; renderGuests(); toast(x.message); }
});
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
  for (const k of ['title', 'hosts', 'venue', 'address', 'mapUrl', 'dressCode', 'parking', 'parkingAddress', 'rsvpDeadline', 'message', 'durationHours']) f[k].value = ev[k] ?? '';
  f.startsAt.value = toLocal(ev.startsAt);
  $('#dbWarn').hidden = ev.durable !== false;
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
  const body = Object.fromEntries(['title', 'hosts', 'venue', 'address', 'mapUrl', 'dressCode', 'parking', 'parkingAddress', 'rsvpDeadline', 'message', 'durationHours'].map((k) => [k, f[k].value]));
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
