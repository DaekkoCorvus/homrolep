// Diálogos propios del juego (etapa 6): sustituyen a confirm() y prompt() del navegador. Modales accesibles: foco atrapado, Escape cancela, el fondo queda
// inerte y el foco vuelve a donde estaba. Devuelven promesas: `askConfirm` → true/false, `askText` → el texto o null si se cancela.
import { escapeHtml } from './core.js';

function open({ title, text = '', body = '', actions }) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const layer = document.createElement('div');
    layer.className = 'mdl-layer';
    const id = `mdl-${Math.random().toString(36).slice(2, 8)}`;
    layer.innerHTML = `<div class="mdl" role="dialog" aria-modal="true" aria-labelledby="${id}-t" ${text ? `aria-describedby="${id}-d"` : ''}>
      <p class="mdl-mark" aria-hidden="true">✧</p><h2 id="${id}-t">${escapeHtml(title)}</h2>${text ? `<p id="${id}-d" class="mdl-text">${escapeHtml(text)}</p>` : ''}${body}
      <div class="mdl-actions">${actions.map((action, index) => `<button type="button" class="mdl-btn ${action.kind ?? ''}" data-index="${index}">${escapeHtml(action.label)}</button>`).join('')}</div></div>`;
    const behind = [...document.body.children].filter((node) => node !== layer && !node.inert && node.id !== 'toast');
    behind.forEach((node) => { node.inert = true; });
    document.body.append(layer);
    requestAnimationFrame(() => layer.classList.add('open'));
    const finish = (value) => {
      document.removeEventListener('keydown', onKey, true);
      behind.forEach((node) => { node.inert = false; });
      layer.classList.remove('open');
      setTimeout(() => layer.remove(), 180);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      resolve(value);
    };
    const focusables = () => [...layer.querySelectorAll('input, button')].filter((node) => !node.disabled);
    function onKey(event) {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); finish(actions.find((a) => a.kind === 'cancel')?.value ?? null); return; }
      if (event.key === 'Enter' && event.target.matches?.('input')) { event.preventDefault(); layer.querySelector('.mdl-btn.primary, .mdl-btn.danger')?.click(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables(); const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    layer.addEventListener('click', (event) => { if (event.target === layer) finish(actions.find((a) => a.kind === 'cancel')?.value ?? null); });
    layer.querySelectorAll('.mdl-btn').forEach((button) => { button.onclick = () => { const action = actions[Number(button.dataset.index)]; finish(typeof action.value === 'function' ? action.value(layer) : action.value); }; });
    // Lo destructivo empieza con el foco en «Cancelar»; el resto, en la acción principal (o el campo de texto).
    (layer.querySelector('input') ?? layer.querySelector(actions.some((a) => a.kind === 'danger') ? '.mdl-btn.cancel' : '.mdl-btn.primary') ?? layer.querySelector('.mdl-btn'))?.focus({ preventScroll: true });
  });
}

export const askConfirm = ({ title, text = '', confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false }) => open({
  title, text, actions: [{ label: cancelLabel, kind: 'cancel', value: false }, { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true }]
});

export const askText = ({ title, text = '', value = '', placeholder = '', confirmLabel = 'Guardar', cancelLabel = 'Cancelar', maxLength = 40 }) => open({
  title, text, body: `<input class="mdl-input" type="text" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" maxlength="${maxLength}" autocomplete="off" aria-label="${escapeHtml(title)}">`,
  actions: [{ label: cancelLabel, kind: 'cancel', value: null }, { label: confirmLabel, kind: 'primary', value: (layer) => layer.querySelector('.mdl-input').value }]
});
