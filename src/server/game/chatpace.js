// Chat en ráfagas: el jugador manda los mensajes que quiera y, con el botón de turno, el personaje responde con uno o varios mensajes en UNA sola
// llamada al modelo. El modelo escribe una línea por mensaje; el MOTOR decide el ritmo (cuánto tarda en «ver» el chat y en «escribir» cada
// mensaje): la IA solo puede pedir «más despacio» o «más rápido» dentro de límites. Todo es determinista y no toca el estado de la partida.
import { scheduleFor, affinityOf } from './npcs.js';

export const MAX_BURST = 4;            // mensajes por respuesta; lo que sobre se une al último
export const MAX_MESSAGE_CHARS = 600;
export const MAX_UNANSWERED = 8;       // mensajes del jugador sin turno pasado
const PACE = { slow: 1.7, fast: 0.5 };
const LINE_TAG = /^\s*\{\s*(pausa|lento|rapido|rápido|re\s*:\s*\d{1,4})\s*\}\s*/i;

// El texto de una respuesta de chat → [{ text, pace, re }]. Cada línea no vacía es un mensaje. Al principio de una línea puede haber marcas, en cualquier
// orden: {pausa}/{lento} y {rapido} piden ritmo, y {re:N} responde al mensaje número N de la conversación (el `n` que ve el personaje).
export function splitBurst(raw) {
  const messages = [];
  for (const line of String(raw ?? '').split(/\n+/)) {
    let text = line; let pace = null; let re = null;
    for (let tag = LINE_TAG.exec(text); tag; tag = LINE_TAG.exec(text)) {
      if (/^re/i.test(tag[1])) re = Number(tag[1].replace(/\D/g, '')); else pace = /^r/i.test(tag[1]) ? 'fast' : 'slow';
      text = text.slice(tag[0].length);
    }
    text = text.replace(/\{[^}]*\}/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_MESSAGE_CHARS);
    if (text) messages.push({ text, pace, re });
  }
  if (messages.length > MAX_BURST) {
    const rest = messages.splice(MAX_BURST - 1);
    messages.push({ text: rest.map((item) => item.text).join(' ').slice(0, MAX_MESSAGE_CHARS), pace: rest[0].pace, re: rest[0].re });
  }
  return messages;
}

// Cuánto «escribe» el personaje un mensaje (milisegundos de reloj real): proporcional a su largo, con topes.
export function typingMs(text, pace = null) {
  const base = Math.min(3600, Math.max(800, String(text).length * 38));
  return Math.round(Math.min(5000, Math.max(450, base * (PACE[pace] ?? 1))));
}

// Cuánto tarda en «ver» el chat (milisegundos de reloj real, tope 6 s): más si está ocupado o es de madrugada, menos si hay confianza.
export function readMs(npc, relationship, world) {
  let ms = 800;
  if (scheduleFor(npc, world)) ms += 1200;           // está en su turno: contesta entre tarea y tarea
  else ms += 500;
  if (world.hour < 6 || world.hour >= 23) ms += 3000; // de noche tarda más en ver el teléfono
  if (affinityOf(relationship.notes ?? []) >= 5) ms -= 400;
  return Math.min(6000, Math.max(600, ms));
}

// Resumen corto de un mensaje para citarlo (una sola línea, sin saltos): la interfaz nunca recibe el mensaje entero.
export const QUOTE_CHARS = 100;
export const quoteText = (text) => { const clean = String(text ?? '').replace(/\s+/g, ' ').trim(); return clean.length > QUOTE_CHARS ? `${clean.slice(0, QUOTE_CHARS - 1)}…` : clean; };

// Los mensajes guardados antes de existir las respuestas directas no tienen id: se les da uno estable (su posición).
export function ensureChatIds(run) {
  for (const messages of Object.values(run.chats ?? {})) messages.forEach((message, index) => { message.id ??= `m${index}`; });
  return run;
}
