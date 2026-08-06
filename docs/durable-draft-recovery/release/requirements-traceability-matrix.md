# Durable Draft Recovery Requirements Traceability Matrix

## 2026-08-06 Prompt 3 local RLS safeguard evidence

| Requirement | Source evidence | Test evidence | Status |
|---|---|---|---|
| Safe RLS/auth/network/conflict/lock normalization | `proDraftClientErrorPolicy.js` and six client integrations | Error-policy and RLS integration suites | Locally passed |
| Four kill-switch outcomes preserve state | `proDraftKillSwitchPolicy.js` | Submitted, persistent, memory-only, new-start matrix | Locally passed |
| No retry storm or direct fallback | One-shot clients and nonretryable auth/RLS classifications | RLS denial integration tests | Locally passed |
| Required function authorization order | Required-function contract and service-role validator | 18-function guarded order matrix | Locally passed |
| No direct access in production bundle | Mandatory built scan and explicit source-map exclusion | Bundle scanner fixtures; exact build pending final validation | Implemented locally |
| Deployment evidence and target fail closed | `precheck-draft-rls-deployment.mjs` | Direct access, missing function, production link, valid fixture | Locally passed; real precheck blocked |
| Emergency rollback preserves RLS first | RLS emergency rollback runbook | Documentation review | Local evidence only |

`DR-RLS-001` remains **implemented locally, not pushed, and not live-certified**.
The real precheck currently rejects the three blocked staging certifications
and the primary checkout's production app link.

## 2026-08-06 local draft entity RLS evidence

| Requirement | Source evidence | Test evidence | Status |
|---|---|---|---|
| Draft/Event direct CRUD denied unless role is admin | Draft and Event entity schemas | RLS schema contract tests | Locally tested; not pushed |
| Support entities remain admin-only | Security-event and verification-attempt schemas | Existing plus consolidated RLS tests | Locally tested; unchanged |
| Backend functions use service role after authorization | Service-role validator and shared request/repository boundaries | Validator positive/negative tests | Locally tested; staging pending |
| Frontend cannot use service role | Service-role validator plus direct-access policy | Frontend prohibition tests | Locally tested |
| Submission/Intake compatibility retained | Unchanged schemas and SHA-256 freeze | Byte-for-byte exclusion test | Satisfied locally |
| Anonymous/non-admin live denial and authorized backend success | Synthetic Prompt 4 attack contract | Contract completeness only | Pending authorized staging |

`DR-RLS-001` advances from planned to **implemented and locally tested, not
pushed or live-certified**. See the
[RLS contract](../security/base44-draft-entity-rls-contract.md).

## 2026-08-06 backend-only sensitive entity access evidence

| Requirement | Source evidence | Test evidence | Status |
|---|---|---|---|
| Production browser cannot access sensitive entities directly | Policy JSON, AST/bundle validator, retired legacy draft/event paths | Static validator and focused guard tests | Locally tested; staging/RLS pending |
| Browser E2E fails on direct sensitive entity transport | Shared redacting Playwright route guard | Harness 95/95; guarded submission/PDF 85/85 | Locally tested |
| Kill switch cannot fall back to legacy direct CRUD | `ProDraftServiceUnavailable`, V2-only questionnaire transport | Kill-switch/cache-preservation tests | Locally tested |
| Function invocation remains the frontend server boundary | Draft sync/admin API clients and questionnaire function calls | API/handler guard tests | Locally tested |
| Restrictive entity RLS | Deferred by prompt; no schema edits | None in this increment | Open/release-blocking |

The complete evidence and command outcomes are recorded in the
[backend-only access policy](../security/backend-only-sensitive-entity-access-policy.md).
No deployment or production change occurred.

## 2026-08-06 admin recovery UI source evidence

The password-only admin recovery UI now uses the persistent grant lifecycle
and protected backend-only draft/event/intake/update/lineage/retry/repair APIs.
Local evidence includes bounded pagination and exact search, lazy detail/event
loads, allowlisted conflict-safe editing, explicit event-value disclosure,
duplicate partition warnings, device forgetting, grant isolation, and a
frontend direct-entity static guard. See the
[admin UI and grant lifecycle contract](../admin/admin-recovery-ui-and-grant-lifecycle.md).
This advances source implementation evidence only; credentialed staging and
production-disabled acceptance remain pending and no deployment occurred.

## 2026-08-06 backend-only administration increment

| Requirement | Source evidence | Test evidence | Status |
|---|---|---|---|
| Persistent grant on every operation | `_shared/proDraftAdminRequest`, retry/repair | `proDraftAdminAuthorization`, `draftRecoveryAuthorization` | Source verified; staging pending |
| Bounded read APIs and safe projections | `_shared/proDraftAdminService`, five functions | `proDraftAdminService` | Source verified; staging pending |
| Allowlisted optimistic edit and audits | admin service/update function | `proDraftAdminService` | Source verified; staging pending |
| Backend client transport | `proDraftAdminApiClient.js` | `proDraftAdminApiClient` | Source verified; UI migration pending |
| No production mutation | Source/tests/docs only | Git/validation evidence | Satisfied |

## 2026-08-06 password-only admin authorization source evidence

`DR-ADMIN-001` now has source implementation in `proDraftAdminAuthorization`, the refactored `verifyDraftRecoveryAccess`, `proDraftAdminGrantVault`, `proDraftAdminAuthorizationClient`, and `ProDraftAdminAuthorizationContext`, with focused unit/contract coverage for all password, grant, revocation, rate, lockout, storage, client, and Strict Mode boundaries. The admin pages deliberately remain on their legacy gate until the next migration prompt, so `DR-ADMIN-001` is source-implemented but not workflow/staging certified. `DR-ADMIN-002` and `DR-RLS-001` remain open: this batch adds no direct draft access and does not claim the existing page's direct entity calls are remediated.

- Status: Mixed implementation; backend security/revision primitives certified in staging; application and release certification pending
- Date: 2026-08-06
- Owners: Isaac Hines; Engineering; QA; Security; Operations
- Acceptance contract: [Production acceptance criteria](./production-acceptance-criteria.md)

## Matrix rules

Each row is a stable requirement. Evidence IDs name artifacts that later implementation and certification batches must create; they do not claim current evidence. `Not applicable` is permitted only when the environment cannot exercise the requirement and another named phase must prove it. A row advances from `Planned` to `Implemented`, `Tested`, or `Certified` only with reviewable evidence. `Failed` and `Blocked` have the meanings in the acceptance verdict contract.

All rows in this initial matrix are release blocking. Production-enabled evidence marked as a continuation check is collected immediately after the separate authorized enablement step; failure invokes the documented kill switch/rollback. No row may be removed or changed to non-blocking without a versioned architecture and risk review.

### 2026-08-06 sync and mutation staging certification attempt

The [certification report](../testing/staging-sync-and-mutation-certification.md)
classifies candidate `56ef59fa02d10b5281e66907ca998af127c6644f` as
**DRAFT_SYNC_AND_MUTATION_CAPTURE_FAILED**. Focused source coverage passed
254/254, but `npm test` failed 5 of 1,586 tests. The hard stop prevented every
staging target, deployment, authoritative server-field, browser, offline,
multi-tab, lifecycle, performance, and cleanup check. No requirement advances
to staging-certified; local Prompt 1–3 evidence remains local only.

### 2026-08-06 authoritative client sync-manager source evidence

The [client synchronization contract](../frontend/draft-sync-manager-contract.md),
React-independent manager, bootstrap-gated provider/hook, truthful save-state UI,
and explicit V2/legacy branch add local implementation and test evidence for
`DR-LOCAL-001`, `DR-SAVE-001`, `DR-REV-001`, `DR-OFFLINE-001`,
`DR-LIFE-001`, and `DR-MUT-001`. The manager owns debounced and maximum-wait
server saves, one-in-flight coalescing, hash-bound idempotency, backend-only
server revision acceptance, offline recovery, bounded retry, lifecycle
fallback, terminal locks, and an independent event queue. The existing local
canonical persistence controller remains the sole browser-cache writer.

Focused source validation passes 128/128 tests and the five-suite legacy
characterization gate passes 27/27. The production build passes. The full
normal suite passes 1,519/1,524 but retains five established questionnaire and
submission-repair failures; repository lint/typecheck also retain their
established project-wide debt. These remain release-blocking, so no
requirement is promoted to staging-certified or production-ready. Interactive
conflict merge and migration of every component mutation to the canonical
mutation factory remain later-batch work. No Base44 deploy, schema push,
feature-branch push, production operation, or `main` change occurred.

## Planned implementation batches

### 2026-08-06 Clear All and Start New client source evidence

The [client replacement flow](../frontend/clear-all-and-start-new-client-flow.md),
replacement API client/controller, accessible confirmation and code dialogs,
draft-tagged sync invalidation, and 18-scenario synthetic browser suite add local
implementation/test evidence for `DR-CLEAR-001`, `DR-NEW-001`, `DR-LOCAL-002`,
`DR-SUBTERM-001`, `DR-LIFE-001`, `DR-REC-001`, and `DR-A11Y-001`. Clear All
requires a locally flushed and server-accepted revision before committing the
replacement; cleanup is exact-namespace only. Start New preserves the submitted
record/cache/credential. Raw code/tokens remain outside Redux and URL/history.
Focused validation passed 83/83, and the synthetic 18-scenario suite passed
90/90 across the configured five desktop/mobile browser projects. The full
normal suite remains blocked at 1,650/1,655 by five established unrelated
assertions; repository lint/typecheck also retain their established debt. This
is local source evidence only; staging and release certification remain pending.
No deployment, email, final submission, feature-branch push, or production
operation occurred.

### 2026-08-06 conflict merge and multi-tab source evidence

The [conflict merge and multi-tab contract](../frontend/conflict-merge-and-multi-tab-contract.md),
pure merge engine, safe tab coordinator, bounded 409 reconciliation loop, and
accessible conflict dialog add local implementation evidence for
`DR-CONCUR-001`, `DR-REV-001`, `DR-SAVE-001`, `DR-LIFE-001`, `DR-SEC-001`, and
`DR-A11Y-001`. Focused coverage passes 59/59, and the synthetic desktop
Chromium/Firefox/WebKit matrix passes 18/18. Ambiguous same-field edits require
choice; submitted/superseded server state wins; channel envelopes contain no
answers, credentials, email, domain, recovery codes, or tokens. This is local
source evidence only. Staging certification and release gates remain pending,
and no deployment or push occurred.

| Batch | Scope |
| --- | --- |
| `B01` | Safe boot, browser capability detection, local persistence, and namespace isolation. |
| `B02` | Canonical server persistence, revision/hash protocol, mutation capture, and save-state UI. |
| `B03` | Draft identity, opening recovery, email/code selection, recovery sessions, and panel. |
| `B04` | Clear All, submission terminality, immutable snapshots, PDF identity, and compatibility paths. |
| `B05` | SES routing, recovery abuse controls, administrative grants, scoped functions, and RLS. |
| `B06` | Automated browser/device/accessibility/concurrency/load suites and observability. |
| `B07` | Blue/green migration, reconciliation, reverse migration, domain reversal, and rollback tooling. |
| `B08` | Staging/green certification, production-disabled deployment, enablement, and post-enable gates. |

## Requirement matrix

### 2026-08-06 client recovery bootstrap and entry source evidence

The scoped credential vault, one-time bootstrap coordinator, safe hook/context
boundary, opening modal, bootstrap gate, CAPTCHA adapter, and seven visual E2E
scenarios add local source
evidence for `DR-BOOT-001`, `DR-LOCAL-001`, `DR-LOCAL-002`, `DR-ID-002` through
`DR-ID-005`, `DR-REC-001`, `DR-REC-002`, `DR-MODAL-001`, and `DR-PDF-001`.
Credentials remain outside Redux/canonical state; explicit client choice gates
create/email/code operations; submitted state is read-only; malformed vaults
do not replace the cache. Local component evidence is 42/42 and the five-browser
desktop/mobile matrix is 35/35. Ordinary server autosave migration, staging
deployment, environment certification, and release evidence remain pending.

### 2026-08-06 public recovery page and panel source evidence

The public `/recover-draft` route, explicit email/code recovery forms,
email-authorized transient choice list, V2-only panel before Question 1,
compact footer disclosure, display-safety helpers, and acknowledged-revision
save wording add local evidence for `DR-REC-001`, `DR-REC-002`,
`DR-PANEL-001`, `DR-LOCAL-001`, and `DR-A11Y-001`. Code sessions cannot list
email-associated drafts; tokens remain behind the credential boundary; and
the legacy path is unchanged. Live staging, automated accessibility auditing,
ordinary V2 server autosave, and release certification remain pending.

### 2026-08-06 client recovery staging certification attempt

The [staging client recovery entry report](../frontend/staging-recovery-entry-certification.md)
is **CLIENT_RECOVERY_ENTRY_FAILED**. The focused credential-vault, bootstrap,
modal, recovery, panel, API-client, public-recovery, and canonical-state gate
passed 394/394 tests. The required full normal suite then failed 5 of 1,496
tests, activating the explicit pre-deployment hard stop. No baseline suite,
lint, typecheck, build, E2E, staging checkout update, target guard, flag check,
deployment, fixture, live matrix, cleanup mutation, certification push, or
production operation followed. `DR-MODAL-001`, `DR-REC-001`, `DR-REC-002`,
`DR-PANEL-001`, `DR-BROWSER-001`, and `DR-A11Y-001` retain local source
evidence only; none received staging certification.

### 2026-08-05 bootstrap/load implementation evidence

| Requirement | Local implementation evidence | Test evidence | Remaining release gate |
| --- | --- | --- | --- |
| Authorized bootstrap and idempotent create | `bootstrapProFormDraft`; keyed idempotency; one-time credentials; client bootstrap token | `bootstrapProFormDraft.test.js` | Deploy-disabled staging certification and concurrent live retry proof |
| Exact authorized load | `loadProFormDraft`; resume/invitation/recovery-session exact binding; `canWrite` | `loadProFormDraft.test.js`; resolver suite | Live service-role/FLS and denial matrix |
| Signed-email isolation | Visible claim validation; replacement email is unverified, unqueried, and has no inherited identity key | Changed/unchanged invitation bootstrap tests | Staging invitation issuer interoperability |
| Submitted and terminal lifecycle | Submitted scope/read-only projection; superseded/expired/deleted controlled errors | Load lifecycle tests | Staging entity records and immutable submitted snapshot proof |
| Legacy read compatibility | Independent reconstruction; metadata failure does not discard responses; no read upgrade | Legacy reconstruction tests | Migration utility and production-data rehearsal |
| Response confidentiality | Allowlisted projection, no-store, safe codes/request IDs, raw values only on create | Response/hash/raw-storage assertions | Deployed network/log scan |

These rows move the source/test portions of `DR-SAVE-001`, `DR-SAVE-002`,
`DR-ID-002`, `DR-ID-003`, `DR-ID-004`, `DR-LIFE-001`, and `DR-SEC-001` to
implemented locally. Environment evidence remains pending; no row is certified
for release by this source-only change.

| Requirement ID | Requirement description | ADR source | Planned implementation batch | Planned source files/modules | Unit test ID | Integration test ID | Browser test ID | Staging evidence | Production-disabled evidence | Production-enabled evidence | Release blocking | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `DR-SRC-001` | Verify immutable remote baseline/backup refs and three fresh-clone baseline builds. | [ADR-001 §M](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B07` | `scripts/ensure-durable-draft-workspace.mjs`; baseline manifests/runbooks | `UT-SRC-001` | `IT-SRC-001` | `BT-SRC-001` | `EV-STG-SRC-001` fresh-clone/build manifest | `EV-PD-SRC-001` remote-ref proof | Not applicable—source gate precedes enablement | Yes | Planned |
| `DR-ROLLBACK-001` | Rehearse source rollback, document/timer-test domain reversal, and prove the kill switch. | [ADR-001 §M](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-002 §I](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md) | `B07`, `B08` | rollback runbooks; feature-flag module (planned); release automation (planned) | `UT-ROLLBACK-001` | `IT-ROLLBACK-001` | `BT-ROLLBACK-001` | `EV-STG-ROLLBACK-001` timed rehearsal | `EV-PD-ROLLBACK-001` kill-switch/domain proof | `EV-PE-ROLLBACK-001` continuation trigger proof | Yes | Planned |
| `DR-MIG-REV-001` | Complete verified green-to-blue reverse data migration before launch. | [ADR-002 §E/I](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md) | `B07` | migration runner, ID map, checkpoint, and integrity reporter (planned) | `UT-MIG-REV-001` | `IT-MIG-REV-001` | `BT-MIG-REV-001` | `EV-STG-MIG-REV-001` reverse rehearsal | `EV-PD-MIG-REV-001` production-data dry-run plan | Not applicable—must pass before cutover | Yes | Planned |
| `DR-BOOT-001` | Render under available, throwing, or unavailable localStorage/IndexedDB combinations. | [ADR-001 §A/K](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B01` | `src/lib/app-params.js`; `src/api/base44Client.js`; `src/lib/browserSafety.js`; `src/lib/resilientStorage.js`; `src/App.jsx` | `UT-BOOT-001` | `IT-BOOT-001` | `BT-BOOT-001` | `EV-STG-BOOT-001` storage-fault matrix | `EV-PD-BOOT-001` production bundle smoke | `EV-PE-BOOT-001` post-enable synthetic boot | Yes | Implemented — environment certification pending |
| `DR-BOOT-002` | Bound bootstrap to five seconds with zero uncaught SecurityError or infinite loading states. | [ADR-001 §A/K](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B01` | `src/App.jsx`; `src/lib/AuthContext.jsx`; `src/components/common/AppInitializationError.jsx`; `src/components/common/ErrorBoundary.jsx` | `UT-BOOT-002` | `IT-BOOT-002` | `BT-BOOT-002` | `EV-STG-BOOT-002` timing/console report | `EV-PD-BOOT-002` disabled-flow timing | `EV-PE-BOOT-002` continuation timing | Yes | Implemented — environment certification pending |
| `DR-LOCAL-001` | Persist each supported mutation promptly, report truthful local/server states, and preserve last good snapshot. | [ADR-001 §A](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §J](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B01`, `B02` | `src/lib/questionnaireCanonicalDraftCache.js`; `src/components/store/localCanonicalDraftPersistence.js`; `src/components/pro-form/AutoSaveIndicator.jsx`; `src/components/store/formSlice.jsx`; `src/components/store/store.jsx` | `UT-LOCAL-001` | `IT-LOCAL-001` | `BT-LOCAL-001` | `EV-STG-LOCAL-001` latency/corruption suite | `EV-PD-LOCAL-001` disabled-binary smoke | `EV-PE-LOCAL-001` continuation save states | Yes | Browser-local portion implemented/tested; server acknowledgement/recovery and environment certification pending |
| `DR-LOCAL-002` | Keep raw identity secrets out of keys and isolate clients sharing a browser profile. | [ADR-001 §B/D](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §B/C](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B01` | `src/lib/questionnaireBrowserNamespace.js`; `src/lib/legacyQuestionnaireStorage.js`; `src/lib/sessionId.js`; `src/components/store/store.jsx` | `UT-LOCAL-002` | `IT-LOCAL-002` | `BT-LOCAL-002` | `EV-STG-LOCAL-002` key/namespace audit | `EV-PD-LOCAL-002` built-runtime audit | `EV-PE-LOCAL-002` sampled continuation audit | Yes | Implemented — environment certification pending |
| `DR-ID-001` | Normalize recovery email and business domain deterministically across browser, backend, and migration adapters without treating normalization as authorization. | [ADR-003 §B](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B03`, `B07` | `src/lib/proDraftIdentity.js`; later Deno/migration adapters | `UT-ID-001` | `IT-ID-001` | `BT-ID-001` | `EV-STG-ID-001` cross-runtime normalization corpus | `EV-PD-ID-001` disabled-path parity proof | `EV-PE-ID-001` continuation normalization sample | Yes | Client contract implemented/tested; backend/migration use pending |
| `DR-ID-002` | Treat a changed signed-invitation email as a new unverified association and never search replacement-email drafts automatically. | [ADR-001 §B](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §G](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B03` | `src/lib/proDraftIdentity.js`; `src/lib/proDraftBootstrapCoordinator.js`; later modal | `UT-ID-002` | `IT-ID-002` coordinator boundary | `BT-ID-002` | `EV-STG-ID-002` signed-email path matrix | `EV-PD-ID-002` invitation-disabled proof | `EV-PE-ID-002` continuation invitation sample | Yes | Client decision/coordinator implemented and tested; UI/environment proof pending |
| `DR-ID-003` | Require explicit recovery-risk acknowledgement before an anonymous start proceeds without email. | [ADR-001 §B](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §G](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B03` | `src/lib/proDraftIdentity.js`; `src/lib/proDraftBootstrapCoordinator.js`; later opening modal | `UT-ID-003` | `IT-ID-003` coordinator create gate | `BT-ID-003` controller | `EV-STG-ID-003` anonymous-path evidence | `EV-PD-ID-003` disabled-flow proof | `EV-PE-ID-003` continuation acknowledgement sample | Yes | Identity/coordinator invariant implemented/tested; visual UI and environment proof pending |
| `DR-ID-004` | Preserve explicit email provenance and verification state; client-entered and email-recovery associations remain `unverified` until a trusted backend method succeeds. | [ADR-001 §C/future compatibility](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §B/L](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B03`, `B05` | `src/lib/proDraftIdentity.js`; `src/lib/proDraftBootstrapCoordinator.js`; later signed-invitation/OTP/magic-link adapters | `UT-ID-004` | `IT-ID-004` email handoff | `BT-ID-004` controller | `EV-STG-ID-004` provenance/verification matrix | `EV-PD-ID-004` disabled-method audit | `EV-PE-ID-004` continuation verification audit | Yes | Unverified client recovery provenance implemented/tested; visual and environment verification pending |
| `DR-ID-005` | Exclude PII, invitation values, tokens, and recovery codes from identity diagnostics and keep raw identity out of browser key names. | [ADR-003 §B/G](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B01`, `B03`, `B05` | `src/lib/proDraftIdentity.js`; `src/lib/questionnaireBrowserNamespace.js`; `src/lib/proDraftCredentialVault.js`; later server diagnostics | `UT-ID-005` vault/diagnostic scan | `IT-ID-005` Redux exclusion | `BT-ID-005` controller | `EV-STG-ID-005` diagnostic/key scan | `EV-PD-ID-005` built/log scan | `EV-PE-ID-005` continuation log sample | Yes | Client diagnostics/key/vault contract implemented/tested; deployed/server proof pending |
| `DR-SAVE-001` | Round-trip all canonical answer, validation, touched, expanded, credential, and editor state to `ProFormDraft`. | [ADR-001 §A](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §A/J](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B02` | `base44/functions/saveProFormDraft/entry.ts`; `base44/functions/_shared/proDraftSaveEvents/entry.ts` | `UT-SAVE-001` | `IT-SAVE-001` | `BT-SAVE-001` | `EV-STG-SAVE-001` live canonical/CAS report pending | `EV-PD-SAVE-001` synthetic scoped saves | `EV-PE-SAVE-001` continuation synthetic saves | Yes | Source integration implemented/tested; live staging certification pending |
| `DR-REV-001` | Enforce acknowledged revisions/hashes, duplicate idempotency, collision conflict, and stale rejection. | [ADR-001 §L](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §J](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B02` | `base44/functions/_shared/proDraftPersistence/entry.ts`; `base44/functions/saveProFormDraft/entry.ts` | `UT-REV-001` | `IT-REV-001` local two-writer harness | `BT-REV-001` | [Primitive certification](../security/staging-security-primitives-certification.md); live CAS pending | Production 404/disabled self-check proof; no production deployment | `EV-PE-REV-001` conflict continuation sample | Yes | Primitive staging-certified and save source integrated; live atomicity pending |
| `DR-SUBTERM-001` | Prevent every autosave, retry, merge, or delayed response from regressing `submitted`. | [ADR-001 §F/L](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §D/I/J](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B02`, `B04` | `base44/functions/_shared/proDraftPersistence/entry.ts`; `base44/functions/saveProFormDraft/entry.ts` | `UT-SUBTERM-001` | `IT-SUBTERM-001` delayed-active local harness | `BT-SUBTERM-001` | [Submitted-regression primitive check](../security/staging-security-primitives-certification.md); deployed writer pending | Production 404/disabled local proof | `EV-PE-SUBTERM-001` continuation terminal smoke | Yes | Writer source integration implemented/tested; live staging certification pending |
| `DR-PERF-001` | Meet p95 2.5-second and p99 5-second ordinary server acknowledgement targets. | [ADR-003 §J](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B02`, `B06` | persistence telemetry (planned); load harness (planned) | `UT-PERF-001` | `IT-PERF-001` | `BT-PERF-001` | `EV-STG-PERF-001` latency distribution | `EV-PD-PERF-001` production-disabled load sample | `EV-PE-PERF-001` continuation latency dashboard | Yes | Planned |
| `DR-REC-001` | Exact-email recovery chooses only the newest server-created eligible draft with deterministic tie-break. | [ADR-001 §C/E](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §B/E](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B03` | `recoverProFormDraftByEmail`; shared email-recovery/identity/repository contracts; client wrapper/coordinator/vault | `UT-REC-001` email recovery/identity/repository/client/coordinator suites | `IT-REC-001` exact-token load handoff | `BT-REC-001` controller handoff | `EV-STG-REC-001` randomized selection corpus pending | `EV-PD-REC-001` production synthetic selector | `EV-PE-REC-001` continuation recovery synthetic | Yes | Source endpoint and explicit client handoff implemented/tested; deliberately unverified policy; deployment/UI certification pending |
| `DR-REC-002` | Code selects one exact draft without email; submitted is read-only; older list follows authorization. | [ADR-001 §D/E/F](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §C/F](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B03` | recovery code/security/authorization endpoint; client coordinator and credential vault | `UT-REC-002` code/vault/coordinator | `IT-REC-002` exact-token load and read-only hydration | `BT-REC-002` controller handoff | [Generation/hash/session primitive certification](../security/staging-security-primitives-certification.md) | Production 404 and absent purpose-secret names | `EV-PE-REC-002` continuation code synthetic | Yes | Source endpoint/client storage/handoff implemented/tested; live abuse-control and UI certification pending |
| `DR-SEC-001` | Achieve at least 99.9% authorized recovery correctness and zero cross-scope exposure. | [ADR-001 accepted risks](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §E/F](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B03`, `B05`, `B06` | signed-token/crypto primitives; code/email recovery functions; choice functions; 10k harness pending | `UT-SEC-001` authorization/recovery/security suites | `IT-SEC-001` token/load and choice binding | `BT-SEC-001` | [Environment/purpose/tamper primitive certification](../security/staging-security-primitives-certification.md); live endpoints pending | Production 404, no function deployment, no purpose-secret names | `EV-PE-SEC-001` immediate continuation boundary checks | Yes | Endpoint scope/hash boundaries locally tested; 10k and environment certification pending |
| `DR-MODAL-001` | Always gate autosave with opening choices, signed-email rules, no-email acknowledgement, and code copy. | [ADR-001 §B](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §G](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B03` | `src/components/pro-form/ProDraftEntryModal.jsx`; `src/components/pro-form/ProDraftBootstrapGate.jsx`; `src/components/pro-form/ProDraftRecoveryCaptcha.jsx`; `src/pages/ProQuestionnaire.jsx` | `UT-MODAL-001` 42 component cases | `IT-MODAL-001` bootstrap/page gate | `BT-MODAL-001` 35 desktop/mobile cases | `EV-STG-MODAL-001` modal path matrix pending | `EV-PD-MODAL-001` invitation smoke pending | `EV-PE-MODAL-001` continuation modal synthetic pending | Yes | Opening modal and pre-interaction gate implemented/tested locally; authoritative V2 autosave migration and environment certification pending |
| `DR-A11Y-001` | Prove keyboard and screen-reader access with zero serious/critical automated violations. | [ADR-001 §B/K](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B03`, `B06` | opening modal; public recovery page; recovery panel; UI primitives | `UT-A11Y-001` page/panel semantics and keyboard tests | `IT-A11Y-001` V2 placement/route | `BT-A11Y-001` five-browser keyboard/mobile fixture | `EV-STG-A11Y-001` automated/manual report | `EV-PD-A11Y-001` production bundle scan | `EV-PE-A11Y-001` continuation keyboard smoke | Yes | Keyboard/mobile source coverage implemented; automated and manual staging accessibility certification pending |
| `DR-PANEL-001` | Place the recovery panel outside the header with safe mask/copy, truthful state, and no analytics leakage. | [ADR-001 §D](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B03` | `src/components/pro-form/ProDraftRecoveryPanel.jsx`; `src/lib/proDraftDisplaySafety.js`; `src/components/pro-form/AutoSaveIndicator.jsx` | `UT-PANEL-001` panel/display/autosave suites | `IT-PANEL-001` V2 Q1/footer placement | `BT-PANEL-001` five-browser panel fixture | `EV-STG-PANEL-001` viewport/network suite | `EV-PD-PANEL-001` disabled-binary inspection | `EV-PE-PANEL-001` continuation panel smoke | Yes | Source and synthetic local-browser evidence implemented; live staging certification pending |
| `DR-MUT-001` | Cover every named answer, editor, validation, touched, expanded, reset, and cleanup mutation. | [ADR-001 §A](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §A](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B02`, `B06` | [complete mutation capture contract](../frontend/complete-mutation-capture-contract.md); listener middleware; event/metadata mappers; pro-form editors | listener/metadata/mutation suites | sync/store integration | 20-case five-project browser matrix | `EV-STG-MUT-001` live per-type round trips pending | `EV-PD-MUT-001` production-disabled smoke subset | `EV-PE-MUT-001` continuation mutation synthetic | Yes | Implemented/tested locally; live staging certification pending |
| `DR-MUT-002` | Persist uploaded URL/safe metadata while excluding raw `File`/`Blob` and preserving malformed-snapshot safety. | [ADR-001 §A](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B01`, `B02` | upload-capable pro-form components; canonical serializer; [mutation contract](../frontend/complete-mutation-capture-contract.md) | raw-file rejection/upload metadata tests | canonical-state integration | five-project file metadata/reload matrix | `EV-STG-MUT-002` real upload/interruption pending | `EV-PD-MUT-002` bundle/runtime sample | `EV-PE-MUT-002` continuation upload synthetic | Yes | Implemented/tested locally; real staging upload proof pending |
| `DR-CLEAR-001` | Atomically supersede the old draft and create a newer empty draft with new identity/code and retained email metadata. | [ADR-001 §G](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §H](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B04` | Clear All backend function/UI (planned); draft events | `UT-CLEAR-001` | `IT-CLEAR-001` | `BT-CLEAR-001` | `EV-STG-CLEAR-001` 100 transaction report | `EV-PD-CLEAR-001` scoped production synthetic | `EV-PE-CLEAR-001` continuation transaction synthetic | Yes | Planned |
| `DR-CLEAR-002` | Keep replacement active on email failure and reject all delayed saves to old draft. | [ADR-001 §G/H](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §H](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B04`, `B05` | Clear All/SES functions (planned); revision guard | `UT-CLEAR-002` | `IT-CLEAR-002` | `BT-CLEAR-002` | `EV-STG-CLEAR-002` failure/stale suite | `EV-PD-CLEAR-002` injected non-delivery proof | `EV-PE-CLEAR-002` continuation event audit | Yes | Planned |
| `DR-SUBMIT-001` | Force-save one immutable snapshot, record attempt/success/failure, preserve answers, and keep Zapier/intake compatible. | [ADR-001 §F](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §I](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B04` | `src/lib/proQuestionnaireSubmit.js`; submission/intake functions; `submissionPayload.jsx` | `UT-SUBMIT-001` | `IT-SUBMIT-001` | `BT-SUBMIT-001` | `EV-STG-SUBMIT-001` success/failure/compatibility suite | `EV-PD-SUBMIT-001` existing-flow smoke | `EV-PE-SUBMIT-001` continuation submission synthetic | Yes | Planned |
| `DR-PDF-001` | Reopen submitted read-only, regenerate from its snapshot, and Start New without altering it. | [ADR-001 §F](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §I](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B04` | `PDFGenerator.jsx`; `pdf/*`; `useQuestionnairePdfDownload.js`; Start New function (planned) | `UT-PDF-001` | `IT-PDF-001` | `BT-PDF-001` | `EV-STG-PDF-001` 500 multi-draft cases | `EV-PD-PDF-001` existing/submitted smoke | `EV-PE-PDF-001` continuation PDF synthetic | Yes | Planned |
| `DR-EMAIL-001` | Verify production SES sender/readiness/least privilege and guarantee staging allowlist plus subject prefix. | [ADR-001 §H](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B05` | SES delivery function/config/runbook (planned) | `UT-EMAIL-001` | `IT-EMAIL-001` | `BT-EMAIL-001` | `EV-STG-EMAIL-001` 100-message routing report | `EV-PD-EMAIL-001` account/IAM inventory | `EV-PE-EMAIL-001` approved-recipient continuation synthetic | Yes | Planned |
| `DR-EMAIL-002` | Bound idempotent retries, test bounce/complaint handling, and exclude AWS secrets from frontend. | [ADR-001 §H](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B05` | SES queue/retry/audit function and runbook (planned); build scan | `UT-EMAIL-002` | `IT-EMAIL-002` | `BT-EMAIL-002` | `EV-STG-EMAIL-002` failure/simulator/secret scan | `EV-PD-EMAIL-002` built-asset and account proof | `EV-PE-EMAIL-002` delivery-failure dashboard sample | Yes | Planned |
| `DR-ABUSE-001` | Enforce per-IP/per-email-hash limits, increasing delay, CAPTCHA, lockout, and safe audit. | [ADR-001 §C](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B05` | abuse-control service and audit events (planned) | `UT-ABUSE-001` | `IT-ABUSE-001` | `BT-ABUSE-001` | `EV-STG-ABUSE-001` threshold boundary suite | `EV-PD-ABUSE-001` production-config proof | `EV-PE-ABUSE-001` continuation activation synthetic | Yes | Planned |
| `DR-ABUSE-002` | Produce generic public errors, no raw code/email logs, and no deterministic enumeration oracle. | [ADR-001 §C/D](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §E/F](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B05`, `B06` | recovery response mapper/log redaction (planned); enumeration harness (planned) | `UT-ABUSE-002` | `IT-ABUSE-002` | `BT-ABUSE-002` | `EV-STG-ABUSE-002` content/timing corpus | `EV-PD-ABUSE-002` safe-log inspection | `EV-PE-ABUSE-002` continuation public-boundary sample | Yes | Planned |
| `DR-ADMIN-001` | Verify password in backend; persist signed scoped grant; prove local and fleet revocation plus attempt limits. | [ADR-001 §I](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §K](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B05` | `proDraftAdminAuthorization`; `verifyDraftRecoveryAccess`; admin grant vault/client/context | `UT-ADMIN-001` focused source suite | `IT-ADMIN-001` endpoint/vault/context contract tests | `BT-ADMIN-001` pending page migration | [Password-only admin authorization contract](../admin/password-only-admin-recovery-authorization-contract.md) | Production deployment and page migration absent | `EV-PE-ADMIN-001` continuation admin synthetic | Yes | Source implemented; staging workflow and operational revocation proof pending |
| `DR-ADMIN-002` | Exclude direct entity credentials/raw grants and enforce list/read/update field allowlists with audit. | [ADR-001 §I](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §K](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B05` | `DraftEditPanel.jsx`; admin backend projection/update functions (planned); audit events | `UT-ADMIN-002` | `IT-ADMIN-002` | `BT-ADMIN-002` | `EV-STG-ADMIN-002` allowlist/containment suite | `EV-PD-ADMIN-002` bundle/network/entity audit | `EV-PE-ADMIN-002` continuation privileged audit | Yes | Planned |
| `DR-RLS-001` | Deny anonymous direct draft/event CRUD while scoped public/admin backend functions remain authorized. | [ADR-001 §A/I](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B05` | `base44/entities/ProFormDraft.jsonc`; `ProFormDraftEvent.jsonc`; scoped functions (planned) | `UT-RLS-001` | `IT-RLS-001` | `BT-RLS-001` | `EV-STG-RLS-001` 100-attempt operation matrix | `EV-PD-RLS-001` production RLS proof | `EV-PE-RLS-001` continuation scope synthetic | Yes | Planned |
| `DR-BROWSER-001` | Certify Chrome, Edge Chromium, Firefox, Safari/WebKit, iOS WebKit, and Android Chromium. | [ADR-001 §K](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B06` | browser automation/device matrix (planned); app/recovery components | `UT-BROWSER-001` | `IT-BROWSER-001` | `BT-BROWSER-001` | `EV-STG-BROWSER-001` full matrix | `EV-PD-BROWSER-001` production-disabled matrix | `EV-PE-BROWSER-001` continuation smoke matrix | Yes | Planned |
| `DR-LINK-001` | Manually verify link opening from Outlook, Gmail, Teams, iOS Mail, and Android Gmail into a browser. | [ADR-001 §K](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B06` | invitation URL parser; manual test protocol (planned) | `UT-LINK-001` | `IT-LINK-001` | `BT-LINK-001` | `EV-STG-LINK-001` five-source manual record | `EV-PD-LINK-001` production-disabled link checks | `EV-PE-LINK-001` approved continuation link check | Yes | Planned |
| `DR-CONCUR-001` | Merge non-overlap, surface same-field conflict, reject stale saves, and make duplicates idempotent. | [ADR-001 §L](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-003 §J](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md) | `B02`, `B06` | field metadata/merge service (planned); conflict UI (planned) | `UT-CONCUR-001` | `IT-CONCUR-001` | `BT-CONCUR-001` | `EV-STG-CONCUR-001` randomized two-tab suite | `EV-PD-CONCUR-001` production synthetic conflicts | `EV-PE-CONCUR-001` continuation two-tab synthetic | Yes | Planned |
| `DR-OFFLINE-001` | Reconcile offline edits and test pagehide/visibility without premature server acknowledgement. | [ADR-001 §A/L](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B01`, `B02`, `B06` | persistence queue/flush coordinator (planned); save indicator | `UT-OFFLINE-001` | `IT-OFFLINE-001` | `BT-OFFLINE-001` | `EV-STG-OFFLINE-001` 500 reconnect sequences | `EV-PD-OFFLINE-001` production-disabled browser suite | `EV-PE-OFFLINE-001` continuation reconnect sample | Yes | Planned |
| `DR-MIG-001` | Pass full, repeated idempotent delta, and final write-freeze migrations. | [ADR-002 §C/E/F](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md) | `B07` | migration runner/checkpoints/ID map (planned) | `UT-MIG-001` | `IT-MIG-001` | `BT-MIG-001` | `EV-STG-MIG-001` three-delta/freeze rehearsal | `EV-PD-MIG-001` blue-to-green batch evidence | Not applicable—pre-cutover gate | Yes | Planned |
| `DR-MIG-002` | Detect/reconcile late blue writes and pass green-to-blue reversal. | [ADR-002 §E/I](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md) | `B07` | reconciliation observer and reverse runner (planned) | `UT-MIG-002` | `IT-MIG-002` | `BT-MIG-002` | `EV-STG-MIG-002` injected-late-write/reverse proof | `EV-PD-MIG-002` launch reconciliation readiness | `EV-PE-MIG-002` live late-write continuation report | Yes | Planned |
| `DR-MIG-003` | Prove counts/hashes/relationships/files, exclude staging data, and leave zero unresolved rows. | [ADR-002 §C/D/G](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md) | `B07` | integrity reporter/file verifier/classifier (planned) | `UT-MIG-003` | `IT-MIG-003` | `BT-MIG-003` | `EV-STG-MIG-003` integrity report | `EV-PD-MIG-003` final-delta integrity report | `EV-PE-MIG-003` continuation reconciliation report | Yes | Planned |
| `DR-RET-001` | Retain eligible unsubmitted drafts/events for at least one year, honor support/migration holds, dry-run first, and require report-bound manual authorization for bounded deletion. | [One-year retention contract](../retention/one-year-draft-retention-contract.md) | `B07` | `proDraftRetention`; retention repository/service/auth; analyze/apply/scheduled functions | `UT-RET-001` policy/token | `IT-RET-001` dry-run/apply/checkpoint | `BT-RET-001` pending admin workflow | `EV-STG-RET-001` real-data dry run/backup/restore pending | `EV-PD-RET-001` production approval pending | `EV-PE-RET-001` continuation reconciliation pending | Yes | Source implemented; no deploy, secret, or deletion |
| `DR-LOAD-001` | Sustain the greater of business estimate or 250 sessions/1,000 drafts for 60 minutes. | [ADR-001 §A/M](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B06` | realistic load harness and data factory (planned) | `UT-LOAD-001` | `IT-LOAD-001` | `BT-LOAD-001` | `EV-STG-LOAD-001` 60-minute report | `EV-PD-LOAD-001` production-safe capacity sample | `EV-PE-LOAD-001` continuation capacity dashboard | Yes | Planned |
| `DR-LOAD-002` | Bound request/event growth and payload size with successful-path errors below 0.1%. | [ADR-001 §A/L](../architecture/ADR-001-approved-product-and-security-decisions.md) | `B02`, `B06` | debounce/coalescing policy; payload limits; load telemetry (planned) | `UT-LOAD-002` | `IT-LOAD-002` | `BT-LOAD-002` | `EV-STG-LOAD-002` request/event/payload report | `EV-PD-LOAD-002` configured-limit proof | `EV-PE-LOAD-002` continuation error-rate dashboard | Yes | Planned |
| `DR-OBS-001` | Emit all required save, recovery, conflict, abuse, SES, submission, PDF, and migration signals. | [ADR-001 §C/H/I/M](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-002 §G/I](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md) | `B06`, `B07` | structured telemetry/audit modules and dashboards (planned) | `UT-OBS-001` | `IT-OBS-001` | `BT-OBS-001` | `EV-STG-OBS-001` signal correlation suite | `EV-PD-OBS-001` production dashboard proof | `EV-PE-OBS-001` continuation signal sample | Yes | Planned |
| `DR-OBS-002` | Configure, route, and exercise owned threshold alerts. | [ADR-002 §I](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md) | `B06`, `B08` | alert policy/routes/runbooks (planned) | `UT-OBS-002` | `IT-OBS-002` | `BT-OBS-002` | `EV-STG-OBS-002` alert-delivery exercise | `EV-PD-OBS-002` production route exercise | `EV-PE-OBS-002` continuation alert readiness | Yes | Planned |
| `DR-REL-001` | Certify staging and clean green, deploy disabled, and pass existing production-flow smoke tests. | [ADR-001 §M](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-002 §A/B/H](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md) | `B08` | release evidence aggregator/checklist (planned); smoke suites | `UT-REL-001` | `IT-REL-001` | `BT-REL-001` | `EV-STG-REL-001` staging certification | `EV-PD-REL-001` green/disabled certification | Not applicable—authorizes separate enablement | Yes | Planned |
| `DR-REL-002` | Enable only in a separate authorized step; run post-enable checks with active rollback thresholds. | [ADR-001 §M](../architecture/ADR-001-approved-product-and-security-decisions.md); [ADR-002 §H/I](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md) | `B08` | enablement controller, kill switch, synthetic checks, rollback orchestration (planned) | `UT-REL-002` | `IT-REL-002` | `BT-REL-002` | `EV-STG-REL-002` enable/disable rehearsal | `EV-PD-REL-002` authorization/threshold proof | `EV-PE-REL-002` 1/5/15/60-minute continuation report | Yes | Planned |

## Current audit evidence overlay

This overlay records baseline and feature-branch evidence. A historical characterization pass alone does **not** satisfy a future requirement. Static-only evidence uses `—` for the test ID. The two boot rows now have source/test implementation evidence but remain uncertified until their named environment phases pass.

| Requirement ID | Current implementation assessment | Current audit evidence | Characterization test IDs | Future status |
| --- | --- | --- | --- | --- |
| `DR-SRC-001` | Baseline control exists and the quality workflow verifies the immutable tag/backup SHA on each quality run; three-clone future release proof remains unmet. | [Quality workflow](../../../.github/workflows/durable-draft-quality.yml); [GitHub Actions controls](../testing/github-actions-and-branch-protection.md); [source baseline manifest](../baseline/source-baseline-manifest.md) | `source-safety` (static CI guard) | Planned |
| `DR-BOOT-001` | Feature branch guards parameter/client initialization and scoped Redux rehydration across normal, throwing, quota, unavailable, and memory-only storage modes. The Prompt 4 local rerun passed 35/35 active boot executions; staging deployment was blocked by the aggregate release gate. | [Browser storage resilience](../architecture/browser-storage-resilience.md); [blocked staging certification](../testing/staging-browser-storage-certification.md); [namespace policy](../architecture/browser-namespace-and-legacy-key-policy.md); [DRAFT-001](../audit/current-defect-register.md#draft-001--unsafe-module-evaluation-storage-access) | `BC-BOOT-001`–`006`; `src/test/appParamsSafety.test.js`; `src/test/base44ClientInitialization.test.js`; `src/test/questionnaireStore.test.jsx`; active `DR-BOOT-001` browser matrix | Implemented locally; staging certification blocked before deploy |
| `DR-BOOT-002` | Feature branch bounds settings/auth requests to four seconds, always settles loading state, and provides sanitized non-destructive initialization/render errors. The Prompt 4 local rerun passed across all five configured projects; no deployed timing evidence exists. | [Browser storage resilience](../architecture/browser-storage-resilience.md); [blocked staging certification](../testing/staging-browser-storage-certification.md); [DRAFT-001](../audit/current-defect-register.md#draft-001--unsafe-module-evaluation-storage-access) | `src/test/authContextSafety.test.jsx`; `src/test/appInitializationError.test.jsx`; `src/test/errorBoundarySafety.test.jsx`; active `DR-BOOT-002` browser timing matrix | Implemented locally; staging certification blocked before deploy |
| `DR-LOCAL-001` | Feature branch now persists the complete post-reducer canonical state in a validated namespaced envelope, coalesces actions with bounded delay, preserves the last good cache, restores it deterministically after Redux rehydration, and reports durable browser versus page-only mode truthfully. This cache is not server authority. Its focused suites passed inside the 2026-08-06 aggregate run, but the aggregate gate failed and stopped the staging attempt before deployment. Server acknowledgement, outbox reconciliation, and authorized cross-device recovery remain unmet. | [Local canonical draft cache](../architecture/local-canonical-draft-cache.md); [blocked canonical-state staging attempt](../testing/staging-canonical-state-redux-certification.md); [Browser storage resilience](../architecture/browser-storage-resilience.md); [DRAFT-005](../audit/current-defect-register.md#draft-005--local-backups-are-write-only), [DRAFT-006](../audit/current-defect-register.md#draft-006--lifecycle-persistence-relies-only-on-beforeunload), [DRAFT-019](../audit/current-defect-register.md#draft-019--state-driven-effect-cleanup-can-cancel-the-queued-server-save) | `src/test/questionnaireCanonicalDraftCache.test.js`; `src/test/localCanonicalDraftPersistence.test.js`; `src/test/questionnaireLocalBootstrap.test.js`; active `DR-LOCAL-001`, `003`, `004` browser scenarios | Browser-local implementation tested; staging certification blocked; server/recovery pending |
| `DR-LOCAL-002` | Version 5 applies verified-invitation, authorized-draft, user, business/domain, recovery-email, then session-stable anonymous precedence. Changed signed email cannot reuse the signed namespace; v4 presence is inspection-only and no legacy value is auto-read or deleted. | [Namespace and legacy-key policy](../architecture/browser-namespace-and-legacy-key-policy.md); [DRAFT-002](../audit/current-defect-register.md#draft-002--one-global-redux-persistence-key), [DRAFT-003](../audit/current-defect-register.md#draft-003--one-global-questionnaire-session-key), [DRAFT-017](../audit/current-defect-register.md#draft-017--shared-browser-state-can-leak-across-clients) | `src/test/questionnaireBrowserNamespace.test.js`; `src/test/draftIdentityIntegration.test.js`; `tests/e2e/draft-v2/identity-boundary.spec.js` | Identity-aware browser boundary implemented locally; staging/server authorization certification pending |
| `DR-ID-001` | Version 1 normalization is wired into canonical schema v4, Redux credentials/context, namespace/cache, and bootstrap without network access. No Base44 Deno or migration caller is wired. | [Identity and email normalization contract](../architecture/draft-identity-and-email-normalization-contract.md) | `src/test/proDraftIdentity.test.js`; `src/test/draftIdentityIntegration.test.js` | Browser/client integration implemented/tested; backend/migration parity pending |
| `DR-ID-002` | A different signed email is integrated as `client_entered`, `unverified`, and `changed_signed_email`; v5 namespace and cache mismatch guards prevent old signed-cache hydration. No lookup, modal, or invitation backend exists. | [Identity and email normalization contract](../architecture/draft-identity-and-email-normalization-contract.md) | `src/test/draftIdentityIntegration.test.js`; `DR-IDENTITY-003` across desktop Chromium/Firefox/WebKit | Client/cache boundary implemented/tested; UI/backend pending |
| `DR-ID-003` | `anonymous_start` with no email fails until acknowledgement; acknowledged test state and session-stable anonymous namespace are exercised in all three desktop engines. No acknowledgement UI or server persistence exists. | [Identity and email normalization contract](../architecture/draft-identity-and-email-normalization-contract.md) | `src/test/draftIdentityIntegration.test.js`; `DR-IDENTITY-004` | Client/browser invariant implemented/tested; UI/server pending |
| `DR-ID-004` | Exact source/verification/intent metadata is persisted and selected; untrusted URL claims are forced unverified and only an explicit trusted-backend fixture can select a signed namespace. Recovery methods remain disabled and absent. | [Identity and email normalization contract](../architecture/draft-identity-and-email-normalization-contract.md) | `src/test/draftIdentityIntegration.test.js`; `DR-IDENTITY-001`/`002` | Client/browser provenance implemented/tested; backend verification pending |
| `DR-ID-005` | Canonical, Redux, cache, bootstrap, and selector diagnostics expose only safe enums/versions/booleans/presence; secret fields fail validation and v5 keys remain opaque/non-authoritative. | [Identity and email normalization contract](../architecture/draft-identity-and-email-normalization-contract.md); [namespace policy](../architecture/browser-namespace-and-legacy-key-policy.md) | `src/test/proDraftIdentity.test.js`; `src/test/draftIdentityIntegration.test.js`; `src/test/questionnaireBrowserNamespace.test.js` | Client diagnostics/key integration implemented/tested; server/deployed proof pending |
| `DR-SAVE-001` | The complete canonical/compatibility save writer is implemented locally behind fail-closed runtime controls. Current frontend writers remain unchanged and the function is not deployed. | [Save/event flow](../backend/save-and-event-api-flow.md); [DRAFT-007](../audit/current-defect-register.md#draft-007--server-snapshots-can-mix-response-and-stale-ui-maps) | Focused save/event and local integration suites | Source implemented; live staging round trip pending |
| `DR-REV-001` | Version-1 revision/idempotency evaluation and guarded `updateMany` integration are locally tested, including two-writer conflict, updated-count invariants, and post-read verification. Live Base44 CAS semantics remain uncertified. | [Save/event flow](../backend/save-and-event-api-flow.md); [Primitive certification](../security/staging-security-primitives-certification.md) | Persistence suite plus focused save/event integration | Source integrated; live atomicity blocker remains |
| `DR-SUBTERM-001` | Submitted transition metadata and delayed-active protection are integrated in the local save writer; submitted grants are read-only. Current frontend writers and live Base44 behavior remain outside this evidence. | [Save/event flow](../backend/save-and-event-api-flow.md); [DRAFT-016](../audit/current-defect-register.md#draft-016--delayed-draft-writes-can-regress-submitted-state) | Focused terminal and delayed-write integration tests | Source integrated; live writer certification pending |
| `DR-PERF-001` | No acknowledgement latency telemetry or representative load evidence. | [Audit report, reproduction gaps](../audit/current-system-audit-report.md#unconfirmed-and-partially-confirmed-risks) | — | Planned |
| `DR-REC-001` | The backend queries by purpose-keyed normalized-email hash, filters lifecycle/environment/deletion/supersession/retention metadata, and selects by `created_date`, `created_at_server`, then stable ID descending. Update/save/client timestamps do not affect ordering, and newer submitted records beat older active records. The endpoint issues a safe exact-draft token and the selected token is accepted by load; mailbox ownership is intentionally not verified. | [Email recovery and draft-choice flow](../backend/email-recovery-and-draft-choice-flow.md); [recovery selection contract](../architecture/recovery-code-and-draft-selection-contract.md) | Email recovery, identity, repository, authorization, projection, and client suites | Source implemented/tested; UI/live deployment and environment proof pending |
| `DR-REC-002` | Version-1 secure generation, keyed recovery-code hashing, recovery-session signing, and rejection boundaries are certified in staging. No code storage, public verification endpoint, rate limit, or recovery UI exists. | [Primitive certification](../security/staging-security-primitives-certification.md) | Focused unit suites plus authenticated live self-check | Primitive certified; recovery workflow pending |
| `DR-SEC-001` | Purpose/environment/tamper primitives are staging-certified. Public code/email recovery and email-only list-associated hash/scope boundaries are implemented and locally tested, including selected-token load handoff. Live entity scoping, distributed rate controls, monitoring, and the 10k corpus remain absent. | [Primitive certification](../security/staging-security-primitives-certification.md); [email recovery flow](../backend/email-recovery-and-draft-choice-flow.md); [DRAFT-014](../audit/current-defect-register.md#draft-014--draft-data-crosses-a-direct-browser-entity-boundary) | Focused authorization, recovery, security, repository, projection, and client suites | Source integrated; environment and corpus certification pending |
| `DR-MODAL-001` | No opening recovery-choice gate exists. | [Audit report, current architecture](../audit/current-system-audit-report.md#current-architecture) | — | Planned |
| `DR-PANEL-001` | Future recovery panel is absent; feature-branch autosave wording now truthfully distinguishes durable browser and page-only state, while explicit server-confirmed UX remains future work. | [Browser storage resilience](../architecture/browser-storage-resilience.md); [DRAFT-013](../audit/current-defect-register.md#draft-013--autosave-wording-inaccurately-claims-secure-cookie-persistence) | `src/test/autoSaveIndicatorSafety.test.jsx` | Partially implemented |
| `DR-MUT-001` | V2 now captures named response/validation/touched/expanded/text/UI changes post-reducer; synchronous interactions coalesce, Q5/conditional/reset are atomic, and incomplete editors restore from scoped `uiDraftState`. Clear All/final submission remain explicitly deferred. | [complete mutation capture contract](../frontend/complete-mutation-capture-contract.md); [component audit](../audit/component-local-state-audit.md); [mutation matrix](../audit/draft-mutation-matrix.md) | 25/25 new focused tests; 20/20 five-project synthetic browser matrix | Implemented/tested locally; live Base44 staging round trips pending |
| `DR-MUT-002` | Upload-capable editors persist the compatible completed URL plus the required safe metadata and never dispatch raw `File`/`Blob`/`FileList`; interrupted uploads require reselection and display close-browser guidance. | [complete mutation capture contract](../frontend/complete-mutation-capture-contract.md); [DRAFT-018](../audit/current-defect-register.md#draft-018--rawin-flight-file-selection-cannot-be-restored) | raw-object rejection plus five-project metadata/reload matrix | Implemented/tested locally; real staging upload interruption pending |
| `DR-CLEAR-001` | Existing baseline is noncompliant; old draft/session remain active and discoverable. | [DRAFT-010](../audit/current-defect-register.md#draft-010--clear-all-races-browser-persistence-and-leaves-the-old-server-draft-active) | `BC-CLEAR-001`, `002` | Planned |
| `DR-CLEAR-002` | No replacement transaction or stale-save rejection exists. | [DRAFT-010](../audit/current-defect-register.md#draft-010--clear-all-races-browser-persistence-and-leaves-the-old-server-draft-active), [DRAFT-016](../audit/current-defect-register.md#draft-016--delayed-draft-writes-can-regress-submitted-state) | `BC-CLEAR-001` | Planned |
| `DR-SUBMIT-001` | Existing submission has retries/fallback, but immutable atomic attempt/finalization and remote fallback equivalence are uncertified. | [Audit report, submission and PDF](../audit/current-system-audit-report.md#submission-and-pdf-behavior) | — | Planned |
| `DR-PDF-001` | Existing PDF is browser-memory-only after submission and cannot regenerate after reload. | [Audit report, submission and PDF](../audit/current-system-audit-report.md#submission-and-pdf-behavior) | — | Planned |
| `DR-ADMIN-001` | The persistent signed-grant primitive and staging diagnostic's Base44-admin gate are certified; the existing password grant is unchanged and migration/rate/fleet revocation work remains future. | [Primitive certification](../security/staging-security-primitives-certification.md) | Live admin authorization and admin-grant sign/verify | Primitive certified; workflow planned |
| `DR-ADMIN-002` | Existing baseline is noncompliant; browser directly lists/updates draft data. | [DRAFT-014](../audit/current-defect-register.md#draft-014--draft-data-crosses-a-direct-browser-entity-boundary) | — | Planned |
| `DR-RLS-001` | Repository draft schemas declare no RLS; actual cloud enforcement is unverified. | [DRAFT-014](../audit/current-defect-register.md#draft-014--draft-data-crosses-a-direct-browser-entity-boundary) | — | Planned |
| `DR-BROWSER-001` | The production-denied quality workflow runs Chromium fixture mechanics automatically; a manual staging workflow defines desktop/mobile and optional real-Edge matrices. Historical local evidence includes 70/70 active browser-local cache executions across five projects. The 2026-08-06 canonical-state attempt stopped at the failing normal suite, so no deployed browser, storage, isolation, migration, reset, console, or network matrix ran. Server/concurrency/offline/security scenarios also remain pending. | [Blocked canonical-state staging attempt](../testing/staging-canonical-state-redux-certification.md); [earlier blocked browser-storage attempt](../testing/staging-browser-storage-certification.md); [quality workflow](../../../.github/workflows/durable-draft-quality.yml); [manual staging E2E workflow](../../../.github/workflows/durable-draft-staging-e2e.yml); [E2E harness](../testing/e2e-test-harness.md); [browser fixture guide](../testing/browser-failure-fixtures.md) | `[HARNESS]` mechanics; `E2E-SMOKE-SHELL-001`; local active `DR-BOOT-001`/`002`; local active `DR-LOCAL-001`–`004`; local active `DR-LOCAL-002`; pending server-linked V2 specs | Partially implemented; staging certification blocked before deploy |
| `DR-CONCUR-001` | Three-way field merge, same-field choices, terminal server authority, hashed tab coordination, storage fallback, and server-CAS safety are implemented. | [Conflict merge and multi-tab contract](../frontend/conflict-merge-and-multi-tab-contract.md); [DRAFT-015](../audit/current-defect-register.md#draft-015--draft-upsert-and-mutation-ordering-are-non-atomic) | 59 focused tests; 18/18 desktop Chromium/Firefox/WebKit scenarios | Implemented — staging certification pending |
| `DR-OFFLINE-001` | Offline/reconnect and lifecycle fixture mechanics pass, with two requirement-linked pending specs. No offline/online outbox or reconciliation implementation exists. | [Browser fixture guide](../testing/browser-failure-fixtures.md); [DRAFT-006](../audit/current-defect-register.md#draft-006--lifecycle-persistence-relies-only-on-beforeunload) | `BC-LIFE-001`; 2 pending `DR-OFFLINE-001` E2E scenarios | Planned |
| `DR-OBS-001` | Existing analytics/logging does not provide the required acknowledged-revision and recovery telemetry evidence. | [Audit report](../audit/current-system-audit-report.md) | — | Planned |
| `DR-REL-001` | Non-deploying quality and manual staging-E2E workflow sources exist. Candidate `9ca8e64` passed 18/18 focused schema tests but failed 5 of 780 normal tests, correctly stopping before staging checkout update, guard, deployment, and feature-branch push. GitHub branch protection remains administrator-unverified; staging/green certification and disabled deployment have not occurred. | [Blocked entity-schema staging attempt](../data/staging-entity-schema-certification.md); [GitHub Actions controls](../testing/github-actions-and-branch-protection.md); [staging readiness checklist](../environments/staging-deployment-readiness-checklist.md); [implementation dependency map](../audit/implementation-dependency-map.md) | `npm run test:entity-schemas` pass; `npm test` fail; later release checks not run under hard-stop rule | Blocked before staging deployment |

### 2026-08-05 authoritative API certification attempt

The detached frontend client contract and its focused tests are implemented,
but [live staging certification](../backend/staging-authoritative-draft-api-certification.md)
is **AUTHORITATIVE_DRAFT_APIS_BLOCKED**. The ordered source gate stopped after
the normal suite passed 1,155/1,160 tests. Consequently `DR-SAVE-001`,
`DR-REV-001`, `DR-SUBTERM-001`, `DR-CONCUR-001`, and `DR-REL-001` receive no new
environment evidence or certified status. No schema, function, flag, secret,
data, or frontend deployment operation occurred.

### 2026-08-05 public recovery abuse-control foundation

The feature branch now contains an admin-only recovery security-event schema,
purpose-separated abuse HMAC contract, bounded IP/subject/global policy,
conditional CAPTCHA escalation, temporary lockout, generic public failure
envelope, server-only CAPTCHA abstraction, and a resilient 128-bit random
device-ID helper. Focused source tests cover the schema/RLS/raw-field boundary,
hash separation, thresholds, delays, lockout, trusted-header parsing, event
allowlisting, CAPTCHA modes/timeout/bindings, diagnostics, and storage fallback.

This is implementation evidence for the abuse-control portions of `DR-REC-001`,
`DR-REC-002`, `DR-SEC-001`, and `DR-SEC-002`; none advances to environment
certification. No public recovery endpoint, secret configuration, schema push,
function deployment, release flag, production access, or browser recovery UI
exists. See [public recovery abuse-control contract](../security/public-recovery-abuse-control-contract.md).

### 2026-08-05 recovery-code service source implementation

The local `recoverProFormDraftByCode` source now enforces exact request keys,
32 KB POST/JSON parsing, default-off runtime gates, abuse HMACs, event-backed
IP/subject/global limits, conditional CAPTCHA, temporary lockout, keyed exact
code lookup, canonical duplicate selection, lifecycle/retention rules, minimal
projection, safe auditing, and exact-draft recovery-session issuance. Active
sessions receive read/write/event scopes; submitted sessions receive
submitted-read/read only. The detached client wrapper does not persist the code
or token and no UI imports it.

This adds local implementation evidence for `DR-REC-001`, `DR-REC-002`,
`DR-SEC-001`, and `DR-SEC-002`, including token handoff accepted by the existing
load function. It is not environment certification: no function/schema was
deployed or pushed, no secret or flag changed, and public recovery remains off.
See [recovery-code service flow](../backend/recovery-code-service-flow.md).

### 2026-08-06 email recovery and draft-choice source implementation

`recoverProFormDraftByEmail` now normalizes an exact email without verifying
ownership, evaluates the existing abuse policy before lookup, queries by keyed
email lookup hash, and chooses eligible records by server `created_date` rather
than update/save time. Active-like and submitted sessions are exact-draft and
environment bound; only email sessions receive hash-bound
`draft:list-associated`. The authorized list returns at most 25 safe choices,
and selection rechecks hash/lifecycle before issuing a new exact-draft token.

Focused source tests cover ordering/status/environment/retention exclusions,
tie-breaks, rate/CAPTCHA/lockout/timing/audit behavior, claims and scopes, raw-
email exclusions, choice authorization/projection, client methods, and selected
token acceptance by `loadProFormDraft`. This advances local implementation
evidence for `DR-ID-001`, `DR-ID-004`, `DR-ID-005`, `DR-REC-001`,
`DR-SEC-001`, and `DR-SEC-002`; it is not environment certification. See
[email recovery and draft-choice flow](../backend/email-recovery-and-draft-choice-flow.md).

No schema/function was pushed or deployed, no email/SES call occurred, no UI
was added, and no staging or production resource was accessed.

## Coverage summary

### 2026-08-05 entity-extension staging evidence

The [staging entity schema certification](../data/staging-entity-schema-certification.md) is **ENTITY_EXTENSIONS_BLOCKED**. Local schema validation and focused fixtures passed 18/18 on `9ca8e6478facd6d5cfa1e2f51986ba12fc1a26d1`, but the full normal suite failed 5 of 780 tests. Under the release hard-stop rule, no staging checkout update, target guard, inventory, entity push, deleted-entity observation, type generation, CRUD, FLS, current-flow browser smoke, cleanup, or feature-branch push ran.

This adds local schema-contract evidence only. It does not satisfy `DR-RLS-001`, `DR-BROWSER-001`, or `DR-REL-001`, and it does not certify legacy/extended behavior in Base44 staging.

- Stable requirement IDs: `48`.
- Release-blocking requirements: `48`.
- Acceptance categories represented: `20` of `20`.
- Architecture sources represented: ADR-001, ADR-002, and ADR-003.
- Current lifecycle status: `DR-BOOT-001`, `DR-BOOT-002`, `DR-LOCAL-002`, the client-contract portions of `DR-ID-001`–`005`, the code/email recovery service portions of `DR-REC-001`/`002`, and the local scope/hash portions of `DR-SEC-001` have feature-branch implementation. The browser-local portion of `DR-LOCAL-001` is implemented/tested while its server/recovery portion remains partial. `DR-MUT-001`, `DR-PANEL-001`, and `DR-BROWSER-001` remain partial. No new requirement is staging-, production-disabled-, or production-enabled-certified by this source-only change.
- Current audit overlay: 33 requirements have explicit current-baseline or feature-contract evidence; the remaining requirements are still governed by their planned evidence rows and are not implied compliant.

## Evidence-boundary statement

The linked modules, tests, workflows, and harness files are source controls, not environment or release certification. Public code/email recovery source now exists, but it was not deployed or enabled and no UI was added. This attempt performed only the required identity authentication check; it performed no staging or production Base44 mutation, deployment, application creation, data read/write, email delivery, SES call, production test, domain movement, or release enablement.

### 2026-08-06 public recovery staging certification attempt

The [public recovery services report](../security/staging-public-recovery-services-certification.md)
is **PUBLIC_RECOVERY_SERVICES_BLOCKED**. Focused recovery suites passed 214/214
and entity-schema suites passed 22/22, but the ordered normal suite failed 5 of
1,260 tests. The hard stop prevented the staging checkout update, target guard,
abuse secret and policy configuration, security-entity push, four function
deployments, synthetic data, live recovery/choice/abuse/RLS matrices, cleanup,
and deployed frontend regression.

This attempt adds no staging evidence to `DR-ID-001`, `DR-ID-004`,
`DR-ID-005`, `DR-REC-001`, `DR-REC-002`, `DR-SEC-001`, `DR-SEC-002`, or
`DR-REL-001`. Their source evidence remains unchanged; no requirement advances
to environment certification. Production and `main` were untouched, and the
feature branch was not pushed.

### 2026-08-06 SES transport and template source implementation

The [Amazon SES contract](../email/amazon-ses-transport-and-template-contract.md)
and focused tests implement the local portions of `DR-EMAIL-001` and
`DR-EMAIL-002`: fixed approved sender, default-off modes, strict staging
recipient rewrite and subject prefix, production/upstream authorization,
official SES v2 adapter, 2–30 second bounded timeout, safe internal result,
header/HTML injection controls, accessible recovery templates, no code in URL,
no answers/tracking/images, safe diagnostics, and frontend credential
separation. The four added optional `ProFormDraft` fields support hashed
idempotency and allowlisted backend diagnostics only.

This is source evidence, not environment evidence. At that checkpoint the
source had no caller/function, schema push, credentials, or live send. The next
source increment below adds the authorized coordinator but not environment
evidence. `DR-EMAIL-001`, `DR-EMAIL-002`, `DR-CLEAR-002`, `DR-OBS-001`, and
`DR-REL-001` do not advance to staging certification.

### 2026-08-06 authorized recovery-code email delivery source

The [delivery flow](../email/recovery-code-email-delivery-flow.md), function,
repository compare-and-set, client helper, and focused tests add local evidence
for the orchestration portions of `DR-EMAIL-002`, `DR-CLEAR-002`, and
`DR-OBS-001`: exact authorization, recovery-code HMAC match, purpose/lifecycle
binding, stored recipient only, purpose-keyed replay suppression, bounded
failure retry, draft-wide attempt cap, metadata/event allowlists, uncertain-
delivery response, no canonical revision change, strict public projection, and
no general send control or browser persistence.

This remains source-only. Entity fields are not pushed, the function is not
deployed, Clear All/Start New controllers are not connected, SES is not
configured/called, and live CAS/FLS/routing evidence is absent. No requirement
advances to staging certification.

### 2026-08-06 disabled OTP and magic-link framework source

The [future verification framework](../email/future-otp-and-magic-link-framework.md)
adds local structural evidence for `DR-ID-004`, `DR-REC-001`, `DR-SEC-001`,
`DR-SEC-002`, and `DR-RLS-001`: an admin-only attempt entity, same-email-lookup
identity, separate purpose secrets, secure generation, HMAC-only persistence,
expiry/lock/one-time consumption, open-redirect denial, verified method/status
recovery-session claims, disabled-before-side-effect functions, and a client
placeholder with both flags false and no storage/UI/routes.

This does not certify a workflow or environment. The entity is not pushed,
secrets are not configured, functions are not deployed, public validation and
abuse controls are not connected, no email or URL exists, and neither flag is
enabled. Initial unverified email recovery is unchanged. No requirement
advances to staging, production-disabled, or production-enabled acceptance.

### 2026-08-06 staging SES certification attempt

The [staging SES recovery-email report](../email/staging-ses-recovery-email-certification.md)
is **SES_RECOVERY_EMAIL_BLOCKED**. The transport, template, recovery delivery,
future-disabled, entity, and security/authorization focused gates passed
242/242 tests, but the ordered normal suite failed 5 of 1,354 tests. The hard
stop prevented AWS/SES inventory, redirect verification, target guarding,
secret configuration, schema/function deployment, synthetic delivery, inbox
verification, live idempotency/failure checks, record scans, and cleanup.

This attempt adds failure evidence only. It does not advance `DR-EMAIL-001`,
`DR-EMAIL-002`, `DR-RLS-001`, `DR-OBS-001`, `DR-SEC-001`, `DR-SEC-002`, or
`DR-REL-001`. No environment or release requirement is newly certified.

### 2026-08-06 Clear All and Start New transaction source

The [transaction contract](../backend/clear-all-and-start-new-transaction-contract.md), seven protected entity fields, replacement/email services, two backend functions, repository compare-and-set additions, and 33 focused tests add local source evidence for `DR-CLEAR-001`, `DR-CLEAR-002`, `DR-ID-003`, `DR-EMAIL-002`, `DR-OBS-001`, and the stale-write portion of `DR-SAVE-001`. Clear All retains and supersedes only active/submit-failed sources; Start New performs no submitted-record write; partial transactions are retry-addressable and email-ineligible; one-time credentials are hashed-only at rest; and email failure does not roll back commit.

This is source-only evidence. No entity schema or function was pushed, no Base44 app/data was mutated, no email was sent, no deployment occurred, and no UI was added. Live Base44 CAS, FLS, SES routing, and staging recovery remain uncertified; no requirement advances to staging or production acceptance.
## 2026-08-06 authoritative submission and read-only PDF source evidence

`DR-SUBTERM-001` and `DR-PDF-001` now have local implementation evidence in the [authoritative submission contract](../frontend/authoritative-submission-and-read-only-pdf-contract.md), coordinator, submitted sync lock, read-only view, and hash-verified PDF service. The focused suite adds 28 cases and the synthetic browser matrix adds 17 cases across five projects. Live staging/API/PDF evidence remains release-blocking; no deployment occurred.

## 2026-08-06 full lifecycle staging certification attempt

The [full lifecycle report](../testing/staging-full-draft-lifecycle-certification.md)
is **FULL_DRAFT_LIFECYCLE_BLOCKED**. Replacement, client, coordinator,
read-only/PDF, sync, recovery, and entity focused gates passed, but the existing
submission/intake/repair gate failed 2 of 124 tests. The prompt's hard stop
prevented every staging mutation and live certification step.

No requirement advances to staging certification. In particular,
`DR-CLEAR-001`, `DR-CLEAR-002`, `DR-SUBTERM-001`, `DR-PDF-001`,
`DR-EMAIL-002`, `DR-SAVE-001`, `DR-BROWSER-001`, and `DR-REL-001` remain
release-blocking. Production and `main` were untouched, and the feature branch
was not pushed.

## 2026-08-06 password-only admin recovery staging attempt

The [admin recovery report](../admin/staging-password-only-admin-recovery-certification.md)
is **PASSWORD_ONLY_ADMIN_RECOVERY_FAILED**. The focused authorization, backend
API, UI, retry/repair, and route suite passed 75/75, and the static admin entity
boundary passed across eight frontend files. The full normal suite then failed
6 of 1,798 tests, activating the explicit pre-deployment hard stop.

No admin-recovery requirement advances to staging acceptance. Password/grant
persistence, revocation, live backend-only networking, security events, RLS,
retry/repair, and cleanup remain uncertified. No staging or production resource
was mutated, and no branch was pushed.

## 2026-08-06 restrictive draft RLS staging attempt

The [staging RLS report](../security/staging-draft-rls-certification.md) is
**DRAFT_RLS_BLOCKED**. `npm ci` succeeded, but `npm run precheck:rls` failed on
the three missing staging certifications and the production-linked primary
checkout. The mandatory hard stop occurred before every staging target,
schema, attack, backend, browser, regression, record, cleanup, and Git-push
operation.

No requirement advances to staging certification. `DR-RLS-001`, public/admin
recovery, lifecycle, browser, submission/PDF, email, and release-readiness
requirements remain blocked. Production and `main` were untouched.

## 2026-08-06 legacy migration analysis source evidence

The [version 1 analysis contract](../migration/legacy-draft-analysis-and-upgrade-contract.md),
pure shared module, fixture corpus, and offline CLI add local evidence for
`DR-MIG-001`, `DR-ID-001`, and `DR-OBS-001`: independent JSON parsing,
canonical reconstruction, unverified approved email association, no-code
handling, before/after fingerprints, deterministic duplicate/event planning,
safe diagnostics, and strict manual-review gates.

This is dry-run source evidence only. No exported real dataset, Base44 record,
lookup secret, execution function, checkpoint, retention policy, staging run,
or production migration exists. No requirement advances to staging acceptance.

## 2026-08-06 resumable legacy migration execution source evidence

The [execution/checkpoint contract](../migration/legacy-migration-execution-and-checkpoint-contract.md),
admin-only checkpoint entity, bounded repository, separate two-hour apply
authorization, and four local function entry points add source evidence for
`DR-MIG-001`, `DR-ID-001`, and `DR-OBS-001`. Focused tests cover dry-run-first
sequencing, 50/200 pagination, cursor/fingerprint drift, checkpoint resume,
idempotency, explicit duplicate lineage, submitted guards, redacted audits,
and limited no-delete rollback.

This is local evidence only. The apply secret is deliberately unconfigured;
no Base44 operation occurred and no real data or cloud resource was accessed
or changed. Live staging RLS, dry-run review, interruption replay, count
reconciliation, retention, and reverse migration remain open. No requirement
advances to staging acceptance.

## 2026-08-06 one-year retention source evidence

`DR-RET-001` now has a local policy module, exact-status bounded analyzer,
report-bound two-hour apply token, event-first per-record deletion service,
shared migration checkpoint, safe audit vocabulary, and disabled monthly
dry-run schedule template. Synthetic tests exercise 27+ required boundaries.
The separate apply secret is unconfigured and no Base44 operation or deletion
occurred. Live filter/RLS behavior, backup/restore proof, alert delivery,
reviewed staging dry run, and all production approval remain pending, so this
is source evidence only and not staging or release acceptance.

## 2026-08-06 legacy migration and retention staging hard stop

The [combined certification report](../migration/staging-legacy-migration-and-retention-certification.md)
is **LEGACY_MIGRATION_AND_RETENTION_FAILED**. Focused migration, duplicate,
retention, checkpoint, admin, and RLS gates passed, but the full normal suite
failed 3 of 1,975 tests. The required stop occurred before every Base44,
staging checkout, secret, schema, function, fixture, apply, rollback,
retention, security-probe, cleanup, and push action.

`DR-MIG-001`, `DR-MIG-002`, `DR-MIG-003`, `DR-RET-001`, `DR-RLS-001`, and
`DR-OBS-001` receive no staging acceptance. Resume/idempotency and test-only
deletion were not observed live.

## 2026-08-06 bidirectional migration identity source foundation

`DR-MIG-001`, `DR-MIG-002`, `DR-MIG-003`, `DR-ID-001`, and `DR-OBS-001` now
have a strict nine-entity forward/reverse policy, first-origin versus immediate-
source identity, logical created/updated time, deterministic ID-map/conflict
schemas, policy-driven SHA-256 projection, relationship-normalized comparison,
and logical email-recovery selection. The validator fails on a new unclassified
entity, unsafe staging/test policy, missing relationship/sensitive/file path,
meaningful-answer hash exclusion, or schema/selection drift.

This is local source evidence only. No app, record, bundle, deployment, schema
push, production read, or live bidirectional execution exists, so no staging or
production acceptance advances.

## 2026-08-06 cross-app export/import utility source evidence

`DR-MIG-001`, `DR-MIG-002`, `DR-MIG-003`, `DR-ID-001`, `DR-RLS-001`, and
`DR-OBS-001` now have local signed-bundle, bounded export, identity-only
idempotent import, ID-map, safe conflict, relationship-finalization, checkpoint,
status and in-memory CLI implementations. Synthetic tests cover signature and
tamper rejection, exact routes/environments, count/hash/chain validation,
create/update/unchanged/conflict, mapping replay, relationship closure, dry
run/apply confirmation, secret-argument rejection, redaction and content-free
reports/resume state.

This remains source evidence only. No variable is configured, no function or
schema is deployed, no record is read or migrated, and no `_next` app exists.
Live Base44 authorization, RLS, real batch limits, interruption, file transfer,
forward/reverse reconciliation and cutover verification remain mandatory.

## 2026-08-06 incremental, reverse, and integrity source evidence

`DR-MIG-001`, `DR-MIG-002`, `DR-MIG-003`, `DR-ID-001`, and `DR-OBS-001` now
have local source and synthetic-test evidence for direction leases, per-entity
server-time high-water checkpoints, overlap/deduplication, two-pass freeze
closure, reverse original/native identities, independent-write conflicts,
late-write polling, file-reference blockers, safe report sanitization, and all
18 integrity dimensions. Only `PASS` is represented as cutover-ready.

No requirement advances to staging or production acceptance. No cloud app,
record, file, secret, function, schema, domain, deployment, migration apply, or
remote branch was accessed or changed.

## 2026-08-06 bidirectional migration staging certification hard stop

The [staging migration utility report](../migration/staging-migration-utility-certification.md)
is **MIGRATION_UTILITY_FAILED**. Migration policy, bundle, export/import,
delta/reverse/file-audit/integrity, and entity-schema gates passed 110 focused
tests, but `npm test` failed 3 of 2,091 tests. The required hard stop prevented
the 1,000-record local exercise and every staging checkout update, guard,
secret, schema, function, record, live export, cleanup, and production action.

`DR-MIG-001`, `DR-MIG-002`, `DR-MIG-003`, `DR-ID-001`, `DR-RLS-001`, and
`DR-OBS-001` receive no staging acceptance. No live cross-app import occurred,
and `_next` still does not exist.

## 2026-08-06 release testing control-plane evidence

`DR-TEST-001` now has a machine-readable ten-phase permission/evidence model,
deterministic staging-only fixture factory, stable-ID coverage validator,
safe Vitest/Playwright/domain-result normalization, no-deploy orchestrator,
checksummed evidence builder, and exact-test-run cleanup coordinator. Focused
tests cover missing/skipped/stale evidence, browsers, security hard stops,
resume, redaction, checksums, cleanup boundaries, and forbidden commands.

This is local source evidence only. Final staging functional, security,
capacity, and release-candidate runs remain pending. Production modes are
disabled and no deployment or production operation occurred.

| Requirement ID | Requirement description | ADR source | Planned implementation batch | Planned source files/modules | Unit test ID | Integration test ID | Browser test ID | Staging evidence | Production-disabled evidence | Production-enabled evidence | Release blocking | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `DR-TEST-001` | Require phase-aware executable release evidence, safe deterministic fixtures, blocking cleanup, and reproducible sanitized bundles. | [Production acceptance criteria](./production-acceptance-criteria.md) | `B06`, `B08` | `config/durable-draft-release-phases.json`; `scripts/run-durable-draft-release-tests.mjs`; `scripts/validate-release-test-coverage.mjs`; `tests/factories/proDraftSyntheticDataFactory.js` | `UT-TEST-001` | `IT-TEST-001` | `BT-TEST-001` | `EV-STG-TEST-001` final functional/security/capacity/RC evidence | Not applicable until a later authorized production-disabled batch | Not applicable until a later authorized enablement batch | Yes | Implemented and locally tested; staging certification pending |
