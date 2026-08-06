import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseLegacyAnalysisArguments,
  runLegacyAnalysisCli,
} from './analyze-pro-form-legacy-data.mjs';

const memoryStream = () => {
  let value = '';
  return { write: (chunk) => { value += String(chunk); }, value: () => value };
};

describe('legacy analysis CLI', () => {
  it('parses fixture/input/output/strict modes and rejects ambiguous sources', () => {
    expect(parseLegacyAnalysisArguments(['--fixture', '--strict', '--output', 'report.json']))
      .toMatchObject({ fixture: true, strict: true, output: 'report.json' });
    expect(() => parseLegacyAnalysisArguments(['--fixture', '--input', 'data.json']))
      .toThrow('LEGACY_ANALYSIS_SOURCE_REQUIRED');
  });

  it('writes only safe fixture metadata with mode 0600', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'legacy-analysis-'));
    const output = path.join(directory, 'report.json');
    const stdout = memoryStream(); const stderr = memoryStream();
    expect(await runLegacyAnalysisCli(['--fixture', '--output', output], { stdout, stderr })).toBe(0);
    expect(stdout.value()).toBe('LEGACY_ANALYSIS_REPORT_WRITTEN\n');
    expect(stderr.value()).toBe('');
    const reportText = await readFile(output, 'utf8');
    expect(reportText).not.toContain('SYNTHETIC_COMPLETE_RESPONSE');
    expect(reportText).not.toContain('synthetic.legacy@example.invalid');
    expect(JSON.parse(reportText).migrationVersion).toBe(1);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });

  it('returns nonzero in strict mode for critical, future, and ambiguous fixture evidence', async () => {
    const stdout = memoryStream(); const stderr = memoryStream();
    expect(await runLegacyAnalysisCli(['--fixture', '--strict'], { stdout, stderr })).toBe(2);
    expect(stderr.value()).toContain('LEGACY_ANALYSIS_STRICT_FAILURE');
    expect(stdout.value()).not.toContain('SYNTHETIC_');
  });

  it('warns about broad input permissions without printing raw input', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'legacy-input-'));
    const input = path.join(directory, 'input.json');
    await writeFile(input, JSON.stringify({
      drafts: [{
        id: 'safe-id', session_id: 'safe-session', status: 'active',
        responses_json: '{"q":"PRIVATE_SYNTHETIC_ANSWER"}',
      }],
      events: [],
    }), { mode: 0o644 });
    await chmod(input, 0o644);
    const stdout = memoryStream(); const stderr = memoryStream();
    expect(await runLegacyAnalysisCli(['--input', input], { stdout, stderr })).toBe(0);
    expect(stderr.value()).toBe('INPUT_FILE_PERMISSIONS_TOO_OPEN\n');
    expect(stdout.value()).not.toContain('PRIVATE_SYNTHETIC_ANSWER');
  });
});
