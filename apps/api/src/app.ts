import Fastify from 'fastify';
import {
  ApplicationKindSchema, SCHEMA_VERSION, ScenarioSchema, SystemSnapshotSchema,
  type DependencyStatus,
} from '@veriqo/contracts';

export type DependencyProbe = () => Promise<DependencyStatus[]>;

export function buildApi(options: { probe: DependencyProbe; logger?: boolean }) {
  const app = Fastify({
    logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
    bodyLimit: 65536,
  });
  app.get('/health/live', async () => ({ status: 'ok', service: 'veriqo-api', schema_version: SCHEMA_VERSION }));

  const snapshot = async () => {
    const dependencies = await options.probe();
    return SystemSnapshotSchema.parse({
      schema_version: SCHEMA_VERSION, product: 'Veriqo', environment: 'local-development',
      observed_at: new Date().toISOString(),
      overall_status: dependencies.every((dependency) => dependency.status === 'healthy') ? 'healthy' : 'degraded',
      dependencies,
    });
  };
  app.get('/v1/system', snapshot);
  app.get('/health/ready', async (_request, reply) => {
    const result = await snapshot();
    return reply.code(result.overall_status === 'healthy' ? 200 : 503).send(result);
  });
  app.get('/v1/capabilities', async () => ({
    schema_version: SCHEMA_VERSION,
    application_classes: ApplicationKindSchema.options.map((kind) => ({ kind, qualification: 'planned' as const })),
  }));
  app.post('/v1/scenarios/validate', {
    schema: { body: {} },
  }, async (request, reply) => {
    const result = ScenarioSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({
        valid: false,
        issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      });
    }
    return {
      valid: true, schema_version: SCHEMA_VERSION,
      target_count: Object.keys(result.data.targets).length,
      step_count: result.data.steps.length,
      required_check_count: result.data.checks.filter((check) => check.required).length,
    };
  });
  app.setErrorHandler((error, request, reply) => {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ code: 'INVALID_REQUEST', message: 'Request format or size is not supported.' });
    }
    request.log.error({ code: 'REQUEST_FAILED' }, 'Request failed');
    return reply.code(503).send({ code: 'SERVICE_UNAVAILABLE', message: 'The development service could not complete this request.' });
  });
  return app;
}
