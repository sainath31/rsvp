// Vercel entry point: every /api/* request is handled by the Express app in server.js.
// If the app fails to start (a missing setting or module), say so in plain JSON instead of an empty error page.
let appPromise;
export default async function handler(req, res) {
  try {
    appPromise ||= import('../server.js').then((m) => m.default);
    const app = await appPromise;
    return app(req, res);
  } catch (e) {
    appPromise = undefined;
    console.error('[startup] server failed to start:', e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'The server failed to start', detail: String(e && e.message).slice(0, 160) }));
  }
}
