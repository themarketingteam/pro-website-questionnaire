# Durable Draft Recovery Risk Register

## 2026-08-06 final manual-certification risks

- **Open:** real iOS/Android, VoiceOver, TalkBack, NVDA, keyboard-only, Outlook,
  Gmail, Teams, iOS Mail, and Android Gmail evidence is unavailable.
- **Open:** no approved staging URL or internal test mailbox was available, so
  no safe test link was generated or sent and no email-client rendering claim
  is made.
- **Open:** the local synthetic PDF visually preserved content but rendered as
  one nonstandard `612 x 5115.93 pt` raster page. Standard pagination and mobile
  download usability remain release-blocking.
- **Mitigation:** `release:validate-manual-evidence` rejects missing rows,
  unnamed/stale results, production or credential-bearing URLs, and incomplete
  email/PDF evidence. The staging RC cannot pass while these risks remain.

## 2026-08-06 comprehensive certification stop

The `staging_security` coverage gate failed with 25 release blockers before any
live staging operation. Security, browser, capacity, integrity, cleanup, and
deployment risks remain open at their existing severity. No mitigation is
downgraded and no production approval is implied. See the
[blocked certification report](../testing/staging-comprehensive-automated-certification.md).

## 2026-08-06 load, capacity, and controlled-failure controls

| Risk | Control added | Residual / release gate |
|---|---|---|
| Keystroke request storm or event amplification | Debounced logical batches, request/event ratios, fixed amplification threshold | Final sustained staging evidence pending |
| Lost acknowledged state or revision regression | Post-load hash, compatibility, monotonic revision, idempotent bootstrap, and submitted-lock probes | Exact staging candidate must pass with zero mismatches |
| Cross-client disclosure under concurrency | Wrong-client credential probe and exact test-run markers | Live staging authorization/RLS result pending |
| Hidden transient/backend failures | No implicit runner retry; 4xx/5xx/timeout counters and controlled interception fixtures | Staging service behavior/latency pending |
| Load-test data remains after interruption | Safe checkpoint, `finally` cleanup, exact run-ID delete, zero-record verification, manual cleanup command | Cleanup backend function and admin staging grant must be deployed/verified before live load |
| Capacity run triggers external side effects | Adapter allowlist excludes SES, Zapier, PDF, migration, and deployment functions | Reconfirm staging side-effect flags immediately before final run |

The local 5-client/10-draft smoke and 29-case harness/chaos suite are mechanics
evidence only. Full capacity and soak were deliberately not executed. No risk
rating is lowered until remote staging thresholds and cleanup pass.

## 2026-08-06 comprehensive adversarial security controls

| Risk | Control added | Residual / release gate |
|---|---|---|
| Recovery, token, or admin-grant bypass | Deterministic enumeration/timing/binding/replay/revocation/purpose/browser suites | Live staging authorization and abuse evidence remains required |
| Parser or injection ambiguity corrupts authoritative state | Bounded property tests; method/type/size/UTF-8 controls; duplicate JSON keys rejected | Provider edge request smuggling remains outside the repository boundary |
| Direct entity or premature service role bypass | RLS catalog plus source/order validators in `security:test` | Deployed staging RLS denial and authorized-function success pending |
| Staging test harms a client or SES reputation | Production denial, isolated `example.test` subjects, 20-attempt ceiling, mock-only email | No live email is authorized by this batch |
| Migration replay/substitution corrupts data | Signature/route/sequence/hash/lease/conflict adversarial cases | Live bidirectional staging rehearsal pending |
| Credentials leak into browser/evidence | Local Playwright inspection and redacting nonzero scanner | Exact deployed staging bundle/log scan pending |
| Vulnerable exposed runtime dependency | Full plus production audit classifier; no auto-fix/major upgrade | Current audit must be dispositioned before release |

These controls add source-level detection and hard gates; they do not lower a
risk rating without deployed staging evidence. No production target, email
transport, deployment, or cloud data was contacted by this prompt.

Observed dependency classification is release-blocking: critical production-
graph findings affect `jspdf` and the currently runtime-classified `vitest`,
while high direct findings affect `lodash` and `react-router-dom`. The tool also
records four dev-only packages for review. No automatic fix, dependency major
upgrade, or finding waiver was performed.

## 2026-08-06 final local RLS pre-deployment safeguards

| Risk | Control added | Residual / release gate |
|---|---|---|
| RLS or authorization failure triggers insecure browser fallback | Shared client error policy; no direct-fallback outcome | Live staging denial/network inspection pending |
| Kill switch destroys or misrepresents local state | Four-outcome policy preserves state, credentials, locks, and visible sync pause | Product UI acceptance in deployed staging pending |
| Dead direct-access code survives tree shaking | Mandatory post-build sensitive bundle scan; source maps explicitly excluded | Re-run for the exact deploy artifact |
| Service-role access precedes authorization | Required-function order contract plus service-role source validator | Live error/metric ordering pending |
| RLS deploy targets production or lacks evidence | `precheck:rls` denies production links and missing certifications | Current real precheck is blocked on four codes |
| Emergency response reopens public entity access | Time-limited, approval-bound last-resort runbook | Human approval and monitoring remain required |

The current production-linked checkout is deliberately not deployable. The
blocked precheck prevents availability work from silently weakening the data
boundary.

## 2026-08-06 local draft entity RLS hardening

| Risk | Control added | Residual / release gate |
|---|---|---|
| Anonymous or ordinary user calls Draft/Event entities directly | All four entity operations require `role=admin` locally | Schema remains unpushed; live denial pending Prompt 4 |
| Service role fails after RLS because admin is not included | Explicit admin condition on every operation; SDK contract and validator tests | Must certify deployed staging functions before RLS push |
| Backend elevates before validating/authorizing a request | Static service-role/request-client/authorization validator | Live abuse and denial auditing pending |
| Compatibility break reaches final submission/intake | Both excluded schemas are byte-frozen | Separate submission hardening remains future work |
| RLS is pushed before backend readiness | Deployment-order warning and staging checklist hard stop | Human/CI deployment sequencing remains required |

This reduces local source/schema uncertainty only. A premature RLS push could
deny legitimate questionnaire operations, so `DR-RLS-001` and the associated
availability risk remain release-blocking until deployed backend success and
direct-denial tests pass in a verified staging target. Blue production remains
unchanged.

## 2026-08-06 direct sensitive entity access hardening

| Risk | Control added | Residual / release gate |
|---|---|---|
| Browser bypasses backend authorization with direct sensitive-entity SDK calls | Legacy draft/event browser CRUD removed; policy-driven source and bundle validation forbids five sensitive entities | Restrictive cloud RLS and authorized staging proof remain release-blocking |
| Refactor hides access behind alias, bracket, concatenation, or dynamic lookup | AST/alias validator and regression fixtures fail closed | Keep policy and built-output scan mandatory in CI |
| Direct REST transport returns through E2E-only code | Shared Playwright guard rejects observed Base44 entity route shapes and redacts diagnostics | Credentialed staging network capture remains pending |
| Kill switch silently restores unsafe legacy writes | Disabled/killed V2 pauses edits/writes and offers retry/recovery without clearing local state | Availability tradeoff accepted; blue application remains rollback point |

Local static, focused, harness, build, and bounded browser gates passed. The
normal suite retains three established failures, and repository lint/typecheck
debt remains; risk ratings are therefore not promoted to production-certified.
No RLS, cloud, production, domain, or delivery state changed.

## 2026-08-06 backend administration update

| Risk | Control | Residual status |
|---|---|---|
| Grant theft/cross-device replay | Environment/version claims, device HMAC, no URL/log transport | Staging abuse certification pending |
| Bulk disclosure | Limits, signed query-bound cursors, projections, masking/hash omission | Staging response inspection pending |
| Unsafe edit | Allowlist, validation, submitted lock, revision, idempotency, audit | Concurrent staging proof pending |
| Retry/repair bypass or production side effect | Authorization precedes service role/AI/delivery; environment routing retained | Staging delivery proof pending |
| Legacy UI direct entity calls | Migration explicitly deferred to next prompt | Open/release-blocking |

### Admin UI migration update

The legacy direct-call risk is now source-mitigated: both recovery routes use
the persistent password-issued grant, the browser UI uses only bounded backend
APIs, and a static guard rejects prohibited draft/event/intake/security entity
access. Grant rejection clears the invalid credential and returns to the gate;
active edit invalidation produces a discard warning. Remaining residual risk
is live staging authorization, audit, projection, revocation, concurrency, and
side-effect certification. `RISK-028` remains mitigated pending that proof.

## 2026-08-06 password-only admin authorization source update

`RISK-002` and `RISK-022` now have source controls for backend-only exact password verification, purpose-separated HMAC/timing-safe comparison, an environment/version/random-device-bound signed grant with `expiresAt=null`, IP/device attempt limits, lockout, minimum timing/jitter, safe audit records, an isolated resilient browser vault, invalid-grant removal, and Forget This Device. The accepted indefinite shared-password grant risk remains: this is not individual administrator identity, and theft from the same browser/device context may remain usable until revocation. Operational likelihood is not reduced until staging configuration, schema/function deployment, trusted-header/event-store proof, admin page/API migration, monitoring, and live rotation/version tests pass. No cloud or production state changed in this source batch.

## 2026-08-06 client replacement-control update

| Risk | Control added | Residual / release gate |
| --- | --- | --- |
| Local-only Clear All lets an active server draft resurrect | Server-accepted revision followed by idempotent backend replacement; old data remains support-recoverable | Live staging transaction and recovery-selection certification pending |
| Broad browser cleanup deletes another client | Exact draft namespace keys only; Client B retention tests; no storage-wide clear | Cross-browser staging storage inspection pending |
| Old async save updates new Redux state | Manager lifecycle generation and draft tag reject late save/event completion after invalidation/disposal | Live throttled-network/multi-tab certification pending |
| Replacement commits but email fails | New code remains visible; delivery status is explicit; creation is not rolled back | Live SES staging failure/redirect evidence pending |
| Start New mutates submitted evidence | Submitted source is read-only, is not superseded, and its browser namespace is retained | Immutable submitted/PDF staging proof pending |
| Raw replacement credentials leak | Controller memory only for display/handoff; credential vault for token; Redux/URL/history and diagnostics scans | Built-bundle/log/network staging scan pending |

Local evidence passed 83/83 focused cases and 90/90 synthetic browser cases
across the configured five-project matrix. These results reduce source-level
uncertainty only; no risk rating is lowered without live Base44, SES, deployed
browser, log/bundle, cleanup, and submitted-record immutability evidence.

- Status: Active architecture risk register
- Date: 2026-08-06
- Owners: Isaac Hines; Engineering; Security; Operations
- Sources: [ADR-001](../architecture/ADR-001-approved-product-and-security-decisions.md), [ADR-002](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md), [ADR-003](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md), [identity normalization contract](../architecture/draft-identity-and-email-normalization-contract.md), [current system audit](../audit/current-system-audit-report.md), [current defect register](../audit/current-defect-register.md)

## 2026-08-06 failed sync and mutation staging gate

- The full normal source gate failed 5 of 1,586 tests after 254/254 focused
  sync/conflict/listener/component/mutation/API cases passed.
- Deployment, live revision/hash proof, offline/multi-tab behavior, lifecycle,
  server-field inspection, load, and cleanup remain unobserved.
- No staging or production write occurred, so there is no new data-integrity
  exposure from this attempt; there is also no new risk reduction from staging
  proof.
- `RISK-004`, `RISK-005`, `RISK-006`, `RISK-029`, and all release-gate risks
  remain open. Deployment authorization and feature-branch push remain denied.

## 2026-08-06 complete mutation-capture update

- V2 server scheduling now occurs after reducers and reads the complete current
  canonical store at save preparation, reducing `RISK-005` and `RISK-029`
  source-level stale/partial-snapshot exposure.
- Q5 primary repair, conditional child deletion, and Reset Question are atomic
  local mutations with safe summarized events.
- Incomplete editor values use versioned `uiDraftState`; raw `File`, `Blob`,
  `FileList`, Google, DOM, and token-bearing objects remain excluded.
- Text/UI events are bounded by debounce while structural events are immediate;
  the snapshot remains authoritative.
- Residual risk is unchanged: live Base44 round trips, real interrupted uploads,
  staging lifecycle behavior, and the next-batch Clear All/submission
  transactions are uncertified. Deployment authorization remains denied.

## 2026-08-06 conflict and multi-tab control update

- Concurrent non-overlapping edits are mitigated by three-way field merge with
  the last acknowledged base and server-authoritative revision.
- Ambiguous same-field, delete/set, reset/set, and credential changes remain
  visible and paused until explicit choice; no last-writer timestamp shortcut
  is used.
- Cross-tab leakage is mitigated by a hashed namespace and a strict message
  allowlist. Tests assert no answer, identity, credential, or token field is
  emitted through either transport.
- Broadcast/storage loss remains an accepted degraded-mode risk: the UI reports
  no coordination, while backend optimistic concurrency still prevents stale
  overwrite.
- Automatic merge storms are bounded to three rounds. Exceeding the ceiling
  requires reload/support and retains the local recovery copy.
- Residual risk: deployed Base44 concurrency, real browser lifecycle behavior,
  and production-scale conflict telemetry are not certified by local synthetic
  evidence. Release status remains blocked pending staging evidence.

## Rating and treatment rules

Likelihood is `Low`, `Medium`, or `High` before planned controls. Severity is `Moderate`, `High`, or `Critical`. **Accepted (known residual)** means the named owner knowingly accepts the residual risk for the initial release; controls reduce likelihood or impact but do not remove acceptance. **Mitigated (pending proof)** means release remains blocked until the mapped acceptance evidence proves the mitigation.

Any detection meeting a rollback trigger is an operational trigger, not permission to wait for a percentage threshold when client data, authorization, or integrity is at risk. Review dates are next required reviews and must also be repeated before certification and after a material incident or design change.

## 2026-08-06 client synchronization control update

The [authoritative client sync manager](../frontend/draft-sync-manager-contract.md)
adds local source controls for `RISK-004`, `RISK-005`, `RISK-006`, `RISK-007`,
and `RISK-029`: immediate canonical-cache coordination, one-in-flight
serialization, newest-state coalescing, hash-bound idempotency, backend-only
server revision acceptance, bounded transient retry, offline recovery,
conflict pause, and submitted/superseded timer locks. Safe provider ownership
also prevents Strict Mode from constructing concurrent V2 managers, while an
explicit feature branch preserves the legacy writer only when V2 is disabled.

These controls reduce source-level implementation uncertainty but do not lower
any likelihood or severity. Multi-tab merge is implemented by the later update
above, but every component has not yet migrated to the canonical mutation
factory; staging concurrency, lifecycle, browser-close, authorization, and
deployed log evidence is absent. The full normal test, lint, and typecheck gates
are not green, so all mapped risks remain **Mitigated (pending proof)** and
deployment authorization remains denied.

## Register

| Risk ID | Description | Cause | Impact | Likelihood | Severity | Accepted or mitigated | Mitigation | Detection | Rollback trigger | Owner | Review date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `RISK-001` | Public email-only recovery exposes answers to someone who knows the exact client email. | Initial release treats an unverified email association as sufficient recovery input. | Unauthorized disclosure of sensitive questionnaire and submitted content. | High | Critical | **Accepted (known residual): public email-only recovery** | Generic responses, per-IP/per-email-hash limits, delay, CAPTCHA, lockout, safe audit, later OTP/magic-link framework. Controls do not verify ownership. | Recovery anomaly, enumeration, cross-scope synthetic, and client report monitoring. | Any confirmed cross-client exposure or recovery authorization bypass: disable public email recovery immediately and declare `FAILED`. | Isaac Hines; Security | 2026-08-19 |
| `RISK-002` | An indefinite browser-persisted password-only admin grant is stolen. | Shared password issuance plus persistent browser storage and no fixed expiry. | Long-lived unauthorized support access and sensitive data disclosure/change. | Medium | Critical | **Accepted (known residual): indefinite browser-persisted admin grant** | Backend password verification, signed environment/scope/version claims, practical binding, secret/version revocation, Forget This Device, rate limits, audit, future individual admin identities. | Grant-version rejection, unusual privileged access, device correlation, and admin audit alerts. | Any stolen/replayed grant or scope escape: rotate signing secret/increment version, disable admin recovery, investigate all affected access. | Isaac Hines; Security | 2026-08-19 |
| `RISK-003` | Browser storage is completely unavailable. | Privacy mode, policy, quota, getter/operation exceptions, or unsupported IndexedDB. | Local-only changes can be lost and bootstrap can fail if storage is assumed. | Medium | High | Mitigated (pending proof) | Capability wrapper, memory fallback, server-first recovery, truthful local/offline wording, bounded bootstrap. | Storage-fault browser matrix and uncaught-error telemetry. | Repeated boot failure, infinite bootstrap, or false server-confirmed label: activate kill switch and retain existing flow. | Application owner | 2026-08-19 |
| `RISK-004` | Network fails before server acknowledgement. | Disconnect, timeout, browser close, service outage, or retry exhaustion. | Recent local mutations are not durable across devices despite misleading UI. | High | High | Mitigated (pending proof) | Immediate local capture, queued retry, explicit pending/offline state, revision/hash idempotency, no **Saved securely** before acknowledgement. | Pending-age, save error/latency, offline queue, and acknowledgement telemetry. | False **Saved securely**, data loss after an acknowledged save, or save error threshold breach: disable feature and investigate. | Application on-call | 2026-08-19 |
| `RISK-005` | A stale autosave overwrites newer state. | Delayed tab/request, unconditional update, or client-time last-write-wins. | Lost client answers and corrupted canonical state. | High | Critical | Mitigated (pending proof) | Compare-and-set server revision, stable hash, field metadata, stale rejection, deterministic merge/conflict behavior. | Conflict/stale metrics and adversarial multi-tab tests. | Any demonstrated stale overwrite: kill switch, stop writes, preserve evidence, and repair affected records. | Application owner | 2026-08-19 |
| `RISK-006` | Submitted state regresses. | Delayed autosave, retry response, merge, compatibility projection, or incorrect status transition. | Submitted answers become editable or inconsistent with final output. | Medium | Critical | Mitigated (pending proof) | Terminal server guard, immutable submitted snapshot, allowed-transition validation, current revision requirement. | Terminal-state assault suite and status-transition alerts. | Any `submitted` regression: immediate `FAILED`, disable writes, preserve data, and invoke rollback decision. | Application owner; Security | 2026-08-19 |
| `RISK-007` | Clear All old draft receives a delayed save. | Pending debounce/tab retains old ID or server accepts stale revision after supersession. | Old record changes, replacement chain becomes inconsistent, or automatic selection becomes unsafe. | High | Critical | Mitigated (pending proof) | Cancel/coalesce saves, supersession compare-and-set, old status/draft/session/revision guards, idempotent replacement transaction. | Delayed-save suite and post-supersession mutation alert. | Any old-draft mutation after supersession: disable Clear All/draft writes and reconcile both records. | Application owner | 2026-08-19 |
| `RISK-008` | SES sends a staging message to a real client. | Incorrect environment routing, allowlist bypass, copied production configuration, or retry path bypass. | Privacy incident and unapproved client communication. | Medium | Critical | Mitigated (pending proof) | Backend recipient rewrite, deny-by-default allowlist, `[STAGING]` prefix, environment assertion, 100-message routing test. | SES event comparison of entered versus actual recipient; staging delivery audit. | Any staging-to-client delivery: stop staging sending, rotate/restrict credentials, investigate recipients, and fail release. | Messaging owner; Security | 2026-08-19 |
| `RISK-009` | SES sender remains sandboxed or unverified. | Account/region/domain readiness not inventoried before release. | Production code cannot deliver Clear All messages or delivery is throttled/rejected. | Medium | High | Mitigated (pending proof) | Verify region, production status, domain/sender, quotas, IAM, bounce/complaint paths before certification. | SES readiness inventory and delivery synthetic. | Sandbox/unverified status at gate or delivery failure threshold: block enablement; disable email-dependent path if already active. | Messaging owner | 2026-08-19 |
| `RISK-010` | Migration duplicates rows. | Non-idempotent create, missing composite identity, checkpoint replay, or partial retry. | Duplicate drafts/submissions/events and incorrect selection/reporting. | Medium | Critical | Mitigated (pending proof) | Composite source identity, upsert, durable ID map, batch/version metadata, overlap-safe retries, exact counts/hashes. | Duplicate-key/report scan after every batch and repeated-delta rehearsal. | Any unresolved duplicate at cutover: stop migration/cutover and repair idempotently. | Migration owner | 2026-08-19 |
| `RISK-011` | Migration misses newly created or updated rows. | Bad checkpoint, equal timestamps, delayed visibility, no overlap, or write during transfer. | Lost acknowledged production data in green or blue after rollback. | Medium | Critical | Mitigated (pending proof) | Per-entity server checkpoints, stable tie-break, overlap window, repeated delta, freeze delta, late-write reconciliation. | Count/hash/date-range comparison and source changes beyond checkpoint. | Any missing or unresolved eligible row: block domain movement; pause safest environment if detected after cutover. | Migration owner | 2026-08-19 |
| `RISK-012` | Uploaded file references fail in green. | App-scoped object ownership, inaccessible URLs, unexamined storage, or missing remap. | Recovered answers/PDFs lose required client files. | Medium | High | Mitigated (pending proof) | Inventory every reference, test reachability, deliberately copy/remap when required, include in integrity report. | Automated reachability plus deep sample before and after cutover. | Any unresolved required file: block cutover; if post-cutover, pause related operations and consider rollback. | Migration owner; Application owner | 2026-08-19 |
| `RISK-013` | Production domain transfer is delayed. | Base44 permission, detachment/attachment behavior, DNS propagation, or platform issue. | Client outage or inconsistent routing during launch. | Medium | High | Mitigated (pending proof) | Rehearse exact procedure, preserve fallback URLs, short freeze, owner/escalation, timed health checks. | Domain resolution, HTTP routing, certificate, and health probes from multiple networks. | Domain/routing invalid for `10` minutes after attachment: execute ADR-002 rollback decision after data safety check. | Operations owner | 2026-08-19 |
| `RISK-014` | SSL certificate issuance or attachment is delayed. | DNS/certificate validation timing or incorrect domain configuration. | Browser trust failure and inaccessible production questionnaire. | Medium | Critical | Mitigated (pending proof) | Non-production rehearsal, certificate preconditions, fallback URL, continuous TLS probes, explicit reversal steps. | Certificate chain/hostname/expiry checks from multiple clients. | Invalid production TLS for `10` minutes: reverse domain after verified data reconciliation. | Operations owner | 2026-08-19 |
| `RISK-015` | Green fails after cutover. | Undetected configuration, integration, capacity, data, or code defect. | Save/recovery/submission outage or client data risk. | Medium | Critical | Mitigated (pending proof) | Clean green certification, disabled-first deploy, observability, kill switch, blue preservation, reverse migration. | Production synthetic checks and ADR-002 failure-rate/security thresholds. | Any data/security incident immediately, or save/submission/5xx threshold breach: pause green and execute rollback sequence. | Incident commander | 2026-08-19 |
| `RISK-016` | Reverse migration fails during rollback. | Missing reverse mapping, conflict, file dependency, or untested transformation. | Cannot safely restore blue without losing green-acknowledged writes. | Medium | Critical | Mitigated (pending proof) | Implement/test reverse path before launch, preserve maps/checkpoints, pause green, fail closed on integrity. | Reverse counts, hashes, relationships, files, and unresolved-row report. | Any unresolved reverse failure: keep safest environment write-paused; do not move domain first. | Migration owner; Incident commander | 2026-08-19 |
| `RISK-017` | An already-open blue tab writes after cutover. | Cached client/endpoint or in-flight request outlives freeze/domain movement. | Acknowledged data remains only in blue and is absent from green. | High | Critical | Mitigated (pending proof) | Observe blue, detect within five minutes, idempotent late-write batch, conflict quarantine, continued reconciliation window. | Blue change stream/checkpoints compared to green hashes and event streams. | Late write not reconciled within target or silent conflict: pause writes and invoke rollback evaluation. | Migration owner | 2026-08-19 |
| `RISK-018` | Production feature enables before certification. | Misconfigured defaults, client-only flag, deployment coupling, or operator error. | Unproven recovery/security paths exposed globally. | Medium | Critical | Mitigated (pending proof) | Server/client default-off flags, separate enablement authority, kill switch, release evidence gate, configuration audit. | Startup/config telemetry and synthetic endpoint availability check. | Any early exposure or new-path production write: kill switch immediately and fail release. | Release owner; Security | 2026-08-19 |
| `RISK-019` | Staging/test records leak into green. | Promoting staging, migrating wrong source, missing source classification, or contaminated seed. | Client-visible bogus data, privacy/test artifact exposure, and invalid analytics. | Medium | Critical | Mitigated (pending proof) | Never promote staging; clean `_next`; source-app allowlist; test-data classifier; zero-record integrity gate. | Green scan for staging/synthetic/malformed/Playwright/load/debug provenance. | Any staging-classified record in green: block/abort cutover and rebuild or clean with audited reconciliation. | Migration owner; QA | 2026-08-19 |
| `RISK-020` | Recovery codes are brute-forced. | Public endpoint, inadequate entropy, weak normalization/hash, absent throttling, or leaked hints. | Unauthorized exact-draft access. | Medium | Critical | Mitigated (pending proof) | Version 1 format provides 99.0839 bits of capacity with an ambiguity-safe alphabet and unbiased byte encoding; later controls must add backend secure generation, keyed hash, no raw storage/logs, rate limits/delay/lockout/CAPTCHA. | Contract-drift/entropy/logging scans now; later attempt-rate, lockout, code-match anomaly, and raw-secret monitoring. | Any code guessed outside authorized test or abuse-control bypass: disable code recovery, rotate affected codes, investigate. | Security | 2026-08-19 |
| `RISK-021` | Public responses permit email enumeration. | Different body/status/timing for existing, absent, ineligible, or locked email. | Attackers learn client participation and target answer access. | High | High | Mitigated (pending proof) | Generic response/schema/status, delay buckets, keyed logging, timing test, CAPTCHA/lockout. | Controlled content/timing corpus and rate anomaly monitoring. | Deterministic enumeration oracle or cross-client access: disable email recovery and fail release. | Security | 2026-08-19 |
| `RISK-022` | Admin password is brute-forced. | Public/shared password endpoint with weak or bypassable attempt controls. | Persistent privileged grant issuance and sensitive access. | Medium | Critical | Mitigated in source; staging/operations proof pending | Backend verifier, per-network/device rate limit, bounded delay/jitter, lockout, generic errors, safe audit, secret management. | Failed-attempt/lockout alerts and boundary tests. | Successful unauthorized issuance or control bypass: disable admin endpoint, rotate password/secret/version, investigate. | Security; Support owner | 2026-08-19 |
| `RISK-023` | PDF is regenerated from the wrong draft. | Selecting newest email draft instead of submitted snapshot or stale identity binding. | Client receives incorrect or cross-client questionnaire content. | Medium | Critical | Mitigated (pending proof) | Bind PDF to submitted draft/final ID and immutable PDF snapshot; multi-draft hash tests; scoped access. | PDF model hash/identity comparison and cross-draft synthetic. | Any wrong-draft or cross-client PDF: disable PDF recovery, fail release, and investigate affected downloads. | Application owner | 2026-08-19 |
| `RISK-024` | Existing Zapier/intake path breaks. | Submission refactor changes payload, fallback, deduplication, retry, or repair behavior. | Final submissions are lost, duplicated, delayed, or malformed downstream. | Medium | Critical | Mitigated (pending proof) | Immutable pre-submit snapshot, existing regression suites, primary/fallback fault injection, idempotency, observability. | Zapier/intake success/failure/retry metrics and end-to-end test records. | Submission failure at/above `5%` for five minutes, any acknowledged loss, or duplicate final: kill switch and rollback evaluation. | Application owner; Integration owner | 2026-08-19 |
| `RISK-025` | Retention cleanup deletes records needed for support, migration, rollback, or audit. | Wrong server-time anchor, missing hold, relationship-blind cleanup, or premature migration-metadata expiry. | Irrecoverable evidence/data loss and inability to support clients or reverse cutover. | Medium | Critical | Mitigated (pending proof) | One-year policy, server-time anchors, dry-run first, support/legal/migration holds, relationship checks, rollback-window preservation. | Dry-run diff, hold audit, referential-integrity scan, and deletion reconciliation. | Any protected/recent/held record selected or deleted: stop cleanup, preserve evidence, restore if possible, and declare data incident. | Data owner; Support owner | 2026-08-19 |
| `RISK-026` | A reused browser exposes or writes another client's questionnaire state. | One global Redux key and one global session key are reused without client namespace. | Cross-client disclosure and misattributed draft/submission data. | High | Critical | Mitigated (pending proof) | Safe client namespace, identity mismatch quarantine, scoped server authorization, and shared-browser adversarial tests. | Local namespace audit, cross-client browser synthetics, and server identity mismatch alerts. | Any cross-client display/write: disable new recovery/persistence path, preserve evidence, and investigate affected sessions. | Application owner; Security | 2026-08-19 |
| `RISK-027` | Acknowledged server drafts and local backups cannot be restored by the public questionnaire. | Public bootstrap never hydrates `ProFormDraft`; backup keys have no reader. | Clients lose self-service recovery after browser-state loss, device change, or cache clear. | High | Critical | Mitigated (pending proof) | Authorized backend recovery, deterministic source reconciliation, validated local journal consumption, and browser/device tests. | Recovery source telemetry and same/cross-browser recovery synthetics. | Any acknowledged draft unavailable in a certified recovery case: block enablement or activate kill switch. | Application owner; Support owner | 2026-08-19 |
| `RISK-028` | Direct browser draft/entity access is governed by an uncertified cloud policy boundary. | Public/admin clients call entity CRUD directly and repository schemas do not declare draft RLS. | A cloud policy mistake could expose or modify sensitive drafts outside the intended scope. | Medium | Critical | Mitigated (pending proof) | Replace with scoped backend functions, deny direct CRUD, minimize fields, rate limit, audit, and certify cloud RLS/FLS adversarially. | Direct-operation matrix, network/entity audit, and authorization-denial telemetry. | Any unauthorized read/write or direct-CRUD allowance beyond the approved scope: fail release and disable access. | Security; Application owner | 2026-08-19 |
| `RISK-029` | Non-atomic or cancelled draft saves preserve incomplete, stale, or duplicate state. | Client filter/create/update, render-bound timers, stale closure maps, and bypassing mutation handlers lack revisions/transactions. | Lost answers, hidden child retention, duplicates, stale overwrite, and unreliable recovery. | High | Critical | Mitigated (pending proof) | Atomic idempotent backend save, canonical post-reducer revision, durable outbox, centralized mutations, and concurrency/lifecycle tests. | Revision/conflict metrics, mutation equivalence suite, pending-age telemetry, and duplicate scan. | Any acknowledged mutation loss, stale overwrite, or duplicate logical draft: stop writes and invoke rollback evaluation. | Application owner | 2026-08-19 |
| `RISK-030` | The deployed submission fallback differs from or omits the repository implementation. | The local nested function resource was absent from the earlier read-only remote function list. | Primary submission failure may not produce the expected durable final/intake receipt. | Medium | Critical | Mitigated (pending proof) | Compare authorized remote manifest/source, deploy only to staging, invoke fault-injected fallback, and certify idempotent receipt behavior. | Function inventory drift check, fallback invocation health, and intake/final receipt telemetry. | Missing/unhealthy fallback or acknowledged submission loss: block release and retain the existing safe path. | Application owner; Integration owner | 2026-08-19 |
| `RISK-031` | Save UI overstates durability and storage security. | Autosave copy claims a secure cookie and server save failures can be swallowed. | Clients close the browser or stop remediation believing work is durably acknowledged. | High | High | Mitigated (pending proof) | State-derived local/pending/server/offline wording, no secure claim before acknowledgement, and UI/network fault tests. | Copy audit, acknowledgement-state tests, pending duration, and client support reports. | Any false server-confirmed message in certified flow: block enablement or activate kill switch. | Product owner; Application owner | 2026-08-19 |
| `RISK-032` | A staging or test submission reaches the production Zapier workflow. | Hardcoded/fallback destination, environment/mode mismatch, missing staging redirect, request-body override, or caller bypass. | Real client automation receives synthetic or sensitive test data; downstream production actions may execute. | High | Critical | Mitigated (pending deployment proof) | One backend policy; exact environment/mode pairs; server-only destinations; disabled default; no staging-to-production fallback; bounded HTTPS delivery; truthful suppression/redirect results; all retry/repair callers use the policy. | Zero-fetch disabled/test/unknown tests, fake-adapter production/staging tests, repository URL scan, safe response/log scan, and future staging egress evidence. | Any staging/test request to a production destination: disable external side effects, revoke/rotate the destination, stop staging traffic, inventory downstream actions, and fail release. | Integration owner; Security; Release owner | 2026-08-19 |

## Current audit evidence overlay

### 2026-08-05 local bootstrap/load control update

The local functions now mitigate source-level portions of `RISK-001`,
`RISK-004`, `RISK-005`, `RISK-006`, `RISK-020`, `RISK-021`, `RISK-026`,
`RISK-027`, `RISK-028`, and `RISK-029`: bootstrap never searches unsigned
email; codes/tokens are hashed and returned once; replay is keyed-idempotent;
load is exact-token/draft/scope bound; changed signed email is isolated;
submitted and terminal statuses fail closed; and legacy reads do not overwrite
records. The V2 flag and kill switch remain fail closed.

Risk ratings are not lowered. The functions were not deployed, Base44
service-role/FLS behavior and create concurrency are not live-certified, the
normal suite retains its pre-existing failures, and public email/code recovery,
abuse controls, save/submit endpoints, migration, and frontend cutover remain
outside this prompt.

The register's likelihood/severity columns describe the risk before planned controls. The overlay below records the **current** evidence assessment as of 2026-08-06. “Path absent” means a planned feature risk is not currently active; its accepted/mitigated treatment above remains unchanged for the future release. The identity contract is now integrated through canonical state, Redux, browser namespace/cache, and bootstrap, while the recovery-code/selection contract remains a pure contract. Public recovery, backend authorization, secure generation, keyed lookup hashing, schemas, UI, and deployment remain absent.

| Risk ID | Current likelihood | Current severity | Current audit evidence/classification |
| --- | --- | --- | --- |
| `RISK-001` | Low (path absent) | Critical | The identity contract preserves `unverified`, and the pure selection helper never reads email fields or treats association as authorization. The accepted privacy risk remains unchanged because no authorized lookup, public recovery path, generic response, or backend abuse control was implemented. |
| `RISK-002` | Medium | Critical | Current password grant flow exists; future indefinite-grant acceptance remains unchanged. See [admin audit](../audit/current-system-audit-report.md#admin-recovery-summary). |
| `RISK-003` | Medium | High | Confirmed storage exceptions can fail module import. [DRAFT-001](../audit/current-defect-register.md#draft-001--unsafe-module-evaluation-storage-access). |
| `RISK-004` | High | High | Continuous canonical browser capture and deterministic same-browser rehydration are implemented/tested locally, but no server acknowledgement, durable outbox, reconnect proof, or deployed storage matrix exists. The latest release gate blocked staging. [DRAFT-005](../audit/current-defect-register.md#draft-005--local-backups-are-write-only), [DRAFT-006](../audit/current-defect-register.md#draft-006--lifecycle-persistence-relies-only-on-beforeunload). |
| `RISK-005` | High | Critical | The revision/idempotency primitive and a guarded `updateMany` save writer are locally integrated. Mocked two-writer, zero/multiple-count, and post-read tests pass, with no unguarded fallback. Risk remains high because the function is not deployed, current frontend writers are unchanged, and live Base44 atomicity is uncertified. [Save/event flow](../backend/save-and-event-api-flow.md); [DRAFT-015](../audit/current-defect-register.md#draft-015--draft-upsert-and-mutation-ordering-are-non-atomic). |
| `RISK-006` | Medium | Critical | Submitted-regression protection, immutable submission identity fields, read-only submitted grants, and delayed-active rejection are integrated in the local writer tests. Risk is not reduced because the function is not deployed, frontend writers are unchanged, and live terminal behavior is uncertified. [Save/event flow](../backend/save-and-event-api-flow.md); [DRAFT-016](../audit/current-defect-register.md#draft-016--delayed-draft-writes-can-regress-submitted-state). |
| `RISK-007` | High | Critical | Clear All retains old identity/draft; delayed-save protection absent. `BC-CLEAR-001/002`; [DRAFT-010](../audit/current-defect-register.md#draft-010--clear-all-races-browser-persistence-and-leaves-the-old-server-draft-active). |
| `RISK-008` | Low (path absent) | Critical | Future staging SES risk; current audit found no active email path and performed no email operation. |
| `RISK-009` | Medium (unverified) | High | Future SES readiness risk; no production SES inventory was authorized or performed. |
| `RISK-010` | Medium (migration absent) | Critical | The runtime-neutral normalization contract can be reused later, but no migration adapter, keyed lookup-hash backfill, utility, or production-data movement exists. |
| `RISK-011` | Medium (migration absent) | Critical | Future checkpoint/delta risk; dependency remains before cutover. |
| `RISK-012` | Medium | High | Current file descriptors/ownership need explicit inventory; raw in-flight state is not recoverable. [DRAFT-018](../audit/current-defect-register.md#draft-018--rawin-flight-file-selection-cannot-be-restored). |
| `RISK-013` | Medium (cutover absent) | High | Future domain-transfer risk; no domain operation was performed. |
| `RISK-014` | Medium (cutover absent) | Critical | Future TLS risk; no custom-domain operation was performed. |
| `RISK-015` | Medium (green absent) | Critical | Future clean-green risk; current system verdict is not production-reliable. |
| `RISK-016` | Medium (reverse path absent) | Critical | Reverse migration is unimplemented and remains a hard pre-cutover dependency. |
| `RISK-017` | High (cutover absent) | Critical | Future late-write risk; current clients have no revision/write-freeze guard. |
| `RISK-018` | Low (default-off controls implemented) | Critical | Frontend/backend flags and kill switches remain fail closed. The only new staging deployment is an environment-gated, diagnostics-gated, Base44-admin-only self-check; durable draft V2 and public recovery remain disabled. No production function or secret was added. |
| `RISK-019` | Medium (green absent) | Critical | The pure selector rejects explicit environment mismatches and staging/test markers during production selection, but clean-green migration, data classification, and deployed isolation remain unimplemented and uncertified. |
| `RISK-020` | Medium (public path absent) | Critical | Secure recovery-code generation and keyed hashing are certified with independent staging secrets and value-free responses. Public verification, storage, rate limits, delay, lockout, CAPTCHA, and monitoring remain absent, so the release risk is not downgraded. |
| `RISK-021` | Low (public path absent) | High | Keyed normalized-email hashing is certified with a staging-only secret and no raw email response. Authorized association lookup, uniform public recovery response/timing, rate limit, CAPTCHA, and lockout remain absent. |
| `RISK-022` | Medium | Critical | The persistent admin-grant sign/verify primitive and exact Base44-admin diagnostic gate are certified in staging. The existing password flow is unchanged; brute-force controls, migration, device persistence, and fleet revocation operations remain absent. |
| `RISK-023` | Medium | Critical | Selection tests prove the newest submitted record wins over an older active record, but current submitted PDF source remains in-memory and not identity-addressable after reload. Selection does not replace submitted-snapshot binding. [Audit report](../audit/current-system-audit-report.md#submission-and-pdf-behavior). |
| `RISK-024` | Medium | Critical | Submission callers retain legacy-success compatibility and now distinguish delivered/redirected/suppressed/failed outcomes; remote fallback and end-to-end staging equivalence remain unverified. [Audit report](../audit/current-system-audit-report.md#unconfirmed-and-partially-confirmed-risks). |
| `RISK-025` | Medium (source controls implemented; live proof absent) | Critical | Local one-year policy, holds, server-time cutoff, dry-run report, report-bound manual apply, event-first deletion, re-evaluation, and checkpoint controls exist. No live dry run, backup restore, RLS/filter proof, alert, secret, deploy, or cleanup has occurred. |
| `RISK-026` | Medium (local control implemented) | Critical | Version 5 adds trusted-invitation/authorized-draft precedence, untrusted URL downgrade, changed-email namespace separation, cache identity mismatch rejection, and session-stable anonymous isolation. Unit/integration evidence plus the Chromium/Firefox/WebKit synthetic identity matrix is local only; deployed isolation and server authorization remain uncertified. [DRAFT-017](../audit/current-defect-register.md#draft-017--shared-browser-state-can-leak-across-clients). |
| `RISK-027` | High | Critical | The new canonical cache supplies tested same-browser reload continuity, but the older failure-backup record and acknowledged server drafts still lack authorized public recovery. Cross-device/server restore and the deployed migration matrix remain absent. [DRAFT-004](../audit/current-defect-register.md#draft-004--server-drafts-are-never-restored-into-the-public-form), [DRAFT-005](../audit/current-defect-register.md#draft-005--local-backups-are-write-only). |
| `RISK-028` | Medium (policy unverified) | Critical | Seven direct calls and absent repository RLS declarations confirmed; exploitability not claimed. [DRAFT-014](../audit/current-defect-register.md#draft-014--draft-data-crosses-a-direct-browser-entity-boundary). |
| `RISK-029` | High | Critical | Post-reducer local capture now covers canonical mutations and hidden-child cleanup locally, but the current Base44 save timer remains render-coupled/non-atomic and the normal suite still exposes geography/normalization defects. No deployed mutation, reset, or save-compatibility matrix ran. [DRAFT-019](../audit/current-defect-register.md#draft-019--state-driven-effect-cleanup-can-cancel-the-queued-server-save). |
| `RISK-030` | Medium (remote health unverified) | Critical | Top-level Base44 entrypoints are canonical and compatibility files cannot diverge by static test; the fallback remains absent from both read-only remote lists and requires authorized staging deployment verification. |
| `RISK-031` | High | High | Browser/page-only wording is implemented/tested locally, but no deployed UI/network matrix or server-confirmed state exists; best-effort server-save paths remain. [DRAFT-013](../audit/current-defect-register.md#draft-013--autosave-wording-inaccurately-claims-secure-cookie-persistence). |
| `RISK-032` | Low in source; unverified after deploy | Critical | Hardcoded production destination removed; policy/fake-adapter suite proves fail-closed selection and zero-fetch disabled/test/unknown paths. No real webhook or staging deployment was exercised. |

### 2026-08-05 entity-extension staging attempt

The [staging entity schema certification](../data/staging-entity-schema-certification.md) is **ENTITY_EXTENSIONS_BLOCKED**. Candidate `9ca8e6478facd6d5cfa1e2f51986ba12fc1a26d1` passed the 18/18 focused schema suite but failed 5 of 780 normal tests. The stop preserved the current risk posture: no staging schema push, type generation, CRUD, FLS test, questionnaire smoke, cleanup operation, production access, or feature-branch push occurred.

`RISK-028` remains policy-unverified because actual public-versus-service-role FLS behavior was not tested. `RISK-029` remains high because the failing normal suite still covers geography and normalization behavior, alongside Q24 and recoverable-backup regressions. No risk is downgraded or accepted by this attempt.

### 2026-08-05 staging security-primitives certification

The [staging security-primitives certification](../security/staging-security-primitives-certification.md) is **SECURITY_PRIMITIVES_CERTIFIED_IN_STAGING**. Six independently generated purpose secrets and two ordinary diagnostic controls are configured only in staging. The only deployed staging function is a POST/JSON/16-KB, environment-gated, diagnostics-gated, Base44-admin-only in-memory self-check. The authenticated live response passed all 17 checks and exact-schema/sensitive-pattern validation.

This evidence reduces uncertainty about the primitive implementations for `RISK-005`, `RISK-006`, `RISK-018`, `RISK-020`, `RISK-021`, and `RISK-022`; it does not lower their release likelihood/severity ratings. No save/bootstrap/public-recovery/admin-migration API exists, and rate limits, CAPTCHA, email, entity authorization, migration, and full application certification remain absent. The full normal suite still has five unrelated failures, so application readiness remains blocked.

### 2026-08-05 authoritative save/event source integration

The guarded save and bounded event functions are implemented and locally
tested, but were not deployed. Local mocked evidence covers exact-draft
authorization, canonical hashing/projection, conditional updated-count and
post-read invariants, terminal submission, two concurrent writers, event
deduplication, and snapshot survival after event failure. It does not prove
live Base44 `updateMany` atomicity, post-read consistency, event-ID uniqueness,
service-role/FLS behavior, or deployed response/log confidentiality. Those are
release blockers, so `RISK-005` and `RISK-006` retain their prior ratings. No
schema, flag, frontend, production, email, domain, or deployment state changed.

### 2026-08-05 authoritative API certification attempt

The [authoritative API certification](../backend/staging-authoritative-draft-api-certification.md)
is **AUTHORITATIVE_DRAFT_APIS_BLOCKED**. A detached, fail-closed frontend client
contract passed its focused tests, but the full normal suite failed five
existing questionnaire/submission-repair assertions and stopped the attempt
before staging work. No live authorization, idempotency, submitted-lock,
stored-record confidentiality, event deduplication, or Base44 conditional
update proof was collected. `RISK-005`, `RISK-006`, `RISK-028`, `RISK-029`, and
`RISK-030` retain their existing ratings; no risk is downgraded or accepted.

No staging schema, secret, runtime flag, function, data, cleanup, or site state
changed. Production and `main` were untouched, and the feature branch was not
pushed.

### 2026-08-05 public recovery abuse-control source foundation

The [public recovery abuse-control contract](../security/public-recovery-abuse-control-contract.md)
now has local source and focused-test evidence for separate abuse hashing,
admin-only security events, IP/subject/global limits, conditional CAPTCHA,
temporary lockout, generic enumeration-resistant failures, random device
correlation, and server-side Turnstile verification. This reduces design
uncertainty for `RISK-020`, `RISK-021`, `RISK-026`, and the knowingly accepted
`RISK-001`, but does not lower likelihood or severity.

Residual blockers remain: Base44 trusted-proxy semantics, live RLS/FLS and
service-role event persistence, atomic/cross-instance limit behavior, CAPTCHA
credentials/hostname, retention/cleanup, monitoring/alerts, public endpoint
authorization, the 10k abuse corpus, and deployment certification. No secret
was configured, no schema/function was pushed, and public email/code recovery
remains disabled and absent. Production and `main` were untouched.

### 2026-08-05 recovery-code service source implementation

The [recovery-code service flow](../backend/recovery-code-service-flow.md) now
has local source and mocked-test evidence for backend-only keyed code matching,
pre-lookup abuse controls, conditional CAPTCHA, lockout, duplicate selection,
terminal-status denial, minimal success projection, recovery-session scoping,
load-token handoff, safe event persistence, and fail-closed success auditing.
This reduces implementation uncertainty for `RISK-020`, `RISK-021`,
`RISK-026`, `RISK-028`, and `RISK-030`; it does not lower their likelihood or
severity and does not change the accepted email-only risk.

Residual blockers include live Base44 function bundling, service-role RLS/FLS,
cross-instance/atomic rate limiting, CAPTCHA/provider and trusted-proxy proof,
duplicate/unknown-status alert delivery, retention behavior, 10k abuse and
timing corpora, deployed token/load integration, monitoring, and release review.
No public flag, UI, schema, function, secret, staging data, production resource,
or Git remote changed.

### 2026-08-06 email recovery and associated-choice source implementation

The [email recovery and draft-choice flow](../backend/email-recovery-and-draft-choice-flow.md)
adds local source and mocked-test evidence for exact normalized-email lookup,
newest server-created eligible selection, email-only `draft:list-associated`
authorization, safe bounded choice listing, exact-draft reselection, submitted
read-only behavior, token/load handoff, generic failures, timing controls, and
fail-closed success-event persistence. Raw email is excluded from tokens,
diagnostics, logs, events, and responses, but ownership is deliberately not
verified and no message is sent.

`RISK-001` therefore remains explicitly accepted at High likelihood and
Critical severity. Abuse controls and hash/scope binding reduce enumeration and
cross-scope implementation risk; they do not prove mailbox ownership. Any
confirmed cross-email/hash bypass still requires immediate public-email-
recovery disablement and a failed release. Live service-role/FLS, distributed
limits, trusted-proxy, CAPTCHA, monitoring, 10k corpus, and deployment evidence
remain blockers. No schema, function, secret, flag, staging/production data,
email/SES, domain, or Git remote changed.

### 2026-08-06 client recovery entry source implementation

The [opening recovery modal contract](../frontend/opening-recovery-modal-contract.md)
adds local component and five-browser evidence for explicit new/email/code
choice, the changed-signed-email boundary, anonymous recovery-risk
acknowledgement, one-time recovery-code presentation/copy, submitted read-only
entry, conditional CAPTCHA, retry timing, generic failures, and an always-
present bootstrap gate. Recovery and CAPTCHA tokens remain transient and are
excluded from Redux, canonical draft state, URLs, diagnostics, and modal
summaries.

This reduces implementation uncertainty around accidental implicit recovery,
credential leakage, and interactive entry before bootstrap. It does not lower
any risk rating. `RISK-001` remains knowingly accepted at its existing rating:
the opening disclosure makes clear that exact-email recovery does not prove
mailbox ownership. Live CAPTCHA hostname/secret/provider behavior, distributed
rate limits, deployed accessibility and storage-failure behavior, authoritative
V2 autosave, staging APIs, and production-disabled evidence remain release
gates. No Base44 resource, email/SES path, domain, production flag, or remote
Git reference changed.

## Knowingly accepted risks

### RISK-001: Public email-only recovery

Isaac Hines knowingly accepts that anyone who knows an exact client email and passes abuse controls may retrieve the newest eligible questionnaire in the initial release. The email may remain `unverified`; rate limits, CAPTCHA, lockout, generic errors, and audit reduce abuse but do not prove address ownership. This acceptance does not permit any cross-email, cross-code, or cross-client implementation defect.

### RISK-002: Indefinite browser-persisted admin grant

Isaac Hines knowingly accepts the residual theft/replay risk of a password-issued signed browser grant with no fixed expiration. Scope, environment/version checks, binding where practical, secret rotation, version increment, Forget This Device, storage clearing, and audit reduce risk but do not turn the shared-password flow into individual identity. A later individually authenticated admin model remains the required migration path.

## Current scope statement

This register distinguishes primitive environment evidence from workflow/release certification. This batch configured staging-only secrets and deployed one non-public administrative self-check to the staging app. It changed no entity/schema, production Base44 resource, production secret, production data, SES setting, email delivery, domain, public recovery endpoint, or release flag. Durable draft V2 remains disabled.

## 2026-08-06 public recovery staging certification attempt

The [public recovery services certification](../security/staging-public-recovery-services-certification.md)
is **PUBLIC_RECOVERY_SERVICES_BLOCKED**. Although the focused recovery and
entity-schema suites passed, five normal-suite failures stopped the attempt
before any staging operation. Live service-role/RLS behavior, distributed
limits, trusted network headers, CAPTCHA escalation, lockout, timing, generic
failure equivalence, event confidentiality, choice authorization, newest-
created selection, cleanup, and deployed frontend isolation remain unproved.

No risk is downgraded, closed, or newly accepted. In particular, `RISK-001`
remains explicitly accepted at its existing rating: email-only recovery is
unverified and does not establish mailbox ownership. No secret, flag, schema,
function, record, email, SES, Zapier, domain, staging site, production
resource, or remote Git branch changed in this attempt.

## 2026-08-06 SES transport and template source foundation

The [SES transport and template contract](../email/amazon-ses-transport-and-template-contract.md)
adds local, injected-test evidence for the `RISK-008` staging-recipient rewrite,
`[STAGING]` subject prefix, fixed sender, mode/environment mismatch denial,
bounded timeout, header/HTML injection rejection, safe provider result, no-code-
in-link template, and frontend credential separation. Four optional protected
delivery fields add idempotency/purpose/provider/request diagnostics without
raw recipient, body, code, or AWS credential storage.

No risk rating changes. `RISK-008` still requires live 100-message routing and
event inspection. `RISK-009` remains fully blocking because sender/domain
verification, region, SES sandbox/production status, quotas, least-privilege
IAM, bounce/complaint handling, configuration-set routing, and AWS ownership
are unknown. Email-only recovery remains unverified; future OTP/magic-link
templates do not mitigate `RISK-001` and are not enabled. No AWS/Base44 secret,
schema push, function deployment, email, record, production operation, or Git
remote changed.

## 2026-08-06 authorized recovery-email delivery source

The [delivery flow](../email/recovery-code-email-delivery-flow.md) adds local
evidence for exact-draft write authorization, code-HMAC verification, strict
purpose and replacement/submission relationships, stored-recipient use,
purpose-keyed idempotency, compare-and-set attempt claims, bounded retry,
maximum attempts, safe delivery metadata/events, and ambiguous-send denial of
blind retry. The client helper has no storage, Redux, automatic retry, or
general-send UI surface.

No risk rating changes. This reduces source-design uncertainty for `RISK-008`
and duplicate-send behavior, but live Base44 conditional-update semantics,
entity FLS, SES redirection, 100-message routing, sender/IAM/account readiness,
bounce/complaint handling, and controller integration remain unproved.
`RISK-009` remains blocking. No function/schema was deployed, no secret or
record changed, no email/SES call occurred, and no Git remote changed.

## 2026-08-06 disabled OTP and magic-link framework source

The [future verification framework](../email/future-otp-and-magic-link-framework.md)
reduces source-design uncertainty around later mailbox verification: separate
secrets/domain separators, unbiased OTP generation, bounded attempts/expiry,
256-bit magic tokens, HMAC-only records, one-time consumption, exact redirect
allowlisting, and exact-draft verified recovery-session claims are covered by
synthetic tests. The initial email association remains unverified until a
future successful consumption; the same lookup hash avoids destructive draft
migration.

No risk rating changes and `RISK-001` remains knowingly accepted for the
initial unverified email-recovery release. Future activation introduces or
reactivates enumeration, mailbox compromise, OTP guessing, link forwarding,
email-security scanner consumption, referrer/history/log leakage, redirect,
replay/race, delivery, secret-rotation, and account-recovery risks. Those need
separate threat/privacy review and live staging evidence. Both flags remain
false; no schema/secret/function was pushed or configured, no email/value was
sent, no UI/route was added, and no Git remote changed.

## 2026-08-06 staging SES certification attempt

The [staging SES recovery-email report](../email/staging-ses-recovery-email-certification.md)
is **SES_RECOVERY_EMAIL_BLOCKED**. Focused source gates passed, but five normal
suite failures activated the pre-deployment hard stop. SES region/account
status, verified sender, quota, bounce/complaint routing, dedicated
least-privilege staging IAM, and internal redirect ownership therefore remain
unknown and unconfigured.

No risk rating changes. `RISK-008` remains without live redirect/inbox proof
and `RISK-009` remains blocking. No AWS/Base44 configuration, schema, function,
record, email, inbox, provider, production, domain, or remote Git operation ran.

## 2026-08-06 client credential vault and bootstrap source evidence

The source-only credential vault and bootstrap coordinator reduce design and
local-test uncertainty for `RISK-003`, `RISK-006`, `RISK-018`, `RISK-026`, and
`RISK-027`. IndexedDB/localStorage/page-memory fallback is truthful; malformed
credentials do not replace canonical cache; submitted server state wins;
changed signed email cannot search a replacement association; exact credentials
never enter Redux or canonical state. Possession of a browser-stored token is
still authorization, and browser storage is not encryption. XSS, same-origin
script compromise, shared-profile access, extension access, and page-lifetime
loss remain material risks.

No rating is lowered and no risk is closed. The visual choice/modal gate,
ongoing autosave ordering, deployed browser matrix, staging API operation, and
production-disabled evidence remain pending. No flag, schema, Base44 resource,
deployment, production system, or Git remote was changed.

## 2026-08-06 public recovery page and panel source evidence

The [public recovery page and panel contract](../frontend/public-recovery-page-and-panel-contract.md)
reduces local UI uncertainty for `RISK-001`, `RISK-003`, `RISK-006`, and
`RISK-018`: email recovery remains visibly unverified, code recovery cannot
enumerate other drafts, choice fields are allowlisted, email is masked, full
code display depends on the credential vault, and server-saved wording requires
an acknowledged revision and timestamp. The panel is outside the header and
the footer omits the full code.

No risk is closed or lowered. Exact-email knowledge remains an accepted
authorization risk; XSS/shared-browser/extension access to visible or stored
credentials remains material; and deployed DOM, analytics, accessibility,
CAPTCHA, API-scope, and browser evidence remain pending. This is source and
synthetic local-browser work only. No autosave migration, email, Base44 cloud
change, deployment, production action, or remote Git operation occurred.

## 2026-08-06 client recovery staging certification failure

The [client recovery staging report](../frontend/staging-recovery-entry-certification.md)
is **CLIENT_RECOVERY_ENTRY_FAILED**. Focused source tests passed 394/394, but
five full-suite questionnaire/repair assertions failed and activated the
pre-deployment hard stop. No deployed evidence was collected for the accepted
unverified-email risk, browser credential exposure, cross-draft authorization,
storage fallback, panel DOM/log exclusion, CAPTCHA, or accessibility behavior.

No risk is closed or lowered. The staging app, feature flags, entities,
functions, secrets, records, SES, Zapier, domain, and production app were not
operated on. No synthetic records were created, so no cleanup mutation was
needed. No branch was pushed.

## 2026-08-06 Clear All and Start New transaction source evidence

The [transaction contract](../backend/clear-all-and-start-new-transaction-contract.md) reduces source-design uncertainty for `RISK-005`, `RISK-006`, `RISK-007`, `RISK-008`, and `RISK-029`. The implementation uses exact-draft scopes, expected revisions, purpose-keyed idempotency, pending/committed markers, no-delete retention, submitted-record immutability, stale-save-invalidating supersession, committed-only replacement email selection, one-time hashed credentials, and non-rollback email failures. Synthetic fault tests prove retry reuse rather than duplicate creation.

No rating is lowered or risk closed. Live Base44 create/CAS/FLS behavior, multi-instance races, SES routing, operational pending repair, browser integration, and staging certification remain unproved. No schema/function was pushed, no cloud record or secret changed, no email was sent, no production/domain operation occurred, and no Git branch was pushed.
## 2026-08-06 authoritative submission and PDF evidence

Local controls now require an acknowledged `submit_attempted` state before an external call, preserve immutable submitted snapshots, reject delayed saves after terminal lock, and bind PDF generation to the recovered draft ID and canonical hash. External-success/final-lock failure is represented as a submitted read-only partial success and never automatically repeats the external call. These controls reduce source-level uncertainty for `RISK-024` and submitted-record mutation risks, but ratings remain pending live staging proof and full release gates. No deployment occurred.

## 2026-08-06 full lifecycle staging hard stop

The [full lifecycle attempt](../testing/staging-full-draft-lifecycle-certification.md)
stopped on two repair-helper failures before deployment. No risk is closed or
lowered. Live transaction atomicity, submitted-lock enforcement, SES redirect,
PDF linkage, browser variance, RLS/FLS, duplicate prevention, and cleanup remain
unproved. The source failure itself is release-blocking because payload repair
must be deterministic before any staging submission can be certified.

No Base44 resource, secret, record, email, PDF, integration, domain, production
system, or remote Git branch was changed.

## 2026-08-06 password-only admin recovery staging hard stop

The [staging admin recovery attempt](../admin/staging-password-only-admin-recovery-certification.md)
failed at the normal suite after 75/75 focused admin tests and the static
backend-only boundary passed. Six normal-suite failures prevent any risk from
being closed or lowered. Persistent-grant exposure, shared-password
attribution, revocation correctness, lockout behavior, network grant leakage,
service-role audit integrity, RLS, side-effect isolation, and cleanup all remain
live-evidence gaps.

No staging secret, function, site, record, integration, domain, production
resource, or remote Git branch was changed.

## 2026-08-06 restrictive draft RLS staging hard stop

The [staging RLS attempt](../security/staging-draft-rls-certification.md) is
**DRAFT_RLS_BLOCKED**. The deployment precheck rejected three missing staging
certifications and the production-linked primary checkout before any app-
scoped operation. Direct anonymous/non-admin denial, authorized service-role
success, network isolation, cleanup, and production-comparison evidence remain
absent.

No RLS or direct-access risk is closed or lowered. No schema, entity, record,
secret, function, site, email, integration, domain, production resource, or
remote Git branch changed.

## 2026-08-06 legacy migration analysis risk evidence

The offline version 1 analyzer reduces source-design uncertainty for legacy
JSON corruption, response preservation, duplicate sessions, submitted/active
partitioning, recovery-association provenance, event linkage, and report data
leakage. Critical corruption, future versions, ambiguous hashes, unmapped
payload answers, and invalid existing recovery associations fail closed to
manual review.

No migration or retention risk is closed or lowered without real-data dry-run,
execution idempotency, checkpoint, secret-backed email hashing, staging
rehearsal, cleanup, and reverse-migration proof. No Base44 or Git remote
operation occurred.

## 2026-08-06 resumable migration execution risk evidence

The local checkpoint/repository/apply-token implementation reduces design
uncertainty for interrupted batches, stale dry-run records, repeat apply,
cross-environment authorization, duplicate deletion, and unsafe rollback.
Exact report/record fingerprints, anchored cursors, maximum counts, dual admin
and migration scopes, no-delete APIs, submitted guards, and manual-review
outcomes fail closed.

`RISK-010`, `RISK-011`, `RISK-016`, `RISK-019`, and `RISK-025` remain open at
their existing release classification. The apply secret is not configured;
there is no staging RLS proof, real-data dry run, retention/cleanup, reverse
migration, or production rollback rehearsal. No Base44 or Git remote operation
occurred.

## 2026-08-06 one-year retention source evidence

The local retention policy reduces source-design uncertainty for `RISK-025`
with a minimum 365-day server-time window, required hold reasons, recent
support/replacement/migration exclusions, submitted locks, environment and
test isolation, bounded dry run, safe IDs/fingerprints, two-hour report-bound
manual authorization, per-record event-first deletion, re-evaluation, and
resumable checkpoints. A false schedule environment flag still cannot enable
unattended apply.

`RISK-025` remains open at Medium/Critical because no real record was analyzed
or deleted and live Base44 filters, RLS, backup restore, alerts, report review,
and failure reconciliation are unproved. No secret, schema, function,
automation, record, production resource, or remote branch changed.

## 2026-08-06 combined migration/retention staging hard stop

The combined staging attempt failed at the full source suite after all focused
migration/retention/security gates passed. `RISK-010`, `RISK-011`, `RISK-016`,
`RISK-019`, and `RISK-025` remain open at their existing ratings because no
live checkpoint, apply/resume, duplicate, rollback, retention, RLS, or cleanup
evidence was gathered. The hard stop prevented all Base44 and production
operations, so no risk is lowered or closed.

## 2026-08-06 bidirectional migration identity source evidence

The machine-readable entity policy, origin/source split, logical time helpers,
ID map, conflict row and content-hash projection reduce design uncertainty for
destination-ID changes, import-time ordering, duplicate appends, relationship
remapping, staging/test contamination, and content-bearing diagnostics.

`RISK-010`, `RISK-011`, `RISK-016`, `RISK-019`, and `RISK-025` remain open at
their existing ratings. No protected export/import runner, encrypted bundle,
single-direction lease, real file transfer, checkpoint execution, conflict
resolution, production inventory, staging rehearsal, reverse synchronization,
or late-write reconciliation has been exercised. No cloud or production action
occurred.

## 2026-08-06 cross-app migration utility source evidence

Purpose-separated HMAC signatures, exact peer/role/direction/environment
checks, one-megabyte/100-record limits, source-identity-only upserts, mapped
base hashes, content-free conflicts, chained checkpoints and an in-memory-only
CLI reduce design uncertainty for bundle tampering, duplicate append, native
destination overwrite, relationship drift, replay and credential/report
leakage.

`RISK-010`, `RISK-011`, `RISK-016`, `RISK-019`, and `RISK-025` remain open at
their existing ratings. The cross-app secret and routes are unconfigured; no
live Base44 function, RLS behavior, source record, file object, reverse run,
interruption recovery or cutover closure has been exercised. Encrypted disk
export remains explicitly blocked rather than partially implemented.

## 2026-08-06 incremental and reverse-control risk evidence

The bounded pair lease reduces design risk from simultaneous forward/reverse
runs. Server-time high-water tuples, overlap, ID deduplication and two quiet
passes reduce omission risk from equal timestamps, delayed visibility and page
shifts. Reverse origin mapping, mapped-base comparison, submitted guards, and
no-delete/no-merge policy reduce rollback duplication and overwrite risk. The
file audit and full integrity verdict reduce hidden asset and partial-validation
risk; report sanitization reduces credential and questionnaire-content leakage.

`RISK-010`, `RISK-011`, `RISK-016`, `RISK-019`, and `RISK-025` remain open at
their prior ratings. Adapter behavior, live leases, real pagination, file
reachability/copy, staging reverse rehearsal, late-write observation, RLS, and
cutover/rollback remain unproved. No cloud or production action occurred.

## 2026-08-06 bidirectional migration staging hard stop

The full source suite failed three questionnaire/repair assertions after all
focused migration gates passed. `RISK-010`, `RISK-011`, `RISK-016`,
`RISK-019`, and `RISK-025` remain open at their prior ratings: 1,000-record
adapter scale, live signatures/pagination, RLS, replay, cleanup, file
references, reverse synchronization, and late writes were not exercised. The
hard stop prevented all staging and production mutation, so no risk is lowered
or closed.
