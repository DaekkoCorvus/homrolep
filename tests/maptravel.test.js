import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAVEL_MODES, LINK_MODES, speedKmh, placeIndex, linkPoints, drawnKm, linkKm, linkMinutes, straightKm, walkMinutes, formatDuration, formatKm, planTrip } from '../src/shared/mapTravel.js';
import { LAYERS, LAYER_IDS, layerOf, isHidden, isLocked } from '../src/shared/mapLayers.js';
import { emptyMap, normalizeMap, validateMap } from '../src/shared/mapSchema.js';

// Un mapa de juguete a escala regional (metros del mundo): A —20 km— B —30 km— C, y D aislado. Nada de esto es de Northfortress: el sistema vale para cualquier región.
const place = (id, x, y, extra = {}) => ({ id, name: id.toUpperCase(), kind: 'city', x: x * 1000, y: y * 1000, ...extra });
function toyMap(extra = {}) {
  return normalizeMap({
    ...emptyMap('region_a', 'Región A'),
    places: [place('aa', 0, 0), place('bb', 20, 0), place('cc', 20, 30), place('dd', -50, 40, { kind: 'town' })],
    links: [
      { id: 'tren_ab', name: 'Tren A–B', mode: 'rail', from: 'aa', to: 'bb' },
      { id: 'tren_bc', name: 'Tren B–C', mode: 'rail', from: 'bb', to: 'cc' },
      { id: 'ruta_ac', name: 'Carretera A–C', mode: 'road', from: 'aa', to: 'cc', path: [[-2000, 20000]] }
    ],
    ...extra
  });
}

test('a link takes its distance from the drawn path or from the author, and its time from the distance and the mode speed', () => {
  const map = toyMap(); const index = placeIndex(map);
  const ab = map.links.find((link) => link.id === 'tren_ab');
  assert.equal(linkMinutes(map, { ...ab, minutes: null }, index), 15, '20 km a 80 km/h = 15 min');
  assert.equal(drawnKm(map, ab, index), 20); assert.equal(linkKm(map, ab, index), 20);
  assert.equal(linkKm(map, { ...ab, distanceKm: 26 }, index), 26, 'la distancia diegética escrita manda sobre el dibujo');
  assert.equal(linkMinutes(map, { ...ab, minutes: 42 }, index), 42, 'los minutos escritos mandan sobre el cálculo');
  const curved = map.links.find((link) => link.id === 'ruta_ac');
  assert.ok(drawnKm(map, curved, index) > straightKm(map, 'aa', 'cc', index), 'el trazado con curvas es más largo que la línea recta');
  assert.deepEqual(linkPoints(map, curved, index), [[0, 0], [-2000, 20000], [20000, 30000]]);
  assert.equal(linkPoints(map, { from: 'aa', to: 'fuera_del_mapa' }, index), null, 'un extremo de otro mapa no tiene coordenadas aquí');
  assert.equal(linkMinutes(map, { mode: 'road', from: 'aa', to: 'fuera_del_mapa', minutes: null, distanceKm: null }, index), null);
});

test('every mode has a label, a speed and a layer; the map can override speeds per mode', () => {
  for (const mode of LINK_MODES) assert.ok(TRAVEL_MODES[mode].label && TRAVEL_MODES[mode].kmh > 0 && TRAVEL_MODES[mode].color, mode);
  assert.ok(!LINK_MODES.includes('walk'), 'caminar no es un enlace: está siempre disponible');
  const map = toyMap({ travel: { speedsKmh: { rail: 160, walk: 4 } } });
  assert.equal(speedKmh(map, 'rail'), 160); assert.equal(speedKmh(map, 'road'), TRAVEL_MODES.road.kmh);
  assert.equal(linkMinutes(map, map.links[0], placeIndex(map)), 8, 'a 160 km/h son 8 min');
  assert.equal(walkMinutes(map, 20), 300, 'a 4 km/h, 20 km son 5 h');
  assert.equal(walkMinutes(toyMap(), 20), 240, 'por defecto se camina a 5 km/h: 20 km son 4 h');
});

test('durations and distances are written for people', () => {
  assert.equal(formatDuration(30), '30 min'); assert.equal(formatDuration(60), '1 h'); assert.equal(formatDuration(75), '1 h 15 min');
  assert.equal(formatDuration(240), '4 h'); assert.equal(formatDuration(1500), '1 d 1 h'); assert.equal(formatDuration(1440), '1 d'); assert.equal(formatDuration(NaN), '—');
  assert.equal(formatKm(20), '20 km'); assert.equal(formatKm(4.25), '4,3 km'); assert.equal(formatKm(null), '—');
});

test('planTrip offers walking, the fastest network route and the fastest by each mode, sorted by time', () => {
  const map = toyMap();
  const trip = planTrip(map, 'aa', 'bb');
  assert.equal(trip.straightKm, 20);
  const walk = trip.options.find((option) => option.id === 'walk');
  assert.equal(walk.minutes, 240); assert.equal(walk.cost, 0);
  const rail = trip.options.find((option) => option.id === 'fastest');
  assert.equal(rail.minutes, 15); assert.deepEqual(rail.legs.map((leg) => leg.linkId), ['tren_ab']);
  assert.deepEqual(trip.options.map((option) => option.minutes), [...trip.options.map((option) => option.minutes)].sort((a, b) => a - b), 'ordenadas por tiempo');

  const far = planTrip(map, 'aa', 'cc');   // por tren (dos tramos) o por la carretera directa
  const ids = far.options.map((option) => option.id);
  assert.ok(ids.includes('fastest') && ids.includes('walk'));
  const byRail = far.options.find((option) => option.legs.map((leg) => leg.linkId).join() === 'tren_ab,tren_bc');
  assert.ok(byRail, 'hay una ruta en tren con transbordo en B');
  assert.equal(byRail.minutes, 15 + 10 + 23, 'dos trenes (15 + 23 min) y 10 min de transbordo');
  assert.equal(far.options.find((option) => option.legs.length === 1 && option.modes[0] === 'road').legs[0].linkId, 'ruta_ac');
});

test('staying on the same line is not a transfer; links can be one-way; unreachable places have only the walk', () => {
  const lined = toyMap({ lines: [{ id: 'linea_1', name: 'Línea 1', mode: 'rail', color: '#ff0000' }] });
  lined.links[0].line = 'linea_1'; lined.links[1].line = 'linea_1';
  const far = planTrip(lined, 'aa', 'cc');
  assert.equal(far.options.find((option) => option.legs.map((leg) => leg.linkId).join() === 'tren_ab,tren_bc').minutes, 15 + 23, 'sin transbordo dentro de la misma línea');
  const oneWay = toyMap(); oneWay.links[0].twoWay = false;
  assert.ok(planTrip(oneWay, 'aa', 'bb').options.some((option) => option.id === 'fastest'));
  assert.ok(!planTrip(oneWay, 'bb', 'aa').options.some((option) => option.legs.some((leg) => leg.linkId === 'tren_ab')), 'un enlace de un solo sentido no se usa al revés');
  const isolated = planTrip(toyMap(), 'aa', 'dd');
  assert.deepEqual(isolated.options.map((option) => option.id), ['walk'], 'D no está conectado: solo se puede ir a pie');
  assert.equal(planTrip(toyMap(), 'aa', 'aa').options.length, 0, 'ir a donde ya estás no es un viaje');
  const tooFar = planTrip(toyMap(), 'aa', 'dd', { walkMaxMinutes: 60 });
  assert.equal(tooFar.options[0].tooFar, true, 'el tope de un tramo a pie se avisa');
});

test('layers: every kind of element belongs to exactly one layer; stations follow their links', () => {
  assert.equal(LAYERS.length, 13);
  assert.deepEqual(LAYER_IDS, ['terrain', 'water', 'regions', 'cities', 'districts', 'pois', 'roads', 'railways', 'northline', 'ports', 'borders', 'labels', 'decor']);
  assert.equal(layerOf('area', { kind: 'water' }), 'water'); assert.equal(layerOf('area', { kind: 'region' }), 'regions');
  assert.equal(layerOf('area', { kind: 'forest' }), 'terrain'); assert.equal(layerOf('area', { kind: 'urban' }), 'cities');
  assert.equal(layerOf('way', { kind: 'river' }), 'water'); assert.equal(layerOf('way', { kind: 'rail' }), 'railways');
  assert.equal(layerOf('way', { kind: 'border' }), 'borders'); assert.equal(layerOf('way', { kind: 'street' }), 'roads');
  assert.equal(layerOf('link', { mode: 'northline' }), 'northline'); assert.equal(layerOf('link', { mode: 'sea' }), 'ports');
  assert.equal(layerOf('link', { mode: 'train' }), 'railways'); assert.equal(layerOf('link', { mode: 'trade' }), 'roads');
  assert.equal(layerOf('district', {}), 'districts');
  assert.equal(layerOf('decor', { kind: 'ship' }), 'decor'); assert.equal(layerOf('decor', { kind: 'label' }), 'labels');
  assert.equal(layerOf('place', { kind: 'capital' }), 'cities'); assert.equal(layerOf('place', { kind: 'port' }), 'ports');
  assert.equal(layerOf('place', { kind: 'poi' }), 'pois'); assert.equal(layerOf('place', { kind: 'district' }), 'districts');
  assert.equal(layerOf('terrain:water'), 'water'); assert.equal(layerOf('terrain:forest'), 'terrain');
  const map = toyMap();
  assert.equal(layerOf('place', { id: 'bb', kind: 'station' }, map), 'railways', 'una estación con solo trenes va a ferrocarril');
  assert.equal(layerOf('place', { id: 'zz', kind: 'station' }, map), 'northline', 'sin enlaces, una estación es de la red Northline');
  const layers = { hidden: new Set(['roads']), locked: new Set(['ports']) };
  assert.equal(isHidden(layers, 'way', { kind: 'street' }), true); assert.equal(isHidden(layers, 'way', { kind: 'rail' }), false);
  assert.equal(isLocked(layers, 'place', { kind: 'port' }), true); assert.equal(isLocked(layers, 'place', { kind: 'city' }), false);
});

test('a map with links, lines and decor validates, and the validator explains what is wrong', () => {
  const map = toyMap({ lines: [{ id: 'linea_1', name: 'Línea 1', mode: 'rail', color: '#ff0000' }], decor: [{ id: 'rosa', kind: 'compass', x: -60000, y: -40000, size: 30000 }] });
  assert.deepEqual(validateMap(map).errors, []);
  const codes = (input) => validateMap(normalizeMap(input)).errors.map((item) => item.code).sort();
  assert.ok(codes({ ...map, links: [{ ...map.links[0], line: 'no_existe' }] }).includes('link_line'));
  assert.ok(codes({ ...map, links: [{ ...map.links[0], to: 'aa' }] }).includes('link_loop'));
  assert.ok(codes({ ...map, links: [{ ...map.links[0], distanceKm: -3 }] }).includes('link_distance'));
  assert.deepEqual(codes({ ...map, links: [{ ...map.links[0], minutes: null, distanceKm: 0.01 }] }), [], 'sin minutos se calculan (mínimo 1)');
  assert.ok(codes({ ...map, links: [{ ...map.links[0], to: 'otro_mapa', minutes: null, distanceKm: null }] }).includes('link_endpoint'));
  assert.ok(codes({ ...map, lines: [{ id: 'linea_1', name: '', mode: 'avion', color: '#fff' }] }).includes('line_mode'));
  assert.ok(codes({ ...map, decor: [{ ...map.decor[0], kind: 'dragon' }] }).includes('decor_kind'));
  assert.ok(codes({ ...map, decor: [{ ...map.decor[0], size: 0 }] }).includes('decor_size'));
  assert.ok(codes({ ...map, places: [{ ...map.places[0], importance: 9 }, ...map.places.slice(1)] }).includes('place_importance'));
  assert.ok(codes({ ...map, places: [{ ...map.places[0], icon: 'castillo' }, ...map.places.slice(1)] }).includes('place_icon'));
  assert.ok(codes({ ...map, travel: { speedsKmh: { rail: -5 } } }).includes('travel_speed'));
});
