# Legacy migration execution and checkpoint contract

Status: **IMPLEMENTED LOCALLY; NOT DEPLOYED OR RUN AGAINST BASE44 DATA**

Date: 2026-08-06

Migration version: `1`

## Authorization and dry-run gate

All four entry points use the persistent admin recovery grant boundary before
service-role entity access. `analyzeProFormLegacyMigration` accepts only
`dryRun=true`; it pages through drafts and events, emits the existing safe
analysis report, and writes only an admin-only checkpoint. It never updates a
draft/event record.

A complete dry run produces a rolling SHA-256 report hash and may issue an
apply token only when `PRO_FORM_MIGRATION_APPLY_SECRET` is configured. The
HMAC-SHA-256 token is scoped to `admin:migration-apply`, exact environment,
migration name/version, batch, report hash, maximum record count, and a hash
of the admin grant token ID. It expires after exactly two hours. Its hash and
first-use timestamp are stored so one issuance can resume the same bounded
batch but cannot authorize a different checkpoint. Raw tokens/grants are never
stored.

## Repository and checkpoint rules

`ProFormMigrationCheckpoint` requires the migration name, environment,
version, and batch ID. It stores only safe phases, opaque cursors, counts,
hashes, timestamps, and safe error codes under admin-only CRUD RLS.

Repository pages default to 50 and cap at 200. Ordering is `created_date`,
then stable record ID. Each cursor includes its prior anchor; a changed anchor
fails closed. Apply re-reads every record and compares the dry-run fingerprint
before a partial update. Changed/manual-review records are skipped, and an
already stamped batch/version is idempotently skipped. No repository delete
method exists; patches cannot change creation or submission locks.

## Apply, duplicate resolution, and rollback

`applyProFormLegacyMigration` requires the admin grant, completed checkpoint,
matching report hash, matching apply-token hash/claims, and approved maximum
count. It rebuilds each patch from current data and advances cursors per page.

`applyProFormDuplicateResolution` requires explicit record IDs, canonical ID,
per-record fingerprints, controlled reason `legacy_duplicate_resolution`, and
an idempotency key, plus the matching apply token/checkpoint. It never merges
or deletes. It refuses to mark a submitted
record superseded by an active record, uses existing `replacement_draft_id`
lineage on eligible active records, and appends a redacted audit event.

`rollbackProFormLegacyMigration` requires apply authorization and clears only
batch-owned additive migration/backfill fields. It never erases answers,
submission locks, final-submission linkage, or creation dates. Submitted or
current schema-v4 records, verified associations, and migrated recovery email
already used for lookup/delivery remain for manual review. It never deletes.

## Operational sequence and gates

1. Configure an independent apply secret only in a separately authorized
   staging change.
2. Complete every dry-run page and review its final hash/count/manual results.
3. Apply bounded pages with the exact token/checkpoint; retry resumes safely.
4. Resolve duplicates only after human approval and exact fingerprints.
5. Use limited rollback only for safe additive fields within token validity.

Focused tests cover token scope/expiry/tampering, report/environment binding,
checkpoint resume, page limits, cursor drift, fingerprints, idempotency,
changed-record skips, submitted guards, audit creation, and limited rollback.

No `npx base44` command, schema push, function deployment, secret operation,
record read/write, production access, or remote Git push occurred. Live
staging RLS, real-data dry run, interruption rehearsal, reconciliation,
operator review, retention execution, and reverse migration remain required.

## 2026-08-06 staging certification attempt

The [combined staging report](./staging-legacy-migration-and-retention-certification.md)
is **LEGACY_MIGRATION_AND_RETENTION_FAILED**. Local focused migration tests
passed, but the full normal suite failed and triggered the mandatory hard
stop. No Base44 authentication, secret, entity, function, checkpoint, record,
dry run, apply, duplicate resolution, rollback, cleanup, production action, or
remote push occurred. This contract remains source-only.
