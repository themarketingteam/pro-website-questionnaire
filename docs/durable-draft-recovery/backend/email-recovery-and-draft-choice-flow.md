# Email recovery and draft-choice flow

- Status: source implemented and locally tested; not deployed
- Date: 2026-08-06
- Policy: exact normalized email is sufficient; mailbox ownership is not verified
- Functions: `recoverProFormDraftByEmail`, `listProFormDraftRecoveryChoices`, and `selectProFormDraftRecoveryChoice`

## Accepted privacy risk

The initial release policy deliberately allows a person who knows the exact client email to recover the newest eligible questionnaire associated with that email. The service does not send a message, challenge the mailbox, or describe the address as verified. This is an accepted privacy risk, not proof of identity or mailbox ownership. Mandatory rate limits, CAPTCHA escalation, temporary lockout, response timing, generic failures, purpose-separated hashes, and security events reduce abuse but do not remove that risk.

Public email recovery must remain behind the durable-draft and public-email-recovery runtime gates. OTP or magic-link ownership verification can replace the initial proof step later without changing the exact-draft load contract: a verified flow would derive the same lookup hash, select an eligible draft, and issue the same bounded recovery-session type under a new verified authorization method or policy version.

## Normalization and lookup

The endpoint accepts POST JSON up to 32 KB and rejects caller-supplied draft IDs, lookup hashes, verification overrides, invitation tokens, and unknown fields. Email input is NFC-normalized, trimmed, checked for one `@`, length and domain-label constraints, lowercased for lookup, and converted to an ASCII/punycode domain. Normalization never changes verification status.

The normalized value exists only for request processing. `PRO_FORM_EMAIL_LOOKUP_SECRET` creates a purpose-separated keyed lookup hash; raw and normalized email are excluded from tokens, safe diagnostics, logs, security events, and responses.

## Abuse-control order

After request ID creation and runtime/request validation, the function reads trusted network context, normalizes the email, derives purpose-separated abuse hashes, and evaluates global, IP, email-subject, lockout, and CAPTCHA policy before draft lookup. A successful recovery is returned only after its security event is durably recorded; a success-event write failure fails closed. All outcomes receive the configured minimum response delay and bounded jitter.

Failures use the generic `RECOVERY_NOT_COMPLETED` response. They do not disclose address existence, draft count, draft status, or why authorization failed. A bounded retry-after and CAPTCHA-required boolean may be returned for policy decisions.

## Newest-created selection

The repository queries `ProFormDraft` by exact `recovery_email_lookup_hash`. Candidates are restricted to the current environment and retention window, legacy statuses are normalized, and superseded, cleared, expired, deleted, or finalized-retention records are excluded. Eligible statuses are `active`, `submit_attempted`, `submit_failed`, and `submitted`.

Eligible records are sorted by Base44 server `created_date` descending, then `created_at_server` descending for compatible legacy records, then stable draft ID descending. `updated_date`, `last_saved_at`, and client timestamps never affect the winner. Therefore a newer submitted record wins over an older active record. Recovery and later selection do not mutate creation timestamps or reorder drafts.

## Recovery session scopes

Every email-recovery session is bound to the exact selected draft ID, environment, session identifier hash, recovery-session/recovery-code versions, and recovery-email lookup hash. Claims never contain raw email, business name, or domain.

Active-like drafts receive `draft:read`, `draft:write`, `draft:events`, and `draft:list-associated`. Submitted drafts receive `draft:submitted-read`, `draft:read`, and `draft:list-associated`, with no write/event scope. Only `authorizationMethod: email` may carry `draft:list-associated`; recovery-code and signed-invitation sessions are rejected if they attempt to carry it.

## Associated choices and selection

The initial recovery response returns one allowlisted summary and only a boolean indicating whether other eligible drafts exist. It does not return canonical answers or a count. The client must use the exact-draft `loadProFormDraft` API to obtain authorized state.

`listProFormDraftRecoveryChoices` first verifies an email recovery session and requires `draft:list-associated`. It uses only the verified token's lookup hash, ignores any body email, reruns environment/lifecycle/retention filtering, returns at most 25 newest-created choices, and records a security event. Choice fields are limited to draft ID, normalized status/read-only state, business display name, created/last-saved times, generation, and current-selection marker.

`selectProFormDraftRecoveryChoice` verifies the current email session and list scope, loads the requested ID, timing-safely compares its lookup hash to the token binding, rechecks eligibility, and issues a new recovery session bound to that exact draft. Scope assignment is recalculated from selected status. It does not update, promote, or otherwise make the selected record newest.

## Client boundary and deployment state

`src/lib/proDraftRecoveryApiClient.js` exposes email recovery, list, and select methods. It requires the public recovery flag for ordinary calls, permits only an explicit local/test/staging override, sanitizes server/provider failures, and does not store tokens or email. No UI was added.

This change is source-only. It performs no schema push, function deployment, email/SES call, production access, domain operation, or branch push. Live Base44 authorization, FLS, monitoring, proxy-header, CAPTCHA-provider, and production-disabled certification remain release gates.
