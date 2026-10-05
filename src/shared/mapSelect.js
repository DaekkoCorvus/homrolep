// Selección múltiple del editor de mapas: qué elementos caen dentro de un rectángulo y cómo se mueven en bloque a un grupo. Funciones puras (el editor las
// usa en el navegador y los tests en Node), para que las reglas de bloqueo no dependan de la interfaz.
import { boundsOf, pointInPolygon, segmentsCross } from './geo.js';
import { lockedBy } from './mapSchema.js';

export const SELECTABLE = ['place', 'area', 'way', 'district'];
export const COLLECTION = { place: 'places', area: 'areas', way: 'ways', district: 'districts' };
const pointsOf = (type, item) => (type === 'way' ? item.points : item.polygon);

// Caja de un elemento { minX, minY, maxX, maxY }.
export function itemBounds(type, item) {
  if (type === 'place') return { minX: item.x, minY: item.y, maxX: item.x, maxY: item.y };
  return boundsOf(pointsOf(type, item).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
}

const inRect = (rect, x, y) => x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;
function touchesRect(type, item, rect) {
  if (type === 'place') return inRect(rect, item.x, item.y);
  const points = pointsOf(type, item); if (!points?.length) return false;
  if (points.some(([x, y]) => inRect(rect, x, y))) return true;
  const edges = [[[rect.minX, rect.minY], [rect.maxX, rect.minY]], [[rect.maxX, rect.minY], [rect.maxX, rect.maxY]], [[rect.maxX, rect.maxY], [rect.minX, rect.maxY]], [[rect.minX, rect.maxY], [rect.minX, rect.minY]]];
  const count = type === 'way' ? points.length - 1 : points.length;
  for (let i = 0; i < count; i++) for (const [c, d] of edges) if (segmentsCross(points[i], points[(i + 1) % points.length], c, d)) return true;
  // el rectángulo entero dentro de un área o distrito
  return type !== 'way' && points.length >= 3 && pointInPolygon({ x: rect.minX, y: rect.minY }, points);
}

// Elementos dentro de un rectángulo del mundo. `mode`:
//   'inside' → los que quedan ENTEROS dentro (arrastrar de izquierda a derecha)
//   'touch'  → los que lo tocan o lo cruzan (arrastrar de derecha a izquierda)
// `types` limita qué tipos se consideran.
export function itemsInRect(map, rect, { mode = 'inside', types = SELECTABLE } = {}) {
  const box = { minX: Math.min(rect.minX, rect.maxX), minY: Math.min(rect.minY, rect.maxY), maxX: Math.max(rect.minX, rect.maxX), maxY: Math.max(rect.minY, rect.maxY) };
  const out = [];
  for (const type of types) {
    for (const item of map[COLLECTION[type]] ?? []) {
      const bounds = itemBounds(type, item); if (!bounds) continue;
      const hit = mode === 'inside'
        ? bounds.minX >= box.minX && bounds.maxX <= box.maxX && bounds.minY >= box.minY && bounds.maxY <= box.maxY
        : touchesRect(type, item, box);
      if (hit) out.push({ type, id: item.id });
    }
  }
  return out;
}

// Alterna un elemento en una selección (la devuelve nueva). Los elementos se identifican por tipo e id.
export function toggleItem(selection, entry) {
  const found = selection.some((item) => item.type === entry.type && item.id === entry.id);
  return found ? selection.filter((item) => !(item.type === entry.type && item.id === entry.id)) : [...selection, entry];
}
export function mergeItems(selection, additions) {
  const out = [...selection];
  for (const entry of additions) if (!out.some((item) => item.type === entry.type && item.id === entry.id)) out.push(entry);
  return out;
}

// Mueve elementos a un grupo (o los saca de él con groupId = null). MODIFICA `map` (llámala dentro de la mutación del editor).
// No toca lo que ya está bloqueado por su grupo actual, y se niega a meter nada en un grupo bloqueado.
// Devuelve { moved, skipped: [{ type, id, group }], refused: group | null }.
export function assignToGroup(map, items, groupId) {
  const result = { moved: 0, skipped: [], refused: null };
  if (groupId) {
    const target = map.groups.find((group) => group.id === groupId);
    if (!target) { result.refused = { id: groupId, name: groupId, reason: 'missing' }; return result; }
    const lock = lockedBy(map, { group: groupId });
    if (lock) { result.refused = { id: lock.id, name: lock.name, reason: 'locked' }; return result; }
  }
  for (const { type, id } of items) {
    if (!COLLECTION[type]) continue;
    const item = map[COLLECTION[type]].find((entry) => entry.id === id); if (!item) continue;
    const lock = lockedBy(map, item);
    if (lock) { result.skipped.push({ type, id, group: lock.id }); continue; }
    item.group = groupId ?? null; result.moved += 1;
  }
  return result;
}

// Quita elementos del mapa en bloque (los bloqueados se respetan). MODIFICA `map`. Los lugares arrastran sus enlaces.
export function removeItems(map, items) {
  const result = { removed: 0, skipped: [] };
  for (const { type, id } of items) {
    const item = map[COLLECTION[type]]?.find((entry) => entry.id === id); if (!item) continue;
    const lock = lockedBy(map, item);
    if (lock) { result.skipped.push({ type, id, group: lock.id }); continue; }
    map[COLLECTION[type]] = map[COLLECTION[type]].filter((entry) => entry.id !== id); result.removed += 1;
    if (type === 'place') map.links = map.links.filter((link) => link.from !== id && link.to !== id);
  }
  return result;
}
