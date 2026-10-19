/** Optional local startup hints must not hold the app closed indefinitely. */
export function startupFallback<T>(work: Promise<T>, fallback: T, timeoutMs = 1200): Promise<T> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: T) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => finish(fallback), timeoutMs);
    work.then(finish, () => finish(fallback));
  });
}

export const SESSION_RESTORE_TIMEOUT_MS = 15_000;
export const SESSION_RESTORE_TIMEOUT_COPY = 'Your connection is taking longer than expected. Please try again.';
