import { createClientFromRequest } from 'npm:@base44/sdk';
import { ADMIN_API_OPERATION_NAMES, createAdminFunctionHandler, adminApiError, ADMIN_API_ERROR_CODES } from '../_shared/proDraftAdminRequest/entry.ts';
import { aggregateOperationalSummary } from '../_shared/proDraftOperationalEvents/entry.ts';

const SAFE = /^[A-Za-z0-9_.:-]{1,128}$/u;
function validDate(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
export function filterOperationalSummaryRows(rows: readonly Readonly<Record<string, unknown>>[], payload: Readonly<Record<string, unknown>>, authorizedEnvironment: string) {
  if (payload.environment !== authorizedEnvironment || !validDate(payload.from) || !validDate(payload.to) || Date.parse(payload.from) > Date.parse(payload.to)) adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const types = payload.eventTypes === undefined ? null : Array.isArray(payload.eventTypes) && payload.eventTypes.every((value) => typeof value === 'string' && SAFE.test(value)) ? new Set(payload.eventTypes) : adminApiError(ADMIN_API_ERROR_CODES.INVALID_REQUEST);
  const severities = payload.severity === undefined ? null : Array.isArray(payload.severity) ? new Set(payload.severity) : new Set([payload.severity]);
  return rows.filter((row) => row.environment === authorizedEnvironment && validDate(row.created_at_server) && Date.parse(row.created_at_server) >= Date.parse(payload.from as string) && Date.parse(row.created_at_server) <= Date.parse(payload.to as string) && (!types || types.has(row.event_type)) && (!severities || severities.has(row.severity)) && (payload.testRunId === undefined ? row.test_run_id === undefined || row.test_run_id === null : row.test_run_id === payload.testRunId));
}

export function createGetProDraftOperationalSummaryHandler(dependencies: Readonly<{createClientFromRequest: typeof createClientFromRequest; getEnvironmentValue: (name: string) => string | undefined}>) {
  return createAdminFunctionHandler({operation: ADMIN_API_OPERATION_NAMES.LIST_EVENTS, maxBytes: 32 * 1024, ...dependencies, execute: async ({client, authorization, payload}) => {
    const entity = client.asServiceRole?.entities?.ProFormOperationalEvent as any; if (!entity || typeof entity.filter !== 'function') adminApiError(ADMIN_API_ERROR_CODES.INTERNAL_ERROR, 503);
    const query: Record<string, unknown> = {environment: authorization.environment}; if (payload.testRunId !== undefined) query.test_run_id = payload.testRunId;
    const rows = await entity.filter(query, '-created_at_server', 5000, 0, ['event_type', 'environment', 'severity', 'status', 'latency_ms', 'retry_count', 'created_at_server', 'test_run_id']);
    return {apiVersion: 1, environment: authorization.environment, from: payload.from, to: payload.to, ...aggregateOperationalSummary(filterOperationalSummaryRows(rows, payload, authorization.environment))};
  }});
}

if (typeof Deno !== 'undefined') Deno.serve(createGetProDraftOperationalSummaryHandler({createClientFromRequest, getEnvironmentValue: (name) => Deno.env.get(name)}));
