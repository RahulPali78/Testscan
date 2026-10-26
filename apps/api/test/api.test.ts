import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exampleScenario, type DependencyStatus } from '@veriqo/contracts';
import { buildApi } from '../src/app.js';
import { buildReferenceApp, type FixtureMode } from '../src/reference-app.js';

const dependencies = (healthy: boolean): DependencyStatus[] =>
  (['postgres', 'temporal', 'coordinator', 'fixture'] as const).map((name) => ({
    name, status: healthy ? 'healthy' : 'unavailable', latency_ms: 1, message: 'Test observation',
  }));

test('process liveness does not manufacture dependency readiness', async () => {
  const app = buildApi({ probe: async () => dependencies(false) });
  try {
    assert.equal((await app.inject('/health/live')).statusCode, 200);
    const response = await app.inject('/health/ready');
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().overall_status, 'degraded');
    assert.equal((await app.inject('/v1/system')).json().dependencies.length, 4);
  } finally { await app.close(); }
});

test('schema validation crosses the API boundary without accepting invalid executable content', async () => {
  const app = buildApi({ probe: async () => dependencies(true) });
  try {
    assert.equal((await app.inject('/health/ready')).statusCode, 200);
    const valid = await app.inject({ method: 'POST', url: '/v1/scenarios/validate', payload: exampleScenario });
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.json().required_check_count, 3);
    const invalid = await app.inject({
      method: 'POST', url: '/v1/scenarios/validate',
      payload: { ...exampleScenario, executable_code: 'arbitrary code' },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().valid, false);
    for (const payload of [null, [], 'not-a-scenario', 42]) {
      const rejected = await app.inject({
        method: 'POST', url: '/v1/scenarios/validate',
        headers: { 'Content-Type': 'application/json' }, payload: JSON.stringify(payload),
      });
      assert.equal(rejected.statusCode, 400);
      assert.equal(rejected.json().valid, false);
    }
    assert.equal((await app.inject('/v1/capabilities')).json().application_classes.every(
      (value: { qualification: string }) => value.qualification === 'planned',
    ), true);
    const tooLarge = await app.inject({
      method: 'POST', url: '/v1/scenarios/validate', payload: { value: 'x'.repeat(70000) },
    });
    assert.equal(tooLarge.statusCode, 413);
  } finally { await app.close(); }
});

test('dependency errors do not expose connection strings or produce a healthy result', async () => {
  const app = buildApi({ probe: async () => { throw new Error('postgresql://private:secret@internal'); } });
  try {
    const response = await app.inject('/v1/system');
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.includes('secret'), false);
  } finally { await app.close(); }
});

test('missing dependency observations cannot pass readiness', async () => {
  const app = buildApi({ probe: async () => [] });
  try {
    assert.equal((await app.inject('/health/ready')).statusCode, 503);
  } finally { await app.close(); }
});

test('reference application exposes independent correct and seeded-fault state with isolated namespaces', async () => {
  const app = buildReferenceApp();
  const expected: Record<FixtureMode, number> = { correct: 1, 'missing-write': 0, 'duplicate-write': 2, 'wrong-tenant': 1 };
  try {
    for (const mode of Object.keys(expected) as FixtureMode[]) {
      const created = (await app.inject({ method: 'POST', url: '/fixtures', payload: { mode } })).json();
      const path = '/fixtures/' + created.namespace;
      const message = '<script>alert(1)</script> Create an urgent ticket';
      const invocation = await app.inject({ method: 'POST', url: path + '/agent', payload: { message } });
      assert.equal(invocation.statusCode, 200);
      const state = (await app.inject(path + '/state')).json();
      assert.equal(state.tickets.length, expected[mode]);
      assert.equal(state.tickets.every((ticket: { tenant_id: string }) => ticket.tenant_id === state.expected_tenant_id), mode !== 'wrong-tenant');
      const page = await app.inject(path);
      assert.equal(page.body.includes('<script>alert'), false);
      await app.inject({ method: 'DELETE', url: path });
      assert.equal((await app.inject(path + '/state')).statusCode, 404);
    }
  } finally { await app.close(); }
});
