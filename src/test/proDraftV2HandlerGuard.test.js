import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const page = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/ProQuestionnaire.jsx'), 'utf8');
const draftPersistence = fs.readFileSync(
  path.resolve(process.cwd(), 'src/lib/draftPersistence.js'),
  'utf8',
);
const submission = fs.readFileSync(
  path.resolve(process.cwd(), 'src/lib/proQuestionnaireSubmit.js'),
  'utf8',
);

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

  it('contains no legacy draft save/event transport or direct CRUD exports', () => {
    expect(page).not.toContain('legacyPersistenceEnabled');
    expect(page).not.toContain('queueDraftSave');
    expect(page).not.toContain('createDraftEvent');
    expect(draftPersistence).not.toMatch(/export\s+(?:const|function)\s+create(?:FindExisting|SaveDraft)/u);
    expect(submission).not.toContain('saveDraftNow');
    expect(submission).not.toContain('createDraftEvent');
    expect(submission).not.toContain('.entities.');
    expect(page).toContain('createProDraftSubmissionCoordinator');
  });

  it('renders controlled unavailable UX when V2 is disabled or killed', () => {
    expect(page).toContain('if (!durableDraftV2Enabled)');
    expect(page).toContain('<ProDraftServiceUnavailable');
    expect(page).toContain('policy={policy}');
    expect(page).toContain('policy.localEditingAllowed && policy.persistentStateRetained');
    expect(page).not.toContain('base44.entities');
  });

  it('routes Clear All through the replacement flow without a reload', () => {
    expect(page).toContain('<ProDraftReplacementActions mode="clear_all" />');
    expect(page).not.toContain('const handleConfirmClearAll');
    expect(page).not.toContain('window.location.reload()');
    expect(page).toContain('const handleConfirmSubmit');
  });
});
