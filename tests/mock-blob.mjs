// Minimal Vercel Blob API stand-in (PUT upload, POST /delete) for testing uploads without a real store.
import http from 'node:http';
export function startBlob(port) {
  const files = new Map(); const log = [];
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
      const body = Buffer.concat(chunks); const u = new URL(req.url, `http://localhost:${port}`);
      const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.method === 'PUT' && u.pathname === '/') {
        if (!/^Bearer vercel_blob_rw_/.test(req.headers.authorization || '')) return send(401, { error: { code: 'forbidden', message: 'bad token' } });
        const pathname = u.searchParams.get('pathname'); const url = `http://localhost:${port}/files/${pathname}`;
        files.set(pathname, { body, type: req.headers['x-content-type'] }); log.push(['put', pathname, body.length]);
        return send(200, { url, downloadUrl: url + '?download=1', pathname, contentType: req.headers['x-content-type'], contentDisposition: 'inline', etag: 'x' });
      }
      if (req.method === 'POST' && u.pathname === '/delete') { const { urls } = JSON.parse(body.toString()); for (const x of urls) { files.delete(new URL(x).pathname.replace('/files/', '')); log.push(['del', x]); } return send(200, {}); }
      if (req.method === 'GET' && u.pathname.startsWith('/files/')) { const f = files.get(u.pathname.slice(7)); if (!f) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': f.type }); return res.end(f.body); }
      send(404, { error: 'nope' });
    });
  });
  return new Promise((r) => srv.listen(port, () => r({ srv, files, log, close: () => srv.close() })));
}
