import type { HarnessEffort, HarnessName } from "./types.js";

/**
 * Every level a caller may ask for, lowest first.
 *
 * The union of what the three harnesses publish, in one order. `ultra` is
 * codex's alone and sits above `max`, which is why the top of this list is not
 * claude's top — and why asking for the last entry is how a caller says "this
 * model's most" without any rule of its own.
 *
 * `ultra` is worth knowing about before it is spent: codex describes it as
 * maximum reasoning *with automatic task delegation*, so it does not only think
 * harder, it spawns work of its own.
 */
export const EFFORT_LEVELS: readonly HarnessEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

/**
 * What each model actually offers, lowest first.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  THIS IS THE FILE TO EDIT WHEN A MODEL SHIPS OR GAINS A LEVEL.
 *  Truth lives in each CLI's own cache — `~/.codex/models_cache.json`,
 *  `~/.grok/models_cache.json` — which is where these came from.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Keyed by model rather than by harness, because within one harness they
 * differ: codex's sol and terra reach `ultra`, luna stops at `max`, and the
 * 5.4/5.5 line stops at `xhigh`. A table keyed by harness alone would name a
 * level half its models reject.
 */
const LADDERS: Record<string, readonly HarnessEffort[]> = {
  "gpt-5.6-sol": ["low", "medium", "high", "xhigh", "max", "ultra"],
  "gpt-5.6-terra": ["low", "medium", "high", "xhigh", "max", "ultra"],
  "gpt-5.6-luna": ["low", "medium", "high", "xhigh", "max"],
  "gpt-5.5": ["low", "medium", "high", "xhigh"],
  "gpt-5.4": ["low", "medium", "high", "xhigh"],
  "gpt-5.4-mini": ["low", "medium", "high", "xhigh"],
  "gpt-5.3-codex-spark": ["low", "medium", "high", "xhigh"],
  "grok-4.6": ["low", "medium", "high", "xhigh"],
  "grok-4.5": ["low", "medium", "high"],
};

/**
 * What a harness is assumed to offer when the model is unknown or unnamed.
 *
 * The narrowest ladder that harness publishes, deliberately: under-spending on
 * a model nobody has listed yet is a smaller mistake than naming a level it
 * rejects, which costs the call rather than some tokens. claude publishes one
 * ladder for every model, so its fallback is simply that.
 */
const FALLBACKS: Record<HarnessName, readonly HarnessEffort[]> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh"],
  grok: ["low", "medium", "high"],
};

/**
 * The level a model gets when asked for one, given what it offers.
 *
 * Downward, deliberately. A level nobody offers should resolve to something
 * cheaper than was asked for rather than dearer — the opposite rule turns every
 * gap in a ladder into a bill nobody chose. Upward happens in one case only: a
 * model offering nothing at or below the request, where down has no candidate.
 *
 * There is no special case for the top. Asking for the highest level in the
 * vocabulary and clamping down *is* "give me this model's most", which leaves
 * every level, `max` included, an ordinary one a caller can name deliberately.
 */
export function chooseLevel(
  ladder: readonly HarnessEffort[],
  requested: HarnessEffort,
): HarnessEffort {
  const wanted = EFFORT_LEVELS.indexOf(requested);
  let chosen: HarnessEffort | undefined;
  for (const level of ladder) {
    if (EFFORT_LEVELS.indexOf(level) <= wanted) chosen = level;
  }
  return chosen ?? ladder[0];
}

/** The level to hand a harness, given the model the same call names. */
export function resolveEffort(
  harness: HarnessName,
  model: string | undefined,
  requested: HarnessEffort,
): HarnessEffort {
  const ladder = (model ? LADDERS[model] : undefined) ?? FALLBACKS[harness];
  return chooseLevel(ladder, requested);
}
