import { describe, expect, it } from 'vitest';
import { formatAnswerForPdf } from '@/components/pro-form/pdf/pdfAnswerFormatting';

describe('formatAnswerForPdf', () => {
  it.each([
    null,
    undefined,
    '',
    '   \n\t ',
    [],
    {},
    { latitude: 41.88, longitude: -87.63 }
  ])('returns a blank string for an unanswered value: %o', (answer) => {
    expect(formatAnswerForPdf('6', answer)).toBe('');
  });

  it('capitalizes exact yes and no answers without altering unrelated text', () => {
    expect(formatAnswerForPdf('1', 'yes')).toBe('Yes');
    expect(formatAnswerForPdf('1', 'no')).toBe('No');
    expect(formatAnswerForPdf('6', 'Yesterday was productive.')).toBe('Yesterday was productive.');
  });

  it('renders standard arrays one item per line', () => {
    expect(formatAnswerForPdf('3', ['Managed IT', 'Cloud Services', 'Cybersecurity']))
      .toBe('Managed IT\nCloud Services\nCybersecurity');
  });

  it('shows service parent labels without exposing internal markers', () => {
    expect(formatAnswerForPdf('3', [
      'PARENT:Managed IT Services',
      'Managed IT'
    ])).toBe('Managed IT Services\nManaged IT');
  });

  it('appends an Other value on a new line', () => {
    expect(formatAnswerForPdf('3', ['Managed IT'], 'Fractional CIO'))
      .toBe('Managed IT\nOther: Fractional CIO');
  });

  it('formats geographic variants and honors selected or explicit primary locations', () => {
    const result = formatAnswerForPdf('5', [
      'Chicago, IL',
      { geographic_area_meta: { label: 'Milwaukee, WI' } },
      { name: 'Austin, TX', primary: true },
      { place_id: 'place-denver' }
    ], null, { '5_primary': 1 });

    expect(result).toBe([
      'Chicago, IL',
      'Milwaukee, WI (Primary)',
      'Austin, TX (Primary)',
      'place-denver'
    ].join('\n'));
  });

  it('formats current and normalized certification entries without exposing signed URLs', () => {
    const result = formatAnswerForPdf('12.1', [
      {
        name: 'Microsoft Partner',
        type: 'partnership',
        image: {
          name: 'microsoft-logo.png',
          url: 'https://private.test/microsoft-logo.png?token=secret'
        },
        files: [
          { name: 'certificate.pdf', url: 'https://private.test/certificate.pdf?signature=secret' },
          { url: 'https://private.test/partner-document%20final.pdf#private' }
        ]
      },
      {
        cert_item_name: 'SOC 2',
        cert_item_type: 'certification',
        cert_item_image_url: 'https://private.test/soc2-badge.png?X-Amz-Credential=private',
        supporting_files: {
          name: 'audit-letter.pdf',
          url: 'https://private.test/audit-letter.pdf?auth=private'
        }
      }
    ]);

    expect(result).toContain('Microsoft Partner (Partnership)');
    expect(result).toContain('Image: microsoft-logo.png');
    expect(result).toContain('Attachments: certificate.pdf, partner-document final.pdf');
    expect(result).toContain('SOC 2 (Certification)');
    expect(result).toContain('Image: soc2-badge.png');
    expect(result).toContain('Attachments: audit-letter.pdf');
    expect(result).not.toContain('https://');
    expect(result).not.toContain('token=');
    expect(result).not.toContain('X-Amz-Credential');
  });

  it('formats current and normalized guarantee entries', () => {
    const result = formatAnswerForPdf('14.1', [
      {
        name: '30-Minute Response Guarantee',
        type: 'SLA',
        description: 'We acknowledge critical tickets within 30 minutes.',
        file: {
          name: 'service-level-agreement.pdf',
          url: 'https://private.test/service-level-agreement.pdf?token=secret'
        }
      },
      {
        guarantee_name: 'Uptime Standard',
        guarantee_type: 'service_standard',
        guarantee_description: '99.9% service availability.',
        guarantee_file_url: 'https://private.test/uptime%20standard.pdf?signature=secret'
      }
    ]);

    expect(result).toContain('30-Minute Response Guarantee (SLA)');
    expect(result).toContain('We acknowledge critical tickets within 30 minutes.');
    expect(result).toContain('Attachment: service-level-agreement.pdf');
    expect(result).toContain('Uptime Standard (Service Standard)');
    expect(result).toContain('Attachment: uptime standard.pdf');
    expect(result).not.toContain('signature=');
  });

  it('formats current team photo tags as text', () => {
    const result = formatAnswerForPdf('2.2', {
      name: 'team-photo.jpg',
      url: 'https://private.test/team-photo.jpg?token=secret',
      tags: [
        { person: { name: 'Jane Doe', position: 'CEO' } },
        { person: { name: 'John Smith', position: 'Service Manager' } }
      ]
    });

    expect(result).toBe(
      'Image: team-photo.jpg\nTagged people: Jane Doe - CEO; John Smith - Service Manager'
    );
    expect(result).not.toContain('https://');
  });

  it('formats normalized team photo tags and safely derives the image filename', () => {
    const result = formatAnswerForPdf('2.2', {
      imageUrl: 'https://private.test/uploads/company%20team.png?X-Amz-Signature=private',
      taggedPeople: [
        { name: 'Alex Rivera', title: 'Operations Director' },
        { person: { name: 'Sam Lee', role: 'Engineer' } }
      ]
    });

    expect(result).toBe(
      'Image: company team.png\nTagged people: Alex Rivera - Operations Director; Sam Lee - Engineer'
    );
    expect(result).not.toContain('X-Amz-Signature');
  });

  it('uses safe upload fallbacks when a URL has no filename', () => {
    expect(formatAnswerForPdf('2.2', { imageUrl: 'https://private.test/?token=secret' }))
      .toBe('Image: Uploaded image');
  });

  it('does not serialize arbitrary objects or produce object coercion text', () => {
    const values = [
      formatAnswerForPdf('6', { nested: { private: true }, count: 2 }),
      formatAnswerForPdf('3', [{ unexpected: 'value' }, { label: 'Readable label' }]),
      formatAnswerForPdf('12.1', [{}]),
      formatAnswerForPdf('14.1', [{}])
    ];

    expect(values[0]).toBe('');
    expect(values[1]).toBe('Readable label');
    expect(values[2]).toBe('');
    expect(values[3]).toBe('');
    values.forEach((value) => {
      expect(value).not.toContain('[object Object]');
      expect(value).not.toContain('{"');
    });
  });

  it('preserves HTML-like text as literal, unmodified text at this layer', () => {
    const answer = '  <script>alert("not executed")</script> & client notes  ';
    expect(formatAnswerForPdf('6', answer))
      .toBe('<script>alert("not executed")</script> & client notes');
  });

  it('preserves full multiline textarea content without truncation', () => {
    const answer = `  First line\nSecond line\n${'A'.repeat(1500)}  `;
    const result = formatAnswerForPdf('6', answer);

    expect(result).toBe(`First line\nSecond line\n${'A'.repeat(1500)}`);
    expect(result).not.toContain('...');
  });

  it('does not mutate answers, other values, all responses, or nested data', () => {
    const answer = [
      {
        name: 'Microsoft Partner',
        type: 'partnership',
        image: { url: 'https://private.test/logo.png?token=secret', name: 'logo.png' },
        files: [{ url: 'https://private.test/certificate.pdf?token=secret' }]
      }
    ];
    const otherValue = ['Regional award', 'Community partnership'];
    const allResponses = {
      '5_primary': 0,
      nested: { values: ['unchanged'] }
    };
    const before = structuredClone({ answer, otherValue, allResponses });

    const result = formatAnswerForPdf('12.1', answer, otherValue, allResponses);

    expect(typeof result).toBe('string');
    expect({ answer, otherValue, allResponses }).toEqual(before);
  });
});
