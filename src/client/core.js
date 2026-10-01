export const state = { run:null, world:null, screen:'home', creation:null };
export const app = document.querySelector('#app');
const toast = document.querySelector('#toast');

// Modo desarrollador: se activa con /dev en el chat (o ?dev=1 en la dirección).
export const isDev = () => { try { return localStorage.getItem('hom:dev') === '1'; } catch { return false; } };
export const setDev = (on) => { try { on ? localStorage.setItem('hom:dev', '1') : localStorage.removeItem('hom:dev'); } catch { /* sin almacenamiento */ } };
try { const flag = new URLSearchParams(location.search).get('dev'); if (flag === '1') setDev(true); if (flag === '0') setDev(false); } catch { /* ignorar */ }

// Señal de cancelación de la operación en curso (botón detener). Las peticiones hechas mientras dura la operación la heredan.
export const activeSignal = { current: null };

export async function request(url, options = {}) {
  const response = await fetch(url, { signal: activeSignal.current ?? undefined, headers:{ 'content-type':'application/json', ...(isDev() ? { 'x-hom-dev':'1' } : {}) }, ...options });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || 'No se pudo completar la acción.'), { code:body.code });
  return body;
}

export function notify(message) {
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

export function period(hour) {
  if (hour < 4) return 'Medianoche'; if (hour < 6) return 'Madrugada'; if (hour < 8) return 'Amanecer';
  if (hour < 12) return 'Mañana'; if (hour < 14) return 'Mediodía'; if (hour < 18) return 'Tarde';
  if (hour < 21) return 'Atardecer'; return 'Noche';
}

export const clockText = (world) => `${String(world.hour).padStart(2,'0')}:${String(world.minute).padStart(2,'0')}`;
export const timeText = (world) => `Día ${world.day} · ${clockText(world)} · ${period(world.hour)}`;
export const place = (id) => state.world.locations.find((item) => item.id === id);
export function escapeHtml(value='') { const node=document.createElement('span'); node.textContent=value; return node.innerHTML.replace(/"/g, '&quot;'); }
