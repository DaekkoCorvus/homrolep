import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { distance, minutesFor, WALK_METERS_PER_MIN, TAXI_METERS_PER_MIN, pointInPolygon, polygonArea, polygonSelfIntersects, polygonsOverlap, districtAt, slugify, uniqueId, ID_PATTERN, polylineLength, distanceToSegment, distanceToPolyline, boundsOf, mergeBounds, growBounds } from '../src/shared/geo.js';
import { emptyMap, normalizeMap, validateMap, migrateV1, mapBounds, lockedBy, groupChain, placeDistance, MIN_PLACE_GAP, SCHEMA_VERSION } from '../src/shared/mapSchema.js';
import { AREA_KINDS, WAY_KINDS, FILL_DEFAULTS, AREA_Z, WAY_Z, WAY_WIDTH, WAY_WIDTH_RANGE, AREA_COLOR, WAY_COLOR, AREA_LABEL, WAY_LABEL } from '../src/shared/mapDefaults.js';
import { createMapStore, imageSize } from '../src/server/game/maps.js';
import { createAppServer } from '../src/server/index.js';
import { fixtureGeography } from './support/world.js';

// Un cuadrado de 400 m de lado con la esquina en (100, 100) y una L de 600 × 600 m.
const SQUARE = [[100, 100], [500, 100], [500, 500], [100, 500]];
const L_SHAPE = [[0, 0], [600, 0], [600, 200], [200, 200], [200, 600], [0, 600]];
const codes = (issues) => issues.map((item) => item.code).sort();

function sampleMap(extra = {}) {
  return {
    ...emptyMap('norte', 'Mapa del norte'),
    districts: [
      { id: 'centro', name: 'Centro', color: '#aa3333', polygon: [[0, 0], [1500, 0], [1500, 1500], [0, 1500]], fog: 'known', allowPlayerPlaces: true },
      { id: 'barrio_oeste', name: 'Barrio Oeste', polygon: [[1600, 0], [2800, 0], [2800, 1500], [1600, 1500]], fog: 'hidden' }
    ],
    places: [
      { id: 'luna_cafe', name: "Luna's Coffee", kind: 'food', x: 700, y: 700, access: 'public', hours: { open: 6, close: 22 }, discovery: 'known', owner: 'luna_serp' },
      { id: 'luna_home', name: 'Casa de Luna', kind: 'home', x: 2200, y: 900, access: 'private', discovery: 'hidden', requires: [{ type: 'escort', npcId: 'luna_serp' }] }
    ],
    ...extra
  };
}
const check = (map, context) => validateMap(normalizeMap(map), { npcIds: new Set(['luna_serp']), ...context });
const only = (key, items, context) => check({ ...emptyMap('norte', 'Mapa'), [key]: items }, context);

// --- Geometría (metros) ---------------------------------------------------------------------------------------------------------------------------
test('distances are plain meters on the world plane and times follow from the speeds', () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 300, y: 400 }), 500);
  assert.equal(placeDistance({ x: 0, y: 0 }, { x: 3000, y: 4000 }), 5000, 'ya no hay escala que calibrar: 1 unidad = 1 metro');
  assert.equal(minutesFor(800, WALK_METERS_PER_MIN), 10);
  assert.ok(minutesFor(8000, TAXI_METERS_PER_MIN) < minutesFor(8000, WALK_METERS_PER_MIN), 'el taxi es más rápido que caminar');
});

test('lines and boxes: length, distance to a road, bounds', () => {
  assert.equal(polylineLength([[0, 0], [300, 0], [300, 400]]), 700);
  assert.equal(distanceToSegment({ x: 150, y: 80 }, [0, 0], [300, 0]), 80);
  assert.equal(distanceToSegment({ x: -30, y: 40 }, [0, 0], [300, 0]), 50, 'más allá del extremo cuenta la distancia al extremo');
  assert.equal(distanceToPolyline({ x: 310, y: 200 }, [[0, 0], [300, 0], [300, 400]]), 10);
  assert.equal(distanceToPolyline({ x: 3, y: 4 }, [[0, 0]]), 5);
  assert.deepEqual(boundsOf([[10, 20], [-5, 60], [30, 0]]), { minX: -5, minY: 0, maxX: 30, maxY: 60 });
  assert.equal(boundsOf([]), null);
  assert.deepEqual(mergeBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: -5, minY: 3, maxX: 4, maxY: 20 }), { minX: -5, minY: 0, maxX: 10, maxY: 20 });
  assert.deepEqual(mergeBounds(null, { minX: 1, minY: 1, maxX: 2, maxY: 2 }), { minX: 1, minY: 1, maxX: 2, maxY: 2 });
  assert.deepEqual(growBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 5), { minX: -5, minY: -5, maxX: 15, maxY: 15 });
  assert.equal(growBounds(null, 5), null);
});

test('point-in-polygon handles edges, concave shapes and outside points', () => {
  assert.equal(pointInPolygon({ x: 300, y: 300 }, SQUARE), true);
  assert.equal(pointInPolygon({ x: 700, y: 300 }, SQUARE), false);
  assert.equal(pointInPolygon({ x: 100, y: 300 }, SQUARE), true, 'el borde cuenta como dentro');
  assert.equal(pointInPolygon({ x: 500, y: 500 }, SQUARE), true, 'un vértice también');
  assert.equal(pointInPolygon({ x: 100, y: 100 }, L_SHAPE), true);
  assert.equal(pointInPolygon({ x: 400, y: 400 }, L_SHAPE), false, 'el hueco de una L está fuera');
  assert.equal(pointInPolygon({ x: 100, y: 500 }, L_SHAPE), true);
});

test('polygons: area, crossings, overlaps and the most specific district win', () => {
  assert.equal(polygonArea(SQUARE), 160000);
  assert.equal(polygonSelfIntersects(SQUARE), false);
  assert.equal(polygonSelfIntersects(L_SHAPE), false);
  assert.equal(polygonSelfIntersects([[0, 0], [100, 100], [100, 0], [0, 100]]), true, 'un lazo se cruza');
  assert.equal(polygonsOverlap(SQUARE, [[400, 400], [900, 400], [900, 900], [400, 900]]), true);
  assert.equal(polygonsOverlap(SQUARE, [[600, 100], [900, 100], [900, 500], [600, 500]]), false);
  assert.equal(polygonsOverlap(SQUARE, [[500, 100], [900, 100], [900, 500], [500, 500]]), false, 'compartir un borde no es solaparse');
  assert.equal(polygonsOverlap(SQUARE, SQUARE), true, 'dos polígonos iguales sí se solapan');
  assert.equal(polygonsOverlap(SQUARE, [[200, 200], [400, 200], [400, 400], [200, 400]]), true, 'uno dentro del otro');
  const districts = [{ id: 'grande', polygon: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]] }, { id: 'chico', polygon: SQUARE }];
  assert.equal(districtAt({ x: 300, y: 300 }, districts).id, 'chico');
  assert.equal(districtAt({ x: 1500, y: 1500 }, districts).id, 'grande');
  assert.equal(districtAt({ x: 1500, y: 1500 }, [districts[1]]), null);
});

test('ids come from names without accents or symbols, never collide and always match the pattern', () => {
  assert.equal(slugify("Luna's Coffee"), 'lunas_coffee');
  assert.equal(slugify('Distrito del Río'), 'distrito_del_rio');
  assert.equal(slugify('  Fortaleza   Norte!! '), 'fortaleza_norte');
  assert.equal(slugify('221B Baker St'), 'p_221b_baker_st');
  assert.equal(slugify('???'), 'lugar');
  assert.equal(uniqueId('cafe', new Set(['cafe', 'cafe_2'])), 'cafe_3');
  assert.equal(uniqueId('cafe', new Set()), 'cafe');
  for (const name of ["Luna's Coffee", 'Ñandú', '9 lunas', 'A'.repeat(100)]) assert.match(slugify(name), ID_PATTERN);
});

test('the defaults cover every kind, with sensible draw order, colors, widths and ranges', () => {
  for (const kind of AREA_KINDS) assert.ok(AREA_Z[kind] !== undefined && AREA_COLOR[kind] && AREA_LABEL[kind], `área ${kind}`);
  for (const kind of WAY_KINDS) {
    assert.ok(WAY_Z[kind] !== undefined && WAY_COLOR[kind] && WAY_LABEL[kind] && WAY_WIDTH[kind] > 0, `camino ${kind}`);
    const [low, high] = WAY_WIDTH_RANGE[kind];
    assert.ok(WAY_WIDTH[kind] >= low && WAY_WIDTH[kind] <= high, `la anchura por defecto de ${kind} está en su rango`);
  }
  assert.ok(AREA_Z.water < AREA_Z.land && AREA_Z.land < AREA_Z.urban, 'el agua queda bajo la tierra y la ciudad encima');
  assert.ok(WAY_Z.street < WAY_Z.avenue && AREA_Z.urban < WAY_Z.street, 'las calles se dibujan sobre las zonas urbanas');
  assert.ok(FILL_DEFAULTS.organic.blockSize.min >= 60 && FILL_DEFAULTS.organic.blockSize.max <= 140, 'una manzana ronda los 60–140 m');
  assert.ok(FILL_DEFAULTS.organic.lotSize.width >= 8 && FILL_DEFAULTS.organic.lotSize.width <= 15, 'una casa ronda los 8–15 m');
});

// --- Esquema v2 ----------------------------------------------------------------------------------------------------------------------------------
test('normalizing gives a stable shape, rounds to 0.1 m and derives the district from the polygons', () => {
  const map = normalizeMap({ id: ' norte ', name: '  Mapa   del norte ', extra: 'x',
    districts: [{ id: 'centro', name: 'Centro', polygon: [[0, 0], [1500, 0], [1500, 1500], [0, 1500]], color: '#AA3333' }],
    places: [{ id: 'aa', name: 'A', x: 123.456789, y: 300, kind: 'poi', district: 'inventado', junk: 1 }, { id: 'bb', name: 'B', x: 9000, y: 9000 }] });
  assert.deepEqual(Object.keys(map), ['schemaVersion', 'id', 'name', 'units', 'style', 'underlays', 'areas', 'ways', 'districts', 'places', 'links', 'groups', 'terrain', 'publish']);
  assert.equal(map.schemaVersion, SCHEMA_VERSION); assert.equal(map.units, 'm');
  assert.equal(map.id, 'norte'); assert.equal(map.name, 'Mapa del norte');
  assert.equal(map.places[0].x, 123.5);
  assert.equal(map.places[0].district, 'centro', 'el distrito lo calcula el motor, no se acepta lo que diga el editor');
  assert.equal(map.places[1].district, null);
  assert.equal(map.districts[0].color, '#aa3333');
  assert.equal(map.places[0].junk, undefined);
  assert.deepEqual(normalizeMap(JSON.parse(JSON.stringify(map))), map, 'normalizar dos veces no cambia nada');
  assert.deepEqual(normalizeMap({}).underlays, [], 'una capa de calco es opcional: el lienzo no necesita imagen');
});

test('a map written with the old image-based schema (v1) is converted to meters without moving anything', () => {
  const v1 = { schemaVersion: 1, id: 'viejo', name: 'Mapa viejo', image: { file: 'viejo.webp', width: 2000, height: 3000 }, scale: { metersPerPixel: 2.5 },
    districts: [{ id: 'centro', name: 'Centro', fog: 'known', polygon: [[0.1, 0.1], [0.6, 0.1], [0.6, 0.6], [0.1, 0.6]] }],
    places: [{ id: 'luna_cafe', name: 'Café', kind: 'food', x: 0.3, y: 0.3 }] };
  const map = normalizeMap(v1);
  assert.equal(map.schemaVersion, 2);
  assert.deepEqual(map.underlays, [{ id: 'base', file: 'viejo.webp', width: 2000, height: 3000, x: 0, y: 0, metersPerPixel: 2.5, opacity: 1, visible: true }], 'la imagen pasa a ser una capa de calco en el origen');
  assert.deepEqual(map.places[0].x, 0.3 * 2000 * 2.5);
  assert.equal(map.places[0].y, 0.3 * 3000 * 2.5);
  assert.deepEqual(map.districts[0].polygon[2], [0.6 * 2000 * 2.5, 0.6 * 3000 * 2.5]);
  assert.equal(map.places[0].district, 'centro', 'el lugar sigue dentro del mismo distrito');
  assert.equal(migrateV1({ ...v1, scale: { metersPerPixel: null } }).underlays[0].metersPerPixel, 2, 'sin escala calibrada se asumen 2 m por píxel');
  assert.equal(migrateV1({ schemaVersion: 1, id: 'x', name: 'x' }).underlays.length, 0);
});

test('areas, ways, groups and fills fill in sensible defaults when only the kind is given', () => {
  const map = normalizeMap({ id: 'norte', name: 'N',
    areas: [{ id: 'lago', kind: 'water', polygon: SQUARE }, { id: 'ciudad', kind: 'urban', polygon: SQUARE, fill: { pattern: 'organic' } }, { id: 'selva', kind: 'forest', polygon: SQUARE, fill: { pattern: 'forest', seed: '42' } }],
    ways: [{ id: 'rio', kind: 'river', points: [[0, 0], [500, 0]] }, { id: 'calle', kind: 'street', points: [[0, 0], [500, 0]], width: 11.26 }] });
  assert.equal(map.areas[0].z, AREA_Z.water); assert.equal(map.areas[0].fill, null);
  assert.deepEqual(map.areas[1].fill, { pattern: 'organic', seed: 1, blockSize: { min: 60, max: 140 }, lotSize: { width: 12, depth: 16 }, density: 0.75, streetWidth: 9, rotation: 0 });
  assert.deepEqual(map.areas[2].fill, { pattern: 'forest', seed: 42, treeSpacing: 4.5, density: 0.9 });
  assert.equal(map.ways[0].width, WAY_WIDTH.river); assert.equal(map.ways[0].z, WAY_Z.river);
  assert.equal(map.ways[1].width, 11.3);
  assert.deepEqual(normalizeMap({ id: 'a', name: 'a', areas: [{ id: 'x', polygon: SQUARE, fill: { pattern: 'radial' } }] }).areas[0].fill.center, [0, 0]);
  assert.deepEqual(normalizeMap({ id: 'a', name: 'a', areas: [{ id: 'x', polygon: SQUARE, fill: { pattern: 'raro' } }] }).areas[0].fill, { pattern: 'none' }, 'una receta desconocida no rellena nada');
});

test('a sound map validates; every rule reports a precise, actionable issue', () => {
  const good = check(sampleMap());
  assert.deepEqual(good.errors, []);
  assert.equal(good.ok, true);
  assert.deepEqual(codes(good.warnings), [], 'un mapa sin capa de calco y sin escala es perfectamente válido');
  assert.equal(check(sampleMap({ id: 'Norte!' })).errors[0].code, 'map_id');

  const place = (extra) => sampleMap({ places: [{ id: 'sitio', name: 'Sitio', kind: 'poi', x: 700, y: 700, ...extra }] });
  assert.ok(codes(check(place({ id: 'Sitio Raro' })).errors).includes('place_id'));
  assert.ok(codes(check(place({ kind: 'castillo' })).errors).includes('place_kind'));
  assert.ok(codes(check(place({ access: 'secreto' })).errors).includes('place_access'));
  assert.ok(codes(check(place({ discovery: 'visto' })).errors).includes('place_discovery'));
  assert.ok(codes(check(place({ x: 'no' })).errors).includes('place_position'));
  assert.ok(codes(check(place({ x: 5_000_000 })).errors).includes('place_position'), 'más de 1000 km del origen no es un lugar');
  assert.ok(codes(check(place({ name: '' })).errors).includes('place_name'));
  assert.ok(codes(check(place({ hours: { open: 22, close: 6 } })).errors).includes('place_hours'));
  assert.equal(codes(check(place({ hours: { open: 8, close: 24 } })).errors).length, 0, '24 es una hora de cierre válida');
  assert.ok(codes(check(place({ footprint: { width: 0, depth: 10, rotation: 0 } })).errors).includes('place_footprint'));
  assert.deepEqual(check(place({ footprint: { width: 12, depth: 16, rotation: 30 } })).errors, []);
  assert.deepEqual(codes(check(place({ x: 9000, y: 9000 })).warnings), ['place_outside'], 'fuera de todo distrito es un aviso');
  assert.deepEqual(codes(check(place({ owner: 'nadie' })).warnings), ['place_owner']);
  assert.deepEqual(codes(check(sampleMap({ places: [{ id: 'aa', name: 'A', kind: 'poi', x: 700, y: 700 }, { id: 'bb', name: 'B', kind: 'poi', x: 700 + MIN_PLACE_GAP / 2, y: 700 }] })).warnings), ['places_overlap']);
  const duplicated = check(sampleMap({ places: [{ id: 'aa', name: 'A', kind: 'poi', x: 700, y: 700 }, { id: 'aa', name: 'A2', kind: 'poi', x: 900, y: 900 }] }));
  assert.ok(codes(duplicated.errors).includes('place_duplicate'));
  assert.ok(codes(check(sampleMap(), { takenIds: new Set(['luna_cafe']) }).errors).includes('id_taken'), 'los ids son únicos en todo el juego, no solo por mapa');
});

test('districts and areas: valid polygons only, in square meters; crossings, tiny shapes and overlaps are reported', () => {
  const district = (extra) => only('districts', [{ id: 'zona', name: 'Zona', fog: 'known', polygon: SQUARE, ...extra }]);
  assert.deepEqual(district({}).errors, []);
  assert.ok(codes(district({ polygon: [[0, 0], [10, 10]] }).errors).includes('polygon_few'));
  assert.ok(codes(district({ polygon: [[0, 0], [9_000_000, 0], [10, 10]] }).errors).includes('polygon_range'));
  assert.ok(codes(district({ polygon: [[0, 0], [10, 0], [0, 10]] }).errors).includes('polygon_tiny'), '50 m² no es un distrito');
  assert.ok(codes(district({ polygon: [[100, 100], [500, 500], [500, 100], [100, 500]] }).errors).includes('polygon_crossed'));
  assert.ok(codes(district({ fog: 'niebla' }).errors).includes('district_fog'));
  assert.ok(codes(district({ id: 'Zona 1' }).errors).includes('district_id'));
  const overlapping = only('districts', [{ id: 'aa', name: 'A', fog: 'known', polygon: SQUARE }, { id: 'bb', name: 'B', fog: 'known', polygon: [[300, 300], [800, 300], [800, 800], [300, 800]] }]);
  assert.deepEqual(codes(overlapping.warnings), ['districts_overlap']);

  const area = (extra) => only('areas', [{ id: 'lago', kind: 'water', polygon: SQUARE, ...extra }]);
  assert.deepEqual(area({}).errors, []);
  assert.ok(codes(area({ kind: 'lava' }).errors).includes('area_kind'));
  assert.ok(codes(area({ polygon: [[0, 0], [4, 0], [0, 4]] }).errors).includes('polygon_tiny'), 'menos de 25 m² es un punto');
  assert.ok(codes(area({ polygon: [[100, 100], [500, 500], [500, 100], [100, 500]] }).errors).includes('polygon_crossed'));
  assert.ok(codes(area({ id: 'Lago Azul' }).errors).includes('area_id'));
  assert.deepEqual(codes(only('areas', [{ id: 'aa', kind: 'water', polygon: SQUARE }, { id: 'aa', kind: 'land', polygon: SQUARE }]).errors), ['area_duplicate'], 'las áreas se superponen a propósito (orden de dibujo): no es un aviso');
});

test('fill recipes are checked: values must make sense, and unusual (but possible) sizes only warn', () => {
  const fill = (recipe, kind = 'urban') => only('areas', [{ id: 'ciudad', kind, polygon: SQUARE, fill: recipe }]);
  assert.deepEqual(fill({ pattern: 'organic' }).errors, []);
  assert.deepEqual(fill({ pattern: 'organic' }).warnings, [], 'los valores por defecto son realistas: manzanas de 60–140 m, parcelas de 12×16 m');
  assert.deepEqual(fill({ pattern: 'none' }).errors, []);
  assert.ok(codes(fill({ pattern: 'organic', seed: -1 }).errors).includes('fill_seed'));
  assert.ok(codes(fill({ pattern: 'organic', seed: 99_999_999_999 }).errors).includes('fill_seed'));
  assert.equal(normalizeMap({ id: 'a', name: 'a', areas: [{ id: 'x', polygon: SQUARE, fill: { pattern: 'organic', seed: 7.4 } }] }).areas[0].fill.seed, 7, 'la semilla siempre es entera');
  assert.ok(codes(fill({ pattern: 'organic', density: 1.4 }).errors).includes('fill_density'));
  assert.ok(codes(fill({ pattern: 'organic', blockSize: { min: 100, max: 50 } }).errors).includes('fill_value'));
  assert.ok(codes(fill({ pattern: 'organic', lotSize: { width: 0, depth: 10 } }).errors).includes('fill_value'));
  assert.ok(codes(fill({ pattern: 'organic', streetWidth: 0 }).errors).includes('fill_value'));
  assert.deepEqual(codes(fill({ pattern: 'organic', blockSize: { min: 10, max: 120 } }).warnings), ['fill_range'], 'manzanas de 10 m son raras pero posibles');
  assert.deepEqual(codes(fill({ pattern: 'organic', lotSize: { width: 80, depth: 16 } }).warnings), ['fill_range']);
  assert.deepEqual(codes(fill({ pattern: 'organic', streetWidth: 60 }).warnings), ['fill_range']);
  assert.deepEqual(codes(fill({ pattern: 'organic' }, 'water').warnings), ['fill_kind'], 'rellenar el agua de casas es raro');
  assert.ok(codes(fill({ pattern: 'radial', rings: 0 }).errors).includes('fill_value'));
  assert.ok(codes(fill({ pattern: 'radial', spokes: 2 }).errors).includes('fill_value'));
  assert.deepEqual(fill({ pattern: 'radial', rings: 5, spokes: 16, center: [300, 300] }).errors, []);
  assert.deepEqual(fill({ pattern: 'forest' }, 'forest').errors, []);
  assert.ok(codes(fill({ pattern: 'forest', treeSpacing: 0 }, 'forest').errors).includes('fill_value'));
  assert.deepEqual(codes(fill({ pattern: 'forest' }, 'urban').warnings), ['fill_kind']);
});

test('ways: kind, points and width are validated; unusual widths only warn', () => {
  const way = (extra) => only('ways', [{ id: 'calle_a', kind: 'street', points: [[0, 0], [300, 0]], ...extra }]);
  assert.deepEqual(way({}).errors, []);
  assert.deepEqual(way({}).warnings, []);
  assert.ok(codes(way({ kind: 'teleferico' }).errors).includes('way_kind'));
  assert.ok(codes(way({ points: [[0, 0]] }).errors).includes('way_few'));
  assert.ok(codes(way({ points: [[0, 0], [0.4, 0]] }).errors).includes('way_short'));
  assert.ok(codes(way({ points: [[0, 0], [9_000_000, 0]] }).errors).includes('way_range'));
  assert.ok(codes(way({ width: 0 }).errors).includes('way_width'));
  assert.deepEqual(codes(way({ width: 80 }).warnings), ['way_width_range'], 'una calle de 80 m es una avenida enorme, pero se permite');
  assert.deepEqual(codes(way({ kind: 'river', width: 5 }).warnings), ['way_width_range']);
  assert.deepEqual(codes(way({ kind: 'river', width: undefined }).warnings), [], 'sin anchura se usa la típica de su tipo');
});

test('groups: parents must exist, cycles are rejected, members must point to real groups, and locks cascade down the tree', () => {
  const grouped = (groups, group = null) => check({ ...emptyMap('norte', 'N'), groups, areas: [{ id: 'barrio', kind: 'urban', polygon: SQUARE, group }] });
  assert.deepEqual(codes(grouped([{ id: 'ciudad', name: 'Ciudad' }], 'ciudad').warnings), []);
  assert.deepEqual(codes(grouped([{ id: 'ciudad', name: 'Ciudad' }], 'fantasma').errors), ['group_missing']);
  assert.deepEqual(codes(grouped([{ id: 'facc', name: 'Facción', parent: 'nada' }], null).errors), ['group_parent']);
  assert.ok(codes(grouped([{ id: 'aa', name: 'A', parent: 'bb' }, { id: 'bb', name: 'B', parent: 'aa' }], 'aa').errors).includes('group_cycle'));
  assert.deepEqual(codes(grouped([{ id: 'vacio', name: 'Vacío' }], null).warnings), ['group_empty']);
  assert.deepEqual(codes(grouped([{ id: 'pais', name: 'País' }, { id: 'ciudad', name: 'Ciudad', parent: 'pais' }], 'ciudad').warnings), [], 'un grupo con subgrupos no está vacío');
  assert.ok(codes(grouped([{ id: 'ciudad', name: 'Ciudad', baked: '../secreto.txt' }], 'ciudad').errors).includes('group_baked'));
  assert.deepEqual(grouped([{ id: 'ciudad', name: 'Ciudad', baked: 'norte_ciudad.json' }], 'ciudad').errors, []);

  const map = normalizeMap({ id: 'norte', name: 'N', groups: [{ id: 'pais', name: 'País', locked: true }, { id: 'ciudad', name: 'Ciudad', parent: 'pais' }, { id: 'libre', name: 'Libre' }],
    areas: [{ id: 'a1', kind: 'urban', polygon: SQUARE, group: 'ciudad' }, { id: 'a2', kind: 'urban', polygon: SQUARE, group: 'libre' }, { id: 'a3', kind: 'urban', polygon: SQUARE }] });
  assert.deepEqual(groupChain(map, 'ciudad').map((group) => group.id), ['ciudad', 'pais']);
  assert.equal(lockedBy(map, map.areas[0]).id, 'pais', 'bloquear el grupo de arriba bloquea todo lo que contiene');
  assert.equal(lockedBy(map, map.areas[1]), null);
  assert.equal(lockedBy(map, map.areas[2]), null, 'lo que no está en ningún grupo no está bloqueado');
  const cyclic = { groups: [{ id: 'aa', parent: 'bb', locked: false }, { id: 'bb', parent: 'aa', locked: false }] };
  assert.equal(groupChain(cyclic, 'aa').length, 2, 'un ciclo no cuelga el programa');
});

test('underlays are optional tracing layers that must carry an image, a size and a scale; publish metadata is checked', () => {
  const underlay = (extra) => check({ ...emptyMap('norte', 'N'), underlays: [{ id: 'base', file: 'norte_base.webp', width: 2000, height: 3000, x: 0, y: 0, metersPerPixel: 2.5, opacity: 0.5, visible: true, ...extra }] });
  assert.deepEqual(underlay({}).errors, []);
  assert.ok(codes(underlay({ file: '' }).errors).includes('underlay_file'));
  assert.ok(codes(underlay({ file: '../x.png' }).errors).includes('underlay_file'));
  assert.ok(codes(underlay({ width: 0 }).errors).includes('underlay_size'));
  assert.ok(codes(underlay({ metersPerPixel: 0 }).errors).includes('underlay_scale'));
  assert.ok(codes(underlay({ opacity: 2 }).errors).includes('underlay_opacity'));
  assert.ok(codes(underlay({ id: 'Capa 1' }).errors).includes('underlay_id'));
  const published = (extra) => check({ ...emptyMap('norte', 'N'), publish: { version: 1, builtAt: '2026-10-04T10:00:00Z', sourceHash: 'abc', format: 'webp', tileSize: 512, minZoom: 0, maxZoom: 5, bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, ...extra } });
  assert.deepEqual(published({}).errors, []);
  assert.ok(codes(published({ maxZoom: -1 }).errors).includes('publish_invalid'));
  assert.ok(codes(published({ tileSize: 5 }).errors).includes('publish_invalid'));
  assert.ok(codes(published({ format: 'bmp' }).errors).includes('publish_invalid'));
});

test('the map bounds cover areas, roads (with their width), districts, places and tracing layers; an empty map has none', () => {
  assert.equal(mapBounds(normalizeMap({ id: 'norte', name: 'N' })), null);
  const map = normalizeMap({ id: 'norte', name: 'N', areas: [{ id: 'a', kind: 'land', polygon: [[0, 0], [1000, 0], [1000, 800]] }],
    ways: [{ id: 'r', kind: 'avenue', points: [[-500, 100], [200, 100]], width: 20 }], places: [{ id: 'aa', name: 'A', x: 1500, y: -200, kind: 'poi' }],
    underlays: [{ id: 'base', file: 'a.webp', width: 100, height: 100, x: 2000, y: 2000, metersPerPixel: 10 }] });
  assert.deepEqual(mapBounds(map), { minX: -510, minY: -200, maxX: 3000, maxY: 3000 });
});

test('links, requirements and references from NPC cards are checked against what really exists', () => {
  const links = (list) => sampleMap({ links: list });
  const metro = { id: 'metro_capital', name: 'Metro', mode: 'metro', from: 'luna_cafe', to: 'luna_home', minutes: 25, cost: 3 };
  assert.deepEqual(check(links([metro])).errors, []);
  assert.ok(codes(check(links([{ ...metro, to: 'fantasma' }])).errors).includes('link_endpoint'));
  assert.deepEqual(codes(check(links([{ ...metro, to: 'otro_mapa_lugar' }]), { takenIds: new Set(['otro_mapa_lugar']) }).errors), [], 'un enlace puede unir con un lugar de otro mapa');
  assert.ok(codes(check(links([{ ...metro, minutes: 0 }])).errors).includes('link_minutes'));
  assert.ok(codes(check(links([{ ...metro, mode: 'teletransporte' }])).errors).includes('link_mode'));
  assert.ok(codes(check(links([{ ...metro, id: 'luna_cafe' }])).errors).includes('link_duplicate'), 'un enlace no puede llamarse como un lugar');
  assert.ok(codes(check(links([{ ...metro, requires: [{ type: 'money', amount: 0 }] }])).errors).includes('requirement_money'));
  assert.ok(codes(check(links([{ ...metro, requires: [{ type: 'volar' }] }])).errors).includes('requirement_type'));
  const need = (requires) => sampleMap({ places: [{ id: 'aa', name: 'A', kind: 'poi', x: 700, y: 700, requires }] });
  assert.ok(codes(check(need([{ type: 'escort' }])).errors).includes('requirement_escort'));
  assert.ok(codes(check(need([{ type: 'knows_place', place: 'nada' }])).errors).includes('requirement_place'));
  assert.deepEqual(codes(check(need([{ type: 'escort', npcId: 'otro' }])).warnings), ['requirement_npc']);
  assert.deepEqual(check(need([{ type: 'escort', npcId: 'luna_serp' }, { type: 'story_flag', flag: 'dia_3' }])).errors, []);

  const refs = [{ npcId: 'luna_serp', placeId: 'luna_cafe', where: 'Luna (horario)' }, { npcId: 'luna_serp', placeId: 'cafe', where: 'Luna (horario)' }, { npcId: 'luna_serp', placeId: 'ruinas', where: 'Luna (casa)' }];
  const result = check(sampleMap(), { refs, legacyIds: new Set(['cafe']) });
  assert.deepEqual(result.warnings.map((item) => item.message), ['Luna (casa) usa el lugar «ruinas», que ningún mapa define.'], 'ids provisionales y ya definidos no molestan');
});

// --- Imágenes y almacén -----------------------------------------------------------------------------------------------------------------------------
test('image sizes are read from png, jpg and webp headers without libraries', async () => {
  const png = Buffer.alloc(33); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(1234, 16); png.writeUInt32BE(5678, 20);
  assert.deepEqual(imageSize(png), { width: 1234, height: 5678 });
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x03, 0x20, 0x04, 0xb0, 0x03, 0x01, 0x11, 0x00]);
  assert.deepEqual(imageSize(jpg), { width: 1200, height: 800 });
  const vp8x = Buffer.alloc(30); vp8x.write('RIFF', 0); vp8x.write('WEBP', 8); vp8x.write('VP8X', 12); vp8x.writeUIntLE(1999, 24, 3); vp8x.writeUIntLE(2999, 27, 3);
  assert.deepEqual(imageSize(vp8x), { width: 2000, height: 3000 });
  assert.equal(imageSize(Buffer.from('no es una imagen')), null);
  const real = await readFile(path.resolve('assets/portraits/luna_serp/default.webp'));
  const size = imageSize(real);
  assert.ok(size.width > 100 && size.height > 100 && size.width < 8000, `el retrato real de Luna se lee (${size.width}×${size.height})`);
});

async function tempStore(options = {}) {
  const base = await mkdtemp(path.join(tmpdir(), 'hom-maps-'));
  return { base, store: createMapStore({ dir: path.join(base, 'maps'), assetDir: path.join(base, 'assets'), ...options }) };
}

test('the store saves valid maps atomically with a dated backup, refuses invalid ones and keeps ids unique across maps', async (t) => {
  const { base, store } = await tempStore({ backupLimit: 2 });
  t.after(() => rm(base, { recursive: true, force: true }));
  assert.deepEqual(await store.list(), []);

  const first = await store.save('norte', sampleMap({ id: 'otro' }), { npcIds: new Set(['luna_serp']) });
  assert.equal(first.map.id, 'norte', 'el id de la ruta manda sobre el del cuerpo');
  const file = path.join(base, 'maps', 'norte.json');
  const text = await readFile(file, 'utf8');
  assert.ok(text.endsWith('\n') && text.startsWith('{\n  "schemaVersion": 2,'), 'JSON ordenado y legible');
  assert.deepEqual(JSON.parse(text), (await store.read('norte')));
  await assert.rejects(access(path.join(base, 'maps', '.backup')), 'la primera vez no hay nada que respaldar');

  for (let version = 2; version <= 5; version++) await store.save('norte', sampleMap({ name: `Versión ${version}` }));
  assert.equal((await store.read('norte')).name, 'Versión 5');
  assert.equal((await readdir(path.join(base, 'maps', '.backup'))).length, 2, 'solo se conservan las últimas copias');

  const before = await readFile(file, 'utf8');
  await assert.rejects(store.save('norte', sampleMap({ places: [{ id: 'Mal Id', name: 'x', kind: 'poi', x: 700, y: 700 }] })), (error) => error.status === 400 && error.code === 'MAP_INVALID' && error.issues.errors[0].code === 'place_id');
  assert.equal(await readFile(file, 'utf8'), before, 'un mapa con errores no toca el archivo');

  const other = sampleMap({ places: [{ id: 'luna_cafe', name: 'Otro café', kind: 'food', x: 700, y: 700 }], districts: [] });
  await assert.rejects(store.save('sur', other), (error) => error.issues.errors.some((item) => item.code === 'id_taken'));
  await store.save('sur', sampleMap({ places: [{ id: 'sur_puerto', name: 'Puerto', kind: 'poi', x: 700, y: 700 }], areas: [{ id: 'bahia', kind: 'water', polygon: SQUARE }], ways: [{ id: 'muelle', kind: 'path', points: [[0, 0], [100, 0]] }] }));
  assert.deepEqual((await store.list()).map((item) => [item.id, item.places, item.areas, item.ways]), [['norte', 2, 0, 0], ['sur', 1, 1, 1]]);
  await assert.rejects(store.read('no_existe'), { code: 'MAP_NOT_FOUND', status: 404 });
  await assert.rejects(store.save('../escape', sampleMap()), { status: 400 });
  await assert.rejects(store.read('Mapa Raro'), { status: 400 });
});

test('the store reads old v1 files as v2 and writes them back in v2 on the next save', async (t) => {
  const { base, store } = await tempStore();
  t.after(() => rm(base, { recursive: true, force: true }));
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(path.join(base, 'maps'), { recursive: true });
  const v1 = { schemaVersion: 1, id: 'viejo', name: 'Viejo', image: { file: 'viejo.webp', width: 1000, height: 1000 }, scale: { metersPerPixel: 4 }, districts: [], places: [{ id: 'sitio_a', name: 'A', kind: 'poi', x: 0.5, y: 0.5 }], links: [] };
  await writeFile(path.join(base, 'maps', 'viejo.json'), JSON.stringify(v1));
  const map = await store.read('viejo');
  assert.equal(map.schemaVersion, 2);
  assert.deepEqual([map.places[0].x, map.places[0].y], [2000, 2000]);
  await store.save('viejo', map);
  assert.equal(JSON.parse(await readFile(path.join(base, 'maps', 'viejo.json'), 'utf8')).schemaVersion, 2);
});

test('the store saves tracing images with their real size and a layer name, replaces other formats and rejects anything that is not an image', async (t) => {
  const { base, store } = await tempStore();
  t.after(() => rm(base, { recursive: true, force: true }));
  const webp = await readFile(path.resolve('assets/portraits/luna_serp/default.webp'));
  const saved = await store.saveImage('norte', webp);
  assert.equal(saved.file, 'norte_base.webp');
  assert.ok(saved.width > 0 && saved.height > 0);
  assert.equal((await store.saveImage('norte', webp, 'costa')).file, 'norte_costa.webp', 'varias capas de calco por mapa');
  assert.deepEqual((await readdir(path.join(base, 'assets'))).sort(), ['norte_base.webp', 'norte_costa.webp']);
  const png = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.writeUInt32BE(400, 16); png.writeUInt32BE(300, 20);
  assert.equal((await store.saveImage('norte', png)).file, 'norte_base.png');
  assert.deepEqual((await readdir(path.join(base, 'assets'))).sort(), ['norte_base.png', 'norte_costa.webp'], 'la imagen anterior de la misma capa y otro formato se borra');
  await assert.rejects(store.saveImage('norte', Buffer.from('<svg onload="alert(1)"></svg>')), /PNG, WebP o JPG/);
  await assert.rejects(store.saveImage('norte', Buffer.alloc(10)), /PNG, WebP o JPG/);
  await assert.rejects(store.saveImage('norte', webp, '../x'), { status: 400 });
  const hollow = Buffer.alloc(64); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(hollow);
  await assert.rejects(store.saveImage('norte', hollow), /tamaño/);
});

// --- API de desarrollo -----------------------------------------------------------------------------------------------------------------------------
test('API: the map routes exist only in development mode and enforce the same validation as the editor', async (t) => {
  const { base, store } = await tempStore();
  t.after(() => rm(base, { recursive: true, force: true }));
  const server = createAppServer({ geography: fixtureGeography(), maps: store, ai: {}, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async () => {}, loadRun: async () => ({}), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, { dev = true, method = body ? 'POST' : 'GET' } = {}) => {
    const response = await fetch(url + route, { method, headers: { 'content-type': 'application/json', ...(dev ? { 'x-hom-dev': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json().catch(() => null), response };
  };

  assert.equal((await call('/api/dev/maps', null, { dev: false })).status, 403, 'sin la cabecera de desarrollo no hay acceso');
  assert.equal((await call('/api/dev/maps/norte', { map: sampleMap() }, { dev: false, method: 'PUT' })).status, 403);
  const empty = await call('/api/dev/maps');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.maps, []);
  assert.deepEqual(empty.body.legacyIds, [], 'ya no hay lista provisional de lugares: el mapa del juego es la única fuente');
  assert.ok(empty.body.npcIds.includes('luna_serp'));
  assert.ok(empty.body.refs.some((item) => item.npcId === 'luna_serp' && item.placeId === 'cafe'), 'y los lugares que usan las fichas de los NPC');

  const bad = await call('/api/dev/maps/norte', { map: sampleMap({ places: [{ id: 'Mal Id', name: 'x', kind: 'poi', x: 700, y: 700 }] }) }, { method: 'PUT' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'MAP_INVALID');
  assert.equal(bad.body.issues.errors[0].code, 'place_id');
  assert.equal((await call('/api/dev/maps/norte')).status, 404);

  const webp = await readFile(path.resolve('assets/portraits/luna_serp/default.webp'));
  const image = await call('/api/dev/maps/norte/image', { data: webp.toString('base64'), name: 'boceto' });
  assert.equal(image.status, 200);
  assert.equal(image.body.image.file, 'norte_boceto.webp');
  assert.equal((await call('/api/dev/maps/norte/image', { data: Buffer.from('hola').toString('base64') })).status, 400);

  const withEverything = sampleMap({
    underlays: [{ id: 'boceto', ...image.body.image, x: -100, y: -100, metersPerPixel: 3, opacity: 0.5, visible: true }],
    areas: [{ id: 'lago', name: 'Lago', kind: 'water', polygon: SQUARE }, { id: 'ciudad', kind: 'urban', polygon: [[0, 0], [1500, 0], [1500, 1500], [0, 1500]], fill: { pattern: 'organic', seed: 7 }, group: 'capital' }],
    ways: [{ id: 'avenida', kind: 'avenue', points: [[0, 750], [1500, 750]] }], groups: [{ id: 'capital', name: 'Northfortress', locked: true }]
  });
  const saved = await call('/api/dev/maps/norte', { map: withEverything }, { method: 'PUT' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.issues.errors, []);
  const loaded = await call('/api/dev/maps/norte');
  assert.equal(loaded.body.map.places[0].district, 'centro');
  assert.equal(loaded.body.map.areas[1].fill.seed, 7);
  assert.equal(loaded.body.map.groups[0].locked, true);
  assert.equal(loaded.body.map.underlays[0].file, 'norte_boceto.webp');
  assert.deepEqual(loaded.body.issues.errors, []);
  assert.deepEqual(loaded.body.context.takenIds, [], 'su propio mapa no cuenta como «otro mapa»');
  const listed = await call('/api/dev/maps');
  assert.deepEqual(listed.body.maps.map((item) => [item.id, item.areas, item.ways, item.groups]), [['norte', 2, 1, 1]]);
  assert.equal((await call('/api/dev/maps/Nope!')).status, 404);

  // los módulos compartidos se sirven tal cual (solo los de la lista) y el editor valida con el mismo código que el servidor
  const geo = await fetch(`${url}/shared/geo.js`);
  assert.equal(geo.status, 200);
  assert.match(geo.headers.get('content-type'), /javascript/);
  assert.match(await geo.text(), /export function pointInPolygon/);
  for (const name of ['mapSchema.js', 'mapDefaults.js', 'mapGen.js']) assert.equal((await fetch(`${url}/shared/${name}`)).status, 200, name);
  assert.equal((await fetch(`${url}/shared/secreto.js`)).status, 404);
  assert.equal((await fetch(`${url}/shared/..%2Fserver%2Findex.js`)).status, 404);
});

test('the editor page and every module it imports are served by the game server', async (t) => {
  const { base, store } = await tempStore();
  t.after(() => rm(base, { recursive: true, force: true }));
  const server = createAppServer({ geography: fixtureGeography(), maps: store, ai: {}, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async () => {}, loadRun: async () => ({}), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const page = await (await fetch(`${url}/mapeditor.html`)).text();
  assert.match(page, /<script type="module" src="\/mapeditor\.js">/);
  for (const [, file] of page.matchAll(/(?:href|src)="(\/[^"]+\.(?:css|js))"/g)) assert.equal((await fetch(url + file)).status, 200, `${file} se sirve`);
  // cada import del editor y del visor apunta a un archivo que existe: un import roto dejaría el editor en blanco sin avisar
  for (const file of ['mapeditor.js', 'mapview.js', 'maprender.js']) {
    const source = await (await fetch(`${url}/${file}`)).text();
    for (const [, target] of source.matchAll(/from '(\/[^']+)'/g)) assert.equal((await fetch(url + target)).status, 200, `${file} importa ${target}`);
  }
  for (const module of ['mapSchema.js', 'mapGen.js']) {
    const shared = await (await fetch(`${url}/shared/${module}`)).text();
    for (const [, target] of shared.matchAll(/from '(\.\/[^']+)'/g)) assert.equal((await fetch(`${url}/shared/${target.slice(2)}`)).status, 200, `${module} importa ${target}`);
  }
});
