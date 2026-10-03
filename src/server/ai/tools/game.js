// Herramientas del motor para el juego. Los handlers son deterministas: validan, calculan (tiempo, dinero, lugar) y devuelven la
// partida nueva o un rechazo. Los botones de la interfaz (`applyAction`, conversación) y el modelo pasan por estos mismos handlers.
//
// ctx = { run, worldData, npcs, present(run) → npc[], openConversation(run, npc) → run }   (los dos últimos solo los usa quien conversa)
import { advanceTime, timeKey } from '../../game/clock.js';
import { shareContact, MAX_PLAYER_TEXT } from '../../game/run.js';
import { relationshipOf, contactAllowed, scheduleFor } from '../../game/npcs.js';
import { createRegistry, reject } from './registry.js';

const busy = (run) => (run.encounter ? reject('Estás en plena conversación. Despídete antes de hacer otra cosa.', { code: 'ENCOUNTER_ACTIVE' }) : null);

// Aplica el paso del tiempo y deja constancia semántica en el registro de sucesos (la verdad es la partida, no la conversación con el modelo).
function commit(run, minutes, event, change = () => {}) {
  const next = structuredClone(run);
  change(next);
  next.world = advanceTime(next.world, minutes);
  next.updatedAt = new Date().toISOString();
  next.eventLog.push({ time: timeKey(next.world), ...event });
  return next;
}
const spent = (before, after, minutes) => ({ minutes, from: timeKey(before.world), to: timeKey(after.world) });

// Tiempo que cuesta cada actividad (lo fija el motor; el modelo solo propone una estimación acotada).
export const ACTIVITIES = {
  browse: { label: 'curiosear o mirar escaparates', min: 10, max: 120, base: 30 },
  eat: { label: 'comer o tomar algo', min: 15, max: 90, base: 30 },
  rest: { label: 'descansar o sentarse un rato', min: 10, max: 240, base: 30 },
  chat: { label: 'charlar de pasada con desconocidos', min: 5, max: 60, base: 15 },
  explore: { label: 'recorrer la zona', min: 20, max: 180, base: 45 },
  read: { label: 'leer o mirar el móvil', min: 10, max: 180, base: 30 },
  exercise: { label: 'hacer ejercicio', min: 20, max: 120, base: 45 }
};

// Lo que el modelo quiere intentar y el juego aún no sabe resolver. `kind` es cerrado para poder contar qué mecánicas faltan.
export const ATTEMPT_KINDS = ['buy', 'use_item', 'search', 'interact_object', 'craft', 'persuade', 'steal', 'fight', 'other'];
export const MAX_INTENTS = 100;

const personView = (run, npcs, npc) => ({ id: npc.id, name: npc.name, role: npc.role, doing: scheduleFor(npc, run.world)?.activity ?? undefined });

export const gameTools = [
  // --- Consultas: devuelven datos, no cambian la partida ---------------------------------------------------------------------------
  {
    name: 'who_is_here',
    description: 'Consulta quién está en el lugar actual del jugador ahora mismo. Solo esas personas pueden participar en la escena.',
    kind: 'query', roles: ['gm'],
    handler: ({ run, npcs, present }) => ({ ok: true, result: { place: run.player.locationId, people: present(run).map((npc) => personView(run, npcs, npc)) } })
  },
  {
    name: 'place_info',
    description: 'Consulta un lugar del mapa: descripción, horario, cuánto se tarda en llegar y quién suele estar ahora.',
    kind: 'query', roles: ['gm'],
    params: { type: 'object', properties: { place: { type: 'string', description: 'id del lugar (por defecto, el actual)' } }, additionalProperties: false },
    handler({ run, worldData, npcs }, { place }) {
      const location = worldData.locations.find((item) => item.id === (place ?? run.player.locationId));
      if (!location) return reject('Ubicación desconocida.', { code: 'unknown_place', hint: `Lugares válidos: ${worldData.locations.map(({ id }) => id).join(', ')}.` });
      const here = [...npcs.values()].filter((npc) => scheduleFor(npc, run.world)?.locationId === location.id).map((npc) => personView(run, npcs, npc));
      return { ok: true, result: { id: location.id, name: location.name, district: location.district, description: location.description, hours: location.hours ?? 'siempre accesible', travelMinutes: location.travelMinutes, people: here } };
    }
  },
  {
    name: 'recent_events',
    description: 'Consulta los últimos sucesos registrados por el motor (viajes, conversaciones, acuerdos…).',
    kind: 'query', roles: ['gm'],
    params: { type: 'object', properties: { count: { type: 'integer', description: 'cuántos (1 a 20, por defecto 8)' } }, additionalProperties: false },
    handler: ({ run }, { count }) => ({ ok: true, result: { events: run.eventLog.slice(-Math.min(20, Math.max(1, count || 8))) } })
  },
  {
    name: 'player_status',
    description: 'Consulta el estado del jugador: dinero, ocupación, reputación y dónde está.',
    kind: 'query', roles: ['gm'],
    handler: ({ run }) => ({ ok: true, result: { name: run.player.name, money: run.player.money, occupation: run.player.occupation, reputation: run.player.reputation, place: run.player.locationId } })
  },

  // --- Acciones del mundo libre ---------------------------------------------------------------------------------------------------
  {
    name: 'spend_time',
    description: `El jugador dedica un rato a algo corriente sin otro efecto en el juego. Actividades: ${Object.entries(ACTIVITIES).map(([id, item]) => `${id} (${item.label})`).join('; ')}. El motor decide cuántos minutos cuesta; minutes_hint solo orienta.`,
    roles: ['gm'],
    params: { type: 'object', properties: { activity: { type: 'string', enum: Object.keys(ACTIVITIES) }, minutes_hint: { type: 'integer', description: 'minutos que sugieres' } }, required: ['activity'], additionalProperties: false },
    handler({ run }, { activity, minutes_hint }) {
      const blocked = busy(run); if (blocked) return blocked;
      const spec = ACTIVITIES[activity];
      const minutes = Math.min(spec.max, Math.max(spec.min, Math.round(Number(minutes_hint)) || spec.base));
      const next = commit(run, minutes, { type: 'time_spent', data: { activity, minutes } });
      return { ok: true, run: next, result: { activity, ...spent(run, next, minutes) } };
    }
  },
  {
    // Salida para todo lo que el juego aún no implementa (comprar, usar objetos, pelear…): el modelo narra solo el INTENTO, sin conceder
    // resultados, y el motor anota la intención. Esa lista es el mapa de qué mecánicas construir después, medida con juego real.
    name: 'attempt',
    description: 'Úsala cuando el jugador intenta algo que ninguna otra herramienta resuelve (comprar, usar un objeto, buscar, convencer, robar, pelear…). El juego aún no tiene esa mecánica: no cambia dinero, objetos ni relaciones. Narra solo el intento y su ambiente, sin conceder ni negar resultados.',
    roles: ['gm'],
    params: { type: 'object', properties: { kind: { type: 'string', enum: ATTEMPT_KINDS }, details: { type: 'string', maxLength: 240, description: 'qué intenta, en una frase' } }, required: ['kind'], additionalProperties: false },
    handler({ run }, { kind, details = '' }) {
      const next = structuredClone(run);
      next.intents = [...(run.intents ?? []), { time: timeKey(run.world), placeId: run.player.locationId, kind, details: String(details).trim().slice(0, 240), action: run.eventLog.findLast((event) => event.type === 'player_action')?.data?.text?.slice(0, 200) }].slice(-MAX_INTENTS);
      next.updatedAt = new Date().toISOString();
      return { ok: true, run: next, result: { status: 'no_mechanic', note: 'El juego todavía no resuelve esto: nada cambió. Narra solo el intento (o una oportunidad plausible) sin conceder ni negar resultados.' } };
    }
  },

  {
    name: 'travel',
    description: 'Mueve al jugador a otro lugar. El motor calcula cuánto tarda y rechaza lugares desconocidos o en los que ya está.',
    roles: ['gm', 'player'],
    params: { type: 'object', properties: { place: { type: 'string', description: 'id del lugar de destino' } }, required: ['place'], additionalProperties: false },
    handler({ run, worldData }, { place }) {
      const blocked = busy(run); if (blocked) return blocked;
      const destination = worldData.locations.find((location) => location.id === place);
      if (!destination) return reject('Ubicación desconocida.', { code: 'unknown_place', hint: `Lugares válidos: ${worldData.locations.map(({ id }) => id).join(', ')}.` });
      if (destination.id === run.player.locationId) return reject('Ya estás en esa ubicación.', { code: 'already_there' });
      const from = run.player.locationId;
      const next = commit(run, destination.travelMinutes, { type: 'location_changed', from, to: destination.id }, (draft) => { draft.player.locationId = destination.id; });
      return { ok: true, run: next, result: { place: destination.id, name: destination.name, ...spent(run, next, destination.travelMinutes) } };
    }
  },
  {
    name: 'wait',
    description: 'El jugador espera sin hacer nada en concreto. Entre 5 minutos y 8 horas; el motor ajusta la cantidad si se sale del rango.',
    roles: ['gm', 'player'],
    params: { type: 'object', properties: { minutes: { type: 'integer', description: 'minutos de espera (por defecto 30)' } }, additionalProperties: false },
    handler({ run }, { minutes: asked }) {
      const blocked = busy(run); if (blocked) return blocked;
      const minutes = Math.min(8 * 60, Math.max(5, Number(asked) || 30));
      const next = commit(run, minutes, { type: 'time_waited', data: { minutes } });
      return { ok: true, run: next, result: spent(run, next, minutes) };
    }
  },
  {
    name: 'sleep',
    description: 'El jugador duerme unas 8 horas y avanza el reloj en consecuencia.',
    roles: ['gm', 'player'],
    handler({ run }) {
      const blocked = busy(run); if (blocked) return blocked;
      const next = commit(run, 8 * 60, { type: 'slept', data: { minutes: 8 * 60 } });
      return { ok: true, run: next, result: spent(run, next, 8 * 60) };
    }
  },
  {
    name: 'work',
    description: 'El jugador trabaja una jornada de 6 horas y cobra. Solo si ya tiene un trabajo; el motor calcula el pago.',
    roles: ['gm', 'player'],
    handler({ run }) {
      const blocked = busy(run); if (blocked) return blocked;
      if (run.player.occupation !== 'worker') return reject('Aún no tienes un trabajo. Puedes descubrirlo durante la historia.', { code: 'no_job' });
      const next = commit(run, 6 * 60, { type: 'worked', data: { earned: 60 } }, (draft) => { draft.player.money += 60; });
      return { ok: true, run: next, result: { ...spent(run, next, 6 * 60), earned: 60, money: next.player.money } };
    }
  },
  {
    // Solo la interfaz: lo que el jugador escribe como acción libre se anota y cuesta 10 minutos. La Fase 2 lo sustituye por `attempt`.
    name: 'free_action',
    description: 'Anota una acción libre del jugador (uso interno de la interfaz).',
    roles: ['player'],
    params: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
    handler({ run }, { text }) {
      const blocked = busy(run); if (blocked) return blocked;
      const clean = text.trim().slice(0, MAX_PLAYER_TEXT);
      if (!clean) return reject('Escribe una acción.', { code: 'empty_action' });
      const next = commit(run, 10, { type: 'player_action', data: { text: clean } });
      return { ok: true, run: next, result: spent(run, next, 10) };
    }
  },
  {
    name: 'start_conversation',
    description: 'Empieza una conversación en persona con alguien que está en el mismo lugar ahora mismo. El personaje responde en esa conversación.',
    roles: ['gm', 'player'],
    params: { type: 'object', properties: { npcId: { type: 'string', description: 'id de uno de los presentes' } }, required: ['npcId'], additionalProperties: false },
    async handler({ run, npcs, present, openConversation }, { npcId }) {
      if (run.encounter) return reject('Ya estás en una conversación.', { code: 'ENCOUNTER_ACTIVE', status: 409 });
      const npc = npcs.get(npcId);
      if (!npc || !present(run).includes(npc)) return reject('Esa persona no está aquí ahora.', { code: 'not_present', hint: 'Solo puedes hablar con quien está en tu lugar.' });
      return { ok: true, run: await openConversation(run, npc), result: { npcId: npc.id, name: npc.name } };
    }
  },
  {
    // El personaje la declara con su propia herramienta (tools/character.js); esta es la parte del MOTOR: solo comparte si la impresión y TODAS las
    // condiciones de su ficha lo permiten. No la ve ningún modelo (rol interno `engine`).
    name: 'share_contact',
    description: 'El personaje comparte su usuario de contacto con el jugador. Declara en `conditionsMet`, en orden, si cada condición de su ficha se cumple.',
    roles: ['engine'],
    params: { type: 'object', properties: { conditionsMet: { type: 'array', items: { type: 'boolean' }, maxItems: 32 } }, additionalProperties: false },
    handler({ run, npcs }, { conditionsMet = [] }) {
      const npc = run.encounter ? npcs.get(run.encounter.npcId) : null;
      if (!npc) return reject('No estás hablando con nadie.', { code: 'no_conversation' });
      if (run.encounter.closed) return reject('La conversación ya terminó.', { code: 'conversation_closed' });
      if (!contactAllowed(npc, relationshipOf(run, npc.id), { give: true, conditionsMet })) return reject('Todavía no se dan las condiciones para compartir el contacto.', { code: 'not_allowed' });
      const next = structuredClone(run);
      shareContact(next, npc);
      next.updatedAt = new Date().toISOString();
      return { ok: true, run: next, result: { npcId: npc.id, handle: npc.contact.handle } };
    }
  }
];

export const gameRegistry = createRegistry(gameTools);

// Adaptador de los botones: misma semántica que antes (lanza Error si el motor rechaza). `freeform` es la acción escrita a mano.
export function applyAction(run, action, worldData) {
  const type = String(action.type ?? 'freeform');
  const ctx = { run, worldData };
  if (type === 'travel') return gameRegistry.apply('travel', { place: String(action.locationId ?? '') }, ctx);
  if (type === 'wait') return gameRegistry.apply('wait', { minutes: Math.round(Number(action.minutes)) || undefined }, ctx);
  if (type === 'sleep' || type === 'work') return gameRegistry.apply(type, {}, ctx);
  return gameRegistry.apply('free_action', { text: String(action.text ?? '') }, ctx);
}
