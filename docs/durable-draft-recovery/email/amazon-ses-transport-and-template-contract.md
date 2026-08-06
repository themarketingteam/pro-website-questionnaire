# Amazon SES Transport and Recovery Email Template Contract

- Status: **SOURCE_IMPLEMENTED_NOT_DEPLOYED**
- Date: 2026-08-06
- Branch: `feature/durable-draft-recovery`
- Sender: `MSP Success Websites <noreply@mspsuccesswebsites.com>`
- SES client: AWS SDK v3 `@aws-sdk/client-sesv2` through the Base44/Deno `npm:` specifier
- Email sent by this implementation prompt: **NO**
- Schema pushed or function deployed: **NO**

## Scope and safety boundary

This source-only foundation provides an injectable backend transport and safe
templates. The later source-only `sendProFormDraftRecoveryCodeEmail` function
is now their sole authorized caller, but it is not deployed and no Clear All or
Start New UI/controller invokes it. This work does not configure a Base44
secret, create AWS credentials, inspect an AWS account, or send an email. OTP
and magic-link templates remain reserved and are not enabled.

The transport is backend-only. No frontend module imports it, and no `VITE_*`
name may contain or expose AWS credentials. Public APIs must map the internal
result to a narrower allowlist and must not return provider message IDs,
provider status, credential/configuration errors, or raw SES exceptions.

## Inventory findings

| Inventory item | Finding | Status |
| --- | --- | --- |
| Existing SES SDK package/import | No SES v1/v2 SDK or `SendEmailCommand` existed before this change | Known absent before implementation |
| Existing package usage | `package.json` has no AWS SDK dependency; the backend module uses the Base44/Deno `npm:@aws-sdk/client-sesv2` runtime import | Known |
| Existing Base44 email capability | `src/api/integrations.js` exports Base44 Core `SendEmail`, but tracked production questionnaire source has no caller | Known dormant |
| Existing email functions | Source now includes the undeployed authorized recovery-code delivery function; `recoverProFormDraftByEmail` still performs lookup only and sends nothing | Known source-only |
| Existing connectors | No local `base44/connectors` directory/configuration exists | Known absent locally |
| Existing variable names | Documentation reserved `STAGING_EMAIL_REDIRECT_TO`, standard AWS names, `SES_FROM_ADDRESS`, and `SES_CONFIGURATION_SET`; no source reader existed | Known names only |
| Staging side-effect mode | Repository evidence records `PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE=disabled`; this prompt did not refresh cloud configuration | Known from prior sanitized evidence; not freshly verified |
| Sender/domain verification | No verification evidence or AWS account query exists in the repository | **Unknown** |
| SES sandbox/production status | No AWS account/region inventory was performed | **Unknown** |
| SES region | No approved configured region is recorded | **Unknown** |
| Least-privilege IAM | ADR-001 requires it, but no IAM policy or AWS permission evidence exists | **Unknown / not implemented** |
| Bounce/complaint handling | No configuration set, SNS/event destination, owner, or runbook is certified | **Unknown / blocking** |

No credential value was searched for, requested, printed, or added. Tracked
source was also checked for high-confidence access-key/private-key patterns by
filename-safe scanning.

## Modules

- Transport: `base44/functions/_shared/proDraftEmailTransport/entry.ts`
- Templates: `base44/functions/_shared/proDraftEmailTemplates/entry.ts`
- Authorized delivery: `base44/functions/sendProFormDraftRecoveryCodeEmail/entry.ts`
- Delivery flow: `docs/durable-draft-recovery/email/recovery-code-email-delivery-flow.md`

The transport exports its version, modes, safe error codes, configuration
reader, SES client adapter, destination resolver, transactional send operation,
safe diagnostics, and related types. The module has no logger or persistence
dependency. The authorized delivery coordinator owns durable idempotency,
bounded retry, status updates, and safe event recording using the optional
admin-only entity fields without changing canonical revision.

The template module exports recovery, future OTP, and future magic-link
renderers plus HTML escaping, validation, limits, and safe diagnostics. It
accepts only controlled inputs and never accepts arbitrary client HTML.

## Configuration names and compatibility

Preferred backend names:

1. `PRO_DRAFT_EMAIL_MODE`
2. `PRO_DRAFT_SES_FROM_EMAIL`
3. `PRO_DRAFT_SES_FROM_NAME`
4. `PRO_DRAFT_AWS_REGION`
5. `PRO_DRAFT_AWS_ACCESS_KEY_ID`
6. `PRO_DRAFT_AWS_SECRET_ACCESS_KEY`
7. `PRO_DRAFT_AWS_SESSION_TOKEN`
8. `STAGING_EMAIL_REDIRECT_TO`
9. `PRO_DRAFT_SES_TIMEOUT_MS`
10. `PRO_DRAFT_RECOVERY_BASE_URL`

For controlled migration only, preferred AWS names fall back to
`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and
`AWS_SESSION_TOKEN`; the sender email falls back to `SES_FROM_ADDRESS`.
Preferred names take precedence. This mapping avoids copying or duplicating
secret values and must be removed only through a reviewed configuration
migration. `SES_CONFIGURATION_SET` remains a future event-routing concern and
is not read by this source-only transport.

## Modes and environment rules

| Mode | Allowed environment | Behavior |
| --- | --- | --- |
| `disabled` | Any | Returns a suppressed, not-delivered result and never constructs/calls SES |
| `staging_redirect` | `staging` only | Validates the intended address, then replaces it server-side with `STAGING_EMAIL_REDIRECT_TO`; the original is absent from SES headers and the subject starts `[STAGING]` |
| `production` | `production` only | Sends only to a recipient explicitly marked authorized by an upstream backend workflow |

Missing mode defaults to `disabled`. Unknown mode, unknown environment,
production mode in staging, and staging redirect in production all fail
closed. The request cannot override environment, mode, sender, region,
credentials, or redirect destination. Production requires the configured
sender email to normalize exactly to `noreply@mspsuccesswebsites.com`; the
display name defaults to `MSP Success Websites`.

The staging redirect is a backend secret/configuration value. Its real value
must never be committed, printed, placed in a subject, returned publicly, or
copied from production. Missing or invalid redirect prevents the SES call.
Safe routing diagnostics contain only the actual recipient's domain and a
redirected boolean; the internal destination resolver's full address must not
cross a public boundary.

## SES request and timeout

The adapter builds an SES v2 `SendEmailCommand` with one `ToAddresses` entry,
the fixed sender, UTF-8 subject, plain text, and HTML. It does not set reply-to,
CC, BCC, raw MIME, custom client headers, configuration set, tags, or an
original-recipient header. A caller must provide an explicit authorization
boolean before any non-disabled delivery.

The default timeout is 10,000 ms. Parsed integer configuration is clamped to
2,000–30,000 ms. The transport supplies an abort signal and independently
races the provider promise against the bounded timeout. Exceptions and SES
response bodies are never returned. The internal result may retain only a
bounded provider message ID and numeric provider status for backend/admin
diagnostics.

## Recovery-code template

Production subject:

`Your MSP Success Websites questionnaire recovery code`

Staging subject:

`[STAGING] Your MSP Success Websites questionnaire recovery code`

The plain-text and accessible HTML bodies say that a new questionnaire draft
was created, display the formatted recovery code, instruct the recipient to
save it securely, explain that it recovers questionnaire answers, link to the
recovery site, and include “If you did not request this, you can ignore this
email.”

The recovery link must be HTTPS and contain no query string, fragment,
credentials, or raw/normalized recovery code. The body contains no complete
answers, domain, user ID, marketing copy, tracking pixel, external image,
script, embedded style block, or arbitrary HTML. Business display name is
control-normalized, limited to 120 Unicode code points, and HTML-escaped before
HTML rendering. Subject, sender, and recipient reject CR/LF injection; subject
and bodies have bounded sizes.

The transport does not persist or log the code, recipient, or body. Future
orchestration must likewise keep raw code only in process memory and may store
only safe delivery status, bounded error/purpose codes, keyed idempotency hash,
provider message ID, opaque request ID, accepted-at timestamp, and attempt
count.

## Future verification templates

`future_otp` and `future_magic_link` are renderers only. No function, client,
feature flag, route, sender, or verifier calls them. Their presence does not
change the explicitly unverified status of email recovery and does not prove
mailbox ownership. Separate authorization, expiry, replay, storage, abuse,
delivery, and environment certification are mandatory before enablement.

## IAM least-privilege target

A future reviewed AWS identity should have only the SES action required by the
chosen transport (`ses:SendEmail`) in the approved account/region and should be
scoped to the verified sending identity wherever AWS policy semantics permit.
It must not receive broad AWS administration, IAM, S3, CloudWatch, SNS, SES
identity-management, or raw-email permissions merely for delivery. Staging and
production credentials must be separate, backend-only Base44 secrets with
independent ownership, rotation, budget/quota, and incident controls.

This is a target policy, not evidence that such an identity exists.

## Test strategy and current evidence

Focused tests use injected synthetic SES clients only. They cover disabled,
redirect, missing redirect, environment mismatches, unknown mode/environment,
recipient authorization, recipient/sender/subject injection, approved sender,
standard-name compatibility, timeout clamping, SES client construction,
success, failure, timeout, safe internal result, diagnostics redaction,
recovery text/HTML, staging prefix, code/link separation, HTML escaping,
business-name bounds, answer omission, tracking/image denial, and future
templates. No test can reach an AWS account.

The authorized delivery function adds focused source coverage for exact-draft
authorization, HMAC code matching, purpose/lifecycle linkage, stored-recipient
selection, compare-and-set attempt claims, replay suppression, retry/backoff,
maximum attempts, metadata success/failure, uncertain delivery, safe events,
strict responses, and the no-storage/no-Redux client helper.

Required later environment evidence includes verified identity/domain, region,
sandbox exit, quotas, IAM policy simulation/review, bounce/complaint routing,
configuration-set/event ownership, 100-message staging redirect proof, provider
simulator behavior, suppression/retry/idempotency, monitoring/alerts, and
frontend/deployed-log credential scans.

## 2026-08-06 local validation results

| Command/check | Result |
| --- | --- |
| `npm ci` | Pass; 775 packages installed and npm reported 29 inherited audit findings (1 low, 8 moderate, 18 high, 2 critical) |
| Email transport/template/header-injection tests | Pass: 34/34 |
| Entity-schema validator and suites | Pass: `ProFormDraft=64`; 22/22 tests |
| Recovery security/CAPTCHA/authorization suites | Pass: 77/77 |
| Direct TypeScript check of both new backend modules | Pass |
| Full normal suite | Fail: 1,288/1,293 passed; the same five questionnaire/submission-repair baseline assertions failed |
| `npm run lint` | Fail: 32 errors and 17 warnings in existing frontend files; no finding references the new backend modules/tests |
| `npm run typecheck` | Fail: 240 existing project-scope errors; the configured project excludes the new backend modules, which pass the direct TypeScript check |
| `npm run build` | Pass |
| Built/frontend source AWS-name/value scan | Pass: zero matching source files and zero matching files across 56 built files |

The five normal-suite failures cover Q24 switching, missing recoverable local
backup after a failed database save, zero-valued geographic normalization,
whitespace-only service offerings, and the missing `taggedPeople` coercion
warning. They are not waived or reclassified by this prompt. No email or AWS
network operation occurred during any test; all SES behavior used injected
synthetic clients.

## Deployment blockers

1. Source validation and existing repository release gates must pass.
2. Sender/domain verification, SES region, production access, quota, and
   sandbox state must be recorded from the approved AWS account.
3. Separate least-privilege staging/production identities and Base44 secrets
   must be configured without copying values.
4. A real internal staging allowlist address must be supplied outside Git and
   certified without exposing it in evidence.
5. Bounce, complaint, suppression, retry, idempotency, monitoring, retention,
   and incident ownership must be operational.
6. The source delivery coordinator must be deployed and live-certified for
   exact authorization, entity FLS, atomic attempt claims, and ambiguous-send
   handling before any controller invokes it.
7. Schema push, function deployment, staging delivery, and production
   enablement each require a separate explicit prompt and guarded target.

Until those blockers close, email mode remains `disabled`, OTP/magic link
remain disabled, the schema remains local-only, and no SES delivery is
authorized.
