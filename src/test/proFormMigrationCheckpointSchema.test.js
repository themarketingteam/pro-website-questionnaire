import { readFileSync } from 'node:fs';
import { parse, parseTree } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

const path = 'base44/entities/ProFormMigrationCheckpoint.jsonc';
const text = readFileSync(path, 'utf8');
const errors = [];
const schema = parse(text, errors, { allowTrailingComma: false, disallowComments: false });
const ADMIN_RLS = { create: { user_condition: { role: 'admin' } }, read: { user_condition: { role: 'admin' } }, update: { user_condition: { role: 'admin' } }, delete: { user_condition: { role: 'admin' } } };

describe('ProFormMigrationCheckpoint schema', () => {
  it('parses as unique JSONC', () => {
    const treeErrors = []; const tree = parseTree(text, treeErrors, { allowTrailingComma: false, disallowComments: false });
    expect(errors).toEqual([]); expect(treeErrors).toEqual([]);
    const keys = tree.children.find((node) => node.children?.[0]?.value === 'properties').children[1].children.map((node) => node.children[0].value);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('requires only the immutable migration identity', () => {
    expect(schema.required).toEqual(['migration_name', 'environment', 'migration_version', 'batch_id']);
  });
  it('enforces admin-only CRUD', () => { expect(schema.rls).toEqual(ADMIN_RLS); });
  it('stores hashes but no raw token, grant, answer, or email field', () => {
    expect(schema.properties).toHaveProperty('apply_token_hash');
    expect(schema.properties).toHaveProperty('retention_apply_token_hash');
    expect(schema.properties).toHaveProperty('retention_report_hash');
    expect(schema.properties.retention_cutoff.format).toBe('date-time');
    for (const forbidden of ['apply_token','admin_grant','password','answer_content','email']) expect(schema.properties).not.toHaveProperty(forbidden);
  });
});
