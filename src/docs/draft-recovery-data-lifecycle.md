# Draft Recovery Data Lifecycle

## Admin reads

The draft-recovery page reads `ProFormDraft`, `ProFormSubmissionIntake`, and standalone `ProFormSubmission` records through the protected `queryDraftRecoveryRecords` backend function.

- List requests are filtered and paginated on the server.
- The UI requests 25 records per page; the backend enforces a maximum of 50.
- List responses contain only the fields needed to render record summaries.
- Large response, payload, diagnostic, and PDF data is fetched only when an administrator expands a specific record.
- Search covers business name, domain, user email, and session ID without loading all records into the browser.
- The backend requires either an authenticated Base44 administrator or a valid signed draft-recovery grant.

## Retention policy

The `archiveRecoveryRecords` automation runs daily at `07:15 UTC`.

- Drafts, fallback intakes, and final submissions remain active for at least 1,095 days after their latest meaningful server-side activity.
- After 1,095 days of inactivity, records are archived indefinitely.
- Archiving sets `archived_at` and `archive_reason`; it does not delete the source record.
- Archived records remain available through the recovery page's **Archived Records** filter.
- Administrators use reversible soft deletion. Entity-level permanent deletion is disabled for retained questionnaire data.
- A resumed, authorized draft is reactivated and receives a new 1,095-day active-retention window.
- Standalone final submissions are available on the recovery page alongside drafts and fallback intakes.
- Independent encrypted S3 backups remain disabled until the required bucket secrets pass readiness checks and the initial full backup completes.

The policy never automatically deletes records. Soft-deleted records remain retained and restorable.

## Independent backup

`backupProQuestionnaireRetention` incrementally writes immutable, fingerprinted record envelopes and referenced PDF/image/file binaries to the configured company S3 bucket. Each object uses SSE-KMS and receives a SHA-256 integrity hash. `verifyProQuestionnaireRetentionBackup` validates record and binary hashes; `restoreProQuestionnaireRetentionBackup` defaults to a dry run and refuses to overwrite an existing or newer database record.

Objects use the key layout `contentDraftEntry/<Business_Name>/<YYYY-MM-DD>/...`. The date is the original draft creation date whenever the record can be linked to its draft. Records without resolvable business or start-date context use explicit `Business-Unknown` or `date-unknown` folders so they are never skipped.

Drafts, submissions, intakes, revisions, PDF versions, and lifecycle records are stored as individual immutable envelopes. The high-volume, immutable `ProFormDraftEvent` audit stream is stored in per-session batches under the same business/date folder; each batch contains every source event ID and complete event record, and its protected restore path recreates only missing events.

The daily `08:30 UTC` schedule is intentionally inactive until all six secrets are configured and an administrator completes and reconciles the initial full backup:

- `RETENTION_S3_BUCKET`
- `RETENTION_S3_REGION`
- `RETENTION_S3_PREFIX`
- `RETENTION_AWS_ACCESS_KEY_ID`
- `RETENTION_AWS_SECRET_ACCESS_KEY`
- `RETENTION_S3_KMS_KEY_ID`

The bucket must have versioning and Block Public Access enabled. Its policy must deny non-TLS requests, and its lifecycle must retain every backup version for at least 1,095 days. The IAM principal must be limited to the configured prefix, the configured KMS key, and only the object/list/version operations used by backup verification and recovery.

Backup logs contain record identifiers and counters only; they never contain questionnaire answers, AWS credentials, or binary contents. A failed or incomplete backup does not alter the source database record.
