/** Backend-only Amazon SES v2 transport with fail-closed environment routing. */

import { normalizeRecoveryEmail } from '../proDraftIdentity/entry.ts';

export const PRO_DRAFT_EMAIL_TRANSPORT_VERSION = 1;

export const EMAIL_TRANSPORT_MODES = Object.freeze([
  'disabled',
  'staging_redirect',
  'production',
] as const);

export const EMAIL_TRANSPORT_ERROR_CODES = Object.freeze({
  DISABLED: 'EMAIL_TRANSPORT_DISABLED',
  MODE_INVALID: 'EMAIL_TRANSPORT_MODE_INVALID',
  ENVIRONMENT_INVALID: 'EMAIL_TRANSPORT_ENVIRONMENT_INVALID',
  MODE_ENVIRONMENT_MISMATCH: 'EMAIL_TRANSPORT_MODE_ENVIRONMENT_MISMATCH',
  RECIPIENT_NOT_AUTHORIZED: 'EMAIL_RECIPIENT_NOT_AUTHORIZED',
  RECIPIENT_INVALID: 'EMAIL_RECIPIENT_INVALID',
  STAGING_REDIRECT_MISSING: 'EMAIL_STAGING_REDIRECT_MISSING',
  STAGING_REDIRECT_INVALID: 'EMAIL_STAGING_REDIRECT_INVALID',
  SENDER_MISSING: 'EMAIL_SENDER_MISSING',
  SENDER_INVALID: 'EMAIL_SENDER_INVALID',
  SENDER_NOT_APPROVED: 'EMAIL_SENDER_NOT_APPROVED',
  REGION_MISSING: 'EMAIL_SES_REGION_MISSING',
  REGION_INVALID: 'EMAIL_SES_REGION_INVALID',
  CREDENTIALS_MISSING: 'EMAIL_SES_CREDENTIALS_MISSING',
  CONTENT_INVALID: 'EMAIL_CONTENT_INVALID',
  CLIENT_UNAVAILABLE: 'EMAIL_SES_CLIENT_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'EMAIL_SES_PROVIDER_TIMEOUT',
  PROVIDER_REJECTED: 'EMAIL_SES_PROVIDER_REJECTED',
  PROVIDER_ERROR: 'EMAIL_SES_PROVIDER_ERROR',
} as const);

export type EmailTransportMode = typeof EMAIL_TRANSPORT_MODES[number];
export type EmailTransportErrorCode = typeof EMAIL_TRANSPORT_ERROR_CODES[
  keyof typeof EMAIL_TRANSPORT_ERROR_CODES
];
export type EmailTransportEnvironment =
  | 'local'
  | 'test'
  | 'staging'
  | 'production'
  | 'unknown';
export type EmailDestinationClass =
  | 'none'
  | 'staging_internal'
  | 'production_approved';

type EnvironmentSource = Readonly<Record<string, unknown>>
  | Readonly<{ get: (name: string) => unknown }>
  | ((name: string) => unknown);

export type EmailTransportConfig = Readonly<{
  version: number;
  environment: EmailTransportEnvironment;
  mode: EmailTransportMode;
  modeRecognized: boolean;
  fromEmail: string;
  fromName: string;
  awsRegion: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsSessionToken: string;
  stagingRedirectTo: string;
  timeoutMs: number;
  recoveryBaseUrl: string;
}>;

export type ResolvedEmailDestination = Readonly<{
  actualRecipient: string;
  destinationClass: EmailDestinationClass;
  redirected: boolean;
  safeRecipientDomain: string;
}>;

export type InternalEmailTransportResult = Readonly<{
  success: boolean;
  delivered: boolean;
  suppressed: boolean;
  redirected: boolean;
  mode: EmailTransportMode;
  destinationClass: EmailDestinationClass;
  providerMessageId: string | null;
  providerStatus: number | null;
  errorCode: EmailTransportErrorCode | null;
  requestId: string;
}>;

type SesSendOutput = Readonly<{
  MessageId?: unknown;
  $metadata?: Readonly<{ httpStatusCode?: unknown }>;
}>;

type SesClientLike = Readonly<{
  send: (
    command: unknown,
    options?: Readonly<{ abortSignal?: AbortSignal }>,
  ) => Promise<SesSendOutput>;
}>;

export type SesClientAdapter = Readonly<{
  client: SesClientLike;
  createCommand: (input: Readonly<Record<string, unknown>>) => unknown;
}>;

type SesV2Module = Readonly<{
  SESv2Client: new (config: Readonly<Record<string, unknown>>) => SesClientLike;
  SendEmailCommand: new (input: Readonly<Record<string, unknown>>) => unknown;
}>;

export type CreateSesClientOptions = Readonly<{
  moduleLoader?: (specifier: string) => Promise<SesV2Module>;
}>;

export type SendTransactionalEmailOptions = Readonly<{
  intendedRecipient: unknown;
  recipientAuthorized: boolean;
  subject: unknown;
  textBody: unknown;
  htmlBody: unknown;
  requestId: unknown;
  environment?: EmailTransportEnvironment;
  envSource?: EnvironmentSource;
  sesAdapter?: SesClientAdapter;
  createClient?: (
    config: EmailTransportConfig,
  ) => Promise<SesClientAdapter>;
}>;

const SES_V2_MODULE_SPECIFIER = 'npm:@aws-sdk/client-sesv2';
const APPROVED_SENDER_EMAIL = 'noreply@mspsuccesswebsites.com';
const DEFAULT_SENDER_NAME = 'MSP Success Websites';
const STAGING_SUBJECT_PREFIX = '[STAGING] ';
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_SUBJECT_LENGTH = 200;
const MAX_SENDER_NAME_LENGTH = 100;
const MAX_BODY_LENGTH = 200_000;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_PROVIDER_MESSAGE_ID_LENGTH = 512;
const HEADER_CONTROL_PATTERN = /[\r\n]/u;
const AWS_REGION_PATTERN = /^(?:[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d|us-gov-[a-z]+-\d)$/u;

function readDefaultEnvironment(name: string): unknown {
  try {
    return (globalThis as typeof globalThis & {
      Deno?: { env?: { get?: (key: string) => string | undefined } };
    }).Deno?.env?.get?.(name);
  } catch {
    return undefined;
  }
}

function readEnvironmentValue(
  source: EnvironmentSource | undefined,
  name: string,
): unknown {
  if (!source) return readDefaultEnvironment(name);
  try {
    if (typeof source === 'function') return source(name);
    if ('get' in source && typeof source.get === 'function') return source.get(name);
    return source[name];
  } catch {
    return undefined;
  }
}

function readCompatibleValue(
  source: EnvironmentSource | undefined,
  preferredName: string,
  compatibilityName?: string,
): string {
  const preferred = readEnvironmentValue(source, preferredName);
  if (typeof preferred === 'string' && preferred !== '') return preferred;
  if (!compatibilityName) return '';
  const compatibility = readEnvironmentValue(source, compatibilityName);
  return typeof compatibility === 'string' ? compatibility : '';
}

function resolveEnvironment(value: unknown): EmailTransportEnvironment {
  return value === 'local' || value === 'test' || value === 'staging'
    || value === 'production' ? value : 'unknown';
}

function resolveMode(value: unknown): Readonly<{
  mode: EmailTransportMode;
  recognized: boolean;
}> {
  if (value === undefined || value === null || value === '') {
    return Object.freeze({ mode: 'disabled', recognized: true });
  }
  if (EMAIL_TRANSPORT_MODES.includes(value as EmailTransportMode)) {
    return Object.freeze({ mode: value as EmailTransportMode, recognized: true });
  }
  return Object.freeze({ mode: 'disabled', recognized: false });
}

function boundedTimeout(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, parsed));
}

function safeRequestId(value: unknown): string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_REQUEST_ID_LENGTH
    && !HEADER_CONTROL_PATTERN.test(value)
    && /^[A-Za-z0-9._:-]+$/u.test(value)
    ? value
    : '';
}

function errorResult(
  config: EmailTransportConfig,
  errorCode: EmailTransportErrorCode,
  requestId: string,
  destinationClass: EmailDestinationClass = 'none',
  redirected = false,
): InternalEmailTransportResult {
  return Object.freeze({
    success: false,
    delivered: false,
    suppressed: false,
    redirected,
    mode: config.mode,
    destinationClass,
    providerMessageId: null,
    providerStatus: null,
    errorCode,
    requestId,
  });
}

function validateSender(config: EmailTransportConfig): EmailTransportErrorCode | null {
  if (!config.fromEmail) return EMAIL_TRANSPORT_ERROR_CODES.SENDER_MISSING;
  if (HEADER_CONTROL_PATTERN.test(config.fromEmail)
    || HEADER_CONTROL_PATTERN.test(config.fromName)
    || config.fromName.length > MAX_SENDER_NAME_LENGTH) {
    return EMAIL_TRANSPORT_ERROR_CODES.SENDER_INVALID;
  }
  const normalized = normalizeRecoveryEmail(config.fromEmail);
  if (!normalized.valid) return EMAIL_TRANSPORT_ERROR_CODES.SENDER_INVALID;
  if (normalized.normalizedEmail !== APPROVED_SENDER_EMAIL) {
    return EMAIL_TRANSPORT_ERROR_CODES.SENDER_NOT_APPROVED;
  }
  return null;
}

function validateProviderConfiguration(
  config: EmailTransportConfig,
): EmailTransportErrorCode | null {
  const senderError = validateSender(config);
  if (senderError) return senderError;
  if (!config.awsRegion) return EMAIL_TRANSPORT_ERROR_CODES.REGION_MISSING;
  if (!AWS_REGION_PATTERN.test(config.awsRegion)) {
    return EMAIL_TRANSPORT_ERROR_CODES.REGION_INVALID;
  }
  if (!config.awsAccessKeyId || !config.awsSecretAccessKey) {
    return EMAIL_TRANSPORT_ERROR_CODES.CREDENTIALS_MISSING;
  }
  return null;
}

function validateContent(
  subject: unknown,
  textBody: unknown,
  htmlBody: unknown,
): subject is string {
  return typeof subject === 'string'
    && subject.length > 0
    && subject.length <= MAX_SUBJECT_LENGTH
    && !HEADER_CONTROL_PATTERN.test(subject)
    && typeof textBody === 'string'
    && textBody.length > 0
    && textBody.length <= MAX_BODY_LENGTH
    && typeof htmlBody === 'string'
    && htmlBody.length > 0
    && htmlBody.length <= MAX_BODY_LENGTH;
}

export function getEmailTransportConfig(options: Readonly<{
  envSource?: EnvironmentSource;
  environment?: EmailTransportEnvironment;
}> = {}): EmailTransportConfig {
  const mode = resolveMode(readEnvironmentValue(options.envSource, 'PRO_DRAFT_EMAIL_MODE'));
  const selectedEnvironment = resolveEnvironment(
    options.environment ?? readEnvironmentValue(options.envSource, 'PRO_DRAFT_ENVIRONMENT'),
  );
  return Object.freeze({
    version: PRO_DRAFT_EMAIL_TRANSPORT_VERSION,
    environment: selectedEnvironment,
    mode: mode.mode,
    modeRecognized: mode.recognized,
    fromEmail: readCompatibleValue(
      options.envSource,
      'PRO_DRAFT_SES_FROM_EMAIL',
      'SES_FROM_ADDRESS',
    ).trim(),
    fromName: readCompatibleValue(
      options.envSource,
      'PRO_DRAFT_SES_FROM_NAME',
    ).trim() || DEFAULT_SENDER_NAME,
    awsRegion: readCompatibleValue(
      options.envSource,
      'PRO_DRAFT_AWS_REGION',
      'AWS_REGION',
    ).trim(),
    awsAccessKeyId: readCompatibleValue(
      options.envSource,
      'PRO_DRAFT_AWS_ACCESS_KEY_ID',
      'AWS_ACCESS_KEY_ID',
    ),
    awsSecretAccessKey: readCompatibleValue(
      options.envSource,
      'PRO_DRAFT_AWS_SECRET_ACCESS_KEY',
      'AWS_SECRET_ACCESS_KEY',
    ),
    awsSessionToken: readCompatibleValue(
      options.envSource,
      'PRO_DRAFT_AWS_SESSION_TOKEN',
      'AWS_SESSION_TOKEN',
    ),
    stagingRedirectTo: readCompatibleValue(
      options.envSource,
      'STAGING_EMAIL_REDIRECT_TO',
    ).trim(),
    timeoutMs: boundedTimeout(
      readEnvironmentValue(options.envSource, 'PRO_DRAFT_SES_TIMEOUT_MS'),
    ),
    recoveryBaseUrl: readCompatibleValue(
      options.envSource,
      'PRO_DRAFT_RECOVERY_BASE_URL',
    ).trim(),
  });
}

export function resolveEmailDestination(input: Readonly<{
  intendedRecipient: unknown;
  environment: EmailTransportEnvironment;
  mode: EmailTransportMode;
  envSource?: EnvironmentSource;
}>): ResolvedEmailDestination {
  const intended = normalizeRecoveryEmail(input.intendedRecipient);
  if (!intended.valid || HEADER_CONTROL_PATTERN.test(String(input.intendedRecipient))) {
    throw new EmailTransportContractError(EMAIL_TRANSPORT_ERROR_CODES.RECIPIENT_INVALID);
  }

  if (input.mode === 'staging_redirect') {
    if (input.environment !== 'staging') {
      throw new EmailTransportContractError(
        EMAIL_TRANSPORT_ERROR_CODES.MODE_ENVIRONMENT_MISMATCH,
      );
    }
    const rawRedirect = readEnvironmentValue(input.envSource, 'STAGING_EMAIL_REDIRECT_TO');
    if (typeof rawRedirect !== 'string' || rawRedirect.trim() === '') {
      throw new EmailTransportContractError(
        EMAIL_TRANSPORT_ERROR_CODES.STAGING_REDIRECT_MISSING,
      );
    }
    const redirect = normalizeRecoveryEmail(rawRedirect);
    if (!redirect.valid || HEADER_CONTROL_PATTERN.test(rawRedirect)) {
      throw new EmailTransportContractError(
        EMAIL_TRANSPORT_ERROR_CODES.STAGING_REDIRECT_INVALID,
      );
    }
    return Object.freeze({
      actualRecipient: redirect.normalizedEmail,
      destinationClass: 'staging_internal',
      redirected: true,
      safeRecipientDomain: redirect.normalizedEmail.split('@')[1],
    });
  }

  if (input.mode === 'production' && input.environment === 'production') {
    return Object.freeze({
      actualRecipient: intended.normalizedEmail,
      destinationClass: 'production_approved',
      redirected: false,
      safeRecipientDomain: intended.normalizedEmail.split('@')[1],
    });
  }

  throw new EmailTransportContractError(
    EMAIL_TRANSPORT_ERROR_CODES.MODE_ENVIRONMENT_MISMATCH,
  );
}

export class EmailTransportContractError extends Error {
  readonly code: EmailTransportErrorCode;

  constructor(code: EmailTransportErrorCode) {
    super('Email transport request was rejected by backend policy.');
    this.name = 'EmailTransportContractError';
    this.code = code;
  }
}

export async function createSesClient(
  config: EmailTransportConfig,
  options: CreateSesClientOptions = {},
): Promise<SesClientAdapter> {
  const configurationError = validateProviderConfiguration(config);
  if (configurationError) throw new EmailTransportContractError(configurationError);

  try {
    const loader = options.moduleLoader ?? (
      async (specifier: string) => await import(specifier) as unknown as SesV2Module
    );
    const sdk = await loader(SES_V2_MODULE_SPECIFIER);
    const credentials = {
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
      ...(config.awsSessionToken ? { sessionToken: config.awsSessionToken } : {}),
    };
    const client = new sdk.SESv2Client({ region: config.awsRegion, credentials });
    return Object.freeze({
      client,
      createCommand: (input) => new sdk.SendEmailCommand(input),
    });
  } catch (error) {
    if (error instanceof EmailTransportContractError) throw error;
    throw new EmailTransportContractError(
      EMAIL_TRANSPORT_ERROR_CODES.CLIENT_UNAVAILABLE,
    );
  }
}

export async function sendTransactionalEmail(
  options: SendTransactionalEmailOptions,
): Promise<InternalEmailTransportResult> {
  const config = getEmailTransportConfig({
    envSource: options.envSource,
    environment: options.environment,
  });
  const requestId = safeRequestId(options.requestId);

  if (!config.modeRecognized) {
    return errorResult(config, EMAIL_TRANSPORT_ERROR_CODES.MODE_INVALID, requestId);
  }
  if (config.mode === 'disabled') {
    return Object.freeze({
      success: true,
      delivered: false,
      suppressed: true,
      redirected: false,
      mode: config.mode,
      destinationClass: 'none',
      providerMessageId: null,
      providerStatus: null,
      errorCode: EMAIL_TRANSPORT_ERROR_CODES.DISABLED,
      requestId,
    });
  }
  if (config.environment !== 'staging' && config.environment !== 'production') {
    return errorResult(config, EMAIL_TRANSPORT_ERROR_CODES.ENVIRONMENT_INVALID, requestId);
  }
  if ((config.mode === 'staging_redirect' && config.environment !== 'staging')
    || (config.mode === 'production' && config.environment !== 'production')) {
    return errorResult(
      config,
      EMAIL_TRANSPORT_ERROR_CODES.MODE_ENVIRONMENT_MISMATCH,
      requestId,
    );
  }
  if (options.recipientAuthorized !== true) {
    return errorResult(
      config,
      EMAIL_TRANSPORT_ERROR_CODES.RECIPIENT_NOT_AUTHORIZED,
      requestId,
    );
  }

  let destination: ResolvedEmailDestination;
  try {
    destination = resolveEmailDestination({
      intendedRecipient: options.intendedRecipient,
      environment: config.environment,
      mode: config.mode,
      envSource: options.envSource,
    });
  } catch (error) {
    const code = error instanceof EmailTransportContractError
      ? error.code
      : EMAIL_TRANSPORT_ERROR_CODES.RECIPIENT_INVALID;
    return errorResult(config, code, requestId);
  }

  const providerConfigurationError = validateProviderConfiguration(config);
  if (providerConfigurationError) {
    return errorResult(
      config,
      providerConfigurationError,
      requestId,
      destination.destinationClass,
      destination.redirected,
    );
  }
  if (!validateContent(options.subject, options.textBody, options.htmlBody)) {
    return errorResult(
      config,
      EMAIL_TRANSPORT_ERROR_CODES.CONTENT_INVALID,
      requestId,
      destination.destinationClass,
      destination.redirected,
    );
  }

  const subject = config.mode === 'staging_redirect'
    && !options.subject.startsWith(STAGING_SUBJECT_PREFIX)
    ? `${STAGING_SUBJECT_PREFIX}${options.subject}`
    : options.subject;
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return errorResult(
      config,
      EMAIL_TRANSPORT_ERROR_CODES.CONTENT_INVALID,
      requestId,
      destination.destinationClass,
      destination.redirected,
    );
  }

  let adapter: SesClientAdapter;
  try {
    adapter = options.sesAdapter
      ?? await (options.createClient ?? createSesClient)(config);
  } catch {
    return errorResult(
      config,
      EMAIL_TRANSPORT_ERROR_CODES.CLIENT_UNAVAILABLE,
      requestId,
      destination.destinationClass,
      destination.redirected,
    );
  }

  let command: unknown;
  try {
    command = adapter.createCommand({
      FromEmailAddress: `${config.fromName} <${APPROVED_SENDER_EMAIL}>`,
      Destination: { ToAddresses: [destination.actualRecipient] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Text: { Data: options.textBody, Charset: 'UTF-8' },
            Html: { Data: options.htmlBody, Charset: 'UTF-8' },
          },
        },
      },
    });
  } catch {
    return errorResult(
      config,
      EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_ERROR,
      requestId,
      destination.destinationClass,
      destination.redirected,
    );
  }
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutOutcome = new Promise<Readonly<{ timedOut: true }>>((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve(Object.freeze({ timedOut: true }));
    }, config.timeoutMs);
  });
  const sendOutcome = Promise.resolve().then(
    () => adapter.client.send(command, { abortSignal: controller.signal }),
  ).then(
    (value) => Object.freeze({ timedOut: false as const, value }),
    (error: unknown) => Object.freeze({ timedOut: false as const, error }),
  );

  try {
    const outcome = await Promise.race([sendOutcome, timeoutOutcome]);
    if (outcome.timedOut === true) {
      return errorResult(
        config,
        EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_TIMEOUT,
        requestId,
        destination.destinationClass,
        destination.redirected,
      );
    }
    if ('error' in outcome) {
      const timedOut = outcome.error instanceof DOMException
        && outcome.error.name === 'AbortError';
      return errorResult(
        config,
        timedOut
          ? EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_TIMEOUT
          : EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_ERROR,
        requestId,
        destination.destinationClass,
        destination.redirected,
      );
    }
    if (!('value' in outcome)) {
      return errorResult(
        config,
        EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_ERROR,
        requestId,
        destination.destinationClass,
        destination.redirected,
      );
    }
    const providerOutput = outcome.value;
    const providerStatus = Number.isSafeInteger(providerOutput.$metadata?.httpStatusCode)
      ? providerOutput.$metadata?.httpStatusCode as number
      : null;
    const providerMessageId = typeof providerOutput.MessageId === 'string'
      && providerOutput.MessageId.length > 0
      && providerOutput.MessageId.length <= MAX_PROVIDER_MESSAGE_ID_LENGTH
      && !HEADER_CONTROL_PATTERN.test(providerOutput.MessageId)
      ? providerOutput.MessageId
      : null;
    if ((providerStatus !== null && (providerStatus < 200 || providerStatus >= 300))
      || !providerMessageId) {
      return errorResult(
        config,
        providerStatus !== null
          ? EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_REJECTED
          : EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_ERROR,
        requestId,
        destination.destinationClass,
        destination.redirected,
      );
    }
    return Object.freeze({
      success: true,
      delivered: true,
      suppressed: false,
      redirected: destination.redirected,
      mode: config.mode,
      destinationClass: destination.destinationClass,
      providerMessageId,
      providerStatus,
      errorCode: null,
      requestId,
    });
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

export function getSafeEmailTransportDiagnostics(options: Readonly<{
  envSource?: EnvironmentSource;
  environment?: EmailTransportEnvironment;
}> = {}): Readonly<Record<string, unknown>> {
  const config = getEmailTransportConfig(options);
  const senderError = validateSender(config);
  return Object.freeze({
    version: config.version,
    environment: config.environment,
    mode: config.mode,
    modeRecognized: config.modeRecognized,
    senderConfigured: config.fromEmail !== '',
    senderApproved: senderError === null,
    senderNameConfigured: config.fromName !== '',
    regionConfigured: config.awsRegion !== '',
    credentialsConfigured: config.awsAccessKeyId !== ''
      && config.awsSecretAccessKey !== '',
    sessionTokenConfigured: config.awsSessionToken !== '',
    stagingRedirectConfigured: config.stagingRedirectTo !== '',
    recoveryBaseUrlConfigured: config.recoveryBaseUrl !== '',
    timeoutMs: config.timeoutMs,
    sdk: '@aws-sdk/client-sesv2',
    storesRawRecipient: false,
    storesRawCode: false,
    logsRawRecipient: false,
    logsRawCode: false,
  });
}
