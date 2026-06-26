import { describe, it, expect } from "vitest";
import { statusToExitCode } from "./exit-code.js";

describe("statusToExitCode", () => {
  it("maps ok->0, partial->1, failed->2", () => {
    expect(statusToExitCode("ok")).toBe(0);
    expect(statusToExitCode("partial")).toBe(1);
    expect(statusToExitCode("failed")).toBe(2);
  });
});
