export const serializeError = (error) => ({
  name: error?.name,
  message: error?.message,
  status: error?.status || error?.response?.status,
  data: error?.response?.data,
  stack: import.meta.env.DEV ? error?.stack : undefined
});

const asTrimmedString = (value) =>
  typeof value === 'string' ? value.trim() : '';

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

      const name = isString
        ? location
        : location.name || location.label || '';

      return {
        geographic_area_meta: {
          name: asTrimmedString(name),
          label: asTrimmedString(
            isString ? location : location.label || location.name || ''
          ),
          lat: isString ? '' : asCoordinateString(location.lat),
          lon: isString ? '' : asCoordinateString(location.lon),
          place_id: isString ? '' : asTrimmedString(location.place_id),
          source: isString ? 'manual' : asTrimmedString(location.source) || 'google',
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
    .filter((item) => item?.name?.trim() && item?.type)
    .map((item) => ({
      cert_item_name: item.name.trim(),
      cert_item_type: item.type,
      cert_item_image_url: item.imageUrl || item.image?.url || '',
      cert_item_image_name: item.image?.name || '',
      cert_item_files: Array.isArray(item.files)
        ? item.files
            .map((file) => ({
              name: file?.name || '',
              url: file?.url || ''
            }))
            .filter((file) => file.url || file.name)
        : []
    }));

export const normalizeTeamPhoto = (answer) => {
  if (!answer?.url && !answer?.imageUrl) {
    return {
      imageUrl: '',
      imageName: '',
      taggedPeople: []
    };
  }

  return {
    imageUrl: answer.url || answer.imageUrl || '',
    imageName: answer.name || '',
    taggedPeople: Array.isArray(answer.tags)
      ? answer.tags
          .filter((tag) => tag?.person?.name?.trim())
          .map((tag) => ({
            name: tag.person.name.trim(),
            position: tag.person.position || '',
            bio: tag.person.bio || '',
            x: tag.x ?? 0,
            y: tag.y ?? 0
          }))
      : []
  };
};

export const normalizeGuarantees = (items = []) =>
  items
    .filter(
      (item) =>
        item?.name?.trim() &&
        item?.type &&
        (
          item?.file?.url ||
          item?.fileUrl ||
          item?.description?.trim()
        )
    )
    .map((item) => ({
      guarantee_name: item.name.trim(),
      guarantee_type: item.type,
      guarantee_file_url: item.fileUrl || item.file?.url || '',
      guarantee_file_name: item.file?.name || '',
      guarantee_description: item.description || ''
    }));

export const transformResponsesToPayload = (
  responses,
  businessName,
  domain,
  serviceOptionsGrouped = {}
) => {
  const geographicAreas = normalizeGeographicAreas(
    responses['5'] || [],
    responses['5_primary'] || 0
  );

  const certificationsPartnerships = responses['12'] === 'yes'
    ? normalizeCertifications(responses['12.1'] || [])
    : [];

  const teamPhoto = responses['2'] === 'yes'
    ? normalizeTeamPhoto(responses['2.2'])
    : { imageUrl: '', imageName: '', taggedPeople: [] };

  const serviceGuaranteeItems = responses['14'] === 'yes'
    ? normalizeGuarantees(responses['14.1'] || [])
    : [];

  const additionalPagesList = {
    why_choose_us_page: {
      generate_page: responses['1'] === 'yes',
      why_choose_us_description: responses['1'] === 'yes' ? (responses['1.1'] || '') : ''
    },
    meet_the_team_page: {
      generate_page: responses['2'] === 'yes',
      team_introduction: responses['2'] === 'yes' ? (responses['2.1'] || '') : '',
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
      service_offerings: (responses['3'] || []).flatMap((s) => {
        if (s.startsWith('CATEGORY:')) {
          const categoryName = s.replace('CATEGORY:', '');
          return serviceOptionsGrouped[categoryName] || [];
        }

        return [s];
      }),
      service_offerings_other: Array.isArray(responses['3_other'])
        ? responses['3_other'].filter((v) => v?.trim()).join(', ')
        : (responses['3_other'] || ''),
      target_industries: responses['4'] || [],
      target_industries_other: Array.isArray(responses['4_other'])
        ? responses['4_other'].filter((v) => v?.trim()).join(', ')
        : (responses['4_other'] || ''),
      geographic_areas: geographicAreas,
      company_description: responses['6'] || '',
      delivery_model: responses['7'] || '',
      delivery_model_other: responses['7_other'] || '',
      pricing_packaging: responses['8'] || [],
      pricing_packaging_other: responses['8_other'] || '',
      differentiation: responses['9'] || '',
      company_goals: responses['10'] || [],
      company_goals_other: responses['10_other'] || '',
      brand_tone: responses['11'] || '',
      brand_tone_other: responses['11_other'] || '',
      certifications_partnerships: certificationsPartnerships,
      sales_process: responses['13'] || '',
      service_guarantee: responses['14'] === 'yes',
      service_guarantee_items: serviceGuaranteeItems,
      client_acquisition: responses['15'] || '',
      client_acquisition_other: responses['15_other'] || '',
      website_objectives: responses['16'] || [],
      website_objectives_other: responses['16_other'] || '',
      client_size: responses['17'] || '',
      client_challenges: responses['18'] || [],
      client_challenges_other: Array.isArray(responses['18_other'])
        ? responses['18_other'].filter((v) => v?.trim()).join(', ')
        : (responses['18_other'] || ''),
      client_frustrations: responses['19'] || '',
      client_outcomes: responses['20'] || [],
      client_outcomes_other: Array.isArray(responses['20_other'])
        ? responses['20_other'].filter((v) => v?.trim()).join(', ')
        : (responses['20_other'] || ''),
      value_description: responses['21'] || '',
      ideal_client: responses['22'] || '',
      avoided_clients: responses['23'] === 'yes' ? (responses['23.1'] || '') : '',
      primary_cta: responses['24'] || '',
      primary_cta_other: responses['24_other'] || '',
      additional_notes: responses['25'] === 'yes' ? (responses['25.1'] || '') : ''
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