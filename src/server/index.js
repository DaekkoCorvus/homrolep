import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRun, setPrologue, applyAction, addPost } from './game/run.js';
import { createNanoGPT, AIError } from './ai/provider.js';
import { createSettingsStore } from './ai/settings.js';
import { saveRun, loadRun, listRuns } from './saves/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const assetDir = path.join(root, 'assets');
const clientDir = path.join(root, 'src/client');
const worldData = JSON.parse(await readFile(path.join(root, 'data/canon/locations/northfortress.json'), 'utf8'));
const port = Number(process.env.PORT) || 3000;

const clientFiles = new Set(['/index.html', '/app.js', '/core.js', '/game.js', '/scenes.js', '/styles.css', '/game.css']);
const mimeTypes = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 32_000) throw new Error('Solicitud demasiado grande.');
  }
  return raw ? JSON.parse(raw) : {};
}

export function createAppServer({ ai = createNanoGPT(), settings = createSettingsStore(), store = { saveRun, loadRun, listRuns } } = {}) {
const active = new Set();
async function exclusive(key, operation) {
  if (active.has(key)) throw new AIError('Ya hay una petición en curso. Espera a que termine.', 'REQUEST_BUSY', 409);
  active.add(key);
  try { return await operation(); } finally { active.delete(key); }
}

async function api(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/ai/settings') return sendJson(response, 200, await settings.status());
  if (request.method === 'POST' && pathname === '/api/ai/models') {
    const key = await settings.key(await readBody(request));
    return sendJson(response, 200, { models:await ai.models(key) });
  }
  if (pathname === '/api/ai/settings' && request.method === 'POST') {
    const input = await readBody(request);
    return exclusive('settings', async () => {
      const candidate = await settings.candidate(input);
      await ai.verify(candidate);
      return sendJson(response, 200, await settings.save(candidate));
    });
  }
  if (pathname === '/api/ai/settings' && request.method === 'DELETE') {
    return exclusive('settings', async () => sendJson(response, 200, await settings.clear()));
  }
  if (request.method === 'GET' && pathname === '/api/world') return sendJson(response, 200, worldData);
  if (request.method === 'POST' && pathname === '/api/creation/whispers') {
    const input=await readBody(request);
    const profile={
      age:String(input.age ?? '').slice(0,3), gender:String(input.gender ?? '').slice(0,20),
      genderCustom:String(input.genderCustom ?? '').slice(0,40),
      origin:String(input.origin ?? '').slice(0,600)
    };
    return exclusive('creation-whispers', async () => {
      const config=await settings.require();
      try { return sendJson(response, 200, await ai.introduction(profile, config)); }
      catch { return sendJson(response, 200, { whispers:[
        'Es bueno tenerte aquí. Ya casi estás listo para continuar.',
        'Perfecto… vamos a conocernos un poco antes de cruzar.'
      ] }); }
    });
  }
  if (request.method === 'GET' && pathname === '/api/runs') return sendJson(response, 200, await store.listRuns());
  if (request.method === 'POST' && pathname === '/api/runs') {
    const input = await readBody(request);
    return exclusive('creation', async () => {
      const config = await settings.require();
      const draft = createRun(input);
      const run = setPrologue(draft, await ai.prologue(draft.player, worldData, config), worldData);
      await store.saveRun(run);
      return sendJson(response, 201, run);
    });
  }
  const match = pathname.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(action|posts))?$/i);
  if (!match) return sendJson(response, 404, { error: 'Ruta no encontrada.' });
  const [, id, operation] = match;
  if (request.method === 'GET' && !operation) return sendJson(response, 200, await store.loadRun(id));
  if (request.method === 'POST' && operation === 'action') {
    const input = await readBody(request);
    return exclusive(id, async () => {
      const config = await settings.require();
      const before = await store.loadRun(id);
      const run = applyAction(before, input, worldData);
      const narrative = await ai.narrate(before, run, worldData, config);
      const event = run.eventLog.at(-1);
      event.data = { ...event.data, response:narrative };
      run.narrative = { text:narrative, time:event.time };
      await store.saveRun(run);
      return sendJson(response, 200, run);
    });
  }
  if (request.method === 'POST' && operation === 'posts') {
    const body = await readBody(request);
    return exclusive(id, async () => {
      await settings.require();
      const run = addPost(await store.loadRun(id), body.text);
      await store.saveRun(run);
      return sendJson(response, 200, run);
    });
  }
  return sendJson(response, 405, { error: 'Método no permitido.' });
}

async function staticFile(response, pathname) {
  const route = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const isAsset = route.startsWith('/assets/');
  const base = isAsset ? assetDir : clientFiles.has(route) ? clientDir : publicDir;
  const filePath = isAsset ? route.slice('/assets'.length) : route;
  const target = path.resolve(base, `.${filePath}`);
  if (!target.startsWith(base + path.sep)) throw Object.assign(new Error('Ruta inválida.'), { code: 'ENOENT' });
  const content = await readFile(target);
  response.writeHead(200, { 'content-type': mimeTypes[path.extname(target)] ?? 'application/octet-stream' });
  response.end(content);
}

const server = http.createServer(async (request, response) => {
  try {
    const host = request.headers.host || '';
    const url = new URL(request.url, `http://${host}`);
    if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new AIError('Abre el juego desde localhost.', 'LOCAL_ONLY', 403);
    const pathname = url.pathname;
    if (pathname.startsWith('/api/')) {
      if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== `http://${host}`)) throw new AIError('Origen de solicitud no permitido.', 'INVALID_ORIGIN', 403);
      if (['POST','DELETE'].includes(request.method) && !request.headers['content-type']?.startsWith('application/json')) throw new AIError('Se requiere una solicitud JSON.', 'INVALID_REQUEST', 415);
      await api(request, response, pathname);
    }
    else await staticFile(response, pathname);
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : 400);
    const message = error instanceof SyntaxError ? 'Solicitud JSON inválida.' : error.message;
    if (!response.headersSent) sendJson(response, status, { error:message, code:error.code || 'INVALID_REQUEST' });
  }
});
return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createAppServer().listen(port, '127.0.0.1', () => {
    console.log(`HOM RPG disponible en http://localhost:${port}`);
  });
}
