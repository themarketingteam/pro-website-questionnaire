# Staging Security Primitives Certification

- Classification: **SECURITY_PRIMITIVES_CERTIFIED_IN_STAGING**
- Certification date: 2026-08-05 (America/Chicago)
- Deployed candidate SHA: `b719b0c08c28360c22cfc3cff0eb41fcc1462c02`
- Required feature-branch commit: `94748f7` (`test: certify draft security primitives in staging`)
- Staging app-ID fingerprint: `682b3ba54771331270952c7f4a3ac25035417cc9376a93e8b14ffca2e77051f5`
- Registered production fingerprint: `f030ea980e900a98b3d172630fe4f52522ebe14ba09e834be668b48e29cfc4f9`
- Durable draft V2: **disabled**
- Public recovery, OTP, and magic link: **not implemented and disabled**

## Scope and classification boundary

This report certifies the version-1 cryptography, signed-token authorization, revision/status, and request-limit primitives in the separate Base44 staging app. It does not certify the questionnaire application for release, enable durable draft V2, deploy a save/bootstrap/recovery API, or change production.

The full normal suite still has five pre-existing failures in `proQuestionnaire.regression.test.jsx` and `proSubmissionRepairHelpers.test.js`; repository lint and broad JavaScript typecheck also retain their established baseline debt. Those application-wide gates keep staging deployment readiness blocked, but they do not contradict the 237/237 focused primitive checks or the live staging self-check.

## Target and authorization evidence

The staging guard passed immediately before each authorized mutation with:

- environment `staging`;
- branch `feature/durable-draft-recovery`;
- the registered staging fingerprint above;
- a production-app-ID denylist comparison; and
- a clean staging checkout at the deployed candidate.

`npx base44 whoami` succeeded in the staging checkout. The live function call succeeded only after `createClientFromRequest(req)`, `await base44.auth.me()`, and exact `role === "admin"` authorization. Anonymous and authenticated non-admin requests return 401 and 403 in local tests. The legacy `DRAFT_RECOVERY_PASSWORD` grant is not accepted by this diagnostic.

## Secret configuration evidence

Configured in staging, names only:

1. `PRO_FORM_DRAFT_TOKEN_SECRET`
2. `PRO_FORM_DRAFT_LINK_SECRET`
3. `PRO_FORM_RECOVERY_CODE_SECRET`
4. `PRO_FORM_EMAIL_LOOKUP_SECRET`
5. `PRO_FORM_RECOVERY_SESSION_SECRET`
6. `PRO_FORM_ADMIN_GRANT_SECRET`

Ordinary staging controls configured with the same names-only import:

- `PRO_DRAFT_ENVIRONMENT=staging`
- `PRO_DRAFT_DIAGNOSTICS_ENABLED=true`

All six cryptographic values were generated independently with Node `crypto.randomBytes(48).toString("base64url")`. A mode-`0600` temporary file outside both repositories was checked for owner-only permissions, nonempty values, 48-byte decoded source material, and pairwise distinction. The file was imported with `npx base44 secrets set --env-file`, securely deleted immediately, and verified absent. Values were never printed, logged, committed, copied from production, or included in this report.

Names-only production inspection after certification showed only the same four pre-existing production names. None of the six purpose-secret names is configured in production. `DRAFT_RECOVERY_PASSWORD` was not included in the staging import and remains unchanged.

## Function deployment result

Only `proDraftSecuritySelfCheck` was targeted. `--force`, full deploy, entity push, site deploy, agent/connector/auth operation, and production deployment were not used.

The first targeted attempt failed closed during local Base44 bundling because isolated functions cannot import the repository-level `_shared` directory; no function was installed by that attempt. The correction vendors exact copies inside the function bundle and adds a byte-equivalence drift test. After the correction, `npx base44 functions deploy proDraftSecuritySelfCheck` reported `1 deployed`. A names-only remote inventory then reported exactly one staging function: `proDraftSecuritySelfCheck`.

## Live self-check matrix

The function was invoked through an authenticated `npx base44 exec` script calling `base44.functions.invoke("proDraftSecuritySelfCheck", {})`. The validator accepted only the documented response keys, rejected unexpected fields, required every boolean true, and scanned the response—excluding the allowlisted request ID—for an email, 64-character hash, recovery-code format, or long Base64URL-like value. The script printed no raw response.

| Response item | Result |
| --- | --- |
| `success` | `true` |
| `environment` | `staging` |
| `securityVersion` | `1` |
| `authorizationVersion` | `1` |
| `persistenceVersion` | `1` |
| `configuredSecrets.draftToken` | `true` |
| `configuredSecrets.linkSigning` | `true` |
| `configuredSecrets.recoveryCode` | `true` |
| `configuredSecrets.emailLookup` | `true` |
| `configuredSecrets.recoverySession` | `true` |
| `configuredSecrets.adminGrant` | `true` |
| `checks.secretLengths` | `true` |
| `checks.secretSeparation` | `true` |
| `checks.recoveryCodeGeneration` | `true` |
| `checks.recoveryCodeHash` | `true` |
| `checks.emailLookupHash` | `true` |
| `checks.opaqueToken` | `true` |
| `checks.resumeTokenHash` | `true` |
| `checks.recoverySessionToken` | `true` |
| `checks.signedInvitationToken` | `true` |
| `checks.adminGrantToken` | `true` |
| `checks.tamperRejection` | `true` |
| `checks.environmentRejection` | `true` |
| `checks.crossPurposeRejection` | `true` |
| `checks.idempotentRevision` | `true` |
| `checks.staleRevisionRejection` | `true` |
| `checks.submittedRegressionRejection` | `true` |
| `checks.requestLimit` | `true` |
| Exact safe response schema | `PASS` |
| Sensitive-pattern response scan | `PASS` |
| Authenticated Base44 admin requirement | `PASS` |

Generated recovery codes, opaque tokens, signed tokens, hashes, synthetic email, and synthetic state were discarded before response construction. The response returns no secret value or length, recovery hint, token, email, hash, draft ID, raw state, or stack trace.

## Local function and disabled-production evidence

`src/test/proDraftSecuritySelfCheck.test.js` passes 18/18 checks covering wrong method, wrong content type, oversized input, unknown/production environment, disabled diagnostics, anonymous/non-admin/admin authorization, missing/short/duplicate secrets, exact successful response, value exclusion, headers, sanitized errors, endpoint SDK wiring, and shared-to-bundled primitive drift.

With `PRO_DRAFT_ENVIRONMENT=production`, the handler returns 404 before client creation or any purpose-secret read. With diagnostics false, it also returns 404 before authentication or secret reads. Production received no function deployment and still lists its original seven functions; `proDraftSecuritySelfCheck` is absent.

## Validation summary

| Gate | Result |
| --- | --- |
| `npm ci` | `PASS`; dependency audit reported existing advisories |
| Security-module tests | `49/49 PASS` |
| Authorization-module tests | `41/41 PASS` |
| Persistence-safety tests | `129/129 PASS` |
| Self-check tests after bundle correction | `18/18 PASS` |
| Combined staging primitive tests | `237/237 PASS` |
| Scoped self-check TypeScript compile | `PASS` |
| Build | `PASS` |
| Full normal tests | `1005/1010`; five pre-existing unrelated failures |
| Lint | Existing baseline: 32 errors, 17 warnings |
| Broad typecheck | Existing project/dependency typing failures |
| Staging target guard | `PASS` |
| Staging authentication | `PASS` |
| Temporary secret-file deletion | `PASS` |
| Targeted function deployment | `PASS` after one documented bundle-only failure |
| Authenticated staging invocation | `PASS` |
| Production-disabled local behavior | `PASS` |
| Production purpose-secret names absent | `PASS` |
| Production self-check function absent | `PASS` |

## Current limitations

- No draft bootstrap API.
- No save API.
- No public recovery endpoint.
- No OTP implementation or activation.
- No magic-link implementation or activation.
- No admin-grant migration; the current legacy password flow is unchanged.
- No rate limiting, CAPTCHA, email delivery, entity migration, or production data exercise.
- No entity, site, domain, connector, auth, or scheduled-automation deployment.
- Application-wide test, lint, typecheck, and release-readiness blockers remain open.

## Production isolation statement

All mutating Base44 commands ran only from the staging-linked checkout after a staging guard pass. The production-linked checkout was used only for read-only fingerprint, function-name, and secret-name verification. No production deploy, secret write, entity operation, function invocation, domain operation, data operation, or feature activation occurred. The production domain was not moved or modified. `main` was not checked out or pushed.

## Decision

**SECURITY_PRIMITIVES_CERTIFIED_IN_STAGING**

This decision is deliberately narrower than application or release certification. Durable draft V2 remains disabled, and production remains untouched.
