import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  hasClarity,
  identifyClarityUser,
  sanitizeClarityValue,
  setClarityTags,
  trackClarityEvent
} from '@/lib/clarity';

describe('clarity helpers', () => {
  const originalClarity = window.clarity;

  beforeEach(() => {
    window.clarity = originalClarity;
    delete window.clarity;
  });

  afterEach(() => {
    window.clarity = originalClarity;
    delete window.clarity;
  });

  it('trackClarityEvent does not throw when window is undefined', () => {
    const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

    Object.defineProperty(globalThis, 'window', {
      value: undefined,
      configurable: true,
      writable: true
    });

    expect(() => trackClarityEvent('submit_attempt')).not.toThrow();

    Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  });

  it('trackClarityEvent does not throw when window.clarity is missing', () => {
    expect(hasClarity()).toBe(false);
    expect(() => trackClarityEvent('submit_attempt')).not.toThrow();
  });

  it('trackClarityEvent does not throw when window.clarity throws', () => {
    window.clarity = vi.fn(() => {
      throw new Error('clarity failed');
    });

    expect(() => trackClarityEvent('submit_attempt', { stage: 'final' })).not.toThrow();
  });

  it('setClarityTags does not throw for null arrays objects or circular values', () => {
    window.clarity = vi.fn();
    const circular = {};
    circular.self = circular;

    expect(() => setClarityTags(null)).not.toThrow();
    expect(() => setClarityTags(['a', 'b'])).not.toThrow();
    expect(() => setClarityTags({ nested: { ok: true }, list: [1, 2], circular })).not.toThrow();
  });

  it('identifyClarityUser does not throw for missing values', () => {
    window.clarity = vi.fn();

    expect(() => identifyClarityUser()).not.toThrow();
    expect(() => identifyClarityUser({})).not.toThrow();
    expect(() => identifyClarityUser({ userId: 'abc123' })).not.toThrow();
  });

  it('sanitizeClarityValue safely handles long and complex values', () => {
    const value = sanitizeClarityValue({ a: 'x'.repeat(500) });
    expect(typeof value).toBe('string');
    expect(value.length).toBeLessThanOrEqual(255);

    const circular = {};
    circular.self = circular;
    expect(sanitizeClarityValue(circular)).toBe('[object]');
  });
});