import { describe, expect, it } from 'vitest';
import {
  asSafeFileList,
  asStringArray,
  getNormalizationWarnings,
  normalizeQuestionnaireResponses
} from '@/lib/proResponseNormalizers';
import { transformResponsesToPayload } from '@/components/pro-form/submissionPayload';

describe('proResponseNormalizers', () => {
  it('maps mixed values into string arrays safely', () => {
    expect(asStringArray(['a', { label: 'b' }, null])).toEqual(['a', 'b']);
  });

  it('normalizes file-like objects safely', () => {
    expect(asSafeFileList({ file_url: 'https://example.test/file.pdf', originalName: 'file.pdf', nested: { huge: true } })).toEqual([
      { url: 'https://example.test/file.pdf', name: 'file.pdf' }
    ]);
  });

  it('collects warnings without storing raw values', () => {
    normalizeQuestionnaireResponses({ '3': { label: 'Help Desk' }, '1': true });
    expect(getNormalizationWarnings().every((warning) => !('value' in warning))).toBe(true);
    expect(getNormalizationWarnings().length).toBeGreaterThan(0);
  });

  it('does not throw for null responses', () => {
    expect(() => transformResponsesToPayload(null, 'Acme', 'acme.com', {})).not.toThrow();
  });

  it('does not throw for mixed answer shapes', () => {
    expect(() => transformResponsesToPayload({
      '1': true,
      '2': 'yes',
      '2.2': { imageUrl: 'https://example.test/team.jpg', tags: [{ x: '10', y: null, person: { label: 'Jane' } }] },
      '3': ['CATEGORY:Security', { label: 'Help Desk' }, null],
      '3_other': { value: 'Custom Service' },
      '4': { label: 'Healthcare' },
      '5': { label: 'Denver, CO, USA', lat: 39.7, lon: -104.9 },
      '12': 'yes',
      '12.1': { url: 'https://example.test/cert.pdf', name: 'cert.pdf', type: 'award', label: 'Microsoft Partner' },
      '14': 'yes',
      '14.1': { fileUrl: 'https://example.test/sla.pdf', description: 'Fast response', label: 'Response SLA', category: 'sla' }
    }, 'Acme', 'acme.com', { Security: ['Firewall Management'] })).not.toThrow();
  });

  it('preserves structured uploads for certifications and guarantees', () => {
    const normalized = normalizeQuestionnaireResponses({
      '12.1': [{
        name: 'Microsoft Partner',
        type: 'partnership',
        image: { url: 'https://example.test/logo.png', file_url: 'https://example.test/logo-file.png' },
        supporting_files: [{ url: 'https://example.test/support.pdf' }],
        cert_item_files: [{ url: 'https://example.test/cert.pdf' }]
      }],
      '14.1': [{
        name: 'Response SLA',
        type: 'sla',
        file: { fileUrl: 'https://example.test/sla.pdf', fileName: 'sla.pdf' },
        description: 'Fast response'
      }]
    });

    expect(normalized['12.1'][0].image.url).toBe('https://example.test/logo.png');
    expect(normalized['12.1'][0].supporting_files[0].url).toBe('https://example.test/support.pdf');
    expect(normalized['12.1'][0].cert_item_files[0].url).toBe('https://example.test/cert.pdf');
    expect(normalized['14.1'][0].file.fileUrl).toBe('https://example.test/sla.pdf');
    expect(normalized['14.1'][0].description).toBe('Fast response');
  });

  it('handles service selections with object entries', () => {
    const payload = transformResponsesToPayload({
      '3': [{ value: 'CATEGORY:Security' }, { label: 'Help Desk' }]
    }, 'Acme', 'acme.com', { Security: ['Firewall Management'] });

    expect(payload.userdata.service_offerings).toEqual([
      'Security',
      'Firewall Management',
      'Help Desk'
    ]);
  });
});
