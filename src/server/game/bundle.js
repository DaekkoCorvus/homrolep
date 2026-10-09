import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { validateNpcCard, saveNpcCard, bestPortraitFiles, imageKind, EMOTION } from './cards.js';

// Paquete completo de personaje (`<id>.hom.json`): la ficha y todas las imágenes de sus emociones (base64) en un solo JSON, sin dependencias.
// No incluye datos de partida (relaciones, recuerdos, citas: son del save) ni `source/` (originales en alta).
export const BUNDLE_FORMAT = 'hom-character';
export const BUNDLE_VERSION = 1;
export const MAX_IMAGES = 60;
export const MAX_IMAGE_BYTES = 8_000_000;
// El cuerpo de la petición admite 45 MB (base64 pesa 4/3): 32 MB de imágenes reales caben con margen.
export const MAX_TOTAL_BYTES = 32_000_000;
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

// `card` es la ficha tal como está guardada. Los SVG no se exportan (podrían llevar scripts): se avisa en `warnings`.
export async function buildBundle(assetDir, card) {
  const images = {}; const warnings = [];
  for (const { emotion, ext, file } of await bestPortraitFiles(assetDir, card.id)) {
    if (ext === '.svg') { warnings.push(`La imagen «${emotion}» es un SVG y no se incluye en el paquete.`); continue; }
    const data = await readFile(file); const kind = imageKind(data);
    if (!kind) { warnings.push(`La imagen «${emotion}» no es un PNG, WebP o JPG válido y no se incluye.`); continue; }
    images[emotion] = { type: MIME[kind], data: data.toString('base64') };
  }
  const { portraits, warnings: ignored, ...clean } = card;
  return { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: new Date().toISOString(), card: clean, images, ...(warnings.length ? { warnings } : {}) };
}

// Un lugar que este mundo no conoce no hace fallar la importación: se sustituye por `fallback` (el lugar de inicio) y se avisa.
// Devuelve una copia; no modifica la ficha de entrada.
export function sanitizeLocations(card, locationIds, fallback) {
  const out = structuredClone(card); const warnings = []; const seen = new Set();
  const target = locationIds.includes(fallback) ? fallback : locationIds[0];
  const fix = (id) => {
    if (locationIds.includes(id)) return id;
    if (!seen.has(id)) { seen.add(id); warnings.push(`El lugar «${id}» no existe en este mundo: se usó «${target}».`); }
    return target;
  };
  if (Array.isArray(out.schedule)) for (const slot of out.schedule) if (slot && typeof slot === 'object') slot.locationId = fix(slot.locationId);
  if (typeof out.home === 'string' && out.home) out.home = fix(out.home);
  return { card: out, warnings };
}

// Lee y valida un paquete SIN escribir nada en disco. Devuelve la ficha validada, las imágenes ya decodificadas y los avisos.
export function parseBundle(raw, { locationIds, fallbackLocation }) {
  if (!raw || typeof raw !== 'object' || raw.format !== BUNDLE_FORMAT) throw new Error('El archivo no es un paquete de personaje (falta format: "hom-character").');
  if (!Number.isInteger(raw.version) || raw.version < 1) throw new Error('El paquete no indica una versión válida.');
  if (raw.version > BUNDLE_VERSION) throw new Error('Este personaje se exportó con una versión más nueva del juego. Actualiza el juego para poder importarlo.');
  if (!raw.card || typeof raw.card !== 'object' || Array.isArray(raw.card)) throw new Error('El paquete no contiene la ficha del personaje.');
  const source = raw.images ?? {};
  if (typeof source !== 'object' || Array.isArray(source)) throw new Error('El apartado de imágenes del paquete no es válido.');
  const names = Object.keys(source);
  if (names.length > MAX_IMAGES) throw new Error(`El paquete trae ${names.length} imágenes; el máximo es ${MAX_IMAGES}.`);
  if (names.length && !names.includes('default')) throw new Error('El paquete trae imágenes pero le falta la imagen «default».');
  const images = []; let total = 0;
  for (const emotion of names) {
    if (!EMOTION.test(emotion)) throw new Error(`«${emotion}» no es un nombre de emoción válido (solo letras minúsculas, hasta 20).`);
    const data = source[emotion]?.data;
    if (typeof data !== 'string' || data.length % 4 !== 0 || !BASE64.test(data)) throw new Error(`La imagen «${emotion}» no está codificada en base64 válido.`);
    const buffer = Buffer.from(data, 'base64');
    const kind = imageKind(buffer);   // el `type` declarado no se cree: manda lo que dicen los bytes
    if (!kind) throw new Error(`La imagen «${emotion}» no es un PNG, WebP o JPG válido.`);
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`La imagen «${emotion}» supera 8 MB.`);
    total += buffer.length;
    if (total > MAX_TOTAL_BYTES) throw new Error(`Las imágenes del paquete superan ${MAX_TOTAL_BYTES / 1_000_000} MB en total.`);
    images.push({ emotion, buffer, kind });
  }
  const { card: sanitized, warnings } = sanitizeLocations(raw.card, locationIds, fallbackLocation);
  return { card: validateNpcCard(sanitized, locationIds), images, warnings };
}

const exists = (file) => stat(file).then(() => true, () => false);

// Instalación atómica: las imágenes se escriben en una carpeta temporal y solo entonces sustituyen a las anteriores. Sobrescribir REEMPLAZA el
// conjunto completo de emociones (las que no vienen en el paquete desaparecen), pero `source/` (los originales del creador) se conserva siempre.
// Un paquete sin imágenes solo escribe la ficha y deja las existentes. Ante cualquier fallo todo vuelve a como estaba.
export async function installBundle({ npcDir, assetDir, card, images }) {
  if (!images.length) { await saveNpcCard(npcDir, card); return; }
  const root = path.join(assetDir, 'portraits');
  const token = randomUUID();
  const incoming = path.join(root, `.incoming-${token}`); const old = path.join(root, `.old-${token}`); const target = path.join(root, card.id);
  await mkdir(root, { recursive: true });
  try {
    await mkdir(incoming);
    for (const { emotion, buffer, kind } of images) await writeFile(path.join(incoming, `${emotion}.${kind}`), buffer);
  } catch (error) { await rm(incoming, { recursive: true, force: true }); throw error; }

  let movedOld = false; let movedSource = false; let installed = false;
  try {
    if (await exists(target)) {
      await rename(target, old); movedOld = true;
      if (await exists(path.join(old, 'source'))) { await rename(path.join(old, 'source'), path.join(incoming, 'source')); movedSource = true; }
    }
    await rename(incoming, target); installed = true;
    await saveNpcCard(npcDir, card);
  } catch (error) {
    // Deshacer en orden inverso: los originales vuelven a su carpeta, la nueva carpeta se descarta y la antigua recupera su nombre.
    const live = installed ? target : incoming;
    if (movedSource) await rename(path.join(live, 'source'), path.join(old, 'source')).catch(() => {});
    await rm(live, { recursive: true, force: true }).catch(() => {});
    if (movedOld) await rename(old, target).catch(() => {});
    throw error;
  }
  await rm(old, { recursive: true, force: true }).catch(() => {});
}
