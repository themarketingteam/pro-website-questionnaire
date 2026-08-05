# Durable-Draft Runtime Feature-Flag Contract

- Status: **IMPLEMENTED_DISABLED_BASELINE**
- Date: 2026-08-05
- Scope: frontend build configuration and backend Base44 function configuration

This contract establishes independent, immutable, fail-closed configuration boundaries for durable draft V2. It does not route the questionnaire through V2, authorize a backend endpoint, create a cloud resource, or enable a production feature. The current production and legacy draft flow remains unchanged while V2 is disabled.

## Strict parsing and environment rules

- Only the exact string `true` enables a boolean. `TRUE`, `True`, `1`, `yes`, an empty string, missing values, and the boolean value `true` do not enable a flag.
- Explicit `false` is the reviewed disabled value. The V2 enable and kill-switch controls must both be valid lowercase boolean literals before V2 may enable; omission or malformed values fail closed.
- Environment values are exactly `local`, `test`, `staging`, `production`, or `unknown`. No trimming or case normalization occurs. Missing, misspelled, or unsupported values normalize to `unknown`, which disables V2.
- Staging and production configuration is explicit. Neither environment inherits the other's values.
- Runtime configuration objects and safe summaries are frozen after construction.

## Frontend variables

All `VITE_*` values are compiled into or exposed to the browser. They are configuration, never secrets and never backend authorization.

| Variable | Allowed value | Missing/invalid behavior | Dependency or constraint |
| --- | --- | --- | --- |
| `VITE_APP_ENVIRONMENT` | `local`, `test`, `staging`, `production`, `unknown` | Normalizes to `unknown`; V2 off | A recognized non-`unknown` value is required for V2 |
| `VITE_APP_BUILD_SHA` | Safe build identifier using letters, numbers, `.`, `_`, `:`, `+`, `-` | Empty safe identifier | Diagnostic only |
| `VITE_APP_BUILD_TIME` | Safe build time/identifier using the same character set | Empty safe identifier | Diagnostic only |
| `VITE_PRO_DRAFT_V2_ENABLED` | `true` or `false` | V2 off | Requires recognized environment and explicit kill-switch value |
| `VITE_PRO_DRAFT_V2_KILL_SWITCH` | `true` or `false` | V2 cannot enable | `true` overrides V2 and every dependent client workflow |
| `VITE_PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED` | `true` or `false` | Off | Also requires client V2; remains off until its implementation batch is accepted |
| `VITE_PRO_DRAFT_EMAIL_OTP_ENABLED` | `true` or `false` | Off | Also requires client V2; future separately approved workflow |
| `VITE_PRO_DRAFT_MAGIC_LINK_ENABLED` | `true` or `false` | Off | Also requires client V2; future separately approved workflow |
| `VITE_PRO_DRAFT_DIAGNOSTICS_ENABLED` | `true` or `false` | Off | Requires a recognized environment; output is safe fields only |
| `VITE_STAGING_BANNER_ENABLED` | `true` or `false` | Off | Effective only when environment is exactly `staging` |

Client V2 is effective only when the environment is recognized, `VITE_PRO_DRAFT_V2_ENABLED=true`, the enable and kill-switch controls are well formed, and `VITE_PRO_DRAFT_V2_KILL_SWITCH=false`. Public email recovery, OTP, and magic link each additionally require their own exact `true` flag.

## Backend variables

These values are ordinary server runtime configuration. None is a secret, but none may be inferred from frontend state.

| Variable | Allowed value | Missing/invalid behavior | Dependency or constraint |
| --- | --- | --- | --- |
| `PRO_DRAFT_ENVIRONMENT` | `local`, `test`, `staging`, `production`, `unknown` | Normalizes to `unknown`; all V2 features off | Recognized non-`unknown` value required |
| `PRO_DRAFT_V2_SERVER_ENABLED` | `true` or `false` | V2 off | Requires valid kill switch and side-effect configuration |
| `PRO_DRAFT_V2_KILL_SWITCH` | `true` or `false` | V2 cannot enable | `true` overrides every durable-draft backend workflow |
| `PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED` | `true` or `false` | Off | Also requires backend V2; remains off until implementation is accepted |
| `PRO_DRAFT_EMAIL_OTP_ENABLED` | `true` or `false` | Off | Also requires backend V2; future separately approved workflow |
| `PRO_DRAFT_MAGIC_LINK_ENABLED` | `true` or `false` | Off | Also requires backend V2; future separately approved workflow |
| `PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE` | `disabled`, `staging_redirect`, `production` | Normalizes to `disabled` and invalidates V2 configuration | `staging_redirect` only with `staging`; `production` only with `production` |
| `PRO_DRAFT_DIAGNOSTICS_ENABLED` | `true` or `false` | Off | Requires a recognized environment and kill switch off; safe output only |
| `PRO_DRAFT_BUILD_SHA` | Safe build identifier using letters, numbers, `.`, `_`, `:`, `+`, `-` | Empty safe identifier | Diagnostic only |

`disabled` side-effect mode is valid for every recognized environment. Any `staging`/`production` mode mismatch invalidates the backend configuration and disables V2. Backend V2 is effective only when the environment, enable flag, kill switch, and side-effect configuration are all valid; the enable flag is `true`; and the kill switch is `false`.

## Authorization boundary

The frontend and backend gates are deliberately independent:

1. A frontend flag controls only whether client UI/code may attempt a V2 workflow. It is public input and is not a security control.
2. Every backend operation must independently check backend configuration and its own authorization, validation, rate-limit, and scope rules.
3. A backend flag never turns on client UI. A frontend flag never turns on a backend feature.
4. Future OTP or magic-link UI requires both client and server V2 gates plus both method-specific gates, followed by the separately accepted security contract.

## Environment baselines

| Setting | Local baseline | Staging baseline | Production-disabled baseline |
| --- | --- | --- | --- |
| Environment | `local` | `staging` | `production` |
| Client/server V2 | `false` | `false` | `false` |
| Client/server kill switch | `true` | `true` | `true` |
| Public email recovery | `false` | `false` | `false` |
| OTP | `false` | `false` | `false` |
| Magic link | `false` | `false` | `false` |
| External side effects | `disabled` | `disabled` | `disabled` |
| Safe client diagnostics | `false` | `true` | `false` |
| Safe backend diagnostics | `false` | `false` | `false` |
| Staging banner | `false` | `true` | `false` |

The committed example files are the disabled baseline. They are not deployment authorization and contain placeholders only.

## Future production-enabled configuration

Production activation is a separate approved release step after staging certification, green-environment certification, migration/integrity gates, and rollback readiness. At that step only:

1. Both environments remain exactly `production` on their respective client/server controls.
2. Client and server V2 enable controls may be changed to `true` independently, with both kill switches explicitly changed to `false` only during the approved sequence.
3. `PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE=production` may be used only after production side effects are certified; otherwise it remains `disabled`.
4. Public email recovery remains `false` until its implementation and acceptance batch is complete.
5. OTP and magic link remain `false` until separately accepted security, delivery, replay, expiry, rate-limit, and rollout decisions are implemented.
6. A kill switch changed back to `true` immediately disables the corresponding V2 boundary even if ordinary enable flags remain `true`.

No production enablement value is committed by this baseline.

## Failure and diagnostics behavior

- Missing or malformed enable/kill controls cannot activate V2. Unknown environments disable it. Invalid external-side-effect modes or environment/mode combinations disable backend V2.
- Backend assertions throw `ProDraftRuntimeConfigError` with a stable safe code, HTTP-compatible status, generic message, environment name, configuration-valid boolean, and optional kill-switch/expected-environment fields. They never include arbitrary environment values.
- Safe summaries contain only recognized environment/mode names, booleans, sanitized build identifiers, and configuration-validity state. They never include Base44 app IDs or URLs, tokens, codes, email addresses, AWS credentials, recovery passwords, webhook URLs, or full environment dumps.
- The frontend module reads no browser storage or arbitrary `window` value. The backend module requests only the nine named variables and never enumerates `Deno.env`.
- With V2 disabled, no current questionnaire route or legacy draft behavior changes. Legacy tests and behavior remain the active production path.

## Implementation locations

- Frontend: `src/lib/proDraftRuntimeConfig.js`
- Backend shared source: `base44/functions/_shared/proDraftRuntimeConfig/entry.ts`
- Examples: `.env.local.example`, `.env.staging.example`, `.env.production.example`

No Base44 secret, application, entity, function, domain, email, webhook, or deployment was changed while creating this contract.
