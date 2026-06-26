import type { TranslationResponse } from "@yaku/core";

/** Map a translation response status to a process exit code (scripting contract). */
export function statusToExitCode(status: TranslationResponse["status"]): number {
  switch (status) {
    case "ok": return 0;
    case "partial": return 1;
    case "failed": return 2;
  }
}
