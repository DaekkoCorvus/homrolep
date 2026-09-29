const state = { run:null, world:null, screen:'home', creation:null };
const GM_PROFILES = [
  { id:'meta/muse-spark-1.3-contributor', name:'Spark 1.3', tagline:'Inteligente e interpretativo', description:'Mantiene la identidad de los personajes sin sesgo positivo. Es más estricto y ofrece una experiencia completa.' },
  { id:'deepseek/deepseek-v4.1-flash', name:'DeepSeek', tagline:'Creativo y con chispa', description:'Más piadoso contigo y con menos restricciones. Una experiencia suave.' }
];
const app = document.querySelector('#app');
const toast = document.querySelector('#toast');

async function request(url, options = {}) {
  const response = await fetch(url, { headers:{ 'content-type':'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'No se pudo completar la acción.'), { code:body.code });
  return body;
}

function notify(message) {
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function period(hour) {
  if (hour < 4) return 'Medianoche'; if (hour < 6) return 'Madrugada'; if (hour < 8) return 'Amanecer';
  if (hour < 12) return 'Mañana'; if (hour < 14) return 'Mediodía'; if (hour < 18) return 'Tarde';
  if (hour < 21) return 'Atardecer'; return 'Noche';
}

function timeText(world) { return `Día ${world.day} · ${String(world.hour).padStart(2,'0')}:${String(world.minute).padStart(2,'0')} · ${period(world.hour)}`; }
function place(id) { return state.world.locations.find((item) => item.id === id); }
function escapeHtml(value='') { const node=document.createElement('span'); node.textContent=value; return node.innerHTML.replace(/"/g, '&quot;'); }

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

const openingLines = ['Has llegado hasta el umbral. Te esperaba.','Aún eres posibilidad. Vamos a darte forma, poco a poco.'];
const fallbackWhispers = ['Vaya, no soy la única misteriosa por aquí.','Dejaremos que ese silencio te acompañe.'];
const answeredWhispers = ['Lo que has contado empieza a tomar forma.','Hay caminos que nacen de un solo deseo.'];
const creationSteps = [
  { question:'¿Cuántos años tienes?', field:'age' },
  { question:'¿Cómo te reconoces?', field:'gender' },
  { question:'¿Cómo te ves?', field:'appearance' },
  { question:'Ahora sí, cuéntame un poco de ti.', field:'origin' },
  { question:'Oh… antes de que cruces, ¿cuál es tu nombre?', field:'name' }
];

async function startCreation() {
  try {
    const settings = await request('/api/ai/settings');
    if (!settings.configured || !GM_PROFILES.some(({id})=>id===settings.model)) return openSettings(() => startCreation(), 'Antes de crear tu personaje, conecta NanoGPT y elige uno de los GM disponibles.', confirmNewGame);
  } catch (error) { notify(error.message); return; }
  app.querySelector('.confirmation')?.classList.add('portal-opening');
  state.creation = { step:-1, data:{ name:'', age:'', gender:'', genderCustom:'', race:'human', appearance:'', origin:'' }, whispers:fallbackWhispers, dialogueToken:0 };
  await new Promise((resolve)=>setTimeout(resolve,650));
  renderIntro();
}

function creationField(step, data) {
  if (step === 0) return `<input id="character-age" name="age" type="number" inputmode="numeric" min="13" max="120" aria-label="Edad" value="${escapeHtml(data.age)}" required>`;
  if (step === 1) return `<fieldset class="choices gender-choices"><legend class="visually-hidden">Género</legend>${[['man','Hombre'],['woman','Mujer'],['custom','Personalizado']].map(([value,label])=>`<label class="choice"><input type="radio" name="gender" value="${value}" ${data.gender===value?'checked':''} required><span>${label}</span></label>`).join('')}</fieldset><label class="visually-hidden custom-gender" for="gender-custom" ${data.gender==='custom'?'':'hidden'}>Identidad personalizada<input id="gender-custom" name="genderCustom" maxlength="40" placeholder="¿Cómo te describes?" value="${escapeHtml(data.genderCustom)}" ${data.gender==='custom'?'required':''}></label>`;
  if (step === 2) return `<textarea id="character-appearance" name="appearance" maxlength="300" aria-label="Apariencia" required>${escapeHtml(data.appearance)}</textarea>`;
  if (step === 3) return `<textarea id="character-story" name="origin" maxlength="600" aria-label="Historia personal (opcional)">${escapeHtml(data.origin)}</textarea>`;
  return `<input id="character-name" name="name" autocomplete="off" autocapitalize="words" maxlength="60" aria-label="Nombre" value="${escapeHtml(data.name)}" required>`;
}

function collectCreation(form) {
  if (!form || state.creation.step < 0) return;
  const data = state.creation.data;
  for (const [key, value] of new FormData(form)) data[key] = String(value).trim();
  if (state.creation.step === 1 && data.gender !== 'custom') data.genderCustom = '';
}

function renderCreation() {
  const { step, data } = state.creation;
  const current = creationSteps[step];
  app.innerHTML = `<main class="threshold creation cinematic ${step===4?'name-interruption':''}"><div class="portal" aria-hidden="true"><div class="portal-core"></div></div><section class="cinematic-layout scene-enter"><div class="entity-presence" aria-hidden="true"></div><div class="entity-dialogue"><p id="entity-line" class="dialogue-text" role="status" aria-live="polite"></p></div><form id="creation-form" class="creation-form"><div class="step-field">${creationField(step, data)}</div><p class="error" id="creation-error" role="alert">${escapeHtml(state.creation.creationError || '')}</p><div class="creation-controls"><button class="back-link" type="button" data-back>${step===0?'Volver':'Atrás'}</button><button class="creation-continue" type="submit">${step===creationSteps.length-1?'Cruzar el umbral':'Continuar'} <span aria-hidden="true">→</span></button></div></form></section></main>`;
  state.creation.creationError='';
  window.scrollTo(0, 0);
  const form = app.querySelector('#creation-form');
  const continueButton=form.querySelector('.creation-continue');
  const updateContinue=()=>{
    const hasResponse=step===3 || [...new FormData(form).values()].some((value)=>String(value).trim());
    continueButton.classList.toggle('is-visible',hasResponse);
    continueButton.disabled=!form.checkValidity();
  };
  form.addEventListener('input',updateContinue);
  form.addEventListener('change',updateContinue);
  form.querySelectorAll('[name="gender"]').forEach((input)=>input.onchange=()=>{const custom=form.querySelector('.custom-gender');const customInput=custom.querySelector('input');const selected=input.value==='custom'&&input.checked;custom.hidden=!selected;customInput.required=selected;updateContinue();});
  app.querySelector('[data-back]').onclick = () => { collectCreation(form); if (step===0) landing(); else { state.creation.step--; renderCreation(); } };
  form.onsubmit = async (event) => {
    event.preventDefault();
    collectCreation(form);
    if (!form.checkValidity()) return;
    if (step===3) { personalizeBeforeName(); return; }
    if (step < creationSteps.length-1) { state.creation.step++; renderCreation(); return; }
    crossPortal();
  };
  renderEntityLine(current.question,()=>{form.classList.add('is-ready');updateContinue();form.querySelector('input,textarea')?.focus({preventScroll:true});},'question-scene',true);
}

function renderIntro() {
  renderDialogueSequence(openingLines,()=>{state.creation.step=0;renderCreation();},'opening-scene');
}

async function personalizeBeforeName() {
  const { data }=state.creation;
  const moldingBeat=new Promise((resolve)=>renderEntityLine(data.origin?'Tus palabras empiezan a tomar forma…':'Tu silencio también tiene forma.',resolve,'molding-scene'));
  if(data.origin){
    try {
      const result=await request('/api/creation/whispers',{method:'POST',body:JSON.stringify({age:data.age,gender:data.gender,genderCustom:data.genderCustom,origin:data.origin})});
      if(Array.isArray(result.whispers)&&result.whispers.length===2) state.creation.whispers=result.whispers;
      else state.creation.whispers=answeredWhispers;
    } catch { state.creation.whispers=answeredWhispers; }
  } else state.creation.whispers=fallbackWhispers;
  await moldingBeat;
  renderDialogueSequence(state.creation.whispers,()=>{
    app.querySelector('.creation')?.classList.add('name-interrupted');
    setTimeout(()=>{state.creation.step=4;renderCreation();},850);
  },'personalized-scene');
}

function renderDialogueSequence(lines,onComplete,className='') {
  let index=0;
  const next=()=>{
    if(index>=lines.length){onComplete();return;}
    renderEntityLine(lines[index++],()=>setTimeout(next,450),className);
  };
  next();
}

function renderEntityLine(text,onComplete,className='',preserveCurrent=false) {
  const token=++state.creation.dialogueToken;
  if(!preserveCurrent) app.innerHTML=`<main class="threshold creation cinematic ${className}"><div class="portal" aria-hidden="true"><div class="portal-core"></div></div><section class="cinematic-layout scene-enter"><div class="entity-presence" aria-hidden="true"></div><div class="entity-dialogue"><p id="entity-line" class="dialogue-text" role="status" aria-live="polite"></p></div></section></main>`;
  else app.querySelector('.creation')?.classList.add(className);
  const line=app.querySelector('#entity-line');
  if(!line) return;
  line.setAttribute('aria-label',text);
  for(const [index,character] of Array.from(text).entries()){
    const glyph=document.createElement('span');glyph.className='dialogue-glyph';glyph.textContent=character===' '?'\u00a0':character;glyph.setAttribute('aria-hidden','true');glyph.style.setProperty('--glyph-delay',`${Math.min(index*24,1600)}ms`);line.append(glyph);
  }
  const reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const revealTime=reducedMotion?0:Math.min(text.length*24,1600);
  const readingTime=reducedMotion?180:Math.max(1300,text.split(/\s+/).length*190);
  setTimeout(()=>{if(state.creation?.dialogueToken===token)onComplete();},revealTime+readingTime);
}

async function crossPortal() {
  const data=state.creation.data;
  app.innerHTML=`<main class="threshold creation cinematic portal-crossing-scene"><div class="portal" aria-hidden="true"><div class="portal-core"></div></div><section class="cinematic-layout scene-enter"><div class="entity-presence" aria-hidden="true"></div><div class="entity-dialogue"><p class="dialogue-text" aria-live="polite">Ahora sí, ${escapeHtml(data.name)}. Tu historia empieza a tomar forma.</p></div></section></main>`;
  try {
    const [run]=await Promise.all([request('/api/runs',{method:'POST',body:JSON.stringify(data)}),new Promise((resolve)=>setTimeout(resolve,1600))]);
    state.run=run;
    localStorage.setItem('hom:lastRun',state.run.id);
    showArrival();
  } catch(error) {
    state.creation.creationError=error.message;
    state.creation.step=4;
    renderCreation();
  }
}

function showArrival() {
  const location = place(state.run.player.locationId);
  app.innerHTML = `<main class="threshold arrival"><div class="portal" aria-hidden="true"><div class="portal-core"></div></div><section class="threshold-content arrival-card scene-enter"><p class="eyebrow">Día 1 · Northfortress</p><h1>Ya estás aquí, <em>${escapeHtml(state.run.player.name)}</em>.</h1><p class="arrival-lore">${escapeHtml(state.run.prologue?.text || 'Tu historia acaba de comenzar.')}</p><p class="arrival-place">El camino te deja en <strong>${escapeHtml(location?.name || 'Northfortress')}</strong>.</p><button class="primary" data-enter>Entrar en la ciudad <span aria-hidden="true">→</span></button></section></main>`;
  app.querySelector('[data-enter]').onclick = () => { state.screen='home'; render(); };
  window.scrollTo(0, 0);
}

async function continueRun() {
  try {
    const runs = await request('/api/runs');
    if (!runs.length) return notify('Todavía no hay partidas guardadas.');
    const preferred = localStorage.getItem('hom:lastRun');
    const selected = runs.find((run) => run.id === preferred) || runs[0];
    state.run = await request(`/api/runs/${selected.id}`); state.screen='home'; render();
  } catch (error) { notify(error.message); }
}

function homeScreen() {
  const location = place(state.run.player.locationId);
  const events = state.run.eventLog.slice(-6).reverse().map((event) => `<div class="event"><time>${escapeHtml(event.time.replace('DAY_','D').replace('_',' · '))}</time><div>${event.data?.response?`<details class="event-story"><summary>${eventText(event)}</summary><p>${escapeHtml(event.data.response)}</p></details>`:eventText(event)}</div></div>`).join('');
  return `<section class="card hero"><p class="eyebrow">${escapeHtml(location.district)} · Northfortress</p><h1 class="location">${escapeHtml(location.name)}</h1><p>${escapeHtml(location.description)}</p><div class="chips">${location.tags.map((tag)=>`<span class="chip">${escapeHtml(tag)}</span>`).join('')}</div></section>${state.run.prologue?`<details class="card prologue-card"><summary>Recordar el comienzo</summary><p>${escapeHtml(state.run.prologue.text)}</p></details>`:''}${state.run.narrative?`<section class="card narrative-card"><p class="eyebrow">La historia continúa</p><p>${escapeHtml(state.run.narrative.text)}</p></section>`:''}<section class="card"><h2>¿Qué haces?</h2><form id="action-form" class="form"><textarea aria-label="Tu acción" name="text" maxlength="500" placeholder="Describe libremente tu acción…" required></textarea><button class="primary">Actuar · 10 min</button></form></section><section class="card"><h2>Acciones rápidas</h2><div class="actions"><button data-action="wait">Esperar 30 min</button><button data-action="sleep">Dormir 8 h</button>${state.run.player.occupation==='worker'?'<button data-action="work">Trabajar 6 h</button>':''}</div></section><section class="card"><h2>Eventos recientes</h2>${events || '<p class="muted">La historia acaba de comenzar.</p>'}</section>`;
}

function eventText(event) {
  if (event.type==='run_started') return 'La partida comenzó en Northfortress.';
  if (event.type==='prologue_created') return `Tu historia comenzó en ${escapeHtml(place(event.data.locationId)?.name || event.data.locationId)}.`;
  if (event.type==='location_changed') return `Viajaste de ${place(event.from)?.name || event.from} a ${place(event.to)?.name || event.to}.`;
  if (event.type==='player_action') return escapeHtml(event.data.text);
  if (event.type==='time_waited') return `Esperaste ${event.data.minutes} minutos.`;
  if (event.type==='slept') return 'Dormiste ocho horas.';
  if (event.type==='worked') return `Trabajaste y ganaste $${event.data.earned}.`;
  if (event.type==='social_post_created') return 'Publicaste en la red social.';
  return escapeHtml(event.type);
}

function mapScreen() {
  return `<h1>Mapa</h1><p class="muted">Northfortress · ubicaciones conocidas</p><div class="place-list">${state.world.locations.map((location)=>`<button class="place ${location.id===state.run.player.locationId?'primary':''}" data-travel="${location.id}" ${location.id===state.run.player.locationId?'disabled':''}><span><strong>${escapeHtml(location.name)}</strong><small>${escapeHtml(location.district)}</small></span><small>${location.id===state.run.player.locationId?'Ubicación actual':`${location.travelMinutes} min`}</small></button>`).join('')}</div>`;
}

function socialScreen() {
  const posts = state.run.social.posts.map((post)=>`<article class="post"><strong>${escapeHtml(post.author)}</strong><p>${escapeHtml(post.text)}</p><small class="muted">${escapeHtml(post.time)}</small></article>`).join('');
  return `<h1>Social</h1><section class="card"><form id="post-form" class="form"><textarea name="text" maxlength="280" placeholder="¿Qué está pasando?" required></textarea><button class="primary">Publicar</button></form></section><section class="card feed">${posts || '<p class="muted">El feed está en silencio. Publica algo.</p>'}</section>`;
}

function characterScreen() {
  const player=state.run.player, location=place(player.locationId);
  const gender=player.gender==='custom'?player.genderCustom:player.gender==='man'?'Hombre':player.gender==='woman'?'Mujer':'Sin definir';
  return `<h1>Personaje</h1><section class="card hero"><p class="eyebrow">${escapeHtml(player.race==='human'?'Humano':'Historia en curso')}</p><h2 class="location">${escapeHtml(player.name)}</h2><p>${escapeHtml(player.origin || 'Un pasado aún desconocido.')}</p></section><section class="card stats"><div class="stat"><small>Edad</small>${escapeHtml(player.age)}</div><div class="stat"><small>Identidad</small>${escapeHtml(gender)}</div><div class="stat"><small>Dinero</small>$${escapeHtml(player.money)}</div><div class="stat"><small>Reputación</small>${escapeHtml(player.reputation)}</div><div class="stat"><small>Ubicación</small>${escapeHtml(location.name)}</div><div class="stat"><small>Ocupación</small>${escapeHtml(player.occupation || 'Por descubrir')}</div><div class="stat"><small>Aspiración</small>${escapeHtml(player.aspiration || 'Por descubrir')}</div><div class="stat"><small>Relaciones</small>Próximamente</div></section>`;
}

function missionsScreen() { return `<h1>Misiones</h1><section class="card"><p class="muted">No tienes misiones activas. El sistema semántico está preparado para futuras historias.</p></section>`; }
function phoneScreen() { return `<h1>Teléfono</h1><div class="place-list">${['Status','Messages','Contacts','Map','News','Jobs','Bank'].map((item)=>`<button class="place"><strong>${item}</strong><small>Próximamente</small></button>`).join('')}</div>`; }

async function runAction(action) {
  if (state.busy) return;
  state.busy=true;
  const feedback=app.querySelector('#action-status');
  feedback.className='field-note'; feedback.textContent='La ciudad responde…';
  const buttons=[...app.querySelectorAll('button')].map((element)=>({element,disabled:element.disabled}));
  buttons.forEach(({element})=>element.disabled=true);
  const actionInput=app.querySelector('#action-form textarea');
  if (actionInput) actionInput.readOnly=true;
  try {
    state.run=await request(`/api/runs/${state.run.id}/action`,{method:'POST',body:JSON.stringify(action)});
    render(); notify('Partida guardada.');
  } catch(error) {
    feedback.className='error'; feedback.textContent=error.message;
    buttons.forEach(({element,disabled})=>element.disabled=disabled);
    if (actionInput) actionInput.readOnly=false;
  } finally { state.busy=false; }
}

function render() {
  const content = {home:homeScreen,map:mapScreen,social:socialScreen,character:characterScreen,missions:missionsScreen,phone:phoneScreen}[state.screen]();
  const nav=[['home','⌂','Home'],['map','◇','Map'],['social','◎','Social'],['character','♙','Character'],['missions','◆','Missions'],['phone','▣','Phone']];
  app.innerHTML=`<main class="shell"><header class="topbar"><span class="brand">Heroes of Misery</span><span class="clock">${timeText(state.run.world)}</span><button class="settings-shortcut" data-ai-settings aria-label="Ajustes de IA">⚙</button></header><p id="action-status" role="status" aria-live="polite"></p>${content}</main><nav class="nav" aria-label="Navegación">${nav.map(([id,icon,label])=>`<button data-screen="${id}" class="${id===state.screen?'active':''}"><span>${icon}</span>${label}</button>`).join('')}</nav>`;
  app.querySelector('[data-ai-settings]').onclick=()=>openSettings(render);
  app.querySelectorAll('[data-screen]').forEach((button)=>button.onclick=()=>{state.screen=button.dataset.screen;render();});
  app.querySelectorAll('[data-action]').forEach((button)=>button.onclick=()=>runAction({type:button.dataset.action}));
  app.querySelectorAll('[data-travel]').forEach((button)=>button.onclick=()=>runAction({type:'travel',locationId:button.dataset.travel}));
  app.querySelector('#action-form')?.addEventListener('submit',(event)=>{event.preventDefault();runAction({type:'freeform',text:new FormData(event.currentTarget).get('text')});});
  app.querySelector('#post-form')?.addEventListener('submit',async(event)=>{event.preventDefault();try{state.run=await request(`/api/runs/${state.run.id}/posts`,{method:'POST',body:JSON.stringify({text:new FormData(event.currentTarget).get('text')})});render();notify('Publicación guardada.');}catch(error){notify(error.message);}});
  window.scrollTo(0, 0);
}

async function boot() {
  try { state.world=await request('/api/world'); landing(); }
  catch(error) { app.innerHTML=`<main class="landing"><p class="error">${escapeHtml(error.message)}</p></main>`; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
boot();
