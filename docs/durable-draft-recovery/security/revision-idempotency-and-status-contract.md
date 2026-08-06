# Revision, idempotency, and status contract

- Contract version: `1`
- Module: `base44/functions/_shared/proDraftPersistence/entry.ts`
- Canonical draft schema: `4`
- Deployment status: local shared source and save/event API integration only; no Base44 resource is deployed by this contract

## Scope and boundary

This module supplies runtime-neutral persistence safety primitives. The local
`saveProFormDraft` and `appendProFormDraftEvents` functions now authenticate and
authorize the exact operation before using an authorized conflict projection or
persisting compatibility columns. The primitive itself still performs no SDK
call, entity mutation, environment lookup, logging, authorization, or network
request.

The server revision is authoritative. A client revision records monotonic client intent within its coordinated draft stream, but it is not a global ordering source and cannot overrule a newer server record. Client or server timestamps never decide whether a write is accepted.

## Revision model

Revisions are nonnegative safe integers. A new draft may start with client revision `0` or `1`; its first accepted state-changing write produces server revision `1`. Every later accepted state-changing write increments the stored server revision exactly once. An idempotent repeat returns the stored server revision unchanged.

`evaluateRevisionWrite` receives stored and incoming client/server revision data, state hashes, statuses, and idempotency keys. It returns one of these decisions:

| Decision | Meaning |
| --- | --- |
| `accept` | Higher valid client revision, expected server revision matches, and lifecycle transition is allowed |
| `idempotent_success` | Same revision/hash, or the same stored idempotency key/hash, represents an exact repeat |
| `reject_stale_client_revision` | Incoming client revision is lower than the stored client revision |
| `reject_server_revision_mismatch` | Expected server revision differs and the request is not an exact repeat |
| `reject_same_revision_different_hash` | Equal revision has different state, or one idempotency key was reused for different state |
| `reject_status_transition` | Lifecycle transition is prohibited or terminal-state identity is not preserved |
| `reject_invalid_revision` | A revision or state hash is structurally invalid, including a new draft starting above revision `1` |

The result also supplies a safe reason code, `idempotent`, `conflict`, `nextServerRevision`, and `statusTransitionAllowed`.

Evaluation order protects terminal state first. A submitted, cleared/superseded, expired, or deleted record cannot be revived by presenting an older client revision. Lower revisions then fail as stale. Exact repeats succeed without increments. Equal revision with different state conflicts. A non-idempotent higher revision must pass lifecycle and expected-server checks before acceptance.

State equality uses a previously computed 64-character lowercase SHA-256 canonical state hash. The hash indicates equality, not authorization. The module does not use timestamps to accept or reject a write.

## Idempotency and mutation identifiers

Idempotency keys and mutation IDs must be strings from 16 through 128 characters using only ASCII letters, digits, `_`, `-`, `.`, and `:`. They are not trimmed or normalized. Whitespace, `@`, slashes, and other characters fail closed.

Keys must be generated as opaque non-PII identifiers. They must not be derived from an email, recovery code, answer, user ID, or other client identity. Full keys are never suitable for logs. Safe diagnostics may expose only the first 12 hexadecimal characters of a one-way SHA-256 fingerprint.

The same revision and state hash is idempotent even if a retry carries a different valid key. A matching stored key and hash is also an exact repeat. Reusing a stored key for different state is a conflict.

## Lifecycle normalization

Canonical statuses are:

- `active`
- `submit_attempted`
- `submit_failed`
- `submitted`
- `cleared_superseded`
- `expired`
- `deleted`

Legacy `draft`, blank, `null`, and missing legacy status normalize to `active`. Recognized statuses remain unchanged. An unknown status is invalid; the reserved `migrationMode` option does not grant an undocumented transition.

## Status state machine

| From | Allowed target | Conditions |
| --- | --- | --- |
| New | `active` | Only initial state |
| `active` | `active`, `submit_attempted`, `cleared_superseded`, `expired` | Normal lifecycle rules |
| `submit_attempted` | `submit_attempted`, `submitted`, `submit_failed` | Normal lifecycle rules |
| `submit_failed` | `submit_failed`, `submit_attempted`, `cleared_superseded`, `expired` | Normal lifecycle rules |
| `submitted` | `submitted` | Exact idempotent repeat preserving submission identity only |
| `cleared_superseded` | `cleared_superseded` | Exact idempotent metadata completion only |
| `expired` | `expired` | Terminal self-transition only |
| `deleted` | `deleted` | Terminal self-transition only |

Every other edge is prohibited. In particular, submitted records cannot return to an editable or clearable state; cleared records cannot be reactivated by stale autosave; expired records cannot become active; and deleted records cannot transition elsewhere. The module does not rewrite stored legacy status.

## Request validation and limits

`readBoundedJsonBody` requires `POST` and a JSON media type by default. It accepts `application/json` and structured `application/*+json` types. A future function may require another method explicitly.

| Boundary | Default | Override rule |
| --- | ---: | --- |
| API request body | 1,048,576 bytes (1 MB) | A function may choose a smaller positive limit |
| Canonical draft state | 768,000 bytes (750 KB) | A function may choose a smaller positive limit |

The reader validates `Content-Length` when present and rejects an excessive declared length before reading. It also reads the body as bounded byte chunks, so a missing or false header cannot bypass the hard limit. Limits count UTF-8 bytes, not JavaScript string length. Empty, malformed, invalid-UTF-8, consumed/failed, or aborted bodies produce value-free typed failures. The body and answers are never echoed or logged.

Request failures map to `400` malformed/aborted input, `405` wrong method, `413` oversized input, or `415` unsupported media type.

## Conflict behavior

`buildSafeConflictProjection` returns only:

- draft ID;
- a 12-character session-hash fingerprint when available;
- normalized status;
- client and server revisions;
- valid state hash; and
- server save timestamp.

Canonical state is omitted by default. `includeAuthorizedCanonicalState: true` is an explicit assertion by the future caller that exact-draft access has already been authorized. Even then, the state must pass strict schema/serialization checks. Recovery email/hash fields, recovery codes, resume tokens, migration source app IDs, authorization grants, and raw token material are never projected.

## Duplicate-draft selection

`selectCanonicalDuplicateDraft` is deterministic and does not mutate or mark records. It normalizes legacy statuses, excludes invalid records, partitions submitted and unsubmitted records, and never merges their answer state.

If any submitted candidate exists, selection stays within the submitted partition to preserve terminal state. Otherwise it uses the active-like partition (`active`, `submit_attempted`, `submit_failed`). Terminal/superseded records are fallback candidates only when no submitted or active-like record exists.

Within the chosen partition the order is:

1. highest valid server revision;
2. highest valid client revision;
3. latest valid `last_saved_at`/`saved_at_server`;
4. latest Base44 `updated_date`;
5. latest Base44 `created_date`; and
6. descending stable record ID as the final deterministic tie-breaker.

The timestamp fields only break duplicate-selection ties after both revisions. They never authorize a write. The result contains a selected record, all other candidates as `supersededCandidates`, and value-free warning codes. It performs no Base44 update.

## Canonical serialization and compatibility columns

The module validates the complete canonical schema-v4 top-level shape and uses recursive key-sorted compact JSON. Arrays preserve order. Only finite JSON primitives, arrays, and plain data objects are accepted. Circular references, accessors, special objects, unsafe prototype keys, unsupported values, and authorization-bearing fields fail closed. Serialization failure is never replaced with `{}`.

`buildDraftCompatibilityColumns` accepts the already validated mapped payload; it does not call or port `transformResponsesToPayload`. It preserves the mapped payload structure and returns these existing `ProFormDraft` projections:

- `responses_json`
- `validation_status_json`
- `touched_questions_json`
- `expanded_questions_json`
- `text_validation_meta_json`
- `ui_draft_state_json`
- `field_change_metadata_json`
- `credentials_json`
- `draft_state_json`
- `metadata_json`
- `userdata_json`
- `mapped_payload_json`
- `current_question_id`
- `last_changed_question_id`
- `draft_schema_version`
- `client_revision`
- `server_revision`
- `state_hash`
- `source_tab_id`
- `last_sync_reason`

The supplied state hash must be lowercase SHA-256 hexadecimal. The reason and source-tab ID are bounded non-PII values. Raw token, code, secret, authorization-grant, session-hash, or recovery-lookup fields are rejected rather than copied into canonical or compatibility JSON.

## Safe responses, errors, and diagnostics

Every JSON response adds:

```text
Cache-Control: no-store, max-age=0
Pragma: no-cache
Content-Type: application/json
```

Safe error bodies contain exactly `success: false`, stable `errorCode`, a generic message, `requestId`, and `retryable`. They never contain stack traces, Base44/provider error bodies, submitted answers, credential-bearing URLs, or exception text. Status mappings preserve only the public category.

Server request IDs use 256 bits from Web Crypto through the shared security module and the nonsecret `pdrq_` prefix. They contain no identity and are safe for correlation, but provide no authorization. Tests can inject a deterministic generator.

Safe diagnostics expose public bounds, normalized status, revisions, decision, stable error code, valid request ID, record count, selection presence, and an optional one-way idempotency-key fingerprint. They omit draft answers, PII, full keys, hashes used for recovery, tokens, and record contents.

## Submitted protection

Submission is terminal. A submitted self-update succeeds only when revision/state identity makes it an exact idempotent repeat. A changed hash, changed status, or stale client write cannot alter it. Clear All is not an allowed submitted transition. Later submission code must additionally compare final submission identity and submitted/PDF source hashes before any terminal metadata completion.

## Save/event API integration

The local save/event APIs now:

1. authenticate and authorize the exact draft before reading or mutating it;
2. parse through the bounded reader before using request data;
3. validate idempotency and mutation IDs before lookup or logging;
4. compute canonical state/hash using the reviewed schema contract;
5. load the current record and evaluate revision/status under an atomic or compare-and-set write boundary;
6. persist the returned next server revision and compatibility columns exactly once;
7. return exact-draft canonical conflict state only after authorization;
8. append bounded audit events and use request/key hashes rather than raw authorization values; and
9. apply separately documented migration rules before enabling any `migrationMode` transition.

The save repository path uses only a guarded `updateMany` `$set`/`$inc` update,
requires exactly one changed row, and verifies the post-read. Event appends are
separate, ID-deduplicated writes and do not advance snapshot server revision.
Local mocks cover the race contract, but live Base44 atomicity and event
uniqueness remain mandatory staging blockers. No deployment, schema push,
secret setting, frontend enablement, or feature enablement is part of this
change.

## Test coverage

`src/test/proDraftPersistence.test.js` enumerates the complete new/recognized status matrix, conditional terminal self-transitions, every revision decision, new-draft revision conventions, idempotency-key reuse, request method/media/declared and streaming limits, malformed/aborted/multibyte bodies, canonical size/serialization, active/submitted/legacy duplicate selection, safe and authorized conflict projections, all 20 compatibility columns, response headers/error mapping, secure request IDs, diagnostics PII exclusion, and the runtime-neutral boundary. `saveProFormDraft.test.js`, `appendProFormDraftEvents.test.js`, and `proDraftSaveEvents.integration.test.js` cover the authoritative integration, including conditional-count/post-read failures, exact retries, terminal submission, bounded event deduplication, and concurrent local writes.
