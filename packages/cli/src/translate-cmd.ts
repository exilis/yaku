import { translate, TranslationRequestSchema, type TranslateDeps, type TranslationResponse } from "@yaku/core";

/** Pure handler: validate request, run translate. Surface-agnostic for testing. */
export async function runTranslate(rawRequest: unknown, deps: TranslateDeps): Promise<TranslationResponse> {
  const request = TranslationRequestSchema.parse(rawRequest);
  return translate(request, deps);
}
