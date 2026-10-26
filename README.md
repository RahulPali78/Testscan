# Veriqo

End-to-end testing for applications and AI agents.

Repository: [RahulPali78/Testscan](https://github.com/RahulPali78/Testscan).

Veriqo is being built to execute complete business workflows across web applications,
APIs, AI agents, Android/iOS, desktop applications and voice, then independently
verify the real outcome and provide reproducible release evidence.

## Current status

The working increment includes authenticated workspaces and project roles,
immutable scenario versions, transactional run admission, a durable Temporal
execution workflow, independent state checks, evidence export and visible cleanup.
The dashboard can execute the synthetic reference support workflow and distinguish
correct, missing-write, duplicate-write and wrong-tenant behavior.

General customer connections, additional execution adapters, production deployment
and qualification remain in development. All six application classes remain
required for complete-product general availability. Start locally with pnpm dev,
then choose a synthetic account on the sign-in screen.

## Planning documents

- [Product and engineering blueprint](docs/product/veriqo-blueprint.html)
- [Complete implementation plan](docs/product/veriqo-build-plan.html)
- [Machine-readable backlog](docs/product/veriqo-backlog.json)
- [Implementation status](docs/implementation-status.md)
- [Local development](docs/development.md)

Download either HTML document and open it in a browser for offline reading,
search, local checklist annotations and printing. Checklist ticks do not verify
engineering completion. Estimates remain preliminary and have no committed final
delivery date.

## Workspace

```text
apps/       web dashboard, control API and durable coordinator
workers/    browser, API, agent, mobile, desktop and voice executors
packages/   contracts, persistence, adapters, evaluators, fixtures, usage, CLI and runners
tests/      conformance, integration, fault and independent assessment specifications
infra/      local and AWS EU deployment specifications
docs/       product plans, architecture decisions and operating documentation
```

## Run the bootstrap checks

Use Node.js 24.19.0 and pnpm 11.25.0:

```sh
pnpm install --frozen-lockfile
pnpm check
```

The check validates the workspace/backlog, type-checks implemented packages and
runs contract/API/activity/migration tests. See docs/development.md for details.

## Start the development foundation

Docker with Compose is required. After installing dependencies, run:

    pnpm dev

This starts pinned PostgreSQL and Temporal containers, applies checksummed
migrations and launches the dashboard, API, worker and reference application.

| Service | Default address |
| --- | --- |
| Dashboard | http://127.0.0.1:3000 |
| Control API | http://127.0.0.1:4000 |
| Synthetic reference application | http://127.0.0.1:4100 |
| Temporal UI | http://127.0.0.1:8233 |

Copy .env.example to .env to customize settings. Ctrl+C stops application
processes; pnpm infra:down stops containers while retaining their named volumes.
Use pnpm dev:apps with already-running PostgreSQL and Temporal.

Build the dashboard and test real dependency integration:

    pnpm build
    pnpm test:integration

## Continuous integration

The proposed workflow is stored at
[`docs/ci/workspace-checks.yml`](docs/ci/workspace-checks.yml).
It is a template and is not active yet: the repository transfer credential could
write source files but lacked permission to create GitHub Actions workflows.
An authorized maintainer can activate it by adding the template as
`.github/workflows/ci.yml` through GitHub or using a credential with workflow-write
permission. Local validation remains available through `pnpm check`.

## Implementation baseline

- TypeScript control platform; Next.js dashboard; Fastify API; Temporal orchestration.
- PostgreSQL metadata and protected object-storage evidence.
- AWS Ireland (`eu-west-1`) control services and enrolled specialized/private runners.
- Scoped credentials, immutable expected outcomes, independent state observers,
  explicit uncertainty, bounded execution and visible cleanup.

Shared platform tasks E2E-102 through E2E-108 are in progress, with reference
compensation work under E2E-203. See the implementation status for tested behavior
and outstanding gates. The next implementation increment is versioned customer
connections, secret resolution and adapter conformance, followed by production
execution isolation and the browser/API adapters.
