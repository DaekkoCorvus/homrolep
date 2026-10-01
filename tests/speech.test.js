import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSpeech } from '../src/server/game/npcs.js';
import { createAppServer } from '../src/server/index.js';

const BS = '\\'; // las marcas de emoción llevan una barra invertida: [\feliz]

test('emotion marks split speech into expressive segments and unknown marks vanish', () => {
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

test('the GM receives emotions, recent events, contact status and can open with a contact offer and a private intent', async (t) => {
  const emotionFile = path.resolve('assets/portraits/luna_serp/zztest.png');
  await writeFile(emotionFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
  t.after(() => rm(emotionFile, { force: true }));

  const runs = new Map(); const seen = [];
  let reply = { say: `[${BS}zztest] ¡Qué bueno verte! [${BS}nopuedo] Pasa.`, intent: 'Quiero darle mi contacto si me ayuda a probar el pan.', contact: { give: true, conditionsMet: [true, true] } };
  const ai = {
    npcReply: async (context) => { seen.push(context); return reply; },
    evaluateEncounter: async () => ({ notes: [], farewell: `[${BS}zztest] Hasta pronto`, summary: 'ok' }),
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
  assert.ok(context.events.some((event) => /prisa por la lluvia/.test(event.que)), 'sucesos recientes disponibles al abrir');
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
