// Terreno pintable del mapa: una rejilla de celdas (por defecto 16 m) guardada por «trozos» de 32×32 celdas con compresión por repeticiones. Se pinta con
// pinceles (pintar, borrar, suavizar, rellenar) o se genera con ruido, y se dibuja con bordes naturales: el contorno de cada material sale de una
// rejilla suavizada (marching squares) y se deforma con ruido, así que las costas, los bosques y las montañas no se ven cuadriculados a ningún zoom.
// Los árboles y las montañas dibujadas se reparten por trozos con una semilla (nada de eso se guarda). Módulo compartido (navegador y Node).
//
// Los POLÍGONOS siguen sirviendo para las zonas urbanas (src/shared/mapGen.js); el terreno es el fondo natural sobre el que se colocan.
import { mulberry32 } from './mapGen.js';

// Los códigos 1–7 son los de siempre (los mapas guardados siguen valiendo); del 8 en adelante son los materiales de los mapas regionales.
export const TERRAIN_KINDS = ['water', 'land', 'sand', 'field', 'forest', 'park', 'mountain', 'snow', 'desert', 'arid', 'urban', 'industrial'];
export const TERRAIN_CODE = { none: 0, water: 1, land: 2, sand: 3, field: 4, forest: 5, park: 6, mountain: 7, snow: 8, desert: 9, arid: 10, urban: 11, industrial: 12 };
export const CODE_KIND = [null, ...TERRAIN_KINDS];
export const MAX_CODE = TERRAIN_KINDS.length;
export const TERRAIN_LABEL = { water: 'Agua', land: 'Tierra', sand: 'Arena', field: 'Campo', forest: 'Bosque', park: 'Parque', mountain: 'Montaña', snow: 'Nieve', desert: 'Desierto', arid: 'Zona árida', urban: 'Zona urbanizada', industrial: 'Industrial / degradado' };
export const CHUNK = 32;                                   // celdas por lado de un trozo
export const CHUNK_CELLS = CHUNK * CHUNK;
// `cell` es el lado de una celda en metros: 16 m para una ciudad, ~1 km para una región de cientos de kilómetros.
export const TERRAIN_LIMITS = { chunks: 6000, cell: [4, 5000], spacing: [2, 2000] };
export const TERRAIN_DEFAULTS = { cell: 16, seed: 1, forest: { spacing: 4.5, density: 0.9 } };
// Perfiles por escala para crear un mapa nuevo (el tamaño de celda y la separación de los árboles escalan juntos).
export const TERRAIN_PRESETS = {
  city: { label: 'Ciudad (celdas de 16 m)', cell: 16, forest: { spacing: 4.5, density: 0.9 } },
  region: { label: 'Región de cientos de km (celdas de 1 km)', cell: 1000, forest: { spacing: 400, density: 0.95 } },
  continent: { label: 'Continente (celdas de 5 km)', cell: 5000, forest: { spacing: 1800, density: 0.95 } }
};
// Orden de pintado de los materiales (la tierra es la base de todo lo pintado; el resto va encima).
export const PAINT_ORDER = ['water', 'sand', 'desert', 'arid', 'field', 'park', 'industrial', 'urban', 'forest', 'mountain', 'snow'];
const MAX_SCATTER = 60000;
// Lo que se dispersa por trozos con semilla: copas (bosque), cumbres (montaña, nieve) y manzanas de edificios (zonas urbanas e industriales).
// `spacing(terrain)` es la separación base en metros; con 16 m de celda sale lo de siempre (40 m entre cumbres).
const SCATTER = {
  forest: { code: 'forest', salt: 11, spacing: (t) => t.forest.spacing, density: (t) => t.forest.density, radius: (spacing, g) => spacing * (0.5 + g * 0.4), reach: 0.7, minPixels: 2.5 },
  mountain: { code: 'mountain', salt: 23, spacing: (t) => Math.max(40, t.cell * 2.5), density: () => 0.8, radius: (spacing, g) => spacing * (0.32 + g * 0.3), reach: 0.5, minPixels: 2.5 },
  snow: { code: 'snow', salt: 29, spacing: (t) => Math.max(40, t.cell * 2.5), density: () => 0.8, radius: (spacing, g) => spacing * (0.32 + g * 0.3), reach: 0.5, minPixels: 2.5 },
  urban: { code: 'urban', salt: 37, spacing: (t) => Math.max(8, t.cell * 0.32), density: () => 0.92, radius: (spacing, g) => spacing * (0.2 + g * 0.2), reach: 0.3, minPixels: 1.4 },
  industrial: { code: 'industrial', salt: 41, spacing: (t) => Math.max(8, t.cell * 0.4), density: () => 0.7, radius: (spacing, g) => spacing * (0.2 + g * 0.26), reach: 0.3, minPixels: 1.4 }
};
export const SCATTER_KINDS = Object.keys(SCATTER);
const EDGE_MARGINS = [2, 4, 8, 16, 32];

// --- Ruido determinista -----------------------------------------------------------------------------------------------------------------------------
function hash2(seed, x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((seed | 0) + 1013904223, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(seed, x, y) {
  const ix = Math.floor(x); const iy = Math.floor(y); const fx = x - ix; const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx); const v = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, ix, iy); const b = hash2(seed, ix + 1, iy); const c = hash2(seed, ix, iy + 1); const d = hash2(seed, ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(seed, x, y, octaves = 5) {
  let sum = 0; let amplitude = 0.5; let total = 0;
  for (let o = 0; o < octaves; o++) { sum += valueNoise(seed + o * 101, x, y) * amplitude; total += amplitude; x *= 2.03; y *= 2.03; amplitude *= 0.5; }
  return sum / total;
}
const chunkRng = (seed, cx, cy, lod, salt) => mulberry32(((seed * 73856093) ^ (cx * 19349663) ^ (cy * 83492791) ^ (lod * 2654435761) ^ salt) >>> 0);

// --- Compresión de un trozo: «código*repeticiones» separados por comas (la repetición 1 se omite) -----------------------------------------------------
export function encodeChunk(cells) {
  const parts = []; let i = 0;
  while (i < cells.length) {
    let j = i + 1; while (j < cells.length && cells[j] === cells[i]) j++;
    parts.push(j - i === 1 ? String(cells[i]) : `${cells[i]}*${j - i}`); i = j;
  }
  return parts.join(',');
}
// null si el texto no es un trozo válido (códigos desconocidos o un número de celdas distinto de 32×32).
export function decodeChunk(text) {
  if (typeof text !== 'string' || !text || text.length > 40000) return null;
  const out = new Uint8Array(CHUNK_CELLS); let n = 0;
  for (const part of text.split(',')) {
    const match = /^(\d{1,2})(?:\*(\d{1,4}))?$/.exec(part); if (!match || Number(match[1]) > MAX_CODE) return null;
    const run = match[2] ? Number(match[2]) : 1;
    if (run < 1 || n + run > CHUNK_CELLS) return null;
    out.fill(Number(match[1]), n, n + run); n += run;
  }
  return n === CHUNK_CELLS ? out : null;
}
const KEY = /^-?\d{1,5},-?\d{1,5}$/;
const keyOf = (cx, cy) => `${cx},${cy}`;

export function emptyTerrain() { return { cell: TERRAIN_DEFAULTS.cell, seed: TERRAIN_DEFAULTS.seed, forest: { ...TERRAIN_DEFAULTS.forest }, chunks: {} }; }

// Caja (en metros) que cubren los trozos guardados, sin decodificarlos. null si no hay ninguno.
export function terrainBoundsOf(data) {
  if (!data?.chunks) return null;
  let box = null; const size = data.cell * CHUNK;
  for (const key of Object.keys(data.chunks)) {
    if (!KEY.test(key)) continue;
    const [cx, cy] = key.split(',').map(Number);
    const part = { minX: cx * size, minY: cy * size, maxX: (cx + 1) * size, maxY: (cy + 1) * size };
    box = box ? { minX: Math.min(box.minX, part.minX), minY: Math.min(box.minY, part.minY), maxX: Math.max(box.maxX, part.maxX), maxY: Math.max(box.maxY, part.maxY) } : part;
  }
  return box;
}

// --- La rejilla -------------------------------------------------------------------------------------------------------------------------------------
export class Terrain {
  constructor(data = null) {
    const base = emptyTerrain();
    this.cell = data?.cell > 0 ? data.cell : base.cell; this.seed = Number.isFinite(data?.seed) ? data.seed : base.seed;
    this.forest = { ...base.forest, ...(data?.forest ?? {}) };
    this.chunks = new Map(); this.rev = new Map(); this.edge = new Map(); this.version = 0; this._memo = null; this._masks = new Map(); this._blocks = new Map();
    for (const [key, text] of Object.entries(data?.chunks ?? {})) { const cells = decodeChunk(text); if (cells && KEY.test(key)) this.chunks.set(key, cells); }
  }

  chunk(cx, cy, create = false) {
    const key = keyOf(cx, cy); let cells = this.chunks.get(key);
    if (!cells && create) { cells = new Uint8Array(CHUNK_CELLS); this.chunks.set(key, cells); }
    return cells;
  }
  // Código del material de la celda (i, j); 0 = sin pintar.
  get(i, j) {
    const cx = Math.floor(i / CHUNK); const cy = Math.floor(j / CHUNK);
    const cells = this.chunks.get(keyOf(cx, cy));
    return cells ? cells[(j - cy * CHUNK) * CHUNK + (i - cx * CHUNK)] : 0;
  }
  set(i, j, code) {
    const cx = Math.floor(i / CHUNK); const cy = Math.floor(j / CHUNK);
    const cells = this.chunk(cx, cy, code !== 0); if (!cells) return false;
    const index = (j - cy * CHUNK) * CHUNK + (i - cx * CHUNK);
    if (cells[index] === code) return false;
    cells[index] = code; const key = keyOf(cx, cy); this.rev.set(key, (this.rev.get(key) ?? 0) + 1); this.version++;
    // Los vecinos solo notan el cambio si cae cerca de su borde (el contorno mira unas pocas celdas más allá del trozo): así pintar en medio no invalida todo alrededor.
    const lx = i - cx * CHUNK; const ly = j - cy * CHUNK; const d = Math.min(lx, CHUNK - 1 - lx, ly, CHUNK - 1 - ly);
    for (const margin of EDGE_MARGINS) if (d < margin) { const id = `${margin}|${key}`; this.edge.set(id, (this.edge.get(id) ?? 0) + 1); }
    return true;
  }
  cellOf(x, y) { return [Math.floor(x / this.cell), Math.floor(y / this.cell)]; }
  kindAt(x, y) { const [i, j] = this.cellOf(x, y); return CODE_KIND[this.get(i, j)]; }

  // Cambia cuando se toca el trozo o el borde de sus vecinos (el contorno depende de las celdas de al lado; `stride` = paso del contorno). Sirve para cachear lo dibujado.
  signature(cx, cy, stride = 1) {
    const margin = EDGE_MARGINS.find((m) => m >= 2 * stride) ?? CHUNK;
    let text = `${this.rev.get(keyOf(cx, cy)) ?? 0}:`;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) text += `${this.edge.get(`${margin}|${keyOf(cx + dx, cy + dy)}`) ?? 0}.`;
    return text;
  }
  // Trozos con algo pintado más sus vecinos (los bordes del contorno caen en el trozo de al lado).
  renderChunks() {
    if (this._memo?.version === this.version) return this._memo.list;
    const out = new Set();
    for (const [key, cells] of this.chunks) {
      if (!cells.some((code) => code)) continue;
      const [cx, cy] = key.split(',').map(Number);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.add(keyOf(cx + dx, cy + dy));
    }
    const list = [...out].map((key) => key.split(',').map(Number));
    this._memo = { version: this.version, list };
    return list;
  }
  // Máscara de bits con los materiales que hay en un trozo (bit = código), y la de él con sus 8 vecinos (el contorno de un trozo depende de ellos).
  codesIn(cx, cy) {
    const key = keyOf(cx, cy); const rev = this.rev.get(key) ?? 0; const cached = this._masks.get(key);
    if (cached?.rev === rev) return cached.mask;
    let mask = 0; const cells = this.chunks.get(key);
    if (cells) for (let i = 0; i < cells.length; i++) mask |= 1 << cells[i];
    this._masks.set(key, { rev, mask });
    return mask;
  }
  codesNear(cx, cy) { let mask = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) mask |= this.codesIn(cx + dx, cy + dy); return mask; }
  // Fracción de cada bloque de s×s celdas de un trozo que es del material `code` (0 = cualquier cosa pintada); null si el trozo está vacío. Se cachea por trozo.
  blocks(cx, cy, s, code) {
    const key = `${cx},${cy}`; const cells = this.chunks.get(key); if (!cells) return null;
    const rev = this.rev.get(key) ?? 0; const id = `${key}|${s}|${code}`; const cached = this._blocks.get(id);
    if (cached?.rev === rev) return cached.data;
    const n = CHUNK / s; const data = new Float32Array(n * n); const weight = 1 / (s * s);
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) { const value = cells[y * CHUNK + x]; if (code === 0 ? value !== 0 : value === code) data[Math.floor(y / s) * n + Math.floor(x / s)] += weight; }
    this._blocks.set(id, { rev, data });
    return data;
  }

  paintedCells() { let n = 0; for (const cells of this.chunks.values()) for (const code of cells) if (code) n++; return n; }
  isEmpty() { for (const cells of this.chunks.values()) if (cells.some((code) => code)) return false; return true; }

  toData() {
    const chunks = {};
    for (const [key, cells] of [...this.chunks].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) if (cells.some((code) => code)) chunks[key] = encodeChunk(cells);
    return { cell: this.cell, seed: this.seed, forest: { spacing: this.forest.spacing, density: this.forest.density }, chunks };
  }
}

// --- Pinceles ---------------------------------------------------------------------------------------------------------------------------------------
// Pinta, borra o suaviza a lo largo de una línea de puntos [[x, y]…] (metros) con un pincel redondo de `radius` metros.
//   kind: material (o null/'none' para borrar) · mode: 'paint' | 'erase' | 'smooth'
//   rugged 0–1: cuánto se deshace el borde del pincel (da orillas naturales) · protect: materiales que NO se pisan (p. ej. ['water'])
// Devuelve cuántas celdas cambió.
export function paintStroke(terrain, points, radius, kind, { mode = 'paint', rugged = 0.35, protect = [] } = {}) {
  if (!points.length || !(radius > 0)) return 0;
  const code = mode === 'erase' || !kind || kind === 'none' ? 0 : TERRAIN_CODE[kind];
  if (mode !== 'smooth' && code === undefined) return 0;
  const guarded = new Set(protect.map((name) => TERRAIN_CODE[name]).filter((value) => value));
  const cell = terrain.cell; const step = Math.max(cell * 0.5, radius / 3);
  const stamps = [];
  if (points.length === 1) stamps.push(points[0]);
  for (let s = 1; s < points.length; s++) {
    const [ax, ay] = points[s - 1]; const [bx, by] = points[s]; const length = Math.hypot(bx - ax, by - ay); const n = Math.max(1, Math.ceil(length / step));
    for (let k = s === 1 ? 0 : 1; k <= n; k++) stamps.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  let changed = 0; const pending = new Map();
  for (const [sx, sy] of stamps) {
    const reach = radius * (1 + rugged * 0.35) + cell;
    const i0 = Math.floor((sx - reach) / cell); const i1 = Math.floor((sx + reach) / cell); const j0 = Math.floor((sy - reach) / cell); const j1 = Math.floor((sy + reach) / cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot((i + 0.5) * cell - sx, (j + 0.5) * cell - sy);
      const edge = radius * (1 + rugged * 0.35 * (valueNoise(terrain.seed + 7, i * 0.45, j * 0.45) * 2 - 1));
      if (d > edge) continue;
      if (mode === 'smooth') { pending.set(`${i},${j}`, [i, j]); continue; }
      const current = terrain.get(i, j);
      if (current === code || (guarded.has(current) && code !== current)) continue;
      if (terrain.set(i, j, code)) changed++;
    }
  }
  if (mode === 'smooth') {
    const updates = [];
    for (const [i, j] of pending.values()) {
      const counts = new Uint8Array(8);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) counts[terrain.get(i + di, j + dj)]++;
      let best = terrain.get(i, j);
      for (let c = 0; c < 8; c++) if (counts[c] > counts[best] + 1) best = c;     // solo cambia si la mayoría es clara: el borde se alisa sin comerse la forma
      if (best !== terrain.get(i, j) && !guarded.has(terrain.get(i, j))) updates.push([i, j, best]);
    }
    for (const [i, j, c] of updates) if (terrain.set(i, j, c)) changed++;
  }
  return changed;
}

// Bote de pintura: cambia toda la región conectada de celdas iguales (4 vecinos) a otro material. `limit` evita llenar el vacío infinito.
export function floodFill(terrain, x, y, kind, { limit = 250000 } = {}) {
  const code = !kind || kind === 'none' ? 0 : TERRAIN_CODE[kind]; if (code === undefined) return { filled: 0, truncated: false };
  const [si, sj] = terrain.cellOf(x, y); const from = terrain.get(si, sj);
  if (from === code) return { filled: 0, truncated: false };
  const seen = new Set([`${si},${sj}`]); const queue = [[si, sj]]; const found = [];
  while (queue.length) {
    const [i, j] = queue.pop();
    if (found.length >= limit) return { filled: 0, truncated: true };
    found.push([i, j]);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${i + di},${j + dj}`;
      if (!seen.has(key) && terrain.get(i + di, j + dj) === from) { seen.add(key); queue.push([i + di, j + dj]); }
    }
  }
  for (const [i, j] of found) terrain.set(i, j, code);
  return { filled: found.length, truncated: false };
}

// --- Generación natural ------------------------------------------------------------------------------------------------------------------------------
// Rellena un rectángulo (metros) con terreno de aspecto natural a partir de ruido: mar y costas con arena, tierra, campos, bosques y montañas.
//   scale: tamaño de las formas (m) · sea/forest/mountains/fields: 0–1 · island: 0–1 (cuánto se aleja la tierra de los bordes) · overwrite: pisa lo ya pintado
export function generateTerrain(terrain, rect, { seed = 1, scale = 1800, sea = 0.45, forest = 0.45, mountains = 0.35, fields = 0.25, island = 0, overwrite = false } = {}) {
  const cell = terrain.cell;
  const i0 = Math.floor(rect.minX / cell); const i1 = Math.floor(rect.maxX / cell); const j0 = Math.floor(rect.minY / cell); const j1 = Math.floor(rect.maxY / cell);
  const cx = (rect.minX + rect.maxX) / 2; const cy = (rect.minY + rect.maxY) / 2; const rx = Math.max(1, (rect.maxX - rect.minX) / 2); const ry = Math.max(1, (rect.maxY - rect.minY) / 2);
  // el ruido por octavas se concentra cerca de 0,45: se estira para que los controles 0–1 se parezcan a la proporción que producen
  const stretch = (value, center, gain) => Math.min(1, Math.max(0, (value - center) * gain + 0.5));
  const seaLevel = 0.12 + 0.76 * sea; const mountainLevel = Math.max(seaLevel + 0.15, 1 - 0.4 * mountains);
  const forestLevel = 0.95 - 0.6 * forest; const fieldLevel = fields * 0.6;
  const sandBand = Math.max(0.03, ((cell * 2.5) / scale) * 0.9);
  let changed = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    if (!overwrite && terrain.get(i, j) !== 0) continue;
    const x = (i + 0.5) * cell; const y = (j + 0.5) * cell;
    let height = stretch(fbm(seed, x / scale, y / scale, 6), 0.43, 2.6);
    if (island > 0) { const d = Math.min(1, Math.hypot((x - cx) / rx, (y - cy) / ry)); height -= island * 0.55 * d * d; }
    let kind;
    if (height < seaLevel) kind = 'water';
    else if (height < seaLevel + sandBand) kind = 'sand';
    else if (height > mountainLevel) kind = 'mountain';
    else {
      const moisture = stretch(fbm(seed + 5000, x / (scale * 0.55), y / (scale * 0.55), 5), 0.5, 3);
      const patches = stretch(fbm(seed + 9000, x / (scale * 0.3), y / (scale * 0.3), 4), 0.45, 3);
      kind = moisture > forestLevel ? 'forest' : patches < fieldLevel && moisture < 0.62 ? 'field' : 'land';
    }
    if (terrain.set(i, j, TERRAIN_CODE[kind])) changed++;
  }
  return changed;
}

// --- Contornos naturales (marching squares sobre una rejilla suavizada y deformada con ruido) ----------------------------------------------------------
// `code` = material (0 = cualquier cosa pintada). `stride` = celdas por paso (potencia de 2; se usa al alejar el zoom).
// Devuelve { fill, line }: listas planas de números. fill = [n, x0, y0, x1, y1, …, n, …] (polígonos en metros); line = [x0, y0, x1, y1, …] (segmentos del borde).
export function contourChunk(terrain, cx, cy, code, stride = 1) {
  const s = Math.max(1, Math.min(CHUNK, stride | 0)); const n = CHUNK / s; const cell = terrain.cell;
  const a0 = cx * n; const b0 = cy * n; const m = n + 5;
  const raw = new Float32Array(m * m); const seen = new Map();
  for (let jj = 0; jj < m; jj++) for (let ii = 0; ii < m; ii++) {
    const A = a0 - 2 + ii; const B = b0 - 2 + jj; const ox = Math.floor(A / n); const oy = Math.floor(B / n); const id = oy * 100003 + ox;
    let data = seen.get(id); if (data === undefined) { data = terrain.blocks(ox, oy, s, code); seen.set(id, data); }
    raw[jj * m + ii] = data ? data[(B - oy * n) * n + (A - ox * n)] : 0;
  }
  const tmp = new Float32Array(m * m); const blurred = new Float32Array(m * m);
  for (let jj = 0; jj < m; jj++) for (let ii = 1; ii < m - 1; ii++) tmp[jj * m + ii] = (raw[jj * m + ii - 1] + 2 * raw[jj * m + ii] + raw[jj * m + ii + 1]) / 4;
  for (let jj = 1; jj < m - 1; jj++) for (let ii = 1; ii < m - 1; ii++) blurred[jj * m + ii] = (tmp[(jj - 1) * m + ii] + 2 * tmp[jj * m + ii] + tmp[(jj + 1) * m + ii]) / 4;
  const F = (A, B) => blurred[(B - (b0 - 2)) * m + (A - (a0 - 2))];
  const amplitude = cell * Math.max(1, s) * 0.5; const wave = 1 / (cell * Math.max(1, s) * 2.6); const seed = terrain.seed;
  const place = (A, B) => [(A * s + s / 2) * cell, (B * s + s / 2) * cell];
  const warp = (x, y) => [x + (valueNoise(seed + 31, x * wave, y * wave) - 0.5) * 2 * amplitude, y + (valueNoise(seed + 77, x * wave, y * wave) - 0.5) * 2 * amplitude];
  const fill = []; const line = [];
  for (let B = b0; B < b0 + n; B++) for (let A = a0; A < a0 + n; A++) {
    const corners = [[A, B, F(A, B)], [A + 1, B, F(A + 1, B)], [A + 1, B + 1, F(A + 1, B + 1)], [A, B + 1, F(A, B + 1)]];
    const inside = corners.map((corner) => corner[2] >= 0.5);
    if (!inside.some(Boolean)) continue;
    const polygon = []; const crossings = [];
    for (let e = 0; e < 4; e++) {
      const c0 = corners[e]; const c1 = corners[(e + 1) % 4];
      if (inside[e]) polygon.push(warp(...place(c0[0], c0[1])));
      if (inside[e] !== inside[(e + 1) % 4]) {
        const t = (0.5 - c0[2]) / (c1[2] - c0[2]); const p0 = place(c0[0], c0[1]); const p1 = place(c1[0], c1[1]);
        const point = warp(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t); polygon.push(point); crossings.push(point);
      }
    }
    fill.push(polygon.length); for (const [x, y] of polygon) fill.push(x, y);
    if (crossings.length === 2) line.push(crossings[0][0], crossings[0][1], crossings[1][0], crossings[1][1]);
    else if (crossings.length === 4) line.push(crossings[0][0], crossings[0][1], crossings[1][0], crossings[1][1], crossings[2][0], crossings[2][1], crossings[3][0], crossings[3][1]);
  }
  return { fill, line };
}

// Zoom → paso de contorno: el más fino cuyas celdas se ven de al menos ~3 píxeles.
export function strideFor(cell, k) { let s = 1; while (s < CHUNK && cell * s * k < 3) s *= 2; return s; }

// --- Árboles, cumbres y manzanas dibujadas por trozos ----------------------------------------------------------------------------------------------------
// `lod` ≥ 0 agranda el espaciado ×2^lod (al alejar el zoom, menos copas pero más grandes, para que el bosque siga viéndose tupido).
// Devuelve [{ x, y, r, tone }] ordenado por y (se pintan de atrás hacia delante). El reparto no cambia si se pinta otro trozo.
// `kind`: 'forest' | 'mountain' | 'snow' | 'urban' | 'industrial' (ver SCATTER).
export function scatterChunk(terrain, cx, cy, kind, lod = 0) {
  const spec = SCATTER[kind]; if (!spec) return [];
  const code = TERRAIN_CODE[spec.code]; const cell = terrain.cell; const size = CHUNK * cell;
  const spacing = Math.max(spec.spacing(terrain) * 2 ** lod, size / 600);   // tope de puntos por trozo: un separado absurdo no cuelga el editor
  const density = spec.density(terrain);
  const x0 = cx * size; const y0 = cy * size;
  const m = CHUNK + 5; const raw = new Float32Array(m * m); const tmp = new Float32Array(m * m); const blurred = new Float32Array(m * m);
  let any = false;
  for (let jj = 0; jj < m; jj++) for (let ii = 0; ii < m; ii++) { const hit = terrain.get(cx * CHUNK - 2 + ii, cy * CHUNK - 2 + jj) === code ? 1 : 0; raw[jj * m + ii] = hit; if (hit) any = true; }
  if (!any) return [];
  for (let jj = 0; jj < m; jj++) for (let ii = 1; ii < m - 1; ii++) tmp[jj * m + ii] = (raw[jj * m + ii - 1] + 2 * raw[jj * m + ii] + raw[jj * m + ii + 1]) / 4;
  for (let jj = 1; jj < m - 1; jj++) for (let ii = 1; ii < m - 1; ii++) blurred[jj * m + ii] = (tmp[(jj - 1) * m + ii] + 2 * tmp[jj * m + ii] + tmp[(jj + 1) * m + ii]) / 4;
  const sample = (x, y) => {   // interpolación bilineal de la rejilla suavizada (los puntos están en el centro de cada celda)
    const fx = (x - x0) / cell - 0.5 + 2; const fy = (y - y0) / cell - 0.5 + 2; const ix = Math.floor(fx); const iy = Math.floor(fy);
    if (ix < 1 || iy < 1 || ix >= m - 2 || iy >= m - 2) return 0;
    const u = fx - ix; const v = fy - iy;
    return blurred[iy * m + ix] * (1 - u) * (1 - v) + blurred[iy * m + ix + 1] * u * (1 - v) + blurred[(iy + 1) * m + ix] * (1 - u) * v + blurred[(iy + 1) * m + ix + 1] * u * v;
  };
  const rng = chunkRng(terrain.seed, cx, cy, lod, spec.salt); const steps = Math.ceil(size / spacing); const out = [];
  for (let gj = 0; gj < steps; gj++) for (let gi = 0; gi < steps; gi++) {
    const x = x0 + (gi + 0.5 + (rng() - 0.5) * 0.9) * spacing; const y = y0 + (gj + 0.5 + (rng() - 0.5) * 0.9) * spacing;
    const keep = rng(); const grow = rng(); const tone = rng();
    if (x >= x0 + size || y >= y0 + size || keep > density || sample(x, y) < 0.58) continue;
    out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.round(spec.radius(spacing, grow) * 10) / 10, tone: Math.round(tone * 100) / 100 });
    if (out.length >= MAX_SCATTER) break;
  }
  return out.sort((a, b) => a.y - b.y);
}

// Nivel de detalle para un zoom: lo que se dibuja (copas, cumbres, manzanas) debe verse de al menos ~minPixels píxeles.
// Sin `kind` es el de los árboles, como siempre.
export function lodFor(terrain, k, kind = 'forest') {
  const spec = SCATTER[kind] ?? SCATTER.forest;
  const radius = spec.spacing(terrain) * spec.reach; let lod = 0;
  while (lod < 6 && radius * 2 ** lod * k < spec.minPixels) lod++;
  return lod;
}

// --- Formas ---------------------------------------------------------------------------------------------------------------------------------------
// Pinta (o borra) las celdas cuyo centro cae dentro de un polígono [[x, y]…] (metros). El borde se deforma con ruido (`rugged` 0–1, en celdas) para que
// no salga recto. `protect`: materiales que no se pisan. Devuelve cuántas celdas cambió. Sirve para trazar mares, desiertos o cordilleras de una vez.
export function paintPolygon(terrain, polygon, kind, { mode = 'paint', rugged = 0.5, protect = [] } = {}) {
  if (polygon.length < 3) return 0;
  const code = mode === 'erase' || !kind || kind === 'none' ? 0 : TERRAIN_CODE[kind];
  if (code === undefined) return 0;
  const guarded = new Set(protect.map((name) => TERRAIN_CODE[name]).filter((value) => value));
  const cell = terrain.cell; const box = boundsFromPoints(polygon);
  const i0 = Math.floor(box.minX / cell) - 2; const i1 = Math.floor(box.maxX / cell) + 2; const j0 = Math.floor(box.minY / cell) - 2; const j1 = Math.floor(box.maxY / cell) + 2;
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4_000_000) return 0;
  let changed = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    let x = (i + 0.5) * cell; let y = (j + 0.5) * cell;
    if (rugged > 0) { x += (valueNoise(terrain.seed + 211, i * 0.37, j * 0.37) - 0.5) * 2 * rugged * cell * 1.6; y += (valueNoise(terrain.seed + 317, i * 0.37, j * 0.37) - 0.5) * 2 * rugged * cell * 1.6; }
    if (!insidePolygon(x, y, polygon)) continue;
    const current = terrain.get(i, j);
    if (current === code || (guarded.has(current) && code !== current)) continue;
    if (terrain.set(i, j, code)) changed++;
  }
  return changed;
}
function boundsFromPoints(points) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of points) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return { minX, minY, maxX, maxY };
}
function insidePolygon(x, y, polygon) {   // trazado de rayos
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
