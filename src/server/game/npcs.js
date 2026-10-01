import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// Reglas sociales deterministas. La IA propone impresiones; este módulo decide qué se acepta.
export const MAX_NOTES = 30;
export const MAX_SHIFT_PER_ENCOUNTER = 4;
export const CONTACT_AFFINITY = 2;
const TAGS = new Set(['humor', 'respeto', 'incomodidad', 'interes', 'confianza', 'curiosidad', 'descortesia', 'sinceridad', 'coqueteo', 'amabilidad']);

export async function loadNpcs(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  const npcs = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(directory, name), 'utf8'))));
  return new Map(npcs.map((npc) => [npc.id, npc]));
}

export const weekday = (world) => (world.day - 1) % 7;
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const pad = (value) => String(value).padStart(2, '0');

// --- Conciencia del tiempo: los NPC saben cuándo hablaron por última vez ---------------------
export const minutesOfWorld = (world) => (world.day - 1) * 1440 + world.hour * 60 + world.minute;
export function minutesOfKey(key) {
  const match = /^DAY_(\d+)_(\d{2}):(\d{2})$/.exec(key ?? '');
  return match ? (Number(match[1]) - 1) * 1440 + Number(match[2]) * 60 + Number(match[3]) : null;
}

export function describeGap(minutes) {
  if (minutes < 2) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} minutos`;
  if (minutes < 1440) { const hours = Math.round(minutes / 60); return hours === 1 ? 'hace una hora' : `hace unas ${hours} horas`; }
  const days = Math.floor(minutes / 1440);
  return days === 1 ? 'hace un día' : `hace ${days} días`;
}

// «hoy a las 09:04 (hace 2 horas)», «ayer a las 18:30», «el día 3 (lunes) a las 10:00 (hace 4 días)».
export function describeWhen(key, world) {
  const then = minutesOfKey(key);
  if (then === null) return 'en algún momento';
  const dayThen = Math.floor(then / 1440) + 1; const hour = `${pad(Math.floor((then % 1440) / 60))}:${pad(then % 60)}`;
  const gap = describeGap(Math.max(0, minutesOfWorld(world) - then));
  const label = dayThen === world.day ? 'hoy' : dayThen === world.day - 1 ? 'ayer' : `el día ${dayThen} (${DAY_NAMES[(dayThen - 1) % 7]})`;
  return `${label} a las ${hour} (${gap})`;
}

export function temporalContext(relationship, world) {
  const lastKey = relationship.lastEnd ?? relationship.history?.at(-1)?.time ?? relationship.notes?.at(-1)?.time ?? null;
  const last = minutesOfKey(lastKey);
  const now = `día ${world.day} (${DAY_NAMES[weekday(world)]}), ${pad(world.hour)}:${pad(world.minute)}`;
  if (last === null || !relationship.encounters) return { ahora: now, ultimaConversacion: null };
  const sameDay = Math.floor(last / 1440) + 1 === world.day;
  return { ahora: now, ultimaConversacion: { cuando: describeWhen(lastKey, world), mismoDia: sameDay, minutosDesdeEntonces: Math.max(0, minutesOfWorld(world) - last) } };
}

export const timedNotes = (relationship, world, count = 8) => relationship.notes.slice(-count).map((note) => ({ cuando: describeWhen(note.time, world), nota: note.text }));
export const timedHistory = (relationship, world, count = 4) => relationship.history.slice(-count).map((item) => ({ cuando: describeWhen(item.time, world), resumen: item.text }));

// --- Voz y emociones --------------------------------------------------------------------------
// El GM cambia la expresión dentro de la frase con una marca de una palabra entre llaves: «{feliz} ¡Qué alegría verte! {triste} Pero me voy…».
// Solo valen las emociones que existan como imagen del NPC; las demás se descartan. Por compatibilidad también se
// reconocen [\\feliz] / [/feliz] y [feliz] (esta última únicamente si «feliz» es una emoción disponible).
const MARK = /\{\s*([\p{L}\p{N}_-]+)\s*\}|\[\s*(?:comando\s*)?[\\/]\s*([\p{L}\p{N}_-]+)\s*\]|\[\s*([\p{L}\p{N}_-]+)\s*\]/gu;
const fold = (value) => String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function parseSpeech(raw, allowed = [], start = 'default') {
  const source = String(raw ?? '');
  const known = new Map([['default', 'default'], ...allowed.map((name) => [fold(name), name])]);
  const parts = []; let emotion = known.has(fold(start)) ? known.get(fold(start)) : 'default'; let last = 0;
  const push = (text) => { if (text) parts.push({ emotion, text }); };
  for (const match of source.matchAll(MARK)) {
    const name = match[1] ?? match[2] ?? match[3];
    const next = known.get(fold(name));
    if (match[3] !== undefined && !next) continue; // «[risas]» no es una marca si no es una emoción disponible
    push(source.slice(last, match.index));
    if (next) emotion = next;
    last = match.index + match[0].length;
  }
  push(source.slice(last));
  const segments = [];
  for (const part of parts) {
    let text = part.text.replace(/[ \t]+/g, ' ');
    if (!segments.length || segments.at(-1).text.endsWith(' ')) text = text.replace(/^ /, '');
    if (!text) continue;
    if (segments.length && segments.at(-1).emotion === part.emotion) segments.at(-1).text += text;
    else segments.push({ emotion: part.emotion, text });
  }
  if (segments.length) segments.at(-1).text = segments.at(-1).text.replace(/ $/, '');
  const say = segments.map((segment) => segment.text).join('').trim();
  const expressive = segments.length > 1 || (segments[0] && segments[0].emotion !== 'default');
  return { say, segments: expressive ? segments : [] };
}

// Quita cualquier marca de un texto que no se anima (gestos, intenciones).
export const stripMarks = (text) => String(text ?? '').replace(/\{[^}]*\}/g, '').replace(/\s{2,}/g, ' ').trim();

// --- Sucesos recientes: contexto para el GM al abrir una conversación -------------------------
export function recentEvents(run, worldData, npcs, count = 8) {
  const place = (id) => worldData.locations.find((location) => location.id === id)?.name ?? id;
  const person = (id) => npcs.get(id)?.name ?? id;
  const describe = (event) => {
    const data = event.data ?? {};
    switch (event.type) {
      case 'location_changed': return `El jugador fue de ${place(event.from)} a ${place(event.to)}`;
      case 'player_action': return `El jugador hizo: ${String(data.text ?? '').slice(0, 160)}`;
      case 'time_waited': return `El jugador esperó ${data.minutes} minutos`;
      case 'slept': return 'El jugador durmió';
      case 'worked': return 'El jugador trabajó';
      case 'conversation_started': return `El jugador empezó a hablar con ${person(data.npcId)}`;
      case 'conversation_ended': return `El jugador terminó de hablar con ${person(data.npcId)}`;
      case 'contact_shared': return `${person(data.npcId)} compartió su contacto con el jugador`;
      case 'contact_added': return `El jugador agregó a ${person(data.npcId)} a sus contactos`;
      default: return null;
    }
  };
  return run.eventLog.slice(-count * 2).map((event) => ({ cuando: describeWhen(event.time, run.world), que: describe(event) })).filter((item) => item.que).slice(-count);
}

export function contactInfo(npc, relationship, world) {
  return {
    yaCompartido: relationship.contact === true, agregadoPorElJugador: relationship.added === true,
    escribioAlgunaVez: false, // el chat llegará más adelante
    compartidoHace: relationship.contactAt ? describeWhen(relationship.contactAt, world) : null,
    usuario: relationship.contact ? npc.contact?.handle : undefined,
    condicionesContacto: relationship.contact ? undefined : npc.contact?.conditions ?? []
  };
}

// --- Contactos --------------------------------------------------------------------------------
export function findNpcByHandle(npcs, handle) {
  const wanted = String(handle ?? '').trim().toLowerCase();
  return wanted ? [...npcs.values()].find((npc) => npc.contact?.handle?.toLowerCase() === wanted) ?? null : null;
}

// El GM propone (`give`) y declara qué condiciones cree cumplidas; el motor solo acepta si TODAS constan.
export function contactAllowed(npc, relationship, claim) {
  if (relationship.contact || claim?.give !== true) return false;
  const conditions = npc.contact?.conditions ?? [];
  const affinity = affinityOf(relationship.notes);
  if (!conditions.length) return affinity >= CONTACT_AFFINITY;
  const met = Array.isArray(claim.conditionsMet) ? claim.conditionsMet : [];
  return affinity >= 0 && conditions.every((_, index) => met[index] === true);
}

export function scheduleFor(npc, world) {
  const day = weekday(world);
  return npc.schedule.find((slot) => slot.days.includes(day) && world.hour >= slot.from && world.hour < slot.to) ?? null;
}

export function presentNpcs(npcs, locationId, world) {
  return [...npcs.values()].filter((npc) => scheduleFor(npc, world)?.locationId === locationId);
}

export const publicNpc = (npc) => ({ id: npc.id, name: npc.name, role: npc.role, stickyEmotions: npc.emotionsStay ?? [] });

// Expresión que sigue activa desde la última línea del NPC si es de las que se mantienen (si no, null).
export function stickyFrom(lines, npc) {
  const last = [...(lines ?? [])].reverse().find((line) => line.who === 'npc');
  const emotion = last?.segments?.at(-1)?.emotion;
  return emotion && emotion !== 'default' && (npc.emotionsStay ?? []).includes(emotion) ? emotion : null;
}

export function emptyRelationship() {
  return { met: false, nameKnown: false, contact: false, added: false, contactAt: null, encounters: 0, lastEnd: null, notes: [], history: [] };
}

export function relationshipOf(run, npcId) {
  return { ...emptyRelationship(), ...(run.relationships?.[npcId] ?? {}) };
}

export function normalize(text) {
  return String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Suma ponderada con más peso a lo reciente; el motor usa este valor, nunca la IA directamente.
export function affinityOf(notes) {
  const ordered = [...notes].reverse();
  const total = ordered.reduce((sum, note, index) => sum + note.valence * Math.pow(0.88, index), 0);
  return Math.max(-10, Math.min(10, Math.round(total)));
}

export function interestOf(notes) {
  return Math.min(5, notes.filter((note) => note.tags?.includes('interes') && note.valence > 0).length);
}

export function attitudeOf(affinity) {
  if (affinity <= -4) return 'cerrada y cortante; prefiere que te vayas';
  if (affinity < 0) return 'reservada y algo distante';
  if (affinity < 2) return 'amable pero neutral, aún no te conoce';
  if (affinity < 5) return 'cálida y relajada contigo';
  return 'confiada y cercana contigo';
}

export function mentionsName(text, name) {
  const first = normalize(name).split(' ')[0];
  return first.length >= 2 && normalize(text).split(' ').includes(first);
}

export function transcriptText(lines) {
  return lines.filter((line) => line.who === 'player').map((line) => line.text).join('\n');
}

// Filtra la evaluación del GM: cada nota debe citar algo que el jugador realmente dijo.
export function validateEvaluation(raw, lines) {
  const playerLines = lines.filter((line) => line.who === 'player').map((line) => normalize(line.text));
  const cited = (quote) => {
    const q = normalize(quote);
    return q.length >= 3 && playerLines.some((line) => line.includes(q));
  };
  const accepted = [];
  let budget = MAX_SHIFT_PER_ENCOUNTER;
  for (const note of Array.isArray(raw?.notes) ? raw.notes.slice(0, 4) : []) {
    const text = typeof note?.text === 'string' ? note.text.trim().slice(0, 220) : '';
    const evidence = typeof note?.evidence === 'string' ? note.evidence.trim().slice(0, 160) : '';
    if (!text || !cited(evidence)) continue;
    let valence = Math.max(-2, Math.min(2, Math.round(Number(note.valence) || 0)));
    const room = Math.max(0, budget);
    if (Math.abs(valence) > room) valence = Math.sign(valence) * room;
    budget -= Math.abs(valence);
    const tags = Array.isArray(note.tags) ? note.tags.filter((tag) => TAGS.has(tag)).slice(0, 3) : [];
    accepted.push({ text, valence, evidence, tags });
  }
  const lastLine = lines.filter((line) => line.who === 'player').at(-1)?.text ?? '';
  const notes = accepted.length ? accepted : [{ text: 'Charlamos un rato, sin nada que destacar.', valence: 0, evidence: lastLine.slice(0, 80), tags: [] }];
  const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  return {
    notes, wantsContact: raw?.contactOffer === true, conditionsMet: Array.isArray(raw?.contactConditions) ? raw.contactConditions.map((value) => value === true) : [],
    farewell: clip(raw?.farewell, 600), summary: clip(raw?.summary, 200)
  };
}

export function applyEvaluation(relationship, evaluation, time, npc) {
  const notes = [...relationship.notes, ...evaluation.notes.map((note) => ({ ...note, time }))].slice(-MAX_NOTES);
  const withNotes = { ...relationship, notes };
  const contactGranted = contactAllowed(npc, withNotes, { give: evaluation.wantsContact, conditionsMet: evaluation.conditionsMet });
  return {
    relationship: {
      ...relationship, notes, contact: relationship.contact || contactGranted,
      history: evaluation.summary ? [...relationship.history, { time, text: evaluation.summary }].slice(-6) : relationship.history
    },
    contactGranted
  };
}

export const debugView = (relationship) => ({ ...relationship, affinity: affinityOf(relationship.notes), interest: interestOf(relationship.notes), attitude: attitudeOf(affinityOf(relationship.notes)) });
