const unwrap = (response: any) => response?.data ?? response;
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const invoke = async (name: string, payload: any) => unwrap(
  await base44.functions.invoke(name, payload)
);
const deleteMatches = async (entity: any, query: any) => {
  const records = await entity.filter(query, '-created_date', 100);
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.id) await entity.delete(record.id);
  }
  return Array.isArray(records) ? records.length : 0;
};

const suffix = crypto.randomUUID().replace(/-/g, '');
const requestId = `pro_verify_${suffix}`;
const businessName = `Synthetic Identity Verification ${suffix.slice(0, 8)}`;
const domain = `synthetic-${suffix.slice(0, 8)}.invalid`;
const answer = `Synthetic database persistence verification ${suffix.slice(0, 12)}`;
const clientInstanceId = `verify_client_${suffix}`;
let draftId = '';
let sessionId = '';
let cleanup = { revisions: 0, events: 0, drafts: 0 };

try {
  const launchPayload = {
    action: 'bootstrap',
    resumeCredential: '',
    legacySessionId: '',
    credentials: { businessName, domain },
    incomingIdentity: { businessName, domain },
    newClient: true,
    newClientRequestId: requestId
  };
  const first = await invoke('syncProQuestionnaireDraft', launchPayload);
  const second = await invoke('syncProQuestionnaireDraft', launchPayload);
  assert(first?.success && second?.success, 'Explicit new-client bootstrap was not confirmed.');
  assert(first?.newClientRequestConfirmed && second?.newClientRequestConfirmed, 'New-client confirmation flag was missing.');
  assert(first?.draft?.draftId && first.draft.draftId === second?.draft?.draftId, 'The same new-client request created more than one draft.');
  assert(first?.resumeCredential && second?.resumeCredential, 'A recovery credential was not returned.');
  draftId = first.draft.draftId;
  sessionId = first.draft.sessionId;

  const saved = await invoke('syncProQuestionnaireDraft', {
    action: 'save',
    resumeCredential: first.resumeCredential,
    clientInstanceId,
    mutationId: `verify_mutation_${suffix}`,
    clientSequence: 1,
    baseRevision: 0,
    responses: { '6': answer },
    changedKeys: ['6'],
    deletedKeys: [],
    validationStatus: { '6': 'complete' },
    touchedQuestions: { '6': true },
    expandedQuestions: { '6': true },
    credentials: { businessName, domain },
    currentQuestionId: '6',
    lastChangedQuestionId: '6',
    progressPercent: 4,
    status: 'draft',
    source: 'synthetic_live_verification'
  });
  assert(saved?.success && Number(saved?.draft?.revision) >= 1, 'The database did not confirm a saved revision.');

  const restored = await invoke('syncProQuestionnaireDraft', {
    action: 'bootstrap',
    resumeCredential: second.resumeCredential,
    legacySessionId: '',
    credentials: {},
    incomingIdentity: {},
    newClient: false
  });
  assert(restored?.draft?.draftId === draftId, 'Recovery credential restored a different draft.');
  assert(restored?.draft?.responses?.['6'] === answer, 'The server-confirmed answer did not restore.');
  assert(Number(restored?.draft?.revision) >= 1, 'The restored revision was not server-confirmed.');

  const identityConflict = await invoke('syncProQuestionnaireDraft', {
    action: 'bootstrap',
    resumeCredential: second.resumeCredential,
    legacySessionId: '',
    credentials: {},
    incomingIdentity: { businessName: 'Different Synthetic Client', domain: 'different.invalid' },
    newClient: false
  });
  assert(identityConflict?.requiresIdentityDecision === true, 'Conflicting launch identity did not stop for a decision.');

  let submissionConflictRejected = false;
  try {
    await invoke('submitProQuestionnaireDurable', {
      action: 'authorize',
      transformedPayload: {
        metadata: { business_name: 'Different Synthetic Client', businessDomain: 'different.invalid' },
        userdata: { company_description: answer }
      },
      questionnaireSessionId: sessionId,
      draftId,
      resumeCredential: second.resumeCredential,
      submissionAttemptId: `pro_submit_verify_${suffix}`,
      submissionContentFingerprint: '',
      submitContext: { business_name: 'Different Synthetic Client', domain: 'different.invalid' }
    });
  } catch (error: any) {
    const code = error?.response?.data?.code || error?.data?.code || error?.code || '';
    submissionConflictRejected = code === 'SUBMISSION_IDENTITY_CONFLICT'
      || Number(error?.response?.status || error?.status) === 409;
  }
  assert(submissionConflictRejected, 'A cross-client submission was not rejected.');

  console.log(JSON.stringify({
    success: true,
    idempotent_new_client: true,
    confirmed_revision: Number(restored.draft.revision),
    restored_answer: true,
    launch_identity_conflict_blocked: true,
    submission_identity_conflict_blocked: true
  }, null, 2));
} finally {
  if (draftId) {
    cleanup.revisions = await deleteMatches(base44.entities.ProFormDraftRevision, { draft_id: draftId });
    cleanup.events = await deleteMatches(base44.entities.ProFormDraftEvent, { session_id: sessionId });
    cleanup.drafts = await deleteMatches(base44.entities.ProFormDraft, { id: draftId });
  }
  console.log(JSON.stringify({ synthetic_cleanup: cleanup }, null, 2));
}
