import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { KINDS, kindNames, defaultPreset, normalizePreset, compose, expand, importSillyTavern } from '../src/server/ai/composer.js';
import { characterPlan, evaluationPlan, socialPlan } from '../src/server/ai/plans.js';
import { createPromptStore } from '../src/server/ai/promptStore.js';
import { createNanoGPT } from '../src/server/ai/provider.js';
import { createAppServer } from '../src/server/index.js';
import { fixtureGeography } from './support/world.js';
import { createRun } from '../src/server/game/run.js';

const npc = { id: 'luna_serp', name: 'Luna Serp', role: 'Barista', summary: 'Dueña del café.', personality: { traits: ['cálida'] }, appearance: 'Ojos verdes', knowledge: [], secrets: [], connections: [] };
const player = { name: 'Daekko', age: 24, gender: 'man', appearance: 'Abrigo largo' };
const relationship = (extra = {}) => ({ encounters: 1, notes: [], knows: [], ...extra });
const temporal = { ahora: 'día 1 (lunes), 09:00', ultimaConversacion: null };
const dialogue = (extra = {}) => ({
  npc, player, location: { name: "Luna's Coffee", description: 'Un café cálido.' }, relationship: relationship(), attitude: 'neutral', temporal, memories: [], history: [],
  emotions: ['feliz'], stickyEmotions: [], contact: { yaCompartido: false }, commitments: [], mode: 'reply',
  transcript: [{ who: 'player', text: 'Hola, me llamo Daekko' }], ...extra
});
const text = (messages) => messages.map((message) => message.content).join('\n---\n');

test('every prompt has a factory preset that survives normalisation unchanged and always ends up with a user message', () => {
  for (const kind of kindNames) {
    const preset = defaultPreset(kind);
    assert.deepEqual(normalizePreset(kind, preset), preset, `${kind}: normalizar no cambia el preset de fábrica`);
    for (const { id } of KINDS[kind].modes) assert.ok(preset.tasks[id], `${kind}/${id}: tiene instrucción de turno`);
    assert.ok(preset.modules.some((item) => item.auto === 'format') && preset.modules.some((item) => item.auto === 'task'));
  }
  assert.ok(defaultPreset('text').modules.every((item) => !['emotions', 'contact'].includes(item.auto)), 'el chat de texto no lleva emociones ni contacto');
});

test('the character prompt shows the character only what it knows: the player real name never leaks, a given name does', () => {
  const unknown = text(compose('character', 'reply', defaultPreset('character'), characterPlan(dialogue())));
  assert.match(unknown, /You are Luna Serp:/, '{{char}} se expande');
  assert.match(unknown, /natural, neutral contemporary Spanish/i, 'el idioma se pide en un módulo separado');
  assert.match(unknown, /"nombreQueTeDio":null/);
  assert.ok(unknown.includes('Daekko'), 'el nombre sí aparece donde el jugador lo dijo en la conversación');
  const noTalk = text(compose('character', 'reply', defaultPreset('character'), characterPlan(dialogue({ transcript: [{ who: 'player', text: 'Hola' }] }))));
  assert.ok(!noTalk.includes('Daekko'), 'el nombre real del jugador no sale si no lo dijo');
  assert.match(expand('Hola {{user}}', characterPlan(dialogue()).macros), /la otra persona/);
  const named = characterPlan(dialogue({ relationship: relationship({ knownName: 'Dae' }) }));
  assert.equal(named.macros.user, 'Dae');
  assert.ok(!('player' in named.macros), 'la macro {{player}} no existe para el personaje');
  assert.match(text(compose('character', 'reply', defaultPreset('character'), { ...named, macros: { char: 'Luna', user: 'Dae' } })), /"nombreQueTeDio":"Dae"/);
});

test('modules can be reordered, disabled, restricted to turn types and merged by role', () => {
  const plan = characterPlan(dialogue());
  const preset = structuredClone(defaultPreset('character'));
  const baseline = compose('character', 'reply', preset, plan);
  assert.equal(baseline[0].role, 'system');
  assert.equal(baseline.at(-1).role, 'user');
  assert.ok(baseline.every((message, index) => index === 0 || message.role !== baseline[index - 1].role), 'sin mensajes consecutivos con el mismo rol');

  preset.modules.push({ id: 'extra', name: 'Solo al abrir', type: 'text', role: 'system', enabled: true, content: 'EXTRA {{char}}', modes: ['open'] });
  assert.ok(!text(compose('character', 'reply', preset, plan)).includes('EXTRA'));
  assert.match(text(compose('character', 'open', preset, plan)), /EXTRA Luna Serp/);

  const first = preset.modules.findIndex((item) => item.auto === 'history'); const second = preset.modules.findIndex((item) => item.auto === 'card');
  [preset.modules[first], preset.modules[second]] = [preset.modules[second], preset.modules[first]];
  const reordered = text(compose('character', 'reply', preset, plan));
  assert.ok(reordered.indexOf('"conversacion"') < reordered.indexOf('"tu"'), 'el orden de los módulos cambia el orden del prompt');

  preset.modules.find((item) => item.auto === 'card').enabled = false;
  assert.ok(!text(compose('character', 'reply', preset, plan)).includes('"tu"'));
  const edited = structuredClone(defaultPreset('character')); edited.tasks.reply = 'Contesta como {{char}} en una sola frase.';
  assert.match(text(compose('character', 'reply', edited, plan)), /Contesta como Luna Serp en una sola frase\./);
  assert.match(text(compose('character', 'reply', edited, { ...plan, instruction: 'Instrucción puntual' })), /Instrucción puntual/, 'una instrucción puntual manda sobre la del preset');
});

test('normalisation protects what the engine needs: format and task are always present, junk is dropped', () => {
  const messy = normalizePreset('gm', {
    modules: [
      { id: 'a', type: 'text', name: '', role: 'wizard', content: 'hola', enabled: true },
      { id: 'a', type: 'auto', auto: 'history', role: 'user' },
      { type: 'auto', auto: 'history', role: 'user' },
      { type: 'auto', auto: 'nope' },
      'basura', null,
      { id: 'f', type: 'auto', auto: 'format', enabled: false, modes: ['chats'] }
    ],
    tasks: { evaluation: 'x'.repeat(100000), nada: 'ignorada' }, params: { temperature: 7, top_p: 0.9 }
  });
  assert.equal(messy.modules[0].role, 'system'); assert.equal(messy.modules[0].name, 'Módulo');
  assert.equal(new Set(messy.modules.map((item) => item.id)).size, messy.modules.length, 'ids únicos');
  assert.equal(messy.modules.filter((item) => item.auto === 'history').length, 1, 'un módulo automático no se repite');
  const format = messy.modules.find((item) => item.auto === 'format');
  assert.equal(format.enabled, true); assert.equal(format.modes, undefined);
  assert.ok(messy.modules.some((item) => item.auto === 'task'), 'la instrucción del turno se restaura');
  assert.equal(messy.tasks.evaluation.length, 60000);
  assert.ok(messy.tasks.free, 'lo que falta se completa con la fábrica');
  assert.deepEqual(messy.params, { top_p: 0.9 }, 'temperatura fuera de rango se descarta');
  assert.deepEqual(normalizePreset('social', 'no es un objeto').modules.map((item) => item.auto ?? item.id), defaultPreset('social').modules.map((item) => item.auto ?? item.id));
});

test('the GM prompt keeps the GM role separate and sees the real player name', () => {
  const messages = compose('gm', 'evaluation', defaultPreset('gm'), evaluationPlan({ ...dialogue(), locations: [], commitments: [] }));
  const joined = text(messages);
  assert.match(joined, /narrative and semantic interpreter/i);
  assert.match(joined, /Return only JSON with this shape/);
  assert.match(joined, /"conversacion"/);
  const feed = compose('social', 'post', defaultPreset('social'), socialPlan({ mode: 'post', ahora: 'día 1', cuentas: [{ usuario: '@RexNova', popularidad: 99 }], jugador: { usuario: '@Mara', nombre: 'Mara', popularidad: 5 } }));
  assert.match(text(feed), /NorthLife/); assert.match(text(feed), /"posts"/); assert.match(text(feed), /"cuentas"/); assert.match(text(feed), /RexNova/);
});

test('a SillyTavern preset imports as modules: text kept, markers mapped to game data, format and task appended', () => {
  const st = {
    temperature: 0.9, top_p: 0.95,
    prompts: [
      { identifier: 'main', name: 'Main Prompt', role: 'system', content: 'Eres {{char}}. Habla con {{user}}.' },
      { identifier: 'charDescription', name: 'Char Description', marker: true },
      { identifier: 'personaDescription', name: 'Persona Description', marker: true },
      { identifier: 'worldInfoBefore', name: 'World Info (before)', marker: true },
      { identifier: 'worldInfoAfter', name: 'World Info (after)', marker: true },
      { identifier: 'dialogueExamples', name: 'Chat Examples', marker: true },
      { identifier: 'chatHistory', name: 'Chat History', marker: true },
      { identifier: 'nsfw', name: 'Auxiliary Prompt', role: 'system', content: '' },
      { identifier: 'abc', name: 'Character Engine', role: 'system', content: 'Motor de personaje.' },
      { identifier: 'def', name: 'Apagado', role: 'user', content: 'No se usa.' },
      { identifier: 'jailbreak', name: 'Post-History', role: 'system', content: 'Recuerda el formato.' }
    ],
    prompt_order: [{ character_id: 1, order: [{ identifier: 'main', enabled: false }] }, { character_id: 2, order: [
      { identifier: 'main', enabled: true }, { identifier: 'worldInfoBefore', enabled: true }, { identifier: 'personaDescription', enabled: true }, { identifier: 'charDescription', enabled: true },
      { identifier: 'abc', enabled: true }, { identifier: 'dialogueExamples', enabled: true }, { identifier: 'chatHistory', enabled: true }, { identifier: 'def', enabled: false },
      { identifier: 'nsfw', enabled: true }, { identifier: 'jailbreak', enabled: true }, { identifier: 'worldInfoAfter', enabled: true }
    ] }]
  };
  const { preset, report } = importSillyTavern('character', st, defaultPreset('character'));
  const names = preset.modules.map((item) => item.auto ?? item.name);
  assert.deepEqual(names.slice(0, 6), ['Main Prompt', 'Idioma de respuesta', 'world', 'persona', 'card', 'Character Engine'], 'respeta el orden del último prompt_order y conserva el módulo de idioma');
  assert.equal(preset.modules.find((item) => item.name === 'Apagado').enabled, false, 'conserva lo desactivado');
  assert.ok(!names.includes('Auxiliary Prompt'), 'un módulo vacío se omite');
  assert.ok(names.indexOf('relationship') < names.indexOf('history'), 'los datos del juego que faltaban van antes de la conversación');
  assert.deepEqual(names.slice(-2), ['format', 'task']);
  assert.ok(names.includes('Reglas del motor'), 'las reglas del motor sobreviven a un prompt principal ajeno');
  assert.equal(preset.modules.filter((item) => item.auto === 'card').length, 1);
  assert.equal(preset.params.temperature, 0.9);
  assert.ok(report.length >= 3);
  assert.match(text(compose('character', 'reply', preset, characterPlan(dialogue()))), /Eres Luna Serp\. Habla con la otra persona\./);
  assert.throws(() => importSillyTavern('gm', { foo: 1 }), /SillyTavern/);
});

test('the provider sends the edited preset to the model, with its sampling params, and records what was sent', async () => {
  const sent = []; const log = [];
  const preset = structuredClone(defaultPreset('character'));
  preset.modules[0].content = 'PERSONALIZADO para {{char}}';
  preset.params = { temperature: 0.7, top_p: 0.9 };
  const ai = createNanoGPT(async (url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"say":"Hola, ¿qué te sirvo?"}' } }] }) };
  }, { prompts: { get: (kind) => (kind === 'character' ? preset : defaultPreset(kind)), record: (entry) => log.push(entry) } });
  const reply = await ai.npcReply(dialogue(), { apiKey: 'k', model: 'm' });
  assert.equal(reply.say, 'Hola, ¿qué te sirvo?');
  assert.match(sent[0].messages[0].content, /^PERSONALIZADO para Luna Serp/);
  assert.equal(sent[0].temperature, 0.7); assert.equal(sent[0].top_p, 0.9);
  assert.equal(log.length, 1); assert.equal(log[0].kind, 'character'); assert.equal(log[0].mode, 'reply'); assert.match(log[0].response, /qué te sirvo/);
  await ai.npcReply(dialogue({ mode: 'chat' }), { apiKey: 'k', model: 'm' });
  assert.equal(log[1].kind, 'text', 'el chat de mensajes usa su propio prompt');
  assert.equal(sent[1].temperature, undefined, 'sin parámetros propios no se envía ninguno');
});

test('dev API: list, edit, preview, import, log and reset prompts (and it stays closed without the dev header)', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hom-prompts-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const prompts = createPromptStore(dir);
  const runs = new Map();
  const run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' }); run.player.locationId = 'cafe'; run.world.hour = 9; runs.set(run.id, run);
  const server = createAppServer({ geography: fixtureGeography(), prompts, ai: { npcReply: async () => ({ say: 'x' }) }, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (item) => runs.set(item.id, structuredClone(item)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, method = body ? 'POST' : 'GET', dev = true) => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(dev ? { 'x-hom-dev': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };

  assert.equal((await call('/api/dev/prompts', null, 'GET', false)).status, 403);
  const listed = await call('/api/dev/prompts');
  assert.deepEqual(listed.body.kinds.map((item) => item.kind), ['character', 'text', 'gm', 'social']);
  assert.equal(listed.body.kinds[0].custom, false);
  assert.ok(listed.body.kinds[2].autos.find((item) => item.key === 'format').locked);

  const draft = structuredClone(listed.body.kinds[0].preset); draft.modules[0].content = 'Edición de prueba para {{char}}';
  const preview = await call('/api/dev/prompts/character/preview', { runId: run.id, mode: 'open', preset: draft });
  assert.equal(preview.status, 200);
  assert.match(preview.body.messages[0].content, /Edición de prueba para /);
  assert.ok(preview.body.approxTokens > 100);
  assert.equal((await call('/api/dev/prompts/gm/preview', { runId: run.id, mode: 'evaluation' })).status, 200);
  assert.equal((await call('/api/dev/prompts/gm/preview', { runId: run.id, mode: 'chats' })).status, 200);
  assert.equal((await call('/api/dev/prompts/social/preview', { runId: run.id })).status, 200);
  assert.equal((await call('/api/dev/prompts/text/preview', { runId: run.id, mode: 'chat' })).status, 200);

  const saved = await call('/api/dev/prompts/character', draft, 'PUT');
  assert.equal(saved.status, 200); assert.equal(saved.body.custom, true);
  assert.match(prompts.get('character').modules[0].content, /Edición de prueba/);
  assert.match(await readFile(path.join(dir, 'character.json'), 'utf8'), /Edición de prueba/);
  assert.match(createPromptStore(dir).get('character').modules[0].content, /Edición de prueba/, 'persiste entre arranques');
  assert.equal((await call('/api/dev/prompts/nope')).status, 404);

  const imported = await call('/api/dev/prompts/text/import', { text: JSON.stringify({ prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'Hola {{char}}' }], prompt_order: [{ order: [{ identifier: 'main', enabled: true }] }] }) });
  assert.equal(imported.status, 200); assert.equal(imported.body.preset.modules[0].content, 'Hola {{char}}');
  assert.equal(prompts.isCustom('text'), false, 'importar solo carga un borrador, no guarda');
  assert.equal((await call('/api/dev/prompts/text/import', { text: 'no json' })).status, 400);

  prompts.record({ kind: 'gm', mode: 'chats', messages: [], response: '{}' });
  assert.equal((await call('/api/dev/prompts/log')).body.entries[0].kind, 'gm');

  const reset = await call('/api/dev/prompts/character', null, 'DELETE');
  assert.equal(reset.body.custom, false);
  assert.ok(!prompts.get('character').modules[0].content.includes('Edición de prueba'));
});
