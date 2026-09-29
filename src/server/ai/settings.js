import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { AIError } from './provider.js';

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
    return { provider:'nanogpt', configured:Boolean(config?.apiKey && config?.model && config?.verifiedAt), model:config?.model || '', verifiedAt:config?.verifiedAt || null };
  }
  return {
    async status() { return publicStatus(await read()); },
    async candidate(input = {}) {
      const previous = await read();
      const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : previous?.apiKey;
      const model = typeof input.model === 'string' ? input.model.trim() : previous?.model;
      if (!apiKey || apiKey.length > 4096 || /\s/.test(apiKey)) throw new AIError('Introduce una API key válida de NanoGPT.', 'AI_CONFIGURATION_REQUIRED', 428);
      if (!model || model.length > 200 || /\s/.test(model)) throw new AIError('Selecciona o escribe el ID del modelo.', 'AI_MODEL', 400);
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
      return config;
    },
    async save(config) {
      const saved = { apiKey:config.apiKey, model:config.model, verifiedAt:new Date().toISOString() };
      await mkdir(directory, { recursive:true, mode:0o700 });
      await writeFile(`${target}.tmp`, JSON.stringify(saved), { encoding:'utf8', mode:0o600 });
      await rename(`${target}.tmp`, target);
      return publicStatus(saved);
    },
    async clear() { await rm(target, { force:true }); return publicStatus(null); }
  };
}
