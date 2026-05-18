import { describe, expect, it } from 'vitest';
import {
  buildPayloadFeatureSummary,
  buildSubmitDiagnostics,
  classifySubmitError,
  getBrowserOnlineStatus,
  serializeSubmitError
} from '@/lib/proSubmissionResilience';

describe('proSubmissionResilience diagnostics', () => {
  it('classifies auth-like errors as auth', () => {
    expect(classifySubmitError({ status: 401, message: 'JWT expired' })).toBe('auth');
  });

  it('classifies permission-like errors as permission', () => {
    expect(classifySubmitError({ status: 403, message: 'RLS policy violation' })).toBe('permission');
  });

  it('classifies failed fetch as network', () => {
    expect(classifySubmitError(new TypeError('Failed to fetch'))).toBe('network');
  });

  it('captures browser online status safely', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false, userAgent: 'test-agent' },
      configurable: true
    });

    expect(getBrowserOnlineStatus()).toBe(false);

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalDescriptor);
    }
  });

  it('builds payload summary with counts only', () => {
    const payload = {
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: {
        additional_pages_list: {
          why_choose_us_page: { generate_page: true },
          meet_the_team_page: {
            generate_page: true,
            team_photo_with_tags: {
              imageUrl: 'https://private.example/file.png',
              taggedPeople: [{ name: 'A' }]
            }
          }
        },
        certifications_partnerships: [
          { cert_item_files: [{ url: 'https://private.example/a.pdf', name: 'a.pdf' }, null] }
        ],
        service_guarantee_items: [
          { guarantee_file_url: 'https://private.example/g.pdf', guarantee_description: 'Fast' }
        ],
        geographic_areas: [{ geographic_area_meta: { name: 'Denver' } }],
        service_offerings: ['Managed IT'],
        target_industries: ['Healthcare']
      }
    };

    const summary = buildPayloadFeatureSummary(payload);

    expect(summary).toEqual({
      hasTeamPhotoWithTags: true,
      certificationFileCount: 1,
      guaranteeFileCount: 1,
      additionalPagesCount: 2,
      geographicAreaCount: 1,
      serviceOfferingCount: 1,
      industryCount: 1,
      locationCount: 1,
      payloadSizeChars: expect.any(Number)
    });
    expect(summary.rawResponses).toBeUndefined();
    expect(summary.responses).toBeUndefined();
  });

  it('does not leak raw answers in diagnostics', () => {
    const payloadSummary = buildPayloadFeatureSummary({
      metadata: { business_name: 'Acme', businessDomain: 'acme.com' },
      userdata: { service_offerings: ['Managed IT'] }
    });

    const diagnostics = buildSubmitDiagnostics({
      questionnaireSessionId: 'session-123',
      businessName: 'Acme',
      domain: 'acme.com',
      draftId: 'draft-1',
      primaryResult: {
        ok: false,
        failureKind: 'network',
        error: serializeSubmitError(new TypeError('Failed to fetch'))
      },
      fallbackResult: {
        ok: true,
        usedFallback: true
      },
      submitContext: { app_version: 'test' },
      payloadSummary
    });

    expect(diagnostics.primaryFailureKind).toBe('network');
    expect(diagnostics.fallbackOk).toBe(true);
    expect(diagnostics.payloadFeatureSummary.serviceOfferingCount).toBe(1);
    expect(diagnostics.payloadFeatureSummary.service_offerings).toBeUndefined();
    expect(JSON.stringify(diagnostics)).not.toContain('Managed IT');
  });
});