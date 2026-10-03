import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRun, setPrologue, startEncounter, addExchange, endEncounter, rewindEncounter, replaceLastNpcLine, reapplyEnding, setWorldTime, addContact, grantContact, leaveEncounter, MAX_PLAYER_TEXT } from './game/run.js';
import { advanceTime, timeKey } from './game/clock.js';
import { validateAgreements, addCommitments, applyUpdates, settleCommitments, keepMeetings, meetingNpcIds, commitmentsFor } from './game/commitments.js';
import { validateNpcCard, fromForeignCard, parsePngCard, savePortrait, listPortraits, saveNpcCard, imageKind, removePortrait, renamePortrait, normalizeEmotion } from './game/cards.js';
import { loadNpcs, presentNpcs, publicNpc, relationshipOf, affinityOf, attitudeOf, validateEvaluation, validateFacts, scheduleFor, minutesOfWorld, applyEvaluation, debugView, temporalContext, timedNotes, timedHistory, contactAllowed, findNpcByHandle, parseSpeech, stripMarks, contactInfo, stickyFrom } from './game/npcs.js';
import { createNanoGPT, AIError } from './ai/provider.js';
import { gameRegistry, applyAction } from './ai/tools/game.js';
import { unwrap } from './ai/tools/registry.js';
import { createSettingsStore, isModelId } from './ai/settings.js';
import { runProbe } from './ai/probe.js';
import { createPromptStore } from './ai/promptStore.js';
import { createSocialCatalog } from './game/socialCatalog.js';
import { KINDS, kindNames, defaultPreset, normalizePreset, compose, importSillyTavern } from './ai/composer.js';
import { characterPlan, evaluationPlan, narrationPlan, worldPlan, socialPlan } from './ai/plans.js';
import { ambientHeader } from './ai/ambient.js';
import { noticesSince } from './ai/context/notices.js';
import { feedDue, applyGeneratedPosts, applyReactions, wipeFeed, publishPlayerPost, publishPlayerReply, toggleLike, toggleRepost, saveProfile, profileMedia, markNotificationsRead, socialView, socialInput, threadFor, migrateSocial, expectedReplies, playerPopularity, keyOfMinutes, withAvatars, REFRESH_GAP } from './game/social.js';
import { saveRun, loadRun, listRuns, deleteRun } from './saves/store.js';
import { randomUUID } from 'node:crypto';
import { ensureChatIds, typingMs, readMs, quoteText, MAX_UNANSWERED } from './game/chatpace.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const assetDir = path.join(root, 'assets');
const clientDir = path.join(root, 'src/client');
const worldData = JSON.parse(await readFile(path.join(root, 'data/canon/locations/porta_magna.json'), 'utf8'));
const npcDir = path.join(root, 'data/canon/npcs');
const npcs = await loadNpcs(npcDir);
// Datos locales de la red social: cuentas canónicas (popularidad e imagen fijas, p. ej. @RexNova) y catálogo de avatares https para las
// cuentas aleatorias. Todo lo demás lo inventa el modelo y lo valida el motor. Se relee solo si cambian los archivos.
const defaultSocialCatalog = createSocialCatalog({ dir: path.join(root, 'data/canon/social'), assetDir });
await defaultSocialCatalog.refresh(true);
const port = Number(process.env.PORT) || 3000;
// HOM_DEBUG=1 (lo activa scripts/dev-local.mjs): registra en consola las peticiones /api y los errores del servidor.
const debug = process.env.HOM_DEBUG === '1';

const clientFiles = new Set(['/index.html', '/app.js', '/core.js', '/game.js', '/devtools.js', '/prompteditor.js', '/aitrace.js', '/northlife.js', '/chat.js', '/scenes.js', '/styles.css', '/game.css']);
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

export function createAppServer({ socialCatalog = defaultSocialCatalog, prompts = createPromptStore(), ai = createNanoGPT(fetch, { prompts }), settings = createSettingsStore(), store = { saveRun, loadRun, listRuns, deleteRun } } = {}) {
// Una partida solo admite una operación a la vez. Las del jugador se rechazan si hay otra en curso; el trabajo de fondo (evaluar una
// conversación, generar el feed) hace su llamada al modelo SIN tener la partida y solo espera su turno para aplicar el resultado
// (cargar, aplicar, guardar: milisegundos), así que nunca pisa lo que el jugador hizo mientras tanto ni lo bloquea.
const active = new Set();
const background = new Set(); // partidas cuyo bloqueo tiene ahora el trabajo de fondo
const waiters = new Map();
const waitIdle = (key) => new Promise((resolve) => { const queue = waiters.get(key) ?? []; queue.push(resolve); waiters.set(key, queue); });
const release = (key) => { active.delete(key); const queue = waiters.get(key); while (queue?.length) queue.shift()(); };
async function exclusive(key, operation) {
  while (background.has(key)) await waitIdle(key);
  if (active.has(key)) throw new AIError('Ya hay una petición en curso. Espera a que termine.', 'REQUEST_BUSY', 409);
  active.add(key);
  try { return await operation(); } finally { release(key); }
}
async function whenFree(key, operation) {
  while (active.has(key)) await waitIdle(key);
  active.add(key); background.add(key);
  try { return await operation(); } finally { background.delete(key); release(key); }
}
const jobs = new Map(); // partida → cola de tareas de fondo (una a la vez)
const evaluating = new Set(); const generatingFeed = new Set();
function enqueue(runId, label, task) {
  const next = (jobs.get(runId) ?? Promise.resolve()).then(task).catch((error) => { if (debug) console.error(`[fondo] ${label} ${runId}: ${error.code || ''} ${error.message}`); }).finally(() => { if (jobs.get(runId) === next) jobs.delete(runId); });
  jobs.set(runId, next);
  return next;
}

// Lo que el cliente ve de una Run: las impresiones ocultas de los NPC solo salen en modo desarrollador.
async function publicRun(run, dev = false) {
  const toPublic = async (npc) => ({ ...publicNpc(npc), portraits: await listPortraits(assetDir, npc.id) });
  const relationships = Object.fromEntries(Object.entries(run.relationships ?? {}).map(([id, item]) => [id, dev ? debugView(relationshipOf(run, id)) : { met: item.met, contact: item.contact, added: item.added === true, encounters: item.encounters }]));
  const encounterNpc = run.encounter ? await toPublic(npcs.get(run.encounter.npcId)) : null;
  const { intents, pendingEvaluation, pendingReactions, ...visible } = run; // intenciones sin mecánica: solo para el desarrollador; lo pendiente es interno
  return {
    ...visible, ...(dev ? { intents: intents ?? [] } : {}), pending: { evaluation: Boolean(pendingEvaluation), feed: generatingFeed.has(run.id), reactions: (pendingReactions ?? []).map((item) => item.postId) }, relationships, encounterNpc, social: socialView(run, { dev, seeds: socialCatalog.current().seeds, avatars: socialCatalog.current().avatars }),
    commitments: (run.commitments ?? []).map((item) => ({ ...item, npcName: npcs.get(item.npcId)?.name ?? item.npcId })),
    presence: await Promise.all(presentFor(run).map(toPublic)),
    sharedContacts: [...npcs.values()].filter((npc) => run.relationships?.[npc.id]?.contact).map((npc) => ({ id: npc.id, name: npc.name, handle: npc.contact.handle, added: run.relationships[npc.id].added === true })),
    contacts: await Promise.all([...npcs.values()].filter((npc) => run.relationships?.[npc.id]?.added).map(async (npc) => ({ ...(await toPublic(npc)), chat: { readMs: readMs(npc, relationshipOf(run, npc.id), run.world) } })))
  };
}

// Datos para el prompt social (cuentas, contactos, publicaciones recientes) y opciones de validación del motor.
const loadGame = async (id) => withAvatars(ensureChatIds(await store.loadRun(id)), socialCatalog.current().avatars, socialCatalog.current().seeds);
const socialOptions = () => ({ npcs, seeds: socialCatalog.current().seeds, avatars: socialCatalog.current().avatars });
const socialContext = (run, mode, extra = {}) => socialInput(run, mode, { npcs, seeds: socialCatalog.current().seeds, places: worldData.locations.map(({ name }) => name), ahora: temporalContext({ encounters: 0, notes: [], history: [] }, run.world).ahora, extra });

// Quién está aquí ahora: su horario, más quien espera al jugador en una cita acordada.
function presentFor(run) {
  const base = presentNpcs(npcs, run.player.locationId, run.world);
  const waiting = meetingNpcIds(run).map((id) => npcs.get(id)).filter((npc) => npc && !base.includes(npc));
  return [...base, ...waiting];
}

// Contexto para el PERSONAJE: solo lo que ese personaje sabe. El GM recibe además `gmCommitments` y `locations`.
// Contexto completo para el GM: lugar, hora, relación, recuerdos, sucesos recientes, contacto y emociones disponibles
// (las que existan como imagen del NPC). `speak` convierte las marcas [\\emoción] de la respuesta en tramos.
async function contextFor(run, npc) {
  const location = worldData.locations.find(({ id }) => id === run.player.locationId);
  const emotions = Object.keys(await listPortraits(assetDir, npc.id)).filter((name) => name !== 'default');
  const build = (relationship, transcript, extra = {}) => ({
    npc, player: run.player, world: run.world, location, relationship, attitude: attitudeOf(affinityOf(relationship.notes)), transcript,
    temporal: temporalContext(relationship, run.world), memories: timedNotes(relationship, run.world), history: timedHistory(relationship, run.world),
    emotions, stickyEmotions: npc.emotionsStay ?? [], currentExpression: stickyFrom(run.encounter?.lines, npc), commitments: commitmentsFor(run, npc.id), contact: contactInfo(npc, relationship, run.world), intent: run.encounter?.intent, ...extra
  });
  // Si una expresión «que se mantiene» sigue activa, una respuesta sin marcas la conserva (empieza con ella).
  build.gmCommitments = commitmentsFor(run, npc.id, { withIds: true });
  build.locations = worldData.locations.map(({ id, name }) => ({ id, nombre: name }));
  build.speak = (reply, linesBefore = run.encounter?.lines) => ({ ...reply, gesture: stripMarks(reply.gesture), intent: stripMarks(reply.intent), ...parseSpeech(reply.say, emotions, stickyFrom(linesBefore, npc) ?? 'default') });
  build.farewell = (text) => parseSpeech(text, emotions, stickyFrom(run.encounter?.lines, npc) ?? 'default');
  return build;
}

// Cierre en DOS llamadas simultáneas con papeles distintos: el personaje se despide y el GM traduce lo ocurrido
// (impresiones, nombre que le dieron, hechos, acuerdos) a datos para el motor.
async function evaluateAndClose(run, npc, relationship, lines, startedAt, config, context) {
  const [farewellRaw, raw] = await Promise.all([
    ai.npcReply(context(relationship, lines, { mode: 'closing' }), config),
    ai.evaluateEncounter(context(relationship, lines, { commitments: context.gmCommitments, locations: context.locations }), config)
  ]);
  const evaluation = validateEvaluation(raw, lines);
  const { relationship: updated } = applyEvaluation(relationship, evaluation, startedAt);
  const farewell = context.speak(farewellRaw, lines);
  return {
    relationship: updated, farewell, contactGranted: contactAllowed(npc, updated, farewell.contact),
    agreements: validateAgreements(raw?.agreements, lines, run.world, worldData.locations.map(({ id }) => id)), updates: raw?.updates, lines
  };
}

// Registra lo que el GM tradujo: promesas confirmadas por ambos y pendientes resueltos.
function recordOutcome(next, npcId, outcome) {
  addCommitments(next, npcId, outcome.agreements ?? []);
  applyUpdates(next, npcId, outcome.updates, outcome.lines ?? []);
  return next;
}

// Lo que el personaje declaró con sus herramientas (contacto, acuerdos, datos) se valida contra lo que se dijo de verdad: un acuerdo exige la
// cita literal del jugador, un dato exige su cita, el contacto exige las condiciones de la ficha. Lo que no tiene respaldo se descarta.
const factsClaim = (items) => ({
  playerName: items.find((item) => item.kind === 'name') ? { value: items.find((item) => item.kind === 'name').value, evidence: items.find((item) => item.kind === 'name').quote } : undefined,
  learned: items.filter((item) => item.kind === 'fact').map((item) => ({ fact: item.value, evidence: item.quote }))
});
async function applyReply(run, npc, reply, lines, config) {
  let next = await applyContactClaim(run, reply.contact, config);
  if (reply.agreements?.length) {
    const agreements = validateAgreements(reply.agreements, lines.slice(-6), next.world, worldData.locations.map(({ id }) => id), { npcAccepts: true });
    if (agreements.length) { next = structuredClone(next); addCommitments(next, npc.id, agreements); }
  }
  if (reply.facts?.length) {
    const facts = validateFacts(factsClaim(reply.facts), lines);
    if (facts.playerName || facts.learned.length) {
      next = structuredClone(next);
      next.relationships[npc.id] = applyEvaluation(relationshipOf(next, npc.id), { notes: [], summary: '', ...facts }, timeKey(next.world)).relationship;
    }
  }
  return next;
}

// Al cerrar una conversación el jugador solo espera la despedida. La reflexión del GM (impresiones, resumen, acuerdos y datos que el personaje
// no anotó) queda pendiente en la partida y corre en segundo plano; se aplica antes de que ese personaje vuelva a hablar.
const withPendingEvaluation = (next, npc, before, encounter) => {
  next.pendingEvaluation = { id: randomUUID(), npcId: npc.id, lines: structuredClone(encounter.lines), startedAt: encounter.startedAt, world: structuredClone(next.world), before: structuredClone(before), attempts: 0 };
  return next;
};
const MAX_EVALUATION_ATTEMPTS = 3;

function scheduleEvaluation(run) {
  if (!run.pendingEvaluation || evaluating.has(run.id)) return;
  evaluating.add(run.id);
  enqueue(run.id, 'evaluación', async () => { try { await runEvaluation(run.id); } finally { evaluating.delete(run.id); } });
}

async function runEvaluation(runId) {
  const run = await loadGame(runId);
  const pending = run.pendingEvaluation;
  const npc = pending ? npcs.get(pending.npcId) : null;
  if (!pending || !npc) return;
  const settle = (change) => whenFree(runId, async () => {
    const current = await loadGame(runId);
    if (current.pendingEvaluation?.id !== pending.id) return; // otra operación (p. ej. regenerar el cierre) ya lo resolvió
    const next = structuredClone(current);
    await change(next);
    next.updatedAt = new Date().toISOString();
    await store.saveRun(settleCommitments(next));
  });
  try {
    const config = await settings.require();
    const context = await contextFor({ ...run, world: pending.world }, npc);
    const raw = await ai.evaluateEncounter(context(pending.before, pending.lines, { commitments: context.gmCommitments, locations: context.locations }), config);
    await settle((next) => {
      const { relationship } = applyEvaluation(relationshipOf(next, npc.id), validateEvaluation(raw, pending.lines), pending.startedAt);
      next.relationships[npc.id] = relationship;
      recordOutcome(next, npc.id, { agreements: validateAgreements(raw?.agreements, pending.lines, pending.world, worldData.locations.map(({ id }) => id)), updates: raw?.updates, lines: pending.lines });
      delete next.pendingEvaluation;
    });
  } catch (error) {
    // Un fallo (o una cancelación) no pierde la partida: se reintenta la próxima vez que el cliente la consulte, hasta MAX intentos.
    await settle((next) => {
      next.pendingEvaluation.attempts += 1;
      if (next.pendingEvaluation.attempts >= MAX_EVALUATION_ATTEMPTS) { delete next.pendingEvaluation; next.eventLog.push({ time: timeKey(next.world), type: 'evaluation_failed', data: { npcId: npc.id } }); }
    }).catch(() => {});
    throw error;
  }
}

// NorthLife: una o dos veces al día de juego se genera el feed (varias publicaciones con hora, likes y respuestas). Ya no frena la acción del
// jugador: corre en segundo plano y las publicaciones aparecen cuando llegan.
function scheduleFeed(run, gap) {
  if (typeof ai.socialPosts !== 'function' || generatingFeed.has(run.id) || !feedDue(run, gap)) return;
  generatingFeed.add(run.id);
  const input = socialContext(run, 'post');
  enqueue(run.id, 'feed', async () => {
    try {
      const posts = await ai.socialPosts(input, await settings.require());
      if (!Array.isArray(posts)) return;
      await whenFree(run.id, async () => { await store.saveRun(settleCommitments(applyGeneratedPosts(await loadGame(run.id), posts, socialOptions()))); });
    } finally { generatingFeed.delete(run.id); }
  });
}

const withoutPending = (run) => { delete run.pendingEvaluation; return run; };

async function devOperation(run, body, config) {
  if (body.op === 'restart') {
    const { run: base, npcId } = rewindEncounter(run);
    delete base.pendingEvaluation;
    if (body.reopen === false) return base;
    const npc = npcs.get(npcId);
    const context = await contextFor(base, npc);
    const relationship = relationshipOf(base, npc.id);
    const opening = context.speak(await ai.npcReply(context(relationship, [], { mode: 'open' }), config));
    return applyReply(startEncounter(base, npc, opening), npc, opening, [], config);
  }
  if (body.op === 'regen') {
    if (run.encounter?.closed && run.lastEncounter) {
      const source = run.lastEncounter;
      const npc = npcs.get(source.npcId);
      const context = await contextFor(run, npc);
      const midGrant = source.lines.some((line) => line.kind === 'contact');
      const original = { ...source.origin.relationship, ...(midGrant ? { contact: true } : {}) };
      const result = await evaluateAndClose(run, npc, original, source.lines, source.startedAt, config, context);
      return withoutPending(reapplyEnding(run, npc, result));
    }
    if (run.encounter) {
      const npc = npcs.get(run.encounter.npcId);
      const context = await contextFor(run, npc);
      const lines = run.encounter.lines;
      const index = lines.findLastIndex((line) => line.who === 'npc');
      const undoesContact = lines.slice(index + 1).some((line) => line.kind === 'contact');
      const relationship = { ...relationshipOf(run, npc.id), ...(undoesContact ? { contact: false } : {}) };
      const transcript = lines.slice(0, index);
      const reply = context.speak(await ai.npcReply(context(relationship, transcript, { mode: transcript.length === 0 ? 'open' : 'reply', currentExpression: stickyFrom(lines.slice(0, index), npc) }), config), lines.slice(0, index));
      return applyReply(replaceLastNpcLine(run, reply), npc, reply, transcript, config);
    }
    const last = run.eventLog.at(-1);
    if (last?.type === 'conversation_ended' && run.lastEncounter) {
      const source = run.lastEncounter;
      const npc = npcs.get(source.npcId);
      const context = await contextFor(run, npc);
      const midGrant = source.lines.some((line) => line.kind === 'contact');
      const original = { ...source.origin.relationship, ...(midGrant ? { contact: true } : {}) };
      const result = await evaluateAndClose(run, npc, original, source.lines, source.startedAt, config, context);
      return withoutPending(reapplyEnding(run, npc, result));
    }
    if (last?.data?.response && !String(last.type).startsWith('conversation')) {
      const before = { ...run, eventLog: run.eventLog.slice(0, -1), player: { ...run.player, locationId: last.from ?? run.player.locationId } };
      const narrative = await ai.narrate(before, run, worldData, config, npcs);
      const next = structuredClone(run);
      next.eventLog.at(-1).data.response = narrative;
      next.narrative = { text: narrative, time: last.time };
      return next;
    }
    throw new Error('No hay nada que regenerar.');
  }
  if (body.op === 'social') {
    if (typeof ai.socialPosts !== 'function') throw new Error('Este proveedor no genera publicaciones.');
    return applyGeneratedPosts(run, await ai.socialPosts(socialContext(run, 'post'), config), socialOptions());
  }
  // Limpieza del feed (solo desarrollo): útil para tomar muestras de generación sin rehacer la partida.
  if (body.op === 'social_wipe') return wipeFeed(run).run;
  if (body.op === 'set_time') return setWorldTime(run, body);
  if (body.op === 'unlock_contact') {
    const npc = npcs.get(String(body.npcId));
    if (!npc) throw new Error('NPC desconocido.');
    return grantContact(run, npc);
  }
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

// --- Editor de prompts (modo desarrollador) ------------------------------------------------------------------
const promptInfo = (kind) => {
  const spec = KINDS[kind];
  return {
    kind, label: spec.label, description: spec.description, modes: spec.modes, macros: spec.macros,
    autos: Object.entries(spec.autos).map(([key, auto]) => ({ key, label: auto.label, description: auto.description, role: auto.role ?? 'system', locked: auto.locked === true, special: auto.special === true, required: auto.required === true })),
    preset: structuredClone(prompts.get(kind)), defaults: defaultPreset(kind), custom: prompts.isCustom(kind)
  };
};

// Plan de ejemplo para la vista previa: usa la partida abierta (conversación, chats y contactos reales cuando existen).
async function previewPlan(kind, mode, run, npcId) {
  const here = presentFor(run);
  const npc = npcs.get(npcId) ?? (run.encounter ? npcs.get(run.encounter.npcId) : null) ?? here[0] ?? [...npcs.values()][0];
  const sample = [{ who: 'player', text: '(aquí irá lo que escriba el jugador)' }];
  const withPlayer = (lines) => (lines?.some((line) => line.who === 'player') ? lines : sample);
  const ahora = temporalContext({ encounters: 0, notes: [], history: [] }, run.world).ahora;
  if (kind === 'character' || kind === 'text') {
    const context = await contextFor(run, npc);
    const relationship = relationshipOf(run, npc.id);
    const lines = kind === 'text' ? (run.chats?.[npc.id] ?? []).slice(-24) : run.encounter?.lines ?? [];
    return characterPlan(context(relationship, mode === 'open' ? [] : withPlayer(lines), { mode }));
  }
  if (kind === 'gm') {
    if (mode === 'free') return worldPlan(run, worldData, ambientHeader({ run, worldData, present: here, npcs }));
    if (mode === 'action') return narrationPlan(mode, run, run, worldData);
    const context = await contextFor(run, npc);
    return evaluationPlan(context(relationshipOf(run, npc.id), withPlayer(run.encounter?.lines ?? run.lastEncounter?.lines), { commitments: context.gmCommitments, locations: context.locations }));
  }
  if (mode === 'reply') {
    const social = migrateSocial(run.social, run.player);
    const post = social.posts.find((item) => item.minutes <= minutesOfWorld(run.world)) ?? { id: 'ejemplo', handle: '@ejemplo', text: '(aquí irá la publicación)', time: '', replies: [], minutes: 0 };
    return socialPlan(socialContext(run, 'reply', { publicacion: threadFor(post, minutesOfWorld(run.world)), accionDelJugador: { tipo: 'publicacion', texto: '(aquí irá lo que escriba el jugador)', hora: keyOfMinutes(minutesOfWorld(run.world)).slice(-5) }, respuestasEsperadas: expectedReplies(playerPopularity(run.player)) }));
  }
  return socialPlan(socialContext(run, 'post'));
}

async function promptRoutes(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/dev/prompts') return sendJson(response, 200, { kinds: kindNames.map(promptInfo) });
  if (request.method === 'GET' && pathname === '/api/dev/prompts/log') return sendJson(response, 200, { entries: prompts.log?.() ?? [], stats: prompts.stats?.() ?? [] });
  if (request.method === 'DELETE' && pathname === '/api/dev/prompts/log') { prompts.resetStats?.(); return sendJson(response, 200, { entries: prompts.log?.() ?? [], stats: [] }); }
  const match = pathname.match(/^\/api\/dev\/prompts\/([a-z]+)(?:\/(import|preview))?$/);
  if (!match || !kindNames.includes(match[1])) return sendJson(response, 404, { error: 'Prompt desconocido.' });
  const [, kind, action] = match;
  if (!action && request.method === 'PUT') {
    if (typeof prompts.save !== 'function') throw new Error('Este almacenamiento no permite guardar prompts.');
    await prompts.save(kind, await readBody(request, 2_000_000));
    return sendJson(response, 200, promptInfo(kind));
  }
  if (!action && request.method === 'DELETE') { await prompts.reset?.(kind); return sendJson(response, 200, promptInfo(kind)); }
  if (action === 'import' && request.method === 'POST') {
    const body = await readBody(request, 6_000_000);
    let json; try { json = JSON.parse(String(body.text ?? '')); } catch { throw new Error('El archivo no es un JSON válido.'); }
    return sendJson(response, 200, importSillyTavern(kind, json, prompts.get(kind)));
  }
  if (action === 'preview' && request.method === 'POST') {
    const body = await readBody(request, 2_000_000);
    const mode = KINDS[kind].modes.some(({ id }) => id === body.mode) ? body.mode : KINDS[kind].modes[0].id;
    const run = await loadGame(String(body.runId ?? ''));
    const plan = await previewPlan(kind, mode, run, String(body.npcId ?? ''));
    const messages = compose(kind, mode, normalizePreset(kind, body.preset ?? prompts.get(kind)), plan);
    const chars = messages.reduce((total, message) => total + message.content.length, 0);
    return sendJson(response, 200, { mode, messages, chars, approxTokens: Math.round(chars / 3.6) });
  }
  return sendJson(response, 405, { error: 'Método no permitido.' });
}

async function devRoutes(request, response, pathname) {
  if (request.headers['x-hom-dev'] !== '1') throw new AIError('Las herramientas de desarrollo están desactivadas.', 'DEV_DISABLED', 403);
  const locationIds = worldData.locations.map(({ id }) => id);
  const withPortraits = async (npc) => ({ ...npc, portraits: await listPortraits(assetDir, npc.id) });
  if (pathname.startsWith('/api/dev/prompts')) return promptRoutes(request, response, pathname);
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
  const match = pathname.match(/^\/api\/dev\/npcs\/([a-z][a-z0-9_]{1,40})(\/portrait)?(?:\/([a-z]{1,20})(\/rename)?)?$/);
  if (match && request.method === 'PUT' && !match[2]) {
    const card = validateNpcCard({ ...(await readBody(request, 600_000)), id: match[1] }, locationIds);
    await saveNpcCard(npcDir, card);
    npcs.set(card.id, card);
    return sendJson(response, 200, await withPortraits(card));
  }
  if (match && match[2] && match[3]) {
    if (!npcs.has(match[1])) throw new Error('NPC desconocido.');
    if (request.method === 'DELETE' && !match[4]) await removePortrait(assetDir, match[1], match[3]);
    else if (request.method === 'POST' && match[4]) await renamePortrait(assetDir, match[1], match[3], normalizeEmotion((await readBody(request)).to));
    else return sendJson(response, 405, { error: 'Método no permitido.' });
    return sendJson(response, 200, await withPortraits(npcs.get(match[1])));
  }
  if (match && request.method === 'POST' && match[2] && !match[3]) {
    if (!npcs.has(match[1])) throw new Error('NPC desconocido.');
    const body = await readBody(request, 12_000_000);
    const data = Buffer.from(String(body.data ?? ''), 'base64');
    if (!imageKind(data)) throw new Error('El retrato debe ser PNG, WebP o JPG.');
    const emotion = normalizeEmotion(body.emotion ?? 'default');
    if (!emotion) throw new Error('Escribe un nombre para la emoción usando solo letras.');
    await savePortrait(assetDir, match[1], data, emotion);
    return sendJson(response, 200, await withPortraits(npcs.get(match[1])));
  }
  return sendJson(response, 404, { error: 'Ruta de desarrollo no encontrada.' });
}

// Contexto de las herramientas del motor: la partida, el mundo y lo que hace falta para conversar. Los botones y el modelo comparten handlers.
const toolContext = (run, config) => ({ run, worldData, npcs, present: presentFor, openConversation: (current, npc) => openConversation(current, npc, config) });

// El personaje declara `contact` en su respuesta; eso equivale a llamar a `share_contact`, y el motor decide con las mismas reglas.
async function applyContactClaim(run, claim, config) {
  if (claim?.give !== true) return run;
  const outcome = await gameRegistry.execute('share_contact', { conditionsMet: claim.conditionsMet }, toolContext(run, config), { role: 'engine' });
  return outcome.ok ? outcome.run : run;
}

async function openConversation(run, npc, config) {
  const context = await contextFor(run, npc);
  const relationship = relationshipOf(run, npc.id);
  const opening = context.speak(await ai.npcReply(context(relationship, [], { mode: 'open' }), config));
  const next = await applyReply(startEncounter(run, npc, opening), npc, opening, [], config);
  return keepMeetings(next, npc.id);
}

async function talk(run, body, config) {
  if (body.op === 'start') {
    return unwrap(await gameRegistry.execute('start_conversation', { npcId: String(body.npcId) }, toolContext(run, config)), run);
  }
  const encounter = run.encounter;
  if (!encounter) throw new Error('No estás hablando con nadie.');
  if (body.op === 'leave') return leaveEncounter(run);
  const npc = npcs.get(encounter.npcId);
  const relationship = relationshipOf(run, npc.id);
  const context = await contextFor(run, npc);
  if (body.op === 'say') {
    if (encounter.closed) throw new Error('La conversación terminó. Pulsa Volver.');
    const text = String(body.text ?? '').trim().slice(0, MAX_PLAYER_TEXT);
    if (!text) throw new Error('Escribe qué le dices.');
    const transcript = [...encounter.lines, { who: 'player', text }];
    const reply = context.speak(await ai.npcReply(context(relationship, transcript, { mode: 'reply' }), config));
    let next = await applyReply(addExchange(run, text, reply), npc, reply, transcript, config);
    // El personaje decidió terminar la conversación: su respuesta es la despedida y la reflexión del GM queda pendiente.
    if (reply.end) next = withPendingEvaluation(endEncounter(next, npc, { relationship: relationshipOf(next, npc.id), farewell: null, contactGranted: false, silent: true }), npc, relationshipOf(next, npc.id), next.encounter);
    return next;
  }
  if (body.op === 'end') {
    if (encounter.closed) throw new Error('Ya te despediste.');
    if (!encounter.lines.some((line) => line.who === 'player')) return endEncounter(run, npc, { relationship, farewell: '', contactGranted: false });
    const farewellRaw = await ai.npcReply(context(relationship, encounter.lines, { mode: 'closing' }), config);
    const farewell = context.speak(farewellRaw, encounter.lines);
    const closed = endEncounter(run, npc, { relationship, farewell, contactGranted: contactAllowed(npc, relationship, farewell.contact) });
    const noted = await applyReply(closed, npc, { ...farewellRaw, contact: undefined }, encounter.lines, config);
    return withPendingEvaluation(noted, npc, relationship, encounter);
  }
  throw new Error('Operación de conversación desconocida.');
}

// Acción libre: el motor anota lo escrito y el GM, con la cabecera ambiente, actúa con herramientas (viajar, esperar, conversar con alguien
// presente, `attempt` para lo que aún no tiene mecánica…). Cada herramienta pasa por el mismo handler que los botones; si algo falla, no se guarda nada.
async function performAction(before, input, config) {
  let run = applyAction(before, input, worldData);
  const event = run.eventLog.at(-1);
  if (input.type === 'freeform' && typeof ai.act === 'function') {
    const state = toolContext(run, config);
    const notices = noticesSince(run, { worldData, npcs, from: run.cursors?.gm ?? null, skipLast: 1, max: 8 });
    const header = ambientHeader({ run, worldData, present: presentFor(run), npcs, notices });
    const result = await ai.act(worldPlan(run, worldData, header), { registry: gameRegistry, state }, config);
    if (!result.text) throw new AIError('El GM no devolvió una narración. Tu partida no ha cambiado; puedes reintentar.', 'AI_RESPONSE');
    run = result.run;
    run.cursors = { ...run.cursors, gm: run.eventLog.length }; // lo siguiente que el GM sabrá por avisos es lo que ocurra después de esta llamada
    // `event` es el suceso de la acción libre dentro de la partida resultante (las herramientas clonan la partida en cada paso).
    const logged = run.eventLog.findLast((item) => item.type === 'player_action' && item.time === event.time) ?? run.eventLog.at(-1);
    logged.data = { ...logged.data, response: result.text };
    run.narrative = { text: result.text, time: logged.time };
    if (run.encounter && !before.encounter) run.encounter.lines.unshift({ who: 'narrator', text: result.text });
    return run;
  }
  const narrative = await ai.narrate(before, run, worldData, config, npcs);
  event.data = { ...event.data, response: narrative };
  run.narrative = { text: narrative, time: event.time };
  return run;
}

// --- Chat de NorthLife ------------------------------------------------------------------------------
// Chat en ráfagas: el jugador manda los mensajes que quiera (`send`: se guardan al instante, sin modelo) y con el botón de turno (`turn`) el personaje
// responde con uno o varios mensajes en UNA sola llamada. Un mensaje puede responder a otro concreto (`replyTo`). El motor fija el ritmo de lo que verá
// el cliente (cuánto «escribe» cada mensaje); el modelo solo puede pedir ir más despacio o más rápido.
// `n` numera los mensajes de la conversación (1, 2, 3…): el personaje responde a uno concreto con {re:N}. `offset` = cuántos quedaron fuera de la ventana.
const chatLine = (message, index = 0, offset = 0) => ({ n: offset + index + 1, who: message.who, text: message.text, ...(message.replyTo ? { replyTo: message.replyTo } : {}) });

function chatTarget(run, body) {
  const npc = npcs.get(String(body.npcId));
  const relationship = npc ? relationshipOf(run, npc.id) : null;
  if (!npc || !relationship.added) throw new Error('Solo puedes escribir a quienes tienes en tus contactos.');
  if (run.encounter) throw new Error('Estás en plena conversación. Despídete antes de escribir.');
  return { npc, relationship };
}

// Guarda un mensaje del jugador sin llamar al modelo.
function chatSend(run, body) {
  const { npc } = chatTarget(run, body);
  const text = String(body.text ?? '').trim().slice(0, MAX_PLAYER_TEXT);
  if (!text) throw new Error('Escribe un mensaje.');
  const history = run.chats?.[npc.id] ?? [];
  let waiting = 0; for (let index = history.length - 1; index >= 0 && history[index].who === 'player'; index--) waiting += 1;
  if (waiting >= MAX_UNANSWERED) throw new Error('Ya mandaste muchos mensajes seguidos. Pasa el turno para que respondan.');
  let replyTo = null;
  if (body.replyTo) {
    const quoted = history.find((message) => message.id === String(body.replyTo));
    if (!quoted) throw new Error('Ese mensaje ya no está disponible para responderlo.');
    replyTo = { id: quoted.id, who: quoted.who, text: quoteText(quoted.text) };
  }
  const next = structuredClone(run);
  next.chats = { ...next.chats, [npc.id]: [...history, { id: randomUUID(), who: 'player', text, time: timeKey(run.world), ...(replyTo ? { replyTo } : {}) }].slice(-80) };
  next.updatedAt = new Date().toISOString();
  return next;
}

// Pasa el turno: el personaje lee lo que el jugador mandó desde su último mensaje y responde.
async function chatTurn(run, body, config) {
  const { npc, relationship } = chatTarget(run, body);
  const history = run.chats?.[npc.id] ?? [];
  if (history.at(-1)?.who !== 'player') throw new Error('Escribe un mensaje antes de pasar el turno.');
  const context = await contextFor(run, npc);
  const recent = history.slice(-24);
  const reply = await ai.npcReply(context(relationship, recent.map((message, index) => chatLine(message, index, history.length - recent.length)), { mode: 'chat' }), config);
  let next = structuredClone(run);
  next.world = advanceTime(next.world, 1);
  const burst = reply.messages?.length ? reply.messages : [{ text: stripMarks(reply.say), pace: null }];
  const at = timeKey(next.world);
  // {re:N}: el personaje responde a un mensaje concreto (suyo o del jugador). Un número que no existe se ignora.
  const answers = burst.map((message) => {
    const target = Number.isInteger(message.re) ? history[message.re - 1] : null;
    return { id: randomUUID(), who: 'npc', text: message.text, time: at, typingMs: typingMs(message.text, message.pace), ...(target ? { replyTo: { id: target.id, who: target.who, text: quoteText(target.text) } } : {}) };
  });
  next.chats = { ...next.chats, [npc.id]: [...history, ...answers].slice(-80) };
  next.updatedAt = new Date().toISOString();
  return applyReply(next, npc, reply, history.map((message, index) => chatLine(message, index)), config);
}

// La publicación o respuesta del jugador se guarda AL INSTANTE; la reacción de la red (respuestas, likes, reposts) la genera el modelo en segundo
// plano y llega después, con la misma validación de siempre. Queda pendiente en la partida (así sobrevive a un reinicio) y se reintenta al consultarla
// si falla (3 intentos; luego la publicación se queda sin reacciones). Si el proveedor no implementa el prompt social, la publicación se queda sola.
const MAX_REACTION_ATTEMPTS = 3;
const reacting = new Set();
function queueReaction(run, post, action, since, expected) {
  if (typeof ai.socialReply !== 'function') return run;
  run.pendingReactions = [...(run.pendingReactions ?? []), { id: randomUUID(), postId: post.id, action, since, expected, attempts: 0 }].slice(-6);
  return run;
}

function scheduleReactions(run) {
  for (const item of run.pendingReactions ?? []) {
    if (reacting.has(item.id)) continue;
    reacting.add(item.id);
    enqueue(run.id, 'reacción', async () => { try { await runReaction(run.id, item.id); } finally { reacting.delete(item.id); } });
  }
}

async function runReaction(runId, itemId) {
  const run = await loadGame(runId);
  const item = run.pendingReactions?.find((entry) => entry.id === itemId);
  if (!item) return;
  // Carga la partida actual, quita lo pendiente y aplica el cambio; si otra operación ya lo resolvió (o borraron la publicación), no hace nada.
  const settle = (change) => whenFree(runId, async () => {
    const current = await loadGame(runId);
    const entry = current.pendingReactions?.find((candidate) => candidate.id === itemId);
    if (!entry) return;
    let next = structuredClone(current);
    next.pendingReactions = next.pendingReactions.filter((candidate) => candidate.id !== itemId);
    next = change(next, entry) ?? next;
    if (!next.pendingReactions.length) delete next.pendingReactions;
    next.updatedAt = new Date().toISOString();
    await store.saveRun(settleCommitments(next));
  });
  const post = run.social?.posts?.find((candidate) => candidate.id === item.postId);
  if (!post) return settle(() => null);
  try {
    const config = await settings.require();
    const raw = await ai.socialReply(socialContext(run, 'reply', { publicacion: threadFor(post, minutesOfWorld(run.world)), accionDelJugador: { ...item.action, hora: keyOfMinutes(item.since).slice(-5) }, respuestasEsperadas: item.expected }), config);
    await settle((next) => applyReactions(next, item.postId, raw, socialOptions(), item.since));
  } catch (error) {
    await settle((next, entry) => {
      if (entry.attempts + 1 < MAX_REACTION_ATTEMPTS) next.pendingReactions.push({ ...entry, attempts: entry.attempts + 1 });
      return next;
    }).catch(() => {});
    throw error;
  }
}

async function api(request, response, pathname) {
  if (pathname.startsWith('/api/runs')) await socialCatalog.refresh();
  // Si el cliente cancela (botón detener) o se desconecta, se aborta la llamada a la IA y no se guarda nada.
  const controller = new AbortController();
  response.on('close', () => { if (!response.writableEnded) controller.abort(); });
  const requireConfig = async () => ({ ...(await settings.require()), signal: controller.signal });
  // Al guardar se evalúan las promesas vencidas: el reloj pudo avanzar durante la operación.
  const save = async (run) => { controller.signal.throwIfAborted(); await store.saveRun(settleCommitments(run)); };
  // Consultar la partida también reanuda una evaluación pendiente (tras reiniciar el servidor o tras un fallo).
  const sendRun = async (status, run) => { scheduleEvaluation(run); scheduleReactions(run); return sendJson(response, status, await publicRun(run, request.headers['x-hom-dev'] === '1')); };
  if (request.method === 'GET' && pathname === '/api/ai/settings') return sendJson(response, 200, await settings.status());
  if (request.method === 'POST' && pathname === '/api/ai/models') {
    const key = await settings.key(await readBody(request));
    return sendJson(response, 200, { models:await ai.models(key) });
  }
  if (pathname === '/api/ai/settings' && request.method === 'POST') {
    const input = await readBody(request);
    return exclusive('settings', async () => {
      const candidate = await settings.candidate(input);
      // Guardar no llama al modelo: así se cambia de modelo al instante para comparar respuestas. `verify: true` comprueba la conexión.
      if (input.verify === true) await ai.verify(candidate);
      return sendJson(response, 200, await settings.save(candidate, { verified: input.verify === true }));
    });
  }
  if (pathname === '/api/ai/settings' && request.method === 'DELETE') {
    return exclusive('settings', async () => sendJson(response, 200, await settings.clear()));
  }
  // Sonda de modelos (desarrollo): compara tools nativas, protocolo JSON y tiempos de uno o varios modelos. Gasta unos pocos miles de tokens por modelo.
  if (request.method === 'POST' && pathname === '/api/dev/ai/probe') {
    if (request.headers['x-hom-dev'] !== '1') throw new AIError('Las herramientas de desarrollo están desactivadas.', 'DEV_DISABLED', 403);
    const body = await readBody(request);
    return exclusive('probe', async () => {
      if (typeof ai.complete !== 'function') throw new Error('Este proveedor no admite sondas.');
      const config = await requireConfig();
      const models = (Array.isArray(body.models) ? body.models : []).map((item) => String(item).trim()).filter(isModelId);
      return sendJson(response, 200, await runProbe(ai, config, { models, ...(Array.isArray(body.tests) ? { tests: body.tests.map(String) } : {}) }));
    });
  }
  // Protocolo de herramientas del modelo guardado (auto | native | json): lo que midió la sonda manda sobre lo que anuncie el catálogo.
  if (pathname === '/api/dev/ai/toolmode' && ['GET', 'POST'].includes(request.method)) {
    if (request.headers['x-hom-dev'] !== '1') throw new AIError('Las herramientas de desarrollo están desactivadas.', 'DEV_DISABLED', 403);
    if (typeof settings.toolMode !== 'function') throw new Error('Este almacenamiento no admite el protocolo de herramientas.');
    const body = request.method === 'POST' ? await readBody(request) : {};
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : (await settings.require()).model;
    return sendJson(response, 200, request.method === 'POST' ? await settings.setToolMode(model, String(body.mode)) : await settings.toolMode(model));
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
  const media = pathname.match(/^\/api\/runs\/([0-9a-f-]{36})\/media\/(avatar|banner)$/i);
  if (media && request.method === 'GET') {
    const file = profileMedia(await loadGame(media[1]), media[2]);
    if (!file) return sendJson(response, 404, { error: 'Sin imagen.' });
    response.writeHead(200, { 'content-type': file.mime, 'cache-control': 'private, max-age=31536000, immutable' });
    return response.end(file.buffer);
  }
  const match = pathname.match(/^\/api\/runs\/([0-9a-f-]{36})(?:\/(action|posts|social|talk|dev|contacts|chat|slot))?$/i);
  if (!match) return sendJson(response, 404, { error: 'Ruta no encontrada.' });
  const [, id, operation] = match;
  if (request.method === 'DELETE' && !operation) {
    return exclusive(id, async () => {
      if (typeof store.deleteRun !== 'function') throw new Error('Este almacenamiento no permite borrar partidas.');
      await store.loadRun(id);
      await store.deleteRun(id);
      return sendJson(response, 200, { deleted: id });
    });
  }
  // Gestión de ranuras: renombrar y duplicar (útil para probar sin perder el punto de partida).
  if (request.method === 'POST' && operation === 'slot') {
    const body = await readBody(request);
    return exclusive(id, async () => {
      const run = await store.loadRun(id);
      if (body.op === 'rename') {
        run.title = String(body.title ?? '').trim().slice(0, 40);
        await store.saveRun(run);
        return sendJson(response, 200, { id, title: run.title });
      }
      if (body.op === 'duplicate') {
        const copy = structuredClone(run);
        const now = new Date().toISOString();
        copy.id = crypto.randomUUID(); copy.createdAt = now; copy.updatedAt = now;
        copy.title = `${run.title || run.player.name} (copia)`.slice(0, 40);
        await store.saveRun(copy);
        return sendJson(response, 201, { id: copy.id, title: copy.title });
      }
      throw new Error('Operación de partida desconocida.');
    });
  }
  if (request.method === 'GET' && !operation) return sendRun(200, await loadGame(id));
  if (request.method === 'POST' && operation === 'action') {
    const input = await readBody(request);
    return exclusive(id, async () => {
      const config = await requireConfig();
      const run = await performAction(await loadGame(id), input, config);
      await save(run);
      scheduleFeed(run);
      return sendRun(200, run);
    });
  }
  if (request.method === 'POST' && operation === 'chat') {
    const body = await readBody(request);
    if (body.op !== 'send') await jobs.get(id); // el personaje primero recuerda la conversación anterior
    return exclusive(id, async () => {
      const config = await requireConfig();
      const game = await loadGame(id);
      // `send`: guarda un mensaje (sin modelo) · `turn`: el personaje responde · sin `op`: las dos cosas en una petición
      const run = body.op === 'send' ? chatSend(game, body) : body.op === 'turn' ? await chatTurn(game, body, config) : await chatTurn(chatSend(game, body), body, config);
      await save(run);
      return sendRun(200, run);
    });
  }
  if (request.method === 'POST' && operation === 'dev') {
    if (request.headers['x-hom-dev'] !== '1') throw new AIError('Las herramientas de desarrollo están desactivadas.', 'DEV_DISABLED', 403);
    const body = await readBody(request);
    return exclusive(id, async () => {
      const config = await requireConfig();
      const run = await devOperation(await loadGame(id), body, config);
      await save(run);
      return sendRun(200, run);
    });
  }
  if (request.method === 'POST' && operation === 'contacts') {
    const body = await readBody(request);
    return exclusive(id, async () => {
      // Sin pistas: un usuario inexistente y uno aún desconocido dan el mismo mensaje.
      const run = addContact(await loadGame(id), findNpcByHandle(npcs, body.handle));
      await save(run);
      return sendRun(200, run);
    });
  }
  if (request.method === 'POST' && operation === 'talk') {
    const body = await readBody(request);
    if (body.op === 'start') await jobs.get(id); // el personaje primero recuerda la conversación anterior
    return exclusive(id, async () => {
      const config = await requireConfig();
      const run = await talk(await loadGame(id), body, config);
      await save(run);
      return sendRun(200, run);
    });
  }
  // El jugador publica: la red reacciona en la misma petición (si la IA falla, no se publica nada).
  if (request.method === 'POST' && operation === 'posts') {
    const body = await readBody(request);
    return exclusive(id, async () => {
      await requireConfig(); // las acciones exigen una conexión configurada, aunque la reacción se genere después
      const { run: published, post } = publishPlayerPost(await loadGame(id), body.text);
      const run = queueReaction(published, post, { tipo: 'publicacion', texto: post.text }, post.minutes, expectedReplies(playerPopularity(published.player)));
      await save(run);
      scheduleFeed(run, REFRESH_GAP); // si hace más de 2 h que no se genera, el feed se renueva también (en segundo plano)
      return sendRun(200, run);
    });
  }
  if (request.method === 'POST' && operation === 'social') {
    const body = await readBody(request, 1_200_000);
    return exclusive(id, async () => {
      if (body.op === 'profile') { const run = saveProfile(await loadGame(id), body, socialOptions()); await save(run); return sendRun(200, run); }
      if (body.op === 'repost') { const run = toggleRepost(await loadGame(id), String(body.postId ?? '')); await save(run); return sendRun(200, run); }
      if (body.op === 'like') { const run = toggleLike(await loadGame(id), String(body.postId ?? ''), body.replyId ? String(body.replyId) : null); await save(run); return sendRun(200, run); }
      if (body.op === 'read') { const run = markNotificationsRead(await loadGame(id)); await save(run); return sendRun(200, run); }
      if (body.op === 'reply') {
        await requireConfig();
        const { run: published, post, reply, target } = publishPlayerReply(await loadGame(id), String(body.postId ?? ''), body.text, body.replyTo ? String(body.replyTo) : null);
        const run = queueReaction(published, post, { tipo: 'respuesta', texto: reply.text, aQuien: (target ?? post).handle }, reply.minutes, { min: 1, max: 3 });
        await save(run);
        scheduleFeed(run, REFRESH_GAP);
        return sendRun(200, run);
      }
      throw new Error('Operación social desconocida.');
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
  if (debug) {
    const started = Date.now();
    response.on('finish', () => { if (request.url.startsWith('/api/') || response.statusCode >= 400) console.log(`${request.method} ${request.url} ${response.statusCode} ${Date.now() - started}ms`); });
  }
  try {
    const host = request.headers.host || '';
    const url = new URL(request.url, `http://${host}`);
    if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new AIError('Abre el juego desde localhost.', 'LOCAL_ONLY', 403);
    const pathname = url.pathname;
    if (pathname.startsWith('/api/')) {
      if (request.headers['sec-fetch-site'] === 'cross-site' || (request.headers.origin && request.headers.origin !== `http://${host}`)) throw new AIError('Origen de solicitud no permitido.', 'INVALID_ORIGIN', 403);
      if (['POST','DELETE','PUT','PATCH'].includes(request.method) && !request.headers['content-type']?.startsWith('application/json')) throw new AIError('Se requiere una solicitud JSON.', 'INVALID_REQUEST', 415);
      await api(request, response, pathname);
    }
    else await staticFile(response, pathname);
  } catch (error) {
    const status = error.status || (error.code === 'ENOENT' ? 404 : 400);
    const message = error instanceof SyntaxError ? 'Solicitud JSON inválida.' : error.message;
    if (debug && status !== 404) console.error(`[error] ${request.method} ${request.url} -> ${status} ${error.code || ''} ${error.message}`);
    if (!response.headersSent) sendJson(response, status, { error:message, code:error.code || 'INVALID_REQUEST' });
  }
});
server.idle = async () => { while (jobs.size) await Promise.all([...jobs.values()]); };
return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createAppServer().listen(port, '127.0.0.1', () => {
    console.log(`HOM RPG disponible en http://localhost:${port}`);
  });
}
