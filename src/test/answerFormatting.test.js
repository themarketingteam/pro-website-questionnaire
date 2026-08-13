import { describe, expect, it } from 'vitest';
import { formatAnswerForDisplay } from '@/components/pro-form/answerFormatting';

describe('formatAnswerForDisplay', () => {
  it('shows service parent labels without exposing internal markers', () => {
    const result = formatAnswerForDisplay('3', [
      'PARENT:Managed IT Services',
      'Managed IT'
    ]);

    expect(result).toBe('Managed IT Services, Managed IT');
    expect(result).not.toContain('PARENT:');
  });

  it('formats geographic location objects without object coercion', () => {
    const result = formatAnswerForDisplay(
      '5',
      [
        {
          label: 'Denver, CO, USA',
          name: 'Denver',
          lat: 39.7,
          lon: -104.9
        }
      ],
      null,
      {
        '5_primary': 0
      }
    );

    expect(result).toContain('Denver');
    expect(result).not.toContain('[object Object]');
  });

  it('formats certification objects without object coercion', () => {
    const result = formatAnswerForDisplay('12.1', [
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
        ]
      }
    ]);

    expect(result).toContain('Microsoft Partner');
    expect(result).toContain('certificate.pdf');
    expect(result).not.toContain('[object Object]');
  });

  it('formats guarantee objects without object coercion', () => {
    const result = formatAnswerForDisplay('14.1', [
      {
        name: '30-Minute Response',
        type: 'sla',
        description: 'We respond quickly.'
      }
    ]);

    expect(result).toContain('30-Minute Response');
    expect(result).toContain('We respond quickly.');
    expect(result).not.toContain('[object Object]');
  });

  it('formats team photo tagging objects without object coercion', () => {
    const result = formatAnswerForDisplay('2.2', {
      name: 'team.jpg',
      url: 'https://example.test/team.jpg',
      tags: [
        {
          x: 10,
          y: 20,
          person: {
            name: 'Jane Doe',
            position: 'CEO'
          }
        }
      ]
    });

    expect(result).toContain('team.jpg');
    expect(result).toContain('Jane Doe');
    expect(result).not.toContain('[object Object]');
  });
});
