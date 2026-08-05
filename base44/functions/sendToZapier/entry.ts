import {
  MAX_EXTERNAL_PAYLOAD_BYTES,
  buildFailedSideEffectResult,
  buildSafeSideEffectLogContext,
  getExternalSideEffectPolicy,
  performZapierSubmission,
  type ExternalSideEffectPolicyOptions,
} from '../_shared/proExternalSideEffects/entry.ts';

const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id',
});

type HandlerDependencies = ExternalSideEffectPolicyOptions &
  Readonly<{
    fetchImpl?: typeof fetch;
    logger?: Pick<Console, 'info' | 'error'>;
  }>;

function responseStatusForResult(result: {
  success: boolean;
  errorCode: string;
}): number {
  if (result.success) return 200;
  if (result.errorCode === 'EXTERNAL_TIMEOUT') return 504;
  if (result.errorCode === 'EXTERNAL_HTTP_REJECTED') return 502;
  if (result.errorCode === 'PAYLOAD_TOO_LARGE') return 413;
  if (result.errorCode.startsWith('PAYLOAD_')) return 400;
  return 503;
}

function safeRequestId(req: Request): string {
  const provided = req.headers.get('x-request-id') || '';
  if (provided) return provided;
  try {
    return crypto.randomUUID();
  } catch {
    return '';
  }
}

function safeSubmissionIdentifier(payload: Record<string, unknown>): unknown {
  const metadata =
    payload.metadata &&
    typeof payload.metadata === 'object' &&
    !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : {};
  return (
    metadata.questionnaire_session_id ||
    metadata.submission_id ||
    payload.submission_id ||
    ''
  );
}

export function createSendToZapierHandler(
  dependencies: HandlerDependencies = {},
): (req: Request) => Promise<Response> {
  const policyOptions: ExternalSideEffectPolicyOptions = {
    envSource: dependencies.envSource,
    runtimeConfig: dependencies.runtimeConfig,
    allowHttpForTests: dependencies.allowHttpForTests,
  };
  const logger = dependencies.logger ?? console;

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const decision = getExternalSideEffectPolicy(
      'zapier_submission',
      policyOptions,
    );
    const validationFailure = (errorCode: string, message: string, status: number) =>
      Response.json(
        buildFailedSideEffectResult(decision, errorCode, message),
        { status, headers: CORS_HEADERS },
      );

    if (req.method !== 'POST') {
      return validationFailure(
        'METHOD_NOT_ALLOWED',
        'Only POST requests are supported.',
        405,
      );
    }

    const contentType = (req.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (contentType !== 'application/json') {
      return validationFailure(
        'CONTENT_TYPE_UNSUPPORTED',
        'Content-Type must be application/json.',
        415,
      );
    }

    const declaredLength = Number(req.headers.get('content-length'));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_EXTERNAL_PAYLOAD_BYTES
    ) {
      return validationFailure(
        'PAYLOAD_TOO_LARGE',
        'Request body exceeds the server-side size limit.',
        413,
      );
    }

    let requestText = '';
    try {
      requestText = await req.text();
    } catch {
      return validationFailure(
        'PAYLOAD_READ_FAILED',
        'Request body could not be read.',
        400,
      );
    }

    const payloadByteSize = new TextEncoder().encode(requestText).byteLength;
    if (payloadByteSize > MAX_EXTERNAL_PAYLOAD_BYTES) {
      return validationFailure(
        'PAYLOAD_TOO_LARGE',
        'Request body exceeds the server-side size limit.',
        413,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(requestText);
    } catch {
      return validationFailure(
        'PAYLOAD_INVALID_JSON',
        'Request body must contain valid JSON.',
        400,
      );
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return validationFailure(
        'PAYLOAD_INVALID',
        'Request body must contain a JSON object.',
        400,
      );
    }

    const result = await performZapierSubmission(payload, {
      ...policyOptions,
      fetchImpl: dependencies.fetchImpl,
    });
    const logContext = buildSafeSideEffectLogContext(decision, {
      requestId: safeRequestId(req),
      payloadByteSize,
      submissionIdentifier: safeSubmissionIdentifier(
        payload as Record<string, unknown>,
      ),
      externalStatus: result.externalStatus,
    });

    if (result.success) {
      logger.info('Zapier side-effect result', logContext);
    } else {
      logger.error('Zapier side-effect result', logContext);
    }

    return Response.json(result, {
      status: responseStatusForResult(result),
      headers: CORS_HEADERS,
    });
  };
}

export default createSendToZapierHandler();
