// Editor de prompts (modo desarrollador). Cada prompt (personaje, texto, GM, social) es una lista de módulos ordenables:
// de texto (editables, con macros) o automáticos (datos del juego que rellena el motor). Funciona sobre un borrador:
// nada cambia hasta pulsar «Guardar».
import { state, notify, escapeHtml, dreq, layer } from './core.js';

const ROLES = [['system', 'Sistema'], ['user', 'Usuario'], ['assistant', 'Asistente']];
const roleLabel = Object.fromEntries(ROLES);
const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// Un archivo propio importado puede venir incompleto: se deja utilizable antes de dibujarlo (el servidor lo vuelve a sanear al guardar).
function tidy(info, raw) {
  const known = new Set(info.autos.map(({ key }) => key));
  const used = new Set(); const ids = new Set();
  const modules = (Array.isArray(raw?.modules) ? raw.modules : []).filter((item) => item && typeof item === 'object').flatMap((item) => {
    const auto = item.type === 'auto';
    if (auto && (!known.has(item.auto) || used.has(item.auto))) return [];
    if (auto) used.add(item.auto);
    let id = typeof item.id === 'string' && /^[\w-]{1,60}$/.test(item.id) && !ids.has(item.id) ? item.id : newId();
    ids.add(id);
    const base = { id, name: String(item.name || (auto ? info.autos.find(({ key }) => key === item.auto).label : 'Módulo')).slice(0, 60), role: roleLabel[item.role] ? item.role : 'system', enabled: item.enabled !== false, ...(Array.isArray(item.modes) && item.modes.length ? { modes: item.modes } : {}) };
    return [auto ? { ...base, type: 'auto', auto: item.auto } : { ...base, type: 'text', content: String(item.content ?? '') }];
  });
  return { version: 1, modules, tasks: { ...info.defaults.tasks, ...(raw?.tasks && typeof raw.tasks === 'object' ? raw.tasks : {}) }, params: raw?.params && typeof raw.params === 'object' ? raw.params : {} };
}

function viewer(title, summary, messages, tail = '') {
  const node = layer('dev-viewer', `<div class="dev-sheet pe-sheet" role="dialog" aria-label="${escapeHtml(title)}">
    <header><h2>${escapeHtml(title)}</h2><button type="button" data-close aria-label="Cerrar">×</button></header>
    <p class="dev-hint">${summary}</p>
    ${messages.map((message) => `<article class="pv-msg"><header><span class="pv-role r-${escapeHtml(message.role)}">${escapeHtml(roleLabel[message.role] ?? message.role)}</span><small>${message.content.length} caracteres</small></header><pre></pre></article>`).join('')}
    ${tail}
    <footer><button type="button" data-copy>Copiar todo</button><button type="button" data-close>Cerrar</button></footer></div>`);
  node.querySelectorAll('.pv-msg pre').forEach((pre, index) => { pre.textContent = messages[index].content; });
  node.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => node.remove(); });
  node.querySelector('[data-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n')); notify('Copiado.'); } catch { notify('No se pudo copiar.'); }
  };
  return node;
}

export async function openPromptEditor(startKind = 'character') {
  let infos;
  try { infos = (await dreq('/api/dev/prompts')).kinds; } catch (error) { notify(error.message); return; }
  const info = Object.fromEntries(infos.map((item) => [item.kind, item]));
  const drafts = Object.fromEntries(infos.map((item) => [item.kind, structuredClone(item.preset)]));
  const saved = Object.fromEntries(infos.map((item) => [item.kind, JSON.stringify(item.preset)]));
  const previewMode = Object.fromEntries(infos.map((item) => [item.kind, item.modes[0].id]));
  const opened = new Set();
  let kind = info[startKind] ? startKind : 'character';
  let report = [];
  const dirty = (name = kind) => JSON.stringify(drafts[name]) !== saved[name];

  const node = layer('dev-prompts', `<div class="dev-sheet pe-sheet" role="dialog" aria-label="Editor de prompts">
    <header><h2>Prompts</h2><button type="button" data-close aria-label="Cerrar">×</button></header>
    <nav class="tabs" role="tablist"></nav><div class="pe-body"></div>
    <p class="error" data-error role="alert"></p>
    <footer class="pe-foot"><button type="button" data-export>Exportar</button><label class="file-button">Importar<input type="file" accept=".json,application/json" hidden data-import></label><button type="button" data-reset>Restablecer</button><button type="button" class="primary-dev" data-save>Guardar</button></footer></div>`);
  const sheet = node.querySelector('.dev-sheet'); const body = node.querySelector('.pe-body'); const tabs = node.querySelector('.tabs'); const error = node.querySelector('[data-error]');

  // Cerrar (× o tocar fuera) pregunta si hay cambios sin guardar.
  const guard = () => !infos.some((item) => dirty(item.kind)) || confirm('Hay cambios sin guardar en los prompts. ¿Cerrar sin guardarlos?');
  node.querySelectorAll('[data-close]').forEach((button) => { button.onclick = () => { if (guard()) node.remove(); }; });
  node.addEventListener('click', (event) => { if (event.target === node && !guard()) event.stopImmediatePropagation(); }, true);

  const modeLabel = (id) => info[kind].modes.find((mode) => mode.id === id)?.label ?? id;
  const autoOf = (module) => info[kind].autos.find(({ key }) => key === module.auto);

  function drawTabs() {
    tabs.innerHTML = infos.map((item) => `<button type="button" role="tab" data-kind="${item.kind}" class="${item.kind === kind ? 'active' : ''}" aria-selected="${item.kind === kind}">${escapeHtml(item.label)}${dirty(item.kind) ? " •" : ""}</button>`).join('');
  }

  function moduleRow(module, index, total) {
    const required = module.auto === 'format' || module.auto === 'task';
    const isOpen = opened.has(module.id);
    const scope = module.modes?.length ? ` · solo: ${module.modes.map(modeLabel).join(', ')}` : '';
    const meta = module.type === 'auto' ? `automático · ${roleLabel[module.role]}${scope}${module.auto === 'format' ? ' · obligatorio' : module.auto === 'task' ? ' · obligatorio' : ''}` : `texto · ${roleLabel[module.role]}${scope}`;
    const modesField = required ? '' : `<div class="dev-field"><span>Se envía en</span><div class="pm-modes">${info[kind].modes.map((mode) => `<label><input type="checkbox" data-mode="${mode.id}" ${module.modes?.includes(mode.id) ? 'checked' : ''}>${escapeHtml(mode.label)}</label>`).join('')}</div><small>Sin marcar = en todos los tipos de turno.</small></div>`;
    const content = module.type === 'auto'
      ? `<p class="dev-hint">${escapeHtml(autoOf(module)?.description ?? '')}</p>`
      : `<label class="dev-field"><span>Contenido</span><textarea data-content rows="10" spellcheck="false"></textarea><small>Macros: ${info[kind].macros.map(([name]) => `<code>{{${name}}}</code>`).join(' ')}</small></label>`;
    const actions = [
      module.type === 'text' ? '<button type="button" data-act="duplicate">Duplicar</button>' : '',
      info[kind].defaults.modules.some((item) => item.id === module.id && item.type === 'text') ? '<button type="button" data-act="restore">Restaurar texto de fábrica</button>' : '',
      required ? '' : '<button type="button" data-act="delete" class="danger">Quitar</button>'
    ].join('');
    return `<li class="pm${module.enabled ? '' : ' off'}${isOpen ? ' open' : ''}" data-id="${escapeHtml(module.id)}">
      <div class="pm-head">
        <label class="pm-switch" aria-label="Activar o desactivar"><input type="checkbox" data-enabled ${module.enabled ? 'checked' : ''} ${required ? 'disabled' : ''}><span></span></label>
        <button type="button" class="pm-title" data-act="open" aria-expanded="${isOpen}"><strong>${escapeHtml(module.name)}</strong><small>${meta}</small></button>
        <button type="button" data-move="-1" aria-label="Subir" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-move="1" aria-label="Bajar" ${index === total - 1 ? 'disabled' : ''}>↓</button>
      </div>
      ${isOpen ? `<div class="pm-body"><label class="dev-field"><span>Nombre</span><input data-name maxlength="60" autocomplete="off"></label>
        <label class="dev-field"><span>Se envía como mensaje de</span><select data-role>${ROLES.map(([value, label]) => `<option value="${value}" ${module.role === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        ${modesField}${content}<div class="dev-buttons">${actions}</div></div>` : ''}
    </li>`;
  }

  function draw() {
    const scroll = sheet.scrollTop;
    const spec = info[kind]; const draft = drafts[kind];
    const used = new Set(draft.modules.map((module) => module.auto).filter(Boolean));
    const free = spec.autos.filter((auto) => !used.has(auto.key));
    body.innerHTML = `<p class="dev-hint">${escapeHtml(spec.description)}</p>
      ${report.length ? `<div class="pe-report">${report.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>` : ''}
      <h3>Módulos · se envían en este orden</h3>
      <ol class="pm-list">${draft.modules.map((module, index) => moduleRow(module, index, draft.modules.length)).join('')}</ol>
      <div class="dev-buttons"><button type="button" data-add-text>+ Módulo de texto</button>
        <select data-add-auto aria-label="Añadir módulo automático"><option value="">+ Datos del juego…</option>${free.map((auto) => `<option value="${auto.key}">${escapeHtml(auto.label)}</option>`).join('')}</select></div>
      <p class="dev-hint">Los módulos automáticos los rellena el motor con datos reales de la partida (ficha, relación, conversación…). Los mensajes consecutivos con el mismo rol se unen al enviarlos.</p>
      <h3>Instrucciones por tipo de turno</h3>
      <p class="dev-hint">Es el texto del módulo «Instrucción del turno»; cambia según lo que se pide en cada llamada.</p>
      ${spec.modes.map((mode) => `<label class="dev-field"><span>${escapeHtml(mode.label)} <button type="button" class="pm-link" data-restore-task="${mode.id}">restaurar</button></span><textarea data-task="${mode.id}" rows="6" spellcheck="false"></textarea></label>`).join('')}
      <details class="pe-macros"><summary>Macros disponibles</summary><dl class="dev-commands">${spec.macros.map(([name, text]) => `<div><dt>{{${name}}}</dt><dd>${escapeHtml(text)}</dd></div>`).join('')}</dl></details>
      <h3>Parámetros del modelo</h3>
      <div class="pe-params"><label class="dev-field"><span>Temperatura</span><input data-param="temperature" type="number" min="0" max="2" step="0.05" inputmode="decimal" placeholder="modelo"></label>
        <label class="dev-field"><span>Top P</span><input data-param="top_p" type="number" min="0.01" max="1" step="0.01" inputmode="decimal" placeholder="modelo"></label></div>
      <p class="dev-hint">Déjalos vacíos para usar los valores del modelo. Algunos modelos con razonamiento los ignoran.</p>
      <h3>Ver lo que recibe el modelo</h3>
      <div class="dev-buttons"><select data-preview-mode aria-label="Tipo de turno">${spec.modes.map((mode) => `<option value="${mode.id}" ${previewMode[kind] === mode.id ? 'selected' : ''}>${escapeHtml(mode.label)}</option>`).join('')}</select>
        <button type="button" data-preview>Vista previa</button><button type="button" data-sent>Último enviado</button></div>
      <p class="dev-hint">La vista previa usa tu partida abierta y el borrador actual, sin llamar al modelo.</p>`;
    // Los valores se asignan como propiedades (sin pasar por el HTML) para no romper con comillas ni saltos de línea.
    body.querySelectorAll('.pm.open').forEach((row) => {
      const module = draft.modules.find((item) => item.id === row.dataset.id);
      row.querySelector('[data-name]').value = module.name;
      const area = row.querySelector('[data-content]'); if (area) area.value = module.content;
    });
    body.querySelectorAll('[data-task]').forEach((area) => { area.value = draft.tasks[area.dataset.task] ?? ''; });
    body.querySelectorAll('[data-param]').forEach((input) => { input.value = draft.params?.[input.dataset.param] ?? ''; });
    sheet.scrollTop = scroll;
    drawTabs();
    error.textContent = '';
  }

  const moduleOf = (target) => drafts[kind].modules.find((item) => item.id === target.closest('.pm')?.dataset.id);
  const touch = () => drawTabs();
  const insertSpot = () => { const at = drafts[kind].modules.findIndex((item) => item.auto === 'history'); return at < 0 ? drafts[kind].modules.length : at; };

  tabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-kind]');
    if (button && button.dataset.kind !== kind) { kind = button.dataset.kind; report = []; draw(); sheet.scrollTop = 0; }
  });

  body.addEventListener('input', (event) => {
    const { target } = event;
    if (target.matches('[data-name]')) { const module = moduleOf(target); module.name = target.value; target.closest('.pm').querySelector('.pm-title strong').textContent = module.name || 'Módulo'; }
    else if (target.matches('[data-content]')) moduleOf(target).content = target.value;
    else if (target.matches('[data-task]')) drafts[kind].tasks[target.dataset.task] = target.value;
    else if (target.matches('[data-param]')) {
      const value = target.value === '' ? undefined : Number(target.value);
      drafts[kind].params = { ...drafts[kind].params, [target.dataset.param]: value };
      if (value === undefined || !Number.isFinite(value)) delete drafts[kind].params[target.dataset.param];
    } else return;
    touch();
  });

  body.addEventListener('change', (event) => {
    const { target } = event;
    if (target.matches('[data-enabled]')) { const module = moduleOf(target); module.enabled = target.checked; target.closest('.pm').classList.toggle('off', !module.enabled); touch(); }
    else if (target.matches('[data-role]')) { const module = moduleOf(target); module.role = target.value; touch(); draw(); }
    else if (target.matches('[data-mode]')) {
      const module = moduleOf(target);
      const modes = [...target.closest('.pm-modes').querySelectorAll('[data-mode]:checked')].map((input) => input.dataset.mode);
      if (modes.length) module.modes = modes; else delete module.modes;
      touch(); draw();
    } else if (target.matches('[data-add-auto]') && target.value) {
      const auto = info[kind].autos.find(({ key }) => key === target.value);
      const module = { id: auto.key, name: auto.label, type: 'auto', auto: auto.key, role: auto.role ?? 'user', enabled: true };
      drafts[kind].modules.splice(insertSpot(), 0, module); opened.add(module.id); touch(); draw();
    } else if (target.matches('[data-preview-mode]')) previewMode[kind] = target.value;
  });

  body.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const draft = drafts[kind];
    if (button.dataset.move) {
      const module = moduleOf(button); const from = draft.modules.indexOf(module); const to = from + Number(button.dataset.move);
      if (to < 0 || to >= draft.modules.length) return;
      draft.modules.splice(to, 0, draft.modules.splice(from, 1)[0]);
      touch(); draw();
      body.querySelector(`.pm[data-id="${module.id}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (button.dataset.act === 'open') {
      const module = moduleOf(button); opened.has(module.id) ? opened.delete(module.id) : opened.add(module.id); draw();
    } else if (button.dataset.act === 'duplicate') {
      const module = moduleOf(button); const copy = { ...structuredClone(module), id: newId(), name: `${module.name} (copia)`.slice(0, 60) };
      draft.modules.splice(draft.modules.indexOf(module) + 1, 0, copy); opened.add(copy.id); touch(); draw();
    } else if (button.dataset.act === 'restore') {
      const module = moduleOf(button); const original = info[kind].defaults.modules.find((item) => item.id === module.id);
      if (original && confirm('¿Restaurar el texto de fábrica de este módulo? Se pierde tu edición no guardada.')) { module.content = original.content; touch(); draw(); }
    } else if (button.dataset.act === 'delete') {
      const module = moduleOf(button);
      if (module.type === 'text' && module.content.trim() && !confirm(`¿Quitar «${module.name}»?`)) return;
      draft.modules.splice(draft.modules.indexOf(module), 1); opened.delete(module.id); touch(); draw();
    } else if (button.dataset.restoreTask) {
      draft.tasks[button.dataset.restoreTask] = info[kind].defaults.tasks[button.dataset.restoreTask]; touch(); draw();
    } else if (button.matches('[data-add-text]')) {
      const module = { id: newId(), name: 'Módulo nuevo', type: 'text', role: 'system', enabled: true, content: '' };
      draft.modules.splice(insertSpot(), 0, module); opened.add(module.id); touch(); draw();
      body.querySelector(`.pm[data-id="${module.id}"] [data-content]`)?.focus();
    } else if (button.matches('[data-preview]')) {
      if (!state.run) { notify('Abre una partida para ver la vista previa.'); return; }
      try {
        const result = await dreq(`/api/dev/prompts/${kind}/preview`, { method: 'POST', body: JSON.stringify({ runId: state.run.id, mode: previewMode[kind], preset: draft }) });
        viewer(`${info[kind].label} · ${modeLabelOf(result.mode)}`, `${result.messages.length} mensajes · ${result.chars} caracteres · ~${result.approxTokens} tokens (estimado). Así quedaría con tu borrador.`, result.messages);
      } catch (failure) { notify(failure.message); }
    } else if (button.matches('[data-sent]')) {
      try {
        const { entries } = await dreq('/api/dev/prompts/log');
        const mine = entries.filter((entry) => entry.kind === kind);
        if (!mine.length) { notify('Aún no se ha enviado nada con este prompt en esta sesión del servidor.'); return; }
        const show = (entry) => {
          const tail = `<article class="pv-msg"><header><span class="pv-role r-answer">${entry.error ? 'Error' : 'Respuesta del modelo'}</span><small>${(entry.response ?? entry.error ?? '').length} caracteres</small></header><pre data-answer></pre></article>`;
          const node2 = viewer(`${info[kind].label} · ${modeLabelOf(entry.mode)}`, `Enviado el ${new Date(entry.at).toLocaleString('es')}. Es exactamente lo que recibió el modelo.${mine.length > 1 ? ' <button type="button" class="pm-link" data-older>ver el anterior</button>' : ''}`, entry.messages, tail);
          node2.querySelector('[data-answer]').textContent = entry.response ?? entry.error ?? '';
          node2.querySelector('[data-older]')?.addEventListener('click', () => { const next = mine[(mine.indexOf(entry) + 1) % mine.length]; node2.remove(); show(next); });
        };
        show(mine[0]);
      } catch (failure) { notify(failure.message); }
    }
  });
  const modeLabelOf = (id) => info[kind].modes.find((mode) => mode.id === id)?.label ?? id;

  node.querySelector('[data-save]').onclick = async () => {
    try {
      const result = await dreq(`/api/dev/prompts/${kind}`, { method: 'PUT', body: JSON.stringify(drafts[kind]) });
      info[kind] = result; drafts[kind] = structuredClone(result.preset); saved[kind] = JSON.stringify(result.preset); report = [];
      draw(); notify('Prompt guardado: se usa desde la próxima llamada.');
    } catch (failure) { error.textContent = failure.message; }
  };
  node.querySelector('[data-reset]').onclick = async () => {
    if (!confirm(`¿Restablecer el prompt «${info[kind].label}» a los valores de fábrica? Se pierden tus módulos guardados.`)) return;
    try {
      const result = await dreq(`/api/dev/prompts/${kind}`, { method: 'DELETE' });
      info[kind] = result; drafts[kind] = structuredClone(result.preset); saved[kind] = JSON.stringify(result.preset); report = []; opened.clear();
      draw(); notify('Prompt restablecido.');
    } catch (failure) { error.textContent = failure.message; }
  };
  node.querySelector('[data-export]').onclick = () => {
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(drafts[kind], null, 2)}\n`], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `prompt-${kind}.json` });
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    notify(`Exportado prompt-${kind}.json`);
  };
  node.querySelector('[data-import]').onchange = async (event) => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text(); let json;
      try { json = JSON.parse(text); } catch { throw new Error('El archivo no es un JSON válido.'); }
      if (Array.isArray(json?.prompts)) {
        if (!confirm(`Se reemplazarán los módulos del borrador «${info[kind].label}» por los del preset de SillyTavern (aún sin guardar). ¿Continuar?`)) return;
        const result = await dreq(`/api/dev/prompts/${kind}/import`, { method: 'POST', body: JSON.stringify({ text }) });
        drafts[kind] = result.preset; report = result.report; opened.clear();
      } else if (Array.isArray(json?.modules)) {
        drafts[kind] = tidy(info[kind], json); report = ['Preset importado como borrador. Revísalo y pulsa Guardar.']; opened.clear();
      } else throw new Error('No reconozco el archivo: debe ser un preset de SillyTavern o uno exportado desde aquí.');
      draw();
    } catch (failure) { error.textContent = failure.message; notify(failure.message); }
  };

  draw();
}
