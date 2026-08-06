import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

const ADMIN_RLS = {
  create: { user_condition: { role: 'admin' } },
  read: { user_condition: { role: 'admin' } },
  update: { user_condition: { role: 'admin' } },
  delete: { user_condition: { role: 'admin' } },
};
const load = (name) => parse(readFileSync(path.resolve(
  `base44/entities/${name}.jsonc`,
), 'utf8'));

describe('blue/green migration control schemas', () => {
  it('defines the deterministic ID map with only the six required identities', () => {
    const schema = load('ProFormMigrationIdMap');
    expect(schema.name).toBe('ProFormMigrationIdMap');
    expect(schema.required).toEqual([
      'source_app_id',
      'source_entity',
      'source_record_id',
      'destination_app_id',
      'destination_entity',
      'destination_record_id',
    ]);
    expect(schema.properties.relationship_finalized).toMatchObject({
      type: 'boolean',
      default: false,
    });
    expect(schema.rls).toEqual(ADMIN_RLS);
  });

  it('defines a safe conflict record without record payload fields', () => {
    const schema = load('ProFormMigrationConflict');
    expect(schema.name).toBe('ProFormMigrationConflict');
    expect(schema.required).toEqual(['conflict_id', 'environment']);
    expect(schema.properties.status.enum).toEqual([
      'open',
      'resolved_source',
      'resolved_destination',
      'resolved_manual',
      'ignored',
    ]);
    expect(schema.rls).toEqual(ADMIN_RLS);
    for (const forbidden of ['payload', 'answers', 'email', 'recovery_code', 'token']) {
      expect(schema.properties).not.toHaveProperty(forbidden);
    }
    expect(schema.properties.safe_diagnostics_json.description)
      .toMatch(/no record payload, answer, email, code, token, or file content/u);
  });
});
