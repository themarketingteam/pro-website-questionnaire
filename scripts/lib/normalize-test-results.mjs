import path from 'node:path';

const SECRET_KEY = /(answer|credential|password|secret|token|grant|recovery.?code|storage.?state|authorization|cookie|stack)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TOKEN = /\bbearer\s+[A-Za-z0-9._-]{12,}\b|\b(?:b44k_|ghp_|sk_)[A-Za-z0-9_-]{12,}\b/gi;
const REQUIREMENT_ID = /\bDR-[A-Z0-9-]+\b/g;

export const redactUrl = (value) => {
  try {
    const url = new URL(String(value));
    url.search = '';
    url.hash = '';
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return String(value).replace(/([?#]).*$/, '');
  }
};

export const sanitizeEvidenceValue = (value, key = '') => {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidenceValue(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeEvidenceValue(childValue, childKey),
    ]));
  }

  let text = String(value).replace(EMAIL, '[REDACTED_EMAIL]').replace(TOKEN, '[REDACTED_TOKEN]');
  if (/^https?:\/\//i.test(text)) text = redactUrl(text);
  return text;
};

const statusOf = (value) => {
  const status = String(value || '').toLowerCase();
  if (['passed', 'pass', 'ok', 'success'].includes(status)) return 'passed';
  if (['failed', 'fail', 'error', 'timedout', 'timed_out'].includes(status)) return 'failed';
  if (['skipped', 'skip', 'pending', 'todo', 'fixme', 'disabled'].includes(status)) return 'skipped';
  if (['blocked', 'cancelled', 'canceled', 'interrupted'].includes(status)) return 'blocked';
  return 'unknown';
};

const requirementIdsOf = (...values) => [...new Set(
  values.flatMap((value) => String(value || '').match(REQUIREMENT_ID) || []),
)].sort();

const safeCode = (value) => {
  const match = String(value?.code || value?.name || value || '').match(/[A-Z][A-Z0-9_]{2,63}/);
  return match?.[0] || null;
};

const normalized = (input, defaults) => ({
  testId: String(input.testId || input.title || input.name || 'UNNAMED_TEST').slice(0, 240),
  requirementIds: input.requirementIds?.length
    ? [...new Set(input.requirementIds)].sort()
    : requirementIdsOf(input.testId, input.title, input.name),
  phase: String(input.phase || defaults.phase || 'unknown'),
  environment: String(input.environment || defaults.environment || 'unknown'),
  browser: input.browser ? String(input.browser) : null,
  status: statusOf(input.status),
  durationMs: Number.isFinite(Number(input.durationMs ?? input.duration))
    ? Math.max(0, Number(input.durationMs ?? input.duration))
    : 0,
  artifactPaths: (input.artifactPaths || input.artifacts || [])
    .map((artifact) => redactUrl(String(artifact.path || artifact)))
    .map((artifact) => artifact.split(path.sep).join('/')),
  safeErrorCode: safeCode(input.safeErrorCode || input.error),
  timestamp: String(input.timestamp || defaults.timestamp || new Date().toISOString()),
  commitSha: String(input.commitSha || defaults.commitSha || 'unknown'),
});

const normalizeVitest = (input, defaults) => (input.testResults || []).flatMap((file) => {
  const assertions = file.assertionResults || file.tests || [];
  if (assertions.length === 0) {
    return [normalized({
      durationMs: file.endTime && file.startTime ? file.endTime - file.startTime : file.duration,
      error: file.message,
      name: file.name,
      status: file.status,
      testId: file.name,
    }, defaults)];
  }
  return assertions.map((assertion) => normalized({
    durationMs: assertion.duration,
    error: assertion.failureMessages?.[0],
    name: assertion.fullName || assertion.title,
    status: assertion.status,
    testId: assertion.fullName || assertion.title,
  }, defaults));
});

const normalizePlaywright = (input, defaults) => {
  const output = [];
  const visit = (suite, ancestors = []) => {
    const titles = [...ancestors, suite.title].filter(Boolean);
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const result = test.results?.at(-1) || {};
        output.push(normalized({
          artifactPaths: (result.attachments || []).map((attachment) => attachment.path).filter(Boolean),
          browser: test.projectName,
          durationMs: result.duration,
          error: result.error,
          name: [...titles, spec.title].join(' > '),
          status: result.status || test.status,
          testId: spec.title,
        }, defaults));
      }
    }
    for (const child of suite.suites || []) visit(child, titles);
  };
  for (const suite of input.suites || []) visit(suite);
  return output;
};

const normalizeGeneric = (input, defaults) => {
  const results = input.results || input.checks || input.tests || [input];
  return results.map((result, index) => normalized({
    ...result,
    testId: result.testId || result.id || result.checkId || `${defaults.format || 'manual'}-${index + 1}`,
  }, defaults));
};

export const normalizeTestResults = (input, options = {}) => {
  const defaults = {
    ...options,
    format: options.format || input?.format || 'manual',
  };
  let results;
  if (defaults.format === 'vitest' || Array.isArray(input?.testResults)) {
    results = normalizeVitest(input, defaults);
  } else if (defaults.format === 'playwright' || Array.isArray(input?.suites)) {
    results = normalizePlaywright(input, defaults);
  } else {
    results = normalizeGeneric(input || {}, defaults);
  }
  return results.map((result) => sanitizeEvidenceValue(result));
};
