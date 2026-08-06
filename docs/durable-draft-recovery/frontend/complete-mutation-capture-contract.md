# Complete Mutation Capture Contract

- Status: Implemented and locally tested
- Date: 2026-08-06
- Scope: V2 questionnaire mutations on `feature/durable-draft-recovery`
- Deployment: Not authorized by this contract

## Authority and scheduling

`src/components/store/proDraftListenerMiddleware.js` is the V2 scheduling
boundary. It uses Redux Toolkit listener middleware and observes relevant form
actions only after their reducers have completed. Synchronous action bursts are
coalesced in one microtask, assigned one logical mutation ID, recorded as one
client revision, and then passed to `capturePostReducerMutation`. The sync
manager reads the complete current canonical store again when it prepares the
actual save; UI handlers never supply a partial server snapshot.

The listener covers response set/delete, validation, touched, expanded,
textarea metadata, credentials, every UI-draft action, atomic form mutations,
question reset, and canonical hydration. Canonical hydration is explicitly
excluded from ordinary scheduling. Read-only/submitted state is excluded.
Bootstrap upload remains an explicit sync-provider decision when authorized
local state is newer.

## Mutation metadata and event policy

`src/lib/proDraftMutationMetadata.js` maps actions to canonical field paths,
reason, question ID, mutation type, and set/delete operations. Atomic
geography and conditional-cleanup actions retain their existing mutation ID
and client revision. `src/lib/proDraftEventMapper.js` emits only safe summaries:
question ID/type, mutation ID, reason, and changed-field count. It never emits
answer text, email, recovery code, authorization token, or credentials.

| Mutation | Event | Policy |
| --- | --- | --- |
| Text and incomplete editor typing | `text_changed` / `ui_draft_changed` | Coalesced by question/scope for 1 second |
| Reset | `question_reset` | Immediate |
| Conditional child removal | `conditional_cleanup` | Immediate |
| Q5 add/update/remove/primary | Matching `location_*` event | Immediate |
| Other response/validation changes | Safe summarized event | Manager-batched |

The canonical snapshot remains authoritative when events are delayed, reduced,
or unavailable.

## Atomic structural mutations

- Q5 add/update/remove/primary handlers use `applyFormMutation`. Removal and
  primary repair share one action, validation/touched updates are included, and
  `lastChangedQuestionId` is `5`.
- A yes/no parent that hides children sets the parent and deletes child main,
  `_other`, `_primary`, validation, touched, expanded, text metadata, and every
  `question:<child>:` UI scope in one action. Normalization remains a secondary
  recovery defense.
- Reset Question uses `resetQuestionState`; it deletes only the named question,
  its auxiliary answers, metadata, and all scoped UI drafts. It does not reload
  the page or affect another client namespace.

## Recoverable UI scopes

| Scope | Recoverable data | Canonical/server field | Test |
| --- | --- | --- | --- |
| `question:<id>:numeric-range` | typed bounds, parsed bounds, editing flag, validation code | `uiDraftState` | `proDraftMutationCapture.test.jsx`; `mutation-capture.spec.js` |
| `question:<id>:manual-geographic` | manual text, visibility, safe pending selection, validation code | `uiDraftState` | browser matrix |
| `question:<id>:image-tags` | working plain tags, editing index/step, validation codes, safe upload metadata | `uiDraftState` | file/storage tests |
| `question:<id>:person-editor` | plain `tempPerson`, editing index/step, validation codes | `uiDraftState` | browser matrix |
| `question:<id>:certification-editor` | editing index, validation codes, safe upload metadata | `uiDraftState`; item text remains controlled in `responses` | component/reducer tests |
| `question:<id>:guarantee-editor` | editing index, validation codes, safe upload metadata | `uiDraftState`; item text remains controlled in `responses` | component/reducer tests |
| `question:<id>:file-upload` | bounded upload descriptor/error | `uiDraftState`; completed descriptor in `responses` | raw-file rejection/browser matrix |
| `confirmationDraft` | business name, domain, safe validation codes | `uiDraftState` | confirmation restore test/browser matrix |
| AI caller-provided question scope | client instruction, recoverable draft text, questions/status | `uiDraftState` integration contract | component contract/static audit |

Loading flags, modal animation state, focus, DOM nodes, Google Place objects,
provider responses, stack traces, API tokens, and raw upload objects are never
canonical.

## Upload representation

Upload handlers may hold `File` only long enough to call Base44
`integrations.Core.UploadFile({ file })`. Redux and canonical state receive only:

```js
{
  originalFileName,
  mimeType,
  sizeBytes,
  uploadStatus,
  uploadedUrl,
  base44FileId,
  errorCode,
}
```

Existing `url`, `name`, and `type` response keys are retained for compatibility.
An absent Base44 file ID remains `null`; it is never invented. Interrupted
uploads state that the upload must finish before the browser closes and require
the client to reselect the file for retry.

## Compatibility and deferred work

Legacy mode retains its existing debounced `queueDraftSave`, event entity, and
snapshot behavior. V2 returns before those direct paths and relies on the
listener/authorized backend sync manager. Clear All deliberately retains its
current reset/reload path and final submission retains its current locking and
submission path; both belong to Prompt 4. No production or staging deployment
is authorized or performed here.

## Local evidence

- Listener/event/metadata focused tests: 10/10 passed.
- Mutation/editor/static focused tests: 15/15 passed.
- Five-project Playwright matrix: 20/20 passed.
- Existing sync/store/PDF focused regression: 82/82 passed (existing React
  `act(...)` warnings remain).
- Live Base44 save behavior, real upload interruption, and staging lifecycle
  evidence remain release blockers.

## Validation record

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | Installed 775 packages; npm reported 29 dependency vulnerabilities and pending install-script approvals. |
| Focused listener/mutation/component/event/sync commands | 0 | New mutation set 25/25; combined listener/store/sync regression 88/88. |
| `npm test` | 1 | 1581/1586 passed. The five established baseline failures remain: Q24 normal-option validation, legacy local-failure backup, geographic zero-value normalization, whitespace-array repair, and tagged-people warning repair. |
| `npm run test:baseline-characterization` | 0 | 27/27 passed. |
| `npx playwright test tests/e2e/draft-v2/mutation-capture.spec.js` | 0 | 20/20 passed across Chromium, Firefox, WebKit, mobile Chromium, and mobile WebKit. |
| `npm run test:e2e` | 1 | 171 passed, 25 intentionally skipped, and 164 failed under the full 360-case nine-worker run. Failures broadly timed out during navigation/render outside Chromium; the isolated mutation matrix immediately passed 20/20, but the full command remains classified `FAILED`. |
| `npm run lint` | 1 | Existing repository baseline: 32 errors and 16 warnings. |
| `npm run typecheck` | 2 | Existing repository baseline: 271 diagnostics; the newly created listener, event mapper, metadata mapper, and scoped UI hook add none. |
| `npm run build` | 0 | Production bundle built successfully; only stale browser-data warnings were emitted. |

Static inspection found no V2 handler-level snapshot or entity write outside
the fail-closed legacy guards. Reducer validation and browser coverage reject
raw `File`, `Blob`, and `FileList` payloads. No deployment command ran.
