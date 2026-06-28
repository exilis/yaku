import { Hono } from "hono";
import { translate, TranslationRequestSchema, type TranslateDeps } from "@yaku/core";

export function createApp(deps: TranslateDeps, opts?: { profileBase?: string }) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post("/translate", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = TranslationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }
    let request: Record<string, unknown> = parsed.data as Record<string, unknown>;
    if (opts?.profileBase) {
      const { applyProfile } = await import("@yaku/autotune");
      request = applyProfile(request, opts.profileBase);
    }
    const merged = TranslationRequestSchema.safeParse(request);
    if (!merged.success) {
      return c.json({ error: "profile merge produced invalid request", issues: merged.error.issues }, 400);
    }
    const res = await translate(merged.data, deps);
    return c.json(res);
  });

  return app;
}
