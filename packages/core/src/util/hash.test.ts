import { describe, it, expect } from "vitest";
import { sourceHash } from "./hash.js";

describe("sourceHash", () => {
  it("is stable for identical input", () => {
    expect(sourceHash("Hello")).toBe(sourceHash("Hello"));
  });
  it("differs for different input", () => {
    expect(sourceHash("Hello")).not.toBe(sourceHash("World"));
  });
  it("returns a hex string", () => {
    expect(sourceHash("x")).toMatch(/^[0-9a-f]+$/);
  });
});
