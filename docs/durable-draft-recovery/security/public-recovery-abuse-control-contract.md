# Public recovery abuse-control contract

- Contract version: `1`
- Source status: abuse controls and public code/email recovery endpoints implemented and locally tested; no schema push, secret configuration, or deployment
- Security policy: `base44/functions/_shared/proDraftRecoverySecurity/entry.ts`
- CAPTCHA provider: `base44/functions/_shared/proDraftCaptcha/entry.ts`
- Device identifier: `src/lib/proDraftDeviceId.js`
- Event schema: `base44/entities/ProFormRecoverySecurityEvent.jsonc`

## Accepted product risk and boundary

The initial product decision knowingly accepts email-only recovery without
proof of mailbox ownership. Knowledge of an exact client email can therefore
be sufficient to recover the newest eligible questionnaire after abuse
controls. This is a privacy risk, not an authorization guarantee, and does not
permit cross-email, cross-code, cross-client, or cross-environment exposure.

The source implementation applies rate limits, temporary lockout, conditional
CAPTCHA, random device correlation, generic public failures, minimum timing,
and security-event auditing to public code and email recovery. Email recovery
remains deliberately unverified. The endpoints are not deployed or enabled by
this source-only change; OTP and magic links remain disabled future frameworks.

## Security-event entity

`ProFormRecoverySecurityEvent` is admin/backend only. Entity create, read,
update, and delete require role `admin`; Base44 service-role calls are included
by that explicit condition. Public browsers must never access this entity
directly.

Events retain only opaque request IDs, environment, allowlisted attempt/outcome,
purpose-separated hashes, authorized linkage, safe CAPTCHA booleans, bounded
window counts, lockout/window timestamps, policy version, synthetic test marker,
and migration metadata. They never contain raw email, normalized email, network
address, random device ID, recovery code, CAPTCHA token, request body, answer
content, recovery-session material, or provider response body.

The same entity contract now also allowlists admin password authentication, grant validation/revocation, and future scoped admin draft/event/retry/repair operations. Admin outcomes distinguish authorization, invalid password/grant, version/device/environment mismatch, rate limit, lockout, revocation, and internal failure. Admin authorization uses its own `PRO_FORM_ADMIN_GRANT_SECRET` HMAC domains for IP/device correlation; it does not reuse the public-recovery abuse secret or store raw inputs. The entity remains admin/backend only, and this source batch did not push its enum extension.

## Password-only admin controls

The admin endpoint applies independent IP and random-device attempt buckets with defaults of 10 per 15 minutes, locks after 10 failures for 1,800 seconds, and targets at least 400 ms plus up to 200 ms jitter. Grant validation and forget-device audit use four-times thresholds so normal persistent-grant checks are less aggressively limited while still bounded. Public recovery CAPTCHA/global/subject policies do not authorize or substitute for admin controls. Full details are in the [password-only admin recovery authorization contract](../admin/password-only-admin-recovery-authorization-contract.md).

## Rate-limit keys and secret separation

`PRO_FORM_ABUSE_HASH_SECRET` is reserved exclusively for abuse-correlation
HMACs. It requires at least 32 independently random bytes and must not reuse
the recovery-email, recovery-code, resume-token, draft-link, recovery-session,
admin-grant, or idempotency secret value. It is not configured in this batch.

HMAC-SHA-256 domain separation is mandatory:

| Key | Domain | Raw input retained? |
| --- | --- | --- |
| IP bucket | `pro-draft:abuse:ip:v1:` | No |
| Random device ID | `pro-draft:abuse:device:v1:` | No |
| Normalized email subject | `pro-draft:abuse:email-subject:v1:` | No |
| Normalized recovery-code subject | `pro-draft:abuse:code-subject:v1:` | No |

The stable `unknown` IP bucket remains subject to IP-bucket limits. Device IDs
are additive correlation only: absence, clearing, or storage failure never
bypasses subject, IP, or global limits.

## Default policy

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PRO_DRAFT_RECOVERY_IP_ATTEMPTS_PER_15_MIN` | 10 | Attempts per trusted IP/unknown bucket per 15 minutes |
| `PRO_DRAFT_RECOVERY_SUBJECT_ATTEMPTS_PER_15_MIN` | 5 | Attempts per email/code subject per 15 minutes |
| `PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA` | 3 | Subject failures before CAPTCHA escalation |
| `PRO_DRAFT_RECOVERY_FAILURES_BEFORE_LOCKOUT` | 10 | Subject failures before temporary lockout |
| `PRO_DRAFT_RECOVERY_LOCKOUT_SECONDS` | 1800 | Lockout duration |
| `PRO_DRAFT_RECOVERY_GLOBAL_ATTEMPTS_PER_MIN` | 300 | Environment-wide circuit breaker per minute |
| `PRO_DRAFT_RECOVERY_MIN_RESPONSE_MS` | 400 | Minimum response target before jitter |
| `PRO_DRAFT_RECOVERY_MAX_JITTER_MS` | 200 | Maximum bounded Web Crypto jitter |

Missing, noninteger, zero, and negative values select safe defaults. Values are
clamped to bounded ranges, and production applies nonzero floors. Test and
staging may use lower positive thresholds for synthetic testing. Delay is only
an enumeration-friction layer; it never replaces rate limits, CAPTCHA,
lockout, authorization, generic responses, or monitoring.

The global threshold produces an explicit circuit-breaker decision that future
callers must record as a `rate_limited` security event. All event queries and
returned rows are bounded.

## CAPTCHA escalation and fail-closed behavior

Ordinary first attempts do not require CAPTCHA. CAPTCHA becomes required after
the configured subject failure threshold, an explicit trusted risk signal, or
a rate-limit decision. Repeated failures produce temporary lockout independently
of CAPTCHA.

Supported providers are:

- `disabled`: no provider is available; a CAPTCHA-required attempt fails closed.
- `turnstile`: server-side form POST with a bounded timeout, success validation,
  and optional exact hostname/action checks.
- `staging_test`: deterministic synthetic verification allowed only when the
  environment is `staging` or `test` and
  `PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED=true`; production rejects it.

Reserved backend variables are `PRO_DRAFT_CAPTCHA_PROVIDER`,
`PRO_DRAFT_CAPTCHA_SECRET_KEY`, `PRO_DRAFT_CAPTCHA_VERIFY_URL`,
`PRO_DRAFT_CAPTCHA_EXPECTED_HOSTNAME`, and
`PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED`. The frontend reserves the public
`VITE_PRO_DRAFT_CAPTCHA_SITE_KEY`; no production site key is hardcoded.

CAPTCHA tokens exist only long enough for server-side verification. They are
never logged, persisted, returned, or added to diagnostics. Provider failure,
timeout, unavailable configuration, hostname mismatch, and action mismatch all
produce safe internal codes and the same generic public recovery failure.

## Random device identifier

The browser helper creates a 128-bit Web Crypto random value with an opaque
`pdd_` prefix and stores it through the existing resilient-storage adapter.
IndexedDB/local-storage failures fall back to page memory. The identifier is
not stored in Redux or logged, contains no email/user/draft data, and is not
authorization.

No user-agent, platform, hardware-concurrency, canvas, audio, font, screen, or
other browser-fingerprinting input participates in the identifier.

## Trusted network context and limitations

The policy inspects only request headers supplied through the platform request
boundary, preferring `CF-Connecting-IP`, then `X-Real-IP`, then the first
`X-Forwarded-For` value. It never reads an IP from request JSON. IPv4 is
canonicalized and common IPv6 text is lowercased/normalized where practical.
Missing or malformed input becomes the stable `unknown` bucket.

This code cannot independently prove which proxies Base44 strips or overwrites.
Before public deployment, staging and production must verify the platform's
documented proxy/header behavior and ensure clients cannot forge the selected
header. Raw network context is passed only to immediate HMAC/provider calls;
it is never returned publicly or written to the event entity.

## Generic public failures

Every unsuccessful future recovery path uses:

```json
{
  "success": false,
  "recoveryCompleted": false,
  "errorCode": "RECOVERY_NOT_COMPLETED",
  "message": "We could not recover a questionnaire with the information provided.",
  "captchaRequired": false,
  "retryAfterSeconds": 0,
  "requestId": "opaque-request-id"
}
```

Missing and wrong emails use equivalent wording. Missing and wrong codes use
equivalent wording where input parsing permits. Public responses never state
that an email is absent, a code exists or expired, or how many drafts exist.
Rate-limit/lockout paths may return bounded retry timing and CAPTCHA necessity,
but not subject existence. Authorized success exposes one allowlisted draft
summary only after recovery succeeds. Associated choices require the resulting
email session's `draft:list-associated` scope and token-bound lookup hash;
recovery-code and invitation sessions cannot list them.

## Monitoring requirements

Before enablement, monitoring must cover attempts and safe outcomes by
environment/type; subject/IP/global limit trips; CAPTCHA required, failed,
unavailable, timeout, hostname, and action outcomes; lockout creation/expiry;
event-store failure; unknown-IP frequency; latency distribution; and anomalous
success rates. Alerts must have owners, thresholds, and runbooks. Dashboards
must use safe counts/codes only and must never expose raw inputs or full hashes.

## Future production configuration gates

Production remains disabled until all of the following pass:

1. Independent abuse secret and production CAPTCHA credentials are provisioned
   without copying staging values.
2. Turnstile hostname/action and Base44 trusted-header behavior are certified.
3. Entity RLS/FLS, service-role event storage, rate limits, global breaker,
   lockout, uniform response/timing, and 10k authorization/abuse corpora pass.
4. Monitoring/alerts and safe retention/cleanup are operational.
5. Public email recovery receives separate release approval; recovery-code
   recovery receives its own authorization/UI/service certification.

## 2026-08-06 staging certification attempt

The [staging public recovery services report](staging-public-recovery-services-certification.md)
is **PUBLIC_RECOVERY_SERVICES_BLOCKED**. Source-focused recovery tests passed
214/214 and entity-schema tests passed 22/22, but five normal-suite failures
triggered the mandatory hard stop. Consequently this attempt supplied no live
evidence for abuse hashing, event RLS, trusted network context, per-IP,
per-subject or global limits, CAPTCHA escalation, lockout, retry timing,
minimum response time, generic failure equivalence, or safe event contents.

No abuse secret or staging-test CAPTCHA setting was configured, and no public
recovery function or security entity was deployed. The source contract and
future production gates remain unchanged. Email recovery remains explicitly
unverified; no email, SES request, Zapier request, or final submission ran.
