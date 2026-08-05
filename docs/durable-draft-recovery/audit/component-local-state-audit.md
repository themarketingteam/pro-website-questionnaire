# Component-local state and serialization audit

Audit date: 2026-08-05

Scope: every `useState`, `useRef`, or `useReducer` declaration under `src/components/pro-form`, plus the page-level state that assembles, saves, submits, or retains questionnaire answers.

## Counts and notation

- 15 files under `src/components/pro-form` use one or more audited hooks.
- They declare 59 state/ref values; no `useReducer` declaration exists there.
- `ProQuestionnaire` adds 20 orchestration state/ref values, for 79 audited declarations total.
- 19 declarations are marked **AB** (answer-bearing): they can hold client-authored content, a committed-answer mirror, a DOM-owned selected file/search value, confirmation metadata, or the post-submit answer snapshot. This count does not include derived validation messages, error text, IDs, timers, or callbacks.
- **Class:** `C` committed answer/mirror, `I` incomplete editor state, `V` validation state, `T` transient visual/orchestration state, `N` nonserializable browser object. Multiple letters are intentional.
- **Y/N/P:** yes/no/partial. Partial means only a committed subset restores; the newest incomplete editor value does not.
- Proposed destinations use the required vocabulary: `responses`, `uiDraftState`, `credentials`, `upload metadata`, or `transient only`.

## State/ref inventory

| # | AB | Component | State/ref | Type | Synthetic example | Class | Current source of truth | Redux | Browser | Draft | Reload | Close | Final | PDF | Future destination | Serialization safety | Required test |
|---:|:--:|---|---|---|---|:--:|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|---|---|
| 1 |  | `ImageTaggingQuestion` | `isUploading` | boolean | `true` | T | local state | N | N | N | N | N | N | N | upload metadata | JSON-safe but semantically transient | T-STATE-001 |
| 2 |  | same | `showModal` | boolean | `true` | T | local state | N | N | N | N | N | N | N | uiDraftState | Safe | T-STATE-002 |
| 3 | AB | same | `tags` | tag array | `[{x:25,y:40,person:null}]` | C/I | local mirror initialized from `responses['2.2'].tags` | P | P | P | P | P | P | P | responses + uiDraftState | Safe only after stripping non-plain values; current shape is plain | T-STATE-003 |
| 4 |  | same | `editingTag` | index/null | `0` | I/T | local state | N | N | N | N | N | N | N | uiDraftState | Safe, but index is unstable after reorder/delete | T-STATE-004 |
| 5 | AB | same | `tempPerson` | object | `{name:'Example Person',position:'Role',bio:'Draft bio'}` | I | local state | N | N | N | N | N | N until Save | N until Save | uiDraftState | Safe plain object; may contain sensitive free text | T-STATE-005 |
| 6 |  | same | `imageRef` | DOM image node/null | `<img>` | N | browser DOM | N | N | N | N | N | N | N | transient only | Not serializable; may be circular | T-STATE-006 |
| 7 | AB | same | `fileInputRef` | DOM input/FileList handle | `<input type=file>` | I/N | browser DOM | N | N | N | N | N | N | N | upload metadata | Do not serialize node, `FileList`, or `File` | T-STATE-007 |
| 8 |  | `MultiGuaranteeQuestion` | `expandedIndex` | index/null | `1` | T | local state | N | N | N | N | N | N | N | uiDraftState | Safe but index is unstable | T-STATE-008 |
| 9 | AB | `ConfirmModal` | `businessName` | string | `Example Company` | I | local state seeded from URL/credentials | N | N | N | N | N | Y on confirm | Y live | credentials | Safe string; potentially sensitive | T-STATE-009 |
| 10 | AB | same | `domain` | string | `example.invalid` | I | local state seeded from URL/credentials | N | N | N | N | N | Y on confirm | Y, cleaned live | credentials | Safe string; validate/normalize | T-STATE-010 |
| 11 |  | same | `submitError` | string | `Recovery code available` | V/T | local state | N | N | N | N | N | N | N | uiDraftState | Safe only after secret-free error normalization | T-STATE-011 |
| 12 |  | same | `submitAttemptRef` | boolean | `true` | T | local ref | N | N | N | N | N | N | N | transient only | Safe but must not restore as in-flight | T-STATE-012 |
| 13 |  | same | `fieldErrors` | object | `{domain:'Required'}` | V | local state | N | N | N | N | N | N | N | uiDraftState | Safe derived messages | T-STATE-013 |
| 14 |  | same | `businessNameRef` | DOM input/null | `<input>` | N | browser DOM | N | N | N | N | N | N | N | transient only | Not serializable | T-STATE-014 |
| 15 |  | same | `domainRef` | DOM input/null | `<input>` | N | browser DOM | N | N | N | N | N | N | N | transient only | Not serializable | T-STATE-015 |
| 16 |  | `ReduxDataValidator` | `isVisible` | boolean | `false` | T | dev-panel local state | N | N | N | N | N | N | N | transient only | Safe | T-STATE-016 |
| 17 |  | same | `validationResults` | diagnostic object/null | `{timestamp:'synthetic',checks:[]}` | V | derived from Redux/localStorage | N | N | N | N | N | N | N | transient only | Safe if details never copy answers; current details are counts/status | T-STATE-017 |
| 18 | AB | `AIContentModal` (dormant) | `userInstruction` | string | `Emphasize reliability` | I | local state | N | N | N | N | N | N | N | uiDraftState | Safe string but potentially sensitive | T-STATE-018 |
| 19 | AB | same | `draftContent` | string | `Synthetic generated paragraph` | I | local state | N | N | N | N | N | N until Inject | N until Inject | uiDraftState | Safe string; potentially sensitive | T-STATE-019 |
| 20 |  | same | `isGenerating` | boolean | `true` | T | local state | N | N | N | N | N | N | N | transient only | Safe; never restore in-flight | T-STATE-020 |
| 21 |  | same | `isCheckingGrammar` | boolean | `true` | T | local state | N | N | N | N | N | N | N | transient only | Safe; never restore in-flight | T-STATE-021 |
| 22 | AB | same | `aiQuestions` | string | `Which service is primary?` | I | local state | N | N | N | N | N | N | N | uiDraftState | Safe string; potentially sensitive | T-STATE-022 |
| 23 |  | `CheckboxQuestion` | `showModal` | boolean | `true` | T | local state | N | N | N | N | N | N | N | uiDraftState | Safe | T-STATE-023 |
| 24 |  | same | `modalCategory` | string | `Cloud Solutions` | T | local state | N | N | N | N | N | N | N | uiDraftState | Safe enum-like string | T-STATE-024 |
| 25 |  | same | `shownModals` | `Set<string>` | `Set(['Cloud Solutions'])` | N/T | local state | N | N | N | N | N | N | N | uiDraftState | `Set` is not canonical JSON; encode as string array if retained | T-STATE-025 |
| 26 |  | `useTextValidation` | `validationState` | object | `{status:'yellow',message:'Add detail',charCount:120,expectedRange:null}` | V | local validation result | N (status separately copied) | N | N | N | N | gates indirectly | N | uiDraftState | Plain JSON, but bind to answer hash and safe message | T-STATE-026 |
| 27 |  | same | `isValidating` | boolean | `true` | T | local state | N | N | N | N | N | N | N | transient only | Safe; never restore in-flight | T-STATE-027 |
| 28 |  | same | `validationInFlightRef` | boolean | `true` | T | local ref | N | N | N | N | N | N | N | transient only | Safe; never restore | T-STATE-028 |
| 29 | AB | same | `lastValidatedValueRef` | string | `Synthetic validated answer` | C/V | local ref mirror of answer used for validation | N (`textValidationMeta` is a separate copy only on final validation) | N | N | N | N | validation comparison only | N | uiDraftState | Safe string; potentially sensitive; version/hash preferred | T-STATE-029 |
| 30 |  | `FileUploadQuestion` (dormant type) | `isUploading` | boolean | `true` | T | local state | N | N | N | N | N | N | N | upload metadata | Safe but semantically belongs to upload record | T-STATE-030 |
| 31 |  | same | `error` | string/null | `UPLOAD_FAILED` | V/T | local state | N | N | N | N | N | N | N | upload metadata | Use safe code, not raw exception | T-STATE-031 |
| 32 |  | `QuestionWrapper` | `showModal` | boolean | `true` | T | local help-modal state | N | N | N | N | N | N | N | transient only | Safe | T-STATE-032 |
| 33 |  | `MultiCertificationQuestion` | `uploading` | object map | `{'item-a-image':true}` | T | local state keyed by array index/field | N | N | N | N | N | N | N | upload metadata | Safe JSON, unstable key; use item/upload IDs | T-STATE-033 |
| 34 |  | same | `expandedIndex` | index/null | `0` | T | local state | N | N | N | N | N | N | N | uiDraftState | Safe but index unstable | T-STATE-034 |
| 35 |  | `AutoSaveIndicator` | `visible` | boolean | `true` | T | local visual state | N | N | N | N | N | N | N | transient only | Safe | T-STATE-035 |
| 36 |  | same | `fading` | boolean | `false` | T | local visual state | N | N | N | N | N | N | N | transient only | Safe | T-STATE-036 |
| 37 | AB | `MultiGeographicQuestion` | `autocompleteRef` | Google web component | `PlaceAutocompleteElement` | I/N | browser/Google component owns current search text | N | N | N | N | N | N | N | uiDraftState (query only) | Never serialize handle/result; mirror safe query string | T-STATE-037 |
| 38 |  | same | `autocompleteContainerRef` | DOM node/null | `<div>` | N | browser DOM | N | N | N | N | N | N | N | transient only | Not serializable/circular | T-STATE-038 |
| 39 | AB | same | `selectedLocationsRef` | location array ref | `[{label:'Example City',place_id:'synthetic'}]` | C | mirror of `responses['5']` used by async handler | Y (canonical prop) | Y (canonical prop) | N for Q5 mutation | Y from browser | Y from browser | Y | Y | responses | Plain only after Google result normalization; ref can be stale | T-STATE-039 |
| 40 |  | same | `retryCountRef` | number | `2` | T | local ref | N | N | N | N | N | N | N | transient only | Safe | T-STATE-040 |
| 41 |  | same | `isScriptLoaded` | boolean | `true` | T | local state | N | N | N | N | N | N | N | transient only | Safe | T-STATE-041 |
| 42 |  | same | `isLoading` | boolean | `false` | T | local state | N | N | N | N | N | N | N | transient only | Safe | T-STATE-042 |
| 43 |  | same | `loadError` | boolean | `true` | V/T | local state | N | N | N | N | N | N | N | uiDraftState | Safe; optional recovery UX state | T-STATE-043 |
| 44 |  | same | `errorMessage` | string | `Location search unavailable` | V/T | local state | N | N | N | N | N | N | N | uiDraftState | Use fixed safe messages/codes | T-STATE-044 |
| 45 | AB | same | `manualInput` | string | `Example Region` | I | local state | N | N | N | N | N | N until Add | N until Add | uiDraftState | Safe string; potentially location-sensitive | T-STATE-045 |
| 46 |  | same | `showManualEntry` | boolean | `true` | T | local state | N | N | N | N | N | N | N | uiDraftState | Safe | T-STATE-046 |
| 47 |  | same | `autocompleteCleanupRef` | function/null | `() => removeListener()` | N | local ref | N | N | N | N | N | N | N | transient only | Function is not serializable; may close over browser objects | T-STATE-047 |
| 48 |  | `TextareaQuestion` | `onValidationChangeRef` | function | `(status) => void` | N | local callback ref | N | N | N | N | N | N | N | transient only | Function is not serializable | T-STATE-048 |
| 49 |  | same | `lastSentRef` | string/null | `complete` | V/T | local ref | N | N | N | N | N | N | N | uiDraftState | Safe enum, but derivable from revisioned validation | T-STATE-049 |
| 50 | AB | `NumericRangeQuestion` | `smallest` | number | `5` | I | local editor state | N | N | N | N | N | N until Confirm | N until Confirm | uiDraftState | Safe finite integer | T-STATE-050 |
| 51 | AB | same | `largest` | number | `250` | I | local editor state | N | N | N | N | N | N until Confirm | N until Confirm | uiDraftState | Safe finite integer; `5001` sentinel should be explicit | T-STATE-051 |
| 52 | AB | same | `smallestInput` | string | `05` | I | local editor state | N | N | N | N | N | N until Confirm | N until Confirm | uiDraftState | Safe string; validate before parse | T-STATE-052 |
| 53 | AB | same | `largestInput` | string | `250` | I | local editor state | N | N | N | N | N | N until Confirm | N until Confirm | uiDraftState | Safe string | T-STATE-053 |
| 54 |  | same | `isLocked` | boolean | `false` | T | local state | N | N | N | N | N | N | N | uiDraftState | Safe; can derive from committed answer/editor revision | T-STATE-054 |
| 55 |  | same | `validationError` | string | `Minimum exceeds maximum` | V | local state | N | N | N | N | N | N | N | uiDraftState | Prefer safe error code + localized message | T-STATE-055 |
| 56 |  | same | `smallestTimerRef` | timer handle/null | `42` | N/T | browser timer | N | N | N | N | N | N | N | transient only | Browser handle is not portable/serializable | T-STATE-056 |
| 57 |  | same | `largestTimerRef` | timer handle/null | `43` | N/T | browser timer | N | N | N | N | N | N | N | transient only | Browser handle is not portable/serializable | T-STATE-057 |
| 58 |  | `useQuestionnairePdfDownload` | `isGeneratingPDF` | boolean | `true` | T | local state | N | N | N | N | N | N | N | transient only | Safe; never restore as running | T-STATE-058 |
| 59 |  | same | `isDownloadInProgressRef` | boolean | `true` | T | local ref | N | N | N | N | N | N | N | transient only | Safe; never restore | T-STATE-059 |
| 60 |  | `ProQuestionnaire` | `isSubmitting` | boolean | `true` | T | page state | N | N | N | N | N | N | N | transient only | Safe; server receipt must determine recovery | T-STATE-060 |
| 61 |  | same | `finalSubmitInFlightRef` | boolean | `true` | T | page ref | N | N | N | N | N | N | N | transient only | Safe; never restore | T-STATE-061 |
| 62 |  | same | `showAutoSave` | counter | `12` | T | page state | N | N | N | N | N | N | N | transient only | Safe but not proof of a save | T-STATE-062 |
| 63 |  | same | `showConfirmModal` | boolean | `true` | T | page state | N | N | N | N | N | N | N | uiDraftState | Safe | T-STATE-063 |
| 64 |  | same | `showThankYouModal` | boolean | `true` | T | page state | N | N | N | N | N | N | N | uiDraftState | Safe; ideally derived from durable receipt | T-STATE-064 |
| 65 | AB | same | `submittedBusinessName` | string | `Example Company` | C | local post-submit snapshot | N | N | N | N | N | Y already submitted | Y | credentials / durable receipt | Safe string; potentially sensitive | T-STATE-065 |
| 66 | AB | same | `submittedDomain` | string | `example.invalid` | C | local post-submit snapshot | N | N | N | N | N | Y already submitted | Y | credentials / durable receipt | Safe string | T-STATE-066 |
| 67 | AB | same | `submittedFormData` | response map | `{'6':'Synthetic answer'}` | C | local post-submit snapshot | N | N | N | N | N | Y already submitted | Y | responses / durable receipt | Must be deep-normalized; shallow snapshot can retain mutable nested values | T-STATE-067 |
| 68 |  | same | `showClearAllModal` | boolean | `false` | T | page state | N | N | N | N | N | N | N | transient only | Safe | T-STATE-068 |
| 69 |  | same | `showIncompleteList` | boolean | `true` | T | page state | N | N | N | N | N | N | N | uiDraftState | Safe | T-STATE-069 |
| 70 |  | same | `isValidating` | boolean | `true` | T | page state | N | N | N | N | N | N | N | transient only | Safe; never restore | T-STATE-070 |
| 71 |  | same | `validatingQuestions` | ID array | `['6','9']` | V/T | page state | N | N | N | N | N | gates UI | N | transient only | Safe canonical IDs; derive from validation job | T-STATE-071 |
| 72 |  | same | `hasTrackedStart` | boolean | `true` | T | page analytics state | N | N | N | N | N | N | N | transient only | Safe | T-STATE-072 |
| 73 |  | same | `trackedTypingQuestionsRef` | `Set<string>` | `Set(['6'])` | N/T | page ref | N | N | N | N | N | N | N | transient only | `Set` not canonical JSON; analytics only | T-STATE-073 |
| 74 |  | same | `draftSaveTimeoutRef` | timer handle/null | `42` | N/T | browser timer | N | N | N | N | N | N | N | transient only | Not portable/serializable | T-STATE-074 |
| 75 |  | same | `draftTextEventTimeoutsRef` | timer map | `{'6':43}` | N/T | browser timers | N | N | N | N | N | N | N | transient only | Not portable/serializable | T-STATE-075 |
| 76 |  | same | `draftRecordIdRef` | string | `synthetic-draft-id` | T | page ref populated by server write/filter | N | N | represented by entity identity | N | N | submission helper only | N | uiDraftState | Safe opaque ID; verify ownership before use | T-STATE-076 |
| 77 |  | same | `hasFinalSubmittedRef` | boolean | `true` | T | page ref | N | N | N | N | N | N | N | transient only | Safe; durable receipt should be authoritative | T-STATE-077 |
| 78 |  | same | `lastChangedQuestionIdRef` | question ID string | `6` | T | page ref | N | N | copied into later draft save | N | N | N | N | uiDraftState | Safe canonical ID | T-STATE-078 |
| 79 |  | same | `questionnaireSessionId` | string | `synthetic-session-id` | T | page state seeded from localStorage | N | Y | Y as `session_id` | Y | Y (localStorage survives ordinary close) | Y as recovery linkage | N | uiDraftState | Safe opaque ID; never treat as authorization | T-STATE-079 |

## Controlled editors that do not hide answer text in local React state

`MultiCertificationQuestion` and `MultiGuaranteeQuestion` are custom multi-card editors, but their card content is controlled by the `value` prop and every add/edit/remove/save calls `onChange`; the answer array therefore reaches Redux/browser/draft/event through `updateResponse`. Their local state is only expansion/upload UI. Raw `File` values still exist transiently in event handlers, and guarantee `uploadingFile` currently enters the canonical answer array.

`CheckboxQuestion` edits canonical selection and `_other` values through props/callbacks. Its local `Set` only remembers which category explanation modals have been shown. `TextareaQuestion` is controlled by Redux on every keystroke; its validation hook separately holds a copy of the last validated answer.

## Nonserializable data audit

| Value | Current occurrence | Canonical JSON rule | Recoverable representation / handling | Test |
|---|---|---|---|---|
| `File` | Image, generic file, certification and guarantee upload handlers | Never place the object in Redux, draft, event, final payload, or PDF model | Persist upload record fields below; keep bytes in upload transport only | T-SER-001 |
| `Blob` | No active state holder; payload repair rejects/strips unsupported objects; PDF libraries may create blobs internally | Never canonical | Regenerate from durable data or upload and retain URL/metadata | T-SER-002 |
| `FileList` | `event.target.files` and DOM file inputs | Never canonical | Select one/more files and immediately convert to safe upload records | T-SER-003 |
| DOM node | `imageRef`, `fileInputRef`, confirmation refs, autocomplete container, PDF DOM | Never canonical | Recreate on render; store only semantic state | T-SER-004 |
| Event object | input/change/click/key/Google event handlers | Never canonical | Extract primitive value, coordinates, file, or safe place fields synchronously | T-SER-005 |
| Function | callback refs, cleanup/unsubscribe closures, timer callbacks | Never canonical | Recreate; persist declarative status only | T-SER-006 |
| Circular object | DOM/Google objects and arbitrary SDK responses may be circular | Never canonical; do not rely on circular-string replacement as data | Whitelist and normalize plain fields before dispatch | T-SER-007 |
| `AbortController` | Submission/network helper lifecycle, not answer state | Never canonical | Recreate per request; persist safe request/upload ID and status | T-SER-008 |
| Browser handle | timeout IDs, agent unsubscribe, canvas/jsPDF, web component handles | Never canonical | Recreate; persist only job status/revision if useful | T-SER-009 |
| Google Place/result | `placePrediction.toPlace()`, `Place`, location methods, address component objects | Never dispatch raw object | Current code correctly extracts a plain location object; continue strict whitelist | T-SER-010 |

### Required recoverable file representation

Future upload state must use a plain, versioned JSON record such as:

```json
{
  "url": "https://files.example.invalid/synthetic-file",
  "originalFilename": "example-document.pdf",
  "mimeType": "application/pdf",
  "size": 12345,
  "uploadStatus": "uploaded",
  "base44FileId": "synthetic-file-id",
  "uploadErrorCode": ""
}
```

All seven fields are required in the contract, although `url`/`base44FileId` are empty before success and `uploadErrorCode` is empty outside failure. MIME must be allowlisted and filename normalized. The current components retain URL/name and sometimes MIME, but generally omit size, upload status, Base44 identifier, and a durable safe error code. The current upload API destructuring only captures `file_url`; if Base44 does not return an identifier, `base44FileId` remains empty rather than being invented.

## Restoration conclusions

Redux-persist restores committed answer slices on reload/close, subject to v3 normalization. No public route hydrates from `ProFormDraft`. All 19 AB entries need an explicit outcome: committed content in `responses`, incomplete text/editor state in `uiDraftState`, confirmation data in `credentials`, file lifecycle in `upload metadata`, and browser/SDK handles kept transient. Raw browser objects must never be used as proof that a client entry is recoverable.
