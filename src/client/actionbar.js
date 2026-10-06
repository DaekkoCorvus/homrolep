// Barra de acciones (etapa 5): cuatro verbos fijos siempre a la vista —Hablar · Explorar · Ir · Esperar— y, encima, «quién está aquí» con su avatar.
// Lo que antes eran 6 botones en una fila que había que deslizar se reparte así: Hablar y las personas presentes abren una conversación; Explorar reúne las
// acciones de ambientación del lugar; Ir abre el mapa; Esperar reúne esperar, dormir y trabajar. Todo queda a un toque, sin deslizar a ciegas.
import { escapeHtml } from './core.js';

const icon = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICONS = {
  talk: '<path d="M4 5h16v11H9l-5 4Z"/><path d="M8 9h8M8 12h5"/>',
  explore: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2"/>',
  go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  wait: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'
};
const initial = (name) => escapeHtml(String(name).trim().charAt(0).toUpperCase());

let openKind = null;

export const SHEET_HTML = '<div class="as-layer" hidden><div class="as" role="menu" aria-label="Opciones"></div></div>';

// Cierra la hoja de opciones si estaba abierta (devuelve true si cerró algo, para Escape).
export function closeSheet(root) {
  const layer = root.querySelector('.as-layer'); if (!layer || layer.hidden) return false;
  layer.classList.remove('open');
  const kind = openKind; openKind = null;
  root.querySelectorAll('.verbs [aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  setTimeout(() => { if (!openKind) layer.hidden = true; }, 220);
  root.querySelector(`.verbs [data-verb="${kind}"]`)?.focus({ preventScroll: true });
  return true;
}

function openSheet(root, kind, title, options) {
  const layer = root.querySelector('.as-layer'); const sheet = layer.querySelector('.as');
  openKind = kind;
  sheet.innerHTML = `<p class="as-title">${escapeHtml(title)}</p>${options.map((option, index) => `<button type="button" role="menuitem" class="as-item ${option.person ? 'person' : ''}" data-index="${index}">${option.person ? `<span class="avatar">${initial(option.label)}</span>` : ''}<span class="as-copy"><strong>${escapeHtml(option.label)}</strong>${option.hint ? `<small>${escapeHtml(option.hint)}</small>` : ''}</span></button>`).join('')}`;
  sheet.querySelectorAll('.as-item').forEach((button) => { button.onclick = () => { const option = options[Number(button.dataset.index)]; closeSheet(root); option.run(); }; });
  layer.hidden = false; requestAnimationFrame(() => layer.classList.add('open'));
  root.querySelectorAll('.verbs [data-verb]').forEach((button) => button.setAttribute('aria-expanded', String(button.dataset.verb === kind)));
  sheet.querySelector('.as-item')?.focus({ preventScroll: true });
  layer.onclick = (event) => { if (event.target === layer) closeSheet(root); };
  layer.onkeydown = (event) => {   // flechas entre opciones (Tab también funciona)
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const items = [...sheet.querySelectorAll('.as-item')]; const at = items.indexOf(document.activeElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); event.preventDefault();
  };
}

// `ctx`: { run, loc, meta (escena), actions: { talk(npcId), explore(text), wait(), sleep(), work(), go(opener) } }
export function renderActionBar(root, ctx) {
  const { run, loc, meta, actions } = ctx;
  const people = root.querySelector('.people'); const verbs = root.querySelector('.verbs');
  closeSheet(root);
  const encounter = run.encounter;
  if (encounter?.closed || encounter) {
    people.hidden = true;
    verbs.innerHTML = encounter.closed
      ? '<button type="button" class="verb wide primary-verb" data-kind="leave">Volver</button>'
      : '<button type="button" class="verb wide" data-kind="end">Despedirte</button>';
    verbs.querySelector('button').onclick = encounter.closed ? actions.leave : actions.end;
    return;
  }
  const here = run.presence ?? [];
  people.hidden = !here.length;
  people.innerHTML = here.length ? `<span class="people-label">Aquí</span>${here.map((npc) => `<button type="button" class="person-chip" data-npc="${escapeHtml(npc.id)}" aria-label="Hablar con ${escapeHtml(npc.name)}"><span class="avatar">${initial(npc.name)}</span>${escapeHtml(npc.name)}</button>`).join('')}` : '';
  people.querySelectorAll('[data-npc]').forEach((button) => { button.onclick = () => actions.talk(button.dataset.npc); });

  const explore = [{ label: 'Mirar a mi alrededor', run: () => actions.explore('Miro a mi alrededor.') }, ...(meta?.interactions ?? []).map((text) => ({ label: text, run: () => actions.explore(`${text}.`) }))];
  const waits = [{ label: 'Esperar un rato', hint: '30 minutos', run: actions.wait }];
  if (loc.id === 'apartment') waits.push({ label: 'Dormir', hint: 'unas 8 horas', run: actions.sleep });
  if (run.player.occupation === 'worker') waits.push({ label: 'Trabajar', hint: 'una jornada de 6 horas', run: actions.work });
  const verbButton = (kind, label, path, extra = '') => `<button type="button" class="verb ${extra}" data-verb="${kind}" aria-haspopup="${kind === 'go' ? 'dialog' : 'menu'}" aria-expanded="false">${icon(path)}<span>${label}</span></button>`;
  verbs.innerHTML = verbButton('talk', 'Hablar', ICONS.talk) + verbButton('explore', 'Explorar', ICONS.explore) + verbButton('go', 'Ir', ICONS.go, 'primary-verb') + verbButton('wait', 'Esperar', ICONS.wait);
  const talk = verbs.querySelector('[data-verb="talk"]');
  if (!here.length) { talk.disabled = true; talk.title = 'No hay nadie con quien hablar aquí ahora'; }
  talk.onclick = () => (here.length === 1 ? actions.talk(here[0].id) : openSheet(root, 'talk', '¿Con quién hablas?', here.map((npc) => ({ label: npc.name, hint: npc.role, person: true, run: () => actions.talk(npc.id) }))));
  verbs.querySelector('[data-verb="explore"]').onclick = () => openSheet(root, 'explore', 'Explorar', explore);
  verbs.querySelector('[data-verb="go"]').onclick = (event) => actions.go(event.currentTarget);
  verbs.querySelector('[data-verb="wait"]').onclick = () => (waits.length === 1 ? waits[0].run() : openSheet(root, 'wait', 'Dejar pasar el tiempo', waits));
}
