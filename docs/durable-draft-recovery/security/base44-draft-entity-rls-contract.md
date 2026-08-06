# Base44 draft entity RLS contract

Status: **IMPLEMENTED_LOCALLY; NOT PUSHED OR LIVE-CERTIFIED**

Date: 2026-08-06

Branch: `feature/durable-draft-recovery`

## Verified Base44 contract

The local Base44 CLI skill contract (package metadata `0.1.7`) and installed
`@base44/sdk` `0.8.39` documentation were inspected before editing. Entity RLS
supports `create`, `read`, `update`, `delete`, and `write`. Each operation may
be `true`, `false`, or a condition object. `user_condition` supports equality
only; the supported admin condition is:

```json
{ "user_condition": { "role": "admin" } }
```

`base44.asServiceRole` is backend-only and presents the admin role. It does not
remove the need for a matching entity RLS rule, so the protected entities must
explicitly admit `role=admin`.

## Local entity rules

| Entity | Create | Read | Update | Delete | Field security |
|---|---|---|---|---|---|
| `ProFormDraft` | Admin only | Admin only | Admin only | Admin only | Existing admin/backend-only FLS preserved |
| `ProFormDraftEvent` | Admin only | Admin only | Admin only | Admin only | Existing admin/backend-only FLS preserved |
| `ProFormRecoverySecurityEvent` | Admin only (pre-existing) | Admin only | Admin only | Admin only | Existing protected linkage fields preserved |
| `ProFormEmailVerificationAttempt` | Admin only (pre-existing) | Admin only | Admin only | Admin only | Existing protected hashes/provider ID preserved |

Anonymous and ordinary authenticated non-admin direct entity operations match
none of these conditions. That is a local schema assertion only; live denial
must not be claimed until the authorized Prompt 4 staging attack matrix runs.

No property, required field, type, enum, default, format, or field-level RLS
was removed or weakened.

## Backend service-role and authorization order

Public functions create their client with `createClientFromRequest(request)`.
Request method/content/body bounds and operation-specific validation run before
protected processing. Draft reads/writes then pass through authorization
helpers such as `authorizeDraftRead`, `authorizeDraftWrite`,
`authorizeDraftEvents`, recovery-session verification, CAPTCHA/rate controls,
or `authorizeAdminRecoveryRequest`. Only then may trusted code use
`base44.asServiceRole.entities` or the shared service-role draft repository.

The sole pre-authorization exception is the security-event entity after safe
request setup, for bounded abuse/rate evaluation and credential-free denied
audit events. It does not authorize draft/event access and cannot return entity
rows.

The static audit covers bootstrap/load, save/event append, Clear All/Start New,
code/email/choice recovery, recovery-email delivery, admin list/detail/update/
events/lineage, retry/repair, shared repositories, and security-event writers.
No current retention function accesses these entities. Future retention or
migration code must either use the reviewed service-role boundary or the
explicit `scripts/migrations/**` policy exception; migrations remain offline,
reviewed, and non-frontend.

## Frontend prohibition

Frontend code may invoke Base44 functions but may not use `asServiceRole` or
directly access the protected entities. Enforcement is layered:

- `scripts/validate-sensitive-function-service-role.mjs` rejects frontend
  service role, ordinary backend sensitive-entity clients, missing request
  clients, and missing authorization helpers.
- `scripts/validate-sensitive-entity-access.mjs` rejects direct frontend
  sensitive-entity access and scans built output.
- The shared Playwright network guard rejects direct sensitive entity endpoint
  traffic.

## Submission exclusions

`ProFormSubmission` and `ProFormSubmissionIntake` are byte-for-byte unchanged
by this increment. Submission retains its current creator/admin compatibility
rules. Intake retains its current admin/service-role rules used by the fallback
backend. Their SHA-256 values are frozen in schema tests so this prompt cannot
silently change either contract. Restricting submission creation requires a
separate compatibility proof that all submission paths are backend-only.

## Synthetic attack-test matrix

`tests/e2e/helpers/proDraftRlsAttackContract.js` defines, but does not execute,
the future live staging matrix:

- anonymous and authenticated non-admin Draft create/read/list/filter/update/
  delete denial;
- anonymous and authenticated non-admin Event create/read denial;
- anonymous and authenticated non-admin security-event read denial;
- successful authorized backend bootstrap, save, code recovery, and
  password-grant admin list.

All cases are marked `liveOnly` and `prompt-4-live-staging-only`.

## Deployment order and rollback warning

1. Keep the blue production app and its schemas unchanged.
2. Certify backend-only source paths and function authorization locally.
3. Push functions and certify them in an explicitly verified staging target
   only when a later prompt authorizes deployment.
4. Push restrictive RLS only after those backend paths are known healthy.
5. Run the anonymous/non-admin denial and authorized-backend success matrix.
6. Stop or roll back the green candidate on any failed authorized path.

Do not deploy RLS before backend paths are certified: doing so can make every
draft flow unavailable. The blue production application remains the rollback
fallback and was not modified here.

## Local tests

The entity test suite verifies all four admin-only operation maps, field-level
security preservation, exact entity names/required arrays/property sets, and
unchanged submission/intake bytes. The service-role validator has synthetic
negative/positive coverage for ordinary clients, authorization order, safe
security-event setup, frontend service role, and migration exceptions. The
attack contract test verifies completeness without performing live traffic.

| Command / group | Result |
|---|---|
| `npm ci` | Exit 0; 775 packages installed, 29 dependency advisories reported |
| `npm run test:entity-schemas` | Exit 0; 27/27 schema tests passed |
| Focused consolidated RLS/attack/validator suite | Exit 0; 45/45 tests passed |
| `npm run test:sensitive-service-role` | Exit 0; four protected entities passed the source audit |
| `npm run test:no-sensitive-frontend-entities` after build | Exit 0; five sensitive entities passed source and built-output policy |
| Backend draft function tests | Exit 0; 98/98 passed |
| Admin API/authorization/service tests | Exit 0; 87/87 passed |
| Public recovery tests | Exit 0; 92/92 passed |
| `npm test -- --run` | Exit 1; 1,824/1,827 passed, with three established unrelated normalization/repair failures |
| `npm run lint` | Exit 1; repository baseline remains 28 errors and 14 warnings; no changed-file violation |
| `npm run typecheck` | Exit 2; existing project-wide JavaScript/dependency diagnostics remain |
| `npm run build` | Exit 0 |

The live attack cases were intentionally not executed. These results certify
local contracts only and do not establish live RLS enforcement.

No entity push, function deploy, site deploy, application deploy, production
operation, feature-branch push, or `main` push is authorized by this contract.

## Prompt 3 local deployment safeguards

All draft, recovery, replacement, recovery-email, admin, and submission client
failures now share a safe classification policy. Authorization failures direct
the caller to recovery or the admin password gate; RLS/service-role failures
become configuration errors; conflicts and submitted/superseded locks remain
distinct; only bounded network and rate failures are retryable. Provider
messages, entity responses, answers, and credentials are never projected.

`src/lib/proDraftKillSwitchPolicy.js` defines the four fail-closed outcomes and
always forbids direct entity fallback, new server-draft creation, destructive
reset, and a false secure-save claim. Submitted local state is read-only,
persistent active state is local-only with sync visibly paused, memory-only
state is recovery-only, and a new start requires maintenance.

The production build now runs the built-output sensitive-entity scan. Source
maps are explicitly excluded by policy and are not accepted as production
bundle evidence. CI independently runs source and service-role boundaries.

`npm run precheck:rls` verifies schema RLS, source and bundle access, required
function presence, service-role policy, three staging certifications, staging
secret/flag documentation, feature branch, and staging app link. On 2026-08-06
the real checkout correctly failed with:

- `STAGING_API_CERTIFICATION_MISSING`
- `STAGING_ADMIN_CERTIFICATION_MISSING`
- `STAGING_LIFECYCLE_CERTIFICATION_MISSING`
- `PRODUCTION_APP_LINK_FORBIDDEN`

This is a blocked deployment precheck, not staging RLS certification. See the
[emergency rollback runbook](../runbooks/draft-rls-emergency-rollback.md).

Prompt 3 validation produced the following local evidence:

| Command / group | Result |
|---|---|
| Focused client/error/kill-switch/RLS/order/precheck suite | Exit 0; 128/128 tests passed |
| `npm run test:no-sensitive-frontend-entities -- --source-only` | Exit 0; five sensitive entities passed the source policy |
| `npm run test:sensitive-service-role` | Exit 0; four protected entities passed the service-role audit |
| `npm run build` | Exit 0; Vite build and mandatory built-output scan passed |
| `npm test -- --run` | Exit 1; 1,874/1,877 passed, with the same three established unrelated normalization/repair failures |
| Changed-file ESLint | Exit 0; no errors and five warnings, including one ignored test-file notice |
| `npm run lint` | Exit 1; repository baseline remains 28 errors and 14 warnings |
| `npm run typecheck` | Exit 2; existing project-wide JavaScript/dependency diagnostics remain |
| `npm run precheck:rls` | Exit 1; stopped on the four staging/production-link blockers listed above |

No schema was pushed, no function or site was deployed, no Base44 record or
secret was changed, and neither the feature branch nor `main` was pushed.
