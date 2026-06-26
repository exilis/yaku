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

  it("does not merge an ungrouped segment with a group literally named like the internal key", () => {
    const groups = groupSegments([
      { id: "foo", text: "a" },                                   // ungrouped -> singleton keyed "foo"
      { id: "bar", text: "b", metadata: { group: "__single__:foo" } }, // real group
    ]);
    // They must remain DISTINCT groups; bar stays in its named group.
    const barGroup = groups.find((g) => g.segments.some((s) => s.id === "bar"))!;
    const fooGroup = groups.find((g) => g.segments.some((s) => s.id === "foo"))!;
    expect(barGroup).not.toBe(fooGroup);
    expect(barGroup.segments).toHaveLength(1);
    expect(fooGroup.segments).toHaveLength(1);
    expect(barGroup.groupKey).toBe("__single__:foo");
  });

  it("handles empty input", () => {
    expect(groupSegments([])).toEqual([]);
  });

  it("actually sorts within a group by order (reversed input)", () => {
    const groups = groupSegments([
      { id: "b", text: "B", metadata: { group: "g", order: 1 } },
      { id: "a", text: "A", metadata: { group: "g", order: 0 } },
    ]);
    expect(groups[0]!.segments.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("preserves input order for equal order values (stable)", () => {
    const groups = groupSegments([
      { id: "x", text: "X", metadata: { group: "g", order: 0 } },
      { id: "y", text: "Y", metadata: { group: "g", order: 0 } },
    ]);
    expect(groups[0]!.segments.map((s) => s.id)).toEqual(["x", "y"]);
  });

  it("covers every input segment exactly once with an id/group-name collision", () => {
    const groups = groupSegments([
      { id: "hero", text: "h" },                              // ungrouped, id "hero"
      { id: "x", text: "x", metadata: { group: "hero" } },    // group named "hero"
    ]);
    const ids = groups.flatMap((g) => g.segments.map((s) => s.id)).sort();
    expect(ids).toEqual(["hero", "x"]);
    // distinct groups despite name/id overlap
    expect(groups).toHaveLength(2);
  });
});
