# Recovery-code service flow

- Source status: implemented and locally tested
- Function: `base44/functions/recoverProFormDraftByCode/entry.ts`
- Orchestration: `base44/functions/_shared/proDraftCodeRecovery/entry.ts`
- Client wrapper: `src/lib/proDraftRecoveryApiClient.js`
- Deployment status: not deployed; UI and public recovery flags remain disabled

## Request contract

`recoverProFormDraftByCode` accepts only `POST` with JSON no larger than 32 KB:

```json
{
  "apiVersion": 1,
  "recoveryCode": "transient formatted code",
  "deviceId": "optional random pdd_ identifier",
  "captchaToken": "optional until policy requires it",
  "clientContext": {
    "formType": "pro-questionnaire",
    "sourceTabId": "optional opaque ID",
    "appBuildSha": "optional safe build ID",
    "environment": "staging"
  },
  "testRunId": "optional outside production"
}
```

Exact-key validation rejects caller-supplied draft IDs, emails, recovery-code
hashes, resume-token hashes, authorization objects, and arbitrary context.
Malformed, missing, absent, expired, deleted, and superseded codes receive the
same generic recovery-not-completed wording.

## Ordered authorization flow

1. Create an opaque server request ID and start the response timer.
2. Require valid V2 runtime configuration, kill switch off, and the existing
   backend public-recovery gate enabled.
3. Enforce method, JSON content type, byte limit, exact request shape, runtime
   environment binding, random-device format, and nonproduction test marker.
4. Read cautious platform forwarding headers; never read network context from
   JSON.
5. Normalize the recovery code using the shared version-1 code contract.
6. HMAC network, device, and valid normalized code subjects with the separate
   abuse secret and purpose domains.
7. Read at most 500 recent admin-only security events and evaluate global, IP,
   code-subject, lockout, and CAPTCHA policy before recovery-code lookup.
8. When CAPTCHA is required, fail closed if the token/provider is missing,
   unavailable, invalid, timed out, or mismatched.
9. HMAC the normalized code with `PRO_FORM_RECOVERY_CODE_SECRET`, query only
   `recovery_code_hash`, and bound matches to 25. No caller draft ID participates.
10. Use the canonical duplicate selector without modifying duplicates. A
    duplicate produces only a safe request-ID/error-code warning.
11. Enforce lifecycle and retention, issue an exact-draft recovery session,
    persist a safe success event, apply bounded timing, and return the minimal
    recovery summary.

Raw codes, CAPTCHA tokens, network addresses, random device IDs, session tokens,
request bodies, answers, and canonical state are never stored in the security
entity or written to logs.

## Abuse controls

The service uses the version-1 defaults documented in the public recovery
abuse-control contract: IP 10 per 15 minutes, subject 5 per 15 minutes, CAPTCHA
after 3 failures, lockout after 10 failures for 1,800 seconds, global breaker
300 per minute, and a 400 ms response floor plus at most 200 ms Web Crypto
jitter. Limits and lockout are evaluated before the recovery-code HMAC and
draft query. Missing device correlation does not bypass IP, subject, or global
limits.

Already blocked requests remain blocked when their audit write fails. A success
is never returned if its success audit cannot be stored. Internal logging is
restricted to opaque request ID plus an allowlisted safe error code.

## Status and recovery-session scopes

| Draft status | Result | Recovery-session scopes |
| --- | --- | --- |
| `active` | Minimal writable summary | `draft:read`, `draft:write`, `draft:events` |
| `submit_attempted` | Minimal writable summary | `draft:read`, `draft:write`, `draft:events` |
| `submit_failed` | Minimal writable summary | `draft:read`, `draft:write`, `draft:events` |
| `submitted` | Minimal read-only summary | `draft:submitted-read`, `draft:read` |
| `cleared_superseded` | Generic failure; replacement ID hidden | None |
| `expired` or elapsed retention | Generic failure | None |
| `deleted` | Generic failure | None |
| Unknown | Generic failure plus safe internal alert | None |

The recovery session is HMAC-signed with
`PRO_FORM_RECOVERY_SESSION_SECRET`. It binds the exact draft ID, hashed session
ID, `recovery_code` method, approved scopes, recovery-code version,
recovery-session version, environment, grant version, and configured TTL. A
code-authorized session contains no email or email lookup hash. The optional
`PRO_FORM_RECOVERY_SESSION_TTL_SECONDS` defaults to 12 hours and must be a
positive integer no greater than seven days.

## Success and client handoff

Success contains the signed token, expiry, request ID, and only: draft ID,
status, read-only flag, safe business-name display, creation/save timestamps,
draft generation, and code hint. It contains no canonical state, recovery
email, recovery hash, or replacement lineage. The client passes the token and
exact returned draft ID to `loadProFormDraft`, which verifies signature,
environment, method, session fingerprint, revocation version, and scopes before
returning authorized state.

`src/lib/proDraftRecoveryApiClient.js` calls
`base44.functions.invoke("recoverProFormDraftByCode", request)`, returns safe
CAPTCHA/retry state, and rebuilds responses through explicit allowlists. It does
not store the recovery code or session token, dispatch Redux actions, or enable
any UI.

## Security events

One `code_recovery` event is attempted for invalid format, CAPTCHA required or
failed, rate limit, lockout, not found, superseded, success, and internal
failure. Events contain only purpose-separated hashes, safe counts/booleans,
timestamps, optional authorized draft linkage, environment, policy version,
and synthetic test marker. Public responses never expose internal outcomes or
event rows.

## Staging test plan and release gates

Before any deployment or enablement:

1. provision the independent abuse secret and reviewed CAPTCHA configuration;
2. deploy the schema and function only under a separately authorized staging
   prompt after target guards pass;
3. verify service-role RLS/FLS, exact hash lookup, duplicate warning, status
   matrix, success-audit fail-closed behavior, and cross-instance limits;
4. verify Turnstile hostname/action and trusted proxy semantics;
5. run 10k enumeration/abuse, response-uniformity, token/load integration,
   log-redaction, retention, and monitoring tests with synthetic data; and
6. keep backend/client public recovery flags off until a separate release
   approval enables the reviewed UI.

This source batch performed no Base44 schema push, function deployment, secret
configuration, staging data operation, production access, email delivery, UI
change, or Git push.
