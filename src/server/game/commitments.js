import { randomUUID } from 'node:crypto';
import { describeWhen, minutesOfWorld, normalize, weekday } from './npcs.js';

// Promesas, citas y encargos. Solo existen cuando AMBOS llegaron a un acuerdo: el GM los extrae con citas literales
// del jugador y de la aceptación del personaje, y el motor comprueba que esas citas existan de verdad.
export const GRACE_MINUTES = 30;     // lo que espera el personaje en una cita
export const EARLY_MINUTES = 10;     // puede estar un poco antes de la hora acordada
const KINDS = new Set(['meeting', 'task', 'return', 'other']);
const PRIORITIES = ['low', 'medium', 'high'];
const PENALTY = { low: 0, medium: -1, high: -2 };
const PRIORITY_LABEL = { low: 'baja', medium: 'media', high: 'alta' };
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const pad = (value) => String(value).padStart(2, '0');

const quoted = (lines, who, quote) => {
  const wanted = normalize(quote);
  return wanted.length >= 3 && lines.some((line) => line.who === who && normalize(line.text).includes(wanted));
};

// when → momento absoluto en minutos del mundo. Sin hora, vence al final del día.
export function resolveDue(world, when) {
  if (!when || typeof when !== 'object') return null;
  const hasDays = Number.isInteger(when.inDays); const hasWeekday = Number.isInteger(when.weekday);
  const hour = Number.isInteger(when.hour) && when.hour >= 0 && when.hour <= 23 ? when.hour : null;
  const minute = hour !== null && Number.isInteger(when.minute) && when.minute >= 0 && when.minute <= 59 ? when.minute : 0;
  if (!hasDays && !hasWeekday && hour === null) return null;
  let day = world.day;
  if (hasDays) day += Math.max(0, Math.min(60, when.inDays));
  else if (hasWeekday && when.weekday >= 0 && when.weekday <= 6) {
    let delta = (when.weekday - weekday(world) + 7) % 7;
    if (delta === 0 && hour !== null && (hour < world.hour || (hour === world.hour && minute <= world.minute))) delta = 7;
    day += delta;
  }
  const dueMin = (day - 1) * 1440 + (hour ?? 23) * 60 + (hour === null ? 59 : minute);
  return { dueMin, day, hour, minute, exact: hour !== null };
}

export function dueLabel(due) {
  const day = `día ${due.day} (${DAY_NAMES[(due.day - 1) % 7]})`;
  return due.exact ? `${day}, ${pad(due.hour)}:${pad(due.minute)}` : `${day}, antes de que acabe`;
}

export function validateAgreements(raw, lines, world, locationIds) {
  const out = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 3) : []) {
    const text = typeof item?.text === 'string' ? item.text.trim().slice(0, 200) : '';
    // Sin aceptación explícita del personaje (y cita del jugador) no hay acuerdo: así no nacen promesas fantasma.
    if (text.length < 3 || !quoted(lines, 'player', item.playerQuote) || !quoted(lines, 'npc', item.npcQuote)) continue;
    let kind = KINDS.has(item.kind) ? item.kind : 'other';
    let priority = PRIORITIES.includes(item.priority) ? item.priority : 'low';
    const place = locationIds.includes(item.place) ? item.place : null;
    const due = resolveDue(world, item.when);
    if (kind === 'meeting' && (!place || !due?.exact)) kind = 'task'; // una cita necesita lugar y hora
    if (priority === 'high' && !((kind === 'meeting') || (kind === 'task' && due))) priority = 'medium';
    if ((kind === 'return' || kind === 'other') && !place && !due?.exact) priority = 'low';
    out.push({ text, kind, priority, place, due });
  }
  return out;
}

export function addCommitments(run, npcId, agreements) {
  const next = run;
  next.commitments ??= [];
  for (const agreement of agreements) {
    const duplicate = next.commitments.some((item) => item.status === 'active' && item.npcId === npcId && normalize(item.text) === normalize(agreement.text));
    if (duplicate) continue;
    next.commitments.push({
      id: randomUUID(), npcId, text: agreement.text, kind: agreement.kind, priority: agreement.priority, place: agreement.place,
      dueMin: agreement.due?.dueMin ?? null, exact: agreement.due?.exact ?? false, dueText: agreement.due ? dueLabel(agreement.due) : null,
      status: 'active', createdAt: `DAY_${run.world.day}_${pad(run.world.hour)}:${pad(run.world.minute)}`
    });
    next.eventLog.push({ time: `DAY_${run.world.day}_${pad(run.world.hour)}:${pad(run.world.minute)}`, type: 'commitment_made', data: { npcId, text: agreement.text, priority: agreement.priority } });
  }
  return next;
}

// Cambios en pendientes ya existentes: el jugador cumplió o ambos lo cancelaron (con cita del jugador).
export function applyUpdates(run, npcId, updates, lines) {
  for (const update of Array.isArray(updates) ? updates.slice(0, 5) : []) {
    const item = run.commitments?.find((entry) => entry.id === update?.id && entry.npcId === npcId && entry.status === 'active');
    if (!item || !['kept', 'cancelled'].includes(update.status) || !quoted(lines, 'player', update.playerQuote)) continue;
    if (update.status === 'kept' && item.kind === 'meeting') continue; // las citas se cumplen presentándose
    resolve(run, item, update.status, npcId);
  }
  return run;
}

const timeKeyOf = (world) => `DAY_${world.day}_${pad(world.hour)}:${pad(world.minute)}`;

function resolve(run, item, status, npcId) {
  item.status = status; item.resolvedAt = timeKeyOf(run.world);
  run.eventLog.push({ time: timeKeyOf(run.world), type: `commitment_${status}`, data: { npcId, text: item.text, priority: item.priority } });
}

// Nota de impresión generada por el motor (no por la IA): la valencia sale de la prioridad.
function engineNote(run, npcId, text, valence, tags) {
  if (!valence) return;
  const relationship = run.relationships?.[npcId] ?? {};
  run.relationships = { ...run.relationships, [npcId]: { ...relationship, notes: [...(relationship.notes ?? []), { text, valence, evidence: text, tags, time: timeKeyOf(run.world), system: true }].slice(-30) } };
}

// Incumplimientos: se evalúan al guardar cualquier cambio de la partida (el reloj avanzó).
export function settleCommitments(run) {
  const now = minutesOfWorld(run.world);
  for (const item of run.commitments ?? []) {
    if (item.status !== 'active' || item.dueMin === null) continue;
    if (now <= item.dueMin + (item.exact ? GRACE_MINUTES : 0)) continue;
    resolve(run, item, 'broken', item.npcId);
    engineNote(run, item.npcId, `Quedamos en «${item.text}» y no cumplió (prioridad ${PRIORITY_LABEL[item.priority]}).`, PENALTY[item.priority], ['descortesia']);
  }
  return run;
}

// El jugador llega al lugar de una cita a su hora: queda cumplida.
export function keepMeetings(run, npcId) {
  const now = minutesOfWorld(run.world);
  for (const item of run.commitments ?? []) {
    if (item.status !== 'active' || item.kind !== 'meeting' || item.npcId !== npcId || item.place !== run.player.locationId) continue;
    if (now < item.dueMin - EARLY_MINUTES - 20 || now > item.dueMin + GRACE_MINUTES) continue;
    resolve(run, item, 'kept', npcId);
    if (item.priority !== 'low') engineNote(run, npcId, `Llegó a la cita que acordamos («${item.text}»).`, 1, ['respeto']);
  }
  return run;
}

// NPC que esperan al jugador ahora mismo en su lugar (aunque su horario diga otra cosa).
export function meetingNpcIds(run) {
  const now = minutesOfWorld(run.world);
  return (run.commitments ?? [])
    .filter((item) => item.status === 'active' && item.kind === 'meeting' && item.place === run.player.locationId && now >= item.dueMin - EARLY_MINUTES && now <= item.dueMin + GRACE_MINUTES)
    .map((item) => item.npcId);
}

// Vista para el personaje: sin ids. Con ids para el GM (pendientes que puede resolver).
export function commitmentsFor(run, npcId, { withIds = false } = {}) {
  const view = (item) => ({
    ...(withIds ? { id: item.id } : {}), texto: item.text, tipo: item.kind, prioridad: PRIORITY_LABEL[item.priority], lugar: item.place ?? undefined,
    cuando: item.dueText ?? undefined, estado: item.status === 'active' ? 'pendiente' : item.status === 'kept' ? 'cumplido' : item.status === 'broken' ? 'incumplido' : 'cancelado'
  });
  const mine = (run.commitments ?? []).filter((item) => item.npcId === npcId);
  const active = mine.filter((item) => item.status === 'active').map(view);
  const recent = withIds ? [] : mine.filter((item) => item.status !== 'active').slice(-3).map(view);
  return [...active, ...recent];
}

export const describeCommitment = (item, world) => ({ ...item, dueRelative: item.dueMin === null ? null : describeWhen(`DAY_${Math.floor(item.dueMin / 1440) + 1}_${pad(Math.floor((item.dueMin % 1440) / 60))}:${pad(item.dueMin % 60)}`, world) });
