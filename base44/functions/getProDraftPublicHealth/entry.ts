import { buildHealthComponentResult, getSafePublicHealthProjection } from '../_shared/proDraftHealth/entry.ts';
import { getBackendRuntimeConfig } from '../_shared/proDraftRuntimeConfig/entry.ts';
import { buildSafeJsonResponse, createServerRequestId, readBoundedJsonBody } from '../_shared/proDraftPersistence/entry.ts';

type Dependencies = Readonly<{getEnvironmentValue: (name: string) => string | undefined; now?: () => Date; createRequestId?: () => string}>;
export function createGetProDraftPublicHealthHandler(deps: Dependencies) {
  return async (request: Request) => {
    const requestId = createServerRequestId(deps.createRequestId ? {generator: deps.createRequestId} : {}); const checkedAt = (deps.now?.() ?? new Date()).toISOString();
    try {
      const body = await readBoundedJsonBody(request, {method: 'POST', maxBytes: 4096});
      if (!body || typeof body !== 'object' || Array.isArray(body) || (body as Record<string, unknown>).apiVersion !== 1 || Object.keys(body).some((key) => key !== 'apiVersion')) throw new Error('PUBLIC_HEALTH_REQUEST_INVALID');
      const runtime = getBackendRuntimeConfig(deps.getEnvironmentValue);
      const components = [buildHealthComponentResult({component: 'frontend', status: 'healthy', checkedAt, details: {available: true}}), buildHealthComponentResult({component: 'runtime_config', status: runtime.durableDraftV2Enabled ? 'healthy' : runtime.configurationValid ? 'disabled' : 'unhealthy', checkedAt, errorCode: runtime.configurationValid ? null : 'RUNTIME_CONFIG_INVALID', details: {configured: runtime.configurationValid, enabled: runtime.durableDraftV2Enabled}})];
      return buildSafeJsonResponse(getSafePublicHealthProjection({components, environment: runtime.environment, buildSha: runtime.buildSha, checkedAt, requestId}), {headers: {'Cache-Control': 'no-store'}});
    } catch { return buildSafeJsonResponse({success: false, status: 'unknown', environment: 'unknown', buildSha: '', checkedAt, requestId}, {status: 400, headers: {'Cache-Control': 'no-store'}}); }
  };
}
if (typeof Deno !== 'undefined') Deno.serve(createGetProDraftPublicHealthHandler({getEnvironmentValue: (name) => Deno.env.get(name)}));
