# Public Recovery Page and Questionnaire Panel Contract

- Status: Implemented in source; deployment and live staging certification pending
- Date: 2026-08-06
- Route: `/recover-draft`

## Public route and recovery methods

`/recover-draft` is public and does not require a client account. It offers
explicit `Recover with email` and `Recover with code` tabs, uses the same
client recovery API/coordinator boundary and conditional CAPTCHA adapter as the
opening modal, and never puts email, code, CAPTCHA, or recovery-session values
in route params, query params, location state, Redux, or analytics metadata.
Refresh bootstraps only stored credentials; it does not resubmit form input.

The visible warning is: **Email recovery does not verify ownership of the
email address.** Failures are generic. Raw email and code inputs are cleared
after success. CAPTCHA tokens remain transient and are cleared after use.

## Authorized questionnaire choices

Only a successful email-authorized recovery session may call
`listProFormDraftRecoveryChoices` or `selectProFormDraftRecoveryChoice`.
Recovery-code sessions cannot list email-associated drafts. The transient list
shows only business display name, created time, last-saved time, safe status,
read-only state, and current-selection state. It excludes email, domain,
answers, tokens, and code material and is discarded when the page unmounts.

`Open this questionnaire` selects the exact authorized draft. Active drafts
remain editable; submitted drafts open read-only. Selecting an older draft does
not change the backend creation order used by newest-draft selection.

## Recovery information placement

The V2 questionnaire renders the primary `Draft recovery` panel immediately
before Question 1 without changing the question ID, number, anchor, submission,
or PDF contract. A secondary `Draft recovery information` disclosure is in the
questionnaire footer. Neither placement is in the global header, browser title,
URL, or analytics metadata. The V2-disabled questionnaire retains the legacy
rendering path without either panel.

The primary panel may show:

- the full code and `Copy recovery code` only when the credential vault still
  holds a valid full code;
- otherwise an approved four-character hint, without reconstruction;
- a recognition-safe masked email such as `i***@example.com`, with short local
  parts fully masked;
- draft/read-only state, current browser-storage state, and observed local and
  server save times; and
- links to recover a different questionnaire or open the recovery page.

The footer intentionally omits the full code, preventing duplicate secret
display when both placements are open. There is no general email-code action.

## Truthful save wording

| State | Wording |
| --- | --- |
| `local_saving` | `Saving in this browser…` |
| `local_saved` | `Saved in this browser` |
| `server_saving` | `Saving securely…` |
| `server_saved` | `Saved securely` |
| `offline_local_only` | `Offline — saved in this browser and will sync when reconnected` |
| `retrying` | `We could not sync yet — retrying` |
| `error` | `We could not save securely yet` |
| `restored` | `Your previous draft was restored` |
| `submitted` | `Submitted — read-only` |

`server_saved` is downgraded to `server_saving` unless both a positive server
revision and a valid server-save timestamp are acknowledged. This batch does
not activate or migrate ongoing V2 server autosave.

## Accessibility, responsiveness, and evidence

The method selector implements tabs, tab panels, roving focus, arrow keys,
Home, and End. Inputs have persistent labels; loading, retry, CAPTCHA, copy,
and error outcomes use status/alert semantics. Controls meet the existing
mobile touch-target pattern, cards stack on narrow screens, and the footer uses
a native accessible disclosure.

Source and browser evidence is defined in:

- `src/test/ProDraftRecovery.test.jsx`
- `src/test/AppRecoveryRoute.test.jsx`
- `src/test/ProDraftRecoveryChoiceList.test.jsx`
- `src/test/ProDraftRecoveryPanel.test.jsx`
- `src/test/ProQuestionnaireRecoveryPanelIntegration.test.jsx`
- `src/test/proDraftDisplaySafety.test.js`
- `src/test/autoSaveIndicatorSafety.test.jsx`
- `src/test/proDraftBootstrapCoordinator.test.js`
- `tests/e2e/draft-v2/public-recovery-page-and-panel.spec.js`

The E2E fixture is synthetic and read-only. Live recovery APIs, provider
CAPTCHA behavior, deployed accessibility certification, and staging operation
remain separate release gates. No deployment or email operation is authorized
by this contract.
