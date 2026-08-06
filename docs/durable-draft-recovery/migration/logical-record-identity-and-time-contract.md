# Logical record identity and time contract

- Status: implemented locally; not deployed
- Runtime helpers: `src/lib/proFormLogicalRecordTime.js` and `base44/functions/_shared/proFormLogicalRecordTime/entry.ts`
- Hash helpers: `src/lib/proFormMigrationContentHash.js` and `base44/functions/_shared/proFormMigrationContentHash/entry.ts`

## Origin and immediate source

`origin_*` identifies the first known app/entity/record and its historical timestamps. It is assigned on the first migration and preserved on every later hop. `source_*` identifies the immediate migration source and changes at each hop.

For first blue-to-green migration, absent origin metadata defaults to the blue app/entity/record and blue logical timestamps. For green-to-blue rollback, origin remains blue while source becomes the green identity. All origin fields are optional and admin-only so legacy records remain valid and public callers cannot forge ordering.

## Logical creation time

Creation priority is:

1. valid `origin_created_at`;
2. valid `source_created_date`;
3. valid destination `created_date`.

Destination import time is never historical business creation time. Invalid candidates produce safe warning codes and do not expose the candidate value.

Email recovery sorts eligible drafts by logical creation time descending. Equal times use `origin_record_id`, then `source_record_id`, then destination `id`, each in stable descending bytewise order. An older blue record imported after a native green draft therefore stays older.

## Logical update time

A valid `origin_updated_at` is used only when no valid immediate source update is newer. A newer `source_updated_date` wins and emits the safe `SOURCE_UPDATE_NEWER_THAN_ORIGIN` diagnostic. Destination `updated_date` is a fallback. `last_saved_at` is considered only when an entity policy caller explicitly opts in.

The helpers return normalized ISO timestamps, comparators and safe metadata without modifying records.

## Deterministic migration hash

The policy-driven projection deep-copies a record, removes server-managed and hash-excluded bookkeeping, sorts object keys recursively and preserves array order. Relationship values may be replaced with their logical mapped identity before hashing. The serializer is never logged.

`hashMigratableRecord` computes SHA-256. `compareMigratableRecords` returns only equality and hashes. A hash does not authorize migration, select an environment or resolve a conflict.

## ID map and conflict handling

`ProFormMigrationIdMap` binds immediate source, destination and original identities and records source/destination hashes plus relationship-finalization state. Its six source/destination identity fields are required and all operations are admin-only.

`ProFormMigrationConflict` stores only opaque identities, hashes, revisions, status, timestamps and safe diagnostics. It contains no record payload, raw PII, answer, code, token or file content. Divergent bidirectional changes require explicit policy resolution; no unconditional last-write-wins rule exists.

## Safety boundary

Only protected migration bundles and authorized process memory may carry full payloads. Summaries, logs and conflict records remain content-free. Migration is upsert-only and preserves submitted state; no source deletion or answer merge is permitted. Staging and synthetic test records are excluded from production targets.
