import { describe, expect, it } from 'vitest';
import {
  createEmptyCanonicalDraftState,
  parseCanonicalDraftState,
  sanitizeDraftSerializableValue,
} from '../../../src/lib/questionnaireDraftState.js';
import { normalizeBusinessDomain } from '../../../src/lib/proDraftIdentity.js';
import { collectChangedFieldPaths } from '../../../src/lib/proDraftConflictMerge.js';
import {
  normalizeRecoveryCodeInput,
  normalizeRecoveryEmail,
} from '../../../base44/functions/_shared/proDraftIdentity/entry.ts';
import {
  AUTHORIZATION_SECRET_NAMES,
  SIGNED_TOKEN_SCOPES,
  SIGNED_TOKEN_TYPES,
  verifyStructuredToken,
} from '../../../base44/functions/_shared/proDraftAuthorization/entry.ts';
import {
  readBoundedJsonBody,
  validateIdempotencyKey,
} from '../../../base44/functions/_shared/proDraftPersistence/entry.ts';
import {
  createMigrationBundle,
  validateMigrationBundle,
} from '../../../base44/functions/_shared/proFormMigrationBundle/entry.ts';
import { sha256Hex } from '../../../base44/functions/_shared/proDraftSecurity/entry.ts';
import {
  assertSeededProperty,
  fc,
  getPropertyTestOptions,
} from '../helpers/propertyTest.js';
import { safeTokenSecret } from '../fixtures/adversarialFixtures.js';

const safeCharacter = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789 -_'.split(''));
const safeText = (minimum = 0, maximum = 48) => fc.array(safeCharacter, {
  minLength: minimum,
  maxLength: maximum,
}).map((characters) => characters.join(''));
const safeKey = fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_'.split('')), {
  minLength: 1,
  maxLength: 20,
}).map((characters) => characters.join(''));
const safeScalar = fc.oneof(safeText(), fc.integer({ min: -10_000, max: 10_000 }), fc.boolean(), fc.constant(null));

describe('deterministic bounded security property tests', () => {
  it('records a stable seed and bounded run count without counterexamples', () => {
    expect(getPropertyTestOptions()).toEqual({
      seed: 20_260_806,
      numRuns: 100,
      endOnFailure: true,
    });
  });

  it('canonical-state parser round-trips bounded synthetic response maps', async () => {
    await assertSeededProperty(fc.property(
      fc.dictionary(fc.integer({ min: 1, max: 40 }).map(String), safeText(0, 80), { maxKeys: 12 }),
      (responses) => {
        const serialized = JSON.stringify({ ...createEmptyCanonicalDraftState(), responses });
        const parsed = parseCanonicalDraftState(serialized);
        expect(parsed.ok).toBe(true);
        expect(parsed.state.responses).toEqual(responses);
      },
    ));
  });

  it('bounded JSON request parser preserves safe objects', async () => {
    await assertSeededProperty(fc.asyncProperty(
      fc.dictionary(safeKey, safeScalar, { maxKeys: 10 }),
      async (payload) => {
        const body = JSON.stringify(payload);
        const request = new Request('https://local.example.test/security', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': String(new TextEncoder().encode(body).byteLength),
          },
          body,
        });
        await expect(readBoundedJsonBody(request, { maxBytes: 4096 })).resolves.toEqual(payload);
      },
    ));
  });

  it('recovery-code normalizer remains total for bounded Unicode', async () => {
    await assertSeededProperty(fc.property(fc.string({ maxLength: 64 }), (input) => {
      const result = normalizeRecoveryCodeInput(input);
      expect(typeof result.valid).toBe('boolean');
      expect(result.normalizedLength).toBeLessThanOrEqual(64);
      if (!result.valid) expect(result.normalizedCode).toBe('');
    }));
  });

  it('email normalizer accepts only generated example.test identities', async () => {
    await assertSeededProperty(fc.property(
      fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
        minLength: 1,
        maxLength: 32,
      }).map((characters) => `${characters.join('')}@example.test`),
      (email) => {
        const result = normalizeRecoveryEmail(email);
        expect(result.valid).toBe(true);
        expect(result.normalizedEmail.endsWith('@example.test')).toBe(true);
      },
    ));
  });

  it('domain normalizer canonicalizes bounded example.test subdomains', async () => {
    await assertSeededProperty(fc.property(
      fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
        minLength: 1,
        maxLength: 20,
      }).map((characters) => `${characters.join('')}.example.test`),
      (domain) => {
        const result = normalizeBusinessDomain(`https://www.${domain}/path`);
        expect(result).toMatchObject({ valid: true, normalizedDomain: domain });
      },
    ));
  });

  it('signed-token parser rejects arbitrary bounded strings with typed errors', async () => {
    const secret = safeTokenSecret(AUTHORIZATION_SECRET_NAMES.SIGNED_INVITATION, 'i');
    await assertSeededProperty(fc.asyncProperty(fc.string({ maxLength: 256 }), async (token) => {
      await expect(verifyStructuredToken(token, {
        expectedType: SIGNED_TOKEN_TYPES.SIGNED_INVITATION,
        expectedScope: SIGNED_TOKEN_SCOPES.DRAFT_INVITATION,
        expectedEnvironment: 'staging',
        secret,
        clock: () => 2_000_000_000,
      })).rejects.toHaveProperty('code');
    }));
  });

  it('migration bundle parser round-trips bounded signed-safe envelopes', async () => {
    const sourceAppId = 'security-source-app';
    const destinationAppId = 'security-destination-app';
    const [sourceAppFingerprint, destinationAppFingerprint] = await Promise.all([
      sha256Hex(sourceAppId), sha256Hex(destinationAppId),
    ]);
    await assertSeededProperty(fc.asyncProperty(
      fc.array(safeText(1, 24), { maxLength: 4 }),
      async (values) => {
        const records = values.map((value, index) => ({
          sourceAppId,
          sourceEntity: 'ProFormDraft',
          sourceRecordId: `security-record-${index}`,
          sourceContentHash: 'c'.repeat(64),
          data: { syntheticValue: value },
        }));
        const bundle = await createMigrationBundle({
          migrationVersion: 1,
          migrationDirection: 'blue_to_green',
          operationMode: 'initial_full',
          sourceAppId,
          sourceAppFingerprint,
          destinationAppId,
          destinationAppFingerprint,
          sourceEnvironment: 'staging',
          destinationEnvironment: 'staging',
          entityName: 'ProFormDraft',
          batchId: 'security-batch',
          sequence: 0,
          snapshotCutoff: '2026-08-06T00:00:00.000Z',
          exportedAt: '2026-08-06T00:00:00.000Z',
          records,
        });
        await expect(validateMigrationBundle(bundle, { requireSignature: false }))
          .resolves.toMatchObject({ recordCount: records.length });
      },
    ), { numRuns: 30 });
  });

  it('field-path merge discovery is deterministic for bounded safe responses', async () => {
    await assertSeededProperty(fc.property(
      fc.dictionary(safeKey, safeScalar, { maxKeys: 8 }),
      fc.dictionary(safeKey, safeScalar, { maxKeys: 8 }),
      (localResponses, serverResponses) => {
        const local = { ...createEmptyCanonicalDraftState(), responses: localResponses };
        const server = { ...createEmptyCanonicalDraftState(), responses: serverResponses };
        const first = collectChangedFieldPaths(local, server);
        const second = collectChangedFieldPaths(local, server);
        expect(first).toEqual(second);
        expect(first).toEqual([...first].sort());
      },
    ));
  });

  it('idempotency-key validator accepts bounded opaque keys and rejects others', async () => {
    const validKey = fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')), {
      minLength: 16,
      maxLength: 64,
    }).map((characters) => characters.join(''));
    await assertSeededProperty(fc.property(validKey, (key) => {
      expect(validateIdempotencyKey(key)).toBe(key);
    }));
    await assertSeededProperty(fc.property(fc.string({ maxLength: 15 }), (key) => {
      expect(() => validateIdempotencyKey(key)).toThrow();
    }));
  });

  it('UI draft-state sanitizer returns detached safe values without prototype keys', async () => {
    await assertSeededProperty(fc.property(
      fc.dictionary(safeKey, fc.dictionary(safeKey, safeScalar, { maxKeys: 6 }), { maxKeys: 6 }),
      (uiDraftState) => {
        const sanitized = sanitizeDraftSerializableValue(uiDraftState, {
          maxDepth: 8,
          maxProperties: 100,
        });
        expect(sanitized).toEqual(uiDraftState);
        expect(sanitized).not.toBe(uiDraftState);
        expect(JSON.stringify(sanitized)).not.toMatch(/__proto__|constructor|prototype/u);
      },
    ));
  });
});
