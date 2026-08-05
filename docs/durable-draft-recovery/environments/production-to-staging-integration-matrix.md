# Production-to-Staging Integration Matrix

- Status: **INVENTORIED_NOT_SAFE_TO_ENABLE**
- Inventory date: 2026-08-05
- Count: **22 integration and side-effect surfaces**
- Scope: repository source, Base44 resources, configuration, existing durable-draft documentation, and names-only/read-only Base44 checks

This inventory records names and destination types only. It intentionally omits app IDs, secret values, access tokens, assistant IDs, analytics property IDs, API keys, and token-bearing webhook paths.

## Discovery evidence

The audit searched environment-variable access, HTTP destinations, Base44 SDK calls, functions, agents, connectors, entity writes, OpenAI, AWS/SES, Zapier/webhooks, PDF generation, uploads/storage, CAPTCHA, analytics, error reporting, collaboration/CRM/database services, S3/CloudFront, callbacks, recovery authorization, scheduled work, email recipients, and repair/retry paths.

The names-only production secret check returned four names: `DRAFT_RECOVERY_PASSWORD`, `ZAPIER_WEBHOOK_URL`, `VITE_GOOGLE_PLACES_API_KEY`, and `OPENAI_KEY`. The read-only production function list returned seven functions. No secret value was requested or displayed.

## Inventory: source, destination, and data

| ID | Name | Source file/function | Environment variable or Base44 secret names | Production destination type | Data sent or stored |
| --- | --- | --- | --- | --- | --- |
| `INT-001` | Base44 draft persistence | `src/lib/draftPersistence.js`; `src/pages/ProQuestionnaire.jsx`; `ProFormDraft` | App-scoped Base44 runtime; `VITE_BASE44_APP_ID`, `VITE_BASE44_BACKEND_URL` may influence client routing | Production Base44 entity | Session/client identity, full response JSON, validation/touched/expanded state, mapped payload, upload metadata, and lifecycle status |
| `INT-002` | Base44 draft-event stream | `src/pages/ProQuestionnaire.jsx`; `src/lib/proQuestionnaireSubmit.js`; `ProFormDraftEvent` | App-scoped Base44 runtime | Production Base44 entity | Session/business context, event type, question ID/type, and serialized changed values or submit-stage metadata |
| `INT-003` | Questionnaire final-submission endpoint | `src/lib/proSubmissionResilience.js`; `src/lib/proQuestionnaireSubmit.js`; `ProFormSubmission` | App-scoped Base44 runtime | Production Base44 entity | Complete transformed questionnaire metadata and user data, including business/client context and uploaded-file URLs |
| `INT-004` | Intake fallback endpoint | `submitProQuestionnaireFallback`; `ProFormSubmissionIntake` | App-scoped Base44 runtime | Production Base44 function and intake/submission entities | Raw and transformed questionnaire payloads, client identifiers, diagnostics, primary/fallback errors, and final linkage |
| `INT-005` | Zapier submission delivery | `sendToZapier`; `retryProQuestionnaireIntakeSubmission`; `repairProQuestionnaireIntakeSubmission`; `src/lib/proQuestionnaireSubmit.js` | `ZAPIER_WEBHOOK_URL`; source also contains a credential-bearing fallback destination whose value is intentionally omitted | Production Zapier catch-hook/workflow; downstream destination is not described in this repository | Complete final questionnaire payload and related business/client data |
| `INT-006` | Submission retry | `retryProQuestionnaireIntakeSubmission`; recovery UIs | `DRAFT_RECOVERY_PASSWORD`, `ZAPIER_WEBHOOK_URL` | Production Base44 entities plus Zapier | Existing draft/intake/final payload, retry state, linked IDs, and webhook body |
| `INT-007` | AI repair and repair-and-retry | `repairProQuestionnaireIntakeSubmission`; `pro_submission_repair_agent` | `DRAFT_RECOVERY_PASSWORD`, `ZAPIER_WEBHOOK_URL`; Base44 app-scoped agent authorization | Production Base44 agent/entities and, in retry mode, Zapier | Raw payload, errors, repair prompt/report, repaired payload, entity updates, and webhook body |
| `INT-008` | Draft recovery password/grant | `verifyDraftRecoveryAccess`; retry/repair authorization helpers; admin recovery UIs | `DRAFT_RECOVERY_PASSWORD`; future `PRO_FORM_ADMIN_GRANT_SECRET` | Production Base44 function and persistent browser grant | Submitted password, signed authorization grant, scope/version/expiry metadata; no questionnaire payload is required for verification |
| `INT-009` | OpenAI answer validation | `validateQuestionText`; `src/components/pro-form/useTextValidation.jsx`; `src/pages/ProQuestionnaire.jsx` | `OPENAI_KEY` | OpenAI chat-completions API | Questionnaire answer text and question context; free text can contain client PII |
| `INT-010` | OpenAI assistant content generation | `generateAIContentOpenAI`; dormant `AIContentModal` path | `OPENAI_KEY`; assistant identifier is source-configured and intentionally omitted | OpenAI Assistants API | Instruction, question context, draft content, business name, and form context |
| `INT-011` | Base44 content-strategist agent | `generateAIContent`; `_shared/base44Agent`; `msp_content_strategist` | `BASE44_APP_ID`, `BASE44_SERVICE_ROLE_KEY` | Base44 agent/conversation API | Instruction, questionnaire context, draft content, and conversation messages |
| `INT-012` | Base44 Core upload/storage | `FileUploadQuestion`, `ImageTaggingQuestion`, `MultiCertificationQuestion`, `MultiGuaranteeQuestion` | App-scoped Base44 runtime; no custom storage secret in source | Base44 managed file storage | Client-selected images, PDFs, Word/text files, filenames, and resulting URLs |
| `INT-013` | Browser PDF generation/download | `PDFGenerator.jsx`; `pdf/*`; `useQuestionnairePdfDownload.js` | None currently; future `PDF_STAGING_DESTINATION` only if server storage is introduced | Client browser download; no current backend PDF destination | Submitted questionnaire snapshot, business name/domain, embedded images, and public branding assets |
| `INT-014` | Dormant email capability and planned SES path | `src/api/integrations.js` exports `SendEmail`; ADR-001 plans SES; no active caller or SES function exists | Future `STAGING_EMAIL_REDIRECT_TO`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_FROM_ADDRESS`, `SES_CONFIGURATION_SET` | No active production email path found; future Amazon SES/Base44 email integration | Future recovery code and associated unverified email; no current production recipient was found in source |
| `INT-015` | Other dormant Base44 Core capabilities | `src/api/integrations.js` exports `SendSMS`, `GenerateImage`, and `ExtractDataFromUploadedFile`; no caller found | App-scoped Base44 runtime | Base44 Core integration layer | None currently; future data depends on the caller |
| `INT-016` | Microsoft Clarity analytics | `index.html`; `src/lib/clarity.js`; questionnaire and PDF call sites | Current property identifier is source-configured; future `VITE_CLARITY_PROJECT_ID`; `ERROR_REPORTING_ENVIRONMENT` | Microsoft Clarity production property | Business domain, user ID/friendly label when present, page path, question IDs/types, answer metadata, validation/submit status, and PDF event metadata |
| `INT-017` | Hotjar analytics | `src/components/HotjarTracking.jsx`; `src/Layout.jsx` | Current site identifier is source-configured; future `VITE_HOTJAR_SITE_ID`; `ERROR_REPORTING_ENVIRONMENT` | Hotjar production property | Browser/session behavior, page content/interaction, request metadata, and any data captured under the active Hotjar configuration |
| `INT-018` | Base44 application logging | `src/lib/NavigationTracker.jsx` | App-scoped Base44 runtime; future `ERROR_REPORTING_ENVIRONMENT` | Base44 app logs | Authenticated page name and app/user context |
| `INT-019` | Google Maps/Places | `index.html`; `MultiGeographicQuestion.jsx` | `VITE_GOOGLE_PLACES_API_KEY` is configured in production; a browser key is also source-configured and must be removed from hardcoded configuration | Google Maps JavaScript and Places APIs | User-entered place query, formatted address, place ID, coordinates, and address components |
| `INT-020` | External public assets/CDNs | `FormHeader.jsx`; `ProQuestionnaire.jsx`; `ThankYou.jsx`; validation/help components; `index.html` | None | Public Base44/Supabase/Icons8 asset hosts | Browser request metadata and referrer; branding/icon assets are downloaded, but questionnaire payload is not intentionally sent |
| `INT-021` | Parent-window callbacks | `src/lib/NavigationTracker.jsx`; `src/main.jsx`; `src/lib/VisualEditAgent.jsx` | None | Embedding parent window via `postMessage` with wildcard target origin | Current URL and builder/visual-edit messages; the URL can contain client or authorization parameters |
| `INT-022` | Console/runtime logging and error reporting | Frontend components/libs and Base44 functions | No Sentry or other error-reporting secret found; future `ERROR_REPORTING_ENVIRONMENT` | Browser console and Base44 function logs | Errors, statuses, business names in one AI path, and currently some endpoint metadata; payload/PII exposure depends on error content |

## Inventory: staging control and release gate

| ID | Client PII included | Irreversible side effect | Required staging behavior | Required test | Release-blocking configuration |
| --- | --- | --- | --- | --- | --- |
| `INT-001` | Yes | Yes: creates/updates records | Separate staging resource | Assert staging app ID, `environment=staging`, `test_run_id`, synthetic-only records, and production-app-ID denylist | Staging entities/RLS, namespace, retention, cleanup, and migration exclusion are not ready |
| `INT-002` | Yes; serialized answer values may be complete | Yes: appends records | Separate staging resource with redacted/synthetic values | Event payload/PII tests plus cleanup verification | Event retention/redaction and staging cleanup are not ready |
| `INT-003` | Yes | Yes: creates final record | Separate staging resource; synthetic data only | Final-create idempotency, environment marker, production-ID denylist, and no-green-migration tests | Staging schema/RLS/cleanup and synthetic fixtures are not ready |
| `INT-004` | Yes | Yes: creates/updates intake and may create final record | Separate staging resource, initially disabled except controlled synthetic tests | Failure-injection, intake dedupe, environment marker, and cleanup tests | Function is not deployed; schema/RLS/abuse controls are not ready |
| `INT-005` | Yes | Yes: triggers external automation | **Disabled**, then redirected only to a separately owned staging webhook or mocked sink | Network denylist proves production host/path cannot be called; missing staging URL fails closed; synthetic contract test | Committed fallback destination must be removed/disabled; staging URL and downstream inventory do not exist |
| `INT-006` | Yes | Yes: record creation/status changes and webhook delivery | Disabled until isolated entities, grant controls, and mocked/staging webhook are ready | Authorization, idempotency, bounded retry, synthetic-only, and no-production-webhook tests | Password/grant, staging webhook, data cleanup, and production-ID denylist are not ready |
| `INT-007` | Yes | Yes: record mutation, AI disclosure, optional submission/webhook | Disabled; later use separate staging agent and mocked/staging webhook with synthetic data | Repair decision, prompt redaction, authorization, no-production-webhook, and duplicate tests | Staging agent/function/secrets are absent; source fallback webhook remains unsafe |
| `INT-008` | No direct client PII; grants are sensitive | Yes: grants privileged recovery access | Separate staging password/grant secret; no production copy | Missing secret fails closed; wrong-environment/rotation/revocation/rate-limit tests | No staging secret, rate limits, lockouts, or admin-grant redesign exists |
| `INT-009` | Possibly, through free text | Yes: external API disclosure/cost | Mocked by default or separate staging key/project with synthetic text | Missing key fails closed; no production key; prompt-redaction and deterministic mock tests | Staging AI key/mode, budget, retention review, and egress control are absent |
| `INT-010` | Yes | Yes: external API disclosure/cost | Disabled or mocked; later separate staging key and assistant | No production key/assistant, synthetic context, and disabled-by-default tests | Hardcoded assistant selection and no staging mode block enablement |
| `INT-011` | Yes | Yes: conversation creation/external model processing | Separate staging agent/resource or mock | Staging app/agent assertion, synthetic prompt, timeout, and no-production-app tests | Agent is not deployed in staging; service-role isolation and prompt policy are not ready |
| `INT-012` | Yes; uploaded files can be sensitive | Yes: stores files and returns durable URLs | Separate staging app storage or mock; synthetic uploads only | Storage namespace/app-ID assertion, content/size rules, cleanup, and production-URL denylist | Cleanup, retention, staging location proof, and upload policy are absent |
| `INT-013` | Yes, but generated locally | Local file creation only | Local browser download using synthetic data; no server destination | PDF snapshot, asset failure, filename redaction, and no-upload/no-email test | Production external assets and staging banner/watermark review remain unresolved |
| `INT-014` | Yes when implemented | Yes: sends email | **Disabled** until all recipients are redirected through `STAGING_EMAIL_REDIRECT_TO` and subjects start `[STAGING]` | Missing redirect suppresses send; entered address never becomes destination; prefix/allowlist/redaction tests | No redirect secret, SES inventory, sender, least-privilege IAM, bounce/complaint plan, or email implementation exists |
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
| Amazon SES, AWS credentials/region, S3, CloudFront | No implemented SES/AWS SDK call, AWS environment access, S3 bucket, or CloudFront URL found. SES is a future approved design only. | Keep email disabled. Complete account/region/sandbox/sender/IAM/quota/bounce/complaint inventory before implementation. |
| CAPTCHA | No CAPTCHA SDK, key, widget, or backend verification found. | Reserve staging names, use separate keys, and keep public recovery blocked until abuse-control tests exist. |
| Slack or Microsoft Teams | No direct integration found. | Keep disabled; inventory any future notification destination before authorization. |
| Direct CRM integration | No direct Salesforce, HubSpot, or other CRM call found. Zapier's downstream actions are unknown. | Product/integration owner must inventory the production Zap workflow and create a separate staging sink. |
| External database | No direct PostgreSQL, MySQL, MongoDB, or other external database client found. Base44 entities are the current database surface. | Do not introduce or copy a production database into staging. |
| Base44 connector configuration | No local `base44/connectors` configuration exists; agents declare empty connector config arrays. | Current staging authorization requires dashboard re-verification; never initiate OAuth in this batch. |
| Scheduled automation | No cron, schedule resource, or local job runner found. An entity description mentions a possible future `scheduled_job` source only. | Dashboard/manual automation review remains required before deployment. |
| Production email recipient | No active email caller or hardcoded recipient found. | Future staging mail must use the redirect policy below; do not infer a production recipient. |
| Webhook signing secret | No separate webhook signature secret or verification found. The Zapier URL itself is credential-bearing. | Reserve a signing-secret name only if the future staging endpoint supports verification; never log the URL. |
| Dedicated external error reporter | No Sentry or comparable client found. | Keep `ERROR_REPORTING_ENVIRONMENT` reserved and require a separate staging project before adding one. |

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

The isolated app is not deployable yet. `INT-005`, `INT-009`, `INT-010`, `INT-016`, `INT-017`, `INT-019`, `INT-020`, and `INT-021` contain hardcoded or production-bound configuration that must be disabled, separated, or deny-listed before the staging site/functions can be deployed.

No deployment, webhook call, email send, connector authorization, secret creation, data copy, domain operation, or production-side mutation occurred during this inventory.
