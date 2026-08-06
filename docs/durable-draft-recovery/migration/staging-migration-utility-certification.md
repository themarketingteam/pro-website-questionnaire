# Staging bidirectional migration utility certification

- Date: 2026-08-06
- Classification: **MIGRATION_UTILITY_FAILED**
- Source commit: `a16955f3b0ba61c61c86d871c9d9741d56e8ae39`
- Source branch: `feature/durable-draft-recovery`
- Registered staging app fingerprint: `682b3ba54771331270952c7f4a3ac25035417cc9376a93e8b14ffca2e77051f5` (**not freshly inspected**)
- Production access: **NONE**

## Executive result

The required pre-deployment gate stopped at `npm test`: 2,088 tests passed and
3 failed. Prompt 4 requires a stop on any source-validation failure, so this
attempt did not update the staging checkout, run its target guard, configure a
secret, push an entity, deploy a function, create a synthetic staging record,
invoke a migration endpoint, or access production.

The focused migration-policy, signed-bundle, export/import,
delta/reverse/file-audit/integrity, and entity-schema gates all passed. Those
local results do not replace the blocked 1,000-record dual-adapter exercise or
live staging evidence. No live cross-app Base44 import has occurred because
`_next` does not exist.

## Pre-deployment validation

| Command | Exit | Observed result |
| --- | ---: | --- |
| `git fetch --all --tags --prune` | 0 | Fetch completed. |
| `node scripts/ensure-durable-draft-workspace.mjs --mode check --branch feature/durable-draft-recovery` | 0 | `WORKSPACE_READY`; clean feature branch at the source commit above. |
| `npx base44 whoami` | 0 | Mandatory session authentication check passed; output was suppressed. This was not the required post-update staging-checkout check. |
| `npm ci` | 0 | 775 packages installed/audited. npm reported 29 vulnerabilities (1 low, 8 moderate, 18 high, 2 critical) and six pending install-script approvals. No audit mutation was authorized. |
| `npm run migration:validate-policy` | 0 | Nine entities classified. |
| `npx vitest run --config src/vitest.config.js src/test/proFormMigrationBundle.test.js --reporter=dot --no-coverage` | 0 | 9/9 signed-bundle/tamper tests passed. |
| `npx vitest run --config src/vitest.config.js src/test/proFormMigrationExportImport.test.js src/test/proFormCrossAppMigrationService.test.js --reporter=dot --no-coverage` | 0 | 22/22 export/import and cross-app-policy tests passed. |
| `npx vitest run --config src/vitest.config.js src/test/proFormMigrationIncrementalReverse.test.js --reporter=dot --no-coverage` | 0 | 49/49 delta, reverse, late-write, file-audit, and integrity tests passed. |
| `npm run test:entity-schemas` | 0 | 30/30 entity-schema tests passed. |
| `npm test` | 1 | **Hard stop:** 151 files passed, 2 failed; 2,088 tests passed, 3 failed. |

The three failures were:

1. `proQuestionnaire.regression.test.jsx`: geographic latitude zero was the
   string `"0"` instead of numeric `0`.
2. `proSubmissionRepairHelpers.test.js`: a whitespace-only service offering
   remained in the repaired array.
3. `proSubmissionRepairHelpers.test.js`: the expected keyed `taggedPeople`
   coercion warning was absent.

The suite also emitted stale browser-data and React `act(...)` warnings. Per
the hard-stop rule, `npm run lint`, `npm run typecheck`, `npm run build`, and
the required at-least-1,000-record local corpus were not run.

## Staging target, secrets, schemas, and functions

| Required operation | Result |
| --- | --- |
| Separate staging checkout fetch/fast-forward | `NOT RUN — SOURCE GATE FAILED`; it remained clean at `b719b0c08c28360c22cfc3cff0eb41fcc1462c02` when inventoried |
| Fresh staging fingerprint | `NOT RUN`; only the registered sanitized fingerprint above is cited |
| Staging deployment target guard | `NOT RUN` |
| Post-update staging `npx base44 whoami` | `NOT RUN` |
| `PRO_FORM_CROSS_APP_MIGRATION_SECRET` generation/import | `NOT RUN`; no temporary env file was created |
| Seven staging migration policy values | `NOT RUN` |
| Allowed synthetic peer configuration | `NOT RUN` |
| `npx base44 entities push` | `NOT RUN` |
| `ProFormMigrationIdMap` / `ProFormMigrationConflict` live verification | `NOT RUN` |
| Four targeted migration function deployments | `NOT RUN` |

No entity or function was deployed. No secret value was generated, printed,
written, imported, copied, or deleted. Production secrets and schemas were not
queried or changed.

## Live export and tamper/replay matrix

| Evidence | Result |
| --- | --- |
| Synthetic staging corpus (250 drafts, 500 events, 100 submissions, 100 intakes) | `NOT RUN` |
| Live signed source export and bounded sequence chain | `NOT RUN` |
| Correct source/destination fingerprint and policy exclusions | `NOT RUN` |
| Changed record byte rejected | Local signed-bundle test passed; live staging `NOT RUN` |
| Changed destination rejected | Local cross-app test passed; live staging `NOT RUN` |
| Changed environment rejected | Local cross-app test passed; live staging `NOT RUN` |
| Reordered sequence rejected | Local bundle test passed; live staging `NOT RUN` |
| Exact dry-run replay idempotent | Local import test passed; live staging `NOT RUN` |
| Same-app route rejected | Local cross-app test passed; live staging `NOT RUN` |
| Synthetic staging-to-production policy rejected | Local policy evidence only; live staging `NOT RUN` |
| Zero staging import | No import invocation or staging record creation occurred |

No raw migration bundle was created, logged, committed, or written to disk.

## Local full, delta, reverse, and integrity result

The focused local suites passed signature validation, identity-only upsert,
idempotency, relationship mapping, delta/reverse controls, late-write logic,
logical timestamps, conflict metadata, file-reference classification, and the
18 integrity dimensions. The required isolated at-least-1,000-record initial
full import, manual conflict resolution, delta, late write, and reverse round
trip were **NOT RUN** after the full-suite failure. Therefore no operational
full/delta/reverse or logical-timestamp certification is claimed.

## File audit and safe reports

The 49-test focused suite passed local cases for stable, app-scoped, signed,
and missing URL classification, token redaction, no download, and blocked
cutover while unresolved references remain. The required 1,000-record corpus
audit and six sanitized report artifacts were **NOT RUN**. No report contained
synthetic answers, email addresses, recovery codes, tokens, grants, or signed
URLs because no operational report was generated.

## Cleanup and environment safety

No synthetic staging record, checkpoint, ID map, conflict, bundle, export, or
temporary secret file was created, so no cleanup mutation was required. A live
zero-remaining query was not run because it would enter the staging phase after
a failed source gate.

- Production remained untouched and was not accessed.
- `_next` was not created or inspected.
- No domain was moved.
- No file asset was downloaded.
- `main` was not pushed.

## Required limitation and disposition

No live cross-app Base44 import has occurred because `_next` does not exist.
The migration utility remains pending both a passing full source gate and the
complete staging-source rehearsal. This attempt is classified
**MIGRATION_UTILITY_FAILED**, not certified pending live green.
