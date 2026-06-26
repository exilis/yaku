import type { Segment } from "../schemas/index.js";

export interface SegmentGroup {
  groupKey: string;
  segments: Segment[]; // ordered by metadata.order, then input order
}

/** Group segments by metadata.group. Ungrouped segments each become a
 *  singleton group keyed by their id. Within a group, sort by order. */
export function groupSegments(segments: Segment[]): SegmentGroup[] {
  const grouped = new Map<string, Segment[]>();
  const order = new Map<string, number>(); // first-seen index for stable group order
  let idx = 0;

  for (const seg of segments) {
    const key = seg.metadata?.group ?? `__single__:${seg.id}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
      order.set(key, idx);
    }
    grouped.get(key)!.push(seg);
    idx++;
  }

  const result: SegmentGroup[] = [];
  for (const [key, segs] of grouped) {
    const sorted = [...segs].sort((a, b) => (a.metadata?.order ?? 0) - (b.metadata?.order ?? 0));
    const groupKey = key.startsWith("__single__:") ? sorted[0]!.id : key;
    result.push({ groupKey, segments: sorted });
  }
  // Stable order across groups by first-seen index.
  result.sort((a, b) => {
    const ka = a.groupKey, kb = b.groupKey;
    return (order.get(a.segments[0]!.metadata?.group ?? `__single__:${ka}`) ?? 0)
         - (order.get(b.segments[0]!.metadata?.group ?? `__single__:${kb}`) ?? 0);
  });
  return result;
}
