# Write Freeze and Maintenance Runbook

## Safety premise

A frontend banner or client flag does not stop an already-open tab, cached
bundle, direct function call, automation, or integration. A real freeze needs
server-enforced barriers before every create, save, replacement, submission,
migration, retention apply, and other mutation. Entity/RLS controls remain
enabled. Until dedicated protected granular barriers exist, do not claim that
new-draft, save-only, or submission-only freeze is available.

## Preconditions

- Approved change/incident ticket, maintenance owner, data owner, Base44
  operator, support lead, and rollback owner.
- Exact environment/build and authoritative write side identified.
- Current backup/checkpoint and reverse-migration readiness verified.
- Health, alerting, client message, expected duration, and abort threshold set.
- No active retention apply, migration lease, replacement transaction, or
  uncontrolled submission retry.

## Freeze sequence

1. Announce planned maintenance with the approved template.
2. Pause new draft starts through a protected server barrier; verify a
   synthetic create is rejected with the maintenance code.
3. Pause existing draft saves through the server barrier; allow in-flight
   requests to settle and record acknowledged revisions.
4. Pause submission separately; verify no external intake or Zapier delivery
   can start. Do not represent external-side-effect disablement alone as a
   complete write freeze.
5. Show the maintenance message in the current client build, while treating it
   as communication only.
6. Stop scheduled probes or jobs only if they conflict with the maintenance
   operation; retain passive health monitoring.
7. Observe queues, leases, replacements, saves, submissions, and operational
   events until the quiet period has no new mutations for two full observation
   windows.

If only the broad durable-draft kill switch exists, use it under incident/change
authority and document that all V2 workflows are paused. Never disable RLS or
improvise entity permissions.

## Final delta and verification

Fix the cutoff using server time, run the bounded migration delta, wait for two
quiet passes, review every conflict/failure, and verify counts, IDs, content
hashes, submitted immutability, files, and cleanup. Preserve the report and
checkpoint. Do not move a domain before zero-conflict verification and data
owner sign-off.

## Maintenance work

Perform only the approved schema/function/configuration/migration action against
the verified target. Keep blue intact. Use synthetic data and staging evidence
first. A successful deployment or command is not proof of data integrity or
permission to unfreeze.

## Unfreeze sequence

1. Confirm maintenance tests, health components, RLS, migrations, SES mode,
   submissions, synthetic cleanup, and rollback readiness.
2. Remove the submission barrier first only when external destinations are
   certified; run one idempotent synthetic/no-external validation.
3. Remove the existing-save barrier; verify save/load/hash/recovery.
4. Remove the new-draft barrier; verify bootstrap and cleanup.
5. Align the client message/flags in a reviewed release after server state is
   confirmed.
6. Monitor elevated thresholds for two windows and close communications only
   after stability.

## Rollback of freeze

If the freeze mechanism itself causes unsafe impact, restore the last reviewed
barrier configuration through the protected change path, keep risky mutations
blocked, verify server behavior directly, and follow application/data/domain
rollback independently. Do not remove barriers merely because the banner was
removed.

## Emergency unfreeze

Emergency unfreeze requires incident-commander and data-owner approval, a
verified server configuration, no active conflicting migration, current backup,
and staffed monitoring. Restore one mutation class at a time, test with
synthetic data, and re-freeze immediately on conflict, leakage, submitted
regression, lost acknowledgment, or cleanup failure.

## Evidence

Record approvals, environment/build, barrier states, UTC cutoff, last accepted
revisions, quiet-period windows, final-delta checksum, conflicts, tests,
operator actions, communications, unfreeze order, and monitoring results. Do
not record client content, credentials, secrets, or raw app IDs.
