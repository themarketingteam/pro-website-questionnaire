# Future OTP and Magic-Link Verification Framework

- Status: **SOURCE_SCAFFOLDED_DISABLED_NOT_DEPLOYED**
- Date: 2026-08-06
- OTP enabled: **NO**
- Magic link enabled: **NO**
- Email or verification value sent: **NO**
- Entity/function/schema deployment: **NO**

## Boundary and compatibility

The initial public email-recovery flow remains separate and explicitly
unverified behind `PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED`. This additive
framework reserves a later mailbox-ownership proof without changing a draft's
existing normalized-email association or keyed
`recovery_email_lookup_hash`. Successful future verification therefore uses
the same lookup identity already stored on drafts; no destructive email-field
migration, draft replacement, or recovery-code rotation is required.

The four shipped function entries are deliberately fail-closed. They evaluate
the durable-draft runtime and corresponding method flag, consume at most 32 KB
without JSON-parsing workflow fields, and return `FEATURE_DISABLED`. They do
not create a Base44 client, query or write an entity, generate an OTP/token,
render or send email, or issue authorization. Only an explicitly injected
executor with environment `test`, the method flag set, and
`allowEnabledTestMode=true` can exercise a synthetic enabled function path.
Production/staging entries provide none of those test dependencies.

## Verification-attempt entity

`base44/entities/ProFormEmailVerificationAttempt.jsonc` is optional framework
support and is not pushed. Entity create/read/update/delete is admin-only. It
stores:

- opaque attempt/request IDs, environment, method, status, and safe times;
- the existing recovery-email lookup HMAC;
- a purpose/version/attempt/email-bound verification-value HMAC;
- OTP attempt count and maximum;
- optional device/IP context HMACs;
- only a hash of an allowlisted redirect path;
- safe delivery status and an admin-only provider message ID;
- synthetic test and common migration metadata.

It has no raw email, OTP, magic token, IP address, device identifier, redirect
URL, email body, request body, or recovery-session token. Raw values exist only
in process memory while a future authorized caller renders/sends or consumes
them.

## Secrets and domain separation

OTP uses only `PRO_FORM_EMAIL_OTP_SECRET`; magic links use only
`PRO_FORM_MAGIC_LINK_SECRET`. Each must contain at least 32 bytes when later
configured. The names are reserved but neither value is configured here. They
are distinct from each other and from recovery-code, email-lookup,
recovery-session, signed-invitation, and admin-grant secrets.

Both HMAC inputs contain a versioned purpose domain plus attempt ID and the
existing recovery-email lookup hash. Constant-time comparison is used for
verification. Substituting a token, secret, attempt, method, or email identity
cannot produce the same verifier.

## OTP lifecycle

1. A secure Web Crypto source generates exactly six numeric digits using
   rejection sampling; bytes 250–255 are discarded to avoid modulo bias.
2. Default lifetime is 10 minutes; configured internal lifetime cannot exceed
   15 minutes.
3. Default maximum submissions is five.
4. Only the bound HMAC is persisted; the raw OTP is not stored, logged, placed
   in a URL, diagnostic, or public response.
5. Each wrong submission increments `attempt_count`; the attempt becomes
   `locked` at the maximum.
6. Expired attempts become `expired` before value comparison.
7. A correct value transitions the attempt to `consumed`, sets `verified_at`
   and `consumed_at`, and yields `verified_otp` exactly once.
8. A consumed, verified, locked, cancelled, or expired attempt cannot be
   reused.

## Magic-link lifecycle and redirect safety

1. Web Crypto generates a 32-byte (256-bit) opaque token.
2. Default and maximum scaffold lifetime is 30 minutes.
3. Only the bound HMAC is persisted; the raw token is not stored or logged.
4. No public magic-link URL or route is implemented. Before activation, a
   leakage review must approve fragment versus path/query transport, browser
   history, referrer policy, server/access logs, link scanners, analytics,
   error reporting, and email-security rewriting.
5. Redirects accept exact relative allowlist entries only (`/` and
   `/ProQuestionnaire`). Schemes, hosts, protocol-relative paths, queries,
   fragments, traversal, backslashes, whitespace, and unknown paths are
   rejected. Only the domain-separated path hash is stored.
6. Correct token and redirect bindings consume the attempt once, set both
   server timestamps, and yield `verified_magic_link`. Expired or consumed
   attempts cannot be reused.

## Verification state and recovery-session handoff

Email association remains `unverified` during attempt creation, delivery,
wrong-value submission, expiry, lockout, and cancellation. Only successful
one-time consumption returns a verified result. After a future newest-created
lookup or explicit user choice selects an exact eligible draft, the internal
handoff issues the existing recovery-session token with:

- `authorizationMethod=email_otp` and
  `recoveryEmailVerificationStatus=verified_otp`; or
- `authorizationMethod=magic_link` and
  `recoveryEmailVerificationStatus=verified_magic_link`;
- the same `recoveryEmailLookupHash` verified by the attempt;
- the exact selected draft ID, session hash, environment, scopes, and existing
  recovery/grant/session versions.

Draft selection is intentionally absent from disabled function paths. The
source handoff contract is tested using an explicitly selected synthetic draft.

## Client placeholder

`src/lib/proDraftFutureEmailVerificationClient.js` exports
`requestEmailOtp`, `verifyEmailOtp`, `requestMagicLink`, and
`consumeMagicLink`. Each checks its frontend flag first. With the committed
flags off it returns a typed disabled result without calling Base44. The module
adds no component, button, route, Redux action, automatic retry, browser
storage, token persistence, or general email control.

## Activation checklist

Activation requires a separately reviewed prompt and must not be inferred from
this source scaffold:

1. Threat/privacy review and ADR approval for the chosen method and initial
   email-only coexistence policy.
2. Staging-only entity push followed by live entity-level and field-level
   authorization certification.
3. Independently generated 32-byte-or-longer OTP and magic-link secrets, with
   rotation/version/revocation runbooks and no reuse.
4. Public request validation, abuse controls, CAPTCHA/lockout/rate limits,
   enumeration/timing analysis, attempt cleanup, and monitoring.
5. Authorized recipient selection, SES staging redirection, templates,
   bounce/complaint operations, and proof that disabled calls send zero email.
6. Atomic one-time update behavior under concurrency and link-scanner replay.
7. Approved magic-link URL/leakage design and exact redirect allowlist.
8. Newest-created/explicit-choice integration and exact-draft recovery-session
   authorization tests.
9. Client UX/accessibility/browser/link-opening tests without persistent raw
   values.
10. Disabled-first staging, production-disabled certification, rollback, kill
    switch, and separate final enablement approval. Both backend and frontend
    flags must remain `false` until those gates pass.

## Source tests

Synthetic tests cover the entity and RLS, disabled-before-side-effect order,
zero entity/email/generation calls, bounded non-parsing disabled requests,
secure six-digit rejection sampling, separate HMAC purposes/secrets,
verification/wrong/expiry/lock/replay behavior, 256-bit magic tokens,
redirect allowlist/open-redirect denial, raw-value exclusion, future exact-
draft session claims, safe diagnostics, client flag checks, and no storage/UI/
route integration. Exact command results are recorded after the complete
repository validation run for this source increment.

## Validation evidence

Validation was local and source-only. No Base44 deploy, entity push, secret
write, SES/email operation, frontend publication, or remote Git write ran.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `npm ci` | 0 | 775 packages added; 776 audited. NPM reported 29 dependency vulnerabilities (1 low, 8 moderate, 18 high, 2 critical) and six dependency build-script warnings. |
| `npx vitest run src/test/proDraftEmailVerification.test.js src/test/proDraftEmailVerificationFunctions.test.js src/test/proDraftFutureEmailVerificationClient.test.js src/test/proFormEmailVerificationAttemptSchema.test.js src/test/proDraftAuthorization.test.js` | 0 | 5 files and 72/72 tests passed. |
| `npx vitest run src/test/proDraftSecuritySelfCheck.test.js` | 0 | 18/18 tests passed, including shared-to-bundled authorization byte equivalence. |
| `npm run test:entity-schemas` | 0 | Schema validator passed; 4 files and 27/27 tests passed. |
| `node -e "JSON.parse(require('node:fs').readFileSync('docs/durable-draft-recovery/data/pro-form-field-manifest.json', 'utf8'))"` | 0 | Strict manifest parse passed. |
| `npx tsc --noEmit --allowImportingTsExtensions --moduleResolution bundler --module preserve --target ES2022 --lib ES2022,DOM --skipLibCheck base44/functions/_shared/proDraftEmailVerification/entry.ts base44/functions/_shared/proDraftAuthorization/entry.ts` | 0 | Passed. |
| `npm run build` | 0 | Vite build passed; stale browser-data warnings were emitted. |
| `npm test` | 1 | 84/86 files and 1,349/1,354 tests passed. Five inherited questionnaire/repair regressions remained. |
| `npm run lint` | 1 | 49 inherited findings: 32 errors and 17 warnings; no delivery path appeared in the findings. |
| `npm run typecheck` | 2 | 240 inherited errors; no delivery path appeared in the findings. |

The five full-suite failures are the established Q24 Other-to-normal
completeness regression, missing local backup after database-save failure,
string rather than numeric zero latitude/longitude, whitespace-only service
offering retention, and the missing `taggedPeople` coercion warning. None is
in a file changed by this increment. The focused framework, authorization,
entity, generated-security-bundle, and build gates all passed.
