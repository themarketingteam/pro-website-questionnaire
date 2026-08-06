# Durable Draft Security and Adversarial Test Contract

- Status: Authoritative source and local-test contract; staging execution remains separately gated
- Date: 2026-08-06
- Requirement: `DR-SEC-ADV-001`
- Production execution: prohibited
- Deployment: prohibited

## Scope and execution boundary

This suite exercises the durable-draft security boundary through deterministic
unit/integration mocks, a read-only local browser preview, and an explicitly
verified separate staging target. `tests/security/helpers/targetSafety.js`
rejects production environments, documented production hosts, ambiguous
staging hosts, non-loopback local targets, non-isolated rate-limit subjects,
and more than 20 attempts. No test enumerates the recovery-code space.

The staging harness requires `SECURITY_TARGET_ENVIRONMENT=staging`, a visibly
non-production `SECURITY_BASE_URL`, a unique security run ID, and an isolated
`@example.test` subject containing that run ID. It rejects production/email
authorization and executes serially. It does not deploy, alter rate limits,
send email, or perform a final capacity load.

## Public recovery

Coverage includes generic invalid/unknown/ineligible error equivalence,
malformed/unknown code equivalence, bounded timing, rate limits, CAPTCHA,
lockout, trusted-IP extraction, device/draft/email-hash injection, exact draft
and associated scope, cross-email choice denial, terminal draft denial, hash
redaction, and no answer preview before authorization. Existing backend handler
suites run as part of `security:test`.

## Signed tokens and grants

Tests cover payload/signature tampering, wrong type/scope/environment/draft/
device, expiry, grant/password/policy/session version revocation, rotation,
purpose separation, algorithm-field confusion, extra segments, oversized and
control-bearing tokens, duplicate JSON keys, replay, and browser absence. Admin
grants intentionally have no fixed expiry but remain version-revocable. Tokens
and grants are forbidden outside their dedicated vaults.

## RLS and service role

The RLS contract enumerates anonymous and authenticated non-admin direct CRUD
denials against draft, event, recovery-security, and migration data. Authorized
recovery and admin access must use backend functions. Existing static/order
gates require request validation and authorization before `asServiceRole`; an
authorization failure performs zero protected reads and an RLS error never
selects a frontend direct-entity fallback. Live denial/success proof is
staging-only, and any mismatch is release-blocking.

## Request and payload attacks

The suite covers oversized/declared/chunked bodies, deep nesting, excessive
keys, circular client input, prototype pollution keys, method/content-type
confusion, duplicate JSON keys, invalid UTF-8, null/control characters, header
and email-header injection, redirects, traversal, HTML/script input,
spreadsheet formula input, and log newlines. The shared output-safety helper
neutralizes formula-leading cells, collapses log controls, and denies external,
traversing, malformed, or control-bearing redirect targets. No current product
path exports draft data as CSV; this contract is the required boundary for any
future CSV-style security report. The shared parser rejects duplicate
object keys rather than accepting last-key-wins ambiguity.

HTTP request smuggling is out of scope because this repository exposes no
controllable edge/proxy framing layer. A provider-approved isolated proxy test
is required if Base44 later exposes that boundary.

## State and concurrency

Coverage includes lower-revision replay, same-revision/different-hash, expected
revision mismatch, terminal status regression, duplicate Clear All, partial
replacement retry, Clear All/save and submit/save races, two-tab same-field
conflict, event/batch replay, migration replay, opposite-direction leases, and
destination overwrite. Server revision/status remain authoritative.

## SES and email

All email tests use transport mocks. Staging redirect is mandatory; missing
routing fails closed; production mode and recipient/sender overrides are
rejected in staging; subject/header injection is rejected; HTML is escaped;
codes never appear in URLs; diagnostics contain no raw email/code; duplicate
delivery remains idempotent; and delivery-uncertain behavior is explicit. OTP
and magic-link delivery stays disabled. Templates contain no tracking pixel,
external image, executable content, or answer data. This contract never sends
email or constructs a live SES client.

## Migration

Bundle/route tests cover signature, destination/source/environment
substitution, sequence/chain replay, count/hash mismatch, staging/production
cross-environment denial, same-app denial, ID-map/origin collision, unapproved
entity, test contamination, raw bundle prohibition, report redaction,
opposite-direction lease, and reverse conflicts. Raw bundles are not committed
or admitted to sanitized evidence.

## Browser credential leakage

The local Chromium test inspects URL, history/location state, DOM, optional
exposed Redux state, canonical/local/session storage, vault key names, IndexedDB
stores, BroadcastChannel posts, console/page errors, network request metadata,
and analytics-like calls. Its attachment contains counts/booleans only and
checks resume tokens, sessions, codes, grants, AWS/SES credentials, emails,
answers, and token URLs.

## Deterministic property testing

`fast-check` drives canonical-state and bounded-JSON parsing, recovery-code/
email/domain normalization, signed-token and migration-bundle parsing,
field-path merge discovery, idempotency validation, and UI state sanitization.
The default recorded seed is `20260806` with 100 bounded runs. Failures report
only seed, shrink path, run/skip counts; counterexamples are never logged.

## Artifact scanner

`scripts/scan-durable-draft-test-artifacts.mjs` recursively scans logs,
Playwright/network/evidence/migration JSON, screenshot metadata, and other text
artifacts for recovery-code shapes, compact signed tokens, Base64URL prefixes,
email, AWS keys, webhook URLs, canonical response values, and private-key
markers. Findings print only path, line, column, pattern, and `[REDACTED]` and
exit nonzero.

Synthetic email allowlisting is permitted only below `protected-raw/` or
`raw-artifacts/` with `--allow-synthetic-in-raw`. Sanitized evidence receives no
allowlist. Safe hash fingerprints are not credential patterns.

## Dependency audit

`security:audit-dependencies` runs `npm audit --json` for both the full graph and
the production graph (`--omit=dev`). It writes a package/severity-only summary
under ignored `.durable-draft-artifacts/security/`. Critical production and
high direct exposed runtime findings block. Dev-only findings require explicit
review. The tool never applies `npm audit fix` or a major upgrade.

## Commands

```text
npm run security:test
npm run security:test:browser -- --project=chromium-desktop
npm run security:scan-artifacts
npm run security:audit-dependencies
SECURITY_TARGET_ENVIRONMENT=staging SECURITY_BASE_URL=<approved-staging-url> \
  SECURITY_TEST_RUN_ID=<unique-run-id> \
  SECURITY_RATE_LIMIT_SUBJECT=<run-id>@example.test \
  npm run security:test:staging
```

No command deploys, pushes Git, sends email, or authorizes production.

## 2026-08-06 observed local validation

| Command | Exit | Observed result |
|---|---:|---|
| `npm ci` | 0 | 777 packages installed from lockfile; 29 audit findings; no fix applied |
| `npm run security:test` | 0 | 66/66 new security/property/tool cases and 394/394 authoritative existing security/state cases passed |
| `npm run security:test:browser -- --project=chromium-desktop` | 0 | 1/1 read-only local leakage case passed |
| staging safety harness with `security-staging.example.test` | 0 | 3/3 guard-contract cases passed; the hostname was validated but never contacted |
| `npm run security:audit-dependencies` | 1 | `BLOCKED`: 29 full / 25 production findings; blockers are critical `jspdf`, critical runtime-classified `vitest`, and high direct `lodash` / `react-router-dom` |
| default historical artifact scan | 1 | 898 findings across 2,582 pre-existing Playwright/test artifacts; locations were redacted |
| current browser-run plus dependency-summary scan | 0 | Three files scanned; zero findings |
| `npm test` | 1 | 2,107/2,110 passed; three established questionnaire/submission-repair failures remain |
| `npm run lint` | 1 | Existing baseline: 28 errors and 14 warnings; focused changed-file lint passed |
| `npm run typecheck` | 2 | Existing repository/node-module diagnostics remain |
| `npm run build` | 0 | Vite build and sensitive built-bundle policy passed |

The four dev-only audit packages recorded for review are `@babel/core`, `ajv`,
`flatted`, and `js-yaml`. This is classification, not acceptance of an exposed
runtime path. The dependency and historical-artifact failures remain explicit
release blockers; no result was reclassified as flaky.

## Release-blocking criteria

Release is blocked by an authorization/RLS escape, cross-draft/email recovery,
token purpose/binding/version bypass, stale/terminal overwrite, unredirected
staging email, migration integrity/route/replay failure, browser credential
leak, sanitized artifact finding, uncontrolled rate test, production target,
critical production dependency, or unmitigated high direct exposed runtime
dependency. Security failures are never marked flaky.
