import type { Segment } from "../schemas/index.js";

export interface SegmentGroup {
  groupKey: string;
  segments: Segment[]; // ordered by metadata.order; ties broken by input order (stable sort)
}

/**
 * Group segments by metadata.group. Segments sharing a group are assembled
 * together (sorted by metadata.order, stable). Ungrouped segments each become
 * a singleton group keyed by their id.
 *
 * Grouped and singleton segments live in SEPARATE namespaces, so a user-chosen
 * group name can never collide with a singleton's id-based key. Output group
 * order is stable by first-seen input position. Every input segment appears in
 * exactly one output group (round-trip invariant).
 */
export function groupSegments(segments: Segment[]): SegmentGroup[] {
  interface Bucket {
    groupKey: string;
    segments: Segment[];
    firstSeen: number;
  }
  // Real groups keyed by metadata.group value.
  const groups = new Map<string, Bucket>();
  // Singleton (ungrouped) segments, in input order — never keyed by a shared map.
  const singletons: Bucket[] = [];

  let idx = 0;
  for (const seg of segments) {
    const groupName = seg.metadata?.group;
    if (groupName === undefined) {
      singletons.push({ groupKey: seg.id, segments: [seg], firstSeen: idx });
    } else {
      let bucket = groups.get(groupName);
      if (!bucket) {
        bucket = { groupKey: groupName, segments: [], firstSeen: idx };
        groups.set(groupName, bucket);
      }
      bucket.segments.push(seg);
    }
    idx++;
  }

  const buckets: Bucket[] = [...groups.values(), ...singletons];
  // Stable order across groups by first-seen input position.
  buckets.sort((a, b) => a.firstSeen - b.firstSeen);

  return buckets.map((b) => ({
    groupKey: b.groupKey,
    segments: [...b.segments].sort(
      (x, y) => (x.metadata?.order ?? 0) - (y.metadata?.order ?? 0)
    ),
  }));
}
