// Presets de prompt editados en el modo desarrollador. Se guardan en data/prompts/<kind>.json; si no hay archivo se usa el de fábrica.
// También guarda en memoria las últimas llamadas (mensajes enviados y respuesta) para ver exactamente qué recibió el modelo.
import { mkdirSync, readFileSync } from 'node:fs';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { kindNames, normalizePreset, defaultPreset } from './composer.js';

const LOG_SIZE = 24;

// Acumulado por tipo de llamada (prompt:modo) desde que arrancó el servidor: llamadas, errores, tiempo y tokens. Sirve para comparar
// modelos y ver qué llamadas cuestan más antes de optimizar. Se reinicia al reiniciar el servidor o con `resetStats`.
function createStats() {
  const rows = new Map();
  return {
    add(entry) {
      const key = `${entry.kind}:${entry.mode}`;
      const row = rows.get(key) ?? { kind: entry.kind, mode: entry.mode, calls: 0, errors: 0, ms: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, byModel: {} };
      const meta = entry.meta ?? {};
      const usage = meta.usage ?? {};
      row.calls += 1; row.errors += entry.error ? 1 : 0; row.ms += meta.ms ?? 0;
      row.promptTokens += usage.prompt ?? 0; row.completionTokens += usage.completion ?? 0; row.reasoningTokens += usage.reasoning ?? 0;
      if (meta.model) { const model = row.byModel[meta.model] ?? { calls: 0, ms: 0 }; model.calls += 1; model.ms += meta.ms ?? 0; row.byModel[meta.model] = model; }
      rows.set(key, row);
    },
    list: () => [...rows.values()].map((row) => ({ ...row, avgMs: row.calls ? Math.round(row.ms / row.calls) : 0 })),
    reset: () => rows.clear()
  };
}

export function createPromptStore(directory = path.resolve('data/prompts')) {
  const cache = new Map();
  const log = [];
  const stats = createStats();
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
    record(entry) { log.unshift(entry); log.length = Math.min(log.length, LOG_SIZE); stats.add(entry); },
    log: () => log,
    stats: () => stats.list(),
    resetStats: () => stats.reset()
  };
}

// Almacén sin disco: solo los valores de fábrica (para el proveedor creado sin servidor, p. ej. en pruebas).
export const factoryPrompts = { get: (kind) => defaultPreset(kind), record() {} };
