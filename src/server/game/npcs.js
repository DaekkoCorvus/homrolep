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

export function scheduleFor(npc, world) {
  const day = weekday(world);
  return npc.schedule.find((slot) => slot.days.includes(day) && world.hour >= slot.from && world.hour < slot.to) ?? null;
}

export function presentNpcs(npcs, locationId, world) {
  return [...npcs.values()].filter((npc) => scheduleFor(npc, world)?.locationId === locationId);
}

export const publicNpc = (npc) => ({ id: npc.id, name: npc.name, role: npc.role });

export function emptyRelationship() {
  return { met: false, nameKnown: false, contact: false, encounters: 0, notes: [], history: [] };
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
  return { notes, wantsContact: raw?.contactOffer === true, farewell: clip(raw?.farewell, 260), summary: clip(raw?.summary, 200) };
}

export function applyEvaluation(relationship, evaluation, time) {
  const notes = [...relationship.notes, ...evaluation.notes.map((note) => ({ ...note, time }))].slice(-MAX_NOTES);
  const affinity = affinityOf(notes);
  const contactGranted = !relationship.contact && evaluation.wantsContact && affinity >= CONTACT_AFFINITY;
  return {
    relationship: {
      ...relationship, notes, contact: relationship.contact || contactGranted,
      history: evaluation.summary ? [...relationship.history, { time, text: evaluation.summary }].slice(-6) : relationship.history
    },
    contactGranted
  };
}

export const debugView = (relationship) => ({ ...relationship, affinity: affinityOf(relationship.notes), interest: interestOf(relationship.notes), attitude: attitudeOf(affinityOf(relationship.notes)) });
