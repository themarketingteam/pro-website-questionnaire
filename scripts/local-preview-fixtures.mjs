import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
export const loadCatalog = (root) => {
  const catalog = fs.readFileSync(path.join(root, 'base44/shared/proServiceCatalog.js'), 'utf8').replaceAll('export const', 'const');
  const source = fs.readFileSync(path.join(root, 'src/components/pro-form/questionData.jsx'), 'utf8').split('export const QUESTIONS')[0].replace(/^import .*;$/gm, '').replace(/^export \{.*\};$/gm, '').replaceAll('export const', 'const');
  return vm.runInNewContext(catalog + '\n' + source + '\n;({ services: SERVICE_OPTIONS_GROUPED, industries: INDUSTRY_OPTIONS, legacyIndustries: LEGACY_INDUSTRY_OPTIONS })');
};
export const loadScoutFixture = (root) => {
  const payload = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/scout-networks-legacy.json'), 'utf8'));
  const data = payload.userdata;
  const responses = { '1': 'no', '2': 'no', '12': 'yes', '14': 'no', '23': 'no', '25': 'no' };
  const fields = {
    '3': 'service_offerings', '4': 'target_industries', '6': 'company_description', '7': 'delivery_model',
    '8': 'pricing_packaging', '9': 'differentiation', '10': 'company_goals', '11': 'brand_tone', '13': 'sales_process',
    '15': 'client_acquisition', '16': 'website_objectives', '17': 'client_size', '18': 'client_challenges',
    '19': 'client_frustrations', '20': 'client_outcomes', '21': 'value_description', '22': 'ideal_client', '24': 'primary_cta'
  };
  for (const [id, field] of Object.entries(fields)) {
    responses[id] = data[field];
    if (data[`${field}_other`]) responses[`${id}_other`] = data[`${field}_other`];
  }
  responses['5'] = data.geographic_areas.map(({ geographic_area_meta: area }) => ({ name: area.name, label: area.label, source: area.source, place_id: area.place_id, latitude: area.lat, longitude: area.lon }));
  responses['5_primary'] = 0;
  // The local fixture retains names/types but never fetches hosted attachments.
  responses['12.1'] = data.certifications_partnerships.map((item) => ({ name: item.cert_item_name, type: item.cert_item_type, saved: true }));
  return { responses, credentials: { businessName: payload.metadata.business_name, domain: payload.metadata.businessDomain }, mappedPayload: payload };
};
