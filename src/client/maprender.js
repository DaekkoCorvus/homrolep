// Pintor del mapa (canvas 2D + postproceso WebGL). Pinta áreas, relleno generado, caminos y nombres con la paleta de un estilo (src/shared/mapStyle.js) y
// después pasa un shader sobre la imagen (grano de papel, manchas, viñeta, saturación, contraste, calidez, tinta en los bordes). El editor lo usa para
// la «vista final» y el relleno en vivo; el exportador de teselas usará exactamente estas mismas funciones, así que lo que se ve es lo que se hornea.
import { pickIndex } from '/shared/mapStyle.js';
import { PAINT_ORDER, TERRAIN_CODE, CHUNK, contourChunk, strideFor, scatterChunk, lodFor } from '/shared/mapTerrain.js';
import { polygonArea, polygonCentroid } from '/shared/geo.js';

const CASED = new Set(['avenue', 'street', 'path', 'bridge']);
const worldBox = (v, pad = 0) => ({ minX: -v.tx / v.k - pad, minY: -v.ty / v.k - pad, maxX: (v.width - v.tx) / v.k + pad, maxY: (v.height - v.ty) / v.k + pad });

function polygonPath(points, v, path = new Path2D()) {
  points.forEach(([x, y], index) => (index ? path.lineTo(x * v.k + v.tx, y * v.k + v.ty) : path.moveTo(x * v.k + v.tx, y * v.k + v.ty)));
  path.closePath();
  return path;
}

// Relleno generado de UN área (manzanas, sombras, casas, árboles). `v` = { k, tx, ty, width, height } (píxeles por metro y desplazamiento).
// `lite`: menos detalle y menos operaciones de dibujo (sin sombras ni cresterías, copas agrupadas por color): lo usa el mapa del juego en equipos lentos.
export function drawFill(ctx, v, result, theme, lite = false) {
  const { k, tx, ty } = v; const box = worldBox(v, 40);
  const style = theme.buildings; const trees = theme.trees;
  if (k > 0.004 && result.blocks.length) {
    ctx.fillStyle = theme.block; const path = new Path2D();
    for (const block of result.blocks) polygonPath(block, v, path);
    ctx.fill(path);
  }
  if (k >= 0.08 && result.buildings.length) {
    const visible = result.buildings.filter((b) => b.x >= box.minX && b.x <= box.maxX && b.y >= box.minY && b.y <= box.maxY);
    const quad = (target, b, dx = 0, dy = 0) => {
      const cx = (b.x + dx) * k + tx; const cy = (b.y + dy) * k + ty; const hw = (b.w * k) / 2; const hd = (b.d * k) / 2;
      if (hw < 1.2) { target.rect(cx - hw, cy - hd, hw * 2, hd * 2); return; }
      const a = (b.rot * Math.PI) / 180; const ux = Math.cos(a); const uy = Math.sin(a);
      target.moveTo(cx - ux * hw + uy * hd, cy - uy * hw - ux * hd); target.lineTo(cx + ux * hw + uy * hd, cy + uy * hw - ux * hd);
      target.lineTo(cx + ux * hw - uy * hd, cy + uy * hw + ux * hd); target.lineTo(cx - ux * hw - uy * hd, cy - uy * hw + ux * hd); target.closePath();
    };
    if (style.shadow && k >= 0.25 && !lite) {
      const shadow = new Path2D(); for (const b of visible) quad(shadow, b, style.shadow.dx, style.shadow.dy);
      ctx.globalAlpha = style.shadow.alpha; ctx.fillStyle = style.shadow.color; ctx.fill(shadow); ctx.globalAlpha = 1;
    }
    const paths = style.colors.map(() => new Path2D()); const outline = new Path2D(); const ridge = new Path2D();
    for (const b of visible) {
      quad(paths[pickIndex(b.tone, style.cumulative)], b);
      if (k > 0.5) quad(outline, b);
      if (style.ridge && k > 0.6 && !lite) {
        const a = (b.rot * Math.PI) / 180; const ux = Math.cos(a); const uy = Math.sin(a); const cx = b.x * k + tx; const cy = b.y * k + ty; const hw = (b.w * k) / 2;
        ridge.moveTo(cx - ux * hw, cy - uy * hw); ridge.lineTo(cx + ux * hw, cy + uy * hw);
      }
    }
    paths.forEach((path, index) => { ctx.fillStyle = style.colors[index]; ctx.fill(path); });
    if (style.ridge && k > 0.6 && !lite) { ctx.strokeStyle = '#00000040'; ctx.lineWidth = 1; ctx.stroke(ridge); }
    if (k > 0.5) { ctx.strokeStyle = style.edge; ctx.lineWidth = 0.8; ctx.stroke(outline); }
  }
  if (result.trees.length) drawCanopies(ctx, v, result.trees, theme, lite);
}

// Copas de árboles: se pintan de atrás hacia delante (la lista llega ordenada por y) con borde oscuro, color y brillo, para que se solapen y el bosque se vea tupido.
// Con muchísimas copas a la vista (más de 4000) se agrupan por color, sin orden ni brillo, para no perder fluidez.
export function drawCanopies(ctx, v, trees, theme, lite = false) {
  const { k, tx, ty } = v; const box = worldBox(v, 40); const style = theme.trees;
  const visible = trees.filter((t) => t.x + t.r >= box.minX && t.x - t.r <= box.maxX && t.y + t.r >= box.minY && t.y - t.r <= box.maxY && t.r * k >= 0.6);
  if (!visible.length) return;
  const colorOf = (t) => style.colors[Math.min(style.colors.length - 1, Math.floor(t.tone * style.colors.length))];
  if (style.shadow && visible.length < 3000 && k >= 0.2 && !lite) {
    const shadow = new Path2D();
    for (const t of visible) { const r = t.r * k; const cx = (t.x + style.shadow.dx) * k + tx; const cy = (t.y + style.shadow.dy) * k + ty; shadow.moveTo(cx + r, cy); shadow.arc(cx, cy, r, 0, Math.PI * 2); }
    ctx.globalAlpha = style.shadow.alpha; ctx.fillStyle = style.shadow.color; ctx.fill(shadow); ctx.globalAlpha = 1;
  }
  if (visible.length <= (lite ? 400 : 4000)) {
    for (const t of visible) {
      const r = t.r * k; const cx = t.x * k + tx; const cy = t.y * k + ty;
      if (r < 1.6) { ctx.fillStyle = colorOf(t); ctx.fillRect(cx - r, cy - r, r * 2, r * 2); continue; }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = style.rim; ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy - r * 0.04, r * 0.88, 0, Math.PI * 2); ctx.fillStyle = colorOf(t); ctx.fill();
      if (style.highlight && r > 3) { ctx.beginPath(); ctx.arc(cx - r * 0.28, cy - r * 0.34, r * 0.46, 0, Math.PI * 2); ctx.fillStyle = style.highlight; ctx.fill(); }
    }
    return;
  }
  const rims = new Path2D(); const paths = style.colors.map(() => new Path2D());
  for (const t of visible) {
    const r = t.r * k; const cx = t.x * k + tx; const cy = t.y * k + ty;
    rims.moveTo(cx + r, cy); rims.arc(cx, cy, r, 0, Math.PI * 2);
    const path = paths[Math.min(style.colors.length - 1, Math.floor(t.tone * style.colors.length))]; path.moveTo(cx + r * 0.88, cy); path.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
  }
  ctx.fillStyle = style.rim; ctx.fill(rims);
  paths.forEach((path, index) => { ctx.fillStyle = style.colors[index]; ctx.fill(path); });
}

// Montañas dibujadas: triángulos con una cara clara y otra oscura.
function drawPeaks(ctx, v, peaks, theme) {
  const { k, tx, ty } = v; const box = worldBox(v, 60);
  const light = new Path2D(); const dark = new Path2D(); const edge = new Path2D();
  for (const p of peaks) {
    if (p.x < box.minX || p.x > box.maxX || p.y < box.minY || p.y > box.maxY || p.r * k < 2) continue;
    const r = p.r * k * (0.9 + p.tone * 0.3); const cx = p.x * k + tx; const cy = p.y * k + ty;
    light.moveTo(cx, cy - r); light.lineTo(cx - r * 0.95, cy + r * 0.55); light.lineTo(cx + r * 0.05, cy + r * 0.55); light.closePath();
    dark.moveTo(cx, cy - r); dark.lineTo(cx + r * 0.95, cy + r * 0.55); dark.lineTo(cx + r * 0.05, cy + r * 0.55); dark.closePath();
    edge.moveTo(cx - r * 0.95, cy + r * 0.55); edge.lineTo(cx, cy - r); edge.lineTo(cx + r * 0.95, cy + r * 0.55);
  }
  ctx.fillStyle = theme.mountain.light; ctx.fill(light); ctx.fillStyle = theme.mountain.dark; ctx.fill(dark);
  ctx.strokeStyle = theme.mountain.dark; ctx.lineWidth = 0.8; ctx.stroke(edge);
}

// --- Terreno pintado (rejilla de celdas con bordes naturales; ver src/shared/mapTerrain.js) -------------------------------------------------------------
const terrainCaches = new WeakMap();
function pathsFor(cache, terrain, cx, cy, code, stride) {
  const key = `${cx},${cy},${code},${stride}`; const signature = terrain.signature(cx, cy, stride); const cached = cache.paths.get(key);
  if (cached?.signature === signature) return cached;
  const { fill, line } = contourChunk(terrain, cx, cy, code, stride);
  const area = new Path2D(); let i = 0;
  while (i < fill.length) { const n = fill[i++]; area.moveTo(fill[i], fill[i + 1]); for (let p = 1; p < n; p++) area.lineTo(fill[i + p * 2], fill[i + p * 2 + 1]); area.closePath(); i += n * 2; }
  const edge = new Path2D(); for (let s = 0; s < line.length; s += 4) { edge.moveTo(line[s], line[s + 1]); edge.lineTo(line[s + 2], line[s + 3]); }
  const entry = { signature, area, edge, empty: fill.length === 0 };
  cache.paths.set(key, entry);
  return entry;
}
function scatterFor(cache, terrain, cx, cy, kind, lod) {
  const key = `${cx},${cy},${kind},${lod}`; const signature = terrain.signature(cx, cy, 1); const cached = cache.scatter.get(key);
  if (cached?.signature === signature) return cached.items;
  const items = scatterChunk(terrain, cx, cy, kind, lod);
  cache.scatter.set(key, { signature, items });
  return items;
}

// Pinta el terreno visible: base de tierra, cada material encima en su orden, orillas, y después las copas de los bosques y las montañas.
export function drawTerrain(ctx, v, terrain, theme, lite = false) {
  if (!terrain || terrain.isEmpty()) return;
  let cache = terrainCaches.get(terrain); if (!cache) { cache = { paths: new Map(), scatter: new Map() }; terrainCaches.set(terrain, cache); }
  if (cache.paths.size > 4000) cache.paths.clear();
  if (cache.scatter.size > 4000) cache.scatter.clear();
  const size = terrain.cell * CHUNK; const box = worldBox(v, size);
  const chunks = terrain.renderChunks().filter(([cx, cy]) => (cx + 1) * size >= box.minX && cx * size <= box.maxX && (cy + 1) * size >= box.minY && cy * size <= box.maxY);
  const stride = strideFor(terrain.cell, v.k);
  ctx.save(); ctx.translate(v.tx, v.ty); ctx.scale(v.k, v.k); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const pass = (code, color, edgeColor, edgeWidth) => {
    ctx.fillStyle = color;
    const drawn = [];
    for (const [cx, cy] of chunks) {
      if (code !== 0 && !(terrain.codesNear(cx, cy) & (1 << code))) continue;
      const entry = pathsFor(cache, terrain, cx, cy, code, stride);
      if (!entry.empty) { ctx.fill(entry.area); drawn.push(entry); }
    }
    if (edgeColor) { ctx.strokeStyle = edgeColor; ctx.lineWidth = edgeWidth / v.k; for (const entry of drawn) ctx.stroke(entry.edge); }
  };
  pass(0, theme.areas.land, theme.areaEdge, 1.4);
  for (const kind of PAINT_ORDER) {
    const edge = kind === 'water' ? (theme.casing.river ?? theme.areaEdge) : kind === 'forest' ? theme.trees.rim : kind === 'mountain' ? theme.mountain.dark : null;
    pass(TERRAIN_CODE[kind], theme.areas[kind] ?? '#cccccc', edge, kind === 'water' ? 1.6 : 1);
    if (kind === 'water' && theme.waterGlow && !lite && v.k * terrain.cell * stride >= 2) {   // orilla más clara por dentro
      ctx.save(); ctx.globalAlpha = 0.6; ctx.strokeStyle = theme.waterGlow; ctx.lineWidth = Math.max(5, 14 * Math.min(1, v.k * 2)) / v.k;
      for (const [cx, cy] of chunks) { if (!(terrain.codesNear(cx, cy) & (1 << TERRAIN_CODE.water))) continue; const entry = pathsFor(cache, terrain, cx, cy, TERRAIN_CODE.water, stride); if (!entry.empty) ctx.stroke(entry.edge); }
      ctx.restore();
    }
  }
  ctx.restore();
  const lod = lodFor(terrain, v.k);
  for (const [cx, cy] of chunks) {
    if (terrain.codesNear(cx, cy) & (1 << TERRAIN_CODE.forest)) { const trees = scatterFor(cache, terrain, cx, cy, 'forest', lod); if (trees.length) drawCanopies(ctx, v, trees, theme, lite); }
  }
  for (const [cx, cy] of chunks) {
    if (!(terrain.codesNear(cx, cy) & (1 << TERRAIN_CODE.mountain))) continue;
    const peaks = scatterFor(cache, terrain, cx, cy, 'mountain', Math.max(0, lod - 2)); if (peaks.length) drawPeaks(ctx, v, peaks, theme);
  }
}

// Escena completa de un mapa con un estilo: fondo, áreas (en su orden) con su relleno, caminos, nombres. `results`: Map areaId → resultado de generateFill.
export function renderScene(ctx, v, map, results, theme, { labels = true, terrain = null, lite = false } = {}) {
  ctx.save();
  ctx.fillStyle = theme.background; ctx.fillRect(0, 0, v.width, v.height);
  drawTerrain(ctx, v, terrain, theme, lite);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const areas = [...map.areas].filter((area) => area.polygon.length >= 3).sort((a, b) => a.z - b.z);
  for (const area of areas) {
    const path = polygonPath(area.polygon, v);
    ctx.fillStyle = theme.areas[area.kind] ?? '#cccccc'; ctx.fill(path);
    if (theme.waterGlow && area.kind === 'water') {      // orilla más clara por dentro
      ctx.save(); ctx.clip(path); ctx.strokeStyle = theme.waterGlow; ctx.lineWidth = Math.max(6, 18 * Math.min(1, v.k * 2)); ctx.stroke(path); ctx.restore();
    }
    ctx.strokeStyle = theme.areaEdge; ctx.lineWidth = 1; ctx.stroke(path);
    const result = results.get(area.id); if (result) drawFill(ctx, v, result, theme, lite);
  }
  const ways = [...map.ways].filter((way) => way.points.length >= 2).sort((a, b) => a.z - b.z);
  const trace = (way) => { const path = new Path2D(); way.points.forEach(([x, y], index) => (index ? path.lineTo(x * v.k + v.tx, y * v.k + v.ty) : path.moveTo(x * v.k + v.tx, y * v.k + v.ty))); return path; };
  const widthOf = (way) => Math.max(way.width * v.k, 1.2);
  const traced = new Map(ways.map((way) => [way.id, trace(way)]));
  for (const way of ways) if (theme.casing[way.kind]) { ctx.strokeStyle = theme.casing[way.kind]; ctx.lineWidth = widthOf(way) + (CASED.has(way.kind) ? 2 : 3); ctx.stroke(traced.get(way.id)); }
  for (const way of ways) {
    ctx.lineCap = way.kind === 'wall' ? 'butt' : 'round';
    ctx.strokeStyle = theme.ways[way.kind] ?? '#ffffff'; ctx.lineWidth = widthOf(way); ctx.stroke(traced.get(way.id));
    if (way.kind === 'rail') { ctx.strokeStyle = '#ffffff99'; ctx.lineWidth = Math.max(widthOf(way) * 0.4, 1); ctx.setLineDash([8, 8]); ctx.stroke(traced.get(way.id)); ctx.setLineDash([]); }
    if (way.kind === 'wall') { ctx.strokeStyle = '#00000044'; ctx.lineWidth = widthOf(way); ctx.setLineDash([2, 2]); ctx.stroke(traced.get(way.id)); ctx.setLineDash([]); }
  }
  ctx.lineCap = 'round';
  if (labels) {
    ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    const text = (value, x, y, size, upper = false) => {
      ctx.font = `600 ${size}px "Georgia", serif`; const label = upper ? value.toUpperCase() : value;
      ctx.lineWidth = 3; ctx.strokeStyle = theme.label.halo; ctx.strokeText(label, x, y); ctx.fillStyle = theme.label.color; ctx.fillText(label, x, y);
    };
    for (const area of areas) {
      if (!area.name || polygonArea(area.polygon) * v.k * v.k < 8000) continue;
      const c = polygonCentroid(area.polygon); text(area.name, c.x * v.k + v.tx, c.y * v.k + v.ty, 14, true);
    }
    if (v.k >= 0.12) {
      ctx.textAlign = 'left';
      for (const place of map.places) {
        const x = place.x * v.k + v.tx; const y = place.y * v.k + v.ty;
        if (x < -80 || x > v.width + 80 || y < -20 || y > v.height + 20) continue;
        ctx.fillStyle = theme.label.color; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
        text(place.name, x + 8, y + 4, 12);
      }
    }
  }
  ctx.restore();
}

// --- Postproceso WebGL -------------------------------------------------------------------------------------------------------------------------------
const VERTEX = 'attribute vec2 a_pos; varying vec2 v_uv; void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }';
const FRAGMENT = `
precision highp float;
uniform sampler2D u_tex; uniform vec2 u_size; uniform vec2 u_origin; uniform vec3 u_tint;
uniform float u_grain, u_mottle, u_vignette, u_sat, u_contrast, u_warmth, u_edge;
varying vec2 v_uv;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; } return v; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_size;
  vec3 c = texture2D(u_tex, v_uv).rgb;
  // tinta: oscurece los bordes donde cambia la luminosidad
  vec2 t = 1.0 / u_size;
  float gx = luma(texture2D(u_tex, v_uv + vec2(t.x, 0.0)).rgb) - luma(texture2D(u_tex, v_uv - vec2(t.x, 0.0)).rgb);
  float gy = luma(texture2D(u_tex, v_uv + vec2(0.0, t.y)).rgb) - luma(texture2D(u_tex, v_uv - vec2(0.0, t.y)).rgb);
  c *= 1.0 - clamp(sqrt(gx * gx + gy * gy) * 2.2, 0.0, 0.6) * u_edge;
  // color: saturación, contraste, tinte y calidez
  float l = luma(c);
  c = mix(vec3(l), c, u_sat);
  c = (c - 0.5) * u_contrast + 0.5;
  c *= u_tint;
  c += vec3(u_warmth * 0.06, u_warmth * 0.02, -u_warmth * 0.05);
  // papel: manchas grandes y fibras, ancladas al mapa (se mueven con él)
  vec2 wp = px - u_origin;
  float mottle = fbm(wp / 110.0) - 0.5;
  float fibre = vnoise(vec2(wp.x / 1.7, wp.y / 40.0)) - 0.5;
  c *= 1.0 + u_mottle * (mottle * 0.38 + fibre * 0.05);
  c += (hash(floor(wp)) - 0.5) * u_grain * 0.13;
  // viñeta
  vec2 q = (v_uv - 0.5) * vec2(1.0, 0.85);
  c *= 1.0 - u_vignette * smoothstep(0.3, 0.85, length(q)) * 0.7;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class PostProcessor {
  constructor(canvas) {
    this.canvas = canvas; this.gl = null; this.ok = false;
    try {
      const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true });
      if (!gl) return;
      const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); return shader; };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_pos'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, name, value);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      this.gl = gl; this.program = program; this.uniform = (name) => gl.getUniformLocation(program, name); this.ok = true;
    } catch (error) { this.error = error; this.ok = false; }
  }

  // Pasa `source` (canvas 2D) por el shader hacia `this.canvas`. `post` = ajustes del estilo; `origin` = desplazamiento del mapa en píxeles del dispositivo.
  apply(source, post, origin = [0, 0]) {
    const { gl, canvas } = this;
    if (canvas.width !== source.width || canvas.height !== source.height) { canvas.width = source.width; canvas.height = source.height; }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const set1 = (name, value) => gl.uniform1f(this.uniform(name), value);
    gl.uniform2f(this.uniform('u_size'), canvas.width, canvas.height); gl.uniform2f(this.uniform('u_origin'), origin[0], origin[1]);
    const tint = post.tint ?? [1, 1, 1]; gl.uniform3f(this.uniform('u_tint'), tint[0], tint[1], tint[2]);
    set1('u_grain', post.grain ?? 0); set1('u_mottle', post.mottle ?? 0); set1('u_vignette', post.vignette ?? 0); set1('u_sat', post.saturation ?? 1);
    set1('u_contrast', post.contrast ?? 1); set1('u_warmth', post.warmth ?? 0); set1('u_edge', post.edge ?? 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

// Sin WebGL el resultado se copia tal cual (sin postproceso) para que la vista final siga funcionando.
export function copyPlain(source, target) {
  if (target.width !== source.width || target.height !== source.height) { target.width = source.width; target.height = source.height; }
  target.getContext('2d').drawImage(source, 0, 0);
}
