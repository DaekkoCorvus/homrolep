import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_CM, MAX_FRAMES, normalizeFrame, normalizeStage, frameFor, calibrate, dragFrame, pinchFrame, alphaBounds } from '../src/shared/stage.js';
import { validateNpcCard } from '../src/server/game/cards.js';
import { publicNpc } from '../src/server/game/npcs.js';

const locations = ['cafe', 'park'];
const card = (extra = {}) => ({
  id: 'mara_test', name: 'Mara', summary: 'Soñadora.', schedule: [{ days: [0], from: 9, to: 17, locationId: 'park' }], ...extra
});

test('normalizeStage clamps ranges, drops junk and returns null when empty', () => {
  assert.equal(normalizeStage(undefined), null);
  assert.equal(normalizeStage(null), null);
  assert.equal(normalizeStage('texto'), null);
  assert.equal(normalizeStage([]), null);
  assert.equal(normalizeStage({}), null, 'sin nada que guardar → null');
  assert.equal(normalizeStage({ frames: { Mal: { h: 1 }, 'con espacio': { h: 1 }, ok: 'no soy frame' } }), null, 'solo basura → null');

  const stage = normalizeStage({
    heightCm: 155.4,
    frames: { default: { h: 0.123456, x: 0.5, y: -0.03 }, feliz: { h: 9, x: -5, y: 7 }, tiny: { h: 0.001 }, X: { h: 1 }, 'a-b': { h: 1 }, sinh: { x: 1 } },
    idle: { kind: 'bob', strength: 9, speed: 0.01 }
  });
  assert.equal(stage.heightCm, 155);
  assert.deepEqual(stage.frames.default, { h: 0.1235, x: 0.5, y: -0.03 }, 'redondea a 4 decimales');
  assert.deepEqual(stage.frames.feliz, { h: 3, x: -1, y: 2 }, 'recorta a los rangos');
  assert.deepEqual(stage.frames.tiny, { h: 0.1, x: 0, y: 0 }, 'x e y valen 0 si faltan; h se recorta al mínimo');
  assert.deepEqual(Object.keys(stage.frames).sort(), ['default', 'feliz', 'tiny'], 'claves inválidas y frames sin h se descartan');
  assert.deepEqual(stage.idle, { kind: 'bob', strength: 2, speed: 0.25 });

  assert.equal(normalizeStage({ heightCm: 10 }).heightCm, 30);
  assert.equal(normalizeStage({ heightCm: 9999 }).heightCm, 400);
  assert.equal(normalizeStage({ heightCm: 'alto', idle: {} }).heightCm, null);
  assert.deepEqual(normalizeStage({ heightCm: 170 }).idle, { kind: 'breathe', strength: 1, speed: 1 }, 'idle por defecto');
  assert.equal(normalizeStage({ idle: { kind: 'volar' } }).idle.kind, 'breathe', 'idle desconocido → breathe');
  assert.equal(normalizeFrame({ h: true }), null, 'un booleano no es un número');
  assert.equal(normalizeFrame({ h: '0.5' }).h, 0.5, 'acepta números en texto');
});

test('normalizeStage keeps at most 60 frames', () => {
  const names = Array.from({ length: 80 }, (_, index) => `e${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))}`);
  const frames = Object.fromEntries(names.map((name) => [name, { h: 0.7 }]));
  assert.equal(Object.keys(normalizeStage({ frames }).frames).length, MAX_FRAMES);
});

test('frameFor falls back from emotion to default and then to the classic render', () => {
  const stage = normalizeStage({ frames: { default: { h: 0.7 }, feliz: { h: 0.8, x: 0.1 } } });
  assert.equal(frameFor(stage, 'feliz').h, 0.8);
  assert.equal(frameFor(stage, 'triste').h, 0.7, 'emoción sin frame → default');
  assert.equal(frameFor(normalizeStage({ heightCm: 160 }), 'default'), null, 'sin frames → render clásico');
  assert.equal(frameFor(null, 'default'), null);
  assert.equal(frameFor(undefined, 'feliz'), null);
  assert.equal(frameFor(stage, 'constructor').h, 0.7, 'nombres del prototipo no cuentan como emociones');
});

test('calibrate puts the feet on the floor and the head at the stated height', () => {
  assert.deepEqual(calibrate({ headY: 0, feetY: 1, heightCm: STAGE_CM }), { h: 1, x: 0, y: 0 });
  // 110 cm = mitad del escenario; la figura ocupa 0.9 de la imagen → imagen de 0.5/0.9 y los pies 10 % por encima del borde inferior.
  const small = calibrate({ headY: 0, feetY: 0.9, heightCm: 110 });
  assert.equal(small.h, 0.5556);
  assert.equal(small.y, -0.0556);
  assert.equal(calibrate({ headY: 0.1, feetY: 0.9, heightCm: 198, x: 0.2 }).x, 0.2);
  // Comprobación geométrica: cabeza y pies caen donde deben (en alturas de escenario sobre el suelo).
  const frame = calibrate({ headY: 0.06, feetY: 0.94, heightCm: 198 });
  const feet = frame.y + (1 - 0.94) * frame.h;
  const head = frame.y + (1 - 0.06) * frame.h;
  assert.ok(Math.abs(feet) < 1e-3, 'los pies quedan en el suelo');
  assert.ok(Math.abs(head - 198 / STAGE_CM) < 1e-3, 'la coronilla queda a la estatura indicada');

  assert.throws(() => calibrate({ headY: 0.9, feetY: 0.1, heightCm: 160 }), /coronilla/, 'guías invertidas');
  assert.throws(() => calibrate({ headY: 0.5, feetY: 0.52, heightCm: 160 }), /coronilla/, 'guías casi juntas');
  assert.throws(() => calibrate({ headY: 0, feetY: 1 }), /estatura/);
  assert.throws(() => calibrate({ headY: 0, feetY: 1, heightCm: 0 }), /estatura/);
});

test('validateNpcCard keeps stage and leaves it out when there is none', () => {
  const stage = { heightCm: 155, frames: { default: { h: 0.71, x: 0, y: -0.03 } }, idle: { kind: 'float', strength: 1.5, speed: 1 } };
  const ok = validateNpcCard(card({ stage }), locations);
  assert.deepEqual(ok.stage, stage);
  assert.deepEqual(validateNpcCard(ok, locations).stage, stage, 'una ficha ya validada se conserva idéntica al volver a guardarla');
  assert.equal('stage' in validateNpcCard(card(), locations), false, 'sin encuadre no aparece la clave');
  assert.equal('stage' in validateNpcCard(card({ stage: {} }), locations), false);
  assert.equal('stage' in validateNpcCard(card({ stage: 'basura' }), locations), false);
});

test('publicNpc exposes a normalised stage, or null', () => {
  const base = { id: 'mara_test', name: 'Mara', role: 'Florista', emotionsStay: ['despedida'] };
  assert.equal(publicNpc(base).stage, null);
  assert.deepEqual(publicNpc({ ...base, stage: { heightCm: 155, frames: { default: { h: 0.7 } } } }).stage.frames.default, { h: 0.7, x: 0, y: 0 });
  assert.equal(publicNpc({ ...base, stage: { frames: { default: { h: 99 } } } }).stage.frames.default.h, 3, 'una ficha editada a mano no llega sin recortar al cliente');
});

test('dragFrame moves in stage heights: screen down lowers the sprite', () => {
  const start = { h: 0.7, x: 0, y: 0 };
  assert.deepEqual(dragFrame(start, 100, 0, 500), { h: 0.7, x: 0.2, y: 0 }, '100 px a la derecha en un escenario de 500 px = 0.2');
  assert.deepEqual(dragFrame(start, 0, 50, 500), { h: 0.7, x: 0, y: -0.1 }, 'bajar el dedo baja la imagen (y negativo)');
  assert.deepEqual(dragFrame(start, 0, -50, 500), { h: 0.7, x: 0, y: 0.1 });
  assert.deepEqual(dragFrame(start, 5000, -9e6, 500), { h: 0.7, x: 1, y: 2 }, 'recorta a los rangos');
  assert.equal(dragFrame(start, 10, 10, 0), start, 'sin altura de escenario no hace nada');
});

test('pinchFrame scales around the anchor so that the touched point stays put', () => {
  const frame = { h: 0.5, x: 0, y: 0 };
  assert.deepEqual(pinchFrame(frame, 2, { x: 0, y: 0 }), { h: 1, x: 0, y: 0 });
  assert.deepEqual(pinchFrame(frame, 2, { x: 0.5, y: 0 }), { h: 1, x: -0.5, y: 0 }, 'el ancla a la derecha empuja el centro a la izquierda');
  assert.deepEqual(pinchFrame({ h: 0.5, x: 0.1, y: -0.2 }, 3, { x: 0.1, y: -0.2 }), { h: 1.5, x: 0.1, y: -0.2 }, 'si el ancla es la base de la imagen, no se mueve');
  // El punto de la imagen bajo el ancla (a 0.3 del borde inferior) sigue en su sitio.
  const anchor = { x: 0.05, y: 0.1 };
  const before = { h: 0.6, x: 0.2, y: -0.1 };
  const after = pinchFrame(before, 1.5, anchor);
  const at = (f, v) => f.y + v * f.h;   // altura sobre el suelo de un punto a fracción `v` de la imagen
  const v = (anchor.y - before.y) / before.h;
  assert.ok(Math.abs(at(after, v) - anchor.y) < 1e-3);
  assert.equal(pinchFrame({ h: 2.9, x: 0, y: 0 }, 5, { x: 0, y: 0 }).h, 3, 'respeta el tamaño máximo');
  assert.equal(pinchFrame({ h: 0.12, x: 0, y: 0 }, 0.01, { x: 0, y: 0 }).h, 0.1, 'y el mínimo');
  assert.equal(pinchFrame(frame, 0), frame);
  assert.equal(pinchFrame(frame, NaN), frame);
});

test('alphaBounds finds the opaque rectangle plus a small margin', () => {
  const width = 100; const height = 200;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x, y, alpha) => { data[(y * width + x) * 4 + 3] = alpha; };
  assert.equal(alphaBounds(data, width, height), null, 'imagen vacía');
  for (let y = 50; y < 150; y++) for (let x = 30; x < 70; x++) paint(x, y, 255);
  paint(5, 5, 8);   // alfa en el umbral: ruido que no cuenta
  assert.deepEqual(alphaBounds(data, width, height, { margin: 0 }), { x: 30, y: 50, w: 40, h: 100 });
  // Margen del 2 % del lado mayor (100 px) = 2 px por lado.
  assert.deepEqual(alphaBounds(data, width, height), { x: 28, y: 48, w: 44, h: 104 });
  paint(0, 0, 200);
  assert.deepEqual(alphaBounds(data, width, height, { margin: 0.5 }), { x: 0, y: 0, w: 100, h: 200 }, 'el margen no se sale de la imagen');
  const opaque = new Uint8ClampedArray(width * height * 4).fill(255);
  assert.deepEqual(alphaBounds(opaque, width, height), { x: 0, y: 0, w: 100, h: 200 }, 'una imagen opaca no se recorta');
});
