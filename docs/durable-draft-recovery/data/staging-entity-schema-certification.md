# Staging entity schema certification

- Classification: **ENTITY_EXTENSIONS_BLOCKED**
- Attempt date: 2026-08-05 (America/Chicago)
- Candidate commit: `9ca8e6478facd6d5cfa1e2f51986ba12fc1a26d1`
- Candidate branch: `feature/durable-draft-recovery`
- Registered staging app: `Pro Website Questionnaire_staging`
- Registered staging app fingerprint: `682b3ba54771331270952c7f4a3ac25035417cc9376a93e8b14ffca2e77051f5`
- Registered production fingerprint: `f030ea980e900a98b3d172630fe4f52522ebe14ba09e834be668b48e29cfc4f9`
- Durable Draft V2: disabled and unchanged

The staging app name and fingerprints above come from the existing sanitized registration evidence. They were **not freshly checked in this attempt** because the mandatory source gate failed first. The staging checkout, staging app, and production app were not accessed after that failure.

## Stop decision

The attempt stopped during pre-push source validation. `npm test` failed 5 of 780 normal tests, so the prompt's release-blocking hard-stop rule prohibited updating the separate staging checkout or running any staging operation. No exception was approved.

## Source validation

| Check | Result | Evidence |
| --- | --- | --- |
| Primary branch | `PASS` | `feature/durable-draft-recovery` |
| Primary working tree before validation | `PASS` | Clean |
| Prior schema candidate | `PASS` | Commit `9ca8e6478facd6d5cfa1e2f51986ba12fc1a26d1` present |
| `npm ci` | `PASS` | 775 packages installed; audit reported 29 dependency vulnerabilities (1 low, 8 moderate, 18 high, 2 critical) |
| `npm run test:entity-schemas` | `PASS` | Validator passed; focused tests passed 18/18 |
| `npm test` | `FAIL` | 775/780 passed; 5 release-blocking failures across 2 files |
| Canonical-state tests | `NOT RUN` | Hard stop after normal-suite failure |
| Identity-contract tests | `NOT RUN` | Hard stop after normal-suite failure |
| Submission/PDF tests | `NOT RUN` | Hard stop after normal-suite failure |
| Intake/retry/repair tests | `NOT RUN` | Hard stop after normal-suite failure |
| `npm run lint` | `NOT RUN` | Hard stop after normal-suite failure |
| `npm run typecheck` | `NOT RUN` | Hard stop after normal-suite failure |
| `npm run build` | `NOT RUN` | Hard stop after normal-suite failure |
| Primary-checkout `npx base44 whoami` | `PASS` | Authentication succeeded; identity output is not recorded |
| Staging-checkout `npx base44 whoami` | `NOT RUN` | Staging checkout was not entered after the hard stop |

The five normal-suite failures were:

1. Q24 did not remain incomplete after switching back from `Other`.
2. A recoverable local backup was missing after a database-save failure.
3. Geographic latitude/longitude zero values were returned as strings rather than numbers.
4. A whitespace-only service offering was not filtered.
5. The expected `taggedPeople: coerced to array` repair warning was absent.

## Staging operation matrix

| Operation | Result | Evidence boundary |
| --- | --- | --- |
| Fetch and fast-forward separate staging checkout | `NOT RUN` | Prohibited after source failure |
| Fresh staging app fingerprint check | `NOT RUN` | Registered evidence only; not revalidated |
| Production/staging fingerprint comparison | `NOT RUN` | Registered fingerprints differ, but no fresh target check was performed |
| Deployment-target guard | `NOT RUN` | Prohibited after source failure |
| Pre-push record counts | `NOT RUN` | No staging entity read occurred |
| Staging/test-record inventory | `NOT RUN` | No staging entity read occurred |
| `npx base44 entities push` | `NOT RUN` | No schema was pushed |
| Created entities | `NOT OBSERVED` | Push did not run |
| Updated entities | `NOT OBSERVED` | Push did not run |
| Deleted-entity count | `NOT OBSERVED / N/A` | Push did not run; this is not a claim of zero deletions |
| `npx base44 types generate` | `NOT RUN` | Requires a successful staging schema push |
| Generated-field inspection | `NOT RUN` | No types generated |
| Site deployment | `NOT RUN` | Explicitly prohibited |
| Function deployment | `NOT RUN` | Explicitly prohibited |

## CRUD and compatibility matrix

| Entity | Legacy create/read/update/delete | Extended create/read/update/delete | Field persistence | Cleanup |
| --- | --- | --- | --- | --- |
| `ProFormDraft` | `NOT RUN` | `NOT RUN` | `NOT RUN` | No record created |
| `ProFormDraftEvent` | `NOT RUN` | `NOT RUN` | `NOT RUN` | No record created |
| `ProFormSubmission` | `NOT RUN` | `NOT RUN` | `NOT RUN` | No record created |
| `ProFormSubmissionIntake` | `NOT RUN` | `NOT RUN` | `NOT RUN` | No record created |

No `test_run_id` was generated, no temporary CRUD script was executed, and no synthetic record was created. Cleanup was therefore unnecessary; no record was intentionally left behind.

## Field-level security

| Check | Result |
| --- | --- |
| Unauthorized/public read of sensitive new Draft fields | `NOT RUN` |
| Admin/service-role read of the same fields | `NOT RUN` |
| Sensitive fields proven omitted or denied | `NOT CERTIFIED` |

This report does not claim that Base44 field-level security works. The actual public-versus-service-role test required a deployed extended synthetic Draft and was not reachable.

## Current questionnaire compatibility

| Check | Result |
| --- | --- |
| Load staging questionnaire with synthetic parameters | `NOT RUN` |
| Enter one safe, non-submitted answer | `NOT RUN` |
| Existing Draft create/update path | `NOT RUN` |
| Existing compatibility columns | `NOT RUN` |
| Admin draft recovery | `NOT RUN` |
| Draft/event cleanup | No smoke-test record created |

No browser was opened, no answer was entered, no submission occurred, and no Zapier or email path was invoked.

## Known limitations and disposition

- The extended schemas remain local-only and optional-field compatibility is certified only by the local validator and focused fixtures.
- Staging record counts, entity diffs, deletion behavior, generated types, live CRUD, field-level security, and questionnaire compatibility remain unknown.
- The registered staging identity was not freshly verified, and the target guard was not run.
- The staging checkout was not fetched, fast-forwarded, or otherwise modified.
- No production app, record, domain, site, function, secret, or integration operation was performed. Production was not inspected, so this report claims only that this attempt did not touch it.
- `main` was not changed or pushed. The feature branch must not be pushed from this attempt because successful staging validation did not occur.

The only authorized next step is to fix or formally resolve the five release-blocking normal-suite failures, rerun the full ordered source gate from a clean candidate, and start a new staging certification attempt.
