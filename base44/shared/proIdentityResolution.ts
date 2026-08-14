export const IDENTITY_RESOLVER_VERSION = 'pro-identity-v1';
export const BUSINESS_NAME_THRESHOLD = 0.90;
export const DOMAIN_THRESHOLD = 0.92;

const MISSING_IDENTITY_VALUES = new Set([
  '',
  'unknown',
  'null',
  'undefined',
  'n/a',
  'na',
  'none',
  '-',
  '—',
  'unnamed business',
  'unknown business',
  'unknown domain'
]);

const NARRATIVE_PATHS = [
  'userdata.additional_pages_list.why_choose_us_page.why_choose_us_description',
  'userdata.additional_pages_list.meet_the_team_page.team_introduction',
  'userdata.company_description',
  'userdata.differentiation',
  'userdata.sales_process',
  'userdata.client_acquisition',
  'userdata.client_frustrations',
  'userdata.value_description',
  'userdata.ideal_client',
  'userdata.avoided_clients',
  'userdata.additional_notes'
];

const BLOCKED_RESULT_HOSTS = [
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'yelp.com',
  'mapquest.com',
  'yellowpages.com',
  'bbb.org',
  'clutch.co',
  'crunchbase.com',
  'zoominfo.com',
  'glassdoor.com',
  'indeed.com',
  'google.com',
  'bing.com'
];

const IT_SERVICE_PATTERN = /\b(managed\s+it|it\s+services?|information\s+technology|cyber\s*security|technology\s+solutions?|cloud\s+(?:services?|infrastructure)|msp|network\s+support|it\s+support)\b/i;
const PARKED_PAGE_PATTERN = /\b(domain\s+(?:is\s+)?for\s+sale|buy\s+this\s+domain|parked\s+domain|sedo\s+domain|afternic|coming\s+soon\s+domain)\b/i;
const LEGAL_SUFFIX_PATTERN = /\b(?:llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|ltd\.?|limited|lp|llp|pllc)\b/gi;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export const cleanIdentityText = (value: unknown, maxLength = 5000) => (
  typeof value === 'string'
    ? value.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
);

export const isMissingIdentityValue = (value: unknown) => {
  if (typeof value !== 'string') return true;
  return MISSING_IDENTITY_VALUES.has(value.trim().toLowerCase());
};

export const redactNarrative = (value: unknown) => cleanIdentityText(value)
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]')
  .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, '[phone removed]')
  .replace(/\bhttps?:\/\/\S+/gi, '[url removed]');

const getPath = (value: unknown, path: string) => path.split('.').reduce(
  (current: any, part) => current && typeof current === 'object' ? current[part] : undefined,
  value as any
);

export const extractNarrativeSources = (payload: unknown) => NARRATIVE_PATHS
  .map((path) => ({ path, text: redactNarrative(getPath(payload, path)) }))
  .filter(({ text }) => text.length >= 20)
  .map(({ path, text }) => ({ path, text: text.slice(0, 3000) }));

export const selectPrimaryLocation = (payload: any) => {
  const areas = Array.isArray(payload?.userdata?.geographic_areas)
    ? payload.userdata.geographic_areas
    : [];
  const normalized = areas.map((area: any) => area?.geographic_area_meta || area).filter(Boolean);
  const primary = normalized.find((area: any) => area?.primary === true) || normalized[0];
  return cleanIdentityText(primary?.label || primary?.name, 300);
};

export const normalizeBusinessComparable = (value: unknown) => cleanIdentityText(value, 300)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(LEGAL_SUFFIX_PATTERN, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const businessCoreTokens = (value: unknown) => normalizeBusinessComparable(value)
  .split(' ')
  .filter((token) => token.length >= 2 && !['the', 'and', 'company', 'services', 'service', 'solutions', 'group'].includes(token));

const findOccurrences = (text: string, candidate: string) => {
  if (!text || !candidate) return { count: 0, firstIndex: -1 };
  const escaped = cleanIdentityText(candidate, 300)
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[ \\t]+');
  const matches = [...text.matchAll(new RegExp(`\\b${escaped}\\b`, 'gi'))];
  return { count: matches.length, firstIndex: matches[0]?.index ?? -1 };
};

export const scoreBusinessCandidate = ({
  candidate,
  sources,
  modelConfidence = 0,
  conflictCount = 0
}: {
  candidate: string;
  sources: Array<{ path: string; text: string }>;
  modelConfidence?: number;
  conflictCount?: number;
}) => {
  const cleanedCandidate = cleanIdentityText(candidate, 300);
  const comparable = normalizeBusinessComparable(cleanedCandidate);
  const tokens = businessCoreTokens(cleanedCandidate);
  if (!cleanedCandidate || comparable.length < 3 || tokens.length < 1) {
    return { confidence: 0, occurrenceCount: 0, supportingPaths: [], exactEvidence: [] };
  }

  const exactEvidence = (Array.isArray(sources) ? sources : []).flatMap((source) => {
    const occurrence = findOccurrences(source.text, cleanedCandidate);
    if (occurrence.count === 0) return [];
    const excerptStart = Math.max(0, occurrence.firstIndex - 80);
    return [{
      path: source.path,
      excerpt: source.text.slice(excerptStart, excerptStart + 240),
      count: occurrence.count
    }];
  });
  const occurrenceCount = exactEvidence.reduce((total, evidence) => total + evidence.count, 0);
  const supportingPaths = [...new Set(exactEvidence.map((evidence) => evidence.path))];
  if (occurrenceCount === 0) {
    return { confidence: 0, occurrenceCount, supportingPaths, exactEvidence };
  }

  let score = 0.70;
  if (occurrenceCount >= 2) score += 0.10;
  if (occurrenceCount >= 3) score += 0.05;
  if (supportingPaths.length >= 2) score += 0.05;
  if (tokens.length >= 2) score += 0.05;
  if (Number(modelConfidence) >= 0.90) score += 0.05;
  if (conflictCount > 0) score = Math.min(score, 0.70);
  if (tokens.length === 1) score = Math.min(score, 0.85);

  return {
    confidence: Number(clamp(score).toFixed(3)),
    occurrenceCount,
    supportingPaths,
    exactEvidence
  };
};

export const normalizeDomain = (value: unknown) => {
  const input = cleanIdentityText(value, 500).toLowerCase();
  if (isMissingIdentityValue(input)) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return url.hostname.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return '';
  }
};

const isPrivateIpv4 = (hostname: string) => {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] === 0;
};

const isPrivateIpv6 = (hostnameValue: string) => {
  const hostname = hostnameValue.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return hostname === '::'
    || hostname === '::1'
    || hostname.startsWith('fc')
    || hostname.startsWith('fd')
    || /^fe[89ab]/.test(hostname)
    || hostname.startsWith('2001:db8:')
    || hostname.startsWith('::ffff:10.')
    || hostname.startsWith('::ffff:127.')
    || hostname.startsWith('::ffff:169.254.')
    || /^::ffff:172\.(?:1[6-9]|2\d|3[01])\./.test(hostname)
    || hostname.startsWith('::ffff:192.168.');
};

export const isPrivateNetworkAddress = (addressValue: unknown) => {
  const address = cleanIdentityText(addressValue, 300).toLowerCase();
  return isPrivateIpv4(address) || isPrivateIpv6(address);
};

export const isBlockedSearchHostname = (hostnameValue: unknown) => {
  const hostname = cleanIdentityText(hostnameValue, 300).toLowerCase().replace(/^www\./, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;
  if (hostname.includes(':') || isPrivateNetworkAddress(hostname)) return true;
  return BLOCKED_RESULT_HOSTS.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
};

export const filterOrganicResults = (response: any) => {
  const results = Array.isArray(response?.organic_results) ? response.organic_results : [];
  return results.flatMap((result: any, index: number) => {
    const link = cleanIdentityText(result?.link, 1000);
    try {
      const url = new URL(link);
      if (!['http:', 'https:'].includes(url.protocol) || isBlockedSearchHostname(url.hostname)) return [];
      return [{
        position: Number(result?.position) || index + 1,
        title: cleanIdentityText(result?.title, 500),
        snippet: cleanIdentityText(result?.snippet, 1000),
        link: url.toString(),
        hostname: normalizeDomain(url.hostname)
      }];
    } catch {
      return [];
    }
  }).slice(0, 5);
};

const locationTokens = (location: string) => cleanIdentityText(location, 300)
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((token) => token.length >= 2 && !['usa', 'united', 'states', 'greater', 'area'].includes(token));

export const scoreDomainCandidate = ({
  businessName,
  primaryLocation,
  position,
  title = '',
  snippet = '',
  pageText = '',
  reachable = false,
  sameFinalHostname = false
}: any) => {
  const combined = cleanIdentityText(`${title} ${snippet} ${pageText}`, 60000).toLowerCase();
  const businessTokens = businessCoreTokens(businessName);
  const matchedBusinessTokens = businessTokens.filter((token) => combined.includes(token));
  const nameMatch = businessTokens.length > 0 && matchedBusinessTokens.length === businessTokens.length;
  const locTokens = locationTokens(primaryLocation);
  const matchedLocationTokens = locTokens.filter((token) => combined.includes(token));
  const locationMatch = locTokens.length > 0 && matchedLocationTokens.length >= Math.min(2, locTokens.length);
  const serviceMatch = IT_SERVICE_PATTERN.test(combined);
  const parked = PARKED_PAGE_PATTERN.test(combined);

  if (parked) {
    return {
      confidence: 0,
      gates: { nameMatch, locationMatch, serviceMatch, reachable, sameFinalHostname, parked: true },
      matchedBusinessTokens,
      matchedLocationTokens
    };
  }

  let score = 0;
  if (nameMatch) score += 0.40;
  if (locationMatch) score += 0.25;
  if (serviceMatch) score += 0.15;
  if (Number(position) === 1) score += 0.08;
  else if (Number(position) === 2) score += 0.06;
  else score += 0.04;
  if (reachable) score += 0.07;
  if (sameFinalHostname) score += 0.05;

  return {
    confidence: Number(clamp(score).toFixed(3)),
    gates: { nameMatch, locationMatch, serviceMatch, reachable, sameFinalHostname, parked: false },
    matchedBusinessTokens,
    matchedLocationTokens
  };
};

export const meetsBusinessNameThreshold = (confidence: unknown) => (
  Number(confidence) >= BUSINESS_NAME_THRESHOLD
);

export const meetsDomainThreshold = (confidence: unknown) => (
  Number(confidence) >= DOMAIN_THRESHOLD
);

const titleHead = (value: unknown) => cleanIdentityText(value, 300).split(/\s+[|:–—-]\s+/)[0].trim();

export const refineOfficialBusinessName = ({ businessName, siteName, title }: any) => {
  const original = cleanIdentityText(businessName, 300);
  const originalTokens = businessCoreTokens(original);
  for (const candidate of [cleanIdentityText(siteName, 300), titleHead(title)]) {
    if (!candidate || candidate.length > 120 || IT_SERVICE_PATTERN.test(candidate)) continue;
    const comparable = normalizeBusinessComparable(candidate);
    if (originalTokens.length > 0 && originalTokens.every((token) => comparable.includes(token))) {
      return candidate;
    }
  }
  return original;
};

const stableSortValue = (value: any): any => {
  if (Array.isArray(value)) return value.map(stableSortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((output: any, key) => {
      output[key] = stableSortValue(value[key]);
      return output;
    }, {});
  }
  return value;
};

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)]
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

export const sha256 = async (value: unknown) => toHex(await crypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(stableSortValue(value)))
));

export const computeIdentityFingerprint = async ({ recordType, businessName, domain, payload }: any) => sha256({
  resolverVersion: IDENTITY_RESOLVER_VERSION,
  recordType,
  businessName: cleanIdentityText(businessName, 300),
  domain: cleanIdentityText(domain, 500),
  payload: stableSortValue(payload || {})
});

export const centralTimeParts = (date: Date) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
);

export const centralDateKey = (date: Date) => {
  const parts: any = centralTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const isCentralFourAmWeekday = (date: Date) => {
  const parts: any = centralTimeParts(date);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday)
    && parts.hour === '04'
    && Number(parts.minute) < 15;
};
