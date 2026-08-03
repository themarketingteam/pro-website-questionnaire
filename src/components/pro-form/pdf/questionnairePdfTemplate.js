import { escapeHtml } from '../answerFormatting';
import { QUESTIONNAIRE_PDF_THEME } from './questionnairePdfTheme';

const { colors, layout, page } = QUESTIONNAIRE_PDF_THEME;

const preserveLineBreaks = (value) => escapeHtml(value).replace(/\r?\n/g, '<br />');

const buildBusinessRows = (rows) => rows.map((row) => `
  <div class="questionnaire-pdf-business-row" data-business-key="${escapeHtml(row.key)}">
    <div class="questionnaire-pdf-business-label">${escapeHtml(row.label)}</div>
    <div class="questionnaire-pdf-business-value">${preserveLineBreaks(row.value)}</div>
  </div>
`).join('');

const buildQuestionRows = (rows) => rows.map((row) => `
  <div
    class="questionnaire-pdf-row${row.isChild ? ' questionnaire-pdf-row--child' : ''}"
    data-question-id="${escapeHtml(row.id)}"
    data-question-type="${escapeHtml(row.type)}"
    style="--questionnaire-row-min-height: ${Number(row.minHeightPt)}pt;"
  >
    <div class="questionnaire-pdf-question-cell">
      <div class="questionnaire-pdf-question-number">Question ${escapeHtml(row.id)}:</div>
      <div class="questionnaire-pdf-question-title">${escapeHtml(row.title)}</div>
    </div>
    <div class="questionnaire-pdf-answer-cell">${preserveLineBreaks(row.answer)}</div>
  </div>
`).join('');

const buildSections = (sections) => sections.map((section, index) => `
  <section class="questionnaire-pdf-section questionnaire-pdf-section--${index + 1}">
    <div class="questionnaire-pdf-section-bar">${escapeHtml(section.title)}</div>
    <div class="questionnaire-pdf-question-rows">${buildQuestionRows(section.rows)}</div>
  </section>
`).join('');

export const buildQuestionnairePdfHtml = (model, { logoUrl } = {}) => {
  if (!model || typeof model !== 'object') {
    throw new TypeError('A questionnaire PDF model is required.');
  }

  return `
    <style>
      .questionnaire-pdf-document,
      .questionnaire-pdf-document * {
        box-sizing: border-box;
      }

      .questionnaire-pdf-document {
        width: ${page.widthPt}pt;
        min-height: ${page.blankMinHeightPt}pt;
        margin: 0;
        overflow: hidden;
        background: ${page.background};
        color: ${colors.bodyText};
        font-family: Inter, Arial, sans-serif;
        font-synthesis: none;
      }

      .questionnaire-pdf-header {
        position: relative;
        height: 288.5pt;
        margin: 0 ${page.horizontalMarginPt}pt;
      }

      .questionnaire-pdf-logo {
        position: absolute;
        top: 87.36pt;
        left: 6.72pt;
        display: block;
        width: 187.68pt;
        height: 39.36pt;
        object-fit: contain;
      }

      .questionnaire-pdf-title {
        position: absolute;
        top: 139.5pt;
        left: 0;
        margin: 0;
        color: ${colors.purple};
        font-size: 24pt;
        font-weight: 700;
        line-height: 29.5pt;
        letter-spacing: -0.5pt;
      }

      .questionnaire-pdf-service-label {
        position: absolute;
        top: 208pt;
        left: 0;
        margin: 0;
        color: ${colors.bodyText};
        font-size: 8.5pt;
        font-weight: 400;
        line-height: 11pt;
      }

      .questionnaire-pdf-header-divider {
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        height: 1pt;
        background: ${colors.divider};
      }

      .questionnaire-pdf-content {
        margin: 9pt ${page.horizontalMarginPt}pt 118pt;
      }

      .questionnaire-pdf-section-bar {
        display: flex;
        align-items: center;
        width: 100%;
        height: ${layout.sectionBarHeightPt}pt;
        padding: 0 8pt;
        background: ${colors.purple};
        color: ${colors.white};
        font-size: 8pt;
        font-weight: 700;
        line-height: 1;
      }

      .questionnaire-pdf-business-rows,
      .questionnaire-pdf-question-rows {
        margin-top: 16pt;
      }

      .questionnaire-pdf-business-row {
        display: grid;
        grid-template-columns: 1fr 2fr;
        min-height: ${layout.businessRowMinHeightPt}pt;
        align-items: stretch;
      }

      .questionnaire-pdf-business-label,
      .questionnaire-pdf-business-value {
        display: flex;
        align-items: center;
        min-width: 0;
        padding: 7pt 10pt;
        overflow-wrap: anywhere;
      }

      .questionnaire-pdf-business-label {
        border-bottom: 0.5pt solid ${colors.divider};
        background: ${colors.lavender};
        color: ${colors.labelText};
        font-size: 9pt;
        font-weight: 700;
        line-height: 11pt;
      }

      .questionnaire-pdf-business-value {
        background: ${colors.white};
        color: ${colors.bodyText};
        font-size: 8pt;
        font-weight: 400;
        line-height: 11pt;
        white-space: pre-wrap;
      }

      .questionnaire-pdf-section {
        margin-top: 16pt;
      }

      .questionnaire-pdf-section--1 {
        margin-top: 20pt;
      }

      .questionnaire-pdf-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        width: 100%;
        min-height: var(--questionnaire-row-min-height);
        align-items: stretch;
      }

      .questionnaire-pdf-row + .questionnaire-pdf-row {
        margin-top: ${layout.rowGapPt}pt;
      }

      .questionnaire-pdf-row--child {
        grid-template-columns: calc(50% - 3pt) calc(50% + 3pt);
        width: calc(100% - ${layout.childIndentPt}pt);
        margin-left: ${layout.childIndentPt}pt;
        border-left: ${layout.childAccentWidthPt}pt solid ${colors.purple};
      }

      .questionnaire-pdf-question-cell,
      .questionnaire-pdf-answer-cell {
        min-width: 0;
        min-height: 100%;
      }

      .questionnaire-pdf-question-cell {
        padding: 8pt 10pt 9pt;
        background: ${colors.lavender};
      }

      .questionnaire-pdf-answer-cell {
        padding: 8pt 10pt 9pt;
        background: ${colors.white};
        color: ${colors.bodyText};
        font-size: 8pt;
        font-weight: 400;
        line-height: 11pt;
        overflow-wrap: anywhere;
        word-break: break-word;
        white-space: pre-wrap;
      }

      .questionnaire-pdf-question-number {
        margin: 0 0 8pt;
        color: ${colors.accentPurple};
        font-size: 7pt;
        font-weight: 700;
        line-height: 9pt;
      }

      .questionnaire-pdf-question-title {
        margin: 0;
        color: ${colors.bodyText};
        font-size: 8pt;
        font-weight: 700;
        line-height: 10.5pt;
      }

      .questionnaire-pdf-row--child .questionnaire-pdf-question-number {
        font-size: 6.5pt;
        line-height: 8pt;
      }

      .questionnaire-pdf-row--child .questionnaire-pdf-question-title {
        font-size: 7.5pt;
        line-height: 10pt;
      }
    </style>
    <article class="questionnaire-pdf-document" data-questionnaire-pdf-document>
      <header class="questionnaire-pdf-header">
        <img
          class="questionnaire-pdf-logo"
          data-questionnaire-pdf-logo
          src="${escapeHtml(logoUrl)}"
          alt="Kaseya MSP Success Digital"
        />
        <h1 class="questionnaire-pdf-title">
          ${model.header.titleLines.map((line) => `<span>${escapeHtml(line)}</span>`).join('<br />')}
        </h1>
        <p class="questionnaire-pdf-service-label">${escapeHtml(model.header.serviceLabel)}</p>
        <div class="questionnaire-pdf-header-divider"></div>
      </header>
      <main class="questionnaire-pdf-content">
        <section class="questionnaire-pdf-business">
          <div class="questionnaire-pdf-section-bar">Business Information</div>
          <div class="questionnaire-pdf-business-rows">${buildBusinessRows(model.businessInformation)}</div>
        </section>
        ${buildSections(model.sections)}
      </main>
    </article>
  `;
};

export const createQuestionnairePdfContainer = ({
  model,
  logoUrl,
  ownerDocument = document
}) => {
  const container = ownerDocument.createElement('div');
  container.dataset.questionnairePdfRenderRoot = 'true';
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, {
    position: 'absolute',
    top: '0',
    left: '-100000px',
    width: `${page.widthPt}pt`,
    margin: '0',
    padding: '0',
    pointerEvents: 'none',
    background: page.background
  });
  container.innerHTML = buildQuestionnairePdfHtml(model, { logoUrl });
  return container;
};
