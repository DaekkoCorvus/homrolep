import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { AIError } from './provider.js';

// Modelos sugeridos en Ajustes; el jugador puede escribir cualquier otro identificador de NanoGPT.
export const GM_MODELS = Object.freeze({
  spark:'meta/muse-spark-1.3-contributor',
  deepseek:'deepseek/deepseek-v4.1-flash'
});
// Cómo habla cada modelo con las herramientas del motor: 'native' (tools de chat/completions), 'json' (codec de reserva) o 'auto'
// (probar nativo y recordar si lo rechaza). Lo medido con la sonda manda sobre lo que anuncie el catálogo del proveedor.
export const TOOL_MODES = Object.freeze(['auto', 'native', 'json']);
export const DEFAULT_TOOL_MODES = Object.freeze({
  'meta/muse-spark-1.3-contributor': 'json', // el proveedor anuncia tools, pero en la práctica solo responde bien al protocolo JSON
  'deepseek/deepseek-v4.1-flash': 'native'
});
const MODEL_ID = /^[\w.:@+/-]{1,200}$/;
export const isModelId = (value) => typeof value === 'string' && MODEL_ID.test(value) && !value.includes('..');

export function createSettingsStore(directory = path.resolve('.local')) {
  const target = path.join(directory, 'ai.json');
  async function read() {
    try { return JSON.parse(await readFile(target, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new AIError('No se pudieron leer los ajustes locales de IA.', 'AI_SETTINGS', 500);
    }
  }
  function publicStatus(config) {
    const hasKey=Boolean(config?.apiKey);
    // Basta con tener key y modelo: la comprobación de conexión es opcional (`verifiedAt` solo indica que se probó alguna vez).
    const configured=Boolean(hasKey && isModelId(config?.model));
    return { provider:'nanogpt', configured, hasKey, model:config?.model || '', verifiedAt:configured?config.verifiedAt ?? null:null };
  }
  const modeOf = (config, model) => (TOOL_MODES.includes(config?.toolModes?.[model]) ? config.toolModes[model] : DEFAULT_TOOL_MODES[model] ?? 'auto');
  return {
    async toolMode(model) { const config = await read(); return { model, mode: modeOf(config, model), custom: TOOL_MODES.includes(config?.toolModes?.[model]), default: DEFAULT_TOOL_MODES[model] ?? 'auto' }; },
    // 'auto' quita el ajuste propio y vuelve al valor por defecto del modelo. No guarda nada si aún no hay conexión configurada.
    async setToolMode(model, mode) {
      if (!isModelId(model)) throw new AIError('Modelo no válido.', 'AI_MODEL', 400);
      if (!TOOL_MODES.includes(mode)) throw new AIError('Protocolo no válido: usa auto, native o json.', 'INVALID_REQUEST', 400);
      const config = await read();
      if (!config) throw new AIError('Antes conecta NanoGPT desde Ajustes.', 'AI_CONFIGURATION_REQUIRED', 428);
      const toolModes = { ...config.toolModes };
      if (mode === 'auto') delete toolModes[model]; else toolModes[model] = mode;
      await mkdir(directory, { recursive:true, mode:0o700 });
      await writeFile(`${target}.tmp`, JSON.stringify({ ...config, toolModes }), { encoding:'utf8', mode:0o600 });
      await rename(`${target}.tmp`, target);
      return this.toolMode(model);
    },
    async status() { return publicStatus(await read()); },
    async candidate(input = {}) {
      const previous = await read();
      const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : previous?.apiKey;
      const model = typeof input.model === 'string' ? input.model.trim() : previous?.model;
      if (!apiKey || apiKey.length > 4096 || /\s/.test(apiKey)) throw new AIError('Introduce una API key válida de NanoGPT.', 'AI_CONFIGURATION_REQUIRED', 428);
      if (!isModelId(model)) throw new AIError('Escribe el identificador del modelo (p. ej. deepseek/deepseek-v4.1-flash).', 'AI_MODEL', 400);
      return { apiKey, model };
    },
    async key(input = {}) {
      const key = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : (await read())?.apiKey;
      if (!key || key.length > 4096 || /\s/.test(key)) throw new AIError('Introduce tu API key para cargar los modelos.', 'AI_CONFIGURATION_REQUIRED', 428);
      return key;
    },
    async require() {
      const config = await read();
      if (!publicStatus(config).configured) throw new AIError('Antes de jugar, conecta NanoGPT desde Ajustes.', 'AI_CONFIGURATION_REQUIRED', 428);
      return { ...config, toolMode: modeOf(config, config.model) };
    },
    async save(config, { verified = false } = {}) {
      const previous = await read();
      const saved = { apiKey:config.apiKey, model:config.model, verifiedAt:verified ? new Date().toISOString() : null, ...(previous?.toolModes ? { toolModes:previous.toolModes } : {}) };
      await mkdir(directory, { recursive:true, mode:0o700 });
      await writeFile(`${target}.tmp`, JSON.stringify(saved), { encoding:'utf8', mode:0o600 });
      await rename(`${target}.tmp`, target);
      return publicStatus(saved);
    },
    async clear() { await rm(target, { force:true }); return publicStatus(null); }
  };
}
