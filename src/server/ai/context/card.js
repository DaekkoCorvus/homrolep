// Ficha del personaje en DOS capas (broker de contexto, Fase 4).
//   · core: lo que define a la persona y va SIEMPRE (nombre, rol, resumen, personalidad y voz).
//   · deep: trasfondo, apariencia, conocimientos, secretos, conexiones y gustos de ropa, troceados en entradas cortas. Solo entran en el prompt
//     las que vienen al caso, elegidas por el MOTOR con palabras clave de lo que se está hablando (estilo world-info de SillyTavern), o las que
//     el personaje pide a propósito con la herramienta `recall`. Así una ficha larga (o un lorebook entero en el trasfondo) no se paga en cada turno.
import { normalize } from '../../game/npcs.js';

export const DEEP_MAX_ENTRIES = 4;     // entradas profundas por turno
export const DEEP_MAX_CHARS = 1100;    // tope de caracteres de esas entradas
export const CHUNK_CHARS = 420;        // tamaño máximo de una entrada
const MIN_WORD = 5;                    // palabras cortas («de», «que», «para») no sirven como disparador
const STEM = 5;                        // «cabello»/«cabellos» → «cabel»: una raíz fija tolera plurales y conjugaciones

// Capa siempre presente.
export const coreOf = (npc) => ({
  nombre: npc.name, edad: npc.age, genero: npc.gender, raza: npc.race, rol: npc.role, resumen: npc.summary,
  personalidad: npc.personality, ejemplosDeVoz: npc.exampleDialogue
});

// Trocea un texto largo respetando párrafos y frases, para que cada entrada trate de una sola cosa.
function chunks(text, max = CHUNK_CHARS) {
  const out = [];
  for (const paragraph of String(text ?? '').split(/\n{1,}/).map((part) => part.trim()).filter(Boolean)) {
    if (paragraph.length <= max) { out.push(paragraph); continue; }
    let current = '';
    for (const sentence of paragraph.split(/(?<=[.!?…])\s+/)) {
      if (current && current.length + sentence.length + 1 > max) { out.push(current); current = ''; }
      current = current ? `${current} ${sentence}` : sentence;
      while (current.length > max * 1.5) { out.push(current.slice(0, max)); current = current.slice(max); } // frase sin puntos
    }
    if (current) out.push(current);
  }
  return out;
}

// Todas las entradas de la capa profunda de una ficha: { section, text }.
export function deepEntries(npc) {
  const entries = [];
  const add = (section, items) => { for (const text of items) if (String(text ?? '').trim()) entries.push({ section, text: String(text).trim() }); };
  add('trasfondo', chunks(npc.background));
  add('apariencia', chunks(npc.appearance));
  add('conocimientos', npc.knowledge ?? []);
  add('secretos', npc.secrets ?? []);
  add('conexiones', (npc.connections ?? []).map((link) => `${link.relation ? `${link.relation}: ` : ''}${link.notes ?? ''} (${link.npcId})`.trim()));
  add('ropa', [...(npc.clothingLikes?.length ? [`Prendas que te agradan: ${npc.clothingLikes.join('; ')}`] : []), ...(npc.clothingDislikes?.length ? [`Prendas que evitas: ${npc.clothingDislikes.join('; ')}`] : [])]);
  return entries;
}

// Raíces de las palabras con contenido de un texto.
// Palabras muy corrientes que, aun largas, no dicen de qué se habla («buenas», «gracias», «quiero»…): no son disparadores.
const COMMON = ('buena buenas bueno buenos gracias claro entonces porque quiero quieres queria tengo tienes tiene puedo puedes puede pueden estoy estas esta estamos '
  + 'ahora siempre nunca tambien algo alguien alguna algun nada todo toda todos todas cuando donde sobre desde hasta entre mucho mucha muchos poco pocas pocos '
  + 'cosas cosa hacer hacen hace vamos vale bien dime dile digo dice dijo mismo misma otra otro otras otros ademas aunque pues luego antes despues aqui ahi '
  + 'saber sabes sabia mejor peor pasa pasar veces vez dias noche tarde manana hoy ayer momento rato primero segundo tiempo gusta gustaria seria eres somos soy fue').split(' ');
const STOP = new Set(COMMON.map((word) => word.slice(0, STEM)));
export function stems(text) {
  return new Set(normalize(text).split(' ').filter((word) => word.length >= MIN_WORD).map((word) => word.slice(0, STEM)).filter((stem) => !STOP.has(stem)));
}

// Elige las entradas cuyo texto comparte raíces con `query`. Orden: más coincidencias primero y, a igualdad, el orden de la ficha.
// Devuelve { section, text } con el tope de entradas y de caracteres.
export function selectDeep(entries, query, { max = DEEP_MAX_ENTRIES, maxChars = DEEP_MAX_CHARS } = {}) {
  const wanted = stems(query);
  if (!wanted.size) return [];
  const scored = entries.map((entry, index) => {
    let hits = 0; for (const stem of stems(`${entry.section} ${entry.text}`)) if (wanted.has(stem)) hits += 1;
    return { entry, index, hits };
  }).filter((item) => item.hits > 0).sort((a, b) => b.hits - a.hits || a.index - b.index);
  const picked = []; let size = 0;
  for (const { entry } of scored) {
    if (picked.length >= max) break;
    if (size + entry.text.length > maxChars && picked.length) continue;
    picked.push(entry); size += entry.text.length;
  }
  return picked;
}

// Texto del que salen los disparadores de un turno: lo último que dijo el jugador y lo último que dijo el propio personaje.
export function queryFrom(transcript = [], intent = '') {
  const players = transcript.filter((line) => line.who === 'player').slice(-2).map((line) => line.text);
  const npc = transcript.filter((line) => line.who === 'npc').slice(-1).map((line) => line.text);
  return [...players, ...npc, intent].filter(Boolean).join(' ');
}

// Forma que ve el personaje: agrupadas por sección, sin ids internos.
export function deepView(selected) {
  if (!selected.length) return undefined;
  const view = {};
  for (const { section, text } of selected) (view[section] ??= []).push(text);
  return view;
}
