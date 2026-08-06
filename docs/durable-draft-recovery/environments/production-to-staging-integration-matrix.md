# Production-to-Staging Integration Matrix

- Status: **ZAPIER_ISOLATED_OTHER_SURFACES_NOT_SAFE_TO_ENABLE**
- Inventory date: 2026-08-05
- Count: **22 integration and side-effect surfaces**
- Scope: repository source, Base44 resources, configuration, existing durable-draft documentation, and names-only/read-only Base44 checks

This inventory records names and destination types only. It intentionally omits app IDs, secret values, access tokens, assistant IDs, analytics property IDs, API keys, and token-bearing webhook paths.

## Discovery evidence

The audit searched environment-variable access, HTTP destinations, Base44 SDK calls, functions, agents, connectors, entity writes, OpenAI, AWS/SES, Zapier/webhooks, PDF generation, uploads/storage, CAPTCHA, analytics, error reporting, collaboration/CRM/database services, S3/CloudFront, callbacks, recovery authorization, scheduled work, email recipients, and repair/retry paths.

The names-only production secret check returned four names: `DRAFT_RECOVERY_PASSWORD`, the legacy Zapier destination name, `VITE_GOOGLE_PLACES_API_KEY`, and `OPENAI_KEY`. The read-only production function list returned seven top-level functions and no nested `/entry` function names. The isolated staging app returned zero remote functions. No secret value was requested or displayed, and no cloud configuration was changed.

## Inventory: source, destination, and data

| ID | Name | Source file/function | Environment variable or Base44 secret names | Production destination type | Data sent or stored |
| --- | --- | --- | --- | --- | --- |
| `INT-001` | Base44 draft persistence | `src/lib/draftPersistence.js`; `src/pages/ProQuestionnaire.jsx`; `ProFormDraft` | App-scoped Base44 runtime; `VITE_BASE44_APP_ID`, `VITE_BASE44_BACKEND_URL` may influence client routing | Production Base44 entity | Session/client identity, full response JSON, validation/touched/expanded state, mapped payload, upload metadata, and lifecycle status |
| `INT-002` | Base44 draft-event stream | `src/pages/ProQuestionnaire.jsx`; `src/lib/proQuestionnaireSubmit.js`; `ProFormDraftEvent` | App-scoped Base44 runtime | Production Base44 entity | Session/business context, event type, question ID/type, and serialized changed values or submit-stage metadata |
| `INT-003` | Questionnaire final-submission endpoint | `src/lib/proSubmissionResilience.js`; `src/lib/proQuestionnaireSubmit.js`; `ProFormSubmission` | App-scoped Base44 runtime | Production Base44 entity | Complete transformed questionnaire metadata and user data, including business/client context and uploaded-file URLs |
| `INT-004` | Intake fallback endpoint | `submitProQuestionnaireFallback`; `ProFormSubmissionIntake` | App-scoped Base44 runtime | Production Base44 function and intake/submission entities | Raw and transformed questionnaire payloads, client identifiers, diagnostics, primary/fallback errors, and final linkage |
| `INT-005` | Zapier submission delivery | `sendToZapier`; `retryProQuestionnaireIntakeSubmission`; `repairProQuestionnaireIntakeSubmission`; `src/lib/proQuestionnaireSubmit.js`; shared side-effect policy | `PRO_DRAFT_ENVIRONMENT`, `PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE`, `PRO_ZAPIER_WEBHOOK_URL`, `STAGING_ZAPIER_WEBHOOK_URL`, `PRO_ZAPIER_TIMEOUT_MS` | Server-selected production Zapier workflow or separately configured staging redirect; no destination remains hardcoded | Complete final questionnaire payload and related business/client data |
| `INT-006` | Submission retry | `retryProQuestionnaireIntakeSubmission`; recovery UIs | `DRAFT_RECOVERY_PASSWORD` plus the five side-effect variables in `INT-005` | Environment-scoped Base44 entities plus policy-selected Zapier destination | Existing draft/intake/final payload, retry state, linked IDs, safe delivery diagnostics, and webhook body when allowed |
| `INT-007` | AI repair and repair-and-retry | `repairProQuestionnaireIntakeSubmission`; `pro_submission_repair_agent`; shared side-effect policy | `DRAFT_RECOVERY_PASSWORD`; Base44 app-scoped agent authorization; the five side-effect variables in `INT-005` | Base44 agent/entities and, only when policy allows, the environment-scoped Zapier destination | Raw payload, errors, repair prompt/report, repaired payload, entity updates, safe delivery diagnostics, and webhook body when allowed |
| `INT-008` | Draft recovery password/grant | `verifyDraftRecoveryAccess`; retry/repair authorization helpers; admin recovery UIs | `DRAFT_RECOVERY_PASSWORD`; future `PRO_FORM_ADMIN_GRANT_SECRET` | Production Base44 function and persistent browser grant | Submitted password, signed authorization grant, scope/version/expiry metadata; no questionnaire payload is required for verification |
| `INT-009` | OpenAI answer validation | `validateQuestionText`; `src/components/pro-form/useTextValidation.jsx`; `src/pages/ProQuestionnaire.jsx` | `OPENAI_KEY` | OpenAI chat-completions API | Questionnaire answer text and question context; free text can contain client PII |
| `INT-010` | OpenAI assistant content generation | `generateAIContentOpenAI`; dormant `AIContentModal` path | `OPENAI_KEY`; assistant identifier is source-configured and intentionally omitted | OpenAI Assistants API | Instruction, question context, draft content, business name, and form context |
| `INT-011` | Base44 content-strategist agent | `generateAIContent`; `_shared/base44Agent`; `msp_content_strategist` | `BASE44_APP_ID`, `BASE44_SERVICE_ROLE_KEY` | Base44 agent/conversation API | Instruction, questionnaire context, draft content, and conversation messages |
| `INT-012` | Base44 Core upload/storage | `FileUploadQuestion`, `ImageTaggingQuestion`, `MultiCertificationQuestion`, `MultiGuaranteeQuestion` | App-scoped Base44 runtime; no custom storage secret in source | Base44 managed file storage | Client-selected images, PDFs, Word/text files, filenames, and resulting URLs |
| `INT-013` | Browser PDF generation/download | `PDFGenerator.jsx`; `pdf/*`; `useQuestionnairePdfDownload.js` | None currently; future `PDF_STAGING_DESTINATION` only if server storage is introduced | Client browser download; no current backend PDF destination | Submitted questionnaire snapshot, business name/domain, embedded images, and public branding assets |
| `INT-014` | Source-only SES transport and dormant Base44 email capability | Backend-only `proDraftEmailTransport`/`proDraftEmailTemplates`; `src/api/integrations.js` exports unused `SendEmail`; no active caller or deployed SES function | Preferred `PRO_DRAFT_EMAIL_MODE`, sender, AWS, timeout, recovery-base, and staging-redirect names; documented standard AWS/legacy sender aliases | No active production email path; future Amazon SES v2 delivery only after separate deployment/configuration | Future recovery code, safe business display name, and instructions only; no answers or current production recipient |
| `INT-015` | Other dormant Base44 Core capabilities | `src/api/integrations.js` exports `SendSMS`, `GenerateImage`, and `ExtractDataFromUploadedFile`; no caller found | App-scoped Base44 runtime | Base44 Core integration layer | None currently; future data depends on the caller |
| `INT-016` | Microsoft Clarity analytics | `index.html`; `src/lib/clarity.js`; questionnaire and PDF call sites | Current property identifier is source-configured; future `VITE_CLARITY_PROJECT_ID`; `ERROR_REPORTING_ENVIRONMENT` | Microsoft Clarity production property | Business domain, user ID/friendly label when present, page path, question IDs/types, answer metadata, validation/submit status, and PDF event metadata |
| `INT-017` | Hotjar analytics | `src/components/HotjarTracking.jsx`; `src/Layout.jsx` | Current site identifier is source-configured; future `VITE_HOTJAR_SITE_ID`; `ERROR_REPORTING_ENVIRONMENT` | Hotjar production property | Browser/session behavior, page content/interaction, request metadata, and any data captured under the active Hotjar configuration |
| `INT-018` | Base44 application logging | `src/lib/NavigationTracker.jsx` | App-scoped Base44 runtime; future `ERROR_REPORTING_ENVIRONMENT` | Base44 app logs | Authenticated page name and app/user context |
| `INT-019` | Google Maps/Places | `index.html`; `MultiGeographicQuestion.jsx` | `VITE_GOOGLE_PLACES_API_KEY` is configured in production; a browser key is also source-configured and must be removed from hardcoded configuration | Google Maps JavaScript and Places APIs | User-entered place query, formatted address, place ID, coordinates, and address components |
| `INT-020` | External public assets/CDNs | `FormHeader.jsx`; `ProQuestionnaire.jsx`; `ThankYou.jsx`; validation/help components; `index.html` | None | Public Base44/Supabase/Icons8 asset hosts | Browser request metadata and referrer; branding/icon assets are downloaded, but questionnaire payload is not intentionally sent |
| `INT-021` | Parent-window callbacks | `src/lib/NavigationTracker.jsx`; `src/main.jsx`; `src/lib/VisualEditAgent.jsx` | None | Embedding parent window via `postMessage` with wildcard target origin | Current URL and builder/visual-edit messages; the URL can contain client or authorization parameters |
| `INT-022` | Console/runtime logging and error reporting | Frontend components/libs and Base44 functions | No Sentry or other error-reporting secret found; future `ERROR_REPORTING_ENVIRONMENT` | Browser console and Base44 function logs | Errors, statuses, business names in one AI path, and currently some endpoint metadata; payload/PII exposure depends on error content |

## Operation classification

`Safe staging` means safe only under the named control; it is not deployment authorization.

| ID | Operation class | Production-only side effect | Safe staging side effect | Requires later staging replacement/control |
| --- | --- | --- | --- | --- |
| `INT-001` | Reversible/irreversible Base44 record writes | Current app-scoped writes are production-bound | Separate staging app, synthetic records only | Yes: RLS, cleanup, namespace, retention |
| `INT-002` | Irreversible append/write | Current app-scoped event stream | Separate staging app with synthetic/redacted events | Yes |
| `INT-003` | Irreversible final-record write | Current app-scoped final submission | Separate staging app, synthetic records only | Yes |
| `INT-004` | Irreversible function/entity write | Current production fallback target; function absent remotely | Separate staging app after deployment certification | Yes |
| `INT-005` | Irreversible external automation | Only `production` + `production` mode | `disabled`, or approved `staging_redirect` sink | Staging sink/downstream inventory only; policy code is implemented |
| `INT-006` | Irreversible entity writes plus external automation | Production entities/destination | Synthetic staging entities plus disabled/approved redirect | Yes: entity/grant/cleanup controls |
| `INT-007` | Irreversible entity/agent writes and optional external automation | Production agent/entities/destination | Disabled Zapier; later separate staging agent and redirect | Yes |
| `INT-008` | Reversible privileged grant issuance | Production recovery secret/grants | Separate staging secret and bounded test grants | Yes |
| `INT-009` | Read-only external inference with irreversible disclosure/cost | Production OpenAI project/key | Mock or separate staging project with synthetic text | Yes |
| `INT-010` | External inference/conversation writes with irreversible disclosure/cost | Production OpenAI assistant | Disabled/mock or separate staging assistant | Yes |
| `INT-011` | External conversation write | Production Base44 agent/app | Separate staging agent/app or mock | Yes |
| `INT-012` | Reversible external file write with durable URL | Production app storage | Isolated staging storage/mock, synthetic files | Yes |
| `INT-013` | Local reversible browser file creation | No server delivery exists | Synthetic local download | No external replacement unless server delivery is introduced |
| `INT-014` | Future irreversible email send | Source transport exists but has no caller/deployment/configuration | `disabled`; later guarded `staging_redirect` only | Yes: source tests pass; cloud/account and live redirect certification remain |
| `INT-015` | Dormant potentially irreversible integrations | No active caller | Disabled/no call | Yes if activated |
| `INT-016` | Irreversible telemetry disclosure | Production Clarity property | Disabled or separate staging property | Yes |
| `INT-017` | Irreversible telemetry/session disclosure | Production Hotjar property | Disabled or separate staging property | Yes |
| `INT-018` | Irreversible operational log write | Production app logs | Staging app with safe structured events | Yes: schema/redaction/retention |
| `INT-019` | Read-only external lookup with irreversible disclosure/cost | Production Places key/project | Mock or separate restricted staging key | Yes |
| `INT-020` | Read-only public asset request | Production/public third-party hosts | Approved/self-hosted/mock assets | Yes for production-bound hosts |
| `INT-021` | Irreversible cross-origin disclosure | Current wildcard parent callback | Disabled/mock or fixed trusted staging origin | Yes |
| `INT-022` | Irreversible log/error disclosure | Current browser/function logs | Safe structured staging logs | Yes: remaining unstructured paths |

## Inventory: staging control and release gate

| ID | Client PII included | Irreversible side effect | Required staging behavior | Required test | Release-blocking configuration |
| --- | --- | --- | --- | --- | --- |
| `INT-001` | Yes | Yes: creates/updates records | Separate staging resource | Assert staging app ID, `environment=staging`, `test_run_id`, synthetic-only records, and production-app-ID denylist | Staging entities/RLS, namespace, retention, cleanup, and migration exclusion are not ready |
| `INT-002` | Yes; serialized answer values may be complete | Yes: appends records | Separate staging resource with redacted/synthetic values | Event payload/PII tests plus cleanup verification | Event retention/redaction and staging cleanup are not ready |
| `INT-003` | Yes | Yes: creates final record | Separate staging resource; synthetic data only | Final-create idempotency, environment marker, production-ID denylist, and no-green-migration tests | Staging schema/RLS/cleanup and synthetic fixtures are not ready |
| `INT-004` | Yes | Yes: creates/updates intake and may create final record | Separate staging resource, initially disabled except controlled synthetic tests | Failure-injection, intake dedupe, environment marker, and cleanup tests | Function is not deployed; schema/RLS/abuse controls are not ready |
| `INT-005` | Yes | Yes: triggers external automation | **Disabled** by default; redirect only to a separately owned staging webhook or injected fake sink | Policy suite proves disabled/unknown/test make zero fetch calls, staging never selects production, missing redirect fails closed, and public output/logs omit URLs/payload | Policy/code tests pass and hardcoded URL is removed; real staging URL/downstream inventory remain absent, so redirect remains off |
| `INT-006` | Yes | Yes: record creation/status changes and webhook delivery | External delivery disabled until isolated entities/grants are ready; approved redirect later | Authorization, idempotency, bounded retry, synthetic environment marker, truthful suppression/redirect diagnostics, and no-production-webhook tests | Password/grant, staging data cleanup, and production-ID denylist are not ready |
| `INT-007` | Yes | Yes: record mutation, AI disclosure, optional submission/webhook | Zapier disabled; later use separate staging agent and approved redirect with synthetic data | Repair decision, prompt redaction, authorization, suppression/redirect diagnostics, no-production-webhook, and duplicate tests | Staging agent/function/secrets are absent; AI isolation remains unimplemented |
| `INT-008` | No direct client PII; grants are sensitive | Yes: grants privileged recovery access | Separate staging password/grant secret; no production copy | Missing secret fails closed; wrong-environment/rotation/revocation/rate-limit tests | No staging secret, rate limits, lockouts, or admin-grant redesign exists |
| `INT-009` | Possibly, through free text | Yes: external API disclosure/cost | Mocked by default or separate staging key/project with synthetic text | Missing key fails closed; no production key; prompt-redaction and deterministic mock tests | Staging AI key/mode, budget, retention review, and egress control are absent |
| `INT-010` | Yes | Yes: external API disclosure/cost | Disabled or mocked; later separate staging key and assistant | No production key/assistant, synthetic context, and disabled-by-default tests | Hardcoded assistant selection and no staging mode block enablement |
| `INT-011` | Yes | Yes: conversation creation/external model processing | Separate staging agent/resource or mock | Staging app/agent assertion, synthetic prompt, timeout, and no-production-app tests | Agent is not deployed in staging; service-role isolation and prompt policy are not ready |
| `INT-012` | Yes; uploaded files can be sensitive | Yes: stores files and returns durable URLs | Separate staging app storage or mock; synthetic uploads only | Storage namespace/app-ID assertion, content/size rules, cleanup, and production-URL denylist | Cleanup, retention, staging location proof, and upload policy are absent |
| `INT-013` | Yes, but generated locally | Local file creation only | Local browser download using synthetic data; no server destination | PDF snapshot, asset failure, filename redaction, and no-upload/no-email test | Production external assets and staging banner/watermark review remain unresolved |
| `INT-014` | Recovery address and code when later called | Yes: sends email | **Disabled**; later all staging destinations are server-rewritten through `STAGING_EMAIL_REDIRECT_TO` and subjects start `[STAGING]` | Injected source tests prove disabled makes no SES call, missing/invalid redirect fails closed, entered address never becomes an SES header, and prefix/injection/redaction rules hold | No redirect/AWS secret, verified sender, approved region, sandbox exit, least-privilege IAM, bounce/complaint plan, deployment, or live certification exists |
| `INT-015` | Unknown if called | Potentially | Disabled; enable only with a separately reviewed staging resource | Assert exports have no staging call sites and unexpected invocation is blocked | No staging requirements or approved use case exists |
| `INT-016` | Yes: domain/user/session context | Yes: telemetry disclosure | Disabled or separate staging property with synthetic identifiers and environment tag | Production property denylist and PII/tag allowlist tests | Identifier is hardcoded and no staging analytics configuration exists |
| `INT-017` | Potentially | Yes: session/behavior disclosure | Disabled or separate staging property with privacy masking | Production site-ID denylist, masking, and no-client-data test | Site identifier is hardcoded and no staging privacy configuration exists |
| `INT-018` | Possibly through account/app context | Yes: durable operational log | Separate staging app logs; safe structured events only | Environment/test-run correlation and PII exclusion tests | Log schema/redaction/retention evidence is absent |
| `INT-019` | Location may identify a client | Yes: third-party disclosure/cost | Separate restricted staging key or mocked Places provider | Production-key denylist, HTTP-referrer restriction, synthetic query, and manual fallback tests | Production key exists; source hardcoding and staging-key absence block enablement |
| `INT-020` | Browser metadata/referrer can be contextual | Third-party request | Mock/self-host or separately approve each staging asset | No production storage URL in staging build; CSP/referrer-policy and failure tests | Current source contains production public asset URLs and third-party icons |
| `INT-021` | Potentially, especially full URL query parameters | Yes: cross-origin data disclosure | Mock/disable builder hooks in staging and restrict target origin; redact URL parameters | Fixed-origin, redacted-payload, no-token, and untrusted-parent tests | Wildcard target origin and full URL transmission block readiness |
| `INT-022` | Potentially | Yes: logs may persist | Separate staging log environment; redact client data, secrets, endpoint paths, and raw payloads | Secret/PII log scans and structured-event tests | Current unstructured logs and endpoint metadata are not certified safe |

## Searched categories with no active integration found

| Category | Result | Required action |
| --- | --- | --- |
| Amazon SES, AWS credentials/region, S3, CloudFront | A backend-only, uncalled SES v2 source adapter now reads reserved server names and is fully injected in tests. No AWS account, credential, S3 bucket, CloudFront URL, deployment, or live call exists. | Keep email disabled. Complete account/region/sandbox/sender/IAM/quota/bounce/complaint inventory before configuration or deployment. |
| CAPTCHA | No CAPTCHA SDK, key, widget, or backend verification found. | Reserve staging names, use separate keys, and keep public recovery blocked until abuse-control tests exist. |
| Slack or Microsoft Teams | No direct integration found. | Keep disabled; inventory any future notification destination before authorization. |
| Direct CRM integration | No direct Salesforce, HubSpot, or other CRM call found. Zapier's downstream actions are unknown. | Product/integration owner must inventory the production Zap workflow and create a separate staging sink. |
| External database | No direct PostgreSQL, MySQL, MongoDB, or other external database client found. Base44 entities are the current database surface. | Do not introduce or copy a production database into staging. |
| Base44 connector configuration | No local `base44/connectors` configuration exists; agents declare empty connector config arrays. | Current staging authorization requires dashboard re-verification; never initiate OAuth in this batch. |
| Scheduled automation | No cron, schedule resource, or local job runner found. An entity description mentions a possible future `scheduled_job` source only. | Dashboard/manual automation review remains required before deployment. |
| Production email recipient | No active email caller or hardcoded recipient found. | Future staging mail must use the redirect policy below; do not infer a production recipient. |
| Webhook signing secret | No separate webhook signature secret or verification found. Destination URLs are credential-bearing server configuration and no longer appear in source/public results/logs. | Reserve a signing-secret name only if the future staging endpoint supports verification; never log either destination. |
| Dedicated external error reporter | No Sentry or comparable client found. | Keep `ERROR_REPORTING_ENVIRONMENT` reserved and require a separate staging project before adding one. |

## 2026-08-06 SES source boundary

The [SES transport and template contract](../email/amazon-ses-transport-and-template-contract.md)
implements source-only environment routing, the fixed sender, a bounded SES v2
adapter, safe result/diagnostics, and recovery/future-verification templates.
It does not add a function or caller. `INT-014` therefore remains inactive and
email remains disabled. Sender verification, region, SES account status, IAM,
quotas, bounce/complaint handling, redirect ownership, and live routing remain
release blockers. No other integration row is promoted by this change.

## Staging email policy

1. Every staging email destination is rewritten server-side to `STAGING_EMAIL_REDIRECT_TO`, configured as a Base44 staging secret and never committed.
2. Every staging subject begins with `[STAGING]`.
3. The originally entered client address never becomes the actual transport destination.
4. The original address may appear in the staging body only when it is synthetic or irreversibly redacted.
5. Missing `STAGING_EMAIL_REDIRECT_TO` suppresses the send and returns a safe fail-closed result.
6. Email remains disabled until automated redirect, prefix, allowlist, missing-secret, and bypass-path tests pass.
7. SES region, sandbox/production status, verified sender/domain, quotas, least-privilege IAM, bounce handling, and complaint handling remain a later manual inventory.
8. No email was sent during this inventory.

## Staging data policy

1. Production client records, backups, and uploaded files must not be imported into staging.
2. Use synthetic fixtures. Any approved sample must be irreversibly de-identified before staging ingestion.
3. Every staging record includes `test_run_id` and `environment=staging`.
4. Automated cleanup, retention evidence, and a dry-run/report mode must exist before data-bearing staging deployment.
5. Staging records never migrate into green production. Migration utilities must reject staging source app IDs and staging environment markers.
6. Staging uploads use isolated staging storage or mocks; production URLs may be inventoried by host/type but are not copied without explicit approval.
7. No production backup is stored in staging.

## Current verdict

The isolated app is not deployable yet. `INT-005` is now fail-closed in source and safe only while mode remains `disabled`; staging redirect still lacks an approved sink and downstream inventory. `INT-009`, `INT-010`, `INT-016`, `INT-017`, `INT-019`, `INT-020`, and `INT-021` remain production-bound or insufficiently isolated and must be disabled, separated, or deny-listed before staging deployment.

No deployment, real webhook call, email send, connector authorization, secret creation, data copy, domain operation, or production-side mutation occurred. All delivery tests used injected fake adapters and reserved invalid/local test URLs.

## 2026-08-06 staging SES certification attempt

The [staging SES report](../email/staging-ses-recovery-email-certification.md)
is **SES_RECOVERY_EMAIL_BLOCKED**. The source hard stop preceded all AWS and
staging operations, so `INT-014` remains unconfigured and inactive. No intended
or actual recipient reached SES, no production credential/destination was
selected, no client was contacted, and no other integration—including
Zapier—was invoked. Live redirect, sender, IAM, quota, complaint/bounce,
idempotency, inbox, and cleanup evidence remains absent.
