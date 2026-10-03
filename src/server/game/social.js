// NorthLife: la red social del mundo. El modelo (prompt «social») propone publicaciones con su hora, likes y respuestas, también de
// cuentas inventadas; este módulo decide qué se acepta y cuándo se ve. Todo es determinista una vez recibida la propuesta:
// - una publicación o respuesta solo se VE cuando la hora del mundo alcanza la que el modelo indicó;
// - los likes están limitados por la popularidad de la cuenta (que fija el motor, no el modelo) y crecen poco a poco;
// - las cuentas reservadas (personajes que el jugador aún no conoce, el propio jugador) no se pueden suplantar.
import { randomUUID } from 'node:crypto';
import { minutesOfWorld, scheduleFor } from './npcs.js';
import { advanceTime } from './clock.js';
import { socialNotices } from '../ai/context/notices.js';

export const MAX_TEXT = 280;
export const GENERATION_GAP = 600;           // minutos de juego entre generaciones espontáneas (≈ 1–2 al día)
const PAST = 24 * 60;                        // hasta cuánto hacia atrás puede fechar una publicación el modelo
const FUTURE = 30 * 60;                      // y hacia delante
const RAMP = 180;                            // minutos que tarda una publicación en alcanzar todos sus likes
export const POST_MINUTES = 5;               // publicar cuesta unos minutos: en ese tiempo ya llegan las primeras reacciones
export const REPLY_MINUTES = 3;
export const REFRESH_GAP = 120;              // si el jugador publica, el feed se renueva si pasaron al menos 2 h desde la última generación
const MAX_BIO = 160; const MAX_AVATAR = 200_000; const MAX_BANNER = 320_000;
const IMAGE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const MAX_POSTS = 120; const MAX_REPLIES = 12; const MAX_ACCOUNTS = 150; const MAX_NOTIFICATIONS = 60;
export const MAX_GENERATED_POSTS = 14;       // publicaciones que el motor acepta por generación (el prompt social pide el mismo máximo)
const MAX_NEW_ACCOUNTS = 40;                 // cuentas nuevas que se registran como máximo por generación
const SAMPLES = 2; const SAMPLE_CHARS = 140; // muestra de la voz de cada cuenta que se conserva
// Lo que se envía al modelo en cada generación: tope fijo, no crece con la partida.
export const PROMPT_LIMITS = { seeds: 4, contacts: 8, popular: 4, recent: 5, random: 5, thread: 8, posts: 12, excerpt: 160 };
const HANDLE = /^@[A-Za-z0-9_]{3,20}$/;

const pad = (value) => String(value).padStart(2, '0');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const whole = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
export const handleKey = (handle) => String(handle ?? '').toLowerCase();

// Cuentas generadas: cada una conserva una identidad estable (usuario, nombre, popularidad), el avatar que el servidor le asignó
// y una muestra de lo último que escribió (su «voz»); eso es todo lo que se guarda. Los avatares salen de un catálogo local
// (socialCatalog.js) y los asigna el servidor: el modelo ni los ve ni los elige.
const hash32 = (value) => { let h = 0x811c9dc5; for (const char of String(value)) { h ^= char.charCodeAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const seededRandom = (seed) => {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

// Avatar «aleatorio» pero estable: se elige por el usuario y la partida, prefiriendo uno que nadie más use en esa partida.
export function pickAvatar(catalog, used, runId, handle) {
  if (!catalog?.length) return null;
  const start = hash32(`${runId}:${handleKey(handle)}`) % catalog.length;
  for (let step = 0; step < catalog.length; step++) {
    const url = catalog[(start + step) % catalog.length];
    if (!used.has(url)) return url;
  }
  return catalog[start];
}

// Partidas anteriores: a las cuentas guardadas sin avatar se les asigna uno al cargar (solo a ellas; nada más cambia). Si no hay
// catálogo, la partida se devuelve tal cual y la interfaz usa el avatar de respaldo.
export function withAvatars(run, avatars, seeds = []) {
  const accounts = run?.social?.accounts;
  if (!avatars?.length || !accounts) return run;
  const seedKeys = new Set(seeds.map((seed) => handleKey(seed.handle)));
  const missing = Object.entries(accounts).filter(([key, account]) => !account.avatar && !account.npcId && !seedKeys.has(key));
  if (!missing.length) return run;
  const used = new Set(Object.values(accounts).map((account) => account.avatar).filter(Boolean));
  const next = { ...run, social: { ...run.social, accounts: { ...accounts } } };
  for (const [key, account] of missing) {
    const avatar = pickAvatar(avatars, used, run.id, account.handle ?? key);
    if (avatar) { used.add(avatar); next.social.accounts[key] = { ...account, avatar }; }
  }
  return next;
}

// Solo estos campos se guardan por cuenta; cualquier otra cosa que llegue se descarta.
const cleanAccount = (account) => ({
  handle: account.handle, name: text(account.name, 30) || String(account.handle).slice(1), popularity: clamp(whole(account.popularity), 0, 100), verified: account.verified === true,
  ...(account.npcId ? { npcId: account.npcId } : {}), ...(typeof account.avatar === 'string' && account.avatar ? { avatar: account.avatar } : {}),
  ...(account.samples?.length ? { samples: account.samples.slice(0, SAMPLES).map((sample) => text(sample, SAMPLE_CHARS)).filter(Boolean) } : {}),
  ...(Number.isFinite(account.first) ? { first: account.first } : {}), ...(Number.isFinite(account.seen) ? { seen: account.seen } : {})
});
// Anota actividad reciente de una cuenta (las canónicas no se guardan en la partida).
function remember(account, body, minutes) {
  if (account.seed) return;
  const sample = text(body, SAMPLE_CHARS);
  account.samples = [sample, ...(account.samples ?? []).filter((item) => item !== sample)].slice(0, SAMPLES);
  account.seen = Math.max(account.seen ?? 0, minutes);
}

export const keyOfMinutes = (minutes) => {
  const rest = ((minutes % 1440) + 1440) % 1440;
  return `DAY_${Math.floor(minutes / 1440) + 1}_${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
};

export function playerHandle(player) {
  if (HANDLE.test(player.handle ?? '')) return player.handle;
  const base = String(player.name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
  return `@${base.length >= 3 ? base : `${base}Viajero`.slice(0, 20)}`;
}

// Likes máximos que puede tener una publicación según la popularidad (0–100) de quien la escribe.
export const maxLikes = (popularity) => Math.round(8 + (clamp(popularity, 0, 100) / 100) ** 3 * 30000);
// El jugador empieza siendo un desconocido: su alcance sube con su reputación.
export const playerPopularity = (player) => clamp(5 + whole(player.reputation), 0, 60);

// Respuestas que debería recibir una publicación del jugador: al menos una o dos y muchas más cuanto más popular es.
export function expectedReplies(popularity) {
  const pop = clamp(popularity, 0, 100);
  return { min: pop < 12 ? 1 : Math.round(1 + pop / 12), max: Math.min(MAX_REPLIES, Math.round(2 + pop / 6)) };
}

export const emptyProfile = () => ({ created: false, bio: '', avatar: null, banner: null, v: 0 });
export const emptySocial = () => ({ posts: [], accounts: {}, notifications: [], generatedAt: null, profile: emptyProfile() });
// Publicaciones del jugador (o que repostea) nunca se pierden al recortar el feed.
const trimPosts = (posts) => {
  const sorted = posts.sort((a, b) => b.minutes - a.minutes);
  const keep = sorted.filter((post) => post.own || post.reposted);
  const rest = sorted.filter((post) => !(post.own || post.reposted)).slice(0, Math.max(20, MAX_POSTS - keep.length));
  return [...keep, ...rest].sort((a, b) => b.minutes - a.minutes);
};

// Partidas anteriores guardaban {id, author, npcId, text, time}; se convierten sin perder nada.
export function migrateSocial(social, player) {
  const base = { ...emptySocial(), ...(social ?? {}) };
  base.accounts ??= {}; base.notifications ??= []; base.profile = { ...emptyProfile(), ...(base.profile ?? {}) };
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
  for (const seed of seeds) directory.set(handleKey(seed.handle), { handle: seed.handle, name: seed.name, popularity: seed.popularity, verified: seed.verified === true, bio: seed.bio ?? '', ...(seed.avatar ? { avatar: seed.avatar } : {}), seed: true });
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

// Resuelve (o registra) la cuenta de un autor propuesto por el modelo. Devuelve null si no se puede usar. Las cuentas nuevas reciben
// su avatar del catálogo en este momento y ya no se vuelve a sortear; hay un máximo de cuentas nuevas por generación.
function authorOf(rawHandle, rawName, rawPopularity, context) {
  const handle = typeof rawHandle === 'string' ? rawHandle.trim() : '';
  const key = handleKey(handle);
  if (!HANDLE.test(handle) || key === handleKey(context.playerHandle) || context.reserved.has(key)) return null;
  const known = context.directory.get(key);
  if (known) return { account: known, npcId: context.contacts.get(key)?.id };
  const npc = context.contacts.get(key);
  if (!npc && context.created >= MAX_NEW_ACCOUNTS) return null;
  const account = { handle, name: npc ? npc.name : (text(rawName, 30) || handle.slice(1)), popularity: clamp(rawPopularity == null ? (npc ? 25 : 10) : whole(rawPopularity), 0, 90), verified: false, first: context.minutes, ...(npc ? { npcId: npc.id } : {}) };
  if (!npc) {
    context.created += 1;
    const avatar = pickAvatar(context.avatars, context.usedAvatars, context.runId, handle);
    if (avatar) { account.avatar = avatar; context.usedAvatars.add(avatar); }
  }
  context.directory.set(key, account);
  return { account, npcId: npc?.id };
}

function cleanReplies(rawReplies, post, context, { floor, ceiling, defaultStep = 9 }) {
  const out = [];
  for (const [index, raw] of (Array.isArray(rawReplies) ? rawReplies : []).slice(0, MAX_REPLIES).entries()) {
    const body = text(raw?.texto, MAX_TEXT);
    const author = body ? authorOf(raw?.usuario, raw?.nombre, raw?.popularidad, context) : null;
    if (!author) continue;
    const minutes = clamp(resolveWhen(raw, context.world, floor + (index + 1) * defaultStep), floor, ceiling);
    remember(author.account, body, minutes);
    out.push({
      id: randomUUID(), handle: author.account.handle, name: author.account.name, ...(author.npcId ? { npcId: author.npcId } : {}), text: body,
      minutes, time: keyOfMinutes(minutes), likes: clamp(whole(raw?.likes), 0, Math.min(post.likes || maxLikes(author.account.popularity), maxLikes(author.account.popularity))), liked: false,
      ...(typeof raw?.a === 'string' && HANDLE.test(raw.a.trim()) ? { inReplyTo: raw.a.trim() } : {})
    });
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

// Contexto común de validación.
export function validationContext(run, { npcs, seeds = [], avatars = [] }) {
  const social = migrateSocial(run.social, run.player);
  const directory = accountDirectory(social, seeds);
  const contacts = new Map(); const reserved = new Set();
  for (const npc of npcs.values()) {
    const handle = npc.contact?.handle; if (!handle) continue;
    if (run.relationships?.[npc.id]?.added) contacts.set(handleKey(handle), npc); else reserved.add(handleKey(handle));
  }
  return {
    world: run.world, directory, contacts, reserved, playerHandle: playerHandle(run.player), avatars, runId: run.id, created: 0, minutes: minutesOfWorld(run.world),
    usedAvatars: new Set([...directory.values()].map((account) => account.avatar).filter(Boolean))
  };
}

// Cuentas que siguen apareciendo en el feed (publicaciones, respuestas, notificaciones): no se descartan al recortar el registro.
export const referencedHandles = (social) => new Set([
  ...social.posts.flatMap((post) => [handleKey(post.handle), ...post.replies.map((reply) => handleKey(reply.handle))]),
  ...social.notifications.map((item) => handleKey(item.handle))
]);

// Registro persistente de cuentas generadas, con tamaño máximo: primero se conservan los contactos, luego las que aún se ven en el feed
// y por último las más recientes.
const directoryToAccounts = (directory, contacts, referenced = new Set()) => {
  const entries = [...directory.entries()].filter(([, account]) => !account.seed).map(([key, account]) => [key, cleanAccount(account)]);
  if (entries.length <= MAX_ACCOUNTS) return Object.fromEntries(entries);
  const rank = ([key]) => (contacts.has(key) ? 2 : referenced.has(key) ? 1 : 0);
  return Object.fromEntries(entries.sort((a, b) => rank(b) - rank(a) || (b[1].seen ?? 0) - (a[1].seen ?? 0)).slice(0, MAX_ACCOUNTS));
};

// Publicaciones propuestas por el modelo (prompt social, modo «post») → publicaciones programadas.
export function applyGeneratedPosts(run, raw, options) {
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const context = validationContext(next, options);
  const recent = new Set(next.social.posts.slice(0, 60).map((post) => post.text.toLowerCase()));
  const fresh = [];
  for (const item of (Array.isArray(raw) ? raw : []).slice(0, MAX_GENERATED_POSTS)) {
    const body = text(item?.texto, MAX_TEXT);
    if (!body || recent.has(body.toLowerCase())) continue;
    const author = authorOf(item?.usuario, item?.nombre, item?.popularidad, context);
    if (!author) continue;
    recent.add(body.toLowerCase());
    const minutes = resolveWhen(item, next.world);
    remember(author.account, body, minutes);
    const cap = maxLikes(author.account.popularity);
    const likes = clamp(whole(item?.likes), 0, cap);
    const post = {
      id: randomUUID(), handle: author.account.handle, name: author.account.name, ...(author.npcId ? { npcId: author.npcId } : {}), text: body,
      minutes, time: keyOfMinutes(minutes), likes, reposts: clamp(whole(item?.reposts), 0, likes), liked: false, replies: []
    };
    fresh.push({ post, replies: item?.respuestas });
  }
  for (const entry of fresh) entry.post.replies = cleanReplies(entry.replies, entry.post, context, { floor: entry.post.minutes + 1, ceiling: entry.post.minutes + 2880 });
  next.social.posts = trimPosts([...fresh.map((entry) => entry.post), ...next.social.posts]);
  next.social.accounts = directoryToAccounts(context.directory, context.contacts, referencedHandles(next.social));
  next.social.generatedAt = minutesOfWorld(next.world);
  return next;
}

// Herramienta de desarrollo: restablece el feed. Borra todas las publicaciones (también las del jugador), las cuentas registradas por el motor
// (con sus avatares asignados), las notificaciones y el contador de generaciones; la siguiente actividad vuelve a generarlo desde cero.
// Se conserva todo lo demás: la cuenta del jugador (usuario, foto, banner, descripción), contactos, relaciones y el resto de la partida.
export function wipeFeed(run) {
  const next = structuredClone(run);
  const social = migrateSocial(next.social, next.player);
  const removed = { posts: social.posts.length, accounts: Object.keys(social.accounts).length, notifications: social.notifications.length };
  next.social = { ...emptySocial(), profile: social.profile };
  next.updatedAt = new Date().toISOString();
  return { run: next, removed };
}

export const feedDue = (run, gap = GENERATION_GAP) => run.social?.generatedAt == null || minutesOfWorld(run.world) - run.social.generatedAt >= gap;

// --- Cuenta del jugador -----------------------------------------------------------------------------------------------------
// Al abrir NorthLife por primera vez el jugador crea su cuenta: usuario, foto, descripción y, opcionalmente, un banner.
function checkImage(value, max, label) {
  if (typeof value !== 'string' || !IMAGE.test(value) || value.length > max) throw new Error(`La imagen de ${label} no es válida o pesa demasiado.`);
  return value;
}

export function saveProfile(run, input, { npcs, seeds = [] }) {
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const profile = next.social.profile;
  const wanted = String(input?.handle ?? '').trim();
  const handle = wanted.startsWith('@') ? wanted : `@${wanted}`;
  if (!HANDLE.test(handle)) throw new Error('El usuario debe tener entre 3 y 20 letras, números o guiones bajos.');
  const old = playerHandle(next.player);
  const taken = new Set([...seeds.map((seed) => handleKey(seed.handle)), ...Object.keys(next.social.accounts), ...[...npcs.values()].map((npc) => handleKey(npc.contact?.handle)).filter(Boolean)]);
  if (handleKey(handle) !== handleKey(old) && taken.has(handleKey(handle))) throw new Error('Ese usuario no está disponible.');
  if (!profile.created && handleKey(handle) === handleKey(old) && taken.has(handleKey(handle))) throw new Error('Ese usuario no está disponible.');
  if (input?.bio !== undefined) profile.bio = text(input.bio, MAX_BIO);
  if (input?.avatar !== undefined) profile.avatar = input.avatar === null ? null : checkImage(input.avatar, MAX_AVATAR, 'perfil');
  if (input?.banner !== undefined) profile.banner = input.banner === null ? null : checkImage(input.banner, MAX_BANNER, 'banner');
  if (input?.avatar !== undefined || input?.banner !== undefined) profile.v += 1;
  const first = !profile.created;
  profile.created = true;
  next.player.handle = handle;
  if (handleKey(old) !== handleKey(handle)) {
    for (const post of next.social.posts) {
      if (post.own) post.handle = handle;
      for (const reply of post.replies) {
        if (reply.own) reply.handle = handle;
        if (handleKey(reply.inReplyTo) === handleKey(old)) reply.inReplyTo = handle;
      }
    }
  }
  next.updatedAt = new Date().toISOString();
  if (first) next.eventLog.push({ time: keyOfMinutes(minutesOfWorld(next.world)), type: 'social_account_created', data: { handle } });
  return next;
}

export function profileMedia(run, which) {
  const value = migrateSocial(run.social, run.player).profile[which];
  const parsed = /^data:(image\/(?:webp|png|jpeg));base64,(.+)$/.exec(value ?? '');
  return parsed ? { mime: parsed[1], buffer: Buffer.from(parsed[2], 'base64') } : null;
}

// --- Acciones del jugador ---------------------------------------------------------------------------------------------------
function assertFree(run) {
  if (run.encounter) throw Object.assign(new Error('Estás en plena conversación. Despídete antes de hacer otra cosa.'), { code: 'ENCOUNTER_ACTIVE' });
}
function assertAccount(run) {
  if (!migrateSocial(run.social, run.player).profile.created) throw Object.assign(new Error('Crea tu cuenta de NorthLife primero.'), { code: 'NO_ACCOUNT' });
}
// La entrada lleva la hora a la que el jugador actuó; después pasan unos minutos de juego (escribir, publicar, esperar reacciones).
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
  assertFree(run); assertAccount(run);
  const body = cleanBody(value);
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const post = playerEntry(next, body, { reposts: 0, replies: [] });
  next.world = advanceTime(next.world, POST_MINUTES);
  next.social.posts.unshift(post);
  next.updatedAt = new Date().toISOString();
  next.eventLog.push({ time: post.time, type: 'social_post_created', data: { text: body } });
  return { run: next, post };
}

const visibleOf = (post, now) => post.minutes <= now;

export function publishPlayerReply(run, postId, value, replyToId = null) {
  assertFree(run); assertAccount(run);
  const body = cleanBody(value);
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const now = minutesOfWorld(next.world);
  const post = next.social.posts.find((item) => item.id === postId);
  if (!post || !visibleOf(post, now)) throw new Error('Esa publicación ya no está disponible.');
  const target = replyToId ? post.replies.find((item) => item.id === replyToId && item.minutes <= now) : null;
  if (replyToId && !target) throw new Error('Ese comentario ya no está disponible.');
  const reply = playerEntry(next, body, { inReplyTo: (target ?? post).handle });
  next.world = advanceTime(next.world, REPLY_MINUTES);
  post.replies.push(reply);
  next.updatedAt = new Date().toISOString();
  next.eventLog.push({ time: reply.time, type: 'social_reply_created', data: { text: body, postId } });
  return { run: next, post, reply, target };
}

// Reacción de la red (prompt social, modo «reply») a lo que acaba de hacer el jugador.
export function applyReactions(run, postId, raw, options, since = null) {
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const post = next.social.posts.find((item) => item.id === postId);
  if (!post) return next;
  const context = validationContext(next, options);
  const now = minutesOfWorld(next.world);
  const mine = playerHandle(next.player);
  const known = new Set([post.handle, mine, ...post.replies.map((reply) => reply.handle)].map(handleKey));
  const from = since ?? now;
  const fresh = cleanReplies(raw?.respuestas, post, context, { floor: from + 1, ceiling: from + 1440, defaultStep: 4 });
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
  next.social.accounts = directoryToAccounts(context.directory, context.contacts, referencedHandles(next.social));
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

// «Compartir» una publicación ajena: aparece en el perfil del jugador. Una segunda vez lo deshace.
export function toggleRepost(run, postId) {
  assertAccount(run);
  const next = structuredClone(run);
  next.social = migrateSocial(next.social, next.player);
  const now = minutesOfWorld(next.world);
  const post = next.social.posts.find((item) => item.id === postId);
  if (!post || post.minutes > now) throw new Error('Esa publicación ya no está disponible.');
  if (post.own) throw new Error('No puedes compartir tu propia publicación.');
  post.reposted = !post.reposted;
  if (post.reposted) post.repostedAt = now; else delete post.repostedAt;
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
// El avatar de una cuenta generada solo se muestra si sigue en el catálogo vigente; si no, la interfaz usa el avatar de respaldo.
export function socialView(run, { dev = false, seeds = [], avatars = [] } = {}) {
  const social = migrateSocial(run.social, run.player);
  const now = minutesOfWorld(run.world);
  const grow = (entry) => Math.round((entry.likes ?? 0) * clamp((now - entry.minutes) / RAMP, 0.12, 1)) + (entry.liked ? 1 : 0);
  const directory = accountDirectory(social, seeds);
  const catalog = new Set(avatars);
  const verified = (handle) => directory.get(handleKey(handle))?.verified === true;
  const avatarOf = (handle) => {
    const account = directory.get(handleKey(handle));
    if (!account || account.npcId) return {};
    const url = account.seed ? account.avatar : (account.avatar && catalog.has(account.avatar) ? account.avatar : null);
    return url ? { avatar: url } : {};
  };
  const reply = ({ id, handle, name, npcId, own, text: body, minutes, time, inReplyTo, liked, ...rest }) => ({ id, handle, name, verified: verified(handle), ...(own ? {} : avatarOf(handle)), ...(npcId ? { npcId } : {}), own: own === true, text: body, minutes, time, liked: liked === true, likes: grow({ likes: rest.likes, minutes, liked }), ...(inReplyTo ? { inReplyTo } : {}) });
  const posts = social.posts.filter((post) => visibleOf(post, now)).map((post) => ({
    id: post.id, handle: post.handle, name: post.name, ...(post.own ? {} : avatarOf(post.handle)), ...(post.npcId ? { npcId: post.npcId } : {}), own: post.own === true, text: post.text, minutes: post.minutes, time: post.time,
    liked: post.liked === true, likes: grow(post), reposts: Math.round((post.reposts ?? 0) * clamp((now - post.minutes) / RAMP, 0.12, 1)) + (post.reposted ? 1 : 0),
    ...(post.reposted ? { reposted: true, repostedAt: post.repostedAt } : {}),
    replies: post.replies.filter((item) => item.minutes <= now).map(reply), verified: verified(post.handle)
  })).sort((a, b) => b.minutes - a.minutes);
  const notifications = social.notifications.filter((item) => item.minutes <= now).map(({ id, kind, postId, replyId, handle, name, text: body, minutes, time, onYourPost, read }) => ({ id, kind, postId, replyId, handle, name, ...avatarOf(handle), text: body, minutes, time, onYourPost, read }));
  return {
    posts, notifications, unread: notifications.filter((item) => !item.read).length, now, handle: playerHandle(run.player),
    profile: { created: social.profile.created, handle: playerHandle(run.player), name: run.player.name, bio: social.profile.bio, hasAvatar: Boolean(social.profile.avatar), hasBanner: Boolean(social.profile.banner), v: social.profile.v },
    ...(dev ? { scheduled: social.posts.filter((post) => !visibleOf(post, now)).length, generatedAt: social.generatedAt, accounts: Object.keys(social.accounts).length } : {})
  };
}

// --- Datos para el prompt social --------------------------------------------------------------------------------------------
// El modelo NO recibe todo el registro ni todo el feed: una muestra acotada y variada de cuentas (canónicas, contactos del jugador, las
// más populares, las más activas y unas al azar, además de quienes participan en el hilo) y las últimas publicaciones para dar continuidad
// y no repetirse. Cada cuenta del registro lleva una muestra de lo último que escribió, para mantener su voz. Nunca se envían avatares ni URLs.
// Las cuentas de personajes que el jugador aún no conoce no aparecen. El azar es determinista (partida + hora de juego).
export function socialInput(run, mode, { npcs, seeds = [], places = [], ahora, extra = {} }) {
  const social = migrateSocial(run.social, run.player);
  const now = minutesOfWorld(run.world);
  const directory = accountDirectory(social, seeds);
  const contactNpcs = [...npcs.values()].filter((npc) => run.relationships?.[npc.id]?.added).slice(0, PROMPT_LIMITS.contacts);
  const contactKeys = new Set([...npcs.values()].filter((npc) => run.relationships?.[npc.id]?.added).map((npc) => handleKey(npc.contact?.handle)));
  const describe = (account) => ({
    usuario: account.handle, nombre: account.name, popularidad: account.popularity, verificado: account.verified === true, descripcion: account.bio || undefined,
    publicacionesAnteriores: account.samples?.length ? account.samples.slice(0, SAMPLES) : undefined
  });

  const seedAccounts = seeds.slice().sort((a, b) => b.popularity - a.popularity).slice(0, PROMPT_LIMITS.seeds).map((seed) => directory.get(handleKey(seed.handle)));
  const pool = [...directory.entries()].filter(([key, account]) => !account.seed && !account.npcId && !contactKeys.has(key)).map(([, account]) => account);
  const byPopularity = pool.slice().sort((a, b) => b.popularity - a.popularity).slice(0, PROMPT_LIMITS.popular);
  const chosen = new Set(byPopularity);
  const byActivity = pool.filter((account) => !chosen.has(account)).sort((a, b) => (b.seen ?? 0) - (a.seen ?? 0)).slice(0, PROMPT_LIMITS.recent);
  byActivity.forEach((account) => chosen.add(account));
  const random = seededRandom(hash32(`${run.id}:${social.generatedAt ?? 'x'}:${mode}:${Math.floor(now / 60)}`));
  const shuffled = pool.filter((account) => !chosen.has(account)).map((account) => [random(), account]).sort((a, b) => a[0] - b[0]).map(([, account]) => account).slice(0, PROMPT_LIMITS.random);
  const sampled = [...byPopularity, ...byActivity, ...shuffled];

  // Quienes participan en el hilo siempre van, aunque no entren en la muestra.
  const thread = extra.publicacion;
  const participants = thread ? [thread.usuario, ...(thread.respuestas ?? []).map((item) => item.usuario)] : [];
  const have = new Set([...seedAccounts, ...sampled].map((account) => handleKey(account.handle)));
  const forced = [...new Set(participants.map(handleKey))].filter((key) => !have.has(key) && !contactKeys.has(key) && directory.has(key)).slice(0, PROMPT_LIMITS.thread).map((key) => directory.get(key));

  const contacts = contactNpcs.map((npc) => ({
    usuario: npc.contact.handle, nombre: npc.name, popularidad: directory.get(handleKey(npc.contact.handle))?.popularity ?? 25, contactoDelJugador: true,
    resumen: npc.summary, personalidad: { rasgos: npc.personality?.traits, habla: npc.personality?.speech }, haciendoAhora: scheduleFor(npc, run.world)?.activity ?? 'fuera de su horario habitual'
  }));
  const excerpt = (post) => ({ usuario: post.handle, hora: post.time, texto: post.text.slice(0, PROMPT_LIMITS.excerpt) });
  const visible = social.posts.filter((post) => post.minutes <= now).slice(0, PROMPT_LIMITS.posts - 4).map(excerpt);
  const upcoming = social.posts.filter((post) => post.minutes > now).slice(-4).map(excerpt);
  return {
    mode, ahora, dia: run.world.day, ciudad: 'Porta Magna', lugares: places, avisos: socialNotices(run, npcs), cuentas: [...contacts, ...seedAccounts.map(describe), ...forced.map(describe), ...sampled.map(describe)],
    recientes: [...visible, ...upcoming],
    jugador: { usuario: playerHandle(run.player), nombre: run.player.name, descripcion: social.profile.bio || undefined, popularidad: playerPopularity(run.player) }, ...extra
  };
}

// El hilo completo (publicación + respuestas ya visibles) para que el modelo reaccione con contexto.
export const threadFor = (post, now) => ({
  id: post.id, usuario: post.handle, texto: post.text, hora: post.time,
  respuestas: post.replies.filter((item) => item.minutes <= now).map((item) => ({ id: item.id, usuario: item.handle, a: item.inReplyTo, texto: item.text }))
});
