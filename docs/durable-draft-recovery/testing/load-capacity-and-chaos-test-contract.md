# Durable Draft Load, Capacity, and Chaos Test Contract

## 2026-08-06 staging execution result

The comprehensive prompt stopped at the failing `staging_security` source
coverage gate. No remote smoke, load, full-capacity, soak, or controlled-failure
profile ran; no staging metric or cleanup result exists. Capacity certification
remains **BLOCKED** without weakening any threshold.

- Status: Source/local harness implemented; final staging capacity execution deferred
- Date: 2026-08-06
- Requirement: `DR-PERF-LOAD-001`
- Production execution: prohibited
- Deployment: prohibited

## Safety boundary

`scripts/run-pro-draft-load-test.mjs` accepts only `environment=staging` and
either an explicit remote HTTPS staging origin or the local-test `mock:`
adapter. Documented production hosts, production app IDs, loopback HTTPS,
credential-bearing URLs, missing cleanup, and ambiguous targets fail closed.
The runner uses a bounded in-process worker pool (maximum 64 workers),
cryptographically derived staging bootstrap credentials, and safe SHA-256
draft/app fingerprints. The derivation key is supplied only through
`PRO_DRAFT_LOAD_CREDENTIAL_SECRET`; it is never persisted by the harness.
Credentials remain in process memory and are excluded from checkpoints,
stdout, JSON, and Markdown.

The staging adapter invokes only the existing bootstrap, load, save, event,
code/email recovery, and cleanup function boundaries. It never invokes an SES,
Zapier, PDF, migration, retention, or deployment function. Submission locking
is exercised through authoritative persistence status transitions on a limited
synthetic subset; no external submission or PDF workflow is called.

## Profiles

| Profile | Default model | Purpose |
|---|---|---|
| `smoke` | 5 clients, 10 drafts, 2 logical minutes | Bootstrap, debounced save, reload, integrity, and cleanup |
| `save-burst` | 100 clients/drafts | Simultaneous logical mutation burst; ten mutations are represented by one save |
| `continuous-typing` | 100 clients, 20 keystrokes/minute, 15 minutes | Debounced batches plus periodic maximum-wait persistence |
| `recovery` | 100 drafts/code recoveries; ten bounded email recoveries | Recovery latency/errors without code-space enumeration or SES |
| `multi-tab-conflict` | 50 drafts, two actors each | Non-overlap automatic merge and same-field user-choice invariants |
| `submission-lock` | 25 drafts | Persistence-only lock transition and delayed-save rejection |
| `soak` | 100 concurrent clients, 1,000 drafts, 2 hours | Sustained staging stability; explicit command/confirmation required |
| `full-capacity` | 250 sessions, 1,000 drafts, 30 minutes | Final staging capacity gate; explicit command/confirmation required |
| `cleanup` | One test-run ID | Manual preview/delete/verify cleanup only |

Mock execution advances logical workload without sleeping. Remote staging
soak/capacity execution is reserved for the next prompt and must use an
approved pacing window and an operator-observed staging target.

## Options and execution model

The runner supports `--base-url`, `--environment`, `--profile`, `--clients`,
`--drafts`, `--duration`, `--concurrency`, `--test-run-id`, `--output`,
`--cleanup`, `--seed`, and the additional safety confirmation `--confirm`.
Durations accept seconds or `s`/`m`/`h`. Inputs are bounded to 500 clients,
5,000 drafts, 24 hours, and 64 workers. One process owns all workers; the
runner never spawns a process per client.

`soak` requires `--confirm RUN_SOAK_STAGING`. `full-capacity` requires
`--confirm RUN_FULL_CAPACITY_STAGING`, at least 250 clients, 1,000 drafts, and
30 minutes. These profiles also require the staging URL, environment, and
test-run ID as explicit command arguments. SIGINT/SIGTERM abort scheduling,
write a safe blocking report, and still execute cleanup.

The harness never performs an implicit retry. Initial timeouts, resets, 429s,
and 5xx responses remain visible in counters/failure evidence; deterministic
checkpoints resume remaining work after an operator reviews the failure. This
prevents a retry from hiding a server error or duplicating non-idempotent work.
For a soak process restart, supplying the same external credential-derivation
secret lets idempotent bootstrap reconstruct in-memory authorization while the
checkpoint skips completed operation indexes; the secret itself is not a
checkpoint field.

## Metrics

The reports collect bootstrap, local-save (when a browser adapter exists),
server-save, load, recovery-code, and email-recovery latency; conflict,
automatic-merge, and user-choice rates; retry, 4xx, 5xx, timeout,
authorization, and RLS failures; submitted regression, lost acknowledged
state, cleanup, and integrity mismatches; event rows and requests per logical
mutation; p50/p90/p95/p99/max; throughput; and maximum active sessions.

Continuous typing batches up to ten logical keystrokes into one server save.
`requestsPerLogicalMutation` and event amplification are recorded so a
request-per-keystroke regression is visible and release-blocking.

## Initial release thresholds

| Gate | Blocking threshold |
|---|---:|
| Successful-path error rate | `< 0.1%` |
| Lost server-acknowledged state | `0` |
| Cross-client leakage | `0` |
| Submitted regression | `0` |
| RLS/security-boundary failure | `0` |
| Ordinary server save p95 / p99 | `<= 2.5s` / `<= 5s` |
| Draft load p95 | `<= 3s` |
| Bootstrap p95 | `<= 4s` |
| Conflict invariant failure | `0` |
| Event rows per logical mutation | `<= 2` documented maximum |
| Unresolved cleanup records | `0` |

Thresholds may be tightened. Loosening requires an ADR and corresponding risk
register/acceptance update; the runner contains no command-line waiver.

## Integrity probes

After workload completion, the harness reads every mock record and every
tracked critical staging draft. It compares the last acknowledged state hash,
checks compatibility fingerprints and monotonic revisions, verifies submitted
locks, rejects cross-client credentials, replays bootstrap idempotently,
checks newest-created email selection, examines event amplification, and
verifies the test-run marker. Reports contain mismatch codes and counts only.

## Controlled chaos

`tests/chaos/` contains in-memory/client-interception fixtures for network
timeout, reset, 500, 429/retry-after classification, offline/reconnect,
out-of-order and duplicate response, unavailable/quota-exceeded browser
storage, IndexedDB failure, save conflict, event append failure, mocked SES
failure, migration interruption, and cleanup interruption.

No backend chaos endpoint or production behavior was added. The SES fixture is
an in-memory adapter with live sending disabled. Staging fault execution should
prefer browser/network interception. A future diagnostic hook would require a
staging environment, admin grant, default-disabled control, and a separate
security review.

## Checkpoint, resume, and cleanup

Each run uses a unique safe test-run ID. `safe-progress-checkpoint.json` stores
only the profile, seed, configuration fingerprint, completed numeric operation
indexes, and draft fingerprints. Configuration mismatch blocks resume. It
never stores URLs, answers, email, codes, grants, tokens, or credentials.

Cleanup runs in `finally`, scopes every operation to the exact test-run ID, and
requires delete verification to return zero. Remote cleanup additionally
requires the staging app ID, a non-production match, an in-memory admin grant,
and the approved `cleanupDurableDraftTestData` preview/delete/verify function.
Until that staging function is deployed and verified under separate
authorization, live load execution is `BLOCKED`; local mock cleanup is fully
executable. `load:test:cleanup` provides the manual cleanup entry point. A
cleanup error or remaining record produces `BLOCKED`, never `PASS`.

## Safe report set

The configured output directory receives:

- `load-summary.json`
- `latency-histograms.json`
- `integrity-summary.json`
- `failure-summary.json`
- `cleanup-summary.json`
- `load-summary.md`

Reports include commit, staging app fingerprint, profile, seed, safe
configuration, threshold checks, and `PASS`/`FAIL`/`BLOCKED`. A recursive
report guard rejects credential-bearing keys and PII/private-key values. No
answer, email, recovery code, token, grant, or raw target URL is written.

## Commands

```text
npm run chaos:test
npm run load:test:smoke

PRO_DRAFT_LOAD_BASE_URL=<approved-staging-url> \
PRO_DRAFT_LOAD_ENVIRONMENT=staging \
PRO_DRAFT_LOAD_CREDENTIAL_SECRET=<operator-supplied-secret> \
npm run load:test:save-burst -- --test-run-id <unique-run-id> --cleanup always

npm run load:test:soak -- \
  --base-url <approved-staging-url> --environment staging \
  --test-run-id <unique-run-id> --cleanup always \
  --confirm RUN_SOAK_STAGING

npm run load:test:full -- \
  --base-url <approved-staging-url> --environment staging \
  --test-run-id <unique-run-id> --cleanup always \
  --confirm RUN_FULL_CAPACITY_STAGING
```

The soak and full-capacity commands are documented for the next prompt; they
were not run here. No command deploys, calls production, sends SES, invokes
Zapier, creates PDFs, or pushes Git.

## 2026-08-06 local validation

| Command | Result |
|---|---|
| `npm ci` | Exit `0`; 777 packages installed. Audit reported 29 existing findings (1 low, 8 moderate, 18 high, 2 critical); no dependency mutation or automated fix was performed. |
| `npm run test:manifest` | `PASS`; 154 normal, 5 characterization, 15 Playwright, 5 security, and 2 load/chaos files classified |
| `npm run chaos:test` | 29/29 load-harness and chaos cases passed |
| `npm run load:test:smoke` | `PASS`; 5 clients/10 drafts, integrity clean, cleanup verified zero |
| Mock `save-burst`, `continuous-typing`, `recovery`, `multi-tab-conflict`, and `submission-lock` profiles | All `PASS`; every run verified cleanup to zero |
| `npm test` | Exit `1`; 152/154 files and 2,107/2,110 tests passed. Three established assertions failed in `proQuestionnaire.regression.test.jsx` and `proSubmissionRepairHelpers.test.js`; none is in a touched load/chaos path. |
| Repository `npm run lint` | Exit `1`; established baseline contains 28 errors and 14 warnings. Focused ESLint over every added load/chaos JavaScript module exited `0`. |
| Repository `npm run typecheck` | Exit `2` from established baseline diagnostics; filtering the complete output for the added load/chaos paths returned no diagnostics. |
| `npm run build` | Exit `0`; production bundle and sensitive-built-artifact policy passed |
| `npm run security:scan-artifacts -- --path .durable-draft-artifacts/load` | `PASS`; 91 generated checkpoint/report files scanned with zero findings |
| Full capacity / soak | Not run by explicit prohibition |

Final remote staging load, latency, cleanup, and capacity evidence remains the
next prompt’s work and cannot be inferred from local mock results.
