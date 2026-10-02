import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const savesDir = path.resolve('saves');
const idPattern = /^[0-9a-f-]{36}$/i;

export async function saveRun(run) {
  if (!idPattern.test(run.id)) throw new Error('ID de partida inválido.');
  await mkdir(savesDir, { recursive: true });
  const target = path.join(savesDir, `${run.id}.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(run, null, 2), 'utf8');
  await rename(temporary, target);
  return run;
}

export async function loadRun(id) {
  if (!idPattern.test(id)) throw new Error('ID de partida inválido.');
  try { return JSON.parse(await readFile(path.join(savesDir, `${id}.json`), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('Esa partida ya no existe.'), { status: 404, code: 'RUN_NOT_FOUND' });
    throw error;
  }
}

export async function deleteRun(id) {
  if (!idPattern.test(id)) throw new Error('ID de partida inválido.');
  await rm(path.join(savesDir, `${id}.json`), { force: true });
}

// Resumen de cada partida para el selector. Un archivo dañado se omite en vez de romper toda la lista.
export async function listRuns() {
  await mkdir(savesDir, { recursive: true });
  const files = (await readdir(savesDir)).filter((name) => name.endsWith('.json'));
  const runs = (await Promise.all(files.map(async (name) => {
    try { return JSON.parse(await readFile(path.join(savesDir, name), 'utf8')); } catch { return null; }
  }))).filter((run) => run?.id && run.player);
  return runs.map(summarizeRun).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function summarizeRun(run) {
  return {
    id: run.id, title: run.title || '', playerName: run.player.name, createdAt: run.createdAt, updatedAt: run.updatedAt,
    locationId: run.player.locationId, world: run.world, contacts: Object.values(run.relationships ?? {}).filter((item) => item.added).length,
    inConversation: Boolean(run.encounter)
  };
}
