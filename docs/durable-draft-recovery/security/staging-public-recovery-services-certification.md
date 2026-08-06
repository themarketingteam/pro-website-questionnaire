# Staging Public Recovery Services Certification

- Attempt date: 2026-08-06 (America/Chicago)
- Classification: **PUBLIC_RECOVERY_SERVICES_BLOCKED**
- Source commit at gate: `8bf770fb3dbde25e268c426d2b73ef7eba289a05`
- Branch: `feature/durable-draft-recovery`
- Registered staging app fingerprint: `682b3ba54771331270952c7f4a3ac25035417cc9376a93e8b14ffca2e77051f5`
- Functions deployed by this attempt: **NONE**
- Security entity pushed by this attempt: **NO**
- Feature-branch push: **NOT RUN**
- Production operations: **NONE**

The registered fingerprint is copied from the repository's existing sanitized
staging registration evidence. It was not freshly collected in this attempt,
because the mandatory source gate failed before the separate staging checkout
could be entered or the deployment-target guard could run.

## Decision

The ordered pre-deployment source gate stopped at `npm test`. The focused
public-recovery suites passed 214/214 tests and the entity-schema suites passed
22/22 tests, but the full normal suite failed 5 of 1,260 tests across two
files. The prompt requires stopping on any failure. Accordingly, no later
source gate, staging checkout update, target guard, secret or policy change,
entity push, function deployment, synthetic data, live request, cleanup query,
frontend regression, or Git push ran.

This report does not waive the failures and does not certify the public
recovery services in any environment.

## Pre-deployment source validation

| Gate | Exit | Result | Evidence |
| --- | ---: | --- | --- |
| Primary branch and clean tree | 0 | `PASS` | Clean `feature/durable-draft-recovery` at the recorded source commit |
| `npm ci` | 0 | `PASS` | Installed 775 packages; npm reported 29 audit findings: 1 low, 8 moderate, 18 high, and 2 critical |
| Focused recovery/security/CAPTCHA/code/email/choice/authorization tests | 0 | `PASS` | 11 files and 214/214 tests passed |
| `npm run test:entity-schemas` | 0 | `PASS` | Schema validator passed; 3 files and 22/22 tests passed |
| `npm test` | 1 | **`FAIL`** | 76 files passed, 2 failed; 1,255 tests passed, 5 failed |
| `npm run lint` | — | `NOT RUN` | Ordered gate stopped at `npm test` |
| `npm run typecheck` | — | `NOT RUN` | Ordered gate stopped at `npm test` |
| `npm run build` | — | `NOT RUN` | Ordered gate stopped at `npm test` |
| Primary-checkout `npx base44 whoami` authentication preflight | 0 | `PASS` | Authentication succeeded; identity output is intentionally not recorded |
| Staging-checkout `npx base44 whoami` | — | `NOT RUN` | Deployment phase was not reached |

The focused command was:

```text
npx vitest run --config src/vitest.config.js src/test/proDraftRecoverySecurity.test.js src/test/proDraftCaptcha.test.js src/test/recoverProFormDraftByCode.test.js src/test/recoverProFormDraftByEmail.test.js src/test/proDraftAuthorization.test.js src/test/proDraftAuthorizationResolver.test.js src/test/proDraftRepository.test.js src/test/proDraftIdentityBackendContract.test.js src/test/proDraftProjection.test.js src/test/proDraftRecoveryApiClient.test.js src/test/proFormRecoverySecurityEventSchema.test.js --reporter=dot --no-coverage
```

The five normal-suite failures were:

1. `proQuestionnaire.regression.test.jsx`: Q24 remained `incomplete` after switching from `Other` to a normal option.
2. `proQuestionnaire.regression.test.jsx`: no recoverable local backup key was found after a database-save failure.
3. `proQuestionnaire.regression.test.jsx`: zero-valued geographic latitude/longitude was normalized as the string `"0"` instead of number `0`.
4. `proSubmissionRepairHelpers.test.js`: a whitespace-only item remained in `service_offerings`.
5. `proSubmissionRepairHelpers.test.js`: the expected `taggedPeople: coerced to array` warning was absent.

## Staging identity, configuration, and deployment

| Item | Result |
| --- | --- |
| Fetch/fast-forward separate staging checkout | `NOT RUN` |
| Fresh staging fingerprint confirmation | `NOT RUN`; registered fingerprint only |
| Deployment-target guard | `NOT RUN`; no bypass attempted |
| `PRO_FORM_ABUSE_HASH_SECRET` | `NOT GENERATED OR CONFIGURED`; no temporary env file created |
| Staging recovery policy variables | `NOT CONFIGURED` |
| Backend public email recovery | `NOT ENABLED` by this attempt |
| CAPTCHA provider/test mode | `NOT CONFIGURED` by this attempt |
| Frontend marker | Source remains `VITE_PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED=false`; deployed state was not retested |
| OTP/magic link | Not enabled by this attempt |
| External side effects | No SES, Zapier, final submission, connector, or production request initiated |
| `npx base44 entities push` | `NOT RUN`; no entity deletion and no `--force` |
| `ProFormRecoverySecurityEvent` | `NOT PUSHED OR LIVE-CERTIFIED` |
| Admin-only RLS | Source-tested only; live result `NOT RUN` |
| `recoverProFormDraftByCode` | `NOT DEPLOYED` |
| `recoverProFormDraftByEmail` | `NOT DEPLOYED` |
| `listProFormDraftRecoveryChoices` | `NOT DEPLOYED` |
| `selectProFormDraftRecoveryChoice` | `NOT DEPLOYED` |

## Code-recovery matrix

| Scenario | Result |
| --- | --- |
| Active draft code | `NOT RUN` |
| Submitted draft code/read-only load | `NOT RUN` |
| Wrong and malformed code generic failures | `NOT RUN` |
| Cleared and expired code denial | `NOT RUN` |
| Code recovery without email | `NOT RUN` |
| Active editable token | `NOT RUN` |
| Raw code absent from stored records/events | `NOT RUN` |
| No hash returned | `NOT RUN` |

## Email-recovery and newest-created matrix

| Scenario | Result |
| --- | --- |
| Exact normalized email | `NOT RUN` |
| Uppercase/whitespace equivalent | `NOT RUN` |
| Newest-created eligible selection | `NOT RUN` |
| Newer submitted beats older active | `NOT RUN` |
| Newest cleared and expired records excluded | `NOT RUN` |
| Updated-date manipulation has no effect | `NOT RUN` |
| Wrong/invalid email generic failure | `NOT RUN` |
| Token omits raw email | `NOT RUN` |
| Submitted state loads read-only | `NOT RUN` |

There is no live newest-created proof from this attempt. Email-only recovery
remains explicitly **unverified**: abuse controls would not prove mailbox
ownership, and this risk has not been reduced by the blocked attempt.

## Draft-choice matrix

| Scenario | Result |
| --- | --- |
| List active and submitted choices | `NOT RUN` |
| Exclude cleared and expired choices | `NOT RUN` |
| Select older active draft and load editable | `NOT RUN` |
| Preserve created dates | `NOT RUN` |
| Deny another email's draft | `NOT RUN` |
| Deny associated-list scope to code session | `NOT RUN` |

## Rate-limit, CAPTCHA, and lockout matrix

| Scenario | Result |
| --- | --- |
| Failure threshold requires CAPTCHA | `NOT RUN` |
| Staging test CAPTCHA pass/fail | `NOT RUN` |
| Subject rate limit | `NOT RUN` |
| IP rate limit | `NOT RUN` |
| Lockout and bounded retry-after | `NOT RUN` |
| Lockout expiration | `NOT RUN` |
| Global threshold behavior | `NOT RUN` |
| Minimum response delay | `NOT RUN` |

## Security-event and RLS inspection

| Check | Result |
| --- | --- |
| Event count/types/outcomes | `NOT RUN` |
| Hashed subject fields present | `NOT RUN` |
| Raw email/IP/device/code absent | `NOT RUN` |
| CAPTCHA token and request body absent | `NOT RUN` |
| Test-run ID present | `NOT RUN` |
| Public direct read denied by admin-only RLS | `NOT RUN` |

No hashes, codes, emails, tokens, app IDs, secret values, or record bodies were
printed or stored as report evidence.

## Cleanup, frontend, and isolation

No synthetic test-run ID or staging record was created. Cleanup was therefore
**NOT REQUIRED**; no live zero-remaining query ran, so this is not a claim
about unrelated staging data. The deployed frontend marker, absence of recovery
UI, questionnaire render, automatic-call denial, and network-side-effect deny
checks were `NOT RUN` because the deployment phase never began.

Production remained untouched by this attempt: there was no production app,
data, secret, schema, function, site, domain, connector, email, webhook, or
branch operation. `main` was not changed or pushed. The feature branch was not
pushed because the prompt permits that only after successful certification.

## Required disposition

Resolve or explicitly disposition all five normal-suite failures, then rerun
the complete ordered source gate from a clean candidate. Only a fully passing
gate may proceed to a freshly guarded staging deployment and live
certification. Until then, the classification remains
**PUBLIC_RECOVERY_SERVICES_BLOCKED**.

## Restrictive RLS follow-up

The later [restrictive draft RLS attempt](staging-draft-rls-certification.md)
was **DRAFT_RLS_BLOCKED** at the deployment precheck. No public recovery flow,
direct-access denial, recovery email, or cleanup operation was rerun or
promoted by that attempt.
