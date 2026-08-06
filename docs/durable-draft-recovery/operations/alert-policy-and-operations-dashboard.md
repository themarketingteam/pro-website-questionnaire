# Alert Policy and Operations Dashboard

Status: local implementation; alert delivery is unconfigured and disabled.

## Policy

The deterministic policy evaluates aggregate operational inputs and emits
`warning`, `urgent`, or `critical` alerts. Current thresholds are:

| Signal | Window/threshold | Severity |
|---|---|---|
| Save errors | greater than 1% over 5 minutes | urgent |
| Save latency | p95 greater than 5 seconds over 5 minutes | warning |
| Save latency | p99 greater than 10 seconds | urgent |
| Recovery failures | above the configured expected baseline | warning |
| SES failures | greater than 5% over 15 minutes | urgent |
| Submission failures | greater than 2% over 15 minutes | urgent |
| Synthetic probe | two consecutive failures | urgent |
| Cleanup or migration integrity | any failure | urgent or critical |
| Operational ingest unavailable | any occurrence | urgent |
| Admin brute-force lockout | configured spike threshold | urgent |

Any RLS bypass, cross-client leakage, submitted-state regression, lost
acknowledged state, or pre-cutover migration data mismatch is `critical`.

## Delivery

The delivery abstraction supports `disabled`, `staging_redirect`, and
`production_email`; `webhook` and `sms` are reserved future modes. It reuses
the SES transport, redirects all staging mail, permits production email only
to an internal operations recipient, and never addresses a client.

Messages contain only event type, severity, environment, request ID, safe
fingerprint, and a credential-free dashboard link. A cooldown store suppresses
duplicate fingerprints. A durable shared cooldown store is required before
multi-instance production enablement. Delivery failures produce a safe
operational event so that alerting failure is itself observable.

Reserved configuration names are `PRO_DRAFT_ALERT_MODE`,
`PRO_DRAFT_ALERT_EMAIL_TO`, `STAGING_ALERT_EMAIL_REDIRECT_TO`, and
`PRO_DRAFT_ALERT_COOLDOWN_SECONDS`. This change does not configure any of them
or send email.

## Dashboard

`/admin/draft-operations` is inside the password-only admin gate and uses only
backend function invocations. It shows overall/component health, build SHA,
last probe, save latency/error rate, recovery and conflict aggregates,
submission failures, SES/RLS/migration/cleanup state, boolean configuration
presence, current feature flags, and a paginated critical-event table. A
manual probe action uses the protected backend function.

Tables have captions and scoped headers. The UI never reads operational
entities directly and never displays answers, emails, codes, tokens, grants,
secret values, or full identifiers. Kill-switch controls are deliberately not
present because no dedicated protected mutation exists yet.

## Operations and tests

Cutover monitoring requires approved internal ownership, configured cooldown
and destinations, staging redirect evidence, consecutive synthetic success,
cleanup verification, and dashboards watched throughout the elevated
five-minute production interval. Critical invariants block promotion and start
the incident-response process.

Focused tests cover policy boundaries, critical invariants, cooldown,
staging redirect, alert-delivery failure events, function-only clients,
password-gated dashboard rendering, PII exclusions, direct-entity exclusion,
and accessible tables. No probe, alert, email, automation, or deployment is
executed by these tests.
