import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { splitBurst, typingMs, readMs, ensureChatIds, MAX_BURST, MAX_UNANSWERED } from '../src/server/game/chatpace.js';
import { createNanoGPT } from '../src/server/ai/provider.js';
import { characterPlan } from '../src/server/ai/plans.js';
import { compose, defaultPreset } from '../src/server/ai/composer.js';
import { loadNpcs, emptyRelationship, temporalContext } from '../src/server/game/npcs.js';
import { createAppServer } from '../src/server/index.js';
import { fixtureGeography } from './support/world.js';

const npcs = await loadNpcs(path.resolve('data/canon/npcs'));
const luna = npcs.get('luna_serp');

// --- Reparto en mensajes y ritmo (lo decide el motor) ----------------------------------------------------------------------------------
test('each non-empty line of the reply is one message; pace tags are hints, emotion marks never show, and the burst is capped', () => {
  const burst = splitBurst('hola!!^^\n\ncomo estas todo bien?\n{pausa} justo voy llegando a casa btw :p\n{rápido} jaja\n{feliz} y uno más');
  assert.equal(burst.length, MAX_BURST);
  assert.deepEqual(burst.map((item) => item.text).slice(0, 3), ['hola!!^^', 'como estas todo bien?', 'justo voy llegando a casa btw :p']);
  assert.deepEqual(burst.map((item) => item.pace), [null, null, 'slow', 'fast'], 'el ritmo pedido va con su línea');
  assert.equal(burst[3].text, 'jaja y uno más', 'lo que sobra se une al último mensaje, sin perderse');
  assert.deepEqual(splitBurst('{feliz} Hola {risas}'), [{ text: 'Hola', pace: null, re: null }], 'las marcas de emoción no existen en chat');
  assert.deepEqual(splitBurst('{re:7} jaja sí\n{pausa}{re: 3}{rápido} y también eso\n{re:99999} número absurdo\n{re:2}'), [{ text: 'jaja sí', pace: null, re: 7 }, { text: 'y también eso', pace: 'fast', re: 3 }, { text: 'número absurdo', pace: null, re: null }], 'responder a un mensaje: {re:N} en cualquier orden con el ritmo; una marca sin texto no es un mensaje');
  assert.deepEqual(splitBurst('   \n \n'), []);
  assert.equal(splitBurst('x'.repeat(2000))[0].text.length, 600, 'tope por mensaje');
});

test('typing and read delays are computed by the engine within fixed limits; the model can only ask for slower or faster', () => {
  assert.equal(typingMs('ok'), 800, 'un mensaje corto no es instantáneo');
  assert.ok(typingMs('x'.repeat(80)) > typingMs('x'.repeat(20)), 'proporcional al largo');
  assert.equal(typingMs('x'.repeat(5000)), 3600, 'tope');
  assert.ok(typingMs('x'.repeat(60), 'slow') > typingMs('x'.repeat(60)) && typingMs('x'.repeat(60), 'fast') < typingMs('x'.repeat(60)));
  assert.ok(typingMs('x'.repeat(5000), 'slow') <= 5000 && typingMs('a', 'fast') >= 450, 'el ritmo pedido tampoco se sale de los límites');
  const day = readMs(luna, emptyRelationship(), { day: 1, hour: 10, minute: 0 });
  const night = readMs(luna, emptyRelationship(), { day: 1, hour: 2, minute: 0 });
  const close = readMs(luna, { ...emptyRelationship(), notes: [{ valence: 2, time: 'DAY_1_09:00' }, { valence: 2, time: 'DAY_1_09:00' }, { valence: 2, time: 'DAY_1_09:00' }] }, { day: 1, hour: 10, minute: 0 });
  assert.ok(night > day, 'de madrugada tarda más en ver el chat');
  assert.ok(close < day, 'con confianza lo ve antes');
  assert.ok([day, night, close].every((ms) => ms >= 600 && ms <= 6000), 'nunca más de 6 s de espera real');
});

test('old chats without ids get stable ones so they can be replied to', () => {
  const run = { chats: { luna_serp: [{ who: 'player', text: 'a' }, { who: 'npc', text: 'b' }, { id: 'x', who: 'player', text: 'c' }] } };
  ensureChatIds(run);
  assert.deepEqual(run.chats.luna_serp.map((message) => message.id), ['m0', 'm1', 'x']);
  ensureChatIds(run);
  assert.deepEqual(run.chats.luna_serp.map((message) => message.id), ['m0', 'm1', 'x'], 'idempotente');
});

// --- Proveedor y prompt ----------------------------------------------------------------------------------------------------------------
const chatContext = (transcript) => ({
  npc: luna, player: { name: 'Mara', age: 24, gender: 'woman', appearance: '' }, world: { day: 1, hour: 9, minute: 0 }, location: { name: 'L', description: '' }, relationship: emptyRelationship(), attitude: 'neutral',
  transcript, temporal: temporalContext(emptyRelationship(), { day: 1, hour: 9, minute: 0 }), memories: [], history: [], contact: { yaCompartido: true }, mode: 'chat'
});

test('in chat the character writes one message per line in a single call, and replies to a specific message reach it as "respondeA"', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: 'hola!!^^\n{rápido}como estás?\n{pausa}justo voy llegando a casa' }, finish_reason: 'stop' }] }) }; };
  const ai = createNanoGPT(fetchImpl, { prompts: { get: (kind) => defaultPreset(kind), record() {} } });
  const transcript = [{ who: 'npc', text: 'Hoy hay pan de canela' }, { who: 'player', text: 'hola' }, { who: 'player', text: 'me guardas uno?', replyTo: { id: 'a', who: 'npc', text: 'Hoy hay pan de canela' } }];
  const reply = await ai.npcReply(chatContext(transcript), { apiKey: 'k', model: 'm' });
  assert.equal(bodies.length, 1, 'toda la ráfaga cuesta una sola llamada');
  assert.deepEqual(reply.messages.map((item) => [item.text, item.pace]), [['hola!!^^', null], ['como estás?', 'fast'], ['justo voy llegando a casa', 'slow']]);
  const prompt = bodies[0].messages.map((message) => message.content).join('\n');
  assert.match(prompt, /ONE PER LINE/);
  assert.match(prompt, /"respondeA":"Hoy hay pan de canela"/);
  assert.match(prompt, /"texto":"hola"[^}]*\}/, 'los dos mensajes del jugador llegan juntos');
  assert.ok(!('messages' in (await createNanoGPT(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Hola.' }, finish_reason: 'stop' }] }) }), { prompts: { get: (kind) => defaultPreset(kind), record() {} } }).npcReply({ ...chatContext(transcript), mode: 'reply', location: { name: 'L', description: '' } }, { apiKey: 'k', model: 'm' }))), 'en persona no se reparte en mensajes');
  const format = characterPlan(chatContext(transcript)).format;
  assert.doesNotMatch(format, /asterisks/);
});

// --- Servidor --------------------------------------------------------------------------------------------------------------------------
async function boot(t, ai) {
  const runs = new Map(); const turns = [];
  const server = createAppServer({ geography: fixtureGeography(),
    ai: { prologue: async () => ({ text: 'x', locationId: 'station' }), narrate: async () => 'Pasa el tiempo.', npcReply: async (context) => { turns.push(context); return { say: 'ok' }; }, ...ai },
    settings: { require: async () => ({ apiKey: 'k', model: 'm' }) },
    store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body) => { const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
  const id = (await call('/api/runs', { name: 'Mara', age: 24, gender: 'woman', race: 'human' })).body.id;
  const stored = runs.get(id); stored.world.hour = 10; stored.relationships = { luna_serp: { met: true, contact: true, added: true, encounters: 1, notes: [], knows: [], history: [] } }; runs.set(id, stored);
  return { call, id, runs, turns, chat: (body) => call(`/api/runs/${id}/chat`, { npcId: 'luna_serp', ...body }) };
}

test('API: messages are saved at once without calling the model, and the turn button makes the character answer once with everything', async (t) => {
  const { chat, call, id, runs, turns } = await boot(t, {
    npcReply: async (context) => { turns.push(context); return { say: 'hola!!^^\ncomo estás?', messages: [{ text: 'hola!!^^', pace: null }, { text: 'como estás?', pace: 'fast' }] }; }
  });
  const first = await chat({ op: 'send', text: 'hola!!' });
  assert.equal(first.status, 200);
  const sent = first.body.chats.luna_serp;
  assert.deepEqual(sent.map((message) => [message.who, message.text]), [['player', 'hola!!']]);
  assert.ok(sent[0].id, 'cada mensaje tiene id');
  assert.equal(turns.length, 0, 'enviar no llama al modelo');
  const before = runs.get(id).world;
  await chat({ op: 'send', text: 'te quería preguntar algo' });
  await chat({ op: 'send', text: 'tienes pan de canela?' });
  assert.deepEqual(runs.get(id).world, before, 'enviar mensajes no gasta tiempo de juego');
  assert.equal(turns.length, 0);

  const answered = await chat({ op: 'turn' });
  assert.equal(answered.status, 200);
  assert.equal(turns.length, 1, 'una sola llamada para toda la ráfaga');
  assert.deepEqual(turns[0].transcript.map((line) => line.text), ['hola!!', 'te quería preguntar algo', 'tienes pan de canela?'], 'el personaje lee todo lo que mandaste');
  const messages = answered.body.chats.luna_serp;
  assert.deepEqual(messages.slice(-2).map((message) => [message.who, message.text]), [['npc', 'hola!!^^'], ['npc', 'como estás?']]);
  assert.equal(messages.at(-1).typingMs, typingMs('como estás?', 'fast'), 'el ritmo lo fija el motor');
  assert.ok(messages.at(-2).typingMs >= 800 && messages.at(-2).id !== messages.at(-1).id);
  assert.equal(answered.body.world.minute, before.minute + 1, 'pasar el turno cuesta un minuto, no uno por mensaje');
  const contact = answered.body.contacts.find((item) => item.id === 'luna_serp');
  assert.ok(contact.chat.readMs >= 600 && contact.chat.readMs <= 6000, 'el cliente sabe cuánto tarda en «ver» el chat');

  assert.equal((await chat({ op: 'turn' })).status, 400, 'sin mensajes nuevos no hay turno que pasar');
  assert.equal((await call(`/api/runs/${id}/chat`, { npcId: 'luna_serp', op: 'send', text: '   ' })).status, 400);
  assert.equal((await chat({ op: 'send', text: 'otro' })).status, 200, 'se puede seguir conversando');
});

test('API: replying to a specific message stores a short snapshot, validates the id, and the character receives it', async (t) => {
  const { chat, turns } = await boot(t, {});
  const one = await chat({ op: 'send', text: 'Primer mensaje' });
  const [original] = one.body.chats.luna_serp;
  await chat({ op: 'turn' });
  const answer = (await chat({ op: 'send', text: 'ok' })).body.chats.luna_serp.find((message) => message.who === 'npc');
  const quoted = await chat({ op: 'send', text: 'Me refería a esto', replyTo: original.id });
  assert.equal(quoted.status, 200);
  const last = quoted.body.chats.luna_serp.at(-1);
  assert.deepEqual(last.replyTo, { id: original.id, who: 'player', text: 'Primer mensaje' });
  const toNpc = await chat({ op: 'send', text: 'y a lo que dijiste tú', replyTo: answer.id });
  assert.equal(toNpc.body.chats.luna_serp.at(-1).replyTo.who, 'npc');
  assert.equal((await chat({ op: 'send', text: 'x', replyTo: 'no-existe' })).status, 400, 'no se puede citar un mensaje que no existe');
  await chat({ op: 'turn' });
  const line = turns.at(-1).transcript.find((item) => item.text === 'Me refería a esto');
  assert.equal(line.replyTo.text, 'Primer mensaje', 'el personaje sabe a qué mensaje responde el jugador');
  const long = `${'z'.repeat(400)}\nsegunda línea`;
  const big = await chat({ op: 'send', text: long });
  const cited = await chat({ op: 'send', text: 'cita larga', replyTo: big.body.chats.luna_serp.at(-1).id });
  const snapshot = cited.body.chats.luna_serp.at(-1).replyTo.text;
  assert.equal(snapshot.length, 100, 'la cita se recorta: la interfaz nunca recibe el mensaje entero');
  assert.ok(snapshot.endsWith('…') && !snapshot.includes('\n'), 'una sola línea');
});

test('API: too many unanswered messages ask for the turn; the old one-request format still works; chats from before ids can be replied to', async (t) => {
  const { chat, call, id, runs, turns } = await boot(t, {});
  for (let index = 0; index < MAX_UNANSWERED; index++) assert.equal((await chat({ op: 'send', text: `mensaje ${index}` })).status, 200);
  const blocked = await chat({ op: 'send', text: 'uno más' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /Pasa el turno/);
  await chat({ op: 'turn' });
  const legacy = await chat({ text: 'formato antiguo' }); // enviar + turno en una sola petición
  assert.equal(legacy.status, 200);
  assert.deepEqual(legacy.body.chats.luna_serp.slice(-2).map((message) => message.who), ['player', 'npc']);
  assert.equal(turns.length, 2);

  const stored = runs.get(id); stored.chats.luna_serp = [{ who: 'player', text: 'mensaje de una versión anterior', time: 'DAY_1_08:00' }, { who: 'npc', text: 'respuesta antigua', time: 'DAY_1_08:01' }]; runs.set(id, stored);
  const shown = (await call(`/api/runs/${id}`)).body.chats.luna_serp;
  assert.deepEqual(shown.map((message) => message.id), ['m0', 'm1']);
  const replied = await chat({ op: 'send', text: 'respondo a lo antiguo', replyTo: 'm0' });
  assert.equal(replied.body.chats.luna_serp.at(-1).replyTo.text, 'mensaje de una versión anterior');
  assert.equal((await call(`/api/runs/${id}/chat`, { npcId: 'otro', op: 'send', text: 'x' })).status, 400);
});

test('API: plans and facts the character notes in its burst are validated against ALL the messages the player sent', async (t) => {
  const { chat, id, runs } = await boot(t, {
    npcReply: async () => ({
      say: 'Dale, nos vemos\nme avisas si llegas tarde', messages: [{ text: 'Dale, nos vemos', pace: null }, { text: 'me avisas si llegas tarde', pace: null }],
      agreements: [{ text: 'Café el sábado', kind: 'meeting', priority: 'medium', place: 'cafe', when: { weekday: 5, hour: 17, minute: 0 }, playerQuote: 'nos vemos el sábado' }],
      facts: [{ kind: 'name', value: 'Mara Vega', quote: 'soy Mara Vega' }]
    })
  });
  await chat({ op: 'send', text: 'Hola, soy Mara Vega' });
  await chat({ op: 'send', text: 'nos vemos el sábado a las 5 en el café?' });
  const turn = await chat({ op: 'turn' });
  assert.equal(turn.status, 200);
  assert.deepEqual(turn.body.commitments.map((item) => item.text), ['Café el sábado']);
  assert.equal(runs.get(id).relationships.luna_serp.knownName, 'Mara Vega');
});

test('the character can reply to a specific message, its own or the player\'s, with {re:N}: every message has a number and the answer carries a short quote', async (t) => {
  const seen = [];
  const { chat } = await boot(t, {
    npcReply: async (context) => {
      seen.push(context);
      // «n» es el número del mensaje en la conversación completa: 1 = el primero
      return { say: 'x', messages: [{ text: 'jaja eso mismo digo yo', pace: null, re: 1 }, { text: 'y lo de antes sigue en pie', pace: null, re: 2 }, { text: 'esta no cita a nadie', pace: null, re: 999 }] };
    }
  });
  await chat({ op: 'send', text: 'Tengo una idea larga '.repeat(30) + '\ncon otra línea' });
  await chat({ op: 'send', text: 'segundo mensaje' });
  const turn = await chat({ op: 'turn' });
  assert.deepEqual(seen[0].transcript.map((line) => line.n), [1, 2], 'los mensajes se numeran para que el personaje pueda citarlos');
  const replies = turn.body.chats.luna_serp.slice(2);
  assert.equal(replies.length, 3);
  assert.deepEqual(replies[0].replyTo, { id: turn.body.chats.luna_serp[0].id, who: 'player', text: replies[0].replyTo.text });
  assert.equal(replies[0].replyTo.text.length, 100, 'la cita nunca lleva el mensaje entero');
  assert.ok(!replies[0].replyTo.text.includes('\n'));
  assert.equal(replies[1].replyTo.text, 'segundo mensaje');
  assert.equal(replies[2].replyTo, undefined, 'un número que no existe se ignora, no rompe nada');
  // el siguiente turno: el personaje puede citar también SUS propios mensajes (la numeración sigue sobre toda la conversación)
  await chat({ op: 'send', text: 'ok' });
  await chat({ op: 'turn' });
  assert.deepEqual(seen[1].transcript.map((line) => line.n), [1, 2, 3, 4, 5, 6], 'la numeración es estable entre turnos');
  const third = (await chat({ op: 'send', text: 'otra vez' })).body.chats.luna_serp;
  assert.equal(third.length, 10, '2 del jugador + 3 del personaje + 1 + 3 + el nuevo');
});

test('the character prompt explains how to answer a specific message and shows each message\'s number', () => {
  const transcript = [{ n: 4, who: 'npc', text: 'Hoy hay pan' }, { n: 5, who: 'player', text: 'me guardas uno?', replyTo: { id: 'x', who: 'npc', text: 'Hoy hay pan' } }];
  const plan = characterPlan(chatContext(transcript));
  assert.match(plan.format, /\{re:N\}/);
  assert.deepEqual(plan.data.conversacion.map((line) => line.n), [4, 5]);
  assert.equal(plan.data.conversacion[1].respondeA, 'Hoy hay pan');
  const prompt = compose('text', 'chat', defaultPreset('text'), plan).map((message) => message.content).join('\n');
  assert.match(prompt, /"n":5,"quien":"la otra persona","texto":"me guardas uno\?","respondeA":"Hoy hay pan"/);
});
