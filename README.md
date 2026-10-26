# Veriqo

End-to-end testing for applications and AI agents.

Repository: [RahulPali78/Testscan](https://github.com/RahulPali78/Testscan).

Veriqo is being built to execute complete business workflows across web applications,
APIs, AI agents, Android/iOS, desktop applications and voice, then independently
verify the real outcome and provide reproducible release evidence.

## Current status

This initial repository contains the complete-product planning documents, a shared
72-task backlog, a pnpm workspace structure and automated bootstrap checks.
Application services, execution adapters and infrastructure are **planned**, not
implemented. There is no runnable dashboard or testing service yet. All six
application classes remain required for complete-product general availability.

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

The check validates workspace metadata, document anchors, the shared backlog,
task dependencies and cross-document consistency. It does not test application
features that have not been implemented.

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

Begin with E2E-101 (requirements and compatibility matrix) and E2E-102 (development
foundation). Add runtime dependencies and service implementations through reviewed
changes with reproducible acceptance evidence.
