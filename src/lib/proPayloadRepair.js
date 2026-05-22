import {
  asArray,
  asPlainObject,
  asTrimmedString,
  normalizeAdditionalPagesList,
  normalizeGeographicAreas,
  normalizeIndustrySelections,
  normalizeLocationSelections,
  normalizeStringSelectionList
} from '@/lib/proResponseNormalizers';

const STRING_ARRAY_FIELDS = [
  'service_offerings',
  'target_industries',
  'pricing_packaging',
  'company_goals',
  'website_objectives',
  'client_challenges',
  'client_outcomes',
  'industries',
  'locations'
];

// Scalar string fields in userdata that must always be a plain string (never array/object)
const SCALAR_STRING_FIELDS = [
  'service_offerings_other',
  'target_industries_other',
  'delivery_model',
  'delivery_model_other',
  'pricing_packaging_other',
  'differentiation',
  'company_goals_other',
  'brand_tone',
  'brand_tone_other',
  'sales_process',
  'client_acquisition',
  'client_acquisition_other',
  'website_objectives_other',
  'client_size',
  'client_challenges_other',
  'client_frustrations',
  'client_outcomes_other',
  'value_description',
  'ideal_client',
  'avoided_clients',
  'primary_cta',
  'primary_cta_other',
  'additional_notes',
  'company_description'
];

const OBJECT_ARRAY_FIELDS = [
  'certifications_partnerships',
  'service_guarantee_items',
  'geographic_areas',
  'service_areas'
];

const UPLOAD_OBJECT_KEYS = ['file', 'upload', 'response', 'data', 'asset'];

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isFileLikeObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const tag = value?.constructor?.name || '';

  if (['File', 'Blob', 'ArrayBuffer'].includes(tag)) return true;

  if (typeof File !== 'undefined' && value instanceof File) return true;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return true;

  const hasBinaryMethods =
    typeof value.arrayBuffer === 'function' ||
    typeof value.stream === 'function';

  const hasFileMetadata =
    typeof value.size === 'number' ||
    typeof value.type === 'string' ||
    typeof value.name === 'string';

  return hasBinaryMethods && hasFileMetadata;
};

const cloneWithoutMutation = (value, seen = new WeakMap()) => {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'function') return undefined;
  if (!value || typeof value !== 'object') return value;
  if (isFileLikeObject(value)) return value;
  if (seen.has(value)) return undefined;

  if (Array.isArray(value)) {
    const clonedArray = [];
    seen.set(value, clonedArray);
    value.forEach((item) => {
      const clonedItem = cloneWithoutMutation(item, seen);
      clonedArray.push(clonedItem);
    });
    return clonedArray;
  }

  const clonedObject = {};
  seen.set(value, clonedObject);
  Object.entries(value).forEach(([key, item]) => {
    clonedObject[key] = cloneWithoutMutation(item, seen);
  });
  return clonedObject;
};

export const stripUndefinedDeep = (value) => {
  if (Array.isArray(value)) {
    return value
      .map(stripUndefinedDeep)
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).reduce((acc, [key, item]) => {
      const cleaned = stripUndefinedDeep(item);
      if (cleaned !== undefined) acc[key] = cleaned;
      return acc;
    }, {});
  }

  return value === undefined ? undefined : value;
};

export const limitStringDeep = (value, maxLength = 5000, warnings = []) => {
  if (typeof value === 'string') {
    if (value.length > maxLength) {
      warnings.push('long_string_truncated');
      return value.slice(0, maxLength);
    }
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => limitStringDeep(item, maxLength, warnings));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, item]) => {
      acc[key] = limitStringDeep(item, maxLength, warnings);
      return acc;
    }, {});
  }

  return value;
};

export const removeUnsafeUploadLikeObjects = (value, warnings = []) => {
  if (isFileLikeObject(value)) {
    warnings.push('unsafe_upload_object_removed');
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => removeUnsafeUploadLikeObjects(item, warnings))
      .filter((item) => item !== undefined)
      .slice(0, 100);
  }

  if (value && typeof value === 'object') {
    const safeObject = {};
    Object.entries(value).forEach(([key, item]) => {
      if (typeof item === 'function') return;
      if (UPLOAD_OBJECT_KEYS.includes(key) && isFileLikeObject(item)) {
        warnings.push('unsafe_upload_object_removed');
        return;
      }
      const cleaned = removeUnsafeUploadLikeObjects(item, warnings);
      if (cleaned !== undefined) safeObject[key] = cleaned;
    });
    return safeObject;
  }

  return value;
};

export const validateRequiredSubmissionMetadata = (payload) => {
  const errors = [];
  const metadata = asPlainObject(payload?.metadata);

  if (!payload || typeof payload !== 'object') {
    errors.push('metadata_missing');
    return errors;
  }

  if (!Object.keys(metadata).length) {
    errors.push('metadata_missing');
  }

  if (!String(metadata.business_name || '').trim()) {
    errors.push('metadata.business_name_missing');
  }

  if (!String(metadata.businessDomain || '').trim()) {
    errors.push('metadata.businessDomain_missing');
  }

  return errors;
};

const normalizeGeographicAreasForPayloadRepair = (value) => {
  return asArray(value)
    .flatMap((item, index) => {
      const safeItem = asPlainObject(item);
      const existingMeta = asPlainObject(safeItem.geographic_area_meta);

      if (Object.keys(existingMeta).length > 0) {
        const repairedMeta = {
          name: asTrimmedString(existingMeta.name || existingMeta.label),
          label: asTrimmedString(existingMeta.label || existingMeta.name),
          lat: asTrimmedString(existingMeta.lat ?? existingMeta.latitude ?? ''),
          lon: asTrimmedString(existingMeta.lon ?? existingMeta.lng ?? existingMeta.longitude ?? ''),
          place_id: asTrimmedString(existingMeta.place_id || existingMeta.placeId),
          source: asTrimmedString(existingMeta.source) || 'manual',
          primary: Boolean(existingMeta.primary)
        };

        if (!repairedMeta.name && !repairedMeta.label) return [];

        return [{ geographic_area_meta: repairedMeta }];
      }

      const normalizedRawAreas = normalizeGeographicAreas(item);

      return normalizedRawAreas
        .map((area, rawIndex) => {
          const safeArea = asPlainObject(area);

          const repairedMeta = {
            name: asTrimmedString(safeArea.name || safeArea.label || safeArea.city),
            label: asTrimmedString(safeArea.label || safeArea.name || safeArea.city),
            lat: safeArea.latitude != null ? String(safeArea.latitude) : '',
            lon: safeArea.longitude != null ? String(safeArea.longitude) : '',
            place_id: asTrimmedString(safeArea.place_id || safeArea.placeId),
            source: asTrimmedString(safeArea.source) || 'manual',
            primary: Boolean(safeArea.primary) || (index === 0 && rawIndex === 0)
          };

          if (!repairedMeta.name && !repairedMeta.label) return null;

          return { geographic_area_meta: repairedMeta };
        })
        .filter(Boolean);
    });
};

export const repairProSubmissionPayload = (payload) => {
  const warnings = [];
  const clonedPayload = cloneWithoutMutation(payload) || {};
  const repairedPayload = asPlainObject(clonedPayload);

  repairedPayload.metadata = asPlainObject(repairedPayload.metadata);
  repairedPayload.userdata = asPlainObject(repairedPayload.userdata);

  const originalAdditionalPages = repairedPayload.userdata.additional_pages_list;
  const repairedAdditionalPagesBase = normalizeAdditionalPagesList(originalAdditionalPages);
  const repairedAdditionalPages = asPlainObject(repairedAdditionalPagesBase);

  if (!isPlainObject(originalAdditionalPages)) {
    warnings.push('additional_pages_list_repaired_to_object');
  }

  const existingMeetTheTeamPage = asPlainObject(repairedAdditionalPages.meet_the_team_page);
  const originalTeamPhoto =
    existingMeetTheTeamPage.team_photo_with_tags ??
    repairedPayload.userdata.team_photo_with_tags;

  const repairedTeamPhoto = asPlainObject(originalTeamPhoto);

  if (!isPlainObject(originalTeamPhoto)) {
    warnings.push('team_photo_repaired_to_object');
  }

  const repairedMeetTheTeamPage = {
    ...existingMeetTheTeamPage,
    team_photo_with_tags: repairedTeamPhoto
  };

  repairedPayload.userdata.additional_pages_list = {
    ...repairedAdditionalPages,
    meet_the_team_page: repairedMeetTheTeamPage
  };

  if (
    Array.isArray(originalAdditionalPages) &&
    !Array.isArray(repairedPayload.userdata.additional_pages_list.items)
  ) {
    repairedPayload.userdata.additional_pages_list.items = normalizeStringSelectionList(originalAdditionalPages);
    warnings.push('additional_pages_items_restored');
  }

  if (
    typeof originalAdditionalPages === 'string' &&
    !Array.isArray(repairedPayload.userdata.additional_pages_list.items)
  ) {
    repairedPayload.userdata.additional_pages_list.items = normalizeStringSelectionList(originalAdditionalPages);
    warnings.push('additional_pages_items_restored');
  }

  repairedPayload.userdata.team_photo_with_tags = repairedTeamPhoto;

  STRING_ARRAY_FIELDS.forEach((field) => {
    const originalValue = repairedPayload.userdata[field];
    let nextValue;

    if (field === 'target_industries' || field === 'industries') {
      nextValue = normalizeIndustrySelections(originalValue);
    } else if (field === 'locations') {
      nextValue = normalizeLocationSelections(originalValue);
    } else {
      nextValue = normalizeStringSelectionList(originalValue);
    }

    repairedPayload.userdata[field] = Array.isArray(nextValue) ? nextValue : [];

    if (!Array.isArray(originalValue)) {
      warnings.push(`${field}_repaired_to_array`);
    }
  });

  OBJECT_ARRAY_FIELDS.forEach((field) => {
    const originalValue = repairedPayload.userdata[field];

    if (field === 'geographic_areas') {
      repairedPayload.userdata[field] = normalizeGeographicAreasForPayloadRepair(originalValue);
    } else if (field === 'service_areas') {
      repairedPayload.userdata[field] = normalizeGeographicAreas(originalValue);
    } else {
      repairedPayload.userdata[field] = asArray(originalValue)
        .map((item) => asPlainObject(item))
        .filter((item) => Object.keys(item).length > 0);
    }

    if (!Array.isArray(originalValue)) {
      warnings.push(`${field}_repaired_to_object_array`);
    }
  });

  // Coerce scalar string fields — e.g. pricing_packaging_other stored as [""] must become ""
  SCALAR_STRING_FIELDS.forEach((field) => {
    const originalValue = repairedPayload.userdata[field];
    if (originalValue === undefined) return;
    if (typeof originalValue !== 'string') {
      repairedPayload.userdata[field] = Array.isArray(originalValue)
        ? originalValue.map((item) => asTrimmedString(item)).filter(Boolean).join(', ')
        : asTrimmedString(originalValue);
      warnings.push(`${field}_coerced_to_string`);
    }
  });

  const uploadCleanedPayload = removeUnsafeUploadLikeObjects(repairedPayload, warnings);
  const truncatedPayload = limitStringDeep(uploadCleanedPayload, 5000, warnings);
  const cleanedPayload = stripUndefinedDeep(truncatedPayload);
  const errors = validateRequiredSubmissionMetadata(cleanedPayload);

  if (JSON.stringify(cleanedPayload).includes('undefined')) {
    warnings.push('undefined_values_removed');
  }

  return {
    payload: cleanedPayload,
    warnings: [...new Set(warnings)],
    ok: errors.length === 0,
    errors
  };
};