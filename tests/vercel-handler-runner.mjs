// Runs the real Vercel entry file (api/[...path].js) the way Vercel invokes it.
import http from 'node:http';
const { default: handler } = await import('../api/[...path].js');
http.createServer((req, res) => handler(req, res)).listen(Number(process.env.RUNNER_PORT), () => console.log('ready'));
