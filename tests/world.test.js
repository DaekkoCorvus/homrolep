import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { gameRegistry, ACTIVITIES, MAX_INTENTS } from '../src/server/ai/tools/game.js';
import { ambientHeader } from '../src/server/ai/ambient.js';
import { worldPlan } from '../src/server/ai/plans.js';
import { compose, defaultPreset, normalizePreset } from '../src/server/ai/composer.js';
import { createNanoGPT } from '../src/server/ai/provider.js';
import { createAppServer } from '../src/server/index.js';
import { createRun } from '../src/server/game/run.js';
import { loadNpcs, presentNpcs } from '../src/server/game/npcs.js';
import { addCommitments } from '../src/server/game/commitments.js';

const npcs = await loadNpcs(path.resolve('data/canon/npcs'));
const worldData = JSON.parse(await readFile(path.resolve('data/canon/locations/porta_magna.json'), 'utf8'));
const profile = { name: 'Mara', age: 24, gender: 'woman', race: 'human', appearance: '', origin: '' };
const ctxOf = (run) => ({ run, worldData, npcs, present: (current) => presentNpcs(npcs, current.player.locationId, current.world) });
const atCafe = () => { const run = createRun(profile); run.player.locationId = 'cafe'; run.world.hour = 9; return run; };

// --- Cabecera ambiente ---------------------------------------------------------------------------------------------------------------
test('the ambient header is compact text computed by the engine: time, place, who is here, pending plans and the map', () => {
  const run = atCafe();
  addCommitments(run, 'luna_serp', [{ text: 'Verse en el parque', kind: 'meeting', priority: 'high', place: 'park', due: { dueMin: 1440 + 15 * 60, day: 2, hour: 15, minute: 0, exact: true } }]);
  const header = ambientHeader({ run, worldData, present: presentNpcs(npcs, 'cafe', run.world), npcs });
  assert.match(header, /^Ahora: día 1 \(lunes\), 09:00 · Mañana\./);
  assert.match(header, /Lugar: Luna's Coffee \(Central\), abierto de 06:00 a 22:00\./);
  assert.match(header, /Presentes: Luna Serp \(.+\) \[id: luna_serp\]\./);
  assert.match(header, /Pendientes: Verse en el parque con Luna Serp — día 2 \(martes\), 15:00 en park\./);
  assert.match(header, /Mapa \(id: minutos de viaje\): apartment: 0, .*park: \d+/);
  assert.doesNotMatch(header, /^Mapa.*cafe: 20/m, 'el lugar actual no aparece en el mapa de destinos');
  assert.ok(header.length < 900, `cabecera corta (${header.length} caracteres)`);
  assert.doesNotMatch(header, /[{}"]/, 'texto, no JSON');
  const empty = ambientHeader({ run: createRun(profile), worldData, present: [], npcs });
  assert.match(empty, /Presentes: nadie más\./);
  assert.match(empty, /Pendientes: ninguno\./);
  assert.match(empty, /sin trabajo/);
});

test('the free-world prompt carries the header as plain text, explains the tools, and is protected in custom presets', () => {
  const run = atCafe();
  const header = ambientHeader({ run, worldData, present: presentNpcs(npcs, 'cafe', run.world), npcs });
  run.eventLog.push({ time: 'DAY_1_09:10', type: 'player_action', data: { text: 'Pido un café' } });
  const messages = compose('gm', 'free', defaultPreset('gm'), worldPlan(run, worldData, header));
  const text = messages.map((message) => message.content).join('\n');
  assert.ok(text.includes(header), 'la cabecera va tal cual, sin envolverla en JSON');
  assert.match(text, /Pido un café/);
  assert.match(text, /call "attempt"/);
  assert.match(text, /MAY call the engine tools/);
  assert.match(text, /Return only the final narration text/);
  assert.doesNotMatch(text, /talkTo|personasPresentes/, 'talkTo desapareció: lo absorbe start_conversation');
  // en otros modos la cabecera no se envía
  assert.doesNotMatch(compose('gm', 'action', defaultPreset('gm'), { data: { accion: {} }, format: 'x' }).map((message) => message.content).join('\n'), /Ahora: día/);
  // un preset guardado antes de esta fase (sin el módulo) lo recupera: es obligatorio
  const old = defaultPreset('gm'); old.modules = old.modules.filter((module) => module.auto !== 'ambient');
  assert.ok(normalizePreset('gm', old).modules.some((module) => module.auto === 'ambient' && module.enabled));
  const disabled = defaultPreset('gm'); disabled.modules.find((module) => module.auto === 'ambient').enabled = false;
  assert.equal(normalizePreset('gm', disabled).modules.find((module) => module.auto === 'ambient').enabled, true);
});

// --- Herramientas del mundo libre ----------------------------------------------------------------------------------------------------
test('spend_time lets the engine decide the minutes: the model only hints, inside each activity range', async () => {
  const run = createRun(profile);
  const spent = async (args) => (await gameRegistry.execute('spend_time', args, ctxOf(run), { role: 'gm' }));
  assert.equal((await spent({ activity: 'eat' })).result.minutes, ACTIVITIES.eat.base);
  assert.equal((await spent({ activity: 'eat', minutes_hint: 45 })).result.minutes, 45);
  assert.equal((await spent({ activity: 'eat', minutes_hint: 5000 })).result.minutes, ACTIVITIES.eat.max, 'no se puede comer 83 horas');
  assert.equal((await spent({ activity: 'rest', minutes_hint: 1 })).result.minutes, ACTIVITIES.rest.min);
  assert.equal((await spent({ activity: 'volar' })).code, 'bad_arguments');
  const done = await spent({ activity: 'browse', minutes_hint: 60 });
  assert.equal(done.run.world.hour, 9);
  assert.deepEqual(done.run.eventLog.at(-1).data, { activity: 'browse', minutes: 60 });
  assert.equal(done.run.eventLog.at(-1).type, 'time_spent');
  assert.equal(done.run.player.money, run.player.money, 'pasar el rato no mueve dinero');
});

test('attempt records what the game cannot resolve yet and changes nothing else', async () => {
  const run = atCafe();
  run.eventLog.push({ time: 'DAY_1_09:10', type: 'player_action', data: { text: 'Compro un café con leche' } });
  const outcome = await gameRegistry.execute('attempt', { kind: 'buy', details: 'un café con leche' }, ctxOf(run), { role: 'gm' });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.status, 'no_mechanic');
  assert.deepEqual(outcome.run.intents, [{ time: 'DAY_1_09:00', placeId: 'cafe', kind: 'buy', details: 'un café con leche', action: 'Compro un café con leche' }]);
  assert.deepEqual({ ...outcome.run, intents: undefined, updatedAt: 0 }, { ...run, intents: undefined, updatedAt: 0 }, 'ni dinero, ni hora, ni inventario, ni relaciones');
  assert.equal(run.intents, undefined, 'la partida de entrada no se toca');
  assert.equal((await gameRegistry.execute('attempt', { kind: 'teletransportarse' }, ctxOf(run))).code, 'bad_arguments', 'los tipos son cerrados para poder contarlos');
  assert.equal((await gameRegistry.execute('attempt', { kind: 'buy' }, ctxOf(run), { role: 'player' })).code, 'unknown_tool', 'los botones no la usan');
  let current = run;
  for (let index = 0; index < MAX_INTENTS + 20; index++) current = (await gameRegistry.execute('attempt', { kind: 'other', details: `n${index}` }, ctxOf(current))).run;
  assert.equal(current.intents.length, MAX_INTENTS);
  assert.equal(current.intents.at(-1).details, `n${MAX_INTENTS + 19}`, 'se conservan las más recientes');
});

test('query tools answer from the engine and never change the game', async () => {
  const run = atCafe();
  const ask = async (name, args = {}) => gameRegistry.execute(name, args, ctxOf(run), { role: 'gm' });
  const here = await ask('who_is_here');
  assert.deepEqual(here.result.people.map((person) => person.id), ['luna_serp']);
  assert.equal(here.run, undefined);
  const info = await ask('place_info', { place: 'park' });
  assert.equal(info.result.id, 'park');
  assert.equal((await ask('place_info')).result.id, 'cafe', 'sin parámetro, el lugar actual');
  assert.equal((await ask('place_info', { place: 'atlantis' })).code, 'unknown_place');
  assert.equal((await ask('place_info', { place: 'cafe' })).result.people[0].id, 'luna_serp');
  assert.deepEqual(gameRegistry.names('gm').filter((name) => ['recent_events', 'player_status'].includes(name)), [], 'la cabecera y los avisos ya lo dicen: no se pagan como herramientas');
  assert.deepEqual(gameRegistry.names('character'), [], 'el personaje no ve las herramientas del GM');
});

// --- De extremo a extremo: acción libre → herramientas → partida guardada -------------------------------------------------------------
// `script(body, n)` responde a las llamadas del GM con herramientas (n = ordinal entre ellas); `other(body)` al resto (personaje, feed de fondo…).
async function boot(t, script, other = () => ({ content: '{"posts":[]}' })) {
  const runs = new Map(); const bodies = []; let worldCalls = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    const next = isWorld(body) ? await script(body, ++worldCalls) : await other(body);
    if (next instanceof Error) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ choices: [{ message: next, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  };
  const factory = { get: (kind) => defaultPreset(kind), isCustom: () => false, record() {}, log: () => [], stats: () => [] };
  const ai = createNanoGPT(fetchImpl, { prompts: factory });
  ai.prologue = async () => ({ text: 'Llegas.', locationId: 'station' });
  const server = createAppServer({ ai, prompts: factory, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, dev = false) => { const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(dev ? { 'x-hom-dev': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  const id = (await call('/api/runs', { name: 'Mara', age: 24, gender: 'woman', race: 'human' })).body.id;
  const stored = runs.get(id); stored.player.locationId = 'cafe'; stored.world.hour = 9; runs.set(id, stored);
  return { runs, bodies, call, id };
}
const toolCall = (name, args, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const isWorld = (body) => body.tools?.some((tool) => tool.function.name === 'attempt');

test('free action: the GM travels with a tool, the engine applies it, and the saved game has the real time, place and narration', async (t) => {
  const { runs, bodies, call, id } = await boot(t, async (body, n) => (n === 1 ? { content: null, tool_calls: [toolCall('travel', { place: 'park' })] } : { content: 'Sales del café y llegas al parque.' }));
  const response = await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Termino mi café y salgo a caminar al parque' });
  assert.equal(response.status, 200);
  assert.equal(response.body.player.locationId, 'park');
  assert.equal(response.body.narrative.text, 'Sales del café y llegas al parque.');
  assert.deepEqual(response.body.world, { day: 1, hour: 9, minute: 25, cityId: 'porta_magna' }, '10 min de la acción libre + el viaje que calcula el motor');
  assert.deepEqual(response.body.eventLog.slice(-2).map((event) => event.type), ['player_action', 'location_changed']);
  assert.equal(response.body.eventLog.at(-2).data.response, 'Sales del café y llegas al parque.');
  assert.deepEqual(runs.get(id).player.locationId, 'park');
  const worlds = bodies.filter(isWorld);
  assert.equal(worlds.length, 2, 'una vuelta con la herramienta y otra para narrar');
  const system = worlds[0].messages.map((message) => message.content).join('\n');
  assert.match(system, /Ahora: día 1 \(lunes\), 09:10/);
  assert.match(system, /Presentes: Luna Serp/);
  const toolMessage = worlds[1].messages.at(-1);
  assert.equal(toolMessage.role, 'tool');
  assert.equal(JSON.parse(toolMessage.content).minutes, 15);
});

test('free action: start_conversation opens the encounter through the same path as the button, with the narration first', async (t) => {
  const { runs, call, id } = await boot(t,
    async (body, n) => (n === 1 ? { content: null, tool_calls: [toolCall('start_conversation', { npcId: 'luna_serp' })] } : { content: 'Te acercas a la barra y Luna levanta la vista.' }),
    async (body) => (body.messages.some((message) => message.content.includes('Luna Serp') && message.content.includes('"say"')) ? { content: JSON.stringify({ say: 'Hola, ¿qué te pongo?', gesture: 'seca una taza' }) } : { content: '{"posts":[]}' }));
  const response = await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Me acerco a la barra a hablar con la barista' });
  assert.equal(response.status, 200);
  assert.equal(response.body.encounter.npcId, 'luna_serp');
  assert.deepEqual(response.body.encounter.lines.map((line) => line.who), ['narrator', 'npc']);
  assert.equal(response.body.encounter.lines[0].text, 'Te acercas a la barra y Luna levanta la vista.');
  assert.equal(runs.get(id).relationships.luna_serp.met, true);
});

test('free action: an unsupported intent is narrated as an attempt, recorded for development, and hidden from normal players', async (t) => {
  const { runs, call, id } = await boot(t, async (body, n) => (n === 1 ? { content: null, tool_calls: [toolCall('attempt', { kind: 'buy', details: 'un café' })] } : { content: 'Pides un café y Luna asiente, ocupada con la máquina.' }));
  const response = await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Compro un café' });
  assert.equal(response.status, 200);
  assert.equal(response.body.player.money, 60, 'el modelo no puede cobrar: no hay mecánica de compra');
  assert.equal(response.body.intents, undefined, 'un jugador normal no ve la lista de desarrollo');
  assert.equal(runs.get(id).intents.length, 1);
  const dev = await call(`/api/runs/${id}`, null, true);
  assert.deepEqual(dev.body.intents.map((item) => [item.kind, item.details, item.action]), [['buy', 'un café', 'Compro un café']]);
});

test('free action: a rejected tool comes back to the model as "yes, but…" and the game only keeps what the engine allowed', async (t) => {
  const { bodies, call, id } = await boot(t, async (body, n) => (n === 1 ? { content: null, tool_calls: [toolCall('work', {})] } : { content: 'Preguntas por trabajo, pero todavía no tienes ninguno.' }));
  const response = await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Me pongo a trabajar' });
  assert.equal(response.status, 200);
  assert.equal(response.body.player.money, 60);
  assert.deepEqual(response.body.world, { day: 1, hour: 9, minute: 10, cityId: 'porta_magna' });
  const toolResult = JSON.parse(bodies.filter(isWorld)[1].messages.at(-1).content);
  assert.equal(toolResult.ok, false);
  assert.match(toolResult.reason, /trabajo/);
});

test('free action: if the model call fails midway nothing is saved, and the player can retry', async (t) => {
  let fail = true;
  const { runs, call, id } = await boot(t, async (body, n) => {
    if (n === 1) return { content: null, tool_calls: [toolCall('travel', { place: 'park' })] };
    return fail ? new Error('caído') : { content: 'Llegas.' };
  });
  const before = structuredClone(runs.get(id));
  const failed = await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Voy al parque' });
  assert.equal(failed.status, 502);
  assert.deepEqual(runs.get(id), before, 'ni la acción ni el viaje quedaron guardados');
  fail = false;
  // el reintento vuelve a pedir la herramienta (n sigue creciendo, así que el guion ya no la emite): basta con que narre y guarde
  assert.equal((await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Voy al parque' })).status, 200);
});

test('free action: an empty narration is an error, never a silent save', async (t) => {
  const { runs, call, id } = await boot(t, async () => ({ content: '   ' }));
  const before = structuredClone(runs.get(id));
  const response = await call(`/api/runs/${id}/action`, { type: 'freeform', text: 'Miro alrededor' });
  assert.equal(response.status, 502);
  assert.deepEqual(runs.get(id), before);
});

test('the prompt editor previews the free-world call with the real header of the open game', async (t) => {
  const { call, id } = await boot(t, async () => ({ content: 'x' }));
  const preview = await call('/api/dev/prompts/gm/preview', { mode: 'free', runId: id }, true);
  assert.equal(preview.status, 200);
  const text = preview.body.messages.map((message) => message.content).join('\n');
  assert.match(text, /Lugar: Luna's Coffee/);
  assert.match(text, /\[id: luna_serp\]/);
  const kinds = (await call('/api/dev/prompts', null, true)).body.kinds.find((item) => item.kind === 'gm');
  assert.ok(kinds.modes.some((mode) => mode.id === 'free'));
  assert.ok(!kinds.modes.some((mode) => mode.id === 'narration'));
  assert.equal(kinds.autos.find((auto) => auto.key === 'ambient').required, true);
});
