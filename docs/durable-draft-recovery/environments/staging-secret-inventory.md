# Staging Secret and Environment-Name Inventory

- Status: **STAGING_CRYPTOGRAPHIC_SECRETS_CONFIGURED**
- Inventory date: 2026-08-05
- Inventory rows: **81 names**
- Current production Base44 secret names observed: **4**
- Current staging Base44 secret names observed: **8** (six cryptographic secrets and two ordinary staging controls)

This is a names-only inventory. It contains no secret value, app ID, API key, credential, password, token, token-bearing URL, analytics property ID, or email address. `VITE_*` values and app IDs are public/runtime configuration rather than private secrets, but they are included because a wrong environment value can still redirect staging traffic or telemetry.

The four production names observed through the names-only Base44 secret command include `DRAFT_RECOVERY_PASSWORD`, the legacy Zapier destination name, `VITE_GOOGLE_PLACES_API_KEY`, and `OPENAI_KEY`. None exists in the staging app. The legacy Zapier name is not read by the new policy; production must be migrated deliberately to `PRO_ZAPIER_WEBHOOK_URL` only during a separately authorized release. No production secret may be copied to staging.

## Required and reserved names

| # | Secret/configuration name | Purpose | Required in staging | Required in green production | Must differ from production | May be copied from production |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `PRO_DEPLOY_ENVIRONMENT` | Explicit deployment environment | Yes | Yes | Yes | No |
| 2 | `BASE44_EXPECTED_APP_ID` | Exact invocation target for deployment guard | Yes | Yes | Yes | No |
| 3 | `BASE44_STAGING_APP_ID` | Staging identity comparison for deployment guard | Yes | Yes | N/A; identifies staging | No |
| 4 | `BASE44_PRODUCTION_APP_ID` | Production identity comparison/denylist | Yes | Yes | N/A; identifies production | Prefer No; retrieve independently from approved store |
| 5 | `ALLOW_PRODUCTION_DEPLOY` | Explicit production release enable flag | Yes (`false`) | Yes (`false` except approved release) | No | Yes, only the safe value `false` |
| 6 | `EXPECTED_GIT_BRANCH` | Branch/tag assertion for deployment guard | Yes | Yes | Yes | No |
| 7 | `VITE_APP_ENVIRONMENT` | Visible/runtime environment marker | Yes | Yes | Yes | No |
| 8 | `STAGING_EMAIL_REDIRECT_TO` | Internal destination for every staging email | Later | No | Yes | No |
| 8a | `PRO_DRAFT_EMAIL_MODE` | Backend SES mode: disabled, staging_redirect, or production | Later; keep `disabled` | Later; keep `disabled` until approved | Yes when activated | Safe `disabled` only |
| 8b | `PRO_DRAFT_SES_FROM_EMAIL` | Approved SES sender email; must be noreply at the approved domain | Later | Later | Prefer No after identity approval | No; configure independently |
| 8c | `PRO_DRAFT_SES_FROM_NAME` | Safe sender display name; defaults to MSP Success Websites | Optional | Optional | No | Yes; non-secret approved text only |
| 8d | `PRO_DRAFT_AWS_REGION` | Preferred backend SES region | Later | Later | Prefer Yes | No; configure from approved account inventory |
| 8e | `PRO_DRAFT_AWS_ACCESS_KEY_ID` | Preferred least-privilege SES access-key identifier | Later | Later | Yes | No |
| 8f | `PRO_DRAFT_AWS_SECRET_ACCESS_KEY` | Preferred least-privilege SES secret | Later | Later | Yes | No |
| 8g | `PRO_DRAFT_AWS_SESSION_TOKEN` | Optional temporary SES credential session token | Optional | Optional | Yes | No |
| 8h | `PRO_DRAFT_SES_TIMEOUT_MS` | Bounded SES timeout; default 10000, clamped 2000–30000 | Optional | Optional | No | Yes; non-secret bounded configuration only |
| 8i | `PRO_DRAFT_RECOVERY_BASE_URL` | HTTPS recovery-site base URL with no code/query/fragment | Later | Later | Yes | Only separately reviewed noncredential URL |
| 8j | `AWS_SESSION_TOKEN` | Standard AWS compatibility alias for a temporary session token | Optional compatibility only | Optional compatibility only | Yes | No |
| 8k | `PRO_DRAFT_RECOVERY_EMAIL_MAX_ATTEMPTS` | Draft-wide authorized recovery-email attempt cap; default 3, bounded 1–10 | Optional | Optional | No | Yes; reviewed integer only |
| 8l | `PRO_DRAFT_RECOVERY_EMAIL_RETRY_SECONDS` | Same-key failed-delivery backoff; default 30, bounded 1–3600 seconds | Optional | Optional | No | Yes; reviewed integer only |
| 9 | `AWS_REGION` | Future SES region | Later | Later | Prefer Yes | Prefer No |
| 10 | `AWS_ACCESS_KEY_ID` | Future least-privilege SES access-key identifier | Later | Later | Yes | No |
| 11 | `AWS_SECRET_ACCESS_KEY` | Future least-privilege SES secret | Later | Later | Yes | No |
| 12 | `SES_FROM_ADDRESS` | Future verified environment-specific sender | Later | Later | Prefer Yes | No |
| 13 | `SES_CONFIGURATION_SET` | Future environment-specific SES event routing | Later | Later | Yes | No |
| 14 | `DRAFT_RECOVERY_PASSWORD` | Current support/admin recovery password and grant signing input | Later | Yes currently; redesign planned | Yes | No |
| 15 | `PRO_FORM_DRAFT_TOKEN_SECRET` | Draft resume-token storage/lookup | Yes; configured independently 2026-08-05 | Later | Yes | No |
| 16 | `PRO_FORM_DRAFT_LINK_SECRET` | Signed draft-link integrity | Yes; configured independently 2026-08-05 | Later | Yes | No |
| 17 | `PRO_FORM_RECOVERY_CODE_SECRET` | Recovery-code lookup hashing | Yes; configured independently 2026-08-05 | Later | Yes | No |
| 18 | `PRO_FORM_EMAIL_LOOKUP_SECRET` | Normalized-email lookup hashing | Yes; configured independently 2026-08-05 | Later | Yes | No |
| 19 | `PRO_FORM_ADMIN_GRANT_SECRET` | Independently rotatable admin-grant signing | Yes; configured independently 2026-08-05 | Later | Yes | No |
| 19a | `PRO_FORM_RECOVERY_SESSION_SECRET` | Recovery-session signing | Yes; configured independently 2026-08-05 | Later | Yes | No |
| 19b | `PRO_FORM_ABUSE_HASH_SECRET` | Purpose-separated IP/device/email/code abuse-limit HMAC | Later; reserved, not configured | Later | Yes | No |
| 19c | `PRO_FORM_RECOVERY_SESSION_TTL_SECONDS` | Positive recovery-session TTL; default 43200, maximum 604800 | Optional | Optional | No | Yes; non-secret bounded configuration only |
| 19d | `PRO_FORM_EMAIL_OTP_SECRET` | Future six-digit OTP HMAC; independent, at least 32 bytes | Later; reserved and not configured | Later; reserved and not configured | Yes | No |
| 19e | `PRO_FORM_MAGIC_LINK_SECRET` | Future opaque magic-link-token HMAC; independent, at least 32 bytes | Later; reserved and not configured | Later; reserved and not configured | Yes | No |
| 20 | `CAPTCHA_SITE_KEY` | Future public staging CAPTCHA site key | Later | Later | Yes | No |
| 21 | `CAPTCHA_SECRET_KEY` | Future backend CAPTCHA verification secret | Later | Later | Yes | No |
| 20a | `PRO_DRAFT_CAPTCHA_PROVIDER` | Backend provider selector: disabled, turnstile, or staging_test | Later; start `disabled` | Later | Prefer Yes | Safe `disabled` only |
| 20b | `PRO_DRAFT_CAPTCHA_SECRET_KEY` | Backend Turnstile verification secret | Later | Later | Yes | No |
| 20c | `PRO_DRAFT_CAPTCHA_VERIFY_URL` | Optional HTTPS server-side verification endpoint | Optional | Optional | Prefer Yes | Only reviewed noncredential URL |
| 20d | `PRO_DRAFT_CAPTCHA_EXPECTED_HOSTNAME` | Exact expected provider hostname binding | Later | Later | Yes | No |
| 20e | `PRO_DRAFT_CAPTCHA_TEST_MODE_ENABLED` | Explicit staging/test-only synthetic CAPTCHA control | Later (`false` until test) | Yes (`false`) | Yes | Safe `false` only |
| 20f | `VITE_PRO_DRAFT_CAPTCHA_SITE_KEY` | Public environment-specific CAPTCHA site key | Later | Later | Yes | No |
| 22 | `PRO_ZAPIER_WEBHOOK_URL` | Production-only Zapier submission destination | No | Yes only with production mode | Yes | No |
| 23 | `STAGING_ZAPIER_WEBHOOK_URL` | Separately owned staging redirect destination | Later; omit while mode is `disabled` | No | Yes | No |
| 24 | `PRO_ZAPIER_TIMEOUT_MS` | Bounded Zapier request timeout in milliseconds | Optional; safe default is 8000 | Optional; safe default is 8000 | No | Yes; non-secret bounded configuration only |
| 25 | `ZAPIER_WEBHOOK_SIGNING_SECRET` | Future webhook request signing when supported | Later | Later | Yes | No |
| 26 | `OPENAI_KEY` | Direct OpenAI validation/content calls | Later; separate project/key or mock | Yes currently | Yes | No |
| 27 | `BASE44_APP_ID` | Backend app identity supplied by Base44 | Platform-provided | Platform-provided | Yes | No |
| 28 | `BASE44_SERVICE_ROLE_KEY` | Base44 backend service-role authorization | Platform-provided | Platform-provided | Yes | No |
| 29 | `VITE_BASE44_APP_ID` | Optional client Base44 app override | No unless explicitly required | No unless explicitly required | Yes | No |
| 30 | `VITE_BASE44_BACKEND_URL` | Optional client backend override | No unless explicitly required | No unless explicitly required | Prefer Yes | No |
| 31 | `VITE_GOOGLE_PLACES_API_KEY` | Browser Places API key; observed as a production secret name | Later; separate restricted key or mock | Yes currently | Yes | No |
| 32 | `STAGING_FILE_STORAGE_MODE` | Future `mock` or isolated staging-storage selector | Later | No | Yes | No |
| 33 | `STAGING_FILE_STORAGE_NAMESPACE` | Future staging upload namespace/bucket prefix | Later | No | Yes | No |
| 34 | `PDF_STAGING_DESTINATION` | Future PDF sink selector; current PDF is browser-only | No | No | Yes if introduced | No |
| 35 | `ERROR_REPORTING_ENVIRONMENT` | Environment tag for any future telemetry/error reporter | Later | Later | Yes | No |
| 36 | `VITE_CLARITY_PROJECT_ID` | Future separate Clarity project identifier | Later or disabled | Later | Yes | No |
| 37 | `VITE_HOTJAR_SITE_ID` | Future separate Hotjar site identifier | Later or disabled | Later | Yes | No |
| 38 | `VITE_APP_VERSION` | Safe build/release identifier | Yes | Yes | Prefer Yes | Yes only when both environments run the same immutable build |
| 39 | `BASE44_LEGACY_SDK_IMPORTS` | Non-secret Vite compatibility build switch | No | No | No | Yes; non-secret build setting only |
| 40 | `STAGING_TEST_DATA_PREFIX` | Synthetic fixture namespace and cleanup selector | Later | No | Yes | No |
| 41 | `STAGING_CLEANUP_TOKEN_SECRET` | Future narrowly scoped cleanup-job authorization | Later | No | Yes | No |
| 42 | `PRO_DRAFT_ENVIRONMENT` | Backend durable-draft environment boundary | Yes | Yes | Yes | No |
| 43 | `PRO_DRAFT_V2_SERVER_ENABLED` | Backend durable-draft V2 activation flag | Yes (`false`) | Yes (`false` until approved activation) | No initially | Yes, only the safe value `false` |
| 44 | `PRO_DRAFT_V2_KILL_SWITCH` | Backend emergency disable override | Yes (`true`) | Yes (`true` until approved activation) | No initially | Yes, only the safe value `true` |
| 45 | `PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED` | Backend public email-recovery gate | Yes (`false`) | Yes (`false` until its implementation is accepted) | No initially | Yes, only the safe value `false` |
| 46 | `PRO_DRAFT_EMAIL_OTP_ENABLED` | Future backend OTP gate | Yes (`false`) | Yes (`false`) | No initially | Yes, only the safe value `false` |
| 47 | `PRO_DRAFT_MAGIC_LINK_ENABLED` | Future backend magic-link gate | Yes (`false`) | Yes (`false`) | No initially | Yes, only the safe value `false` |
| 48 | `PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE` | Environment-constrained external-side-effect routing | Yes (`disabled`) | Yes (`disabled` until approved activation) | Yes when side effects are enabled | Yes, only the safe value `disabled` |
| 49 | `PRO_DRAFT_DIAGNOSTICS_ENABLED` | Safe backend configuration diagnostics gate | Yes (`false` initially) | Yes (`false`) | No initially | Yes, only the safe value `false` |
| 50 | `PRO_DRAFT_BUILD_SHA` | Safe backend build identifier/fingerprint | Yes | Yes | Prefer Yes | Yes only for the same immutable build |
| 50a | `PRO_DRAFT_RECOVERY_IP_ATTEMPTS_PER_15_MIN` | Positive bounded IP-bucket attempt threshold; default 10 | Optional | Optional | No | Yes; non-secret policy only |
| 50b | `PRO_DRAFT_RECOVERY_SUBJECT_ATTEMPTS_PER_15_MIN` | Positive bounded subject threshold; default 5 | Optional | Optional | No | Yes; non-secret policy only |
| 50c | `PRO_DRAFT_RECOVERY_FAILURES_BEFORE_CAPTCHA` | Positive CAPTCHA escalation threshold; default 3 | Optional | Optional | Prefer Yes for testing | Yes; non-secret policy only |
| 50d | `PRO_DRAFT_RECOVERY_FAILURES_BEFORE_LOCKOUT` | Positive temporary-lockout threshold; default 10 | Optional | Optional | Prefer Yes for testing | Yes; non-secret policy only |
| 50e | `PRO_DRAFT_RECOVERY_LOCKOUT_SECONDS` | Positive bounded lockout duration; default 1800 | Optional | Optional | Prefer Yes for testing | Yes; non-secret policy only |
| 50f | `PRO_DRAFT_RECOVERY_GLOBAL_ATTEMPTS_PER_MIN` | Positive bounded environment circuit breaker; default 300 | Optional | Optional | Prefer Yes for load profile | Yes; non-secret policy only |
| 50g | `PRO_DRAFT_RECOVERY_MIN_RESPONSE_MS` | Positive bounded generic-response floor; default 400 | Optional | Optional | No | Yes; non-secret policy only |
| 50h | `PRO_DRAFT_RECOVERY_MAX_JITTER_MS` | Positive bounded Web Crypto jitter; default 200 | Optional | Optional | No | Yes; non-secret policy only |

`ALLOW_PRODUCTION_DEPLOY=false` is a non-sensitive safe default, not authorization. All app IDs remain outside Git even though identifiers are not access credentials.

## Backend runtime configuration classification

All nine `PRO_DRAFT_*` names below are ordinary configuration values; none is a secret. They must still be supplied through environment-specific configuration because an incorrect value can cross an authorization or side-effect boundary. Only exact lowercase values from the documented contract are accepted.

| Name | Classification | Fail-closed/default behavior | Present before staging deployment | Must differ from production | Must remain off until later work |
| --- | --- | --- | --- | --- | --- |
| `PRO_DRAFT_ENVIRONMENT` | Ordinary configuration | Missing/invalid becomes `unknown`; V2 is disabled | **Configured**, exactly `staging` | Yes | N/A |
| `PRO_DRAFT_V2_SERVER_ENABLED` | Ordinary configuration | Missing/invalid is disabled; committed example is `false` | Yes | No initially | Yes, until separate V2 activation |
| `PRO_DRAFT_V2_KILL_SWITCH` | Ordinary configuration | Committed safe setting is `true`; a missing/malformed control cannot enable V2 | Yes | No initially | Keep on until separate V2 activation |
| `PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED` | Ordinary configuration | Missing/invalid is disabled; default `false` | Yes | No initially | Yes, through the public-recovery implementation batch |
| `PRO_DRAFT_EMAIL_OTP_ENABLED` | Ordinary configuration | Missing/invalid is disabled; default `false` | Yes | No initially | Yes, until a separately accepted OTP release |
| `PRO_DRAFT_MAGIC_LINK_ENABLED` | Ordinary configuration | Missing/invalid is disabled; default `false` | Yes | No initially | Yes, until a separately accepted magic-link release |
| `PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE` | Ordinary configuration | Missing/invalid normalizes to `disabled` and invalidates V2 configuration | Yes, exactly `disabled` initially | Yes when enabled | Keep `disabled` until environment routing is certified |
| `PRO_DRAFT_DIAGNOSTICS_ENABLED` | Ordinary configuration | Missing/invalid is disabled | **Configured**, exactly `true`, only for the admin-only staging self-check | Yes; production remains absent/off | No public diagnostic is permitted |
| `PRO_DRAFT_BUILD_SHA` | Ordinary configuration | Missing/unsafe value becomes an empty safe identifier | Yes, immutable build placeholder replaced outside Git | Prefer Yes | N/A |

Frontend `VITE_PRO_DRAFT_*` controls are browser-visible configuration and cannot authorize any backend operation. Backend controls cannot silently enable client UI.

## Zapier destination configuration

| Name | Classification | Selection rule | Missing/invalid behavior |
| --- | --- | --- | --- |
| `PRO_ZAPIER_WEBHOOK_URL` | Credential-bearing production server configuration | Read only when environment and mode are both `production` | Delivery fails closed; never falls back to staging or a source constant |
| `STAGING_ZAPIER_WEBHOOK_URL` | Credential-bearing staging server configuration | Read only when environment is `staging` and mode is `staging_redirect` | Redirect fails closed; never falls back to production; unnecessary in `disabled` mode |
| `PRO_ZAPIER_TIMEOUT_MS` | Non-secret bounded server configuration | Shared by the policy after integer/range validation | Missing/invalid uses the bounded 8000 ms default; maximum is 15000 ms |

Both destination values must use HTTPS outside an explicitly injected local test adapter. Neither value may come from a public request, frontend variable, committed file, public response, or log context.

## Rotation, ownership, and value-safe validation

| Name group | Rotation requirement | Owner | Validation without exposing value |
| --- | --- | --- | --- |
| Deployment target variables (1-7) | Revalidate at every invocation; rotate/update when an app, branch, or release changes | Release owner | Run `verify:base44-target`; compare only SHA-256 app-ID fingerprints and safe PASS/failure codes |
| Staging email/SES (8-13) | Rotate credentials on personnel/policy incident and at the organization standard; revalidate sender/config after change | Messaging owner + Security | Names-only secret listing; send only synthetic mail after redirect tests; record recipient class/domain hash, never address/value |
| Recovery/token/abuse secrets (14-19b) | Independently version and rotate; rotation must revoke/version affected grants, tokens, or abuse hashes | Application owner + Security | Names-only listing plus backend challenge tests with synthetic invalid/valid fixtures; never log raw password/token/code/network/device input |
| CAPTCHA (20-21, 20a-20f) | Separate environment keys; rotate on disclosure/abuse/provider recommendation | Security + Application owner | Provider dashboard key fingerprint/last-four under restricted review; automated staging verification with synthetic provider response |
| Webhook (22-25) | Rotate destination/secret on exposure, destination change, or incident; timeout changes require bounded validation | Integration owner + Security | Names-only listing; destination class and one-way fingerprint in restricted evidence; synthetic sink receipt only |
| AI (26) | Separate key/project; rotate on disclosure, owner change, or provider policy | AI service owner + Security | Names-only listing; synthetic minimal completion and project/budget metadata reviewed outside Git |
| Base44 platform identity (27-30) | App-scoped/platform-managed; rotate service role on compromise; never manually copy | Base44 workspace owner | Deployment guard fingerprint, names-only configuration inspection, and app-scoped read-only checks |
| Maps (31) | Separate staging key; rotate on disclosure; maintain environment-specific referrer/API restrictions | Web platform owner | Provider key restrictions and allowed-origin review; synthetic Places request; never print key |
| File/PDF (32-34) | Rotate cleanup authorization if introduced; configuration changes require destination review | Data/storage owner | Write synthetic marker, read metadata only, cleanup it, and prove no production URL/app ID is accepted |
| Telemetry (35-37) | Separate project/property identifiers; rotate tokens if a future private ingest token is added | Observability + Privacy owner | Inspect environment label/project fingerprint and run synthetic event; production property denylist must pass |
| Build/test cleanup (38-41) | App version changes per release; rotate cleanup authorization on schedule/incident | Release owner + QA/data owner | Inspect non-secret build metadata; cleanup dry run selects only `environment=staging` plus `test_run_id`/prefix |
| Durable-draft runtime configuration (42-50) | Revalidate on every build/deploy and every activation or rollback; build SHA changes per immutable build | Release owner + Application owner | Compare only recognized environment/mode names, safe booleans, and build fingerprints; never dump the full environment |

## Current gaps and prohibitions

- No SES/AWS, email redirect, CAPTCHA, staging webhook, staging AI, cleanup, telemetry, or file/PDF staging secret has been created. The only configured staging names are the six purpose-specific cryptographic secrets and the two ordinary self-check controls listed below.
- The production Zapier destination is no longer hardcoded or a staging default. `disabled` requires no staging URL; `staging_redirect` fails closed without `STAGING_ZAPIER_WEBHOOK_URL`; production delivery requires the exact production environment/mode pair plus `PRO_ZAPIER_WEBHOOK_URL`.
- Production analytics IDs, the production Places key, recovery password, OpenAI key, service-role material, and webhook URL must not be copied.
- `VITE_*` values are exposed to the browser. They must never contain a private credential.
- A missing redirect, webhook, AI, CAPTCHA, or environment declaration must suppress the related side effect; it must not select production.
- Backend runtime names 42-50 require reviewed staging values before any later deployment, except optional bounded timeout configuration. The staging redirect URL remains absent and unnecessary while mode is `disabled`. This inventory does not set any value.
- The abuse secret, CAPTCHA variables, public site key, and recovery-policy variables added in rows 19b, 20a-20f, and 50a-50h are reserved only. Row 19c is optional, bounded, non-secret source configuration with a 12-hour default. This prompt configured none of them.

## 2026-08-05 staging cryptographic configuration evidence

The following names are configured in the separate `_staging` Base44 app and remain unconfigured in production:

- `PRO_FORM_DRAFT_TOKEN_SECRET`
- `PRO_FORM_DRAFT_LINK_SECRET`
- `PRO_FORM_RECOVERY_CODE_SECRET`
- `PRO_FORM_EMAIL_LOOKUP_SECRET`
- `PRO_FORM_RECOVERY_SESSION_SECRET`
- `PRO_FORM_ADMIN_GRANT_SECRET`

Each value was generated independently from 48 random bytes with Node `crypto.randomBytes(48)` and encoded as Base64URL. This exceeds the minimum 32-byte policy. Values were written only to a mode-`0600` temporary file outside both repositories, imported with `npx base44 secrets set --env-file`, never printed, and securely deleted immediately after the successful import. A names-only follow-up listed exactly these six names plus `PRO_DRAFT_ENVIRONMENT` and `PRO_DRAFT_DIAGNOSTICS_ENABLED`.

Production remains names-only unchanged with its pre-existing four names. None of the six new names is configured there. No production value was copied. `DRAFT_RECOVERY_PASSWORD` was absent from staging, was not included in the import, and remains unchanged in production.

Rotation of one purpose secret invalidates or changes only that purpose's derived hashes/tokens. Rotation therefore requires explicit versioning and a bounded compatibility/revocation plan; values must never be printed during validation or rotation.

## 2026-08-05 authoritative API attempt

The attempt stopped at the source gate before any secret operation. No
`PRO_FORM_IDEMPOTENCY_SECRET` value was generated, imported, printed, or
queried, and the prior names-only inventory was not changed. Its required
staging presence and production absence remain to be proved during a future
authorized attempt. No temporary environment file was created.

## 2026-08-06 public recovery services attempt

The attempt stopped at the normal source-test gate before entering the staging
checkout. `PRO_FORM_ABUSE_HASH_SECRET` was not generated, written, imported,
printed, or queried. No temporary owner-only environment file was created, and
none required deletion. The eleven staging recovery-policy values, including
`staging_test` CAPTCHA mode, were not configured or changed. Existing names-
only staging and production inventories were not refreshed or mutated.

The required abuse secret remains a name-only planned item, not a configured
credential. A future passing attempt must independently generate at least 48
random bytes for staging, use a mode-`0600` file outside the repository, import
without terminal echo, delete the file, and then record only the configured
name. No production value may be copied or inferred.

## 2026-08-06 SES transport source inventory

The backend transport reserves the ten preferred configuration names in rows
8–8i. Standard `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and
`AWS_SESSION_TOKEN`, plus legacy-planned `SES_FROM_ADDRESS`, are compatibility
aliases only; preferred names take precedence so operators do not duplicate
secrets. No value was created, configured, queried, printed, or copied in this
prompt. `SES_CONFIGURATION_SET` remains a future bounce/complaint event-routing
control and is not read by the current source module.

Sender verification, SES region, account sandbox/production status, IAM
least-privilege policy, quotas, and bounce/complaint routing are **UNKNOWN**.
The existing sanitized evidence still records staging external side effects as
`disabled`; cloud state was not refreshed. Before any staging delivery, the
real redirect must be configured outside Git and validated by presence/domain
only. No real internal address belongs in this inventory.

## 2026-08-06 staging SES certification attempt

The [certification attempt](../email/staging-ses-recovery-email-certification.md)
stopped at the full normal test gate. No AWS or Base44 secret was created,
queried, imported, printed, copied, or deleted. No temporary env file was
created, so no temporary-file deletion was required. The approved internal
redirect recipient was not supplied or verified, and no masked address can be
recorded.

All ten preferred email configuration names remain planned/unconfigured by
this attempt. OTP and magic-link secrets also remain unconfigured. Existing
names-only staging and production inventories were not refreshed or mutated.
