import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
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
  return JSON.parse(await readFile(path.join(savesDir, `${id}.json`), 'utf8'));
}

export async function listRuns() {
  await mkdir(savesDir, { recursive: true });
  const files = (await readdir(savesDir)).filter((name) => name.endsWith('.json'));
  const runs = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(savesDir, name), 'utf8'))));
  return runs.map(({ id, updatedAt, player, world }) => ({ id, updatedAt, playerName: player.name, locationId: player.locationId, world }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
