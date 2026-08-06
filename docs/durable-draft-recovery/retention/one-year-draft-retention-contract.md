# One-year draft retention contract

- Policy version: `1`
- Initial operating mode: **dry run only**
- Source status: implemented locally; not deployed or configured
- Production cleanup: prohibited until a separately approved operation

## Scope and cutoff

The policy evaluates only `active`, `submit_failed`, and
`cleared_superseded` drafts in the exact authorized environment. Active and
submit-failed age begins at the first valid authoritative server timestamp in
`last_saved_at`, `updated_date`, then `created_date` order. Cleared/superseded
age begins only at a valid `superseded_at`. The default draft and event window
is 365 days and configuration cannot reduce it below 365 days.

Submitted/completed drafts, any draft with `submitted_at` or
`final_submission_id`, completed submissions, and intake records are outside
this cleanup. Test-marked records are also protected; synthetic test cleanup
is a separate process. Client timestamps never advance or shorten retention.
Invalid or missing authoritative timestamps require manual review.

## Holds and recent support

An explicit `retention_hold=true` blocks selection and requires a nonempty
`retention_hold_reason`; a missing reason is manual review. Open recovery
issues and repair, diagnosis, retry, or admin-edit server timestamps within
the default 30-day support window also block cleanup. Ordinary browser saves
are not inferred to be support activity. Pending/orphaned replacement
transactions and explicit migration rollback dependencies remain protected.
In this initial source contract, a draft carrying `migration_batch_id` is
conservatively treated as rollback-dependent unless an explicit trusted
release set is supplied by a later approved operation; absence of proof never implies that a
migration record is safe to remove.

## Dry-run and apply authorization

`analyzeProFormDraftRetention` requires the existing persistent admin grant,
uses exact status filters, processes at most 200 drafts per page, and stores
progress in `ProFormMigrationCheckpoint` under migration name
`pro-form-draft-retention`. The fixed cutoff, policy version, phase/cursor,
safe counts, approved IDs/fingerprints, event/byte estimates, manual-review
count, failures, and report hash are resumable. Reports contain no answer or
email content. A report approves at most 200 draft deletions; another bounded
dry run is required for more.

Token issuance is a separate explicit request after analysis completes. It
requires an independently configured `PRO_FORM_RETENTION_APPLY_SECRET` and
binds HMAC-SHA-256 claims to the environment, policy version, fixed cutoff,
report hash, maximum deletion count, batch ID, two-hour expiry, hashed admin
grant token ID, and `admin:retention-apply` scope. Raw grants and apply tokens
are not stored. The token is one-time for one checkpointed apply run; the same
token may resume that interrupted run, while another token/report is rejected.

## Safe deletion order

`applyProFormDraftRetention` verifies both the admin grant and apply token,
loads the exact completed report, reloads and fingerprints every approved
draft, and re-evaluates policy at deletion time. Changed, submitted, held,
recent-support, cross-environment, test, replacement, migration-dependent, or
otherwise protected records are skipped. Associated events are independently
re-evaluated and deleted one at a time before their draft. No `deleteMany`
exists. An event page above 200 is manual review; any protected event or event
deletion failure leaves the draft intact. Checkpoint index/counts make restart
safe.

Safe security events cover dry-run pages, apply start, event/draft deletion,
skip, manual review, failure, and completion. They contain request/environment
metadata, safe IDs, outcomes, and policy version only.

## Scheduling and initial manual-apply rule

The disabled local schedule template recommends `03:00 UTC` on the first day
of each month. `runScheduledProFormDraftRetention` reads
`PRO_FORM_DRAFT_RETENTION_DRY_RUN`; missing or true runs analysis only. Setting
the variable false does not authorize unattended deletion: the scheduled
function returns a standing-authorization-required result. Initial production
operation is dry-run/report/alert plus a separate manual admin apply. The
template is not deployed or enabled by this source change.

## Backup, rollback, and incident expectations

Before any later apply, operators must verify a current restorable backup,
the migration rollback window, holds, environment/app identity, event
relationships, and reviewed safe report. Deletion itself has no application
undo. If a protected record is selected, an event deletion partly fails, or
counts diverge, stop the run, retain the checkpoint/audit evidence, restore
only through the approved backup process, and treat an improper deletion as a
data incident. Submitted/completed retention remains governed separately.

## Configuration inventory

| Name | Default/safety rule |
| --- | --- |
| `PRO_FORM_DRAFT_RETENTION_DAYS` | 365; minimum 365 |
| `PRO_FORM_DRAFT_EVENT_RETENTION_DAYS` | 365; minimum 365 |
| `PRO_FORM_DRAFT_RETENTION_DRY_RUN` | missing is true |
| `PRO_FORM_DRAFT_RETENTION_BATCH_SIZE` | 50; maximum 200 |
| `PRO_FORM_DRAFT_RETENTION_RECENT_SUPPORT_DAYS` | 30 |
| `PRO_FORM_RETENTION_APPLY_SECRET` | separate secret; unconfigured |

## Tests and release gate

Synthetic policy, authorization, repository/service, checkpoint, admin, and
schedule tests cover old/recent states, support/holds, submitted protection,
invalid dates, environment isolation, reports, token binding, re-evaluation,
event-first failure behavior, resume, bounds, and scheduled apply denial.
Live Base44 RLS/filter/delete behavior, backup restore, alert delivery, real
dry-run review, and production authorization remain release blockers.

This increment executed no Base44 command, schema push, function deploy,
secret operation, data query, deletion, scheduled job, branch push, or
production operation.
