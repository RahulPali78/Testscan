import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { SCHEMA_VERSION, type Scenario } from '@veriqo/contracts';
import {
  RunDetailSchema, RunSummarySchema, RunExecutionManifestSchema,
  type Project, type Role, type FixtureMode, type RunExecutionManifest, type RunSummary,
} from '@veriqo/contracts/product';

export class ProductError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
export type Identity = { issuer: string; subject: string; display_name: string };
export type Credential = { kind: 'user'; identity: Identity } | { kind: 'service'; token_hash: string };
export type Actor = { kind: 'user' | 'service'; id: string; display_name: string };
export type Access = Project;
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const hashData = (value: unknown) => digest(canonicalJson(value));
export const terminal = new Set(['FINISHED', 'ERROR', 'CANCELLED']);
const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();
type RunRow = {
  id: string; organisation_id: string; project_id: string; scenario_version_id: string;
  manifest: RunExecutionManifest; execution_status: string; verdict: string | null; cleanup_status: string;
  manifest_hash: string;
  cancel_requested: boolean; created_at: Date; started_at: Date | null; finished_at: Date | null;
  candidate_attested: boolean | null; error_code: string | null; request_hash: string;
};
export function runSummary(row: RunRow): RunSummary {
  return RunSummarySchema.parse({
    id: row.id, organisation_id: row.organisation_id, project_id: row.project_id,
    scenario_version_id: row.scenario_version_id, scenario_name: row.manifest.scenario.scenario_id,
    execution_status: row.execution_status, verdict: row.verdict, cleanup_status: row.cleanup_status,
    cancel_requested: row.cancel_requested, created_at: iso(row.created_at),
    started_at: iso(row.started_at), finished_at: iso(row.finished_at),
  });
}

export class ProductStore {
  constructor(public readonly pool: pg.Pool) {}
  async transaction<T>(action: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505') throw new ProductError(409, 'CONFLICT', 'The resource already exists. Publish a new version or use another operation key.');
      throw error;
    } finally { client.release(); }
  }
  async resolveActor(credential: Credential): Promise<Actor> {
    if (credential.kind === 'service') {
      const result = await this.pool.query(
        'SELECT t.id,t.name FROM project_tokens t JOIN users u ON u.id=t.created_by ' +
        'WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>clock_timestamp() AND u.disabled_at IS NULL',
        [credential.token_hash],
      );
      if (!result.rows[0]) throw new ProductError(401, 'UNAUTHORIZED', 'The access credential is invalid or expired.');
      return { kind: 'service', id: result.rows[0].id, display_name: result.rows[0].name };
    }
    const identity = credential.identity;
    const result = await this.pool.query(
      'INSERT INTO users(id,issuer,subject,display_name) VALUES($1,$2,$3,$4) ' +
      'ON CONFLICT(issuer,subject) DO UPDATE SET display_name=EXCLUDED.display_name ' +
      'WHERE users.disabled_at IS NULL RETURNING id,display_name',
      [randomUUID(), identity.issuer, identity.subject, identity.display_name.slice(0, 120)],
    );
    if (!result.rows[0]) throw new ProductError(401, 'UNAUTHORIZED', 'This account is disabled.');
    return { kind: 'user', id: result.rows[0].id, display_name: result.rows[0].display_name };
  }
  async access(client: pg.Pool | pg.PoolClient, actor: Actor, projectId: string, permission: 'read' | 'write' | 'owner' = 'read'): Promise<Access> {
    const result = actor.kind === 'user'
      ? await client.query(
        'SELECT p.id,p.organisation_id,p.name,o.name AS organisation_name,m.role ' +
        'FROM projects p JOIN organisations o ON o.id=p.organisation_id ' +
        'JOIN project_memberships m ON m.project_id=p.id AND m.organisation_id=p.organisation_id ' +
        'JOIN users u ON u.id=m.user_id WHERE p.id=$1 AND m.user_id=$2 AND u.disabled_at IS NULL',
        [projectId, actor.id],
      )
      : await client.query(
        'SELECT p.id,p.organisation_id,p.name,o.name AS organisation_name,t.role ' +
        'FROM projects p JOIN organisations o ON o.id=p.organisation_id ' +
        'JOIN project_tokens t ON t.project_id=p.id AND t.organisation_id=p.organisation_id ' +
        'JOIN users u ON u.id=t.created_by WHERE p.id=$1 AND t.id=$2 AND t.revoked_at IS NULL ' +
        'AND t.expires_at>clock_timestamp() AND u.disabled_at IS NULL',
        [projectId, actor.id],
      );
    const project = result.rows[0] as Access | undefined;
    if (!project) throw new ProductError(404, 'NOT_FOUND', 'The project or resource is unavailable.');
    if ((permission === 'write' && project.role === 'viewer') ||
        (permission === 'owner' && (project.role !== 'owner' || actor.kind !== 'user'))) {
      throw new ProductError(403, 'FORBIDDEN', 'Your project role does not permit this operation.');
    }
    return project;
  }
  async session(actor: Actor) {
    const result = actor.kind === 'user'
      ? await this.pool.query('SELECT project_id FROM project_memberships WHERE user_id=$1', [actor.id])
      : await this.pool.query('SELECT project_id FROM project_tokens WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()', [actor.id]);
    const projects: Access[] = [];
    for (const row of result.rows) {
      try { projects.push(await this.access(this.pool, actor, row.project_id)); }
      catch (error) { if (!(error instanceof ProductError && error.statusCode === 404)) throw error; }
    }
    return { user: { ...actor }, projects };
  }
  async audit(client: pg.PoolClient, actor: Actor, project: Access, action: string, resourceId: string, metadata: unknown = {}) {
    await client.query(
      'INSERT INTO audit_events(id,organisation_id,project_id,actor_kind,actor_id,action,resource_id,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [randomUUID(), project.organisation_id, project.id, actor.kind, actor.id, action, resourceId, JSON.stringify(metadata)],
    );
  }
  async createWorkspace(actor: Actor, name: string, projectName: string): Promise<Project> {
    if (actor.kind !== 'user') throw new ProductError(403, 'FORBIDDEN', 'A user account is required to create a workspace.');
    return this.transaction(async (client) => {
      const organisationId = randomUUID(), projectId = randomUUID();
      await client.query('INSERT INTO organisations(id,name) VALUES($1,$2)', [organisationId, name]);
      await client.query('INSERT INTO projects(id,organisation_id,name) VALUES($1,$2,$3)', [projectId, organisationId, projectName]);
      await client.query('INSERT INTO project_memberships(user_id,organisation_id,project_id,role) VALUES($1,$2,$3,$4)', [actor.id, organisationId, projectId, 'owner']);
      const project: Project = { id: projectId, organisation_id: organisationId, name: projectName, organisation_name: name, role: 'owner' };
      await this.audit(client, actor, project, 'workspace.created', projectId);
      return project;
    });
  }
  async listScenarios(actor: Actor, projectId: string) {
    await this.access(this.pool, actor, projectId);
    const result = await this.pool.query(
      'SELECT v.id,s.id AS scenario_id,s.scenario_key AS name,v.version_number,v.definition_hash,v.published_at ' +
      'FROM scenarios s JOIN LATERAL(SELECT * FROM scenario_versions WHERE scenario_id=s.id ORDER BY version_number DESC LIMIT 1)v ON true ' +
      'WHERE s.project_id=$1 ORDER BY s.created_at DESC LIMIT 50', [projectId],
    );
    return result.rows.map((row) => ({ ...row, published_at: iso(row.published_at) }));
  }
  async publish(actor: Actor, definition: Scenario, projectId?: string, scenarioId?: string) {
    if (actor.kind !== 'user') throw new ProductError(403, 'FORBIDDEN', 'A user editor must publish business expectations.');
    return this.transaction(async (client) => {
      let id = scenarioId;
      let existingKey: string | undefined;
      if (id) {
        const existing = await client.query('SELECT project_id,scenario_key FROM scenarios WHERE id=$1 FOR UPDATE', [id]);
        if (!existing.rows[0]) throw new ProductError(404, 'NOT_FOUND', 'Scenario not found.');
        projectId = existing.rows[0].project_id;
        existingKey = existing.rows[0].scenario_key;
      }
      if (!projectId) throw new ProductError(400, 'INVALID_PROJECT', 'Project is required.');
      const project = await this.access(client, actor, projectId, 'write');
      if (existingKey && existingKey !== definition.scenario_id) throw new ProductError(409, 'SCENARIO_ID_CHANGED', 'Publish changes under the same scenario identity.');
      if (!id) {
        id = randomUUID();
        await client.query('INSERT INTO scenarios(id,organisation_id,project_id,scenario_key) VALUES($1,$2,$3,$4)',
          [id, project.organisation_id, project.id, definition.scenario_id]);
      }
      const last = await client.query('SELECT COALESCE(MAX(version_number),0)::integer AS number FROM scenario_versions WHERE scenario_id=$1', [id]);
      const number = Number(last.rows[0].number) + 1, versionId = randomUUID(), hash = hashData(definition);
      const result = await client.query(
        'INSERT INTO scenario_versions(id,organisation_id,project_id,scenario_id,version_number,definition,definition_hash,published_by) ' +
        'VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING published_at',
        [versionId, project.organisation_id, project.id, id, number, JSON.stringify(definition), hash, actor.id],
      );
      await this.audit(client, actor, project, 'scenario.published', versionId, { scenario_id: id, definition_hash: hash });
      return { id: versionId, scenario_id: id, name: definition.scenario_id, version_number: number, definition_hash: hash,
        published_at: iso(result.rows[0].published_at), definition };
    });
  }
  async versions(actor: Actor, scenarioId: string) {
    const existing = await this.pool.query('SELECT project_id FROM scenarios WHERE id=$1', [scenarioId]);
    if (!existing.rows[0]) throw new ProductError(404, 'NOT_FOUND', 'Scenario not found.');
    await this.access(this.pool, actor, existing.rows[0].project_id);
    const result = await this.pool.query(
      'SELECT v.id,v.scenario_id,s.scenario_key AS name,v.version_number,v.definition_hash,v.published_at,v.definition ' +
      'FROM scenario_versions v JOIN scenarios s ON s.id=v.scenario_id WHERE v.scenario_id=$1 ORDER BY version_number DESC LIMIT 50', [scenarioId],
    );
    return result.rows.map((row) => ({ ...row, published_at: iso(row.published_at) }));
  }
  async submit(actor: Actor, projectId: string, key: string, input: { scenario_version_id: string; fixture_mode: FixtureMode }) {
    return this.transaction(async (client) => {
      const project = await this.access(client, actor, projectId, 'write');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [projectId]);
      const hash = hashData(input);
      const existing = await client.query<RunRow>('SELECT * FROM runs WHERE project_id=$1 AND idempotency_key=$2', [projectId, key]);
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== hash) throw new ProductError(409, 'IDEMPOTENCY_CONFLICT', 'This operation key was used with different inputs.');
        return runSummary(existing.rows[0]);
      }
      const cleanup = await client.query("SELECT id FROM runs WHERE project_id=$1 AND cleanup_status='FAILED' LIMIT 1", [projectId]);
      if (cleanup.rows.length) throw new ProductError(409, 'CLEANUP_REQUIRED', 'Resolve failed fixture cleanup before starting another run.');
      const active = await client.query("SELECT COUNT(*)::integer AS count FROM runs WHERE project_id=$1 AND execution_status NOT IN ('FINISHED','ERROR','CANCELLED')", [projectId]);
      if (Number(active.rows[0].count) >= 5) throw new ProductError(429, 'CONCURRENCY_LIMIT', 'This project already has five active runs.');
      const version = await client.query(
        'SELECT * FROM scenario_versions WHERE id=$1 AND organisation_id=$2 AND project_id=$3',
        [input.scenario_version_id, project.organisation_id, project.id],
      );
      if (!version.rows[0]) throw new ProductError(404, 'NOT_FOUND', 'Published scenario version not found.');
      const definition = version.rows[0].definition as Scenario, runId = randomUUID();
      const manifest = RunExecutionManifestSchema.parse({
        schema_version: SCHEMA_VERSION, organisation_id: project.organisation_id,
        identity: {
          schema_version: SCHEMA_VERSION, run_id: runId, project_id: project.id,
          scenario_version: input.scenario_version_id, dataset_version: 'reference-cases-v1',
          fixture_version: definition.fixture_version, evaluator_bundle: 'reference-state-v1', policy_version: 'reference-release-v1',
          candidate_set: Object.fromEntries(Object.entries(definition.targets).map(([alias, target]) => [
            alias, { target_version: target.target_version, application_build: 'foundation-v1', agent_configuration: 'reference-agent-v1', attested: false },
          ])),
        },
        scenario: definition, scenario_hash: version.rows[0].definition_hash,
        fixture_mode: input.fixture_mode, adapter: { id: 'reference-support-v1', expected_build: 'foundation-v1' },
      });
      const result = await client.query<RunRow>(
        'INSERT INTO runs(id,organisation_id,project_id,scenario_version_id,manifest,manifest_hash,idempotency_key,request_hash,created_by_user,created_by_token) ' +
        'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
        [runId, project.organisation_id, project.id, input.scenario_version_id, JSON.stringify(manifest), hashData(manifest),
          key, hash, actor.kind === 'user' ? actor.id : null, actor.kind === 'service' ? actor.id : null],
      );
      await client.query('INSERT INTO run_outbox(id,organisation_id,project_id,run_id,kind,workflow_id) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), project.organisation_id, project.id, runId, 'RUN', 'veriqo-run-' + runId]);
      await this.audit(client, actor, project, 'run.created', runId, { manifest_hash: hashData(manifest) });
      return runSummary(result.rows[0]!);
    });
  }
  async listRuns(actor: Actor, projectId: string) {
    await this.access(this.pool, actor, projectId);
    const result = await this.pool.query<RunRow>('SELECT * FROM runs WHERE project_id=$1 ORDER BY created_at DESC LIMIT 50', [projectId]);
    return result.rows.map(runSummary);
  }
  async ownedRun(client: pg.Pool | pg.PoolClient, actor: Actor, runId: string, permission: 'read' | 'write' = 'read'): Promise<RunRow> {
    const result = await client.query<RunRow>('SELECT * FROM runs WHERE id=$1', [runId]);
    const run = result.rows[0];
    if (!run) throw new ProductError(404, 'NOT_FOUND', 'Run not found.');
    await this.access(client, actor, run.project_id, permission);
    return run;
  }
  async run(actor: Actor, runId: string) {
    const row = await this.ownedRun(this.pool, actor, runId);
    const [assertions, evidence] = await Promise.all([
      this.pool.query('SELECT result FROM run_assertions WHERE run_id=$1 ORDER BY check_id', [runId]),
      this.pool.query('SELECT id,sequence,attempt_id,kind,source,occurred_at,payload FROM run_evidence WHERE run_id=$1 ORDER BY sequence', [runId]),
    ]);
    return RunDetailSchema.parse({
      run: runSummary(row), manifest: row.manifest, manifest_hash: row.manifest_hash,
      assertions: assertions.rows.map((item) => item.result),
      evidence: evidence.rows.map((item) => ({ ...item, sequence: Number(item.sequence), occurred_at: iso(item.occurred_at) })),
      candidate_attested: row.candidate_attested, error_code: row.error_code,
    });
  }
  async cancel(actor: Actor, runId: string) {
    return this.transaction(async (client) => {
      const run = await this.ownedRun(client, actor, runId, 'write');
      const project = await this.access(client, actor, run.project_id, 'write');
      const result = await client.query<RunRow>(
        "UPDATE runs SET cancel_requested=true,execution_status=CASE WHEN execution_status='QUEUED' THEN 'CANCELLED' ELSE execution_status END," +
        "verdict=CASE WHEN execution_status='QUEUED' THEN 'INCONCLUSIVE' ELSE verdict END," +
        "cleanup_status=CASE WHEN execution_status='QUEUED' THEN 'NOT_REQUIRED' ELSE cleanup_status END," +
        "finished_at=CASE WHEN execution_status='QUEUED' THEN clock_timestamp() ELSE finished_at END " +
        "WHERE id=$1 AND execution_status NOT IN ('FINISHED','ERROR','CANCELLED') RETURNING *", [runId],
      );
      if (result.rows[0]) await this.audit(client, actor, project, 'run.cancel_requested', runId);
      return runSummary(result.rows[0] ?? run);
    });
  }
  async retryCleanup(actor: Actor, runId: string) {
    return this.transaction(async (client) => {
      const run = await this.ownedRun(client, actor, runId, 'write');
      const project = await this.access(client, actor, run.project_id, 'write');
      const updated = await client.query<RunRow>(
        "UPDATE runs SET cleanup_status='PENDING' WHERE id=$1 AND cleanup_status='FAILED' AND execution_status IN ('FINISHED','ERROR','CANCELLED') RETURNING *", [runId],
      );
      if (updated.rows[0]) {
        const commandId = randomUUID();
        await client.query('INSERT INTO run_outbox(id,organisation_id,project_id,run_id,kind,workflow_id) VALUES($1,$2,$3,$4,$5,$6)',
          [commandId, project.organisation_id, project.id, runId, 'CLEANUP', 'veriqo-cleanup-' + commandId]);
        await this.audit(client, actor, project, 'run.cleanup_requested', runId);
      }
      return runSummary(updated.rows[0] ?? run);
    });
  }
  async createToken(actor: Actor, projectId: string, input: { name: string; role: 'editor' | 'viewer'; expires_in_days: number }) {
    return this.transaction(async (client) => {
      const project = await this.access(client, actor, projectId, 'owner');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [projectId]);
      const active = await client.query('SELECT count(*)::integer AS count FROM project_tokens WHERE project_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()', [projectId]);
      if (active.rows[0].count >= 20) throw new ProductError(429, 'TOKEN_LIMIT', 'Revoke an existing token before creating another.');
      const token = 'vq_' + randomBytes(32).toString('base64url'), id = randomUUID();
      const result = await client.query(
        "INSERT INTO project_tokens(id,organisation_id,project_id,name,role,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+($8::integer*interval '1 day')) RETURNING expires_at",
        [id, project.organisation_id, project.id, input.name, input.role, digest(token), actor.id, input.expires_in_days],
      );
      await this.audit(client, actor, project, 'token.created', id, { role: input.role, name: input.name });
      return { id, name: input.name, role: input.role, token, expires_at: iso(result.rows[0].expires_at) };
    });
  }
  async revokeToken(actor: Actor, projectId: string, tokenId: string) {
    return this.transaction(async (client) => {
      const project = await this.access(client, actor, projectId, 'owner');
      const result = await client.query('UPDATE project_tokens SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1 AND project_id=$2 RETURNING id',
        [tokenId, projectId]);
      if (!result.rows.length) throw new ProductError(404, 'NOT_FOUND', 'Token not found.');
      await this.audit(client, actor, project, 'token.revoked', tokenId);
    });
  }
}
