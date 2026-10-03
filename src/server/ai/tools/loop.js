// Bucle de herramientas: el modelo responde (texto + llamadas), el motor ejecuta cada llamada con su handler y, si hace falta,
// le devuelve el resultado para que narre lo que de verdad pasó. Tope de pasos; el último paso va sin herramientas.
//
// Dos transportes con el mismo registro y el mismo ejecutor, solo cambia el codec:
//   · native: `tools` / `tool_calls` de chat/completions (compatible con OpenAI).
//   · json:   reserva para modelos sin `tools`; el modelo responde {"say": "...", "calls": [{"tool": "...", "args": {...}}]}.
// En modo `auto` se prueba el nativo y, si el modelo lo rechaza (AI_MODEL) en la primera llamada, se recuerda y se usa el JSON.
import { AIError } from '../errors.js';

export const MAX_STEPS = 3;
const MAX_CALLS_PER_STEP = 6;

const stripFence = (text) => String(text ?? '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
function parseObject(text) {
  const raw = stripFence(text);
  for (const candidate of [raw, raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)]) {
    try { const value = JSON.parse(candidate); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch { /* siguiente intento */ }
  }
  return null;
}

// Lo que el modelo ve de un resultado: ok + datos, o el rechazo con su motivo y pista.
const forModel = (outcome) => (outcome.ok ? { ok: true, ...(outcome.result ?? {}), ...(outcome.hint ? { hint: outcome.hint } : {}) } : { ok: false, reason: outcome.reason, ...(outcome.hint ? { hint: outcome.hint } : {}) });

const JSON_PROTOCOL = (tools, last) => [
  'Protocolo de herramientas del motor. Responde SIEMPRE y solo con un objeto JSON: {"say": "texto para el jugador", "calls": [{"tool": "nombre", "args": {…}}]}.',
  last ? 'Ya no puedes llamar a más herramientas: usa "calls": [] y narra con lo que sabes.' : 'Usa "calls": [] si no necesitas ninguna herramienta. Si llamas a una acción o consulta, el motor te devolverá el resultado y entonces escribirás el texto final; lo que digas en "say" junto a la llamada es provisional.',
  'Herramientas disponibles:', tools
].join('\n');

export function createToolChat(complete) {
  const capabilities = new Map(); // modelo → 'native' | 'json'

  // Una llamada al modelo con el presupuesto de tokens habitual (los modelos con razonamiento gastan antes de responder).
  async function request(config, body, budget, totals) {
    let max = budget;
    for (let attempt = 0; ; attempt++) {
      const result = await complete(config, { ...body, max_tokens: max });
      totals.ms += result.ms ?? 0; totals.requests += 1;
      for (const [name, value] of Object.entries(result.usage ?? {})) totals.usage[name] = (totals.usage[name] ?? 0) + value;
      const choice = result.json?.choices?.[0];
      if (choice?.finish_reason === 'length') {
        if (attempt === 0 && max < 32000) { max = Math.min(32000, max * 4); continue; }
        throw new AIError('El modelo agotó el límite de respuesta pensando. Reintenta, o prueba un modelo con menos razonamiento en Ajustes.', 'AI_RESPONSE');
      }
      return choice?.message ?? {};
    }
  }

  // Ejecuta una lista de llamadas en orden sobre `state` (la partida avanza llamada a llamada). Devuelve lo que se anota y lo que ve el modelo.
  async function runCalls(requested, { registry, state, role, allow, trace }) {
    const done = [];
    for (const [index, item] of requested.entries()) {
      const outcome = index >= MAX_CALLS_PER_STEP
        ? { ok: false, reason: `Demasiadas llamadas a la vez (máximo ${MAX_CALLS_PER_STEP} por paso).`, code: 'too_many_calls' }
        : item.error ? { ok: false, reason: item.error, code: 'bad_arguments' } : await registry.execute(item.name, item.args, state, { role, allow });
      if (outcome.ok && outcome.run) state.run = outcome.run;
      trace.push({ tool: item.name, args: item.args ?? null, ok: outcome.ok, ...(outcome.ok ? { result: outcome.result ?? null } : { reason: outcome.reason, code: outcome.code ?? null }) });
      done.push({ item, outcome, tool: registry.get(item.name) });
    }
    return done;
  }
  // «Disparar y olvidar»: todas son herramientas que no necesitan que el modelo vea el resultado.
  const onlyFire = (done) => done.length > 0 && done.every(({ tool }) => tool?.fire === true);

  const unsupported = Symbol('native-unsupported');

  async function native(opts, totals, trace) {
    const { config, registry, role, allow, maxSteps, budget, params } = opts;
    const conversation = [...opts.messages];
    const tools = registry.specs(role, allow);
    for (let step = 1; step <= maxSteps; step++) {
      const last = step === maxSteps;
      let message;
      try {
        message = await request(config, { messages: conversation, ...params, ...(tools.length ? { tools, tool_choice: last ? 'none' : 'auto' } : {}) }, budget, totals);
      } catch (error) {
        if (step === 1 && error?.code === 'AI_MODEL') throw unsupported; // el modelo no admite `tools`: pasa al codec JSON
        throw error;
      }
      const text = typeof message.content === 'string' ? message.content.trim() : '';
      const calls = last ? [] : message.tool_calls ?? [];
      if (!calls.length) {
        if (!text && !trace.length) throw new AIError('El modelo no devolvió texto. Prueba de nuevo o cambia de modelo.', 'AI_RESPONSE');
        return { text, steps: step };
      }
      const requested = calls.map((call) => {
        const raw = call.function?.arguments;
        let args = {};
        if (typeof raw === 'string' && raw.trim()) { try { args = JSON.parse(raw); } catch { return { name: call.function?.name, id: call.id, error: 'Los argumentos no son JSON válido.' }; } }
        else if (raw && typeof raw === 'object') args = raw;
        return { name: call.function?.name, args, id: call.id };
      });
      const done = await runCalls(requested, opts);
      if (onlyFire(done) && text) return { text, steps: step };
      conversation.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
      for (const { item, outcome } of done) conversation.push({ role: 'tool', tool_call_id: item.id, content: JSON.stringify(forModel(outcome)) });
    }
    throw new AIError('El bucle de herramientas terminó sin respuesta.', 'AI_RESPONSE'); // inalcanzable: el último paso siempre retorna
  }

  async function jsonCodec(opts, totals, trace) {
    const { config, registry, role, allow, maxSteps, budget, params } = opts;
    const conversation = opts.messages.map((message) => ({ ...message }));
    const protocol = (last) => JSON_PROTOCOL(registry.describe(role, allow), last);
    for (let step = 1; step <= maxSteps; step++) {
      const last = step === maxSteps;
      // El protocolo se une al primer mensaje de sistema (algunos proveedores no admiten un `system` suelto en medio).
      const sent = conversation[0]?.role === 'system'
        ? [{ ...conversation[0], content: `${conversation[0].content}\n\n${protocol(last)}` }, ...conversation.slice(1)]
        : [{ role: 'system', content: protocol(last) }, ...conversation];
      const message = await request(config, { messages: sent, ...params }, budget, totals);
      const raw = typeof message.content === 'string' ? message.content.trim() : '';
      if (!raw && !trace.length) throw new AIError('El modelo no devolvió texto. Prueba de nuevo o cambia de modelo.', 'AI_RESPONSE');
      const data = parseObject(raw);
      // Si no habla el protocolo, su texto se toma como narración sin llamadas: un modelo torpe no bloquea el juego.
      const text = data ? (typeof data.say === 'string' ? data.say.trim() : '') : raw;
      const calls = !last && Array.isArray(data?.calls) ? data.calls.filter((call) => call && typeof call === 'object') : [];
      if (!calls.length) return { text, steps: step, ...(data ? {} : { unparsed: true }) };
      const done = await runCalls(calls.map((call) => ({ name: String(call.tool ?? ''), args: call.args && typeof call.args === 'object' ? call.args : {} })), opts);
      if (onlyFire(done) && text) return { text, steps: step };
      conversation.push({ role: 'assistant', content: raw });
      conversation.push({ role: 'user', content: `[Resultados del motor]\n${JSON.stringify(done.map(({ item, outcome }) => ({ tool: item.name, ...forModel(outcome) })))}\nEscribe ahora el JSON final con lo que realmente ocurrió.` });
    }
    throw new AIError('El bucle de herramientas terminó sin respuesta.', 'AI_RESPONSE');
  }

  // chatWithTools(config, messages, { registry, state, role, mode, maxSteps, maxTokens, params })
  //   state:  { run, … } contexto que reciben los handlers; `state.run` avanza con cada acción. Si algo falla, quien llama no guarda `state.run`.
  //   mode:   'auto' (por defecto) | 'native' | 'json'.
  // Devuelve { text, run, calls, mode, steps, requests, ms, usage }.
  return async function chatWithTools(config, messages, { registry, state, role, allow, mode = 'auto', maxSteps = MAX_STEPS, maxTokens = 1600, params = {} } = {}) {
    if (!registry || !state) throw new Error('chatWithTools necesita registry y state.');
    const totals = { ms: 0, requests: 0, usage: {} };
    const trace = [];
    const clean = { ...(Number.isFinite(params?.temperature) ? { temperature: params.temperature } : {}), ...(Number.isFinite(params?.top_p) ? { top_p: params.top_p } : {}) };
    const opts = { config, messages, registry, state, role, allow, trace, maxSteps: Math.max(1, Math.min(MAX_STEPS, maxSteps)), budget: Math.min(32000, maxTokens * 6 + 4000), params: clean };
    let used = mode === 'auto' ? capabilities.get(config.model) ?? 'native' : mode;
    let outcome;
    if (used === 'native') {
      try { outcome = await native(opts, totals, trace); }
      catch (error) {
        if (error !== unsupported) throw error;
        if (mode === 'native') throw new AIError('El modelo no admite herramientas nativas. Usa el modo JSON de reserva.', 'AI_MODEL', 400);
        capabilities.set(config.model, 'json'); used = 'json';
      }
    }
    if (used === 'json') outcome = await jsonCodec(opts, totals, trace);
    return { text: outcome.text, run: state.run, calls: trace, mode: used, steps: outcome.steps, requests: totals.requests, ms: totals.ms, usage: totals.usage, ...(outcome.unparsed ? { unparsed: true } : {}) };
  };
}
