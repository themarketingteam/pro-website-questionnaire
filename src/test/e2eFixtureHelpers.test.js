import {
  formatPendingDraftV2Text,
  scanPendingDraftV2Tests,
} from '../../scripts/report-pending-draft-v2-tests.mjs';
import { LIFECYCLE_EVENTS } from '../../tests/e2e/fixtures/lifecycleFixtures.js';
import { createIdentityUrl } from '../../tests/e2e/fixtures/multiTabFixtures.js';
import {
  isKnownDraftApiUrl,
  NETWORK_MODES,
} from '../../tests/e2e/fixtures/networkFixtures.js';
import {
  createQuestionnaireFixture,
  createSecondIsolatedClient,
} from '../../tests/e2e/fixtures/questionnaireFixtures.js';
import { STORAGE_MODES } from '../../tests/e2e/fixtures/storageFixtures.js';

describe('E2E fixture definitions', () => {
  it('exposes the exact required storage modes', () => {
    expect(STORAGE_MODES).toEqual([
      'normal',
      'localstorage_getter_throws',
      'localstorage_read_throws',
      'localstorage_write_throws',
      'localstorage_quota_exceeded',
      'sessionstorage_getter_throws',
      'sessionstorage_unavailable',
      'indexeddb_unavailable',
      'indexeddb_open_throws',
      'indexeddb_transaction_fails',
      'all_persistent_storage_unavailable',
    ]);
  });

  it('exposes the exact required network modes', () => {
    expect(NETWORK_MODES).toEqual([
      'online',
      'offline_before_load',
      'offline_after_load',
      'draft_save_timeout',
      'draft_save_500',
      'draft_save_connection_reset',
      'slow_network',
      'duplicate_response',
      'out_of_order_response',
    ]);
  });

  it('routes only recognized draft API paths', () => {
    expect(isKnownDraftApiUrl('https://staging.example.test/api/e2e/drafts/save')).toBe(true);
    expect(
      isKnownDraftApiUrl(
        'https://staging.example.test/api/apps/synthetic/entities/ProFormDraft/filter',
      ),
    ).toBe(true);
    expect(isKnownDraftApiUrl('https://staging.example.test/assets/app.js')).toBe(false);
    expect(isKnownDraftApiUrl('https://staging.example.test/api/email/send')).toBe(false);
  });

  it('defines the controlled lifecycle event set', () => {
    expect(LIFECYCLE_EVENTS).toEqual([
      'visibilitychange',
      'pagehide',
      'beforeunload',
    ]);
  });

  it('builds only safe synthetic questionnaire data', () => {
    const fixture = createQuestionnaireFixture('e2e-fixture-run-0001');
    expect(fixture.businessName).toMatch(/^E2E STAGING/);
    expect(fixture.domain).toMatch(/\.example\.test$/);
    expect(fixture.email).toMatch(/@example\.test$/);
    expect(fixture.environment).toBe('staging');
    expect(fixture.questions.location).toMatchObject({ latitude: 0, longitude: 0 });
    expect(JSON.stringify(fixture)).not.toMatch(/@(?:gmail|outlook|kaseya)\./i);
  });

  it('creates a distinct second client under the same cleanable run ID', () => {
    const first = createQuestionnaireFixture('e2e-fixture-run-0002');
    const second = createSecondIsolatedClient(first);
    expect(second.testRunId).toBe(first.testRunId);
    expect(second.clientIdentity).not.toBe(first.clientIdentity);
    expect(second.domain).not.toBe(first.domain);
    expect(second.email).not.toBe(first.email);
  });

  it('creates same-origin URLs with explicit synthetic tab identities', () => {
    const url = createIdentityUrl('https://staging.example.test/form', {
      clientIdentity: 'client-a-0001',
      draftIdentity: 'draft-shared-0001',
    });
    expect(new URL(url).origin).toBe('https://staging.example.test');
    expect(url).toContain('e2eClientIdentity=client-a-0001');
    expect(url).toContain('e2eDraftIdentity=draft-shared-0001');
  });
});

describe('pending draft V2 report', () => {
  it('counts every requirement-linked pending scenario', () => {
    const report = scanPendingDraftV2Tests();
    expect(report.pendingCount).toBe(8);
    expect(report.requirementIds).toEqual([
      'DR-CONCUR-001',
      'DR-OFFLINE-001',
      'DR-SAVE-001',
      'DR-SEC-001',
    ]);
    expect(report.pendingTests.every((entry) => entry.reason.startsWith('Pending'))).toBe(true);
  });

  it('produces a text summary without questionnaire payloads', () => {
    const text = formatPendingDraftV2Text(scanPendingDraftV2Tests());
    expect(text).toContain('pending_draft_v2_tests=8');
    expect(text).toContain('DR-CONCUR-001');
    expect(text).not.toContain('questionValues');
  });
});
