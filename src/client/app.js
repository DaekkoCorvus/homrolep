const state = { run:null, world:null, screen:'home' };
const app = document.querySelector('#app');
const toast = document.querySelector('#toast');

async function request(url, options = {}) {
  const response = await fetch(url, { headers:{ 'content-type':'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'No se pudo completar la acción.');
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
function escapeHtml(value='') { const node=document.createElement('span'); node.textContent=value; return node.innerHTML; }

function landing() {
  app.innerHTML = `<main class="landing"><section class="landing-card"><p class="eyebrow">Narrative social RPG</p><h1 class="title">Heroes of<br>Misery</h1><p class="subtitle">Un pequeño mundo que recuerda tus decisiones.</p><div class="menu"><button class="primary" data-start>Nueva Run</button><button data-continue>Continuar</button><button data-settings>Ajustes</button></div><p class="muted" id="landing-message"></p></section></main>`;
  app.querySelector('[data-start]').onclick = newRunForm;
  app.querySelector('[data-continue]').onclick = continueRun;
  app.querySelector('[data-settings]').onclick = () => notify('Los ajustes llegarán en una versión futura.');
}

function newRunForm() {
  app.innerHTML = `<main class="landing"><section class="landing-card card"><p class="eyebrow">Northfortress</p><h1>Nueva Run</h1><form class="form" id="new-run"><label>Nombre<input name="name" maxlength="60" required></label><label>Edad<input name="age" type="number" min="13" max="120" required></label><label>Pronombres / género (opcional)<input name="pronouns" maxlength="40"></label><label>Origen / descripción<textarea name="origin" maxlength="300"></textarea></label><label>Ocupación<select name="occupation"><option value="unemployed">Desempleado</option><option value="worker">Trabajador</option><option value="student">Estudiante</option></select></label><label>Aspiración<input name="aspiration" maxlength="160" placeholder="¿Qué deseas conseguir?"></label><label>Ciudad<input value="Northfortress" disabled></label><button class="primary">Comenzar</button><button type="button" data-back>Volver</button><p class="error" id="form-error"></p></form></section></main>`;
  app.querySelector('[data-back]').onclick = landing;
  app.querySelector('form').onsubmit = async (event) => {
    event.preventDefault();
    const submit = event.submitter; submit.disabled = true;
    try {
      state.run = await request('/api/runs', { method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
      localStorage.setItem('hom:lastRun', state.run.id); state.screen='home'; render();
    } catch (error) { app.querySelector('#form-error').textContent=error.message; submit.disabled=false; }
  };
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
  const events = state.run.eventLog.slice(-6).reverse().map((event) => `<div class="event"><time>${escapeHtml(event.time.replace('DAY_','D').replace('_',' · '))}</time><span>${eventText(event)}</span></div>`).join('');
  return `<section class="card hero"><p class="eyebrow">${escapeHtml(location.district)}</p><h1 class="location">${escapeHtml(location.name)}</h1><p>${escapeHtml(location.description)}</p><div class="chips">${location.tags.map((tag)=>`<span class="chip">${escapeHtml(tag)}</span>`).join('')}</div></section><section class="card"><h2>¿Qué haces?</h2><form id="action-form" class="form"><textarea name="text" maxlength="500" placeholder="Describe libremente tu acción…" required></textarea><button class="primary">Actuar · 10 min</button></form></section><section class="card"><h2>Acciones rápidas</h2><div class="actions"><button data-action="wait">Esperar 30 min</button><button data-action="sleep">Dormir 8 h</button><button data-action="work">Trabajar 6 h</button></div></section><section class="card"><h2>Eventos recientes</h2>${events || '<p class="muted">La historia acaba de comenzar.</p>'}</section>`;
}

function eventText(event) {
  if (event.type==='run_started') return 'La Run comenzó en Northfortress.';
  if (event.type==='location_changed') return `Viajaste de ${place(event.from)?.name || event.from} a ${place(event.to)?.name || event.to}.`;
  if (event.type==='player_action') return `${escapeHtml(event.data.text)} — ${escapeHtml(event.data.response)}`;
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
  return `<h1>Personaje</h1><section class="card hero"><p class="eyebrow">${escapeHtml(player.occupation)}</p><h2 class="location">${escapeHtml(player.name)}</h2><p>${escapeHtml(player.origin || 'Una historia todavía por escribir.')}</p></section><section class="card stats"><div class="stat"><small>Edad</small>${player.age}</div><div class="stat"><small>Dinero</small>$${player.money}</div><div class="stat"><small>Reputación</small>${player.reputation}</div><div class="stat"><small>Ubicación</small>${escapeHtml(location.name)}</div><div class="stat"><small>Aspiración</small>${escapeHtml(player.aspiration || 'Sin definir')}</div><div class="stat"><small>Relaciones</small>Próximamente</div></section>`;
}

function missionsScreen() { return `<h1>Misiones</h1><section class="card"><p class="muted">No tienes misiones activas. El sistema semántico está preparado para futuras historias.</p></section>`; }
function phoneScreen() { return `<h1>Teléfono</h1><div class="place-list">${['Status','Messages','Contacts','Map','News','Jobs','Bank'].map((item)=>`<button class="place"><strong>${item}</strong><small>Próximamente</small></button>`).join('')}</div>`; }

async function runAction(action) {
  try { state.run=await request(`/api/runs/${state.run.id}/action`,{method:'POST',body:JSON.stringify(action)}); render(); notify('Partida guardada.'); }
  catch(error){ notify(error.message); }
}

function render() {
  const content = {home:homeScreen,map:mapScreen,social:socialScreen,character:characterScreen,missions:missionsScreen,phone:phoneScreen}[state.screen]();
  const nav=[['home','⌂','Home'],['map','◇','Map'],['social','◎','Social'],['character','♙','Character'],['missions','◆','Missions'],['phone','▣','Phone']];
  app.innerHTML=`<main class="shell"><header class="topbar"><span class="brand">Heroes of Misery</span><span class="clock">${timeText(state.run.world)}</span></header>${content}</main><nav class="nav" aria-label="Navegación">${nav.map(([id,icon,label])=>`<button data-screen="${id}" class="${id===state.screen?'active':''}"><span>${icon}</span>${label}</button>`).join('')}</nav>`;
  app.querySelectorAll('[data-screen]').forEach((button)=>button.onclick=()=>{state.screen=button.dataset.screen;render();});
  app.querySelectorAll('[data-action]').forEach((button)=>button.onclick=()=>runAction({type:button.dataset.action}));
  app.querySelectorAll('[data-travel]').forEach((button)=>button.onclick=()=>runAction({type:'travel',locationId:button.dataset.travel}));
  app.querySelector('#action-form')?.addEventListener('submit',(event)=>{event.preventDefault();runAction({type:'freeform',text:new FormData(event.currentTarget).get('text')});});
  app.querySelector('#post-form')?.addEventListener('submit',async(event)=>{event.preventDefault();try{state.run=await request(`/api/runs/${state.run.id}/posts`,{method:'POST',body:JSON.stringify({text:new FormData(event.currentTarget).get('text')})});render();notify('Publicación guardada.');}catch(error){notify(error.message);}});
}

async function boot() {
  try { state.world=await request('/api/world'); landing(); }
  catch(error) { app.innerHTML=`<main class="landing"><p class="error">${escapeHtml(error.message)}</p></main>`; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
boot();
