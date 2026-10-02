// Compositor de prompts por módulos, al estilo de los presets de SillyTavern.
// Un preset es una lista ordenada de módulos: de TEXTO (editable, con macros {{char}}…) o AUTOMÁTICOS (los rellena el motor con
// datos del juego). Hay cuatro prompts: character (en persona), text (chat de mensajes), gm y social.
import { randomUUID } from 'node:crypto';
import { characterBehavior, characterEngine, CHARACTER_TASKS, TEXT_TASKS, GM_MAIN, GM_TASKS, SOCIAL_MAIN, SOCIAL_TASKS } from './prompts.js';

const task = { label: 'Instrucción del turno', description: 'El texto de «Instrucciones por tipo de turno»: cambia según lo que se pide en cada llamada.', special: true };
const format = { label: 'Formato de salida', description: 'JSON que el motor sabe leer. Obligatorio: puedes moverlo, no quitarlo ni editarlo.', special: true, locked: true };

const DIALOGUE_AUTOS = {
  card: { label: 'Ficha del personaje', description: 'Apariencia, personalidad, trasfondo, conocimientos, secretos y conexiones de la tarjeta del NPC.', keys: ['tu'], role: 'system' },
  world: { label: 'Mundo y momento', description: 'Fecha y hora del juego y el lugar donde ocurre la escena.', keys: ['ahora', 'lugar'], role: 'user' },
  persona: { label: 'Lo que sabe del jugador', description: 'Solo lo que el personaje puede saber: lo que ve, el nombre que le dieron y lo que le han contado. Nunca el nombre real si no se lo dijeron.', keys: ['loQueSabesDeLaOtraPersona'], role: 'user' },
  relationship: { label: 'Relación y recuerdos', description: 'Actitud actual, última conversación, impresiones privadas (notas del GM) y resúmenes previos.', keys: ['vuestraRelacion'], role: 'user' },
  commitments: { label: 'Pendientes', description: 'Citas, encargos y promesas vigentes con esta persona.', keys: ['pendientesConEstaPersona'], role: 'user' },
  contact: { label: 'Contacto', description: 'Si ya compartió su usuario y qué condiciones debe cumplir para hacerlo.', keys: ['contacto'], role: 'user' },
  emotions: { label: 'Emociones', description: 'Expresiones (imágenes) disponibles, las que se mantienen y la que está activa.', keys: ['emocionesDisponibles', 'emocionesQueSeMantienen', 'expresionActual'], role: 'user' },
  intent: { label: 'Intención anterior', description: 'La nota privada que el personaje se dejó en su turno anterior.', keys: ['tuIntencionAnterior'], role: 'user' },
  history: { label: 'Conversación', description: 'Lo dicho hasta ahora en esta conversación.', keys: ['conversacion'], role: 'user' },
  task, format
};

export const KINDS = {
  character: {
    label: 'Personaje', short: 'Character',
    description: 'Se envía cuando el modelo interpreta a un personaje en una conversación en persona.',
    modes: [{ id: 'open', label: 'Abre la conversación' }, { id: 'reply', label: 'Responde al jugador' }, { id: 'closing', label: 'Se despide' }],
    macros: [['char', 'Nombre del personaje'], ['user', 'Cómo llama el personaje al jugador (su nombre si se lo dijeron; si no, «la otra persona»)'], ['location', 'Lugar de la escena'], ['time', 'Fecha y hora del juego'], ['mode', 'Tipo de turno']],
    autos: DIALOGUE_AUTOS, tasks: CHARACTER_TASKS
  },
  text: {
    label: 'Texto', short: 'Text',
    description: 'Se envía cuando la interacción es un chat de mensajes (NorthLife).',
    modes: [{ id: 'chat', label: 'Responde un mensaje' }],
    macros: [['char', 'Nombre del personaje'], ['user', 'Cómo llama el personaje al jugador'], ['time', 'Fecha y hora del juego'], ['mode', 'Tipo de turno']],
    autos: DIALOGUE_AUTOS, tasks: TEXT_TASKS
  },
  gm: {
    label: 'GM', short: 'GM',
    description: 'Se envía cuando el modelo hace de narrador: narra acciones, evalúa conversaciones y traduce los chats para el motor.',
    modes: [{ id: 'evaluation', label: 'Evalúa una conversación' }, { id: 'narration', label: 'Narra acción libre' }, { id: 'action', label: 'Narra otras acciones' }, { id: 'chats', label: 'Procesa chats pendientes' }],
    macros: [['player', 'Nombre real del jugador'], ['user', 'Igual que player'], ['char', 'Personaje evaluado (si aplica)'], ['location', 'Lugar actual'], ['time', 'Fecha y hora del juego'], ['mode', 'Tipo de llamada']],
    autos: {
      player: { label: 'Jugador', description: 'Nombre, edad, género, origen, ocupación, dinero y reputación del jugador. El GM lo sabe todo.', keys: ['jugador'], role: 'user' },
      world: { label: 'Mundo y lugar', description: 'Hora, estado del mundo, lugar actual y anterior, y prólogo.', keys: ['ahora', 'mundo', 'lugar', 'lugarAnterior', 'prologo'], role: 'user' },
      events: { label: 'Sucesos y acción', description: 'Sucesos recientes y la acción que acaba de hacer el jugador.', keys: ['sucesosRecientes', 'accion'], role: 'user' },
      present: { label: 'Personas presentes', description: 'Quién está en el lugar (para abrir un encuentro).', keys: ['personasPresentes'], role: 'user' },
      character: { label: 'Personaje evaluado', description: 'Resumen y personalidad del personaje de la conversación.', keys: ['personaje'], role: 'user' },
      relationship: { label: 'Relación y recuerdos', description: 'Actitud previa, última conversación y recuerdos privados del personaje.', keys: ['relacion'], role: 'user' },
      pending: { label: 'Pendientes y lugares', description: 'Acuerdos vigentes (con id) y lugares del mapa.', keys: ['pendientes', 'lugares'], role: 'user' },
      history: { label: 'Conversación o chats', description: 'La conversación a evaluar o los chats pendientes de procesar.', keys: ['conversacion', 'chats'], role: 'user' },
      task, format
    },
    tasks: GM_TASKS
  },
  social: {
    label: 'Social', short: 'Social',
    description: 'Se envía en NorthLife: genera las publicaciones del feed (también de cuentas inventadas) y las reacciones a lo que publica o responde el jugador.',
    modes: [{ id: 'post', label: 'Genera publicaciones del feed' }, { id: 'reply', label: 'Reacciona al jugador' }],
    macros: [['player', 'Nombre real del jugador'], ['time', 'Fecha y hora del juego'], ['mode', 'Tipo de llamada']],
    autos: {
      world: { label: 'Momento y ciudad', description: 'Fecha y hora del juego, ciudad y lugares (color local para las publicaciones).', keys: ['ahora', 'dia', 'ciudad', 'lugares'], role: 'user' },
      accounts: { label: 'Cuentas conocidas', description: 'Cuentas con la popularidad que fija el motor (p. ej. @RexNova) y los contactos del jugador con su personalidad y lo que hacen ahora. El modelo puede añadir cuentas nuevas.', keys: ['cuentas'], role: 'user' },
      player: { label: 'Jugador en la red', description: 'Su usuario y su popularidad (baja al empezar: crece con su reputación).', keys: ['jugador'], role: 'user' },
      feed: { label: 'Publicaciones recientes', description: 'Lo ya publicado, para no repetirse.', keys: ['recientes'], role: 'user' },
      thread: { label: 'Hilo y acción del jugador', description: 'Solo al reaccionar: el hilo con sus respuestas y lo que acaba de publicar o responder el jugador.', keys: ['publicacion', 'accionDelJugador', 'respuestasEsperadas'], role: 'user' },
      task, format
    },
    tasks: SOCIAL_TASKS
  }
};

export const kindNames = Object.keys(KINDS);

const MAIN_TEXT = {
  character: () => characterBehavior('{{char}}'),
  text: () => characterBehavior('{{char}}'),
  gm: () => GM_MAIN,
  social: () => SOCIAL_MAIN
};
// Reglas técnicas que hacen funcionar el juego (solo los prompts de diálogo las tienen).
const ENGINE_TEXT = {
  character: () => characterEngine('{{char}}'),
  text: () => characterEngine('{{char}}', { chat: true })
};
// Qué módulos automáticos van activos de fábrica y en qué orden (con el texto principal primero).
const DEFAULT_ORDER = {
  character: ['main', 'engine', 'format', 'card', 'world', 'persona', 'relationship', 'commitments', 'contact', 'emotions', 'intent', 'history', 'task'],
  text: ['main', 'engine', 'format', 'card', 'world', 'persona', 'relationship', 'commitments', 'history', 'task'],
  gm: ['main', 'task', 'format', 'player', 'world', 'events', 'present', 'character', 'relationship', 'pending', 'history'],
  social: ['main', 'task', 'format', 'world', 'accounts', 'player', 'feed', 'thread']
};
const GM_TASK_ROLE = 'system';

export function defaultPreset(kind) {
  const spec = KINDS[kind];
  const modules = DEFAULT_ORDER[kind].map((key) => {
    if (key === 'main') return { id: 'main', name: 'Prompt principal', type: 'text', role: 'system', enabled: true, content: MAIN_TEXT[kind]() };
    if (key === 'engine') return { id: 'engine', name: 'Reglas del motor', type: 'text', role: 'system', enabled: true, content: ENGINE_TEXT[kind]() };
    const auto = spec.autos[key];
    const role = key === 'format' ? 'system' : key === 'task' ? (kind === 'gm' || kind === 'social' ? GM_TASK_ROLE : 'user') : auto.role;
    return { id: key, name: auto.label, type: 'auto', auto: key, role, enabled: true };
  });
  return { version: 1, modules, tasks: structuredClone(spec.tasks), params: {} };
}

const clip = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const ROLES = new Set(['system', 'user', 'assistant']);
export const MAX_MODULE_CHARS = 60_000;

// Sanea un preset venido del disco o del editor. Siempre devuelve algo utilizable: lo que falte se completa con la fábrica.
export function normalizePreset(kind, input) {
  const spec = KINDS[kind];
  const defaults = defaultPreset(kind);
  const source = input && typeof input === 'object' ? input : {};
  const usedIds = new Set(); const usedAutos = new Set(); const modules = [];
  for (const raw of (Array.isArray(source.modules) ? source.modules : defaults.modules).slice(0, 80)) {
    if (!raw || typeof raw !== 'object') continue;
    const isAuto = raw.type === 'auto';
    if (isAuto && (!spec.autos[raw.auto] || usedAutos.has(raw.auto))) continue;
    if (isAuto) usedAutos.add(raw.auto);
    let id = typeof raw.id === 'string' && /^[\w-]{1,60}$/.test(raw.id) ? raw.id : randomUUID();
    while (usedIds.has(id)) id = randomUUID();
    usedIds.add(id);
    const modes = Array.isArray(raw.modes) ? spec.modes.map(({ id: mode }) => mode).filter((mode) => raw.modes.includes(mode)) : [];
    const base = { id, name: clip(raw.name, 60).trim() || (isAuto ? spec.autos[raw.auto].label : 'Módulo'), role: ROLES.has(raw.role) ? raw.role : 'system', enabled: raw.enabled !== false, ...(modes.length ? { modes } : {}) };
    modules.push(isAuto ? { ...base, type: 'auto', auto: raw.auto } : { ...base, type: 'text', content: clip(raw.content, MAX_MODULE_CHARS) });
  }
  // El formato de salida y la instrucción del turno son obligatorios: si faltan vuelven a su sitio de fábrica (al final);
  // si estaban desactivados se reactivan. Sin ellos el motor no sabría qué pedir ni cómo leer la respuesta.
  for (const key of ['task', 'format']) {
    const required = modules.find((item) => item.auto === key);
    if (!required) modules.push(structuredClone(defaults.modules.find((item) => item.auto === key)));
    else { required.enabled = true; delete required.modes; }
  }

  const tasks = {};
  for (const { id } of spec.modes) tasks[id] = typeof source.tasks?.[id] === 'string' ? clip(source.tasks[id], MAX_MODULE_CHARS) : defaults.tasks[id];
  const params = {};
  const temperature = Number(source.params?.temperature); const topP = Number(source.params?.top_p);
  if (source.params?.temperature !== '' && source.params?.temperature != null && Number.isFinite(temperature) && temperature >= 0 && temperature <= 2) params.temperature = temperature;
  if (source.params?.top_p !== '' && source.params?.top_p != null && Number.isFinite(topP) && topP > 0 && topP <= 1) params.top_p = topP;
  return { version: 1, modules, tasks, params };
}

export function expand(text, macros = {}) {
  const lower = Object.fromEntries(Object.entries(macros).map(([name, value]) => [name.toLowerCase(), value]));
  return String(text ?? '').replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (match, name) => (lower[name.toLowerCase()] != null ? String(lower[name.toLowerCase()]) : match));
}

const present = (value) => value !== undefined && value !== null && !(Array.isArray(value) && !value.length) && !(typeof value === 'string' && !value.trim());
function renderAuto(auto, data = {}) {
  const picked = {};
  for (const key of auto.keys) if (present(data[key])) picked[key] = data[key];
  return Object.keys(picked).length ? JSON.stringify(picked) : '';
}

// Convierte un preset + los datos de una llamada en la lista de mensajes que se envía al modelo.
// `plan` = { data, macros, format, instruction }. Los mensajes consecutivos con el mismo rol se unen.
export function compose(kind, mode, preset, plan = {}) {
  const spec = KINDS[kind];
  const macros = { mode, ...(plan.macros ?? {}) };
  const out = []; let sawFormat = false;
  for (const module of preset.modules) {
    let content = '';
    if (module.auto === 'format') {
      sawFormat = true;
      content = plan.format ?? '';
    } else {
      if (!module.enabled || (module.modes?.length && !module.modes.includes(mode))) continue;
      if (module.type !== 'auto') content = expand(module.content, macros);
      else if (module.auto === 'task') content = expand(plan.instruction || preset.tasks?.[mode] || '', macros);
      else content = renderAuto(spec.autos[module.auto], plan.data);
    }
    if (content.trim()) out.push({ role: module.role, content: content.trim() });
  }
  if (!sawFormat && plan.format) out.push({ role: 'system', content: plan.format });
  const merged = [];
  for (const message of out) {
    const last = merged.at(-1);
    if (last && last.role === message.role) last.content += `\n\n${message.content}`;
    else merged.push({ ...message });
  }
  if (!merged.some((message) => message.role === 'user')) merged.push({ role: 'user', content: 'Responde ahora según lo indicado.' });
  return merged;
}

// --- Importar un preset de SillyTavern ---------------------------------------------------------------------------------------
const ST_MARKERS = {
  charDescription: 'card', personaDescription: 'persona', scenario: 'world', worldInfoBefore: 'world', chatHistory: 'history'
};
const ST_IGNORED_MARKERS = new Set(['charPersonality', 'dialogueExamples', 'worldInfoAfter']); // ya van dentro de la ficha / del mundo
const stMacros = (text) => String(text ?? '').replace(/\{\{\s*user\s*\}\}/gi, '{{user}}').replace(/\{\{\s*char\s*\}\}/gi, '{{char}}');

// Devuelve { preset, report }. Los módulos de texto se conservan con su rol y estado; los marcadores de SillyTavern se
// convierten en sus equivalentes automáticos; y lo que el motor necesita y el preset no traía se añade antes de la conversación.
export function importSillyTavern(kind, json, current = null) {
  const spec = KINDS[kind];
  if (!json || !Array.isArray(json.prompts)) throw new Error('No parece un preset de SillyTavern (falta la lista «prompts»).');
  const byId = new Map(json.prompts.filter((item) => item && typeof item === 'object').map((item) => [item.identifier, item]));
  const orders = Array.isArray(json.prompt_order) ? json.prompt_order : [];
  const chosen = orders.at(-1)?.order ?? json.prompts.map((item) => ({ identifier: item.identifier, enabled: true }));
  const report = []; const used = new Set(); const modules = []; const dropped = [];
  for (const entry of chosen) {
    const item = byId.get(entry?.identifier);
    if (!item) continue;
    const auto = ST_MARKERS[item.identifier];
    if (item.marker || auto || ST_IGNORED_MARKERS.has(item.identifier)) {
      if (auto && spec.autos[auto] && !used.has(auto)) { used.add(auto); modules.push({ id: auto, name: spec.autos[auto].label, type: 'auto', auto, role: spec.autos[auto].role, enabled: entry.enabled !== false }); }
      else dropped.push(item.name || item.identifier);
      continue;
    }
    const content = stMacros(item.content);
    if (!content.trim()) { dropped.push(item.name || item.identifier); continue; }
    modules.push({ id: randomUUID(), name: clip(item.name || 'Módulo', 60), type: 'text', role: ROLES.has(item.role) ? item.role : 'system', enabled: entry.enabled !== false, content: clip(content, MAX_MODULE_CHARS) });
  }
  // Lo que el motor aporta y SillyTavern no tiene: se coloca justo antes de la conversación (o al final).
  const defaults = defaultPreset(kind);
  const missing = defaults.modules.filter((item) => item.auto && !['format', 'task'].includes(item.auto) && !used.has(item.auto) && item.enabled);
  let at = modules.findIndex((item) => item.auto === 'history'); if (at < 0) at = modules.length;
  // Las reglas del motor (qué sabe, acuerdos, contacto, formato y emociones) no se pierden al cambiar el prompt principal.
  const engine = defaults.modules.find((item) => item.id === 'engine');
  modules.splice(at, 0, ...(engine ? [{ ...engine }] : []), ...missing.map((item) => ({ ...item })));
  for (const key of ['format', 'task']) if (spec.autos[key]) modules.push(structuredClone(defaults.modules.find((item) => item.auto === key)));
  const imported = modules.filter((item) => item.type === 'text').length;
  report.push(`${imported} módulos de texto importados.`);
  if (engine) report.push('Se añadieron las «Reglas del motor» (qué sabe el personaje, acuerdos, contacto, formato de acciones y emociones): hacen funcionar el juego; edítalas con cuidado.');
  if (missing.length) report.push(`Se añadieron los datos del juego que el preset no traía: ${missing.map((item) => item.name).join(', ')}.`);
  if (dropped.length) report.push(`Omitidos (vacíos o ya cubiertos por la ficha del personaje): ${dropped.join(', ')}.`);
  report.push('Se añadieron al final «Formato de salida» e «Instrucción del turno». Revisa el orden y guarda.');
  const params = { ...(current?.params ?? {}) };
  if (Number.isFinite(json.temperature) && json.temperature >= 0 && json.temperature <= 2) { params.temperature = json.temperature; report.push(`Temperatura ${json.temperature} copiada del preset.`); }
  if (Number.isFinite(json.top_p) && json.top_p > 0 && json.top_p <= 1) params.top_p = json.top_p;
  return { preset: normalizePreset(kind, { modules, tasks: current?.tasks ?? defaults.tasks, params }), report };
}
