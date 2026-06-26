import { createHash } from "node:crypto";

/** Stable, language-independent hash of a segment's source text. */
export function sourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}
