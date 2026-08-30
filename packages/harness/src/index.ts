import { claudeAdapter } from "./claude.js";
import { codexAdapter } from "./codex.js";
import { grokAdapter } from "./grok.js";
import type { HarnessAdapter, HarnessName } from "./types.js";

const ADAPTERS: Record<HarnessName, HarnessAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  grok: grokAdapter,
};

export const HARNESS_NAMES = Object.keys(ADAPTERS) as HarnessName[];

export function isHarnessName(value: string): value is HarnessName {
  // Not `value in ADAPTERS`: that walks the prototype chain, so "toString"
  // passed as a harness name and getAdapter returned Object.prototype.toString.
  return (HARNESS_NAMES as string[]).includes(value);
}

export function getAdapter(name: HarnessName): HarnessAdapter {
  const adapter = ADAPTERS[name];
  if (!adapter) {
    throw new Error(`unknown harness '${name}' (expected one of: ${HARNESS_NAMES.join(", ")})`);
  }
  return adapter;
}

export { runHarness } from "./run.js";
export { preflightModels } from "./preflight.js";
export { resolveEffort } from "./effort.js";
export { modelFor, type ModelClass } from "./models.js";
export { resolveBinary } from "./bin.js";
export type {
  HarnessAccess,
  HarnessAdapter,
  HarnessName,
  HarnessRequest,
  HarnessRunner,
  HarnessUsage,
  CompletedProcess,
} from "./types.js";
export type { ModelSelection, ModelProbe } from "./preflight.js";
