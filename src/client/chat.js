// Chat con un contacto en ráfagas (la pantalla «Chats» de NorthLife).
//   · Escribes los mensajes que quieras: cada envío se guarda al instante, sin esperar al modelo.
//   · Con la caja vacía, el mismo botón cambia de icono y PASA EL TURNO: el personaje lee lo que mandaste (✓✓ «Visto»), «escribe…» mientras el
//     modelo piensa y luego sus mensajes aparecen uno a uno, cada uno tras su «escribiendo…» (el servidor fija cuánto tarda cada mensaje).
//   · Tocar un mensaje (o arrastrarlo hacia la derecha) permite responderlo: el mensaje nuevo cita ese mensaje concreto.
import { state, request, notify, escapeHtml, activeSignal } from './core.js';

const SEND_ICON = '<path d="M5 12h14M13 6l6 6-6 6"/>';
const TURN_ICON = '<path d="M4 5h16v11H9l-5 4Z"/><path d="M9 10.500h.01M12 10.500h.01M15 10.500h.01" stroke-width="2.600"/>';
const STOP_ICON = '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>';
const REPLY_ICON = '<path d="M10 8 5 12l5 4"/><path d="M5 12h9a5 5 0 0 1 5 5v1"/>';
const svg = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const SEEN_TO_TYPING_MS = 650;   // entre «visto» y «escribiendo…»
const GAP_MS = 260;              // entre un mensaje y el «escribiendo…» del siguiente
const SWIPE_PX = 56;
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const speed = () => (reduced() ? 0.3 : 1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Espera que se puede saltar (botón de detener durante la reproducción de la respuesta).
async function nap(ui, ms) { const end = performance.now() + ms; while (performance.now() < end && !ui.chatSkip) await sleep(Math.min(80, Math.max(0, end - performance.now()))); }

// La barra de respuesta y las citas muestran solo el principio del mensaje, en una línea y sin saltos: el resto no se pinta.
const SNIPPET_CHARS = 90;
const snippet = (text) => { const clean = String(text ?? '').replace(/\s+/g, ' ').trim(); return clean.length > SNIPPET_CHARS ? `${clean.slice(0, SNIPPET_CHARS - 1)}…` : clean; };
const messagesOf = (npcId) => state.run.chats?.[npcId] ?? [];
const waitingOf = (messages) => { let count = 0; for (let index = messages.length - 1; index >= 0 && messages[index].who === 'player'; index--) count += 1; return count; };

// --- Pintado ---------------------------------------------------------------------------------------------------------------------------------------------
function visibleMessages(npc, ui) {
  const all = messagesOf(npc.id);
  const reveal = ui.chatReveal?.npcId === npc.id ? ui.chatReveal : null;
  return reveal ? all.slice(0, reveal.fromIndex + reveal.shown) : all;
}

function messageHtml(message, { npc, ctx, tick = '' }) {
  const mine = message.who === 'player';
  const quote = message.replyTo
    ? `<div class="quote"><b>${escapeHtml(message.replyTo.who === 'player' ? 'Tú' : npc.name)}</b><span>${escapeHtml(snippet(message.replyTo.text))}</span></div>` : '';
  return `<div class="msg ${mine ? 'you' : 'them'}" data-msg="${escapeHtml(message.id)}"><div class="bubble ${mine ? 'you' : 'them'}">${quote}${escapeHtml(message.text)}<time>${ctx.hourOf(message.time)}${tick}</time></div>`
    + `<button type="button" class="msg-reply" data-reply-msg="${escapeHtml(message.id)}" aria-label="Responder a este mensaje">${svg(REPLY_ICON)}</button></div>`;
}

function listHtml(npc, ctx) {
  const { ui } = ctx;
  const shown = visibleMessages(npc, ui);
  const waiting = waitingOf(shown);
  const firstWaiting = shown.length - waiting;
  const typing = ui.chatPhase === 'typing' || (ui.chatReveal?.npcId === npc.id && ui.chatReveal.typing);
  const html = shown.map((message, index) => {
    let tick = '';
    if (message.who === 'player') {
      const answered = index < firstWaiting;
      const seen = answered || ui.chatPhase === 'seen' || ui.chatPhase === 'typing';
      tick = ` <span class="tick${seen ? ' seen' : ''}" aria-label="${seen ? 'Visto' : 'Enviado'}">${seen ? '✓✓' : '✓'}</span>${index === shown.length - 1 && !answered && seen ? ' <span class="tick-label">Visto</span>' : ''}`;
    }
    return messageHtml(message, { npc, ctx, tick });
  });
  if (typing) html.push(`<div class="msg them"><div class="bubble them typing" role="status" aria-label="${escapeHtml(npc.name)} está escribiendo"><i></i><i></i><i></i></div></div>`);
  return html.join('') || '<p class="empty">Aún no hay mensajes. Saluda.</p>';
}

export function threadView(npc, ctx) {
  const { ui, initial } = ctx;
  const reply = ui.chatReplyTo;
  return `<div class="thread-head"><span class="avatar">${initial(npc.name)}</span><strong>${escapeHtml(npc.name)}</strong></div><div class="thread">${listHtml(npc, ctx)}</div>
    <div class="chat-reply" ${reply ? '' : 'hidden'}><span><b>${escapeHtml(reply ? (reply.who === 'player' ? 'Tú' : npc.name) : '')}</b> ${escapeHtml(snippet(reply?.text))}</span><button type="button" data-cancel-reply aria-label="Cancelar respuesta">×</button></div>
    <form id="chat-form"><textarea name="text" rows="1" maxlength="4000" placeholder="Escribe un mensaje…" aria-label="Mensaje">${escapeHtml(ui.chatDraft ?? '')}</textarea><button type="submit" class="send-chat" aria-label="Enviar"></button></form>
    <p class="chat-hint" data-chat-hint></p><p class="error" data-chat-error role="alert"></p>`;
}

// --- Comportamiento ---------------------------------------------------------------------------------------------------------------------------------------
export function bindChat(screen, ctx) {
  const { ui } = ctx;
  const npc = (state.run.contacts ?? []).find((item) => item.id === ui.chatWith);
  const form = screen.querySelector('#chat-form'); if (!npc || !form) return;
  const area = form.elements.text; const button = form.querySelector('.send-chat');
  const thread = () => screen.querySelector('.thread');
  const bar = screen.querySelector('.chat-reply'); const hint = screen.querySelector('[data-chat-hint]');
  ui.chatQueue ??= Promise.resolve();
  const scrollDown = () => { const list = thread(); if (list) list.scrollTop = list.scrollHeight; };
  scrollDown();

  // El botón cambia según lo que puedas hacer: enviar el mensaje escrito, pasar el turno (caja vacía y mensajes sin responder) o detener.
  function paintButton() {
    const text = area.value.trim(); const waiting = waitingOf(messagesOf(npc.id));
    const mode = ui.chatBusy ? 'stop' : text ? 'send' : waiting ? 'turn' : 'idle';
    button.dataset.mode = mode;
    button.disabled = mode === 'idle';
    button.setAttribute('aria-label', { stop: 'Detener', send: 'Enviar mensaje', turn: 'Pasar el turno: que respondan', idle: 'Enviar' }[mode]);
    button.innerHTML = svg({ stop: STOP_ICON, send: SEND_ICON, turn: TURN_ICON, idle: SEND_ICON }[mode]);
    hint.textContent = !ui.chatBusy && !text && waiting ? 'Cuando termines, toca el botón para que respondan.' : '';
  }
  const paintList = () => { const list = thread(); if (!list) return; const near = list.scrollHeight - list.scrollTop - list.clientHeight < 90; list.innerHTML = listHtml(npc, ctx); if (near) scrollDown(); };
  const paintReplyBar = () => {
    const reply = ui.chatReplyTo; bar.hidden = !reply;
    if (reply) bar.querySelector('span').innerHTML = `<b>${escapeHtml(reply.who === 'player' ? 'Tú' : npc.name)}</b> ${escapeHtml(snippet(reply.text))}`;
  };
  const fail = (message) => { const box = screen.querySelector('[data-chat-error]'); if (box) box.textContent = message; };
  const grow = () => { area.style.height = 'auto'; area.style.height = `${Math.min(110, area.scrollHeight)}px`; };

  area.addEventListener('input', () => { ui.chatDraft = area.value; paintButton(); grow(); });
  // En ordenador, Enter envía el mensaje (Mayús+Enter salta de línea); en móvil Enter siempre es salto de línea.
  area.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && matchMedia('(pointer: fine)').matches) { event.preventDefault(); if (area.value.trim()) sendMessage(); } });
  paintButton(); paintReplyBar(); grow();
  ui.chatUi = { paintList, paintButton };

  // --- Responder a un mensaje: tocar y «↩», o arrastrar hacia la derecha ---
  const startReply = (id) => {
    const message = messagesOf(npc.id).find((item) => item.id === id); if (!message) return;
    ui.chatReplyTo = { id: message.id, who: message.who, text: snippet(message.text) };
    paintReplyBar(); scrollDown(); area.focus(); // la barra le quita altura a la lista: se mantiene el final a la vista
  };
  thread()?.addEventListener('click', (event) => {
    const reply = event.target.closest('[data-reply-msg]');
    if (reply) { startReply(reply.dataset.replyMsg); return; }
    const row = event.target.closest('.msg'); if (!row) return;
    const open = row.classList.contains('selected');
    thread().querySelectorAll('.msg.selected').forEach((item) => item.classList.remove('selected'));
    if (!open) row.classList.add('selected');
  });
  let drag = null;
  thread()?.addEventListener('pointerdown', (event) => { const row = event.target.closest('.msg'); if (row && !event.target.closest('button')) drag = { row, x: event.clientX, y: event.clientY, active: false }; });
  thread()?.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x; const dy = event.clientY - drag.y;
    if (!drag.active && (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx))) { drag = null; return; } // es un desplazamiento vertical
    if (dx > 8) { drag.active = true; drag.row.style.transform = `translateX(${Math.min(dx, 72)}px)`; drag.row.classList.toggle('arming', dx >= SWIPE_PX); }
  });
  const endDrag = (event) => {
    if (!drag) return;
    const { row, x, active } = drag; drag = null;
    row.style.transform = ''; row.classList.remove('arming');
    if (active && event.clientX - x >= SWIPE_PX) startReply(row.dataset.msg);
  };
  thread()?.addEventListener('pointerup', endDrag);
  thread()?.addEventListener('pointercancel', () => { if (drag) { drag.row.style.transform = ''; drag = null; } });
  bar.querySelector('[data-cancel-reply]').onclick = () => { ui.chatReplyTo = null; paintReplyBar(); };

  // --- Enviar: se guarda al instante; los envíos van en cola para llegar en orden ---
  function sendMessage() {
    const text = area.value.trim(); if (!text || ui.chatBusy) return;
    const replyTo = ui.chatReplyTo?.id;
    area.value = ''; ui.chatDraft = ''; ui.chatReplyTo = null; paintReplyBar(); grow(); paintButton();
    const npcId = npc.id; fail('');
    ui.chatQueue = ui.chatQueue.then(async () => {
      try {
        state.run = await request(`/api/runs/${state.run.id}/chat`, { method: 'POST', body: JSON.stringify({ op: 'send', npcId, text, ...(replyTo ? { replyTo } : {}) }) });
        if (ui.chatWith === npcId) { paintList(); paintButton(); }
      } catch (error) {
        fail(error.message); area.value = `${text}${area.value ? `\n${area.value}` : ''}`; ui.chatDraft = area.value; paintButton(); grow();
      }
    });
    // Mientras llega la respuesta del servidor, el mensaje ya se ve (con ✓ al confirmarse).
    const list = thread(); if (list) { list.insertAdjacentHTML('beforeend', `<div class="msg you pending"><div class="bubble you">${escapeHtml(text)}<time>…</time></div></div>`); scrollDown(); }
  }

  // --- Pasar el turno ---
  async function passTurn() {
    await ui.chatQueue;
    if (ui.chatBusy || !waitingOf(messagesOf(npc.id))) return;
    const npcId = npc.id; const before = messagesOf(npcId).length;
    const readMs = Math.round((npc.chat?.readMs ?? 1200) * speed());
    ui.chatBusy = true; ui.chatPhase = 'sent'; ui.chatAbort = new AbortController(); activeSignal.current = ui.chatAbort.signal;
    const token = Symbol('turno'); ui.chatToken = token; const started = performance.now();
    ui.chatUi?.paintList(); ui.chatUi?.paintButton(); fail('');
    // Mientras el modelo piensa: primero «visto» y luego «escribiendo…».
    const seenTimer = setTimeout(() => { if (ui.chatToken !== token) return; ui.chatPhase = 'seen'; ui.chatUi?.paintList(); setTimeout(() => { if (ui.chatToken === token && ui.chatBusy) { ui.chatPhase = 'typing'; ui.chatUi?.paintList(); } }, SEEN_TO_TYPING_MS * speed()); }, readMs);
    let fresh = null;
    try {
      fresh = await request(`/api/runs/${state.run.id}/chat`, { method: 'POST', body: JSON.stringify({ op: 'turn', npcId }) });
    } catch (error) {
      if (error.name !== 'AbortError') fail(error.message); else notify('Detenido: nadie respondió.');
      clearTimeout(seenTimer); ui.chatBusy = false; ui.chatPhase = null; ui.chatToken = null; ui.chatAbort = null; activeSignal.current = null;
      try { state.run = await request(`/api/runs/${state.run.id}`); } catch { /* se queda con el estado actual */ }
      ui.chatUi?.paintList(); ui.chatUi?.paintButton(); return;
    }
    activeSignal.current = null; ui.chatAbort = null;
    // Si el modelo respondió antes de «visto» y «escribiendo…», se espera lo justo para que se vea.
    const typingFrom = started + readMs + SEEN_TO_TYPING_MS * speed();
    if (performance.now() < typingFrom) { await sleep(typingFrom - performance.now()); if (ui.chatToken !== token) return; }
    clearTimeout(seenTimer);
    state.run = fresh;
    const answers = messagesOf(npcId).slice(before);
    ui.chatReveal = { npcId, fromIndex: before, shown: 0, typing: true, token };
    ui.chatPhase = 'seen'; ui.chatBusy = true; ui.chatSkip = false;
    ui.chatUi?.paintList();
    for (const [index, answer] of answers.entries()) {
      const typed = Math.round((answer.typingMs ?? 1200) * speed());
      const already = index === 0 ? performance.now() - typingFrom : 0; // lo que ya «escribía» mientras el modelo pensaba cuenta
      await nap(ui, Math.max(250 * speed(), typed - already));
      if (ui.chatToken !== token) return;
      ui.chatReveal.shown = index + 1; ui.chatReveal.typing = false; ui.chatUi?.paintList();
      if (index < answers.length - 1) { await nap(ui, GAP_MS * speed()); if (ui.chatToken !== token) return; ui.chatReveal.typing = !ui.chatSkip; ui.chatUi?.paintList(); }
    }
    ui.chatReveal = null; ui.chatBusy = false; ui.chatPhase = null; ui.chatToken = null;
    ui.chatSkip = false;
    ui.chatUi?.paintList(); ui.chatUi?.paintButton(); ctx.refresh(); // insignias, agenda (acuerdos anotados) y reloj
  }

  form.onsubmit = (event) => {
    event.preventDefault();
    // Mientras el modelo piensa, detener cancela el turno; mientras se reproduce la respuesta, la muestra de golpe.
    if (ui.chatBusy) { if (ui.chatReveal) ui.chatSkip = true; else ui.chatAbort?.abort(); return; }
    if (area.value.trim()) sendMessage(); else passTurn();
  };
}
