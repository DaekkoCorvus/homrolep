// Geometría del mapa. Módulo compartido: se importa igual desde el navegador (editor y mapa del juego) y desde Node (motor y tests), así que
// el editor y el motor calculan exactamente lo mismo. Todo son funciones puras.
//
// Coordenadas del MUNDO, en METROS (esquema v2): x crece hacia el este e y hacia el SUR (como en pantalla; el norte es -y). No hay imagen de
// por medio: la escala es intrínseca (1 unidad = 1 metro), el lienzo no tiene límite y ampliarlo no mueve nada de lo ya dibujado.
// Un punto es { x, y }; un polígono es una lista de [x, y]; una línea (camino) es otra lista de [x, y].

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const clamp01 = (value) => clamp(value, 0, 1);
export const round = (value, digits = 1) => { const factor = 10 ** digits; return Math.round(value * factor) / factor; };

// Distancia entre dos puntos, en metros.
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// --- Líneas y cajas ----------------------------------------------------------------------------------------------------------------------------------
export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return total;
}

// Distancia de un punto a un segmento a-b (a y b son [x, y]).
export function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((point.x - a[0]) * dx + (point.y - a[1]) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (a[0] + t * dx), point.y - (a[1] + t * dy));
}
// Distancia de un punto a una línea quebrada (la usan los generadores para que las calles «corten» las casas).
export function distanceToPolyline(point, points) {
  if (points.length === 1) return Math.hypot(point.x - points[0][0], point.y - points[0][1]);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(point, points[i - 1], points[i]));
  return best;
}

// Caja que contiene una lista de puntos [x, y]; null si está vacía. Cajas: { minX, minY, maxX, maxY }.
export function boundsOf(points) {
  if (!points.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, minY, maxX, maxY };
}
export function mergeBounds(a, b) {
  if (!a) return b; if (!b) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}
export const growBounds = (box, margin) => (box ? { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin } : null);

// Velocidades PROVISIONALES para calcular tiempos (metros por minuto). Se calibrarán cuando se fije el tamaño del país; el motor las tomará
// de la configuración de transporte, no de aquí.
export const WALK_METERS_PER_MIN = 80;   // ~4,8 km/h
export const TAXI_METERS_PER_MIN = 600;  // ~36 km/h en ciudad
export const minutesFor = (meters, metersPerMinute) => Math.max(0, Math.round(meters / metersPerMinute));

// ¿Está el punto dentro del polígono? (trazado de rayos; el borde cuenta como dentro).
export function pointInPolygon(point, polygon) {
  const { x, y } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if (onSegment(point, polygon[j], polygon[i])) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const EPS = 1e-9;
function onSegment(point, a, b) {
  const cross = (b[0] - a[0]) * (point.y - a[1]) - (b[1] - a[1]) * (point.x - a[0]);
  if (Math.abs(cross) > EPS) return false;
  return point.x >= Math.min(a[0], b[0]) - EPS && point.x <= Math.max(a[0], b[0]) + EPS && point.y >= Math.min(a[1], b[1]) - EPS && point.y <= Math.max(a[1], b[1]) + EPS;
}

// Área (con signo) del polígono en unidades normalizadas al cuadrado; el valor absoluto es el área.
export function polygonArea(polygon) {
  let sum = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) sum += (polygon[j][0] * polygon[i][1]) - (polygon[i][0] * polygon[j][1]);
  return Math.abs(sum / 2);
}

export function polygonCentroid(polygon) {
  if (!polygon.length) return { x: 0, y: 0 };
  return { x: polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length, y: polygon.reduce((sum, [, y]) => sum + y, 0) / polygon.length };
}

const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
// ¿Se cruzan dos segmentos? (los que solo comparten un extremo no cuentan: eso es un vértice, no un cruce).
export function segmentsCross(a, b, c, d) {
  const o1 = orient(a, b, c); const o2 = orient(a, b, d); const o3 = orient(c, d, a); const o4 = orient(c, d, b);
  return ((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) && ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS));
}

// ¿El polígono se cruza consigo mismo? (aristas no contiguas que se cortan).
export function polygonSelfIntersects(polygon) {
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // aristas contiguas
      if (segmentsCross(polygon[i], polygon[(i + 1) % n], polygon[j], polygon[(j + 1) % n])) return true;
    }
  }
  return false;
}

// ¿Se solapan dos polígonos? Aproximación suficiente para avisar en el editor: aristas que se cruzan, o un vértice (o el centro) de uno
// ESTRICTAMENTE dentro del otro. Compartir un borde o un vértice no es solaparse; dos polígonos iguales sí.
export function polygonsOverlap(a, b) {
  const strictlyInside = (x, y, polygon) => pointInPolygon({ x, y }, polygon) && !onAnyEdge({ x, y }, polygon);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  if (a.some(([x, y]) => strictlyInside(x, y, b)) || b.some(([x, y]) => strictlyInside(x, y, a))) return true;
  const ca = polygonCentroid(a); const cb = polygonCentroid(b);
  return strictlyInside(ca.x, ca.y, b) || strictlyInside(cb.x, cb.y, a);
}
const onAnyEdge = (point, polygon) => polygon.some((vertex, index) => onSegment(point, vertex, polygon[(index + 1) % polygon.length]));

// Distrito que contiene un punto: si hay varios (solapados), el de menor área (el más específico).
export function districtAt(point, districts) {
  const hits = districts.filter((district) => district.polygon?.length >= 3 && pointInPolygon(point, district.polygon));
  hits.sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
  return hits[0] ?? null;
}

// --- Ids ---------------------------------------------------------------------------------------------------------------------------------------------
export const ID_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

// «Luna's Coffee» → «lunas_coffee»; «Distrito del Río» → «distrito_del_rio».
export function slugify(text) {
  const slug = String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  return /^[a-z]/.test(slug) ? slug : (slug ? `p_${slug}` : 'lugar');
}
// Un id que no choca con los usados: `cafe`, `cafe_2`, `cafe_3`…
export function uniqueId(base, taken) {
  let id = base; let n = 2;
  while (taken.has(id)) id = `${base.slice(0, 36)}_${n++}`;
  return id;
}
