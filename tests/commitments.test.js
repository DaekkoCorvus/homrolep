import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolveDue, validateAgreements, addCommitments, applyUpdates, settleCommitments, keepMeetings, meetingNpcIds, commitmentsFor } from '../src/server/game/commitments.js';
import { createRun } from '../src/server/game/run.js';
import { characterRules, GM_FORMATS } from '../src/server/ai/prompts.js';
import { compose, defaultPreset } from '../src/server/ai/composer.js';
import { createAppServer } from '../src/server/index.js';

const places = ['cafe', 'park', 'store'];
const lines = [
  { who: 'player', text: 'Oye, ¿quedamos mañana a las 3 en el parque?' },
  { who: 'npc', text: 'Claro, mañana a las tres en el parque me viene bien.' },
  { who: 'player', text: 'Quizá vuelva algún día' },
  { who: 'player', text: 'Te traigo el libro pasado mañana' }
];
const meeting = (over = {}) => ({ text: 'Verse en el parque', kind: 'meeting', priority: 'high', when: { inDays: 1, hour: 15, minute: 0 }, place: 'park', playerQuote: 'quedamos mañana a las 3', npcQuote: 'mañana a las tres en el parque', ...over });
const world = { day: 1, hour: 10, minute: 0 };

test('a due moment resolves from relative days, weekdays and hours', () => {
  assert.deepEqual(resolveDue(world, { inDays: 1, hour: 15, minute: 30 }), { dueMin: 1440 + 15 * 60 + 30, day: 2, hour: 15, minute: 30, exact: true });
  assert.equal(resolveDue(world, { inDays: 1 }).exact, false, 'sin hora vence al final del día');
  assert.equal(resolveDue(world, { inDays: 1 }).dueMin, 1440 + 23 * 60 + 59);
  assert.equal(resolveDue(world, { weekday: 2, hour: 9 }).day, 3, 'el próximo miércoles desde el lunes');
  assert.equal(resolveDue({ day: 3, hour: 20, minute: 0 }, { weekday: 2, hour: 9 }).day, 10, 'si ya pasó hoy, la semana siguiente');
  assert.equal(resolveDue(world, null), null);
  assert.equal(resolveDue(world, {}), null);
});

test('agreements need an explicit acceptance from the character: proposals alone create nothing', () => {
  assert.equal(validateAgreements([meeting()], lines, world, places).length, 1);
  assert.equal(validateAgreements([meeting({ npcQuote: 'claro, te espero allí' })], lines, world, places).length, 0, 'sin aceptación citada del personaje no hay promesa');
  assert.equal(validateAgreements([meeting({ npcQuote: 'quedamos mañana a las 3' })], lines, world, places).length, 0, 'la aceptación debe venir del personaje, no del jugador');
  assert.equal(validateAgreements([meeting({ playerQuote: 'frase inventada' })], lines, world, places).length, 0);
  assert.equal(validateAgreements([], lines, world, places).length, 0);
});

test('priority follows context: a dated meeting is high, a casual "I\'ll be back" stays low', () => {
  const [casual] = validateAgreements([{ text: 'Volver mañana', kind: 'return', priority: 'high', when: { inDays: 1 }, place: null, playerQuote: 'Quizá vuelva algún día', npcQuote: 'mañana a las tres en el parque' }], lines, world, places);
  assert.equal(casual.priority, 'low', 'volver sin hora ni lugar es casual aunque el GM exagere');
  const [noTime] = validateAgreements([meeting({ when: { inDays: 1 } })], lines, world, places);
  assert.equal(noTime.kind, 'task', 'una cita sin hora exacta es un encargo');
  assert.notEqual(noTime.priority, 'low');
  const [noPlace] = validateAgreements([meeting({ place: 'nowhere' })], lines, world, places);
  assert.equal(noPlace.kind, 'task');
  const [highTask] = validateAgreements([{ text: 'Traer el libro', kind: 'task', priority: 'high', when: null, place: null, playerQuote: 'Te traigo el libro', npcQuote: 'mañana a las tres en el parque' }], lines, world, places);
  assert.equal(highTask.priority, 'medium', 'alta exige consecuencias claras (hora/fecha)');
});

test('commitments are recorded once, kept by showing up, and broken by missing the window (affecting the impression by priority)', () => {
  let run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' });
  run.world = { ...world };
  addCommitments(run, 'luna_serp', validateAgreements([meeting()], lines, run.world, places));
  addCommitments(run, 'luna_serp', validateAgreements([meeting()], lines, run.world, places));
  assert.equal(run.commitments.length, 1, 'no se duplican');
  assert.equal(commitmentsFor(run, 'luna_serp')[0].prioridad, 'alta');
  assert.equal(commitmentsFor(run, 'luna_serp', { withIds: true })[0].id, run.commitments[0].id);

  // el personaje espera en el lugar durante la ventana de la cita
  const kept = structuredClone(run);
  kept.world = { day: 2, hour: 15, minute: 5 }; kept.player.locationId = 'park';
  assert.deepEqual(meetingNpcIds(kept), ['luna_serp']);
  keepMeetings(kept, 'luna_serp');
  assert.equal(kept.commitments[0].status, 'kept');
  assert.equal(kept.relationships.luna_serp.notes.at(-1).valence, 1);
  settleCommitments(kept);
  assert.equal(kept.commitments[0].status, 'kept', 'lo cumplido no se rompe después');

  // sin ir: tras 30 minutos de espera queda incumplida y resta según la prioridad
  const missed = structuredClone(run);
  missed.world = { day: 2, hour: 15, minute: 20 };
  settleCommitments(missed);
  assert.equal(missed.commitments[0].status, 'active', 'aún dentro de la espera de 30 minutos');
  missed.world = { day: 2, hour: 15, minute: 45 };
  settleCommitments(missed);
  assert.equal(missed.commitments[0].status, 'broken');
  assert.equal(missed.relationships.luna_serp.notes.at(-1).valence, -2, 'alta: pesa más');
  assert.equal(missed.eventLog.at(-1).type, 'commitment_broken');
  assert.deepEqual(meetingNpcIds(missed), [], 'ya no espera');

  const wrongPlace = structuredClone(run);
  wrongPlace.world = { day: 2, hour: 15, minute: 0 }; wrongPlace.player.locationId = 'cafe';
  assert.deepEqual(meetingNpcIds(wrongPlace), [], 'solo espera en el lugar acordado');

  // baja prioridad: se anota pero no resta
  const casual = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' });
  casual.world = { ...world };
  addCommitments(casual, 'luna_serp', [{ text: 'Volver mañana', kind: 'return', priority: 'low', place: null, due: resolveDue(world, { inDays: 1 }) }]);
  casual.world = { day: 3, hour: 8, minute: 0 };
  settleCommitments(casual);
  assert.equal(casual.commitments[0].status, 'broken');
  assert.equal(casual.relationships?.luna_serp?.notes?.length ?? 0, 0, 'una promesa casual rota no castiga');
});

test('updates only resolve real pending items with a quote from the player', () => {
  const run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' });
  run.world = { ...world };
  addCommitments(run, 'luna_serp', [{ text: 'Traer el libro', kind: 'task', priority: 'medium', place: null, due: resolveDue(world, { inDays: 2 }) }]);
  const id = run.commitments[0].id;
  applyUpdates(run, 'luna_serp', [{ id, status: 'kept', playerQuote: 'frase falsa' }], lines);
  assert.equal(run.commitments[0].status, 'active');
  applyUpdates(run, 'otro_npc', [{ id, status: 'kept', playerQuote: 'Te traigo el libro' }], lines);
  assert.equal(run.commitments[0].status, 'active', 'solo el personaje implicado');
  applyUpdates(run, 'luna_serp', [{ id, status: 'kept', playerQuote: 'Te traigo el libro' }], lines);
  assert.equal(run.commitments[0].status, 'kept');
});

test('character and GM prompts are separate roles and the character prompt never names the work or says "NPC"', () => {
  const character = characterRules('Luna Serp');
  assert.match(character, /^You are Luna Serp:/);
  assert.match(character, /natural, neutral contemporary Spanish/i, 'el módulo de idioma define el idioma de salida');
  assert.match(character, /name supplied for \{\{user\}\} is specific to this character/i, 'el nombre conocido es propio de cada personaje');
  assert.doesNotMatch(character, /Heroes of Misery|NPC|jugador/i, 'el personaje no ve el juego');
  assert.doesNotMatch(character, /pretend not to know|fake ignorance/i, 'el motor impone qué información conoce');
  const gm = compose('gm', 'evaluation', defaultPreset('gm'), { data: {}, format: GM_FORMATS.evaluation }).map((message) => message.content).join('\n');
  assert.match(gm, /narrative and semantic interpreter/i);
  assert.match(gm, /server applies deterministic actions and validates/i);
});
