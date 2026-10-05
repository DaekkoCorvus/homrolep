// Geografía del juego: la ÚNICA fuente de lugares, distancias y tiempos de viaje. Lee el mapa que designa data/canon/world.json (`mapId`) desde
// data/canon/maps/ —el mismo archivo que edita el editor de mapas— y ofrece una fachada compatible con lo que el motor ya usaba (`world.locations`).
// Nada de coordenadas, ids ni lugares viven en el código: si el autor guarda el mapa, el siguiente `refresh()` lo recoge sin reiniciar.
//
// El motor decide el tiempo (determinista, relativo al origen); la IA solo narra. Si el mapa guardado no es válido se usa la última copia buena
// (data/canon/maps/.backup) y se avisa; si ya había uno cargado, se conserva.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { normalizeMap, validateMap } from '../../shared/mapSchema.js';
import { ID_PATTERN } from '../../shared/geo.js';

export const WORLD_DEFAULTS = Object.freeze({ walkMetersPerMinute: 80, minTravelMinutes: 2, maxWalkMinutes: 180 });
const positive = (value, fallback) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback);

// Ajustes del mundo (data/canon/world.json) con valores razonables si falta o está mal alguno.
export function normalizeConfig(input = {}) {
  const mapId = typeof input.mapId === 'string' && ID_PATTERN.test(input.mapId) ? input.mapId : null;
  return {
    id: typeof input.id === 'string' && ID_PATTERN.test(input.id) ? input.id : mapId,
    mapId,
    spawn: typeof input.spawn === 'string' ? input.spawn : null,
    walkMetersPerMinute: positive(input.walkMetersPerMinute, WORLD_DEFAULTS.walkMetersPerMinute),
    minTravelMinutes: Math.round(positive(input.minTravelMinutes, WORLD_DEFAULTS.minTravelMinutes)),
    maxWalkMinutes: Math.round(positive(input.maxWalkMinutes, WORLD_DEFAULTS.maxWalkMinutes))
  };
}

// El mundo tal como lo ve el motor. `locations` conserva la forma de siempre ({ id, name, district, description, hours, ... }) pero el tiempo de viaje
// ya no es un dato del lugar: depende de desde dónde sales (`trip`).
export class World {
  #byId = new Map();
  constructor(map, config = {}) {
    const settings = normalizeConfig({ mapId: map.id, ...config });
    this.id = settings.id ?? map.id;
    this.name = map.name;
    this.mapId = map.id;
    this.walkMetersPerMinute = settings.walkMetersPerMinute;
    this.minTravelMinutes = settings.minTravelMinutes;
    this.maxWalkMinutes = settings.maxWalkMinutes;
    const districtName = (id) => map.districts.find((district) => district.id === id)?.name ?? map.name;
    this.locations = map.places.map((place) => ({
      id: place.id, name: place.name, district: districtName(place.district), districtId: place.district, kind: place.kind, access: place.access,
      description: place.description, hours: place.hours, tags: place.tags, x: place.x, y: place.y
    }));
    for (const location of this.locations) this.#byId.set(location.id, location);
    this.spawn = this.#byId.has(settings.spawn) ? settings.spawn : this.locations[0]?.id ?? null;
  }

  place(id) { return this.#byId.get(id) ?? null; }
  has(id) { return this.#byId.has(id); }
  ids() { return this.locations.map(({ id }) => id); }

  // Trayecto a pie entre dos lugares: metros en línea recta y minutos (con mínimo: ningún viaje es instantáneo). Un origen desconocido se trata como el
  // lugar de inicio; un destino desconocido devuelve null. `tooFar`: supera el tope de un tramo a pie.
  trip(fromId, toId) {
    const to = this.#byId.get(toId);
    const from = this.#byId.get(fromId) ?? this.#byId.get(this.spawn);
    if (!to || !from) return null;
    if (from.id === to.id) return { minutes: 0, meters: 0, tooFar: false };
    const meters = Math.round(Math.hypot(from.x - to.x, from.y - to.y));
    const minutes = Math.max(this.minTravelMinutes, Math.round(meters / this.walkMetersPerMinute));
    return { minutes, meters, tooFar: minutes > this.maxWalkMinutes };
  }
  travelMinutes(fromId, toId) { return this.trip(fromId, toId)?.minutes ?? null; }

  // Cómo está cada lugar respecto a `fromId` (lo que enseña el mapa y la hoja del lugar).
  travelTable(fromId) { return this.locations.map(({ id }) => ({ id, ...this.trip(fromId, id) })); }

  // Vista pública (JSON) del mundo para el cliente.
  view(version = null) {
    return { id: this.id, name: this.name, mapId: this.mapId, spawn: this.spawn, version, walkMetersPerMinute: this.walkMetersPerMinute, minTravelMinutes: this.minTravelMinutes, maxWalkMinutes: this.maxWalkMinutes, locations: this.locations };
  }
}

export const buildWorld = (map, config = {}) => new World(map, config);

// Geografía fija (sin archivos): para pruebas y herramientas que ya tienen el mapa en memoria.
export function createStaticGeography(map, config = {}, version = 'static') {
  const normalized = normalizeMap(map);
  const world = new World(normalized, config);
  return { refresh: async () => {}, world: () => world, map: () => normalized, version: () => version, status: () => ({ version, source: 'static', warnings: [] }) };
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const mtime = (file) => stat(file).then((info) => info.mtimeMs, () => 0);

// Geografía viva: `world()` / `map()` son síncronos (última lectura buena); `refresh()` relee solo si cambió algún archivo (como mucho cada `ttl` ms).
export function createGeography({ worldFile, mapsDir, ttl = 2000, warn = () => {} }) {
  let snapshot = null; let stamps = null; let checked = 0; let loading = null;

  // Primero el mapa guardado; si no es válido, las copias de seguridad de la más nueva a la más vieja.
  async function readMap(mapId) {
    const candidates = [{ file: path.join(mapsDir, `${mapId}.json`), source: 'map' }];
    try {
      const backups = (await readdir(path.join(mapsDir, '.backup'))).filter((name) => name.startsWith(`${mapId}-`) && name.endsWith('.json')).sort().reverse();
      for (const name of backups.slice(0, 5)) candidates.push({ file: path.join(mapsDir, '.backup', name), source: `copia ${name}` });
    } catch { /* sin copias */ }
    const problems = [];
    for (const { file, source } of candidates) {
      try {
        const map = normalizeMap(await readJson(file));
        const result = validateMap(map, {});
        if (!result.ok) { problems.push(`${source}: ${result.errors[0]?.message ?? 'no es válido'}`); continue; }
        if (!map.places.length) { problems.push(`${source}: no tiene lugares`); continue; }
        return { map, source, problems, warnings: result.warnings };
      } catch (error) { problems.push(`${source}: ${error.code === 'ENOENT' ? 'no existe' : error.message}`); }
    }
    return { map: null, problems };
  }

  async function load() {
    let config;
    try { config = normalizeConfig(await readJson(worldFile)); } catch (error) { config = snapshot?.config ?? null; warn(`world.json no se pudo leer (${error.message}).${config ? ' Se conserva el anterior.' : ''}`); }
    if (!config?.mapId) { if (!snapshot) throw new Error('data/canon/world.json no define un mapId válido.'); return; }
    const result = await readMap(config.mapId);
    if (!result.map) {
      if (snapshot) { warn(`El mapa «${config.mapId}» no es válido y no hay copia buena: se conserva el que estaba cargado. ${result.problems.join(' | ')}`); return; }
      throw new Error(`No se pudo cargar el mapa «${config.mapId}»: ${result.problems.join(' | ')}`);
    }
    if (result.source !== 'map') warn(`El mapa «${config.mapId}» guardado no es válido; se usa ${result.source}. ${result.problems[0] ?? ''}`);
    const version = `${stamps}${result.source === 'map' ? '' : '-backup'}`;
    snapshot = { config, map: result.map, world: new World(result.map, config), version, source: result.source, warnings: [...result.problems, ...result.warnings.map((item) => item.message)] };
  }

  return {
    world: () => snapshot?.world, map: () => snapshot?.map, version: () => snapshot?.version,
    status: () => ({ version: snapshot?.version ?? null, source: snapshot?.source ?? null, warnings: snapshot?.warnings ?? [] }),
    async refresh(force = false) {
      const now = Date.now();
      if (!force && snapshot && now - checked < ttl) return snapshot.world;
      if (loading) { await loading; return snapshot?.world; }
      checked = now;
      const next = `${await mtime(worldFile)}:${await mtime(path.join(mapsDir, `${snapshot?.config?.mapId ?? 'northfortress'}.json`))}`;
      if (force || !snapshot || next !== stamps) {
        stamps = next;
        loading = load().finally(() => { loading = null; });
        await loading;
      }
      return snapshot?.world;
    }
  };
}
