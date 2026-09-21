import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve('../portfolio');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};
createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const target = resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(target);
    response.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(4173, 'localhost', () => {
  console.log('포트폴리오 로컬 주소: http://localhost:4173/');
});
