const SENSITIVE_ENTITIES = new Map([
  'ProFormDraft',
  'ProFormDraftEvent',
  'ProFormRecoverySecurityEvent',
  'ProFormEmailVerificationAttempt',
  'ProFormSubmissionIntake',
].map((name) => [name.toLowerCase(), name]));

const decodeSegment = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * Match the entity route forms already captured by the staging E2E harness:
 * /api/entities/:entity/:operation and
 * /api/apps/:appId/entities/:entity/:operation.
 * Function invocation routes are deliberately outside these shapes.
 */
export function classifySensitiveEntityRequest(value, method = 'GET') {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment);
  const entitiesIndex = segments.findIndex((segment) => segment.toLowerCase() === 'entities');
  if (entitiesIndex < 0) return null;

  const isObservedEntityRoute = (
    entitiesIndex === 1 && segments[0].toLowerCase() === 'api'
  ) || (
    entitiesIndex === 3
    && segments[0].toLowerCase() === 'api'
    && segments[1].toLowerCase() === 'apps'
    && segments[2].length > 0
  );
  if (!isObservedEntityRoute) return null;

  const entity = SENSITIVE_ENTITIES.get((segments[entitiesIndex + 1] || '').toLowerCase());
  if (!entity) return null;

  return Object.freeze({
    entity,
    method: String(method).toUpperCase(),
    operation: segments[entitiesIndex + 2] || 'access',
    route: entitiesIndex === 1
      ? `/api/entities/<sensitive-entity>/${segments[entitiesIndex + 2] || 'access'}`
      : `/api/apps/<app>/entities/<sensitive-entity>/${segments[entitiesIndex + 2] || 'access'}`,
  });
}

export function installSensitiveEntityNetworkGuard(page) {
  const violations = [];
  const onRequest = (request) => {
    const violation = classifySensitiveEntityRequest(request.url(), request.method());
    if (violation) violations.push(violation);
  };

  page.on('request', onRequest);

  return Object.freeze({
    violations,
    safeSummary: () => ({
      directSensitiveEntityRequestCount: violations.length,
      directSensitiveEntityRequests: violations.map((violation) => ({ ...violation })),
    }),
    stop: () => page.off('request', onRequest),
    assertNoViolations: () => {
      if (violations.length === 0) return;
      const details = violations
        .map(({ entity, method, operation }) => `${method} ${entity} ${operation}`)
        .join(', ');
      throw new Error(`DIRECT_SENSITIVE_ENTITY_REQUEST_DETECTED: ${details}`);
    },
  });
}

export const sensitiveEntityNetworkGuardPolicy = Object.freeze({
  entities: Object.freeze([...SENSITIVE_ENTITIES.values()]),
  observedRouteShapes: Object.freeze([
    '/api/entities/:entity/:operation',
    '/api/apps/:appId/entities/:entity/:operation',
  ]),
});
