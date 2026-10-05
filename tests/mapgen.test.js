import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFill, contextFor, corridorOf, mulberry32, GEN_LIMITS } from '../src/shared/mapGen.js';
import { pointInPolygon, distanceToPolyline, polygonArea, polygonSelfIntersects } from '../src/shared/geo.js';
import { FILL_DEFAULTS } from '../src/shared/mapDefaults.js';
import { emptyMap, normalizeMap } from '../src/shared/mapSchema.js';

const SQUARE = [[0, 0], [600, 0], [600, 600], [0, 600]];
const L_SHAPE = [[0, 0], [600, 0], [600, 200], [200, 200], [200, 600], [0, 600]];
const urban = (polygon, fill = {}, extra = {}) => ({ id: 'ciudad', kind: 'urban', polygon, z: 7, fill: { ...structuredClone(FILL_DEFAULTS.organic), ...fill }, ...extra });
const corners = (b) => {
  const a = (b.rot * Math.PI) / 180; const ux = Math.cos(a); const uy = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => [b.x + ux * (b.w / 2) * su - uy * (b.d / 2) * sv, b.y + uy * (b.w / 2) * su + ux * (b.d / 2) * sv]);
};
const rectOf = (b) => corners(b);

test('the seeded random generator is deterministic and uniform enough', () => {
  const a = mulberry32(42); const b = mulberry32(42); const c = mulberry32(43);
  const first = [a(), a(), a()];
  assert.deepEqual(first, [b(), b(), b()]);
  assert.notDeepEqual(first, [c(), c(), c()]);
  const rng = mulberry32(7); let sum = 0;
  for (let i = 0; i < 5000; i++) { const value = rng(); assert.ok(value >= 0 && value < 1); sum += value; }
  assert.ok(Math.abs(sum / 5000 - 0.5) < 0.03);
});

test('organic fill is deterministic: same area and seed, same city; another seed, another city', () => {
  const one = generateFill(urban(SQUARE), {});
  const two = generateFill(urban(SQUARE), {});
  assert.deepEqual(one, two);
  const other = generateFill(urban(SQUARE, { seed: 2 }), {});
  assert.notDeepEqual(other.buildings, one.buildings);
  assert.ok(one.buildings.length > 100, `casas: ${one.buildings.length}`);
});

test('organic blocks have realistic sizes and every house sits inside its area, with the recipe\'s dimensions', () => {
  const result = generateFill(urban(SQUARE), {});
  assert.ok(result.blocks.length >= 10 && result.blocks.length <= 80, `manzanas: ${result.blocks.length}`);
  const areas = result.blocks.map((block) => polygonArea(block)).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)];
  assert.ok(median > 2500 && median < 25000, `una manzana mediana ronda 60–140 m de lado (${Math.round(median)} m²)`);
  for (const block of result.blocks) assert.equal(polygonSelfIntersects(block), false);
  for (const building of result.buildings) {
    assert.ok(building.w >= 4 && building.w <= 16, `ancho ${building.w}`);
    assert.ok(building.d >= 8 && building.d <= 16, `fondo ${building.d}`);
    for (const [x, y] of corners(building)) assert.ok(pointInPolygon({ x, y }, SQUARE) || Math.abs(x) < 1 || Math.abs(y) < 1, 'dentro del área');
    assert.ok(building.tone >= 0 && building.tone <= 1);
  }
});

test('no two houses overlap', () => {
  const { buildings } = generateFill(urban(SQUARE), {});
  const shapes = buildings.map((b) => ({ b, c: corners(b) }));
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) {
    const a = shapes[i]; const b = shapes[j];
    if (Math.hypot(a.b.x - b.b.x, a.b.y - b.b.y) > 40) continue;
    for (const [x, y] of a.c) assert.equal(inside(x, y, b.c, 0.2), false, `${i} y ${j} se solapan`);
  }
});
// punto estrictamente dentro de un rectángulo (encogido `margin` m): se prueba con coordenadas locales
function inside(x, y, c, margin) {
  const ux = c[1][0] - c[0][0]; const uy = c[1][1] - c[0][1]; const vx = c[3][0] - c[0][0]; const vy = c[3][1] - c[0][1];
  const du = ((x - c[0][0]) * ux + (y - c[0][1]) * uy) / (ux * ux + uy * uy); const dv = ((x - c[0][0]) * vx + (y - c[0][1]) * vy) / (vx * vx + vy * vy);
  const mu = margin / Math.hypot(ux, uy); const mv = margin / Math.hypot(vx, vy);
  return du > mu && du < 1 - mu && dv > mv && dv < 1 - mv;
}

test('concave areas are filled too, and nothing spills out of the L', () => {
  const { buildings } = generateFill(urban(L_SHAPE), {});
  assert.ok(buildings.length > 50);
  for (const building of buildings) for (const [x, y] of corners(building)) assert.ok(pointInPolygon({ x, y }, L_SHAPE) || [x, y].some((v) => Math.abs(v) < 1) || Math.abs(y - 200) < 1 || Math.abs(x - 200) < 1, `(${x}, ${y}) fuera de la L`);
});

test('roads have priority: no house touches the roadway, and clearing it removes houses', () => {
  const street = { points: [[0, 300], [600, 300]], width: 12 };
  const free = generateFill(urban(SQUARE), {});
  const carved = generateFill(urban(SQUARE), { ways: [street] });
  assert.ok(carved.buildings.length < free.buildings.length);
  for (const building of carved.buildings) for (const [x, y] of corners(building)) assert.ok(distanceToPolyline({ x, y }, street.points) >= street.width / 2, `casa en la calzada (${x}, ${y})`);
  const diagonal = { points: [[0, 0], [600, 600]], width: 3 };   // un sendero estrecho también despeja lo que cruza
  for (const building of generateFill(urban(SQUARE), { ways: [diagonal] }).buildings) for (const [x, y] of corners(building)) assert.ok(distanceToPolyline({ x, y }, diagonal.points) >= 1.5);
});

test('places reserve their lot: a footprint or a bare point keeps houses away', () => {
  const place = { x: 300, y: 300, footprint: { width: 30, depth: 20, rotation: 0 } };
  const bare = { x: 100, y: 450, footprint: null };
  const { buildings } = generateFill(urban(SQUARE), { places: [place, bare] });
  for (const building of buildings) {
    for (const [x, y] of corners(building)) assert.equal(x > 285 && x < 315 && y > 290 && y < 310, false, 'casa sobre la huella');
    assert.ok(Math.hypot(building.x - bare.x, building.y - bare.y) > 2);
  }
});

test('water, plazas, parks and mountains are not built on; plain land around does not matter', () => {
  const lake = { id: 'lago', kind: 'water', polygon: [[200, 200], [400, 200], [400, 400], [200, 400]] };
  const land = { id: 'tierra', kind: 'land', polygon: [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]] };
  const { buildings } = generateFill(urban(SQUARE), { areas: [lake, land] });
  assert.ok(buildings.length > 50, 'la tierra de debajo no impide edificar');
  for (const building of buildings) for (const [x, y] of corners(building)) assert.equal(pointInPolygon({ x, y }, lake.polygon), false, 'casa en el lago');
  const free = generateFill(urban(SQUARE), {}).buildings.length;
  assert.ok(buildings.length < free);
});

test('density thins the town out, and zero means no houses', () => {
  const dense = generateFill(urban(SQUARE, { density: 1 }), {}).buildings.length;
  const sparse = generateFill(urban(SQUARE, { density: 0.3 }), {}).buildings.length;
  assert.ok(sparse < dense * 0.6, `${sparse} vs ${dense}`);
  assert.equal(generateFill(urban(SQUARE, { density: 0 }), {}).buildings.length, 0);
});

test('smaller houses give more houses; wider streets give fewer, bigger gaps', () => {
  const normal = generateFill(urban(SQUARE), {});
  const small = generateFill(urban(SQUARE, { lotSize: { width: 8, depth: 10 } }), {});
  assert.ok(small.buildings.length > normal.buildings.length * 1.4);
  const wide = generateFill(urban(SQUARE, { streetWidth: 30 }), {});
  assert.ok(wide.buildings.length < normal.buildings.length);
});

test('grid fill follows the rotation: houses line up with the rotated streets', () => {
  const rotation = 30;
  const { buildings, blocks } = generateFill(urban(SQUARE, { ...FILL_DEFAULTS.grid, rotation }), {});
  assert.ok(blocks.length > 20 && buildings.length > 100);
  const aligned = buildings.filter((b) => { const turn = (((b.rot - rotation) % 90) + 90) % 90; return Math.min(turn, 90 - turn) < 1; }).length;
  // las que bordean el límite del área (que no está girado) siguen ese límite, no la cuadrícula
  assert.ok(aligned / buildings.length > 0.85, `${aligned}/${buildings.length} alineadas`);
});

test('radial fill builds rings around the center and nothing beyond the last ring', () => {
  const area = urban([[-800, -800], [800, -800], [800, 800], [-800, 800]], { ...FILL_DEFAULTS.radial, rings: 3, spokes: 10, center: [0, 0] });
  const { buildings, blocks } = generateFill(area, {});
  assert.ok(blocks.length >= 20 && blocks.length <= 30, `manzanas: ${blocks.length}`);
  assert.ok(buildings.length > 50);
  const farthest = Math.max(...buildings.map((b) => Math.hypot(b.x, b.y)));
  assert.ok(farthest < 60 + 3 * 90 + 20, `más lejos: ${Math.round(farthest)} m`);
});

test('forest fill scatters trees with the requested spacing, keeps them off roads and water', () => {
  const forest = { id: 'bosque', kind: 'forest', polygon: SQUARE, fill: { pattern: 'forest', seed: 3, treeSpacing: 7, density: 0.7 } };
  const road = { points: [[0, 300], [600, 300]], width: 10 };
  const pond = { id: 'estanque', kind: 'water', polygon: [[100, 100], [200, 100], [200, 200], [100, 200]] };
  const { trees, buildings, blocks } = generateFill(forest, { ways: [road], areas: [pond] });
  assert.equal(buildings.length, 0); assert.equal(blocks.length, 0);
  assert.ok(trees.length > 3000 && trees.length < 12000, `árboles: ${trees.length}`);
  for (const tree of trees) {
    assert.ok(pointInPolygon({ x: tree.x, y: tree.y }, SQUARE));
    assert.ok(distanceToPolyline({ x: tree.x, y: tree.y }, road.points) >= 5, 'árbol en la calzada');
    assert.equal(pointInPolygon({ x: tree.x, y: tree.y }, pond.polygon), false, 'árbol en el agua');
    assert.ok(tree.r >= 3.4 && tree.r <= 6.4, `copa de ${tree.r} m`);
  }
  const sample = trees.slice(0, 300);
  for (let i = 0; i < sample.length; i++) for (let j = i + 1; j < sample.length; j++) assert.ok(Math.hypot(sample[i].x - sample[j].x, sample[i].y - sample[j].y) >= 6.9, 'árboles demasiado juntos');
  const sparse = generateFill({ ...forest, fill: { ...forest.fill, density: 0.2 } }, {}).trees.length;
  assert.ok(sparse < trees.length * 0.5);
  assert.deepEqual([...trees].sort((a, b) => a.y - b.y), trees, 'ordenados por y para pintar con solape');
  assert.deepEqual(generateFill(forest, { ways: [road], areas: [pond] }), { trees, buildings, blocks, truncated: false });
});

test('anything that cannot be filled yields an empty, harmless result', () => {
  const empty = { blocks: [], buildings: [], trees: [], truncated: false };
  assert.deepEqual(generateFill(urban(SQUARE, { pattern: 'none' }), {}), empty);
  assert.deepEqual(generateFill({ ...urban(SQUARE), fill: null }, {}), empty);
  assert.deepEqual(generateFill(urban([[0, 0], [100, 100], [100, 0], [0, 100]]), {}), empty, 'un polígono cruzado no se rellena');
  assert.deepEqual(generateFill(urban([[0, 0], [100, 0]]), {}), empty);
  assert.deepEqual(generateFill(urban([[0, 0], [NaN, 0], [100, 100]]), {}), empty);
  assert.deepEqual(generateFill(urban(SQUARE, { lotSize: { width: 0, depth: 10 } }), {}), empty);
  assert.deepEqual(generateFill(urban(SQUARE, { blockSize: { min: 100, max: 50 } }), {}), empty);
  assert.deepEqual(generateFill(undefined), empty);
  const tiny = generateFill(urban([[0, 0], [20, 0], [20, 20], [0, 20]]), {});
  assert.ok(tiny.buildings.length <= 4, 'un solar pequeño tiene pocas casas');
});

test('absurdly large recipes stop instead of freezing the editor', () => {
  const huge = { id: 'selva', kind: 'forest', polygon: [[0, 0], [30000, 0], [30000, 30000], [0, 30000]], fill: { pattern: 'forest', seed: 1, treeSpacing: 2, density: 1 } };
  const result = generateFill(huge, {});
  assert.equal(result.truncated, true);
  assert.deepEqual(result.trees, []);
  assert.ok(GEN_LIMITS.buildings > 1000);
});

test('contextFor only picks up what is near the area: roads, places and non-buildable areas', () => {
  const map = normalizeMap({
    ...emptyMap('norte', 'N'),
    areas: [{ id: 'ciudad', kind: 'urban', polygon: SQUARE }, { id: 'lago', kind: 'water', polygon: [[100, 100], [200, 100], [200, 200]] }, { id: 'lejos', kind: 'water', polygon: [[5000, 5000], [5100, 5000], [5100, 5100]] }, { id: 'campo', kind: 'land', polygon: SQUARE }],
    ways: [{ id: 'calle', kind: 'street', points: [[0, 300], [600, 300]] }, { id: 'rio_lejano', kind: 'river', points: [[9000, 0], [9500, 0]] }],
    places: [{ id: 'cerca', name: 'Cerca', x: 300, y: 300, kind: 'poi' }, { id: 'lejos_p', name: 'Lejos', x: 9000, y: 9000, kind: 'poi' }]
  });
  const ctx = contextFor(map.areas[0], map);
  assert.deepEqual(ctx.ways.map((way) => way.width), [10]);
  assert.deepEqual(ctx.places.map((place) => place.x), [300]);
  assert.deepEqual(ctx.areas.map((area) => area.id), ['lago']);
  assert.deepEqual(contextFor(map.areas[0], map), ctx, 'el contexto es estable (sirve para saber cuándo regenerar)');
  const moved = structuredClone(map); moved.ways[0].points[0] = [0, 310];
  assert.notDeepEqual(contextFor(moved.areas[0], moved), ctx);
});

test('generating a mid-size city is fast enough for live preview', () => {
  const started = Date.now();
  const city = generateFill(urban([[0, 0], [2500, 0], [2500, 2000], [0, 2000]]), {});
  const ms = Date.now() - started;
  assert.ok(city.buildings.length > 3000, `casas: ${city.buildings.length}`);
  assert.ok(ms < 6000, `5 km² tardó ${ms} ms`);
});

test('a road is a knife: it cuts the blocks along its edge and the new lots face it', () => {
  const diagonal = { points: [[0, 0], [600, 600]], width: 12 };
  const { blocks, buildings } = generateFill(urban(SQUARE), { ways: [diagonal] });
  for (const block of blocks) for (const [x, y] of block) assert.ok(distanceToPolyline({ x, y }, diagonal.points) >= diagonal.width / 2 - 0.2, `una manzana invade la calzada en (${x}, ${y})`);
  // las casas junto al camino se alinean con él (a 45°, o a 225°) en vez de seguir las calles del relleno
  const near = buildings.filter((b) => distanceToPolyline({ x: b.x, y: b.y }, diagonal.points) < 18 && b.x > 40 && b.x < 560);
  const facing = near.filter((b) => { const turn = (((b.rot - 45) % 180) + 180) % 180; return Math.min(turn, 180 - turn) < 3; });
  assert.ok(near.length > 20, `casas junto al camino: ${near.length}`);
  assert.ok(facing.length / near.length > 0.45, `${facing.length}/${near.length} miran al camino`);
});

test('a dead-end street leaves a notch (cul-de-sac), and the houses around it still keep off the roadway', () => {
  const dead = { points: [[0, 300], [320, 300]], width: 10 };
  const { blocks, buildings } = generateFill(urban(SQUARE), { ways: [dead] });
  for (const building of buildings) for (const [x, y] of corners(building)) assert.ok(distanceToPolyline({ x, y }, dead.points) >= 5);
  assert.ok(blocks.length > 5);
  for (const block of blocks) assert.equal(polygonSelfIntersects(block), false);
});

test('the roadway of several roads is one merged shape: area about length × width, joins and ends rounded', () => {
  assert.equal(corridorOf([]), null);
  const corridor = corridorOf([{ points: [[0, 0], [400, 0]], width: 10 }]);
  const area = corridor.reduce((sum, polygon) => sum + polygonArea(polygon[0]), 0);
  assert.ok(Math.abs(area - (400 * 10 + Math.PI * 25)) < 40, `área ${Math.round(area)}`);
  const cross = corridorOf([{ points: [[0, 0], [400, 0]], width: 10 }, { points: [[200, -200], [200, 200]], width: 10 }]);
  assert.equal(cross.length, 1, 'dos caminos que se cruzan forman una sola calzada');
  const bend = corridorOf([{ points: [[0, 0], [200, 0], [200, 200]], width: 10 }]);
  assert.equal(bend.length, 1, 'una curva no deja huecos');
  assert.equal(corridorOf([{ points: [[0, 0], [0, 0]], width: 10 }]).length, 1);
});
