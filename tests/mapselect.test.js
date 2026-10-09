import test from 'node:test';
import assert from 'node:assert/strict';
import { itemsInRect, itemBounds, toggleItem, mergeItems, assignToGroup, removeItems } from '../src/shared/mapSelect.js';
import { emptyMap, normalizeMap } from '../src/shared/mapSchema.js';

const map = () => normalizeMap({
  ...emptyMap('norte', 'N'),
  areas: [
    { id: 'ciudad', kind: 'urban', polygon: [[0, 0], [300, 0], [300, 300], [0, 300]], group: 'capital' },
    { id: 'campo', kind: 'field', polygon: [[400, 0], [700, 0], [700, 300], [400, 300]] },
    { id: 'tierra', kind: 'land', polygon: [[-1000, -1000], [1000, -1000], [1000, 1000], [-1000, 1000]] }
  ],
  ways: [{ id: 'calle', kind: 'street', points: [[50, 150], [250, 150]] }, { id: 'larga', kind: 'avenue', points: [[-500, 150], [900, 150]] }],
  districts: [{ id: 'centro', name: 'Centro', polygon: [[0, 0], [350, 0], [350, 350], [0, 350]], fog: 'known' }],
  places: [{ id: 'cafe', name: 'Café', kind: 'food', x: 100, y: 100 }, { id: 'torre', name: 'Torre', kind: 'poi', x: 500, y: 100, group: 'fuerte' }, { id: 'lejos', name: 'Lejos', kind: 'poi', x: 5000, y: 5000 }],
  links: [{ id: 'metro', name: 'Metro', mode: 'metro', from: 'cafe', to: 'torre', minutes: 10, cost: 1 }],
  groups: [{ id: 'capital', name: 'Capital' }, { id: 'fuerte', name: 'Fuerte', locked: true }, { id: 'libre', name: 'Libre' }, { id: 'sellado', name: 'Sellado', locked: true }]
});
const ids = (list) => list.map((item) => `${item.type}:${item.id}`).sort();

test('item bounds for points, areas and roads', () => {
  const m = map();
  assert.deepEqual(itemBounds('place', m.places[0]), { minX: 100, minY: 100, maxX: 100, maxY: 100 });
  assert.deepEqual(itemBounds('area', m.areas[0]), { minX: 0, minY: 0, maxX: 300, maxY: 300 });
  assert.deepEqual(itemBounds('way', m.ways[0]), { minX: 50, minY: 150, maxX: 250, maxY: 150 });
});

test('dragging left to right selects only what fits entirely inside; right to left also what it touches or crosses', () => {
  const m = map(); const rect = { minX: -20, minY: -20, maxX: 320, maxY: 320 };
  assert.deepEqual(ids(itemsInRect(m, rect, { mode: 'inside' })), ['area:ciudad', 'place:cafe', 'way:calle'], 'el distrito sobresale del rectángulo');
  assert.deepEqual(ids(itemsInRect(m, rect, { mode: 'touch' })), ['area:ciudad', 'area:tierra', 'district:centro', 'place:cafe', 'way:calle', 'way:larga']);
  // un rectángulo pequeño dentro de una zona grande: solo la «toca» (y la cruza una calle)
  const small = { minX: 120, minY: 120, maxX: 160, maxY: 160 };
  assert.deepEqual(ids(itemsInRect(m, small, { mode: 'inside' })), []);
  assert.deepEqual(ids(itemsInRect(m, small, { mode: 'touch' })), ['area:ciudad', 'area:tierra', 'district:centro', 'way:calle', 'way:larga']);
  // el rectángulo puede dibujarse del revés
  assert.deepEqual(ids(itemsInRect(m, { minX: 320, minY: 320, maxX: -20, maxY: -20 }, { mode: 'inside' })), ids(itemsInRect(m, rect, { mode: 'inside' })));
  assert.deepEqual(ids(itemsInRect(m, rect, { mode: 'touch', types: ['place'] })), ['place:cafe']);
  assert.deepEqual(itemsInRect(m, { minX: 9000, minY: 9000, maxX: 9100, maxY: 9100 }, { mode: 'touch' }), []);
});

test('a road crossing the rectangle without any point inside is still touched', () => {
  const m = map();
  assert.deepEqual(ids(itemsInRect(m, { minX: 100, minY: 140, maxX: 120, maxY: 160 }, { mode: 'touch', types: ['way'] })), ['way:calle', 'way:larga']);
  assert.deepEqual(ids(itemsInRect(m, { minX: 100, minY: 200, maxX: 120, maxY: 220 }, { mode: 'touch', types: ['way'] })), []);
});

test('toggling and merging selections never duplicates', () => {
  let selection = [];
  selection = toggleItem(selection, { type: 'place', id: 'cafe' });
  selection = toggleItem(selection, { type: 'area', id: 'ciudad' });
  assert.deepEqual(ids(selection), ['area:ciudad', 'place:cafe']);
  selection = toggleItem(selection, { type: 'place', id: 'cafe' });
  assert.deepEqual(ids(selection), ['area:ciudad']);
  assert.deepEqual(ids(mergeItems(selection, [{ type: 'area', id: 'ciudad' }, { type: 'way', id: 'calle' }])), ['area:ciudad', 'way:calle']);
  assert.notEqual(toggleItem(selection, { type: 'way', id: 'x' }), selection, 'devuelve una selección nueva');
});

test('assigning to a group moves what it can, skips what is locked and refuses locked targets', () => {
  const m = map();
  const picked = [{ type: 'place', id: 'cafe' }, { type: 'way', id: 'calle' }, { type: 'place', id: 'torre' }, { type: 'district', id: 'centro' }, { type: 'link', id: 'metro' }, { type: 'area', id: 'fantasma' }];
  const result = assignToGroup(m, picked, 'libre');
  assert.equal(result.moved, 3);
  assert.deepEqual(result.skipped, [{ type: 'place', id: 'torre', group: 'fuerte' }], 'la torre está en un grupo bloqueado y no se mueve');
  assert.equal(result.refused, null);
  assert.deepEqual(m.places.map((p) => p.group), ['libre', 'fuerte', null]);
  assert.equal(m.ways[0].group, 'libre'); assert.equal(m.districts[0].group, 'libre');

  const before = JSON.stringify(m);
  const refused = assignToGroup(m, [{ type: 'place', id: 'lejos' }], 'sellado');
  assert.equal(refused.moved, 0); assert.equal(refused.refused.reason, 'locked');
  assert.equal(JSON.stringify(m), before, 'un grupo bloqueado no recibe nada');
  assert.equal(assignToGroup(m, [{ type: 'place', id: 'lejos' }], 'inexistente').refused.reason, 'missing');

  const out = assignToGroup(m, [{ type: 'area', id: 'ciudad' }, { type: 'place', id: 'cafe' }], null);
  assert.equal(out.moved, 2); assert.equal(m.areas[0].group, null);
});

test('a locked group freezes its own members: they cannot be pulled out or removed in bulk', () => {
  const m = map();
  assert.equal(assignToGroup(m, [{ type: 'place', id: 'torre' }], null).moved, 0);
  assert.equal(m.places[1].group, 'fuerte');
  const gone = removeItems(m, [{ type: 'place', id: 'torre' }, { type: 'place', id: 'cafe' }, { type: 'way', id: 'calle' }]);
  assert.equal(gone.removed, 2); assert.deepEqual(gone.skipped.map((s) => s.id), ['torre']);
  assert.deepEqual(m.places.map((p) => p.id), ['torre', 'lejos']);
  assert.deepEqual(m.links, [], 'borrar un lugar borra sus enlaces');
  assert.deepEqual(m.ways.map((w) => w.id), ['larga']);
});
