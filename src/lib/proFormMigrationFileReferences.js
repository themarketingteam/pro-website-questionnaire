export const PRO_FORM_FILE_REFERENCE_CLASSIFICATIONS = Object.freeze([
  'external_stable_url',
  'public_base44_url',
  'app_scoped_base44_asset',
  'signed_or_expiring_url',
  's3_url',
  'cloudfront_url',
  'embedded_data_url',
  'unknown',
  'missing',
]);

const queryIsSigned = (url) => [...url.searchParams.keys()].some((key) => (
  /^(?:x-amz-|signature|expires|token|policy|key-pair-id)/iu.test(key)
));

export function classifyProFormFileReference(value) {
  if (value === null || value === undefined || value === '') return 'missing';
  if (typeof value !== 'string') return 'unknown';
  if (value.startsWith('data:')) return 'embedded_data_url';
  let url;
  try { url = new URL(value); } catch { return 'unknown'; }
  const host = url.hostname.toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol)) return 'unknown';
  if (queryIsSigned(url)) return 'signed_or_expiring_url';
  if (/(?:^|\.)s3[.-][a-z0-9-]+\.amazonaws\.com$|\.s3\.amazonaws\.com$/u.test(host)) return 's3_url';
  if (/\.cloudfront\.net$/u.test(host)) return 'cloudfront_url';
  if (/base44/u.test(host)) {
    return /(?:private|app[-_]?assets?|uploads?\/app|\/apps\/)/u.test(`${host}${url.pathname}`)
      ? 'app_scoped_base44_asset' : 'public_base44_url';
  }
  return 'external_stable_url';
}

export function redactProFormFileReference(value) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('data:')) return 'data:<redacted>';
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch { return '<invalid-url>'; }
}

async function fingerprintHost(host, cryptoProvider = globalThis.crypto) {
  if (!host || !cryptoProvider?.subtle) return null;
  const digest = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(host));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function buildProFormFileReferenceAuditRecord(input, options = {}) {
  const classification = classifyProFormFileReference(input.value);
  let host = null;
  try { host = new URL(input.value).hostname.toLowerCase(); } catch { /* classified above */ }
  const blocking = ['app_scoped_base44_asset', 'signed_or_expiring_url',
    'embedded_data_url', 'unknown', 'missing'].includes(classification);
  const reachability = options.reachability === true && typeof options.probe === 'function'
    ? await options.probe(redactProFormFileReference(input.value)) : 'not_checked';
  return Object.freeze({
    entityName: input.entityName,
    sourceRecordId: input.sourceRecordId,
    fieldPath: input.fieldPath,
    classification,
    hostFingerprint: await fingerprintHost(host, options.cryptoProvider),
    reachability,
    authRequired: ['app_scoped_base44_asset', 'signed_or_expiring_url'].includes(classification),
    copyRequired: blocking,
    replacementField: input.replacementField ?? null,
    manualReview: blocking || reachability === 'unreachable',
    redactedReference: redactProFormFileReference(input.value),
  });
}

export function collectProFormFileReferences(value, prefix = '') {
  if (Array.isArray(value)) return value.flatMap((child, index) => (
    collectProFormFileReferences(child, `${prefix}[${index}]`)
  ));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (/(?:email|external_?link)/iu.test(key)) return [];
    if (typeof child === 'string' && /(?:file|pdf|upload|attachment|document).*(?:url|uri|path)|^(?:file|pdf|upload|attachment|document)/iu.test(key)) {
      return [{ fieldPath: path, value: child }];
    }
    return collectProFormFileReferences(child, path);
  });
}

export function summarizeProFormFileReferenceAudit(records) {
  const classifications = Object.fromEntries(PRO_FORM_FILE_REFERENCE_CLASSIFICATIONS
    .map((classification) => [classification,
      records.filter((record) => record.classification === classification).length]));
  const blockers = records.filter((record) => record.manualReview === true).length;
  return Object.freeze({
    version: 1,
    referenceCount: records.length,
    classifications: Object.freeze(classifications),
    blockers,
    cutoverReady: blockers === 0,
    downloadsPerformed: 0,
    containsFileContent: false,
  });
}
