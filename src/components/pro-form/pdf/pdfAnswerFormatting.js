import { formatServiceSelectionLabel } from '@/lib/serviceSelectionModel';

const isObject = (value) => value !== null && typeof value === 'object';

const cleanText = (value) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const firstText = (...values) => {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
};

const asItems = (value) => {
  if (value == null) return [];
  if (Array.isArray(value)) return value;

  if (isObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 0 && keys.every((key) => /^\d+$/.test(key))) {
      return keys
        .sort((left, right) => Number(left) - Number(right))
        .map((key) => value[key]);
    }
  }

  return [value];
};

const formatYesNo = (value) => {
  const text = cleanText(value);
  const normalized = text.toLowerCase();
  if (normalized === 'yes') return 'Yes';
  if (normalized === 'no') return 'No';
  return text;
};

const formatDisplayObject = (value) => {
  if (!isObject(value) || Array.isArray(value)) return '';

  return firstText(
    value.label,
    value.name,
    value.value,
    value.title,
    value.text,
    value.displayName
  );
};

const formatGenericValue = (value) => {
  if (value == null) return '';

  if (Array.isArray(value)) {
    return value
      .map(formatGenericValue)
      .filter(Boolean)
      .join('\n');
  }

  if (typeof value === 'string') return formatYesNo(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (isObject(value)) return formatDisplayObject(value);
  return '';
};

const decodeFilename = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const safeFilename = (value) => {
  const rawValue = cleanText(value);
  if (!rawValue || /^(?:data|blob):/i.test(rawValue)) return '';

  let pathValue = rawValue;
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(rawValue)) {
      pathValue = new URL(rawValue).pathname;
    } else if (rawValue.startsWith('//')) {
      pathValue = new URL(rawValue, 'https://local.invalid').pathname;
    } else {
      pathValue = rawValue.split(/[?#]/, 1)[0];
    }
  } catch {
    pathValue = rawValue.split(/[?#]/, 1)[0];
  }

  const filename = decodeFilename(
    pathValue
      .replaceAll('\\', '/')
      .split('/')
      .filter(Boolean)
      .at(-1) || ''
  )
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();

  if (!filename || filename === '.' || filename === '..' || filename.length > 255) {
    return '';
  }

  return filename;
};

const UPLOAD_NAME_FIELDS = [
  'name',
  'fileName',
  'filename',
  'imageName',
  'cert_item_image_name',
  'cert_item_file_name',
  'guarantee_file_name'
];

const UPLOAD_URL_FIELDS = [
  'url',
  'file_url',
  'fileUrl',
  'image_url',
  'imageUrl',
  'src',
  'cert_item_image_url',
  'cert_item_file_url',
  'guarantee_file_url'
];

const describeUpload = (value) => {
  if (typeof value === 'string') {
    return { hasSource: cleanText(value) !== '', filename: safeFilename(value) };
  }

  if (!isObject(value) || Array.isArray(value)) {
    return { hasSource: false, filename: '' };
  }

  let hasSource = false;

  for (const field of UPLOAD_NAME_FIELDS) {
    const fieldValue = cleanText(value[field]);
    if (!fieldValue) continue;
    hasSource = true;
    const filename = safeFilename(fieldValue);
    if (filename) return { hasSource, filename };
  }

  for (const field of UPLOAD_URL_FIELDS) {
    const fieldValue = cleanText(value[field]);
    if (!fieldValue) continue;
    hasSource = true;
    const filename = safeFilename(fieldValue);
    if (filename) return { hasSource, filename };
  }

  return { hasSource, filename: '' };
};

const expandUploadSources = (sources) => sources.flatMap((source) => asItems(source));

const formatUploadNames = (sources, fallback) => {
  const filenames = [];

  for (const source of expandUploadSources(sources)) {
    const upload = describeUpload(source);
    if (!upload.hasSource) continue;

    const filename = upload.filename || fallback;
    if (filename && !filenames.includes(filename)) filenames.push(filename);
  }

  return filenames;
};

const humanizeType = (value) => {
  const text = cleanText(value);
  if (!text) return '';
  if (text.toLowerCase() === 'sla') return 'SLA';

  if (text === text.toLowerCase() || /[_-]/.test(text)) {
    return text
      .replace(/[_-]+/g, ' ')
      .replace(/\b[a-z]/g, (character) => character.toUpperCase());
  }

  return text;
};

const getPrimaryLocationIndex = (allResponses) => {
  if (!isObject(allResponses)) return null;

  const rawIndex = allResponses['5_primary'];
  if (rawIndex === '' || rawIndex == null || typeof rawIndex === 'boolean') return null;

  const index = Number(rawIndex);
  return Number.isInteger(index) && index >= 0 ? index : null;
};

const formatLocation = (location, index, primaryIndex) => {
  if (typeof location === 'string') {
    const name = cleanText(location);
    if (!name) return '';
    return index === primaryIndex ? `${name} (Primary)` : name;
  }

  if (!isObject(location) || Array.isArray(location)) return '';

  const nestedMeta = isObject(location.geographic_area_meta)
    ? location.geographic_area_meta
    : {};
  const name = firstText(
    nestedMeta.label,
    nestedMeta.name,
    nestedMeta.place_id,
    location.label,
    location.name,
    location.place_id
  );

  if (!name) return '';

  const isPrimary = nestedMeta.primary === true || location.primary === true || index === primaryIndex;
  return isPrimary ? `${name} (Primary)` : name;
};

const formatLocations = (answer, allResponses) => {
  const primaryIndex = getPrimaryLocationIndex(allResponses);
  return asItems(answer)
    .map((location, index) => formatLocation(location, index, primaryIndex))
    .filter(Boolean)
    .join('\n');
};

const formatServiceSelections = (answer) => asItems(answer)
  .map(formatServiceSelectionLabel)
  .filter(Boolean)
  .join('\n');

const formatCertification = (item) => {
  if (!isObject(item) || Array.isArray(item)) return formatGenericValue(item);

  const name = firstText(item.name, item.cert_item_name);
  const type = humanizeType(firstText(item.type, item.cert_item_type));
  const lines = [];

  if (name) lines.push(`${name}${type ? ` (${type})` : ''}`);
  else if (type) lines.push(`Type: ${type}`);

  const imageNames = formatUploadNames([
    item.cert_item_image_name,
    item.imageName,
    item.image,
    item.imageUrl,
    item.cert_item_image_url
  ], 'Uploaded image');
  if (imageNames.length) lines.push(`Image: ${imageNames[0]}`);

  const attachmentNames = formatUploadNames([
    item.files,
    item.supporting_files,
    item.cert_item_files,
    item.file,
    item.cert_item_file_name,
    item.fileUrl,
    item.cert_item_file_url
  ], 'Uploaded file');
  if (attachmentNames.length) lines.push(`Attachments: ${attachmentNames.join(', ')}`);

  return lines.join('\n');
};

const formatCertifications = (answer) => asItems(answer)
  .map(formatCertification)
  .filter(Boolean)
  .join('\n\n');

const formatGuarantee = (item) => {
  if (!isObject(item) || Array.isArray(item)) return formatGenericValue(item);

  const name = firstText(item.name, item.guarantee_name);
  const type = humanizeType(firstText(item.type, item.guarantee_type));
  const description = firstText(item.description, item.guarantee_description);
  const lines = [];

  if (name) lines.push(`${name}${type ? ` (${type})` : ''}`);
  else if (type) lines.push(`Type: ${type}`);
  if (description) lines.push(description);

  const attachmentNames = formatUploadNames([
    item.file,
    item.files,
    item.fileName,
    item.filename,
    item.guarantee_file_name,
    item.fileUrl,
    item.guarantee_file_url
  ], 'Uploaded file');

  if (attachmentNames.length === 1) lines.push(`Attachment: ${attachmentNames[0]}`);
  if (attachmentNames.length > 1) lines.push(`Attachments: ${attachmentNames.join(', ')}`);

  return lines.join('\n');
};

const formatGuarantees = (answer) => asItems(answer)
  .map(formatGuarantee)
  .filter(Boolean)
  .join('\n\n');

const formatTaggedPerson = (tag) => {
  if (!isObject(tag) || Array.isArray(tag)) return '';

  const nestedPerson = isObject(tag.person) ? tag.person : {};
  const name = firstText(nestedPerson.name, nestedPerson.label, tag.name);
  const position = firstText(
    nestedPerson.position,
    nestedPerson.title,
    nestedPerson.role,
    tag.position,
    tag.title,
    tag.role
  );

  if (!name) return '';
  return position ? `${name} - ${position}` : name;
};

const formatTeamPhoto = (answer) => {
  if (answer == null) return '';

  if (typeof answer === 'string') {
    const imageNames = formatUploadNames([answer], 'Uploaded image');
    return imageNames.length ? `Image: ${imageNames[0]}` : '';
  }

  if (!isObject(answer) || Array.isArray(answer)) return '';

  const imageNames = formatUploadNames([
    answer.imageName,
    answer.name,
    answer.fileName,
    answer.filename,
    answer.image,
    answer.imageUrl,
    answer.image_url,
    answer.url,
    answer.fileUrl,
    answer.file_url,
    answer.files,
    answer.uploadedFiles
  ], 'Uploaded image');

  const people = [
    ...asItems(answer.taggedPeople),
    ...asItems(answer.peopleTags),
    ...asItems(answer.people),
    ...asItems(answer.tags)
  ]
    .map(formatTaggedPerson)
    .filter(Boolean)
    .filter((person, index, allPeople) => allPeople.indexOf(person) === index);

  return [
    imageNames.length ? `Image: ${imageNames[0]}` : '',
    people.length ? `Tagged people: ${people.join('; ')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
};

const formatOtherValue = (value) => {
  if (Array.isArray(value)) {
    return value
      .map(formatGenericValue)
      .filter(Boolean)
      .join(', ');
  }
  return formatGenericValue(value);
};

export const formatAnswerForPdf = (
  questionId,
  answer,
  otherValue,
  allResponses = {}
) => {
  const normalizedQuestionId = cleanText(questionId);
  let mainAnswer = '';

  if (normalizedQuestionId === '3') {
    mainAnswer = formatServiceSelections(answer);
  } else if (normalizedQuestionId === '5') {
    mainAnswer = formatLocations(answer, allResponses);
  } else if (normalizedQuestionId === '12.1') {
    mainAnswer = formatCertifications(answer);
  } else if (normalizedQuestionId === '14.1') {
    mainAnswer = formatGuarantees(answer);
  } else if (normalizedQuestionId === '2.2') {
    mainAnswer = formatTeamPhoto(answer);
  } else {
    mainAnswer = formatGenericValue(answer);
  }

  const otherAnswer = formatOtherValue(otherValue);
  if (otherAnswer) {
    return mainAnswer ? `${mainAnswer}\nOther: ${otherAnswer}` : `Other: ${otherAnswer}`;
  }

  return typeof mainAnswer === 'string' ? mainAnswer : '';
};
