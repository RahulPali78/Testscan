# Development foundation and shared contracts

Status: accepted for local development, 26 October 2026.

Use the agreed TypeScript, Next.js, Fastify, PostgreSQL and Temporal baseline.
Versioned Zod schemas are shared by the API and dashboard. Scenarios are validated
data with approved operation names, target classes, protected critical checks
and explicit observation windows. There is no uploaded executable code.

PostgreSQL and Temporal use pinned Compose services. SQL migrations are
transactional, advisory-lock serialized and protected against changed applied
files through checksums. The schema stores connectivity heartbeats only; it does
not stand in for future tenant/run persistence.

Network/database work stays in activities and API probes, outside replayed
workflows. The connectivity workflow proves worker polling and dependency calls;
it does not claim customer execution, idempotent effects or production readiness.

Missing dependency observations never pass readiness. No customer adapter is
qualified by liveness or successful schema validation. Default listeners are
loopback. Authentication, authorization, run admission, customer outcome assertions,
scoped secrets and deployment require their own reviewed implementation.

Tests use Node.js 24 with the tsx import hook and explicit in-process test
isolation. This ensures the pinned loader executes named assertions rather than
counting a successfully loaded TypeScript entry file as a passing test. Integration
checks separately verify actual services and Temporal polling.
