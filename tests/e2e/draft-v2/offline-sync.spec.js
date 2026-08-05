import { test } from '../fixtures/safeTest.js';

// Activate only after the outbox/reconciliation coordinator exists and the
// staging write gate has a reviewed cleanup procedure.
test('[DR-OFFLINE-001] queues offline edits and reconciles them after reconnect', () => {
  test.fixme(true, '[DR-OFFLINE-001] Pending V2 offline outbox and reconnect reconciliation implementation');
});

test('[DR-OFFLINE-001] handles visibility and pagehide without premature acknowledgement', () => {
  test.fixme(true, '[DR-OFFLINE-001] Pending V2 lifecycle flush semantics and truthful save-state UI');
});

test('[DR-SAVE-001] preserves recoverable state across timeout reset and server 500 failures', () => {
  test.fixme(true, '[DR-SAVE-001] Pending V2 draft-save retry contract and authorized staging endpoint');
});
