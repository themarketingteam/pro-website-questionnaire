import { vi } from 'vitest';
export const copyRecord = value => value == null ? value : structuredClone(value);
export const memoryPath = (row, path) => path.split('.').reduce((value, key) => value?.[key], row);
export const matchesMemory = (row, query = {}) => Object.entries(query || {}).every(([key, expected]) => {
  if (key === '$and') return expected.every(condition => matchesMemory(row, condition));
  if (key === '$or') return expected.some(condition => matchesMemory(row, condition));
  const actual = memoryPath(row, key);
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) return Object.entries(expected).every(([operator, value]) => operator === '$in' ? value.includes(actual) : operator === '$nin' ? !value.includes(actual) : operator === '$gt' ? actual > value : operator === '$gte' ? actual >= value : operator === '$lt' ? actual < value : operator === '$lte' ? actual <= value : operator === '$ne' ? actual !== value : operator === '$exists' ? (actual !== undefined) === value : false);
  return expected == null ? actual == null : actual === expected;
});
export function memoryEntity(name, initial = []) {
  const rows = initial;
  const api = {
    rows,
    get: vi.fn(async id => { const row = rows.find(item => item.id === id); if (!row) throw Object.assign(new Error(`${name} not found`), { status: 404 }); return copyRecord(row); }),
    filter: vi.fn(async (query = {}, sort = '', limit = 500, skip = 0) => {
      const matched = rows.filter(row => matchesMemory(row, query));
      if (sort) { const descending = sort.startsWith('-'), field = sort.replace(/^-/, ''); matched.sort((left, right) => { const a = memoryPath(left, field) ?? '', b = memoryPath(right, field) ?? ''; return (a < b ? -1 : a > b ? 1 : 0) * (descending ? -1 : 1); }); }
      return copyRecord(matched.slice(skip, skip + limit));
    }),
    create: vi.fn(async value => { const row = { ...copyRecord(value), id: `${name}-${rows.length + 1}`, created_date: value.created_date || new Date().toISOString() }; rows.push(row); return copyRecord(row); }),
    update: vi.fn(async (id, update) => { const row = rows.find(item => item.id === id); if (!row) throw Object.assign(new Error('not found'), { status: 404 }); Object.assign(row, copyRecord(update)); return copyRecord(row); }),
    updateMany: vi.fn(async (query, update) => { let updated = 0; for (const row of rows) if (matchesMemory(row, query)) { Object.assign(row, copyRecord(update.$set || update)); updated++; } return { updated }; })
  };
  return api;
}
