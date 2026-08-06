# Current Draft System Defect Register

- Audit date: 2026-08-05
- Classification: **AUDIT_COMPLETE_WITH_REPRODUCTION_GAPS**
- Risk verdict: **CURRENT_DRAFT_RECOVERY_NOT_PRODUCTION_RELIABLE**
- Counts: **6 Critical / 10 High / 3 Medium / 19 total**

This register distinguishes observed current behavior from future acceptance requirements. A mapped requirement remains `Planned` until its implementation and acceptance evidence pass. “Release blocking” applies to the durable draft recovery release, not to the historical baseline tag.

Feature-branch remediation notes preserve the audited production-baseline finding while recording later source changes. They do not certify staging or production and do not change the historical severity counts above.

The earlier 2026-08-06 browser-storage attempt reconfirmed local browser evidence but stopped before deployment on aggregate lint, typecheck, and normal-suite failures; its evidence remains in the [blocked browser-storage certification](../testing/staging-browser-storage-certification.md).

The latest canonical-state attempt targeted commit `58f6927577944d686d83eaf19da2a04ffcde87a5`. Its canonical state, cache, local-persistence, bootstrap, and store suites passed within `npm run test:ci`, but the aggregate result was 606 passed and 5 failed of 611 tests. The hard-stop rule prevented every later check, staging checkout update, deploy, and browser matrix. See the [blocked canonical-state certification](../testing/staging-canonical-state-redux-certification.md). No defect below is environment-certified by either attempt.

## Severity summary

| Severity | Count | Meaning in this audit |
| --- | ---: | --- |
| Critical | 6 | Can defeat recovery, isolation, authorization assurance, or terminal data integrity at release scale. |
| High | 10 | Materially weakens recoverability, completeness, boot reliability, or atomic persistence. |
| Medium | 3 | Misleads the user or loses narrower metadata/in-progress state without independently defeating all recovery. |

## DRAFT-001 — Unsafe module-evaluation storage access

- **Mapped requirement:** `DR-BOOT-001`, `DR-BOOT-002`
- **Severity:** High
- **Confidence:** Confirmed
- **Affected browsers:** Any browser/webview where the `localStorage` getter, read, or write throws; privacy and quota modes are representative triggers.
- **Trigger:** Import the app-parameter/Base44 bootstrap path when storage access is restricted or throws.
- **Audited production-baseline behavior:** Module import rejects before React or the questionnaire error boundary mounts.
- **Required future behavior:** Guard all storage acquisition and operations; render within the accepted startup bound using an explicit degraded-persistence state.
- **User/business impact:** A client can be unable to open the questionnaire at all.
- **Files/functions:** `src/lib/app-params.js` module initialization; Base44 client bootstrap.
- **Reproduction/evidence:** `BC-BOOT-002` through `BC-BOOT-004`; [architecture inventory, browser persistence](./current-system-architecture-inventory.md#browser-persistence-inventory).
- **Current workaround:** Use a browser context that permits local storage; this is not a product-grade guarantee.
- **Permanent implementation batch:** B01 — safe boot and client-scoped browser namespace.
- **Feature-branch remediation (2026-08-05):** `app-params.js` now guards window/location, URL parsing, storage acquisition/read/write, document access, and URL replacement. Base44 client creation returns value-free diagnostics on failure; authentication bootstrap is bounded to four seconds; non-destructive initialization/render error UI is present. Unit tests and the active seven-mode/five-project Playwright boot matrix provide source/local evidence.
- **Remediation evidence:** `src/test/appParamsSafety.test.js`; `src/test/base44ClientInitialization.test.js`; `src/test/authContextSafety.test.jsx`; `src/test/appInitializationError.test.jsx`; `src/test/errorBoundarySafety.test.jsx`; `tests/e2e/draft-v2/storage-recovery.spec.js`.
- **Remediation status:** Implemented on `feature/durable-draft-recovery`; the five-project local boot matrix was reconfirmed, but staging certification is blocked before deployment by the root release gate. Production-disabled and production-enabled certification remain pending. Draft-store integration and durable server recovery are outside this remediation.
- **Release blocking:** Yes

## DRAFT-002 — One global Redux persistence key

- **Mapped requirement:** `DR-LOCAL-002`
- **Severity:** High
- **Confidence:** Confirmed
- **Affected browsers:** All supported browsers when more than one client uses the same origin/browser profile.
- **Trigger:** Open a second client's questionnaire after the first client has persisted answers.
- **Current behavior:** Both clients use `persist:pro-questionnaire-root`; client identity is absent from the namespace.
- **Required future behavior:** Derive a non-secret, collision-resistant client/session namespace and reject or quarantine mismatched state.
- **User/business impact:** A prior client's answers can appear in another client's session and become the basis of later writes.
- **Files/functions:** `src/components/store/store.jsx`; Redux persist configuration.
- **Reproduction/evidence:** `BC-LOCAL-001`, `BC-LOCAL-003`, `BC-LOCAL-004`.
- **Current workaround:** Clear site storage or use a fresh browser profile between clients; this is operationally fragile.
- **Permanent implementation batch:** B01 — safe boot and client-scoped browser namespace.
- **Feature-branch remediation (2026-08-05):** `createQuestionnaireStore` now persists approved form fields under `pro-questionnaire:v4:ns_<hash>:redux-state`. `ReduxProvider` derives identity first, caches one runtime per namespace, and resets only the active namespace. Version 3 rehydration normalizes the complete form and discards malformed or hidden-child data safely.
- **Remediation evidence:** `src/test/questionnaireStore.test.jsx`; `src/test/questionnaireBrowserNamespace.test.js`; `tests/e2e/draft-v2/client-isolation.spec.js`; `BC-LOCAL-001`, `BC-LOCAL-003`, and `BC-LOCAL-004` now assert the remediated contract.
- **Remediation status:** Local browser isolation is implemented on `feature/durable-draft-recovery`; the five-project persistence/fallback/memory matrix was reconfirmed 15/15, but staging certification is blocked before deployment. No server hydration or authorization is implied.
- **Release blocking:** Yes

## DRAFT-003 — One global questionnaire session key

- **Mapped requirement:** `DR-LOCAL-002`
- **Severity:** High
- **Confidence:** Confirmed
- **Affected browsers:** All supported browsers when a browser profile is reused.
- **Trigger:** Start another client's questionnaire while `pro_questionnaire_session_id` already exists.
- **Current behavior:** The existing ID is reused without client namespace, generation, or TTL.
- **Required future behavior:** Bind an opaque session identity to the authorized client/recovery context and rotate it under the clear/supersession contract.
- **User/business impact:** Writes and recovery lookup can attach the wrong client's answers to the prior session.
- **Files/functions:** `src/lib/sessionId.js`; `src/pages/ProQuestionnaire.jsx`.
- **Reproduction/evidence:** `BC-LOCAL-002`, `BC-CLEAR-001`, `BC-CLEAR-002`.
- **Current workaround:** Manually clear site storage before changing clients; no application workflow enforces this.
- **Permanent implementation batch:** B01 — safe boot and client-scoped browser namespace.
- **Feature-branch remediation (2026-08-05):** Session creation, read, and clear now require the derived namespace and use the version 4 `legacy-session` purpose. Persistent denial retains one namespace-specific in-memory session for the current page. The global key is available only through an explicit authorized legacy helper and is never automatically migrated or deleted.
- **Remediation evidence:** `src/test/questionnaireSessionId.test.js`; `src/test/legacyQuestionnaireStorage.test.js`; `BC-LOCAL-002`.
- **Remediation status:** Local session scoping is implemented on `feature/durable-draft-recovery`; refreshed local isolation evidence passed, while authorized server identity/recovery and environment certification remain blocked/pending.
- **Release blocking:** Yes

## DRAFT-004 — Server drafts are never restored into the public form

- **Mapped requirement:** `DR-REC-001`, `DR-REC-002`
- **Severity:** Critical
- **Confidence:** Confirmed
- **Affected browsers:** All supported browsers and devices.
- **Trigger:** Reload after local storage loss/corruption, change browsers/devices, or need a server-backed recovery.
- **Current behavior:** The questionnaire never queries/hydrates `ProFormDraft`; Redux/browser state always wins by default.
- **Required future behavior:** Use an authorized backend recovery API to select, validate, reconcile, and hydrate the newest eligible draft with an explicit user choice where required.
- **User/business impact:** A server-acknowledged draft is unusable for public self-service recovery. This is systemic across every session needing recovery outside its original browser state.
- **Files/functions:** `src/pages/ProQuestionnaire.jsx` initialization; `src/lib/draftPersistence.js` is write-target lookup only.
- **Reproduction/evidence:** `BC-REC-001` through `BC-REC-003`; zero `ProFormDraft.filter` calls during load.
- **Current workaround:** Admin/manual recovery or retaining the exact browser storage; neither is durable self-service recovery.
- **Permanent implementation batch:** B03 — authorized public recovery and reconciliation.
- **Release blocking:** Yes

## DRAFT-005 — Local backups are write-only

- **Mapped requirement:** `DR-LOCAL-001`, `DR-REC-001`
- **Severity:** High
- **Confidence:** Confirmed
- **Affected browsers:** All supported browsers.
- **Trigger:** Autosave/submit failure or `beforeunload` writes `pro_questionnaire_local_backup_<session>`, followed by reload/recovery.
- **Current behavior:** Backups have no production reader, restore policy, TTL, cleanup, or client-scoped key.
- **Required future behavior:** Maintain a versioned, scoped local journal that is validated, consumed deterministically, reconciled with the server, and expired safely.
- **User/business impact:** The UI can imply a backup exists while the client has no way to restore it.
- **Files/functions:** `src/pages/ProQuestionnaire.jsx` lifecycle backup; `src/lib/draftPersistence.js` failure backup.
- **Reproduction/evidence:** `BC-LOCAL-005`, `BC-REC-003`, `BC-LIFE-001`.
- **Current workaround:** Extract storage manually during support intervention; not suitable for clients or production scale.
- **Permanent implementation batch:** B01/B03 — local journal plus authorized reconciliation.
- **Feature-branch remediation (2026-08-05):** Failure backups now use the exact version 4 client namespace and resilient storage, contain only approved serializable form state plus safe metadata, and have an exact-namespace safe reader. The reader is a foundation API only: page bootstrap does not automatically hydrate a backup or server draft.
- **Remediation evidence:** `src/test/draftFailureBackup.test.js`; `BC-LOCAL-005`; `BC-LIFE-001`.
- **Canonical-cache remediation (2026-08-05):** A separate versioned canonical browser cache now continuously stores the complete post-reducer form and is automatically considered after Redux Persist rehydration. This supplies same-browser reload continuity without treating the older failure-backup record as authoritative or deleting it.
- **Canonical-cache evidence:** `src/test/questionnaireCanonicalDraftCache.test.js`; `src/test/localCanonicalDraftPersistence.test.js`; `src/test/questionnaireLocalBootstrap.test.js`; active `DR-LOCAL-001`, `DR-LOCAL-003`, and `DR-LOCAL-004` Playwright scenarios.
- **Remediation status:** Same-browser canonical reload is implemented and its focused suite passed locally in the latest aggregate run. The aggregate gate still failed, so deployed rehydration/migration testing did not run. Failure-backup reconciliation/expiry, authorized server recovery, cross-device restore, and environment certification remain pending. See the [blocked canonical-state certification](../testing/staging-canonical-state-redux-certification.md).
- **Release blocking:** Yes

## DRAFT-006 — Lifecycle persistence relies only on beforeunload

- **Mapped requirement:** `DR-OFFLINE-001`, `DR-LOCAL-001`
- **Severity:** High
- **Confidence:** Confirmed for registered lifecycle behavior; native delivery remains a reproduction gap.
- **Affected browsers:** All, especially mobile browsers and abrupt termination paths where `beforeunload` is unreliable.
- **Trigger:** Background, navigate, close, crash, lose connectivity, or terminate with a pending edit/save.
- **Current behavior:** Only `beforeunload` is registered; it writes a local snapshot and performs no server/event flush. No `pagehide`, `visibilitychange`, `online`, or `offline` handling exists.
- **Required future behavior:** Continuously journal safe state, maintain a durable outbox, reconcile on reconnect, and treat unload handlers only as bounded supplements.
- **User/business impact:** Recent edits and pending acknowledgement state can be lost without an actionable recovery signal.
- **Files/functions:** `src/pages/ProQuestionnaire.jsx` lifecycle effect.
- **Reproduction/evidence:** `BC-LIFE-001`; `M066`, `M068`, `M070` in the [mutation matrix](./draft-mutation-matrix.md).
- **Current workaround:** Pause after edits and avoid closing/offline transitions; not enforceable.
- **Permanent implementation batch:** B01/B02/B06 — journal, mutation outbox, browser acceptance.
- **Feature-branch remediation (2026-08-05):** The canonical browser cache subscribes to complete Redux state after reducers and writes continuously with a 100 ms debounce/500 ms maximum wait. It does not rely on `beforeunload`; unload remains only a best-effort legacy failure-backup supplement.
- **Remediation status:** Ordinary browser-local edits are continuously cached and the focused local-persistence suite passed within the latest aggregate run. The aggregate gate blocked deployed storage-mode and lifecycle testing. Explicit pagehide/visibility flush, server outbox/reconnect reconciliation, abrupt-process-loss certification, and environment certification remain pending. See the [blocked canonical-state certification](../testing/staging-canonical-state-redux-certification.md).
- **Release blocking:** Yes

## DRAFT-007 — Server snapshots can mix response and stale UI maps

- **Mapped requirement:** `DR-SAVE-001`
- **Severity:** High
- **Confidence:** Confirmed by source ordering
- **Affected browsers:** All supported browsers.
- **Trigger:** Any normal answer mutation that also changes validation, touched, expanded, or conditional state.
- **Current behavior:** The queued response includes the new answer while other maps can come from the earlier render; validation-only changes do not schedule their own snapshot.
- **Required future behavior:** Produce one canonical post-reducer revision and persist all approved fields atomically from that revision.
- **User/business impact:** Restored status/UI can disagree with restored answers and hidden content can remain server-side.
- **Files/functions:** `src/pages/ProQuestionnaire.jsx:updateResponse`; `src/lib/draftPersistence.js:createSaveDraftSnapshot`.
- **Reproduction/evidence:** Static mutation ordering; `M001`–`M017`; `BC-COND-001` demonstrates a related failed cleanup snapshot.
- **Current workaround:** Make another qualifying answer change and wait; this does not guarantee coherent ordering.
- **Permanent implementation batch:** B02 — canonical mutation and revisioned snapshot pipeline.
- **Release blocking:** Yes

## DRAFT-008 — Question 5 geography bypasses server persistence

- **Mapped requirement:** `DR-MUT-001`, `DR-LOCAL-001`
- **Severity:** High
- **Confidence:** Confirmed
- **Affected browsers:** All supported browsers.
- **Trigger:** Add, update, remove, or select the primary Question 5 location.
- **Current behavior:** Redux/browser state changes, but no draft save or draft event occurs.
- **Required future behavior:** Route the complete locations/primary repair through one acknowledged canonical mutation and event.
- **User/business impact:** Required geography answers can disappear from server recovery for every affected session until an unrelated save happens.
- **Files/functions:** `src/pages/ProQuestionnaire.jsx` Q5 callbacks; `src/components/pro-form/MultiGeographicQuestion.jsx`.
- **Reproduction/evidence:** `BC-Q5-001` through `BC-Q5-004`; zero draft/event calls.
- **Current workaround:** Change an unrelated question and wait for autosave; this is neither visible nor reliable.
- **Permanent implementation batch:** B02/B06 — centralized mutation plus acceptance coverage.
- **Release blocking:** Yes

## DRAFT-009 — Reset Question bypasses server persistence

- **Mapped requirement:** `DR-MUT-001`
- **Severity:** High
- **Confidence:** Confirmed
- **Affected browsers:** All supported browsers.
- **Trigger:** Reset an answered question.
- **Current behavior:** Redux/browser slices clear but no server snapshot, deletion event, or acknowledgement occurs.
- **Required future behavior:** Persist the answer deletion, auxiliary-key deletion, validation/touched cleanup, and tombstone/event as one revision.
- **User/business impact:** A later recovery can resurrect an answer the client explicitly removed.
- **Files/functions:** `src/pages/ProQuestionnaire.jsx:resetQuestion`; `src/components/store/formSlice.jsx:deleteResponse`.
- **Reproduction/evidence:** `BC-RESET-001`; `M018` in the mutation matrix.
- **Current workaround:** Make another qualifying answer change and wait; server ordering remains unguarded.
- **Permanent implementation batch:** B02/B06 — centralized mutation plus acceptance coverage.
- **Release blocking:** Yes

## DRAFT-010 — Clear All races browser persistence and leaves the old server draft active

- **Mapped requirement:** `DR-CLEAR-001`, `DR-CLEAR-002`
- **Severity:** Critical
- **Confidence:** Confirmed
- **Affected browsers:** All supported browsers.
- **Trigger:** Confirm Clear All with persisted/local/server state present.
- **Current behavior:** Redux resets and reload is queued while storage can still contain old answers; no empty server snapshot/event is acknowledged and the same session ID rediscovers the old draft.
- **Required future behavior:** Atomically supersede the prior generation, acknowledge an empty replacement/new identity, flush safe browser state, then reload.
- **User/business impact:** Explicitly cleared data can reappear locally or through recovery, violating user intent and retention expectations.
- **Files/functions:** `src/pages/ProQuestionnaire.jsx` Clear All flow; `src/lib/sessionId.js`; `src/lib/draftPersistence.js` lookup.
- **Reproduction/evidence:** `BC-CLEAR-001`, `BC-CLEAR-002`; `M019`, `M073`–`M075`.
- **Current workaround:** Manually clear all browser storage and have support supersede server data; no safe user workflow exists.
- **Permanent implementation batch:** B04/B05 — generation supersession and server-enforced clear semantics.
- **Release blocking:** Yes

## DRAFT-011 — textValidationMeta is absent from the server draft contract

- **Mapped requirement:** `DR-SAVE-001`
- **Severity:** Medium
- **Confidence:** Confirmed
- **Affected browsers:** All supported browsers using validated text questions.
- **Trigger:** Validate/edit textarea content and then rely on server recovery.
- **Current behavior:** `textValidationMeta` is browser-persisted but absent from `ProFormDraft` schema/snapshot and is not fully cleared by `resetForm`.
- **Required future behavior:** Include the approved validation/editor metadata in the versioned UI draft state and bind it to the answer revision/hash.
- **User/business impact:** Recovered validation state can be stale or cause unnecessary revalidation; residual metadata can outlive a reset.
- **Files/functions:** `src/components/store/formSlice.jsx`; `src/lib/draftPersistence.js:createSaveDraftSnapshot`; `base44/entities/ProFormDraft.json`.
- **Reproduction/evidence:** Static field-contract comparison; `M003`–`M005`, `M015`–`M017`.
- **Current workaround:** Re-enter/revalidate text after recovery.
- **Permanent implementation batch:** B02 — canonical state and snapshot schema.
- **Release blocking:** Yes

## DRAFT-012 — Answer-bearing component editor state is not recoverable

- **Mapped requirement:** `DR-SAVE-001`, `DR-MUT-001`
- **Severity:** High
- **Confidence:** Confirmed for characterized editors
- **Affected browsers:** All supported browsers.
- **Trigger:** Reload/remount before locking/adding/saving numeric, manual geography, image-person, or confirmation-modal edits.
- **Current behavior:** The in-progress value exists only in component state/refs/DOM and resets on remount.
- **Required future behavior:** Persist approved JSON-safe `uiDraftState`, or expose an explicit durable commit boundary with truthful loss semantics.
- **User/business impact:** Meaningful client-authored work disappears even though autosave messaging may be visible.
- **Files/functions:** numeric range, `MultiGeographicQuestion`, image tagging, and `ConfirmModal` components catalogued in the [component-local state audit](./component-local-state-audit.md).
- **Reproduction/evidence:** `BC-UI-001` through `BC-UI-004`.
- **Current workaround:** Complete each component's local commit action before leaving; modal edits have no pre-submit durable commit.
- **Permanent implementation batch:** B02/B06 — UI draft contract plus browser acceptance.
- **Release blocking:** Yes

## DRAFT-013 — Autosave wording inaccurately claims secure-cookie persistence

- **Mapped requirement:** `DR-LOCAL-001`, `DR-PANEL-001`
- **Severity:** Medium
- **Confidence:** Confirmed
- **Affected browsers:** All supported browsers.
- **Trigger:** View the autosave indicator/help wording.
- **Current behavior:** The UI says work is saved in a secure cookie, while persistence uses local storage and best-effort direct Base44 writes; no cookie participates.
- **Required future behavior:** Display acknowledgement and recovery wording derived from actual local/server state, including degraded/offline conditions.
- **User/business impact:** Clients can make decisions based on a false durability/security assurance.
- **Files/functions:** `src/components/pro-form/AutoSaveIndicator.jsx`.
- **Reproduction/evidence:** Source text plus storage/entity flow in the architecture inventory.
- **Current workaround:** Support documentation can explain the limitation, but the product message remains misleading.
- **Permanent implementation batch:** B01/B02/B03 — truthful state model and recovery UI.
- **Feature-branch remediation (2026-08-05):** The indicator now reports browser-save progress, durable browser state, or page-only memory state and exposes an `aria-live` status. Server-confirmed wording is allowed only from an explicit server-confirmation input.
- **Remediation evidence:** `src/test/autoSaveIndicatorSafety.test.jsx`; source search finds no secure-cookie claim in production code.
- **Remediation status:** Local wording is implemented on `feature/durable-draft-recovery`; canonical server acknowledgement and recovery-panel UX remain pending.
- **Release blocking:** Yes

## DRAFT-014 — Draft data crosses a direct browser entity boundary

- **Mapped requirement:** `DR-ADMIN-002`, `DR-RLS-001`, `DR-SEC-001`
- **Severity:** Critical
- **Confidence:** Partial: seven direct calls are confirmed; actual cloud RLS/exploitability requires runtime evidence.
- **Affected browsers:** All public and admin browser clients.
- **Trigger:** Public draft/event persistence or admin draft list/update.
- **Current behavior:** Browser code directly filters/creates/updates/lists draft entities. Repository schemas do not declare draft RLS.
- **Required future behavior:** Backend-mediated, authorized, rate-controlled, minimized public/admin APIs plus verified cloud RLS/FLS and audit logs.
- **User/business impact:** The repository cannot certify client isolation or least-privilege data access; a policy misconfiguration could expose sensitive draft payloads.
- **Files/functions:** Seven call sites in [Direct draft-entity access audit](./current-system-architecture-inventory.md#direct-draft-entity-access-audit).
- **Reproduction/evidence:** Static call-site/schema audit. No claim of successful unauthorized access is made.
- **Current workaround:** Verify platform policy out of band and restrict admin access; direct public boundary remains.
- **Permanent implementation batch:** B03/B05/B06 — backend APIs, RLS/FLS, adversarial staging certification.
- **Release blocking:** Yes

## DRAFT-015 — Draft upsert and mutation ordering are non-atomic

- **Mapped requirement:** `DR-REV-001`, `DR-CONCUR-001`
- **Severity:** High
- **Confidence:** Confirmed for missing controls; duplicate occurrence requires runtime reproduction.
- **Affected browsers:** All; heightened with multiple tabs, retries, latency, and concurrent first saves.
- **Trigger:** Concurrent filter/create, overlapping updates, or out-of-order request completion.
- **Current behavior:** Client filter/sort then create/update has no unique constraint, revision, idempotency key, compare-and-swap, or transaction declared in the repository.
- **Required future behavior:** One backend atomic save API with stable identity, revision/CAS, idempotency, server time, and deterministic conflict results.
- **User/business impact:** Duplicate drafts, lost updates, and older snapshots overwriting newer work are possible.
- **Files/functions:** `src/lib/draftPersistence.js:createFindExistingDraftBySessionId`, `createSaveDraftSnapshot`.
- **Reproduction/evidence:** Static control absence; concurrency/browser runtime test remains required.
- **Current workaround:** Avoid multiple tabs and wait between edits; network ordering is still uncontrollable.
- **Permanent implementation batch:** B02/B06 — atomic persistence plus concurrency certification.
- **Release blocking:** Yes

## DRAFT-016 — Delayed draft writes can regress submitted state

- **Mapped requirement:** `DR-SUBTERM-001`
- **Severity:** Critical
- **Confidence:** Partial: source permits the race; exact timing has not been reproduced.
- **Affected browsers:** All under sufficient network delay or an in-flight save at submission.
- **Trigger:** A previously dispatched `status: draft` update completes after the submitted transition.
- **Current behavior:** Pending timers are cancelled, but in-flight requests cannot be cancelled and the server update has no terminal-status/revision guard.
- **Required future behavior:** Enforce monotonic terminal transitions in one backend transaction; reject stale revisions after submission/intake receipt.
- **User/business impact:** A completed questionnaire could appear recoverable/active or have a newer terminal snapshot obscured.
- **Files/functions:** `src/lib/draftPersistence.js:createSaveDraftSnapshot`; `src/lib/proQuestionnaireSubmit.js`; submit callback in `src/pages/ProQuestionnaire.jsx`.
- **Reproduction/evidence:** Source ordering and missing guard; deterministic delayed-write staging test required.
- **Current workaround:** None reliable at the client; manual status repair is reactive.
- **Permanent implementation batch:** B02/B04 — revision guard and terminal submission lock.
- **Release blocking:** Yes

## DRAFT-017 — Shared browser state can leak across clients

- **Mapped requirement:** `DR-LOCAL-002`, `DR-SEC-001`
- **Severity:** Critical
- **Confidence:** Confirmed
- **Affected browsers:** Any shared/reused browser profile on the questionnaire origin.
- **Trigger:** Persist Client A responses/session, then open a Client B URL in the same profile.
- **Current behavior:** Client A's response and session rehydrate; Client B's URL can replace only nonpersisted credentials.
- **Required future behavior:** Enforce client-scoped local/server identity and fail closed or offer a safe, explicit recovery/switch decision on mismatch.
- **User/business impact:** Cross-client display and misattributed writes can expose questionnaire content and corrupt records.
- **Files/functions:** Redux persist configuration, `src/lib/sessionId.js`, URL credential initialization in `src/pages/ProQuestionnaire.jsx`.
- **Reproduction/evidence:** `BC-LOCAL-001` through `BC-LOCAL-004`.
- **Current workaround:** Fresh browser profile/site-data purge for every client; not acceptable at scale.
- **Permanent implementation batch:** B01/B03/B05/B06 — identity namespace, server authorization, security certification.
- **Feature-branch remediation (2026-08-05):** Redux state, session IDs, and failure backups are partitioned by a deterministic version 4 namespace whose keys contain no raw identity components. The active normal/IndexedDB-unavailable browser scenarios prove Client A → Client B → Client A isolation; memory-only mode makes no reload-survival claim.
- **Remediation evidence:** `src/test/questionnaireBrowserNamespace.test.js`; `src/test/questionnaireStore.test.jsx`; `src/test/questionnaireSessionId.test.js`; required Chromium, Firefox, and WebKit desktop client-isolation matrix passes 9/9 executions.
- **Remediation status:** The confirmed local shared-browser leak is remediated on `feature/durable-draft-recovery`, with the five-project persistence/fallback/memory matrix reconfirmed 15/15. Staging certification stopped before deployment; server-side authorization, cross-device recovery, `DR-SEC-001`, and all environment certification remain pending. The namespace hash is not an authorization boundary.
- **Release blocking:** Yes

## DRAFT-018 — Raw/in-flight file selection cannot be restored

- **Mapped requirement:** `DR-MUT-002`
- **Severity:** Medium
- **Confidence:** Partial: technical loss is established; completed URL descriptors are a narrower safe exception.
- **Affected browsers:** All supported browsers.
- **Trigger:** Select or upload a file, then reload/remount before a durable descriptor is committed.
- **Current behavior:** `File`, `FileList`, DOM handles, progress, and some upload error state are transient; JSON cannot restore the bytes or browser handle.
- **Required future behavior:** Never serialize raw browser objects; persist allowlisted upload metadata/status with stable IDs and provide resumable/reselect behavior.
- **User/business impact:** The client must reselect files and can lose upload context or see stale progress metadata.
- **Files/functions:** image, certification, guarantee, and generic upload components; [component-local state audit serialization contract](./component-local-state-audit.md#non-serializable-object-contract).
- **Reproduction/evidence:** Static state/serialization audit; browser interruption acceptance test remains required.
- **Current workaround:** Wait for upload success and verify the committed URL descriptor before leaving.
- **Permanent implementation batch:** B01/B02 — safe upload metadata and mutation model.
- **Release blocking:** Yes

## DRAFT-019 — State-driven effect cleanup can cancel the queued server save

- **Mapped requirement:** `DR-LOCAL-001`, `DR-SAVE-001`
- **Severity:** Critical
- **Confidence:** Partial: the conditional cleanup path is reproduced; general breadth requires native/runtime instrumentation.
- **Affected browsers:** All supported browsers using the same React scheduling pattern.
- **Trigger:** Change a conditional parent from `yes` to `no`, causing dependent state changes and effect cleanup before the 600 ms save fires.
- **Current behavior:** All child Redux/browser slices clear and an event is emitted, but cleanup cancels the draft timer; the prior server child value survives.
- **Required future behavior:** Decouple acknowledged mutation/outbox lifetime from render-effect cleanup and persist the complete post-reducer revision exactly once.
- **User/business impact:** Hidden/deleted client content can remain in the recoverable server record; if the pattern affects ordinary saves, session-scale loss exposure is broader.
- **Files/functions:** draft scheduling/cleanup effects in `src/pages/ProQuestionnaire.jsx`; conditional child cleanup in form reducers/validation.
- **Reproduction/evidence:** `BC-COND-001` (zero draft calls, one event call); limitation documented in the characterization manifest.
- **Current workaround:** Make an unrelated qualifying edit after cleanup and wait; no acknowledgement proves the correct snapshot won.
- **Permanent implementation batch:** B02 — render-independent durable mutation outbox and revisioned save.
- **Feature-branch remediation (2026-08-05):** A store-level post-reducer canonical subscriber now captures the complete local state independently of component effect cleanup, including conditional-child deletion across response, validation, touched, expanded, text, UI-draft, metadata, and question-pointer categories.
- **Remediation evidence:** `src/test/localCanonicalDraftPersistence.test.js`; whole-form/hidden-child cases in `src/test/questionnaireStore.test.jsx`.
- **Remediation status:** The browser-local loss mode is mitigated and the focused store/local-persistence suites passed within the latest aggregate run. The release gate failed before deployed mutation, reset, or current Base44 save-compatibility testing. The existing Base44 server timer remains render-coupled and non-atomic, so server acknowledgement, revision/CAS, and reconciliation are still release-blocking. See the [blocked canonical-state certification](../testing/staging-canonical-state-redux-certification.md).
- **Release blocking:** Yes

## Register controls

Every defect above has an evidence source, stable requirement mapping, implementation batch, and explicit confidence level. Partial confidence never means the risk is dismissed: it means the confirmed source behavior blocks release while the stated runtime/cloud test is still required to bound or prove impact.
