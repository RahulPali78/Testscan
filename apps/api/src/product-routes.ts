import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CreateWorkspaceSchema, ReferenceScenarioSchema, RunSubmitSchema, ProjectTokenRequestSchema } from '@veriqo/contracts/product';
import { ProductError, type Actor, type ProductStore } from '@veriqo/db/product';
import { DEVELOPMENT_ACCOUNTS } from '@veriqo/db/development';
import type { AuthGateway } from './auth.js';

export function productRoutes(app: FastifyInstance, auth: AuthGateway, store: ProductStore) {
  const actors = new WeakMap<FastifyRequest, Actor>();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/v1/') || ['/v1/auth/config', '/v1/auth/development'].includes(path)) return;
    actors.set(request, await store.resolveActor(await auth.authenticate(request.headers.authorization)));
  });
  const actor = (request: FastifyRequest) => {
    const result = actors.get(request);
    if (!result) throw new ProductError(401, 'UNAUTHORIZED', 'Sign in to continue.');
    return result;
  };
  const id = (request: FastifyRequest, name: string) => z.uuid().parse((request.params as Record<string, string>)[name]);
  app.get('/v1/auth/config', async () => ({ mode: auth.mode, accounts: auth.mode === 'development' ? DEVELOPMENT_ACCOUNTS.map(({ id, label }) => ({ id, label })) : [] }));
  app.post('/v1/auth/development', async (request) => {
    const input = z.object({ account_id: z.string() }).strict().parse(request.body);
    return auth.loginDevelopment(input.account_id);
  });
  app.get('/v1/me', async (request) => ({ ...await store.session(actor(request)), auth_mode: auth.mode }));
  app.post('/v1/workspaces', async (request, reply) => {
    const input = CreateWorkspaceSchema.parse(request.body);
    return reply.code(201).send(await store.createWorkspace(actor(request), input.name, input.project_name));
  });
  app.get('/v1/projects/:projectId/scenarios', (request) => store.listScenarios(actor(request), id(request, 'projectId')));
  const publish = async (request: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const input = z.object({ scenario: ReferenceScenarioSchema }).strict().safeParse(request.body);
    if (!input.success) return reply.code(422).send({ code: 'UNSUPPORTED_SCENARIO', message: 'Scenario cannot execute on the reference adapter.', issues: input.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
    const params = request.params as Record<string, string>;
    return reply.code(201).send(await store.publish(actor(request), input.data.scenario,
      params.projectId ? id(request, 'projectId') : undefined, params.scenarioId ? id(request, 'scenarioId') : undefined));
  };
  app.post('/v1/projects/:projectId/scenarios', publish);
  app.post('/v1/scenarios/:scenarioId/versions', publish);
  app.get('/v1/scenarios/:scenarioId/versions', (request) => store.versions(actor(request), id(request, 'scenarioId')));
  app.get('/v1/projects/:projectId/runs', (request) => store.listRuns(actor(request), id(request, 'projectId')));
  app.post('/v1/projects/:projectId/runs', async (request, reply) => {
    const key = z.string().min(8).max(120).regex(/^[A-Za-z0-9_.:-]+$/).parse(request.headers['idempotency-key']);
    return reply.code(202).send(await store.submit(actor(request), id(request, 'projectId'), key, RunSubmitSchema.parse(request.body)));
  });
  app.get('/v1/runs/:runId', (request) => store.run(actor(request), id(request, 'runId')));
  app.get('/v1/runs/:runId/events', async (request) => (await store.run(actor(request), id(request, 'runId'))).evidence);
  app.get('/v1/runs/:runId/export', async (request, reply) => {
    const runId = id(request, 'runId');
    reply.header('content-disposition', 'attachment; filename="veriqo-' + runId + '.json"');
    return store.run(actor(request), runId);
  });
  app.post('/v1/runs/:runId/cancel', (request) => store.cancel(actor(request), id(request, 'runId')));
  app.post('/v1/runs/:runId/cleanup', (request) => store.retryCleanup(actor(request), id(request, 'runId')));
  app.post('/v1/projects/:projectId/tokens', (request) => store.createToken(actor(request), id(request, 'projectId'), ProjectTokenRequestSchema.parse(request.body)));
  app.delete('/v1/projects/:projectId/tokens/:tokenId', async (request, reply) => {
    await store.revokeToken(actor(request), id(request, 'projectId'), id(request, 'tokenId'));
    return reply.code(204).send();
  });
}
