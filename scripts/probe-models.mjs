#!/usr/bin/env node
// Sonda de modelos desde la consola: usa la API key guardada en .local/ai.json (Ajustes del juego) o NANOGPT_API_KEY.
//   node scripts/probe-models.mjs                       → el modelo guardado en Ajustes
//   node scripts/probe-models.mjs modelo1 modelo2 …     → compara varios (hasta 4)
//   node scripts/probe-models.mjs --json …              → salida JSON (para guardar o comparar)
//   node scripts/probe-models.mjs --tests tools,multi … → solo algunas pruebas (plain, json, tools, multi, schema)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createNanoGPT } from '../src/server/ai/provider.js';
import { runProbe } from '../src/server/ai/probe.js';
import { isModelId } from '../src/server/ai/settings.js';

const args = process.argv.slice(2);
const flag = (name) => { const at = args.indexOf(name); if (at < 0) return null; const [, value] = args.splice(at, 2); return value ?? ''; };
const asJson = args.includes('--json'); if (asJson) args.splice(args.indexOf('--json'), 1);
const tests = flag('--tests')?.split(',').filter(Boolean);
const models = args.filter((item) => !item.startsWith('--'));
const bad = models.find((item) => !isModelId(item));
if (bad) { console.error(`Identificador de modelo no válido: ${bad}`); process.exit(2); }

let saved = null;
try { saved = JSON.parse(await readFile(path.resolve('.local/ai.json'), 'utf8')); } catch { /* sin ajustes guardados */ }
const apiKey = process.env.NANOGPT_API_KEY || saved?.apiKey;
if (!apiKey) { console.error('No hay API key: guárdala en Ajustes del juego o define NANOGPT_API_KEY.'); process.exit(2); }

const ai = createNanoGPT();
const config = { apiKey, model: saved?.model || 'deepseek/deepseek-v4.1-flash' };
try {
  const report = await runProbe(ai, config, { models, ...(tests ? { tests } : {}) });
  if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
  for (const row of report.results) {
    console.log(`\n${row.model}`);
    for (const item of row.tests) {
      const mark = item.ok ? 'OK ' : item.unsupported ? 'N/A' : 'NO ';
      const usage = item.usage?.prompt != null ? ` ${item.usage.prompt}→${item.usage.completion ?? 0} tok` : '';
      console.log(`  ${mark} ${item.label.padEnd(30)} ${(item.ms / 1000).toFixed(1).padStart(5)} s${usage}  ${item.note}`);
    }
  }
} catch (error) {
  console.error(`Sonda interrumpida: ${error.message}`);
  process.exit(1);
}
