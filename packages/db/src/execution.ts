import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { aggregateVerdict, AssertionResultSchema, type AssertionResult } from '@veriqo/contracts';
import { RunExecutionManifestSchema, type RunExecutionManifest } from '@veriqo/contracts/product';
import { ProductStore, terminal } from './product.js';

export class ExecutionStore extends ProductStore {
  async claim(runId: string): Promise<{ attempt: string; manifest: RunExecutionManifest } | null> {
    const attempt = randomUUID();
    const result = await this.pool.query("UPDATE runs SET execution_status='PREPARING',started_at=clock_timestamp(),attempt_id=$2 WHERE id=$1 AND execution_status='QUEUED' AND NOT cancel_requested RETURNING manifest", [runId, attempt]);
    return result.rows[0] ? { attempt, manifest: RunExecutionManifestSchema.parse(result.rows[0].manifest) } : null;
  }
  async active(runId: string, attempt: string) {
    const result = await this.pool.query('SELECT cancel_requested FROM runs WHERE id=$1 AND attempt_id=$2', [runId, attempt]);
    return Boolean(result.rows[0] && !result.rows[0].cancel_requested);
  }
  async stage(runId: string, attempt: string, status: 'RUNNING' | 'EVALUATING', fixtureAttempted = false) {
    const result = await this.pool.query('UPDATE runs SET execution_status=$3,fixture_attempted=fixture_attempted OR $4 WHERE id=$1 AND attempt_id=$2 AND NOT cancel_requested RETURNING id', [runId, attempt, status, fixtureAttempted]);
    if (!result.rowCount) throw new Error('Run cancelled or fenced');
  }
  async evidence(runId: string, attempt: string, kind: string, source: string, payload: unknown): Promise<string> {
    const id = randomUUID();
    const result = await this.pool.query('INSERT INTO run_evidence(id,organisation_id,project_id,run_id,attempt_id,kind,source,payload) SELECT $3,organisation_id,project_id,id,$2,$4,$5,$6 FROM runs WHERE id=$1 AND attempt_id=$2 RETURNING id', [runId, attempt, id, kind, source, JSON.stringify(payload)]);
    if (!result.rowCount) throw new Error('Execution fenced');
    return id;
  }
  async record(runId: string, attempt: string, results: AssertionResult[], attested: boolean) {
    await this.transaction(async (client) => {
      const run = await client.query('SELECT * FROM runs WHERE id=$1 AND attempt_id=$2 FOR UPDATE', [runId, attempt]);
      const row = run.rows[0];
      if (!row) throw new Error('Execution fenced');
      for (const item of results) {
        const result = AssertionResultSchema.parse(item);
        for (const ref of result.evidence_refs) {
          const evidence = await client.query('SELECT id FROM run_evidence WHERE id=$1 AND run_id=$2', [ref, runId]);
          if (!evidence.rowCount) throw new Error('Missing evidence');
        }
        await client.query('INSERT INTO run_assertions(organisation_id,project_id,run_id,check_id,result) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [row.organisation_id, row.project_id, runId, result.check_id, JSON.stringify(result)]);
      }
      await client.query('UPDATE runs SET candidate_attested=$3 WHERE id=$1 AND attempt_id=$2', [runId, attempt, attested]);
    });
  }
  async executionError(runId: string, attempt: string, code: string) {
    await this.pool.query('UPDATE runs SET error_code=$3 WHERE id=$1 AND attempt_id=$2 AND error_code IS NULL', [runId, attempt, code]);
  }
  async beginCleanup(runId: string, failed: boolean) {
    return this.transaction(async (client) => {
      const result = await client.query('SELECT * FROM runs WHERE id=$1 FOR UPDATE', [runId]);
      const row = result.rows[0];
      if (!row || ['COMPLETE', 'NOT_REQUIRED'].includes(row.cleanup_status)) return null;
      // Rotating the fence prevents a timed-out execution activity from recording success.
      const attempt = randomUUID();
      await client.query("UPDATE runs SET attempt_id=$2,cleanup_status='RUNNING',error_code=COALESCE(error_code,$3) WHERE id=$1", [runId, attempt, failed && !terminal.has(row.execution_status) ? 'EXECUTION_INTERRUPTED' : null]);
      return { attempt, fixtureAttempted: row.fixture_attempted as boolean };
    });
  }
  async cleanupResult(runId: string, attempt: string, success: boolean, fixtureAttempted: boolean) {
    await this.evidence(runId, attempt, 'cleanup', 'reference-adapter', { namespace: runId, success, fixture_attempted: fixtureAttempted });
    await this.pool.query('UPDATE runs SET cleanup_status=$3 WHERE id=$1 AND attempt_id=$2', [runId, attempt, success ? fixtureAttempted ? 'COMPLETE' : 'NOT_REQUIRED' : 'FAILED']);
  }
  async finish(runId: string) {
    await this.transaction(async (client) => {
      const result = await client.query('SELECT * FROM runs WHERE id=$1 FOR UPDATE', [runId]);
      const row = result.rows[0];
      if (!row || terminal.has(row.execution_status)) return;
      const manifest = RunExecutionManifestSchema.parse(row.manifest);
      const checks = await client.query('SELECT result FROM run_assertions WHERE run_id=$1', [runId]);
      const results = checks.rows.map((item) => AssertionResultSchema.parse(item.result));
      let verdict = aggregateVerdict(results, row.candidate_attested === true,
        manifest.scenario.checks.filter((check) => check.required).map((check) => check.id));
      if ((row.cancel_requested || row.error_code) && verdict === 'PASS') verdict = 'INCONCLUSIVE';
      await client.query('UPDATE runs SET execution_status=$2,verdict=$3,finished_at=clock_timestamp() WHERE id=$1', [runId, row.cancel_requested ? 'CANCELLED' : row.error_code ? 'ERROR' : 'FINISHED', verdict]);
    });
  }
  async markCleanupFailed(runId: string) {
    await this.pool.query("UPDATE runs SET cleanup_status='FAILED',attempt_id=$2 WHERE id=$1 AND cleanup_status NOT IN ('COMPLETE','NOT_REQUIRED')", [runId, randomUUID()]);
  }
  async leaseOutbox() {
    return this.transaction(async (client) => {
      await client.query("UPDATE runs SET execution_status='ERROR',verdict='INCONCLUSIVE',cleanup_status='NOT_REQUIRED',finished_at=clock_timestamp(),error_code='QUEUE_DEADLINE' WHERE execution_status='QUEUED' AND created_at<clock_timestamp()-interval '5 minutes'");
      const result = await client.query("UPDATE run_outbox SET lease_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1 WHERE id IN (SELECT id FROM run_outbox WHERE dispatched_at IS NULL AND available_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING id,run_id,kind,workflow_id");
      return result.rows as { id: string; run_id: string; kind: 'RUN' | 'CLEANUP'; workflow_id: string }[];
    });
  }
  async dispatched(id: string) { await this.pool.query('UPDATE run_outbox SET dispatched_at=clock_timestamp(),lease_until=NULL,last_error=NULL WHERE id=$1', [id]); }
  async dispatchFailed(id: string) { await this.pool.query("UPDATE run_outbox SET lease_until=NULL,available_at=clock_timestamp()+interval '5 seconds',last_error='DISPATCH_UNAVAILABLE' WHERE id=$1", [id]); }
}
