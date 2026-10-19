import { afterEach, describe, expect, it, vi } from 'vitest';
import { startupFallback } from './startup';

describe('startup resilience', () => {
  afterEach(() => vi.useRealTimers());
  it('opens with a safe fallback when an optional native lookup never responds', async () => {
    vi.useFakeTimers();
    const result = startupFallback(new Promise<string>(() => undefined), 'unselected', 1200);
    await vi.advanceTimersByTimeAsync(1200);
    expect(await result).toBe('unselected');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses available saved state immediately and clears the deadline', async () => {
    vi.useFakeTimers();
    expect(await startupFallback(Promise.resolve('business'), 'unselected')).toBe('business');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('handles a failed lookup without an unhandled rejection or permanent loader', async () => {
    expect(await startupFallback(Promise.reject(new Error('storage unavailable')), null)).toBeNull();
  });
  it('ignores a late lookup result after the app has already opened', async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const result = startupFallback(new Promise<string>(resolve => { finish = resolve; }), 'unselected', 50);
    await vi.advanceTimersByTimeAsync(50);
    finish('business');
    expect(await result).toBe('unselected');
  });
});
