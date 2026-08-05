# Staging Deployment Readiness Checklist

- Current status: **STAGING_CREATED_NOT_READY_FOR_DEPLOYMENT**
- Review date: 2026-08-05
- Deployment authorization: **DENIED**
- Deployment evidence directory/report: **NOT_READY**

This checklist is fail-closed. `READY` means current evidence exists; `NOT_READY` blocks deployment. `MANUAL_VERIFICATION_REQUIRED` also blocks deployment until dated evidence is captured immediately before the authorized deployment.

## Gate checklist

| # | Required gate | Status | Current evidence / remaining work |
| ---: | --- | --- | --- |
| 1 | Target guard passes | `READY` | Guard unit suite passes, fingerprint-only verification passes, and the prior clean staging matrix passed with safe staging values. Re-run normal verification immediately before deployment. |
| 2 | App ID is confirmed | `READY` | Staging SHA-256 fingerprint matches the registration and differs from production; full IDs remain outside Git. |
| 3 | Branch is `feature/durable-draft-recovery` | `READY` | Both primary and staging checkouts are on the feature branch. |
| 4 | Working tree is clean | `READY` | Clean at this audit's start; must be clean again at deployment time. |
| 5 | Tests pass | `NOT_READY` | Target tests pass, but the normal suite retains known failures. No deployment exception is approved. |
| 6 | Production build passes | `READY` | Current baseline build passes; re-run on the exact deployment revision. |
| 7 | Staging environment variables are present | `NOT_READY` | Deployment examples exist, but staging has zero configured Base44 secrets and no approved ignored environment file is certified. |
| 8 | External side effects are disabled or redirected | `NOT_READY` | Zapier is now server-policy controlled and defaults disabled, but OpenAI, analytics, Hotjar, Places, public assets, uploads, and parent callbacks still require staging controls/denylists. |
| 9 | Staging email redirect is tested | `NOT_READY` | No email implementation or `STAGING_EMAIL_REDIRECT_TO` exists. Missing redirect must suppress sending; `[STAGING]` prefix and destination rewrite tests are absent. |
| 10 | No production data exists | `READY` | Current privileged read-only checks report all four known project entity schemas unavailable in staging; creation-time dashboard evidence reported no data tables. Recheck after any resource deployment. |
| 11 | No production domain is attached | `MANUAL_VERIFICATION_REQUIRED` | Creation-time dashboard evidence showed only the generated free Base44 URL. No documented CLI state command exists; capture a fresh Domains screenshot/report before deployment. |
| 12 | Synthetic fixtures are ready | `NOT_READY` | Fixtures must be irreversibly synthetic/de-identified and include `test_run_id` plus `environment=staging`. |
| 13 | Cleanup procedure is ready | `NOT_READY` | Implement dry-run/select/delete/report behavior scoped by staging app ID, environment marker, and test-run ID; test that production IDs cannot be selected. |
| 14 | Visible staging banner is implemented | `READY` | The application shell renders the exact persistent warning only when environment is `staging` and the banner flag is exactly `true`. Focused tests and local previews cover questionnaire, thank-you, and admin routes. |
| 15 | Production IDs are denylisted | `NOT_READY` | Deployment targets are cross-checked and staging Zapier selection cannot fall back to production, but analytics, Maps, asset, storage, email, migration, and cleanup production identifiers are not comprehensively denylisted. |
| 16 | Feature flags are environment-isolated and fail closed | `READY` | Central frontend/backend runtime modules require recognized environments and exact lowercase controls. V2/recovery defaults remain off, client/server authorization is independent, and kill switches override ordinary enable flags. |
| 17 | Rollback/delete-staging procedure is documented and rehearsed | `NOT_READY` | Draft procedure appears below; owner approval and a non-destructive rehearsal/evidence record are still required. |
| 18 | `npx base44 whoami` succeeds | `READY` | Authenticated check succeeded before this prompt's read-only CLI operations. |
| 19 | No production deploy wrapper is invoked | `READY` | Neither deployment wrapper nor any deploy/push command was executed. This must remain true until a separate authorization. |
| 20 | Deployment has an evidence directory/report | `NOT_READY` | Define an immutable evidence path containing revision, guard output, tests/build, side-effect proofs, dashboard checks, approver, timestamps, rollback reference, and post-deploy smoke results. |
| 21 | Safe build metadata is present | `READY` | Frozen metadata exposes only environment, sanitized SHA/time, and safe feature booleans. Missing SHA/time becomes `unknown`; no app ID, URL, token, email, or recovery code is included. |
| 22 | Runtime markers are machine-verifiable | `READY` | One route-independent shell exposes safe `data-*` markers. Local staging and production previews produced the expected environment/build/disabled-feature values. |
| 23 | Zapier external delivery is fail closed | `READY` | Shared backend policy requires exact environment/mode pairs, resolves destinations only from server variables, defaults staging to disabled, rejects missing redirect configuration, and exposes no URL/payload in responses or logs. |
| 24 | Zapier caller outcomes are truthful | `READY` | Main submit, retry, repair, fallback-result plumbing, and admin/test callers distinguish delivered, redirected, suppressed, and failed outcomes. Suppression never sets `zapier_sent=true`; safe diagnostics use existing JSON fields without schema changes. |

## Environment-identification verification

The following local verification is implementation evidence only. It does not authorize a staging deployment.

| Verification | Result | Evidence |
| --- | --- | --- |
| Focused banner/runtime tests | `PASS` | `src/test/environmentIdentification.test.jsx`: 12 tests pass; combined with the Prompt 1 frontend runtime tests, 31/31 pass. |
| Staging questionnaire route | `PASS` | Local preview `/` rendered exactly one banner with the required text and `data-app-environment=staging`. |
| Staging thank-you route | `PASS` | Local preview `/thank-you` rendered exactly one banner with the required text. |
| Staging admin route | `PASS` | Local preview `/admin/draft-recovery` rendered exactly one banner without changing its authorization gate. |
| Production banner isolation | `PASS` | Production preview rendered zero staging banners even when `VITE_STAGING_BANNER_ENABLED=true` was deliberately supplied. |
| Production runtime markers | `PASS` | Environment reported `production`; V2, public email recovery, OTP, and magic link reported `false`; kill switch reported `true`. |
| Production bundle warning text | `PASS` | The staging warning string exists in bundled code because the component is compiled, but rendered-DOM verification proves it is absent under production configuration. |
| Compiled secret scan | `PASS` | No AWS/recovery secret names with values, token fixture values, or real Zapier/Slack webhook URL matched the production output scan. |

## External-side-effect isolation verification

The following is local implementation evidence only. Every network-capable test injects a fake adapter; no real webhook is configured or contacted.

| Verification | Result | Evidence |
| --- | --- | --- |
| Shared policy and function/caller suite | `PASS` | `src/test/proExternalSideEffects.test.js` covers production/staging routing, disabled/unknown/test zero-fetch behavior, missing destinations, request override rejection, HTTPS, timeout, non-2xx, safe output/logs, diagnostics, caller compatibility, and entrypoint divergence. |
| Staging default | `PASS` | `PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE=disabled` returns `success=true`, `suppressed=true`, `delivered=false`, and performs zero fetch calls without requiring a staging URL. |
| Staging redirect fail-closed | `PASS` | `staging_redirect` without `STAGING_ZAPIER_WEBHOOK_URL` fails with no fetch and never selects `PRO_ZAPIER_WEBHOOK_URL`. |
| Production activation boundary | `PASS` | Production delivery requires both `PRO_DRAFT_ENVIRONMENT=production` and `PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE=production`; tests use an invalid-domain URL and injected fetch only. |
| Hardcoded destination removal | `PASS` | Repository scan finds no production Zapier host/path or credential-bearing fallback in committed source. Only server variable names remain. |
| Public/log secrecy | `PASS` | Function result contains the ten approved safe fields; URL and external body are omitted; logs contain request ID, environment, mode, payload byte size, safe submission ID, and external status only. |
| SES/email | `NOT_IMPLEMENTED` | No email delivery was added or tested in this prompt. Email remains disabled. |

Native Vite `VITE_*` replacement supplies build SHA/time once per build. `vite.config.js` remains unchanged, preserving the Base44 plugin and `BASE44_LEGACY_SDK_IMPORTS` behavior without exposing `process.env` through `define`.

## Current read-only staging state

| Check | Result | Evidence |
| --- | --- | --- |
| App exists and is reachable | `PASS` | Authenticated app-scoped function/secret/entity read commands completed against the staging-linked checkout. |
| App-ID fingerprint | `PASS` | Fingerprint `682b3ba54771331270952c7f4a3ac25035417cc9376a93e8b14ffca2e77051f5` matches the registration. |
| Distinct production/staging IDs | `PASS` | Registered SHA-256 fingerprints differ; full IDs are not recorded. |
| Cloud app name ends `_staging` | `MANUAL_VERIFICATION_REQUIRED` | Creation-time authenticated dashboard evidence recorded `Pro Website Questionnaire_staging`; the documented CLI exposes no current app-name query. Reconfirm in Overview before deployment. |
| Remote functions | `PASS` | Current read-only function list count is zero. |
| Known project entity schemas/records | `PASS` | Privileged read-only checks returned `SCHEMA_UNAVAILABLE` for `ProFormDraft`, `ProFormDraftEvent`, `ProFormSubmission`, and `ProFormSubmissionIntake`; therefore those project record stores are not deployed. |
| Staging secrets | `PASS` | Current names-only secret list reports no configured secrets. |
| Custom domain | `MANUAL_VERIFICATION_REQUIRED` | Creation-time Domains evidence reported no custom domain. Reconfirm in the dashboard because no supported read-only CLI state command is documented. |
| Site deployment/default shell | `MANUAL_VERIFICATION_REQUIRED` | No site deploy was run in this batch. Dashboard must distinguish an empty Base44-provided shell from a user-deployed site. |
| Authorized connectors | `MANUAL_VERIFICATION_REQUIRED` | Creation-time connector pull/dashboard evidence reported zero. No supported non-writing current-authorization CLI command is documented; recheck `My integrations` without initiating OAuth. |
| Scheduled automations | `MANUAL_VERIFICATION_REQUIRED` | No repository schedule/cron resource exists. Confirm the staging dashboard has no automation before deployment. |
| Production webhook active in staging | `PASS` | Zero remote functions and zero secrets mean no current staging execution path calls Zapier. Current source also contains no hardcoded fallback and would suppress Zapier while mode remains `disabled`; this does not resolve other deployment blockers. |
| Production email path active in staging | `PASS` | No remote functions/secrets and no active email caller/SES implementation were found. |

## Staging email gate

Email stays disabled until all statements are true:

- `STAGING_EMAIL_REDIRECT_TO` exists only as a staging Base44 secret.
- The server rewrites every destination, including retries/repairs/fallbacks, to that internal address.
- Every subject begins `[STAGING]`.
- The entered client email is never the actual destination and is only shown synthetically or redacted in the body.
- Missing redirect configuration suppresses sending and produces a safe failure code.
- Automated tests cover normal, missing-secret, retry, repair, queue, and bypass paths.
- SES account/region/sandbox/sender/IAM/quota/bounce/complaint status is separately inventoried.

## Staging data gate

- Import only synthetic fixtures marked with both `test_run_id` and `environment=staging`.
- Do not import production records, backups, uploaded files, URLs, or credentials.
- Any approved sample must undergo irreversible de-identification before import.
- Cleanup must support dry run, exact test-run selection, evidence output, and a production-app-ID/environment hard stop.
- Staging data must never be a migration source for green production.
- Uploads use isolated staging storage or mocks; PDFs remain local/synthetic unless a separately reviewed staging destination is introduced.

## Draft rollback/delete-staging procedure

This is a documentation draft, not authorization to delete or modify the app.

1. Stop all staging traffic and side effects; revoke the staging-only release flag.
2. Capture the app fingerprint, feature revision, evidence report, synthetic record counts, function/connector/secret/domain state, and owner approval without secret values.
3. For code rollback, select a reviewed feature-branch commit, rerun every target/side-effect/test/build gate, and use only the staging wrapper under a separately authorized deployment prompt.
4. For data cleanup, run the future cleanup tool in dry-run mode and require `environment=staging`, `test_run_id`, and the staging app-ID fingerprint; production app IDs must hard-fail.
5. For full staging deletion, require explicit workspace-owner authorization, reconfirm the staging fingerprint/name/domain, disconnect only staging resources, and use a documented Base44 dashboard operation because no supported delete-app CLI command is assumed.
6. Reconfirm that the production app fingerprint, domain, records, secrets, connectors, and feature branch were untouched.
7. Store the completed rollback/deletion report outside any secret-bearing channel and retain the sanitized evidence link in the release record.

The procedure remains `NOT_READY` until reviewed and rehearsed without deleting the staging app.

## Manual verification package required before deployment

Capture sanitized, dated evidence for:

1. Overview name/workspace and `_staging` suffix.
2. Domains: no production custom domain.
3. Data: no unexpected tables/records after resource deployment and before fixture creation.
4. `My integrations`: no production connector authorization.
5. Site: empty/default-shell versus deployed revision.
6. Automations: no schedules or jobs.
7. Future SES account state, sender, region, IAM, quota, bounce, and complaint configuration before email enablement.
8. Zapier staging sink and downstream action inventory before webhook enablement.

## Decision

**STAGING_CREATED_NOT_READY_FOR_DEPLOYMENT**

Do not run `deploy:base44:staging`, `deploy:base44:production`, direct Base44 deploy commands, function/entity/agent/connector/auth/site pushes, secret writes, OAuth authorization, data import, domain attachment, email, or production webhook calls until every blocker is resolved and a separate prompt authorizes the exact deployment.
