// Herramientas de desarrollo: comandos de chat, panel de partida y editor de fichas de NPC (importar/exportar).
import { state, request, notify, escapeHtml, isDev, setDev, place } from './core.js';

const COMMANDS = [
  ['/dev', 'Activa o desactiva las herramientas de desarrollo'],
  ['/ayuda', 'Muestra esta lista'],
  ['/reiniciar', 'Rebobina la conversación actual (o la última) y la empieza de nuevo'],
  ['/regenerar', 'Regenera la última respuesta: la del NPC, el cierre de la conversación o la narración'],
  ['/hora HH:MM [día]', 'Cambia la hora del mundo'],
  ['/ir lugar', 'Te lleva a un lugar sin gastar tiempo (id o nombre)'],
  ['/npc [id]', 'Abre el editor de la ficha de un NPC'],
  ['/fichas', 'Abre el panel con el listado, importar y exportar'],
  ['/fx lite|full|auto', 'Calidad de efectos de la escena (lite congela las animaciones)']
];
const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const PORTRAIT_MAX_HEIGHT = 1200;
const norm = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const lines = (value) => (Array.isArray(value) ? value.join('\n') : '');

let hooks = null; // { perform, runDev, reload }
export const initDevtools = (value) => { hooks = value; };

// Devuelve true si el texto era un comando (aunque falle), para que no se envíe como acción del jugador.
export async function runCommand(text) {
  if (!text.startsWith('/')) return false;
  const [name, ...rest] = text.trim().split(/\s+/);
  const argument = rest.join(' ');
  const command = norm(name);
  if (command === '/dev') { setDev(!isDev()); notify(isDev() ? 'Herramientas de desarrollo activadas.' : 'Herramientas de desarrollo desactivadas.'); hooks.reload(); if (isDev()) openPanel(); return true; }
  if (command === '/fx') {
    const mode = ['lite', 'full', 'auto'].includes(norm(argument)) ? norm(argument) : null;
    if (!mode) notify('Uso: /fx lite (escena estática, más rápido) · full · auto'); else { hooks.setFx(mode); notify(`Efectos: ${mode}`); }
    return true;
  }
  if (!isDev()) { notify('Escribe /dev para activar las herramientas de desarrollo.'); return true; }
  if (command === '/ayuda' || command === '/help') openPanel();
  else if (command === '/reiniciar' || command === '/restart') hooks.perform(() => hooks.runDev({ op: 'restart' }));
  else if (command === '/regenerar' || command === '/regen') hooks.perform(() => hooks.runDev({ op: 'regen' }));
  else if (command === '/hora') {
    const match = argument.match(/^(\d{1,2})(?::(\d{2}))?(?:\s+(\d+))?$/);
    if (!match) notify('Uso: /hora 14:30 [día]');
    else hooks.perform(() => hooks.runDev({ op: 'set_time', hour: Number(match[1]), minute: Number(match[2] ?? 0), ...(match[3] ? { day: Number(match[3]) } : {}) }));
  } else if (command === '/ir') {
    const target = state.world.locations.find((loc) => norm(loc.id) === norm(argument) || norm(loc.name).startsWith(norm(argument)));
    if (!argument || !target) notify(`Lugares: ${state.world.locations.map((loc) => loc.id).join(', ')}`);
    else hooks.perform(() => hooks.runDev({ op: 'teleport', locationId: target.id }));
  } else if (command === '/npc') {
    if (argument) { const cards = await request('/api/dev/npcs'); const card = cards.find((item) => item.id === norm(argument) || norm(item.name).startsWith(norm(argument))); if (card) openEditor(card); else notify('No encontré ese NPC.'); }
    else openPanel();
  } else if (command === '/fichas') openPanel();
  else notify('Comando desconocido. Escribe /ayuda.');
  return true;
}

function layer(className, html) {
  document.querySelector(`.${className}`)?.remove();
  const node = document.createElement('div');
  node.className = `dev-layer ${className}`;
  node.innerHTML = html;
  document.body.append(node);
  requestAnimationFrame(() => node.classList.add('open'));
  node.addEventListener('click', (event) => { if (event.target === node) node.remove(); });
  node.querySelectorAll('[data-close]').forEach((button) => button.onclick = () => node.remove());
  return node;
}

export async function openPanel() {
  let cards = [];
  try { cards = await request('/api/dev/npcs'); } catch (error) { notify(error.message); return; }
  const node = layer('dev-panel', `<div class="dev-sheet" role="dialog" aria-label="Herramientas de desarrollo">
    <header><h2>Desarrollo</h2><button type="button" data-close aria-label="Cerrar">×</button></header>
    <section><h3>Partida</h3><div class="dev-buttons">
      <button type="button" data-act="restart">Reiniciar cita</button><button type="button" data-act="regen">Regenerar respuesta</button>
      <button type="button" data-act="hour">+1 hora</button></div></section>
    <section><h3>Fichas de NPC</h3><div class="dev-list">${cards.map((card) => `<div class="dev-row"><span><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.id)} · ${escapeHtml(card.role || 'sin rol')}</small></span><button type="button" data-edit="${escapeHtml(card.id)}">Editar</button><button type="button" data-export="${escapeHtml(card.id)}">Exportar</button></div>`).join('')}</div>
      <div class="dev-buttons"><button type="button" data-new>Nuevo NPC</button><label class="file-button">Importar ficha<input type="file" accept=".json,.png,application/json,image/png" hidden data-import></label></div>
      <p class="dev-hint">Importa JSON propio, fichas «character card» v1/v2/v3 (JSON o PNG). También puedes dejar archivos en <code>data/canon/npcs/</code> y <code>assets/portraits/&lt;id&gt;/default.png</code> y reiniciar el servidor.</p></section>
    <section><h3>Comandos de chat</h3><dl class="dev-commands">${COMMANDS.map(([c, d]) => `<div><dt>${escapeHtml(c)}</dt><dd>${escapeHtml(d)}</dd></div>`).join('')}</dl></section></div>`);
  node.querySelector('[data-act=restart]').onclick = () => { node.remove(); hooks.perform(() => hooks.runDev({ op: 'restart' })); };
  node.querySelector('[data-act=regen]').onclick = () => { node.remove(); hooks.perform(() => hooks.runDev({ op: 'regen' })); };
  node.querySelector('[data-act=hour]').onclick = () => { const w = state.run.world; node.remove(); hooks.perform(() => hooks.runDev({ op: 'set_time', hour: (w.hour + 1) % 24, minute: w.minute, day: w.day + (w.hour === 23 ? 1 : 0) })); };
  node.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => openEditor(cards.find((card) => card.id === button.dataset.edit)));
  node.querySelectorAll('[data-export]').forEach((button) => button.onclick = () => exportCard(cards.find((card) => card.id === button.dataset.export)));
  node.querySelector('[data-new]').onclick = () => openEditor(null);
  node.querySelector('[data-import]').onchange = (event) => importFile(event.target.files[0]);
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
    const card = await request('/api/dev/npcs/import', { method: 'POST', body: JSON.stringify({ ...body, overwrite }) });
    notify(`Importada: ${card.name}`);
    hooks.reload();
    openEditor(card);
  } catch (error) {
    if (error.code === 'NPC_EXISTS' && confirm(`${error.message}`)) return importFile(file, true);
    notify(error.message);
  }
}

const blankCard = () => ({
  id: '', name: '', role: '', tier: 'civil', status: 'draft', canonSource: '', background: '', exampleDialogue: '',
  schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 8, to: 20, locationId: state.world.locations[0].id, activity: '' }],
  personality: { summary: '', traits: [], speech: '', likes: [], dislikes: [], boundaries: '', warmsUpWhen: '', coolsDownWhen: '' },
  knowledge: [], secrets: [], contact: { method: '', offerWhen: '' }, portraits: {}
});

function field(label, name, value, { rows = 0, hint = '', readonly = false } = {}) {
  const control = rows
    ? `<textarea name="${name}" rows="${rows}">${escapeHtml(value ?? '')}</textarea>`
    : `<input name="${name}" value="${escapeHtml(value ?? '')}" ${readonly ? 'readonly' : ''}>`;
  return `<label class="dev-field"><span>${label}</span>${control}${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function scheduleRow(slot) {
  return `<div class="slot"><div class="days">${DAYS.map((day, index) => `<label><input type="checkbox" data-day="${index}" ${slot.days.includes(index) ? 'checked' : ''}><span>${day}</span></label>`).join('')}</div>
    <div class="slot-fields"><input type="number" min="0" max="23" data-from value="${slot.from}" aria-label="Desde"><input type="number" min="1" max="24" data-to value="${slot.to}" aria-label="Hasta">
    <select data-location>${state.world.locations.map((loc) => `<option value="${loc.id}" ${loc.id === slot.locationId ? 'selected' : ''}>${escapeHtml(loc.name)}</option>`).join('')}</select>
    <input data-activity value="${escapeHtml(slot.activity ?? '')}" placeholder="actividad"><button type="button" data-remove aria-label="Quitar horario">×</button></div></div>`;
}

export function openEditor(card) {
  const isNew = !card;
  const c = card ?? blankCard();
  const p = c.personality;
  const portrait = c.portraits?.default;
  const node = layer('dev-editor', `<form class="dev-sheet" role="dialog" aria-label="Editor de ficha">
    <header><h2>${isNew ? 'Nuevo NPC' : escapeHtml(c.name)}</h2><button type="button" data-close aria-label="Cerrar">×</button></header>
    <section class="dev-portrait"><div class="portrait-preview">${portrait ? `<img src="${portrait}" alt="">` : '<span>Sin retrato</span>'}</div>
      <div><p class="dev-hint">Retrato de novela visual (PNG con fondo transparente recomendado). Por ahora se usa uno; las emociones se añadirán después como <code>happy.png</code>, etc.</p>
      <div class="portrait-options"><select data-quality aria-label="Calidad"><option value="balanced">WebP 92% (≈6× más ligero)</option><option value="max">WebP sin pérdida</option><option value="original">Subir tal cual</option></select>
      <input data-emotion value="default" aria-label="Emoción" placeholder="emoción" pattern="[a-z][a-z0-9_-]{0,20}"></div>
      <label class="file-button ${isNew ? 'disabled' : ''}">Subir retrato<input type="file" accept="image/png,image/webp,image/jpeg" hidden data-portrait ${isNew ? 'disabled' : ''}></label></div></section>
    <section><h3>Identidad</h3>${field('Id (minúsculas y _)', 'id', c.id, { readonly: !isNew })}${field('Nombre', 'name', c.name)}${field('Rol', 'role', c.role)}${field('Estado', 'status', c.status, { hint: 'draft, revisado, canon…' })}${field('Fuente canon', 'canonSource', c.canonSource, { rows: 2 })}</section>
    <section><h3>Personalidad</h3>${field('Resumen', 'summary', p.summary, { rows: 3 })}${field('Rasgos (uno por línea)', 'traits', lines(p.traits), { rows: 3 })}${field('Forma de hablar', 'speech', p.speech, { rows: 3 })}${field('Le gusta (uno por línea)', 'likes', lines(p.likes), { rows: 3 })}${field('Le desagrada (uno por línea)', 'dislikes', lines(p.dislikes), { rows: 3 })}${field('Límites', 'boundaries', p.boundaries, { rows: 3 })}${field('Se abre cuando…', 'warmsUpWhen', p.warmsUpWhen, { rows: 2 })}${field('Se cierra cuando…', 'coolsDownWhen', p.coolsDownWhen, { rows: 2 })}</section>
    <section><h3>Detalle</h3>${field('Trasfondo (libre y largo)', 'background', c.background, { rows: 8, hint: 'Historia, hábitos, relaciones… hasta 4000 caracteres.' })}${field('Ejemplos de voz', 'exampleDialogue', c.exampleDialogue, { rows: 6, hint: 'Frases de muestra de cómo habla.' })}${field('Conocimientos (uno por línea)', 'knowledge', lines(c.knowledge), { rows: 3 })}${field('Secretos (uno por línea)', 'secrets', lines(c.secrets), { rows: 3 })}${field('Medio de contacto', 'contactMethod', c.contact.method)}${field('Ofrece su contacto cuando…', 'contactOffer', c.contact.offerWhen, { rows: 2 })}</section>
    <section><h3>Horario</h3><div class="slots">${c.schedule.map(scheduleRow).join('')}</div><button type="button" data-add-slot>Añadir horario</button><p class="dev-hint">Días: L=0 … D=6. El día 1 del juego es lunes.</p></section>
    <p class="error" data-error role="alert"></p>
    <footer><button type="button" data-export-now>Exportar JSON</button><button type="submit" class="primary-dev">Guardar</button></footer></form>`);
  const form = node.querySelector('form');
  const slots = form.querySelector('.slots');
  const removable = () => slots.querySelectorAll('[data-remove]').forEach((button) => button.onclick = () => { if (slots.children.length > 1) button.closest('.slot').remove(); });
  removable();
  form.querySelector('[data-add-slot]').onclick = () => { slots.insertAdjacentHTML('beforeend', scheduleRow({ days: [0, 1, 2, 3, 4, 5, 6], from: 8, to: 20, locationId: state.world.locations[0].id, activity: '' })); removable(); };

  const collect = () => {
    const data = Object.fromEntries(new FormData(form));
    const split = (value) => String(value ?? '').split('\n').map((item) => item.trim()).filter(Boolean);
    return {
      id: data.id.trim(), name: data.name, role: data.role, tier: c.tier, status: data.status, canonSource: data.canonSource, home: c.home,
      background: data.background, exampleDialogue: data.exampleDialogue,
      schedule: [...slots.querySelectorAll('.slot')].map((slot) => ({
        days: [...slot.querySelectorAll('[data-day]:checked')].map((box) => Number(box.dataset.day)), from: Number(slot.querySelector('[data-from]').value), to: Number(slot.querySelector('[data-to]').value),
        locationId: slot.querySelector('[data-location]').value, activity: slot.querySelector('[data-activity]').value
      })),
      personality: { summary: data.summary, traits: split(data.traits), speech: data.speech, likes: split(data.likes), dislikes: split(data.dislikes), boundaries: data.boundaries, warmsUpWhen: data.warmsUpWhen, coolsDownWhen: data.coolsDownWhen },
      knowledge: split(data.knowledge), secrets: split(data.secrets), contact: { method: data.contactMethod, offerWhen: data.contactOffer }
    };
  };
  form.querySelector('[data-export-now]').onclick = () => exportCard(collect());
  form.onsubmit = async (event) => {
    event.preventDefault();
    const error = form.querySelector('[data-error]'); error.textContent = '';
    try {
      const body = collect();
      const saved = await request(`/api/dev/npcs/${body.id}`, { method: 'PUT', body: JSON.stringify(body) });
      notify(`Guardada: ${saved.name}`);
      node.remove(); hooks.reload();
    } catch (failure) { error.textContent = failure.message; }
  };
  form.querySelector('[data-portrait]').onchange = async (event) => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const emotion = form.querySelector('[data-emotion]').value.trim() || 'default';
      const { blob, note } = await optimizeImage(file, form.querySelector('[data-quality]').value);
      const saved = await request(`/api/dev/npcs/${c.id}/portrait`, { method: 'POST', body: JSON.stringify({ data: await toBase64(blob), emotion }) });
      if (saved.portraits.default) form.querySelector('.portrait-preview').innerHTML = `<img src="${saved.portraits.default}" alt="">`;
      notify(`Retrato «${emotion}» guardado: ${note}`); hooks.reload();
    } catch (failure) { notify(failure.message); }
  };
}

export const devLabel = () => (isDev() ? `DEV · ${place(state.run.player.locationId)?.name ?? ''}` : '');
