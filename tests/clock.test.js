import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTime, dayPeriod, timeKey } from '../src/server/game/clock.js';

test('advanceTime crosses midnight without losing minutes', () => {
  assert.deepEqual(advanceTime({ day:1, hour:23, minute:50 }, 20), { day:2, hour:0, minute:10 });
});

test('time helpers create semantic values', () => {
  assert.equal(timeKey({ day:2, hour:7, minute:5 }), 'DAY_2_07:05');
  assert.equal(dayPeriod(7), 'Amanecer');
  assert.equal(dayPeriod(22), 'Noche');
});
