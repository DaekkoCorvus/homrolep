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
  const origin = String(input.origin ?? '').trim().slice(0, 600);
  if (origin.length < 10) throw new Error('Cuéntanos un poco más sobre tu personaje (al menos 10 caracteres).');
  const now = new Date().toISOString();
  const run = {
    id: randomUUID(), version: 1, createdAt: now, updatedAt: now,
    player: {
      name, age,
      gender, genderCustom: gender === 'custom' ? genderCustom : '', race: 'human', origin,
      occupation: null, aspiration: null,
      money: 60,
      reputation: 0,
      locationId: 'apartment'
    },
    world: { day: 1, hour: 8, minute: 0, cityId: 'northfortress' },
    social: { posts: [] }, missions: [], relationships: {}, knowledge: [], eventLog: [], prologue: null
  };
  run.eventLog.push({ time: timeKey(run.world), type: 'run_started', data: { cityId: 'northfortress' } });
  return run;
}

export function setPrologue(run, proposal, worldData) {
  const next = structuredClone(run);
  const allowed = worldData.locations.find((location) => location.id === proposal.locationId);
  const locationId = allowed?.id ?? 'apartment';
  const text = String(proposal.text ?? '').trim().slice(0, 900);
  if (!text) throw new Error('No se pudo crear el prólogo.');
  next.player.locationId = locationId;
  next.prologue = { text, locationId, source: proposal.source === 'ai' ? 'ai' : 'local' };
  next.eventLog.push({ time: timeKey(next.world), type: 'prologue_created', data: { locationId } });
  next.updatedAt = new Date().toISOString();
  return next;
}

export function applyAction(run, action, worldData) {
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
    event = { type: 'player_action', data: { text, response: 'La ciudad toma nota. Algo puede cambiar a partir de esta decisión.' } };
  }

  next.world = advanceTime(next.world, minutes);
  next.updatedAt = new Date().toISOString();
  next.eventLog.push({ time: timeKey(next.world), ...event });
  return next;
}

export function addPost(run, text) {
  const clean = String(text ?? '').trim().slice(0, 280);
  if (!clean) throw new Error('La publicación está vacía.');
  const next = structuredClone(run);
  next.social.posts.unshift({ id: randomUUID(), author: next.player.name, text: clean, time: timeKey(next.world) });
  next.updatedAt = new Date().toISOString();
  next.eventLog.push({ time: timeKey(next.world), type: 'social_post_created', data: { text: clean } });
  return next;
}
