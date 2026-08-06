# Signed-token and authorization contract

- Contract version: `1`
- Module: `base44/functions/_shared/proDraftAuthorization/entry.ts`
- Cryptography dependency: `base44/functions/_shared/proDraftSecurity/entry.ts`
- Deployment status: shared source remains endpoint-free; a drift-tested copy is exercised only by the staging admin self-check

## Scope and security boundary

The shared module defines signed invitation, recovery-session, future email-verification, and password-only admin-grant claim primitives. It performs no environment lookup, Base44 call, entity mutation, browser persistence, logging, email delivery, or public response handling. Callers must inject the intended secret, runtime environment, clock, expected resource bindings, and current revocation versions.

These tokens provide integrity and authenticity with HMAC-SHA-256. They are **not encrypted**. Anyone who receives a token can decode its payload, so claims must never contain raw email addresses, raw user IDs, raw domains, recovery codes, resume tokens, secret values, or other sensitive display data. A valid token is authorization only for the exact type, scope, environment, resource, and policy checks performed by its consuming function.

This module is not an individual-user authentication system. In particular, an admin recovery grant proves only that the approved password-only admin flow issued a grant under the current policy; it must never authorize ordinary questionnaire-user access.

## Compact token format

The version-1 format is:

```text
<unpadded-base64url-canonical-json>.<unpadded-base64url-hmac-sha-256>
```

Payload objects are recursively key-sorted and JSON serialized before signing. Signing input is a purpose-specific ASCII domain separator followed by the encoded payload. The verifier requires exactly two nonempty segments, canonical Base64URL, valid UTF-8 and JSON, a canonical payload, and an exact claim-key set. Canonical reserialization rejects duplicate JSON keys as well as reordered or otherwise noncanonical JSON.

The expected token purpose selects the domain separator and secret before the payload is decoded. The HMAC is compared with the timing-safe byte helper from the cryptography module. This prevents an untrusted payload from choosing its own verification key and avoids parsing claims until integrity has been established where practical.

## Common claims

Every payload has these fields:

| Claim | Contract |
| --- | --- |
| `version` | Integer `1`; other versions fail closed |
| `type` | One approved token type |
| `scope` | The single primary scope assigned to that type |
| `environment` | `local`, `test`, `staging`, or `production` |
| `issuedAt` | Nonnegative integer epoch seconds |
| `notBefore` | Nonnegative integer epoch seconds, not earlier than `issuedAt` |
| `expiresAt` | Integer epoch seconds, except `null` only for an admin recovery grant |
| `tokenId` | Random, opaque, non-PII identifier with the `pdti_` prefix |
| `grantVersion` | Positive integer revocation version |

Unknown types, scopes, claims, and versions are rejected. Non-admin expiry must be later than both issuance and activation and must remain within the purpose maximum. The random token ID supports safe correlation but is neither a secret nor a substitute for resource binding.

## Types and scopes

| Type | Required primary scope | Status |
| --- | --- | --- |
| `signed_invitation` | `draft:invitation` | Claim validation available |
| `recovery_session` | `draft:recover` | Issue and verify available |
| `admin_recovery_grant` | `admin:draft-recovery` | Issue and verify available; not yet integrated |
| `email_otp` | `email:otp` | Disabled framework only |
| `magic_link` | `email:magic-link` | Disabled framework only |

Recovery-session authorization may additionally carry `draft:read`, `draft:write`, `draft:events`, or `draft:submitted-read` in `authorizedScopes`. Submitted-record access must be explicitly `draft:submitted-read`; it may be paired only with ordinary `draft:read`, never write or event scope. Resource functions independently enforce record lifecycle rules.

## Secret-purpose mapping

| Purpose | Required injected secret name | Signing domain |
| --- | --- | --- |
| Signed invitation | `PRO_FORM_DRAFT_LINK_SECRET` | `pro-draft:authorization:signed-invitation:v1:` |
| Recovery session | `PRO_FORM_RECOVERY_SESSION_SECRET` | `pro-draft:authorization:recovery-session:v1:` |
| Admin recovery grant | `PRO_FORM_ADMIN_GRANT_SECRET` | `pro-draft:authorization:admin-recovery-grant:v1:` |
| Future OTP | `PRO_FORM_EMAIL_OTP_SECRET` | `pro-draft:authorization:email-otp:v1:` |
| Future magic link | `PRO_FORM_MAGIC_LINK_SECRET` | `pro-draft:authorization:magic-link:v1:` |

The module accepts a `{ name, value }` secret object and rejects a name that does not match the expected purpose. Operators must eventually provision independently generated values; different names or domain separators do not make reused secret material independent. This change sets no secret and reads no environment variable.

## Signed invitations

An invitation extends the common claims with `invitationId`, `formType`, `userIdHash`, `recoveryEmailLookupHash`, `domainIdentityHash`, `allowedAssociation`, and `linkVersion`. `allowedAssociation` is exactly `current_invitation` or `new_draft`. The provisional maximum lifetime is 90 days; the default lifetime remains a later configuration decision.

The identity values are keyed hashes, not raw display data. A later invitation consumer must verify the signature and then compare the expected environment, form type, association, user hash, normalized-email lookup hash, and domain identity hash. A visible URL may carry display values separately, but changing the visible email makes its keyed lookup hash differ. The client must then start a new association rather than retrieve drafts associated with another email.

## Recovery sessions

A recovery session adds:

- `draftId` and `sessionIdHash`;
- `authorizationMethod`: `email`, `recovery_code`, or `signed_invitation`;
- the explicit `authorizedScopes` set;
- `recoveryCodeVersion` and `recoverySessionVersion`;
- optional `recoveryEmailLookupHash` only when the authorizing method requires
  an email association. Recovery-code authorization deliberately omits it.

Issuance defaults to 12 hours and rejects a configured lifetime above 7 days. A later caller may read `PRO_FORM_RECOVERY_SESSION_TTL_SECONDS`, validate it, and pass the resulting seconds to the issue helper; this shared module deliberately does not read runtime configuration itself.

Verification requires the expected environment, grant version, draft ID, authorization method, and recovery-session version, plus any operation-specific required scope. It returns a normalized, frozen claim object and never returns token or signature bytes. A session for one draft or recovery method cannot authorize another. The recovery-code service issues read/write/event scopes for active-like drafts and submitted-read/read scopes for submitted drafts. Email recovery may later issue its separately approved scopes, but every entity function must still enforce lifecycle eligibility.

## Persistent password-only admin recovery grant

An admin grant has primary scope `admin:draft-recovery`, `expiresAt: null`, `deviceBindingHash`, `passwordVersion`, and `recoveryPolicyVersion`. It has no fixed expiry under the approved initial policy. Verification requires matching environment, grant version, password version, recovery-policy version, and device binding.

The future browser implementation must create a random per-browser device identifier. `deviceBindingHash` may bind the grant to that random identifier; it must not be derived from invasive fingerprinting inputs. **Forget This Device** removes both the local grant and random device identifier. Browser-storage clearing has the same local effect.

Admin grants remain revocable through:

- rotating `PRO_FORM_ADMIN_GRANT_SECRET`, invalidating all grants under the old key;
- incrementing `grantVersion` or the applicable password/policy version;
- Forget This Device; or
- clearing browser storage.

The existing `verifyDraftRecoveryAccess` seven-day flow is intentionally unchanged. A later admin batch must migrate issuance, storage, device binding, version sources, compatibility behavior, and removal of the legacy grant only after its own acceptance tests. This module does not replace or call the current flow.

## Disabled OTP framework

Future OTP claims add `recoveryEmailLookupHash`, `attemptId`, `otpVersion`, and `attemptCount`. The intended default lifetime is 10 minutes and the enforced maximum is 15 minutes. The module validates claim shape and purpose separation only. It does not generate a code, send email, create an endpoint or UI, verify ownership, or enable a feature flag. A later implementation must use the separate OTP secret and add attempt/rate-limit persistence.

## Disabled magic-link framework

Future magic-link claims add `recoveryEmailLookupHash`, `attemptId`, `magicLinkVersion`, and `redirectPathHash`. The provisional default and maximum lifetime is 30 minutes. Only a hash of later-approved redirect metadata is admitted; an open redirect URL is not a claim. The module does not issue or send links and enables no feature flag. A later implementation must resolve the hash only against a closed server-side path allowlist and use the separate magic-link secret.

## Environment, resource, and purpose binding

Environment is mandatory in every token and must exactly match the verifier expectation. A staging token therefore fails in production even if secret material were accidentally reused. Environment-specific secret values remain required as a second isolation layer.

Purpose binding is enforced by all of token type, primary scope, required secret name, and signing domain. The expected purpose drives verification, so a valid invitation, admin, OTP, or magic-link token cannot be substituted for a recovery session. Recovery wrappers additionally require the exact `draftId` and method. Admin wrappers require the expected random-device binding when the grant carries one.

## Time and clock skew

The default accepted clock skew is 60 seconds and callers may only reduce it; values above 60 seconds fail closed. `issuedAt` cannot be more than the accepted skew in the future, `notBefore` must have arrived within that allowance, and finite expiries are accepted only through the same bounded grace window. An injected epoch-seconds clock supports deterministic tests. Production callers should use the trusted server clock.

## Errors, diagnostics, and logging

`ProDraftAuthorizationError` carries a stable `PRO_DRAFT_AUTH_*` internal code and a static, value-free internal message. `toSafeResponse()` deliberately collapses every failure to public code `AUTHORIZATION_DENIED` and message `Authorization could not be verified.` A public endpoint must use that generic projection and must not expose whether a token was absent, unknown, expired, malformed, or incorrectly signed.

`getSafeAuthorizationDiagnostics` returns only contract version, algorithm/format names, public time limits, disabled-feature state, and an optional safe internal code. Neither errors nor diagnostics include a token, signature, secret, hash, email, resource identifier, or provider exception. Consumers must never log a submitted token or signature bytes.

## PII exclusions

Decoded synthetic invitation and recovery tokens are tested to contain keyed hashes and opaque identifiers but not their source email, domain, user ID, recovery code, or resume token. Exact claim allowlists reject fields such as raw `email` or any other extra claim. Because payloads are readable, future claim additions require a PII review before the authorization version can change.

## Future integration points

Later backend work must:

1. inject environment-specific secrets and current revocation versions without logging them;
2. verify signed invitations before draft association or lookup;
3. issue recovery sessions only after an approved recovery proof and enforce lifecycle/scopes again at every draft operation;
4. read and validate `PRO_FORM_RECOVERY_SESSION_TTL_SECONDS` before passing a TTL to the module;
5. migrate the legacy seven-day admin flow, implement random-device storage and Forget This Device, and keep admin authorization separate from user authentication;
6. add server-side audit events using nonsecret fingerprints only;
7. implement OTP/magic-link rate limits, attempts, delivery, redirect allowlisting, and feature gates only in their later approved batches; and
8. define bounded secret-rotation/version migration procedures before rotating a live purpose key.

The shared contract itself creates no endpoint, entity modification, UI, or feature enablement. Staging secret provisioning and the admin-only self-check are recorded separately below; they do not expose a token consumer or public recovery API.

## Test coverage

`src/test/proDraftAuthorization.test.js` covers canonical sign/verify, payload and signature tampering, extra segments, Base64URL and JSON rejection, duplicate keys, versions, type/scope/purpose separation, environment isolation, temporal bounds, invitation hash binding, exact draft/method recovery authorization, submitted-read behavior, admin persistence and revocation, disabled future claim shapes, PII exclusion, safe diagnostics, injected clocks/token IDs, and static no-endpoint/no-I/O boundaries.

## Staging certification evidence — 2026-08-05

The staging app now contains independent 48-random-byte values for `PRO_FORM_DRAFT_LINK_SECRET`, `PRO_FORM_RECOVERY_SESSION_SECRET`, and `PRO_FORM_ADMIN_GRANT_SECRET`. They are distinct from each other and from the three cryptographic lookup/token secrets. Production contains none of these names. Values were never printed or committed, and `DRAFT_RECOVERY_PASSWORD` remains unchanged.

The staging-only `proDraftSecuritySelfCheck` function requires `PRO_DRAFT_ENVIRONMENT=staging`, `PRO_DRAFT_DIAGNOSTICS_ENABLED=true`, an authenticated `base44.auth.me()` result, and the repository-verified Base44 role `admin`. It does not accept the legacy password-only grant as diagnostic authorization. Outside staging or when diagnostics are disabled it returns 404 before authentication or secret evaluation.

The authenticated staging invocation reported authorization version `1` and true results for recovery-session, signed-invitation, and persistent-admin-grant sign/verify checks, plus tamper, cross-environment, and cross-purpose rejection. Its exact allowlisted response contains booleans and versions only; it contains no raw token, signature, claim state, email, code, hash, draft identifier, or secret metadata.

Rotating each signing secret invalidates only its purpose and requires the associated grant/session/link version and revocation plan. This certification does not migrate the existing password-only admin flow, issue a browser grant, implement OTP or magic links, or create any public recovery endpoint.
