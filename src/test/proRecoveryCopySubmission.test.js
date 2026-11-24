import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import { SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';
import { createPageStructure } from '@/lib/pageOrganizerModel';
import { loadBackend } from './utils/loadBackend';
import { memoryEntity, copyRecord } from './utils/memoryEntities';
import { hydrateProSubmissionEntity } from './utils/base44SubmissionHydration';

const businessName = 'Recovery Regression Client';
const domain = 'recovery-regression-unit.net';
const now = '2026-11-24T15:07:00.000Z';
const organizerFields = [
  'service_offerings', 'service_offerings_other', 'service_offerings_structure',
  'target_industries', 'target_industries_other', 'target_industries_structure',
];

function responses() {
  return {
    '1': 'yes', '1.1': 'Retained reasons to choose this company',
    '2': 'yes', '2.1': 'Retained team introduction',
    '2.2': {
      files: [{ url: 'https://assets.invalid/team.jpg', name: 'team.jpg', size: 12345, type: 'image/jpeg' }],
      taggedPeople: [{ x: 15, y: 35, person: { name: 'Invented Person', position: 'Engineer', bio: 'Retained biography' } }],
      tags: ['Leadership'], notes: 'Retained photo notes', has_team_photo: true,
    },
    '3': ['Managed IT', 'IT Help Desk', 'Cloud Services'], '3_other': ['Custom service'],
    '3_structure': createPageStructure('3', ['Managed IT', 'IT Help Desk', 'Cloud Services'], ['Custom service'], SERVICE_OPTIONS_GROUPED),
    '4': ['Healthcare'], '4_other': ['Custom industry'],
    '4_structure': createPageStructure('4', ['Healthcare'], ['Custom industry'], {}, ['Healthcare']),
    '5': [{ label: 'Chicago, IL' }],
    '6': 'Retained company description outside the organizer',
    '7': 'Retained delivery model',
    '12': 'yes',
    '12.1': [{
      name: 'Invented certification', type: 'certification',
      image: { url: 'https://assets.invalid/badge.png', name: 'badge.png' },
      file: { url: 'https://assets.invalid/certificate.pdf', name: 'certificate.pdf' },
      files: [{ url: 'https://assets.invalid/extra.pdf', name: 'extra.pdf', type: 'application/pdf', size: 4321 }],
    }],
    '14': 'yes', '14.1': [{ name: 'Retained guarantee', type: 'sla', fileUrl: 'https://assets.invalid/sla.pdf', fileName: 'sla.pdf', description: 'Retained guarantee details' }],
    '21': 'Retained value description', '23': 'no', '25': 'yes', '25.1': 'Retained final notes',
  };
}

function fixture() {
  const raw = responses();
  const mapped = transformResponsesToPayload(raw, businessName, domain, SERVICE_OPTIONS_GROUPED);
  const draft = {
    id: 'recovery-source', session_id: 'recovery-session', status: 'draft',
    save_revision: 0, business_name: businessName, domain,
    responses_json: JSON.stringify(raw), mapped_payload_json: JSON.stringify(mapped),
    draft_metadata_json: JSON.stringify({ source: 'recovery_version_copy', source_draft_id: 'original-draft', source_version_id: 'revision:retained-revision' }),
    validation_status_json: '{}', touched_questions_json: '{}', expanded_questions_json: '{}',
  };
  const revision = {
    id: 'retained-revision', draft_id: draft.id, session_id: draft.session_id,
    server_revision: 0, source: 'autosave', status: 'draft',
    result_snapshot_json: JSON.stringify({
      responses: raw, credentials: { businessName, domain }, progressPercent: 100,
      validationStatus: { '6': 'complete' }, touchedQuestions: { '6': true },
    }),
  };
  const entities = Object.fromEntries([
    'ProFormDraft', 'ProFormDraftRevision', 'ProFormSubmission',
    'ProFormSubmissionIntake', 'ProFormDraftEvent', 'ProSubmissionRetryJob',
  ].map(name => [name, memoryEntity(name)]));
  entities.ProFormDraft.rows.push(draft);
  entities.ProFormDraftRevision.rows.push(revision);
  const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
  const sdk = { auth: { me: vi.fn(async () => ({ role: 'admin', email: 'admin@unit.net' })) }, asServiceRole: { entities } };
  const recovery = loadBackend('base44/functions/queryProQuestionnaireRecoveryRecords/entry.ts', { base44: sdk, fetchImpl });
  const retry = loadBackend('base44/functions/retryProQuestionnaireIntakeSubmission/entry.ts', { base44: sdk, fetchImpl });
  const copy = () => recovery.send({ recordType: 'draft', action: 'create_version_copy', recordId: draft.id, versionId: `revision:${revision.id}` });
  const organizeOnly = () => {
    draft.mapped_payload_json = JSON.stringify({ metadata: { questionnaire_payload_version: 2 }, userdata: Object.fromEntries(organizerFields.map(key => [key, copyRecord(mapped.userdata[key])])) });
    return JSON.parse(draft.mapped_payload_json);
  };
  return { raw, mapped, draft, revision, entities, fetchImpl, copy, retry, organizeOnly };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now)); });
afterEach(() => vi.useRealTimers());

describe('Pro recovery copies preserve the full submission', () => {
  it('rebuilds a raw-only retained revision with every answer and attachment before saving the copy', async () => {
    const f = fixture();
    const beforeDraft = copyRecord(f.draft), beforeRevision = copyRecord(f.revision);
    const result = await f.copy();
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    const saved = f.entities.ProFormDraft.rows.find(item => item.id === result.body.recordId);
    const payload = JSON.parse(saved.mapped_payload_json);
    expect(JSON.parse(saved.responses_json)).toEqual(f.raw);
    expect(JSON.parse(saved.history_baseline_json).responses).toEqual(f.raw);
    expect(payload.metadata).toMatchObject({ business_name: businessName, businessDomain: domain, service_type: 'pro', questionnaire_payload_version: 2 });
    expect(payload.userdata).toEqual(f.mapped.userdata);
    expect(payload.userdata.company_description).toBe(f.raw['6']);
    expect(payload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.files[0].size).toBe(12345);
    expect(payload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.taggedPeople[0].person.bio).toBe('Retained biography');
    expect(payload.userdata.certifications_partnerships[0].cert_item_files[0].name).toBe('extra.pdf');
    expect(payload.userdata.service_guarantee_items[0].guarantee_file_name).toBe('sla.pdf');
    expect(JSON.parse(saved.metadata_json)).toEqual(payload.metadata);
    expect(JSON.parse(saved.userdata_json)).toEqual(payload.userdata);
    expect(f.draft).toEqual(beforeDraft);
    expect(f.revision).toEqual(beforeRevision);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('does not create an apparently complete copy from an empty retained revision', async () => {
    const f = fixture();
    f.revision.result_snapshot_json = JSON.stringify({ responses: {}, credentials: { businessName, domain } });
    const result = await f.copy();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.success).toBe(false);
    expect(f.entities.ProFormDraft.rows).toHaveLength(1);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['an unrecognized answer map', { unknown_retained_answer: 'notquestion' }],
    ['a blank recognized answer', { '6': '' }],
  ])('does not invent a complete payload from %s', async (_label, raw) => {
    const f = fixture();
    f.revision.result_snapshot_json = JSON.stringify({ responses: raw, credentials: { businessName, domain } });
    const result = await f.copy();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.success).toBe(false);
    expect(f.entities.ProFormDraft.rows).toHaveLength(1);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('does not create a revision copy with a complete mapped payload but no retained raw answers', async () => {
    const f = fixture();
    f.revision.result_snapshot_json = JSON.stringify({
      responses: {}, credentials: { businessName, domain }, mappedPayload: f.mapped,
    });
    const result = await f.copy();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.success).toBe(false);
    expect(f.entities.ProFormDraft.rows).toHaveLength(1);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['a scalar', 'unreadable retained payload'],
    ['an array', []],
  ])('rejects %s mapped snapshot instead of treating it as an absent map', async (_label, mappedPayload) => {
    const f = fixture();
    const snapshot = JSON.parse(f.revision.result_snapshot_json);
    f.revision.result_snapshot_json = JSON.stringify({ ...snapshot, mappedPayload });
    const result = await f.copy();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.success).toBe(false);
    expect(f.entities.ProFormDraft.rows).toHaveLength(1);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['an encoded scalar', JSON.stringify('unreadable retained payload')],
    ['an encoded array', '[]'],
  ])('rejects a saved recovery map containing %s before rebuilding or delivering', async (_label, invalidMap) => {
    const f = fixture();
    f.draft.mapped_payload_json = invalidMap;
    const rawBefore = f.draft.responses_json;
    const result = await f.retry.send({ draftId: f.draft.id, forceRetry: true, forceRequestId: 'malformed-map-regression' });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.success).toBe(false);
    expect(f.draft.mapped_payload_json).toBe(invalidMap);
    expect(f.draft.responses_json).toBe(rawBefore);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves a complete retained mapped payload, including legitimate repaired or additional values', async () => {
    const f = fixture();
    const retained = copyRecord(f.mapped);
    retained.userdata.company_description = 'Explicitly retained repaired description';
    retained.userdata.retained_extension = { label: 'Additional retained content' };
    const snapshot = JSON.parse(f.revision.result_snapshot_json);
    f.revision.result_snapshot_json = JSON.stringify({ ...snapshot, mappedPayload: retained });
    const result = await f.copy();
    expect(result.status).toBe(200);
    const saved = f.entities.ProFormDraft.rows.find(item => item.id === result.body.recordId);
    expect(JSON.parse(saved.mapped_payload_json).userdata).toEqual(retained.userdata);
    expect(JSON.parse(saved.responses_json)).toEqual(f.raw);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('recovers the known organizer-only copy before freezing and delivering its complete payload exactly once', async () => {
    const f = fixture(); f.organizeOnly();
    const rawBefore = f.draft.responses_json;
    const createReceipt = f.entities.ProFormSubmission.create.getMockImplementation();
    f.entities.ProFormSubmission.create.mockImplementation(async value => createReceipt(hydrateProSubmissionEntity(value)));
    const command = { draftId: f.draft.id, forceRetry: true, forceRequestId: 'recovery-map-regression' };
    const first = await f.retry.send(command);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ success: true, zapierSent: true });
    expect(f.draft.responses_json).toBe(rawBefore);
    expect(JSON.parse(f.draft.mapped_payload_json).userdata).toEqual(f.mapped.userdata);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(1);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(1);
    const job = f.entities.ProSubmissionRetryJob.rows[0];
    expect(JSON.parse(job.raw_responses_json)).toEqual(f.raw);
    expect(JSON.parse(job.outbound_payload_json).userdata).toEqual(f.mapped.userdata);
    expect(job.status).toBe('succeeded');
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    const wire = JSON.parse(f.fetchImpl.mock.calls[0][1].body);
    expect(wire.metadata).toMatchObject({ business_name: businessName, businessDomain: domain });
    expect(wire.userdata).toEqual(f.mapped.userdata);
    const second = await f.retry.send(command);
    expect(second.status).toBe(200);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(1);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });

  it('continues normal team retry for a complete legacy map without remapping its retained repaired values', async () => {
    const f = fixture();
    delete f.raw['3_structure']; delete f.raw['4_structure'];
    const legacy = transformResponsesToPayload(f.raw, businessName, domain, SERVICE_OPTIONS_GROUPED);
    legacy.userdata.company_description = 'A retained repaired description from the legacy workflow';
    f.draft.responses_json = JSON.stringify(f.raw);
    f.draft.mapped_payload_json = JSON.stringify(legacy);
    f.draft.draft_metadata_json = '{}';
    const rawBefore = f.draft.responses_json, mapBefore = f.draft.mapped_payload_json;
    const createReceipt = f.entities.ProFormSubmission.create.getMockImplementation();
    f.entities.ProFormSubmission.create.mockImplementation(async value => createReceipt(hydrateProSubmissionEntity(value)));
    const result = await f.retry.send({ draftId: f.draft.id });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, zapierSent: true });
    expect(f.draft.responses_json).toBe(rawBefore);
    expect(f.draft.mapped_payload_json).toBe(mapBefore);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(1);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(1);
    expect(f.entities.ProSubmissionRetryJob.rows[0].manual_force).toBe(false);
    expect(f.fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(f.fetchImpl.mock.calls[0][1].body).userdata).toEqual(legacy.userdata);
  });

  it.each([
    ['an unknown additional field', payload => { payload.userdata.unknown_retained_answer = 'Must not be dropped'; }],
    ['a different mapped client identity', payload => { payload.metadata.business_name = 'Different Client'; payload.metadata.businessDomain = 'different-client-unit.net'; }],
    ['an organizer selection conflicting with its raw answer', payload => { payload.userdata.service_offerings = ['Changed mapped selection']; }],
  ])('rejects an incomplete copy with %s without changing its answers or creating a delivery', async (_label, change) => {
    const f = fixture(); const partial = f.organizeOnly(); change(partial);
    f.draft.mapped_payload_json = JSON.stringify(partial);
    const mappedBefore = f.draft.mapped_payload_json, rawBefore = f.draft.responses_json;
    const result = await f.retry.send({ draftId: f.draft.id, forceRetry: true, forceRequestId: 'reject-map-regression' });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.success).toBe(false);
    expect(f.draft.responses_json).toBe(rawBefore);
    expect(f.draft.mapped_payload_json).toBe(mappedBefore);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('does not rebuild an arbitrary older draft merely because its map resembles the recovery defect', async () => {
    const f = fixture(); f.organizeOnly();
    f.draft.draft_metadata_json = '{}';
    const before = f.draft.mapped_payload_json;
    const result = await f.retry.send({ draftId: f.draft.id, forceRetry: true, forceRequestId: 'unproven-copy-regression' });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.success).toBe(false);
    expect(f.draft.mapped_payload_json).toBe(before);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('requires review of a newer retained revision before rebuilding a materialized recovery map', async () => {
    const f = fixture(); f.organizeOnly();
    const mappedBefore = f.draft.mapped_payload_json, rawBefore = f.draft.responses_json;
    f.entities.ProFormDraftRevision.rows.push({
      id: 'newer-retained-revision', draft_id: f.draft.id, server_revision: 1,
      result_snapshot_json: JSON.stringify({ responses: { ...f.raw, '6': 'Newer unmaterialized answer' }, credentials: { businessName, domain } }),
    });
    const result = await f.retry.send({ draftId: f.draft.id, forceRetry: true, forceRequestId: 'pending-revision-regression' });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('DRAFT_SAVE_PENDING');
    expect(f.draft.responses_json).toBe(rawBefore);
    expect(f.draft.mapped_payload_json).toBe(mappedBefore);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(0);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('does not create or deliver an attempt when persistence of the rebuilt recovery map is unconfirmed', async () => {
    const f = fixture(); f.organizeOnly();
    const rawBefore = f.draft.responses_json;
    const update = f.entities.ProFormDraft.updateMany.getMockImplementation();
    f.entities.ProFormDraft.updateMany.mockImplementation(async (query, value) => {
      if (value.$set?.mapped_payload_json) return { updated: 0 };
      return update(query, value);
    });
    const result = await f.retry.send({ draftId: f.draft.id, forceRetry: true, forceRequestId: 'map-write-regression' });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.success).toBe(false);
    expect(f.draft.responses_json).toBe(rawBefore);
    expect(f.entities.ProSubmissionRetryJob.rows).toHaveLength(0);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});
