import type { TranslationMemory, TMEntry } from "@yaku/core";

export async function tmInvalidate(
  tm: TranslationMemory,
  filter: { sourceLang?: string; targetLang?: string; namespace?: string }
): Promise<void> {
  await tm.invalidate(filter);
}

export async function tmExport(tm: TranslationMemory): Promise<TMEntry[]> {
  const anyTm = tm as unknown as { exportAll?: () => Promise<TMEntry[]> };
  if (!anyTm.exportAll) throw new Error("export not supported for this TM backend");
  return anyTm.exportAll();
}

export async function tmImport(tm: TranslationMemory, entries: TMEntry[]): Promise<void> {
  for (const e of entries) await tm.upsert(e);
}
