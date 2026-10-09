// Crea (o recrea) el mapa regional de Northfortress: data/canon/maps/northfortress_territory.json.
//
// Es la PRIMERA región construida con el sistema de mapas (la ciudad —data/canon/maps/northfortress.json— sigue siendo el mapa del juego). Usa exactamente los mismos
// módulos que el editor y el motor (esquema, terreno pintado, validación y almacén con copia de seguridad), de modo que el resultado se abre y se edita en el Editor de
// mapas como cualquier otro: terreno con pincel, lugares, enlaces (carreteras, ferrocarril, Northline, rutas marítimas), regiones, decoración, capas…
//
// Medidas: coordenadas en METROS (1 unidad = 1 m), x hacia el este, y hacia el sur; el origen es el centro de la capital. Todo lo que aquí se escribe «en km» se multiplica
// por 1000 al guardar. Las distancias entre ciudades siguen lo escrito en el lore (Heartstone ≈ 20 km de la capital, Market Bridge 35–50 km, High Sanctuary 60–90 km,
// Westwall 100–150 km); el territorio mide unos 300 km de extremo a extremo. Los nombres marcados «(prov.)» son provisionales (accidentes geográficos menores).
//
// Uso:  node scripts/seed-northfortress-territory.mjs        (sobrescribe el mapa dejando una copia en data/canon/maps/.backup/)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMapStore } from '../src/server/game/maps.js';
import { emptyMap, normalizeMap, validateMap } from '../src/shared/mapSchema.js';
import { Terrain, paintPolygon, TERRAIN_CODE, TERRAIN_PRESETS } from '../src/shared/mapTerrain.js';
import { mulberry32 } from '../src/shared/mapGen.js';
import { linkMinutes, linkKm, placeIndex, planTrip, formatDuration } from '../src/shared/mapTravel.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_ID = 'northfortress_territory';
const km = (points) => points.map(([x, y]) => [x * 1000, y * 1000]);
const rnd = mulberry32(20261005);

// --- Formas ------------------------------------------------------------------------------------------------------------------------------------------
// Anillo irregular alrededor de (cx, cy) con radio r (km); `jag` = irregularidad (0–1). Sirve para ciudades, lagos y manchas de bosque.
function ring(cx, cy, r, { n = 22, jag = 0.22, squash = 1, rotate = 0, seed = 1 } = {}) {
  const phase = mulberry32(seed * 7919); const points = [];
  const waves = Array.from({ length: 4 }, () => ({ f: 2 + Math.floor(phase() * 4), p: phase() * Math.PI * 2, a: phase() }));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2; let wobble = 0; for (const w of waves) wobble += Math.sin(t * w.f + w.p) * w.a;
    const radius = r * (1 + jag * (wobble / 2.2) + (phase() - 0.5) * jag * 0.35);
    const x = Math.cos(t) * radius; const y = Math.sin(t) * radius * squash; const a = (rotate * Math.PI) / 180;
    points.push([round(cx + x * Math.cos(a) - y * Math.sin(a)), round(cy + x * Math.sin(a) + y * Math.cos(a))]);
  }
  return points;
}
const round = (value) => Math.round(value * 100) / 100;

// --- Geografía (km) ------------------------------------------------------------------------------------------------------------------------------------
// Costa de punta a punta (del noreste al sur y al oeste). La bahía de la capital entra por el sur hasta Porta Magna; la península de Heartstone queda al este de ella.
const COAST = [[50, -110], [49, -86], [48, -64], [42, -50], [37, -42], [33, -37], [30, -34], [34, -30], [38, -27], [41, -18], [48, -6], [46, 6], [39, 18], [31, 30], [27, 38], [21, 46], [11, 45], [9, 34], [8, 22], [5, 14], [0, 11], [-5, 12], [-11, 16], [-17, 25], [-23, 36], [-31, 43], [-46, 39], [-63, 45], [-80, 39], [-100, 47], [-120, 41], [-142, 46], [-170, 44], [-205, 48]];
// La tierra firme: sigue la costa por el este y el sur y rodea el territorio por el norte y el oeste con un margen de tierra «fuera de mapa»; todo lo demás es mar (una
// costa natural en todo el contorno, sin cortes rectos).
const LAND = [...COAST.slice(0, -1), [-182, 44], [-188, 20], [-185, -12], [-177, -40], [-155, -64], [-126, -85], [-94, -100], [-62, -113], [-26, -122], [14, -124], [40, -118]];
const OCEAN_BOX = [[-212, -130], [112, -130], [112, 132], [-212, 132]];
const TERRITORY = [[-150, -46], [-128, -60], [-104, -68], [-80, -78], [-56, -90], [-28, -100], [4, -104], [30, -98], [46, -82], [48, -64], [42, -50], [37, -42], [33, -37], [30, -34], [34, -30], [38, -27], [41, -18], [48, -6], [46, 6], [39, 18], [31, 30], [27, 38], [21, 46], [11, 45], [9, 34], [8, 22], [5, 14], [0, 11], [-5, 12], [-11, 16], [-17, 25], [-23, 36], [-31, 43], [-46, 39], [-63, 45], [-80, 39], [-100, 47], [-120, 41], [-142, 46], [-150, 40], [-154, 10], [-152, -20]];
const CORDILLERA = [[-112, -56], [-88, -68], [-62, -80], [-36, -98], [-6, -112], [26, -110], [42, -96], [44, -80], [30, -68], [10, -63], [-14, -59], [-40, -55], [-66, -51], [-92, -43]];
const NIEVE = [[-24, -96], [-8, -106], [18, -104], [32, -92], [27, -77], [9, -70], [-10, -74], [-23, -84]];
const DESIERTO = [[-205, -60], [-100, -60], [-93, -44], [-88, -22], [-91, 0], [-85, 18], [-91, 36], [-101, 49], [-205, 52]];
const ARIDA = [[-205, -64], [-84, -64], [-72, -44], [-70, -22], [-74, -2], [-68, 16], [-72, 34], [-90, 49], [-205, 54]];

// Ciudades (centros en km) — la huella urbana de cada una se pinta como terreno «urbanizado» o «industrial».
const CITY = {
  capital: [0, 0], portaMagna: [-1, 8.5], heartstone: [12.5, 15.5], marketBridge: [27.5, -32], marketBridgePort: [30, -34.5],
  westwall: [-128, 6], highSanctuary: [4, -78], gateWest: [-166, 2], gateArkaleon: [72, -27]
};

// --- Terreno ---------------------------------------------------------------------------------------------------------------------------------------------
function buildTerrain() {
  const t = new Terrain({ cell: TERRAIN_PRESETS.region.cell, seed: 7, forest: { ...TERRAIN_PRESETS.region.forest }, chunks: {} });
  const paint = (points, kind, options = {}) => paintPolygon(t, km(points), kind, options);
  paint(OCEAN_BOX, 'water', { rugged: 0 });
  paint(LAND, 'land', { rugged: 0.55 });
  paint(CORDILLERA, 'mountain', { rugged: 0.9, protect: ['water'] });
  paint(NIEVE, 'snow', { rugged: 0.9, protect: ['water'] });
  paint(ARIDA, 'arid', { rugged: 0.9, protect: ['water', 'mountain', 'snow'] });
  paint(DESIERTO, 'desert', { rugged: 0.9, protect: ['water', 'mountain', 'snow'] });
  paint(ring(-128, 6, 11, { seed: 3, jag: 0.4 }), 'arid', { rugged: 0.6, protect: ['water'] });        // roquedal alrededor de Westwall
  // Campos: el cinturón agrícola alrededor de la capital y de los ríos
  paint(ring(-4, 0, 44, { n: 34, jag: 0.3, squash: 0.72, seed: 5 }), 'field', { rugged: 0.8, protect: ['water', 'mountain', 'snow', 'desert', 'arid'] });
  paint(ring(-60, 4, 26, { n: 26, jag: 0.35, squash: 0.45, seed: 11 }), 'field', { rugged: 0.8, protect: ['water', 'mountain', 'snow', 'desert', 'arid'] });
  // Bosques: faldas de la cordillera, el noroeste, el suroeste costero y el este de la capital
  const forests = [[-58, -40, 24, 0.55, 4], [-86, -38, 12, 0.5, 8], [-34, -16, 11, 0.6, 12], [-5, -52, 20, 0.35, 14], [-44, -62, 14, 0.4, 16], [20, -17, 10, 1, 17], [-50, 25, 24, 0.4, 20], [-18, 28, 10, 0.5, 21], [14, -62, 11, 0.5, 22], [-70, 14, 12, 0.5, 24], [36, 26, 7, 0.6, 26]];
  for (const [cx, cy, r, squash, seed] of forests) paint(ring(cx, cy, r, { n: 24, jag: 0.4, squash, seed }), 'forest', { rugged: 0.9, protect: ['water', 'mountain', 'snow', 'desert', 'arid'] });
  // Parques / praderas más verdes junto al río
  paint(ring(-16, 2, 7, { seed: 31, jag: 0.35 }), 'park', { rugged: 0.5, protect: ['water'] });
  // Arena en la orilla del mar
  const [i0, i1, j0, j1] = [-210, 110, -120, 130];
  const sand = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (t.get(i, j) === TERRAIN_CODE.water) continue;
    let near = false;
    for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) if (t.get(i + di, j + dj) === TERRAIN_CODE.water) { near = true; break; }
    if (near && rnd() < 0.8 && ![TERRAIN_CODE.mountain, TERRAIN_CODE.snow].includes(t.get(i, j))) sand.push([i, j]);
  }
  for (const [i, j] of sand) t.set(i, j, TERRAIN_CODE.sand);
  // Zonas urbanizadas e industriales (mandan sobre lo de abajo salvo el agua)
  const urban = (c, r, options) => paint(ring(c[0], c[1], r, options), 'urban', { rugged: 0.35, protect: ['water'] });
  const industrial = (c, r, options) => paint(ring(c[0], c[1], r, options), 'industrial', { rugged: 0.5, protect: ['water'] });
  urban(CITY.capital, 8.2, { n: 30, jag: 0.16, seed: 40 });                      // la megaciudad: una huella enorme y compacta
  urban([-1, 7], 4, { n: 18, jag: 0.18, seed: 41 });                              // se extiende hasta la bahía, donde está Porta Magna
  urban([6, -5], 4.5, { n: 18, jag: 0.25, seed: 42 }); urban([-6, -4], 4, { n: 18, jag: 0.25, seed: 43 });
  industrial(CITY.heartstone, 5.8, { n: 26, jag: 0.35, seed: 50 });               // las grandes fábricas de Heartstone
  industrial([8.5, 10], 2.4, { n: 14, seed: 51 }); industrial([16, 22], 2.6, { n: 14, seed: 52 }); industrial([20, 12], 2, { n: 12, seed: 53 });
  urban([12.5, 15], 2, { n: 14, jag: 0.3, seed: 54 });                            // el casco pobre y abandonado, mucho más pequeño que su industria
  urban(CITY.marketBridge, 2.4, { n: 16, jag: 0.25, seed: 60 }); industrial([30, -31], 1.7, { n: 12, seed: 61 });
  urban(CITY.westwall, 2.1, { n: 14, jag: 0.25, seed: 70 });
  urban(CITY.highSanctuary, 1.3, { n: 12, jag: 0.25, seed: 80 });
  // Lago interior
  paint(ring(-52, -20, 6.5, { n: 20, jag: 0.45, squash: 0.55, seed: 90, rotate: -20 }), 'water', { rugged: 0.5 });
  return t;
}

// --- Datos del mapa --------------------------------------------------------------------------------------------------------------------------------------
function buildMap() {
  const map = emptyMap(MAP_ID, 'Northfortress · Territorio');
  map.style = { theme: 'atlas' };
  const t = buildTerrain(); map.terrain = t.toData();
  const m = (value) => Math.round(value * 1000 * 10) / 10;    // km → m

  map.groups = [
    { id: 'northfortress', name: 'Northfortress (territorio)', parent: null, locked: false, baked: null },
    { id: 'geografia', name: 'Geografía y fronteras', parent: 'northfortress', locked: false, baked: null },
    { id: 'ciudades', name: 'Ciudades y lugares', parent: 'northfortress', locked: false, baked: null },
    { id: 'adornos', name: 'Decoración y etiquetas', parent: 'northfortress', locked: false, baked: null }
  ];

  // Región política
  map.areas.push({ id: 'territorio_northfortress', name: 'Northfortress', kind: 'region', polygon: km(TERRITORY), z: 9, fill: null, group: 'geografia', color: '#4aa3ff', faction: 'Northfortress' });

  // Ríos y fronteras (anchos exagerados a esta escala para que se lean: son líneas, no la anchura real del cauce)
  const river = (id, name, points, width) => map.ways.push({ id, name, kind: 'river', points: km(points), width, z: 10, group: 'geografia' });
  river('gran_rio', 'Gran Río (prov.)', [[-6, -76], [-8, -64], [-12, -52], [-15, -40], [-17, -29], [-15, -19], [-12, -12]], 1100);
  river('gran_rio_oeste', 'Gran Río, brazo oeste (prov.)', [[-12, -12], [-14.5, -4], [-12.5, 3.5], [-9.5, 9], [-6.5, 12.5]], 900);
  river('gran_rio_este', 'Gran Río, brazo este (prov.)', [[-12, -12], [-4, -14.5], [5, -12], [10.5, -4], [10, 4.5], [7.5, 10], [6, 14.5]], 900);
  river('rio_del_puente', 'Río del Puente (prov.)', [[22, -74], [25, -63], [24.5, -52], [26, -42], [27.5, -37], [29.8, -34.4]], 650);
  river('rio_del_oeste', 'Río seco del oeste (prov.)', [[-52, -26], [-62, -22], [-76, -12], [-88, -8], [-98, -4]], 420);
  map.ways.push({ id: 'frontera_occidental', name: 'Frontera occidental', kind: 'border', points: km([[-150, -48], [-153, -26], [-155, -4], [-154, 14], [-151, 32], [-148, 42]]), width: 600, z: 17, group: 'geografia' });

  // Distritos de juego (zonas con niebla) — uno por ciudad, más las fronteras
  const district = (id, name, polygon, fog = 'known') => map.districts.push({ id, name, color: '#c9a45c', polygon: km(polygon), fog, allowPlayerPlaces: false, group: 'ciudades' });
  const colors = ['#f2c14e', '#e0624a', '#4aa3ff', '#d9a05b', '#a8c7f0', '#c9a45c', '#9a7bd1'];
  district('distrito_capital', 'Northfortress Capital', ring(0, 0, 10, { n: 28, jag: 0.08, seed: 100 }));
  district('distrito_heartstone', 'Heartstone', ring(12.5, 15.5, 5.5, { n: 20, jag: 0.12, seed: 101 }));
  district('distrito_market_bridge', 'Market Bridge', ring(28, -33, 3.6, { n: 16, jag: 0.1, seed: 102 }));
  district('distrito_westwall', 'Westwall', ring(-128, 6, 3.4, { n: 16, jag: 0.1, seed: 103 }));
  district('distrito_high_sanctuary', 'High Sanctuary', ring(4, -78, 2.8, { n: 16, jag: 0.1, seed: 104 }));
  district('frontera_oeste', 'Frontera exterior occidental', ring(-166, 2, 5, { n: 12, jag: 0.05, seed: 105 }), 'rumor');
  district('frontera_maritima', 'Rutas marítimas orientales', ring(72, -27, 6, { n: 12, jag: 0.05, seed: 106 }), 'rumor');
  map.districts.forEach((d, i) => { d.color = colors[i % colors.length]; });

  // Lugares
  const place = (id, name, kind, [x, y], extra = {}) => map.places.push({
    id, name, aliases: [], kind, x: m(x), y: m(y), access: 'public', hours: null, tags: [], description: '', discovery: 'known', owner: null, footprint: null, group: 'ciudades', requires: [],
    importance: undefined, icon: null, faction: 'Northfortress', image: null, data: {}, ...extra
  });
  place('northfortress_capital', 'Northfortress Capital', 'capital', CITY.capital, {
    importance: 5, icon: 'skyline', tags: ['capital', 'tecnologia', 'politica', 'defensa'],
    description: 'Megaciudad vertical, tecnológica y densamente poblada en el centro del territorio. Es el centro político, económico, tecnológico, administrativo y militar-defensivo de Northfortress. Su expansión explica la caída de las ciudades industriales antiguas.',
    data: { detail_map: 'northfortress', funcion: 'capital', poblacion_estimada: 'megaciudad' }
  });
  place('government_palace', 'Palacio Gubernamental', 'facility', [-0.9, -1.4], { importance: 1, icon: 'facility', tags: ['gobierno'], description: 'Sede del gobierno de Northfortress, en el corazón de la capital.' });
  place('nova_enterprise_hq', 'Nova Enterprise', 'facility', [1.9, -2.3], { importance: 1, icon: 'facility', tags: ['empresa', 'tecnologia'], description: 'Sede de Nova Enterprise, el conglomerado de Rex Nova cuyo ascenso transformó Northfortress.' });
  place('heroes_organization', 'Organización de Héroes · Centro de Defensa', 'facility', [-2.4, 1.6], { importance: 1, icon: 'facility', tags: ['heroes', 'defensa'], description: 'Organización de Héroes y Centro de Defensa de Northfortress.' });
  place('porta_magna_station', 'Porta Magna', 'station', CITY.portaMagna, {
    importance: 4, icon: 'station', tags: ['transporte', 'northline', 'estacion'],
    description: 'La gran estación central del sistema de transporte Northline. No es una ciudad: es el nodo de intercambio que conecta la capital con todas las ciudades del territorio y con las rutas internacionales. Está integrada con el borde sur de la capital, junto a la bahía.',
    data: { detail_map: 'northfortress', detail_place: 'station', funcion: 'nodo Northline' }
  });
  place('heartstone', 'Heartstone', 'city', CITY.heartstone, {
    importance: 4, icon: 'industrial', tags: ['industrial', 'decadencia', 'pobreza', 'delincuencia'],
    description: 'Antigua ciudad industrial, una de las responsables de la revolución industrial que permitió crecer a Northfortress. Con el ascenso de Rex Nova y sus empresas, sus fábricas no pudieron competir y cerraron una a una. Hoy es una ciudad decadente, parcialmente abandonada, pobre y con muy poca presencia gubernamental: foco de pobreza, delincuencia e infraestructura deteriorada.',
    data: { estado: 'decadente' }
  });
  place('market_bridge', 'Market Bridge', 'city', CITY.marketBridge, {
    importance: 4, icon: 'city', tags: ['comercio', 'logistica'],
    description: 'Ciudad comercial y logística en la desembocadura de un río y al fondo de una bahía protegida, entre la capital y las rutas marítimas hacia territorios exteriores como Arkaleon. Su tecnología no iguala a la de Northfortress, pero buena parte del transporte de mercancías pasa por ella.',
    data: { funcion: 'puerto y logistica' }
  });
  place('market_bridge_port', 'Puerto de Market Bridge', 'port', CITY.marketBridgePort, { importance: 3, icon: 'port', tags: ['puerto', 'comercio'], description: 'El puerto de Market Bridge: muelles, almacenes y la estación de carga ferroviaria.' });
  place('westwall', 'Westwall', 'city', CITY.westwall, {
    importance: 4, icon: 'fortress', tags: ['frontera', 'desierto', 'control'],
    description: 'Ciudad fronteriza en una región desértica y árida. Punto de control y límite occidental de Northfortress, mucho más aislada que las ciudades centrales.'
  });
  place('high_sanctuary', 'High Sanctuary', 'city', CITY.highSanctuary, {
    importance: 4, icon: 'sanctuary', tags: ['religion', 'montana', 'tradicion'], faction: 'Northfortress',
    description: 'Antigua ciudad-santuario religioso dentro de una gran cordillera. Su población mantiene tradiciones religiosas y una fuerte relación con los Celestiales, y se ha resistido culturalmente al avance tecnológico de Nova Enterprise.',
    data: { cultura: 'tradicional', relacion: 'Celestiales' }
  });
  place('gate_west', 'Hacia otros territorios', 'gateway', CITY.gateWest, { importance: 2, icon: 'gate', faction: null, tags: ['frontera', 'exterior'], discovery: 'rumor', description: 'Salida occidental de Northfortress hacia otros territorios (nombre y detalles por definir).' });
  place('gate_arkaleon', 'Hacia Arkaleon y territorios externos', 'gateway', CITY.gateArkaleon, { importance: 2, icon: 'gate', faction: null, tags: ['frontera', 'exterior', 'maritimo'], discovery: 'rumor', description: 'Salida marítima de Northfortress hacia Arkaleon y otros territorios externos.' });

  // Líneas de Northline
  map.lines = [
    { id: 'linea_capital', name: 'Línea Capital (urbana)', mode: 'northline', color: '#3b8cff' },
    { id: 'linea_norte', name: 'Línea Norte (a High Sanctuary)', mode: 'northline', color: '#3ddc84' },
    { id: 'linea_oeste', name: 'Línea Oeste (a Westwall)', mode: 'northline', color: '#f2c94c' },
    { id: 'linea_este', name: 'Línea Este (a Heartstone)', mode: 'northline', color: '#ef4b4b' },
    { id: 'linea_comercial', name: 'Línea Comercial (a Market Bridge)', mode: 'northline', color: '#ff9f1c' }
  ];

  // Conexiones: son DATOS (de dónde a dónde, modo, distancia y tiempo), no líneas decorativas. `distanceKm` y `minutes` en null se calculan del trazado y de la velocidad del modo.
  const link = (id, name, mode, from, to, path = [], extra = {}) => map.links.push({ id, name, mode, from, to, minutes: null, cost: 0, requires: [], distanceKm: null, path: km(path), line: null, twoWay: true, ...extra });
  link('nl_capital_porta_magna', 'Línea Capital: Northfortress – Porta Magna', 'northline', 'northfortress_capital', 'porta_magna_station', [], { line: 'linea_capital', cost: 1 });
  link('nl_capital_heartstone', 'Línea Este: Northfortress – Heartstone', 'northline', 'northfortress_capital', 'heartstone', [[3, 7], [8, 11.5]], { line: 'linea_este', distanceKm: 20, cost: 2 });
  link('nl_porta_magna_westwall', 'Línea Oeste: Porta Magna – Westwall', 'northline', 'porta_magna_station', 'westwall', [[-22, 10], [-48, 13], [-74, 11], [-102, 8]], { line: 'linea_oeste', cost: 8 });
  link('nl_capital_high_sanctuary', 'Línea Norte: Northfortress – High Sanctuary', 'northline', 'northfortress_capital', 'high_sanctuary', [[-4, -18], [-8, -38], [-4, -56], [1, -69]], { line: 'linea_norte', cost: 6 });
  link('nl_porta_magna_market_bridge', 'Línea Comercial: Porta Magna – Market Bridge', 'northline', 'porta_magna_station', 'market_bridge', [[10, 5], [16.5, -5], [20.5, -21]], { line: 'linea_comercial', cost: 4 });
  link('rail_market_bridge_capital', 'Ferrocarril de carga: Market Bridge – Northfortress', 'rail', 'market_bridge', 'northfortress_capital', [[20, -27], [10.5, -14]], { cost: 0 });
  link('road_capital_heartstone', 'Carretera de Heartstone', 'road', 'northfortress_capital', 'heartstone', [[4, 9], [9.5, 13]], { cost: 0 });
  link('road_capital_market_bridge', 'Carretera del Puente', 'road', 'northfortress_capital', 'market_bridge', [[7, -14], [17, -26]], { cost: 0 });
  link('road_capital_westwall', 'Carretera del Oeste', 'road', 'northfortress_capital', 'westwall', [[-18, 3], [-46, 3], [-74, 3], [-104, 4]], { cost: 0 });
  link('path_capital_high_sanctuary', 'Camino de los peregrinos (prov.)', 'path', 'northfortress_capital', 'high_sanctuary', [[-8, -20], [-13, -40], [-7, -60], [0, -70]], { cost: 0 });
  link('path_market_bridge_high_sanctuary', 'Camino de la cordillera (prov.)', 'path', 'market_bridge', 'high_sanctuary', [[24, -48], [17, -62], [9, -72]], { cost: 0 });
  link('road_market_bridge_port', 'Muelles de Market Bridge', 'road', 'market_bridge', 'market_bridge_port', [], { cost: 0 });
  link('trade_westwall_gate_west', 'Ruta de caravanas (prov.)', 'trade', 'westwall', 'gate_west', [[-142, 5], [-154, 0]], { cost: 6 });
  link('sea_market_bridge_arkaleon', 'Ruta marítima a Arkaleon', 'sea', 'market_bridge_port', 'gate_arkaleon', [[36, -33], [50, -29], [62, -27]], { cost: 15 });
  link('trade_market_bridge_westwall', 'Gran ruta comercial del norte (prov.)', 'trade', 'market_bridge', 'westwall', [[10, -43], [-20, -36], [-60, -30], [-100, -14], [-118, -2]], { cost: 12 });

  // Decoración y etiquetas
  const decor = (id, kind, [x, y], extra = {}) => map.decor.push({ id, name: '', kind, x: m(x), y: m(y), size: undefined, rotation: 0, group: 'adornos', ...extra });
  decor('rosa_vientos', 'compass', [-188, -92], { size: 34000 });
  decor('barco_1', 'ship', [24, 72], { size: 9000, rotation: -8 }); decor('barco_2', 'ship', [74, 12], { size: 8000, rotation: 12 }); decor('barco_3', 'ship', [-70, 78], { size: 8000, rotation: 4 });
  decor('faro_puerto', 'tower', [36.5, -39], { size: 5200 });
  decor('ruinas_fabricas', 'ruins', [8.8, 18.5], { size: 3600 }); decor('ruinas_muelle', 'ruins', [17.8, 24.5], { size: 3000 });
  decor('etq_mar', 'label', [-60, 90], { name: 'Mar Meridional (prov.)', size: 9500 });
  decor('etq_golfo', 'label', [78, -4], { name: 'Golfo oriental (prov.)', size: 6200, rotation: 80 });
  decor('etq_cordillera', 'label', [-52, -77], { name: 'Cordillera Sagrada (prov.)', size: 6200, rotation: -17 });
  decor('etq_desierto', 'label', [-110, -18], { name: 'Desierto occidental (prov.)', size: 5200, rotation: -78 });
  decor('etq_llanuras', 'label', [-48, 24], { name: 'Llanuras (prov.)', size: 4200, rotation: -2 });
  decor('etq_bahia', 'label', [-14, 30], { name: 'Bahía (prov.)', size: 2800, rotation: -62 });

  return normalizeMap(map);
}

// --- Guardar y comprobar ---------------------------------------------------------------------------------------------------------------------------------
const map = buildMap();
const store = createMapStore({ dir: path.join(root, 'data/canon/maps'), assetDir: path.join(root, 'assets/maps') });
const result = validateMap(map, { takenIds: await store.takenIds(MAP_ID) });
if (!result.ok) { console.error('El mapa no es válido:\n' + result.errors.map((e) => ` - ${e.message}`).join('\n')); process.exit(1); }
await store.save(MAP_ID, map, {});
console.log(`Guardado ${MAP_ID}: ${map.places.length} lugares, ${map.links.length} enlaces, ${map.areas.length} áreas, ${map.ways.length} caminos, ${map.districts.length} distritos, ${map.decor.length} elementos decorativos.`);
console.log(`Terreno: ${Object.keys(map.terrain.chunks).length} trozos.`);
for (const warning of result.warnings) console.log(`  aviso: ${warning.message}`);
const index = placeIndex(map);
for (const link of map.links) console.log(`  ${link.id.padEnd(36)} ${String(linkKm(map, link, index)?.toFixed(1)).padStart(6)} km  ${formatDuration(linkMinutes(map, link, index))}`);
const trip = planTrip(map, 'northfortress_capital', 'heartstone');
console.log('Northfortress Capital → Heartstone:', trip.options.map((o) => `${o.label}: ${o.km.toFixed(1)} km, ${formatDuration(o.minutes)}`).join(' | '));
