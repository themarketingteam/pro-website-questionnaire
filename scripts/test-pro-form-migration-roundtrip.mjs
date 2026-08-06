#!/usr/bin/env node

import assert from 'node:assert/strict';

import { buildMigrationExportRecord } from '../base44/functions/_shared/proFormMigrationExport/entry.ts';
import { upsertMigratedRecord } from '../base44/functions/_shared/proFormMigrationImport/entry.ts';
import { getProFormMigrationRuntimePolicy } from '../base44/functions/_shared/proFormMigrationPolicy/entry.ts';

class Entity {
  constructor(rows = []) { this.rows = rows.map((row) => ({ ...row })); this.next = 1; }
  async filter(query, _sort, limit = 5000, skip = 0) { return this.rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value)).slice(skip, skip + limit); }
  async get(id) { return this.rows.find((row) => row.id === id); }
  async create(data) { const row = { id: `synthetic-${this.next++}`, created_date: '2026-08-06T12:00:00Z', updated_date: '2026-08-06T12:00:00Z', ...data }; this.rows.push(row); return row; }
  async update(id, patch) { const row = await this.get(id); Object.assign(row, patch); return row; }
}

const policy = getProFormMigrationRuntimePolicy('ProFormSubmission');
const original = { id: 'blue-roundtrip-1', created_date: '2026-08-06T10:00:00Z',
  updated_date: '2026-08-06T10:01:00Z', metadata: { fixture: true },
  userdata: { answer: 'synthetic-initial' }, environment: 'test' };
const exportOptions = (sourceAppId) => ({ sourceAppId,
  sourceEnvironment: 'test', destinationEnvironment: 'test', includeTestRecords: false });
const migrationOptions = (destinationAppId, migrationDirection, batchId) => ({ apply: true,
  destinationAppId, destinationEnvironment: 'test', migrationDirection, migrationVersion: 1, batchId });

const green = { ProFormSubmission: new Entity(), ProFormMigrationIdMap: new Entity() };
const initial = await buildMigrationExportRecord(original, policy, exportOptions('blue'));
assert.equal((await upsertMigratedRecord(green, initial, policy,
  migrationOptions('green', 'blue_to_green', 'initial'))).outcome, 'created');

const deltaSource = { ...original, updated_date: '2026-08-06T11:00:00Z',
  userdata: { answer: 'synthetic-delta' } };
const delta = await buildMigrationExportRecord(deltaSource, policy, exportOptions('blue'));
assert.equal((await upsertMigratedRecord(green, delta, policy,
  migrationOptions('green', 'blue_to_green', 'delta'))).outcome, 'updated');

green.ProFormSubmission.rows[0].userdata = { answer: 'synthetic-green-final' };
green.ProFormSubmission.rows[0].updated_date = '2026-08-06T12:10:00Z';
const reverse = await buildMigrationExportRecord(green.ProFormSubmission.rows[0], policy,
  exportOptions('green'));
const blue = { ProFormSubmission: new Entity([deltaSource]), ProFormMigrationIdMap: new Entity() };
assert.equal((await upsertMigratedRecord(blue, reverse, policy,
  migrationOptions('blue', 'green_to_blue', 'reverse'))).outcome, 'updated');
assert.equal(blue.ProFormSubmission.rows.length, 1);
assert.equal(blue.ProFormSubmission.rows[0].userdata.answer, 'synthetic-green-final');

process.stdout.write('synthetic_initial_delta_reverse_roundtrip=PASS\n');
