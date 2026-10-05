// Esquema del mapa v2 (canon): normalización y validación. Módulo compartido: lo usan el editor (navegador) y el motor (Node), así que lo que el
// editor da por bueno es exactamente lo que el motor acepta. Funciones puras.
//
// El mapa es un conjunto de DATOS en METROS (no una imagen): áreas (terreno y zonas urbanas con una receta de relleno), caminos (calles, ríos,
// murallas…), distritos de juego (con niebla), lugares visitables, enlaces escritos a mano, grupos que se pueden bloquear y capas de calco
// opcionales. Los edificios y los árboles NO se guardan: los genera un algoritmo con semilla a partir de la receta de cada área.
import { ID_PATTERN, round, districtAt, polygonArea, polygonSelfIntersects, polygonsOverlap, polylineLength, boundsOf, mergeBounds, growBounds } from './geo.js';
import { THEME_IDS, sanitizePost } from './mapStyle.js';
import { decodeChunk, encodeChunk, terrainBoundsOf, TERRAIN_LIMITS, TERRAIN_DEFAULTS } from './mapTerrain.js';
import { AREA_KINDS, WAY_KINDS, FILL_PATTERNS, AREA_Z, WAY_Z, WAY_WIDTH, WAY_WIDTH_RANGE, FILL_DEFAULTS, FILL_RANGE, MAP_LIMITS } from './mapDefaults.js';

export const SCHEMA_VERSION = 2;
export const PLACE_KINDS = ['home', 'food', 'shop', 'poi', 'transport', 'gateway', 'other'];
export const ACCESS = ['public', 'private', 'restricted'];
export const DISCOVERY = ['hidden', 'rumor', 'known'];
export const LINK_MODES = ['metro', 'ferry', 'train', 'other'];
// Requisitos de acceso: tipos cerrados que valida el motor. El modelo nunca concede uno.
export const REQUIREMENT_TYPES = ['escort', 'invitation', 'story_flag', 'knows_place', 'money'];

export const LIMITS = MAP_LIMITS;
export const MIN_AREA_M2 = 25;         // un área menor es un punto
export const MIN_DISTRICT_M2 = 1000;   // un distrito de juego menor de 0,1 ha no tiene sentido
export const MIN_PLACE_GAP = 3;        // dos lugares a menos de 3 m son el mismo punto
const IMAGE_FILE = /^[a-z0-9_]+\.(webp|png|jpg)$/;
const MAX_SEED = 2147483647;

const text = (value, max) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const longText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const list = (value, max, length) => (Array.isArray(value) ? value.map((item) => text(item, length)).filter(Boolean).slice(0, max) : []);
const number = (value) => (value === null || value === undefined || value === '' ? NaN : Number(value));
const coord = (value) => round(number(value), 1);
const point = (value) => (Array.isArray(value) ? [coord(value[0]), coord(value[1])] : [NaN, NaN]);
const optionalText = (value, max) => text(value, max) || null;

export function emptyMap(id, name = '') {
  return {
    schemaVersion: SCHEMA_VERSION, id, name, units: 'm', style: { theme: 'default' }, underlays: [], areas: [], ways: [], districts: [], places: [], links: [], groups: [], terrain: null, publish: null
  };
}

// Convierte un mapa del esquema v1 (coordenadas normalizadas sobre una imagen) a v2 (metros): la imagen pasa a ser una capa de calco en el
// origen y cada punto se multiplica por el tamaño real de la imagen. Sin escala calibrada se asumen 2 m por píxel.
export function migrateV1(input) {
  const mpp = number(input.scale?.metersPerPixel) > 0 ? number(input.scale.metersPerPixel) : 2;
  const width = Number(input.image?.width) || 0; const height = Number(input.image?.height) || 0;
  const X = (nx) => nx * width * mpp; const Y = (ny) => ny * height * mpp;
  return {
    ...input, schemaVersion: SCHEMA_VERSION,
    underlays: input.image?.file ? [{ id: 'base', file: input.image.file, width, height, x: 0, y: 0, metersPerPixel: mpp, opacity: 1, visible: true }] : [],
    districts: (input.districts ?? []).map((district) => ({ ...district, polygon: (district.polygon ?? []).map(([x, y]) => [X(x), Y(y)]) })),
    places: (input.places ?? []).map((place) => ({ ...place, x: X(place.x), y: Y(place.y) })),
    areas: [], ways: [], groups: []
  };
}

// Terreno pintado: parámetros y trozos comprimidos (src/shared/mapTerrain.js). Un trozo ilegible se conserva tal cual para que la validación lo señale en vez de perderlo en silencio.
function normalizeTerrain(input) {
  if (!input || typeof input !== 'object') return null;
  const chunks = {};
  for (const [key, value] of Object.entries(input.chunks && typeof input.chunks === 'object' ? input.chunks : {}).slice(0, TERRAIN_LIMITS.chunks + 1)) {
    if (!/^-?\d{1,5},-?\d{1,5}$/.test(key) || typeof value !== 'string') continue;
    const cells = decodeChunk(value);
    if (!cells) chunks[key] = value.slice(0, 120); else if (cells.some((code) => code)) chunks[key] = encodeChunk(cells);
  }
  const sorted = Object.fromEntries(Object.entries(chunks).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })));
  const pick = (value, fallback, digits) => (value === undefined || value === null || value === '' ? fallback : round(number(value), digits));
  return {
    cell: pick(input.cell, TERRAIN_DEFAULTS.cell, 1), seed: Math.round(pick(input.seed, TERRAIN_DEFAULTS.seed, 0)),
    forest: { spacing: pick(input.forest?.spacing, TERRAIN_DEFAULTS.forest.spacing, 1), density: pick(input.forest?.density, TERRAIN_DEFAULTS.forest.density, 2) },
    chunks: sorted
  };
}

// --- Normalización -------------------------------------------------------------------------------------------------------------------------------
function normalizeFill(fill) {
  if (!fill || typeof fill !== 'object') return null;
  const pattern = FILL_PATTERNS.includes(fill.pattern) ? fill.pattern : 'none';
  const base = FILL_DEFAULTS[pattern];
  if (pattern === 'none') return { pattern };
  const pick = (value, fallback) => (value === undefined ? fallback : number(value));
  const seed = Math.round(pick(fill.seed, base.seed));
  if (pattern === 'forest') return { pattern, seed, treeSpacing: round(pick(fill.treeSpacing, base.treeSpacing), 1), density: round(pick(fill.density, base.density), 2) };
  const out = {
    pattern, seed,
    blockSize: { min: round(pick(fill.blockSize?.min, base.blockSize.min), 1), max: round(pick(fill.blockSize?.max, base.blockSize.max), 1) },
    lotSize: { width: round(pick(fill.lotSize?.width, base.lotSize.width), 1), depth: round(pick(fill.lotSize?.depth, base.lotSize.depth), 1) },
    density: round(pick(fill.density, base.density), 2), streetWidth: round(pick(fill.streetWidth, base.streetWidth), 1), rotation: round(pick(fill.rotation, base.rotation), 1)
  };
  if (pattern === 'radial') {
    out.center = Array.isArray(fill.center) ? [coord(fill.center[0]), coord(fill.center[1])] : [...base.center];
    out.rings = Math.round(pick(fill.rings, base.rings)); out.spokes = Math.round(pick(fill.spokes, base.spokes));
  }
  return out;
}

function requirement(item) {
  const type = text(item?.type, 20);
  const base = { type };
  if (type === 'escort') return { ...base, npcId: text(item?.npcId, 41) };
  if (type === 'story_flag') return { ...base, flag: text(item?.flag, 60) };
  if (type === 'knows_place') return { ...base, place: text(item?.place, 41) };
  if (type === 'money') return { ...base, amount: Math.round(number(item?.amount)) };
  return base;
}

// Limpia lo que llega (del editor o de un archivo) y le da su forma y orden estables. No «arregla» valores inválidos: eso lo señala `validateMap`.
// Acepta mapas del esquema v1 y los convierte.
export function normalizeMap(source = {}) {
  const input = Number(source.schemaVersion) === 1 ? migrateV1(source) : source;
  const array = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);
  const polygon = (value) => array(value, LIMITS.vertices).map(point);

  const underlays = array(input.underlays, LIMITS.underlays).map((item) => ({
    id: text(item?.id, 41), file: text(item?.file, 80), width: Math.round(number(item?.width)) || 0, height: Math.round(number(item?.height)) || 0,
    x: coord(item?.x ?? 0), y: coord(item?.y ?? 0), metersPerPixel: round(number(item?.metersPerPixel), 6), opacity: round(item?.opacity === undefined ? 1 : number(item.opacity), 2), visible: item?.visible !== false
  }));
  const areas = array(input.areas, LIMITS.areas).map((area) => {
    const kind = text(area?.kind, 12) || 'land';
    return {
      id: text(area?.id, 41), name: text(area?.name, 60), kind, polygon: polygon(area?.polygon),
      z: Number.isFinite(number(area?.z)) ? Math.round(number(area.z)) : (AREA_Z[kind] ?? 0), fill: normalizeFill(area?.fill), group: optionalText(area?.group, 41)
    };
  });
  const ways = array(input.ways, LIMITS.ways).map((way) => {
    const kind = text(way?.kind, 12) || 'street';
    return {
      id: text(way?.id, 41), name: text(way?.name, 60), kind, points: polygon(way?.points),
      width: round(way?.width === undefined ? (WAY_WIDTH[kind] ?? 8) : number(way.width), 1),
      z: Number.isFinite(number(way?.z)) ? Math.round(number(way.z)) : (WAY_Z[kind] ?? 10), group: optionalText(way?.group, 41)
    };
  });
  const districts = array(input.districts, LIMITS.districts).map((district) => ({
    id: text(district?.id, 41), name: text(district?.name, 60), color: /^#[0-9a-f]{6}$/i.test(district?.color ?? '') ? district.color.toLowerCase() : '#c9a45c',
    polygon: polygon(district?.polygon), fog: text(district?.fog, 10) || 'hidden', allowPlayerPlaces: district?.allowPlayerPlaces === true, group: optionalText(district?.group, 41)
  }));
  const places = array(input.places, LIMITS.places).map((place) => {
    const x = coord(place?.x); const y = coord(place?.y);
    const hours = place?.hours && typeof place.hours === 'object' ? { open: Number(place.hours.open), close: Number(place.hours.close) } : null;
    const footprint = place?.footprint && typeof place.footprint === 'object' ? { width: round(number(place.footprint.width), 1), depth: round(number(place.footprint.depth), 1), rotation: round(number(place.footprint.rotation ?? 0), 1) } : null;
    return {
      id: text(place?.id, 41), name: text(place?.name, 60), aliases: list(place?.aliases, 8, 60), kind: text(place?.kind, 20) || 'other', x, y,
      district: Number.isFinite(x) && Number.isFinite(y) ? districtAt({ x, y }, districts)?.id ?? null : null, // derivado: lo calcula el motor, no se edita
      access: text(place?.access, 12) || 'public', hours, tags: list(place?.tags, 12, 30), description: longText(place?.description, 600),
      discovery: text(place?.discovery, 10) || 'known', owner: optionalText(place?.owner, 41), footprint, group: optionalText(place?.group, 41),
      requires: array(place?.requires, 6).map(requirement)
    };
  });
  const links = array(input.links, LIMITS.links).map((link) => ({
    id: text(link?.id, 41), name: text(link?.name, 60), mode: text(link?.mode, 12) || 'other', from: text(link?.from, 41), to: text(link?.to, 41),
    minutes: Math.round(number(link?.minutes)), cost: round(Number.isFinite(number(link?.cost)) ? number(link.cost) : 0, 2), requires: array(link?.requires, 6).map(requirement)
  }));
  const groups = array(input.groups, LIMITS.groups).map((group) => ({ id: text(group?.id, 41), name: text(group?.name, 60), parent: optionalText(group?.parent, 41), locked: group?.locked === true, baked: optionalText(group?.baked, 80) }));
  const publish = input.publish && typeof input.publish === 'object' ? {
    version: Math.round(number(input.publish.version)), builtAt: text(input.publish.builtAt, 40), sourceHash: text(input.publish.sourceHash, 80), format: text(input.publish.format, 8) || 'webp',
    tileSize: Math.round(number(input.publish.tileSize)), minZoom: Math.round(number(input.publish.minZoom)), maxZoom: Math.round(number(input.publish.maxZoom)),
    bounds: input.publish.bounds ? { minX: coord(input.publish.bounds.minX), minY: coord(input.publish.bounds.minY), maxX: coord(input.publish.bounds.maxX), maxY: coord(input.publish.bounds.maxY) } : null
  } : null;
  return {
    schemaVersion: SCHEMA_VERSION, id: text(input.id, 41), name: text(input.name, 60), units: 'm', style: { theme: text(input.style?.theme, 32) || 'default', ...(sanitizePost(input.style?.post) ? { post: sanitizePost(input.style.post) } : {}) },
    underlays, areas, ways, districts, places, links, groups, terrain: normalizeTerrain(input.terrain), publish
  };
}

// --- Grupos: un grupo bloqueado (o dentro de otro bloqueado) no recibe cambios ----------------------------------------------------------------------
export function groupChain(map, groupId) {
  const chain = []; const seen = new Set();
  let current = groupId ? map.groups.find((group) => group.id === groupId) : null;
  while (current && !seen.has(current.id)) { chain.push(current); seen.add(current.id); current = current.parent ? map.groups.find((group) => group.id === current.parent) : null; }
  return chain;
}
// ¿Está bloqueado un elemento (área, camino, distrito, lugar)? Lo está si su grupo, o alguno de sus ancestros, lo está. Devuelve el grupo que bloquea o null.
export const lockedBy = (map, element) => groupChain(map, element?.group).find((group) => group.locked) ?? null;

// Caja que contiene todo el mapa (con un margen que cubre la anchura de las líneas y de las capas de calco). null si está vacío.
export function mapBounds(map) {
  let box = null;
  for (const area of map.areas) box = mergeBounds(box, boundsOf(area.polygon.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))));
  for (const district of map.districts) box = mergeBounds(box, boundsOf(district.polygon.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))));
  const widest = map.ways.reduce((max, way) => Math.max(max, Number.isFinite(way.width) ? way.width : 0), 0);
  for (const way of map.ways) box = mergeBounds(box, growBounds(boundsOf(way.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))), widest / 2));
  box = mergeBounds(box, boundsOf(map.places.filter((place) => Number.isFinite(place.x) && Number.isFinite(place.y)).map((place) => [place.x, place.y])));
  for (const item of map.underlays) if (item.width > 0 && item.metersPerPixel > 0) box = mergeBounds(box, { minX: item.x, minY: item.y, maxX: item.x + item.width * item.metersPerPixel, maxY: item.y + item.height * item.metersPerPixel });
  return mergeBounds(box, terrainBoundsOf(map.terrain));
}

// --- Validación ----------------------------------------------------------------------------------------------------------------------------------
const finite = (value) => Number.isFinite(value);
const inRange = (value) => finite(value) && Math.abs(value) <= LIMITS.coordinate;
const pointsOk = (points) => points.every(([x, y]) => inRange(x) && inRange(y));

// Valida un mapa ya normalizado. `context` aporta lo que el mapa no sabe por sí solo:
//   takenIds: ids de lugares y enlaces de OTROS mapas (los ids son únicos en todo el juego)
//   npcIds:   ids de los NPC existentes · refs: [{ npcId, placeId, where }] lugares que usan sus fichas · legacyIds: ids de la lista provisional anterior
// Devuelve { errors, warnings, ok }. Los errores impiden guardar; los avisos no.
export function validateMap(map, context = {}) {
  const { takenIds = new Set(), npcIds = null, refs = [], legacyIds = new Set() } = context;
  const errors = []; const warnings = [];
  const add = (target, code, message, ref) => target.push({ code, message, ...(ref ? { ref } : {}) });
  const error = (code, message, ref) => add(errors, code, message, ref);
  const warn = (code, message, ref) => add(warnings, code, message, ref);
  const unique = (ids, id, code, label, ref) => {
    if (!ID_PATTERN.test(id)) { error(`${code}_id`, `${label} «${ref.name || id || '?'}» necesita un id válido (minúsculas, números y guiones bajos).`, ref); return false; }
    if (ids.has(id)) { error(`${code}_duplicate`, `El id «${id}» está repetido (${label.toLowerCase()}).`, ref); return false; }
    ids.add(id); return true;
  };

  if (!ID_PATTERN.test(map.id)) error('map_id', 'El id del mapa debe usar minúsculas, números y guiones bajos (empieza con letra).', { type: 'map', id: map.id });
  if (!map.name) error('map_name', 'El mapa necesita un nombre.', { type: 'map', id: map.id });
  if (!THEME_IDS.includes(map.style.theme)) warn('style_theme', `El estilo «${map.style.theme}» no existe: se verá con el del editor (disponibles: ${THEME_IDS.join(', ')}).`, { type: 'map', id: map.id });

  const underlayIds = new Set();
  map.underlays.forEach((item, index) => {
    const ref = { type: 'underlay', id: item.id || `#${index + 1}` };
    unique(underlayIds, item.id, 'underlay', 'La capa de calco', ref);
    if (!IMAGE_FILE.test(item.file)) error('underlay_file', `La capa de calco «${item.id}» no tiene imagen (png, webp o jpg).`, ref);
    else if (!(item.width > 0 && item.height > 0 && item.width <= 20000 && item.height <= 20000)) error('underlay_size', `El tamaño de la imagen de «${item.id}» no es válido.`, ref);
    if (!(item.metersPerPixel > 0)) error('underlay_scale', `La capa de calco «${item.id}» necesita una escala (metros por píxel) mayor que 0.`, ref);
    if (!inRange(item.x) || !inRange(item.y)) error('underlay_position', `La posición de la capa de calco «${item.id}» no es válida.`, ref);
    if (!(item.opacity >= 0 && item.opacity <= 1)) error('underlay_opacity', `La opacidad de «${item.id}» debe estar entre 0 y 1.`, ref);
  });

  const polygonProblems = (polygon, label, ref, minArea) => {
    if (polygon.length < 3) { error('polygon_few', `${label} necesita al menos 3 vértices.`, ref); return false; }
    if (!pointsOk(polygon)) { error('polygon_range', `${label} tiene vértices con coordenadas no válidas.`, ref); return false; }
    if (polygonArea(polygon) < minArea) error('polygon_tiny', `${label} es casi un punto (menos de ${minArea} m²).`, ref);
    if (polygonSelfIntersects(polygon)) error('polygon_crossed', `El contorno de ${label.toLowerCase()} se cruza consigo mismo.`, ref);
    return true;
  };

  const districtIds = new Set();
  map.districts.forEach((district, index) => {
    const ref = { type: 'district', id: district.id || `#${index + 1}`, name: district.name };
    unique(districtIds, district.id, 'district', 'El distrito', ref);
    if (!district.name) error('district_name', `El distrito «${district.id}» necesita un nombre.`, ref);
    if (!DISCOVERY.includes(district.fog)) error('district_fog', `El distrito «${district.id}» tiene un estado de niebla desconocido.`, ref);
    polygonProblems(district.polygon, `El distrito «${district.id}»`, ref, MIN_DISTRICT_M2);
  });
  const sound = map.districts.filter((district) => district.polygon.length >= 3 && pointsOk(district.polygon));
  for (let i = 0; i < sound.length; i++) for (let j = i + 1; j < sound.length; j++) {
    if (polygonsOverlap(sound[i].polygon, sound[j].polygon)) warn('districts_overlap', `Los distritos «${sound[i].id}» y «${sound[j].id}» se solapan.`, { type: 'district', id: sound[i].id });
  }

  const areaIds = new Set();
  map.areas.forEach((area, index) => {
    const ref = { type: 'area', id: area.id || `#${index + 1}`, name: area.name };
    unique(areaIds, area.id, 'area', 'El área', ref);
    if (!AREA_KINDS.includes(area.kind)) error('area_kind', `El área «${area.id}» tiene un tipo desconocido («${area.kind}»).`, ref);
    polygonProblems(area.polygon, `El área «${area.id}»`, ref, MIN_AREA_M2);
    if (area.fill) fillIssues(area, ref);
  });
  function fillIssues(area, ref) {
    const fill = area.fill; const where = `El relleno del área «${area.id}»`;
    if (fill.pattern === 'none') return;
    if (!Number.isInteger(fill.seed) || fill.seed < 0 || fill.seed > MAX_SEED) error('fill_seed', `${where} necesita una semilla entera entre 0 y ${MAX_SEED}.`, ref);
    if (!(fill.density >= 0 && fill.density <= 1)) error('fill_density', `${where} necesita una densidad entre 0 y 1.`, ref);
    if (fill.pattern === 'forest') {
      if (!(fill.treeSpacing > 0)) error('fill_value', `${where} necesita una separación entre árboles mayor que 0.`, ref);
      else if (fill.treeSpacing < FILL_RANGE.treeSpacing[0] || fill.treeSpacing > FILL_RANGE.treeSpacing[1]) warn('fill_range', `${where}: la separación entre árboles (${fill.treeSpacing} m) se sale de lo habitual (${FILL_RANGE.treeSpacing.join('–')} m).`, ref);
      if (!['forest', 'park', 'field', 'mountain', 'land'].includes(area.kind)) warn('fill_kind', `${where}: poner árboles en un área de tipo «${area.kind}» es raro.`, ref);
      return;
    }
    const { blockSize, lotSize } = fill;
    if (!(blockSize.min > 0 && blockSize.max >= blockSize.min)) error('fill_value', `${where}: el tamaño de manzana necesita mínimo > 0 y máximo ≥ mínimo.`, ref);
    else if (blockSize.min < FILL_RANGE.blockSize[0] || blockSize.max > FILL_RANGE.blockSize[1]) warn('fill_range', `${where}: manzanas de ${blockSize.min}–${blockSize.max} m se salen de lo habitual (${FILL_RANGE.blockSize.join('–')} m).`, ref);
    if (!(lotSize.width > 0 && lotSize.depth > 0)) error('fill_value', `${where}: la parcela necesita ancho y fondo mayores que 0.`, ref);
    else if (lotSize.width < FILL_RANGE.lotWidth[0] || lotSize.width > FILL_RANGE.lotWidth[1] || lotSize.depth < FILL_RANGE.lotDepth[0] || lotSize.depth > FILL_RANGE.lotDepth[1]) warn('fill_range', `${where}: parcelas de ${lotSize.width}×${lotSize.depth} m se salen de lo habitual.`, ref);
    if (!(fill.streetWidth > 0)) error('fill_value', `${where} necesita una anchura de calle mayor que 0.`, ref);
    else if (fill.streetWidth < FILL_RANGE.streetWidth[0] || fill.streetWidth > FILL_RANGE.streetWidth[1]) warn('fill_range', `${where}: calles de ${fill.streetWidth} m se salen de lo habitual (${FILL_RANGE.streetWidth.join('–')} m).`, ref);
    if (!finite(fill.rotation)) error('fill_value', `${where} necesita una rotación numérica.`, ref);
    if (!['urban', 'plaza', 'land', 'field'].includes(area.kind)) warn('fill_kind', `${where}: rellenar de casas un área de tipo «${area.kind}» es raro.`, ref);
    if (fill.pattern === 'radial') {
      if (!(Array.isArray(fill.center) && fill.center.every(inRange))) error('fill_value', `${where} necesita un centro válido.`, ref);
      if (!(Number.isInteger(fill.rings) && fill.rings >= 1 && fill.rings <= 30)) error('fill_value', `${where}: los anillos deben ser un entero entre 1 y 30.`, ref);
      if (!(Number.isInteger(fill.spokes) && fill.spokes >= 3 && fill.spokes <= 64)) error('fill_value', `${where}: los radios deben ser un entero entre 3 y 64.`, ref);
    }
  }

  const wayIds = new Set();
  map.ways.forEach((way, index) => {
    const ref = { type: 'way', id: way.id || `#${index + 1}`, name: way.name };
    unique(wayIds, way.id, 'way', 'El camino', ref);
    if (!WAY_KINDS.includes(way.kind)) error('way_kind', `El camino «${way.id}» tiene un tipo desconocido («${way.kind}»).`, ref);
    if (way.points.length < 2) error('way_few', `El camino «${way.id}» necesita al menos 2 puntos.`, ref);
    else if (!pointsOk(way.points)) error('way_range', `El camino «${way.id}» tiene puntos con coordenadas no válidas.`, ref);
    else if (polylineLength(way.points) < 1) error('way_short', `El camino «${way.id}» mide menos de 1 m.`, ref);
    if (!(way.width > 0)) error('way_width', `La anchura del camino «${way.id}» debe ser mayor que 0.`, ref);
    else if (WAY_WIDTH_RANGE[way.kind] && (way.width < WAY_WIDTH_RANGE[way.kind][0] || way.width > WAY_WIDTH_RANGE[way.kind][1])) warn('way_width_range', `El camino «${way.id}» (${way.kind}) mide ${way.width} m de ancho; lo habitual es ${WAY_WIDTH_RANGE[way.kind].join('–')} m.`, ref);
  });

  const allPlaceIds = new Set(map.places.map((place) => place.id));
  const knownPlace = (id) => allPlaceIds.has(id) || takenIds.has(id);
  const placeIds = new Set();
  map.places.forEach((place, index) => {
    const ref = { type: 'place', id: place.id || `#${index + 1}`, name: place.name };
    if (!ID_PATTERN.test(place.id)) error('place_id', `El lugar «${place.name || ref.id}» necesita un id válido (minúsculas, números y guiones bajos).`, ref);
    else if (placeIds.has(place.id)) error('place_duplicate', `El id de lugar «${place.id}» está repetido en este mapa.`, ref);
    else if (takenIds.has(place.id)) error('id_taken', `El id «${place.id}» ya lo usa otro mapa: los ids son únicos en todo el juego.`, ref);
    placeIds.add(place.id);
    if (!place.name) error('place_name', `El lugar «${place.id}» necesita un nombre.`, ref);
    if (!inRange(place.x) || !inRange(place.y)) error('place_position', `El lugar «${place.id}» tiene una posición no válida.`, ref);
    if (!PLACE_KINDS.includes(place.kind)) error('place_kind', `El lugar «${place.id}» tiene un tipo desconocido («${place.kind}»).`, ref);
    if (!ACCESS.includes(place.access)) error('place_access', `El lugar «${place.id}» tiene un acceso desconocido («${place.access}»).`, ref);
    if (!DISCOVERY.includes(place.discovery)) error('place_discovery', `El lugar «${place.id}» tiene un estado de descubrimiento desconocido.`, ref);
    if (place.hours && !(Number.isInteger(place.hours.open) && Number.isInteger(place.hours.close) && place.hours.open >= 0 && place.hours.close <= 24 && place.hours.open < place.hours.close)) error('place_hours', `El horario de «${place.id}» no es válido (abre < cierra, de 0 a 24).`, ref);
    if (place.footprint && !(place.footprint.width > 0 && place.footprint.width <= 200 && place.footprint.depth > 0 && place.footprint.depth <= 200 && finite(place.footprint.rotation))) error('place_footprint', `La parcela de «${place.id}» no es válida (ancho y fondo entre 0 y 200 m).`, ref);
    if (map.districts.length && !place.district && inRange(place.x) && inRange(place.y)) warn('place_outside', `El lugar «${place.id}» no está dentro de ningún distrito.`, ref);
    if (place.owner && npcIds && !npcIds.has(place.owner)) warn('place_owner', `El dueño «${place.owner}» de «${place.id}» no es un personaje existente.`, ref);
    for (const need of place.requires) requirementIssues(need, `lugar «${place.id}»`, ref);
  });
  const placed = map.places.filter((place) => inRange(place.x) && inRange(place.y));
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    if (Math.hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y) < MIN_PLACE_GAP) warn('places_overlap', `Los lugares «${placed[i].id}» y «${placed[j].id}» están en el mismo punto.`, { type: 'place', id: placed[i].id });
  }

  const linkIds = new Set();
  map.links.forEach((link, index) => {
    const ref = { type: 'link', id: link.id || `#${index + 1}`, name: link.name };
    if (!ID_PATTERN.test(link.id)) error('link_id', `El enlace «${link.name || ref.id}» necesita un id válido.`, ref);
    else if (linkIds.has(link.id) || allPlaceIds.has(link.id) || takenIds.has(link.id)) error('link_duplicate', `El id de enlace «${link.id}» ya está en uso.`, ref);
    linkIds.add(link.id);
    if (!LINK_MODES.includes(link.mode)) error('link_mode', `El enlace «${link.id}» tiene un modo desconocido.`, ref);
    if (!knownPlace(link.from) || !knownPlace(link.to)) error('link_endpoint', `El enlace «${link.id}» une lugares que no existen («${link.from}» → «${link.to}»).`, ref);
    if (!Number.isInteger(link.minutes) || link.minutes < 1 || link.minutes > 10080) error('link_minutes', `La duración del enlace «${link.id}» debe estar entre 1 minuto y 7 días.`, ref);
    if (!(link.cost >= 0)) error('link_cost', `El costo del enlace «${link.id}» no puede ser negativo.`, ref);
    for (const need of link.requires) requirementIssues(need, `enlace «${link.id}»`, ref);
  });

  function requirementIssues(need, where, ref) {
    if (!REQUIREMENT_TYPES.includes(need.type)) { error('requirement_type', `Requisito desconocido en el ${where}.`, ref); return; }
    if (need.type === 'escort' && !need.npcId) error('requirement_escort', `El requisito «escort» del ${where} necesita un personaje.`, ref);
    if (need.type === 'escort' && need.npcId && npcIds && !npcIds.has(need.npcId)) warn('requirement_npc', `El personaje «${need.npcId}» (${where}) no existe.`, ref);
    if (need.type === 'story_flag' && !need.flag) error('requirement_flag', `El requisito «story_flag» del ${where} necesita un nombre de hito.`, ref);
    if (need.type === 'knows_place' && !knownPlace(need.place)) error('requirement_place', `El requisito «knows_place» del ${where} apunta a un lugar que no existe.`, ref);
    if (need.type === 'money' && !(need.amount >= 1)) error('requirement_money', `El requisito «money» del ${where} necesita una cantidad mayor que 0.`, ref);
  }

  // Grupos: ids únicos, padres que existen, sin ciclos, y elementos que apuntan a un grupo real.
  const groupIds = new Set(map.groups.map((group) => group.id));
  const seenGroups = new Set();
  map.groups.forEach((group, index) => {
    const ref = { type: 'group', id: group.id || `#${index + 1}`, name: group.name };
    unique(seenGroups, group.id, 'group', 'El grupo', ref);
    if (!group.name) error('group_name', `El grupo «${group.id}» necesita un nombre.`, ref);
    if (group.parent && !groupIds.has(group.parent)) error('group_parent', `El grupo «${group.id}» tiene un padre que no existe («${group.parent}»).`, ref);
    else if (group.parent) {
      const seen = new Set([group.id]); let current = group.parent; let loops = false;
      while (current) { if (seen.has(current)) { loops = true; break; } seen.add(current); current = map.groups.find((item) => item.id === current)?.parent ?? null; }
      if (loops) error('group_cycle', `El grupo «${group.id}» forma un ciclo con sus padres.`, ref);
    }
    if (group.baked && !/^[a-z0-9_.-]+\.json$/.test(group.baked)) error('group_baked', `El archivo de edificios congelados de «${group.id}» no es válido.`, ref);
  });
  const members = new Map();
  for (const [type, items] of [['area', map.areas], ['way', map.ways], ['district', map.districts], ['place', map.places]]) {
    for (const item of items) {
      if (!item.group) continue;
      if (!groupIds.has(item.group)) error('group_missing', `${type === 'place' ? 'El lugar' : type === 'area' ? 'El área' : type === 'way' ? 'El camino' : 'El distrito'} «${item.id}» pertenece a un grupo que no existe («${item.group}»).`, { type, id: item.id });
      members.set(item.group, (members.get(item.group) ?? 0) + 1);
    }
  }
  for (const group of map.groups) {
    const hasChild = map.groups.some((other) => other.parent === group.id);
    if (!members.has(group.id) && !hasChild) warn('group_empty', `El grupo «${group.id}» está vacío.`, { type: 'group', id: group.id });
  }

  if (map.terrain) {
    const t = map.terrain; const where = { type: 'map', id: map.id };
    if (!(t.cell >= TERRAIN_LIMITS.cell[0] && t.cell <= TERRAIN_LIMITS.cell[1])) error('terrain_cell', `El tamaño de celda del terreno debe estar entre ${TERRAIN_LIMITS.cell[0]} y ${TERRAIN_LIMITS.cell[1]} m.`, where);
    if (!(t.forest.spacing >= TERRAIN_LIMITS.spacing[0] && t.forest.spacing <= TERRAIN_LIMITS.spacing[1]) || !(t.forest.density >= 0 && t.forest.density <= 1)) error('terrain_forest', `El bosque del terreno necesita una separación entre ${TERRAIN_LIMITS.spacing[0]} y ${TERRAIN_LIMITS.spacing[1]} m y una densidad entre 0 y 1.`, where);
    const keys = Object.keys(t.chunks);
    if (keys.length > TERRAIN_LIMITS.chunks) error('terrain_limit', `El terreno tiene más de ${TERRAIN_LIMITS.chunks} trozos: es demasiado grande para un solo mapa.`, where);
    const broken = keys.filter((key) => !decodeChunk(t.chunks[key]));
    if (broken.length) error('terrain_chunk', `El terreno tiene ${broken.length} trozo(s) dañado(s) (${broken.slice(0, 3).join('; ')}${broken.length > 3 ? '…' : ''}).`, where);
  }

  if (map.publish) {
    const p = map.publish;
    if (!(Number.isInteger(p.version) && p.version >= 1) || !(p.tileSize >= 64 && p.tileSize <= 2048) || !Number.isInteger(p.minZoom) || !Number.isInteger(p.maxZoom) || p.maxZoom < p.minZoom || !['webp', 'png', 'jpg'].includes(p.format)) error('publish_invalid', 'La exportación para el juego (publish) no es válida.', { type: 'map', id: map.id });
  }

  // Referencias desde las fichas de los NPC (home y horarios) a lugares que ningún mapa define.
  const everything = new Set([...placeIds, ...takenIds, ...legacyIds]);
  for (const item of refs) {
    if (!everything.has(item.placeId)) warn('npc_reference', `${item.where} usa el lugar «${item.placeId}», que ningún mapa define.`, { type: 'npc', id: item.npcId });
  }
  return { errors, warnings, ok: errors.length === 0 };
}

// Distancia entre dos lugares (o puntos) en metros: ahora es directa, no hay escala que calibrar.
export function placeDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
