import { describe, it, expect } from "vitest";
import { groupSegments } from "./assemble.js";
import type { Segment } from "../schemas/index.js";

const segs: Segment[] = [
  { id: "title", text: "Welcome", metadata: { group: "hero", order: 0, role: "title" } },
  { id: "sub", text: "Get started today", metadata: { group: "hero", order: 1, role: "body" } },
  { id: "footer", text: "Contact us", metadata: { group: "foot", order: 0 } },
  { id: "loose", text: "Hi" }, // no group
];

describe("groupSegments", () => {
  it("groups by metadata.group and orders within group", () => {
    const groups = groupSegments(segs);
    const hero = groups.find((g) => g.groupKey === "hero")!;
    expect(hero.segments.map((s) => s.id)).toEqual(["title", "sub"]);
  });
  it("puts ungrouped segments each in their own group", () => {
    const groups = groupSegments(segs);
    const loose = groups.find((g) => g.segments.some((s) => s.id === "loose"))!;
    expect(loose.segments).toHaveLength(1);
  });
  it("covers every input segment exactly once", () => {
    const groups = groupSegments(segs);
    const ids = groups.flatMap((g) => g.segments.map((s) => s.id)).sort();
    expect(ids).toEqual(["footer", "loose", "sub", "title"]);
  });
});
