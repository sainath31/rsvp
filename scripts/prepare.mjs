// Build step (Vercel buildCommand, GitHub Pages workflow, Docker): puts the real site address into the
// link-preview tags of public/index.html. Without an address the tags fall back to relative paths.
import fs from 'node:fs';
const raw = process.env.SITE_URL || process.env.PUBLIC_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
const site = raw.replace(/\/$/, '');
const file = new URL('../public/index.html', import.meta.url);
const html = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, html.replaceAll('__SITE_URL__', site));
console.log(`prepare: link-preview address = ${site || '(relative)'}`);
