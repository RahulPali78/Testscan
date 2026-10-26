import { z } from 'zod';

export const SCHEMA_VERSION = '2.0' as const;
export const ApplicationKindSchema = z.enum(['web', 'api', 'agent', 'mobile', 'desktop', 'voice']);
export type ApplicationKind = z.infer<typeof ApplicationKindSchema>;
export const IdentifierSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
export const ExecutionStatusSchema = z.enum([
  'QUEUED', 'PREPARING', 'RUNNING', 'EVALUATING', 'CLEANING', 'FINISHED', 'ERROR', 'CANCELLED',
]);
export const VerdictSchema = z.enum(['PASS', 'FAIL', 'INCONCLUSIVE', 'NOT_TESTED']);
export const CleanupStatusSchema = z.enum(['NOT_REQUIRED', 'PENDING', 'RUNNING', 'COMPLETE', 'FAILED']);
export const AssertionResultSchema = z.object({
  check_id: IdentifierSchema,
  required: z.boolean(),
  outcome: z.enum(['PASS', 'FAIL', 'UNKNOWN']),
  severity: z.enum(['critical', 'major', 'minor']),
  expected: z.json(),
  observed: z.json(),
  evidence_refs: z.array(IdentifierSchema),
}).strict().superRefine((result, context) => {
  if (result.outcome !== 'UNKNOWN' && result.evidence_refs.length === 0) {
    context.addIssue({ code: 'custom', path: ['evidence_refs'], message: 'Definitive assertions require evidence references.' });
  }
});
export type AssertionResult = z.infer<typeof AssertionResultSchema>;

export function aggregateVerdict(
  results: readonly AssertionResult[],
  candidateAttested: boolean,
  requiredCheckIds: readonly string[],
): z.infer<typeof VerdictSchema> {
  const ids = new Set(requiredCheckIds);
  const groups = requiredCheckIds.map((id) => results.filter((result) => result.check_id === id));
  const witnessed = (result: AssertionResult) => result.evidence_refs.length > 0;
  if (groups.some((group) => group.some((result) => result.outcome === 'FAIL' && witnessed(result)))) return 'FAIL';
  if (!candidateAttested || ids.size === 0 || ids.size !== requiredCheckIds.length ||
      groups.some((group) => group.length !== 1 || group[0]!.outcome !== 'PASS' || !witnessed(group[0]!))) {
    return 'INCONCLUSIVE';
  }
  return 'PASS';
}

export const AdapterCapabilitiesSchema = z.object({
  adapter_id: IdentifierSchema,
  adapter_version: IdentifierSchema,
  kind: ApplicationKindSchema,
  operations: z.array(IdentifierSchema).min(1),
  telemetry: z.enum(['none', 'partial', 'instrumented']),
  cancellation: z.enum(['unsupported', 'best_effort', 'confirmed']),
  write_retry: z.enum(['unsupported', 'reconcile', 'target_idempotency']),
}).strict();

const TargetBindingSchema = z.object({
  kind: ApplicationKindSchema,
  target_version: IdentifierSchema,
}).strict();
const OperationSchema = z.enum([
  'agent.message', 'agent.handoff', 'api.request', 'state.observe', 'browser.journey',
  'mobile.journey', 'desktop.journey', 'voice.session',
]);
const expectedKind: Record<z.infer<typeof OperationSchema>, ApplicationKind> = {
  'agent.message': 'agent', 'agent.handoff': 'agent', 'api.request': 'api',
  'state.observe': 'api', 'browser.journey': 'web', 'mobile.journey': 'mobile',
  'desktop.journey': 'desktop', 'voice.session': 'voice',
};
export const ScenarioSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  scenario_id: IdentifierSchema,
  requirement_ref: IdentifierSchema,
  targets: z.record(IdentifierSchema, TargetBindingSchema),
  fixture_version: IdentifierSchema,
  steps: z.array(z.object({
    id: IdentifierSchema,
    target: IdentifierSchema,
    operation: OperationSchema,
    input: z.record(z.string(), z.json()),
    observation_window_seconds: z.number().int().min(1).max(300).optional(),
  }).strict()).min(1).max(100),
  checks: z.array(z.object({
    id: IdentifierSchema,
    kind: z.enum(['state', 'ui', 'tool', 'rubric']),
    severity: z.enum(['critical', 'major', 'minor']),
    required: z.boolean(),
    expected: z.json(),
  }).strict()).min(1).max(100),
  limits: z.object({
    execution_timeout_seconds: z.number().int().min(1).max(3600),
    max_turns: z.number().int().min(1).max(100),
    platform_spend_cap_usd: z.number().finite().nonnegative(),
  }).strict(),
}).strict().superRefine((scenario, context) => {
  const ids = new Set<string>();
  scenario.steps.forEach((step, index) => {
    if (ids.has(step.id)) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'id'], message: 'Step IDs must be unique.' });
    }
    ids.add(step.id);
    const target = scenario.targets[step.target];
    if (!target) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'target'], message: 'Target alias is not bound.' });
    } else if (target.kind !== expectedKind[step.operation]) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'operation'], message: 'Operation does not match the target application class.' });
    }
    if (step.operation === 'state.observe' && step.observation_window_seconds === undefined) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'observation_window_seconds'], message: 'State observations require an explicit window.' });
    }
  });
  const checks = new Set<string>();
  scenario.checks.forEach((check, index) => {
    if (checks.has(check.id)) {
      context.addIssue({ code: 'custom', path: ['checks', index, 'id'], message: 'Check IDs must be unique.' });
    }
    checks.add(check.id);
    if (check.severity === 'critical' && !check.required) {
      context.addIssue({ code: 'custom', path: ['checks', index, 'required'], message: 'Critical invariants must be required.' });
    }
  });
  if (!scenario.checks.some((check) => check.required)) {
    context.addIssue({ code: 'custom', path: ['checks'], message: 'At least one required check is necessary.' });
  }
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const CandidateSchema = z.object({
  target_version: IdentifierSchema,
  application_build: z.string().min(1).nullable(),
  agent_configuration: z.string().min(1).nullable(),
  attested: z.boolean(),
}).strict();
export const RunManifestSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  run_id: z.uuid(),
  project_id: z.uuid(),
  scenario_version: IdentifierSchema,
  dataset_version: IdentifierSchema,
  fixture_version: IdentifierSchema,
  evaluator_bundle: IdentifierSchema,
  policy_version: IdentifierSchema,
  candidate_set: z.record(IdentifierSchema, CandidateSchema).refine(
    (candidates) => Object.keys(candidates).length > 0, 'At least one target candidate is required.',
  ),
}).strict();
export const RunEventSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  event_id: z.uuid(),
  run_id: z.uuid(),
  step_id: IdentifierSchema,
  operation_id: z.uuid(),
  attempt_id: z.uuid(),
  source: IdentifierSchema,
  sequence: z.number().int().nonnegative(),
  occurred_at: z.iso.datetime(),
  ingested_at: z.iso.datetime(),
  type: IdentifierSchema,
  evidence_refs: z.array(IdentifierSchema),
}).strict();

export const DependencyNameSchema = z.enum(['postgres', 'temporal', 'coordinator', 'fixture']);
export const DependencyStatusSchema = z.object({
  name: DependencyNameSchema,
  status: z.enum(['healthy', 'unavailable']),
  latency_ms: z.number().finite().nonnegative(),
  message: z.string(),
}).strict();
export type DependencyStatus = z.infer<typeof DependencyStatusSchema>;
export const SystemSnapshotSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  product: z.literal('Veriqo'),
  environment: z.literal('local-development'),
  observed_at: z.iso.datetime(),
  overall_status: z.enum(['healthy', 'degraded']),
  dependencies: z.array(DependencyStatusSchema).length(4).refine(
    (dependencies) => new Set(dependencies.map((item) => item.name)).size === 4,
    'Each required dependency must be observed exactly once.',
  ),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.overall_status === 'healthy' && snapshot.dependencies.some((item) => item.status !== 'healthy')) {
    context.addIssue({ code: 'custom', path: ['overall_status'], message: 'Unavailable dependencies cannot produce a healthy snapshot.' });
  }
});
export type SystemSnapshot = z.infer<typeof SystemSnapshotSchema>;
export const CapabilitiesResponseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  application_classes: z.array(z.object({
    kind: ApplicationKindSchema,
    qualification: z.literal('planned'),
  }).strict()),
}).strict();
export const ScenarioValidationSchema = z.discriminatedUnion('valid', [
  z.object({
    valid: z.literal(true),
    schema_version: z.literal(SCHEMA_VERSION),
    target_count: z.number().int().positive(),
    step_count: z.number().int().positive(),
    required_check_count: z.number().int().positive(),
  }).strict(),
  z.object({
    valid: z.literal(false),
    issues: z.array(z.object({ path: z.string(), message: z.string() }).strict()),
  }).strict(),
]);
export type ScenarioValidation = z.infer<typeof ScenarioValidationSchema>;
export const FoundationProbeInputSchema = z.object({ correlation_id: z.uuid() }).strict();
export type FoundationProbeInput = z.infer<typeof FoundationProbeInputSchema>;
export type FoundationProbeResult = {
  correlation_id: string;
  database: 'healthy';
  fixture: 'healthy';
  checked_at: string;
};

export const exampleScenario: Scenario = {
  schema_version: SCHEMA_VERSION,
  scenario_id: 'create-one-support-ticket',
  requirement_ref: 'REQ-TICKET-014',
  targets: {
    agent: { kind: 'agent', target_version: 'support-agent-v1' },
    state: { kind: 'api', target_version: 'support-observer-v1' },
    portal: { kind: 'web', target_version: 'support-portal-v1' },
  },
  fixture_version: 'two-tenant-support-v1',
  steps: [
    { id: 'request', target: 'agent', operation: 'agent.message', input: { message: 'Create an urgent ticket about my invoice.' } },
    { id: 'observe', target: 'state', operation: 'state.observe', input: { reader: 'tickets-for-run' }, observation_window_seconds: 15 },
    { id: 'confirm', target: 'portal', operation: 'browser.journey', input: { journey: 'ticket-visible-to-requester' } },
  ],
  checks: [
    { id: 'one-ticket', kind: 'state', severity: 'critical', required: true, expected: { count: 1 } },
    { id: 'tenant-and-requester', kind: 'state', severity: 'critical', required: true, expected: { tenant: 'fixture.tenant', requester: 'fixture.requester' } },
    { id: 'visible-in-portal', kind: 'ui', severity: 'major', required: true, expected: { visible: true } },
  ],
  limits: { execution_timeout_seconds: 120, max_turns: 6, platform_spend_cap_usd: 0.5 },
};
