import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = JSON.parse(readFileSync(resolve(process.cwd(), 'base44/entities/ProFormSubmission.jsonc'), 'utf8'));

// Matches the Base44 entity DTO behavior observed in the synthetic hosted smoke:
// optional scalar/object properties become null, optional arrays become [].
const hydrate = (value, field) => {
  if (value === undefined) return field.type === 'array' ? [] : null;
  if (value === null) return null;
  if (field.type === 'array') return value.map((item) => hydrate(item, field.items || {}));
  if (field.type !== 'object' || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = { ...value };
  for (const [key, property] of Object.entries(field.properties || {})) result[key] = hydrate(value[key], property);
  return result;
};

export const hydrateProSubmissionEntity = (record) => hydrate(record, schema);
