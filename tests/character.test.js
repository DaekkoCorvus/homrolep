import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { characterRegistry, characterToolNames } from '../src/server/ai/tools/character.js';
import { createNanoGPT, AIError } from '../src/server/ai/provider.js';
import { characterPlan } from '../src/server/ai/plans.js';
import { compose, defaultPreset } from '../src/server/ai/composer.js';
import { validateAgreements, addCommitments } from '../src/server/game/commitments.js';
import { createRun, startEncounter, endEncounter } from '../src/server/game/run.js';
import { loadNpcs, emptyRelationship, temporalContext } from '../src/server/game/npcs.js';
import { createAppServer } from '../src/server/index.js';

const npcs = await loadNpcs(path.resolve('data/canon/npcs'));
const luna = npcs.get('luna_serp');

// --- Herramientas del personaje -----------------------------------------------------------------------------------------------------
test('the character only sees its own tools, per channel and per turn, and they only record claims', async () => {
  assert.deepEqual(characterRegistry.names('character').sort(), ['agree_plan', 'end_conversation', 'note_to_self', 'recall', 'remember', 'share_contact']);
  assert.deepEqual(characterRegistry.names('text').sort(), ['agree_plan', 'recall', 'remember'], 'en chat no hay despedidas ni contacto');
  assert.deepEqual(characterToolNames({ mode: 'chat', canShare: true }), ['agree_plan', 'remember', 'recall']);
  assert.ok(!characterToolNames({ mode: 'closing', canShare: true }).includes('end_conversation'), 'en la despedida no se «termina» otra vez');
  assert.ok(!characterToolNames({ mode: 'reply', canShare: false }).includes('share_contact'), 'el contacto no se comparte dos veces');
  for (const forbidden of ['travel', 'wait', 'start_conversation', 'attempt']) assert.equal(characterRegistry.has(forbidden), false, `${forbidden} no es del personaje`);

  const state = { claims: {} };
  const call = (name, args, role = 'character') => characterRegistry.execute(name, args, state, { role });
  assert.equal((await call('agree_plan', { text: 'Verse en el parque', kind: 'meeting', place: 'park', inDays: 1, hour: 15, playerQuote: 'quedamos mañana' })).ok, true);
  assert.deepEqual(state.claims.agreements[0].when, { inDays: 1, weekday: null, hour: 15, minute: null });
  assert.equal((await call('agree_plan', { text: 'x', kind: 'inventado', playerQuote: 'y' })).code, 'bad_arguments');
  assert.equal((await call('agree_plan', { text: 'x', kind: 'task' })).code, 'bad_arguments', 'sin cita no hay acuerdo');
  assert.equal((await call('remember', { kind: 'name', value: 'Daekko', quote: 'me llamo Daekko' })).ok, true);
  assert.equal((await call('share_contact', { conditionsMet: [true, true] }, 'text')).code, 'unknown_tool', 'un chat no comparte contacto');
  assert.equal((await call('end_conversation', {}, 'text')).code, 'unknown_tool');
  for (let index = 0; index < 5; index++) await call('agree_plan', { text: `plan ${index}`, kind: 'task', playerQuote: 'q' });
  assert.equal(state.claims.agreements.length, 3, 'máximo tres acuerdos por respuesta');
  assert.equal((await call('note_to_self', { text: 'Quiero darle mi contacto.' })).ok, true);
  assert.equal(state.claims.intent, 'Quiero darle mi contacto.');
});

test('an agreement the character accepts itself only needs the player\'s literal quote, and the same plan is never registered twice', () => {
  const world = { day: 1, hour: 9, minute: 0 };
  const lines = [{ who: 'player', text: 'Quedamos mañana a las 3 en el parque?' }];
  const claim = { text: 'Verse en el parque', kind: 'meeting', priority: 'high', place: 'park', when: { inDays: 1, hour: 15, minute: 0 }, playerQuote: 'quedamos mañana a las 3' };
  assert.equal(validateAgreements([claim], lines, world, ['park']).length, 0, 'con la reflexión del GM se exige además la cita de la aceptación');
  const [accepted] = validateAgreements([claim], lines, world, ['park'], { npcAccepts: true });
  assert.equal(accepted.kind, 'meeting');
  assert.equal(accepted.due.dueMin, 1440 + 15 * 60);
  assert.equal(validateAgreements([{ ...claim, playerQuote: 'nunca dije eso' }], lines, world, ['park'], { npcAccepts: true }).length, 0, 'una cita inventada descarta el acuerdo');
  assert.equal(validateAgreements([{ ...claim, place: 'luna', kind: 'meeting' }], lines, world, ['park'], { npcAccepts: true })[0].kind, 'task', 'una cita sin lugar válido baja a encargo');
  const run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' });
  addCommitments(run, 'luna_serp', [accepted]);
  addCommitments(run, 'luna_serp', [{ ...accepted, text: 'Café en el parque con Mara' }]); // el GM lo repite al cerrar con otras palabras
  assert.equal(run.commitments.length, 1, 'mismo tipo, lugar y hora = el mismo acuerdo');
  addCommitments(run, 'luna_serp', [{ ...accepted, text: 'Otro plan', due: { ...accepted.due, dueMin: accepted.due.dueMin + 60 } }]);
  assert.equal(run.commitments.length, 2);
});

// --- Proveedor: texto + herramientas, una sola llamada -------------------------------------------------------------------------------
const context = (extra = {}) => ({
  npc: luna, player: { name: 'Mara', age: 24, gender: 'woman', appearance: '' }, world: { day: 1, hour: 9, minute: 0 }, location: { name: "Luna's Coffee", description: 'x' },
  relationship: emptyRelationship(), attitude: 'neutral', transcript: [{ who: 'player', text: 'Me llamo Daekko, ¿quedamos mañana a las 3 en el parque?' }], temporal: temporalContext(emptyRelationship(), { day: 1, hour: 9, minute: 0 }),
  memories: [], history: [], emotions: [], stickyEmotions: [], contact: { yaCompartido: false }, mode: 'reply', ...extra
});
const config = { apiKey: 'k', model: 'm' };
const toolCall = (name, args) => ({ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } });
function fakeProvider(message) {
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ choices: [{ message: typeof message === 'function' ? message(bodies.at(-1)) : message, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) }; };
  return { ai: createNanoGPT(fetchImpl, { prompts: { get: (kind) => defaultPreset(kind), record() {} } }), bodies };
}

test('the character answers with plain text and declares engine effects with tools, in ONE request', async () => {
  const { ai, bodies } = fakeProvider({
    content: '*seca una taza* {feliz} Claro, mañana a las tres en el parque. Me avisas si llegas tarde.',
    tool_calls: [
      toolCall('agree_plan', { text: 'Verse en el parque', kind: 'meeting', place: 'park', inDays: 1, hour: 15, playerQuote: 'quedamos mañana a las 3' }),
      toolCall('remember', { kind: 'name', value: 'Daekko', quote: 'Me llamo Daekko' }),
      toolCall('note_to_self', { text: 'Me cae bien.' }),
      toolCall('share_contact', { conditionsMet: [true, true] }),
      toolCall('end_conversation', { reason: 'se va' })
    ]
  });
  const reply = await ai.npcReply(context(), config);
  assert.equal(bodies.length, 1, 'texto y efectos van juntos: sin segunda vuelta');
  assert.deepEqual(bodies[0].tools.map((tool) => tool.function.name).sort(), ['agree_plan', 'end_conversation', 'note_to_self', 'recall', 'remember', 'share_contact']);
  assert.equal(reply.gesture, 'seca una taza');
  assert.equal(reply.say, '{feliz} Claro, mañana a las tres en el parque. Me avisas si llegas tarde.', 'las marcas de emoción se conservan para el motor');
  assert.equal(reply.intent, 'Me cae bien.');
  assert.deepEqual(reply.contact, { give: true, conditionsMet: [true, true] });
  assert.equal(reply.agreements[0].playerQuote, 'quedamos mañana a las 3');
  assert.deepEqual(reply.facts, [{ kind: 'name', value: 'Daekko', quote: 'Me llamo Daekko' }]);
  assert.deepEqual(reply.end, { reason: 'se va' });
  // la petición no pide JSON ni lo envuelve: es texto
  const prompt = bodies[0].messages.map((message) => message.content).join('\n');
  assert.doesNotMatch(prompt, /Return only JSON/);
  assert.match(prompt, /plain text: no JSON/);
});

test('the tools shown to the character depend on the turn and the channel', async () => {
  const names = async (extra) => { const { ai, bodies } = fakeProvider({ content: 'Hola.' }); await ai.npcReply(context(extra), config); return bodies[0].tools.map((tool) => tool.function.name).sort(); };
  assert.deepEqual(await names({ mode: 'chat' }), ['agree_plan', 'recall', 'remember']);
  assert.deepEqual(await names({ mode: 'closing' }), ['agree_plan', 'note_to_self', 'remember', 'share_contact'], 'al despedirse no se consulta la memoria ni se termina otra vez');
  assert.deepEqual(await names({ contact: { yaCompartido: true } }), ['agree_plan', 'end_conversation', 'note_to_self', 'recall', 'remember']);
  // el formato solo fija el contrato de salida; cuándo usar cada herramienta lo dice la propia herramienta (una sola vez, no dos)
  const format = (mode) => characterPlan(context({ mode })).format;
  assert.match(format('reply'), /asterisks/);
  assert.doesNotMatch(format('chat'), /asterisks|stage directions or emotion/);
  assert.doesNotMatch(format('reply'), /agree_plan|share_contact|end_conversation/, 'no se repiten las descripciones de las herramientas');
});

test('the JSON fallback codec and the old JSON reply format still work for models without native tools', async () => {
  const viaCodec = fakeProvider({ content: '{"say":"*sonríe* Claro que sí.","calls":[{"tool":"agree_plan","args":{"text":"Verse","kind":"task","playerQuote":"te traigo pan"}}]}' });
  const reply = await viaCodec.ai.npcReply(context(), { ...config, toolMode: 'json' });
  assert.equal(viaCodec.bodies.length, 1);
  assert.ok(!('tools' in viaCodec.bodies[0]));
  assert.deepEqual([reply.gesture, reply.say, reply.agreements.length], ['sonríe', 'Claro que sí.', 1]);
  const legacy = await fakeProvider({ content: '```json\n{"say":"Hola","gesture":"levanta la vista","intent":"nota","contact":{"give":true,"conditionsMet":[true]}}\n```' }).ai.npcReply(context(), config);
  assert.deepEqual([legacy.say, legacy.gesture, legacy.intent, legacy.contact], ['Hola', 'levanta la vista', 'nota', { give: true, conditionsMet: [true] }]);
  await assert.rejects(fakeProvider({ content: '   ' }).ai.npcReply(context(), config), { code: 'AI_RESPONSE' });
  // solo herramientas y nada de texto: el modelo recibe el resultado y escribe sus palabras (segunda vuelta)
  let n = 0;
  const quiet = fakeProvider(() => (n++ === 0 ? { content: null, tool_calls: [toolCall('note_to_self', { text: 'hmm' })] } : { content: 'Dime.' }));
  assert.equal((await quiet.ai.npcReply(context(), config)).say, 'Dime.');
  assert.equal(quiet.bodies.length, 2);
});

// --- Servidor: efectos validados, cierre en segundo plano ----------------------------------------------------------------------------
async function boot(t, ai, { store, keep } = {}) {
  const runs = store ?? new Map();
  const server = createAppServer({
    ai: { prologue: async () => ({ text: 'x', locationId: 'station' }), narrate: async () => 'Pasa el tiempo.', ...ai },
    settings: { require: async () => ({ apiKey: 'k', model: 'm' }) },
    store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  if (!keep) t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body) => { const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  return { server, runs, call, base };
}
async function newGame(t, ai, options = {}) {
  const game = await boot(t, ai, options);
  if (options.id) return { ...game, id: options.id };
  const id = (await game.call('/api/runs', { name: 'Mara', age: 24, gender: 'woman', race: 'human' })).body.id;
  const stored = game.runs.get(id); stored.player.locationId = 'cafe'; stored.world.hour = 9; game.runs.set(id, stored);
  return { ...game, id };
}
const gate = () => { let open; const promise = new Promise((resolve) => { open = resolve; }); return { promise, open }; };
const PLAN = { text: 'Verse en el parque', kind: 'meeting', priority: 'high', place: 'park', when: { inDays: 1, hour: 15, minute: 0 }, playerQuote: 'quedamos mañana a las 3' };
const EVALUATION = { notes: [{ text: 'Es directo y simpático.', valence: 1, evidence: 'me llamo Daekko', tags: ['sinceridad'] }], summary: 'Quedaron en el parque.', playerName: null, learned: [], agreements: [{ text: 'Café en el parque con Mara', kind: 'meeting', priority: 'high', place: 'park', when: { inDays: 1, hour: 15, minute: 0 }, playerQuote: 'quedamos mañana a las 3', npcQuote: 'mañana a las tres' }], updates: [] };

test('API: agreements and facts the character declares count at once, validated against what was really said', async (t) => {
  const seen = [];
  const { call, id, runs } = await newGame(t, {
    npcReply: async (ctx) => {
      seen.push(ctx);
      if (ctx.mode === 'open') return { say: 'Hola.' };
      return { say: 'Claro, mañana a las tres en el parque.', agreements: [PLAN, { ...PLAN, text: 'Cita inventada', playerQuote: 'esto nunca se dijo' }], facts: [{ kind: 'name', value: 'Daekko', quote: 'me llamo Daekko' }, { kind: 'fact', value: 'Entrena todos los días', quote: 'entreno todos los días' }, { kind: 'fact', value: 'Es millonario', quote: 'soy millonario' }, { kind: 'name', value: 'Pedro', quote: 'me llamo Pedro' }] };
    }
  });
  await call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' });
  const talked = await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Hola, me llamo Daekko y entreno todos los días. ¿Quedamos mañana a las 3 en el parque?' });
  assert.equal(talked.status, 200);
  assert.deepEqual(talked.body.commitments.map((item) => item.text), ['Verse en el parque'], 'solo el que tiene su cita literal');
  assert.equal(talked.body.commitments[0].priority, 'high');
  const relationship = runs.get(id).relationships.luna_serp;
  assert.equal(relationship.knownName, 'Daekko', 'el nombre que el jugador dijo de verdad');
  assert.deepEqual(relationship.knows, ['Entrena todos los días'], 'un dato sin cita real no se aprende');
  await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Genial' });
  assert.equal(seen.at(-1).relationship.knownName, 'Daekko', 'el personaje lo sabe en su siguiente turno, sin esperar al cierre');
  assert.equal(seen.at(-1).commitments[0].texto, 'Verse en el parque');
});

test('API: the character can end the conversation itself; the GM reflection runs in the background and is applied before it speaks again', async (t) => {
  const evaluation = gate(); let evaluations = 0; const farewells = [];
  const { call, id, runs, server } = await newGame(t, {
    npcReply: async (ctx) => {
      if (ctx.mode === 'closing') { farewells.push(ctx); return { say: 'Hasta mañana.' }; }
      if (ctx.mode === 'open') return { say: 'Hola.' };
      return { say: 'Mañana a las tres, perfecto. Ahora tengo que irme.', agreements: [PLAN], end: { reason: 'tiene que irse' } };
    },
    evaluateEncounter: async () => { evaluations++; await evaluation.promise; return EVALUATION; }
  });
  await call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' });
  const ended = await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Hola, me llamo Daekko. ¿Quedamos mañana a las 3 en el parque?' });
  assert.equal(ended.status, 200, 'la respuesta no espera a la reflexión del GM');
  assert.equal(ended.body.encounter.closed, true);
  assert.deepEqual(ended.body.encounter.lines.map((line) => line.who), ['npc', 'player', 'npc'], 'su respuesta es la despedida: sin línea extra');
  assert.equal(ended.body.pending.evaluation, true);
  assert.equal(ended.body.pendingEvaluation, undefined, 'la transcripción pendiente es interna');
  assert.equal(farewells.length, 0, 'no hace falta pedir otra despedida');
  assert.equal(ended.body.relationships.luna_serp.encounters, 1);
  assert.deepEqual(ended.body.commitments.map((item) => item.text), ['Verse en el parque']);

  // mientras la reflexión sigue en marcha el jugador puede salir y hacer otras cosas
  assert.equal((await call(`/api/runs/${id}/talk`, { op: 'leave' })).status, 200);
  assert.equal((await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 5 })).status, 200);
  assert.equal(runs.get(id).relationships.luna_serp.notes.length, 0, 'aún sin impresiones');

  // hablar otra vez con ella espera a que recuerde la conversación anterior
  let started = false;
  const again = call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' }).then((result) => { started = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(started, false, 'la conversación nueva espera a la reflexión pendiente');
  evaluation.open();
  assert.equal((await again).status, 200);
  await server.idle();
  const saved = runs.get(id);
  assert.equal(saved.pendingEvaluation, undefined);
  assert.equal(saved.relationships.luna_serp.notes[0].text, 'Es directo y simpático.');
  assert.equal(saved.relationships.luna_serp.history[0].text, 'Quedaron en el parque.');
  assert.equal(evaluations, 1);
  assert.equal(saved.commitments.length, 1, 'el GM repite el acuerdo con otras palabras y no se duplica');
});

test('API: pressing "Despedirse" only waits for the farewell; a failed reflection is retried, then dropped without losing the game', async (t) => {
  const evaluation = gate(); let attempts = 0; let failing = false;
  const { call, id, runs, server } = await newGame(t, {
    npcReply: async (ctx) => (ctx.mode === 'closing' ? { say: 'Adiós.', agreements: [{ ...PLAN, text: 'Traer pan', kind: 'task', place: null }] } : { say: 'Hola.' }),
    evaluateEncounter: async () => { attempts++; if (failing) throw new AIError('IA caída'); await evaluation.promise; return EVALUATION; }
  });
  await call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' });
  await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Hola, me llamo Daekko. Quedamos mañana a las 3 en el parque, te traigo pan' });
  const closed = await call(`/api/runs/${id}/talk`, { op: 'end' });
  assert.equal(closed.status, 200, 'cerrar no espera al GM');
  assert.equal(closed.body.encounter.lines.at(-1).text, 'Adiós.');
  assert.equal(closed.body.pending.evaluation, true);
  assert.deepEqual(closed.body.commitments.map((item) => item.text), ['Traer pan'], 'lo que dijo al despedirse también cuenta');
  evaluation.open();
  await server.idle();
  assert.equal(runs.get(id).pendingEvaluation, undefined);
  assert.equal(runs.get(id).relationships.luna_serp.notes.length, 1);

  // fallo: se reintenta cuando el cliente consulta la partida, y tras 3 intentos se descarta con una marca en el registro
  await call(`/api/runs/${id}/talk`, { op: 'leave' });
  failing = true; attempts = 0;
  await call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' });
  await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Otra vez, soy Daekko' });
  const second = await call(`/api/runs/${id}/talk`, { op: 'end' });
  assert.equal(second.body.pending.evaluation, true);
  for (let poll = 0; poll < 6; poll++) { await server.idle(); await call(`/api/runs/${id}`); }
  await server.idle();
  assert.equal(attempts, 3);
  const final = runs.get(id);
  assert.equal(final.pendingEvaluation, undefined);
  assert.equal(final.eventLog.filter((event) => event.type === 'evaluation_failed').length, 1);
  assert.equal(final.relationships.luna_serp.encounters, 2, 'la conversación sí quedó registrada');
});

test('API: a reflection left pending (server restarted) resumes when the game is opened again', async (t) => {
  const first = await newGame(t, { npcReply: async (ctx) => (ctx.mode === 'closing' ? { say: 'Adiós.' } : { say: 'Hola.' }), evaluateEncounter: async () => new Promise(() => {}) });
  await first.call(`/api/runs/${first.id}/talk`, { op: 'start', npcId: 'luna_serp' });
  await first.call(`/api/runs/${first.id}/talk`, { op: 'say', text: 'Me llamo Daekko' });
  await first.call(`/api/runs/${first.id}/talk`, { op: 'end' });
  assert.ok(first.runs.get(first.id).pendingEvaluation, 'se guardó como pendiente');
  // «reinicio»: otro servidor con la misma partida guardada
  const second = await newGame(t, { npcReply: async () => ({ say: 'x' }), evaluateEncounter: async () => EVALUATION }, { store: first.runs, id: first.id });
  assert.equal((await second.call(`/api/runs/${first.id}`)).body.pending.evaluation, true);
  await second.server.idle();
  assert.equal(second.runs.get(first.id).pendingEvaluation, undefined);
  assert.equal(second.runs.get(first.id).relationships.luna_serp.notes.length, 1);
});

test('API: chats let the character note plans and facts in its own reply — no GM batch, no keyword guessing', async (t) => {
  let gmCalls = 0; const modes = [];
  const { call, id, runs } = await newGame(t, {
    npcReply: async (ctx) => {
      modes.push(ctx.mode);
      if (ctx.mode === 'chat') return { say: 'Perfecto, nos vemos el sábado.', agreements: [{ text: 'Café el sábado', kind: 'meeting', priority: 'medium', place: 'cafe', when: { weekday: 5, hour: 17, minute: 0 }, playerQuote: 'nos vemos el sábado' }], facts: [{ kind: 'name', value: 'Mara Vega', quote: 'soy Mara Vega' }] };
      return { say: 'Hola.' };
    },
    evaluateEncounter: async () => { gmCalls++; return EVALUATION; }
  });
  const stored = runs.get(id); stored.relationships = { luna_serp: { ...emptyRelationship(), met: true, contact: true, added: true } }; runs.set(id, stored);
  const chatted = await call(`/api/runs/${id}/chat`, { npcId: 'luna_serp', text: 'Hola, soy Mara Vega. ¿Nos vemos el sábado a las 5 en el café?' });
  assert.equal(chatted.status, 200);
  assert.deepEqual(chatted.body.commitments.map((item) => item.text), ['Café el sábado']);
  assert.equal(runs.get(id).relationships.luna_serp.knownName, 'Mara Vega');
  await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 30 });
  await call(`/api/runs/${id}/chat`, { npcId: 'luna_serp', text: 'jaja qué rico' });
  assert.equal(gmCalls, 0, 'ningún mensaje ni acción llama al GM por los chats');
  assert.deepEqual(modes, ['chat', 'chat']);
});

test('API: the feed is generated in the background and never delays the action or overwrites what the player did meanwhile', async (t) => {
  const feed = gate(); let generated = 0;
  const { call, id, runs, server } = await newGame(t, { socialPosts: async () => { generated++; await feed.promise; return [{ usuario: '@vecino99', nombre: 'Vecino', hora: '09:00', texto: 'Buenos días, ciudad', likes: 2 }]; } });
  const acted = await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 30 });
  assert.equal(acted.status, 200, 'la acción responde aunque el feed aún se esté generando');
  assert.equal(acted.body.pending.feed, true);
  assert.equal(acted.body.social.posts.length, 0);
  // el jugador sigue jugando mientras tanto
  const during = await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 30 });
  assert.equal(during.status, 200);
  assert.equal(generated, 1, 'no se lanza otra generación mientras hay una en curso');
  feed.open();
  await server.idle();
  const saved = runs.get(id);
  assert.deepEqual(saved.social.posts.map((post) => post.handle), ['@vecino99']);
  assert.equal(saved.world.minute, 0, 'las dos esperas siguen contadas: 9:00 + 30 + 30 = 10:00');
  assert.equal(saved.world.hour, 10);
});

test('closing a conversation by hand with nothing said does not queue a reflection', async () => {
  let run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' }); run.player.locationId = 'cafe';
  run = startEncounter(run, luna, { say: 'Hola.' });
  const ended = endEncounter(run, luna, { relationship: { ...emptyRelationship(), met: true }, farewell: null, contactGranted: false, silent: true });
  assert.equal(ended.encounter.lines.length, 1, 'silent no añade despedida');
  assert.equal(ended.pendingEvaluation, undefined);
});
