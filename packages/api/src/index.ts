import { serve } from "@hono/node-server";
import { createApp } from "./routes.js";
import { createProvider, createTranslationMemory, type TranslateDeps } from "@yaku/core";

export { createApp } from "./routes.js";

export function createServer(deps?: Partial<TranslateDeps>) {
  const resolved: TranslateDeps = {
    provider: deps?.provider ?? createProvider({ provider: process.env.YAKU_PROVIDER ?? "openai" }),
    tm: deps?.tm ?? createTranslationMemory({ backend: "sqlite", path: process.env.YAKU_TM_PATH ?? "yaku-tm.sqlite" }),
  };
  return createApp(resolved);
}

// Run directly: node dist/index.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createServer();
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`yaku API listening on :${port}`);
}
