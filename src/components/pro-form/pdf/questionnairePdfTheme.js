export const QUESTIONNAIRE_PDF_TEMPLATE_REVISION = 'reference-2026-08-v1';

export const QUESTIONNAIRE_PDF_THEME = Object.freeze({
  page: Object.freeze({
    widthPt: 612,
    blankMinHeightPt: 4356,
    horizontalMarginPt: 39.6,
    background: '#FFFFFF'
  }),
  colors: Object.freeze({
    purple: '#6464FF',
    accentPurple: '#3030FF',
    lavender: '#ECECFF',
    divider: '#C7C7FF',
    businessDivider: '#E2E2E9',
    labelText: '#4B4F63',
    bodyText: '#000000',
    white: '#FFFFFF'
  }),
  header: Object.freeze({
    heightPt: 288.5,
    logoTopPt: 89.45,
    logoLeftPt: 9.05,
    logoWidthPt: 183.6,
    logoHeightPt: 35.3,
    titleTopPt: 139.3,
    serviceLabelTopPt: 207.2,
    dividerTopPt: 287.725,
    dividerHeightPt: 0.75
  }),
  layout: Object.freeze({
    contentTopGapPt: 9,
    sectionBarHeightPt: 22.4,
    sectionBarPaddingPt: 8.6,
    businessRowsGapPt: 15.1,
    businessRowMinHeightPt: 34,
    firstSectionGapPt: 19.6,
    secondSectionGapPt: 16.1,
    thirdSectionGapPt: 17.1,
    questionRowsGapPt: 15.2,
    rowGapPt: 17.1,
    rowGapAfterChildPt: 16.1,
    childIndentPt: 16.2,
    childRightInsetPt: 5.4,
    childAccentWidthPt: 2.25,
    cellHorizontalPaddingPt: 8.35
  }),
  typography: Object.freeze({
    titleSizePt: 27,
    titleLineHeightPt: 30.1,
    serviceLabelSizePt: 10.5,
    serviceLabelLineHeightPt: 12.7,
    sectionLabelSizePt: 10.5,
    sectionLabelLineHeightPt: 12.7,
    businessLabelSizePt: 11,
    businessLabelLineHeightPt: 13.3,
    answerSizePt: 10,
    answerLineHeightPt: 12.1,
    questionNumberSizePt: 9,
    questionNumberLineHeightPt: 11,
    questionTitleSizePt: 10,
    questionTitleLineHeightPt: 12.1,
    childNumberSizePt: 8.5,
    childNumberLineHeightPt: 10.2,
    childTitleSizePt: 9.5,
    childTitleLineHeightPt: 11.5
  }),
  canvas: Object.freeze({
    desiredScale: 2,
    maximumAreaPx: 16_000_000,
    maximumDimensionPx: 16_384,
    minimumReadableScale: 1.25
  })
});

export const getSafeQuestionnaireCanvasScale = ({
  widthPx,
  heightPx,
  desiredScale = QUESTIONNAIRE_PDF_THEME.canvas.desiredScale
} = {}) => {
  const width = Number(widthPx);
  const height = Number(heightPx);
  const desired = Number(desiredScale);

  if (!(width > 0) || !(height > 0) || !(desired > 0)) {
    throw new TypeError('PDF canvas dimensions and desired scale must be positive numbers.');
  }

  const { maximumAreaPx, maximumDimensionPx } = QUESTIONNAIRE_PDF_THEME.canvas;
  const dimensionScale = maximumDimensionPx / Math.max(width, height);
  const areaScale = Math.sqrt(maximumAreaPx / (width * height));

  return Math.floor(Math.min(desired, dimensionScale, areaScale) * 1000) / 1000;
};
