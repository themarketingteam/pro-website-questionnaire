# Final Staging Release-Candidate Gate Summary

- Date: 2026-08-06
- Candidate checked: `a31c4574a9717ddb686156509ba50c5a34aa6e95`
- Requested tag: `durable-draft-staging-certified-2026-08-06`
- Certification outcome: **NOT ISSUED — BLOCKED**
- Staging app/URL fingerprint: **UNAVAILABLE**
- Runtime build marker: **UNAVAILABLE**
- Blocked gate manifest SHA-256: `31ca122aff9b24442d17a700193f6e160ce6ffc057563a43b947fc38ff690097`
- Production deployment: **NOT PERFORMED**

No `STAGING_RELEASE_CANDIDATE_CERTIFIED` verdict was earned. Therefore no annotated tag, feature-branch push, tag push, deployment, cleanup mutation, `_next` creation, domain action, or release-freeze activation occurred.

## Gate evidence

| Gate | Exit | Observed result |
| --- | ---: | --- |
| `npm run release:precheck-staging-rc` | 1 | `FAILED`; 96 failures. |
| Strict staging-RC coverage | 1 | 82 failures, 4 allowed-future warnings, five required browser results absent. |
| Manual evidence validator | 1 | `BLOCKED`; 0 passed and 44 pending, with stale candidate markers. |
| Final RC orchestrator | 2 | `MISSING_E2E_BASE_URL`; no staging run started. |
| Local security | 0 | 66/66 security-harness and 394/394 focused security tests passed. This is not live security certification. |
| Staging capacity | 2 | `MISSING_E2E_BASE_URL`; thresholds were not measured. |
| Rollback precheck/report | 1 | 28 precheck failures; report remains `STAGING_APPLICATION_ROLLBACK_DRILL_BLOCKED`. |
| Migration policy | 0 | Nine-entity source policy valid; live report remains `MIGRATION_UTILITY_FAILED`. |
| Direct entity / service-role scans | 0 | Both passed locally. |
| RLS precheck | 1 | Missing staging API/admin/lifecycle certifications and forbidden production-linked app context. |
| Build / sensitive bundle | 0 | Build and built-bundle entity scan passed with dependency-data age warnings. |
| Source safety | 1 | Two existing test-fixture findings: a Zapier fixture URL and placeholder access-token fixture. |
| Dependency audit | 1 | 29 total findings; 25 production findings and four policy blockers. |
| Cleanup | 1 | `CLEANUP_APP_TARGET_REJECTED`; no delete attempted. |
| Runtime target/commit verification | 1 | Target unavailable/unsafe; no diagnostics or asset comparison attempted. |

## Browser, manual, security, capacity, rollback, and cleanup summary

No live browser matrix, manual matrix, staging security rerun, staging capacity run, rollback deployment, runtime commit comparison, or cleanup verification exists for this commit. Local security passed, but RLS and live boundary evidence remain blocked. The staging app fingerprint, URL fingerprint, build marker, function versions, schema-diff status, and unexpected-record count are unknown.

The six later phases remain green app creation/pre-migration, live migration/post-migration, production-disabled deployment, domain cutover, production enablement, and post-cutover monitoring. None may begin from this blocked manifest.
