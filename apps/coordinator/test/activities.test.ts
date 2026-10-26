import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createActivities } from '../src/activities.js';
import type { createPool } from '@veriqo/db';

test('the activity validates correlation identity before contacting dependencies', async () => {
  let queried = false;
  const pool = { query: async () => { queried = true; } } as unknown as ReturnType<typeof createPool>;
  const activities = createActivities(pool, 'http://127.0.0.1:1');
  await assert.rejects(activities.checkFoundation({ correlation_id: 'invalid' }));
  assert.equal(queried, false);
});
