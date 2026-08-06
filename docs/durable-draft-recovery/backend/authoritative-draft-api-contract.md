# Authoritative draft API contract

- Contract version: 1
- Implementation state: local bootstrap/load functions implemented and tested; deployment pending
- Public functions: source present, not deployed
- Deployment/entity push: not performed
- Current frontend persistence: unchanged

## Boundary

`ProFormDraft` remains the authoritative snapshot entity and
`ProFormDraftEvent` remains its audit-event entity. Future Base44 backend
functions must validate requests with `proDraftApi`, resolve authorization with
`proDraftAuthorizationResolver`, access entities only through
`proDraftRepository`, and return records only through `proDraftProjection`.

The repository accepts an already-created Base44 SDK client. It neither creates
a client nor authorizes a caller. Service-role access is therefore possible only
from a Base44 backend function that deliberately constructs and injects the
client. No public function or HTTP entrypoint is part of this change.

## Version and operations

Every request carries `apiVersion: 1`. Unknown or absent versions fail closed.
The operation names are:

| Operation | Purpose | Required authority |
| --- | --- | --- |
| `bootstrap_draft` | Resolve an existing authorized draft or create an empty draft | matching authority, or `new_anonymous_draft` with `draft:create` |
| `load_draft` | Load one exactly authorized draft | active `draft:read`; submitted `draft:submitted-read` |
| `save_draft` | Conditionally replace the authoritative canonical snapshot | `draft:write` |
| `append_events` | Append a deduplicated audit-event batch after snapshot handling | `draft:events`, or a recovery-session `draft:write` grant |

The authorization methods are `resume_token`, `signed_invitation`,
`recovery_session`, and `new_anonymous_draft`. The public access scopes are
`draft:read`, `draft:write`, `draft:submitted-read`, `draft:create`, and
`draft:events`.

Raw email, business name, domain, and user ID are context only. None is an
authorization credential or an entity lookup key.

## Request contracts

All request and nested-object keys are allowlisted. Unknown fields, unsupported
versions, invalid types, cycles, credential-bearing nested keys, and oversized
payloads are rejected. Authorization may contain exactly one of
`resumeToken`, `signedDraftAccessToken`, or `recoverySessionToken`. An empty
authorization object is accepted only as a new-draft bootstrap method.

### Bootstrap

```text
{
  apiVersion, idempotencyKey, authorization, clientContext,
  localStateSummary?, clientBootstrapToken?, testRunId?
}
```

`clientContext` contains only the versioned identity/association, display
context, tab/namespace/build identifiers, and environment named by the API
contract. `localStateSummary` contains schema/client revision, state hash, byte
size, and a recoverable-state boolean. A full canonical state is deliberately
not accepted by bootstrap: an empty server record is established first, then a
newer local canonical snapshot can be sent through `save_draft`.

No-email creation requires `anonymousRecoveryAcknowledged: true`. A client
entered recovery email must be explicitly identified as `client_entered`.
Bootstrap never searches by unsigned email. If a signed-invitation email is
changed, its context must use `changed_signed_email` and `unverified`, producing
a new association instead of inheriting signed verification.

`clientBootstrapToken` is an unpadded Base64URL value representing at least 256
bits of client-generated entropy. Its purpose-bound hash becomes the initial
resume verifier. Production bootstrap requires this value. A lost first
response can therefore be retried or resumed without creating a second draft,
although the server-generated recovery code cannot be reconstructed. On an
idempotent replay, raw credentials are omitted and
`recoveryCodeReissueRequired` is true. In staging/test/local, omission remains
supported for compatibility: the server generates a resume token and returns
it only on the successful create response.

### Load

```text
{
  apiVersion, authorization, requestedDraftId,
  includeCanonicalState?, upgradeLegacyOnLoad?, clientContext, testRunId?
}
```

`includeCanonicalState` defaults to true. `requestedDraftId` must equal the
verified authorization binding. A resume token matches only its stored verifier
record. A recovery session is exact-draft and scope bound. A signed invitation
queries only the derived verified identity-key hash. Submitted data requires
`draft:submitted-read` and is projected read-only.

`upgradeLegacyOnLoad` defaults to false. The current function rejects true:
legacy compatibility columns are reconstructed independently into a normalized
canonical response, malformed metadata does not discard valid responses, and
the read updates only `last_restored_at`. Durable record upgrades remain the
responsibility of later migration tooling.

### Save

```text
{
  apiVersion, authorization, draftId, expectedServerRevision,
  idempotencyKey, canonicalState, mappedPayload?, syncReason,
  requestedStatus, testRunId?
}
```

Canonical state is required and uses the shared canonical shape and byte limit.
Its optional `draftId` must equal the request draft ID, its `sessionId` is later
compared to the authorized record, and its status must equal
`requestedStatus`. `expectedServerRevision` and an idempotency key are required.
The sync-reason allowlist is `autosave`, `manual_save`, `bootstrap_upload`,
`submit_attempt`, `submit_failed`, `submitted`, `clear_all`, and `restore`.

`mappedPayload`, when present, must be plain JSON. Canonical and mapped payloads
are scanned recursively for authorization-bearing field names. Raw recovery
codes, tokens, grants, passwords, private keys, and client secrets are rejected.

### Append events

```text
{
  apiVersion, authorization, draftId, idempotencyKey,
  clientRevision, sourceTabId?, events, testRunId?
}
```

An event has exact allowlisted keys: `eventId`, `eventType`, optional question,
mutation, value/summary/count/client-time data, and plain metadata. `eventId` is
required and IDs must be unique within the batch. Value omission is valid.
Credential-bearing metadata is rejected.

Canonical state remains authoritative. Event failure does not undo an already
accepted snapshot; a future endpoint must report and retry event persistence as
a separate idempotent step.

## Limits and response policy

| Limit | Value |
| --- | ---: |
| General API request | 1 MiB, shared persistence limit |
| Canonical state | 750 KiB, shared persistence limit |
| Event request | 256 KiB |
| One serialized event | 32 KiB |
| Events per batch | 1–50 |
| Repository draft query | default 25, maximum 100 |
| Repository event query | maximum 500 |

`testRunId` is accepted only when the trusted runtime environment is `test` or
`staging`. It is rejected in production.

Every bootstrap/load response contains a safe server-generated request ID.
Success and error builders emit JSON with `Cache-Control: no-store, max-age=0`
and `Pragma: no-cache`. Authorization failures use a generic public message and
never echo authorization values or internal exception details.

## Authorization resolution

The resolver performs no email or recovery-code verification.

- Resume token: validate/normalize through the security primitive, HMAC with
  injected `PRO_FORM_DRAFT_TOKEN_SECRET`, query `resume_token_hash` with a
  maximum of two results, and require exactly one record.
- Signed invitation: verify signature/type/scope/environment/grant version,
  validate form and temporal claims, derive a hash from the verified invitation
  identity claims, and query only `identity_key_hash`. An absent match can create
  a new association only during bootstrap.
- Recovery session: verify the token before reading its exact draft, read the
  current record session version, then verify exact draft, method, grant,
  recovery-session version, environment, lifetime, and required scope.
- New anonymous draft: allow only `bootstrap_draft` with no requested draft.

Safe resolver diagnostics include method, scopes, a binding boolean, create
intent, and a bounded internal reason code. They contain neither credentials nor
hashes. Public failure is always `Authorization could not be verified.`

Public email recovery and recovery-code recovery are future integrations. Those
flows must authenticate their proof separately and issue a scoped recovery
session; they must not add email/code verification to this resolver.

## Implemented bootstrap/load boundary

`bootstrapProFormDraft` and `loadProFormDraft` use the Base44 zero-config
`Deno.serve` convention and `createClientFromRequest`. Both are guarded by the
strict backend environment, V2 server flag, and kill switch before a client is
created. They accept POST JSON only, enforce the shared one-MiB request limit,
never log the request body, and return no-store responses.

Bootstrap resume-token lookup uses only `resume_token_hash` and applies the
canonical duplicate selector. Signed invitations verify temporal,
environment, form, and visible identity bindings before querying only
`identity_key_hash`; changed signed email never queries the replacement email
and is stored as a new unverified association without an identity key.
Recovery sessions remain exact-draft and scope bound. Unsigned email is never
an authorization or lookup input.

New records receive a secure session ID, one-time recovery code and hint,
purpose-bound recovery/resume/idempotency hashes, empty canonical state plus
compatibility columns, zero revisions, active status, generation one,
environment/test isolation metadata, recovery-session/status/retention
versions, and a one-year server-time retention expiry. Raw code/token material
is never written to any entity field. See
[bootstrap and load flow](bootstrap-and-load-flow.md).

## Repository contract

The repository uses only:

- `base44.asServiceRole.entities.ProFormDraft`
- `base44.asServiceRole.entities.ProFormDraftEvent`
- verified SDK methods `filter`, `get`, `create`, `update`, `updateMany`, and
  `bulkCreate`

It does not use `find`, `findOne`, `insert`, `remove`, or unbounded `list`.
Lookup functions bind a single allowlisted hash field. Event lookup additionally
binds `draft_id`. Returned records are never logged, and SDK exceptions are
converted to safe internal repository codes.

### Conditional update requirement

`conditionalUpdateDraftRecord` performs one `updateMany` whose query contains
the draft ID, expected `server_revision`, and expected non-regressed status when
supplied. The mutation uses the Base44-supported `$set` and `$inc` operators,
setting the accepted state hash/status and incrementing `server_revision` once.

Exactly one updated record is required. Zero is a conflict, missing record, or
status mismatch. More than one, or an unrecognized result shape, produces
`BLOCKED_BASE44_CONDITIONAL_UPDATE_UNSUPPORTED`. After an accepted count, the
repository re-reads by ID and verifies expected revision plus one, accepted
state hash, and accepted status. Any mismatch fails closed. There is no
get-then-unguarded-update fallback.

Live staging certification must prove Base44 `updateMany` query matching and
operator/count semantics under concurrent requests. The public API deployment
must stop if that proof fails.

## Idempotency storage

Five optional admin-FLS `ProFormDraft` fields support retries:

- `bootstrap_idempotency_key_hash`
- `last_save_idempotency_key_hash`
- `last_save_request_id`
- `last_event_batch_idempotency_key_hash`
- `last_event_batch_request_id`

Future functions will HMAC idempotency keys with the separately configured
`PRO_FORM_IDEMPOTENCY_SECRET`. This change does not configure that secret. Raw
idempotency keys are never stored. Bootstrap checks its keyed hash before create;
save and event retry decisions compare their latest accepted keyed hashes and
safe request IDs.

## Safe projections

Active, submitted, summary, and administrative projections use explicit
allowlists. Active records can include safe IDs, canonical state, revisions,
state hash, save time, email-presence/verification state, non-authorizing code
hint, generation links, and `readOnly: false`. Submitted records add final
submission ID, submitted time, PDF source state hash, and `readOnly: true`.

The following are omitted from ordinary client and administrative projections:
email lookup hash, recovery-code hash, resume-token hash, identity-key hash, all
idempotency hashes, migration source app ID, AI repair raw diagnostics, and all
other non-allowlisted admin fields. Raw recovery email is omitted unless an
explicitly authorized UI projection requests it. A recursive assertion guards
both snake_case and camelCase sensitive field names.

## Legacy compatibility and rollout

The five schema fields are optional. `session_id` remains the only required
`ProFormDraft` field; entity-level RLS is unchanged. Current browser
`filter/create/update` and event-create paths are intentionally left operational
until a separately certified migration changes them. Draft V2 remains disabled.

Before any public functions are created, staging certification must prove:

1. schema fields and admin FLS in the staging app;
2. bootstrap retry deduplication;
3. conditional update count and post-read semantics under concurrency;
4. exact resume/invitation/recovery-session binding and scope denial;
5. canonical round-trip and active/submitted projections;
6. event batching/deduplication and snapshot independence;
7. no-store/request-ID envelopes and recursive sensitive-field scans;
8. test-run isolation and no production data/external side effects.
