export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = { retries: 3, baseDelayMs: 500 }
): Promise<T> {
  const retries = Math.max(0, opts.retries);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const delay = Math.min(opts.baseDelayMs * 2 ** attempt, opts.maxDelayMs ?? 30000);
      await sleep(delay);
    }
  }
  throw lastErr;
}
