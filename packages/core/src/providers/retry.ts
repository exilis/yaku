export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = { retries: 3, baseDelayMs: 500 }
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === opts.retries) break;
      const delay = opts.baseDelayMs * 2 ** attempt;
      await sleep(delay);
    }
  }
  throw lastErr;
}
