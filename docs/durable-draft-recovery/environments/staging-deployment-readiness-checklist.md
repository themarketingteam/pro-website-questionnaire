# Staging Deployment Readiness Checklist

- Current status: **STAGING_CREATED_NOT_READY_FOR_DEPLOYMENT**
- Review date: 2026-08-05 (America/Chicago)
- Deployment authorization: **DENIED**
- Primitive certification: [**SECURITY_PRIMITIVES_CERTIFIED_IN_STAGING**](../security/staging-security-primitives-certification.md)
- Latest deployment evidence/report: [**STAGING SECURITY PRIMITIVES CERTIFICATION**](../security/staging-security-primitives-certification.md)

This checklist is fail-closed. `READY` means current evidence exists; `NOT_READY` blocks deployment. `MANUAL_VERIFICATION_REQUIRED` also blocks deployment until dated evidence is captured immediately before the authorized deployment.

## Gate checklist

| # | Required gate | Status | Current evidence / remaining work |
| ---: | --- | --- | --- |
| 1 | Target guard passes | `READY` | The normal staging guard passed immediately before secret import and targeted function deployment on clean candidate `b719b0c`; staging and production fingerprints remained distinct. |
| 2 | App ID is confirmed | `READY` | Staging SHA-256 fingerprint matches the registration and differs from production; full IDs remain outside Git. |
| 3 | Branch is `feature/durable-draft-recovery` | `READY` | Both primary and staging checkouts were verified on the feature branch; `main` was not checked out or pushed. |
| 4 | Working tree is clean | `READY` | The staging checkout was clean at deployed candidate `b719b0c` for the target-guard and deployment operations. Documentation evidence was added later in the primary checkout. |
| 5 | Tests pass | `NOT_READY` | Primitive gates pass: 49/49 security, 41/41 authorization, 129/129 persistence, 18/18 self-check, and 237/237 combined in staging. The full normal suite remains 1005/1010 with the same five unrelated questionnaire/repair failures; application release certification remains blocked. |
| 6 | Production build passes | `NOT_READY` | Historical candidate build evidence exists, but the required build rerun in this certification attempt was not reached after the normal suite failed. |
| 7 | Staging environment variables are present | `NOT_READY` | Six independent cryptographic purpose secrets plus `PRO_DRAFT_ENVIRONMENT=staging` and `PRO_DRAFT_DIAGNOSTICS_ENABLED=true` are certified. Broader application staging variables and side-effect controls remain incomplete. |
| 8 | External side effects are disabled or redirected | `NOT_READY` | Zapier is now server-policy controlled and defaults disabled, but OpenAI, analytics, Hotjar, Places, public assets, uploads, and parent callbacks still require staging controls/denylists. |
| 9 | Staging email redirect is tested | `NOT_READY` | No email implementation or `STAGING_EMAIL_REDIRECT_TO` exists. Missing redirect must suppress sending; `[STAGING]` prefix and destination rewrite tests are absent. |
| 10 | No production data exists | `READY` | Current privileged read-only checks report all four known project entity schemas unavailable in staging; creation-time dashboard evidence reported no data tables. Recheck after any resource deployment. |
| 11 | No production domain is attached | `MANUAL_VERIFICATION_REQUIRED` | Creation-time dashboard evidence showed only the generated free Base44 URL. No documented CLI state command exists; capture a fresh Domains screenshot/report before deployment. |
| 12 | Synthetic fixtures are ready | `READY` | The E2E factories provide stable text, textarea, radio, checkbox, geographic, numeric, certification, guarantee, and isolated-client values with `E2E STAGING`, `example.test`, environment, and test-run markers. Write fixtures remain staging-only and require exact opt-in. Cleanup readiness is a separate blocking gate below. |
| 13 | Cleanup procedure is ready | `NOT_READY` | Implement dry-run/select/delete/report behavior scoped by staging app ID, environment marker, and test-run ID; test that production IDs cannot be selected. |
| 14 | Visible staging banner is implemented | `READY` | The application shell renders the exact persistent warning only when environment is `staging` and the banner flag is exactly `true`. Focused tests and local previews cover questionnaire, thank-you, and admin routes. |
| 15 | Production IDs are denylisted | `NOT_READY` | Deployment targets are cross-checked and staging Zapier selection cannot fall back to production, but analytics, Maps, asset, storage, email, migration, and cleanup production identifiers are not comprehensively denylisted. |
| 16 | Feature flags are environment-isolated and fail closed | `READY` | Central frontend/backend runtime modules require recognized environments and exact lowercase controls. V2/recovery defaults remain off, client/server authorization is independent, and kill switches override ordinary enable flags. |
| 17 | Rollback/delete-staging procedure is documented and rehearsed | `NOT_READY` | Draft procedure appears below; owner approval and a non-destructive rehearsal/evidence record are still required. |
| 18 | `npx base44 whoami` succeeds | `READY` | Authentication succeeded in the separate staging checkout. The live self-check also proved the current user reaches exact Base44 role `admin`. |
| 19 | No production deploy wrapper is invoked | `READY` | Neither deployment wrapper nor any deploy/push command was executed. This must remain true until a separate authorization. |
| 20 | Deployment has an evidence directory/report | `NOT_READY` | The [security primitive report](../security/staging-security-primitives-certification.md) certifies the exact self-check deployment, secrets, admin invocation, safe response, and production isolation. Entity, site, browser, migration, side-effect, and full application evidence remains absent. |
| 21 | Safe build metadata is present | `READY` | Frozen metadata exposes only environment, sanitized SHA/time, and safe feature booleans. Missing SHA/time becomes `unknown`; no app ID, URL, token, email, or recovery code is included. |
| 22 | Runtime markers are machine-verifiable | `READY` | One route-independent shell exposes safe `data-*` markers. Local staging and production previews produced the expected environment/build/disabled-feature values. |
| 23 | Zapier external delivery is fail closed | `READY` | Shared backend policy requires exact environment/mode pairs, resolves destinations only from server variables, defaults staging to disabled, rejects missing redirect configuration, and exposes no URL/payload in responses or logs. |
| 24 | Zapier caller outcomes are truthful | `READY` | Main submit, retry, repair, fallback-result plumbing, and admin/test callers distinguish delivered, redirected, suppressed, and failed outcomes. Suppression never sets `zapier_sent=true`; safe diagnostics use existing JSON fields without schema changes. |
| 25 | GitHub branch protection requires quality checks | `NOT_READY` | Workflow sources define source safety, unit quality, build, E2E harness, and pending-report checks. A repository administrator must run them and configure/verify the `main` ruleset; Codex does not assume administration permission. |
| 26 | Manual staging E2E is available and safe | `NOT_READY` | The `workflow_dispatch`-only workflow rejects missing/production URLs and forces writes off, but no deployed staging URL or configured `PRO_DRAFT_STAGING_URL` secret exists, so no staging browser evidence can be collected yet. |
| 27 | Separate staging checkout matches candidate | `READY` | The separate staging clone was fast-forwarded locally without an early remote push and matched deployed candidate `b719b0c`; branch, clean tree, and fingerprint were checked before deployment. |

## Automated repository gate

All validation runs from the repository root. `npm run test:manifest` enforces the normal, characterization, and Playwright naming boundaries and currently reports 51 normal files, 5 characterization files, and 6 Playwright specs. `.github/workflows/durable-draft-quality.yml` runs source safety, all authoritative quality gates, a disabled-V2 build, Chromium harness mechanics, and the non-strict pending report for `main` pull requests and feature-branch pushes. `.github/workflows/durable-draft-staging-e2e.yml` is manual-only and reads the separate staging URL exclusively from `PRO_DRAFT_STAGING_URL`. Neither workflow deploys. Branch protection guidance and remaining manual administration are recorded in [GitHub Actions and branch protection](../testing/github-actions-and-branch-protection.md).

`npm run check` remains the staging and production wrapper gate: it executes lint, typecheck, `test:ci`, and build and reports all four outcomes. Characterization tests are run separately with `npm run test:baseline-characterization`; they preserve known-defect evidence and cannot certify a release. `npm run test:e2e:pending-strict` is required before release but deliberately remains outside foundation CI until the later implementation gate; it currently fails on 8 pending server/concurrency/offline/security scenarios across 4 requirement IDs.

Historical local evidence includes 27/27 passing characterization tests, 207/207 focused canonical-cache/Redux tests, and 70/70 active browser-local cache/isolation executions across all five projects. In the latest entity-extension attempt, the schema validator and focused fixtures passed 18/18, but `npm test` failed 5 of 780 normal tests. The attempt stopped at that command; canonical, identity, submission/PDF, intake/repair, lint, typecheck, build, target guard, inventory, entity push, generated types, CRUD/FLS, and browser smoke were not run. Deployment authorization stays denied.

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
| Exact candidate alignment | `PASS` | The staging clone matched deployed candidate `b719b0c` before the targeted function deployment. |
| Cloud app name ends `_staging` | `MANUAL_VERIFICATION_REQUIRED` | Creation-time authenticated dashboard evidence recorded `Pro Website Questionnaire_staging`; the documented CLI exposes no current app-name query. Reconfirm in Overview before deployment. |
| Remote functions | `PASS` | Names-only post-deploy inventory reports exactly one function, the staging-only `proDraftSecuritySelfCheck`. No public draft API was deployed. |
| Known project entity schemas/records | `PASS` | Privileged read-only checks returned `SCHEMA_UNAVAILABLE` for `ProFormDraft`, `ProFormDraftEvent`, `ProFormSubmission`, and `ProFormSubmissionIntake`; therefore those project record stores are not deployed. |
| Staging secrets | `PASS` | Names-only inventory reports exactly eight names: six independent cryptographic purpose secrets plus the environment and diagnostic controls. No value was printed or copied from production. |
| Custom domain | `MANUAL_VERIFICATION_REQUIRED` | Creation-time Domains evidence reported no custom domain. Reconfirm in the dashboard because no supported read-only CLI state command is documented. |
| Site deployment/default shell | `MANUAL_VERIFICATION_REQUIRED` | No site deploy was run in this batch. Dashboard must distinguish an empty Base44-provided shell from a user-deployed site. |
| Authorized connectors | `MANUAL_VERIFICATION_REQUIRED` | Creation-time connector pull/dashboard evidence reported zero. No supported non-writing current-authorization CLI command is documented; recheck `My integrations` without initiating OAuth. |
| Scheduled automations | `MANUAL_VERIFICATION_REQUIRED` | No repository schedule/cron resource exists. Confirm the staging dashboard has no automation before deployment. |
| Production webhook active in staging | `PASS` | The only remote function is the in-memory security self-check; it has no fetch, integration, or entity operation. No webhook secret or destination is configured in staging. |
| Production email path active in staging | `PASS` | The only remote function has no email operation, and no SES/email secret or caller is configured. |

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

The narrow backend result is **SECURITY_PRIMITIVES_CERTIFIED_IN_STAGING**. That classification authorizes no further deployment and does not change the overall **STAGING_CREATED_NOT_READY_FOR_DEPLOYMENT** decision. Five unrelated normal tests and broader entity/site/side-effect/data/browser/rollback gates remain incomplete. Do not run another Base44 deploy/push, production operation, OAuth authorization, data import, domain attachment, email, or webhook call without new exact authorization and passing applicable gates.

### 2026-08-05 authoritative API attempt

The [authoritative draft API report](../backend/staging-authoritative-draft-api-certification.md)
is **AUTHORITATIVE_DRAFT_APIS_BLOCKED**. Focused client/backend tests passed,
but the ordered full normal suite failed 5 of 1,160 tests. The source-gate hard
stop occurred before staging checkout update, fingerprint collection, target
guard, secret/flag configuration, schema push, function deployment, live API or
concurrency checks, fixture creation/cleanup, and deployed frontend regression.
No readiness item is promoted by this attempt, and the decision remains
**STAGING_CREATED_NOT_READY_FOR_DEPLOYMENT**.
