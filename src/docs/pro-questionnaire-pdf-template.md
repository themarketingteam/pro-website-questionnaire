# Pro questionnaire PDF template

## Public interface and call sites

`generatePDF(formData, businessName, domain)` is the public browser-side interface exported by `PDFGenerator.jsx`. It formats the supplied response data, creates one hidden DOM document, captures it, saves the PDF, and returns either `{ success: true, filename }` or `{ success: false, error }`.

The two active download call sites use `useQuestionnairePdfDownload()`:

- `ConfirmModal.jsx` supplies the current live form responses, the currently edited business name, and the cleaned domain. Downloading does not submit the questionnaire.
- `ThankYouModal.jsx` receives the successful submission's `responseSnapshot` from `ProQuestionnaire.jsx`. The snapshot is stored in component state before Redux is reset, so the post-submit PDF remains complete.

The legacy `pages/ThankYou.jsx` route receives only a business-name query parameter. It intentionally has no PDF action because it cannot generate a truthful questionnaire PDF without the submitted response snapshot.

## Document contract

- Width is fixed at exactly 612 pt.
- The authoritative blank layout is exactly 612 × 4356 pt. Its final Question 25.1 row ends at 4233.5 pt, leaving the reference's 122.5 pt bottom whitespace.
- Height is custom and dynamic. Populated documents remain 612 pt wide and grow only when response content makes a row taller than its reference minimum.
- The result must contain exactly one continuous page. Do not reintroduce A4 width or page splitting.
- All 25 parent questions and all eight child rows must always render, for 33 total rows.
- A child answer renders only when its parent is `Yes`. A child row remains present but blank when its parent is `No` or unanswered, and stale hidden child values must not leak into the PDF.
- Unanswered cells are truly blank. Never add `Not answered`, `N/A`, `Response:`, or another placeholder.
- Row heights are minimums, not fixed clipping heights. Both cells share the height of the tallest content in their row.

## Visual contract

The local MSP Success Digital logo and locally bundled Inter font must finish loading before capture. No remote image request is required.

| Purpose | Value |
| --- | --- |
| Section purple | `#6464FF` |
| Question-number purple | `#3030FF` |
| Question/label lavender | `#ECECFF` |
| Header divider | `#C7C7FF` |
| Business-label text | `#4B4F63` |
| Body/value background | `#FFFFFF` |
| Body text | `#000000` |
| Business-row divider | `#E2E2E9` |

The extracted reference measurements are authoritative: 39.6 pt outer margins; a 532.8 pt content width; a 288.5 pt header; a 183.6 × 35.3 pt cropped logo at x=48.65/y=89.45; 22.4 pt section bars; 34 pt business rows; and the fixed row minimums in `questionnairePdfModel.js`. Business Information uses one-third lavender and two-thirds white columns. Parent questions use equal lavender/white columns. Child rows begin 16.2 pt inside the parent margin, end 5.4 pt before the parent right edge, and use a 2.25 pt full-height accent.

Reference typography is also fixed: 27 pt title, 10.5 pt subtitle and section labels, 11 pt business labels, 9/10 pt parent number/title text, 8.5/9.5 pt child number/title text, and 10 pt response text. The exact local cropped logo and local Inter font assets must finish loading before capture.

The template has square section bars, a white background, and no response lines, gradients, rounded cards, shadows, footer, generated timestamp footer, page number, or top-right image.

## Rendering safety and cleanup

The preferred canvas scale is 2. The renderer lowers it only as needed to stay within the configured 16,000,000-pixel area and 16,384-pixel dimension limits. If the safe scale would fall below the documented readable threshold, generation fails clearly instead of producing a clipped or visibly blurry document.

The temporary render root is removed in `finally`, covering successful saves, font/logo failures, canvas failures, jsPDF failures, and repeated downloads. A blank canvas is rejected. The local logo uses no CORS dependency.

## Stored PDF revisioning

The stable stored-PDF fingerprint contains both the normalized questionnaire snapshot and `QUESTIONNAIRE_PDF_TEMPLATE_REVISION`. A PDF saved under an older template therefore remains in version history, but the next admin download creates and stores one current-template version even when response values have not changed. Later unchanged downloads reuse that current version.

## Filename and analytics

The filename contract remains:

`<CondensedBusinessName>_KaseyaWebsite_ContentQuestionnaire_Responses_<M-D-YY>.pdf`

The `pro_questionnaire_pdf_downloaded` Clarity event fires only after `pdf.save()` succeeds. Failures do not emit the event. Full response payloads and signed upload URLs must never be logged.

## Manual visual QA checklist

1. Generate blank, representative, and stress PDFs in Chromium; use a WebKit-compatible browser when available.
2. Confirm one page, 612 pt width, no encryption, and a blank height of exactly 4356 pt.
3. Render the reference and generated blank PDF at the same DPI and compare the logo, two-line title, subtitle, divider, spacing, colors, columns, section order, all 33 rows, and final Question 25.1.
4. Confirm all eight child rows remain visible and their accent bars stay attached when rows grow.
5. Confirm representative answers appear in the correct right-hand cells.
6. Stress HTML-like text, ampersands, quotes, apostrophes, long words/URLs, multiline text, certifications, guarantees, and Question 25.1. Check escaping, wrapping, row expansion, bottom content, readability, and file size.
7. Search the DOM/PDF text for prohibited placeholders and ensure unanswered cells are blank.
8. Verify repeated success and failure attempts leave no `[data-questionnaire-pdf-render-root]` nodes behind.

Do not reintroduce `Not answered`, a footer, A4 width, page splitting, fixed clipping heights, or conditional-row omission.
