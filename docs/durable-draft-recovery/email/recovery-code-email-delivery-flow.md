# Authorized Recovery-Code Email Delivery Flow

- Status: **SOURCE_IMPLEMENTED_NOT_DEPLOYED**
- Date: 2026-08-06
- Function: `sendProFormDraftRecoveryCodeEmail`
- General “email me this code” control: **NOT IMPLEMENTED**
- Email sent by this prompt: **NO**

## Purpose and boundary

The backend function delivers the raw recovery code that a caller still holds
immediately after Clear All or Start New. The server cannot reconstruct that
random code from its stored HMAC. The code therefore exists only in the caller
and function process memory long enough to normalize, verify, render, and send
it. It is never stored in a draft/event, logged, or returned.

Allowed purposes are exactly:

1. `clear_all_replacement`
2. `start_new_after_submission`
3. `staging_self_check`

`manual_resend` and arbitrary purposes are rejected. No route, button, Redux
action, automatic browser persistence, or public general-send surface was
added. Later Clear All/Start New controllers may call the client helper only
while they still hold both the new code and exact-draft authorization.

## Request and authorization

The endpoint accepts only POST JSON up to 32 KB with these exact fields:
`apiVersion`, `authorization`, `draftId`, `recoveryCode`, `purpose`,
`idempotencyKey`, and optional nonproduction `testRunId`. Recipient, sender,
subject, HTML, and SES-region fields are unknown fields and are rejected.

Clear All and Start New require an exact-draft recovery-session token with
`draft:write`. The authorization resolver re-verifies environment, draft ID,
session hash, session version, grant version, and scope. Clear All additionally
requires an active generation greater than one, `previous_draft_id`, and a
previous `cleared_superseded` record that points to the new draft with a Clear
All reason. Start New requires an active new draft linked bidirectionally to a
submitted previous draft.

`staging_self_check` accepts no public recovery token. It requires the staging
environment plus an authenticated Base44 admin/app owner. It is rejected in
production. Every purpose still requires a valid stored recovery email and a
matching recovery code.

## Code verification and recipient

The function normalizes the submitted code, HMACs it with
`PRO_FORM_RECOVERY_CODE_SECRET`, timing-safely compares it with the exact
draft’s `recovery_code_hash`, and requires the current recovery-code version.
A mismatch returns the generic `RECOVERY_EMAIL_DELIVERY_DENIED`; it does not
increment public recovery abuse counters.

Only the draft’s `recovery_email` is normalized and supplied to the transport.
No request recipient is accepted. Staging transport replaces that intended
address with `STAGING_EMAIL_REDIRECT_TO`; production uses it only after all
authorization checks. Missing or invalid stored email returns
`RECOVERY_EMAIL_UNAVAILABLE` while leaving the draft and recovery hash valid.

## Idempotency, concurrency, and retry

The raw idempotency key is validated and then purpose/draft-bound with HMAC
using `PRO_FORM_IDEMPOTENCY_SECRET`. Only the hash is stored.

- Same hash/purpose with `sent`: idempotent success; SES is not called again.
- Same raw key reused for a different purpose: conflict.
- Same hash with `failed`: retry only after backoff and below the maximum.
- `attempting` or uncertain delivery: no blind retry.
- Different key: a new authorized attempt only while the draft-wide maximum
  has not been reached.

`PRO_DRAFT_RECOVERY_EMAIL_MAX_ATTEMPTS` defaults to 3 and is clamped to 1–10.
`PRO_DRAFT_RECOVERY_EMAIL_RETRY_SECONDS` defaults to 30 and is clamped to
1–3,600 seconds. Backoff uses the server-updated draft timestamp.

The attempt claim uses the draft’s built-in `updated_date`, lifecycle status,
and `server_revision` as a compare-and-set condition. It updates only the eight
delivery fields. It never increments `server_revision`, changes lifecycle
status, or writes canonical state, so two concurrent requests cannot both
claim the same observed draft version.

## Metadata and ambiguous delivery

Before SES, the function records `attempting`, increments the attempt count,
and writes purpose, keyed idempotency hash, request ID, and empty prior error/
provider fields. Success records `sent`, server time, bounded provider message
ID, and clears the safe error string. Failure records `failed` and a bounded
safe code while preserving the active draft, recovery hash, and attempt count.

If SES confirms delivery but the final metadata compare-and-set fails, the
function returns `delivered=true`, `deliveryUncertain=true`, status
`delivery_uncertain`, and `canRetry=false`. It attempts a safe operational
event and never blindly retries a possibly delivered message. Provider IDs,
recipient addresses, AWS failures, and exceptions are absent from the public
response.

## Events

The function appends these admin/backend events:

- `recovery_email_attempted`
- `recovery_email_sent`
- `recovery_email_failed`
- `recovery_email_delivery_uncertain`

Event metadata contains only purpose, attempt number, redirected boolean,
bounded provider status, request ID, optional synthetic test-run ID, and a safe
error code. It contains no raw/normalized email, recovery code, body, provider
message ID, credential, token, or provider exception. Events preserve the
draft’s current server revision rather than creating a canonical revision.

## Client integration points

`src/lib/proDraftRecoveryEmailClient.js` exposes `sendRecoveryCodeEmail`,
`retryRecoveryCodeEmail`, safe error normalization, and diagnostics. It invokes
only `sendProFormDraftRecoveryCodeEmail`, admits only the server request-field
allowlist, and projects a strict public response. It has no storage or Redux
dependency and performs no automatic retry. A later Clear All controller may
invoke it after durable creation/supersession succeeds; a later Start New
controller may invoke it after the new-to-submitted relationship is durable.
Email failure must be presented separately and must never roll back the new
draft.

## Deployment blockers

The function, schema, and site were not deployed. Before activation, all SES
account/sender/IAM/bounce/complaint blockers in the transport contract remain,
the eight entity fields must be safely pushed and FLS-certified in staging,
Base44 compare-and-set semantics must be live-tested, the real internal redirect
must be configured outside Git, and Clear All/Start New controllers need a
separately reviewed integration and user-facing failure policy.

## Source validation on 2026-08-06

No SES message, Base44 deployment, schema push, production mutation, or remote
Git push was performed during this validation.

- `npm ci`: passed; npm reported 29 dependency audit findings (1 low, 8
  moderate, 18 high, and 2 critical) and six package build-script warnings.
- Focused delivery/client and prerequisite suites: 161 of 161 tests passed
  across 11 files; the two new delivery suites contributed 26 passing tests.
- Entity-schema plan suite: 22 of 22 tests passed, with the expected field
  counts (`ProFormDraft=64`, `ProFormDraftEvent=25`, `ProFormSubmission=16`,
  `ProFormSubmissionIntake=18`).
- Full `npm test`: 1,315 of 1,320 tests passed across 80 passing and 2 failing
  files. The five failures are pre-existing questionnaire/storage coercion
  expectations outside this change; the new delivery suites passed.
- `npm run lint`: failed with 32 errors and 17 warnings in pre-existing
  frontend files; none of the new or modified delivery files was reported.
- `npm run typecheck`: failed with 240 existing project errors; no error path
  matched a new delivery file. Direct TypeScript checking of the shared
  delivery and repository modules passed. The Base44 function entry uses the
  platform `npm:` import and `Deno` runtime globals, which the repository's
  direct local TypeScript invocation does not resolve.
- `npm run build`: passed, with browser-data freshness warnings only.
- Safety scans found no tracked/untracked log capture, no delivery-module
  logging, and no general UI import of the delivery client. The two fixture
  matches for a formatted recovery code and email are pre-existing approved
  fixtures; no fixture was changed.
