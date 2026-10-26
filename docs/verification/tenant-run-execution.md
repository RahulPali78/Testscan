# Authenticated reference execution verification

Recorded 26 October 2026 using Node.js 24.19.0, pnpm 11.25.0, pinned local
PostgreSQL/Temporal images, Python Playwright 1.62.0 and Debian Chromium
154.0.8037.57. Only synthetic development fixtures were used.

## Checks

- pnpm check: 17 unit/API/contract/migration checks passed; six real integration checks are intentionally skipped in this command.
- pnpm build: optimized Next.js production build, TypeScript checks and page generation passed.
- Real HTTP/PostgreSQL/Temporal integration: six checks passed with no skipped cases.
- Browser console check: sign-in, encrypted HttpOnly session, no localStorage credential, same-origin protection, publication, PASS/FAIL, JSON export, tenant isolation, viewer restrictions, logout and mobile layout passed with no page errors.

Integration checks verified immutable published versions/manifests/evidence,
composite tenant foreign keys, guessed cross-tenant read/export/cancel/cleanup
identifiers, disabled accounts, service-token hashing/revocation and refusal to
publish criteria, idempotent admission/conflicts, atomic five-run admission,
full-window observations, correct/missing/duplicate/wrong-tenant outcomes,
queued/running cancellation, cleanup completion/retry, missing required evidence
and stale attempt fencing. Exported manifest hashes match their canonical content.

## Reproduce

    pnpm install --frozen-lockfile
    pnpm check
    pnpm build
    pnpm test:integration

Start pnpm dev, then follow tests/browser/README.md for the browser check. During
this session API/fixture/dashboard used ports 14000/14100/3001 and the task queue
veriqo-tenant-review to avoid another development instance. Default commands use
4000/4100/3000 and veriqo-foundation. Startup rejects occupied application ports.

Browser artifacts are available in this workspace under
/workspace/shared/downloads/veriqo-tenant-execution (desktop-pass.png,
desktop-fault.png, mobile-reviewer.png and run-evidence.json); they are not source
files or committed customer data. The reproducible check generates fresh artifacts.

## Limits

Live OIDC/Cognito login, non-owner production database roles/RLS, cloud deployment,
production isolation and secrets, retained object-store artifacts, arbitrary
customer targets and all remaining application adapters were not qualified by
these checks. See implementation-status.md and the 72-task product backlog.
