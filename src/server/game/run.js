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

// --- Encuentros 1 a 1 con NPC -------------------------------------------------
const EXCHANGE_MINUTES = 3;
export const MAX_ENCOUNTER_LINES = 60;

export function startEncounter(run, npc, opening) {
  if (run.encounter) throw new Error('Ya estás en una conversación.');
  const next = structuredClone(run);
  const prior = { met: false, nameKnown: false, contact: false, encounters: 0, notes: [], history: [], ...(run.relationships?.[npc.id] ?? {}) };
  // `origin` permite a las herramientas de desarrollo rebobinar una conversación y repetirla.
  const origin = { world: structuredClone(run.world), relationship: structuredClone(prior), eventCount: run.eventLog.length, narrative: run.narrative ?? null };
  next.world = advanceTime(next.world, 1);
  next.encounter = {
    npcId: npc.id, locationId: next.player.locationId, startedAt: timeKey(next.world), origin,
    lines: [{ who: 'npc', text: opening.say, ...(opening.gesture ? { gesture: opening.gesture } : {}) }]
  };
  const relationship = { met: false, nameKnown: false, contact: false, encounters: 0, notes: [], history: [], ...(next.relationships?.[npc.id] ?? {}) };
  next.relationships = { ...next.relationships, [npc.id]: { ...relationship, met: true } };
  next.eventLog.push({ time: timeKey(next.world), type: 'conversation_started', data: { npcId: npc.id } });
  next.updatedAt = new Date().toISOString();
  return next;
}

export function addExchange(run, playerText, reply, nameKnown) {
  if (!run.encounter) throw new Error('No estás hablando con nadie.');
  const text = String(playerText ?? '').trim().slice(0, 400);
  if (!text) throw new Error('Escribe qué le dices.');
  if (run.encounter.lines.length >= MAX_ENCOUNTER_LINES) throw new Error('La conversación se alarga demasiado. Despídete y retómala después.');
  const next = structuredClone(run);
  next.encounter.lines.push({ who: 'player', text }, { who: 'npc', text: reply.say, ...(reply.gesture ? { gesture: reply.gesture } : {}) });
  next.world = advanceTime(next.world, EXCHANGE_MINUTES);
  if (nameKnown) next.relationships[run.encounter.npcId].nameKnown = true;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function endEncounter(run, npc, { relationship, farewell, contactGranted }) {
  if (!run.encounter) throw new Error('No estás hablando con nadie.');
  const next = structuredClone(run);
  next.world = advanceTime(next.world, 1);
  const text = closingText(npc, { farewell, contactGranted });
  next.relationships[npc.id] = { ...relationship, encounters: relationship.encounters + 1 };
  next.eventLog.push({ time: timeKey(next.world), type: 'conversation_ended', data: { npcId: npc.id, contact: contactGranted, response: text } });
  next.narrative = { text, time: timeKey(next.world) };
  next.lastEncounter = structuredClone(run.encounter);
  next.encounter = null;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function closingText(npc, { farewell, contactGranted }) {
  return [farewell || `${npc.name} asiente mientras te despides.`, contactGranted ? `${npc.name} te deja su contacto.` : ''].filter(Boolean).join('\n\n');
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

export function replaceLastNpcLine(run, reply) {
  const lines = run.encounter?.lines;
  if (!lines?.length || lines.at(-1).who !== 'npc') throw new Error('No hay una respuesta del NPC que regenerar.');
  const next = structuredClone(run);
  next.encounter.lines[lines.length - 1] = { who: 'npc', text: reply.say, ...(reply.gesture ? { gesture: reply.gesture } : {}) };
  next.updatedAt = new Date().toISOString();
  return next;
}

// Vuelve a aplicar el cierre de la última conversación con una evaluación nueva (la relación parte de su estado original).
export function reapplyEnding(run, npc, { relationship, farewell, contactGranted }) {
  const source = run.lastEncounter;
  const event = [...run.eventLog].reverse().find((item) => item.type === 'conversation_ended');
  if (!source || !event) throw new Error('No hay un cierre de conversación que regenerar.');
  const next = structuredClone(run);
  const text = closingText(npc, { farewell, contactGranted });
  next.relationships[npc.id] = { ...relationship, encounters: source.origin.relationship.encounters + 1 };
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
