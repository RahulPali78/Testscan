# Veriqo control API foundation

Implemented: process liveness, actual dependency readiness, system observations,
planned capability disclosure and bounded scenario schema validation. A separate
local reference app supplies synthetic fault fixtures. See docs/development.md.

Listeners default to loopback. Tenant authentication/authorization, immutable
run creation, outbox dispatch and customer execution are not implemented.
