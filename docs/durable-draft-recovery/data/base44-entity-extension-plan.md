# Base44 Pro Form entity extension and compatibility plan

- Status: `ProFormDraft` extension implemented locally; no entity schema pushed
- Date: 2026-08-05
- Planning baseline: `50c7379c1cfc30e2d242e917b0abe951e3f75584`
- Prompt 2 implementation baseline: `8b5aac603bb9c568b7bdc726423852c4e146582a`
- Branch: `feature/durable-draft-recovery`
- Base44 CLI inspected locally: `0.1.8`
- Machine-readable contract: [pro-form-field-manifest.json](./pro-form-field-manifest.json)
- Validator: `scripts/validate-pro-form-entity-schemas.mjs`
- Focused test runner: `scripts/run-pro-form-entity-schema-tests.mjs`
- Architecture authority: [ADR-002](../architecture/ADR-002-blue-green-base44-cutover-and-data-continuity.md), [ADR-003](../architecture/ADR-003-draft-identity-recovery-and-lifecycle-contract.md), [canonical draft state](../architecture/canonical-draft-state-contract.md), [identity contract](../architecture/draft-identity-and-email-normalization-contract.md), and [recovery-code contract](../architecture/recovery-code-and-draft-selection-contract.md)

## Decision and boundary

The four existing uppercase schema files remain the authoritative repository convention:

1. `base44/entities/ProFormDraft.jsonc`
2. `base44/entities/ProFormDraftEvent.jsonc`
3. `base44/entities/ProFormSubmission.jsonc`
4. `base44/entities/ProFormSubmissionIntake.jsonc`

They are not renamed. Prompt 2 adds 55 optional, field-restricted properties to the local `ProFormDraft` schema while preserving its 30 original properties, sole `session_id` requirement, unconstrained string `status`, and absent entity-level RLS. The other three schemas remain plan-only. The current public questionnaire may continue its compatibility draft/event calls, but none of the new protected fields may be written through anonymous direct entity calls.

The manifest is deliberately stored under `docs/durable-draft-recovery/data`, outside `base44/entities`. It is strict JSON but is not a Base44 entity resource and cannot be included by an entity-directory push. No generated `base44/.types/types.d.ts` exists; Prompt 2 does not generate types because no schema is pushed or deployed.

## Current compatibility baseline

| Entity | Existing top-level fields | Existing required array | Repository RLS/FLS | Current compatibility callers |
| --- | ---: | --- | --- | --- |
| `ProFormDraft` | 30 original + 55 local optional extensions | `session_id` | No entity RLS; all 55 new fields use admin read/write FLS | Public browser filter/create/update remains compatible; later backend service-role functions own new fields |
| `ProFormDraftEvent` | 12 | `session_id` | No entity RLS; no FLS | Public browser create; backend repair create |
| `ProFormSubmission` | 2 large objects | `metadata`, `userdata` | Existing creator/admin read-update-delete and open create/write objects; no FLS | Public and admin browser create; backend fallback/retry/repair create/filter |
| `ProFormSubmissionIntake` | 33 | `questionnaire_session_id` | Existing admin-only read/update/delete/write; no FLS | Admin browser list; backend fallback/retry/repair create/filter/update |

Compatibility findings:

- `ProFormDraft.status` is an unconstrained existing string. This plan does not add an enum to it, because existing values such as `draft` must remain readable while lifecycle normalization occurs in backend code.
- `ProFormSubmissionIntake.status` retains exactly `submitted`, `received_intake`, `retry_pending`, `retry_success`, `retry_failed`, and `abandoned`, with default `received_intake`.
- `ProFormSubmission.metadata` and `userdata` are preserved without restructuring.
- Runtime backend code already writes/searches `metadata.questionnaire_session_id`, although that nested key is not declared in the current submission schema. The planned top-level `questionnaire_session_id` is therefore conditional and must not be added until one canonical write/backfill/projection rule prevents divergence.
- Existing direct browser operations remain compatibility-only. Future authorization must move to scoped backend functions before draft/event entity RLS is tightened.
- The schemas contain 27 pre-existing missing-description paths outside Draft: 5 in `ProFormSubmission` and 22 in `ProFormSubmissionIntake`. The validator freezes those exact exceptions, requires descriptions on every new/future field, and rejects any new missing description.

## Field classification system

Every proposed field carries one or more of these classifications in the manifest:

| Classification | Meaning and default control |
| --- | --- |
| `public_compatibility` | Existing field whose effective behavior remains unchanged until backend/RLS migration. It is not assigned automatically to new fields. |
| `admin_only` | Available only to an allowlisted administrative backend/projection. |
| `backend_only` | Created, updated, and normally read only by reviewed backend or migration code. |
| `sensitive_pii` | Questionnaire content, email, internal IDs, or sensitive operational context; admin/backend read and write. |
| `sensitive_hash` | Lookup, verifier, idempotency, or integrity hash; admin/backend read and write and never a public authorization credential. |
| `migration_metadata` | Forward/reverse identity, checkpoint, and reconciliation metadata; admin/backend read and write. |
| `audit_metadata` | Bounded safe operational event or outcome metadata. |
| `retention_metadata` | Retention class, anchor, hold, or cleanup evidence. |
| `test_metadata` | Synthetic test identification that must be excluded from green production. |
| `canonical_state` | Canonical draft state, revisions, merge metadata, or integrity linkage. |
| `submission_lock` | Immutable submission/PDF snapshot or idempotency linkage. |

### Default field security

Every proposed field in this plan is optional and uses this field-level policy when implemented:

```json
{
  "read": { "user_condition": { "role": "admin" } },
  "write": { "user_condition": { "role": "admin" } }
}
```

Base44 service-role requests are treated as the admin role and therefore must be included by the policy. Sensitive PII, sensitive hashes, migration metadata, canonical state, test metadata, and retention details are never writable by anonymous direct entity operations. Public/backend functions return explicit allowlisted projections rather than entity rows.

No entity may contain a raw recovery code, normalized recovery-code input, recovery session token, resume token, draft access token, signed invitation token, raw verification token, administrative grant, password, or provider credential. `verification_token_hash`, if introduced under a later OTP/magic-link decision, is a verifier rather than a raw token and requires the same protected FLS.

### How each field record is resolved

For every proposed field, the manifest is normative and supplies: entity membership, name, type, optional format/enum, no default unless explicitly present, `required:false`, classifications, sensitive flag, FLS requirement, purpose/migration use, public projection rule, and description. Its `group` selects a policy containing canonical-state source, legacy fallback, migration behavior, admin projection, retention behavior, and test requirement. Thus every field has all sixteen required planning attributes without repeating security prose in every row below.

Definitions omit schema defaults except Prompt 2's explicit `retention_hold: false`. That optional default applies to new writes and does not make the field required or assign an expiration to legacy records.

## Common migration metadata

These 12 optional fields are planned on all four entities and are admin/backend-only:

| Field | Type/format | Classification | Purpose |
| --- | --- | --- | --- |
| `environment` | string | `backend_only`, `migration_metadata` | Separate blue/staging/green records and enforce environment filtering. |
| `test_run_id` | string | `backend_only`, `test_metadata`, `migration_metadata` | Identify synthetic records that must never enter green production. |
| `source_app_id` | string | `backend_only`, `migration_metadata`, `sensitive_pii` | First component of logical migration identity; full internal ID is allowed only in the protected row. |
| `source_entity` | string | `backend_only`, `migration_metadata` | Second component of logical migration identity. |
| `source_record_id` | string | `backend_only`, `migration_metadata`, `sensitive_pii` | Third identity component and relationship-map source ID. |
| `source_created_date` | string/date-time | `backend_only`, `migration_metadata` | Preserve authoritative source creation ordering. |
| `source_updated_date` | string/date-time | `backend_only`, `migration_metadata` | Drive incremental checkpoints and late-write overlap scans. |
| `migration_batch_id` | string | `admin_only`, `backend_only`, `migration_metadata`, `audit_metadata` | Correlate one full, delta, reconciliation, or reverse batch. |
| `migration_direction` | string | `backend_only`, `migration_metadata`, `audit_metadata` | Record blue-to-green, reconciliation, or green-to-blue direction without prematurely freezing an enum. |
| `migrated_at` | string/date-time | `backend_only`, `migration_metadata`, `audit_metadata` | Record destination reconciliation time without replacing source ordering. |
| `source_content_hash` | string | `backend_only`, `migration_metadata`, `sensitive_hash` | Detect equality, conflicts, corruption, and idempotent reruns. |
| `migration_version` | number | `backend_only`, `migration_metadata` | Select the transformation and integrity contract. |

`source_app_id + source_entity + source_record_id` is the logical migration identity. Destination Base44 IDs may differ; an external durable ID map remaps relationships. Existing local IDs remain valid. Migration utilities must reject staging app IDs and any `test_run_id` when targeting green production. Full secret-bearing configuration never belongs in these fields.

The fields support ADR-002 initial full migration, overlapping incremental deltas, final freeze delta, late-write reconciliation, and green-to-blue rollback. Every direction uses deterministic upsert, content hashes, stable checkpoints/tie-breakers, relationship validation, and fail-closed integrity reports.

## `ProFormDraft` local extension

Implementation status: **55 optional fields implemented locally and not pushed**: 43 draft-specific fields plus the 12 common migration fields. All 55 use admin read/write FLS. Existing browser payloads remain valid because `session_id` is still the only required field.

### Canonical state (7)

- `form_type` (string), `draft_schema_version` (number), and `draft_state_json` (string) identify and carry the future authoritative canonical envelope.
- `text_validation_meta_json`, `ui_draft_state_json`, and `field_change_metadata_json` (strings) preserve lossless validation/editor/conflict compatibility state.
- `credentials_json` (string) holds only approved allowlisted identity metadata; raw codes, tokens, grants, and provider secrets are prohibited.

Legacy fallback continues to use the original response, validation, touched, expanded, mapped-payload, and draft-metadata columns. The new envelope is not authoritative until later backend migration.

### Revisions and state hash (6)

- `client_revision` and `server_revision` (numbers) distinguish client-monotonic and server-authoritative revisions.
- `state_hash` (string) is the SHA-256 canonical hash projection.
- `source_tab_id` (string) is opaque and contains no PII.
- `last_sync_reason` (string) is a bounded diagnostic.
- `last_restored_at` (string/date-time) is populated later from server time.

No defaults invent revision, hash, tab, synchronization, or restoration history for legacy records.

### Recovery email (5)

- `recovery_email` (string/email), `recovery_email_lookup_hash` (string), `recovery_email_source` (string), `recovery_email_verification_status` (string), and `recovery_email_verified_at` (string/date-time).

These fields are `admin_only`/`backend_only`; email values are `sensitive_pii` and the lookup value is `sensitive_hash`. `user_email` is not copied automatically, no normalized email is public, and migration never upgrades verification.

### Recovery authorization (6)

- `recovery_code_hash` (string), `recovery_code_version` (number), `recovery_code_hint` (string), `resume_token_hash` (string), `identity_key_hash` (string), and `recovery_session_version` (number).

Only hashes, versions, and an optional non-authorizing last-four hint are retained. Raw recovery codes, resume tokens, recovery-session tokens, identity material, and admin grants are never stored or migrated.

### Draft generation and supersession (6)

- `draft_generation` (number), `previous_draft_id` (string), `replacement_draft_id` (string), `superseded_at` (string/date-time), `superseded_reason` (string), and `status_version` (number).

Clear All and Start New create a new record, link both retained records, and later mark the old record `cleared_superseded`. These fields sequence drafts within an email association and supplement rather than constrain the existing `status` string.

### Submission lock (5)

- `submitted_state_hash` and `pdf_source_state_hash` (strings), `submitted_lock_version` (number), `status_locked_at` (string/date-time), and `last_submission_error_code` (string).

They supplement `submitted_at`, `final_submission_id`, and `submit_error`. The safe error code excludes exception stacks, external response bodies, and secrets.

### Recovery-email delivery (4)

- `recovery_email_delivery_status` (string), `last_recovery_email_sent_at` (string/date-time), `recovery_email_delivery_error_code` (string), and `recovery_email_delivery_attempt_count` (number).

These admin/backend diagnostics contain no recipient, message body, raw code, provider token, credential, or response body. Email delivery is not implemented by this schema change.

### Retention (4)

- `retention_expires_at` (string/date-time), `retention_hold` (boolean, default `false`), `retention_hold_reason` (string), and `retention_policy_version` (number).

All are admin/backend-only; the reason is sensitive PII. Missing expiration/version values keep legacy records valid, no existing expiration is assigned, and no cleanup is run.

### Environment and migration (12)

The common fields in the preceding table are implemented with their planned types and admin read/write FLS. The composite source identity supports full, incremental, late-write, and reverse migration without replacing local Base44 IDs.

## `ProFormDraftEvent` extension plan

Planned count: **25** optional fields: 12 common migration fields plus 13 event-specific fields.

- `draft_id` — string; `backend_only`, `sensitive_pii`, `audit_metadata`; direct relationship to the draft, remapped during migration.
- `event_idempotency_key_hash` — string; `backend_only`, `sensitive_hash`, `audit_metadata`; event retry/replay deduplication.
- `client_revision` — number; `backend_only`, `canonical_state`, `audit_metadata`; accepted client revision.
- `server_revision` — number; same classification; resulting server revision.
- `base_server_revision` — number; `backend_only`, `audit_metadata`; mutation base revision.
- `mutation_id` — string; `backend_only`, `audit_metadata`; mutation correlation.
- `source_tab_id` — string; `backend_only`, `audit_metadata`; opaque non-PII per-tab origin.
- `event_metadata_json` — string; `backend_only`, `sensitive_pii`, `audit_metadata`; allowlisted metadata only.
- `safe_value_hash` — string; `backend_only`, `sensitive_hash`, `audit_metadata`; optional integrity comparison without projection.
- `canonical_state_hash` — string; `backend_only`, `sensitive_hash`, `audit_metadata`; links the event to accepted state.
- `retention_class` — string; `admin_only`, `backend_only`, `retention_metadata`.
- `retention_anchor_at` — string/date-time; same classification.
- `support_hold` — boolean; same classification.

Existing `session_id`, event/value fields, and browser writers remain compatible. New fields are not anonymous-writable. Events inherit draft retention, preserve platform/server order, and are deduplicated/remapped in all migration directions.

## `ProFormSubmission` extension plan

Planned count: **16** optional fields: 12 common migration fields plus 4 linkage/hash fields. The existing large `metadata` and `userdata` structures remain unchanged.

- `questionnaire_session_id` — string; `backend_only`, `sensitive_pii`, `audit_metadata`; **conditional** because runtime code already uses `metadata.questionnaire_session_id`. Do not add until one canonical source, compatibility projection, and backfill rule prevent divergent duplicates.
- `source_draft_id` — string; `backend_only`, `sensitive_pii`, `audit_metadata`; optional source-draft linkage with migration remapping.
- `submitted_state_hash` — string; `backend_only`, `sensitive_hash`, `submission_lock`; binds the final record to submitted canonical state.
- `pdf_source_state_hash` — string; `backend_only`, `sensitive_hash`, `submission_lock`; binds PDF regeneration to its exact source.

No field changes final submission payload shape by itself. Existing creators may continue sending only `metadata` and `userdata`. Migration populates linkage/hashes only when a trustworthy source exists; absence is valid for legacy records.

## `ProFormSubmissionIntake` extension plan

Planned count: **19** optional fields: 12 common migration fields plus 7 intake-specific fields.

- `source_draft_id` — string; `backend_only`, `sensitive_pii`, `audit_metadata`; optional source-draft relationship.
- `canonical_state_hash` — string; `backend_only`, `sensitive_hash`, `audit_metadata`; optional integrity linkage.
- `external_side_effects_mode` — string; `backend_only`, `audit_metadata`; safe disabled/staging/production policy result.
- `zapier_status` — number; `backend_only`, `audit_metadata`; bounded HTTP status only.
- `zapier_delivery_outcome` — string; `backend_only`, `audit_metadata`; delivered/redirected/suppressed/failed classification.
- `zapier_last_attempted_at` — string/date-time; `backend_only`, `audit_metadata`; authoritative attempt time.
- `zapier_failure_kind` — string; `backend_only`, `audit_metadata`; safe bounded failure kind.

The existing status enum, retry counters/errors, AI repair fields, `zapier_sent`, payload evidence, and linked submission ID remain intact. New diagnostics contain no destination URL, secret, provider response body, or submitted payload. Staging/test side-effect context is not copied into green.

## Migration and projection rules

1. Full, incremental, late-write, and reverse migrations use the same composite migration identity and destination relationship map.
2. Checkpoints use source server timestamps plus a stable tie-breaker and overlap window.
3. `source_content_hash` excludes destination IDs and migration bookkeeping.
4. Same-record divergence is quarantined; migration never silently applies unconditional last-write-wins.
5. Public compatibility calls continue to see/write only their existing fields until replaced by scoped backend functions.
6. Public recovery and admin APIs use explicit allowlists; they never return entity rows wholesale.
7. Admin projections include protected fields only when required for the named operation.
8. `source_app_id`, hashes, raw/normalized recovery email, internal IDs, test IDs, and migration metadata are omitted from public projections.
9. No staging app ID, `test_run_id`, malformed/load-test record, staging destination, or staging-only integration metadata may enter green.
10. Green-to-blue rollback uses reverse ID mappings and validates counts, hashes, relationships, status distributions, files, and zero unresolved errors before domain reversal.

## Validator contract

`npm run test:entity-schemas`:

- parses strict manifest JSON and all four JSONC schemas with `jsonc-parser`;
- detects duplicate keys from the JSONC syntax tree;
- verifies exact entity names, uppercase paths, top-level object shape, existing field types, required arrays, Intake enum/default, and RLS baselines;
- requires every locally implemented Draft field to exist and verifies it is optional, described, classified, nonsecret, and assigned exact admin/backend FLS;
- verifies all four entities carry the same 12 migration fields and types;
- rejects raw code/token/grant field names;
- freezes the exact 27 legacy missing-description exceptions and rejects new ones;
- verifies the pre-extension baseline hash, the implemented local Draft schema hash, and plan-only baselines for the other three entities;
- runs six focused Vitest cases covering exact Prompt 2 fields, legacy compatibility, raw-material prohibitions, and synthetic legacy/future payload validation;
- exits nonzero for every violation.

## Deferred implementation gates

No schema push is authorized by this plan. Before a later staging-only entity push:

1. Review every field against Base44 staging FLS behavior and generated types.
2. Resolve the conditional submission session linkage.
3. Keep Draft additions optional and add later entity fields only as optional while retaining exact required arrays/RLS.
4. Generate local types after schema edits.
5. Run validator, normal/canonical/identity suites, lint, typecheck, build, and staging authorization tests.
6. Export/checkpoint staging data and compare pre/post schemas.
7. Push only staging after separate authorization; never use blue production for schema experiments.
8. Keep Durable Draft V2 and public recovery disabled until later acceptance gates.

## Local implementation action statement

Prompt 2 edits only the local `ProFormDraft` schema and its validation/planning artifacts. It adds field-level admin restrictions but no entity-level RLS. It does not create or read a record, generate types, push entities, deploy code, send email, run cleanup, invoke recovery, change a domain, or enable a feature.
