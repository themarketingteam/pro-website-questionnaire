# Draft Conflict Merge and Multi-Tab Contract

- Status: Implemented and locally tested; staging and production certification pending
- Version: 1
- Date: 2026-08-06
- Runtime scope: Pro Questionnaire durable-draft V2 only
- Implementations: `src/lib/proDraftConflictMerge.js`, `src/lib/proDraftTabCoordinator.js`, `src/contexts/ProDraftConflictContext.jsx`, `src/components/pro-form/ProDraftConflictDialog.jsx`

## Authority and three-way merge

The server revision and lifecycle status are authoritative. A conflict merge
uses the current local canonical state, the newly authorized server canonical
state, and the last server-acknowledged base retained by the sync manager. The
base is replaced only after a save response validates. If no base is available,
field metadata may prove an ordering; otherwise a different same-field value
requires user choice. Client timestamps are diagnostic hints and never decide
which answer wins.

Draft ID, session ID, and form type must match. Submitted,
`cleared_superseded`, expired, and deleted server states win without merging an
active local edit back into them. The pre-conflict local state remains in the
ordinary browser cache and an in-memory, explicitly non-authoritative support
copy. No token is part of either canonical state.

## Field rules

| Category | Rule |
| --- | --- |
| `responses` | Merge by question path. A structured answer descends to properties only when nested field metadata proves that granularity. Same-path ambiguity pauses. |
| `validationStatus` | Merge per question; non-overlapping validation changes are retained alongside their response. |
| `touchedQuestions` | Preserve `true` from either side where safe. |
| `expandedQuestions` | Prefer the current tab because it is non-answer UX state; the accepted result is subsequently recoverable. |
| `textValidationMeta` | Merge per question/key. |
| `uiDraftState` | Merge by scope and nested data path. |
| `credentials` | Merge by allowlisted canonical field; concurrent same-field changes require choice and email previews are masked. |
| Navigation | `currentQuestionId` stays local; `lastChangedQuestionId` is derived from the adopted mutation path. |
| Lifecycle | `draftStatus` and `submission` always come from the server. |

Deletes are first-class values. Delete-versus-unchanged preserves the delete;
delete-versus-set and reset-versus-set are explicit conflicts unless
authoritative metadata proves one is newer. A merge hydration sets the latest
server revision, increments the client revision exactly once, and recomputes
the canonical hash before saving.

## Conflict choices and display safety

Each conflict exposes only its ID, canonical field path, conflict type, change
booleans, safe local/server previews, and field metadata. Text previews are
bounded, email is masked, file URLs show filename/status only, and large values
are summarized by type/count. A token-like path invalidates the merge; it can
never become a preview.

The required choices are `keep_local` and `keep_server`. `keep_both` is
accepted only for supported response arrays and deduplicates deterministically
with the saved sequence first. Autosave remains paused until all conflicts have
valid choices. Cancel closes the modal for review without changing either
state. Applying choices performs one controlled Redux hydration and saves
against the latest server revision.

The dialog uses modal semantics, labelled title/description, keyboard focus,
Escape/cancel behavior, radio groups, disabled incomplete submission, and a
bottom-sheet layout on small screens. It does not use browser-native confirm.

## Conflict rounds

On HTTP 409 the manager authorizes and loads the current server state, merges,
and automatically retries only when there is no ambiguous field. A maximum of
three consecutive merge/save rounds is allowed. A fourth 409 stops automation
with `DRAFT_SYNC_MAX_CONFLICT_ROUNDS_EXCEEDED`; the local cache remains intact
for reload or support. A validated save resets the counter and replaces the
acknowledged base.

## Multi-tab messages

Each draft uses `pro-draft-tabs-v1-<fingerprint>`, where the suffix is a
deterministic hash of the already scoped browser namespace. Raw draft IDs,
session IDs, emails, domains, business names, answers, credentials, and tokens
are not channel-name inputs or message fields.

Allowed message types are:

- `tab_hello`, `tab_active`, `tab_closing`
- `local_revision_changed`, `save_in_progress`, `server_revision_accepted`
- `conflict_detected`
- `draft_submitted`, `draft_superseded`

The allowlisted message projection contains only the protocol version,
namespace fingerprint, source tab ID, client/server revision, at most a
12-character state-hash prefix, allowlisted status, timestamp, and mutation
ID. Unknown input fields are dropped. Accepted-revision messages encourage a
stale tab to save/reconcile sooner; they do not replace server optimistic
concurrency.

## Transport and save-leader decision

`BroadcastChannel` is preferred. If unavailable, the coordinator emits the
same allowlisted envelope through a short-lived localStorage key and consumes
the `storage` event. Messages older than ten seconds are rejected and the key
is removed after emission. If storage access throws or is unavailable, the
coordinator reports `unavailable` and does not crash or claim cross-tab
coordination. Server revision conflicts remain the safety boundary.

There is deliberately no exclusive save leader. Every tab may attempt a save;
a hidden, suspended, or closed tab therefore cannot prevent progress. Accepted
revision broadcasts reduce redundant work, while backend compare-and-swap is
the sole authority for accepting state.

## Test evidence and exclusions

Focused Vitest coverage verifies field merge/delete/reset rules, terminal
authority, identity incompatibility, base/no-base behavior, choice validation,
preview safety, channel allowlisting, BroadcastChannel, storage fallback,
blocked storage, accepted revision handling, three conflict rounds, autosave
pause/resume, and dialog accessibility. The synthetic Playwright matrix passes
18/18 scenarios across desktop Chromium, Firefox, and WebKit: non-overlap,
both same-field choices, submitted terminality, BroadcastChannel-disabled
conflict protection, and namespace isolation.

All fixtures are synthetic and local. No Base44 deploy, schema change, email,
production data operation, feature-branch push, or `main` operation is part of
this contract.

## Local validation record

Commands were run from the repository root on 2026-08-06.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `npm ci` | 0 | 775 packages installed; npm reported 29 dependency vulnerabilities and six install-script review warnings. No audit mutation was run. |
| Focused merge/coordinator/sync/dialog/context Vitest command | 0 | 59/59 tests passed. |
| `npm test` | 1 | 1,556/1,561 tests passed. The five failures are the established Q24 validation, legacy failure-backup, geographic zero typing, whitespace repair, and tagged-people warning assertions; Prompt 2 tests passed. |
| Desktop Chromium/Firefox/WebKit multi-tab Playwright command | 0 | 18/18 scenarios passed. |
| `npm run test:baseline-characterization` | 0 | 27/27 characterization tests passed. |
| `npm run lint` | 1 | Repository baseline: 48 findings (32 errors, 16 warnings), predominantly legacy unused imports/variables. Prompt 2 JavaScript files pass focused ESLint. |
| `npm run typecheck` | 2 | Repository baseline: 271 TypeScript diagnostics, including dependency and legacy UI inference debt. A filtered rerun found zero diagnostics in Prompt 2 files. |
| `npm run build` | 0 | Vite production build passed with stale browser-data warnings. |

The message-shape tests inject answer and token-like extra fields and assert
they are absent from the delivered envelope. Coordinator diagnostics also
report `broadcastsAnswers=false`, `broadcastsCredentials=false`, and
`broadcastsTokens=false`.
