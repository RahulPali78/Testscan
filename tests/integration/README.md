# Integration coverage

Run pnpm test:integration. The current tests are colocated at
apps/coordinator/test/integration.test.ts so the Temporal client resolves through
its declared workspace dependency. The runner starts real PostgreSQL/Temporal,
applies migrations, launches fixture/API/worker processes and cleans them up.

Checks cover migration repeatability, actual API readiness and validation, and a
Temporal workflow whose activity queries PostgreSQL and calls the reference app.
Customer tenant isolation and production adapter qualification remain future work.
