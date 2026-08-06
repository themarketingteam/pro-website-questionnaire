# Legacy draft analysis and upgrade contract

Status: **IMPLEMENTED LOCALLY; DRY RUN ONLY**

Date: 2026-08-06

Migration contract version: `1`

## Scope and safety boundary

The shared migration engine analyzes exported `ProFormDraft` and
`ProFormDraftEvent` records without a Base44 client. It reconstructs a proposed
canonical state, fingerprints before/after content, classifies duplicates, and
returns patches as data. It has no entity handler, network client, deployment
entry point, or apply method.

Analysis never deletes, merges, or mutates an input record. Original Base44
`created_date` values remain the ordering authority and are never patched.
Every proposed record update carries a before fingerprint, after fingerprint,
field-specific reasons, and warning codes. Raw responses and email addresses
are prohibited from machine reports.

## Classifications

Version 1 defines:

- `already_current`
- `legacy_complete`
- `legacy_partial`
- `legacy_malformed_noncritical`
- `legacy_malformed_critical`
- `submitted_legacy`
- `submit_failed_legacy`
- `superseded_legacy`
- `duplicate_candidate`
- `manual_review_required`
- `unsupported_future_version`

Critical response/canonical corruption, unsupported future versions, unknown
lifecycle states, ambiguous duplicate evidence, invalid existing recovery
associations, and legacy payload answers without a deterministic mapping are
fail-closed. No upgrade patch is proposed for those records.

## Canonical reconstruction

Each legacy JSON compatibility column is parsed independently. A malformed
metadata, validation, touched, expanded, UI, or field-metadata field produces
a warning but cannot discard a valid `responses_json` object. A malformed
nonempty `responses_json` is critical and requires review.

The canonical envelope uses schema version 4 and preserves session, status,
question pointers, saved/submitted timestamps, final submission linkage, safe
submission error classification, and compatible identity fields. Unknown
client/server revisions become `0`. `status=draft` normalizes to `active` only
in the proposed patch. Submitted status, submission ID, submitted timestamp,
and created date are never rewritten.

When `responses_json` is empty but legacy userdata/mapped payload contains
answer-bearing data for which this engine has no verified mapping, the record
is sent to manual review. The original compatibility columns remain untouched;
an empty authoritative canonical snapshot is not written over them.

## Recovery email and no-code behavior

The approved default may copy `user_email` only when it normalizes as a valid
email and no `recovery_email` value already exists. The proposal sets:

- `recovery_email_source=migrated_legacy`
- `recovery_email_verification_status=unverified`

The analyzer does not calculate `recovery_email_lookup_hash`; the future
authorized execution function must use the server secret. An invalid existing
recovery email requires manual review and is never overwritten.

No raw recovery code, resume token, grant, or provider secret is copied into
canonical credentials. No code or token is generated. A legacy record without
a code remains eligible only for email/admin recovery after an approved
execution migration.

## Upgrade-patch rules

The patch builder fills missing canonical, compatibility, revision, hash,
environment, and migration metadata. It updates an older supported schema or
migration version, but never replaces a nonempty current field with a
reconstructed legacy value. `source_content_hash` is the before fingerprint.
The after fingerprint covers the original record plus the proposed patch.

Retention fields are intentionally absent from this first analysis increment;
the later retention-policy prompt must supply the policy version, anchor,
expiry, and hold decision.

## Duplicate analysis

Potential groups use only same session ID, final submission ID, complete source
migration identity, recovery-code hash, or bootstrap-idempotency hash. Email,
business name, and domain alone never form a group.

Submitted-like and active-like records are separate partitions. A cross-
partition group is manual review and is never merged. Within a compatible
active partition, canonical recommendation order is:

1. submitted lock/status;
2. server revision;
3. client revision;
4. valid state hash;
5. last-saved timestamp;
6. platform updated date;
7. platform created date;
8. stable record ID.

Equal-rank conflicting hashes and conflicting submission identities require
manual review. A safe active-only recommendation may mark another record as a
superseded candidate and link it to the canonical ID, but it never deletes a
record and `automaticMergeAllowed` remains false.

## Event migration

An event keeps its original `value_json` and timestamps. A missing `draft_id`
is proposed only when exact session mapping has one candidate. Multiple
candidate drafts require manual review. A missing event ID becomes a
deterministic SHA-256-derived `mig_` ID based on source record ID and migration
version. Valid JSON receives a value hash; malformed value JSON is retained
unchanged with a warning.

Proposals add environment, batch/version/source fingerprints, migrated time,
and a safe default redaction level without inventing event values.

## Safe report and CLI

`npm run migration:analyze-legacy -- --fixture` analyzes the synthetic corpus.
`--input <json-file>` accepts an offline export, `--output <report-file>` writes
mode `0600`, and `--strict` exits nonzero for critical corruption, unsupported
future versions, or ambiguous duplicates. Broad input permissions produce a
safe warning.

Reports include only record IDs, classifications, lifecycle/schema metadata,
response counts, byte sizes, hash prefixes/fingerprints, proposed field names,
warning codes, and manual-review flags. A recursive guard rejects answer or
email values before output. Neither the CLI nor shared module connects to
Base44.

## Fixture corpus and manual review

The corpus covers complete/partial active records, submitted and submit-failed
records, malformed metadata/responses, missing status, valid/invalid legacy
email, current/future states, active duplicates, submitted/active partition
conflict, an ambiguous hash group, and linked/unlinked/ambiguous events. All
values are synthetic.

Manual review is a durable result, not an analysis error to suppress. The next
prompt may add an authorized execution function, server-secret lookup hashing,
idempotent writes, checkpoints, and audit events. It must first consume a saved
dry-run report and must not silently override any manual-review decision.

No Base44 record, schema, function, secret, application, or deployment was
accessed or changed by this implementation.

## Local validation evidence

| Command / group | Result |
| --- | --- |
| `npm ci` | Exit 0; 775 packages installed, with 29 inherited advisories and six pending install-script approvals reported |
| Legacy migration and CLI suites | Exit 0; 29/29 tests passed |
| Fixture CLI and report scan | Exit 0; 17 drafts, 3 events, 3 duplicate groups, and 5 manual-review entries; mode `0600`; no synthetic answer/email leakage |
| Fixture CLI `--strict` | Exit 2 as required for critical, future-version, and ambiguous-duplicate evidence |
| Canonical-state suites | Exit 0; 105/105 tests passed |
| Identity contract and suites | Exit 0; contract passed and 126/126 tests passed |
| `npm run test:entity-schemas` | Exit 0; 27/27 tests passed |
| `npm test -- --run` | Exit 1; 1,903/1,906 passed, with the same three established unrelated geography/submission-repair failures |
| `npm run lint` | Exit 1; repository baseline remains 28 errors and 14 warnings; changed migration files have no lint error |
| `npm run typecheck` | Exit 2; existing project-wide JavaScript/dependency diagnostics remain |
| `npm run build` | Exit 0; Vite build and mandatory sensitive-bundle scan passed |

No `npx base44` command ran. No Base44 client was constructed and no cloud,
record, schema, function, secret, deployment, feature-branch push, or `main`
operation occurred.
