# Staging restrictive draft RLS certification

- Attempt date: 2026-08-06 (America/Chicago)
- Classification: **DRAFT_RLS_BLOCKED**
- Candidate branch: `feature/durable-draft-recovery`
- Candidate commit: `ae32565907c8484cbcb0f5f0a30a5c177987e9d2`
- Staging app: **NOT FRESHLY VERIFIED**; registered sanitized fingerprint only
- Staging URL: **NOT COLLECTED**
- Schema push: **NOT RUN**
- Feature-branch push: **WITHHELD**
- Production operations: **NONE**

## Decision

The mandatory primary-checkout deployment precheck failed before any staging
checkout or application-scoped operation. The prompt requires an immediate
stop on any pre-deployment failure and forbids bypassing the precheck. This
attempt therefore cannot certify live RLS denial, service-role access, public
or admin workflows, browser networking, regression behavior, or cleanup.

The four observed blockers were:

- `STAGING_API_CERTIFICATION_MISSING`
- `STAGING_ADMIN_CERTIFICATION_MISSING`
- `STAGING_LIFECYCLE_CERTIFICATION_MISSING`
- `PRODUCTION_APP_LINK_FORBIDDEN`

The last code means the ignored `base44/.app.jsonc` in the primary checkout is
registered as the production link. It was not changed, copied, or used for an
application operation. No target override or bypass was attempted.

## Ordered pre-deployment gate

| Order | Command | Exit | Observed result |
| ---: | --- | ---: | --- |
| 1 | `git fetch --all --tags --prune` | 0 | Remote references refreshed. |
| 2 | `node scripts/ensure-durable-draft-workspace.mjs --mode check --branch feature/durable-draft-recovery` | 0 | `WORKSPACE_READY`; clean feature branch at the recorded commit. |
| 3 | `npx base44 whoami` | 0 | Authentication succeeded; identity is not repeated in this report. |
| 4 | `npm ci` | 0 | Installed 775 packages; npm reported 29 vulnerabilities: 1 low, 8 moderate, 18 high, and 2 critical, plus six pending install-script approvals. |
| 5 | `npm run precheck:rls` | 1 | **FAIL** with the four hard-stop codes above. |

The remaining requested primary gates were `NOT RUN` because they occur after
the failed precheck: entity/RLS tests, service-role validation, source and
built-bundle scans, public and admin suites, lifecycle tests, full normal
tests, lint, typecheck, build, and mocked attack tests. Results from Prompt 3
are retained as historical local evidence but are not substituted for this
ordered certification attempt.

## Staging target and pre-push state

| Requirement | Result |
| --- | --- |
| Separate staging checkout fetch/fast-forward | `NOT RUN` |
| Clean staging tree confirmation | `NOT RUN` |
| Fresh staging fingerprint | `NOT RUN` |
| Staging `npx base44 whoami` | `NOT RUN` |
| Deployment target guard | `NOT RUN` |
| Staging `npm run precheck:rls` | `NOT RUN` |
| Pre-push entity counts | `NOT RUN` |
| Expected staging/test-only record review | `NOT RUN` |

No app ID, record value, secret, credential, or URL was printed or added to
Git evidence.

## Schema push

`npx base44 entities push` was **NOT RUN**. Consequently:

- no entity was created, updated, or deleted;
- restrictive Draft/Event RLS was not pushed;
- support-entity RLS was not live-confirmed;
- Submission/Intake remote schemas were not changed;
- neither `--force` nor `--yes` was used.

## Direct-access attack matrices

| Matrix | Result | Reason |
| --- | --- | --- |
| Anonymous Draft create/read/list/filter/update/delete | `NOT RUN` | Precheck hard stop before schema push and test-fixture creation. |
| Anonymous Event create/read | `NOT RUN` | Precheck hard stop. |
| Anonymous RecoverySecurityEvent read | `NOT RUN` | Precheck hard stop. |
| Anonymous EmailVerificationAttempt read | `NOT RUN` | Precheck hard stop. |
| Ordinary authenticated non-admin matrix | `NOT RUN` | Staging target was not entered; no safe test user was created or authenticated. |

Because the non-admin matrix has no live evidence, certification is prohibited.
The earlier deployment gate already blocks the entire matrix.

## Authorized backend matrices

| Area | Result |
| --- | --- |
| Public bootstrap/save/load/events | `NOT RUN` |
| Email/code/list/select recovery | `NOT RUN` |
| Clear All / Start New | `NOT RUN` |
| Redirected recovery-code email | `NOT RUN`; no email was sent |
| Submitted read-only / PDF regeneration | `NOT RUN` |
| Admin list/detail/events/edit/lineage | `NOT RUN` |
| Admin retry/repair/security-event review | `NOT RUN` |
| Service-role success under admin-condition RLS | `NOT RUN` |
| Authorization-before-access and projection inspection | `NOT RUN` live |
| Hash/service credential response exclusion | `NOT RUN` live |

No SES request, client email, Zapier request, final submission, webhook,
connector, or other external side effect was initiated.

## Browser network and regression matrices

Chromium, Firefox, and WebKit network certification was `NOT RUN`. No deployed
new-draft, save, recovery, admin, replacement, submission, read-only, function-
failure, or kill-switch flow was exercised. Offline/reconnect, multi-tab,
component mutation, storage-blocked, SES redirect, and full lifecycle
regressions were also `NOT RUN`.

There is therefore no live claim that a browser avoided sensitive entity
endpoints in staging. The static and synthetic Prompt 3 evidence remains local
only.

## Cleanup and isolation

No test-run identifier, staging record, verification attempt, submission,
intake, draft, event, or security event was created. Cleanup was therefore
`NOT REQUIRED`; no live zero-remaining query was run, and this is not a claim
about unrelated staging data.

Only authentication and local Git/npm commands ran. No Base44 entity, function,
site, secret, record, app configuration, domain, or integration was changed.
Production remained untouched. `main` was neither checked out nor pushed.

The feature branch was not pushed because the prompt authorizes it only after
successful staging certification. Remote verification that all four batch
prompts exist was consequently `NOT RUN`.

## Required disposition

Produce passing authoritative API, password-only admin, and full lifecycle
staging certifications. Then use a clean separate staging-linked checkout so
both primary and staging prechecks identify staging rather than production.
Rerun the entire ordered gate from the beginning; do not bypass or weaken any
RLS, target, test, or non-admin evidence requirement.

Classification: **DRAFT_RLS_BLOCKED**
