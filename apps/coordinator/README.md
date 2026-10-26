# Temporal development coordinator

Implemented: a real task-queue worker, PostgreSQL heartbeat and foundationProbeWorkflow.
The workflow delegates database/fixture calls to an activity, preserving deterministic
workflow code. Integration tests execute it against the local Temporal server.

This proves development connectivity only. Customer run state, retries around
external writes, cancellation reconciliation and compensation remain future work.
