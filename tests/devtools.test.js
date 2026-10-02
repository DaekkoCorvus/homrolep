import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateNpcCard, fromForeignCard, parsePngCard, savePortrait, listPortraits, imageKind, removePortrait, renamePortrait, normalizeEmotion } from '../src/server/game/cards.js';
import { createRun, startEncounter, addExchange, endEncounter, rewindEncounter, replaceLastNpcLine, setWorldTime } from '../src/server/game/run.js';
import { loadNpcs, emptyRelationship } from '../src/server/game/npcs.js';
import { createAppServer } from '../src/server/index.js';

const locations = ['cafe', 'park'];
const card = () => ({
  id: 'mara_test', name: 'Mara', age: 31, gender: 'Mujer', race: 'celestial', role: 'Florista', summary: 'Soñadora.', schedule: [{ days: [0, 1], from: 9, to: 17, locationId: 'park', activity: 'vende flores' }],
  personality: { traits: 'dulce\nlista', likes: ['las flores'] }, background: 'Creció entre invernaderos.', contact: { conditions: ['Ser amigos'] }
});

// PNG mínimo con un chunk tEXt «chara» (sin comprobar CRC; el parser no lo necesita).
function pngWithCard(json) {
  const chunk = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1'); return Buffer.concat([head, body, Buffer.alloc(4)]); };
  const text = Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from(Buffer.from(JSON.stringify(json)).toString('base64'), 'latin1')]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', text), chunk('IEND', Buffer.alloc(0))]);
}

test('NPC cards are validated and normalised', () => {
  const ok = validateNpcCard(card(), locations);
  assert.deepEqual(ok.personality.traits, ['dulce', 'lista']);
  assert.equal(ok.home, 'park');
  assert.equal(ok.tier, 'civil');
  assert.equal(ok.race, 'celestial');
  assert.equal(ok.age, 31);
  assert.equal(ok.contact.handle, '@Mara', 'usuario por defecto a partir del nombre');
  assert.deepEqual(ok.contact.conditions, ['Ser amigos']);
  assert.equal(validateNpcCard({ ...card(), race: 'robot' }, locations).race, 'humano', 'raza desconocida → humano');
  assert.equal(validateNpcCard({ ...card(), age: '' }, locations).age, null);
  assert.ok(validateNpcCard({ ...card(), background: 'x'.repeat(150000) }, locations).background.length === 150000, 'el trasfondo ya no tiene el límite antiguo');
  assert.throws(() => validateNpcCard({ ...card(), contact: { handle: 'sin arroba' } }, locations), /usuario/);
  assert.throws(() => validateNpcCard({ ...card(), connections: [{ npcId: 'mara_test', relation: 'yo' }] }, locations), /consigo/);
  assert.equal(validateNpcCard({ ...card(), connections: [{ npcId: 'luna_serp', relation: 'amiga' }] }, locations).connections[0].relation, 'amiga');
  assert.throws(() => validateNpcCard({ ...card(), id: 'Mal Id' }, locations), /id/);
  assert.throws(() => validateNpcCard({ ...card(), name: '' }, locations), /nombre/);
  assert.throws(() => validateNpcCard({ ...card(), schedule: [{ days: [0], from: 10, to: 9, locationId: 'park' }] }, locations), /horas/);
  assert.throws(() => validateNpcCard({ ...card(), schedule: [{ days: [0], from: 1, to: 9, locationId: 'nowhere' }] }, locations), /desconocido/);
  assert.throws(() => validateNpcCard({ ...card(), background: 'x'.repeat(200001) }, locations), /200000/);
});

test('foreign character cards (v2 JSON and PNG) map onto a reviewable draft', () => {
  const v2 = { spec: 'chara_card_v2', data: { name: 'Señor Ñandú', description: 'Un vendedor ambulante.', personality: 'Bromista', first_mes: 'Hola hola', mes_example: '<START>\nHola' } };
  const draft = validateNpcCard(fromForeignCard(v2, 'cafe'), locations);
  assert.equal(draft.id, 'senor_nandu');
  assert.match(draft.background, /vendedor/);
  assert.equal(draft.schedule[0].locationId, 'cafe');
  assert.deepEqual(parsePngCard(pngWithCard(v2)), v2);
  assert.throws(() => parsePngCard(Buffer.from('nope')), /PNG/);
});

test('portraits are stored per NPC with room for future emotions', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hom-portraits-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const png = pngWithCard({});
  assert.equal(imageKind(png), 'png');
  assert.equal(imageKind(Buffer.from('plain text')), null);
  await savePortrait(dir, 'mara_test', png);
  await savePortrait(dir, 'mara_test', png, 'happy');
  const portraits = await listPortraits(dir, 'mara_test');
  assert.deepEqual(Object.keys(portraits).sort(), ['default', 'happy']);
  assert.match(portraits.default, /^\/assets\/portraits\/mara_test\/default\.png\?v=\d+$/);
  await savePortrait(dir, 'mara_test', Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.alloc(8)]));
  assert.deepEqual((await readdir(path.join(dir, 'portraits', 'mara_test'))).sort(), ['default.webp', 'happy.png']);
  await assert.rejects(savePortrait(dir, '../escape', png), /inválido/);
  await assert.rejects(savePortrait(dir, 'mara_test', Buffer.from('not an image')), /PNG/);
  assert.deepEqual(await listPortraits(dir, 'nobody'), {});
});

test('rewinding a conversation restores time, relationship and log', async () => {
  const npcs = await loadNpcs(path.resolve('data/canon/npcs'));
  const luna = npcs.get('luna_serp');
  let run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' });
  run.player.locationId = 'cafe';
  const pristine = structuredClone(run);
  run = startEncounter(run, luna, { say: 'Hola.' });
  run = addExchange(run, 'Buenas', { say: 'Buenas.' }, false);
  assert.equal(rewindEncounter(run).run.world.minute, pristine.world.minute, 'rebobina una conversación abierta');
  const regenerated = replaceLastNpcLine(run, { say: 'Otra respuesta.', gesture: 'sonríe' });
  assert.equal(regenerated.encounter.lines.at(-1).text, 'Otra respuesta.');
  assert.equal(regenerated.encounter.lines.length, run.encounter.lines.length);
  assert.equal(regenerated.world.minute, run.world.minute, 'regenerar no gasta tiempo');
  run = endEncounter(run, luna, { relationship: { ...emptyRelationship(), met: true, encounters: 0, notes: [{ text: 'x', valence: 2, evidence: 'Buenas', tags: [] }] }, farewell: 'Chao', contactGranted: false });
  const { run: back, npcId } = rewindEncounter(run);
  assert.equal(npcId, 'luna_serp');
  assert.deepEqual(back.world, pristine.world);
  assert.equal(back.eventLog.length, pristine.eventLog.length);
  assert.equal(back.relationships.luna_serp.notes.length, 0);
  assert.equal(back.encounter, null);
  assert.equal(back.lastEncounter, null);
  assert.throws(() => rewindEncounter(back), /reiniciar/);
  assert.equal(setWorldTime(back, { hour: 14, minute: 30, day: 3 }).world.day, 3);
  assert.throws(() => setWorldTime(back, { hour: 25 }), /inválida/);
});

test('dev API is closed by default and supports restart, regenerate and time changes', async (t) => {
  const runs = new Map();
  let replies = 0; let evaluations = 0; let farewells = 0;
  const ai = {
    npcReply: async ({ mode }) => (mode === 'closing' ? { say: `Adiós ${++farewells}` } : { say: mode === 'open' ? `Saludo ${++replies}` : `Respuesta ${++replies}` }),
    evaluateEncounter: async () => { ++evaluations; return { notes: [{ text: `Nota ${evaluations}`, valence: 1, evidence: 'Hola' }], summary: 'ok' }; },
    narrate: async () => 'Narración nueva.', prologue: async () => ({ text: 'Llegas.', locationId: 'station' })
  };
  const server = createAppServer({ ai, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, dev = true, method = body ? 'POST' : 'GET') => { const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(dev ? { 'x-hom-dev': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };

  const portrait = await fetch(`${base}/assets/portraits/luna_serp/default.webp`);
  assert.equal(portrait.status, 200);
  assert.equal(portrait.headers.get('content-type'), 'image/webp');
  assert.equal((await fetch(`${base}/assets/portraits/luna_serp/source/default.png`)).status, 404, 'el PNG maestro no se sirve');

  assert.equal((await call('/api/dev/npcs', null, false)).status, 403);
  const cards = await call('/api/dev/npcs');
  assert.equal(cards.status, 200);
  assert.ok(cards.body.some((item) => item.id === 'luna_serp'));
  assert.equal((await call('/api/dev/npcs/luna_serp', { name: 'x' }, true, 'PUT')).status, 400, 'una ficha incompleta no se guarda');

  const id = (await call('/api/runs', { name: 'Mara', age: 24, gender: 'woman', race: 'human' })).body.id;
  const stored = runs.get(id); stored.player.locationId = 'cafe'; stored.world.hour = 9; runs.set(id, stored);
  assert.equal((await call(`/api/runs/${id}/dev`, { op: 'restart' }, false)).status, 403);

  await call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' });
  await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Hola' });
  const regen = await call(`/api/runs/${id}/dev`, { op: 'regen' });
  assert.equal(regen.status, 200);
  assert.equal(regen.body.encounter.lines.length, 3);
  assert.match(regen.body.encounter.lines.at(-1).text, /Respuesta 3/);

  const ended = await call(`/api/runs/${id}/talk`, { op: 'end' });
  assert.equal(ended.body.narrative.text, 'Adiós 1');
  const again = await call(`/api/runs/${id}/dev`, { op: 'regen' });
  assert.equal(again.body.narrative.text, 'Adiós 2', 'regenerar el cierre reevalúa desde la relación original');
  assert.equal(again.body.relationships.luna_serp.notes.length, 1, 'no duplica notas');

  const restarted = await call(`/api/runs/${id}/dev`, { op: 'restart' });
  assert.equal(restarted.status, 200);
  assert.equal(restarted.body.encounter.lines.length, 1);
  assert.equal(restarted.body.relationships.luna_serp.notes?.length ?? 0, 0);

  assert.equal((await call(`/api/runs/${id}/dev`, { op: 'teleport', locationId: 'park' })).status, 400, 'no se puede teletransportar en plena conversación');
  await call(`/api/runs/${id}/talk`, { op: 'end' });
  assert.equal((await call(`/api/runs/${id}/dev`, { op: 'teleport', locationId: 'park' })).status, 400, 'tampoco antes de pulsar Volver');
  await call(`/api/runs/${id}/talk`, { op: 'leave' });
  const moved = await call(`/api/runs/${id}/dev`, { op: 'teleport', locationId: 'park' });
  assert.equal(moved.body.player.locationId, 'park');
  assert.equal((await call(`/api/runs/${id}/dev`, { op: 'set_time', hour: 22, minute: 5 })).body.world.hour, 22);
});

test('when an emotion exists in several formats the lightest one is served', async (t) => {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'hom-priority-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const folder = path.join(dir, 'portraits', 'mara_test');
  await mkdir(path.join(folder, 'source'), { recursive: true });
  for (const name of ['default.png', 'default.webp', 'happy.png', 'notes.txt', 'Bad Name.png', 'source/default.png']) await writeFile(path.join(folder, name), 'x');
  const portraits = await listPortraits(dir, 'mara_test');
  assert.deepEqual(Object.keys(portraits), ['default', 'happy']);
  assert.match(portraits.default, /default\.webp\?v=/);
  assert.match(portraits.happy, /happy\.png\?v=/);
});

test('emotion names are letters only and sprites can be renamed or removed', async (t) => {
  assert.equal(normalizeEmotion('  ¡Feliz 2! '), 'feliz');
  assert.equal(normalizeEmotion('Preocupación'), 'preocupacion');
  assert.equal(normalizeEmotion('123 !!'), '');
  const dir = await mkdtemp(path.join(tmpdir(), 'hom-emotions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const png = pngWithCard({});
  await savePortrait(dir, 'mara_test', png);
  await savePortrait(dir, 'mara_test', png, 'feliz');
  await assert.rejects(savePortrait(dir, 'mara_test', png, 'con espacio'), /solo letras/);
  await assert.rejects(savePortrait(dir, 'mara_test', png, 'happy_2'), /solo letras/);
  await renamePortrait(dir, 'mara_test', 'feliz', 'alegre');
  assert.deepEqual(Object.keys(await listPortraits(dir, 'mara_test')), ['alegre', 'default']);
  await savePortrait(dir, 'mara_test', png, 'triste');
  await assert.rejects(renamePortrait(dir, 'mara_test', 'triste', 'alegre'), /Ya existe/);
  await assert.rejects(renamePortrait(dir, 'mara_test', 'default', 'otra'), /por defecto/);
  await assert.rejects(renamePortrait(dir, 'mara_test', 'nada', 'otra'), /no existe/);
  await removePortrait(dir, 'mara_test', 'triste');
  await assert.rejects(removePortrait(dir, 'mara_test', 'default'), /por defecto/);
  await assert.rejects(removePortrait(dir, 'mara_test', 'triste'), /no existe/);
  assert.deepEqual(Object.keys(await listPortraits(dir, 'mara_test')), ['alegre', 'default']);
});
