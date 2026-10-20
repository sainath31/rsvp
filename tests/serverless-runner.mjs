// Runs the app the way Vercel does: the default export is the request handler, nothing calls listen() itself.
import http from 'node:http';
const { default: app } = await import('../server.js');
http.createServer(app).listen(Number(process.env.RUNNER_PORT), () => console.log('runner ready'));
