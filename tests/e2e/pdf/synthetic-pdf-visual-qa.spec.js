import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '../fixtures/safeTest.js';

const artifactDirectory = path.resolve('.durable-draft-artifacts/manual-staging/pdf-qa');

test('[DR-PDF-001] generates a safe synthetic questionnaire PDF for visual QA', async ({ page }) => {
  await page.goto('/tests/e2e/fixtures/pro-draft-pdf.html');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate synthetic PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^SyntheticAccessibilityandPDFQualityAssuranceBusinessNameWithExtendedLength_KaseyaWebsite_ContentQuestionnaire_Responses_8-6-26\.pdf$/u);
  expect(download.suggestedFilename()).not.toMatch(/(?:code|token|grant|secret|password)/iu);
  if (process.env.E2E_WRITE_PDF_QA_ARTIFACTS === 'true') {
    await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    await download.saveAs(path.join(artifactDirectory, 'synthetic-questionnaire-visual-qa.pdf'));
  }
  await expect(page.getByRole('status')).toHaveText('PDF generated.');
});
