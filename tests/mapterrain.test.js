import test from 'node:test';
import assert from 'node:assert/strict';
import { Terrain, CHUNK, CHUNK_CELLS, TERRAIN_CODE, encodeChunk, decodeChunk, emptyTerrain, terrainBoundsOf, paintStroke, floodFill, generateTerrain, contourChunk, strideFor, scatterChunk, lodFor, valueNoise, fbm } from '../src/shared/mapTerrain.js';
import { polygonArea } from '../src/shared/geo.js';
import { emptyMap, normalizeMap, validateMap, mapBounds } from '../src/shared/mapSchema.js';

const polygonsOf = (flat) => { const out = []; let i = 0; while (i < flat.length) { const n = flat[i++]; const ring = []; for (let k = 0; k < n; k++) { ring.push([flat[i], flat[i + 1]]); i += 2; } out.push(ring); } return out; };
const areaOf = (terrain, code, stride = 1) => terrain.renderChunks().reduce((sum, [cx, cy]) => sum + polygonsOf(contourChunk(terrain, cx, cy, code, stride).fill).reduce((acc, ring) => acc + polygonArea(ring), 0), 0);
const count = (terrain, kind) => { let n = 0; for (const cells of terrain.chunks.values()) for (const code of cells) if (code === TERRAIN_CODE[kind]) n++; return n; };

test('noise is deterministic, smooth and within 0–1', () => {
  assert.equal(valueNoise(3, 1.25, 2.5), valueNoise(3, 1.25, 2.5));
  assert.notEqual(valueNoise(3, 1.25, 2.5), valueNoise(4, 1.25, 2.5));
  for (let i = 0; i < 400; i++) { const v = fbm(9, i * 0.37, i * 0.11); assert.ok(v >= 0 && v <= 1); }
  assert.ok(Math.abs(valueNoise(1, 5.001, 5.001) - valueNoise(1, 5, 5)) < 0.01, 'sin saltos');
});

test('a chunk is stored as runs and decodes back exactly; broken text is refused', () => {
  const cells = new Uint8Array(CHUNK_CELLS); cells.fill(2, 0, 700); cells.fill(1, 700, 705); cells[900] = 5;
  const text = encodeChunk(cells);
  assert.ok(text.length < 60, text);
  assert.deepEqual(decodeChunk(text), cells);
  assert.equal(encodeChunk(new Uint8Array(CHUNK_CELLS)), '0*1024');
  for (const bad of ['', 'x', '9*1024', '2*1023', '2*1025', '2*0,0*1024', '2*1024,1', '1,1,1', null, 5, '2*1024 ']) assert.equal(decodeChunk(bad), null, String(bad));
});

test('the grid reads and writes cells across chunks and negative coordinates', () => {
  const terrain = new Terrain();
  assert.equal(terrain.get(5, 5), 0); assert.equal(terrain.isEmpty(), true);
  assert.equal(terrain.set(5, 5, TERRAIN_CODE.forest), true); assert.equal(terrain.set(5, 5, TERRAIN_CODE.forest), false, 'sin cambio no cuenta');
  terrain.set(-1, -1, TERRAIN_CODE.water); terrain.set(CHUNK, 0, TERRAIN_CODE.sand); terrain.set(-CHUNK - 1, 70, TERRAIN_CODE.mountain);
  assert.equal(terrain.get(5, 5), 5); assert.equal(terrain.get(-1, -1), 1); assert.equal(terrain.get(CHUNK, 0), 3); assert.equal(terrain.get(-CHUNK - 1, 70), 7);
  assert.equal(terrain.chunks.size, 4); assert.equal(terrain.paintedCells(), 4);
  assert.equal(terrain.kindAt(5.5 * 16, 5.5 * 16), 'forest'); assert.equal(terrain.kindAt(-8, -8), 'water'); assert.equal(terrain.kindAt(9999, 9999), null);
  assert.equal(terrain.set(5, 5, 0), true); assert.equal(terrain.paintedCells(), 3);
});

test('terrain data round-trips and drops empty chunks', () => {
  const terrain = new Terrain({ cell: 20, seed: 7, forest: { spacing: 5, density: 0.5 }, chunks: {} });
  terrain.set(0, 0, 2); terrain.set(40, -3, 1); terrain.set(100, 100, 5); terrain.set(100, 100, 0);
  const data = terrain.toData();
  assert.deepEqual(Object.keys(data), ['cell', 'seed', 'forest', 'chunks']);
  assert.deepEqual(Object.keys(data.chunks).sort(), ['0,0', '1,-1']);
  const again = new Terrain(data);
  assert.deepEqual(again.toData(), data); assert.equal(again.cell, 20); assert.equal(again.seed, 7); assert.equal(again.forest.density, 0.5);
  assert.equal(new Terrain({ chunks: { 'x,y': '0*1024', '0,0': 'roto' } }).chunks.size, 0, 'trozos inválidos se ignoran');
  assert.deepEqual(emptyTerrain().chunks, {});
  assert.deepEqual(terrainBoundsOf(data), { minX: 0, minY: -640, maxX: 1280, maxY: 640 });
  assert.equal(terrainBoundsOf({ cell: 16, chunks: {} }), null);
  assert.equal(terrainBoundsOf(null), null);
});

test('the brush paints a round area of the right size, erases, and protects what it must', () => {
  const terrain = new Terrain();
  const changed = paintStroke(terrain, [[0, 0]], 160, 'forest', { rugged: 0 });
  const expected = Math.PI * 160 * 160 / (16 * 16);
  assert.equal(changed, count(terrain, 'forest'));
  assert.ok(Math.abs(changed - expected) / expected < 0.12, `${changed} celdas, esperadas ~${Math.round(expected)}`);
  assert.equal(terrain.kindAt(0, 0), 'forest'); assert.equal(terrain.kindAt(200, 0), null);
  const stroke = paintStroke(new Terrain(), [[0, 0], [800, 0]], 64, 'land', { rugged: 0 });
  assert.ok(stroke > (800 * 128) / 256 * 0.85, `una pincelada larga cubre su recorrido (${stroke})`);
  paintStroke(terrain, [[0, 0]], 60, 'water', { rugged: 0 });
  paintStroke(terrain, [[0, 0]], 400, 'sand', { rugged: 0, protect: ['water'] });
  assert.equal(terrain.kindAt(0, 0), 'water', 'el agua protegida no se pisa');
  assert.equal(terrain.kindAt(100, 0), 'sand');
  paintStroke(terrain, [[0, 0]], 500, null, { mode: 'erase', rugged: 0 });
  assert.equal(terrain.paintedCells(), 0, 'borrar deja las celdas sin pintar');
  assert.equal(paintStroke(terrain, [], 50, 'land'), 0); assert.equal(paintStroke(terrain, [[0, 0]], 0, 'land'), 0); assert.equal(paintStroke(terrain, [[0, 0]], 50, 'lava'), 0);
});

test('a ragged brush leaves a natural, repeatable edge', () => {
  const smooth = new Terrain(); const rough = new Terrain(); const again = new Terrain();
  paintStroke(smooth, [[0, 0]], 200, 'land', { rugged: 0 }); paintStroke(rough, [[0, 0]], 200, 'land', { rugged: 1 }); paintStroke(again, [[0, 0]], 200, 'land', { rugged: 1 });
  assert.notDeepEqual(smooth.toData(), rough.toData());
  assert.deepEqual(rough.toData(), again.toData(), 'el mismo gesto da el mismo borde');
});

test('smoothing removes specks and keeps big shapes', () => {
  const terrain = new Terrain();
  paintStroke(terrain, [[0, 0]], 300, 'land', { rugged: 0 });
  terrain.set(0, 0, TERRAIN_CODE.water); terrain.set(5, 3, TERRAIN_CODE.water); terrain.set(-4, -2, TERRAIN_CODE.sand);
  const before = terrain.paintedCells();
  paintStroke(terrain, [[0, 0]], 200, null, { mode: 'smooth' });
  assert.equal(terrain.get(0, 0), TERRAIN_CODE.land); assert.equal(terrain.get(5, 3), TERRAIN_CODE.land); assert.equal(terrain.get(-4, -2), TERRAIN_CODE.land);
  assert.ok(Math.abs(terrain.paintedCells() - before) / before < 0.02, 'la forma general se mantiene');
});

test('the bucket fills a bounded region, refuses to flood the infinite void and does nothing on the same material', () => {
  const terrain = new Terrain();
  paintStroke(terrain, [[0, 0]], 400, 'land', { rugged: 0 });
  paintStroke(terrain, [[0, 0]], 200, 'sand', { rugged: 0 });
  const sandCells = count(terrain, 'sand');
  const result = floodFill(terrain, 0, 0, 'field');
  assert.equal(result.filled, sandCells); assert.equal(count(terrain, 'sand'), 0); assert.equal(count(terrain, 'field'), sandCells);
  assert.equal(terrain.kindAt(300, 0), 'land', 'el anillo de tierra queda intacto');
  assert.deepEqual(floodFill(terrain, 0, 0, 'field'), { filled: 0, truncated: false });
  const void_ = floodFill(terrain, 5000, 5000, 'water', { limit: 5000 });
  assert.deepEqual(void_, { filled: 0, truncated: true }); assert.equal(terrain.kindAt(5000, 5000), null);
  assert.equal(floodFill(terrain, 0, 0, 'lava').filled, 0);
});

test('natural generation is repeatable, mixes materials and follows its sliders', () => {
  const rect = { minX: 0, minY: 0, maxX: 6400, maxY: 6400 };
  const a = new Terrain(); const b = new Terrain(); generateTerrain(a, rect, { seed: 4 }); generateTerrain(b, rect, { seed: 4 });
  assert.deepEqual(a.toData(), b.toData());
  const other = new Terrain(); generateTerrain(other, rect, { seed: 5 });
  assert.notDeepEqual(a.toData(), other.toData());
  for (const kind of ['water', 'land', 'sand', 'forest', 'mountain']) assert.ok(count(a, kind) > 100, `${kind}: ${count(a, kind)}`);
  const total = a.paintedCells(); assert.equal(total, (6400 / 16 + 1) ** 2);
  const drier = new Terrain(); generateTerrain(drier, rect, { seed: 4, sea: 0.1 });
  const wetter = new Terrain(); generateTerrain(wetter, rect, { seed: 4, sea: 0.9 });
  assert.ok(count(wetter, 'water') > count(a, 'water') && count(a, 'water') > count(drier, 'water'));
  const woody = new Terrain(); generateTerrain(woody, rect, { seed: 4, forest: 1 }); const bare = new Terrain(); generateTerrain(bare, rect, { seed: 4, forest: 0 });
  assert.ok(count(woody, 'forest') > count(bare, 'forest') * 2);
  const island = new Terrain(); generateTerrain(island, rect, { seed: 4, island: 1 });
  assert.equal(island.kindAt(20, 20), 'water', 'una isla deja el mar en las esquinas');
  const keep = new Terrain(); paintStroke(keep, [[3200, 3200]], 300, 'park', { rugged: 0 });
  const parkBefore = count(keep, 'park'); generateTerrain(keep, rect, { seed: 4 });
  assert.equal(count(keep, 'park'), parkBefore, 'sin sobrescribir, lo pintado se respeta');
  generateTerrain(keep, rect, { seed: 4, overwrite: true });
  assert.equal(count(keep, 'park'), 0, 'sobrescribiendo, se reemplaza');
});

test('contours follow the painted shape at any zoom and across chunk borders', () => {
  const terrain = new Terrain();
  paintStroke(terrain, [[0, 0]], 500, 'land', { rugged: 0.5 });
  const painted = terrain.paintedCells() * 256;
  for (const stride of [1, 2, 4, 8]) {
    const area = areaOf(terrain, 0, stride);
    assert.ok(Math.abs(area - painted) / painted < 0.16, `paso ${stride}: ${Math.round(area)} m² frente a ${painted}`);
  }
  assert.equal(areaOf(terrain, TERRAIN_CODE.forest), 0, 'sin ese material no hay contorno');
  assert.deepEqual(contourChunk(new Terrain(), 0, 0, 0), { fill: [], line: [] });
  const { fill, line } = contourChunk(terrain, 0, 0, 0);
  assert.ok(fill.length > 0 && line.length > 0 && line.length % 4 === 0);
  const rings = polygonsOf(fill); assert.ok(rings.every((ring) => ring.length >= 3 && ring.length <= 6));
  assert.deepEqual(contourChunk(terrain, 0, 0, 0), { fill, line }, 'determinista');
});

test('a material contour fills the hole between two materials without gaps', () => {
  const terrain = new Terrain();
  paintStroke(terrain, [[0, 0]], 600, 'land', { rugged: 0.3 });
  paintStroke(terrain, [[0, 0]], 250, 'water', { rugged: 0.3 });
  const water = areaOf(terrain, TERRAIN_CODE.water); const waterCells = count(terrain, 'water') * 256;
  assert.ok(Math.abs(water - waterCells) / waterCells < 0.2, `${Math.round(water)} frente a ${waterCells}`);
});

test('strides grow as the zoom drops and never exceed a chunk', () => {
  assert.equal(strideFor(16, 1), 1); assert.equal(strideFor(16, 0.2), 1); assert.equal(strideFor(16, 0.1), 2);
  assert.equal(strideFor(16, 0.05), 4); assert.ok(strideFor(16, 0.0001) <= CHUNK);
  let last = 0; for (const k of [2, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01]) { const s = strideFor(16, k); assert.ok(s >= last); last = s; }
});

test('forest scatter is dense, only grows on forest, is repeatable and does not move when other chunks change', () => {
  const terrain = new Terrain();
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) terrain.set(i - CHUNK, j, TERRAIN_CODE.forest);   // el trozo (-1, 0) entero
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) terrain.set(i, j, TERRAIN_CODE.forest);            // y el (0, 0)
  const trees = scatterChunk(terrain, 0, 0, 'forest', 0);
  const perfect = (512 * 512) / (4.5 * 4.5) * 0.9;
  assert.ok(trees.length > perfect * 0.6 && trees.length <= perfect * 1.05, `árboles: ${trees.length} (máx. ${Math.round(perfect)})`);
  assert.deepEqual(scatterChunk(terrain, 0, 0, 'forest', 0), trees);
  for (const tree of trees) { assert.ok(tree.x >= 0 && tree.x < 512 && tree.y >= 0 && tree.y < 512); assert.ok(tree.r >= 2.2 && tree.r <= 4.1, `r ${tree.r}`); }
  assert.deepEqual([...trees].sort((a, b) => a.y - b.y), trees, 'ordenados por y (de atrás hacia delante)');
  const coarser = scatterChunk(terrain, 0, 0, 'forest', 2);
  assert.ok(coarser.length < trees.length / 8 && coarser.length > 100, `lod 2: ${coarser.length}`);
  assert.ok(Math.min(...coarser.map((t) => t.r)) > Math.max(...trees.map((t) => t.r)) * 1.4, 'al alejar, las copas son más grandes');
  terrain.set(9000, 9000, TERRAIN_CODE.water); terrain.set(100000, 100000, TERRAIN_CODE.forest);
  assert.deepEqual(scatterChunk(terrain, 0, 0, 'forest', 0), trees, 'pintar lejos no mueve los árboles');
  assert.deepEqual(scatterChunk(terrain, 3, 3, 'forest', 0), [], 'sin bosque no hay árboles');
  assert.deepEqual(scatterChunk(terrain, 0, 0, 'mountain', 0), []);
});

test('trees stop at the forest edge and thin out with the density setting', () => {
  const terrain = new Terrain();
  paintStroke(terrain, [[0, 0]], 150, 'forest', { rugged: 0 });
  const trees = scatterChunk(terrain, 0, 0, 'forest', 0).concat(scatterChunk(terrain, -1, 0, 'forest', 0), scatterChunk(terrain, 0, -1, 'forest', 0), scatterChunk(terrain, -1, -1, 'forest', 0));
  assert.ok(trees.length > 800);
  for (const tree of trees) assert.ok(Math.hypot(tree.x, tree.y) <= 150 + 16, `árbol fuera del bosque (${tree.x}, ${tree.y})`);
  terrain.forest.density = 0.3;
  const thin = scatterChunk(terrain, 0, 0, 'forest', 0).length + scatterChunk(terrain, -1, 0, 'forest', 0).length + scatterChunk(terrain, 0, -1, 'forest', 0).length + scatterChunk(terrain, -1, -1, 'forest', 0).length;
  assert.ok(thin < trees.length * 0.45);
});

test('mountains are scattered as larger, sparser glyphs', () => {
  const terrain = new Terrain();
  paintStroke(terrain, [[256, 256]], 220, 'mountain', { rugged: 0 });
  const peaks = scatterChunk(terrain, 0, 0, 'mountain', 0);
  assert.ok(peaks.length > 20 && peaks.length < 200, `cumbres: ${peaks.length}`);
  assert.ok(peaks.every((peak) => peak.r >= 12 && peak.r <= 26), 'cada montaña mide decenas de metros');
});

test('the level of detail for trees rises as the zoom falls', () => {
  const terrain = new Terrain();
  assert.equal(lodFor(terrain, 2), 0); assert.equal(lodFor(terrain, 1), 0); assert.equal(lodFor(terrain, 0.5), 1); assert.ok(lodFor(terrain, 0.1) > lodFor(terrain, 0.5));
  assert.equal(lodFor(terrain, 0.0001), 6, 'tiene tope');
  let last = -1; for (const k of [4, 2, 1, 0.5, 0.2, 0.1, 0.05]) { const l = lodFor(terrain, k); assert.ok(l >= last); last = l; }
});

test('a map keeps its painted terrain: normalized, validated and counted in the map bounds', () => {
  const terrain = new Terrain(); paintStroke(terrain, [[0, 0]], 300, 'forest', { rugged: 0 }); paintStroke(terrain, [[900, 0]], 200, 'water', { rugged: 0 });
  const map = normalizeMap({ ...emptyMap('norte', 'N'), terrain: terrain.toData() });
  assert.deepEqual(map.terrain, terrain.toData(), 'lo guardado y lo normalizado coinciden');
  assert.deepEqual(normalizeMap(JSON.parse(JSON.stringify(map))).terrain, map.terrain, 'normalizar dos veces no cambia nada');
  assert.deepEqual(validateMap(map).errors, []);
  assert.equal(normalizeMap(emptyMap('a', 'A')).terrain, null, 'sin terreno no se guarda nada');
  const box = mapBounds(map); assert.ok(box.minX <= -300 && box.maxX >= 1100, JSON.stringify(box));
  assert.deepEqual(normalizeMap({ ...emptyMap('a', 'A'), terrain: { chunks: { 'x,y': '0*1024', '0,0': '2*1024', '1,0': '0*1024' } } }).terrain.chunks, { '0,0': '2*1024' }, 'claves raras y trozos vacíos se descartan');
});

test('validation: damaged chunks, absurd cells and forests, and oversize terrain are errors', () => {
  const check = (terrain) => validateMap(normalizeMap({ ...emptyMap('norte', 'N'), terrain })).errors.map((item) => item.code);
  assert.deepEqual(check({ chunks: { '0,0': '2*1024' } }), []);
  assert.deepEqual(check({ chunks: { '0,0': '2*500' } }), ['terrain_chunk'], 'un trozo dañado no se pierde en silencio: se avisa');
  assert.deepEqual(check({ cell: 2, chunks: {} }), ['terrain_cell']);
  assert.deepEqual(check({ cell: 100, chunks: {} }), ['terrain_cell']);
  assert.deepEqual(check({ forest: { spacing: 1, density: 0.5 }, chunks: {} }), ['terrain_forest']);
  assert.deepEqual(check({ forest: { spacing: 5, density: 2 }, chunks: {} }), ['terrain_forest']);
  const many = {}; for (let i = 0; i < 6001; i++) many[`${i},0`] = '2*1024';
  assert.deepEqual(check({ chunks: many }), ['terrain_limit']);
});

test('cache signatures: painting mid-chunk leaves the neighbors alone; painting near an edge, or at coarse zoom, reaches them', () => {
  const terrain = new Terrain();
  terrain.set(16, 16, 2); terrain.set(CHUNK + 16, 16, 2);
  const neighbor = (stride) => terrain.signature(1, 0, stride); const own = terrain.signature(0, 0, 1);
  const before = neighbor(1);
  terrain.set(17, 17, 2);
  assert.notEqual(terrain.signature(0, 0, 1), own, 'el trozo tocado sí cambia');
  assert.equal(neighbor(1), before, 'pintar en el centro no invalida al vecino');
  terrain.set(CHUNK - 1, 5, 2);
  assert.notEqual(neighbor(1), before, 'pintar junto al borde sí lo invalida');
  const coarse = neighbor(8); terrain.set(CHUNK - 12, 10, 3);
  assert.notEqual(neighbor(8), coarse, 'con paso grueso el contorno mira más lejos');
});
