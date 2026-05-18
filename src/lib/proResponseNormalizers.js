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

export const asPlainObject = (value) => (isPlainObject(value) ? value : {});

const MAX_UPLOAD_ITEMS = 100;
const MAX_SAFE_STRING_LENGTH = 500;
const MAX_UPLOAD_DESCRIPTION_LENGTH = 2000;

const sanitizeUploadString = (value, maxLength = MAX_SAFE_STRING_LENGTH) => {
  const normalized = asTrimmedString(value);
  if (!normalized) return '';
  if (/^data:/i.test(normalized)) return '';
  return normalized.slice(0, maxLength);
};

const isBlobLike = (value) => {
  if (!value || typeof value !== 'object') return false;
  const constructorName = value?.constructor?.name || '';
  return ['File', 'Blob', 'ArrayBuffer'].includes(constructorName);
};

const getNestedUploadSource = (source) => {
  const nestedKeys = ['file', 'upload', 'response', 'data', 'asset'];
  for (const key of nestedKeys) {
    const nested = source?.[key];
    if (isPlainObject(nested)) {
      return nested;
    }
  }
  return {};
};

export const normalizeUploadItem = (item) => {
  if (item == null || isBlobLike(item)) return null;

  if (typeof item === 'string') {
    const url = sanitizeUploadString(item);
    return url ? { url } : null;
  }

  const source = asPlainObject(item);
  if (!Object.keys(source).length) return null;

  const nested = getNestedUploadSource(source);
  const safeItem = {};
  const allowedKeys = ['url', 'file_url', 'image_url', 'name', 'fileName', 'filename', 'type', 'mimeType', 'size', 'uploadedAt', 'category', 'tag', 'label', 'description'];

  allowedKeys.forEach((key) => {
    const currentValue = source[key] ?? nested[key];
    if (currentValue == null || isBlobLike(currentValue)) return;

    if (key === 'size') {
      const size = Number(currentValue);
      if (Number.isFinite(size)) safeItem[key] = size;
      return;
    }

    const maxLength = key === 'description' ? MAX_UPLOAD_DESCRIPTION_LENGTH : MAX_SAFE_STRING_LENGTH;
    const normalized = sanitizeUploadString(currentValue, maxLength);
    if (normalized) safeItem[key] = normalized;
  });

  const derivedUrl = sanitizeUploadString(
    source.url || source.file_url || source.fileUrl || source.image_url || source.imageUrl || source.src ||
    nested.url || nested.file_url || nested.fileUrl || nested.image_url || nested.imageUrl || nested.src
  );
  const derivedName = sanitizeUploadString(
    source.name || source.fileName || source.filename || source.originalName || source.label ||
    nested.name || nested.fileName || nested.filename || nested.originalName || nested.label
  );

  if (!safeItem.url && derivedUrl) safeItem.url = derivedUrl;
  if (!safeItem.file_url && sanitizeUploadString(source.file_url || source.fileUrl || nested.file_url || nested.fileUrl)) {
    safeItem.file_url = sanitizeUploadString(source.file_url || source.fileUrl || nested.file_url || nested.fileUrl);
  }
  if (!safeItem.image_url && sanitizeUploadString(source.image_url || source.imageUrl || nested.image_url || nested.imageUrl)) {
    safeItem.image_url = sanitizeUploadString(source.image_url || source.imageUrl || nested.image_url || nested.imageUrl);
  }
  if (!safeItem.name && derivedName) safeItem.name = derivedName;

  return Object.keys(safeItem).length ? safeItem : null;
};

export const normalizeUploadList = (value, options = {}) => {
  const maxItems = Number.isFinite(Number(options.maxItems)) ? Number(options.maxItems) : MAX_UPLOAD_ITEMS;
  const list = asArray(value)
    .flatMap((item) => Array.isArray(item) ? item : [item])
    .map(normalizeUploadItem)
    .filter(Boolean);

  const seen = new Set();
  return list.filter((item) => {
    const key = `${item.url || item.file_url || item.image_url || ''}|${item.name || item.fileName || item.filename || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxItems);
};

export const normalizeCertificationAwardPartnerUploads = (value) => normalizeUploadList(value);

export const normalizeGuaranteeUploads = (value) => normalizeUploadList(value);

const pickSafeFileShape = (value, extraKeys = []) => {
  const normalized = normalizeUploadItem(value);
  if (!normalized) return null;

  if (!extraKeys.length) {
    return normalized;
  }

  const safeFile = { ...normalized };
  extraKeys.forEach((key) => {
    const nextValue = sanitizeUploadString(asPlainObject(value)?.[key], key === 'description' ? MAX_UPLOAD_DESCRIPTION_LENGTH : MAX_SAFE_STRING_LENGTH);
    if (nextValue) safeFile[key] = nextValue;
  });
  return safeFile;
};

export const asSafeFileList = (value) => normalizeUploadList(value);

export const asSafeTaggedFileList = (value) =>
  normalizeUploadList(value).map((item) => ({ ...item }));

const MAX_TEAM_PHOTO_TAGS = 50;
const MAX_TEAM_PHOTO_NOTES_LENGTH = 2000;

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

  const rawTags = safeObject.tags || safeObject.selectedTags || safeObject.peopleTags;
  const tags = asArray(rawTags)
    .flatMap((item) => {
      if (Array.isArray(item)) return item;
      return [item];
    })
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
    taggedPeople: [],
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
      const nextValue = asArray(value).map((item) => {
        if (typeof item === 'string') return asTrimmedString(item);
        const safeItem = asPlainObject(item);
        return {
          name: asTrimmedString(safeItem.name || safeItem.label || safeItem.value),
          label: asTrimmedString(safeItem.label || safeItem.name || safeItem.value),
          lat: asTrimmedString(safeItem.lat),
          lon: asTrimmedString(safeItem.lon),
          place_id: asTrimmedString(safeItem.place_id || safeItem.placeId),
          source: asTrimmedString(safeItem.source),
          primary: asBoolean(safeItem.primary, false)
        };
      });
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