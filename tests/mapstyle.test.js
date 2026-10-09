import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, THEME_IDS, DEFAULT_THEME, POST_KEYS, POST_RANGE, POST_NEUTRAL, themeFor, pickIndex, sanitizePost } from '../src/shared/mapStyle.js';
import { AREA_KINDS, WAY_KINDS } from '../src/shared/mapDefaults.js';
import { emptyMap, normalizeMap, validateMap } from '../src/shared/mapSchema.js';

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

test('every theme paints every kind of area and road, with valid colors', () => {
  assert.ok(THEME_IDS.length >= 4 && THEME_IDS.includes(DEFAULT_THEME));
  for (const [id, theme] of Object.entries(THEMES)) {
    assert.ok(theme.title, `${id}: nombre`);
    assert.match(theme.background, HEX);
    for (const kind of AREA_KINDS) assert.match(theme.areas[kind], HEX, `${id}: área ${kind}`);
    for (const kind of WAY_KINDS) assert.match(theme.ways[kind], HEX, `${id}: camino ${kind}`);
    for (const color of [...theme.buildings.colors, ...theme.trees.colors, theme.trees.rim, theme.mountain.light, theme.mountain.dark, theme.block, theme.areaEdge, theme.label.color, theme.label.halo]) assert.match(color, HEX, `${id}: ${color}`);
    assert.equal(theme.buildings.cumulative.length, theme.buildings.colors.length, `${id}: límites de colores de casas`);
    assert.equal(theme.buildings.cumulative.at(-1), 1);
    assert.deepEqual([...theme.buildings.cumulative].sort((a, b) => a - b), theme.buildings.cumulative, `${id}: límites crecientes`);
    for (const key of POST_KEYS) {
      const value = theme.post[key]; const [low, high] = POST_RANGE[key];
      assert.ok(value >= low && value <= high, `${id}: ${key} = ${value} fuera de [${low}, ${high}]`);
    }
    assert.equal(theme.post.tint.length, 3);
    if (theme.buildings.shadow) assert.ok(theme.buildings.shadow.alpha > 0 && theme.buildings.shadow.alpha < 1);
  }
});

test('the editor theme and the flat theme do not touch the image; the others do', () => {
  assert.deepEqual(THEMES.default.post, POST_NEUTRAL);
  assert.deepEqual(THEMES.flat.post, POST_NEUTRAL);
  for (const id of ['parchment', 'night', 'watercolor']) assert.notDeepEqual(THEMES[id].post, POST_NEUTRAL, id);
  assert.ok(THEMES.parchment.post.grain > 0 && THEMES.parchment.post.mottle > 0, 'el pergamino tiene grano y manchas de papel');
});

test('picking a house color from a 0–1 number follows the theme weights', () => {
  assert.equal(pickIndex(0, [0.25, 0.5, 0.75, 1]), 0);
  assert.equal(pickIndex(0.26, [0.25, 0.5, 0.75, 1]), 1);
  assert.equal(pickIndex(0.999, [0.25, 0.5, 0.75, 1]), 3);
  assert.equal(pickIndex(1, [0.25, 0.5, 0.75, 1]), 3, 'el extremo no se sale de la lista');
  const lit = THEMES.night.buildings.cumulative; let windows = 0;
  for (let i = 0; i < 1000; i++) if (pickIndex(i / 1000, lit) === lit.length - 1) windows += 1;
  assert.ok(windows > 40 && windows < 160, `de noche, pocas casas con luz (${windows}/1000)`);
});

test('post-process overrides keep only known keys, clamp to range and round', () => {
  assert.equal(sanitizePost(null), null);
  assert.equal(sanitizePost('x'), null);
  assert.equal(sanitizePost({}), null);
  assert.equal(sanitizePost({ nada: 1, grain: 'mucho', vignette: '' }), null);
  assert.deepEqual(sanitizePost({ grain: 5, saturation: -3, contrast: 1.234, warmth: '0.5', basura: 1 }), { grain: 1, saturation: 0, contrast: 1.23, warmth: 0.5 });
});

test('a map picks its theme and can fine-tune the shader; unknown themes fall back to the editor style', () => {
  const plain = normalizeMap({ ...emptyMap('norte', 'N') });
  assert.deepEqual(plain.style, { theme: 'default' }, 'sin ajustes no se guarda nada de más');
  assert.equal(themeFor(plain), THEMES.default);
  const tuned = normalizeMap({ ...emptyMap('norte', 'N'), style: { theme: 'parchment', post: { grain: 0.1, basura: 3 } } });
  assert.deepEqual(tuned.style, { theme: 'parchment', post: { grain: 0.1 } });
  const effective = themeFor(tuned);
  assert.equal(effective.post.grain, 0.1);
  assert.equal(effective.post.vignette, THEMES.parchment.post.vignette, 'lo no tocado sigue siendo del tema');
  assert.equal(THEMES.parchment.post.grain, 0.55, 'el tema original no se modifica');
  assert.deepEqual(normalizeMap(JSON.parse(JSON.stringify(tuned))), tuned, 'normalizar dos veces no cambia nada');
  assert.equal(themeFor({ style: { theme: 'inventado' } }), THEMES.default);
  assert.equal(themeFor(null), THEMES.default);
});

test('validation: an unknown theme is a warning, never an error', () => {
  const good = validateMap(normalizeMap({ ...emptyMap('norte', 'N'), style: { theme: 'night' } }));
  assert.deepEqual(good.warnings, []); assert.equal(good.ok, true);
  const unknown = validateMap(normalizeMap({ ...emptyMap('norte', 'N'), style: { theme: 'neon' } }));
  assert.equal(unknown.ok, true);
  assert.deepEqual(unknown.warnings.map((item) => item.code), ['style_theme']);
  assert.match(unknown.warnings[0].message, /parchment/);
});
