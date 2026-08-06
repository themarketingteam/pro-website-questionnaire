# Health Check and Synthetic Probe Contract

Status: local implementation; not deployed or scheduled.

## Health contract

`proDraftHealth` defines `healthy`, `degraded`, `unhealthy`, `disabled`, and
`unknown` for these components: frontend, runtime configuration, draft
bootstrap/save/load, public and admin recovery, operational events, SES,
external submission, PDF, migration, retention, database, and RLS.

The public function is a bounded, no-write POST endpoint. Its entire projection
is `success`, aggregate `status`, server-derived `environment`, `buildSha`,
`checkedAt`, and `requestId`. It never returns components, counts, app IDs,
secret state, recovery configuration, or admin configuration, and responds with
`Cache-Control: no-store`.

Detailed health requires a password-issued, device-bound admin grant. It
reports component status, boolean-only secret presence, safe runtime modes,
API versions, aggregate save/recovery signals, the last synthetic probe,
bounded critical events, migration conflicts, replacement transactions,
retention state, and cleanup failures. RLS remains `unknown` when authoritative
introspection/evidence is unavailable. No secret value, questionnaire answer,
raw email, recovery code, token, grant, or full draft identifier is returned.

## Synthetic probe

Manual runs require the same password-issued admin grant and device ID.
Scheduled runs require the separately reserved
`PRO_FORM_SYNTHETIC_PROBE_SECRET`. Each run creates only a unique synthetic
record for `synthetic-health@example.test`, using an explicit staging or
production synthetic business label and a protected test-run ID.

The sequence creates a draft, saves revision 1, loads it, appends an event,
verifies purpose-bound code recovery, verifies the exact state hash, optionally
checks submitted/read-only behavior only while external effects are disabled,
and deletes the exact synthetic records with service-role access. Cleanup runs
from `finally`, including after a failed step. A cleanup failure changes the
safe error to `CLEANUP_FAILED` and is recorded as an operational signal.

The probe never invokes SES, Zapier, or an intake destination. Responses and
events contain only the test-run ID, safe stage/error code, timing/status, and
request correlation. Recovery material is generated server-side and is never
returned or logged.

## Automation and cutover monitoring

`runProDraftSyntheticProbeStaging.jsonc` documents a disabled staging
automation with a 15-minute cadence. It is deliberately disabled and has not
been deployed. Production automation is intentionally absent until an
authorized cutover batch. The production plan is five-minute probes for the
first 24 hours, then 15 minutes, with external side effects disabled.

Before activation, operators must configure the separate probe secret outside
Git, verify the exact target/environment, deploy and test health dependencies,
prove cleanup and RLS behavior, and confirm alert ownership. Source presence or
deployment success is not operational certification.

## Verification

Focused tests cover public projection exclusions, admin denial and
boolean-only secret state, probe success/failure, cleanup after failure, exact
hash verification, and absence of external side effects. The dashboard/client
and alert tests described in the companion contract complete this local gate.
