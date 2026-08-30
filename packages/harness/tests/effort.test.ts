import { describe, it, expect } from "vitest";

import { EFFORT_LEVELS, chooseLevel, resolveEffort } from "../src/effort.js";
import type { HarnessEffort } from "../src/types.js";

describe("the vocabulary", () => {
  it("runs lowest to highest, which is what clamping reads", () => {
    expect(EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  });
});

describe("chooseLevel", () => {
  const full: HarnessEffort[] = ["low", "medium", "high", "xhigh", "max", "ultra"];
  const four: HarnessEffort[] = ["low", "medium", "high", "xhigh"];

  it("passes through a level the model offers", () => {
    expect(chooseLevel(full, "high")).toBe("high");
    expect(chooseLevel(four, "xhigh")).toBe("xhigh");
  });

  it("clamps down to the nearest level offered, never up past what was asked", () => {
    // Downward is the whole point: a level nobody offers should cost less than
    // asked, not more.
    expect(chooseLevel(four, "ultra")).toBe("xhigh");
    expect(chooseLevel(four, "max")).toBe("xhigh");
  });

  it("has no special case left, because the top of the ladder is the ceiling", () => {
    // Asking for the highest level there is and clamping down *is* "give me
    // this model's most", so `max` needs no rule of its own — and stays
    // available as an ordinary level to ask for deliberately.
    expect(chooseLevel(full, EFFORT_LEVELS[EFFORT_LEVELS.length - 1])).toBe("ultra");
    expect(chooseLevel(four, EFFORT_LEVELS[EFFORT_LEVELS.length - 1])).toBe("xhigh");
    expect(chooseLevel(full, "max")).toBe("max");
  });

  it("clamps up when the model offers nothing lower, the one case down cannot serve", () => {
    expect(chooseLevel(["high", "max"], "low")).toBe("high");
  });
});

describe("resolveEffort", () => {
  it("reads the ladder off the model, not the harness", () => {
    // codex publishes a different set per model: sol and terra reach `ultra`,
    // luna stops at `max`, and the 5.4/5.5 line stops at `xhigh`.
    expect(resolveEffort("codex", "gpt-5.6-sol", "ultra")).toBe("ultra");
    expect(resolveEffort("codex", "gpt-5.6-luna", "ultra")).toBe("max");
    expect(resolveEffort("codex", "gpt-5.4", "ultra")).toBe("xhigh");
  });

  it("keeps xhigh on codex, which is what the config on this machine runs", () => {
    expect(resolveEffort("codex", "gpt-5.6-sol", "xhigh")).toBe("xhigh");
  });

  it("gives claude the ladder its help documents", () => {
    expect(resolveEffort("claude", "opus", "max")).toBe("max");
    expect(resolveEffort("claude", "haiku", "ultra")).toBe("max");
  });

  it("separates grok's two models, which do not offer the same levels", () => {
    expect(resolveEffort("grok", "grok-4.6", "ultra")).toBe("xhigh");
    expect(resolveEffort("grok", "grok-4.5", "ultra")).toBe("high");
  });

  it("falls back to the narrowest ladder a harness publishes for a model it has never heard of", () => {
    // Under-spending on an unknown model is a smaller mistake than naming a
    // level it rejects, which fails the call outright.
    expect(resolveEffort("codex", "gpt-6-unreleased", "ultra")).toBe("xhigh");
    expect(resolveEffort("grok", "grok-5", "ultra")).toBe("high");
    expect(resolveEffort("claude", undefined, "ultra")).toBe("max");
  });
});
