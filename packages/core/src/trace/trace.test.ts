import { describe, it, expect } from "vitest";
import { GroupTrace } from "./trace.js";

describe("GroupTrace", () => {
  it("records iterations and a stop reason", () => {
    const t = new GroupTrace("hero", "ja");
    t.iteration({ draft: { s1: "d1" }, gateViolations: ["x"], reviewerPassed: false, cost: { inputTokens: 1, outputTokens: 1 } });
    t.iteration({ draft: { s1: "d2" }, gateViolations: [], reviewerPassed: true, cost: { inputTokens: 1, outputTokens: 1 } });
    t.finish("accepted");
    const out = t.toJSON();
    expect(out.iterations).toHaveLength(2);
    expect(out.stopReason).toBe("accepted");
    expect(out.groupKey).toBe("hero");
    expect(out.targetLang).toBe("ja");
  });
});
