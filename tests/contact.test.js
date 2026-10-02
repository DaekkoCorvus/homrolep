import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../src/server/index.js';

test('contacts can be shared mid-conversation, only with every condition met, and regenerating undoes it', async (t) => {
  const runs = new Map();
  let claim = { give: true, conditionsMet: [true, false] };
  const seen = [];
  const ai = {
    npcReply: async (context) => { seen.push(context); return { say: 'Claro.', contact: claim }; },
    evaluateEncounter: async () => ({ notes: [], summary: '' }),
    prologue: async () => ({ text: 'x', locationId: 'station' })
  };
  const server = createAppServer({ ai, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, dev = false) => { const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(dev ? { 'x-hom-dev': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };

  const id = (await call('/api/runs', { name: 'Mara', age: 24, gender: 'woman', race: 'human' })).body.id;
  const stored = runs.get(id); stored.player.locationId = 'cafe'; stored.world.hour = 9; runs.set(id, stored);
  await call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' });

  let talked = await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Me pasas tu contacto?' });
  assert.equal(talked.body.relationships.luna_serp.contact, false, 'una condición sin cumplir bloquea el contacto');

  claim = { give: true, conditionsMet: [true, true] };
  talked = await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Ya somos amigos, ¿me das tu usuario?' });
  assert.equal(talked.body.relationships.luna_serp.contact, true);
  const card = talked.body.encounter.lines.at(-1);
  assert.deepEqual({ who: card.who, kind: card.kind, handle: card.handle }, { who: 'system', kind: 'contact', handle: '@LunaSerp' });
  assert.ok(runs.get(id).eventLog.some((event) => event.type === 'contact_shared'));

  // el NPC sabe que ya compartió su contacto
  await call(`/api/runs/${id}/talk`, { op: 'say', text: 'Gracias' });
  const last = seen.at(-1);
  assert.equal(last.relationship.contact, true);

  claim = { give: false, conditionsMet: [] };
  const regen = await call(`/api/runs/${id}/dev`, { op: 'regen' }, true);
  assert.equal(regen.status, 200);
  assert.equal(regen.body.encounter.lines.some((line) => line.kind === 'contact'), true, 'la tarjeta anterior pertenece a un turno previo y se conserva');

  claim = { give: false, conditionsMet: [] };
  await call(`/api/runs/${id}/talk`, { op: 'end' });
  const after = (await call(`/api/runs/${id}`)).body;
  assert.equal(after.relationships.luna_serp.contact, true);
  assert.deepEqual(after.contacts, [], 'compartir no es agregar: falta escribir el usuario en Mensajes');
  assert.equal((await call(`/api/runs/${id}/contacts`, { handle: '@LunaSerp' })).status, 200);

  // la hora: segunda conversación el mismo día
  await call(`/api/runs/${id}/talk`, { op: 'leave' });
  const rerun = runs.get(id); rerun.world.hour = 11; runs.set(id, rerun);
  await call(`/api/runs/${id}/talk`, { op: 'start', npcId: 'luna_serp' });
  const opening = seen.at(-1);
  assert.equal(opening.temporal.ultimaConversacion.mismoDia, true, 'el mismo día cuenta como el mismo día');
  assert.match(opening.temporal.ultimaConversacion.cuando, /^hoy a las/);
});
