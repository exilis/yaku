import type { TranslationRequest, TranslationResponse } from "../schemas/index.js";
import { translate, type TranslateDeps } from "../orchestrator/translate.js";

/** Translate multiple documents with bounded parallelism; per-document isolation. */
export async function translateBatch(
  requests: TranslationRequest[],
  deps: TranslateDeps,
  concurrency = 4
): Promise<TranslationResponse[]> {
  const results: TranslationResponse[] = new Array(requests.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, requests.length) }, async () => {
    while (i < requests.length) {
      const idx = i++;
      try {
        results[idx] = await translate(requests[idx]!, deps);
      } catch {
        results[idx] = {
          status: "failed",
          sourceLang: requests[idx]!.sourceLang,
          results: [],
          summary: { total: 0, translated: 0, reused: 0, unchanged: 0, failed: 0, skipped: 0, iterationsTotal: 0, cost: { inputTokens: 0, outputTokens: 0, usd: 0 } },
        };
      }
    }
  });
  await Promise.all(workers);
  return results;
}
