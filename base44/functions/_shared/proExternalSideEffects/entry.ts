import {
  type BackendEnvironment,
  type BackendRuntimeConfig,
  type ExternalSideEffectsMode,
  getBackendRuntimeConfig,
} from '../proDraftRuntimeConfig/entry.ts';

export type ExternalSideEffectKind =
  | 'zapier_submission'
  | 'ses_email'
  | 'external_file_copy'
  | 'external_pdf_delivery'
  | 'external_notification';

export type ExternalDestinationClass =
  | 'none'
  | 'production'
  | 'staging'
  | 'unconfigured';

export type ExternalSideEffectReasonCode =
  | 'ALLOWED'
  | 'EXTERNAL_SIDE_EFFECTS_DISABLED'
  | 'ENVIRONMENT_UNKNOWN'
  | 'MODE_ENVIRONMENT_MISMATCH'
  | 'DESTINATION_NOT_IMPLEMENTED'
  | 'DESTINATION_MISSING'
  | 'DESTINATION_INVALID'
  | 'SIDE_EFFECT_KIND_UNSUPPORTED';

export type ExternalSideEffectDecision = Readonly<{
  kind: ExternalSideEffectKind;
  allowed: boolean;
  mode: ExternalSideEffectsMode;
  environment: BackendEnvironment;
  destinationClass: ExternalDestinationClass;
  reasonCode: ExternalSideEffectReasonCode;
}>;

export type ExternalSideEffectResult = Readonly<{
  success: boolean;
  delivered: boolean;
  redirected: boolean;
  suppressed: boolean;
  environment: BackendEnvironment;
  mode: ExternalSideEffectsMode;
  destinationClass: ExternalDestinationClass;
  externalStatus: number | null;
  errorCode: string;
  message: string;
}>;

type EnvironmentSource =
  | Readonly<Record<string, unknown>>
  | Readonly<{ get: (name: string) => unknown }>
  | ((name: string) => unknown);

export type ExternalSideEffectPolicyOptions = Readonly<{
  envSource?: EnvironmentSource;
  runtimeConfig?: BackendRuntimeConfig;
  allowHttpForTests?: boolean;
}>;

export type ZapierDeliveryOptions = ExternalSideEffectPolicyOptions &
  Readonly<{
    fetchImpl?: typeof fetch;
  }>;

type ResolvedExternalDestination = Readonly<{
  decision: ExternalSideEffectDecision;
  destination: string | null;
  timeoutMs: number;
}>;

const SUPPORTED_KINDS = new Set<ExternalSideEffectKind>([
  'zapier_submission',
  'ses_email',
  'external_file_copy',
  'external_pdf_delivery',
  'external_notification',
]);

const DEFAULT_ZAPIER_TIMEOUT_MS = 8000;
const MIN_ZAPIER_TIMEOUT_MS = 100;
const MAX_ZAPIER_TIMEOUT_MS = 15000;
export const MAX_EXTERNAL_PAYLOAD_BYTES = 1_000_000;

function readDenoEnvironmentVariable(name: string): unknown {
  try {
    const deno = (
      globalThis as typeof globalThis & {
        Deno?: { env?: { get?: (variableName: string) => string | undefined } };
      }
    ).Deno;
    return deno?.env?.get?.(name);
  } catch {
    return undefined;
  }
}

function readEnvironmentValue(
  source: EnvironmentSource | undefined,
  name: string,
): unknown {
  if (!source) return readDenoEnvironmentVariable(name);

  try {
    if (typeof source === 'function') return source(name);
    if ('get' in source && typeof source.get === 'function') {
      return source.get(name);
    }
    return source[name];
  } catch {
    return undefined;
  }
}

function destinationClassForMode(
  mode: ExternalSideEffectsMode,
): ExternalDestinationClass {
  if (mode === 'production') return 'production';
  if (mode === 'staging_redirect') return 'staging';
  return 'none';
}

function createDecision(
  kind: ExternalSideEffectKind,
  runtimeConfig: BackendRuntimeConfig,
  overrides: Partial<ExternalSideEffectDecision>,
): ExternalSideEffectDecision {
  return Object.freeze({
    kind,
    allowed: false,
    mode: runtimeConfig.externalSideEffectsMode,
    environment: runtimeConfig.environment,
    destinationClass: destinationClassForMode(
      runtimeConfig.externalSideEffectsMode,
    ),
    reasonCode: 'MODE_ENVIRONMENT_MISMATCH',
    ...overrides,
  });
}

function getRuntimeConfig(
  options: ExternalSideEffectPolicyOptions,
): BackendRuntimeConfig {
  return options.runtimeConfig ?? getBackendRuntimeConfig(options.envSource);
}

export function getExternalSideEffectPolicy(
  kind: ExternalSideEffectKind,
  options: ExternalSideEffectPolicyOptions = {},
): ExternalSideEffectDecision {
  const runtimeConfig = getRuntimeConfig(options);

  if (!SUPPORTED_KINDS.has(kind)) {
    return createDecision(kind, runtimeConfig, {
      destinationClass: 'unconfigured',
      reasonCode: 'SIDE_EFFECT_KIND_UNSUPPORTED',
    });
  }

  if (runtimeConfig.externalSideEffectsMode === 'disabled') {
    return createDecision(kind, runtimeConfig, {
      destinationClass: 'none',
      reasonCode: 'EXTERNAL_SIDE_EFFECTS_DISABLED',
    });
  }

  if (!runtimeConfig.environmentRecognized) {
    return createDecision(kind, runtimeConfig, {
      reasonCode: 'ENVIRONMENT_UNKNOWN',
    });
  }

  if (!runtimeConfig.externalSideEffectsConfigurationValid) {
    return createDecision(kind, runtimeConfig, {
      reasonCode: 'MODE_ENVIRONMENT_MISMATCH',
    });
  }

  return createDecision(kind, runtimeConfig, {
    allowed: true,
    reasonCode: 'ALLOWED',
  });
}

function parseBoundedTimeout(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return DEFAULT_ZAPIER_TIMEOUT_MS;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed >= MIN_ZAPIER_TIMEOUT_MS &&
    parsed <= MAX_ZAPIER_TIMEOUT_MS
    ? parsed
    : DEFAULT_ZAPIER_TIMEOUT_MS;
}

function validateDestinationUrl(
  value: unknown,
  allowHttpForTests: boolean,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  try {
    const url = new URL(trimmed);
    const schemeAllowed =
      url.protocol === 'https:' ||
      (allowHttpForTests === true && url.protocol === 'http:');
    if (
      !schemeAllowed ||
      url.username ||
      url.password ||
      url.hash ||
      !url.hostname
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveExternalDestination(
  kind: ExternalSideEffectKind,
  options: ExternalSideEffectPolicyOptions = {},
): ResolvedExternalDestination {
  const policy = getExternalSideEffectPolicy(kind, options);
  const timeoutMs = parseBoundedTimeout(
    readEnvironmentValue(options.envSource, 'PRO_ZAPIER_TIMEOUT_MS'),
  );

  if (!policy.allowed) {
    return Object.freeze({ decision: policy, destination: null, timeoutMs });
  }

  if (kind !== 'zapier_submission') {
    return Object.freeze({
      decision: createDecision(kind, getRuntimeConfig(options), {
        destinationClass: 'unconfigured',
        reasonCode: 'DESTINATION_NOT_IMPLEMENTED',
      }),
      destination: null,
      timeoutMs,
    });
  }

  const variableName =
    policy.mode === 'production'
      ? 'PRO_ZAPIER_WEBHOOK_URL'
      : 'STAGING_ZAPIER_WEBHOOK_URL';
  const rawDestination = readEnvironmentValue(options.envSource, variableName);

  if (typeof rawDestination !== 'string' || !rawDestination.trim()) {
    return Object.freeze({
      decision: createDecision(kind, getRuntimeConfig(options), {
        destinationClass: policy.destinationClass,
        reasonCode: 'DESTINATION_MISSING',
      }),
      destination: null,
      timeoutMs,
    });
  }

  const destination = validateDestinationUrl(
    rawDestination,
    options.allowHttpForTests === true,
  );
  if (!destination) {
    return Object.freeze({
      decision: createDecision(kind, getRuntimeConfig(options), {
        destinationClass: policy.destinationClass,
        reasonCode: 'DESTINATION_INVALID',
      }),
      destination: null,
      timeoutMs,
    });
  }

  return Object.freeze({ decision: policy, destination, timeoutMs });
}

export class ExternalSideEffectPolicyError extends Error {
  readonly decision: ExternalSideEffectDecision;

  constructor(decision: ExternalSideEffectDecision) {
    super('External side effect is not allowed by server policy.');
    this.name = 'ExternalSideEffectPolicyError';
    this.decision = decision;
  }
}

export function assertExternalSideEffectAllowed(
  kind: ExternalSideEffectKind,
  options: ExternalSideEffectPolicyOptions = {},
): ResolvedExternalDestination {
  const resolved = resolveExternalDestination(kind, options);
  if (!resolved.decision.allowed || !resolved.destination) {
    throw new ExternalSideEffectPolicyError(resolved.decision);
  }
  return resolved;
}

export function buildSuppressedSideEffectResult(
  decision: ExternalSideEffectDecision,
): ExternalSideEffectResult {
  return Object.freeze({
    success: true,
    delivered: false,
    redirected: false,
    suppressed: true,
    environment: decision.environment,
    mode: decision.mode,
    destinationClass: decision.destinationClass,
    externalStatus: null,
    errorCode: decision.reasonCode,
    message: 'External side effect was suppressed by server policy.',
  });
}

export function buildFailedSideEffectResult(
  decision: ExternalSideEffectDecision,
  errorCode = decision.reasonCode,
  message = 'External side effect failed.',
  externalStatus: number | null = null,
): ExternalSideEffectResult {
  return Object.freeze({
    success: false,
    delivered: false,
    redirected: false,
    suppressed: false,
    environment: decision.environment,
    mode: decision.mode,
    destinationClass: decision.destinationClass,
    externalStatus,
    errorCode,
    message,
  });
}

function sanitizeLogIdentifier(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(trimmed) ? trimmed : '';
}

export function buildSafeSideEffectLogContext(
  decision: ExternalSideEffectDecision,
  values: Readonly<{
    requestId?: unknown;
    payloadByteSize?: unknown;
    submissionIdentifier?: unknown;
    externalStatus?: unknown;
  }> = {},
): Readonly<{
  requestId: string;
  environment: BackendEnvironment;
  mode: ExternalSideEffectsMode;
  payloadByteSize: number | null;
  submissionIdentifier: string;
  externalStatus: number | null;
}> {
  const payloadByteSize = Number(values.payloadByteSize);
  const externalStatus = Number(values.externalStatus);

  return Object.freeze({
    requestId: sanitizeLogIdentifier(values.requestId),
    environment: decision.environment,
    mode: decision.mode,
    payloadByteSize:
      Number.isSafeInteger(payloadByteSize) && payloadByteSize >= 0
        ? payloadByteSize
        : null,
    submissionIdentifier: sanitizeLogIdentifier(
      values.submissionIdentifier,
    ),
    externalStatus:
      Number.isInteger(externalStatus) && externalStatus >= 100
        ? externalStatus
        : null,
  });
}

export function buildZapierPersistenceDiagnostics(
  result: ExternalSideEffectResult,
): Readonly<{
  zapier_sent: boolean;
  zapier_suppressed: boolean;
  zapier_redirected: boolean;
  zapier_status: number | null;
  environment: BackendEnvironment;
  external_side_effects_mode: ExternalSideEffectsMode;
  destination_class: ExternalDestinationClass;
  error_code: string;
}> {
  return Object.freeze({
    zapier_sent: result.delivered === true,
    zapier_suppressed: result.suppressed === true,
    zapier_redirected: result.redirected === true,
    zapier_status: result.externalStatus,
    environment: result.environment,
    external_side_effects_mode: result.mode,
    destination_class: result.destinationClass,
    error_code: result.errorCode,
  });
}

export function stampSyntheticEnvironmentMetadata<T>(
  payload: T,
  options: ExternalSideEffectPolicyOptions = {},
): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const environment = getRuntimeConfig(options).environment;
  if (!['local', 'test', 'staging'].includes(environment)) return payload;

  const record = payload as Record<string, unknown>;
  const metadata =
    record.metadata &&
    typeof record.metadata === 'object' &&
    !Array.isArray(record.metadata)
      ? (record.metadata as Record<string, unknown>)
      : {};

  return {
    ...record,
    metadata: { ...metadata, environment },
  } as T;
}

export async function performZapierSubmission(
  payload: unknown,
  options: ZapierDeliveryOptions = {},
): Promise<ExternalSideEffectResult> {
  const resolved = resolveExternalDestination('zapier_submission', options);
  const { decision } = resolved;

  if (decision.reasonCode === 'EXTERNAL_SIDE_EFFECTS_DISABLED') {
    return buildSuppressedSideEffectResult(decision);
  }

  if (!decision.allowed || !resolved.destination) {
    return buildFailedSideEffectResult(
      decision,
      decision.reasonCode,
      'Zapier destination is unavailable under the current server policy.',
    );
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return buildFailedSideEffectResult(
      decision,
      'PAYLOAD_INVALID',
      'Zapier payload must be a JSON object.',
    );
  }

  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch {
    return buildFailedSideEffectResult(
      decision,
      'PAYLOAD_SERIALIZATION_FAILED',
      'Zapier payload could not be serialized.',
    );
  }

  if (new TextEncoder().encode(body).byteLength > MAX_EXTERNAL_PAYLOAD_BYTES) {
    return buildFailedSideEffectResult(
      decision,
      'PAYLOAD_TOO_LARGE',
      'Zapier payload exceeds the server-side size limit.',
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return buildFailedSideEffectResult(
      decision,
      'FETCH_UNAVAILABLE',
      'External delivery transport is unavailable.',
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), resolved.timeoutMs);

  try {
    const response = await fetchImpl(resolved.destination, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      return buildFailedSideEffectResult(
        decision,
        'EXTERNAL_HTTP_REJECTED',
        'Zapier rejected the delivery request.',
        response.status,
      );
    }

    return Object.freeze({
      success: true,
      delivered: true,
      redirected: decision.mode === 'staging_redirect',
      suppressed: false,
      environment: decision.environment,
      mode: decision.mode,
      destinationClass: decision.destinationClass,
      externalStatus: response.status,
      errorCode: '',
      message:
        decision.mode === 'staging_redirect'
          ? 'Data delivered to the configured staging destination.'
          : 'Data delivered to the configured production destination.',
    });
  } catch (error) {
    const timedOut =
      controller.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError');
    return buildFailedSideEffectResult(
      decision,
      timedOut ? 'EXTERNAL_TIMEOUT' : 'EXTERNAL_NETWORK_FAILED',
      timedOut
        ? 'Zapier delivery timed out.'
        : 'Zapier delivery failed before receiving a response.',
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
