// Local preview: serves the static files and /api/* the way Vercel does.
// Without env vars it logs in with password "devpassword" and stores data in .data.json.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

process.env.APP_SECRET ||= 'local-dev-secret-not-for-production';
process.env.ADMIN_PASSWORD ||= 'devpassword';
const { default: api } = await import('./api/main.js');

const root = import.meta.dirname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.luau': 'text/plain' };
const port = process.env.PORT || 3000;

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path.startsWith('/api/')) return api(req, res);
  const file = normalize(join(root, path === '/' ? 'index.html' : decodeURIComponent(path)));
  if (!file.startsWith(root) || /[\\/]\.|[\\/](server|api)[\\/]/.test(file.slice(root.length))) return res.writeHead(404).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`http://localhost:${port}  (password: ${process.env.ADMIN_PASSWORD})`));
