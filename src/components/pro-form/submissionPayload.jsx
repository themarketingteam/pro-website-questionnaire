import {
  asPlainObject,
  asSafeFileList,
  asStringArray,
  asTrimmedString,
  normalizeQuestionnaireResponses
} from '@/lib/proResponseNormalizers';

export const serializeError = (error) => ({
  name: error?.name,
  message: error?.message,
  status: error?.status || error?.response?.status,
  data: error?.response?.data,
  stack: import.meta.env.DEV ? error?.stack : undefined
});


const asCoordinateString = (value) => {
  if (value == null || value === '') return '';

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '';
  }

  return String(number);
};

export const normalizeGeographicAreas = (locations = [], primaryIndex = 0) =>
  locations
    .filter(Boolean)
    .map((location, index) => {
      const isString = typeof location === 'string';
      const safeLocation = isString ? {} : asPlainObject(location);

      const name = isString
        ? location
        : safeLocation.name || safeLocation.label || '';

      return {
        geographic_area_meta: {
          name: asTrimmedString(name),
          label: asTrimmedString(
            isString ? location : safeLocation.label || safeLocation.name || ''
          ),
          lat: isString ? '' : asCoordinateString(safeLocation.lat),
          lon: isString ? '' : asCoordinateString(safeLocation.lon),
          place_id: isString ? '' : asTrimmedString(safeLocation.place_id),
          source: isString ? 'manual' : asTrimmedString(safeLocation.source) || 'google',
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
  items
    .map((item) => {
      const safeItem = asPlainObject(item);
      const itemName = asTrimmedString(safeItem.name || safeItem.label);
      const itemType = asTrimmedString(safeItem.type || safeItem.category);
      if (!itemName || !itemType) return null;

      const image = asPlainObject(safeItem.image);
      return {
        cert_item_name: itemName,
        cert_item_type: itemType,
        cert_item_image_url: asTrimmedString(safeItem.imageUrl || image.url),
        cert_item_image_name: asTrimmedString(image.name),
        cert_item_files: asSafeFileList(safeItem.files)
      };
    })
    .filter(Boolean);

export const normalizeTeamPhoto = (answer) => {
  const safeAnswer = asPlainObject(answer);

  if (!safeAnswer.url && !safeAnswer.imageUrl) {
    return {
      imageUrl: '',
      imageName: '',
      taggedPeople: []
    };
  }

  return {
    imageUrl: asTrimmedString(safeAnswer.url || safeAnswer.imageUrl),
    imageName: asTrimmedString(safeAnswer.name || safeAnswer.fileName || safeAnswer.filename),
    taggedPeople: (Array.isArray(safeAnswer.tags) ? safeAnswer.tags : [])
      .map((tag) => {
        const safeTag = asPlainObject(tag);
        const person = asPlainObject(safeTag.person);
        const name = asTrimmedString(person.name || person.label);
        if (!name) return null;
        return {
          name,
          position: asTrimmedString(person.position || person.title),
          bio: asTrimmedString(person.bio || person.description),
          x: Number.isFinite(Number(safeTag.x)) ? Number(safeTag.x) : 0,
          y: Number.isFinite(Number(safeTag.y)) ? Number(safeTag.y) : 0
        };
      })
      .filter(Boolean)
  };
};

export const normalizeGuarantees = (items = []) =>
  items
    .map((item) => {
      const safeItem = asPlainObject(item);
      const guaranteeName = asTrimmedString(safeItem.name || safeItem.label);
      const guaranteeType = asTrimmedString(safeItem.type || safeItem.category);
      const file = asPlainObject(safeItem.file);
      const guaranteeFileUrl = asTrimmedString(safeItem.fileUrl || file.url);
      const guaranteeDescription = asTrimmedString(safeItem.description);

      if (!guaranteeName || !guaranteeType || (!guaranteeFileUrl && !guaranteeDescription)) {
        return null;
      }

      return {
        guarantee_name: guaranteeName,
        guarantee_type: guaranteeType,
        guarantee_file_url: guaranteeFileUrl,
        guarantee_file_name: asTrimmedString(file.name),
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
  const serviceSelections = asStringArray(normalizedResponses['3']);
  const serviceOfferingsOther = asStringArray(normalizedResponses['3_other']).join(', ');
  const targetIndustriesOther = asStringArray(normalizedResponses['4_other']).join(', ');
  const clientChallengesOther = asStringArray(normalizedResponses['18_other']).join(', ');
  const clientOutcomesOther = asStringArray(normalizedResponses['20_other']).join(', ');

  const geographicAreas = normalizeGeographicAreas(
    normalizedResponses['5'] || [],
    normalizedResponses['5_primary'] || 0
  );

  const certificationsPartnerships = normalizedResponses['12'] === 'yes'
    ? normalizeCertifications(normalizedResponses['12.1'] || [])
    : [];

  const teamPhoto = normalizedResponses['2'] === 'yes'
    ? normalizeTeamPhoto(normalizedResponses['2.2'])
    : { imageUrl: '', imageName: '', taggedPeople: [] };

  const serviceGuaranteeItems = normalizedResponses['14'] === 'yes'
    ? normalizeGuarantees(normalizedResponses['14.1'] || [])
    : [];

  const additionalPagesList = {
    why_choose_us_page: {
      generate_page: normalizedResponses['1'] === 'yes',
      why_choose_us_description: normalizedResponses['1'] === 'yes' ? asTrimmedString(normalizedResponses['1.1']) : ''
    },
    meet_the_team_page: {
      generate_page: normalizedResponses['2'] === 'yes',
      team_introduction: normalizedResponses['2'] === 'yes' ? asTrimmedString(normalizedResponses['2.1']) : '',
      team_photo_with_tags: teamPhoto
    }
  };

  return {
    metadata: {
      business_name: businessName,
      businessDomain: domain,
      submission_datetime: new Date().toISOString(),
      service_type: 'pro'
    },
    userdata: {
      additional_pages_list: additionalPagesList,
      service_offerings: serviceSelections.flatMap((selection) => {
        if (selection.startsWith('CATEGORY:')) {
          const categoryName = selection.replace('CATEGORY:', '').trim();
          return serviceOptionsGrouped[categoryName] || [];
        }

        return [selection];
      }),
      service_offerings_other: serviceOfferingsOther,
      target_industries: asStringArray(normalizedResponses['4']),
      target_industries_other: targetIndustriesOther,
      geographic_areas: geographicAreas,
      company_description: asTrimmedString(normalizedResponses['6']),
      delivery_model: asTrimmedString(normalizedResponses['7']),
      delivery_model_other: asTrimmedString(normalizedResponses['7_other']),
      pricing_packaging: asStringArray(normalizedResponses['8']),
      pricing_packaging_other: asTrimmedString(normalizedResponses['8_other']),
      differentiation: asTrimmedString(normalizedResponses['9']),
      company_goals: asStringArray(normalizedResponses['10']),
      company_goals_other: asTrimmedString(normalizedResponses['10_other']),
      brand_tone: asTrimmedString(normalizedResponses['11']),
      brand_tone_other: asTrimmedString(normalizedResponses['11_other']),
      certifications_partnerships: certificationsPartnerships,
      sales_process: asTrimmedString(normalizedResponses['13']),
      service_guarantee: normalizedResponses['14'] === 'yes',
      service_guarantee_items: serviceGuaranteeItems,
      client_acquisition: asTrimmedString(normalizedResponses['15']),
      client_acquisition_other: asTrimmedString(normalizedResponses['15_other']),
      website_objectives: asStringArray(normalizedResponses['16']),
      website_objectives_other: asTrimmedString(normalizedResponses['16_other']),
      client_size: asTrimmedString(normalizedResponses['17']),
      client_challenges: asStringArray(normalizedResponses['18']),
      client_challenges_other: clientChallengesOther,
      client_frustrations: asTrimmedString(normalizedResponses['19']),
      client_outcomes: asStringArray(normalizedResponses['20']),
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