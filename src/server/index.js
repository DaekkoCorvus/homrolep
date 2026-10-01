import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRun, setPrologue, applyAction, addPost, startEncounter, addExchange, endEncounter, rewindEncounter, replaceLastNpcLine, reapplyEnding, setWorldTime } from './game/run.js';
import { validateNpcCard, fromForeignCard, parsePngCard, savePortrait, listPortraits, saveNpcCard, imageKind } from './game/cards.js';
import { loadNpcs, presentNpcs, publicNpc, relationshipOf, affinityOf, attitudeOf, mentionsName, validateEvaluation, applyEvaluation, debugView } from './game/npcs.js';
import { createNanoGPT, AIError } from './ai/provider.js';
import { createSettingsStore } from './ai/settings.js';
import { saveRun, loadRun, listRuns } from './saves/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const assetDir = path.join(root, 'assets');
const clientDir = path.join(root, 'src/client');
const worldData = JSON.parse(await readFile(path.join(root, 'data/canon/locations/porta_magna.json'), 'utf8'));
const npcDir = path.join(root, 'data/canon/npcs');
const npcs = await loadNpcs(npcDir);
const port = Number(process.env.PORT) || 3000;

const clientFiles = new Set(['/index.html', '/app.js', '/core.js', '/game.js', '/devtools.js', '/scenes.js', '/styles.css', '/game.css']);
const mimeTypes = { '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request, limit = 32_000) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > limit) throw new Error('Solicitud demasiado grande.');
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

// Lo que el cliente ve de una Run: las impresiones ocultas de los NPC solo salen en modo desarrollador.
async function publicRun(run, dev = false) {
  const toPublic = async (npc) => ({ ...publicNpc(npc), portraits: await listPortraits(assetDir, npc.id) });
  const relationships = Object.fromEntries(Object.entries(run.relationships ?? {}).map(([id, item]) => [id, dev ? debugView(relationshipOf(run, id)) : { met: item.met, contact: item.contact, encounters: item.encounters }]));
  const encounterNpc = run.encounter ? await toPublic(npcs.get(run.encounter.npcId)) : null;
  return {
    ...run, relationships, encounterNpc,
    presence: await Promise.all(presentNpcs(npcs, run.player.locationId, run.world).map(toPublic)),
    contacts: await Promise.all([...npcs.values()].filter((npc) => run.relationships?.[npc.id]?.contact).map(toPublic))
  };
}

const contextFor = (run) => {
  const location = worldData.locations.find(({ id }) => id === run.player.locationId);
  return (npc, relationship, transcript, extra = {}) => ({ npc, player: run.player, world: run.world, location, relationship, attitude: attitudeOf(affinityOf(relationship.notes)), transcript, ...extra });
};

async function devOperation(run, body, config) {
  const context = contextFor(run);
  if (body.op === 'restart') {
    const { run: base, npcId } = rewindEncounter(run);
    if (body.reopen === false) return base;
    const npc = npcs.get(npcId);
    const opening = await ai.npcReply(contextFor(base)(npc, relationshipOf(base, npc.id), [], { opening: true }), config);
    return startEncounter(base, npc, opening);
  }
  if (body.op === 'regen') {
    if (run.encounter) {
      const npc = npcs.get(run.encounter.npcId);
      const transcript = run.encounter.lines.slice(0, -1);
      const reply = await ai.npcReply(context(npc, relationshipOf(run, npc.id), transcript, { opening: transcript.length === 0 }), config);
      return replaceLastNpcLine(run, reply);
    }
    const last = run.eventLog.at(-1);
    if (last?.type === 'conversation_ended' && run.lastEncounter) {
      const npc = npcs.get(run.lastEncounter.npcId);
      const original = run.lastEncounter.origin.relationship;
      const raw = await ai.evaluateEncounter(context(npc, original, run.lastEncounter.lines), config);
      const evaluation = validateEvaluation(raw, run.lastEncounter.lines);
      const { relationship, contactGranted } = applyEvaluation(original, evaluation, run.lastEncounter.startedAt);
      return reapplyEnding(run, npc, { relationship, farewell: evaluation.farewell, contactGranted });
    }
    if (last?.data?.response && !String(last.type).startsWith('conversation')) {
      const before = { ...run, eventLog: run.eventLog.slice(0, -1), player: { ...run.player, locationId: last.from ?? run.player.locationId } };
      const narrative = await ai.narrate(before, run, worldData, config);
      const next = structuredClone(run);
      next.eventLog.at(-1).data.response = narrative;
      next.narrative = { text: narrative, time: last.time };
      return next;
    }
    throw new Error('No hay nada que regenerar.');
  }
  if (body.op === 'set_time') return setWorldTime(run, body);
  if (body.op === 'teleport') {
    if (run.encounter) throw new Error('Termina la conversación antes de moverte.');
    if (!worldData.locations.some(({ id }) => id === body.locationId)) throw new Error('Lugar desconocido.');
    const next = structuredClone(run);
    next.player.locationId = body.locationId;
    next.updatedAt = new Date().toISOString();
    return next;
  }
  throw new Error('Operación de desarrollo desconocida.');
}

async function devRoutes(request, response, pathname) {
  if (request.headers['x-hom-dev'] !== '1') throw new AIError('Las herramientas de desarrollo están desactivadas.', 'DEV_DISABLED', 403);
  const locationIds = worldData.locations.map(({ id }) => id);
  const withPortraits = async (npc) => ({ ...npc, portraits: await listPortraits(assetDir, npc.id) });
  if (request.method === 'GET' && pathname === '/api/dev/npcs') return sendJson(response, 200, await Promise.all([...npcs.values()].map(withPortraits)));
  if (request.method === 'POST' && pathname === '/api/dev/npcs/import') {
    const body = await readBody(request, 12_000_000);
    let raw; let portrait = null;
    if (body.kind === 'png') {
      portrait = Buffer.from(String(body.data ?? ''), 'base64');
      raw = parsePngCard(portrait);
    } else {
      try { raw = JSON.parse(String(body.text ?? '')); } catch { throw new Error('El archivo no es un JSON válido.'); }
    }
    const native = raw && typeof raw === 'object' && raw.schedule && raw.personality;
    const card = validateNpcCard(native ? raw : fromForeignCard(raw, locationIds.includes('cafe') ? 'cafe' : locationIds[0]), locationIds);
    if (npcs.has(card.id) && !body.overwrite) throw Object.assign(new Error(`Ya existe «${card.id}». ¿Sobrescribirlo?`), { status: 409, code: 'NPC_EXISTS', card });
    await saveNpcCard(npcDir, card);
    npcs.set(card.id, card);
    if (portrait) await savePortrait(assetDir, card.id, portrait);
    return sendJson(response, 200, await withPortraits(card));
  }
  const match = pathname.match(/^\/api\/dev\/npcs\/([a-z][a-z0-9_]{1,40})(\/portrait)?$/);
  if (match && request.method === 'PUT' && !match[2]) {
    const card = validateNpcCard({ ...(await readBody(request, 200_000)), id: match[1] }, locationIds);
    await saveNpcCard(npcDir, card);
    npcs.set(card.id, card);
    return sendJson(response, 200, await withPortraits(card));
  }
  if (match && request.method === 'POST' && match[2]) {
    if (!npcs.has(match[1])) throw new Error('NPC desconocido.');
    const body = await readBody(request, 12_000_000);
    const data = Buffer.from(String(body.data ?? ''), 'base64');
    if (!imageKind(data)) throw new Error('El retrato debe ser PNG, WebP o JPG.');
    await savePortrait(assetDir, match[1], data, body.emotion || 'default');
    return sendJson(response, 200, await withPortraits(npcs.get(match[1])));
  }
  return sendJson(response, 404, { error: 'Ruta de desarrollo no encontrada.' });
}

async function talk(run, body, config) {
  const context = contextFor(run);
  if (body.op === 'start') {
    const npc = npcs.get(String(body.npcId));
    if (run.encounter) throw Object.assign(new Error('Ya estás en una conversación.'), { status: 409 });
    if (!npc || !presentNpcs(npcs, run.player.locationId, run.world).includes(npc)) throw new Error('Esa persona no está aquí ahora.');
    const opening = await ai.npcReply(context(npc, relationshipOf(run, npc.id), [], { opening: true }), config);
    return startEncounter(run, npc, opening);
  }
  const encounter = run.encounter;
  if (!encounter) throw new Error('No estás hablando con nadie.');
  const npc = npcs.get(encounter.npcId);
  const relationship = relationshipOf(run, npc.id);
  if (body.op === 'say') {
    const text = String(body.text ?? '').trim().slice(0, 400);
    if (!text) throw new Error('Escribe qué le dices.');
    const nameKnown = relationship.nameKnown || mentionsName(text, run.player.name);
    const transcript = [...encounter.lines, { who: 'player', text }];
    const reply = await ai.npcReply(context(npc, { ...relationship, nameKnown }, transcript), config);
    return addExchange(run, text, reply, nameKnown);
  }
  if (body.op === 'end') {
    if (!encounter.lines.some((line) => line.who === 'player')) return endEncounter(run, npc, { relationship, farewell: '', contactGranted: false });
    const raw = await ai.evaluateEncounter(context(npc, relationship, encounter.lines), config);
    const evaluation = validateEvaluation(raw, encounter.lines);
    const { relationship: updated, contactGranted } = applyEvaluation(relationship, evaluation, encounter.startedAt);
    return endEncounter(run, npc, { relationship: updated, farewell: evaluation.farewell, contactGranted });
  }
  throw new Error('Operación de conversación desconocida.');
}

async function api(request, response, pathname) {
  // Si el cliente cancela (botón detener) o se desconecta, se aborta la llamada a la IA y no se guarda nada.
  const controller = new AbortController();
  response.on('close', () => { if (!response.writableEnded) controller.abort(); });
  const requireConfig = async () => ({ ...(await settings.require()), signal: controller.signal });
  const save = async (run) => { controller.signal.throwIfAborted(); await store.saveRun(run); };
  const sendRun = async (status, run) => sendJson(response, status, await publicRun(run, request.headers['x-hom-dev'] === '1'));
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
  if (pathname.startsWith('/api/dev/')) return devRoutes(request, response, pathname);
  if (request.method === 'GET' && pathname === '/api/world') return sendJson(response, 200, worldData);
  if (request.method === 'POST' && pathname === '/api/creation/whispers') {
    const input=await readBody(request);
    const profile={
      age:String(input.age ?? '').slice(0,3), gender:String(input.gender ?? '').slice(0,20),
      genderCustom:String(input.genderCustom ?? '').slice(0,40),
      origin:String(input.origin ?? '').slice(0,600)
    };
    return exclusive('creation-whispers', async () => {
      const config=await requireConfig();
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
      const config = await requireConfig();
      const draft = createRun(input);
      const run = setPrologue(draft, await ai.prologue(draft.player, worldData, config), worldData);
      await save(run);
      return sendRun(201, run);
    });
  }
  const match = pathname.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(action|posts|talk|dev))?$/i);
  if (!match) return sendJson(response, 404, { error: 'Ruta no encontrada.' });
  const [, id, operation] = match;
  if (request.method === 'GET' && !operation) return sendRun(200, await store.loadRun(id));
  if (request.method === 'POST' && operation === 'action') {
    const input = await readBody(request);
    return exclusive(id, async () => {
      const config = await requireConfig();
      const before = await store.loadRun(id);
      const run = applyAction(before, input, worldData);
      const narrative = await ai.narrate(before, run, worldData, config);
      const event = run.eventLog.at(-1);
      event.data = { ...event.data, response:narrative };
      run.narrative = { text:narrative, time:event.time };
      await save(run);
      return sendRun(200, run);
    });
  }
  if (request.method === 'POST' && operation === 'dev') {
    if (request.headers['x-hom-dev'] !== '1') throw new AIError('Las herramientas de desarrollo están desactivadas.', 'DEV_DISABLED', 403);
    const body = await readBody(request);
    return exclusive(id, async () => {
      const config = await requireConfig();
      const run = await devOperation(await store.loadRun(id), body, config);
      await save(run);
      return sendRun(200, run);
    });
  }
  if (request.method === 'POST' && operation === 'talk') {
    const body = await readBody(request);
    return exclusive(id, async () => {
      const config = await requireConfig();
      const run = await talk(await store.loadRun(id), body, config);
      await save(run);
      return sendRun(200, run);
    });
  }
  if (request.method === 'POST' && operation === 'posts') {
    const body = await readBody(request);
    return exclusive(id, async () => {
      await requireConfig();
      const run = addPost(await store.loadRun(id), body.text);
      await save(run);
      return sendRun(200, run);
    });
  }
  return sendJson(response, 405, { error: 'Método no permitido.' });
}

async function staticFile(response, pathname) {
  const route = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const isAsset = route.startsWith('/assets/');
  if (route.startsWith('/assets/portraits/') && route.split('/').includes('source')) throw Object.assign(new Error('Ruta no encontrada.'), { code: 'ENOENT' });
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
