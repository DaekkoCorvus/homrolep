import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNpcs } from '../src/server/game/npcs.js';
import { createRun } from '../src/server/game/run.js';
import { createAppServer } from '../src/server/index.js';
import { fixtureGeography } from './support/world.js';
import { validateAvatarUrls, createSocialCatalog, validateSeeds } from '../src/server/game/socialCatalog.js';
import { applyGeneratedPosts, applyReactions, wipeFeed, feedDue, saveProfile, socialView, socialInput, withAvatars, pickAvatar, publishPlayerPost, threadFor, PROMPT_LIMITS, MAX_GENERATED_POSTS } from '../src/server/game/social.js';
import { SOCIAL_TASKS } from '../src/server/ai/prompts.js';

const npcs = await loadNpcs(fileURLToPath(new URL('../data/canon/npcs', import.meta.url)));
const seeds = [{ handle: '@RexNova', name: 'Rex Nova', verified: true, popularity: 99, bio: 'Dueño de NorthLife', avatar: '/assets/social/accounts/rexnova.svg' }];
const catalog = ['https://img.example/a.png', 'https://img.example/b.png', 'https://img.example/c.png', 'https://img.example/d.png'];
const base = { npcs, seeds };
const withCatalog = { ...base, avatars: catalog };
const fresh = () => {
  const run = createRun({ name: 'Mara', age: 24, gender: 'woman', race: 'human' }); run.world.hour = 9;
  return saveProfile(run, { handle: '@MaraV' }, base);
};
const posts = (items) => items.map(([usuario, texto, extra = {}]) => ({ usuario, nombre: usuario.slice(1), hora: '08:30', texto, likes: 5, ...extra }));

test('avatar catalog: only https, well-formed, non-empty and unique URLs are accepted', () => {
  const { urls, rejected } = validateAvatarUrls([
    'https://i.example.com/a.png', ' https://i.example.com/b.jpg ', 'http://i.example.com/c.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//i.example.com/d.png',
    '', '   ', null, 42, 'no es una url', 'https://user:pass@i.example.com/e.png', 'https://i.example.com/a.png', 'HTTPS://I.EXAMPLE.COM/a.png/', 'https://i.example.com/con espacio.png', `https://i.example.com/${'x'.repeat(600)}.png`
  ]);
  assert.deepEqual(urls, ['https://i.example.com/a.png', 'https://i.example.com/b.jpg']);
  assert.equal(rejected.length, 14);
  assert.ok(rejected.some((item) => item.reason === 'repetida'));
  assert.deepEqual(validateAvatarUrls('no es lista').urls, []);
});

test('the catalog files are validated when read, reload by themselves and never break the game when missing or damaged', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hom-social-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const assets = path.join(dir, 'assets'); await mkdir(path.join(assets, 'social/accounts'), { recursive: true });
  await writeFile(path.join(assets, 'social/accounts/rex.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const catalogDir = path.join(dir, 'social'); await mkdir(catalogDir);
  const live = createSocialCatalog({ dir: catalogDir, assetDir: assets, ttl: 0 });
  assert.deepEqual((await live.refresh(true)).avatars, [], 'sin archivos no hay avatares ni cuentas');

  await writeFile(path.join(catalogDir, 'accounts.json'), JSON.stringify({ accounts: [
    { handle: '@Rex', name: 'Rex', popularity: 99, verified: true, avatar: '/assets/social/accounts/rex.svg' },
    { handle: '@Falta', name: 'Falta', popularity: 10, avatar: '/assets/social/accounts/no-existe.svg' },
    { handle: '@Fuga', name: 'Fuga', popularity: 10, avatar: '/assets/social/../../secreto.png' },
    { handle: '@Remota', name: 'Remota', popularity: 10, avatar: 'https://evil.example/x.png' },
    { handle: '@Rex', name: 'Repetida', popularity: 1 }, { handle: 'sin_arroba' }
  ] }));
  await writeFile(path.join(catalogDir, 'avatars.json'), JSON.stringify({ avatars: ['https://i.example.com/a.png', 'http://malo.example/b.png'] }));
  const loaded = await live.refresh(true);
  assert.deepEqual(loaded.seeds.map((seed) => [seed.handle, seed.avatar]), [['@Rex', '/assets/social/accounts/rex.svg'], ['@Falta', undefined], ['@Fuga', undefined], ['@Remota', undefined]], 'las cuentas canónicas solo admiten imágenes locales que existan');
  assert.deepEqual(loaded.avatars, ['https://i.example.com/a.png']);
  assert.ok(loaded.warnings.some((line) => /http/.test(line)) && loaded.warnings.length >= 5);

  await writeFile(path.join(catalogDir, 'avatars.json'), JSON.stringify(['https://i.example.com/a.png', 'https://i.example.com/z.png']));
  const bump = new Date(Date.now() + 10_000); await utimes(path.join(catalogDir, 'avatars.json'), bump, bump);
  assert.equal((await live.refresh()).avatars.length, 2, 'detecta cambios sin reiniciar');
  await writeFile(path.join(catalogDir, 'avatars.json'), '{ esto no es json');
  const bump2 = new Date(Date.now() + 20_000); await utimes(path.join(catalogDir, 'avatars.json'), bump2, bump2);
  const damaged = await live.refresh();
  assert.deepEqual(damaged.avatars, []); assert.ok(damaged.warnings.some((line) => /avatars\.json/.test(line)));
  assert.deepEqual((await validateSeeds('basura', assets)).seeds, []);
});

test('a new random account gets a catalog avatar exactly once, and the model can neither choose nor change it', () => {
  const run = fresh();
  const first = applyGeneratedPosts(run, posts([
    ['@tioabel89', 'Mi cafetera murió', { avatar: 'https://evil.example/mio.png', imagen: 'https://evil.example/otro.png' }],
    ['@marta_r', 'Alguien más con sueño?'],
    ['@RexNova', 'NorthLife nunca duerme', { avatar: 'https://evil.example/rex.png' }]
  ]), withCatalog);
  const accounts = first.social.accounts;
  assert.ok(catalog.includes(accounts['@tioabel89'].avatar) && catalog.includes(accounts['@marta_r'].avatar));
  assert.notEqual(accounts['@tioabel89'].avatar, accounts['@marta_r'].avatar, 'se prefiere un avatar que nadie más use');
  assert.equal(accounts['@rexnova'], undefined, 'las cuentas canónicas no se guardan en la partida: conservan su imagen local');
  assert.ok(!JSON.stringify(first.social).includes('evil.example'), 'las URLs del modelo no se aceptan');

  // generaciones posteriores no vuelven a sortear
  const kept = accounts['@tioabel89'].avatar;
  const second = applyGeneratedPosts(first, posts([['@tioabel89', 'Otra cosa distinta'], ['@nueva_77', 'Hola red']]), { ...base, avatars: [...catalog].reverse() });
  assert.equal(second.social.accounts['@tioabel89'].avatar, kept);
  assert.ok(second.social.accounts['@nueva_77'].avatar);

  // sin catálogo: sin avatar, la interfaz usa el de respaldo
  const bare = applyGeneratedPosts(run, posts([['@sin_avatar', 'Sin catálogo']]), base);
  assert.equal(bare.social.accounts['@sin_avatar'].avatar, undefined);
  // y las cuentas de personajes (contactos) no reciben avatares aleatorios: usan su retrato
  const contact = structuredClone(run); contact.relationships = { luna_serp: { added: true } };
  const luna = applyGeneratedPosts(contact, posts([['@LunaSerp', 'Pan recién hecho']]), withCatalog);
  assert.equal(luna.social.accounts['@lunaserp'].avatar, undefined);
  assert.equal(luna.social.accounts['@lunaserp'].npcId, 'luna_serp');
  assert.equal(pickAvatar([], new Set(), 'x', '@a'), null);
  assert.equal(pickAvatar(catalog, new Set(), 'x', '@a'), pickAvatar(catalog, new Set(), 'x', '@A'), 'estable por usuario');
});

test('old games: saved accounts without an avatar get one safely, and nothing else changes', () => {
  const legacy = fresh();
  legacy.social.accounts = {
    '@vieja1': { handle: '@vieja1', name: 'Vieja', popularity: 12, verified: false },
    '@vieja2': { handle: '@vieja2', name: 'Otra', popularity: 3, verified: false },
    '@conavatar': { handle: '@conavatar', name: 'Con', popularity: 3, verified: false, avatar: 'https://img.example/previo.png' },
    '@lunaserp': { handle: '@LunaSerp', name: 'Luna Serp', popularity: 25, verified: false, npcId: 'luna_serp' },
    '@rexnova': { handle: '@RexNova', name: 'Falso', popularity: 1, verified: false }
  };
  assert.equal(withAvatars(legacy, [], seeds), legacy, 'sin catálogo la partida no se toca');
  const migrated = withAvatars(legacy, catalog, seeds);
  assert.notEqual(migrated, legacy); assert.equal(legacy.social.accounts['@vieja1'].avatar, undefined, 'no muta el original');
  assert.ok(catalog.includes(migrated.social.accounts['@vieja1'].avatar) && catalog.includes(migrated.social.accounts['@vieja2'].avatar));
  assert.equal(migrated.social.accounts['@conavatar'].avatar, 'https://img.example/previo.png');
  assert.equal(migrated.social.accounts['@lunaserp'].avatar, undefined);
  assert.equal(migrated.social.accounts['@rexnova'].avatar, undefined, 'las canónicas conservan su imagen local');
  assert.deepEqual(withAvatars(legacy, catalog, seeds).social.accounts, migrated.social.accounts, 'determinista: cada carga da el mismo resultado');
  assert.deepEqual({ ...migrated, social: { ...migrated.social, accounts: null } }, { ...legacy, social: { ...legacy.social, accounts: null } }, 'el resto de la partida queda igual');
  const noSocial = { ...legacy, social: undefined };
  assert.equal(withAvatars(noSocial, catalog), noSocial, 'una partida sin red social no rompe');
});

test('the view shows avatars only while they are in the current catalog (or are the canon local image); the fallback covers the rest', () => {
  let run = applyGeneratedPosts(fresh(), posts([['@tioabel89', 'Hola'], ['@RexNova', 'Gracias a todos', { likes: 9000 }]]), withCatalog);
  run = { ...run, world: { ...run.world, hour: 12 } };
  const assigned = run.social.accounts['@tioabel89'].avatar;
  const shown = socialView(run, { seeds, avatars: catalog }).posts;
  assert.equal(shown.find((post) => post.handle === '@tioabel89').avatar, assigned);
  assert.equal(shown.find((post) => post.handle === '@RexNova').avatar, '/assets/social/accounts/rexnova.svg');
  const removed = socialView(run, { seeds, avatars: catalog.filter((url) => url !== assigned) }).posts.find((post) => post.handle === '@tioabel89');
  assert.equal('avatar' in removed, false, 'una URL retirada del catálogo ya no se muestra');
  assert.equal(run.social.accounts['@tioabel89'].avatar, assigned, 'pero la asignación se conserva');
  assert.equal(socialView(run, { seeds, avatars: [] }).posts.find((post) => post.handle === '@tioabel89').avatar, undefined);
  // respuestas y notificaciones también
  const published = publishPlayerPost(run, 'Hola red');
  const reacted = applyReactions(published.run, published.post.id, { respuestas: posts([['@amable_22', 'Bienvenida']]) }, withCatalog, published.post.minutes);
  const view = socialView({ ...reacted, world: { ...reacted.world, hour: 13 } }, { seeds, avatars: catalog });
  const reply = view.posts.find((post) => post.own).replies[0];
  assert.ok(catalog.includes(reply.avatar) && catalog.includes(view.notifications[0].avatar));
  assert.equal(view.posts.find((post) => post.own).avatar, undefined, 'el avatar del jugador es su foto de perfil');
});

test('the model gets a bounded, varied sample of accounts and recent posts, never the registry, the feed or any image URL', () => {
  let run = fresh();
  // registro y feed enormes
  for (let round = 0; round < 10; round++) {
    run = applyGeneratedPosts(run, Array.from({ length: MAX_GENERATED_POSTS }, (_, index) => ({ usuario: `@cuenta${round}x${index}`, nombre: `Cuenta ${round}-${index}`, popularidad: (round * 13 + index * 7) % 90, hora: '08:00', texto: `Publicación larga ${round}-${index} ${'ruido '.repeat(60)}`, likes: 3 })), withCatalog);
  }
  assert.ok(Object.keys(run.social.accounts).length > 100, 'el registro sí es grande');
  const input = (state, extra) => socialInput(state, 'post', { npcs, seeds, places: ['Café'], ahora: 'día 1', extra });
  const sent = input(run);
  const limit = PROMPT_LIMITS.seeds + PROMPT_LIMITS.contacts + PROMPT_LIMITS.popular + PROMPT_LIMITS.recent + PROMPT_LIMITS.random + PROMPT_LIMITS.thread;
  assert.ok(sent.cuentas.length <= limit && sent.cuentas.length >= 8, `${sent.cuentas.length} cuentas`);
  assert.ok(sent.recientes.length <= PROMPT_LIMITS.posts && sent.recientes.every((post) => post.texto.length <= PROMPT_LIMITS.excerpt));
  assert.ok(!JSON.stringify(sent).includes('https://') && !/avatar/i.test(JSON.stringify(sent)), 'el modelo no ve URLs ni el catálogo');
  assert.ok(sent.cuentas.some((account) => account.usuario === '@RexNova'));
  assert.ok(new Set(sent.cuentas.map((account) => account.usuario)).size === sent.cuentas.length, 'sin cuentas repetidas');
  const popularity = sent.cuentas.map((account) => account.popularidad);
  assert.ok(Math.max(...popularity) > 80 && popularity.some((value) => value < 40), 'muestra variada: populares y corrientes');
  assert.deepEqual(input(run), sent, 'determinista para el mismo estado');
  assert.notDeepEqual(input({ ...run, world: { ...run.world, hour: 15 } }).cuentas.map((a) => a.usuario), sent.cuentas.map((a) => a.usuario), 'cambia con el tiempo de juego');
  const size = JSON.stringify(sent).length;
  for (let round = 10; round < 20; round++) run = applyGeneratedPosts(run, Array.from({ length: MAX_GENERATED_POSTS }, (_, index) => ({ usuario: `@cuenta${round}x${index}`, hora: '08:00', texto: `Otra publicación ${round}-${index} ${'ruido '.repeat(60)}`, likes: 3 })), withCatalog);
  assert.ok(JSON.stringify(input(run)).length <= size * 1.15, 'el contexto no crece con cada generación');

  // en un hilo, quienes participan van siempre
  const thread = socialView({ ...run, world: { ...run.world, hour: 12 } }, { seeds }).posts.find((post) => post.handle === '@cuenta19x0');
  const stored = run.social.posts.find((post) => post.id === thread.id);
  const hilo = threadFor(stored, 12 * 60);
  const withThread = socialInput({ ...run, world: { ...run.world, hour: 12 } }, 'reply', { npcs, seeds, ahora: 'x', extra: { publicacion: hilo } });
  assert.ok(withThread.cuentas.some((account) => account.usuario === '@cuenta19x0'));
});

test('stored accounts keep a bounded sample of their voice, and the prompt sends it back; registry and feed have fixed ceilings', () => {
  let run = fresh();
  for (const text of ['Primera frase del vecino', 'Segunda frase del vecino', `Tercera ${'x'.repeat(300)}`]) {
    run = applyGeneratedPosts({ ...run, world: { ...run.world, minute: run.world.minute + 1 } }, posts([['@vecino_ruidoso', text]]), withCatalog);
  }
  const account = run.social.accounts['@vecino_ruidoso'];
  assert.equal(account.samples.length, 2); assert.ok(account.samples.every((sample) => sample.length <= 140));
  assert.match(account.samples[1], /Segunda/);
  assert.deepEqual(Object.keys(account).sort(), ['avatar', 'first', 'handle', 'name', 'popularity', 'samples', 'seen', 'verified'], 'solo campos del esquema');
  const sent = socialInput(run, 'post', { npcs, seeds, ahora: 'x' }).cuentas.find((item) => item.usuario === '@vecino_ruidoso');
  assert.deepEqual(sent.publicacionesAnteriores, account.samples);
  assert.equal(JSON.stringify(sent).includes('avatar'), false);

  // por generación: máximo de publicaciones y de cuentas nuevas
  const flood = applyGeneratedPosts(fresh(), Array.from({ length: 40 }, (_, index) => ({ usuario: `@flood${index}`, hora: '08:00', texto: `Flood ${index}`, respuestas: Array.from({ length: 12 }, (__, r) => ({ usuario: `@eco${index}x${r}`, texto: `Eco ${index}-${r}`, hora: '08:40' })) })), withCatalog);
  assert.equal(flood.social.posts.length, MAX_GENERATED_POSTS, 'el motor acepta como máximo 14 publicaciones por generación');
  assert.ok(Object.keys(flood.social.accounts).length <= 40, 'y como máximo 40 cuentas nuevas');
  assert.ok(flood.social.posts.some((post) => post.replies.length), 'quienes publican se registran antes que quienes responden');
  // el registro tiene techo y conserva a quien aún se ve en el feed
  let big = fresh();
  for (let round = 0; round < 14; round++) big = applyGeneratedPosts(big, Array.from({ length: MAX_GENERATED_POSTS }, (_, index) => ({ usuario: `@r${round}x${index}`, hora: '08:00', texto: `Reg ${round}-${index}`, respuestas: [{ usuario: `@q${round}x${index}`, texto: `Resp ${round}-${index}` }] })), withCatalog);
  assert.ok(Object.keys(big.social.accounts).length <= 150);
  const visibleHandles = new Set(big.social.posts.flatMap((post) => [post.handle.toLowerCase(), ...post.replies.map((reply) => reply.handle.toLowerCase())]));
  assert.ok([...visibleHandles].filter((handle) => !big.social.accounts[handle]).length <= visibleHandles.size - 100, 'se priorizan las cuentas que siguen en el feed');
  assert.ok(big.social.posts.length <= 140);
});

test('the prompt and the engine agree on how many posts a generation can carry', () => {
  assert.match(SOCIAL_TASKS.post, new RegExp(`at most ${MAX_GENERATED_POSTS} post records`));
  assert.match(SOCIAL_TASKS.post, /10–12 already published/);
  assert.match(SOCIAL_TASKS.post, /publicacionesAnteriores/);
});

test('API: avatars reach the client only through the validated view, and old saves load without breaking', async (t) => {
  const runs = new Map();
  const legacy = fresh();
  legacy.social = { posts: [{ id: 'p1', handle: '@vecina_vieja', name: 'Vecina', text: 'Hola desde una partida antigua', minutes: 8 * 60, time: 'DAY_1_08:00', likes: 4, reposts: 0, replies: [] }], accounts: { '@vecina_vieja': { handle: '@vecina_vieja', name: 'Vecina', popularity: 8, verified: false } }, notifications: [], profile: legacy.social.profile };
  runs.set(legacy.id, legacy);
  let snapshot = { seeds, avatars: catalog.slice(0, 2), avatarSet: new Set(catalog.slice(0, 2)), warnings: [] };
  const server = createAppServer({ geography: fixtureGeography(), socialCatalog: { current: () => snapshot, refresh: async () => snapshot }, ai: {}, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (item) => runs.set(item.id, structuredClone(item)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async () => (await fetch(`${base}/api/runs/${legacy.id}`)).json();

  const loaded = await get();
  const old = loaded.social.posts.find((post) => post.handle === '@vecina_vieja');
  assert.ok(snapshot.avatars.includes(old.avatar), 'la cuenta antigua recibe un avatar al cargar');
  assert.equal((await get()).social.posts[0].avatar, old.avatar, 'y es siempre el mismo');
  assert.equal(runs.get(legacy.id).social.accounts['@vecina_vieja'].avatar, undefined, 'cargar no reescribe la partida guardada');
  snapshot = { seeds, avatars: [], avatarSet: new Set(), warnings: [] };
  assert.equal('avatar' in (await get()).social.posts[0], false, 'sin catálogo: avatar de respaldo');
});

test('dev tool: wiping the feed removes posts, generated accounts and notifications but keeps the player account and the rest of the game', async (t) => {
  const avatar = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
  let run = saveProfile(fresh(), { handle: '@MaraV', bio: 'Hola', avatar }, base);
  run.relationships = { luna_serp: { added: true, met: true } };
  run = applyGeneratedPosts(run, posts([['@tioabel89', 'Mi cafetera murió'], ['@marta_r', 'Alguien con sueño?']]), withCatalog);
  const published = publishPlayerPost(run, 'Hola red');
  run = applyReactions(published.run, published.post.id, { respuestas: posts([['@amable_22', 'Bienvenida']]) }, withCatalog, published.post.minutes);
  assert.ok(run.social.posts.length >= 3 && Object.keys(run.social.accounts).length >= 3 && run.social.notifications.length && run.social.generatedAt !== null);

  const { run: clean, removed } = wipeFeed(run);
  assert.deepEqual(removed, { posts: 3, accounts: 3, notifications: 1 });
  assert.deepEqual({ posts: clean.social.posts, accounts: clean.social.accounts, notifications: clean.social.notifications, generatedAt: clean.social.generatedAt }, { posts: [], accounts: {}, notifications: [], generatedAt: null });
  assert.equal(clean.social.profile.created, true); assert.equal(clean.social.profile.bio, 'Hola'); assert.ok(clean.social.profile.avatar);
  assert.equal(clean.player.handle, '@MaraV');
  assert.deepEqual(clean.relationships, run.relationships); assert.deepEqual(clean.eventLog, run.eventLog); assert.deepEqual(clean.world, run.world);
  assert.equal(run.social.posts.length >= 3, true, 'no muta el original');
  assert.equal(feedDue(clean), true, 'la siguiente actividad lo genera de nuevo');
  const again = applyGeneratedPosts(clean, posts([['@tioabel89', 'Mi cafetera murió']]), withCatalog);
  assert.equal(again.social.posts.length, 1, 'se puede volver a generar el mismo contenido');

  // API: solo con las herramientas de desarrollo activadas
  const runs = new Map([[run.id, run]]);
  const server = createAppServer({ geography: fixtureGeography(), ai: {}, socialCatalog: { current: () => ({ seeds, avatars: catalog, avatarSet: new Set(catalog), warnings: [] }), refresh: async () => {} }, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (item) => runs.set(item.id, structuredClone(item)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const call = async (dev) => { const response = await fetch(`http://127.0.0.1:${server.address().port}/api/runs/${run.id}/dev`, { method: 'POST', headers: { 'content-type': 'application/json', ...(dev ? { 'x-hom-dev': '1' } : {}) }, body: JSON.stringify({ op: 'social_wipe' }) }); return { status: response.status, body: await response.json() }; };
  assert.equal((await call(false)).status, 403);
  assert.ok(runs.get(run.id).social.posts.length >= 3, 'sin la cabecera de desarrollo no se borra nada');
  const done = await call(true);
  assert.equal(done.status, 200); assert.deepEqual(done.body.social.posts, []); assert.equal(done.body.social.profile.created, true);
  assert.deepEqual(runs.get(run.id).social.accounts, {});
});
