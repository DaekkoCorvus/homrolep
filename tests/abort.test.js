import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createNanoGPT } from '../src/server/ai/provider.js';
import { createAppServer } from '../src/server/index.js';
import { createRun } from '../src/server/game/run.js';

const completion = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });

test('slow models are never cut off, and stopping aborts the upstream call without touching the run', async (t) => {
  const runs = new Map();
  let mode = 'slow'; let upstreamAborted = false; let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    if (mode === 'hang') {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => { upstreamAborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 400)); // un modelo lento: sin límite de tiempo propio
    return completion('{"say":"Buenos días.","gesture":"sonríe"}');
  };
  const server = createAppServer({
    ai: createNanoGPT(fetchImpl), settings: { require: async () => ({ apiKey: 'k', model: 'm' }) },
    store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' });
  run.player.locationId = 'cafe'; run.world.hour = 9;
  runs.set(run.id, run);
  const talk = (body, signal) => fetch(`${base}/api/runs/${run.id}/talk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });

  mode = 'hang';
  const controller = new AbortController();
  const pending = talk({ op: 'start', npcId: 'luna_serp' }, controller.signal).catch((error) => error);
  await new Promise((resolve) => setTimeout(resolve, 150));
  controller.abort();
  assert.equal((await pending).name, 'AbortError');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(upstreamAborted, true, 'la llamada a la IA se cancela al detener');
  assert.equal(runs.get(run.id).encounter ?? null, null, 'una generación detenida no cambia la partida');

  mode = 'slow';
  const slow = await talk({ op: 'start', npcId: 'luna_serp' });
  assert.equal(slow.status, 200, 'el bloqueo se liberó y una respuesta lenta se acepta');
  assert.equal((await slow.json()).encounter.lines[0].text, 'Buenos días.');
  assert.equal(calls, 2);
});

test('the provider passes no timeout of its own and labels stops distinctly', async () => {
  let received;
  const ai = createNanoGPT(async (url, options) => { received = options; return completion('{"say":"hola"}'); });
  await ai.npcReply({ npc: { name: 'X', role: '', personality: {}, knowledge: [], secrets: [] }, player: { age: 20, gender: 'man' }, world: { day: 1, hour: 9, minute: 0 }, location: { name: 'L', description: '' }, relationship: { nameKnown: false, encounters: 0, notes: [], history: [] }, attitude: 'neutral', transcript: [] }, { apiKey: 'k', model: 'm' });
  assert.equal(received.signal, undefined, 'sin señal ni tiempo límite propios');
  const controller = new AbortController(); controller.abort();
  const stopped = createNanoGPT(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); });
  await assert.rejects(stopped.verify({ apiKey: 'k', model: 'm', signal: controller.signal }), { code: 'AI_ABORTED' });
});
