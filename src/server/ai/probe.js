// Sonda de modelos (solo desarrollo): comprueba qué sabe hacer cada modelo con el protocolo que usará el motor y mide tiempo y tokens.
// Sirve para elegir entre llamadas de herramientas nativas (`tools`), el protocolo JSON de reserva o texto plano, y para comparar
// modelos entre sí sin jugar. Cada prueba son 1–2 llamadas cortas, así que el coste por modelo es de unos pocos miles de tokens.

const PLACES = ['apartment', 'cafe', 'park', 'store', 'station'];
const ACTIVITIES = ['browse', 'rest', 'chat', 'eat'];

const SCENE = 'Eres el GM de un juego. El jugador está en la estación. Ahora son las 10:00. Presentes: Luna Serp (barista). Lugares válidos: ' + PLACES.join(', ') + '.';

// Herramientas de ejemplo con la forma que tendrán las reales: una de consulta y dos de acción con valores cerrados.
export const PROBE_TOOLS = [
  { type: 'function', function: { name: 'who_is_here', description: 'Consulta quién está presente en el lugar actual.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
  { type: 'function', function: { name: 'travel', description: 'Mueve al jugador a un lugar. El motor calcula el tiempo y puede rechazarlo.', parameters: { type: 'object', properties: { place: { type: 'string', enum: PLACES } }, required: ['place'], additionalProperties: false } } },
  { type: 'function', function: { name: 'spend_time', description: 'El jugador dedica tiempo a una actividad. El motor decide cuántos minutos cuesta.', parameters: { type: 'object', properties: { activity: { type: 'string', enum: ACTIVITIES }, minutes_hint: { type: 'integer', minimum: 5, maximum: 240 } }, required: ['activity'], additionalProperties: false } } }
];

const stripFence = (text) => String(text ?? '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
const parse = (text) => { try { return JSON.parse(stripFence(text)); } catch { return undefined; } };
const messageOf = (json) => json?.choices?.[0]?.message ?? {};

// Cada prueba devuelve { ok, note } y puede lanzar; `run` mide tiempo y tokens de todas las llamadas que haga con `call`.
const TESTS = {
  plain: {
    label: 'Texto plano',
    async run(call) {
      const { json } = await call({ messages: [{ role: 'user', content: 'Responde únicamente con la palabra: LISTO' }], max_tokens: 2000 });
      const text = String(messageOf(json).content ?? '').trim();
      return { ok: /listo/i.test(text), note: text ? `«${text.slice(0, 40)}»` : 'sin texto' };
    }
  },
  json: {
    label: 'Protocolo JSON (reserva)',
    async run(call) {
      const system = `${SCENE}\nResponde solo con JSON: {"say":"narración breve","calls":[{"tool":"travel","args":{"place":"..."}}]}. Herramientas: travel(place), spend_time(activity, minutes_hint). Usa "calls": [] si no hace falta ninguna.`;
      const { json } = await call({ messages: [{ role: 'system', content: system }, { role: 'user', content: 'El jugador dice: «voy a la cafetería».' }], max_tokens: 3000 });
      const data = parse(messageOf(json).content);
      if (!data || typeof data.say !== 'string' || !Array.isArray(data.calls)) return { ok: false, note: 'no devolvió el JSON pedido' };
      const travel = data.calls.find((item) => item?.tool === 'travel');
      return { ok: travel?.args?.place === 'cafe', note: travel ? `travel → ${travel.args?.place}` : 'no llamó a travel' };
    }
  },
  tools: {
    label: 'Herramientas nativas',
    async run(call) {
      const messages = [{ role: 'system', content: SCENE }, { role: 'user', content: 'El jugador dice: «voy a la cafetería».' }];
      const { json } = await call({ messages, tools: PROBE_TOOLS, tool_choice: 'auto', max_tokens: 3000 });
      const first = messageOf(json);
      const requested = first.tool_calls?.[0];
      if (!requested) return { ok: false, note: 'no emitió tool_calls (respondió texto)' };
      const args = parse(requested.function?.arguments);
      if (requested.function?.name !== 'travel' || args?.place !== 'cafe') return { ok: false, note: `llamada inesperada: ${requested.function?.name}(${requested.function?.arguments})` };
      // Segunda vuelta: se devuelve el resultado del motor y el modelo debe narrar a partir de él (consultas y rechazos funcionan así).
      const result = { ok: true, place: 'cafe', minutes: 20, time: '10:20' };
      const second = await call({ messages: [...messages, { role: 'assistant', content: first.content ?? null, tool_calls: first.tool_calls }, { role: 'tool', tool_call_id: requested.id, content: JSON.stringify(result) }], tools: PROBE_TOOLS, max_tokens: 3000 });
      const text = String(messageOf(second.json).content ?? '').trim();
      return { ok: text.length > 0, note: text ? 'llamada válida + narró con el resultado' : 'llamada válida pero no continuó tras el resultado' };
    }
  },
  multi: {
    label: 'Varias herramientas a la vez',
    async run(call) {
      const { json } = await call({ messages: [{ role: 'system', content: SCENE }, { role: 'user', content: 'El jugador dice: «miro quién hay aquí y luego espero un rato a que pase el tiempo».' }], tools: PROBE_TOOLS, tool_choice: 'auto', max_tokens: 3000 });
      const calls = messageOf(json).tool_calls ?? [];
      const names = calls.map((item) => item.function?.name);
      const valid = calls.every((item) => parse(item.function?.arguments) !== undefined);
      return { ok: calls.length >= 1 && valid, note: calls.length ? `${calls.length} llamada(s): ${names.join(', ')}${valid ? '' : ' (argumentos inválidos)'}` : 'ninguna llamada' };
    }
  },
  schema: {
    label: 'Salida con esquema',
    async run(call) {
      const { json } = await call({
        messages: [{ role: 'system', content: SCENE }, { role: 'user', content: 'Narra en una frase que el jugador espera, e indica cuántos minutos.' }],
        response_format: { type: 'json_schema', json_schema: { name: 'wait_result', strict: true, schema: { type: 'object', properties: { narration: { type: 'string' }, minutes: { type: 'integer' } }, required: ['narration', 'minutes'], additionalProperties: false } } }, max_tokens: 3000
      });
      const data = parse(messageOf(json).content);
      return { ok: typeof data?.narration === 'string' && Number.isInteger(data?.minutes), note: data ? 'JSON válido según el esquema' : 'respuesta no válida' };
    }
  }
};

export const probeTests = Object.entries(TESTS).map(([id, { label }]) => ({ id, label }));
export const MAX_PROBE_MODELS = 4;

// Ejecuta las pruebas con cada modelo (de uno en uno, para que los tiempos no se solapen).
// `ai` es el proveedor (`complete`), `config` la configuración guardada; cada modelo sustituye a `config.model`.
export async function runProbe(ai, config, { models = [], tests = Object.keys(TESTS) } = {}) {
  const chosen = [...new Set(models.length ? models : [config.model])].slice(0, MAX_PROBE_MODELS);
  const selected = tests.filter((id) => TESTS[id]);
  const results = [];
  for (const model of chosen) {
    const row = { model, tests: [] };
    for (const id of selected) {
      const started = Date.now(); const usage = {}; let calls = 0;
      const call = async (body) => {
        calls += 1;
        const result = await ai.complete({ ...config, model }, body, { detail: true });
        for (const [name, value] of Object.entries(result.usage ?? {})) usage[name] = (usage[name] ?? 0) + value;
        return result;
      };
      try {
        const outcome = await TESTS[id].run(call);
        row.tests.push({ id, label: TESTS[id].label, ok: outcome.ok, note: outcome.note, ms: Date.now() - started, calls, usage });
      } catch (error) {
        if (error?.code === 'AI_ABORTED' || error?.code === 'AI_AUTH' || error?.code === 'AI_BALANCE') throw error; // no tiene sentido seguir
        row.tests.push({ id, label: TESTS[id].label, ok: false, unsupported: error?.code === 'AI_MODEL', note: error?.detail || error?.message || 'error', code: error?.code ?? null, ms: Date.now() - started, calls, usage });
      }
    }
    results.push(row);
  }
  return { tests: selected.map((id) => ({ id, label: TESTS[id].label })), results };
}
