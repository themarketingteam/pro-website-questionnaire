# Staging Email Client Rendering

- Candidate commit: `PENDING_STAGING_COMMIT`
- Environment: `staging`
- Classification: **EMAIL_CLIENT_RENDERING_PENDING**

Only approved internal staging mailboxes may be used. No client address has been
or may be used. Automated template tests cover escaping, the `[STAGING]` prefix,
plain text, safe links, and absence of tracking/external images; client rendering
still requires the manual rows below.

| ID | Client | Sender verified | `[STAGING]` prefix | Code readable / no excessive wrap | Safe browser link / no code in URL | Plain text fallback | HTML escaping | No tracking or external image | Dark mode | Result | Tester | UTC timestamp | Evidence reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `EMAIL-GMAIL-WEB` | Gmail web | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `EMAIL-OUTLOOK` | Outlook desktop and web | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `EMAIL-IOS-MAIL` | iOS Mail | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `EMAIL-ANDROID-GMAIL` | Android Gmail | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |

No staging email was sent because an approved internal mailbox and staging URL
were not available in this environment.
