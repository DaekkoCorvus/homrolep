// Editor de mapas v2 (modo desarrollo, solo PC). Lienzo infinito en METROS: se dibujan áreas (terreno y zonas urbanas con receta de relleno), caminos
// (calles, ríos, murallas…), distritos de juego, lugares y enlaces; todo se organiza en grupos que se pueden bloquear. Valida con el MISMO código que el
// servidor (src/shared) y guarda en data/canon/maps/. Los edificios y árboles no se guardan: los generará un algoritmo con semilla (paso siguiente).
// Todo el estado vive en `state.map`, con deshacer/rehacer por instantáneas.
import { MapView } from '/mapview.js';
import { normalizeMap, validateMap, emptyMap, groupChain, lockedBy, mapBounds, PLACE_KINDS, ACCESS, DISCOVERY, LINK_MODES, REQUIREMENT_TYPES } from '/shared/mapSchema.js';
import { AREA_KINDS, WAY_KINDS, FILL_PATTERNS, AREA_LABEL, WAY_LABEL, PATTERN_LABEL, AREA_COLOR, WAY_COLOR, AREA_Z, WAY_Z, WAY_WIDTH, FILL_DEFAULTS } from '/shared/mapDefaults.js';
import { generateFill, contextFor } from '/shared/mapGen.js';
import { itemsInRect, toggleItem, mergeItems, assignToGroup, removeItems } from '/shared/mapSelect.js';
import { THEMES, themeFor, POST_KEYS, POST_RANGE, POST_LABEL, POST_NEUTRAL } from '/shared/mapStyle.js';
import { renderScene, drawFill, drawTerrain, PostProcessor, copyPlain } from '/maprender.js';
import { Terrain, TERRAIN_KINDS, TERRAIN_LABEL, TERRAIN_DEFAULTS, paintStroke, floodFill, generateTerrain } from '/shared/mapTerrain.js';
import { distance, minutesFor, WALK_METERS_PER_MIN, TAXI_METERS_PER_MIN, slugify, uniqueId, districtAt, pointInPolygon, polygonCentroid, polygonArea, polylineLength, distanceToPolyline, boundsOf, mergeBounds, round, ID_PATTERN } from '/shared/geo.js';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const KIND_LABEL = { home: 'Casa', food: 'Comida', shop: 'Tienda', poi: 'Punto de interés', transport: 'Transporte', gateway: 'Puerta', other: 'Otro' };
const KIND_COLOR = { home: '#2f9e55', food: '#d98a2b', shop: '#2a7fc9', poi: '#f4f4f4', transport: '#8d54d6', gateway: '#d43d77', other: '#7d8699' };
const ACCESS_LABEL = { public: 'Público', private: 'Privado', restricted: 'Restringido' };
const DISCOVERY_LABEL = { hidden: 'Oculto', rumor: 'Rumor', known: 'Conocido' };
const REQUIREMENT_LABEL = { escort: 'Solo con guía', invitation: 'Invitación', story_flag: 'Hito de historia', knows_place: 'Conocer un lugar', money: 'Dinero' };
const LINK_LABEL = { metro: 'Metro', ferry: 'Ferry', train: 'Tren', other: 'Otro' };
const PALETTE = ['#c0392b', '#2e86c1', '#27ae60', '#d4ac0d', '#8e44ad', '#e67e22', '#16a085', '#7f8c8d'];
const COLLECTION = { place: 'places', district: 'districts', area: 'areas', way: 'ways', link: 'links', group: 'groups' };
const TAB_OF = { place: 'places', link: 'places', area: 'zones', district: 'zones', way: 'ways', group: 'groups' };
const TOOLS = [['select', 'Mover', 'V'], ['pick', 'Selección', 'S'], ['brush', 'Pincel', 'B'], ['place', 'Lugar', 'P'], ['area', 'Área', 'A'], ['way', 'Camino', 'W'], ['district', 'Distrito', 'D'], ['measure', 'Medir', 'M'], ['scale', 'Escala', 'E']];
const HINTS = {
  select: 'Clic en un lugar, camino, área o borde de distrito para seleccionarlo (Ctrl o Mayús suman o quitan). Arrastra sus vértices; arrastra el fondo para desplazar; rueda = zoom; Alt = sin imán; Supr borra.',
  brush: 'Arrastra para pintar el terreno natural (agua, tierra, bosque, montaña…). [ y ] cambian el radio; Alt borra; clic derecho o central desplaza. Los polígonos quedan para las zonas urbanas.',
  pick: 'Arrastra un rectángulo: de izquierda a derecha elige lo que queda ENTERO dentro; de derecha a izquierda, lo que toca. Clic elige uno; Ctrl o Mayús suman o quitan; Ctrl+G agrupa; Supr borra.',
  place: 'Clic para colocar un lugar (se añade al grupo activo).',
  area: 'Clic para añadir vértices (se imantan a los existentes; Alt lo desactiva). Doble clic, Intro o clic en el primero cierran; Retroceso o clic derecho quitan el último; Esc cancela.',
  way: 'Clic para añadir puntos (clic derecho quita el último); doble clic o Intro terminan. Un camino tiene prioridad sobre el relleno: al generar, parte las zonas que cruza.',
  district: 'Zona de juego (niebla, lugares del jugador). Mismos controles que «Área» (clic derecho quita el último punto).',
  measure: 'Dos clics: distancia en metros y tiempo a pie y en taxi (velocidades provisionales).',
  scale: 'Dos clics sobre una distancia conocida de una imagen de calco; escribes los metros reales y la imagen se reescala.'
};
const NICE = [1, 2, 5];

const state = {
  maps: [], context: { takenIds: new Set(), npcIds: new Set(), legacyIds: new Set(), refs: [] },
  map: null, saved: '', history: [], future: [], loadedAt: 0,
  tool: 'select', tab: 'places', selection: null, draft: null, measure: null, calib: null, mouse: null,
  issues: { errors: [], warnings: [] }, showFog: false, showLabels: true, showGrid: true, showFill: true, showTerrain: true, terrain: null, terrainFor: undefined, stroke: null, brush: { kind: 'forest', mode: 'paint', radius: 120, rugged: 0.4, protectWater: true }, gen: { seed: 1, scale: 1800, sea: 0.45, forest: 0.45, mountains: 0.35, fields: 0.25, island: 0, overwrite: false, region: 'view' }, final: false, multi: [], marquee: null, postDragging: false, drag: null, down: null,
  activeGroup: null, newArea: 'urban', newWay: { kind: 'street', width: WAY_WIDTH.street }
};
const view = new MapView($('#canvas'));
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
  for (const { result } of genCache.values()) drawFill(ctx, v, result, THEMES.default);
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
  renderScene(ctx, { k: view.k, tx: view.tx, ty: view.ty, width, height }, state.map, results, theme, { labels: state.showLabels, terrain: getTerrain() });
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
const SELECTABLE = ['place', 'area', 'way', 'district'];
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
const localIds = () => new Set(['areas', 'ways', 'districts', 'groups', 'underlays'].flatMap((key) => state.map[key].map((item) => item.id)));
const newId = (name) => uniqueId(slugify(name), localIds());

// Bloqueos: un elemento está congelado si su grupo, o alguno de sus ancestros, está bloqueado.
const frozenBy = (item) => (state.map && item ? lockedBy(state.map, item) : null);
const lockText = (group) => `Bloqueado por el grupo «${group.name || group.id}». Desbloquéalo en la pestaña Grupos para editarlo.`;
function refuseIfFrozen(item) {
  const group = frozenBy(item);
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
  return ['areas', 'ways', 'districts', 'places'].flatMap((key) => state.map[key].filter((item) => ids.has(item.group)).map((item) => ({ key, item })));
};
const pointsOf = (type, item) => (type === 'way' ? item.points : item.polygon ?? null);

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
function fitAll() { view.fitBounds(mapBounds(state.map) ?? { minX: -600, minY: -400, maxX: 600, maxY: 400 }); }

async function openMap(id) {
  if (!id) return;
  const { map, context, issues } = await api(`/api/dev/maps/${id}`);
  state.map = map; state.saved = JSON.stringify(map); resetSession();
  setContext(context); state.issues = issues;
  state.tab = 'places'; fitAll(); validate(); renderAll();
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
    <p class="me-note">El lienzo empieza vacío y es infinito. Más tarde puedes añadir imágenes de calco (opcionales) en la pestaña «Mapa».</p>
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
    state.map = emptyMap(id, name); state.saved = ''; resetSession();
    dialog.close(); state.tab = 'map'; fitAll(); validate(); renderAll(); setStatus('Mapa nuevo: aún no está guardado.', 'dirty');
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

function addPlace(wx, wy) {
  const group = groupForNew();
  const id = uniqueId(slugify('Nuevo lugar'), takenPlaceIds());
  mutate((map) => map.places.push({ id, name: 'Nuevo lugar', aliases: [], kind: 'poi', x: round(wx), y: round(wy), access: 'public', hours: null, tags: [], description: '', discovery: 'known', owner: null, footprint: null, group, requires: [] }));
  autoIds.add(id); chooseSelection('place', id, { focus: true });
}

function finishDraft() {
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
function selectAll() { setSet(SELECTABLE.flatMap((type) => state.map[COLLECTION[type]].map((item) => ({ type, id: item.id })))); }

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
    if (type === 'group') {
      // lo que había dentro pasa al grupo de arriba (o queda suelto): borrar un grupo nunca borra su contenido
      for (const key of ['areas', 'ways', 'districts', 'places', 'groups']) for (const entry of map[key]) { const field = key === 'groups' ? 'parent' : 'group'; if (entry[field] === id) entry[field] = item.parent ?? null; }
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
  const taken = type === 'place' || type === 'link' ? takenPlaceIds() : new Set(state.map[COLLECTION[type]].map((item) => item.id));
  if (taken.has(id)) { setStatus(`El id «${id}» ya está en uso.`, 'bad'); return false; }
  const refs = type === 'place' ? state.context.refs.filter((ref) => ref.placeId === oldId) : [];
  if (refs.length && !confirm(`Estos personajes usan «${oldId}»:\n- ${[...new Set(refs.map((ref) => ref.where))].join('\n- ')}\n\nTendrás que actualizar sus fichas al nuevo id. ¿Renombrar?`)) return false;
  mutate((map) => {
    find(type, oldId).id = id;
    if (type === 'place') {
      for (const link of map.links) { if (link.from === oldId) link.from = id; if (link.to === oldId) link.to = id; }
      for (const entry of [...map.places, ...map.links]) for (const need of entry.requires ?? []) if (need.type === 'knows_place' && need.place === oldId) need.place = id;
    }
    if (type === 'group') for (const key of ['areas', 'ways', 'districts', 'places', 'groups']) for (const entry of map[key]) { const field = key === 'groups' ? 'parent' : 'group'; if (entry[field] === oldId) entry[field] = id; }
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
  return best ?? [wx, wy];
}

// ¿Qué hay bajo este punto? Orden: camino (el más cercano a la línea), área (la de mayor z; a igualdad, la menor), distrito.
function pick(wx, wy, { preferDistrict = false } = {}) {
  const map = state.map; const point = { x: wx, y: wy };
  if (preferDistrict) { const district = districtAt(point, map.districts); if (district) return { type: 'district', id: district.id }; }
  let way = null; let wayDistance = Infinity;
  for (const item of map.ways) {
    const reach = Math.max(item.width / 2, 6 / view.k); const d = distanceToPolyline(point, item.points);
    if (d <= reach && (d < wayDistance || (d === wayDistance && item.z > (way?.z ?? -1)))) { way = item; wayDistance = d; }
  }
  if (way) return { type: 'way', id: way.id };
  const areas = map.areas.filter((item) => item.polygon.length >= 3 && pointInPolygon(point, item.polygon)).sort((a, b) => b.z - a.z || polygonArea(a.polygon) - polygonArea(b.polygon));
  if (areas.length) return { type: 'area', id: areas[0].id };
  const district = districtAt(point, map.districts);
  return district ? { type: 'district', id: district.id } : null;
}

function centerOnItem(type, item) {
  if (type === 'place') view.centerOn(item.x, item.y);
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

function renderCanvas() {
  if (state.final && state.map) { renderFinal(); return; }
  view.clearLayer();
  const ctx = view.beginCanvas(); const ground = view.beginGround();
  if (!state.map) return;
  if (state.showTerrain) drawTerrain(ground, { k: view.k, tx: view.tx, ty: view.ty, width: view.rect.width, height: view.rect.height }, getTerrain(), THEMES.default);
  const map = state.map; const S = (x, y) => view.toScreen(x, y);
  const svg = (name, attributes, parent) => view.svgElement(name, attributes, parent);                 // capa de fondo
  const top = (name, attributes, parent = view.top) => view.svgElement(name, attributes, parent);        // capa superior (sobre el relleno)
  const polyPoints = (points) => points.map(([x, y]) => { const p = S(x, y); return `${p.x},${p.y}`; }).join(' ');
  const { width, height } = view.rect;
  defineHatches(svg);

  if (state.showGrid) {
    const step = GRID_STEPS.find((candidate) => candidate * view.k >= 60) ?? GRID_STEPS.at(-1);
    const box = view.worldBounds;
    const grid = svg('g', { 'pointer-events': 'none' });
    for (let x = Math.floor(box.minX / step) * step; x <= box.maxX; x += step) { const p = S(x, 0); svg('line', { x1: p.x, y1: 0, x2: p.x, y2: height, stroke: x === 0 ? '#00000055' : '#00000018' }, grid); }
    for (let y = Math.floor(box.minY / step) * step; y <= box.maxY; y += step) { const p = S(0, y); svg('line', { x1: 0, y1: p.y, x2: width, y2: p.y, stroke: y === 0 ? '#00000055' : '#00000018' }, grid); }
  }

  for (const item of map.underlays) {
    if (!item.visible || !(item.metersPerPixel > 0)) continue;
    const p = S(item.x, item.y); const size = item.metersPerPixel * view.k;
    svg('image', { href: underlayUrl(item), x: p.x, y: p.y, width: item.width * size, height: item.height * size, opacity: item.opacity, preserveAspectRatio: 'none', 'pointer-events': 'none' });
  }

  for (const area of [...map.areas].sort((a, b) => a.z - b.z)) {
    if (area.polygon.length < 3) continue;
    const picked = isSelected('area', area.id);
    const points = polyPoints(area.polygon);
    svg('polygon', { points, fill: AREA_COLOR[area.kind] ?? '#ccc', stroke: picked ? '#fff' : '#00000033', 'stroke-width': picked ? 3 : 1, 'stroke-linejoin': 'round', 'pointer-events': 'none' });
    const generated = state.showFill && genCache.get(area.id)?.result; const hasGenerated = generated && (generated.buildings.length || generated.trees.length || generated.blocks.length);
    if (area.fill && area.fill.pattern !== 'none' && !hasGenerated) svg('polygon', { points, fill: `url(#hatch-${area.fill.pattern})`, 'pointer-events': 'none' });
    if (picked) top('polygon', { points, fill: 'none', stroke: '#1b2a4a', 'stroke-width': 1.2, 'stroke-dasharray': '6 4', 'pointer-events': 'none' });
    if (state.showLabels && area.name && polygonArea(area.polygon) * view.k * view.k > 4000) { const c = polygonCentroid(area.polygon); const p = S(c.x, c.y); const label = svg('text', { x: p.x, y: p.y, 'text-anchor': 'middle', class: 'me-label dark', 'font-size': 12 }); label.textContent = area.name; }
  }

  drawGenerated(ctx);
  const ways = [...map.ways].sort((a, b) => a.z - b.z).filter((way) => way.points.length >= 2);
  const lineWidth = (way) => Math.max(way.width * view.k, 1.5);
  for (const way of ways) if (isSelected('way', way.id)) top('polyline', { points: polyPoints(way.points), fill: 'none', stroke: '#fff', 'stroke-opacity': 0.8, 'stroke-width': lineWidth(way) + 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' });
  for (const way of ways) if (CASED.has(way.kind)) top('polyline', { points: polyPoints(way.points), fill: 'none', stroke: '#6f6552', 'stroke-width': lineWidth(way) + 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' });
  for (const way of ways) {
    const pts = polyPoints(way.points);
    top('polyline', { points: pts, fill: 'none', stroke: WAY_COLOR[way.kind] ?? '#fff', 'stroke-width': lineWidth(way), 'stroke-linecap': way.kind === 'wall' ? 'butt' : 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' });
    if (way.kind === 'rail') top('polyline', { points: pts, fill: 'none', stroke: '#fff', 'stroke-width': Math.max(lineWidth(way) * 0.4, 1), 'stroke-dasharray': '8 8', 'pointer-events': 'none' });
    if (way.kind === 'wall') top('polyline', { points: pts, fill: 'none', stroke: '#00000044', 'stroke-width': lineWidth(way), 'stroke-dasharray': '2 2', 'pointer-events': 'none' });
  }

  for (const district of map.districts) {
    if (district.polygon.length < 3) continue;
    const foggy = state.showFog && district.fog !== 'known';
    const picked = isSelected('district', district.id);
    top('polygon', { points: polyPoints(district.polygon), fill: foggy ? '#000' : district.color, 'fill-opacity': foggy ? (district.fog === 'hidden' ? 0.85 : 0.5) : picked ? 0.2 : 0.1, stroke: district.color, 'stroke-width': picked ? 4 : 2.5, 'stroke-dasharray': '10 5', 'stroke-linejoin': 'round', 'pointer-events': 'stroke', 'data-type': 'district', 'data-id': district.id, style: 'cursor:pointer' });
    if (state.showLabels && !foggy) { const c = polygonCentroid(district.polygon); const p = S(c.x, c.y); const label = top('text', { x: p.x, y: p.y - 14, 'text-anchor': 'middle', class: 'me-label', 'font-size': 14 }); label.textContent = district.name; }
  }
  for (const link of map.links) {
    const a = map.places.find((place) => place.id === link.from); const b = map.places.find((place) => place.id === link.to);
    if (!a || !b) continue;
    const p = S(a.x, a.y); const q = S(b.x, b.y);
    top('line', { x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: isSelected('link', link.id) ? '#fff' : '#8d54d6', 'stroke-width': 2.5, 'stroke-dasharray': '6 5', 'pointer-events': 'none' });
  }
  for (const place of map.places) {
    if (!Number.isFinite(place.x)) continue;
    const p = S(place.x, place.y); const picked = isSelected('place', place.id);
    const group = top('g', { 'data-type': 'place', 'data-id': place.id, style: 'cursor:pointer' });
    if (place.footprint?.width > 0 && place.footprint?.depth > 0) {
      const w = place.footprint.width * view.k; const d = place.footprint.depth * view.k;
      if (w > 3) top('rect', { x: p.x - w / 2, y: p.y - d / 2, width: w, height: d, fill: '#b3492c88', stroke: '#6b2a18', transform: `rotate(${place.footprint.rotation || 0} ${p.x} ${p.y})` }, group);
    }
    if (picked) top('circle', { cx: p.x, cy: p.y, r: 13, fill: 'none', stroke: '#fff', 'stroke-width': 2.5 }, group);
    if (place.discovery !== 'known') top('circle', { cx: p.x, cy: p.y, r: 11, fill: 'none', stroke: KIND_COLOR[place.kind] ?? '#fff', 'stroke-dasharray': '3 3', 'stroke-width': 2 }, group);
    top('circle', { cx: p.x, cy: p.y, r: 7, fill: KIND_COLOR[place.kind] ?? '#fff', stroke: '#000a', 'stroke-width': 2 }, group);
    if (place.access !== 'public') { const lock = top('text', { x: p.x + 9, y: p.y - 7, 'font-size': 11 }, group); lock.textContent = place.access === 'private' ? '🔒' : '⛔'; }
    if (state.showLabels || picked) { const label = top('text', { x: p.x + 11, y: p.y + 4, class: 'me-label', 'font-size': 12 }, group); label.textContent = place.name; }
  }

  const item = state.selection && ['area', 'district', 'way'].includes(state.selection.type) ? selected() : null;
  if (item && state.tool === 'select' && !frozenBy(item)) {
    const closed = state.selection.type !== 'way'; const points = pointsOf(state.selection.type, item);
    const color = state.selection.type === 'district' ? item.color : '#1b2a4a';
    points.forEach(([x, y], index) => {
      const p = S(x, y);
      const next = closed ? points[(index + 1) % points.length] : points[index + 1];
      if (next) { const m = S((x + next[0]) / 2, (y + next[1]) / 2); top('circle', { cx: m.x, cy: m.y, r: 4, fill: '#ffffff99', stroke: color, 'data-type': 'mid', 'data-index': index, style: 'cursor:copy' }); }
      top('rect', { x: p.x - 5, y: p.y - 5, width: 10, height: 10, fill: '#fff', stroke: color, 'stroke-width': 2, 'data-type': 'vertex', 'data-index': index, style: 'cursor:move' });
    });
  }

  if (state.draft) {
    const screen = state.draft.points.map(([x, y]) => S(x, y));
    const preview = state.mouse ? [...screen, S(...snap(state.mouse.wx, state.mouse.wy, { off: state.mouse.alt }))] : screen;
    const color = state.draft.kind === 'way' ? '#fff' : '#1b2a4a';
    if (preview.length) top('polyline', { points: preview.map((p) => `${p.x},${p.y}`).join(' '), fill: state.draft.kind === 'way' ? 'none' : '#ffffff44', stroke: color, 'stroke-width': state.draft.kind === 'way' ? Math.max(state.newWay.width * view.k, 2) : 2, 'stroke-opacity': state.draft.kind === 'way' ? 0.7 : 1, 'stroke-dasharray': '6 4', 'stroke-linecap': 'round', 'pointer-events': 'none' });
    screen.forEach((p, index) => top('circle', { cx: p.x, cy: p.y, r: index === 0 ? 7 : 4, fill: index === 0 ? '#fff' : '#f2d6a8', stroke: '#000', 'pointer-events': 'none' }));
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
    label.textContent = kind === 'calib' ? fmtMeters(m) : `${fmtMeters(m)} · ${minutesFor(m, WALK_METERS_PER_MIN)} min a pie · ${minutesFor(m, TAXI_METERS_PER_MIN)} min en taxi`;
  }

  placeBrushCursor();
  if (state.marquee) {
    const p = S(state.marquee.a.wx, state.marquee.a.wy); const q = S(state.marquee.b.wx, state.marquee.b.wy); const entire = state.marquee.b.wx >= state.marquee.a.wx;
    top('rect', { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y), fill: entire ? '#2e86c133' : '#3fae6a33', stroke: entire ? '#2e86c1' : '#3fae6a', 'stroke-width': 1.5, 'stroke-dasharray': entire ? null : '6 4', 'pointer-events': 'none' });
  }
  // barra de escala
  const target = 120 / view.k; const power = 10 ** Math.floor(Math.log10(target));
  const metersBar = NICE.map((n) => n * power).concat(10 * power).filter((m) => m <= target).at(-1) ?? power;
  const barY = height - 46; const barW = metersBar * view.k;
  top('line', { x1: 16, y1: barY, x2: 16 + barW, y2: barY, stroke: '#111', 'stroke-width': 3, 'pointer-events': 'none' });
  top('line', { x1: 16, y1: barY - 5, x2: 16, y2: barY + 5, stroke: '#111', 'stroke-width': 2, 'pointer-events': 'none' });
  top('line', { x1: 16 + barW, y1: barY - 5, x2: 16 + barW, y2: barY + 5, stroke: '#111', 'stroke-width': 2, 'pointer-events': 'none' });
  const barLabel = top('text', { x: 16, y: barY - 9, class: 'me-label dark', 'font-size': 12 }); barLabel.textContent = fmtMeters(metersBar);
}

// --- Paneles -----------------------------------------------------------------------------------------------------------------------------------
function renderTools() {
  $('#tools').innerHTML = TOOLS.map(([id, label, key]) => `<button type="button" data-tool="${id}" class="${state.tool === id ? 'active' : ''}" title="Atajo: ${key}">${label}</button>`).join('');
  $('#canvas').className = `me-canvas mv tool-${state.tool}${state.final ? ' final' : ''}`;
  $('#hint').textContent = state.map ? (state.final ? 'Vista final (solo lectura): desplaza y haz zoom. Desactiva «Vista final» o pulsa Esc para volver a editar.' : HINTS[state.tool]) : '';
  const options = $('#options');
  if (state.tool === 'area') options.innerHTML = `<label class="me-inline">Tipo <select data-opt="area-kind">${AREA_KINDS.map((kind) => `<option value="${kind}" ${kind === state.newArea ? 'selected' : ''}>${esc(AREA_LABEL[kind])}</option>`).join('')}</select></label>`;
  else if (state.tool === 'way') options.innerHTML = `<label class="me-inline">Tipo <select data-opt="way-kind">${WAY_KINDS.map((kind) => `<option value="${kind}" ${kind === state.newWay.kind ? 'selected' : ''}>${esc(WAY_LABEL[kind])}</option>`).join('')}</select></label>
    <label class="me-inline">Ancho (m) <input type="number" min="0.5" step="0.5" data-opt="way-width" value="${state.newWay.width}"></label>`;
  else if (state.tool === 'brush') {
    const b = state.brush; const slider = Math.round((100 * Math.log(b.radius / 8)) / Math.log(375));
    options.innerHTML = `<div class="me-chips">${[...TERRAIN_KINDS, 'none'].map((kind) => `<button type="button" class="me-chip${b.kind === kind ? ' active' : ''}" data-brush-kind="${kind}" style="--c:${kind === 'none' ? '#ffffff' : THEMES.default.areas[kind]}"><i></i>${kind === 'none' ? 'Borrar' : esc(TERRAIN_LABEL[kind])}</button>`).join('')}</div>
      <label class="me-inline">Modo <select data-opt="brush-mode">${[['paint', 'Pintar'], ['smooth', 'Suavizar'], ['fill', 'Bote']].map(([value, label]) => `<option value="${value}" ${b.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="me-inline">Radio <input type="range" min="0" max="100" data-opt="brush-size" value="${slider}"><output>${fmtMeters(b.radius)}</output></label>
      <label class="me-inline">Borde irregular <input type="range" min="0" max="1" step="0.05" data-opt="brush-rugged" value="${b.rugged}"></label>
      <label class="me-inline"><input type="checkbox" data-opt="brush-protect" ${b.protectWater ? 'checked' : ''}> No pisar el agua</label>`;
  } else options.innerHTML = '';
}

function renderTabs() {
  const count = state.issues.errors.length + state.issues.warnings.length;
  const tabs = [['places', 'Lugares'], ['zones', 'Zonas'], ['ways', 'Caminos'], ['terrain', 'Terreno'], ['groups', 'Grupos'], ['map', 'Mapa'], ['issues', `Avisos${count ? ` (${count})` : ''}`]];
  $('#tabs').innerHTML = tabs.map(([id, label]) => `<button type="button" data-tab="${id}" class="${state.tab === id ? 'active' : ''}">${label}</button>`).join('');
}

const row = (type, item, dot, extra, indent = 0) => `<div class="me-row${isSelected(type, item.id) ? ' selected' : ''}" data-select="${type}:${esc(item.id)}" style="padding-left:${0.45 + indent}rem"><span class="me-dot" style="background:${esc(dot)}"></span><span>${esc(item.name || item.id)}</span><small>${frozenBy(item) || (type === 'group' && item.locked) ? '🔒 ' : ''}${esc(extra)}</small></div>`;

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
    panel.innerHTML = `<h3>${map.places.length} lugares</h3>${map.places.map((place) => row('place', place, KIND_COLOR[place.kind], place.id)).join('') || '<p class="me-empty">Usa la herramienta «Lugar» y haz clic en el mapa.</p>'}
      <h4>Enlaces (${map.links.length})</h4><p class="me-note">Un enlace une dos lugares con un trayecto escrito a mano (p. ej. el metro de Porta Magna): duración y costo los pones tú.</p>
      ${map.links.map((link) => row('link', link, '#8d54d6', LINK_LABEL[link.mode])).join('')}<button type="button" data-action="add-link" ${map.places.length < 2 ? 'disabled' : ''}>Añadir enlace</button>
      ${legacy.length ? `<h4>Provisionales</h4><p class="me-note">Hay ${legacy.length} lugares provisionales del juego sin colocar (${esc(legacy.join(', '))}).</p><button type="button" data-action="import-legacy">Importar lugares provisionales</button>` : ''}`;
  } else if (state.tab === 'zones') {
    panel.innerHTML = `<h3>${map.areas.length} áreas</h3>${[...map.areas].sort((a, b) => b.z - a.z).map((area) => row('area', area, AREA_COLOR[area.kind], AREA_LABEL[area.kind])).join('') || '<p class="me-empty">Usa «Área» para dibujar agua, tierra, bosque o zonas urbanas.</p>'}
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
  const items = state.multi; const names = { place: 'lugares', area: 'áreas', way: 'caminos', district: 'distritos' };
  const tally = Object.keys(names).map((type) => [type, items.filter((entry) => entry.type === type).length]).filter(([, n]) => n).map(([type, n]) => `${n} ${names[type]}`).join(', ');
  const locked = items.filter((entry) => frozenBy(find(entry.type, entry.id))).length;
  const groups = state.map.groups.filter((group) => !lockedBy(state.map, { group: group.id }));
  return `<h3>${items.length} elementos seleccionados</h3><p class="me-note">${tally}${locked ? ` · ${locked} bloqueado(s): se omiten al agrupar o borrar` : ''}</p>
    <div class="me-multi"><label class="me-field"><span>Mover todos al grupo</span><select data-multi="group"><option value="__keep__">— elige —</option><option value="">— sacarlos de su grupo —</option>${groups.map((group) => `<option value="${esc(group.id)}">${esc(group.name || group.id)}</option>`).join('')}</select></label>
      <button type="button" data-action="multi-new-group">Nuevo grupo con la selección (Ctrl+G)</button>
      <button type="button" data-action="multi-clear">Deseleccionar</button>
      <button type="button" class="danger" data-action="multi-delete">Borrar la selección</button></div>
    <p class="me-note">Ctrl o Mayús + clic suman o quitan elementos. Con la herramienta «Selección» (S) arrastra un rectángulo.</p>`;
}

function renderInspector() {
  const box = $('#inspector'); const item = selected();
  if (!state.map) { box.innerHTML = ''; return; }
  if (state.multi.length > 1) { box.innerHTML = renderMultiInspector(); return; }
  if (!item) { box.innerHTML = '<p class="me-empty">Selecciona un lugar, área, camino, distrito, enlace o grupo para editarlo.</p>'; return; }
  const type = state.selection.type;
  const idField = field('Id (único en el mapa)', `<input data-f="id" value="${esc(item.id)}" maxlength="41" spellcheck="false">`);
  const nameField = field('Nombre', `<input data-f="name" value="${esc(item.name)}" maxlength="60">`);
  let body = ''; let title = ''; let locked = type === 'group' ? null : frozenBy(item);
  const remove = (label) => `<button type="button" class="danger" data-action="delete">${label}</button>`;

  if (type === 'place') {
    title = 'Lugar';
    const normalized = normalizeMap(state.map).places.find((place) => place.id === item.id);
    const district = normalized?.district ? state.map.districts.find((entry) => entry.id === normalized.district) : null;
    const owners = ['', ...[...state.context.npcIds].sort()]; const footprint = item.footprint;
    body = `${field('Id (único en todo el juego)', `<input data-f="id" value="${esc(item.id)}" maxlength="41" spellcheck="false">`)}${nameField}
      <div class="me-grid2">${field('Tipo', select('kind', PLACE_KINDS, item.kind, KIND_LABEL))}${field('Acceso', select('access', ACCESS, item.access, ACCESS_LABEL))}</div>
      <div class="me-grid2">${field('Descubrimiento inicial', select('discovery', DISCOVERY, item.discovery, DISCOVERY_LABEL))}${field('Dueño', `<select data-f="owner">${owners.map((id) => `<option value="${esc(id)}" ${id === (item.owner ?? '') ? 'selected' : ''}>${esc(id || '— ninguno —')}</option>`).join('')}</select>`)}</div>
      <div class="me-grid2">${field('x (m)', num('x', item.x))}${field('y (m)', num('y', item.y))}</div>
      <div class="me-field"><span>Distrito (se calcula solo)</span><code>${esc(district?.name ?? '— fuera de todo distrito —')}</code></div>
      ${field('Grupo', groupSelect(item))}
      <div class="me-field"><span><label class="me-inline"><input type="checkbox" data-f="hasFootprint" ${footprint ? 'checked' : ''}> Con huella de edificio</label></span>
        ${footprint ? `<div class="me-grid2">${num('footprint.width', footprint.width, 'min="1" placeholder="ancho m"')}${num('footprint.depth', footprint.depth, 'min="1" placeholder="fondo m"')}</div>${field('Rotación (°)', num('footprint.rotation', footprint.rotation ?? 0))}` : ''}</div>
      <div class="me-field"><span><label class="me-inline"><input type="checkbox" data-f="hasHours" ${item.hours ? 'checked' : ''}> Con horario</label></span>
        ${item.hours ? `<div class="me-grid2">${num('hours.open', item.hours.open, 'min="0" max="23" step="1"')}${num('hours.close', item.hours.close, 'min="1" max="24" step="1"')}</div>` : ''}</div>
      ${field('Alias (separados por comas)', `<input data-f="aliases" value="${esc((item.aliases ?? []).join(', '))}">`)}
      ${field('Etiquetas (separadas por comas)', `<input data-f="tags" value="${esc((item.tags ?? []).join(', '))}">`)}
      ${field('Descripción', `<textarea data-f="description" maxlength="600">${esc(item.description)}</textarea>`)}
      ${requirementRows(item)}${remove('Borrar lugar')}`;
  } else if (type === 'area') {
    title = 'Área';
    body = `${idField}${nameField}
      <div class="me-grid2">${field('Tipo', select('kind', AREA_KINDS, item.kind, AREA_LABEL))}${field('Orden de dibujo', num('z', item.z, 'step="1"'))}</div>
      ${field('Grupo', groupSelect(item))}${fillFields(item)}
      <p class="me-note">${item.polygon.length} vértices · ${fmtArea(polygonArea(item.polygon))}. Arrastra los cuadrados; los círculos de las aristas añaden vértices; clic derecho en un vértice lo borra. Las áreas con mayor «orden» se dibujan encima.</p>
      ${remove('Borrar área')}`;
  } else if (type === 'way') {
    title = 'Camino';
    body = `${idField}${nameField}
      <div class="me-grid2">${field('Tipo', select('kind', WAY_KINDS, item.kind, WAY_LABEL))}${field('Ancho (m)', num('width', item.width, 'min="0.5" step="0.5"'))}</div>
      <div class="me-grid2">${field('Orden de dibujo', num('z', item.z, 'step="1"'))}${field('Grupo', groupSelect(item))}</div>
      <p class="me-note">${item.points.length} puntos · ${fmtMeters(polylineLength(item.points))} · ${minutesFor(polylineLength(item.points), WALK_METERS_PER_MIN)} min a pie. Arrastra los cuadrados; los círculos añaden puntos; clic derecho borra uno.</p>
      ${remove('Borrar camino')}`;
  } else if (type === 'district') {
    title = 'Distrito';
    body = `${idField}${nameField}
      <div class="me-grid2">${field('Color', `<input data-f="color" type="color" value="${esc(item.color)}">`)}${field('Niebla inicial', select('fog', DISCOVERY, item.fog, DISCOVERY_LABEL))}</div>
      ${field('Grupo', groupSelect(item))}
      <label class="me-inline"><input type="checkbox" data-f="allowPlayerPlaces" ${item.allowPlayerPlaces ? 'checked' : ''}> El jugador puede colocar aquí su casa y marcas</label>
      <p class="me-note">${item.polygon.length} vértices · ${fmtArea(polygonArea(item.polygon))}. Arrastra los cuadrados; los círculos añaden vértices; clic derecho borra uno.</p>
      ${remove('Borrar distrito')}`;
  } else if (type === 'link') {
    title = 'Enlace';
    const places = state.map.places;
    const endpoint = (name, value) => `<select data-f="${name}">${[...places.map((place) => place.id), ...[...state.context.takenIds].filter((id) => !places.some((place) => place.id === id))].map((id) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(places.find((place) => place.id === id)?.name ?? id)}</option>`).join('')}</select>`;
    body = `${idField}${nameField}
      <div class="me-grid2">${field('Desde', endpoint('from', item.from))}${field('Hasta', endpoint('to', item.to))}</div>
      <div class="me-grid2">${field('Modo', select('mode', LINK_MODES, item.mode, LINK_LABEL))}${field('Minutos', num('minutes', item.minutes, 'min="1" step="1"'))}</div>
      ${field('Costo', num('cost', item.cost, 'min="0" step="0.5"'))}${requirementRows(item)}${remove('Borrar enlace')}`;
  } else {
    title = 'Grupo';
    const ancestors = groupChain(state.map, item.parent); const ancestorLock = ancestors.find((group) => group.locked);
    const banned = descendantIds(item.id); const count = membersOf(item.id);
    const tally = ['areas', 'ways', 'districts', 'places'].map((key) => [key, count.filter((entry) => entry.key === key).length]).filter(([, n]) => n).map(([key, n]) => `${n} ${{ areas: 'áreas', ways: 'caminos', districts: 'distritos', places: 'lugares' }[key]}`).join(', ');
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
  renderTools(); renderTabs(); renderPanel(); renderInspector(); renderActiveGroup(); renderCanvas(); renderStatus();
  $('#undo').disabled = !state.history.length; $('#redo').disabled = !state.future.length; $('#save').disabled = !state.map;
}

// --- Terreno ----------------------------------------------------------------------------------------------------------------------------------------
// El terreno vive en state.map.terrain (datos comprimidos) y, mientras se edita, en una rejilla en memoria que se vuelve a volcar al terminar cada pincelada.
// Círculo del pincel: se coloca sin repintar el mapa entero (solo sigue al ratón).
function placeBrushCursor() {
  for (const node of view.top.querySelectorAll('.brush-cursor')) node.remove();
  if (state.tool !== 'brush' || !state.mouse || state.final) return;
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
    <h4>Bosques</h4>
    <div class="me-grid2"><label class="me-field"><span>Separación de copas (m)</span><input type="number" min="2" max="30" step="0.5" data-terrain="spacing" value="${terrain.forest.spacing}"></label>
      <label class="me-field"><span>Densidad (0–1)</span><input type="number" min="0" max="1" step="0.05" data-terrain="density" value="${terrain.forest.density}"></label></div>
    <div class="me-field"><span>Semilla del terreno (bordes y árboles)</span><div class="me-grid2"><input type="number" step="1" data-terrain="seed" value="${terrain.seed}"><button type="button" data-action="terrain-reseed">🎲 Nueva</button></div></div>
    <h4>Generar terreno natural</h4>
    <p class="me-note">Rellena la zona con mar, costas, tierra, campos, bosques y montañas a partir de ruido. Se puede deshacer; la misma semilla da siempre el mismo terreno.</p>
    <div class="me-style">${slider('sea', 'Mar', 0, 1, 0.05)}${slider('forest', 'Bosques', 0, 1, 0.05)}${slider('mountains', 'Montañas', 0, 1, 0.05)}${slider('fields', 'Campos', 0, 1, 0.05)}${slider('island', 'Isla (mar en los bordes)', 0, 1, 0.05)}</div>
    <div class="me-grid2"><label class="me-field"><span>Tamaño de las formas (m)</span><input type="number" min="200" max="20000" step="100" data-gen="scale" value="${g.scale}"></label>
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
  if (state.tool === 'brush' && event.button === 0) { startStroke(wx, wy, event); return; }
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
    if ((type === 'place' || type === 'district') && additive) { setSet(toggleItem(currentSet(), { type, id })); state.down.handled = true; }
    else if (state.tool === 'select') {
      if (type === 'place') {
        state.multi = []; state.selection = { type: 'place', id }; state.tab = 'places';
        if (!frozenBy(find('place', id))) state.drag = { kind: 'place', id };
        renderAll();
      } else if (type === 'district') { state.multi = []; state.selection = { type: 'district', id }; state.tab = 'zones'; renderAll(); }
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
  const found = itemsInRect(state.map, { minX: Math.min(a.wx, b.wx), minY: Math.min(a.wy, b.wy), maxX: Math.max(a.wx, b.wx), maxY: Math.max(a.wy, b.wy) }, { mode: b.wx >= a.wx ? 'inside' : 'touch' });
  setSet(event.ctrlKey || event.metaKey || event.shiftKey ? mergeItems(currentSet(), found) : found);
  setStatus(`${found.length} elemento(s) en el rectángulo${b.wx >= a.wx ? ' (enteros)' : ' (tocados)'}.`, 'ok');
}
view.on('dblclick', () => {
  const draft = state.draft; if (!draft || state.final) return;
  if (draft.points.length > (draft.kind === 'way' ? 2 : 3)) draft.points.pop();   // el doble clic ya añadió el punto dos veces
  finishDraft();
});

function moveDragged(wx, wy, alt) {
  const drag = state.drag;
  if (drag.kind === 'place') { const place = find('place', drag.id); const [x, y] = snap(wx, wy, { off: alt }); place.x = round(x); place.y = round(y); }
  else if (drag.kind === 'vertex') { const item = selected(); const [x, y] = snap(wx, wy, { off: alt, except: state.selection }); pointsOf(state.selection.type, item)[drag.index] = [round(x), round(y)]; }
  renderCanvas(); renderInspector();
}
function insertVertex(index, wx, wy) {
  mutate(() => { pointsOf(state.selection.type, selected()).splice(index + 1, 0, [round(wx), round(wy)]); });
  state.drag = { kind: 'vertex', index: index + 1 }; if (state.down) state.down.moved = true;   // el arrastre sigue sin otra instantánea de deshacer
}
function removeVertex(index) {
  const item = selected(); if (!item || !['area', 'district', 'way'].includes(state.selection.type) || frozenBy(item)) return;
  const points = pointsOf(state.selection.type, item);
  if (points.length <= (state.selection.type === 'way' ? 2 : 3)) return;
  mutate(() => { points.splice(index, 1); });
}

function click(wx, wy, target, event, down = {}) {
  const tool = state.tool;
  if (tool === 'select' || tool === 'pick') {
    if (down.handled) return;
    let hit = null;
    if (target) {   // los asas de vértice son de la herramienta Mover; un lugar o el borde de un distrito se eligen con Selección
      if (tool === 'select' || !['place', 'district'].includes(target.dataset.type)) return;
      hit = { type: target.dataset.type, id: target.dataset.id };
    }
    hit ??= pick(wx, wy, { preferDistrict: event.altKey });
    if (event.ctrlKey || event.metaKey || event.shiftKey) { if (hit) setSet(toggleItem(currentSet(), hit)); return; }
    if (hit) chooseSelection(hit.type, hit.id); else setSet([]);
  } else if (tool === 'place') addPlace(...snap(wx, wy, { off: event.altKey }));
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
function applyField(item, name, value, input) {
  const type = state.selection.type;
  if (name === 'aliases' || name === 'tags') item[name] = String(value).split(',').map((part) => part.trim()).filter(Boolean);
  else if (name === 'hasHours') item.hours = value ? { open: 8, close: 20 } : null;
  else if (name === 'hasFootprint') item.footprint = value ? { width: 12, depth: 16, rotation: 0 } : null;
  else if (name === 'owner') item.owner = value || null;
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
  if (action === 'multi-new-group') newGroupFromSelection();
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
    const id = uniqueId('enlace', takenPlaceIds());
    mutate((map) => map.links.push({ id, name: 'Nuevo enlace', mode: 'metro', from: map.places[0].id, to: map.places[1].id, minutes: 20, cost: 0, requires: [] }));
    autoIds.add(id); chooseSelection('link', id);
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
    if (key === 'seed') terrain.seed = Math.round(value) || 1; else terrain.forest[key] = key === 'spacing' ? Math.min(30, Math.max(2, value || 4.5)) : Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.9));
    commitTerrain({ rebuild: true }); validate(); renderAll();
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
  else if (option === 'way-kind') { state.newWay = { kind: event.target.value, width: WAY_WIDTH[event.target.value] }; renderTools(); }
  else if (option === 'way-width') state.newWay.width = Math.max(0.5, Number(event.target.value) || WAY_WIDTH[state.newWay.kind]);
});
$('#options').addEventListener('click', (event) => { const chip = event.target.closest('[data-brush-kind]'); if (chip) { state.brush.kind = chip.dataset.brushKind; renderTools(); } });
$('#options').addEventListener('input', (event) => {
  const option = event.target.dataset.opt;
  if (option === 'brush-size') { state.brush.radius = Math.round(8 * 375 ** (Number(event.target.value) / 100)); event.target.nextElementSibling.textContent = fmtMeters(state.brush.radius); placeBrushCursor(); }
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
  if (ctrl && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAll(); return; }
  if (event.key === 'Escape') { if (state.marquee) { state.marquee = null; renderCanvas(); } else if (state.draft || state.measure || state.calib) { state.draft = null; state.measure = null; state.calib = null; renderAll(); } else if (state.tool !== 'select') setTool('select'); else if (state.selection || state.multi.length) setSet([]); return; }
  if (event.key === 'Enter' && state.draft) { finishDraft(); return; }
  if (event.key === 'Backspace' && state.draft) { state.draft.points.pop(); if (!state.draft.points.length) state.draft = null; renderAll(); return; }
  if ((event.key === 'Delete' || event.key === 'Backspace') && (state.selection || state.multi.length)) { removeSelected(); return; }
  if (state.tool === 'brush' && (event.key === '[' || event.key === ']')) { state.brush.radius = Math.min(3000, Math.max(8, Math.round(state.brush.radius * (event.key === ']' ? 1.2 : 1 / 1.2)))); renderTools(); renderCanvas(); return; }
  const tool = TOOLS.find(([, , key]) => key.toLowerCase() === event.key.toLowerCase());
  if (tool && !ctrl) setTool(tool[0]);
});
window.addEventListener('beforeunload', (event) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });

// Arranque: lista de mapas y, si hay uno solo o se pide con ?mapa=id, se abre.
(async () => {
  try {
    const wanted = new URLSearchParams(location.search).get('mapa');
    await refreshList(wanted);
    const initial = wanted ?? (state.maps.length === 1 ? state.maps[0].id : '');
    if (initial) await openMap(initial);
  } catch (error) { setStatus(error.message === 'Las herramientas de desarrollo están desactivadas.' ? error.message : `No se pudo cargar: ${error.message}`, 'bad'); }
  renderAll();
})();
