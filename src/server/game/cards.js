import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Fichas de NPC: validación, importación (nativa y formato «character card v2» de Tavern), retratos.
const ID = /^[a-z][a-z0-9_]{1,40}$/;
const TIERS = new Set(['civil', 'menor', 'historico']);

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
  const tier = TIERS.has(input.tier) ? input.tier : 'civil';
  const home = locationIds.includes(input.home) ? input.home : schedule[0].locationId;
  const card = {
    id, name: text(input.name, 60, 'el nombre', { required: true }), role: text(input.role, 120, 'el rol'), tier,
    status: text(input.status, 60, 'el estado') || 'draft',
    canonSource: text(input.canonSource, 800, 'la fuente canon'),
    home, schedule,
    background: text(input.background, 4000, 'el trasfondo'),
    exampleDialogue: text(input.exampleDialogue, 3000, 'los ejemplos de voz'),
    personality: {
      summary: text(p.summary, 900, 'el resumen de personalidad', { required: true }),
      traits: list(p.traits, 12, 40, 'los rasgos'),
      speech: text(p.speech, 700, 'la forma de hablar'),
      likes: list(p.likes, 14, 140, 'los gustos'),
      dislikes: list(p.dislikes, 14, 140, 'lo que le desagrada'),
      boundaries: text(p.boundaries, 700, 'los límites'),
      warmsUpWhen: text(p.warmsUpWhen, 500, 'cuándo se abre'),
      coolsDownWhen: text(p.coolsDownWhen, 500, 'cuándo se cierra')
    },
    knowledge: list(input.knowledge, 20, 240, 'los conocimientos'),
    secrets: list(input.secrets, 10, 300, 'los secretos'),
    contact: { method: text(input.contact?.method, 140, 'el medio de contacto'), offerWhen: text(input.contact?.offerWhen, 400, 'cuándo ofrece contacto') }
  };
  return card;
}

const slug = (name) => String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// Mapeo best-effort de character cards v1/v2/v3 al formato del proyecto. La persona hay que revisarla a mano.
export function fromForeignCard(raw, defaultLocation) {
  const data = raw?.data ?? raw;
  const name = text(data?.name, 60, 'el nombre', { required: true });
  const description = text(data.description, 4000, 'la descripción');
  const personality = text(data.personality, 900, 'la personalidad');
  return {
    id: /^[a-z]/.test(slug(name)) ? slug(name) : `npc_${slug(name)}`, name, role: 'Personaje importado', tier: 'civil', status: 'imported-needs-review',
    canonSource: 'Importado desde una ficha externa. Revisar horarios, lugar y personalidad.',
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: 8, to: 20, locationId: defaultLocation, activity: 'está por aquí' }],
    background: [description, data.scenario ? `Escenario: ${data.scenario}` : ''].filter(Boolean).join('\n\n').slice(0, 4000),
    exampleDialogue: text(data.mes_example, 3000, 'los ejemplos'),
    personality: { summary: (personality || description).slice(0, 900) || name, traits: [], speech: data.first_mes ? `Su primer saludo de referencia: ${String(data.first_mes).slice(0, 500)}` : '', likes: [], dislikes: [], boundaries: '', warmsUpWhen: '', coolsDownWhen: '' },
    knowledge: [], secrets: [], contact: { method: '', offerWhen: '' }
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

export async function savePortrait(assetDir, npcId, buffer, emotion = 'default') {
  if (!ID.test(npcId) || !/^[a-z][a-z0-9_-]{0,20}$/.test(emotion)) throw new Error('Retrato inválido.');
  const kind = imageKind(buffer);
  if (!kind) throw new Error('El retrato debe ser PNG, WebP o JPG.');
  if (buffer.length > 8_000_000) throw new Error('El retrato supera 8 MB.');
  const directory = path.join(assetDir, 'portraits', npcId);
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(directory)) if (path.parse(name).name === emotion) await rm(path.join(directory, name));
  await writeFile(path.join(directory, `${emotion}.${kind}`), buffer);
  return kind;
}

// Devuelve {emotion: url}. `default` es el retrato base; el resto queda listo para cuando se añadan emociones.
export async function listPortraits(assetDir, npcId) {
  const directory = path.join(assetDir, 'portraits', npcId);
  const best = new Map();
  try {
    for (const name of await readdir(directory)) {
      const { name: emotion, ext } = path.parse(name);
      const rank = PORTRAIT_PRIORITY.indexOf(ext.toLowerCase());
      if (rank < 0 || !/^[a-z][a-z0-9_-]{0,20}$/.test(emotion)) continue;
      if (!best.has(emotion) || rank < best.get(emotion).rank) best.set(emotion, { rank, name });
    }
    const out = {};
    for (const [emotion, { name }] of [...best].sort()) out[emotion] = `/assets/portraits/${npcId}/${name}?v=${Math.round((await stat(path.join(directory, name))).mtimeMs)}`;
    return out;
  } catch { return {}; } // sin carpeta: aún no hay retratos
}

export async function saveNpcCard(directory, card) {
  await writeFile(path.join(directory, `${card.id}.json`), `${JSON.stringify(card, null, 2)}\n`, 'utf8');
}

export async function readNpcCard(directory, id) {
  if (!ID.test(id)) throw new Error('Id de NPC inválido.');
  return JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8'));
}
