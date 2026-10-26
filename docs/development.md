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

## Sign-in and reference execution

The launcher generates random in-memory VERIQO_DEV_AUTH_SECRET and
VERIQO_SESSION_SECRET values, enables development authentication and seeds three
synthetic identities. Choose Developer (Alpha owner), Second workspace (Beta
owner), or Reviewer (Alpha viewer). Restarting the launcher signs out old sessions.
Development authentication is refused in production and on non-loopback API binds.

After signing in, review the reference scenario editor, publish its immutable
version, select a reference behavior and start a run. Correct behavior must PASS;
missing-write, duplicate-write and wrong-tenant behavior must FAIL even though the
agent response says success. Inspect independent assertions and export the JSON.
The browser adapter is not executed by this reference scenario.

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

The worker polls the configured task queue (default veriqo-foundation).
The dispatcher leases durable outbox rows and starts stable workflow IDs. Only a
run UUID enters workflow history; activities load inputs and store transcripts and
observations in the database. Unsafe business execution has one attempt; cleanup
is separate, idempotent and retried up to three times. A failed cleanup is visible,
blocks project admission and can be retried through the API/dashboard.

An observer must cover both synthetic tenants for the configured window before
PASS. A witnessed required failure wins; incomplete observations, build mismatch,
cancellation or interrupted execution cannot produce PASS. Queued runs expire
after five minutes. In-flight requests are bounded to five seconds. Cleanup closes
the namespace against late setup/action writes. A project admits at most five
active runs, and service-token issuance is capped at 20 active tokens.

foundationProbeWorkflow remains a connectivity check. Namespace/task-queue-scoped
heartbeats indicate recent coordinator activity, without claiming availability.

## Reference application

POST /fixtures creates a synthetic namespace using correct, missing-write,
duplicate-write or wrong-tenant mode. POST /fixtures/{namespace}/agent takes a
message. GET /fixtures/{namespace}/state independently reads both synthetic
tenants; /fixtures/{namespace} shows the intended customer's view. DELETE on
/fixtures/{namespace} provides repeat-safe cleanup.

The response deliberately says success in faulty modes. In-memory namespaces
expire after five minutes and are capped at 100. This is not a customer integration.

## Configuration and boundaries

Default listeners bind to 127.0.0.1. Use synthetic data on a trusted development
machine. Customer secret management, production egress and deployment remain
future work. Local PostgreSQL is an administrative development account, not a
least-privilege production database role.

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

## Product endpoints and authorization

All /v1 routes require a Bearer credential except /v1/auth/config and the explicit
development sign-in route. Public /health routes remain operational probes.

| Endpoint | Access |
| --- | --- |
| GET /v1/me | Verified identity and canonical project memberships. |
| POST /v1/workspaces | Human user creates an organisation, project and owner membership. |
| GET/POST /v1/projects/{project}/scenarios | Read latest versions / human editor publishes. |
| GET/POST /v1/scenarios/{scenario}/versions | Read immutable versions / human editor appends. |
| GET/POST /v1/projects/{project}/runs | Read runs / editor submits a published version. |
| GET /v1/runs/{run}; /events; /export | Project reader only, including every export. |
| POST /v1/runs/{run}/cancel; /cleanup | Project editor only. |
| POST /v1/projects/{project}/tokens | Human owner creates an expiring editor/viewer token. |
| DELETE /v1/projects/{project}/tokens/{token} | Human owner revokes a token. |

POST runs requires Idempotency-Key (8–120 safe characters) and a JSON body with
scenario_version_id and optional fixture_mode. Repeating the key with identical
inputs returns the existing run; different inputs return 409. Service tokens are
returned once. Keep them in CI secrets; they expire after 30 days by default.

The web BFF keeps access credentials in authenticated encryption inside HttpOnly
SameSite=Lax cookies (Secure in production); credentials do not enter localStorage.
Every mutation checks the configured VERIQO_APP_URL origin. Use that exact hostname
in your browser. The local default is http://127.0.0.1:3000.

## OIDC and Cognito configuration

Set VERIQO_AUTH_MODE to oidc or cognito in the independently launched API and web
services. Set OIDC_ISSUER to the exact HTTPS issuer, OIDC_CLIENT_ID to the web
client, and OIDC_JWKS_URI to its HTTPS signing-key endpoint. Generic OIDC additionally
requires OIDC_AUDIENCE for the API audience, distinct from the web ID-token audience.
Cognito verifies token_use=access and client_id; ID tokens cannot authorize API
requests. Configure the issuer with the appropriate resource/API audience and
OIDC_SCOPES (default openid profile). No user role or tenant claim grants membership.

Register VERIQO_APP_URL/api/auth/callback as the authorization-code redirect and
enable PKCE S256. The provider must publish HTTPS discovery metadata with an exact
issuer. Confidential clients use OIDC_CLIENT_SECRET and optionally
OIDC_TOKEN_AUTH_METHOD=client_secret_post; otherwise HTTP Basic is used. A public
PKCE client needs no client secret. The API validates the access token before the
web app stores a session. Refresh tokens are not stored; sign in again on expiry.
Sign out clears the local browser session, not every provider session.

In production set VERIQO_APP_URL to the fixed HTTPS public origin and provision a
random VERIQO_SESSION_SECRET of at least 32 characters through secret management.
The local launcher cannot run with NODE_ENV=production. Launch the web/API/worker
services separately behind reviewed TLS/network controls. Live provider login,
production hosting and key rotation require deployment-specific verification.
