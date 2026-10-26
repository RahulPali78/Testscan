import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateVerdict, exampleScenario, ScenarioSchema, RunManifestSchema, type AssertionResult } from '../src/index.js';

test('scenario validation accepts the example and rejects unbound or mismatched targets', () => {
  assert.ok(ScenarioSchema.safeParse(exampleScenario).success);
  const unbound = structuredClone(exampleScenario);
  unbound.steps[0]!.target = 'missing';
  assert.equal(ScenarioSchema.safeParse(unbound).success, false);
  const mismatch = structuredClone(exampleScenario);
  mismatch.targets.agent!.kind = 'mobile';
  assert.equal(ScenarioSchema.safeParse(mismatch).success, false);
});

test('scenario validation protects critical checks, unique steps and observation windows', () => {
  const optional = structuredClone(exampleScenario);
  optional.checks[0]!.required = false;
  assert.equal(ScenarioSchema.safeParse(optional).success, false);
  const duplicate = structuredClone(exampleScenario);
  duplicate.steps[1]!.id = duplicate.steps[0]!.id;
  assert.equal(ScenarioSchema.safeParse(duplicate).success, false);
  const noWindow = structuredClone(exampleScenario);
  delete noWindow.steps[1]!.observation_window_seconds;
  assert.equal(ScenarioSchema.safeParse(noWindow).success, false);
  assert.equal(ScenarioSchema.safeParse({ ...exampleScenario, executable_code: 'process.exit()' }).success, false);
});

const result = (outcome: AssertionResult['outcome']): AssertionResult => ({
  check_id: 'one-ticket', required: true, outcome, severity: 'critical',
  expected: { count: 1 }, observed: null, evidence_refs: outcome === 'UNKNOWN' ? [] : ['state-read-1'],
});
test('witnessed required failure wins; absent evidence and unattested candidates never pass', () => {
  const required = ['one-ticket'];
  assert.equal(aggregateVerdict([result('FAIL'), result('UNKNOWN')], false, required), 'FAIL');
  assert.equal(aggregateVerdict([result('UNKNOWN')], true, required), 'INCONCLUSIVE');
  assert.equal(aggregateVerdict([result('PASS')], false, required), 'INCONCLUSIVE');
  assert.equal(aggregateVerdict([], true, required), 'INCONCLUSIVE');
  assert.equal(aggregateVerdict([result('PASS')], true, required), 'PASS');
});

test('omitted checks, ambiguous duplicates and unsupported assertions cannot manufacture a pass', () => {
  assert.equal(aggregateVerdict([result('PASS')], true, ['one-ticket', 'tenant-match']), 'INCONCLUSIVE');
  assert.equal(aggregateVerdict([result('PASS'), result('PASS')], true, ['one-ticket']), 'INCONCLUSIVE');
  assert.equal(aggregateVerdict([{ ...result('PASS'), evidence_refs: [] }], true, ['one-ticket']), 'INCONCLUSIVE');
  assert.equal(aggregateVerdict([{ ...result('FAIL'), evidence_refs: [] }], true, ['one-ticket']), 'INCONCLUSIVE');
});

test('run manifests require explicit candidate and version records', () => {
  assert.equal(RunManifestSchema.safeParse({ schema_version: '2.0', candidate_set: {} }).success, false);
});
