#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import {
  compareProFormMigrationInventories,
} from '../base44/functions/_shared/proFormMigrationVerification/entry.ts';

export async function verifyProFormMigrationFile(inputPath, outputPath) {
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const report = compareProFormMigrationInventories(input);
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath) throw new Error('MIGRATION_VERIFICATION_INPUT_REQUIRED');
  const report = await verifyProFormMigrationFile(inputPath, outputPath);
  process.stdout.write(`${JSON.stringify({ verdict: report.verdict, cutoverReady: report.cutoverReady })}\n`);
  if (report.verdict !== 'PASS') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
