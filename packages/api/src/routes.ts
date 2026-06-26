import { Hono } from "hono";
import { translate, TranslationRequestSchema, type TranslateDeps } from "@yaku/core";

export function createApp(deps: TranslateDeps) {
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
    const res = await translate(parsed.data, deps);
    return c.json(res);
  });

  return app;
}
