#!/usr/bin/env node
/**
 * serve.mjs — servidor estático mínimo, sin dependencias.
 * Necesario porque fetch() no funciona sobre file://.
 *
 * Uso:
 *   node tools/serve.mjs            -> http://localhost:8080
 *   PORT=3000 node tools/serve.mjs
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(response, 400, 'Ruta inválida');
  }

  // Normaliza y evita salir de ROOT (path traversal).
  const relative = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  let filePath = path.join(ROOT, relative);

  try {
    let info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      info = await stat(filePath);
    }
    if (!info.isFile() || !filePath.startsWith(ROOT + path.sep)) {
      return send(response, 404, 'No encontrado');
    }

    const body = await readFile(filePath);
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': type.startsWith('image/') ? 'public, max-age=86400' : 'no-cache',
    };

    // Comprime texto (como hace GitHub Pages): posts.json baja de ~780 KB a ~110 KB.
    const compressible =
      type.includes('text/') || type.includes('json') || type.includes('javascript') || type === 'image/svg+xml';
    let payload = body;
    if (compressible && body.length > 512 && (request.headers['accept-encoding'] || '').includes('gzip')) {
      payload = gzipSync(body);
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = payload.length;
      headers['Vary'] = 'Accept-Encoding';
    }

    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : payload);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return send(response, 404, 'No encontrado');
    return send(response, 500, 'Error interno del servidor');
  }
});

function send(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(`${message}\n`);
}

server.listen(PORT, HOST, () => {
  console.log(`\n  Catálogo listo en  \x1b[36mhttp://${HOST}:${PORT}\x1b[0m\n  Ctrl+C para detener.\n`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  El puerto ${PORT} está ocupado. Prueba: PORT=8081 npm run dev\n`);
    process.exit(1);
  }
  throw error;
});
