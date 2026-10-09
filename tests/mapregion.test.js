import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Terrain, TERRAIN_KINDS, TERRAIN_CODE, TERRAIN_PRESETS, MAX_CODE, SCATTER_KINDS, CHUNK, encodeChunk, decodeChunk, paintPolygon, scatterChunk, lodFor } from '../src/shared/mapTerrain.js';
import { emptyMap, normalizeMap, validateMap, mapBounds, PLACE_KINDS } from '../src/shared/mapSchema.js';
import { PLACE_KIND_LABEL, PLACE_KIND_COLOR, PLACE_IMPORTANCE, PLACE_DEFAULT_ICON, PLACE_ICONS, DECOR_KINDS, DECOR_LABEL, DECOR_SIZE, AREA_KINDS, AREA_Z, AREA_COLOR, AREA_LABEL } from '../src/shared/mapDefaults.js';
import { THEMES } from '../src/shared/mapStyle.js';
import { placeIndex, linkMinutes, linkKm, planTrip, straightKm, TRAVEL_MODES } from '../src/shared/mapTravel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readMap = async (id) => normalizeMap(JSON.parse(await readFile(path.join(root, 'data/canon/maps', `${id}.json`), 'utf8')));

// --- Terreno regional ----------------------------------------------------------------------------------------------------------------------------
test('the terrain knows snow, desert, arid land, urban and industrial ground, and old saved chunks still decode', () => {
  assert.deepEqual(TERRAIN_KINDS.slice(0, 7), ['water', 'land', 'sand', 'field', 'forest', 'park', 'mountain'], 'los códigos 1–7 no cambian: los mapas guardados siguen valiendo');
  for (const kind of ['snow', 'desert', 'arid', 'urban', 'industrial']) assert.ok(TERRAIN_CODE[kind] > 7 && TERRAIN_CODE[kind] <= MAX_CODE, kind);
  const cells = new Uint8Array(CHUNK * CHUNK); cells.fill(TERRAIN_CODE.industrial, 0, 300); cells.fill(TERRAIN_CODE.snow, 300, 700); cells.fill(TERRAIN_CODE.urban, 700, 710);
  assert.deepEqual(decodeChunk(encodeChunk(cells)), cells);
  assert.deepEqual(decodeChunk('2*1024'), new Uint8Array(CHUNK * CHUNK).fill(2), 'un trozo antiguo se lee igual');
  assert.equal(decodeChunk(`${MAX_CODE + 1}*1024`), null, 'un material desconocido es un trozo dañado');
  for (const kind of AREA_KINDS) assert.ok(AREA_Z[kind] !== undefined && AREA_COLOR[kind] && AREA_LABEL[kind]);
  for (const [id, theme] of Object.entries(THEMES)) for (const kind of TERRAIN_KINDS) assert.ok(theme.areas[kind], `${id}: color de ${kind}`);
});

test('painting a polygon fills the cells inside, respects protected materials and can erase', () => {
  const terrain = new Terrain({ cell: 1000, seed: 3, chunks: {} });
  const square = [[0, 0], [20000, 0], [20000, 20000], [0, 20000]];
  const painted = paintPolygon(terrain, square, 'desert', { rugged: 0 });
  assert.ok(painted >= 380 && painted <= 420, `unas 400 celdas de 1 km (${painted})`);
  assert.equal(terrain.kindAt(10000, 10000), 'desert'); assert.equal(terrain.kindAt(-5000, 10000), null, 'fuera no se toca');
  paintPolygon(terrain, [[5000, 5000], [9000, 5000], [9000, 9000], [5000, 9000]], 'water', { rugged: 0 });
  paintPolygon(terrain, square, 'snow', { rugged: 0, protect: ['water'] });
  assert.equal(terrain.kindAt(7000, 7000), 'water', 'el agua protegida no se pisa'); assert.equal(terrain.kindAt(15000, 15000), 'snow');
  paintPolygon(terrain, [[14000, 14000], [18000, 14000], [18000, 18000], [14000, 18000]], null, { mode: 'erase', rugged: 0 });
  assert.equal(terrain.kindAt(16000, 16000), null, 'borrar con una forma vacía las celdas');
  assert.equal(paintPolygon(terrain, [[0, 0], [1, 1]], 'land'), 0, 'dos puntos no son una forma');
  assert.equal(paintPolygon(terrain, square, 'dragon'), 0, 'un material desconocido no pinta nada');
  const rugged = new Terrain({ cell: 1000, seed: 3, chunks: {} });
  paintPolygon(rugged, square, 'land', { rugged: 0.9 });
  assert.notEqual(rugged.paintedCells(), 400, 'el borde irregular cambia el contorno');
  assert.deepEqual(new Terrain(terrain.toData()).toData(), terrain.toData(), 'se guarda y se lee igual');
});

test('trees, peaks and city blocks are scattered by chunk with a seed, at the scale of the map', () => {
  const region = new Terrain({ cell: 1000, seed: 5, forest: { spacing: 400, density: 0.95 }, chunks: {} });
  paintPolygon(region, [[0, 0], [30000, 0], [30000, 30000], [0, 30000]], 'urban', { rugged: 0 });
  paintPolygon(region, [[-30000, -30000], [-2000, -30000], [-2000, -2000], [-30000, -2000]], 'snow', { rugged: 0 });
  assert.deepEqual(SCATTER_KINDS.sort(), ['forest', 'industrial', 'mountain', 'snow', 'urban'].sort());
  const blocks = scatterChunk(region, 0, 0, 'urban', 0);
  assert.ok(blocks.length > 100, 'una ciudad se llena de edificios sueltos'); assert.deepEqual(blocks, scatterChunk(region, 0, 0, 'urban', 0), 'determinista');
  assert.ok(blocks.every((b) => b.r > 0 && b.r < 400), 'las manzanas son pequeñas frente a la celda');
  assert.ok(scatterChunk(region, -1, -1, 'snow', 0).length > 0, 'la nieve dibuja cumbres');
  assert.deepEqual(scatterChunk(region, 5, 5, 'urban', 0), [], 'sin material en el trozo no se dibuja nada');
  assert.deepEqual(scatterChunk(region, 0, 0, 'dragon', 0), []);
  assert.ok(lodFor(region, 0.003, 'urban') >= 1 && lodFor(region, 0.003) >= 1, 'a escala regional las copas y los edificios se agrupan al alejarse');
  assert.equal(lodFor(region, 3, 'urban'), 0);
  const city = new Terrain({ cell: 16, seed: 1, chunks: {} });
  paintPolygon(city, [[0, 0], [500, 0], [500, 500], [0, 500]], 'mountain', { rugged: 0 });
  const peaks = scatterChunk(city, 0, 0, 'mountain', 0);
  assert.ok(peaks.length > 0 && peaks.every((p) => p.r >= 40 * 0.32 - 0.1 && p.r <= 40 * 0.62 + 0.1), 'con celdas de 16 m las cumbres siguen separadas 40 m, como siempre');
  for (const preset of Object.values(TERRAIN_PRESETS)) assert.ok(validateMap(normalizeMap({ ...emptyMap('pre', 'Pre'), terrain: { cell: preset.cell, forest: preset.forest, chunks: {} } })).ok, preset.label);
});

// --- Esquema: lugares con más datos, enlaces calculables ---------------------------------------------------------------------------------------------------------
test('places carry importance, icon, faction, image and free data; kinds cover capital to special facility', () => {
  for (const kind of ['capital', 'city', 'town', 'station', 'district', 'port', 'facility', 'poi']) assert.ok(PLACE_KINDS.includes(kind), kind);
  for (const kind of PLACE_KINDS) assert.ok(PLACE_KIND_LABEL[kind] && PLACE_KIND_COLOR[kind] && PLACE_IMPORTANCE[kind] >= 1, kind);
  for (const icon of Object.values(PLACE_DEFAULT_ICON)) assert.ok(PLACE_ICONS.includes(icon), icon);
  assert.ok(PLACE_IMPORTANCE.capital > PLACE_IMPORTANCE.city && PLACE_IMPORTANCE.city > PLACE_IMPORTANCE.poi, 'la capital domina el mapa');
  const map = normalizeMap({ ...emptyMap('reg', 'Reg'), places: [
    { id: 'capital_x', name: 'X', kind: 'capital', x: 0, y: 0 },
    { id: 'cosa', name: 'Cosa', kind: 'poi', x: 5000, y: 0, importance: 4, icon: 'fortress', faction: '  Reino  ', image: 'r_cosa.webp', data: { poblacion: 1200, activo: true, nota: ' hola ', raro: { a: 1 }, b: NaN } }
  ] });
  assert.equal(map.places[0].importance, 5, 'sin importancia escrita se usa la del tipo'); assert.equal(map.places[0].icon, null); assert.deepEqual(map.places[0].data, {});
  assert.deepEqual(map.places[1].data, { activo: true, nota: 'hola', poblacion: 1200 }, 'solo texto, números y sí/no, ordenados por clave');
  assert.equal(map.places[1].faction, 'Reino'); assert.equal(map.places[1].image, 'r_cosa.webp');
  assert.deepEqual(normalizeMap(JSON.parse(JSON.stringify(map))), map, 'normalizar dos veces no cambia nada');
  assert.deepEqual(validateMap(map).errors, []);
  assert.ok(validateMap(normalizeMap({ ...map, places: [{ ...map.places[0], image: '../secreto.sh' }] })).errors.some((e) => e.code === 'place_image'), 'solo imágenes de assets/maps');
});

test('decor, lines and travel settings are part of the map and keep a stable shape', () => {
  for (const kind of DECOR_KINDS) assert.ok(DECOR_LABEL[kind] && DECOR_SIZE[kind] > 0, kind);
  const map = normalizeMap({ ...emptyMap('reg', 'Reg'), decor: [{ id: 'etq', kind: 'label', name: 'Mar', x: 1, y: 2 }], lines: [{ id: 'l1', name: 'L1', color: '#ABCDEF' }], travel: { speedsKmh: { rail: 100, nada: 5 } } });
  assert.deepEqual(map.decor[0], { id: 'etq', name: 'Mar', kind: 'label', x: 1, y: 2, size: DECOR_SIZE.label, rotation: 0, group: null });
  assert.deepEqual(map.lines[0], { id: 'l1', name: 'L1', mode: 'northline', color: '#abcdef' });
  assert.deepEqual(map.travel, { speedsKmh: { rail: 100 } }, 'solo velocidades de modos conocidos'); assert.equal(normalizeMap({ ...emptyMap('reg', 'Reg'), travel: { speedsKmh: {} } }).travel, null);
  assert.ok(mapBounds({ ...map, decor: [{ ...map.decor[0], x: 100000, y: 0, size: 20000 }] }).maxX >= 110000, 'la decoración cuenta para el encuadre');
  assert.equal(normalizeMap({ ...emptyMap('reg', 'Reg'), links: [{ id: 'e', from: 'a', to: 'b', mode: 'road', minutes: '' }] }).links[0].minutes, null, 'minutos vacíos = calculados');
});

// --- El mapa regional de Northfortress (datos canon) ------------------------------------------------------------------------------------------------------------------
test('the Northfortress territory map is valid, separate from the city map and follows the lore distances', async () => {
  const territory = await readMap('northfortress_territory'); const city = await readMap('northfortress');
  const taken = new Set([...city.places.map((p) => p.id), ...city.links.map((l) => l.id)]);
  const result = validateMap(territory, { takenIds: taken });
  assert.deepEqual(result.errors, []); assert.deepEqual(result.warnings.map((w) => w.message), [], 'sin avisos: todo lugar está en un distrito y no hay nombres ni ids repetidos');
  assert.ok(territory.places.every((p) => !taken.has(p.id)), 'los ids son únicos en todo el juego: la región no choca con la ciudad');
  assert.notEqual(territory.id, city.id); assert.equal(territory.style.theme, 'atlas');

  const byId = new Map(territory.places.map((p) => [p.id, p]));
  const capital = byId.get('northfortress_capital'); const station = byId.get('porta_magna_station');
  assert.equal(capital.kind, 'capital'); assert.equal(capital.importance, 5, 'la capital domina visualmente');
  assert.equal(station.kind, 'station', 'Porta Magna es una estación, no una ciudad');
  for (const id of ['heartstone', 'market_bridge', 'westwall', 'high_sanctuary']) assert.equal(byId.get(id).kind, 'city', id);
  for (const id of ['government_palace', 'nova_enterprise_hq', 'heroes_organization']) assert.equal(byId.get(id).kind, 'facility', id);
  assert.ok(territory.places.some((p) => p.kind === 'port'), 'Market Bridge tiene puerto');

  const index = placeIndex(territory); const km = (id) => straightKm(territory, 'northfortress_capital', id, index);
  assert.ok(km('heartstone') >= 19 && km('heartstone') <= 21, `Heartstone ≈ 20 km (${km('heartstone')})`);
  assert.ok(km('market_bridge') >= 35 && km('market_bridge') <= 50, `Market Bridge 35–50 km (${km('market_bridge')})`);
  assert.ok(km('high_sanctuary') >= 60 && km('high_sanctuary') <= 90, `High Sanctuary 60–90 km (${km('high_sanctuary')})`);
  assert.ok(km('westwall') >= 100 && km('westwall') <= 150, `Westwall 100–150 km (${km('westwall')})`);
  assert.ok(station.y > capital.y && km('porta_magna_station') < 12, 'Porta Magna está junto a la capital');
  assert.ok(byId.get('westwall').x < capital.x - 90000 && byId.get('high_sanctuary').y < capital.y - 60000, 'Westwall al oeste y High Sanctuary al norte');
  const box = mapBounds(territory); assert.ok(Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 1000 >= 250, 'el territorio mide entre 250 y 400 km de extremo a extremo');
  const region = territory.areas.find((area) => area.kind === 'region'); const xs = region.polygon.map(([x]) => x); const ys = region.polygon.map(([, y]) => y);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 1000; assert.ok(diagonal >= 250 && diagonal <= 400, `territorio de ${Math.round(diagonal)} km`);

  // Capital → Heartstone: ≈ 4 h a pie y ≈ 30 min en Northline (calculado, no escrito en el código)
  const trip = planTrip(territory, 'northfortress_capital', 'heartstone');
  const walk = trip.options.find((o) => o.id === 'walk'); const northline = trip.options.find((o) => o.modes.length === 1 && o.modes[0] === 'northline');
  assert.ok(walk.minutes >= 210 && walk.minutes <= 270, `a pie ${walk.minutes} min`);
  assert.ok(northline.minutes >= 28 && northline.minutes <= 32 && Math.abs(northline.km - 20) < 0.5, `Northline ${northline.minutes} min, ${northline.km} km`);
});

test('the Northline network links the six places, with Porta Magna as an interchange and each line coloured', async () => {
  const map = await readMap('northfortress_territory'); const index = placeIndex(map);
  const nl = map.links.filter((link) => link.mode === 'northline');
  assert.ok(nl.length >= 5);
  const reachable = (from) => { const seen = new Set([from]); const queue = [from]; while (queue.length) { const at = queue.shift(); for (const link of nl) for (const [a, b] of [[link.from, link.to], [link.to, link.from]]) if (a === at && !seen.has(b)) { seen.add(b); queue.push(b); } } return seen; };
  const network = reachable('porta_magna_station');
  for (const id of ['northfortress_capital', 'heartstone', 'market_bridge', 'westwall', 'high_sanctuary']) assert.ok(network.has(id), `Northline llega a ${id}`);
  const hub = (id) => map.links.filter((link) => link.from === id || link.to === id).length;
  assert.ok(hub('porta_magna_station') >= 3, 'Porta Magna conecta varias líneas');
  assert.ok(new Set(nl.map((link) => link.line)).size >= 4 && nl.every((link) => map.lines.some((line) => line.id === link.line)), 'cada enlace Northline pertenece a una línea con color');
  for (const mode of ['road', 'path', 'rail', 'northline', 'trade', 'sea']) assert.ok(map.links.some((link) => link.mode === mode), `hay enlaces de ${TRAVEL_MODES[mode].label}`);
  for (const link of map.links) { assert.ok(linkMinutes(map, link, index) >= 1 && linkKm(map, link, index) > 0, link.id); }
  const sea = map.links.find((link) => link.mode === 'sea'); assert.equal(byKind(map, sea.from), 'port', 'la ruta marítima sale de un puerto');
  assert.ok(planTrip(map, 'westwall', 'heartstone').options.some((o) => o.legs.length >= 2), 'se puede ir de Westwall a Heartstone cambiando de línea');
});
const byKind = (map, id) => map.places.find((p) => p.id === id)?.kind;

test('the territory is real terrain: sea, forests, mountains with snow, desert, urban and industrial ground', async () => {
  const map = await readMap('northfortress_territory'); const terrain = new Terrain(map.terrain);
  assert.equal(terrain.cell, TERRAIN_PRESETS.region.cell);
  const found = new Set(); for (const cells of terrain.chunks.values()) for (const code of cells) if (code) found.add(code);
  for (const kind of ['water', 'land', 'sand', 'field', 'forest', 'park', 'mountain', 'snow', 'desert', 'arid', 'urban', 'industrial']) assert.ok(found.has(TERRAIN_CODE[kind]), `hay ${kind}`);
  const at = (id) => { const p = map.places.find((place) => place.id === id); return terrain.kindAt(p.x, p.y); };
  const around = (id, radius) => { const p = map.places.find((place) => place.id === id); const tally = {}; for (let dx = -radius; dx <= radius; dx += 1000) for (let dy = -radius; dy <= radius; dy += 1000) { const kind = terrain.kindAt(p.x + dx, p.y + dy); tally[kind] = (tally[kind] ?? 0) + 1; } return tally; };
  const heart = around('heartstone', 6000); assert.ok(heart.industrial > heart.urban, 'alrededor de Heartstone domina el terreno industrial degradado, más que el casco urbano');
  const cap = around('northfortress_capital', 6000); assert.ok(cap.urban > 0.8 * Object.values(cap).reduce((a, b) => a + b, 0), 'la capital es una enorme mancha urbana');
  assert.equal(at('northfortress_capital'), 'urban'); assert.ok(['arid', 'desert', 'urban'].includes(at('westwall')), 'Westwall está en una región árida');
  assert.ok(['mountain', 'snow', 'urban'].includes(at('high_sanctuary')), 'High Sanctuary está en la montaña');
  assert.equal(terrain.kindAt(map.places.find((p) => p.id === 'porta_magna_station').x, map.places.find((p) => p.id === 'porta_magna_station').y + 6000), 'water', 'Porta Magna está junto a la bahía');
  assert.ok(map.ways.some((way) => way.kind === 'river') && map.areas.some((area) => area.kind === 'region') && map.decor.some((d) => d.kind === 'compass') && map.decor.some((d) => d.kind === 'label'));
});

test('the atlas API serves region maps read-only and plans trips between their places', async (t) => {
  const { once } = await import('node:events');
  const { createMapStore } = await import('../src/server/game/maps.js');
  const { createAppServer } = await import('../src/server/index.js');
  const { fixtureGeography } = await import('./support/world.js');
  const store = createMapStore({ dir: path.join(root, 'data/canon/maps'), assetDir: path.join(root, 'assets/maps') });
  const server = createAppServer({ geography: fixtureGeography(), maps: store, ai: {}, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async () => {}, loadRun: async () => ({}), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const list = await (await fetch(`${url}/api/atlas`)).json();
  assert.ok(list.maps.some((item) => item.id === 'northfortress_territory'), 'el territorio aparece en el atlas');
  const region = await (await fetch(`${url}/api/atlas/northfortress_territory`)).json();
  assert.equal(region.map.id, 'northfortress_territory'); assert.equal(region.map.places.length, 12);
  const trip = await (await fetch(`${url}/api/atlas/northfortress_territory/route?from=northfortress_capital&to=heartstone`)).json();
  assert.equal(trip.options.find((option) => option.id === 'walk').minutes >= 210, true);
  assert.ok(trip.options.some((option) => option.modes.includes('northline') && option.minutes >= 28 && option.minutes <= 32), 'Northline ≈ 30 min');
  assert.equal((await fetch(`${url}/api/atlas/northfortress_territory/route?from=northfortress_capital&to=nada`)).status, 400, 'un lugar que no existe se rechaza');
  assert.equal((await fetch(`${url}/api/atlas/no_existe`)).status, 404);
  assert.equal((await fetch(`${url}/api/atlas/northfortress_territory`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status >= 400, true, 'solo lectura: nada de escritura sin el modo de desarrollo');
});
