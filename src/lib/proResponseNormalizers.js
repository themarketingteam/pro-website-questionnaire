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
      const source = asPlainObject(value);
      const nextValue = {
        url: asTrimmedString(source.url || source.imageUrl),
        imageUrl: asTrimmedString(source.imageUrl || source.url),
        name: asTrimmedString(source.name || source.fileName || source.filename),
        tags: asArray(source.tags).map((tag) => {
          const safeTag = asPlainObject(tag);
          const safePerson = asPlainObject(safeTag.person);
          return {
            x: Number.isFinite(Number(safeTag.x)) ? Number(safeTag.x) : 0,
            y: Number.isFinite(Number(safeTag.y)) ? Number(safeTag.y) : 0,
            person: {
              name: asTrimmedString(safePerson.name || safePerson.label),
              position: asTrimmedString(safePerson.position || safePerson.title),
              bio: asTrimmedString(safePerson.bio || safePerson.description)
            }
          };
        })
      };
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