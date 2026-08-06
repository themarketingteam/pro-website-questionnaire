# Authoritative save and event API flow

- Source state: implemented and locally tested
- Base44 deployment: not performed
- Schema/flag/frontend changes: none
- Live atomicity certification: mandatory before release

## Save flow

`saveProFormDraft` creates a request ID, enforces the backend runtime flag and
kill switch, bounds and validates the POST/JSON body, resolves the exact draft,
and requires `draft:write`. Raw email is never a credential or lookup key.
Resume tokens resolve only their stored verifier, signed invitations resolve a
verified identity association, and recovery sessions remain exact-draft and
scope bound.

The function reconstructs a normalized canonical state for a legacy record
when necessary. The incoming schema-v4 state must bind to the authorized draft
ID, stored session ID, form type, requested status, and expected server
revision. `canonicalState.clientRevision` is the request's client revision; the
API deliberately has no second client-revision field. The shared serializer
rejects non-JSON/class instances, accessors, cycles, authorization fields, and
states over 750 KiB before any write. The server calculates the canonical hash.

Revision evaluation produces one of three public outcomes:

- An exact revision/hash repeat, or matching last-save idempotency hash plus
  the same state, returns the current accepted revisions/hash/status without a
  write.
- Stale client revision, server-revision mismatch, or equal revision with a
  different hash returns HTTP 409 with `mergeRequired: true` and the authorized
  canonical conflict projection.
- A valid newer state builds the full canonical and compatibility projection
  and enters the conditional update.

## Atomic conditional update

The repository uses `ProFormDraft.updateMany` with a query containing `id`,
`server_revision`, and current `status`. Its update uses `$set` for the complete
canonical snapshot, compatibility columns, accepted client/hash/status/sync
metadata, hashed idempotency key, request ID, and server timestamps, with
`$inc: { server_revision: 1 }`.

Exactly one updated row is required. Zero is re-read and returned as a conflict;
more than one, an unsupported result shape, or a failed post-read verification
is a deployment blocker. There is no unguarded-update fallback. The verified
post-read must contain expected revision plus one, the accepted state hash, and
the accepted status.

## Submitted and terminal protection

Editable records support `active`, `submit_attempted`, and `submit_failed`
transitions defined by the shared state machine. A transition to `submitted`
is allowed only from `submit_attempted` and requires a final submission ID,
submission timestamp, and submitted/PDF hashes equal to the server-calculated
snapshot hash. Those values and the status-lock timestamp are written with the
same conditional update. Submitted resume/invitation grants project as
submitted-read only and cannot write. Superseded, expired, and deleted records
cannot reactivate.

## Event append flow

`appendProFormDraftEvents` independently validates a 1–50 event batch capped at
256 KiB, with each event capped at 32 KiB. It resolves the exact draft and
requires `draft:events` or `draft:write`, then queries existing event IDs and
bulk-creates only missing rows. A batch idempotency key is purpose-bound with
`PRO_FORM_IDEMPOTENCY_SECRET`; the draft stores only the hash and safe request
ID as diagnostics.

Canonical state remains the authority. Event append does not change canonical
JSON, state hash, lifecycle status, client revision, or server revision. Values,
when present, are deterministically serialized and hashed. Raw file bytes,
authorization material, recovery material, and full email metadata are
rejected; safe URL/file metadata may be represented as plain JSON. Bulk-create
failure never reports events as accepted. A failed event append after a save
does not roll back the accepted snapshot and can be retried by event ID.

## Responses and live staging blocker

Success, conflict, and error responses use `Cache-Control: no-store,
max-age=0` and `Pragma: no-cache`. They do not expose verifier hashes,
idempotency hashes, tokens, recovery codes, or provider errors.

Local mocked integration tests prove the code's compare-and-set contract: for
two concurrent saves at one expected revision, one succeeds and one conflicts;
the winner retries idempotently; a submitted transition blocks a delayed active
save; and event append leaves server revision unchanged. This does **not** prove
live Base44 atomic behavior or event-ID uniqueness. Release remains blocked
until a staging deployment verifies current SDK `updateMany` operator syntax,
updated-count semantics, concurrent service-role behavior, post-read
consistency, event deduplication/uniqueness, entity permissions, and safe
network/log output.
