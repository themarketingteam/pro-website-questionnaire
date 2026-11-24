import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';
import { repairProSubmissionPayload } from '@/lib/proPayloadRepair';
import { SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';
import { normalizeStoredOrganizedRecord } from '../../base44/shared/pageOrganizerContract.js';
import { loadBackend } from './utils/loadBackend';
import { memoryEntity } from './utils/memoryEntities';
import { hydrateProSubmissionEntity } from './utils/base44SubmissionHydration';

const businessName = 'Browser Receipt Regression Client';
const domain = 'browser-receipt-regression-unit.net';
const session = 'browser_receipt_session_12345';
const secret = 'browser_receipt_secret_abcdefghijklmnopqrstuvwxyz';
const attempt = 'browser_repaired_submission_attempt_12345';
const aliases = ['team_photo_with_tags', 'industries', 'locations', 'service_areas'];

const page = (id, label, children = []) => ({ id, label, source: 'custom', catalogId: null, children });
function answers(withAttachments) {
  const raw = {
    '1': 'no', '2': withAttachments ? 'yes' : 'no',
    '3': [], '3_other': ['Managed support', 'Help desk', 'Security'],
    '3_structure': { format: 'page-tree-v1', pages: [page('services', 'Managed support', [page('help', 'Help desk'), page('security', 'Security')])] },
    '4': [], '4_other': ['Finance', 'Accounting'],
    '4_structure': { format: 'page-tree-v1', pages: [page('finance', 'Finance', [page('accounting', 'Accounting')])] },
    '5': [{ label: 'Chicago, IL', latitude: 41.8, longitude: -87.6, place_id: 'invented-place', source: 'manual' }],
    '6': 'Retained browser company description', '7': 'Retained browser delivery model',
    '12': withAttachments ? 'yes' : 'no', '14': withAttachments ? 'yes' : 'no', '23': 'no', '25': 'no',
  };
  if (withAttachments) {
    raw['2.1'] = 'An invented regression team';
    raw['2.2'] = {
      imageUrl: 'https://assets.invalid/team.jpg', imageName: 'team.jpg',
      files: [{ url: 'https://assets.invalid/team.jpg', name: 'team.jpg', fileName: 'original-team.jpg', filename: 'upload-team.jpg', type: 'image/jpeg', mimeType: 'image/jpeg', size: 12345, uploadedAt: '2026-11-24T12:00:00Z' }],
      taggedPeople: [{ x: 15, y: 35, person: { name: 'Invented Person', position: 'Engineer', bio: 'Invented biography' } }],
      tags: ['Leadership'], notes: 'Retained team notes', has_team_photo: true,
    };
    raw['12.1'] = [{
      name: 'Invented certification', type: 'certification',
      image: { url: 'https://assets.invalid/badge.png', name: 'badge.png' },
      file: { url: 'https://assets.invalid/certificate.pdf', name: 'certificate.pdf' },
      files: [{ url: 'https://assets.invalid/extra.pdf', name: 'extra.pdf', type: 'application/pdf', size: 4321 }],
    }];
    raw['14.1'] = [{ name: 'Invented SLA', type: 'sla', file: { url: 'https://assets.invalid/sla.pdf', name: 'sla.pdf' }, description: 'Retained guarantee details' }];
  }
  return raw;
}

async function fixture({ withAttachments = false, populatedAliases = false, legacyAdditionalPages } = {}) {
  const raw = answers(withAttachments);
  const transformed = transformResponsesToPayload(raw, businessName, domain, SERVICE_OPTIONS_GROUPED);
  if (populatedAliases) {
    transformed.userdata.industries = ['Healthcare / Medical', 'Custom vertical'];
    transformed.userdata.locations = ['Austin, TX', 'Madison, WI'];
    transformed.userdata.service_areas = [{
      label: 'Austin, TX', name: 'Austin, TX', city: 'Austin', state: 'TX',
      region: 'Central Texas', county: 'Travis', zip: '78701', radius: 25,
      latitude: 30.2, longitude: -97.7, place_id: 'invented-alias-place',
      source: 'manual', type: 'city', primary: true,
    }];
  }
  if (legacyAdditionalPages !== undefined) transformed.userdata.additional_pages_list = legacyAdditionalPages;
  const repaired = repairProSubmissionPayload(transformed);
  expect(repaired.ok).toBe(true);
  const mapped = repaired.payload;
  const accessHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))).toString('base64url');
  const entities = Object.fromEntries([
    'ProFormDraft', 'ProFormDraftRevision', 'ProFormSubmission',
    'ProFormSubmissionIntake', 'ProFormDraftEvent', 'ProSubmissionRetryJob',
  ].map(name => [name, memoryEntity(name)]));
  const draft = {
    id: 'browser-receipt-draft', session_id: session, access_token_hash: accessHash,
    business_name: businessName, domain, status: 'draft', save_revision: 0,
    responses_json: JSON.stringify(raw), mapped_payload_json: JSON.stringify(mapped),
  };
  entities.ProFormDraft.rows.push(draft);
  const create = entities.ProFormSubmission.create.getMockImplementation();
  entities.ProFormSubmission.create.mockImplementation(async value => create(hydrateProSubmissionEntity(value)));
  const fetchImpl = vi.fn(async () => { throw new Error('Receipt creation must not deliver a webhook'); });
  const sdk = { asServiceRole: { entities } };
  const backend = loadBackend('base44/functions/submitProQuestionnaireDurable/entry.ts', { base44: sdk, fetchImpl });
  const submit = () => backend.send({ draftId: draft.id, resumeCredential: `${session}.${secret}`, submissionAttemptId: attempt, transformedPayload: mapped, rawResponses: raw });
  return { draft, raw, mapped, entities, fetchImpl, submit };
}

describe('actual browser repaired Pro payload survives the durable receipt schema', () => {
  it.each([false, true])('stores every repaired browser field and attachment without a fallback (attachments=%s)', async withAttachments => {
    const f = await fixture({ withAttachments });
    const rawBefore = f.draft.responses_json;
    const result = await f.submit();
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(1);
    expect(f.draft.status).toBe('submitted');
    expect(f.draft.final_submission_id).toBe(result.body.submission.id);
    expect(f.draft.responses_json).toBe(rawBefore);
    const receipt = normalizeStoredOrganizedRecord(result.body.submission, f.mapped);
    expect(receipt.userdata).toEqual(f.mapped.userdata);
    for (const field of aliases) expect(receipt.userdata[field]).toEqual(f.mapped.userdata[field]);
    expect(receipt.userdata.team_photo_with_tags).toEqual(receipt.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags);
    expect(f.entities.ProFormSubmissionIntake.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    if (withAttachments) {
      expect(receipt.userdata.team_photo_with_tags.imageName).toBe('team.jpg');
      expect(receipt.userdata.team_photo_with_tags.files[0].size).toBe(12345);
      expect(receipt.userdata.team_photo_with_tags.taggedPeople[0].person.bio).toBe('Invented biography');
      expect(receipt.userdata.certifications_partnerships[0].cert_item_files[0].name).toBe('extra.pdf');
      expect(receipt.userdata.service_guarantee_items[0].guarantee_file_name).toBe('sla.pdf');
    }
    const duplicate = await f.submit();
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({ success: true, duplicate: true });
    expect(duplicate.body.submission.id).toBe(result.body.submission.id);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(1);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('retains nonempty supported legacy alias values after browser repair and strict schema projection', async () => {
    const f = await fixture({ withAttachments: true, populatedAliases: true });
    const result = await f.submit();
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    const receipt = normalizeStoredOrganizedRecord(result.body.submission, f.mapped);
    expect(receipt.userdata).toEqual(f.mapped.userdata);
    expect(receipt.userdata.industries).toEqual(['Healthcare / Medical', 'Custom vertical']);
    expect(receipt.userdata.locations).toEqual(['Austin, TX', 'Madison, WI']);
    expect(receipt.userdata.service_areas).toHaveLength(1);
    expect(receipt.userdata.service_areas[0]).toEqual(f.mapped.userdata.service_areas[0]);
    expect(f.draft.final_submission_id).toBe(result.body.submission.id);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(1);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['an array', ['Why Choose Us', 'Meet the Team']],
    ['a string', 'Legacy additional page'],
  ])('retains the official repair of legacy additional pages supplied as %s', async (_label, legacyAdditionalPages) => {
    const f = await fixture({ legacyAdditionalPages });
    expect(f.mapped.userdata.additional_pages_list.items).toEqual(Array.isArray(legacyAdditionalPages) ? legacyAdditionalPages : [legacyAdditionalPages]);
    const result = await f.submit();
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    const receipt = normalizeStoredOrganizedRecord(result.body.submission, f.mapped);
    expect(receipt.userdata).toEqual(f.mapped.userdata);
    expect(receipt.userdata.additional_pages_list.items).toEqual(f.mapped.userdata.additional_pages_list.items);
    expect(f.draft.final_submission_id).toBe(result.body.submission.id);
    expect(f.entities.ProFormSubmission.rows).toHaveLength(1);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps organizer validation enforced after adding compatibility fields to the receipt schema', async () => {
    const f = await fixture({ withAttachments: true, populatedAliases: true });
    f.mapped.metadata.questionnaire_payload_version = 99;
    const result = await f.submit();
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    expect(f.draft.status).toBe('draft');
    expect(f.draft.final_submission_id).toBeUndefined();
    expect(f.entities.ProFormSubmission.rows).toHaveLength(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});
