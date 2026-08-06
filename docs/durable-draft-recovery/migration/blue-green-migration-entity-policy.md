# Blue/green migration entity policy

- Status: local authoritative policy; not deployed
- Policy: `config/pro-form-migration-entity-policy.json`
- Validator: `npm run migration:validate-policy`
- Directions: `blue_to_green`, `green_to_blue`
- Invariant: one active direction, deterministic upsert, no source deletion

## Entity inventory and order

| Order | Entity | Forward/reverse policy | Client/business data | Relationships and files | Skip/upsert consequence |
| ---: | --- | --- | --- | --- | --- |
| 10 | `ProFormDraft` | required / required | Canonical and compatibility answers, identity, recovery and lifecycle data | Draft predecessor/replacement and final submission | Production non-test records require upsert; submitted state and holds remain unchanged. |
| 20 | `ProFormDraftEvent` | required / required | Draft mutation/audit values and summaries | `draft_id` | Upsert after draft mapping; never append a duplicate event identity. |
| 30 | `ProFormSubmission` | required / required | Submitted metadata/userdata and immutable hashes | `source_draft_id`; four documented nested file-reference paths | Upsert without regenerating submitted content or copying file bytes into logs. |
| 40 | `ProFormSubmissionIntake` | required / required | Fallback payloads, retry/repair evidence and delivery state | `source_draft_id`, `linked_submission_id` | Upsert after draft/submission mapping; preserve retry and status state. |
| 50 | `ProFormRecoverySecurityEvent` | audit_optional / audit_optional | Safe security outcomes and protected hashes | Optional `draft_id` | May be skipped only by an approved audit-retention decision; omission reduces cross-environment security history. |
| 60 | `ProFormEmailVerificationAttempt` | environment_local / environment_local | Expiring verifier hashes and delivery state | None | Never copied. Active attempts do not survive cutover and verification must restart in the active environment. |
| 70 | `ProFormMigrationCheckpoint` | never_migrate / never_migrate | Operation-local cursors, tokens and safe reports | None | A checkpoint cannot resume in another app; the destination starts its own bound checkpoint. |
| 80 | `ProFormMigrationIdMap` | environment_local / environment_local | Protected identity mapping only; no record payload | Encodes mapping rather than a business relationship | The runner deterministically upserts a local map in each participating app or protected bundle; it is not copied as business data. |
| 90 | `ProFormMigrationConflict` | environment_local / environment_local | Hashes, revisions and safe diagnostics only | None | Conflicts remain with the migration operation and require explicit resolution; raw payload stays in protected process memory. |

No unrelated entity exists in the current entity directory. The validator fails when a future schema lacks a classification.

## Per-entity data and timestamp detail

| Entity | Environment-local | Logical time fields | Sensitive/file classification |
| --- | --- | --- | --- |
| `ProFormDraft` | No | `origin_created_at`, `source_created_date`, `created_date`; update equivalent plus policy-allowed `last_saved_at` | Answer/canonical JSON, email, verifier/identity hashes and internal IDs are sensitive; no declared file path. |
| `ProFormDraftEvent` | No | Same origin/source/platform chain; `created_at_iso` remains business event metadata | `value_json`, business/user fields, actor hash and internal IDs are sensitive. |
| `ProFormSubmission` | No | Same origin/source/platform chain | Complete `metadata`/`userdata` are sensitive; four nested image/file URL paths require protected file-reference handling. |
| `ProFormSubmissionIntake` | No | Same origin/source/platform chain; client/server intake timestamps remain business fields | Email/user ID and raw/transformed/repaired payloads are sensitive. |
| `ProFormRecoverySecurityEvent` | No, but audit-optional | Source/platform dates plus `created_at_server` for event semantics | Subject, network/device, email-lookup and internal ID hashes are sensitive. |
| `ProFormEmailVerificationAttempt` | Yes | Requested/expiry/verified/consumed dates remain local attempt time | Verification, email-lookup, network/device, redirect and provider hashes/IDs are sensitive. |
| `ProFormMigrationCheckpoint` | Yes | `started_at`, `updated_at`, `completed_at` are operation-local | Token/grant hashes, report JSON and cursor record IDs are sensitive. |
| `ProFormMigrationIdMap` | Yes | `first_migrated_at`, `last_migrated_at` | Source/destination/origin app and record IDs plus hashes are protected; no payload or file. |
| `ProFormMigrationConflict` | Yes | `detected_at`, `resolved_at` | Protected IDs, hashes and bounded safe diagnostics only; no payload or file. |

All schemas also have Base44-managed `id`, `created_date`, `updated_date` and
`created_by` outside their declared properties. Those fields are never copied
as destination fields. Every policy explicitly rejects staging and synthetic
test records. Required and audit-optional portable entities use deterministic
destination upsert; environment-local/never-migrate entities are skipped with
the consequences above rather than silently copied.

## Classification dimensions

Every policy entry records logical identity, dependency order, relationship paths, Base44-managed fields, excluded/sensitive/hash-excluded fields, file references, production/staging/test eligibility, conflict handling and retention. Base44-managed `id`, `created_date`, `updated_date` and `created_by` are never copied as destination platform fields.

All nine policies set `stagingAllowed:false` and `testRecordPolicy:"never_migrate"`. A production-targeting runner must reject a source row whose environment is staging/test or whose `test_run_id` is present. Required records cannot be skipped because they are malformed; they become a safe conflict/manual-review result.

## Identity, upsert and relationships

The first known identity is `origin_app_id + origin_entity + origin_record_id`. The immediate hop is `source_app_id + source_entity + source_record_id`. The ID map keys one source identity and destination app/entity to one destination record. Repeated full, incremental, freeze-delta, late-write and reverse runs update that destination record rather than appending another.

Relationships are projected as logical identities for comparison, then finalized through the ID map after their target dependency has migrated. A missing or ambiguous required mapping fails closed. Migration never deletes a source record and never merges answer content to resolve a conflict.

## Hash and file policy

The content projection excludes destination IDs/dates and migration bookkeeping but retains meaningful business content, including answers, canonical state, compatibility state, lifecycle status and logical relationships. SHA-256 is an integrity/change signal, not authorization.

Submission file fields are references. The protected future exporter must handle referenced objects separately, verify destination references, and keep file bytes out of logs, conflict rows and summary reports.

## Security and retention

Raw answers, emails, recovery codes, tokens, credentials and file contents may exist only in an authorized protected bundle or migration process memory. Reports and logs contain counts, hashes, safe codes, opaque batch IDs and bounded diagnostics.

Submitted state, support/retention holds and retention anchors survive every direction. Security events are explicitly optional rather than silently omitted. Environment-local attempts/checkpoints/maps/conflicts retain their documented local audit windows and are never mistaken for portable business data.

## Future implementation boundary

Later prompts must implement the protected exporter/importer, encrypted bundle handling, single-direction lease, checkpoint runner, ID-map upsert, relationship finalization, conflict workflow, file transfer and count/hash reconciliation. This prompt creates no app, record, bundle, deployment or schema push.

## Observed local validation

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | 775 packages installed/audited; npm reported 29 vulnerabilities and six pending install-script approvals. |
| `npm run migration:validate-policy` | 0 | All 9 entity schemas classified; origin, relationship, sensitive, file, hash, selection and control-schema rules passed. |
| Focused logical-time/hash/email-selection/control-schema Vitest run | 0 | 94/94 tests passed. |
| `npm run test:identity-contract` | 0 | Cross-runtime recovery/selection contract passed. |
| `npm run test:entity-schemas` | 0 | 29/29 tests passed; four extended entities plus security, verification, ID-map and conflict schemas validated. |
| `npm test` | 1 | 1,997/2,000 passed. The three existing failures are geographic numeric-zero normalization and two submission-repair expectations. |
| `npm run lint` | 1 | Existing repository baseline: 28 errors and 14 warnings; focused changed-file lint had no error. |
| `npm run typecheck` | 2 | Existing project-wide dependency/JavaScript diagnostics remain. |
| `npm run build` | 0 | Vite build and the sensitive built-bundle scan passed. |

No Base44 command, cloud operation, production record read/export, schema push,
deployment, `_next` creation, feature-branch push or `main` push occurred.
