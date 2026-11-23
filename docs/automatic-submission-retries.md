# Pro submission retries

The client registers a private, durable submit intent before its required final draft save. The retry job freezes the answer map and confirmed client identity. Mapping uses the same deterministic serializer as the browser; the worker does not run AI or repair answers.

## Timing

After a failed attempt, the due time is the start of the failure's hour plus two hours. For example, 3:33 PM Central is due at 5:00 PM. Repeated failure reports from the same browser do not postpone a future due time. The admin-only hourly worker processes overdue jobs as well as jobs due at the current boundary, with a 30-job safety bound and a remaining count.

`processProSubmissionRetries` defaults to a read-only inventory. Execution requires `{ "dryRun": false }` from an authenticated Base44 admin. The native workflow must run as its admin creator, hourly at minute zero. A policy ID or body flag never grants authorization.

## Separate submission and delivery

A source-draft entity lease serializes final saves, receipt creation, public delivery, manual retries, legacy endpoint aliases, and worker processing. A retry first reuses or creates the exact matching durable receipt, then delivers its frozen wire payload. Receipt creation includes a pending-delivery marker and frozen raw/wire data in the same write, allowing a missing retry job to be reconstructed without treating older receipts as unsent.

Known HTTP 5xx, 408, and 429 responses are rescheduled. Confirmed HTTP acceptance is terminal for automatic work. Network timeouts, interrupted HTTP calls, or uncertain acceptance writes become `delivery_unknown`; they require team review because the current downstream workflow does not prove end-to-end deduplication. Stable delivery-key headers are supplied, but are not treated as proof of deduplication.

A protected explicit team redelivery is a separate job and never silently reopens an accepted or uncertain automatic attempt. Both endpoint names, including historical `/entry` aliases, use the same shared handlers.

## Source preservation

The worker uses the explicit frozen attempt, never the latest draft as an implicit submission. A newer validated, secured explicit intent supersedes older unsubmitted attempts for the same source/session. A monotonic admission sequence is retained atomically with the new job; receipt creation and the worker also check that sequence, so an interrupted cancellation cannot revive an older attempt. Prior snapshots remain retained, and delivery-started, receipt-linked, accepted, manually held, or uncertain attempts are not cancelled. A newer admitted intent remains a barrier if it later requires review; an old cancelled callback cannot reactivate its snapshot. If a final save failed before materialization, restoration is allowed only for a new secured submit intent whose captured baseline identity, raw answers, and revision are unchanged. A pending retained revision must have the same frozen answers and identity. Later edits, identity conflicts, invalid schema, or content-integrity failures are held for review. Existing completed questionnaires stay read-only.

Synthetic/test domains, DO NOT DELIVER records, archived/deleted records, and investigation/retention/delivery holds are excluded at delivery. Historical failed drafts without stable attempt provenance and explicit old delivery-failure events are inventoried as review holds; missing delivery fields on old accepted receipts never trigger replay.

## Deployment resources

Deploy the admin-only `ProSubmissionRetryJob` entity and additive optional retry fields on `ProFormSubmission`. Deploy register/process, sync, durable/fallback, recovery-query, repair, canonical delivery/manual retry, and both legacy aliases before publishing the updated frontend. No customer answer migration is required.

The recovery workspace shows the selected source's status, next retry, attempts, and last error. The local preview records local-only intent checkpoints and continues to block remote webhook delivery.
