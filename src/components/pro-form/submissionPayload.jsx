export const serializeError = (error) => ({
  name: error?.name,
  message: error?.message,
  status: error?.status || error?.response?.status,
  data: error?.response?.data,
  stack: import.meta.env.DEV ? error?.stack : undefined
});

const asTrimmedString = (value) =>
  typeof value === 'string' ? value.trim() : '';

const asNumberOrNull = (value) => {
  if (value == null || value === '') return null;

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
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
          lat: isString ? null : asNumberOrNull(location.lat),
          lon: isString ? null : asNumberOrNull(location.lon),
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