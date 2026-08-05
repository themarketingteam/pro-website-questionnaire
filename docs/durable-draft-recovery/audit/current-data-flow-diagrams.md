# Current data-flow diagrams

Status: static “as implemented” diagrams<br>
Branch/revision: `feature/durable-draft-recovery` at `73ece4c`<br>
Audit date: 2026-08-05

These diagrams describe current source behavior. Red/dashed paths identify gaps or non-durable steps; they are not proposed designs.

## 1. Client answer → Redux → browser storage

```mermaid
flowchart TD
    User["Questionnaire user"] --> Control["Question component"]
    Control -->|"most controls: onChange"| Update["ProQuestionnaire.updateResponse"]
    Update --> ResponseAction["setResponse"]
    Update --> Validation["updateQuestionValidation / updateValidationState"]
    Update --> Touched["setTouchedQuestion"]
    ResponseAction --> Form["Redux form slice"]
    Validation --> Form
    Touched --> Form
    Form -->|"whitelist serialization"| Persist["redux-persist"]
    Persist --> RootKey["localStorage: persist:pro-questionnaire-root"]

    Q5["Question 5 handlers"] -->|"direct dispatch"| Form
    Q5 -. "bypasses updateResponse" .-> Gap["No Q5 server-save/event call"]

    RootKey -->|"next route load"| Gate["PersistGate"]
    Gate --> Normalize["v2/v3 migrations + normalization transform"]
    Normalize --> Form

    Creds["URL business/user parameters"] -->|"setCredentials"| Form
    Form -. "credentials excluded from whitelist" .-> NotPersisted["Credentials not browser-persisted by Redux"]
```

The persisted browser key is not namespaced by user, client, business, or session. `responses`, validation, touched, expanded, and text-validation metadata are persisted; credentials are excluded.

## 2. Client answer → ProFormDraft and event

```mermaid
flowchart TD
    Change["Most answer changes"] --> Merge["Merge new value into render-time responses"]
    Merge --> Queue["queueDraftSave(questionId, nextResponses)"]
    Queue -->|"replace pending timer"| Timer["600 ms setTimeout"]
    Timer --> Snapshot["createSaveDraftSnapshot"]
    Snapshot --> Map["Transform responses to mapped payload"]
    Map --> Find["ProFormDraft.filter by session_id"]
    Find --> Existing{"Draft found or cached?"}
    Existing -->|"yes"| Update["ProFormDraft.update"]
    Existing -->|"no"| Create["ProFormDraft.create"]
    Create --> Cache["Cache returned draft ID in ref"]

    Change --> EventQueue["queueDraftEvent"]
    EventQueue --> EventMode{"Text field?"}
    EventMode -->|"yes"| EventTimer["1 s debounce"]
    EventMode -->|"no"| EventWrite["ProFormDraftEvent.create"]
    EventTimer --> EventWrite

    Timer -. "closure supplies earlier validation / touched / expanded maps" .-> Stale["Potential internally inconsistent snapshot"]
    Find -. "separate filter then create" .-> Race["Concurrent first saves can duplicate"]
    Q5["Q5 / Reset Question / Clear All"] -. "no call" .-> Queue
    Update -. "no revision or status guard" .-> Regression["In-flight draft write may finish after submit"]
    Create -. "save error" .-> Backup["localStorage session backup"]
    Update -. "save error" .-> Backup
```

The filter in this path locates a write target; it does not hydrate the questionnaire from a server draft.

## 3. Current submission path

```mermaid
flowchart TD
    Click["Submit click"] --> FinalValidation["Validate dirty/unvalidated textareas"]
    FinalValidation -->|"fails"| Block["Mark incomplete + show list"]
    FinalValidation -->|"passes"| FullValidation["isFormValid"]
    FullValidation -->|"fails"| Block
    FullValidation -->|"passes"| Modal["ConfirmModal"]
    Modal --> Confirm["Confirm business name + domain"]
    Confirm --> CancelTimer["Cancel pending draft timer"]
    CancelTimer --> Submit["submitProQuestionnaire"]
    Submit --> AttemptEvent["Create submit_attempted event"]
    AttemptEvent --> AttemptDraft["Best-effort draft status: submit_attempted"]
    AttemptDraft --> Transform["Transform, repair, validate payload"]

    Transform -->|"valid payload"| Direct["Direct ProFormSubmission.create with retry"]
    Direct -->|"success"| Durable["Final submission exists"]
    Direct -->|"failure"| Fallback["Invoke submitProQuestionnaireFallback"]
    Transform -->|"transform/validation failure"| FailDraft["Best-effort draft status: submit_failed"]
    FailDraft --> LocalBackup["Write failed submission backup"]
    LocalBackup --> Fallback

    Fallback -->|"final created"| Durable
    Fallback -->|"intake created"| Intake["ProFormSubmissionIntake exists"]
    Fallback -->|"not remotely listed / call fails"| HardFail["Reject with recovery code"]
    Fallback -->|"final + intake both fail"| HardFail

    Durable --> SubmittedDraft["Best-effort draft status: submitted"]
    Intake --> SubmittedDraft
    SubmittedDraft --> SubmitEvent["Create submitted / intake event"]
    SubmitEvent --> ZapierGate{"Final exists and Zapier not already sent?"}
    ZapierGate -->|"yes"| Zapier["Invoke sendToZapier"]
    ZapierGate -->|"no"| UISuccess["Client success callback"]
    Zapier -->|"success or best-effort failure"| UISuccess
    UISuccess --> Memory["Keep submitted response snapshot in React state"]
    Memory --> Reset["resetForm"]
    Reset --> ThankYou["Open ThankYouModal in place"]

    AttemptDraft -. "save failure is nonfatal" .-> Transform
    SubmittedDraft -. "save failure is nonfatal" .-> SubmitEvent
    FailDraft -. "early fallback success does not rewrite submitted status" .-> Intake
```

The source reports a fallback-created intake as a successful durable receipt. The required fallback function exists locally but was absent from the read-only remote function-name listing on the audit date.

## 4. Current PDF path

```mermaid
flowchart TD
    Live["ConfirmModal: live Redux response snapshot"] --> Hook["useQuestionnairePdfDownload"]
    Submitted["ThankYouModal: React-only submitted snapshot"] --> Hook
    Legacy["Legacy /ThankYou route"] -. "no response snapshot; no download" .-> Stop["PDF unavailable"]

    Hook --> Guard["Validate + duplicate-download guard"]
    Guard --> Generate["generatePDF"]
    Generate --> Model["buildQuestionnairePdfModel"]
    Model --> HTML["Create escaped HTML + CSS container"]
    HTML --> DOM["Append offscreen DOM node"]
    DOM --> Assets["Wait for Inter fonts and logo"]
    Assets --> Canvas["html2canvas rasterization"]
    Canvas --> PDF["jsPDF custom-height document"]
    PDF --> Download["Browser file download"]
    Download --> Analytics["Clarity PDF event"]
    Analytics --> Cleanup["Remove temporary DOM node"]

    Assets -->|"error"| Failure["Console + toast / success:false"]
    Canvas -->|"blank / unsafe scale / error"| Failure
    PDF -->|"error"| Failure
    Failure --> Cleanup

    Server["Base44/PDF backend/email"] -. "not used" .-> Generate
```

PDF generation is entirely in the browser and does not persist or email the PDF.

## 5. Current admin recovery path

```mermaid
flowchart TD
    Route["/admin/draft-recovery"] --> SavedGrant{"Stored grant exists?"}
    SavedGrant -->|"yes"| VerifyToken["verifyDraftRecoveryAccess(token)"]
    SavedGrant -->|"no"| Password["Enter recovery password"]
    Password --> VerifyPassword["verifyDraftRecoveryAccess(password)"]
    VerifyPassword -->|"authorized"| StoreGrant["Store HMAC grant + expiry in localStorage"]
    VerifyToken -->|"authorized"| RecoveryUI["ProFormDraftRecovery"]
    StoreGrant --> RecoveryUI
    VerifyToken -->|"expired/invalid"| Password

    RecoveryUI --> DraftList["Direct ProFormDraft.list"]
    RecoveryUI --> IntakeList["Direct ProFormSubmissionIntake.list"]
    DraftList --> BrowserFilter["Browser sort/filter/render payload"]
    IntakeList --> BrowserFilter
    BrowserFilter --> Edit["DraftEditPanel"]
    Edit --> DirectUpdate["Direct ProFormDraft.update"]

    BrowserFilter --> Retry["retryProQuestionnaireIntakeSubmission"]
    BrowserFilter --> Repair["repairProQuestionnaireIntakeSubmission"]
    Retry --> Reauthorize["Function: Base44 admin OR recovery grant"]
    Repair --> Reauthorize
    Reauthorize --> ServiceRole["Service-role entity reads/writes"]
    ServiceRole --> Submission["Possible ProFormSubmission create"]
    ServiceRole --> Lifecycle["Draft/intake/event updates"]
    ServiceRole --> Zapier["Possible Zapier delivery"]

    AdminRoutes["Other admin recovery routes"] --> AdminOnly["Base44 admin / source allowlist"]
    AdminOnly --> IntakeList
    AdminOnly --> Manual["Manual intake repair → direct submission create"]

    UIOnly["Password UI gate"] -. "grant not attached to direct list/update" .-> DraftList
    UIOnly -. "grant not attached to direct list" .-> IntakeList
```

Retry and repair functions reauthorize before service-role access. Direct entity list/update calls rely on entity policy, not on the recovery grant.

## 6. Current failure and backup path

```mermaid
flowchart TD
    AnswerSave["Debounced server draft save"] --> DraftResult{"Save succeeds?"}
    DraftResult -->|"yes"| Draft["ProFormDraft create/update"]
    DraftResult -->|"no"| SessionBackup["localStorage: pro_questionnaire_local_backup_session"]

    Unload["beforeunload"] --> SessionBackup
    Submit["Final submission pipeline"] --> SubmitResult{"Durable final/intake succeeds?"}
    SubmitResult -->|"yes"| Success["Thank-you modal"]
    SubmitResult -->|"transform/validation/create failure"| FailedBackup["localStorage: failed_pro_submission_timestamp"]
    SubmitResult -->|"failure stages"| SessionBackup
    FailedBackup --> Fallback["Attempt server fallback"]
    Fallback -->|"intake/final succeeds"| Success
    Fallback -->|"also fails or function unavailable"| RecoveryCode["Show session ID as recovery code"]

    SessionBackup -. "no production reader" .-> Orphan1["Not restored automatically"]
    FailedBackup -. "no production reader" .-> Orphan2["Not restored automatically"]
    Orphan1 -. "no TTL / cleanup" .-> Retained["Remains on browser origin"]
    Orphan2 -. "no TTL / cleanup" .-> Retained

    Reload["Page reload"] --> Persisted["Only redux-persist key is rehydrated"]
    Persisted --> Form["Questionnaire Redux state"]
    Draft -. "no public server read" .-> Form
    SessionBackup -. "no restore path" .-> Form
    FailedBackup -. "no restore path" .-> Form
```

The backup writers are defensive evidence capture, not an implemented recovery mechanism.
