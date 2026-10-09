// Mapa del juego (solo lectura): UN componente que abren el verbo «Ir» y la app Mapa del teléfono. Dibuja el mapa que el autor edita (/api/world/map) con el estilo
// nocturno del editor —es el aspecto oficial y no cambia con la hora— y deja viajar tocando un lugar. El motor manda: los minutos y las distancias vienen de
// /api/runs/:id/map (los calcula el servidor), el viaje es la acción `travel` y la animación nunca da por hecho el resultado.
//
// Móvil primero: pellizcar, arrastrar con un dedo y doble toque (MapView), zonas táctiles de 24 px o más, nombres que no se pisan, DPR limitado a ×2,
// repintado con requestAnimationFrame (durante un gesto se transforma el último dibujo y se repinta al asentarse) y vista de lista como respaldo.
import { MapView } from '/mapview.js';
import { generateFill, contextFor } from '/shared/mapGen.js';
import { THEMES } from '/shared/mapStyle.js';
import { Terrain } from '/shared/mapTerrain.js';
import { polygonCentroid } from '/shared/geo.js';
import { renderScene, PostProcessor } from '/maprender.js';
import { state, request, escapeHtml, notify, timeText } from './core.js';

const KIND_LABEL = { home: 'Vivienda', food: 'Comida y bebida', shop: 'Tienda', poi: 'Lugar de interés', transport: 'Transporte', gateway: 'Puerta', other: 'Lugar' };
const ICON = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  locate: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3.3M12 18.2v3.3M2.5 12h3.3M18.2 12h3.3"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M12 8l-2.5 4.5 2.8 2.2-1 5.3M12 8l3 3 3 .6M9.5 12.5L7 14.5"/>'
};
const svg = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const pad = (value) => String(value).padStart(2, '0');
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const idle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const clockOf = (minutes) => `${pad(Math.floor((minutes % 1440) / 60))}:${pad(Math.floor(minutes % 60))}`;
const distanceText = (meters) => (meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`);
const isOpen = (hours, hour) => !hours || (hour >= hours.open && hour < hours.close);
const hourText = (hour) => `${pad(hour)}:00`;
// Hora de llegada si sales ahora: la que muestra el reloj del mundo + los minutos que calcula el motor.
function arrivalOf(world, minutes) {
  const total = world.hour * 60 + world.minute + minutes;
  return { text: clockOf(total), next: Math.floor(total / 1440) > 0, hour: Math.floor((total % 1440) / 60), total };
}

// --- Datos del mapa en memoria: se piden de nuevo solo cuando el autor lo guarda (cambia `version`) --------------------------------------------------
let cache = { version: null, map: null, terrain: null, results: new Map(), filling: null };

async function mapData(version) {
  if (cache.map && cache.version === version) return cache;
  const body = await request('/api/world/map');
  cache = { version: body.version, map: body.map, terrain: new Terrain(body.map.terrain ?? null), results: new Map(), filling: null };
  return cache;
}

// Relleno (manzanas y casas) de cada área, generado poco a poco para no bloquear el móvil. Se hace una sola vez por versión del mapa.
function fillAreas(data, onProgress) {
  if (data.filling) return data.filling;
  data.filling = (async () => {
    for (const area of data.map.areas) {
      if (!area.fill || area.fill.pattern === 'none' || area.polygon.length < 3) continue;
      await idle();
      try { data.results.set(area.id, generateFill(area, contextFor(area, data.map))); } catch { /* un área rota no impide ver el resto */ }
      onProgress?.();
    }
  })();
  return data.filling;
}

// --- Apertura -----------------------------------------------------------------------------------------------------------------------------------
// host: el elemento del juego donde se monta la capa · options: { getRun, travel(placeId) → {ok, error}, cancel(), onClose({ arrived }) }
export async function openWorldMap(host, options) {
  const opener = document.activeElement;
  // Primero los datos (el servidor calcula distancias y minutos): si algo falla no se llega a abrir nada y la interfaz no queda bloqueada.
  let trip; let data;
  try {
    trip = await request(`/api/runs/${options.getRun().id}/map`);
    state.world = trip.world;                      // los nombres y lugares que ve el jugador son siempre los del mapa vigente
    data = await mapData(trip.version);
  } catch (error) { notify(error.message || 'No se pudo cargar el mapa.'); return null; }
  const layer = document.createElement('div');
  layer.className = 'wm';
  layer.setAttribute('role', 'dialog'); layer.setAttribute('aria-modal', 'true'); layer.setAttribute('aria-label', 'Mapa');
  layer.innerHTML = `
    <header class="wm-bar">
      <button type="button" class="wm-close" aria-label="Cerrar el mapa" data-close>${svg(ICON.close)}</button>
      <div class="wm-title"><strong data-world></strong><small data-clock></small></div>
      <div class="wm-tabs" role="tablist" aria-label="Vista"><button type="button" role="tab" data-view="map" aria-selected="true">Mapa</button><button type="button" role="tab" data-view="list" aria-selected="false">Lista</button></div>
    </header>
    <div class="wm-stage">
      <div class="wm-map"></div>
      <div class="wm-pins" aria-hidden="true"><svg class="wm-route" hidden><line class="base"/><line class="done"/></svg></div>
      <button type="button" class="wm-center" data-center aria-label="Centrar en mí">${svg(ICON.locate)}</button>
      <p class="wm-loading" role="status">Cargando el mapa…</p>
      <div class="wm-list" hidden></div>
    </div>
    <section class="wm-sheet" tabindex="-1" hidden></section>`;
  host.append(layer);
  const siblings = [...host.children].filter((node) => node !== layer && !node.inert);
  siblings.forEach((node) => { node.inert = true; });

  const q = (selector) => layer.querySelector(selector);
  const mapNode = q('.wm-map'); const pinsNode = q('.wm-pins'); const sheet = q('.wm-sheet'); const listNode = q('.wm-list'); const loading = q('.wm-loading');
  const clockNode = q('[data-clock]'); const routeNode = q('.wm-route');
  const lite = host.classList.contains('fx-lite');

  let closed = false; let traveling = null; let selectedId = null; let viewMode = 'map'; let rows = new Map();
  let here = trip.from; let me = { x: 0, y: 0 };

  const view = new MapView(mapNode, { drag: true, doubleTapZoom: true, minZoom: 0.04, maxZoom: 2.5, maxRatio: lite ? 1 : 2 });
  const theme = THEMES.night;
  const scene = document.createElement('canvas');
  let post = null; let plain = lite;
  mapNode.classList.toggle('post', false);

  // --- Cabecera y reloj ---------------------------------------------------------------------------------------------------------------------------
  const run = () => options.getRun();
  const showClock = (extraMinutes = 0) => {
    const world = traveling?.base ?? run().world; const total = world.hour * 60 + world.minute + extraMinutes;   // durante el viaje, la hora de salida (la partida ya puede tener la de llegada)
    clockNode.textContent = `Día ${world.day + Math.floor(total / 1440)} · ${clockOf(total)}`;
  };

  // --- Datos ---------------------------------------------------------------------------------------------------------------------------------------
  q('[data-world]').textContent = trip.world.name;
  rows = new Map(trip.world.locations.map((loc) => [loc.id, { ...loc, ...(trip.places.find((row) => row.id === loc.id) ?? { minutes: 0, meters: 0, tooFar: false, usual: [] }) }]));
  showClock();
  const hereRow = () => rows.get(here);
  me = { x: hereRow()?.x ?? 0, y: hereRow()?.y ?? 0 };

  // --- Marcadores ------------------------------------------------------------------------------------------------------------------------------------
  const pins = [...rows.values()].map((row) => {
    const el = document.createElement('div');
    el.className = `wm-pin${row.id === here ? ' here' : ''}`;
    el.innerHTML = `<i class="dot"></i><span class="label">${escapeHtml(row.name)}</span>`;
    pinsNode.append(el);
    return { row, el, label: el.querySelector('.label'), w: 0 };
  });
  const meNode = document.createElement('div'); meNode.className = 'wm-me'; meNode.innerHTML = '<i></i>'; pinsNode.append(meNode);
  const districts = data.map.districts.filter((district) => district.polygon.length >= 3).map((district) => {
    const el = document.createElement('div'); el.className = 'wm-district'; el.textContent = district.name; pinsNode.prepend(el);
    return { el, center: polygonCentroid(district.polygon) };
  });

  // Coloca marcadores y etiquetas. Las etiquetas que se pisarían se ocultan (gana la del lugar elegido, luego la de donde estás, luego la más cercana a ti).
  function layoutPins() {
    const { width, height } = view.rect;
    mapNode.dataset.k = view.k.toFixed(4);   // zoom actual (píxeles por metro): útil para depurar y para las pruebas
    const rank = (pin) => (pin.row.id === selectedId ? -2 : pin.row.id === here ? -1 : pin.row.meters);
    const taken = [];
    const fits = (box) => !taken.some((other) => box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y);
    const sorted = [...pins].sort((a, b) => rank(a) - rank(b));
    for (const pin of sorted) {
      const p = view.toScreen(pin.row.x, pin.row.y);
      const onScreen = p.x > -40 && p.x < width + 40 && p.y > -30 && p.y < height + 30;
      pin.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      pin.el.hidden = !onScreen;
      if (!onScreen) continue;
      pin.w ||= pin.label.offsetWidth || 80;
      const right = { x: p.x + 10, y: p.y - 10, w: pin.w + 6, h: 20 }; const left = { x: p.x - 10 - pin.w - 6, y: p.y - 10, w: pin.w + 6, h: 20 };
      const dot = { x: p.x - 8, y: p.y - 8, w: 16, h: 16 };
      let side = null;
      if (fits(right)) side = 'right'; else if (fits(left)) side = 'left';
      pin.el.dataset.side = side ?? 'none';
      pin.label.hidden = !side;
      taken.push(dot); if (side) taken.push(side === 'right' ? right : left);
    }
    const m = view.toScreen(me.x, me.y);
    meNode.style.transform = `translate3d(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px,0)`;
    for (const district of districts) {
      const p = view.toScreen(district.center.x, district.center.y);
      district.el.style.transform = `translate3d(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px,0)`;
      district.el.style.opacity = view.k < 0.3 ? String(clamp((0.3 - view.k) / 0.12, 0, 0.85)) : '0';
    }
    if (traveling) drawRoute();
  }

  // --- Pintado ---------------------------------------------------------------------------------------------------------------------------------------
  let drawn = null; let lastCost = 16; let frame = 0; let settle = 0; let lastEnd = 0; let lowRes = lite;
  const target = () => (mapNode.classList.contains('post') ? view.final : view.canvas);

  function paint() {
    frame = 0;
    if (closed || viewMode !== 'map') return;
    const { width, height } = view.rect; if (!width || !height) return;
    const started = performance.now();
    const ratio = Math.min(window.devicePixelRatio || 1, lowRes ? 1 : 2);
    const v = { k: view.k, tx: view.tx, ty: view.ty, width, height };
    const w = Math.round(width * ratio); const h = Math.round(height * ratio);
    if (!plain && !post) { post = new PostProcessor(view.final); if (!post.ok) { plain = true; post = null; } }
    mapNode.classList.toggle('post', !plain);
    let ctx;
    if (plain) { view.maxRatio = ratio; ctx = view.beginCanvas(); } else {
      if (scene.width !== w || scene.height !== h) { scene.width = w; scene.height = h; }
      ctx = scene.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    renderScene(ctx, v, data.map, data.results, theme, { labels: false, terrain: data.terrain, lite: plain });
    if (!plain) post.apply(scene, theme.post, [view.tx * ratio, view.ty * ratio]);
    for (const canvas of [view.canvas, view.final]) { canvas.style.transform = ''; }
    drawn = { k: view.k, tx: view.tx, ty: view.ty };
    lastCost = performance.now() - started; lastEnd = performance.now();
    mapNode.dataset.paintMs = lastCost.toFixed(0); mapNode.dataset.mode = plain ? 'plain' : 'post';
  }

  // Ritmo de cuadros durante un gesto (pellizcar, arrastrar). Si baja de ~30 fps se quita el postproceso WebGL y se queda el tema `night` plano; si aun así
  // va lento, se baja también la resolución. Mide el cuadro real (incluye el trabajo de la GPU), no solo el tiempo de JavaScript.
  const meter = { running: false, frames: 0, start: 0, slow: false };
  function watchFrames(now) {
    if (closed) { meter.running = false; return; }
    if (now - lastView > 220) { meter.running = false; meter.frames = 0; meter.start = 0; return; }       // el gesto terminó: la ventana de medida se descarta
    meter.frames++; if (!meter.start) meter.start = now;
    if (now - meter.start >= 1000) {
      const fps = (meter.frames * 1000) / (now - meter.start);
      mapNode.dataset.fps = fps.toFixed(0);
      meter.slow = fps < 40;   // con cuadros lentos no se repinta a mitad de gesto: se transforma el último dibujo y se repinta al asentarse
      if (fps < 30) {
        if (!plain) { plain = true; post = null; mapNode.classList.remove('post'); mapNode.dataset.mode = 'plain'; }
        else if (!lowRes) lowRes = true;
        schedule();
      }
      meter.frames = 0; meter.start = now;
    }
    requestAnimationFrame(watchFrames);
  }
  let lastView = 0;
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }

  // Mientras dura un gesto se transforma el último dibujo (barato) y se repinta de verdad cada pocos cuadros y al asentarse.
  function onView() {
    lastView = performance.now();
    if (!meter.running) { meter.running = true; requestAnimationFrame(watchFrames); }
    layoutPins();
    if (!drawn || viewMode !== 'map') { schedule(); return; }
    const s = view.k / drawn.k; const canvas = target();
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = `translate(${(view.tx - drawn.tx * s).toFixed(2)}px,${(view.ty - drawn.ty * s).toFixed(2)}px) scale(${s.toFixed(5)})`;
    clearTimeout(settle); settle = setTimeout(schedule, 130);
    if (!meter.slow && performance.now() - lastEnd > Math.max(450, lastCost * 6)) schedule();   // repintado intermedio poco frecuente: lo caro es rasterizar el canvas, no calcularlo
  }
  view.on('view', onView);

  // --- Encuadre ----------------------------------------------------------------------------------------------------------------------------------------
  // Centrado en el jugador y con zoom de barrio: lo bastante cerca para ver calles, lo bastante lejos para ver el lugar más próximo.
  function neighbourhood() {
    const { width } = view.rect; const nearest = Math.min(...[...rows.values()].filter((row) => row.id !== here).map((row) => row.meters), 4000);
    return clamp(width / clamp(nearest * 1.6, 520, 4500), 0.09, 0.8);
  }
  const frameMe = (animate = true) => view.flyTo(view.frameAt(me.x, me.y, neighbourhood()), animate ? 450 : 0);
  q('[data-center]').onclick = () => { if (!traveling) frameMe(); };

  // --- Toques -------------------------------------------------------------------------------------------------------------------------------------------
  const HIT = 26;      // radio táctil en píxeles (más de 22)
  view.on('tap', ({ x, y }) => {
    if (traveling) return;
    let best = null; let bestD = HIT;
    for (const pin of pins) { const p = view.toScreen(pin.row.x, pin.row.y); const d = Math.hypot(p.x - x, p.y - y); if (d <= bestD) { best = pin.row.id; bestD = d; } }
    if (best) select(best); else deselect();
  });

  // --- Hoja del lugar -----------------------------------------------------------------------------------------------------------------------------------
  function sheetHtml(row) {
    const world = run().world; const arrival = arrivalOf(world, row.minutes);
    const nowOpen = isOpen(row.hours, world.hour); const arrivesOpen = isOpen(row.hours, arrival.hour);
    const isHere = row.id === here; const talking = Boolean(run().encounter);
    const status = !row.hours ? '' : `<p class="wm-status ${nowOpen ? 'open' : 'closed'}">${nowOpen ? `Abierto · cierra a las ${hourText(row.hours.close)}` : `Cerrado · abre a las ${hourText(row.hours.open)}`}${!isHere && nowOpen !== arrivesOpen ? ` <b>${arrivesOpen ? 'Estará abierto cuando llegues' : 'Estará cerrado cuando llegues'}</b>` : ''}</p>`;
    const usual = row.usual?.length ? `<p class="wm-usual">Suele estar aquí: ${row.usual.map((person) => escapeHtml(person.name)).join(', ')}</p>` : '';
    const facts = isHere ? '' : `<dl class="wm-facts"><div><dt>Distancia</dt><dd>${distanceText(row.meters)}</dd></div><div><dt>A pie</dt><dd>${row.minutes} min</dd></div><div><dt>Llegarías</dt><dd>${arrival.text}${arrival.next ? '<small> (día siguiente)</small>' : ''}</dd></div></dl>`;
    let note = '';
    if (isHere) note = '<p class="wm-note">Estás aquí.</p>';
    else if (talking) note = '<p class="wm-note warn">Despídete antes de irte.</p>';
    else if (row.tooFar) note = '<p class="wm-note warn">Está demasiado lejos para ir a pie en un solo tramo.</p>';
    const disabled = isHere || talking || row.tooFar;
    return `<span class="wm-grabber"></span>
      <header><div><h2>${escapeHtml(row.name)}</h2><p class="wm-sub">${escapeHtml(row.district)} · ${escapeHtml(KIND_LABEL[row.kind] ?? KIND_LABEL.other)}</p></div><button type="button" class="wm-sheet-close" data-deselect aria-label="Cerrar la ficha del lugar">${svg(ICON.close)}</button></header>
      ${status}${row.description ? `<p class="wm-desc">${escapeHtml(row.description)}</p>` : ''}${facts}${usual}${note}
      <p class="wm-error" role="alert" data-error hidden></p>
      <button type="button" class="wm-go" data-go="${escapeHtml(row.id)}" ${disabled ? 'disabled' : ''}>${isHere ? 'Estás aquí' : `${svg(ICON.walk)}Ir · ${row.minutes} min`}</button>`;
  }

  function select(id, { fly = true } = {}) {
    const row = rows.get(id); if (!row) return;
    selectedId = id;
    sheet.hidden = false; sheet.innerHTML = sheetHtml(row);
    requestAnimationFrame(() => sheet.classList.add('open'));
    sheet.querySelector('[data-deselect]').onclick = deselect;
    sheet.querySelector('[data-go]').onclick = () => go(id);
    pins.forEach((pin) => pin.el.classList.toggle('selected', pin.row.id === id));
    listNode.querySelectorAll('[data-pick]').forEach((button) => button.classList.toggle('selected', button.dataset.pick === id));
    layoutPins();
    // El mapa se desplaza si la hoja taparía el marcador (que quede en la mitad de arriba).
    if (fly && viewMode === 'map') requestAnimationFrame(() => {
      const { height } = view.rect; const p = view.toScreen(row.x, row.y); const room = height - sheet.offsetHeight - 48;
      if (p.y > room || p.y < 40 || p.x < 30 || p.x > view.rect.width - 30) view.flyTo({ k: view.k, tx: view.tx + (view.rect.width / 2 - p.x) * 0.6, ty: view.ty + (Math.min(room, height * 0.4) - p.y) }, 300);
    });
    sheet.focus({ preventScroll: true });
  }
  function deselect() {
    if (traveling) return;
    selectedId = null; sheet.classList.remove('open');
    pins.forEach((pin) => pin.el.classList.remove('selected'));
    listNode.querySelectorAll('.selected').forEach((button) => button.classList.remove('selected'));
    setTimeout(() => { if (!selectedId) sheet.hidden = true; }, 260);
    layoutPins();
  }

  // --- Vista de lista (misma información, para accesibilidad y equipos lentos) -----------------------------------------------------------------------
  function renderList() {
    const world = run().world;
    const ordered = [...rows.values()].sort((a, b) => (a.id === here ? -1 : b.id === here ? 1 : a.minutes - b.minutes));
    listNode.innerHTML = `<p class="wm-list-head">${escapeHtml(state.world.name)} · ${escapeHtml(timeText(world))}</p><ul>${ordered.map((row) => {
      const open = isOpen(row.hours, world.hour);
      return `<li><button type="button" class="place-row${row.id === here ? ' current' : ''}${row.id === selectedId ? ' selected' : ''}" data-pick="${escapeHtml(row.id)}"><span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.district)}${row.hours ? ` · ${open ? 'Abierto' : 'Cerrado'}` : ''}</small></span><em>${row.id === here ? 'Estás aquí' : `${row.minutes} min · llegas ${arrivalOf(world, row.minutes).text}`}</em></button></li>`;
    }).join('')}</ul>`;
    listNode.querySelectorAll('[data-pick]').forEach((button) => { button.onclick = () => select(button.dataset.pick, { fly: false }); });
  }
  function setView(mode) {
    if (traveling) return;
    viewMode = mode;
    layer.querySelectorAll('[data-view]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.view === mode)));
    layer.classList.toggle('list-mode', mode === 'list');
    listNode.hidden = mode !== 'list';
    if (mode === 'list') renderList(); else { schedule(); layoutPins(); }
  }
  layer.querySelectorAll('[data-view]').forEach((tab) => { tab.onclick = () => setView(tab.dataset.view); });

  // --- Viaje -----------------------------------------------------------------------------------------------------------------------------------------
  function drawRoute() {
    const a = view.toScreen(traveling.from.x, traveling.from.y); const b = view.toScreen(traveling.to.x, traveling.to.y); const m = view.toScreen(me.x, me.y);
    const set = (line, p, q) => { line.setAttribute('x1', p.x); line.setAttribute('y1', p.y); line.setAttribute('x2', q.x); line.setAttribute('y2', q.y); };
    set(routeNode.querySelector('.base'), a, b); set(routeNode.querySelector('.done'), a, m);
  }
  const setProgress = (p) => {
    me = { x: traveling.from.x + (traveling.to.x - traveling.from.x) * p, y: traveling.from.y + (traveling.to.y - traveling.from.y) * p };
    showClock(traveling.minutes * p);
    layoutPins();
  };

  async function go(id) {
    const row = rows.get(id);
    if (traveling || !row || id === here || run().encounter || row.tooFar) return;
    const from = { x: me.x, y: me.y }; const to = { x: row.x, y: row.y };
    traveling = { id, from, to, minutes: row.minutes, base: { ...run().world } };
    layer.classList.add('traveling');
    const progress = layer.querySelector('.wm-sheet');
    progress.innerHTML = `<span class="wm-grabber"></span><header><div><h2>Camino a ${escapeHtml(row.name)}</h2><p class="wm-sub">${distanceText(row.meters)} · ${row.minutes} min a pie</p></div></header>
      <p class="wm-status open" data-state>En camino… llegarás a las ${arrivalOf(run().world, row.minutes).text}.</p><div class="wm-bar-progress" aria-hidden="true"><i></i></div><button type="button" class="wm-go ghost" data-cancel>Cancelar</button>`;
    progress.querySelector('[data-cancel]').onclick = () => options.cancel?.();
    routeNode.removeAttribute('hidden');
    // La petición sale ya; el marcador recorre el trayecto mientras tanto, pero no llega hasta que el servidor confirme.
    let result = null;
    const asked = Promise.resolve(options.travel(id)).then((value) => { result = value; }, (error) => { result = { ok: false, error: error.message }; });
    const duration = reduced() ? 0 : Math.round(1500 + Math.min(1500, (row.meters / 2000) * 1500));
    if (!reduced()) {
      const cx = (from.x + to.x) / 2; const cy = (from.y + to.y) / 2;
      const { width, height } = view.rect; const room = Math.max(height - progress.offsetHeight - 24, height * 0.4);
      const k = clamp(Math.min(width / (Math.abs(to.x - from.x) * 1.5 + 1), room / (Math.abs(to.y - from.y) * 1.5 + 1), 0.8), 0.05, 0.8);
      await view.flyTo({ k, tx: width / 2 - cx * k, ty: room / 2 - cy * k }, 450);
    }
    const bar = progress.querySelector('.wm-bar-progress i');
    const started = performance.now(); let reached = 0;
    while (!closed) {
      const t = duration ? Math.min(1, (performance.now() - started) / duration) : 1;
      if (result?.ok !== false) reached = Math.max(reached, Math.min(ease(t), result?.ok ? 1 : 0.92));
      setProgress(reached); bar.style.width = `${Math.round(reached * 100)}%`;
      if (result?.ok === false) break;
      if (t >= 1 && result) break;
      if (t >= 1) progress.querySelector('[data-state]').textContent = 'Llegando…';
      await nextFrame();
    }
    await asked;
    if (closed) return;
    if (result?.ok) {
      if (!reduced()) for (let t = 0; t < 1; t += 0.12) { setProgress(reached + (1 - reached) * ease(t)); await nextFrame(); }
      setProgress(1);
      traveling = null; here = id; me = { ...to };
      showClock();
      await dismiss({ arrived: true });
      return;
    }
    // Falló (o se canceló): el marcador vuelve al origen y se muestra el error. Nada de lo animado cuenta.
    if (!reduced()) { const back = reached; for (let t = 0; t < 1; t += 0.1) { setProgress(back * (1 - ease(t))); await nextFrame(); } }
    setProgress(0);
    me = { ...from }; traveling = null; routeNode.setAttribute('hidden', ''); layer.classList.remove('traveling');
    showClock();
    select(id, { fly: false });
    const failure = sheet.querySelector('[data-error]');
    if (failure && !result?.aborted) { failure.textContent = result?.error || 'No se pudo completar el viaje. Tu partida no ha cambiado.'; failure.hidden = false; }
    layoutPins();
  }

  // --- Cierre, foco e historial -----------------------------------------------------------------------------------------------------------------
  const focusables = () => [...layer.querySelectorAll('button:not([disabled]), [tabindex="0"]')].filter((node) => !node.hidden && node.offsetParent !== null);
  const onKey = (event) => {
    if (closed) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (traveling) options.cancel?.(); else if (selectedId) deselect(); else requestClose();
    } else if (event.key === 'Tab') {
      const items = focusables(); if (!items.length) return;
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  q('[data-close]').onclick = () => { if (traveling) options.cancel?.(); else requestClose(); };

  // El gesto «atrás» del sistema cierra el mapa (o cancela el viaje en curso) en vez de salir del juego.
  history.pushState({ homMap: true }, '');
  const onPop = () => {
    if (closed) return;
    if (traveling) { history.pushState({ homMap: true }, ''); options.cancel?.(); return; }
    if (selectedId && viewMode === 'map') { history.pushState({ homMap: true }, ''); deselect(); return; }
    teardown({ arrived: false, viaPop: true });
  };
  window.addEventListener('popstate', onPop);
  const requestClose = () => { if (history.state?.homMap) history.back(); else teardown({ arrived: false }); };

  function teardown({ arrived, viaPop = false }) {
    if (closed) return;
    closed = true;
    window.removeEventListener('popstate', onPop); document.removeEventListener('keydown', onKey, true);
    clearTimeout(settle); cancelAnimationFrame(frame);
    layer.remove();
    siblings.forEach((node) => { node.inert = false; });
    if (!viaPop && history.state?.homMap) history.back();
    if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll: true });
    options.onClose?.({ arrived });
  }
  // Tras viajar, el mapa se funde con la escena del destino (con `reduced-motion` también: solo el fundido).
  async function dismiss({ arrived }) {
    layer.classList.add('leaving');
    await new Promise((resolve) => setTimeout(resolve, 560));
    teardown({ arrived });
  }

  // --- Primer dibujo -------------------------------------------------------------------------------------------------------------------------------
  const ready = () => new Promise((resolve) => { if (view.rect.width) resolve(); else { const done = new ResizeObserver(() => { if (view.rect.width) { done.disconnect(); resolve(); } }); done.observe(mapNode); } });
  await ready();
  Object.assign(view, view.frameAt(me.x, me.y, neighbourhood()));
  layoutPins(); paint();
  q('[data-close]').focus({ preventScroll: true });
  // El relleno de casas llega después: primero se ve el mapa sin él (calles y zonas) y se completa en cuanto está.
  loading.hidden = data.results.size > 0 || !data.map.areas.some((area) => area.fill && area.fill.pattern !== 'none');
  fillAreas(data, () => { if (!closed) schedule(); }).then(() => { loading.hidden = true; if (!closed) schedule(); });
  return { close: requestClose, get open() { return !closed; } };
}
