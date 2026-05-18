import {
  asArray,
  asPlainObject,
  asSafeFileList,
  asTrimmedString,
  normalizeAdditionalPagesList,
  normalizeGeographicAreas,
  normalizeIndustrySelections,
  normalizeQuestionnaireResponses,
  normalizeServiceSelections,
  normalizeStringSelectionList,
  normalizeTeamPhotoWithTags
} from '@/lib/proResponseNormalizers';

export const serializeError = (error) => ({
  name: error?.name,
  message: error?.message,
  status: error?.status || error?.response?.status,
  data: error?.response?.data,
  stack: import.meta.env.DEV ? error?.stack : undefined
});


export const normalizeGeographicAreasForPayload = (locations = [], primaryIndex = 0) =>
  normalizeGeographicAreas(locations)
    .map((location, index) => {
      const safeLocation = asPlainObject(location);

      return {
        geographic_area_meta: {
          name: asTrimmedString(safeLocation.name || safeLocation.label || safeLocation.city),
          label: asTrimmedString(safeLocation.label || safeLocation.name || safeLocation.city),
          lat: safeLocation.latitude != null ? String(safeLocation.latitude) : '',
          lon: safeLocation.longitude != null ? String(safeLocation.longitude) : '',
          place_id: asTrimmedString(safeLocation.place_id || safeLocation.placeId),
          source: asTrimmedString(safeLocation.source) || 'manual',
          primary: index === Number(primaryIndex || 0)
        }
      };
    })
    .filter(
      (item) =>
        item.geographic_area_meta.name ||
        item.geographic_area_meta.label
    );

export const normalizeCertifications = (items = []) =>
  asArray(items)
    .map((item) => {
      const safeItem = asPlainObject(item);

      const itemName = asTrimmedString(
        safeItem.name ||
        safeItem.label ||
        safeItem.cert_item_name
      );

      const itemType = asTrimmedString(
        safeItem.type ||
        safeItem.category ||
        safeItem.tag ||
        safeItem.cert_item_type
      );

      if (!itemName || !itemType) return null;

      const image = asPlainObject(safeItem.image);
      const primaryFile = asPlainObject(safeItem.file);
      const files = asSafeFileList(safeItem.files || safeItem.supporting_files || safeItem.cert_item_files);

      return {
        cert_item_name: itemName,
        cert_item_type: itemType,
        cert_item_image_url: asTrimmedString(
          safeItem.imageUrl ||
          safeItem.image_url ||
          safeItem.cert_item_image_url ||
          image.url ||
          image.file_url ||
          image.image_url
        ),
        cert_item_image_name: asTrimmedString(
          safeItem.imageName ||
          safeItem.image_name ||
          safeItem.cert_item_image_name ||
          image.name ||
          image.fileName ||
          image.filename
        ),
        cert_item_file_url: asTrimmedString(
          safeItem.fileUrl ||
          safeItem.file_url ||
          safeItem.url ||
          safeItem.cert_item_file_url ||
          primaryFile.url ||
          primaryFile.file_url
        ),
        cert_item_file_name: asTrimmedString(
          safeItem.fileName ||
          safeItem.file_name ||
          safeItem.name ||
          safeItem.cert_item_file_name ||
          primaryFile.name ||
          primaryFile.fileName ||
          primaryFile.filename
        ),
        cert_item_files: files
      };
    })
    .filter(Boolean);

export const normalizeTeamPhoto = (answer) => normalizeTeamPhotoWithTags(answer);

export const normalizeGuarantees = (items = []) =>
  asArray(items)
    .map((item) => {
      const safeItem = asPlainObject(item);
      const file = asPlainObject(safeItem.file);

      const guaranteeName = asTrimmedString(
        safeItem.name ||
        safeItem.label ||
        safeItem.guarantee_name
      );

      const guaranteeType = asTrimmedString(
        safeItem.type ||
        safeItem.category ||
        safeItem.tag ||
        safeItem.guarantee_type
      );

      const guaranteeFileUrl = asTrimmedString(
        safeItem.fileUrl ||
        safeItem.file_url ||
        safeItem.url ||
        safeItem.guarantee_file_url ||
        file.url ||
        file.file_url
      );

      const guaranteeFileName = asTrimmedString(
        safeItem.fileName ||
        safeItem.file_name ||
        safeItem.filename ||
        safeItem.guarantee_file_name ||
        file.name ||
        file.fileName ||
        file.filename
      );

      const guaranteeDescription = asTrimmedString(
        safeItem.description ||
        safeItem.guarantee_description
      );

      if (!guaranteeName || !guaranteeType || (!guaranteeFileUrl && !guaranteeDescription)) {
        return null;
      }

      return {
        guarantee_name: guaranteeName,
        guarantee_type: guaranteeType,
        guarantee_file_url: guaranteeFileUrl,
        guarantee_file_name: guaranteeFileName,
        guarantee_description: guaranteeDescription
      };
    })
    .filter(Boolean);

export const transformResponsesToPayload = (
  responses,
  businessName,
  domain,
  serviceOptionsGrouped = {}
) => {
  const normalizedResponses = normalizeQuestionnaireResponses(responses);
  const serviceSelections = normalizeServiceSelections(normalizedResponses['3'], serviceOptionsGrouped);
  const serviceOfferingsOther = normalizeStringSelectionList(normalizedResponses['3_other']).join(', ');
  const targetIndustriesOther = normalizeStringSelectionList(normalizedResponses['4_other']).join(', ');
  const clientChallengesOther = normalizeStringSelectionList(normalizedResponses['18_other']).join(', ');
  const clientOutcomesOther = normalizeStringSelectionList(normalizedResponses['20_other']).join(', ');

  const geographicAreas = normalizeGeographicAreasForPayload(
    normalizedResponses['5'] || [],
    normalizedResponses['5_primary'] || 0
  );

  const certificationsPartnerships = normalizedResponses['12'] === 'yes'
    ? normalizeCertifications(normalizedResponses['12.1'] || [])
    : [];

  const teamPhoto = normalizedResponses['2'] === 'yes'
    ? normalizeTeamPhoto(normalizedResponses['2.2'])
    : normalizeTeamPhotoWithTags({ has_team_photo: false });

  const serviceGuaranteeItems = normalizedResponses['14'] === 'yes'
    ? normalizeGuarantees(normalizedResponses['14.1'] || [])
    : [];

  const additionalPagesList = normalizeAdditionalPagesList({
    why_choose_us_page: {
      generate_page: normalizedResponses['1'] === 'yes',
      why_choose_us_description: normalizedResponses['1'] === 'yes' ? asTrimmedString(normalizedResponses['1.1']) : ''
    },
    meet_the_team_page: {
      generate_page: normalizedResponses['2'] === 'yes',
      team_introduction: normalizedResponses['2'] === 'yes' ? asTrimmedString(normalizedResponses['2.1']) : '',
      team_photo_with_tags: teamPhoto
    }
  });

  return {
    metadata: {
      business_name: businessName,
      businessDomain: domain,
      submission_datetime: new Date().toISOString(),
      service_type: 'pro'
    },
    userdata: {
      additional_pages_list: additionalPagesList,
      service_offerings: serviceSelections,
      service_offerings_other: serviceOfferingsOther,
      target_industries: normalizeIndustrySelections(normalizedResponses['4']),
      target_industries_other: targetIndustriesOther,
      geographic_areas: geographicAreas,
      company_description: asTrimmedString(normalizedResponses['6']),
      delivery_model: asTrimmedString(normalizedResponses['7']),
      delivery_model_other: asTrimmedString(normalizedResponses['7_other']),
      pricing_packaging: normalizeStringSelectionList(normalizedResponses['8']),
      pricing_packaging_other: asTrimmedString(normalizedResponses['8_other']),
      differentiation: asTrimmedString(normalizedResponses['9']),
      company_goals: normalizeStringSelectionList(normalizedResponses['10']),
      company_goals_other: asTrimmedString(normalizedResponses['10_other']),
      brand_tone: asTrimmedString(normalizedResponses['11']),
      brand_tone_other: asTrimmedString(normalizedResponses['11_other']),
      certifications_partnerships: certificationsPartnerships,
      sales_process: asTrimmedString(normalizedResponses['13']),
      service_guarantee: normalizedResponses['14'] === 'yes',
      service_guarantee_items: serviceGuaranteeItems,
      client_acquisition: asTrimmedString(normalizedResponses['15']),
      client_acquisition_other: asTrimmedString(normalizedResponses['15_other']),
      website_objectives: normalizeStringSelectionList(normalizedResponses['16']),
      website_objectives_other: asTrimmedString(normalizedResponses['16_other']),
      client_size: asTrimmedString(normalizedResponses['17']),
      client_challenges: normalizeStringSelectionList(normalizedResponses['18']),
      client_challenges_other: clientChallengesOther,
      client_frustrations: asTrimmedString(normalizedResponses['19']),
      client_outcomes: normalizeStringSelectionList(normalizedResponses['20']),
      client_outcomes_other: clientOutcomesOther,
      value_description: asTrimmedString(normalizedResponses['21']),
      ideal_client: asTrimmedString(normalizedResponses['22']),
      avoided_clients: normalizedResponses['23'] === 'yes' ? asTrimmedString(normalizedResponses['23.1']) : '',
      primary_cta: asTrimmedString(normalizedResponses['24']),
      primary_cta_other: asTrimmedString(normalizedResponses['24_other']),
      additional_notes: normalizedResponses['25'] === 'yes' ? asTrimmedString(normalizedResponses['25.1']) : ''
    }
  };
};

export const validateSubmissionPayload = (payload) => {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    errors.push('Payload must be an object.');
    return { ok: false, errors };
  }

  if (!payload.metadata || typeof payload.metadata !== 'object') {
    errors.push('metadata must be an object.');
  }

  if (!payload.userdata || typeof payload.userdata !== 'object') {
    errors.push('userdata must be an object.');
  }

  if (!payload.metadata?.business_name?.trim()) {
    errors.push('metadata.business_name is required.');
  }

  if (!payload.metadata?.businessDomain?.trim()) {
    errors.push('metadata.businessDomain is required.');
  }

  const arrayFields = [
    'service_offerings',
    'target_industries',
    'geographic_areas',
    'pricing_packaging',
    'company_goals',
    'certifications_partnerships',
    'service_guarantee_items',
    'website_objectives',
    'client_challenges',
    'client_outcomes'
  ];

  if (!payload.userdata?.additional_pages_list || typeof payload.userdata.additional_pages_list !== 'object') {
    errors.push('userdata.additional_pages_list must be an object.');
  }

  for (const field of arrayFields) {
    if (!Array.isArray(payload.userdata?.[field])) {
      errors.push(`userdata.${field} must be an array.`);
    }
  }

  const teamPhoto = payload.userdata?.additional_pages_list?.meet_the_team_page?.team_photo_with_tags;
  if (!teamPhoto || typeof teamPhoto !== 'object') {
    errors.push('userdata.additional_pages_list.meet_the_team_page.team_photo_with_tags must be an object.');
  }

  return { ok: errors.length === 0, errors };
};