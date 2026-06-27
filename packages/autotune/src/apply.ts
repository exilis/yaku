import { readActiveProfile } from "./profile.js";

/**
 * Merge the active autotune profile (if any) into a translation request as a
 * BASELINE: values explicitly present in the request win over the profile.
 *
 * - If no profile is active (or baseDir has none), the request is returned
 *   unchanged (a shallow clone).
 * - `config` is merged one level deep over the profile's config, so a request
 *   overriding a single field keeps the profile's sibling fields.
 * - `promptTemplates`: request value wins entirely if present; else profile's.
 *
 * The engine stays profile-agnostic; this is the integration seam callers
 * (CLI / API / MCP) opt into.
 */
export function applyProfile(
  request: Record<string, unknown>,
  baseDir: string
): Record<string, unknown> {
  const profile = readActiveProfile(baseDir);
  if (!profile) return { ...request };

  const reqConfig = (request.config as Record<string, unknown> | undefined) ?? {};
  const profConfig = (profile.config as Record<string, unknown> | undefined) ?? {};

  // one-level-deep merge: profile is the base, request overrides
  const mergedConfig: Record<string, unknown> = { ...profConfig, ...reqConfig };
  for (const key of Object.keys(profConfig)) {
    const p = profConfig[key];
    const r = reqConfig[key];
    if (p && r && typeof p === "object" && typeof r === "object" && !Array.isArray(p) && !Array.isArray(r)) {
      mergedConfig[key] = { ...(p as object), ...(r as object) };
    }
  }

  // promptTemplates flows through config.promptTemplates in this engine.
  // request wins if present, else profile's.
  const promptTemplates =
    reqConfig.promptTemplates ??
    request.promptTemplates ??
    profile.promptTemplates;
  if (promptTemplates !== undefined) {
    mergedConfig.promptTemplates = promptTemplates;
  }

  return { ...request, config: mergedConfig };
}
