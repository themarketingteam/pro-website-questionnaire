import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  LEGACY_RECORD_CLASSIFICATIONS as C,
  PRO_DRAFT_LEGACY_MIGRATION_VERSION,
  analyzeLegacyDraftEvent,
  analyzeLegacyDraftRecord,
  assertSafeLegacyMigrationReport,
  buildDuplicateResolutionPlan,
  buildLegacyDraftUpgradePatch,
  buildLegacyEventUpgradePatch,
  buildLegacyMigrationAnalysisReport,
  classifyDuplicateDraftGroup,
  groupPotentialDuplicateDrafts,
  reconstructCanonicalStateFromLegacyRecord,
  selectRecommendedCanonicalRecord,
} from '../../base44/functions/_shared/proDraftLegacyMigration/legacyMigration.js';

const corpus = JSON.parse(readFileSync(
  path.resolve(process.cwd(), 'src/test/fixtures/pro-draft-legacy-migration/corpus.json'),
  'utf8',
));
const byId = (id) => structuredClone(corpus.drafts.find((draft) => draft.id === id));

describe('legacy draft migration analysis', () => {
  it('exports migration version 1', () => {
    expect(PRO_DRAFT_LEGACY_MIGRATION_VERSION).toBe(1);
  });

  it.each([
    ['already-current', C.ALREADY_CURRENT],
    ['legacy-complete-active', C.LEGACY_COMPLETE],
    ['legacy-partial-active', C.LEGACY_PARTIAL],
    ['legacy-malformed-metadata', C.LEGACY_MALFORMED_NONCRITICAL],
    ['legacy-malformed-responses', C.LEGACY_MALFORMED_CRITICAL],
    ['legacy-submitted', C.SUBMITTED_LEGACY],
    ['legacy-submit-failed', C.SUBMIT_FAILED_LEGACY],
    ['unsupported-future', C.UNSUPPORTED_FUTURE_VERSION],
  ])('classifies %s as %s', async (id, expected) => {
    expect((await analyzeLegacyDraftRecord(byId(id))).classification).toBe(expected);
  });

  it('classifies superseded, duplicate-candidate, and manual-review records', async () => {
    const base = { id: 'synthetic', session_id: 's', status: 'superseded', responses_json: '{}' };
    expect((await analyzeLegacyDraftRecord(base)).classification).toBe(C.SUPERSEDED_LEGACY);
    expect((await analyzeLegacyDraftRecord({ ...base, status: 'active' }, { duplicateCandidate: true })).classification)
      .toBe(C.DUPLICATE_CANDIDATE);
    expect((await analyzeLegacyDraftRecord({ ...base, status: 'unknown' })).classification)
      .toBe(C.MANUAL_REVIEW_REQUIRED);
  });

  it('parses JSON fields independently and preserves responses when metadata is malformed', async () => {
    const result = await reconstructCanonicalStateFromLegacyRecord(byId('legacy-malformed-metadata'));
    expect(result.state.responses).toEqual({ q_preserved: 'SYNTHETIC_PRESERVED_RESPONSE' });
    expect(result.state.metadata).toBeUndefined();
    expect(result.warnings).toContain('MALFORMED_METADATA');
    expect(result.errors).toEqual([]);
  });

  it('treats malformed responses as critical without inventing answers', async () => {
    const result = await analyzeLegacyDraftRecord(byId('legacy-malformed-responses'));
    expect(result.classification).toBe(C.LEGACY_MALFORMED_CRITICAL);
    expect(result.canonicalState.responses).toEqual({});
    expect(result.proposedFields).toEqual([]);
    expect(result.manualReview).toBe(true);
  });

  it('migrates only a valid legacy email and keeps it unverified', async () => {
    const valid = await buildLegacyDraftUpgradePatch(byId('legacy-valid-email'), {
      batchId: 'test-batch', environment: 'fixture', analyzedAt: corpus.analyzedAt,
    });
    expect(valid.patch).toMatchObject({
      recovery_email: 'synthetic.legacy@example.invalid',
      recovery_email_source: 'migrated_legacy',
      recovery_email_verification_status: 'unverified',
    });
    expect(valid.patch).not.toHaveProperty('recovery_email_lookup_hash');
    expect(valid.warnings).toContain('RECOVERY_EMAIL_LOOKUP_HASH_EXECUTION_REQUIRED');

    const invalid = await buildLegacyDraftUpgradePatch(byId('legacy-invalid-email'));
    expect(invalid.patch).not.toHaveProperty('recovery_email');
    expect(invalid.warnings).toContain('LEGACY_EMAIL_INVALID');
  });

  it('never invents recovery credentials and normalizes only recognized draft status', async () => {
    const result = await buildLegacyDraftUpgradePatch(byId('legacy-complete-active'));
    expect(result.patch.status).toBe('active');
    expect(result.patch).not.toHaveProperty('recovery_code_hash');
    expect(result.patch).not.toHaveProperty('resume_token_hash');
    expect(result.warnings).toContain('LEGACY_RECOVERY_CODE_UNAVAILABLE');
  });

  it('preserves submitted lock fields and original creation ordering', async () => {
    const input = byId('legacy-submitted');
    const result = await buildLegacyDraftUpgradePatch(input);
    expect(result.patch).not.toHaveProperty('status');
    expect(result.patch).not.toHaveProperty('final_submission_id');
    expect(result.patch).not.toHaveProperty('created_date');
    expect(result.canonicalState.submission).toMatchObject({
      finalSubmissionId: input.final_submission_id,
      submittedAt: input.submitted_at,
    });
  });

  it('does not overwrite nonempty current fields', async () => {
    const input = {
      ...byId('legacy-complete-active'),
      form_type: 'preserved-form', credentials_json: '{"preserved":true}',
      client_revision: 7, server_revision: 8,
    };
    const result = await buildLegacyDraftUpgradePatch(input);
    expect(result.patch).not.toHaveProperty('form_type');
    expect(result.patch).not.toHaveProperty('credentials_json');
    expect(result.patch).not.toHaveProperty('client_revision');
    expect(result.patch).not.toHaveProperty('server_revision');
  });

  it('fails closed on unmapped legacy payload answers and strips credential secrets', async () => {
    const input = {
      id: 'legacy-payload-only', session_id: 'payload-only', status: 'active',
      responses_json: '{}', userdata_json: '{"legacy_answer":"PRESERVE_IN_SOURCE_COLUMN"}',
      credentials_json: '{"businessName":"Synthetic","recoveryCode":"DO_NOT_COPY","resumeToken":"DO_NOT_COPY"}',
    };
    const result = await analyzeLegacyDraftRecord(input);
    expect(result.classification).toBe(C.MANUAL_REVIEW_REQUIRED);
    expect(result.proposedFields).toEqual([]);
    expect(result.canonicalState.credentials).toEqual({ businessName: 'Synthetic' });
    expect(result.warnings).toContain('LEGACY_RESPONSE_MAPPING_REQUIRED');
  });

  it('produces deterministic before/after/state fingerprints and leaves input immutable', async () => {
    const input = byId('legacy-complete-active');
    const before = structuredClone(input);
    const first = await buildLegacyDraftUpgradePatch(input, { analyzedAt: corpus.analyzedAt });
    const second = await buildLegacyDraftUpgradePatch(input, { analyzedAt: corpus.analyzedAt });
    expect(first.stateHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.beforeFingerprint).toBe(second.beforeFingerprint);
    expect(first.afterFingerprint).toBe(second.afterFingerprint);
    expect(input).toEqual(before);
  });
});

describe('legacy duplicate planning', () => {
  it('groups only approved identity/hash keys, not email or business identity', () => {
    const sameEmailOnly = [
      { id: 'a', session_id: 'a', user_email: 'same@example.invalid' },
      { id: 'b', session_id: 'b', user_email: 'same@example.invalid' },
    ];
    expect(groupPotentialDuplicateDrafts(sameEmailOnly)).toEqual([]);
    expect(groupPotentialDuplicateDrafts(corpus.drafts).length).toBeGreaterThanOrEqual(3);
  });

  it('selects the highest authoritative active revision deterministically', () => {
    const pair = [byId('duplicate-active-low'), byId('duplicate-active-high')];
    expect(selectRecommendedCanonicalRecord(pair).id).toBe('duplicate-active-high');
    const plan = buildDuplicateResolutionPlan(pair);
    expect(plan.canonicalRecordId).toBe('duplicate-active-high');
    expect(plan.actions).toEqual([expect.objectContaining({
      recordId: 'duplicate-active-low', delete: false,
    })]);
    expect(plan.preservesAllRecords).toBe(true);
    expect(plan.automaticMergeAllowed).toBe(false);
  });

  it('never recommends merging submitted and active partitions', () => {
    const pair = [byId('same-session-active'), byId('same-session-submitted')];
    const result = classifyDuplicateDraftGroup(pair);
    expect(result.manualReview).toBe(true);
    expect(result.warningCodes).toContain('DUPLICATE_STATUS_PARTITION_CONFLICT');
    expect(buildDuplicateResolutionPlan(pair).actions).toEqual([]);
  });

  it('requires manual review for conflicting equal-rank state hashes', () => {
    const pair = [byId('ambiguous-a'), byId('ambiguous-b')];
    const result = buildDuplicateResolutionPlan(pair);
    expect(result.classification).toBe(C.MANUAL_REVIEW_REQUIRED);
    expect(result.warningCodes).toContain('DUPLICATE_STATE_HASH_CONFLICT');
    expect(result.canonicalRecordId).toBeNull();
  });
});

describe('legacy event and report analysis', () => {
  const sessionDraftMap = {
    'session-valid-email': ['legacy-valid-email'],
    'session-duplicate-active': ['duplicate-active-low', 'duplicate-active-high'],
  };

  it('links an exact unambiguous relation and creates a deterministic event ID', async () => {
    const event = structuredClone(corpus.events[1]);
    const first = await buildLegacyEventUpgradePatch(event, { sessionDraftMap, analyzedAt: corpus.analyzedAt });
    const second = await buildLegacyEventUpgradePatch(event, { sessionDraftMap, analyzedAt: corpus.analyzedAt });
    expect(first.patch.draft_id).toBe('legacy-valid-email');
    expect(first.patch.event_id).toBe(second.patch.event_id);
    expect(first.patch.event_id).toMatch(/^mig_[0-9a-f]{48}$/u);
    expect(first.patch.created_at_iso).toBe(event.created_date);
    expect(first.patch.value_hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.patch).not.toHaveProperty('value_json');
  });

  it('requires manual review for ambiguous event relationships', async () => {
    const result = await analyzeLegacyDraftEvent(corpus.events[2], { sessionDraftMap });
    expect(result.manualReview).toBe(true);
    expect(result.warnings).toContain('EVENT_DRAFT_RELATION_AMBIGUOUS');
    expect(result.warnings).toContain('EVENT_VALUE_JSON_MALFORMED');
  });

  it('builds a safe machine report without answers or email', async () => {
    const report = await buildLegacyMigrationAnalysisReport({
      ...corpus,
      sessionDraftMap,
    });
    expect(report).toMatchObject({
      migrationVersion: 1,
      batchId: corpus.batchId,
      environment: corpus.environment,
    });
    expect(report.drafts[0]).toEqual(expect.objectContaining({
      recordId: expect.any(String), proposedFields: expect.any(Array),
      warningCodes: expect.any(Array), beforeFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    }));
    expect(assertSafeLegacyMigrationReport(report, corpus.drafts)).toBe(true);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('SYNTHETIC_COMPLETE_RESPONSE');
    expect(serialized).not.toContain('synthetic.legacy@example.invalid');
    expect(serialized).not.toContain('responses_json');
    expect(serialized).not.toContain('canonicalState');
  });
});
