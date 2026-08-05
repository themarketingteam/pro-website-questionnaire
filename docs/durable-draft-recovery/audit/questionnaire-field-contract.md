# Questionnaire field contract

Audit date: 2026-08-05

Canonical schema source: `src/components/pro-form/questionData.jsx`

Render/validation source: `src/pages/ProQuestionnaire.jsx`

## Contract summary

The active configuration contains **33 canonical IDs: 25 top-level questions and 8 conditional children**. Of those, 32 are answer-capable and `1.2` is an informational row. No active question uses the generic `text` or `file_upload` type, although render components/branches exist for them.

Canonical response values live in `state.form.responses[id]`; auxiliary values use explicit keys noted below. Validation uses `state.form.validationStatus[id]`, with `''`/missing (neutral), `incomplete`, `complete`, and for AI-validated text `needs_work`. Browser persistence whitelists responses, validation, touched, expanded, and text-validation metadata. `ProFormDraft` serializes responses, validation, touched and expanded maps but not text-validation metadata.

## A. Question and output inventory

“PDF: Yes” means the PDF model always emits the configured row. Conditional child answers are populated only when the parent is `yes`; `1.2` always has a blank answer. “Draft: Partial” for Q5 means a later unrelated save/submit can capture the Redux value, but its own handlers do not queue a draft.

| ID | Parent | Summarized label | Type | Component | Response key | Auxiliary key(s) | Validation key | Visibility | Sensitive? | Final submission | PDF | Server draft |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `1` | — | Include Why Choose Us page | `yes_no` | `YesNoQuestion` | `1` | — | `1` | Always | No | `additional_pages_list.why_choose_us_page.generate_page` | Yes | Yes |
| `1.1` | `1` | Why Choose Us differentiators | `textarea` | `TextareaQuestion` | `1.1` | — | `1.1` | Parent `1=yes` and expanded | Yes, free text | `...why_choose_us_description` if parent yes | Yes, answer conditional | Yes |
| `1.2` | `1` | Certifications are collected at Q12 | `info_message` | `InfoMessageQuestion` | none | link to Q12 | `1.2` is logically complete, normally unset | Parent `1=yes` and expanded | No | No field | Yes, blank answer | No answer state |
| `2` | — | Include Meet the Team page | `yes_no` | `YesNoQuestion` | `2` | — | `2` | Always | No | `additional_pages_list.meet_the_team_page.generate_page` | Yes | Yes |
| `2.1` | `2` | Team overview introduction | `textarea` | `TextareaQuestion` | `2.1` | — | `2.1` | Parent `2=yes` and expanded | Yes, free text | `...team_introduction` if parent yes | Yes, answer conditional | Yes |
| `2.2` | `2` | Team photo and tagged people | `image_tagging` | `ImageTaggingQuestion` | `2.2` | nested `tags[].person` | `2.2` | Parent `2=yes` and expanded | Yes, image/person data | `...team_photo_with_tags` if parent yes | Yes, answer conditional | Yes after committed `onChange` |
| `3` | — | IT services offered | `checkbox` | `CheckboxQuestion` | `3` | `3_other`; `CATEGORY:<name>` tokens | `3` | Always | Auxiliary free text possible | `service_offerings`, `service_offerings_other` | Yes | Yes |
| `4` | — | Industries supported | `checkbox` | `CheckboxQuestion` | `4` | `4_other` | `4` | Always | Auxiliary free text possible | `target_industries`, `target_industries_other` | Yes | Yes |
| `5` | — | Service locations/regions | configured `multi_text`; geographic renderer | `MultiGeographicQuestion` | `5` | `5_primary` | `5` | Always | Yes, location data | `geographic_areas` | Yes | Partial |
| `6` | — | Plain-language company description | `textarea` | `TextareaQuestion` | `6` | — | `6` | Always | Yes, free text | `company_description` | Yes | Yes |
| `7` | — | Service delivery model | `radio` | `RadioQuestion` | `7` | `7_other` | `7` | Always | Auxiliary free text possible | `delivery_model`, `delivery_model_other` | Yes | Yes |
| `8` | — | Pricing/engagement models | `checkbox` | `CheckboxQuestion` | `8` | `8_other` | `8` | Always | Auxiliary free text possible | `pricing_packaging`, `pricing_packaging_other` | Yes | Yes |
| `9` | — | Competitive differentiation | `textarea` | `TextareaQuestion` | `9` | — | `9` | Always | Yes, free text | `differentiation` | Yes | Yes |
| `10` | — | 12–18 month goals | `checkbox` | `CheckboxQuestion` | `10` | `10_other` | `10` | Always | Auxiliary free text possible | `company_goals`, `company_goals_other` | Yes | Yes |
| `11` | — | Brand voice | `radio` | `RadioQuestion` | `11` | `11_other` | `11` | Always | Auxiliary free text possible | `brand_tone`, `brand_tone_other` | Yes | Yes |
| `12` | — | Has certifications/awards/partnerships | `yes_no` | `YesNoQuestion` | `12` | — | `12` | Always | No | Controls `certifications_partnerships` | Yes | Yes |
| `12.1` | `12` | Certification/accolade cards | `multi_certification` | `MultiCertificationQuestion` | `12.1` | nested image/files | `12.1` | Parent `12=yes` and expanded | Yes, names/files | `certifications_partnerships` if parent yes | Yes, answer conditional | Yes |
| `13` | — | Sales/onboarding process | `textarea` | `TextareaQuestion` | `13` | — | `13` | Always | Yes, free text | `sales_process` | Yes | Yes |
| `14` | — | Has guarantee/service standard | `yes_no` | `YesNoQuestion` | `14` | — | `14` | Always | No | `service_guarantee` boolean | Yes | Yes |
| `14.1` | `14` | Guarantee/service-standard cards | `multi_guarantee` | `MultiGuaranteeQuestion` | `14.1` | nested file/description | `14.1` | Parent `14=yes` and expanded | Yes, text/files | `service_guarantee_items` if parent yes | Yes, answer conditional | Yes |
| `15` | — | Client acquisition channels | `radio` | `RadioQuestion` | `15` | `15_other` | `15` | Always | Auxiliary free text possible | `client_acquisition`, `client_acquisition_other` | Yes | Yes |
| `16` | — | Primary website objectives | `checkbox` | `CheckboxQuestion` | `16` | `16_other` | `16` | Always | Auxiliary free text possible | `website_objectives`, `website_objectives_other` | Yes | Yes |
| `17` | — | Supported client-size range | `numeric_range` | `NumericRangeQuestion` | `17` | local editor fields until Confirm | `17` | Always | No | `client_size` | Yes | Yes after Confirm; typed intermediates No |
| `18` | — | Problems before hiring provider | `checkbox` | `CheckboxQuestion` | `18` | `18_other` | `18` | Always | Auxiliary free text possible | `client_challenges`, `client_challenges_other` | Yes | Yes |
| `19` | — | Client frustrations | `textarea` | `TextareaQuestion` | `19` | — | `19` | Always | Yes, free text | `client_frustrations` | Yes | Yes |
| `20` | — | Desired client outcomes | `checkbox` | `CheckboxQuestion` | `20` | `20_other` | `20` | Always | Auxiliary free text possible | `client_outcomes`, `client_outcomes_other` | Yes | Yes |
| `21` | — | Words describing value | `textarea` | `TextareaQuestion` | `21` | — | `21` | Always | Yes, free text | `value_description` | Yes | Yes |
| `22` | — | Ideal client description | `textarea` | `TextareaQuestion` | `22` | — | `22` | Always | Yes, free text | `ideal_client` | Yes | Yes |
| `23` | — | Has client types to avoid | `yes_no` | `YesNoQuestion` | `23` | — | `23` | Always | No | Controls `avoided_clients` | Yes | Yes |
| `23.1` | `23` | Client types not served | `textarea` | `TextareaQuestion` | `23.1` | — | `23.1` | Parent `23=yes` and expanded | Yes, free text | `avoided_clients` if parent yes; optional | Yes, answer conditional | Yes when entered |
| `24` | — | Primary website CTA | `radio` | `RadioQuestion` | `24` | `24_other` | `24` | Always | Auxiliary free text possible | `primary_cta`, `primary_cta_other` | Yes | Yes |
| `25` | — | Has additional content requests | `yes_no` | `YesNoQuestion` | `25` | — | `25` | Always | No | Controls `additional_notes` | Yes | Yes |
| `25.1` | `25` | Additional content instructions | `textarea` | `TextareaQuestion` | `25.1` | — | `25.1` | Parent `25=yes` and expanded | Yes, free text | `additional_notes` if parent yes; optional | Yes, answer conditional | Yes when entered |

## B. Canonical field contract

| ID | Canonical answer type | Empty representation | Validation representation/rule | Conditional dependency | Auxiliary keys | Submission mapping | PDF mapping | Draft mapping | Legacy aliases/normalization |
|---|---|---|---|---|---|---|---|---|---|
| `1` | `'yes' \| 'no'` | missing/`''` | complete only for valid choice and required active children | none | — | Why Choose Us `generate_page: answer==='yes'` | formatted yes/no | `responses_json['1']` and mapped payload | none |
| `1.1` | string | missing/`''` | AI status `complete` or `needs_work`; required when active | `1==='yes'` | — | trimmed description or `''` | text only when active | `responses_json['1.1']` | none |
| `1.2` | no answer | no key | informational; logically complete/non-participating | `1==='yes'` | — | none | configured row, blank answer | no canonical response | **ID collision:** persisted legacy `1.2` yes/no migrates to Q12 and is then deleted; active `1.2` must never store an answer |
| `2` | `'yes' \| 'no'` | missing/`''` | valid choice plus required active children | none | — | Meet Team `generate_page` | formatted yes/no | `responses_json['2']` | none |
| `2.1` | string | missing/`''` | AI status accepted as above; required active child | `2==='yes'` | — | trimmed team introduction | conditional text | `responses_json['2.1']` | none |
| `2.2` | `{url,name,type,tags:[{x,y,person:{name,position,bio}}]}` | missing/null | URL + at least one tag + every person name | `2==='yes'` | nested `tags` | normalized `team_photo_with_tags`; otherwise `{has_team_photo:false}` | formatted tagged-photo answer when active | committed object in `responses_json['2.2']` | normalizer accepts safe URL/name/tag shape variants; never raw File |
| `3` | `string[]` | `[]` | 3–15 combined base + nonblank `_other` entries | none | `3_other: string[]\|string`; `CATEGORY:*` | categories expand to services; other joined string | selections + other | both response keys | category tokens are canonical UI values; string-like inputs normalized/deduped |
| `4` | `string[]` | `[]` | 1–10 combined base + other entries | none | `4_other` | industry list + other joined string | selections + other | both response keys | array strings normalized/deduped |
| `5` | location object array | `[]` | 1–5 entries in handler/completion; configured guidance’s combined Q3–Q5 rule is not a completion check (UI disables new span choices at 25) | none | `5_primary: number` | `geographic_areas[].geographic_area_meta`; primary derived by index | location labels with primary | `responses_json['5']`/`['5_primary']` only on later unrelated save/submit | accepts strings and nested `geographic_area_meta`/`meta`/`location`/`place`; `lat/latitude`, `lon/lng/longitude`, `placeId/place_id` |
| `6` | string | missing/`''` | AI status `complete` or `needs_work` | none | — | trimmed `company_description` | text | direct response | scalar/object string-like values repaired by submission normalizer only |
| `7` | option string or `'Other'` | missing/`''` | option, or Other plus nonblank `_other` | none | `7_other: string` | `delivery_model`, `_other` | selected/other text | both keys | legacy custom inline value migrates to `Other` + `_other` on rehydrate |
| `8` | `string[]` | `[]` | 1–3 including other entries | none | `8_other` | `pricing_packaging`, `_other` | selections + other | both keys | array/string other repaired |
| `9` | string | missing/`''` | AI status accepted | none | — | trimmed `differentiation` | text | direct response | string-like repair at payload boundary |
| `10` | `string[]` | `[]` | 1–3 including other entries | none | `10_other` | `company_goals`, `_other` | selections + other | both keys | standard selection normalization |
| `11` | option string or `'Other'` | missing/`''` | option or Other + nonblank auxiliary | none | `11_other` | `brand_tone`, `_other` | selected/other text | both keys | legacy inline custom -> `Other` + auxiliary |
| `12` | `'yes' \| 'no'` | missing/`''` | valid choice plus Q12.1 completeness when yes | none | — | controls whether certifications array is populated | formatted yes/no | direct response | persisted legacy Q1.2 yes/no migrates here only when canonical empty |
| `12.1` | certification item array | `[]` | 1–20; valid item has nonblank name/type and compatible `saved` state | `12==='yes'` | nested `image`, `files`, UI `saved` | normalized cert item name/type/image/file(s) | formatted items when active | entire array | persisted legacy `1.2.1`; item aliases include label/category/tag/imageUrl/fileUrl/supporting_files |
| `13` | string | missing/`''` | AI status accepted | none | — | trimmed `sales_process` | text | direct response | string-like repair |
| `14` | `'yes' \| 'no'` | missing/`''` | valid choice plus Q14.1 completeness when yes | none | — | `service_guarantee: boolean` | formatted yes/no | direct response | boolean-like conversion only in payload helper contexts; Redux requires yes/no |
| `14.1` | guarantee item array | `[]` | 1–10; name + type + (file or description), compatible `saved` | `14==='yes'` | nested `file`; current `uploadingFile` pollution | normalized guarantee items | formatted items when active | entire array | aliases include label/category/tag/fileUrl/file_name/guarantee_* |
| `15` | option string or `'Other'` | missing/`''` | option or Other + auxiliary | none | `15_other` | `client_acquisition`, `_other` | selected/other text | both keys | inline custom -> Other + auxiliary |
| `16` | `string[]` | `[]` | 1–3 including other | none | `16_other` | `website_objectives`, `_other` | selections + other | both keys | standard selection normalization |
| `17` | formatted string, e.g. `"5-250 employees"` or `"5-5000+ employees"` | `''`/missing | nonblank committed string; local min<=max checked on Confirm | none | local `smallest*`/`largest*`, not response keys | trimmed `client_size` | formatted string | response only after Confirm; typing queues `''` | parser accepts only current formatted regex on component restore; no canonical aliases |
| `18` | `string[]` | `[]` | 1–3 including other | none | `18_other` | `client_challenges`, joined `_other` | selections + other | both keys | standard selection normalization |
| `19` | string | missing/`''` | AI status accepted | none | — | trimmed `client_frustrations` | text | direct response | string-like repair |
| `20` | `string[]` | `[]` | 1–3 including other | none | `20_other` | `client_outcomes`, joined `_other` | selections + other | both keys | standard selection normalization |
| `21` | string | missing/`''` | AI status accepted | none | — | trimmed `value_description` | text | direct response | string-like repair |
| `22` | string | missing/`''` | AI status accepted | none | — | trimmed `ideal_client` | text | direct response | string-like repair |
| `23` | `'yes' \| 'no'` | missing/`''` | valid choice; optional child does not gate completion | none | — | controls `avoided_clients` | formatted yes/no | direct response | none |
| `23.1` | string | missing/`''` | optional; if entered, AI validation metadata can apply | `23==='yes'` | — | trimmed `avoided_clients`; otherwise `''` | conditional text | direct response if present | v3 rehydrate removes it when parent not yes and neutralizes empty active value |
| `24` | option string or `'Other'` | missing/`''` | option or Other + auxiliary | none | `24_other` | `primary_cta`, `_other` | selected/other text | both keys | inline custom -> Other + auxiliary |
| `25` | `'yes' \| 'no'` | missing/`''` | valid choice; optional child does not gate completion | none | — | controls `additional_notes` | formatted yes/no | direct response | none |
| `25.1` | string | missing/`''` | optional; if entered, AI validation metadata can apply | `25==='yes'` | — | trimmed `additional_notes`; otherwise `''` | conditional text | direct response if present | v3 rehydrate removes it when parent not yes and neutralizes empty active value |

## Q5 canonicalization detail

The UI currently emits plain objects with `name`, `label`, `lat`, `lon`, `place_id`, `source`, `originalName`, `originalLabel`, `isGreaterArea`, and `isCity`. `normalizeGeographicAreas` converts historical/nested shapes to a reduced internal plain object; submission then produces:

```json
{
  "geographic_area_meta": {
    "name": "Example City, XY",
    "label": "Example City, XY",
    "lat": "35.1",
    "lon": "-86.7",
    "place_id": "synthetic-place-id",
    "source": "google",
    "primary": true
  }
}
```

The separate `5_primary` index is canonical today but fragile under deletion/reordering. A future contract should use stable location IDs and derive `primary` inside one atomic location mutation.

## Validation and conditional caveats

1. All top-level questions except informational rows participate in form completion. Only conditional children with `requiredIfParentYes: true` participate while active; `23.1` and `25.1` are optional.
2. The current form accepts textarea status `complete` or `needs_work` through the generic status fast path. Submit-time validation runs for dirty/unvalidated populated textareas.
3. Q3–Q5 instructions describe a combined selection balance, but current completion checks enforce only each field’s local minimum/maximum. The page calculates a combined total, colors values below 8/above 15, and blocks new Q3/Q4/Q5 selections only at 25. This is documented behavior, not an endorsed contract.
4. Hidden children are omitted/blanked by final mapping and PDF answer population even if a stale response survives elsewhere. Server draft raw `responses_json` can still contain the stale value because parent save ordering precedes cleanup.
5. Browser normalization recognizes only known IDs plus `_other`/`_primary`, migrates legacy certification IDs, coerces schema types, and removes inactive child responses. Server drafts do not automatically receive that repaired browser state.

## Field-contract certification checks

- Expected and audited canonical IDs: 33.
- Top-level/child split: 25/8.
- Conditional parents: `1`, `2`, `12`, `14`, `23`, `25`.
- Conditional children: `1.1`, `1.2`, `2.1`, `2.2`, `12.1`, `14.1`, `23.1`, `25.1`.
- Active rendered types: `yes_no`, `textarea`, `info_message`, `image_tagging`, `checkbox`, `multi_text` (Q5 geographic specialization), `radio`, `multi_certification`, `multi_guarantee`, and `numeric_range`.
- Dormant supported render types: generic `file_upload`; generic plain `text` handling exists in mutation/validation logic but has no active configured row.
