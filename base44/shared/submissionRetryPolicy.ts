/** Pure scheduling/selection policy. This module performs no IO or delivery. */
export const RETRY_HOUR_MS = 60 * 60 * 1000;

const instant = (value: Date | string | number): number => {
  const parsed = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('A valid retry timestamp is required.');
  return parsed;
};

/** Skip the immediate hourly boundary: 15:33 failure -> 17:00 first retry. */
export function nextSubmissionRetryAt(failedAt: Date | string | number): string {
  return new Date(Math.floor(instant(failedAt) / RETRY_HOUR_MS) * RETRY_HOUR_MS + 2 * RETRY_HOUR_MS).toISOString();
}

type RetrySelection = {
  state?: string;
  nextAttemptAt?: string;
  leaseExpiresAt?: string;
  acceptedAt?: string;
  excluded?: boolean;
};

/** Includes overdue work and abandoned leases, never a confirmed acceptance. */
export function isSubmissionRetryDue(job: RetrySelection, now: Date | string | number = new Date()): boolean {
  if (job.excluded || job.acceptedAt || !['queued', 'retry_waiting', 'running'].includes(String(job.state || ''))) return false;
  const due = Date.parse(String(job.nextAttemptAt || ''));
  const lease = Date.parse(String(job.leaseExpiresAt || ''));
  const current = instant(now);
  if (!Number.isFinite(due) || due > current) return false;
  return !Number.isFinite(lease) || lease <= current;
}

const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const hostname = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/\.$/, ''); }
  catch { return ''; }
};

/** Existing validation fixtures must never enter an automatic delivery sweep. */
export function isAutomaticRetryExcluded(source: unknown, payload?: unknown): boolean {
  const item = record(source), data = record(payload);
  const metadata = [record(item.metadata), record(data.metadata)];
  if (item.automatic_retry_excluded === true || item.synthetic === true || metadata.some(meta => meta.automatic_retry_excluded === true || meta.synthetic === true)) return true;
  const names = [item.business_name, ...metadata.map(meta => meta.business_name)];
  if (names.some(name => typeof name === 'string' && /(?:\bDO\s+NOT\s+DELIVER\b|^SYNTHETIC(?:\b|_))/i.test(name))) return true;
  const domains = [item.business_domain, item.domain, ...metadata.flatMap(meta => [meta.businessDomain, meta.business_domain, meta.domain])].map(hostname);
  return domains.some(domain => domain === 'localhost' || /\.(?:test|invalid|example|localhost)$/.test(domain) || /(?:^|\.)example\.(?:com|net|org)$/.test(domain));
}
