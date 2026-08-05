# Staging Secret and Environment-Name Inventory

- Status: **NAMES_RESERVED_VALUES_NOT_CONFIGURED**
- Inventory date: 2026-08-05
- Inventory rows: **39 names**
- Current production Base44 secret names observed: **4**
- Current staging Base44 secret names observed: **0**

This is a names-only inventory. It contains no secret value, app ID, API key, credential, password, token, token-bearing URL, analytics property ID, or email address. `VITE_*` values and app IDs are public/runtime configuration rather than private secrets, but they are included because a wrong environment value can still redirect staging traffic or telemetry.

The four production names observed through the names-only Base44 secret command are `DRAFT_RECOVERY_PASSWORD`, `ZAPIER_WEBHOOK_URL`, `VITE_GOOGLE_PLACES_API_KEY`, and `OPENAI_KEY`. None exists in the staging app. No production secret may be copied to satisfy this inventory.

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
| 22 | `ZAPIER_WEBHOOK_URL` | Environment-specific submission webhook | Later; only separate staging sink | Yes currently | Yes | No |
| 23 | `ZAPIER_WEBHOOK_SIGNING_SECRET` | Future webhook request signing when supported | Later | Later | Yes | No |
| 24 | `OPENAI_KEY` | Direct OpenAI validation/content calls | Later; separate project/key or mock | Yes currently | Yes | No |
| 25 | `BASE44_APP_ID` | Backend app identity supplied by Base44 | Platform-provided | Platform-provided | Yes | No |
| 26 | `BASE44_SERVICE_ROLE_KEY` | Base44 backend service-role authorization | Platform-provided | Platform-provided | Yes | No |
| 27 | `VITE_BASE44_APP_ID` | Optional client Base44 app override | No unless explicitly required | No unless explicitly required | Yes | No |
| 28 | `VITE_BASE44_BACKEND_URL` | Optional client backend override | No unless explicitly required | No unless explicitly required | Prefer Yes | No |
| 29 | `VITE_GOOGLE_PLACES_API_KEY` | Browser Places API key; observed as a production secret name | Later; separate restricted key or mock | Yes currently | Yes | No |
| 30 | `STAGING_FILE_STORAGE_MODE` | Future `mock` or isolated staging-storage selector | Later | No | Yes | No |
| 31 | `STAGING_FILE_STORAGE_NAMESPACE` | Future staging upload namespace/bucket prefix | Later | No | Yes | No |
| 32 | `PDF_STAGING_DESTINATION` | Future PDF sink selector; current PDF is browser-only | No | No | Yes if introduced | No |
| 33 | `ERROR_REPORTING_ENVIRONMENT` | Environment tag for any future telemetry/error reporter | Later | Later | Yes | No |
| 34 | `VITE_CLARITY_PROJECT_ID` | Future separate Clarity project identifier | Later or disabled | Later | Yes | No |
| 35 | `VITE_HOTJAR_SITE_ID` | Future separate Hotjar site identifier | Later or disabled | Later | Yes | No |
| 36 | `VITE_APP_VERSION` | Safe build/release identifier | Yes | Yes | Prefer Yes | Yes only when both environments run the same immutable build |
| 37 | `BASE44_LEGACY_SDK_IMPORTS` | Non-secret Vite compatibility build switch | No | No | No | Yes; non-secret build setting only |
| 38 | `STAGING_TEST_DATA_PREFIX` | Synthetic fixture namespace and cleanup selector | Later | No | Yes | No |
| 39 | `STAGING_CLEANUP_TOKEN_SECRET` | Future narrowly scoped cleanup-job authorization | Later | No | Yes | No |

`ALLOW_PRODUCTION_DEPLOY=false` is a non-sensitive safe default, not authorization. All app IDs remain outside Git even though identifiers are not access credentials.

## Rotation, ownership, and value-safe validation

| Name group | Rotation requirement | Owner | Validation without exposing value |
| --- | --- | --- | --- |
| Deployment target variables (1-7) | Revalidate at every invocation; rotate/update when an app, branch, or release changes | Release owner | Run `verify:base44-target`; compare only SHA-256 app-ID fingerprints and safe PASS/failure codes |
| Staging email/SES (8-13) | Rotate credentials on personnel/policy incident and at the organization standard; revalidate sender/config after change | Messaging owner + Security | Names-only secret listing; send only synthetic mail after redirect tests; record recipient class/domain hash, never address/value |
| Recovery/token secrets (14-19) | Independently version and rotate; rotation must revoke or version old grants/tokens | Application owner + Security | Names-only listing plus backend challenge tests with synthetic invalid/valid fixtures; never log raw password/token/code |
| CAPTCHA (20-21) | Separate environment keys; rotate on disclosure/abuse/provider recommendation | Security + Application owner | Provider dashboard key fingerprint/last-four under restricted review; automated staging verification with synthetic provider response |
| Webhook (22-23) | Rotate URL/secret on exposure, destination change, or incident | Integration owner + Security | Names-only listing; destination host/class and one-way fingerprint in evidence; synthetic sink receipt only |
| AI (24) | Separate key/project; rotate on disclosure, owner change, or provider policy | AI service owner + Security | Names-only listing; synthetic minimal completion and project/budget metadata reviewed outside Git |
| Base44 platform identity (25-28) | App-scoped/platform-managed; rotate service role on compromise; never manually copy | Base44 workspace owner | Deployment guard fingerprint, names-only configuration inspection, and app-scoped read-only checks |
| Maps (29) | Separate staging key; rotate on disclosure; maintain environment-specific referrer/API restrictions | Web platform owner | Provider key restrictions and allowed-origin review; synthetic Places request; never print key |
| File/PDF (30-32) | Rotate cleanup authorization if introduced; configuration changes require destination review | Data/storage owner | Write synthetic marker, read metadata only, cleanup it, and prove no production URL/app ID is accepted |
| Telemetry (33-35) | Separate project/property identifiers; rotate tokens if a future private ingest token is added | Observability + Privacy owner | Inspect environment label/project fingerprint and run synthetic event; production property denylist must pass |
| Build/test cleanup (36-39) | App version changes per release; rotate cleanup authorization on schedule/incident | Release owner + QA/data owner | Inspect non-secret build metadata; cleanup dry run selects only `environment=staging` plus `test_run_id`/prefix |

## Current gaps and prohibitions

- No SES/AWS, email redirect, CAPTCHA, staging webhook, staging AI, cleanup, telemetry, or file/PDF staging secret has been created.
- The production Zapier destination is not a staging default. The committed fallback destination must be removed or fail closed before functions are deployed to staging.
- Production analytics IDs, the production Places key, recovery password, OpenAI key, service-role material, and webhook URL must not be copied.
- `VITE_*` values are exposed to the browser. They must never contain a private credential.
- A missing redirect, webhook, AI, CAPTCHA, or environment declaration must suppress the related side effect; it must not select production.

No secret was created, changed, copied, rotated, printed, or committed during this inventory.
