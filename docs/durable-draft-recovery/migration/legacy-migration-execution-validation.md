# Legacy migration execution local validation

Status: **SOURCE IMPLEMENTED; FOCUSED CHECKS PASS; REPOSITORY BASELINE FAILURES REMAIN**

Date: 2026-08-06

Branch: `feature/durable-draft-recovery`

## Results

| Command | Exit | Observed result |
| --- | ---: | --- |
| `git fetch --all --tags --prune` | 0 | Remote refs refreshed; approved tag peel and backup branch both resolve to `27ddc347d55db00796a0e3e19ac343245519b01e`. |
| `node scripts/ensure-durable-draft-workspace.mjs --mode check --branch feature/durable-draft-recovery` | 0 | `WORKSPACE_READY`; intended branch and initially clean tree. |
| `npm ci` | 0 | 775 packages installed; 29 inherited advisories and six pending install-script approvals reported. |
| `npm run test:migration-execution` | 0 | 94/94 passed across analyzer, CLI, apply authorization, repository/execution, checkpoint schema, admin request, and authorization-order suites. The new authorization/execution/checkpoint portion is 35 tests, exceeding the required 24. |
| `npm run test:entity-schemas` | 0 | Schema plan passed; 27/27 existing entity-schema tests passed. |
| `npm run test:sensitive-service-role` | 0 | Sensitive function service-role policy passed. |
| `npm run test:no-sensitive-frontend-entities` | 0 | Source and built sensitive-entity access policy passed. |
| `npm test -- --run` | 1 | 1,937/1,940 passed. The same three unrelated baseline failures remain: geographic zero strings, whitespace service offering filtering, and missing taggedPeople coercion warning. |
| changed-JavaScript ESLint command | 0 | Migration authorization, repository, service, and focused test JavaScript have no lint diagnostics. |
| `npm run lint` | 1 | Existing repository baseline: 28 errors and 14 warnings; no new migration JavaScript error. |
| `npm run typecheck` | 2 | Existing broad JavaScript/dependency diagnostics remain, beginning with missing Node globals in `redux-persist` and existing admin/component typing errors. |
| `npm run build` | 0 | Vite build and mandatory sensitive built-bundle scan passed. |
| `npm run migration:analyze-legacy -- --fixture --output <owner-only-temp>/report.json` | 0 | Safe synthetic report written mode `0600`: 17 drafts, 3 events, 5 manual-review results. Recursive forbidden-key scan passed. |

One early ad-hoc Vitest command omitted `--config src/vitest.config.js`; it
exited 1 because the existing legacy suite relies on configured globals. The
repository script above corrected the invocation and passed (94/94 on the final rerun). A first
naive report scan searched all string values and flagged the allowed proposed
field name `recovery_email`; the corrected recursive key scan checks prohibited
payload keys and passed. Neither diagnostic failure represents an application
test failure, and both are recorded here for completeness.

## Safety confirmation

No `npx base44` command ran. No Base44 client was constructed during migration
validation, and no cloud application, schema, function, secret, checkpoint,
draft, event, submission, domain, or integration was read or changed. The new
apply secret remains name-only and unconfigured. Production and `main` were
untouched; no feature branch was pushed.

The full-suite/lint/typecheck baseline failures prevent a claim of repository-
wide green status. Focused source implementation is validated locally, while
live staging RLS, real-data dry run, deployment, resume rehearsal, retention,
and reverse migration remain explicitly uncertified.
