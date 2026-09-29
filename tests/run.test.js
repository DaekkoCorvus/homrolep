import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, applyAction, addPost } from '../src/server/game/run.js';

const world = { locations: [
  { id:'apartment', travelMinutes:0 },
  { id:'cafe', travelMinutes:20 }
] };

test('createRun initializes a versioned state and event log', () => {
  const run = createRun({ name:'Mara', age:'24', occupation:'student', aspiration:'Comprender la ciudad' });
  assert.equal(run.version, 1);
  assert.equal(run.player.locationId, 'apartment');
  assert.equal(run.eventLog[0].type, 'run_started');
});

test('travel updates location, time and semantic event log', () => {
  const run = createRun({ name:'Mara', age:'24' });
  const moved = applyAction(run, { type:'travel', locationId:'cafe' }, world);
  assert.equal(moved.player.locationId, 'cafe');
  assert.deepEqual(moved.world, { day:1, hour:8, minute:20, cityId:'northfortress' });
  assert.equal(moved.eventLog.at(-1).type, 'location_changed');
});

test('social posts persist in state and create an event', () => {
  const run = addPost(createRun({ name:'Mara', age:'24' }), 'Primera mañana.');
  assert.equal(run.social.posts[0].text, 'Primera mañana.');
  assert.equal(run.eventLog.at(-1).type, 'social_post_created');
});
