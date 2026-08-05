# Current system architecture inventory

Status: static baseline audit<br>
Branch audited: `feature/durable-draft-recovery`<br>
Source revision audited: `73ece4c`<br>
Audit date: 2026-08-05<br>
Scope: current questionnaire, draft persistence, submission, PDF, and recovery behavior

## Executive summary

The current application is a Vite/React single-page app backed by Base44. Questionnaire answers live in one Redux slice and five form fields are persisted through `redux-persist` to one browser-wide `localStorage` key. A second browser-wide key supplies the questionnaire session ID. Most answer changes schedule a 600 ms client-side direct upsert to `ProFormDraft` and a direct `ProFormDraftEvent` write. The app never loads a `ProFormDraft` into the public questionnaire; reload recovery depends on the browser's Redux persistence, not the server draft.

The public submit path first attempts a direct `ProFormSubmission.create`, then invokes a server fallback that is intended to create a final submission or a durable `ProFormSubmissionIntake`. The local fallback implementation is packaged under a nested `entry/entry.ts`, but the read-only Base44 function listing did not show that function as deployed. The successful path resets Redux and retains a React-only response snapshot for the thank-you modal and client-side PDF download.

The admin recovery surfaces read draft and intake entities directly from the browser. The draft-recovery route has a server-verified password grant, while the other two admin routes require a Base44 admin user or the source-coded email allowlist. The entity schemas do not declare RLS for `ProFormDraft` or `ProFormDraftEvent`, so the source alone does not establish a server-side authorization boundary for those direct calls.

This is a static inventory, not a runtime certification. No production records were accessed, no submission was sent, no email was sent, and no Base44 resource was mutated.

## Inventory counts

| Item | Count | Basis |
| --- | ---: | --- |
| Explicit app route patterns | 7 | Six concrete `Route` patterns plus the `*` error route in `src/App.jsx` |
| Production frontend direct draft-entity call sites | 7 | Calls involving `ProFormDraft` or `ProFormDraftEvent`; tests excluded |
| Local Base44 function resource directories | 8 | Top-level directories below `base44/functions`, excluding `_shared` |
| Functions listed by the read-only Base44 CLI | 7 | `npx base44 functions list` on 2026-08-05 |
| Base44 entity schemas | 4 | Files below `base44/entities` |

## Repository and runtime inventory

### Core stack

| Concern | Current implementation | Evidence |
| --- | --- | --- |
| Framework | React 18.2, React DOM 18.2 | `package.json`, `src/main.jsx` |
| Build/dev server | Vite 6 with React and Base44 plugins | `vite.config.js` |
| Routing | React Router 6 `BrowserRouter`, declarative routes | `src/App.jsx`, `src/pages.config.js` |
| State | Redux Toolkit with one `form` reducer; React local state for transient UI | `src/components/store/store.jsx`, `src/pages/ProQuestionnaire.jsx` |
| Browser persistence | `redux-persist` 6 over `localStorage`, plus explicit local/session storage helpers | store and `src/lib/browserSafety.js` |
| Server platform | Base44 SDK 0.8.x and Base44 function/entity resources | `src/api/base44Client.js`, `base44/` |
| Server-state cache | TanStack Query provider exists; questionnaire draft flow does not use queries | `src/App.jsx`, `src/lib/query-client` |
| Styling/UI | Tailwind CSS, Radix components, Lucide icons, Sonner/toast components | package and component imports |
| Tests | Vitest 1.6, jsdom, Testing Library, jest-dom, user-event | package files, `src/vitest.config.js`, `src/test` |
| PDF | Browser-only `html2canvas` + `jsPDF`; no PDF backend function | `src/components/pro-form/PDFGenerator.jsx` |

`package-lock.json` is lockfile version 3 and locks Base44 SDK, Vitest, and `redux-persist`. The root package is `base44-app` version `0.0.0`.

### Package scripts

| Script | Command/purpose |
| --- | --- |
| `dev` | Vite development server |
| `build` | Production Vite build |
| `lint`, `lint:fix` | ESLint check/fix |
| `typecheck` | TypeScript check through `jsconfig.json` |
| `preview` | Vite preview server |
| `workspace:check` | Read-only durable-draft workspace/branch validation |
| `workspace:repair` | Workspace repair utility; not run for this audit |

There is also `src/package.json` with a focused `test:submit-hardening` command. The root `package.json` has no `test` script, so repository tests are normally invoked directly with Vitest.

### Base44 initialization and configuration

- `base44/config.jsonc` declares the site name, `npm install`, `npm run build`, `npm run dev`, and `./dist`.
- `base44/.app.jsonc` exists, contains a populated app binding, is ignored by Git, and was inspected only for structure. Its value is intentionally omitted.
- `vite.config.js` installs the Base44 Vite plugin and enables legacy SDK imports only when `BASE44_LEGACY_SDK_IMPORTS=true`.
- `src/lib/app-params.js` resolves `app_id`, `server_url`, `access_token`, `from_url`, and `functions_version` from URL parameters, browser storage, or Vite defaults. It removes `access_token` from the visible URL after reading it but stores the value under a Base44-prefixed local-storage key.
- `src/api/base44Client.js` passes the resolved app ID, server URL, token, and function version to `createClient` with `requiresAuth: false`.
- `src/lib/AuthContext.jsx` separately retrieves public app settings and calls `base44.auth.me()` when a token is present. An app-level Base44 `auth_required` result redirects to Base44 login.

### Environment variables and source-configured endpoints

| Name | Consumer | Purpose |
| --- | --- | --- |
| `VITE_BASE44_APP_ID` | `src/lib/app-params.js` | Browser Base44 app default |
| `VITE_BASE44_BACKEND_URL` | `src/lib/app-params.js` | Browser Base44 server default |
| `VITE_APP_VERSION` | browser safety/submission diagnostics | Submit context/version tag |
| `BASE44_LEGACY_SDK_IMPORTS` | `vite.config.js` | Build-time legacy import compatibility |
| `BASE44_APP_ID` | Base44 AI functions/shared helper | Server agent API app ID |
| `BASE44_SERVICE_ROLE_KEY` | Base44 AI functions/shared helper | Server agent API authorization |
| `OPENAI_KEY` | AI generation and text validation functions | OpenAI API authentication |
| `ZAPIER_WEBHOOK_URL` | Zapier, retry, and repair functions | Webhook endpoint, constrained to the source-configured allowed endpoint |
| `DRAFT_RECOVERY_PASSWORD` | recovery grant functions | Password check and HMAC grant signing |

The HTML contains a browser Google Maps API key and the backend Zapier functions contain a fallback webhook URL. Their values are deliberately not reproduced here. `generateAIContentOpenAI` also contains a source-configured OpenAI assistant identifier.

### External integrations

| Integration | Current use |
| --- | --- |
| Base44 entities/functions/auth/app logs | Core persistence, submit, recovery, authentication, activity log |
| Base44 `UploadFile` | File, image-tagging, certification, and guarantee uploads |
| Base44 agents | AI repair backend; dormant questionnaire AI modal also has a direct-agent grammar path |
| OpenAI | `validateQuestionText` and `generateAIContentOpenAI` |
| Zapier Catch Hook | Post-submission delivery and recovery retries |
| Google Maps JavaScript/Places | Question 5 location selection |
| Microsoft Clarity | Page, answer, validation, submission, and PDF events/tags |
| Hotjar | Browser behavior analytics loaded by `Layout` |
| Supabase public object storage | Header/banner/favicon assets |

`src/api/integrations.js` exports Base44 `SendEmail` and `SendSMS`, but no production questionnaire source imports those exports. No email library, email function, or active email-send path was found. `TestZapier.jsx` exists but is not registered in the route map. `AIContentModal.jsx` exists but has no active import/call site.

### CI, deployment, feature flags, logging, and errors

- No `.github` workflow, container definition, hosting manifest, or standalone deploy script exists in the repository. Base44 site commands in `base44/config.jsonc` are the only deployment-oriented configuration found.
- The active build feature toggle is `BASE44_LEGACY_SDK_IMPORTS`. Development-only submit fault injection uses `?debugSubmitFailure=` with a fixed allowlist. Diagnostic URL flags include `diag`, `debugLoops`, `redux-data`, and `norm-debug`/`redux-data=true`; some diagnostics can be enabled by URL outside `DEV`.
- Logging is primarily `console.*`, Base44 `appLogs.logUserInApp`, Clarity, and Hotjar. No Sentry/Datadog error collector was found.
- `src/components/common/ErrorBoundary.jsx` wraps the main questionnaire render and can purge persisted form state. It does not wrap all routes at the application root, and its error handling only logs to the console.
- `NavigationTracker` posts the complete browser URL to the parent window with target origin `*`; URLs can contain questionnaire identity parameters before an embedding parent receives the message.
- Vite is configured with `logLevel: 'error'`.

## Route inventory

Seven explicit route patterns were found. Global app-parameter parsing runs before route rendering and therefore applies to all routes.

| Route | Component and access | Query/fragment inputs | Reads and writes | Sensitive/storage notes |
| --- | --- | --- | --- | --- |
| `/` | `ProQuestionnaire` through `Layout`; public unless Base44 public settings require auth | `businessName`, `domainName`, `userId`, `userEmail`, `userName`; global Base44/debug/reset parameters | Rehydrates Redux; writes Redux/local storage, draft/event entities, submissions/functions, uploads, analytics | Identity values remain in the URL. One global Redux key and one global session key are used. No fragment is consumed. |
| `/ProQuestionnaire` | Redirects to `/` | Same global parameters may be parsed before redirect | No questionnaire data load before redirect is guaranteed | Alias only |
| `/ThankYou` | Legacy `ThankYou` through `Layout`; same app-level auth behavior | `businessName`; global parameters | Rehydrates the same Redux store even though the page only displays `businessName`; writes title/favicon/analytics loaders | Business name appears in URL; no submitted response snapshot and no PDF download |
| `/admin/submit-intake` | `AdminOnly` plus page-level auth check | Global parameters only | Admin manually repairs input, directly creates `ProFormSubmission`, then calls Zapier | Requires Base44 role `admin` or the source-coded single-email allowlist; email itself is omitted here |
| `/admin/draft-recovery` | `DraftRecoveryPasswordGate` then `ProFormDraftRecovery` | Global parameters only | Directly lists/updates drafts and lists intakes; invokes retry/repair | Does not require a Base44 user when a password-derived grant is valid. Grant token/expiry are stored in `pro_draft_recovery_access_v1`. |
| `/admin/questionnaire-intake-recovery` | `AdminOnly` then intake recovery page | Global parameters only | Directly lists intake records; invokes retry/repair | Base44 admin or source-coded email allowlist |
| `*` | `PageNotFound` | Global parameters | No application data; navigation back to `/` | Error route |

There is no local `/login` route. `AuthContext.navigateToLogin()` delegates to `base44.auth.redirectToLogin(window.location.href)`. No path parameter contains a draft/session/invitation ID, and no application code reads `location.hash`; `app-params.js` merely preserves a fragment while rewriting the URL.

`resetFormState=1` is consumed by `ReduxProvider` on every route using `Layout`. It purges the persisted store, dispatches `resetForm`, removes the parameter, and reloads. The development flags above are also query parameters. The Base44 global parameters are stored as `base44_*` keys; `access_token` is removed from the URL but remains browser-local.

## Redux and browser persistence

### Store contract

The store contains one reducer at `state.form`.

| Field | Persisted | Current role | Reset behavior |
| --- | --- | --- | --- |
| `responses` | Yes | Answers and auxiliary `_other`/`_primary` values | Cleared |
| `validationStatus` | Yes | Per-question status | Cleared |
| `touchedQuestions` | Yes | UI/validation interaction state | Cleared |
| `expandedQuestions` | Yes | Accordion state | Cleared, then often repopulated |
| `credentials` | No | Business/domain/user identity copied from URL | **Not cleared by `resetForm`** |
| `textValidationMeta` | Yes | Last validated textarea value and dirty flag | **Not cleared by `resetForm`** except per-question `deleteResponse` |

Persist configuration:

- Logical key: `pro-questionnaire-root`; browser key: `persist:pro-questionnaire-root`.
- Version: 3.
- Engine: `redux-persist/lib/storage`, which is `localStorage` in the browser.
- Whitelist: the five persisted fields in the table.
- Migration 2 calls `normalizePersistedState`; migration 3 calls `normalizePersistedStateV3`.
- A transform calls v3 normalization on every `form` rehydrate. Its outbound/persist side is a no-op.
- `PersistGate` blocks route children until rehydration and runs the `resetFormState=1` purge path before lift.

Normalization migrates legacy question IDs `1.2`/`1.2.1` to `12`/`12.1`, removes unknown keys, normalizes values by question type, and clears hidden conditional-child state. It returns an empty safe baseline for malformed top-level state. It does not implement binary `File` serialization.

Reducers `setMultipleResponses`, `setMultipleValidationStatus`, and `loadInitialState` are defined but have no production caller. `resetForm` leaves credentials and text validation metadata in memory/persistence. Submission success calls `resetForm`; Clear All also calls it and then reloads.

### Browser keys and consumers

| Key/pattern | Writer | Reader | Scope/retention |
| --- | --- | --- | --- |
| `persist:pro-questionnaire-root` | `redux-persist` | `redux-persist`; dev `ReduxDataValidator` | Browser origin, no TTL, shared by all clients |
| `pro_questionnaire_session_id` | `sessionId.js` | `sessionId.js` | Despite its name, `localStorage`; no TTL; clear helper has no production caller |
| `pro_questionnaire_local_backup_<session>` | before-unload, autosave failure, submit failure | No production restore reader found | No TTL or cleanup |
| `failed_pro_submission_<timestamp>` | submit failure | No production restore reader found | No TTL or cleanup |
| `pro_draft_recovery_access_v1` | password gate | password gate | HMAC grant and expiry; removed when expired/invalid |
| `base44_<parameter>` | `app-params.js` | `app-params.js` | App/server/token/from URL/function version; no local TTL |
| Session-storage helper keys | Generic helper only | Generic helper only | No questionnaire call site found |

No IndexedDB access was found. No `pagehide` or `visibilitychange` handler was found.

`app-params.js` obtains `window.localStorage` at module evaluation (`const storage = windowObj.localStorage`) outside a guard. Browsers that throw while exposing the storage getter can therefore fail before React or the questionnaire error boundary mounts.

## Current questionnaire data flow

### First load, URL handling, and rehydration

1. `src/main.jsx` renders `App`.
2. Importing the Base44 client imports `app-params.js`, which parses and stores the global Base44 parameters. `access_token` is removed from the visible URL after capture.
3. `AuthProvider` fetches Base44 public settings and optionally resolves the current user.
4. React Router selects a route. `Layout` mounts `ReduxProvider` and Hotjar.
5. `PersistGate` reads and migrates/normalizes `persist:pro-questionnaire-root`.
6. `ProQuestionnaire` calls `getOrCreateQuestionnaireSessionId`, reusing the origin-global local-storage value when present.
7. The questionnaire parses business and user query parameters into non-persisted Redux credentials and analytics tags.
8. Its mount-only initialization creates collapsed question entries, marks rehydrated answers touched, and recomputes missing validation for eligible fields. It does not call `ProFormDraft.filter/list` to restore server data.

Failures in storage access are partly caught by `sessionId.js`, browser-safety helpers, and the Redux boundary, but the module-level app-parameter storage getter is earlier than those guards.

### Normal answer and validation update

For most controls, `updateResponse(questionId, value)`:

1. Dispatches `setResponse`.
2. For textareas, may dirty `textValidationMeta` and clear validation.
3. Creates `newResponses` from the render's response snapshot plus the new value.
4. Calls `queueDraftSave`, replacing any pending 600 ms timer.
5. Queues or immediately writes a direct `ProFormDraftEvent` (text events use a 1 s debounce).
6. Emits Clarity metadata.
7. Computes/dispatches validation and touched state **after** scheduling the draft save.
8. Redux persistence asynchronously serializes the updated whitelisted fields to local storage.

The scheduled draft callback receives the explicit new responses, but its validation/touched/expanded arguments come from the callback's earlier React render. This can write internally inconsistent server snapshots. Validation-only, touched-only, and expand/collapse actions do not independently queue a draft save.

Question 5 is an exception: its add/update/remove/primary handlers dispatch directly instead of calling `updateResponse`. They update browser-persisted Redux and UI validation but do not call the server draft/event paths.

### Server draft save and event

`createSaveDraftSnapshot` maps responses into final-style metadata/userdata, serializes four state maps, and uses the client SDK directly:

1. Return the cached draft ID when one is known.
2. Otherwise `ProFormDraft.filter({session_id})`, sort newest, and cache the first ID.
3. `update(id, draftRecord)` when found, otherwise `create(draftRecord)`.

There is no transaction, unique constraint, idempotency key, revision, compare-and-swap, or server-side status transition guard in the repository. Concurrent first saves can both observe no draft and create duplicates. An already-dispatched `status: draft` update can complete after a submit write because the client can cancel a timer but not an in-flight request.

Event records serialize the complete changed value into `value_json` and also include a summary/count plus session/business/domain/user metadata. Event errors are logged and ignored.

### Reload, close, reset, and clear

- **Reload:** Redux rehydrates from the one browser key; the existing session ID is reused. There is no server draft read. Component-local transient values are reconstructed only if already committed to Redux.
- **Browser close/navigation:** the sole lifecycle handler is `beforeunload`. It writes the current four-map snapshot to a local backup key. It does not send a server request, use `sendBeacon`, or restore that backup later. Pending draft/event timers are cleared during unmount.
- **Reset Question:** `deleteResponse` and an `incomplete` validation dispatch update Redux. No explicit draft save or reset event occurs.
- **Clear All:** `resetForm`, collapse dispatches, toast, and reload. It neither creates a new session ID nor writes an explicit empty server draft. Because `resetForm` omits `textValidationMeta` and credentials, it is not a full slice reset.
- **Conditional parent set to `no`:** child responses/status/touched/expanded are cleared as part of the parent update. The parent answer queues a draft with the merged response snapshot before those child deletions finish, so the immediate server snapshot can retain hidden child responses until another qualifying save.

### Final validation and submission

1. Submit-time validation finds dirty/unvalidated textareas and calls `validateQuestionText` concurrently.
2. Passing statuses are `complete` and `needs_work`; failures set `incomplete`, dirty metadata, touched state, analytics, and draft events.
3. The full form validity check must pass before `ConfirmModal` opens.
4. Business name/domain live only in `ConfirmModal` state until confirmation.
5. Confirmation blocks duplicate UI submissions, clears the pending draft timer, snapshots responses, and calls `submitProQuestionnaire`.
6. The submit library records `submit_attempted` as an event and attempts a draft save. Draft-save failure is nonfatal.
7. It transforms, repairs, and validates the payload. Transform/validation failure records `submit_failed`, writes a local failure backup, and invokes the fallback.
8. A normal payload first attempts direct `ProFormSubmission.create` with retry. Failure invokes `submitProQuestionnaireFallback`.
9. The fallback contract can return either a final submission or a durable intake record; either is treated as received/success by the client.
10. The normal successful path attempts a `submitted` draft write, records events, and calls `sendToZapier` unless the fallback already reported Zapier delivery or only an intake was received.
11. Draft/event/Zapier errors are handled differently: draft and event errors are generally nonfatal; Zapier is best-effort after a saved final submission; failure before durable submission/intake rejects to the modal with the session ID as a recovery code.
12. On client success, `hasFinalSubmittedRef` is set, an in-memory response/business/domain snapshot is retained, Redux is reset, and `ThankYouModal` opens in place. The router does not navigate to `/ThankYou`.

When the transform/validation-error fallback succeeds early, the code reports success after having saved `submit_failed`; that branch does not subsequently issue the normal `submitted` draft write. On every path, `safeDraftSave` can swallow the server draft-save failure, so the UI statement that progress was saved is not proof of a successful server draft write.

### PDF flow

- `ConfirmModal` can download the current live responses after requiring a business name.
- `ThankYouModal` downloads the preserved submitted response snapshot after Redux reset.
- `useQuestionnairePdfDownload` gates duplicate clicks and calls `generatePDF`.
- `PDFGenerator.jsx` builds a model and escaped HTML, appends an offscreen DOM container, waits for fonts/logo, rasterizes it with `html2canvas`, builds a single custom-height `jsPDF`, and triggers a local download.
- The temporary DOM node is removed in `finally`; errors log/toast and return `{success:false}`.
- No Base44 entity/function, email, or server PDF service participates. The legacy `/ThankYou` route cannot download because it has no response snapshot.

### Admin recovery flow

- `/admin/draft-recovery` first verifies a password or stored HMAC grant through `verifyDraftRecoveryAccess`.
- After the gate, `ProFormDraftRecovery` directly calls `ProFormDraft.list`, filters/sorts in browser state, and renders potentially sensitive draft payloads.
- `DraftEditPanel` parses/edits serialized payload fields and directly calls `ProFormDraft.update`.
- Retry and repair actions call server functions with a draft/intake/session ID and the recovery grant. Those functions reauthorize as Base44 admin or validate the grant, then use service-role entity access.
- The same page embeds `QuestionnaireIntakeRecovery`, which directly lists intake records.
- The standalone intake route uses `AdminOnly` and the same intake component but passes no password grant; an authenticated Base44 admin can authorize the backend calls.
- `/admin/submit-intake` directly creates a final submission after client-side repair and then attempts Zapier delivery.

There is no public self-service route that looks up a draft by recovery code and restores it into Redux.

## Direct draft-entity access audit

The production frontend has seven direct call sites. No dynamic bracket-based draft entity helper was found.

| File/function | Operation | Caller | Current authorization assumption | Later replacement requirement |
| --- | --- | --- | --- | --- |
| `src/lib/draftPersistence.js:createFindExistingDraftBySessionId` | `ProFormDraft.filter` | Shared helper used by public questionnaire | Public SDK access/RLS permits session filter | Move to a server draft API with scoped identity and no arbitrary entity query |
| `src/lib/draftPersistence.js:createSaveDraftSnapshot` | `ProFormDraft.update` | Shared/public | Public SDK access/RLS permits update by exposed record ID | Server atomic update with ownership, revision, and status guard |
| `src/lib/draftPersistence.js:createSaveDraftSnapshot` | `ProFormDraft.create` | Shared/public | Public SDK access/RLS permits create | Server idempotent create/upsert with a uniqueness contract |
| `src/pages/ProQuestionnaire.jsx:createDraftEvent` | `ProFormDraftEvent.create` | Public questionnaire | Public SDK access/RLS permits create | Server-side event endpoint with payload minimization/rate control |
| `src/lib/proQuestionnaireSubmit.js:recordSubmitStage` | `ProFormDraftEvent.create` | Public submit library | Public SDK access/RLS permits create | Same server event boundary |
| `src/pages/ProFormDraftRecovery.jsx:loadDrafts` | `ProFormDraft.list` | Password-gated admin UI | UI gate plus entity read policy | Server admin/recovery list endpoint; do not rely on UI-only gate |
| `src/components/admin/DraftEditPanel.jsx:handleSave` | `ProFormDraft.update` | Password-gated admin UI | UI gate plus entity update policy | Server admin/recovery update endpoint with validation/audit log |

Entity schema files declare no RLS for the two draft entities. Platform defaults or out-of-repository policy could still apply, but that cannot be certified from this source.

## Component-local and file state

Persisted answer values generally flow through `updateResponse`, but these transient states are not recoverable after a reload:

- unlocked numeric-range inputs and their 5-second timers before `Lock In`;
- unsaved Google Places/manual location text and loader/retry state;
- image tag coordinates/person fields until `Save Person` calls `onChange`;
- expanded editor indices and upload-in-progress flags;
- modal business/domain edits and submit/PDF in-flight flags;
- selected raw browser `File` objects while an upload is pending.

Completed upload handlers persist only Base44 URL/name/type descriptors, not raw `File` objects. Those descriptors can be serialized; an interrupted pre-upload selection cannot.

## Risk verification

| # | Suspected risk | Classification | Static evidence |
| ---: | --- | --- | --- |
| 1 | Module-level direct `localStorage` access can crash initialization | **CONFIRMED** | `app-params.js` evaluates `windowObj.localStorage` outside `try`; a throwing storage getter fails import before React mounts. |
| 2 | Persisted Redux key is global across clients | **CONFIRMED** | Fixed `persist:pro-questionnaire-root`; no client/user/session namespace. |
| 3 | Session ID key is global across clients | **CONFIRMED** | Fixed local-storage key `pro_questionnaire_session_id`; no namespace or TTL. |
| 4 | Base44 drafts are written but not loaded into the client form | **CONFIRMED** | Public flow calls filter only to select a write target; mount never dispatches draft contents into Redux. |
| 5 | Local failure backups are written but never consumed | **CONFIRMED** | Production writes both backup patterns; no production restore/read path was found. |
| 6 | `beforeunload` is the only lifecycle save | **PARTIALLY_CONFIRMED** | It is the only lifecycle hook and only writes local backup; it is not the only overall save because most answers have 600 ms server autosave. |
| 7 | Debounced saves may contain inconsistent validation/touched/expanded state | **CONFIRMED** | Answer snapshot is explicit, but the scheduled closure uses pre-dispatch validation/touched/expanded maps. |
| 8 | Question 5 handlers bypass server draft saving | **CONFIRMED** | All four Q5 callbacks dispatch directly and only increment the UI indicator. |
| 9 | Reset Question bypasses server draft saving | **CONFIRMED** | `resetQuestion` deletes/invalidates only in Redux; no save/event call. |
| 10 | Clear All does not save an explicit empty/new state safely | **CONFIRMED** | No server save or session rotation; reset omits two slice fields and then reloads. |
| 11 | `textValidationMeta` is missing from `ProFormDraft` | **CONFIRMED** | Field is persisted in Redux but absent from schema and `createSaveDraftSnapshot` arguments/record. |
| 12 | Component-local values are not recoverable | **CONFIRMED** | Multiple uncommitted edit/modal/upload states exist only in component state/refs. Committed answer values are a narrower exception. |
| 13 | `AutoSaveIndicator` claims a secure cookie inaccurately | **CONFIRMED** | Component says “secure cookie”; no cookie API participates in autosave. Current persistence is local storage plus direct Base44 writes. A dormant AI modal has an unrelated cookie-context reader. |
| 14 | Public/admin UI directly accesses draft entities | **CONFIRMED** | Seven direct frontend draft/event calls; admin list/update are browser calls after UI gates. |
| 15 | Client-side filter-then-create upsert can race | **CONFIRMED** | Separate filter and create calls without unique/atomic server enforcement in source. |
| 16 | Submitted status can be regressed by a delayed save | **PARTIALLY_CONFIRMED** | Pending timer is canceled and a submitted ref prevents new timers, but an in-flight unconditional `update(status:'draft')` cannot be canceled and no revision/status guard exists. Timing requires runtime reproduction. |
| 17 | One browser can leak Client A state into Client B | **CONFIRMED** | Global Redux/session keys rehydrate A's responses/session while B's URL can replace only credentials, causing cross-client display/write risk. |
| 18 | Raw `File` objects cannot be restored | **PARTIALLY_CONFIRMED** | JSON persistence cannot restore raw `File`; current completed-upload paths store serializable URL descriptors, while pre-upload/in-flight file selections are lost. |

## Tests and audit limitations

The repository has focused suites for questionnaire regression/optional children, textarea validation, submit resilience, payload normalization/repair, draft recovery authorization/gates, Zapier behavior, PDF model/template/theme/download, Clarity, and workspace recovery. The mocks cover the relevant Base44 entities, functions, uploads, auth, analytics, and storage.

Static tests demonstrate intended branches but do not prove cloud RLS, remote function contents, browser lifecycle delivery, cross-tab behavior, uniqueness, write ordering, production analytics privacy, or data retention. The read-only function list proves name visibility at one point in time, not deployed source equivalence or function health.

## Required inspection coverage

| Area | Files inspected |
| --- | --- |
| Project/build | `package.json`, `package-lock.json`, `vite.config.js`, `index.html`, `README.md`, `base44/config.jsonc`, ignored `base44/.app.jsonc` structure |
| Base44 client/config | `src/api/base44Client.js`, `src/api/entities.js`, `src/api/integrations.js`, `src/lib/app-params.js`, `src/lib/AuthContext.jsx` |
| Draft/browser utilities | `src/lib/browserSafety.js`, `src/lib/sessionId.js`, `src/lib/draftPersistence.js`, `src/lib/draftEvents.js` |
| Submit/repair | `src/lib/proQuestionnaireSubmit.js`, `src/lib/proSubmissionResilience.js`, response normalizers/repair helpers, submit debug/context helpers |
| Redux | `src/components/store/store.jsx`, `formSlice.jsx`, `normalization.jsx`, `src/components/ReduxProvider.jsx`, `ReduxDataValidator.jsx` |
| Routes/pages | `src/App.jsx`, `src/pages.config.js`, `src/Layout.jsx`, `ProQuestionnaire.jsx`, `ThankYou.jsx`, `ProFormDraftRecovery.jsx`, `QuestionnaireIntakeRecovery.jsx`, `AdminSubmitIntake.jsx`, unregistered `TestZapier.jsx`, error/auth/navigation components |
| Admin | `DraftRecoveryPasswordGate.jsx`, `DraftEditPanel.jsx`, `QuestionnaireIntakeRecovery.jsx` |
| Form inputs/state | Every file directly below `src/components/pro-form`; persistence-sensitive components include Q5 geography, numeric range, file/image/certification/guarantee inputs, textarea validation, confirm/thank-you/autosave components |
| Payload/PDF | `submissionPayload.jsx`, answer formatters, `PDFGenerator.jsx`, and every file under `src/components/pro-form/pdf` |
| Base44 schemas/functions/agents | Every file under `base44/entities`, every top-level and nested function entry under `base44/functions`, shared helpers, and all three agent definitions |
| Tests | Every file below `src/test` and `src/lib/__tests__`, including mocks/readme and the retry manual-test note |

Repository-wide searches also covered direct/dynamic Base44 entity access, all function invocations and `/api/functions/` calls, `localStorage`, `sessionStorage`, IndexedDB, `beforeunload`, `pagehide`, `visibilitychange`, `redux-persist`, and every draft-relevant Redux action. No renamed alternative was needed for any required path.

## Migration priorities implied by this inventory

This audit does not implement changes. The source evidence makes these later migration concerns high priority:

1. Namespace and safely initialize browser state, then add an explicit server restore/merge contract.
2. Replace direct public/admin draft entity access with authorized backend functions.
3. Make draft upsert/status transitions atomic, versioned, and idempotent.
4. Persist complete recoverable state, define transient-state behavior, and consume/expire backups.
5. Route every answer/reset/clear/validation transition through one snapshot writer.
6. Reconcile the missing remote submit fallback before relying on durable intake behavior.
