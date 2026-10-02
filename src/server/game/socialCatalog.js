// Datos locales de la red social que mantiene el equipo (no el modelo ni cada partida):
// - data/canon/social/accounts.json: cuentas canónicas con su popularidad y su imagen LOCAL (assets/social/...);
// - data/canon/social/avatars.json: URLs https de avatares aprobados para las cuentas aleatorias que registre el servidor.
// Se validan al leer. Un archivo ausente o dañado no rompe el juego: simplemente no aporta nada. Se vuelven a leer solos si cambian.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const HANDLE = /^@[A-Za-z0-9_]{3,20}$/;
const LOCAL_IMAGE = /^\/assets\/social\/[A-Za-z0-9_\-./]+\.(?:svg|png|webp|jpe?g)$/i;
export const MAX_AVATAR_URLS = 500;
const MAX_URL_LENGTH = 500;

// Acepta solo https absolutas y bien formadas; descarta vacías, repetidas (aunque cambien mayúsculas del dominio o un «/» final), con
// credenciales o con espacios. Devuelve las válidas y por qué se rechazó cada una (para el registro de desarrollo).
export function validateAvatarUrls(list) {
  const urls = []; const rejected = []; const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const reject = (reason) => rejected.push({ value: typeof raw === 'string' ? raw.slice(0, 80) : String(typeof raw), reason });
    if (typeof raw !== 'string') { reject('no es texto'); continue; }
    const value = raw.trim();
    if (!value) { reject('vacía'); continue; }
    if (value.length > MAX_URL_LENGTH || /\s/.test(value)) { reject('demasiado larga o con espacios'); continue; }
    let url;
    try { url = new URL(value); } catch { reject('mal formada'); continue; }
    if (url.protocol !== 'https:') { reject('solo se admite https'); continue; }
    if (!url.hostname || url.username || url.password) { reject('sin dominio o con credenciales'); continue; }
    const key = `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`;
    if (seen.has(key)) { reject('repetida'); continue; }
    if (urls.length >= MAX_AVATAR_URLS) { reject('el catálogo admite como máximo 500 URLs'); continue; }
    seen.add(key); urls.push(url.href);
  }
  return { urls, rejected };
}

// Cuentas canónicas: usuario, nombre, popularidad, verificación y una imagen local que debe existir en assets/social/.
export async function validateSeeds(list, assetDir) {
  const seeds = []; const warnings = []; const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const handle = typeof raw?.handle === 'string' ? raw.handle.trim() : '';
    if (!HANDLE.test(handle) || seen.has(handle.toLowerCase())) { warnings.push(`Cuenta canónica ignorada: ${String(raw?.handle).slice(0, 30)}`); continue; }
    seen.add(handle.toLowerCase());
    const seed = {
      handle, name: String(raw.name ?? handle.slice(1)).trim().slice(0, 30) || handle.slice(1),
      popularity: Math.min(100, Math.max(0, Math.round(Number(raw.popularity)) || 0)), verified: raw.verified === true, bio: String(raw.bio ?? '').trim().slice(0, 160)
    };
    if (raw.avatar !== undefined) {
      const local = typeof raw.avatar === 'string' && LOCAL_IMAGE.test(raw.avatar) && !raw.avatar.includes('..');
      const present = local && await stat(path.join(assetDir, raw.avatar.slice('/assets'.length))).then((info) => info.isFile(), () => false);
      if (present) seed.avatar = raw.avatar; else warnings.push(`${handle}: su imagen local no es válida o no existe (${String(raw.avatar).slice(0, 60)}); se usa el avatar de respaldo.`);
    }
    seeds.push(seed);
  }
  return { seeds, warnings };
}

const readJson = async (file) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { return error.code === 'ENOENT' ? null : { __error: error.message }; } };
const mtime = (file) => stat(file).then((info) => info.mtimeMs, () => 0);

// Catálogo vivo: `current()` es síncrono (última lectura buena); `refresh()` relee solo si cambió el archivo (como mucho cada `ttl` ms).
export function createSocialCatalog({ dir, assetDir, ttl = 2000 }) {
  const files = { accounts: path.join(dir, 'accounts.json'), avatars: path.join(dir, 'avatars.json') };
  let snapshot = { seeds: [], avatars: [], avatarSet: new Set(), warnings: [] };
  let stamps = null; let checked = 0;
  async function load() {
    const warnings = [];
    const accountsJson = await readJson(files.accounts); const avatarsJson = await readJson(files.avatars);
    if (accountsJson?.__error) warnings.push(`accounts.json no se pudo leer: ${accountsJson.__error}`);
    if (avatarsJson?.__error) warnings.push(`avatars.json no se pudo leer: ${avatarsJson.__error}`);
    const seeds = await validateSeeds(accountsJson?.accounts, assetDir);
    const list = Array.isArray(avatarsJson) ? avatarsJson : avatarsJson?.avatars;
    const avatars = validateAvatarUrls(list);
    warnings.push(...seeds.warnings, ...avatars.rejected.map((item) => `Avatar rechazado (${item.reason}): ${item.value}`));
    snapshot = { seeds: seeds.seeds, avatars: avatars.urls, avatarSet: new Set(avatars.urls), warnings };
  }
  return {
    current: () => snapshot,
    async refresh(force = false) {
      const now = Date.now();
      if (!force && stamps && now - checked < ttl) return snapshot;
      checked = now;
      const next = [await mtime(files.accounts), await mtime(files.avatars)].join(':');
      if (force || next !== stamps) { stamps = next; await load(); }
      return snapshot;
    }
  };
}
