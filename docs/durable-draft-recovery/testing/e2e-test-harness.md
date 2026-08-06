# Safe multi-browser E2E test harness

- Status: local foundation implemented; staging execution awaits an explicit deployed staging URL
- Date: 2026-08-06
- Scope: read-only questionnaire shell, fixture mechanics, and synthetic recovery-bootstrap controller validation

## Safety contract

`playwright.config.js` calls the target-safety validator while configuration is loaded, before a browser or web server starts. The default invocation starts a local preview at `http://127.0.0.1:4173`. An explicit URL without `E2E_TARGET_ENVIRONMENT` fails. Staging requires an explicit remote `E2E_BASE_URL`. Production targets and documented production hostnames fail unless `E2E_ALLOW_PRODUCTION=true`; production writes remain impossible in this foundation even if `E2E_ALLOW_WRITES=true` is also supplied.

The default fixture blocks every cross-origin browser request and every `POST`, `PUT`, `PATCH`, or `DELETE` request. Known Zapier hostnames are always blocked and recorded. The smoke test does not enter answers, click submit, invoke email, select files, or perform an upload. Write-capable tests added later must import `writeTest` from `tests/e2e/fixtures/safeTest.js`; it skips automatically unless `E2E_ALLOW_WRITES=true` on a staging target. Supplying the write flag for local or production fails target validation before launch. Such tests must use cleanable synthetic markers.

Base URLs may contain only an HTTP(S) origin and optional path. Credentials, query strings, and fragments are rejected so tokens cannot enter Playwright output or traces. Do not put authentication material in `E2E_BASE_URL`.

## Environment variables

| Variable | Behavior |
| --- | --- |
| `E2E_BASE_URL` | Target origin/path. Omit only for the managed local preview. Required by the staging script. |
| `E2E_TARGET_ENVIRONMENT` | `local`, `staging`, or `production`. Defaults to `local` only with the managed local preview. |
| `E2E_ALLOW_PRODUCTION` | Exact `true` is required for future production-disabled smoke work. It is not a write authorization. |
| `E2E_ALLOW_WRITES` | Exact `true` allows future staging-only write tests. The current smoke remains read-only. |
| `E2E_TEST_RUN_ID` | Optional safe 8–64 character run ID. A unique timestamp/UUID value is generated when absent. |
| `E2E_TRACE_MODE` | Defaults to `retain-on-failure`; accepted Playwright trace modes are validated. |
| `E2E_EDGE_ENABLED` | Exact `true` adds the optional installed Microsoft Edge channel project. |

Every run shares one test-run ID across projects. Future synthetic records must include `test_run_id=<ID>` and `environment=staging`; business names begin `E2E STAGING`, and emails use `example.test`. The source fixture in `tests/e2e/fixtures/syntheticData.js` provides this shape. No current smoke writes a record.

## Install and local use

Install dependencies and browsers explicitly:

```bash
npm ci
npm run test:e2e:install
```

Browser installation is never part of `npm ci`. Run the five-project local smoke matrix with:

```bash
npm run test:e2e:smoke
```

Use `npm run test:e2e:harness` for storage/network/lifecycle/concurrency fixture mechanics. `npm run test:e2e:pending-report` lists future V2 scenarios without failing foundation work; `npm run test:e2e:pending-strict` is the release guard and intentionally fails while any remain pending. See `browser-failure-fixtures.md` for the full mode API and activation rules.

Use `npm run test:e2e`, `npm run test:e2e:headed`, or `npm run test:e2e:debug` for the complete current E2E set, headed inspection, or Playwright debugging. Local runs use zero retries; CI may use one retry and must still preserve the first failure evidence. Skipped V2 tests are visible release debt, not passing recovery evidence.

`tests/e2e/draft-v2/bootstrap-controller.spec.js` activates six nonvisual
recovery scenarios: explicit new draft creation, stored resume, email/code API
handoff, submitted read-only hydration, and memory-only credentials.
`opening-recovery-modal.spec.js` adds seven rendered entry scenarios across all
five projects. Its separate Vite entry is local-only, uses an injected in-memory
coordinator, and creates no Base44 record or external request. The eight
server-sync/concurrency/offline `fixme` cases remain explicit release debt.

## Staging use

The URL comes from an approved deployment/evidence channel and is never committed:

```bash
E2E_BASE_URL=https://staging-host.example.test \
E2E_TARGET_ENVIRONMENT=staging \
E2E_ALLOW_PRODUCTION=false \
E2E_ALLOW_WRITES=false \
npm run test:e2e:staging
```

`test:e2e:staging` fails with `MISSING_E2E_BASE_URL` before Playwright if the URL is absent. The smoke requires the runtime marker `staging`, the persistent staging banner, durable draft V2 `false`, and kill switch `true`. A URL pointing at the wrong environment therefore fails even if its hostname was not previously documented.

The current staging registration says no site deployment has occurred, so this command is blocked until a separately authorized deployment produces a verified staging URL. Never substitute or guess a Base44 URL. The manual GitHub workflow and its secret/branch-protection rules are documented in [GitHub Actions and branch protection](./github-actions-and-branch-protection.md).

## Browser and device matrix

| Project | Playwright profile | Purpose |
| --- | --- | --- |
| `chromium-desktop` | Desktop Chrome | Chromium and Edge-compatible engine coverage |
| `firefox-desktop` | Desktop Firefox | Gecko desktop coverage |
| `webkit-desktop` | Desktop Safari | WebKit desktop coverage |
| `mobile-chromium` | Pixel 7 | Android Chrome-sized Chromium coverage |
| `mobile-webkit` | iPhone 15 | Mobile Safari-sized WebKit coverage |

`npm run test:e2e:edge` adds an `msedge` channel project and runs it manually. A missing Edge installation may fail that explicit manual command but never the default Linux CI matrix. Release/device certification still requires real Edge and supported physical/mobile devices; emulated viewports are not a substitute.

## Failure evidence and redaction

Playwright stores screenshots only on failure and retains failed-run traces and videos. The safe fixture attaches redacted console/page-error and network-failure summaries. Network records contain only method, resource type, redacted URL, status/failure class, and safety classification—never request bodies or headers.

Safe network/artifact URL summaries remove every query parameter and fragment. The lower-level URL redactor also replaces `access_token`, `recoveryCode`, `draftAccessToken`, and `userEmail` values when a diagnostic specifically exercises query redaction. Authorization, cookie, and set-cookie text is removed from captured messages. HTML reports, `test-results`, traces, videos, authentication state, and generated evidence directories are ignored by Git. Review artifacts as potentially sensitive operational evidence and store approved copies only in the restricted release-evidence system.

The current harness does not authenticate, submit, email, upload, call Zapier, or create Base44 records. Future production-disabled smoke testing requires a separately approved prompt, explicit production flag, production target review, and continued write prohibition.
