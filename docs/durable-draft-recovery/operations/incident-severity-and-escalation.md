# Incident Severity and Escalation

Status: operational contract; contact roles must be assigned before release.

## Command roles and safe handling

- Incident commander: `[INCIDENT COMMANDER — assign before release]`
- Engineering owner: `[ENGINEERING ON-CALL — assign before release]`
- Security/privacy owner: `[SECURITY OWNER — assign before release]`
- Data/migration owner: `[DATA OWNER — assign before release]`
- Support lead: `[SUPPORT LEAD — assign before release]`
- Communications approver: `[COMMUNICATIONS OWNER — assign before release]`

Open one incident record, record UTC times and safe request IDs, and preserve
logs, health projections, alert fingerprints, build SHA, flag state, migration
checkpoints, and deployment/domain audit evidence. Never attach answers,
emails, recovery codes, passwords, grants, tokens, cookies, secrets, raw app
IDs, or credential-bearing URLs. Never ask a client for a password or disable
RLS as an initial response.

## SEV-1

Triggers are any cross-client exposure, RLS bypass, multi-client loss of
server-acknowledged draft data, submitted-state regression, migration
corruption, or domain-cutover failure affecting all clients.

- Initial response: page the incident commander, engineering, security, and
  data owners immediately; stop migration/cutover; preserve evidence; use the
  protected server kill switch or write barrier when authorized.
- Owner: incident commander, with security owning exposure/RLS and the data
  owner owning corruption or reconciliation.
- Escalation: executive, legal/privacy, Base44 support, domain owner, and client
  communications owner as applicable. Do not wait for full root cause.
- Communication cadence: internal update every 15 minutes; client/status
  update at least every 30 minutes when impact is public, after approval.
- Kill-switch decision: activate when continued writes, recovery, or reads can
  expand exposure or destroy evidence. A client-only flag is insufficient.
- Rollback threshold: use the domain rollback checklist when routing is the
  fault and verified reverse synchronization is complete; use the blue app
  only after compatibility and authoritative-write-side checks pass.
- Evidence preservation: immutable log/export/checkpoint copies, safe counts,
  hashes, UTC timeline, exact build/config versions, and operator audit trail.
- Resolution: exposure is contained, RLS and state invariants pass, affected
  data is reconciled, rollback/forward-fix is verified, monitoring is stable,
  communications are approved, and security/data owners sign off.

## SEV-2

Triggers are elevated save failures, unavailable email/code recovery, a
submission failure spike, SES recovery-email outage, unavailable PDF
generation or admin recovery, or large latency degradation.

- Initial response: acknowledge within 15 minutes, inspect admin health and
  safe aggregates, identify the failing component, and pause risky changes.
- Owner: engineering on-call; add email, submission, PDF, or admin service
  owner for the affected component.
- Escalation: incident commander after 30 minutes, sooner if impact grows or a
  security/data invariant appears.
- Communication cadence: internal every 30 minutes and client/status every 60
  minutes when clients are materially blocked.
- Kill-switch decision: activate the narrowest protected boundary if retries
  can corrupt state, create duplicates, or overload dependencies; otherwise
  keep safe saves available.
- Rollback threshold: sustained breach of alert thresholds after one safe
  mitigation interval, or evidence the current release caused the issue.
- Evidence preservation: request IDs, aggregate rates/latencies, safe error
  codes, build/config versions, dependency status, and synthetic outcomes.
- Resolution: alert metrics remain below thresholds for two observation
  windows, synthetic and manual checks pass, queues/retries are reconciled,
  and support has an approved client response.

## SEV-3

Triggers are an individual draft conflict, isolated browser-storage problem,
one-client recovery failure, one PDF formatting issue, or one email-delivery
failure.

- Initial response: open a support case, use safe metadata and code hint only,
  reproduce with synthetic data, and follow the client support playbook.
- Owner: support lead; engineering is consulted for reproducible defects.
- Escalation: engineering within one business hour when unresolved; upgrade
  immediately if another client, exposure, or acknowledged-state loss appears.
- Communication cadence: case updates at agreed support intervals, normally
  every business day, with immediate notice when severity changes.
- Kill-switch decision: normally no; activate only if evidence shows broader
  risk, then reclassify.
- Rollback threshold: no single-case rollback unless the defect is release
  caused and likely systemic.
- Evidence preservation: safe request ID, browser/storage mode, timestamps,
  code hint, lifecycle status, and reproduction steps without client answers.
- Resolution: the client has a safe recovery path or documented disposition,
  the defect is corrected/worked around, and no broader pattern exists.

## Classification and closure

Classify on observed impact, not confidence in root cause. Upgrade immediately;
downgrade only with incident-commander approval and recorded evidence. Closure
requires a UTC timeline, impact statement, safe evidence index, corrective
actions with owners/dates, communication record, and a follow-up review.
