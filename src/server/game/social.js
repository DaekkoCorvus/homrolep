// NorthLife: la red social del mundo. El modelo (prompt «social») propone publicaciones con su hora, likes y respuestas, también de
// cuentas inventadas; este módulo decide qué se acepta y cuándo se ve. Todo es determinista una vez recibida la propuesta:
// - una publicación o respuesta solo se VE cuando la hora del mundo alcanza la que el modelo indicó;
// - los likes están limitados por la popularidad de la cuenta (que fija el motor, no el modelo) y crecen poco a poco;
// - las cuentas reservadas (personajes que el jugador aún no conoce, el propio jugador) no se pueden suplantar.
import { randomUUID } from 'node:crypto';
import { minutesOfWorld, scheduleFor } from './npcs.js';
import { advanceTime } from './clock.js';

export const MAX_TEXT = 280;
export const GENERATION_GAP = 600;           // minutos de juego entre generaciones espontáneas (≈ 1–2 al día)
const PAST = 24 * 60;                        // hasta cuánto hacia atrás puede fechar una publicación el modelo
const FUTURE = 30 * 60;                      // y hacia delante
const RAMP = 180;                            // minutos que tarda una publicación en alcanzar todos sus likes
const MAX_POSTS = 120; const MAX_REPLIES = 8; const MAX_ACCOUNTS = 150; const MAX_NOTIFICATIONS = 60;
const HANDLE = /^@[A-Za-z0-9_]{3,20}$/;

const pad = (value) => String(value).padStart(2, '0');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const whole = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
export const handleKey = (handle) => String(handle ?? '').toLowerCase();

export const keyOfMinutes = (minutes) => {
  const rest = ((minutes % 1440) + 1440) % 1440;
  return `DAY_${Math.floor(minutes / 1440) + 1}_${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
};

export function playerHandle(player) {
  const base = String(player.name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
  return `@${base.length >= 3 ? base : `${base}Viajero`.slice(0, 20)}`;
}

// Likes máximos que puede tener una publicación según la popularidad (0–100) de quien la escribe.
export const maxLikes = (popularity) => Math.round(8 + (clamp(popularity, 0, 100) / 100) ** 3 * 30000);
// El jugador empieza siendo un desconocido: su alcance sube con su reputación.
export const playerPopularity = (player) => clamp(5 + whole(player.reputation), 0, 60);

export const emptySocial = () => ({ posts: [], accounts: {}, notifications: [], generatedAt: null });

// Partidas anteriores guardaban {id, author, npcId, text, time}; se convierten sin perder nada.
export function migrateSocial(social, player) {
  const base = { ...emptySocial(), ...(social ?? {}) };
  base.accounts ??= {}; base.notifications ??= [];
  base.posts = (base.posts ?? []).map((post) => {
    if (post.handle) return post;
    const when = /^DAY_(\d+)_(\d{2}):(\d{2})$/.exec(post.time ?? '');
    const own = !post.npcId && post.author === player.name;
    return {
      id: post.id ?? randomUUID(), handle: own ? playerHandle(player) : `@${String(post.author ?? 'Anonimo').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20) || 'Anonimo'}`,
      name: post.author ?? player.name, npcId: post.npcId, own, text: post.text, time: post.time, minutes: when ? (Number(when[1]) - 1) * 1440 + Number(when[2]) * 60 + Number(when[3]) : 0,
      likes: 0, reposts: 0, replies: []
    };
  });
  return base;
}

// Cuentas conocidas: las del canon mandan sobre cualquier cosa que el modelo haya dicho de ellas.
export function accountDirectory(social, seeds = []) {
  const directory = new Map();
  for (const [key, account] of Object.entries(social.accounts ?? {})) directory.set(key, { ...account });
  for (const seed of seeds) directory.set(handleKey(seed.handle), { handle: seed.handle, name: seed.name, popularity: seed.popularity, verified: seed.verified === true, bio: seed.bio ?? '', seed: true });
  return directory;
}

// "HH:MM" + "dia" (-1 ayer, 0 hoy, 1 mañana) → minutos absolutos del mundo, siempre dentro de una ventana razonable.
export function resolveWhen(raw, world, fallback = minutesOfWorld(world)) {
  const now = minutesOfWorld(world);
  const parsed = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(raw?.hora ?? '').trim());
  if (!parsed) return clamp(fallback, now - PAST, now + FUTURE);
  const hour = Number(parsed[1]); const minute = Number(parsed[2] ?? 0);
  if (hour > 23 || minute > 59) return clamp(fallback, now - PAST, now + FUTURE);
  const offset = Number.isInteger(Number(raw?.dia)) ? Number(raw.dia) : 0;
  return clamp((world.day - 1 + offset) * 1440 + hour * 60 + minute, now - PAST, now + FUTURE);
}

// Resuelve (o crea) la cuenta de un autor propuesto por el modelo. Devuelve null si no se puede usar.
function authorOf(rawHandle, rawName, rawPopularity, context) {
  const handle = typeof rawHandle === 'string' ? rawHandle.trim() : '';
  const key = handleKey(handle);
  if (!HANDLE.test(handle) || key === handleKey(context.playerHandle) || context.reserved.has(key)) return null;
  const known = context.directory.get(key);
  if (known) return { account: known, npcId: context.contacts.get(key)?.id };
  const npc = context.contacts.get(key);
  const account = { handle, name: npc ? npc.name : (text(rawName, 30) || handle.slice(1)), popularity: clamp(rawPopularity == null ? (npc ? 25 : 10) : whole(rawPopularity), 0, 90), verified: false, ...(npc ? { npcId: npc.id } : {}) };
  context.directory.set(key, account);
  return { account, npcId: npc?.id };
}

function cleanReplies(rawReplies, post, context, { floor, ceiling, defaultStep = 9 }) {
  const out = [];
  for (const [index, raw] of (Array.isArray(rawReplies) ? rawReplies : []).slice(0, MAX_REPLIES).entries()) {
    const author = authorOf(raw?.usuario, raw?.nombre, raw?.popularidad, context);
    const body = text(raw?.texto, MAX_TEXT);
    if (!author || !body) continue;
    const minutes = clamp(resolveWhen(raw, context.world, floor + (index + 1) * defaultStep), floor, ceiling);
    out.push({
      id: randomUUID(), handle: author.account.handle, name: author.account.name, ...(author.npcId ? { npcId: author.npcId } : {}), text: body,
      minutes, time: keyOfMinutes(minutes), likes: clamp(whole(raw?.likes), 0, Math.min(post.likes || maxLikes(author.account.popularity), maxLikes(author.account.popularity))), liked: false,
      ...(typeof raw?.a === 'string' && HANDLE.test(raw.a.trim()) ? { inReplyTo: raw.a.trim() } : {})
    });
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

// Contexto común de validación.
export function validationContext(run, { npcs, seeds = [] }) {
  const social = migrateSocial(run.social, run.player);
  const directory = accountDirectory(social, seeds);
  const contacts = new Map(); const reserved = new Set();
  for (const npc of npcs.values()) {
    const handle = npc.contact?.handle; if (!handle) continue;
    if (run.relationships?.[npc.id]?.added) contacts.set(handleKey(handle), npc); else reserved.add(handleKey(handle));
  }
  return { world: run.world, directory, contacts, reserved, playerHandle: playerHandle(run.player) };
}

const directoryToAccounts = (directory, contacts) => {
  const entries = [...directory.entries()].filter(([, account]) => !account.seed);
  const trimmed = entries.length > MAX_ACCOUNTS ? entries.filter(([key]) => contacts.has(key)).concat(entries.filter(([key]) => !contacts.has(key)).slice(-(MAX_ACCOUNTS - contacts.size))) : entries;
  return Object.fromEntries(trimmed);
};

// Publicaciones propuestas por el modelo (prompt social, modo «post») → publicaciones programadas.
export function applyGeneratedPosts(run, raw, options) {
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const context = validationContext(next, options);
  const recent = new Set(next.social.posts.slice(0, 60).map((post) => post.text.toLowerCase()));
  const fresh = [];
  for (const item of (Array.isArray(raw) ? raw : []).slice(0, 14)) {
    const author = authorOf(item?.usuario, item?.nombre, item?.popularidad, context);
    const body = text(item?.texto, MAX_TEXT);
    if (!author || !body || recent.has(body.toLowerCase())) continue;
    recent.add(body.toLowerCase());
    const minutes = resolveWhen(item, next.world);
    const cap = maxLikes(author.account.popularity);
    const likes = clamp(whole(item?.likes), 0, cap);
    const post = {
      id: randomUUID(), handle: author.account.handle, name: author.account.name, ...(author.npcId ? { npcId: author.npcId } : {}), text: body,
      minutes, time: keyOfMinutes(minutes), likes, reposts: clamp(whole(item?.reposts), 0, likes), liked: false, replies: []
    };
    post.replies = cleanReplies(item?.respuestas, post, context, { floor: minutes + 1, ceiling: minutes + 2880 });
    fresh.push(post);
  }
  next.social.posts = [...fresh, ...next.social.posts].sort((a, b) => b.minutes - a.minutes).slice(0, MAX_POSTS);
  next.social.accounts = directoryToAccounts(context.directory, context.contacts);
  next.social.generatedAt = minutesOfWorld(next.world);
  return next;
}

export const feedDue = (run) => run.social?.generatedAt == null || minutesOfWorld(run.world) - run.social.generatedAt >= GENERATION_GAP;

// --- Acciones del jugador ---------------------------------------------------------------------------------------------------
function assertFree(run) {
  if (run.encounter) throw Object.assign(new Error('Estás en plena conversación. Despídete antes de hacer otra cosa.'), { code: 'ENCOUNTER_ACTIVE' });
}
function playerEntry(next, body, extra = {}) {
  const minutes = minutesOfWorld(next.world);
  return { id: randomUUID(), handle: playerHandle(next.player), name: next.player.name, own: true, text: body, minutes, time: keyOfMinutes(minutes), likes: 0, liked: false, ...extra };
}
function cleanBody(value) {
  const body = text(value, MAX_TEXT);
  if (!body) throw new Error('El mensaje está vacío.');
  return body;
}

export function publishPlayerPost(run, value) {
  assertFree(run);
  const body = cleanBody(value);
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  next.world = advanceTime(next.world, 1);
  const post = playerEntry(next, body, { reposts: 0, replies: [] });
  next.social.posts.unshift(post);
  next.updatedAt = new Date().toISOString();
  next.eventLog.push({ time: post.time, type: 'social_post_created', data: { text: body } });
  return { run: next, post };
}

const visibleOf = (post, now) => post.minutes <= now;

export function publishPlayerReply(run, postId, value, replyToId = null) {
  assertFree(run);
  const body = cleanBody(value);
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const now = minutesOfWorld(next.world);
  const post = next.social.posts.find((item) => item.id === postId);
  if (!post || !visibleOf(post, now)) throw new Error('Esa publicación ya no está disponible.');
  const target = replyToId ? post.replies.find((item) => item.id === replyToId && item.minutes <= now) : null;
  if (replyToId && !target) throw new Error('Ese comentario ya no está disponible.');
  next.world = advanceTime(next.world, 1);
  const reply = playerEntry(next, body, { inReplyTo: (target ?? post).handle });
  post.replies.push(reply);
  next.updatedAt = new Date().toISOString();
  next.eventLog.push({ time: reply.time, type: 'social_reply_created', data: { text: body, postId } });
  return { run: next, post, reply, target };
}

// Reacción de la red (prompt social, modo «reply») a lo que acaba de hacer el jugador.
export function applyReactions(run, postId, raw, options) {
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const post = next.social.posts.find((item) => item.id === postId);
  if (!post) return next;
  const context = validationContext(next, options);
  const now = minutesOfWorld(next.world);
  const mine = playerHandle(next.player);
  const known = new Set([post.handle, mine, ...post.replies.map((reply) => reply.handle)].map(handleKey));
  const fresh = cleanReplies(raw?.respuestas, post, context, { floor: now + 1, ceiling: now + 1440, defaultStep: 12 });
  for (const reply of fresh) {
    const wanted = reply.inReplyTo && known.has(handleKey(reply.inReplyTo)) ? reply.inReplyTo : mine;
    reply.inReplyTo = wanted;
    known.add(handleKey(reply.handle));
    if (post.own || handleKey(wanted) === handleKey(mine)) {
      next.social.notifications.unshift({ id: randomUUID(), kind: 'reply', postId: post.id, replyId: reply.id, handle: reply.handle, name: reply.name, text: reply.text.slice(0, 120), minutes: reply.minutes, time: reply.time, onYourPost: post.own === true, read: false });
    }
  }
  post.replies = [...post.replies, ...fresh].sort((a, b) => a.minutes - b.minutes);
  if (post.own) {
    const cap = maxLikes(playerPopularity(next.player));
    post.likes = clamp(post.likes + clamp(whole(raw?.likes), 0, cap), 0, cap);
    post.reposts = clamp(post.reposts + clamp(whole(raw?.reposts), 0, cap), 0, post.likes);
  }
  next.social.notifications = next.social.notifications.slice(0, MAX_NOTIFICATIONS);
  next.social.accounts = directoryToAccounts(context.directory, context.contacts);
  return next;
}

export function toggleLike(run, postId, replyId = null) {
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const now = minutesOfWorld(next.world);
  const post = next.social.posts.find((item) => item.id === postId);
  const entry = replyId ? post?.replies.find((item) => item.id === replyId) : post;
  if (!entry || entry.minutes > now) throw new Error('Esa publicación ya no está disponible.');
  entry.liked = !entry.liked;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function markNotificationsRead(run) {
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const now = minutesOfWorld(next.world);
  for (const item of next.social.notifications) if (item.minutes <= now) item.read = true;
  return next;
}

// --- Lo que ve el cliente ---------------------------------------------------------------------------------------------------
// Solo lo ya publicado; los likes crecen con el tiempo hasta su valor final; el «me gusta» del jugador suma uno.
export function socialView(run, { dev = false, seeds = [] } = {}) {
  const social = migrateSocial(run.social, run.player);
  const now = minutesOfWorld(run.world);
  const grow = (entry) => Math.round((entry.likes ?? 0) * clamp((now - entry.minutes) / RAMP, 0.12, 1)) + (entry.liked ? 1 : 0);
  const directory = accountDirectory(social, seeds);
  const verified = (handle) => directory.get(handleKey(handle))?.verified === true;
  const reply = ({ id, handle, name, npcId, own, text: body, minutes, time, inReplyTo, liked, ...rest }) => ({ id, handle, name, verified: verified(handle), ...(npcId ? { npcId } : {}), own: own === true, text: body, minutes, time, liked: liked === true, likes: grow({ likes: rest.likes, minutes, liked }), ...(inReplyTo ? { inReplyTo } : {}) });
  const posts = social.posts.filter((post) => visibleOf(post, now)).map((post) => ({
    id: post.id, handle: post.handle, name: post.name, ...(post.npcId ? { npcId: post.npcId } : {}), own: post.own === true, text: post.text, minutes: post.minutes, time: post.time,
    liked: post.liked === true, likes: grow(post), reposts: Math.round((post.reposts ?? 0) * clamp((now - post.minutes) / RAMP, 0.12, 1)),
    replies: post.replies.filter((item) => item.minutes <= now).map(reply), verified: verified(post.handle)
  })).sort((a, b) => b.minutes - a.minutes);
  const notifications = social.notifications.filter((item) => item.minutes <= now).map(({ id, kind, postId, replyId, handle, name, text: body, minutes, time, onYourPost, read }) => ({ id, kind, postId, replyId, handle, name, text: body, minutes, time, onYourPost, read }));
  return {
    posts, notifications, unread: notifications.filter((item) => !item.read).length, now, handle: playerHandle(run.player),
    ...(dev ? { scheduled: social.posts.filter((post) => !visibleOf(post, now)).length, generatedAt: social.generatedAt, accounts: Object.keys(social.accounts).length } : {})
  };
}

// --- Datos para el prompt social --------------------------------------------------------------------------------------------
// El modelo recibe las cuentas conocidas (con la popularidad que fija el motor), los contactos del jugador con su personalidad y
// lo ya publicado, para no repetirse. Las cuentas de personajes que el jugador aún no conoce no aparecen.
export function socialInput(run, mode, { npcs, seeds = [], places = [], ahora, extra = {} }) {
  const social = migrateSocial(run.social, run.player);
  const now = minutesOfWorld(run.world);
  const directory = accountDirectory(social, seeds);
  const contactNpcs = [...npcs.values()].filter((npc) => run.relationships?.[npc.id]?.added);
  const contactKeys = new Set(contactNpcs.map((npc) => handleKey(npc.contact?.handle)));
  const accounts = [...directory.values()].filter((account) => !contactKeys.has(handleKey(account.handle)))
    .sort((a, b) => Number(b.seed === true) - Number(a.seed === true) || b.popularity - a.popularity).slice(0, 30)
    .map((account) => ({ usuario: account.handle, nombre: account.name, popularidad: account.popularity, verificado: account.verified === true, descripcion: account.bio || undefined }));
  const contacts = contactNpcs.map((npc) => ({
    usuario: npc.contact.handle, nombre: npc.name, popularidad: directory.get(handleKey(npc.contact.handle))?.popularity ?? 25, contactoDelJugador: true,
    resumen: npc.summary, personalidad: npc.personality, haciendoAhora: scheduleFor(npc, run.world)?.activity ?? 'fuera de su horario habitual'
  }));
  const recent = social.posts.filter((post) => post.minutes <= now + 60).slice(0, 12).map((post) => ({ usuario: post.handle, hora: post.time, texto: post.text }));
  return {
    mode, ahora, dia: run.world.day, ciudad: 'Porta Magna', lugares: places, cuentas: [...contacts, ...accounts], recientes: recent,
    jugador: { usuario: playerHandle(run.player), nombre: run.player.name, popularidad: playerPopularity(run.player) }, ...extra
  };
}

// El hilo completo (publicación + respuestas ya visibles) para que el modelo reaccione con contexto.
export const threadFor = (post, now) => ({
  id: post.id, usuario: post.handle, texto: post.text, hora: post.time,
  respuestas: post.replies.filter((item) => item.minutes <= now).map((item) => ({ id: item.id, usuario: item.handle, a: item.inReplyTo, texto: item.text }))
});
