import { describe, expect, it } from 'vitest';
import {
  normalizeGeographicAreas,
  normalizeCertifications,
  normalizeGuarantees,
  normalizeTeamPhoto,
  transformResponsesToPayload,
  validateSubmissionPayload
} from '@/components/pro-form/submissionPayload';

describe('submission payload normalizers', () => {
  it('normalizes geographic areas', () => {
    const result = normalizeGeographicAreas(
      [
        {
          name: 'Denver',
          label: 'Denver, CO, USA',
          lat: '39.7392',
          lon: '-104.9903',
          place_id: 'abc123',
          source: 'google'
        },
        'Nashville, TN'
      ],
      0
    );

    expect(result[0].geographic_area_meta.name).toBe('Denver');
    expect(result[0].geographic_area_meta.lat).toBe('39.7392');
    expect(result[0].geographic_area_meta.lon).toBe('-104.9903');
    expect(result[0].geographic_area_meta.primary).toBe(true);
    expect(result[1].geographic_area_meta.name).toBe('Nashville, TN');
    expect(result[1].geographic_area_meta.lat).toBe('');
    expect(result[1].geographic_area_meta.source).toBe('manual');
  });

  it('filters incomplete certifications and preserves files', () => {
    const result = normalizeCertifications([
      {
        name: '',
        type: 'award'
      },
      {
        name: 'Microsoft Partner',
        type: 'partnership',
        image: {
          name: 'logo.png',
          url: 'https://example.test/logo.png'
        },
        files: [
          {
            name: 'certificate.pdf',
            url: 'https://example.test/certificate.pdf'
          }
        ],
        saved: true
      }
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].cert_item_name).toBe('Microsoft Partner');
    expect(result[0].cert_item_image_url).toBe('https://example.test/logo.png');
    expect(result[0].cert_item_files[0].url).toBe('https://example.test/certificate.pdf');
    expect(result[0].saved).toBeUndefined();
  });

  it('preserves x/y values of 0 in team photo tags', () => {
    const result = normalizeTeamPhoto({
      name: 'team.jpg',
      url: 'https://example.test/team.jpg',
      tags: [
        {
          x: 0,
          y: 0,
          person: {
            name: 'Jane Doe',
            position: 'CEO'
          }
        }
      ]
    });

    expect(result.taggedPeople[0].x).toBe(0);
    expect(result.taggedPeople[0].y).toBe(0);
  });

  it('filters incomplete guarantees', () => {
    const result = normalizeGuarantees([
      {
        name: '',
        type: 'sla',
        description: 'Missing name'
      },
      {
        name: '30-Minute Response',
        type: 'sla',
        description: 'We respond quickly.'
      }
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].guarantee_name).toBe('30-Minute Response');
  });

  it('preserves guarantee file url and description for complete guarantees', () => {
    const result = normalizeGuarantees([
      {
        name: 'Response SLA',
        type: 'sla',
        description: 'We respond quickly.',
        file: {
          name: 'sla.pdf',
          url: 'https://example.test/sla.pdf'
        }
      }
    ]);

    expect(result[0].guarantee_file_url).toBe('https://example.test/sla.pdf');
    expect(result[0].guarantee_description).toBe('We respond quickly.');
  });

  it('keeps valid questionnaire responses mapping intact', () => {
    const payload = transformResponsesToPayload({
      '1': 'yes',
      '1.1': 'Why choose us text',
      '3': ['CATEGORY:Security', 'Help Desk'],
      '4': ['Healthcare'],
      '5': [{ name: 'Denver', label: 'Denver, CO, USA', lat: '39.7392', lon: '-104.9903', source: 'google' }],
      '6': 'Company description',
      '14': 'yes',
      '14.1': [{ name: 'Response SLA', type: 'sla', description: 'We respond quickly.' }]
    }, 'Acme', 'acme.com', { Security: ['Firewall Management'] });

    expect(payload.metadata.business_name).toBe('Acme');
    expect(payload.userdata.service_offerings).toEqual(['Firewall Management', 'Help Desk']);
    expect(payload.userdata.target_industries).toEqual(['Healthcare']);
    expect(payload.userdata.service_guarantee).toBe(true);
  });

  it('fails validation when required metadata is missing', () => {
    const payload = transformResponsesToPayload({}, '', '', {});
    expect(validateSubmissionPayload(payload).ok).toBe(false);
  });
});