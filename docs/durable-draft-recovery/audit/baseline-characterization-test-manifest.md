# Baseline Characterization Test Manifest

Status: current-defect evidence captured on 2026-08-05 from `feature/durable-draft-recovery`.

> **Temporary harness:** these tests intentionally assert the current draft-persistence behavior. Later implementation work must invert or replace the defect assertions with desired-behavior acceptance tests, then remove this opt-in harness. The normal test configuration explicitly excludes `*.baseline-characterization.test.*`.

## Harness and isolation

- Dedicated command: `npm run test:baseline-characterization`.
- Dedicated config: `src/vitest.baseline-characterization.config.js`.
- Naming/location: `src/test/baseline-characterization/**/*.baseline-characterization.test.{js,jsx}`.
- Production isolation: the shared Base44 client is mocked; the shared setup fails any test that attempts unmocked `fetch` or `XMLHttpRequest`; all fixtures use synthetic clients, sessions, records, domains, locations, and people.
- Prohibited side effects: no deployment, production entity access, real submission, email, upload, or PDF generation occurs.
- Stable requirement mapping: the requested topic labels such as `DR-ISOLATION-*`, `DR-MUT-Q5-*`, `DR-RESET-*`, `DR-COND-*`, `DR-UISTATE-*`, and `DR-LIFECYCLE-*` are not IDs in the checked-in traceability matrix. The tests therefore use the closest applicable stable IDs that do exist: `DR-LOCAL-*`, `DR-MUT-001`, `DR-SAVE-001`, and `DR-OFFLINE-001`.

## Existing test-infrastructure inventory

- Runner: Vitest 1.6.1 with jsdom and `@vitejs/plugin-react`; normal config is `src/vitest.config.js`.
- React tests: React Testing Library and `@testing-library/jest-dom`, initialized by `src/test/setupTests.js`.
- Browser mocks: in-memory `localStorage`/`sessionStorage`, `matchMedia`, and a selector compatibility shim are centralized in `setupTests.js`; reusable storage-fault helpers live in `src/test/utils/storage.js`, while scenario-specific Google Places and lifecycle mocks remain local.
- Base44 mocks: `ProFormSubmission`, `ProFormDraft`, `ProFormDraftEvent`, `ProFormSubmissionIntake`, functions, uploads, and auth are centralized in `setupTests.js`.
- Redux helper: `src/test/utils/renderWithStore.jsx`; the mutation suite also exercises the configured persistent singleton store.
- Existing regressions: `src/test/proQuestionnaire.regression.test.jsx`, optional-child, textarea-validation, submission-resilience, recovery, PDF, payload, and helper suites remain unchanged.
- Playwright: the later-added harness now owns `tests/e2e/**/*.spec.js`; it is isolated from this historical Vitest characterization suite and does not turn known-defect observations into acceptance evidence.
- Package scripts: the root package is authoritative. `npm test`/`npm run test:ci` run the normal suite, and `npm run test:manifest` enforces collection boundaries.
- CI: no checked-in `.github` workflow is present, so no release workflow was changed to depend on these characterizations.

## Characterization cases

Every row below passed in the dedicated 27-test run. “Pass” means the current observation was reproduced, not that the future requirement is satisfied.

| Test ID | Requirement ID | File | Scenario | Current expected observation | Desired future behavior | After implementation | Current pass/fail | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `BC-BOOT-001` | `DR-BOOT-001` | `storage-initialization.baseline-characterization.test.js` | Import app-parameter/Base44 path with normal storage. | Import succeeds and initializes one client. | Continue to initialize safely. | Replace | Pass | Mocked `createClient` called once. |
| `BC-BOOT-002` | `DR-BOOT-001`, `DR-BOOT-002` | same | `localStorage` property getter throws `SecurityError`. | Historical baseline import rejected with `SecurityError`; feature branch now imports safely. | Bootstrap/render succeeds through guarded storage access within the time bound. | Inverted | Pass | Post-remediation import resolved; client created once. |
| `BC-BOOT-003` | `DR-BOOT-001`, `DR-BOOT-002` | same | `localStorage.getItem` throws. | Historical baseline import rejected; feature branch now imports safely. | Bootstrap/render succeeds with a safe fallback. | Inverted | Pass | Post-remediation import resolved; client created once. |
| `BC-BOOT-004` | `DR-BOOT-001`, `DR-BOOT-002` | same | `localStorage.setItem` throws `QuotaExceededError`. | Historical baseline import rejected; feature branch now imports safely. | Bootstrap/render succeeds while reporting degraded persistence. | Inverted | Pass | Post-remediation import resolved; client created once. |
| `BC-BOOT-005` | `DR-BOOT-001` | same | `sessionStorage` getter is unavailable. | Import succeeds because this bootstrap path never reads it. | Continue to render safely and explicitly tolerate unavailable session storage. | Replace | Pass | Import resolved; client created. |
| `BC-BOOT-006` | `DR-BOOT-001` | same | `indexedDB` getter is unavailable. | Import succeeds because this bootstrap path never reads it. | Continue to render safely and explicitly tolerate unavailable IndexedDB. | Replace | Pass | Import resolved; client created. |
| `BC-LOCAL-001` | `DR-LOCAL-002` | `storage-isolation.baseline-characterization.test.js` | Compare Redux persistence keys for synthetic Client A and B URLs. | Both use global `persist:pro-questionnaire-root`; identity is absent. | Use a non-secret client-scoped namespace. | Invert | Pass | One fixed key observed under both URLs. |
| `BC-LOCAL-002` | `DR-LOCAL-002` | same | Compare questionnaire session key/ID for Client A and B. | Both use `pro_questionnaire_session_id` and reuse the same ID. | Scope identity safely so clients cannot share a draft session. | Invert | Pass | Client B receives Client A’s synthetic session ID. |
| `BC-LOCAL-003` | `DR-LOCAL-001`, `DR-LOCAL-002` | same | Persist responses and credentials. | Responses persist; the configured transform omits credentials. | Persist the approved canonical identity subset in an isolated, non-secret representation. | Replace | Pass | Persisted root contains responses and no credentials field. |
| `BC-LOCAL-004` | `DR-LOCAL-002` | same | Rehydrate Client A browser state under Client B URL. | Client A response hydrates for Client B. | Reject/quarantine cross-client local state. | Invert | Pass | Rehydrated response equals Client A’s fixture. |
| `BC-REC-001` | `DR-REC-001`, `DR-SAVE-001` | `server-recovery-and-backup.baseline-characterization.test.jsx` | Provide a matching mocked `ProFormDraft` during load. | Questionnaire never queries or hydrates the server draft. | Select and hydrate the authorized newest eligible draft. | Invert | Pass | `ProFormDraft.filter` has zero calls; server answer absent. |
| `BC-REC-002` | `DR-REC-001`, `DR-LOCAL-001` | same | Load with conflicting Redux and mocked server answers. | UI renders only the Redux answer. | Reconcile local/server state under the approved recovery contract. | Replace | Pass | Redux value visible; server filter untouched. |
| `BC-LOCAL-005` | `DR-LOCAL-001`, `DR-LOCAL-002` | same | Write a failed-save backup and inspect bootstrap use/key scope. | Backup is session-keyed, omits client identity in the key, and has no reader in page bootstrap. | Write recoverable, safely scoped backups and consume them deterministically. | Invert | Pass | Stored backup exists; source inspection finds write path and no read path. |
| `BC-REC-003` | `DR-REC-001`, `DR-BOOT-001` | same | Seed valid and malformed backup JSON before page load. | Both are ignored; malformed JSON does not crash only because no read occurs. | Restore a valid authorized backup and quarantine malformed data without crashing. | Replace | Pass | Page renders; neither backup hydrates. |
| `BC-Q5-001` | `DR-MUT-001`, `DR-LOCAL-001` | `questionnaire-mutations.baseline-characterization.test.jsx` | Add a synthetic manual location. | Redux/browser persist the location; no draft or event call occurs. | Persist and acknowledge the canonical mutation and event. | Invert | Pass | Location in Redux/persisted root; zero draft/event calls. |
| `BC-Q5-002` | `DR-MUT-001`, `DR-LOCAL-001` | same | Update the location’s greater-area flag. | Redux/browser update; no draft or event call occurs. | Persist and acknowledge update/event. | Invert | Pass | Updated canonical name persisted; zero draft/event calls. |
| `BC-Q5-003` | `DR-MUT-001`, `DR-LOCAL-001` | same | Change the primary location. | Redux/browser update; no draft or event call occurs. | Persist and acknowledge primary selection/event. | Invert | Pass | Primary index persisted; zero draft/event calls. |
| `BC-Q5-004` | `DR-MUT-001`, `DR-LOCAL-001` | same | Remove a location and repair primary index. | Redux/browser update; no draft or event call occurs. | Persist one canonical remove/repair mutation and event. | Invert | Pass | One location/index 0 persisted; zero draft/event calls. |
| `BC-RESET-001` | `DR-MUT-001` | same | Reset a question with an auxiliary `_other` answer. | Browser slices clear, but no server snapshot/event occurs. | Persist and acknowledge the complete reset mutation. | Invert | Pass | Response/auxiliary removed locally; zero draft/event calls. |
| `BC-CLEAR-001` | `DR-CLEAR-001`, `DR-CLEAR-002` | same | Confirm Clear All while old state is persisted. | Redux clears, reload is already queued, persisted storage still has the old response, no empty snapshot/event is sent, and session ID remains. | Atomically supersede old draft, acknowledge an empty replacement, then reload under new identity. | Invert | Pass | Pending reload timer; stale persisted value; same session; zero draft/event calls. |
| `BC-CLEAR-002` | `DR-CLEAR-001` | same | Query by the unchanged session after Clear All. | The old server draft is rediscovered. | Old draft is superseded and inaccessible to the replacement session. | Invert | Pass | Helper filters with old session and returns old draft ID. |
| `BC-COND-001` | `DR-MUT-001`, `DR-SAVE-001` | same | Start with parent `yes` and entered child state, then change parent to `no`. | All child Redux/browser slices clean, but the state-driven effect cleanup cancels the queued draft-save timer; only an event is emitted, so a prior server child can survive reload/recovery. | Persist/acknowledge one child-cleanup snapshot before reload/recovery. | Replace | Pass | Child response/validation/touched/expanded/text meta absent locally; zero draft calls; event called. |
| `BC-UI-001` | `DR-SAVE-001`, `DR-MUT-001` | `component-state-and-lifecycle.baseline-characterization.test.jsx` | Type an unconfirmed numeric range, then remount. | Local editor text is not in Redux and resets to its default. | Preserve canonical in-progress editor state and restore it safely. | Replace | Pass | Pre-remount editor is `7` while Redux is empty; post-remount input is `1`. |
| `BC-UI-002` | `DR-SAVE-001`, `DR-MUT-001` | same | Type manual geographic text without Add, then remount. | Text disappears. | Preserve and restore approved in-progress location editor state. | Invert | Pass | Redux location absent; remounted input empty. |
| `BC-UI-003` | `DR-SAVE-001`, `DR-MUT-001` | same | Partially enter a person tag without confirming it, then remount. | Person editor state disappears and canonical tags remain empty. | Preserve safe partial editor state or provide an explicit durable commit boundary. | Replace | Pass | Remounted editor reports zero tags and no pending person input. |
| `BC-UI-004` | `DR-SAVE-001` | same | Edit confirmation business/domain without submit, then remount modal. | Edits revert to the original props. | Preserve approved confirmation editor state across interruption. | Invert | Pass | Remounted values equal initial synthetic values. |
| `BC-LIFE-001` | `DR-OFFLINE-001`, `DR-LOCAL-001` | same | Inspect `beforeunload`, `visibilitychange`, `pagehide`, `online`, and `offline`; dispatch `beforeunload`. | Only `beforeunload` is registered; it writes a local backup and invokes no server save/event. | Add bounded lifecycle/offline queueing, truthful acknowledgement, and reconnect reconciliation. | Replace | Pass | Listener spies and backup payload confirm the path; zero draft/event calls. |

## Reproduction limits

- These characterization cases still do not launch a native browser or exercise an actual `window.location.reload()`. The Playwright foundation added later currently covers only a read-only application-shell smoke; component remount plus the real Redux/persistence boundary remains the deterministic jsdom proxy for these cases until dedicated browser acceptance coverage replaces it.
- Unavailable `sessionStorage` and IndexedDB currently succeed because the imported bootstrap path does not access them. This records absence of use, not complete browser resilience.
- The conditional case records that no server snapshot survives the re-render; therefore there is no queued payload to inspect. The stale-server reload risk follows from the unchanged prior server record and is directly complemented by `BC-CLEAR-002`’s old-draft lookup characterization.

## Current run evidence

- Command: `npm run test:baseline-characterization`.
- Result: **5 files passed, 27 tests passed**.
- Network guard: **0 fetch calls, 0 XMLHttpRequest opens** across all tests.
- Global restoration: React cleanup, fake timers, Base44 mock implementations, local/session storage, matchMedia, fetch stubs, and XHR spies are restored after each test.

## Required validation record

| Check | Result | Evidence |
| --- | --- | --- |
| `npm ci` | Pass | 774 packages installed and 775 audited from the committed lockfile; npm reported the existing 29 dependency advisories. |
| Normal Vitest suite | Expected baseline failure remains visible | 30/32 files and 360/365 tests passed. The five known failures remain two existing helper-contract mismatches plus Q24 status, failure-backup, and geographic zero-type failures. The 18 target-safety and 9 fixture-helper tests pass; no characterization file was collected. |
| Baseline characterization | Pass | 5/5 files and 27/27 tests passed after the clean install. |
| `npm run lint` | Expected baseline failure unchanged | 54 findings: 34 errors and 20 warnings; none point to a new baseline harness file. |
| `npm run typecheck` | Expected baseline failure unchanged | 264 TypeScript diagnostics, matching the recorded source baseline; none point to a new baseline harness file. |
| `npm run build` | Pass | Vite production build completed successfully. |

The normal-suite, lint, and type-check failure signatures match `docs/durable-draft-recovery/baseline/source-baseline-validation.md`; this prompt does not fix or suppress them.
