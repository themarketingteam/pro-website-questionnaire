import { describe, expect, it } from 'vitest';
import { QUESTIONS } from '@/components/pro-form/questionData';
import {
  buildQuestionnairePdfModel,
  QUESTIONNAIRE_PDF_MIN_HEIGHTS_PT
} from '@/components/pro-form/pdf/questionnairePdfModel';

const EXPECTED_ID_ORDER = [
  '1',
  '1.1',
  '1.2',
  '2',
  '2.1',
  '2.2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '12.1',
  '13',
  '14',
  '14.1',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '23.1',
  '24',
  '25',
  '25.1'
];

const EXPECTED_MIN_HEIGHTS = {
  '1': 76,
  '1.1': 71,
  '1.2': 71,
  '2': 76,
  '2.1': 84,
  '2.2': 71,
  '3': 104,
  '4': 90,
  '5': 90,
  '6': 146,
  '7': 90,
  '8': 90,
  '9': 118,
  '10': 90,
  '11': 90,
  '12': 76,
  '12.1': 97,
  '13': 132,
  '14': 76,
  '14.1': 97,
  '15': 76,
  '16': 90,
  '17': 76,
  '18': 104,
  '19': 104,
  '20': 104,
  '21': 104,
  '22': 104,
  '23': 76,
  '23.1': 110,
  '24': 90,
  '25': 76,
  '25.1': 175
};

const flattenRows = (model) => model.sections.flatMap((section) => section.rows);
const findRow = (model, id) => flattenRows(model).find((row) => row.id === id);

describe('buildQuestionnairePdfModel', () => {
  it('always includes all 33 rows in exact questionnaire order', () => {
    const rows = flattenRows(buildQuestionnairePdfModel({ formData: {} }));

    expect(rows).toHaveLength(33);
    expect(rows.map((row) => row.id)).toEqual(EXPECTED_ID_ORDER);
    expect(rows.every((row) => row.answer === '')).toBe(true);
  });

  it('uses the required section order and row counts', () => {
    const model = buildQuestionnairePdfModel({ formData: {} });

    expect(model.sections.map((section) => section.title)).toEqual([
      'Additional Page Options',
      'About Your Business',
      'About Your Target Clients'
    ]);
    expect(model.sections.map((section) => section.rows.length)).toEqual([6, 16, 11]);
  });

  it('keeps every conditional subquestion present even when blank', () => {
    const rows = flattenRows(buildQuestionnairePdfModel({ formData: {} }));
    const childRows = rows.filter((row) => row.isChild);

    expect(childRows.map((row) => row.id)).toEqual([
      '1.1',
      '1.2',
      '2.1',
      '2.2',
      '12.1',
      '14.1',
      '23.1',
      '25.1'
    ]);
    expect(childRows.every((row) => row.answer === '')).toBe(true);
    expect(childRows.every((row) => row.parentId !== null)).toBe(true);
  });

  it('formats top-level yes and no answers for the PDF', () => {
    const model = buildQuestionnairePdfModel({
      formData: { '1': 'yes', '2': 'no' }
    });

    expect(findRow(model, '1').answer).toBe('Yes');
    expect(findRow(model, '2').answer).toBe('No');
  });

  it('shows a child answer only when its parent is Yes', () => {
    const visibleModel = buildQuestionnairePdfModel({
      formData: {
        '23': 'yes',
        '23.1': 'Restaurants and retail stores.'
      }
    });
    const hiddenModel = buildQuestionnairePdfModel({
      formData: {
        '23': 'no',
        '23.1': 'Stale hidden answer'
      }
    });
    const unansweredParentModel = buildQuestionnairePdfModel({
      formData: { '23.1': 'Another stale hidden answer' }
    });

    expect(findRow(visibleModel, '23.1').answer).toBe('Restaurants and retail stores.');
    expect(findRow(hiddenModel, '23.1').answer).toBe('');
    expect(findRow(unansweredParentModel, '23.1').answer).toBe('');
  });

  it('keeps informational Question 1.2 blank', () => {
    const model = buildQuestionnairePdfModel({
      formData: {
        '1': 'yes',
        '1.2': 'Stale value that is not a user response'
      }
    });

    expect(findRow(model, '1.2').type).toBe('info_message');
    expect(findRow(model, '1.2').answer).toBe('');
  });

  it('builds business information in a stable order with a deterministic Date', () => {
    const model = buildQuestionnairePdfModel({
      formData: {},
      businessName: '  Acme IT  ',
      domain: '  acme.example  ',
      submissionDate: new Date(2026, 0, 15, 12, 0, 0)
    });

    expect(model.businessInformation).toEqual([
      { key: 'businessName', label: 'Business Name', value: 'Acme IT' },
      { key: 'domain', label: 'Domain', value: 'acme.example' },
      { key: 'submissionDate', label: 'Submission Date', value: 'January 15, 2026' }
    ]);
  });

  it('supports valid date-only strings without timezone date drift', () => {
    const model = buildQuestionnairePdfModel({
      formData: {},
      submissionDate: '2026-08-03'
    });

    expect(model.businessInformation[2].value).toBe('August 3, 2026');
  });

  it('uses the complete shared minimum-height contract', () => {
    const rows = flattenRows(buildQuestionnairePdfModel({ formData: {} }));

    expect(QUESTIONNAIRE_PDF_MIN_HEIGHTS_PT).toEqual(EXPECTED_MIN_HEIGHTS);
    expect(Object.isFrozen(QUESTIONNAIRE_PDF_MIN_HEIGHTS_PT)).toBe(true);
    expect(Object.fromEntries(rows.map((row) => [row.id, row.minHeightPt])))
      .toEqual(EXPECTED_MIN_HEIGHTS);
  });

  it('sources row titles and types from QUESTIONS without changing them', () => {
    const model = buildQuestionnairePdfModel({ formData: {} });
    const rows = flattenRows(model);
    const configuredQuestions = QUESTIONS.flatMap((question) => [
      question,
      ...(question.conditionalChildren || [])
    ]);

    expect(rows.map(({ id, title, type }) => ({ id, title, type }))).toEqual(
      configuredQuestions.map(({ id, title, type }) => ({ id, title, type }))
    );
  });

  it('does not mutate formData or QUESTIONS', () => {
    const formData = {
      '1': 'yes',
      '1.1': 'We combine strategy, support, and security.',
      '5': [{ label: 'Chicago, IL', nested: { unchanged: true } }],
      '5_primary': 0
    };
    const originalFormData = structuredClone(formData);
    const originalQuestions = structuredClone(QUESTIONS);

    buildQuestionnairePdfModel({
      formData,
      businessName: 'Acme IT',
      domain: 'acme.example',
      submissionDate: new Date(2026, 0, 15)
    });

    expect(formData).toEqual(originalFormData);
    expect(QUESTIONS).toEqual(originalQuestions);
  });
});
