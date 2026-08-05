import { test } from '../fixtures/safeTest.js';

// Activate only after revision/CAS metadata, merge policy, and conflict UI are
// implemented and exposed through safe runtime markers.
test('[DR-CONCUR-001] merges non-overlapping edits from two tabs', () => {
  test.fixme(true, '[DR-CONCUR-001] Pending V2 field-level merge and revision protocol');
});

test('[DR-CONCUR-001] surfaces deterministic same-field conflicts', () => {
  test.fixme(true, '[DR-CONCUR-001] Pending V2 conflict detection and user-resolution UI');
});

test('[DR-CONCUR-001] rejects stale saves and treats duplicate responses idempotently', () => {
  test.fixme(true, '[DR-CONCUR-001] Pending V2 CAS rejection and idempotency implementation');
});
