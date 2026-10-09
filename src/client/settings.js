// Ajustes (etapa 6), separados en tres: Juego (velocidad del texto y efectos), Narrador (la IA) y Desarrollo (solo en modo desarrollador).
// Es un componente: `mountSettings(host, opts)` lo pinta en la página del Umbral (fuera de la partida) o en la pausa (dentro del juego).
import { request, notify, escapeHtml, isDev, setDev } from './core.js';
import { askConfirm } from './dialogs.js';

export const GM_PROFILES = [
  { id: 'meta/muse-spark-1.3-contributor', name: 'Spark 1.3', tagline: 'Inteligente e interpretativo', description: 'Mantiene la identidad de los personajes sin sesgo positivo. Es más estricto y ofrece una experiencia completa.' },
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek', tagline: 'Creativo y con chispa', description: 'Más piadoso contigo y con menos restricciones. Una experiencia suave.' }
];
const CUSTOM_MODEL = '__custom__';
const SPEEDS = [['lento', 'Lenta'], ['normal', 'Normal'], ['rapido', 'Rápida']];
const EFFECTS = [['auto', 'Automáticos'], ['full', 'Completos'], ['lite', 'Ligeros']];
const INTROS = [['full', 'Completa'], ['fast', 'Rápida']];
const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
// Las preferencias del juego se guardan en el dispositivo; el juego las vuelve a aplicar al oír este evento.
const savePreference = (key, value, fallback) => {
  try { value === fallback && key === 'hom:fx' ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new CustomEvent('hom:prefs'));
};

// host: contenedor · opts: { tab?, message?, devActions?: { openPanel?, importCard? }, onConfigured?(configured) }
// Devuelve { configured() } (¿hay conexión con la IA lista?) o null si no se pudo cargar.
export async function mountSettings(host, { tab, message = '', devActions = {}, onConfigured = () => {} } = {}) {
  let settings;
  try { settings = await request('/api/ai/settings'); } catch (error) { notify(error.message); return null; }
  const preset = (id) => GM_PROFILES.find((profile) => profile.id === id);
  const modelName = (id) => preset(id)?.name || id || 'GM';
  const tabs = [['game', 'Juego'], ['narrator', 'Narrador'], ...(isDev() ? [['dev', 'Desarrollo']] : [])];
  let current = tab && tabs.some(([id]) => id === tab) ? tab : (settings.configured ? 'game' : 'narrator');
  host.innerHTML = `<div class="set">${message ? `<p class="set-note" role="status">${escapeHtml(message)}</p>` : ''}<div class="set-tabs" role="tablist" aria-label="Ajustes">${tabs.map(([id, label]) => `<button type="button" role="tab" id="set-tab-${id}" data-tab="${id}" aria-controls="set-body">${label}</button>`).join('')}</div><div class="set-body" id="set-body" role="tabpanel"></div></div>`;
  const body = host.querySelector('.set-body');
  const paintTabs = () => host.querySelectorAll('[data-tab]').forEach((button) => { const on = button.dataset.tab === current; button.setAttribute('aria-selected', String(on)); button.tabIndex = on ? 0 : -1; });
  const show = (id) => { current = id; paintTabs(); body.setAttribute('aria-labelledby', `set-tab-${id}`); ({ game: paintGame, narrator: paintNarrator, dev: paintDev })[id](); };
  host.querySelectorAll('[data-tab]').forEach((button) => { button.onclick = () => show(button.dataset.tab); });
  host.querySelector('.set-tabs').onkeydown = (event) => {   // flechas entre pestañas
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const at = tabs.findIndex(([id]) => id === current); const next = tabs[(at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length][0];
    show(next); host.querySelector(`[data-tab="${next}"]`).focus(); event.preventDefault();
  };

  // --- Juego ---
  function paintGame() {
    const speed = read('hom:text', 'normal'); const effects = read('hom:fx', 'auto'); const intro = read('hom:intro', 'full');
    const group = (name, legend, hint, options, value) => `<fieldset class="set-seg"><legend>${legend}</legend><div class="set-seg-row">${options.map(([id, label]) => `<label><input type="radio" name="${name}" value="${id}" ${id === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div><p class="set-hint">${hint}</p></fieldset>`;
    body.innerHTML = `<form class="set-form" onsubmit="return false">${group('speed', 'Velocidad del texto', 'Cómo se escribe lo que dicen los personajes. Un toque en la línea la completa.', SPEEDS, speed)}${group('effects', 'Efectos de la escena', 'Con «Ligeros» la escena deja de animarse: útil en equipos lentos o para gastar menos batería. «Automáticos» lo decide el juego.', EFFECTS, effects)}${group('intro', 'Intro del personaje', 'Cómo se cuenta la creación de tu personaje. «Rápida» acorta las pausas y muestra el texto de golpe; también puedes saltarla al momento con «Saltar intro».', INTROS, intro)}<p class="set-sample" aria-hidden="true">Las luces de la ciudad se encienden una a una.</p></form>`;
    body.querySelectorAll('[name="speed"]').forEach((input) => { input.onchange = () => savePreference('hom:text', input.value, 'normal'); });
    body.querySelectorAll('[name="intro"]').forEach((input) => { input.onchange = () => savePreference('hom:intro', input.value, 'full'); });
    body.querySelectorAll('[name="effects"]').forEach((input) => { input.onchange = () => savePreference('hom:fx', input.value, 'auto'); });
  }

  // --- Narrador (la IA) ---
  function paintNarrator() {
    const hasKey = settings.hasKey ?? settings.configured;
    const isCustom = Boolean(settings.model) && !preset(settings.model);
    const selected = isCustom ? CUSTOM_MODEL : preset(settings.model) ? settings.model : GM_PROFILES[0].id;
    const connectionText = (now) => now.configured
      ? `Modelo guardado · ${modelName(now.model)} · ${now.verifiedAt ? 'conexión comprobada' : 'sin comprobar (se prueba al jugar)'}`
      : hasKey ? 'API key guardada · Elige un modelo' : 'Aún no hay una conexión configurada.';
    body.innerHTML = `<p class="set-lead">Conecta tu cuenta de <a href="https://nano-gpt.com" target="_blank" rel="noopener noreferrer">NanoGPT</a> y elige quién narrará tu partida.</p><p class="set-status" id="connection-status">${escapeHtml(connectionText(settings))}</p>
      <form class="set-form" id="ai-settings"><label class="set-field"><span>API key de NanoGPT</span><input name="apiKey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="text" maxlength="4096" placeholder="${hasKey ? 'Guardada · deja vacío para conservarla' : 'Pega aquí tu API key'}" ${hasKey ? '' : 'required'}></label>
      <fieldset class="gm-options"><legend>Elige tu GM</legend>${GM_PROFILES.map((profile) => `<label class="gm-option"><input type="radio" name="model" value="${profile.id}" ${selected === profile.id ? 'checked' : ''} required><span class="gm-copy"><strong>${profile.name}</strong><small class="gm-tagline">${profile.tagline}</small><small>${profile.description}</small></span><span class="gm-check" aria-hidden="true">✧</span></label>`).join('')}
        <label class="gm-option"><input type="radio" name="model" value="${CUSTOM_MODEL}" ${selected === CUSTOM_MODEL ? 'checked' : ''} required><span class="gm-copy"><strong>Otro modelo</strong><small class="gm-tagline">Para probar y comparar</small><small>Escribe el identificador de cualquier modelo de NanoGPT, por ejemplo <code>deepseek/deepseek-v4.1-flash</code>.</small></span><span class="gm-check" aria-hidden="true">✧</span></label>
        <div class="custom-model" ${selected === CUSTOM_MODEL ? '' : 'hidden'}><input name="customModel" list="nano-models" value="${isCustom ? escapeHtml(settings.model) : ''}" maxlength="200" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="proveedor/modelo" aria-label="Identificador del modelo"><datalist id="nano-models"></datalist><button type="button" class="set-btn" data-list-models>Ver modelos de NanoGPT</button></div></fieldset>
      <p class="set-hint">Guardar es instantáneo y no llama al modelo, así que puedes cambiar de uno a otro para comparar respuestas. «Probar conexión» es opcional y puede consumir una pizca de saldo. Tu personaje, acciones e historia reciente se envían a NanoGPT. La API key se guarda en este dispositivo, fuera de las partidas.</p>
      <p id="settings-message" class="set-hint" role="status" aria-live="polite"></p>
      <div class="set-actions"><button class="set-btn primary" type="submit">Guardar</button><button type="button" class="set-btn" data-verify>Probar conexión</button><button type="button" class="set-btn danger" data-forget ${hasKey ? '' : 'hidden'}>Olvidar API key</button></div></form>`;
    const form = body.querySelector('#ai-settings'); const feedback = body.querySelector('#settings-message'); const keyInput = form.elements.apiKey; const customBox = form.querySelector('.custom-model');
    const busy = (value) => form.querySelectorAll('button, input').forEach((element) => { element.disabled = value; });
    const status = (text, error = false) => { feedback.textContent = text; feedback.className = error ? 'set-hint error' : 'set-hint'; };
    const chosenModel = () => { const picked = new FormData(form).get('model'); return picked === CUSTOM_MODEL ? String(form.elements.customModel.value).trim() : picked; };
    form.querySelectorAll('input[name=model]').forEach((radio) => { radio.onchange = () => { customBox.hidden = form.elements.model.value !== CUSTOM_MODEL; if (!customBox.hidden) form.elements.customModel.focus(); }; });
    form.querySelector('[data-list-models]').onclick = async () => {
      busy(true); status('Cargando los modelos de NanoGPT…');
      try {
        const { models } = await request('/api/ai/models', { method: 'POST', body: JSON.stringify({ apiKey: keyInput.value }) });
        form.querySelector('#nano-models').innerHTML = models.map(({ id }) => `<option value="${escapeHtml(id)}"></option>`).join('');
        status(`${models.length} modelos disponibles: escribe para filtrar la lista.`);
      } catch (error) { status(error.message, true); } finally { busy(false); form.elements.customModel.focus(); }
    };
    // `verify`: además de guardar, comprueba la conexión con una llamada corta (opcional).
    async function save(verify) {
      const model = chosenModel();
      if (!model) { status('Escribe el identificador del modelo.', true); return; }
      busy(true); status(verify ? 'Comprobando la conexión con NanoGPT…' : 'Guardando…');
      try {
        settings = await request('/api/ai/settings', { method: 'POST', body: JSON.stringify({ apiKey: keyInput.value, model, verify }) });
        keyInput.value = ''; keyInput.required = false; keyInput.placeholder = 'Guardada · deja vacío para conservarla';
        body.querySelector('#connection-status').textContent = connectionText(settings);
        form.querySelector('[data-forget]').hidden = false;
        status(verify ? 'Conexión correcta. Ya puedes continuar.' : `Guardado: ${modelName(settings.model)}. Ya puedes continuar.`);
        onConfigured(settings.configured);
      } catch (error) { status(error.message, true); } finally { busy(false); }
    }
    form.onsubmit = (event) => { event.preventDefault(); save(false); };
    form.querySelector('[data-verify]').onclick = () => save(true);
    form.querySelector('[data-forget]').onclick = async () => {
      if (!await askConfirm({ title: '¿Olvidar la API key?', text: 'Se borrará de este dispositivo y tendrás que pegarla de nuevo para jugar. Tus partidas no se tocan.', confirmLabel: 'Olvidar', danger: true })) return;
      busy(true);
      try {
        settings = await request('/api/ai/settings', { method: 'DELETE' });
        keyInput.value = ''; keyInput.required = true; keyInput.placeholder = 'Pega aquí tu API key';
        body.querySelector('#connection-status').textContent = 'Conexión eliminada. Configura una key para comenzar o actuar.';
        form.querySelector('[data-forget]').hidden = true;
        status('La API key guardada se ha eliminado de este dispositivo.');
        onConfigured(false);
      } catch (error) { status(error.message, true); } finally { busy(false); }
    };
  }

  // --- Desarrollo ---
  function paintDev() {
    body.innerHTML = `<p class="set-lead">Herramientas del modo desarrollador. No se ven en una partida normal.</p><div class="set-actions stack">${devActions.openPanel ? '<button type="button" class="set-btn" data-dev-panel>Panel de desarrollo</button>' : ''}${devActions.importCard ? '<button type="button" class="set-btn" data-import-card>Importar ficha de personaje</button>' : ''}<a class="set-btn" href="/mapeditor.html" target="_blank" rel="noopener">Editor de mapas</a><button type="button" class="set-btn danger" data-dev-off>Desactivar el modo desarrollador</button></div>`;
    body.querySelector('[data-dev-panel]')?.addEventListener('click', () => devActions.openPanel());
    body.querySelector('[data-import-card]')?.addEventListener('click', () => devActions.importCard());
    body.querySelector('[data-dev-off]').onclick = () => { setDev(false); notify('Modo desarrollador desactivado.'); mountSettings(host, { tab: 'game', message, devActions, onConfigured }); };
  }

  onConfigured(settings.configured);
  show(current);
  return { configured: () => settings.configured };
}
