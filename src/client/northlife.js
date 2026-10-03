// NorthLife: la red social del juego. Alta de cuenta, línea de tiempo con publicaciones (también de cuentas inventadas), likes,
// compartir, comentarios, hilos, notificaciones y perfil. El servidor decide qué se ve y cuándo (según la hora del mundo);
// aquí solo se dibuja.
import { state, request, notify, activeSignal, escapeHtml } from './core.js';

const PATHS = {
  reply: '<path d="M4 5h16v11H9l-5 4Z"/>',
  repost: '<path d="M4 10V9a3 3 0 0 1 3-3h12l-3-3M20 14v1a3 3 0 0 1-3 3H5l3 3"/>',
  heart: '<path d="M12 20s-7-4.400-7-10a4 4 0 0 1 7-2.500A4 4 0 0 1 19 10c0 5.600-7 10-7 10Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.500"/>'
};
const svg = (path, fill = 'none') => `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const CHECK = '<svg class="xp-check" viewBox="0 0 24 24" role="img" aria-label="Cuenta verificada"><path d="M12 2l2.400 2 3.100-.3 1 3 2.700 1.600-1 3 1 3-2.700 1.600-1 3-3.100-.3L12 22l-2.400-2-3.100.3-1-3-2.700-1.600 1-3-1-3L5.500 7.400l1-3 3.100.3Z" fill="currentColor"/><path d="M8.500 12l2.500 2.500 4.500-5" fill="none" stroke="#0f1220" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const pad = (value) => String(value).padStart(2, '0');
const hue = (handle) => [...String(handle)].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 360, 7);
const compact = (count) => (count >= 1e6 ? `${(count / 1e6).toFixed(1).replace(/\.0$/, '')}M` : count >= 1000 ? `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(count));
const rich = (value) => escapeHtml(value).replace(/(^|[\s(])([@#][\p{L}\p{N}_]+)/gu, '$1<span class="xp-link">$2</span>');
const profile = () => state.run.social.profile;
const mediaUrl = (which) => `/api/runs/${state.run.id}/media/${which}?v=${profile().v}`;

// Hora relativa al reloj del juego: «ahora», «12 min», «3 h», «ayer 21:04», «Día 2 · 08:00».
export function ago(minutes, now) {
  const diff = now - minutes;
  if (diff < 1) return 'ahora';
  if (diff < 60) return `${diff} min`;
  if (diff < 12 * 60) return `${Math.floor(diff / 60)} h`;
  const rest = ((minutes % 1440) + 1440) % 1440; const clock = `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
  return Math.floor(now / 1440) - Math.floor(minutes / 1440) === 1 ? `ayer ${clock}` : `Día ${Math.floor(minutes / 1440) + 1} · ${clock}`;
}

// Solo se pintan avatares que el servidor ya validó (https del catálogo o imágenes locales de assets/social); aun así se vuelve a comprobar.
const SAFE_AVATAR = /^(?:https:\/\/[^\s"'<>`]+|\/assets\/social\/[A-Za-z0-9_\-./]+)$/;

function avatar(entry, size = '') {
  const portrait = entry.npcId ? state.run.contacts?.find((npc) => npc.id === entry.npcId)?.portraits?.default : null;
  if (portrait) return `<span class="xp-av ${size}"><img src="${escapeHtml(portrait)}" alt=""></span>`;
  if (entry.own && profile().hasAvatar) return `<span class="xp-av ${size}"><img src="${mediaUrl('avatar')}" alt=""></span>`;
  const letter = escapeHtml(String(entry.name || entry.handle).replace(/^@/, '').charAt(0).toUpperCase());
  // Con imagen, la inicial queda como respaldo: si la URL ya no existe (error de carga) se sustituye sola (ver bindFeed).
  if (typeof entry.avatar === 'string' && SAFE_AVATAR.test(entry.avatar)) return `<span class="xp-av ${size}" style="--h:${hue(entry.handle)}" data-letter="${letter}"><img src="${escapeHtml(entry.avatar)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-avatar></span>`;
  return `<span class="xp-av ${size}" style="--h:${hue(entry.handle)}">${letter}</span>`;
}

// Botón con la foto del jugador en la barra de la app (abre su perfil).
export const meButton = () => (profile().created ? `<button type="button" class="nl-me" data-me aria-label="Mi perfil">${avatar({ own: true, handle: profile().handle, name: profile().name })}</button>` : '');

function head(entry, now) {
  return `<header class="xp-head"><strong>${escapeHtml(entry.name)}</strong>${entry.verified ? CHECK : ''}<span class="xp-handle">${escapeHtml(entry.handle)}</span><span class="xp-dot">·</span><time>${escapeHtml(ago(entry.minutes, now))}</time></header>`;
}

// El servidor guarda lo que publicas al instante y la red reacciona después: mientras tanto la publicación muestra que alguien está escribiendo.
const reacting = (postId) => Boolean(state.run.pending?.reactions?.includes(postId));
const typingLine = (postId) => (reacting(postId) ? '<p class="xp-typing" role="status"><span class="xp-dots" aria-hidden="true"><i></i><i></i><i></i></span> La red está reaccionando…</p>' : '');

function postCard(post, now, { full = false, kicker = '' } = {}) {
  return `<article class="xp${full ? ' xp-full' : ''}${post.own ? ' xp-own' : ''}" data-post="${post.id}">${avatar(post)}<div class="xp-body">${kicker ? `<p class="xp-kicker">${svg(PATHS.repost)} ${kicker}</p>` : ''}${head(post, now)}<p class="xp-text">${rich(post.text)}</p>
    <footer class="xp-actions"><button type="button" data-open="${post.id}" aria-label="Comentarios">${svg(PATHS.reply)}<span>${compact(post.replies.length)}</span></button>${post.own
    ? `<span class="xp-act" aria-label="Reposts">${svg(PATHS.repost)}<span>${compact(post.reposts)}</span></span>`
    : `<button type="button" data-repost="${post.id}" class="${post.reposted ? 'shared' : ''}" aria-pressed="${Boolean(post.reposted)}" aria-label="Compartir">${svg(PATHS.repost)}<span>${compact(post.reposts)}</span></button>`}<button type="button" data-like="${post.id}" class="${post.liked ? 'liked' : ''}" aria-pressed="${post.liked}" aria-label="Me gusta">${svg(PATHS.heart, post.liked ? 'currentColor' : 'none')}<span>${compact(post.likes)}</span></button></footer>${typingLine(post.id)}</div></article>`;
}

function replyCard(reply, post, now, { toThread = false } = {}) {
  return `<article class="xp xp-reply${reply.own ? ' xp-own' : ''}" data-reply="${reply.id}"${toThread ? ` data-thread="${post.id}"` : ''}>${avatar(reply)}<div class="xp-body">${head(reply, now)}${reply.inReplyTo ? `<p class="xp-to">Respondiendo a <span class="xp-link">${escapeHtml(reply.inReplyTo)}</span></p>` : ''}<p class="xp-text">${rich(reply.text)}</p>
    <footer class="xp-actions"><button type="button" data-reply-to="${reply.id}" data-handle="${escapeHtml(reply.handle)}" aria-label="Responder">${svg(PATHS.reply)}</button><span class="xp-act"></span><button type="button" data-like="${post.id}" data-like-reply="${reply.id}" class="${reply.liked ? 'liked' : ''}" aria-pressed="${reply.liked}" aria-label="Me gusta">${svg(PATHS.heart, reply.liked ? 'currentColor' : 'none')}<span>${compact(reply.likes)}</span></button></footer></div></article>`;
}

function composer(ctx, { id, placeholder, rows = 3, label = 'Publicar' }) {
  const { ui } = ctx;
  return `<form id="${id}" class="xp-compose">${ui.replyTo && id === 'reply-form' ? `<p class="xp-replying">Respondiendo a <span class="xp-link">${escapeHtml(ui.replyTo.handle)}</span> <button type="button" data-clear-reply aria-label="Quitar">×</button></p>` : ''}
    <textarea name="text" rows="${rows}" maxlength="280" placeholder="${placeholder}" ${ui.socialBusy ? 'disabled' : ''} required></textarea>
    <div class="xp-compose-foot"><small data-count>0/280</small><span class="xp-pending">${ui.socialBusy ? 'Publicando…' : ''}</span><button type="submit" class="xp-send" aria-label="${ui.socialBusy ? 'Detener' : label}">${ui.socialBusy ? ctx.stopIcon : label}</button></div>
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
  if (!social.notifications.length) return '<p class="empty">Aquí aparecerán las notificaciones cuando alguien responda a tus publicaciones o comentarios.</p>';
  return `<div class="xp-feed">${social.notifications.map((item) => `<button type="button" class="xp-note${item.read ? '' : ' unread'}" data-note-post="${item.postId}">${avatar(item)}<span class="xp-note-body"><span><strong>${escapeHtml(item.name)}</strong> ${item.onYourPost ? 'respondió a tu publicación' : 'te respondió'} <time>· ${escapeHtml(ago(item.minutes, social.now))}</time></span><q>${escapeHtml(item.text)}</q></span></button>`).join('')}</div>`;
}

// --- Cuenta y perfil ---------------------------------------------------------------------------------------------------------
// Imagen elegida → recortada al tamaño final y comprimida en el navegador (el servidor solo guarda lo ya ligero).
async function toDataUrl(file, width, height) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const w = bitmap.width * scale; const h = bitmap.height * scale;
  canvas.getContext('2d').drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
  bitmap.close?.();
  let url = canvas.toDataURL('image/webp', 0.85);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.85);
  return url;
}
const pickImage = (width, height) => new Promise((resolve) => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  input.onchange = async () => { try { resolve(input.files[0] ? await toDataUrl(input.files[0], width, height) : undefined); } catch { notify('No se pudo leer esa imagen.'); resolve(undefined); } };
  input.oncancel = () => resolve(undefined);
  input.click();
});

// Alta (primera vez) y edición comparten formulario. `ui.pfp` / `ui.banner`: undefined = sin cambios, null = quitar, texto = nueva imagen.
function accountForm(ctx, { creating }) {
  const { ui } = ctx; const mine = profile();
  const avatarPreview = ui.pfp ? `<span class="xp-av xp-av-lg"><img src="${ui.pfp}" alt=""></span>` : ui.pfp === null || !mine.hasAvatar ? `<span class="xp-av xp-av-lg" style="--h:${hue(mine.handle)}">${escapeHtml(state.run.player.name.charAt(0).toUpperCase())}</span>` : `<span class="xp-av xp-av-lg"><img src="${mediaUrl('avatar')}" alt=""></span>`;
  const bannerPreview = ui.banner ? ui.banner : ui.banner === null || !mine.hasBanner ? '' : mediaUrl('banner');
  return `<form id="account-form" class="xp-setup">
    ${creating ? '<h2>Crea tu cuenta en NorthLife</h2><p class="xp-lead">Así te verán los demás. Elige una foto, tu usuario y, si quieres, cuéntanos algo de ti.</p>' : '<h2>Editar perfil</h2>'}
    ${creating ? '' : `<div class="xp-banner xp-banner-edit" ${bannerPreview ? `style="background-image:url('${bannerPreview}')"` : ''}><button type="button" data-pick-banner>${svg(PATHS.camera)} Banner</button>${bannerPreview ? '<button type="button" data-clear-banner>Quitar</button>' : ''}</div>`}
    <div class="xp-pfp-pick">${avatarPreview}<div><button type="button" data-pick-avatar>${svg(PATHS.camera)} ${creating ? 'Subir foto' : 'Cambiar foto'}</button>${(ui.pfp || (ui.pfp !== null && mine.hasAvatar)) ? '<button type="button" class="xp-link-btn" data-clear-avatar>Quitar foto</button>' : ''}</div></div>
    <label class="xp-field"><span>Usuario</span><div class="xp-handle-input"><b>@</b><input name="handle" maxlength="20" autocomplete="off" autocapitalize="none" spellcheck="false" required></div><small>De 3 a 20 letras, números o guiones bajos.</small></label>
    <label class="xp-field"><span>Descripción <em>(opcional)</em></span><textarea name="bio" rows="3" maxlength="160" placeholder="Cuéntanos algo de ti…"></textarea></label>
    <p class="error" data-account-error role="alert">${escapeHtml(ui.accountError ?? '')}</p>
    <div class="xp-setup-actions">${creating ? '' : '<button type="button" data-cancel-edit>Cancelar</button>'}<button type="submit" class="xp-send">${creating ? 'Crear cuenta' : 'Guardar'}</button></div></form>`;
}

export function setupView(ctx) { return `<div class="xp-feed">${accountForm(ctx, { creating: true })}</div>`; }

export function profileView(ctx) {
  const { ui } = ctx; const { social } = state.run; const mine = profile();
  if (ui.editingProfile) return `<div class="xp-feed">${accountForm(ctx, { creating: false })}</div>`;
  const own = social.posts.filter((post) => post.own || post.reposted);
  const timeline = own.sort((a, b) => (b.repostedAt ?? b.minutes) - (a.repostedAt ?? a.minutes));
  const replies = social.posts.flatMap((post) => post.replies.filter((reply) => reply.own).map((reply) => ({ reply, post }))).sort((a, b) => b.reply.minutes - a.reply.minutes);
  const tab = ui.profileTab === 'replies' ? 'replies' : 'posts';
  const list = tab === 'replies'
    ? replies.map(({ reply, post }) => replyCard(reply, post, social.now, { toThread: true })).join('') || '<p class="empty xp-empty">Todavía no has respondido a nadie.</p>'
    : timeline.map((post) => postCard(post, social.now, { kicker: post.own ? '' : 'Compartiste' })).join('') || '<p class="empty xp-empty">Aún no has publicado ni compartido nada.</p>';
  return `<div class="xp-feed xp-profile"><div class="xp-banner" ${mine.hasBanner ? `style="background-image:url('${mediaUrl('banner')}')"` : ''}></div>
    <div class="xp-pf-top">${avatar({ own: true, handle: mine.handle, name: mine.name }, 'xp-av-lg')}<button type="button" class="xp-edit" data-edit-profile>Editar perfil</button></div>
    <div class="xp-pf-info"><h2>${escapeHtml(mine.name)}</h2><p class="xp-handle">${escapeHtml(mine.handle)}</p>${mine.bio ? `<p class="xp-bio">${rich(mine.bio)}</p>` : '<p class="xp-bio xp-muted">Sin descripción todavía.</p>'}
    <p class="xp-stats"><b>${own.filter((post) => post.own).length}</b> publicaciones · <b>${own.filter((post) => !post.own).length}</b> compartidas</p></div>
    <nav class="xp-ptabs"><button type="button" data-ptab="posts" class="${tab === 'posts' ? 'active' : ''}">Publicaciones</button><button type="button" data-ptab="replies" class="${tab === 'replies' ? 'active' : ''}">Respuestas</button></nav>${list}</div>`;
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

// Enlaza los eventos de feed, hilos, perfil, notificaciones y formularios. `ctx` aporta ui, rerender(), reload(), refresh() y el icono de detener.
export function bindFeed(screen, ctx) {
  const { ui } = ctx;
  const body = screen.querySelector('.app-body');
  // Un avatar que no carga (URL caída) vuelve al avatar de respaldo con la inicial. Un único oyente por pantalla.
  if (!screen.dataset.avatarFallback) {
    screen.dataset.avatarFallback = '1';
    screen.addEventListener('error', (event) => { const img = event.target; if (img instanceof HTMLImageElement && img.matches('[data-avatar]') && img.parentElement) img.parentElement.textContent = img.parentElement.dataset.letter ?? ''; }, true);
  }
  const fire = async (operation) => { try { state.run = await operation(); ctx.rerender(true); ctx.refresh(); } catch (error) { notify(error.message); } };

  screen.querySelector('[data-compose]')?.addEventListener('click', () => { ui.composing = !ui.composing; ctx.rerender(); screen.querySelector('#compose-form textarea')?.focus(); });
  screen.querySelector('[data-new-posts]')?.addEventListener('click', () => { ui.newPosts = 0; ctx.rerender(); body.scrollTop = 0; });
  screen.querySelectorAll('[data-clear-reply]').forEach((button) => { button.onclick = () => { ui.replyTo = null; ctx.rerender(true); }; });
  screen.querySelectorAll('[data-note-post]').forEach((button) => { button.onclick = () => { ui.nlTab = 'feed'; ui.thread = button.dataset.notePost; ui.replyTo = null; ctx.rerender(); body.scrollTop = 0; }; });
  screen.querySelector('[data-edit-profile]')?.addEventListener('click', () => { ui.editingProfile = true; ui.pfp = undefined; ui.banner = undefined; ui.accountError = ''; ctx.rerender(); });
  screen.querySelectorAll('[data-ptab]').forEach((button) => { button.onclick = () => { ui.profileTab = button.dataset.ptab; ctx.rerender(true); }; });

  screen.querySelectorAll('.xp-feed').forEach((feed) => feed.addEventListener('click', (event) => {
    const like = event.target.closest('[data-like]');
    if (like) { event.stopPropagation(); fire(() => api({ op: 'like', postId: like.dataset.like, replyId: like.dataset.likeReply })); return; }
    const share = event.target.closest('[data-repost]');
    if (share) { event.stopPropagation(); fire(() => api({ op: 'repost', postId: share.dataset.repost })); return; }
    const answer = event.target.closest('[data-reply-to]');
    if (answer) { ui.replyTo = { id: answer.dataset.replyTo, handle: answer.dataset.handle }; ctx.rerender(true); screen.querySelector('#reply-form textarea')?.focus(); return; }
    if (event.target.closest('button, a, form, input, textarea')) {
      const open = event.target.closest('[data-open]');
      if (open) { ui.thread = open.dataset.open; ui.replyTo = null; ui.nlTab = 'feed'; ctx.rerender(); body.scrollTop = 0; }
      return;
    }
    const card = event.target.closest('[data-thread], .xp[data-post]:not(.xp-full)');
    if (card) { ui.thread = card.dataset.thread ?? card.dataset.post; ui.replyTo = null; ui.nlTab = 'feed'; ctx.rerender(); body.scrollTop = 0; }
  }));

  // Cuenta: alta la primera vez y edición del perfil.
  const account = screen.querySelector('#account-form');
  if (account) {
    const mine = profile();
    account.elements.handle.value = ui.draftHandle ?? mine.handle.replace(/^@/, '');
    account.elements.bio.value = ui.draftBio ?? mine.bio ?? '';
    const keep = () => { ui.draftHandle = account.elements.handle.value; ui.draftBio = account.elements.bio.value; };
    account.addEventListener('input', keep);
    const pick = async (key, width, height) => { keep(); const url = await pickImage(width, height); if (url !== undefined) { ui[key] = url; ctx.rerender(true); } };
    account.querySelector('[data-pick-avatar]').onclick = () => pick('pfp', 256, 256);
    account.querySelector('[data-pick-banner]')?.addEventListener('click', () => pick('banner', 900, 300));
    account.querySelector('[data-clear-avatar]')?.addEventListener('click', () => { keep(); ui.pfp = null; ctx.rerender(true); });
    account.querySelector('[data-clear-banner]')?.addEventListener('click', () => { keep(); ui.banner = null; ctx.rerender(true); });
    account.querySelector('[data-cancel-edit]')?.addEventListener('click', () => { ui.editingProfile = false; ui.draftHandle = undefined; ui.draftBio = undefined; ctx.rerender(); });
    account.onsubmit = async (event) => {
      event.preventDefault();
      const payload = { op: 'profile', handle: account.elements.handle.value.trim(), bio: account.elements.bio.value };
      if (ui.pfp !== undefined) payload.avatar = ui.pfp;
      if (ui.banner !== undefined) payload.banner = ui.banner;
      try {
        const creating = !profile().created;
        state.run = await api(payload);
        ui.pfp = undefined; ui.banner = undefined; ui.draftHandle = undefined; ui.draftBio = undefined; ui.accountError = ''; ui.editingProfile = false;
        if (creating) { ui.nlTab = 'feed'; enterFeed(ui); notify('¡Cuenta creada! Bienvenida a NorthLife.'); }
        ctx.rerender(); ctx.refresh();
      } catch (error) { ui.accountError = error.message; const slot = account.querySelector('[data-account-error]'); if (slot) slot.textContent = error.message; }
    };
  }

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
