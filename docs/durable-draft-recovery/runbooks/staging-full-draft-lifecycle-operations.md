# Staging Full Draft Lifecycle Operations Runbook

- Status: **PLACEHOLDER — SOURCE GATE BLOCKED**
- Production use: **Prohibited**

Do not execute any deployment or data command from this runbook until the
ordered source gate passes and the staging target guard returns `PASS` from the
separate staging-linked checkout.

## Controlled operation placeholders

1. `[PLACEHOLDER — DO NOT EXECUTE]` Load reviewed staging-only environment names without printing values.
2. `[PLACEHOLDER — DO NOT EXECUTE]` Verify staging fingerprint, `_staging` name, clean feature branch, V2/public recovery flags, disabled OTP/magic link, SES redirect, and disabled external side effects.
3. `[PLACEHOLDER — DO NOT EXECUTE]` Push entity schemas without `--force`; verify zero deletions and reviewed FLS.
4. `[PLACEHOLDER — DO NOT EXECUTE]` Deploy only the approved replacement, recovery-email, and submission functions.
5. `[PLACEHOLDER — DO NOT EXECUTE]` Build and deploy only the staging site through the guarded wrapper.
6. `[PLACEHOLDER — DO NOT EXECUTE]` Create records marked by one staging `test_run_id`; run Clear All, failure/retry, submission, read-only, PDF, and Start New matrices.
7. `[PLACEHOLDER — DO NOT EXECUTE]` Inspect only allowlisted metadata and counts; never print answers, email addresses, codes, tokens, secrets, or credential-bearing URLs.
8. `[PLACEHOLDER — DO NOT EXECUTE]` Delete only records/files carrying the exact test-run marker, then prove zero remaining test records.

Each later command must record its exact exit code and safe result in the
certification report. A browser failure, inbox ambiguity, PDF mismatch,
unexpected record, cleanup mismatch, target ambiguity, or production identity
collision immediately stops the operation.

## One-year retention operation placeholder

This section is documentation only; do not execute it from this source task.

1. `[PLACEHOLDER — DO NOT EXECUTE]` Confirm a restorable environment-specific backup, exact app/environment identity, clean approved release, and no migration rollback dependency.
2. `[PLACEHOLDER — DO NOT EXECUTE]` Confirm retention remains dry-run, the independent apply secret is configured by an authorized operator, and the monthly schedule is either disabled or analysis-only.
3. `[PLACEHOLDER — DO NOT EXECUTE]` Run bounded admin dry-run pages to completion; review safe counts, IDs/fingerprints, holds, manual-review rows, event estimates, cutoff, and report hash without printing record content.
4. `[PLACEHOLDER — DO NOT EXECUTE]` Investigate every manual-review row and any unexpected protected/eligible record. Do not bypass holds or adjust timestamps.
5. `[PLACEHOLDER — DO NOT EXECUTE]` Request the report-bound apply token as a separate admin action only after recorded approval. Never store or print the token.
6. `[PLACEHOLDER — DO NOT EXECUTE]` Run bounded apply pages, reconcile event-before-draft counts and safe audits after every page, and resume only with the same authorized checkpoint/token.
7. `[PLACEHOLDER — DO NOT EXECUTE]` Stop on cross-environment selection, submitted selection, changed fingerprints, partial event failure, count drift, or backup uncertainty. Preserve checkpoint/audit evidence and invoke the incident/restore process.

Setting `PRO_FORM_DRAFT_RETENTION_DRY_RUN=false` is never sufficient authority
for scheduled apply. Initial cleanup remains manual; unattended destructive
automation is prohibited.
