import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRegistry, defineTool, validateArgs, reject } from '../src/server/ai/tools/registry.js';
import { gameRegistry, applyAction } from '../src/server/ai/tools/game.js';
import { createToolChat } from '../src/server/ai/tools/loop.js';
import { createNanoGPT, AIError } from '../src/server/ai/provider.js';
import { createRun, startEncounter } from '../src/server/game/run.js';
import { loadNpcs, presentNpcs } from '../src/server/game/npcs.js';

const npcs = await loadNpcs(path.resolve('data/canon/npcs'));
const luna = npcs.get('luna_serp');
const worldData = JSON.parse(await readFile(path.resolve('data/canon/locations/porta_magna.json'), 'utf8'));
const profile = { name: 'Mara', age: 24, gender: 'woman', race: 'human', appearance: '', origin: '' };
const newRun = () => createRun(profile);
const ctxOf = (run, extra = {}) => ({ run, worldData, npcs, present: (current) => presentNpcs(npcs, current.player.locationId, current.world), ...extra });

// --- Registro ---------------------------------------------------------------------------------------------------------------------
test('arguments are validated against the tool schema before any handler runs', () => {
  const schema = { type: 'object', properties: { place: { type: 'string', enum: ['cafe', 'park'] }, minutes: { type: 'integer', minimum: 5, maximum: 60 }, flags: { type: 'array', items: { type: 'boolean' }, maxItems: 2 } }, required: ['place'], additionalProperties: false };
  assert.equal(validateArgs(schema, { place: 'cafe', minutes: 30, flags: [true] }), null);
  assert.match(validateArgs(schema, {}), /falta args\.place/);
  assert.match(validateArgs(schema, { place: 'moon' }), /uno de/);
  assert.match(validateArgs(schema, { place: 'cafe', minutes: 2 }), /≥ 5/);
  assert.match(validateArgs(schema, { place: 'cafe', minutes: 5.5 }), /integer/);
  assert.match(validateArgs(schema, { place: 'cafe', money: 999 }), /no existe/, 'no se aceptan parámetros inventados');
  assert.match(validateArgs(schema, { place: 'cafe', flags: [true, false, true] }), /demasiados/);
  assert.match(validateArgs(schema, { place: 'cafe', flags: ['sí'] }), /boolean/);
  assert.equal(validateArgs(schema, { place: 'cafe', minutes: undefined }), null, 'undefined cuenta como ausente');
});

test('the registry hides tools by role, turns throwing handlers into rejections, and lets cancellations and AI failures through', async () => {
  const registry = createRegistry([
    { name: 'peek', description: 'Consulta.', kind: 'query', roles: ['gm'], handler: () => ({ ok: true, result: { seen: 1 } }) },
    { name: 'boom', description: 'Falla.', roles: ['gm'], handler: () => { throw new Error('se rompió'); } },
    { name: 'down', description: 'IA caída.', roles: ['gm'], handler: () => { throw new AIError('sin servicio'); } },
    { name: 'secret', description: 'Solo personaje.', roles: ['character'], handler: () => ({ ok: true }) },
    { name: 'lazy', description: 'Asíncrona.', roles: ['gm'], handler: async () => reject('no ahora', { code: 'later', hint: 'prueba luego' }) },
    { name: 'broken', description: 'Mal contrato.', roles: ['gm'], handler: () => ({ nothing: true }) }
  ]);
  assert.deepEqual(registry.names('gm'), ['peek', 'boom', 'down', 'lazy', 'broken']);
  assert.deepEqual(registry.specs('character').map((spec) => spec.function.name), ['secret']);
  assert.equal(registry.specs('character')[0].type, 'function');
  assert.match(registry.describe('gm'), /- peek\(\) \[consulta\]: Consulta\./);
  assert.equal((await registry.execute('secret', {}, {}, { role: 'gm' })).code, 'unknown_tool', 'un rol no puede llamar a lo que no ve');
  assert.equal((await registry.execute('nope', {}, {})).code, 'unknown_tool');
  assert.deepEqual(await registry.execute('boom', {}, {}), { ok: false, reason: 'se rompió', code: 'handler_error' });
  assert.equal((await registry.execute('broken', {}, {})).code, 'handler_error');
  assert.deepEqual(await registry.execute('lazy', {}, {}), { ok: false, reason: 'no ahora', code: 'later', hint: 'prueba luego' });
  await assert.rejects(registry.execute('down', {}, {}), { code: 'AI_UNAVAILABLE' });
  assert.throws(() => registry.apply('lazy', {}, {}), /asíncrona/);
  assert.throws(() => defineTool({ name: 'Mala Tool', description: 'x', handler() {} }), /inválido/);
  assert.throws(() => createRegistry([{ name: 'a_a', description: 'x', handler() {} }, { name: 'a_a', description: 'x', handler() {} }]), /duplicada/);
});

// --- Herramientas del juego ---------------------------------------------------------------------------------------------------------
test('travel, wait, sleep and work give the same result whether a button or the model calls them', async () => {
  const run = newRun();
  const viaButton = applyAction(run, { type: 'travel', locationId: 'cafe' }, worldData);
  const viaModel = await gameRegistry.execute('travel', { place: 'cafe' }, ctxOf(run), { role: 'gm' });
  assert.equal(viaModel.ok, true);
  assert.equal(viaModel.result.minutes, 20);
  assert.equal(viaModel.result.to, 'DAY_1_08:20');
  assert.deepEqual({ ...viaModel.run, updatedAt: 0 }, { ...viaButton, updatedAt: 0 });
  assert.equal(run.player.locationId, 'apartment', 'el handler no muta la partida recibida');

  const waited = await gameRegistry.execute('wait', { minutes: 5000 }, ctxOf(run), { role: 'gm' });
  assert.equal(waited.result.minutes, 480, 'el motor ajusta el tiempo al rango permitido');
  assert.equal(applyAction(run, { type: 'wait', minutes: 'mucho' }, worldData).world.minute, 30, 'valor ilegible = 30 minutos');
  assert.equal((await gameRegistry.execute('sleep', {}, ctxOf(run))).run.world.day, 1, 'dormir 8 h desde las 8:00 llega a las 16:00');
  assert.equal(applyAction(run, { type: 'sleep' }, worldData).world.hour, 16);

  const rejectedWork = await gameRegistry.execute('work', {}, ctxOf(run), { role: 'gm' });
  assert.deepEqual([rejectedWork.ok, rejectedWork.code], [false, 'no_job']);
  const employed = structuredClone(run); employed.player.occupation = 'worker';
  const worked = await gameRegistry.execute('work', {}, ctxOf(employed), { role: 'gm' });
  assert.equal(worked.run.player.money, 120);
  assert.equal(worked.result.earned, 60);
  assert.equal(worked.run.eventLog.at(-1).type, 'worked');
});

test('the engine rejects with a reason (and a hint) instead of letting the model invent outcomes', async () => {
  const run = newRun();
  const unknown = await gameRegistry.execute('travel', { place: 'atlantis' }, ctxOf(run), { role: 'gm' });
  assert.deepEqual([unknown.ok, unknown.code], [false, 'unknown_place']);
  assert.match(unknown.hint, /cafe/);
  assert.equal((await gameRegistry.execute('travel', { place: 'apartment' }, ctxOf(run))).code, 'already_there');
  assert.equal((await gameRegistry.execute('travel', {}, ctxOf(run))).code, 'bad_arguments');
  assert.equal((await gameRegistry.execute('free_action', {}, ctxOf(run))).code, 'bad_arguments');
  assert.equal((await gameRegistry.execute('free_action', { text: '   ' }, ctxOf(run))).code, 'empty_action');
  assert.equal((await gameRegistry.execute('free_action', { text: 'Miro el techo' }, ctxOf(run), { role: 'gm' })).code, 'unknown_tool', 'la acción libre es solo de la interfaz');
  assert.throws(() => applyAction(run, { type: 'travel', locationId: 'atlantis' }, worldData), /desconocida/);
  assert.throws(() => applyAction(run, { type: 'freeform', text: '' }, worldData), /Escribe una acción/);
  const talking = startEncounter({ ...run, player: { ...run.player, locationId: 'cafe' } }, luna, { say: 'Hola.' });
  for (const [name, args] of [['travel', { place: 'park' }], ['wait', {}], ['sleep', {}], ['work', {}], ['free_action', { text: 'x' }]]) {
    assert.equal((await gameRegistry.execute(name, args, ctxOf(talking))).code, 'ENCOUNTER_ACTIVE', `${name} está bloqueada en plena conversación`);
  }
});

test('start_conversation only works with someone present and delegates the opening to the server', async () => {
  const run = newRun(); run.player.locationId = 'cafe';
  const opened = [];
  const openConversation = async (current, npc) => { opened.push(npc.id); return startEncounter(current, npc, { say: 'Buenas.' }); };
  const ok = await gameRegistry.execute('start_conversation', { npcId: 'luna_serp' }, ctxOf(run, { openConversation }), { role: 'gm' });
  assert.equal(ok.ok, true);
  assert.equal(ok.run.encounter.npcId, 'luna_serp');
  assert.deepEqual(opened, ['luna_serp']);
  const away = await gameRegistry.execute('start_conversation', { npcId: 'luna_serp' }, ctxOf({ ...run, player: { ...run.player, locationId: 'park' } }, { openConversation }));
  assert.deepEqual([away.ok, away.code], [false, 'not_present']);
  assert.equal((await gameRegistry.execute('start_conversation', { npcId: 'fantasma' }, ctxOf(run, { openConversation }))).code, 'not_present');
  const again = await gameRegistry.execute('start_conversation', { npcId: 'luna_serp' }, ctxOf(ok.run, { openConversation }));
  assert.deepEqual([again.code, again.status], ['ENCOUNTER_ACTIVE', 409]);
  assert.equal(opened.length, 1, 'los rechazos no llegan a llamar al modelo');
  const failing = ctxOf(run, { openConversation: async () => { throw new AIError('IA caída'); } });
  await assert.rejects(gameRegistry.execute('start_conversation', { npcId: 'luna_serp' }, failing), { code: 'AI_UNAVAILABLE' });
});

test('share_contact needs a live conversation and every condition of the character card to be declared as met', async () => {
  const run = newRun(); run.player.locationId = 'cafe';
  const noTalk = await gameRegistry.execute('share_contact', { conditionsMet: [true, true] }, ctxOf(run), { role: 'character' });
  assert.equal(noTalk.code, 'no_conversation');
  const talking = startEncounter(run, luna, { say: 'Hola.' });
  assert.equal((await gameRegistry.execute('share_contact', { conditionsMet: [true, false] }, ctxOf(talking), { role: 'character' })).code, 'not_allowed');
  assert.equal((await gameRegistry.execute('share_contact', {}, ctxOf(talking), { role: 'character' })).code, 'not_allowed', 'sin declarar condiciones no se comparte');
  assert.equal((await gameRegistry.execute('share_contact', { conditionsMet: [true, true] }, ctxOf(talking), { role: 'gm' })).code, 'unknown_tool', 'el GM no comparte contactos por el personaje');
  const shared = await gameRegistry.execute('share_contact', { conditionsMet: [true, true] }, ctxOf(talking), { role: 'character' });
  assert.equal(shared.ok, true);
  assert.equal(shared.result.handle, '@LunaSerp');
  assert.equal(shared.run.relationships.luna_serp.contact, true);
  assert.deepEqual(shared.run.encounter.lines.at(-1).kind, 'contact');
  assert.ok(shared.run.eventLog.some((event) => event.type === 'contact_shared'));
  assert.equal((await gameRegistry.execute('share_contact', { conditionsMet: [true, true] }, ctxOf(shared.run), { role: 'character' })).code, 'not_allowed', 'no se comparte dos veces');
  assert.equal(talking.relationships.luna_serp.contact, false, 'la partida de entrada no se toca');
});

// --- Bucle y transportes ----------------------------------------------------------------------------------------------------------
const reply = (message, extra = {}) => ({ json: { choices: [{ message, finish_reason: 'stop', ...extra }] }, ms: 10, usage: { prompt: 100, completion: 20 } });
const toolCall = (name, args, id = `call_${name}`) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const messages = [{ role: 'system', content: 'Eres el GM.' }, { role: 'user', content: 'Voy a la cafetería.' }];
const gmState = () => ({ ...ctxOf(newRun()) });

test('native transport: the model calls a tool, the engine runs it, and the model narrates what really happened', async () => {
  const requests = [];
  const complete = async (config, body) => {
    requests.push(structuredClone(body));
    return requests.length === 1 ? reply({ content: null, tool_calls: [toolCall('travel', { place: 'cafe' })] }) : reply({ content: 'Llegas a Luna\'s Coffee a las 8:20.' });
  };
  const chat = createToolChat(complete);
  const state = gmState();
  const result = await chat({ model: 'm' }, messages, { registry: gameRegistry, state, role: 'gm' });
  assert.equal(result.text, 'Llegas a Luna\'s Coffee a las 8:20.');
  assert.equal(result.mode, 'native');
  assert.equal(state.run.player.locationId, 'cafe');
  assert.equal(result.run, state.run);
  assert.deepEqual(result.calls.map((call) => [call.tool, call.ok]), [['travel', true]]);
  assert.equal(result.steps, 2);
  assert.deepEqual(result.usage, { prompt: 200, completion: 40 });
  assert.deepEqual(requests[0].tools.map((tool) => tool.function.name), gameRegistry.names('gm'));
  assert.ok(requests[0].tools.some((tool) => tool.function.name === 'travel'));
  assert.equal(requests[0].tool_choice, 'auto');
  const second = requests[1].messages;
  assert.equal(second.at(-2).role, 'assistant');
  assert.equal(second.at(-1).role, 'tool');
  assert.equal(second.at(-1).tool_call_id, 'call_travel');
  assert.deepEqual(JSON.parse(second.at(-1).content), { ok: true, place: 'cafe', name: "Luna's Coffee", minutes: 20, from: 'DAY_1_08:00', to: 'DAY_1_08:20' });
});

test('a rejection goes back to the model as information, and bad or unknown calls never change the game', async () => {
  const rounds = [
    [toolCall('travel', { place: 'atlantis' }, 'a'), toolCall('travel', '{no es json', 'b'), toolCall('teleport', {}, 'c'), toolCall('work', {}, 'd')],
    null
  ];
  const seen = [];
  const complete = async (config, body) => {
    seen.push(body);
    const round = rounds[seen.length - 1];
    return round ? reply({ content: '', tool_calls: round }) : reply({ content: 'No puedes: eso no existe, ni tienes trabajo.' });
  };
  const state = gmState(); const before = state.run;
  const result = await createToolChat(complete)({ model: 'm' }, messages, { registry: gameRegistry, state, role: 'gm' });
  assert.equal(state.run, before, 'ningún rechazo cambia la partida');
  assert.deepEqual(result.calls.map((call) => call.code), ['unknown_place', 'bad_arguments', 'unknown_tool', 'no_job']);
  const toolMessages = seen[1].messages.filter((message) => message.role === 'tool').map((message) => JSON.parse(message.content));
  assert.equal(toolMessages.length, 4);
  assert.ok(toolMessages.every((message) => message.ok === false && message.reason));
  assert.match(toolMessages[0].hint, /Lugares válidos/);
});

test('the loop has a step cap: the last request cannot call tools and the model must narrate', async () => {
  const seen = [];
  const complete = async (config, body) => {
    seen.push(body);
    const last = body.tool_choice === 'none';
    return reply({ content: last ? 'Pasas la tarde esperando.' : '', tool_calls: last ? undefined : [toolCall('wait', { minutes: 30 }, `w${seen.length}`)] });
  };
  const state = gmState();
  const result = await createToolChat(complete)({ model: 'm' }, messages, { registry: gameRegistry, state, role: 'gm' });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen.map((body) => body.tool_choice), ['auto', 'auto', 'none']);
  assert.equal(result.text, 'Pasas la tarde esperando.');
  assert.equal(state.run.world.minute, 0, 'dos esperas de 30 min desde las 8:00 = 9:00');
  assert.equal(state.run.world.hour, 9);
  // aunque el modelo insista en llamar herramientas en el último paso, no se ejecutan
  const stubborn = async () => reply({ content: 'Siempre llamo.', tool_calls: [toolCall('wait', { minutes: 30 })] });
  const insistent = gmState();
  const capped = await createToolChat(stubborn)({ model: 'm' }, messages, { registry: gameRegistry, state: insistent, role: 'gm', maxSteps: 1 });
  assert.equal(capped.calls.length, 0);
  assert.equal(insistent.run.world.hour, 8);
});

test('at most four calls are executed per step', async () => {
  let n = 0;
  const complete = async () => (n++ === 0 ? reply({ content: '', tool_calls: Array.from({ length: 6 }, (_, index) => toolCall('wait', { minutes: 5 }, `c${index}`)) }) : reply({ content: 'Listo.' }));
  const state = gmState();
  const result = await createToolChat(complete)({ model: 'm' }, messages, { registry: gameRegistry, state, role: 'gm' });
  assert.equal(result.calls.filter((call) => call.ok).length, 4);
  assert.deepEqual(result.calls.slice(4).map((call) => call.code), ['too_many_calls', 'too_many_calls']);
  assert.equal(state.run.world.minute, 20);
});

test('fire-and-forget tools (share_contact) come with the dialogue and need no second round trip', async () => {
  const run = newRun(); run.player.locationId = 'cafe';
  const state = ctxOf(startEncounter(run, luna, { say: 'Hola.' }));
  let requests = 0;
  const complete = async () => { requests += 1; return reply({ content: 'Claro, anota: @LunaSerp.', tool_calls: [toolCall('share_contact', { conditionsMet: [true, true] })] }); };
  const result = await createToolChat(complete)({ model: 'm' }, messages, { registry: gameRegistry, state, role: 'character' });
  assert.equal(requests, 1);
  assert.equal(result.text, 'Claro, anota: @LunaSerp.');
  assert.equal(state.run.relationships.luna_serp.contact, true);
  // sin texto no hay nada que mostrar: se devuelve el resultado al modelo para que escriba el diálogo
  const quiet = ctxOf(startEncounter(run, luna, { say: 'Hola.' }));
  let n = 0;
  const silent = async () => (n++ === 0 ? reply({ content: null, tool_calls: [toolCall('share_contact', { conditionsMet: [true, true] })] }) : reply({ content: 'Aquí tienes.' }));
  assert.equal((await createToolChat(silent)({ model: 'm' }, messages, { registry: gameRegistry, state: quiet, role: 'character' })).text, 'Aquí tienes.');
});

test('JSON fallback codec: {say, calls} runs the same tools and asks for the final text with the engine results', async () => {
  const seen = [];
  const complete = async (config, body) => {
    seen.push(structuredClone(body));
    return seen.length === 1
      ? reply({ content: '```json\n{"say":"Voy…","calls":[{"tool":"travel","args":{"place":"cafe"}}]}\n```' })
      : reply({ content: '{"say":"Llegas al café a las 8:20.","calls":[]}' });
  };
  const state = gmState();
  const result = await createToolChat(complete)({ model: 'sin-tools' }, messages, { registry: gameRegistry, state, role: 'gm', mode: 'json' });
  assert.equal(result.mode, 'json');
  assert.equal(result.text, 'Llegas al café a las 8:20.');
  assert.equal(state.run.player.locationId, 'cafe');
  assert.ok(seen.every((body) => !('tools' in body)), 'el codec de reserva no envía `tools`');
  assert.match(seen[0].messages[0].content, /^Eres el GM\.\n\nProtocolo de herramientas/);
  assert.match(seen[0].messages[0].content, /- travel\(place: string\) \[acción\]/);
  assert.equal(seen[0].messages.filter((message) => message.role === 'system').length, 1);
  assert.match(seen[1].messages.at(-1).content, /^\[Resultados del motor\]\n\[\{"tool":"travel","ok":true,"place":"cafe"/);
  // sin mensaje de sistema inicial, el protocolo se antepone
  const bare = await createToolChat(async (config, body) => { seen.push(body); return reply({ content: '{"say":"Ok","calls":[]}' }); })({ model: 'x' }, [{ role: 'user', content: 'hola' }], { registry: gameRegistry, state: gmState(), role: 'gm', mode: 'json' });
  assert.equal(bare.text, 'Ok');
  assert.equal(seen.at(-1).messages[0].role, 'system');
});

test('JSON fallback codec: a model that ignores the protocol still narrates, and the last step ignores calls', async () => {
  const plain = createToolChat(async () => reply({ content: 'Simplemente caminas hasta el café.' }));
  const state = gmState();
  const result = await plain({ model: 'm' }, messages, { registry: gameRegistry, state, role: 'gm', mode: 'json' });
  assert.deepEqual([result.text, result.unparsed, result.calls.length], ['Simplemente caminas hasta el café.', true, 0]);
  const insistent = createToolChat(async () => reply({ content: '{"say":"otra vez","calls":[{"tool":"wait","args":{"minutes":30}}]}' }));
  const bounded = gmState();
  const run = await insistent({ model: 'm' }, messages, { registry: gameRegistry, state: bounded, role: 'gm', mode: 'json', maxSteps: 2 });
  assert.equal(run.steps, 2);
  assert.equal(run.calls.length, 1, 'el segundo (último) paso no ejecuta llamadas');
  assert.equal(bounded.run.world.minute, 30);
  const fire = ctxOf(startEncounter({ ...newRun(), player: { ...newRun().player, locationId: 'cafe' } }, luna, { say: 'Hola.' }));
  let requests = 0;
  const share = createToolChat(async () => { requests += 1; return reply({ content: '{"say":"Mi usuario es @LunaSerp.","calls":[{"tool":"share_contact","args":{"conditionsMet":[true,true]}}]}' }); });
  const done = await share({ model: 'm' }, messages, { registry: gameRegistry, state: fire, role: 'character', mode: 'json' });
  assert.deepEqual([requests, done.text, fire.run.relationships.luna_serp.contact], [1, 'Mi usuario es @LunaSerp.', true]);
});

test('auto mode tries native tools first and remembers per model when the provider refuses them', async () => {
  const log = [];
  const complete = async (config, body) => {
    log.push([config.model, 'tools' in body]);
    if ('tools' in body) throw new AIError('modelo sin tools', 'AI_MODEL', 400);
    return reply({ content: '{"say":"Hecho.","calls":[]}' });
  };
  const chat = createToolChat(complete);
  const options = () => ({ registry: gameRegistry, state: gmState(), role: 'gm' });
  const first = await chat({ model: 'viejo' }, messages, options());
  assert.deepEqual([first.mode, first.text], ['json', 'Hecho.']);
  const second = await chat({ model: 'viejo' }, messages, options());
  assert.equal(second.mode, 'json');
  assert.deepEqual(log, [['viejo', true], ['viejo', false], ['viejo', false]], 'la segunda vez ni se intenta el modo nativo');
  await assert.rejects(chat({ model: 'otro' }, messages, { ...options(), mode: 'native' }), { code: 'AI_MODEL' });
  assert.equal((await chat({ model: 'otro' }, messages, options())).mode, 'json');
});

test('a failure in the middle of the loop propagates, and so does a cancellation', async () => {
  let n = 0;
  const failing = async () => { if (n++ === 0) return reply({ content: '', tool_calls: [toolCall('wait', { minutes: 5 })] }); throw new AIError('NanoGPT no está disponible', 'AI_UNAVAILABLE'); };
  await assert.rejects(createToolChat(failing)({ model: 'm' }, messages, { registry: gameRegistry, state: gmState(), role: 'gm' }), { code: 'AI_UNAVAILABLE' });
  const aborted = async () => { throw new AIError('Generación detenida.', 'AI_ABORTED', 499); };
  await assert.rejects(createToolChat(aborted)({ model: 'm' }, messages, { registry: gameRegistry, state: gmState(), role: 'gm' }), { code: 'AI_ABORTED' });
  const empty = async () => reply({ content: '   ' });
  await assert.rejects(createToolChat(empty)({ model: 'm' }, messages, { registry: gameRegistry, state: gmState(), role: 'gm' }), { code: 'AI_RESPONSE' });
});

test('reasoning models that run out of tokens get one retry with a bigger budget', async () => {
  const budgets = [];
  const complete = async (config, body) => { budgets.push(body.max_tokens); return budgets.length === 1 ? reply({ content: '' }, { finish_reason: 'length' }) : reply({ content: 'Ya.' }); };
  const result = await createToolChat(complete)({ model: 'm' }, messages, { registry: gameRegistry, state: gmState(), role: 'gm', maxTokens: 500 });
  assert.equal(result.text, 'Ya.');
  assert.deepEqual(budgets, [7000, 28000]);
});

test('provider.chatWithTools talks to chat/completions with tools and records the call for the dev trace', async () => {
  const bodies = [];
  const recorded = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    const message = bodies.length === 1 ? { content: null, tool_calls: [toolCall('sleep', {})] } : { content: 'Despiertas a las 16:00.' };
    return { ok: true, json: async () => ({ choices: [{ message, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } }) };
  };
  const ai = createNanoGPT(fetchImpl, { prompts: { get: () => ({}), record: (entry) => recorded.push(entry) } });
  const state = gmState();
  const result = await ai.chatWithTools({ apiKey: 'k', model: 'deepseek/x' }, messages, { registry: gameRegistry, state, role: 'gm', params: { temperature: 0.7 } });
  assert.equal(result.text, 'Despiertas a las 16:00.');
  assert.equal(state.run.world.hour, 16);
  assert.equal(bodies[0].model, 'deepseek/x');
  assert.equal(bodies[0].temperature, 0.7);
  assert.equal(bodies[0].tools.length, gameRegistry.names('gm').length);
  assert.deepEqual([recorded[0].kind, recorded[0].mode, recorded[0].meta.transport, recorded[0].meta.steps, recorded[0].meta.calls[0].tool], ['tools', 'gm', 'native', 2, 'sleep']);
  assert.deepEqual(recorded[0].meta.usage, { prompt: 100, completion: 10, total: 110 });
  await assert.rejects(ai.chatWithTools({ apiKey: '', model: 'm' }, messages, { registry: gameRegistry, state: gmState(), role: 'gm' }), { code: 'AI_CONFIGURATION_REQUIRED' });
  assert.equal(recorded.at(-1).error.length > 0, true, 'los fallos también quedan en la traza');
});

// --- Modelos reales: protocolo por modelo y errores del proveedor ----------------------------------------------------------------------
import { mkdtemp } from 'node:fs/promises';
import { defaultPreset } from '../src/server/ai/composer.js';
import os from 'node:os';
import { NANOGPT_HOSTS } from '../src/server/ai/provider.js';
import { createSettingsStore, DEFAULT_TOOL_MODES } from '../src/server/ai/settings.js';

test('each model has its own tool protocol: known defaults, per-model overrides that survive saving, and back to default with auto', async () => {
  const settings = createSettingsStore(await mkdtemp(path.join(os.tmpdir(), 'hom-settings-')));
  const spark = 'meta/muse-spark-1.3-contributor'; const deepseek = 'deepseek/deepseek-v4.1-flash';
  assert.equal(DEFAULT_TOOL_MODES[spark], 'json');
  assert.equal(DEFAULT_TOOL_MODES[deepseek], 'native');
  await assert.rejects(settings.setToolMode(spark, 'json'), { code: 'AI_CONFIGURATION_REQUIRED' }, 'sin conexión no hay dónde guardarlo');
  await settings.save({ apiKey: 'k', model: spark });
  assert.equal((await settings.require()).toolMode, 'json', 'Spark usa el protocolo JSON sin tocar nada');
  assert.deepEqual(await settings.toolMode(deepseek), { model: deepseek, mode: 'native', custom: false, default: 'native' });
  assert.equal((await settings.setToolMode(spark, 'native')).mode, 'native');
  await settings.save({ apiKey: 'k', model: spark }, { verified: true });
  assert.equal((await settings.require()).toolMode, 'native', 'guardar los ajustes no borra el protocolo elegido');
  await settings.save({ apiKey: 'k', model: 'meituan/longcat-2.5-preview' });
  assert.equal((await settings.require()).toolMode, 'auto', 'un modelo desconocido prueba nativo y recuerda');
  assert.equal((await settings.setToolMode(spark, 'auto')).mode, 'json', 'auto vuelve al valor por defecto del modelo');
  await assert.rejects(settings.setToolMode(spark, 'xml'), { code: 'INVALID_REQUEST' });
  await assert.rejects(settings.setToolMode('no valido!', 'json'), { code: 'AI_MODEL' });
});

test('act() uses the protocol saved for the model: json never sends `tools`, native does', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: sent.at(-1).tools ? 'Narro.' : '{"say":"Narro.","calls":[]}' }, finish_reason: 'stop' }] }) }; };
  const ai = createNanoGPT(fetchImpl, { prompts: { get: (kind) => defaultPreset(kind), record() {} } });
  const plan = { kind: 'gm', mode: 'free', format: 'f', data: {}, macros: {} };
  const run = async (toolMode) => ai.act(plan, { registry: gameRegistry, state: gmState() }, { apiKey: 'k', model: `m-${toolMode}`, toolMode });
  assert.equal((await run('json')).text, 'Narro.');
  assert.equal('tools' in sent.at(-1), false);
  assert.equal((await run('native')).text, 'Narro.');
  assert.equal('tools' in sent.at(-1), true);
});

test('provider errors keep the reason the provider gave, and a rejected token cap is retried once with a safe one', async () => {
  const bodies = [];
  const failing = (message) => async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: false, status: 400, json: async () => ({ error: { message } }) }; };
  const aiLimit = createNanoGPT(async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return bodies.at(-1).max_tokens > 8192 ? { ok: false, status: 400, json: async () => ({ error: { message: 'max_tokens must be <= 8192 for this model, sk-secret-key' } }) } : { ok: true, json: async () => ({ choices: [{ message: { content: 'Hola.' }, finish_reason: 'stop' }] }) };
  }, { prompts: { get: () => ({}), record() {} } });
  assert.equal(await aiLimit.chat({ apiKey: 'sk-secret-key', model: 'meituan/longcat-2.5-preview' }, [{ role: 'user', content: 'hi' }], 3000), 'Hola.');
  assert.deepEqual(bodies.map((body) => body.max_tokens), [22000, 8192], 'el motor pide margen de razonamiento; el proveedor lo rechaza y se baja una vez');

  bodies.length = 0;
  const ai = createNanoGPT(failing('temperature out of range (key sk-secret-key)'), { prompts: { get: () => ({}), record() {} } });
  const error = await ai.chat({ apiKey: 'sk-secret-key', model: 'meituan/longcat-2.5-preview' }, [{ role: 'user', content: 'hi' }], 3000).catch((failure) => failure);
  assert.equal(error.code, 'AI_MODEL');
  assert.match(error.message, /Motivo del proveedor: «temperature out of range/);
  assert.doesNotMatch(error.message, /sk-secret-key/, 'la API key nunca viaja en un mensaje');
  assert.equal(bodies.length, 1, 'un 400 que no habla de tokens no se reintenta');
});

test('a model missing from one NanoGPT host is tried on the other, remembered, and the catalog merges both hosts', async () => {
  const urls = [];
  const model = 'longcat-2.5-preview';
  const onlyOnWeb = async (url, init) => {
    urls.push(url);
    if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: url.startsWith(NANOGPT_HOSTS.web) ? [{ id: model }, { id: 'a/shared' }] : [{ id: 'a/shared' }, { id: 'b/direct-only' }] }) };
    if (url.startsWith(NANOGPT_HOSTS.direct)) return { ok: false, status: 400, json: async () => ({ error: { message: `Model ${model} is not supported on /v1/chat/completions.` } }) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'Hola.' }, finish_reason: 'stop' }] }) };
  };
  const ai = createNanoGPT(onlyOnWeb, { prompts: { get: () => ({}), record() {} } });
  const ask = () => ai.chat({ apiKey: 'sk-k', model }, [{ role: 'user', content: 'hi' }], 500);
  assert.equal(await ask(), 'Hola.');
  assert.deepEqual(urls.map((url) => new URL(url).host), ['api.nano-gpt.com', 'nano-gpt.com']);
  urls.length = 0;
  assert.equal(await ask(), 'Hola.');
  assert.deepEqual(urls.map((url) => new URL(url).host), ['nano-gpt.com'], 'la segunda vez va directo al host que funciona');
  assert.deepEqual((await ai.models('sk-k')).map(({ id }) => id), ['a/shared', 'b/direct-only', model], 'catálogo unido, sin duplicados');
  assert.ok(urls.every((url) => Object.values(NANOGPT_HOSTS).some((host) => url.startsWith(host + '/'))), 'solo hosts fijos');

  // Si ningún host lo conoce, el error es el del host habitual (con su motivo); un fallo de otro tipo en el segundo host no se disfraza.
  const unknown = createNanoGPT(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Model nada is not supported on /v1/chat/completions.' } }) }), { prompts: { get: () => ({}), record() {} } });
  await assert.rejects(unknown.chat({ apiKey: 'k', model: 'nada' }, [{ role: 'user', content: 'hi' }], 500), (error) => error.code === 'AI_MODEL' && /Motivo del proveedor: «Model nada is not supported/.test(error.message));
  let n = 0;
  const authOnSecond = createNanoGPT(async () => (n++ === 0 ? { ok: false, status: 400, json: async () => ({ error: { message: 'Model x is not supported on /v1/chat/completions.' } }) } : { ok: false, status: 401, json: async () => ({}) }), { prompts: { get: () => ({}), record() {} } });
  await assert.rejects(authOnSecond.chat({ apiKey: 'k', model: 'x' }, [{ role: 'user', content: 'hi' }], 500), { code: 'AI_AUTH' });
  // el catálogo sigue funcionando si un host está caído
  const oneDown = createNanoGPT(async (url) => (url.startsWith(NANOGPT_HOSTS.web) ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, json: async () => ({ data: [{ id: 'z/ok' }] }) }), { prompts: { get: () => ({}), record() {} } });
  assert.deepEqual((await oneDown.models('k')).map(({ id }) => id), ['z/ok']);
});
