import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { coreOf, deepEntries, selectDeep, queryFrom, stems, DEEP_MAX_ENTRIES, DEEP_MAX_CHARS } from '../src/server/ai/context/card.js';
import { windowOf } from '../src/server/ai/context/history.js';
import { eventLine, noticesSince, socialNotices } from '../src/server/ai/context/notices.js';
import { ambientHeader } from '../src/server/ai/ambient.js';
import { characterPlan, evaluationPlan, narrationPlan } from '../src/server/ai/plans.js';
import { compose, defaultPreset } from '../src/server/ai/composer.js';
import { createNanoGPT } from '../src/server/ai/provider.js';
import { gameRegistry } from '../src/server/ai/tools/game.js';
import { createRun } from '../src/server/game/run.js';
import { socialInput } from '../src/server/game/social.js';
import { loadNpcs, emptyRelationship, temporalContext } from '../src/server/game/npcs.js';
import { createAppServer } from '../src/server/index.js';

const npcs = await loadNpcs(path.resolve('data/canon/npcs'));
const luna = npcs.get('luna_serp');
const worldData = JSON.parse(await readFile(path.resolve('data/canon/locations/porta_magna.json'), 'utf8'));
const tokens = (messages) => Math.round(messages.reduce((total, message) => total + message.content.length, 0) / 3.6);

// --- Ficha en dos capas ----------------------------------------------------------------------------------------------------------------------
test('the core layer is what defines the person; everything else is deep and only appears when it comes up', () => {
  const core = coreOf(luna);
  assert.deepEqual(Object.keys(core).sort(), ['edad', 'ejemplosDeVoz', 'genero', 'nombre', 'personalidad', 'raza', 'resumen', 'rol']);
  assert.ok(!JSON.stringify(core).includes('subterráneo'), 'el trasfondo no va en la capa básica');
  const entries = deepEntries(luna);
  assert.deepEqual([...new Set(entries.map((entry) => entry.section))], ['trasfondo', 'apariencia', 'conocimientos', 'secretos']);
  assert.ok(entries.some((entry) => entry.section === 'secretos' && /clientes habituales/.test(entry.text)));
});

test('deep entries are chosen by what is being talked about: plural-tolerant, accent-blind, capped, and silent when nothing matches', () => {
  const entries = [
    { section: 'trasfondo', text: 'Viene del reino subterráneo y llegó a Northfortress buscando una mejor vida.' },
    { section: 'apariencia', text: 'Cabello verde, corto y ondulado, con un brote en forma de hoja en la coronilla.' },
    { section: 'secretos', text: 'Tiene clientes habituales muy discretos que aprecia.' },
    { section: 'conocimientos', text: 'Conoce bien su carta de cafés, tés, pan y dulces.' }
  ];
  const pick = (query, options) => selectDeep(entries, query, options).map((entry) => entry.section);
  assert.deepEqual(pick('¿De dónde vienes? ¿Tu familia vive en el reino?'), ['trasfondo']);
  assert.deepEqual(pick('me encantan tus cabellos'), ['apariencia'], 'plural y acentos no impiden el disparador');
  assert.deepEqual(pick('¿Tienes algún cliente frecuente?'), ['secretos']);
  assert.deepEqual(pick('hola buenas qué tal'), [], 'palabras cortas o vacías no disparan nada');
  assert.deepEqual(pick(''), []);
  assert.equal(pick('café pan dulces carta cabello clientes reino', { max: 2 }).length, 2, 'tope de entradas');
  const long = [{ section: 'trasfondo', text: 'x'.repeat(10) + ' dragón' }, { section: 'trasfondo', text: 'dragón ' + 'y'.repeat(900) }, { section: 'trasfondo', text: 'dragón ' + 'z'.repeat(900) }];
  assert.equal(selectDeep(long, 'dragón').length, 2, 'tope de caracteres: la tercera ya no cabe');
  assert.ok(stems('Cabellos, cabello!').has('cabel'));
  const transcript = [{ who: 'player', text: 'uno' }, { who: 'npc', text: 'respuesta' }, { who: 'player', text: 'dos reino' }, { who: 'player', text: 'tres cabello' }];
  assert.match(queryFrom(transcript, 'nota'), /dos reino tres cabello respuesta nota/, 'las dos últimas frases del jugador, la última del personaje y su nota');
  assert.doesNotMatch(queryFrom(transcript), /\buno\b/);
});

test('long cards cost the same per turn: a 150 000-character background never travels whole', () => {
  const sentence = (n) => `En el año ${n} del reino ocurrió el suceso número ${n} con sus consecuencias para la familia ${n % 7 ? 'Valdés' : 'Orozco'} y el gremio de los herreros. `;
  const huge = { ...luna, background: Array.from({ length: 900 }, (_, index) => sentence(index)).join('') };
  assert.ok(huge.background.length > 100_000);
  assert.ok(deepEntries(huge).every((entry) => entry.text.length <= 700), 'se trocea en entradas cortas');
  const context = (transcript) => ({
    npc: huge, player: { name: 'Mara', age: 24, gender: 'woman', appearance: '' }, world: { day: 1, hour: 9, minute: 0 }, location: { name: "Luna's Coffee", description: 'x' },
    relationship: emptyRelationship(), attitude: 'neutral', transcript, temporal: temporalContext(emptyRelationship(), { day: 1, hour: 9, minute: 0 }), memories: [], history: [], contact: { yaCompartido: false }, mode: 'reply'
  });
  const idle = tokens(compose('character', 'reply', defaultPreset('character'), characterPlan(context([{ who: 'player', text: 'Hola, buenos días' }]))));
  const asked = tokens(compose('character', 'reply', defaultPreset('character'), characterPlan(context([{ who: 'player', text: 'Cuéntame del suceso número 450 y de la familia Orozco' }]))));
  const baseline = tokens(compose('character', 'reply', defaultPreset('character'), characterPlan({ ...context([{ who: 'player', text: 'Hola, buenos días' }]), npc: { ...luna, background: '' } })));
  assert.ok(Math.abs(idle - baseline) < 120, `un trasfondo de 150 000 caracteres no engorda el turno (${idle} frente a ${baseline} sin trasfondo)`);
  assert.ok(asked < idle + Math.ceil(DEEP_MAX_CHARS / 3.6) + 80, `con tema profundo solo suma el tope (${asked} frente a ${idle})`);
  assert.ok(asked > idle, 'cuando viene al caso, sí entra');
});

test('the character prompt carries the scene as one line of text and only the deep entries that match', () => {
  const plan = (transcript) => characterPlan({
    npc: luna, player: { name: 'Mara', age: 24, gender: 'woman', appearance: '' }, world: { day: 1, hour: 9, minute: 0 }, location: { name: "Luna's Coffee", description: 'Una cafetería pequeña.' },
    relationship: emptyRelationship(), attitude: 'neutral', transcript, temporal: temporalContext(emptyRelationship(), { day: 1, hour: 9, minute: 0 }), memories: [], history: [], contact: { yaCompartido: true }, mode: 'reply'
  });
  const quiet = plan([{ who: 'player', text: 'Buenas' }]);
  assert.equal(quiet.data.tuMemoria, undefined);
  assert.equal(quiet.data.escena, "Ahora: día 1 (lunes), 09:00. Lugar: Luna's Coffee — Una cafetería pequeña.");
  const asked = plan([{ who: 'player', text: 'Oye, ¿tienes clientes habituales?' }]);
  assert.ok(Object.keys(asked.data.tuMemoria).includes('secretos'), 'el secreto sobre los clientes habituales entra solo cuando se pregunta por ellos');
  assert.ok(!Object.keys(asked.data.tuMemoria).includes('apariencia'), 'lo que no viene al caso se queda fuera');
  const text = compose('character', 'reply', defaultPreset('character'), asked).map((message) => message.content).join('\n');
  assert.match(text, /Ahora: día 1 \(lunes\), 09:00\. Lugar: Luna's Coffee/, 'la escena es una línea de texto, no JSON');
  assert.doesNotMatch(text, /"lugar":|"ahora":/);
});

// --- Ventana de conversación ----------------------------------------------------------------------------------------------------------------------
test('only the latest turns are resent, with a note about how many were left out; the GM reflection keeps the whole transcript', () => {
  const lines = Array.from({ length: 60 }, (_, index) => ({ who: index % 2 ? 'npc' : 'player', text: `línea ${index}` }));
  assert.deepEqual(windowOf(lines.slice(0, 5), 16), { lines: lines.slice(0, 5), omitted: 0 });
  assert.deepEqual(windowOf(lines, 16), { lines: lines.slice(-16), omitted: 44 });
  const base = { npc: luna, player: { name: 'Mara', age: 24, gender: 'woman', appearance: '' }, world: { day: 1, hour: 9, minute: 0 }, location: { name: 'L', description: '' }, relationship: emptyRelationship(), attitude: 'neutral', temporal: temporalContext(emptyRelationship(), { day: 1, hour: 9, minute: 0 }), memories: [], history: [], contact: { yaCompartido: true } };
  const person = characterPlan({ ...base, transcript: lines, mode: 'reply' }).data.conversacion;
  assert.equal(person.length, 17);
  assert.match(person[0].nota, /Antes de esto hubo 44 intervenciones más/);
  assert.equal(person.at(-1).texto, 'línea 59');
  assert.equal(characterPlan({ ...base, transcript: lines, mode: 'chat' }).data.conversacion.length, 13, 'en chat la ventana es más corta');
  assert.equal(characterPlan({ ...base, transcript: lines.slice(0, 6), mode: 'reply' }).data.conversacion.length, 6, 'una conversación corta no se recorta');
  assert.equal(evaluationPlan({ ...base, transcript: lines }).data.conversacion.length, 60, 'la reflexión necesita las citas literales de toda la conversación');
});

// --- recall --------------------------------------------------------------------------------------------------------------------------------------
test('the character can look up its own memory with recall when the engine did not bring an entry', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    const message = bodies.length === 1
      ? { content: null, tool_calls: [{ id: 'r1', type: 'function', function: { name: 'recall', arguments: JSON.stringify({ topic: 'clientes discretos' }) } }] }
      : { content: 'Digamos que algunos clientes prefieren que no hable de ellos.' };
    return { ok: true, json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }) };
  };
  const ai = createNanoGPT(fetchImpl, { prompts: { get: (kind) => defaultPreset(kind), record() {} } });
  const reply = await ai.npcReply({
    npc: luna, player: { name: 'Mara', age: 24, gender: 'woman', appearance: '' }, world: { day: 1, hour: 9, minute: 0 }, location: { name: 'L', description: '' }, relationship: emptyRelationship(), attitude: 'neutral',
    transcript: [{ who: 'player', text: '¿Quién viene siempre por aquí?' }], temporal: temporalContext(emptyRelationship(), { day: 1, hour: 9, minute: 0 }), memories: [], history: [], contact: { yaCompartido: true }, mode: 'reply'
  }, { apiKey: 'k', model: 'm' });
  assert.equal(reply.say, 'Digamos que algunos clientes prefieren que no hable de ellos.');
  assert.equal(bodies.length, 2, 'una consulta cuesta una vuelta extra');
  const result = JSON.parse(bodies[1].messages.at(-1).content);
  assert.match(result.recuerdos[0].texto, /clientes habituales muy discretos/);
  assert.equal(result.recuerdos[0].seccion, 'secretos');
  assert.ok(bodies[0].tools.some((tool) => tool.function.name === 'recall'));
});

// --- Avisos ---------------------------------------------------------------------------------------------------------------------------------------
test('events become short lines for the model, never the raw log with whole narrations', () => {
  const ctx = { worldData, npcs };
  assert.equal(eventLine({ time: 'DAY_1_08:20', type: 'location_changed', from: 'apartment', to: 'cafe' }, ctx), "d1 08:20 · Fuiste de Apartamento a Luna's Coffee.");
  assert.match(eventLine({ time: 'DAY_2_10:00', type: 'conversation_ended', data: { npcId: 'luna_serp', response: 'Un texto larguísimo que no debe viajar' } }, ctx), /^d2 10:00 · Terminaste de hablar con Luna Serp\.$/);
  assert.match(eventLine({ time: 'DAY_1_09:00', type: 'commitment_broken', data: { npcId: 'luna_serp', text: 'Verse en el parque' } }, ctx), /Incumpliste con Luna Serp: Verse en el parque/);
  assert.equal(eventLine({ time: 'DAY_1_09:00', type: 'prologue_created' }, ctx), null, 'lo interno no interesa al modelo');
  assert.ok(eventLine({ time: 'DAY_1_09:00', type: 'player_action', data: { text: 'x'.repeat(500) } }, ctx).length < 170);

  const run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' });
  for (const [type, extra] of [['time_waited', { data: { minutes: 30 } }], ['slept', {}], ['location_changed', { from: 'apartment', to: 'park' }], ['player_action', { data: { text: 'Miro alrededor' } }]]) run.eventLog.push({ time: 'DAY_1_08:10', type, ...extra });
  assert.equal(noticesSince(run, { worldData, npcs, from: 0, skipLast: 1 }).length, 3, 'desde la marca, sin la acción en curso (run_started no cuenta)');
  assert.equal(noticesSince(run, { worldData, npcs, from: run.eventLog.length }).length, 0, 'nada nuevo desde la última intervención');
  assert.equal(noticesSince(run, { worldData, npcs, max: 2 }).length, 2, 'sin marca: los últimos');
  const later = { ...run, world: { ...run.world, hour: 12 } };
  assert.match(noticesSince(later, { worldData, npcs, max: 1 }).at(-1), /Último suceso registrado: hace unas 4 horas\./, 'avisa de los huecos largos de tiempo');
  const header = ambientHeader({ run, worldData, present: [], npcs, notices: ['d1 08:10 · Dormiste.'] });
  assert.match(header, /Desde tu última intervención:\n- d1 08:10 · Dormiste\./);
  assert.doesNotMatch(ambientHeader({ run, worldData, present: [], npcs }), /Desde tu última intervención/);
});

test('NorthLife gets notices about the world and the player, and compact contact data', () => {
  const run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' });
  run.world = { ...run.world, day: 2, hour: 9 };
  run.relationships.luna_serp = { ...emptyRelationship(), met: true, contact: true, added: true };
  run.eventLog.push({ time: 'DAY_2_07:00', type: 'contact_added', data: { npcId: 'luna_serp' } });
  run.social = { posts: [{ id: 'p', own: true, handle: '@Mara', text: 'Primer día en la ciudad', minutes: 1440 + 8 * 60, likes: 12, replies: [{}, {}] }], accounts: {}, notifications: [], generatedAt: 1440 + 60 };
  const notices = socialNotices(run, npcs);
  assert.match(notices[0], /Última tanda de publicaciones: hace unas 8 horas\./);
  assert.match(notices[1], /El jugador publicó «Primer día en la ciudad» hace unas? .*12 me gusta y 2 respuestas/);
  assert.match(notices[2], /El jugador agregó a Luna Serp a sus contactos hace unas 2 horas\./);
  const input = socialInput(run, 'post', { npcs, seeds: [], places: [], ahora: 'día 2' });
  assert.deepEqual(input.avisos, notices);
  const contact = input.cuentas.find((account) => account.contactoDelJugador);
  assert.deepEqual(Object.keys(contact.personalidad).sort(), ['habla', 'rasgos'], 'del contacto solo viaja lo que hace falta para su voz en el feed');
});

// --- De extremo a extremo: el GM recibe avisos desde su última intervención --------------------------------------------------------------------
test('API: the free-world GM is told what changed since its last intervention, and its history is a short list instead of the raw log', async () => {
  const runs = new Map(); const worldBodies = [];
  const factory = { get: (kind) => defaultPreset(kind), isCustom: () => false, record() {}, log: () => [], stats: () => [] };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const isWorld = body.tools?.some((tool) => tool.function.name === 'attempt');
    if (isWorld) worldBodies.push(body);
    const isButton = body.messages.some((message) => message.content.includes('Narrate the consequence'));
    return { ok: true, json: async () => ({ choices: [{ message: { content: isWorld ? `Narración número ${worldBodies.length} ${'palabra '.repeat(150)}` : isButton ? 'Pasa la media hora.' : '{"posts":[]}' }, finish_reason: 'stop' }] }) };
  };
  const ai = createNanoGPT(fetchImpl, { prompts: factory });
  ai.prologue = async () => ({ text: 'Llegas.', locationId: 'station' });
  const server = createAppServer({ ai, prompts: factory, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const call = async (route, body) => { const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
    const id = (await call('/api/runs', { name: 'Mara', age: 24, gender: 'woman', race: 'human' })).body.id;
    const stored = runs.get(id); stored.player.locationId = 'cafe'; stored.world.hour = 9; runs.set(id, stored);
    await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Miro la carta' });
    await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 30 }); // un botón entre las dos intervenciones del GM
    await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Pido un café' });
    await server.idle();
    const text = (body) => body.messages.map((message) => message.content).join('\n');
    assert.doesNotMatch(text(worldBodies[0]), /Esperaste/, 'la primera vez aún no ocurrió nada entre intervenciones');
    assert.match(text(worldBodies[1]), /Desde tu última intervención:\n- d1 09:40 · Esperaste 30 minutos\./);
    assert.doesNotMatch(text(worldBodies[1]), /Último suceso registrado/, 'sin huecos largos no hace falta avisar del tiempo');
    assert.doesNotMatch(text(worldBodies[1]), /Miro la carta/, 'lo anterior a su última intervención no se repite');
    assert.doesNotMatch(text(worldBodies[1]), /"sucesosRecientes"/);
    assert.match(text(worldBodies[1]), /"ultimaNarracion":"Pasa la media hora\./, 'la última narración (aquí la del botón) sí viaja, para continuar la historia');
    assert.ok(runs.get(id).cursors.gm > 0);
    assert.ok(tokens(worldBodies[1].messages) < 1800, `el turno del GM cabe en ${tokens(worldBodies[1].messages)} tokens (sin contar las herramientas)`);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('the button narration receives the short list of events too, with names instead of ids', () => {
  const run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' });
  run.eventLog.push({ time: 'DAY_1_08:20', type: 'conversation_ended', data: { npcId: 'luna_serp', response: 'x'.repeat(2000) } }, { time: 'DAY_1_08:25', type: 'time_waited', data: { minutes: 5 } });
  const plan = narrationPlan('action', run, run, worldData, npcs);
  assert.deepEqual(plan.data.sucesosRecientes.slice(-2), ['d1 08:20 · Terminaste de hablar con Luna Serp.', 'd1 08:25 · Esperaste 5 minutos.']);
  assert.ok(JSON.stringify(plan).length < 3000, 'sin las narraciones enteras del registro');
});

test('token budget: the tools and prompts stay small', () => {
  assert.ok(Math.round(JSON.stringify(gameRegistry.specs('gm')).length / 3.6) < 900, 'las herramientas del GM no deben engordar cada llamada');
  assert.equal(DEEP_MAX_ENTRIES, 4);
});
