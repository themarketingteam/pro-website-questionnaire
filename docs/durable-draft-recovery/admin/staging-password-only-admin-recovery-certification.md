# Staging password-only admin recovery certification

- Attempt date: 2026-08-06
- Candidate branch: `feature/durable-draft-recovery`
- Candidate commit: `b794300bb8ed85be5a7cd149cdaf430944dc3c6b`
Classification: **PASSWORD_ONLY_ADMIN_RECOVERY_FAILED**

## Outcome

The mandatory pre-deployment source gate failed at the full normal test suite.
Prompt 4 requires an immediate stop on any source-validation failure, so the
separate staging checkout was not updated and no target guard, secret write,
function deployment, site deployment, synthetic-data operation, live browser
test, security-event query, cleanup mutation, or Git push followed.

The registered historical staging identity is
`Pro Website Questionnaire_staging` with app-ID SHA-256 fingerprint
`682b3ba54771331270952c7f4a3ac25035417cc9376a93e8b14ffca2e77051f5`.
It was not freshly verified in this attempt. No staging URL was collected.

## Source gate

| Order | Command | Exit | Observed result |
| ---: | --- | ---: | --- |
| 1 | `git fetch --all --tags --prune` | 0 | Origin references refreshed. |
| 2 | `node scripts/ensure-durable-draft-workspace.mjs --mode check --branch feature/durable-draft-recovery` | 0 | `WORKSPACE_READY`; correct branch, candidate SHA, clean tree. |
| 3 | `npx base44 whoami` | 0 | Authentication succeeded; no app resource was read or changed. |
| 4 | `npm ci` | 0 | 775 packages installed; audit reported 29 vulnerabilities (1 low, 8 moderate, 18 high, 2 critical) and six install scripts pending approval. |
| 5 | Focused admin authorization, backend API, UI, retry/repair, and route Vitest command over nine files | 0 | 75/75 tests passed. Browser-data warnings reported stale `baseline-browser-mapping` and `caniuse-lite`. |
| 6 | `npm run test:admin-no-direct-entities` | 0 | Eight admin frontend source files passed the backend-only entity boundary. |
| 7 | `npm test` | 1 | 1,792/1,798 tests passed; 3/126 files and six tests failed. Hard stop activated. |

The six failures were:

1. `proFormDraftSyncManager.test.js`: expired resume authorization did not
   make the expected second save using the stored recovery session.
2. `proQuestionnaire.regression.test.jsx`: Q24 did not return to `complete`
   after switching from Other to a normal option.
3. `proQuestionnaire.regression.test.jsx`: the expected recoverable local
   backup key was absent after database-save failure.
4. `proQuestionnaire.regression.test.jsx`: geographic latitude/longitude zero
   values remained strings instead of numbers.
5. `proSubmissionRepairHelpers.test.js`: a whitespace-only string-array item
   was retained.
6. `proSubmissionRepairHelpers.test.js`: keyed-object coercion omitted the
   expected warning.

`npm run lint`, `npm run typecheck`, `npm run build`, and local admin E2E were
not run in this attempt because they occur after the failing gate. Results from
an earlier prompt are not substituted as certification evidence.

## Deployment and configuration

| Requirement | Result |
| --- | --- |
| Staging checkout update and clean-tree confirmation | `NOT RUN` |
| Fresh staging fingerprint and `_staging` name | `NOT RUN`; historical registration only |
| Normal staging target guard | `NOT RUN` |
| Staging password generation/import | `NOT RUN`; no password or temporary env file was created |
| `PRO_FORM_ADMIN_GRANT_SECRET` names-only presence check | `NOT RUN` |
| Final admin version/rate/lockout/timing values | `NOT CONFIGURED OR CHANGED` |
| Targeted function deployment | `NONE` |
| Guarded staging site deployment | `NONE` |
| Feature-branch push | `WITHHELD` |

No function can be reported as deployed by this attempt. The requested final
version values remain uncertified because no names-only or value-changing
staging operation was permitted after the hard stop.

## Certification matrices

| Matrix | Result | Evidence |
| --- | --- | --- |
| Password authorization | `NOT RUN` | No staging password configured; no live gate test. |
| Persistent grant/browser restart | `NOT RUN` | Local synthetic coverage is not deployed-browser evidence. |
| Storage-blocked session | `NOT RUN` | No deployed browser session. |
| Forget This Device | `NOT RUN` | No deployed grant. |
| Grant/password version revocation | `NOT RUN` | No version change. |
| Grant-secret rotation | `NOT RUN` | No secret read or write. |
| List/search/filter/detail/events | `NOT RUN` | Focused source tests passed; live operations were prohibited after failure. |
| Edit/conflict/submitted lock/retention/audit | `NOT RUN` | No synthetic staging draft. |
| Retry/repair and side-effect safety | `NOT RUN` | No synthetic intake and no external call. |
| Direct-access network inspection | `NOT RUN` | Static source validator passed; no staging network session. |
| Security-event inspection and RLS | `NOT RUN` | No staging query or test event. |

## Synthetic data and cleanup

No staging test-run ID or record was created. Consequently there were zero
attempt-created drafts, events, intakes, submissions, recovery-security events,
or repair records to delete. Cleanup was `NOT REQUIRED`; this is not a live
zero-record query.

## Persistent-grant risk reminder

The accepted password-only design has no fixed grant expiration. A persistent
grant remains valid until device forgetting, environment/device mismatch,
version change, secret rotation, or browser-data removal. XSS, malicious
extensions, shared profiles, and unattended unlocked devices therefore remain
material risks pending the live staging matrices and the future migration to
individual administrators.

## Isolation and Git result

The only Base44 command was the authentication-only `npx base44 whoami` in the
primary checkout. No `secrets set`, `functions deploy`, `site deploy`, entity
push, `exec`, or all-resource deployment command ran. Production records,
secrets, functions, site, integrations, domain, and external destinations were
not operated on. `main` was neither checked out nor pushed. The feature branch
was not pushed because certification failed.
