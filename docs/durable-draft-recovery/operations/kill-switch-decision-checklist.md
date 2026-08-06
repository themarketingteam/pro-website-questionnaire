# Kill-Switch Decision Checklist

## Activate immediately

- [ ] Confirmed or suspected cross-client exposure or RLS bypass.
- [ ] Submitted records can become editable or regress.
- [ ] Server-acknowledged state is being lost or overwritten.
- [ ] Writes are expanding migration corruption or duplicate submissions.
- [ ] Authorization is bypassed or credentials are being accepted outside scope.
- [ ] Cleanup failure leaves synthetic or destructive operations uncontrolled.

Any checked item is a stop condition: classify the incident, preserve evidence,
activate the protected server kill switch, confirm old-tab/backend rejection,
and communicate. A frontend flag alone is not activation.

## Consider bounded activation

- [ ] Save errors remain above 1% for two five-minute windows.
- [ ] Save p99 remains above 10 seconds and retries threaten duplication.
- [ ] Recovery or submission dependency failure is causing unsafe retries.
- [ ] A release-correlated SEV-2 cannot be isolated safely.

Use the narrowest protected barrier available. If granular barriers do not
exist, document the broader impact of the V2 kill switch.

## Do not activate solely because

- [ ] One client has an isolated conflict or browser-storage problem.
- [ ] One recovery email or PDF failed without a systemic pattern.
- [ ] A public health check is unknown while admin evidence is healthy.

## Before restoring

- [ ] Root cause is contained and affected data reconciled.
- [ ] RLS, save/load/hash, recovery, submitted immutability, and cleanup pass.
- [ ] Migration/retention/replacement activity is safe and no conflict remains.
- [ ] Owners approve staged restoration and monitoring covers two windows.
