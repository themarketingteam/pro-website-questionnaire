import { test } from '../fixtures/safeTest.js';

// Activate only after the non-secret client namespace and backend authorization
// boundary are implemented. These are release-blocking security scenarios.
test('[DR-LOCAL-002] isolates two synthetic clients sharing one browser profile', () => {
  test.fixme(true, '[DR-LOCAL-002] Pending V2 client-scoped local namespace implementation');
});

test('[DR-SEC-001] prevents cross-client recovery in independent contexts', () => {
  test.fixme(true, '[DR-SEC-001] Pending V2 recovery authorization boundary and staging corpus');
});
