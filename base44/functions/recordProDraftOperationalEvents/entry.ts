import { createClientFromRequest } from 'npm:@base44/sdk';
import { PRO_DRAFT_API_OPERATION_NAMES } from '../_shared/proDraftApi/entry.ts';
import { AUTHORIZATION_SECRET_NAMES } from '../_shared/proDraftAuthorization/entry.ts';
import { authorizeDraftEvents } from '../_shared/proDraftAuthorizationResolver/entry.ts';
import { createDraftRepository } from '../_shared/proDraftRepository/entry.ts';
import { SECURITY_SECRET_NAMES } from '../_shared/proDraftSecurity/entry.ts';
import { assertDurableDraftServerEnabled, getBackendRuntimeConfig } from '../_shared/proDraftRuntimeConfig/entry.ts';
import { buildSafeJsonResponse, createServerRequestId, readBoundedJsonBody } from '../_shared/proDraftPersistence/entry.ts';
import { OPERATIONAL_FINGERPRINT_SECRET_NAME, createOperationalFingerprints } from '../_shared/proDraftOperationalFingerprints/entry.ts';
import { OPERATIONAL_EVENT_TYPES, buildSafeOperationalMetadata, createOperationalEvent, recordOperationalEventBestEffort } from '../_shared/proDraftOperationalEvents/entry.ts';
import { ADMIN_API_OPERATION_NAMES, authorizeAdminRecoveryRequest } from '../_shared/proDraftAdminRequest/entry.ts';
import { PRO_FORM_MIGRATION_APPLY_SECRET, verifyMigrationApplyToken } from '../_shared/proDraftMigrationAuthorization/entry.ts';

const MAX_BYTES = 128 * 1024; const MAX_EVENTS = 50;
const PUBLIC = new Set(['draft_bootstrap', 'draft_load', 'draft_save', 'draft_save_conflict', 'draft_save_retry', 'draft_offline', 'draft_reconnected', 'draft_recovered_by_email', 'draft_recovered_by_code', 'draft_recovery_failed', 'captcha_required', 'captcha_failed', 'recovery_locked', 'clear_all_started', 'clear_all_completed', 'clear_all_partial_failure', 'start_new_completed', 'submission_started', 'submission_completed', 'submission_failed', 'submitted_regression_blocked', 'pdf_generated', 'pdf_failed', 'critical_invariant_failure']);
const ADMIN = new Set(['admin_authorization_success', 'admin_authorization_failed', 'admin_operation', 'rls_denial_expected', 'rls_boundary_failure', 'retention_dry_run', 'retention_apply', 'synthetic_probe', 'health_check']);
const MIGRATION = new Set(['migration_started', 'migration_completed', 'migration_conflict']);
const CLIENT_FORBIDDEN = new Set(['event_id', 'environment', 'severity', 'request_id', 'draft_fingerprint', 'session_fingerprint', 'source_tab_fingerprint', 'created_at_server', 'retention_expires_at', 'retention_hold']);
const TEST_RUN = /^[A-Za-z0-9_.:-]{1,128}$/u;

type Client = Readonly<{asServiceRole?: Readonly<{entities?: Readonly<Record<string, any>>}>}>;
type Authorized = Readonly<{kind: 'public' | 'admin' | 'migration'; draftId?: string; sessionId?: string; sourceTabId?: string; adminGrantTokenId?: string}>;
type Dependencies = Readonly<{createClientFromRequest: (request: Request) => Client; getEnvironmentValue: (name: string) => string | undefined; authorize?: (input: Readonly<{request: Request; body: Record<string, unknown>; kinds: readonly string[]; client: Client; environment: string}>) => Promise<Authorized>; now?: () => Date; createRequestId?: () => string}>;

function fail(code: string, status: number): never { throw Object.assign(new Error(code), {code, status}); }
function secret(get: Dependencies['getEnvironmentValue'], name: string) { const value = get(name); if (!value || new TextEncoder().encode(value).byteLength < 32) return fail('OPERATIONAL_CONFIGURATION_INVALID', 503); return value; }
function classify(events: readonly Record<string, unknown>[]) {
  const kinds = new Set<string>();
  for (const event of events) { const type = event.event_type; if (typeof type !== 'string' || !Object.values(OPERATIONAL_EVENT_TYPES).includes(type as any)) fail('OPERATIONAL_EVENT_INVALID', 400); kinds.add(PUBLIC.has(type) ? 'public' : ADMIN.has(type) ? 'admin' : MIGRATION.has(type) ? 'migration' : 'server'); }
  if (kinds.size !== 1 || kinds.has('server')) fail('OPERATIONAL_EVENT_TYPE_NOT_ALLOWED', 403);
  return [...kinds];
}

async function authorizeDefault(deps: Dependencies, input: Parameters<NonNullable<Dependencies['authorize']>>[0]): Promise<Authorized> {
  const auth = input.body.authorization;
  if (input.kinds[0] === 'admin') {
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return fail('OPERATIONAL_AUTHORIZATION_DENIED', 403);
    const value = auth as Record<string, unknown>;
    const authorization = await authorizeAdminRecoveryRequest({request: input.request, operation: ADMIN_API_OPERATION_NAMES.LIST_EVENTS, getEnvironmentValue: deps.getEnvironmentValue, body: {apiVersion: 1, adminGrant: value.adminGrant, deviceId: value.deviceId, testRunId: input.body.testRunId}});
    return Object.freeze({kind: 'admin', adminGrantTokenId: authorization.tokenId});
  }
  if (input.kinds[0] === 'migration') {
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return fail('OPERATIONAL_AUTHORIZATION_DENIED', 403);
    const value = auth as Record<string, unknown>;
    const verified = await verifyMigrationApplyToken(value.migrationApplyToken, {environment: input.environment, migrationName: value.migrationName, migrationVersion: value.migrationVersion, batchId: value.batchId, reportHash: value.reportHash}, {secret: secret(deps.getEnvironmentValue, PRO_FORM_MIGRATION_APPLY_SECRET)});
    return Object.freeze({kind: 'migration', adminGrantTokenId: verified.claims.tokenId});
  }
  if (input.kinds[0] !== 'public') return fail('OPERATIONAL_AUTHORIZATION_DENIED', 403);
  const now = deps.now?.() ?? new Date();
  const resolved = await authorizeDraftEvents({operation: PRO_DRAFT_API_OPERATION_NAMES.APPEND_EVENTS, authorization: input.body.authorization}, {
    repository: createDraftRepository(input.client), environment: input.environment as 'local' | 'test' | 'staging' | 'production', formType: 'pro-questionnaire', grantVersion: 1,
    resumeTokenSecret: {name: SECURITY_SECRET_NAMES.RESUME_TOKEN, value: secret(deps.getEnvironmentValue, SECURITY_SECRET_NAMES.RESUME_TOKEN)},
    signedInvitationSecret: {name: AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION, value: secret(deps.getEnvironmentValue, AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION)},
    recoverySessionSecret: {name: AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION, value: secret(deps.getEnvironmentValue, AUTHORIZATION_SECRET_NAMES.RECOVERY_SESSION)},
    clock: () => Math.floor(now.getTime() / 1000),
  });
  return Object.freeze({kind: 'public', ...(resolved.draftId ? {draftId: resolved.draftId} : {})});
}

export function createRecordProDraftOperationalEventsHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const requestId = createServerRequestId(deps.createRequestId ? {generator: deps.createRequestId} : {});
    try {
      const runtime = assertDurableDraftServerEnabled(getBackendRuntimeConfig(deps.getEnvironmentValue));
      const body = await readBoundedJsonBody(request, {method: 'POST', maxBytes: MAX_BYTES});
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('OPERATIONAL_REQUEST_INVALID', 400);
      const value = body as Record<string, unknown>;
      if (value.apiVersion !== 1 || !Array.isArray(value.events) || value.events.length < 1 || value.events.length > MAX_EVENTS || value.events.some((event) => !event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).some((key) => CLIENT_FORBIDDEN.has(key)))) fail('OPERATIONAL_REQUEST_INVALID', 400);
      if (value.testRunId !== undefined && (typeof value.testRunId !== 'string' || !TEST_RUN.test(value.testRunId) || runtime.environment === 'production')) fail('OPERATIONAL_TEST_RUN_INVALID', 400);
      const events = value.events as Record<string, unknown>[]; const kinds = classify(events); const client = deps.createClientFromRequest(request);
      const authorized = await (deps.authorize ? deps.authorize({request, body: value, kinds, client, environment: runtime.environment}) : authorizeDefault(deps, {request, body: value, kinds, client, environment: runtime.environment}));
      if (authorized.kind !== kinds[0]) fail('OPERATIONAL_AUTHORIZATION_DENIED', 403);
      const fingerprints = await createOperationalFingerprints(authorized, secret(deps.getEnvironmentValue, OPERATIONAL_FINGERPRINT_SECRET_NAME));
      const entity = client.asServiceRole?.entities?.ProFormOperationalEvent; if (!entity || typeof entity.create !== 'function') fail('OPERATIONAL_ENTITY_UNAVAILABLE', 503);
      let accepted = 0; let rejected = 0;
      for (const raw of events) {
        try {
          const metadata_json = buildSafeOperationalMetadata(raw.metadata); const event = createOperationalEvent({...raw, metadata: undefined, metadata_json, environment: runtime.environment, request_id: requestId, test_run_id: value.testRunId, app_build_sha: raw.app_build_sha ?? runtime.buildSha, ...fingerprints}, {now: deps.now});
          const result = await recordOperationalEventBestEffort(entity, event); result.recorded ? accepted += 1 : rejected += 1;
        } catch { rejected += 1; }
      }
      return buildSafeJsonResponse({success: rejected === 0, accepted, rejected, requestId}, {headers: {'Cache-Control': 'no-store'}});
    } catch (error) {
      const status = typeof (error as any)?.status === 'number' ? (error as any).status : 400; const errorCode = typeof (error as any)?.code === 'string' ? (error as any).code : 'OPERATIONAL_REQUEST_REJECTED';
      return buildSafeJsonResponse({success: false, accepted: 0, rejected: 0, errorCode, requestId}, {status, headers: {'Cache-Control': 'no-store'}});
    }
  };
}

if (typeof Deno !== 'undefined') Deno.serve(createRecordProDraftOperationalEventsHandler({createClientFromRequest, getEnvironmentValue: (name) => Deno.env.get(name)}));
