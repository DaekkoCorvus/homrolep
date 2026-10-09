import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeStage } from '../../shared/stage.js';

// Fichas de NPC: validación, importación (nativa y formato «character card» de Tavern), retratos.
const ID = /^[a-z][a-z0-9_]{1,40}$/;
const HANDLE = /^@[A-Za-z0-9_]{2,24}$/;
const TIERS = new Set(['civil', 'menor', 'historico']);
export const RACES = ['humano', 'ophidiano', 'infernal', 'celestial', 'noid'];
const MAX_BACKGROUND = 200_000; // sin límite práctico para el jugador; solo un tope de seguridad

const text = (value, max, label, { required = false } = {}) => {
  const out = typeof value === 'string' ? value.trim() : '';
  if (required && !out) throw new Error(`Falta ${label}.`);
  if (out.length > max) throw new Error(`${label} supera ${max} caracteres.`);
  return out;
};
const list = (value, maxItems, maxLength, label) => {
  const items = (Array.isArray(value) ? value : typeof value === 'string' ? value.split('\n') : []).map((item) => String(item).trim()).filter(Boolean);
  if (items.length > maxItems) throw new Error(`${label} admite ${maxItems} elementos como máximo.`);
  if (items.some((item) => item.length > maxLength)) throw new Error(`Un elemento de ${label} supera ${maxLength} caracteres.`);
  return items;
};

const slug = (name) => String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// Usuario de contacto por defecto: «@LunaSerp».
export function defaultHandle(name) {
  const base = String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim()
    .split(' ').filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  return `@${base || 'Contacto'}`.slice(0, 25);
}

export function validateNpcCard(input, locationIds) {
  if (!input || typeof input !== 'object') throw new Error('La ficha no es un objeto válido.');
  const id = text(input.id, 41, 'el id', { required: true });
  if (!ID.test(id)) throw new Error('El id debe usar minúsculas, números y guiones bajos (empieza con letra).');
  const p = input.personality ?? {};
  const schedule = (Array.isArray(input.schedule) ? input.schedule : []).map((slot) => {
    const days = [...new Set((Array.isArray(slot?.days) ? slot.days : []).map(Number))].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
    const from = Number(slot?.from); const to = Number(slot?.to);
    if (!days.length) throw new Error('Cada horario necesita al menos un día (0 a 6).');
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 24 || from >= to) throw new Error('Cada horario necesita horas válidas (desde < hasta, entre 0 y 24).');
    if (!locationIds.includes(slot?.locationId)) throw new Error(`Lugar desconocido en el horario: ${slot?.locationId}.`);
    return { days, from, to, locationId: slot.locationId, activity: text(slot.activity, 80, 'la actividad') };
  });
  if (!schedule.length || schedule.length > 12) throw new Error('El NPC necesita entre 1 y 12 horarios.');
  const name = text(input.name, 60, 'el nombre', { required: true });
  const age = input.age === '' || input.age == null ? null : Number(input.age);
  if (age !== null && (!Number.isInteger(age) || age < 0 || age > 100000)) throw new Error('La edad debe ser un número entero.');
  const race = RACES.includes(input.race) ? input.race : 'humano';
  const handle = text(input.contact?.handle, 25, 'el usuario de contacto') || defaultHandle(name);
  if (!HANDLE.test(handle)) throw new Error('El usuario de contacto debe verse como @NombreUsuario (letras, números o _).');
  const connections = (Array.isArray(input.connections) ? input.connections : []).map((link) => ({
    npcId: text(link?.npcId, 41, 'el id del personaje conectado', { required: true }), relation: text(link?.relation, 80, 'la relación'), notes: text(link?.notes, 400, 'las notas de la conexión')
  }));
  if (connections.length > 30) throw new Error('Se admiten 30 conexiones como máximo.');
  if (connections.some((link) => link.npcId === id)) throw new Error('Un personaje no puede conectarse consigo mismo.');
  const stage = normalizeStage(input.stage);
  return {
    id, name, age, role: text(input.role, 120, 'el rol'), gender: text(input.gender, 30, 'el género'), race,
    tier: TIERS.has(input.tier) ? input.tier : 'civil',
    summary: text(input.summary ?? p.summary, 1500, 'el resumen', { required: true }),
    home: locationIds.includes(input.home) ? input.home : schedule[0].locationId,
    appearance: text(input.appearance, 4000, 'la apariencia'),
    clothingLikes: list(input.clothingLikes, 30, 140, 'las prendas que le agradan'),
    clothingDislikes: list(input.clothingDislikes, 30, 140, 'las prendas que evita'),
    personality: {
      traits: list(p.traits, 16, 60, 'los rasgos'),
      speech: text(p.speech, 1500, 'la forma de hablar'),
      likes: list(p.likes, 30, 140, 'los gustos'),
      dislikes: list(p.dislikes, 30, 140, 'lo que le desagrada'),
      boundaries: text(p.boundaries, 1500, 'los límites'),
      warmsUpWhen: text(p.warmsUpWhen, 1500, 'cuándo se abre'),
      coolsDownWhen: text(p.coolsDownWhen, 1500, 'cuándo se cierra'),
      loveLanguage: text(p.loveLanguage, 800, 'el lenguaje del amor')
    },
    exampleDialogue: text(input.exampleDialogue, 8000, 'los ejemplos de voz'),
    background: text(input.background, MAX_BACKGROUND, 'el trasfondo'),
    knowledge: list(input.knowledge, 60, 400, 'los conocimientos'),
    secrets: list(input.secrets, 30, 600, 'los secretos'),
    schedule, connections,
    // Emociones que no vuelven solas a la neutra: se quedan hasta que el GM ponga otra (escenas largas, sprites especiales).
    emotionsStay: list(input.emotionsStay, 60, 20, 'las emociones que se mantienen').map((name) => name.toLowerCase()).filter((name) => /^[a-z]{1,20}$/.test(name)),
    contact: { handle, conditions: list(input.contact?.conditions, 20, 500, 'las condiciones de contacto') },
    // Encuadre en escena (tamaño y posición por emoción); la clave solo existe si hay algo que guardar.
    ...(stage && { stage })
  };
}

// Mapeo best-effort de character cards v1/v2/v3 al formato del proyecto. La persona hay que revisarla a mano.
export function fromForeignCard(raw, defaultLocation) {
  const data = raw?.data ?? raw;
  const name = text(data?.name, 60, 'el nombre', { required: true });
  const description = text(data.description, MAX_BACKGROUND, 'la descripción');
  const personality = text(data.personality, 1500, 'la personalidad');
  return {
    id: /^[a-z]/.test(slug(name)) ? slug(name) : `npc_${slug(name)}`, name, role: 'Personaje importado', tier: 'civil', race: 'humano',
    summary: (personality || description).slice(0, 1500) || name,
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 8, to: 20, locationId: defaultLocation, activity: 'está por aquí' }],
    background: [description, data.scenario ? `Escenario: ${data.scenario}` : ''].filter(Boolean).join('\n\n'),
    exampleDialogue: text(data.mes_example, 8000, 'los ejemplos'),
    personality: { traits: [], speech: data.first_mes ? `Su primer saludo de referencia: ${String(data.first_mes).slice(0, 500)}` : '', likes: [], dislikes: [], boundaries: '', warmsUpWhen: '', coolsDownWhen: '', loveLanguage: '' },
    knowledge: [], secrets: [], contact: { conditions: ['Que el jugador se haya ganado su confianza.'] }
  };
}

// Las fichas PNG de Tavern guardan el JSON en base64 dentro de un chunk tEXt («chara» o «ccv3»).
export function parsePngCard(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(signature)) throw new Error('El archivo no es un PNG válido.');
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset); const type = buffer.toString('latin1', offset + 4, offset + 8);
    if (type === 'tEXt') {
      const body = buffer.subarray(offset + 8, offset + 8 + length); const split = body.indexOf(0);
      const key = body.toString('latin1', 0, split);
      if (key === 'chara' || key === 'ccv3') return JSON.parse(Buffer.from(body.toString('latin1', split + 1), 'base64').toString('utf8'));
    }
    offset += 12 + length;
  }
  throw new Error('El PNG no contiene una ficha de personaje incrustada.');
}

export function imageKind(buffer) {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length > 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg';
  return null;
}

// Si una emoción existe en varios formatos se sirve el más ligero: webp > png > jpg > svg.
const PORTRAIT_PRIORITY = ['.webp', '.png', '.jpg', '.jpeg', '.svg'];

// Nombre de emoción: solo letras minúsculas, sin acentos, espacios ni símbolos. Es el que usa el GM: {feliz}.
export const EMOTION = /^[a-z]{1,20}$/;
export const normalizeEmotion = (name) => String(name ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '').slice(0, 20);

export async function savePortrait(assetDir, npcId, buffer, emotion = 'default') {
  if (!ID.test(npcId)) throw new Error('Retrato inválido.');
  if (!EMOTION.test(emotion)) throw new Error('El nombre de la emoción debe tener solo letras (sin espacios, números ni símbolos).');
  const kind = imageKind(buffer);
  if (!kind) throw new Error('El retrato debe ser PNG, WebP o JPG.');
  if (buffer.length > 8_000_000) throw new Error('El retrato supera 8 MB.');
  const directory = path.join(assetDir, 'portraits', npcId);
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory)) if (path.parse(name).name === emotion) await rm(path.join(directory, name));
  await writeFile(path.join(directory, `${emotion}.${kind}`), buffer);
  return kind;
}

// La mejor imagen de cada emoción (la más ligera si hay varias): [{ emotion, name, ext, file }] ordenado por emoción. Sin carpeta, lista vacía.
export async function bestPortraitFiles(assetDir, npcId) {
  const directory = path.join(assetDir, 'portraits', npcId);
  const best = new Map();
  try {
    for (const name of await readdir(directory)) {
      const { name: emotion, ext } = path.parse(name);
      const rank = PORTRAIT_PRIORITY.indexOf(ext.toLowerCase());
      if (rank < 0 || !EMOTION.test(emotion)) continue;
      if (!best.has(emotion) || rank < best.get(emotion).rank) best.set(emotion, { rank, name });
    }
  } catch { return []; }
  return [...best].sort().map(([emotion, { name }]) => ({ emotion, name, ext: path.extname(name).toLowerCase(), file: path.join(directory, name) }));
}

// Devuelve {emotion: url}. `default` es el retrato base; el resto queda listo para cuando se añadan emociones.
export async function listPortraits(assetDir, npcId) {
  const out = {};
  try {
    for (const { emotion, name, file } of await bestPortraitFiles(assetDir, npcId)) out[emotion] = `/assets/portraits/${npcId}/${name}?v=${Math.round((await stat(file)).mtimeMs)}`;
  } catch { return {}; }
  return out;
}

const portraitFiles = async (directory, emotion) => (await readdir(directory).catch(() => [])).filter((name) => path.parse(name).name === emotion && PORTRAIT_PRIORITY.includes(path.parse(name).ext.toLowerCase()));

export async function removePortrait(assetDir, npcId, emotion) {
  if (!ID.test(npcId) || !EMOTION.test(emotion)) throw new Error('Retrato inválido.');
  if (emotion === 'default') throw new Error('El retrato por defecto no se puede eliminar; sube otro para reemplazarlo.');
  const directory = path.join(assetDir, 'portraits', npcId);
  const files = await portraitFiles(directory, emotion);
  if (!files.length) throw new Error('Esa emoción no existe.');
  for (const name of files) await rm(path.join(directory, name));
}

export async function renamePortrait(assetDir, npcId, from, to) {
  if (!ID.test(npcId) || !EMOTION.test(from) || !EMOTION.test(to)) throw new Error('El nombre de la emoción debe tener solo letras (sin espacios, números ni símbolos).');
  if (from === 'default' || to === 'default') throw new Error('El retrato por defecto no se puede renombrar.');
  const directory = path.join(assetDir, 'portraits', npcId);
  const files = await portraitFiles(directory, from);
  if (!files.length) throw new Error('Esa emoción no existe.');
  if ((await portraitFiles(directory, to)).length) throw Object.assign(new Error(`Ya existe una emoción llamada «${to}».`), { status: 409 });
  for (const name of files) await rename(path.join(directory, name), path.join(directory, `${to}${path.parse(name).ext}`));
}

export async function saveNpcCard(directory, card) {
  await writeFile(path.join(directory, `${card.id}.json`), `${JSON.stringify(card, null, 2)}\n`, 'utf8');
}

export async function readNpcCard(directory, id) {
  if (!ID.test(id)) throw new Error('Id de NPC inválido.');
  return JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8'));
}
