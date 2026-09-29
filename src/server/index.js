import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, setPrologue, applyAction, addPost } from './game/run.js';
import { generatePrologue } from './ai/provider.js';
import { saveRun, loadRun, listRuns } from './saves/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const clientDir = path.join(root, 'src/client');
const worldData = JSON.parse(await readFile(path.join(root, 'data/canon/locations/northfortress.json'), 'utf8'));
const port = Number(process.env.PORT) || 3000;

const mimeTypes = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Solicitud demasiado grande.');
  }
  return raw ? JSON.parse(raw) : {};
}

async function api(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/world') return sendJson(response, 200, worldData);
  if (request.method === 'GET' && pathname === '/api/runs') return sendJson(response, 200, await listRuns());
  if (request.method === 'POST' && pathname === '/api/runs') {
    const draft = createRun(await readBody(request));
    const run = setPrologue(draft, await generatePrologue(draft.player, worldData), worldData);
    await saveRun(run);
    return sendJson(response, 201, run);
  }
  const match = pathname.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(action|posts))?$/i);
  if (!match) return sendJson(response, 404, { error: 'Ruta no encontrada.' });
  const [, id, operation] = match;
  if (request.method === 'GET' && !operation) return sendJson(response, 200, await loadRun(id));
  if (request.method === 'POST' && operation === 'action') {
    const run = applyAction(await loadRun(id), await readBody(request), worldData);
    await saveRun(run);
    return sendJson(response, 200, run);
  }
  if (request.method === 'POST' && operation === 'posts') {
    const body = await readBody(request);
    const run = addPost(await loadRun(id), body.text);
    await saveRun(run);
    return sendJson(response, 200, run);
  }
  return sendJson(response, 405, { error: 'Método no permitido.' });
}

async function staticFile(response, pathname) {
  const route = pathname === '/' ? '/index.html' : pathname;
  const base = ['/app.js', '/styles.css', '/index.html'].includes(route) ? clientDir : publicDir;
  const target = path.resolve(base, `.${route}`);
  if (!target.startsWith(base)) throw Object.assign(new Error('Ruta inválida.'), { code: 'ENOENT' });
  const content = await readFile(target);
  response.writeHead(200, { 'content-type': mimeTypes[path.extname(target)] ?? 'application/octet-stream' });
  response.end(content);
}

const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    if (pathname.startsWith('/api/')) await api(request, response, pathname);
    else await staticFile(response, pathname);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : error instanceof SyntaxError ? 400 : 400;
    if (!response.headersSent) sendJson(response, status, { error: error.message });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`HOM RPG disponible en http://localhost:${port}`);
});
