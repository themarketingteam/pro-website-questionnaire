# Base44 Staging App Registration

- Status: **STAGING_CREATED_NOT_READY_FOR_DEPLOYMENT**
- Creation state: **REGISTERED_EMPTY_AND_UNDEPLOYED**
- Date created: 2026-08-05
- Production app name: `Pro Website Questionnaire`
- Staging app name: `Pro Website Questionnaire_staging`
- Base44 workspace: `Benjamin's Workspace` (personal workspace; owner access)
- Production app-ID SHA-256 fingerprint: `f030ea980e900a98b3d172630fe4f52522ebe14ba09e834be668b48e29cfc4f9`
- Staging app-ID SHA-256 fingerprint: `682b3ba54771331270952c7f4a3ac25035417cc9376a93e8b14ffca2e77051f5`
- App IDs differ: **Confirmed**
- Local staging clone: `/Users/isaachines/Desktop/Kaseya-Automation-Repos/pro-website-questionnaire-staging`
- Source branch and revision: `feature/durable-draft-recovery` at `fd8ec47e60309655111ca1a38ba3deecc87e8c86`

Full Base44 app IDs are deliberately excluded from this repository. The fingerprints above are SHA-256 digests used only to prove that the production and staging link files identify different apps.

## Creation and link record

The app was created from the separate staging clone with the documented noninteractive link flow:

```text
npx base44 link --create --name "Pro Website Questionnaire_staging" --description "Staging environment for durable draft recovery development and certification. No production client data."
```

The command completed successfully and created the staging clone's ignored `base44/.app.jsonc`. The primary production-linked checkout's `base44/.app.jsonc` was not modified, removed, copied, or used as the staging link.

## Isolation verification

| Control | Result | Evidence |
| --- | --- | --- |
| Separate local clone | Pass | Clone path above was created directly from `origin/feature/durable-draft-recovery`. |
| Exact staging name | Pass | Authenticated Base44 overview displays `Pro Website Questionnaire_staging`. |
| Intended workspace | Pass | Authenticated overview displays `Benjamin's Workspace`; it is the only workspace returned for the authenticated account. |
| Different cloud app identity | Pass | Production and staging SHA-256 fingerprints differ. |
| Environment link ignored | Pass | `.gitignore` already excludes `base44/.app.jsonc`; the file is untracked in both checkouts. |
| Production link preserved | Pass | Primary checkout retains the original production link and production fingerprint. |
| No site/resource deployment | Pass | No `base44 deploy`, `site deploy`, entity push, function deploy, agent push, connector push, or auth push command ran. Remote function listing is empty. |
| No production data copied | Pass | Base44 Data dashboard reports `No data tables yet`; privileged read-only checks report all four known production entity schemas absent. |
| No custom domain connected | Pass | Base44 Domains shows only the generated free `.base44.app` URL and actions to buy/connect a domain; no custom domain is listed. |
| No production secrets copied | Pass | `npx base44 secrets list` reports no secrets configured. No `.env` file was copied into the staging clone. |
| No integrations connected | Pass | Connector pull reports zero remote connectors and the authenticated `My integrations` view shows the empty setup state. SES and Zapier were not connected. |
| No production checkout contamination | Pass | Primary checkout changes are limited to this sanitized registration document. |

App creation is not treated as a database clone. The absence of data was checked explicitly; no assumption was made that Base44 copied or did not copy records merely because a new app was created.

## Current boundaries

The staging app is an empty cloud container linked only to the isolated local clone. It does not yet contain site code, entity schemas, backend functions, agents, secrets, production records, integrations, custom domains, or environment-specific email/PDF endpoints.

No deployment occurred. No production data, secret, connector, integration, or domain was copied or connected. The production Base44 app and production-linked checkout remain unchanged.

## Staging-foundation controls

- [Production-to-staging integration matrix](./production-to-staging-integration-matrix.md)
- [Staging secret and environment-name inventory](./staging-secret-inventory.md)
- [Staging deployment readiness checklist](./staging-deployment-readiness-checklist.md)
- [Base44 deployment target guards](./base44-deployment-target-guards.md)

Current readiness is **STAGING_CREATED_NOT_READY_FOR_DEPLOYMENT**. The deployment guard exists, but staging side-effect isolation, synthetic fixtures, cleanup, banner, email redirect, production-destination denylists, feature flags, evidence packaging, and final dashboard checks remain incomplete.

## Current read-only recheck

On 2026-08-05, authenticated read-only checks reconfirmed:

- the staging link fingerprint still matches this registration;
- zero remote functions;
- zero configured staging secrets;
- the four known project entity schemas are unavailable, so their project record stores have not been deployed;
- no staging execution path currently activates the production webhook or an email path.

Current app name, custom-domain, connector-authorization, site/default-shell, and automation state require a fresh dashboard verification before deployment because no supported non-writing CLI state query was found for those surfaces. Creation-time evidence remains recorded above but is not treated as permanent proof.

## Next required step

**Implement and test the staging side-effect controls and resolve every `NOT_READY` or `MANUAL_VERIFICATION_REQUIRED` checklist item before any staging deployment.**
