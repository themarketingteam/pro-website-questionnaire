# Base44 entity schema rollback plan

- Status: planning only
- Date: 2026-08-05
- Source baseline commit: `50c7379c1cfc30e2d242e917b0abe951e3f75584`
- Active branch: `feature/durable-draft-recovery`
- Applies to: `ProFormDraft`, `ProFormDraftEvent`, `ProFormSubmission`, and `ProFormSubmissionIntake`

## Current baseline

The committed uppercase schema files and their planning-baseline SHA-256 values are recorded in [pro-form-field-manifest.json](./pro-form-field-manifest.json). The validator's `--plan-only` mode verifies those files are unchanged. This prompt does not push a schema anywhere.

The first future schema change must be staging-only. Blue production remains intact and green production receives no schema until the staging field/FLS/compatibility matrix passes and a separate production-candidate change is authorized.

## Pre-change checkpoint for a later staging push

Before editing or pushing staging schemas:

1. Record the exact Git commit, branch, Base44 CLI version, staging app binding, and authorized operator.
2. Confirm the target guard identifies staging and not blue/green production.
3. Export or otherwise checkpoint staging entity data and record counts/status distributions using synthetic data only.
4. Preserve the four pre-change schema files and generated type output as release evidence.
5. Capture current entity RLS and FLS from source and manually verify them in the Base44 dashboard.
6. Run `npm run test:entity-schemas -- --plan-only` before schema edits.
7. Resolve all conditional fields, especially submission session linkage, before adding them.

No production record content is used during staging rehearsal.

## Schema comparison

For each entity, compare before/after source with:

- entity name and uppercase file path;
- top-level `type: object`;
- all existing properties, nested submission metadata/userdata, descriptions, types, formats, enums, and defaults;
- exact required array;
- exact entity RLS;
- every new field's optionality, description, type/format, and admin/backend FLS;
- absence of raw recovery codes, tokens, grants, credentials, and secret-bearing configuration;
- generated types and current caller payload compatibility.

The machine validator supplies the deterministic source comparison. The Base44 dashboard supplies the manual post-push verification that source FLS/RLS was accepted as intended.

## Preferred rollback behavior

Removing an added field after records contain data may discard data, break hashes/relationships, invalidate generated clients, or create an irreversible mismatch between blue, green, and migrated records. Therefore the preferred rollback is behavioral:

1. Disable Durable Draft V2 and the affected write path.
2. Keep existing public compatibility writers on the unchanged legacy fields.
3. Stop writing the new optional fields.
4. Stop migration/backfill jobs and preserve checkpoints, ID maps, hashes, and conflict evidence.
5. Keep the optional fields and their admin/backend FLS in place.
6. Restore the previous application code and generated types if required.
7. Verify legacy record create/read/update and submission/intake behavior.
8. Diagnose and repair forward without deleting populated fields.

Production rollback must not immediately delete new fields. Field removal is a separate destructive data-change decision requiring an export, dependency inventory, proof that the fields are unused, and explicit approval.

## Future green production checkpoint

Before the first green production schema push:

1. Export/checkpoint all affected green data and record integrity counts.
2. Record the exact staging-certified Git commit and schema hashes.
3. Confirm green contains no staging app IDs, test-run IDs, test records, or staging external-side-effect metadata.
4. Confirm the blue fallback remains unchanged and reachable.
5. Confirm forward and reverse migration tooling passed representative staging rehearsals.
6. Confirm destination relationship mapping, optional-field compatibility, and FLS/RLS authorization matrices.
7. Push the schema with Durable Draft V2 and public recovery disabled.
8. Re-run dashboard/source comparisons and production-disabled smoke/security tests before any data migration or activation.

## Manual Base44 dashboard verification

After any later staging or green push, an authorized operator must verify:

1. Exactly four intended entity names remain present.
2. Existing fields and required arrays remain unchanged.
3. `ProFormSubmission.metadata` and `userdata` remain structurally intact.
4. The Intake status enum/default and retry/AI/Zapier fields remain intact.
5. Existing entity RLS is unchanged.
6. Every new sensitive, hash, migration, test, canonical, retention, and submission-lock field has admin read/write FLS.
7. Anonymous direct calls cannot set or retrieve new protected fields.
8. Service-role backend calls can use the fields through reviewed functions.
9. No raw code, token, grant, destination URL, credential, or secret field exists.
10. No unexpected field, required constraint, entity rename, or deletion occurred.

Screenshots or exports must redact app IDs, emails, record values, and secrets unless stored in the approved restricted evidence system.

## Stop conditions

Stop the schema push, migration, or activation immediately if any of these occurs:

- target environment or app identity is uncertain;
- a required array, existing type/default/enum, entity name, or existing RLS differs;
- Base44 rejects or weakens intended field-level restrictions;
- an anonymous direct call can write/read a new protected field;
- a legacy record or current public questionnaire operation becomes unreadable/unwritable;
- submission metadata/userdata or Intake lifecycle behavior changes;
- duplicate records, relationship gaps, hash mismatches, or staging contamination appear;
- the pre-change data checkpoint/export is missing;
- reverse migration or rollback evidence is incomplete;
- any command would target blue production before explicit approval.

When a stop condition occurs, preserve evidence, keep the safest environment write-disabled if data integrity is uncertain, and follow the preferred behavioral rollback. Do not delete entities or populated fields during incident response.

## Production rollback after a future cutover

Application/source rollback and data rollback are ordered under ADR-002:

1. Pause green writes and preserve green data/evidence.
2. Run and validate the green-to-blue delta from the last common checkpoint.
3. Confirm counts, hashes, relationships, files, and zero unresolved failures.
4. Move the production domain back only after reverse validation passes.
5. Keep green intact for diagnosis and late-write reconciliation.

Schema field deletion is not part of that emergency path. Optional fields can remain dormant while blue compatibility behavior resumes.

## Planning action statement

This rollback plan does not edit or push schemas, access production records, create an export, alter Base44 resources, deploy code, move a domain, or execute a rollback.
