import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateNpcCard, saveNpcCard, listPortraits } from '../src/server/game/cards.js';
import { loadNpcs } from '../src/server/game/npcs.js';
import { buildBundle, parseBundle, installBundle, sanitizeLocations, BUNDLE_FORMAT, BUNDLE_VERSION } from '../src/server/game/bundle.js';
import { createAppServer } from '../src/server/index.js';
import { fixtureGeography } from './support/world.js';

const locations = ['cafe', 'park'];
const baseCard = (extra = {}) => ({
  id: 'mara_test', name: 'Mara', age: 31, gender: 'Mujer', race: 'celestial', role: 'Florista', summary: 'Soñadora.',
  schedule: [{ days: [0, 1], from: 9, to: 17, locationId: 'park', activity: 'vende flores' }], personality: { traits: ['dulce'] }, background: 'Creció entre invernaderos.',
  emotionsStay: ['triste'], stage: { heightCm: 155, frames: { default: { h: 0.71, x: 0, y: -0.03 }, feliz: { h: 0.73, x: 0.02, y: -0.04 } }, idle: { kind: 'float', strength: 1.5, speed: 1 } }, ...extra
});

// Imágenes falsas pero con los bytes mágicos correctos (lo único que el motor comprueba).
const PNG = (tag) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)]);
const WEBP = (tag) => Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), Buffer.from(tag)]);
const JPG = (tag) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(tag)]);
const entry = (buffer, type = 'image/webp') => ({ type, data: buffer.toString('base64') });
const bundleOf = (overrides = {}) => ({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: '2026-10-08T12:00:00.000Z', card: baseCard(), images: { default: entry(WEBP('d')), feliz: entry(PNG('f'), 'image/png') }, ...overrides });
const parse = (raw) => parseBundle(raw, { locationIds: locations, fallbackLocation: 'cafe' });
const scratch = async (t, prefix) => { const dir = await mkdtemp(path.join(tmpdir(), prefix)); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const portraitDir = (assets, id) => path.join(assets, 'portraits', id);
const tree = async (dir) => (await readdir(dir, { recursive: true }).catch(() => [])).map((name) => name.replaceAll('\\', '/')).sort();

// Prepara un «mundo» con un personaje: ficha en npcs/ y retratos (más un original en source/) en assets/.
async function seedWorld(t, id = 'mara_test') {
  const root = await scratch(t, 'hom-bundle-');
  const npcDir = path.join(root, 'npcs'); const assetDir = path.join(root, 'assets');
  await mkdir(npcDir, { recursive: true });
  const card = validateNpcCard(baseCard({ id }), locations);
  await saveNpcCard(npcDir, card);
  const folder = portraitDir(assetDir, id);
  await mkdir(path.join(folder, 'source'), { recursive: true });
  await writeFile(path.join(folder, 'default.webp'), WEBP('default-bytes'));
  await writeFile(path.join(folder, 'feliz.png'), PNG('feliz-bytes'));
  await writeFile(path.join(folder, 'triste.jpg'), JPG('triste-bytes'));
  await writeFile(path.join(folder, 'source', 'default.png'), PNG('master'));
  return { root, npcDir, assetDir, card };
}

test('a character survives export → import with identical card and image bytes', async (t) => {
  const from = await seedWorld(t);
  const bundle = JSON.parse(JSON.stringify(await buildBundle(from.assetDir, from.card)));   // por el cable, como en la descarga
  assert.equal(bundle.format, 'hom-character');
  assert.equal(bundle.version, 1);
  assert.deepEqual(Object.keys(bundle.images).sort(), ['default', 'feliz', 'triste']);
  assert.equal(bundle.images.triste.type, 'image/jpeg');
  assert.equal('source' in bundle, false, 'los originales no viajan');
  assert.ok(!JSON.stringify(bundle).includes('master'), 'ni siquiera su contenido');

  const to = await seedWorld(t, 'otra_cosa');   // otro mundo; el destino no tiene a mara_test
  await rm(portraitDir(to.assetDir, 'otra_cosa'), { recursive: true });
  const parsed = parse(bundle);
  assert.deepEqual(parsed.warnings, []);
  await installBundle({ npcDir: to.npcDir, assetDir: to.assetDir, card: parsed.card, images: parsed.images });

  assert.deepEqual(JSON.parse(await readFile(path.join(to.npcDir, 'mara_test.json'), 'utf8')), from.card, 'ficha idéntica (stage y emotionsStay incluidos)');
  const folder = portraitDir(to.assetDir, 'mara_test');
  for (const [file, original] of [['default.webp', WEBP('default-bytes')], ['feliz.png', PNG('feliz-bytes')], ['triste.jpg', JPG('triste-bytes')]]) {
    assert.ok((await readFile(path.join(folder, file))).equals(original), `${file} idéntico byte a byte`);
  }
  assert.deepEqual(Object.keys(await listPortraits(to.assetDir, 'mara_test')), ['default', 'feliz', 'triste']);
  assert.deepEqual((await tree(path.join(to.assetDir, 'portraits'))).filter((name) => name.startsWith('.')), [], 'sin carpetas temporales');
});

test('SVG images are not exported and a warning says so', async (t) => {
  const world = await seedWorld(t);
  await writeFile(path.join(portraitDir(world.assetDir, 'mara_test'), 'raro.svg'), '<svg onload="alert(1)"/>');
  const bundle = await buildBundle(world.assetDir, world.card);
  assert.equal('raro' in bundle.images, false);
  assert.match(bundle.warnings[0], /SVG/);
});

test('invalid bundles are rejected with clear messages', () => {
  assert.throws(() => parse(null), /paquete/);
  assert.throws(() => parse({ ...bundleOf(), format: 'otra-cosa' }), /paquete/);
  assert.throws(() => parse(bundleOf({ version: 2 })), /versión más nueva/);
  assert.throws(() => parse(bundleOf({ version: 0 })), /versión/);
  assert.throws(() => parse(bundleOf({ card: null })), /ficha/);
  assert.throws(() => parse(bundleOf({ images: { Feliz: entry(WEBP('x')), default: entry(WEBP('x')) } })), /emoción/);
  assert.throws(() => parse(bundleOf({ images: { feliz: entry(WEBP('x')) } })), /«default»/, 'default es obligatorio si hay imágenes');
  assert.throws(() => parse(bundleOf({ images: { default: { type: 'image/png', data: Buffer.from('esto no es una imagen').toString('base64') } } })), /no es un PNG, WebP o JPG/, 'el type declarado no se cree');
  assert.throws(() => parse(bundleOf({ images: { default: { type: 'image/png', data: 'no es base64!!' } } })), /base64/);
  assert.throws(() => parse(bundleOf({ images: { default: entry(PNG('x'.repeat(8_000_001))) } })), /8 MB/);
  const many = Object.fromEntries(Array.from({ length: 61 }, (_, index) => [index ? `e${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))}` : 'default', entry(WEBP('x'))]));
  assert.throws(() => parse(bundleOf({ images: many })), /máximo es 60/);
  const heavy = entry(WEBP('x'.repeat(7_000_000)));
  assert.throws(() => parse(bundleOf({ images: { default: heavy, a: heavy, b: heavy, c: heavy, d: heavy } })), /en total/);
  assert.throws(() => parse(bundleOf({ card: { ...baseCard(), name: '' } })), /nombre/, 'después se valida la ficha');
  assert.equal(parse(bundleOf({ images: {} })).images.length, 0, 'un paquete solo con ficha es válido');
});

test('unknown locations fall back to the start place with a warning instead of rejecting the card', () => {
  const card = baseCard({ home: 'atlantis', schedule: [{ days: [0], from: 9, to: 17, locationId: 'nowhere', activity: '' }, { days: [1], from: 9, to: 17, locationId: 'nowhere', activity: '' }, { days: [2], from: 9, to: 17, locationId: 'park', activity: '' }] });
  const parsed = parse(bundleOf({ card }));
  assert.deepEqual(parsed.card.schedule.map((slot) => slot.locationId), ['cafe', 'cafe', 'park']);
  assert.equal(parsed.card.home, 'cafe');
  assert.equal(parsed.warnings.length, 2, 'un aviso por lugar desconocido, sin repetir');
  assert.match(parsed.warnings.join(' '), /nowhere.*atlantis|atlantis.*nowhere/);
  const input = { schedule: [{ locationId: 'nowhere' }] };
  assert.equal(sanitizeLocations(input, locations, 'park').card.schedule[0].locationId, 'park');
  assert.equal(input.schedule[0].locationId, 'nowhere', 'no modifica la ficha de entrada');
  assert.equal(sanitizeLocations({ schedule: [{ locationId: 'x' }] }, locations, 'invalido').card.schedule[0].locationId, 'cafe', 'si el lugar de inicio tampoco existe usa el primero');
});

test('overwriting replaces the whole emotion set, keeps source/ and leaves no temporary folders', async (t) => {
  const world = await seedWorld(t);
  const folder = portraitDir(world.assetDir, 'mara_test');
  const parsed = parse(bundleOf({ images: { default: entry(WEBP('nuevo')), alegre: entry(PNG('alegre'), 'image/png') } }));
  await installBundle({ npcDir: world.npcDir, assetDir: world.assetDir, card: parsed.card, images: parsed.images });
  assert.deepEqual(await tree(folder), ['alegre.png', 'default.webp', 'source', 'source/default.png'], 'feliz y triste desaparecen; source/ sigue');
  assert.ok((await readFile(path.join(folder, 'default.webp'))).equals(WEBP('nuevo')));
  assert.ok((await readFile(path.join(folder, 'source', 'default.png'))).equals(PNG('master')), 'el original del creador no se toca');
  assert.deepEqual((await tree(path.join(world.assetDir, 'portraits'))).filter((name) => /(^|\/)\.(incoming|old)-/.test(name)), []);
  // Un paquete sin imágenes no borra las que ya hay.
  await installBundle({ npcDir: world.npcDir, assetDir: world.assetDir, card: parsed.card, images: [] });
  assert.deepEqual(await tree(folder), ['alegre.png', 'default.webp', 'source', 'source/default.png']);
});

test('a failure while saving the card restores the previous images and originals', async (t) => {
  const world = await seedWorld(t);
  const folder = portraitDir(world.assetDir, 'mara_test');
  const before = await tree(folder);
  const parsed = parse(bundleOf());
  // La ficha no se puede guardar (carpeta inexistente): la instalación entera debe deshacerse.
  await assert.rejects(installBundle({ npcDir: path.join(world.root, 'no-existe'), assetDir: world.assetDir, card: parsed.card, images: parsed.images }));
  assert.deepEqual(await tree(folder), before, 'mismas imágenes y mismo source/');
  assert.ok((await readFile(path.join(folder, 'default.webp'))).equals(WEBP('default-bytes')), 'con sus bytes originales');
  assert.ok((await readFile(path.join(folder, 'source', 'default.png'))).equals(PNG('master')));
  assert.deepEqual((await tree(path.join(world.assetDir, 'portraits'))).filter((name) => name.startsWith('.')), [], 'sin carpetas temporales');
  // Instalación nueva (sin personaje previo) que falla: no queda nada.
  const fresh = parse(bundleOf({ card: baseCard({ id: 'nueva_test' }) }));
  await assert.rejects(installBundle({ npcDir: path.join(world.root, 'no-existe'), assetDir: world.assetDir, card: fresh.card, images: fresh.images }));
  assert.deepEqual((await readdir(path.join(world.assetDir, 'portraits'))).sort(), ['mara_test']);
});

test('dev routes: export needs the dev header, import installs, 409 without overwrite, bad bundles touch nothing', async (t) => {
  const world = await seedWorld(t);
  const server = createAppServer({
    npcs: await loadNpcs(world.npcDir), npcDir: world.npcDir, assetDir: world.assetDir, geography: fixtureGeography(),
    ai: {}, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async () => {}, loadRun: async () => null, listRuns: async () => [] }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, { dev = true, method = body ? 'POST' : 'GET' } = {}) => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(dev ? { 'x-hom-dev': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const importBundle = (bundle, overwrite = false) => call('/api/dev/npcs/import', { kind: 'json', text: JSON.stringify(bundle), overwrite });

  assert.equal((await call('/api/dev/npcs/mara_test/bundle', null, { dev: false })).status, 403, 'sin cabecera dev no se exporta');
  assert.equal((await call('/api/dev/npcs/nadie/bundle')).status, 404);
  const exported = await call('/api/dev/npcs/mara_test/bundle');
  assert.equal(exported.status, 200);
  assert.equal(exported.body.format, 'hom-character');
  assert.deepEqual(Object.keys(exported.body.images).sort(), ['default', 'feliz', 'triste']);
  assert.equal(exported.body.card.stage.heightCm, 155);

  // Importar el paquete con otro id: se instala y las imágenes se sirven.
  const copy = { ...exported.body, card: { ...exported.body.card, id: 'mara_copia' } };
  const installed = await importBundle(copy);
  assert.equal(installed.status, 200);
  assert.deepEqual(Object.keys(installed.body.portraits).sort(), ['default', 'feliz', 'triste']);
  assert.deepEqual(installed.body.warnings, []);
  assert.deepEqual(installed.body.stage.frames.feliz, { h: 0.73, x: 0.02, y: -0.04 });
  assert.equal((await fetch(`${base}/assets/portraits/mara_copia/default.webp`)).status, 200);

  const again = await importBundle(copy);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'NPC_EXISTS');
  assert.match(again.body.error, /TODAS sus imágenes/, 'la confirmación avisa de que se reemplaza todo');
  const slim = { ...copy, images: { default: copy.images.default } };
  assert.equal((await importBundle(slim, true)).status, 200);
  assert.deepEqual(Object.keys((await call('/api/dev/npcs')).body.find((item) => item.id === 'mara_copia').portraits), ['default'], 'sobrescribir reemplaza el conjunto');

  // Un lugar desconocido entra con aviso y en el lugar de inicio del mundo (station en el mundo de pruebas).
  const stray = await importBundle({ ...exported.body, card: { ...exported.body.card, id: 'viajera', home: 'atlantis', schedule: [{ days: [0], from: 9, to: 17, locationId: 'atlantis', activity: '' }] } });
  assert.equal(stray.status, 200);
  assert.equal(stray.body.schedule[0].locationId, 'station');
  assert.equal(stray.body.warnings.length, 1);

  // Un paquete malo se rechaza sin tocar disco ni registrar al personaje.
  const bad = await importBundle({ ...exported.body, card: { ...exported.body.card, id: 'falsa' }, images: { default: { type: 'image/png', data: Buffer.from('no soy una imagen').toString('base64') } } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /PNG, WebP o JPG/);
  assert.equal((await importBundle({ format: 'hom-character', version: 9, card: {}, images: {} })).status, 400);
  assert.deepEqual((await readdir(path.join(world.assetDir, 'portraits'))).sort(), ['mara_copia', 'mara_test', 'viajera']);
  assert.ok(!(await call('/api/dev/npcs')).body.some((item) => item.id === 'falsa'));
  assert.deepEqual((await readdir(world.npcDir)).sort(), ['mara_copia.json', 'mara_test.json', 'viajera.json']);

  // La importación de una ficha suelta también tolera lugares desconocidos.
  const plain = await call('/api/dev/npcs/import', { kind: 'json', text: JSON.stringify(baseCard({ id: 'suelta', schedule: [{ days: [0], from: 9, to: 17, locationId: 'atlantis' }] })) });
  assert.equal(plain.status, 200);
  assert.equal(plain.body.schedule[0].locationId, 'station');
  assert.equal(plain.body.warnings.length, 1);
});
