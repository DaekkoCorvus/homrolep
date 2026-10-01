import { randomUUID } from 'node:crypto';
import { advanceTime, timeKey } from './clock.js';

const GENDERS = new Set(['man', 'woman', 'custom']);

export function createRun(input = {}) {
  const name = String(input.name ?? '').trim().slice(0, 60);
  const age = Number(input.age);
  if (!name) throw new Error('El nombre es obligatorio.');
  if (!Number.isInteger(age) || age < 13 || age > 120) throw new Error('La edad debe estar entre 13 y 120 años.');
  const gender = String(input.gender ?? '');
  if (!GENDERS.has(gender)) throw new Error('Selecciona un género.');
  const genderCustom = String(input.genderCustom ?? '').trim().slice(0, 40);
  if (gender === 'custom' && !genderCustom) throw new Error('Cuéntanos cómo describes tu género.');
  if (input.race !== 'human') throw new Error('Por ahora solo se puede comenzar como humano.');
  const appearance = String(input.appearance ?? '').trim().slice(0, 300);
  const origin = String(input.origin ?? '').trim().slice(0, 600);
  const now = new Date().toISOString();
  const run = {
    id: randomUUID(), version: 1, createdAt: now, updatedAt: now,
    player: {
      name, age,
      gender, genderCustom: gender === 'custom' ? genderCustom : '', race: 'human', appearance, origin,
      occupation: null, aspiration: null,
      money: 60,
      reputation: 0,
      locationId: 'apartment'
    },
    world: { day: 1, hour: 8, minute: 0, cityId: 'porta_magna' },
    social: { posts: [] }, missions: [], relationships: {}, knowledge: [], eventLog: [], prologue: null
  };
  run.eventLog.push({ time: timeKey(run.world), type: 'run_started', data: { cityId: 'porta_magna' } });
  return run;
}

export function setPrologue(run, proposal, worldData) {
  const next = structuredClone(run);
  const allowed = worldData.locations.find((location) => location.id === 'station')
    ?? worldData.locations.find((location) => location.id === proposal.locationId);
  const locationId = allowed?.id ?? 'apartment';
  const text = String(proposal.text ?? '').trim().slice(0, 3000);
  if (!text) throw new Error('No se pudo crear el prólogo.');
  next.player.locationId = locationId;
  next.prologue = { text, locationId, source: proposal.source === 'ai' ? 'ai' : 'local' };
  next.eventLog.push({ time: timeKey(next.world), type: 'prologue_created', data: { locationId } });
  next.updatedAt = new Date().toISOString();
  return next;
}

export function applyAction(run, action, worldData) {
  if (run.encounter) throw Object.assign(new Error('Estás en plena conversación. Despídete antes de hacer otra cosa.'), { code: 'ENCOUNTER_ACTIVE' });
  const next = structuredClone(run);
  const type = String(action.type ?? 'freeform');
  let minutes = 10;
  let event;

  if (type === 'travel') {
    const destination = worldData.locations.find((place) => place.id === action.locationId);
    if (!destination) throw new Error('Ubicación desconocida.');
    if (destination.id === next.player.locationId) throw new Error('Ya estás en esa ubicación.');
    const from = next.player.locationId;
    minutes = destination.travelMinutes;
    next.player.locationId = destination.id;
    event = { type: 'location_changed', from, to: destination.id };
  } else if (type === 'wait') {
    minutes = Math.min(8 * 60, Math.max(5, Number(action.minutes) || 30));
    event = { type: 'time_waited', data: { minutes } };
  } else if (type === 'sleep') {
    minutes = 8 * 60;
    event = { type: 'slept', data: { minutes } };
  } else if (type === 'work') {
    if (next.player.occupation !== 'worker') throw new Error('Aún no tienes un trabajo. Puedes descubrirlo durante la historia.');
    minutes = 6 * 60;
    next.player.money += 60;
    event = { type: 'worked', data: { earned: 60 } };
  } else {
    const text = String(action.text ?? '').trim().slice(0, 500);
    if (!text) throw new Error('Escribe una acción.');
    event = { type: 'player_action', data: { text } };
  }

  next.world = advanceTime(next.world, minutes);
  next.updatedAt = new Date().toISOString();
  next.eventLog.push({ time: timeKey(next.world), ...event });
  return next;
}

export function addPost(run, text) {
  if (run.encounter) throw Object.assign(new Error('Estás en plena conversación. Despídete antes de hacer otra cosa.'), { code: 'ENCOUNTER_ACTIVE' });
  const clean = String(text ?? '').trim().slice(0, 280);
  if (!clean) throw new Error('La publicación está vacía.');
  const next = structuredClone(run);
  next.social.posts.unshift({ id: randomUUID(), author: next.player.name, text: clean, time: timeKey(next.world) });
  next.updatedAt = new Date().toISOString();
  next.eventLog.push({ time: timeKey(next.world), type: 'social_post_created', data: { text: clean } });
  return next;
}

// Línea hablada por un NPC: texto limpio, gesto opcional y tramos con la emoción activa en cada momento.
export const npcLine = (reply) => ({
  who: 'npc', text: reply.say, ...(reply.gesture ? { gesture: reply.gesture } : {}), ...(reply.segments?.length ? { segments: reply.segments } : {})
});

// --- Encuentros 1 a 1 con NPC -------------------------------------------------
const EXCHANGE_MINUTES = 3;
export const MAX_ENCOUNTER_LINES = 60;

export function startEncounter(run, npc, opening, contactNpc = null) {
  if (run.encounter) throw new Error('Ya estás en una conversación.');
  const next = structuredClone(run);
  const prior = { met: false, nameKnown: false, contact: false, encounters: 0, notes: [], history: [], ...(run.relationships?.[npc.id] ?? {}) };
  // `origin` permite a las herramientas de desarrollo rebobinar una conversación y repetirla.
  const origin = { world: structuredClone(run.world), relationship: structuredClone(prior), eventCount: run.eventLog.length, narrative: run.narrative ?? null };
  next.world = advanceTime(next.world, 1);
  next.encounter = {
    npcId: npc.id, locationId: next.player.locationId, startedAt: timeKey(next.world), origin,
    lines: [npcLine(opening)], ...(opening.intent ? { intent: opening.intent } : {})
  };
  const relationship = { met: false, nameKnown: false, contact: false, added: false, encounters: 0, lastEnd: null, notes: [], history: [], ...(next.relationships?.[npc.id] ?? {}) };
  next.relationships = { ...next.relationships, [npc.id]: { ...relationship, met: true } };
  next.eventLog.push({ time: timeKey(next.world), type: 'conversation_started', data: { npcId: npc.id } });
  if (contactNpc) shareContact(next, contactNpc);
  next.updatedAt = new Date().toISOString();
  return next;
}

// El NPC comparte su usuario de contacto: queda constancia en el registro y, si hay conversación, una tarjeta visible.
function shareContact(run, npc) {
  run.relationships[npc.id] = { ...run.relationships[npc.id], contact: true, contactAt: timeKey(run.world) };
  run.eventLog.push({ time: timeKey(run.world), type: 'contact_shared', data: { npcId: npc.id, handle: npc.contact.handle } });
  if (run.encounter) run.encounter.lines.push(contactCard(npc));
}

// El jugador escribe un usuario en Mensajes. Solo funciona con quien ya lo compartió: nada de metajuego.
export function addContact(run, npc) {
  const relationship = npc ? run.relationships?.[npc.id] : null;
  if (!npc || !relationship?.contact) throw new Error('No agregues a personas desconocidas.');
  if (relationship.added) throw new Error(`${npc.name} ya está en tus contactos.`);
  const next = structuredClone(run);
  next.relationships[npc.id] = { ...relationship, added: true };
  next.eventLog.push({ time: timeKey(next.world), type: 'contact_added', data: { npcId: npc.id } });
  next.updatedAt = new Date().toISOString();
  return next;
}

export function addExchange(run, playerText, reply, nameKnown, contactNpc = null) {
  if (!run.encounter) throw new Error('No estás hablando con nadie.');
  const text = String(playerText ?? '').trim().slice(0, 400);
  if (!text) throw new Error('Escribe qué le dices.');
  if (run.encounter.closed) throw new Error('La conversación terminó. Pulsa Volver.');
  if (run.encounter.lines.length >= MAX_ENCOUNTER_LINES) throw new Error('La conversación se alarga demasiado. Despídete y retómala después.');
  const next = structuredClone(run);
  next.encounter.lines.push({ who: 'player', text }, npcLine(reply));
  if (reply.intent !== undefined) next.encounter.intent = reply.intent || undefined;
  next.world = advanceTime(next.world, EXCHANGE_MINUTES);
  if (nameKnown) next.relationships[run.encounter.npcId].nameKnown = true;
  if (contactNpc) shareContact(next, contactNpc);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function endEncounter(run, npc, { relationship, farewell, contactGranted }) {
  if (!run.encounter) throw new Error('No estás hablando con nadie.');
  if (run.encounter.closed) throw new Error('Ya te despediste.');
  const next = structuredClone(run);
  next.world = advanceTime(next.world, 1);
  const spoken = typeof farewell === 'string' ? { say: farewell } : (farewell ?? {});
  const goodbye = { ...spoken, say: spoken.say || `${npc.name} asiente mientras te despides.` };
  const text = closingText(npc, { farewell: goodbye.say, contactGranted });
  next.relationships[npc.id] = { ...relationship, encounters: relationship.encounters + 1, lastEnd: timeKey(next.world) };
  if (contactGranted) next.eventLog.push({ time: timeKey(next.world), type: 'contact_shared', data: { npcId: npc.id, handle: npc.contact.handle } });
  next.eventLog.push({ time: timeKey(next.world), type: 'conversation_ended', data: { npcId: npc.id, contact: contactGranted, response: text } });
  next.narrative = { text, time: timeKey(next.world) };
  next.lastEncounter = structuredClone(run.encounter);
  // La despedida y, si procede, la tarjeta de contacto se muestran dentro de la conversación; el jugador sale con «Volver».
  next.encounter = { ...run.encounter, closed: true, lines: [...run.encounter.lines, npcLine(goodbye), ...(contactGranted ? [contactCard(npc)] : [])] };
  next.updatedAt = new Date().toISOString();
  return next;
}

const contactCard = (npc) => ({ who: 'system', kind: 'contact', npcId: npc.id, handle: npc.contact.handle, text: `${npc.name} te comparte su contacto` });

export function leaveEncounter(run) {
  if (!run.encounter?.closed) throw new Error('Primero despídete.');
  const next = structuredClone(run);
  next.encounter = null;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function closingText(npc, { farewell, contactGranted }) {
  return [farewell || `${npc.name} asiente mientras te despides.`, contactGranted ? `${npc.name} te comparte su contacto: ${npc.contact.handle}` : ''].filter(Boolean).join('\n\n');
}

// --- Herramientas de desarrollo: rebobinar y regenerar --------------------------
export function rewindEncounter(run) {
  const source = run.encounter ?? run.lastEncounter;
  if (!source?.origin) throw new Error('No hay ninguna conversación que reiniciar.');
  const next = structuredClone(run);
  next.world = structuredClone(source.origin.world);
  next.relationships = { ...next.relationships, [source.npcId]: structuredClone(source.origin.relationship) };
  next.eventLog = next.eventLog.slice(0, source.origin.eventCount);
  next.narrative = source.origin.narrative;
  next.encounter = null; next.lastEncounter = null;
  next.updatedAt = new Date().toISOString();
  return { run: next, npcId: source.npcId };
}

export function replaceLastNpcLine(run, reply, contactNpc = null) {
  const lines = run.encounter?.lines;
  const index = lines ? lines.findLastIndex((line) => line.who === 'npc') : -1;
  if (index < 0) throw new Error('No hay una respuesta del NPC que regenerar.');
  const next = structuredClone(run);
  // Si esa respuesta había compartido el contacto, se deshace antes de volver a decidir.
  for (const line of next.encounter.lines.splice(index + 1).filter((item) => item.kind === 'contact')) {
    next.relationships[line.npcId] = { ...next.relationships[line.npcId], contact: false };
    const at = next.eventLog.findLastIndex((event) => event.type === 'contact_shared' && event.data.npcId === line.npcId);
    if (at >= 0) next.eventLog.splice(at, 1);
  }
  next.encounter.lines[index] = npcLine(reply);
  if (reply.intent !== undefined) next.encounter.intent = reply.intent || undefined;
  if (contactNpc) shareContact(next, contactNpc);
  next.updatedAt = new Date().toISOString();
  return next;
}

// Vuelve a aplicar el cierre de la última conversación con una evaluación nueva (la relación parte de su estado original).
export function reapplyEnding(run, npc, { relationship, farewell, contactGranted }) {
  const spoken = typeof farewell === 'string' ? { say: farewell } : (farewell ?? {});
  const source = run.lastEncounter;
  const event = [...run.eventLog].reverse().find((item) => item.type === 'conversation_ended');
  if (!source || !event) throw new Error('No hay un cierre de conversación que regenerar.');
  const next = structuredClone(run);
  const text = closingText(npc, { farewell: spoken.say, contactGranted });
  if (next.encounter?.closed) next.encounter.lines = [...source.lines, npcLine({ ...spoken, say: spoken.say || `${npc.name} asiente mientras te despides.` }), ...(contactGranted ? [contactCard(npc)] : [])];
  next.relationships[npc.id] = { ...relationship, encounters: source.origin.relationship.encounters + 1, lastEnd: next.relationships[npc.id]?.lastEnd ?? null };
  next.eventLog = next.eventLog.filter((item) => !(item.type === 'contact_shared' && item.time === event.time));
  if (contactGranted) next.eventLog.splice(next.eventLog.findIndex((item) => item.time === event.time && item.type === 'conversation_ended'), 0, { time: event.time, type: 'contact_shared', data: { npcId: npc.id, handle: npc.contact.handle } });
  const target = next.eventLog.find((item) => item.time === event.time && item.type === 'conversation_ended');
  target.data = { ...target.data, contact: contactGranted, response: text };
  next.narrative = { text, time: event.time };
  next.updatedAt = new Date().toISOString();
  return next;
}

export function setWorldTime(run, { day, hour, minute }) {
  const d = Number(day ?? run.world.day); const h = Number(hour ?? run.world.hour); const m = Number(minute ?? 0);
  if (!Number.isInteger(d) || d < 1 || d > 9999 || !Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) throw new Error('Hora inválida.');
  const next = structuredClone(run);
  next.world = { ...next.world, day: d, hour: h, minute: m };
  next.updatedAt = new Date().toISOString();
  return next;
}

// Solo para pruebas y desbloqueos por historia: el NPC "ya compartió" su usuario.
export function grantContact(run, npc) {
  const next = structuredClone(run);
  shareContact(next, npc);
  next.updatedAt = new Date().toISOString();
  return next;
}
