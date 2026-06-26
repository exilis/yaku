import { describe, it, expect } from "vitest";
import { createApp } from "./routes.js";
import { MockProvider, SqliteTranslationMemory } from "@yaku/core";

function deps() {
  return {
    provider: new MockProvider({
      translator: [{ translations: { t: "やあ" } }],
      reviewer: [{ passed: true, confidence: { t: 0.9 }, critique: "" }],
    }),
    tm: new SqliteTranslationMemory(":memory:"),
  };
}

describe("api routes", () => {
  it("GET /health returns ok", async () => {
    const app = createApp(deps());
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });

  it("POST /translate returns a TranslationResponse", async () => {
    const app = createApp(deps());
    const res = await app.request("/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceLang: "en", targetLangs: ["ja"],
        document: { segments: [{ id: "t", text: "Hello there now" }] },
        config: { tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 }, models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].segments[0].translatedText).toBe("やあ");
  });

  it("POST /translate returns 400 on invalid body", async () => {
    const app = createApp(deps());
    const res = await app.request("/translate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceLang: "en", targetLangs: [], document: { segments: [] } }),
    });
    expect(res.status).toBe(400);
  });
});
