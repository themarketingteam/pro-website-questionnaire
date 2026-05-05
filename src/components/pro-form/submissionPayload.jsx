export const serializeError = (error) => ({
  name: error?.name,
  message: error?.message,
  status: error?.status || error?.response?.status,
  data: error?.response?.data,
  stack: import.meta.env.DEV ? error?.stack : undefined
});

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

  for (const field of arrayFields) {
    if (!Array.isArray(payload.userdata?.[field])) {
      errors.push(`userdata.${field} must be an array.`);
    }
  }

  return { ok: errors.length === 0, errors };
};