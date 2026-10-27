# Local questionnaire preview

Open **http://localhost:5173**. The server is bound to this computer's loopback interface.

This checkout is on branch `codex/local-page-organizer`. The original checkout and published Base44 app were not modified. No commits were pushed and no Base44 resources were deployed.

## Start or stop

The server is started in the background and survives closing its terminal:

```bash
npm run local:start
npm run local:status
npm run local:stop
```

Double-click `Start Local Questionnaire.command` to start it and open the page. `npm run dev` also runs the isolated preview in the foreground. `npm run preview` uses the same supported local API, rather than a static server without draft saving.

The existing dependencies are reused through a `node_modules` symlink to the original checkout. If that checkout moves, remove the broken symlink and run `npm ci` in this checkout to install independent dependencies. No Base44 login is required for this preview.

## What to try

1. Click **Load Scout sample** to open a new copy of the provided legacy answers. Existing local drafts are kept.
2. In Q3, choose **Organize pages**, or make a page change. Q4 remains legacy until it is edited independently.
3. Use the catalog checkboxes and **Add a custom page**. All selected items appear in the same organizer. Each item creates a website page.
4. Use **Parent page** to move items, including promoting Cloud Services and placing Cloud Solutions underneath it. Drag siblings or use their arrow buttons to change priority.
5. Refresh the browser. The saved IDs, grouping, custom text, and priority should remain.
6. Use **Inspect JSON** and **Export JSON** in the local toolbar. These show the real questionnaire serializer's current output.
7. Use **Submit Questionnaire**, review the answers, and **Confirm & Submit**. The local API saves a submission and captures the outgoing webhook body without sending it.
8. Open **Submission captures** to download the captured JSON. **Saved versions** restores a historical snapshot into a separate local draft, keeping the original history.

The Scout sample starts at the existing combined cap of 25. Remove a counted service before testing a new custom service, or remove an industry before adding a custom industry.

## Individual industry choices

Q4 now offers individual industries, including separate Financial, Accounting, CPA, Professional Services, Marketing, Design Firms, and Food Services choices. All previously combined options have been separated in the picker.

The picker groups these choices under nonselectable category headings. For example, Financial contains Financial, CPA, Accounting, and Insurance Agencies. Searching a category shows its choices. These sections only help locate options; they do not add pages or set the client's chosen navigation hierarchy.

Existing saved combined answers remain unchanged and count as one page until explicitly replaced. Their original predefined identities remain accepted for save and submission; opening a draft does not expand it into extra pages or push it over the selection limits.

## Agreed rules

- Two levels: parent and child. Standalone pages are allowed.
- Every node is a page, including parent pages.
- Removing a parent or moving it beneath another page promotes its existing children to the top level; no children are silently deleted.
- Sibling array position defines priority, starting at 1 independently for roots and each parent's children.
- Original service catalog parent identities remain excluded from selection counts, even when moved. Listed service options and custom pages count once, wherever placed. All industry pages count once.
- Limits remain 3–15 counted services, 1–10 industries, 1–5 locations, and a combined maximum of 25. Existing minimum-8 guidance is retained; no new lower-bound submission restriction was introduced for legacy clients.
- Legacy answers are not automatically converted on view. A suggested layout is derived without saving it until the client edits/adopts the question.
- An adopted question reset becomes an explicit empty structure, rather than reverting to legacy mode.

## Data format and future Zapier routing

Legacy submissions keep the existing flat arrays and `_other` strings. They do not acquire a version marker merely by being viewed.

If either Q3 or Q4 adopts the organizer, `metadata.questionnaire_payload_version` is `2`. `userdata.service_offerings_structure` and `userdata.target_industries_structure` are independently optional. A present structure is authoritative; an absent structure means use that question's legacy fields. An empty `pages` array is an explicit empty organized answer, not a legacy fallback.

```json
{
  "format": "page-tree-v1",
  "pages": [
    {
      "label": "Managed IT Services",
      "source": "predefined",
      "children": [
        { "label": "Managed IT", "source": "predefined" },
        { "label": "IT Compliance Consulting", "source": "custom" }
      ]
    },
    {
      "label": "UI Design",
      "source": "custom"
    }
  ]
}
```

Outbound page nodes contain only `label` and `source` (`predefined` or `custom`), plus a nonempty `children` array for parent pages. Child pages and standalone pages omit `children`. No page `id` or `catalogId` is exported. Individual labels remain separate, including labels containing commas. Legacy compatibility strings are generated from that structure; the flat fields do not carry navigation relationships or business priority.

Raw draft answers retain their internal page IDs, original catalog identities, and empty child arrays for editing, conflict protection, and the original service-parent counting rules. Serialization projects that editor state into the compact output without changing the draft. Previously saved ID-bearing mapped trees remain readable and are emitted in compact form when remapped or repaired. Submission validation compares page labels, sources, relationships, and order against the saved raw draft; it still rejects a changed hierarchy.

The future duplicate Zap should route absent/version-1 payloads through the existing process, version-2 payloads through the structured process, and resolve Q3/Q4 independently. Unknown formats/versions must stop for review. No Zap was created, duplicated, changed, or called during this implementation.

## Isolation and persistence

- The preview renders the existing questionnaire with local adapters. It does not instantiate the production App/Auth/Layout tracking flow.
- No Base44 SDK connection, Zapier webhook, remote AI, analytics, Google Places, or production file upload is enabled in the preview.
- Browser requests are restricted to the current origin by a network guard and CSP. Unknown local functions fail instead of forwarding remotely. Local PDF rendering may use same-origin frames.
- The local Node API uses the shared structure-validation contract, immutable identities, revision checks, and projection consistency checks. It is a local test adapter, not the hosted Base44 runtime.
- Drafts, revisions, submissions, and captures are written atomically into `.local-preview/state.json`; local uploads are under `.local-preview/uploads/`. These are ignored by Git. Browser state is separate at localhost; raw production recovery credentials are not imported.
- Failed writes roll back the local request, including deduplication state, so retries cannot falsely acknowledge an unsaved change.
- Older tabs and conflicting recovery backups cannot silently replace adopted questions. Conflicting offline copies are archived separately and offered for download.

## Verification and later release

```bash
npm test
npm run build:local
```

The local Base44 entity/function changes are included for future isolated-platform testing. Function tests execute against fake SDKs and local fixtures; no hosted backend verification has occurred. Before production, validate Base44 schema acceptance, function packaging, hosted concurrency behavior, and a duplicate Zap with a separate webhook and test-only action destinations.

The existing PDF renderer and its hierarchy formatting are covered by unit/integration tests. Remote AI, OAuth/social login, and external location validation are intentionally unavailable in the local preview.
