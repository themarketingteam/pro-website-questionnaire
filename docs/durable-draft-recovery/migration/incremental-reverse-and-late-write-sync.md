# Incremental, reverse, and late-write synchronization

- Status: implemented locally; not deployed or production-certified
- Direction contract: exactly one active direction per blue/green app pair
- Deletion contract: no destination delete in any mode

## Operation modes

The signed bundle, checkpoint, CLI, and safe report contracts recognize
`initial_full`, `incremental_delta`, `final_freeze_delta`,
`late_write_reconciliation`, `reverse_full`, `reverse_delta`,
`integrity_verify`, and `file_reference_audit`. New fields are optional so
existing full-migration checkpoints remain readable.

## Direction lease

Each pair uses a direction-independent `app_pair_key`. A lease records the
active direction, opaque lease ID and owner, acquisition, heartbeat and expiry,
both app IDs, and operation mode. Its TTL is 30–1,800 seconds (300 by default).
The same owner may heartbeat; a different or opposite runner is rejected until
expiry. Stale leases expire without a delete. Force release requires a verified
admin grant and an operator reason, and stores only lease/operator fingerprints,
the reason, timestamp, and a verification boolean—never the grant.

## Per-entity high-water checkpoint

Every entity independently records `snapshotCutoff`, `lastLogicalUpdatedAt`,
`lastSourceRecordId`, `overlapStartedAt`, `pageOffset`, `passNumber`,
`sourceCountObserved`, and `lastBundleHash`. Ordering uses Base44's server
`updated_date` and source ID as the tie-breaker. The source snapshot cutoff is
fixed for a pass; client timestamps never advance it.

The default overlap is 300 seconds and is configured by
`PRO_FORM_MIGRATION_DELTA_OVERLAP_SECONDS`. An adapter may declare native
`updated_date` sorting. Otherwise the exporter uses bounded sorted pages plus
the repeated overlap. Each pass deduplicates source IDs; subsequent overlap
passes recover rows exposed by offset shifts. Soft-delete metadata is copied
only if an entity policy explicitly contains it. No mode issues a destination
delete. A final-freeze delta is complete only after two zero-change verification
passes for every entity.

## Conflict policy

The shared conflict module recognizes:

- `source_and_destination_modified`
- `destination_native_record_collision`
- `relationship_target_missing`
- `source_fingerprint_changed_after_export`
- `destination_fingerprint_changed_before_apply`
- `submitted_state_mismatch`
- `status_regression_attempt`
- `origin_identity_collision`
- `file_reference_inaccessible`
- `unsupported_schema_version`

Equal hashes are no-ops. A newer source may update only when the destination
still equals the mapped base. Submitted-state mismatches and native destination
collisions require manual resolution. Status regression is rejected. Missing
relationship targets are deferred. When both sides changed, no answer-level or
field-level merge is attempted; metadata-only conflict evidence is quarantined.

## Reverse migration

Green-to-blue uses `reverse_full` or `reverse_delta`, an active
`green_to_blue` lease, and the exact apply phrase
`APPLY_GREEN_TO_BLUE_MIGRATION`. Green records whose origin is blue resolve to
the original blue record and are mapped without duplicating it. Green-native
records create one blue record through the reverse ID map. A blue record changed
independently since the common forward hash becomes a conflict. Submitted state
is preserved, status cannot regress, relationships are remapped, and no record
is deleted.

## Late-write reconciliation

The operator supplies server timestamps for freeze start, domain switch, blue
maintenance start, and reconciliation end. Blue rows created or updated after
the earliest cutover boundary whose current hash differs from green are processed
as `late_write_reconciliation`. Polling defaults to 60 seconds; a quiet window
defaults to 300 seconds. Both are bounded configuration. Completion requires two
full quiet windows. The safe late-write report contains timestamps, counts,
poll/quiet settings, and conflicts only.

## Local-only verification boundary

Focused tests use synthetic in-memory entities for full-to-delta-to-reverse
identity, overlap, lease, conflict and late-write behavior. No Base44 app,
production record, domain, secret, deployment, or migration apply was used.

## 2026-08-06 staging certification attempt

The 49-test delta/reverse/late-write/file-audit/integrity suite passed locally.
The required at-least-1,000-record dual-adapter run and all live staging work
were not entered because the full source suite then failed 3 of 2,091 tests.
No operational full, delta, reverse, late-write, file-audit, conflict, or
integrity verdict is certified by this attempt.
