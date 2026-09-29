const state = { run:null, world:null, screen:'home', creation:null };
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
  app.innerHTML = `<main class="threshold"><div class="portal" aria-hidden="true"><div class="portal-core"></div></div><section class="threshold-content landing-card scene-enter"><p class="eyebrow">Un mundo aguarda tu nombre</p><h1 class="title">Heroes of<br><em>Misery</em></h1><p class="subtitle">Toda historia comienza al cruzar un umbral.</p><div class="menu"><button class="primary" data-start>Nueva Run <span aria-hidden="true">✧</span></button><button data-continue>Continuar</button><button data-settings>Ajustes</button></div><p class="muted" id="landing-message"></p></section></main>`;
  app.querySelector('[data-start]').onclick = () => startCreation();
  app.querySelector('[data-continue]').onclick = continueRun;
  app.querySelector('[data-settings]').onclick = () => openSettings(landing);
}

async function openSettings(onDone = landing, message = '', onBack = onDone) {
  let settings;
  try { settings = await request('/api/ai/settings'); }
  catch (error) { notify(error.message); return; }
  app.innerHTML = `<main class="landing"><section class="settings-card card scene-enter"><p class="eyebrow">La voz de tu mundo</p><h1>Ajustes de IA</h1><p>Conecta tu cuenta de <a href="https://nano-gpt.com" target="_blank" rel="noopener noreferrer">NanoGPT</a> y elige el modelo que narrará la partida.</p><p class="connection-status" id="connection-status">${settings.configured?`Conexión comprobada · ${escapeHtml(settings.model)}`:'Aún no hay una conexión configurada.'}</p>${message?`<p class="field-note">${escapeHtml(message)}</p>`:''}<form class="form" id="ai-settings"><label>API key de NanoGPT<input name="apiKey" type="password" autocomplete="off" spellcheck="false" maxlength="4096" placeholder="${settings.configured?'Guardada · deja vacío para conservarla':'Pega aquí tu API key'}" ${settings.configured?'':'required'}></label><button type="button" data-models>Cargar modelos</button><label>Modelo<input name="model" list="nanogpt-models" maxlength="200" autocomplete="off" placeholder="Selecciona o escribe el ID del modelo" value="${escapeHtml(settings.model)}" required><datalist id="nanogpt-models"></datalist></label><p class="field-note">La prueba y las narraciones consumen el saldo o la cuota de tu cuenta. Tu personaje, acciones e historia reciente se envían a NanoGPT. La key se guarda en el servidor local de este dispositivo, fuera de las partidas.</p><p id="settings-message" role="status" aria-live="polite"></p><button class="primary" type="submit">Probar y guardar</button><button type="button" data-forget ${settings.configured?'':'hidden'}>Olvidar API key</button><button type="button" data-done>${settings.configured?'Volver al juego':'Volver'}</button></form></section></main>`;
  window.scrollTo(0, 0);
  const form = app.querySelector('#ai-settings');
  const feedback = app.querySelector('#settings-message');
  const keyInput = form.elements.apiKey;
  function busy(value) { form.querySelectorAll('button, input').forEach((element) => element.disabled=value); }
  function status(text, error = false) { feedback.textContent=text; feedback.className=error?'error':'field-note'; }
  form.querySelector('[data-done]').onclick = () => settings.configured ? onDone() : onBack();
  form.querySelector('[data-models]').onclick = async () => {
    const apiKey = keyInput.value;
    busy(true); status('Consultando los modelos…');
    try {
      const result = await request('/api/ai/models', { method:'POST', body:JSON.stringify({ apiKey }) });
      form.querySelector('datalist').innerHTML = result.models.map(({id})=>`<option value="${escapeHtml(id)}"></option>`).join('');
      status(`${result.models.length} modelos disponibles. Escribe en Modelo para buscarlos.`);
    } catch (error) { status(error.message, true); }
    finally { busy(false); }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(form));
    busy(true); status('Comprobando la conexión con NanoGPT…');
    try {
      settings = await request('/api/ai/settings', { method:'POST', body:JSON.stringify(input) });
      keyInput.value=''; keyInput.required=false; keyInput.placeholder='Guardada · deja vacío para conservarla';
      app.querySelector('#connection-status').textContent=`Conexión comprobada · ${settings.model}`;
      form.querySelector('[data-forget]').hidden=false;
      form.querySelector('[data-done]').textContent='Continuar';
      status('Conexión correcta. Ya puedes continuar.');
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

const creationSteps = [
  { title:'¿Cuál es tu nombre?', whisper:'Todo empieza con una palabra. La tuya.', field:'name' },
  { title:'¿Cuántos años tienes?', whisper:'El tiempo te ha traído hasta este lugar.', field:'age' },
  { title:'¿Cómo te reconoces?', whisper:'Tu identidad te pertenece. Yo solo escucharé.', field:'gender' },
  { title:'¿Cuál es tu raza?', whisper:'Por ahora, las puertas se abren a los humanos.', field:'race' },
  { title:'Cuéntame quién eres.', whisper:'No necesito saber qué serás. Solo de dónde nace tu historia.', field:'origin' },
  { title:'El umbral te espera.', whisper:'Perfecto… la ciudad ya percibe tu presencia. ¿Estás listo para cruzar?', field:null }
];

async function startCreation() {
  try {
    const settings = await request('/api/ai/settings');
    if (!settings.configured) return openSettings(() => startCreation(), 'Antes de crear tu personaje, conecta y comprueba tu API key.', landing);
  } catch (error) { notify(error.message); return; }
  state.creation = { step:0, data:{ name:'', age:'', gender:'', genderCustom:'', race:'human', origin:'' } };
  renderCreation();
}

function creationField(step, data) {
  if (step === 0) return `<label class="creation-label" for="character-name">Tu nombre</label><input id="character-name" name="name" autocomplete="off" maxlength="60" placeholder="Escribe tu nombre…" value="${escapeHtml(data.name)}" required>`;
  if (step === 1) return `<label class="creation-label" for="character-age">Tu edad</label><input id="character-age" name="age" type="number" inputmode="numeric" min="13" max="120" placeholder="¿Cuántos años tienes?" value="${escapeHtml(data.age)}" required><p class="field-note">Entre 13 y 120 años.</p>`;
  if (step === 2) return `<fieldset class="choices"><legend>Selecciona una opción</legend>${[['man','Hombre'],['woman','Mujer'],['custom','Custom']].map(([value,label])=>`<label class="choice"><input type="radio" name="gender" value="${value}" ${data.gender===value?'checked':''} required><span>${label}</span></label>`).join('')}</fieldset><label class="creation-label custom-gender" for="gender-custom" ${data.gender==='custom'?'':'hidden'}>¿Cómo lo describes?<input id="gender-custom" name="genderCustom" maxlength="40" placeholder="Tus propias palabras" value="${escapeHtml(data.genderCustom)}" ${data.gender==='custom'?'required':''}></label>`;
  if (step === 3) return `<fieldset class="choices"><legend>Raza disponible</legend><label class="choice"><input type="radio" name="race" value="human" checked><span>Humano <small>Una vida nueva en Northfortress</small></span></label></fieldset><p class="field-note">Otras razas podrán abrirse más adelante.</p>`;
  if (step === 4) return `<label class="creation-label" for="character-story">Tu historia hasta hoy</label><textarea id="character-story" name="origin" maxlength="600" minlength="10" placeholder="Tal vez acabas de llegar, buscas a alguien o huyes de algo…" required>${escapeHtml(data.origin)}</textarea><p class="field-note">No elijas aún una ocupación ni una aspiración. La historia decidirá contigo.</p>`;
  return `<div class="creation-recap"><p><span>Nombre</span><strong>${escapeHtml(data.name)}</strong></p><p><span>Edad</span><strong>${escapeHtml(data.age)}</strong></p><p><span>Identidad</span><strong>${escapeHtml(data.gender==='custom'?data.genderCustom:data.gender==='man'?'Hombre':'Mujer')}</strong></p><p><span>Raza</span><strong>Humano</strong></p></div><p class="muted">Al cruzar, una breve historia te recibirá en algún lugar de Northfortress.</p>`;
}

function collectCreation(form) {
  if (!form || state.creation.step === 5) return;
  const data = state.creation.data;
  for (const [key, value] of new FormData(form)) data[key] = String(value).trim();
  if (state.creation.step === 2 && data.gender !== 'custom') data.genderCustom = '';
}

function renderCreation() {
  const { step, data } = state.creation;
  const current = creationSteps[step];
  app.innerHTML = `<main class="threshold creation"><div class="portal" aria-hidden="true"><div class="portal-core"></div></div><section class="threshold-content creation-layout scene-enter"><div class="entity-mark" aria-hidden="true">✧</div><p class="eyebrow">La voz del umbral <span class="step-count">${step + 1} / ${creationSteps.length}</span></p><div class="progress" role="progressbar" aria-valuenow="${step + 1}" aria-valuemin="1" aria-valuemax="${creationSteps.length}" aria-label="Progreso de creación"><span style="width:${((step+1)/creationSteps.length)*100}%"></span></div><div class="entity-message"><p class="entity-whisper">${current.whisper}</p><h1>${current.title}</h1></div><form id="creation-form" class="creation-form"><div class="step-field">${creationField(step, data)}</div><p class="error" id="creation-error" role="alert"></p><div class="creation-buttons"><button type="button" data-back>${step===0?'Salir':'Atrás'}</button><button class="primary" type="submit">${step===5?'Cruzar el umbral':'Continuar <span aria-hidden="true">→</span>'}</button></div></form></section></main>`;
  window.scrollTo(0, 0);
  const form = app.querySelector('#creation-form');
  form.querySelectorAll('[name="gender"]').forEach((input)=>input.onchange=()=>{const custom=form.querySelector('.custom-gender'); const selected=input.value==='custom' && input.checked; custom.hidden=!selected; custom.querySelector('input').required=selected;});
  app.querySelector('[data-back]').onclick = () => { collectCreation(form); if (step===0) landing(); else { state.creation.step--; renderCreation(); } };
  form.onsubmit = async (event) => {
    event.preventDefault();
    collectCreation(form);
    if (step < 5) { state.creation.step++; renderCreation(); return; }
    const submit = form.querySelector('[type="submit"]');
    form.querySelectorAll('button').forEach((button)=>button.disabled=true);
    submit.textContent = 'El umbral se abre…';
    try {
      state.run = await request('/api/runs', { method:'POST', body:JSON.stringify(data) });
      localStorage.setItem('hom:lastRun', state.run.id);
      showArrival();
    } catch (error) { app.querySelector('#creation-error').textContent=error.message; form.querySelectorAll('button').forEach((button)=>button.disabled=false); submit.textContent='Cruzar el umbral'; }
  };
  if (step===5) {
    const settingsButton = document.createElement('button');
    settingsButton.type='button'; settingsButton.textContent='Ajustes de IA'; settingsButton.className='creation-settings';
    settingsButton.onclick=()=>openSettings(renderCreation);
    form.append(settingsButton);
  }
  if (step===0 || step===1 || step===4) form.querySelector('input, textarea')?.focus({ preventScroll:true });
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
  if (event.type==='run_started') return 'La Run comenzó en Northfortress.';
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
  return `<h1>Personaje</h1><section class="card hero"><p class="eyebrow">${escapeHtml(player.race==='human'?'Humano':'Historia en curso')}</p><h2 class="location">${escapeHtml(player.name)}</h2><p>${escapeHtml(player.origin || 'Una historia todavía por escribir.')}</p></section><section class="card stats"><div class="stat"><small>Edad</small>${escapeHtml(player.age)}</div><div class="stat"><small>Identidad</small>${escapeHtml(gender)}</div><div class="stat"><small>Dinero</small>$${escapeHtml(player.money)}</div><div class="stat"><small>Reputación</small>${escapeHtml(player.reputation)}</div><div class="stat"><small>Ubicación</small>${escapeHtml(location.name)}</div><div class="stat"><small>Ocupación</small>${escapeHtml(player.occupation || 'Por descubrir')}</div><div class="stat"><small>Aspiración</small>${escapeHtml(player.aspiration || 'Por descubrir')}</div><div class="stat"><small>Relaciones</small>Próximamente</div></section>`;
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
