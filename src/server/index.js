import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRun, setPrologue, applyAction, startEncounter, addExchange, endEncounter, rewindEncounter, replaceLastNpcLine, reapplyEnding, setWorldTime, addContact, grantContact, leaveEncounter, MAX_PLAYER_TEXT } from './game/run.js';
import { advanceTime, timeKey } from './game/clock.js';
import { validateAgreements, addCommitments, applyUpdates, settleCommitments, keepMeetings, meetingNpcIds, commitmentsFor } from './game/commitments.js';
import { validateNpcCard, fromForeignCard, parsePngCard, savePortrait, listPortraits, saveNpcCard, imageKind, removePortrait, renamePortrait, normalizeEmotion } from './game/cards.js';
import { loadNpcs, presentNpcs, publicNpc, relationshipOf, affinityOf, attitudeOf, validateEvaluation, validateFacts, scheduleFor, minutesOfWorld, applyEvaluation, debugView, temporalContext, timedNotes, timedHistory, contactAllowed, findNpcByHandle, parseSpeech, stripMarks, contactInfo, stickyFrom } from './game/npcs.js';
import { createNanoGPT, AIError } from './ai/provider.js';
import { createSettingsStore } from './ai/settings.js';
import { createPromptStore } from './ai/promptStore.js';
import { KINDS, kindNames, defaultPreset, normalizePreset, compose, importSillyTavern } from './ai/composer.js';
import { characterPlan, evaluationPlan, narrationPlan, chatsPlan, socialPlan } from './ai/plans.js';
import { feedDue, applyGeneratedPosts, applyReactions, publishPlayerPost, publishPlayerReply, toggleLike, markNotificationsRead, socialView, socialInput, threadFor, migrateSocial } from './game/social.js';
import { saveRun, loadRun, listRuns, deleteRun } from './saves/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicDir = path.join(root, 'public');
const assetDir = path.join(root, 'assets');
const clientDir = path.join(root, 'src/client');
const worldData = JSON.parse(await readFile(path.join(root, 'data/canon/locations/porta_magna.json'), 'utf8'));
const npcDir = path.join(root, 'data/canon/npcs');
const npcs = await loadNpcs(npcDir);
// Cuentas de la red social con popularidad fija (canon): p. ej. @RexNova. Todo lo demás lo inventa el modelo y lo valida el motor.
const socialSeeds = await readFile(path.join(root, 'data/canon/social/accounts.json'), 'utf8').then((raw) => JSON.parse(raw).accounts ?? []).catch(() => []);
const port = Number(process.env.PORT) || 3000;

const clientFiles = new Set(['/index.html', '/app.js', '/core.js', '/game.js', '/devtools.js', '/prompteditor.js', '/northlife.js', '/scenes.js', '/styles.css', '/game.css']);
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

export function createAppServer({ prompts = createPromptStore(), ai = createNanoGPT(fetch, { prompts }), settings = createSettingsStore(), store = { saveRun, loadRun, listRuns, deleteRun } } = {}) {
const active = new Set();
async function exclusive(key, operation) {
  if (active.has(key)) throw new AIError('Ya hay una petición en curso. Espera a que termine.', 'REQUEST_BUSY', 409);
  active.add(key);
  try { return await operation(); } finally { active.delete(key); }
}

// Lo que el cliente ve de una Run: las impresiones ocultas de los NPC solo salen en modo desarrollador.
async function publicRun(run, dev = false) {
  const toPublic = async (npc) => ({ ...publicNpc(npc), portraits: await listPortraits(assetDir, npc.id) });
  const relationships = Object.fromEntries(Object.entries(run.relationships ?? {}).map(([id, item]) => [id, dev ? debugView(relationshipOf(run, id)) : { met: item.met, contact: item.contact, added: item.added === true, encounters: item.encounters }]));
  const encounterNpc = run.encounter ? await toPublic(npcs.get(run.encounter.npcId)) : null;
  return {
    ...run, relationships, encounterNpc, social: socialView(run, { dev, seeds: socialSeeds }),
    commitments: (run.commitments ?? []).map((item) => ({ ...item, npcName: npcs.get(item.npcId)?.name ?? item.npcId })),
    presence: await Promise.all(presentFor(run).map(toPublic)),
    sharedContacts: [...npcs.values()].filter((npc) => run.relationships?.[npc.id]?.contact).map((npc) => ({ id: npc.id, name: npc.name, handle: npc.contact.handle, added: run.relationships[npc.id].added === true })),
    contacts: await Promise.all([...npcs.values()].filter((npc) => run.relationships?.[npc.id]?.added).map(toPublic))
  };
}

// Datos para el prompt social (cuentas, contactos, publicaciones recientes) y opciones de validación del motor.
const socialOptions = () => ({ npcs, seeds: socialSeeds });
const socialContext = (run, mode, extra = {}) => socialInput(run, mode, { npcs, seeds: socialSeeds, places: worldData.locations.map(({ name }) => name), ahora: temporalContext({ encounters: 0, notes: [], history: [] }, run.world).ahora, extra });

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

async function devOperation(run, body, config) {
  if (body.op === 'restart') {
    const { run: base, npcId } = rewindEncounter(run);
    if (body.reopen === false) return base;
    const npc = npcs.get(npcId);
    const context = await contextFor(base, npc);
    const relationship = relationshipOf(base, npc.id);
    const opening = context.speak(await ai.npcReply(context(relationship, [], { mode: 'open' }), config));
    return startEncounter(base, npc, opening, contactAllowed(npc, relationship, opening.contact) ? npc : null);
  }
  if (body.op === 'regen') {
    if (run.encounter?.closed && run.lastEncounter) {
      const source = run.lastEncounter;
      const npc = npcs.get(source.npcId);
      const context = await contextFor(run, npc);
      const midGrant = source.lines.some((line) => line.kind === 'contact');
      const original = { ...source.origin.relationship, ...(midGrant ? { contact: true } : {}) };
      const result = await evaluateAndClose(run, npc, original, source.lines, source.startedAt, config, context);
      return reapplyEnding(run, npc, result);
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
      return replaceLastNpcLine(run, reply, contactAllowed(npc, relationship, reply.contact) ? npc : null);
    }
    const last = run.eventLog.at(-1);
    if (last?.type === 'conversation_ended' && run.lastEncounter) {
      const source = run.lastEncounter;
      const npc = npcs.get(source.npcId);
      const context = await contextFor(run, npc);
      const midGrant = source.lines.some((line) => line.kind === 'contact');
      const original = { ...source.origin.relationship, ...(midGrant ? { contact: true } : {}) };
      const result = await evaluateAndClose(run, npc, original, source.lines, source.startedAt, config, context);
      return reapplyEnding(run, npc, result);
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
  if (body.op === 'social') {
    if (typeof ai.socialPosts !== 'function') throw new Error('Este proveedor no genera publicaciones.');
    return applyGeneratedPosts(run, await ai.socialPosts(socialContext(run, 'post'), config), socialOptions());
  }
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
    autos: Object.entries(spec.autos).map(([key, auto]) => ({ key, label: auto.label, description: auto.description, role: auto.role ?? 'system', locked: auto.locked === true, special: auto.special === true })),
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
    if (mode === 'narration' || mode === 'action') return narrationPlan(mode, run, run, worldData, here.map((person) => ({ id: person.id, nombre: person.name, rol: person.role })));
    if (mode === 'chats') return chatsPlan({ ahora, playerName: run.player.name, locations: worldData.locations.map(({ id, name }) => ({ id, nombre: name })), chats: [{ npcId: npc.id, name: npc.name, lines: withPlayer(run.chats?.[npc.id]).slice(-6), commitments: commitmentsFor(run, npc.id, { withIds: true }) }] });
    const context = await contextFor(run, npc);
    return evaluationPlan(context(relationshipOf(run, npc.id), withPlayer(run.encounter?.lines ?? run.lastEncounter?.lines), { commitments: context.gmCommitments, locations: context.locations }));
  }
  if (mode === 'reply') {
    const social = migrateSocial(run.social, run.player);
    const post = social.posts.find((item) => item.minutes <= minutesOfWorld(run.world)) ?? { id: 'ejemplo', handle: '@ejemplo', text: '(aquí irá la publicación)', time: '', replies: [], minutes: 0 };
    return socialPlan(socialContext(run, 'reply', { publicacion: threadFor(post, minutesOfWorld(run.world)), accionDelJugador: { tipo: 'respuesta', texto: '(aquí irá lo que escriba el jugador)', aQuien: post.handle } }));
  }
  return socialPlan(socialContext(run, 'post'));
}

async function promptRoutes(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/dev/prompts') return sendJson(response, 200, { kinds: kindNames.map(promptInfo) });
  if (request.method === 'GET' && pathname === '/api/dev/prompts/log') return sendJson(response, 200, { entries: prompts.log?.() ?? [] });
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
    const run = await store.loadRun(String(body.runId ?? ''));
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

async function openConversation(run, npc, config) {
  const context = await contextFor(run, npc);
  const relationship = relationshipOf(run, npc.id);
  const opening = context.speak(await ai.npcReply(context(relationship, [], { mode: 'open' }), config));
  const next = startEncounter(run, npc, opening, contactAllowed(npc, relationship, opening.contact) ? npc : null);
  return keepMeetings(next, npc.id);
}

async function talk(run, body, config) {
  if (body.op === 'start') {
    const npc = npcs.get(String(body.npcId));
    if (run.encounter) throw Object.assign(new Error('Ya estás en una conversación.'), { status: 409 });
    if (!npc || !presentFor(run).includes(npc)) throw new Error('Esa persona no está aquí ahora.');
    return openConversation(run, npc, config);
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
    return addExchange(run, text, reply, contactAllowed(npc, relationship, reply.contact) ? npc : null);
  }
  if (body.op === 'end') {
    if (encounter.closed) throw new Error('Ya te despediste.');
    if (!encounter.lines.some((line) => line.who === 'player')) return endEncounter(run, npc, { relationship, farewell: '', contactGranted: false });
    const outcome = await evaluateAndClose(run, npc, relationship, encounter.lines, encounter.startedAt, config, context);
    return recordOutcome(endEncounter(run, npc, outcome), npc.id, outcome);
  }
  throw new Error('Operación de conversación desconocida.');
}

// Acción libre: el GM narra y, si el jugador busca hablar con alguien presente, abre el encuentro sin pulsar «Hablar con».
async function performAction(before, input, config) {
  let run = applyAction(before, input, worldData);
  const background = startBackground(run, config);
  const event = run.eventLog.at(-1);
  if (input.type === 'freeform' && typeof ai.narrateFreeform === 'function') {
    const here = presentFor(run);
    const result = await ai.narrateFreeform(before, run, worldData, config, here.map((npc) => ({ id: npc.id, nombre: npc.name, rol: npc.role })));
    event.data = { ...event.data, response: result.text };
    run.narrative = { text: result.text, time: event.time };
    const npc = result.talkTo ? here.find((person) => person.id === result.talkTo) : null;
    if (npc) {
      run = await openConversation(run, npc, config);
      run.encounter.lines.unshift({ who: 'narrator', text: result.text });
    }
    return (await background)(run);
  }
  const narrative = await ai.narrate(before, run, worldData, config);
  event.data = { ...event.data, response: narrative };
  run.narrative = { text: narrative, time: event.time };
  return (await background)(run);
}

// --- Chat de NorthLife ------------------------------------------------------------------------------
const AGREEMENT_HINT = /ma[ñn]ana|hoy|luego|esta noche|\d{1,2}\s*(:|h\b|hrs|pm|am)|a las|nos vemos|quedamos|cita|te traigo|te llevo|prometo|promet|vengo|ven\b|trae\b|vuelvo|me llamo|mi nombre|soy\b/i;

async function chatWith(run, body, config) {
  const npc = npcs.get(String(body.npcId));
  const relationship = npc ? relationshipOf(run, npc.id) : null;
  if (!npc || !relationship.added) throw new Error('Solo puedes escribir a quienes tienes en tus contactos.');
  if (run.encounter) throw new Error('Estás en plena conversación. Despídete antes de escribir.');
  const text = String(body.text ?? '').trim().slice(0, MAX_PLAYER_TEXT);
  if (!text) throw new Error('Escribe un mensaje.');
  const history = run.chats?.[npc.id] ?? [];
  const sent = { who: 'player', text, time: timeKey(run.world) };
  const context = await contextFor(run, npc);
  const reply = await ai.npcReply(context(relationship, [...history, sent].slice(-24), { mode: 'chat' }), config);
  const next = structuredClone(run);
  next.world = advanceTime(next.world, 1);
  const answered = { who: 'npc', text: stripMarks(reply.say), time: timeKey(next.world) };
  next.chats = { ...next.chats, [npc.id]: [...history, sent, answered].slice(-80) };
  next.updatedAt = new Date().toISOString();
  return next;
}

// --- Actualización de fondo del GM ------------------------------------------------------------------------
// Chats con datos relevantes y publicaciones de NorthLife NO hacen llamadas por su cuenta: se procesan por lotes,
// en paralelo con la narración, cuando el jugador actúa (moverse, esperar, acción libre…). Un solo viaje para todo.
function startBackground(run, config) {
  const idsOf = () => worldData.locations.map(({ id }) => id);
  const pending = Object.entries(run.chats ?? {}).map(([npcId, messages]) => ({ npcId, total: messages.length, lines: messages.slice(run.chatSeen?.[npcId] ?? 0) })).filter((item) => item.lines.length && npcs.has(item.npcId));
  const worth = pending.filter((item) => AGREEMENT_HINT.test(item.lines.map((line) => line.text).join(' ')));
  const chatCall = worth.length && typeof ai.extractFromChats === 'function'
    ? ai.extractFromChats({
      ahora: temporalContext({ encounters: 0, notes: [], history: [] }, run.world).ahora, playerName: run.player.name, locations: worldData.locations.map(({ id, name }) => ({ id, nombre: name })),
      chats: worth.map((item) => ({ npcId: item.npcId, name: npcs.get(item.npcId).name, lines: item.lines, commitments: commitmentsFor(run, item.npcId, { withIds: true }) }))
    }, config).catch(() => null)
    : Promise.resolve(null);

  // NorthLife: una o dos veces al día de juego, el prompt social genera varias publicaciones (con hora, likes y respuestas).
  const socialCall = typeof ai.socialPosts === 'function' && feedDue(run)
    ? ai.socialPosts(socialContext(run, 'post'), config).catch(() => null)
    : Promise.resolve(null);

  // Devuelve la función que vuelca los resultados en la partida final.
  return Promise.all([chatCall, socialCall]).then(([results, posts]) => (next) => {
    for (const item of pending) {
      const result = results?.find?.((entry) => entry?.npcId === item.npcId);
      if (worth.includes(item) && !Array.isArray(results)) continue; // la llamada falló: se reintenta en la próxima acción
      if (result) {
        const lastTime = item.lines.at(-1)?.time ?? '';
        const when = /^DAY_(\d+)_(\d{2}):(\d{2})$/.exec(lastTime);
        const worldAt = when ? { day: Number(when[1]), hour: Number(when[2]), minute: Number(when[3]) } : next.world;
        const relationship = relationshipOf(next, item.npcId);
        const { relationship: updated } = applyEvaluation(relationship, { notes: [], summary: '', ...validateFacts(result, item.lines) }, lastTime);
        next.relationships = { ...next.relationships, [item.npcId]: updated };
        recordOutcome(next, item.npcId, { agreements: validateAgreements(result.agreements, item.lines, worldAt, idsOf()), updates: result.updates, lines: item.lines });
      }
      next.chatSeen = { ...next.chatSeen, [item.npcId]: item.total };
    }
    return Array.isArray(posts) ? applyGeneratedPosts(next, posts, socialOptions()) : next;
  });
}

// Reacción de la red a lo que el jugador acaba de publicar o responder. Si el proveedor no la implementa, la publicación se queda sola.
async function react(run, post, action, config) {
  if (typeof ai.socialReply !== 'function') return run;
  const now = minutesOfWorld(run.world);
  const raw = await ai.socialReply(socialContext(run, 'reply', { publicacion: threadFor(post, now), accionDelJugador: action }), config);
  return applyReactions(run, post.id, raw, socialOptions());
}

async function api(request, response, pathname) {
  // Si el cliente cancela (botón detener) o se desconecta, se aborta la llamada a la IA y no se guarda nada.
  const controller = new AbortController();
  response.on('close', () => { if (!response.writableEnded) controller.abort(); });
  const requireConfig = async () => ({ ...(await settings.require()), signal: controller.signal });
  // Al guardar se evalúan las promesas vencidas: el reloj pudo avanzar durante la operación.
  const save = async (run) => { controller.signal.throwIfAborted(); await store.saveRun(settleCommitments(run)); };
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
  if (request.method === 'GET' && !operation) return sendRun(200, await store.loadRun(id));
  if (request.method === 'POST' && operation === 'action') {
    const input = await readBody(request);
    return exclusive(id, async () => {
      const config = await requireConfig();
      const run = await performAction(await store.loadRun(id), input, config);
      await save(run);
      return sendRun(200, run);
    });
  }
  if (request.method === 'POST' && operation === 'chat') {
    const body = await readBody(request);
    return exclusive(id, async () => {
      const config = await requireConfig();
      const run = await chatWith(await store.loadRun(id), body, config);
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
  if (request.method === 'POST' && operation === 'contacts') {
    const body = await readBody(request);
    return exclusive(id, async () => {
      // Sin pistas: un usuario inexistente y uno aún desconocido dan el mismo mensaje.
      const run = addContact(await store.loadRun(id), findNpcByHandle(npcs, body.handle));
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
  // El jugador publica: la red reacciona en la misma petición (si la IA falla, no se publica nada).
  if (request.method === 'POST' && operation === 'posts') {
    const body = await readBody(request);
    return exclusive(id, async () => {
      const config = await requireConfig();
      const { run: published, post } = publishPlayerPost(await store.loadRun(id), body.text);
      const run = await react(published, post, { tipo: 'publicacion', texto: post.text }, config);
      await save(run);
      return sendRun(200, run);
    });
  }
  if (request.method === 'POST' && operation === 'social') {
    const body = await readBody(request);
    return exclusive(id, async () => {
      if (body.op === 'like') { const run = toggleLike(await store.loadRun(id), String(body.postId ?? ''), body.replyId ? String(body.replyId) : null); await save(run); return sendRun(200, run); }
      if (body.op === 'read') { const run = markNotificationsRead(await store.loadRun(id)); await save(run); return sendRun(200, run); }
      if (body.op === 'reply') {
        const config = await requireConfig();
        const { run: published, post, reply, target } = publishPlayerReply(await store.loadRun(id), String(body.postId ?? ''), body.text, body.replyTo ? String(body.replyTo) : null);
        const run = await react(published, post, { tipo: 'respuesta', texto: reply.text, aQuien: (target ?? post).handle }, config, reply.id);
        await save(run);
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
