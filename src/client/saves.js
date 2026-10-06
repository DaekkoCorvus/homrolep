// Partidas como «libro de historias» (etapa 6): cada partida es una historia con su título, su momento y un botón Jugar; el resto (renombrar, duplicar,
// eliminar) vive en un menú «⋯» y lo destructivo pide una confirmación propia. Vive en el Umbral: tinta oscura sobre el vórtice.
import { state, app, request, notify, escapeHtml, place } from './core.js';
import { askConfirm, askText } from './dialogs.js';

const pad = (value) => String(value).padStart(2, '0');
const when = (iso) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

// deps: { onBack(), play(id), newGame() }
export async function openSaves({ onBack, play, newGame }) {
  let runs;
  try { runs = await request('/api/runs'); } catch (error) { notify(error.message); return; }
  const label = (run) => run.title || run.playerName;
  const story = (run) => {
    const here = place(run.locationId)?.name || run.locationId;
    const clock = `${pad(run.world.hour)}:${pad(run.world.minute)}`;
    const current = run.id === state.run?.id;
    const meta = [`Día ${run.world.day} · ${clock}`, here].filter(Boolean).join(' · ');
    const detail = [run.title ? run.playerName : '', when(run.updatedAt) ? `Última vez: ${when(run.updatedAt)}` : '', run.contacts ? `${run.contacts} contacto${run.contacts === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
    return `<li class="story${current ? ' current' : ''}" data-id="${run.id}"><div class="story-head"><h2>${escapeHtml(label(run))}</h2>${current ? '<span class="save-badge">en curso</span>' : ''}</div>
      <p class="story-meta">${escapeHtml(meta)}</p>${detail ? `<p class="story-detail">${escapeHtml(detail)}</p>` : ''}
      <div class="story-actions"><button type="button" class="umb-play" data-play>Jugar</button><button type="button" class="umb-more" data-more aria-haspopup="menu" aria-expanded="false" aria-label="Más opciones de «${escapeHtml(label(run))}»"><span aria-hidden="true">⋯</span></button></div>
      <div class="story-menu" role="menu" hidden><button type="button" role="menuitem" data-rename>Renombrar</button><button type="button" role="menuitem" data-copy>Duplicar</button><button type="button" role="menuitem" class="danger" data-delete>Eliminar…</button></div></li>`;
  };
  app.innerHTML = `<main class="threshold umb-page book"><section class="threshold-content umb-panel scene-enter"><p class="eyebrow">Tus historias</p><h1>Partidas</h1>${runs.length ? `<ol class="story-book">${runs.map(story).join('')}</ol>` : '<p class="umb-empty">Todavía no hay historias escritas. La primera te espera al otro lado.</p>'}<div class="umb-actions"><button type="button" class="umb-link" data-new>✧ Nueva partida</button><button type="button" class="umb-link" data-back>Volver</button></div></section></main>`;
  window.scrollTo(0, 0);
  const closeMenus = () => app.querySelectorAll('.story-menu:not([hidden])').forEach((menu) => { menu.hidden = true; menu.closest('.story').querySelector('[data-more]').setAttribute('aria-expanded', 'false'); });
  app.querySelector('[data-back]').onclick = () => onBack();
  app.querySelector('[data-new]').onclick = newGame;
  const refresh = () => openSaves({ onBack, play, newGame });
  const root = app.querySelector('.book');
  root.addEventListener('keydown', (event) => { if (event.key === 'Escape' && app.querySelector('.story-menu:not([hidden])')) { const open = app.querySelector('.story-menu:not([hidden])').closest('.story').querySelector('[data-more]'); closeMenus(); open.focus(); } });
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    if (!button) { closeMenus(); return; }
    const item = button.closest('.story');
    if (!item) return;
    const run = runs.find(({ id }) => id === item.dataset.id);
    const slot = (body) => request(`/api/runs/${run.id}/slot`, { method: 'POST', body: JSON.stringify(body) });
    try {
      if (button.matches('[data-more]')) {
        const menu = item.querySelector('.story-menu'); const wasOpen = !menu.hidden;
        closeMenus();
        if (!wasOpen) { menu.hidden = false; button.setAttribute('aria-expanded', 'true'); menu.querySelector('button').focus(); }
      } else if (button.matches('[data-play]')) {
        closeMenus(); await play(run.id);
      } else if (button.matches('[data-rename]')) {
        closeMenus();
        const title = await askText({ title: 'Nombre de la historia', text: 'Déjalo vacío para usar el nombre de tu personaje.', value: run.title || '', placeholder: run.playerName, maxLength: 40 });
        if (title === null) return;
        await slot({ op: 'rename', title });
        refresh();
      } else if (button.matches('[data-copy]')) {
        closeMenus();
        await slot({ op: 'duplicate' });
        notify('Historia duplicada.');
        refresh();
      } else if (button.matches('[data-delete]')) {
        closeMenus();
        if (!await askConfirm({ title: `¿Eliminar «${label(run)}»?`, text: 'Esta historia se borrará para siempre. No se puede deshacer.', confirmLabel: 'Eliminar', danger: true })) return;
        await request(`/api/runs/${run.id}`, { method: 'DELETE' });
        if (state.run?.id === run.id) state.run = null;
        try { if (localStorage.getItem('hom:lastRun') === run.id) localStorage.removeItem('hom:lastRun'); } catch { /* sin almacenamiento */ }
        notify('Historia eliminada.');
        refresh();
      }
    } catch (error) { notify(error.message); }
  });
}
