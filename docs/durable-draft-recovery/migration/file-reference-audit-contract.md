# File-reference audit contract

- Status: implemented locally; reachability disabled by default
- Scope: questionnaire uploads, certification/guarantee files, attachments,
  documents, and PDF source references

The recursive collector includes file/PDF/upload/attachment/document paths in
nested draft and submission structures. Recovery-email destinations and ordinary
external links are excluded because they are not file dependencies.

## Classifications

Every reference is classified as `external_stable_url`, `public_base44_url`,
`app_scoped_base44_asset`, `signed_or_expiring_url`, `s3_url`,
`cloudfront_url`, `embedded_data_url`, `unknown`, or `missing`. Signed query
parameters take precedence over provider classification.

An audit row contains entity, protected source record ID, field path,
classification, short host fingerprint, reachability state, auth/copy flags,
replacement field, and manual-review flag. Query strings and fragments are
removed; embedded content is replaced with `data:<redacted>`. Tokens, file
content, and credential-bearing URLs are never reported.

No download or network probe occurs by default. An explicit safe reachability
mode may use a caller-supplied probe against the redacted URL; it must not attach
credentials for an unknown host. `app_scoped_base44_asset`,
`signed_or_expiring_url`, `embedded_data_url`, `unknown`, and `missing` block
cutover until copied/replaced or manually resolved. A report with any blocker is
not cutover-ready.
