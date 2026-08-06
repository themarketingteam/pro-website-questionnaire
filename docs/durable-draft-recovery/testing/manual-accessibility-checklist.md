# Manual Accessibility Checklist

- Candidate commit: `PENDING_STAGING_COMMIT`
- Environment: `staging`
- Classification: **MANUAL_ACCESSIBILITY_PENDING**

Automated axe coverage is necessary but does not replace these checks. A row can
be marked `PASS` only by a named tester using the stated device/reader. Evidence
must be sanitized and must not contain questionnaire answers, credentials, or
recovery codes.

## Local automated result

On 2026-08-06, the local fixture suite passed 24/24 checks across Chromium
desktop and Playwright Pixel 7 emulation. Axe reported zero serious, critical,
or moderate findings in the scanned states, and the opening-choice focus check
passed. This is local synthetic/emulated evidence, not staging, real-device,
keyboard-manual, or screen-reader certification.

| ID | Check | Device / reader | Result | Tester | UTC timestamp | Evidence reference | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `A11Y-MAN-001` | Keyboard-only navigation | Pending | PENDING | PENDING | PENDING | PENDING | Tab, Shift+Tab, Enter, Space, and arrows. |
| `A11Y-MAN-002` | Logical focus order | Pending | PENDING | PENDING | PENDING | PENDING | Opening, recovery, questionnaire, and admin flows. |
| `A11Y-MAN-003` | Modal focus trapping | Pending | PENDING | PENDING | PENDING | PENDING | Opening, conflict, Clear All, and recovery-code dialogs. |
| `A11Y-MAN-004` | Escape and cancel behavior | Pending | PENDING | PENDING | PENDING | PENDING | No destructive action on cancel. |
| `A11Y-MAN-005` | Screen-reader labels | Pending | PENDING | PENDING | PENDING | PENDING | Controls and landmarks have useful names. |
| `A11Y-MAN-006` | Error association | Pending | PENDING | PENDING | PENDING | PENDING | Invalid fields announce their errors. |
| `A11Y-MAN-007` | Live regions | Pending | PENDING | PENDING | PENDING | PENDING | Save, recovery, copy, and error status. |
| `A11Y-MAN-008` | Recovery-code announcement | Pending | PENDING | PENDING | PENDING | PENDING | Code purpose and one-time visibility are conveyed. |
| `A11Y-MAN-009` | Copy confirmation | Pending | PENDING | PENDING | PENDING | PENDING | Success and failure are announced. |
| `A11Y-MAN-010` | Conflict choices | Pending | PENDING | PENDING | PENDING | PENDING | Version choices and consequences are understandable. |
| `A11Y-MAN-011` | Submitted read-only semantics | Pending | PENDING | PENDING | PENDING | PENDING | Read-only state is announced; editing is unavailable. |
| `A11Y-MAN-012` | Admin table/list pagination | Pending | PENDING | PENDING | PENDING | PENDING | Search, rows, detail, edit, previous, and next. |
| `A11Y-MAN-013` | Mobile zoom | Pending | PENDING | PENDING | PENDING | PENDING | Pinch zoom remains available. |
| `A11Y-MAN-014` | 200% browser zoom | Pending | PENDING | PENDING | PENDING | PENDING | No loss of content or controls. |
| `A11Y-MAN-015` | Reduced motion | Pending | PENDING | PENDING | PENDING | PENDING | Essential status does not depend on animation. |
| `A11Y-MAN-016` | Contrast | Pending | PENDING | PENDING | PENDING | PENDING | Light/dark client conditions where applicable. |
| `A11Y-MAN-017` | Touch target size | Pending | PENDING | PENDING | PENDING | PENDING | Mobile interactive targets are usable. |
| `A11Y-MAN-018` | VoiceOver with Safari | Pending Apple device | PENDING | PENDING | PENDING | PENDING | Real device required. |
| `A11Y-MAN-019` | TalkBack with Chrome | Pending Android device | PENDING | PENDING | PENDING | PENDING | Real device required. |
| `A11Y-MAN-020` | NVDA with Chrome or approved desktop reader | Pending Windows device | PENDING | PENDING | PENDING | PENDING | Desktop screen reader required. |

No manual result is certified in this source-only increment.
