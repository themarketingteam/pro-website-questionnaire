# Redux Draft State and Mutation Contract

## Scope

This contract defines the Redux foundation for canonical questionnaire draft recovery. It extends the existing `form` slice without migrating every questionnaire component and without adding storage middleware, server synchronization, Base44 APIs, entity changes, or deployment behavior.

The authoritative portable state remains canonical draft schema version 4 in `src/lib/questionnaireDraftState.js`. Redux includes runtime lifecycle diagnostics around that portable state, but selectors exclude those diagnostics when constructing a canonical snapshot.

## Extended form state

The existing maps remain unchanged:

- `responses`
- `validationStatus`
- `touchedQuestions`
- `expandedQuestions`
- `credentials`
- `textValidationMeta`

The slice adds:

```js
{
  uiDraftState: {},
  fieldChangeMetadata: {},
  draftContext: {
    draftId: null,
    sessionId: null,
    draftStatus: 'active',
    schemaVersion: 4,
    clientRevision: 0,
    serverRevision: 0,
    sourceTabId: null,
    namespace: null,
    restoredFrom: null,
    lastStateHash: null,
  },
  draftBootstrapStatus: {
    state: 'idle',
    errorCode: null,
    startedAt: null,
    completedAt: null,
    source: null,
  },
  draftSyncStatus: {
    state: 'idle',
    storageMode: null,
    lastLocalSavedAt: null,
    lastServerSavedAt: null,
    pendingClientRevision: null,
    confirmedClientRevision: null,
    confirmedServerRevision: null,
    errorCode: null,
    retryCount: 0,
  },
  currentQuestionId: null,
  lastChangedQuestionId: null,
  lastMutation: null,
  submittedReceipt: null,
}
```

Every initial-state call creates fresh nested values. `namespace` identifies a browser storage namespace; it is not authorization. `lastStateHash` compares state; it is not a credential.

`submittedReceipt`, when present, is limited to:

```js
{
  finalSubmissionId,
  submittedAt,
  pdfAvailable,
}
```

It never contains submitted responses, an external error body, or authorization material.

## State enums

The slice exports four frozen value catalogs:

- `DRAFT_BOOTSTRAP_STATES`: `idle`, `loading`, `ready`, `error`
- `DRAFT_SYNC_STATES`: `idle`, `local_saving`, `local_saved`, `server_saving`, `server_saved`, `offline_local_only`, `retrying`, `error`, `restored`, `submitted`
- `DRAFT_RESTORED_FROM_VALUES`: `none`, `browser`, `server`, `merged`, `legacy`, `submitted_receipt`
- `DRAFT_MUTATION_REASONS`: `response_change`, `validation_change`, `touch_change`, `expanded_change`, `ui_draft_change`, `credentials_change`, `question_reset`, `conditional_cleanup`, `clear_all`, `bootstrap`, `restore`, `submission_attempt`, `submission_failure`, `submission_success`, `system`

## UI draft state

`uiDraftState` stores unfinished answer-bearing editor values by scope. Each entry uses canonical schema-v4 form:

```js
{
  kind,
  version,
  data,
  updatedAtClient,
  sourceTabId,
}
```

The actions are `setUiDraftState`, `patchUiDraftState`, `clearUiDraftState`, and `clearAllUiDraftState`. Public action preparation validates scopes and entries before dispatch. Reducers defensively revalidate raw actions before mutation. An invalid patch cannot replace a valid entry; a partial patch cannot create a new entry lacking required fields.

Purely visual component state is out of scope. Components will migrate unfinished answer-bearing state in a later batch.

## Atomic mutation payload

`applyFormMutation` accepts only a payload prepared by `prepareFormMutationPayload`:

```js
{
  setResponses,
  deleteResponseKeys,
  setValidationStatus,
  deleteValidationKeys,
  setTouchedQuestions,
  deleteTouchedKeys,
  setExpandedQuestions,
  deleteExpandedKeys,
  setTextValidationMeta,
  deleteTextValidationMetaKeys,
  setUiDraftState,
  deleteUiDraftStateKeys,
  setCredentials,
  currentQuestionId,
  lastChangedQuestionId,
  mutationMetadata: {
    mutationId,
    mutationType,
    reason,
    changedAtClient,
    sourceTabId,
    baseServerRevision,
  },
}
```

All mutation sections are optional except `mutationMetadata`. Maps, key lists, credentials, UI entries, question IDs, and metadata are normalized as one unit. If one section is invalid, action creation fails and none of the mutation is applied.

`createMutationId` and `createDraftMutationMetadata` generate randomness and time outside reducers. Both support deterministic dependency injection for tests. Mutation IDs are state correlation values, not authorization.

### Reducer order

The reducer applies a valid mutation in this order:

1. Delete response, validation, touched, expanded, text metadata, and UI draft keys.
2. Set the corresponding maps.
3. Replace credentials with the normalized credential allowlist.
4. Apply current and last-changed question IDs.
5. Record value-free field-change metadata.
6. Increment `draftContext.clientRevision` exactly once.
7. Store safe `lastMutation` metadata.

The reducer does not increment `serverRevision`. It ignores an ordinary mutation when `draftStatus` is `submitted`.

Field metadata contains only operation, revisions, timestamp, source tab, and mutation ID. It does not copy response values.

## Draft context and lifecycle status

Draft-context actions are:

- `setDraftContext`
- `patchDraftContext`
- `setDraftStatus`
- `setDraftRevisions`
- `setDraftStateHash`
- `clearDraftContext`

Only documented context fields are accepted. Unknown fields and secret-looking keys are rejected. Ordinary actions cannot move a submitted draft back to active. `clearDraftContext` requires explicit booleans for clearing the session and preserving the browser namespace and submitted receipt.

Bootstrap timestamps are always action inputs. A completed bootstrap is not replaced by `loading` unless `beginNew: true` explicitly starts another bootstrap.

Sync actions store safe codes, revisions, timestamps, retry counts, and storage modes only. `server_saved` requires confirmed client/server revisions and a server timestamp. A local save whose mode is `memory_only` becomes `offline_local_only`, never `local_saved`. Submitted sync state is protected from ordinary save/retry/error transitions.

Reducers never call time, randomness, storage, network, Base44, or browser APIs.

## Controlled canonical hydration

Callers use:

```js
const prepared = createLoadCanonicalDraftStateAction(input, {
  source: 'server',
  completedAt: '2026-08-05T14:00:00.000Z',
  namespace: 'synthetic-namespace',
  lastStateHash: 'a'.repeat(64),
  storageMode: 'indexeddb',
});
```

The helper returns one of:

```js
{ ok: true, action, errorCode: null, issues: [], safeDiagnostics }
{ ok: false, action: null, errorCode, issues, safeDiagnostics }
```

It migrates and normalizes the input before creating an action. `loadCanonicalDraftState` is the throwing convenience action factory for callers that already handle validation errors.

The hydration reducer fully replaces response, validation, touched, expanded, text metadata, credentials, UI draft state, field metadata, questions, last mutation, draft context, and submitted receipt. It does not shallow-merge stale recoverable maps and does not increment the client revision.

Hydration records an explicit bootstrap source and completion timestamp. Submitted hydration creates only a safe receipt and locks ordinary mutations. Compatibility warnings, raw records, recovery material, secret hashes, and complete submission payloads never enter Redux.

## Reset behavior

`resetQuestionnaireState` accepts:

```js
{
  preserveCredentials = true,
  preserveDraftContext = false,
  preserveSubmittedReceipt = false,
  preserveNamespace = true,
  resetReason = 'system',
}
```

These defaults preserve legacy `resetForm` credential behavior, clear answer-bearing and validation state, return draft lifecycle state to active, and retain the current browser namespace. `resetReason` must be a stable mutation reason and documents caller intent; it does not generate time or mutation IDs in the reducer.

Both reset paths clear responses, validation, touched, expanded, text validation metadata, UI draft state, and field-change metadata. Explicit preservation options control credentials, context, submitted receipt, and namespace.

`resetQuestionState` uses caller-provided main/auxiliary response keys plus exact validation, touched, expanded, text-metadata, and UI-draft scope keys. It deletes only those normalized keys. Later component migration will supply the complete lists for each question type.

No reset action creates or updates a server record.

## Selectors

`draftSelectors.js` exports selectors for every new state category, read-only status, safe diagnostics, and canonical projection.

`selectCanonicalDraftState` returns a typed result:

```js
{
  ok,
  state,
  errorCode,
  issues,
  safeDiagnostics,
}
```

On success, `state` is a valid normalized schema-v4 canonical state. On invalid untrusted preload data, `state` is null and diagnostics contain no values. The selector is memoized, does not mutate Redux, does not hash synchronously, and excludes Redux-only lifecycle diagnostics, namespace values, last-state hash, recovery material, and unknown fields.

`selectSafeDraftDiagnostics` returns only counts, presence flags, schema/status/revisions, byte size, lifecycle state names, storage mode, retry count, and read-only status.

## Legacy compatibility

The existing action signatures remain available:

- `loadInitialState`
- `setResponse`
- `setMultipleResponses`
- `deleteResponse`
- `setValidationStatus`
- `setMultipleValidationStatus`
- `setTouchedQuestion`
- `setExpandedQuestion`
- `setAllExpanded`
- `initializeExpandedQuestions`
- `setTextareaDirtyMeta`
- `setCredentials`
- `resetForm`

Current components are not switched to `applyFormMutation` in this batch. Legacy actions now validate their established payload shapes and reject unsupported/prototype-polluting/secret-bearing input while preserving current valid answer shapes.

## Security exclusions

Redux must never contain recovery codes or hashes, resume tokens or hashes, admin grants, Base44 access tokens, AWS credentials, raw error responses, stack traces, raw server records, or complete submission payloads. Action diagnostics contain counts and safe codes rather than values.

State hashes and namespace identifiers are not authorization. Client timestamps remain non-authoritative. Prototype-pollution keys are rejected before assignment.

## Component migration plan

Later batches will:

1. Move answer-bearing component-local editor state into scoped `uiDraftState` entries.
2. Replace related multi-dispatch component sequences with `applyFormMutation`.
3. Add browser persistence and server synchronization around canonical selector output.
4. Wire Clear All and submission lifecycle to backend transactions.

This foundation does not perform those integrations and therefore does not change current questionnaire UI behavior or submission payloads.
