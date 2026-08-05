/**
 * Central fail-closed runtime configuration for durable-draft Base44 functions.
 *
 * This shared source module has no local imports and reads only the explicitly
 * named variables below. Consumers may inline it if required by the Base44
 * function runtime.
 */

export type BackendEnvironment =
  | 'local'
  | 'test'
  | 'staging'
  | 'production'
  | 'unknown';

export type ExternalSideEffectsMode =
  | 'disabled'
  | 'staging_redirect'
  | 'production';

type BackendEnvSource =
  | Readonly<Record<string, unknown>>
  | Readonly<{ get: (name: string) => unknown }>
  | ((name: string) => unknown);

export type BackendRuntimeConfig = Readonly<{
  environment: BackendEnvironment;
  environmentRecognized: boolean;
  configurationValid: boolean;
  externalSideEffectsMode: ExternalSideEffectsMode;
  externalSideEffectsConfigurationValid: boolean;
  buildSha: string;
  killSwitchEnabled: boolean;
  durableDraftV2Enabled: boolean;
  publicEmailRecoveryEnabled: boolean;
  emailOtpEnabled: boolean;
  magicLinkEnabled: boolean;
  diagnosticsEnabled: boolean;
}>;

type SafeErrorCode =
  | 'PRO_DRAFT_DISABLED'
  | 'PRO_DRAFT_ENVIRONMENT_MISMATCH';

type SafeErrorDetails = Readonly<{
  environment: BackendEnvironment;
  expectedEnvironment?: BackendEnvironment;
  configurationValid: boolean;
  killSwitchEnabled?: boolean;
}>;

const BACKEND_ENVIRONMENTS: readonly BackendEnvironment[] = Object.freeze([
  'local',
  'test',
  'staging',
  'production',
  'unknown',
]);

const EXTERNAL_SIDE_EFFECTS_MODES: readonly ExternalSideEffectsMode[] =
  Object.freeze(['disabled', 'staging_redirect', 'production']);

const STRICT_BOOLEAN_LITERALS = new Set(['true', 'false']);

/** Only the exact lowercase string "true" enables a boolean flag. */
export function parseStrictBoolean(value: unknown): boolean {
  return value === 'true';
}

export function normalizeBackendEnvironment(value: unknown): BackendEnvironment {
  return typeof value === 'string' &&
    BACKEND_ENVIRONMENTS.includes(value as BackendEnvironment)
    ? (value as BackendEnvironment)
    : 'unknown';
}

export function normalizeExternalSideEffectsMode(
  value: unknown,
): ExternalSideEffectsMode {
  return typeof value === 'string' &&
    EXTERNAL_SIDE_EFFECTS_MODES.includes(value as ExternalSideEffectsMode)
    ? (value as ExternalSideEffectsMode)
    : 'disabled';
}

function isStrictBooleanLiteral(value: unknown): boolean {
  return typeof value === 'string' && STRICT_BOOLEAN_LITERALS.has(value);
}

function sanitizeBuildIdentifier(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    return '';
  }

  return /^[A-Za-z0-9._:+-]+$/.test(value) ? value : '';
}

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

function readEnvironmentValue(source: BackendEnvSource, name: string): unknown {
  try {
    if (typeof source === 'function') {
      return source(name);
    }

    if ('get' in source && typeof source.get === 'function') {
      return source.get(name);
    }

    return source[name];
  } catch {
    return undefined;
  }
}

function isExternalSideEffectsCombinationValid(
  environment: BackendEnvironment,
  mode: ExternalSideEffectsMode,
): boolean {
  if (mode === 'production') return environment === 'production';
  if (mode === 'staging_redirect') return environment === 'staging';
  return environment !== 'unknown';
}

export function getBackendRuntimeConfig(
  envSource: BackendEnvSource = readDenoEnvironmentVariable,
): BackendRuntimeConfig {
  const environmentValue = readEnvironmentValue(
    envSource,
    'PRO_DRAFT_ENVIRONMENT',
  );
  const v2EnabledValue = readEnvironmentValue(
    envSource,
    'PRO_DRAFT_V2_SERVER_ENABLED',
  );
  const killSwitchValue = readEnvironmentValue(
    envSource,
    'PRO_DRAFT_V2_KILL_SWITCH',
  );
  const sideEffectsModeValue = readEnvironmentValue(
    envSource,
    'PRO_DRAFT_EXTERNAL_SIDE_EFFECTS_MODE',
  );
  const environment = normalizeBackendEnvironment(environmentValue);
  const environmentRecognized = environment !== 'unknown';
  const externalSideEffectsMode = normalizeExternalSideEffectsMode(
    sideEffectsModeValue,
  );
  const externalSideEffectsModeRecognized =
    typeof sideEffectsModeValue === 'string' &&
    EXTERNAL_SIDE_EFFECTS_MODES.includes(
      sideEffectsModeValue as ExternalSideEffectsMode,
    );
  const externalSideEffectsConfigurationValid =
    environmentRecognized &&
    externalSideEffectsModeRecognized &&
    isExternalSideEffectsCombinationValid(environment, externalSideEffectsMode);
  const configurationValid =
    environmentRecognized &&
    isStrictBooleanLiteral(v2EnabledValue) &&
    isStrictBooleanLiteral(killSwitchValue) &&
    externalSideEffectsConfigurationValid;
  const killSwitchEnabled = parseStrictBoolean(killSwitchValue);
  const durableDraftV2Enabled =
    configurationValid &&
    parseStrictBoolean(v2EnabledValue) &&
    !killSwitchEnabled;

  return Object.freeze({
    environment,
    environmentRecognized,
    configurationValid,
    externalSideEffectsMode,
    externalSideEffectsConfigurationValid,
    buildSha: sanitizeBuildIdentifier(
      readEnvironmentValue(envSource, 'PRO_DRAFT_BUILD_SHA'),
    ),
    killSwitchEnabled,
    durableDraftV2Enabled,
    publicEmailRecoveryEnabled:
      durableDraftV2Enabled &&
      parseStrictBoolean(
        readEnvironmentValue(
          envSource,
          'PRO_DRAFT_PUBLIC_EMAIL_RECOVERY_ENABLED',
        ),
      ),
    emailOtpEnabled:
      durableDraftV2Enabled &&
      parseStrictBoolean(
        readEnvironmentValue(envSource, 'PRO_DRAFT_EMAIL_OTP_ENABLED'),
      ),
    magicLinkEnabled:
      durableDraftV2Enabled &&
      parseStrictBoolean(
        readEnvironmentValue(envSource, 'PRO_DRAFT_MAGIC_LINK_ENABLED'),
      ),
    diagnosticsEnabled:
      environmentRecognized &&
      !killSwitchEnabled &&
      parseStrictBoolean(
        readEnvironmentValue(envSource, 'PRO_DRAFT_DIAGNOSTICS_ENABLED'),
      ),
  });
}

export function isDurableDraftServerEnabled(
  config: BackendRuntimeConfig = getBackendRuntimeConfig(),
): boolean {
  return config.durableDraftV2Enabled === true;
}

export function isPublicEmailRecoveryServerEnabled(
  config: BackendRuntimeConfig = getBackendRuntimeConfig(),
): boolean {
  return config.publicEmailRecoveryEnabled === true;
}

export function isEmailOtpServerEnabled(
  config: BackendRuntimeConfig = getBackendRuntimeConfig(),
): boolean {
  return config.emailOtpEnabled === true;
}

export function isMagicLinkServerEnabled(
  config: BackendRuntimeConfig = getBackendRuntimeConfig(),
): boolean {
  return config.magicLinkEnabled === true;
}

export class ProDraftRuntimeConfigError extends Error {
  readonly code: SafeErrorCode;
  readonly status: 503;
  readonly details: SafeErrorDetails;

  constructor(
    code: SafeErrorCode,
    message: string,
    details: SafeErrorDetails,
  ) {
    super(message);
    this.name = 'ProDraftRuntimeConfigError';
    this.code = code;
    this.status = 503;
    this.details = Object.freeze({ ...details });
  }

  toSafeResponse(): Readonly<{
    ok: false;
    error: Readonly<{
      code: SafeErrorCode;
      message: string;
      details: SafeErrorDetails;
    }>;
  }> {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        code: this.code,
        message: this.message,
        details: this.details,
      }),
    });
  }
}

export function assertDurableDraftServerEnabled(
  config: BackendRuntimeConfig = getBackendRuntimeConfig(),
): BackendRuntimeConfig {
  if (!isDurableDraftServerEnabled(config)) {
    throw new ProDraftRuntimeConfigError(
      'PRO_DRAFT_DISABLED',
      'Durable draft processing is unavailable.',
      {
        environment: config.environment,
        configurationValid: config.configurationValid,
        killSwitchEnabled: config.killSwitchEnabled,
      },
    );
  }

  return config;
}

export function assertExpectedEnvironment(
  expectedEnvironment: BackendEnvironment,
  config: BackendRuntimeConfig = getBackendRuntimeConfig(),
): BackendRuntimeConfig {
  const normalizedExpected = normalizeBackendEnvironment(expectedEnvironment);

  if (
    normalizedExpected === 'unknown' ||
    !config.environmentRecognized ||
    config.environment !== normalizedExpected
  ) {
    throw new ProDraftRuntimeConfigError(
      'PRO_DRAFT_ENVIRONMENT_MISMATCH',
      'The runtime environment does not match the expected environment.',
      {
        environment: config.environment,
        expectedEnvironment: normalizedExpected,
        configurationValid: config.configurationValid,
      },
    );
  }

  return config;
}

export function getSafeBackendRuntimeSummary(
  config: BackendRuntimeConfig = getBackendRuntimeConfig(),
): Readonly<BackendRuntimeConfig> {
  return Object.freeze({
    environment: config.environment,
    environmentRecognized: config.environmentRecognized === true,
    configurationValid: config.configurationValid === true,
    externalSideEffectsMode: config.externalSideEffectsMode,
    externalSideEffectsConfigurationValid:
      config.externalSideEffectsConfigurationValid === true,
    buildSha: sanitizeBuildIdentifier(config.buildSha),
    killSwitchEnabled: config.killSwitchEnabled === true,
    durableDraftV2Enabled: config.durableDraftV2Enabled === true,
    publicEmailRecoveryEnabled: config.publicEmailRecoveryEnabled === true,
    emailOtpEnabled: config.emailOtpEnabled === true,
    magicLinkEnabled: config.magicLinkEnabled === true,
    diagnosticsEnabled: config.diagnosticsEnabled === true,
  });
}
