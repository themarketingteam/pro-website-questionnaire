export const QUESTIONNAIRE_PDF_THEME = Object.freeze({
  page: Object.freeze({
    widthPt: 612,
    blankMinHeightPt: 4356,
    horizontalMarginPt: 40,
    background: '#FFFFFF'
  }),
  colors: Object.freeze({
    purple: '#6464FF',
    accentPurple: '#3030FF',
    lavender: '#ECECFF',
    divider: '#C7C7FF',
    labelText: '#4B4F63',
    bodyText: '#000000',
    white: '#FFFFFF'
  }),
  layout: Object.freeze({
    sectionBarHeightPt: 22,
    businessRowMinHeightPt: 34,
    rowGapPt: 17,
    childIndentPt: 17,
    childAccentWidthPt: 3
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
