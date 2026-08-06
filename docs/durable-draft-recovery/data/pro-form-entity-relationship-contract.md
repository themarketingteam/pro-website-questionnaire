# Pro Form entity relationship and migration contract

- Status: local schema contract; not pushed or deployed
- Date: 2026-08-05
- Scope: `ProFormDraft`, `ProFormDraftEvent`, `ProFormSubmission`, and `ProFormSubmissionIntake`

All identifiers and hashes shown here are synthetic. This contract contains no real record values, client identity, app ID, recovery code, token, grant, or external destination.

## Relationship authority

### Draft to DraftEvent

- `ProFormDraftEvent.draft_id` is the direct destination-local relationship to `ProFormDraft.id`.
- `ProFormDraftEvent.session_id` remains the required legacy relationship and is not replaced.
- New backend writers populate both when a trusted draft record exists. Readers use `draft_id` first and may fall back to `session_id` for legacy events.
- `event_id` is stable across retries and migration replay. A writer must treat a repeated `event_id` for the same logical draft as the same append, not a second event.

### Draft to Submission

- `ProFormSubmission.source_draft_id` points to the destination-local draft ID when the source relationship is trustworthy.
- Top-level `questionnaire_session_id` is protected migration/backend linkage. Existing `metadata.questionnaire_session_id`, when present, remains the compatibility value.
- A trusted writer sets both session values to the same normalized value. Readers fall back to the legacy metadata value when the top-level field is absent. If both exist and differ, processing stops and quarantines the record; neither value is silently overwritten.
- `ProFormDraft.final_submission_id` points to the destination-local `ProFormSubmission.id`. The forward and reverse ID maps must validate this inverse relationship.

### Draft to SubmissionIntake

- `ProFormSubmissionIntake.source_draft_id` points to the destination-local draft ID when known.
- Required `questionnaire_session_id` remains the legacy and current session relationship.
- `linked_submission_id`, when present, points to the destination-local final submission and must be remapped with the same ID-map checkpoint.

## Migration identity and destination mapping

The deterministic source identity is the tuple:

`source_app_id + source_entity + source_record_id`

`environment` is an isolation boundary, not a substitute for any tuple component. The migration ledger maps the tuple to a destination entity ID and stores the forward and reverse mapping outside public projections. Upsert first resolves this tuple, then compares `source_content_hash` and `migration_version`; it never assumes source and destination Base44 IDs match.

Relationship writes are deferred until the referenced destination mapping exists. A batch is incomplete while any draft/event/submission/intake relationship is unresolved.

## Legacy relationship fallback

Missing optional fields are valid:

1. Event resolution falls back from `draft_id` to required `session_id`.
2. Submission resolution falls back from top-level `questionnaire_session_id` to the existing metadata value and may remain unlinked when neither value is trustworthy.
3. Intake resolution retains required `questionnaire_session_id` and existing `linked_submission_id` semantics.
4. Migration does not invent hashes, source IDs, timestamps, or relationships for legacy records.

## Duplicate and conflict handling

- Event append deduplicates by destination draft plus stable `event_id`; migration also enforces the composite source identity.
- Entity migration performs deterministic upsert by composite source identity. Multiple destination records for one identity are quarantined.
- Equal content hashes are idempotent. Differing hashes are a conflict requiring an explicit reconciliation decision; unconditional last-write-wins is prohibited.
- A top-level/metadata submission session mismatch, cross-entity relationship mismatch, or duplicate final-submission link is a blocking integrity error.

## Late-write reconciliation

Incremental and final reconciliation use source server timestamps, a stable record-ID tie-breaker, and an overlap window. A late source write is transformed with the same migration version, compared by composite identity/content hash, and applied only after related destination mappings resolve. Event order uses authoritative source/platform order plus stable `event_id`; client timestamps alone are never authoritative.

## Reverse migration

Green-to-blue rollback uses the reverse ID map and the same tuple, hashes, transform version, duplicate rules, and relationship checks. Reverse migration restores destination-local `draft_id`, `source_draft_id`, `final_submission_id`, and `linked_submission_id` values; it never copies a green local ID directly into blue. Domain reversal is blocked until counts, hashes, relationships, status distributions, and unresolved-error totals pass.

## Environment isolation

No relationship may cross `blue`, `staging`, or `green` boundaries. A destination-green run rejects staging source app IDs, any `test_run_id`, synthetic/load-test records, and staging-only side-effect context. `zapier_suppressed` and `zapier_redirected` are diagnostics only; neither means `zapier_sent: true`, and no destination URL is stored or migrated.

## Synthetic examples

```json
{
  "draft": {"id": "draft-green-synthetic", "session_id": "session-synthetic", "final_submission_id": "submission-green-synthetic"},
  "event": {"draft_id": "draft-green-synthetic", "session_id": "session-synthetic", "event_id": "event-synthetic-001"},
  "submission": {"source_draft_id": "draft-green-synthetic", "questionnaire_session_id": "session-synthetic"},
  "intake": {"source_draft_id": "draft-green-synthetic", "questionnaire_session_id": "session-synthetic", "linked_submission_id": "submission-green-synthetic"}
}
```

```json
{
  "source_identity": {
    "source_app_id": "app-source-synthetic",
    "source_entity": "ProFormSubmission",
    "source_record_id": "record-source-synthetic"
  },
  "destination_id": "submission-green-synthetic",
  "environment": "green",
  "source_content_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "migration_version": 1
}
```
