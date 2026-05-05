import { base44 } from '@/api/base44Client';
import { trackClarityEvent } from '@/lib/clarity';

export const serializeSubmitError = (error) => ({
  name: error?.name || '',
  message: error?.message || String(error || ''),
  status: error?.status || error?.response?.status || '',
  data: error?.response?.data || null,
  stack: import.meta.env.DEV ? error?.stack : undefined
});

const safeJsonStringify = (value) => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
};

const asTrimmedString = (value) =>
  typeof value === 'string' ? value.trim() : '';

const asNumberOrNull = (value) => {
  if (value == null || value === '') return null;

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
};

const normalizeGeographicAreas = (locations = [], primaryIndex = 0) =>
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

const normalizeCertifications = (items = []) =>
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

const normalizeTeamPhoto = (answer) => {
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

const normalizeGuarantees = (items = []) =>
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

export const transformResponsesToPayload = (responses, businessName, domain, serviceOptionsGrouped = {}) => {
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

export const writeFailedSubmissionBackup = ({
  questionnaireSessionId,
  responseSnapshot,
  transformedPayload,
  error
}) => {
  try {
    localStorage.setItem(
      `failed_pro_submission_${Date.now()}`,
      JSON.stringify({
        session_id: questionnaireSessionId,
        responses: responseSnapshot,
        transformedPayload,
        error,
        createdAt: new Date().toISOString()
      })
    );
  } catch (storageError) {
    console.error(
      'Could not write failed submission backup:',
      serializeSubmitError(storageError)
    );
  }
};

export const writeDraftFailureBackup = ({
  questionnaireSessionId,
  responses,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  error
}) => {
  try {
    localStorage.setItem(
      `pro_questionnaire_local_backup_${questionnaireSessionId}`,
      JSON.stringify({
        session_id: questionnaireSessionId,
        responses,
        validationStatus,
        touchedQuestions,
        expandedQuestions,
        error,
        savedAt: new Date().toISOString()
      })
    );
  } catch {
    // no-op
  }
};

export const safeDraftSave = async ({
  saveDraftNow,
  questionnaireSessionId,
  responsesSnapshot,
  validationStatusSnapshot,
  touchedQuestionsSnapshot,
  expandedQuestionsSnapshot,
  options = {}
}) => {
  if (typeof saveDraftNow !== 'function') {
    return null;
  }

  try {
    return await saveDraftNow({
      ...options,
      responsesSnapshot,
      validationStatusSnapshot,
      touchedQuestionsSnapshot,
      expandedQuestionsSnapshot
    });
  } catch (error) {
    const serialized = serializeSubmitError(error);

    console.error('Non-fatal draft save failed:', serialized);

    writeDraftFailureBackup({
      questionnaireSessionId,
      responses: responsesSnapshot,
      validationStatus: validationStatusSnapshot,
      touchedQuestions: touchedQuestionsSnapshot,
      expandedQuestions: expandedQuestionsSnapshot,
      error: serialized
    });

    return null;
  }
};

export const createDraftEventSafe = async ({
  createDraftEvent,
  eventType,
  questionId = '',
  value = {}
}) => {
  if (typeof createDraftEvent !== 'function') {
    return null;
  }

  try {
    return await createDraftEvent({
      eventType,
      questionId,
      value
    });
  } catch (error) {
    console.error('Non-fatal draft event failed:', serializeSubmitError(error));
    return null;
  }
};

export const sendZapierSafe = async (transformedPayload) => {
  try {
    await base44.functions.invoke('sendToZapier', transformedPayload);
    return { ok: true };
  } catch (error) {
    console.error(
      'Zapier webhook failed after successful database save:',
      serializeSubmitError(error)
    );

    return {
      ok: false,
      error: serializeSubmitError(error)
    };
  }
};

export const submitProQuestionnaire = async ({
  businessName,
  domain,
  responses,
  validationStatus,
  touchedQuestions,
  expandedQuestions,
  credentials,
  domainParam,
  questionnaireSessionId,
  saveDraftNow,
  createDraftEvent,
  onFinalSubmitSuccess,
  onFinalSubmitFailure,
  serviceOptionsGrouped = {}
}) => {
  const responseSnapshot = { ...responses };

  const transformedPayload = transformResponsesToPayload(
    responseSnapshot,
    businessName,
    domain,
    serviceOptionsGrouped
  );

  const validation = validateSubmissionPayload(transformedPayload);

  if (!validation.ok) {
    const message = `Invalid questionnaire payload: ${validation.errors.join(' ')}`;

    console.error(message, validation.errors);

    trackClarityEvent('pro_questionnaire_validation_failed', {
      validation_failed_question_id: 'submission_payload',
      business_domain: domain || credentials?.domain || domainParam || 'unknown'
    });

    throw new Error(message);
  }

  trackClarityEvent('pro_questionnaire_submit_attempt', {
    completed_questions: Object.keys(responseSnapshot).length,
    submit_status: 'attempted',
    business_domain: domain || credentials?.domain || domainParam || 'unknown'
  });

  await createDraftEventSafe({
    createDraftEvent,
    eventType: 'submit_attempted',
    value: {
      status: 'submit_attempted'
    }
  });

  await safeDraftSave({
    saveDraftNow,
    questionnaireSessionId,
    responsesSnapshot: responseSnapshot,
    validationStatusSnapshot: validationStatus,
    touchedQuestionsSnapshot: touchedQuestions,
    expandedQuestionsSnapshot: expandedQuestions,
    options: {
      status: 'submit_attempted'
    }
  });

  let savedSubmission;

  try {
    savedSubmission = await base44.entities.ProFormSubmission.create(
      transformedPayload
    );
  } catch (error) {
    const serialized = serializeSubmitError(error);

    console.error('ProFormSubmission.create failed:', serialized);

    await createDraftEventSafe({
      createDraftEvent,
      eventType: 'submit_failed',
      value: {
        status: 'submit_failed',
        error_message: error?.message || 'unknown'
      }
    });

    await safeDraftSave({
      saveDraftNow,
      questionnaireSessionId,
      responsesSnapshot: responseSnapshot,
      validationStatusSnapshot: validationStatus,
      touchedQuestionsSnapshot: touchedQuestions,
      expandedQuestionsSnapshot: expandedQuestions,
      options: {
        status: 'submit_failed',
        submitError: safeJsonStringify(serialized)
      }
    });

    writeFailedSubmissionBackup({
      questionnaireSessionId,
      responseSnapshot,
      transformedPayload,
      error: serialized
    });

    trackClarityEvent('pro_questionnaire_submit_failed', {
      completed_questions: Object.keys(responseSnapshot).length,
      submit_status: 'failed',
      business_domain: domain || credentials?.domain || domainParam || 'unknown',
      error_message: error?.message || 'unknown'
    });

    if (typeof onFinalSubmitFailure === 'function') {
      onFinalSubmitFailure({
        error,
        serialized,
        responseSnapshot,
        transformedPayload
      });
    }

    throw error;
  }

  await safeDraftSave({
    saveDraftNow,
    questionnaireSessionId,
    responsesSnapshot: responseSnapshot,
    validationStatusSnapshot: validationStatus,
    touchedQuestionsSnapshot: touchedQuestions,
    expandedQuestionsSnapshot: expandedQuestions,
    options: {
      status: 'submitted',
      finalSubmissionId: savedSubmission?.id || ''
    }
  });

  await createDraftEventSafe({
    createDraftEvent,
    eventType: 'submitted',
    value: {
      status: 'submitted',
      final_submission_id: savedSubmission?.id || ''
    }
  });

  await sendZapierSafe(transformedPayload);

  try {
    trackClarityEvent('pro_questionnaire_submit_success', {
      completed_questions: Object.keys(responseSnapshot).length,
      submit_status: 'success',
      business_domain: domain || credentials?.domain || domainParam || 'unknown'
    });
  } catch (error) {
    console.error('Non-fatal clarity submit success tracking failed:', serializeSubmitError(error));
  }

  if (typeof onFinalSubmitSuccess === 'function') {
    onFinalSubmitSuccess({
      savedSubmission,
      responseSnapshot,
      transformedPayload
    });
  }

  return {
    savedSubmission,
    responseSnapshot,
    transformedPayload
  };
};