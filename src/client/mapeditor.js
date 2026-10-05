// Editor de mapas v2 (modo desarrollo, solo PC). Lienzo infinito en METROS: se dibujan áreas (terreno y zonas urbanas con receta de relleno), caminos
// (calles, ríos, murallas…), distritos de juego, lugares y enlaces; todo se organiza en grupos que se pueden bloquear. Valida con el MISMO código que el
// servidor (src/shared) y guarda en data/canon/maps/. Los edificios y árboles no se guardan: los generará un algoritmo con semilla (paso siguiente).
// Todo el estado vive en `state.map`, con deshacer/rehacer por instantáneas.
import { MapView } from '/mapview.js';
import { normalizeMap, validateMap, emptyMap, groupChain, lockedBy, mapBounds, PLACE_KINDS, ACCESS, DISCOVERY, LINK_MODES, REQUIREMENT_TYPES } from '/shared/mapSchema.js';
import { AREA_KINDS, WAY_KINDS, FILL_PATTERNS, AREA_LABEL, WAY_LABEL, PATTERN_LABEL, AREA_COLOR, WAY_COLOR, AREA_Z, WAY_Z, WAY_WIDTH, FILL_DEFAULTS, PLACE_KIND_LABEL, PLACE_KIND_COLOR, PLACE_IMPORTANCE, PLACE_ICONS, PLACE_ICON_LABEL, PLACE_DEFAULT_ICON, DECOR_KINDS, DECOR_LABEL, DECOR_SIZE } from '/shared/mapDefaults.js';
import { TRAVEL_MODES, linkPoints, linkKm, drawnKm, linkMinutes, planTrip, formatDuration, formatKm, speedKmh, placeIndex, walkMinutes } from '/shared/mapTravel.js';
import { LAYERS, LAYER_LABEL, layerOf } from '/shared/mapLayers.js';
import { drawLinks, drawSymbols, drawDecor, drawRegions, drawRegionLabels, layoutPlaces, linkColor, decorPixels, smoothLine } from '/mapatlas.js';
import { generateFill, contextFor } from '/shared/mapGen.js';
import { itemsInRect, toggleItem, mergeItems, assignToGroup, removeItems } from '/shared/mapSelect.js';
import { THEMES, themeFor, POST_KEYS, POST_RANGE, POST_LABEL, POST_NEUTRAL } from '/shared/mapStyle.js';
import { renderScene, drawFill, drawTerrain, PostProcessor, copyPlain } from '/maprender.js';
import { Terrain, TERRAIN_KINDS, TERRAIN_LABEL, TERRAIN_DEFAULTS, TERRAIN_PRESETS, paintStroke, paintPolygon, floodFill, generateTerrain } from '/shared/mapTerrain.js';
import { distance, minutesFor, WALK_METERS_PER_MIN, TAXI_METERS_PER_MIN, slugify, uniqueId, districtAt, pointInPolygon, polygonCentroid, polygonArea, polylineLength, distanceToPolyline, boundsOf, mergeBounds, round, ID_PATTERN } from '/shared/geo.js';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const KIND_LABEL = PLACE_KIND_LABEL;
const KIND_COLOR = PLACE_KIND_COLOR;
const ACCESS_LABEL = { public: 'Público', private: 'Privado', restricted: 'Restringido' };
const DISCOVERY_LABEL = { hidden: 'Oculto', rumor: 'Rumor', known: 'Conocido' };
const REQUIREMENT_LABEL = { escort: 'Solo con guía', invitation: 'Invitación', story_flag: 'Hito de historia', knows_place: 'Conocer un lugar', money: 'Dinero' };
const LINK_LABEL = Object.fromEntries(LINK_MODES.map((mode) => [mode, TRAVEL_MODES[mode].label]));
const PALETTE = ['#c0392b', '#2e86c1', '#27ae60', '#d4ac0d', '#8e44ad', '#e67e22', '#16a085', '#7f8c8d'];
const COLLECTION = { place: 'places', district: 'districts', area: 'areas', way: 'ways', link: 'links', group: 'groups', decor: 'decor', line: 'lines' };
const TAB_OF = { place: 'places', link: 'links', line: 'links', area: 'zones', district: 'zones', way: 'ways', group: 'groups', decor: 'places' };
const TOOLS = [['select', 'Mover', 'V'], ['pick', 'Selección', 'S'], ['brush', 'Pincel', 'B'], ['place', 'Lugar', 'P'], ['link', 'Conexión', 'C'], ['area', 'Área', 'A'], ['way', 'Camino', 'W'], ['district', 'Distrito', 'D'], ['decor', 'Decoración', 'O'], ['measure', 'Medir', 'M'], ['scale', 'Escala', 'E']];
const HINTS = {
  select: 'Clic en un lugar, camino, área o borde de distrito para seleccionarlo (Ctrl o Mayús suman o quitan). Arrastra sus vértices; arrastra el fondo para desplazar; rueda = zoom; Alt = sin imán; Supr borra.',
  brush: 'Arrastra para pintar el terreno natural (agua, tierra, bosque, montaña, nieve, desierto, urbano, industrial…). [ y ] cambian el radio; Alt borra; clic derecho o central desplaza. Modo «Forma»: dibuja un polígono (doble clic o Intro lo rellena de golpe).',
  pick: 'Arrastra un rectángulo: de izquierda a derecha elige lo que queda ENTERO dentro; de derecha a izquierda, lo que toca. Clic elige uno; Ctrl o Mayús suman o quitan; Ctrl+G agrupa; Supr borra.',
  place: 'Clic para colocar un lugar del tipo elegido arriba (se añade al grupo activo). Después ajusta su importancia, icono y datos en el panel derecho.',
  link: 'Conexión entre dos lugares: clic en el primero, clics en el vacío para dibujar el trazado (curvas, pasos de montaña…) y clic en el último lugar para terminar. Clic derecho quita el último punto; Esc cancela. Distancia y tiempo se calculan solos (o los escribes).',
  decor: 'Clic para colocar un elemento decorativo o una etiqueta de texto (mar, cordillera…): el tipo se elige arriba.',
  area: 'Clic para añadir vértices (se imantan a los existentes; Alt lo desactiva). Doble clic, Intro o clic en el primero cierran; Retroceso o clic derecho quitan el último; Esc cancela.',
  way: 'Clic para añadir puntos (clic derecho quita el último); doble clic o Intro terminan. Un camino tiene prioridad sobre el relleno: al generar, parte las zonas que cruza.',
  district: 'Zona de juego (niebla, lugares del jugador). Mismos controles que «Área» (clic derecho quita el último punto).',
  measure: 'Dos clics: distancia y tiempo a pie, en carretera y en Northline (velocidades de la pestaña Conexiones).',
  scale: 'Dos clics sobre una distancia conocida de una imagen de calco; escribes los metros reales y la imagen se reescala.'
};
const NICE = [1, 2, 5];

const state = {
  maps: [], context: { takenIds: new Set(), npcIds: new Set(), legacyIds: new Set(), refs: [] },
  map: null, saved: '', history: [], future: [], loadedAt: 0,
  tool: 'select', tab: 'places', selection: null, draft: null, measure: null, calib: null, mouse: null,
  issues: { errors: [], warnings: [] }, showFog: false, showLabels: true, showGrid: true, showFill: true, showTerrain: true, terrain: null, terrainFor: undefined, stroke: null, brush: { kind: 'forest', mode: 'paint', radius: 120, rugged: 0.4, protectWater: true }, gen: { seed: 1, scale: 1800, sea: 0.45, forest: 0.45, mountains: 0.35, fields: 0.25, island: 0, overwrite: false, region: 'view' }, final: false, multi: [], marquee: null, postDragging: false, drag: null, down: null,
  activeGroup: null, newArea: 'urban', newWay: { kind: 'street', width: WAY_WIDTH.street },
  // capas del editor (no se guardan en el mapa): qué clases de elementos se ven y cuáles no se pueden editar
  layers: { hidden: new Set(), locked: new Set() }, layersOpen: false, themed: false, snapGrid: false,
  newPlace: { kind: 'poi' }, newLink: { mode: 'road', line: '' }, newDecor: { kind: 'compass' }, route: { from: '', to: '' }, region: null
};
const view = new MapView($('#canvas'));
// Colores con los que se dibuja mientras se edita: los planos del editor o, si se activa «Estilo del mapa», los del estilo elegido (sin postproceso).
const editTheme = () => (state.themed && state.map ? themeFor(state.map) : THEMES.default);
const hiddenLayers = () => state.layers.hidden;
// Ids creados por una herramienta y aún no editados a mano: siguen al nombre mientras el autor lo escribe.
const autoIds = new Set();
// Relleno generado (manzanas, casas, árboles) por área: no se guarda en el mapa, se recalcula cuando cambia la receta o lo que hay alrededor.
const genCache = new Map();
function refreshGenerated() {
  if (!state.map || !(state.showFill || state.final)) return;
  const live = new Set();
  for (const area of state.map.areas) {
    if (!area.fill || area.fill.pattern === 'none' || area.polygon.length < 3) continue;
    live.add(area.id);
    const ctx = contextFor(area, state.map); const key = JSON.stringify([area.polygon, area.fill, ctx]);
    if (genCache.get(area.id)?.key === key) continue;
    const started = performance.now(); const result = generateFill(area, ctx);
    genCache.set(area.id, { key, result, ms: performance.now() - started });
  }
  for (const id of [...genCache.keys()]) if (!live.has(id)) genCache.delete(id);
}
function drawGenerated(ctx) {
  if (!state.showFill) return;
  const v = { k: view.k, tx: view.tx, ty: view.ty, width: view.rect.width, height: view.rect.height };
  for (const { result } of genCache.values()) drawFill(ctx, v, result, editTheme());
}

// Vista final: pinta TODO el mapa con el estilo elegido en un canvas intermedio y le pasa el shader de postproceso (grano, manchas, viñeta, color, tinta).
// Es solo lectura; el exportador de teselas usará estas mismas funciones.
const scene = document.createElement('canvas');
let post = null;
function renderFinal() {
  const { width, height } = view.rect; if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1; const w = Math.round(width * ratio); const h = Math.round(height * ratio);
  if (scene.width !== w || scene.height !== h) { scene.width = w; scene.height = h; }
  const ctx = scene.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const theme = themeFor(state.map);
  const results = new Map([...genCache].map(([id, entry]) => [id, entry.result]));
  renderScene(ctx, { k: view.k, tx: view.tx, ty: view.ty, width, height }, state.map, results, theme, { labels: state.showLabels, terrain: getTerrain(), hidden: hiddenLayers() });
  post ??= new PostProcessor(view.final);
  if (post.ok) post.apply(scene, theme.post, [view.tx * ratio, view.ty * ratio]); else copyPlain(scene, view.final);
}

// --- Servidor ----------------------------------------------------------------------------------------------------------------------------------------
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', 'x-hom-dev': '1', ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `Error ${response.status}`), { issues: body.issues, status: response.status });
  return body;
}
const setContext = (context) => { state.context = { takenIds: new Set(context.takenIds), npcIds: new Set(context.npcIds), legacyIds: new Set(context.legacyIds), refs: context.refs ?? [] }; };

// --- Estado, historial y validación ------------------------------------------------------------------------------------------------------------
const snapshot = () => JSON.stringify(state.map);
const dirty = () => state.map !== null && snapshot() !== state.saved;
function pushHistory() {
  state.history.push(snapshot()); state.future = [];
  let total = state.history.reduce((sum, text) => sum + text.length, 0);   // el terreno pintado pesa: se limita la memoria del historial, no solo el número de pasos
  while (state.history.length > 60 || (total > 60e6 && state.history.length > 1)) total -= state.history.shift().length;
}
function mutate(change) { if (!state.map) return; pushHistory(); change(state.map); afterChange(); }
function afterChange() { validate(); renderAll(); }
function undo() { if (!state.history.length) return; state.future.push(snapshot()); state.map = JSON.parse(state.history.pop()); fixSelection(); afterChange(); }
function redo() { if (!state.future.length) return; state.history.push(snapshot()); state.map = JSON.parse(state.future.pop()); fixSelection(); afterChange(); }
function fixSelection() {
  if (state.selection && !find(state.selection.type, state.selection.id)) state.selection = null;
  state.multi = state.multi.filter((entry) => find(entry.type, entry.id));
  if (state.multi.length === 1) { state.selection = state.multi[0]; state.multi = []; }
  if (state.activeGroup && !find('group', state.activeGroup)) state.activeGroup = null;
}
function validate() {
  if (!state.map) { state.issues = { errors: [], warnings: [] }; return; }
  const { errors, warnings } = validateMap(normalizeMap(state.map), state.context);
  state.issues = { errors, warnings };
}
const find = (type, id) => state.map?.[COLLECTION[type]]?.find((item) => item.id === id) ?? null;
const selected = () => (state.selection ? find(state.selection.type, state.selection.id) : null);
const SELECTABLE = ['place', 'area', 'way', 'district', 'decor'];
const isSelected = (type, id) => (state.selection?.type === type && state.selection.id === id) || state.multi.some((entry) => entry.type === type && entry.id === id);
// Lo seleccionado ahora como lista (uno o varios elementos que se pueden agrupar o borrar en bloque).
const currentSet = () => (state.multi.length ? state.multi : state.selection && SELECTABLE.includes(state.selection.type) ? [state.selection] : []);
function setSet(list, { tab = true } = {}) {
  state.multi = []; state.selection = null;
  if (list.length === 1) { state.selection = list[0]; if (tab) state.tab = TAB_OF[list[0].type]; } else if (list.length > 1) state.multi = list;
  renderAll();
}
const takenPlaceIds = () => new Set([...state.context.takenIds, ...state.map.places.map((item) => item.id), ...state.map.links.map((item) => item.id)]);
// Ids de todo lo que NO es lugar ni enlace: se evita que dos cosas del mismo mapa se llamen igual aunque el esquema solo exija unicidad por tipo.
const localIds = () => new Set(['areas', 'ways', 'districts', 'groups', 'underlays', 'decor', 'lines'].flatMap((key) => state.map[key].map((item) => item.id)));
const newId = (name) => uniqueId(slugify(name), localIds());

// Tipo de un elemento a partir de su forma (para saber a qué capa pertenece cuando solo se tiene el objeto).
function itemType(item) {
  if (item.from !== undefined) return 'link'; if (item.points) return 'way';
  if (item.polygon) return item.fog !== undefined ? 'district' : 'area';
  if (item.size !== undefined) return 'decor'; if (item.x !== undefined) return 'place';
  return null;
}
// Bloqueos: un elemento está congelado si su grupo (o alguno de sus ancestros) o su CAPA están bloqueados.
function frozenBy(item, type) {
  if (!state.map || !item) return null;
  const group = lockedBy(state.map, item); if (group) return group;
  const kind = type ?? itemType(item); if (!kind) return null;
  const layer = layerOf(kind, item, state.map);
  return state.layers.locked.has(layer) ? { id: `layer:${layer}`, name: LAYER_LABEL[layer], layer: true } : null;
}
const isHiddenItem = (type, item) => Boolean(item && state.layers.hidden.has(layerOf(type, item, state.map)));
const lockText = (group) => (group.layer ? `Bloqueado por la capa «${group.name}». Desbloquéala en el menú «Capas» para editarlo.` : `Bloqueado por el grupo «${group.name || group.id}». Desbloquéalo en la pestaña Grupos para editarlo.`);
const layerKey = () => `hom-map-layers:${state.map?.id ?? ''}`;
function saveLayerPrefs() { try { localStorage.setItem(layerKey(), JSON.stringify({ hidden: [...state.layers.hidden], locked: [...state.layers.locked], themed: state.themed, snapGrid: state.snapGrid })); } catch { /* sin almacenamiento: no pasa nada */ } }
function loadLayerPrefs() {
  let saved = null; try { saved = JSON.parse(localStorage.getItem(layerKey()) ?? 'null'); } catch { saved = null; }
  state.layers = { hidden: new Set((saved?.hidden ?? []).filter((id) => LAYER_LABEL[id])), locked: new Set((saved?.locked ?? []).filter((id) => LAYER_LABEL[id])) };
  state.themed = typeof saved?.themed === 'boolean' ? saved.themed : state.map?.style?.theme === 'atlas';
  state.snapGrid = saved?.snapGrid === true;
  fitBrush();   // el tamaño del pincel y del generador dependen de la escala del mapa que se abre
}
function refuseIfFrozen(item, type) {
  const group = frozenBy(item, type);
  if (group) setStatus(lockText(group), 'bad');
  return Boolean(group);
}
const descendantIds = (groupId) => {
  const ids = new Set([groupId]);
  for (let changed = true; changed;) { changed = false; for (const group of state.map.groups) if (group.parent && ids.has(group.parent) && !ids.has(group.id)) { ids.add(group.id); changed = true; } }
  return ids;
};
const membersOf = (groupId) => {
  const ids = descendantIds(groupId);
  return ['areas', 'ways', 'districts', 'places', 'decor'].flatMap((key) => state.map[key].filter((item) => ids.has(item.group)).map((item) => ({ key, item })));
};
const pointsOf = (type, item) => (type === 'way' ? item.points : type === 'link' ? item.path : item.polygon ?? null);

// --- Mapa: abrir, crear, guardar ---------------------------------------------------------------------------------------------------------------
// `keepContext`: con un mapa abierto, el contexto de validación ya es el suyo (los ids de OTROS mapas); el de la lista general incluiría sus propios ids.
async function refreshList(selectId, { keepContext = false } = {}) {
  const { maps, ...context } = await api('/api/dev/maps');
  state.maps = maps; if (!keepContext) setContext(context);
  const select = $('#map-select');
  select.innerHTML = `<option value="">— elige un mapa —</option>${maps.map((item) => `<option value="${esc(item.id)}">${esc(item.name || item.id)} (${item.places} lugares)</option>`).join('')}`;
  select.value = selectId ?? state.map?.id ?? '';
}

const underlayUrl = (item) => `/assets/maps/${item.file}?v=${state.loadedAt}`;
function resetSession() { state.history = []; state.future = []; state.selection = null; state.draft = null; state.measure = null; state.calib = null; state.drag = null; state.activeGroup = null; state.multi = []; state.marquee = null; state.loadedAt = Date.now(); genCache.clear(); state.terrain = null; state.terrainFor = undefined; state.stroke = null; }
// Encuadre: si el mapa tiene una región política (un territorio), se encaja ella; si no, todo lo dibujado. Un mapa vacío de escala regional empieza con un lienzo de cientos de km.
function regionBounds() {
  const boxes = state.map.areas.filter((area) => area.kind === 'region' && area.polygon.length >= 3).map((area) => boundsOf(area.polygon));
  return boxes.length ? boxes.reduce((a, b) => mergeBounds(a, b)) : null;
}
function fitAll() {
  const cell = state.map?.terrain?.cell ?? TERRAIN_DEFAULTS.cell; const grow = cell > TERRAIN_DEFAULTS.cell ? cell : 0;
  view.fitBounds(regionBounds() ?? mapBounds(state.map) ?? (grow ? { minX: -grow * 160, minY: -grow * 100, maxX: grow * 160, maxY: grow * 100 } : { minX: -600, minY: -400, maxX: 600, maxY: 400 }));
}

async function openMap(id) {
  if (!id) return;
  const { map, context, issues } = await api(`/api/dev/maps/${id}`);
  state.map = map; state.saved = JSON.stringify(map); resetSession();
  setContext(context); state.issues = issues;
  loadLayerPrefs(); state.tab = 'places'; fitAll(); validate(); renderAll();
  $('#map-select').value = id;   // el selector sigue al mapa abierto (también cuando se abre solo al arrancar)
  try { localStorage.setItem('hom-map-last', id); } catch { /* sin almacenamiento */ }
}

async function save() {
  if (!state.map) return;
  validate();
  if (state.issues.errors.length) { state.tab = 'issues'; renderAll(); setStatus(`No se puede guardar: ${state.issues.errors.length} error(es). Revisa la pestaña Avisos.`, 'bad'); return; }
  try {
    const result = await api(`/api/dev/maps/${state.map.id}`, { method: 'PUT', body: JSON.stringify({ map: normalizeMap(state.map) }) });
    state.map = result.map; state.saved = snapshot(); state.issues = { errors: [], warnings: result.issues.warnings };
    await refreshList(state.map.id, { keepContext: true });
    validate(); renderAll(); setStatus(`Guardado a las ${new Date().toLocaleTimeString()}`, 'ok');
  } catch (error) { setStatus(error.message, 'bad'); if (error.issues) { state.issues = error.issues; state.tab = 'issues'; renderAll(); } }
}

// Convierte (opcionalmente a WebP, más ligero) y sube una imagen de calco; devuelve { file, width, height } leídos por el servidor.
async function uploadImage(mapId, file, convert, name) {
  let blob = file;
  if (convert && file.type !== 'image/webp') {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92)) ?? file;
  }
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
  return (await api(`/api/dev/maps/${mapId}/image`, { method: 'POST', body: JSON.stringify({ data, name }) })).image;
}

async function addUnderlay(file, convert) {
  let n = 1; const used = new Set(state.map.underlays.map((item) => item.id));
  while (used.has(`calco${n}`)) n += 1;
  const name = `calco${n}`;
  const image = await uploadImage(state.map.id, file, convert, name);
  const center = view.toWorld(view.rect.width / 2, view.rect.height / 2); const mpp = 2;
  mutate((map) => map.underlays.push({ id: name, ...image, x: round(center.wx - (image.width * mpp) / 2), y: round(center.wy - (image.height * mpp) / 2), metersPerPixel: mpp, opacity: 0.6, visible: true }));
  state.loadedAt = Date.now(); renderCanvas();
}

function askNewMap() {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = `<form method="dialog"><h3>Nuevo mapa</h3>
    <label class="me-field"><span>Nombre</span><input name="name" required maxlength="60" placeholder="Northfortress"></label>
    <label class="me-field"><span>Id (minúsculas y guiones bajos; no se cambia después)</span><input name="id" required pattern="[a-z][a-z0-9_]{1,40}" placeholder="northfortress"></label>
    <label class="me-field"><span>Escala del mapa (tamaño de las celdas del terreno)</span><select name="scale">${Object.entries(TERRAIN_PRESETS).map(([id, preset]) => `<option value="${id}">${esc(preset.label)}</option>`).join('')}</select></label>
    <p class="me-note">El lienzo empieza vacío y es infinito; las coordenadas son metros del mundo, así que un mapa de región mide cientos de kilómetros. Más tarde puedes añadir imágenes de calco (opcionales) en la pestaña «Mapa».</p>
    <p class="me-note" data-error></p>
    <menu><button value="cancel" type="button" data-cancel>Cancelar</button><button class="primary" value="ok">Crear</button></menu></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  form.elements.name.addEventListener('input', () => { if (!form.elements.id.dataset.touched) form.elements.id.value = slugify(form.elements.name.value); });
  form.elements.id.addEventListener('input', () => { form.elements.id.dataset.touched = '1'; });
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  form.onsubmit = (event) => {
    event.preventDefault();
    const id = form.elements.id.value.trim(); const name = form.elements.name.value.trim();
    const error = dialog.querySelector('[data-error]');
    if (!ID_PATTERN.test(id)) { error.textContent = 'El id no es válido.'; return; }
    if (state.maps.some((item) => item.id === id)) { error.textContent = 'Ya existe un mapa con ese id.'; return; }
    const preset = TERRAIN_PRESETS[form.elements.scale.value] ?? TERRAIN_PRESETS.city;
    state.map = emptyMap(id, name); state.saved = ''; resetSession();
    if (preset.cell !== TERRAIN_DEFAULTS.cell) { state.map.terrain = { cell: preset.cell, seed: 1, forest: { ...preset.forest }, chunks: {} }; state.map.style = { theme: 'atlas' }; }
    loadLayerPrefs(); dialog.close(); state.tab = 'map'; fitAll(); validate(); renderAll(); setStatus('Mapa nuevo: aún no está guardado.', 'dirty');
  };
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

function setStatus(text, kind = '') { const node = $('#status'); node.textContent = text; node.className = `me-status ${kind}`; }
function renderStatus() {
  if (!state.map) { setStatus('Elige un mapa o crea uno nuevo.'); return; }
  const counts = `${state.issues.errors.length} errores · ${state.issues.warnings.length} avisos`;
  if (!state.saved) setStatus(`Mapa nuevo sin guardar · ${counts}`, 'dirty');
  else if (dirty()) setStatus(`Cambios sin guardar · ${counts}`, 'dirty');
  else setStatus(`Sin cambios · ${counts}`, state.issues.errors.length ? 'bad' : 'ok');
}

// --- Operaciones sobre el mapa -----------------------------------------------------------------------------------------------------------------
function focusName() { const field = $('#inspector [data-f="name"]'); field?.focus(); field?.select(); }
function chooseSelection(type, id, { focus = false } = {}) { state.multi = []; state.selection = { type, id }; state.tab = TAB_OF[type]; renderAll(); if (focus) focusName(); }
const groupForNew = () => (state.activeGroup && !frozenBy({ group: state.activeGroup }) ? state.activeGroup : null);

const newPlaceObject = (id, name, kind, x, y, group) => ({ id, name, aliases: [], kind, x: round(x), y: round(y), access: 'public', hours: null, tags: [], description: '', discovery: 'known', owner: null, footprint: null, group, requires: [], importance: PLACE_IMPORTANCE[kind] ?? 2, icon: null, faction: null, image: null, data: {} });
function addPlace(wx, wy) {
  const group = groupForNew(); const kind = state.newPlace.kind;
  const id = uniqueId(slugify(PLACE_KIND_LABEL[kind] ?? 'Nuevo lugar'), takenPlaceIds());
  mutate((map) => map.places.push(newPlaceObject(id, kind === 'poi' ? 'Nuevo lugar' : PLACE_KIND_LABEL[kind], kind, wx, wy, group)));
  autoIds.add(id); chooseSelection('place', id, { focus: true });
}

// Decoración y etiquetas de texto.
function addDecor(wx, wy) {
  const kind = state.newDecor.kind; const id = newId(kind === 'label' ? 'Etiqueta' : DECOR_LABEL[kind]);
  mutate((map) => map.decor.push({ id, name: kind === 'label' ? 'Nueva etiqueta' : '', kind, x: round(wx), y: round(wy), size: DECOR_SIZE[kind] * (state.map.terrain?.cell > TERRAIN_DEFAULTS.cell ? 1 : 0.02), rotation: 0, group: groupForNew() }));
  autoIds.add(id); state.tool = 'select'; chooseSelection('decor', id, { focus: kind === 'label' });
}

// Conexiones: se empieza en un lugar, se añaden puntos de trazado en el vacío y se termina en otro lugar.
const nearestPlace = (wx, wy, reach = 18 / view.k) => {
  let best = null; let bestDistance = reach;
  for (const place of state.map.places) { if (!Number.isFinite(place.x) || isHiddenItem('place', place)) continue; const d = Math.hypot(place.x - wx, place.y - wy); if (d < bestDistance) { best = place; bestDistance = d; } }
  return best;
};
function linkClick(wx, wy, target, event) {
  const hit = (target?.dataset.type === 'place' ? find('place', target.dataset.id) : null) ?? nearestPlace(wx, wy);
  if (!state.draft) {
    if (!hit) { setStatus('Empieza la conexión haciendo clic en un lugar.', 'bad'); return; }
    state.draft = { kind: 'link', from: hit.id, points: [] }; renderCanvas(); return;
  }
  if (hit && hit.id !== state.draft.from) { finishLink(hit.id); return; }
  if (hit) return;
  const [x, y] = snap(wx, wy, { off: event.altKey }); state.draft.points.push([x, y]); renderCanvas();
}
function finishLink(toId) {
  const draft = state.draft; state.draft = null; if (!draft) return;
  const a = find('place', draft.from); const b = find('place', toId); if (!a || !b) { renderAll(); return; }
  const mode = state.newLink.mode; const line = state.newLink.line && state.map.lines.some((item) => item.id === state.newLink.line) ? state.newLink.line : null;
  const id = uniqueId(slugify(`${mode} ${a.name} ${b.name}`), takenPlaceIds());
  const km = (draft.points.length ? polylineLength([[a.x, a.y], ...draft.points, [b.x, b.y]]) : Math.hypot(a.x - b.x, a.y - b.y)) / 1000;
  mutate((map) => map.links.push({ id, name: `${LINK_LABEL[mode]}: ${a.name} – ${b.name}`, mode, from: a.id, to: b.id, minutes: null, cost: 0, requires: [], distanceKm: null, path: draft.points.map(([x, y]) => [round(x), round(y)]), line, twoWay: true }));
  autoIds.add(id); chooseSelection('link', id);
  const normalized = normalizeMap(state.map); const made = normalized.links.find((item) => item.id === id);
  setStatus(`Conexión creada: ${formatKm(km)} · ${formatDuration(linkMinutes(normalized, made, placeIndex(normalized)))} (${LINK_LABEL[mode]}). Puedes seguir dibujando otra.`, 'dirty');
}

// Duplicar lo seleccionado (uno o varios elementos, o una conexión): copias desplazadas con ids nuevos, en el mismo grupo.
function duplicateSelection() {
  const items = currentSet().length ? currentSet() : state.selection && ['link', 'line'].includes(state.selection.type) ? [state.selection] : [];
  if (!items.length) return;
  const offset = round(Math.max(30 / view.k, 1)); const created = []; let skipped = 0;
  const used = new Set([...takenPlaceIds(), ...localIds()]);
  mutate((map) => {
    for (const { type, id } of items) {
      const source = find(type, id); if (!source || frozenBy(source, type)) { skipped += 1; continue; }
      const copy = structuredClone(source);
      const fresh = uniqueId(slugify(source.id).slice(0, 34), used); used.add(fresh); copy.id = fresh;
      if (copy.name) copy.name = `${copy.name} (copia)`.slice(0, 60);
      if (copy.x !== undefined) { copy.x = round(copy.x + offset); copy.y = round(copy.y + offset); }
      for (const key of ['polygon', 'points', 'path']) if (copy[key]) copy[key] = copy[key].map(([x, y]) => [round(x + offset), round(y + offset)]);
      if (copy.fill?.center) copy.fill.center = [round(copy.fill.center[0] + offset), round(copy.fill.center[1] + offset)];
      map[COLLECTION[type]].push(copy); created.push({ type, id: fresh }); autoIds.add(fresh);
    }
  });
  if (created.length) { state.draft = null; setSet(created); setStatus(`${created.length} elemento(s) duplicado(s)${skipped ? ` · ${skipped} bloqueado(s) sin copiar` : ''}.`, 'dirty'); }
  else setStatus('Nada que duplicar: lo seleccionado está bloqueado.', 'bad');
}

function finishDraft() {
  if (state.draft?.kind === 'terrain') { finishShape(); return; }
  if (state.draft?.kind === 'link') return;   // una conexión termina haciendo clic en el lugar de destino
  const draft = state.draft; state.draft = null;
  if (!draft) return;
  const points = draft.points.map(([x, y]) => [round(x), round(y)]);
  if (draft.kind === 'way') {
    if (points.length < 2) { renderAll(); return; }
    const kind = state.newWay.kind; const id = newId(WAY_LABEL[kind]);
    mutate((map) => map.ways.push({ id, name: WAY_LABEL[kind], kind, points, width: state.newWay.width, z: WAY_Z[kind], group: groupForNew() }));
    autoIds.add(id); state.tool = 'select'; chooseSelection('way', id, { focus: true });
    return;
  }
  if (points.length < 3) { renderAll(); return; }
  if (draft.kind === 'area') {
    const kind = state.newArea; const id = newId(AREA_LABEL[kind]);
    const fill = kind === 'urban' ? { ...FILL_DEFAULTS.organic } : kind === 'forest' ? { ...FILL_DEFAULTS.forest } : null;
    mutate((map) => map.areas.push({ id, name: AREA_LABEL[kind], kind, polygon: points, z: AREA_Z[kind], fill, group: groupForNew() }));
    autoIds.add(id); state.tool = 'select'; chooseSelection('area', id, { focus: true });
  } else {
    const id = newId('Nuevo distrito');
    mutate((map) => map.districts.push({ id, name: 'Nuevo distrito', color: PALETTE[map.districts.length % PALETTE.length], polygon: points, fog: 'known', allowPlayerPlaces: false, group: groupForNew() }));
    autoIds.add(id); state.tool = 'select'; chooseSelection('district', id, { focus: true });
  }
}

function createGroup(name, parent = null) {
  const id = newId(name);
  mutate((map) => map.groups.push({ id, name, parent, locked: false, baked: null }));
  autoIds.add(id);
  return id;
}

function applyGroupToSelection(groupId) {
  const items = currentSet(); if (!items.length) return;
  if (groupId) { const lock = lockedBy(state.map, { group: groupId }); if (lock) { setStatus(`El grupo «${lock.name || lock.id}» está bloqueado: no recibe elementos.`, 'bad'); return; } }
  let result; mutate((map) => { result = assignToGroup(map, items, groupId); });
  const name = groupId ? find('group', groupId)?.name : null;
  setStatus(`${result.moved} elemento(s) ${groupId ? `movidos a «${name}»` : 'sacados de su grupo'}${result.skipped.length ? ` · ${result.skipped.length} bloqueado(s) sin cambios` : ''}.`, result.moved ? 'dirty' : 'bad');
}
function newGroupFromSelection() {
  const items = currentSet(); if (!items.length) return;
  const name = prompt(`Nombre del grupo nuevo (con ${items.length} elemento(s)):`, '')?.trim(); if (!name) return;
  const id = newId(name); let result;
  mutate((map) => { map.groups.push({ id, name, parent: null, locked: false, baked: null }); result = assignToGroup(map, items, id); });
  autoIds.add(id);
  setStatus(`Grupo «${name}» creado con ${result.moved} elemento(s)${result.skipped.length ? ` · ${result.skipped.length} bloqueado(s) se quedaron fuera` : ''}.`, 'dirty');
}
function removeMulti() {
  const items = currentSet(); if (!items.length) return;
  const refs = items.filter((entry) => entry.type === 'place').flatMap((entry) => state.context.refs.filter((ref) => ref.placeId === entry.id));
  const warning = refs.length ? `\n\nOjo: estos personajes usan alguno de esos lugares:\n- ${[...new Set(refs.map((ref) => ref.where))].join('\n- ')}` : '';
  if (!confirm(`¿Borrar ${items.length} elementos?${warning}`)) return;
  let result; mutate((map) => { result = removeItems(map, items); });
  state.selection = null; state.multi = []; renderAll();
  setStatus(`${result.removed} borrado(s)${result.skipped.length ? ` · ${result.skipped.length} bloqueado(s) se conservaron` : ''}.`, 'dirty');
}
function selectAll() { setSet(SELECTABLE.flatMap((type) => state.map[COLLECTION[type]].filter((item) => !isHiddenItem(type, item)).map((item) => ({ type, id: item.id })))); }

function removeSelected() {
  if (state.multi.length > 1) { removeMulti(); return; }
  const item = selected(); if (!item) return;
  const { type, id } = state.selection;
  if (type !== 'group' && refuseIfFrozen(item)) return;
  if (type === 'group' && groupChain(state.map, item.parent).some((group) => group.locked || item.locked)) { setStatus('Ese grupo está bloqueado: desbloquéalo antes de borrarlo.', 'bad'); return; }
  const refs = type === 'place' ? state.context.refs.filter((ref) => ref.placeId === id) : [];
  if (refs.length && !confirm(`Estos personajes usan «${id}»:\n- ${[...new Set(refs.map((ref) => ref.where))].join('\n- ')}\n\nSi lo borras, sus fichas quedarán apuntando a un lugar que no existe. ¿Borrar de todos modos?`)) return;
  mutate((map) => {
    map[COLLECTION[type]] = map[COLLECTION[type]].filter((entry) => entry.id !== id);
    if (type === 'place') map.links = map.links.filter((link) => link.from !== id && link.to !== id);
    if (type === 'line') for (const link of map.links) if (link.line === id) link.line = null;
    if (type === 'group') {
      // lo que había dentro pasa al grupo de arriba (o queda suelto): borrar un grupo nunca borra su contenido
      for (const key of ['areas', 'ways', 'districts', 'places', 'groups', 'decor']) for (const entry of map[key]) { const field = key === 'groups' ? 'parent' : 'group'; if (entry[field] === id) entry[field] = item.parent ?? null; }
    }
  });
  if (state.activeGroup === id) state.activeGroup = null;
  state.selection = null; renderAll();
}

// Renombrar un id mantiene las referencias dentro del mapa (enlaces, requisitos, grupos) y avisa de las fichas de NPC que lo usan.
function renameId(type, oldId, requested) {
  const id = requested.trim();
  if (id === oldId) return true;
  if (!ID_PATTERN.test(id)) { setStatus('El id debe usar minúsculas, números y guiones bajos (empieza con letra).', 'bad'); return false; }
  const taken = type === 'place' || type === 'link' ? takenPlaceIds() : new Set(localIds());
  if (taken.has(id)) { setStatus(`El id «${id}» ya está en uso.`, 'bad'); return false; }
  const refs = type === 'place' ? state.context.refs.filter((ref) => ref.placeId === oldId) : [];
  if (refs.length && !confirm(`Estos personajes usan «${oldId}»:\n- ${[...new Set(refs.map((ref) => ref.where))].join('\n- ')}\n\nTendrás que actualizar sus fichas al nuevo id. ¿Renombrar?`)) return false;
  mutate((map) => {
    find(type, oldId).id = id;
    if (type === 'place') {
      for (const link of map.links) { if (link.from === oldId) link.from = id; if (link.to === oldId) link.to = id; }
      for (const entry of [...map.places, ...map.links]) for (const need of entry.requires ?? []) if (need.type === 'knows_place' && need.place === oldId) need.place = id;
    }
    if (type === 'line') for (const link of map.links) if (link.line === oldId) link.line = id;
    if (type === 'group') for (const key of ['areas', 'ways', 'districts', 'places', 'groups', 'decor']) for (const entry of map[key]) { const field = key === 'groups' ? 'parent' : 'group'; if (entry[field] === oldId) entry[field] = id; }
  });
  if (type === 'group' && state.activeGroup === oldId) state.activeGroup = id;
  state.selection = { type, id };
  return true;
}

function importLegacy() {
  fetch('/api/world').then((response) => response.json()).then(({ locations }) => {
    const known = takenPlaceIds();
    const fresh = locations.filter((location) => !known.has(location.id));
    if (!fresh.length) { setStatus('Todos los lugares provisionales ya están en el mapa.'); return; }
    const kindOf = (tags = []) => (tags.includes('home') ? 'home' : tags.includes('food') ? 'food' : tags.includes('shopping') ? 'shop' : tags.includes('transport') ? 'transport' : 'poi');
    const center = view.toWorld(view.rect.width / 2, view.rect.height / 2);
    mutate((map) => fresh.forEach((location, index) => {
      map.places.push({ id: location.id, name: location.name, aliases: [], kind: kindOf(location.tags), x: round(center.wx + ((index % 3) - 1) * 60), y: round(center.wy + Math.floor(index / 3) * 60), access: location.access === 'public' ? 'public' : 'private',
        hours: location.hours ? { open: location.hours.open, close: location.hours.close } : null, tags: [...(location.tags ?? [])], description: location.description ?? '', discovery: 'known', owner: null, footprint: null, group: null, requires: [] });
    }));
    setStatus(`${fresh.length} lugares provisionales importados en el centro de la vista: arrástralos a su sitio.`, 'dirty');
  }).catch((error) => setStatus(error.message, 'bad'));
}

// --- Geometría de edición ---------------------------------------------------------------------------------------------------------------------------
// Imán: engancha el punto al vértice (de cualquier área, distrito, camino o lugar) más cercano en pantalla. Alt lo desactiva.
function snap(wx, wy, { except = null, off = false } = {}) {
  if (off || !state.map) return [wx, wy];
  const limit = 10 / view.k; let best = null; let bestDistance = limit;
  const consider = (x, y) => { const d = Math.hypot(x - wx, y - wy); if (d < bestDistance) { bestDistance = d; best = [x, y]; } };
  for (const [type, key, field] of [['area', 'areas', 'polygon'], ['district', 'districts', 'polygon'], ['way', 'ways', 'points']]) {
    for (const item of state.map[key]) { if (except && except.type === type && except.id === item.id) continue; for (const [x, y] of item[field]) consider(x, y); }
  }
  for (const place of state.map.places) consider(place.x, place.y);
  if (best) return best;
  if (state.snapGrid) { const step = gridStep(); return [Math.round(wx / step) * step, Math.round(wy / step) * step]; }
  return [wx, wy];
}
const gridStep = () => GRID_STEPS.find((candidate) => candidate * view.k >= 60) ?? GRID_STEPS.at(-1);

// ¿Qué hay bajo este punto? Orden: camino (el más cercano a la línea), área (la de mayor z; a igualdad, la menor), distrito.
function pick(wx, wy, { preferDistrict = false } = {}) {
  const map = state.map; const point = { x: wx, y: wy };
  if (preferDistrict) { const district = districtAt(point, map.districts); if (district) return { type: 'district', id: district.id }; }
  let way = null; let wayDistance = Infinity;
  const decorHit = map.decor.filter((item) => !isHiddenItem('decor', item) && Math.hypot(item.x - wx, item.y - wy) <= Math.max(decorPixels(item, view.k) / view.k / 2, 10 / view.k)).sort((a, b) => Math.hypot(a.x - wx, a.y - wy) - Math.hypot(b.x - wx, b.y - wy))[0];
  if (decorHit) return { type: 'decor', id: decorHit.id };
  const index = placeIndex(map); let linkHit = null; let linkDistance = 7 / view.k;
  for (const item of map.links) {
    if (isHiddenItem('link', item)) continue;
    const points = linkPoints(map, item, index); if (!points) continue;
    const d = distanceToPolyline(point, points); if (d < linkDistance) { linkHit = item; linkDistance = d; }
  }
  if (linkHit) return { type: 'link', id: linkHit.id };
  for (const item of map.ways) {
    if (isHiddenItem('way', item)) continue;
    const reach = Math.max(item.width / 2, 6 / view.k); const d = distanceToPolyline(point, item.points);
    if (d <= reach && (d < wayDistance || (d === wayDistance && item.z > (way?.z ?? -1)))) { way = item; wayDistance = d; }
  }
  if (way) return { type: 'way', id: way.id };
  // una región política se elige por su borde (cubre todo un territorio: si se eligiera por dentro, tapaba todo lo demás)
  const region = map.areas.find((item) => item.kind === 'region' && item.polygon.length >= 3 && !isHiddenItem('area', item) && distanceToPolyline(point, [...item.polygon, item.polygon[0]]) <= REGION_PICK_PX / view.k);
  if (region) return { type: 'area', id: region.id };
  const areas = map.areas.filter((item) => item.kind !== 'region' && item.polygon.length >= 3 && !isHiddenItem('area', item) && pointInPolygon(point, item.polygon)).sort((a, b) => b.z - a.z || polygonArea(a.polygon) - polygonArea(b.polygon));
  if (areas.length) return { type: 'area', id: areas[0].id };
  const district = districtAt(point, map.districts);
  return district ? { type: 'district', id: district.id } : null;
}

function centerOnItem(type, item) {
  if (type === 'place' || type === 'decor') view.centerOn(item.x, item.y);
  else if (type === 'link') {
    const points = linkPoints(state.map, item); if (!points) return;
    const box = boundsOf(points); const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY, 4000) * 0.25;
    view.fitBounds({ minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad });
  }
  else if (type === 'area' || type === 'district') { const c = polygonCentroid(item.polygon); view.centerOn(c.x, c.y); }
  else if (type === 'way') { const box = boundsOf(item.points); view.centerOn((box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2); }
  else if (type === 'group') {
    let box = null;
    for (const { item: member } of membersOf(item.id)) box = mergeBounds(box, member.x !== undefined ? { minX: member.x, minY: member.y, maxX: member.x, maxY: member.y } : boundsOf(member.polygon ?? member.points));
    if (box) view.fitBounds({ minX: box.minX - 50, minY: box.minY - 50, maxX: box.maxX + 50, maxY: box.maxY + 50 });
  }
}

// --- Dibujo del mapa ---------------------------------------------------------------------------------------------------------------------------
const fmtMeters = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 2)} km` : `${Math.round(m)} m`);
const fmtArea = (m2) => (m2 >= 1_000_000 ? `${(m2 / 1_000_000).toFixed(2)} km²` : m2 >= 10_000 ? `${(m2 / 10_000).toFixed(1)} ha` : `${Math.round(m2)} m²`);
const GRID_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
const CASED = new Set(['avenue', 'street', 'path', 'bridge']);

function defineHatches(svg) {
  const defs = svg('defs');
  const pattern = (id, size, draw) => { const node = svg('pattern', { id, width: size, height: size, patternUnits: 'userSpaceOnUse' }, defs); draw(node); };
  pattern('hatch-organic', 14, (p) => { svg('rect', { x: 2, y: 2, width: 5, height: 4, rx: 1, fill: '#00000026' }, p); svg('rect', { x: 8, y: 8, width: 4, height: 4, rx: 1, fill: '#00000026' }, p); });
  pattern('hatch-grid', 12, (p) => { svg('rect', { x: 1.5, y: 1.5, width: 9, height: 9, fill: 'none', stroke: '#00000030' }, p); });
  pattern('hatch-radial', 12, (p) => { svg('circle', { cx: 6, cy: 6, r: 2.5, fill: 'none', stroke: '#00000030' }, p); });
  pattern('hatch-forest', 12, (p) => { svg('circle', { cx: 3, cy: 3, r: 2, fill: '#1d5a2d66' }, p); svg('circle', { cx: 9, cy: 9, r: 2, fill: '#1d5a2d66' }, p); });
}

const luminanceOf = (hex) => { const m = /^#([0-9a-f]{6})/i.exec(hex ?? ''); if (!m) return 0.5; const n = parseInt(m[1], 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
// Distancia a la que se puede seleccionar el borde de una región (una región cubre todo un territorio: si se eligiera al hacer clic dentro, taparía todo lo demás).
const REGION_PICK_PX = 9;

function renderCanvas() {
  if (state.final && state.map) { renderFinal(); return; }
  view.clearLayer();
  const ctx = view.beginCanvas(); const ground = view.beginGround();
  if (!state.map) return;
  const theme = editTheme(); const hidden = hiddenLayers(); const dark = luminanceOf(theme.background) < 0.4;
  $('#canvas').style.background = state.themed ? theme.background : '';
  const v = { k: view.k, tx: view.tx, ty: view.ty, width: view.rect.width, height: view.rect.height };
  if (state.showTerrain) drawTerrain(ground, v, getTerrain(), theme, false, hidden);
  const map = state.map; const S = (x, y) => view.toScreen(x, y);
  const svg = (name, attributes, parent) => view.svgElement(name, attributes, parent);                 // capa de fondo
  const top = (name, attributes, parent = view.top) => view.svgElement(name, attributes, parent);        // capa superior (sobre el relleno)
  const polyPoints = (points) => points.map(([x, y]) => { const p = S(x, y); return `${p.x},${p.y}`; }).join(' ');
  const { width, height } = view.rect;
  const tip = (node, textValue) => { const title = view.svgElement('title', {}, node); title.textContent = textValue; };
  defineHatches(svg);

  if (state.showGrid) {
    const step = gridStep();
    const box = view.worldBounds;
    const grid = svg('g', { 'pointer-events': 'none' }); const faint = dark ? '#ffffff14' : '#00000018'; const axis = dark ? '#ffffff40' : '#00000055';
    for (let x = Math.floor(box.minX / step) * step; x <= box.maxX; x += step) { const p = S(x, 0); svg('line', { x1: p.x, y1: 0, x2: p.x, y2: height, stroke: x === 0 ? axis : faint }, grid); }
    for (let y = Math.floor(box.minY / step) * step; y <= box.maxY; y += step) { const p = S(0, y); svg('line', { x1: 0, y1: p.y, x2: width, y2: p.y, stroke: y === 0 ? axis : faint }, grid); }
  }

  for (const item of map.underlays) {
    if (!item.visible || !(item.metersPerPixel > 0)) continue;
    const p = S(item.x, item.y); const size = item.metersPerPixel * view.k;
    svg('image', { href: underlayUrl(item), x: p.x, y: p.y, width: item.width * size, height: item.height * size, opacity: item.opacity, preserveAspectRatio: 'none', 'pointer-events': 'none' });
  }

  for (const area of [...map.areas].sort((a, b) => a.z - b.z)) {
    if (area.polygon.length < 3 || isHiddenItem('area', area)) continue;
    const picked = isSelected('area', area.id);
    const points = polyPoints(area.polygon);
    if (area.kind === 'region') {   // las regiones se pintan en el canvas (translúcidas, con borde discontinuo); aquí solo el contorno de selección
      if (picked) top('polygon', { points, fill: 'none', stroke: '#ffffff', 'stroke-width': 3, 'stroke-linejoin': 'round', 'pointer-events': 'none' });
      continue;
    }
    svg('polygon', { points, fill: area.color ?? theme.areas[area.kind] ?? AREA_COLOR[area.kind] ?? '#ccc', stroke: picked ? '#fff' : '#00000033', 'stroke-width': picked ? 3 : 1, 'stroke-linejoin': 'round', 'pointer-events': 'none' });
    const generated = state.showFill && genCache.get(area.id)?.result; const hasGenerated = generated && (generated.buildings.length || generated.trees.length || generated.blocks.length);
    if (area.fill && area.fill.pattern !== 'none' && !hasGenerated) svg('polygon', { points, fill: `url(#hatch-${area.fill.pattern})`, 'pointer-events': 'none' });
    if (picked) top('polygon', { points, fill: 'none', stroke: dark ? '#fff' : '#1b2a4a', 'stroke-width': 1.2, 'stroke-dasharray': '6 4', 'pointer-events': 'none' });
    if (state.showLabels && !hidden.has('labels') && area.name && polygonArea(area.polygon) * view.k * view.k > 4000) { const c = polygonCentroid(area.polygon); const p = S(c.x, c.y); const label = svg('text', { x: p.x, y: p.y, 'text-anchor': 'middle', class: dark ? 'me-label' : 'me-label dark', 'font-size': 12 }); label.textContent = area.name; }
  }

  drawGenerated(ctx);
  // lo «regional» se pinta en el canvas con las mismas rutinas que la vista final: regiones, conexiones, símbolos de ciudades, decoración y nombres de regiones
  drawRegions(ctx, v, map, theme, { hidden, selectedId: state.selection?.type === 'area' ? state.selection.id : null });
  drawLinks(ctx, v, map, theme, { hidden, selectedId: state.selection?.type === 'link' ? state.selection.id : null });
  const forced = new Set([state.selection?.type === 'place' ? state.selection.id : null, ...state.multi.filter((entry) => entry.type === 'place').map((entry) => entry.id)].filter(Boolean));
  const layout = layoutPlaces(v, map, { hidden, always: forced });
  drawSymbols(ctx, v, map, theme, { hidden, layout });
  drawDecor(ctx, v, map, theme, { hidden });
  if (state.showLabels) drawRegionLabels(ctx, v, map, theme, { hidden });

  const ways = [...map.ways].sort((a, b) => a.z - b.z).filter((way) => way.points.length >= 2 && !isHiddenItem('way', way));
  const lineWidth = (way) => Math.max(way.width * view.k, 1.5);
  for (const way of ways) if (isSelected('way', way.id)) top('polyline', { points: polyPoints(way.points), fill: 'none', stroke: '#fff', 'stroke-opacity': 0.8, 'stroke-width': lineWidth(way) + 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' });
  for (const way of ways) if (CASED.has(way.kind)) top('polyline', { points: polyPoints(way.points), fill: 'none', stroke: theme.casing?.[way.kind] ?? '#6f6552', 'stroke-width': lineWidth(way) + 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' });
  for (const way of ways) {
    const pts = polyPoints(way.points);
    top('polyline', { points: pts, fill: 'none', stroke: theme.ways?.[way.kind] ?? WAY_COLOR[way.kind] ?? '#fff', 'stroke-width': lineWidth(way), 'stroke-linecap': way.kind === 'wall' || way.kind === 'border' ? 'butt' : 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': way.kind === 'border' ? '12 7' : null, 'pointer-events': 'none' });
    if (way.kind === 'rail') top('polyline', { points: pts, fill: 'none', stroke: '#fff', 'stroke-width': Math.max(lineWidth(way) * 0.4, 1), 'stroke-dasharray': '8 8', 'pointer-events': 'none' });
    if (way.kind === 'wall') top('polyline', { points: pts, fill: 'none', stroke: '#00000044', 'stroke-width': lineWidth(way), 'stroke-dasharray': '2 2', 'pointer-events': 'none' });
  }

  for (const district of map.districts) {
    if (district.polygon.length < 3 || isHiddenItem('district', district)) continue;
    const foggy = state.showFog && district.fog !== 'known';
    const picked = isSelected('district', district.id);
    const node = top('polygon', { points: polyPoints(district.polygon), fill: foggy ? '#000' : district.color, 'fill-opacity': foggy ? (district.fog === 'hidden' ? 0.85 : 0.5) : picked ? 0.2 : 0.1, stroke: district.color, 'stroke-width': picked ? 4 : 2.5, 'stroke-dasharray': '10 5', 'stroke-linejoin': 'round', 'pointer-events': 'stroke', 'data-type': 'district', 'data-id': district.id, style: 'cursor:pointer' });
    tip(node, `Distrito: ${district.name}`);
    const namesAPlace = map.places.some((place) => place.name.trim().toLowerCase() === district.name.trim().toLowerCase());   // el nombre ya está en el lugar: no se repite
    if (state.showLabels && !hidden.has('labels') && !foggy && !namesAPlace && (picked || polygonArea(district.polygon) * view.k * view.k > 14000)) { const c = polygonCentroid(district.polygon); const p = S(c.x, c.y); const label = top('text', { x: p.x, y: p.y - 14, 'text-anchor': 'middle', class: dark ? 'me-label' : 'me-label', 'font-size': 14 }); label.textContent = district.name; }
  }

  // conexiones: la línea ya está pintada en el canvas; aquí van las zonas de clic (finas y transparentes), los tooltips y los asas del trazado
  const index = placeIndex(map);
  for (const link of map.links) {
    if (isHiddenItem('link', link)) continue;
    const points = linkPoints(map, link, index); if (!points) continue;
    const node = top('polyline', { points: polyPoints(smoothLine(points, points.length > 2 ? 3 : 0)), fill: 'none', stroke: 'transparent', 'stroke-width': 14, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'stroke', 'data-type': 'link', 'data-id': link.id, style: 'cursor:pointer' });
    tip(node, `${link.name || link.id} · ${formatKm(linkKm(map, link, index))} · ${formatDuration(linkMinutes(map, link, index))}`);
  }
  for (const item of map.decor) {
    if (isHiddenItem('decor', item) || !Number.isFinite(item.x)) continue;
    const p = S(item.x, item.y); const px = decorPixels(item, view.k); const picked = isSelected('decor', item.id);
    const wide = item.kind === 'label' ? Math.max(40, (item.name?.length ?? 6) * px * 0.55) : px;
    const group = top('g', { 'data-type': 'decor', 'data-id': item.id, style: 'cursor:pointer', transform: `rotate(${item.rotation || 0} ${p.x} ${p.y})` });
    top('rect', { x: p.x - wide / 2, y: p.y - px / 2, width: wide, height: px, fill: 'transparent', stroke: picked ? '#fff' : 'none', 'stroke-width': 2, 'stroke-dasharray': '6 4', rx: 4 }, group);
    tip(group, item.kind === 'label' ? `Etiqueta: ${item.name}` : `${DECOR_LABEL[item.kind] ?? item.kind}${item.name ? `: ${item.name}` : ''}`);
  }
  const labelClass = dark ? 'me-label' : 'me-label dark';
  for (const place of map.places) {
    if (!Number.isFinite(place.x) || isHiddenItem('place', place)) continue;
    const p = S(place.x, place.y); const picked = isSelected('place', place.id);
    const symbol = layout.symbols.find((item) => item.place.id === place.id);
    const group = top('g', { 'data-type': 'place', 'data-id': place.id, style: 'cursor:pointer' });
    const color = KIND_COLOR[place.kind] ?? '#fff';
    if (place.footprint?.width > 0 && place.footprint?.depth > 0) {
      const w = place.footprint.width * view.k; const d = place.footprint.depth * view.k;
      if (w > 3) top('rect', { x: p.x - w / 2, y: p.y - d / 2, width: w, height: d, fill: '#b3492c88', stroke: '#6b2a18', transform: `rotate(${place.footprint.rotation || 0} ${p.x} ${p.y})` }, group);
    }
    const radius = symbol ? 5 : 5 + Math.max(0, (place.importance ?? 2) - 2);
    if (picked) top('circle', { cx: p.x, cy: p.y, r: radius + 7, fill: 'none', stroke: '#fff', 'stroke-width': 2.5 }, group);
    if (place.discovery !== 'known') top('circle', { cx: p.x, cy: p.y, r: radius + 4, fill: 'none', stroke: color, 'stroke-dasharray': '3 3', 'stroke-width': 2 }, group);
    top('circle', { cx: p.x, cy: p.y, r: Math.max(radius + 6, 12), fill: 'transparent' }, group);   // zona de clic cómoda (también con el dedo)
    top('circle', { cx: p.x, cy: p.y, r: radius, fill: symbol ? 'none' : color, stroke: symbol ? color : '#000a', 'stroke-width': symbol ? 2.5 : 2 }, group);
    if (place.access !== 'public') { const lock = top('text', { x: p.x + 9, y: p.y - 7, 'font-size': 11 }, group); lock.textContent = place.access === 'private' ? '🔒' : '⛔'; }
    const spec = layout.labels.get(place.id);
    if (spec && state.showLabels && !hidden.has('labels')) {
      const label = top('text', { x: spec.x, y: spec.y, class: labelClass, 'font-size': spec.size, 'text-anchor': spec.align === 'center' ? 'middle' : spec.align === 'left' ? 'start' : 'end', 'dominant-baseline': 'central', 'letter-spacing': spec.spacing || null, 'font-weight': spec.level >= 4 ? 700 : 600 }, group);
      label.textContent = spec.text;
    } else if (picked) { const label = top('text', { x: p.x + 14, y: p.y + 4, class: labelClass, 'font-size': 12 }, group); label.textContent = place.name; }
    tip(group, `${place.name} · ${KIND_LABEL[place.kind] ?? place.kind} · importancia ${place.importance ?? 2}${place.faction ? ` · ${place.faction}` : ''}`);
  }

  // asas del elemento seleccionado (vértices de áreas, distritos, caminos y del trazado de una conexión)
  const item = state.selection && ['area', 'district', 'way', 'link'].includes(state.selection.type) ? selected() : null;
  if (item && state.tool === 'select' && !frozenBy(item, state.selection.type)) {
    const type = state.selection.type;
    const closed = type === 'area' || type === 'district';
    const color = type === 'district' ? item.color : dark ? '#ffffff' : '#1b2a4a';
    if (type === 'link') {
      const full = linkPoints(map, item, index);
      if (full) {
        full.forEach(([x, y], i) => {
          if (i < full.length - 1) { const next = full[i + 1]; const m = S((x + next[0]) / 2, (y + next[1]) / 2); top('circle', { cx: m.x, cy: m.y, r: 5, fill: '#ffffffcc', stroke: color, 'data-type': 'mid', 'data-index': i, style: 'cursor:copy' }); }
          if (i > 0 && i < full.length - 1) { const p = S(x, y); top('rect', { x: p.x - 5, y: p.y - 5, width: 10, height: 10, fill: '#fff', stroke: color, 'stroke-width': 2, 'data-type': 'vertex', 'data-index': i - 1, style: 'cursor:move' }); }
        });
      }
    } else {
      const points = pointsOf(type, item);
      points.forEach(([x, y], i) => {
        const p = S(x, y);
        const next = closed ? points[(i + 1) % points.length] : points[i + 1];
        if (next) { const m = S((x + next[0]) / 2, (y + next[1]) / 2); top('circle', { cx: m.x, cy: m.y, r: 4, fill: '#ffffff99', stroke: color, 'data-type': 'mid', 'data-index': i, style: 'cursor:copy' }); }
        top('rect', { x: p.x - 5, y: p.y - 5, width: 10, height: 10, fill: '#fff', stroke: color, 'stroke-width': 2, 'data-type': 'vertex', 'data-index': i, style: 'cursor:move' });
      });
    }
  }

  if (state.draft) {
    const mouse = state.mouse ? snap(state.mouse.wx, state.mouse.wy, { off: state.mouse.alt }) : null;
    if (state.draft.kind === 'link') {
      const from = find('place', state.draft.from); const hover = state.mouse ? nearestPlace(state.mouse.wx, state.mouse.wy) : null;
      const world = [[from.x, from.y], ...state.draft.points, ...(hover && hover.id !== from.id ? [[hover.x, hover.y]] : mouse ? [mouse] : [])];
      const screen = world.map(([x, y]) => S(x, y));
      top('polyline', { points: screen.map((p) => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: linkColor(map, { mode: state.newLink.mode, line: state.newLink.line }, theme), 'stroke-width': 4, 'stroke-opacity': 0.85, 'stroke-dasharray': '8 6', 'stroke-linecap': 'round', 'pointer-events': 'none' });
      state.draft.points.forEach(([x, y]) => { const p = S(x, y); top('circle', { cx: p.x, cy: p.y, r: 4, fill: '#f2d6a8', stroke: '#000', 'pointer-events': 'none' }); });
      const a = S(from.x, from.y); top('circle', { cx: a.x, cy: a.y, r: 9, fill: 'none', stroke: '#fff', 'stroke-width': 3, 'pointer-events': 'none' });
      if (hover && hover.id !== from.id) { const h = S(hover.x, hover.y); top('circle', { cx: h.x, cy: h.y, r: 11, fill: 'none', stroke: '#5ec8e5', 'stroke-width': 3, 'pointer-events': 'none' }); }
      const km = polylineLength(world) / 1000; const lab = top('text', { x: screen.at(-1).x + 12, y: screen.at(-1).y - 10, class: 'me-label', 'font-size': 13 }); lab.textContent = formatKm(km);
    } else {
      const screen = state.draft.points.map(([x, y]) => S(x, y));
      const preview = state.mouse ? [...screen, S(...snap(state.mouse.wx, state.mouse.wy, { off: state.mouse.alt }))] : screen;
      const color = state.draft.kind === 'way' ? '#fff' : '#1b2a4a';
      if (preview.length) top('polyline', { points: preview.map((p) => `${p.x},${p.y}`).join(' '), fill: state.draft.kind === 'way' ? 'none' : '#ffffff44', stroke: color, 'stroke-width': state.draft.kind === 'way' ? Math.max(state.newWay.width * view.k, 2) : 2, 'stroke-opacity': state.draft.kind === 'way' ? 0.7 : 1, 'stroke-dasharray': '6 4', 'stroke-linecap': 'round', 'pointer-events': 'none' });
      screen.forEach((p, i) => top('circle', { cx: p.x, cy: p.y, r: i === 0 ? 7 : 4, fill: i === 0 ? '#fff' : '#f2d6a8', stroke: '#000', 'pointer-events': 'none' }));
    }
  }
  for (const [line, color, kind] of [[state.calib, '#1f9d6b', 'calib'], [state.measure, '#c27a1e', 'measure']]) {
    if (!line) continue;
    const b = line.b ?? (state.mouse ? { x: state.mouse.wx, y: state.mouse.wy } : null);
    const p = S(line.a.x, line.a.y);
    top('circle', { cx: p.x, cy: p.y, r: 5, fill: color, stroke: '#000', 'pointer-events': 'none' });
    if (!b) continue;
    const q = S(b.x, b.y);
    top('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: color, 'stroke-width': 2.5, 'pointer-events': 'none' });
    top('circle', { cx: q.x, cy: q.y, r: 5, fill: color, stroke: '#000', 'pointer-events': 'none' });
    const m = distance(line.a, b);
    const label = top('text', { x: (p.x + q.x) / 2 + 8, y: (p.y + q.y) / 2 - 8, class: 'me-label', 'font-size': 13 });
    label.textContent = kind === 'calib' ? fmtMeters(m) : measureText(m);
  }

  placeBrushCursor();
  if (state.marquee) {
    const p = S(state.marquee.a.wx, state.marquee.a.wy); const q = S(state.marquee.b.wx, state.marquee.b.wy); const entire = state.marquee.b.wx >= state.marquee.a.wx;
    top('rect', { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y), fill: entire ? '#2e86c133' : '#3fae6a33', stroke: entire ? '#2e86c1' : '#3fae6a', 'stroke-width': 1.5, 'stroke-dasharray': entire ? null : '6 4', 'pointer-events': 'none' });
  }
  // barra de escala
  const target = 120 / view.k; const power = 10 ** Math.floor(Math.log10(target));
  const metersBar = NICE.map((n) => n * power).concat(10 * power).filter((m) => m <= target).at(-1) ?? power;
  const barY = height - 46; const barW = metersBar * view.k; const barColor = dark ? '#f1f5fb' : '#111';
  top('line', { x1: 16, y1: barY, x2: 16 + barW, y2: barY, stroke: barColor, 'stroke-width': 3, 'pointer-events': 'none' });
  top('line', { x1: 16, y1: barY - 5, x2: 16, y2: barY + 5, stroke: barColor, 'stroke-width': 2, 'pointer-events': 'none' });
  top('line', { x1: 16 + barW, y1: barY - 5, x2: 16 + barW, y2: barY + 5, stroke: barColor, 'stroke-width': 2, 'pointer-events': 'none' });
  const barLabel = top('text', { x: 16, y: barY - 9, class: dark ? 'me-label' : 'me-label dark', 'font-size': 12 }); barLabel.textContent = fmtMeters(metersBar);
}
// Texto de la herramienta Medir: distancia y tiempo por cada medio (las velocidades salen de las del mapa).
function measureText(meters) {
  const km = meters / 1000; const mode = (name) => formatDuration(Math.max(1, Math.round((km / speedKmh(state.map, name)) * 60)));
  return `${fmtMeters(meters)} · a pie ${mode('walk')} · carretera ${mode('road')} · Northline ${mode('northline')}`;
}

// --- Paneles -----------------------------------------------------------------------------------------------------------------------------------
function renderTools() {
  $('#tools').innerHTML = TOOLS.map(([id, label, key]) => `<button type="button" data-tool="${id}" class="${state.tool === id ? 'active' : ''}" title="Atajo: ${key}">${label}</button>`).join('');
  $('#canvas').className = `me-canvas mv tool-${state.tool}${state.final ? ' final' : ''}`;
  $('#hint').textContent = state.map ? (state.final ? 'Vista final (solo lectura): desplaza y haz zoom. Desactiva «Vista final» o pulsa Esc para volver a editar.' : HINTS[state.tool]) : '';
  const options = $('#options');
  if (state.tool === 'place') options.innerHTML = `<label class="me-inline">Tipo <select data-opt="place-kind">${PLACE_KINDS.map((kind) => `<option value="${kind}" ${kind === state.newPlace.kind ? 'selected' : ''}>${esc(KIND_LABEL[kind])}</option>`).join('')}</select></label>`;
  else if (state.tool === 'link') options.innerHTML = `<label class="me-inline">Modo <select data-opt="link-mode">${LINK_MODES.map((mode) => `<option value="${mode}" ${mode === state.newLink.mode ? 'selected' : ''}>${esc(LINK_LABEL[mode])}</option>`).join('')}</select></label>
    <label class="me-inline">Línea <select data-opt="link-line"><option value="">— ninguna —</option>${(state.map?.lines ?? []).map((line) => `<option value="${esc(line.id)}" ${line.id === state.newLink.line ? 'selected' : ''}>${esc(line.name || line.id)}</option>`).join('')}</select></label>`;
  else if (state.tool === 'decor') options.innerHTML = `<label class="me-inline">Tipo <select data-opt="decor-kind">${DECOR_KINDS.map((kind) => `<option value="${kind}" ${kind === state.newDecor.kind ? 'selected' : ''}>${esc(DECOR_LABEL[kind])}</option>`).join('')}</select></label>`;
  else if (state.tool === 'area') options.innerHTML = `<label class="me-inline">Tipo <select data-opt="area-kind">${AREA_KINDS.map((kind) => `<option value="${kind}" ${kind === state.newArea ? 'selected' : ''}>${esc(AREA_LABEL[kind])}</option>`).join('')}</select></label>`;
  else if (state.tool === 'way') options.innerHTML = `<label class="me-inline">Tipo <select data-opt="way-kind">${WAY_KINDS.map((kind) => `<option value="${kind}" ${kind === state.newWay.kind ? 'selected' : ''}>${esc(WAY_LABEL[kind])}</option>`).join('')}</select></label>
    <label class="me-inline">Ancho (m) <input type="number" min="0.5" step="0.5" data-opt="way-width" value="${state.newWay.width}"></label>`;
  else if (state.tool === 'brush') {
    const b = state.brush; const [rMin, rMax] = brushRange(); const slider = Math.round((100 * Math.log(Math.max(b.radius, rMin) / rMin)) / Math.log(rMax / rMin));
    options.innerHTML = `<div class="me-chips">${[...TERRAIN_KINDS, 'none'].map((kind) => `<button type="button" class="me-chip${b.kind === kind ? ' active' : ''}" data-brush-kind="${kind}" style="--c:${kind === 'none' ? '#ffffff' : THEMES.default.areas[kind]}"><i></i>${kind === 'none' ? 'Borrar' : esc(TERRAIN_LABEL[kind])}</button>`).join('')}</div>
      <label class="me-inline">Modo <select data-opt="brush-mode">${[['paint', 'Pintar'], ['shape', 'Forma (polígono)'], ['smooth', 'Suavizar'], ['fill', 'Bote']].map(([value, label]) => `<option value="${value}" ${b.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="me-inline">Radio <input type="range" min="0" max="100" data-opt="brush-size" value="${slider}"><output>${fmtMeters(b.radius)}</output></label>
      <label class="me-inline">Borde irregular <input type="range" min="0" max="1" step="0.05" data-opt="brush-rugged" value="${b.rugged}"></label>
      <label class="me-inline"><input type="checkbox" data-opt="brush-protect" ${b.protectWater ? 'checked' : ''}> No pisar el agua</label>`;
  } else options.innerHTML = '';
}

function renderTabs() {
  const count = state.issues.errors.length + state.issues.warnings.length;
  const tabs = [['places', 'Lugares'], ['links', 'Conexiones'], ['zones', 'Zonas'], ['ways', 'Caminos'], ['terrain', 'Terreno'], ['groups', 'Grupos'], ['map', 'Mapa'], ['issues', `Avisos${count ? ` (${count})` : ''}`]];
  $('#tabs').innerHTML = tabs.map(([id, label]) => `<button type="button" data-tab="${id}" class="${state.tab === id ? 'active' : ''}">${label}</button>`).join('');
}

const row = (type, item, dot, extra, indent = 0) => `<div class="me-row${isSelected(type, item.id) ? ' selected' : ''}" data-select="${type}:${esc(item.id)}" style="padding-left:${0.45 + indent}rem"><span class="me-dot" style="background:${esc(dot)}"></span><span>${esc(item.name || item.id)}</span><small>${frozenBy(item, type) || (type === 'group' && item.locked) ? '🔒 ' : ''}${esc(extra)}</small></div>`;

// --- Pestaña «Conexiones»: líneas de transporte, enlaces con su distancia y tiempo, calculadora de viaje y velocidades del mapa -----------------------------------
function linksPanel() {
  const map = normalizeMap(state.map); const index = placeIndex(map); const theme = themeFor(state.map);
  const linkRow = (link) => row('link', link, linkColor(map, link, theme), `${formatKm(linkKm(map, link, index))} · ${link.minutes ? '' : '≈ '}${formatDuration(linkMinutes(map, link, index))}`);
  const lines = map.lines.map((line) => row('line', line, line.color, `${map.links.filter((link) => link.line === line.id).length === 1 ? '1 enlace' : `${map.links.filter((link) => link.line === line.id).length} enlaces`}`)).join('');
  const groups = Object.keys(TRAVEL_MODES).filter((mode) => mode !== 'walk').map((mode) => [mode, map.links.filter((link) => link.mode === mode)]).filter(([, list]) => list.length);
  const options = (selectedId) => `<option value="">— elige —</option>${[...map.places].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((place) => `<option value="${esc(place.id)}" ${place.id === selectedId ? 'selected' : ''}>${esc(place.name)}</option>`).join('')}`;
  let result = '<p class="me-note">Elige origen y destino para ver cuánto se tarda a pie y por cada medio de transporte del mapa.</p>';
  if (state.route.from && state.route.to && state.route.from !== state.route.to) {
    const trip = planTrip(map, state.route.from, state.route.to);
    result = trip.options.length ? trip.options.map((option) => `<div class="me-route${option.tooFar ? ' far' : ''}"><strong>${esc(option.label)}</strong> <span>${formatDuration(option.minutes)}</span> <small>${formatKm(option.km)}${option.cost ? ` · costo ${option.cost}` : ''}${option.tooFar ? ' · demasiado lejos a pie' : ''}</small>${option.legs.length ? `<div class="me-legs">${option.legs.map((leg) => `<span class="me-leg" style="--c:${esc(linkColor(map, leg, theme))}">${esc(TRAVEL_MODES[leg.mode]?.label ?? leg.mode)}: ${esc(map.places.find((place) => place.id === leg.from)?.name ?? leg.from)} → ${esc(map.places.find((place) => place.id === leg.to)?.name ?? leg.to)} · ${formatDuration(leg.minutes)}</span>`).join('')}</div>` : ''}</div>`).join('') : '<p class="me-note">No hay ninguna forma de ir de uno a otro con lo que hay dibujado.</p>';
  }
  const speeds = Object.entries(TRAVEL_MODES).map(([mode, info]) => `<label class="me-field"><span>${esc(info.label)} (km/h)</span><input type="number" min="1" step="1" data-speed="${mode}" value="${state.map.travel?.speedsKmh?.[mode] ?? ''}" placeholder="${info.kmh}"></label>`).join('');
  return `<h3>${map.links.length} conexiones</h3>
    <p class="me-note">Una conexión une dos lugares con un modo de transporte. Su <strong>distancia</strong> sale del trazado dibujado (o la escribes) y su <strong>tiempo</strong> de la distancia y la velocidad del modo (o lo escribes). Son datos que el motor puede usar para calcular desplazamientos. Herramienta «Conexión» (C) para dibujar una nueva.</p>
    <h4>Líneas de transporte (${map.lines.length})</h4>${lines || '<p class="me-empty">Sin líneas: sirven para agrupar enlaces de un mismo tren o metro (Línea Este…) con su color.</p>'}<button type="button" data-action="add-line">Nueva línea</button>
    ${groups.map(([mode, list]) => `<h4>${esc(TRAVEL_MODES[mode].label)} (${list.length})</h4>${list.map(linkRow).join('')}`).join('') || '<p class="me-empty">Aún no hay conexiones.</p>'}
    <button type="button" data-action="add-link" ${map.places.length < 2 ? 'disabled' : ''}>Añadir conexión entre dos lugares</button>
    <h4>Calculadora de viaje</h4>
    <div class="me-grid2"><label class="me-field"><span>Desde</span><select data-route="from">${options(state.route.from)}</select></label><label class="me-field"><span>Hasta</span><select data-route="to">${options(state.route.to)}</select></label></div>${result}
    <h4>Velocidades de este mapa</h4><p class="me-note">Dejar vacío = la velocidad por defecto (gris). Las usa el cálculo de tiempos cuando una conexión no tiene minutos escritos.</p><div class="me-grid2">${speeds}</div>`;
}

function renderActiveGroup() {
  const select = $('#active-group');
  if (!state.map) { select.innerHTML = ''; select.disabled = true; return; }
  select.disabled = false;
  const open = state.map.groups.filter((group) => !lockedBy(state.map, { group: group.id }));
  select.innerHTML = `<option value="">— ninguno —</option>${open.map((group) => `<option value="${esc(group.id)}" ${group.id === state.activeGroup ? 'selected' : ''}>${esc(group.name || group.id)}</option>`).join('')}<option value="__new__">＋ Nuevo grupo…</option>`;
}

function groupTree(parent = null, depth = 0) {
  return state.map.groups.filter((group) => (group.parent ?? null) === parent).map((group) => {
    const count = membersOf(group.id).length;
    return row('group', group, group.locked ? '#c27a1e' : '#7d8699', `${count} elem.`, depth * 0.9) + groupTree(group.id, depth + 1);
  }).join('');
}

function renderPanel() {
  const panel = $('#panel'); const map = state.map;
  if (!map) { panel.innerHTML = '<p class="me-empty">Elige un mapa en la barra superior o crea uno nuevo.</p>'; return; }
  if (state.tab === 'places') {
    const legacy = [...state.context.legacyIds].filter((id) => !takenPlaceIds().has(id));
    const places = [...map.places].sort((a, b) => (b.importance ?? 2) - (a.importance ?? 2) || a.name.localeCompare(b.name, 'es'));
    panel.innerHTML = `<h3>${map.places.length} lugares</h3>${places.map((place) => row('place', place, KIND_COLOR[place.kind], KIND_LABEL[place.kind] ?? place.kind)).join('') || '<p class="me-empty">Usa la herramienta «Lugar» y haz clic en el mapa.</p>'}
      <h4>Decoración y etiquetas (${map.decor.length})</h4>${map.decor.map((item) => row('decor', item, '#b9a98a', item.kind === 'label' ? 'Etiqueta' : DECOR_LABEL[item.kind])).join('') || '<p class="me-empty">La herramienta «Decoración» coloca rosas de los vientos, barcos, ruinas y etiquetas de texto (mares, cordilleras…).</p>'}
      <p class="me-note">Las conexiones entre lugares (carreteras, Northline, rutas marítimas…) están en la pestaña «Conexiones».</p>
      ${legacy.length ? `<h4>Provisionales</h4><p class="me-note">Hay ${legacy.length} lugares provisionales del juego sin colocar (${esc(legacy.join(', '))}).</p><button type="button" data-action="import-legacy">Importar lugares provisionales</button>` : ''}`;
  } else if (state.tab === 'links') {
    panel.innerHTML = linksPanel();
  } else if (state.tab === 'zones') {
    panel.innerHTML = `<h3>${map.areas.length} áreas</h3>${[...map.areas].sort((a, b) => b.z - a.z).map((area) => row('area', area, area.color ?? AREA_COLOR[area.kind], AREA_LABEL[area.kind])).join('') || '<p class="me-empty">Usa «Área» para dibujar agua, tierra, bosque o zonas urbanas.</p>'}
      <h4>Distritos de juego (${map.districts.length})</h4>${map.districts.map((district) => row('district', district, district.color, DISCOVERY_LABEL[district.fog])).join('') || '<p class="me-empty">Usa «Distrito» para marcar las zonas con niebla.</p>'}`;
  } else if (state.tab === 'ways') {
    panel.innerHTML = `<h3>${map.ways.length} caminos</h3>${[...map.ways].sort((a, b) => b.z - a.z).map((way) => row('way', way, WAY_COLOR[way.kind], `${WAY_LABEL[way.kind]} · ${fmtMeters(polylineLength(way.points))}`)).join('') || '<p class="me-empty">Usa «Camino» para trazar calles, ríos, murallas…</p>'}`;
  } else if (state.tab === 'terrain') {
    panel.innerHTML = terrainPanel();
  } else if (state.tab === 'groups') {
    panel.innerHTML = `<h3>${map.groups.length} grupos</h3><p class="me-note">Agrupa una parte, ciudad o facción. Un grupo bloqueado (y todo lo que contiene) deja de recibir cambios. Lo que dibujes nuevo se añade al «grupo activo» de la barra superior.</p>
      ${groupTree() || '<p class="me-empty">Aún no hay grupos.</p>'}<button type="button" data-action="add-group">Nuevo grupo</button>`;
  } else if (state.tab === 'map') {
    const box = mapBounds(map);
    panel.innerHTML = `<h3>Mapa</h3>
      <label class="me-field"><span>Nombre</span><input data-m="name" value="${esc(map.name)}" maxlength="60"></label>
      <div class="me-field"><span>Id</span><code>${esc(map.id)}</code></div>
      <p class="me-note">${box ? `Extensión: ${fmtMeters(box.maxX - box.minX)} × ${fmtMeters(box.maxY - box.minY)}. Caminando se cruza en ${minutesFor(box.maxX - box.minX, WALK_METERS_PER_MIN)} min.` : 'Lienzo vacío: dibuja algo o añade una imagen de calco.'}</p>
      ${styleSection(map)}
      <h4>Imágenes de calco (${map.underlays.length})</h4>
      <p class="me-note">Opcionales: solo sirven para calcar encima. No forman parte del mapa final. Calíbralas con la herramienta «Escala».</p>
      ${map.underlays.map((item, index) => `<div class="me-underlay"><label class="me-inline"><input type="checkbox" data-u="${index}" data-uf="visible" ${item.visible ? 'checked' : ''}> <strong>${esc(item.id)}</strong> <small>${item.width}×${item.height} px</small></label>
        <div class="me-grid2"><label class="me-field"><span>x (m)</span><input type="number" step="any" data-u="${index}" data-uf="x" value="${item.x}"></label><label class="me-field"><span>y (m)</span><input type="number" step="any" data-u="${index}" data-uf="y" value="${item.y}"></label></div>
        <div class="me-grid2"><label class="me-field"><span>m por píxel</span><input type="number" min="0" step="any" data-u="${index}" data-uf="metersPerPixel" value="${item.metersPerPixel}"></label><label class="me-field"><span>Opacidad</span><input type="range" min="0" max="1" step="0.05" data-u="${index}" data-uf="opacity" value="${item.opacity}"></label></div>
        <button type="button" class="danger" data-u-remove="${index}">Quitar</button></div>`).join('')}
      <label class="me-field"><span>Añadir imagen de calco (png, webp o jpg)</span><input type="file" id="add-underlay" accept="image/png,image/webp,image/jpeg"></label><label class="me-inline"><input type="checkbox" id="underlay-convert" checked> Convertir a WebP (más ligera)</label>`;
  } else {
    const issue = (level) => (entry) => `<button type="button" class="me-issue ${level}" data-issue="${esc(entry.ref?.type ?? '')}:${esc(entry.ref?.id ?? '')}"><strong>${level === 'error' ? 'Error' : 'Aviso'}</strong> · ${esc(entry.message)}</button>`;
    panel.innerHTML = `<h3>Validación</h3>${[...state.issues.errors.map(issue('error')), ...state.issues.warnings.map(issue('warn'))].join('') || '<p class="me-empty">Sin problemas.</p>'}`;
  }
}

function styleSection(map) {
  const effective = themeFor(map).post;
  return `<h4>Estilo y shader</h4><div class="me-style">${POST_KEYS.map((key) => {
    const value = effective[key] ?? POST_NEUTRAL[key]; const [low, high] = POST_RANGE[key];
    return `<label><span>${esc(POST_LABEL[key])}</span><output>${value}</output><input type="range" min="${low}" max="${high}" step="0.05" data-post="${key}" value="${value}"></label>`;
  }).join('')}</div>
      <button type="button" data-action="reset-post" ${map.style?.post ? '' : 'disabled'}>Restablecer los ajustes del estilo</button>
      <p class="me-note">El estilo se elige en la barra inferior. Activa «Vista final» para ver el resultado con el shader: es lo que se exportará.</p>`;
}

const field = (label, control) => `<label class="me-field"><span>${label}</span>${control}</label>`;
const select = (name, options, value, labels = {}) => `<select data-f="${name}">${options.map((option) => `<option value="${esc(option)}" ${option === value ? 'selected' : ''}>${esc(labels[option] ?? option)}</option>`).join('')}</select>`;
const num = (name, value, attributes = '') => `<input data-f="${name}" type="number" step="any" value="${value ?? ''}" ${attributes}>`;
function groupSelect(item) {
  const options = state.map.groups.filter((group) => group.id === item.group || !lockedBy(state.map, { group: group.id }));
  return `<select data-f="group"><option value="">— ninguno —</option>${options.map((group) => `<option value="${esc(group.id)}" ${group.id === item.group ? 'selected' : ''}>${esc(group.name || group.id)}</option>`).join('')}</select>`;
}
function requirementRows(item) {
  return `<div class="me-field"><span>Requisitos de acceso</span>${(item.requires ?? []).map((need, index) => {
    const value = need.type === 'escort' ? need.npcId : need.type === 'story_flag' ? need.flag : need.type === 'knows_place' ? need.place : need.type === 'money' ? need.amount : '';
    return `<div class="me-req"><select data-req="type" data-i="${index}">${REQUIREMENT_TYPES.map((type) => `<option value="${type}" ${type === need.type ? 'selected' : ''}>${esc(REQUIREMENT_LABEL[type])}</option>`).join('')}</select>
      <input data-req="value" data-i="${index}" value="${esc(value ?? '')}" ${need.type === 'invitation' ? 'disabled' : ''} placeholder="${need.type === 'escort' ? 'id del personaje' : need.type === 'story_flag' ? 'nombre del hito' : need.type === 'knows_place' ? 'id del lugar' : need.type === 'money' ? 'cantidad' : ''}">
      <button type="button" data-req-remove="${index}" class="danger" aria-label="Quitar">×</button></div>`;
  }).join('')}<button type="button" data-req-add>Añadir requisito</button></div>`;
}

function fillStats(area) {
  const gen = genCache.get(area.id);
  if (!state.showFill) return '<p class="me-note">Vista previa del relleno desactivada (casilla «Relleno» de la barra inferior).</p>';
  if (!gen) return '';
  const { blocks, buildings, trees, truncated } = gen.result;
  const parts = [blocks.length ? `${blocks.length} manzanas` : '', buildings.length ? `${buildings.length.toLocaleString('es')} casas` : '', trees.length ? `${trees.length.toLocaleString('es')} árboles` : ''].filter(Boolean).join(' · ');
  return `<p class="me-note">Generado: ${parts || 'nada (el área es demasiado pequeña, o la receta no cabe)'} · ${Math.round(gen.ms)} ms. Los caminos despejan su calzada, los lugares reservan su parcela y el agua, las plazas y los parques no se edifican.${truncated ? ' <strong>Límite alcanzado: el resultado está cortado; reduce el área o aumenta las medidas.</strong>' : ''}</p>`;
}

function fillFields(area) {
  const fill = area.fill ?? { pattern: 'none' };
  const patternField = field('Relleno (casas, calles, árboles)', select('pattern', FILL_PATTERNS, fill.pattern, PATTERN_LABEL));
  if (fill.pattern === 'none') return `${patternField}<p class="me-note">Sin relleno: el área es un color liso.</p>`;
  const seed = `<div class="me-field"><span>Semilla (otra semilla = otra distribución)</span><div class="me-grid2">${num('fill.seed', fill.seed, 'min="0" step="1"')}<button type="button" data-action="reseed">🎲 Nueva</button></div></div>`;
  if (fill.pattern === 'forest') return `${patternField}${seed}<div class="me-grid2">${field('Separación entre árboles (m)', num('fill.treeSpacing', fill.treeSpacing, 'min="1"'))}${field('Densidad (0–1)', num('fill.density', fill.density, 'min="0" max="1" step="0.05"'))}</div>`;
  return `${patternField}${seed}
    <div class="me-grid2">${field('Manzana mín. (m)', num('fill.blockSize.min', fill.blockSize?.min, 'min="1"'))}${field('Manzana máx. (m)', num('fill.blockSize.max', fill.blockSize?.max, 'min="1"'))}</div>
    <div class="me-grid2">${field('Casa ancho (m)', num('fill.lotSize.width', fill.lotSize?.width, 'min="1"'))}${field('Casa fondo (m)', num('fill.lotSize.depth', fill.lotSize?.depth, 'min="1"'))}</div>
    <div class="me-grid2">${field('Calle (m)', num('fill.streetWidth', fill.streetWidth, 'min="1"'))}${field('Densidad (0–1)', num('fill.density', fill.density, 'min="0" max="1" step="0.05"'))}</div>
    ${fill.pattern !== 'radial' ? field('Rotación (°)', num('fill.rotation', fill.rotation)) : `<div class="me-grid2">${field('Anillos', num('fill.rings', fill.rings, 'min="1" step="1"'))}${field('Radios', num('fill.spokes', fill.spokes, 'min="3" step="1"'))}</div>
      <div class="me-field"><span>Centro (m)</span><div class="me-grid2">${num('fill.center.0', fill.center?.[0])}${num('fill.center.1', fill.center?.[1])}</div><button type="button" data-action="center-fill">Usar el centro del área</button></div>`}
    ${fillStats(area)}`;
}

function renderMultiInspector() {
  const items = state.multi; const names = { place: 'lugares', area: 'áreas', way: 'caminos', district: 'distritos', decor: 'adornos' };
  const tally = Object.keys(names).map((type) => [type, items.filter((entry) => entry.type === type).length]).filter(([, n]) => n).map(([type, n]) => `${n} ${names[type]}`).join(', ');
  const locked = items.filter((entry) => frozenBy(find(entry.type, entry.id), entry.type)).length;
  const groups = state.map.groups.filter((group) => !lockedBy(state.map, { group: group.id }));
  return `<h3>${items.length} elementos seleccionados</h3><p class="me-note">${tally}${locked ? ` · ${locked} bloqueado(s): se omiten al agrupar o borrar` : ''}</p>
    <div class="me-multi"><label class="me-field"><span>Mover todos al grupo</span><select data-multi="group"><option value="__keep__">— elige —</option><option value="">— sacarlos de su grupo —</option>${groups.map((group) => `<option value="${esc(group.id)}">${esc(group.name || group.id)}</option>`).join('')}</select></label>
      <button type="button" data-action="multi-duplicate">Duplicar la selección (Ctrl+D)</button>
      <button type="button" data-action="multi-new-group">Nuevo grupo con la selección (Ctrl+G)</button>
      <button type="button" data-action="multi-clear">Deseleccionar</button>
      <button type="button" class="danger" data-action="multi-delete">Borrar la selección</button></div>
    <p class="me-note">Ctrl o Mayús + clic suman o quitan elementos. Con la herramienta «Selección» (S) arrastra un rectángulo.</p>`;
}

function renderInspector() {
  const box = $('#inspector'); const item = selected();
  if (!state.map) { box.innerHTML = ''; return; }
  if (state.multi.length > 1) { box.innerHTML = renderMultiInspector(); return; }
  if (!item) { box.innerHTML = '<p class="me-empty">Selecciona un lugar, área, camino, distrito, conexión, decoración o grupo para editarlo.</p><p class="me-note">Con la herramienta «Mover» (V) un clic selecciona; con «Selección» (S) puedes arrastrar un rectángulo. Ctrl+D duplica y Supr borra. El menú «Capas» oculta o bloquea clases enteras de elementos.</p>'; return; }
  const type = state.selection.type;
  const idField = field('Id (único en el mapa)', `<input data-f="id" value="${esc(item.id)}" maxlength="41" spellcheck="false">`);
  const nameField = field('Nombre', `<input data-f="name" value="${esc(item.name)}" maxlength="60">`);
  let body = ''; let title = ''; let locked = type === 'group' ? null : frozenBy(item, type);
  const remove = (label) => `<button type="button" class="danger" data-action="delete">${label}</button>`;

  if (type === 'place') {
    title = 'Lugar';
    const normalized = normalizeMap(state.map).places.find((place) => place.id === item.id);
    const district = normalized?.district ? state.map.districts.find((entry) => entry.id === normalized.district) : null;
    const owners = ['', ...[...state.context.npcIds].sort()]; const footprint = item.footprint;
    const normalizedMap = normalizeMap(state.map); const index = placeIndex(normalizedMap);
    const connections = normalizedMap.links.filter((link) => link.from === item.id || link.to === item.id);
    const IMPORTANCE_LABEL = { 1: '1 · Menor', 2: '2 · Local', 3: '3 · Relevante', 4: '4 · Principal', 5: '5 · Dominante' };
    const defaultIcon = PLACE_DEFAULT_ICON[item.kind];
    const iconLabels = { '': defaultIcon ? `Por defecto (${PLACE_ICON_LABEL[defaultIcon]})` : 'Por defecto (sin símbolo)', ...PLACE_ICON_LABEL };
    const dataText = Object.entries(item.data ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n');
    body = `${field('Id (único en todo el juego)', `<input data-f="id" value="${esc(item.id)}" maxlength="41" spellcheck="false">`)}${nameField}
      <div class="me-grid2">${field('Tipo', select('kind', PLACE_KINDS, item.kind, KIND_LABEL))}${field('Importancia (tamaño y etiqueta)', select('importance', ['1', '2', '3', '4', '5'], String(item.importance ?? 2), IMPORTANCE_LABEL))}</div>
      <div class="me-grid2">${field('Icono en el mapa', select('icon', ['', ...PLACE_ICONS], item.icon ?? '', iconLabels))}${field('Región / facción', `<input data-f="faction" value="${esc(item.faction ?? '')}" maxlength="40" placeholder="p. ej. Northfortress">`)}</div>
      <div class="me-grid2">${field('Acceso', select('access', ACCESS, item.access, ACCESS_LABEL))}${field('Descubrimiento inicial', select('discovery', DISCOVERY, item.discovery, DISCOVERY_LABEL))}</div>
      ${field('Dueño', `<select data-f="owner">${owners.map((id) => `<option value="${esc(id)}" ${id === (item.owner ?? '') ? 'selected' : ''}>${esc(id || '— ninguno —')}</option>`).join('')}</select>`)}
      <div class="me-grid2">${field('x (m)', num('x', item.x))}${field('y (m)', num('y', item.y))}</div>
      <div class="me-field"><span>Distrito (se calcula solo)</span><code>${esc(district?.name ?? '— fuera de todo distrito —')}</code></div>
      ${field('Grupo', groupSelect(item))}
      <div class="me-field"><span>Conexiones (${connections.length})</span>${connections.map((link) => { const other = link.from === item.id ? link.to : link.from; return `<button type="button" class="me-conn" data-select-link="${esc(link.id)}"><i style="background:${esc(linkColor(normalizedMap, link, themeFor(state.map)))}"></i>${esc(TRAVEL_MODES[link.mode]?.label ?? link.mode)} → ${esc(normalizedMap.places.find((place) => place.id === other)?.name ?? other)} <small>${formatKm(linkKm(normalizedMap, link, index))} · ${formatDuration(linkMinutes(normalizedMap, link, index))}</small></button>`; }).join('') || '<small class="me-note">Sin conexiones: usa la herramienta «Conexión» (C).</small>'}</div>
      <div class="me-field"><span>Imagen o visual asociado</span>${item.image ? `<img class="me-thumb" alt="" src="/assets/maps/${esc(item.image)}?v=${state.loadedAt}">` : ''}<input type="file" id="place-image" accept="image/png,image/webp,image/jpeg">${item.image ? '<button type="button" data-action="remove-image">Quitar imagen</button>' : ''}</div>
      ${field('Datos adicionales (una línea «clave: valor»; los usa el simulador)', `<textarea data-f="data" rows="3" spellcheck="false" placeholder="poblacion: 5000000&#10;funcion: capital">${esc(dataText)}</textarea>`)}
      <div class="me-field"><span><label class="me-inline"><input type="checkbox" data-f="hasFootprint" ${footprint ? 'checked' : ''}> Con huella de edificio</label></span>
        ${footprint ? `<div class="me-grid2">${num('footprint.width', footprint.width, 'min="1" placeholder="ancho m"')}${num('footprint.depth', footprint.depth, 'min="1" placeholder="fondo m"')}</div>${field('Rotación (°)', num('footprint.rotation', footprint.rotation ?? 0))}` : ''}</div>
      <div class="me-field"><span><label class="me-inline"><input type="checkbox" data-f="hasHours" ${item.hours ? 'checked' : ''}> Con horario</label></span>
        ${item.hours ? `<div class="me-grid2">${num('hours.open', item.hours.open, 'min="0" max="23" step="1"')}${num('hours.close', item.hours.close, 'min="1" max="24" step="1"')}</div>` : ''}</div>
      ${field('Alias (separados por comas)', `<input data-f="aliases" value="${esc((item.aliases ?? []).join(', '))}">`)}
      ${field('Etiquetas (separadas por comas)', `<input data-f="tags" value="${esc((item.tags ?? []).join(', '))}">`)}
      ${field('Descripción', `<textarea data-f="description" maxlength="600">${esc(item.description)}</textarea>`)}
      ${requirementRows(item)}<div class="me-actions"><button type="button" data-action="duplicate">Duplicar</button>${remove('Borrar lugar')}</div>`;
  } else if (type === 'area') {
    title = item.kind === 'region' ? 'Región / territorio' : 'Área';
    const tint = `<div class="me-field"><span><label class="me-inline"><input type="checkbox" data-f="hasColor" ${item.color ? 'checked' : ''}> Color propio${item.kind === 'region' ? '' : ' (si no, el del estilo)'}</label></span>${item.color ? `<input data-f="color" type="color" value="${esc(item.color)}">` : ''}</div>`;
    body = `${idField}${nameField}
      <div class="me-grid2">${field('Tipo', select('kind', AREA_KINDS, item.kind, AREA_LABEL))}${field('Orden de dibujo', num('z', item.z, 'step="1"'))}</div>
      ${item.kind === 'region' ? field('Facción / dueño del territorio', `<input data-f="faction" value="${esc(item.faction ?? '')}" maxlength="40">`) : ''}${tint}
      ${field('Grupo', groupSelect(item))}${item.kind === 'region' ? '<p class="me-note">Una región política se pinta translúcida con borde discontinuo y su nombre en letras grandes sobre el territorio. No tapa lo demás: se selecciona por su borde.</p>' : fillFields(item)}
      <p class="me-note">${item.polygon.length} vértices · ${fmtArea(polygonArea(item.polygon))}. Arrastra los cuadrados; los círculos de las aristas añaden vértices; clic derecho en un vértice lo borra. Las áreas con mayor «orden» se dibujan encima.</p>
      <div class="me-actions"><button type="button" data-action="duplicate">Duplicar</button>${remove('Borrar área')}</div>`;
  } else if (type === 'way') {
    title = 'Camino';
    body = `${idField}${nameField}
      <div class="me-grid2">${field('Tipo', select('kind', WAY_KINDS, item.kind, WAY_LABEL))}${field('Ancho (m)', num('width', item.width, 'min="0.5" step="0.5"'))}</div>
      <div class="me-grid2">${field('Orden de dibujo', num('z', item.z, 'step="1"'))}${field('Grupo', groupSelect(item))}</div>
      <p class="me-note">${item.points.length} puntos · ${fmtMeters(polylineLength(item.points))} · ${minutesFor(polylineLength(item.points), WALK_METERS_PER_MIN)} min a pie. Arrastra los cuadrados; los círculos añaden puntos; clic derecho borra uno.</p>
      <div class="me-actions"><button type="button" data-action="duplicate">Duplicar</button>${remove('Borrar camino')}</div>`;
  } else if (type === 'district') {
    title = 'Distrito';
    body = `${idField}${nameField}
      <div class="me-grid2">${field('Color', `<input data-f="color" type="color" value="${esc(item.color)}">`)}${field('Niebla inicial', select('fog', DISCOVERY, item.fog, DISCOVERY_LABEL))}</div>
      ${field('Grupo', groupSelect(item))}
      <label class="me-inline"><input type="checkbox" data-f="allowPlayerPlaces" ${item.allowPlayerPlaces ? 'checked' : ''}> El jugador puede colocar aquí su casa y marcas</label>
      <p class="me-note">${item.polygon.length} vértices · ${fmtArea(polygonArea(item.polygon))}. Arrastra los cuadrados; los círculos añaden vértices; clic derecho borra uno.</p>
      <div class="me-actions"><button type="button" data-action="duplicate">Duplicar</button>${remove('Borrar distrito')}</div>`;
  } else if (type === 'link') {
    title = 'Conexión';
    const places = state.map.places; const map = normalizeMap(state.map); const index = placeIndex(map); const made = map.links.find((link) => link.id === item.id) ?? item;
    const endpoint = (name, value) => `<select data-f="${name}">${[...places.map((place) => place.id), ...[...state.context.takenIds].filter((id) => !places.some((place) => place.id === id))].map((id) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(places.find((place) => place.id === id)?.name ?? id)}</option>`).join('')}</select>`;
    const drawn = drawnKm(map, made, index); const used = linkKm(map, made, index); const minutes = linkMinutes(map, made, index);
    const lineOptions = ['', ...state.map.lines.map((line) => line.id)]; const lineLabels = { '': '— ninguna —', ...Object.fromEntries(state.map.lines.map((line) => [line.id, line.name || line.id])) };
    body = `${idField}${nameField}
      <div class="me-grid2">${field('Desde', endpoint('from', item.from))}${field('Hasta', endpoint('to', item.to))}</div>
      <div class="me-grid2">${field('Modo', select('mode', LINK_MODES, item.mode, LINK_LABEL))}${field('Línea de transporte', select('line', lineOptions, item.line ?? '', lineLabels))}</div>
      <div class="me-grid2">${field('Distancia (km)', num('distanceKm', item.distanceKm, `min="0.1" step="0.1" placeholder="${drawn === null ? 'sin dibujo' : `${drawn.toFixed(1)} (del dibujo)`}"`))}${field('Minutos', num('minutes', item.minutes, `min="1" step="1" placeholder="${minutes ?? '—'} (auto)"`))}</div>
      <p class="me-note"><strong>${formatKm(used)} · ${formatDuration(minutes)}</strong>${item.minutes ? ' (tiempo escrito)' : ` (tiempo calculado a ${speedKmh(map, item.mode)} km/h)`}${item.distanceKm ? '' : ' · distancia del trazado'}. A pie serían ${used === null ? '—' : formatDuration(walkMinutes(map, used))}. Trazado: ${item.path.length} punto(s) intermedio(s); arrastra los cuadrados, los círculos añaden puntos y clic derecho borra uno.</p>
      <div class="me-grid2">${field('Costo', num('cost', item.cost, 'min="0" step="0.5"'))}<label class="me-inline me-pad"><input type="checkbox" data-f="twoWay" ${item.twoWay !== false ? 'checked' : ''}> Se puede ir en los dos sentidos</label></div>
      ${requirementRows(item)}<div class="me-actions"><button type="button" data-action="duplicate">Duplicar</button>${remove('Borrar conexión')}</div>`;
  } else if (type === 'decor') {
    title = item.kind === 'label' ? 'Etiqueta de texto' : 'Decoración';
    body = `${idField}${item.kind === 'label' ? field('Texto', `<input data-f="name" value="${esc(item.name)}" maxlength="60">`) : nameField}
      <div class="me-grid2">${field('Tipo', select('kind', DECOR_KINDS, item.kind, DECOR_LABEL))}${field('Grupo', groupSelect(item))}</div>
      <div class="me-grid2">${field(item.kind === 'label' ? 'Tamaño del texto (m)' : 'Tamaño (m)', num('size', item.size, 'min="1" step="any"'))}${field('Rotación (°)', num('rotation', item.rotation ?? 0, 'step="1"'))}</div>
      <div class="me-grid2">${field('x (m)', num('x', item.x))}${field('y (m)', num('y', item.y))}</div>
      <p class="me-note">Es solo decorativo: no cambia ninguna regla. Su tamaño es del mundo (crece al acercar el zoom) con un mínimo y un máximo en pantalla.</p>
      <div class="me-actions"><button type="button" data-action="duplicate">Duplicar</button>${remove('Borrar')}</div>`;
  } else if (type === 'line') {
    title = 'Línea de transporte';
    const used = state.map.links.filter((link) => link.line === item.id);
    body = `${idField}${nameField}
      <div class="me-grid2">${field('Modo', select('mode', LINK_MODES, item.mode, LINK_LABEL))}${field('Color', `<input data-f="color" type="color" value="${esc(item.color)}">`)}</div>
      <p class="me-note">${used.length ? `Enlaces en esta línea: ${used.map((link) => esc(link.name || link.id)).join('; ')}.` : 'Ningún enlace pertenece todavía a esta línea: elige la línea en el panel de una conexión (o en las opciones de la herramienta «Conexión»).'} Los enlaces de una línea se dibujan con su color y seguir en ella no cuenta como transbordo.</p>
      <div class="me-actions"><button type="button" data-action="duplicate">Duplicar</button>${remove('Borrar línea')}</div>`;
  } else {
    title = 'Grupo';
    const ancestors = groupChain(state.map, item.parent); const ancestorLock = ancestors.find((group) => group.locked);
    const banned = descendantIds(item.id); const count = membersOf(item.id);
    const tally = ['areas', 'ways', 'districts', 'places', 'decor'].map((key) => [key, count.filter((entry) => entry.key === key).length]).filter(([, n]) => n).map(([key, n]) => `${n} ${{ areas: 'áreas', ways: 'caminos', districts: 'distritos', places: 'lugares', decor: 'adornos' }[key]}`).join(', ');
    locked = ancestorLock;
    const lockBox = ancestorLock ? '' : `<label class="me-inline"><input type="checkbox" data-f="locked" ${item.locked ? 'checked' : ''}> <strong>Bloqueado</strong> (no recibe cambios)</label>`;
    body = `${lockBox}<fieldset ${item.locked || ancestorLock ? 'disabled' : ''}>${idField}${nameField}
      ${field('Dentro de', `<select data-f="parent"><option value="">— ninguno —</option>${state.map.groups.filter((group) => !banned.has(group.id)).map((group) => `<option value="${esc(group.id)}" ${group.id === item.parent ? 'selected' : ''}>${esc(group.name || group.id)}</option>`).join('')}</select>`)}
      <p class="me-note">Contiene: ${tally || 'nada todavía'}.${item.baked ? ` Horneado: ${esc(item.baked)}.` : ''} (El horneado —congelar el relleno generado de un grupo terminado— llegará con el exportador.)</p>
      <button type="button" data-action="activate-group">Dibujar dentro de este grupo</button> <button type="button" data-action="fit-group">Encuadrar</button>
      ${remove('Borrar grupo (su contenido se conserva)')}</fieldset>`;
  }
  box.innerHTML = `<h3>${title}</h3>${locked ? `<span class="me-lock">🔒 ${esc(lockText(locked))}</span>` : ''}${type === 'group' ? body : `<fieldset ${locked ? 'disabled' : ''}>${body}</fieldset>`}`;
}

function renderTheme() {
  const select = $('#theme'); select.disabled = !state.map;
  if (select.options.length !== Object.keys(THEMES).length) select.innerHTML = Object.entries(THEMES).map(([id, theme]) => `<option value="${id}">${esc(theme.title)}</option>`).join('');
  select.value = THEMES[state.map?.style?.theme] ? state.map.style.theme : 'default';
  $('#final-view').checked = state.final; $('#final-view').disabled = !state.map;
}

function renderAll() {
  if (!state.drag) refreshGenerated();
  renderTheme();
  renderTools(); renderTabs(); renderPanel(); renderInspector(); renderActiveGroup(); renderCanvas(); renderStatus(); renderPopovers(); renderContextBar();
  $('#undo').disabled = !state.history.length; $('#redo').disabled = !state.future.length; $('#save').disabled = !state.map;
}

// --- Capas, opciones de vista y barra contextual -------------------------------------------------------------------------------------------------------------
function layerCounts() {
  const counts = Object.fromEntries(LAYERS.map((layer) => [layer.id, 0])); const map = state.map;
  for (const [type, items] of [['area', map.areas], ['way', map.ways], ['district', map.districts], ['place', map.places], ['link', map.links], ['decor', map.decor]]) for (const item of items) counts[layerOf(type, item, map)] += 1;
  counts.terrain += state.terrain?.chunks.size ?? Object.keys(map.terrain?.chunks ?? {}).length;
  return counts;
}
function renderPopovers() {
  const layers = $('#layers-pop'); const viewPop = $('#view-pop');
  $('#layers-btn').setAttribute('aria-expanded', String(state.layersOpen)); $('#view-btn').setAttribute('aria-expanded', String(state.viewOpen === true));
  layers.hidden = !(state.layersOpen && state.map); viewPop.hidden = !(state.viewOpen && state.map);
  $('#themed').checked = state.themed; $('#snap-grid').checked = state.snapGrid;
  $('#layers-btn').textContent = state.layers.hidden.size || state.layers.locked.size ? `Capas (${state.layers.hidden.size ? `${state.layers.hidden.size} ocultas` : ''}${state.layers.hidden.size && state.layers.locked.size ? ' · ' : ''}${state.layers.locked.size ? `${state.layers.locked.size} 🔒` : ''}) ▾` : 'Capas ▾';
  if (layers.hidden) return;
  const counts = layerCounts();
  layers.innerHTML = `<h4>Capas</h4>${LAYERS.map((layer) => {
    const hidden = state.layers.hidden.has(layer.id); const locked = state.layers.locked.has(layer.id);
    return `<div class="me-layer${hidden ? ' off' : ''}" title="${esc(layer.hint)}"><button type="button" class="eye" data-layer-eye="${layer.id}" aria-pressed="${!hidden}" aria-label="${hidden ? 'Mostrar' : 'Ocultar'} ${esc(layer.label)}" title="${hidden ? 'Mostrar' : 'Ocultar'}">${hidden ? '○' : '●'}</button><span>${esc(layer.label)}<small>${counts[layer.id] || ''}</small></span><button type="button" class="lock" data-layer-lock="${layer.id}" aria-pressed="${locked}" aria-label="${locked ? 'Desbloquear' : 'Bloquear'} ${esc(layer.label)}" title="${locked ? 'Desbloquear (se puede editar)' : 'Bloquear (no se puede editar)'}">${locked ? '🔒' : '🔓'}</button></div>`;
  }).join('')}<div class="me-pop-actions"><button type="button" data-layer-all="show">Mostrar todas</button><button type="button" data-layer-all="unlock">Desbloquear todas</button></div><p class="me-note">Ocultar solo afecta a lo que ves y eliges; bloquear impide mover o editar esa clase de elementos. No se guardan en el mapa.</p>`;
}
const TYPE_NAME = { place: 'Lugar', area: 'Área', way: 'Camino', district: 'Distrito', link: 'Conexión', decor: 'Decoración', group: 'Grupo', line: 'Línea' };
function renderContextBar() {
  const bar = $('#ctx-bar'); const item = selected();
  if (!state.map || state.final || (!item && state.multi.length < 2)) { bar.hidden = true; return; }
  if (state.multi.length > 1) { bar.hidden = false; bar.innerHTML = `<strong>${state.multi.length} elementos</strong><button type="button" data-ctx="duplicate">Duplicar</button><button type="button" class="danger" data-ctx="delete">Borrar</button><button type="button" data-ctx="clear">Soltar</button>`; return; }
  const type = state.selection.type; const frozen = type === 'group' ? null : frozenBy(item, type);
  bar.hidden = false;
  bar.innerHTML = `<strong title="${esc(item.name || item.id)}">${esc(item.name || item.id)}</strong><small>${TYPE_NAME[type] ?? type}${frozen ? ' · 🔒' : ''}</small>${type === 'group' ? '' : `<button type="button" data-ctx="duplicate" ${frozen ? 'disabled' : ''}>Duplicar</button>`}<button type="button" data-ctx="focus">Encuadrar</button><button type="button" class="danger" data-ctx="delete" ${frozen ? 'disabled' : ''}>Borrar</button>`;
}
$('#ctx-bar').addEventListener('click', (event) => {
  const action = event.target.closest('button')?.dataset.ctx; if (!action) return;
  if (action === 'duplicate') duplicateSelection();
  else if (action === 'delete') removeSelected();
  else if (action === 'clear') setSet([]);
  else if (action === 'focus') { const item = selected(); if (item) centerOnItem(state.selection.type, item); }
});
$('#layers-btn').onclick = () => { state.layersOpen = !state.layersOpen; state.viewOpen = false; renderPopovers(); };
$('#view-btn').onclick = () => { state.viewOpen = !state.viewOpen; state.layersOpen = false; renderPopovers(); };
document.addEventListener('pointerdown', (event) => {
  if (!state.layersOpen && !state.viewOpen) return;
  if (event.target.closest('.me-pop, #layers-btn, #view-btn')) return;
  state.layersOpen = false; state.viewOpen = false; renderPopovers();
});
$('#layers-pop').addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.layerEye) { const id = button.dataset.layerEye; if (state.layers.hidden.has(id)) state.layers.hidden.delete(id); else state.layers.hidden.add(id); }
  else if (button.dataset.layerLock) { const id = button.dataset.layerLock; if (state.layers.locked.has(id)) state.layers.locked.delete(id); else state.layers.locked.add(id); }
  else if (button.dataset.layerAll === 'show') state.layers.hidden.clear();
  else if (button.dataset.layerAll === 'unlock') state.layers.locked.clear();
  saveLayerPrefs();
  const item = selected(); if (item && isHiddenItem(state.selection.type, item)) state.selection = null;   // lo que se oculta deja de estar seleccionado
  state.multi = state.multi.filter((entry) => !isHiddenItem(entry.type, find(entry.type, entry.id)));
  renderAll();
});
$('#themed').onchange = (event) => { state.themed = event.target.checked; saveLayerPrefs(); renderCanvas(); };
$('#snap-grid').onchange = (event) => { state.snapGrid = event.target.checked; saveLayerPrefs(); };
// En pantallas estrechas las listas y las propiedades son cajones que se abren con los botones de la barra superior.
$('#toggle-left').onclick = () => { $('.me-main').classList.toggle('drawer-left'); $('.me-main').classList.remove('drawer-right'); };
$('#toggle-right').onclick = () => { $('.me-main').classList.toggle('drawer-right'); $('.me-main').classList.remove('drawer-left'); };

// Imagen asociada a un lugar: se sube como las imágenes de calco (assets/maps) y el lugar guarda el nombre del archivo.
const shortHash = (value) => { let h = 2166136261; for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36).slice(0, 9); };
$('#inspector').addEventListener('change', async (event) => {
  if (event.target.id !== 'place-image' || !event.target.files[0]) return;
  const item = selected(); if (!item || refuseIfFrozen(item, 'place')) return;
  try {
    setStatus('Subiendo imagen…'); const image = await uploadImage(state.map.id, event.target.files[0], true, `lugar${shortHash(item.id)}`);
    state.loadedAt = Date.now(); mutate(() => { item.image = image.file; }); setStatus('Imagen asociada al lugar: guarda el mapa para conservarla.', 'dirty');
  } catch (error) { setStatus(error.message, 'bad'); }
});

// --- Terreno ----------------------------------------------------------------------------------------------------------------------------------------
// El terreno vive en state.map.terrain (datos comprimidos) y, mientras se edita, en una rejilla en memoria que se vuelve a volcar al terminar cada pincelada.
// Círculo del pincel: se coloca sin repintar el mapa entero (solo sigue al ratón).
function placeBrushCursor() {
  for (const node of view.top.querySelectorAll('.brush-cursor')) node.remove();
  if (state.tool !== 'brush' || !state.mouse || state.final || state.brush.mode === 'shape') return;
  const p = view.toScreen(state.mouse.wx, state.mouse.wy); const erase = state.brush.kind === 'none' || state.mouse.alt; const r = Math.max(3, state.brush.radius * view.k);
  view.svgElement('circle', { class: 'brush-cursor', cx: p.x, cy: p.y, r, fill: erase ? '#ffffff22' : `${THEMES.default.areas[state.brush.kind] ?? '#ffffff'}66`, stroke: '#111', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }, view.top);
  view.svgElement('circle', { class: 'brush-cursor', cx: p.x, cy: p.y, r, fill: 'none', stroke: '#fff', 'stroke-width': 0.8, 'pointer-events': 'none' }, view.top);
}
function renderGround() {
  const ground = view.beginGround();
  if (state.map && state.showTerrain) drawTerrain(ground, { k: view.k, tx: view.tx, ty: view.ty, width: view.rect.width, height: view.rect.height }, getTerrain(), THEMES.default);
}
function getTerrain() {
  if (!state.map) return null;
  if (!state.terrain || state.terrainFor !== state.map.terrain) { state.terrain = new Terrain(state.map.terrain); state.terrainFor = state.map.terrain; }
  return state.terrain;
}
function commitTerrain({ rebuild = false } = {}) {
  const terrain = state.terrain; const plain = terrain.cell === TERRAIN_DEFAULTS.cell && terrain.seed === TERRAIN_DEFAULTS.seed && terrain.forest.spacing === TERRAIN_DEFAULTS.forest.spacing && terrain.forest.density === TERRAIN_DEFAULTS.forest.density;
  const data = terrain.isEmpty() && plain ? null : terrain.toData();
  state.map.terrain = data; state.terrainFor = data;
  if (rebuild && data) state.terrain = new Terrain(data);   // los parámetros (semilla, bosque) cambian lo que se dibuja: caché nueva
}
const brushOptions = (alt) => {
  const b = state.brush; const erase = alt || b.kind === 'none';
  return { mode: erase ? 'erase' : b.mode === 'smooth' ? 'smooth' : 'paint', rugged: b.rugged, protect: !erase && b.protectWater && b.kind !== 'water' ? ['water'] : [] };
};
// Rango del radio del pincel según la escala del mapa (celdas de 16 m: de 8 m a 3 km; de 1 km: de 500 m a 60 km).
function brushRange() { const cell = state.map?.terrain?.cell ?? TERRAIN_DEFAULTS.cell; return [Math.max(8, cell / 2), Math.max(3000, cell * 60)]; }
function fitBrush() {
  const cell = state.map?.terrain?.cell ?? TERRAIN_DEFAULTS.cell; const [min, max] = brushRange();
  state.brush.radius = Math.min(max, Math.max(min, cell > TERRAIN_DEFAULTS.cell ? cell * 6 : 120));
  state.gen.scale = cell > TERRAIN_DEFAULTS.cell ? cell * 40 : 1800;
}
// Pintar con una FORMA: se dibuja un polígono (como un área) y se rellena de golpe con el material elegido (mares, desiertos, cordilleras…).
function shapeClick(wx, wy, event) {
  state.draft ??= { kind: 'terrain', points: [] };
  const first = state.draft.points[0]; const [x, y] = snap(wx, wy, { off: event.altKey });
  if (first && state.draft.points.length >= 3) { const a = view.toScreen(first[0], first[1]); const b = view.toScreen(x, y); if (Math.hypot(a.x - b.x, a.y - b.y) < 10) { finishShape(event.altKey); return; } }
  state.draft.points.push([x, y]); renderCanvas();
}
function finishShape(erase = false) {
  const draft = state.draft; state.draft = null;
  if (!draft || draft.points.length < 3) { renderAll(); return; }
  const b = state.brush; const terrain = getTerrain(); const wipe = erase || b.kind === 'none';
  pushHistory();
  const changed = paintPolygon(terrain, draft.points, wipe ? null : b.kind, { mode: wipe ? 'erase' : 'paint', rugged: b.rugged, protect: !wipe && b.protectWater && b.kind !== 'water' ? ['water'] : [] });
  commitTerrain(); validate(); renderAll();
  setStatus(`${changed.toLocaleString('es')} celdas ${wipe ? 'borradas' : 'pintadas'} con la forma.`, 'dirty');
}
function startStroke(wx, wy, event) {
  const terrain = getTerrain(); const b = state.brush; pushHistory();
  if (b.mode === 'fill') {
    const result = floodFill(terrain, wx, wy, event.altKey || b.kind === 'none' ? null : b.kind);
    commitTerrain(); validate(); renderAll();
    setStatus(result.truncated ? 'La región es demasiado grande o está abierta: ciérrala con el pincel o pinta directamente.' : `${result.filled.toLocaleString('es')} celdas rellenadas.`, result.truncated ? 'bad' : 'dirty');
    return;
  }
  view.container.setPointerCapture?.(event.pointerId);
  state.stroke = { last: [wx, wy], alt: event.altKey };
  paintStroke(terrain, [[wx, wy]], b.radius, b.kind === 'none' ? null : b.kind, brushOptions(event.altKey));
  renderGround(); placeBrushCursor();
}
function continueStroke(wx, wy) {
  const stroke = state.stroke; const b = state.brush;
  paintStroke(getTerrain(), [stroke.last, [wx, wy]], b.radius, b.kind === 'none' ? null : b.kind, brushOptions(stroke.alt));
  stroke.last = [wx, wy]; renderGround(); placeBrushCursor();
}
function runGenerator() {
  const g = state.gen; const terrain = getTerrain();
  const box = g.region === 'map' && mapBounds(state.map) ? mapBounds(state.map) : view.worldBounds;
  const cells = ((box.maxX - box.minX) / terrain.cell) * ((box.maxY - box.minY) / terrain.cell);
  if (cells > 1_500_000) { setStatus(`Esa zona es demasiado grande para generarla de una vez (${Math.round(cells / 1000)} mil celdas): acerca la vista.`, 'bad'); return; }
  pushHistory();
  const changed = generateTerrain(terrain, box, g);
  commitTerrain(); validate(); renderAll();
  setStatus(`${changed.toLocaleString('es')} celdas generadas${g.overwrite ? '' : ' (solo en lo vacío)'}.`, 'dirty');
}
function terrainPanel() {
  const terrain = getTerrain(); const g = state.gen; const cells = terrain.paintedCells();
  const slider = (key, label, min, max, step) => `<label><span>${label}</span><output>${g[key]}</output><input type="range" min="${min}" max="${max}" step="${step}" data-gen="${key}" value="${g[key]}"></label>`;
  return `<h3>Terreno</h3>
    <p class="me-note">Se pinta con el <strong>Pincel</strong> (B): agua, tierra, arena, campo, bosque, parque y montaña, con bordes naturales. Los polígonos de «Zonas» se reservan para las ciudades. ${cells ? `${cells.toLocaleString('es')} celdas pintadas (${((cells * terrain.cell * terrain.cell) / 1e6).toFixed(2)} km²) en ${terrain.chunks.size} trozos.` : 'Aún no hay terreno pintado.'}</p>
    <h4>Escala del terreno</h4>
    <p class="me-note">Cada celda del terreno mide ${fmtMeters(terrain.cell)}: ${terrain.cell > 100 ? 'es un mapa de región o continente (las coordenadas son metros del mundo, así que 300 km son 300 000).' : 'es un mapa de ciudad.'} ${cells ? 'Solo se puede cambiar con el terreno vacío.' : 'Elígela antes de pintar.'}</p>
    <div class="me-grid2"><label class="me-field"><span>Perfil</span><select data-terrain="preset" ${cells ? 'disabled' : ''}>${Object.entries(TERRAIN_PRESETS).map(([id, preset]) => `<option value="${id}" ${preset.cell === terrain.cell ? 'selected' : ''}>${esc(preset.label)}</option>`).join('')}</select></label>
      <label class="me-field"><span>Celda (m)</span><input type="number" min="4" max="5000" step="1" data-terrain="cell" value="${terrain.cell}" ${cells ? 'disabled' : ''}></label></div>
    <h4>Bosques</h4>
    <div class="me-grid2"><label class="me-field"><span>Separación de copas (m)</span><input type="number" min="2" max="2000" step="0.5" data-terrain="spacing" value="${terrain.forest.spacing}"></label>
      <label class="me-field"><span>Densidad (0–1)</span><input type="number" min="0" max="1" step="0.05" data-terrain="density" value="${terrain.forest.density}"></label></div>
    <div class="me-field"><span>Semilla del terreno (bordes y árboles)</span><div class="me-grid2"><input type="number" step="1" data-terrain="seed" value="${terrain.seed}"><button type="button" data-action="terrain-reseed">🎲 Nueva</button></div></div>
    <h4>Generar terreno natural</h4>
    <p class="me-note">Rellena la zona con mar, costas, tierra, campos, bosques y montañas a partir de ruido. Se puede deshacer; la misma semilla da siempre el mismo terreno.</p>
    <div class="me-style">${slider('sea', 'Mar', 0, 1, 0.05)}${slider('forest', 'Bosques', 0, 1, 0.05)}${slider('mountains', 'Montañas', 0, 1, 0.05)}${slider('fields', 'Campos', 0, 1, 0.05)}${slider('island', 'Isla (mar en los bordes)', 0, 1, 0.05)}</div>
    <div class="me-grid2"><label class="me-field"><span>Tamaño de las formas (m)</span><input type="number" min="200" max="400000" step="100" data-gen="scale" value="${g.scale}"></label>
      <label class="me-field"><span>Semilla</span><div class="me-grid2"><input type="number" step="1" data-gen="seed" value="${g.seed}"><button type="button" data-action="gen-reseed" title="Semilla nueva">🎲</button></div></label></div>
    <label class="me-field"><span>Zona</span><select data-gen="region"><option value="view" ${g.region === 'view' ? 'selected' : ''}>La vista actual</option><option value="map" ${g.region === 'map' ? 'selected' : ''}>Toda la extensión del mapa</option></select></label>
    <label class="me-inline"><input type="checkbox" data-gen="overwrite" ${g.overwrite ? 'checked' : ''}> Sobrescribir lo ya pintado</label>
    <p><button type="button" class="primary" data-action="gen-terrain">Generar</button></p>
    <h4>Vaciar</h4><button type="button" class="danger" data-action="clear-terrain" ${cells ? '' : 'disabled'}>Borrar todo el terreno</button>`;
}

// --- Entrada: mapa --------------------------------------------------------------------------------------------------------------------------------
const targetOf = (event) => event.target.closest?.('[data-type]') ?? null;
const DRAW_TOOLS = { area: 'area', way: 'way', district: 'district' };

view.on('view', renderCanvas);
// Pellizcar con dos dedos (pantalla táctil) mueve y acerca el mapa: lo que hiciera el primer dedo (arrastre, rectángulo, trazo) se da por terminado.
view.on('pinchstart', () => {
  state.down = null; state.drag = null; state.marquee = null;
  if (state.stroke) { state.stroke = null; commitTerrain(); validate(); renderAll(); }
});
view.on('pointerdown', ({ wx, wy, event }) => {
  if (!state.map) return;
  $('#canvas').focus();
  if (state.final) { view.beginPan(event); return; }
  if (state.tool === 'brush' && event.button === 0) { if (state.brush.mode === 'shape') shapeClick(wx, wy, event); else startStroke(wx, wy, event); return; }
  if (event.button === 2 && state.draft?.kind === 'link' && !state.draft.points.length) { state.draft = null; renderAll(); return; }
  const target = targetOf(event);
  // clic derecho mientras se dibuja: quita el último punto (y cancela el dibujo si no queda ninguno)
  if (event.button === 2 && state.draft?.points.length) { state.draft.points.pop(); if (!state.draft.points.length) state.draft = null; renderAll(); return; }
  if (event.button === 2 && (state.measure || state.calib)) { state.measure = null; state.calib = null; renderCanvas(); return; }
  if (event.button === 1 || (event.button === 2 && !target)) { view.beginPan(event); return; }
  if (event.button === 2 && target?.dataset.type === 'vertex') { removeVertex(Number(target.dataset.index)); return; }
  if (event.button !== 0) return;
  const additive = event.ctrlKey || event.metaKey || event.shiftKey;
  state.down = { x: event.clientX, y: event.clientY, wx, wy, target, moved: false, alt: event.altKey, handled: false };
  if ((state.tool === 'select' || state.tool === 'pick') && target) {
    const { type, id, index } = target.dataset;
    if ((type === 'place' || type === 'district' || type === 'decor') && additive) { setSet(toggleItem(currentSet(), { type, id })); state.down.handled = true; }
    else if (state.tool === 'select') {
      if (type === 'place') {
        state.multi = []; state.selection = { type: 'place', id }; state.tab = 'places';
        if (!frozenBy(find('place', id), 'place')) state.drag = { kind: 'place', id };
        renderAll();
      } else if (type === 'decor') {
        state.multi = []; state.selection = { type: 'decor', id }; state.tab = 'places';
        if (!frozenBy(find('decor', id), 'decor')) state.drag = { kind: 'decor', id };
        renderAll();
      } else if (type === 'link') { state.multi = []; state.selection = { type: 'link', id }; state.tab = 'links'; renderAll(); }
      else if (type === 'district') { state.multi = []; state.selection = { type: 'district', id }; state.tab = 'zones'; renderAll(); }
      else if (type === 'vertex') state.drag = { kind: 'vertex', index: Number(index) };
      else if (type === 'mid') { insertVertex(Number(index), wx, wy); }
    }
  }
});
view.on('pointermove', ({ wx, wy, event }) => {
  state.mouse = { wx, wy, alt: event.altKey };
  $('#coords').textContent = state.map ? `x ${wx.toFixed(1)}  y ${wy.toFixed(1)} m` : '—';
  if (state.stroke) { continueStroke(wx, wy); return; }
  if (state.tool === 'brush' && !state.final) { placeBrushCursor(); return; }
  const down = state.down;
  if (down && !down.moved && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) {
    down.moved = true;
    if (state.drag) pushHistory();
    else if (state.tool === 'pick') state.marquee = { a: { wx: down.wx, wy: down.wy }, b: { wx, wy } };
    else view.beginPan(event);
  }
  if (state.marquee) { state.marquee.b = { wx, wy }; renderCanvas(); }
  else if (down?.moved && state.drag) moveDragged(wx, wy, event.altKey);
  else if (state.draft || state.measure || state.calib) renderCanvas();
});
view.on('pointerup', ({ wx, wy, event }) => {
  if (state.stroke) { state.stroke = null; commitTerrain(); validate(); renderAll(); return; }
  const down = state.down; state.down = null;
  if (!state.map || !down) return;
  if (state.marquee) { finishMarquee(event); return; }
  if (state.drag) { state.drag = null; if (down.moved) { validate(); renderAll(); return; } }
  if (down.moved || event.button !== 0) return;
  click(wx, wy, down.target, event, down);
});
// Rectángulo de selección: de izquierda a derecha → lo que queda entero dentro; de derecha a izquierda → lo que toca.
function finishMarquee(event) {
  const { a, b } = state.marquee; state.marquee = null;
  const found = itemsInRect(state.map, { minX: Math.min(a.wx, b.wx), minY: Math.min(a.wy, b.wy), maxX: Math.max(a.wx, b.wx), maxY: Math.max(a.wy, b.wy) }, { mode: b.wx >= a.wx ? 'inside' : 'touch' })
    .filter((entry) => !isHiddenItem(entry.type, find(entry.type, entry.id)));   // lo que está en una capa oculta no se selecciona
  setSet(event.ctrlKey || event.metaKey || event.shiftKey ? mergeItems(currentSet(), found) : found);
  setStatus(`${found.length} elemento(s) en el rectángulo${b.wx >= a.wx ? ' (enteros)' : ' (tocados)'}.`, 'ok');
}
view.on('dblclick', () => {
  const draft = state.draft; if (!draft || state.final || draft.kind === 'link') return;
  if (draft.points.length > (draft.kind === 'way' ? 2 : 3)) draft.points.pop();   // el doble clic ya añadió el punto dos veces
  finishDraft();
});

function moveDragged(wx, wy, alt) {
  const drag = state.drag;
  if (drag.kind === 'place' || drag.kind === 'decor') { const entry = find(drag.kind, drag.id); const [x, y] = snap(wx, wy, { off: alt }); entry.x = round(x); entry.y = round(y); }
  else if (drag.kind === 'vertex') { const item = selected(); const [x, y] = snap(wx, wy, { off: alt, except: state.selection }); pointsOf(state.selection.type, item)[drag.index] = [round(x), round(y)]; }
  renderCanvas(); renderInspector();
}
function insertVertex(index, wx, wy) {
  // en una conexión el trazado son solo los puntos INTERMEDIOS: la arista i va entre el punto i y el i+1 de [origen, …trazado, destino]
  const at = state.selection.type === 'link' ? index : index + 1;
  mutate(() => { pointsOf(state.selection.type, selected()).splice(at, 0, [round(wx), round(wy)]); });
  state.drag = { kind: 'vertex', index: at }; if (state.down) state.down.moved = true;   // el arrastre sigue sin otra instantánea de deshacer
}
function removeVertex(index) {
  const item = selected(); if (!item || !['area', 'district', 'way', 'link'].includes(state.selection.type) || frozenBy(item, state.selection.type)) return;
  const points = pointsOf(state.selection.type, item);
  if (points.length <= ({ way: 2, link: 0 }[state.selection.type] ?? 3)) return;
  mutate(() => { points.splice(index, 1); });
}

function click(wx, wy, target, event, down = {}) {
  const tool = state.tool;
  if (tool === 'select' || tool === 'pick') {
    if (down.handled) return;
    let hit = null;
    if (target) {   // los asas de vértice son de la herramienta Mover; un lugar, una conexión, un adorno o el borde de un distrito se eligen con Selección
      if (tool === 'select' || !['place', 'district', 'decor', 'link'].includes(target.dataset.type)) return;
      hit = { type: target.dataset.type, id: target.dataset.id };
    }
    hit ??= pick(wx, wy, { preferDistrict: event.altKey });
    if (event.ctrlKey || event.metaKey || event.shiftKey) { if (hit && SELECTABLE.includes(hit.type)) setSet(toggleItem(currentSet(), hit)); return; }
    if (hit) chooseSelection(hit.type, hit.id); else setSet([]);
  } else if (tool === 'place') addPlace(...snap(wx, wy, { off: event.altKey }));
  else if (tool === 'link') linkClick(wx, wy, target, event);
  else if (tool === 'decor') addDecor(...snap(wx, wy, { off: event.altKey }));
  else if (DRAW_TOOLS[tool]) {
    state.draft ??= { kind: DRAW_TOOLS[tool], points: [] };
    const [x, y] = snap(wx, wy, { off: event.altKey }); const first = state.draft.points[0];
    if (state.draft.kind !== 'way' && first && state.draft.points.length >= 3) { const a = view.toScreen(first[0], first[1]); const b = view.toScreen(x, y); if (Math.hypot(a.x - b.x, a.y - b.y) < 10) { finishDraft(); return; } }
    state.draft.points.push([x, y]); renderCanvas();
  } else if (tool === 'measure') {
    state.measure = !state.measure || state.measure.b ? { a: { x: wx, y: wy }, b: null } : { ...state.measure, b: { x: wx, y: wy } }; renderCanvas();
  } else if (tool === 'scale') {
    if (!state.calib || state.calib.b) { state.calib = { a: { x: wx, y: wy }, b: null }; renderCanvas(); return; }
    state.calib.b = { x: wx, y: wy }; renderCanvas(); calibrate();
  }
}

// Reescala la imagen de calco bajo el primer punto para que la distancia medida sea la real; el primer punto se queda donde está.
function calibrate() {
  const { a, b } = state.calib; const current = distance(a, b);
  const visible = state.map.underlays.filter((item) => item.visible && item.metersPerPixel > 0);
  const target = [...visible].reverse().find((item) => a.x >= item.x && a.y >= item.y && a.x <= item.x + item.width * item.metersPerPixel && a.y <= item.y + item.height * item.metersPerPixel) ?? visible.at(-1);
  if (!target) { state.calib = null; renderCanvas(); setStatus('No hay ninguna imagen de calco visible que calibrar (pestaña «Mapa»).', 'bad'); return; }
  if (current < 1) { state.calib = null; renderCanvas(); return; }
  const answer = prompt(`Esa línea mide ahora ${fmtMeters(current)} en «${target.id}». ¿Cuántos metros reales debería medir?`, '');
  const real = Number(String(answer ?? '').replace(',', '.'));
  state.calib = null;
  if (!answer || !(real > 0)) { renderCanvas(); return; }
  const factor = real / current;
  mutate((map) => {
    const layer = map.underlays.find((item) => item.id === target.id);
    layer.metersPerPixel = round(layer.metersPerPixel * factor, 6);
    layer.x = round(a.x + (layer.x - a.x) * factor); layer.y = round(a.y + (layer.y - a.y) * factor);
  });
  state.tool = 'select'; state.tab = 'map'; renderAll();
  setStatus(`«${target.id}» reescalada a ${round(target.metersPerPixel * factor, 4)} m/px.`, 'dirty');
}

// --- Entrada: paneles ---------------------------------------------------------------------------------------------------------------------------
function setPath(item, path, value) {
  const keys = path.split('.'); let node = item;
  for (const key of keys.slice(0, -1)) { node[key] ??= {}; node = node[key]; }
  node[keys.at(-1)] = value;
}
function setPattern(area, pattern) {
  const seed = area.fill?.seed ?? 1;
  area.fill = pattern === 'none' ? { pattern } : { ...structuredClone(FILL_DEFAULTS[pattern]), seed };
  if (pattern === 'radial') { const c = polygonCentroid(area.polygon); area.fill.center = [round(c.x), round(c.y)]; }
}
// «clave: valor» por línea → objeto (números y sí/no se reconocen; lo demás es texto).
function parseDataLines(textValue) {
  const out = {};
  for (const line of String(textValue).split('\n')) {
    const at = line.indexOf(':'); if (at < 1) continue;
    const key = line.slice(0, at).trim(); const raw = line.slice(at + 1).trim(); if (!key) continue;
    out[key] = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  return out;
}
function applyField(item, name, value, input) {
  const type = state.selection.type;
  if (name === 'aliases' || name === 'tags') item[name] = String(value).split(',').map((part) => part.trim()).filter(Boolean);
  else if (name === 'hasHours') item.hours = value ? { open: 8, close: 20 } : null;
  else if (name === 'hasFootprint') item.footprint = value ? { width: 12, depth: 16, rotation: 0 } : null;
  else if (name === 'owner') item.owner = value || null;
  else if (name === 'importance') item.importance = Number(value);
  else if (name === 'icon') item.icon = value || null;
  else if (name === 'faction') item.faction = String(value).trim() || null;
  else if (name === 'data') item.data = parseDataLines(value);
  else if (name === 'hasColor') item.color = value ? '#c9a45c' : null;
  else if (name === 'distanceKm' || name === 'minutes') item[name] = value === '' ? null : Number(value);
  else if (name === 'line') item.line = value || null;
  else if (name === 'group' || name === 'parent') item[name] = value || null;
  else if (name === 'pattern') setPattern(item, value);
  else if (name === 'kind' && type === 'area') { item.kind = value; item.z = AREA_Z[value] ?? item.z; }
  else if (name === 'kind' && type === 'way') { item.kind = value; item.width = WAY_WIDTH[value] ?? item.width; item.z = WAY_Z[value] ?? item.z; }
  else setPath(item, name, input.type === 'number' ? Number(value) : value);
}

$('#inspector').addEventListener('change', (event) => {
  if (event.target.dataset.multi === 'group') { if (event.target.value !== '__keep__') applyGroupToSelection(event.target.value || null); return; }
  const name = event.target.dataset.f; const item = selected();
  if (event.target.dataset.req !== undefined) return changeRequirement(event.target, item);
  if (!name || !item) return;
  if (state.selection.type !== 'group' && refuseIfFrozen(item)) return;
  if (name === 'id') { const old = item.id; if (!renameId(state.selection.type, old, event.target.value)) event.target.value = item.id; else { autoIds.delete(old); renderAll(); } return; }
  const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  const type = state.selection.type;
  mutate(() => {
    applyField(item, name, value, event.target);
    if (name === 'name' && autoIds.has(item.id) && type !== 'link' && type !== 'place') {
      const taken = localIds(); taken.delete(item.id);
      const next = uniqueId(slugify(value), taken);
      if (type === 'group') for (const key of ['areas', 'ways', 'districts', 'places', 'groups']) for (const entry of state.map[key]) { const field = key === 'groups' ? 'parent' : 'group'; if (entry[field] === item.id) entry[field] = next; }
      autoIds.delete(item.id); item.id = next; autoIds.add(next); state.selection = { type, id: next };
    } else if (name === 'name' && autoIds.has(item.id) && type === 'place') {
      const taken = takenPlaceIds(); taken.delete(item.id); const next = uniqueId(slugify(value), taken);
      for (const link of state.map.links) { if (link.from === item.id) link.from = next; if (link.to === item.id) link.to = next; }
      autoIds.delete(item.id); item.id = next; autoIds.add(next); state.selection = { type, id: next };
    }
  });
});
$('#inspector').addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button) return;
  const item = selected(); const action = button.dataset.action;
  if (button.dataset.selectLink) { chooseSelection('link', button.dataset.selectLink); centerOnItem('link', find('link', button.dataset.selectLink)); return; }
  if (action === 'duplicate' || action === 'multi-duplicate') duplicateSelection();
  else if (action === 'remove-image' && item && !refuseIfFrozen(item, 'place')) mutate(() => { item.image = null; });
  else if (action === 'multi-new-group') newGroupFromSelection();
  else if (action === 'multi-clear') setSet([]);
  else if (action === 'multi-delete') removeMulti();
  else if (action === 'delete') removeSelected();
  else if (action === 'reseed' && item?.fill) { if (!refuseIfFrozen(item)) mutate(() => { item.fill.seed = Math.floor(Math.random() * 1_000_000_000); }); }
  else if (action === 'center-fill' && item?.fill) { if (!refuseIfFrozen(item)) mutate(() => { const c = polygonCentroid(item.polygon); item.fill.center = [round(c.x), round(c.y)]; }); }
  else if (action === 'activate-group' && item) { state.activeGroup = item.id; renderAll(); setStatus(`Grupo activo: «${item.name}». Lo que dibujes se añadirá aquí.`, 'ok'); }
  else if (action === 'fit-group' && item) centerOnItem('group', item);
  else if (button.hasAttribute('data-req-add') && item && !refuseIfFrozen(item)) mutate(() => { item.requires = [...(item.requires ?? []), { type: 'invitation' }]; });
  else if (button.dataset.reqRemove !== undefined && item && !refuseIfFrozen(item)) mutate(() => { item.requires.splice(Number(button.dataset.reqRemove), 1); });
});
function changeRequirement(input, item) {
  if (refuseIfFrozen(item)) return;
  const index = Number(input.dataset.i);
  mutate(() => {
    const need = item.requires[index];
    if (input.dataset.req === 'type') item.requires[index] = { type: input.value };
    else if (need.type === 'escort') need.npcId = input.value.trim();
    else if (need.type === 'story_flag') need.flag = input.value.trim();
    else if (need.type === 'knows_place') need.place = input.value.trim();
    else if (need.type === 'money') need.amount = Math.round(Number(input.value));
  });
}

$('#panel').addEventListener('click', (event) => {
  const rowNode = event.target.closest('[data-select]'); const issueNode = event.target.closest('[data-issue]'); const button = event.target.closest('button');
  const action = button?.dataset.action;
  if (rowNode) {
    const [type, id] = rowNode.dataset.select.split(':'); const item = find(type, id);
    if (item && SELECTABLE.includes(type) && (event.ctrlKey || event.metaKey || event.shiftKey)) setSet(toggleItem(currentSet(), { type, id }));
    else if (item) { state.multi = []; state.selection = { type, id }; centerOnItem(type, item); renderAll(); }
  } else if (issueNode) {
    const [type, id] = issueNode.dataset.issue.split(':');
    if (COLLECTION[type] && find(type, id)) { chooseSelection(type, id); centerOnItem(type, find(type, id)); }
    else if (type === 'underlay' || type === 'map') { state.tab = 'map'; renderAll(); }
  } else if (action === 'import-legacy') importLegacy();
  else if (action === 'reset-post') mutate((map) => { delete map.style.post; });
  else if (action === 'gen-reseed') { state.gen.seed = Math.floor(Math.random() * 100000); renderPanel(); }
  else if (action === 'gen-terrain') runGenerator();
  else if (action === 'terrain-reseed') { pushHistory(); getTerrain().seed = Math.floor(Math.random() * 100000); commitTerrain({ rebuild: true }); validate(); renderAll(); }
  else if (action === 'clear-terrain') { if (confirm('¿Borrar todo el terreno pintado de este mapa?')) { pushHistory(); state.map.terrain = null; state.terrainFor = null; state.terrain = null; validate(); renderAll(); } }
  else if (action === 'add-link') {
    const id = uniqueId('conexion', takenPlaceIds());
    mutate((map) => map.links.push({ id, name: 'Nueva conexión', mode: 'road', from: map.places[0].id, to: map.places[1].id, minutes: null, cost: 0, requires: [], distanceKm: null, path: [], line: null, twoWay: true }));
    chooseSelection('link', id);
  } else if (action === 'add-line') {
    const name = prompt('Nombre de la línea (p. ej. «Línea Este»):', '')?.trim();
    if (name) { const id = newId(name); mutate((map) => map.lines.push({ id, name, mode: 'northline', color: PALETTE[map.lines.length % PALETTE.length] })); chooseSelection('line', id); }
  } else if (action === 'add-group') {
    const name = prompt('Nombre del grupo (p. ej. «Northfortress», «Casco antiguo»):', '')?.trim();
    if (name) { const id = createGroup(name, state.selection?.type === 'group' ? state.selection.id : null); chooseSelection('group', id); }
  } else if (button?.dataset.uRemove !== undefined) {
    if (confirm('¿Quitar esta imagen de calco del mapa? (el archivo de imagen se queda en assets/maps)')) mutate((map) => map.underlays.splice(Number(button.dataset.uRemove), 1));
  }
});
$('#panel').addEventListener('change', async (event) => {
  const target = event.target;
  if (target.id === 'add-underlay' && target.files[0]) {
    try { setStatus('Subiendo imagen…'); await addUnderlay(target.files[0], $('#underlay-convert').checked); setStatus('Imagen de calco añadida: guarda el mapa para conservarla.', 'dirty'); } catch (error) { setStatus(error.message, 'bad'); }
  } else if (target.dataset.post) { state.postDragging = false; afterChange(); }
  else if (target.dataset.gen) { const key = target.dataset.gen; state.gen[key] = target.type === 'checkbox' ? target.checked : target.tagName === 'SELECT' ? target.value : Number(target.value); }
  else if (target.dataset.terrain) {
    const terrain = getTerrain(); const key = target.dataset.terrain; const value = Number(target.value); pushHistory();
    const spacingMax = Math.max(30, terrain.cell * 2);
    if (key === 'seed') terrain.seed = Math.round(value) || 1;
    else if (key === 'cell' || key === 'preset') {
      if (terrain.isEmpty()) {
        const preset = TERRAIN_PRESETS[target.value];
        if (key === 'preset' && preset) { terrain.cell = preset.cell; terrain.forest = { ...preset.forest }; }
        else if (key === 'cell') { terrain.cell = Math.min(5000, Math.max(4, Math.round(value) || TERRAIN_DEFAULTS.cell)); terrain.forest.spacing = Math.max(2, Math.min(spacingMax, terrain.cell * 0.4)); }
        // el borrado de «terreno vacío» deja el terreno sin trozos; los parámetros se guardan igualmente
      }
    } else terrain.forest[key] = key === 'spacing' ? Math.min(spacingMax, Math.max(2, value || 4.5)) : Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.9));
    commitTerrain({ rebuild: true }); if (key === 'cell' || key === 'preset') fitBrush(); validate(); renderAll();
  }
  else if (target.dataset.route) { state.route[target.dataset.route] = target.value; renderPanel(); }
  else if (target.dataset.speed) {
    mutate((map) => {
      const speeds = { ...(map.travel?.speedsKmh ?? {}) }; const value = Number(target.value);
      if (target.value === '' || !(value > 0)) delete speeds[target.dataset.speed]; else speeds[target.dataset.speed] = value;
      map.travel = Object.keys(speeds).length ? { speedsKmh: speeds } : null;
    });
  }
  else if (target.dataset.m === 'name') mutate((map) => { map.name = target.value.trim(); });
  else if (target.dataset.u !== undefined) {
    const index = Number(target.dataset.u); const key = target.dataset.uf;
    mutate((map) => { map.underlays[index][key] = key === 'visible' ? target.checked : Number(target.value); });
  }
});
$('#panel').addEventListener('input', (event) => {   // los deslizadores se ven en vivo mientras se arrastran (una sola instantánea de deshacer por arrastre)
  if (event.target.dataset.gen && event.target.type === 'range') { state.gen[event.target.dataset.gen] = Number(event.target.value); event.target.previousElementSibling.textContent = event.target.value; return; }
  if (event.target.dataset.post) {
    if (!state.postDragging) { pushHistory(); state.postDragging = true; }
    state.map.style.post = { ...(state.map.style.post ?? {}), [event.target.dataset.post]: Number(event.target.value) };
    event.target.previousElementSibling.textContent = event.target.value; renderCanvas(); return;
  }
  if (event.target.dataset.uf === 'opacity') { state.map.underlays[Number(event.target.dataset.u)].opacity = Number(event.target.value); renderCanvas(); }
});

$('#options').addEventListener('change', (event) => {
  const option = event.target.dataset.opt;
  if (option === 'area-kind') state.newArea = event.target.value;
  else if (option === 'place-kind') state.newPlace.kind = event.target.value;
  else if (option === 'link-mode') state.newLink.mode = event.target.value;
  else if (option === 'link-line') { state.newLink.line = event.target.value; const line = state.map.lines.find((item) => item.id === event.target.value); if (line) { state.newLink.mode = line.mode; renderTools(); } }
  else if (option === 'decor-kind') state.newDecor.kind = event.target.value;
  else if (option === 'way-kind') { state.newWay = { kind: event.target.value, width: WAY_WIDTH[event.target.value] }; renderTools(); }
  else if (option === 'way-width') state.newWay.width = Math.max(0.5, Number(event.target.value) || WAY_WIDTH[state.newWay.kind]);
});
$('#options').addEventListener('click', (event) => { const chip = event.target.closest('[data-brush-kind]'); if (chip) { state.brush.kind = chip.dataset.brushKind; renderTools(); } });
$('#options').addEventListener('input', (event) => {
  const option = event.target.dataset.opt;
  if (option === 'brush-size') { const [rMin, rMax] = brushRange(); state.brush.radius = Math.round(rMin * (rMax / rMin) ** (Number(event.target.value) / 100)); event.target.nextElementSibling.textContent = fmtMeters(state.brush.radius); placeBrushCursor(); }
  else if (option === 'brush-rugged') state.brush.rugged = Number(event.target.value);
});
$('#options').addEventListener('change', (event) => {
  const option = event.target.dataset.opt;
  if (option === 'brush-mode') { state.brush.mode = event.target.value; renderTools(); }
  else if (option === 'brush-protect') state.brush.protectWater = event.target.checked;
});
$('#active-group').addEventListener('change', (event) => {
  if (event.target.value === '__new__') {
    const name = prompt('Nombre del nuevo grupo:', '')?.trim();
    if (name) { const id = createGroup(name); state.activeGroup = id; }
    renderAll(); return;
  }
  state.activeGroup = event.target.value || null;
});
$('#tools').addEventListener('click', (event) => { const id = event.target.dataset.tool; if (id) setTool(id); });
$('#tabs').addEventListener('click', (event) => { const id = event.target.dataset.tab; if (id) { state.tab = id; renderAll(); } });
$('#map-select').addEventListener('change', async (event) => {
  if (dirty() && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) { event.target.value = state.map?.id ?? ''; return; }
  try { await openMap(event.target.value); } catch (error) { setStatus(error.message, 'bad'); }
});
$('#new-map').onclick = () => { if (dirty() && !confirm('Hay cambios sin guardar. ¿Descartarlos?')) return; askNewMap(); };
$('#save').onclick = save; $('#undo').onclick = undo; $('#redo').onclick = redo; $('#fit').onclick = () => state.map && fitAll();
$('#fog-preview').onchange = (event) => { state.showFog = event.target.checked; renderCanvas(); };
$('#labels').onchange = (event) => { state.showLabels = event.target.checked; renderCanvas(); };
$('#grid').onchange = (event) => { state.showGrid = event.target.checked; renderCanvas(); };
$('#fill-preview').onchange = (event) => { state.showFill = event.target.checked; renderAll(); };
$('#terrain-view').onchange = (event) => { state.showTerrain = event.target.checked; renderCanvas(); };
$('#final-view').onchange = (event) => { state.final = event.target.checked; state.draft = null; state.marquee = null; state.drag = null; renderAll(); };
$('#theme').onchange = (event) => { if (state.map) mutate((map) => { map.style.theme = event.target.value; }); };

function setTool(id) {
  state.tool = id; state.stroke = null; state.marquee = null; state.draft = null; state.measure = null; state.calib = null; state.drag = null;
  renderAll();
}

window.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !typing) { event.preventDefault(); redo(); return; }
  if (typing || !state.map) return;
  if (state.final) { if (event.key === 'Escape') { state.final = false; renderAll(); } return; }
  const ctrl = event.ctrlKey || event.metaKey;
  if (ctrl && event.key.toLowerCase() === 'g') { event.preventDefault(); newGroupFromSelection(); return; }
  if (ctrl && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return; }
  if (ctrl && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(); return; }
  if (event.key === 'Escape') { if (state.marquee) { state.marquee = null; renderCanvas(); } else if (state.draft || state.measure || state.calib) { state.draft = null; state.measure = null; state.calib = null; renderAll(); } else if (state.tool !== 'select') setTool('select'); else if (state.selection || state.multi.length) setSet([]); return; }
  if (event.key === 'Enter' && state.draft) { finishDraft(); return; }
  if (event.key === 'Backspace' && state.draft) { state.draft.points.pop(); if (!state.draft.points.length) state.draft = null; renderAll(); return; }
  if ((event.key === 'Delete' || event.key === 'Backspace') && (state.selection || state.multi.length)) { removeSelected(); return; }
  if (state.tool === 'brush' && (event.key === '[' || event.key === ']')) { const [rMin, rMax] = brushRange(); state.brush.radius = Math.min(rMax, Math.max(rMin, Math.round(state.brush.radius * (event.key === ']' ? 1.2 : 1 / 1.2)))); renderTools(); renderCanvas(); return; }
  const tool = TOOLS.find(([, , key]) => key.toLowerCase() === event.key.toLowerCase());
  if (tool && !ctrl) setTool(tool[0]);
});
window.addEventListener('beforeunload', (event) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });

// Arranque: lista de mapas y, si hay uno solo o se pide con ?mapa=id, se abre.
(async () => {
  try {
    const wanted = new URLSearchParams(location.search).get('mapa');
    await refreshList(wanted);
    let last = null; try { last = localStorage.getItem('hom-map-last'); } catch { /* sin almacenamiento */ }
    const has = (id) => state.maps.some((item) => item.id === id);
    const initial = wanted ?? (has(last) ? last : has('northfortress_territory') ? 'northfortress_territory' : state.maps.length === 1 ? state.maps[0].id : '');
    if (initial) await openMap(initial);
  } catch (error) { setStatus(error.message === 'Las herramientas de desarrollo están desactivadas.' ? error.message : `No se pudo cargar: ${error.message}`, 'bad'); }
  renderAll();
})();
