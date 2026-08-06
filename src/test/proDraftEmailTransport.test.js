import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMAIL_TRANSPORT_ERROR_CODES,
  createSesClient,
  getEmailTransportConfig,
  getSafeEmailTransportDiagnostics,
  resolveEmailDestination,
  sendTransactionalEmail,
} from '../../base44/functions/_shared/proDraftEmailTransport/entry.ts';

const INTENDED_RECIPIENT = 'client-intent@example.test';
const STAGING_REDIRECT = 'internal-allowlist@example.invalid';
const SYNTHETIC_ACCESS_KEY_ID = 'SYNTHETIC_ACCESS_KEY_ID_FOR_TESTS';
const SYNTHETIC_SECRET_ACCESS_KEY = 'SYNTHETIC_SECRET_ACCESS_KEY_FOR_TESTS';

const env = (overrides = {}) => ({
  PRO_DRAFT_ENVIRONMENT: 'staging',
  PRO_DRAFT_EMAIL_MODE: 'staging_redirect',
  PRO_DRAFT_SES_FROM_EMAIL: 'noreply@mspsuccesswebsites.com',
  PRO_DRAFT_SES_FROM_NAME: 'MSP Success Websites',
  PRO_DRAFT_AWS_REGION: 'us-east-1',
  PRO_DRAFT_AWS_ACCESS_KEY_ID: SYNTHETIC_ACCESS_KEY_ID,
  PRO_DRAFT_AWS_SECRET_ACCESS_KEY: SYNTHETIC_SECRET_ACCESS_KEY,
  STAGING_EMAIL_REDIRECT_TO: STAGING_REDIRECT,
  PRO_DRAFT_SES_TIMEOUT_MS: '10000',
  PRO_DRAFT_RECOVERY_BASE_URL: 'https://questionnaire.example.test/recover',
  ...overrides,
});

const adapter = (send = vi.fn(async () => ({
  MessageId: 'synthetic-provider-message-id',
  $metadata: { httpStatusCode: 200 },
}))) => ({
  client: { send },
  createCommand: vi.fn((input) => input),
});

const sendOptions = (overrides = {}) => ({
  intendedRecipient: INTENDED_RECIPIENT,
  recipientAuthorized: true,
  subject: 'Your MSP Success Websites questionnaire recovery code',
  textBody: 'Synthetic recovery instructions.',
  htmlBody: '<html><body><p>Synthetic recovery instructions.</p></body></html>',
  requestId: 'request-email-test-1',
  envSource: env(),
  sesAdapter: adapter(),
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('pro draft SES transport configuration and routing', () => {
  it('suppresses disabled mode without constructing or calling an SES client', async () => {
    const createClient = vi.fn();
    const result = await sendTransactionalEmail(sendOptions({
      envSource: env({ PRO_DRAFT_EMAIL_MODE: 'disabled' }),
      sesAdapter: undefined,
      createClient,
    }));

    expect(createClient).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      delivered: false,
      suppressed: true,
      errorCode: EMAIL_TRANSPORT_ERROR_CODES.DISABLED,
    });
  });

  it('redirects staging only to the internal allowlist and prefixes the subject', async () => {
    const sesAdapter = adapter();
    const result = await sendTransactionalEmail(sendOptions({ sesAdapter }));

    expect(result).toMatchObject({
      success: true,
      delivered: true,
      redirected: true,
      destinationClass: 'staging_internal',
    });
    expect(sesAdapter.client.send).toHaveBeenCalledOnce();
    const command = sesAdapter.createCommand.mock.calls[0][0];
    expect(command.Destination.ToAddresses).toEqual([STAGING_REDIRECT]);
    expect(command.Destination.ToAddresses).not.toContain(INTENDED_RECIPIENT);
    expect(command.Content.Simple.Subject.Data).toBe(
      '[STAGING] Your MSP Success Websites questionnaire recovery code',
    );
    expect(JSON.stringify(command)).not.toContain(INTENDED_RECIPIENT);
  });

  it('fails closed when the staging redirect is missing or invalid', async () => {
    for (const redirect of [undefined, 'invalid-address', 'safe@example.invalid\r\nBcc:x']) {
      const sesAdapter = adapter();
      const result = await sendTransactionalEmail(sendOptions({
        envSource: env({ STAGING_EMAIL_REDIRECT_TO: redirect }),
        sesAdapter,
      }));
      expect(result.success).toBe(false);
      expect(result.errorCode).toMatch(/EMAIL_STAGING_REDIRECT_(?:MISSING|INVALID)/u);
      expect(sesAdapter.client.send).not.toHaveBeenCalled();
    }
  });

  it('sends production only to an upstream-authorized recipient with the fixed sender', async () => {
    const sesAdapter = adapter();
    const result = await sendTransactionalEmail(sendOptions({
      envSource: env({
        PRO_DRAFT_ENVIRONMENT: 'production',
        PRO_DRAFT_EMAIL_MODE: 'production',
        STAGING_EMAIL_REDIRECT_TO: undefined,
      }),
      sesAdapter,
    }));

    expect(result).toMatchObject({
      delivered: true,
      redirected: false,
      destinationClass: 'production_approved',
    });
    const command = sesAdapter.createCommand.mock.calls[0][0];
    expect(command.FromEmailAddress).toBe(
      'MSP Success Websites <noreply@mspsuccesswebsites.com>',
    );
    expect(command.Destination.ToAddresses).toEqual([INTENDED_RECIPIENT]);
  });

  it('rejects production mode in staging and staging mode in production', async () => {
    const mismatches = [
      env({ PRO_DRAFT_EMAIL_MODE: 'production' }),
      env({ PRO_DRAFT_ENVIRONMENT: 'production' }),
    ];
    for (const envSource of mismatches) {
      const sesAdapter = adapter();
      const result = await sendTransactionalEmail(sendOptions({ envSource, sesAdapter }));
      expect(result.errorCode).toBe(
        EMAIL_TRANSPORT_ERROR_CODES.MODE_ENVIRONMENT_MISMATCH,
      );
      expect(sesAdapter.client.send).not.toHaveBeenCalled();
    }
  });

  it('rejects unknown modes and unknown environments', async () => {
    await expect(sendTransactionalEmail(sendOptions({
      envSource: env({ PRO_DRAFT_EMAIL_MODE: 'surprise' }),
    }))).resolves.toMatchObject({ errorCode: EMAIL_TRANSPORT_ERROR_CODES.MODE_INVALID });
    await expect(sendTransactionalEmail(sendOptions({
      envSource: env({ PRO_DRAFT_ENVIRONMENT: 'mystery' }),
    }))).resolves.toMatchObject({
      errorCode: EMAIL_TRANSPORT_ERROR_CODES.ENVIRONMENT_INVALID,
    });
  });

  it('requires explicit upstream recipient authorization', async () => {
    const sesAdapter = adapter();
    const result = await sendTransactionalEmail(sendOptions({
      recipientAuthorized: false,
      sesAdapter,
    }));
    expect(result.errorCode).toBe(EMAIL_TRANSPORT_ERROR_CODES.RECIPIENT_NOT_AUTHORIZED);
    expect(sesAdapter.client.send).not.toHaveBeenCalled();
  });

  it('rejects invalid recipients and recipient header injection', async () => {
    for (const intendedRecipient of ['invalid', 'safe@example.test\r\nBcc:x']) {
      const sesAdapter = adapter();
      const result = await sendTransactionalEmail(sendOptions({
        intendedRecipient,
        sesAdapter,
      }));
      expect(result.errorCode).toBe(EMAIL_TRANSPORT_ERROR_CODES.RECIPIENT_INVALID);
      expect(sesAdapter.client.send).not.toHaveBeenCalled();
    }
  });

  it('rejects missing, injected, or non-approved sender configuration', async () => {
    const cases = [
      [undefined, EMAIL_TRANSPORT_ERROR_CODES.SENDER_MISSING],
      ['other@example.test', EMAIL_TRANSPORT_ERROR_CODES.SENDER_NOT_APPROVED],
      ['noreply@mspsuccesswebsites.com\r\nBcc:x', EMAIL_TRANSPORT_ERROR_CODES.SENDER_INVALID],
    ];
    for (const [fromEmail, errorCode] of cases) {
      const sesAdapter = adapter();
      const result = await sendTransactionalEmail(sendOptions({
        envSource: env({ PRO_DRAFT_SES_FROM_EMAIL: fromEmail }),
        sesAdapter,
      }));
      expect(result.errorCode).toBe(errorCode);
      expect(sesAdapter.client.send).not.toHaveBeenCalled();
    }
  });

  it('rejects subject and sender-name header injection', async () => {
    const injectedSubject = await sendTransactionalEmail(sendOptions({
      subject: 'Recovery\r\nBcc: attacker@example.test',
    }));
    expect(injectedSubject.errorCode).toBe(EMAIL_TRANSPORT_ERROR_CODES.CONTENT_INVALID);

    const injectedName = await sendTransactionalEmail(sendOptions({
      envSource: env({ PRO_DRAFT_SES_FROM_NAME: 'MSP Success\r\nReply-To:x' }),
    }));
    expect(injectedName.errorCode).toBe(EMAIL_TRANSPORT_ERROR_CODES.SENDER_INVALID);
  });

  it('uses a 10-second default and clamps the configured timeout to 2–30 seconds', () => {
    expect(getEmailTransportConfig({ envSource: env({ PRO_DRAFT_SES_TIMEOUT_MS: undefined }) })
      .timeoutMs).toBe(10_000);
    expect(getEmailTransportConfig({ envSource: env({ PRO_DRAFT_SES_TIMEOUT_MS: '1' }) })
      .timeoutMs).toBe(2_000);
    expect(getEmailTransportConfig({ envSource: env({ PRO_DRAFT_SES_TIMEOUT_MS: '99999' }) })
      .timeoutMs).toBe(30_000);
  });

  it('preserves standard AWS and legacy sender names through explicit compatibility mapping', () => {
    const config = getEmailTransportConfig({ envSource: env({
      PRO_DRAFT_AWS_REGION: undefined,
      PRO_DRAFT_AWS_ACCESS_KEY_ID: undefined,
      PRO_DRAFT_AWS_SECRET_ACCESS_KEY: undefined,
      PRO_DRAFT_SES_FROM_EMAIL: undefined,
      AWS_REGION: 'us-west-2',
      AWS_ACCESS_KEY_ID: SYNTHETIC_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: SYNTHETIC_SECRET_ACCESS_KEY,
      SES_FROM_ADDRESS: 'noreply@mspsuccesswebsites.com',
    }) });
    expect(config).toMatchObject({
      awsRegion: 'us-west-2',
      awsAccessKeyId: SYNTHETIC_ACCESS_KEY_ID,
      awsSecretAccessKey: SYNTHETIC_SECRET_ACCESS_KEY,
      fromEmail: 'noreply@mspsuccesswebsites.com',
    });
  });

  it('resolves only the domain as safe routing diagnostics', () => {
    const resolved = resolveEmailDestination({
      intendedRecipient: INTENDED_RECIPIENT,
      environment: 'staging',
      mode: 'staging_redirect',
      envSource: env(),
    });
    expect(resolved).toEqual({
      actualRecipient: STAGING_REDIRECT,
      destinationClass: 'staging_internal',
      redirected: true,
      safeRecipientDomain: 'example.invalid',
    });
  });
});

describe('pro draft SES adapter and safe result', () => {
  it('loads the official SES v2 SDK and constructs credentials only inside the backend adapter', async () => {
    const moduleLoader = vi.fn(async () => ({
      SESv2Client: class {
        constructor(config) { this.config = config; }
        async send() { return { MessageId: 'synthetic' }; }
      },
      SendEmailCommand: class {
        constructor(input) { this.input = input; }
      },
    }));
    const config = getEmailTransportConfig({ envSource: env() });
    const clientAdapter = await createSesClient(config, { moduleLoader });

    expect(moduleLoader).toHaveBeenCalledWith('npm:@aws-sdk/client-sesv2');
    expect(clientAdapter.client.config).toEqual({
      region: 'us-east-1',
      credentials: {
        accessKeyId: SYNTHETIC_ACCESS_KEY_ID,
        secretAccessKey: SYNTHETIC_SECRET_ACCESS_KEY,
      },
    });
  });

  it('returns the internal provider ID on success without exposing recipient or credentials', async () => {
    const result = await sendTransactionalEmail(sendOptions());
    expect(result).toEqual({
      success: true,
      delivered: true,
      suppressed: false,
      redirected: true,
      mode: 'staging_redirect',
      destinationClass: 'staging_internal',
      providerMessageId: 'synthetic-provider-message-id',
      providerStatus: 200,
      errorCode: null,
      requestId: 'request-email-test-1',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(INTENDED_RECIPIENT);
    expect(serialized).not.toContain(STAGING_REDIRECT);
    expect(serialized).not.toContain(SYNTHETIC_ACCESS_KEY_ID);
    expect(serialized).not.toContain(SYNTHETIC_SECRET_ACCESS_KEY);
  });

  it('maps SES failure to a safe error without returning the raw exception', async () => {
    const privateProviderMessage = 'PRIVATE_PROVIDER_RESPONSE_BODY';
    const result = await sendTransactionalEmail(sendOptions({
      sesAdapter: adapter(vi.fn(async () => {
        throw new Error(privateProviderMessage);
      })),
    }));
    expect(result.errorCode).toBe(EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_ERROR);
    expect(JSON.stringify(result)).not.toContain(privateProviderMessage);
  });

  it('maps synchronous command and send failures to a safe error result', async () => {
    const privateProviderMessage = 'PRIVATE_SYNCHRONOUS_PROVIDER_DETAIL';
    const commandFailure = await sendTransactionalEmail(sendOptions({
      sesAdapter: {
        client: { send: vi.fn() },
        createCommand: vi.fn(() => { throw new Error(privateProviderMessage); }),
      },
    }));
    const sendFailure = await sendTransactionalEmail(sendOptions({
      sesAdapter: adapter(vi.fn(() => { throw new Error(privateProviderMessage); })),
    }));

    for (const result of [commandFailure, sendFailure]) {
      expect(result.errorCode).toBe(EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_ERROR);
      expect(JSON.stringify(result)).not.toContain(privateProviderMessage);
    }
  });

  it('maps a bounded SES timeout to a safe timeout code', async () => {
    vi.useFakeTimers();
    const resultPromise = sendTransactionalEmail(sendOptions({
      envSource: env({ PRO_DRAFT_SES_TIMEOUT_MS: '1' }),
      sesAdapter: adapter(vi.fn(() => new Promise(() => {}))),
    }));
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(resultPromise).resolves.toMatchObject({
      success: false,
      delivered: false,
      errorCode: EMAIL_TRANSPORT_ERROR_CODES.PROVIDER_TIMEOUT,
    });
  });

  it('returns safe configuration diagnostics without email or AWS values', () => {
    const diagnostics = getSafeEmailTransportDiagnostics({ envSource: env() });
    expect(diagnostics).toMatchObject({
      mode: 'staging_redirect',
      senderApproved: true,
      credentialsConfigured: true,
      stagingRedirectConfigured: true,
      storesRawRecipient: false,
      storesRawCode: false,
    });
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain(INTENDED_RECIPIENT);
    expect(serialized).not.toContain(STAGING_REDIRECT);
    expect(serialized).not.toContain(SYNTHETIC_ACCESS_KEY_ID);
    expect(serialized).not.toContain(SYNTHETIC_SECRET_ACCESS_KEY);
  });

  it('contains no console logging, frontend variable, or persistence call', () => {
    const source = readFileSync(
      'base44/functions/_shared/proDraftEmailTransport/entry.ts',
      'utf8',
    );
    expect(source).not.toMatch(/console\.|VITE_|\.entities\.|localStorage|indexedDB/gu);
  });
});
