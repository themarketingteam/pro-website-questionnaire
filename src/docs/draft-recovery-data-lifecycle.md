# Draft Recovery Data Lifecycle

## Admin reads

The draft-recovery page reads `ProFormDraft` and `ProFormSubmissionIntake` through the protected `queryDraftRecoveryRecords` backend function.

- List requests are filtered and paginated on the server.
- The UI requests 25 records per page; the backend enforces a maximum of 50.
- List responses contain only the fields needed to render record summaries.
- Large response, payload, diagnostic, and PDF data is fetched only when an administrator expands a specific record.
- Search covers business name, domain, user email, and session ID without loading all records into the browser.
- The backend requires either an authenticated Base44 administrator or a valid signed draft-recovery grant.

## Retention policy

The `archiveRecoveryRecords` automation runs daily at `07:15 UTC`.

- Submitted drafts are archived after 365 days using `last_saved_at`.
- Submitted, successfully retried, or abandoned intake records are archived after 365 days using their server creation date.
- Archiving sets `archived_at` and `archive_reason`; it does not delete the source record.
- Archived records remain available through the recovery page's **Archived Records** filter.
- Permanent deletion is intentionally disabled until the business approves a separate deletion period and recovery process.

The policy is deliberately limited to terminal records. Active drafts and pending or failed intake records are never archived by the scheduled job.
