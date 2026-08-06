# One-year draft retention validation

- Date: 2026-08-06
- Branch: `feature/durable-draft-recovery`
- Classification: **SOURCE CONTROLS PASSED; REPOSITORY BASELINE GATES FAILED**
- Base44/cloud operations: none
- Data deletions: none

## Results

| Command | Exit | Result |
| --- | ---: | --- |
| `git fetch --all --tags --prune` | 0 | Remote references refreshed; approved tag/backup SHA remained `27ddc347d55db00796a0e3e19ac343245519b01e`. |
| `node scripts/ensure-durable-draft-workspace.mjs --mode check --branch feature/durable-draft-recovery` | 0 | `WORKSPACE_READY`; no rescue action required. |
| `npm ci` | 0 | 775 packages installed/audited; npm reported 29 dependency vulnerabilities (1 low, 8 moderate, 18 high, 2 critical) and six unapproved install-script notices. No audit fix was authorized or run. |
| `npm run test:retention` | 0 | 5 files, 48 tests passed: policy, apply token, analyze/apply/schedule, checkpoint, and admin boundary. |
| `npm run test:entity-schemas` | 0 | Plan validator passed; 4 files and 27 tests passed. |
| `npx vitest run --config src/vitest.config.js src/test/proDraftFunctionAuthorizationOrderContract.test.js src/test/proFormRecoverySecurityEventSchema.test.js --reporter=dot --no-coverage` | 0 | 2 files and 24 tests passed. |
| `npx eslint base44/functions/_shared/proDraftRetention/retention.js base44/functions/_shared/proDraftRetentionAuthorization/authorization.js base44/functions/_shared/proDraftRetentionRepository/repository.js base44/functions/_shared/proDraftRetentionService/service.js src/test/proDraftRetentionPolicy.test.js src/test/proDraftRetentionAuthorization.test.js src/test/proDraftRetentionService.test.js` | 0 | New retention modules/tests have no ESLint finding. |
| `npm test` | 1 | 142 files passed, 3 failed; 1,969 tests passed and 4 failed. Failures are outside retention: two `proSubmissionRepairHelpers` expectations, one `proFormDraftSyncManager` retry expectation, and one `proQuestionnaire.regression` numeric normalization expectation. Retention tests passed inside the full run. Existing React `act(...)`, stale browser-data, and Browserslist warnings were also emitted. |
| `npm run lint` | 1 | Existing repository-wide baseline: 42 findings (28 errors, 14 warnings), primarily unused legacy React/icon imports and existing unused variables/directives. No finding was reported in the new retention files. |
| `npm run typecheck` | 2 | Existing repository-wide JS-check baseline failures in `redux-persist`, admin/UI component inference, import-meta environment typing, and existing submission/questionnaire modules. No new retention module path appeared in the reported failures. |
| `npm run build` | 0 | Vite build and built-bundle sensitive-entity scan passed; stale browser-data warnings remain. |
| `git diff --check` | 0 | No whitespace errors. |

## Safety evidence

- The report builder accepts only safe IDs, 64-character lowercase hashes,
  allowlisted decisions, counts, byte estimates, environment, batch, cutoff,
  and policy version. Synthetic tests reject an email-shaped ID and scan the
  serialized report for answer/email terms.
- Static review found no answer, email, event value, recovery-code, or payload
  field in retention report construction. Apply-token/admin-grant identifiers
  appear only as raw request inputs or one-way hashes in their authorized
  boundaries; raw tokens are not checkpointed.
- There is no `deleteMany`; apply reloads and fingerprints each draft, checks
  exact environment/submitted/hold/support/replacement/migration/test policy,
  deletes individually eligible events first, confirms zero remaining events,
  and only then deletes the draft.
- The automation declaration is disabled and dry-run. A false dry-run
  environment flag returns a standing-authorization-required result rather
  than applying.

No `npx base44` command, cloud authentication, app creation, schema push,
function/automation deployment, secret read/write, record query/mutation,
cleanup, production operation, feature-branch push, or `main` push occurred.
