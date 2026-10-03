// Canal de avisos motor → modelo (broker de contexto, Fase 4). En vez de volcar el registro de sucesos en bruto (con las narraciones enteras de
// turnos anteriores), cada rol recibe líneas cortas con lo que cambió desde su última llamada. Todo lo calcula el motor a partir de la partida.
import { describeGap, minutesOfKey, minutesOfWorld } from '../../game/npcs.js';

const DAY = 1440;

const pad = (value) => String(value).padStart(2, '0');
const clip = (text, max) => { const clean = String(text ?? '').replace(/\s+/g, ' ').trim(); return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean; };

// «d1 08:20 · Fuiste de Apartamento a Luna's Coffee.» o null si ese suceso no interesa a un modelo.
export function eventLine(event, { worldData, npcs = new Map() } = {}) {
  const place = (id) => worldData?.locations?.find((item) => item.id === id)?.name ?? id;
  const person = (id) => npcs.get(id)?.name ?? id;
  const data = event.data ?? {};
  const text = {
    location_changed: () => `Fuiste de ${place(event.from)} a ${place(event.to)}.`,
    player_action: () => `Hiciste: ${clip(data.text, 140)}`,
    time_waited: () => `Esperaste ${data.minutes} minutos.`,
    slept: () => 'Dormiste.',
    worked: () => `Trabajaste y ganaste ${data.earned}.`,
    time_spent: () => `Dedicaste ${data.minutes} minutos a ${data.activity}.`,
    conversation_started: () => `Empezaste a hablar con ${person(data.npcId)}.`,
    conversation_ended: () => `Terminaste de hablar con ${person(data.npcId)}.`,
    contact_shared: () => `${person(data.npcId)} te compartió su contacto.`,
    contact_added: () => `Agregaste a ${person(data.npcId)} a tus contactos.`,
    commitment_made: () => `Quedó acordado con ${person(data.npcId)}: ${clip(data.text, 100)}`,
    commitment_kept: () => `Cumpliste con ${person(data.npcId)}: ${clip(data.text, 100)}`,
    commitment_broken: () => `Incumpliste con ${person(data.npcId)}: ${clip(data.text, 100)}`,
    commitment_cancelled: () => `Se canceló con ${person(data.npcId)}: ${clip(data.text, 100)}`,
    social_post_created: () => `Publicaste en NorthLife: ${clip(data.text, 100)}`
  }[event.type];
  if (!text) return null;
  const at = minutesOfKey(event.time);
  const stamp = at === null ? '' : `d${Math.floor(at / 1440) + 1} ${pad(Math.floor((at % 1440) / 60))}:${pad(at % 60)} · `;
  return `${stamp}${text()}`;
}

// Líneas de los sucesos desde la posición `from` del registro (o los últimos `max` si no hay marca). `skipLast` omite los más recientes (la acción
// que se está resolviendo ya llega aparte). Si hubo un hueco largo desde el último suceso, se avisa de cuánto tiempo pasó.
export function noticesSince(run, { worldData, npcs, from = null, skipLast = 0, max = 8 } = {}) {
  const log = run.eventLog.slice(0, run.eventLog.length - skipLast);
  const start = from === null || from > log.length ? Math.max(0, log.length - max) : from;
  const lines = log.slice(start).map((event) => eventLine(event, { worldData, npcs })).filter(Boolean).slice(-max);
  const last = log.at(-1);
  const gap = last ? minutesOfWorld(run.world) - (minutesOfKey(last.time) ?? minutesOfWorld(run.world)) : 0;
  if (gap >= 60) lines.push(`Último suceso registrado: ${describeGap(gap)}.`);
  return lines;
}

// Lo que NorthLife puede saber del mundo y del jugador, en líneas cortas: cuánto hace de la última tanda de publicaciones, cómo les fue a las
// publicaciones recientes del jugador y a quién agregó hace poco. (La Fase 6 añadirá aquí las noticias que decida el Director.)
export function socialNotices(run, npcs = new Map()) {
  const now = minutesOfWorld(run.world);
  const social = run.social ?? {};
  const lines = [];
  if (social.generatedAt != null) lines.push(`Última tanda de publicaciones: ${describeGap(Math.max(0, now - social.generatedAt))}.`);
  for (const post of (social.posts ?? []).filter((item) => item.own && item.minutes <= now && now - item.minutes <= DAY).slice(0, 2)) {
    lines.push(`El jugador publicó «${clip(post.text, 80)}» ${describeGap(now - post.minutes)}: ${post.likes ?? 0} me gusta y ${post.replies?.length ?? 0} respuestas.`);
  }
  for (const event of run.eventLog.filter((item) => item.type === 'contact_added').slice(-2)) {
    const at = minutesOfKey(event.time);
    if (at !== null && now - at <= DAY) lines.push(`El jugador agregó a ${npcs.get(event.data?.npcId)?.name ?? 'alguien'} a sus contactos ${describeGap(now - at)}.`);
  }
  return lines.slice(0, 5);
}
