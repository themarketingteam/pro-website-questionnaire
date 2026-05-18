let lastNormalizationWarnings = [];

const resetWarnings = () => {
  lastNormalizationWarnings = [];
};

const getValueType = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const firstStringLikeFromObject = (value) => {
  const candidateKeys = ['label', 'value', 'name', 'title'];
  for (const key of candidateKeys) {
    const candidate = value?.[key];
    if (typeof candidate === 'string') return candidate;
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return String(candidate);
  }
  return null;
};

const addWarning = (questionId, issue, originalValue, repairedAs) => {
  lastNormalizationWarnings.push({
    questionId,
    issue,
    originalType: getValueType(originalValue),
    repairedAs
  });
};

export const asString = (value, fallback = '') => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return fallback;
  if (typeof value === 'object') {
    const stringLikeValue = firstStringLikeFromObject(value);
    if (stringLikeValue != null) return stringLikeValue;
    return fallback;
  }
  return fallback;
};

export const asTrimmedString = (value, fallback = '') => asString(value, fallback).trim();

export const asBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  const normalized = asTrimmedString(value).toLowerCase();
  if (['yes', 'true', '1'].includes(normalized)) return true;
  if (['no', 'false', '0'].includes(normalized)) return false;
  return fallback;
};

export const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
};

export const asStringArray = (value) => {
  const results = [];
  const seen = new Set();

  asArray(value).forEach((item) => {
    const normalized = asTrimmedString(item);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    results.push(normalized);
  });

  return results;
};

export const normalizeStringSelectionList = (value) => {
  const results = [];
  const seen = new Set();

  asArray(value).forEach((item) => {
    const normalized = asTrimmedString(item);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    results.push(normalized);
  });

  return results;
};

export const normalizeIndustrySelections = (value) => normalizeStringSelectionList(value);

export const normalizeLocationSelections = (value) => normalizeStringSelectionList(value);

export const normalizeAdditionalPagesList = (value) => {
  if (value == null) return {};
  if (Array.isArray(value) || typeof value === 'string') {
    return { items: normalizeStringSelectionList(value) };
  }
  if (!isPlainObject(value)) return {};

  const safeObject = {};
  Object.entries(value).forEach(([key, entryValue]) => {
    if (entryValue == null) return;

    if (Array.isArray(entryValue) || typeof entryValue === 'string') {
      const normalized = normalizeStringSelectionList(entryValue);
      if (normalized.length) safeObject[key] = normalized;
      return;
    }

    if (isPlainObject(entryValue)) {
      safeObject[key] = entryValue;
      return;
    }

    if (typeof entryValue === 'boolean' || typeof entryValue === 'number') {
      safeObject[key] = entryValue;
    }
  });

  return safeObject;
};

const toFiniteNumberOrNull = (value) => {
  if (value === '' || value == null) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const firstDefined = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

export const normalizeGeographicAreas = (value) => {
  return asArray(value)
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') {
        const label = asTrimmedString(item);
        return label
          ? {
              label,
              name: label,
              city: '',
              state: '',
              region: '',
              county: '',
              zip: '',
              radius: null,
              latitude: null,
              longitude: null,
              place_id: '',
              source: 'manual',
              type: '',
              primary: false
            }
          : null;
      }

      const safeItem = asPlainObject(item);
      const meta = asPlainObject(
        safeItem.geographic_area_meta ||
        safeItem.meta ||
        safeItem.location ||
        safeItem.place
      );

      const label = asTrimmedString(firstDefined(
        safeItem.label,
        safeItem.name,
        safeItem.city,
        safeItem.value,
        meta.label,
        meta.name,
        meta.city
      ));

      const name = asTrimmedString(firstDefined(
        safeItem.name,
        safeItem.label,
        safeItem.city,
        safeItem.value,
        meta.name,
        meta.label,
        meta.city
      ));

      const latitude = toFiniteNumberOrNull(firstDefined(
        safeItem.latitude,
        safeItem.lat,
        meta.latitude,
        meta.lat
      ));

      const longitude = toFiniteNumberOrNull(firstDefined(
        safeItem.longitude,
        safeItem.lon,
        safeItem.lng,
        meta.longitude,
        meta.lon,
        meta.lng
      ));

      const radius = toFiniteNumberOrNull(firstDefined(
        safeItem.radius,
        meta.radius
      ));

      const normalized = {
        label,
        name,
        city: asTrimmedString(firstDefined(safeItem.city, meta.city)),
        state: asTrimmedString(firstDefined(safeItem.state, meta.state)),
        region: asTrimmedString(firstDefined(safeItem.region, meta.region)),
        county: asTrimmedString(firstDefined(safeItem.county, meta.county)),
        zip: asTrimmedString(firstDefined(
          safeItem.zip,
          safeItem.postalCode,
          safeItem.postal_code,
          meta.zip,
          meta.postalCode,
          meta.postal_code
        )),
        radius,
        latitude,
        longitude,
        place_id: asTrimmedString(firstDefined(
          safeItem.place_id,
          safeItem.placeId,
          meta.place_id,
          meta.placeId
        )),
        source: asTrimmedString(firstDefined(safeItem.source, meta.source)) || 'manual',
        type: asTrimmedString(firstDefined(safeItem.type, meta.type)),
        primary: asBoolean(firstDefined(safeItem.primary, meta.primary), false)
      };

      return normalized.label || normalized.name ? normalized : null;
    })
    .filter(Boolean);
};

export const normalizeServiceSelections = (value, serviceOptionsGrouped = {}) => {
  const selections = normalizeStringSelectionList(value);
  const expanded = [];

  selections.forEach((selection) => {
    if (selection.startsWith('CATEGORY:')) {
      const categoryName = selection.replace('CATEGORY:', '').trim();
      const categoryServices = Array.isArray(serviceOptionsGrouped?.[categoryName])
        ? serviceOptionsGrouped[categoryName]
        : [];

      if (categoryServices.length > 0) {
        expanded.push(...categoryServices);
      } else {
        expanded.push(selection);
      }

      return;
    }

    expanded.push(selection);
  });

  const seen = new Set();

  return expanded
    .map((item) => asTrimmedString(item))
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
};

export const asPlainObject = (value) => (isPlainObject(value) ? value : {});

const pickSafeFileShape = (value, extraKeys = []) => {
  const source = asPlainObject(value);
  const safeFile = {};
  const allowedKeys = [
    'url',
    'name',
    'fileName',
    'filename',
    'type',
    'size',
    'mimeType',
    'uploadedAt',
    ...extraKeys
  ];

  allowedKeys.forEach((key) => {
    const currentValue = source[key];
    if (currentValue == null) return;

    if (key === 'size') {
      const size = Number(currentValue);
      if (Number.isFinite(size)) safeFile[key] = size;
      return;
    }

    if (key === 'tags' && Array.isArray(currentValue)) {
      const tags = asStringArray(currentValue);
      if (tags.length) safeFile[key] = tags;
      return;
    }

    const normalized = asTrimmedString(currentValue);
    if (normalized) safeFile[key] = normalized;
  });

  if (!safeFile.url) {
    safeFile.url = asTrimmedString(
      source.url || source.file_url || source.fileUrl || source.imageUrl || source.src
    );
  }

  if (!safeFile.name) {
    safeFile.name = asTrimmedString(
      source.name || source.fileName || source.filename || source.originalName || source.label
    );
  }

  return Object.keys(safeFile).length ? safeFile : null;
};

export const asSafeFileList = (value) => {
  const list = asArray(value)
    .map((item) => {
      if (typeof item === 'string') {
        const normalized = asTrimmedString(item);
        return normalized ? { url: normalized } : null;
      }
      return pickSafeFileShape(item);
    })
    .filter(Boolean);

  const seen = new Set();
  return list.filter((item) => {
    const key = `${item.url || ''}|${item.name || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const asSafeTaggedFileList = (value) =>
  asArray(value)
    .map((item) => {
      if (typeof item === 'string') {
        const normalized = asTrimmedString(item);
        return normalized ? { url: normalized } : null;
      }
      return pickSafeFileShape(item, ['tag', 'tags', 'category', 'description', 'label']);
    })
    .filter(Boolean);

const MAX_TEAM_PHOTO_TAGS = 50;
const MAX_TEAM_PHOTO_NOTES_LENGTH = 2000;

const normalizeTaggedPerson = (value) => {
  const safeValue = asPlainObject(value);
  const person = asPlainObject(safeValue.person);

  const x = toFiniteNumberOrNull(safeValue.x);
  const y = toFiniteNumberOrNull(safeValue.y);

  const normalizedPerson = {
    name: asTrimmedString(person.name || safeValue.name || safeValue.label),
    position: asTrimmedString(person.position || person.title || safeValue.position || safeValue.title),
    bio: asTrimmedString(person.bio || safeValue.bio)
  };

  const hasPersonData = Boolean(
    normalizedPerson.name ||
    normalizedPerson.position ||
    normalizedPerson.bio
  );

  if (x == null && y == null && !hasPersonData) {
    return null;
  }

  return {
    x,
    y,
    person: normalizedPerson
  };
};

const normalizeTaggedPeople = (value) => {
  return asArray(value)
    .map(normalizeTaggedPerson)
    .filter(Boolean);
};

const normalizeTeamPhotoTagValue = (value) => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return asTrimmedString(value);
  }

  const safeValue = asPlainObject(value);
  return asTrimmedString(
    safeValue.label ||
    safeValue.value ||
    safeValue.name ||
    safeValue.title ||
    safeValue.tag
  );
};

export const normalizeTeamPhotoWithTags = (value) => {
  const safeDefault = {
    imageUrl: '',
    imageName: '',
    taggedPeople: [],
    files: [],
    tags: [],
    notes: '',
    has_team_photo: false
  };

  if (value == null) {
    return safeDefault;
  }

  const safeFiles = asSafeFileList(
    typeof value === 'string'
      ? value
      : Array.isArray(value)
        ? value
        : value?.files || value?.uploadedFiles || value?.file || value
  );

  const safeObject = Array.isArray(value) ? {} : asPlainObject(value);
  const primaryFile = safeFiles[0] || null;
  const explicitUrl = typeof value === 'string'
    ? asTrimmedString(value)
    : asTrimmedString(
      safeObject.url ||
      safeObject.file_url ||
      safeObject.fileUrl ||
      safeObject.image_url ||
      safeObject.imageUrl ||
      safeObject.src
    );

  const imageUrl = explicitUrl || primaryFile?.url || '';
  const imageName = asTrimmedString(
    safeObject.name ||
    safeObject.fileName ||
    safeObject.filename ||
    primaryFile?.name
  );

  const rawTagSource = safeObject.taggedPeople || safeObject.tags || safeObject.peopleTags || [];
  const rawTagArray = asArray(rawTagSource);

  const taggedPeople = normalizeTaggedPeople(
    rawTagArray.filter((item) => item && typeof item === 'object')
  );

  const tags = rawTagArray
    .filter((item) => typeof item !== 'object' || item == null)
    .map(normalizeTeamPhotoTagValue)
    .filter(Boolean)
    .filter((tag, index, array) => array.indexOf(tag) === index)
    .slice(0, MAX_TEAM_PHOTO_TAGS);

  const notes = asTrimmedString(safeObject.notes || safeObject.description).slice(0, MAX_TEAM_PHOTO_NOTES_LENGTH);
  const explicitHasPhoto = asBoolean(safeObject.has_team_photo, false);
  const hasTeamPhoto = explicitHasPhoto || Boolean(imageUrl || safeFiles.length);

  return {
    imageUrl,
    imageName,
    taggedPeople,
    files: safeFiles,
    tags,
    notes,
    has_team_photo: hasTeamPhoto
  };
};

const normalizeYesNo = (questionId, value) => {
  const normalized = asTrimmedString(value).toLowerCase();
  if (normalized === 'yes' || normalized === 'no') return normalized;
  if (typeof value === 'boolean') {
    addWarning(questionId, 'Converted boolean yes/no answer to string form.', value, 'string');
    return value ? 'yes' : 'no';
  }
  if (normalized === 'true' || normalized === '1') {
    addWarning(questionId, 'Converted truthy yes/no answer to string form.', value, 'string');
    return 'yes';
  }
  if (normalized === 'false' || normalized === '0') {
    addWarning(questionId, 'Converted falsy yes/no answer to string form.', value, 'string');
    return 'no';
  }
  return asTrimmedString(value);
};

const MULTI_SELECT_IDS = new Set(['3', '3_other', '4', '4_other', '8', '10', '16', '18', '18_other', '20', '20_other']);
const TEXT_IDS = new Set(['1.1', '2.1', '6', '7', '7_other', '8_other', '9', '10_other', '11', '11_other', '13', '15', '15_other', '16_other', '17', '19', '21', '22', '23.1', '24', '24_other', '25.1']);
const YES_NO_IDS = new Set(['1', '2', '12', '14', '23', '25']);
const FILE_LIST_IDS = new Set(['12.1', '14.1']);
const OBJECT_IDS = new Set(['2.2']);
const GEOGRAPHIC_IDS = new Set(['5']);

export const normalizeQuestionnaireResponses = (responses) => {
  resetWarnings();

  const normalizedSource = isPlainObject(responses) ? responses : {};
  if (!isPlainObject(responses) && responses != null) {
    addWarning('*', 'Normalized non-object responses container.', responses, 'object');
  }

  const normalizedResponses = {};

  Object.entries(normalizedSource).forEach(([questionId, value]) => {
    if (MULTI_SELECT_IDS.has(questionId)) {
      const nextValue = asStringArray(value);
      if (!Array.isArray(value) || nextValue.length !== asArray(value).length) {
        addWarning(questionId, 'Normalized multi-select answer shape.', value, 'string_array');
      }
      normalizedResponses[questionId] = nextValue;
      return;
    }

    if (YES_NO_IDS.has(questionId)) {
      const nextValue = normalizeYesNo(questionId, value);
      if (nextValue !== value) {
        addWarning(questionId, 'Normalized yes/no answer shape.', value, 'string');
      }
      normalizedResponses[questionId] = nextValue;
      return;
    }

    if (FILE_LIST_IDS.has(questionId)) {
      const nextValue = asSafeTaggedFileList(value);
      if (!Array.isArray(value)) {
        addWarning(questionId, 'Normalized file list answer shape.', value, 'safe_file_list');
      }
      normalizedResponses[questionId] = nextValue;
      return;
    }

    if (OBJECT_IDS.has(questionId)) {
      const nextValue = normalizeTeamPhotoWithTags(value);
      if (!isPlainObject(value)) {
        addWarning(questionId, 'Normalized object answer shape.', value, 'plain_object');
      }
      normalizedResponses[questionId] = nextValue;
      return;
    }

    if (GEOGRAPHIC_IDS.has(questionId)) {
      const nextValue = normalizeGeographicAreas(value);

      if (!Array.isArray(value)) {
        addWarning(questionId, 'Normalized geographic answer shape.', value, 'array');
      }

      normalizedResponses[questionId] = nextValue;
      return;
    }

    if (questionId.endsWith('_primary')) {
      const normalized = Number(value);
      normalizedResponses[questionId] = Number.isFinite(normalized) ? normalized : 0;
      if (!Number.isFinite(normalized)) {
        addWarning(questionId, 'Normalized primary index.', value, 'number');
      }
      return;
    }

    if (TEXT_IDS.has(questionId)) {
      const nextValue = asTrimmedString(value);
      if (value !== nextValue) {
        addWarning(questionId, 'Normalized text answer shape.', value, 'string');
      }
      normalizedResponses[questionId] = nextValue;
      return;
    }

    if (Array.isArray(value)) {
      normalizedResponses[questionId] = value.map((item) => (
        typeof item === 'object' ? asTrimmedString(item) || asPlainObject(item) : item
      ));
      return;
    }

    if (typeof value === 'object' && value !== null) {
      normalizedResponses[questionId] = asPlainObject(value);
      return;
    }

    normalizedResponses[questionId] = value;
  });

  return normalizedResponses;
};

export const getNormalizationWarnings = () => [...lastNormalizationWarnings];