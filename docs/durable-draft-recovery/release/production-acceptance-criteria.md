# Durable Draft Recovery Production Acceptance Criteria

## Staging release-candidate acceptance gate

Production acceptance requires a `READY_FOR_FINAL_STAGING_MANUAL_CERTIFICATION`
manifest tied to one exact feature commit, verified report/evidence checksums,
all required staging browser/security/capacity/cleanup evidence, no forbidden
pending staging requirements, and later completion of the manual/rollback
placeholders. Manually editing a report status cannot satisfy this gate.

Any runtime fix after the future freeze invalidates prior RC evidence. Test
changes require affected-suite reruns; schema/function changes require staging
redeployment and full recertification. Freeze/tag creation remains deferred to
Prompt 4 and this source increment authorizes no production action.

## Comprehensive staging gate status — 2026-08-06

Candidate `023ed7c9feb3e7b8baf8da09aedd785406ca59cb` did not enter live staging
certification because the mandatory security coverage validator failed with 25
release-blocking findings. Production acceptance remains denied. The feature
branch must not be pushed under this prompt's certification-only push rule.
See the [blocked certification report](../testing/staging-comprehensive-automated-certification.md).

## Load, capacity, and controlled-failure acceptance

Requirement `DR-PERF-LOAD-001` must pass against the exact staging release
candidate before production enablement. The final gate requires 250
simultaneous sessions, 1,000 drafts, at least 30 sustained minutes, the fixed
latency/integrity/security/event-amplification thresholds, and zero unresolved
test records. A cleanup failure, cross-client result, lost acknowledged state,
submitted regression, or threshold failure blocks release.

Local mock smoke/chaos evidence validates harness mechanics only. It does not
certify Base44 staging capacity. Thresholds cannot be loosened without an ADR
and risk update. See the [load/capacity contract](../testing/load-capacity-and-chaos-test-contract.md).

## Adversarial security acceptance

Production enablement additionally requires `DR-SEC-ADV-001` evidence from the
exact release candidate. Deterministic property, security unit/integration,
local browser leakage, staging RLS/recovery/rate-limit, dependency audit, and
sanitized artifact gates must pass. Any boundary failure blocks release and may
not be waived as flaky.

Evidence must show a non-production target, unique isolated staging subjects,
bounded attempts, no client recipient, no SES send during local testing, no raw
email/code/grant/token/answer in reports, and no deployment command. Critical
production dependency findings and unmitigated high direct exposed runtime
findings block acceptance. Request smuggling needs a future provider-controlled
proxy test and is not claimed here.

- Status: Release-blocking contract
- Date: 2026-08-05
- Owners: Isaac Hines; Engineering; QA; Security; Operations
- Sources: [ADR-001](../architecture/ADR-001-approved-product-and-security-decisions.md), [ADR-002](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md), [ADR-003](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md)

## Evidence and verdict rules

An acceptance result is valid only when its evidence records the Git commit, environment/app identity, UTC start and end times, test or command identity, test-data classification, observed numerator and denominator, threshold, result, and reviewer. Screenshots may supplement but cannot replace machine-readable results. Missing required evidence is `BLOCKED`; an assertion without an artifact is not evidence.

The save states are distinct:

- **Local browser save:** the serialized mutation has been acknowledged by the selected browser store. It may be labeled **Saved locally** and remains vulnerable to browser-storage loss. It is not a server-confirmed save.
- **Server-confirmed save:** the server has durably accepted the draft ID, server revision, client revision, and canonical state hash into `ProFormDraft`. Only this acknowledgement may produce the exact client wording **Saved securely**.
- Pending, failed, offline, and local-only states must use visibly different wording. A local write, queued request, HTTP request start, or deployment exit code cannot produce **Saved securely**.

All criteria marked release blocking in the traceability matrix must pass before global enablement. Security-boundary criteria permit zero known failures. Cross-client, cross-email, or cross-code exposure has zero tolerance. Production-enabled checks are continuation gates performed immediately after the separately authorized enablement step; failure changes the verdict to `FAILED` and invokes the kill switch or rollback. A deployment command returning success is deployment evidence only, never production certification.

### Repository validation gate

The repository-root `package.json` is the sole command authority. On the exact candidate commit, `npm run test:manifest`, `npm run test:ci`, and `npm run check` must each exit `0`. `npm run check` executes lint, typecheck, the normal CI suite, and the production build and reports every result. Missing tests cannot pass through `--passWithNoTests`.

Normal release tests use `*.test.js`/`.test.jsx`. Temporary `*.baseline-characterization.test.js`/`.jsx` files reproduce known defects and are explicitly excluded from `test:ci`; a passing characterization is not evidence that the desired behavior works. A separately reviewed Playwright foundation now exists under `tests/e2e/*.spec.js`, but its shell and `[HARNESS]` fixture-mechanics checks are only harness validation. `npm run test:e2e:pending-report` must list every deferred V2 scenario during foundation work, and `npm run test:e2e:pending-strict` must exit `0` on a release candidate. Native-browser criteria remain `BLOCKED` until all pending tests are activated and every requirement-level scenario and required staging/production-safe evidence below passes.

## 1. Source and rollback

Requirement IDs: `DR-SRC-001`, `DR-ROLLBACK-001`, `DR-MIG-REV-001`.

| Criterion | Measurable pass threshold | Required evidence |
| --- | --- | --- |
| Immutable source references | Remote tag `pre-durable-draft-recovery-2026-08-05` peels to `27ddc347d55db00796a0e3e19ac343245519b01e`; remote branch `backup/pre-durable-draft-recovery-2026-08-05` resolves to the same SHA. Any mismatch fails. | Captured `git ls-remote` output with ref names and SHAs, secret-scanned and attached to the release record. |
| Fresh-clone baseline build | From a new empty directory, clone, checkout the peeled baseline, install from the lockfile, and run the baseline build with exit code `0`; expected entry assets must exist. Three consecutive runs must pass. | Commands, tool versions, lockfile hash, build logs, and artifact manifest. |
| Source rollback rehearsal | Restore the baseline source through the documented non-force procedure, build it, and complete the existing-flow smoke suite with `0` P0/P1 failures. | Timed rehearsal report linked to the source/application rollback runbook. |
| Reverse data migration | Before launch, migrate representative green-created/updated records back to blue with exact canonical hashes, complete relationships, and `0` unresolved rows or file-reference failures. | Reverse-batch manifest, counts, hashes, relationship report, and reviewer approval. |
| Domain reversal procedure | The runbook identifies permissions, detach/attach order, DNS/SSL checks, fallback URL, decision owner, and data-first reversal. A non-production rehearsal completes within the documented recovery objective with every step timestamped. | Approved runbook and timed rehearsal evidence. |
| Kill switch | In staging and production-disabled validation, activation disables all new durable-recovery entry points within `60` seconds, preserves the existing flow, and creates `0` new recovery-path writes across `100` synthetic attempts. | Flag audit, synthetic results, logs, and restoration check. |

## 2. Application boot

Requirement IDs: `DR-BOOT-001`, `DR-BOOT-002`.

Run each storage scenario for `20` cold boots per required desktop engine and `10` per required mobile-sized engine. The questionnaire must reach an interactive or bounded recoverable-error state within `5` seconds on the staging test network; it may not remain in bootstrap loading beyond that limit.

| Scenario | Measurable pass threshold |
| --- | --- |
| `localStorage` available | `100%` of boots render; `0` uncaught exceptions. |
| `localStorage` property getter throws | `100%` render through the safe fallback; `0` uncaught `SecurityError`. |
| `localStorage` operations throw | `100%` render through the safe fallback; every thrown read/write/remove is contained. |
| IndexedDB unavailable | `100%` render using the next safe storage tier. |
| Both persistent stores unavailable | `100%` render in explicit memory-only mode; recovery entry points remain available. |
| Bootstrap termination | `0` infinite loading states and `0` unhandled promise rejections across all runs. |

Evidence must include browser/version, injected failure, navigation timing, console capture, uncaught-error count, and final UI state.

## 3. Local draft persistence

Requirement IDs: `DR-LOCAL-001`, `DR-LOCAL-002`.

| Criterion | Measurable pass threshold |
| --- | --- |
| Immediate supported mutation capture | Each mutation in category 8 is synchronously queued and acknowledged by the best available browser store within `250 ms` p95 and `1 second` p99 across at least `10,000` mutations. |
| Truthful local state | **Saved locally** appears only after local-store acknowledgement; **Saved securely** appears `0` times before server acknowledgement. Failure/offline text is distinct in `100%` of state-transition tests. |
| Safe key names | Static scans and runtime enumeration across `1,000` drafts find `0` raw emails, normalized emails, recovery codes, admin grants, or passwords in browser-storage key names. |
| Client isolation | Two clients sharing a browser profile receive distinct opaque namespaces in `100` paired scenarios; clearing one namespace changes `0` keys or snapshots owned by the other. |
| Malformed snapshot handling | For each malformed, truncated, wrong-version, and wrong-hash fixture, the last known good snapshot hash remains unchanged, the invalid value is quarantined/ignored, and boot terminates safely. |

Evidence includes latency distributions, enumerated key-name classifications without secret values, namespace diff reports, and before/after snapshot hashes.

## 4. Server draft persistence

Requirement IDs: `DR-SAVE-001`, `DR-REV-001`, `DR-SUBTERM-001`, `DR-PERF-001`.

| Criterion | Measurable pass threshold |
| --- | --- |
| Complete server state | Every mutation in category 8 round-trips to `ProFormDraft` with exact canonical hash equality. Answers, validation, touched, expanded, text-validation, credential answers, incomplete editor/UI state, uploaded URLs, and safe file metadata have `100%` coverage. |
| Server acknowledgement | Every accepted save returns the accepted client revision, strictly monotonic server revision, and matching canonical hash. The UI changes to **Saved securely** only after this response. |
| Duplicate request | Same revision/same hash returns idempotent success with no duplicate state mutation or audit mutation. Run `1,000` duplicate pairs with `0` duplicates. |
| Revision collision | Same revision/different hash returns a conflict for `100%` of `1,000` cases. |
| Stale revision | Every lower-revision write is rejected and changes neither canonical hash nor status; `0` overwrites across `10,000` attempts. |
| Submitted terminal guard | Autosave, retry, merge, compatibility write, and delayed response suites cause `0` mutations or status regressions after `submitted`. |
| Ordinary save latency | Under the category 18 expected-load profile, server acknowledgement is at most `2.5 seconds` p95 and `5 seconds` p99, measured from request dispatch to accepted response. |
| Threshold governance | Measured thresholds may be tightened. A proposed relaxation requires a versioned decision recording the measured distribution, cause, client impact, owner, and approval before release. |

Evidence: per-mutation canonical hash comparisons, revision/status before-and-after records, idempotency/conflict counts, and load-test latency distributions.

## 5. Recovery

Requirement IDs: `DR-REC-001`, `DR-REC-002`, `DR-SEC-001`.

| Criterion | Measurable pass threshold |
| --- | --- |
| Exact-email selection | Across at least `10,000` randomized multi-draft datasets, the exact normalized-email hash selects exactly the newest server-created eligible record using the deterministic ID tie-break; changing `updated_date` or client time changes `0` selections. |
| Status filtering | `active`, `submit_attempted`, `submit_failed`, and `submitted` are eligible; `cleared_superseded`, `expired`, and `deleted` produce `0` automatic selections. |
| Code selection | Every valid code selects exactly its matching draft without email; a code produces `0` access to another draft across at least `10,000` positive and negative attempts. |
| Submitted and older records | Submitted drafts reopen read-only. Older eligible drafts are absent before authorization and list only safe identifiers after successful recovery. |
| Storage independence | Every server recovery scenario succeeds when localStorage, IndexedDB, or both are blocked. |
| Durable acknowledgement | After **Saved securely**, reload and full browser restart recover an identical canonical hash in `100%` of `1,000` trials. |
| Authorized correctness | Valid authorized recovery succeeds at least `99.9%` across at least `10,000` automated/load attempts, excluding deliberately injected dependency failures. |
| Security boundary | Cross-client, cross-email, cross-code, cleared-record automatic selection, and unauthorized older-list exposure each have `0` permitted occurrences. Any occurrence fails release. |

Evidence: seeded recovery corpus, expected/actual selected IDs, authorization traces, browser-storage fault runs, canonical hashes, and zero-boundary-violation report.

## 6. Opening modal

Requirement IDs: `DR-MODAL-001`, `DR-A11Y-001`.

| Criterion | Measurable pass threshold |
| --- | --- |
| Mandatory display | The modal is observed before interactive autosave in `100%` of new/opened workflow tests. |
| Signed email | A valid signed email is displayed exactly; an unchanged value retains signed provenance. |
| Changed signed email | In `100` changed-email scenarios, a new/current-context draft is created or associated and `0` lookup requests are made for the replacement email's existing drafts. |
| Optional email and acknowledgement | Email can be omitted only after acknowledgement. The continue action remains disabled before acknowledgement in `100%` of no-email tests. |
| Recovery code | The one-time/current-session code is visible, keyboard reachable, and the copy result exactly matches the displayed code in every supported browser. |
| Bootstrap guard | Empty initial Redux state sends `0` saves before recovery resolution and overwrites `0` recovered hashes across `1,000` delayed-bootstrap scenarios. |
| Keyboard access | All choices, input, copy, acknowledgement, close policy, and recovery path are operable by keyboard with deterministic focus order and no focus trap escape. |
| Screen reader/accessibility | Automated scans report `0` serious/critical violations; manual screen-reader checks confirm accessible names, instructions, errors, status changes, and code-copy feedback. |

Evidence: modal path request trace, draft-identity diff, autosave call count, copy assertion, automated accessibility report, and signed manual assistive-technology checklist.

## 7. Recovery panel

Requirement ID: `DR-PANEL-001`.

The panel must pass all of these checks in every required browser and viewport:

1. It renders above Question 1, in the questionnaire footer, or both, and renders `0` instances in the site header.
2. Copy output exactly matches the authorized code and is keyboard operable.
3. The masked email reveals no more than the approved mask and never renders the lookup hash.
4. Local, pending, server-confirmed, offline, and failed autosave labels match the evidence rules at the top of this document in `100%` of transition tests.
5. Network and analytics inspection contains `0` raw emails, recovery codes, admin grants, canonical answers, or verification tokens.

## 8. Mutation coverage

Requirement IDs: `DR-MUT-001`, `DR-MUT-002`.

Every item below must pass local acknowledgement, server acknowledgement, reload, browser restart, exact canonical-hash recovery, and appropriate validation-state checks in the automated mutation suite:

1. Text.
2. Textarea.
3. Radio.
4. Checkbox/multi-select.
5. Question 5 location add.
6. Question 5 location update.
7. Question 5 location remove.
8. Question 5 primary-location change.
9. Numeric-range incomplete editor.
10. Manual-geography incomplete editor.
11. Image-person incomplete editor.
12. Certification editor.
13. Guarantee editor.
14. Confirm-modal business/domain edits.
15. Validation-only changes.
16. Touched-only changes.
17. Expanded-only changes.
18. Reset Question.
19. Conditional-child cleanup.
20. Uploaded file URL and safe metadata.
21. Raw `File`/`Blob` exclusion.

Pass threshold is `100%` of named mutation types with at least `50` round trips per type and `0` raw `File`/`Blob` values in serialized local/server state. Failed cases block release; aggregate success cannot hide an uncovered type.

Evidence: a per-type result manifest with local/server revisions and hashes, reload/restart outcome, serialized-type scan, browser/version, and failure attachments.

## 9. Clear All

Requirement IDs: `DR-CLEAR-001`, `DR-CLEAR-002`.

Across `100` complete transactions and injected-failure variants:

1. The old record becomes `cleared_superseded` and its pre-clear canonical hash remains available to authorized support.
2. A distinct record, draft ID, session ID, and recovery code are created.
3. The email association and its unverified/verified state are retained without an upgrade.
4. The new record is server-created after the old record and becomes the newest eligible record for that email.
5. The new empty canonical hash is stored and the new code is displayed/copyable.
6. When email exists, exactly one idempotent delivery workflow is created for the new code.
7. An injected SES failure leaves the new draft `active`, leaves the code visible, records the failure, and does not restore the old status.
8. `1,000` delayed lower-revision saves addressed to the old draft produce `0` state changes.
9. Clear/supersession/replacement/delivery outcome events exist exactly once per idempotent transaction.
10. Clear All is absent or rejected for `submitted`.

Evidence: old/new record projections, server-created ordering, code-version comparison without raw code persistence, delivery/event counts, and stale-write before/after hashes.

## 10. Submission and PDF

Requirement IDs: `DR-SUBMIT-001`, `DR-PDF-001`.

| Criterion | Measurable pass threshold |
| --- | --- |
| Pre-submit save | The complete post-validation canonical hash is force-saved before `100%` of outbound submissions. |
| Attempt state | `submit_attempted` and its immutable snapshot are durable before the first submission side effect. |
| Success | Successful submission records `submitted`, `final_submission_id`, submitted snapshot, and PDF source exactly once. |
| Failure | Injected primary/fallback failures record `submit_failed` and preserve every answer/hash in `100%` of cases. |
| Zapier/intake compatibility | Existing primary Zapier, fallback intake, retry, repair, and deduplication suites have `0` regressions and no duplicate final submissions. |
| Submitted recovery | All submitted answers render read-only; edit and Clear All operations are unavailable or server-rejected. |
| PDF identity | Regenerated PDF model hash and identifying metadata resolve from the submitted snapshot, never a newer blank draft, across `500` multi-draft cases. |
| Start New | A distinct active draft is created while the submitted record, final ID, snapshot, code, and PDF source remain byte/hash-identical. |
| Delayed saves | `10,000` delayed autosave/submission-response attempts cause `0` submitted regressions. |

Evidence: ordered submission trace, immutable snapshot/hash, final/intake/Zapier identifiers, failure fixtures, recovered read-only DOM assertions, and PDF model identity report.

## 11. Email and SES

Requirement IDs: `DR-EMAIL-001`, `DR-EMAIL-002`.

| Criterion | Measurable pass threshold |
| --- | --- |
| Sender | All production templates use exactly `MSP Success Websites <noreply@mspsuccesswebsites.com>`; authenticated test evidence confirms the From identity. |
| SES account readiness | Region, production/sandbox status, verified domain/sender, quotas, and sending authorization are captured; sandbox status or an unverified sender blocks release. |
| Least privilege | IAM policy permits only required SES send/status operations and approved resources/conditions; no unrelated wildcard action passes review. |
| Staging routing | `100` messages covering entered client domains are delivered only to the internal allowlist, every subject begins `[STAGING]`, and `0` messages reach entered clients. |
| Delivery retry | Injected transient failures enter bounded idempotent retry; one delivery intent creates at most one accepted final send and a terminal outcome is audited. |
| Bounce/complaint | Runbook names owners, thresholds, suppression action, and escalation. Simulator or feasible non-client tests exercise bounce and complaint paths without real-client delivery. |
| Frontend secret exclusion | Built assets, source maps, repository scans, requests, and browser runtime contain `0` AWS access keys, secret keys, or credential-bearing SES endpoints. |

## 12. Public recovery abuse controls

Requirement IDs: `DR-ABUSE-001`, `DR-ABUSE-002`.

1. Per-IP and per-email-keyed-hash counters reject the first request beyond their documented window limit in `100%` of boundary tests.
2. Response delay is nondecreasing across configured offense tiers; measured delay is within `100 ms` of the configured minimum after network overhead is removed.
3. CAPTCHA is required at the configured suspicious/repeated-attempt tier and cannot be bypassed by changing raw email case or separators.
4. Temporary lockout begins and ends on server time at the configured boundaries and applies to normalized aliases.
5. Unknown, ineligible, expired, locked, and malformed attempts share the same public status, response schema, and generic message.
6. The p95 timing difference between matched and unmatched attempts within the same delay tier is at most `100 ms` in controlled tests.
7. Every attempt records one safe audit outcome with request correlation, keyed identifiers, control decisions, and server time.
8. Log, trace, analytics, and error-report scans find `0` raw recovery codes and `0` raw emails where a keyed hash is sufficient.
9. Enumeration corpus tests infer record existence no better than the documented generic response/timing boundary; any deterministic content/status oracle fails release.

Evidence: configured control thresholds, boundary-attempt ledger, response-schema/body digests, timing distributions, audit-event correlation, and secret-safe log scan.

## 13. Admin recovery

Requirement IDs: `DR-ADMIN-001`, `DR-ADMIN-002`.

| Criterion | Measurable pass threshold |
| --- | --- |
| Backend verification | Browser traces and bundles contain `0` password-verification logic or password verifier; every grant issuance is attributable to the backend function. |
| Persistent grant | A valid signed grant survives `10` full browser restarts when persistent storage is available and remains scoped to its environment/version. |
| Local revocation | **Forget This Device** removes the local grant and the next privileged call is denied in `100%` of tests. |
| Fleet revocation | Signing-secret rotation or required-version increment denies `100%` of previously issued grants across all tested browsers. |
| Password abuse controls | Boundary tests prove rate limits, increasing delay, temporary lockout, generic errors, and one safe audit event per attempt. |
| No direct entity access | Frontend bundles and network traces contain `0` unrestricted entity credentials or direct recovery entity list/read/update requests. |
| Grant containment | Redux snapshots, URLs, logs, analytics, error reports, and entity rows contain `0` raw grants. |
| Field allowlists | Admin list/read/update functions expose or mutate only documented fields; generated contract tests reject every non-allowlisted field. |

Evidence: backend/browser call trace, restart/revocation matrix, password-abuse boundary results, bundle/Redux/URL/log/entity scan, and allowlist contract report.

## 14. RLS

Requirement ID: `DR-RLS-001`.

Run at least `100` attempts per operation against each protected draft/event entity and environment candidate:

1. Anonymous direct list: `100%` denied.
2. Anonymous direct read: `100%` denied.
3. Anonymous direct create: `100%` denied.
4. Anonymous direct update: `100%` denied.
5. Anonymous direct draft-event creation: `100%` denied.
6. Authorized public backend save and recovery: at least `99.9%` successful for valid requests and `0` scope escapes.
7. Authorized admin backend recovery: `100%` of valid allowlisted operations succeed and `0` non-allowlisted operations succeed.

Any direct anonymous access or scope escape is a security-boundary failure and fails release.

Evidence: environment-scoped operation matrix with actor, entity, operation, expected/actual authorization result, response classification, and backend-function control cases.

## 15. Browser and device matrix

Requirement IDs: `DR-BROWSER-001`, `DR-LINK-001`.

The full release-blocking browser suite must pass on the current supported versions recorded in the evidence manifest for:

- Chromium/Chrome desktop.
- Edge-compatible Chromium desktop.
- Firefox desktop.
- WebKit/Safari desktop.
- iOS-sized WebKit.
- Android-sized Chromium.

Each target must pass boot, modal, all mutation types, local/server save-state truth, recovery, Clear All, submission, PDF, accessibility, and concurrency with `0` P0/P1 failures. Missing target evidence is `BLOCKED`.

Manual link-open checks from Outlook, Gmail, Microsoft Teams, iOS Mail, and Android Gmail must each navigate to the external browser-hosted questionnaire, preserve the signed invitation context, and complete modal bootstrap. Record device/app/browser versions and final URL classification. No embedded email, Teams, Gmail, or Outlook widget is expected or accepted as substitute evidence.

## 16. Concurrency

Requirement IDs: `DR-CONCUR-001`, `DR-OFFLINE-001`.

| Scenario | Measurable pass threshold |
| --- | --- |
| Two-tab non-overlapping edits | `1,000` randomized pairs merge both field values with correct metadata and no loss. |
| Same-field edit | `100%` return the ADR-003 user-visible conflict or documented safe current-value behavior; `0` silent overwrites. |
| Stale save | `10,000` lower/base-revision requests are rejected with unchanged canonical hash. |
| Duplicate request | `1,000` duplicates return the same accepted outcome and create no duplicate mutation/event. |
| Offline reconnect | `500` offline sequences reconnect, reconcile, and either merge or surface conflict without data loss; server-confirmed wording remains absent while offline. |
| `pagehide`/visibility | Browser-specific tests prove queued local capture and bounded best-effort server flush without claiming acknowledgement before a response; `0` uncaught errors. |

Evidence: randomized edit seeds, tab/source IDs, base/accepted revisions, canonical hashes, conflict UI results, network timeline, and page-lifecycle console capture.

## 17. Migration

Requirement IDs: `DR-MIG-001`, `DR-MIG-002`, `DR-MIG-003`.

1. Initial full blue-to-green migration completes for every inventoried entity and file/reference dependency.
2. At least three repeated deltas over overlapping checkpoints produce `0` duplicates and identical final hashes.
3. Final write-freeze delta records freeze/drain boundaries and leaves `0` eligible source changes beyond the approved checkpoint.
4. Injected already-open-blue writes are detected within the documented target, transferred once, and reconciled with `0` silent conflicts.
5. Green-to-blue reverse migration passes before launch with `0` missing, duplicate, corrupt, or unresolved rows.
6. Source/destination counts match by entity and status after accounting for explicitly documented transformations.
7. Canonical hashes match for `100%` of migrated rows; relationship completeness is `100%`.
8. Every referenced file is reachable or deliberately copied/remapped; `0` broken required references remain.
9. Green contains `0` records whose source classification is staging, synthetic, malformed-test, Playwright, load-test, or debug.
10. Cutover is blocked while any migration/reconciliation row, relationship, hash, file, or checkpoint outcome is unresolved.

Evidence: batch/checkpoint manifests, source/destination count and hash reports, ID-map relationship audit, file reachability report, test-data classifier output, and unresolved-row count.

## 18. Performance and capacity

Requirement IDs: `DR-LOAD-001`, `DR-LOAD-002`.

The release evidence records the current business estimate. The test load is the greater of that estimate and these mandatory floors:

- `250` simultaneous active questionnaire sessions.
- `1,000` active drafts throughout a continuous `60`-minute window.
- Continuous realistic typing, editor, autosave, recovery, and submission behavior throughout the window.

Pass thresholds:

1. Category 4 p95/p99 server-save acknowledgement targets pass for the full steady-state window.
2. Successful-path error rate is below `0.1%`, excluding explicitly tagged injected failures; security failures remain zero.
3. One keystroke does not directly create one network request. Observed ordinary-save count is bounded by the configured debounce/coalescing policy plus documented lifecycle flushes.
4. Event growth is bounded by accepted/coalesced mutations and lifecycle events, not raw keystroke count; the measured ratio and upper bound are in the evidence.
5. Every request payload remains at or below the configured client, proxy, function, and entity limits with at least `20%` measured headroom at the p99 payload size.
6. No queue, retry, memory, or event series grows without a documented bound during the `60`-minute window and a `15`-minute drain.

## 19. Observability

Requirement IDs: `DR-OBS-001`, `DR-OBS-002`.

Dashboards and structured events must expose save error rate, save latency, recovery success/failure, revision conflicts, CAPTCHA activation, rate-limit activation, SES failures, submission failures, PDF failures, and migration failures. Synthetic tests must generate and then locate one event for every signal with `100%` correlation to environment, release, safe request ID, and owner route.

Minimum alert thresholds and owners are:

| Signal | Trigger | Owner |
| --- | --- | --- |
| Save errors | Above `0.1%` for `5` minutes | Application on-call |
| Save latency | p95 above `2.5 s` or p99 above `5 s` for `5` minutes | Application on-call |
| Recovery correctness/security | Valid success below `99.9%` for `5` minutes, or any boundary violation immediately | Application on-call and Security |
| Revision conflicts | Above `5%` of save attempts for `15` minutes | Application owner |
| CAPTCHA/rate-limit activation | More than `3x` the approved staging/load baseline for `10` minutes | Security |
| SES failures | Above `1%` for `5` minutes, or any staging-to-client delivery immediately | Messaging owner and Security |
| Submission failures | Above `0.1%` for `5` minutes | Application on-call |
| PDF failures | Above `0.1%` for `5` minutes | Application owner |
| Migration failures | Any unresolved row, hash, relationship, file, or checkpoint failure | Migration owner |

Each alert must demonstrate delivery to its owner in staging and production-disabled validation. Missing signal, threshold, owner, or tested route blocks release.

Evidence: dashboard export, synthetic signal correlation manifest, alert-policy export, notification receipt, acknowledgement timestamp, and owner/runbook link for every signal.

## 20. Release sequence

Requirement IDs: `DR-REL-001`, `DR-REL-002`.

1. Staging certification covers all applicable criteria on the exact candidate commit with `0` unresolved release blockers.
2. Clean green certification covers the exact staging-certified commit, production configuration inventory, migrated data, and temporary URL with `0` staging records.
3. Production deployment completes with durable recovery globally disabled; all four OTP/magic-link flags remain false.
4. The existing production questionnaire, submission, Zapier/intake, and PDF flows pass the production-disabled smoke suite with `0` P0/P1 regressions.
5. Global enablement is a separate, explicitly authorized step and cannot begin until all pre-enable release-blocking evidence is present and the verdict is `CERTIFIED`.
6. Immediately after enablement, synthetic save/recovery/submission/PDF checks run at `1`, `5`, `15`, and `60` minutes. Any security boundary or submitted regression fails immediately; other threshold breaches invoke the documented rollback decision.
7. ADR-002 rollback trigger thresholds, kill switch, owners, dashboards, and data-reconciliation jobs are active before enablement.

## 2026-08-06 final staging gate outcome

The staging candidate did not satisfy this acceptance contract. RC precheck, strict coverage, manual evidence, capacity, rollback, RLS, dependency, cleanup, and runtime-identity gates blocked. The only accepted final verdict remains `STAGING_RELEASE_CANDIDATE_CERTIFIED`; it was not issued. Green creation, migration, production-disabled deployment, domain cutover, enablement, and post-cutover evidence remain prohibited/pending.
8. A successful deployment or domain attachment without the full evidence set leaves the verdict `BLOCKED`.

## Release verdict contract

The only permitted release verdicts are:

### CERTIFIED

Every applicable release-blocking criterion has complete evidence and passes its threshold; all required reviewers have approved; security-boundary and cross-client failures are zero; migration and reverse-migration evidence is verified; browser evidence is complete; and no required item is unresolved. `CERTIFIED` applies only to the recorded commit and environment manifest.

### FAILED

At least one executed criterion breaches its threshold. Any security-boundary failure, unresolved cross-client data exposure, submitted-state regression, staging email delivered to a client, or migration integrity failure produces `FAILED`. Enabling or continued operation is prohibited until remediation and a new complete run.

### BLOCKED

Certification cannot be evaluated because required evidence, access, environment, dependency, reviewer, browser result, or rehearsal is missing or inconclusive. Missing browser evidence and unverified reverse migration always produce `BLOCKED`. CLI deployment success alone cannot change `BLOCKED` to `CERTIFIED`.

Verdicts must name the commit, environment manifest, evidence-set version, blocker/failure IDs, signer, and UTC time. No alternative verdict such as partial pass, conditional approval, or presumed pass is permitted.

## Current certification state

This document defines future acceptance evidence and does not certify the current revision. The root validation gate is installed, but the normal suite, lint, and typecheck retain known failures; required browser, staging, migration, security, and operational evidence is also incomplete. The current verdict therefore remains `BLOCKED`. The harness changes do not modify application behavior, schema, Base44 cloud resources, production data, SES configuration, email delivery, domains, or release flags.

## Release test control-plane acceptance

Requirement ID: `DR-TEST-001`.

Every release-blocking requirement must resolve to a stable executable test ID,
the phase's required browser results, and its named reports. Missing, skipped,
fixme, stale, or certified-without-evidence entries are blocking. A security
failure stops the run; cleanup failure is blocking; security groups rerun on
resume. Only phase-labeled green, cutover, and production work may remain
pending where the phase model explicitly permits it.

Evidence must record commit, environment, test-run ID, normalized status,
duration, safe error code, and artifact checksums without answers, emails,
credentials, recovery codes, grants, tokens, query-bearing URLs, or raw browser
storage state. Deployment success alone never satisfies this requirement.
## Operational observability acceptance gate

Production promotion additionally requires: the operational entity and both functions deployed first to staging; the fingerprint secret independently configured in staging and production; zero PII/answer/credential findings in logs and telemetry evidence; verified admin-only RLS and denial of direct client access; verified event allowlists and privilege separation; save/recovery/SES/submission/conflict/RLS/migration/synthetic summary signals; approved ordinary and security-boundary retention windows; alert routing and incident ownership; test-run cleanup; latency/error thresholds; and rollback evidence. Local implementation or successful deployment alone is not certification.

Health/alert acceptance also requires the fixed public projection to pass a
response/log leak scan; admin health and the operations dashboard to reject
missing, expired, wrong-device, and revoked grants; synthetic probes to prove
exact-state recovery and exact-run cleanup without SES, Zapier, or intake side
effects; two consecutive probe failures and every critical invariant to alert;
staging delivery to reach only the approved internal redirect; cooldown to be
durable across instances; alert-transport failure to be independently visible;
and production scheduling to remain disabled until the authorized cutover.
