// Presets de prompt editados en el modo desarrollador. Se guardan en data/prompts/<kind>.json; si no hay archivo se usa el de fábrica.
// También guarda en memoria las últimas llamadas (mensajes enviados y respuesta) para ver exactamente qué recibió el modelo.
import { mkdirSync, readFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { kindNames, normalizePreset, defaultPreset } from './composer.js';

const LOG_SIZE = 24;

export function createPromptStore(directory = path.resolve('data/prompts')) {
  const cache = new Map();
  const log = [];
  const fileOf = (kind) => path.join(directory, `${kind}.json`);
  for (const kind of kindNames) {
    try { cache.set(kind, normalizePreset(kind, JSON.parse(readFileSync(fileOf(kind), 'utf8')))); } catch { /* sin personalizar */ }
  }
  return {
    get: (kind) => cache.get(kind) ?? defaultPreset(kind),
    isCustom: (kind) => cache.has(kind),
    async save(kind, input) {
      const preset = normalizePreset(kind, input);
      mkdirSync(directory, { recursive: true });
      await writeFile(`${fileOf(kind)}.tmp`, `${JSON.stringify(preset, null, 2)}\n`, 'utf8');
      await rename(`${fileOf(kind)}.tmp`, fileOf(kind));
      cache.set(kind, preset);
      return preset;
    },
    async reset(kind) { await rm(fileOf(kind), { force: true }); cache.delete(kind); },
    record(entry) { log.unshift(entry); log.length = Math.min(log.length, LOG_SIZE); },
    log: () => log
  };
}

// Almacén sin disco: solo los valores de fábrica (para el proveedor creado sin servidor, p. ej. en pruebas).
export const factoryPrompts = { get: (kind) => defaultPreset(kind), record() {} };
