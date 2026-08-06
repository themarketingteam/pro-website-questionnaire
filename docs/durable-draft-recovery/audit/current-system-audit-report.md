# Current Draft System Audit Report

## 2026-08-06 backend administration addendum

Source now provides five backend-only recovery administration functions plus a shared persistent-grant request boundary and bounded service. Retry and AI repair use the same environment/version/device-bound grant and no longer trust Base44 admin login, frontend role flags, or the legacy password-derived grant. Approved projections omit credential/idempotency hashes; edit keys are allowlisted, revision-checked, idempotent, submitted-lock aware, and audited. The current admin UI intentionally remains unmigrated, so its direct entity calls are a next-prompt release gap. No deployment, schema push, production access, or external delivery occurred.

- Audit date: 2026-08-05
- Immutable production baseline: `27ddc347d55db00796a0e3e19ac343245519b01e`
- Audit evidence revision: `2a1c5cd51bdf5593d45ef95a5b7c46f19631367b`
- Branch: `feature/durable-draft-recovery`
- Classification: **AUDIT_COMPLETE_WITH_REPRODUCTION_GAPS**
- Risk verdict: **CURRENT_DRAFT_RECOVERY_NOT_PRODUCTION_RELIABLE**

> This is a current-state audit, not a production certification. No runtime fix, Base44 deployment, production-data access, email/integration change, or domain operation was performed.

## Executive summary

The current questionnaire has useful browser persistence and best-effort server draft writes, but it does not provide durable, isolated, server-backed recovery. Five fields are persisted under one origin-wide Redux key, one origin-wide session key is reused, server drafts are never hydrated into the public questionnaire, local backups have no restore reader, and several mutation paths do not reach the server draft at all. Client-side draft upsert and status changes have no repository-defined uniqueness, revision, idempotency, transaction, or terminal-status guard.

The audit registers **19 defects: 6 Critical, 10 High, and 3 Medium**. Static evidence and 27 opt-in characterization tests confirm most observations. The classification retains reproduction gaps because native-browser lifecycle behavior, cloud RLS/FLS, deployed function equivalence, write concurrency/order, cross-tab behavior, and production retention/data state were not exercised.

The risks are systemic for the planned volume of hundreds of questionnaire sessions:

1. Every session that needs recovery on another browser/device or after browser-state loss is exposed to the missing server-hydration path.
2. Every session using required Question 5 geography mutations is exposed to its server-save/event bypass until another qualifying mutation happens.
3. The conditional-cleanup characterization reproduced cancellation of the queued server snapshot. Broader impact on ordinary state-driven saves requires native/runtime testing, but the scheduling pattern is shared enough to be release-blocking.
4. Shared browser keys can display or write a prior client's state when the same browser origin is reused.

## Scope and method

The audit covered the public questionnaire, browser bootstrap/storage, Redux persistence, draft/event entities, mutation ordering, lifecycle behavior, submission and intake fallback, PDF generation, admin recovery, Base44 resource declarations, and current repository validation state.

Evidence was obtained by:

- static inspection of all relevant source, schema, function, agent, test, build, route, and environment-configuration files;
- repository-wide searches for storage, lifecycle, entity, function, persistence, and mutation call sites;
- reconciliation with the immutable [source baseline manifest](../baseline/source-baseline-manifest.md) and [source baseline validation](../baseline/source-baseline-validation.md);
- the [current architecture inventory](./current-system-architecture-inventory.md), [Base44 resource inventory](./base44-resource-inventory.md), [mutation matrix](./draft-mutation-matrix.md), [component-local state audit](./component-local-state-audit.md), and [field contract](./questionnaire-field-contract.md);
- 27 isolated jsdom characterization tests recorded in the [baseline characterization manifest](./baseline-characterization-test-manifest.md).

No live production entity, production record, secret, integration, email route, or custom domain was read or changed. A prior read-only Base44 resource inventory is evidence of name visibility only; it does not certify remote source equivalence or runtime health.

## Current architecture

The application is a Vite/React SPA using Redux Toolkit, `redux-persist`, and the Base44 client SDK. Questionnaire answers are canonical in the Redux form slice. Five slice fields are stored in `localStorage` under `persist:pro-questionnaire-root`; credentials are omitted. The questionnaire session identifier is stored separately under `pro_questionnaire_session_id`, also in `localStorage` despite the session-oriented name.

Most answer handlers use `updateResponse`, which dispatches Redux, schedules a 600 ms server draft save, schedules an event, and then updates validation/touched state. Question 5 dispatches directly and bypasses both server paths. Reset Question and Clear All also lack an acknowledged server mutation. The public route never reads a server draft into Redux.

Server draft persistence is a browser-side filter/sort/create-or-update operation against `ProFormDraft`. Events are direct browser creates against `ProFormDraftEvent`. Admin recovery also directly lists/updates draft data in the browser after UI gates. Repository schemas do not declare RLS for the draft entities, so the actual cloud authorization boundary is not certifiable from source.

Submission first attempts a direct `ProFormSubmission.create` and can invoke `submitProQuestionnaireFallback`. The local fallback resource is present under a nested entry path, but it was absent from the earlier read-only remote function listing. A successful UI submission retains a React-memory snapshot for the thank-you modal and PDF, resets Redux, and does not navigate to a durable receipt route.

PDF creation is browser-only through `html2canvas` and `jsPDF`. There is no backend PDF store or email path. Reloading after submission loses the in-memory submitted snapshot required to regenerate the PDF.

## Current save behavior

For most answers, the intended sequence is Redux dispatch, debounced draft snapshot, draft event, validation/touched updates, then asynchronous Redux persistence. The snapshot receives the new response value but can capture validation, touched, and expanded maps from an earlier render. Validation-only and UI-only changes do not independently schedule a snapshot.

`createSaveDraftSnapshot` finds by `session_id`, sorts in the browser, then updates the newest record or creates a record. There is no repository-defined unique key, transaction, compare-and-swap revision, idempotency key, or terminal status guard. Concurrent first saves can create duplicates, and a delayed draft write can theoretically regress a terminal status.

The characterization suite additionally proved that a state-driven effect cleanup cancels the conditional-cleanup save timer: local child state is cleared and an event is written, but the server snapshot is not. This exact conditional scenario is confirmed; the breadth of the timer-cancellation behavior remains a runtime reproduction gap.

## Restore and browser-storage behavior

Reload restores only the one persisted Redux record and reuses the one session ID. It never queries and hydrates `ProFormDraft`. Local failure/before-unload backups are written under `pro_questionnaire_local_backup_<session>` but have no production reader, TTL, or cleanup. Only `beforeunload` is registered among the audited lifecycle/connectivity events; it performs a synchronous local write and no server/event call.

The fixed Redux and session keys are not client-scoped. A characterized Client B URL rehydrated Client A's response and reused Client A's session ID. Credentials are not persisted, so URL credentials can change while responses/session remain from the previous client.

`src/lib/app-params.js` obtains the `localStorage` object during module evaluation outside a guard. Characterization tests show that storage getter, read, or write exceptions can reject import before React mounts.

## Submission and PDF behavior

The submit helper snapshots responses, makes a best-effort draft transition, transforms/repairs the payload, retries direct final creation, and can use the fallback intake path. Draft/event failures are often nonfatal. A fallback success on an early transform/validation branch can report receipt while leaving the draft in an attempted/failed state. The current UI's save wording is therefore not proof of a server acknowledgement.

After success, answers survive only in mounted React state for the thank-you PDF. Redux is reset asynchronously; `textValidationMeta` is not fully reset. A reload cannot look up an immutable submission receipt or regenerate the PDF.

## Admin recovery summary

The `/admin/draft-recovery` route verifies a password or stored HMAC grant through a backend function, then directly lists and updates drafts in the browser. Retry/repair actions use server functions that reauthorize an admin or grant. The related intake/admin routes use Base44 admin checks or a source allowlist. There is no public self-service route that restores a selected draft into Redux.

## Base44 security summary

Seven production frontend call sites directly access draft/event entities. The public questionnaire filters/creates/updates drafts and creates events. Direct access is confirmed; exploitability or unrestricted cloud access is **not** claimed because platform/out-of-repository policy was not available for certification.

Before release, public and admin data operations require backend-mediated authorization, minimized payloads, rate controls, auditable mutation semantics, and cloud RLS/FLS verification. The absence of repository-declared draft RLS is a release evidence gap, not proof that Base44 currently grants unrestricted access.

## Characterization results

The dedicated baseline command passed **5 files and 27 tests** with zero fetch or XMLHttpRequest openings. It reproduced unsafe storage initialization, global keys, absent server/backup hydration, Question 5 bypasses, reset/clear gaps, stale session recovery, conditional save cancellation, component-local state loss, and before-unload-only lifecycle behavior.

These tests intentionally assert existing defects. They are excluded from the normal Vitest configuration and must later be inverted or replaced by acceptance tests. They do not mutate production or call a network service.

## Defect summary

| Severity | Count | Defect IDs |
| --- | ---: | --- |
| Critical | 6 | DRAFT-004, DRAFT-010, DRAFT-014, DRAFT-016, DRAFT-017, DRAFT-019 |
| High | 10 | DRAFT-001, DRAFT-002, DRAFT-003, DRAFT-005, DRAFT-006, DRAFT-007, DRAFT-008, DRAFT-009, DRAFT-012, DRAFT-015 |
| Medium | 3 | DRAFT-011, DRAFT-013, DRAFT-018 |

The authoritative per-defect evidence, confidence, workaround, requirement mapping, and implementation batch are in the [current defect register](./current-defect-register.md).

## Unconfirmed and partially confirmed risks

| Risk/evidence gap | Current conclusion | Evidence required |
| --- | --- | --- |
| Cloud RLS/FLS behavior | Direct browser calls and absent repo declarations are confirmed; actual cloud authorization is unknown. | Authorized staging policy inspection and adversarial authorization tests. |
| In-flight status regression | Source permits a delayed unconditional write; exact race not reproduced. | Deterministic delayed-write integration test with terminal transition guard assertions. |
| Duplicate first-save records | Non-atomic filter/create is confirmed; occurrence is not reproduced. | Concurrent staging writes plus uniqueness/idempotency assertions. |
| General timer-cancellation breadth | Conditional path reproduced; general ordinary-save impact not yet bounded. | Native-browser/runtime instrumentation across ordinary and conditional mutations. |
| Raw file continuity | Interrupted selections cannot survive JSON/remount; completed URL descriptors are serializable. | Browser upload interruption/retry acceptance tests using safe metadata only. |
| Remote fallback function | Earlier listing did not expose the local function name; health/source equivalence unknown. | Authorized staging deploy/invoke and remote manifest comparison. |
| Lifecycle and cross-tab behavior | jsdom proves registered handlers, not native delivery or tab arbitration. | Playwright/browser matrix for reload, close, pagehide, visibility, offline, and multi-tab conflict. |
| Production data, retention, analytics privacy | Not inspected by design. | Separately authorized, sanitized operational review before production enablement. |

## Existing baseline failures versus future requirements

Existing repository validation debt is not relabeled as a durable-recovery regression. At the audited revision:

- clean dependency installation passes with 29 existing advisories;
- the production build passes;
- the normal suite remains at 22/24 files and 195/198 tests, with the same four recorded baseline failure signatures;
- lint remains at 54 findings (34 errors, 20 warnings);
- typecheck remains at 264 diagnostics;
- the opt-in characterization suite passes 5/5 files and 27/27 tests.

Future requirements remain **Planned** in the [requirements traceability matrix](../release/requirements-traceability-matrix.md). A current defect can be confirmed while its replacement requirement remains unimplemented; the audit does not advance requirement status or certify acceptance.

## Production-readiness verdict

**CURRENT_DRAFT_RECOVERY_NOT_PRODUCTION_RELIABLE.** The current system does not meet the accepted durable-recovery, client-isolation, backend-authorization, atomic-mutation, terminal-submission, or reload-safe PDF expectations. Release remains blocked until the dependency-ordered implementation is complete and representative staging/browser/security/concurrency evidence passes.

The audit itself is **AUDIT_COMPLETE_WITH_REPRODUCTION_GAPS** because the repository behavior and known defects are sufficiently inventoried to plan implementation, while the explicitly listed cloud/native-browser/concurrency questions remain to be reproduced in a safe staging environment.

## No-fix declaration

This audit records current behavior only. It makes no runtime code, schema, entity, function, agent, secret, integration, production-data, email, PDF endpoint, deployment, or domain change.
