import { describe, it, expect, vi } from "vitest";
import { withRetry } from "./retry.js";

describe("withRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    expect(await withRetry(fn, { retries: 3, baseDelayMs: 1 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("retries on failure then succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("rate limit")).mockResolvedValue("ok");
    expect(await withRetry(fn, { retries: 3, baseDelayMs: 1 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("throws after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
