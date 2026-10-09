// Encuadre de personajes en escena: tamaño y posición de cada retrato, medidos en ALTURAS DE ESCENARIO (1 = alto de la capa del retrato),
// así se ve igual en un teléfono que en pantalla ancha. Funciones puras compartidas por el servidor (validación de la ficha) y el cliente (render y editor).
// Una emoción sin frame propio usa `default`; sin `default`, el render clásico (CSS) — por eso las fichas antiguas no necesitan migración.

// 1 altura de escenario equivale a 220 cm al nivel del suelo: un personaje de 200 cm ocupa ~91 % del alto, uno de 155 cm ~70 %.
export const STAGE_CM = 220;
export const FRAME_LIMITS = { h: [0.1, 3], x: [-1, 1], y: [-2, 2] };
export const HEIGHT_CM_LIMITS = [30, 400];
export const IDLE_KINDS = ['breathe', 'bob', 'float', 'still'];
export const IDLE_RANGE = [0.25, 2];
export const MAX_FRAMES = 60;
export const IDLE_DEFAULT = { kind: 'breathe', strength: 1, speed: 1 };
const EMOTION = /^[a-z]{1,20}$/;
const MIN_SPAN = 0.05;   // separación mínima (fracción de la imagen) entre coronilla y pies al calibrar

const round = (value) => Math.round(value * 1e4) / 1e4 + 0;   // 4 decimales; «+ 0» evita el -0
const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
const finite = (value) => (value === null || value === '' || typeof value === 'boolean' ? NaN : Number(value));

// Un frame válido: `h` es obligatorio; `x` e `y` valen 0 si faltan. Devuelve null si no se puede salvar.
export function normalizeFrame(input) {
  if (!input || typeof input !== 'object') return null;
  const h = finite(input.h);
  if (!Number.isFinite(h)) return null;
  const axis = (key) => { const value = finite(input[key]); return Number.isFinite(value) ? round(clamp(value, FRAME_LIMITS[key])) : 0; };
  return { h: round(clamp(h, FRAME_LIMITS.h)), x: axis('x'), y: axis('y') };
}

// Normaliza el bloque `stage` de una ficha. Nunca lanza: lo irrecuperable se descarta. Devuelve null si no queda nada.
export function normalizeStage(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const cm = finite(input.heightCm);
  const heightCm = Number.isFinite(cm) ? Math.round(clamp(cm, HEIGHT_CM_LIMITS)) : null;
  const frames = {};
  const source = input.frames && typeof input.frames === 'object' && !Array.isArray(input.frames) ? input.frames : {};
  for (const [emotion, raw] of Object.entries(source)) {
    if (Object.keys(frames).length >= MAX_FRAMES) break;
    const frame = EMOTION.test(emotion) ? normalizeFrame(raw) : null;
    if (frame) frames[emotion] = frame;
  }
  const idleRaw = input.idle && typeof input.idle === 'object' && !Array.isArray(input.idle) ? input.idle : null;
  const level = (key) => { const value = finite(idleRaw?.[key]); return Number.isFinite(value) ? round(clamp(value, IDLE_RANGE)) : IDLE_DEFAULT[key]; };
  const idle = { kind: IDLE_KINDS.includes(idleRaw?.kind) ? idleRaw.kind : IDLE_DEFAULT.kind, strength: level('strength'), speed: level('speed') };
  if (heightCm === null && !Object.keys(frames).length && !idleRaw) return null;
  return { heightCm, frames, idle };
}

// Frame de una emoción, o null si no hay encuadre (render clásico). `hasOwn` evita que «constructor» o «valueOf» pasen por emociones.
export function frameFor(stage, emotion) {
  const frames = stage?.frames;
  if (!frames) return null;
  if (Object.hasOwn(frames, emotion)) return frames[emotion];
  return Object.hasOwn(frames, 'default') ? frames.default : null;
}

// Gestos del editor de encuadre, como funciones puras (el editor solo traduce el puntero a estos argumentos).
// `stageHpx` = alto del escenario en píxeles. En pantalla y crece hacia abajo; en el frame, `y` crece hacia arriba: de ahí el signo.
export function dragFrame(frame, dxPx, dyPx, stageHpx) {
  if (!(stageHpx > 0)) return frame;
  return normalizeFrame({ ...frame, x: frame.x + dxPx / stageHpx, y: frame.y - dyPx / stageHpx });
}

// Escala el frame alrededor de un punto fijo (`anchor`, en alturas de escenario: x desde el centro, y desde el suelo hacia arriba).
// Todo punto de la imagen se aleja del ancla por el mismo factor, así el dedo se queda sobre lo que tocó. Si `h` topa con el límite, el factor se ajusta.
export function pinchFrame(frame, factor, anchor = { x: 0, y: 0 }) {
  if (!Number.isFinite(factor) || factor <= 0) return frame;
  const h = clamp(frame.h * factor, FRAME_LIMITS.h);
  const scale = h / frame.h;
  return normalizeFrame({ h, x: anchor.x + (frame.x - anchor.x) * scale, y: anchor.y + (frame.y - anchor.y) * scale });
}

// Rectángulo de píxeles no transparentes (alfa > `threshold`) de un RGBA, ampliado un `margin` (fracción del lado mayor del contenido) y recortado a la imagen.
// Devuelve null si la imagen es totalmente transparente. Sirve para quitar los márgenes vacíos al subir un retrato.
export function alphaBounds(data, width, height, { threshold = 8, margin = 0.02 } = {}) {
  let left = width; let top = height; let right = -1; let bottom = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > threshold) { if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; bottom = y; }
    }
  }
  if (right < 0) return null;
  const pad = Math.round(Math.max(right - left + 1, bottom - top + 1) * margin);
  const x0 = Math.max(0, left - pad); const y0 = Math.max(0, top - pad);
  return { x: x0, y: y0, w: Math.min(width, right + 1 + pad) - x0, h: Math.min(height, bottom + 1 + pad) - y0 };
}

// Calibración: a partir de dónde están la coronilla y la planta de los pies en la imagen (fracciones verticales, 0 = arriba, 1 = abajo)
// y de la estatura real, calcula el frame que deja los pies en el suelo y la cabeza a la altura correcta.
export function calibrate({ headY, feetY, heightCm, x = 0 }) {
  const cm = finite(heightCm);
  if (!Number.isFinite(cm) || cm <= 0) throw new Error('Falta la estatura del personaje (en cm) para calibrar.');
  const head = finite(headY); const feet = finite(feetY);
  if (!Number.isFinite(head) || !Number.isFinite(feet) || feet - head < MIN_SPAN) throw new Error('Marca la coronilla arriba y los pies abajo, con algo de distancia entre ambas.');
  const h = (cm / STAGE_CM) / (feet - head);
  return normalizeFrame({ h, x, y: -(1 - feet) * h });
}
