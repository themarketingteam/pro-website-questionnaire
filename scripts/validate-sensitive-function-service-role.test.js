import { describe, expect, it } from 'vitest';
import {
  hasExplicitMigrationPolicy,
  scanSensitiveServiceRoleSource,
} from './validate-sensitive-function-service-role.mjs';

const entities = ['ProFormDraft', 'ProFormDraftEvent', 'ProFormRecoverySecurityEvent'];

const scan = (source, file = 'base44/functions/example/entry.ts') => (
  scanSensitiveServiceRoleSource({ file, source, sensitiveEntities: entities })
);

describe('sensitive function service-role validator', () => {
  it('rejects ordinary backend entity access', () => {
    expect(scan(`
      async function handler(request) {
        validateSaveDraftRequest(await request.json());
        return base44.entities.ProFormDraft.update('id', {});
      }
    `)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'sensitive-entity-must-use-service-role' }),
    ]));
  });

  it('rejects service-role draft access before authorization', () => {
    expect(scan(`
      async function handler(request) {
        return base44.asServiceRole.entities.ProFormDraft.get('id');
      }
    `)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'protected-access-before-authorization' }),
    ]));
  });

  it('allows service-role draft access after request authorization', () => {
    expect(scan(`
      async function handler(request) {
        const authorization = await authorizeDraftRead(request);
        return base44.asServiceRole.entities.ProFormDraft.get(authorization.draftId);
      }
    `)).toEqual([]);
  });

  it('requires safe request setup before a security-event operation', () => {
    expect(scan(`
      async function handler(request) {
        return base44.asServiceRole.entities.ProFormRecoverySecurityEvent.create({});
      }
    `)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'security-event-access-before-safe-request-setup' }),
    ]));
    expect(scan(`
      async function handler(request) {
        const body = await readBoundedJsonBody(request);
        validateRecoveryRequest(body);
        return base44.asServiceRole.entities.ProFormRecoverySecurityEvent.create({});
      }
    `)).toEqual([]);
  });

  it('rejects frontend service role even without an entity operation', () => {
    expect(scanSensitiveServiceRoleSource({
      file: 'src/example.js',
      source: 'const elevated = base44.asServiceRole;',
      sensitiveEntities: entities,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: 'no-frontend-service-role' }),
    ]));
  });

  it('permits an explicit migration-path exception', () => {
    expect(scanSensitiveServiceRoleSource({
      file: 'scripts/migrations/reconcile.ts',
      source: 'await base44.entities.ProFormDraft.update("id", {});',
      sensitiveEntities: entities,
    })).toEqual([]);
  });

  it('requires migration exceptions to be declared in policy', () => {
    expect(hasExplicitMigrationPolicy({ allowedLocations: [] })).toBe(false);
    expect(hasExplicitMigrationPolicy({
      allowedLocations: [{
        pattern: 'scripts/migrations/**',
        operations: ['update'],
        rule: 'approved-migration-only',
      }],
    })).toBe(true);
  });
});
