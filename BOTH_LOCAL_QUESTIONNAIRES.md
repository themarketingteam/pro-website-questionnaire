# Local questionnaire validation

Both previews run on this computer. Their drafts, recovery credentials, and submission captures are separate. Base44 and Zapier are disconnected in both previews.

| Preview | Address | Organizer questions | Selection limits |
| --- | --- | --- | --- |
| Pro | http://localhost:5173 | Q3 services; Q4 industries | 3–15 counted services; 1–10 industries; 1–5 locations; maximum 25 combined |
| Express | http://localhost:5174 | Q2 services; Q8 industries | 3–6 services; 1–3 industries; every selected/custom parent and child counts once |

Double-click `Start Both Local Questionnaires.command` in this folder to start both servers and open the previews. Each preview also has its own `npm run local:start`, `local:stop`, and `local:status` commands.

## What to validate

1. Open a legacy sample. Opening a question must not adopt or alter its saved selections.
2. Select listed options or add custom pages. Category headings are never selectable.
3. Reorder pages with drag handles or arrow buttons. Assign a parent with the dropdown. Only parent → child is supported; removing a parent keeps its children.
4. Reopen the local return link or reload. Selected pages, sibling order, sources, and parent assignments must survive.
5. Use Inspect JSON / Export JSON. New structures contain `label`, `source`, and nonempty parent `children` only. Page IDs stay in editor state. Priority is sibling array order.
6. Submit a local test. Submission captures must say the payload stayed on local disk; no webhook is sent. Check that its tree matches the draft.

The existing flat arrays and Other fields remain available for old consumers. Organized questions additionally have `service_offerings_structure` / `target_industries_structure` and `metadata.questionnaire_payload_version: 2`. Questions adopt independently. The current exporter retains `format: "page-tree-v1"` on each structure.

## Sources and examples

- Pro local checkout: `/Users/isaachines/.codex/worktrees/local-page-organizer/pro-website-questionnaire-early2026`
- Express local checkout: `/Users/isaachines/.codex/worktrees/express-page-organizer/Express-Content-Questionnaire-v1`
- Pro complete sample: `docs/examples/full-submission-example.json`
- Express complete sample: `/Users/isaachines/.codex/worktrees/express-page-organizer/Express-Content-Questionnaire-v1/docs/examples/full-express-submission-example.json`

These changes are local and unpushed. Hosted Base44 validation and a duplicate Zapier workflow remain a separate release step after local approval.
