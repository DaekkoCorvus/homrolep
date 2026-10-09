import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../src/server/index.js';
import { fixtureGeography } from './support/world.js';
import { createRun } from '../src/server/game/run.js';
import { summarizeRun } from '../src/server/saves/store.js';

test('save slots: list summaries, rename, duplicate (an independent copy) and delete', async (t) => {
  const runs = new Map();
  const first = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' });
  const second = createRun({ name: 'Iván', age: 30, gender: 'man', race: 'human' });
  second.updatedAt = new Date(Date.now() + 1000).toISOString();
  second.relationships = { luna_serp: { added: true } };
  for (const run of [first, second]) runs.set(run.id, run);
  const store = {
    saveRun: async (run) => runs.set(run.id, structuredClone(run)),
    loadRun: async (id) => { if (!runs.has(id)) throw Object.assign(new Error('Esa partida ya no existe.'), { status: 404 }); return structuredClone(runs.get(id)); },
    listRuns: async () => [...runs.values()].map(summarizeRun).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    deleteRun: async (id) => { runs.delete(id); }
  };
  const server = createAppServer({ geography: fixtureGeography(), ai: {}, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, method = body ? 'POST' : 'GET') => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };

  const listed = await call('/api/runs');
  assert.deepEqual(listed.body.map((item) => item.playerName), ['Iván', 'Mara'], 'la más reciente primero');
  assert.equal(listed.body[0].contacts, 1);
  assert.ok(!('player' in listed.body[0]) && !('eventLog' in listed.body[0]), 'la lista solo trae un resumen');

  assert.equal((await call(`/api/runs/${first.id}/slot`, { op: 'rename', title: '  Prueba del café  ' })).body.title, 'Prueba del café');
  assert.equal((await call('/api/runs')).body.find((item) => item.id === first.id).title, 'Prueba del café');

  const copied = await call(`/api/runs/${first.id}/slot`, { op: 'duplicate' });
  assert.equal(copied.status, 201);
  assert.notEqual(copied.body.id, first.id);
  assert.equal(copied.body.title, 'Prueba del café (copia)');
  runs.get(copied.body.id).player.money = 999;
  assert.notEqual(runs.get(first.id).player.money, 999, 'la copia es independiente del original');
  assert.equal((await call('/api/runs')).body.length, 3);

  assert.equal((await call(`/api/runs/${first.id}/slot`, { op: 'volar' })).status, 400);
  assert.equal((await call(`/api/runs/${first.id}`, null, 'DELETE')).status, 200);
  assert.equal(runs.has(first.id), false);
  assert.equal((await call(`/api/runs/${first.id}`, null, 'DELETE')).status, 404, 'borrar lo que ya no existe avisa');
  assert.equal((await call('/api/runs')).body.length, 2);
  assert.equal(runs.has(copied.body.id), true, 'las demás partidas siguen intactas');
});
