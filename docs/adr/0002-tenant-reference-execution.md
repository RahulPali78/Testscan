# ADR 0002: authenticated reference execution

Status: accepted for the development implementation, 26 October 2026.

Verified issuer/subject identities map to database users. Canonical project
memberships determine authorization; JWT tenant/role claims do not. Human editors
publish protected expectations. Revocable project service tokens may execute
published versions but cannot publish criteria or issue credentials.

Scenario publication appends versions. Admission freezes the scenario, adapter,
fixture, candidate and evaluator identities and hashes, then commits the run and
outbox together. Composite foreign keys scope resources. PostgreSQL triggers reject
changes to published versions, manifests, assertions, evidence and audit history.
These development controls do not replace production non-owner service roles/RLS.

The dispatcher uses stable Temporal workflow IDs. Workflow history carries opaque
run IDs rather than raw transcripts. Activities load records and persist evidence.
Business execution has one attempt: worker loss or ambiguous writes must not
automatically replay an unsafe action. Independent cleanup has retries and rotates
the completion fence. Exhausted cleanup remains visible and blocks project reuse.

The only executable adapter invokes the synthetic support agent and independently
observes both synthetic tenants. Publication rejects unsupported mandatory
operations. Count, ownership and required fields remain distinct assertions.
Observation must cover the configured window before PASS; witnessed required FAIL
wins even when execution later becomes incomplete. Cancellation cannot PASS.
Correctness and cleanup status remain separate.

Browser access tokens stay inside encrypted HttpOnly cookies. OIDC uses code,
PKCE, state and nonce; the API validates the access JWT independently. The explicit
development mode has fixed synthetic identities and fresh random secrets, and is
refused in production or on non-loopback API listeners. Live provider integration,
production networking, secret management, retention and remaining adapters still
require their own implementation and qualification evidence.
