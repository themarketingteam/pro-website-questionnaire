import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, authorizeAdminRecoveryRequest } from '../_shared/proDraftAdminRequest/entry.ts';
import { buildSafeJsonResponse, createServerRequestId, readBoundedJsonBody } from '../_shared/proDraftPersistence/entry.ts';
import { getBackendRuntimeConfig } from '../_shared/proDraftRuntimeConfig/entry.ts';
import { SECURITY_SECRET_NAMES, generateSecureRecoveryCode, hashRecoveryCode, sha256Hex, timingSafeEqualStrings } from '../_shared/proDraftSecurity/entry.ts';
import { createOperationalEvent, recordOperationalEventBestEffort } from '../_shared/proDraftOperationalEvents/entry.ts';
import { OPERATIONAL_FINGERPRINT_SECRET_NAME, createOperationalFingerprint, OPERATIONAL_FINGERPRINT_PURPOSES } from '../_shared/proDraftOperationalFingerprints/entry.ts';
import { PRO_FORM_SYNTHETIC_PROBE_SECRET, runSyntheticProbeSequence } from '../_shared/proDraftSyntheticProbe/entry.ts';

type Client = Readonly<{asServiceRole: Readonly<{entities: Readonly<Record<string, any>>}>}>;
type Dependencies = Readonly<{createClientFromRequest: (request: Request) => Client; getEnvironmentValue: (name: string) => string | undefined; now?: () => Date; createRequestId?: () => string}>;
const secret = (deps: Dependencies, name: string) => { const value = deps.getEnvironmentValue(name); if (!value || new TextEncoder().encode(value).byteLength < 32) throw Object.assign(new Error('SYNTHETIC_PROBE_CONFIGURATION_INVALID'), {status: 503}); return value; };
const testRunId = (environment: string) => `synthetic-health-${environment}-${crypto.randomUUID()}`;

async function authorize(request: Request, body: Record<string, unknown>, deps: Dependencies, requestId: string) {
  const authorization = body.authorization;
  if (authorization && typeof authorization === 'object' && !Array.isArray(authorization) && (authorization as Record<string, unknown>).mode === 'scheduled') {
    const supplied = (authorization as Record<string, unknown>).probeSecret; const expected = deps.getEnvironmentValue(PRO_FORM_SYNTHETIC_PROBE_SECRET);
    if (typeof supplied !== 'string' || typeof expected !== 'string' || new TextEncoder().encode(expected).byteLength < 32 || !timingSafeEqualStrings(supplied, expected)) throw Object.assign(new Error('SYNTHETIC_PROBE_AUTHORIZATION_DENIED'), {status: 401});
    return {mode: 'scheduled'};
  }
  const value = authorization && typeof authorization === 'object' && !Array.isArray(authorization) ? authorization as Record<string, unknown> : {};
  await authorizeAdminRecoveryRequest({request, operation: ADMIN_API_OPERATION_NAMES.LIST_EVENTS, getEnvironmentValue: deps.getEnvironmentValue, requestId, body: {apiVersion: 1, adminGrant: value.adminGrant ?? body.adminGrant, deviceId: value.deviceId ?? body.deviceId}});
  return {mode: 'manual'};
}

export function createRunProDraftSyntheticProbeHandler(deps: Dependencies) {
  return async (request: Request) => {
    const requestId = createServerRequestId(deps.createRequestId ? {generator: deps.createRequestId} : {});
    try {
      const body = await readBoundedJsonBody(request, {method: 'POST', maxBytes: 16 * 1024}); if (!body || typeof body !== 'object' || Array.isArray(body) || (body as Record<string, unknown>).apiVersion !== 1) throw Object.assign(new Error('SYNTHETIC_PROBE_REQUEST_INVALID'), {status: 400});
      const runtime = getBackendRuntimeConfig(deps.getEnvironmentValue); if (!runtime.durableDraftV2Enabled || runtime.environment === 'unknown') throw Object.assign(new Error('SYNTHETIC_PROBE_DISABLED'), {status: 503});
      await authorize(request, body as Record<string, unknown>, deps, requestId);
      if (runtime.externalSideEffectsMode !== 'disabled') throw Object.assign(new Error('SYNTHETIC_EXTERNAL_SIDE_EFFECTS_NOT_DISABLED'), {status: 409});
      const client = deps.createClientFromRequest(request); const entities = client.asServiceRole.entities; const drafts = entities.ProFormDraft; const events = entities.ProFormDraftEvent; const operational = entities.ProFormOperationalEvent;
      if (!drafts?.create || !drafts?.update || !drafts?.get || !drafts?.delete || !events?.create || !events?.filter || !events?.delete || !operational?.create) throw Object.assign(new Error('SYNTHETIC_PROBE_ENTITY_UNAVAILABLE'), {status: 503});
      const runId = testRunId(runtime.environment); const now = deps.now?.() ?? new Date(); const generatedCode = generateSecureRecoveryCode(); const recoverySecret = {name: SECURITY_SECRET_NAMES.RECOVERY_CODE, value: secret(deps, SECURITY_SECRET_NAMES.RECOVERY_CODE)} as const; const state = JSON.stringify({contractVersion: 4, syntheticHealth: true, responses: {}}); const stateHash = await sha256Hex(state); let draftId = '';
      const adapter = {
        create: async () => { const row = await drafts.create({session_id: `pds_${crypto.randomUUID().replaceAll('-', '')}`, form_type: 'pro-questionnaire', status: 'active', status_version: 1, draft_origin: 'initial', draft_generation: 1, business_name: runtime.environment === 'production' ? 'PRODUCTION Synthetic Health' : 'E2E STAGING Synthetic Health', recovery_email: 'synthetic-health@example.test', recovery_code_hash: await hashRecoveryCode(generatedCode.normalizedCode, recoverySecret), recovery_code_version: generatedCode.version, recovery_code_hint: generatedCode.hint, recovery_session_version: 1, draft_schema_version: 4, draft_state_json: state, state_hash: stateHash, client_revision: 0, server_revision: 0, environment: runtime.environment, test_run_id: runId, last_sync_reason: 'synthetic_probe', last_saved_at: now.toISOString()}); draftId = row.id; return {draftRef: row.id, expectedStateHash: stateHash}; },
        saveRevision1: async (id: string) => { await drafts.update(id, {client_revision: 1, server_revision: 1, state_hash: stateHash, draft_state_json: state, last_saved_at: now.toISOString()}); },
        load: async (id: string) => { const row = await drafts.get(id); return {stateHash: row.state_hash, readOnly: row.status === 'submitted'}; },
        appendEvent: async (id: string) => { const row = await drafts.get(id); await events.create({event_id: `synthetic-${crypto.randomUUID()}`, session_id: row.session_id, draft_id: id, event_type: 'draft_saved', client_revision: 1, server_revision: 1, environment: runtime.environment, test_run_id: runId, created_at_iso: now.toISOString()}); },
        recoverByCode: async (id: string) => { const row = await drafts.get(id); const derived = await hashRecoveryCode(generatedCode.normalizedCode, recoverySecret); return timingSafeEqualStrings(derived, row.recovery_code_hash); },
        markSubmittedReadOnly: async (id: string) => { await drafts.update(id, {status: 'submitted', status_version: 2, submitted_at: now.toISOString(), submitted_state_hash: stateHash, state_hash: stateHash}); },
        cleanup: async (id: string | null) => { if (!id) return; let failed = false; try { const rows = await events.filter({draft_id: id}, 'created_date', 100, 0, ['id']); for (const row of rows) await events.delete(row.id); } catch { failed = true; } try { await drafts.delete(id); } catch { failed = true; } if (failed) throw new Error('CLEANUP_FAILED'); },
        recordResult: async (result: Readonly<Record<string, unknown>>) => { const fingerprint = draftId ? await createOperationalFingerprint(draftId, OPERATIONAL_FINGERPRINT_PURPOSES.DRAFT, secret(deps, OPERATIONAL_FINGERPRINT_SECRET_NAME)) : undefined; const eventInput: Record<string, unknown> = {event_type: 'synthetic_probe', environment: runtime.environment, request_id: requestId, draft_fingerprint: fingerprint, test_run_id: runId, function_version: '1', app_build_sha: runtime.buildSha, status: result.success ? 'healthy' : 'failed', metadata: {phase: result.failedStage ?? 'completed', outcome: result.success ? 'success' : 'failed'}}; if (result.errorCode) eventInput.error_code = result.errorCode; const recorded = await recordOperationalEventBestEffort(operational, createOperationalEvent(eventInput, {now: deps.now})); if (!recorded.recorded) throw new Error('OPERATIONAL_EVENT_WRITE_FAILED'); },
      };
      const result = await runSyntheticProbeSequence(adapter, {testRunId: runId, allowSubmittedStep: (body as Record<string, unknown>).includeSubmittedStep === true});
      return buildSafeJsonResponse({...result, requestId}, {status: result.success ? 200 : 503, headers: {'Cache-Control': 'no-store'}});
    } catch (error) { const status = typeof (error as any)?.status === 'number' ? (error as any).status : 500; const errorCode = error instanceof Error && /^[A-Z0-9_]{1,128}$/u.test(error.message) ? error.message : 'SYNTHETIC_PROBE_FAILED'; return buildSafeJsonResponse({success: false, status: 'unhealthy', errorCode, cleanupAttempted: false, cleanupSucceeded: false, requestId, externalEmailSent: false, externalSubmissionSent: false}, {status, headers: {'Cache-Control': 'no-store'}}); }
  };
}
if (typeof Deno !== 'undefined') Deno.serve(createRunProDraftSyntheticProbeHandler({createClientFromRequest, getEnvironmentValue: (name) => Deno.env.get(name)}));
