# Test harness

The repository-root `package.json` is the only package and command authority. Run every command from the repository root. `src/package.json` was removed because Base44, Vite, the lockfile, and local/CI validation all operate from the root.

| Consumer | Authoritative package/command |
| --- | --- |
| Local development | Root `package.json`: `npm run dev`, `npm test`, and focused root scripts. |
| Base44 build/development | `base44/config.jsonc` executes `npm install`, `npm run build`, and `npm run dev` from the project root. |
| GitHub Actions/future CI | Root `npm run test:ci` and `npm run check`; no workflow is checked in yet. |
| Codex validation prompts | Root scripts only, beginning with `npm run test:manifest`. |
| Test documentation and deployment wrappers | The commands below; both deployment wrappers call the root `check` gate. |

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Validate the manifest, then run the normal Vitest suite once. |
| `npm run test:watch` | Validate the manifest, then run normal tests in watch mode. |
| `npm run test:unit` | Root alias for the normal suite. |
| `npm run test:all` | Run the normal suite and the opt-in characterization suite, reporting both results. |
| `npm run test:submit-hardening` | Run the focused payload/submission hardening files. |
| `npm run test:baseline-characterization` | Reproduce the temporary known-defect characterizations. This is evidence, not a release acceptance gate. |
| `npm run test:storage` | Run shared storage-utility tests and storage characterization files. |
| `npm run test:runtime-config` | Run frontend/backend environment, banner, and external-side-effect policy tests. |
| `npm run test:ci` | Deterministic non-watch normal suite for automation. |
| `npm run test:manifest` | Enforce package authority, script/config wiring, directory layout, and test naming. |
| `npm run test:e2e:smoke` | Run the read-only Playwright shell smoke in the five default desktop/mobile projects. |
| `npm run test:e2e:staging` | Require an explicit staging URL, then run the read-only staging shell smoke. |
| `npm run test:e2e:install` | Install the Playwright-managed browser binaries. |
| `npm run test:e2e:harness` | Validate storage, network, lifecycle, multi-tab, and isolation fixture mechanics in all five projects. |
| `npm run test:e2e:pending-report` | List requirement-linked pending draft-V2 scenarios in text and JSON without failing foundation work. |
| `npm run test:e2e:pending-strict` | Fail while any release-blocking draft-V2 browser scenario remains pending. |
| `npm run check` | Run lint, typecheck, `test:ci`, and build; all four execute even when an earlier gate fails. |

No release-certifying command uses `--passWithNoTests`. The deployment wrappers invoke `npm run check`, so a missing suite or known failure remains fail-closed.

## File conventions

- Normal Vitest unit/integration tests use `*.test.js` or `*.test.jsx` under `src/` or `scripts/`.
- Temporary defect characterizations live under `src/test/baseline-characterization/` and use `*.baseline-characterization.test.js` or `.jsx`.
- Playwright tests belong only under `tests/e2e/` and use `*.spec.js`.
- Reusable synthetic data belongs in `src/test/fixtures/`; shared helpers belong in `src/test/utils/`; storage-harness tests belong in `src/test/storage/`.
- Do not place `.spec` files outside `tests/e2e`, and do not place Vitest `.test` files in `tests/e2e`.

`src/vitest.config.js` explicitly collects normal tests and excludes characterization and end-to-end files. `src/vitest.baseline-characterization.config.js` collects only the characterization naming pattern. `playwright.config.js` owns native-browser collection, environment safety, artifacts, and the five-project default matrix; see `tests/e2e/README.md` for its fail-closed operating contract.

## Isolation contract

`src/test/setupTests.js` installs fresh deterministic state for every test:

- Base44 entities expose only methods used by current production source. Entity, function, upload, and auth mocks have their calls and implementations reset before each test.
- Known function invocations receive safe synthetic defaults; an unknown function name throws instead of silently succeeding.
- `localStorage`, `sessionStorage`, and `matchMedia` are restored to known implementations. Storage property/read/write/quota scenarios use `src/test/utils/storage.js`.
- React trees are cleaned up. Fake timers are cleared only when a test enabled them; pending callbacks are never drained during teardown.
- Unmocked `fetch` and `XMLHttpRequest.open` calls fail every normal and characterization test. Network-capable code must receive an explicit fake adapter.

Fixtures and mock responses must use `.test` domains and synthetic identities. Never add production records, credentials, app IDs, webhook destinations, tokens, or real client data.

## Current baseline debt

As of 2026-08-05, manifest validation reports 38 normal test files, 5 characterization files, and 6 Playwright specs. The characterization suite passes 27/27 tests, the focused target/fixture helper suites pass 27/27 tests, and 95/95 fixture-mechanics checks pass across the five default Playwright projects. The activated storage-safe boot matrix adds 35/35 passing local executions; the complete local Playwright foundation therefore reports 135 passed and 50 skipped project instances. Those skips represent 10 explicit non-boot V2 scenarios across 6 requirement IDs, so they are not acceptance evidence. The normal suite intentionally remains release-blocking at 415/420 tests: three questionnaire regressions and two server-repair-helper contract mismatches are exposed. Staging browser evidence remains blocked until an explicit deployed staging URL exists. Lint and typecheck also retain separately recorded baseline debt. Do not skip, weaken, or convert these failures into expected passes; remediate the product/contract behavior in an authorized implementation batch.
