# Domain Rollback Decision Checklist

Domain reassignment is a Base44 dashboard/manual action unless verified CLI
support is documented later. It is separate from source and data rollback.

## Roll back when

- [ ] Green routing/TLS fails broadly and cannot be corrected within the SEV-1
      recovery objective.
- [ ] Green has a release-correlated critical invariant failure.
- [ ] Green cannot safely serve or save while blue is verified compatible.
- [ ] The incident commander, domain owner, data owner, and Base44 operator
      approve rollback.

## Mandatory prerequisites

- [ ] New writes are server-frozen and two quiet windows are observed.
- [ ] The authoritative side and cutover time are fixed.
- [ ] Green-to-blue final delta/reverse synchronization completed.
- [ ] Counts, logical IDs, hashes, files, submitted state, and conflicts verify.
- [ ] Zero unresolved conflicts, leases, cleanup failures, or replacements.
- [ ] Blue source/schema/secrets/RLS/integrations and health are compatible.
- [ ] Blue remains intact; backup and forward recovery plan are current.
- [ ] DNS/TLS/manual dashboard steps and rollback timer are owner-reviewed.
- [ ] Client and internal communications are approved.

## Exact stop conditions

STOP for any mismatch, missing backup, ambiguous app/environment, active write,
unverified reverse delta, submitted regression, RLS failure, unresolved file,
uncertain DNS/TLS ownership, missing approver, or pressure to move traffic before
data verification. Do not disable RLS or move the domain as a diagnostic test.

## Verification after rollback

Verify routing/TLS, public/admin health, synthetic no-external probe, save/load,
recovery, submission controls, PDF, SES mode, RLS, safe counts, and monitoring.
Keep green preserved for investigation; do not delete or overwrite it.
