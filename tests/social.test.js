import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import { loadNpcs, presentNpcs, validateEvaluation, applyEvaluation, affinityOf, emptyRelationship, validateFacts, contactAllowed, MAX_SHIFT_PER_ENCOUNTER, temporalContext, timedNotes, findNpcByHandle } from '../src/server/game/npcs.js';
import { applyAction } from '../src/server/ai/tools/game.js';
import { createRun, startEncounter, addExchange, endEncounter, addContact, grantContact, leaveEncounter } from '../src/server/game/run.js';
import { createNanoGPT } from '../src/server/ai/provider.js';
import { createAppServer } from '../src/server/index.js';

const npcs = await loadNpcs(path.resolve('data/canon/npcs'));
const luna = npcs.get('luna_serp');
const at = (day, hour) => ({ day, hour, minute: 0 });
const profile = { name: 'Mara', age: 24, gender: 'woman', race: 'human', appearance: 'Cabello corto', origin: '' };
const lines = [{ who: 'npc', text: 'Buenas.' }, { who: 'player', text: 'Hola, ¿qué me recomiendas de la carta?' }, { who: 'npc', text: 'El café con canela.' }, { who: 'player', text: 'Suena perfecto, gracias' }];

test('Luna Serp follows her schedule and only appears in her café', () => {
  assert.deepEqual(presentNpcs(npcs, 'cafe', at(1, 8)).map((npc) => npc.id), ['luna_serp']);
  assert.equal(presentNpcs(npcs, 'cafe', at(1, 5)).length, 0);
  assert.equal(presentNpcs(npcs, 'cafe', at(1, 21)).length, 0);
  assert.equal(presentNpcs(npcs, 'park', at(1, 8)).length, 0);
  assert.equal(presentNpcs(npcs, 'cafe', at(7, 7)).length, 0, 'el séptimo día abre más tarde');
  assert.equal(presentNpcs(npcs, 'cafe', at(7, 9)).length, 1);
  assert.equal(presentNpcs(npcs, 'cafe', at(7, 16)).length, 0);
});

test('the engine rejects impressions that do not cite what the player said and caps swings', () => {
  const result = validateEvaluation({
    notes: [
      { text: 'Me cae bien que pregunte.', valence: 2, evidence: 'qué me recomiendas', tags: ['amabilidad', 'inventada'] },
      { text: 'Fue grosero conmigo.', valence: -2, evidence: 'frase que nunca dijo' },
      { text: 'Es educado.', valence: 2, evidence: 'gracias', tags: ['respeto'] },
      { text: 'Otro extra.', valence: 2, evidence: 'Hola' }
    ],
    summary: 'Pidió una recomendación.'
  }, lines);
  assert.equal(result.notes.length, 3);
  assert.ok(result.notes.every((note) => note.evidence));
  assert.deepEqual(result.notes[0].tags, ['amabilidad']);
  assert.ok(result.notes.reduce((sum, note) => sum + Math.abs(note.valence), 0) <= MAX_SHIFT_PER_ENCOUNTER);
  assert.equal(result.summary, 'Pidió una recomendación.');
  const empty = validateEvaluation({ notes: [{ text: 'x', valence: 2, evidence: 'no existe' }] }, lines);
  assert.equal(empty.notes.length, 1);
  assert.equal(empty.notes[0].valence, 0, 'sin evidencia válida queda una nota neutra');
});

test('contact is shared only when the character decides, affinity allows it and every condition is met', () => {
  const plain = { contact: { conditions: [] } };
  const gated = { contact: { conditions: ['ser amigos', 'haber regalado café'] } };
  const liked = { ...emptyRelationship(), notes: [{ text: 'Buena charla.', valence: 2 }, { text: 'Escucha.', valence: 1 }] };
  const cold = { ...emptyRelationship(), notes: [{ text: 'Meh.', valence: 1 }] };
  const bad = { ...emptyRelationship(), notes: [{ text: 'Incómodo.', valence: -2 }] };
  assert.equal(contactAllowed(plain, liked, { give: true }), true);
  assert.equal(contactAllowed(plain, liked, { give: false }), false, 'sin intención del personaje no se comparte');
  assert.equal(contactAllowed(plain, cold, { give: true }), false, 'sin condiciones exige buena impresión');
  assert.equal(contactAllowed(plain, bad, { give: true }), false);
  assert.equal(contactAllowed(gated, cold, { give: true, conditionsMet: [true, false] }), false, 'falta una condición');
  assert.equal(contactAllowed(gated, cold, { give: true, conditionsMet: [true] }), false, 'faltan condiciones por declarar');
  assert.equal(contactAllowed(gated, cold, { give: true, conditionsMet: [true, true] }), true);
  assert.equal(contactAllowed(gated, bad, { give: true, conditionsMet: [true, true] }), false, 'ni con condiciones si la impresión es mala');
  assert.equal(contactAllowed(gated, { ...liked, contact: true }, { give: true, conditionsMet: [true, true] }), false, 'no se comparte dos veces');
  assert.ok(affinityOf(liked.notes) >= 2);
});

test('NPCs know how long ago they last talked, so the same day is not a new day', () => {
  const rel = { ...emptyRelationship(), encounters: 1, lastEnd: 'DAY_1_09:30', notes: [{ text: 'Amable.', valence: 1, evidence: 'x', tags: [], time: 'DAY_1_09:00' }], history: [{ time: 'DAY_1_09:00', text: 'Charla.' }] };
  const sameDay = temporalContext(rel, at(1, 11));
  assert.equal(sameDay.ultimaConversacion.mismoDia, true);
  assert.match(sameDay.ultimaConversacion.cuando, /^hoy a las 09:30 \(hace unas? \d* ?horas?\)$|hoy a las 09:30/);
  assert.equal(temporalContext(rel, at(1, 9)).ultimaConversacion.mismoDia, true);
  assert.match(temporalContext({ ...rel, lastEnd: 'DAY_1_09:30' }, { day: 1, hour: 9, minute: 45 }).ultimaConversacion.cuando, /hace 15 minutos/);
  const nextDay = temporalContext(rel, at(2, 8));
  assert.equal(nextDay.ultimaConversacion.mismoDia, false);
  assert.match(nextDay.ultimaConversacion.cuando, /^ayer a las 09:30/);
  assert.match(nextDay.ahora, /día 2 \(martes\)/);
  assert.equal(temporalContext(emptyRelationship(), at(1, 8)).ultimaConversacion, null);
  assert.match(timedNotes(rel, at(1, 12))[0].cuando, /^hoy a las 09:00/);
});

test('contact handles are found case-insensitively and unknown handles reveal nothing', () => {
  assert.equal(findNpcByHandle(npcs, '@lunaserp')?.id, 'luna_serp');
  assert.equal(findNpcByHandle(npcs, '@Nadie'), null);
  assert.equal(findNpcByHandle(npcs, ''), null);
  let run = createRun(profile);
  assert.throws(() => addContact(run, luna), /desconocidas/);
  assert.throws(() => addContact(run, null), /desconocidas/);
  run = grantContact(run, luna);
  assert.equal(run.relationships.luna_serp.contact, true);
  run = addContact(run, luna);
  assert.equal(run.relationships.luna_serp.added, true);
  assert.throws(() => addContact(run, luna), /ya está/);
});

test('the character only knows what the player actually told it: name (even a false one) and facts, always quoted', () => {
  const told = [{ who: 'player', text: 'Me llamo Daekko y reparto paquetes en bici' }, { who: 'npc', text: 'Encantada.' }];
  const facts = validateFacts({ playerName: { value: 'Daekko', evidence: 'Me llamo Daekko' }, learned: [{ fact: 'Reparte paquetes en bici', evidence: 'reparto paquetes' }, { fact: 'Es millonario', evidence: 'soy millonario' }] }, told);
  assert.equal(facts.playerName, 'Daekko');
  assert.deepEqual(facts.learned, ['Reparte paquetes en bici'], 'un dato sin cita real no se aprende');
  assert.equal(validateFacts({ playerName: { value: 'Pedro', evidence: 'Me llamo Pedro' } }, told).playerName, null, 'un nombre que el jugador no dijo no cuenta');
  assert.equal(validateFacts({ playerName: { value: 'Daekko', evidence: 'Encantada' } }, told).playerName, null, 'la cita debe ser del jugador');
  const { relationship } = applyEvaluation({ ...emptyRelationship(), knownName: 'Dae' }, { notes: [], summary: '', ...facts }, 'DAY_1_09:00');
  assert.equal(relationship.knownName, 'Daekko', 'el nombre puede cambiar si el jugador miente después');
  assert.deepEqual(relationship.knows, ['Reparte paquetes en bici']);
  assert.equal(applyEvaluation(relationship, { notes: [], summary: '', playerName: null, learned: [] }, 'DAY_1_10:00').relationship.knownName, 'Daekko', 'sin nombre nuevo se conserva');
});

test('encounters spend time, block other actions and store the impression on close', () => {
  const world = { locations: [{ id: 'cafe', travelMinutes: 20 }, { id: 'park', travelMinutes: 15 }] };
  let run = createRun(profile);
  run.player.locationId = 'cafe';
  run = startEncounter(run, luna, { say: 'Bienvenida.', gesture: 'seca una taza' });
  assert.equal(run.encounter.npcId, 'luna_serp');
  assert.equal(run.world.minute, 1);
  assert.throws(() => applyAction(run, { type: 'travel', locationId: 'park' }, world), /conversación/);
  run = addExchange(run, 'Hola, soy Mara', { say: 'Un gusto, Mara.' });
  assert.equal(run.world.minute, 4);
  const evaluation = validateEvaluation({ notes: [{ text: 'Amable.', valence: 1, evidence: 'soy Mara' }] }, run.encounter.lines);
  const { relationship } = applyEvaluation(run.relationships.luna_serp, evaluation, run.encounter.startedAt);
  run = endEncounter(run, luna, { relationship, farewell: 'Hasta luego.', contactGranted: false });
  assert.equal(run.encounter.closed, true, 'la conversación queda abierta hasta pulsar Volver');
  assert.equal(run.encounter.lines.at(-1).text, 'Hasta luego.', 'la despedida es una línea más de la conversación');
  assert.throws(() => addExchange(run, 'Una cosa más', { say: 'x' }, false), /terminó/);
  assert.throws(() => applyAction(run, { type: 'wait' }, world), /conversación/);
  assert.equal(run.relationships.luna_serp.lastEnd, 'DAY_1_08:05');
  run = leaveEncounter(run);
  assert.equal(run.encounter, null);
  assert.equal(run.relationships.luna_serp.encounters, 1);
  assert.equal(run.relationships.luna_serp.notes.length, 1);
  assert.equal(run.narrative.text, 'Hasta luego.');
});

test('provider parses NPC replies and evaluations and rejects malformed output', async () => {
  const reply = (content) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
  const config = { apiKey: 'k', model: 'test-model' };
  const context = { npc: luna, player: { ...profile, name: 'Mara' }, world: at(1, 8), location: { name: "Luna's Coffee", description: 'x' }, relationship: emptyRelationship(), attitude: 'neutral', transcript: [], temporal: { ahora: 'día 1 (lunes), 08:00', ultimaConversacion: null }, memories: [], history: [] };
  const ok = await createNanoGPT(reply('```json\n{"say":"Buenos días.","gesture":"levanta la vista"}\n```')).npcReply({ ...context, opening: true }, config);
  assert.deepEqual(ok, { say: 'Buenos días.', gesture: 'levanta la vista', intent: '' });
  assert.equal((await createNanoGPT(reply('Hola, ¿qué te pongo?')).npcReply(context, config)).say, 'Hola, ¿qué te pongo?', 'el personaje responde con texto: ya no hace falta JSON');
  const acted = await createNanoGPT(reply('*seca una taza* {feliz} Buenas.')).npcReply(context, config);
  assert.deepEqual([acted.gesture, acted.say], ['seca una taza', '{feliz} Buenas.'], 'la acción entre asteriscos al principio es el gesto');
  await assert.rejects(createNanoGPT(reply('   ')).npcReply(context, config), { code: 'AI_RESPONSE' });
  await assert.rejects(createNanoGPT(reply('{"say":"  "}')).npcReply(context, config), { code: 'AI_RESPONSE' });
  const raw = await createNanoGPT(reply('{"notes":[],"contactOffer":false,"farewell":"Adiós"}')).evaluateEncounter(context, config);
  assert.equal(raw.farewell, 'Adiós');
});

test('talk API: hidden notes stay hidden, failures keep the run intact, contact is exposed', async (t) => {
  const runs = new Map();
  let fail = false;
  const ai = {
    // El personaje (npcReply) habla y se despide; el GM (evaluateEncounter) solo traduce a datos del motor.
    npcReply: async ({ transcript, mode }) => { if (fail) throw Object.assign(new Error('IA caída'), { status: 502 }); if (mode === 'closing') return { say: 'Vuelve.', contact: { give: true, conditionsMet: [true, true] } }; return { say: transcript.length ? 'Ajá.' : 'Bienvenida.' }; },
    evaluateEncounter: async () => ({ notes: [{ text: 'Me cae bien.', valence: 2, evidence: 'qué tal', tags: ['amabilidad'] }, { text: 'Simpática.', valence: 1, evidence: 'qué tal' }], summary: 'Charla breve.' }),
    prologue: async () => ({ text: 'Llegas.', locationId: 'station' })
  };
  const server = createAppServer({
    ai, settings: { require: async () => ({ apiKey: 'k', model: 'm' }), status: async () => ({}) },
    store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, headers = {}) => { const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };

  const created = (await call('/api/runs', profile)).body;
  const id = created.id;
  const saved = runs.get(id); saved.player.locationId = 'cafe'; saved.world.hour = 9; runs.set(id, saved);
  assert.deepEqual((await call(`/api/runs/${id}`)).body.presence.map((npc) => npc.id), ['luna_serp']);

  fail = true;
  assert.equal((await call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' })).status, 502);
  assert.equal(runs.get(id).encounter ?? null, null, 'una IA caída no abre la conversación');
  fail = false;

  const started = await call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' });
  assert.equal(started.status, 200);
  assert.equal(started.body.encounterNpc.name, 'Luna Serp');
  const blocked = await call(`/api/runs/${id}/action`, { type: 'wait' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /conversación/);

  fail = true;
  const before = runs.get(id).encounter.lines.length;
  assert.equal((await call(`/api/runs/${id}/talk`, { op: 'say', text: 'qué tal' })).status, 502);
  assert.equal(runs.get(id).encounter.lines.length, before, 'una respuesta fallida no añade líneas');
  fail = false;

  assert.equal((await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Hola, qué tal' })).status, 200);
  const ended = await call(`/api/runs/${id}/talk`, { op: 'end' });
  assert.equal(ended.status, 200);
  assert.equal(ended.body.encounter.closed, true);
  assert.equal((await call(`/api/runs/${id}/talk`, { op: 'say', text: 'una más' })).status, 400, 'no se habla tras despedirse');
  const left = await call(`/api/runs/${id}/talk`, { op: 'leave' });
  assert.equal(left.body.encounter, null);
  assert.equal(ended.body.relationships.luna_serp.contact, true, 'el NPC compartió su contacto');
  assert.match(ended.body.narrative.text, /@LunaSerp/, 'el usuario se muestra en pantalla');
  assert.deepEqual(ended.body.contacts, [], 'aún no está agregado');
  const unknown = await call(`/api/runs/${id}/contacts`, { handle: '@Nadie' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /desconocidas/);
  const added = await call(`/api/runs/${id}/contacts`, { handle: '@lunaserp' });
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.contacts.map((npc) => npc.id), ['luna_serp']);
  assert.equal(ended.body.relationships.luna_serp.notes, undefined, 'las notas no salen al cliente normal');
  const dev = (await call(`/api/runs/${id}`, null, { 'x-hom-dev': '1' })).body;
  assert.equal(dev.relationships.luna_serp.notes.length, 2);
  assert.ok(dev.relationships.luna_serp.affinity >= 2);
});
