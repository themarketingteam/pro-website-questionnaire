import { describe, expect, it } from 'vitest';
import {
  call,
  createAuthoritativeHarness,
  event,
  eventsBody,
  saveBody,
} from './proDraftSaveEventTestHarness.js';

describe('appendProFormDraftEvents bounded audit appends', () => {
  it('accepts an event without changing canonical state or server revision', async () => {
    const harness = await createAuthoritativeHarness();
    const before = { ...harness.memory.records[0] };
    const { response, json } = await call(harness.eventsHandler, eventsBody(harness));
    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      acceptedCount: 1, duplicateCount: 0, rejectedCount: 0,
      batchReplay: false, serverRevision: 0,
    });
    expect(harness.eventRecords).toHaveLength(1);
    expect(harness.memory.records[0]).toMatchObject({
      server_revision: before.server_revision,
      client_revision: before.client_revision,
      state_hash: before.state_hash,
      draft_state_json: before.draft_state_json,
    });
  });

  it('deduplicates an exact batch replay by event id', async () => {
    const harness = await createAuthoritativeHarness();
    const body = eventsBody(harness);
    await call(harness.eventsHandler, body);
    const { response, json } = await call(harness.eventsHandler, body);
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ acceptedCount: 0, duplicateCount: 1, batchReplay: true });
    expect(harness.eventRecords).toHaveLength(1);
  });

  it('accepts only missing events in a partial replay', async () => {
    const harness = await createAuthoritativeHarness();
    await call(harness.eventsHandler, eventsBody(harness));
    const { json } = await call(harness.eventsHandler, eventsBody(harness, {
      idempotencyKey: 'events.synthetic.0002',
      events: [event(1), event(2)],
    }));
    expect(json).toMatchObject({ acceptedCount: 1, duplicateCount: 1, batchReplay: false });
    expect(harness.eventRecords).toHaveLength(2);
  });

  it.each([
    ['duplicate IDs', (harness) => eventsBody(harness, { events: [event(1), event(1)] }), 400],
    ['empty batch', (harness) => eventsBody(harness, { events: [] }), 400],
    ['oversized batch count', (harness) => eventsBody(harness, {
      events: Array.from({ length: 51 }, (_, index) => event(index + 1)),
    }), 400],
    ['unknown event field', (harness) => eventsBody(harness, {
      events: [{ ...event(), surprise: true }],
    }), 400],
    ['wrong authorization', (harness) => eventsBody(harness, { authorization: {} }), 401],
  ])('rejects %s without event writes', async (_name, body, status) => {
    const harness = await createAuthoritativeHarness();
    const { response } = await call(harness.eventsHandler, body(harness));
    expect(response.status).toBe(status);
    expect(harness.eventRecords).toHaveLength(0);
  });

  it('rejects an individually oversized event', async () => {
    const harness = await createAuthoritativeHarness();
    const { response } = await call(harness.eventsHandler, eventsBody(harness, {
      events: [event(1, { value: 'x'.repeat(33_000) })],
    }));
    expect(response.status).toBe(413);
    expect(harness.eventRecords).toHaveLength(0);
  });

  it.each([
    ['email metadata key', { recoveryEmail: 'hidden@example.invalid' }],
    ['email metadata value', { note: 'hidden@example.invalid' }],
    ['authorization metadata', { authorization: 'Bearer hidden' }],
    ['embedded file bytes', { uploadBytes: 'AAAA' }],
  ])('rejects %s recursively', async (_name, metadata) => {
    const harness = await createAuthoritativeHarness();
    const { response, json } = await call(harness.eventsHandler, eventsBody(harness, {
      events: [event(1, { metadata })],
    }));
    expect(response.status).toBe(400);
    expect(json.errorCode).toBe('INVALID_REQUEST');
    expect(harness.eventRecords).toHaveLength(0);
  });

  it('rejects nested credential fields in event values', async () => {
    const harness = await createAuthoritativeHarness();
    const { response } = await call(harness.eventsHandler, eventsBody(harness, {
      events: [event(1, { value: { nested: { accessToken: 'hidden' } } })],
    }));
    expect(response.status).toBe(400);
    expect(harness.eventRecords).toHaveLength(0);
  });

  it('stores deterministic hashes and no full metadata email', async () => {
    const harness = await createAuthoritativeHarness();
    await call(harness.eventsHandler, eventsBody(harness, {
      events: [event(1, { value: { z: 1, a: 2 }, metadata: { z: 1, a: 2 } })],
    }));
    expect(harness.eventRecords[0]).toMatchObject({
      value_json: '{"a":2,"z":1}',
      event_metadata_json: `{"a":2,"occurredAtClient":"${harness.eventRecords[0].created_at_iso}","z":1}`,
      redaction_level: 'full',
    });
    expect(harness.eventRecords[0].value_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('allows safe file URL metadata while excluding raw bytes', async () => {
    const harness = await createAuthoritativeHarness();
    const fileValue = {
      url: 'https://synthetic.invalid/upload/file-1',
      name: 'synthetic.txt', type: 'text/plain', size: 42,
    };
    const { response } = await call(harness.eventsHandler, eventsBody(harness, {
      events: [event(1, { value: fileValue })],
    }));
    expect(response.status).toBe(200);
    expect(JSON.parse(harness.eventRecords[0].value_json)).toEqual(fileValue);
    expect(harness.eventRecords[0].value_json).not.toMatch(/(?:base64|bytes)/iu);
  });

  it('fails safely when bulk creation throws', async () => {
    const harness = await createAuthoritativeHarness();
    harness.controls.eventMode = 'throw';
    const { response, json } = await call(harness.eventsHandler, eventsBody(harness));
    expect(response.status).toBe(500);
    expect(json.errorCode).toBe('EVENT_BATCH_FAILED');
    expect(harness.eventRecords).toHaveLength(0);
  });

  it('fails safely when the backend reports a short bulk result', async () => {
    const harness = await createAuthoritativeHarness();
    harness.controls.eventMode = 'short';
    const { response, json } = await call(harness.eventsHandler, eventsBody(harness));
    expect(response.status).toBe(500);
    expect(json.errorCode).toBe('EVENT_BATCH_FAILED');
  });

  it('preserves an accepted snapshot when the subsequent event append fails', async () => {
    const harness = await createAuthoritativeHarness();
    const saved = await call(harness.saveHandler, saveBody(harness));
    expect(saved.response.status).toBe(200);
    harness.controls.eventMode = 'throw';
    const appended = await call(harness.eventsHandler, eventsBody(harness));
    expect(appended.response.status).toBe(500);
    expect(harness.memory.records[0]).toMatchObject({
      server_revision: 1, client_revision: 1,
    });
  });

  it('records only diagnostic batch metadata on the draft', async () => {
    const harness = await createAuthoritativeHarness();
    await call(harness.eventsHandler, eventsBody(harness));
    expect(harness.memory.records[0].last_event_batch_idempotency_key_hash)
      .toMatch(/^[0-9a-f]{64}$/u);
    expect(harness.memory.records[0].last_event_batch_request_id)
      .toMatch(/^pdrq_/u);
  });
});
