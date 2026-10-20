// Uploaded pictures / video / music.
//  - disk : files in DATA_DIR/uploads, served from /media (local, or a host with a persistent disk)
//  - blob : Vercel Blob (set BLOB_READ_WRITE_TOKEN) - needed on Vercel, where the disk does not persist
//  - none : serverless with no Blob store - uploads are switched off and the built-in media is used
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_DIR, onServerless } from './store.js';

export const mediaMode = process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : onServerless ? 'none' : 'disk';
// Vercel functions accept request bodies up to 4.5 MB, so uploads are capped just below that there.
export const maxUploadMB = (kindMax) => (mediaMode === 'blob' ? Math.min(kindMax, 4) : kindMax);

export const mediaUrl = (ref) => (!ref ? '' : /^https?:\/\//.test(ref) ? ref : `/media/${ref}`);

export async function saveMedia(kind, buffer, ext, contentType) {
  const name = `${kind}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  if (mediaMode === 'blob') {
    const { put } = await import('@vercel/blob');
    const r = await put(`rsvp/${name}`, buffer, { access: 'public', contentType, addRandomSuffix: false });
    return r.url;
  }
  if (mediaMode === 'disk') { await fs.promises.writeFile(path.join(UPLOAD_DIR, name), buffer); return name; }
  throw new Error('Uploads are not available on this hosting. Add a Vercel Blob store (BLOB_READ_WRITE_TOKEN) or use a host with a persistent disk.');
}

export async function deleteMedia(ref) {
  if (!ref) return;
  try {
    if (/^https?:\/\//.test(ref)) { if (mediaMode === 'blob') { const { del } = await import('@vercel/blob'); await del(ref); } }
    else await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(ref)));
  } catch { /* already gone */ }
}
