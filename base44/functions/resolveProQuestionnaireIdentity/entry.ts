import { createClientFromRequest } from 'npm:@base44/sdk@0.8.41';
import { authorizeRecoveryRequest } from '../../shared/draftRecoveryAuthorization.ts';
import {
  BUSINESS_NAME_THRESHOLD,
  DOMAIN_THRESHOLD,
  IDENTITY_RESOLVER_VERSION,
  cleanIdentityText,
  computeIdentityFingerprint,
  extractNarrativeSources,
  filterOrganicResults,
  isBlockedSearchHostname,
  isMissingIdentityValue,
  isPrivateNetworkAddress,
  meetsBusinessNameThreshold,
  meetsDomainThreshold,
  normalizeDomain,
  normalizeBusinessComparable,
  refineOfficialBusinessName,
  scoreBusinessCandidate,
  scoreDomainCandidate,
  selectPrimaryLocation,
  sha256
} from '../../shared/proIdentityResolution.ts';

const RECORD_CONFIG: Record<string, any> = {
  draft: {
    entityName: 'ProFormDraft',
    payloadField: 'mapped_payload_json',
    nameField: 'business_name',
    domainField: 'domain',
    sessionField: 'session_id'
  },
  intake: {
    entityName: 'ProFormSubmissionIntake',
    payloadField: 'transformed_payload_json',
    nameField: 'business_name',
    domainField: 'business_domain',
    sessionField: 'questionnaire_session_id'
  }
};

const VALID_TRIGGERS = new Set(['admin_diagnose', 'admin_repair', 'admin_repair_retry', 'scheduled']);
const MAX_EVIDENCE_ITEMS = 8;

const jsonResponse = (body: Record<string, unknown>, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }
});

const safeJsonParse = (value: unknown, fallback: any = {}) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const timeout = async <T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(code)), timeoutMs) as unknown as number;
      })
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};

const getRecord = async (base44: any, recordType: string, recordId: string) => {
  const config = RECORD_CONFIG[recordType];
  if (!config) return null;
  try {
    return await base44.asServiceRole.entities[config.entityName].get(recordId);
  } catch {
    return null;
  }
};

const getPayload = (recordType: string, record: any) => {
  const config = RECORD_CONFIG[recordType];
  const parsed = safeJsonParse(record?.[config.payloadField], null);
  if (parsed) return parsed;
  if (recordType === 'draft') {
    return {
      metadata: safeJsonParse(record?.metadata_json, {}),
      userdata: safeJsonParse(record?.userdata_json, {})
    };
  }
  return { metadata: {}, userdata: {} };
};

const sanitizeEvidence = (evidence: any[]) => (Array.isArray(evidence) ? evidence : [])
  .slice(0, MAX_EVIDENCE_ITEMS)
  .map((item) => ({
    path: cleanIdentityText(item?.path, 300),
    excerpt: cleanIdentityText(item?.excerpt, 240),
    url: cleanIdentityText(item?.url, 1000),
    title: cleanIdentityText(item?.title, 300),
    reason: cleanIdentityText(item?.reason, 300)
  }));

const invokeNameInference = async (base44: any, sources: Array<{ path: string; text: string }>) => {
  if (sources.length === 0) return { candidates: [], conflicts: [] };
  const sourceText = sources.map((source, index) => (
    `SOURCE ${index + 1}\nPATH: ${source.path}\nTEXT: ${source.text.slice(0, 1800)}`
  )).join('\n\n');
  const responseSchema = {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            confidence: { type: 'number' },
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  excerpt: { type: 'string' }
                }
              }
            }
          },
          required: ['value', 'confidence', 'evidence']
        }
      },
      conflicts: { type: 'array', items: { type: 'string' } }
    },
    required: ['candidates', 'conflicts']
  };
  const prompt = `Identify an explicitly observed business/company name in the client-authored questionnaire text below.

Rules:
- Return a candidate only when its exact words appear in the supplied text.
- Never combine a company phrase with a service word, heading, location, or descriptive term.
- "Security" is not part of a company name merely because the company discusses security.
- Preserve the observed capitalization.
- Evidence excerpts must be copied from the supplied text and include the exact candidate.
- If two different company names may refer to the client, report the conflict.
- Do not infer a domain, URL, person, or product name.

${sourceText}`;
  const raw: any = await timeout<any>(
    base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: responseSchema
    }),
    20000,
    'name_provider_timeout'
  );
  const result = raw?.data ?? raw;
  return {
    candidates: Array.isArray(result?.candidates) ? result.candidates.slice(0, 5) : [],
    conflicts: Array.isArray(result?.conflicts) ? result.conflicts.slice(0, 10) : []
  };
};

const extractHtmlEvidence = (html: string) => {
  const title = cleanIdentityText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1], 500);
  const siteName = cleanIdentityText(
    (html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) || [])[1]
      || (html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i) || [])[1],
    300
  );
  const canonical = cleanIdentityText(
    (html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i) || [])[1]
      || (html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/i) || [])[1],
    1000
  );
  const text = cleanIdentityText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&'),
    50000
  );
  return { title, siteName, canonical, text };
};

const assertPublicDestination = async (url: URL) => {
  if (!['http:', 'https:'].includes(url.protocol) || isBlockedSearchHostname(url.hostname)) {
    throw new Error('blocked_search_destination');
  }
  const resolvedAddresses = await timeout(Promise.all([
    Deno.resolveDns(url.hostname, 'A').catch(() => []),
    Deno.resolveDns(url.hostname, 'AAAA').catch(() => [])
  ]), 3000, 'candidate_dns_timeout');
  const addresses = resolvedAddresses.flat();
  if (addresses.length === 0 || addresses.some((address) => isPrivateNetworkAddress(address))) {
    throw new Error('blocked_private_network_destination');
  }
};

const fetchCandidatePage = async (urlValue: string) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7000);
  try {
    let url = new URL(urlValue);
    let response: Response | null = null;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      await assertPublicDestination(url);
      response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': 'Kaseya-MSP-Success-Identity-Resolver/1.0' },
        signal: controller.signal
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location || redirectCount === 3) throw new Error('candidate_redirect_rejected');
      url = new URL(location, url);
    }
    if (!response) throw new Error('candidate_fetch_failed');
    if (!response.ok) throw new Error(`candidate_http_${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (!contentType.includes('text/html') || contentLength > 1_000_000) throw new Error('candidate_not_safe_html');
    const finalUrl = new URL(response.url || url.toString());
    await assertPublicDestination(finalUrl);
    const html = (await response.text()).slice(0, 1_000_000);
    return {
      ...extractHtmlEvidence(html),
      finalUrl: finalUrl.toString(),
      finalHostname: normalizeDomain(finalUrl.hostname)
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchOrganicResults = async (base44: any, query: string) => {
  const queryHash = await sha256(`serpapi-google-v1:${query.toLowerCase()}`);
  const now = Date.now();
  const cached = await base44.asServiceRole.entities.ProFormIdentitySearchCache.filter(
    { query_hash: queryHash },
    '-created_date',
    3
  );
  const usableCache = (Array.isArray(cached) ? cached : []).find((item) => (
    new Date(item.expires_at || 0).getTime() > now
  ));
  if (usableCache) {
    let cachedResults = [];
    try {
      const parsed = JSON.parse(usableCache.organic_results_json || '[]');
      cachedResults = Array.isArray(parsed) ? parsed : [];
    } catch {
      cachedResults = [];
    }
    return {
      queryHash,
      cached: true,
      results: filterOrganicResults({ organic_results: cachedResults })
    };
  }

  const apiKey = Deno.env.get('SERPAPI_API_KEY')?.trim() || '';
  if (!apiKey) throw new Error('serpapi_provider_unconfigured');
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('gl', 'us');
  url.searchParams.set('num', '10');
  url.searchParams.set('api_key', apiKey);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) throw new Error(`serpapi_http_${response.status}`);
    const result = await response.json();
    if (result?.error) throw new Error('serpapi_provider_error');
    const results = filterOrganicResults(result);
    await base44.asServiceRole.entities.ProFormIdentitySearchCache.create({
      query_hash: queryHash,
      query: query.slice(0, 500),
      provider: 'serpapi_google',
      organic_results_json: JSON.stringify(results),
      expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString()
    });
    return { queryHash, cached: false, results };
  } finally {
    clearTimeout(timeoutId);
  }
};

// Future company-directory integrations implement this contract and can be
// inserted ahead of public web search without changing the resolver response.
const internalCompanyDirectoryProvider = {
  name: 'internal_company_directory',
  configured: false,
  lookup: async (_input: any) => ({ matched: false, evidence: [] })
};

const reviewRejectedCandidate = async (
  base44: any,
  recordType: string,
  recordId: string,
  fingerprint: string,
  field: string,
  candidate: string
) => {
  if (!candidate) return false;
  const records = await base44.asServiceRole.entities.ProFormIdentityResolutionAttempt.filter({
    record_type: recordType,
    record_id: recordId,
    payload_fingerprint: fingerprint,
    [`${field}_candidate`]: candidate,
    [`${field}_review_decision`]: 'rejected'
  }, '-created_date', 1);
  return Array.isArray(records) && records.length > 0;
};

const updateSourceRecord = async ({
  base44,
  recordType,
  record,
  fingerprint,
  payload,
  businessName,
  domain,
  summary,
  allowIdentityWrites = true
}: any) => {
  const latest = await getRecord(base44, recordType, record.id);
  if (!latest) return { applied: false, stale: true, fields: [] };
  const config = RECORD_CONFIG[recordType];
  const latestPayload = getPayload(recordType, latest);
  const latestRecordName = cleanIdentityText(latest?.[config.nameField], 300);
  const latestPayloadName = cleanIdentityText(latestPayload?.metadata?.business_name, 300);
  const latestRecordDomain = normalizeDomain(latest?.[config.domainField]);
  const latestPayloadDomain = normalizeDomain(
    latestPayload?.metadata?.businessDomain || latestPayload?.metadata?.business_domain
  );
  const latestFingerprint = await computeIdentityFingerprint({
    recordType,
    businessName: !isMissingIdentityValue(latestRecordName) ? latestRecordName : latestPayloadName,
    domain: !isMissingIdentityValue(latestRecordDomain) ? latestRecordDomain : latestPayloadDomain,
    payload: latestPayload
  });
  if (latestFingerprint !== fingerprint) return { applied: false, stale: true, fields: [] };

  const updatedPayload = JSON.parse(JSON.stringify(payload || {}));
  if (!updatedPayload.metadata || typeof updatedPayload.metadata !== 'object') updatedPayload.metadata = {};
  const fields: string[] = [];
  const updates: Record<string, unknown> = { ...summary };

  if (allowIdentityWrites && !isMissingIdentityValue(businessName)) {
    let changed = false;
    if (isMissingIdentityValue(latest?.[config.nameField])) {
      updates[config.nameField] = businessName;
      changed = true;
    }
    if (isMissingIdentityValue(updatedPayload.metadata.business_name)) {
      updatedPayload.metadata.business_name = businessName;
      changed = true;
    }
    if (changed) fields.push('business_name');
  }
  if (allowIdentityWrites && !isMissingIdentityValue(domain)) {
    const normalizedDomain = normalizeDomain(domain);
    let changed = false;
    if (isMissingIdentityValue(latest?.[config.domainField])) {
      updates[config.domainField] = normalizedDomain;
      changed = true;
    }
    if (isMissingIdentityValue(updatedPayload.metadata.businessDomain)) {
      updatedPayload.metadata.businessDomain = normalizedDomain;
      changed = true;
    }
    if (changed) fields.push('domain');
  }

  if (fields.length > 0) {
    updates[config.payloadField] = JSON.stringify(updatedPayload);
    if (recordType === 'draft') {
      updates.metadata_json = JSON.stringify(updatedPayload.metadata || {});
      updates.userdata_json = JSON.stringify(updatedPayload.userdata || {});
    }
  }

  await base44.asServiceRole.entities[config.entityName].update(record.id, updates);
  return { applied: fields.length > 0, stale: false, fields, payload: updatedPayload };
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed.' }, 405);
  const base44 = createClientFromRequest(req);
  const body = await req.json().catch(() => ({}));
  const authorization = await authorizeRecoveryRequest(base44, body);
  if (!authorization.authorized) return jsonResponse({ success: false, error: 'Unauthorized.' }, 403);

  const recordType = cleanIdentityText(body?.recordType, 20);
  const recordId = cleanIdentityText(body?.recordId, 200);
  const trigger = VALID_TRIGGERS.has(body?.trigger) ? body.trigger : 'admin_diagnose';
  const applyRequested = Boolean(body?.apply);
  if (!RECORD_CONFIG[recordType] || !recordId) {
    return jsonResponse({ success: false, error: 'recordType and recordId are required.' }, 400);
  }

  const record = await getRecord(base44, recordType, recordId);
  if (!record) return jsonResponse({ success: false, error: 'Recovery record not found.' }, 404);
  const config = RECORD_CONFIG[recordType];
  const payload = getPayload(recordType, record);
  const recordName = cleanIdentityText(record?.[config.nameField], 300);
  const payloadName = cleanIdentityText(payload?.metadata?.business_name, 300);
  const recordDomain = normalizeDomain(record?.[config.domainField]);
  const payloadDomain = normalizeDomain(payload?.metadata?.businessDomain || payload?.metadata?.business_domain);
  const currentName = !isMissingIdentityValue(recordName) ? recordName : payloadName;
  const currentDomain = !isMissingIdentityValue(recordDomain) ? recordDomain : payloadDomain;
  const trustedNameNeedsSync = isMissingIdentityValue(recordName) && !isMissingIdentityValue(payloadName);
  const trustedDomainNeedsSync = isMissingIdentityValue(recordDomain) && !isMissingIdentityValue(payloadDomain);
  const namePayloadNeedsSync = !isMissingIdentityValue(recordName) && isMissingIdentityValue(payloadName);
  const domainPayloadNeedsSync = !isMissingIdentityValue(recordDomain) && isMissingIdentityValue(payloadDomain);
  const storedNameConflict = !isMissingIdentityValue(recordName)
    && !isMissingIdentityValue(payloadName)
    && normalizeBusinessComparable(recordName) !== normalizeBusinessComparable(payloadName);
  const storedDomainConflict = !isMissingIdentityValue(recordDomain)
    && !isMissingIdentityValue(payloadDomain)
    && recordDomain !== payloadDomain;
  const fingerprint = await computeIdentityFingerprint({
    recordType,
    businessName: currentName,
    domain: currentDomain,
    payload
  });
  if (trigger === 'scheduled') {
    const recentCutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    const recentAttempts = await base44.asServiceRole.entities.ProFormIdentityResolutionAttempt.filter({
      record_type: recordType,
      record_id: recordId,
      trigger: 'scheduled',
      payload_fingerprint: fingerprint,
      completed_at: { $gte: recentCutoff }
    }, '-completed_at', 1, 0, ['id', 'status', 'completed_at']);
    const recentAttempt = Array.isArray(recentAttempts) ? recentAttempts[0] : null;
    if (recentAttempt) {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: 'unchanged_record_already_attempted_today',
        identityResolution: {
          resolver_version: IDENTITY_RESOLVER_VERSION,
          trigger,
          attempt_id: recentAttempt.id,
          payload_fingerprint: fingerprint,
          status: recentAttempt.status,
          applied: false,
          applied_fields: [],
          stale_write_aborted: false
        }
      });
    }
  }
  const primaryLocation = selectPrimaryLocation(payload);
  const sources = extractNarrativeSources(payload);
  const errors: string[] = [];
  if (storedNameConflict) errors.push('business_name_conflict_between_record_and_payload');
  if (storedDomainConflict) errors.push('domain_conflict_between_record_and_payload');
  const now = new Date().toISOString();
  const scheduledAutoApplyEnabled = Deno.env.get('IDENTITY_RESOLUTION_AUTO_APPLY') === 'true';
  const effectiveApply = applyRequested && (trigger !== 'scheduled' || scheduledAutoApplyEnabled);

  let nameCandidate = currentName;
  let nameConfidence = isMissingIdentityValue(currentName) ? 0 : 1;
  let nameEvidence: any[] = [];
  let nameState = storedNameConflict ? 'conflict' : (isMissingIdentityValue(currentName) ? 'not_found' : 'existing');
  let nameRawEligible = !isMissingIdentityValue(currentName);

  if (isMissingIdentityValue(currentName)) {
    try {
      const inference = await invokeNameInference(base44, sources);
      const scoredCandidates = inference.candidates.map((candidate: any) => ({
        candidate,
        score: scoreBusinessCandidate({
          candidate: cleanIdentityText(candidate?.value, 300),
          sources,
          modelConfidence: Number(candidate?.confidence) || 0
        })
      })).filter((item: any) => item.score.occurrenceCount > 0);
      const distinctCandidates = [...new Set(scoredCandidates.map((item: any) => (
        normalizeBusinessComparable(item.candidate?.value)
      )).filter(Boolean))];
      const deterministicConflictCount = distinctCandidates.length > 1 ? distinctCandidates.length - 1 : 0;
      const conflictCount = inference.conflicts.length + deterministicConflictCount;
      const scored = scoredCandidates.map((item: any) => ({
        ...item,
        score: scoreBusinessCandidate({
          candidate: cleanIdentityText(item.candidate?.value, 300),
          sources,
          modelConfidence: Number(item.candidate?.confidence) || 0,
          conflictCount
        })
      })).sort((a: any, b: any) => b.score.confidence - a.score.confidence)[0];
      if (scored?.score?.confidence > 0) {
        nameCandidate = cleanIdentityText(scored.candidate.value, 300);
        nameConfidence = scored.score.confidence;
        nameEvidence = sanitizeEvidence(scored.score.exactEvidence);
        nameState = meetsBusinessNameThreshold(nameConfidence) ? 'candidate' : 'needs_review';
        nameRawEligible = meetsBusinessNameThreshold(nameConfidence);
      }
    } catch (error) {
      const caught = error as any;
      errors.push(cleanIdentityText(caught?.message, 200) || 'name_provider_error');
      nameState = 'provider_error';
    }
  }

  const confirmedNameForSearch = !storedNameConflict && !isMissingIdentityValue(currentName)
    ? currentName
    : (nameRawEligible ? nameCandidate : '');
  let domainCandidate = currentDomain;
  let domainConfidence = isMissingIdentityValue(currentDomain) ? 0 : 1;
  let domainEvidence: any[] = [];
  let domainState = storedDomainConflict ? 'conflict' : (isMissingIdentityValue(currentDomain) ? 'not_found' : 'existing');
  let searchQuery = '';
  let searchQueryHash = '';
  let searchUrls: string[] = [];
  let officialName = nameCandidate;
  let webDomainConflict = false;

  if (confirmedNameForSearch && primaryLocation && (isMissingIdentityValue(currentDomain) || isMissingIdentityValue(currentName))) {
    searchQuery = `${confirmedNameForSearch} IT Company ${primaryLocation}`;
    try {
      await internalCompanyDirectoryProvider.lookup({ businessName: confirmedNameForSearch, primaryLocation });
      let organicResults: any[] = [];
      if (!isMissingIdentityValue(currentDomain)) {
        organicResults = [{
          position: 1,
          title: '',
          snippet: '',
          link: `https://${currentDomain}/`,
          hostname: currentDomain
        }];
        searchQueryHash = await sha256(`existing-domain:${currentDomain}`);
      } else {
        const search = await fetchOrganicResults(base44, searchQuery);
        searchQueryHash = search.queryHash;
        organicResults = search.results;
      }
      searchUrls = organicResults.map((result) => result.link).slice(0, 5);

      const evaluated = await Promise.all(organicResults.map(async (result) => {
        try {
          const page = await fetchCandidatePage(result.link);
          const score = scoreDomainCandidate({
            businessName: confirmedNameForSearch,
            primaryLocation,
            position: result.position,
            title: `${result.title} ${page.title} ${page.siteName}`,
            snippet: result.snippet,
            pageText: page.text,
            reachable: true,
            sameFinalHostname: normalizeDomain(result.hostname) === page.finalHostname
          });
          return { result, page, score };
        } catch (error) {
          const caught = error as any;
          return {
            result,
            page: null,
            score: scoreDomainCandidate({
              businessName: confirmedNameForSearch,
              primaryLocation,
              position: result.position,
              title: result.title,
              snippet: result.snippet,
              pageText: '',
              reachable: false,
              sameFinalHostname: false
            }),
            error: cleanIdentityText(caught?.message, 200)
          };
        }
      }));
      const ranked = evaluated.sort((a, b) => b.score.confidence - a.score.confidence);
      const eligibleHostnames = [...new Set(ranked
        .filter((item) => meetsDomainThreshold(item.score.confidence))
        .map((item) => normalizeDomain(item.page?.finalHostname || item.result.hostname))
        .filter(Boolean))];
      webDomainConflict = eligibleHostnames.length > 1;
      if (webDomainConflict) errors.push('conflicting_domain_candidates');
      const best = ranked[0];
      if (best) {
        domainCandidate = normalizeDomain(best.page?.finalHostname || best.result.hostname);
        domainConfidence = best.score.confidence;
        domainEvidence = sanitizeEvidence([
          {
            url: best.page?.finalUrl || best.result.link,
            title: best.page?.title || best.result.title,
            excerpt: cleanIdentityText(best.result.snippet || best.page?.text, 240),
            reason: Object.entries(best.score.gates).filter(([, matched]) => matched).map(([gate]) => gate).join(', ')
          }
        ]);
        domainState = meetsDomainThreshold(domainConfidence) && !webDomainConflict ? 'candidate' : 'needs_review';
        if (best.score.gates.nameMatch && best.score.gates.locationMatch && best.score.gates.serviceMatch) {
          officialName = refineOfficialBusinessName({
            businessName: nameCandidate,
            siteName: best.page?.siteName,
            title: best.page?.title || best.result.title
          });
          if (officialName !== nameCandidate) {
            nameEvidence = sanitizeEvidence([
              ...nameEvidence,
              {
                url: best.page?.finalUrl || best.result.link,
                title: best.page?.siteName || best.page?.title || best.result.title,
                reason: 'Official site matched the inferred name, location, and IT services.'
              }
            ]);
          }
        }
      }
    } catch (error) {
      const caught = error as any;
      errors.push(cleanIdentityText(caught?.message, 200) || 'search_provider_error');
      if (isMissingIdentityValue(currentDomain)) domainState = 'provider_error';
    }
  } else if (confirmedNameForSearch && !primaryLocation && isMissingIdentityValue(currentDomain)) {
    errors.push('primary_location_missing');
    domainState = 'needs_review';
  }

  const nameRejected = storedNameConflict ? false : await reviewRejectedCandidate(
    base44, recordType, recordId, fingerprint, 'business_name', officialName
  );
  const domainRejected = storedDomainConflict ? false : await reviewRejectedCandidate(
    base44, recordType, recordId, fingerprint, 'domain', domainCandidate
  );
  const businessNameAutoEligible = !storedNameConflict && (trustedNameNeedsSync || namePayloadNeedsSync || (
    isMissingIdentityValue(currentName)
      && meetsBusinessNameThreshold(nameConfidence)
      && !nameRejected
  ));
  const domainAutoEligible = !storedDomainConflict && (trustedDomainNeedsSync || domainPayloadNeedsSync || (
    isMissingIdentityValue(currentDomain)
      && meetsDomainThreshold(domainConfidence)
      && !webDomainConflict
      && !domainRejected
      && !storedNameConflict
      && (!isMissingIdentityValue(currentName) || businessNameAutoEligible)
  ));
  if (nameRejected) nameState = 'rejected';
  else if (businessNameAutoEligible) nameState = 'auto_eligible';
  if (domainRejected) domainState = 'rejected';
  else if (domainAutoEligible) domainState = 'auto_eligible';
  const providerFailure = errors.some((error) => /(?:provider|timeout|serpapi|quota)/i.test(error));

  const resolution: any = {
    resolver_version: IDENTITY_RESOLVER_VERSION,
    trigger,
    apply_requested: applyRequested,
    scheduled_shadow_mode: trigger === 'scheduled' && !scheduledAutoApplyEnabled,
    payload_fingerprint: fingerprint,
    primary_location: primaryLocation,
    provider: 'serpapi_google',
    future_providers: [{ name: internalCompanyDirectoryProvider.name, configured: false }],
    business_name: {
      current: isMissingIdentityValue(currentName) ? '' : currentName,
      candidate: storedNameConflict ? payloadName : (isMissingIdentityValue(currentName) ? officialName : currentName),
      confidence: nameConfidence,
      threshold: BUSINESS_NAME_THRESHOLD,
      state: nameState,
      auto_eligible: businessNameAutoEligible,
      evidence: nameEvidence
    },
    domain: {
      current: isMissingIdentityValue(currentDomain) ? '' : currentDomain,
      candidate: storedDomainConflict ? payloadDomain : (isMissingIdentityValue(currentDomain) ? domainCandidate : currentDomain),
      confidence: domainConfidence,
      threshold: DOMAIN_THRESHOLD,
      state: domainState,
      auto_eligible: domainAutoEligible,
      evidence: domainEvidence
    },
    search: {
      query: searchQuery,
      query_hash: searchQueryHash,
      organic_urls: searchUrls
    },
    errors
  };

  let attemptStatus = errors.length > 0 && (nameState === 'provider_error' || domainState === 'provider_error')
    ? 'provider_error'
    : ((businessNameAutoEligible || domainAutoEligible) ? 'completed' : 'needs_review');
  const attempt = await base44.asServiceRole.entities.ProFormIdentityResolutionAttempt.create({
    record_type: recordType,
    record_id: recordId,
    session_id: cleanIdentityText(record?.[config.sessionField], 300),
    trigger,
    apply_requested: applyRequested,
    payload_fingerprint: fingerprint,
    resolver_version: IDENTITY_RESOLVER_VERSION,
    status: attemptStatus,
    actor_mode: authorization.actorMode,
    business_name_original: isMissingIdentityValue(currentName) ? '' : currentName,
    business_name_candidate: storedNameConflict ? payloadName : (isMissingIdentityValue(currentName) ? officialName : currentName),
    business_name_confidence: nameConfidence,
    business_name_state: nameState,
    business_name_evidence_json: JSON.stringify(nameEvidence),
    domain_original: isMissingIdentityValue(currentDomain) ? '' : currentDomain,
    domain_candidate: storedDomainConflict ? payloadDomain : (isMissingIdentityValue(currentDomain) ? domainCandidate : currentDomain),
    domain_confidence: domainConfidence,
    domain_state: domainState,
    domain_evidence_json: JSON.stringify(domainEvidence),
    primary_location: primaryLocation,
    search_query: searchQuery,
    search_query_hash: searchQueryHash,
    search_urls_json: JSON.stringify(searchUrls),
    provider: 'serpapi_google',
    errors_json: JSON.stringify(errors),
    applied_fields_json: '[]',
    completed_at: now
  });
  resolution.attempt_id = attempt.id;

  let application = { applied: false, stale: false, fields: [] as string[] };
  const nonDiagnostic = trigger !== 'admin_diagnose';
  const summary = nonDiagnostic ? {
    identity_resolution_status: attemptStatus,
    identity_resolution_latest_attempt_id: attempt.id,
    identity_resolution_fingerprint: fingerprint,
    last_identity_resolution_at: now,
    identity_resolution_attempt_count: (Number(record.identity_resolution_attempt_count) || 0) + 1
  } : {};

  if (effectiveApply && !providerFailure && (businessNameAutoEligible || domainAutoEligible)) {
    application = await updateSourceRecord({
      base44,
      recordType,
      record,
      fingerprint,
      payload,
      businessName: businessNameAutoEligible ? officialName : currentName,
      domain: domainAutoEligible ? domainCandidate : currentDomain,
      summary: { ...summary, identity_resolution_status: 'applied' }
    });
    if (application.stale) attemptStatus = 'stale';
    else if (application.applied) attemptStatus = 'applied';
  } else if (nonDiagnostic && !providerFailure) {
    application = await updateSourceRecord({
      base44,
      recordType,
      record,
      fingerprint,
      payload,
      businessName: currentName,
      domain: currentDomain,
      summary,
      allowIdentityWrites: false
    });
    if (application.stale) attemptStatus = 'stale';
  }

  if (application.applied || application.stale) {
    await base44.asServiceRole.entities.ProFormIdentityResolutionAttempt.update(attempt.id, {
      status: attemptStatus,
      applied_fields_json: JSON.stringify(application.fields)
    });
  }
  resolution.applied = application.applied;
  resolution.applied_fields = application.fields;
  resolution.stale_write_aborted = application.stale;
  resolution.status = attemptStatus;

  console.info('[Identity resolution] completed', {
    recordType,
    recordId,
    trigger,
    status: attemptStatus,
    nameEligible: businessNameAutoEligible,
    domainEligible: domainAutoEligible,
    appliedFields: application.fields,
    errorCodes: errors
  });

  return jsonResponse({ success: true, identityResolution: resolution });
});
