# Pro questionnaire retention backup

Base44 writes encrypted retention backups to:

`s3://pro-tier-bucket/contentDraftEntry/<Business_Name>/<YYYY-MM-DD>/`

The IAM user `base44-pro-questionnaire-retention` has no delete permission and is limited to this prefix and the dedicated KMS key. The bucket policy requires TLS and SSE-KMS for this prefix. Current object versions are retained indefinitely; superseded versions are retained for at least 1,095 days.

The Base44 backup is an independent recovery copy. The Draft Recovery page continues to read the authoritative Base44 database; an AWS outage or missing AWS secret must not prevent administrators from viewing database drafts.
