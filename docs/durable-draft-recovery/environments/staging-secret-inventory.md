# Staging Secret and Environment-Name Inventory

- Status: **NAMES_RESERVED_VALUES_NOT_CONFIGURED**
- Inventory date: 2026-08-05
- Inventory rows: **50 names**
- Current production Base44 secret names observed: **4**
- Current staging Base44 secret names observed: **0**

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
| 9 | `AWS_REGION` | Future SES region | Later | Later | Prefer Yes | Prefer No |
| 10 | `AWS_ACCESS_KEY_ID` | Future least-privilege SES access-key identifier | Later | Later | Yes | No |
| 11 | `AWS_SECRET_ACCESS_KEY` | Future least-privilege SES secret | Later | Later | Yes | No |
| 12 | `SES_FROM_ADDRESS` | Future verified environment-specific sender | Later | Later | Prefer Yes | No |
| 13 | `SES_CONFIGURATION_SET` | Future environment-specific SES event routing | Later | Later | Yes | No |
| 14 | `DRAFT_RECOVERY_PASSWORD` | Current support/admin recovery password and grant signing input | Later | Yes currently; redesign planned | Yes | No |
| 15 | `PRO_FORM_DRAFT_TOKEN_SECRET` | Future draft token signing/derivation | Later | Later | Yes | No |
| 16 | `PRO_FORM_DRAFT_LINK_SECRET` | Future signed draft-link integrity | Later | Later | Yes | No |
| 17 | `PRO_FORM_RECOVERY_CODE_SECRET` | Future recovery-code hashing/derivation | Later | Later | Yes | No |
| 18 | `PRO_FORM_EMAIL_LOOKUP_SECRET` | Future normalized-email lookup hashing | Later | Later | Yes | No |
| 19 | `PRO_FORM_ADMIN_GRANT_SECRET` | Future independently rotatable admin-grant signing | Later | Later | Yes | No |
| 20 | `CAPTCHA_SITE_KEY` | Future public staging CAPTCHA site key | Later | Later | Yes | No |
| 21 | `CAPTCHA_SECRET_KEY` | Future backend CAPTCHA verification secret | Later | Later | Yes | No |
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

`ALLOW_PRODUCTION_DEPLOY=false` is a non-sensitive safe default, not authorization. All app IDs remain outside Git even though identifiers are not access credentials.

## Backend runtime configuration classification

All nine `PRO_DRAFT_*` names below are ordinary configuration values; none is a secret. They must still be supplied through environment-specific configuration because an incorrect value can cross an authorization or side-effect boundary. Only exact lowercase values from the documented contract are accepted.

| Name | Classification | Fail-closed/default behavior | Present before staging deployment | Must differ from production | Must remain off until later work |
| --- | --- | --- | --- | --- | --- |
| `PRO_DRAFT_ENVIRONMENT` | Ordinary configuration | Missing/invalid becomes `unknown`; V2 is disabled | Yes, exactly `staging` | Yes | N/A |
| `PRO_DRAFT_V2_SERVER_ENABLED` | Ordinary configuration | Missing/invalid is disabled; committed example is `false` | Yes | No initially | Yes, until separate V2 activation |
| `PRO_DRAFT_V2_KILL_SWITCH` | Ordinary configuration | Committed safe setting is `true`; a missing/malformed control cannot enable V2 | Yes | No initially | Keep on until separate V2 activation |
| `PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED` | Ordinary configuration | Missing/invalid is disabled; default `false` | Yes | No initially | Yes, through the public-recovery implementation batch |
| `PRO_DRAFT_EMAIL_OTP_ENABLED` | Ordinary configuration | Missing/invalid is disabled; default `false` | Yes | No initially | Yes, until a separately accepted OTP release |
| `PRO_DRAFT_MAGIC_LINK_ENABLED` | Ordinary configuration | Missing/invalid is disabled; default `false` | Yes | No initially | Yes, until a separately accepted magic-link release |
| `PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE` | Ordinary configuration | Missing/invalid normalizes to `disabled` and invalidates V2 configuration | Yes, exactly `disabled` initially | Yes when enabled | Keep `disabled` until environment routing is certified |
| `PRO_DRAFT_DIAGNOSTICS_ENABLED` | Ordinary configuration | Missing/invalid is disabled; staging and production examples are `false` | Yes | No initially | Remains off until backend diagnostics are separately approved |
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
| Recovery/token secrets (14-19) | Independently version and rotate; rotation must revoke or version old grants/tokens | Application owner + Security | Names-only listing plus backend challenge tests with synthetic invalid/valid fixtures; never log raw password/token/code |
| CAPTCHA (20-21) | Separate environment keys; rotate on disclosure/abuse/provider recommendation | Security + Application owner | Provider dashboard key fingerprint/last-four under restricted review; automated staging verification with synthetic provider response |
| Webhook (22-25) | Rotate destination/secret on exposure, destination change, or incident; timeout changes require bounded validation | Integration owner + Security | Names-only listing; destination class and one-way fingerprint in restricted evidence; synthetic sink receipt only |
| AI (26) | Separate key/project; rotate on disclosure, owner change, or provider policy | AI service owner + Security | Names-only listing; synthetic minimal completion and project/budget metadata reviewed outside Git |
| Base44 platform identity (27-30) | App-scoped/platform-managed; rotate service role on compromise; never manually copy | Base44 workspace owner | Deployment guard fingerprint, names-only configuration inspection, and app-scoped read-only checks |
| Maps (31) | Separate staging key; rotate on disclosure; maintain environment-specific referrer/API restrictions | Web platform owner | Provider key restrictions and allowed-origin review; synthetic Places request; never print key |
| File/PDF (32-34) | Rotate cleanup authorization if introduced; configuration changes require destination review | Data/storage owner | Write synthetic marker, read metadata only, cleanup it, and prove no production URL/app ID is accepted |
| Telemetry (35-37) | Separate project/property identifiers; rotate tokens if a future private ingest token is added | Observability + Privacy owner | Inspect environment label/project fingerprint and run synthetic event; production property denylist must pass |
| Build/test cleanup (38-41) | App version changes per release; rotate cleanup authorization on schedule/incident | Release owner + QA/data owner | Inspect non-secret build metadata; cleanup dry run selects only `environment=staging` plus `test_run_id`/prefix |
| Durable-draft runtime configuration (42-50) | Revalidate on every build/deploy and every activation or rollback; build SHA changes per immutable build | Release owner + Application owner | Compare only recognized environment/mode names, safe booleans, and build fingerprints; never dump the full environment |

## Current gaps and prohibitions

- No SES/AWS, email redirect, CAPTCHA, staging webhook, staging AI, cleanup, telemetry, or file/PDF staging secret has been created.
- The production Zapier destination is no longer hardcoded or a staging default. `disabled` requires no staging URL; `staging_redirect` fails closed without `STAGING_ZAPIER_WEBHOOK_URL`; production delivery requires the exact production environment/mode pair plus `PRO_ZAPIER_WEBHOOK_URL`.
- Production analytics IDs, the production Places key, recovery password, OpenAI key, service-role material, and webhook URL must not be copied.
- `VITE_*` values are exposed to the browser. They must never contain a private credential.
- A missing redirect, webhook, AI, CAPTCHA, or environment declaration must suppress the related side effect; it must not select production.
- Backend runtime names 42-50 require reviewed staging values before any later deployment, except optional bounded timeout configuration. The staging redirect URL remains absent and unnecessary while mode is `disabled`. This inventory does not set any value.

No secret was created, changed, copied, rotated, printed, or committed during this inventory.
