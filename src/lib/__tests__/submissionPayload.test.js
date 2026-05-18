import { describe, expect, it } from 'vitest';
import {
  normalizeCertifications,
  normalizeGeographicAreasForPayload,
  normalizeGuarantees,
  transformResponsesToPayload,
  validateSubmissionPayload
} from '@/components/pro-form/submissionPayload';
import {
  normalizeAdditionalPagesList,
  normalizeGeographicAreas,
  normalizeIndustrySelections,
  normalizeLocationSelections,
  normalizeServiceSelections,
  normalizeTeamPhotoWithTags
} from '@/lib/proResponseNormalizers';
import { repairProSubmissionPayload } from '@/lib/proPayloadRepair';

const groupedServices = {
  'Core Services': ['Managed IT Services', 'Help Desk'],
  Security: ['Firewall Management', 'Endpoint Protection']
};

const validMinimalResponses = {
  '1': 'no',
  '2': 'no',
  '3': ['Managed IT Services'],
  '4': ['Healthcare'],
  '5': ['Chicago, IL'],
  '6': 'We provide managed IT support.',
  '7': 'Hybrid',
  '8': ['Monthly Retainer'],
  '9': 'Fast response times.',
  '10': ['Generate leads'],
  '11': 'Professional',
  '12': 'no',
  '13': 'Discovery, proposal, onboarding.',
  '14': 'no',
  '15': 'Referrals',
  '16': ['Generate leads'],
  '17': '10-100 employees',
  '18': ['Downtime'],
  '19': 'Slow IT support.',
  '20': ['Reduce downtime'],
  '21': 'We align IT with business goals.',
  '22': 'Growing businesses needing dependable IT.',
  '23': 'no',
  '24': 'Schedule a consultation',
  '25': 'no'
};

const validFullResponses = {
  '1': 'yes',
  '1.1': 'We combine strategy, support, and security.',
  '2': 'yes',
  '2.1': 'Meet the people behind our service delivery.',
  '2.2': {
    url: 'https://example.test/team.jpg',
    name: 'team.jpg',
    tags: [
      {
        x: 24,
        y: 36,
        person: {
          name: 'Isaac Hines',
          position: 'Founder',
          bio: 'Leads client strategy.'
        }
      }
    ]
  },
  '3': ['CATEGORY:Core Services', 'Endpoint Protection'],
  '3_other': ['Fractional CIO'],
  '4': ['Healthcare', 'Legal'],
  '4_other': ['Nonprofit'],
  '5': [
    {
      name: 'Chicago',
      label: 'Chicago, IL, USA',
      lat: '41.8781',
      lon: '-87.6298',
      place_id: 'place-1',
      source: 'google',
      primary: true
    },
    'Milwaukee, WI'
  ],
  '5_primary': 0,
  '6': 'We help businesses modernize and secure IT.',
  '7': 'Hybrid',
  '7_other': '',
  '8': ['Monthly Retainer', 'Project-Based'],
  '8_other': 'Co-managed IT',
  '9': 'Senior experts and fast response.',
  '10': ['Generate leads', 'Build trust'],
  '10_other': 'Recruit talent',
  '11': 'Professional',
  '11_other': 'Consultative',
  '12': 'yes',
  '12.1': [
    {
      name: 'Microsoft Solutions Partner',
      type: 'partnership',
      image: { name: 'partner.png', url: 'https://example.test/partner.png' },
      files: [{ name: 'partner.pdf', url: 'https://example.test/partner.pdf' }]
    }
  ],
  '13': 'Assessment, roadmap, onboarding, ongoing reviews.',
  '14': 'yes',
  '14.1': [
    {
      name: '30-Minute Response',
      type: 'sla',
      file: { name: 'sla.pdf', url: 'https://example.test/sla.pdf' },
      description: 'Priority tickets get a 30-minute response.'
    }
  ],
  '15': 'Referrals',
  '15_other': 'Strategic alliances',
  '16': ['Generate leads', 'Book consultations'],
  '16_other': 'Support recruiting',
  '17': '25-250 employees',
  '18': ['Downtime', 'Security risk'],
  '18_other': ['Vendor sprawl'],
  '19': 'They are tired of reactive support.',
  '20': ['Reduce downtime', 'Improve security'],
  '20_other': ['Gain visibility'],
  '21': 'We combine process, tools, and accountability.',
  '22': 'Growth-focused SMBs with compliance needs.',
  '23': 'yes',
  '23.1': 'Clients that only shop on price.',
  '24': 'Schedule a consultation',
  '24_other': 'Request assessment',
  '25': 'yes',
  '25.1': 'Emphasize healthcare and compliance credibility.'
};

const malformedMixedResponses = {
  '1': true,
  '1.1': null,
  '2': 'yes',
  '2.1': 42,
  '2.2': {
    imageUrl: 'https://example.test/legacy-team.jpg',
    tags: [null, { x: 'bad', y: {}, person: null }]
  },
  '3': [
    { label: 'Managed IT Services' },
    { value: 'CATEGORY:Core Services' },
    null,
    'Endpoint Protection'
  ],
  '3_other': { label: 'Fractional CIO' },
  '4': ['Healthcare', { value: 'Legal' }, null],
  '4_other': null,
  '5': [
    { name: 123, label: ['Chicago'], lat: 'north', lon: false, placeId: 999, source: 7 },
    null,
    'Milwaukee'
  ],
  '5_primary': 'not-a-number',
  '6': null,
  '7': { value: 'Hybrid' },
  '7_other': ['Custom delivery'],
  '8': [{ label: 'Monthly Retainer' }, 'Project-Based', null],
  '8_other': { value: 'Co-managed IT' },
  '9': ['Different'],
  '10': [{ label: 'Generate leads' }],
  '10_other': null,
  '11': { label: 'Professional' },
  '11_other': false,
  '12': 'yes',
  '12.1': {
    name: 'Microsoft Partner',
    type: 'partnership',
    files: { name: 'certificate.pdf', url: 'https://example.test/certificate.pdf' }
  },
  '13': { label: 'Assessment and onboarding' },
  '14': 'yes',
  '14.1': {
    name: 'Response SLA',
    type: 'sla',
    fileUrl: 'https://example.test/sla.pdf',
    description: ['Fast response']
  },
  '15': { label: 'Referrals' },
  '15_other': null,
  '16': [{ label: 'Generate leads' }, 'Book consultations'],
  '16_other': ['Extra objective'],
  '17': { label: '10-100 employees' },
  '18': [{ label: 'Downtime' }, null],
  '18_other': { label: 'Vendor sprawl' },
  '19': { value: 'Frustrated by reactive IT' },
  '20': [{ label: 'Reduce downtime' }, null],
  '20_other': { value: 'Gain visibility' },
  '21': { label: 'We deliver clarity' },
  '22': { label: 'Ideal client description' },
  '23': 1,
  '23.1': ['Price shoppers'],
  '24': { label: 'Schedule a consultation' },
  '24_other': null,
  '25': false,
  '25.1': { value: 'Extra notes' },
  additional_pages_list: ['wrong'],
  team_photo_with_tags: 'wrong-shape'
};

const buildPayload = (responses, businessName = 'Acme IT', domain = 'acmeit.com') =>
  transformResponsesToPayload(responses, businessName, domain, groupedServices);

describe('submission payload transformation shape safety', () => {
  it('normalizeTeamPhotoWithTags returns a safe object for null input', () => {
    expect(normalizeTeamPhotoWithTags(null)).toEqual({
      imageUrl: '',
      imageName: '',
      taggedPeople: [],
      files: [],
      tags: [],
      notes: '',
      has_team_photo: false
    });
  });

  it('normalizeTeamPhotoWithTags preserves string urls', () => {
    const normalized = normalizeTeamPhotoWithTags('https://example.test/team.jpg');

    expect(normalized.imageUrl).toBe('https://example.test/team.jpg');
    expect(normalized.files[0].url).toBe('https://example.test/team.jpg');
    expect(normalized.has_team_photo).toBe(true);
  });

  it('normalizeTeamPhotoWithTags preserves safe file keys and normalized tags', () => {
    const normalized = normalizeTeamPhotoWithTags({
      file_url: 'https://example.test/team.jpg',
      filename: 'team.jpg',
      uploadedFiles: [
        {
          url: 'https://example.test/team.jpg',
          filename: 'team.jpg',
          mimeType: 'image/jpeg',
          size: '42',
          ignored: { nested: true }
        },
        null
      ],
      selectedTags: [' Founder ', { label: 'Founder' }, { value: 'Leadership' }, ''],
      description: '  Team photo notes  '
    });

    expect(normalized.imageUrl).toBe('https://example.test/team.jpg');
    expect(normalized.imageName).toBe('team.jpg');
    expect(normalized.files).toEqual([
      {
        url: 'https://example.test/team.jpg',
        filename: 'team.jpg',
        mimeType: 'image/jpeg',
        size: 42,
        name: 'team.jpg'
      }
    ]);
    expect(normalized.tags).toEqual(['Founder', 'Leadership']);
    expect(normalized.notes).toBe('Team photo notes');
    expect(normalized.has_team_photo).toBe(true);
  });

  it('transformResponsesToPayload does not throw for validMinimalResponses', () => {
    expect(() => buildPayload(validMinimalResponses)).not.toThrow();
  });

  it('transformResponsesToPayload does not throw for validFullResponses', () => {
    expect(() => buildPayload(validFullResponses)).not.toThrow();
  });

  it('transformResponsesToPayload does not throw for malformedMixedResponses', () => {
    expect(() => buildPayload(malformedMixedResponses)).not.toThrow();
  });

  it('malformed team photo data cannot block submit validation by shape alone', () => {
    const payload = buildPayload({
      ...validMinimalResponses,
      '2': 'yes',
      '2.2': {
        uploadedFiles: [{ image_url: 'https://example.test/team-safe.jpg', blob: { huge: true } }],
        tags: 'Founder'
      }
    });

    expect(typeof payload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags).toBe('object');
    expect(validateSubmissionPayload(payload).ok).toBe(true);
  });

  it('service_offerings output is always an array', () => {
    expect(Array.isArray(buildPayload(validMinimalResponses).userdata.service_offerings)).toBe(true);
    expect(Array.isArray(buildPayload(validFullResponses).userdata.service_offerings)).toBe(true);
    expect(Array.isArray(buildPayload(malformedMixedResponses).userdata.service_offerings)).toBe(true);
  });

  it('additional_pages_list is always an object in final payload userdata', () => {
    const payload = buildPayload(malformedMixedResponses);
    expect(payload.userdata.additional_pages_list).toBeTruthy();
    expect(typeof payload.userdata.additional_pages_list).toBe('object');
    expect(Array.isArray(payload.userdata.additional_pages_list)).toBe(false);
  });

  it('team_photo_with_tags is always an object in final payload userdata', () => {
    const minimalPayload = buildPayload(validMinimalResponses);
    const malformedPayload = buildPayload(malformedMixedResponses);

    expect(typeof minimalPayload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags).toBe('object');
    expect(typeof malformedPayload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags).toBe('object');
    expect(Array.isArray(minimalPayload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.files)).toBe(true);
    expect(Array.isArray(malformedPayload.userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags.tags)).toBe(true);
  });

  it('certification files normalize to schema-safe arrays', () => {
    const fullPayload = buildPayload(validFullResponses);
    const malformedPayload = buildPayload(malformedMixedResponses);

    expect(Array.isArray(fullPayload.userdata.certifications_partnerships)).toBe(true);
    expect(Array.isArray(fullPayload.userdata.certifications_partnerships[0].cert_item_files)).toBe(true);
    expect(Array.isArray(malformedPayload.userdata.certifications_partnerships)).toBe(true);
    expect(Array.isArray(malformedPayload.userdata.certifications_partnerships[0].cert_item_files)).toBe(true);

    const directNormalized = normalizeCertifications(malformedMixedResponses['12.1']);
    expect(Array.isArray(directNormalized)).toBe(true);
    expect(Array.isArray(directNormalized[0].cert_item_files)).toBe(true);
  });

  it('guarantee files normalize to schema-safe values', () => {
    const fullPayload = buildPayload(validFullResponses);
    const malformedPayload = buildPayload(malformedMixedResponses);

    expect(Array.isArray(fullPayload.userdata.service_guarantee_items)).toBe(true);
    expect(fullPayload.userdata.service_guarantee_items[0].guarantee_file_url).toBe('https://example.test/sla.pdf');
    expect(Array.isArray(malformedPayload.userdata.service_guarantee_items)).toBe(true);
    expect(typeof malformedPayload.userdata.service_guarantee_items[0].guarantee_file_url).toBe('string');

    const directNormalized = normalizeGuarantees(malformedMixedResponses['14.1']);
    expect(Array.isArray(directNormalized)).toBe(true);
    expect(typeof directNormalized[0].guarantee_file_url).toBe('string');
  });

  it('geographic areas normalize without throwing', () => {
    expect(() => normalizeGeographicAreas(malformedMixedResponses['5'])).not.toThrow();

    const normalizedAreas = normalizeGeographicAreas([
      'Chicago, IL',
      { label: 'Milwaukee, WI', lat: '43.0389', lon: '-87.9065', radius: '25' },
      { label: 'Bad Coords', lat: 'north', lon: 'west' }
    ]);

    expect(normalizedAreas).toEqual([
      { label: 'Chicago, IL' },
      { label: 'Milwaukee, WI', name: 'Milwaukee, WI', latitude: 43.0389, longitude: -87.9065, radius: 25 },
      { label: 'Bad Coords', name: 'Bad Coords' }
    ]);

    const payloadAreas = normalizeGeographicAreasForPayload(malformedMixedResponses['5'], malformedMixedResponses['5_primary']);
    expect(Array.isArray(payloadAreas)).toBe(true);

    const payload = buildPayload(malformedMixedResponses);
    expect(Array.isArray(payload.userdata.geographic_areas)).toBe(true);
  });

  it('missing business name or domain still fails validation, not transformation', () => {
    const missingNamePayload = buildPayload(validMinimalResponses, '', 'acmeit.com');
    const missingDomainPayload = buildPayload(validMinimalResponses, 'Acme IT', '');

    expect(validateSubmissionPayload(missingNamePayload).ok).toBe(false);
    expect(validateSubmissionPayload(missingDomainPayload).ok).toBe(false);
  });

  it('handles null and empty response containers safely', () => {
    const nullPayload = buildPayload(null);
    const emptyPayload = buildPayload({});

    expect(Array.isArray(nullPayload.userdata.service_offerings)).toBe(true);
    expect(Array.isArray(emptyPayload.userdata.service_offerings)).toBe(true);
  });

  it('normalizeServiceSelections handles strings and objects', () => {
    expect(normalizeServiceSelections('Managed IT Services', groupedServices)).toEqual(['Managed IT Services']);
    expect(normalizeServiceSelections([{ label: 'Endpoint Protection' }], groupedServices)).toEqual(['Endpoint Protection']);
  });

  it('normalizeServiceSelections expands CATEGORY values', () => {
    expect(normalizeServiceSelections(['CATEGORY:Core Services'], groupedServices)).toEqual(['Managed IT Services', 'Help Desk']);
  });

  it('normalizeIndustrySelections returns arrays', () => {
    expect(normalizeIndustrySelections({ label: 'Healthcare' })).toEqual(['Healthcare']);
  });

  it('normalizeLocationSelections returns arrays', () => {
    expect(normalizeLocationSelections({ label: 'Chicago, IL' })).toEqual(['Chicago, IL']);
  });

  it('normalizeAdditionalPagesList always returns an object', () => {
    expect(normalizeAdditionalPagesList(null)).toEqual({});
    expect(normalizeAdditionalPagesList('why choose us')).toEqual({ items: ['why choose us'] });
    expect(normalizeAdditionalPagesList(['page a'])).toEqual({ items: ['page a'] });
  });

  it('repairProSubmissionPayload does not mutate input and repairs shapes', () => {
    const input = {
      metadata: { business_name: 'Acme IT', businessDomain: 'acmeit.com' },
      userdata: {
        additional_pages_list: ['page a'],
        team_photo_with_tags: null,
        service_offerings: 'Managed IT Services',
        target_industries: { label: 'Healthcare' },
        locations: { label: 'Chicago, IL' },
        geographic_areas: { label: 'Chicago, IL', lat: '41.8781', lon: '-87.6298' },
        website_objectives: undefined,
        company_description: 'x'.repeat(6000)
      }
    };
    const snapshot = JSON.stringify(input);
    const result = repairProSubmissionPayload(input);

    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.ok).toBe(true);
    expect(result.payload.userdata.additional_pages_list).toEqual({ items: ['page a'], meet_the_team_page: { team_photo_with_tags: {} } });
    expect(result.payload.userdata.service_offerings).toEqual(['Managed IT Services']);
    expect(result.payload.userdata.target_industries).toEqual(['Healthcare']);
    expect(result.payload.userdata.locations).toEqual(['Chicago, IL']);
    expect(Array.isArray(result.payload.userdata.geographic_areas)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(validateSubmissionPayload(result.payload).ok).toBe(true);
  });

  it('repairProSubmissionPayload preserves required metadata validation', () => {
    const result = repairProSubmissionPayload({ userdata: {} });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('metadata_missing');
  });
});