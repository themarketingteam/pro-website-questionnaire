# Secret Rotation Runbook

## Universal procedure

Never print, log, paste into a ticket, commit, or screenshot a secret. Assign a
change owner and incident/change ticket; verify exact environment and target;
inventory version/consumer support by secret name only; back up required state;
test dual-key behavior in staging; rotate through the approved secret manager;
restart/redeploy only through the reviewed release process; run scoped tests;
monitor safe diagnostics; audit actor/time/version; and retain the previous key
only for the approved rollback window.

If dual-key/version support is absent, stop. Rollback means restoring the
previous secret version through the secret manager and redeploying compatible
code—not copying a value from logs. Secrets must be independently generated per
environment.

## Rotation matrix

| Secret family | Impact and old-data usability | Dual-key/version requirement | Window and required test | Rollback and audit |
|---|---|---|---|---|
| Recovery-code hash | Existing code hashes can become unusable | Mandatory before routine rotation; lookup must try bounded active versions and rehash on authorized use | Maintenance/write control; recover old/new synthetic codes and reject wrong codes | Restore prior version; audit migrated/unmigrated safe counts |
| Email lookup | Existing normalized-email lookup hashes can become undiscoverable | Mandatory; dual lookup plus versioned reindex with integrity counts | Maintenance window; old/new email discovery with synthetic multiple drafts | Restore prior key/index; audit version/count/hash report |
| Resume-token | Existing resume tokens normally expire or become invalid | Dual verification optional only for a short bounded token lifetime; issuer must use new version | Low-write window; old-policy and new-token expiry/scope/replay tests | Restore old verifier version; audit token-version cutoff |
| Recovery-session | Active recovery sessions become invalid | Dual verification when continuity is required; otherwise planned revocation | Announced window; issue/use/expiry/device/scope tests | Restore prior verifier only within approved incident window |
| Draft-link | Existing signed links may fail | Dual verification required until maximum link lifetime passes | Announced window; old/new link, expiry, replay, and environment tests | Restore prior verifier; audit link version and cutoff |
| Admin-grant | All current admin grants are intentionally revoked | Dual-key support is normally prohibited because revocation is the goal | Staffed window; reauthenticate, device binding, scope, revoke tests | Restore only under security approval; audit every new grant |
| Admin password | Password change alone affects authentication; password-version increment intentionally revokes all grants | No dual password in normal operation; use approved break-glass policy | Staffed window; correct/wrong password, lockout, version, grant issuance tests | Security-owner-controlled recovery; audit version and actors |
| Idempotency | Old request keys may no longer resolve, risking duplicates | Mandatory across maximum idempotency retention | Write-controlled window; replay same/old/new synthetic requests | Restore previous verifier and reconcile duplicates; audit collisions/counts |
| Abuse hash | Rate-limit/fingerprint continuity may reset | Dual hashing required for the active abuse/lockout window | Security-staffed window; CAPTCHA, rate, lockout, cross-version correlation tests | Restore prior version; audit policy windows and safe counts |
| Operational fingerprint | Correlation continuity changes; authorization must not depend on it | Dual fingerprint query optional for retention window; new writes use new version | Monitoring window; stable same-version and separation tests | Restore prior version; audit dashboards/alerts by version |
| Migration authorization | Active leases/tokens/jobs become invalid | Do not rotate mid-run; versioned verifier required for resumable authorized jobs | Freeze migrations; dry-run, token binding, lease, resume/replay tests | Restore prior version only with data-owner approval; audit checkpoints |
| SES credentials | Email delivery stops if credentials mismatch/revoke early | Provider overlap of old/new credentials required | Staging redirect first; sender, region, delivery, bounce/complaint tests | Re-enable prior credential and disable failed new one; audit provider key IDs only |
| CAPTCHA | Verification may fail or old widgets may mismatch | Provider-supported overlap/site-key pairing required | Low-risk window; success, failure, expiry, hostname/environment tests | Restore prior pair; audit provider configuration version |
| Zapier webhook | Submissions may fail or duplicate at old/new endpoints | Controlled overlap plus destination idempotency required | Submission freeze or synthetic-disabled mode; contract, retry, duplicate tests | Restore old endpoint and reconcile destinations; audit safe delivery IDs |

## Hash-secret migration gate

Recovery-code and email-lookup secrets must not be rotated casually. Before
rotation, ship and certify version fields, bounded dual lookup, background
rehash/reindex, checkpoint/resume, safe progress counts, integrity comparison,
and rollback. Missing support is a blocker, not permission to invalidate
client recovery.

## Grant revocation

Admin-grant secret rotation invalidates every grant. Incrementing the password
version also intentionally revokes every grant without changing the password.
Notify staff, perform the change in a staffed window, verify old grants fail,
issue new device-bound grants, and inspect lockout/authorization alerts.

## Completion evidence

Record secret name, old/new version labels, target fingerprint, owner,
approvals, UTC start/end, dual-key decision, test IDs/results, safe counts,
monitoring window, rollback decision, and revocation confirmation. Never record
either secret value.
