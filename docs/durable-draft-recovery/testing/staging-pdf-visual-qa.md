# Staging PDF Visual QA

- Candidate commit: `PENDING_STAGING_COMMIT`
- Environment: `staging`
- Classification: **STAGING_PDF_VISUAL_QA_PENDING**
- Data policy: safe synthetic metadata only; no recovery credential or real client data

The local harness uses the existing questionnaire PDF generator and a deterministic
submitted-style synthetic snapshot. Generated PDFs and rendered PNG pages remain
ignored QA artifacts and are not committed.

## Local automated/render inspection result

The synthetic generator test passed and Poppler rendered the output without an
overlap, clipped row, missing question, or visible credential. The PDF contains
one `612 x 5115.93 pt` raster page rather than standard paginated pages. That is
a release-blocking pagination defect for this acceptance contract, so staging
PDF QA remains pending/failed and no manual row is marked passed. The generated
PDF and PNG inspection image remain ignored local artifacts.

| ID | Synthetic scenario | Result | Tester | UTC timestamp | Evidence reference | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `PDF-LONG-TEXT` | Long text and wrapping | PENDING | PENDING | PENDING | PENDING | Check overlap, clipping, and logical content. |
| `PDF-MULTI-SELECT` | Multi-select answers | PENDING | PENDING | PENDING | PENDING | Check item separation and question order. |
| `PDF-GEOGRAPHIC` | Multiple geographic entries | PENDING | PENDING | PENDING | PENDING | Includes Unicode place names. |
| `PDF-FILE-METADATA` | Safe image/file metadata | PENDING | PENDING | PENDING | PENDING | Filenames only; no binary upload or URL credential. |
| `PDF-CERTIFICATIONS` | Certifications | PENDING | PENDING | PENDING | PENDING | Verify type and filename rendering. |
| `PDF-GUARANTEES` | Guarantees | PENDING | PENDING | PENDING | PENDING | Verify guarantee metadata. |
| `PDF-CONDITIONAL` | Conditional sections | PENDING | PENDING | PENDING | PENDING | Child rows remain in correct order. |
| `PDF-UNICODE` | Unicode characters | PENDING | PENDING | PENDING | PENDING | Check glyphs for café, Montréal, résumé, and check mark. |
| `PDF-LONG-IDENTITY` | Long business name and domain | PENDING | PENDING | PENDING | PENDING | Check filename, header rows, and mobile download. |

Final inspection must verify no overlap or clipping, correct pagination and
question order, submitted snapshot equivalence, regeneration equivalence, safe
filename, readable mobile download, and absence of recovery credentials and
staging secrets. No staging PDF was available, so no row is marked passed.
