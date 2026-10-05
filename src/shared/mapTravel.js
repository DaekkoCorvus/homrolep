// Distancias y tiempos de viaje sobre un mapa. Módulo compartido (editor y motor) y puro: no sabe nada de ciudades concretas; trabaja con los
// lugares y los enlaces (`links`) que tenga el mapa que se le pase. Sirve para cualquier región del mundo.
//
// Un enlace une dos lugares con un modo de transporte (carretera, ferrocarril, Northline, ruta marítima…). Su DISTANCIA es diegética: la escribe el
// autor (`distanceKm`) o sale del trazado dibujado (`path`) en metros; su TIEMPO lo escribe el autor (`minutes`) o sale de la distancia y la
// velocidad del modo (`TRAVEL_MODES`, ajustable por mapa en `map.travel.speedsKmh`). Caminar es siempre una opción entre lugares con coordenadas.
import { polylineLength } from './geo.js';

export const TRAVEL_MODES = {
  walk: { label: 'A pie', kmh: 5, layer: null, color: '#d8d2c2' },
  road: { label: 'Carretera', kmh: 35, layer: 'roads', color: '#e0a458' },
  path: { label: 'Camino secundario', kmh: 15, layer: 'roads', color: '#b99668' },
  rail: { label: 'Ferrocarril', kmh: 80, layer: 'railways', color: '#9aa3b5' },
  northline: { label: 'Northline', kmh: 40, layer: 'northline', color: '#4aa3ff' },
  trade: { label: 'Ruta comercial', kmh: 25, layer: 'roads', color: '#e8c35a' },
  sea: { label: 'Ruta marítima', kmh: 25, layer: 'ports', color: '#5ec8e5' },
  metro: { label: 'Metro', kmh: 35, layer: 'northline', color: '#8d54d6' },
  ferry: { label: 'Ferry', kmh: 20, layer: 'ports', color: '#5ec8e5' },
  train: { label: 'Tren', kmh: 70, layer: 'railways', color: '#9aa3b5' },
  other: { label: 'Otro', kmh: 30, layer: 'roads', color: '#c0c0c0' }
};
export const LINK_MODES = Object.keys(TRAVEL_MODES).filter((mode) => mode !== 'walk');
export const MAX_LINK_MINUTES = 10080;   // una semana

const finite = (value) => Number.isFinite(value);

export function speedKmh(map, mode) {
  const own = Number(map?.travel?.speedsKmh?.[mode]);
  return own > 0 ? own : TRAVEL_MODES[mode]?.kmh ?? TRAVEL_MODES.other.kmh;
}

export const placeIndex = (map) => new Map((map?.places ?? []).map((place) => [place.id, place]));
const hasCoords = (place) => place && finite(place.x) && finite(place.y);

// Trazado de un enlace en metros: del primer lugar al segundo pasando por los puntos intermedios (`path`). null si falta algún extremo con coordenadas.
export function linkPoints(map, link, index = placeIndex(map)) {
  const a = index.get(link.from); const b = index.get(link.to);
  if (!hasCoords(a) || !hasCoords(b)) return null;
  return [[a.x, a.y], ...(link.path ?? []).filter(([x, y]) => finite(x) && finite(y)), [b.x, b.y]];
}

// Distancia dibujada de un enlace (km): la del trazado. null si no se puede medir.
export function drawnKm(map, link, index) {
  const points = linkPoints(map, link, index);
  return points ? polylineLength(points) / 1000 : null;
}
// Distancia diegética (km): la escrita por el autor y, si no hay, la dibujada.
export function linkKm(map, link, index) {
  if (finite(link.distanceKm) && link.distanceKm > 0) return link.distanceKm;
  return drawnKm(map, link, index);
}
// Minutos de un enlace: los escritos por el autor o, si no hay, distancia / velocidad del modo (como mínimo 1). null si no se puede calcular.
export function linkMinutes(map, link, index) {
  if (finite(link.minutes) && link.minutes > 0) return link.minutes;
  const km = linkKm(map, link, index);
  return km === null ? null : Math.max(1, Math.round((km / speedKmh(map, link.mode)) * 60));
}

// Distancia en línea recta entre dos lugares (km); null si alguno no tiene coordenadas en este mapa.
export function straightKm(map, fromId, toId, index = placeIndex(map)) {
  const a = index.get(fromId); const b = index.get(toId);
  return hasCoords(a) && hasCoords(b) ? Math.hypot(a.x - b.x, a.y - b.y) / 1000 : null;
}
export const walkMinutes = (map, km) => Math.max(1, Math.round((km / speedKmh(map, 'walk')) * 60));

// «4 h», «30 min», «1 h 15 min», «2 d 3 h».
export function formatDuration(minutes) {
  if (!finite(minutes)) return '—';
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  if (total < 1440) { const h = Math.floor(total / 60); const m = total % 60; return m ? `${h} h ${m} min` : `${h} h`; }
  const d = Math.floor(total / 1440); const h = Math.floor((total % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}
export const formatKm = (km) => (!finite(km) ? '—' : km < 10 ? `${(Math.round(km * 10) / 10).toString().replace('.', ',')} km` : `${Math.round(km)} km`);

// --- Rutas por la red de enlaces ---------------------------------------------------------------------------------------------------------------------
// Camino más rápido entre dos lugares usando solo enlaces. Cada cambio de enlace/línea cuesta `transferMinutes` (esperar el siguiente tren).
// `modes`: si se da, solo se usan esos modos. Devuelve { minutes, km, cost, legs: [{ linkId, name, mode, line, from, to, km, minutes, cost }] } o null.
function shortestRoute(map, fromId, toId, { modes = null, transferMinutes = 10, index = placeIndex(map) } = {}) {
  if (fromId === toId) return null;
  const edges = new Map();
  const push = (from, edge) => { (edges.get(from) ?? edges.set(from, []).get(from)).push(edge); };
  for (const link of map.links ?? []) {
    if (modes && !modes.includes(link.mode)) continue;
    const minutes = linkMinutes(map, link, index); const km = linkKm(map, link, index);
    if (minutes === null) continue;
    const leg = { linkId: link.id, name: link.name, mode: link.mode, line: link.line ?? null, km: km ?? 0, minutes, cost: link.cost ?? 0 };
    push(link.from, { ...leg, from: link.from, to: link.to });
    if (link.twoWay !== false) push(link.to, { ...leg, from: link.to, to: link.from });
  }
  // Dijkstra sobre estados (lugar, enlace usado): el cambio de enlace pesa más que seguir en la misma línea.
  const best = new Map(); const start = { node: fromId, via: null, time: 0, prev: null, leg: null };
  const open = [start]; best.set(`${fromId}|`, 0);
  let found = null;
  while (open.length) {
    open.sort((a, b) => a.time - b.time);
    const current = open.shift();
    if (current.time > (best.get(`${current.node}|${current.via ?? ''}`) ?? Infinity)) continue;
    if (current.node === toId) { found = current; break; }
    for (const edge of edges.get(current.node) ?? []) {
      const sameLine = current.leg && (edge.linkId === current.leg.linkId || (edge.line && edge.line === current.leg.line));
      const time = current.time + edge.minutes + (current.leg && !sameLine ? transferMinutes : 0);
      const key = `${edge.to}|${edge.linkId}`;
      if (time < (best.get(key) ?? Infinity)) { best.set(key, time); open.push({ node: edge.to, via: edge.linkId, time, prev: current, leg: edge }); }
    }
  }
  if (!found) return null;
  const legs = []; for (let step = found; step?.leg; step = step.prev) legs.unshift(step.leg);
  return { minutes: Math.round(found.time), km: legs.reduce((sum, leg) => sum + leg.km, 0), cost: legs.reduce((sum, leg) => sum + leg.cost, 0), legs };
}

// Opciones para ir de un lugar a otro: caminando en línea recta (si ambos tienen coordenadas), la ruta más rápida por la red y la más rápida con cada modo
// por separado (solo carretera, solo Northline…) cuando es distinta. Ordenadas por tiempo.
//   walkMaxMinutes: tope de un tramo a pie (como el del motor); por encima, `tooFar` avisa.
export function planTrip(map, fromId, toId, { walkMaxMinutes = 12 * 60, transferMinutes = 10 } = {}) {
  const index = placeIndex(map);
  const options = [];
  const km = straightKm(map, fromId, toId, index);
  if (km !== null && fromId !== toId) {
    const minutes = walkMinutes(map, km);
    options.push({ id: 'walk', label: TRAVEL_MODES.walk.label, modes: ['walk'], km, minutes, cost: 0, legs: [], tooFar: minutes > walkMaxMinutes });
  }
  const seen = new Set();
  const addRoute = (id, label, route) => {
    if (!route) return;
    const key = route.legs.map((leg) => leg.linkId).join('>');
    if (seen.has(key)) return; seen.add(key);
    options.push({ id, label, modes: [...new Set(route.legs.map((leg) => leg.mode))], ...route, tooFar: false });
  };
  addRoute('fastest', 'Ruta más rápida', shortestRoute(map, fromId, toId, { transferMinutes, index }));
  for (const mode of new Set((map.links ?? []).map((link) => link.mode))) addRoute(`only_${mode}`, `Solo ${TRAVEL_MODES[mode]?.label.toLowerCase() ?? mode}`, shortestRoute(map, fromId, toId, { modes: [mode], transferMinutes, index }));
  options.sort((a, b) => a.minutes - b.minutes);
  return { from: fromId, to: toId, straightKm: km, options };
}
