import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSpeech, stripMarks } from '../src/server/game/npcs.js';
import { createAppServer } from '../src/server/index.js';

const BS = '\\'; // las marcas de emoción llevan una barra invertida: [\feliz]

test('the {emotion} mark is the main syntax; brackets are only honoured for known emotions', () => {
  const braces = parseSpeech('{feliz} ¡Qué alegría verte! {triste} Pero ya me voy… {inventada} Cuídate.', ['feliz', 'triste']);
  assert.equal(braces.say, '¡Qué alegría verte! Pero ya me voy… Cuídate.', 'las marcas nunca se ven');
  assert.deepEqual(braces.segments.map((segment) => [segment.emotion, segment.text]), [['feliz', '¡Qué alegría verte! '], ['triste', 'Pero ya me voy… Cuídate.']]);
  assert.deepEqual(parseSpeech('Hola {Feliz} otra vez {DEFAULT} ya', ['feliz']).segments.map((segment) => segment.emotion), ['default', 'feliz', 'default'], 'sin distinguir mayúsculas ni acentos');
  assert.equal(parseSpeech('Dijo [risas] y sonrió', ['feliz']).say, 'Dijo [risas] y sonrió', 'un corchete que no es emoción se conserva como texto');
  assert.equal(parseSpeech('Dijo [feliz] y sonrió', ['feliz']).segments.length, 2, 'un corchete con una emoción disponible sí es marca');
  assert.deepEqual(parseSpeech('{feliz} Hola', []).segments, [], 'sin emociones no hay cambios');
  assert.equal(stripMarks('sonríe {feliz}  despacio'), 'sonríe despacio');
});

test('legacy backslash marks still work', () => {
  const marked = parseSpeech(`[${BS}feliz] ¡Hey, qué alegría verte! [${BS}preocupada] Oye, ¿estás bien? [${BS}inventada] Te ves cansado.`, ['feliz', 'preocupada']);
  assert.equal(marked.say, '¡Hey, qué alegría verte! Oye, ¿estás bien? Te ves cansado.');
  assert.deepEqual(marked.segments.map((segment) => segment.emotion), ['feliz', 'preocupada']);
  assert.equal(marked.segments[0].text, '¡Hey, qué alegría verte! ');
  assert.equal(marked.segments[1].text, 'Oye, ¿estás bien? Te ves cansado.', 'una marca desconocida mantiene la emoción anterior');

  const mid = parseSpeech(`Hola [comando ${BS}Feliz] otra vez [/default] ya`, ['feliz']);
  assert.deepEqual(mid.segments.map((segment) => segment.emotion), ['default', 'feliz', 'default']);
  assert.equal(mid.say, 'Hola otra vez ya');

  const plain = parseSpeech('Sin marcas, solo texto.', ['feliz']);
  assert.deepEqual(plain, { say: 'Sin marcas, solo texto.', segments: [] }, 'sin emociones se usa el sprite por defecto');
  assert.deepEqual(parseSpeech(`[${BS}feliz] Hola`, []).segments, [], 'sin lista de emociones las marcas se ignoran');
});

test('the character receives emotions and contact status (never the player\'s private actions) and can open with a contact offer and a private intent', async (t) => {
  const emotionFile = path.resolve('assets/portraits/luna_serp/zztest.png');
  await writeFile(emotionFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  t.after(() => rm(emotionFile, { force: true }));

  const runs = new Map(); const seen = [];
  let reply = { say: '{zztest} ¡Qué bueno verte! {nopuedo} Pasa.', intent: 'Quiero darle mi contacto si me ayuda a probar el pan.', contact: { give: true, conditionsMet: [true, true] } };
  const ai = {
    npcReply: async (context) => { seen.push(context); return context.mode === 'closing' ? { say: '{zztest} Hasta pronto' } : reply; },
    evaluateEncounter: async () => ({ notes: [], summary: 'ok' }),
    prologue: async () => ({ text: 'x', locationId: 'station' })
  };
  const server = createAppServer({ ai, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body) => { const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };

  const id = (await call('/api/runs', { name: 'Mara', age: 24, gender: 'woman', race: 'human' })).body.id;
  const stored = runs.get(id); stored.player.locationId = 'cafe'; stored.world.hour = 9;
  stored.eventLog.push({ time: 'DAY_1_08:50', type: 'player_action', data: { text: 'Entré con prisa por la lluvia' } }); runs.set(id, stored);

  const opened = await call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' });
  const context = seen.at(-1);
  assert.deepEqual(context.emotions, ['zztest'], 'el motor ofrece las emociones que existen como imagen');
  assert.equal(context.events, undefined, 'el personaje no recibe lo que el jugador hace por el mundo');
  assert.equal(JSON.stringify(context).includes('prisa por la lluvia'), false, 'ni sus acciones privadas');
  assert.equal(context.contact.yaCompartido, false);
  const line = opened.body.encounter.lines[0];
  assert.equal(line.text, '¡Qué bueno verte! Pasa.');
  assert.deepEqual(line.segments.map((segment) => segment.emotion), ['zztest']);
  assert.equal(opened.body.encounter.intent, 'Quiero darle mi contacto si me ayuda a probar el pan.');
  assert.equal(opened.body.relationships.luna_serp.contact, true, 'puede ofrecer su contacto desde el inicio');
  assert.equal(opened.body.encounter.lines.at(-1).kind, 'contact');

  reply = { say: 'Claro.', intent: '' };
  await call(`/api/runs/${id}/talk`, { op: 'say', text: '*sonríe* "Me encanta el pan"' });
  assert.equal(seen.at(-1).intent, 'Quiero darle mi contacto si me ayuda a probar el pan.', 'la intención privada vuelve al siguiente turno');
  assert.equal(seen.at(-1).contact.yaCompartido, true);
  assert.equal(seen.at(-1).contact.agregadoPorElJugador, false);
  assert.match(seen.at(-1).contact.compartidoHace, /^hoy a las/);
  assert.equal(seen.at(-1).transcript.at(-1).text, '*sonríe* "Me encanta el pan"', 'el formato del jugador llega intacto');

  const ended = await call(`/api/runs/${id}/talk`, { op: 'end' });
  const farewell = ended.body.encounter.lines.find((item) => item.text === 'Hasta pronto');
  assert.equal(farewell.segments[0].emotion, 'zztest', 'la despedida también puede cambiar de expresión');
  assert.equal(ended.body.encounter.closed, true);
});

test('sticky expressions survive replies without marks, plain ones do not', async () => {
  const { stickyFrom } = await import('../src/server/game/npcs.js');
  const { validateNpcCard } = await import('../src/server/game/cards.js');
  const npc = { emotionsStay: ['intima'] };
  const lines = [{ who: 'player', text: 'hola' }, { who: 'npc', text: 'x', segments: [{ emotion: 'default', text: 'a ' }, { emotion: 'intima', text: 'b' }] }];
  assert.equal(stickyFrom(lines, npc), 'intima');
  assert.equal(stickyFrom([{ who: 'npc', text: 'x', segments: [{ emotion: 'feliz', text: 'x' }] }], npc), null, 'las demás vuelven a la neutra');
  assert.equal(stickyFrom([], npc), null);
  assert.equal(stickyFrom(lines, {}), null);

  const continued = parseSpeech('Sigue conmigo así.', ['intima', 'feliz'], 'intima');
  assert.deepEqual(continued.segments, [{ emotion: 'intima', text: 'Sigue conmigo así.' }], 'sin marcas conserva la expresión activa');
  const left = parseSpeech('Bueno… {default} ya basta.', ['intima'], 'intima');
  assert.deepEqual(left.segments.map((segment) => segment.emotion), ['intima', 'default'], '{default} la rompe cuando el GM quiere');
  assert.deepEqual(parseSpeech('Hola', ['feliz'], 'inexistente').segments, [], 'una expresión inicial desconocida se ignora');

  const card = validateNpcCard({ id: 'mara_test', name: 'Mara', summary: 's', schedule: [{ days: [0], from: 1, to: 2, locationId: 'cafe' }], emotionsStay: ['Intima', 'mal nombre', 'otra'] }, ['cafe']);
  assert.deepEqual(card.emotionsStay, ['intima', 'otra'], 'solo nombres válidos (letras)');
});
