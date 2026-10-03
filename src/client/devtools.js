// Herramientas de desarrollo: comandos de chat, panel de partida y editor de fichas de NPC (importar/exportar).
import { state, request, notify, escapeHtml, isDev, setDev, place, dreq, layer } from './core.js';
import { setTextSpeed } from './game.js';
import { openPromptEditor } from './prompteditor.js';
import { openProbe, openStats, openIntents } from './aitrace.js';

const COMMANDS = [
  ['/dev', 'Activa o desactiva las herramientas de desarrollo'],
  ['/ayuda', 'Muestra esta lista'],
  ['/reiniciar', 'Rebobina la conversación actual (o la última) y la empieza de nuevo'],
  ['/regenerar', 'Regenera la última respuesta: la del NPC, el cierre de la conversación o la narración'],
  ['/hora HH:MM [día]', 'Cambia la hora del mundo'],
  ['/ir lugar', 'Te lleva a un lugar sin gastar tiempo (id o nombre)'],
  ['/npc [id]', 'Abre el editor de la ficha de un NPC'],
  ['/fichas', 'Abre el panel con el listado, importar y exportar'],
  ['/feed', 'Genera ahora publicaciones nuevas en NorthLife (prompt social)'],
  ['/limpiarfeed', 'Borra todas las publicaciones y cuentas generadas del feed (conserva tu cuenta) para empezar de cero'],
  ['/prompts [personaje|texto|gm|social]', 'Abre el editor de prompts (módulos, orden, vista previa)'],
  ['/sonda [modelo …]', 'Prueba herramientas nativas, protocolo JSON y tiempos de uno o varios modelos'],
  ['/herramientas [auto|nativo|json]', 'Protocolo con el que el modelo guardado usa las herramientas del motor (sin argumento, muestra el actual)'],
  ['/stats', 'Tiempos y tokens medios de las llamadas a la IA, por tipo'],
  ['/intenciones', 'Lista lo que el GM intentó hacer y el juego aún no resuelve (qué mecánicas construir)'],
  ['/contacto id', 'Desbloquea el contacto de un NPC (como si lo hubiera compartido)'],
  ['/texto lento|normal|rapido', 'Velocidad con la que se escribe la respuesta del NPC'],
  ['/fx lite|full|auto', 'Calidad de efectos de la escena (lite congela las animaciones)']
];
const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const PORTRAIT_MAX_HEIGHT = 1200;
const norm = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const lines = (value) => (Array.isArray(value) ? value.join('\n') : '');

let hooks = { perform() {}, runDev() {}, reload() {}, setFx() {} }; // lo sustituye initDevtools al entrar en el juego
export const initDevtools = (value) => { hooks = value; };

// Importar una ficha de NPC (JSON propio o «character card» JSON/PNG) desde cualquier pantalla.
export function pickAndImportCard() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,.png,application/json,image/png' });
  input.onchange = () => importFile(input.files[0]);
  input.click();
}

// Devuelve true si el texto era un comando (aunque falle), para que no se envíe como acción del jugador.
export async function runCommand(text) {
  if (!text.startsWith('/')) return false;
  const [name, ...rest] = text.trim().split(/\s+/);
  const argument = rest.join(' ');
  const command = norm(name);
  if (command === '/dev') { setDev(!isDev()); notify(isDev() ? 'Herramientas de desarrollo activadas.' : 'Herramientas de desarrollo desactivadas.'); hooks.reload(); if (isDev()) openPanel(); return true; }
  if (command === '/texto') {
    const mode = ['lento', 'normal', 'rapido', 'rápido'].includes(argument.toLowerCase()) ? norm(argument) : null;
    if (!mode) notify('Uso: /texto lento · normal · rapido'); else { setTextSpeed(mode); notify(`Texto: ${mode}`); }
    return true;
  }
  if (command === '/fx') {
    const mode = ['lite', 'full', 'auto'].includes(norm(argument)) ? norm(argument) : null;
    if (!mode) notify('Uso: /fx lite (escena estática, más rápido) · full · auto'); else { hooks.setFx(mode); notify(`Efectos: ${mode}`); }
    return true;
  }
  if (!isDev()) { notify('Escribe /dev para activar las herramientas de desarrollo.'); return true; }
  if (command === '/ayuda' || command === '/help') openPanel();
  else if (command === '/reiniciar' || command === '/restart') hooks.perform(() => hooks.runDev({ op: 'restart' }), { animate: true });
  else if (command === '/regenerar' || command === '/regen') hooks.perform(() => hooks.runDev({ op: 'regen' }), { animate: true });
  else if (command === '/hora') {
    const match = argument.match(/^(\d{1,2})(?::(\d{2}))?(?:\s+(\d+))?$/);
    if (!match) notify('Uso: /hora 14:30 [día]');
    else hooks.perform(() => hooks.runDev({ op: 'set_time', hour: Number(match[1]), minute: Number(match[2] ?? 0), ...(match[3] ? { day: Number(match[3]) } : {}) }));
  } else if (command === '/ir') {
    const target = state.world.locations.find((loc) => norm(loc.id) === norm(argument) || norm(loc.name).startsWith(norm(argument)));
    if (!argument || !target) notify(`Lugares: ${state.world.locations.map((loc) => loc.id).join(', ')}`);
    else hooks.perform(() => hooks.runDev({ op: 'teleport', locationId: target.id }));
  } else if (command === '/contacto') {
    const cards = await dreq('/api/dev/npcs');
    const card = cards.find((item) => item.id === norm(argument) || norm(item.name).startsWith(norm(argument)));
    if (!argument || !card) notify(`Uso: /contacto id (${cards.map((item) => item.id).join(', ')})`);
    else hooks.perform(() => hooks.runDev({ op: 'unlock_contact', npcId: card.id }));
  } else if (command === '/npc') {
    if (argument) { const cards = await dreq('/api/dev/npcs'); const card = cards.find((item) => item.id === norm(argument) || norm(item.name).startsWith(norm(argument))); if (card) openEditor(card); else notify('No encontré ese NPC.'); }
    else openPanel();
  } else if (command === '/fichas') openPanel();
  else if (command === '/limpiarfeed' || command === '/wipefeed') await wipeFeed();
  else if (command === '/feed') { try { await hooks.runDev({ op: 'social' }); await hooks.reload(); notify('Feed generado.'); } catch (error) { notify(error.message); } }
  else if (command === '/sonda' || command === '/probe') openProbe(argument.split(/[\s,]+/).filter(Boolean));
  else if (command === '/herramientas' || command === '/tools') await toolMode(argument);
  else if (command === '/stats') openStats();
  else if (command === '/intenciones' || command === '/intents') openIntents();
  else if (command === '/prompts' || command === '/prompt') {
    const kinds = { personaje: 'character', character: 'character', texto: 'text', text: 'text', gm: 'gm', social: 'social' };
    openPromptEditor(kinds[norm(argument)] ?? 'character');
  }
  else notify('Comando desconocido. Escribe /ayuda.');
  return true;
}

export async function openPanel() {
  let cards = [];
  try { cards = await dreq('/api/dev/npcs'); } catch (error) { notify(error.message); return; }
  const node = layer('dev-panel', `<div class="dev-sheet" role="dialog" aria-label="Herramientas de desarrollo">
    <header><h2>Desarrollo</h2><button type="button" data-close aria-label="Cerrar">×</button></header>
    <section><h3>Partida</h3><div class="dev-buttons">
      <button type="button" data-act="restart">Reiniciar cita</button><button type="button" data-act="regen">Regenerar respuesta</button>
      <button type="button" data-act="hour">+1 hora</button><button type="button" data-act="social">Generar feed ahora</button><button type="button" data-act="social-wipe" class="danger">Limpiar feed</button></div></section>
    <section><h3>Prompts</h3><div class="dev-buttons"><button type="button" data-prompts="character">Personaje</button><button type="button" data-prompts="text">Texto</button><button type="button" data-prompts="gm">GM</button><button type="button" data-prompts="social">Social</button></div>
      <p class="dev-hint">Edita los módulos que se envían al modelo, su orden y su vista previa.</p></section>
    <section><h3>Modelos y medición</h3><div class="dev-buttons"><button type="button" data-probe>Sonda de modelos</button><button type="button" data-stats>Estadísticas de llamadas</button><button type="button" data-intents>Intenciones sin mecánica</button></div>
      <p class="dev-hint">Compara modelos (herramientas nativas, JSON, tiempos) y mira cuántos tokens y segundos cuesta cada tipo de llamada. El modelo se cambia en Ajustes sin necesidad de comprobarlo.</p></section>
    <section><h3>Fichas de NPC</h3><div class="dev-list">${cards.map((card) => `<div class="dev-row"><span><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.id)} · ${escapeHtml(card.role || 'sin rol')}</small></span><button type="button" data-edit="${escapeHtml(card.id)}">Editar</button><button type="button" data-export="${escapeHtml(card.id)}">Exportar</button></div>`).join('')}</div>
      <div class="dev-buttons"><button type="button" data-new>Nuevo NPC</button><label class="file-button">Importar ficha<input type="file" accept=".json,.png,application/json,image/png" hidden data-import></label></div>
      <p class="dev-hint">Importa JSON propio, fichas «character card» v1/v2/v3 (JSON o PNG). También puedes dejar archivos en <code>data/canon/npcs/</code> y <code>assets/portraits/&lt;id&gt;/default.png</code> y reiniciar el servidor.</p></section>
    <section><h3>Comandos de chat</h3><dl class="dev-commands">${COMMANDS.map(([c, d]) => `<div><dt>${escapeHtml(c)}</dt><dd>${escapeHtml(d)}</dd></div>`).join('')}</dl></section></div>`);
  node.querySelector('[data-act=restart]').onclick = () => { node.remove(); hooks.perform(() => hooks.runDev({ op: 'restart' }), { animate: true }); };
  node.querySelector('[data-act=regen]').onclick = () => { node.remove(); hooks.perform(() => hooks.runDev({ op: 'regen' }), { animate: true }); };
  node.querySelector('[data-act=social]').onclick = async () => { node.remove(); notify('Generando publicaciones…'); try { await hooks.runDev({ op: 'social' }); await hooks.reload(); notify('Feed generado.'); } catch (error) { notify(error.message); } };
  node.querySelector('[data-act=social-wipe]').onclick = () => { node.remove(); wipeFeed(); };
  node.querySelector('[data-act=hour]').onclick = () => { const w = state.run.world; node.remove(); hooks.perform(() => hooks.runDev({ op: 'set_time', hour: (w.hour + 1) % 24, minute: w.minute, day: w.day + (w.hour === 23 ? 1 : 0) })); };
  node.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => openEditor(cards.find((card) => card.id === button.dataset.edit)));
  node.querySelectorAll('[data-export]').forEach((button) => button.onclick = () => exportCard(cards.find((card) => card.id === button.dataset.export)));
  node.querySelector('[data-new]').onclick = () => openEditor(null);
  node.querySelector('[data-probe]').onclick = () => openProbe();
  node.querySelector('[data-stats]').onclick = () => openStats();
  node.querySelector('[data-intents]').onclick = () => openIntents();
  node.querySelectorAll('[data-prompts]').forEach((button) => button.onclick = () => openPromptEditor(button.dataset.prompts));
  node.querySelector('[data-import]').onchange = (event) => importFile(event.target.files[0]);
}

const MODE_LABELS = { auto: 'automático (prueba nativo y recuerda)', native: 'herramientas nativas', json: 'protocolo JSON de reserva' };
async function toolMode(argument) {
  const wanted = { nativo: 'native', native: 'native', json: 'json', auto: 'auto', automatico: 'auto' }[norm(argument)];
  try {
    const info = await dreq('/api/dev/ai/toolmode', wanted ? { method: 'POST', body: JSON.stringify({ mode: wanted }) } : {});
    notify(`${info.model}: ${MODE_LABELS[info.mode]}${info.custom ? ' (ajustado por ti)' : info.default !== 'auto' ? ' (por defecto de este modelo)' : ''}. Usa /herramientas auto|nativo|json para cambiarlo.`);
  } catch (error) { notify(error.message); }
}

// Restablece el feed de NorthLife: publicaciones, cuentas generadas y notificaciones. Conserva tu cuenta y el resto de la partida.
async function wipeFeed() {
  if (!confirm('¿Limpiar el feed de NorthLife? Se borran todas las publicaciones, las cuentas generadas (con sus avatares) y las notificaciones. Tu cuenta, tus contactos y el resto de la partida no cambian.')) return;
  try { await hooks.runDev({ op: 'social_wipe' }); await hooks.reload(); notify('Feed limpiado. La próxima acción (o /feed) lo genera de nuevo.'); }
  catch (error) { notify(error.message); }
}

function exportCard(card) {
  const { portraits, ...clean } = card;
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(clean, null, 2)}\n`], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `${card.id}.json` });
  document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  notify(`Exportada ${card.id}.json`);
}

const kb = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

// Reduce a la altura útil y recodifica a WebP con transparencia, en el navegador (sin dependencias).
// Si el resultado no pesa menos, o el navegador no sabe codificar WebP, se conserva el archivo original.
async function optimizeImage(file, quality) {
  if (quality === 'original') return { blob: file, note: 'sin cambios' };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PORTRAIT_MAX_HEIGHT / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality === 'max' ? 1 : 0.92));
  if (!blob || blob.type !== 'image/webp' || (blob.size >= file.size && scale === 1)) return { blob: file, note: 'se conservó el original (ya era ligero)' };
  return { blob, note: `${kb(file.size)} → ${kb(blob.size)} · ${canvas.width}×${canvas.height}` };
}

const toBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
  reader.readAsDataURL(file);
});

async function importFile(file, overwrite = false) {
  if (!file) return;
  try {
    const isPng = /\.png$/i.test(file.name) || file.type === 'image/png';
    const body = isPng ? { kind: 'png', data: await toBase64(file) } : { kind: 'json', text: await file.text() };
    const card = await dreq('/api/dev/npcs/import', { method: 'POST', body: JSON.stringify({ ...body, overwrite }) });
    notify(`Importada: ${card.name}`);
    hooks.reload();
    openEditor(card);
  } catch (error) {
    if (error.code === 'NPC_EXISTS' && confirm(`${error.message}`)) return importFile(file, true);
    notify(error.message);
  }
}

const RACE_OPTIONS = [['humano', 'Humano'], ['ophidiano', 'Ophidiano'], ['infernal', 'Infernal'], ['celestial', 'Celestial'], ['noid', 'Noid (robot consciente)']];
const GENDER_OPTIONS = ['Mujer', 'Hombre', 'No binario', 'Sin género', 'Otro'];
const TABS = [['identity', 'Identidad'], ['personality', 'Personalidad'], ['appearance', 'Apariencia'], ['emotions', 'Emociones'], ['story', 'Historia'], ['schedule', 'Horario y conexiones']];

// Nombre de emoción: solo letras, sin acentos, espacios ni símbolos (es el que usa el GM entre llaves: {feliz}).
const normalizeEmotion = (name) => String(name ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '').slice(0, 20);

const getPath = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const setPath = (object, path, value) => {
  const keys = path.split('.'); const last = keys.pop();
  keys.reduce((target, key) => (target[key] ??= {}), object)[last] = value;
};

const blankCard = () => ({
  id: '', name: '', age: null, role: '', gender: 'Mujer', race: 'humano', tier: 'civil', summary: '',
  appearance: '', clothingLikes: [], clothingDislikes: [],
  personality: { traits: [], speech: '', likes: [], dislikes: [], boundaries: '', warmsUpWhen: '', coolsDownWhen: '', loveLanguage: '' },
  exampleDialogue: '', background: '', knowledge: [], secrets: [],
  schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 8, to: 20, locationId: state.world.locations[0].id, activity: '' }],
  connections: [], contact: { handle: '', conditions: [] }, portraits: {}
});

// Campos enlazados al modelo por ruta (data-bind): se rellenan como propiedades para evitar problemas de escape.
function field(label, path, { kind = 'text', rows = 4, hint = '', readonly = false, placeholder = '', options = null } = {}) {
  let control;
  if (kind === 'area') control = `<textarea data-bind="${path}" rows="${rows}" placeholder="${escapeHtml(placeholder)}"></textarea>`;
  else if (kind === 'select') control = `<select data-bind="${path}">${options.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join('')}</select>`;
  else control = `<input data-bind="${path}" type="${kind === 'number' ? 'number' : 'text'}" ${kind === 'number' ? 'min="0" inputmode="numeric"' : ''} ${readonly ? 'readonly' : ''} placeholder="${escapeHtml(placeholder)}" autocomplete="off">`;
  return `<label class="dev-field"><span>${label}</span>${control}${hint ? `<small>${hint}</small>` : ''}</label>`;
}

const tagsField = (label, path, { block = false, hint = '', placeholder = 'Escribe y pulsa Enter' } = {}) =>
  `<div class="dev-field"><span>${label}</span><div class="tag-field" data-tags="${path}" data-block="${block ? 1 : 0}" data-placeholder="${escapeHtml(placeholder)}"></div>${hint ? `<small>${hint}</small>` : ''}</div>`;

// Etiquetas: Enter (o salir del campo) crea la etiqueta; al tocar una aparecen editar y eliminar.
function mountTags(root, model) {
  const path = root.dataset.tags; const block = root.dataset.block === '1';
  root.innerHTML = `<div class="tag-list"></div><input class="tag-input" placeholder="${root.dataset.placeholder}" enterkeyhint="done" autocomplete="off" autocapitalize="sentences">`;
  const listEl = root.querySelector('.tag-list'); const input = root.querySelector('.tag-input');
  let open = -1; let editing = -1;
  const items = () => getPath(model, path) ?? [];
  const commit = (next) => { setPath(model, path, next); open = -1; editing = -1; render(); };
  const button = (label, aria, onClick, className = '') => {
    const element = document.createElement('button'); element.type = 'button'; element.className = `tag-btn ${className}`; element.textContent = label; element.setAttribute('aria-label', aria); element.onclick = onClick; return element;
  };
  function render() {
    listEl.innerHTML = '';
    items().forEach((text, index) => {
      const chip = document.createElement('span'); chip.className = `tag${block ? ' block' : ''}${open === index ? ' open' : ''}`;
      if (editing === index) {
        const edit = document.createElement(block ? 'textarea' : 'input'); edit.className = 'tag-edit'; edit.value = text; if (block) edit.rows = 3;
        const finish = (save) => { const value = edit.value.trim(); if (save && value) commit(items().map((item, i) => (i === index ? value : item))); else { editing = -1; render(); } };
        edit.onkeydown = (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(true); } else if (event.key === 'Escape') finish(false); };
        edit.onblur = () => finish(true);
        chip.append(edit); listEl.append(chip); setTimeout(() => edit.focus(), 0); return;
      }
      chip.append(button(text, `Opciones de ${text}`, () => { open = open === index ? -1 : index; render(); }, 'tag-label'));
      if (open === index) {
        chip.append(button('✎', 'Editar', () => { editing = index; open = -1; render(); }, 'tag-act'), button('✕', 'Eliminar', () => commit(items().filter((_, i) => i !== index)), 'tag-act danger'));
      }
      listEl.append(chip);
    });
  }
  const add = () => { const value = input.value.trim(); input.value = ''; if (value && !items().includes(value)) commit([...items(), value]); };
  input.onkeydown = (event) => { if (event.key === 'Enter' || (event.key === ',' && !block)) { event.preventDefault(); add(); } };
  input.onblur = add;
  render();
}

function scheduleRow(slot) {
  return `<div class="slot"><div class="days">${DAYS.map((day, index) => `<label><input type="checkbox" data-day="${index}" ${slot.days.includes(index) ? 'checked' : ''}><span>${day}</span></label>`).join('')}</div>
    <div class="slot-fields"><input type="number" min="0" max="23" data-from value="${slot.from}" aria-label="Desde"><input type="number" min="1" max="24" data-to value="${slot.to}" aria-label="Hasta">
    <select data-location>${state.world.locations.map((loc) => `<option value="${loc.id}" ${loc.id === slot.locationId ? 'selected' : ''}>${escapeHtml(loc.name)}</option>`).join('')}</select>
    <input data-activity value="${escapeHtml(slot.activity ?? '')}" placeholder="actividad"><button type="button" data-remove aria-label="Quitar horario">×</button></div></div>`;
}

const connectionRow = (link) => `<div class="slot link"><div class="slot-fields link-fields"><input data-npc value="${escapeHtml(link.npcId ?? '')}" list="npc-ids" placeholder="id del personaje" aria-label="Personaje"><input data-relation value="${escapeHtml(link.relation ?? '')}" placeholder="relación (amiga, rival…)" aria-label="Relación">
  <input data-notes value="${escapeHtml(link.notes ?? '')}" placeholder="notas" aria-label="Notas"><button type="button" data-remove aria-label="Quitar conexión">×</button></div></div>`;

export async function openEditor(card) {
  const isNew = !card;
  const model = structuredClone(card ?? blankCard());
  model.summary ??= model.personality?.summary ?? '';
  model.personality = { ...blankCard().personality, ...(model.personality ?? {}) };
  model.contact = { handle: '', conditions: [], ...(model.contact ?? {}) };
  model.connections ??= []; model.clothingLikes ??= []; model.clothingDislikes ??= [];
  let others = [];
  try { others = (await dreq('/api/dev/npcs')).filter((item) => item.id !== model.id); } catch { /* sin lista de ids */ }
  let tab = 'identity';

  const node = layer('dev-editor', `<form class="dev-sheet" role="dialog" aria-label="Editor de ficha">
    <header><h2>${isNew ? 'Nuevo NPC' : escapeHtml(model.name)}</h2><button type="button" data-close aria-label="Cerrar">×</button></header>
    <nav class="tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" role="tab" data-tab="${id}">${label}</button>`).join('')}</nav>
    <div class="tab-body"></div><datalist id="npc-ids">${others.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</datalist>
    <p class="error" data-error role="alert"></p>
    <footer><button type="button" data-export-now>Exportar JSON</button><button type="submit" class="primary-dev">Guardar</button></footer></form>`);
  const form = node.querySelector('form'); const body = node.querySelector('.tab-body');

  const portraitPreview = () => {
    const portrait = model.portraits?.default;
    return `<section class="dev-portrait"><div class="portrait-preview">${portrait ? `<img src="${portrait}" alt="">` : '<span>Sin retrato</span>'}</div><p class="dev-hint">Las imágenes del personaje (retrato y emociones) se gestionan en la pestaña <strong>Emociones</strong>.</p></section>`;
  };

  const emotionsSection = () => {
    const portraits = model.portraits ?? {};
    const names = Object.keys(portraits);
    if (isNew) return '<p class="dev-hint">Guarda el personaje primero para poder subir su retrato y sus emociones.</p>';
    return `<p class="dev-hint">Cada imagen es una emoción o acción de <strong>una palabra</strong> (solo letras). El GM la invoca escribiendo su nombre entre llaves en mitad de la frase, por ejemplo <code>{feliz}</code>, y el sprite cambia justo ahí. Lo que ve el GM: <strong>${names.join(', ') || 'nada todavía'}</strong>. Usa el mismo lienzo y encuadre que el retrato por defecto.</p>
      <div class="emotion-grid">${names.map((name) => `<figure class="emotion" data-emotion="${escapeHtml(name)}"><img src="${portraits[name]}" alt=""><figcaption><strong>${escapeHtml(name)}</strong></figcaption>
        <label class="stay"><input type="checkbox" data-stay ${(model.emotionsStay ?? []).includes(name) ? 'checked' : ''} ${name === 'default' ? 'disabled' : ''}><span>Se mantiene</span></label>
        <div class="emotion-actions"><button type="button" data-replace>Reemplazar</button>${name === 'default' ? '' : '<button type="button" data-rename>Renombrar</button><button type="button" data-delete class="danger">Eliminar</button>'}</div></figure>`).join('')}</div>
      <h3>Añadir emoción</h3>
      <div class="emotion-add"><input data-new-emotion placeholder="feliz" maxlength="20" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Nombre de la emoción">
        <select data-quality aria-label="Calidad"><option value="balanced">WebP 92%</option><option value="max">WebP sin pérdida</option><option value="original">Tal cual</option></select>
        <label class="file-button">Subir imagen<input type="file" accept="image/png,image/webp,image/jpeg" hidden data-new-file></label></div>
      <input type="file" accept="image/png,image/webp,image/jpeg" hidden data-replace-file>
      <p class="dev-hint">Se convierte a WebP con transparencia y se guarda con el nombre que escribas. Si ya existe, se reemplaza.</p>
      <p class="dev-hint"><strong>Se mantiene:</strong> por defecto cada expresión vuelve a la neutra unos segundos después de terminar la respuesta. Márcala si debe quedarse (escenas largas o íntimas) hasta que el GM ponga otra; no olvides pulsar Guardar.</p>`;
  };

  const sections = {
    identity: () => portraitPreview() + field('Identificador (solo modo dev)', 'id', { readonly: !isNew, hint: 'Minúsculas, números y _. No se muestra al jugador.' }) + field('Nombre', 'name') + field('Edad', 'age', { kind: 'number' }) + field('Rol', 'role', { placeholder: 'Dueña y barista de…' })
      + field('Género', 'gender', { kind: 'select', options: (GENDER_OPTIONS.includes(model.gender) || !model.gender ? GENDER_OPTIONS : [...GENDER_OPTIONS, model.gender]).map((value) => [value, value]) })
      + field('Raza', 'race', { kind: 'select', options: RACE_OPTIONS }) + field('Resumen', 'summary', { kind: 'area', rows: 4, hint: 'Quién es, en pocas líneas.' }),
    personality: () => tagsField('Rasgos', 'personality.traits') + field('Forma de hablar', 'personality.speech', { kind: 'area', rows: 4 }) + tagsField('Le gusta', 'personality.likes') + tagsField('Le desagrada', 'personality.dislikes')
      + field('Límites', 'personality.boundaries', { kind: 'area', rows: 3 }) + field('Confía o se abre cuando…', 'personality.warmsUpWhen', { kind: 'area', rows: 3 }) + field('Desconfía o se cierra cuando…', 'personality.coolsDownWhen', { kind: 'area', rows: 3 })
      + field('Ejemplo de voz', 'exampleDialogue', { kind: 'area', rows: 5, hint: 'Frases de muestra de cómo habla.' }) + field('Lenguaje del amor', 'personality.loveLanguage', { kind: 'area', rows: 3, hint: 'Cómo da y recibe cariño: palabras, tiempo juntos, detalles, ayuda, contacto físico…' })
      + '<h3>Contacto</h3>' + field('Usuario de contacto', 'contact.handle', { placeholder: '@NombreUsuario', hint: 'Es lo que el jugador debe escribir en Mensajes. Solo lo ve cuando el personaje se lo comparte.' })
      + tagsField('Ofrece su contacto cuando…', 'contact.conditions', { block: true, placeholder: 'Añade una condición y pulsa Enter', hint: 'Deben cumplirse TODAS y el GM las interpreta con lo vivido: «ser amigos», «haber hablado 3 veces», «haberle dado un regalo», «llevarlo a la azotea», «conocer cierto secreto»… Solo lo comparte si el jugador lo pide o ella lo ofrece, y nunca antes de cumplirlas. Sin condiciones basta una buena impresión.' }),
    appearance: () => field('Apariencia', 'appearance', { kind: 'area', rows: 8, hint: 'Rasgos físicos, complexión, detalles que se notan. La IA lo usa al describirse o cuando se comenta su aspecto.' })
      + tagsField('Prendas que le agradan', 'clothingLikes') + tagsField('Prendas que evita o le disgustan', 'clothingDislikes', { hint: 'Ropa que no usaría o que le incomoda usar.' }),
    emotions: emotionsSection,
    story: () => field('Trasfondo', 'background', { kind: 'area', rows: 16, hint: 'Sin límite de caracteres: historia, hábitos, relaciones.' })
      + tagsField('Conocimientos', 'knowledge', { block: true, hint: 'Próximamente se vincularán con el lorebook para elegir de qué sucesos sabe y cómo.' }) + tagsField('Secretos', 'secrets', { block: true }),
    schedule: () => `<h3>Horario</h3><div class="slots">${model.schedule.map(scheduleRow).join('')}</div><button type="button" data-add-slot>Añadir horario</button><p class="dev-hint">Días: L=0 … D=6. El día 1 del juego es lunes.</p>
      <h3>Conexiones con otros personajes</h3><div class="links">${model.connections.map(connectionRow).join('')}</div><button type="button" data-add-link>Añadir conexión</button><p class="dev-hint">Relaciones con otros NPC (familia, amistad, rivalidad…). Puedes escribir el id de alguien que aún no existe.</p>`
  };

  const syncSchedule = () => {
    model.schedule = [...body.querySelectorAll('.slots .slot')].map((slot) => ({
      days: [...slot.querySelectorAll('[data-day]:checked')].map((box) => Number(box.dataset.day)), from: Number(slot.querySelector('[data-from]').value), to: Number(slot.querySelector('[data-to]').value),
      locationId: slot.querySelector('[data-location]').value, activity: slot.querySelector('[data-activity]').value
    }));
    model.connections = [...body.querySelectorAll('.links .slot')].map((slot) => ({ npcId: slot.querySelector('[data-npc]').value.trim(), relation: slot.querySelector('[data-relation]').value, notes: slot.querySelector('[data-notes]').value })).filter((link) => link.npcId);
  };

  function show(name) {
    tab = name;
    form.querySelectorAll('[data-tab]').forEach((button) => { button.classList.toggle('active', button.dataset.tab === name); button.setAttribute('aria-selected', button.dataset.tab === name); });
    body.innerHTML = sections[name]();
    body.querySelectorAll('[data-bind]').forEach((element) => {
      const path = element.dataset.bind; const value = getPath(model, path);
      element.value = value ?? '';
      element.addEventListener('input', () => setPath(model, path, element.type === 'number' ? (element.value === '' ? null : Number(element.value)) : element.value));
    });
    body.querySelectorAll('[data-tags]').forEach((element) => mountTags(element, model));
    if (name === 'schedule') {
      const bind = () => {
        body.querySelectorAll('.slot input, .slot select').forEach((element) => { element.oninput = syncSchedule; element.onchange = syncSchedule; });
        body.querySelectorAll('[data-remove]').forEach((button) => button.onclick = () => { const group = button.closest('.slots, .links'); if (group.classList.contains('links') || group.children.length > 1) { button.closest('.slot').remove(); syncSchedule(); } });
      };
      body.querySelector('[data-add-slot]').onclick = () => { body.querySelector('.slots').insertAdjacentHTML('beforeend', scheduleRow({ days: [0, 1, 2, 3, 4, 5, 6], from: 8, to: 20, locationId: state.world.locations[0].id, activity: '' })); bind(); syncSchedule(); };
      body.querySelector('[data-add-link]').onclick = () => { body.querySelector('.links').insertAdjacentHTML('beforeend', connectionRow({})); bind(); };
      bind();
    }
    if (name === 'emotions') bindEmotions();
  }

  async function sendPortrait(emotion, file) {
    const name = normalizeEmotion(emotion);
    if (!name) { notify('Escribe un nombre para la emoción usando solo letras.'); return; }
    try {
      const { blob, note } = await optimizeImage(file, body.querySelector('[data-quality]')?.value ?? 'balanced');
      const saved = await dreq(`/api/dev/npcs/${model.id}/portrait`, { method: 'POST', body: JSON.stringify({ data: await toBase64(blob), emotion: name }) });
      model.portraits = saved.portraits; show('emotions'); hooks.reload();
      notify(`Emoción «${name}» guardada: ${note}`);
    } catch (failure) { notify(failure.message); }
  }

  function bindEmotions() {
    const input = body.querySelector('[data-new-emotion]');
    if (!input) return;
    input.oninput = () => { const clean = normalizeEmotion(input.value); if (clean !== input.value) input.value = clean; };
    body.querySelector('[data-new-file]').onchange = (event) => {
      const file = event.target.files[0]; event.target.value = ''; if (!file) return;
      const name = normalizeEmotion(input.value);
      if (model.portraits?.[name] && !confirm(`Ya existe «${name}». ¿Reemplazarla?`)) return;
      sendPortrait(name, file);
    };
    const replaceInput = body.querySelector('[data-replace-file]');
    let target = null;
    replaceInput.onchange = (event) => { const file = event.target.files[0]; event.target.value = ''; if (file && target) sendPortrait(target, file); };
    body.querySelectorAll('.emotion').forEach((card) => {
      const name = card.dataset.emotion;
      card.querySelector('[data-stay]').onchange = (event) => { const stay = new Set(model.emotionsStay ?? []); if (event.target.checked) stay.add(name); else stay.delete(name); model.emotionsStay = [...stay]; };
      card.querySelector('[data-replace]').onclick = () => { target = name; replaceInput.click(); };
      card.querySelector('[data-rename]')?.addEventListener('click', async () => {
        const to = normalizeEmotion(prompt('Nuevo nombre (solo letras):', name));
        if (!to || to === name) return;
        try { const saved = await dreq(`/api/dev/npcs/${model.id}/portrait/${name}/rename`, { method: 'POST', body: JSON.stringify({ to }) }); model.portraits = saved.portraits; model.emotionsStay = (model.emotionsStay ?? []).map((item) => (item === name ? to : item)); show('emotions'); hooks.reload(); notify(`«${name}» ahora es «${to}». Pulsa Guardar para conservar los cambios.`); }
        catch (failure) { notify(failure.message); }
      });
      card.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar la emoción «${name}»?`)) return;
        try { const saved = await dreq(`/api/dev/npcs/${model.id}/portrait/${name}`, { method: 'DELETE' }); model.portraits = saved.portraits; model.emotionsStay = (model.emotionsStay ?? []).filter((item) => item !== name); show('emotions'); hooks.reload(); notify(`«${name}» eliminada.`); }
        catch (failure) { notify(failure.message); }
      });
    });
  }

  const clean = () => { const { portraits, ...rest } = model; return rest; };
  form.querySelectorAll('[data-tab]').forEach((button) => { button.onclick = () => show(button.dataset.tab); });
  form.querySelector('[data-export-now]').onclick = () => exportCard(clean());
  form.onsubmit = async (event) => {
    event.preventDefault();
    const error = form.querySelector('[data-error]'); error.textContent = '';
    try {
      const body = clean(); body.id = String(body.id ?? '').trim();
      const saved = await dreq(`/api/dev/npcs/${body.id}`, { method: 'PUT', body: JSON.stringify(body) });
      notify(`Guardada: ${saved.name}`);
      node.remove(); hooks.reload();
    } catch (failure) { error.textContent = failure.message; }
  };
  show(tab);
}

export const devLabel = () => (isDev() ? `DEV · ${place(state.run.player.locationId)?.name ?? ''}` : '');
