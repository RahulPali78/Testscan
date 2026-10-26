import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exampleScenario } from '../src/index.js';
import { ReferenceScenarioSchema, referenceScenario } from '../src/product.js';

test('reference admission rejects unsupported surfaces, unpinned identities, weakened invariants and excessive work', () => {
  assert.ok(ReferenceScenarioSchema.safeParse(referenceScenario).success);
  assert.equal(ReferenceScenarioSchema.safeParse(exampleScenario).success, false);
  const unpinned = structuredClone(referenceScenario); unpinned.targets.agent!.target_version = 'customer-agent';
  const weakened = structuredClone(referenceScenario); weakened.checks[0]!.expected = { count: 0 };
  const overLimit = structuredClone(referenceScenario); overLimit.steps[1]!.observation_window_seconds = 16;
  const codeInput = structuredClone(referenceScenario); codeInput.steps[0]!.input.script = 'arbitrary execution';
  for (const scenario of [unpinned, weakened, overLimit, codeInput]) assert.equal(ReferenceScenarioSchema.safeParse(scenario).success, false);
});
