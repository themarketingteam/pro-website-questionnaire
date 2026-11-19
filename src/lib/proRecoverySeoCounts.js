import { countPageSelections, getPageCatalogId, validatePageStructure } from '@/lib/pageOrganizerModel';
import { countSelectedServiceChildren } from '@/lib/serviceSelectionModel';
import { serializeStoredPageStructure } from '../../base44/shared/pageOrganizerContract.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unknown = () => ({ services: null, industries: null, locations: null, total: null });
const readObject = value => {
  if (value == null || value === '') return { value: null, invalid: false };
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return { value: object(parsed) ? parsed : null, invalid: !object(parsed) }; }
  catch { return { value: null, invalid: true }; }
};
const validSelection = value => typeof value === 'string' || (object(value) && ['label', 'value', 'name', 'title'].some(key => typeof value[key] === 'string'));
const validSelections = value => Array.isArray(value) && value.every(validSelection);
const otherCount = value => {
  if (value == null) return 0;
  if (typeof value === 'string') return value.trim() ? 1 : 0;
  if (Array.isArray(value) && value.every(entry => typeof entry === 'string')) return value.filter(entry => entry.trim()).length;
  return null;
};
const listCount = (values, other, id, groups) => {
  if (values != null && !validSelections(values) && !(id === '3' && validSelection(values))) return null;
  const custom = otherCount(other);
  if (custom == null) return null;
  return (id === '3' ? countSelectedServiceChildren(values || [], groups) : (values || []).length) + custom;
};
const rawCount = (responses, id, groups) => {
  if (own(responses, `${id}_structure`)) {
    const structure = responses[`${id}_structure`];
    return validatePageStructure(structure).ok ? countPageSelections(structure, id, groups) : null;
  }
  return listCount(responses[id], responses[`${id}_other`], id, groups);
};
const mappedTreeCount = (structure, id, groups) => {
  // Rich snapshots retain catalog identity after a page moves or is renamed.
  if (validatePageStructure(structure).ok) return countPageSelections(structure, id, groups);
  try {
    const compact = serializeStoredPageStructure(structure);
    const makeNode = (node, path) => ({
      id: `recovery-q${id}-${path}`, label: node.label, source: node.source,
      catalogId: node.source === 'predefined' ? getPageCatalogId(id, node.label, id === '3' && own(groups, node.label) ? 'parent' : 'option') : null,
      children: (node.children || []).map((child, index) => makeNode(child, `${path}-${index}`))
    });
    return countPageSelections({ format: compact.format, pages: compact.pages.map((node, index) => makeNode(node, String(index))) }, id, groups);
  } catch { return null; }
};
const mappedCount = (userdata, id, groups) => {
  if (!object(userdata)) return null;
  const field = id === '3' ? 'service_offerings' : 'target_industries';
  if (userdata[`${field}_structure`] != null) return mappedTreeCount(userdata[`${field}_structure`], id, groups);
  const values = userdata[field], other = userdata[`${field}_other`];
  // A DTO can synthesize [] and null for wholly absent fields. Explicit empty
  // Other values distinguish a known zero from that otherwise absent category.
  if ((!Array.isArray(values) || values.length === 0) && other == null) return null;
  return listCount(values, other, id, groups);
};
const mappedLocationCount = userdata => {
  const areas = userdata?.geographic_areas;
  if (!Array.isArray(areas) || areas.length === 0) return null;
  return areas.every(area => typeof area === 'string' ? Boolean(area.trim()) : object(area) && (
    typeof area.geographic_area_meta?.name === 'string' && Boolean(area.geographic_area_meta.name.trim())
    || typeof area.geographic_area_meta?.label === 'string' && Boolean(area.geographic_area_meta.label.trim())
    || typeof area.label === 'string' && Boolean(area.label.trim())
    || typeof area.name === 'string' && Boolean(area.name.trim())
  )) ? areas.length : null;
};

/** Read-only counts from one authoritative raw map or its own mapped receipt.
 * @param {{ responses?: any, payload?: any }} [source]
 * @param {Record<string, string[]>} [groupedOptions]
 */
export function countProRecoverySeoAnswers({ responses, payload } = {}, groupedOptions = {}) {
  const raw = readObject(responses), mapped = readObject(payload);
  if (raw.invalid) return unknown();
  const userdata = mapped.invalid ? null : mapped.value?.userdata;
  const result = {
    services: raw.value ? rawCount(raw.value, '3', groupedOptions) : mappedCount(userdata, '3', groupedOptions),
    industries: raw.value ? rawCount(raw.value, '4', groupedOptions) : mappedCount(userdata, '4', groupedOptions),
    locations: raw.value ? (raw.value['5'] == null ? 0 : Array.isArray(raw.value['5']) ? raw.value['5'].length : null) : mappedLocationCount(userdata),
    total: null
  };
  if ([result.services, result.industries, result.locations].every(Number.isInteger)) result.total = result.services + result.industries + result.locations;
  return result;
}

/** Selected history never borrows current-draft data; receipts omit raw maps.
 * @param {{ selectedVersion?: any, draft?: any }} [source]
 * @param {Record<string, string[]>} [groupedOptions]
 */
export function proRecoverySeoCountsForVersion({ selectedVersion, draft } = {}, groupedOptions = {}) {
  if (selectedVersion != null) {
    let responses = selectedVersion.snapshot?.responses;
    if (selectedVersion.sourceType === 'submission' && object(responses) && Object.keys(responses).length === 0) responses = undefined;
    return countProRecoverySeoAnswers({ responses, payload: selectedVersion.payload ?? selectedVersion.snapshot?.mappedPayload }, groupedOptions);
  }
  return countProRecoverySeoAnswers({ responses: draft?.responses_json, payload: draft?.mapped_payload_json }, groupedOptions);
}
