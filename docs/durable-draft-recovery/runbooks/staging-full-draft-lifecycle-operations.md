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
