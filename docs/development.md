# Local development

## Prerequisites

- Node.js 24.19.0 and pnpm 11.25.0, pinned in the repository.
- Docker with the Compose plugin; the daemon must be running.
- Free loopback ports 3000, 4000, 4100, 5432, 7233 and 8233.

Install dependencies and start the development foundation:

    pnpm install --frozen-lockfile
    pnpm dev

The first start downloads pinned container images. Startup waits for PostgreSQL
and Temporal, applies migrations, starts the synthetic app, coordinator, API and
dashboard, then waits for actual readiness. Missing dependencies fail startup
with actionable output. There is no mock fallback or seeded healthy status.

Copy .env.example to .env when needed. Existing shell environment variables take
precedence. Example credentials are for local synthetic development only.

## Commands

| Command | Behavior |
| --- | --- |
| pnpm dev | Start containers, migrate and launch application processes. |
| pnpm dev:apps | Use existing dependencies, migrate and launch apps. |
| pnpm infra:up | Start PostgreSQL and Temporal. |
| pnpm infra:down | Stop containers; preserve named volumes. |
| pnpm db:migrate | Apply migrations; reject changed applied files. |
| pnpm check | Workspace/backlog checks, types and unit/API tests. |
| pnpm build | Build the Next.js dashboard. |
| pnpm test:integration | Test actual migrations, API and Temporal execution. |

Ctrl+C stops application processes. Stop infrastructure explicitly when finished.

## Implemented API

| Endpoint | Purpose |
| --- | --- |
| GET /health/live | Process liveness only. |
| GET /health/ready | 200 when all four dependencies are healthy; otherwise 503. |
| GET /v1/system | Timestamped dependency observations. |
| GET /v1/capabilities | Six committed classes, still marked Planned. |
| POST /v1/scenarios/validate | Validate scenario data; never execute/publish it. |

The dashboard uses server-side Next.js proxies. Database addresses and credentials
are not sent to the browser. Validation requests are bounded to 64 KiB.

## Temporal worker

The worker polls veriqo-foundation in the default namespace.
foundationProbeWorkflow delegates a PostgreSQL query and reference-app health
request to an activity. It proves worker polling, not customer workflow execution
or external action idempotency. A namespace/task-queue-scoped database heartbeat indicates recent activity;
readiness is operational evidence, not a production availability guarantee.

## Reference application

POST /fixtures creates a synthetic namespace using correct, missing-write,
duplicate-write or wrong-tenant mode. POST /fixtures/{namespace}/agent takes a
message. GET /fixtures/{namespace}/state independently reads both synthetic
tenants; /fixtures/{namespace} shows the intended customer's view. DELETE on
/fixtures/{namespace} provides repeat-safe cleanup.

The response deliberately says success in faulty modes. In-memory namespaces
expire after five minutes and are capped at 100. This is not a customer integration.

## Configuration and boundaries

Default listeners bind to 127.0.0.1. Authentication, tenant membership, scoped
customer secrets, production egress and deployment remain future work. Use only
synthetic data on a trusted development machine.

DATABASE_URL, TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, TEMPORAL_TASK_QUEUE, API_HOST,
API_PORT, VERIQO_API_URL, FIXTURE_HOST, FIXTURE_PORT, FIXTURE_URL and PORT appear in
.env.example. For changed container ports set VERIQO_POSTGRES_PORT,
VERIQO_TEMPORAL_PORT or VERIQO_TEMPORAL_UI_PORT and update connection settings.

Temporal uses its pinned non-root user. A one-shot container initializes ownership
of its dedicated named volume without mounting or changing host directories.

## Git and CI

Use reviewed feature branches. Run checks, maintain the lockfile and record
acceptance evidence. The CI template covers installation, checks, dashboard build
and integration tests. A maintainer with workflow-write permission must activate
it as described in docs/ci/README.md.
