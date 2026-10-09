// Cuadro de texto del juego (etapa 4): una placa con quien habla, un marco fino, un indicador ✧ al terminar cada línea, el aviso «↓ más» si el texto
// desborda, un historial que se abre hacia arriba, quién está pensando mientras la IA responde y los avisos de lo que decidió el motor (+10 min, −$5…).
// No sabe nada de la partida: game.js le dice qué mostrar. Todo el texto que muestra lo escapa quien lo llama (aquí solo se escapan nombres y avisos).
import { escapeHtml } from './core.js';

// Texto de un personaje: lo que va entre *asteriscos* es una acción (cursiva tenue, sin los asteriscos); lo demás es diálogo. Un asterisco sin pareja se deja tal cual.
export const actionRanges = (text) => { const out = []; const pattern = /\*([^*\n]+)\*/g; let match; while ((match = pattern.exec(text))) out.push([match.index, match.index + match[0].length - 1]); return out; };
export const plainText = (text) => String(text ?? '').replace(/\*([^*\n]+)\*/g, '$1');
export function formatNpc(text) {
  const source = String(text ?? ''); let out = ''; let last = 0;
  for (const [start, end] of actionRanges(source)) { out += escapeHtml(source.slice(last, start)) + `<span class="act">${escapeHtml(source.slice(start + 1, end))}</span>`; last = end + 1; }
  return out + escapeHtml(source.slice(last));
}

export const TEXTBOX_HTML = `
  <section class="tb" data-speaker="narrator" aria-label="Texto de la historia">
    <div class="tb-notes" aria-hidden="true"></div>
    <div class="tb-frame">
      <div class="tb-head">
        <span class="tb-plate" hidden><span class="tb-name"></span></span>
        <button type="button" class="tb-hist-btn" aria-label="Ver el historial" aria-expanded="false" data-history><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>
      </div>
      <div class="story tb-body" tabindex="0"></div>
      <p class="tb-think" hidden role="status"><span class="tb-think-text"></span><i></i><i></i><i></i></p>
      <button type="button" class="tb-more" hidden>↓ más</button>
      <span class="tb-end" aria-hidden="true" hidden>✧</span>
    </div>
  </section>
  <aside class="tb-history" hidden aria-label="Historial"><header><strong>Historial</strong><button type="button" data-history-close aria-label="Cerrar el historial">✕</button></header><div class="th-list"></div></aside>`;

const q = (root, selector) => root.querySelector(selector);

// Quién habla en la línea actual: 'npc' (placa con su nombre), 'you' (a la derecha, marco más ligero) o 'narrator' (cursiva, sin placa).
export function setSpeaker(root, kind, name = '') {
  const box = q(root, '.tb'); const plate = q(root, '.tb-plate');
  box.dataset.speaker = kind;
  plate.hidden = kind === 'narrator' || !name;
  q(root, '.tb-name').textContent = name;
}

// «Luna está pensando…» mientras responde la IA: no atenúa el texto anterior.
export function setThinking(root, label) {
  const node = q(root, '.tb-think');
  node.hidden = !label;
  q(root, '.tb-think-text').textContent = label ?? '';
  q(root, '.tb').classList.toggle('thinking', Boolean(label));
  if (label) setEnd(root, false);
  refreshOverflow(root);
}

// ✧ que palpita cuando la línea terminó de escribirse.
export function setEnd(root, on) { const node = q(root, '.tb-end'); if (node) node.hidden = !on; }

// «↓ más»: el texto no cabe y aún queda por leer.
export function refreshOverflow(root) {
  const body = q(root, '.tb-body'); const more = q(root, '.tb-more');
  if (!body || !more) return;
  const hidden = body.scrollHeight - body.scrollTop - body.clientHeight > 8;
  more.hidden = !hidden;
  q(root, '.tb').classList.toggle('has-more', hidden);
}

// Avisos breves de lo que decide el motor (datos del motor, no de la IA). Cada uno se retira solo.
export function showChanges(root, chips) {
  const box = q(root, '.tb-notes'); if (!box) return;
  for (const chip of chips) {
    const node = document.createElement('span');
    node.className = `tb-note ${chip.tone ?? ''}`;
    node.textContent = chip.text;
    box.append(node);
    setTimeout(() => { node.classList.add('out'); setTimeout(() => node.remove(), 500); }, 3400);
  }
}

// Historial: ¿quién dijo qué? Cada entrada lleva su dueño. `entries` = [{ who:'narrator'|'npc'|'you', name?, text, gesture?, aside? }]
function renderHistory(root, entries) {
  const list = q(root, '.th-list');
  list.innerHTML = entries.length ? entries.map((entry) => {
    const who = escapeHtml(entry.name || '');
    if (entry.who === 'npc') return `<article class="th npc"><b>${who}</b>${entry.gesture ? `<em>${escapeHtml(entry.gesture)}</em>` : ''}<p>${formatNpc(entry.text)}</p></article>`;
    if (entry.who === 'you') return `<article class="th you"><b>Tú</b><p>${escapeHtml(entry.text)}</p></article>`;
    return `<article class="th narrator">${entry.label ? `<b>${escapeHtml(entry.label)}</b>` : ''}<p>${escapeHtml(entry.text)}</p></article>`;
  }).join('') : '<p class="th-empty">Todavía no hay nada que recordar.</p>';
  list.scrollTop = list.scrollHeight;
}

export function bindTextbox(root, { entries }) {
  const panel = q(root, '.tb-history'); const button = q(root, '[data-history]'); const body = q(root, '.tb-body');
  const open = () => { renderHistory(root, entries()); panel.hidden = false; button.setAttribute('aria-expanded', 'true'); requestAnimationFrame(() => panel.classList.add('open')); q(root, '[data-history-close]').focus({ preventScroll: true }); };
  const close = () => { if (panel.hidden) return false; panel.classList.remove('open'); button.setAttribute('aria-expanded', 'false'); setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, 240); button.focus({ preventScroll: true }); return true; };
  button.onclick = () => (panel.hidden ? open() : close());
  q(root, '[data-history-close]').onclick = close;
  panel.onclick = (event) => { if (event.target === panel) close(); };
  // Deslizar hacia arriba sobre la cabecera del cuadro abre el historial; hacia abajo sobre el historial lo cierra.
  const head = q(root, '.tb-head'); let from = null;
  head.addEventListener('pointerdown', (event) => { from = event.clientY; });
  head.addEventListener('pointerup', (event) => { if (from !== null && from - event.clientY > 30) open(); from = null; });
  head.addEventListener('pointercancel', () => { from = null; });
  let down = null;
  panel.addEventListener('pointerdown', (event) => { down = event.clientY; });
  panel.addEventListener('pointerup', (event) => { const list = q(root, '.th-list'); if (down !== null && event.clientY - down > 60 && list.scrollTop <= 0) close(); down = null; });
  body.addEventListener('scroll', () => refreshOverflow(root), { passive: true });
  q(root, '.tb-more').onclick = () => { body.scrollBy({ top: Math.max(60, body.clientHeight * 0.8), behavior: 'smooth' }); };
  new ResizeObserver(() => refreshOverflow(root)).observe(body);
  return { close, isOpen: () => !panel.hidden };
}

// Lo que se ha dicho y narrado, en orden y con su dueño. `npcName(id)` da el nombre visible de un personaje.
export function historyEntries(run, { npcName, encounterNpc }) {
  const out = [];
  const paragraphs = (text) => String(text ?? '').split(/\n{2,}|\n/).map((part) => part.trim()).filter(Boolean);
  if (run.prologue?.text) out.push({ who: 'narrator', label: 'Prólogo', text: run.prologue.text });
  const linesOf = (lines, name) => lines.forEach((line) => {
    if (line.who === 'npc') out.push({ who: 'npc', name, text: line.text, gesture: line.gesture });
    else if (line.who === 'player') out.push({ who: 'you', text: line.text });
    else if (line.who === 'narrator') out.push({ who: 'narrator', text: line.text });
  });
  const endedIndex = run.eventLog.findLastIndex((event) => event.type === 'conversation_ended');
  run.eventLog.forEach((event, index) => {
    if (event.type === 'conversation_ended') {
      const name = npcName(event.data.npcId);
      if (index === endedIndex && run.lastEncounter && run.lastEncounter.npcId === event.data.npcId) linesOf(run.lastEncounter.lines, name);
      paragraphs(event.data.response).forEach((part) => out.push(/te comparte su contacto/.test(part) ? { who: 'narrator', text: part } : { who: 'npc', name, text: part }));
      return;
    }
    if (!event.data?.response) return;
    if (event.type === 'player_action' && event.data.text) out.push({ who: 'you', text: event.data.text });
    out.push({ who: 'narrator', text: event.data.response });
  });
  if (run.encounter && encounterNpc) linesOf(run.encounter.lines, encounterNpc.name);
  return out.slice(-80);
}
