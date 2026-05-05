const isEmpty = (value) => {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
};

const clean = (value) => {
  if (value == null) return '';
  return String(value).trim();
};

const formatPrimitiveOrObject = (value) => {
  if (value == null) return '';

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }

  if (typeof value === 'object') {
    if (value.label || value.name) {
      return clean(value.label || value.name);
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }

  return String(value);
};

const formatLocation = (location, index, allResponses = {}) => {
  if (typeof location === 'string') return location;

  const meta = location?.geographic_area_meta || location || {};
  const label = meta.label || meta.name || meta.place_id || `Location ${index + 1}`;
  const primaryIndex = Number(allResponses['5_primary'] || 0);
  const primary = meta.primary === true || index === primaryIndex;

  return primary ? `${label} (Primary)` : label;
};

const formatCertification = (item, index) => {
  const name = clean(item?.name || item?.cert_item_name || `Item ${index + 1}`);
  const type = clean(item?.type || item?.cert_item_type);

  const image =
    item?.image?.name ||
    item?.image?.url ||
    item?.imageUrl ||
    item?.cert_item_image_url;

  const files = Array.isArray(item?.files)
    ? item.files.map((file) => file?.name || file?.url).filter(Boolean)
    : [];

  const parts = [`${name}${type ? ` (${type})` : ''}`];

  if (image) parts.push(`Image: ${image}`);
  if (files.length) parts.push(`Files: ${files.join(', ')}`);

  return parts.join(' — ');
};

const formatGuarantee = (item, index) => {
  const name = clean(item?.name || item?.guarantee_name || `Guarantee ${index + 1}`);
  const type = clean(item?.type || item?.guarantee_type);
  const description = clean(item?.description || item?.guarantee_description);

  const file =
    item?.file?.name ||
    item?.file?.url ||
    item?.fileUrl ||
    item?.guarantee_file_url;

  const parts = [`${name}${type ? ` (${type})` : ''}`];

  if (description) parts.push(description);
  if (file) parts.push(`File: ${file}`);

  return parts.join(' — ');
};

const formatImageTagging = (answer) => {
  if (!answer || typeof answer !== 'object') return '';

  const imageName = answer.name || answer.url || answer.imageUrl || 'Uploaded image';
  const tags = Array.isArray(answer.tags) ? answer.tags : [];

  const people = tags
    .map((tag) => {
      const person = tag?.person || {};
      const name = clean(person.name);
      const position = clean(person.position);

      if (!name) return '';
      return position ? `${name} - ${position}` : name;
    })
    .filter(Boolean);

  return [
    `Image: ${imageName}`,
    people.length ? `Tagged people: ${people.join('; ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
};

export const formatAnswerForDisplay = (
  questionId,
  answer,
  otherValue,
  allResponses = {}
) => {
  if (isEmpty(answer) && isEmpty(otherValue)) return 'Not answered';

  let mainAnswer = '';

  if (Array.isArray(answer)) {
    if (questionId === '5') {
      mainAnswer = answer
        .map((item, index) => formatLocation(item, index, allResponses))
        .filter(Boolean)
        .join('; ');
    } else if (questionId === '12.1') {
      mainAnswer = answer.map(formatCertification).filter(Boolean).join('; ');
    } else if (questionId === '14.1') {
      mainAnswer = answer.map(formatGuarantee).filter(Boolean).join('; ');
    } else {
      mainAnswer = answer.map(formatPrimitiveOrObject).filter(Boolean).join(', ');
    }
  } else if (questionId === '2.2') {
    mainAnswer = formatImageTagging(answer);
  } else {
    mainAnswer = formatPrimitiveOrObject(answer);
  }

  let otherAnswer = '';

  if (Array.isArray(otherValue)) {
    otherAnswer = otherValue.map(clean).filter(Boolean).join(', ');
  } else if (typeof otherValue === 'string') {
    otherAnswer = clean(otherValue);
  }

  if (otherAnswer) {
    return mainAnswer ? `${mainAnswer}\nOther: ${otherAnswer}` : `Other: ${otherAnswer}`;
  }

  return mainAnswer || 'Not answered';
};

export const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');