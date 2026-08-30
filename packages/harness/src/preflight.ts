import { z } from "zod";

import { checkModel } from "./models.js";
import { runHarness } from "./run.js";
import type { HarnessName } from "./types.js";

export interface ModelSelection {
  harness: HarnessName;
  model?: string;
}

export type ModelProbe = (harness: HarnessName, model: string) => Promise<void>;

export interface PreflightDeps {
  probe?: ModelProbe;
  // Ask the harnesses themselves instead of consulting the list. Slower and it
  // spends tokens, so it is opt-in: useful when a model is newer than the list.
  live?: boolean;
}

const PROBE_TIMEOUT_MS = 60 * 1000;
const probeSchema = z.object({ ok: z.boolean() });

/**
 * The cheapest call that still exercises the real path: the binary, the model
 * flag, authentication, and structured output. A model list would confirm less
 * — it says a name exists, not that this machine can run it.
 */
const defaultProbe: ModelProbe = async (harness, model) => {
  await runHarness(harness, {
    prompt: "Reply with ok=true.",
    schema: probeSchema,
    model,
    access: "read-only",
    timeoutMs: PROBE_TIMEOUT_MS,
  });
};

/**
 * Checks every pinned model before a run begins.
 *
 * Early is the point. A model typo on a late node would otherwise surface only
 * after the nodes before it had run, which for note-writing is several minutes
 * and real tokens.
 *
 * By default this is a lookup against src/harness/models.ts: instant, and it
 * spends nothing. Pass `live` to ask the harnesses directly instead, which also
 * catches an expired login or a missing binary.
 */
export async function preflightModels(
  selections: readonly ModelSelection[],
  deps: PreflightDeps = {},
): Promise<void> {
  const probe = deps.probe ?? defaultProbe;

  // A node that pinned nothing runs on the CLI's default, which needs no check.
  const pinned = new Map<string, { harness: HarnessName; model: string }>();
  for (const { harness, model } of selections) {
    if (model === undefined) continue;
    pinned.set(`${harness}:${model}`, { harness, model });
  }
  if (pinned.size === 0) return;

  const results = await Promise.all(
    [...pinned.entries()].map(async ([label, { harness, model }]) => {
      if (!deps.live) {
        const problem = checkModel(harness, model);
        return problem === undefined ? undefined : `${label}: ${problem}`;
      }
      try {
        await probe(harness, model);
        return undefined;
      } catch (err) {
        return `${label}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }),
  );

  const failures = results.filter((r): r is string => r !== undefined);
  if (failures.length > 0) {
    throw new Error(
      `${failures.length === 1 ? "a pinned model was rejected" : "pinned models were rejected"}:\n`
        + failures.map((f) => `  ${f}`).join("\n"),
    );
  }
}
