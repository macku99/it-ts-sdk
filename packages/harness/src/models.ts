import type { HarnessName } from "./types.js";

/**
 * Model names each harness accepts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS IS THE FILE TO EDIT WHEN A NEW MODEL SHIPS. Add the name, rebuild.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Deliberately an allowlist and not a mapping. A list that falls behind rejects
 * a working model and says so, which takes seconds to fix. A mapping that falls
 * behind keeps resolving `opus` to a superseded model and never mentions it.
 *
 * Prefer the aliases: claude resolves `opus` and `sonnet` to its own current
 * release, so an alias keeps meaning the latest without an edit here.
 */
export const KNOWN_MODELS: Record<HarnessName, readonly string[]> = {
  claude: [
    // Aliases — these track the latest release on their own.
    "fable",
    "opus",
    "sonnet",
    "haiku",
    // Pinned names, for reproducing a specific run.
    "claude-fable-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-haiku-4-5-20251001",
  ],
  // From each CLI's own published list — `~/.codex/models_cache.json` and
  // `~/.grok/models_cache.json`. There is no bare `gpt-5.6`: the 5.6 line ships
  // as three named variants.
  codex: [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex-spark",
  ],
  grok: ["grok-4.6", "grok-4.5"],
};

/**
 * How large a model a step wants, in our vocabulary rather than any one CLI's.
 *
 * All three sell by size, in their own words: claude by alias, codex through the
 * 5.6 line's three variants (luna "fast and affordable", terra "balanced
 * agentic coding model for everyday work", sol "latest frontier"), grok across
 * its two releases.
 *
 * The rows are M's, and deliberately not a mechanical reading of those
 * descriptions: codex starts at terra rather than luna, which puts a quality
 * floor under the cheapest tier. A model is always named — unset takes the
 * CLI's own default, which is its newest flagship rather than the one a tier
 * was costed against.
 */
export type ModelClass = "small" | "medium" | "large";

const MODEL_CLASSES: Record<HarnessName, Record<ModelClass, string>> = {
  claude: { small: "haiku", medium: "sonnet", large: "opus" },
  codex: { small: "gpt-5.6-terra", medium: "gpt-5.6-sol", large: "gpt-5.6-sol" },
  grok: { small: "grok-4.5", medium: "grok-4.6", large: "grok-4.6" },
};

/** The model name to pin for a class, in the harness's own vocabulary. */
export function modelFor(harness: HarnessName, cls: ModelClass): string {
  return MODEL_CLASSES[harness][cls];
}

// Set when a model is newer than this file. Skips the check for one run rather
// than making a release block work until the list is edited.
export const SKIP_CHECK_ENV = "IT_HARNESS_SKIP_MODEL_CHECK";

/** Returns a message explaining the rejection, or undefined when the model is known. */
export function checkModel(
  harness: HarnessName,
  model: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (env[SKIP_CHECK_ENV]) return undefined;

  const known = KNOWN_MODELS[harness] ?? [];
  if (known.includes(model)) return undefined;

  return (
    `'${model}' is not a known ${harness} model. Known: ${known.join(", ")}. `
    + `If it is newer than @it-core/harness's src/models.ts, add it there, `
    + `or set ${SKIP_CHECK_ENV}=1 for this run.`
  );
}
