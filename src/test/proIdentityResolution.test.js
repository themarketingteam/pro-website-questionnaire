import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_NAME_THRESHOLD,
  DOMAIN_THRESHOLD,
  centralDateKey,
  computeIdentityFingerprint,
  extractNarrativeSources,
  filterOrganicResults,
  isCentralFourAmWeekday,
  isPrivateNetworkAddress,
  isMissingIdentityValue,
  meetsBusinessNameThreshold,
  meetsDomainThreshold,
  normalizeDomain,
  refineOfficialBusinessName,
  scoreBusinessCandidate,
  scoreDomainCandidate,
  selectPrimaryLocation
} from '../../base44/shared/proIdentityResolution.ts';

describe('Pro questionnaire identity resolution helpers', () => {
  it('treats placeholders as missing while preserving real values', () => {
    for (const value of ['', ' unknown ', 'NULL', 'n/a', 'unnamed business', 'unknown domain']) {
      expect(isMissingIdentityValue(value)).toBe(true);
    }
    expect(isMissingIdentityValue('Nexus Consulting LLC')).toBe(false);
    expect(isMissingIdentityValue('nexusmsp.us')).toBe(false);
  });

  it('extracts only allowlisted narrative fields and removes direct contact data', () => {
    const sources = extractNarrativeSources({
      metadata: { user_email: 'private@example.com' },
      userdata: {
        company_description: 'Nexus Consulting helps contractors. Call 860-555-1212 or email owner@example.com.',
        additional_notes: 'Learn more at https://private.example/path',
        target_industries_other: 'This field is not allowlisted.'
      }
    });
    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.text).join(' ')).not.toContain('owner@example.com');
    expect(sources.map((source) => source.text).join(' ')).not.toContain('860-555-1212');
    expect(sources.map((source) => source.text).join(' ')).not.toContain('https://private.example');
    expect(sources.map((source) => source.text).join(' ')).not.toContain('not allowlisted');
  });

  it('scores the observed Nexus name above 90% without manufacturing Security', () => {
    const sources = [{
      path: 'userdata.additional_pages_list.why_choose_us_page.why_choose_us_description',
      text: 'Why Nexus Consulting\n\nSecurity is central to our work. Nexus Consulting helps construction organizations. With Nexus Consulting, clients gain a partner.'
    }];
    const observed = scoreBusinessCandidate({
      candidate: 'Nexus Consulting',
      sources,
      modelConfidence: 0.98
    });
    const manufactured = scoreBusinessCandidate({
      candidate: 'Nexus Consulting Security',
      sources,
      modelConfidence: 0.99
    });
    expect(observed.confidence).toBeGreaterThanOrEqual(BUSINESS_NAME_THRESHOLD);
    expect(observed.exactEvidence[0].excerpt).toContain('Nexus Consulting');
    expect(manufactured.confidence).toBe(0);
  });

  it('caps conflicting observed company candidates below the auto-fill threshold', () => {
    const result = scoreBusinessCandidate({
      candidate: 'Nexus Consulting',
      sources: [{
        path: 'userdata.company_description',
        text: 'Nexus Consulting supports contractors. Nexus Consulting provides managed IT.'
      }],
      modelConfidence: 0.99,
      conflictCount: 1
    });
    expect(result.confidence).toBeLessThan(BUSINESS_NAME_THRESHOLD);
  });

  it('requires name, location, service, reachability, and organic evidence for a 92% domain', () => {
    const confirmed = scoreDomainCandidate({
      businessName: 'Nexus Consulting',
      primaryLocation: 'Bristol, CT, USA',
      position: 1,
      title: 'Nexus Consulting LLC: Managed IT Services',
      snippet: 'Managed IT and cybersecurity for Bristol, CT organizations.',
      pageText: 'Nexus Consulting provides IT services in Bristol CT.',
      reachable: true,
      sameFinalHostname: true
    });
    const wrongLocation = scoreDomainCandidate({
      businessName: 'Nexus Consulting',
      primaryLocation: 'Bristol, CT, USA',
      position: 1,
      title: 'Nexus Consulting LLC: Managed IT Services',
      snippet: 'Managed IT and cybersecurity for organizations.',
      pageText: 'Nexus Consulting provides IT services.',
      reachable: true,
      sameFinalHostname: true
    });
    expect(confirmed.confidence).toBeGreaterThanOrEqual(DOMAIN_THRESHOLD);
    expect(wrongLocation.confidence).toBeLessThan(DOMAIN_THRESHOLD);
  });

  it('uses inclusive thresholds at exactly 90% and 92%', () => {
    expect(meetsBusinessNameThreshold(0.899)).toBe(false);
    expect(meetsBusinessNameThreshold(0.9)).toBe(true);
    expect(meetsDomainThreshold(0.919)).toBe(false);
    expect(meetsDomainThreshold(0.92)).toBe(true);
  });

  it('rejects parked pages and private IPv4/IPv6 targets', () => {
    const parked = scoreDomainCandidate({
      businessName: 'Nexus Consulting',
      primaryLocation: 'Bristol, CT',
      position: 1,
      title: 'Nexus Consulting',
      snippet: 'Managed IT in Bristol CT',
      pageText: 'This domain is for sale',
      reachable: true,
      sameFinalHostname: true
    });
    expect(parked.confidence).toBe(0);
    expect(isPrivateNetworkAddress('127.0.0.1')).toBe(true);
    expect(isPrivateNetworkAddress('192.168.1.2')).toBe(true);
    expect(isPrivateNetworkAddress('::1')).toBe(true);
    expect(isPrivateNetworkAddress('fd00::1')).toBe(true);
    expect(isPrivateNetworkAddress('104.21.23.87')).toBe(false);
  });

  it('uses organic results only and excludes directories and social profiles', () => {
    const results = filterOrganicResults({
      ads: [{ title: 'Sponsored competitor', link: 'https://sponsor.example' }],
      organic_results: [
        { position: 1, title: 'LinkedIn', link: 'https://linkedin.com/company/nexus' },
        { position: 2, title: 'Nexus Consulting', link: 'https://www.nexusmsp.us/about' },
        { position: 3, title: 'Local service', link: 'http://127.0.0.1/private' }
      ]
    });
    expect(results).toEqual([
      expect.objectContaining({ position: 2, hostname: 'nexusmsp.us' })
    ]);
    expect(JSON.stringify(results)).not.toContain('Sponsored competitor');
  });

  it('normalizes domains and refines only to a matching official name', () => {
    expect(normalizeDomain('https://WWW.NexusMSP.us/about?x=1')).toBe('nexusmsp.us');
    expect(refineOfficialBusinessName({
      businessName: 'Nexus Consulting',
      siteName: 'Nexus Consulting LLC',
      title: 'Managed IT Services'
    })).toBe('Nexus Consulting LLC');
    expect(refineOfficialBusinessName({
      businessName: 'Nexus Consulting',
      siteName: 'Unrelated Security Company',
      title: 'Managed IT Services'
    })).toBe('Nexus Consulting');
  });

  it('selects the explicit primary location and falls back to the first location', () => {
    expect(selectPrimaryLocation({ userdata: { geographic_areas: [
      { geographic_area_meta: { label: 'Hartford, CT' } },
      { geographic_area_meta: { label: 'Bristol, CT', primary: true } }
    ] } })).toBe('Bristol, CT');
    expect(selectPrimaryLocation({ userdata: { geographic_areas: [
      { geographic_area_meta: { label: 'Hartford, CT' } }
    ] } })).toBe('Hartford, CT');
  });

  it('changes the stale-write fingerprint whenever identity input changes', async () => {
    const first = await computeIdentityFingerprint({
      recordType: 'draft',
      businessName: '',
      domain: '',
      payload: { metadata: {}, userdata: { company_description: 'Original' } }
    });
    const changed = await computeIdentityFingerprint({
      recordType: 'draft',
      businessName: '',
      domain: '',
      payload: { metadata: {}, userdata: { company_description: 'Changed' } }
    });
    expect(first).not.toBe(changed);
  });

  it('runs at 4 AM Central on weekdays in both CST and CDT', () => {
    const winter = new Date('2026-01-05T10:05:00.000Z');
    const summer = new Date('2026-08-03T09:05:00.000Z');
    expect(isCentralFourAmWeekday(winter)).toBe(true);
    expect(isCentralFourAmWeekday(summer)).toBe(true);
    expect(isCentralFourAmWeekday(new Date('2026-01-05T09:05:00.000Z'))).toBe(false);
    expect(isCentralFourAmWeekday(new Date('2026-08-02T09:05:00.000Z'))).toBe(false);
    expect(centralDateKey(summer)).toBe('2026-08-03');
  });
});

describe('identity recovery backend safety contracts', () => {
  const repairSource = readFileSync(
    resolve(process.cwd(), 'base44/functions/repairProQuestionnaireIntakeSubmission/entry.ts'),
    'utf8'
  );
  const resolverSource = readFileSync(
    resolve(process.cwd(), 'base44/functions/resolveProQuestionnaireIdentity/entry.ts'),
    'utf8'
  );
  const schedulerSource = readFileSync(
    resolve(process.cwd(), 'base44/functions/scheduleProQuestionnaireIdentityRecovery/entry.ts'),
    'utf8'
  );

  it('keeps Diagnose read-only and invokes identity analysis for all modes', () => {
    expect(repairSource).toContain("const apply = mode !== 'diagnose_only'");
    expect(repairSource).toContain("if (mode === 'diagnose_only')");
    expect(repairSource).toContain('buildReadOnlyDiagnosis');
    expect(repairSource).not.toContain("ai_repair_status: 'diagnosed',\n        ai_repair_report_json");
  });

  it('never searches for a domain without a confirmed name and primary location', () => {
    expect(resolverSource).toContain('if (confirmedNameForSearch && primaryLocation');
    expect(resolverSource).toContain("errors.push('primary_location_missing')");
    expect(resolverSource).toContain("const apiKey = Deno.env.get('SERPAPI_API_KEY')");
  });

  it('keeps scheduled recovery bounded, shadow-controlled, and free of workflow status writes', () => {
    expect(schedulerSource).toContain('const MAX_RECORDS = 15');
    expect(schedulerSource).toContain('const CONCURRENCY = 3');
    expect(schedulerSource).toContain('const WORK_DEADLINE_MS = 150_000');
    expect(schedulerSource).toContain("Deno.env.get('IDENTITY_RESOLUTION_AUTO_APPLY') !== 'true'");
    expect(schedulerSource).not.toMatch(/entities\.(?:ProFormDraft|ProFormSubmissionIntake)\.update/);
    expect(schedulerSource).not.toContain('.delete(');
    expect(resolverSource).toContain('unchanged_record_already_attempted_today');
  });

  it('returns before repair or submission when an identity provider fails', () => {
    expect(repairSource).toContain("identityResolution?.status === 'provider_error'");
    expect(repairSource).toContain('sourceRecordChanged: false');
    expect(resolverSource).toContain('nonDiagnostic && !providerFailure');
    expect(resolverSource).toContain('effectiveApply && !providerFailure');
  });
});
