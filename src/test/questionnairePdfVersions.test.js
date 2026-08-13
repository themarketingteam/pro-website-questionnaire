import { describe, expect, it } from 'vitest';
import {
  buildQuestionnairePdfSnapshot,
  getDraftPdfPayload,
  getIntakePdfPayload,
  hashQuestionnairePdfSnapshot,
  questionnaireResponsesFromSubmissionPayload,
  stableQuestionnairePdfSnapshot
} from '@/lib/questionnairePdfVersions';
import { QUESTIONNAIRE_PDF_TEMPLATE_REVISION } from '@/components/pro-form/pdf/questionnairePdfTheme';

const payload = {
  metadata: {
    business_name: 'Acme IT',
    businessDomain: 'acme.example',
    submission_datetime: '2026-08-10T12:00:00.000Z'
  },
  userdata: {
    additional_pages_list: {
      why_choose_us_page: {
        generate_page: true,
        why_choose_us_description: 'Fast local support.'
      },
      meet_the_team_page: {
        generate_page: false,
        team_introduction: '',
        team_photo_with_tags: {}
      }
    },
    service_offerings: ['Managed IT'],
    service_offerings_other: 'Apple support',
    target_industries: ['Healthcare / Medical'],
    geographic_areas: [{
      geographic_area_meta: { label: 'Chicago, IL', primary: true }
    }],
    company_description: 'A managed service provider.',
    certifications_partnerships: [{ cert_item_name: 'SOC 2', cert_item_type: 'certification' }],
    service_guarantee: true,
    service_guarantee_items: [{
      guarantee_name: 'Response SLA',
      guarantee_type: 'sla',
      guarantee_description: '15 minute response.'
    }],
    avoided_clients: 'Organizations that will not prioritize security.',
    primary_cta: 'Schedule a Consultation',
    additional_notes: 'Use the new logo.'
  }
};

const legacyStableValue = (value) => {
  if (Array.isArray(value)) return value.map(legacyStableValue);
  if (value === null || typeof value !== 'object') return value;

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = legacyStableValue(value[key]);
      return result;
    }, {});
};

describe('questionnaire PDF version payloads', () => {
  it('reconstructs the client PDF response shape from a final submission payload', () => {
    const responses = questionnaireResponsesFromSubmissionPayload(payload);

    expect(responses).toMatchObject({
      '1': 'yes',
      '1.1': 'Fast local support.',
      '2': 'no',
      '3': ['Managed IT Services', 'Managed IT'],
      '3_other': 'Apple support',
      '5_primary': 0,
      '6': 'A managed service provider.',
      '12': 'yes',
      '14': 'yes',
      '23': 'yes',
      '23.1': 'Organizations that will not prioritize security.',
      '24': 'Schedule a Consultation',
      '25': 'yes',
      '25.1': 'Use the new logo.'
    });
    expect(responses['5'][0].geographic_area_meta.label).toBe('Chicago, IL');
  });

  it('migrates legacy service categories when rebuilding a PDF snapshot', () => {
    const responses = questionnaireResponsesFromSubmissionPayload({
      userdata: {
        service_offerings: ['CATEGORY:Managed IT Services']
      }
    });

    expect(responses['3']).toEqual([
      'Managed IT Services',
      'Managed IT',
      'Co-Managed IT',
      'Remote Monitoring & Management (RMM)',
      'IT Asset Management',
      'On-Site Support'
    ]);
  });

  it('uses the stored draft payload and the applied intake repair as their active sources', () => {
    const manualPayload = { metadata: {}, userdata: { company_description: 'Manual edit' } };
    const repairedPayload = { metadata: {}, userdata: { company_description: 'Repaired' } };

    expect(getDraftPdfPayload({
      mapped_payload_json: JSON.stringify(manualPayload),
      ai_repaired_payload_json: JSON.stringify(repairedPayload)
    })).toEqual(manualPayload);
    expect(getIntakePdfPayload({
      ai_repair_applied: true,
      transformed_payload_json: JSON.stringify(manualPayload),
      ai_repaired_payload_json: JSON.stringify(repairedPayload)
    })).toEqual(repairedPayload);
  });

  it('creates stable hashes and changes the hash when a rendered payload value changes', async () => {
    const snapshot = buildQuestionnairePdfSnapshot({ payload });
    const reorderedSnapshot = {
      submissionDate: snapshot.submissionDate,
      domain: snapshot.domain,
      businessName: snapshot.businessName,
      formData: Object.fromEntries(Object.entries(snapshot.formData).reverse())
    };
    const changedSnapshot = {
      ...snapshot,
      formData: { ...snapshot.formData, '6': 'Updated managed service provider.' }
    };

    await expect(hashQuestionnairePdfSnapshot(reorderedSnapshot))
      .resolves.toBe(await hashQuestionnairePdfSnapshot(snapshot));
    await expect(hashQuestionnairePdfSnapshot(changedSnapshot))
      .resolves.not.toBe(await hashQuestionnairePdfSnapshot(snapshot));
  });

  it('includes the template revision in the stable fingerprint', async () => {
    const snapshot = buildQuestionnairePdfSnapshot({ payload });
    const serialized = stableQuestionnairePdfSnapshot(snapshot);
    const legacySerialized = JSON.stringify(legacyStableValue(snapshot));
    const legacyDigest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(legacySerialized)
    );
    const legacyHash = [...new Uint8Array(legacyDigest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    expect(serialized).toContain(`\"templateRevision\":\"${QUESTIONNAIRE_PDF_TEMPLATE_REVISION}\"`);
    await expect(hashQuestionnairePdfSnapshot(snapshot)).resolves.not.toBe(legacyHash);
  });
});
