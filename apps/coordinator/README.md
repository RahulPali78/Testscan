# Temporal coordinator

A transactional-outbox dispatcher starts stable referenceRunWorkflow identities.
Activities load frozen inputs, execute one bounded reference action, independently
observe state, persist evidence and compensate fixtures. Workflow history carries
opaque run IDs. Separate cleanup retries preserve verdicts and fence stale work.

The heartbeat and foundationProbeWorkflow remain operational connectivity checks.
See docs/development.md and docs/implementation-status.md for limits and remaining
customer-runner, deployment, recovery and adapter qualification work.
