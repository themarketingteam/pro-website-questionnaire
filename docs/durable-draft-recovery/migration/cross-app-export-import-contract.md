# Cross-app export and import contract

- Status: implemented locally; not deployed or configured
- Bundle version: 1
- Supported directions: `blue_to_green`, `green_to_blue`
- Transfer mode: bounded signed JSON held in process memory

## Configuration and authorization

Each participating app must independently configure the ten reserved backend
names documented in the secret inventory. The local app ID, role, exact peer
allowlists, direction allowlist, batch/byte limits and environment all fail
closed. The default maximum is 100 records, 1 MiB and 60 seconds of clock
skew. Missing local identity, same-app routes, unknown peers, wrong roles,
unsupported directions and production/staging crossing are rejected before an
entity read.

Every endpoint first verifies the password-issued persistent admin grant using
the existing admin request boundary. It then verifies a purpose-separated
HMAC migration authorization. An `orchestrate` authorization can be narrowed
to endpoint scope and entity and is additionally bound to the exact signed
bundle hash for import. The authorization, admin grant, Base44 token and
cross-app secret are never embedded in a bundle.

## Signed bundle

`proFormMigrationBundle` uses stable key ordering, SHA-256 content hashes and
HMAC-SHA-256 with purpose `pro-form:cross-app-migration-bundle:v1:`. The
signature covers every field except `signature`; `bundleContentHash` covers
the unsigned content excluding itself. Validation checks version, route,
environments, entity homogeneity, record count, byte size, timestamps,
sequence and `previousBundleHash`.

Each record envelope carries source/origin identity and time, the policy
projection hash and full approved `data`. Full data—including continuity
hashes and answers—exists only in the signed response and process memory.
Diagnostics expose counts, safe identifiers and hashes, never `data`.

## Source export

`exportProFormMigrationBatch` uses stable ascending Base44 creation order, an
anchored opaque cursor, a fixed snapshot cutoff and the configured record and
byte limits. The runtime policy contains an explicit allowlist copied from
each migratable schema; unknown fields fail rather than entering a bundle.
Platform fields, migration bookkeeping, raw grants, raw recovery codes, raw
resume tokens and security configuration are excluded. Recovery-code and
resume-token hashes remain protected migratable record data for continuity.

Production export excludes every `test_run_id`. Non-production fixtures
require matching staging/test environments plus explicit fixture controls.
The source checkpoint contains only cursor, counts, phase and safe chain
metadata.

## Destination import and conflicts

`importProFormMigrationBatch` verifies bundle signature, content, route and
authorization before any entity operation. Dry run is the default. Apply is
accepted only with an authorization bound to the exact bundle hash. Sequence,
previous hash and nondecreasing dependency order are checked against the
environment-local checkpoint.

The importer searches only the exact tuple
`source_app_id + source_entity + source_record_id` and its ID-map entry. It
never matches email, session/business name or domain. A missing identity is
created; equal content is unchanged; changed source content updates only when
the destination still matches the last mapped base. Independent destination
change creates a content-free `ProFormMigrationConflict`. No source or
destination record is deleted.

## ID maps and relationships

Every applied create/update records one `ProFormMigrationIdMap` with source,
destination and origin identity, source/destination hashes and finalization
state. Initial records may temporarily retain source relationship IDs.
Finalization resolves draft lineage, event draft, submission draft, intake
draft/submission and final-submission references through ID maps.

Finalization rereads the destination and refuses a patch when its relationship
or update fingerprint changed. Missing mappings remain unresolved; independent
changes become safe conflicts. The operation is idempotent. Cutover requires
zero unresolved and zero open conflicts.

## Security boundary

Responses are `no-store`. Functions have no bundle logger and return only safe
summaries from import/finalize/status. The orchestrator never writes a bundle
to disk. Encrypted export is deliberately blocked until an independently
reviewed encryption implementation exists. This source implementation did not
read or migrate data, create an app, configure a variable, push a schema,
deploy a function or contact production.

## 2026-08-06 staging certification attempt

The focused signed-bundle and export/import policy suites passed 31/31 tests,
but the mandatory full source suite failed 3 of 2,091 tests. The attempt stopped
before live staging configuration or invocation. The contract therefore has no
new live authorization, RLS, signature, replay, pagination, relationship, or
cleanup evidence, and no cross-app import has occurred. See the
[certification report](./staging-migration-utility-certification.md).
