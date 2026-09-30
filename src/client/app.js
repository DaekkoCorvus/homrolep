import { state, app, request, notify, escapeHtml, place } from './core.js';
import { enterGame } from './game.js';

const GM_PROFILES = [
  { id:'meta/muse-spark-1.3-contributor', name:'Spark 1.3', tagline:'Inteligente e interpretativo', description:'Mantiene la identidad de los personajes sin sesgo positivo. Es más estricto y ofrece una experiencia completa.' },
  { id:'deepseek/deepseek-v4.1-flash', name:'DeepSeek', tagline:'Creativo y con chispa', description:'Más piadoso contigo y con menos restricciones. Una experiencia suave.' }
];

function landing() {
  app.innerHTML = `<main class="threshold"><div class="portal" aria-hidden="true"><div class="portal-core"></div></div><section class="threshold-content landing-card scene-enter"><p class="eyebrow">Un mundo aguarda tu nombre</p><h1 class="title">Heroes of<br><em>Misery</em></h1><p class="subtitle">Toda historia comienza al cruzar un umbral.</p><div class="menu"><button class="primary" data-start>Nueva partida <span aria-hidden="true">✧</span></button><button data-continue>Continuar</button><button data-settings>Ajustes</button></div><p class="muted" id="landing-message"></p></section></main>`;
  app.querySelector('[data-start]').onclick = confirmNewGame;
  app.querySelector('[data-continue]').onclick = continueRun;
  app.querySelector('[data-settings]').onclick = () => openSettings(landing);
}

async function openSettings(onDone = landing, message = '', onBack = onDone) {
  let settings;
  try { settings = await request('/api/ai/settings'); }
  catch (error) { notify(error.message); return; }
  const selectedModel = GM_PROFILES.some(({id})=>id===settings.model) ? settings.model : GM_PROFILES[0].id;
  const selectedProfile = GM_PROFILES.find(({id})=>id===settings.model);
  const hasKey=settings.hasKey ?? settings.configured;
  const connectionLabel=settings.configured?`Conexión comprobada · ${selectedProfile?.name || 'GM'}`:hasKey?'API key guardada · Elige y comprueba tu GM':'Aún no hay una conexión configurada.';
  app.innerHTML = `<main class="landing"><section class="settings-card card scene-enter"><p class="eyebrow">La voz de tu mundo</p><h1>Ajustes de IA</h1><p>Conecta tu cuenta de <a href="https://nano-gpt.com" target="_blank" rel="noopener noreferrer">NanoGPT</a> y elige quién narrará tu partida.</p><p class="connection-status" id="connection-status">${connectionLabel}</p>${message?`<p class="field-note">${escapeHtml(message)}</p>`:''}<form class="form" id="ai-settings"><label>API key de NanoGPT<input name="apiKey" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="text" maxlength="4096" placeholder="${hasKey?'Guardada · deja vacío para conservarla':'Pega aquí tu API key'}" ${hasKey?'':'required'}></label><fieldset class="gm-options"><legend>Elige tu GM</legend>${GM_PROFILES.map((profile)=>`<label class="gm-option"><input type="radio" name="model" value="${profile.id}" ${selectedModel===profile.id?'checked':''} required><span class="gm-copy"><strong>${profile.name}</strong><small class="gm-tagline">${profile.tagline}</small><small>${profile.description}</small></span><span class="gm-check" aria-hidden="true">✧</span></label>`).join('')}</fieldset><p class="field-note">La prueba, las frases de la entidad y las narraciones pueden consumir saldo o cuota. Tu personaje, acciones e historia reciente se envían a NanoGPT. La API key se guarda en este dispositivo, fuera de las partidas.</p><p id="settings-message" role="status" aria-live="polite"></p><button class="primary" type="submit">Probar y guardar</button><button type="button" data-forget ${hasKey?'':'hidden'}>Olvidar API key</button><button type="button" data-done>Volver</button></form></section></main>`;
  window.scrollTo(0, 0);
  const form = app.querySelector('#ai-settings');
  const feedback = app.querySelector('#settings-message');
  const keyInput = form.elements.apiKey;
  function busy(value) { form.querySelectorAll('button, input').forEach((element) => element.disabled=value); }
  function status(text, error = false) { feedback.textContent=text; feedback.className=error?'error':'field-note'; }
  form.querySelector('[data-done]').onclick = () => {
    const supported = GM_PROFILES.some(({id})=>id===settings.model);
    if (settings.configured && supported) onDone(); else onBack();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(form));
    busy(true); status('Comprobando la conexión con NanoGPT…');
    try {
      settings = await request('/api/ai/settings', { method:'POST', body:JSON.stringify(input) });
      keyInput.value=''; keyInput.required=false; keyInput.placeholder='Guardada · deja vacío para conservarla';
      app.querySelector('#connection-status').textContent=`Conexión comprobada · ${GM_PROFILES.find(({id})=>id===settings.model)?.name || 'GM'}`;
      form.querySelector('[data-forget]').hidden=false;
      status('Conexión correcta. Ya puedes continuar.');
      form.querySelector('[data-done]').textContent='Continuar';
    } catch (error) { status(error.message, true); }
    finally { busy(false); }
  };
  form.querySelector('[data-forget]').onclick = async () => {
    busy(true);
    try {
      settings = await request('/api/ai/settings', { method:'DELETE' });
      keyInput.value=''; keyInput.required=true; keyInput.placeholder='Pega aquí tu API key';
      app.querySelector('#connection-status').textContent='Conexión eliminada. Configura una key para comenzar o actuar.';
      form.querySelector('[data-forget]').hidden=true;
      status('La API key guardada se ha eliminado de este dispositivo.');
    } catch (error) { status(error.message, true); }
    finally { busy(false); }
  };
}

function confirmNewGame() {
  app.innerHTML = `<main class="threshold confirmation"><div class="portal" aria-hidden="true"><div class="portal-core"></div></div><section class="threshold-content confirmation-card scene-enter"><div class="entity-mark" aria-hidden="true">✧</div><p class="eyebrow">La voz del umbral</p><h1>¿Quieres comenzar una nueva partida?</h1><p class="subtitle">Una nueva historia te espera al otro lado.</p><div class="creation-buttons"><button type="button" data-cancel>Volver</button><button class="primary" type="button" data-confirm>Cruzar el umbral</button></div></section></main>`;
  app.querySelector('[data-cancel]').onclick=landing;
  app.querySelector('[data-confirm]').onclick=async(event)=>{const button=event.currentTarget;button.disabled=true;await startCreation();if(button.isConnected)button.disabled=false;};
}

const openingLines = ['Te esperaba.','Aún no tienes forma… ni nombre.','Permíteme dártela, poco a poco.'];
const fallbackWhispers = ['Vaya, no soy la única misteriosa por aquí.','Dejaremos que ese silencio te acompañe.'];
const answeredWhispers = ['Lo que has contado empieza a tomar forma.','Hay caminos que nacen de un solo deseo.'];
const creationSteps = [
  { question:'¿Cuántos años tienes?', field:'age' },
  { question:'¿Cómo te reconoces?', field:'gender' },
  { question:'¿Cómo te ves?', field:'appearance' },
  { question:'Ahora sí, cuéntame un poco de ti.', field:'origin' },
  { question:'Oh… antes de que cruces, ¿cuál es tu nombre?', field:'name' }
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const vortex = (values) => document.getElementById('vortex-layer')?.contentWindow?.postMessage({ type:'vortex', ...values }, location.origin);
const vortexPulse = async (strength=.32) => { vortex({ flash:strength, rate:7 }); await sleep(260); vortex({ flash:0, rate:1.3 }); };
const alive = (token) => state.creation?.token === token;

async function startCreation() {
  try {
    const settings = await request('/api/ai/settings');
    if (!settings.configured || !GM_PROFILES.some(({id})=>id===settings.model)) return openSettings(() => startCreation(), 'Antes de crear tu personaje, conecta NanoGPT y elige uno de los GM disponibles.', confirmNewGame);
  } catch (error) { notify(error.message); return; }
  const token = (state.creation?.token || 0) + 1;
  state.creation = { token, data:{ name:'', age:'', gender:'', genderCustom:'', race:'human', appearance:'', origin:'' }, creationError:'' };
  app.querySelector('.confirmation')?.classList.add('portal-opening');
  vortex({ zoom:2.4, flash:1, rate:2.2 });
  await sleep(reducedMotion() ? 200 : 1500);
  if (!alive(token)) return;
  vortex({ zoom:1, flash:0, rate:.9 });
  runCreation(token);
}

function abandonCreation() {
  if (state.creation) state.creation.token++;
  vortex({ zoom:1, flash:0, rate:2 });
  landing();
}

function stage(className='') {
  let main = app.querySelector('.cinematic');
  if (!main) {
    app.innerHTML = `<main class="threshold creation cinematic"><section class="cinematic-layout"><p id="entity-line" class="dialogue-text" role="status" aria-live="polite"></p><form id="creation-form" class="creation-form" hidden></form></section></main>`;
    main = app.querySelector('.cinematic');
  }
  main.className = `threshold creation cinematic ${className}`;
  return main;
}

async function say(text, token, { hold=false }={}) {
  const line = app.querySelector('#entity-line');
  if (!line || !alive(token)) return false;
  line.className = 'dialogue-text';
  line.textContent = '';
  line.setAttribute('aria-label', text);
  const reduce = reducedMotion();
  const length = Array.from(text).length;
  const step = reduce ? 0 : Math.min(46, 2600 / length);
  let index = 0;
  text.split(/(\s+)/).forEach((chunk) => {
    if (!chunk) return;
    if (/^\s+$/.test(chunk)) { line.append(' '); index += chunk.length; return; }
    const word = document.createElement('span');
    word.className = 'dialogue-word';
    word.setAttribute('aria-hidden', 'true');
    for (const character of Array.from(chunk)) {
      const glyph = document.createElement('span');
      glyph.className = 'dialogue-glyph';
      glyph.textContent = character;
      glyph.style.setProperty('--d', `${Math.round(index++ * step)}ms`);
      glyph.style.setProperty('--phase', `${-Math.round(Math.random() * 6000)}ms`);
      glyph.style.setProperty('--dur', `${(5 + Math.random() * 3).toFixed(1)}s`);
      glyph.style.setProperty('--amp', `${(1.2 + Math.random() * 2).toFixed(1)}px`);
      glyph.style.setProperty('--rot', `${((Math.random() - .5) * 2.6).toFixed(1)}deg`);
      word.append(glyph);
    }
    line.append(word);
  });
  const words = text.split(/\s+/).length;
  await sleep(length * step + 900 + (hold ? 0 : reduce ? 300 : Math.max(1500, words * 340)));
  if (!alive(token)) return false;
  if (hold) return true;
  line.classList.add('leaving');
  await sleep(reduce ? 0 : 1000);
  return alive(token);
}

async function dismissForm(token) {
  const form = app.querySelector('#creation-form');
  const line = app.querySelector('#entity-line');
  form?.classList.remove('is-ready');
  line?.classList.add('leaving');
  await sleep(reducedMotion() ? 0 : 900);
  return alive(token);
}

function creationField(step, data) {
  if (step === 0) return `<input id="character-age" name="age" type="number" inputmode="numeric" min="13" max="120" aria-label="Edad" value="${escapeHtml(data.age)}" required>`;
  if (step === 1) return `<fieldset class="choices gender-choices"><legend class="visually-hidden">Género</legend>${[['man','Hombre'],['woman','Mujer'],['custom','Otro']].map(([value,label])=>`<label class="choice"><input type="radio" name="gender" value="${value}" ${data.gender===value?'checked':''} required><span>${label}</span></label>`).join('')}</fieldset><label class="visually-hidden custom-gender" for="gender-custom" ${data.gender==='custom'?'':'hidden'}>Identidad personalizada<input id="gender-custom" name="genderCustom" maxlength="40" placeholder="¿cómo te describes?" value="${escapeHtml(data.genderCustom)}" ${data.gender==='custom'?'required':''}></label>`;
  if (step === 2) return `<textarea id="character-appearance" name="appearance" maxlength="300" rows="2" aria-label="Apariencia" required>${escapeHtml(data.appearance)}</textarea>`;
  if (step === 3) return `<textarea id="character-story" name="origin" maxlength="600" rows="3" aria-label="Historia personal (opcional)">${escapeHtml(data.origin)}</textarea>`;
  return `<input id="character-name" name="name" autocomplete="off" autocapitalize="words" maxlength="60" aria-label="Nombre" value="${escapeHtml(data.name)}" required>`;
}

function collectCreation(form) {
  const data = state.creation.data;
  for (const [key, value] of new FormData(form)) data[key] = String(value).trim();
  if (data.gender !== 'custom') data.genderCustom = '';
}

// Muestra una pregunta de la entidad y espera la respuesta. Devuelve 'next', 'back' o 'cancelled'.
async function ask(step, token) {
  const { data } = state.creation;
  const main = stage(step === 4 ? 'question-scene name-interruption' : 'question-scene');
  const form = main.querySelector('#creation-form');
  form.hidden = false;
  form.className = 'creation-form';
  const error = state.creation.creationError;
  state.creation.creationError = '';
  form.innerHTML = `<div class="step-field">${creationField(step, data)}</div><p class="error" role="alert">${escapeHtml(error)}</p><div class="creation-controls"><button class="back-link" type="button" data-back>${step===0?'Volver':'Atrás'}</button><button class="creation-continue" type="submit">${step===creationSteps.length-1?'Cruzar':'Continuar'} <span aria-hidden="true">→</span></button></div>`;
  const continueButton = form.querySelector('.creation-continue');
  let optionalTimer;
  const update = () => {
    const filled = [...new FormData(form).values()].some((value) => String(value).trim());
    continueButton.classList.toggle('is-visible', filled || continueButton.dataset.revealed === 'true');
    continueButton.disabled = !form.checkValidity();
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.querySelectorAll('[name="gender"]').forEach((input) => input.onchange = () => {
    const custom = form.querySelector('.custom-gender'); const customInput = custom.querySelector('input');
    const selected = input.value === 'custom' && input.checked;
    custom.hidden = !selected; customInput.required = selected;
    if (selected) customInput.focus({ preventScroll:true });
    update();
  });
  const shown = await say(creationSteps[step].question, token, { hold:true });
  if (!shown) return 'cancelled';
  form.classList.add('is-ready');
  update();
  if (step === 3) optionalTimer = setTimeout(() => { continueButton.dataset.revealed = 'true'; update(); }, 3200);
  form.querySelector('input:not([type="radio"]),textarea')?.focus({ preventScroll:true });
  return new Promise((resolve) => {
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!form.checkValidity()) return;
      clearTimeout(optionalTimer);
      collectCreation(form);
      resolve('next');
    };
    form.querySelector('[data-back]').onclick = () => { clearTimeout(optionalTimer); collectCreation(form); resolve('back'); };
  });
}

async function runCreation(token) {
  for (const line of openingLines) {
    stage('opening-scene');
    if (!await say(line, token)) return;
  }
  let step = 0;
  while (alive(token)) {
    const answer = await ask(step, token);
    if (answer === 'cancelled' || !alive(token)) return;
    if (answer === 'back') {
      if (step === 0) return abandonCreation();
      await dismissForm(token); step--; continue;
    }
    vortexPulse();
    if (step === 3) { if (!await personalizeBeforeName(token)) return; step = 4; continue; }
    if (step < 4) { if (!await dismissForm(token)) return; step++; continue; }
    if (await crossPortal(token)) return;
    step = 4;
  }
}

async function personalizeBeforeName(token) {
  const { data } = state.creation;
  if (!await dismissForm(token)) return false;
  stage('molding-scene');
  vortex({ zoom:1.18, flash:.14, rate:1.1 });
  const pending = data.origin
    ? request('/api/creation/whispers', { method:'POST', body:JSON.stringify({ age:data.age, gender:data.gender, genderCustom:data.genderCustom, origin:data.origin }) }).catch(() => null)
    : Promise.resolve(null);
  if (!await say(data.origin ? 'Tus palabras empiezan a tomar forma…' : 'Tu silencio también tiene forma.', token)) return false;
  const result = await pending;
  const whispers = !data.origin ? fallbackWhispers : Array.isArray(result?.whispers) && result.whispers.length === 2 ? result.whispers : answeredWhispers;
  stage('personalized-scene');
  for (const whisper of whispers) if (!await say(whisper, token, { hold: whisper === whispers.at(-1) })) return false;
  // La entidad se interrumpe: un sacudón de luz antes de preguntar el nombre.
  vortex({ zoom:1.5, flash:.5, rate:9 });
  await sleep(170);
  app.querySelector('#entity-line')?.classList.add('interrupted');
  vortex({ zoom:1.3, flash:.06, rate:1.8 });
  await sleep(reducedMotion() ? 0 : 1000);
  return alive(token);
}

// Devuelve true si la partida se creó y se mostró la llegada; false si falló y hay que volver al nombre.
async function crossPortal(token) {
  const { data } = state.creation;
  await dismissForm(token);
  if (!alive(token)) return true;
  stage('portal-crossing-scene');
  vortex({ zoom:6, flash:.9, rate:.75 });
  const closing = say(`Ahora sí, ${data.name}. Tu historia empieza a tomar forma.`, token, { hold:true });
  try {
    const [run] = await Promise.all([request('/api/runs', { method:'POST', body:JSON.stringify(data) }), closing, sleep(2600)]);
    if (!alive(token)) return true;
    state.run = run;
    localStorage.setItem('hom:lastRun', run.id);
    app.querySelector('#entity-line')?.classList.add('leaving');
    await sleep(reducedMotion() ? 0 : 900);
    vortex({ zoom:1, flash:0, rate:1.2 });
    showArrival();
    return true;
  } catch (error) {
    if (!alive(token)) return true;
    state.creation.creationError = error.message;
    vortex({ zoom:1.3, flash:0, rate:1.5 });
    return false;
  }
}

function showArrival() {
  const location = place(state.run.player.locationId);
  app.innerHTML = `<main class="threshold arrival"><div class="portal" aria-hidden="true"><div class="portal-core"></div></div><section class="threshold-content arrival-card scene-enter"><p class="eyebrow">Día 1 · Northfortress</p><h1>Ya estás aquí, <em>${escapeHtml(state.run.player.name)}</em>.</h1><p class="arrival-lore">${escapeHtml(state.run.prologue?.text || 'Tu historia acaba de comenzar.')}</p><p class="arrival-place">El camino te deja en <strong>${escapeHtml(location?.name || 'Northfortress')}</strong>.</p><button class="primary" data-enter>Entrar en la ciudad <span aria-hidden="true">→</span></button></section></main>`;
  app.querySelector('[data-enter]').onclick = startGame;
  window.scrollTo(0, 0);
}

async function continueRun() {
  try {
    const runs = await request('/api/runs');
    if (!runs.length) return notify('Todavía no hay partidas guardadas.');
    const preferred = localStorage.getItem('hom:lastRun');
    const selected = runs.find((run) => run.id === preferred) || runs[0];
    state.run = await request(`/api/runs/${selected.id}`); startGame();
  } catch (error) { notify(error.message); }
}

const startGame = () => enterGame({ openSettings:() => openSettings(startGame) });

async function boot() {
  try { state.world=await request('/api/world'); landing(); }
  catch(error) { app.innerHTML=`<main class="landing"><p class="error">${escapeHtml(error.message)}</p></main>`; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
boot();
