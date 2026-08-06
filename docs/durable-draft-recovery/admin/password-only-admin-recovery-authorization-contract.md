# Password-only admin recovery authorization contract

- Contract version: `1`
- Accepted model: shared password for the initial admin recovery release
- Source status: implemented and locally tested; not deployed or configured
- Backend endpoint: `verifyDraftRecoveryAccess`
- Admin scope: `admin:draft-recovery`

## Accepted risk and authorization boundary

The initial release knowingly accepts password-only administration. It does not require an individual Base44 administrator login, so a successful action cannot be attributed to a unique support identity. This residual risk is recorded as `RISK-002`; individual authenticated administrators remain the planned migration.

The password is verified only by the backend. It is never embedded in frontend code, returned to the browser, persisted, logged, placed in Redux, or put in a URL. The browser receives a signed grant, not Base44 entity credentials. This source batch adds no draft-entity access and does not migrate the existing admin recovery page; later page/API work must use narrowly scoped backend functions.

## Password verification

`DRAFT_RECOVERY_PASSWORD` remains the configured password name. Both the exact configured string and exact submitted string are transformed to constant-length HMAC-SHA-256 values using `PRO_FORM_ADMIN_GRANT_SECRET` and domain `pro-draft:admin-password-compare:v1:`. The bytes are timing-safely compared. Inputs are strings, are not trimmed, must be nonempty, and are limited to 1024 characters. A missing password or a missing/short grant secret fails closed with generic public wording.

## Persistent signed grant

The existing structured-token helper issues claims:

- `version`, `type=admin_recovery_grant`, and `scope=admin:draft-recovery`;
- mandatory `environment`, `issuedAt`, `notBefore`, `expiresAt=null`, and opaque `tokenId`;
- exact `grantVersion`, `passwordVersion`, and `recoveryPolicyVersion`; and
- `deviceBindingHash`.

The claim allowlist excludes passwords, raw device IDs, emails, Base44 access tokens, draft IDs, and draft content. The device hash is HMAC-SHA-256 over a Web Crypto random `pdd_` browser identifier under domain `pro-draft:admin-device-binding:v1:`; it is not browser fingerprinting.

There is deliberately no fixed expiration. A grant is revoked by rotating `PRO_FORM_ADMIN_GRANT_SECRET`, incrementing the grant/password/recovery-policy version, changing environment, failing the bound random-device check, choosing Forget This Device, or clearing browser storage. A copied grant therefore fails in another environment and should fail in another browser installation when random device storage is available.

## Endpoint contract

`verifyDraftRecoveryAccess` accepts only POST JSON bodies up to 16 KB:

- `{mode:"password", password, deviceId, testRunId?}`
- `{mode:"grant", grant, deviceId, testRunId?}`
- `{mode:"forget_device", grant, deviceId, testRunId?}`

Password success returns the signed grant once with safe version metadata, `persistent=true`, storage guidance, and a request ID. Grant validation returns authorization and safe version metadata without echoing the grant. Forget-device verification/audit is best effort because the client always deletes the local grant and device identifier. Responses are `no-store`; failures do not disclose whether password, signature, version, device, or environment caused rejection.

The function uses service-role access only for `ProFormRecoverySecurityEvent`. It does not require Base44 admin authentication and does not access draft, event-content, submission, intake, or user entities.

## Attempt controls and audit

Defaults are 10 password attempts per trusted IP hash per 15 minutes, 10 per device hash per 15 minutes, 10 failures before lockout, 1,800 seconds of lockout, a 400 ms minimum response target, and up to 200 ms of Web Crypto jitter. Grant validation and forget-device traffic have four times the password attempt threshold but remain abuse-limited. Numeric settings are bounded and cannot disable production controls with zero.

Events use allowlisted admin attempt/outcome enums and contain only request/environment metadata, purpose-separated IP/device HMACs, bounded counts, lockout/window times, policy version, and an optional nonproduction test marker. They contain no password, grant, raw device ID, raw IP, or draft answer. Event-store failure fails authorization closed.

## Browser vault and context

`proDraftAdminGrantVault.js` stores the logical grant bundle through resilient storage under `pro-draft-admin:grant:v1:<environment>`. IndexedDB is preferred, localStorage is the durable fallback, and memory is the last fallback. Memory-only diagnostics explicitly say authorization lasts only for the page session. Wrong-environment bundles are ignored and never sent. Malformed data is reported by the vault and deleted after client validation fails.

`proDraftAdminAuthorizationClient.js` is the only client adapter for the endpoint. It stores no password and returns UI state without a raw grant. `ProDraftAdminAuthorizationContext.jsx` exposes `loading`, `password_required`, `authorized`, `locked`, and `error`; it restores a stored grant on mount, deduplicates concurrent password submissions, is React Strict Mode safe, and keeps raw-grant retrieval behind `getAdminGrantForAuthorizedRequest` after authorization.

This context is intentionally not mounted into `App.jsx` or the admin recovery page by this batch. Ordinary questionnaire clients cannot obtain or use this grant.

## Configuration names

The backend reserves exactly: `DRAFT_RECOVERY_PASSWORD`, `PRO_FORM_ADMIN_GRANT_SECRET`, `PRO_FORM_ADMIN_GRANT_VERSION`, `PRO_FORM_ADMIN_PASSWORD_VERSION`, `PRO_FORM_ADMIN_RECOVERY_POLICY_VERSION`, `PRO_FORM_ADMIN_RECOVERY_IP_ATTEMPTS_PER_15_MIN`, `PRO_FORM_ADMIN_RECOVERY_DEVICE_ATTEMPTS_PER_15_MIN`, `PRO_FORM_ADMIN_RECOVERY_FAILURES_BEFORE_LOCKOUT`, `PRO_FORM_ADMIN_RECOVERY_LOCKOUT_SECONDS`, `PRO_FORM_ADMIN_RECOVERY_MIN_RESPONSE_MS`, and `PRO_FORM_ADMIN_RECOVERY_MAX_JITTER_MS`. This source-only batch configures none of them.

## Test and release requirements

Unit/contract coverage includes exact password semantics, HMAC comparison, missing configuration, every grant revocation dimension, tampering, IP/device limits, lockout/expiry, safe events, IndexedDB/localStorage/memory vault behavior, malformed/wrong-environment bundles, client clearing and no-logging behavior, Strict Mode/deduplication, and Redux/URL absence. Before release, staging must separately configure reviewed values, push/verify the entity enum extension, deploy to the staging app only, prove trusted network headers and service-role event writes, run live rate/lockout/revocation tests, and migrate admin pages to scoped backend APIs. Production deployment requires a later explicit cutover authorization.

## Future individual-admin migration

The long-term design replaces the shared password with individual authenticated administrators, least-privilege roles, attributable audit actors, session lifecycle controls, and centralized deprovisioning. That migration may wrap or replace this grant, but must preserve environment/scope/resource enforcement and must explicitly revoke the password-only fleet before removing compatibility.
