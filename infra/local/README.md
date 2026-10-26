# Local services

Compose starts digest-pinned PostgreSQL 18.6 and Temporal CLI 1.9.1. Temporal uses
its development server and UI, retaining SQLite history in a dedicated named
volume. PostgreSQL persists data separately. Ports are published on loopback.

A one-shot container changes only the Temporal volume ownership to the pinned
service UID/GID 1000. Temporal remains non-root. No host directories are mounted.

Temporal appends loopback addresses, including its internal 0.0.0.0 bind address,
to the inherited NO_PROXY list. Existing outbound proxy settings remain unchanged.

Use pnpm dev for the full foundation, pnpm infra:up for dependencies and
pnpm infra:down to stop containers. Named volumes are retained. This is synthetic
local development infrastructure, not a production configuration.
