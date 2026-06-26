import { describe, it, expect } from "vitest";
import { semanticDrift } from "./back-translation.js";

describe("semanticDrift", () => {
  it("is near 0 for identical back-translation", () => {
    expect(semanticDrift("Hello world", "Hello world")).toBeLessThan(0.05);
  });
  it("is high for unrelated back-translation", () => {
    expect(semanticDrift("Hello world", "Goodbye moon forever")).toBeGreaterThan(0.3);
  });
});
