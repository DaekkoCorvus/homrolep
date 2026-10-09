import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateNpcCard, saveNpcCard, importOver } from '../src/server/game/cards.js';
import { loadNpcs } from '../src/server/game/npcs.js';
import { createAppServer } from '../src/server/index.js';
import { fixtureGeography } from './support/world.js';

const locations = ['cafe', 'park'];
const base = () => validateNpcCard({
  id: 'mara_test', name: 'Mara', age: 31, gender: 'Mujer', role: 'Florista', summary: 'Soñadora.', background: 'Creció entre invernaderos.',
  schedule: [{ days: [0, 1], from: 9, to: 17, locationId: 'park', activity: 'vende flores' }],
  personality: { traits: ['dulce', 'lista'], speech: 'Habla despacio.', likes: ['las flores'] }, contact: { handle: '@MaraFlores', conditions: ['Ser amigos'] },
  connections: [{ npcId: 'luna_serp', relation: 'amiga' }], stage: { heightCm: 155, frames: { default: { h: 0.7, x: 0, y: 0 } } }
}, locations);

// PNG con un chunk tEXt «chara» (como las cards de Tavern); el parser no comprueba el CRC.
function pngWithCard(json) {
  const chunk = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1'); return Buffer.concat([head, body, Buffer.alloc(4)]); };
  const text = Buffer.concat([Buffer.from('chara\0', 'latin1'), Buffer.from(Buffer.from(JSON.stringify(json)).toString('base64'), 'latin1')]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', text), chunk('IEND', Buffer.alloc(0))]);
}

test('importOver replaces only what a native file brings', () => {
  const { card, replaced } = importOver(base(), { name: 'Mara Flores', background: 'Nueva historia.', personality: { speech: 'Habla rápido.' }, contact: { handle: '@Otra' } }, 'cafe');
  assert.deepEqual(replaced, ['Nombre', 'Trasfondo', 'Forma de hablar', 'Usuario de contacto']);
  assert.equal(card.name, 'Mara Flores');
  assert.equal(card.background, 'Nueva historia.');
  assert.equal(card.personality.speech, 'Habla rápido.');
  assert.deepEqual(card.personality.traits, ['dulce', 'lista'], 'lo que el archivo no trae se conserva, también dentro de personality');
  assert.equal(card.contact.handle, '@Otra');
  assert.deepEqual(card.contact.conditions, ['Ser amigos']);
  assert.equal(card.schedule[0].activity, 'vende flores');
  assert.equal(card.stage.heightCm, 155);
  assert.equal(card.role, 'Florista');
  // El id nunca se sustituye aunque el archivo traiga otro.
  assert.equal(importOver(base(), { id: 'otro', name: 'X' }, 'cafe').card.id, 'mara_test');
  // Un campo vacío del archivo SÍ sustituye (borrar es una decisión del archivo); undefined no.
  assert.equal(importOver(base(), { appearance: '', role: undefined }, 'cafe').card.role, 'Florista');
  assert.deepEqual(importOver(base(), { secrets: [] }, 'cafe').replaced, ['Secretos']);
});

test('importOver maps a Tavern card without inventing the filler fields', () => {
  const v2 = { spec: 'chara_card_v2', data: { name: 'Señor Ñandú', description: 'Un vendedor ambulante.', personality: 'Bromista', first_mes: 'Hola hola', mes_example: '<START>\nHola', scenario: 'En la plaza' } };
  const { card, replaced } = importOver(base(), v2, 'cafe');
  assert.deepEqual(replaced, ['Nombre', 'Resumen', 'Trasfondo', 'Ejemplo de voz', 'Forma de hablar']);
  assert.equal(card.name, 'Señor Ñandú');
  assert.match(card.background, /vendedor.*plaza/s);
  assert.equal(card.role, 'Florista', 'no se pisa el rol con el «Personaje importado» de relleno');
  assert.equal(card.schedule[0].locationId, 'park', 'ni el horario');
  assert.equal(card.contact.handle, '@MaraFlores', 'ni el contacto');
  assert.deepEqual(card.personality.traits, ['dulce', 'lista']);
  const bare = importOver(base(), { name: 'Solo nombre', description: 'Algo.' }, 'cafe');
  assert.ok(!bare.replaced.includes('Forma de hablar'), 'sin primer saludo no se toca la forma de hablar');
  assert.equal(bare.card.personality.speech, 'Habla despacio.');
});

test('importOver rejects files with nothing usable', () => {
  assert.throws(() => importOver(base(), {}, 'cafe'), /ningún dato/);
  assert.throws(() => importOver(base(), { desconocido: 1 }, 'cafe'), /ningún dato/);
  assert.throws(() => importOver(base(), [], 'cafe'), /válida/);
  assert.throws(() => importOver(base(), null, 'cafe'), /válida/);
  assert.throws(() => importOver(base(), { spec: 'chara_card_v2', data: { description: 'sin nombre' } }, 'cafe'), /nombre/);
});

test('import-over route returns the merged card without writing anything', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'hom-over-')); t.after(() => rm(root, { recursive: true, force: true }));
  const npcDir = path.join(root, 'npcs'); const assetDir = path.join(root, 'assets');
  await mkdir(npcDir, { recursive: true }); await mkdir(path.join(assetDir, 'portraits', 'mara_test'), { recursive: true });
  await saveNpcCard(npcDir, base()); await writeFile(path.join(assetDir, 'portraits', 'mara_test', 'default.png'), 'x');
  const before = await readFile(path.join(npcDir, 'mara_test.json'), 'utf8');
  const server = createAppServer({ npcs: await loadNpcs(npcDir), npcDir, assetDir, geography: fixtureGeography(), ai: {}, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async () => {}, loadRun: async () => null, listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, dev = true) => { const response = await fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json', ...(dev ? { 'x-hom-dev': '1' } : {}) }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const json = (value) => ({ kind: 'json', text: JSON.stringify(value) });
  const editing = { ...base(), name: 'Mara (editando)', portraits: { default: '/x' } };   // lo que el editor tiene ahora

  assert.equal((await call('/api/dev/npcs/mara_test/import-over', { ...json({ name: 'X' }), base: editing }, false)).status, 403, 'exige la cabecera de desarrollo');
  assert.equal((await call('/api/dev/npcs/nadie/import-over', json({ name: 'X' }))).status, 404);

  const ok = await call('/api/dev/npcs/mara_test/import-over', { ...json({ id: 'otro', name: 'Mara Flores', personality: { speech: 'Rápido.' } }), base: editing });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.card.id, 'mara_test');
  assert.equal(ok.body.card.name, 'Mara Flores');
  assert.equal(ok.body.card.personality.speech, 'Rápido.');
  assert.deepEqual(ok.body.card.personality.traits, ['dulce', 'lista']);
  assert.deepEqual(ok.body.replaced, ['Nombre', 'Forma de hablar']);
  assert.equal('portraits' in ok.body.card, false);
  // Sin `base` se fusiona con la ficha guardada.
  assert.equal((await call('/api/dev/npcs/mara_test/import-over', json({ role: 'Jardinera' }))).body.card.name, 'Mara');

  // Card de Tavern en PNG.
  const png = await call('/api/dev/npcs/mara_test/import-over', { kind: 'png', data: pngWithCard({ spec: 'chara_card_v2', data: { name: 'Pngcita', description: 'Desde un PNG.' } }).toString('base64'), base: editing });
  assert.equal(png.status, 200);
  assert.equal(png.body.card.name, 'Pngcita');
  assert.equal(png.body.card.role, 'Florista');

  // Paquete .hom.json: solo cuenta la ficha y se avisa de que las imágenes no vienen; lugares desconocidos → lugar de inicio.
  const bundle = { format: 'hom-character', version: 1, card: { name: 'Del paquete', schedule: [{ days: [0], from: 9, to: 17, locationId: 'atlantis', activity: '' }] }, images: { default: { type: 'image/png', data: 'AAAA' } } };
  const fromBundle = await call('/api/dev/npcs/mara_test/import-over', { ...json(bundle), base: editing });
  assert.equal(fromBundle.status, 200);
  assert.equal(fromBundle.body.card.name, 'Del paquete');
  assert.equal(fromBundle.body.card.schedule[0].locationId, 'station');
  assert.equal(fromBundle.body.warnings.length, 2);
  assert.match(fromBundle.body.warnings.join(' '), /imágenes del paquete/);
  assert.equal((await call('/api/dev/npcs/mara_test/import-over', { ...json({ ...bundle, version: 2 }), base: editing })).status, 400);

  // Rechazos.
  assert.equal((await call('/api/dev/npcs/mara_test/import-over', { ...json({}), base: editing })).status, 400);
  assert.equal((await call('/api/dev/npcs/mara_test/import-over', { kind: 'json', text: 'no es json', base: editing })).status, 400);
  assert.equal((await call('/api/dev/npcs/mara_test/import-over', { ...json({ name: '' }), base: editing })).status, 400, 'una ficha fusionada inválida no se devuelve');

  assert.equal(await readFile(path.join(npcDir, 'mara_test.json'), 'utf8'), before, 'la ficha guardada no cambió');
  assert.deepEqual(await readdir(npcDir), ['mara_test.json']);
  assert.deepEqual(await readdir(path.join(assetDir, 'portraits', 'mara_test')), ['default.png']);
});
