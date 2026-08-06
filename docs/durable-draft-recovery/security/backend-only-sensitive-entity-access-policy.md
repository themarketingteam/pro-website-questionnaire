# Backend-only sensitive entity access policy

Status: **IMPLEMENTED_LOCALLY; RLS_AND_STAGING_CERTIFICATION_PENDING**

Branch: `feature/durable-draft-recovery`

Audit revision: `fd66ac2422bc084249f5c18c3df6902a78bbbda3`

Audit date: 2026-08-06

Sensitive entities are `ProFormDraft`, `ProFormDraftEvent`,
`ProFormRecoverySecurityEvent`, `ProFormEmailVerificationAttempt`, and the
already-migrated admin intake entity `ProFormSubmissionIntake`.

## Pre-edit direct-access remediation table

This table was recorded before source edits. It distinguishes production
frontend code from backend service-role code and synthetic test fixtures.

| Path | Observed access at audit revision | Reachability | Remediation |
| --- | --- | --- | --- |
| `src/lib/draftPersistence.js` | Exported factories call `ProFormDraft.filter`, `.update`, and `.create` through an injected `entities` alias. | Imported by the questionnaire whenever the V2 client flag is false, including the kill switch. | Delete browser CRUD factories and retain only namespaced local failure-backup helpers. |
| `src/pages/ProQuestionnaire.jsx` | Passes `base44.entities` to the draft CRUD factory and calls `base44.entities.ProFormDraftEvent.create`. | The default non-V2 branch and kill-switch branch use this path. | Remove the legacy branch and Base44 entity import; use the sync manager only when V2 is enabled and render controlled unavailable UX otherwise. |
| `src/lib/proQuestionnaireSubmit.js` | Its default-enabled legacy stage recorder calls `base44.entities.ProFormDraftEvent.create`. | Any caller omitting the legacy flag can enter the branch. | Delete the direct stage-event persistence branch; authoritative submission/sync functions own server events. |
| Admin recovery pages/components | No direct sensitive entity access found; all operations use `proDraftAdminApiClient`. | Backend-only in current source. | Keep under the new whole-frontend validator. |
| `src/api/entities.js` | Exposes only the unrelated `Query` entity. | Production frontend, but not a sensitive entity in this policy. | No change. |
| `src/lib/proSubmissionResilience.js` and `src/pages/AdminSubmitIntake.jsx` | Direct `ProFormSubmission` create only. | Outside this prompt's sensitive draft-recovery entity set. | No change in this prompt. |
| `base44/functions/**` | Service-role draft, event, security-event, and verification-attempt operations. | Backend only. | Allow through policy; restrictive entity RLS is a later prompt. |
| `src/test/**` | Backend harnesses, schema fixtures, and legacy direct-transport characterization mocks. | Test only. | Allow approved backend mocks; remove obsolete frontend direct-transport fixtures and test only the retired export boundary. |
| `tests/e2e/**` | One synthetic direct-entity URL exists in fixture-policy tests; admin specs inspect requests. | Synthetic attack/guard evidence only. | Restrict exceptions to explicitly named attack tests and install a redacting request guard in the shared V2 fixture. |

The audit also searched dot access, bracket access, destructured/assigned
aliases, common string concatenation, wrappers, admin pages, error/recovery
helpers, fixtures, and built-client entry points. No production frontend access
to `ProFormRecoverySecurityEvent` or `ProFormEmailVerificationAttempt` was
found.

## Implemented policy

`config/sensitive-entity-access-policy.json` defines the sensitive entity set,
allowed backend/migration/test paths, operation rules, built-output scanning,
and expiring exception metadata. Production frontend exemptions are forbidden
and the current policy contains none.

`scripts/validate-sensitive-entity-access.mjs` parses JavaScript, JSX,
TypeScript, and TSX import/member-access structure, supplements it with bounded
alias and concatenation checks, and scans the built site for sensitive entity
endpoint or SDK access. Diagnostics contain only path, line, operation, and
rule; source lines, request bodies, and query values are not printed.

## Browser network boundary

The browser guard uses the Base44 entity endpoint structure already
captured in the repository's staging E2E fixtures:
`/api/apps/<app>/entities/<entity>/<operation>` and the compatible
`/api/entities/<entity>/<operation>` form. Function invocation paths remain
allowed. The guard records only method and redacted pathname metadata. It is
installed in the shared durable-draft Playwright fixture.

## Kill-switch behavior

The green/staging application does not recreate the blue application's legacy
direct transport. When V2 is unavailable or killed, new server writes and
editing are paused and the user receives explicit unavailable/recovery
actions. Local questionnaire storage is not cleared. The separate blue
production application remains the rollback fallback.

## Exceptions

An exception must be test-only or non-frontend, name an owner and reason, and
include an expiration/removal target. Expired or malformed exemptions fail the
validator. The initial production frontend policy contains no exemptions.

## Validation evidence

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | Dependencies installed; npm reported 29 dependency advisories and lifecycle allow-script warnings. |
| `npm run test:admin-no-direct-entities` | 0 | Existing frontend direct-entity guard passed across eight files. |
| Focused static/network/kill-switch/API/sync Vitest gate | 0 | 60/60 tests passed. |
| `npm run build` | 0 | Production bundle built successfully. |
| `npm run test:no-sensitive-frontend-entities` | 0 | Source and rebuilt client output contain no forbidden access for all five sensitive entities. An earlier pre-build run correctly rejected two stale bundle artifacts. |
| `npm run test:e2e:harness` | 0 | 95/95 Playwright harness cases passed with the shared network guard installed. |
| `npx playwright test tests/e2e/draft-v2/authoritative-submission-and-read-only-pdf.spec.js` | 0 | 85/85 guarded browser cases passed across the configured projects. |
| `npm test -- --run` | 1 | 1,806/1,809 tests passed; three established geography/submission-repair expectations remain failing in two files. |
| `npm run lint` | 1 | Repository baseline remains 28 errors and 15 warnings. |
| `npm run typecheck` | 2 | Existing project-wide type diagnostics remain. |

The broad `npx playwright test tests/e2e/draft-v2` sweep was terminated after
repeated boot-selector timeouts showed that the local web target intentionally
served the new disabled/unavailable state to scenarios expecting an enabled
V2 test target. No reliable aggregate exit code was captured for that
terminated run and no direct sensitive-entity request violation was observed.

Entity-level RLS is intentionally unchanged here. No Base44 deploy, production
operation, feature-branch push, domain change, or `main` change occurred. The
next RLS prompt can restrict entities after this backend-only transport
boundary and an authorized staging target are verified.
