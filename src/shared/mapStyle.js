// Estilos del mapa: DATOS (paletas, sombras, ajustes del postproceso). El mismo estilo lo usan la vista previa del editor y, más adelante, el
// exportador que hornea las teselas, así que lo que se ve antes de exportar es lo que saldrá. Nada de esto afecta a las reglas del juego.
//
// Cada estilo lleva su nombre (`title`), su paleta y su postproceso. Un estilo tiene dos partes: la PALETA (cómo se pintan áreas, caminos, casas y árboles: colores, bordes, sombras) y el POSTPROCESO (un shader que
// toca la imagen ya pintada: grano de papel, manchas, viñeta, saturación, contraste, calidez, tinta en los bordes). Cada mapa elige un estilo
// (`style.theme`) y puede afinar el postproceso (`style.post`).
import { AREA_KINDS, WAY_KINDS, AREA_COLOR, WAY_COLOR } from './mapDefaults.js';

export const POST_KEYS = ['grain', 'mottle', 'vignette', 'saturation', 'contrast', 'warmth', 'edge'];
export const POST_RANGE = { grain: [0, 1], mottle: [0, 1], vignette: [0, 1], saturation: [0, 2], contrast: [0.5, 1.5], warmth: [-1, 1], edge: [0, 1.5] };
export const POST_LABEL = { grain: 'Grano', mottle: 'Manchas de papel', vignette: 'Viñeta', saturation: 'Saturación', contrast: 'Contraste', warmth: 'Calidez', edge: 'Tinta en los bordes' };
export const POST_NEUTRAL = { grain: 0, mottle: 0, vignette: 0, saturation: 1, contrast: 1, warmth: 0, edge: 0, tint: [1, 1, 1] };

const CASED = ['avenue', 'street', 'path', 'bridge'];
const casings = (color, kinds = CASED) => Object.fromEntries(kinds.map((kind) => [kind, color]));

export const THEMES = {
  // El del editor: colores base y sin postproceso (lo que se ve al dibujar).
  default: {
    title: 'Editor (sin estilo)', background: '#cfd6c4', areas: { ...AREA_COLOR }, areaEdge: '#00000033', waterGlow: null,
    ways: { ...WAY_COLOR }, casing: casings('#6f6552'), block: '#ddd2bd',
    buildings: { colors: ['#c9ae90', '#bfa183', '#d1b99d', '#b4967a'], cumulative: [0.25, 0.5, 0.75, 1], edge: '#6f5f4a', shadow: null, ridge: false },
    trees: { colors: ['#4a8a42', '#3f7c3a', '#58994d', '#366e34'], rim: '#24441f', shadow: null, highlight: '#8fc27a66' },
    mountain: { light: '#bdb2a2', dark: '#8d8274' },
    label: { color: '#222222', halo: '#ffffffcc' }, post: { ...POST_NEUTRAL }
  },
  parchment: {
    title: 'Pergamino', background: '#e9dcb8',
    areas: { water: '#8fb4b8', land: '#e6d7a8', sand: '#ecdcae', field: '#d8cf8c', forest: '#9bb072', park: '#a9c27f', mountain: '#b8a58b', urban: '#d9c6a0', plaza: '#efe2bd' },
    areaEdge: '#7a6a4a55', waterGlow: '#c7dcdc99',
    ways: { avenue: '#f5ead0', street: '#f5ead0', path: '#cdb27f', river: '#8fb4b8', stream: '#9fc0c2', wall: '#5e5446', rail: '#6d6d70', bridge: '#e5d6b0' },
    casing: { ...casings('#8c7a5a'), river: '#5f8f96', stream: '#5f8f96' }, block: '#e3d2ac',
    buildings: { colors: ['#c58f6a', '#b97d58', '#d0a07a', '#a8714f'], cumulative: [0.25, 0.5, 0.8, 1], edge: '#6d4a35', shadow: { dx: 2.2, dy: 3, color: '#3a2a18', alpha: 0.3 }, ridge: true },
    trees: { colors: ['#6f8f4a', '#62823f', '#7d9d54', '#547538'], rim: '#34502a', shadow: { dx: 1.6, dy: 2.2, color: '#3a2a18', alpha: 0.25 }, highlight: '#b9cc8a77' },
    mountain: { light: '#cdbda3', dark: '#9c8869' },
    label: { color: '#4a3a24', halo: '#efe2bdcc' },
    post: { grain: 0.55, mottle: 0.85, vignette: 0.35, saturation: 0.85, contrast: 1.05, warmth: 0.6, edge: 0.55, tint: [1.02, 0.97, 0.88] }
  },
  flat: {
    title: 'Plano limpio', background: '#f3f1ea',
    areas: { water: '#a8d1ea', land: '#eae6d6', sand: '#f1e7c4', field: '#e3e6bd', forest: '#bfdcae', park: '#cbe8b6', mountain: '#d3cdc3', urban: '#e3dccd', plaza: '#f6f1e2' },
    areaEdge: '#00000014', waterGlow: null,
    ways: { avenue: '#ffffff', street: '#ffffff', path: '#e6d9b8', river: '#a8d1ea', stream: '#b9dcf0', wall: '#8f887c', rail: '#a5a5ad', bridge: '#f1ece0' },
    casing: { ...casings('#c9c2b2'), river: '#86b5d4', stream: '#86b5d4' }, block: '#ece6d8',
    buildings: { colors: ['#d6d0c4', '#cfc8ba', '#dcd6cb', '#c8c1b3'], cumulative: [0.25, 0.5, 0.75, 1], edge: '#b7b0a2', shadow: null, ridge: false },
    trees: { colors: ['#9fca88', '#92c07b', '#abd596', '#86b671'], rim: '#6d9a5c', shadow: null, highlight: '#c9e8b866' },
    mountain: { light: '#d9d4ca', dark: '#bdb6a9' },
    label: { color: '#3b3b3b', halo: '#ffffffdd' }, post: { ...POST_NEUTRAL }
  },
  night: {
    title: 'Noche', background: '#0f1626',
    areas: { water: '#16314f', land: '#1b2434', sand: '#262a36', field: '#1e2a2a', forest: '#14281c', park: '#183221', mountain: '#2a2e3a', urban: '#222b3d', plaza: '#2f3850' },
    areaEdge: '#00000066', waterGlow: '#2a5a8a55',
    ways: { avenue: '#4a587a', street: '#3f4b69', path: '#34405a', river: '#16314f', stream: '#1b3a5c', wall: '#0b0f18', rail: '#59607a', bridge: '#55638a' },
    casing: { ...casings('#0b0f18'), river: '#0c1e33', stream: '#0c1e33' }, block: '#2a3550',
    buildings: { colors: ['#2b3550', '#323d5a', '#273049', '#f0c36a'], cumulative: [0.3, 0.6, 0.9, 1], edge: '#0d121c', shadow: { dx: 2, dy: 3, color: '#000000', alpha: 0.4 }, ridge: true },
    trees: { colors: ['#17321f', '#1b3a25', '#122a1a', '#1f4128'], rim: '#08140c', shadow: { dx: 1.5, dy: 2, color: '#000000', alpha: 0.35 }, highlight: '#2f6a4488' },
    mountain: { light: '#3a4358', dark: '#222a3a' },
    label: { color: '#d8e0f0', halo: '#0f1626cc' },
    post: { grain: 0.35, mottle: 0.3, vignette: 0.55, saturation: 0.8, contrast: 1.1, warmth: -0.2, edge: 0.2, tint: [0.78, 0.86, 1.08] }
  },
  watercolor: {
    title: 'Acuarela', background: '#f6efe0',
    areas: { water: '#9ec9dc', land: '#efe6c8', sand: '#f2e6c0', field: '#e6e3a8', forest: '#a8c98a', park: '#b9d99b', mountain: '#cdbfae', urban: '#e8d7bd', plaza: '#f7efd8' },
    areaEdge: '#8a6b5a40', waterGlow: '#d7eef799',
    ways: { avenue: '#fffaf0', street: '#fffaf0', path: '#dcc59a', river: '#9ec9dc', stream: '#b2d8e8', wall: '#8d7a6b', rail: '#8f8f98', bridge: '#f0e6cf' },
    casing: { ...casings('#b29a82'), river: '#6fa6bf', stream: '#6fa6bf' }, block: '#efe0c8',
    buildings: { colors: ['#e0aa90', '#d99a80', '#e8bba2', '#cf8e76'], cumulative: [0.25, 0.5, 0.8, 1], edge: '#a47c68', shadow: { dx: 1.8, dy: 2.4, color: '#6a4a3a', alpha: 0.16 }, ridge: false },
    trees: { colors: ['#92bb74', '#83ad66', '#a1c885', '#779f5b'], rim: '#5e8a4a', shadow: { dx: 1.4, dy: 2, color: '#6a4a3a', alpha: 0.14 }, highlight: '#cfe6b388' },
    mountain: { light: '#dccdbb', dark: '#b39f8b' },
    label: { color: '#5a4636', halo: '#f6efe0cc' },
    post: { grain: 0.25, mottle: 1, vignette: 0.15, saturation: 1.1, contrast: 1, warmth: 0.2, edge: 0.35, tint: [1, 1, 1.02] }
  }
};
export const THEME_IDS = Object.keys(THEMES);
export const DEFAULT_THEME = 'default';

// Estilo efectivo de un mapa: el tema elegido (o el del editor si no existe) con los ajustes de postproceso del propio mapa encima.
export function themeFor(map) {
  const base = THEMES[map?.style?.theme] ?? THEMES[DEFAULT_THEME];
  const override = map?.style?.post;
  return override ? { ...base, post: { ...base.post, ...override } } : base;
}

// Índice de color a partir de un número 0–1 y los límites acumulados del tema (permite que unas casas sean más raras que otras).
export function pickIndex(tone, cumulative) {
  for (let i = 0; i < cumulative.length; i++) if (tone < cumulative[i]) return i;
  return cumulative.length - 1;
}

// Ajustes de postproceso de entrada → solo claves conocidas, números dentro de rango. Devuelve null si no queda ninguno.
export function sanitizePost(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const key of POST_KEYS) {
    const value = Number(input[key]);
    if (input[key] === undefined || input[key] === null || input[key] === '' || !Number.isFinite(value)) continue;
    out[key] = Math.round(Math.min(POST_RANGE[key][1], Math.max(POST_RANGE[key][0], value)) * 100) / 100;
  }
  return Object.keys(out).length ? out : null;
}

export const COVERED_KINDS = { areas: AREA_KINDS, ways: WAY_KINDS };
