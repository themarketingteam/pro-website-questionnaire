export const RETENTION_DAYS = 1095;
export const RETENTION_POLICY_VERSION = 'three-year-active-v1';
export const RETENTION_MILLISECONDS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const validIso = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
};

export const latestMeaningfulActivity = (record: any, fields: string[]) => {
  const candidates = fields
    .map((field) => field.split('.').reduce((value, key) => value?.[key], record))
    .map(validIso)
    .filter(Boolean)
    .sort();
  return candidates[candidates.length - 1]
    || validIso(record?.retention_started_at)
    || validIso(record?.created_date)
    || validIso(record?.updated_date)
    || new Date(0).toISOString();
};

export const retentionUntilFor = (activityAt: string) => new Date(
  Date.parse(activityAt) + RETENTION_MILLISECONDS
).toISOString();

export const shouldArchiveAt = (activityAt: string, now: Date | string | number) => (
  Date.parse(retentionUntilFor(activityAt)) <= new Date(now).getTime()
);
