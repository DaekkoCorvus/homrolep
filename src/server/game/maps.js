// Almacén de mapas (canon, esquema v2: datos en metros): data/canon/maps/<id>.json + imágenes de calco en assets/maps/. Lo usan las rutas de DESARROLLO del editor de mapas; el juego lee
// el catálogo con otra vía (hito 2). Todo se valida con el mismo módulo que usa el editor (src/shared/mapSchema.js).
import { mkdir, readdir, readFile, rename, rm, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeMap, validateMap, emptyMap } from '../../shared/mapSchema.js';
import { ID_PATTERN } from '../../shared/geo.js';
import { imageKind } from './cards.js';

export const MAX_MAP_IMAGE_BYTES = 24 * 1024 * 1024;

// Tamaño en píxeles de png, jpg o webp leyendo solo las cabeceras (sin librerías). null si no se puede leer.
export function imageSize(buffer) {
  const kind = imageKind(buffer);
  try {
    if (kind === 'png') return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (kind === 'jpg') {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
      return null;
    }
    if (kind === 'webp') {
      const chunk = buffer.toString('latin1', 12, 16);
      if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buffer.subarray(21, 25); return { width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) }; }
      if (chunk === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
  } catch { /* cabecera truncada */ }
  return null;
}

export function createMapStore({ dir, assetDir, backupLimit = 20 }) {
  const fileOf = (id) => path.join(dir, `${id}.json`);
  const backups = path.join(dir, '.backup');
  const checkId = (id) => { if (!ID_PATTERN.test(String(id))) throw Object.assign(new Error('Id de mapa no válido.'), { status: 400 }); return String(id); };

  async function read(id) {
    try { return normalizeMap(JSON.parse(await readFile(fileOf(checkId(id)), 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Ese mapa no existe.'), { status: 404, code: 'MAP_NOT_FOUND' }); throw error; }
  }

  async function ids() {
    try { return (await readdir(dir)).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).filter((id) => ID_PATTERN.test(id)).sort(); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  async function list() {
    const maps = [];
    for (const id of await ids()) {
      try { const map = await read(id); maps.push({ id, name: map.name, places: map.places.length, districts: map.districts.length, areas: map.areas.length, ways: map.ways.length, groups: map.groups.length }); } catch { /* archivo dañado: no se lista */ }
    }
    return maps;
  }

  // Ids de lugares y enlaces de los OTROS mapas: los ids son únicos en todo el juego.
  async function takenIds(exceptId) {
    const taken = new Set();
    for (const id of await ids()) {
      if (id === exceptId) continue;
      try { const map = await read(id); for (const place of map.places) taken.add(place.id); for (const link of map.links) taken.add(link.id); } catch { /* ignorado */ }
    }
    return taken;
  }

  async function pruneBackups(id) {
    try {
      const mine = (await readdir(backups)).filter((name) => name.startsWith(`${id}-`)).sort();
      for (const name of mine.slice(0, Math.max(0, mine.length - backupLimit))) await rm(path.join(backups, name), { force: true });
    } catch { /* sin copias */ }
  }

  // Valida y guarda. Un mapa con errores NO se guarda (el error lleva la lista de problemas para el editor); los avisos se devuelven y sí se guarda.
  // Antes de sobrescribir se conserva una copia con fecha en data/canon/maps/.backup/.
  async function save(id, input, context = {}) {
    checkId(id);
    const map = normalizeMap({ ...input, id });
    const result = validateMap(map, { ...context, takenIds: await takenIds(id) });
    if (!result.ok) throw Object.assign(new Error(`El mapa tiene ${result.errors.length} error${result.errors.length === 1 ? '' : 'es'} y no se guardó.`), { status: 400, code: 'MAP_INVALID', issues: { errors: result.errors, warnings: result.warnings } });
    await mkdir(dir, { recursive: true });
    let existed = true;
    try { await readFile(fileOf(id)); } catch { existed = false; }
    if (existed) {
      await mkdir(backups, { recursive: true });
      await copyFile(fileOf(id), path.join(backups, `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
      await pruneBackups(id);
    }
    await writeFile(`${fileOf(id)}.tmp`, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
    await rename(`${fileOf(id)}.tmp`, fileOf(id));
    return { map, warnings: result.warnings };
  }

  // Guarda una imagen de calco como assets/maps/<id>_<nombre>.<ext> (la anterior con el mismo nombre y otro formato se borra) y devuelve su tamaño real.
  async function saveImage(id, buffer, name = 'base') {
    checkId(id);
    if (!/^[a-z0-9]{1,20}$/.test(String(name))) throw Object.assign(new Error('Nombre de capa de calco no válido (letras minúsculas y números).'), { status: 400 });
    const kind = imageKind(buffer);
    if (!kind) throw new Error('La imagen debe ser PNG, WebP o JPG.');
    if (buffer.length > MAX_MAP_IMAGE_BYTES) throw new Error('La imagen es demasiado grande (máximo 24 MB).');
    const size = imageSize(buffer);
    if (!size || !(size.width > 0 && size.height > 0 && size.width <= 20000 && size.height <= 20000)) throw new Error('No se pudo leer el tamaño de la imagen.');
    await mkdir(assetDir, { recursive: true });
    for (const other of ['webp', 'png', 'jpg']) if (other !== kind) await rm(path.join(assetDir, `${id}_${name}.${other}`), { force: true });
    const file = `${id}_${name}.${kind}`;
    await writeFile(path.join(assetDir, `${file}.tmp`), buffer);
    await rename(path.join(assetDir, `${file}.tmp`), path.join(assetDir, file));
    return { file, width: size.width, height: size.height };
  }

  return { list, read, save, saveImage, takenIds, ids, create: (id, name) => emptyMap(checkId(id), name) };
}
