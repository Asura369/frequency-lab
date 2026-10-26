/**
 * Minimal static preview for the built site, with directory indexes and the
 * branded 404 page. Production hosting provides these behaviours itself.
 *
 *   node scripts/preview.mjs [--port 4173]
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve('dist');
const portArg = process.argv.indexOf('--port');
const port = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendFile(response, file, status = 200) {
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  response.writeHead(status, { 'Content-Type': type });
  createReadStream(file).pipe(response);
}

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.join(root, pathname);
    if (!file.startsWith(root)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (existsSync(file) && statSync(file).isFile()) {
      sendFile(response, file);
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) {
      sendFile(response, path.join(file, 'index.html'));
      return;
    }
    const notFound = path.join(root, '404.html');
    if (existsSync(notFound)) sendFile(response, notFound, 404);
    else response.writeHead(404).end('Not found');
  } catch {
    response.writeHead(500).end('Server error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`preview: http://127.0.0.1:${port}`);
});
