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

test('API: closing registers confirmed agreements; chats and the feed are processed in one background batch when the player acts', async (t) => {
  const runs = new Map(); const seen = []; const calls = { chats: 0, feed: 0, chatBatch: [] };
  let talkTo = null;
  const ai = {
    npcReply: async (context) => {
      seen.push(context);
      if (context.mode === 'closing') return { say: 'Hasta mañana.' };
      if (context.mode === 'chat') return { say: /rico/.test(context.transcript.at(-1).text) ? 'Jaja, qué bueno.' : 'Perfecto, nos vemos mañana a las tres en el parque.' };
      return { say: context.mode === 'open' ? 'Hola.' : 'Claro, mañana a las tres en el parque.' };
    },
    evaluateEncounter: async () => ({
      notes: [], summary: 'Quedaron.', playerName: { value: 'Daekko', evidence: 'me llamo Daekko' }, learned: [{ fact: 'Entrena todos los días', evidence: 'entreno todos los días' }],
      agreements: [meeting({ playerQuote: 'quedamos mañana a las 3', npcQuote: 'mañana a las tres en el parque' }), { text: 'Traer pan', kind: 'task', priority: 'high', when: { inDays: 1, hour: 9 }, place: null, playerQuote: 'te traigo pan', npcQuote: 'gracias, tráelo' }]
    }),
    // UNA llamada por lote de chats, solo cuando el jugador actúa; nunca por mensaje.
    extractFromChats: async ({ chats }) => { calls.chats++; calls.chatBatch.push(chats.map((item) => item.npcId)); return chats.map((item) => ({ npcId: item.npcId, agreements: [meeting({ text: 'Café el sábado', when: { weekday: 5, hour: 17 }, playerQuote: 'nos vemos', npcQuote: 'nos vemos mañana' })] })); },
    socialPosts: async () => { calls.feed++; return [
      { usuario: '@LunaSerp', hora: '09:10', texto: 'Pan recién hecho ☕', likes: 12 },
      { usuario: '@vecino99', nombre: 'Vecino', hora: '09:20', texto: 'Otra vez el metro con retraso', likes: 3 },
      { usuario: '@vecino99', nombre: 'Vecino', hora: '22:00', texto: 'Buenas noches, ciudad', likes: 1 }
    ]; },
    narrate: async () => 'Nada.', act: async (plan, { registry, state }) => {
      if (talkTo) { const outcome = await registry.execute('start_conversation', { npcId: talkTo }, state, { role: 'gm' }); if (outcome.ok) state.run = outcome.run; }
      return { text: 'Te acercas a la barra.', run: state.run, calls: [] };
    },
    prologue: async () => ({ text: 'x', locationId: 'station' })
  };
  const server = createAppServer({ ai, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, headers = {}) => { const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };

  const id = (await call('/api/runs', { name: 'Mara', age: 24, gender: 'woman', race: 'human' })).body.id;
  const stored = runs.get(id); stored.player.locationId = 'cafe'; stored.world.hour = 9; runs.set(id, stored);

  // acción libre: el GM abre el encuentro sin pulsar «Hablar con»
  talkTo = 'luna_serp';
  const approached = await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Me acerco a la barra para hablar con la barista' });
  assert.equal(approached.status, 200);
  assert.equal(approached.body.encounter.npcId, 'luna_serp');
  assert.deepEqual(approached.body.encounter.lines.slice(0, 2).map((line) => line.who), ['narrator', 'npc']);
  assert.equal(seen.at(-1).mode, 'open');

  // el personaje no recibe lo que el jugador hizo por el mundo ni conoce su nombre sin que lo diga
  assert.equal(seen.at(-1).events, undefined);
  assert.equal(seen.at(-1).relationship.knownName, null);

  await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Hola, me llamo Daekko, entreno todos los días. ¿quedamos mañana a las 3 en el parque? Y te traigo pan' });
  const ended = await call(`/api/runs/${id}/talk`, { op: 'end' });
  assert.equal(ended.status, 200);
  const texts = ended.body.commitments.map((item) => item.text);
  assert.deepEqual(texts, ['Verse en el parque'], 'solo el acuerdo que el personaje aceptó; la propuesta de pan sin aceptación no existe');
  assert.equal(ended.body.commitments[0].priority, 'high');
  assert.equal(ended.body.commitments[0].npcName, 'Luna Serp');
  await call(`/api/runs/${id}/talk`, { op: 'leave' });

  // lo que aprendió llega a la siguiente conversación, y nada más
  await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Vuelvo a acercarme a la barra' });
  const next = seen.at(-1);
  assert.equal(next.relationship.knownName, 'Daekko');
  assert.deepEqual(next.relationship.knows, ['Entrena todos los días']);
  assert.equal(next.commitments[0].texto, 'Verse en el parque', 'el personaje recuerda lo acordado');
  assert.equal(next.commitments[0].id, undefined, 'sin ids internos');
  await call(`/api/runs/${id}/talk`, { op: 'end' });
  await call(`/api/runs/${id}/talk`, { op: 'leave' });

  // chat: solo con contactos agregados; hablar con naturalidad no dispara llamadas extra
  assert.equal((await call(`/api/runs/${id}/chat`, { npcId: 'luna_serp', text: 'hola' })).status, 400);
  const withContact = runs.get(id); withContact.relationships.luna_serp = { ...withContact.relationships.luna_serp, contact: true, added: true }; runs.set(id, withContact);
  const chatted = await call(`/api/runs/${id}/chat`, { npcId: 'luna_serp', text: 'Nos vemos el sábado en el café?' });
  assert.equal(chatted.status, 200);
  assert.deepEqual(chatted.body.chats.luna_serp.map((message) => message.who), ['player', 'npc']);
  assert.equal(seen.at(-1).mode, 'chat');
  const chatted2 = await call(`/api/runs/${id}/chat`, { npcId: 'luna_serp', text: 'Genial, mañana te cuento más' });
  assert.equal(chatted2.status, 200);
  assert.equal(calls.chats, 0, 'ningún mensaje de chat llama al GM por su cuenta');
  assert.equal(calls.feed, 1, 'el feed se generó con la primera acción; escribir en el chat no lo repite');
  assert.ok(!chatted2.body.commitments.some((item) => item.text === 'Café el sábado'), 'aún no se ha procesado');

  // el GM procesa los chats pendientes y publica el feed de fondo cuando el jugador actúa: un solo lote
  const acted = await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 30 });
  assert.equal(acted.status, 200);
  assert.equal(calls.chats, 1, 'una única llamada para todos los chats pendientes');
  assert.deepEqual(calls.chatBatch[0], ['luna_serp']);
  assert.ok(acted.body.commitments.some((item) => item.text === 'Café el sábado'), 'el chat también registra acuerdos confirmados');
  assert.deepEqual(acted.body.social.posts.map((post) => post.handle), ['@vecino99'], 'Luna no era contacto cuando se generó (su cuenta está reservada) y la de las 22:00 aún no se publica');
  const calm = await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 30 });
  assert.equal(calls.chats, 1, 'lo ya procesado no se vuelve a enviar');
  assert.equal(calls.feed, 1, 'el feed no se regenera antes de 10 horas de juego');
  assert.equal(calm.body.social.posts.length, 1);

  // sin datos relevantes en el chat, ni siquiera hay llamada
  await call(`/api/runs/${id}/chat`, { npcId: 'luna_serp', text: 'jaja qué rico' });
  await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 5 });
  assert.equal(calls.chats, 1, 'un chat sin nombres, horas ni promesas se descarta sin gastar llamada');
});
