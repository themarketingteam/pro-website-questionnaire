# Canonical Questionnaire Draft-State Contract

- Contract version: `4`
- Minimum supported canonical version: `2`
- Module: `src/lib/questionnaireDraftState.js`
- Form type: `pro-questionnaire`
- Status: recovery identity metadata connected to Redux and the namespaced browser-local cache; not connected to canonical Base44 saving, authorized server recovery, submission locking, or PDF regeneration

## Purpose and version boundary

Version 4 is the first complete canonical envelope shared by future browser persistence, Redux hydration, Base44 draft APIs, conflict handling, historical migration, Clear All, submission locking, submitted recovery, PDF regeneration, and blue-to-green migration.

The version is intentionally independent of:

- Redux Persist version 4;
- browser-storage key version 5;
- Base44 entity schemas;
- function/API revisions.

Historical browser normalization already identifies persisted v2/v3 state. Canonical version 4 wraps those recoverable maps with identity, lifecycle, revision, editor, mutation, submission, and compatibility metadata. A future canonical version is rejected as `UNSUPPORTED_FUTURE_VERSION`; a version below 2 is rejected as `UNSUPPORTED_LEGACY_VERSION`. Recognized v2 data migrates through v3 before v4.

## Canonical shape

```json
{
  "schemaVersion": 4,
  "formType": "pro-questionnaire",
  "draftId": "draft-synthetic-001",
  "sessionId": "session-synthetic-001",
  "draftStatus": "active",
  "clientRevision": 2,
  "serverRevision": 1,
  "savedAtClient": "2026-08-05T12:00:00.000Z",
  "savedAtServer": "2026-08-05T12:00:01.000Z",
  "sourceTabId": "tab-synthetic-1",
  "responses": { "6": "Synthetic company description" },
  "validationStatus": { "6": "complete" },
  "touchedQuestions": { "6": true },
  "expandedQuestions": { "6": true },
  "textValidationMeta": {
    "6": {
      "lastValidatedValue": "Synthetic company description",
      "isDirty": false
    }
  },
  "credentials": {
    "businessName": "Synthetic Business",
    "domain": "synthetic.example.test",
    "userId": "synthetic-user",
    "userEmail": "synthetic@example.test",
    "userName": "Synthetic User",
    "recoveryEmail": "synthetic@example.test"
  },
  "identityContext": {
    "identityContextVersion": 1,
    "recoveryEmailSource": "client_entered",
    "recoveryEmailVerificationStatus": "unverified",
    "identityAssociationIntent": "new_invitation",
    "anonymousRecoveryAcknowledged": false,
    "signedInvitationEmailChanged": false
  },
  "uiDraftState": {
    "/responses/12.1/editor/0": {
      "kind": "certification-editor",
      "version": 1,
      "data": { "name": "Synthetic certification" },
      "updatedAtClient": "2026-08-05T12:00:00.000Z",
      "sourceTabId": "tab-synthetic-1"
    }
  },
  "fieldChangeMetadata": {
    "/responses/6": {
      "operation": "set",
      "clientRevision": 2,
      "serverRevision": 1,
      "changedAtClient": "2026-08-05T12:00:00.000Z",
      "sourceTabId": "tab-synthetic-1",
      "mutationId": "mutation-synthetic-1"
    }
  },
  "currentQuestionId": "6",
  "lastChangedQuestionId": "6",
  "lastMutation": {
    "mutationId": "mutation-synthetic-1",
    "mutationType": "answer_changed",
    "reason": "questionnaire_edit",
    "changedAtClient": "2026-08-05T12:00:00.000Z",
    "sourceTabId": "tab-synthetic-1"
  },
  "submission": {
    "finalSubmissionId": null,
    "submittedAt": null,
    "submittedStateHash": null,
    "pdfSourceStateHash": null,
    "lastSubmissionErrorCode": null
  },
  "compatibility": {
    "sourceType": "canonical",
    "sourceVersion": 4,
    "migratedAtClient": null,
    "migrationWarnings": []
  }
}
```

The example is synthetic. Canonical values must not be logged.

## Field definitions

| Field | Contract |
| --- | --- |
| `schemaVersion` | Safe integer; normalized output is exactly 4. |
| `formType` | Nonempty string, default `pro-questionnaire`. Strict server normalization accepts only that value. Legacy server extraction always assigns it rather than trusting arbitrary record content. |
| `draftId` | String or `null`; immutable Base44 draft identifier when known. |
| `sessionId` | String or `null`; client/server questionnaire session identifier. |
| `draftStatus` | `active`, `submit_attempted`, `submit_failed`, `submitted`, `cleared_superseded`, `expired`, or `deleted`. Default `active`. |
| `clientRevision` | Nonnegative safe integer; default 0. It cannot globally order drafts. |
| `serverRevision` | Nonnegative safe integer; default 0. A future server API assigns authoritative increments. |
| `savedAtClient` | Valid ISO timestamp or `null`; explicitly non-authoritative. |
| `savedAtServer` | Valid ISO timestamp or `null`; authoritative only when supplied by the future server contract. |
| `sourceTabId` | Opaque non-PII identifier or `null`; restricted to alphanumeric, underscore, and hyphen characters. |
| `responses` | Plain object of current committed answer values. Serializable values and string content are preserved exactly. |
| `validationStatus` | Plain object whose values remain strings understood by current components; the contract invents no new validation state. |
| `touchedQuestions` | Plain object of strict boolean values. |
| `expandedQuestions` | Plain object of strict boolean values. |
| `textValidationMeta` | Plain serializable object preserving current textarea validation metadata. |
| `credentials` | Plain allowlisted object: `userId`, `userEmail`, `userName`, `businessName`, `domain`, compatibility alias `domainName`, and normalized `recoveryEmail`. Recovery email remains PII in credentials and is never copied into safe diagnostics. Unknown nonsecret keys are removed; secret-looking keys fail validation. |
| `identityContext` | Identity contract version, approved recovery-email source, verification state, association intent, anonymous-risk acknowledgement, and signed-email-change boolean. It contains no raw email, token, code, hash, or grant. Missing historical v4 metadata receives the safe `migrated_legacy`/`legacy_migration` default without changing schema version 4. |
| `uiDraftState` | Plain object keyed by scoped canonical path. Each value contains `kind`, positive `version`, serializable `data`, client timestamp, and opaque source-tab ID. Purely visual state is not intended for this map. |
| `fieldChangeMetadata` | Plain object keyed by canonical JSON Pointer path. Each entry contains an allowed operation, client/server revisions, non-authoritative client time, source-tab ID, and mutation ID. |
| `currentQuestionId` | String or `null`. |
| `lastChangedQuestionId` | String or `null`. |
| `lastMutation` | `null` or safe mutation ID/type/reason/client-time/source-tab metadata. |
| `submission` | Safe lifecycle metadata only: final submission ID, submission time, submitted/PDF source hashes, and a bounded error code. Full external errors are forbidden. |
| `compatibility` | Migration source type/version, client migration time, and safe warning codes. It never duplicates responses or mapped submission data. |

## Exported API

The module exports:

- `PRO_FORM_DRAFT_SCHEMA_VERSION`
- `PRO_FORM_DRAFT_SCHEMA_MIN_SUPPORTED_VERSION`
- `PRO_FORM_DRAFT_RECOMMENDED_MAX_BYTES`
- `DRAFT_STATE_ERROR_CODES`
- `DRAFT_STATE_SOURCE_TYPES`
- `DRAFT_STATE_STATUS_VALUES`
- `DRAFT_FIELD_OPERATIONS`
- `DraftStateValidationError`
- `DraftStateSerializationError`
- `isPlainDraftObject`
- `sanitizeDraftSerializableValue`
- `DEFAULT_DRAFT_IDENTITY_CONTEXT`
- `normalizeCanonicalDraftIdentityContext`
- `createEmptyCanonicalDraftState`
- `normalizeCanonicalDraftState`
- `validateCanonicalDraftState`
- `migrateCanonicalDraftState`
- `extractCanonicalStateFromLegacyRedux`
- `extractCanonicalStateFromLegacyDraftRecord`
- `serializeCanonicalDraftState`
- `parseCanonicalDraftState`
- `stableStringifyCanonicalDraftState`
- `hashCanonicalDraftState`
- `getCanonicalDraftStateByteSize`
- `compareCanonicalDraftFreshness`
- `areCanonicalDraftStatesCompatible`
- `cloneCanonicalDraftState`
- `getSafeCanonicalDraftDiagnostics`
- `buildCanonicalFieldPath`
- `normalizeFieldChangeMetadata`

All functions in this module remain framework-independent and require no Redux, React, Base44 client, storage API, or network access. Browser integration is defined separately in [Local canonical draft cache](./local-canonical-draft-cache.md).

## Serialization and rejected values

Strict serializability permits only:

- `null`;
- strings;
- booleans;
- finite numbers;
- arrays containing permitted values;
- plain objects containing permitted values.

It rejects, without value-bearing diagnostics:

- `undefined` in authoritative state;
- `NaN` and positive/negative infinity;
- BigInt, Symbol, and Function;
- Date unless a caller explicitly selects ISO normalization before canonical validation;
- RegExp, Map, Set, WeakMap, and WeakSet;
- Error and Promise;
- File, FileList, Blob, and ArrayBuffer;
- DOM nodes, Event, AbortController, and custom class instances, including prototype-bearing Google Places objects;
- accessor properties, sparse arrays, symbol properties, unsafe prototype keys, circular references;
- secret-bearing keys;
- structures above the configured maximum depth/property count.

`omitUndefined` applies only when explicitly selected for optional object properties. It never removes an array element. A rejected value is never silently replaced by `null`, `{}`, or a marker string.

`normalizeCanonicalDraftState` creates a new complete object and removes unknown top-level fields by default. `reportUnknownFields` records safe warning codes. `strictServer` rejects unknown fields and non-`pro-questionnaire` form types. `validateCanonicalDraftState` never throws for ordinary invalid input; it returns `{valid, issues, errorCode, safeDiagnostics}`.

## Stable serialization and parsing

Stable serialization:

1. normalizes the complete envelope;
2. sorts all object keys recursively;
3. preserves array order;
4. preserves response strings exactly;
5. emits compact UTF-8 JSON by default;
6. supports pretty output only as an explicit debug/test option.

`parseCanonicalDraftState` returns a typed result. It returns `state: null` on malformed/invalid input, so a caller cannot accidentally replace its last known good state. When a validated `lastKnownGoodState` is supplied, a deep clone is returned separately as `lastKnownGoodState`; it is never reported as a successful parse.

Unknown future versions are never normalized as version 4.

## Hash format and projection

`hashCanonicalDraftState` hashes the stable projection with SHA-256 through Web Crypto and returns 64 lowercase hexadecimal characters. Tests exercise both runtime Web Crypto and an injected Node Web Crypto provider. Missing Web Crypto returns the typed `CRYPTO_UNAVAILABLE` failure. A hash proves deterministic state equality only; it is not an authorization credential.

The hash projection includes answer-bearing and conflict-relevant state, including responses, validation, touched/expanded state, text metadata, credentials, all six identity metadata fields, UI draft state, field-change metadata, lifecycle status, revisions, source tab, question pointers, mutation metadata, and the final submission identifier.

It excludes exactly these irrelevant/self-referential fields:

- `savedAtClient`;
- `savedAtServer`;
- migration source/version/time/warnings in `compatibility` (replaced by a fixed canonical value);
- `submission.submittedStateHash`;
- `submission.pdfSourceStateHash`.

Changing only those fields does not change the hash. Changing a response does.

## Byte size

`getCanonicalDraftStateByteSize` uses `TextEncoder` over the stable UTF-8 serialization. It returns:

```json
{
  "bytes": 1234,
  "kilobytes": 1.205078125,
  "withinRecommendedLimit": true
}
```

The provisional recommendation is 750 KB (768,000 bytes). This module reports the threshold but does not enforce a final Base44 request/entity limit. Future backend APIs must enforce their reviewed transport and storage limits independently.

## Migration paths

### Redux Persist v2 and v3

- v2 adds the text-validation map and migrates explicitly through v3.
- v3 is wrapped in the v4 envelope.
- Responses, validation, touched, expanded, text metadata, and allowlisted credentials are handled independently.
- `_persist.version` selects `redux_persist_v2` or `redux_persist_v3` source metadata.
- Unknown legacy revisions remain 0; no server revision is invented.

### Legacy Redux and `loadInitialState`

The extractor accepts a direct form object, `{form}`, or `{state:{form}}`. It also accepts the current failure-backup `{sessionId,savedAt,form}` shape. Invalid noncritical maps produce safe warning codes without discarding a valid response map.

### Legacy Base44 `ProFormDraft`

The extractor independently parses:

- `responses_json`;
- `validation_status_json`;
- `touched_questions_json`;
- `expanded_questions_json`;
- `metadata_json`;
- `userdata_json`;
- `mapped_payload_json`;
- `draft_metadata_json`.

It maps current identifier/status/question/time/submission columns explicitly. Existing client-generated `last_saved_at` becomes non-authoritative `savedAtClient`; it is not promoted to server time. Current `draft` status maps to `active` with a warning. Server revision remains 0.

When exact `responses_json` is unavailable, known mapped submission/userdata fields can reconstruct the present questionnaire response keys. Exact response JSON always wins when available. Full mapped payloads, Base44 bookkeeping, raw submit errors, and duplicated response data are not retained in `compatibility`.

## Compatibility and freshness

Two states are compatible only when:

1. form types match;
2. both known draft IDs match; or
3. both draft IDs are absent and both known session IDs match.

One known draft ID and one missing ID are not enough. Different known draft IDs are incompatible even when business name or email matches. Credentials never authorize or establish identity compatibility.

Freshness comparison returns `{result, reason, compatible, requiresMerge}`. Result values are `a_newer`, `b_newer`, `equal`, `incompatible`, `diverged`, or `indeterminate`. The order is:

1. compatibility;
2. submitted-state protection;
3. server revision;
4. client revision;
5. server timestamp;
6. client timestamp as a final, explicitly non-authoritative hint;
7. stable hash;
8. divergence for equal ordering metadata with different hashes.

The module never merges automatically. A diverged result requires a future reviewed merge/conflict path.

## Safe diagnostics

Safe diagnostics may contain schema/status, revisions, identifier-presence booleans, map counts, byte size, warning count, error code, and an optional short hash prefix. They never contain response values, credentials, complete IDs, file URLs, tokens, mapped submission payloads, or recovery secrets.

Serialization and validation errors contain typed codes and sanitized paths only. They never interpolate the rejected value.

## Security limitations

- Canonical hashes and browser namespaces are not authorization credentials.
- This module does not issue, accept, hash, or persist recovery codes/tokens or administrative grants.
- Client timestamps and client revisions are not server authority.
- Client-side validation cannot replace future backend validation, authorization, rate limits, revision/CAS enforcement, or terminal submission guards.
- The canonical state contains sensitive questionnaire content and approved identity/display fields; it must be encrypted/routed/retained under the future server and migration contracts and must not be logged.
- Version 4 does not implement server restore, recovery email, OTP, magic links, Clear All transactions, submission locking, or Base44 schema changes.

## Future integration

Future Base44 APIs should validate strict-server canonical v4 input, assign server revision/time, compare the stable hash, enforce status transitions, and derive compatibility columns from canonical state. They must not trust client time, form type, identity compatibility, or a hash as authorization.

Future blue-to-green migration should parse each historical column independently, emit safe warnings, validate/hash the reconstructed v4 state, compare record counts and lifecycle fields, and write only through the reviewed idempotent migration protocol. A failed reconstruction must retain the source record and evidence; it must never overwrite the last validated destination state.

The contract is now consumed by Redux hydration and the browser-local cache. Current Base44 draft saving, entity schemas, submission, and PDF paths are unchanged, and no cloud action or deployment is part of this integration.
