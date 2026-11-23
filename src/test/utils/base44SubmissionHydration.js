import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = JSON.parse(readFileSync(resolve(process.cwd(), 'base44/entities/ProFormSubmission.jsonc'), 'utf8'));

// Matches the Base44 entity DTO behavior observed in the synthetic hosted smoke:
// undeclared fields are dropped, optional scalar/object properties become null,
// and optional arrays become []. Keep this schema projection strict: spreading
// unknown fields here previously hid real receipt-storage loss.
const hydrate = (value, field) => {
  if (value === undefined) return field.type === 'array' ? [] : null;
  if (value === null) return null;
  if (field.type === 'array') return value.map((item) => hydrate(item, field.items || {}));
  if (field.type !== 'object' || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = field.properties ? {} : { ...value };
  for (const [key, property] of Object.entries(field.properties || {})) result[key] = hydrate(value[key], property);
  return result;
};

const systemFields = new Set(['id', 'created_date', 'updated_date', 'created_by', 'created_by_id', 'is_sample']);
export const hydrateProSubmissionEntity = (record) => ({
  ...Object.fromEntries(Object.entries(record).filter(([key]) => systemFields.has(key))),
  ...hydrate(record, schema)
});
