import { describe, expect, it } from 'vitest';
import {
  getSafeQuestionnaireCanvasScale,
  QUESTIONNAIRE_PDF_TEMPLATE_REVISION,
  QUESTIONNAIRE_PDF_THEME
} from '@/components/pro-form/pdf/questionnairePdfTheme';
import questionnaireLogoUrl from '@/assets/mspSuccessDigitalLogo';

describe('QUESTIONNAIRE_PDF_THEME', () => {
  it('locks the reference page, color, and square-layout contract', () => {
    expect(QUESTIONNAIRE_PDF_THEME.page).toEqual({
      widthPt: 612,
      blankMinHeightPt: 4356,
      horizontalMarginPt: 39.6,
      background: '#FFFFFF'
    });
    expect(QUESTIONNAIRE_PDF_THEME.colors).toEqual({
      purple: '#6464FF',
      accentPurple: '#3030FF',
      lavender: '#ECECFF',
      divider: '#C7C7FF',
      businessDivider: '#E2E2E9',
      labelText: '#4B4F63',
      bodyText: '#000000',
      white: '#FFFFFF'
    });
    expect(QUESTIONNAIRE_PDF_THEME.header).toEqual({
      heightPt: 288.5,
      logoTopPt: 89.45,
      logoLeftPt: 9.05,
      logoWidthPt: 183.6,
      logoHeightPt: 35.3,
      titleTopPt: 139.3,
      serviceLabelTopPt: 207.2,
      dividerTopPt: 287.725,
      dividerHeightPt: 0.75
    });
    expect(QUESTIONNAIRE_PDF_THEME.layout).toEqual({
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
    });
    expect(QUESTIONNAIRE_PDF_THEME.typography).toEqual({
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
    });
    expect(QUESTIONNAIRE_PDF_TEMPLATE_REVISION).toBe('reference-2026-08-v1');
    expect(Object.isFrozen(QUESTIONNAIRE_PDF_THEME)).toBe(true);
    expect(Object.isFrozen(QUESTIONNAIRE_PDF_THEME.colors)).toBe(true);
    expect(Object.isFrozen(QUESTIONNAIRE_PDF_THEME.typography)).toBe(true);
  });

  it('keeps a blank-page capture inside the configured area and dimension limits', () => {
    const widthPx = 816;
    const heightPx = 5808;
    const scale = getSafeQuestionnaireCanvasScale({ widthPx, heightPx });
    const { maximumAreaPx, maximumDimensionPx } = QUESTIONNAIRE_PDF_THEME.canvas;

    expect(scale).toBeGreaterThanOrEqual(1.8);
    expect(scale).toBeLessThanOrEqual(2);
    expect(widthPx * scale).toBeLessThanOrEqual(maximumDimensionPx);
    expect(heightPx * scale).toBeLessThanOrEqual(maximumDimensionPx);
    expect(widthPx * heightPx * scale * scale).toBeLessThanOrEqual(maximumAreaPx);
  });

  it('reduces scale for longer documents without exceeding either canvas limit', () => {
    const widthPx = 816;
    const heightPx = 9000;
    const scale = getSafeQuestionnaireCanvasScale({ widthPx, heightPx });
    const { maximumAreaPx, maximumDimensionPx } = QUESTIONNAIRE_PDF_THEME.canvas;

    expect(scale).toBeLessThan(2);
    expect(widthPx * heightPx * scale * scale).toBeLessThanOrEqual(maximumAreaPx);
    expect(heightPx * scale).toBeLessThanOrEqual(maximumDimensionPx);
  });

  it('rejects missing or invalid canvas dimensions', () => {
    expect(() => getSafeQuestionnaireCanvasScale({ widthPx: 0, heightPx: 100 }))
      .toThrow(/positive numbers/i);
    expect(() => getSafeQuestionnaireCanvasScale({ widthPx: 100, heightPx: NaN }))
      .toThrow(/positive numbers/i);
  });

  it('uses the exact locally embedded 411 by 79 reference logo crop', () => {
    const png = Buffer.from(questionnaireLogoUrl.split(',')[1], 'base64');

    expect(questionnaireLogoUrl).toMatch(/^data:image\/png;base64,/);
    expect(png.readUInt32BE(16)).toBe(411);
    expect(png.readUInt32BE(20)).toBe(79);
  });
});
