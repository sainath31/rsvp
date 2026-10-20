// Minimal Upstash-REST stand-in (GET, SET, HSET, HGETALL, HDEL) for testing the Redis storage backend.
import http from 'node:http';
export function startUpstash(port, token = 'tok') {
  const kv = new Map(), hashes = new Map(); const log = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Unauthorized' });
      let cmd; try { cmd = JSON.parse(body); } catch { return send(400, { error: 'bad json' }); }
      log.push(cmd[0]); const [op, key, ...a] = cmd;
      if (op === 'GET') return send(200, { result: kv.get(key) ?? null });
      if (op === 'SET') { kv.set(key, a[0]); return send(200, { result: 'OK' }); }
      if (op === 'HSET') { const h = hashes.get(key) || new Map(); h.set(a[0], a[1]); hashes.set(key, h); return send(200, { result: 1 }); }
      if (op === 'HGET') { return send(200, { result: hashes.get(key)?.get(a[0]) ?? null }); }
      if (op === 'HDEL') { const h = hashes.get(key); const had = h?.delete(a[0]); return send(200, { result: had ? 1 : 0 }); }
      if (op === 'HGETALL') { const h = hashes.get(key); return send(200, { result: h ? [...h.entries()].flat() : [] }); }
      send(400, { error: `unsupported ${op}` });
    });
  });
  return new Promise((r) => srv.listen(port, () => r({ srv, kv, hashes, log, close: () => srv.close() })));
}
