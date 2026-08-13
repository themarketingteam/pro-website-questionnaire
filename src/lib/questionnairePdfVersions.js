import { SERVICE_OPTIONS_GROUPED } from '@/components/pro-form/questionData';
import { normalizeServiceSelectionsForPayload } from '@/lib/serviceSelectionModel';

const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const asObject = (value) => isPlainObject(value) ? value : {};
const asArray = (value) => Array.isArray(value) ? value : [];
const asString = (value) => typeof value === 'string' ? value.trim() : '';

const parseJsonObject = (value) => {
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const yesNo = (condition) => condition ? 'yes' : 'no';

export const questionnaireResponsesFromSubmissionPayload = (payload) => {
  const safePayload = asObject(payload);
  const userdata = asObject(safePayload.userdata);
  const additionalPages = asObject(userdata.additional_pages_list);
  const whyChooseUs = asObject(additionalPages.why_choose_us_page);
  const meetTheTeam = asObject(additionalPages.meet_the_team_page);
  const teamPhoto = asObject(meetTheTeam.team_photo_with_tags);
  const locations = asArray(userdata.geographic_areas);
  const certifications = asArray(userdata.certifications_partnerships);
  const guarantees = asArray(userdata.service_guarantee_items);
  const avoidedClients = asString(userdata.avoided_clients);
  const additionalNotes = asString(userdata.additional_notes);

  const primaryLocationIndex = locations.findIndex((location) => (
    asObject(asObject(location).geographic_area_meta).primary === true
      || asObject(location).primary === true
  ));

  return {
    '1': yesNo(whyChooseUs.generate_page === true),
    '1.1': asString(whyChooseUs.why_choose_us_description),
    '2': yesNo(meetTheTeam.generate_page === true),
    '2.1': asString(meetTheTeam.team_introduction),
    '2.2': teamPhoto,
    '3': normalizeServiceSelectionsForPayload(
      asArray(userdata.service_offerings),
      SERVICE_OPTIONS_GROUPED
    ),
    '3_other': asString(userdata.service_offerings_other),
    '4': asArray(userdata.target_industries),
    '4_other': asString(userdata.target_industries_other),
    '5': locations,
    '5_primary': primaryLocationIndex >= 0 ? primaryLocationIndex : 0,
    '6': asString(userdata.company_description),
    '7': asString(userdata.delivery_model),
    '7_other': asString(userdata.delivery_model_other),
    '8': asArray(userdata.pricing_packaging),
    '8_other': asString(userdata.pricing_packaging_other),
    '9': asString(userdata.differentiation),
    '10': asArray(userdata.company_goals),
    '10_other': asString(userdata.company_goals_other),
    '11': asString(userdata.brand_tone),
    '11_other': asString(userdata.brand_tone_other),
    '12': yesNo(certifications.length > 0),
    '12.1': certifications,
    '13': asString(userdata.sales_process),
    '14': yesNo(userdata.service_guarantee === true || guarantees.length > 0),
    '14.1': guarantees,
    '15': asString(userdata.client_acquisition),
    '15_other': asString(userdata.client_acquisition_other),
    '16': asArray(userdata.website_objectives),
    '16_other': asString(userdata.website_objectives_other),
    '17': asString(userdata.client_size),
    '18': asArray(userdata.client_challenges),
    '18_other': asString(userdata.client_challenges_other),
    '19': asString(userdata.client_frustrations),
    '20': asArray(userdata.client_outcomes),
    '20_other': asString(userdata.client_outcomes_other),
    '21': asString(userdata.value_description),
    '22': asString(userdata.ideal_client),
    '23': yesNo(Boolean(avoidedClients)),
    '23.1': avoidedClients,
    '24': asString(userdata.primary_cta),
    '24_other': asString(userdata.primary_cta_other),
    '25': yesNo(Boolean(additionalNotes)),
    '25.1': additionalNotes
  };
};

export const getDraftPdfPayload = (draft, computedPayload = null) => (
  parseJsonObject(draft?.mapped_payload_json)
  || parseJsonObject(draft?.ai_repaired_payload_json)
  || computedPayload
  || null
);

export const getIntakePdfPayload = (intake) => {
  if (intake?.ai_repair_applied) {
    const repairedPayload = parseJsonObject(intake.ai_repaired_payload_json);
    if (repairedPayload) return repairedPayload;
  }

  return parseJsonObject(intake?.transformed_payload_json)
    || parseJsonObject(intake?.ai_repaired_payload_json)
    || null;
};

export const buildQuestionnairePdfSnapshot = ({
  payload,
  fallbackResponses,
  businessName,
  domain,
  submissionDate
} = {}) => {
  const safePayload = asObject(payload);
  const metadata = asObject(safePayload.metadata);
  const hasSubmissionPayload = isPlainObject(safePayload.userdata);
  const formData = hasSubmissionPayload
    ? questionnaireResponsesFromSubmissionPayload(safePayload)
    : asObject(fallbackResponses);

  return {
    formData,
    businessName: asString(metadata.business_name) || asString(businessName),
    domain: asString(metadata.businessDomain) || asString(domain),
    submissionDate: asString(metadata.submission_datetime) || asString(submissionDate)
  };
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
};

export const stableQuestionnairePdfSnapshot = (snapshot) => (
  JSON.stringify(stableValue(snapshot))
);

export const hashQuestionnairePdfSnapshot = async (snapshot) => {
  const bytes = new TextEncoder().encode(stableQuestionnairePdfSnapshot(snapshot));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};
