import { QUESTIONS } from '../questionData';
import { formatAnswerForPdf } from './pdfAnswerFormatting';

export const QUESTIONNAIRE_PDF_MIN_HEIGHTS_PT = Object.freeze({
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
});

const PDF_SECTION_ORDER = Object.freeze([
  'Additional Page Options',
  'About Your Business',
  'About Your Target Clients'
]);

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const SUBMISSION_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

const cleanBusinessValue = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const isParentAnsweredYes = (value) => (
  typeof value === 'string' && value.trim().toLowerCase() === 'yes'
);

const parseSubmissionDate = (submissionDate) => {
  if (submissionDate instanceof Date) {
    const copiedDate = new Date(submissionDate.getTime());
    return Number.isNaN(copiedDate.getTime()) ? new Date() : copiedDate;
  }

  if (typeof submissionDate === 'string') {
    const trimmedDate = submissionDate.trim();
    const dateOnlyMatch = DATE_ONLY_PATTERN.exec(trimmedDate);
    const parsedDate = dateOnlyMatch
      ? new Date(
        Number(dateOnlyMatch[1]),
        Number(dateOnlyMatch[2]) - 1,
        Number(dateOnlyMatch[3])
      )
      : new Date(trimmedDate);

    if (!Number.isNaN(parsedDate.getTime())) return parsedDate;
  }

  return new Date();
};

const formatSubmissionDate = (submissionDate) => (
  SUBMISSION_DATE_FORMATTER.format(parseSubmissionDate(submissionDate))
);

const buildQuestionRow = ({
  question,
  formData,
  parentId = null,
  populateAnswer = true
}) => {
  const shouldPopulateAnswer = populateAnswer && question.type !== 'info_message';
  const answer = shouldPopulateAnswer
    ? formatAnswerForPdf(
      question.id,
      formData[question.id],
      formData[`${question.id}_other`],
      formData
    )
    : '';

  return {
    id: question.id,
    parentId,
    isChild: parentId !== null,
    title: question.title,
    type: question.type,
    answer,
    minHeightPt: QUESTIONNAIRE_PDF_MIN_HEIGHTS_PT[question.id]
  };
};

export const buildQuestionnairePdfModel = ({
  formData,
  businessName,
  domain,
  submissionDate
} = {}) => {
  const safeFormData = formData && typeof formData === 'object' && !Array.isArray(formData)
    ? formData
    : {};

  const sections = PDF_SECTION_ORDER.map((sectionTitle) => {
    const rows = [];
    const sectionQuestions = QUESTIONS.filter((question) => question.section === sectionTitle);

    sectionQuestions.forEach((question) => {
      rows.push(buildQuestionRow({ question, formData: safeFormData }));

      const populateChildAnswers = isParentAnsweredYes(safeFormData[question.id]);
      const children = Array.isArray(question.conditionalChildren)
        ? question.conditionalChildren
        : [];

      children.forEach((childQuestion) => {
        rows.push(buildQuestionRow({
          question: childQuestion,
          formData: safeFormData,
          parentId: question.id,
          populateAnswer: populateChildAnswers
        }));
      });
    });

    return { title: sectionTitle, rows };
  });

  return {
    header: {
      titleLines: ['Website Content', 'Questionnaire'],
      serviceLabel: 'MSP Success - Pro Service'
    },
    businessInformation: [
      {
        key: 'businessName',
        label: 'Business Name',
        value: cleanBusinessValue(businessName)
      },
      {
        key: 'domain',
        label: 'Domain',
        value: cleanBusinessValue(domain)
      },
      {
        key: 'submissionDate',
        label: 'Submission Date',
        value: formatSubmissionDate(submissionDate)
      }
    ],
    sections
  };
};
