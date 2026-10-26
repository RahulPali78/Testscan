import { Context } from '@temporalio/activity';
import { ExecutionStore } from '@veriqo/db/execution';
import type { createPool } from '@veriqo/db';
import type { AssertionResult } from '@veriqo/contracts';
import { z } from 'zod';

const StateSchema = z.object({
  namespace: z.uuid(), observer_coverage: z.literal('both-synthetic-tenants'),
  tickets: z.array(z.object({ id: z.uuid(), tenant_id: z.string().max(100), requester_id: z.string().max(100), title: z.string().max(2000), priority: z.string().max(30) })).max(20),
});
async function http(base: string, path: string, init: RequestInit = {}, deadline = Date.now() + 5000) {
  const response = await fetch(new URL(path, base), { ...init, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))) });
  if (!response.ok) throw new Error('Reference request unavailable');
  if (response.status === 204) return null;
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 65536) { await reader.cancel(); throw new Error('Response too large'); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { reader.releaseLock(); }
}
const json = (body: unknown, key?: string): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) });

export function createRunActivities(pool: ReturnType<typeof createPool>, fixtureUrl: string) {
  const store = new ExecutionStore(pool);
  return {
    async executeRun(runId: string): Promise<void> {
      const claimed = await store.claim(runId);
      if (!claimed) return;
      const { attempt, manifest } = claimed;
      const scenario = manifest.scenario;
      const deadline = Date.now() + scenario.limits.execution_timeout_seconds * 1000;
      const active = async () => {
        Context.current().heartbeat();
        Context.current().cancellationSignal.throwIfAborted();
        if (Date.now() >= deadline || !await store.active(runId, attempt)) throw new Error('Stopped');
      };
      const health = async () => {
        const result = await http(fixtureUrl, '/health/live', {}, deadline);
        const parsed = z.object({ service: z.literal('veriqo-support-fixture'), version: z.literal('foundation-v1') }).safeParse(result);
        await store.evidence(runId, attempt, 'build-attestation', 'reference-adapter', { expected: manifest.adapter.expected_build, observed: result, matches: parsed.success });
        return parsed.success;
      };
      try {
        await active();
        const before = await health();
        if (!before) throw new Error('Build mismatch');
        await store.stage(runId, attempt, 'RUNNING', true);
        await http(fixtureUrl, '/fixtures', json({ namespace: runId, mode: manifest.fixture_mode }), deadline);
        await store.evidence(runId, attempt, 'fixture-created', 'reference-adapter', { namespace: runId, fixture_version: scenario.fixture_version });
        await active();
        const agent = await http(fixtureUrl, '/fixtures/' + runId + '/agent', json(scenario.steps[0]!.input, runId + ':' + scenario.steps[0]!.id), deadline);
        const agentResult = z.object({ response: z.string().max(3000), namespace: z.literal(runId) }).parse(agent);
        await store.evidence(runId, attempt, 'agent-response', 'reference-agent', agentResult);
        await store.stage(runId, attempt, 'EVALUATING');
        const until = Date.now() + scenario.steps[1]!.observation_window_seconds! * 1000;
        let latest: AssertionResult[] = [];
        while (true) {
          await active();
          const state = StateSchema.parse(await http(fixtureUrl, '/fixtures/' + runId + '/state', {}, deadline));
          if (state.namespace !== runId) throw new Error('Observer scope mismatch');
          const evidence = await store.evidence(runId, attempt, 'state-observation', 'authoritative-reference-observer', state);
          const tickets = state.tickets;
          const windowComplete = Date.now() >= until;
          latest = scenario.checks.map((check): AssertionResult => {
            let pass: boolean, observed: unknown;
            if (check.id === 'one-ticket') { pass = tickets.length === 1; observed = { count: tickets.length }; }
            else if (check.id === 'tenant-and-requester') {
              pass = tickets.length > 0 && tickets.every((ticket) => ticket.tenant_id === runId + ':tenant-a' && ticket.requester_id === runId + ':requester');
              observed = tickets.map(({ id, tenant_id, requester_id }) => ({ id, tenant_id, requester_id }));
            } else {
              const priority = (check.expected as { priority: string }).priority;
              pass = tickets.length > 0 && tickets.every((ticket) => ticket.title.trim().length > 0 && ticket.priority === priority);
              observed = tickets.map(({ id, title, priority }) => ({ id, title, priority }));
            }
            // A zero count is only a failure after the complete observation window.
            const outcome = !pass && (tickets.length > 0 || windowComplete) ? 'FAIL' : windowComplete && pass ? 'PASS' : 'UNKNOWN';
            return { check_id: check.id, required: check.required, severity: check.severity, expected: check.expected,
              observed: observed as AssertionResult['observed'], outcome, evidence_refs: [evidence] };
          });
          const failures = latest.filter((item) => item.outcome === 'FAIL');
          if (failures.length) {
            // Persist witnessed failures before any later network or cleanup operation.
            await store.record(runId, attempt, failures, false);
            break;
          }
          if (windowComplete) break;
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000, until - Date.now())));
        }
        await active();
        const after = await health();
        await store.record(runId, attempt, latest, before && after);
      } catch {
        await store.executionError(runId, attempt, 'EXECUTION_INCOMPLETE');
      }
    },
    async cleanupRun(runId: string, failed: boolean): Promise<void> {
      const cleanup = await store.beginCleanup(runId, failed);
      if (!cleanup) return;
      try {
        if (cleanup.fixtureAttempted) await http(fixtureUrl, '/fixtures/' + runId, { method: 'DELETE' });
        await store.cleanupResult(runId, cleanup.attempt, true, cleanup.fixtureAttempted);
      } catch {
        await store.cleanupResult(runId, cleanup.attempt, false, cleanup.fixtureAttempted);
        throw new Error('Fixture cleanup unavailable');
      }
    },
    async finishRun(runId: string): Promise<void> { await store.finish(runId); },
    async markCleanupFailed(runId: string): Promise<void> { await store.markCleanupFailed(runId); },
  };
}
export type RunActivities = ReturnType<typeof createRunActivities>;
