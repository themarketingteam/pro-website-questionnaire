# Bootstrap and authorized load flow

Status: implemented locally; not deployed. Durable draft V2 remains disabled.

## Bootstrap decision tree

1. Create a safe request ID, require a recognized environment, require the V2
   server flag, and reject when the kill switch is active.
2. Require POST plus JSON, read at most one MiB, and validate the exact v1
   request contract before creating the Base44 client.
3. If a resume token is supplied, hash it, select the canonical matching record,
   enforce lifecycle state, update only `last_restored_at`, and return no new
   credentials.
4. If a signed invitation is supplied, verify signature, environment, expiry,
   form type, and visible identity bindings. A current unchanged invitation
   queries only its derived identity key. `new_draft` or changed signed email
   creates a new record; the changed email is unverified and is never searched.
5. If a recovery session is supplied, verify its exact draft, current session
   version, environment, and scopes. No email lookup occurs.
6. Otherwise, require the no-email acknowledgement or an explicit
   client-entered email association, then perform keyed idempotency lookup and
   create one empty recoverable record.

Cleared/superseded, expired, and deleted records return controlled lifecycle
errors rather than being projected active. Submitted records are read-only.

## Idempotency and one-time credentials

The server HMACs `idempotencyKey` with `PRO_FORM_IDEMPOTENCY_SECRET` and stores
only `bootstrap_idempotency_key_hash`. A matching retry returns the same draft
and never reissues the original server-generated values. When a client
bootstrap token was used, replay must present the same token so its stored
resume verifier also binds the idempotency result.

Production requires `clientBootstrapToken`, an unpadded Base64URL value with at
least 256 bits of entropy. Only its resume-token HMAC is stored. The client can
retain/reuse that raw token if the first response is lost. The recovery code is
server-generated and non-reconstructable, so replay returns
`recoveryCodeReissueRequired: true`. When the server generates a resume token
in non-production compatibility modes, it is returned only on the create
response. The recovery code is likewise returned only on create. Neither raw
value appears in entity data, logs, ordinary projections, fixtures, or errors.

## New record

Creation validates the entire record before the entity create call. It includes
session ID, active status, generation one, zero revisions, recovery-code
hash/version/hint, resume-token hash, recovery-session and status versions,
idempotency hash, environment, optional staging test-run ID, one-year retention
expiry, and optional recovery email plus keyed lookup hash. Client-entered email
is `unverified`; unchanged verified invitation email may receive the verified
identity key. Compatibility JSON is generated with the shared builder from a
validated empty schema-v4 canonical state and safe `{metadata, userdata}`
mapped payload.

After Base44 assigns the ID, bootstrap binds it into canonical state without
incrementing either revision. This initialization update does not represent a
client save.

## Authorized load

Load requires `requestedDraftId` and one resume, signed-invitation, or
recovery-session token. Authorization must resolve that exact ID. Active,
submit-attempted, and submit-failed records require read scope and expose
`canWrite` only when write scope is present. Submitted records require
`draft:submitted-read`, set `readOnly: true`, and expose `canWrite: false`.
No separate save token is issued.

For a legacy record without `draft_state_json`, each compatibility JSON column
is parsed independently. Valid response data survives malformed metadata. The
normalized schema-v4 state and safe migration warning codes are returned only
in the response. `upgradeLegacyOnLoad` is false by default and true is rejected;
read-time migration never overwrites the record.

## Safe failures and non-goals

Public errors use the controlled codes `FEATURE_DISABLED`, `INVALID_REQUEST`,
`INVALID_AUTHORIZATION`, `DRAFT_NOT_FOUND`, `DRAFT_SUPERSEDED`,
`DRAFT_EXPIRED`, `DRAFT_DELETED`, `SUBMITTED_SCOPE_REQUIRED`,
`IDEMPOTENCY_CONFLICT`, `CANONICAL_STATE_ERROR`, `DRAFT_CREATE_FAILED`, and
`DRAFT_LOAD_FAILED`. Messages do not reveal whether an arbitrary token or email
exists, and all responses are no-store.

This implementation adds no public email recovery, recovery-code exchange,
OTP, magic link, frontend flow change, flag enablement, schema push, or deploy.
