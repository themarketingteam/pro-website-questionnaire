import { reconcileOrganizedRepairPayload, validateOrganizedSubmission } from './pageOrganizerContract.js';
import { transformResponsesToPayload, validateSubmissionPayload } from './proQuestionnairePayload.js';
import { SERVICE_OPTIONS_GROUPED } from './proServiceCatalog.js';
import { createSubmissionIdentityFingerprint, getSubmissionIdentity } from './proDraftSubmissionAuthorization.ts';

type Row = Record<string, any>;
const plain = (value: any): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const same = (a: any, b: any) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const organizerFields = new Set(['service_offerings', 'service_offerings_other', 'service_offerings_structure', 'target_industries', 'target_industries_other', 'target_industries_structure']);
const answerKeys = new Set([...Array.from({ length: 25 }, (_, index) => String(index + 1)), '1.1', '2.1', '2.2', '12.1', '14.1', '23.1', '25.1', '3_structure', '4_structure', '5_primary', ...[3, 4, 7, 8, 10, 11, 15, 16, 18, 20, 24].map(key => `${key}_other`)]);
const hasRecognizedAnswers = (responses: Row) => Object.entries(responses).some(([key, value]) => answerKeys.has(key)
  && (typeof value === 'string' ? Boolean(value.trim()) : Array.isArray(value) ? value.length > 0 : plain(value) ? Object.keys(value).length > 0 : value !== null && value !== undefined));
const failed = (message: string, code = 'RECOVERY_PAYLOAD_INCOMPLETE', status = 422) => ({ ok: false, code, status, errors: [message], payload: null, rebuilt: false });

/** Revisions normally retain raw answers, not a mapped submission. Rebuild only
 * an absent map or the precisely recognized organizer-only recovery artifact;
 * never discard arbitrary repaired fields or override a conflicting identity. */
export async function prepareProRecoveryPayload({ payload, responses, identity, allowRawRebuild = false }: any): Promise<any> {
  if (!plain(responses) || !hasRecognizedAnswers(responses)) return failed('Retained questionnaire answers are required. No blank recovery copy or submission was created.');
  if (payload !== null && payload !== undefined && !plain(payload)) return failed('The retained mapped payload is malformed and requires review.');
  const supplied = plain(payload) ? payload : {};
  const reconciled = reconcileOrganizedRepairPayload(supplied, responses);
  if (!reconciled.ok) return { ...reconciled, rebuilt: false };
  const candidate = reconciled.payload;
  const generic = validateSubmissionPayload(candidate);
  if (generic.ok) {
    if (await createSubmissionIdentityFingerprint(getSubmissionIdentity(candidate)) !== await createSubmissionIdentityFingerprint(identity)) return failed('The retained payload belongs to a different client.', 'SUBMISSION_IDENTITY_CONFLICT', 409);
    const organized = validateOrganizedSubmission({ payload: candidate, responses });
    return organized.ok ? { ok: true, payload: candidate, rebuilt: false } : { ...organized, payload: null, rebuilt: false };
  }
  if (!allowRawRebuild || !plain(responses) || !hasRecognizedAnswers(responses) || !identity?.businessName?.trim() || !identity?.domain?.trim()) return failed('A complete saved payload or retained answers with verified client identity are required.');
  const empty = Object.keys(supplied).length === 0;
  const knownPartial = Object.keys(supplied).every(key => ['metadata', 'userdata'].includes(key))
    && plain(supplied.metadata) && Object.keys(supplied.metadata).every(key => key === 'questionnaire_payload_version')
    && plain(supplied.userdata) && Object.keys(supplied.userdata).every(key => organizerFields.has(key));
  if (!empty && !knownPartial) return failed('The incomplete retained payload contains fields that require review. No saved values were replaced.');
  let rebuilt: Row;
  try { rebuilt = transformResponsesToPayload(responses, identity.businessName, identity.domain, SERVICE_OPTIONS_GROUPED); }
  catch { return failed('The retained answers could not be mapped without changing their page structure.'); }
  if (knownPartial && (!Object.entries(supplied.userdata).every(([key, value]) => same(value, rebuilt.userdata[key]))
    || !Object.entries(supplied.metadata).every(([key, value]) => same(value, rebuilt.metadata[key])))) return failed('The partial payload does not match its retained answers. Review this version before submitting.');
  const validation = validateSubmissionPayload(rebuilt);
  const organized = validateOrganizedSubmission({ payload: rebuilt, responses });
  if (!validation.ok || !organized.ok) return failed([...validation.errors, ...organized.errors].join(' '));
  return { ok: true, payload: rebuilt, rebuilt: true };
}
