import { state, app, request, notify, timeText, clockText, period, place, escapeHtml } from './core.js';
import { sceneMarkup, applySky, SCENE_META } from './scenes.js';

const ui = { phoneOpen:false, phoneView:'home', busy:false, sceneKey:null, hooks:{} };
const PHONE_APPS = [
  ['profile', 'Perfil', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 5-7 8-7s7 2 8 7"/>'],
  ['map', 'Mapa', '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.500 7 12 7 12Z"/><circle cx="12" cy="10" r="2.500"/>'],
  ['social', 'Social', '<path d="M4 5h16v11H9l-5 4Z"/>'],
  ['missions', 'Misiones', '<path d="M6 3v18M6 4h12l-3 4 3 4H6"/>'],
  ['journal', 'Diario', '<path d="M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2Z"/><path d="M10 8h6M10 12h6"/>'],
  ['settings', 'Ajustes', '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>']
];
const icon = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export function enterGame(hooks) {
  if (hooks) ui.hooks = hooks;
  Object.assign(ui, { phoneOpen:false, phoneView:'home', busy:false, sceneKey:null });
  document.getElementById('vortex-layer')?.contentWindow?.postMessage({ type:'vortex', zoom:1, flash:0, rate:2 }, location.origin);
  app.innerHTML = `<main class="game">
    <div class="scene" aria-hidden="true"><div class="scene-art"></div><div class="scene-dust"></div><div class="scene-vignette"></div></div>
    <div class="place-title" aria-live="polite"></div>
    <header class="hud">
      <div class="clock-pill" role="status"><span class="clock-dot"></span><span class="clock-text"></span></div>
      <button class="phone-button" type="button" data-phone aria-label="Abrir teléfono">${icon('<rect x="7" y="2.500" width="10" height="19" rx="2.500"/><path d="M11 18.500h2"/>')}<i class="phone-badge" hidden></i></button>
    </header>
    <section class="story" aria-live="polite"></section>
    <footer class="dock">
      <div class="chips" role="group" aria-label="Acciones del lugar"></div>
      <form class="free-action"><textarea rows="1" maxlength="500" name="text" aria-label="Acción libre" placeholder="¿Qué haces?" required></textarea><button type="submit" aria-label="Actuar">${icon('<path d="M5 12h14M13 6l6 6-6 6"/>')}</button></form>
    </footer>
    <div class="sheet-layer" hidden><div class="sheet" role="dialog" aria-label="Moverse"></div></div>
    <div class="phone-layer" hidden><div class="phone" role="dialog" aria-label="Teléfono"><div class="phone-notch"></div><div class="phone-status"><span class="ps-time"></span><span class="ps-net">Northfortress ▪▪▪</span></div><div class="phone-screen"></div><button class="phone-home" type="button" aria-label="Inicio del teléfono"></button></div></div>
  </main>`;
  wire();
  updateGame({ announce:true });
}

function wire() {
  const root = app.querySelector('.game');
  root.querySelector('[data-phone]').onclick = () => togglePhone(true);
  root.querySelector('.phone-layer').onclick = (event) => { if (event.target === event.currentTarget) togglePhone(false); };
  root.querySelector('.sheet-layer').onclick = (event) => { if (event.target === event.currentTarget) toggleSheet(false); };
  root.querySelector('.phone-home').onclick = () => { if (ui.phoneView === 'home') togglePhone(false); else { ui.phoneView = 'home'; renderPhone(); } };
  const dock = root.querySelector('.dock');
  new ResizeObserver(() => root.style.setProperty('--dock-h', `${dock.offsetHeight}px`)).observe(dock);
  const form = root.querySelector('.free-action');
  const input = form.elements.text;
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && matchMedia('(hover:hover)').matches) { event.preventDefault(); form.requestSubmit(); } });
  form.onsubmit = (event) => { event.preventDefault(); const text = input.value.trim(); if (!text) return; input.value = ''; grow(); runAction({ type:'freeform', text }); };
  document.onkeydown = (event) => { if (event.key === 'Escape') { if (!root.querySelector('.sheet-layer').hidden) toggleSheet(false); else if (ui.phoneOpen) togglePhone(false); } };
}

export function updateGame({ announce=false }={}) {
  const root = app.querySelector('.game'); if (!root) return;
  const { run } = state; const loc = place(run.player.locationId);
  const clock = root.querySelector('.clock-text'); clock.textContent = timeText(run.world);
  root.querySelector('.ps-time').textContent = clockText(run.world);
  renderScene(root, loc, announce);
  renderStory(root, loc);
  renderChips(root, loc);
  if (ui.phoneOpen) renderPhone();
}

function renderScene(root, loc, announce) {
  const scene = root.querySelector('.scene');
  const art = scene.querySelector('.scene-art');
  applySky(scene, state.run.world);
  const key = loc.id;
  const changed = ui.sceneKey !== key;
  const bucket = Math.floor(state.run.world.hour / 3);
  if (changed || ui.bucket !== bucket) {
    const next = document.createElement('div');
    next.className = 'scene-art entering';
    next.innerHTML = sceneMarkup(key, state.run.world);
    art.after(next); requestAnimationFrame(() => next.classList.remove('entering'));
    setTimeout(() => art.remove(), 1400);
    ui.bucket = bucket;
  }
  if (changed) {
    ui.sceneKey = key;
    const title = root.querySelector('.place-title');
    title.innerHTML = `<small>${escapeHtml(loc.district)} · Northfortress</small><strong>${escapeHtml(loc.name)}</strong>`;
    title.classList.remove('show'); void title.offsetWidth; title.classList.add('show');
  }
  const dust = scene.querySelector('.scene-dust');
  if (!dust.children.length) for (let i = 0; i < 16; i++) { const p = document.createElement('i'); p.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 70}%;animation-delay:${-Math.random() * 14}s;animation-duration:${10 + Math.random() * 10}s;--s:${(0.5 + Math.random() * 1.5).toFixed(1)}px`; dust.append(p); }
}

function storyContent(loc) {
  const run = state.run;
  const last = [...run.eventLog].reverse().find((event) => event.data?.response);
  let lead = '', text = '';
  if (last && run.narrative && run.narrative.time === last.time) {
    text = last.data.response;
    if (last.type === 'player_action') lead = last.data.text;
  } else if (run.narrative) text = run.narrative.text;
  else text = run.prologue?.text || loc.description;
  return { lead, paragraphs:text.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean) };
}

function renderStory(root, loc) {
  const story = root.querySelector('.story');
  const { lead, paragraphs } = storyContent(loc);
  const signature = lead + paragraphs.join('|');
  if (story.dataset.sig === signature && !ui.storyError) return;
  story.dataset.sig = signature;
  story.innerHTML = `${lead ? `<p class="story-lead">${escapeHtml(lead)}</p>` : ''}${paragraphs.map((p, i) => `<p class="story-line" style="animation-delay:${i * .55}s">${escapeHtml(p)}</p>`).join('')}${ui.storyError ? `<p class="story-error" role="alert">${escapeHtml(ui.storyError)}</p>` : ''}`;
  story.scrollTop = 0;
}

function renderChips(root, loc) {
  const meta = SCENE_META[loc.id];
  const chips = [['move', 'Moverse', null]];
  for (const text of meta?.interactions ?? []) chips.push(['free', text, text]);
  if (loc.id === 'apartment') chips.push(['sleep', 'Dormir', null]);
  if (state.run.player.occupation === 'worker') chips.push(['work', 'Trabajar', null]);
  chips.push(['wait', 'Esperar un rato', null]);
  const box = root.querySelector('.chips');
  box.innerHTML = chips.map(([kind, label, text]) => `<button type="button" class="chip-action ${kind === 'move' ? 'primary-chip' : ''}" data-kind="${kind}" ${text ? `data-text="${escapeHtml(text)}"` : ''}>${kind === 'move' ? `${icon('<path d="M5 12h14M13 6l6 6-6 6"/>')}` : ''}${escapeHtml(label)}</button>`).join('');
  box.querySelectorAll('button').forEach((button) => button.onclick = () => {
    const { kind, text } = button.dataset;
    if (kind === 'move') toggleSheet(true);
    else if (kind === 'free') runAction({ type:'freeform', text:`${text}.` });
    else runAction({ type:kind });
  });
}

function placeButtons(closeAfter) {
  const here = state.run.player.locationId; const { hour } = state.run.world;
  return state.world.locations.map((loc) => {
    const closed = loc.hours && (hour < loc.hours.open || hour >= loc.hours.close);
    const current = loc.id === here;
    return `<button type="button" class="place-row ${current ? 'current' : ''}" data-travel="${loc.id}" ${current ? 'disabled' : ''}><span><strong>${escapeHtml(loc.name)}</strong><small>${escapeHtml(loc.district)}${closed ? ' · Probablemente cerrado' : ''}</small></span><em>${current ? 'Estás aquí' : `${loc.travelMinutes} min`}</em></button>`;
  }).join('');
}

function bindTravel(container) {
  container.querySelectorAll('[data-travel]').forEach((button) => button.onclick = () => {
    toggleSheet(false); togglePhone(false);
    runAction({ type:'travel', locationId:button.dataset.travel });
  });
}

function toggleSheet(open) {
  const layer = app.querySelector('.sheet-layer'); if (!layer) return;
  const sheet = layer.querySelector('.sheet');
  if (open) { sheet.innerHTML = `<span class="grabber"></span><h2>¿A dónde vas?</h2><div class="place-rows">${placeButtons()}</div>`; bindTravel(sheet); layer.hidden = false; requestAnimationFrame(() => layer.classList.add('open')); }
  else { layer.classList.remove('open'); setTimeout(() => { layer.hidden = true; }, 320); }
}

function togglePhone(open) {
  const layer = app.querySelector('.phone-layer'); if (!layer) return;
  ui.phoneOpen = open;
  if (open) { ui.phoneView = 'home'; renderPhone(); layer.hidden = false; requestAnimationFrame(() => layer.classList.add('open')); }
  else { layer.classList.remove('open'); setTimeout(() => { if (!ui.phoneOpen) layer.hidden = true; }, 380); }
}

function renderPhone() {
  const screen = app.querySelector('.phone-screen'); if (!screen) return;
  const view = ui.phoneView; const run = state.run;
  if (view === 'home') {
    screen.className = 'phone-screen home';
    screen.innerHTML = `<div class="phone-clock"><strong>${clockText(run.world)}</strong><span>Día ${run.world.day} · ${period(run.world.hour)}</span></div><div class="app-grid">${PHONE_APPS.map(([id, label, path]) => `<button type="button" data-app="${id}"><span class="app-icon">${icon(path)}</span>${label}</button>`).join('')}<button type="button" disabled><span class="app-icon dim">${icon('<path d="M3 7l9 6 9-6M3 7v10h18V7Z"/>')}</span>Mensajes</button></div>`;
    screen.querySelectorAll('[data-app]').forEach((button) => button.onclick = () => openApp(button.dataset.app));
    return;
  }
  const titles = { profile:'Perfil', map:'Mapa', social:'Social', missions:'Misiones', journal:'Diario' };
  const bodies = { profile:profileApp, map:mapApp, social:socialApp, missions:() => '<p class="empty">No tienes misiones activas. Las oportunidades llegarán cuando el mundo tenga algo que ofrecerte.</p>', journal:journalApp };
  screen.className = 'phone-screen app';
  screen.innerHTML = `<div class="app-bar"><button type="button" data-back aria-label="Volver">${icon('<path d="M15 5l-7 7 7 7"/>')}</button><h2>${titles[view]}</h2></div><div class="app-body">${bodies[view]()}</div>`;
  screen.querySelector('[data-back]').onclick = () => { ui.phoneView = 'home'; renderPhone(); };
  bindTravel(screen);
  const post = screen.querySelector('#post-form');
  if (post) post.onsubmit = async (event) => {
    event.preventDefault();
    try { state.run = await request(`/api/runs/${state.run.id}/posts`, { method:'POST', body:JSON.stringify({ text:new FormData(post).get('text') }) }); renderPhone(); notify('Publicación guardada.'); }
    catch (error) { notify(error.message); }
  };
}

function openApp(id) {
  if (id === 'settings') { togglePhone(false); ui.hooks.openSettings?.(); return; }
  ui.phoneView = id; renderPhone();
}

function profileApp() {
  const p = state.run.player; const loc = place(p.locationId);
  const gender = p.gender === 'custom' ? p.genderCustom : p.gender === 'man' ? 'Hombre' : p.gender === 'woman' ? 'Mujer' : 'Sin definir';
  const rows = [['Edad', p.age], ['Identidad', gender], ['Raza', 'Humano'], ['Dinero', `$${p.money}`], ['Reputación', p.reputation], ['Ubicación', loc.name], ['Ocupación', p.occupation || 'Por descubrir'], ['Aspiración', p.aspiration || 'Por descubrir']];
  return `<div class="profile-head"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.origin || 'Un pasado aún desconocido.')}</span></div><dl class="stat-rows">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('')}</dl>`;
}

function mapApp() { return `<p class="muted">Northfortress · toca un lugar para ir</p><div class="place-rows">${placeButtons()}</div>`; }

function socialApp() {
  const posts = state.run.social.posts.map((post) => `<article class="post"><strong>${escapeHtml(post.author)}</strong><p>${escapeHtml(post.text)}</p><small>${escapeHtml(post.time)}</small></article>`).join('');
  return `<form id="post-form"><textarea name="text" maxlength="280" rows="2" placeholder="¿Qué está pasando?" required></textarea><button type="submit">Publicar</button></form>${posts || '<p class="empty">El feed está en silencio. Publica algo.</p>'}`;
}

function eventText(event) {
  const name = (id) => escapeHtml(place(id)?.name || id);
  if (event.type === 'run_started') return 'La partida comenzó en Northfortress.';
  if (event.type === 'prologue_created') return `Tu historia comenzó en ${name(event.data.locationId)}.`;
  if (event.type === 'location_changed') return `Viajaste de ${name(event.from)} a ${name(event.to)}.`;
  if (event.type === 'player_action') return escapeHtml(event.data.text);
  if (event.type === 'time_waited') return `Esperaste ${event.data.minutes} minutos.`;
  if (event.type === 'slept') return 'Dormiste ocho horas.';
  if (event.type === 'worked') return `Trabajaste y ganaste $${event.data.earned}.`;
  if (event.type === 'social_post_created') return 'Publicaste en la red social.';
  return escapeHtml(event.type);
}

function journalApp() {
  const items = state.run.eventLog.slice(-30).reverse().map((event) => `<div class="entry"><time>${escapeHtml(event.time.replace('DAY_', 'Día ').replace('_', ' · '))}</time>${event.data?.response ? `<details><summary>${eventText(event)}</summary><p>${escapeHtml(event.data.response)}</p></details>` : `<p>${eventText(event)}</p>`}</div>`).join('');
  return items || '<p class="empty">Todavía no hay nada que recordar.</p>';
}

async function runAction(action) {
  if (ui.busy) return;
  ui.busy = true; ui.storyError = '';
  const root = app.querySelector('.game');
  root.classList.add('busy');
  root.querySelectorAll('.dock button, .dock textarea').forEach((element) => { element.disabled = true; });
  const story = root.querySelector('.story');
  story.classList.add('thinking');
  try {
    state.run = await request(`/api/runs/${state.run.id}/action`, { method:'POST', body:JSON.stringify(action) });
    updateGame();
  } catch (error) {
    ui.storyError = error.message;
    story.dataset.sig = '';
    renderStory(root, place(state.run.player.locationId));
  } finally {
    ui.busy = false;
    const live = app.querySelector('.game');
    if (live) {
      live.classList.remove('busy');
      live.querySelector('.story')?.classList.remove('thinking');
      live.querySelectorAll('.dock button, .dock textarea').forEach((element) => { element.disabled = false; });
      ui.storyError = '';
    }
  }
}
