# Backend-only admin recovery API contract

Status: source implemented; staging certification pending. API version: `1`.

## Authorization

Every operation is `POST` JSON and requires `apiVersion: 1`, the persistent signed `adminGrant`, and its bound `deviceId`. The shared wrapper verifies environment, device binding, grant, password, recovery-policy, and secret-rotation versions before business logic may use service-role entities. The password remains exclusive to `verifyDraftRecoveryAccess`; these functions reject password, role, `isAdmin`, and override fields. JSON `adminGrant` is the Base44 client transport; an Authorization Bearer value is the approved alternate. Grants are never put in URLs, returned, or logged. All responses use `Cache-Control: no-store, max-age=0` and `Pragma: no-cache`.

Authorized and denied operations create safe `ProFormRecoverySecurityEvent` records. Draft edits also create `ProFormDraftEvent` records with `event_type=admin_edit`, a one-way actor reference, mutation ID, changed-field names, and no edited values.

## Functions and bounds

| Function | Purpose | Maximum request |
|---|---|---:|
| `listProFormDraftsForRecovery` | Paginated safe summaries/search | 64 KiB |
| `getProFormDraftForRecovery` | Exact approved detail | 32 KiB |
| `listProFormDraftEventsForRecovery` | Paginated redacted events | 64 KiB |
| `updateProFormDraftForRecovery` | Optimistic allowlisted edit | 1 MiB |
| `getProFormDraftLineageForRecovery` | Duplicate/lineage diagnostics | 32 KiB |
| `retryProQuestionnaireIntakeSubmission` | Existing deterministic retry | Existing business bound |
| `repairProQuestionnaireIntakeSubmission` | Existing diagnosis/repair | Existing business bound |

Retry/repair retain their names and external-side-effect routing. They no longer accept a legacy grant or Base44 admin-session shortcut. Record reads, AI calls, and delivery occur only after persistent-grant verification and authorization audit.

## Pagination, filters, and search

List/event page size defaults to 25 and is capped at 100. An HMAC-protected cursor binds version, operation, offset, and canonical query; tampering or reuse with different filters fails. Queries use Base44 `filter` with explicit limit/projection—never unbounded `list()`.

Allowed sort values are `last_saved_at_desc` (default) and `updated_date_desc`. Filters are `status`, `environment`, `hasRecoveryEmail`, `hasSubmission`, `hasSubmitError`, `retentionHold`, `superseded`, `testRunId`, `createdFrom`, `createdTo`, `savedFrom`, and `savedTo`. Exact search supports draft ID, session ID, final-submission ID, normalized recovery-email lookup HMAC, and normalized business domain. `recent_text` performs a substring scan over one bounded recent page. Regex and unsupported Base44 operators are not accepted.

## Safe projections

Lists contain identity/session/status, business display fields, masked email, dates, revisions, submission/error/supersession indicators, generation, environment, and test marker. Detail flags independently request canonical state, compatibility JSON, and migration metadata. JSON stays unchanged while parse validity is reported separately; reads never auto-repair.

Recovery-code, resume-token, identity, email lookup, state, submitted-state, idempotency, and authorization hashes are never returned. Event values are omitted by default. `includeValueJson=true` permits only a size-bounded parseable value with no credential-like keys; otherwise it remains omitted with a diagnostic.

## Edit allowlist

Updates require `draftId`, `expectedServerRevision`, `changes`, `reason`, and a 16–128 character `idempotencyKey`. Allowed keys are:

- `business_name`, `domain`, `user_name`, `user_email`, `recovery_email`
- `mapped_payload_json`, `metadata_json`, `userdata_json`
- `retention_hold`, `retention_hold_reason`
- `ai_repair_status`, `last_ai_repair_at`, `ai_repair_error_json`, `ai_repair_report_json`, `ai_repaired_payload_json`, `ai_repair_applied`

JSON is parsed/bounded before write. Email/domain are normalized. Recovery-email correction recomputes the lookup HMAC, records `admin_corrected`, and resets verification to `unverified`. Business/domain are synchronized into mapped-payload metadata using the current editor contract. State-bearing edits use optimistic revision and increment it; pure retention/repair metadata does not. Submitted drafts permit retention metadata only and keep their lock/submission identity. Idempotent replay returns a safe projection without another mutation.

## Lineage, client, and errors

Lineage returns the current summary, linked previous/replacement records, at most 100 same-session records, at most 100 same-source records, broken-link/duplicate diagnostics, supersession candidates, transaction status, and a no-auto-merge recommendation. It never expands to unrelated email drafts or merges submitted and active state.

`src/lib/proDraftAdminApiClient.js` exports `listDrafts`, `getDraft`, `listDraftEvents`, `updateDraft`, `getDraftLineage`, `retrySubmission`, `repairSubmission`, `normalizeAdminApiError`, and `getSafeAdminApiDiagnostics`. It obtains the grant/device bundle from the authorization/vault boundary, uses `base44.functions.invoke`, never logs payloads, performs no automatic retry, and clears/notifies authorization state on rejection.

Errors contain a generic message, safe code, and request ID. They do not expose authentication detail, grants, request bodies, entity errors, or secrets.

## Staging certification plan

After UI migration, deploy only to a target-verified staging app. Exercise wrong environment/device/version grants, cursor tampering, exact email/session searches, all edit/lock cases, concurrency, lineage, retry/repair non-production routing, and persisted audits. Inspect responses for no-store and hash absence. Production deployment, schema push, and domain changes are outside this implementation.
