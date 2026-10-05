// Generador de relleno del mapa: convierte la RECETA de un área (patrón, semilla, tamaños en metros) en manzanas, casas y árboles. Función pura y
// determinista: la misma área, la misma receta y el mismo entorno dan siempre el mismo resultado, así que NADA de esto se guarda en el mapa; el editor
// y el exportador lo recalculan. Módulo compartido (navegador y Node).
//
// Patrones: «organic» (Voronoi reducido hacia dentro: manzanas irregulares y calles que serpentean), «grid» (cuadrícula rotada con tamaños variables),
// «radial» (anillos y radios) y «forest» (árboles por dispersión de Poisson). Las manzanas se llenan de parcelas pegadas a la calle, en dos filas
// (casas delanteras y traseras) con patio interior.
//
// Prioridades: los CAMINOS mandan (ninguna casa invade su calzada), los LUGARES reservan su parcela, y el agua, las plazas, los parques, las montañas
// y los bosques (según el caso) no se edifican. Un camino actúa como un CUCHILLO: corta las manzanas por su calzada (las operaciones booleanas las hace
// polygonClipping.js), así que las parcelas nuevas se alinean con el borde del camino y las casas miran a él.
import { pointInPolygon, boundsOf, distanceToSegment, segmentsCross, polygonSelfIntersects, polygonArea, growBounds } from './geo.js';
import { FILL_DEFAULTS } from './mapDefaults.js';
import polygonClipping from './polygonClipping.js';

export const GEN_LIMITS = { buildings: 80000, trees: 150000, cells: 20000, gridCells: 6_000_000 };
export const LOT_ROWS = 2;                 // filas de parcelas por manzana (delanteras y traseras)
const SIDEWALK = 0.5;                       // separación entre la parcela y el borde de la manzana
const CURB = 1;                             // margen de seguridad entre una casa y la calzada
const JOIN_SIDES = 12;                      // lados del polígono que redondea las uniones y los extremos de un camino
const BUILD_BLOCKING = new Set(['water', 'plaza', 'park', 'mountain', 'forest']);
const TREE_BLOCKING = new Set(['water', 'plaza', 'urban', 'mountain']);

// --- Azar con semilla ------------------------------------------------------------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Geometría de apoyo -----------------------------------------------------------------------------------------------------------------------------
const signedArea = (poly) => { let sum = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i]; const b = poly[(i + 1) % poly.length]; sum += a[0] * b[1] - b[0] * a[1]; } return sum / 2; };
const ccw = (poly) => (signedArea(poly) < 0 ? [...poly].reverse() : poly);
const r1 = (value) => Math.round(value * 10) / 10;
const r2 = (value) => Math.round(value * 100) / 100;

// Conserva los puntos del lado «interior» (p − q)·n ≤ 0 de la recta que pasa por q con normal n (Sutherland–Hodgman).
function clipHalfPlane(poly, qx, qy, nx, ny) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const da = (a[0] - qx) * nx + (a[1] - qy) * ny; const db = (b[0] - qx) * nx + (b[1] - qy) * ny;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
// Recorta `subject` (puede ser cóncavo) con el polígono CONVEXO `convex`, encogido `inset` metros hacia dentro.
function clipByConvex(subject, convex, inset = 0) {
  const clip = ccw(convex); let out = subject;
  for (let i = 0; i < clip.length && out.length >= 3; i++) {
    const a = clip[i]; const b = clip[(i + 1) % clip.length];
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    const nx = dy / length; const ny = -dx / length;   // normal hacia fuera (el polígono es antihorario)
    out = clipHalfPlane(out, a[0] - nx * inset, a[1] - ny * inset, nx, ny);
  }
  return out.length >= 3 ? out : [];
}
function dedupe(poly) {
  const out = [];
  for (const point of poly) { const last = out.at(-1); if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-4) out.push(point); }
  if (out.length > 1 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) <= 1e-4) out.pop();
  return out;
}

// Rectángulo orientado: centro, medias dimensiones y ejes unitarios u (a lo ancho) y v (a lo fondo).
const makeRect = (cx, cy, width, depth, ux, uy) => ({ cx, cy, hw: width / 2, hd: depth / 2, ux, uy, vx: -uy, vy: ux });
function cornersOf(rect) {
  const out = [];
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push([rect.cx + rect.ux * rect.hw * su + rect.vx * rect.hd * sv, rect.cy + rect.uy * rect.hw * su + rect.vy * rect.hd * sv]);
  return out;
}
function rectsOverlap(a, b, eps) {
  for (const [ax, ay] of [[a.ux, a.uy], [a.vx, a.vy], [b.ux, b.uy], [b.vx, b.vy]]) {
    const dist = Math.abs((b.cx - a.cx) * ax + (b.cy - a.cy) * ay);
    const ra = a.hw * Math.abs(a.ux * ax + a.uy * ay) + a.hd * Math.abs(a.vx * ax + a.vy * ay);
    const rb = b.hw * Math.abs(b.ux * ax + b.uy * ay) + b.hd * Math.abs(b.vx * ax + b.vy * ay);
    if (dist >= ra + rb - eps) return false;
  }
  return true;
}
const pointInRect = (rect, x, y) => Math.abs((x - rect.cx) * rect.ux + (y - rect.cy) * rect.uy) <= rect.hw && Math.abs((x - rect.cx) * rect.vx + (y - rect.cy) * rect.vy) <= rect.hd;
const pointToSegment = (p, a, b) => distanceToSegment({ x: p[0], y: p[1] }, a, b);
function segmentDistance(p1, p2, p3, p4) {
  if (segmentsCross(p1, p2, p3, p4)) return 0;
  return Math.min(pointToSegment(p1, p3, p4), pointToSegment(p2, p3, p4), pointToSegment(p3, p1, p2), pointToSegment(p4, p1, p2));
}
// Distancia mínima entre una línea quebrada y un rectángulo (0 si lo toca o lo atraviesa).
function polylineToRect(points, rect, corners) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]; const b = points[i];
    if (pointInRect(rect, a[0], a[1]) || pointInRect(rect, b[0], b[1])) return 0;
    for (let k = 0; k < 4; k++) best = Math.min(best, segmentDistance(a, b, corners[k], corners[(k + 1) % 4]));
    if (best === 0) return 0;
  }
  return best;
}
const boxesTouch = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

// --- Dispersión de Poisson (Bridson): puntos separados entre rMin y rMax dentro de un polígono -------------------------------------------------------
function poisson(poly, rMin, rMax, rng, cap) {
  const box = boundsOf(poly); const size = rMin / Math.SQRT2;
  const cols = Math.ceil((box.maxX - box.minX) / size) + 1; const rows = Math.ceil((box.maxY - box.minY) / size) + 1;
  if (cols * rows > GEN_LIMITS.gridCells) return { points: [], truncated: true };
  const grid = new Int32Array(cols * rows).fill(-1); const points = []; const active = [];
  const fits = (x, y) => {
    const gx = Math.floor((x - box.minX) / size); const gy = Math.floor((y - box.minY) / size);
    for (let j = Math.max(0, gy - 2); j <= Math.min(rows - 1, gy + 2); j++) for (let i = Math.max(0, gx - 2); i <= Math.min(cols - 1, gx + 2); i++) {
      const index = grid[j * cols + i];
      if (index >= 0 && Math.hypot(points[index][0] - x, points[index][1] - y) < rMin) return false;
    }
    return true;
  };
  const add = (x, y) => { points.push([x, y]); grid[Math.floor((y - box.minY) / size) * cols + Math.floor((x - box.minX) / size)] = points.length - 1; active.push(points.length - 1); };
  let restarts = 0; let truncated = false;
  while (true) {
    if (points.length >= cap) { truncated = true; break; }
    if (!active.length) {
      // sin puntos activos: se intenta empezar en otro trozo del polígono (formas cóncavas o separadas)
      let started = false;
      for (let tries = 0; tries < 400 && !started; tries++) {
        const x = box.minX + rng() * (box.maxX - box.minX); const y = box.minY + rng() * (box.maxY - box.minY);
        if (pointInPolygon({ x, y }, poly) && fits(x, y)) { add(x, y); started = true; }
      }
      if (!started || ++restarts > 60) break;
      continue;
    }
    const pick = Math.floor(rng() * active.length); const [px, py] = points[active[pick]];
    let found = false;
    for (let k = 0; k < 20 && !found; k++) {
      const angle = rng() * Math.PI * 2; const radius = rMin + rng() * (rMax - rMin);
      const x = px + Math.cos(angle) * radius; const y = py + Math.sin(angle) * radius;
      if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY && pointInPolygon({ x, y }, poly) && fits(x, y)) { add(x, y); found = true; }
    }
    if (!found) { active[pick] = active.at(-1); active.pop(); }
  }
  return { points, truncated };
}

// --- Celdas (cada celda es una manzana potencial, convexa y ya encogida por media calle) -------------------------------------------------------------
function organicCells(poly, fill, rng) {
  const { min, max } = fill.blockSize; const half = fill.streetWidth / 2;
  const { points, truncated } = poisson(poly, min, Math.max(max, min * 1.01), rng, GEN_LIMITS.cells);
  const L = max * 1.1; const reach = L * 2.9; const bucket = Math.max(max, 1);
  const hash = new Map(); const key = (x, y) => `${Math.floor(x / bucket)},${Math.floor(y / bucket)}`;
  points.forEach((p, index) => { const k = key(p[0], p[1]); (hash.get(k) ?? hash.set(k, []).get(k)).push(index); });
  const span = Math.ceil(reach / bucket); const cells = [];
  points.forEach(([x, y], me) => {
    const near = [];
    const bx = Math.floor(x / bucket); const by = Math.floor(y / bucket);
    for (let j = -span; j <= span; j++) for (let i = -span; i <= span; i++) for (const other of hash.get(`${bx + i},${by + j}`) ?? []) {
      if (other === me) continue;
      const d = Math.hypot(points[other][0] - x, points[other][1] - y);
      if (d <= reach) near.push([d, other]);
    }
    near.sort((a, b) => a[0] - b[0]);
    let cell = [[x - L, y - L], [x + L, y - L], [x + L, y + L], [x - L, y + L]];
    let radius = L * Math.SQRT2;
    for (const [d, other] of near) {
      if (d / 2 - half >= radius) break;
      const nx = (points[other][0] - x) / d; const ny = (points[other][1] - y) / d;
      cell = clipHalfPlane(cell, x + nx * (d / 2 - half), y + ny * (d / 2 - half), nx, ny);
      if (cell.length < 3) break;
      radius = Math.max(...cell.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
    }
    if (cell.length >= 3) cells.push(cell);
  });
  return { cells, truncated };
}

function gridCells(poly, fill, rng) {
  const { min, max } = fill.blockSize; const half = fill.streetWidth / 2;
  const box = boundsOf(poly); const center = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  const angle = (fill.rotation * Math.PI) / 180; const cos = Math.cos(angle); const sin = Math.sin(angle);
  const toLocal = ([x, y]) => [(x - center[0]) * cos + (y - center[1]) * sin, -(x - center[0]) * sin + (y - center[1]) * cos];
  const toWorld = ([x, y]) => [center[0] + x * cos - y * sin, center[1] + x * sin + y * cos];
  const local = boundsOf(poly.map(toLocal));
  const cuts = (from, to) => { const out = [from]; while (out.at(-1) < to) out.push(out.at(-1) + min + rng() * (max - min)); return out; };
  const xs = cuts(local.minX, local.maxX); const ys = cuts(local.minY, local.maxY);
  if ((xs.length - 1) * (ys.length - 1) > GEN_LIMITS.cells) return { cells: [], truncated: true };
  const cells = [];
  for (let j = 0; j + 1 < ys.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i] + half; const x1 = xs[i + 1] - half; const y0 = ys[j] + half; const y1 = ys[j + 1] - half;
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    cells.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(toWorld));
  }
  return { cells, truncated: false };
}

function radialCells(poly, fill) {
  const { min, max } = fill.blockSize; const half = fill.streetWidth / 2; const step = (min + max) / 2;
  const [cx, cy] = fill.center ?? [0, 0]; const spokes = Math.max(3, fill.spokes); const rings = Math.max(1, fill.rings);
  const start = (fill.rotation * Math.PI) / 180; const first = step * 0.6;
  const at = (radius, index) => [cx + Math.cos(start + (index * 2 * Math.PI) / spokes) * radius, cy + Math.sin(start + (index * 2 * Math.PI) / spokes) * radius];
  const cells = [];
  for (let ring = 0; ring < rings; ring++) {
    const inner = ring === 0 ? first : first + ring * step; const outer = first + (ring + 1) * step;
    for (let s = 0; s < spokes; s++) {
      const quad = ccw([at(inner, s), at(outer, s), at(outer, s + 1), at(inner, s + 1)]);
      const shrunk = clipByConvex(quad, quad, half);
      if (shrunk.length >= 3) cells.push(shrunk);
    }
  }
  return { cells, truncated: cells.length > GEN_LIMITS.cells };
}

// --- Caminos como cuchillo -------------------------------------------------------------------------------------------------------------------------
const closed = (points) => [...points.map(([x, y]) => [x, y]), [points[0][0], points[0][1]]];
const opened = (ring) => ring.slice(0, -1);
// Calzada de un grupo de caminos (unión de un rectángulo por tramo y un polígono redondo en cada vértice). null si no hay ninguno.
export function corridorOf(ways) {
  const pieces = [];
  for (const way of ways) {
    const half = way.width / 2; if (!(half > 0)) continue;
    for (let i = 0; i < way.points.length; i++) {
      const [x, y] = way.points[i];
      pieces.push([closed(Array.from({ length: JOIN_SIDES }, (_, k) => [x + Math.cos((k * 2 * Math.PI) / JOIN_SIDES) * half * 1.02, y + Math.sin((k * 2 * Math.PI) / JOIN_SIDES) * half * 1.02]))]);
      if (i === 0) continue;
      const [px, py] = way.points[i - 1]; const length = Math.hypot(x - px, y - py);
      if (length < 1e-6) continue;
      const nx = (-(y - py) / length) * half; const ny = ((x - px) / length) * half;
      pieces.push([closed([[px + nx, py + ny], [x + nx, y + ny], [x - nx, y - ny], [px - nx, py - ny]])]);
    }
  }
  return pieces.length ? polygonClipping.union(pieces[0], ...pieces.slice(1)) : null;
}

// --- Exclusiones ------------------------------------------------------------------------------------------------------------------------------------
function buildBlockers(ctx, box, blockingKinds, selfId) {
  const reach = growBounds(box, 4);
  const ways = (ctx.ways ?? []).filter((way) => way.points?.length >= 2).map((way) => ({ points: way.points, width: way.width, reach: way.width / 2 + CURB, box: growBounds(boundsOf(way.points), way.width / 2 + CURB + 1) })).filter((way) => boxesTouch(way.box, reach));
  const places = (ctx.places ?? []).filter((place) => Number.isFinite(place.x) && Number.isFinite(place.y)).map((place) => {
    const footprint = place.footprint?.width > 0 && place.footprint?.depth > 0 ? place.footprint : null;
    const radius = footprint ? Math.hypot(footprint.width, footprint.depth) / 2 : 2;
    const angle = ((footprint?.rotation ?? 0) * Math.PI) / 180;
    return { x: place.x, y: place.y, footprint, rect: footprint ? makeRect(place.x, place.y, footprint.width, footprint.depth, Math.cos(angle), Math.sin(angle)) : null, box: { minX: place.x - radius - 3, minY: place.y - radius - 3, maxX: place.x + radius + 3, maxY: place.y + radius + 3 } };
  }).filter((place) => boxesTouch(place.box, reach));
  const areas = (ctx.areas ?? []).filter((other) => other.id !== selfId && blockingKinds.has(other.kind) && other.polygon?.length >= 3).map((other) => ({ polygon: other.polygon, box: boundsOf(other.polygon) })).filter((other) => boxesTouch(other.box, reach));
  return { ways, places, areas };
}
// ¿Está libre este rectángulo? (calzadas, lugares y áreas no edificables)
function rectFree(rect, corners, blockers) {
  const box = boundsOf(corners);
  for (const way of blockers.ways) if (boxesTouch(way.box, box) && polylineToRect(way.points, rect, corners) < way.reach) return false;
  for (const place of blockers.places) {
    if (!boxesTouch(place.box, box)) continue;
    if (place.rect ? rectsOverlap(place.rect, rect, -2) : pointInRect({ ...rect, hw: rect.hw + 2, hd: rect.hd + 2 }, place.x, place.y)) return false;
  }
  for (const area of blockers.areas) {
    if (!boxesTouch(area.box, box)) continue;
    if (pointInPolygon({ x: rect.cx, y: rect.cy }, area.polygon) || corners.some(([x, y]) => pointInPolygon({ x, y }, area.polygon))) return false;
  }
  return true;
}
const pointFree = (x, y, blockers, clearance) => !blockers.ways.some((way) => boxesTouch(way.box, { minX: x, minY: y, maxX: x, maxY: y }) && distanceToPolylineXY(x, y, way.points) < way.reach + clearance)
  && !blockers.places.some((place) => Math.hypot(place.x - x, place.y - y) < (place.footprint ? Math.hypot(place.footprint.width, place.footprint.depth) / 2 : 2) + clearance)
  && !blockers.areas.some((area) => boxesTouch(area.box, { minX: x, minY: y, maxX: x, maxY: y }) && pointInPolygon({ x, y }, area.polygon));
function distanceToPolylineXY(x, y, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment({ x, y }, points[i - 1], points[i]));
  return best;
}

// --- Parcelas y casas de una manzana -----------------------------------------------------------------------------------------------------------------
function fillBlock({ ring: block, holes }, fill, rng, blockers, out) {
  const { width: lotWidth, depth } = fill.lotSize; const placed = [];
  for (let row = 0; row < LOT_ROWS; row++) {
    const offset = SIDEWALK + row * depth; const keep = row === 0 ? fill.density : fill.density * 0.8;
    for (let e = 0; e < block.length; e++) {
      const a = block[e]; const b = block[(e + 1) % block.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < lotWidth * 0.8) continue;
      const tx = (b[0] - a[0]) / length; const ty = (b[1] - a[1]) / length; const nx = -ty; const ny = tx;   // normal hacia el interior (antihorario)
      let s = SIDEWALK + rng() * lotWidth * 0.3;
      while (true) {
        const width = lotWidth * (0.85 + rng() * 0.3);
        if (s + width > length - SIDEWALK) break;
        const here = s; s += width;
        if (out.buildings.length >= GEN_LIMITS.buildings) { out.truncated = true; return; }
        if (rng() > keep) continue;
        const lot = makeRect(a[0] + tx * (here + width / 2) + nx * (offset + depth / 2), a[1] + ty * (here + width / 2) + ny * (offset + depth / 2), width, depth, tx, ty);
        const corners = cornersOf(lot);
        if (!corners.every(([x, y]) => pointInPolygon({ x, y }, block))) continue;
        if (holes.some((hole) => pointInPolygon({ x: lot.cx, y: lot.cy }, hole) || corners.some(([x, y]) => pointInPolygon({ x, y }, hole)))) continue;
        if (placed.some((other) => rectsOverlap(other, lot, 0.3))) continue;
        if (!rectFree(lot, corners, blockers)) continue;
        placed.push(lot);
        const bWidth = Math.max(4, width - (0.8 + rng() * 1.4)); const bDepth = depth * (0.62 + rng() * 0.3); const setback = rng() * 1.2;
        const inward = offset + setback + bDepth / 2;
        out.buildings.push({ x: r2(a[0] + tx * (here + width / 2) + nx * inward), y: r2(a[1] + ty * (here + width / 2) + ny * inward), w: r1(bWidth), d: r1(bDepth), rot: r1((Math.atan2(ty, tx) * 180) / Math.PI), tone: r2(rng()) });
      }
    }
  }
}

// Manzanas reales: cada celda recortada por el área y CORTADA por las calzadas. Devuelve [{ ring, holes }] (anillos antihorarios, sin repetir el primer punto).
function blocksFrom(cells, poly, fill, blockers, corridor) {
  const minArea = fill.lotSize.width * fill.lotSize.depth * 1.5;
  const areaOnly = { ways: [], places: [], areas: blockers.areas };
  const convexArea = isConvex(poly); const polyGeom = [closed(poly)];
  const corridorBox = corridor ? boundsOf(corridor.flatMap((polygon) => polygon[0])) : null;
  const blocks = [];
  for (const cell of cells) {
    let geom;
    if (convexArea) { const clipped = clipByConvex(poly, cell); if (clipped.length < 3) continue; geom = [[closed(clipped)]]; }
    else geom = polygonClipping.intersection(polyGeom, [closed(cell)]);
    if (corridor && geom.length && boxesTouch(boundsOf(cell), corridorBox)) geom = polygonClipping.difference(geom, corridor);
    for (const polygon of geom) {
      const ring = dedupe(opened(polygon[0]));
      if (ring.length < 3) continue;
      const area = polygonArea(ring); const perimeter = ring.reduce((sum, p, i) => sum + Math.hypot(p[0] - ring[(i + 1) % ring.length][0], p[1] - ring[(i + 1) % ring.length][1]), 0);
      if (area < minArea || (2 * area) / perimeter < 2.5) continue;                       // demasiado pequeña o una astilla
      const center = [ring.reduce((sum, p) => sum + p[0], 0) / ring.length, ring.reduce((sum, p) => sum + p[1], 0) / ring.length];
      if (!pointFree(center[0], center[1], areaOnly, 0) || ring.some(([x, y]) => !pointFree(x, y, areaOnly, 0))) continue;
      blocks.push({ ring: ccw(ring), holes: polygon.slice(1).map((hole) => dedupe(opened(hole))).filter((hole) => hole.length >= 3) });
    }
  }
  return blocks;
}
function isConvex(poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length]; const c = poly[(i + 2) % poly.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) continue;
    if (!sign) sign = Math.sign(cross); else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

function generateForest(poly, fill, rng, blockers) {
  const { points, truncated } = poisson(poly, fill.treeSpacing, fill.treeSpacing * 1.5, rng, GEN_LIMITS.trees);
  const trees = [];
  for (const [x, y] of points) {
    if (rng() > fill.density) continue;
    const radius = fill.treeSpacing * (0.5 + rng() * 0.4); const tone = rng();   // la copa mide casi lo que la separación: se solapan y el bosque se ve frondoso
    if (pointFree(x, y, blockers, radius * 0.6)) trees.push({ x: r1(x), y: r1(y), r: r1(radius), tone: r2(tone) });
  }
  trees.sort((a, b) => a.y - b.y);                   // de atrás hacia delante, para pintarlas con solape
  return { blocks: [], buildings: [], trees, truncated };
}

const EMPTY = () => ({ blocks: [], buildings: [], trees: [], truncated: false });

// Genera el relleno de un área. `ctx` = { ways, places, areas } con lo que hay alrededor (ver `contextFor`). Devuelve
//   { blocks: [[[x,y]…]…], buildings: [{ x, y, w, d, rot, tone }…], trees: [{ x, y, r, tone }…], truncated }
// (metros; `rot` en grados; `tone` 0–1 para variar el color al pintar).
export function generateFill(area, ctx = {}) {
  const fill = area?.fill;
  if (!fill || fill.pattern === 'none' || !Array.isArray(area.polygon) || area.polygon.length < 3) return EMPTY();
  if (area.polygon.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)) || polygonSelfIntersects(area.polygon)) return EMPTY();
  const poly = ccw(area.polygon.map(([x, y]) => [x, y]));
  const rng = mulberry32(Number.isFinite(fill.seed) ? Math.round(fill.seed) : 1);
  const box = boundsOf(poly);
  if (fill.pattern === 'forest') return generateForest(poly, { ...FILL_DEFAULTS.forest, ...fill }, rng, buildBlockers(ctx, box, TREE_BLOCKING, area.id));
  const defaults = FILL_DEFAULTS[fill.pattern];
  if (!defaults) return EMPTY();
  const recipe = { ...defaults, ...fill, blockSize: { ...defaults.blockSize, ...fill.blockSize }, lotSize: { ...defaults.lotSize, ...fill.lotSize } };
  if (!(recipe.blockSize.min > 0 && recipe.blockSize.max >= recipe.blockSize.min && recipe.lotSize.width > 0 && recipe.lotSize.depth > 0 && recipe.streetWidth > 0)) return EMPTY();
  const blockers = buildBlockers(ctx, box, BUILD_BLOCKING, area.id);
  const made = recipe.pattern === 'grid' ? gridCells(poly, recipe, rng) : recipe.pattern === 'radial' ? radialCells(poly, recipe) : organicCells(poly, recipe, rng);
  const corridor = corridorOf(blockers.ways);     // los caminos cortan las manzanas; después ya no hace falta mirarlos casa por casa
  const blocks = blocksFrom(made.cells, poly, recipe, blockers, corridor);
  blockers.ways = [];
  const out = { blocks: [], buildings: [], trees: [], truncated: made.truncated };
  for (const block of blocks) { fillBlock(block, recipe, rng, blockers, out); if (out.truncated && out.buildings.length >= GEN_LIMITS.buildings) break; }
  out.blocks = blocks.map(({ ring }) => ring.map(([x, y]) => [r1(x), r1(y)]));
  return out;
}

// Lo que rodea a un área y puede afectar a su relleno (para generar y para saber cuándo hay que regenerar).
export function contextFor(area, map) {
  const box = growBounds(boundsOf(area.polygon.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }, 5);
  const kinds = area.fill?.pattern === 'forest' ? TREE_BLOCKING : BUILD_BLOCKING;
  return {
    ways: map.ways.filter((way) => way.points.length >= 2 && boxesTouch(growBounds(boundsOf(way.points), way.width / 2 + 5), box)).map((way) => ({ points: way.points, width: way.width })),
    places: map.places.filter((place) => place.x >= box.minX && place.x <= box.maxX && place.y >= box.minY && place.y <= box.maxY).map((place) => ({ x: place.x, y: place.y, footprint: place.footprint ?? null })),
    areas: map.areas.filter((other) => other.id !== area.id && kinds.has(other.kind) && other.polygon.length >= 3 && boxesTouch(boundsOf(other.polygon), box)).map((other) => ({ id: other.id, kind: other.kind, polygon: other.polygon }))
  };
}
