# Versioned shared contracts

Implemented: version 2.0 Zod schemas for application, scenario, target/candidate, event,
assertion, verdict, readiness and validation schemas. Scenario validation protects
critical checks, bound target classes, unique identifiers and observation windows.
Verdict aggregation cannot pass empty/missing evidence or unattested candidates.

E2E-103 is In progress. These data schemas do not attest deployed versions,
implement adapter capabilities or authorize customer execution by themselves.
