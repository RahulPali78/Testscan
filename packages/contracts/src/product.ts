import { z } from 'zod';
import {
  SCHEMA_VERSION, ScenarioSchema, RunManifestSchema, ExecutionStatusSchema,
  VerdictSchema, CleanupStatusSchema, AssertionResultSchema, exampleScenario,
} from '@veriqo/contracts';

export const RoleSchema = z.enum(['owner', 'editor', 'viewer']);
export type Role = z.infer<typeof RoleSchema>;
export const FixtureModeSchema = z.enum(['correct', 'missing-write', 'duplicate-write', 'wrong-tenant']);
export type FixtureMode = z.infer<typeof FixtureModeSchema>;
export const ProjectSchema = z.object({
  id: z.uuid(), organisation_id: z.uuid(), name: z.string(), organisation_name: z.string(), role: RoleSchema,
});
export type Project = z.infer<typeof ProjectSchema>;
export const SessionSchema = z.object({
  user: z.object({ id: z.uuid(), display_name: z.string(), kind: z.enum(['user', 'service']) }),
  projects: z.array(ProjectSchema),
  auth_mode: z.enum(['development', 'oidc', 'cognito']),
});
export type Session = z.infer<typeof SessionSchema>;
export const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  project_name: z.string().trim().min(1).max(80).default('Main project'),
}).strict();
export const PublishScenarioSchema = z.object({ scenario: ScenarioSchema }).strict();
export const RunSubmitSchema = z.object({
  scenario_version_id: z.uuid(), fixture_mode: FixtureModeSchema.default('correct'),
}).strict();
export const ProjectTokenRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.enum(['editor', 'viewer']),
  expires_in_days: z.number().int().min(1).max(90).default(30),
}).strict();

export const referenceScenario: z.infer<typeof ScenarioSchema> = {
  ...exampleScenario,
  targets: {
    agent: { kind: 'agent', target_version: 'reference-agent-v1' },
    state: { kind: 'api', target_version: 'reference-observer-v1' },
  },
  steps: [
    { id: 'request', target: 'agent', operation: 'agent.message', input: { message: 'Create an urgent ticket about my invoice.' } },
    { id: 'observe', target: 'state', operation: 'state.observe', input: { reader: 'tickets-for-run' }, observation_window_seconds: 3 },
  ],
  checks: [
    { id: 'one-ticket', kind: 'state', severity: 'critical', required: true, expected: { count: 1 } },
    { id: 'tenant-and-requester', kind: 'state', severity: 'critical', required: true, expected: { tenant: 'fixture.tenant', requester: 'fixture.requester' } },
    { id: 'required-fields', kind: 'state', severity: 'major', required: true, expected: { priority: 'urgent' } },
  ],
};

export const ReferenceScenarioSchema = ScenarioSchema.superRefine((scenario, context) => {
  const reject = (message: string) => context.addIssue({ code: 'custom', path: ['capabilities'], message });
  if (Object.keys(scenario.targets).length !== 2 || scenario.targets.agent?.target_version !== 'reference-agent-v1' ||
      scenario.targets.state?.target_version !== 'reference-observer-v1' || scenario.steps[0]?.target !== 'agent' || scenario.steps[1]?.target !== 'state') {
    reject('Bind exactly the published reference agent and observer versions; additional targets require a qualified adapter.');
  }
  if (scenario.fixture_version !== 'two-tenant-support-v1' ||
      scenario.steps.length !== 2 ||
      scenario.steps[0]?.operation !== 'agent.message' ||
      scenario.steps[1]?.operation !== 'state.observe') {
    reject('The reference adapter supports one agent.message followed by one state.observe step only.');
  }
  const first = scenario.steps[0];
  if (!first || !z.object({ message: z.string().trim().min(1).max(2000) }).strict().safeParse(first.input).success) {
    reject('The reference agent requires a bounded literal message.');
  }
  const observer = scenario.steps[1];
  if (!observer || !z.object({ reader: z.literal('tickets-for-run') }).strict().safeParse(observer.input).success ||
      !observer.observation_window_seconds || observer.observation_window_seconds > 15) {
    reject('The reference observer requires tickets-for-run and an observation window of 1–15 seconds.');
  }
  if (scenario.limits.execution_timeout_seconds > 120 ||
      scenario.limits.execution_timeout_seconds < (observer?.observation_window_seconds ?? 1) + 5 ||
      scenario.limits.max_turns > 6) {
    reject('Reference runs require a deadline of observation window + 5 through 120 seconds, and at most six turns.');
  }
  const checks = new Map(scenario.checks.map((check) => [check.id, check]));
  if (checks.size !== 3 || !['one-ticket', 'tenant-and-requester', 'required-fields'].every((id) => checks.get(id)?.required)) {
    reject('The reference adapter requires exactly three protected state checks: count, ownership and required fields.');
  }
  if (!z.object({ count: z.literal(1) }).strict().safeParse(checks.get('one-ticket')?.expected).success ||
      checks.get('one-ticket')?.severity !== 'critical') reject('Exactly one ticket is a protected critical invariant.');
  if (!z.object({ tenant: z.literal('fixture.tenant'), requester: z.literal('fixture.requester') }).strict()
    .safeParse(checks.get('tenant-and-requester')?.expected).success ||
    checks.get('tenant-and-requester')?.severity !== 'critical') reject('Tenant and requester ownership are protected critical invariants.');
  if (!z.object({ priority: z.enum(['urgent', 'normal']) }).strict().safeParse(checks.get('required-fields')?.expected).success ||
      scenario.checks.some((check) => check.kind !== 'state')) reject('Only the reference state evaluators are executable in this version.');
});

export const RunExecutionManifestSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  organisation_id: z.uuid(),
  identity: RunManifestSchema,
  scenario: ScenarioSchema,
  scenario_hash: z.string().regex(/^[a-f0-9]{64}$/),
  fixture_mode: FixtureModeSchema,
  adapter: z.object({ id: z.literal('reference-support-v1'), expected_build: z.literal('foundation-v1') }).strict(),
}).strict();
export type RunExecutionManifest = z.infer<typeof RunExecutionManifestSchema>;
export const RunSummarySchema = z.object({
  id: z.uuid(), organisation_id: z.uuid(), project_id: z.uuid(), scenario_version_id: z.uuid(),
  scenario_name: z.string(),
  execution_status: ExecutionStatusSchema, verdict: VerdictSchema.nullable(), cleanup_status: CleanupStatusSchema,
  cancel_requested: z.boolean(), created_at: z.iso.datetime(), started_at: z.iso.datetime().nullable(),
  finished_at: z.iso.datetime().nullable(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;
export const EvidenceSchema = z.object({
  id: z.uuid(), sequence: z.number().int(), attempt_id: z.uuid().nullable(), kind: z.string(),
  source: z.string(), occurred_at: z.iso.datetime(), payload: z.json(),
});
export const RunDetailSchema = z.object({
  run: RunSummarySchema,
  manifest: RunExecutionManifestSchema,
  manifest_hash: z.string().regex(/^[a-f0-9]{64}$/),
  assertions: z.array(AssertionResultSchema),
  evidence: z.array(EvidenceSchema),
  candidate_attested: z.boolean().nullable(),
  error_code: z.string().nullable(),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;
export const ScenarioVersionSchema = z.object({
  id: z.uuid(), scenario_id: z.uuid(), name: z.string(), version_number: z.number().int().positive(),
  definition_hash: z.string(), published_at: z.iso.datetime(), definition: ScenarioSchema.optional(),
});
export type ScenarioVersion = z.infer<typeof ScenarioVersionSchema>;
