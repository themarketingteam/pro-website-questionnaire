import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/ProQuestionnaire.jsx'), 'utf8');

describe('V2 handler-level persistence guard', () => {
  it('uses atomic Q5 operations and has no handler snapshot closure in the Q5 block', () => {
    const q5 = page.slice(page.indexOf("if (question.id === '5')"), page.indexOf('// Other multi-text'));
    expect(q5).toContain("'location_add'");
    expect(q5).toContain("'location_update'");
    expect(q5).toContain("'location_remove'");
    expect(q5).toContain("'location_primary_set'");
    expect(q5).not.toContain('queueDraftSave');
    expect(q5).not.toContain('createSaveDraftSnapshot');
    expect(q5).not.toContain('base44.entities');
  });

  it('fails closed before legacy direct event persistence in V2', () => {
    expect(page).toMatch(/const createDraftEvent[\s\S]+if \(!legacyPersistenceEnabled\) return false;[\s\S]+ProFormDraftEvent\.create/u);
    expect(page).toMatch(/const queueDraftEvent[\s\S]+if \(!legacyPersistenceEnabled\) return false;/u);
    expect(page).toMatch(/legacyPersistenceEnabled[\s\S]+queueDraftSave/u);
  });

  it('routes Clear All through the replacement flow without a reload', () => {
    expect(page).toContain('<ProDraftReplacementActions mode="clear_all" />');
    expect(page).not.toContain('const handleConfirmClearAll');
    expect(page).not.toContain('window.location.reload()');
    expect(page).toContain('const handleConfirmSubmit');
  });
});
