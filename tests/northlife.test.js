import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { loadNpcs } from '../src/server/game/npcs.js';
import { createRun } from '../src/server/game/run.js';
import { createAppServer } from '../src/server/index.js';
import {
  applyGeneratedPosts, applyReactions, publishPlayerPost, publishPlayerReply, toggleLike, markNotificationsRead, socialView, feedDue, maxLikes,
  resolveWhen, playerHandle, GENERATION_GAP
} from '../src/server/game/social.js';

const npcs = await loadNpcs(fileURLToPath(new URL('../data/canon/npcs', import.meta.url)));
const seeds = [{ handle: '@RexNova', name: 'Rex Nova', verified: true, popularity: 99, bio: 'Dueño de NorthLife' }];
const options = { npcs, seeds };
const player = { name: 'Mara', age: 24, gender: 'woman', race: 'human' };
const fresh = () => { const run = createRun(player); run.world.hour = 9; run.world.minute = 0; return run; };
const at = (run, hour, minute = 0) => ({ ...run, world: { ...run.world, hour, minute } });
const handles = (run, now = run) => socialView(now, { seeds }).posts.map((post) => post.handle);

test('the model proposes, the engine decides: handles, popularity, likes and times are validated', () => {
  const run = fresh();
  const next = applyGeneratedPosts(run, [
    { usuario: '@tioabel89', nombre: 'Abel', popularidad: 200, hora: '08:30', texto: 'Otra mañana, otro café aguado.', likes: 999999, reposts: 5000 },
    { usuario: '@RexNova', nombre: 'Falso Rex', verificado: false, popularidad: 1, hora: '08:45', texto: 'NorthLife nunca duerme.', likes: 12000 },
    { usuario: '@LunaSerp', hora: '08:50', texto: 'Soy Luna y aún no me conoces.', likes: 3 },     // personaje que el jugador no conoce: reservado
    { usuario: playerHandle(run.player), hora: '08:55', texto: 'Suplantando al jugador.' },        // el jugador no habla por el modelo
    { usuario: 'sin_arroba', hora: '08:55', texto: 'Usuario inválido.' },
    { usuario: '@vacio', hora: '08:55', texto: '   ' },
    { usuario: '@tioabel89', hora: '08:30', texto: 'Otra mañana, otro café aguado.' },              // texto repetido
    { usuario: '@tarde', nombre: 'Tarde', hora: '23:30', texto: 'Esto se publica por la noche.', likes: 4 },
    { usuario: '@respondona', nombre: 'Resp', hora: '10:00', texto: 'Hilo con respuestas', likes: 10, respuestas: [
      { usuario: '@curioso1', nombre: 'Curioso', hora: '09:00', texto: 'Antes que la publicación: se corrige', likes: 1 },
      { usuario: '@curioso2', hora: '10:30', texto: 'Después, bien.', likes: 99999 },
      { usuario: playerHandle(run.player), hora: '10:40', texto: 'No puede responder como el jugador.' }
    ] }
  ], options);
  const stored = next.social.posts;
  assert.deepEqual(stored.map((post) => post.handle).sort(), ['@RexNova', '@respondona', '@tarde', '@tioabel89'].sort(), 'solo cuentas válidas y no reservadas');
  const abel = stored.find((post) => post.handle === '@tioabel89');
  assert.ok(abel.likes <= maxLikes(90) && abel.likes <= maxLikes(next.social.accounts['@tioabel89'.toLowerCase()].popularity), 'los likes los limita la popularidad, no el modelo');
  assert.equal(next.social.accounts['@tioabel89'].popularity, 90, 'una cuenta nueva no puede nacer más popular que 90');
  assert.ok(abel.reposts <= abel.likes);
  const rex = stored.find((post) => post.handle === '@RexNova');
  assert.equal(rex.name, 'Rex Nova', 'el canon manda sobre lo que el modelo diga de una cuenta');
  assert.ok(rex.likes > abel.likes || rex.likes === 12000, 'una cuenta enorme puede sumar miles');
  const thread = stored.find((post) => post.handle === '@respondona');
  assert.equal(thread.replies.length, 2, 'se descartan las respuestas del jugador suplantado');
  assert.ok(thread.replies.every((reply) => reply.minutes > thread.minutes), 'una respuesta siempre llega después de la publicación');
  assert.equal(next.social.generatedAt, 9 * 60);
  // no se pisa lo anterior ni se duplica
  assert.equal(applyGeneratedPosts(next, [{ usuario: '@tioabel89', hora: '08:30', texto: 'Otra mañana, otro café aguado.' }], options).social.posts.length, stored.length);
});

test('a post appears only when the world reaches its time; likes grow gradually; a held-back reply stays hidden', () => {
  const run = applyGeneratedPosts(fresh(), [
    { usuario: '@temprano', hora: '08:00', texto: 'Madrugador', likes: 100, respuestas: [{ usuario: '@resp1', hora: '09:30', texto: 'Buenos días', likes: 2 }] },
    { usuario: '@tarde', hora: '14:00', texto: 'Comida', likes: 50 },
    { usuario: '@ayer', dia: -1, hora: '21:00', texto: 'Ayer por la noche', likes: 40 }
  ], options);
  assert.deepEqual(handles(run), ['@temprano', '@ayer']);
  assert.equal(socialView(run, { seeds }).posts[0].replies.length, 0, 'la respuesta de las 9:30 aún no existe');
  const nine30 = socialView(at(run, 9, 30), { seeds }).posts[0];
  assert.equal(nine30.replies.length, 1);
  const later = socialView(at(run, 12, 30), { seeds }).posts.find((post) => post.handle === '@temprano');
  const early = socialView(run, { seeds }).posts.find((post) => post.handle === '@temprano');
  assert.ok(early.likes < later.likes && later.likes <= 100, 'los likes suben con el tiempo hasta su valor');
  assert.deepEqual(handles(run, at(run, 14, 5)), ['@tarde', '@temprano', '@ayer'], 'ordenadas de más reciente a más antigua');
  assert.equal(socialView(run, { seeds, dev: true }).scheduled, 1);
  assert.equal(socialView(run, { seeds }).scheduled, undefined, 'el jugador no ve lo programado');
  assert.equal(resolveWhen({ hora: 'xx' }, run.world, 123), 123);
  assert.equal(resolveWhen({ dia: 9, hora: '10:00' }, run.world), 9 * 60 + 30 * 60, 'no más de 30 horas por delante');
});

test('the player posts, replies, likes and receives notifications when someone answers', () => {
  const run = fresh();
  const { run: posted, post } = publishPlayerPost(run, `  ${'x'.repeat(400)}  `);
  assert.equal(post.text.length, 280);
  assert.equal(posted.world.minute, 1, 'publicar cuesta un minuto');
  assert.equal(post.own, true);
  assert.throws(() => publishPlayerPost(run, '   '), /vacío/);
  assert.throws(() => publishPlayerPost({ ...run, encounter: { npcId: 'luna_serp' } }, 'hola'), /conversación/);

  const reacted = applyReactions(posted, post.id, { respuestas: [
    { usuario: '@amable', nombre: 'Amable', hora: '09:20', texto: 'Bienvenida a la ciudad', likes: 3 },
    { usuario: '@gracioso', nombre: 'Gracioso', hora: '09:50', texto: 'jaja', a: '@amable' }
  ], likes: 5000, reposts: 4000 }, options);
  const mine = reacted.social.posts[0];
  assert.ok(mine.likes <= maxLikes(5), 'el jugador es un desconocido: no se hace viral con una publicación');
  assert.equal(reacted.social.notifications.length, 2, 'todo lo que responde en su publicación le avisa');
  assert.equal(socialView(reacted, { seeds }).unread, 0, 'los avisos llegan a su hora, no antes');
  const afterHalf = at(reacted, 9, 30);
  const view = socialView(afterHalf, { seeds });
  assert.equal(view.unread, 1); assert.equal(view.notifications[0].handle, '@amable');
  assert.equal(socialView(markNotificationsRead(afterHalf), { seeds }).unread, 0);
  assert.equal(socialView(markNotificationsRead(afterHalf), { seeds: [] }).notifications.length, 1, 'leídos no se borran; los futuros siguen ocultos');

  // en un hilo ajeno solo le avisan si le contestan a él
  const other = applyGeneratedPosts(at(fresh(), 10, 0), [{ usuario: '@vecina', nombre: 'Vecina', hora: '09:00', texto: 'Hilo ajeno', respuestas: [{ usuario: '@cur1', hora: '09:10', texto: 'Primera' }] }], options);
  const foreign = socialView(other, { seeds }).posts[0];
  const { run: answered, post: thread, reply, target } = publishPlayerReply(other, foreign.id, 'Yo opino lo mismo', foreign.replies[0].id);
  assert.equal(reply.inReplyTo, '@cur1'); assert.equal(target.id, foreign.replies[0].id);
  const back = applyReactions(answered, thread.id, { respuestas: [{ usuario: '@cur1', a: playerHandle(player), hora: '10:30', texto: 'Cualquier cosa, dime.' }, { usuario: '@miron', a: '@vecina', hora: '10:35', texto: 'Cosas de ellos' }] }, options);
  assert.equal(back.social.notifications.length, 1, 'la respuesta a otra persona no avisa; la que contesta al jugador sí');
  assert.equal(back.social.notifications[0].onYourPost, false);
  assert.throws(() => publishPlayerReply(other, 'inexistente', 'hola'), /disponible/);
  assert.throws(() => publishPlayerReply(run, post.id, 'hola'), /disponible/);

  const liked = toggleLike(afterHalf, mine.id);
  assert.equal(socialView(liked, { seeds }).posts[0].liked, true);
  assert.equal(socialView(liked, { seeds }).posts[0].likes, socialView(afterHalf, { seeds }).posts[0].likes + 1);
  assert.equal(socialView(toggleLike(liked, mine.id), { seeds }).posts[0].liked, false);
});

test('spontaneous generation is due at most about twice per game day', () => {
  const run = fresh();
  assert.equal(feedDue(run), true);
  const done = applyGeneratedPosts(run, [], options);
  assert.equal(feedDue(done), false);
  assert.equal(feedDue(at(done, 18, 0)), false);
  assert.equal(feedDue({ ...done, world: { ...done.world, hour: 9 + GENERATION_GAP / 60, minute: 0 } }), true);
});

test('API: the feed fills itself in the background, the player\'s posts get a reaction in the same request and a failure changes nothing', async (t) => {
  const runs = new Map(); const calls = { posts: 0, reply: [] };
  let failReply = false;
  const ai = {
    npcReply: async () => ({ say: 'Hola' }), narrate: async () => 'Pasa el tiempo.', prologue: async () => ({ text: 'Llegas.', locationId: 'station' }),
    socialPosts: async (input) => {
      calls.posts++;
      assert.equal(input.mode, 'post');
      assert.ok(input.cuentas.some((account) => account.usuario === '@RexNova' && account.popularidad >= 90 && account.verificado), 'el modelo recibe las cuentas del canon con su popularidad');
      assert.ok(!input.cuentas.some((account) => account.usuario === '@LunaSerp'), 'los personajes que el jugador no conoce no aparecen');
      return [{ usuario: '@RexNova', hora: '08:00', texto: 'Hoy NorthLife cumple otro récord.', likes: 20000 }, { usuario: '@vecina', nombre: 'Vecina', hora: '11:30', texto: 'Alguien sabe por qué suena la sirena?' }];
    },
    socialReply: async (input) => {
      if (failReply) throw new Error('IA caída');
      calls.reply.push(input);
      assert.equal(input.mode, 'reply');
      return { respuestas: [{ usuario: '@amable', nombre: 'Amable', hora: '09:20', texto: 'Bienvenida', a: input.jugador.usuario }], likes: 3 };
    }
  };
  const server = createAppServer({ ai, settings: { require: async () => ({ apiKey: 'k', model: 'm' }) }, store: { saveRun: async (run) => runs.set(run.id, structuredClone(run)), loadRun: async (id) => structuredClone(runs.get(id)), listRuns: async () => [] } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, body, method = body ? 'POST' : 'GET', dev = false) => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(dev ? { 'x-hom-dev': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const id = (await call('/api/runs', { name: 'Mara', age: 24, gender: 'woman', race: 'human' })).body.id;
  const stored = runs.get(id); stored.world.hour = 9; runs.set(id, stored);

  const acted = await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 30 });
  assert.equal(acted.status, 200); assert.equal(calls.posts, 1);
  assert.deepEqual(acted.body.social.posts.map((post) => post.handle), ['@RexNova'], 'la de las 11:30 aún no se ve');
  assert.equal(acted.body.social.posts[0].verified, true);
  assert.ok(acted.body.social.posts[0].likes > 1000 && acted.body.social.posts[0].likes <= maxLikes(99));
  await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 30 });
  assert.equal(calls.posts, 1, 'no se vuelve a generar hasta pasadas unas 10 horas');
  const late = await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 120 });
  assert.deepEqual(late.body.social.posts.map((post) => post.handle), ['@vecina', '@RexNova'], 'a su hora la publicación aparece sola');

  // el jugador publica: la red reacciona en la misma petición
  const published = await call(`/api/runs/${id}/posts`, { text: 'Primer día en la ciudad' });
  assert.equal(published.status, 200); assert.equal(calls.reply.length, 1);
  assert.equal(calls.reply[0].accionDelJugador.tipo, 'publicacion');
  assert.equal(published.body.social.posts.find((post) => post.own).text, 'Primer día en la ciudad');
  assert.equal(published.body.social.unread, 0, 'la respuesta aún no ha llegado');
  const mine = published.body.social.posts.find((post) => post.own);

  // si la IA falla, no se publica nada
  const before = JSON.stringify(runs.get(id));
  failReply = true;
  assert.equal((await call(`/api/runs/${id}/posts`, { text: 'Esto no debería publicarse' })).status, 400);
  assert.equal(JSON.stringify(runs.get(id)), before, 'una IA caída no avanza ni cambia la partida');
  failReply = false;

  const waited = await call(`/api/runs/${id}/action`, { type: 'wait', minutes: 60 });
  assert.equal(waited.body.social.unread, 1);
  assert.equal(waited.body.social.notifications[0].handle, '@amable');
  assert.equal(waited.body.social.posts.find((post) => post.id === mine.id).replies.length, 1);
  assert.equal((await call(`/api/runs/${id}/social`, { op: 'read' })).body.social.unread, 0);

  const liked = await call(`/api/runs/${id}/social`, { op: 'like', postId: mine.id });
  assert.equal(liked.body.social.posts.find((post) => post.id === mine.id).liked, true);
  const reply = await call(`/api/runs/${id}/social`, { op: 'reply', postId: mine.id, text: 'Gracias!', replyTo: waited.body.social.posts.find((post) => post.id === mine.id).replies[0].id });
  assert.equal(reply.status, 200); assert.equal(calls.reply.length, 2);
  assert.equal(calls.reply[1].accionDelJugador.tipo, 'respuesta');
  assert.equal(calls.reply[1].accionDelJugador.aQuien, '@amable');
  assert.equal((await call(`/api/runs/${id}/social`, { op: 'nada' })).status, 400);

  // herramienta de desarrollo: generar ahora
  assert.equal((await call(`/api/runs/${id}/dev`, { op: 'social' })).status, 403);
  const forced = await call(`/api/runs/${id}/dev`, { op: 'social' }, 'POST', true);
  assert.equal(forced.status, 200); assert.equal(calls.posts, 2);
  assert.ok(forced.body.social.scheduled >= 0);
});
