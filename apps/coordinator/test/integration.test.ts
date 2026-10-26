import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client, Connection } from '@temporalio/client';
import { createPool } from '@veriqo/db';
import { migrate } from '../../../packages/db/src/migrations.js';
import { exampleScenario, SystemSnapshotSchema, type FoundationProbeResult } from '@veriqo/contracts';
import { referenceScenario, RunDetailSchema } from '@veriqo/contracts/product';
import { ProductStore, digest, hashData } from '@veriqo/db/product';
import { ExecutionStore } from '@veriqo/db/execution';
import { DEVELOPMENT_PROJECTS } from '@veriqo/db/development';

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
    method: 'POST', headers: { 'Content-Type': 'application/json', authorization: 'Bearer ' + await developmentToken(url) }, body: JSON.stringify(exampleScenario),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { valid: boolean }).valid, true);
});

async function developmentToken(url: string, account = 'developer') {
  const response = await fetch(new URL('/v1/auth/development', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: account }) });
  assert.equal(response.status, 200);
  return (await response.json() as { access_token: string }).access_token;
}

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

const apiUrl = process.env.VERIQO_API_URL ?? 'http://127.0.0.1:4000';
async function call(token: string, path: string, method = 'GET', body?: unknown, key?: string) {
  const response = await fetch(new URL('/v1/' + path, apiUrl), { method, headers: {
    authorization: 'Bearer ' + token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(key ? { 'idempotency-key': key } : {}),
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() as any };
}
async function waitRun(token: string, runId: string) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const result = await call(token, 'runs/' + runId);
    assert.equal(result.status, 200);
    const detail = RunDetailSchema.parse(result.body);
    if (['FINISHED', 'ERROR', 'CANCELLED'].includes(detail.run.execution_status)) return detail;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.fail('Run did not terminate within the integration deadline');
}

test('real persistence enforces roles, tenant boundaries, immutable versions/manifests and revocable hashed service tokens', options, async () => {
  const owner = await developmentToken(apiUrl), other = await developmentToken(apiUrl, 'second-owner'), viewer = await developmentToken(apiUrl, 'viewer');
  const alpha = DEVELOPMENT_PROJECTS.alpha.projectId;
  assert.equal((await call(other, 'projects/' + alpha + '/runs')).status, 404);
  assert.equal((await call(viewer, 'projects/' + alpha + '/scenarios', 'POST', { scenario: referenceScenario })).status, 403);
  const workspace = await call(owner, 'workspaces', 'POST', { name: 'Isolation ' + randomUUID() });
  assert.equal(workspace.status, 201);
  const projectId = workspace.body.id;
  const published = await call(owner, 'projects/' + projectId + '/scenarios', 'POST', { scenario: referenceScenario });
  assert.equal(published.status, 201);
  const version = published.body;
  assert.equal((await call(other, 'scenarios/' + version.scenario_id + '/versions')).status, 404);
  const changed = { ...referenceScenario, scenario_id: 'other-name' };
  assert.equal((await call(other, 'scenarios/' + version.scenario_id + '/versions', 'POST', { scenario: changed })).status, 404);
  assert.equal((await call(owner, 'projects/' + projectId + '/scenarios', 'POST', { scenario: exampleScenario })).status, 422);
  const second = await call(owner, 'scenarios/' + version.scenario_id + '/versions', 'POST', { scenario: referenceScenario });
  assert.equal(second.body.version_number, 2);
  const created = await call(owner, 'projects/' + projectId + '/tokens', 'POST', { name: 'Integration CI', role: 'editor' });
  assert.equal(created.status, 200);
  const service = created.body.token;
  assert.equal((await call(service, 'projects/' + projectId + '/scenarios', 'POST', { scenario: referenceScenario })).status, 403);
  assert.equal((await call(service, 'workspaces', 'POST', { name: 'Forbidden' })).status, 403);
  const pool = createPool();
  try {
    const stored = await pool.query('SELECT token_hash FROM project_tokens WHERE id=$1', [created.body.id]);
    assert.equal(stored.rows[0].token_hash, digest(service)); assert.notEqual(stored.rows[0].token_hash, service);
    await assert.rejects(pool.query('UPDATE scenario_versions SET definition=$2 WHERE id=$1', [version.id, '{}']), /immutable/);
    const key = randomUUID(), input = { scenario_version_id: version.id, fixture_mode: 'correct' };
    const submitted = await call(service, 'projects/' + projectId + '/runs', 'POST', input, key);
    assert.equal(submitted.status, 202);
    const runId = submitted.body.id;
    assert.equal((await call(service, 'projects/' + projectId + '/runs', 'POST', input, key)).body.id, runId);
    assert.equal((await call(service, 'projects/' + projectId + '/runs', 'POST', { ...input, fixture_mode: 'wrong-tenant' }, key)).status, 409);
    for (const suffix of ['', '/events', '/export']) assert.equal((await call(other, 'runs/' + runId + suffix)).status, 404);
    for (const suffix of ['/cancel', '/cleanup']) assert.equal((await call(other, 'runs/' + runId + suffix, 'POST', {})).status, 404);
    await assert.rejects(pool.query("UPDATE runs SET manifest='{}' WHERE id=$1", [runId]), /immutable/);
    await waitRun(owner, runId);
    assert.equal((await call(owner, 'projects/' + projectId + '/tokens/' + created.body.id, 'DELETE')).status, 204);
    assert.equal((await call(service, 'projects/' + projectId + '/runs')).status, 401);
  } finally { await pool.end(); }
});

test('durable reference runs verify correct, missing, duplicate and cross-tenant writes and clean every namespace', options, async () => {
  const owner = await developmentToken(apiUrl);
  const project = (await call(owner, 'workspaces', 'POST', { name: 'Execution ' + randomUUID() })).body;
  const version = (await call(owner, 'projects/' + project.id + '/scenarios', 'POST', { scenario: referenceScenario })).body;
  for (const mode of ['correct', 'missing-write', 'duplicate-write', 'wrong-tenant']) {
    const submitted = await call(owner, 'projects/' + project.id + '/runs', 'POST', { scenario_version_id: version.id, fixture_mode: mode }, randomUUID());
    assert.equal(submitted.status, 202);
    const detail = await waitRun(owner, submitted.body.id);
    assert.equal(detail.run.execution_status, 'FINISHED');
    assert.equal(detail.run.verdict, mode === 'correct' ? 'PASS' : 'FAIL');
    assert.equal(detail.run.cleanup_status, 'COMPLETE');
    assert.equal(detail.candidate_attested, true);
    assert.ok(detail.evidence.some((item) => item.kind === 'agent-response'));
    const evidenceIds = new Set(detail.evidence.map((item) => item.id));
    for (const assertion of detail.assertions) for (const ref of assertion.evidence_refs) assert.ok(evidenceIds.has(ref));
    assert.equal(detail.assertions.length, 3);
    if (mode === 'correct') {
      const states = detail.evidence.filter((item) => item.kind === 'state-observation');
      assert.ok(Date.parse(states.at(-1)!.occurred_at) - Date.parse(states[0]!.occurred_at) >= 2900);
    }
    const fixture = process.env.FIXTURE_URL ?? 'http://127.0.0.1:4100';
    assert.equal((await fetch(new URL('/fixtures/' + detail.run.id + '/state', fixture))).status, 404);
    assert.equal(detail.manifest.scenario_hash, version.definition_hash);
    assert.equal(detail.manifest_hash, hashData(detail.manifest));
  }
  const cancelled = (await call(owner, 'projects/' + project.id + '/runs', 'POST', { scenario_version_id: version.id }, randomUUID())).body;
  await call(owner, 'runs/' + cancelled.id + '/cancel', 'POST', {});
  const detail = await waitRun(owner, cancelled.id);
  assert.equal(detail.run.execution_status, 'CANCELLED');
  assert.notEqual(detail.run.verdict, 'PASS');
  assert.ok(['NOT_REQUIRED', 'COMPLETE'].includes(detail.run.cleanup_status));
  const running = (await call(owner, 'projects/' + project.id + '/runs', 'POST', { scenario_version_id: version.id }, randomUUID())).body;
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const run = (await call(owner, 'runs/' + running.id)).body;
    if (run.run.execution_status === 'EVALUATING') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await call(owner, 'runs/' + running.id + '/cancel', 'POST', {});
  const stopped = await waitRun(owner, running.id);
  assert.equal(stopped.run.execution_status, 'CANCELLED');
  assert.notEqual(stopped.run.verdict, 'PASS');
  assert.equal(stopped.run.cleanup_status, 'COMPLETE');
});

test('concurrent admission stays bounded; stale worker completions and missing evidence cannot pass; cleanup failure blocks reuse', options, async () => {
  const owner = await developmentToken(apiUrl);
  const project = (await call(owner, 'workspaces', 'POST', { name: 'Reliability ' + randomUUID() })).body;
  const version = (await call(owner, 'projects/' + project.id + '/scenarios', 'POST', { scenario: referenceScenario })).body;
  const admitted = await Promise.all(Array.from({ length: 6 }, () => call(owner, 'projects/' + project.id + '/runs', 'POST', { scenario_version_id: version.id }, randomUUID())));
  assert.equal(admitted.filter((item) => item.status === 202).length, 5);
  assert.equal(admitted.filter((item) => item.status === 429).length, 1);
  for (const item of admitted.filter((item) => item.status === 202)) await call(owner, 'runs/' + item.body.id + '/cancel', 'POST', {});
  for (const item of admitted.filter((item) => item.status === 202)) await waitRun(owner, item.body.id);
  const pool = createPool();
  try {
    const source = (await call(owner, 'runs/' + admitted.find((item) => item.status === 202)!.body.id)).body;
    const runId = randomUUID(), manifest = structuredClone(source.manifest);
    manifest.identity.run_id = runId;
    await assert.rejects(pool.query('INSERT INTO runs(id,organisation_id,project_id,scenario_version_id,manifest,manifest_hash,idempotency_key,request_hash,created_by_user) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [randomUUID(), DEVELOPMENT_PROJECTS.beta.organisationId, DEVELOPMENT_PROJECTS.beta.projectId, version.id, JSON.stringify(manifest), hashData(manifest), randomUUID(), hashData({}), '10000000-0000-4000-8000-000000000001']),
      (error: unknown) => (error as { code?: string }).code === '23503');
    // Exercise internal recovery without dispatching an external business action.
    await pool.query('INSERT INTO runs(id,organisation_id,project_id,scenario_version_id,manifest,manifest_hash,idempotency_key,request_hash,created_by_user) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [runId, project.organisation_id, project.id, version.id, JSON.stringify(manifest), hashData(manifest), randomUUID(), hashData({}), '10000000-0000-4000-8000-000000000001']);
    const execution = new ExecutionStore(pool);
    const claim = await execution.claim(runId); assert.ok(claim);
    assert.equal(await execution.claim(runId), null);
    await execution.stage(runId, claim.attempt, 'RUNNING', true);
    const evidence = await execution.evidence(runId, claim.attempt, 'state-observation', 'test-observer', { count: 1 });
    await execution.record(runId, claim.attempt, [{ check_id: 'one-ticket', outcome: 'PASS', required: true, severity: 'critical', expected: { count: 1 }, observed: { count: 1 }, evidence_refs: [evidence] }], true);
    await assert.rejects(pool.query('DELETE FROM run_evidence WHERE id=$1', [evidence]), /immutable/);
    const cleanup = await execution.beginCleanup(runId, true); assert.ok(cleanup);
    await assert.rejects(execution.evidence(runId, claim.attempt, 'late-success', 'stale-worker', {}), /fenced/);
    await execution.cleanupResult(runId, cleanup.attempt, false, true);
    await execution.finish(runId);
    const result = await waitRun(owner, runId);
    assert.equal(result.run.execution_status, 'ERROR');
    assert.equal(result.run.verdict, 'INCONCLUSIVE');
    assert.equal(result.run.cleanup_status, 'FAILED');
    assert.equal((await call(owner, 'projects/' + project.id + '/runs', 'POST', { scenario_version_id: version.id }, randomUUID())).body.code, 'CLEANUP_REQUIRED');
    await call(owner, 'runs/' + runId + '/cleanup', 'POST', {});
    const deadline = Date.now() + 10000;
    let cleaned = false;
    while (Date.now() < deadline) {
      const current = (await call(owner, 'runs/' + runId)).body;
      if (current.run.cleanup_status === 'COMPLETE') { cleaned = true; assert.equal(current.run.verdict, 'INCONCLUSIVE'); break; }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(cleaned);
    await pool.query('UPDATE users SET disabled_at=clock_timestamp() WHERE subject=$1', ['dev-viewer']);
    try { assert.equal((await call(await developmentToken(apiUrl, 'viewer'), 'me')).status, 401); }
    finally { await pool.query('UPDATE users SET disabled_at=NULL WHERE subject=$1', ['dev-viewer']); }
  } finally { await pool.end(); }
});
