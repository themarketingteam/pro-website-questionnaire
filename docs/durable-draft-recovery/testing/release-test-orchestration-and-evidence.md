# Release test orchestration and evidence

- Status: local testing control plane implemented; final staging certification not run
- Date: 2026-08-06
- Requirement: `DR-TEST-001`

## Phase model

`config/durable-draft-release-phases.json` is the authoritative permission and
evidence model. It defines `source_foundation`, `staging_functional`,
`staging_security`, `staging_capacity`, `staging_release_candidate`,
`green_pre_migration`, `green_post_migration`, `production_disabled`,
`production_enabled`, and `post_cutover`.

Each phase declares requirement-ID patterns, permitted future pending
categories, browsers, reports, environment, and write/email/migration/
production permissions. The three production phases are explicitly disabled;
this batch has no production mode.

## Requirement coverage

`npm run release:validate-coverage -- --phase <phase>` reads the traceability
matrix, production acceptance criteria, unit/integration tests, Playwright
specs, certification reports, and optional normalized results. It writes
owner-only text and JSON reports below `.durable-draft-artifacts/`.

Release-blocking requirements need a stable `DR-*` requirement ID and an
executable `UT-*`, `IT-*`, or `BT-*` reference in a test title or adjacent
comment. Missing, skipped/fixme, stale, or falsely certified evidence fails.
Only categories explicitly deferred by the selected phase may remain pending.
Security requirements cannot remain pending in `staging_security`.

## Synthetic data

`tests/factories/proDraftSyntheticDataFactory.js` supplies deterministic,
seeded records for identities, every draft lifecycle, question types, editor
state, files, events, submissions, intakes, recovery security, verification,
migration, conflicts, and retention. Every persisted fixture includes
`environment=staging` and `test_run_id`; business names begin `E2E STAGING`,
and all domains/email-like values use `example.test`.

Worker IDs create isolated deterministic sequences. The factory never presents
test-only fake recovery-code labels as application credentials and does not
generate realistic postal addresses or phone numbers.

## Commands

```text
npm run release:test -- --phase <phase> --environment <environment> ...
npm run release:test:staging-functional -- --base-url <staging-url>
npm run release:test:staging-security -- --base-url <staging-url>
npm run release:test:staging-capacity -- --base-url <staging-url>
npm run release:test:staging-rc -- --base-url <staging-url>
npm run release:build-evidence -- --input-dir <normalized-results>
npm run release:cleanup-test-data -- --environment staging --test-run-id <id>
```

The staging scripts grant no write, email, or migration permission by default.
The operator must add the exact permission flag after the matching phase is
approved. `--dry-run` plans commands without executing them. No orchestrator
path invokes a deployment, schema push, function deployment, domain action, or
Git push.

## Orchestration, resume, and strict mode

The orchestrator records the commit, phase, environment, sanitized base target,
test-run ID, results, and local artifact paths. A security-boundary failure
halts later test groups. `--resume` reuses passed nonsecurity groups, while
security groups always rerun. `--strict` requires every phase report in
addition to required browser results. Missing or skipped evidence and cleanup
failure are blocking; deployment success is never an acceptance verdict.

Raw results stay under ignored `.durable-draft-artifacts/`. Secrets are not
arguments, output, or evidence fields.

## Evidence bundle and redaction

`scripts/build-durable-draft-evidence-bundle.mjs` writes `manifest.json`,
`summary.md`, `requirements.json`, `browser-matrix.json`,
`security-summary.json`, `performance-summary.json`,
`migration-summary.json`, `cleanup-summary.json`, and `checksums.sha256`.
Every file receives a SHA-256 checksum.

Normalization removes stacks from the safe schema, answer/credential/token/
grant/recovery-code fields, email addresses, and URL query/fragment data. Raw
storage state, traces, HAR files, screenshots, and unredacted artifacts are
not copied. The manifest may contain safe paths to protected local artifacts.
Bundle signing is deliberately deferred.

## Cleanup

`scripts/cleanup-durable-draft-test-data.mjs` accepts only `staging` and one
strict nonblank/non-wildcard test-run ID. It previews through the approved
`cleanupDurableDraftTestData` backend function. Deletion additionally requires
`--apply DELETE_ONLY_THIS_TEST_RUN`, then verifies zero remaining. It never
uses browser entity CRUD or service-role entity calls directly. A missing
backend function, app mismatch, grant, delete failure, or nonzero remainder is
blocking and remains visible in final evidence.

Evidence is collected before cleanup is finalized. Cleanup runs only when the
orchestrated test run had write permission; read-only and dry runs create no
record-cleanup claim.

## Future green and production integration

Green phases can be activated only after a separate app exists and their
target/permission guards are reviewed. Production phases stay disabled until a
later explicitly authorized batch adds environment protection, approvers,
production-safe synthetic monitoring, and rollback controls. This source
increment did not run final staging load/security certification, deploy code,
access production, enable email/migration writes, or move a domain.

## 2026-08-06 local validation

| Command | Result |
| --- | --- |
| `npm ci` | Exit 0; 775 packages, with the existing 29 audit findings and six pending install-script approvals. |
| Focused control-plane Vitest suite | Exit 0; 19/19 tests passed. |
| `npm run release:validate-coverage -- --phase source_foundation ...` | Exit 0; six requirements, zero failures, six explicitly allowed staging-pending warnings. |
| `npm test` | Exit 1; 2,107/2,110 passed. The same three questionnaire/repair assertions remain failing. |
| `npm run test:e2e:harness` | Exit 0; 95/95 browser harness tests passed across five projects. |
| Focused ESLint over new files | Exit 0; zero findings. |
| `npm run lint` | Exit 1; existing repository baseline of 28 errors and 14 warnings, with no new-file finding. |
| `npm run typecheck` | Exit 2; existing project-wide diagnostics; a filtered rerun found no diagnostic in a new control-plane/factory file. |
| `npm run build` | Exit 0; Vite build and sensitive built-bundle scan passed. |
| Dry `staging_functional` orchestration | Exit 0 with `DRY_RUN_PLANNED`; writes disabled and evidence marked incomplete. |

The three normal-suite failures are numeric zero represented as `"0"`, a
whitespace-only service offering retained in an array, and a missing keyed
`taggedPeople` coercion warning. None originates in this testing control plane.
