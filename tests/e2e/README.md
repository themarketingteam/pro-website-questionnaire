# End-to-end tests

Playwright source lives here and uses `*.spec.js`. The default suite is read-only, targets a local preview, blocks cross-origin traffic and write methods in the browser, and rejects production before launch. See [the E2E harness runbook](../../docs/durable-draft-recovery/testing/e2e-test-harness.md) for commands and safety rules.

- `fixtures/`: safe Playwright fixtures and synthetic data builders.
- `helpers/`: target validation, redaction, run-ID, console, and network controls.
- `smoke/`: read-only local/staging shell smoke tests.

Do not add authentication state, recordings, traces, reports, generated evidence, real client data, or write-capable tests without the documented gates.
