import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./routes.js";
import { MockProvider, SqliteTranslationMemory } from "@yaku/core";
import { writeProfile, setActive, type Profile } from "@yaku/autotune";

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

  describe("with YAKU_PROFILE_BASE profile applied", () => {
    let dir: string;
    afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

    function makeProfile(config: Record<string, unknown>): Profile {
      return {
        name: "p", version: 1, createdAt: "2026-06-27T00:00:00.000Z", parentVersion: null,
        config,
        provenance: { runId: "r", goldSet: "g", sample: 3, langs: ["ja"], judgeModel: "gpt-4o", objective: { floor: 85 } },
        metrics: { quality: 90, estUsd: 0.1, gatePassRate: 1 },
      };
    }

    it("applies the active profile so a config-less request succeeds", async () => {
      dir = mkdtempSync(join(tmpdir(), "api-profile-"));
      writeProfile(dir, makeProfile({
        maxIterations: 2,
        reviewer: { enabled: false },
        tm: { enabled: false, fuzzy: "off", fuzzyThreshold: 0.85 },
        models: { translator: { provider: "mock", model: "m" }, reviewer: { provider: "mock", model: "m" } },
      }));
      setActive(dir, "p", 1);

      const app = createApp(deps(), { profileBase: dir });
      const res = await app.request("/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceLang: "en", targetLangs: ["ja"],
          document: { segments: [{ id: "t", text: "Hello there now" }] },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.results)).toBe(true);
      expect(body.results[0].segments[0].translatedText).toBe("やあ");
    });
  });
});
