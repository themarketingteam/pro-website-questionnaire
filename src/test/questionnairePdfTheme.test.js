import { describe, expect, it } from 'vitest';
import {
  getSafeQuestionnaireCanvasScale,
  QUESTIONNAIRE_PDF_THEME
} from '@/components/pro-form/pdf/questionnairePdfTheme';

describe('QUESTIONNAIRE_PDF_THEME', () => {
  it('locks the reference page, color, and square-layout contract', () => {
    expect(QUESTIONNAIRE_PDF_THEME.page).toEqual({
      widthPt: 612,
      blankMinHeightPt: 4356,
      horizontalMarginPt: 40,
      background: '#FFFFFF'
    });
    expect(QUESTIONNAIRE_PDF_THEME.colors).toEqual({
      purple: '#6464FF',
      accentPurple: '#3030FF',
      lavender: '#ECECFF',
      divider: '#C7C7FF',
      labelText: '#4B4F63',
      bodyText: '#000000',
      white: '#FFFFFF'
    });
    expect(QUESTIONNAIRE_PDF_THEME.layout).toMatchObject({
      sectionBarHeightPt: 22,
      businessRowMinHeightPt: 34,
      rowGapPt: 17,
      childIndentPt: 17,
      childAccentWidthPt: 3
    });
    expect(Object.isFrozen(QUESTIONNAIRE_PDF_THEME)).toBe(true);
    expect(Object.isFrozen(QUESTIONNAIRE_PDF_THEME.colors)).toBe(true);
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
});
