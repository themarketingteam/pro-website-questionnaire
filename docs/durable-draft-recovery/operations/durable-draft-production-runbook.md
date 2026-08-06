# Durable Draft Production Runbook

Status: operational preparation only; this document does not authorize a
deployment, domain move, secret change, or data mutation.

## Architecture and environments

The browser cache is a resilience copy; the server revision and canonical
state hash are authoritative after acknowledgment. Clients invoke protected
Base44 functions. Backend functions enforce runtime flags, authorization,
service-role entity access, RLS expectations, lifecycle rules, operational
events, and external-side-effect policy.

Blue is the existing production fallback and must remain intact. Staging is
isolated synthetic validation. Green is a separate future production candidate
and is never assumed to contain blue records, users, secrets, domains, or
integrations. Record the approved non-secret environment fingerprints in the
change ticket; do not place raw app IDs in this runbook.

## Feature flags and kill switch

Client and server enable flags are independent. The server kill switch is the
authoritative emergency boundary; a client flag or banner cannot stop old
tabs. Use the protected configuration/change procedure to set the server kill
switch, verify admin health reports it active, then align the client flag in a
reviewed build. Do not improvise secret or configuration commands during an
incident.

The current controls pause the durable-draft feature as a whole. A dedicated
protected new-draft pause, existing-save freeze, and submission barrier are
required before claiming granular maintenance capability.

## Draft lifecycle and recovery

Recovery codes are client-held credentials: use the hint for support and never
copy the full value into an insecure ticket. Email recovery is draft discovery
and delivery, not identity verification. Multiple eligible drafts require an
explicit client choice. Submitted drafts are immutable and load read-only.

Clear All preserves the source as `cleared_superseded` and creates a linked
active replacement; Start New preserves a submitted draft and creates a new
active generation. Neither workflow means deletion. A submit-failed draft may
be retried only through the protected submission flow after confirming its
authoritative state.

## SES, CAPTCHA, and abuse controls

For SES incidents, check the safe email diagnostics, mode/environment match,
sender verification, redirect/recipient class, region, credential presence,
provider response class, quota, and bounce/complaint routing. Never print
credentials or send a test to a client. Staging tests go only to the approved
internal redirect.

For recovery abuse, inspect safe rate-limit, CAPTCHA, failure, lockout, and
fingerprint aggregates. Do not reveal whether an email exists, clear security
events to make a request pass, or weaken limits without security approval.

## Admin grants and RLS

Detailed health and support operations require a password-issued,
device-bound, scoped admin grant. Reauthenticate rather than transferring a
grant. Rotate the admin-grant secret or increment password version only under
the rotation runbook; both intentionally revoke grants.

RLS is defense in depth and is never casually disabled. Diagnose denials with
synthetic identities, protected backend functions, safe logs, and the RLS
certification suite. Suspected bypass is SEV-1.

## Migration and retention

Migration requires a unique source/target pair, lease, dry run, content hashes,
conflict review, quiet period, final delta, integrity verification, and a
separate reverse plan. Stop on any condition in the migration stop document.

Retention starts in dry-run mode. A hold requires a protected admin operation,
reason, actor audit, and confirmation before any retention apply. Submitted
records remain outside ordinary draft cleanup. Deletion has no application
undo; verify backup and report binding first.

## Monitoring and health

Use the six-field public health response only for availability. Use
`/admin/draft-operations` with a fresh admin grant for components, safe secret
presence booleans, aggregates, critical events, flags, and the last synthetic
probe. Never query sensitive entities from a browser.

Alert when save errors exceed 1%/5 minutes, save p95 exceeds 5 seconds, save
p99 exceeds 10 seconds, SES failures exceed 5%/15 minutes, submission failures
exceed 2%/15 minutes, recovery exceeds its approved baseline, or two synthetic
probes fail consecutively. RLS bypass, cross-client leakage, submitted
regression, lost acknowledged state, and pre-cutover migration mismatch are
critical.

Synthetic probes use the explicit synthetic identity, external side effects
disabled, protected test-run IDs, and mandatory cleanup. Staging cadence is 15
minutes when later enabled. Production remains disabled until cutover approval;
then use five minutes for the first 24 hours and 15 minutes afterward.

## Routine maintenance

Weekly: review alert delivery, grant failures, recovery abuse, save/recovery
latency, cleanup failures, and dependency status. Monthly: review retention dry
run, holds, backup restore evidence, SES quota/bounces, contact assignments,
and runbook validation. Quarterly: rehearse blue fallback, domain rollback,
secret rotation, and incident tabletop with synthetic data.

## Production deployment

Production deployment is a separately authorized change. Require an exact
commit, certified staging evidence, clean tree, dependency/security review,
passing scoped/full gates, target guard, backup, rollback candidate, migration
and domain plans, owner sign-offs, and communications. Use only the repository's
reviewed production deployment wrapper after those gates; do not push directly
to production or treat deployment success as certification.

## Domain cutover

Domain attachment or reassignment is a Base44 dashboard/manual action unless
verified tooling is documented later. Require domain-owner approval, DNS/TLS
evidence, write freeze, final delta, zero conflicts, integrity sign-off, green
health, blue preservation, rollback timer, and client communication. Do not
move the domain before zero-conflict verification.

## Rollback

Application, data, and domain rollback are separate. The blue app is the
fallback only after post-cutover writes are reverse-synchronized and its source,
schema, secrets, integrations, RLS, and health are compatible. Follow the
domain decision checklist and source/application rollback runbook. Never move
traffic first and reconcile data afterward.

## Post-cutover monitoring

For 24 hours, staff the dashboard, run the approved elevated synthetic cadence,
compare saves/recovery/submission/SES/PDF signals, inspect critical events,
verify cleanup, and keep blue unchanged. Freeze further releases. Roll back or
activate the kill switch at the documented thresholds; record every decision.

## Evidence retention and contacts

Preserve the commit/build, sanitized configuration presence, approvals,
checksums, migration reports, domain audit, health/alert evidence, synthetic
run IDs, cleanup proof, incident timeline, and communications under the
approved evidence-retention policy. Exclude client content and credentials.

- Incident commander: `[INCIDENT COMMANDER — assign before release]`
- Base44 operator: `[BASE44 OPERATOR — assign before release]`
- Domain owner: `[DOMAIN OWNER — assign before release]`
- Data owner: `[DATA OWNER — assign before release]`
- Security owner: `[SECURITY OWNER — assign before release]`
- Support/communications: `[SUPPORT AND COMMS — assign before release]`
