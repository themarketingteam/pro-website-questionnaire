# Staging legacy migration and retention certification

- Date: 2026-08-06
- Classification: **LEGACY_MIGRATION_AND_RETENTION_FAILED**
- Source commit: `d67f126ef47e0776548302b7323a314bd5a7e680`
- Source branch: `feature/durable-draft-recovery`
- Staging app ID/name/URL: **NOT INSPECTED — source hard stop**
- Production access: **NONE**

## Executive result

The ordered primary-checkout source gate failed at `npm test`. Prompt 4 says
to stop on any pre-deployment failure, so the attempt ended before staging
checkout update, `npx base44 whoami`, target guard, secret generation/import,
retention configuration, entity push, function deployment, synthetic data,
live function invocation, RLS probing, cleanup, or remote Git push.

This report does not certify staging. It records the exact safe source evidence
and every live matrix as `NOT RUN` rather than inferring results.

## Pre-deployment source validation

| Command | Exit | Observed result |
| --- | ---: | --- |
| `git fetch --all --tags --prune` | 0 | Fetch completed. |
| `node scripts/ensure-durable-draft-workspace.mjs --mode check --branch feature/durable-draft-recovery` | 0 | `WORKSPACE_READY`; clean branch at the source commit above. |
| `npm ci` | 0 | 775 packages installed/audited. npm reported 29 vulnerabilities (1 low, 8 moderate, 18 high, 2 critical) and six pending install-script approvals. No audit mutation was authorized. |
| `npx vitest run --config src/vitest.config.js src/test/proDraftLegacyMigration.test.js scripts/analyze-pro-form-legacy-data.test.js --reporter=dot --no-coverage` | 0 | 29/29 legacy analysis tests passed. |
| `npm run test:migration-execution` | 0 | 94/94 migration/checkpoint/token/admin/function tests passed. |
| `npx vitest run --config src/vitest.config.js src/test/proDraftLegacyMigration.test.js src/test/proDraftMigrationExecution.test.js --testNamePattern=duplicate --reporter=dot --no-coverage` | 0 | 8 duplicate-focused tests passed; 38 nonmatching tests skipped. |
| `npm run test:retention` | 0 | 48/48 retention/checkpoint/admin tests passed. |
| `npx vitest run --config src/vitest.config.js src/test/proFormMigrationCheckpointSchema.test.js --reporter=dot --no-coverage` | 0 | 4/4 checkpoint schema tests passed. |
| `npx vitest run --config src/vitest.config.js src/test/proDraftAdminAuthorization.test.js src/test/proDraftAdminRequest.test.js src/test/proDraftFunctionAuthorizationOrderContract.test.js --reporter=dot --no-coverage` | 0 | 58/58 admin authorization/order tests passed. |
| `npx vitest run --config src/vitest.config.js src/test/proFormDraftEntityRls.test.js src/test/proDraftRlsAttackContract.test.js scripts/precheck-draft-rls-deployment.test.js --reporter=dot --no-coverage` | 0 | 16/16 local RLS/precheck tests passed. |
| `npm run test:admin-no-direct-entities` | 0 | Admin entity boundary passed across eight source files. |
| `npm run test:no-sensitive-frontend-entities` | 0 | Sensitive entity source+built policy passed. |
| `npm run test:sensitive-service-role` | 0 | Sensitive service-role policy passed. |
| `npm test` | 1 | **Hard stop:** 143 files passed, 2 failed; 1,972 tests passed and 3 failed. |

The three failures were:

1. `proQuestionnaire.regression.test.jsx`: geographic latitude/longitude zero
   normalized as string `"0"` instead of number `0`.
2. `proSubmissionRepairHelpers.test.js`: whitespace-only service offering was
   retained instead of filtered.
3. `proSubmissionRepairHelpers.test.js`: expected keyed `taggedPeople`
   coercion warning was absent.

React `act(...)`, stale `baseline-browser-mapping`, and stale Browserslist data
warnings were also emitted. Per the hard-stop rule, `npm run lint`,
`npm run typecheck`, and `npm run build` were not run in this attempt.

## Staging configuration and deployment

| Item | Result |
| --- | --- |
| Staging checkout fetch/fast-forward | `NOT RUN — SOURCE GATE FAILED` |
| Staging fingerprint and target guard | `NOT RUN — SOURCE GATE FAILED` |
| `npx base44 whoami` | `NOT RUN — SOURCE GATE FAILED` |
| Migration/retention secret generation | `NOT RUN`; no temporary env file created |
| Retention configuration values | `NOT RUN` |
| `ProFormMigrationCheckpoint` entity push | `NOT RUN` |
| Sensitive RLS inspection | `NOT RUN` |
| Seven targeted function deployments | `NOT RUN` |
| Scheduled automation enablement | `NOT RUN`; local declaration remains disabled/dry-run |

No secret value was generated, printed, stored, imported, copied, or deleted.
No `npx base44` command was executed.

## Legacy migration matrix

| Required evidence | Result |
| --- | --- |
| 15-case synthetic corpus and unique test-run ID | `NOT RUN` |
| Bounded dry run, classifications, safe report, checkpoint/resume | `NOT RUN` |
| Apply token, interrupted apply, resume, idempotency | `NOT RUN` |
| Submitted lock and compatibility preservation | `NOT RUN` |
| Valid/invalid legacy email behavior and no invented code | `NOT RUN` |
| Changed-source fingerprint skip | `NOT RUN` |
| Zero-delete reconciliation | `NOT RUN` |

## Duplicate matrix

| Scenario | Result |
| --- | --- |
| Active canonical/superseded lineage | `NOT RUN` |
| Submitted/active cross-partition rejection | `NOT RUN` |
| Ambiguous group/manual review | `NOT RUN` |
| No merge/no delete/audit event | `NOT RUN` |

## Limited rollback

Rollback dry run, reversible metadata apply, answer/submitted preservation,
changed-field protection, manual-review accuracy, and optional reapply were
`NOT RUN`.

## Retention matrix

| Required evidence | Result |
| --- | --- |
| 10-case synthetic retention corpus | `NOT RUN` |
| Eligible/protected/manual/event estimates | `NOT RUN` |
| Submitted, hold, repair, and replacement exclusions | `NOT RUN` |
| Safe report and checkpoint/resume | `NOT RUN` |
| Report-bound test-only apply and re-evaluation | `NOT RUN` |
| Event-before-draft deletion and protected preservation | `NOT RUN` |
| Simulated interruption/resume | `NOT RUN` |
| Scheduled function remains dry-run | `NOT RUN` |

## Security and RLS

Local source tests passed for admin authorization ordering, token/report
binding, environment rejection, sensitive service-role use, and entity RLS.
Live anonymous checkpoint denial, deployed function authorization, report
redaction, cross-environment behavior, and staging app isolation were
`NOT RUN`; local tests are not live certification.

## Cleanup

No synthetic record or migration artifact was created, so no cleanup mutation
was required. A live zero-remaining query was not run because it would require
entering the staging phase after a failed source gate. No non-test staging data
was read, changed, or deleted.

## Limitations before production

- Production inventory was not performed.
- A production backup and restore rehearsal remain required.
- The blue/green migration utility is not certified.
- No production destructive-retention approval exists.
- Staging schema/function/filter/RLS behavior is unverified.
- Resume/idempotency, duplicate, rollback, retention, scheduled dry-run, and
  cleanup evidence remain local-only until the source gate passes.

## Git and environment safety

The feature branch was not pushed because the prompt permits pushing only
after successful certification. Verification that all four batch prompts
exist remotely therefore remains pending. `main` was not changed or pushed.
Production remained untouched, and no non-test data was deleted.
