# PostgreSQL foundation

Implemented: bounded connection pool, development heartbeat helpers and checksummed
transactional migrations serialized with an advisory lock. Changed applied SQL
causes rollback instead of silently modifying history.

The first migration stores development connectivity metadata only. Tenant/project
repositories, row policies, immutable scenario/run data and transactional outbox
admission remain future work.
