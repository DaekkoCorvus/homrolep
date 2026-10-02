import { state, app, request, notify, activeSignal, timeText, clockText, period, place, escapeHtml, isDev } from './core.js';
import { initDevtools, runCommand, openPanel } from './devtools.js';
import { sceneMarkup, applySky, SCENE_META } from './scenes.js';

const ui = { phoneOpen:false, phoneView:'home', busy:false, sceneKey:null, hooks:{} };
const PHONE_APPS = [
  ['profile', 'Perfil', '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-5 5-7 8-7s7 2 8 7"/>'],
  ['map', 'Mapa', '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.500 7 12 7 12Z"/><circle cx="12" cy="10" r="2.500"/>'],
  ['northlife', 'NorthLife', '<path d="M4 5h16v11H9l-5 4Z"/><path d="M8 9h8M8 12h5"/>'],
  ['missions', 'Misiones', '<path d="M6 3v18M6 4h12l-3 4 3 4H6"/>'],
  ['journal', 'Diario', '<path d="M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2Z"/><path d="M10 8h6M10 12h6"/>'],
  ['settings', 'Ajustes', '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>']
];
const SEND_ICON = '<path d="M5 12h14M13 6l6 6-6 6"/>';
const STOP_ICON = '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>';
// Texto del jugador: *acciones* en cursiva tenue, "diálogos" entre comillas, el resto tal cual.
function formatSpeech(text) {
  const pattern = /\*([^*\n]+)\*|"([^"\n]+)"|“([^”\n]+)”|«([^»\n]+)»/g;
  let out = ''; let last = 0; let match;
  const plain = (value) => (value ? `<span class="plain">${escapeHtml(value)}</span>` : '');
  while ((match = pattern.exec(text))) {
    out += plain(text.slice(last, match.index));
    out += match[1] !== undefined ? `<span class="act">${escapeHtml(match[1])}</span>` : `<span class="say">“${escapeHtml(match[2] ?? match[3] ?? match[4])}”</span>`;
    last = pattern.lastIndex;
  }
  return out + plain(text.slice(last));
}

const initial = (name) => escapeHtml(String(name).trim().charAt(0).toUpperCase());
const icon = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

export function enterGame(hooks) {
  if (hooks) ui.hooks = hooks;
  Object.assign(ui, { phoneOpen:false, phoneView:'home', busy:false, sceneKey:null });
  document.getElementById('vortex-layer')?.contentWindow?.postMessage({ type:'vortex', zoom:1, flash:0, rate:2 }, location.origin);
  app.innerHTML = `<main class="game">
    <div class="scene" aria-hidden="true"><div class="scene-art"></div><div class="scene-dust"></div><div class="scene-vignette"></div></div>
    <div class="vn-layer" aria-hidden="true"><img class="vn-main" alt=""></div>
    <div class="place-title" aria-live="polite"></div>
    <header class="hud">
      <div class="hud-left"><div class="clock-pill" role="status"><span class="clock-dot"></span><span class="clock-text"></span></div><button type="button" class="dev-pill" data-dev hidden>DEV</button></div>
      <button class="phone-button" type="button" data-phone aria-label="Abrir teléfono">${icon('<rect x="7" y="2.500" width="10" height="19" rx="2.500"/><path d="M11 18.500h2"/>')}<i class="phone-badge" hidden></i></button>
    </header>
    <section class="story" aria-live="polite"></section>
    <footer class="dock">
      <div class="chips" role="group" aria-label="Acciones del lugar"></div>
      <form class="free-action"><textarea rows="1" maxlength="4000" name="text" aria-label="Acción libre" placeholder="¿Qué haces?" required></textarea><button type="submit" class="send" aria-label="Actuar">${icon(SEND_ICON)}</button></form>
    </footer>
    <div class="sheet-layer" hidden><div class="sheet" role="dialog" aria-label="Moverse"></div></div>
    <div class="phone-layer" hidden><div class="phone" role="dialog" aria-label="Teléfono"><div class="phone-notch"></div><div class="phone-status"><span class="ps-time"></span><span class="ps-net">${escapeHtml(state.world.name)} ▪▪▪</span></div><div class="phone-screen"></div><button class="phone-home" type="button" aria-label="Inicio del teléfono"></button></div></div>
  </main>`;
  wire();
  initDevtools({
    perform, setFx,
    runDev: (body) => request(`/api/runs/${state.run.id}/dev`, { method:'POST', body:JSON.stringify(body) }),
    reload: async () => { try { state.run = await request(`/api/runs/${state.run.id}`); ui.storyError = ''; updateGame(); } catch (error) { notify(error.message); } }
  });
  updateGame({ announce:true });
  const mode = fxMode();
  if (mode === 'lite') app.querySelector('.game').classList.add('fx-lite');
  else if (mode === 'auto') autoTuneFx(app.querySelector('.game'));
}

// Calidad de efectos: «auto» mide los fotogramas y congela la escena animada en equipos lentos.
const fxMode = () => { try { return localStorage.getItem('hom:fx') || 'auto'; } catch { return 'auto'; } };
export function setFx(mode) {
  try { mode === 'auto' ? localStorage.removeItem('hom:fx') : localStorage.setItem('hom:fx', mode); } catch { /* sin almacenamiento */ }
  const root = app.querySelector('.game');
  if (root) { root.classList.toggle('fx-lite', mode === 'lite'); if (mode === 'auto') autoTuneFx(root); }
}

function autoTuneFx(root) {
  let frames = 0; let start = 0;
  const tick = (now) => {
    if (!root.isConnected) return;
    if (!start) start = now;
    frames++;
    if (now - start < 1800) return requestAnimationFrame(tick);
    if (!document.hidden && (frames * 1000) / (now - start) < 48) root.classList.add('fx-lite');
  };
  setTimeout(() => requestAnimationFrame(tick), 1500);
}

function wire() {
  const root = app.querySelector('.game');
  root.querySelector('[data-phone]').onclick = () => togglePhone(true);
  root.querySelector('[data-dev]').onclick = () => openPanel();
  const portrait = root.querySelector('.vn-main');
  portrait.onerror = () => { portrait.removeAttribute('src'); root.classList.remove('has-portrait'); };
  portrait.onload = () => { root.classList.add('has-portrait'); if (portrait.dataset.swap === '1') { portrait.dataset.swap = '0'; return; } portrait.classList.remove('in'); void portrait.offsetWidth; portrait.classList.add('in'); };
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
  form.querySelector('.send').addEventListener('click', (event) => { if (ui.busy) { event.preventDefault(); stopGeneration(); } });
  form.addEventListener('focusin', () => root.classList.add('typing'));
  form.addEventListener('focusout', () => setTimeout(() => { if (!form.contains(document.activeElement)) root.classList.remove('typing'); }, 120));
  const vv = window.visualViewport;
  const fit = () => {
    if (!root.isConnected) return;
    const height = vv ? vv.height : innerHeight;
    root.style.setProperty('--app-h', `${height}px`);
    Object.assign(root.style, { height: `${height}px`, top: `${vv ? vv.offsetTop : 0}px`, bottom: 'auto' });
    const story = root.querySelector('.story');
    if (state.run.encounter) story.scrollTop = story.scrollHeight;
  };
  if (vv) { vv.onresize = fit; vv.onscroll = fit; }
  fit();
  form.onsubmit = (event) => { event.preventDefault(); const text = input.value.trim(); if (!text || ui.busy || state.run.encounter?.closed) return; input.value = ''; grow(); input.blur(); if (text.startsWith('/')) { runCommand(text); return; } if (state.run.encounter) say(text, input); else runAction({ type:'freeform', text }); };
  document.onkeydown = (event) => { if (event.key === 'Escape') { if (!root.querySelector('.sheet-layer').hidden) toggleSheet(false); else if (ui.phoneOpen) togglePhone(false); } };
}

export function updateGame({ announce=false }={}) {
  const root = app.querySelector('.game'); if (!root) return;
  const { run } = state; const loc = place(run.player.locationId);
  const clock = root.querySelector('.clock-text'); clock.textContent = timeText(run.world);
  root.querySelector('.ps-time').textContent = clockText(run.world);
  root.classList.toggle('talking', Boolean(run.encounter));
  root.querySelector('[data-dev]').hidden = !isDev();
  root.classList.toggle('closed', Boolean(run.encounter?.closed));
  root.querySelector('.free-action textarea').placeholder = run.encounter?.closed ? 'La conversación terminó' : run.encounter ? `Dile algo a ${run.encounterNpc.name}…` : '¿Qué haces?';
  renderScene(root, loc, announce);
  renderStory(root, loc);
  renderChips(root, loc);
  renderPortrait(root);
  preloadPortraits();
  if (ui.phoneOpen) renderPhone();
}

// Novela visual: retrato del NPC mientras se conversa. Las emociones llegarán como `portraits[emotion]`.
let portraitTimer = null;
// Mientras se escribe manda la emoción del tramo actual; al terminar (y tras una pausa) vuelve a «default».
// Solo la despedida mantiene su expresión hasta que el jugador pulsa Volver.
const isSticky = (emotion) => (state.run.encounterNpc?.stickyEmotions ?? []).includes(emotion);

function currentEmotion() {
  if (ui.emotion) return ui.emotion;
  if (state.run.encounter) {
    const lastLine = state.run.encounter.lines.filter((line) => line.who === 'npc').at(-1);
    const last = lastLine?.segments?.at(-1)?.emotion;
    // La despedida y las expresiones marcadas como «se mantiene» no vuelven solas a la neutra.
    if (last && (state.run.encounter.closed || isSticky(last))) return last;
  }
  return 'default';
}

function renderPortrait(root) {
  const img = root.querySelector('.vn-main');
  const npc = state.run.encounterNpc;
  const url = npc ? (npc.portraits?.[currentEmotion()] ?? npc.portraits?.default ?? null) : null;
  clearTimeout(portraitTimer);
  if (!url) {
    root.classList.remove('has-portrait');
    // Conserva la imagen mientras se desvanece para que la salida también sea suave.
    portraitTimer = setTimeout(() => img.removeAttribute('src'), 900);
    return;
  }
  for (const other of Object.values(npc.portraits ?? {})) preloadImage(other);
  const shown = img.getAttribute('src');
  if (shown === url) { root.classList.add('has-portrait'); return; }
  if (shown && root.classList.contains('has-portrait')) {
    // Cambio de expresión: corte limpio, sin mezclar fotogramas (las poses no coinciden). Se decodifica antes para evitar parpadeos.
    const probe = new Image(); probe.src = url;
    const swap = () => { if (img.getAttribute('src') !== url) { img.dataset.swap = '1'; img.src = url; } };
    (probe.decode ? probe.decode() : Promise.resolve()).then(swap, swap);
    return;
  }
  img.classList.remove('in'); img.src = url;
}

const preloaded = new Set();
function preloadImage(url) { if (url && !preloaded.has(url)) { preloaded.add(url); new Image().src = url; } }

// Precarga los retratos de quien está presente para que aparezcan sin espera al empezar a hablar.
function preloadPortraits() {
  for (const npc of state.run.presence ?? []) preloadImage(npc.portraits?.default);
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
    title.innerHTML = `<small>${escapeHtml(loc.district)} · ${escapeHtml(state.world.name)}</small><strong>${escapeHtml(loc.name)}</strong>`;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Velocidad del texto: «/texto lento|normal|rapido». Los cambios de expresión hacen una pausa para que se aprecien.
const TEXT_SPEEDS = { lento: 1.6, normal: 1, rapido: 0.55 };
const textSpeed = () => { try { return localStorage.getItem('hom:text') || 'normal'; } catch { return 'normal'; } };
export function setTextSpeed(mode) { try { localStorage.setItem('hom:text', TEXT_SPEEDS[mode] ? mode : 'normal'); } catch { /* sin almacenamiento */ } }
const typingDelay = (character) => (('.!?…'.includes(character) ? 300 : ',;:'.includes(character) ? 150 : 36) * (TEXT_SPEEDS[textSpeed()] ?? 1));
const EMOTION_PAUSE = 450; const EMOTION_HOLD = 2600;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function setEmotion(emotion) {
  ui.emotion = emotion && emotion !== 'default' ? emotion : null;
  const root = app.querySelector('.game');
  if (root) renderPortrait(root);
}

// Muestra la respuesta poco a poco; las marcas de emoción cambian el sprite en el momento exacto. Un toque la completa.
async function revealLine(node, segments, token, { keep = false, onDone } = {}) {
  const textNode = document.createTextNode(''); node.append(textNode);
  const story = node.closest('.story');
  ui.skipReveal = reducedMotion();
  clearTimeout(ui.holdTimer);
  let count = 0; let shown = 'default';
  for (const segment of segments) {
    if (ui.revealToken !== token) return;
    setEmotion(segment.emotion);
    // La expresión cambia primero y el texto espera un instante: así se nota el cambio de sprite.
    if (segment.emotion !== shown && !ui.skipReveal) await sleep(EMOTION_PAUSE * (TEXT_SPEEDS[textSpeed()] ?? 1));
    shown = segment.emotion;
    for (const character of segment.text) {
      if (ui.revealToken !== token) return;
      textNode.data += character;
      if (++count % 6 === 0) story.scrollTop = story.scrollHeight;
      if (!ui.skipReveal) await sleep(typingDelay(character));
    }
  }
  story.scrollTop = story.scrollHeight;
  onDone?.();
  // Terminada la respuesta, la expresión vuelve a la neutra tras una pausa (salvo en la despedida).
  if (!keep && shown !== 'default' && !isSticky(shown)) ui.holdTimer = setTimeout(() => { if (ui.revealToken === token) setEmotion('default'); }, reducedMotion() ? 0 : EMOTION_HOLD);
}

function renderConversation(story) {
  const { lines, startedAt } = state.run.encounter; const npc = state.run.encounterNpc;
  const animate = ui.animateNext; ui.animateNext = false;
  const signature = `talk:${JSON.stringify(lines)}:${ui.pendingLine ?? ''}`;
  if (!animate && story.dataset.sig === signature && !ui.storyError) return;
  story.dataset.sig = signature;
  const token = (ui.revealToken = (ui.revealToken ?? 0) + 1);
  clearTimeout(ui.holdTimer);
  ui.emotion = null;
  const fresh = animate ? lines.findLastIndex((line) => line.who === 'npc') : -1;
  const rows = lines.map((line, index) => {
    if (line.who === 'system') return `<div class="contact-card" ${fresh >= 0 && index > fresh ? 'hidden data-after' : ''}><small>${escapeHtml(line.text)}</small><strong>${escapeHtml(line.handle)}</strong><button type="button" data-copy="${escapeHtml(line.handle)}">Copiar</button><small>Guárdalo en tu Diario o escríbelo en Mensajes para agregarla.</small></div>`;
    if (line.who === 'narrator') return `<p class="dlg narr">${escapeHtml(line.text)}</p>`;
    if (line.who === 'npc') return `<p class="dlg npc"><b>${escapeHtml(npc.name)}</b>${line.gesture ? `<em>${escapeHtml(line.gesture)}</em>` : ''}<span data-index="${index}">${index === fresh ? '' : escapeHtml(line.text)}</span></p>`;
    return `<p class="dlg you">${formatSpeech(line.text)}</p>`;
  });
  if (ui.pendingLine) rows.push(`<p class="dlg you">${formatSpeech(ui.pendingLine)}</p>`);
  story.innerHTML = rows.join('') + (ui.storyError ? `<p class="story-error" role="alert">${escapeHtml(ui.storyError)}</p>` : '');
  story.querySelectorAll('[data-copy]').forEach((button) => button.onclick = async () => { try { await navigator.clipboard.writeText(button.dataset.copy); notify('Copiado.'); } catch { notify(button.dataset.copy); } });
  story.scrollTop = story.scrollHeight;
  if (fresh >= 0) {
    const line = lines[fresh];
    story.onpointerdown = () => { ui.skipReveal = true; };
    revealLine(story.querySelector(`[data-index="${fresh}"]`), line.segments?.length ? line.segments : [{ emotion: 'default', text: line.text }], token, {
      keep: Boolean(state.run.encounter.closed),
      onDone: () => {
        story.querySelectorAll('[data-after]').forEach((card) => { card.hidden = false; });
        story.scrollTop = story.scrollHeight;
      }
    });
  }
}

function renderStory(root, loc) {
  const story = root.querySelector('.story');
  if (state.run.encounter) return renderConversation(story);
  const { lead, paragraphs } = storyContent(loc);
  const signature = lead + paragraphs.join('|');
  if (story.dataset.sig === signature && !ui.storyError) return;
  story.dataset.sig = signature;
  story.innerHTML = `${lead ? `<p class="story-lead">${formatSpeech(lead)}</p>` : ''}${paragraphs.map((p, i) => `<p class="story-line" style="animation-delay:${i * .55}s">${escapeHtml(p)}</p>`).join('')}${ui.storyError ? `<p class="story-error" role="alert">${escapeHtml(ui.storyError)}</p>` : ''}`;
  story.scrollTop = 0;
}

function renderChips(root, loc) {
  const box = root.querySelector('.chips');
  if (state.run.encounter?.closed) {
    box.innerHTML = '<button type="button" class="chip-action primary-chip" data-kind="leave">Volver</button>';
    box.querySelector('button').onclick = leaveTalk;
    return;
  }
  if (state.run.encounter) {
    box.innerHTML = '<button type="button" class="chip-action" data-kind="end">Despedirte</button>';
    box.querySelector('button').onclick = endTalk;
    return;
  }
  const meta = SCENE_META[loc.id];
  const chips = [['move', 'Moverse', null]];
  for (const npc of state.run.presence ?? []) chips.push(['talk', `Hablar con ${npc.name}`, npc.id, npc.name]);
  for (const text of meta?.interactions ?? []) chips.push(['free', text, text]);
  if (loc.id === 'apartment') chips.push(['sleep', 'Dormir', null]);
  if (state.run.player.occupation === 'worker') chips.push(['work', 'Trabajar', null]);
  chips.push(['wait', 'Esperar un rato', null]);
  box.innerHTML = chips.map(([kind, label, text, name]) => `<button type="button" class="chip-action ${kind === 'move' ? 'primary-chip' : ''} ${kind === 'talk' ? 'person' : ''}" data-kind="${kind}" ${text ? `data-text="${escapeHtml(text)}"` : ''}>${kind === 'move' ? `${icon('<path d="M5 12h14M13 6l6 6-6 6"/>')}` : ''}${kind === 'talk' ? `<span class="avatar">${initial(name)}</span>` : ''}${escapeHtml(label)}</button>`).join('');
  box.querySelectorAll('button').forEach((button) => button.onclick = () => {
    const { kind, text } = button.dataset;
    if (kind === 'move') toggleSheet(true);
    else if (kind === 'talk') startTalk(text);
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
    if (state.run.encounter) { notify('Despídete antes de irte.'); return; }
    toggleSheet(false); togglePhone(false);
    runAction({ type:'travel', locationId:button.dataset.travel });
  });
}

function toggleSheet(open) {
  const layer = app.querySelector('.sheet-layer'); if (!layer) return;
  const sheet = layer.querySelector('.sheet');
  app.querySelector('.game').classList.toggle('overlay', open || ui.phoneOpen);
  if (open) { sheet.innerHTML = `<span class="grabber"></span><h2>¿A dónde vas?</h2><div class="place-rows">${placeButtons()}</div>`; bindTravel(sheet); layer.hidden = false; requestAnimationFrame(() => layer.classList.add('open')); }
  else { layer.classList.remove('open'); setTimeout(() => { layer.hidden = true; }, 320); }
}

function togglePhone(open) {
  const layer = app.querySelector('.phone-layer'); if (!layer) return;
  ui.phoneOpen = open;
  app.querySelector('.game').classList.toggle('overlay', open || !app.querySelector('.sheet-layer').hidden);
  if (open) { ui.phoneView = 'home'; renderPhone(); layer.hidden = false; requestAnimationFrame(() => layer.classList.add('open')); }
  else { layer.classList.remove('open'); setTimeout(() => { if (!ui.phoneOpen) layer.hidden = true; }, 380); }
}

function renderPhone() {
  const screen = app.querySelector('.phone-screen'); if (!screen) return;
  const view = ui.phoneView; const run = state.run;
  if (view === 'home') {
    screen.className = 'phone-screen home';
    screen.innerHTML = `<div class="phone-clock"><strong>${clockText(run.world)}</strong><span>Día ${run.world.day} · ${period(run.world.hour)}</span></div><div class="app-grid">${PHONE_APPS.map(([id, label, path]) => `<button type="button" data-app="${id}"><span class="app-icon">${icon(path)}</span>${label}</button>`).join('')}${isDev() ? `<button type="button" data-app="gm"><span class="app-icon">${icon('<path d="M12 3l9 5-9 5-9-5ZM3 13l9 5 9-5"/>')}</span>Notas GM</button>` : ''}</div>`;
    screen.querySelectorAll('[data-app]').forEach((button) => button.onclick = () => openApp(button.dataset.app));
    return;
  }
  const titles = { profile:'Perfil', map:'Mapa', northlife:'NorthLife', missions:'Misiones', journal:'Diario', gm:'Notas del GM' };
  const bodies = { profile:profileApp, map:mapApp, northlife:northlifeApp, missions:() => '<p class="empty">No tienes misiones activas. Las oportunidades llegarán cuando el mundo tenga algo que ofrecerte.</p>', journal:journalApp, gm:gmApp };
  screen.className = 'phone-screen app';
  screen.innerHTML = `<div class="app-bar"><button type="button" data-back aria-label="Volver">${icon('<path d="M15 5l-7 7 7 7"/>')}</button><h2>${titles[view]}</h2></div><div class="app-body">${bodies[view]()}</div>`;
  screen.querySelector('[data-back]').onclick = () => { if (view === 'northlife' && ui.chatWith) ui.chatWith = null; else ui.phoneView = 'home'; renderPhone(); };
  if (view === 'northlife') bindNorthlife(screen);
  bindTravel(screen);
  screen.querySelectorAll('[data-copy]').forEach((button) => button.onclick = async () => { try { await navigator.clipboard.writeText(button.dataset.copy); notify('Copiado.'); } catch { notify(button.dataset.copy); } });
  const contactForm = screen.querySelector('#contact-form');
  if (contactForm) contactForm.onsubmit = async (event) => {
    event.preventDefault();
    const failure = contactForm.querySelector('[data-contact-error]'); failure.textContent = '';
    try {
      state.run = await request(`/api/runs/${state.run.id}/contacts`, { method:'POST', body:JSON.stringify({ handle:new FormData(contactForm).get('handle') }) });
      renderPhone(); notify('Contacto agregado.');
    } catch (error) { failure.textContent = error.message; }
  };
  const post = screen.querySelector('#post-form');
  if (post) post.onsubmit = async (event) => {
    event.preventDefault();
    try { state.run = await request(`/api/runs/${state.run.id}/posts`, { method:'POST', body:JSON.stringify({ text:new FormData(post).get('text') }) }); renderPhone(); notify('Publicación guardada.'); }
    catch (error) { notify(error.message); }
  };
}

function openApp(id) {
  if (id === 'settings') { togglePhone(false); ui.hooks.openSettings?.(); return; }
  ui.phoneView = id; if (id === 'northlife') { ui.nlTab ??= 'feed'; ui.chatWith = null; } renderPhone();
}

function profileApp() {
  const p = state.run.player; const loc = place(p.locationId);
  const gender = p.gender === 'custom' ? p.genderCustom : p.gender === 'man' ? 'Hombre' : p.gender === 'woman' ? 'Mujer' : 'Sin definir';
  const rows = [['Edad', p.age], ['Identidad', gender], ['Raza', 'Humano'], ['Dinero', `$${p.money}`], ['Reputación', p.reputation], ['Ubicación', loc.name], ['Ocupación', p.occupation || 'Por descubrir'], ['Aspiración', p.aspiration || 'Por descubrir']];
  return `<div class="profile-head"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.origin || 'Un pasado aún desconocido.')}</span></div><dl class="stat-rows">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(String(v))}</dd></div>`).join('')}</dl>`;
}

function gmApp() {
  const entries = Object.entries(state.run.relationships ?? {});
  if (!entries.length) return '<p class="empty">Aún no hay relaciones. Habla con alguien.</p>';
  return entries.map(([id, r]) => `<article class="gm-note"><strong>${escapeHtml(id)}</strong><small>afinidad ${r.affinity ?? '?'} · interés ${r.interest ?? '?'} · ${escapeHtml(r.attitude ?? '')} · contacto: ${r.contact ? 'sí' : 'no'} · nombre conocido: ${r.nameKnown ? 'sí' : 'no'}</small>${(r.notes ?? []).map((n) => `<p><b>${n.valence > 0 ? '+' : ''}${n.valence}</b> ${escapeHtml(n.text)}<i>«${escapeHtml(n.evidence)}» ${escapeHtml((n.tags ?? []).join(', '))}</i></p>`).join('')}${(r.history ?? []).map((h) => `<p class="hist">${escapeHtml(h.text)}</p>`).join('')}</article>`).join('');
}

function mapApp() { return `<p class="muted">${escapeHtml(state.world.name)} · toca un lugar para ir</p><div class="place-rows">${placeButtons()}</div>`; }

// ---- NorthLife: feed, chats con contactos y agenda de promesas ------------------------------------------------------------------
const PRIORITY_TEXT = { low: 'Baja', medium: 'Media', high: 'Alta' };
const hourOf = (key) => escapeHtml(String(key ?? '').replace(/^DAY_(\d+)_/, 'Día $1 · '));

function northlifeApp() {
  const pending = (state.run.commitments ?? []).filter((item) => item.status === 'active').length;
  const tabs = [['feed', 'Feed'], ['chats', 'Chats'], ['agenda', 'Agenda']];
  const body = ui.nlTab === 'chats' ? (ui.chatWith ? threadView() : chatsTab()) : ui.nlTab === 'agenda' ? agendaTab() : feedTab();
  return `<nav class="nl-tabs">${tabs.map(([id, label]) => `<button type="button" data-nl="${id}" class="${ui.nlTab === id ? 'active' : ''}">${label}${id === 'agenda' && pending ? ` <i class="nl-badge">${pending}</i>` : ''}</button>`).join('')}</nav>${body}`;
}

function feedTab() {
  const posts = state.run.social.posts.map((post) => `<article class="post"><header><span class="avatar">${initial(post.author)}</span><strong>${escapeHtml(post.author)}</strong><small>${hourOf(post.time)}</small></header><p>${escapeHtml(post.text)}</p></article>`).join('');
  return `<form id="post-form"><textarea name="text" maxlength="280" rows="2" placeholder="¿Qué está pasando?" required></textarea><button type="submit">Publicar</button></form>${posts || '<p class="empty">El feed está en silencio. Agrega contactos para ver lo que publican.</p>'}`;
}

function chatsTab() {
  const contacts = state.run.contacts ?? [];
  const list = contacts.length
    ? contacts.map((npc) => { const last = state.run.chats?.[npc.id]?.at(-1); return `<button type="button" class="contact chat-row" data-chat="${escapeHtml(npc.id)}"><span class="avatar">${initial(npc.name)}</span><span><strong>${escapeHtml(npc.name)}</strong><small>${last ? escapeHtml(last.text.slice(0, 60)) : escapeHtml(npc.role)}</small></span></button>`; }).join('')
    : '<p class="empty">Todavía no tienes contactos. Cuando alguien te comparta su usuario, escríbelo aquí para agregarlo.</p>';
  return `<form id="contact-form"><input name="handle" placeholder="@usuario" autocapitalize="none" autocomplete="off" spellcheck="false" maxlength="30" required><button type="submit">Agregar contacto</button><p class="error" data-contact-error role="alert"></p></form>${list}`;
}

function threadView() {
  const npc = (state.run.contacts ?? []).find((item) => item.id === ui.chatWith);
  if (!npc) return '<p class="empty">Contacto no disponible.</p>';
  const messages = (state.run.chats?.[npc.id] ?? []).map((message) => `<div class="bubble ${message.who === 'player' ? 'you' : 'them'}">${escapeHtml(message.text)}<time>${hourOf(message.time)}</time></div>`);
  if (ui.chatPending) messages.push(`<div class="bubble you">${escapeHtml(ui.chatPending)}</div><div class="bubble them typing"><i></i><i></i><i></i></div>`);
  return `<div class="thread-head"><span class="avatar">${initial(npc.name)}</span><strong>${escapeHtml(npc.name)}</strong></div><div class="thread">${messages.join('') || '<p class="empty">Aún no hay mensajes. Saluda.</p>'}</div>
    <form id="chat-form"><textarea name="text" rows="1" maxlength="4000" placeholder="Escribe un mensaje…" required></textarea><button type="submit" class="send-chat" aria-label="${ui.chatBusy ? 'Detener' : 'Enviar'}">${icon(ui.chatBusy ? STOP_ICON : SEND_ICON)}</button></form><p class="error" data-chat-error role="alert"></p>`;
}

function agendaTab() {
  const items = state.run.commitments ?? [];
  const row = (item) => `<div class="promise ${item.status} p-${item.priority}"><span class="p-flag">${PRIORITY_TEXT[item.priority]}</span><div><strong>${escapeHtml(item.text)}</strong><small>${escapeHtml(item.npcName)}${item.place ? ` · ${escapeHtml(place(item.place)?.name ?? item.place)}` : ''}${item.dueText ? ` · ${escapeHtml(item.dueText)}` : ''}</small></div></div>`;
  const active = items.filter((item) => item.status === 'active').sort((x, y) => (x.dueMin ?? 1e9) - (y.dueMin ?? 1e9));
  const done = items.filter((item) => item.status !== 'active').slice(-8).reverse();
  const label = { kept: 'Cumplida', broken: 'Incumplida', cancelled: 'Cancelada' };
  return (active.length ? `<h3 class="nl-h">Pendientes</h3>${active.map(row).join('')}` : '<p class="empty">No tienes promesas ni citas pendientes. Solo se anotan cuando tú y la otra persona llegan a un acuerdo.</p>')
    + (done.length ? `<h3 class="nl-h">Historial</h3>${done.map((item) => `${row(item)}<small class="p-state ${item.status}">${label[item.status]}</small>`).join('')}` : '');
}

function bindNorthlife(screen) {
  screen.querySelectorAll('[data-nl]').forEach((button) => button.onclick = () => { ui.nlTab = button.dataset.nl; ui.chatWith = null; renderPhone(); });
  screen.querySelectorAll('[data-chat]').forEach((button) => button.onclick = () => { ui.chatWith = button.dataset.chat; renderPhone(); });
  const thread = screen.querySelector('.thread'); if (thread) thread.scrollTop = thread.scrollHeight;
  const form = screen.querySelector('#chat-form'); if (!form) return;
  form.querySelector('.send-chat').addEventListener('click', (event) => { if (ui.chatBusy) { event.preventDefault(); ui.chatAbort?.abort(); } });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (ui.chatBusy) return;
    const text = new FormData(form).get('text').toString().trim(); if (!text) return;
    const npcId = ui.chatWith;
    ui.chatBusy = true; ui.chatPending = text; ui.chatAbort = new AbortController(); activeSignal.current = ui.chatAbort.signal;
    renderPhone();
    try {
      state.run = await request(`/api/runs/${state.run.id}/chat`, { method: 'POST', body: JSON.stringify({ npcId, text }) });
    } catch (error) {
      if (error.name !== 'AbortError') ui.chatError = error.message; else notify('Mensaje detenido.');
      await reloadRun();
    } finally { activeSignal.current = null; ui.chatBusy = false; ui.chatPending = null; ui.chatAbort = null; updateGame(); renderPhone(); const failure = app.querySelector('[data-chat-error]'); if (failure && ui.chatError) { failure.textContent = ui.chatError; ui.chatError = ''; } }
  };
}

const npcName = (id) => state.run.sharedContacts?.find((npc) => npc.id === id)?.name ?? state.run.contacts?.find((npc) => npc.id === id)?.name ?? state.run.encounterNpc?.name ?? state.run.presence?.find((npc) => npc.id === id)?.name ?? id;

function eventText(event) {
  const name = (id) => escapeHtml(place(id)?.name || id);
  if (event.type === 'run_started') return 'La partida comenzó en Porta Magna.';
  if (event.type === 'prologue_created') return `Tu historia comenzó en ${name(event.data.locationId)}.`;
  if (event.type === 'location_changed') return `Viajaste de ${name(event.from)} a ${name(event.to)}.`;
  if (event.type === 'player_action') return escapeHtml(event.data.text);
  if (event.type === 'time_waited') return `Esperaste ${event.data.minutes} minutos.`;
  if (event.type === 'slept') return 'Dormiste ocho horas.';
  if (event.type === 'worked') return `Trabajaste y ganaste $${event.data.earned}.`;
  if (event.type === 'social_post_created') return 'Publicaste en la red social.';
  if (event.type === 'commitment_made') return `Quedaste en algo con ${escapeHtml(npcName(event.data.npcId))}: ${escapeHtml(event.data.text)}`;
  if (event.type === 'commitment_kept') return `Cumpliste: ${escapeHtml(event.data.text)}`;
  if (event.type === 'commitment_broken') return `No cumpliste: ${escapeHtml(event.data.text)}`;
  if (event.type === 'commitment_cancelled') return `Cancelado: ${escapeHtml(event.data.text)}`;
  if (event.type === 'contact_shared') return `${escapeHtml(npcName(event.data.npcId))} te compartió su contacto: ${escapeHtml(event.data.handle)}`;
  if (event.type === 'contact_added') return `Agregaste a ${escapeHtml(npcName(event.data.npcId))} a tus contactos.`;
  if (event.type === 'conversation_started') return 'Empezaste a hablar con alguien.';
  if (event.type === 'conversation_ended') return event.data.contact ? 'Terminaste una conversación y conseguiste un contacto.' : 'Terminaste una conversación.';
  return escapeHtml(event.type);
}

function sharedContactsHtml() {
  const shared = state.run.sharedContacts ?? [];
  if (!shared.length) return '';
  return `<section class="shared-contacts"><h3>Contactos recibidos</h3>${shared.map((item) => `<div class="shared"><span><strong>${escapeHtml(item.name)}</strong><code>${escapeHtml(item.handle)}</code></span><em>${item.added ? 'Agregado' : 'Sin agregar'}</em><button type="button" data-copy="${escapeHtml(item.handle)}">Copiar</button></div>`).join('')}<p class="empty">Escribe el usuario en Mensajes para agregarlo.</p></section>`;
}

function journalApp() {
  const items = state.run.eventLog.slice(-30).reverse().map((event) => `<div class="entry"><time>${escapeHtml(event.time.replace('DAY_', 'Día ').replace('_', ' · '))}</time>${event.data?.response ? `<details><summary>${eventText(event)}</summary><p>${escapeHtml(event.data.response)}</p></details>` : `<p>${eventText(event)}</p>`}</div>`).join('');
  return sharedContactsHtml() + (items || '<p class="empty">Todavía no hay nada que recordar.</p>');
}

function setSendMode(busy) {
  const button = app.querySelector('.free-action .send');
  if (!button) return;
  button.innerHTML = icon(busy ? STOP_ICON : SEND_ICON);
  button.setAttribute('aria-label', busy ? 'Detener' : 'Actuar');
  button.classList.toggle('stop', busy);
  button.disabled = false;
}

function stopGeneration() { ui.controller?.abort(); }

async function reloadRun() {
  try { state.run = await request(`/api/runs/${state.run.id}`); } catch { /* se queda con el estado actual */ }
  updateGame();
}

// Ejecuta una operación del servidor (con IA). Mientras dura, el botón de enviar pasa a ser «detener».
async function perform(operation, { onError, animate = false } = {}) {
  if (ui.busy) return;
  ui.busy = true; ui.storyError = '';
  ui.controller = new AbortController();
  activeSignal.current = ui.controller.signal;
  const root = app.querySelector('.game');
  root.classList.add('busy');
  root.querySelectorAll('.dock button:not(.send), .dock textarea').forEach((element) => { element.disabled = true; });
  setSendMode(true);
  const story = root.querySelector('.story');
  story.classList.add('thinking');
  let stopped = false;
  const before = { made: (state.run.commitments ?? []).length, broken: (state.run.commitments ?? []).filter((item) => item.status === 'broken').length };
  try {
    state.run = await operation();
    const after = state.run.commitments ?? [];
    if (after.length > before.made) notify('Anotado en tu Agenda de NorthLife.');
    else if (after.filter((item) => item.status === 'broken').length > before.broken) notify('Incumpliste un compromiso. Revisa tu Agenda.');
    ui.pendingLine = null;
    ui.animateNext = animate;
    updateGame();
    ui.animateNext = false;
  } catch (error) {
    ui.pendingLine = null;
    onError?.();
    story.dataset.sig = '';
    if (error.name === 'AbortError') { stopped = true; } else {
      ui.storyError = error.message;
      renderStory(root, place(state.run.player.locationId));
    }
  } finally {
    activeSignal.current = null; ui.controller = null;
    const live = app.querySelector('.game');
    if (live) {
      live.classList.remove('busy');
      live.querySelector('.story')?.classList.remove('thinking');
      live.querySelectorAll('.dock button:not(.send), .dock textarea').forEach((element) => { element.disabled = false; });
      setSendMode(false);
    }
    ui.busy = false;
    if (stopped) { notify('Generación detenida.'); await reloadRun(); }
    ui.storyError = '';
  }
}

const runAction = (action) => perform(() => request(`/api/runs/${state.run.id}/action`, { method:'POST', body:JSON.stringify(action) }), { animate: action.type === 'freeform' });
const talkRequest = (body) => request(`/api/runs/${state.run.id}/talk`, { method:'POST', body:JSON.stringify(body) });
const startTalk = (npcId) => perform(() => talkRequest({ op:'start', npcId }), { animate:true });
const endTalk = () => perform(() => talkRequest({ op:'end' }), { animate:true });
const leaveTalk = () => perform(() => talkRequest({ op:'leave' }));
function say(text, input) {
  ui.pendingLine = text;
  const root = app.querySelector('.game');
  renderStory(root, place(state.run.player.locationId));
  perform(() => talkRequest({ op:'say', text }), { onError: () => { input.value = text; }, animate:true });
}
