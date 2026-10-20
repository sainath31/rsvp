// Writes the calendar file as a static file (used by the GitHub Pages preview, which has no server).
import fs from 'node:fs';
process.env.DATA_DIR ||= '/tmp/rsvp-gen';
const { getEvent } = await import('../lib/store.js');
const { buildIcs } = await import('../lib/messages.js');
const out = process.argv[2] || 'public/event.ics';
fs.writeFileSync(out, buildIcs(await getEvent(), process.env.PUBLIC_URL || ''));
console.log('wrote', out);
