import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { createGeography, createStaticGeography, buildWorld, normalizeConfig, WORLD_DEFAULTS } from '../src/server/game/geography.js';
import { normalizeMap } from '../src/shared/mapSchema.js';
import { gameRegistry, applyAction } from '../src/server/ai/tools/game.js';
import { createRun, relocateIfMissing } from '../src/server/game/run.js';
import { loadNpcs, presentNpcs } from '../src/server/game/npcs.js';
import { createMapStore } from '../src/server/game/maps.js';
import { createAppServer } from '../src/server/index.js';
import { SCENE_META, sceneFor } from '../src/client/scenes.js';
import { worldData, fixtureMap, fixtureConfig, fixtureGeography } from './support/world.js';

const npcs = await loadNpcs(path.resolve('data/canon/npcs'));
const profile = { name: 'Mara', age: 24, gender: 'woman', race: 'human', appearance: '', origin: '' };
const ctxOf = (run, world = worldData) => ({ run, worldData: world, npcs, present: (current) => presentNpcs(npcs, current.player.locationId, current.world) });

// --- Tiempos de viaje: los calcula el motor, relativos al origen --------------------------------------------------------------------------
test('travel time depends on where you start: distance / walking speed, with a minimum, and never fixed per place', () => {
  assert.deepEqual(worldData.trip('apartment', 'cafe'), { minutes: 20, meters: 1600, tooFar: false });
  assert.equal(worldData.travelMinutes('cafe', 'apartment'), 20, 'ida y vuelta iguales');
  assert.equal(worldData.travelMinutes('cafe', 'park'), 25, 'el mismo destino cuesta distinto según de dónde vengas (2000 m)');
  assert.equal(worldData.travelMinutes('apartment', 'park'), 15);
  assert.equal(worldData.travelMinutes('store', 'apartment'), 10);
  assert.deepEqual(worldData.trip('cafe', 'cafe'), { minutes: 0, meters: 0, tooFar: false });
  assert.deepEqual(worldData.travelTable('cafe').find((row) => row.id === 'park'), { id: 'park', minutes: 25, meters: 2000, tooFar: false });
});

test('no trip is instantaneous: two nearby places still cost the minimum, and the speed and the minimum come from the world settings', () => {
  const close = normalizeMap({ ...fixtureMap, places: [...fixtureMap.places, { id: 'kiosk', name: 'Quiosco', kind: 'shop', x: 20, y: 0 }] });
  const world = buildWorld(close, { ...fixtureConfig, minTravelMinutes: 3 });
  assert.equal(world.travelMinutes('apartment', 'kiosk'), 3, '20 m son menos de un minuto: se aplica el mínimo');
  assert.equal(buildWorld(close, { ...fixtureConfig, walkMetersPerMinute: 160 }).travelMinutes('apartment', 'cafe'), 10, 'el doble de rápido, la mitad de tiempo');
  assert.deepEqual(normalizeConfig({}), { id: null, mapId: null, spawn: null, ...WORLD_DEFAULTS }, 'sin ajustes: valores por defecto');
  assert.equal(normalizeConfig({ walkMetersPerMinute: -4, minTravelMinutes: 'x' }).walkMetersPerMinute, WORLD_DEFAULTS.walkMetersPerMinute);
});

test('unknown ids: an unknown destination has no trip, an unknown origin is treated as the starting place', () => {
  assert.equal(worldData.trip('apartment', 'atlantis'), null);
  assert.equal(worldData.travelMinutes('atlantis', 'cafe'), worldData.travelMinutes('station', 'cafe'));
  assert.equal(worldData.place('atlantis'), null);
  assert.equal(worldData.spawn, 'station');
  assert.equal(buildWorld(normalizeMap(fixtureMap), { spawn: 'nowhere' }).spawn, 'apartment', 'un lugar de inicio que no existe cae al primer lugar del mapa');
});

test('the world shows the names the author wrote in the editor, the district of the map, and no fixed travel minutes', () => {
  const cafe = worldData.place('cafe');
  assert.equal(cafe.name, "Luna's Coffee");
  assert.equal(cafe.district, 'Central');
  assert.deepEqual(cafe.hours, { open: 6, close: 22 });
  assert.equal(worldData.name, 'Testland', 'el nombre del mundo sale del mapa');
  assert.ok(worldData.locations.every((location) => !('travelMinutes' in location)));
  assert.ok(!('travelMinutes' in JSON.parse(JSON.stringify(worldData.view('v1')))), 'ni en lo que se envía al cliente');
});

test('travel tool: relative minutes, the distance in the result, an unknown origin, and a rejection when the walk is too long', async () => {
  const run = createRun(profile);
  run.player.locationId = 'cafe';
  const moved = await gameRegistry.execute('travel', { place: 'park' }, ctxOf(run), { role: 'gm' });
  assert.deepEqual([moved.ok, moved.result.minutes, moved.result.distance], [true, 25, 2000]);
  assert.equal(moved.run.world.minute, 25);
  assert.equal(applyAction(run, { type: 'travel', locationId: 'apartment' }, worldData).world.minute, 20);
  const info = await gameRegistry.execute('place_info', { place: 'park' }, ctxOf(run), { role: 'gm' });
  assert.deepEqual([info.result.travelMinutes, info.result.distanceMeters], [25, 2000], 'place_info da los minutos desde el lugar actual');
  const lost = createRun(profile); lost.player.locationId = 'lugar_borrado';
  assert.equal((await gameRegistry.execute('travel', { place: 'cafe' }, ctxOf(lost), { role: 'gm' })).result.minutes, 32, 'origen desconocido: se cuenta desde el lugar de inicio (estación → café, 2561 m)');
  const far = buildWorld(normalizeMap(fixtureMap), { ...fixtureConfig, maxWalkMinutes: 22 });
  const refused = await gameRegistry.execute('travel', { place: 'park' }, ctxOf(run, far), { role: 'gm' });
  assert.deepEqual([refused.ok, refused.code], [false, 'too_far']);
  assert.match(refused.reason, /25 minutos/);
  assert.equal(run.player.locationId, 'cafe');
});

// --- Partidas guardadas ---------------------------------------------------------------------------------------------------------------------------
test('a save in a place that no longer exists is sent to the starting place, with a note in the log (and keeps working)', () => {
  const run = createRun(profile); run.player.locationId = 'lunacoffee';
  const fixed = relocateIfMissing(run, worldData);
  assert.equal(fixed.player.locationId, 'station');
  assert.deepEqual(fixed.eventLog.at(-1), { time: 'DAY_1_08:00', type: 'location_missing', data: { from: 'lunacoffee', to: 'station' } });
  assert.equal(run.player.locationId, 'lunacoffee', 'no muta la partida recibida');
  const fine = createRun(profile); fine.player.locationId = 'cafe';
  assert.equal(relocateIfMissing(fine, worldData), fine, 'un lugar que existe no cambia nada');
  assert.equal(relocateIfMissing(run, { locations: [] }), run, 'un mundo sin lugar de inicio no toca la partida');
  const talking = createRun(profile); talking.player.locationId = 'borrado'; talking.encounter = { npcId: 'luna_serp', locationId: 'borrado', lines: [] };
  assert.equal(relocateIfMissing(talking, worldData).encounter.locationId, 'station');
  assert.equal(applyAction(fixed, { type: 'travel', locationId: 'cafe' }, worldData).player.locationId, 'cafe', 'y se puede seguir jugando');
});

// --- Recarga en caliente --------------------------------------------------------------------------------------------------------------------------
async function tempWorld(t, map = fixtureMap) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'hom-geo-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const mapsDir = path.join(base, 'maps'); await mkdir(mapsDir);
  const worldFile = path.join(base, 'world.json');
  await writeFile(worldFile, JSON.stringify({ id: 'testland', mapId: 'testland', ...fixtureConfig }));
  const writeMap = (next) => writeFile(path.join(mapsDir, 'testland.json'), JSON.stringify(next));
  await writeMap(map);
  const warnings = [];
  return { base, mapsDir, worldFile, writeMap, warnings, geography: createGeography({ worldFile, mapsDir, ttl: 0, warn: (message) => warnings.push(message) }) };
}

test('hot reload: when the author moves a place or adds a new one in the editor, the next refresh uses it without touching code', async (t) => {
  const { geography, writeMap } = await tempWorld(t);
  const first = await geography.refresh(true);
  assert.equal(first.travelMinutes('apartment', 'cafe'), 20);
  assert.equal(geography.world(), first, 'sin cambios en los archivos, el mismo mundo');
  const edited = structuredClone(fixtureMap);
  edited.places.find((place) => place.id === 'cafe').x = 800;
  edited.places.push({ id: 'library', name: 'Biblioteca', kind: 'poi', x: 0, y: 400, hours: { open: 9, close: 18 } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeMap(edited);
  const version = geography.version();
  const second = await geography.refresh();
  assert.notEqual(second, first);
  assert.notEqual(geography.version(), version, 'la versión cambia: el cliente sabe que debe volver a pedir el mapa');
  assert.equal(second.travelMinutes('apartment', 'cafe'), 10, 'el lugar movido cambia el tiempo');
  assert.deepEqual([second.place('library').name, second.place('library').hours], ['Biblioteca', { open: 9, close: 18 }]);
  assert.equal(second.travelMinutes('apartment', 'library'), 5, 'y el lugar nuevo ya se puede visitar');
});

test('an invalid map never breaks the game: the last good copy is used, or the loaded map is kept, and the problem is reported', async (t) => {
  const { geography, mapsDir, writeMap, warnings } = await tempWorld(t);
  await geography.refresh(true);
  const broken = structuredClone(fixtureMap); broken.places[0].id = 'Mal Id';
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeMap(broken);
  const kept = await geography.refresh();
  assert.ok(kept.place('apartment'), 'se conserva el mapa que ya estaba cargado');
  assert.ok(warnings.some((message) => /no es válido/.test(message)));
  // arranque con el mapa roto pero con copia buena en .backup
  await mkdir(path.join(mapsDir, '.backup'));
  await writeFile(path.join(mapsDir, '.backup', 'testland-2026-10-04T10-00-00-000Z.json'), JSON.stringify(fixtureMap));
  const cold = createGeography({ worldFile: path.join(mapsDir, '..', 'world.json'), mapsDir, warn: (message) => warnings.push(message) });
  assert.ok((await cold.refresh(true)).place('cafe'), 'arranca con la última copia buena');
  assert.match(cold.status().source, /copia testland-/);
  assert.ok(warnings.some((message) => /se usa copia/.test(message)));
  // sin copia ni mapa cargado no hay de dónde sacar lugares
  const bare = await tempWorld(t, broken);
  await assert.rejects(bare.geography.refresh(true), /No se pudo cargar el mapa/);
});

// --- API ------------------------------------------------------------------------------------------------------------------------------------------
async function boot(t, run) {
  const runs = new Map([[run.id, run]]);
  const server = createAppServer({ geography: fixtureGeography(), ai: {}, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (item) => runs.set(item.id, structuredClone(item)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (route) => { const response = await fetch(base + route); return { status: response.status, body: await response.json() }; };
}

test('API: /api/world has the names and no fixed travel minutes; /api/world/map gives the map; the run map has relative minutes and only people you know', async (t) => {
  const run = createRun(profile); run.player.locationId = 'cafe';
  const get = await boot(t, run);
  const world = await get('/api/world');
  assert.equal(world.status, 200);
  assert.deepEqual(world.body.locations.map((location) => location.id), ['apartment', 'cafe', 'park', 'store', 'station']);
  assert.equal(world.body.name, 'Testland');
  assert.equal(world.body.spawn, 'station');
  assert.ok(world.body.locations.every((location) => !('travelMinutes' in location)));
  const map = await get('/api/world/map');
  assert.equal(map.body.version, world.body.version);
  assert.equal(map.body.map.places.length, 5);

  const mine = await get(`/api/runs/${run.id}/map`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.from, 'cafe');
  assert.deepEqual(mine.body.places.find((row) => row.id === 'park'), { id: 'park', minutes: 25, meters: 2000, tooFar: false, usual: [] });
  assert.equal(mine.body.places.find((row) => row.id === 'cafe').minutes, 0);
  assert.deepEqual(mine.body.places.find((row) => row.id === 'cafe').usual, [], 'Luna trabaja aquí, pero el jugador aún no la conoce');
  run.relationships = { luna_serp: { met: true } };
  const known = await get(`/api/runs/${run.id}/map`);
  assert.deepEqual(known.body.places.find((row) => row.id === 'cafe').usual, [{ id: 'luna_serp', name: 'Luna Serp' }]);
  assert.deepEqual(known.body.places.find((row) => row.id === 'park').usual, []);
});

test('API: loading a save that is in a deleted place works, and puts the player at the starting place', async (t) => {
  const run = createRun(profile); run.player.locationId = 'lunacoffee';
  const get = await boot(t, run);
  const loaded = await get(`/api/runs/${run.id}`);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.player.locationId, 'station');
  assert.equal(loaded.body.eventLog.at(-1).type, 'location_missing');
});

// --- El mapa REAL del juego -----------------------------------------------------------------------------------------------------------------------
test('the real game map defines every place that the NPC cards, the scene catalogue and the starting place use', async () => {
  const geography = createGeography({ worldFile: path.resolve('data/canon/world.json'), mapsDir: path.resolve('data/canon/maps') });
  const world = await geography.refresh(true);
  assert.ok(world.place(world.spawn), 'hay un lugar de inicio');
  assert.equal(world.spawn, 'station');
  for (const npc of npcs.values()) {
    for (const id of [npc.home, ...npc.schedule.map((slot) => slot.locationId)].filter(Boolean)) assert.ok(world.place(id), `${npc.name} usa «${id}», que el mapa no define`);
  }
  for (const id of Object.keys(SCENE_META)) assert.ok(world.place(id), `la escena «${id}» no tiene lugar en el mapa`);
  for (const location of world.locations) assert.ok(SCENE_META[sceneFor(location)], `«${location.id}» tiene escena (propia o genérica por tipo)`);
  assert.equal(world.place('cafe').name, "Luna's Coffee", 'el nombre visible es el del editor');
  assert.deepEqual(world.place('cafe').hours, { open: 6, close: 22 });
  assert.equal(world.name, JSON.parse(await readFile(path.resolve('data/canon/maps/northfortress.json'), 'utf8')).name);
  assert.ok(world.travelMinutes('cafe', 'station') > world.travelMinutes('apartment', 'store'), 'los tiempos salen de las distancias del mapa');
});

test('a static geography has the same interface as the live one', async () => {
  const geography = createStaticGeography(fixtureMap, fixtureConfig);
  assert.equal(await geography.refresh(), undefined);
  assert.equal(geography.world().travelMinutes('apartment', 'cafe'), 20);
  assert.equal(geography.map().places.length, 5);
});

test('hot reload through the real server: saving the map from the editor API changes /api/world and the travel times at once, no restart', async (t) => {
  const { mapsDir, worldFile } = await tempWorld(t);
  const geography = createGeography({ worldFile, mapsDir, ttl: 600_000 });   // sin recarga por reloj: solo la del guardado
  await geography.refresh(true);
  const run = createRun(profile); run.player.locationId = 'apartment';
  const runs = new Map([[run.id, run]]);
  const server = createAppServer({ geography, maps: createMapStore({ dir: mapsDir, assetDir: path.join(mapsDir, '..', 'assets') }), ai: { narrate: async () => 'Llegas a la biblioteca.' }, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (item) => runs.set(item.id, structuredClone(item)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = async (route, options) => (await fetch(base + route, { headers: { 'content-type': 'application/json', 'x-hom-dev': '1' }, ...options })).json();
  assert.equal((await json(`/api/runs/${run.id}/map`)).places.find((row) => row.id === 'cafe').minutes, 20);
  const edited = structuredClone(fixtureMap);
  edited.places.find((place) => place.id === 'cafe').x = 400;
  edited.places.push({ id: 'library', name: 'Biblioteca', kind: 'poi', x: 0, y: 160 });
  const saved = await fetch(`${base}/api/dev/maps/testland`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-hom-dev': '1' }, body: JSON.stringify({ map: edited }) });
  assert.equal(saved.status, 200);
  const world = await json('/api/world');
  assert.ok(world.locations.some((location) => location.id === 'library' && location.name === 'Biblioteca'), 'el lugar nuevo ya está en el mundo');
  const mine = await json(`/api/runs/${run.id}/map`);
  assert.equal(mine.places.find((row) => row.id === 'cafe').minutes, 5, 'el lugar movido cambia el tiempo (400 m a 80 m/min)');
  assert.equal(mine.places.find((row) => row.id === 'library').minutes, 2, '160 m son 2 minutos');
  const trip = await fetch(`${base}/api/runs/${run.id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'travel', locationId: 'library' }) });
  const arrived = await trip.json();
  assert.equal(trip.status, 200);
  assert.deepEqual([arrived.player.locationId, arrived.world.minute], ['library', 2], 'y se puede viajar al lugar nuevo: 2 minutos según el mapa recién guardado');
});
