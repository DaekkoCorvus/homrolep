// Cabecera ambiente: lo que el GM necesita saber siempre, en pocas líneas de texto compacto (en vez de JSON) y calculado por el motor.
// Cubre casi todas las consultas (hora, lugar, quién está aquí, pendientes), así que el modelo solo usa `query` para lo opcional.
import { dayPeriod } from '../game/clock.js';
import { weekday, scheduleFor } from '../game/npcs.js';

const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const pad = (value) => String(value).padStart(2, '0');
const MAX_PENDING = 5;

// `present`: personas en el lugar ahora. `npcs`: todas las fichas (nombres de los pendientes).
export function ambientHeader({ run, worldData, present = [], npcs = new Map() }) {
  const { world, player } = run;
  const here = worldData.locations.find(({ id }) => id === player.locationId);
  const hours = here?.hours ? `, abierto de ${pad(here.hours.open)}:00 a ${pad(here.hours.close)}:00` : '';
  const people = present.length
    ? present.map((npc) => `${npc.name} (${npc.role || 'sin rol'}${scheduleFor(npc, world)?.activity ? `; ${scheduleFor(npc, world).activity}` : ''}) [id: ${npc.id}]`).join('; ')
    : 'nadie más';
  const pending = (run.commitments ?? []).filter((item) => item.status === 'active').sort((a, b) => (a.dueMin ?? Infinity) - (b.dueMin ?? Infinity)).slice(0, MAX_PENDING)
    .map((item) => `${item.text} con ${npcs.get(item.npcId)?.name ?? item.npcId}${item.dueText ? ` — ${item.dueText}` : ''}${item.place ? ` en ${item.place}` : ''}`);
  const lines = [
    `Ahora: día ${world.day} (${DAY_NAMES[weekday(world)]}), ${pad(world.hour)}:${pad(world.minute)} · ${dayPeriod(world.hour)}.`,
    `Lugar: ${here?.name ?? player.locationId}${here?.district ? ` (${here.district})` : ''}${hours}.`,
    `Presentes: ${people}.`,
    `Jugador: ${player.name}, ${player.money} de dinero, ${player.occupation ? `trabaja como ${player.occupation}` : 'sin trabajo'}.`,
    pending.length ? `Pendientes: ${pending.join('; ')}.` : 'Pendientes: ninguno.',
    `Mapa (id: minutos de viaje): ${worldData.locations.filter(({ id }) => id !== player.locationId).map(({ id, travelMinutes }) => `${id}: ${travelMinutes}`).join(', ')}.`
  ];
  return lines.join('\n');
}
