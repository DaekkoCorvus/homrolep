// Vista de encuadre (modo desarrollo): ajusta tamaño y posición de cada imagen de un personaje viéndola como en el juego.
// El escenario usa la clase .pf-stage y la misma regla CSS que la escena real (mundo.css), así que lo que se ve aquí es lo que se ve en la partida.
// Gestos con pointer events (arrastrar, pellizcar, rueda), controles numéricos y teclado como alternativa, regla en cm, fantasma de comparación y calibración por dos toques.
import { state, notify, escapeHtml, layer, place } from './core.js';
import { askConfirm, askText } from './dialogs.js';
import { sceneMarkup, sceneFor, applySky } from './scenes.js';
import { applyFrame } from './game.js';
import { STAGE_CM, FRAME_LIMITS, HEIGHT_CM_LIMITS, IDLE_DEFAULT, normalizeFrame, normalizeStage, frameFor, calibrate, dragFrame, pinchFrame } from '/shared/stage.js';

// Proporciones del escenario real: la capa del retrato (pantalla menos el dock) en un teléfono de 390×844 y en una pantalla ancha de 1280×800.
const VIEWS = { phone: { w: 390, h: 713, label: 'Teléfono' }, wide: { w: 1280, h: 669, label: 'Ancho' } };
// Aproximación del render clásico (sin encuadre) en alturas de escenario: 78 % del alto de pantalla sobre una capa algo más baja.
const CLASSIC = { h: 0.92, x: 0, y: 0 };
const RULER_LABELS = [100, 150, 160, 170, 180, 200];
const AXES = [['h', 'Tamaño'], ['x', 'Horizontal'], ['y', 'Vertical']];
const TAP_MAX_PX = 8; const TAP_MAX_MS = 700;
const pct = (value) => Math.round(value * 1000) / 10;
const byName = (a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b));

function guidesMarkup() {
  const ticks = [];
  for (let cm = 10; cm <= STAGE_CM; cm += 10) {
    const major = RULER_LABELS.includes(cm);
    ticks.push(`<i class="${major ? 'major' : ''}" style="bottom:${((cm / STAGE_CM) * 100).toFixed(3)}%">${major ? `<b>${cm}</b>` : ''}</i>`);
  }
  return `<div class="fr-ruler">${ticks.join('')}</div><div class="fr-floor"><span>Suelo</span></div><div class="fr-hline" data-hline hidden><span></span></div>
    <div class="fr-textband"><span>Cuadro de texto</span></div><div class="fr-marks" data-marks></div>`;
}

// `model`: la ficha en edición (con `portraits`). `others`: el resto de fichas, para el fantasma de comparación.
// `onSave(stage)`: guarda la ficha con el nuevo bloque `stage` (o null si ya no hay encuadre); si lanza, el error se muestra aquí y la vista sigue abierta.
export function openFraming({ model, emotion = 'default', others = [], onSave }) {
  const portraits = model.portraits ?? {};
  const names = Object.keys(portraits).sort(byName);
  if (!names.length) { notify('Sube primero una imagen para poder encuadrarla.'); return null; }
  const work = normalizeStage(model.stage) ?? { heightCm: null, frames: {}, idle: { ...IDLE_DEFAULT } };
  const ghosts = others.filter((item) => item.portraits?.default);
  const loc = state.run?.world ? place(state.run.player.locationId) : null;
  let cur = names.includes(emotion) ? emotion : names[0];
  let mode = 'phone'; let bgMode = loc ? 'scene' : 'neutral'; let ghostId = ''; let dirty = false; let calib = null;

  const node = layer('fr-layer', `<div class="fr-sheet" role="dialog" aria-modal="true" aria-label="Encuadre del personaje">
    <header class="fr-head">
      <button type="button" class="fr-x" data-cancel aria-label="Cerrar">×</button>
      <div class="fr-title"><strong>${escapeHtml(model.name || model.id)}</strong><small data-status></small></div>
      <div class="fr-seg" role="group" aria-label="Proporción de la vista">${Object.entries(VIEWS).map(([id, view]) => `<button type="button" data-mode="${id}" aria-pressed="${id === mode}">${view.label}</button>`).join('')}</div>
      <button type="button" class="fr-fold" data-fold aria-expanded="true">Controles</button>
    </header>
    <div class="fr-body">
      <div class="fr-view" data-view>
        <div class="pf-stage fr-stage" data-stage tabindex="0" role="application" aria-label="Escenario de vista previa. Arrastra para mover, pellizca o usa la rueda para escalar; con teclado, flechas para mover y más o menos para escalar.">
          <div class="fr-bg"></div><img class="fr-ghost" alt="" hidden><img class="fr-main" alt="">${guidesMarkup()}
        </div>
        <div class="fr-banner" data-banner hidden><span></span><button type="button" data-calib-cancel>Cancelar</button></div>
      </div>
      <div class="fr-panel" data-panel>
        <section class="fr-sec"><h3>Imagen</h3><div class="fr-chips" role="group" aria-label="Emoción a encuadrar" data-chips></div><p class="fr-note" data-note></p></section>
        <section class="fr-sec"><h3>Tamaño y posición</h3>
          ${AXES.map(([key, label]) => `<div class="fr-row"><label for="fr-${key}">${label}</label><div class="fr-step"><button type="button" data-step="${key}" data-dir="-1" aria-label="${label}: menos">−</button><input id="fr-${key}" data-axis="${key}" type="number" inputmode="decimal" step="any" min="${pct(FRAME_LIMITS[key][0])}" max="${pct(FRAME_LIMITS[key][1])}"><button type="button" data-step="${key}" data-dir="1" aria-label="${label}: más">+</button></div><span class="fr-unit">%</span></div>`).join('')}
          <div class="fr-row"><label for="fr-cm">Estatura</label><div class="fr-step one"><input id="fr-cm" data-cm type="number" inputmode="numeric" step="1" min="${HEIGHT_CM_LIMITS[0]}" max="${HEIGHT_CM_LIMITS[1]}" placeholder="155"></div><span class="fr-unit">cm</span></div>
          <p class="fr-hint">Las medidas son un porcentaje del alto del escenario. La regla de la izquierda marca centímetros reales (1 escenario = ${STAGE_CM} cm).</p></section>
        <section class="fr-sec"><h3>Ayudas</h3>
          <div class="fr-actions"><button type="button" data-calib>Calibrar con la estatura</button></div>
          <label class="fr-field"><span>Comparar con…</span><select data-ghost><option value="">Nadie</option>${ghosts.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.stage?.heightCm ? ` · ${item.stage.heightCm} cm` : ''}</option>`).join('')}</select></label>
          ${loc ? '<label class="fr-field"><span>Fondo</span><select data-bg><option value="scene">Escena del lugar actual</option><option value="neutral">Neutro</option></select></label>' : ''}</section>
        <section class="fr-sec"><h3>Acciones</h3><div class="fr-actions">
          <button type="button" data-inherit>Usar el encuadre de «default»</button><button type="button" data-all>Aplicar a todas las emociones</button><button type="button" class="danger" data-clear>Quitar encuadre</button></div></section>
        <p class="error" data-error role="alert"></p>
      </div>
    </div>
    <footer class="fr-foot"><button type="button" data-cancel>Cancelar</button><button type="button" class="primary-dev" data-save>Guardar encuadre</button></footer></div>`);

  const $ = (selector) => node.querySelector(selector);
  const sheet = $('.fr-sheet'); const stage = $('[data-stage]'); const main = $('.fr-main'); const ghost = $('.fr-ghost'); const view = $('[data-view]');
  const current = () => frameFor(work, cur) ?? CLASSIC;
  const own = () => Object.hasOwn(work.frames, cur);
  const hasDefault = () => Object.hasOwn(work.frames, 'default');

  function setFrame(frame) { work.frames[cur] = normalizeFrame(frame); dirty = true; refresh(); }

  function drawMarks() {
    const holder = $('[data-marks]'); holder.replaceChildren();
    if (!calib) return;
    const s = stage.getBoundingClientRect(); const i = main.getBoundingClientRect();
    for (const [label, fraction] of [['Coronilla', calib.head], ['Pies', calib.feet]]) {
      if (fraction != null) holder.insertAdjacentHTML('beforeend', `<div class="fr-mark" style="top:${(i.top - s.top + fraction * i.height).toFixed(1)}px"><span>${label}</span></div>`);
    }
  }

  function refresh() {
    const frame = current();
    applyFrame(main, frame);
    for (const [key] of AXES) { const input = $(`[data-axis=${key}]`); if (document.activeElement !== input) input.value = pct(frame[key]); }
    const cm = $('[data-cm]'); if (document.activeElement !== cm) cm.value = work.heightCm ?? '';
    const status = own() ? 'Encuadre propio' : hasDefault() ? 'Hereda el de «default»' : 'Sin encuadre (se ve como antes)';
    $('[data-status]').textContent = `Encuadre · ${cur} · ${status}${dirty ? ' · sin guardar' : ''}`;
    $('[data-note]').textContent = own() ? `«${cur}» tiene su propio encuadre.` : hasDefault() ? `«${cur}» usa el encuadre de «default» hasta que lo muevas.` : 'Aún no hay encuadre: mientras no muevas nada, el juego usa el tamaño de siempre.';
    $('[data-inherit]').disabled = !own() || cur === 'default';
    const line = $('[data-hline]');
    line.hidden = !work.heightCm;
    if (work.heightCm) { line.style.bottom = `${(work.heightCm / STAGE_CM) * 100}%`; line.firstElementChild.textContent = `${work.heightCm} cm`; }
    $('[data-chips]').querySelectorAll('button').forEach((button) => { button.classList.toggle('active', button.dataset.emotion === cur); button.classList.toggle('own', Object.hasOwn(work.frames, button.dataset.emotion)); button.setAttribute('aria-pressed', button.dataset.emotion === cur); });
    drawMarks();
  }

  function renderChips() {
    $('[data-chips]').innerHTML = names.map((name) => `<button type="button" data-emotion="${escapeHtml(name)}" aria-pressed="false">${escapeHtml(name)}</button>`).join('');
    $('[data-chips]').querySelectorAll('button').forEach((button) => button.onclick = () => { cur = button.dataset.emotion; stopCalibrating(); main.src = portraits[cur]; refresh(); });
  }

  function updateGhost() {
    const other = ghosts.find((item) => item.id === ghostId);
    if (!other) { ghost.hidden = true; return; }
    ghost.src = other.portraits.default;
    applyFrame(ghost, frameFor(normalizeStage(other.stage), 'default') ?? CLASSIC);
    ghost.hidden = false;
  }

  function applyBackground() {
    const bg = $('.fr-bg');
    if (bgMode === 'scene' && loc) {
      bg.className = 'fr-bg scene';
      bg.innerHTML = `<div class="scene-art">${sceneMarkup(sceneFor(loc), state.run.world)}</div>`;
      applySky(bg, state.run.world);
    } else { bg.className = 'fr-bg neutral'; bg.replaceChildren(); }
  }

  // El escenario conserva la proporción de la vista elegida y se ajusta al hueco disponible.
  function fit() {
    const box = view.getBoundingClientRect(); const { w, h } = VIEWS[mode];
    const room = { w: box.width - 16, h: box.height - 16 };
    if (room.w <= 0 || room.h <= 0) return;
    const width = Math.min(room.w, (room.h * w) / h);
    stage.style.width = `${Math.floor(width)}px`; stage.style.height = `${Math.floor((width * h) / w)}px`;
    refresh();
  }

  // --- Gestos ---------------------------------------------------------------------------------------------------------------------------
  const pointers = new Map();
  let tap = null;
  const anchorAt = (clientX, clientY) => {
    const rect = stage.getBoundingClientRect();
    return { x: (clientX - rect.left - rect.width / 2) / rect.height, y: (rect.bottom - clientY) / rect.height };
  };
  stage.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    tap = pointers.size === 1 ? { x: event.clientX, y: event.clientY, at: performance.now(), moved: 0 } : null;
  });
  stage.addEventListener('pointermove', (event) => {
    const before = pointers.get(event.pointerId);
    if (!before) return;
    const rect = stage.getBoundingClientRect();
    const after = { x: event.clientX, y: event.clientY };
    if (pointers.size === 1) {
      if (tap) tap.moved += Math.hypot(after.x - before.x, after.y - before.y);
      pointers.set(event.pointerId, after);
      // Al calibrar, un toque tembloroso no debe mover la imagen: el arrastre empieza pasado el margen de toque.
      if (!tap || tap.moved > (calib ? TAP_MAX_PX : 2)) setFrame(dragFrame(current(), after.x - before.x, after.y - before.y, rect.height));
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const oldMid = mid(before, other); const newMid = mid(after, other);
      const oldDistance = Math.hypot(before.x - other.x, before.y - other.y); const newDistance = Math.hypot(after.x - other.x, after.y - other.y);
      pointers.set(event.pointerId, after);
      let frame = current();
      if (oldDistance > 8 && newDistance > 8) frame = pinchFrame(frame, newDistance / oldDistance, anchorAt(newMid.x, newMid.y));
      setFrame(dragFrame(frame, newMid.x - oldMid.x, newMid.y - oldMid.y, rect.height));
    }
  });
  const release = (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (event.type === 'pointerup' && tap && !pointers.size && calib && tap.moved < TAP_MAX_PX && performance.now() - tap.at < TAP_MAX_MS) calibrationTap(event.clientY);
    if (!pointers.size) tap = null;
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('lostpointercapture', release);
  stage.addEventListener('wheel', (event) => {
    event.preventDefault();
    setFrame(pinchFrame(current(), Math.exp(-event.deltaY * 0.0015), anchorAt(event.clientX, event.clientY)));
  }, { passive: false });
  stage.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.02 : 0.005; const frame = current();
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) { event.preventDefault(); setFrame({ ...frame, x: frame.x + moves[event.key][0], y: frame.y + moves[event.key][1] }); }
    else if (['+', '=', '-', '_'].includes(event.key)) { event.preventDefault(); setFrame(pinchFrame(frame, (event.key === '+' || event.key === '=' ? 1 : -1) * (event.shiftKey ? 0.08 : 0.02) + 1, { x: frame.x, y: frame.y })); }
  });

  // --- Calibración: coronilla y pies sobre la propia imagen --------------------------------------------------------------------------------
  const banner = (text) => { const element = $('[data-banner]'); element.hidden = !text; element.firstElementChild.textContent = text ?? ''; };
  function stopCalibrating() { calib = null; banner(null); drawMarks(); }
  async function startCalibrating() {
    if (!work.heightCm) {
      const answer = await askText({ title: 'Estatura del personaje', text: `En centímetros (${HEIGHT_CM_LIMITS[0]} a ${HEIGHT_CM_LIMITS[1]}). Hace falta para calibrar y dibuja la regla.`, placeholder: '155', confirmLabel: 'Usar', maxLength: 3 });
      if (answer === null) return;
      const cm = Math.round(Number(String(answer).replace(',', '.')));
      if (!Number.isFinite(cm) || cm < HEIGHT_CM_LIMITS[0] || cm > HEIGHT_CM_LIMITS[1]) { notify(`Escribe una estatura entre ${HEIGHT_CM_LIMITS[0]} y ${HEIGHT_CM_LIMITS[1]} cm.`); return; }
      work.heightCm = cm; dirty = true;
    }
    calib = { head: null, feet: null };
    banner('Toca la coronilla del personaje'); refresh();
  }
  function calibrationTap(clientY) {
    const rect = main.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    if (calib.head === null) { calib.head = fraction; banner('Ahora toca la planta de los pies'); drawMarks(); return; }
    calib.feet = fraction; drawMarks();
    try {
      setFrame(calibrate({ headY: calib.head, feetY: calib.feet, heightCm: work.heightCm, x: current().x }));
      stopCalibrating(); notify(`Calibrado a ${work.heightCm} cm: los pies quedan en el suelo.`);
    } catch (error) { notify(error.message); calib = { head: null, feet: null }; banner('Toca la coronilla del personaje'); drawMarks(); }
  }

  // --- Controles y acciones --------------------------------------------------------------------------------------------------------------
  node.querySelectorAll('[data-axis]').forEach((input) => {
    input.addEventListener('input', () => { const value = Number(input.value); if (input.value !== '' && Number.isFinite(value)) setFrame({ ...current(), [input.dataset.axis]: value / 100 }); });
    input.addEventListener('change', refresh);
  });
  node.querySelectorAll('[data-step]').forEach((button) => {
    const step = (big) => { const key = button.dataset.step; setFrame({ ...current(), [key]: current()[key] + Number(button.dataset.dir) * (big ? 0.05 : 0.01) }); };
    let hold = null;
    const stop = () => { clearTimeout(hold?.start); clearInterval(hold?.repeat); hold = null; };
    button.addEventListener('pointerdown', (event) => { event.preventDefault(); stop(); step(event.shiftKey); hold = { start: setTimeout(() => { hold.repeat = setInterval(() => step(false), 70); }, 380) }; });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((name) => button.addEventListener(name, stop));
    button.addEventListener('click', (event) => { if (event.detail === 0) step(event.shiftKey); });   // teclado: Enter o espacio
  });
  $('[data-cm]').addEventListener('input', (event) => {
    const value = Math.round(Number(event.target.value));
    work.heightCm = event.target.value === '' || !Number.isFinite(value) ? null : Math.min(HEIGHT_CM_LIMITS[1], Math.max(HEIGHT_CM_LIMITS[0], value));
    dirty = true; refresh();
  });
  $('[data-cm]').addEventListener('change', refresh);
  node.querySelectorAll('[data-mode]').forEach((button) => button.onclick = () => {
    mode = button.dataset.mode; stage.classList.toggle('wide', mode === 'wide');
    node.querySelectorAll('[data-mode]').forEach((item) => item.setAttribute('aria-pressed', item === button)); fit();
  });
  $('[data-fold]').onclick = (event) => { const folded = sheet.classList.toggle('folded'); event.currentTarget.setAttribute('aria-expanded', !folded); };
  $('[data-calib]').onclick = startCalibrating;
  $('[data-calib-cancel]').onclick = stopCalibrating;
  $('[data-ghost]').onchange = (event) => { ghostId = event.target.value; updateGhost(); };
  const bgSelect = $('[data-bg]');
  if (bgSelect) bgSelect.onchange = () => { bgMode = bgSelect.value; applyBackground(); };
  $('[data-inherit]').onclick = () => { delete work.frames[cur]; dirty = true; refresh(); };
  $('[data-all]').onclick = async () => {
    if (!await askConfirm({ title: '¿Aplicar este encuadre a todas las emociones?', text: `Se copiará a ${names.length} imágenes y sustituirá los encuadres que ya tengan.`, confirmLabel: 'Aplicar a todas' })) return;
    for (const name of names) work.frames[name] = { ...current() };
    dirty = true; refresh(); notify('Encuadre copiado a todas las emociones.');
  };
  $('[data-clear]').onclick = async () => {
    if (!await askConfirm({ title: '¿Quitar el encuadre?', text: 'Todas las emociones vuelven al tamaño y la posición de siempre. La estatura se conserva.', confirmLabel: 'Quitar', danger: true })) return;
    work.frames = {}; dirty = true; stopCalibrating(); refresh();
  };

  async function close(force = false) {
    if (!force && dirty && !await askConfirm({ title: '¿Descartar los cambios de encuadre?', text: 'Todavía no los has guardado.', confirmLabel: 'Descartar', danger: true })) return;
    resizer.disconnect(); node.remove();
  }
  node.querySelectorAll('[data-cancel]').forEach((button) => button.onclick = () => close());
  node.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); close(); } });
  $('[data-save]').onclick = async (event) => {
    const button = event.currentTarget; const error = $('[data-error]');
    error.textContent = ''; button.disabled = true;
    try {
      // Solo se guardan frames de imágenes que existen; si no queda nada que guardar, la ficha pierde el bloque `stage`.
      const frames = Object.fromEntries(Object.entries(work.frames).filter(([name]) => names.includes(name)));
      await onSave(!Object.keys(frames).length && work.heightCm == null ? null : { ...work, frames });
      dirty = false; close(true);
    } catch (failure) { error.textContent = failure.message; button.disabled = false; error.scrollIntoView({ block: 'nearest' }); }
  };

  const resizer = new ResizeObserver(fit);
  renderChips(); applyBackground(); main.src = portraits[cur];
  const bgOption = $('[data-bg]'); if (bgOption) bgOption.value = bgMode;
  resizer.observe(view);
  requestAnimationFrame(() => { fit(); stage.focus({ preventScroll: true }); });
  return { close };
}
