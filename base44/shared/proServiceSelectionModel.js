export const SERVICE_PARENT_PREFIX = 'PARENT:';
export const LEGACY_SERVICE_CATEGORY_PREFIX = 'CATEGORY:';

const cleanSelection = (value) => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

  for (const key of ['label', 'value', 'name', 'title']) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return value[key].trim();
    }
  }

  return '';
};

const selectionList = (value) => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const seen = new Set();

  return values
    .map(cleanSelection)
    .filter(Boolean)
    .filter((selection) => {
      if (seen.has(selection)) return false;
      seen.add(selection);
      return true;
    });
};

export const serviceParentSelection = (parentName) => (
  `${SERVICE_PARENT_PREFIX}${String(parentName || '').trim()}`
);

export const isServiceParentSelection = (selection) => (
  typeof selection === 'string' && selection.startsWith(SERVICE_PARENT_PREFIX)
);

export const isLegacyServiceCategorySelection = (selection) => (
  typeof selection === 'string' && selection.startsWith(LEGACY_SERVICE_CATEGORY_PREFIX)
);

export const serviceParentNameFromSelection = (selection) => {
  const value = cleanSelection(selection);
  if (isServiceParentSelection(value)) {
    return value.slice(SERVICE_PARENT_PREFIX.length).trim();
  }
  if (isLegacyServiceCategorySelection(value)) {
    return value.slice(LEGACY_SERVICE_CATEGORY_PREFIX.length).trim();
  }
  return '';
};

export const formatServiceSelectionLabel = (selection) => (
  serviceParentNameFromSelection(selection) || cleanSelection(selection)
);

export const analyzeServiceSelections = (value, groupedOptions = {}) => {
  const groups = Object.entries(groupedOptions || {}).map(([parentName, options]) => ({
    parentName,
    options: Array.isArray(options) ? options : []
  }));
  const groupNames = new Set(groups.map(({ parentName }) => parentName));
  const childToParent = new Map();

  groups.forEach(({ parentName, options }) => {
    options.forEach((option) => {
      if (!childToParent.has(option)) childToParent.set(option, parentName);
    });
  });

  const selectedParents = new Set();
  const selectedChildren = new Set();
  const extraSelections = [];
  const extraSeen = new Set();

  const addExtra = (selection) => {
    if (!selection || extraSeen.has(selection)) return;
    extraSeen.add(selection);
    extraSelections.push(selection);
  };

  selectionList(value).forEach((selection) => {
    const markedParentName = serviceParentNameFromSelection(selection);

    if (markedParentName) {
      if (!groupNames.has(markedParentName)) {
        addExtra(markedParentName);
        return;
      }

      selectedParents.add(markedParentName);
      if (isLegacyServiceCategorySelection(selection)) {
        const legacyChildren = groupedOptions[markedParentName] || [];
        legacyChildren.forEach((child) => selectedChildren.add(child));
      }
      return;
    }

    if (groupNames.has(selection)) {
      selectedParents.add(selection);
      return;
    }

    const parentName = childToParent.get(selection);
    if (parentName) {
      selectedParents.add(parentName);
      selectedChildren.add(selection);
      return;
    }

    addExtra(selection);
  });

  const canonicalSelections = [];
  const payloadSelections = [];
  const parentsWithoutChildren = [];

  groups.forEach(({ parentName, options }) => {
    if (!selectedParents.has(parentName)) return;

    canonicalSelections.push(serviceParentSelection(parentName));
    payloadSelections.push(parentName);

    const selectedForParent = options.filter((option) => selectedChildren.has(option));
    if (selectedForParent.length === 0) parentsWithoutChildren.push(parentName);
    canonicalSelections.push(...selectedForParent);
    payloadSelections.push(...selectedForParent);
  });

  canonicalSelections.push(...extraSelections);
  payloadSelections.push(...extraSelections);

  return {
    canonicalSelections,
    payloadSelections,
    selectedParents,
    selectedChildren,
    parentsWithoutChildren,
    countedChildSelections: selectedChildren.size + extraSelections.length
  };
};

export const canonicalizeServiceSelectionState = (value, groupedOptions = {}) => (
  analyzeServiceSelections(value, groupedOptions).canonicalSelections
);

export const normalizeServiceSelectionsForPayload = (value, groupedOptions = {}) => (
  analyzeServiceSelections(value, groupedOptions).payloadSelections
);

export const countSelectedServiceChildren = (value, groupedOptions = {}) => (
  analyzeServiceSelections(value, groupedOptions).countedChildSelections
);

export const getServiceParentsWithoutChildren = (value, groupedOptions = {}) => (
  analyzeServiceSelections(value, groupedOptions).parentsWithoutChildren
);
