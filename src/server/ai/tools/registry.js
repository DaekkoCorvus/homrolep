// Registro de herramientas («verbos del motor»). Cada herramienta declara su contrato (nombre, parámetros en JSON Schema, roles)
// y un handler determinista que valida y puede rechazar. Los botones de la interfaz y el modelo usan los mismos handlers, así que
// no pueden divergir y el juego sigue funcionando sin IA.
//
// handler(ctx, args) → { ok: true, run?, result?, hint? } | { ok: false, reason, hint?, code?, status? }
//   · `run` es la partida resultante (inmutable: el handler devuelve una copia, nunca muta `ctx.run`).
//   · Un rechazo es información: el modelo lo narra como «sí, pero…» (GAMEPLAY_DESIGN §2).
// Un handler puede ser síncrono o asíncrono; `call` conserva lo que devuelva y `execute` siempre devuelve una promesa.

export const reject = (reason, extra = {}) => ({ ok: false, reason, ...extra });

// Convierte un rechazo en Error (con `code` y `status`, que el servidor traduce a la respuesta HTTP) o devuelve la partida resultante.
export function unwrap(outcome, fallbackRun) {
  if (!outcome.ok) throw Object.assign(new Error(outcome.reason), { ...(outcome.code ? { code: outcome.code } : {}), ...(outcome.status ? { status: outcome.status } : {}) });
  return outcome.run ?? fallbackRun;
}

// Subconjunto de JSON Schema que usan las herramientas: type, enum, minimum/maximum, items, properties, required.
// Devuelve el motivo del primer fallo o null. Los argumentos vienen del modelo, así que nada se da por bueno.
export function validateArgs(schema, value, where = 'args') {
  if (!schema || !schema.type) return null;
  const kinds = { object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v), array: Array.isArray, string: (v) => typeof v === 'string', integer: Number.isInteger, number: Number.isFinite, boolean: (v) => typeof v === 'boolean' };
  if (!kinds[schema.type]?.(value)) return `${where} debe ser ${schema.type}`;
  if (schema.enum && !schema.enum.includes(value)) return `${where} debe ser uno de: ${schema.enum.join(', ')}`;
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${where} debe ser ≥ ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${where} debe ser ≤ ${schema.maximum}`;
  }
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) return `${where} es demasiado largo`;
  if (schema.type === 'array') {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${where} tiene demasiados elementos`;
    for (const [index, item] of value.entries()) { const problem = validateArgs(schema.items, item, `${where}[${index}]`); if (problem) return problem; }
  }
  if (schema.type === 'object') {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) if (value[key] === undefined) return `falta ${where}.${key}`;
    for (const key of Object.keys(value)) {
      if (value[key] === undefined) continue; // ausente
      if (!(key in properties)) { if (schema.additionalProperties === false) return `${where}.${key} no existe`; continue; }
      const problem = validateArgs(properties[key], value[key], `${where}.${key}`);
      if (problem) return problem;
    }
  }
  return null;
}

// Una herramienta: { name, description, params, roles, kind: 'query' | 'action', fire?, handler }.
//   roles: quién la ve. 'gm' y 'character' son roles del modelo; 'player' marca verbos que solo usa la interfaz.
//   fire:  «disparar y olvidar»; el modelo no necesita ver el resultado para seguir (p. ej. compartir contacto junto al diálogo).
export function defineTool(spec) {
  const { name, description, params = { type: 'object', properties: {}, additionalProperties: false }, roles = [], kind = 'action', fire = false, handler } = spec;
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(name ?? '')) throw new Error(`Nombre de herramienta inválido: ${name}`);
  if (typeof handler !== 'function' || !description) throw new Error(`Herramienta incompleta: ${name}`);
  if (!['query', 'action'].includes(kind)) throw new Error(`Tipo de herramienta inválido: ${name}`);
  return Object.freeze({ name, description, params, roles: Object.freeze([...roles]), kind, fire, handler });
}

export function createRegistry(definitions) {
  const tools = new Map();
  for (const definition of definitions) {
    const tool = defineTool(definition);
    if (tools.has(tool.name)) throw new Error(`Herramienta duplicada: ${tool.name}`);
    tools.set(tool.name, tool);
  }
  const visible = (role) => [...tools.values()].filter((tool) => tool.roles.includes(role));

  // Valida y ejecuta. Un handler que lanza se convierte en un rechazo (`handler_error`), salvo cancelaciones y fallos de la IA
  // (código AI_*): esos siguen su camino para que la partida no avance ni se pise.
  function call(name, args, ctx, { role } = {}) {
    const tool = tools.get(name);
    if (!tool || (role && !tool.roles.includes(role))) return reject(`La herramienta «${name}» no existe.`, { code: 'unknown_tool' });
    const problem = validateArgs(tool.params, args ?? {});
    if (problem) return reject(`Argumentos no válidos: ${problem}.`, { code: 'bad_arguments' });
    const done = (outcome) => (outcome && typeof outcome.ok === 'boolean' ? outcome : reject('La herramienta no devolvió un resultado válido.', { code: 'handler_error' }));
    const failed = (error) => { if (error?.name === 'AbortError' || String(error?.code).startsWith('AI_')) throw error; return reject(error?.message || 'Error de la herramienta.', { code: error?.code ?? 'handler_error', ...(error?.status ? { status: error.status } : {}) }); };
    try {
      const outcome = tool.handler(ctx, args ?? {});
      return typeof outcome?.then === 'function' ? outcome.then(done, failed) : done(outcome);
    } catch (error) { return failed(error); }
  }

  return {
    has: (name) => tools.has(name),
    get: (name) => tools.get(name),
    names: (role) => (role ? visible(role) : [...tools.values()]).map((tool) => tool.name),
    call,
    execute: async (name, args, ctx, options) => call(name, args, ctx, options),

    // Para los botones: ejecuta de forma síncrona y devuelve la partida, o lanza el rechazo como Error con su `code`.
    apply(name, args, ctx) {
      const outcome = call(name, args, ctx);
      if (typeof outcome?.then === 'function') throw new Error(`«${name}» es asíncrona: usa execute().`);
      return unwrap(outcome, ctx.run);
    },

    // Formato `tools` de chat/completions (compatible con OpenAI) de las herramientas que ve un rol.
    specs: (role) => visible(role).map(({ name, description, params }) => ({ type: 'function', function: { name, description, parameters: params } })),

    // Descripción en texto para el codec de reserva (modelos sin `tools`): una línea por herramienta con sus parámetros.
    describe: (role) => visible(role).map(({ name, description, params, kind }) => {
      const signature = Object.entries(params.properties ?? {}).map(([key, schema]) => `${key}${(params.required ?? []).includes(key) ? '' : '?'}: ${schema.enum ? schema.enum.join('|') : schema.type}`).join(', ');
      return `- ${name}(${signature}) [${kind === 'query' ? 'consulta' : 'acción'}]: ${description}`;
    }).join('\n')
  };
}
