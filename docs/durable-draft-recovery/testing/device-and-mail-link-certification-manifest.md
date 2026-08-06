# Device and Mail-Link Certification Manifest

- Candidate commit: `PENDING_STAGING_COMMIT`
- Environment: `staging`
- Safe test link: `PENDING_PRO_DRAFT_STAGING_URL`
- Classification: **DEVICE_AND_MAIL_LINK_CERTIFICATION_PENDING**

The expected behavior is to open the browser-hosted questionnaire website. No
Outlook, Gmail, Teams, iOS Mail, or Android Gmail widget/add-in is expected or
authorized. The link may contain only the safe questionnaire route and approved
synthetic invitation parameters; it must never contain a recovery code, access
token, recovery-session token, admin grant, credentials, or real client data.

| ID | Application / version | Device / OS | Link source | Resulting browser | Staging URL host | Opening modal shown | No query credential | Recovery flow usable | Copy code usable | PDF access | Result | Tester | UTC timestamp | Evidence reference |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `DEVICE-OUTLOOK-WIN` | Outlook desktop / pending | Windows / pending | Internal staging message | Pending | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `DEVICE-OUTLOOK-WEB` | Outlook web / pending | Desktop / pending | Internal staging message | Pending | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `DEVICE-GMAIL-WEB` | Gmail web / pending | Desktop / pending | Internal staging message | Pending | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `DEVICE-GMAIL-ANDROID` | Gmail Android / pending | Android / pending | Internal staging message | Chrome pending | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `DEVICE-GMAIL-IOS` | Gmail iOS / pending | iOS / pending | Internal staging message | Safari pending | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `DEVICE-TEAMS-DESKTOP` | Microsoft Teams desktop / pending | Desktop / pending | Internal staging channel | Pending | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `DEVICE-TEAMS-MOBILE` | Microsoft Teams mobile / pending | Mobile / pending | Internal staging channel | Pending | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `DEVICE-IOS-MAIL` | iOS Mail / pending | iOS / pending | Internal staging message | Safari pending | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `DEVICE-ANDROID-MAIL` | Android Gmail/mail flow / pending | Android / pending | Internal staging message | Chrome pending | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `DEVICE-SAFARI-IOS` | Safari / pending | iOS / pending | Direct internal safe link | Safari | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |
| `DEVICE-CHROME-ANDROID` | Chrome / pending | Android / pending | Direct internal safe link | Chrome | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING |

No approved device-cloud credentials were present. Playwright mobile emulation
is supplemental and is never recorded as real-device coverage.
