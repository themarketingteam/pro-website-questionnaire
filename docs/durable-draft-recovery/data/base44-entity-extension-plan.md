# Base44 Pro Form entity extension and compatibility plan

- Status: four Pro Form extensions plus draft-recovery admin-only RLS implemented locally; no entity schema pushed
- Date: 2026-08-05
- Planning baseline: `50c7379c1cfc30e2d242e917b0abe951e3f75584`
- Prompt 2 implementation baseline: `8b5aac603bb9c568b7bdc726423852c4e146582a`
- Prompt 3 implementation baseline: `6cc798f01551b93c1a4ccaeb699f78b8935e4b5c`
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

They are not renamed. The local foundation now has 71 optional protected properties on `ProFormDraft`: the prior 64 extensions plus seven Clear All/Start New transaction fields. Prompt 3 added 25 to `ProFormDraftEvent`, 16 to `ProFormSubmission`, and 18 to `ProFormSubmissionIntake`. The schemas retain every existing field, required array, nested submission object, enum/default, and entity-level RLS. Current public compatibility payloads remain valid, while every new field is restricted to admin read/write.

The manifest is deliberately stored under `docs/durable-draft-recovery/data`, outside `base44/entities`. It is strict JSON but is not a Base44 entity resource and cannot be included by an entity-directory push. No types are generated because these local schema changes are not pushed or deployed.

### Recovery security-event addition

`base44/entities/ProFormRecoverySecurityEvent.jsonc` is a new endpoint-free,
admin-only security-event schema. Its required fields are only `request_id` and
`environment`; its attempt/outcome values, purpose-separated abuse hashes,
CAPTCHA booleans, bounded window counts, temporary lockout timestamps, policy
version, test marker, and common migration metadata are allowlisted explicitly.
Entity create/read/update/delete require role `admin`, which includes reviewed
Base44 service-role operations. Recovery-email lookup and draft linkage also
carry explicit admin field security.

The entity has no raw email, network address, random device ID, recovery code,
CAPTCHA token, request body, answer content, or recovery-session token field.
It is cataloged separately under `securityEntities` in the field manifest so
the four legacy compatibility baselines remain immutable. The focused schema
runner now includes its contract test. No schema was pushed.

### Future email-verification attempt addition

`base44/entities/ProFormEmailVerificationAttempt.jsonc` is an additive,
optional admin-only entity for disabled future OTP and magic-link verification.
Its 29 unique fields contain only opaque IDs, method/status/times/counters, the
existing recovery-email lookup HMAC, a purpose-bound verification-value HMAC,
optional device/IP HMACs, an allowlisted redirect-path hash, safe delivery
diagnostics, test metadata, and common migration metadata. It contains no raw
email, OTP, magic token, IP/device value, redirect URL, body, credential, or
recovery session.

The local schema and field-manifest entry are implemented but not pushed.
Entity create/read/update/delete is admin-only, and sensitive hashes/provider
IDs also declare admin-only field rules. Later activation requires live staging
RLS/FLS and atomic one-time-consumption certification.

## Current compatibility baseline

### 2026-08-06 draft-recovery RLS hardening addendum

`ProFormDraft` and `ProFormDraftEvent` now declare local entity-level
create/read/update/delete rules requiring `role=admin`. The existing field
extensions and FLS are unchanged. Public and password-grant flows use scoped
backend functions with `asServiceRole` only after their request-specific
validation/authorization boundary. `ProFormRecoverySecurityEvent` and
`ProFormEmailVerificationAttempt` were already admin-only and remain unchanged.
`ProFormSubmission` and `ProFormSubmissionIntake` are explicitly excluded and
byte-frozen by tests. See the
[RLS contract](../security/base44-draft-entity-rls-contract.md).

| Entity | Existing top-level fields | Existing required array | Repository RLS/FLS | Current compatibility callers |
| --- | ---: | --- | --- | --- |
| `ProFormDraft` | 30 original + 71 local optional extensions | `session_id` | Local admin-only entity RLS; all 71 new fields use admin read/write FLS | Scoped backend functions use service role after authorization; no browser entity CRUD |
| `ProFormDraftEvent` | 12 original + 25 local optional extensions | `session_id` | Local admin-only entity RLS; all new fields use admin read/write FLS | Backend event append uses service role after exact-draft authorization; no browser entity create |
| `ProFormSubmission` | 2 original large objects + 16 local optional extensions | `metadata`, `userdata` | Existing creator/admin entity RLS unchanged; all new fields use admin read/write FLS | Existing submission payload remains compatible; trusted backend/migration owns linkage fields |
| `ProFormSubmissionIntake` | 33 original + 18 local optional extensions | `questionnaire_session_id` | Existing admin-only entity RLS unchanged; all new fields use admin read/write FLS | Existing fallback/retry/repair behavior remains compatible |

Compatibility findings:

- `ProFormDraft.status` is an unconstrained existing string. This plan does not add an enum to it, because existing values such as `draft` must remain readable while lifecycle normalization occurs in backend code.
- `ProFormSubmissionIntake.status` retains exactly `submitted`, `received_intake`, `retry_pending`, `retry_success`, `retry_failed`, and `abandoned`, with default `received_intake`.
- `ProFormSubmission.metadata` and `userdata` are preserved without restructuring.
- Runtime backend code already writes/searches `metadata.questionnaire_session_id`. The new optional top-level value is migration/backend linkage only: trusted writers set both to the same normalized value when both are present, readers fall back to the legacy metadata value, and mismatches are quarantined rather than silently repaired.
- Direct browser draft/event operations have been retired. Restrictive local RLS is not deployable until scoped backend paths are staging-certified in the later authorized prompt.
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

Definitions omit schema defaults except explicit `retention_hold: false`, `zapier_suppressed: false`, and `zapier_redirected: false`. Defaults affect new writes only and do not make fields required or rewrite legacy records.

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

Implementation status: **71 optional fields implemented locally and not pushed**: 59 draft-specific fields plus the 12 common migration fields. All 71 use admin read/write FLS. Existing browser payloads remain valid because `session_id` is still the only required field. The latest seven fields support recoverable replacement transactions and incomplete-replacement email exclusion.

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

### Authoritative API idempotency (5)

- `bootstrap_idempotency_key_hash`, `last_save_idempotency_key_hash`, and `last_event_batch_idempotency_key_hash` are keyed hashes computed by future backend functions with the separately configured `PRO_FORM_IDEMPOTENCY_SECRET`; raw client idempotency keys are never stored.
- `last_save_request_id` and `last_event_batch_request_id` are safe server-generated correlation IDs for the last accepted operations.

All five fields are optional, admin/backend-only, and locally defined but not pushed. They do not change current direct-browser compatibility behavior.

### Draft generation and supersession (6)

- `draft_generation` (number), `previous_draft_id` (string), `replacement_draft_id` (string), `superseded_at` (string/date-time), `superseded_reason` (string), and `status_version` (number).

Clear All and Start New create a new record, link both retained records, and later mark the old record `cleared_superseded`. These fields sequence drafts within an email association and supplement rather than constrain the existing `status` string.

### Submission lock (5)

- `submitted_state_hash` and `pdf_source_state_hash` (strings), `submitted_lock_version` (number), `status_locked_at` (string/date-time), and `last_submission_error_code` (string).

They supplement `submitted_at`, `final_submission_id`, and `submit_error`. The safe error code excludes exception stacks, external response bodies, and secrets.

### Recovery-email delivery (8)

- `recovery_email_delivery_status` (string), `last_recovery_email_sent_at` (string/date-time), `recovery_email_delivery_error_code` (string), and `recovery_email_delivery_attempt_count` (number).
- `recovery_email_delivery_idempotency_hash` (string), `recovery_email_delivery_purpose` (string), `recovery_email_provider_message_id` (string), and `recovery_email_last_request_id` (string).

These optional admin/backend diagnostics contain no recipient, message body,
raw code, provider token, credential, or response body. The idempotency value
is a purpose-keyed hash; purpose/error/request values are bounded safe codes or
opaque IDs; provider message ID is backend/admin-only. The source transport has
no schema writer. The source-only authorized delivery coordinator now updates
only these fields through an `updated_date`/status/server-revision compare-and-
set, leaving canonical state and `server_revision` unchanged. Same-key `sent`
requests are replay-safe; failed delivery uses bounded backoff/attempts; an SES
success followed by metadata failure is treated as uncertain and not blindly
retried. This schema remains unpushed.

### Retention (4)

- `retention_expires_at` (string/date-time), `retention_hold` (boolean, default `false`), `retention_hold_reason` (string), and `retention_policy_version` (number).

All are admin/backend-only; the reason is sensitive PII. Missing expiration/version values keep legacy records valid, no existing expiration is assigned, and no cleanup is run.

### Environment and migration (12)

The common fields in the preceding table are implemented with their planned types and admin read/write FLS. The composite source identity supports full, incremental, late-write, and reverse migration without replacing local Base44 IDs.

## `ProFormDraftEvent` local extension

Implementation status: **25 optional fields implemented locally and not pushed**: 12 common migration fields plus 13 event-specific fields.

- `draft_id` — string; `backend_only`, `sensitive_pii`, `audit_metadata`; direct relationship to the draft, remapped during migration.
- `event_id` — string; `backend_only`, `audit_metadata`; stable retry-safe append and deterministic migration idempotency key.
- `client_revision` — number; `backend_only`, `canonical_state`, `audit_metadata`; accepted client revision.
- `server_revision` — number; same classification; resulting server revision.
- `source_tab_id` — string; `backend_only`, `audit_metadata`; opaque non-PII per-tab origin.
- `mutation_id` — string; `backend_only`, `audit_metadata`; mutation correlation.
- `event_metadata_json` — string; `backend_only`, `sensitive_pii`, `audit_metadata`; allowlisted metadata only.
- `value_hash` — string; `backend_only`, `sensitive_hash`, `audit_metadata`; optional integrity comparison without projecting the value.
- `redaction_level` — string; `admin_only`, `backend_only`, `audit_metadata`; records full, summarized, or omitted value evidence without freezing an enum.
- `admin_actor_hash` — string; `admin_only`, `backend_only`, `sensitive_hash`, `audit_metadata`; future audit actor reference without raw identity.
- `retention_expires_at` — string/date-time; `admin_only`, `backend_only`, `retention_metadata`.
- `retention_hold` — boolean, default `false`; same classification.
- `retention_hold_reason` — string; `admin_only`, `backend_only`, `sensitive_pii`, `retention_metadata`.

Existing `session_id`, event/value fields, and browser writers remain compatible. New fields are not anonymous-writable. Events inherit draft retention, preserve platform/server order, and are deduplicated/remapped in all migration directions.

## `ProFormSubmission` local extension

Implementation status: **16 optional fields implemented locally and not pushed**: 12 common migration fields plus 4 linkage/hash fields. The existing large `metadata` and `userdata` structures remain unchanged.

- `questionnaire_session_id` — string; `backend_only`, `sensitive_pii`, `audit_metadata`; optional top-level migration linkage governed by the equality/fallback/quarantine rule above.
- `source_draft_id` — string; `backend_only`, `sensitive_pii`, `audit_metadata`; optional source-draft linkage with migration remapping.
- `submitted_state_hash` — string; `backend_only`, `sensitive_hash`, `submission_lock`; binds the final record to submitted canonical state.
- `pdf_source_state_hash` — string; `backend_only`, `sensitive_hash`, `submission_lock`; binds PDF regeneration to its exact source.

No field changes final submission payload shape by itself. Existing creators may continue sending only `metadata` and `userdata`. Migration populates linkage/hashes only when a trustworthy source exists; absence is valid for legacy records.

## `ProFormSubmissionIntake` local extension

Implementation status: **18 optional fields implemented locally and not pushed**: 12 common migration fields plus 6 intake-specific fields.

- `source_draft_id` — string; `backend_only`, `sensitive_pii`, `audit_metadata`; optional source-draft relationship.
- `canonical_state_hash` — string; `backend_only`, `sensitive_hash`, `audit_metadata`; optional integrity linkage.
- `submitted_state_hash` — string; `backend_only`, `sensitive_hash`, `submission_lock`; binds retry/repair evidence to the submitted state.
- `zapier_suppressed` — boolean, default `false`; `backend_only`, `audit_metadata`; intentional suppression that never implies sent.
- `zapier_redirected` — boolean, default `false`; `backend_only`, `audit_metadata`; approved non-production redirection without destination data.
- `zapier_status` — string; `backend_only`, `audit_metadata`; safe bounded delivery status without response content.

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

- parses strict manifest JSON and all six JSONC schemas with `jsonc-parser`;
- detects duplicate keys from the JSONC syntax tree;
- verifies exact entity names, uppercase paths, top-level object shape, existing field types, required arrays, Intake enum/default, and RLS baselines;
- requires every locally implemented field to exist and verifies it is optional, described, classified, nonsecret, and assigned exact admin/backend FLS;
- verifies all four entities carry the same 12 migration fields and types;
- rejects raw code/token/grant field names;
- freezes the exact 27 legacy missing-description exceptions and rejects new ones;
- verifies each pre-extension baseline, the preserved existing-property hash, and each implemented local schema hash;
- runs focused Vitest coverage for the four migration schemas, both optional
  security/framework schemas, and six strict synthetic legacy/extended fixtures;
- exits nonzero for every violation.

## Deferred implementation gates

No schema push is authorized by this plan. Before a later staging-only entity push:

1. Review every field against Base44 staging FLS behavior and generated types.
2. Verify the submission top-level/metadata equality and mismatch-quarantine rule in staging backend writers.
3. Keep every addition optional while retaining exact required arrays/RLS.
4. Generate local types only in the separately authorized staging workflow.
5. Run validator, normal/canonical/identity suites, lint, typecheck, build, and staging authorization tests.
6. Export/checkpoint staging data and compare pre/post schemas.
7. Push only staging after separate authorization; never use blue production for schema experiments.
8. Keep Durable Draft V2 and public recovery disabled until later acceptance gates.

## Local implementation action statement

The earlier entity-extension Prompts 2 and 3 edited only the four local entity
schemas and their validation/planning artifacts. They added field-level admin
restrictions without altering entity-level RLS. The later RLS-hardening
increment adds local admin-only entity rules to `ProFormDraft` and
`ProFormDraftEvent`; it leaves both submission schemas byte-for-byte unchanged.
None of these local increments creates or reads a record, generates types,
pushes entities, deploys code, sends email, runs cleanup, invokes recovery,
changes a domain, or enables a feature.

The 2026-08-06 SES source prompt adds four optional delivery fields and updates
the manifest/hash/tests locally. It does not push this schema, write any field,
configure AWS, deploy a function, or send email.

The 2026-08-06 authorized-delivery source prompt adds a function that will use
the existing eight fields and event schema after a separately authorized
deployment. Local injected tests write only synthetic in-memory records. No
entity schema, cloud record, or canonical revision changed in this prompt.

## Staging certification attempt

The 2026-08-05 Prompt 4 attempt is classified **ENTITY_EXTENSIONS_BLOCKED**. On candidate `9ca8e6478facd6d5cfa1e2f51986ba12fc1a26d1`, dependency installation passed and the schema validator/focused suite passed 18/18, but the full normal suite failed 5 of 780 tests. The required hard stop fired before staging checkout update, authentication in that checkout, target guard, record inventory, entity push, type generation, CRUD, field-level-security testing, browser compatibility smoke, or cleanup.

The four extended schemas therefore remain local-only. No staging or production entity was read or mutated, no deleted-entity count was observed, and no generated type or deployed compatibility claim is available. See the [blocked staging entity schema certification](staging-entity-schema-certification.md).

## Legacy migration analysis version 1

The [legacy analysis contract](../migration/legacy-draft-analysis-and-upgrade-contract.md)
implements offline reconstruction and patch planning against the existing
optional canonical, identity, event, environment, and migration fields. It
does not add or push a schema. Retention metadata remains deferred to the later
policy increment.

The engine never overwrites nonempty current fields, created dates, submitted
locks, final submission IDs, or raw event values. It proposes no patch when
answer mapping, future version, recovery association, or duplicate evidence is
ambiguous. No Base44 record was read or changed.

## Resumable migration checkpoint addition

`ProFormMigrationCheckpoint` is a local-only, admin-only operational entity.
Its four required identity fields are `migration_name`, `environment`,
`migration_version`, and `batch_id`. Optional phase/cursor/count/fingerprint
fields support dry-run-first analysis and resumable bounded apply work. Only
one-way apply-token and admin-grant-token-ID hashes may be stored; raw grants,
tokens, record payloads, answers, and email values are prohibited.

The entity is cataloged under `securityEntities` so the frozen four-entity
compatibility manifest and their common-field validator remain unchanged. No
schema push or type generation is authorized by this addition.

## One-year retention checkpoint extension

The retention runner reuses `ProFormMigrationCheckpoint`; it does not add a
seventh entity. Optional `retention_cutoff`, `retention_policy_version`,
`retention_report_hash`, `retention_apply_index`, and one-way retention apply
token hash/used-at fields distinguish the fixed dry-run approval from
resumable apply work. `ProFormRecoverySecurityEvent` gains allowlisted
retention/admin operation and outcome values for content-free audit evidence.
All changes remain local-only and admin-only. No schema was pushed and no
record was created, read, updated, or deleted.
