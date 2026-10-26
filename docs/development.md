# Local development

## Toolchain

Node.js 24.19.0 is recorded in `.node-version`; pnpm 11.25.0 is recorded in
`package.json`. Install those versions using your preferred approved toolchain
manager, then run:

```sh
pnpm install --frozen-lockfile
pnpm check
```

There are no third-party runtime dependencies in this bootstrap. The `check`
command uses Node built-ins and runs without network access.

## Next engineering changes

1. Approve requirements and the platform/version matrix (E2E-101).
2. Freeze multi-target scenario, adapter and event contracts (E2E-103).
3. Add Next.js, Fastify, Temporal and PostgreSQL dependencies with pinned versions
   and an updated lockfile as each component is implemented.
4. Add documented local PostgreSQL, Temporal, synthetic targets and object storage.
5. Build tenant-scoped run admission, dispatch, independent outcome checks and run detail.

Each module README identifies its intended boundary. Empty module manifests are
workspace scaffolding, not runnable services. OS/device/audio executors require
appropriate hosts and explicit permissions; they cannot all run inside one Linux
container.

## Git workflow

Start feature work on a branch based on the repository's default branch. Run the
relevant checks, commit bounded changes, push the branch and open a pull request.
Keep business assertions and security boundaries independently reviewable. No
force-push or default-branch protection changes are required by this workflow.

Never commit credentials, raw customer evidence or local environment files.
Introduce `.env.example` with variable names and placeholders when services need it.
