import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';

export type FixtureMode = 'correct' | 'missing-write' | 'duplicate-write' | 'wrong-tenant';
type Ticket = { id: string; tenant_id: string; requester_id: string; title: string; priority: string };
type Fixture = {
  namespace: string; mode: FixtureMode; tenant_id: string; other_tenant_id: string;
  requester_id: string; tickets: Ticket[]; expires_at: number;
  actions: Map<string, string>;
};
const modes = new Set<FixtureMode>(['correct', 'missing-write', 'duplicate-write', 'wrong-tenant']);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function buildReferenceApp() {
  const app = Fastify({ bodyLimit: 8192 });
  const fixtures = new Map<string, Fixture>();
  const tombstones = new Map<string, number>();
  const sweep = setInterval(() => {
    for (const [id, fixture] of fixtures) if (fixture.expires_at < Date.now()) fixtures.delete(id);
    for (const [id, expiry] of tombstones) if (expiry < Date.now()) tombstones.delete(id);
  }, 30000);
  sweep.unref();
  app.addHook('onClose', async () => { clearInterval(sweep); });
  app.get('/health/live', async () => ({ status: 'ok', service: 'veriqo-support-fixture', version: 'foundation-v1' }));
  app.get('/', async (_request, reply) => reply.type('text/html').send(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Veriqo reference application</title><style>body{font:16px/1.7 system-ui;max-width:760px;margin:60px auto;padding:24px;color:#17312c}code{background:#edf5f2;padding:4px}h1{line-height:1.2}</style>' +
    '<h1>Synthetic support application</h1><p>This local reference app contains controlled correct, missing-write, duplicate-write and wrong-tenant modes. It is not a customer integration.</p>' +
    '<p>Create a namespace with <code>POST /fixtures</code> and a JSON <code>mode</code>. Invoke <code>POST /fixtures/{namespace}/agent</code> with a message, inspect <code>GET /fixtures/{namespace}/state</code>, and view <code>/fixtures/{namespace}</code>.</p>' +
    '<p>Delete the namespace after testing. Fixtures are in memory, capped at 100 namespaces and expire after five minutes. The authoritative observer deliberately sees both synthetic tenants.</p></html>',
  ));
  app.post<{ Body: { mode?: FixtureMode; namespace?: string } }>('/fixtures', async (request, reply) => {
    const mode = request.body?.mode ?? 'correct';
    if (!modes.has(mode)) return reply.code(400).send({ code: 'INVALID_MODE' });
    const namespace = request.body?.namespace ?? randomUUID();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(namespace)) return reply.code(400).send({ code: 'INVALID_NAMESPACE' });
    if (tombstones.has(namespace)) return reply.code(409).send({ code: 'FIXTURE_CLOSED' });
    const previous = fixtures.get(namespace);
    if (previous) {
      if (previous.mode !== mode) return reply.code(409).send({ code: 'FIXTURE_CONFLICT' });
      return { namespace, tenant_id: previous.tenant_id, requester_id: previous.requester_id };
    }
    if (fixtures.size >= 100) return reply.code(429).send({ code: 'FIXTURE_CAPACITY' });
    const fixture: Fixture = {
      namespace, mode, tenant_id: namespace + ':tenant-a', other_tenant_id: namespace + ':tenant-b',
      requester_id: namespace + ':requester', tickets: [], actions: new Map(), expires_at: Date.now() + 300000,
    };
    fixtures.set(namespace, fixture);
    return reply.code(201).send({ namespace, tenant_id: fixture.tenant_id, requester_id: fixture.requester_id });
  });
  app.post<{ Params: { namespace: string }; Body: { message?: string } }>('/fixtures/:namespace/agent', async (request, reply) => {
    const fixture = fixtures.get(request.params.namespace);
    if (!fixture || fixture.expires_at < Date.now()) return reply.code(404).send({ code: 'FIXTURE_NOT_FOUND' });
    const message = request.body?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > 2000) {
      return reply.code(400).send({ code: 'INVALID_MESSAGE' });
    }
    const key = request.headers['idempotency-key'];
    if (key !== undefined && (typeof key !== 'string' || key.length > 160)) return reply.code(400).send({ code: 'INVALID_KEY' });
    if (key && fixture.actions.has(key)) {
      if (fixture.actions.get(key) !== message) return reply.code(409).send({ code: 'ACTION_CONFLICT' });
      return { response: 'Done. Your ticket has been created.', namespace: fixture.namespace };
    }
    if (fixture.tickets.length >= 20) return reply.code(429).send({ code: 'ACTION_LIMIT' });
    const count = fixture.mode === 'missing-write' ? 0 : fixture.mode === 'duplicate-write' ? 2 : 1;
    for (let index = 0; index < count; index++) {
      fixture.tickets.push({
        id: randomUUID(),
        tenant_id: fixture.mode === 'wrong-tenant' ? fixture.other_tenant_id : fixture.tenant_id,
        requester_id: fixture.requester_id, title: message,
        priority: message.toLowerCase().includes('urgent') ? 'urgent' : 'normal',
      });
    }
    if (key) fixture.actions.set(key, message);
    return { response: 'Done. Your ticket has been created.', namespace: fixture.namespace };
  });
  app.get<{ Params: { namespace: string } }>('/fixtures/:namespace/state', async (request, reply) => {
    const fixture = fixtures.get(request.params.namespace);
    if (!fixture || fixture.expires_at < Date.now()) return reply.code(404).send({ code: 'FIXTURE_NOT_FOUND' });
    return {
      namespace: fixture.namespace, expected_tenant_id: fixture.tenant_id,
      expected_requester_id: fixture.requester_id, tickets: fixture.tickets,
      observer_coverage: 'both-synthetic-tenants',
    };
  });
  app.get<{ Params: { namespace: string } }>('/fixtures/:namespace', async (request, reply) => {
    const fixture = fixtures.get(request.params.namespace);
    if (!fixture || fixture.expires_at < Date.now()) return reply.code(404).send({ code: 'FIXTURE_NOT_FOUND' });
    const tickets = fixture.tickets.filter((ticket) => ticket.tenant_id === fixture.tenant_id);
    return reply.type('text/html').send(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Support tickets</title>' +
      '<body><h1>Customer support tickets</h1><p>Synthetic tenant: ' + escapeHtml(fixture.tenant_id) + '</p><ul>' +
      tickets.map((ticket) => '<li data-ticket-id="' + ticket.id + '">' + escapeHtml(ticket.title) + ' · ' + ticket.priority + '</li>').join('') +
      '</ul><p>' + tickets.length + ' visible ticket(s).</p></body></html>',
    );
  });
  app.delete<{ Params: { namespace: string } }>('/fixtures/:namespace', async (request, reply) => {
    fixtures.delete(request.params.namespace);
    // Late setup/action requests cannot recreate a namespace after compensation.
    if (tombstones.size >= 1000) return reply.code(429).send({ code: 'CLEANUP_CAPACITY' });
    tombstones.set(request.params.namespace, Date.now() + 300000);
    return reply.code(204).send();
  });
  return app;
}
