# Draft RLS emergency rollback

Status: **LOCAL RUNBOOK; NO RLS DEPLOYMENT AUTHORIZED**

Date: 2026-08-06

## Preferred response

1. Enable the durable-draft kill switch and confirm the client shows the
   applicable read-only, local-only, recovery-only, or maintenance state.
2. Preserve restrictive Draft, Event, security-event, and verification-attempt
   RLS.
3. Preserve browser canonical state and recovery credentials. Do not clear,
   migrate, or silently restart a questionnaire.
4. Diagnose the backend request-client, authorization, service-role, secret,
   and RLS configuration path using redacted metrics.
5. Fix and redeploy only the affected backend functions to the verified staging
   target, then run the authorized-backend success matrix.
6. Disable the kill switch only after save, load, recovery, admin, submission
   lock, and direct-denial evidence passes.

There is no public direct-entity compatibility path. A browser must never
change transport from a backend function to an entity endpoint after an
authorization, RLS, service-role, network, or feature failure.

## Temporary RLS rollback: last resort

Reopening any entity operation exposes draft content or mutation capability to
anonymous or ordinary authenticated clients. It may permit enumeration,
tampering, deletion, recovery abuse, security-event disclosure, and bypass of
revision/submission locks. Treat it as a security incident, not a routine
availability toggle.

A temporary relaxation requires all of the following:

- written approval from the application owner and security owner;
- exact entity, operation, environment, start time, and expiry time;
- verified staging or green target identity and production denylist;
- incident channel, operator, reviewer, and monitoring owner;
- access/error-rate monitoring with redacted request IDs only;
- a maximum reviewed time window and an automatic/manual expiry alarm;
- a preserved export/checkpoint where supported;
- explicit confirmation that blue production is the safer fallback when
  available.

Never reopen security-event or verification-attempt reads. Never use `true` or
public create/read/write/delete as an undocumented emergency shortcut. Never
copy the temporary rule to blue production.

## Data and synchronization controls

- Pause server writes before changing RLS and retain browser canonical state.
- Record the last accepted server revision and submitted/superseded state.
- Do not replay local changes automatically across an incident boundary.
- Quarantine conflicts and reconcile through the authoritative backend after
  RLS is restored.
- Preserve submission locks and do not regenerate a writable draft from a
  submitted local snapshot.
- Namespace and inspect any synthetic incident records before cleanup.

## Mandatory post-change tests

Run these commands against the source candidate before any live operation:

```text
npm ci
npm run test:entity-schemas
npm run test:sensitive-service-role
npm run test:no-sensitive-frontend-entities -- --source-only
npm run build
npm run test:sensitive-built-bundle
npm run precheck:rls
npm test -- --run
```

Then, only in an explicitly authorized and verified staging target:

1. Anonymous and ordinary non-admin Draft create/read/list/filter/update/delete
   are denied.
2. Anonymous and ordinary non-admin Event create/read are denied.
3. Security-event read is denied.
4. Backend bootstrap, load, save, event append, replacement, recovery, recovery
   email, admin list/detail/update/events/lineage, retry, and repair succeed.
5. Authorization and RLS failures remain safe, bounded, and non-retrying.
6. Submitted drafts remain read-only and delayed writes remain rejected.
7. No frontend direct entity request occurs.

## Reapply and close

Reapply the exact admin-only create/read/update/delete rules immediately after
the bounded emergency window. Re-run the full denial/success matrix, inspect
redacted security metrics, reconcile quarantined revisions, remove temporary
monitoring exceptions, and record exact timestamps and approvals in the
incident report. Blue production remains the rollback point; it is not a place
to test relaxed RLS.

## Staging source rollback drill boundary

The application rollback drill must preserve the current hardened RLS and entity contracts. It may not deploy `pre-durable-draft-recovery-2026-08-05` into staging or relax RLS to make an old source build function. If no earlier `DRAFT_RLS_CERTIFIED_IN_STAGING` commit exists, source rollback is blocked; keep the kill switch fail-closed and leave staging unchanged. See the [staging rollback drill plan](./staging-application-rollback-drill-plan.md).

The 2026-08-06 final gate retained `DRAFT_RLS_BLOCKED`; the local target guard also reported a forbidden production-linked app context. No deploy, RLS change, tag, or push is authorized until a verified staging target and complete live RLS evidence exist.
