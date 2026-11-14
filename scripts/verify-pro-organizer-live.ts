// Run only after deployment with the CLI's preauthenticated `base44` SDK.
// Writes one uniquely named synthetic draft/submission through public handlers.
// No entity deletes, broad mutations, Zapier calls, emails, or delivery retries.
const unwrap = (response: any) => response?.data ?? response;
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const suffix = crypto.randomUUID().replace(/-/g, '');
const identity = { businessName: `Synthetic Organizer Verification ${suffix.slice(0, 10)}`, domain: `organizer-${suffix.slice(0, 10)}.invalid` };
const invoke = async (name: string, body: any) => {
  const value = unwrap(await base44.functions.invoke(name, body));
  if (!value?.success) throw Object.assign(new Error(value?.error || `${name} failed`), { code: value?.code, status: value?.status || 500 });
  return value;
};
const page = (id: string, label: string, source = 'custom', children: any[] = []) => ({ id: `${suffix}-${id}`, label, source, catalogId: source === 'predefined' ? `q3:option:${encodeURIComponent(label)}` : null, children });
const structure = (pages: any[]) => ({ format: 'page-tree-v1', pages });
const services = structure([page('managed', 'Managed IT', 'predefined', [page('help', 'IT Help Desk', 'predefined')]), page('custom', 'Synthetic custom, with comma')]);
const industries = structure([{ ...page('finance', 'Financial / Accounting / CPA', 'predefined'), catalogId: 'q4:option:Financial%20%2F%20Accounting%20%2F%20CPA' }, page('industry-custom', 'Synthetic industry')]);
const compact = (value: any) => ({ format: value.format, pages: value.pages.map((node: any) => ({ label: node.label, source: node.source, ...(node.children.length ? { children: node.children.map((child: any) => ({ label: child.label, source: child.source })) } : {}) })) });
const projection = (value: any) => {
  const main: string[] = []; const other: string[] = [];
  value.pages.forEach((node: any) => [node, ...node.children].forEach((entry: any) => (entry.source === 'predefined' ? main : other).push(entry.label)));
  return { main, other };
};
const raw = (serviceTree: any, industryTree = industries) => ({ '3_structure': serviceTree, '3': projection(serviceTree).main, '3_other': projection(serviceTree).other, '4_structure': industryTree, '4': projection(industryTree).main, '4_other': projection(industryTree).other });
const mapped = (serviceTree: any, industryTree = industries) => ({ metadata: { business_name: identity.businessName, businessDomain: identity.domain, submission_datetime: new Date().toISOString(), service_type: 'pro', questionnaire_payload_version: 2 }, userdata: { service_offerings_structure: compact(serviceTree), service_offerings: projection(serviceTree).main, service_offerings_other: projection(serviceTree).other.join(', '), target_industries_structure: compact(industryTree), target_industries: projection(industryTree).main, target_industries_other: projection(industryTree).other.join(', ') } });

let draftId = ''; let sessionId = ''; let submissionId = '';
try {
  const bootstrap = await invoke('syncProQuestionnaireDraft', { action: 'bootstrap', newClient: true, newClientRequestId: `organizer_smoke_${suffix}`, credentials: identity, incomingIdentity: identity });
  draftId = bootstrap.draft.draftId; sessionId = bootstrap.draft.sessionId;
  const credential = bootstrap.resumeCredential;
  let current = bootstrap.draft;
  let sequence = 0;
  const save = async (responses: any, changedKeys: string[], options: any = {}) => {
    const result = await invoke('syncProQuestionnaireDraft', { action: 'save', resumeCredential: credential, clientInstanceId: `organizer_smoke_client_${suffix}`, mutationId: `organizer_smoke_${crypto.randomUUID().replace(/-/g, '')}`, clientSequence: ++sequence, baseRevision: current.revision, responses, changedKeys, deletedKeys: [], credentials: identity, source: 'synthetic_organizer_live_verification', ...options });
    current = result.draft; return result;
  };
  await save({ '3': ['Managed IT'], '3_other': 'Synthetic custom, with comma', '4': ['Financial / Accounting / CPA'] }, ['3', '3_other', '4']);
  assert(equal(current.responses['4'], ['Financial / Accounting / CPA']), 'Legacy combined industry was changed.');
  await save(raw(services), Object.keys(raw(services)), { mappedPayload: mapped(services) });
  const restored = await invoke('syncProQuestionnaireDraft', { action: 'bootstrap', resumeCredential: credential });
  assert(equal(restored.draft.responses['3_structure'], services) && equal(restored.draft.responses['4_structure'], industries), 'Rich IDs, parent order, child order, or custom comma changed on reload.');
  current = restored.draft;
  const baseRevision = current.revision;
  const contenders = [
    structure([...services.pages, page('race-a', 'Synthetic race A')]),
    structure([...services.pages].reverse())
  ];
  const races = await Promise.all(contenders.map(async (value, index) => {
    try {
      return { ok: true, value: await invoke('syncProQuestionnaireDraft', { action: 'save', resumeCredential: credential, clientInstanceId: `organizer_race_${index}_${suffix}`, mutationId: `organizer_race_mutation_${index}_${suffix}`, clientSequence: 1, baseRevision, responses: raw(value), changedKeys: ['3', '3_other', '3_structure'], deletedKeys: [], mappedPayload: mapped(value), credentials: identity, source: 'synthetic_organizer_cas_verification' }) };
    } catch (error: any) {
      return { ok: false, code: error?.response?.data?.code || error?.code, status: Number(error?.response?.status || error?.status) };
    }
  }));
  const successes = races.filter((result) => result.ok);
  const conflicts = races.filter((result) => !result.ok && result.status === 409 && result.code === 'ORGANIZER_REVISION_CONFLICT');
  assert(successes.length === 1 && conflicts.length === 1, 'Concurrent saves did not produce exactly one winner and one protected conflict.');
  current = (successes[0] as any).value.draft;
  const winningServices = current.responses['3_structure'];
  await save({ '6': 'Synthetic unrelated edit from an older tab' }, ['6'], { baseRevision: 0 });
  assert(equal(current.responses['3_structure'], winningServices), 'Unrelated old-tab edit changed the organized pages.');
  await save(raw(structure([])), ['3', '3_other', '3_structure'], { mappedPayload: mapped(structure([])) });
  assert(equal(current.responses['3_structure'], structure([])), 'Explicit clear lost the adopted format.');
  await save(raw(winningServices), ['3', '3_other', '3_structure'], { mappedPayload: mapped(winningServices) });
  const finalPayload = mapped(winningServices);
  const attempt = `organizer_submission_${suffix}`;
  const submissionBody = { draftId, resumeCredential: credential, submissionAttemptId: attempt, transformedPayload: finalPayload, questionnaireSessionId: sessionId };
  const first = await invoke('submitProQuestionnaireDurable', submissionBody);
  submissionId = first.submission.id;
  const duplicate = await invoke('submitProQuestionnaireDurable', submissionBody);
  assert(duplicate.submission.id === submissionId && duplicate.duplicate === true, 'Submission retry created a different receipt.');
  assert(equal(first.submission.userdata.service_offerings_structure, compact(winningServices)) && equal(first.submission.userdata.target_industries_structure, compact(industries)) && first.submission.metadata.questionnaire_payload_version === 2, 'Stored compact submission or v2 marker differs from the saved raw trees.');
  const finalReload = await invoke('syncProQuestionnaireDraft', { action: 'bootstrap', resumeCredential: credential });
  assert(finalReload.draft.status === 'submitted' && finalReload.draft.finalSubmissionId === submissionId, 'Durable receipt was not linked before acknowledgement.');
  console.log(JSON.stringify({ success: true, draftId, sessionId, submissionId, legacy_preserved: true, rich_roundtrip: true, compact_roundtrip: true, custom_comma_preserved: true, concurrent_stale_save_rejected: true, clear_then_edit: true, idempotent_submission: true, delivery_invoked: false, cleanup_performed: false }, null, 2));
} catch (error: any) {
  console.log(JSON.stringify({ success: false, draftId, sessionId, submissionId, code: error?.response?.data?.code || error?.code || '', error: error?.message || 'Organizer verification failed.', delivery_invoked: false, cleanup_performed: false }, null, 2));
  throw error;
}
