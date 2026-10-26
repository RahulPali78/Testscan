# PostgreSQL persistence

Checksummed transactional migrations, canonical identity/memberships, scoped
project repositories, immutable scenario versions/run manifests, append-only
evidence/assertions/audit records and a transactional dispatch outbox. Run admission
serializes project concurrency and idempotency decisions. Workers use attempt
fences; cleanup failures block new project runs.

Local development uses an administrative synthetic database account. Production
non-owner service roles, RLS, retention/deletion and security review remain required.
See docs/development.md for configuration and commands.
