// NorthLife: la red social del juego. Línea de tiempo con publicaciones (también de cuentas inventadas), likes, comentarios,
// hilos, avisos y publicar/responder. El servidor decide qué se ve y cuándo (según la hora del mundo); aquí solo se dibuja.
import { state, request, notify, activeSignal, escapeHtml } from './core.js';

const PATHS = {
  reply: '<path d="M4 5h16v11H9l-5 4Z"/>',
  repost: '<path d="M4 10V9a3 3 0 0 1 3-3h12l-3-3M20 14v1a3 3 0 0 1-3 3H5l3 3"/>',
  heart: '<path d="M12 20s-7-4.400-7-10a4 4 0 0 1 7-2.500A4 4 0 0 1 19 10c0 5.600-7 10-7 10Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
const svg = (path, fill = 'none') => `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const CHECK = '<svg class="xp-check" viewBox="0 0 24 24" role="img" aria-label="Cuenta verificada"><path d="M12 2l2.400 2 3.100-.3 1 3 2.700 1.600-1 3 1 3-2.700 1.600-1 3-3.100-.3L12 22l-2.400-2-3.100.3-1-3-2.700-1.600 1-3-1-3L5.500 7.400l1-3 3.100.3Z" fill="currentColor"/><path d="M8.500 12l2.500 2.500 4.500-5" fill="none" stroke="#0f1220" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const pad = (value) => String(value).padStart(2, '0');
const hue = (handle) => [...String(handle)].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 360, 7);
const compact = (count) => (count >= 1e6 ? `${(count / 1e6).toFixed(1).replace(/\.0$/, '')}M` : count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(count));
const rich = (value) => escapeHtml(value).replace(/(^|[\s(])([@#][\p{L}\p{N}_]+)/gu, '$1<span class="xp-link">$2</span>');

// Hora relativa al reloj del juego: «ahora», «12 min», «3 h», «ayer 21:04», «Día 2 · 08:00».
export function ago(minutes, now) {
  const diff = now - minutes;
  if (diff < 1) return 'ahora';
  if (diff < 60) return `${diff} min`;
  if (diff < 12 * 60) return `${Math.floor(diff / 60)} h`;
  const rest = ((minutes % 1440) + 1440) % 1440; const clock = `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
  return Math.floor(now / 1440) - Math.floor(minutes / 1440) === 1 ? `ayer ${clock}` : `Día ${Math.floor(minutes / 1440) + 1} · ${clock}`;
}

function avatar(entry) {
  const portrait = entry.npcId ? state.run.contacts?.find((npc) => npc.id === entry.npcId)?.portraits?.default : null;
  if (portrait) return `<span class="xp-av"><img src="${escapeHtml(portrait)}" alt=""></span>`;
  return `<span class="xp-av" style="--h:${hue(entry.handle)}">${escapeHtml(String(entry.name || entry.handle).replace(/^@/, '').charAt(0).toUpperCase())}</span>`;
}

function head(entry, now) {
  return `<header class="xp-head"><strong>${escapeHtml(entry.name)}</strong>${entry.verified ? CHECK : ''}<span class="xp-handle">${escapeHtml(entry.handle)}</span><span class="xp-dot">·</span><time>${escapeHtml(ago(entry.minutes, now))}</time></header>`;
}

function postCard(post, now, { full = false } = {}) {
  return `<article class="xp${full ? ' xp-full' : ''}${post.own ? ' xp-own' : ''}" data-post="${post.id}">${avatar(post)}<div class="xp-body">${head(post, now)}<p class="xp-text">${rich(post.text)}</p>
    <footer class="xp-actions"><button type="button" data-open="${post.id}" aria-label="Comentarios">${svg(PATHS.reply)}<span>${compact(post.replies.length)}</span></button><span class="xp-act" aria-label="Reposts">${svg(PATHS.repost)}<span>${compact(post.reposts)}</span></span><button type="button" data-like="${post.id}" class="${post.liked ? 'liked' : ''}" aria-pressed="${post.liked}" aria-label="Me gusta">${svg(PATHS.heart, post.liked ? 'currentColor' : 'none')}<span>${compact(post.likes)}</span></button></footer></div></article>`;
}

function replyCard(reply, post, now) {
  return `<article class="xp xp-reply${reply.own ? ' xp-own' : ''}" data-reply="${reply.id}">${avatar(reply)}<div class="xp-body">${head(reply, now)}${reply.inReplyTo ? `<p class="xp-to">Respondiendo a <span class="xp-link">${escapeHtml(reply.inReplyTo)}</span></p>` : ''}<p class="xp-text">${rich(reply.text)}</p>
    <footer class="xp-actions"><button type="button" data-reply-to="${reply.id}" data-handle="${escapeHtml(reply.handle)}" aria-label="Responder">${svg(PATHS.reply)}</button><span class="xp-act"></span><button type="button" data-like="${post.id}" data-like-reply="${reply.id}" class="${reply.liked ? 'liked' : ''}" aria-pressed="${reply.liked}" aria-label="Me gusta">${svg(PATHS.heart, reply.liked ? 'currentColor' : 'none')}<span>${compact(reply.likes)}</span></button></footer></div></article>`;
}

function composer(ctx, { id, placeholder, rows = 3, label = 'Publicar' }) {
  const { ui } = ctx;
  return `<form id="${id}" class="xp-compose">${ui.replyTo && id === 'reply-form' ? `<p class="xp-replying">Respondiendo a <span class="xp-link">${escapeHtml(ui.replyTo.handle)}</span> <button type="button" data-clear-reply aria-label="Quitar">×</button></p>` : ''}
    <textarea name="text" rows="${rows}" maxlength="280" placeholder="${placeholder}" ${ui.socialBusy ? 'disabled' : ''} required></textarea>
    <div class="xp-compose-foot"><small data-count>0/280</small><span class="xp-pending">${ui.socialBusy ? 'La red está reaccionando…' : ''}</span><button type="submit" class="xp-send" aria-label="${ui.socialBusy ? 'Detener' : label}">${ui.socialBusy ? ctx.stopIcon : label}</button></div>
    <p class="error" data-social-error role="alert">${escapeHtml(ui.socialError ?? '')}</p></form>`;
}

export function feedView(ctx) {
  const { ui } = ctx; const { social } = state.run;
  if (ui.thread) return threadView(ctx);
  const banner = ui.newPosts ? `<button type="button" class="xp-new" data-new-posts>${ui.newPosts === 1 ? '1 publicación nueva' : `${ui.newPosts} publicaciones nuevas`} ↑</button>` : '';
  const posts = social.posts.map((post) => postCard(post, social.now)).join('') || '<p class="empty xp-empty">NorthLife está tranquila ahora mismo. Las publicaciones irán apareciendo con el paso del día.</p>';
  return `<div class="xp-feed">${banner}${ui.composing ? composer(ctx, { id: 'compose-form', placeholder: '¿Qué está pasando?' }) : ''}${posts}</div><button type="button" class="xp-fab" data-compose aria-label="Publicar">${svg(PATHS.plus)}</button>`;
}

function threadView(ctx) {
  const { ui } = ctx; const { social } = state.run;
  const post = social.posts.find((item) => item.id === ui.thread);
  if (!post) return '<p class="empty">Esa publicación ya no está disponible.</p>';
  return `<div class="xp-feed xp-thread">${postCard(post, social.now, { full: true })}
    ${composer(ctx, { id: 'reply-form', placeholder: ui.replyTo ? 'Escribe tu respuesta' : `Responder a ${escapeHtml(post.handle)}`, rows: 2, label: 'Responder' })}
    ${post.replies.map((reply) => replyCard(reply, post, social.now)).join('') || '<p class="empty xp-empty">Nadie ha comentado todavía.</p>'}</div>`;
}

export function notificationsView() {
  const { social } = state.run;
  if (!social.notifications.length) return '<p class="empty">Aquí aparecerán los avisos cuando alguien responda a tus publicaciones o comentarios.</p>';
  return `<div class="xp-feed">${social.notifications.map((item) => `<button type="button" class="xp-note${item.read ? '' : ' unread'}" data-note-post="${item.postId}">${avatar(item)}<span class="xp-note-body"><span><strong>${escapeHtml(item.name)}</strong> ${item.onYourPost ? 'respondió a tu publicación' : 'te respondió'} <time>· ${escapeHtml(ago(item.minutes, social.now))}</time></span><q>${escapeHtml(item.text)}</q></span></button>`).join('')}</div>`;
}

// Al entrar en NorthLife: cuántas publicaciones han salido desde la última vez que se miró el feed.
export function enterFeed(ui) {
  const key = `hom:feedSeen:${state.run.id}`;
  let seen = null;
  try { const stored = localStorage.getItem(key); seen = stored === null ? null : Number(stored); } catch { /* sin almacenamiento */ }
  ui.newPosts = Number.isFinite(seen) ? state.run.social.posts.filter((post) => !post.own && post.minutes > seen).length : 0;
  try { localStorage.setItem(key, String(state.run.social.now)); } catch { /* sin almacenamiento */ }
}

const api = (op) => request(`/api/runs/${state.run.id}/social`, { method: 'POST', body: JSON.stringify(op) });

// Enlaza los eventos de feed, hilos, avisos y formularios. `ctx` aporta ui, rerender(), reload(), refresh() y el icono de detener.
export function bindFeed(screen, ctx) {
  const { ui } = ctx;
  const body = screen.querySelector('.app-body');
  const fire = async (operation) => { try { state.run = await operation(); ctx.rerender(true); ctx.refresh(); } catch (error) { notify(error.message); } };

  screen.querySelector('[data-compose]')?.addEventListener('click', () => { ui.composing = !ui.composing; ctx.rerender(); screen.querySelector('#compose-form textarea')?.focus(); });
  screen.querySelector('[data-new-posts]')?.addEventListener('click', () => { ui.newPosts = 0; ctx.rerender(); body.scrollTop = 0; });
  screen.querySelectorAll('[data-clear-reply]').forEach((button) => { button.onclick = () => { ui.replyTo = null; ctx.rerender(true); }; });
  screen.querySelectorAll('[data-note-post]').forEach((button) => { button.onclick = () => { ui.nlTab = 'feed'; ui.thread = button.dataset.notePost; ui.replyTo = null; ctx.rerender(); body.scrollTop = 0; }; });

  screen.querySelectorAll('.xp-feed').forEach((feed) => feed.addEventListener('click', (event) => {
    const like = event.target.closest('[data-like]');
    if (like) { event.stopPropagation(); fire(() => api({ op: 'like', postId: like.dataset.like, replyId: like.dataset.likeReply })); return; }
    const answer = event.target.closest('[data-reply-to]');
    if (answer) { ui.replyTo = { id: answer.dataset.replyTo, handle: answer.dataset.handle }; ctx.rerender(true); screen.querySelector('#reply-form textarea')?.focus(); return; }
    if (event.target.closest('button, a, form')) {
      const open = event.target.closest('[data-open]');
      if (open) { ui.thread = open.dataset.open; ui.replyTo = null; ctx.rerender(); body.scrollTop = 0; }
      return;
    }
    const card = event.target.closest('.xp[data-post]:not(.xp-full)');
    if (card) { ui.thread = card.dataset.post; ui.replyTo = null; ctx.rerender(); body.scrollTop = 0; }
  }));

  const submit = (form, url, payload) => {
    const textarea = form.elements.text;
    form.querySelector('.xp-send').addEventListener('click', (event) => { if (ui.socialBusy) { event.preventDefault(); ui.socialAbort?.abort(); } });
    textarea.value = ui.draft ?? '';
    const count = form.querySelector('[data-count]');
    const update = () => { ui.draft = textarea.value; count.textContent = `${textarea.value.length}/280`; };
    textarea.addEventListener('input', update); update();
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (ui.socialBusy) return;
      const text = textarea.value.trim(); if (!text) return;
      ui.socialBusy = true; ui.socialError = ''; ui.socialAbort = new AbortController(); activeSignal.current = ui.socialAbort.signal;
      ctx.rerender(true);
      try {
        state.run = await request(url, { method: 'POST', body: JSON.stringify(payload(text)) });
        ui.draft = ''; ui.composing = false; ui.replyTo = null;
      } catch (error) {
        if (error.name !== 'AbortError') ui.socialError = error.message; else notify('Detenido: no se publicó nada.');
        await ctx.reload();
      } finally { activeSignal.current = null; ui.socialBusy = false; ui.socialAbort = null; ctx.rerender(true); ctx.refresh(); }
    };
  };
  const compose = screen.querySelector('#compose-form');
  if (compose) submit(compose, `/api/runs/${state.run.id}/posts`, (text) => ({ text }));
  const reply = screen.querySelector('#reply-form');
  if (reply) submit(reply, `/api/runs/${state.run.id}/social`, (text) => ({ op: 'reply', postId: ui.thread, replyTo: ui.replyTo?.id, text }));
}

export const markRead = () => (state.run.social.unread ? api({ op: 'read' }).then((run) => { state.run = run; }).catch(() => {}) : Promise.resolve());
