// Pintor de lo «regional» de un mapa: símbolos de ciudades (rascacielos, fábricas, santuario, muralla, puerto, estación…), conexiones por modo de
// transporte (carretera, ferrocarril, Northline, ruta marítima…), regiones políticas, decoración y etiquetas con política de zoom. Lo usan la vista final
// y el editor (mismas funciones: lo que se ve al editar es lo que se exporta). Todo se dibuja en canvas 2D; `v` = { k, tx, ty, width, height }.
// Nada de esto afecta a las reglas del juego: son datos del mapa (lugares, enlaces, decoración) pintados con la paleta del estilo.
import { TRAVEL_MODES, linkPoints, placeIndex } from '/shared/mapTravel.js';
import { PLACE_DEFAULT_ICON, SYMBOL_METERS } from '/shared/mapDefaults.js';
import { layerOf } from '/shared/mapLayers.js';


const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const hash = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const luminance = (hex) => { const m = /^#([0-9a-f]{6})/i.exec(hex ?? ''); if (!m) return 0.5; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

export const iconOf = (place) => place.icon ?? PLACE_DEFAULT_ICON[place.kind] ?? null;
const importanceOf = (place) => clamp(Math.round(place.importance ?? 2), 1, 5);

// --- Tamaños y etiquetas según el zoom ----------------------------------------------------------------------------------------------------------------
const SYMBOL_MIN_PX = [15, 22, 32, 50, 104];
// Tamaño en pantalla del símbolo de un lugar: a escala real mientras quepa entre un mínimo y un máximo, y se desvanece al acercarse mucho (entonces mandan el terreno y el marcador).
// Lo menor (importancia 1–2) no dibuja su símbolo hasta que el zoom lo deja respirar.
export function symbolSpec(place, k) {
  const level = importanceOf(place); const meters = SYMBOL_METERS[level - 1]; const min = SYMBOL_MIN_PX[level - 1]; const max = min * 2;
  const natural = meters * k; const fadeFrom = max * 2.5;
  return { px: clamp(natural, min, max), alpha: natural > fadeFrom ? clamp(1 - (natural - fadeFrom) / fadeFrom, 0, 1) : level <= 2 && k < LABEL_MIN_K[level - 1] * 0.5 ? 0 : 1 };
}
// Zoom mínimo (píxeles por metro) desde el que se ve la etiqueta de cada nivel de importancia (de 1 a 5): lo importante siempre, lo menor solo de cerca.
export const LABEL_MIN_K = [0.012, 0.0045, 0.0014, 0.0004, 0];
const LABEL_BASE_PX = [10, 11, 12.5, 14.5, 17];
const FLAT_ICONS = new Set(['port', 'facility', 'gate', 'pin']);
export function labelSpec(place, k) {
  const level = importanceOf(place);
  if (k < LABEL_MIN_K[level - 1]) return null;
  const grow = Math.min(1.45, 1 + 0.13 * Math.log2(Math.max(1, k / Math.max(LABEL_MIN_K[level - 1], 0.0007))));
  return { size: LABEL_BASE_PX[level - 1] * grow, upper: level >= 5, spacing: level >= 5 ? 2 : 0, level };
}

// --- Paleta de los símbolos, derivada del estilo ------------------------------------------------------------------------------------------------------
function palette(theme) {
  const colors = theme.buildings.colors; const dark = luminance(theme.background) < 0.4;
  return {
    dark, tower: colors[0], towerB: colors[1] ?? colors[0], towerC: colors[2] ?? colors[0], lit: dark ? '#f3c76e' : '#ffe9a8', edge: theme.buildings.edge,
    ground: dark ? '#141c2d' : '#8f8068', stone: dark ? '#c8c2b4' : '#e2d9c6', stoneShade: dark ? '#87826f' : '#b3a68b', roof: dark ? '#d2a94d' : '#b86f4a', wood: dark ? '#8a6d4a' : '#9a6f4a',
    rust: dark ? '#9a6240' : '#a8683f', rustDark: dark ? '#3c2a22' : '#5a4034', smoke: dark ? '#8a8e9b' : '#9a9ca3', accent: '#4aa3ff', ink: theme.label.color, halo: theme.label.halo
  };
}
const box = (ctx, x, y, w, h) => { ctx.beginPath(); ctx.rect(x, y, w, h); };

// --- Símbolos (se dibujan en una caja de 100×100 centrada en el lugar; la «tierra» está en y = 40) ---------------------------------------------------------
function platform(ctx, p, width = 50, color = p.ground) {
  ctx.beginPath(); ctx.ellipse(0, 40, width, width * 0.22, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 0.8; ctx.stroke();
}
function windows(ctx, p, r, x, y, w, h, chance = 0.45) {
  ctx.fillStyle = p.lit; ctx.globalAlpha = p.dark ? 0.9 : 0.7;
  for (let yy = y + 4; yy < y + h - 3; yy += 5) for (let xx = x + 2; xx < x + w - 2; xx += 4) if (r() < chance) ctx.fillRect(xx, yy, 1.6, 2.4);
  ctx.globalAlpha = 1;
}
function tower(ctx, p, r, x, ground, w, h, glass = true) {
  const x0 = x - w / 2; const grad = ctx.createLinearGradient(x0, 0, x0 + w, 0);
  grad.addColorStop(0, p.towerB); grad.addColorStop(1, p.towerC);
  ctx.fillStyle = grad; box(ctx, x0, ground - h, w, h); ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 0.8; ctx.stroke();
  if (glass) windows(ctx, p, r, x0, ground - h, w, h);
}

function drawSkyline(ctx, p, seed, big) {
  const r = rng(seed);
  const halo = ctx.createRadialGradient(0, 8, 4, 0, 8, 68); halo.addColorStop(0, p.dark ? 'rgba(255,214,130,0.42)' : 'rgba(255,232,170,0.4)'); halo.addColorStop(1, 'rgba(255,214,130,0)');
  ctx.fillStyle = halo; ctx.fillRect(-72, -62, 144, 140);
  platform(ctx, p, big ? 52 : 40);
  const list = big
    ? [[-41, 9, 24], [-32, 11, 38], [-22, 10, 52], [-12, 12, 68], [0, 15, 94], [13, 12, 64], [23, 11, 48], [33, 12, 36], [42, 9, 22]]
    : [[-28, 11, 26], [-16, 12, 40], [-3, 13, 52], [10, 12, 38], [22, 11, 28], [32, 9, 20]];
  const order = [...list].sort((a, b) => a[2] - b[2]);
  for (const [x, , h] of order) { const item = list.find((entry) => entry[0] === x && entry[2] === h); tower(ctx, p, r, x, 40, item[1], h * (0.93 + r() * 0.14)); }
  if (big) {   // el edificio más alto lleva una aguja y una luz
    const top = 40 - 94 * 1.0; ctx.strokeStyle = p.lit; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(0, top - 16); ctx.stroke();
    ctx.fillStyle = p.lit; ctx.beginPath(); ctx.arc(0, top - 17, 2.1, 0, Math.PI * 2); ctx.fill();
  }
}
function drawTown(ctx, p, seed) {
  const r = rng(seed); platform(ctx, p, 38, p.ground);
  for (const [x, w, h] of [[-22, 16, 14], [-4, 18, 18], [14, 16, 13], [28, 12, 10]]) {
    const hh = h * (0.9 + r() * 0.2);
    ctx.fillStyle = p.stone; box(ctx, x - w / 2, 40 - hh, w, hh); ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.fillStyle = p.roof; ctx.beginPath(); ctx.moveTo(x - w / 2 - 1.5, 40 - hh); ctx.lineTo(x, 40 - hh - w * 0.45); ctx.lineTo(x + w / 2 + 1.5, 40 - hh); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = p.lit; ctx.globalAlpha = 0.8; ctx.fillRect(x - 1.4, 40 - hh * 0.55, 2.8, 3.4); ctx.globalAlpha = 1;
  }
}
// Fábricas con tejado en diente de sierra y chimeneas altas con humo: una ciudad industrial que ya no es lo que fue (colores apagados, ventanas casi todas apagadas).
function drawIndustrial(ctx, p, seed) {
  const r = rng(seed); platform(ctx, p, 50, p.rustDark);
  for (const [x, w, h] of [[-30, 22, 16], [-4, 26, 20], [24, 22, 15]]) {
    ctx.fillStyle = p.rust; box(ctx, x - w / 2, 40 - h, w, h); ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.fillStyle = p.rustDark; ctx.beginPath(); ctx.moveTo(x - w / 2, 40 - h);
    const teeth = 3; for (let i = 0; i < teeth; i++) { const x0 = x - w / 2 + (w / teeth) * i; ctx.lineTo(x0, 40 - h - 7); ctx.lineTo(x0 + w / teeth, 40 - h); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    windows(ctx, p, r, x - w / 2, 40 - h, w, h, 0.08);
  }
  for (const [x, h] of [[-40, 46], [-17, 62], [38, 54]]) {
    ctx.fillStyle = p.rustDark; ctx.beginPath(); ctx.moveTo(x - 3.2, 40 - 12); ctx.lineTo(x - 2.4, 40 - h); ctx.lineTo(x + 2.4, 40 - h); ctx.lineTo(x + 3.2, 40 - 12); ctx.closePath(); ctx.fill(); ctx.strokeStyle = p.edge; ctx.stroke();
    ctx.fillStyle = p.rust; ctx.fillRect(x - 2.5, 40 - h + 4, 5, 2);
    ctx.fillStyle = p.smoke; for (let i = 0; i < 4; i++) { ctx.globalAlpha = 0.5 - i * 0.1; ctx.beginPath(); ctx.arc(x + 4 + i * 4 + r() * 2, 40 - h - 4 - i * 7, 4 + i * 1.8, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
}
// Santuario de piedra sobre un risco: terrazas, una torre con tejados escalonados y capillas a los lados.
function drawSanctuary(ctx, p, seed) {
  const r = rng(seed);
  ctx.fillStyle = p.stoneShade; ctx.beginPath(); ctx.moveTo(-50, 44); ctx.lineTo(-22, 24); ctx.lineTo(0, 30); ctx.lineTo(26, 22); ctx.lineTo(50, 44); ctx.closePath(); ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 0.8; ctx.stroke();
  for (const [x, w, h] of [[-26, 18, 16], [26, 18, 14]]) {   // capillas
    ctx.fillStyle = p.stone; box(ctx, x - w / 2, 28 - h, w, h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = p.roof; ctx.beginPath(); ctx.moveTo(x - w / 2 - 2, 28 - h); ctx.lineTo(x, 28 - h - 10); ctx.lineTo(x + w / 2 + 2, 28 - h); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  for (const [w, h, y] of [[46, 7, 31], [36, 7, 24]]) { ctx.fillStyle = p.stone; box(ctx, -w / 2, y - h + 7, w, h); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = p.stone; box(ctx, -9, -16, 18, 32); ctx.fill(); ctx.stroke();
  windows(ctx, p, r, -9, -16, 18, 32, 0.25);
  let y = -16;
  for (const [w, h] of [[30, 9], [22, 8], [14, 7]]) {   // tejados escalonados
    ctx.fillStyle = p.roof; ctx.beginPath(); ctx.moveTo(-w / 2 - 3, y); ctx.quadraticCurveTo(-w / 2 + 2, y - 2, 0, y - h); ctx.quadraticCurveTo(w / 2 - 2, y - 2, w / 2 + 3, y); ctx.closePath(); ctx.fill(); ctx.stroke(); y -= h - 1;
  }
  ctx.strokeStyle = p.lit; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(0, y - 10); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-3, y - 6); ctx.lineTo(3, y - 6); ctx.stroke();
}
function drawFortress(ctx, p) {
  platform(ctx, p, 50, p.stoneShade);
  ctx.fillStyle = p.stone; box(ctx, -42, 14, 84, 26); ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 0.9; ctx.stroke();
  ctx.fillStyle = p.stone; for (let x = -42; x < 40; x += 9) { box(ctx, x, 9, 5.5, 6); ctx.fill(); ctx.stroke(); }
  for (const x of [-40, 40]) {
    ctx.fillStyle = p.stone; box(ctx, x - 8, -8, 16, 48); ctx.fill(); ctx.stroke();
    ctx.fillStyle = p.roof; ctx.beginPath(); ctx.moveTo(x - 10, -8); ctx.lineTo(x, -26); ctx.lineTo(x + 10, -8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = p.edge; ctx.fillRect(x - 1.4, 2, 2.8, 7);
  }
  ctx.fillStyle = p.edge; ctx.beginPath(); ctx.moveTo(-8, 40); ctx.lineTo(-8, 28); ctx.quadraticCurveTo(0, 18, 8, 28); ctx.lineTo(8, 40); ctx.closePath(); ctx.fill();
  ctx.fillStyle = p.lit; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(0, 33, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
}
function badge(ctx, p, fill, drawInner) {
  ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = p.dark ? '#0a1626' : '#ffffff'; ctx.stroke();
  ctx.lineWidth = 1; ctx.strokeStyle = p.edge; ctx.stroke();
  drawInner();
}
function drawPort(ctx, p) {   // ancla
  badge(ctx, p, p.dark ? '#16708a' : '#2a9db5', () => {
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.arc(0, -15, 4.2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -10.5); ctx.lineTo(0, 17); ctx.moveTo(-9, -3); ctx.lineTo(9, -3); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 4, 17, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  });
}
// Gran estación: bóveda monumental sobre un andén largo y haces de vías que salen de ella. Es el nodo de Northline.
function drawStation(ctx, p, seed) {
  const r = rng(seed);
  const glow = ctx.createRadialGradient(0, 10, 4, 0, 10, 62); glow.addColorStop(0, 'rgba(74,163,255,0.45)'); glow.addColorStop(1, 'rgba(74,163,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(-70, -50, 140, 130);
  ctx.strokeStyle = p.accent; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (const dx of [-30, -15, 0, 15, 30]) { ctx.beginPath(); ctx.moveTo(dx * 0.35, 36); ctx.lineTo(dx * 1.9, 52); ctx.stroke(); }
  ctx.fillStyle = p.stone; box(ctx, -46, 22, 92, 14); ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 0.9; ctx.stroke();
  for (const x of [-46, 46]) { ctx.fillStyle = p.stoneShade; box(ctx, x - 6, 6, 12, 30); ctx.fill(); ctx.stroke(); ctx.fillStyle = p.roof; ctx.beginPath(); ctx.moveTo(x - 8, 6); ctx.lineTo(x, -8); ctx.lineTo(x + 8, 6); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  const dome = ctx.createLinearGradient(-34, 0, 34, 0); dome.addColorStop(0, p.dark ? '#7fb7ff' : '#9cc5f0'); dome.addColorStop(1, p.dark ? '#2f6fc0' : '#4a86cf');
  ctx.fillStyle = dome; ctx.beginPath(); ctx.moveTo(-34, 24); ctx.bezierCurveTo(-34, -22, 34, -22, 34, 24); ctx.closePath(); ctx.fill(); ctx.strokeStyle = p.edge; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.9;
  for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 8.5, 24); ctx.quadraticCurveTo(i * 6.5, -4, i * 1.2, -12); ctx.stroke(); }
  ctx.fillStyle = p.stone; box(ctx, -6, 14, 12, 22); ctx.fill(); ctx.strokeStyle = p.edge; ctx.stroke(); windows(ctx, p, r, -6, 14, 12, 22, 0.5);
  ctx.strokeStyle = p.lit; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, -26); ctx.stroke(); ctx.fillStyle = p.lit; ctx.beginPath(); ctx.arc(0, -27, 2, 0, Math.PI * 2); ctx.fill();
}
function drawFacility(ctx, p) {
  badge(ctx, p, p.dark ? '#c4472b' : '#e0613f', () => {
    ctx.fillStyle = '#fff'; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5; const rad = i % 2 ? 7 : 16; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rad, Math.sin(a) * rad); }
    ctx.closePath(); ctx.fill();
  });
}
function drawGate(ctx, p) {
  badge(ctx, p, p.dark ? '#a8305f' : '#d43d77', () => {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(13, 0); ctx.moveTo(4, -10); ctx.lineTo(14, 0); ctx.lineTo(4, 10); ctx.stroke();
  });
}
function drawPin(ctx, p) {
  ctx.fillStyle = p.dark ? '#f2d6a8' : '#c0392b'; ctx.beginPath(); ctx.moveTo(0, 44); ctx.bezierCurveTo(-30, 8, -26, -30, 0, -30); ctx.bezierCurveTo(26, -30, 30, 8, 0, 44); ctx.closePath(); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = p.dark ? '#0a1626' : '#fff'; ctx.stroke(); ctx.fillStyle = p.dark ? '#0a1626' : '#fff'; ctx.beginPath(); ctx.arc(0, -8, 8, 0, Math.PI * 2); ctx.fill();
}
const GLYPHS = {
  skyline: (ctx, p, seed) => drawSkyline(ctx, p, seed, true), city: (ctx, p, seed) => drawSkyline(ctx, p, seed, false), town: drawTown, industrial: drawIndustrial,
  sanctuary: drawSanctuary, fortress: drawFortress, port: drawPort, station: drawStation, facility: drawFacility, gate: drawGate, pin: drawPin
};
export function drawSymbol(ctx, icon, cx, cy, px, theme, seed, alpha = 1) {
  const glyph = GLYPHS[icon]; if (!glyph || px < 6 || alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(cx, cy); ctx.scale(px / 100, px / 100); ctx.lineJoin = 'round';
  glyph(ctx, palette(theme), seed); ctx.restore();
}
// Composición de los lugares en pantalla: dónde va cada símbolo y cada etiqueta. Las etiquetas se colocan por orden de importancia en el primer sitio libre
// (debajo, a la derecha, a la izquierda, encima) y la que no cabe se omite, así el centro de un mapa lleno no se convierte en una mancha de letras.
// `always`: ids que siempre se etiquetan (el seleccionado). `hidden`: capas ocultas. Devuelve { symbols: [...], labels: Map id → {...}, rects }.
const TEXT_EM = 0.6;
export function layoutPlaces(v, map, { hidden = null, always = null } = {}) {
  const symbols = []; const labels = new Map(); const obstacles = [];
  const visible = [];
  for (const place of map.places ?? []) {
    if (!Number.isFinite(place.x) || hidden?.has(layerOf('place', place, map))) continue;
    const x = place.x * v.k + v.tx; const y = place.y * v.k + v.ty;
    if (x < -220 || x > v.width + 220 || y < -120 || y > v.height + 120) continue;
    visible.push({ place, x, y });
  }
  for (const item of visible) {
    const icon = iconOf(item.place); const spec = symbolSpec(item.place, v.k);
    if (icon && spec.alpha > 0) {
      const flat = FLAT_ICONS.has(icon); const px = flat ? Math.min(spec.px, 34) : spec.px;
      const cy = flat ? item.y : item.y - px * 0.32;   // los edificios se apoyan en su lugar (la tierra del dibujo está en y = +40 de 100)
      item.symbol = { icon, px, alpha: spec.alpha, x: item.x, y: cy, rect: flat ? [item.x - px / 2, cy - px / 2, px, px] : [item.x - px * 0.5, item.y - px * 0.98, px, px * 1.1] };
      symbols.push({ place: item.place, ...item.symbol });
      obstacles.push(item.symbol.rect);
    } else obstacles.push([item.x - 6, item.y - 6, 12, 12]);
  }
  const inView = (r) => r[0] >= 2 && r[0] + r[2] <= v.width - 2 && r[1] >= 2 && r[1] + r[3] <= v.height - 2;
  const hit = (a, b) => a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
  const placed = [];
  const order = [...visible].sort((a, b) => importanceOf(b.place) - importanceOf(a.place) || a.place.name.length - b.place.name.length);
  for (const item of order) {
    const { place } = item; const forced = always?.has(place.id);
    const spec = labelSpec(place, v.k) ?? (forced ? labelSpec({ ...place, importance: 5 }, 1) : null); if (!spec) continue;
    const text = spec.upper ? place.name.toUpperCase() : place.name;
    const w = text.length * (spec.size * TEXT_EM + spec.spacing) + 6; const h = spec.size + 4;
    const sym = item.symbol; const gap = 5;
    const options = sym && !FLAT_ICONS.has(sym.icon) ? [['below'], ['right'], ['left']] : sym ? [['right'], ['below'], ['left'], ['above']] : [['right'], ['left'], ['below'], ['above']];
    const anchorX = item.x; const groundY = item.y;
    const boxFor = (side) => {
      const reach = sym ? (FLAT_ICONS.has(sym.icon) ? sym.px / 2 : sym.px * 0.5) : 7;
      if (side === 'below') return { rect: [anchorX - w / 2, groundY + (sym && !FLAT_ICONS.has(sym.icon) ? sym.px * 0.12 : reach) + gap - 2, w, h], align: 'center', baseline: 0 };
      if (side === 'above') return { rect: [anchorX - w / 2, groundY - (sym ? sym.px * 1.05 : 7) - gap - h, w, h], align: 'center', baseline: 0 };
      if (side === 'left') return { rect: [anchorX - reach - gap - w, (sym ? sym.y : groundY) - h / 2, w, h], align: 'right', baseline: 0 };
      return { rect: [anchorX + reach + gap, (sym ? sym.y : groundY) - h / 2, w, h], align: 'left', baseline: 0 };
    };
    let chosen = null;
    for (const [side] of options) {
      const candidate = boxFor(side);
      const own = sym?.rect;
      if (!forced && (!inView(candidate.rect) || placed.some((rect) => hit(candidate.rect, rect)) || obstacles.some((rect) => rect !== own && hit(candidate.rect, rect)))) continue;
      chosen = { ...candidate, side }; break;
    }
    if (!chosen && forced) chosen = { ...boxFor(options[0][0]), side: options[0][0] };
    if (!chosen) continue;
    placed.push(chosen.rect);
    labels.set(place.id, { text, size: spec.size, spacing: spec.spacing, level: spec.level, align: chosen.align, side: chosen.side, x: chosen.align === 'center' ? chosen.rect[0] + w / 2 : chosen.align === 'left' ? chosen.rect[0] + 3 : chosen.rect[0] + w - 3, y: chosen.rect[1] + h / 2, rect: chosen.rect });
  }
  return { symbols, labels };
}

// Símbolos de todos los lugares con icono, de atrás hacia delante (los del sur tapan a los del norte).
export function drawSymbols(ctx, v, map, theme, { hidden = null, layout = null } = {}) {
  const { symbols } = layout ?? layoutPlaces(v, map, { hidden });
  const items = [...symbols].sort((a, b) => a.place.y - b.place.y);
  for (const item of items) drawSymbol(ctx, item.icon, item.x, item.y, item.px, theme, hash(item.place.id), item.alpha);
}

// --- Conexiones -----------------------------------------------------------------------------------------------------------------------------------
// Suaviza una línea quebrada (corte de esquinas de Chaikin): las rutas y las vías se ven curvas sin guardar más puntos que los del autor.
export function smoothLine(points, rounds = 2) {
  let line = points;
  for (let n = 0; n < rounds && line.length > 2; n++) {
    const next = [line[0]];
    for (let i = 0; i < line.length - 1; i++) { const [ax, ay] = line[i]; const [bx, by] = line[i + 1]; next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]); }
    next.push(line.at(-1)); line = next;
  }
  return line;
}
export function linkColor(map, link, theme) {
  const line = link.line ? map.lines?.find((item) => item.id === link.line) : null;
  return line?.color ?? theme.links?.[link.mode] ?? TRAVEL_MODES[link.mode]?.color ?? '#c0c0c0';
}
const SCREEN = (v, points) => points.map(([x, y]) => [x * v.k + v.tx, y * v.k + v.ty]);
function tracePath(points) { const path = new Path2D(); points.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y))); return path; }

// Estilo de cada modo: ancho en píxeles, trazo discontinuo y si lleva borde, núcleo claro o resplandor (Northline).
const MODE_STYLE = {
  road: { width: 3.2, casing: 2 }, path: { width: 2, dash: [6, 5] }, rail: { width: 3.4, casing: 2, ties: true }, train: { width: 3.4, casing: 2, ties: true },
  northline: { width: 5, casing: 2.5, core: true, glow: true }, metro: { width: 4.4, casing: 2.5, core: true, glow: true },
  trade: { width: 3, dash: [1.5, 6], round: true, casing: 1.5 }, sea: { width: 2.6, dash: [11, 8] }, ferry: { width: 2.6, dash: [8, 6] }, other: { width: 2.4, dash: [5, 5] }
};
export function drawLinks(ctx, v, map, theme, { hidden = null, selectedId = null } = {}) {
  const links = map.links ?? []; if (!links.length) return;
  const index = placeIndex(map); const dark = luminance(theme.background) < 0.4;
  const prepared = [];
  for (const link of links) {
    if (hidden?.has(layerOf('link', link, map))) continue;
    const raw = linkPoints(map, link, index); if (!raw) continue;
    const screen = smoothLine(SCREEN(v, raw), raw.length > 2 ? 3 : 0);
    prepared.push({ link, path: tracePath(screen), style: MODE_STYLE[link.mode] ?? MODE_STYLE.other, color: linkColor(map, link, theme) });
  }
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const selected = prepared.find((item) => item.link.id === selectedId);
  if (selected) { ctx.strokeStyle = dark ? '#ffffffcc' : '#1b2a4acc'; ctx.lineWidth = selected.style.width + 8; ctx.stroke(selected.path); }
  for (const item of prepared) if (item.style.casing) { ctx.strokeStyle = dark ? '#05080f' : '#ffffffd0'; ctx.lineWidth = item.style.width + item.style.casing * 2; ctx.setLineDash(item.style.dash ?? []); ctx.stroke(item.path); }
  ctx.setLineDash([]);
  for (const item of prepared) {
    const { style } = item;
    if (style.glow) { ctx.save(); ctx.shadowColor = item.color; ctx.shadowBlur = dark ? 12 : 5; ctx.strokeStyle = item.color; ctx.lineWidth = style.width; ctx.stroke(item.path); ctx.restore(); }
    ctx.strokeStyle = item.color; ctx.lineWidth = style.width; ctx.setLineDash(style.dash ?? []); ctx.lineCap = style.round ? 'round' : style.dash ? 'butt' : 'round'; ctx.stroke(item.path); ctx.setLineDash([]); ctx.lineCap = 'round';
    if (style.core) { ctx.strokeStyle = dark ? '#ffffffcc' : '#ffffffe6'; ctx.lineWidth = Math.max(1, style.width * 0.28); ctx.stroke(item.path); }
    if (style.ties) { ctx.strokeStyle = '#ffffffb0'; ctx.lineWidth = Math.max(1, style.width * 0.5); ctx.setLineDash([2, 7]); ctx.lineCap = 'butt'; ctx.stroke(item.path); ctx.setLineDash([]); ctx.lineCap = 'round'; }
  }
  ctx.restore();
}

// --- Regiones políticas ---------------------------------------------------------------------------------------------------------------------------
const alpha = (hex, a) => `${hex.slice(0, 7)}${Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0')}`;
export function drawRegions(ctx, v, map, theme, { hidden = null, selectedId = null } = {}) {
  for (const area of map.areas ?? []) {
    if (area.kind !== 'region' || area.polygon.length < 3 || hidden?.has('regions')) continue;
    const color = area.color ?? theme.areas.region ?? '#c9a45c'; const points = SCREEN(v, area.polygon);
    const path = tracePath(points); path.closePath();
    ctx.save(); ctx.fillStyle = alpha(color, 0.09); ctx.fill(path);
    ctx.clip(path); ctx.lineJoin = 'round'; ctx.strokeStyle = alpha(color, 0.35); ctx.lineWidth = 14; ctx.stroke(path); ctx.strokeStyle = alpha(color, 0.5); ctx.lineWidth = 5; ctx.stroke(path); ctx.restore();
    ctx.save(); ctx.strokeStyle = alpha(color, 0.95); ctx.lineWidth = selectedId === area.id ? 3.5 : 2; ctx.setLineDash([14, 8]); ctx.lineJoin = 'round'; ctx.stroke(path); ctx.restore();
  }
}

// --- Decoración -----------------------------------------------------------------------------------------------------------------------------------
function drawCompass(ctx, p) {
  ctx.strokeStyle = p.ink; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, 38, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.stroke();
  const star = (len, wid, color) => { ctx.fillStyle = color; for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate((i * Math.PI) / 2); ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(wid, -wid); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill(); ctx.restore(); } };
  star(46, 6, p.ink); ctx.save(); ctx.rotate(Math.PI / 4); star(26, 4, p.stoneShade); ctx.restore();
  ctx.fillStyle = p.lit; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.ink; ctx.font = '700 17px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText('N', 0, -52);
}
function drawShip(ctx, p) {
  ctx.fillStyle = p.wood; ctx.beginPath(); ctx.moveTo(-34, 12); ctx.lineTo(34, 12); ctx.lineTo(24, 28); ctx.lineTo(-24, 28); ctx.closePath(); ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = p.edge; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(0, -34); ctx.stroke();
  ctx.fillStyle = p.stone; for (const [x, w] of [[-4, -26], [4, 24]]) { ctx.beginPath(); ctx.moveTo(x, -30); ctx.quadraticCurveTo(x + w * 0.6, -8, x + w * 0.2, 8); ctx.lineTo(x, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  ctx.strokeStyle = p.dark ? '#ffffff55' : '#ffffffaa'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-40, 33); ctx.quadraticCurveTo(-20, 28, 0, 33); ctx.quadraticCurveTo(20, 38, 40, 33); ctx.stroke();
}
function drawRuins(ctx, p) {
  ctx.fillStyle = p.stoneShade; ctx.beginPath(); ctx.ellipse(0, 36, 44, 9, 0, 0, Math.PI * 2); ctx.fill();
  for (const [x, h, w] of [[-26, 40, 9], [-8, 56, 10], [12, 34, 9], [30, 22, 9]]) { ctx.fillStyle = p.stone; box(ctx, x - w / 2, 36 - h, w, h); ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 0.8; ctx.stroke(); ctx.fillStyle = p.stoneShade; ctx.beginPath(); ctx.moveTo(x - w / 2, 36 - h); ctx.lineTo(x - w / 4, 36 - h - 5); ctx.lineTo(x + w / 2, 36 - h); ctx.closePath(); ctx.fill(); }
}
function drawTower(ctx, p) {
  ctx.fillStyle = p.stone; ctx.beginPath(); ctx.moveTo(-14, 40); ctx.lineTo(-9, -22); ctx.lineTo(9, -22); ctx.lineTo(14, 40); ctx.closePath(); ctx.fill(); ctx.strokeStyle = p.edge; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = p.roof; box(ctx, -12, -34, 24, 12); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-14, -34); ctx.lineTo(0, -48); ctx.lineTo(14, -34); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = p.lit; ctx.fillRect(-4, -31, 8, 6);
}
function drawCrest(ctx, p, _seed, theme) {
  ctx.fillStyle = theme.areas?.region ?? p.accent; ctx.beginPath(); ctx.moveTo(-30, -36); ctx.lineTo(30, -36); ctx.lineTo(30, 6); ctx.quadraticCurveTo(30, 30, 0, 44); ctx.quadraticCurveTo(-30, 30, -30, 6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = p.ink; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = '#ffffffee'; ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(7, -4); ctx.lineTo(0, 24); ctx.lineTo(-7, -4); ctx.closePath(); ctx.fill();
}
const DECOR_GLYPHS = { compass: drawCompass, ship: drawShip, ruins: drawRuins, tower: drawTower, crest: drawCrest };
export const decorPixels = (item, k) => clamp(item.size * k, item.kind === 'label' ? 10 : 18, item.kind === 'compass' ? 220 : 160);
export function drawDecor(ctx, v, map, theme, { hidden = null } = {}) {
  const p = palette(theme);
  for (const item of map.decor ?? []) {
    if (hidden?.has(layerOf('decor', item, map)) || !Number.isFinite(item.x)) continue;
    const x = item.x * v.k + v.tx; const y = item.y * v.k + v.ty;
    if (x < -300 || x > v.width + 300 || y < -300 || y > v.height + 300) continue;
    const px = decorPixels(item, v.k);
    ctx.save(); ctx.translate(x, y); ctx.rotate(((item.rotation ?? 0) * Math.PI) / 180);
    if (item.kind === 'label') {
      const size = px; ctx.font = `600 ${size}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(size * 0.22)}px`;
      ctx.lineWidth = Math.max(3, size / 6); ctx.lineJoin = 'round'; ctx.strokeStyle = theme.label.halo; ctx.globalAlpha = 0.9; ctx.strokeText(item.name.toUpperCase(), 0, 0); ctx.fillStyle = theme.label.color; ctx.globalAlpha = 0.78; ctx.fillText(item.name.toUpperCase(), 0, 0);
    } else {
      ctx.scale(px / 100, px / 100); ctx.lineJoin = 'round'; ctx.globalAlpha = 0.95; DECOR_GLYPHS[item.kind]?.(ctx, p, hash(item.id), theme);
    }
    ctx.restore();
  }
}

// --- Etiquetas de lugares y de regiones (vista final) ----------------------------------------------------------------------------------------------------
export function drawPlaceLabels(ctx, v, map, theme, { hidden = null, layout = null } = {}) {
  if (hidden?.has('labels')) return;
  const { labels, symbols } = layout ?? layoutPlaces(v, map, { hidden });
  const withSymbol = new Set(symbols.map((item) => item.place.id)); const byId = new Map((map.places ?? []).map((place) => [place.id, place]));
  ctx.save(); ctx.lineJoin = 'round'; ctx.textBaseline = 'middle';
  for (const [id, label] of labels) {
    ctx.font = `${label.level >= 4 ? 700 : 600} ${label.size}px Georgia, serif`; if ('letterSpacing' in ctx) ctx.letterSpacing = `${label.spacing}px`;
    ctx.textAlign = label.align === 'center' ? 'center' : label.align;
    ctx.lineWidth = 3.4; ctx.strokeStyle = theme.label.halo; ctx.strokeText(label.text, label.x, label.y); ctx.fillStyle = theme.label.color; ctx.fillText(label.text, label.x, label.y);
    const place = byId.get(id);
    if (place && !withSymbol.has(id)) { ctx.fillStyle = theme.label.color; ctx.beginPath(); ctx.arc(place.x * v.k + v.tx, place.y * v.k + v.ty, 3.2, 0, Math.PI * 2); ctx.fill(); }
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.restore();
}
// Nombre de las regiones: letras muy separadas y grandes, tenues, centradas en el territorio (crece con el tamaño de la región en pantalla).
export function drawRegionLabels(ctx, v, map, theme, { hidden = null } = {}) {
  if (hidden?.has('labels') || hidden?.has('regions')) return;
  for (const area of map.areas ?? []) {
    if (area.kind !== 'region' || !area.name || area.polygon.length < 3) continue;
    const xs = area.polygon.map(([x]) => x); const width = (Math.max(...xs) - Math.min(...xs)) * v.k;
    const size = clamp(width / Math.max(8, area.name.length) / 1.3, 12, 54); if (width < 120) continue;
    const cx = area.polygon.reduce((s, [x]) => s + x, 0) / area.polygon.length; const cy = area.polygon.reduce((s, [, y]) => s + y, 0) / area.polygon.length;
    ctx.save(); ctx.font = `600 ${size}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(size * 0.3)}px`;
    ctx.fillStyle = theme.label.color; ctx.globalAlpha = 0.22; ctx.fillText(area.name.toUpperCase(), cx * v.k + v.tx, cy * v.k + v.ty); ctx.restore();
  }
}
