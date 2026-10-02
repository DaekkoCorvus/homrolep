// Medición de la IA (modo desarrollador): estadísticas de llamadas por tipo y sonda de modelos (herramientas nativas, protocolo JSON,
// tiempos y tokens) para comparar modelos sin jugar.
import { notify, escapeHtml, dreq, layer } from './core.js';

const seconds = (ms) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const tokens = (value) => (value >= 10_000 ? `${(value / 1000).toFixed(0)}k` : String(value));

// Resumen de una llamada: «deepseek/… · 2,4 s · 1.8k entrada · 120 salida (80 razonando) · 2 intentos».
export function describeMeta(meta) {
  if (!meta) return '';
  const usage = meta.usage ?? {};
  const parts = [meta.model, meta.ms != null ? seconds(meta.ms) : null];
  if (usage.prompt != null) parts.push(`${tokens(usage.prompt)} entrada`);
  if (usage.completion != null) parts.push(`${tokens(usage.completion)} salida${usage.reasoning ? ` (${tokens(usage.reasoning)} razonando)` : ''}`);
  if (meta.attempts > 1) parts.push(`${meta.attempts} intentos`);
  if (meta.errorCode) parts.push(`error ${meta.errorCode}`);
  return parts.filter(Boolean).join(' · ');
}

export async function openStats() {
  let stats;
  try { ({ stats } = await dreq('/api/dev/prompts/log')); } catch (error) { notify(error.message); return; }
  const rows = stats.length ? `<div class="at-scroll"><table class="at-table"><thead><tr><th>Llamada</th><th>N</th><th>Media</th><th>Entrada</th><th>Salida</th><th>Err.</th></tr></thead><tbody>${stats.map((row) => `<tr><td>${escapeHtml(row.kind)}:${escapeHtml(row.mode)}</td><td>${row.calls}</td><td>${seconds(row.avgMs)}</td><td>${tokens(Math.round(row.promptTokens / row.calls))}</td><td>${tokens(Math.round(row.completionTokens / row.calls))}${row.reasoningTokens ? ` <small>(${tokens(Math.round(row.reasoningTokens / row.calls))}↯)</small>` : ''}</td><td>${row.errors || ''}</td></tr>`).join('')}</tbody></table></div><p class="dev-hint">Medias por llamada desde que arrancó el servidor. ↯ = tokens de razonamiento. Entrada y salida solo cuentan si el proveedor devuelve el uso.</p>` : '<p class="dev-hint">Aún no hay llamadas en esta sesión del servidor.</p>';
  const node = layer('dev-viewer', `<div class="dev-sheet pe-sheet" role="dialog" aria-label="Estadísticas de llamadas"><header><h2>Llamadas a la IA</h2><button type="button" data-close aria-label="Cerrar">×</button></header>${rows}<footer><button type="button" data-reset>Reiniciar contadores</button><button type="button" data-close>Cerrar</button></footer></div>`);
  node.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => node.remove(); });
  node.querySelector('[data-reset]').onclick = async () => { try { await dreq('/api/dev/prompts/log', { method: 'DELETE' }); node.remove(); notify('Contadores reiniciados.'); } catch (error) { notify(error.message); } };
}

// Qué protocolo recomienda el resultado de un modelo para el motor.
function verdict(tests) {
  const ok = (id) => tests.find((item) => item.id === id)?.ok === true;
  if (ok('tools') && ok('multi')) return ['good', 'Herramientas nativas'];
  if (ok('json')) return ['mid', 'Protocolo JSON de reserva'];
  return ['bad', 'Solo texto'];
}

export function openProbe(defaultModels = []) {
  const node = layer('dev-viewer', `<div class="dev-sheet pe-sheet" role="dialog" aria-label="Sonda de modelos"><header><h2>Sonda de modelos</h2><button type="button" data-close aria-label="Cerrar">×</button></header>
    <p class="dev-hint">Prueba, con cada modelo, texto plano, el protocolo JSON de reserva, herramientas nativas (también varias a la vez y la segunda vuelta con el resultado) y salida con esquema. Son unas 6 llamadas cortas por modelo; puede consumir una pizca de saldo.</p>
    <label class="dev-field"><span>Modelos (hasta 4, separados por espacio o coma; vacío = el guardado en Ajustes)</span><input data-models spellcheck="false" autocapitalize="none" autocomplete="off" placeholder="deepseek/deepseek-v4.1-flash meta/muse-spark-1.3-contributor"></label>
    <div class="dev-buttons"><button type="button" class="primary-dev" data-run>Ejecutar sonda</button></div>
    <p class="dev-hint" data-status></p><div data-results></div>
    <footer><span></span><button type="button" data-close>Cerrar</button></footer></div>`);
  const input = node.querySelector('[data-models]'); input.value = defaultModels.join(' ');
  const status = node.querySelector('[data-status]'); const results = node.querySelector('[data-results]'); const run = node.querySelector('[data-run]');
  node.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => node.remove(); });
  run.onclick = async () => {
    const models = input.value.split(/[\s,]+/).filter(Boolean);
    run.disabled = true; results.innerHTML = ''; status.textContent = `Probando${models.length > 1 ? ` ${models.length} modelos` : ''}… puede tardar un minuto.`;
    try {
      const data = await dreq('/api/dev/ai/probe', { method: 'POST', body: JSON.stringify({ models }) });
      status.textContent = '';
      results.innerHTML = data.results.map((row) => {
        const [tone, text] = verdict(row.tests);
        const total = row.tests.reduce((sum, item) => sum + item.ms, 0);
        return `<section class="at-model"><h3>${escapeHtml(row.model)}</h3><p class="at-verdict at-${tone}">Recomendado para el motor: <strong>${escapeHtml(text)}</strong> · ${seconds(total)} en total</p><ul class="at-tests">${row.tests.map((item) => `<li class="${item.ok ? 'ok' : 'fail'}"><span class="at-mark" aria-hidden="true">${item.ok ? '✔' : item.unsupported ? '∅' : '✘'}</span><span><strong>${escapeHtml(item.label)}</strong> <small>${seconds(item.ms)}${item.usage?.prompt != null ? ` · ${tokens(item.usage.prompt)}→${tokens(item.usage.completion ?? 0)} tokens` : ''}${item.calls > 1 ? ` · ${item.calls} llamadas` : ''}</small><br><small class="at-note">${escapeHtml(item.unsupported ? `No lo admite: ${item.note}` : item.note)}</small></span></li>`).join('')}</ul></section>`;
      }).join('');
    } catch (error) { status.textContent = error.message; }
    finally { run.disabled = false; }
  };
  return node;
}
