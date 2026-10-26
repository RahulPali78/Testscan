import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client, Connection } from '@temporalio/client';
import { createPool } from '@veriqo/db';
import { migrate } from '../../../packages/db/src/migrations.js';
import { exampleScenario, SystemSnapshotSchema, type FoundationProbeResult } from '@veriqo/contracts';

const options = { skip: process.env.VERIQO_INTEGRATION !== '1' };
test('real PostgreSQL migrations are repeatable and checksummed', options, async () => {
  const pool = createPool();
  try {
    assert.deepEqual(await migrate(pool), []);
    const result = await pool.query('SELECT name, checksum FROM schema_migrations');
    assert.ok(result.rows.length > 0);
  } finally { await pool.end(); }
});

test('the API observes live dependencies and validates through the HTTP boundary', options, async () => {
  const url = process.env.VERIQO_API_URL ?? 'http://127.0.0.1:4000';
  const ready = await fetch(new URL('/health/ready', url));
  assert.equal(ready.status, 200);
  const snapshot = SystemSnapshotSchema.parse(await ready.json());
  assert.equal(snapshot.overall_status, 'healthy');
  assert.equal(snapshot.dependencies.length, 4);
  const response = await fetch(new URL('/v1/scenarios/validate', url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exampleScenario),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { valid: boolean }).valid, true);
});

test('a real Temporal workflow calls the worker activity against PostgreSQL and the reference app', options, async () => {
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233' });
  try {
    const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' });
    const correlationId = randomUUID();
    const result = await client.workflow.execute('foundationProbeWorkflow', {
      args: [{ correlation_id: correlationId }],
      taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'veriqo-foundation',
      workflowId: 'foundation-probe-' + correlationId,
      workflowExecutionTimeout: '15 seconds',
    }) as FoundationProbeResult;
    assert.equal(result.correlation_id, correlationId);
    assert.equal(result.database, 'healthy');
    assert.equal(result.fixture, 'healthy');
    assert.ok(Number.isFinite(Date.parse(result.checked_at)));
  } finally { await connection.close(); }
});
