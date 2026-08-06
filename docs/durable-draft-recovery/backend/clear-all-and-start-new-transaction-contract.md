# Clear All and Start New transaction contract

- Status: implemented locally; not deployed and schema not pushed
- Branch: `feature/durable-draft-recovery`
- API version: `1`
- Shared transaction service: `base44/functions/_shared/proDraftReplacement/entry.ts`
- Shared email service: `base44/functions/_shared/proDraftRecoveryEmailService/entry.ts`

## Invariants

Clear All and Start New always create a separate `ProFormDraft`; neither operation deletes a record. Clear All accepts only `active` or `submit_failed`, retains the source as `cleared_superseded`, and links it to the replacement with an incremented server revision. Start New accepts only `submitted`, preserves its status, revision, final submission ID, canonical state, and PDF/submission identity, and creates an independent active generation.

Both replacements have a new Base44 record ID, backend-generated session ID, recovery code, and resume token. Their canonical state is schema version 4 and begins empty. Recovery-email association metadata is copied when present. Raw codes and tokens exist only in process memory and the first successful response; only purpose-bound hashes are stored.

## Transaction sequence

### Clear All

1. Validate POST, JSON, bounded size, exact request keys, runtime flag, exact-draft write authorization, status, and expected server revision.
2. HMAC the operation, source ID, and idempotency key; search by source ID plus that hash.
3. Create one `active` replacement with `draft_origin=clear_all_replacement` and transaction status `pending`, then bind its Base44-generated ID into canonical state through compare-and-set.
4. Compare-and-set the source to `cleared_superseded`, increment its server revision, and write only linkage/supersession metadata.
5. Compare-and-set the replacement marker to `committed`.
6. Issue a recovery-session token, attempt recovery-code email through the internal service, and return one-time credentials.

### Start New after submission

1. Validate the same boundary and exact submitted-read authorization.
2. Require `submitted` and the expected revision, then deduplicate by source plus operation HMAC.
3. Create and bind a blank pending replacement with `draft_origin=start_new_after_submission` and generation `source + 1`.
4. Compare-and-set the replacement marker to `committed`.
5. Do not write the submitted record. Issue credentials and conditionally attempt email.

## Partial failure and recovery

| Failure point | Durable state | Email | Retry behavior |
| --- | --- | --- | --- |
| Replacement create/bind fails | Source unchanged | None | Same key may retry creation |
| Clear source CAS conflicts | Replacement pending/orphaned; source unchanged or concurrently changed | None | Same key locates the existing replacement and retries only when source preconditions still hold |
| Replacement commit marker fails | Clear source may already be superseded; replacement remains pending | None | Response sets `replacementRecoveryRequired=true`; same key commits the existing record without creating another |
| Email fails | Replacement remains committed | Failed result and copy warning | Credentials are returned once; delivery metadata records a safe failure |

Pending, orphaned, and failed replacements are excluded from automatic email recovery. Recovery reuses the source ID and original idempotency key, verifies exact linkage/lifecycle state, and calls the same endpoint. A committed replacement is returned idempotently. Raw credentials are never reconstructed: replay returns null credential fields with `credentialsReissueRequired=true`. A client may supply a high-entropy `clientReplacementResumeToken`; only its hash is stored, while the recovery code remains one-time.

## Email and selection behavior

The replacement function calls the internal email service only after commit. The service accepts an already-authorized draft and process-memory code; it accepts neither public authorization nor recipient/sender overrides. It verifies the stored code HMAC, uses only the retained record email, purpose-HMACs delivery idempotency, compare-and-sets metadata, and records value-free events. Missing email means no attempt. Transport failure never rolls back a replacement.

Automatic selection accepts normal eligible legacy records without a transaction marker and committed replacements. It rejects `pending`, `orphaned`, and `failed` replacements. A cleared source is lifecycle-ineligible.

## Response and security contract

Responses use `Cache-Control: no-store` and expose allowlisted summaries, never hashes. New commits return the raw recovery code, resume token, and recovery-session token once. Replays return none. Lifecycle and email events contain only safe operation/request/outcome metadata. Tests inject a fake transport, so no real email is sent.

## Tests and staging plan

Focused tests cover active/submit-failed Clear All, terminal rejection, Start New submitted-only behavior, submitted immutability, create/source/commit/email failure, pending recovery, idempotency/no duplicate, generation, credential non-storage, no hashes, no-store, stale-save rejection, safe events, internal email behavior, and replacement-aware selection. Entity tests enforce all seven fields and admin-only FLS.

A later explicitly authorized staging prompt must verify target identity; push schema/functions only to staging; certify live CAS and FLS; use marked synthetic drafts; inject each partial failure; prove pending exclusion, submitted byte preservation, redirect-only SES, and raw-value absence; clean test data; and publish commands/exit codes. Production and domains remain out of scope.

## Observed local validation — 2026-08-06

| Command/gate | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | 775 packages installed; audit reported 29 vulnerabilities (1 low, 8 moderate, 18 high, 2 critical) |
| Replacement service | 0 | 2/2 passed |
| Clear All | 0 | 15/15 passed |
| Start New | 0 | 6/6 passed |
| Shared/public recovery email | 0 | 24/24 passed |
| Replacement email selection | 0 | 57/57 passed |
| Save concurrency | 0 | 51/51 passed |
| Entity schemas | 0 | 27/27 passed; `ProFormDraft=71` |
| Security self-check | 0 | 18/18 passed after synchronizing the vendored selection primitive |
| `npm test` | 1 | 1,614/1,619 passed; the five existing questionnaire/repair baseline failures remain |
| `npm run lint` | 1 | Existing baseline: 32 errors and 16 warnings |
| `npm run typecheck` | 2 | Existing baseline: 271 diagnostics |
| `npm run build` | 0 | Vite build passed with stale browser-data warnings |

All email tests used injected synthetic transports. No Base44 deploy, schema push, live record mutation, SES call, or email delivery occurred.

## Staging certification status — 2026-08-06

The [full lifecycle staging attempt](../testing/staging-full-draft-lifecycle-certification.md)
is **FULL_DRAFT_LIFECYCLE_BLOCKED**. Replacement backend and client focused
sets passed, but the later submission/intake/repair prerequisite failed two
assertions and activated the deployment hard stop. Clear All, Start New,
replacement email, live CAS/FLS, idempotent retry, recovery selection, browser
namespace isolation, and cleanup were not exercised against staging.
