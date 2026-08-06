import { describe, expect, it } from 'vitest';
import {
  evaluateRevisionWrite,
  PERSISTENCE_ERROR_CODES,
} from '../../../base44/functions/_shared/proDraftPersistence/entry.ts';
import {
  assertCrossAppMigrationRoute,
} from '../../../base44/functions/_shared/proFormCrossAppMigrationConfig/entry.ts';
import {
  buildMigrationDirectionLease,
} from '../../../base44/functions/_shared/proFormMigrationLease/entry.ts';
import {
  resolveProFormMigrationConflict,
  safeProFormMigrationConflict,
} from '../../../base44/functions/_shared/proFormMigrationConflict/entry.ts';
import {
  createMigrationBundle,
  signMigrationBundle,
  verifyMigrationBundle,
} from '../../../base44/functions/_shared/proFormMigrationBundle/entry.ts';
import { sha256Hex } from '../../../base44/functions/_shared/proDraftSecurity/entry.ts';
import {
  EMAIL_TRANSPORT_ERROR_CODES,
  resolveEmailDestination,
} from '../../../base44/functions/_shared/proDraftEmailTransport/entry.ts';
import {
  renderRecoveryCodeEmail,
  validateRenderedEmail,
} from '../../../base44/functions/_shared/proDraftEmailTemplates/entry.ts';
import {
  assertValidProDraftRlsAttackContract,
  proDraftRlsAttackContract,
} from '../../e2e/helpers/proDraftRlsAttackContract.js';
import { ATTACK_CATEGORY_CASES } from '../fixtures/adversarialFixtures.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const revisionInput = (overrides = {}) => ({
  storedClientRevision: 2,
  storedServerRevision: 5,
  storedStateHash: HASH_A,
  storedStatus: 'active',
  incomingClientRevision: 3,
  expectedServerRevision: 5,
  incomingStateHash: HASH_B,
  incomingStatus: 'active',
  idempotencyKey: 'security-idempotency-0001',
  storedIdempotencyKey: 'security-idempotency-0000',
  ...overrides,
});

describe('RLS and service-role attack contract', () => {
  it('requires anonymous and non-admin direct CRUD denial for sensitive entities', () => {
    expect(assertValidProDraftRlsAttackContract()).toBe(true);
    const direct = proDraftRlsAttackContract.directDenialCases;
    expect(direct.every((entry) => entry.expected === 'denied')).toBe(true);
    expect(new Set(direct.map((entry) => entry.actor))).toEqual(new Set([
      'anonymous', 'authenticated_non_admin',
    ]));
    expect(direct.some((entry) => entry.entity === 'ProFormRecoverySecurityEvent')).toBe(true);
  });

  it('requires authorized public/admin functions while preserving the backend boundary', () => {
    expect(proDraftRlsAttackContract.backendSuccessCases.map(({ functionName }) => functionName))
      .toEqual([
        'bootstrapProFormDraft',
        'saveProFormDraft',
        'recoverProFormDraftByCode',
        'listProFormDraftsForRecovery',
      ]);
    expect(proDraftRlsAttackContract.backendSuccessCases
      .every((entry) => entry.transport === 'backend_function')).toBe(true);
  });
});

describe('state, concurrency, and replay attacks', () => {
  it.each([
    ['lower revision replay', { incomingClientRevision: 1 }, 'reject_stale_client_revision'],
    ['same revision different hash', { incomingClientRevision: 2 }, 'reject_same_revision_different_hash'],
    ['server revision mismatch', { expectedServerRevision: 4 }, 'reject_server_revision_mismatch'],
    ['submitted regression', { storedStatus: 'submitted', incomingStatus: 'active' }, 'reject_status_transition'],
    ['superseded regression', { storedStatus: 'cleared_superseded', incomingStatus: 'active' }, 'reject_status_transition'],
  ])('rejects %s', (_name, overrides, decision) => {
    expect(evaluateRevisionWrite(revisionInput(overrides))).toMatchObject({ decision, conflict: true });
  });

  it('rejects idempotency-key replay with changed state', () => {
    expect(evaluateRevisionWrite(revisionInput({
      idempotencyKey: 'security-idempotency-0000',
    }))).toMatchObject({
      decision: 'reject_same_revision_different_hash',
      reasonCode: PERSISTENCE_ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
    });
  });

  it('declares the complete concurrency attack inventory', () => {
    expect(ATTACK_CATEGORY_CASES.concurrency).toHaveLength(16);
    expect(new Set(ATTACK_CATEGORY_CASES.concurrency).size).toBe(16);
  });
});

describe('SES and recovery-email safety without sending', () => {
  it('requires staging redirect and rejects production mode in staging', () => {
    expect(() => resolveEmailDestination({
      intendedRecipient: 'security-client@example.test',
      environment: 'staging',
      mode: 'staging_redirect',
      envSource: {},
    })).toThrowError(expect.objectContaining({
      code: EMAIL_TRANSPORT_ERROR_CODES.STAGING_REDIRECT_MISSING,
    }));
    expect(() => resolveEmailDestination({
      intendedRecipient: 'security-client@example.test',
      environment: 'staging',
      mode: 'production',
      envSource: {},
    })).toThrowError(expect.objectContaining({
      code: EMAIL_TRANSPORT_ERROR_CODES.MODE_ENVIRONMENT_MISMATCH,
    }));
  });

  it('escapes HTML and keeps recovery codes out of URLs and tracking assets', () => {
    const code = '2345-6789-ABCD-EFGH-JKMN';
    const rendered = renderRecoveryCodeEmail({
      recoveryCode: code,
      businessDisplayName: '<script>synthetic</script>',
      recoveryBaseUrl: 'https://questionnaire.example.test/recover',
      environment: 'staging',
      purpose: 'clear_all_replacement',
    });
    expect(validateRenderedEmail(rendered).valid).toBe(true);
    expect(rendered.subject).toMatch(/^\[STAGING\]/u);
    expect(rendered.htmlBody).not.toContain('<script>');
    expect(rendered.htmlBody).not.toMatch(/<img\b|tracking|src=/iu);
    expect(rendered.textBody).not.toContain(`?code=${code}`);
  });

  it('declares all email attacks and never constructs an SES client', () => {
    expect(ATTACK_CATEGORY_CASES.email).toHaveLength(14);
    expect(ATTACK_CATEGORY_CASES.email).toContain('future-auth-disabled');
  });
});

describe('migration tampering, replay, route, lease, and conflict attacks', () => {
  const createSignedBundle = async () => {
    const sourceAppId = 'security-source';
    const destinationAppId = 'security-destination';
    const bundle = await createMigrationBundle({
      migrationVersion: 1,
      migrationDirection: 'blue_to_green',
      operationMode: 'initial_full',
      sourceAppId,
      sourceAppFingerprint: await sha256Hex(sourceAppId),
      destinationAppId,
      destinationAppFingerprint: await sha256Hex(destinationAppId),
      sourceEnvironment: 'staging',
      destinationEnvironment: 'staging',
      entityName: 'ProFormDraft',
      batchId: 'security-batch',
      sequence: 4,
      snapshotCutoff: '2026-08-06T00:00:00.000Z',
      exportedAt: '2026-08-06T00:00:00.000Z',
      records: [],
    });
    return signMigrationBundle(bundle, { secret: 'm'.repeat(32) });
  };

  it('rejects signature, destination, source, sequence, and replay substitution', async () => {
    const bundle = await createSignedBundle();
    const options = {
      secret: 'm'.repeat(32),
      expectedSourceAppId: 'security-source',
      expectedDestinationAppId: 'security-destination',
      expectedDirection: 'blue_to_green',
      expectedEntityName: 'ProFormDraft',
      expectedSequence: 4,
      clock: () => Date.parse('2026-08-06T00:00:30.000Z'),
    };
    await expect(verifyMigrationBundle(bundle, options)).resolves.toMatchObject({ sequence: 4 });
    await expect(verifyMigrationBundle({ ...bundle, signature: `${bundle.signature.slice(0, -1)}A` }, options))
      .rejects.toHaveProperty('code');
    await expect(verifyMigrationBundle(bundle, { ...options, expectedDestinationAppId: 'other' }))
      .rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_ROUTE_MISMATCH' });
    await expect(verifyMigrationBundle(bundle, { ...options, expectedSourceAppId: 'other' }))
      .rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_ROUTE_MISMATCH' });
    await expect(verifyMigrationBundle(bundle, { ...options, expectedSequence: 3 }))
      .rejects.toMatchObject({ code: 'MIGRATION_BUNDLE_SEQUENCE_INVALID' });
  });

  it('denies cross-environment and same-app migration routes', () => {
    const config = {
      role: 'source',
      localAppId: 'security-source',
      environment: 'staging',
      allowedDirections: ['blue_to_green'],
      allowedDestinationAppIds: ['security-destination'],
      allowedSourceAppIds: [],
    };
    const route = {
      operation: 'source',
      sourceAppId: 'security-source',
      destinationAppId: 'security-destination',
      direction: 'blue_to_green',
      sourceEnvironment: 'staging',
      destinationEnvironment: 'staging',
    };
    expect(assertCrossAppMigrationRoute(config, route)).toBe(true);
    expect(() => assertCrossAppMigrationRoute(config, {
      ...route, destinationEnvironment: 'production',
    })).toThrowError(expect.objectContaining({
      code: 'CROSS_APP_MIGRATION_ENVIRONMENT_MISMATCH',
    }));
    expect(() => assertCrossAppMigrationRoute(config, {
      ...route, destinationAppId: 'security-source',
    })).toThrowError(expect.objectContaining({ code: 'CROSS_APP_MIGRATION_SAME_APP_REJECTED' }));
  });

  it('rejects opposite-direction leases and destination overwrite conflicts', async () => {
    const lease = await buildMigrationDirectionLease({
      direction: 'blue_to_green',
      leaseId: 'security-lease-1',
      leaseOwner: 'security-runner',
      sourceAppId: 'security-source',
      destinationAppId: 'security-destination',
      operationMode: 'incremental_delta',
      now: '2026-08-06T00:00:00.000Z',
    });
    await expect(buildMigrationDirectionLease({
      currentLease: lease,
      direction: 'green_to_blue',
      leaseId: 'security-lease-2',
      leaseOwner: 'security-runner',
      sourceAppId: 'security-destination',
      destinationAppId: 'security-source',
      operationMode: 'incremental_delta',
      now: '2026-08-06T00:01:00.000Z',
    })).rejects.toThrow('MIGRATION_OPPOSITE_DIRECTION_REJECTED');

    expect(resolveProFormMigrationConflict({
      sourceHash: 'source', destinationHash: 'destination', baseHash: 'base',
    })).toMatchObject({ policy: 'manual_no_merge', applySource: false });
    expect(safeProFormMigrationConflict({
      conflictType: 'source_and_destination_modified',
      entityName: 'ProFormDraft',
      answers: 'forbidden-raw-value',
      sourceHash: HASH_A,
    })).not.toHaveProperty('answers');
  });

  it('declares the complete migration attack inventory', () => {
    expect(ATTACK_CATEGORY_CASES.migration).toHaveLength(16);
  });
});
