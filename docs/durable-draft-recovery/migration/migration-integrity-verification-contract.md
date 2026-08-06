# Migration integrity verification contract

- Script: `scripts/verify-pro-form-migration.mjs`
- Package command: `npm run migration:verify-blue-green -- <input> [output]`
- Status: local/synthetic implementation; no live certification

Verification evaluates all of these dimensions:

1. Source count by entity.
2. Destination mapped count.
3. Status distribution.
4. Logical creation range.
5. Logical update range.
6. Null/non-null distribution for critical fields.
7. Content-hash equality.
8. Relationship completeness.
9. Submitted final IDs.
10. Draft session IDs.
11. Event-to-draft mapping.
12. Draft-to-submission mapping.
13. File-reference status.
14. Conflict count.
15. Unresolved relationship count.
16. Test/staging contamination.
17. Duplicate migration mappings.
18. Orphan destination records.

Verdicts are `PASS`, `PASS_WITH_WARNINGS`, `FAIL`, or `BLOCKED`. Missing
evidence is `BLOCKED`; mismatches are `FAIL`. Only `PASS` sets
`cutoverReady=true`. A deployment success, a partial sample, or zero transport
errors cannot substitute for a complete `PASS` report.

The report is metadata-only: check names, verdicts, counts, expected values and
safe codes. It contains no answer payload, full email, authorization hash,
token, signed URL, or file content.
