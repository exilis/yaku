// Field selector for the activities dataset.
//
// Walks an activity record and yields the human-translatable text fields only,
// keyed by a stable dotted JSON path that is used as the yaku segment id. The
// caller writes the translated text back to the same path, leaving every
// non-text field (ids, urls, coordinates, dates, currencies, enums) untouched.

// Leaf keys whose string value is translatable human text.
const TRANSLATABLE_LEAF_KEYS = new Set([
  "title",
  "description",
  "text",
  "display_text",
  "name", // location names
  "address", // location addresses
  "label", // start_time label, e.g. "Morning"
  "summary",
  "caption",
]);

// Keys whose subtree must never be descended into for translation: these hold
// structural data, identifiers, media, geo, money, scheduling — not prose.
const SKIP_SUBTREES = new Set([
  "images",
  "image",
  "attachment",
  "lowest_price",
  "price",
  "unit_pricings",
  "date_ranges",
  "availabilities",
  "origin",
  "payment_methods",
  "base_currency",
  "display_currency",
  "gmt_offset_seconds",
  "longitude",
  "latitude",
  "url",
  "id",
  "time",
  "start_time", // keep label out? label is under start_time; handle below
]);

// Some translatable leaves live under otherwise-skipped containers; allow these
// explicit path suffixes back in.
const FORCE_INCLUDE_SUFFIX = [".start_time.label"];

// highlights is an array of bare strings (not objects) — handle specially.
const STRING_ARRAY_KEYS = new Set(["highlights"]);

/**
 * @param {any} node
 * @param {string} path
 * @param {Array<{id:string,text:string,role?:string,group?:string}>} out
 */
function walk(node, path, out, role, group) {
  if (Array.isArray(node)) {
    const key = path.split(".").pop();
    if (STRING_ARRAY_KEYS.has(key)) {
      node.forEach((v, i) => {
        if (typeof v === "string" && v.trim()) {
          out.push({ id: `${path}.${i}`, text: v, role: key, group });
        }
      });
      return;
    }
    node.forEach((v, i) => walk(v, `${path}.${i}`, out, role, group));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (SKIP_SUBTREES.has(k)) {
        // still allow forced suffixes inside (e.g. start_time.label)
        const childPath = `${path}.${k}`;
        if (FORCE_INCLUDE_SUFFIX.some((s) => (childPath + ".").includes(s + "."))) {
          walk(v, childPath, out, role, group);
        }
        continue;
      }
      walk(v, `${path}.${k}`, out, role, k);
    }
    return;
  }
  if (typeof node === "string" && node.trim()) {
    // The field key is the last non-numeric path segment (numeric segments are
    // array indices, e.g. "...requirements.0.text" -> "text").
    const checkKey = path.split(".").filter((p) => !/^\d+$/.test(p)).pop();
    if (TRANSLATABLE_LEAF_KEYS.has(checkKey) || FORCE_INCLUDE_SUFFIX.some((s) => path.endsWith(s))) {
      out.push({ id: path, text: node, role: checkKey, group });
    }
  }
}

/** Extract translatable segments from an activity record's `data` object. */
export function selectSegments(record) {
  const out = [];
  walk(record.data, "data", out, undefined, undefined);
  // de-dup by id (defensive) and drop empties
  const seen = new Set();
  return out.filter((s) => {
    if (seen.has(s.id) || !s.text.trim()) return false;
    seen.add(s.id);
    return true;
  });
}

/** Write translated segments back into a deep-cloned record by their path ids. */
export function applyTranslations(record, segmentResults) {
  const clone = structuredClone(record);
  for (const r of segmentResults) {
    if (r.status === "failed") continue;
    setByPath(clone, r.id, r.translatedText);
  }
  return clone;
}

function setByPath(obj, dottedPath, value) {
  const parts = dottedPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const idx = /^\d+$/.test(p) ? Number(p) : p;
    cur = cur[idx];
    if (cur == null) return; // path no longer exists; skip
  }
  const last = parts[parts.length - 1];
  const lastIdx = /^\d+$/.test(last) ? Number(last) : last;
  cur[lastIdx] = value;
}
