import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BLOCKING_IMPACTS = new Set(['serious', 'critical']);
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export const blockingAxeViolations = (results = {}) => (
  (results.violations || []).filter(({ impact }) => BLOCKING_IMPACTS.has(impact))
);

export const safeAxeSummary = (results = {}) => ({
  blocking: blockingAxeViolations(results).map(({ id, impact, nodes = [] }) => ({
    id,
    impact,
    nodeCount: nodes.length,
  })),
  moderate: (results.violations || [])
    .filter(({ impact }) => impact === 'moderate')
    .map(({ id, nodes = [] }) => ({ id, nodeCount: nodes.length })),
  passes: (results.passes || []).length,
});

export const assertNoBlockingAxeViolations = (results = {}) => {
  const blocking = blockingAxeViolations(results);
  if (blocking.length > 0) {
    const codes = blocking.map(({ id, impact }) => `${impact}:${id}`).sort().join(',');
    throw new Error(`ACCESSIBILITY_BLOCKING_VIOLATIONS:${codes}`);
  }
  return true;
};

export const scanAccessibility = async (page, testInfo, { include } = {}) => {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  const summary = safeAxeSummary(results);
  await testInfo.attach('accessibility-summary.json', {
    body: Buffer.from(`${JSON.stringify(summary, null, 2)}\n`),
    contentType: 'application/json',
  });
  const safeName = `${testInfo.project.name}-${testInfo.title}`
    .toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 140);
  const outputDirectory = path.resolve('.durable-draft-artifacts/manual-staging/accessibility');
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(outputDirectory, `${safeName}.json`), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  assertNoBlockingAxeViolations(results);
  return summary;
};

export const hasVisibleFocusIndicator = async (locator) => {
  await locator.focus();
  return locator.evaluate((element) => {
    if (document.activeElement !== element) return false;
    const style = getComputedStyle(element);
    const outlineVisible = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
    const shadowVisible = style.boxShadow !== 'none';
    return outlineVisible || shadowVisible;
  });
};
