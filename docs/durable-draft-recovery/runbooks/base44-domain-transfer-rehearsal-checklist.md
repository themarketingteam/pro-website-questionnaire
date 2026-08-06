# Base44 Domain Transfer Rehearsal Checklist

This is documentation-only rehearsal. It authorizes no DNS, Base44 domain, TLS, production, or deployment change.

- [ ] Name the incident owner, Base44 operator, DNS owner, application owner, security reviewer, and support contact.
- [ ] Obtain Base44's current written support procedure, required permissions, expected propagation/TLS behavior, and reversal route; do not infer it from an old rehearsal.
- [ ] Record sanitized blue/green app fingerprints and prove which is production and which is staging without printing IDs or URLs.
- [ ] Confirm domain ownership, registrar/DNS access, current records/TTL, certificate state, custom-domain configuration, and monitoring endpoints.
- [ ] Freeze writes; complete and verify the final forward or reverse data delta before routing changes.
- [ ] Require `PASS` for counts, hashes, relationships, submitted-state distribution, files, conflicts, RLS, health, mail, PDF, and recovery checks.
- [ ] Preserve backups/checkpoints and confirm zero active migration lease or replacement transaction.
- [ ] Define go/no-go authority, communication templates, rollback threshold, observation window, and Base44 escalation channel.
- [ ] Rehearse a timer from decision through support contact, configuration, DNS/TLS observation, browser smoke, and data validation without performing the actions.
- [ ] Rehearse reversal ordering: kill switch/write control, reverse synchronization and validation, routing reversal, TLS/health verification, then controlled write re-enable.
- [ ] Stop for ambiguous identity, data drift, unresolved conflict, certificate error, RLS bypass, production-side effect, or missing support confirmation.
- [ ] Retain timestamps and sanitized screenshots/checksums; never retain cookies, tokens, secret values, raw URLs, recovery codes, emails, or questionnaire content.

The domain never moves before reverse synchronization passes. A source rollback, Base44 deployment, database migration, and domain transfer are four distinct approvals.

## Documented same-workspace sequence

After Base44 support confirms the current procedure and `_next` exists, validate green through its temporary non-production URL, lower TTL only with DNS-owner approval, enter the maintenance/write-freeze window, complete the final delta and late-write reconciliation, and obtain data-owner sign-off. Then detach the custom domain from blue and attach it to green using only the support-approved same-workspace procedure. Observe DNS and SSL issuance, and run anonymous/authenticated shell, save/recovery, submission/read-only, admin, PDF, email-side-effect, RLS, and monitoring smoke tests.

For reversal, reactivate write control, finish and verify green-to-blue reverse migration first, reconcile late writes, obtain data-owner approval, detach from green, reattach to blue, observe DNS/SSL, repeat smoke tests, and only then restore writes. Record TTL, detach/attach, certificate, smoke, delta, conflict, and timing evidence. These are rehearsal steps, not observed results; `_next` does not exist.
