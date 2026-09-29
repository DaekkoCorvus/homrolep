import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, setPrologue, applyAction, addPost } from '../src/server/game/run.js';

const world = { locations: [
  { id:'apartment', travelMinutes:0 },
  { id:'cafe', travelMinutes:20 }
] };
const character = { name:'Mara', age:'24', gender:'woman', race:'human', origin:'Llegué a la ciudad buscando respuestas.' };

test('createRun initializes a versioned state and event log', () => {
  const run = createRun({ ...character, occupation:'worker', aspiration:'Comprender la ciudad' });
  assert.equal(run.version, 1);
  assert.equal(run.player.locationId, 'apartment');
  assert.equal(run.player.occupation, null);
  assert.equal(run.player.aspiration, null);
  assert.equal(run.eventLog[0].type, 'run_started');
});

test('character creation validates identity, race and backstory', () => {
  assert.throws(() => createRun({ ...character, gender:'custom' }), /género/);
  assert.throws(() => createRun({ ...character, race:'elf' }), /humano/);
  assert.equal(createRun({ ...character, origin:'' }).player.origin, '');
  assert.equal(createRun({ ...character, gender:'custom', genderCustom:'No binario' }).player.genderCustom, 'No binario');
});

test('prologue location is constrained by the world data', () => {
  const run = setPrologue(createRun(character), { text:'Una nueva llegada.', locationId:'unofficial', source:'ai' }, world);
  assert.equal(run.player.locationId, 'apartment');
  assert.equal(run.prologue.locationId, 'apartment');
  assert.equal(run.eventLog.at(-1).type, 'prologue_created');
});

test('travel updates location, time and semantic event log', () => {
  const run = createRun(character);
  const moved = applyAction(run, { type:'travel', locationId:'cafe' }, world);
  assert.equal(moved.player.locationId, 'cafe');
  assert.deepEqual(moved.world, { day:1, hour:8, minute:20, cityId:'northfortress' });
  assert.equal(moved.eventLog.at(-1).type, 'location_changed');
});

test('social posts persist in state and create an event', () => {
  const run = addPost(createRun(character), 'Primera mañana.');
  assert.equal(run.social.posts[0].text, 'Primera mañana.');
  assert.equal(run.eventLog.at(-1).type, 'social_post_created');
});

test('a new character cannot use the work shortcut before finding a job', () => {
  assert.throws(() => applyAction(createRun(character), { type:'work' }, world), /trabajo/);
});
