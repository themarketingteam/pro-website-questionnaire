const LOGICAL_TIME_VERSION = 1;

const isRecord = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const parseIso = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? Object.freeze({ milliseconds, iso: new Date(milliseconds).toISOString() })
    : null;
};

const inspectCreatedAt = (record) => {
  const value = isRecord(record) ? record : {};
  const candidates = [
    ['origin_created_at', value.origin_created_at],
    ['source_created_date', value.source_created_date],
    ['created_date', value.created_date],
  ];
  const warnings = [];
  for (const [source, candidate] of candidates) {
    const parsed = parseIso(candidate);
    if (parsed) return Object.freeze({ ...parsed, source, warnings: Object.freeze(warnings) });
    if (candidate !== undefined && candidate !== null && candidate !== '') {
      warnings.push(`INVALID_${source.toUpperCase()}`);
    }
  }
  warnings.push('LOGICAL_CREATED_AT_UNAVAILABLE');
  return Object.freeze({
    milliseconds: null,
    iso: null,
    source: null,
    warnings: Object.freeze(warnings),
  });
};

const inspectUpdatedAt = (record, options = {}) => {
  const value = isRecord(record) ? record : {};
  const origin = parseIso(value.origin_updated_at);
  const source = parseIso(value.source_updated_date);
  const destination = parseIso(value.updated_date);
  const lastSaved = options.allowLastSavedAt === true
    ? parseIso(value.last_saved_at)
    : null;
  const warnings = [];

  for (const [field, candidate, parsed] of [
    ['origin_updated_at', value.origin_updated_at, origin],
    ['source_updated_date', value.source_updated_date, source],
    ['updated_date', value.updated_date, destination],
    ...(options.allowLastSavedAt === true
      ? [['last_saved_at', value.last_saved_at, lastSaved]]
      : []),
  ]) {
    if (!parsed && candidate !== undefined && candidate !== null && candidate !== '') {
      warnings.push(`INVALID_${String(field).toUpperCase()}`);
    }
  }

  if (origin && (!source || origin.milliseconds >= source.milliseconds)) {
    return Object.freeze({ ...origin, source: 'origin_updated_at', warnings: Object.freeze(warnings) });
  }
  if (source) {
    if (origin && source.milliseconds > origin.milliseconds) {
      warnings.push('SOURCE_UPDATE_NEWER_THAN_ORIGIN');
    }
    return Object.freeze({
      ...source,
      source: 'source_updated_date',
      warnings: Object.freeze(warnings),
    });
  }
  if (destination) {
    return Object.freeze({
      ...destination,
      source: 'updated_date',
      warnings: Object.freeze(warnings),
    });
  }
  if (lastSaved) {
    return Object.freeze({
      ...lastSaved,
      source: 'last_saved_at',
      warnings: Object.freeze(warnings),
    });
  }
  warnings.push('LOGICAL_UPDATED_AT_UNAVAILABLE');
  return Object.freeze({
    milliseconds: null,
    iso: null,
    source: null,
    warnings: Object.freeze(warnings),
  });
};

export function getLogicalCreatedAt(record) {
  return inspectCreatedAt(record).iso;
}
export function getLogicalUpdatedAt(record, options = {}) {
  return inspectUpdatedAt(record, options).iso;
}

const compareInspectionsDescending = (left, right) => {
  if (left.milliseconds === right.milliseconds) return 0;
  if (left.milliseconds === null) return 1;
  if (right.milliseconds === null) return -1;
  return right.milliseconds - left.milliseconds;
};

export function compareLogicalCreatedAt(left, right) {
  return compareInspectionsDescending(inspectCreatedAt(left), inspectCreatedAt(right));
}

export function compareLogicalUpdatedAt(left, right, options = {}) {
  return compareInspectionsDescending(
    inspectUpdatedAt(left, options),
    inspectUpdatedAt(right, options),
  );
}

export function getSafeLogicalTimeDiagnostics(record, options = {}) {
  const created = inspectCreatedAt(record);
  const updated = inspectUpdatedAt(record, options);
  return Object.freeze({
    version: LOGICAL_TIME_VERSION,
    logicalCreatedAt: created.iso,
    logicalUpdatedAt: updated.iso,
    creationSource: created.source,
    updateSource: updated.source,
    warnings: Object.freeze([...new Set([...created.warnings, ...updated.warnings])]),
  });
}
